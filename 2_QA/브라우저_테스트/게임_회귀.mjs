// 게임 회귀 테스트: 오프너 · 잔해 회수 · 역전 충전 · 타격감 · 전투 보고서 · 전 전장 AI 대전 · 폰 화면 (28항목)
// 실행: node "2_QA/브라우저_테스트/게임_회귀.mjs"  (프로젝트 폴더에서) · 스크린샷은 ./스크린샷/ 에 저장
import { open } from './_도구.mjs';
const { ev, J, send, sleep, shot, key, ok, errs, done } = await open();
await ev(`try{localStorage.clear()}catch(e){}`);
await send('Page.reload'); await sleep(2500);
ok('page loads, no errors at boot', errs.length===0, errs.join('|'));
// ---- 1. Opener
let r = await J(`(()=>{ newGame(); startBattle(); return JSON.stringify({on:$('opener').classList.contains('on'), p:G.paused, n:$('opCards').children.length}) })()`);
ok('opener shown on practice start', r.on && r.p && r.n===3, JSON.stringify(r));
await sleep(800);
ok('clock frozen while opener open', (await ev(`G.time`))===0);
for (const [code,k] of [['Digit4',null],['KeyQ',null]]) { await send('Input.dispatchKeyEvent',{type:'keyDown',code,key:code.slice(-1)}); await send('Input.dispatchKeyEvent',{type:'keyUp',code,key:code.slice(-1)}); }
ok('other keys ignored while open', await ev(`$('opener').classList.contains('on') && G.units.filter(u=>u.owner===ME && u.type==='eng').length===3`));
await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Digit3',key:'3'}); await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Digit3',key:'3'}); await sleep(200);
r = await J(`JSON.stringify({on:$('opener').classList.contains('on'), pick:G.opener[ME], heli:G.units.filter(u=>u.owner===ME&&u.type==='heli').length, mf:$('mflash').classList.contains('on'), co:Object.keys(G.groups||{}).length})`);
ok('key 3 picks air: heli placed, mission flash follows', !r.on && r.pick==='air' && r.heli===1 && r.mf, JSON.stringify(r));
await ev(`hideMissionFlash()`);
r = await J(`(()=>{ const t=G.time; for(let i=0;i<60;i++) update(1/30); return JSON.stringify({adv:G.time-t, paused:G.paused}) })()`);
ok('game resumes after pick', r.adv>1.9 && !r.paused, JSON.stringify(r));
r = await J(`(()=>{ $('over').style.display='none'; $('again').click(); return JSON.stringify({on:$('opener').classList.contains('on')}) })()`);
ok('rematch button shows opener again', r.on); await ev(`pickOpener('industry'); hideMissionFlash()`);
r = await J(`(()=>{ const out={}; for (const d of ['t6','t8','t10']) { G.diff=d; const c={blitz:0,industry:0,air:0}; for(let i=0;i<3000;i++) c[aiOpener(G.players[1])]++; out[d]=c; } return JSON.stringify(out) })()`);
ok('AI opener weights by difficulty (t6 industry-heavy, t10 blitz-heavy)', r.t6.industry>r.t6.blitz*2 && r.t10.blitz>r.t10.industry*1.5 && Math.abs(r.t8.blitz-1000)<150, JSON.stringify(r));
r = await J(`(()=>{ const o={}; newGame(); G.story={}; o.story=openerOK(); G.story=null; G.net='host'; o.pvp=openerOK(); G.net=null; G.tutorial=true; o.tut=openerOK(); G.tutorial=false; G.obj={type:'survive'}; o.surv=openerOK(); G.obj=null; o.practice=openerOK(); return JSON.stringify(o) })()`);
ok('opener excluded in story/pvp/tutorial/survive', !r.story && !r.pvp && !r.tut && !r.surv && r.practice, JSON.stringify(r));
r = await J(`(()=>{ newGame(); startBattle(); pickOpener('blitz'); pickOpener('air'); return JSON.stringify({pick:G.opener[ME], n:G.units.filter(u=>u.owner===ME&&!u.T.building).length}) })()`);
ok('double pick ignored', r.pick==='blitz', JSON.stringify(r));
await ev(`hideMissionFlash()`);
// ---- 2. Salvage
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team);
  const x=WW/2, y=WH/2; const t=makeUnit(b,'tank',x,y); t.built=true; G.units.push(t); const k=makeUnit(a,'mech',x-300,y); k.built=true; G.units.push(k);
  damage(t, 99999, k); const w=G.wrecks.at(-1); const v0=w.val;
  const m0=a.money; const pick=makeUnit(a,'mech',x,y); pick.built=true; G.units.push(pick);
  for(let i=0;i<30;i++) update(1/30); const early=w.val;   // 1s: still hot
  for(let i=0;i<60;i++) update(1/30); const later=w.val;
  return JSON.stringify({v0, early, later, gained:a.money-m0, sal:a.salvage}) })()`);
ok('wreck worth 30% of tank (108)', r.v0===108, JSON.stringify(r));
ok('wreck hot for 2.5s then collected by ground unit', r.early===108 && r.later===0 && r.sal===108, JSON.stringify(r));
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team); const x=WW/2,y=WH/2;
  const t=makeUnit(a,'tank',x,y); t.built=true; G.units.push(t); damage(t,99999,b.hq); const w=G.wrecks.at(-1);
  w.t=G.time-3; const e=makeUnit(b,'mech',x,y); e.built=true; G.units.push(e); updateCrates(1/30);
  const res={enemyTook:w.val===0, bsal:b.salvage||0};
  const t2=makeUnit(a,'tank',x+400,y); t2.built=true; G.units.push(t2); damage(t2,99999,b.hq); const w2=G.wrecks.at(-1); w2.t=G.time-61; update(1/30); res.expired=w2.val===0;
  const h=makeUnit(a,'heli',x-400,y); h.built=true; G.units.push(h); const t3=makeUnit(a,'tank',x-400,y+5); t3.built=true; G.units.push(t3); damage(t3,99999,b.hq); const w3=G.wrecks.at(-1); for(let i=0;i<100;i++) update(1/30); res.heliNo=w3.val>0 || !h.alive;
  return JSON.stringify(res) })()`);
