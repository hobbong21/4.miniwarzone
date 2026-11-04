// WebSocket(RFC 6455) 최소 구현 + PVP 로비 · 매칭 · 친구 방 코드 · 재접속 · 결과 합의 · 레이팅
'use strict';
const crypto = require('crypto');
const { log, token, cleanName, cleanNation, normCode } = require('./util');

const MAX_FRAME = 2 * 1024 * 1024, MSG_PER_SEC = 150, ROOM_TTL = 10 * 60e3;
const RESUME_SEC = Number(process.env.MWZ_RESUME_SEC) || 30, REPORT_WAIT = (Number(process.env.MWZ_REPORT_SEC) || 20) * 1e3;   // 재접속 대기 · 결과 한쪽만 왔을 때 기다리는 시간 (테스트에서 줄임)
const ROOM_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeWs(db) {
  let nextId = 1;
  const conns = new Set(), waiting = new Map(), rooms = new Map(), matches = new Map();

  // ---------- 프레임
  const frame = (op, body) => {
    const n = body.length; let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    return Buffer.concat([head, body]);
  };
  const send = (c, obj) => { if (c && !c.closed) try { c.sock.write(frame(1, Buffer.from(JSON.stringify(obj)))); } catch (e) { drop(c); } };
  function parse(c) {   // 받은 바이트에서 완성된 프레임을 꺼냄 (조각난 메시지도 이어 붙임)
    for (;;) {
      const b = c.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > MAX_FRAME) return drop(c, 'bad_frame');   // 브라우저 → 서버 프레임은 반드시 마스킹
      const need = off + 4 + len; if (b.length < need) return;
      const m = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, need)); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3];
      c.buf = b.subarray(need); c.lastRx = Date.now();
      if (op === 8) return drop(c);
      if (op === 9) { try { c.sock.write(frame(10, data)); } catch (e) {} continue; }
      if (op === 10) continue;   // pong
      if (op === 1 || op === 0) {
        c.frag = op === 1 ? [data] : [...(c.frag || []), data];
        if (c.frag.reduce((a, x) => a + x.length, 0) > MAX_FRAME) return drop(c, 'too_large');
        if (fin) {
          const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = null;
          const sec = Math.floor(Date.now() / 1000); if (c.rateSec !== sec) { c.rateSec = sec; c.rateN = 0; }
          if (++c.rateN > MSG_PER_SEC) return drop(c, 'flood');
          let msg; try { msg = JSON.parse(txt); } catch (e) { continue; }
          if (msg && typeof msg === 'object') try { onMessage(c, msg); } catch (e) { log('WS 처리 오류', { err: String(e.stack || e).slice(0, 300) }); }
        }
      }
    }
  }

  // ---------- 접속 · 종료
  function upgrade(req, sock, allowOrigin) {
    if (!req.headers['sec-websocket-key'] || !allowOrigin(req)) { sock.destroy(); return; }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.setNoDelay(true);
    const c = { id: nextId++, sock, buf: Buffer.alloc(0), name: '게스트', nation: 'ROK', acc: null, seek: null, room: null, match: null, role: null, closed: false, lastRx: Date.now() };
    conns.add(c);
    sock.on('data', d => { c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d; parse(c); });
    sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
  }
  function drop(c, why) {
    if (c.closed) return; c.closed = true; conns.delete(c);
    unqueue(c); closeRoom(c);
    const m = c.match; if (m && !m.done) away(m, c.role);
    try { c.sock.destroy(); } catch (e) {}
    if (why) log('연결 끊음', { id: c.id, why });
  }
  setInterval(() => {   // 하트비트: 15초마다 ping, 45초 동안 아무 응답 없으면 끊음
    const now = Date.now();
    for (const c of conns) { if (now - c.lastRx > 45e3) drop(c, 'timeout'); else try { c.sock.write(frame(9, Buffer.alloc(0))); } catch (e) { drop(c); } }
    for (const [code, r] of rooms) if (now - r.created > ROOM_TTL) { send(r.c, { t: 'error', code: 'room_expired', message: '방이 만료되었습니다' }); r.c.room = null; rooms.delete(code); }
  }, 15e3).unref();

  // ---------- 매칭 대기열 · 친구 방
  function unqueue(c) { if (!c.seek) return; const q = waiting.get(c.seek.map) || []; waiting.set(c.seek.map, q.filter(x => x !== c)); c.seek = null; }
  function closeRoom(c) { if (c.room) { rooms.delete(c.room); c.room = null; } }
  const roomCode = () => { for (;;) { const b = crypto.randomBytes(6); let s = ''; for (let i = 0; i < 6; i++) s += ROOM_ABC[b[i] & 31]; if (!rooms.has(s)) return s; } };
  const cleanMap = s => String(s || 'plains@destroy').replace(/[^\w@-]/g, '').slice(0, 40) || 'plains@destroy';

  function startMatch(host, guest, map, seed, ranked) {
    unqueue(host); unqueue(guest); closeRoom(host); closeRoom(guest);
    const rated = !!(ranked && host.acc && guest.acc && host.acc.id !== guest.acc.id);
    const m = { id: token(9), map, seed, rated, done: false, conns: { host, guest }, acc: { host: host.acc && host.acc.id, guest: guest.acc && guest.acc.id },
                keys: { host: token(16), guest: token(16) }, reports: {}, timers: {}, names: { host: host.name, guest: guest.name } };
    matches.set(m.id, m);
    for (const [r, c] of [['host', host], ['guest', guest]]) { c.match = m; c.role = r; }
    db.startMatch(m.id, m.acc.host, m.acc.guest, map, rated);
    const rt = c => c.acc ? db.rating(c.acc.id).rating : null;
    for (const [r, c, o] of [['host', host, guest], ['guest', guest, host]])
      send(c, { t: 'matched', role: r, map, seed, matchId: m.id, key: m.keys[r], rated, opp: o.name, oppNation: o.nation, oppRating: rt(o), myRating: rt(c) });
    log('매칭', { match: m.id, map, rated, host: host.name, guest: guest.name });
  }
  const other = r => r === 'host' ? 'guest' : 'host';

  // ---------- 결과 합의 · 몰수 · 재접속
  function finish(m, result, why) {
    if (m.done) return; m.done = true;
    for (const k in m.timers) clearTimeout(m.timers[k]);
    const d = db.finishMatch({ id: m.id, rated: m.rated, hostId: m.acc.host, guestId: m.acc.guest }, result);
    log('대전 종료', { match: m.id, result, why });
    for (const r of ['host', 'guest']) {
      const c = m.conns[r]; if (!c || c.closed) continue;
      if (m.rated && result !== 'void' && m.acc[r]) { const R = db.rating(m.acc[r]); send(c, { t: 'rated', matchId: m.id, result: result === 'draw' ? 'draw' : result === r ? 'win' : 'lose', delta: r === 'host' ? d.hostDelta : d.guestDelta, season: R.season, rating: R.rating, peak: R.peak, w: R.w, l: R.l, d: R.d }); }
      else send(c, { t: 'rated', matchId: m.id, result: result === 'void' ? 'void' : result === 'draw' ? 'draw' : result === r ? 'win' : 'lose', delta: null, unrated: true });
    }
    setTimeout(() => { matches.delete(m.id); for (const r of ['host', 'guest']) { const c = m.conns[r]; if (c && c.match === m) c.match = null; } }, 60e3).unref();
  }
  function report(m, role, win) {   // 각자 자기 기준 승패를 보냄 → 둘이 맞으면 반영, 다르면 무효
    if (m.done || role in m.reports) return;
    m.reports[role] = win === true ? role : win === false ? other(role) : 'draw';
    const a = m.reports.host, b = m.reports.guest;
    if (a !== undefined && b !== undefined) return finish(m, a === b ? a : 'void', a === b ? 'agreed' : 'disagree');
    const o = other(role), oc = m.conns[o];
    if (!oc || oc.closed) return finish(m, m.reports[role], 'single_report');
    m.timers.report = setTimeout(() => finish(m, m.reports[role], 'report_timeout'), REPORT_WAIT);
  }
  function away(m, role) {   // 대전 중 연결이 끊김 → 30초 재접속 대기, 지나면 몰수패
    const o = other(role), oc = m.conns[o];
    m.conns[role] = null;
    if (role in m.reports) { if (!(o in m.reports) && (!oc || oc.closed)) finish(m, m.reports[role], 'both_gone'); return; }
    if (!oc || oc.closed) return finish(m, 'void', 'both_gone');
    send(oc, { t: 'peer_wait', sec: RESUME_SEC });
    m.timers[role] = setTimeout(() => { if (m.conns[role] || m.done) return; send(m.conns[o], { t: 'peer_left' }); finish(m, o, 'forfeit_timeout'); }, RESUME_SEC * 1e3);
  }

  // ---------- 메시지
  function onMessage(c, m) {
    switch (m.t) {
      case 'hello': {
        c.name = cleanName(m.name) || '게스트'; c.nation = cleanNation(m.nation);
        const a = m.token ? db.auth(String(m.token)) : null; c.acc = a || null;
        if (a) c.name = a.name;
        send(c, { t: 'welcome', id: c.id, rated: !!a, name: c.name, rating: a ? db.rating(a.id) : null });
        lobbyTick(); break;
      }
      case 'seek': {   // 같은 지도를 기다리는 사람이 있으면 바로 매칭 (먼저 온 사람이 호스트)
        if (c.match && !c.match.done) return;
        unqueue(c); closeRoom(c);
        const map = cleanMap(m.map), q = waiting.get(map) || [], host = q.find(x => x !== c && !x.closed);
        if (host) startMatch(host, c, map, host.seek.seed, true);
        else { c.seek = { map, seed: Number(m.seed) | 0 || 1 }; q.push(c); waiting.set(map, q); }
        lobbyTick(); break;
      }
      case 'cancel': unqueue(c); closeRoom(c); lobbyTick(); break;
      case 'room_create': {   // 친구 대전: 6자리 방 코드 (순위에 반영되지 않음)
        if (c.match && !c.match.done) return;
        unqueue(c); closeRoom(c);
        const code = roomCode(); c.room = code; rooms.set(code, { c, map: cleanMap(m.map), seed: Number(m.seed) | 0 || 1, created: Date.now() });
        send(c, { t: 'room', code, map: cleanMap(m.map) }); break;
      }
      case 'room_join': {
        const code = normCode(m.code).slice(0, 6), r = rooms.get(code);
        if (!r || r.c.closed || r.c === c) { send(c, { t: 'error', code: 'room_not_found', message: '방을 찾을 수 없습니다. 코드를 확인하세요' }); break; }
        startMatch(r.c, c, r.map, r.seed, false); lobbyTick(); break;
      }
      case 'relay': { const mt = c.match; if (mt && !mt.done) send(mt.conns[other(c.role)], { t: 'relay', d: m.d }); break; }
      case 'result': { const mt = c.match; if (mt && (!m.matchId || m.matchId === mt.id)) report(mt, c.role, m.win === true ? true : m.win === false ? false : null); break; }
      case 'leave': {   // 대전 도중 나가기 · 항복 → 몰수패
        const mt = c.match; if (mt && !mt.done && !(c.role in mt.reports)) { send(mt.conns[other(c.role)], { t: 'peer_left' }); finish(mt, other(c.role), 'leave'); }
        c.match = null; lobbyTick(); break;
      }
      case 'done': c.match = null; lobbyTick(); break;   // 정상 종료 후 대기실로
      case 'resume': {   // 끊긴 대전에 다시 들어가기
        const mt = matches.get(String(m.matchId || '')), role = mt && ['host', 'guest'].find(r => mt.keys[r] === m.key);
        if (!mt || !role || mt.done || mt.conns[role]) { send(c, { t: 'resume_fail' }); break; }
        clearTimeout(mt.timers[role]); mt.conns[role] = c; c.match = mt; c.role = role;
        if (!c.acc && mt.acc[role]) c.acc = { id: mt.acc[role] };
        send(c, { t: 'resumed', matchId: mt.id, role }); send(mt.conns[other(role)], { t: 'peer_back' });
        log('재접속', { match: mt.id, role }); break;
      }
    }
  }
  function lobbyTick() {   // 로비 현황: 지도별 대기 인원, 접속자, 대전 중 인원
    const counts = {};
    for (const [map, q] of waiting) if (q.length) counts[map] = q.length;
    const playing = [...conns].filter(c => c.match && !c.match.done).length;
    for (const c of conns) if (!c.match || c.match.done) send(c, { t: 'lobby', counts, online: conns.size, playing });
  }
  setInterval(lobbyTick, 2000).unref();

  return {
    upgrade, online: () => conns.size,
    kick(accId) { for (const c of conns) if (c.acc && c.acc.id === accId) { c.acc = null; drop(c, 'account_deleted'); } },
    closeAll() { for (const c of conns) drop(c); },
  };
}
module.exports = { makeWs };
