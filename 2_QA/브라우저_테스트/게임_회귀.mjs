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
  return JSON.stringify({loser:+(60-a.skillCD).toFixed(2), killer:+(60-b.skillCD).toFixed(2), kwant:+(360*0.012*gaugeMax(b)/100).toFixed(2)}) })()`);
ok('command gauge (§45): tank lost → loser +18% (16.2s of 90s), killer +4.3% (≈4:1)', r.loser===16.2 && r.killer===r.kwant, JSON.stringify(r));
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
// ---- 5b. 포격 예고 조준원 (기획서 §43)
const natOf = k => `Object.keys(NATIONS).find(n => (NATION_SKILL[n] || 'barrage') === '${k}')`;
r = await J(`(()=>{ $('ceremony').style.display='none'; $('over').style.display='none'; newGame(); G.started=true; G.tutorial=false;
  const a=me(), b=G.players.find(p=>p.team!==a.team); b.nation=${natOf('barrage')}; const x=WW/2, y=WH/2;
  const u1=makeUnit(a,'tank',x,y), u2=makeUnit(a,'mech',x+30,y); for (const u of [u1,u2]) { u.built=true; G.units.push(u); }
  SETTINGS.speed=3; const p0=(G.pings||[]).length, n0=$('feed') ? $('feed').textContent.length : 0;
  b.skillCD=0; useSkill(b, x, y); const c=G.calls[0];
  const res={n:G.calls.length, kind:c.kind, team:c.team===b.team, inside:c.inside, t1:+(c.t1-G.time).toFixed(2), strikesLinked:G.strikes.filter(q=>q.call===c).length, speed:SETTINGS.speed, ping:(G.pings||[]).length>p0};
  render(); res.drawOk=true;
  return JSON.stringify(res) })()`);
ok('enemy skill barrage → one reticle call (2 units inside, 6 shells linked)', r.n===1 && r.kind==='barrage' && r.team && r.inside===2 && r.strikesLinked===6 && r.t1===1.2, JSON.stringify(r));
ok('threat warning: speed back to 1×, minimap ping, render ok', r.speed===1 && r.ping && r.drawOk, JSON.stringify(r));
await ev(`(()=>{ const c=G.calls[0]; cam.zoom=1.6; cam.x=c.x-VW/cam.zoom/2; cam.y=c.y-VH/cam.zoom/2; for(let i=0;i<12;i++) update(1/30); })()`); await sleep(300); await shot('조준원_적포격.png');
r = await J(`(()=>{ for(let i=0;i<30*4;i++) update(1/30); return JSON.stringify({dodges:G.dodges||0, calls:G.calls.length}) })()`);
ok('units stayed inside → hit, no dodge credit, call cleaned up', r.dodges===0 && r.calls===0, JSON.stringify(r));
r = await J(`(()=>{ newGame(); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); b.nation=${natOf('barrage')}; const x=WW/2, y=WH/2;
  let got=[];
  for (let k=0;k<3;k++) { const us=[makeUnit(a,'tank',x,y), makeUnit(a,'mech',x+20,y+10)]; for (const u of us) { u.built=true; G.units.push(u); }
    b.skillCD=0; useSkill(b, x, y); for (const u of us) { u.x += 260; u.y += 0; }   // 바로 원 밖으로
    for(let i=0;i<30*4;i++) update(1/30); got.push(G.dodges||0); for (const u of us) u.alive=false; }
  const rec0=loadRec().stats.dodgeBest||0; endGame(true,'회피 테스트'); const rec=loadRec();
  return JSON.stringify({got, best:rec.stats.dodgeBest, medal:MEDALS.find(m=>m[1]==='침착한 손')[3](rec)}) })()`);
ok('dodge 3 enemy barrages → G.dodges 1,2,3 → stats.dodgeBest 3 → 침착한 손 medal', JSON.stringify(r.got)==='[1,2,3]' && r.best===3 && r.medal===true, JSON.stringify(r));
r = await J(`(()=>{ $('ceremony').style.display='none'; $('over').style.display='none'; newGame({diff:'t10'}); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); a.nation=${natOf('barrage')}; const x=WW/2, y=WH/2;
  const e=[makeUnit(b,'tank',x,y), makeUnit(b,'mech',x+20,y)]; for (const u of e) { u.built=true; G.units.push(u); }
  a.skillCD=0; useSkill(a, x, y); const c=G.calls[0];
  for(let i=0;i<9;i++) update(1/30); const before=e.map(u=>u.orders.length);
  for(let i=0;i<6;i++) update(1/30); const after=e.map(u=>u.orders.length ? Math.round(Math.hypot(u.orders[0].x-x,u.orders[0].y-y)) : 0);
  return JSON.stringify({mine:c.team===a.team, before, after, r:c.r}) })()`);
ok('AI dodges my reticle after reaction time (hard 0.4s): move orders outside the circle', r.mine && r.before.every(n=>n===0) && r.after.every(d=>d>r.r), JSON.stringify(r));
r = await J(`(()=>{ newGame(); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); const x=WW/2, y=WH/2;
  const us=[makeUnit(a,'tank',x,y), makeUnit(a,'tank',x+25,y)]; for (const u of us) { u.built=true; G.units.push(u); }
  b.opCD={}; useOp(b,'fire',[],x,y); const c=G.calls.find(q=>q.kind==='fire'); for(let i=0;i<30*4.2;i++) update(1/30);
  const shotsLinked = true; return JSON.stringify({kind:c&&c.kind, inside:c&&c.inside, hit:c&&c.hit, oldDrawGone: !/포격 지원 예고: 붉은 표적/.test(document.documentElement.innerHTML)}) })()`);
ok('op "포격 지원" uses the same reticle; staying units are hit (call.hit)', r.kind==='fire' && r.inside===2 && r.hit===true && r.oldDrawGone, JSON.stringify(r));
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team); b.nation=${natOf('airstrike')}; const x=WW/2, y=WH/2; b.skillCD=0; useSkill(b,x,y); const c=G.calls[0];
  return JSON.stringify({kind:c.kind, capsule:c.x0!=null, inLine:inCall(c,x+110,y), outEnd:inCall(c,x+200,y), outSide:inCall(c,x,y+60)}) })()`);
