// node --experimental-loader ./tests/three-loader.mjs tests/tempo.mjs
// Exercise production damage/scoring with real arms; rendering and wall effects are omitted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { loadArmAssets, initAnatomy, Arm, SCRAP_STUMP_I, W as WT } from '../arm.js';
import { WALLS } from '../walls.js';
import { pickScrapKind } from '../scrap.js';
globalThis.location = { search: '' };
const source = fs.readFileSync(new URL('../game.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const constants = section('const DAMAGE_PACE', '// 타격감');
const events = section('const EV_ENDURE', '// 사건이 클수록');
const scoring = section('function addEndure(', '// 벽에 익숙해진 정도');
const damage = section('  const base = W.dmg', '  // 연출 — power:');
const loadFn = section('function load()', '// ------------------------------------------------------------------ 자세');
const chooseFn = section('function nextScrapKind(', '// UI에서 부르는 동작들');
const assets = await loadArmAssets(); initAnatomy(assets.header);
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
function seeded(seed) { return () => { seed = Math.imul(seed,1664525)+1013904223|0; return (seed>>>0)/4294967296; }; }
let scenarios = 0;
const summary=[];
for (const W of WALLS.filter(w => !w.paper)) {
  const counts=[];
  for (let trial=1;trial<=8;trial++) {
    const random = seeded(trial*1337 + WALLS.indexOf(W));
    const savedRandom = Math.random; Math.random=random;
    const arms = Object.fromEntries(['L','R'].map(s=>[s,new Arm(assets,s)]));
    const env = { Math, THREE, WT, WALLS, SCRAP_STUMP_I, W, arms, clamp,
      G:{endure:0,openedAt:0,stageSpanScale:1,owned:WALLS.slice(0,WALLS.indexOf(W)+1).map(w=>w.id),stats:{total:0}},
      round:{endured:0}, ui:{endure(){}}, rnd:(a,b)=>a+random()*(b-a),
      CHARGE_FLESH:.162, CHARGE_SCRAP:48, CHARGE_JOINT:.035, chargeHit:0, skill:{id:'shock'},
      fist:{autoPunch:false}, scrapBreakFx(){}, P:{contact:null} };
    vm.createContext(env); vm.runInContext(constants+'\n'+events+'\n'+scoring,env);
    const hit = new vm.Script('{'+damage+'}');
    const release = new vm.Script('addEndure(W.mult * (E_RIP + (W.id === "spikes" ? E_TUG : 0) + eventEndure(res.ev)));');
    const tally=[];
    for (const metal of [false,true]) {
      if(metal)for(const a of Object.values(arms))a.scrap={lumpHP:140,pipeHP:0};
      env.round={endured:0,endureStart:env.G.endure,scrapStart:{L:metal?140:0,R:metal?140:0}};
      let count=0;
      for(const a of Object.values(arms)) {
        env.a=a;
        while(!a.needsScrap()) {
          env.fist.autoPunch=W.id==='electric'&&count%4!==0;
          env.striker=metal?'scrap':a.I<.5?'hand':'stump';
          env.res={flesh:0,scrap:0,ev:[]};
          env.react={dmgMul:W.id==='nails'?1.1:W.id==='spikes'?(metal?1.1:1.15):W.id==='glass'&&a.I>=.5?1.1:1};
          hit.runInContext(env);count++;
          if(!metal&&['nails','freezer','spikes'].includes(W.id)&&!a.needsScrap()) {
            const res={flesh:0,scrap:0,ev:[]};
            const pace=vm.runInContext('DAMAGE_PACE',env);
            if(W.id==='spikes')a.damageFlesh(W.dmg*.35*pace*W.pace,W.kind,res);
            a.damageFlesh(W.dmg*.6*pace*W.pace,W.kind,res);
            env.res=res;release.runInContext(env);
          }
          // Half the glass samples include slow-play bleeding; others have no passive damage.
          if(!metal&&W.id==='glass'&&trial%2===0&&a.I<.5) {
            const res={flesh:0,scrap:0,ev:[]};
            a.damageFlesh(.012*.4*vm.runInContext('DAMAGE_PACE',env)*W.pace,W.kind,res);
            env.res=res;vm.runInContext('addEndure(W.mult * (E_BLEED * .4 + eventEndure(res.ev)));',env);
          }
          assert.ok(count<2000,`${W.id} must finish`);
        }
      }
      tally.push(count);
      const g=vm.runInContext('goal()',env);
      if(!metal)assert.ok(env.G.endure<g.to,`${W.id}: bare round should leave room for iron (${env.G.endure}/${g.to})`);
      else assert.ok(env.G.endure>=g.to,`${W.id}: one iron round must open next wall`);
    }
    counts.push(tally);scenarios++;
    Math.random=savedRandom;
  }
  summary.push({wall:W.id,bare:[Math.min(...counts.map(c=>c[0])),Math.max(...counts.map(c=>c[0]))],iron:[Math.min(...counts.map(c=>c[1])),Math.max(...counts.map(c=>c[1]))]});
}
console.table(summary);

// Low rewards, partially worn iron, either hand alone, and unequal damage must still fill the goal smoothly.
for(const starts of [{L:140,R:140},{L:47,R:81},{L:140,R:0},{L:0,R:23}]) {
  const env={WALLS:[{id:'a'},{id:'b'}],OPEN_SPAN:[100],HANDS_SPAN:100,clamp,
    G:{endure:20,openedAt:0,stageSpanScale:1,owned:['a'],stats:{total:0}},
    arms:{L:{scrap:{lumpHP:starts.L}},R:{scrap:{lumpHP:starts.R}}},
    round:{endureStart:20,endured:0,scrapStart:starts},ui:{endure(){}}};
  vm.createContext(env);vm.runInContext(scoring,env);
  for(const k of [.25,.5,.75,1]) {
    for(const s of ['L','R'])env.arms[s].scrap.lumpHP=starts[s]*(1-k);
    vm.runInContext('addEndure(.01)',env);
    assert.ok(Math.abs(env.G.endure-(20+80*k))<1e-8,'remaining progress follows iron wear');
  }
  assert.equal(env.G.stats.total,80);assert.equal(env.round.endured,80);
}

// Real round completion still opens only the next wall and supplies fresh bare hands, including A4.
const endRound = section('function endRound()', 'function armSnapshot(');
for(let i=0;i<WALLS.length-1;i++) {
  const G={endure:1e9,openedAt:0,stageSpanScale:1,owned:WALLS.slice(0,i+1).map(w=>w.id),stats:{rounds:0},arms:{}};
  const env={G,WALLS,OPEN_SPAN:Array(8).fill(100),HANDS_SPAN:100,mode:'play',round:{},arms:{L:{},R:{}},
    cancelAllInputs(){},document:{body:{classList:{remove(){}}}},skillFx:null,fx:{persist(){}},sfx:{play(){}},
    armSnapshot:()=>({I:.8}),setWall(id){G.wall=id;},freshHands(){G.arms={L:{I:0},R:{I:0}};},setTimeout(){},save(){},ui:{showShop(){}}};
  vm.runInNewContext(scoring+'\n'+endRound+'\nendRound()',env);
  assert.equal(G.wall,WALLS[i+1].id);assert.equal(G.owned.length,i+2);
  assert.equal(G.arms.L.I,0);assert.equal(G.arms.R.I,0);assert.equal(G.openedAt,G.endure);
}

// First mounts are basic on EACH side, regardless of order or repeated mounts on the other side.
for(const order of [['L','R'],['R','L'],['L','L','R'],['R','R','L']]) {
  const env={G:{scrapEquips:0,scrapEquipsBySide:{L:0,R:0}},pickScrapKind:n=>pickScrapKind(n,()=>.99)};
  vm.createContext(env);vm.runInContext(chooseFn,env);
  const seen=new Set();
  for(const side of order) {
    assert.equal(vm.runInContext(`nextScrapKind('${side}')`,env),seen.has(side)?'cutlery':'base');seen.add(side);
  }
}
// Loading applies the shorter goal without losing earned progress or changing a worn mounted fist.
for(const save of [
  {scrapEquips:0,arms:{L:{I:0},R:{I:0}}},
  {scrapEquips:1,arms:{L:{I:.8,scrap:{kind:'base',lump:70}},R:{I:.75}}},
  {scrapEquips:9,scrapEquipsBySide:{L:8,R:1},arms:{L:{I:.9},R:{I:.8}}},
  {arms:{L:{I:.8,scrap:{kind:'wire',lump:30}},R:{I:.75}}},
]) {
  const stored={v:2,owned:['cement'],wall:'cement',endure:700,openedAt:0,stageSpanScale:1.5,...save};
  const env={G:{},WALLS,SAVE_KEY:'x',localStorage:{getItem:()=>JSON.stringify(stored)}};
  assert.equal(vm.runInNewContext(loadFn+'\nload()',env),true);
  assert.equal(env.G.stageSpanScale,1);assert.equal(env.G.endure,700);
  assert.equal(JSON.stringify(env.G.arms),JSON.stringify(stored.arms));
  assert.equal(env.G.scrapEquipsBySide.R,save.scrapEquips>=2?1:0);
}
console.log(`PASS: ${scenarios} wall simulations, worn/single iron rounds, 8 wall transitions, first mounts and legacy saves`);
