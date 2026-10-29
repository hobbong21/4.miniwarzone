// 게임 안 회원가입 · 로그인 · 로그아웃 검사: 임시 DB로 실제 서버를 띄우고 헤드리스 Chrome(CDP)으로 화면을 조작
// 실행: npm run test:auth   (Chrome 경로가 다르면 CHROME=경로)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), OUT = join(tmpdir(), 'mwz-auth-test'), PORT = 8190 + Math.floor(Math.random() * 300), CDP = PORT + 400;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT + '/prof', { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(OUT, 'test.db'), MWZ_CREATE_PER_MIN: '1000' }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${OUT}/prof`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list.length) break; } catch {} await wait(250); }
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700)); return r.result.result.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
const go = async url => { await send('Page.navigate', { url }); await wait(1500); };
const vis = id => `($('${id}') && $('${id}').style.display === 'flex')`;
const clickWait = async (expr, ms = 600) => { await ev(expr); await wait(ms); };
await send('Runtime.enable'); await send('Page.enable');
const R = {};

// 1) 예전 주소 → 게임 안 회원가입 탭
await go(BASE + '/member/signup.html'); await wait(800);
R.redirect = await ev(`[location.search, ${vis('login')}, lgTab, !$('suAcc').hidden]`);
await shot('1_signup_tab');
// 2) 회원가입 입력 오류
const sg = (o) => `(async () => { for (const [k, v] of Object.entries(${JSON.stringify(o)})) { const el = $(k); if (el.type === 'checkbox') el.checked = v; else { el.value = v; el.dispatchEvent(new Event('input')); } } $('lgGo').click(); await new Promise(r => setTimeout(r, 400)); return $('lgMsg').textContent; })()`;
R.e_id = await ev(sg({ suId: 'Bad', suPw: 'abc123!x', suPw2: 'abc123!x', lgName: '철수', lgAgree: true }));
R.e_chk = await ev(sg({ suId: 'player01' }));
R.chk = await ev(`(async () => { $('suChk').click(); await new Promise(r => setTimeout(r, 500)); return $('lgMsg').textContent; })()`);
R.e_pw = await ev(sg({ suPw: 'abc', suPw2: 'abc' }));
R.e_pw2 = await ev(sg({ suPw: 'abc123!x', suPw2: 'abc123!y' }));
R.e_agree = await ev(sg({ suPw2: 'abc123!x', lgAgree: false }));
// 3) 가입 성공 → 메인 화면 (첫 훈련은 건너뜀)
await ev(`(() => { $('lgAgree').checked = true; $('lgGo').click(); })()`); await wait(1500);
await ev(`(() => { if (G.tutorial) skipTutorial(); })()`); await wait(500);
R.signedUp = await ev(`[profile, ${vis('station')}, !!(cloudMeta() && cloudMeta().token), cloudMeta() && cloudMeta().login]`);
R.dupSignup = await (await fetch(BASE + '/api/signup/check?login=player01')).json();
// 4) 기록을 바꾸고 프로필에서 로그아웃 (먼저 서버에 올림)
await ev(`(() => { const r = loadRec(); r.gold = 4321; r.motto = '필승!'; saveRec(r); })()`);
await clickWait(`showScreen('profile')`, 800);
R.acct = await ev(`$('pfAcct').textContent`);
await shot('2_profile_member');
await clickWait(`$('pfLogout').click()`, 2500);
R.loggedOut = await ev(`[profile, ${vis('login')}, lgTab, localStorage.getItem('miniwarzone.current'), Object.keys(localStorage).filter(k => k.includes('player') || k.includes('철수')).length]`);
await shot('3_after_logout');
// 5) 다시 열어도 자동 입장하지 않음
await go(BASE + '/'); R.reopen = await ev(`[${vis('login')}, ${vis('station')}, lgTab]`);
// 6) 로그인: 틀린 비밀번호 → 맞는 비밀번호 → 서버 기록 복원
const li = (pw) => `(async () => { $('liId').value = 'player01'; $('liPw').value = '${pw}'; $('liGo').click(); await new Promise(r => setTimeout(r, 1500)); return [$('liMsg').textContent, profile]; })()`;
R.wrong = await ev(li('nope1234!'));
R.login = await ev(li('abc123!x'));
R.restored = await ev(`[${vis('station')}, loadRec().gold, loadRec().motto, !!loadRec().tutSkip]`);
// 6-1) 메인 메뉴 · 지휘관 카드 버튼 · 프로필 탭(도감 포함) · 설정 독립
await wait(3500); await shot('3b_station');   // 첫 입장 인트로가 끝난 뒤
R.menu = await ev(`[[...document.querySelectorAll('#station .mmb')].filter(b => b.style.display !== 'none').map(b => b.dataset.go), document.querySelectorAll('#stCard [data-go2], #stLogout').length, $('stCard').textContent.includes('눌러서')]`);
await clickWait(`document.querySelector('#stCard [data-go2="profile"]').click()`, 600);
R.pfTabs = await ev(`[...document.querySelectorAll('#profile .pf-tabbar button[data-tab]')].map(b => b.dataset.tab).join(',')`);
await clickWait(`document.querySelector('#profile .pf-tabbar button[data-tab="dex"]').click()`, 800);
R.dex = await ev(`[${vis('dex')}, document.querySelectorAll('#dex .pf-tabbar button[data-tab]').length, $('dexList').children.length]`);
await shot('3c_dex');
await clickWait(`document.querySelector('#stCard [data-go2="settings"]').click()`, 600);
R.settings = await ev(`[${vis('settings')}, !!$('setLogout'), $('setAcct').textContent, document.querySelectorAll('#settings .pftabs').length]`);
await shot('3d_settings');
await clickWait(`showScreen('station')`, 600);
await clickWait(`showScreen('world')`, 2500);   // 세계 지도: 국경 데이터 · 바탕 그림 · 국기 배지
R.world = await ev(`[${vis('world')}, WG && WG.countries.length, !!(WG && WG.base), Object.keys(NATIONS).every(k => WG.byNation[k]), Object.keys(FLAG_CV).length]`);
await shot('3e_world');
R.th = await ev(`Object.keys(THEATERS).map(key => {   // 작전도 6곳: 지역마다 땅이 있고 · 모든 지역이 이어지고 · 바탕 그림이 만들어짐
  buildTheaterMap(key); buildTheaterBase(); const M = TH_MAP, n = M.T.regions.length, cnt = new Array(n).fill(0); for (const v of M.hid) if (v >= 0) cnt[v]++;
  const seen = new Set([0]), st = [0]; while (st.length) for (const j of M.adj[st.pop()]) if (!seen.has(j)) { seen.add(j); st.push(j); }
  return cnt.every(c => c > 50) && seen.size === n && !!M.base;
}).concat(WPICK.isPointInPath(WG.byNation.AUS.path, ...wProj(134, -25)))`);
await clickWait(`showScreen('station')`, 600);
// 7) 다른 기기 흉내: 저장소를 모두 비우고 로그인 → 같은 기록
await ev(`localStorage.clear()`); await go(BASE + '/?auth=login');
R.device2 = await ev(`(async () => { $('liId').value = 'player01'; $('liPw').value = 'abc123!x'; $('liGo').click(); await new Promise(r => setTimeout(r, 1800)); return [profile, loadRec().gold, ${vis('station')}, !!document.getElementById('legalNote')]; })()`);
await clickWait(`$('stLogout').click()`, 2500);   // 메인 화면 카드의 로그아웃 버튼
R.stOut = await ev(`[profile, ${vis('login')}]`);
// 8) 게스트 → 설정에서 회원가입 (지금 기록 그대로 서버로)
await clickWait(`lgSet('guest')`, 300);
R.guestTab = await ev(`[$('suAcc').hidden, $('lgGo').textContent]`);
await ev(`(() => { $('lgName').value = '게스트군'; $('lgAgree').checked = true; $('lgGo').click(); })()`); await wait(1200);
await ev(`(() => { if (G.tutorial) skipTutorial(); const r = loadRec(); r.gold = 999; saveRec(r); })()`); await wait(300);
await clickWait(`showScreen('profile')`, 600);
R.guestAcct = await ev(`[$('pfAcct').textContent, !!$('pfJoin')]`);
await clickWait(`$('pfJoin').click()`, 600);
R.joinForm = await ev(`!!$('cjGo')`);
await shot('4_settings_join');
R.join = await ev(`(async () => { $('cjId').value = 'guest777'; $('cjPw').value = 'abc123!x'; $('cjPw2').value = 'abc123!x'; $('cjGo').click(); await new Promise(r => setTimeout(r, 6500)); return [cloudMeta() && cloudMeta().login, cloudMeta() && cloudMeta().dirty, $('cloudBox').textContent.includes('guest777')]; })()`);
const gl = await (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'guest777', password: 'abc123!x' }) })).json();
R.joinServer = [gl.name, (await (await fetch(BASE + '/api/save', { headers: { Authorization: 'Bearer ' + gl.token } })).json()).data?.rec?.gold];
// 9) 휴대폰 폭 로그인 화면
await clickWait(`showScreen('settings')`, 500); await clickWait(`$('setLogout').click()`, 2500);   // 설정의 로그아웃 버튼
R.setOut = await ev(`[profile, ${vis('login')}]`);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await go(BASE + '/?auth=signup'); R.mobile = await ev('document.documentElement.scrollWidth <= innerWidth'); await shot('5_mobile_signup');
await send('Emulation.clearDeviceMetricsOverride');
// 10) 파일로 열면 게스트만
await ev(`localStorage.clear()`); await go('file:///' + ROOT.replace(/\\/g, '/') + '/game/index.html');
R.file = await ev(`[lgTab, [...document.querySelectorAll('#login [data-lt]')].map(b => b.disabled).join(',')]`);
await shot('6_file_guest');

