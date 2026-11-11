// node --experimental-loader ./tests/three-loader.mjs tests/paper.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadArmAssets,initAnatomy,Arm } from '../arm.js';
import { WALLS } from '../walls.js';
const source=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
globalThis.location={search:''};
const assets=await loadArmAssets();initAnatomy(assets.header);
const arms=Object.fromEntries(['L','R'].map(s=>[s,new Arm(assets,s)]));
const G={owned:['cement'],wall:'cement',arms:{},cleared:false};
let saved=0,disposed=0,hints=0;
const noop=()=>{};
const env={G,arms,WALLS,mode:'shop',round:{},chain:[],hitstop:0,rush:0,cam:{},endingTimer:0,
  resetArmMotion:noop,cancelAllInputs:noop,save(){saved++;},saveFree(){saved++;},skillFx:{clear:noop,setSkill:noop},fx:{bindWall:noop,persist:noop},
  sfx:{unlock:noop,play:noop,ambience:noop},wall:null,scene:{},renderer:{},WALL_D:1,ANAT:{},fists:{},lightPool:{},camera:{},SKILL_OF:{},
  ui:{hud:noop,hidePanels:noop,showShop:noop,hideEnding:noop,endure:noop},document:{body:{classList:{add:noop,remove:noop}}},clearTimeout:noop,
  onPaperTorn:noop,newRound:noop,goal:()=>({}),render:noop,showHint(){hints++;},
  createWall(id){return {def:WALLS.find(w=>w.id===id),dispose:noop,renew:noop,state:'intact'};}};
vm.createContext(env);
vm.runInContext(section('function freshHands()','// ------------------------------------------------------------------ 판')+'\n'+section('function setWall(id)','// ------------------------------------------------------------------ 입력')+'\n'+section('const actions = {','// 디버그(자동 테스트용)')+'\nglobalThis.A=actions;',env);
const A=env.A;
assert.equal(A.selectWall('paper'),false);assert.equal(G.wall,'cement');
function damageHands(){for(const a of Object.values(arms)){a.setStump(.8);a.scrap={lumpHP:140};a.scrapObj={dispose(){disposed++;}};}}
function bare(){for(const a of Object.values(arms)){assert.equal(a.I,0);assert.equal(a.scrap,null);assert.equal(a.scrapObj,null);}assert.equal(A.canStart(),true);}
// Unlocked but ending not seen: paper can be revisited, including with iron on both hands.
G.owned=WALLS.map(w=>w.id);damageHands();assert.equal(A.selectWall('paper'),true);bare();assert.equal(disposed,2);assert.ok(saved>0);
assert.equal(A.scrap('L'),false);assert.equal(A.selectWall('cement'),true);damageHands();assert.equal(A.selectWall('paper'),true);bare();
// Old paper saves are normalized at resume/start, before any strike or equipment UI.
for(const cleared of [false,true]){G.cleared=cleared;damageHands();assert.equal(A.canStart(),false);assert.equal(A.start(),true);bare();assert.equal(A.equip('both','scrap'),false);assert.equal(A.scrap('R'),false);}
// Ending -> free play and switching away/back keep the same paper restriction.
G.cleared=true;damageHands();A.free();bare();assert.equal(hints,0);
assert.equal(A.selectWall('electric'),true);damageHands();assert.equal(A.selectWall('paper'),true);bare();
// Exercise the production boot boundary after legacy hands have been restored.
env.restoreArm=()=>{};damageHands();
vm.runInContext(section("  // 저장된 팔 상태 복원",'  warmup();'),env);bare();

// Minimal DOM exercises production UI lists and their click handlers, not browser rendering.
class Element {
  constructor(){this.children=[];this.dataset={};this.style={};this.listeners={};this.attrs={};this.classes=new Set();this.classList={add:(...n)=>n.forEach(x=>this.classes.add(x)),remove:(...n)=>n.forEach(x=>this.classes.delete(x)),contains:n=>this.classes.has(n),toggle:(n,v)=>v?this.classes.add(n):this.classes.delete(n)};}
  set innerHTML(s){this.html=s;this.children=[];}get innerHTML(){return this.html||'';}
  appendChild(c){c.parent=this;this.children.push(c);}replaceWith(c){this.parent.children[this.parent.children.indexOf(this)]=c;c.parent=this.parent;}
  querySelector(s){const side=s.match(/data-side="(.*?)"/);return side?this.children.find(c=>c.dataset.side===side[1]):null;}
  querySelectorAll(){return [];}
  setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,f){this.listeners[k]=f;}
}
const elements=new Map();const $=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
const uis=fs.readFileSync(new URL('../ui.js',import.meta.url),'utf8').replace(/^import .*\n/m,'').replace('export class UI','class UI');
const UI=new Function('document','matchMedia','window','fistDent',uis+'\nreturn UI;')({querySelector:$,createElement:()=>new Element()},()=>({matches:false}),{},()=>'<svg></svg>');
const ui=Object.create(UI.prototype);ui.G=G;ui.WALLS=WALLS;ui.A={...A,goal:()=>({kind:'wall',wall:WALLS.at(-1),from:0,to:100,endure:0}),nextWall:()=>WALLS.at(-1)};
ui.el=Object.fromEntries(['hud','wallName','endure','handBtn','handMenu','wallMenu','playWalls'].map(k=>[k,$('#'+k)]));
const hasPaper=list=>list.children.some(c=>c.innerHTML.includes(WALLS.at(-1).name));
G.wall='cement';G.owned=WALLS.filter(w=>!w.paper).map(w=>w.id);G.cleared=false;
ui.renderShop();ui.renderPlayWalls();assert.equal(hasPaper($('#sWalls')),false);assert.equal(hasPaper(ui.el.playWalls),false);
G.owned.push('paper');ui.renderShop();ui.renderPlayWalls();assert.equal(hasPaper($('#sWalls')),true);assert.equal(hasPaper(ui.el.playWalls),true);
// Both selectors can enter paper before the ending has been seen.
$('#sWalls').children.find(c=>c.innerHTML.includes(WALLS.at(-1).name)).listeners.click();assert.equal(G.wall,'paper');bare();
assert.equal($('#wallPicker').hidden,false);
A.selectWall('cement');ui.renderPlayWalls();ui.el.playWalls.children.find(c=>c.innerHTML.includes(WALLS.at(-1).name)).listeners.click();assert.equal(G.wall,'paper');bare();
for(const cleared of [false,true]){G.cleared=cleared;ui.el.handMenu.classList.add('show');ui.hud(true);assert.equal(ui.el.handBtn.hidden,true);assert.equal(ui.el.handBtn.disabled,true);ui.openHands();assert.equal(ui.el.handMenu.classList.contains('show'),false);}
G.wall='electric';G.cleared=true;ui.hud(true);assert.equal(ui.el.handBtn.hidden,false);ui.openHands();assert.equal(ui.el.handMenu.classList.contains('show'),true);
console.log('PASS: paper unlock visibility, both selectors, revisit/resume/free play, bare-hand enforcement and equipment controls');
