// 철권 — 메인
import * as THREE from 'three';
import { RoomEnvironment } from './room-env.js';
import { loadArmAssets, initAnatomy, Arm, W as WT, SEG, ANAT } from './arm.js';
import { WALLS, createWall } from './walls.js';
import { FX } from './fx.js';
import { SFX } from './sfx.js';
import { Scrap } from './scrap.js';
import { UI } from './ui.js';

const WALL_D = 0.62;                 // 카메라 → 벽 거리
const FLESH_RATE = 400;              // 살 손실 1.0 당 크레딧(벽 배율 전)
const SCRAP_RATE = 1.2;              // 고철 HP 1 당 크레딧
const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (t) => 1 - Math.pow(1 - t, 3);

// ------------------------------------------------------------------ 렌더러
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const QS = new URLSearchParams(location.search);
renderer.toneMapping = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[QS.get('tm') || 'aces'];
renderer.toneMappingExposure = +(QS.get('exp') || 0.95);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfb8ad);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = +(QS.get('env') || 0.3);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 20);
camera.layers.enable(0);

const hemi = new THREE.HemisphereLight(0xfff5ea, 0x7a6c60, +(QS.get('hemi') || 0.45));
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0dc, +(QS.get('key') || 3.6));
key.position.set(-0.55, 0.95, 0.35);
key.target.position.set(0.05, -0.12, -0.55);
key.castShadow = true;
{ const sm = +(QS.get('sm') || 2048); key.shadow.mapSize.set(sm, sm); }
{ const c = key.shadow.camera; c.left = -0.55; c.right = 0.55; c.top = 0.55; c.bottom = -0.55; c.near = 0.2; c.far = 3; }
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.0015;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xdfe6ff, +(QS.get('fill') || 0.3));
fill.position.set(0.8, 0.2, 0.3);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(0.2, 0.6, -1.2);
scene.add(rim);
// 벽이 빌려 쓰는 점광원(늘 2개 — 벽을 바꿔도 재질을 다시 컴파일하지 않게)
const lightPool = [0, 1].map(() => { const l = new THREE.PointLight(0xffffff, 0, 1, 2); l.position.set(0, -0.1, -0.5); scene.add(l); return l; });

// 엑스레이 덮개
const xrayVeil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x050a14, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
xrayVeil.layers.set(1); xrayVeil.renderOrder = 5; xrayVeil.frustumCulled = false;
xrayVeil.position.set(0, 0, -0.05); xrayVeil.scale.set(0.2, 0.2, 1);
camera.add(xrayVeil); scene.add(camera);

// ------------------------------------------------------------------ 상태
const SAVE_KEY = 'cheolgwon.v1';
const G = {
  credits: 0, owned: ['cement'], wall: 'cement',
  stats: { rounds: 0, total: 0 },
  arms: { L: { kind: 'flesh' }, R: { kind: 'flesh' } },
  decals: {}, stuck: {},
  seenHints: {},
};
let assets, arms = {}, wall = null, fx, sfx, ui;
let mode = 'title';      // title | play | over | shop
let round = null;
let time = 0, hitstop = 0, shake = 0, xray = 0;
let layout = { portrait: false, k: 1 };

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {}
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && s.owned) Object.assign(G, s); return !!s; } catch (e) { return false; }
}

