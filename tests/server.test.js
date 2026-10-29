// 백엔드 통합 테스트: node --test
'use strict';
process.env.MWZ_RESUME_SEC = '1'; process.env.MWZ_REPORT_SEC = '1'; process.env.MWZ_CREATE_PER_MIN = '1000';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../server/server');

let srv, base, wsBase;
before(async () => { srv = createServer({ dbPath: ':memory:' }); await new Promise(r => srv.server.listen(0, r)); const p = srv.server.address().port; base = `http://127.0.0.1:${p}`; wsBase = `ws://127.0.0.1:${p}/ws`; });
after(() => srv.close());

const req = async (method, path, body, tok, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
  return { status: r.status, body: j };
};
const account = async name => (await req('POST', '/api/account', { name, nation: 'ROK' })).body;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 테스트용 WebSocket 클라이언트: 받은 메시지를 모아 두고 원하는 종류를 기다림
async function client(hello) {
  const ws = new WebSocket(wsBase), box = [], waiters = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); box.push(m); for (const w of [...waiters]) if (w.t === m.t) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const C = { ws, box, send: m => ws.send(JSON.stringify(m)),
    wait: (t, ms = 3000) => { const i = box.findIndex(m => m.t === t); if (i >= 0) return Promise.resolve(box.splice(i, 1)[0]);
      return new Promise((r, j) => { const w = { t, r: m => { box.splice(box.indexOf(m), 1); r(m); } }; waiters.push(w); setTimeout(() => j(new Error('timeout waiting ' + t)), ms); }); },
    close: () => new Promise(r => { ws.onclose = r; ws.close(); }) };
  if (hello) { C.send({ t: 'hello', ...hello }); await C.wait('welcome'); }
  return C;
}
async function pair(a, b, map) { a.send({ t: 'seek', map, seed: 7 }); await sleep(50); b.send({ t: 'seek', map, seed: 9 }); return [await a.wait('matched'), await b.wait('matched')]; }

test('상태 확인 · 공개 파일 제한 · 보안 헤더', async () => {
  const h = await req('GET', '/api/health'); assert.equal(h.status, 200); assert.equal(h.body.ok, true);
  for (const p of ['/gameplan.md', '/server.js', '/backend/db.js', '/data/miniwarzone.db', '/../server.js', '/index_v34.html', '/README.md', '/package.json']) assert.equal((await fetch(base + p)).status, 404, p);
  const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /default-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('회원: 중복확인 · 가입 · 로그인 · 저장 공유 · 로그아웃 · 아이디 붙이기', async () => {
  assert.deepEqual((await req('GET', '/api/signup/check?login=Bad!')).body, { valid: false, available: false });
  assert.deepEqual((await req('GET', '/api/signup/check?login=member01')).body, { valid: true, available: true });
  assert.equal((await req('POST', '/api/signup', { login: 'member01', password: 'short', name: '철수', nation: 'ROK' })).status, 400);
  assert.equal((await req('POST', '/api/signup', { login: '한글아이디', password: 'abc123!', name: '철수' })).status, 400);
  const s = await req('POST', '/api/signup', { login: 'member01', password: 'abc123!x', name: '철수', nation: 'DEU' });
  assert.equal(s.status, 201); assert.equal(s.body.login, 'member01'); assert.ok(s.body.token && s.body.code);
  assert.equal((await req('POST', '/api/signup', { login: 'member01', password: 'abc123!x', name: '영희' })).status, 409);
  assert.deepEqual((await req('GET', '/api/signup/check?login=member01')).body, { valid: true, available: false });
  const row = srv.db.raw.prepare('SELECT pw_hash FROM accounts WHERE login = ?').get('member01');
  assert.match(row.pw_hash, /^s1\$/); assert.ok(!row.pw_hash.includes('abc123'));   // 비밀번호는 해시만
  assert.equal((await req('PUT', '/api/save', { rev: 0, data: { rec: { gold: 77 } } }, s.body.token)).status, 200);
  assert.equal((await req('POST', '/api/login', { login: 'member01', password: 'wrong1!' })).status, 401);
  assert.equal((await req('POST', '/api/login', { login: 'nobody99', password: 'abc123!x' })).status, 401);
  const l = await req('POST', '/api/login', { login: 'member01', password: 'abc123!x' });   // 다른 기기에서 로그인 → 같은 저장
  assert.equal(l.status, 200); assert.equal(l.body.name, '철수'); assert.equal(l.body.nation, 'DEU'); assert.equal(l.body.pw_hash, undefined);
  assert.equal((await req('GET', '/api/save', undefined, l.body.token)).body.data.rec.gold, 77);
  assert.equal((await req('GET', '/api/me', undefined, l.body.token)).body.login, 'member01');
  assert.equal((await req('POST', '/api/logout', undefined, l.body.token)).status, 200);
  assert.equal((await req('GET', '/api/me', undefined, l.body.token)).status, 401);   // 로그아웃한 토큰은 끝
  assert.equal((await req('GET', '/api/me', undefined, s.body.token)).status, 200);   // 다른 기기 세션은 그대로
  const old = await account('예전지휘관');   // 복구 코드 계정 → 아이디 붙이기
  assert.equal((await req('POST', '/api/me/login', { login: 'member01', password: 'abc123!x' }, old.token)).status, 409);
  assert.equal((await req('POST', '/api/me/login', { login: 'oldacc01', password: 'abc123!x' }, old.token)).status, 200);
  assert.equal((await req('POST', '/api/me/login', { login: 'oldacc02', password: 'abc123!x' }, old.token)).status, 409);
  assert.equal((await req('POST', '/api/login', { login: 'oldacc01', password: 'abc123!x' })).body.name, '예전지휘관');
});

test('예전 회원 주소는 게임 안 탭으로 넘김 · 나머지는 차단', async () => {
  for (const [p, tab] of [['/member/', 'login'], ['/member/login.html', 'login'], ['/member/signup.html', 'signup']]) {
    const r = await fetch(base + p); assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), /^text\/html/, p);
    assert.match(await r.text(), new RegExp(`url=\\.\\./\\?auth=${tab}`), p);
  }
  for (const p of ['/member/README.md', '/member/auth.js', '/member', '/member/../server.js']) assert.equal((await fetch(base + p)).status, 404, p);
});

