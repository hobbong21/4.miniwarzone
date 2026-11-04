// 공용 도우미: 로그 · 무작위 토큰 · 해시 · 입력 검증 · IP별 요청 제한
'use strict';
const crypto = require('crypto');

const log = (msg, extra) => console.log(`[${new Date().toISOString()}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 글자(I·O·0·1) 제외 32자
function randCode(n) { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += CODE_ABC[b[i] & 31]; return s; }
const recoveryCode = () => [randCode(4), randCode(4), randCode(4)].join('-');   // 60비트 · 다른 기기에서 기록 불러오기용
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 지휘관 이름: 앞뒤 공백 제거 · 제어문자 제거 · 1~12자
function cleanName(s) {
  const n = String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return n.length ? n : null;
}
const cleanNation = s => /^[A-Z]{2,6}$/.test(String(s || '')) ? String(s) : 'ROK';
// 회원 아이디 · 비밀번호 규칙 (게임 화면과 같음)
const LOGIN_RE = /^(?=.*[a-z])(?=.*\d)[a-z\d]{6,20}$/;   // 6~20자 영문 소문자 + 숫자 조합
const PW_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*]).{6,64}$/;   // 영문 · 숫자 · 특수문자 6~64자
const cleanLogin = s => LOGIN_RE.test(String(s ?? '')) ? String(s) : null;
// 비밀번호: scrypt(솔트 16바이트) → "s1$솔트$해시". 비교는 시간이 일정한 timingSafeEqual
const scrypt = (pw, salt) => new Promise((ok, bad) => crypto.scrypt(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? bad(e) : ok(k)));
async function hashPw(pw) { const salt = crypto.randomBytes(16); return `s1$${salt.toString('base64url')}$${(await scrypt(pw, salt)).toString('base64url')}`; }
async function checkPw(pw, stored) {
  const [v, s, h] = String(stored || '').split('$'); if (v !== 's1' || !s || !h) return false;
  const a = await scrypt(pw, Buffer.from(s, 'base64url')), b = Buffer.from(h, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const seasonId = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// 토큰 버킷 요청 제한: key(IP+종류)마다 rate개/분, 순간 최대 burst
function limiter(ratePerMin, burst = ratePerMin) {
  const B = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, b] of B) if (now - b.t > 10 * 60e3) B.delete(k); }, 60e3).unref();
  return key => {
    const now = Date.now(); let b = B.get(key);
    if (!b) { b = { n: burst, t: now }; B.set(key, b); }
    b.n = Math.min(burst, b.n + (now - b.t) / 60e3 * ratePerMin); b.t = now;
    if (b.n < 1) return false;
    b.n -= 1; return true;
  };
}
module.exports = { log, sha256, token, recoveryCode, normCode, cleanName, cleanNation, cleanLogin, PW_RE, hashPw, checkPw, seasonId, limiter };