// ------------------------------------------------------------------ 자세
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function basisQuat(D, U) {
  const z = D.clone().normalize();
  const y = U.clone().addScaledVector(z, -U.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  tmpM.makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(tmpM);
}
function mirrorQ(q) { return new THREE.Quaternion(q.x, -q.y, -q.z, q.w); }

// 왼팔 기준 자세 (오른팔은 좌우 대칭)
// 휴식: 가드 자세(주먹이 위로 살짝 들림). 타격: 어깨에서 표적까지 뻗은 방향
function poses(side, armObj) {
  const s = side === 'L' ? 1 : -1;
  const p = layout.portrait;
  const restPos = new THREE.Vector3(p ? -0.080 : -0.125, p ? -0.142 : -0.150, p ? -0.300 : -0.290);
  const restD = new THREE.Vector3(p ? 0.10 : 0.16, 0.30, -1);
  const restU = new THREE.Vector3(-0.30, 1, 0.05);
  const shoulder = new THREE.Vector3(p ? -0.165 : -0.19, -0.25, -0.03);
  const hitTarget = new THREE.Vector3(-(p ? 0.044 : 0.058), p ? -0.045 : -0.05, -WALL_D);
  const hitU = new THREE.Vector3(-0.10, 1, 0);
  const reach = armObj ? armObj.reach() : 0.097;
  const stop = wall ? wall.stopDepth : 0;
  const contact = hitTarget.clone(); contact.z += stop;
  const D1 = contact.clone().sub(shoulder).normalize();
  const p1 = contact.clone().addScaledVector(D1, -reach);
  const p0 = restPos.clone();
  let q0 = basisQuat(restD, restU), q1 = basisQuat(D1, hitU);
  if (s < 0) {
    p0.x = -p0.x; p1.x = -p1.x; contact.x = -contact.x;
    q0 = mirrorQ(q0); q1 = mirrorQ(q1);
  }
  return { p0, q0, p1, q1, D1: s < 0 ? new THREE.Vector3(-D1.x, D1.y, D1.z) : D1, contact };
}

// ------------------------------------------------------------------ 팔 컨트롤러
class Fist {
  constructor(arm) {
    this.arm = arm;
    this.state = 'idle';
    this.t = 0;           // 0=휴식, 1=타격
    this.queue = 0;
    this.stuckTaps = 0; this.pinT = 0; this.sinkT = 0; this.spasm = 0; this.spasmT = 0;
    this.flinchUntil = 0;
    this.recoil = 0; this.tug = 0; this.tremble = 0;
    this.lastPress = -9;
  }
  press(now) {
    const st = this.state;
    if (mode !== 'play') return;
    if (!this.arm.canPunch()) { this.recoil = 0.25; sfx.play('stumpTwitch', 0.2); return; }
    if (st === 'stuck') { onTug(this, now); return; }
    if (st === 'pinned') { onTug(this, now); return; }
    if (st === 'idle' || st === 'back') {
      if (now < this.flinchUntil) { this.queue = 1; return; }
      this.startPunch(now);
    } else this.queue = Math.min(1, this.queue + 1);
  }
  startPunch(now) {
    this.state = 'out';
    this.outStart = this.t;
    this.lastPress = now;
    registerPunch(this, now);
    sfx.play('whoosh', 0.35 + Math.random() * 0.15);
  }
  speed() {
    let s = 1;
    const a = this.arm;
    if (a.traps.length) s *= 1 / (1 + a.traps.length * 0.16);
    if (a.scrap && a.scrap.lumpHP > 0) s *= 0.78;
    return s;
  }
  update(dt, now) {
    const a = this.arm;
    switch (this.state) {
      case 'out': {
        this.t = Math.min(1, this.t + dt / (0.105 / this.speed()));
        if (this.t >= 1) { this.state = 'hit'; this.hold = 0.055; onImpact(this, now); }
        break;
      }
      case 'hit': {
        this.hold -= dt;
        if (this.hold <= 0 && this.state === 'hit') this.state = 'back';
        break;
      }
      case 'stuck': case 'pinned': {
        if (this.state === 'pinned') { this.pinT -= dt; if (this.pinT <= 0) release(this, now, true); }
        if (this.state === 'stuck') { this.stuckT += dt; if (this.stuckT > 2.6) release(this, now, true); }
        break;
      }
      case 'sink': {
        this.sinkT -= dt;
        if (this.sinkT <= 0) { this.state = 'back'; this.slowBack = 0.55; sfx.play('suction', 0.7); }
        break;
      }
      case 'spasm': {
        this.spasmT -= dt;
        if (this.spasmT <= 0) {
          if (this.spasm > 0) { this.spasm--; this.state = 'out'; this.t = 0.55; this.spasmT = 0; this.autoPunch = true; }
          else this.state = 'back';
        }
        break;
      }
      case 'back': {
        const dur = this.slowBack || 0.16;
        this.t = Math.max(0, this.t - dt / dur);
        if (this.t <= 0) { this.state = 'idle'; this.slowBack = 0; this.autoPunch = false; }
        if (this.queue > 0 && this.t < 0.65 && now >= this.flinchUntil) { this.queue--; this.startPunch(now); }
        break;
      }
      case 'idle': {
        if (this.queue > 0 && now >= this.flinchUntil) { this.queue--; this.startPunch(now); }
        break;
      }
    }
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.tug = Math.max(0, this.tug - dt * 6);
  }
  pose(out) {
    const P = poses(this.arm.side, this.arm);
    const t = this.state === 'out' ? ease(this.t) : (this.state === 'back' ? this.t * this.t * (3 - 2 * this.t) : this.t);
    out.position.lerpVectors(P.p0, P.p1, t);
    // 휘두르는 호
    out.position.y += Math.sin(t * Math.PI) * 0.02;
    out.quaternion.slerpQuaternions(P.q0, P.q1, t);
    // 반동·당기기·떨림
    const back = this.recoil * 0.03 + this.tug * 0.02;
    out.position.addScaledVector(P.D1, -back);
    if (this.state === 'sink') out.position.addScaledVector(P.D1, 0.04 * (1 - Math.max(0, this.sinkT) / 0.4));
    if (this.state === 'pinned') out.position.addScaledVector(P.D1, -0.004 * Math.sin(time * 60) * this.tug);
    const tr = this.tremble * (0.0012 + this.arm.I * 0.002);
    out.position.x += Math.sin(time * 37 + (this.arm.side === 'L' ? 0 : 2)) * tr;
    out.position.y += Math.sin(time * 41.3 + 1) * tr;
    // 숨 쉬는 듯한 미세한 움직임
    out.position.y += Math.sin(time * 1.7 + (this.arm.side === 'L' ? 0 : 1.3)) * 0.0025 * (1 - t);
  }
}

// ------------------------------------------------------------------ 태권도 판정
let chain = [];
let tkdPlayingUntil = 0;
function registerPunch(fist, now) {
  if (fist.autoPunch) return;
  chain.push({ side: fist.arm.side, t: now, credits: 0, fist });
  if (chain.length > 3) chain.shift();
  fist.pendingChain = chain[chain.length - 1];
  if (chain.length === 3) {
    const [a, b, c] = chain;
    const alt = a.side !== b.side && b.side !== c.side;
    const fast = (b.t - a.t) < 0.42 && (c.t - b.t) < 0.42;
    if (alt && fast) {
      if (now >= tkdPlayingUntil) { sfx.voice('tkd'); tkdPlayingUntil = now + 0.85; }
      round.tkd++;
      const group = { links: chain.slice(), paid: false };
      for (const l of group.links) l.group = group;
      payTkd(group);
      chain = [];
    }
  }
}

// 세 대가 다 맞고 나면 그 세 대 크레딧의 절반을 더
function payTkd(group) {
  if (group.paid || !group.links.every((l) => l.done)) return;
  group.paid = true;
  let sum = 0; for (const l of group.links) sum += l.credits;
  addCredits(Math.round(sum * 0.5), true);
}

// ------------------------------------------------------------------ 타격
function onImpact(fist, now) {
  const a = fist.arm;
  const res = { flesh: 0, scrap: 0, ev: [], point: null, finger: -1 };
  const W = wall.def;
  const P = poses(a.side, a);
  // 벽 고유 반응 먼저 (걸림·경련 등)
  fx.lastContact = P.contact.clone();
  const react = wall.impact(fist, a, P.contact) || {};
  // 피해량
  const base = W.dmg * rnd(0.8, 1.2) * (react.dmgMul || 1);
  let left = base;
  if (a.scrap && (a.scrap.lumpHP > 0 || a.scrap.pipeHP > 0)) {
    const sd = W.scrapDmg * rnd(0.8, 1.25) * (react.dmgMul || 1);
    const before = a.scrap.lumpHP;
    a.damageScrap(sd, res);
    scrapBreakFx(a, res, P.contact);
    // 연결부 살도 다침(철사가 파고듦)
    a.damageFlesh(base * 0.12, W.kind, res);
    a.addWound(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.004, 0.012), Math.min(a.cutZ, 0.006) - 0.036), 0.03, WT.WIRE, Math.min(1, 0.4 + (140 - a.scrap.lumpHP) / 170));
    a._apply();
    left = 0;
  } else {
    a.damageFlesh(left, W.kind, res);
  }
  // 크레딧
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  if (fist.pendingChain) { const l = fist.pendingChain; l.credits = credits; l.done = true; fist.pendingChain = null; if (l.group) payTkd(l.group); }
  addCredits(credits);
  // 연출
  const power = clamp(0.4 + res.flesh * 40 + res.ev.length * 0.3, 0.3, 1.6);
  fx.impact(a, P.contact, power, res, W, react);
  sfx.impact(W.id, res, power, a);
  for (const e of res.ev) handleEvent(a, e, P.contact);
  a.kick(power);
  fist.recoil = react.stick ? 0 : 0.6;
  hitstop = Math.max(hitstop, react.stick ? 0.03 : 0.045 + (res.ev.some((e) => e.t === 'fract') ? 0.05 : 0));
  shake = Math.max(shake, 0.35 + power * 0.25);
  vibrate(res.ev.length ? 28 : 12);
  round.punches++;
  // 걸림 상태
  if (react.stick === 'stuck') { fist.state = 'stuck'; fist.stuckTaps = react.taps || 3; fist.stuckT = 0; showHint('stuck'); }
  else if (react.stick === 'pinned') { fist.state = 'pinned'; fist.pinT = react.pin || 2; fist.stuckTaps = 99; showHint('pinned'); }
  else if (react.stick === 'sink') { fist.state = 'sink'; fist.sinkT = react.sink || 0.4; }
  else if (react.spasm && !fist.autoPunch) { fist.state = 'spasm'; fist.spasm = react.spasm; fist.spasmT = 0.06; }
  else if (fist.autoPunch && fist.spasm > 0) { fist.state = 'spasm'; fist.spasmT = 0.07; }
  else if (fist.autoPunch) { fist.state = 'spasm'; fist.spasmT = 0.05; }
  if (react.flinch) fist.flinchUntil = now + react.flinch;
  checkRoundEnd();
}

