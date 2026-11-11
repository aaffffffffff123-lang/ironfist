// node --experimental-loader ./tests/three-loader.mjs tests/prosthesis.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { Scrap, SCRAP_KINDS } from '../scrap.js';
import { Arm, SCRAP_STUMP_I } from '../arm.js';
globalThis.location = { search: '' };
const approx = (a,b,message) => assert.ok(Math.abs(a-b)<1e-6, `${message}: ${a} != ${b}`);
const makeArm = (I,side='L') => ({ I, side, cutZ: .004-(I-.5)*.532, crushZ: .004-(I-.5)*.532,
 attach: {forearm:new THREE.Group()}, traps:[], hasFist:Arm.prototype.hasFist });
let scenarios=0;
for(const kind of SCRAP_KINDS) for(const side of ['L','R']) {
 let nominalReach;
 for(const I of [.5,.6,.75,.9,1]) {
  const arm=makeArm(I,side), scrap=new Scrap(arm,4101,kind);
  arm.scrapObj=scrap;arm.scrap=scrap.state;
  approx(scrap.mountZ,arm.cutZ,'mount at remaining flesh');
  approx(scrap.group.position.z,0,'no translating shortened arm');
  approx(scrap.lump.position.z,.05,'original fist position');
  approx(Arm.prototype.restShift.call(arm),0,'no guard compensation');
  const reach=Arm.prototype.reach.call(arm);nominalReach ??=reach;approx(reach,nominalReach,'same reach across stump lengths');
  assert.equal(scrap.state.pipeHP,0,'shaft shares head lifetime');
  const bounds=new THREE.Box3().setFromObject(scrap.group);
  assert.ok(bounds.min.z<=arm.cutZ,'metal reaches stump');
  assert.ok(bounds.max.z>.08,'metal reaches fist');
  if(I>=.75)assert.ok(scrap.pipe,'half-forearm and shorter stumps have actual shaft');
  scrap.group.traverse(o=>{for(const n of [...o.position,...o.scale,...o.quaternion])assert.ok(Number.isFinite(n));});
  arm.cutZ-=.018;scrap.update(.016,0);
  approx(scrap.socket.position.z,-.018,'socket follows joint damage');
  assert.ok(scrap.stumpSleeve.visible,'no new gap at damaged joint');
  const sleeveBounds=new THREE.Box3().setFromObject(scrap.stumpSleeve);
  assert.ok(sleeveBounds.min.z<arm.cutZ&&sleeveBounds.max.z>scrap.mountZ,'sleeve bridges new loss');
  const initial= scrap.parts.length;
  scrap.state.lumpHP=70;scrap.onDamage('lump',{flyScrapPart:p=>p.removeFromParent()},null,null);
  assert.ok(scrap.parts.length<initial&&scrap.parts.length>0,'partial damage still works');
  scrap.state.lumpHP=0;scrap.onDamage('lump',{flyScrapPart:p=>p.removeFromParent()},null,null);
  assert.equal(scrap.socket,null);assert.equal(scrap.stumpSleeve,null);assert.equal(scrap.pipe,null);
  let remaining=0;scrap.group.traverse(o=>{if(o.isMesh&&o!==scrap.glow)remaining++;});
  assert.equal(remaining,0,'head break drops all structural metal');
  scrap.update(.016,1);scrap.dispose();scenarios++;
 }
}
// Eligibility: bare forearm keeps playing until halfway, mounted arm can start.
for(const I of [.49,.5,.6,.749,.75,.9,1]) {
 const a=makeArm(I);assert.equal(Arm.prototype.needsScrap.call(a),I>=SCRAP_STUMP_I);
 a.scrap={lumpHP:140,pipeHP:0};assert.equal(Arm.prototype.needsScrap.call(a),false);
}
// Check the actual end-of-round function and goal calculation without WebGL.
const source=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
const roundFn=source.slice(source.indexOf('function checkRoundEnd()'),source.indexOf('\nfunction endRound()'));
const goalFn=source.slice(source.indexOf('function goal()'),source.indexOf('// 벽에 익숙해진 정도'));
const mk=(I,metal=false)=>{const a=makeArm(I);a.needsScrap=()=>Arm.prototype.needsScrap.call(a);if(metal)a.scrap={lumpHP:140,pipeHP:0};return a;};
for(const [left,right,metal,end] of [[.5,.5,false,false],[.75,.7,false,false],[.75,.75,false,true],[1,.75,false,true],[1,1,true,false]]) {
 const env={round:{ended:false},arms:{L:mk(left,metal),R:mk(right)},G:{cleared:false},time:0,cancelAllInputs(){},fists:{},chain:[],setTimeout(){},endRound(){},BACK_T:.2};
 vm.runInNewContext(roundFn+'\ncheckRoundEnd();',env);assert.equal(env.round.ended,end);
}
for(const scale of [1,1.5]) {
 const walls=[{id:'nails'},{id:'freezer'}], env={G:{openedAt:0,endure:6310,stageSpanScale:scale},WALLS:walls,OPEN_SPAN:[7930],HANDS_SPAN:31040,nextWall:()=>walls[1]};
 const g=vm.runInNewContext(goalFn+'\ngoal();',env);assert.equal(g.to,7930*scale);
}
console.log(`PASS: ${scenarios} prosthesis configurations, shaft damage, half-forearm gate, round end and legacy/new goals`);
// Existing saves with only a missing hand restore the longer metal arm and wear.
const restoreFn=source.slice(source.indexOf('function restoreArm('),source.indexOf('// UI에서 부르는 동작들'));
for(const kind of SCRAP_KINDS){
 const a=makeArm(.5);
 a.reset=function(){this.I=0;this.scrap=null;};
 a.setStump=function(I){this.I=I;this.cutZ=this.crushZ=.004-(I-.5)*.532;};
 const env={Scrap,SCRAP_KINDS,SCRAP_STUMP_I,a,snap:{I:.53,scrap:{seed:11,kind,lump:70}}};
 vm.runInNewContext(restoreFn+'\nrestoreArm(a,snap);',env);
 approx(a.I,.75,'old mounted save reaches half forearm');
 approx(a.scrapObj.mountZ,a.cutZ,'restored shaft reaches flesh');
 assert.equal(a.scrap.lumpHP,70,'saved wear preserved');a.scrapObj.dispose();
}
console.log('PASS: six worn legacy iron fists restore with half-forearm shafts');
