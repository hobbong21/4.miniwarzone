// 재미 측정 (기획서 §45.5): AI 대 AI 전투를 여러 판 돌려 "끝까지 누가 이길지 모르는가"를 숫자로 본다.
// 실행: npm run test:fun  (또는 node "2_QA/브라우저_테스트/재미_측정.mjs" [판 수, 기본 24] [시드 시작, 기본 1])
// 결과: 콘솔 표 + 2_QA/재미_측정_결과.json (지난 결과와 비교용). 판정 없이 측정만 함 (항상 성공 종료)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './_도구.mjs';

const N = +process.argv[2] || 24, SEED0 = +process.argv[3] || 1;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../재미_측정_결과.json');
const { J, ev, errs, ok, done } = await open();
await ev(`try{localStorage.clear()}catch(e){}`);
const SETUP = process.env.FUN_SETUP || '', LABEL = process.env.FUN_LABEL || '';   // 실험: 게임 수치를 바꿔 보는 JS (예: FUN_SETUP="ALLOUT.inc=1.5")
if (SETUP) await ev(SETUP);
const maps = await J(`JSON.stringify(Object.keys(MAPS).filter(k => !MAPS[k].forceObj && !MAPS[k].hard))`);
const games = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const m = maps[i % maps.length], seed = SEED0 + i, diff = ['t6', 't8', 't10'][i % 3];
  const g = await J(`(()=>{ try {
    $('ceremony').style.display='none'; $('over').style.display='none';
    newGame({ map:'${m}', obj:'destroy', diff:'${diff}', seed:${seed} }); startBattle(); pickOpener(OPENER_KEYS[${i}%3]); hideMissionFlash();
    me().ctrl = 'ai'; let res = null; const fe = finishBattle, ee = endGame;
    finishBattle = (w, why) => { res ??= [w, why]; fe(w, why); }; endGame = (w, why) => { res ??= [w, why]; ee(w, why); };
    const aoN = [0, 0], an = typeof alloutNotice === 'function' ? alloutNotice : null; if (an) alloutNotice = (t, on) => { if (on) aoN[t]++; an(t, on); };   // (예전 버전 비교 시엔 없음)
    let k = 0; const dt = 1/30, cap = 30 * (G.timeLimit + 10);
    while (!res && k++ < cap) { update(dt); sampleArmy(dt); }
    finishBattle = fe; endGame = ee; if (an) alloutNotice = an;
    const center = G.fallen.filter(u => Math.abs(u.x - WW/2) < WW * 0.2).length;
    me().ctrl = 'human';
    return JSON.stringify({ map:'${m}', diff:'${diff}', seed:${seed}, win: res ? res[0] : null, why: res ? res[1] : 'cap', t: Math.round(G.time),
      log: G.armyLog.map(e => [Math.round(e.t), Math.round(e.a[0]), Math.round(e.a[1])]), deaths: G.fallen.length, center, ao: aoN, ls: G.players.map(p => p.lastStand == null ? -1 : Math.round(p.lastStand)), ch: (G.coreHold || [0, 0]).map(Math.round), core: (G.points || []).some(p => p.core), lv: G.fallen.filter(u => lvOf(u) >= 3).length, opener: [G.opener[0], G.opener[1]] });
  } catch (e) { return JSON.stringify({ err: String(e.stack || e).slice(0, 300) }) } })()`);
  if (g.err) { console.log('❌', m, g.err); continue; }
  games.push(g);
  process.stdout.write(`${i + 1}/${N} ${m.padEnd(9)} ${diff} ${g.win === true ? '파랑 승' : g.win === false ? '빨강 승' : '무승부'} ${Math.floor(g.t / 60)}:${String(g.t % 60).padStart(2, '0')}  ${g.why}  총동원 ${g.ao} 최후 ${g.ls} 중앙 ${g.core ? g.ch : '없음'}\n`);
}