function eventCredits(evs) {
  let c = 0;
  for (const e of evs) {
    c += { fract: 15, nail: 10, finger: 25, wrist: 30, hand: 60, stump: 4, lumpGone: 8, pipeGone: 5 }[e.t] || 0;
  }
  return c;
}

function handleEvent(a, e, contact) {
  if (e.t === 'fract') { xray = Math.max(xray, 1); sfx.play('crack', 0.9); hitstop = Math.max(hitstop, 0.09); round.fract++; }
  if (e.t === 'nail') { sfx.play('nailRip', 0.8); fx.flyNail(a, e.f); round.nail++; }
  if (e.t === 'finger') { sfx.play('detach', 0.8); fx.flyFinger(a, e.f, wall); round.finger++; }
  if (e.t === 'wrist') { sfx.play('crack', 1.0); xray = 1; hitstop = Math.max(hitstop, 0.1); }
  if (e.t === 'hand') { sfx.play('detach', 1.0); fx.flyHand(a, wall); round.hand++; hitstop = Math.max(hitstop, 0.12); }
  if (e.t === 'lumpGone' || e.t === 'pipeGone') { round.scrapGone++; }
}

function scrapBreakFx(a, res, contact) {
  if (!a.scrap) return;
  const n = a.scrapObj ? a.scrapObj.onDamage(res.scrapHit, fx, wall, contact) : 0;
  round.scrapParts += n;
}

