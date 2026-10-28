// 미니워존 백엔드: 게임 파일 제공 + REST API(계정 · 클라우드 저장 · 순위표) + PVP 매칭/중계(WebSocket)
// 실행: node server.js  →  http://localhost:8080      테스트: node --test
// 외부 패키지 없이 Node.js 기본 모듈만 사용 (Node 22.5 이상: 내장 SQLite)
//
// 환경 변수
//   PORT=8080                  접속 포트
//   DB_PATH=./data/miniwarzone.db   SQLite 파일 위치 (':memory:' = 저장 안 함, 테스트용)
//   TRUST_PROXY=1              리버스 프록시 뒤에서 X-Forwarded-For로 실제 IP 확인
//   ALLOWED_ORIGINS=https://a.com,https://b.com   다른 도메인에서 WebSocket 접속 허용 (기본: 같은 주소만)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { log } = require('./backend/util');
const { open } = require('./backend/db');
const { makeApi } = require('./backend/api');
const { makeWs } = require('./backend/ws');

const VERSION = '2026.10.2';
const ROOT = __dirname;
// 공개하는 파일만 명시 (기획서 · 백업 · 서버 코드 · DB는 절대 내보내지 않음)
const PUBLIC = { '/': 'index.html', '/index.html': 'index.html' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function createServer(opts = {}) {
  const db = open(opts.dbPath || process.env.DB_PATH || path.join(ROOT, 'data', 'miniwarzone.db'));
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === '1';
  const allowed = new Set(String(opts.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const ipOf = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const allowOrigin = req => {   // 다른 사이트가 이용자 브라우저로 몰래 접속하는 것을 막음
    const o = req.headers.origin; if (!o) return true;
    try { return new URL(o).host === req.headers.host || allowed.has(o); } catch (e) { return false; }
  };
  let ws;
  const api = makeApi(db, { version: VERSION, online: () => ws.online(), kick: id => ws.kick(id) });
  ws = makeWs(db);
  const cache = new Map();
  const server = http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let url; try { url = new URL(req.url || '/', 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && !allowOrigin(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"error":"origin"}'); }
      return api(req, res, url, ipOf(req));
    }
    const name = PUBLIC[url.pathname];
    if (!name || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const resolved = path.join(ROOT, name);
    const send = data => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    };
    if (cache.has(resolved) && !opts.noCache) return send(cache.get(resolved));
    fs.readFile(resolved, (err, data) => {
      if (err) { res.writeHead(500); return res.end(); }
      if (process.env.NODE_ENV === 'production') cache.set(resolved, data);
      send(data);
    });
  });
  server.on('upgrade', (req, sock) => { if ((req.url || '').split('?')[0] !== '/ws') return sock.destroy(); ws.upgrade(req, sock, allowOrigin); });
  server.headersTimeout = 15e3; server.requestTimeout = 30e3;
  const close = () => new Promise(r => { ws.closeAll(); server.close(() => { db.close(); r(); }); });
  return { server, db, close };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 8080;
  const { server, close } = createServer();
  server.listen(PORT, () => {
    const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    log(`미니워존 서버 v${VERSION} 실행 중 → http://localhost:${PORT}`);
    for (const ip of ips) log(`  같은 네트워크의 다른 PC: http://${ip}:${PORT}`);
  });
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { if (stopping) return; stopping = true; log(`${sig} — 서버를 안전하게 끄는 중`); await close(); process.exit(0); });
}
module.exports = { createServer, VERSION };
