// 미니워존 백엔드: 게임 파일 제공 + PVP 매칭/중계 (WebSocket)
// 실행: node server.js  →  http://localhost:8080
// 외부 패키지 없이 Node.js 기본 모듈만 사용한다.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

// ---------- 정적 파일
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || path.basename(file) === 'server.js') { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSocket (RFC 6455) 최소 구현
let nextId = 1;
const clients = new Set();
function wsFrame(str) {
  const body = Buffer.from(str), n = body.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, body]);
}
function send(c, obj) { if (!c.closed) try { c.sock.write(wsFrame(JSON.stringify(obj))); } catch (e) { drop(c); } }
function parseFrames(c) {   // 받은 바이트에서 완성된 프레임을 꺼냄 (조각난 메시지도 이어 붙임)
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > 4 * 1024 * 1024) return drop(c);
    const need = off + (masked ? 4 : 0) + len; if (b.length < need) return;
    let data = b.subarray(off + (masked ? 4 : 0), need);
    if (masked) { const m = b.subarray(off, off + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3]; }
    c.buf = b.subarray(need);
    if (op === 8) return drop(c);
    if (op === 9) { try { c.sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (e) {} continue; }
    if (op === 1 || op === 0) {
      c.frag = op === 1 ? [data] : [...(c.frag || []), data];
      if (fin) { const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = null; let m; try { m = JSON.parse(txt); } catch (e) { continue; } onMessage(c, m); }
    }
  }
}
server.on('upgrade', (req, sock) => {
  if ((req.url || '').split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) return sock.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const c = { id: nextId++, sock, buf: Buffer.alloc(0), name: '게스트', seek: null, peer: null, closed: false };
  clients.add(c);
  sock.on('data', d => { c.buf = Buffer.concat([c.buf, d]); parseFrames(c); });
  sock.on('close', () => drop(c)); sock.on('error', () => drop(c));
  log(`접속 #${c.id} (${clients.size}명)`);
});

// ---------- 로비 · 매칭 · 중계
const waiting = new Map();   // 지도 id → 기다리는 지휘관 목록 (먼저 온 순서)
function unqueue(c) { if (!c.seek) return; const q = waiting.get(c.seek.map) || []; waiting.set(c.seek.map, q.filter(x => x !== c)); c.seek = null; }
function unpair(c, notify) { const p = c.peer; c.peer = null; if (p && p.peer === c) { p.peer = null; if (notify) send(p, { t: 'peer_left' }); } }
function drop(c) {
  if (c.closed) return; c.closed = true; clients.delete(c);
  unqueue(c); unpair(c, true);
  try { c.sock.destroy(); } catch (e) {}
  log(`퇴장 #${c.id} (${clients.size}명)`);
}
function onMessage(c, m) {
  switch (m.t) {
    case 'hello': c.name = String(m.name || '게스트').slice(0, 12); c.nation = String(m.nation || 'ROK').slice(0, 6); lobbyTick(); break;
    case 'seek': {   // 같은 지도를 기다리는 사람이 있으면 바로 매칭 (먼저 온 사람이 호스트)
      if (c.peer) return;
      unqueue(c);
      const map = String(m.map || 'plains').slice(0, 40), q = waiting.get(map) || [];
      const host = q.find(x => x !== c && !x.closed);
      if (host) {
        waiting.set(map, q.filter(x => x !== host)); const seed = host.seek.seed; host.seek = null;
        host.peer = c; c.peer = host;
        send(host, { t: 'matched', role: 'host', map, seed, opp: c.name, oppNation: c.nation });
        send(c, { t: 'matched', role: 'guest', map, seed, opp: host.name, oppNation: host.nation });
        log(`매칭: ${host.name} vs ${c.name} @ ${map}`);
      } else { c.seek = { map, seed: Number(m.seed) || 1 }; q.push(c); waiting.set(map, q); }
      lobbyTick(); break;
    }
    case 'cancel': unqueue(c); lobbyTick(); break;
    case 'relay': if (c.peer) send(c.peer, { t: 'relay', d: m.d }); break;   // 호스트↔게스트 사이 전달 (상태·명령)
    case 'leave': unpair(c, true); lobbyTick(); break;
    case 'done': unpair(c, false); lobbyTick(); break;
  }
}
function lobbyTick() {   // 로비 현황: 지도별 대기 인원, 접속자, 대전 중 인원
  const counts = {};
  for (const [map, q] of waiting) if (q.length) counts[map] = q.length;
  const playing = [...clients].filter(c => c.peer).length;
  for (const c of clients) if (!c.peer) send(c, { t: 'lobby', counts, online: clients.size, playing });
}
setInterval(lobbyTick, 2000);
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

server.listen(PORT, () => {
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`미니워존 서버 실행 중 → http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  같은 네트워크의 다른 PC: http://${ip}:${PORT}`);
});