// 박힌 손 빼기(못·냉동) / 꿰인 팔 버둥(꼬챙이)
function onTug(fist, now) {
  const a = fist.arm;
  fist.tug = 1;
  const res = { flesh: 0, scrap: 0, ev: [], point: null };
  const W = wall.def;
  if (a.scrap && a.scrap.lumpHP > 0) { a.damageScrap(W.scrapDmg * 0.3, res); scrapBreakFx(a, res, fx.lastContact || poses(a.side, a).contact); } else a.damageFlesh(W.dmg * 0.35, W.kind, res);
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  addCredits(credits);
  wall.tug(fist, a);
  sfx.play('tear', 0.55 + Math.random() * 0.2);
  for (const e of res.ev) handleEvent(a, e, null);
  vibrate(10);
  if (fist.state === 'stuck') {
    fist.stuckTaps--;
    if (fist.stuckTaps <= 0) release(fist, now, false);
  } else if (fist.state === 'pinned') {
    fist.pinT -= 0.45;
    if (fist.pinT <= 0) release(fist, now, false);
  }
  checkRoundEnd();
}

function release(fist, now, auto) {
  const a = fist.arm;
  const res = { flesh: 0, scrap: 0, ev: [], point: null };
  const W = wall.def;
  if (a.scrap && a.scrap.lumpHP > 0) { a.damageScrap(W.scrapDmg * 0.5, res); scrapBreakFx(a, res, poses(a.side, a).contact); } else a.damageFlesh(W.dmg * 0.6, W.kind, res);
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  addCredits(credits);
  wall.release(fist, a, poses(a.side, a).contact);
  sfx.play('rip', 0.9);
  for (const e of res.ev) handleEvent(a, e, null);
  fist.state = 'back'; fist.slowBack = 0.22;
  fist.recoil = 1;
  hitstop = Math.max(hitstop, 0.05);
  shake = Math.max(shake, 0.4);
  vibrate(30);
  checkRoundEnd();
}

