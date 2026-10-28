// REST API: 계정 · 클라우드 저장 · 순위표 · 상태 확인
'use strict';
const { cleanName, cleanNation, cleanLogin, PW_RE, hashPw, checkPw, seasonId, limiter, log } = require('./util');

const MAX_SAVE = 512 * 1024;   // 저장 데이터 최대 512KB
const CREATE_PER_MIN = Number(process.env.MWZ_CREATE_PER_MIN) || 6;   // IP당 계정 생성 (테스트에서 늘림)
const lim = { api: limiter(120, 60), create: limiter(CREATE_PER_MIN, CREATE_PER_MIN), recover: limiter(10, 5), save: limiter(30, 10), check: limiter(30, 15), login: limiter(10, 6) };   // login: IP당 비밀번호 시도

class HttpError extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }
function readJson(req, max) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'json_only', 'Content-Type: application/json 이어야 합니다'));
    let size = 0, over = false; const parts = [];
    req.on('data', d => {   // 너무 크면 더 모으지 않고 413 응답 (나머지는 흘려보냄 · 아주 크면 연결 끊음)
      size += d.length; if (over) { if (size > max * 8) req.destroy(); return; }
      if (size > max) { over = true; parts.length = 0; reject(new HttpError(413, 'too_large')); } else parts.push(d);
    });
    req.on('end', () => { if (over) return; try { const v = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; resolve(v); } catch (e) { reject(new HttpError(400, 'bad_json')); } });
    req.on('error', reject);
  });
}
const bearer = req => { const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || ''); return m ? m[1] : null; };
const clampInt = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
// 저장 데이터에서 순위표용 값만 뽑음 (값 범위를 제한해 비정상 기록이 순위를 망치지 않게)
function statsOf(data) {
  const rec = data.rec || {};
  const regions = (rec.slots || []).reduce((m, s) => Math.max(m, s && s.owner && s.nation ? Object.values(s.owner).filter(o => o === s.nation).length + (s.cleared || []).length * 10 : 0), 0);
  return { xp: clampInt(rec.xp, 1e7), bestScore: clampInt(rec.stats && rec.stats.bestScore, 1e7), regions: clampInt(regions, 1000) };
}
const pub = a => ({ id: a.id, name: a.name, nation: a.nation, created: a.created, login: a.login || null });
function needLogin(b) {   // 회원가입 · 아이디 붙이기 공통 입력 검사
  const login = cleanLogin(b.login); if (!login) throw new HttpError(400, 'bad_login', '아이디는 6~20자 영문 소문자 + 숫자 조합입니다');
  if (typeof b.password !== 'string' || !PW_RE.test(b.password)) throw new HttpError(400, 'bad_password', '비밀번호는 영문 · 숫자 · 특수문자 조합 6자리 이상입니다');
  return login;
}

