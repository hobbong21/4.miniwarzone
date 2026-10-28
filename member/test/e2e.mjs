// 회원가입 → 로그인 흐름 검증 (헤드리스 Chrome CDP)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..'), out = process.argv[2] || join(tmpdir(), 'member-test'), port = process.argv[3] || '9381';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// BASE=http://127.0.0.1:8080/member 처럼 주면 실행 중인 서버로 검사 (기본: 파일 직접 열기)
// LAN=1 이면 lan.test 주소(보안 연결 아님 → crypto.subtle 없음)로 바꿔 대체 SHA-256 경로를 검사
const BASE = process.env.BASE ? (process.env.LAN ? process.env.BASE.replace(/\/\/[^/:]+/, '//lan.test') : process.env.BASE) : 'file:///' + dir.replace(/\\/g, '/');
mkdirSync(out + '/prof', { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${out}/prof`, '--window-size=1100,900', ...(process.env.LAN ? ['--host-resolver-rules=MAP lan.test 127.0.0.1'] : []), 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let list; for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await wait(250); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(`${out}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
const go = async f => { await send('Page.navigate', { url: BASE + '/' + f }); await wait(800); };
await send('Runtime.enable'); await send('Page.enable');
const R = {};
await go('signup.html'); await ev('localStorage.clear(), sessionStorage.clear()'); await go('signup.html'); await shot('1_signup');   // 다시 돌려도 같은 결과가 나오도록 저장소 비우고 시작
R.secure = await ev('!!(window.crypto && crypto.subtle)');
R.sha = await ev(`sha256js(new TextEncoder().encode('abc')) + ' ' + sha256js(new TextEncoder().encode('비밀번호!' + 'x'.repeat(70)))`);
R.shaRef = await ev(`crypto.subtle ? crypto.subtle.digest('SHA-256', new TextEncoder().encode('비밀번호!' + 'x'.repeat(70))).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')) : ''`);
R.empty = await ev(`(async () => { document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 100)); return [msg.textContent, document.querySelectorAll('.bad').length]; })()`);
R.badId = await ev(`(() => { uid.value = '홍길동'; dup.click(); return uidMsg.textContent; })()`);
R.goodId = await ev(`(() => { uid.value = 'tester01'; uid.oninput(); dup.click(); return uidMsg.textContent; })()`);
R.weakPw = await ev(`(async () => { const f = { pw: 'abc', pw2: 'abc', hintA: '집', name: '테스트', birth: '2000-01-01', m1: '010', m2: '1234', m3: '5678', mail1: 'tester' };
  for (const k in f) document.getElementById(k).value = f[k]; mailSel.value = 'gmail.com'; mailSel.onchange();
  document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 100)); return msg.textContent; })()`);
R.mismatch = await ev(`(async () => { pw.value = 'abc123!'; pw2.value = 'abc123?'; document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 100)); return msg.textContent; })()`);
R.ok = await ev(`(async () => { pw2.value = 'abc123!'; document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 300)); const u = JSON.parse(localStorage.getItem('member.users')).tester01;
  return [msg.textContent, u.email, u.pw.length, u.pw.includes('abc')]; })()`);
await shot('2_signup_done');
await wait(1300);
R.loginUrl = await ev('location.href.split("/").pop()');
R.wrongPw = await ev(`(async () => { lpw.value = 'nope'; document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 200)); return lmsg.textContent; })()`);
R.login = await ev(`(async () => { lpw.value = 'abc123!'; document.querySelector('.submit').click(); await new Promise(r => setTimeout(r, 200)); return lmsg.textContent; })()`);
R.loggedInUi = await ev('[loginBox.hidden, logout.hidden]');
await shot('3_login');
await go('login.html'); R.keep = await ev('[lmsg.textContent, logout.hidden]');   // 새로 열어도 로그인 유지
R.logout = await ev(`(() => { logout.click(); return [lmsg.textContent, loginBox.hidden, logout.hidden, sessionStorage.getItem('member.me')]; })()`);
await go('login.html'); R.afterLogout = await ev('[lmsg.textContent, loginBox.hidden]');
await shot('3b_logout');
R.dupAgain = await (async () => { await go('signup.html'); return ev(`(() => { uid.value = 'tester01'; dup.click(); return uidMsg.textContent; })()`); })();
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go('signup.html'); R.mobileOverflow = await ev('document.documentElement.scrollWidth > innerWidth'); await shot('4_signup_mobile');
R.errors = errors;
const checks = [
  ['대체 SHA-256이 표준 값과 같음', R.sha.split(' ')[0] === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' && (!R.shaRef || R.sha.split(' ')[1] === R.shaRef)],
  ['빈 양식 제출 → 필수 항목 안내 + 빨간 칸 11개', R.empty[0] === '필수 항목을 모두 입력해 주세요' && R.empty[1] === 11],
  ['한글 아이디 → 형식 오류', R.badId.startsWith('아이디 형식을 확인')],
  ['올바른 아이디 → 중복검색 통과', R.goodId === '등록이 가능합니다.'],
  ['약한 비밀번호 → 거부', R.weakPw.startsWith('비밀번호는 영문')],
  ['비밀번호 확인 불일치 → 거부', R.mismatch === '비밀번호 확인이 일치하지 않습니다'],
  ['가입 완료 · 이메일 저장 · 비밀번호는 해시(64자)로만', R.ok[0].startsWith('회원가입이 완료') && R.ok[1] === 'tester@gmail.com' && R.ok[2] === 64 && !R.ok[3]],
  ['가입 후 로그인 화면으로 이동 (아이디 채움)', R.loginUrl === 'login.html?id=tester01'],
  ['틀린 비밀번호 → 로그인 거부', R.wrongPw === '아이디 또는 비밀번호가 올바르지 않습니다'],
  ['맞는 비밀번호 → 로그인 성공', R.login === '테스트님, 환영합니다!'],
  ['로그인 후 입력칸 숨김 · 로그아웃 버튼 표시', R.loggedInUi[0] === true && R.loggedInUi[1] === false],
  ['페이지를 다시 열어도 로그인 유지', R.keep[0] === '테스트님, 로그인 중입니다' && R.keep[1] === false],
  ['로그아웃 → 안내 · 입력칸 복귀 · 로그인 상태 삭제', R.logout[0] === '로그아웃되었습니다' && R.logout[1] === false && R.logout[2] === true && R.logout[3] === null],
  ['로그아웃 후 다시 열면 로그인 화면', R.afterLogout[0] === '' && R.afterLogout[1] === false],
  ['같은 아이디 재가입 → 중복 차단', R.dupAgain === '이미 사용 중인 아이디입니다'],
  ['휴대폰 폭(390px) 가로 넘침 없음', R.mobileOverflow === false],
  ['JS 오류 없음', errors.length === 0],
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
const fail = checks.filter(c => !c[1]).length;
console.log(`\n${checks.length - fail}/${checks.length} 통과 · ${BASE} (${R.secure ? '보안 연결: crypto.subtle' : '보안 연결 아님: 대체 SHA-256'}) · 화면 캡처: ${out}`);
if (fail) console.log(JSON.stringify(R, null, 1));
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