// ------------------------------------------------------------------ 크레딧
function addCredits(n, bonus) {
  if (!n || n <= 0) return;
  G.credits += n; round.earned += n; G.stats.total += n;
  ui.credits(G.credits, n, bonus);
}

// ------------------------------------------------------------------ 판
function newRound() {
  round = { punches: 0, earned: 0, fract: 0, nail: 0, finger: 0, hand: 0, scrapGone: 0, scrapParts: 0, tkd: 0, ended: false, endT: 0 };
  chain = [];
  for (const f of Object.values(fists)) { f.state = 'idle'; f.t = 0; f.queue = 0; }
}

function checkRoundEnd() {
  if (!round || round.ended) return;
  const L = arms.L, R = arms.R;
  if (!L.hasFist() && !R.hasFist()) {
    round.ended = true; round.endT = time;
    setTimeout(() => endRound(), 1500);
  }
}

function endRound() {
  if (mode !== 'play') return;
  mode = 'shop';
  document.body.classList.remove('playing');
  fx.persist();
  sfx.play('end', 0.5);
  G.stats.rounds++;
  // 팔 상태 저장
  for (const s of ['L', 'R']) G.arms[s] = armSnapshot(arms[s]);
  save();
  ui.showShop(round);
}

function armSnapshot(a) {
  const s = { I: +a.I.toFixed(4) };
  if (a.scrap && (a.scrap.lumpHP > 0 || a.scrap.pipeHP > 0)) s.scrap = { lump: a.scrap.lumpHP, pipe: a.scrap.pipeHP, seed: a.scrapSeed || 1 };
  return s;
}

// ------------------------------------------------------------------ 벽
function setWall(id) {
  if (wall) { fx.persist(); wall.dispose(); }
  wall = createWall(id, { scene, renderer, fx, G, WALL_D, anat: ANAT, fists, lightPool, contactOf: (s) => poses(s, arms[s]).contact });
  G.wall = id;
  fx.bindWall(wall);
  // 새 벽 재질은 미리(가능하면 백그라운드로) 컴파일
  try { if (renderer.compileAsync) renderer.compileAsync(wall.group, camera, scene).catch(() => {}); } catch (e) {}
  sfx.ambience(id);
  if (ui) ui.hud(mode === 'play');
}

