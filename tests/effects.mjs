// node --experimental-loader ./tests/three-loader.mjs tests/effects.mjs
// Optional IRONFIST_BASELINE_DIR compares seeded effect geometry against an earlier release.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
const root = new URL('../', import.meta.url);
const read = (f, baseline=false) => fs.readFileSync(baseline ? `${process.env.IRONFIST_BASELINE_DIR}/${f}` : new URL(f,root),'utf8');
const slice = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const rnd = (a,b) => a+Math.random()*(b-a);
const V = () => new THREE.Vector3();
const seeded = seed => () => { seed=Math.imul(seed,1664525)+1013904223|0; return (seed>>>0)/4294967296; };
const withSeed = (seed,fn) => { const old=Math.random; Math.random=seeded(seed); try{return fn();}finally{Math.random=old;} };
function classes(baseline=false) {
  const sk=read('skills.js',baseline),fx=read('fx.js',baseline);
  const load=(src,name,extra={})=>new Function('THREE','V','rnd','TONE',...Object.keys(extra),`${slice(src,`class ${name} {`,'\n// ------------------------------------------------------------------')}\nreturn ${name};`)(THREE,V,rnd,'',...Object.values(extra));
  return { Bolts:load(sk,'Bolts'),Arcs:load(fx,'Arcs'),Puffs:load(fx,'Puffs',{SPRITE:new THREE.Texture(),PUFF_SCALE:{value:1}}),
    Ghosts:load(sk,'Ghosts',{GHOST_LAYERS:{L:[3,4],R:[5,6]},makeGhostMaterial:()=>new THREE.MeshStandardMaterial({transparent:true,depthWrite:false})}) };
}
const C=classes(), old=process.env.IRONFIST_BASELINE_DIR?classes(true):null;
const camera=new THREE.PerspectiveCamera(); camera.position.set(.1,.1,2);camera.updateMatrixWorld();
const near=(a,b,label)=>{assert.equal(a.length,b.length,label);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-6,`${label}[${i}]: ${a[i]} vs ${b[i]}`);};
function compareMesh(a,b,count) {
  for(const n of ['position','color','aD'])if(a.geometry.attributes[n]) {
    const x=a.geometry.attributes[n],y=b.geometry.attributes[n];
    near(x.array.subarray(0,count*x.itemSize),y.array.subarray(0,count*x.itemSize),n);
  }
}
// Dense lightning, delayed/following branches, eviction, expiration and pool re-use.
const bolts=new C.Bolts(new THREE.Scene()), before=old&&new old.Bolts(new THREE.Scene());
for(let frame=0;frame<360;frame++) {
  for(const b of [bolts,before].filter(Boolean))withSeed(1000+frame,()=>{
    if(frame%3===0)for(let i=0;i<8;i++)b.add(new THREE.Vector3(i*.02,0,-1),new THREE.Vector3(.3,.6,-.9),{life:.25,delay:i%3*.02,branch:.85,flick:.025,follow:()=>[new THREE.Vector3(.01*frame,0,-1),new THREE.Vector3(.3,.6,-.9)]});
    b.update(1/60,camera);
  });
  assert.ok(bolts.list.length<=40);
  if(before){assert.equal(bolts.list.length,before.list.length);for(const n of ['glow','core']){assert.equal(bolts[n].geometry.drawRange.count,before[n].geometry.drawRange.count);compareMesh(bolts[n],before[n],bolts[n].geometry.drawRange.count);}}
}
assert.ok(bolts.glow.geometry.drawRange.count>0);
bolts.clear(); const pool=bolts.freePools.at(-1);const vectors=new Set(pool.v);
bolts.add(V(),new THREE.Vector3(0,1,0),{branch:0});assert.equal(bolts.list[0].pool,pool);assert.ok(vectors.has(bolts.list[0].paths[0][0]));
bolts.update(1,camera);assert.equal(bolts.glow.visible,false);assert.equal(bolts.core.geometry.drawRange.count,0);
const bv=bolts.glow.geometry.attributes.position.version;for(let i=0;i<30;i++)bolts.update(1/60,camera);assert.equal(bolts.glow.geometry.attributes.position.version,bv);
for(const name of ['Arcs','Puffs']) {
  const a=name==='Arcs'?new C.Arcs():new C.Puffs(80);
  const b=old&&(name==='Arcs'?new old.Arcs():new old.Puffs(80));
  const points=a.points?.slice();
  for(let frame=0;frame<160;frame++) {
    for(const effect of [a,b].filter(Boolean))withSeed(2000+frame,()=>{
      if(frame<80&&frame%4===0) {
        if(name==='Arcs')effect.burst(new THREE.Vector3(.1,.2,-.8),6,.9);
        else for(let i=0;i<12;i++)effect.emit({x:rnd(-1,1),vy:.3,vz:-.5,life:rnd(.05,.4),g:-2,drag:.5,grow:1.7,pop:i%2});
      }
      effect.update(1/60);
    });
    const n=name==='Arcs'?a.arcs.length*a.seg*12:a.p.length;
    assert.equal(a.obj.geometry.drawRange.count,n);assert.equal(a.obj.visible,n>0);
    if(b)compareMesh(a.obj,b.obj,n);
  }
  if(points)for(let i=0;i<points.length;i++)assert.equal(a.points[i],points[i]);
  const v=a.obj.geometry.attributes.position.version;a.update(1/60);assert.equal(a.obj.geometry.attributes.position.version,v);
  if(name==='Arcs')a.add(V(),new THREE.Vector3(1,0,0));else a.emit({life:1});a.update(.01);assert.equal(a.obj.visible,true);
}
function ghostRun(K,mode='trail',throwRender=false) {
  const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera();scene.background=new THREE.Color('red');
  const arms={};const originals=[];
  for(const side of ['L','R']) {
    const root=new THREE.Group();scene.add(root);
    const skin=new THREE.Mesh(),upper=new THREE.Mesh(),metal=new THREE.Mesh(),glow=new THREE.Mesh();
    skin.name=side+'skin';upper.name=side+'upper';metal.name=side+'metal';glow.name=side+'glow';
    root.add(skin,upper);const group=new THREE.Group();group.add(metal,glow);root.add(group);
    arms[side]={root,skin,upper,U:{},scrap:{lumpHP:140},scrapObj:{group,glow}};
    for(const m of [skin,upper,metal,glow])originals.push([m,m.material,m.renderOrder]);
  }
  const ghost=new K(arms,[]);ghost.on={L:1,R:.7};ghost.mode={L:mode,R:mode};
  for(let i=0;i<24;i++)for(const s of ['L','R']){arms[s].root.position.set(i*.02,s==='L'?-.1:.1,0);ghost.record(s);}
  assert.equal(ghost.hist.L.length,14);
  const hist=new Set(ghost.hist.L);ghost.record('L');if(K===C.Ghosts)assert.ok(hist.has(ghost.hist.L.at(-1)));
  const pos=Object.fromEntries(Object.entries(arms).map(([s,a])=>[s,a.root.position.clone()]));
  const draws=[];let renders=0;const renderer={shadowMap:{autoUpdate:true},render(sc,c){
    renders++;if(throwRender)throw new Error('render failure');
    const meshes=[];sc.traverse(o=>{if(o.isMesh&&o.visible&&c.layers.test(o.layers))meshes.push(o);});
    meshes.sort((a,b)=>a.renderOrder-b.renderOrder);
    for(const o of meshes){const mat=sc.overrideMaterial||o.material;draws.push({name:o.name,opacity:mat.opacity,p:o.getWorldPosition(V()).toArray()});}
  }};
  const bg=scene.background;
  if(throwRender)assert.throws(()=>ghost.render(renderer,scene,cam),/render failure/);else withSeed(6789,()=>ghost.render(renderer,scene,cam));
  for(const [m,mat,order] of originals){assert.equal(m.material,mat);assert.equal(m.renderOrder,order);}
  for(const s of ['L','R'])assert.ok(arms[s].root.position.equals(pos[s]));
  assert.equal(cam.layers.mask,1);assert.equal(scene.background,bg);assert.equal(scene.overrideMaterial,null);assert.equal(scene.matrixWorldAutoUpdate,true);assert.equal(renderer.shadowMap.autoUpdate,true);
  assert.ok(draws.every(x=>!x.name.endsWith('glow')));
  return {draws,renders};
}
for(const mode of ['trail','shimmer']) {
  const a=ghostRun(C.Ghosts,mode);assert.equal(a.renders,mode==='trail'?10:4);
  if(old){const b=ghostRun(old.Ghosts,mode);assert.deepEqual(a.draws,b.draws);assert.equal(a.renders*2,b.renders);}
}
ghostRun(C.Ghosts,'trail',true);
// Audio routing, rate, volume and start time remain identical; only expired private nodes disconnect.
function audioRun(baseline,opts) {
  const source=read('sfx.js',baseline),body=slice(source,'  play(name,','\n  // 자동재생');
  const play=new Function(`return ({${body}}).play`)();const nodes=[];
  const node=kind=>{const n={kind,links:[],disconnected:0,connect(x){this.links.push(x.kind);},disconnect(){this.disconnected++;},gain:{value:0},pan:{value:0},playbackRate:{value:0},start(t){this.time=t;}};nodes.push(n);return n;};
  const env={ready:true,B:{zap:['a','b']},master:node('master'),dry:node('dry'),verb:node('verb'),ctx:{currentTime:123,createBufferSource:()=>node('source'),createGain:()=>node('gain'),createStereoPanner:()=>node('panner')}};
  withSeed(42,()=>play.call(env,'zap',.8,opts));
  const snapshot=nodes.map(({kind,links,gain,pan,playbackRate,time,buffer})=>({kind,links,gain,pan,playbackRate,time,buffer}));
  const src=nodes.find(x=>x.kind==='source');if(!baseline){src.onended();assert.equal(src.onended,null);for(let i=0;i<nodes.length;i++)assert.equal(nodes[i].disconnected,i<3?0:1);}
  return snapshot;
}
for(const opts of [{},{pan:.5,delay:.03,rate:.9,jitter:.05,verbAmt:.3},{dry:true,verb:false,pan:-2}]){const a=audioRun(false,opts);if(old)assert.deepEqual(a,audioRun(true,opts));}
console.log('PASS: effects geometry, pooling/idle buffers, ghost rendering/restoration and audio lifecycle'+(old?' (including seeded previous-release comparison)':''));