const ok = (n, c) => [n, !!c];
const checks = [
  ok('/member/signup.html → 게임 안 회원가입 탭', R.redirect[0] === '?auth=signup' && R.redirect[1] && R.redirect[2] === 'signup' && R.redirect[3]),
  ok('잘못된 아이디 거부', R.e_id.startsWith('아이디는')),
  ok('중복확인 안 하면 거부', R.e_chk === '아이디 중복확인을 해 주세요'),
  ok('중복확인 통과', R.chk.includes('사용할 수 있는')),
  ok('약한 비밀번호 거부', R.e_pw.startsWith('비밀번호는')),
  ok('비밀번호 확인 불일치 거부', R.e_pw2 === '비밀번호 확인이 일치하지 않습니다'),
  ok('약관 동의 필요', R.e_agree.includes('동의')),
  ok('가입 → 메인 화면 · 서버 토큰 · 아이디', R.signedUp[0] === '철수' && R.signedUp[1] && R.signedUp[2] && R.signedUp[3] === 'player01'),
  ok('가입한 아이디는 중복 처리', R.dupSignup.available === false),
  ok('프로필에 회원 · 아이디 표시', R.acct.includes('player01') && R.acct.includes('로그아웃')),
  ok('로그아웃 → 로그인 화면 · 이 기기 기록 · 토큰 삭제', R.loggedOut[0] === null && R.loggedOut[1] && R.loggedOut[2] === 'login' && R.loggedOut[3] === null && R.loggedOut[4] === 0),
  ok('다시 열어도 자동 입장 안 함', R.reopen[0] && !R.reopen[1] && R.reopen[2] === 'login'),
  ok('틀린 비밀번호 거부', R.wrong[0] === '아이디 또는 비밀번호가 올바르지 않습니다' && R.wrong[1] === null),
  ok('로그인 성공', R.login[1] === '철수'),
  ok('로그인하면 서버 기록 복원 (골드 · 좌우명 · 훈련 건너뜀)', R.restored[0] && R.restored[1] === 4321 && R.restored[2] === '필승!' && R.restored[3]),
  ok('다른 기기(빈 저장소)에서 로그인 → 같은 기록 · 약관 재동의 없음', R.device2[0] === '철수' && R.device2[1] === 4321 && R.device2[2] && !R.device2[3]),
  ok('메인 메뉴: 프로필 · 도감 합침, 설정 독립', !R.menu[0].includes('dex') && R.menu[0].includes('profile') && R.menu[0].includes('settings')),
  ok('지휘관 카드: 안내문 대신 프로필 · 설정 · 로그아웃 버튼', R.menu[1] === 3 && !R.menu[2]),
  ok('프로필 탭: 프로필 · 기록실 · 도감', R.pfTabs === 'profile,records,dex,close'),
  ok('도감이 프로필 탭 안에서 열림', R.dex[0] && R.dex[1] === 4 && R.dex[2] > 0),
  ok('설정: 독립 화면 · 계정 표시 · 로그아웃 버튼', R.settings[0] && R.settings[1] && R.settings[2].includes('player01') && R.settings[3] === 0),
  ok('작전도 6곳: 실제 국경 땅 · 지역 연결 · 바탕 그림 (+ 세계 지도에 호주 땅)', R.th.length === 7 && R.th.every(Boolean)),
  ok('세계 지도: 국경 · 바탕 그림 · 모든 나라 땅 · 국기 배지', R.world[0] && R.world[1] > 150 && R.world[2] && R.world[3] && R.world[4] >= 30),
  ok('메인 화면 카드에서 로그아웃', R.stOut[0] === null && R.stOut[1]),
  ok('설정에서 로그아웃', R.setOut[0] === null && R.setOut[1]),
  ok('게스트 탭: 아이디 칸 숨김 · 게스트로 시작', R.guestTab[0] && R.guestTab[1].startsWith('게스트로 시작')),
  ok('게스트 프로필: 게스트 표시 · 회원가입 버튼', R.guestAcct[0].includes('게스트') && R.guestAcct[1] && R.joinForm),
  ok('설정에서 회원가입 → 아이디 연결 · 기록 업로드', R.join[0] === 'guest777' && R.join[1] === false && R.join[2]),
  ok('게스트 기록이 서버 계정으로 옮겨짐', R.joinServer[0] === '게스트군' && R.joinServer[1] === 999),
  ok('휴대폰 폭 가로 넘침 없음', R.mobile),
  ok('파일로 열면 게스트만 (로그인 · 회원가입 탭 꺼짐)', R.file[0] === 'guest' && R.file[1] === 'true,true,false'),
  ok('JS 오류 없음', errors.length === 0),
];
for (const [n, c] of checks) console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}`);
const fail = checks.filter(c => !c[1]).length;
console.log(`\n${checks.length - fail}/${checks.length} 통과 · 화면 캡처: ${OUT}`);
if (fail) console.log(JSON.stringify({ R, errors }, null, 1));
ws.close(); chrome.kill(); srv.kill(); process.exit(fail ? 1 : 0);