test('계정 · 클라우드 저장 · 충돌 · 복구 코드 · 삭제', async () => {
  const a = await account('  한국<b>지휘관이름이너무길다  ');
  assert.equal(a.name, '한국b지휘관이름이너무길'); assert.match(a.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await req('GET', '/api/me')).status, 401);
  assert.equal((await req('GET', '/api/me', undefined, a.token)).body.rating.rating, 1000);
  assert.equal((await req('GET', '/api/save', undefined, a.token)).status, 404);
  const data = { rec: { xp: 1234, stats: { bestScore: 5000 }, slots: [{ nation: 'ROK', owner: { a: 'ROK', b: 'ROK', c: 'DPRK' }, cleared: [] }] }, profile: { nation: 'ROK' } };
  const s1 = await req('PUT', '/api/save', { rev: 0, data }, a.token); assert.equal(s1.status, 200); assert.equal(s1.body.rev, 1);
  const s2 = await req('PUT', '/api/save', { rev: 0, data: { rec: {} } }, a.token); assert.equal(s2.status, 409); assert.equal(s2.body.rev, 1); assert.equal(s2.body.data.rec.xp, 1234);
  assert.equal((await req('PUT', '/api/save', { rev: 1, data }, a.token)).body.rev, 2);
  const lb = await req('GET', '/api/leaderboard?type=xp'); assert.equal(lb.body.rows[0].value, 1234);
  assert.equal((await req('GET', '/api/leaderboard?type=regions')).body.rows[0].value, 2);
  // 복구 코드: 소문자 · 대시 없이도 됨 → 새 토큰으로 같은 저장 데이터
  const rc = await req('POST', '/api/account/recover', { code: a.code.toLowerCase().replace(/-/g, '') }); assert.equal(rc.status, 200); assert.notEqual(rc.body.token, a.token);
  assert.equal((await req('GET', '/api/save', undefined, rc.body.token)).body.rev, 2);
  assert.equal((await req('POST', '/api/account/recover', { code: 'AAAA-BBBB-CCCC' })).status, 404);
  const nc = await req('POST', '/api/account/code', {}, a.token); assert.notEqual(nc.body.code, a.code);
  assert.equal((await req('POST', '/api/account/recover', { code: a.code })).status, 404, '예전 복구 코드는 무효');
  assert.equal((await req('PATCH', '/api/me', { name: '새이름' }, a.token)).body.name, '새이름');
  assert.equal((await req('DELETE', '/api/me', undefined, a.token)).status, 200);
  assert.equal((await req('GET', '/api/me', undefined, rc.body.token)).status, 401, '삭제 후 모든 세션 무효');
});

test('입력 검증 · 크기 제한 · 경로 · 출처', async () => {
  const a = await account('검증');
  assert.equal((await req('POST', '/api/account', { name: '' })).status, 400);
  assert.equal((await req('POST', '/api/account', '{bad')).status, 400);
  assert.equal((await fetch(base + '/api/account', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await req('PUT', '/api/save', { rev: 0, data: [1] }, a.token)).status, 400);
  assert.equal((await req('PUT', '/api/save', { rev: 0, data: { big: 'x'.repeat(600 * 1024) } }, a.token)).status, 413);
  assert.equal((await req('GET', '/api/nope')).status, 404); assert.equal((await req('DELETE', '/api/health')).status, 405);
  assert.equal((await req('GET', '/api/leaderboard?type=hack')).status, 400);
  assert.equal((await req('GET', '/api/health', undefined, null, { Origin: 'https://evil.example' })).status, 403);
  // 다른 사이트 출처의 WebSocket 접속 거부
  const port = srv.server.address().port;
  const status = await new Promise(r => { const q = http.request({ port, host: '127.0.0.1', path: '/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', Origin: 'https://evil.example' } });
    q.on('upgrade', () => r(101)); q.on('error', () => r('closed')); q.on('response', res => r(res.statusCode)); q.end(); });
  assert.equal(status, 'closed');
});