function makeApi(db, ctx) {
  const routes = {
    'GET /api/health': () => ({ ok: true, version: ctx.version, uptime: Math.round(process.uptime()), season: seasonId(), online: ctx.online(), ...db.counts() }),
    'POST /api/account': async (req, ip) => {
      if (!lim.create(ip)) throw new HttpError(429, 'rate_limited', '계정은 잠시 뒤에 다시 만들 수 있습니다');
      const b = await readJson(req, 4096), name = cleanName(b.name); if (!name) throw new HttpError(400, 'bad_name', '지휘관 이름이 필요합니다');
      const r = db.createAccount(name, cleanNation(b.nation));
      log('계정 생성', { id: r.id });
      return [201, { id: r.id, token: r.token, code: r.code, name, nation: cleanNation(b.nation) }];
    },
    'POST /api/account/recover': async (req, ip) => {
      if (!lim.recover(ip)) throw new HttpError(429, 'rate_limited', '시도가 너무 많습니다. 잠시 뒤에 다시 하세요');
      const b = await readJson(req, 1024), r = db.recover(b.code);
      if (!r) throw new HttpError(404, 'bad_code', '복구 코드가 맞지 않습니다');
      return { ...pub(r.account), token: r.token };
    },
    'POST /api/account/code': (req, ip, acc) => ({ code: db.newCode(acc.id) }),
    // ---- 회원: 아이디 · 비밀번호 (게임 화면의 로그인 · 회원가입)
    'GET /api/signup/check': (req, ip, acc, url) => {
      if (!lim.check(ip)) throw new HttpError(429, 'rate_limited', '잠시 뒤에 다시 확인하세요');
      const login = cleanLogin(url.searchParams.get('login'));
      return { valid: !!login, available: !!login && !db.byLogin(login) };
    },
    'POST /api/signup': async (req, ip) => {
      if (!lim.create(ip)) throw new HttpError(429, 'rate_limited', '계정은 잠시 뒤에 다시 만들 수 있습니다');
      const b = await readJson(req, 4096), login = needLogin(b), name = cleanName(b.name); if (!name) throw new HttpError(400, 'bad_name', '지휘관 이름이 필요합니다');
      const r = db.signup(name, cleanNation(b.nation), login, await hashPw(b.password));
      if (!r) throw new HttpError(409, 'login_taken', '이미 사용 중인 아이디입니다');
      log('회원가입', { id: r.id });
      return [201, { id: r.id, token: r.token, code: r.code, name, nation: cleanNation(b.nation), login }];
    },
    'POST /api/login': async (req, ip) => {
      if (!lim.login(ip)) throw new HttpError(429, 'rate_limited', '시도가 너무 많습니다. 잠시 뒤에 다시 하세요');
      const b = await readJson(req, 1024), a = db.byLogin(cleanLogin(b.login) || '');
      const ok = await checkPw(typeof b.password === 'string' ? b.password : '', a ? a.pw_hash : 's1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');   // 없는 아이디도 같은 시간이 걸리게
      if (!a || !ok) throw new HttpError(401, 'bad_login', '아이디 또는 비밀번호가 올바르지 않습니다');
      return { ...pub(a), token: db.newSession(a.id) };
    },
    'POST /api/logout': (req, ip, acc) => { db.logout(bearer(req)); return { ok: true }; },
    'POST /api/me/login': async (req, ip, acc) => {   // 복구 코드로 만든 계정에 아이디 · 비밀번호 붙이기
      if (acc.login) throw new HttpError(409, 'has_login', '이미 아이디가 있는 계정입니다');
      const b = await readJson(req, 1024), login = needLogin(b);
      if (!db.setLogin(acc.id, login, await hashPw(b.password))) throw new HttpError(409, 'login_taken', '이미 사용 중인 아이디입니다');
      return { ok: true, login };
    },
    'GET /api/me': (req, ip, acc) => { const r = db.rating(acc.id); return { ...pub(acc), xp: acc.xp, rating: { season: r.season, rating: r.rating, peak: r.peak, w: r.w, l: r.l, d: r.d } }; },
    'PATCH /api/me': async (req, ip, acc) => {
      const b = await readJson(req, 1024), name = b.name == null ? acc.name : cleanName(b.name); if (!name) throw new HttpError(400, 'bad_name');
      db.setProfile(acc.id, name, b.nation == null ? acc.nation : cleanNation(b.nation)); return { ok: true, name };
    },
    'DELETE /api/me': (req, ip, acc) => { db.deleteAccount(acc.id); ctx.kick(acc.id); log('계정 삭제', { id: acc.id }); return { ok: true }; },
    'GET /api/save': (req, ip, acc) => { const s = db.getSave(acc.id); if (!s) throw new HttpError(404, 'no_save'); return { rev: s.rev, updated: s.updated, data: JSON.parse(s.data) }; },
    'PUT /api/save': async (req, ip, acc) => {
      if (!lim.save(acc.id)) throw new HttpError(429, 'rate_limited');
      const b = await readJson(req, MAX_SAVE + 1024);
      if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw new HttpError(400, 'bad_data');
      const txt = JSON.stringify(b.data); if (txt.length > MAX_SAVE) throw new HttpError(413, 'too_large');
      const r = db.putSave(acc.id, Number.isInteger(b.rev) ? b.rev : 0, txt, statsOf(b.data));
      if (r.conflict) return [409, { error: 'conflict', rev: r.cur.rev, updated: r.cur.updated, data: JSON.parse(r.cur.data) }];
      return r;
    },
    'GET /api/leaderboard': (req, ip, acc, url) => {
      const type = url.searchParams.get('type') || 'pvp', season = url.searchParams.get('season') || seasonId();
      if (!/^\d{4}-\d{2}$/.test(season)) throw new HttpError(400, 'bad_season');
      const rows = db.leaderboard(type, Math.min(100, clampInt(url.searchParams.get('limit') || 50, 100) || 50), season);
      if (!rows) throw new HttpError(400, 'bad_type');
      return { type, season, rows };
    },
  };
  const NEED_AUTH = new Set(['POST /api/account/code', 'GET /api/me', 'PATCH /api/me', 'DELETE /api/me', 'GET /api/save', 'PUT /api/save', 'POST /api/logout', 'POST /api/me/login']);

  return async function handle(req, res, url, ip) {
    const key = `${req.method} ${url.pathname}`, json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (!lim.api(ip)) throw new HttpError(429, 'rate_limited');
      const fn = routes[key];
      if (!fn) throw new HttpError(Object.keys(routes).some(k => k.endsWith(' ' + url.pathname)) ? 405 : 404, 'not_found');
      let acc = null;
      if (NEED_AUTH.has(key)) { acc = db.auth(bearer(req)); if (!acc) throw new HttpError(401, 'unauthorized', '클라우드 연결이 필요합니다'); }
      const out = await fn(req, ip, acc, url);
      Array.isArray(out) ? json(out[0], out[1]) : json(200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
      log('API 오류', { key, err: String(e && e.stack || e).slice(0, 400) }); json(500, { error: 'server_error' });
    }
  };
}
module.exports = { makeApi, statsOf };