// ------------------------------------------------------------------ 입력
const fists = {};
function pressSide(side) {
  sfx.unlock();
  if (mode === 'play') fists[side].press(time);
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code;
  if (['KeyF', 'KeyA', 'ArrowLeft', 'KeyD', 'KeyS'].includes(k)) { pressSide('L'); e.preventDefault(); }
  if (['KeyJ', 'KeyL', 'ArrowRight', 'KeyK', 'Semicolon'].includes(k)) { pressSide('R'); e.preventDefault(); }
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) pressSide('L');
  else if (e.button === 2) pressSide('R');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) pressSide(t.clientX < innerWidth / 2 ? 'L' : 'R');
}, { passive: false });

function vibrate(ms) { try { if (navigator.vibrate && G.vibrate !== false) navigator.vibrate(ms); } catch (e) {} }

// ------------------------------------------------------------------ 힌트
function showHint(id) {
  if (G.seenHints[id]) return;
  G.seenHints[id] = true;
  ui.hint(id);
}

// ------------------------------------------------------------------ 크기
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  layout.portrait = w / h < 0.9;
  camera.fov = layout.portrait ? 74 : 58;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, 0);
  camera.lookAt(0, -0.075, -1);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ 루프
let last = performance.now();
const _pos = new THREE.Object3D();
let manual = false;
// 느린 기기면 해상도를 조금씩 낮춤(판 중에 프레임 중앙값이 26ms를 넘으면)
const PR_MAX = Math.min(window.devicePixelRatio || 1, 2);
let pr = PR_MAX, ftBuf = [], ftT = 0;
function adaptRes(raw) {
  if (mode !== 'play' || raw > 0.12) return;
  ftBuf.push(raw); if (ftBuf.length > 90) ftBuf.shift();
  ftT += raw;
  if (ftT < 1.2 || ftBuf.length < 40) return;
  ftT = 0;
  const med = ftBuf.slice().sort((a, b) => a - b)[Math.floor(ftBuf.length / 2)];
  if (med > 0.026 && pr > 0.75) { pr = Math.max(0.75, pr - 0.25); renderer.setPixelRatio(pr); resize(); ftBuf = []; }
}
function frame(nowMs) {
  requestAnimationFrame(frame);
  if (manual) { last = nowMs; return; }
  const raw = (nowMs - last) / 1000;
  adaptRes(raw);
  let dt = Math.min(0.05, raw); last = nowMs;
  if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
  time += dt;
  step(dt);
  render();
}

function step(dt) {
  for (const s of ['L', 'R']) {
    const f = fists[s];
    f.tremble = wall ? wall.def.fear : 0;
    f.update(dt, time);
    f.pose(_pos);
    arms[s].root.position.copy(_pos.position);
    arms[s].root.quaternion.copy(_pos.quaternion);
    arms[s].update(dt, time);
    if (arms[s].scrapObj) arms[s].scrapObj.update(dt, time);
  }
  // 슬라임 산에 고철이 삭음
  if (mode === 'play' && round && !round.ended) {
    for (const s of ['L', 'R']) {
      const a = arms[s], so = a.scrapObj;
      if (so && so.corrode > 0 && a.scrap.lumpHP > 0) {
        so.corrode -= dt;
        const res = { flesh: 0, scrap: 0, ev: [], point: null };
        a.damageScrap(dt * 9, res);
        const n = so.onDamage('lump', fx, wall, fx.lastContact || new THREE.Vector3());
        round.scrapParts += n;
        a._corrAcc = (a._corrAcc || 0) + res.scrap * SCRAP_RATE * wall.def.mult;
        if (a._corrAcc >= 1) { const k = Math.floor(a._corrAcc); a._corrAcc -= k; addCredits(k); }
        if (Math.random() < dt * 6) fx.bubbles(poses(s, a).contact, 2);
        if (res.ev.length) checkRoundEnd();
      }
    }
  }
  // 유리: 출혈로 팔이 닳음
  if (mode === 'play' && round && !round.ended) {
    for (const s of ['L', 'R']) {
      const a = arms[s];
      if (a.bleed > 0 && a.I < 0.5) {
        const res = { flesh: 0, scrap: 0, ev: [], point: null };
        a.damageFlesh(a.bleed * dt, wall.def.kind, res);
        const c = res.flesh * FLESH_RATE * wall.def.mult + eventCredits(res.ev) * wall.def.mult;
        a._bleedAcc = (a._bleedAcc || 0) + c;
        if (a._bleedAcc >= 1) { const n = Math.floor(a._bleedAcc); a._bleedAcc -= n; addCredits(n); }
        for (const e of res.ev) handleEvent(a, e, null);
        if (res.ev.length) checkRoundEnd();
      }
    }
  }
  if (wall) wall.update(dt, time, arms, fists);
  fx.update(dt, time);
  xray = Math.max(0, xray - dt * 4.5);
  for (const s of ['L', 'R']) arms[s].U.uXray.value = Math.min(1, xray * 1.4);
  xrayVeil.material.opacity = Math.min(0.82, xray * 1.1);
  shake = Math.max(0, shake - dt * 5);
}