ok('enemy can salvage my wreck', r.enemyTook && r.bsal===108, JSON.stringify(r));
ok('wreck expires after 60s', r.expired);
ok('aircraft cannot salvage', r.heliNo);
// ---- 3. Comeback charge
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team); a.skillCD=60; b.skillCD=60;
  const t=makeUnit(a,'tank',WW/2,WH/2); t.built=true; G.units.push(t); const k=makeUnit(b,'tank',WW/2+50,WH/2); k.built=true; G.units.push(k); damage(t,99999,k);
  return JSON.stringify({loser:+(60-a.skillCD).toFixed(2), killer:+(60-b.skillCD).toFixed(2)}) })()`);
ok('comeback charge: loser 7.2s, killer 1.8s (4:1)', r.loser===7.2 && r.killer===1.8, JSON.stringify(r));
// ---- 4. Juice
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team); const t=makeUnit(a,'tank',WW/2,WH/2); t.built=true; G.units.push(t); const k=makeUnit(b,'tank',WW/2-2000,WH/2); k.built=true; G.units.push(k);
  damage(t,100,k); const g0=t.hpG, h=t.hp, ring=G.time-t.combatT<3; for(let i=0;i<5;i++) updateUnit(t,1/30); const g1=t.hpG; for(let i=0;i<60;i++) updateUnit(t,1/30);
  return JSON.stringify({g0,h,g1,g2:t.hpG, ring, hit:t.hitT>=0}) })()`);
ok('HP ghost holds 0.3s then drains to hp', r.g0===540 && r.g1===540 && r.g2===r.h && r.ring, JSON.stringify(r));
r = await J(`(()=>{ const n0=G.fx.length; const a=me(), b=G.players.find(p=>p.team!==a.team); const t=makeUnit(b,'mech',WW/2,WH/2); t.built=true; G.units.push(t); damage(t,1e5,a.hq); return JSON.stringify({kring:G.fx.some(f=>f.k==='kring')}) })()`);
ok('kill ring fx spawned', r.kring);
// ---- 5. Battle report
r = await J(`(()=>{ newGame(); startBattle(); pickOpener('industry'); hideMissionFlash(); for(let i=0;i<30*3;i++) update(1/30); endGame(null,'짧은 전투'); return JSON.stringify({rpt:!!document.querySelector('#over .rpt'), samples:G.armyLog.length}) })()`);
ok('very short battle (<6s): summary hidden, no crash', !r.rpt, JSON.stringify(r));
r = await J(`(()=>{ $('ceremony').style.display='none'; $('over').style.display='none'; newGame({...G.cfg, map:'island'}); startBattle(); pickOpener('blitz'); hideMissionFlash(); me().ctrl='ai';
  for(let i=0;i<30*240 && !G.over;i++) { update(1/30); statSample(); /* 전투 흐름 기록은 화면 루프에서 남기므로 직접 호출 */ } me().ctrl='human'; if(!G.over) endGame(false,'테스트 패배'); cerAction('detail');
  return JSON.stringify({rpt:!!document.querySelector('#over .rpt') && !!$('stCv'), chips:document.querySelectorAll('.rpt .rpt-mo span').length, sum:document.querySelector('.rpt-sum')?.textContent, moments:G.rptM.list.map(m=>m.k), rows:document.querySelectorAll('.rpt table.vs tr').length, opener:[...document.querySelectorAll('.rpt table.vs tr')].at(-1).textContent}) })()`);