// ---- 지표 계산 (기획서 §45.5)
const side = (a, b) => { const m = Math.max(a, b, 200); return Math.abs(a - b) <= m * 0.12 ? 0 : Math.sign(a - b); };   // §40 reportMoments와 같은 기준
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;
let behindN = 0, behindWin = 0, lead3N = 0, lead3Win = 0, flipsSum = 0, finalN = 0, finalFlip = 0, dSum = 0, cSum = 0, timeout = 0, lenSum = 0;
for (const g of games) {
  const winTeam = g.win === true ? 0 : g.win === false ? 1 : -1;
  for (const tm of [0, 1]) {   // 30% 이상 뒤졌던 쪽 (1분 이후, 상대 병력 300 이상일 때)
    const was = g.log.some(([t, a, b]) => { const me = tm ? b : a, foe = tm ? a : b; return t >= 60 && foe >= 300 && me < foe * 0.7; });
    if (was) { behindN++; if (winTeam === tm) behindWin++; }
  }
  const at3 = g.log.find(e => e[0] >= 180);
  if (at3 && winTeam >= 0) { const s = side(at3[1], at3[2]); if (s) { lead3N++; if ((s > 0 ? 0 : 1) === winTeam) lead3Win++; } }
  let last = 0, flips = 0; for (const [, a, b] of g.log) { const s = side(a, b); if (!s) continue; if (last && s !== last) flips++; last = s; }
  flipsSum += flips;
  const fin = g.log.filter(e => e[0] <= 600 - 120).at(-1);   // 결전(마지막 2분) 시작 시 앞선 쪽 ≠ 승자
  if (fin && winTeam >= 0 && g.t > 600 - 120) { const s = side(fin[1], fin[2]); finalN++; if (s && (s > 0 ? 0 : 1) !== winTeam) finalFlip++; }
  dSum += g.deaths; cSum += g.center; lenSum += g.t; if (/시간 종료|cap/.test(g.why)) timeout++;
}
const M = {
  label: LABEL || undefined, setup: SETUP || undefined,
  date: new Date().toISOString().slice(0, 16), games: games.length, seeds: `${SEED0}~${SEED0 + N - 1}`,
  comebackWin: pct(behindWin, behindN), comebackN: behindN,
  centerDeath: pct(cSum, dSum), lead3Win: pct(lead3Win, lead3N), flips: games.length ? Math.round(flipsSum / games.length * 100) / 100 : null,
  finalFlip: pct(finalFlip, finalN), avgLen: games.length ? Math.round(lenSum / games.length) : null, timeout: pct(timeout, games.length),
  blueWin: pct(games.filter(g => g.win === true).length, games.length),
};
const GOAL = [['comebackWin', '30% 이상 뒤졌던 쪽 승률', '≥ 35%', v => v >= 35], ['centerDeath', '중앙 40% 구역 전사 비율', '≥ 40%', v => v >= 40],
  ['lead3Win', '3분 시점 앞선 쪽 최종 승률', '≤ 70%', v => v <= 70], ['flips', '한 판 우세 역전 횟수', '≥ 2', v => v >= 2],
  ['finalFlip', '마지막 2분에 승부가 뒤집힌 판', '≥ 15%', v => v >= 15], ['avgLen', '평균 판 길이(초)', '360~540', v => v >= 360 && v <= 540],
  ['timeout', '시간 종료로 끝난 판', '≤ 10%', v => v <= 10], ['blueWin', '파랑(왼쪽) 승률 — 진영 공정성', '40~60%', v => v >= 40 && v <= 60]];
let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).history.at(-1); } catch {}
console.log(`\n📊 재미 측정 — AI 대 AI ${M.games}판 (${Math.round((Date.now() - t0) / 1000)}초)\n`);
for (const [k, name, goal, f] of GOAL) {
  const v = M[k]; console.log(`${v == null ? '·' : f(v) ? '✅' : '⚠️'} ${name.padEnd(22)} ${String(v ?? '-').padStart(6)}  목표 ${goal}${prev && prev[k] != null ? `   (지난번 ${prev[k]})` : ''}`);
}
let hist = []; try { hist = JSON.parse(fs.readFileSync(OUT, 'utf8')).history; } catch {}
if (!SETUP || LABEL) hist.push(M); fs.writeFileSync(OUT, JSON.stringify({ about: '기획서 §45.5 재미 지표 기록 (npm run test:fun)', history: hist.slice(-30) }, null, 1));
if (errs.length) console.log('\nJS 오류:', errs.slice(0, 3).join(' | '));
console.log(`\n기록: ${path.relative(process.cwd(), OUT)}`);
ok(`측정 완료 ${M.games}/${N}판`, M.games === N);
done();