ok('airstrike reticle is a capsule along the bomb line', r.kind==='airstrike' && r.capsule && r.inLine && !r.outEnd && !r.outSide, JSON.stringify(r));
r = await J(`(()=>{ const S=makeSnap(); const n=G.calls.length; G.calls=[]; const t=G.time; netApply(S); return JSON.stringify({sent:S.cl.length, back:G.calls.length, n, kind:G.calls[0]&&G.calls[0].kind}) })()`);
ok('PvP snapshot carries reticles to the guest', r.sent===1 && r.back===1 && r.kind==='airstrike', JSON.stringify(r));
// ---- 5c. 디오라마 화풍 (기획서 §44)
r = await J(`(()=>{ const o={};
  SETTINGS.dio=undefined; o.defaultOn=dioOn();
  hideScreens(); newGame({map:'island'}); o.allyBlue=me().col.main===DPCOL.ally[0].main; o.foeRed=G.players.find(p=>p.team!==me().team).col.main===DPCOL.foe[0].main;
  const t0=performance.now(); G.contour=buildTerrainImage(); o.buildMs=Math.round(performance.now()-t0);
  o.dioOffOutside=DIO_ON===false; render(); o.dioOffAfterRender=DIO_ON===false;
  let faceCalls=0; const f0=face; face=function(){ faceCalls++; return f0.apply(this, arguments); }; DIO_ON=true; face(0,0,1,2,'ok'); DIO_ON=false; face=f0; o.faceStillCallable=faceCalls===1;
  SETTINGS.dio=0; newGame({map:'island'}); o.chibiColors=me().col.main===SKINS[loadRec().skin].col.main && G.players.find(p=>p.team!==me().team).col.main===PCOL[1][0].main;
  SETTINGS.dio=1; return JSON.stringify(o) })()`);