let freeCam = null;   // 디버그: {p, t}
function render() {
  const s = shake * shake;
  camera.position.set((Math.random() - 0.5) * 0.004 * s, (Math.random() - 0.5) * 0.004 * s, 0);
  camera.lookAt(0, -0.075, -1);
  if (freeCam) { camera.position.copy(freeCam.p); camera.lookAt(freeCam.t); }
  camera.layers.set(0);
  renderer.clear();
  renderer.render(scene, camera);
  if (xray > 0.01) {
    camera.layers.set(1);
    renderer.clearDepth();
    renderer.render(scene, camera);
    camera.layers.set(0);
  }
}

// ------------------------------------------------------------------ 시작
async function boot() {
  resize();
  const hadSave = load();
  assets = await loadArmAssets();
  initAnatomy(assets.header);
  fx = new FX(scene, renderer, G);
  fx.anat = ANAT;
  sfx = new SFX();
  await sfx.prepare();
  arms.L = new Arm(assets, 'L'); arms.R = new Arm(assets, 'R');
  scene.add(arms.L.root, arms.R.root);
  fists.L = new Fist(arms.L); fists.R = new Fist(arms.R);
  setWall(G.owned.includes(G.wall) ? G.wall : 'cement');
  // 저장된 팔 상태 복원
  for (const s of ['L', 'R']) restoreArm(arms[s], G.arms[s]);
  warmup();
  ui = new UI({ G, WALLS, hadSave, actions });
  round = { punches: 0, earned: 0, fract: 0, nail: 0, finger: 0, hand: 0, scrapGone: 0, scrapParts: 0, tkd: 0, ended: false };
  requestAnimationFrame(frame);
  ui.ready();
  document.body.classList.add('loaded');
}

