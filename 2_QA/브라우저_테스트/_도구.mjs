// 브라우저 QA 공용 도구: 헤드리스 크롬을 띄워 게임(3_게임/index.html)을 열고, 페이지 안에서 코드를 실행·검사한다.
// 외부 패키지 없음 (Node 22+ 내장 fetch/WebSocket + 크롬 DevTools 프로토콜)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAME = process.env.MWZ_GAME ? path.resolve(process.env.MWZ_GAME) : path.resolve(HERE, '../../3_게임/index.html');   // MWZ_GAME: 다른 버전 비교용
export const SHOTS = path.join(HERE, '스크린샷');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function open({ port = 9333 + Math.floor(Math.random() * 500) } = {}) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'mwz-qa-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let tabs;
  for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0; const pend = {}; const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  const J = async e => { const v = await ev(e); try { return JSON.parse(v); } catch { return v; } };
  const shot = async f => { const c = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, f), Buffer.from(c.result.data, 'base64')); };
  const key = async (code, k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
  const R = []; const ok = (name, cond, info = '') => R.push([cond ? 'PASS' : 'FAIL', name, info]);
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'file://' + GAME });
  await sleep(2500);
  const done = () => {
    for (const x of R) console.log(x[0] === 'PASS' ? '✅' : '❌', x[1], x[0] === 'FAIL' ? ' :: ' + x[2] : '');
    const pass = R.filter(x => x[0] === 'PASS').length;
    console.log(`\n합계 ${pass}/${R.length} 통과`);
    chrome.kill();
    setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 }); } catch {} process.exit(pass === R.length ? 0 : 1); }, 500);   // 크롬이 프로필을 다 닫은 뒤 정리
  };
  return { ev, J, send, sleep, shot, key, ok, errs, done };
}