ok('diorama is default; ally blue / foe red palette; chibi palette when off', r.defaultOn && r.allyBlue && r.foeRed && r.chibiColors, JSON.stringify(r));
ok('diorama flag only while drawing the battle (menus keep chibi art); terrain build < 1.5s', r.dioOffOutside && r.dioOffAfterRender && r.buildMs < 1500, JSON.stringify(r));
// ---- 5d. 재미 3원칙 (기획서 §45): 중앙 거점 · 전선 집결 · 결전 · 총동원 · 최후의 반격 · 현상금 · 대칭 보급 · 경계 구역
r = await J(`(()=>{ $('ceremony').style.display='none'; $('over').style.display='none'; newGame({map:'plains'}); G.started=true; G.tutorial=false; const o={};
  const core=G.points.find(p=>p.core); o.core=!!core; o.coreNearMid=core && Math.hypot(core.x-WW/2, core.y-WH/2)<330;
  const a=me(), b=G.players.find(p=>p.team!==a.team); o.rallyFwd=Math.abs(a.rally.x-a.hq.x)>300 && Math.abs(b.rally.x-b.hq.x)>300 && G.frontRally;
  o.inc0=incomeMul(a); core.owner=a.team; o.incCore=+incomeMul(a).toFixed(2); G.points.filter(p=>!p.core).forEach(p=>p.owner=a.team); o.incAll=+incomeMul(a).toFixed(2); o.incWant=+(1.3+Math.min(0.5,0.2*G.points.filter(p=>!p.core).length)).toFixed(2); G.points.forEach(p=>p.owner=-1); core.owner=-1;
  const u=makeUnit(a,'tank',b.hq.x-300,b.hq.y); u.built=true; G.units.push(u); o.guard=guardSlow(u); G.time=61; o.guardOff=guardSlow(u); u.alive=false;
  return JSON.stringify(o) })()`);
ok('§45 center core point near map middle, front rally ahead of HQ', r.core && r.coreNearMid && r.rallyFwd, JSON.stringify(r));
ok('§45 income: core +30%, edge +20% each (cap +50%)', r.inc0===1 && r.incCore===1.3 && r.incAll===r.incWant, JSON.stringify(r));
ok('§45 enemy-HQ guard zone slows to 60% only in first 60s', r.guard===0.6 && r.guardOff===1, JSON.stringify(r));
r = await J(`(()=>{ newGame({map:'plains'}); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); const o={};
  G.time=70; for (let i=0;i<6;i++) { const t=makeUnit(b,'tank',WW/2+i*20,WH/2+300); t.built=true; G.units.push(t); }
  for (let i=0;i<30*12;i++) { G.time+=1/30; updateComeback(1/30); } o.ao=G.allout[a.team]; o.aoFoe=G.allout[b.team];
  o.cost=costOf(a, TYPES.tank.cost).m; o.inc=+incomeMul(a).toFixed(2);
  const e=makeUnit(a,'mech',a.hq.x+60,a.hq.y); e.built=true; G.units.push(e); const h0=e.hp; damage(e,100,G.units.find(u=>u.owner===b.id&&u.type==='tank')); o.dmgTaken=Math.round(h0-e.hp);
  const n0=G.units.filter(u=>u.alive&&u.owner===a.id&&!u.T.building).length; a.hq.hp=a.hq.T.hp*0.3; G.cbT=0; updateComeback(1/30); o.ls=a.lastStand!=null; o.lsUnits=G.units.filter(u=>u.alive&&u.owner===a.id&&!u.T.building).length-n0;
  const again=G.units.length; G.cbT=0; updateComeback(1/30); o.once=G.units.length===again;
  return JSON.stringify(o) })()`);
ok('§45 total mobilization after 10s at <65% army: cost -25%, income ×1.25, -25% damage near HQ', r.ao && !r.aoFoe && r.cost===135 && r.inc===1.25 && r.dmgTaken===75, JSON.stringify(r));
ok('§45 last stand once at HQ <40%: free reinforcements', r.ls && r.lsUnits>=1 && r.once, JSON.stringify(r));
r = await J(`(()=>{ newGame({map:'plains'}); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); const o={};
  const core=G.points.find(p=>p.core); core.owner=a.team; core.prog=100; G.time=G.timeLimit-119; updateCrates(1/30); o.final=G.sudden;
  for (const p of G.points) if (!p.core) { p.owner=-1; p.prog=0; } const t=makeUnit(b,'mech',G.points.find(p=>!p.core).x,G.points.find(p=>!p.core).y); t.built=true; G.units.push(t);
  const h0=b.hq.hp; for (let i=0;i<30*10.2;i++) { updatePoints(1/30); updateComeback(1/30); } o.shell=Math.round(h0-b.hq.hp); o.hold=Math.round(G.coreHold[a.team]); o.edgeFrozen=G.points.filter(p=>!p.core).every(p=>p.prog===0);
  G.time=G.timeLimit+1; let res=null; const ee=endGame; endGame=(w,why)=>{res=[w,why]}; G.units.filter(u=>u.alive).forEach(u=>{}); update(1/30); endGame=ee; o.res=res;
  return JSON.stringify(o) })()`);