test('순위전: 매칭 · 중계 · 결과 합의 → 레이팅', async () => {
  const A = await account('알파'), B = await account('브라보');
  const a = await client({ name: 'x', token: A.token }), b = await client({ name: 'y', token: B.token });
  const [ma, mb] = await pair(a, b, 'plains@destroy');
  assert.equal(ma.role, 'host'); assert.equal(mb.role, 'guest'); assert.equal(ma.rated, true); assert.equal(ma.opp, '브라보'); assert.equal(ma.seed, 7);
  a.send({ t: 'relay', d: { k: 'snap', n: 1 } }); assert.equal((await b.wait('relay')).d.n, 1);
  a.send({ t: 'result', matchId: ma.matchId, win: true }); b.send({ t: 'result', matchId: mb.matchId, win: false });
  const [ra, rb] = [await a.wait('rated'), await b.wait('rated')];
  assert.equal(ra.result, 'win'); assert.equal(ra.delta, 16); assert.equal(ra.rating, 1016); assert.equal(rb.delta, -16); assert.equal(rb.l, 1);
  const lb = await req('GET', '/api/leaderboard?type=pvp'); assert.equal(lb.body.rows[0].name, '알파'); assert.equal(lb.body.rows[0].value, 1016);
  // 결과가 엇갈리면 무효
  a.send({ t: 'done' }); b.send({ t: 'done' });
  const [m2a, m2b] = await pair(a, b, 'snow@koth');
  a.send({ t: 'result', win: true }); b.send({ t: 'result', win: true });
  assert.equal((await a.wait('rated')).result, 'void'); assert.equal((await b.wait('rated')).result, 'void');
  assert.equal((await req('GET', '/api/me', undefined, A.token)).body.rating.rating, 1016);
  await a.close(); await b.close();
});

test('친구 방 코드 (순위 미반영) · 잘못된 코드', async () => {
  const a = await client({ name: '방장' }), b = await client({ name: '손님' });
  a.send({ t: 'room_create', map: 'desert@ctf', seed: 3 }); const room = await a.wait('room'); assert.match(room.code, /^[A-Z2-9]{6}$/);
  b.send({ t: 'room_join', code: 'ZZZZZZ' }); assert.equal((await b.wait('error')).code, 'room_not_found');
  b.send({ t: 'room_join', code: room.code.toLowerCase() });
  const [ma, mb] = [await a.wait('matched'), await b.wait('matched')];
  assert.equal(ma.rated, false); assert.equal(mb.map, 'desert@ctf'); assert.equal(mb.seed, 3);
  await a.close(); await b.close();
});

test('대전 중 끊김 → 재접속 / 시간 초과 몰수패 / 나가기', async () => {
  const A = await account('재접속'), B = await account('대기');
  let a = await client({ token: A.token }); const b = await client({ token: B.token });
  const [ma] = await pair(a, b, 'jungle@basecap');
  await a.close(); assert.equal((await b.wait('peer_wait')).sec, 1);
  a = await client(); a.send({ t: 'resume', matchId: ma.matchId, key: 'wrong' }); await a.wait('resume_fail');
  a.send({ t: 'resume', matchId: ma.matchId, key: ma.key }); assert.equal((await a.wait('resumed')).role, 'host'); await b.wait('peer_back');
  a.send({ t: 'relay', d: { k: 'snap' } }); await b.wait('relay');
  // 다시 끊기고 1초 안에 안 돌아오면 남은 쪽 승리
  await a.close(); await b.wait('peer_wait'); await b.wait('peer_left', 3000);
  const r = await b.wait('rated'); assert.equal(r.result, 'win'); assert.ok(r.delta > 0);
  // 나가기(항복) = 몰수패
  b.send({ t: 'done' }); const c = await client({ token: A.token });
  await pair(c, b, 'plains@crates'); c.send({ t: 'leave' });
  await b.wait('peer_left'); assert.equal((await b.wait('rated')).result, 'win');
  await b.close(); await c.close();
});

test('복구 코드 무차별 대입은 요청 제한(429)', async () => {
  const codes = []; for (let i = 0; i < 8; i++) codes.push((await req('POST', '/api/account/recover', { code: 'ZZZZ-ZZZZ-ZZZ' + i })).status);
  assert.ok(codes.includes(429), codes.join());
});

test('메시지 폭주 연결은 끊음', async () => {
  const a = await client({ name: '폭주' });
  const closed = new Promise(r => { a.ws.onclose = r; });
  for (let i = 0; i < 400; i++) a.send({ t: 'cancel' });
  await closed;
});