// 처음 나올 때 멈칫하지 않게 재질을 미리 컴파일
function warmup() {
  const tmp = [];
  const add = (m) => { m.position.set(0, -0.2, -0.5); scene.add(m); tmp.push(m); };
  for (const mat of [fx.meatMat, fx.fatMat, fx.boneMat, fx.skinBitMat, fx.nailMat, fx.dropMat]) add(new THREE.Mesh(fx.meatGeos[0], mat));
  add(new THREE.Mesh(fx.meatGeos[0], fx.gibMat()));
  camera.layers.enableAll();
  try { renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  camera.layers.set(0);
  for (const m of tmp) scene.remove(m);
}

function restoreArm(a, snap) {
  a.reset();
  if (!snap || !(snap.I > 0)) return;
  a.setStump(snap.I);
  if (snap.scrap) {
    a.scrapSeed = snap.scrap.seed;
    a.scrapObj = new Scrap(a, snap.scrap.seed);
    a.scrap = a.scrapObj.state;
    a.scrap.lumpHP = snap.scrap.lump; a.scrap.pipeHP = snap.scrap.pipe;
    if (a.scrap.lumpHP <= 0) a.scrapObj.onDamage('lump', { flyScrapPart: (p) => p.parent && p.parent.remove(p) }, null, null);
  }
}

// UI에서 부르는 동작들
const actions = {
  start() {
    sfx.unlock();
    mode = 'play';
    document.body.classList.add('playing');
    newRound();
    ui.hidePanels(); ui.hud(true);
    showHint('controls');
  },
  newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    location.reload();
  },
  buyWall(id) {
    const d = WALLS.find((w) => w.id === id);
    if (!d || G.owned.includes(id) || G.credits < d.price) return false;
    if (!arms.L.hasFist() && !arms.R.hasFist() && G.credits - d.price < Math.min(scrapPrice(arms.L), scrapPrice(arms.R))) return 'need';
    G.credits -= d.price; G.owned.push(id); setWall(id); save();
    sfx.play('buy', 0.8);
    return true;
  },
  selectWall(id) { if (G.owned.includes(id)) { setWall(id); save(); sfx.play('click', 0.5); } },
  restore(side) {
    const price = restorePrice();
    if (G.credits < price) return false;
    G.credits -= price; arms[side].reset(); arms[side].scrapObj && arms[side].scrapObj.dispose(); arms[side].scrapObj = null;
    G.arms[side] = { I: 0 }; save(); sfx.play('restore', 0.8); return true;
  },
  scrap(side) {
    const a = arms[side];
    const price = scrapPrice(a);
    if (G.credits < price || a.hasFist()) return false;
    G.credits -= price;
    if (a.scrapObj) a.scrapObj.dispose();
    a.scrapSeed = Math.floor(Math.random() * 1e6) + 1;
    a.scrapObj = new Scrap(a, a.scrapSeed);
    a.scrap = a.scrapObj.state;
    G.arms[side] = armSnapshot(a);
    save(); sfx.play('scrapOn', 0.9); return true;
  },
  canStart() { return arms.L.hasFist() || arms.R.hasFist(); },
  restorePrice, scrapPrice: (s) => scrapPrice(arms[s]),
  armInfo(s) { const a = arms[s]; return { flesh: a.I < 0.5, I: a.I, scrap: !!(a.scrap && a.scrap.lumpHP > 0), fist: a.hasFist() }; },
  toggleSound(on) { sfx.setMuted(!on); G.muted = !on; save(); },
  isMuted() { return !!G.muted; },
};

// 손 회복은 늘 벽보다 비쌈: 다음에 살 벽 값의 1.2배(다 샀으면 가장 비싼 벽 기준)
function restorePrice() {
  const next = WALLS.find((w) => !G.owned.includes(w.id));
  const top = Math.max(0, ...WALLS.filter((w) => G.owned.includes(w.id)).map((w) => w.price));
  const base = Math.max(top, next ? next.price : 0);
  return Math.round(Math.max(450, base * 1.2) / 10) * 10;
}
function scrapPrice(a) {
  const lost = clamp((a.I - 0.5) / 0.5, 0, 1);
  return Math.round(35 + lost * 45);
}

// 디버그(자동 테스트용)
function tick(dt, n = 1, draw = true) {
  for (let i = 0; i < n; i++) { let d = dt; if (hitstop > 0) { hitstop -= d; d *= 0.08; } time += d; step(d); }
  if (draw) render();
}
window.__cg = { tick, setManual(v) { manual = v; }, G, arms, fists, get wall() { return wall; }, actions, setWall, press: pressSide, get mode() { return mode; }, set mode(v) { mode = v; }, step, newRound, get round() { return round; }, addCredits, poses, camera, scene, renderer, get xray() { return xray; }, set xray(v) { xray = v; }, set freeCam(v) { freeCam = v ? { p: new THREE.Vector3(...v.p), t: new THREE.Vector3(...v.t) } : null; }, THREE, SEG, get ANAT() { return ANAT; }, get fx() { return fx; } };

boot().catch((e) => { console.error(e); const el = $('#err'); if (el) { el.textContent = '불러오기 실패: ' + e.message; el.style.display = 'block'; } });