ok('§45 final battle: core holder shells enemy HQ 6%/10s, edge points frozen', r.final && r.shell>=96 && r.hold>=10 && r.edgeFrozen, JSON.stringify(r));
ok('§45 time-out judged by core hold first', r.res && r.res[0]===true && /중앙 확보/.test(r.res[1]), JSON.stringify(r));
r = await J(`(()=>{ newGame({map:'plains'}); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); const o={};
  G.crateT=0; updateCrates(1/30); o.n=G.crates.length; o.mirror=G.crates.length===2 && Math.abs(G.crates[0].x+G.crates[1].x-WW)<1 && G.crates[0].y===G.crates[1].y;
  const v=makeUnit(b,'tank',WW/2,WH/2); v.built=true; v.kills=5; G.units.push(v); const k=makeUnit(a,'tank',WW/2+40,WH/2); k.built=true; G.units.push(k); a.skillCD=60; o.lv=lvOf(v);
  damage(v,1e5,k); o.wreck=G.wrecks.at(-1).val; o.gain=+(60-a.skillCD).toFixed(2); o.gwant=+((360*0.012+15)*gaugeMax(a)/100).toFixed(2); o.lvMul=+lvMul({kills:5}).toFixed(2);
  return JSON.stringify(o) })()`);
ok('§45 symmetric crates (2, mirrored)', r.n===2 && r.mirror, JSON.stringify(r));
ok('§45 bounty: Lv.3+ kill → wreck ×2 (216), gauge +15', r.lv>=3 && r.wreck===216 && r.gain===r.gwant, JSON.stringify(r));
r = await J(`(()=>{ newGame({map:'plains'}); G.started=true; G.tutorial=false; const a=me(), b=G.players.find(p=>p.team!==a.team); const o={};
  const mk=(pl,t,x,y)=>{ const u=makeUnit(pl,t,x,y); u.built=true; G.units.push(u); return u; };
  const mine=[0,1,2,3].map(i=>mk(b,'tank',b.hq.x-150,b.hq.y+i*30)); const foes=[0,1,2,3,4,5].map(i=>mk(a,'tank',WW/2,WH/2+i*25));
  G.time=100; G.avHist=[[80,armyVal(0),armyVal(1)],[85,armyVal(0),armyVal(1)],[90,armyVal(0),armyVal(1)],[95,armyVal(0),armyVal(1)]];
  foes.slice(0,3).forEach(u=>u.alive=false); G.avHist.push([100,armyVal(0),armyVal(1)]); G.allout[b.team]=true;
  o.counter=aiCounter(b, mine); o.cT=b.counterT>G.time; const core=G.points.find(p=>p.core); o.toCore=mine.every(u=>u.orders.length && Math.hypot(u.orders.at(-1).x-core.x,u.orders.at(-1).y-core.y)<160);
  o.again=aiCounter(b, mine);
  b.skillCD=0; b.nation=Object.keys(NATIONS).find(n=>(NATION_SKILL[n]||'')==='barrage'); const n0=(G.calls||[]).length; foes.forEach(u=>u.alive=true); foes.forEach(u=>u.seen[b.team]=1); o.held=aiComebackSkill(b, foes); o.skillUsed=(G.calls||[]).length>n0;
  return JSON.stringify(o) })()`);
ok('§45 loser AI counterattacks to center when enemy push breaks (once per 35s)', r.counter && r.cT && r.toCore && !r.again, JSON.stringify(r));
ok('§45 loser AI saves targeted skill for the most valuable enemy cluster', r.held && r.skillUsed, JSON.stringify(r));
// ---- 6. PvP snapshot carries wreck value
r = await J(`(()=>{ newGame(); G.started=true; const a=me(), b=G.players.find(p=>p.team!==a.team); const t=makeUnit(b,'tank',WW/2,WH/2); t.built=true; G.units.push(t); damage(t,1e5,a.hq); const s=makeSnap(); const w=s.w.find(w=>w.val!==undefined); return JSON.stringify({has:!!w, val:w&&w.val}) })()`);
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