ok('report on loss: flow graph + summary, moment chips, vs table w/ opener row', r.rpt && r.sum && r.moments.length>=1 && r.chips===r.moments.length && r.rows===7 && /기습/.test(r.opener), JSON.stringify(r));
await sleep(300); const box = await J(`(()=>{ $('stCv').scrollIntoView({block:'center'}); const b=$('stCv').getBoundingClientRect(); return JSON.stringify([b.left,b.top,b.width,b.height]) })()`);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box[0]+box[2]*0.5,y:box[1]+box[3]/2});
await sleep(200);
const read = await ev(`$('stTip').style.display + ' | ' + $('stTip').textContent`);
ok('flow graph hover tooltip (GitHub graph) + moment markers source', /^block \| \d:\d\d/.test(read) && /아군/.test(read), read);
r = await J(`(()=>{ const log=[{t:0,a:[1000,1000],l:[0,0]},{t:30,a:[1500,800],l:[0,0]},{t:60,a:[700,1400],l:[300,0]},{t:90,a:[1600,600],l:[0,500]},{t:120,a:[1700,500],l:[0,100]}];
  G.firstBlood={t:10,team:0}; G.skillLog=[{t:80,team:me().team}]; const M=reportMoments(log, me().team);
  return JSON.stringify({m:M.list.map(x=>x.k+'@'+x.t), flips:M.flips, sum:reportSummary(log, me().team, M)}) })()`);
ok('turning point = last lead change, flips counted, skill cause named', r.m.includes('tp@90') && r.flips===2 && /지휘관 스킬 직후/.test(r.sum) && /역전 2회/.test(r.sum), JSON.stringify(r));
// ---- 6. PvP snapshot carries wreck value
r = await J(`(()=>{ const s=makeSnap(); const w=s.w.find(w=>w.val!==undefined); return JSON.stringify({has:!!w}) })()`);
ok('PvP snapshot includes wreck val', r.has, JSON.stringify(r));
// ---- 7. Regression: long AI-vs-AI across maps/modes
const maps = await J(`JSON.stringify(Object.keys(MAPS))`);
const modes = ['destroy','dom','basecap','ctf','koth','crates'];
let bad=[];
for (let i=0;i<maps.length;i++) {
  const m=maps[i], o=modes[i%modes.length];
  const res = await J(`(()=>{ try { $('ceremony').style.display='none'; $('over').style.display='none'; newGame({map:'${m}', obj:'${o}', diff:['t6','t8','t10'][${i}%3]}); startBattle(); pickOpener(OPENER_KEYS[${i}%3]); hideMissionFlash(); me().ctrl='ai';
    for(let k=0;k<30*180 && !G.over;k++) update(1/30); me().ctrl='human'; if(!G.over) endGame(true,'x'); return JSON.stringify({ok:1,t:G.time|0, s:G.armyLog.length}); } catch(e) { return JSON.stringify({err:String(e.stack||e).slice(0,300)}) } })()`);
  if (res.err) bad.push(m+'/'+o+': '+res.err);
}
ok(`AI-vs-AI 3 min on all ${maps.length} maps (6 modes)`, bad.length===0, bad.join(' | '));
// ---- 8. Story & tutorial still work
r = await J(`(()=>{ try { $('ceremony').style.display='none'; $('over').style.display='none'; startTutorial(); const a=$('opener').classList.contains('on'); for(let i=0;i<300;i++) update(1/30); return JSON.stringify({opener:a, t:G.time|0}) } catch(e) { return JSON.stringify({err:String(e)}) } })()`);
ok('tutorial starts without opener', r.opener===false && !r.err, JSON.stringify(r));
// ---- 9. Mobile layout
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await ev(`(()=>{ $('ceremony').style.display='none'; $('over').style.display='none'; newGame(); startBattle(); })()`); await sleep(600);
r = await J(`(()=>{ const c=[...document.querySelectorAll('#opener .op-c')].map(e=>e.getBoundingClientRect()); return JSON.stringify({w:document.documentElement.scrollWidth, maxR:Math.max(...c.map(b=>b.right)), minL:Math.min(...c.map(b=>b.left))}) })()`);
ok('opener fits phone width (390)', r.maxR<=390 && r.minL>=0, JSON.stringify(r));
await shot('폰_오프너.png');
await ev(`(()=>{ pickOpener('blitz'); hideMissionFlash(); me().ctrl='ai'; for(let k=0;k<30*120;k++) { update(1/30); statSample(); } me().ctrl='human'; endGame(true,'모바일'); cerAction('detail'); $('stCv').scrollIntoView({block:'center'}); })()`); await sleep(700);
r = await J(`(()=>{ const b=$('stCv').getBoundingClientRect(), c=document.querySelector('#over .rpt').getBoundingClientRect(); return JSON.stringify({l:Math.min(b.left,c.left), r:Math.max(b.right,c.right)}) })()`);
ok('report chart fits phone width', r.l>=0 && r.r<=390, JSON.stringify(r));
await shot('폰_전투보고서.png');
ok('no uncaught JS errors during whole run', errs.length===0, errs.slice(0,3).join(' | '));
done();
