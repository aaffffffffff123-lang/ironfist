// 철권 — 메인
import * as THREE from 'three';
import { RoomEnvironment } from './room-env.js';
import { loadArmAssets, initAnatomy, Arm, W as WT, SEG, ANAT } from './arm.js';
import { WALLS, createWall, hitter } from './walls.js';
import { FX, PUFF_SCALE } from './fx.js';
import { SFX } from './sfx.js';
import { Scrap } from './scrap.js';
import { UI } from './ui.js';
import { SkillFX, SKILL_OF, SKILLS, skillKind } from './skills.js';

const WALL_D = 0.62;                 // 카메라 → 벽 거리
const FLESH_RATE = 1200;             // 살 손실 1.0 당 크레딧(벽 배율 전) — 한 판에 다음 벽 하나를 살 만큼
const SCRAP_RATE = 3.6;              // 고철 HP 1 당 크레딧
const DAMAGE_PACE = 0.65;            // 한 판에서 손·고철이 박살나는 속도
// 타격감
const STRIKE_T = 0.092;              // 가드에서 벽까지 내지르는 시간(초)
const BACK_T = 0.2;                  // 벽에서 튕겨 가드로 돌아오는 시간
const HOLD_T = 0.012;                // 멈춤이 풀린 뒤 벽에 붙어 있는 시간
const HS_SLOW = 0.03;                // 멈춤(히트스톱) 동안 시간 흐름 배율
const CHARGE_START = 0.22;            // 이보다 짧게 누르면 기존 일반타
const CHARGE_FULL = 0.68;             // 완충까지 걸리는 실제 시간(초)
const CHARGE_FLESH = 0.162;           // 최소 피해로도 완충 3회면 멀쩡한 주먹이 사라지는 고정 자해량
const CHARGE_SCRAP = 48;              // 고철 덩어리(HP 140)가 완충 약 3회에 파괴
const CHARGE_JOINT = 0.035;           // 철권 연결부 살에 되돌아오는 완충 충격
const D2R = Math.PI / 180;
const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (u) => u * u * (3 - 2 * u);
const realSeconds = () => performance.now() * 0.001;

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

// ------------------------------------------------------------------ 상태
const SAVE_KEY = 'cheolgwon.v1';
const G = {
  credits: 0, owned: ['cement'], wall: 'cement',
  stats: { rounds: 0, total: 0 },
  arms: { L: { kind: 'flesh' }, R: { kind: 'flesh' } },
  decals: {}, stuck: {},
  seenHints: {}, seenSkill: {},
};
let assets, arms = {}, wall = null, fx, sfx, ui, skillFx = null;
let mode = 'title';      // title | play | over | shop
let round = null;
let time = 0, rtime = 0, hitstop = 0;
let rush = 0;            // 최근 연타 정도 — 연타할수록 멈춤·흔들림을 줄여 답답하지 않게
let layout = { portrait: false, k: 1 };
let baseFov = 58;

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || !s.owned) return false;
    Object.assign(G, s);
    // 삭제된 벽을 샀거나 선택한 예전 저장도 안전하게 이어서 시작한다.
    const valid = new Set(WALLS.map((w) => w.id));
    G.owned = [...new Set((Array.isArray(G.owned) ? G.owned : []).filter((id) => valid.has(id)))];
    if (!G.owned.includes('cement')) G.owned.unshift('cement');
    if (!valid.has(G.wall) || !G.owned.includes(G.wall)) G.wall = 'cement';
    if (!G.seenSkill || typeof G.seenSkill !== 'object') G.seenSkill = {};
    for (const bag of [G.decals, G.stuck]) if (bag && typeof bag === 'object') delete bag.traps;
    // 예전 버전의 벽 타격 흔적 저장값도 함께 폐기한다.
    delete G.wallDamage;
    return true;
  } catch (e) { return false; }
}

// ------------------------------------------------------------------ 자세
const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;
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
  // 잔상 연타는 한 대마다 조금씩 다른 자리를 침
  const aim = fists[side] ? fists[side].aimOff : null;
  const hitTarget = new THREE.Vector3(-(p ? 0.044 : 0.058) + (aim ? aim.x : 0), (p ? -0.045 : -0.05) + (aim ? aim.y : 0), -WALL_D);
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

// ------------------------------------------------------------------ 동작 곡선
// 내지르기: 처음 한두 프레임 살짝 당겼다가(반동) 점점 빨라져, 가장 빠를 때 벽에 꽂힘
function strikeCurve(u, wind) {
  const a = Math.pow(u, 2.1);
  return wind ? a - 0.07 * Math.sin(Math.PI * Math.min(1, u / 0.45)) * (1 - u) : a;
}
// 튕겨 나오기: 처음이 가장 빠르고, 가드 자리를 살짝 지나쳤다 돌아옴
function reboundCurve(u) { const c1 = 1.15, c3 = c1 + 1, v = u - 1; return 1 + c3 * v * v * v + c1 * v * v; }

// ------------------------------------------------------------------ 화면 반동
// 실제 시간으로 흐름 → 히트스톱으로 세상이 멈춰도 화면은 충격으로 출렁임
class Spring {
  constructor(hz, zeta) { this.w = Math.PI * 2 * hz; this.k = this.w * this.w; this.c = 2 * zeta * this.w; this.x = 0; this.v = 0; }
  kick(peak) { this.v += peak * this.w / 0.6; }   // 대략 peak 만큼 튀었다 돌아옴
  step(dt) { const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n; for (let i = 0; i < n; i++) { this.v += (-this.k * this.x - this.c * this.v) * h; this.x += this.v * h; } }
  reset() { this.x = 0; this.v = 0; }
}
const cam = {
  trauma: 0,                                         // 흔들림(0~1, 실제 시간으로 잦아듦)
  pitch: new Spring(8, 0.42), yaw: new Spring(7, 0.45), roll: new Spring(7.5, 0.42),
  push: new Spring(9, 0.5), fov: new Spring(8, 0.5),
  ph: Array.from({ length: 6 }, () => Math.random() * 100),
};
const CAM_SPRINGS = [cam.pitch, cam.yaw, cam.roll, cam.push, cam.fov];
// 주먹이 벽에 꽂힌 순간: 고개가 앞으로 꾸벅, 친 쪽으로 몸이 돌고 기울며, 화면이 확 당겨짐
function camKick(side, feel, evW) {
  const sg = side === 'L' ? 1 : -1;
  // 빠르게 연타해도 각 접촉의 질량이 사라지지 않게 최소 반동을 남긴다.
  const k = Math.min(1.6, feel), r = Math.max(0.62, 1 / (1 + 0.28 * rush));
  cam.trauma = Math.min(1, cam.trauma + (0.38 + 0.22 * (k - 0.8)) * r + evW * 0.4);
  cam.pitch.kick(-(0.72 + 0.38 * (k - 0.8) + evW * 0.5) * r * D2R);
  cam.yaw.kick(sg * (0.40 + 0.17 * (k - 0.8)) * r * D2R);
  cam.roll.kick(-sg * (0.90 + 0.40 * (k - 0.8) + evW * 0.5) * r * D2R);
  cam.push.kick(-(0.0065 + 0.0025 * (k - 0.8)) * r);
  cam.fov.kick(-(2.35 + 0.9 * (k - 0.8)) * r - evW * 1.5);
}
// 모아치기 반동은 연타 보정으로 줄이지 않는다. 벽은 그대로고 몸과 카메라만 밀려난다.
function camPowerKick(side, amount) {
  const k = smooth(clamp(amount, 0, 1));
  if (k <= 0) return;
  const sg = side === 'L' ? 1 : -1;
  cam.trauma = Math.min(1, cam.trauma + 0.92 * k);
  cam.pitch.kick(-(2.05 * k) * D2R);
  cam.yaw.kick(sg * (0.90 * k) * D2R);
  cam.roll.kick(-sg * (1.75 * k) * D2R);
  cam.push.kick(-(0.016 * k));
  cam.fov.kick(-(5.0 * k));
}
// 박힌 손을 뜯어낼 때 몸이 뒤로 젖혀짐
function camPull(side) {
  const sg = side === 'L' ? 1 : -1;
  cam.trauma = Math.min(1, cam.trauma + 0.32);
  cam.pitch.kick(0.55 * D2R); cam.roll.kick(sg * 0.5 * D2R); cam.push.kick(0.006); cam.fov.kick(1.2);
}
// 박힌 채로 버둥
function camTug(side) {
  cam.trauma = Math.min(1, cam.trauma + 0.1);
  cam.roll.kick((side === 'L' ? 1 : -1) * 0.2 * D2R); cam.push.kick(0.0015);
}
function camUpdate(rdt) {
  cam.trauma = Math.max(0, cam.trauma - rdt * 2.4);
  for (const s of CAM_SPRINGS) s.step(rdt);
}

// ------------------------------------------------------------------ 팔 컨트롤러
class Fist {
  constructor(arm) {
    this.arm = arm;
    this.resetMotion();
  }
  resetMotion() {
    this.state = 'idle';
    this.s = 0;              // 뻗은 정도: 0 가드 ~ 1 벽에 닿음
    this.u = 0; this.s0 = 0; this.dur = STRIKE_T; this.wind = 0; this.slow = false;
    this.queue = 0; this.autoPunch = false; this.pendingChain = null; this.hold = 0;
    this.stuckTaps = 0; this.stuckT = 0; this.pinT = 0; this.sinkT = 0; this.sinkD = 0; this.spasm = 0; this.spasmT = 0; this.spasmT0 = 0.06;
    this.flinchUntil = 0;
    this.tug = 0; this.tremble = 0;
    this.lastPress = -9;
    // 누르고 있는 동안은 발사하지 않는다. 가드로 완전히 돌아온 뒤부터 실제 충전 시간을 센다.
    this.inputHeld = false; this.chargeStart = -1; this.punchCharge = 0;
    // 잔상 연타: 남은 대수, 다음 대까지 시간, 이번 대가 노리는 자리
    this.barrage = 0; this.rushing = false; this.rushT = 0; this.rushT0 = 0.026;
    this.aimOff = this.aimOff ? this.aimOff.set(0, 0, 0) : new THREE.Vector3();
    this.skillLaunch = null;
    // 맞은 순간의 느낌 — 실제 시간으로 흐름(히트스톱 동안에도 떨림·눌림이 보이게)
    this.impT = 9; this.impA = 0; this.impDir = new THREE.Vector3(1, 0, 0); this.jit = new THREE.Vector3(); this._jf = false;
    this.comp = 0; this.compT = 0; this.push = 0.009; this.squashK = 1;
    this.ripA = 0; this.ripZ = 0.016;
    this.flick = 0; this.flickV = 0;     // 손목 튕김 스프링(라디안)
  }
  press(now) {
    const st = this.state;
    if (mode !== 'play' || !round || round.ended) return;
    if (!this.arm.canPunch()) { this.flickV += 1.6; sfx.play('stumpTwitch', 0.2); return; }
    if (st === 'stuck') { onTug(this, now); return; }
    if (st === 'pinned') { onTug(this, now); return; }
    // 연타 입력은 한 번 예약하되, 주먹이 가드까지 완전히 돌아온 뒤에만 다시 내지른다.
    if (st === 'idle') {
      if (now < this.flinchUntil) { this.queue = 1; return; }
      this.queue = 0;
      this.autoPunch = false;
      this.startPunch(now);
    } else this.queue = Math.min(1, this.queue + 1);
  }
  beginHold(now, realNow) {
    const st = this.state;
    if (mode !== 'play' || !round || round.ended || this.inputHeld) return false;
    if (!this.arm.canPunch()) { this.flickV += 1.6; sfx.play('stumpTwitch', 0.2); return false; }
    // 박히거나 꿰인 팔은 길게 누르기보다 기존처럼 누르는 즉시 한 번 버둥거린다.
    if (st === 'stuck' || st === 'pinned') { onTug(this, now); return false; }
    this.inputHeld = true;
    this.chargeStart = -1;
    this.queue = 0;
    if (st === 'idle' && now >= this.flinchUntil) this.chargeStart = realNow;
    return true;
  }
  endHold(now, realNow, cancel = false) {
    if (!this.inputHeld) return;
    const started = this.chargeStart;
    this.inputHeld = false;
    this.chargeStart = -1;
    if (cancel || mode !== 'play' || !round || round.ended) { skillFx?.chargeCancel(this.arm.side); return; }
    if (!this.arm.canPunch()) { skillFx?.chargeCancel(this.arm.side); this.flickV += 1.6; sfx.play('stumpTwitch', 0.2); return; }
    // 가드에서 충전 중이었다면 손을 뗀 순간 발사. 짧은 터치는 기존 일반타와 같다.
    if (started >= 0 && this.state === 'idle' && now >= this.flinchUntil) {
      const held = Math.max(0, realNow - started);
      const charge = held <= CHARGE_START ? 0 : clamp((held - CHARGE_START) / (CHARGE_FULL - CHARGE_START), 0, 1);
      this.startPunch(now, smooth(charge));
      return;
    }
    // 회수 중에 눌렀다가 가드로 돌아오기 전에 뗐으면 기존처럼 일반타 한 번만 예약한다.
    this.press(now);
  }
  cancelHold() {
    this.inputHeld = false;
    this.chargeStart = -1;
    skillFx?.chargeCancel(this.arm.side);
  }
  startPunch(now, charge = 0) {
    this.state = 'out';
    this.s0 = this.s; this.u = 0;
    this.punchCharge = this.autoPunch ? 0 : clamp(charge, 0, 1);
    this.wind = !this.autoPunch && this.punchCharge <= 0 && this.s < 0.15 ? 1 : 0;
    // 덜 돌아온 데서 다시 치면 거리가 짧은 만큼 빨리 닿음
    this.dur = (this.autoPunch ? 0.07 : STRIKE_T) * (0.45 + 0.55 * clamp(1 - this.s0, 0, 1.1)) / this.speed();
    if (this.rushing) this.dur = 0.036;
    this.skillLaunch = null;
    if (this.punchCharge > 0 && skillFx) {
      const sk = skillFx.skill;
      this.skillLaunch = sk.id;
      // 회오리는 팔이 한 바퀴 비틀리며 나가는 게 보이도록 조금 늦게 닿음
      if (sk.id === 'twist') this.dur *= 1.7;
      skillFx.launch(this.arm.side, this.punchCharge, this);
    }
    this.lastPress = now;
    registerPunch(this, now);
    sfx.whoosh(this.arm.side, this.dur, this.autoPunch ? (this.rushing ? 0.12 : 0.18) : 0.3 + this.punchCharge * 0.28);
  }
  goBack(dur, slow = false) { this.state = 'back'; this.s0 = this.s; this.u = 0; this.dur = dur; this.slow = slow; }
  get t() { return clamp(this.s, 0, 1); }   // 벽(슬라임 움푹 패임)이 읽는 뻗은 정도
  speed() {
    let s = 1;
    const a = this.arm;
    if (a.traps.length) s *= 1 / (1 + a.traps.length * 0.16);
    if (a.scrap && a.scrap.lumpHP > 0) s *= 0.78;
    return s;
  }
  update(dt, now) {
    switch (this.state) {
      case 'out': {
        this.u = Math.min(1, this.u + dt / this.dur);
        this.s = this.s0 + (1 - this.s0) * strikeCurve(this.u, this.wind);
        if (this.u >= 1) { this.s = 1; this.state = 'hit'; this.hold = HOLD_T; onImpact(this, now); }
        break;
      }
      case 'hit': {
        this.hold -= dt;
        if (this.hold <= 0 && this.state === 'hit') {
          // 남은 시간만큼 바로 튕겨 나감(벽에 한 프레임 더 붙어 있지 않게)
          const over = -this.hold;
          this.goBack(BACK_T);
          this.u = Math.min(1, over / this.dur); this.s = this.s0 * (1 - reboundCurve(this.u));
        }
        break;
      }
      case 'stuck': case 'pinned': {
        if (this.state === 'pinned') { this.pinT -= dt; if (this.pinT <= 0) release(this, now, true); }
        if (this.state === 'stuck') { this.stuckT += dt; if (this.stuckT > 2.6) release(this, now, true); }
        break;
      }
      case 'sink': {
        this.sinkT -= dt;
        if (this.sinkT <= 0) { this.goBack(0.55, true); sfx.play('suction', 0.7); }
        break;
      }
      case 'spasm': {
        // 감전: 살짝 튕겨 나왔다가 혼자 다시 꽂힘
        this.spasmT -= dt;
        const k = clamp(1 - Math.max(0, this.spasmT) / this.spasmT0, 0, 1);
        this.s = 1 - (this.spasm > 0 ? 0.45 : 0.2) * smooth(k);
        if (this.spasmT <= 0) {
          if (this.spasm > 0) { this.spasm--; this.autoPunch = true; this.startPunch(now); }
          else this.goBack(BACK_T);
        }
        break;
      }
      case 'rush': {
        // 잔상 연타: 반쯤만 빠졌다가 다른 자리로 다시 꽂힘
        this.rushT -= dt;
        const k = clamp(1 - Math.max(0, this.rushT) / this.rushT0, 0, 1);
        this.s = 1 - 0.5 * smooth(k);
        if (this.rushT <= 0) {
          if (this.barrage > 0 && this.arm.canPunch() && round && !round.ended) {
            this.barrage--;
            { const ang = Math.random() * TAU, r = rnd(0.03, 0.07); this.aimOff.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.8 + 0.008, 0); }
            this.autoPunch = true;
            this.startPunch(now);
          } else { this.rushing = false; this.barrage = 0; this.aimOff.set(0, 0, 0); this.goBack(BACK_T); }
        }
        break;
      }
      case 'back': {
        this.u = Math.min(1, this.u + dt / this.dur);
        this.s = this.s0 * (1 - (this.slow ? smooth(this.u) : reboundCurve(this.u)));
        if (this.u >= 1) {
          this.s = 0; this.state = 'idle'; this.slow = false; this.autoPunch = false;
          if (this.inputHeld && now >= this.flinchUntil) this.chargeStart = realSeconds();
          else if (this.queue > 0 && now >= this.flinchUntil) { this.queue--; this.startPunch(now); }
        }
        break;
      }
      case 'idle': {
        if (this.inputHeld && this.chargeStart < 0 && now >= this.flinchUntil) this.chargeStart = realSeconds();
        else if (!this.inputHeld && this.queue > 0 && now >= this.flinchUntil) { this.queue--; this.autoPunch = false; this.startPunch(now); }
        break;
      }
    }
    // 슬라임에 빨려 든 깊이: 빨려 들 땐 점점 깊이, 빠질 땐 쑥 빠짐
    if (this.state === 'sink') this.sinkD = 0.04 * (1 - Math.max(0, this.sinkT) / 0.4);
    else this.sinkD = Math.max(0, this.sinkD - dt * 0.3);
    // 손목 튕김 스프링(시뮬레이션 시간: 멈춤 동안 그대로 있다가 풀리며 튐)
    const k = 560, c = 2 * 0.48 * Math.sqrt(k);
    this.flickV += (-k * this.flick - c * this.flickV) * dt; this.flick += this.flickV * dt;
    this.tug = Math.max(0, this.tug - dt * 6);
  }
  // 벽에 꽂힌 순간의 느낌 설정 (hs: 이번 멈춤 길이)
  hitFeel(feel, react, a, hs) {
    const who = hitter(a);
    const P = poses(a.side, a);
    this.impT = 0;
    tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    tmpV.addScaledVector(P.D1, -tmpV.dot(P.D1));
    if (tmpV.lengthSq() < 1e-8) tmpV.set(1, 0, 0);
    this.impDir.copy(tmpV.normalize());
    this.impA = 0.0065 * feel * (who === 'scrap' ? 1.3 : 1);
    // 살 주먹은 손이 납작해지는 만큼 팔이 더 들어감(앞면은 벽에 붙은 채). 손등뼈가 부러질수록 더 깊이 우그러짐
    this.push = who === 'hand' ? Math.max(0, a.reach()) * a.squashZ() + 0.0008 : who === 'scrap' ? 0.0025 : 0.004;
    this.squashK = who === 'hand' ? 1 : 0;
    this.compT = react.stick === 'sink' ? 0 : hs + 0.03;
    this.ripA = (who === 'hand' ? 1 : 0.75) * Math.min(1.5, feel);
    this.ripZ = Math.min(a.crushZ, 0.016) - (who === 'hand' && a.crushZ > 0.02 ? 0 : 0.004);
    if (!react.stick) this.flickV -= 1.5 + 0.9 * feel;
  }
  // 실제 시간으로 흐르는 부분: 눌림, 떨림
  feel(rdt) {
    this.impT += rdt;
    const want = (this.state === 'hit' || (this.impT < this.compT && this.state !== 'back' && this.state !== 'out')) ? 1 : 0;
    this.comp += (want - this.comp) * Math.min(1, rdt / (want ? 0.01 : 0.03));
    // 떨림: 프레임마다 방향을 뒤집으며 부르르, 금방 잦아듦
    const e = this.impT < 0.3 ? Math.exp(-this.impT / 0.06) : 0;
    if (e > 0.002) { this._jf = !this._jf; this.jit.copy(this.impDir).multiplyScalar((this._jf ? 1 : -1) * this.impA * e * (0.7 + 0.3 * Math.random())); }
    else this.jit.set(0, 0, 0);
  }
  pose(out) {
    const P = poses(this.arm.side, this.arm);
    const s = this.s, sc = clamp(s, 0, 1);
    out.position.lerpVectors(P.p0, P.p1, s);
    // 휘두르는 호
    out.position.y += Math.sin(sc * Math.PI) * 0.018;
    out.quaternion.slerpQuaternions(P.q0, P.q1, sc);
    // 충전은 화면 오라가 아니라 실제 자세로 먼저 읽힌다: 더 깊은 당김, 손목 긴장, 미세한 떨림.
    if ((this.inputHeld && this.chargeStart >= 0 && this.state === 'idle') || (this.state === 'out' && this.punchCharge > 0)) {
      const launching = this.state === 'out';
      const held = launching ? CHARGE_FULL : Math.max(0, realSeconds() - this.chargeStart);
      const prep = launching ? 1 : smooth(clamp(held / CHARGE_START, 0, 1));
      const charge = launching ? this.punchCharge : smooth(clamp((held - CHARGE_START) / (CHARGE_FULL - CHARGE_START), 0, 1));
      // 손을 놓은 첫 프레임에도 당긴 자세를 유지한 뒤 전진 초반에 풀어, 순간이동처럼 보이는 끊김을 없앤다.
      const launchFade = launching ? 1 - smooth(clamp(this.u / 0.55, 0, 1)) : 1;
      const pull = (prep * 0.012 + charge * 0.034) * launchFade;
      const sg = this.arm.side === 'L' ? -1 : 1;
      out.position.addScaledVector(P.D1, -pull);
      out.position.x += sg * charge * 0.006 * launchFade;
      out.position.y -= charge * 0.007 * launchFade;
      tmpQ.setFromAxisAngle(AX_X, -(0.05 * prep + 0.13 * charge) * launchFade); out.quaternion.multiply(tmpQ);
      const sk = skillFx ? skillFx.skill.id : 'shock';
      // 잔상 연타·대폭발은 모을수록 주먹이 더 심하게 떨림
      const tremK = sk === 'barrage' ? 3.2 : sk === 'final' ? 2.6 : 1;
      const trem = launching ? 0 : prep * 0.00025 + charge * 0.00125 * tremK;
      out.position.x += Math.sin(rtime * (sk === 'barrage' ? 97 : 53) + (sg < 0 ? 0 : 2.1)) * trem;
      out.position.y += Math.sin(rtime * (sk === 'barrage' ? 89 : 47) + 0.8) * trem * 0.7;
      // 회오리: 모으는 동안 팔을 반대로 감았다가, 내지를 때 한 바퀴 비틀며 나감
      if (sk === 'twist') {
        const W = 1.15;
        const ang = launching ? -W * this.punchCharge + (TAU + W * this.punchCharge) * smooth(this.u) : -W * charge;
        tmpQ.setFromAxisAngle(AX_Z, ang * (sg < 0 ? 1 : -1)); out.quaternion.multiply(tmpQ);
      }
    }
    // 반동: 내지르기 직전 손목을 살짝 젖힘
    if (this.state === 'out' && this.wind) { const w = Math.sin(Math.PI * Math.min(1, this.u / 0.45)) * (1 - this.u); tmpQ.setFromAxisAngle(AX_X, -0.12 * w); out.quaternion.multiply(tmpQ); }
    // 손목 튕김: 맞고 나서 주먹이 들리며 팔이 휨
    if (this.flick) { tmpQ.setFromAxisAngle(AX_X, this.flick); out.quaternion.multiply(tmpQ); }
    // 눌림 + 충격 떨림
    out.position.addScaledVector(P.D1, this.comp * this.push);
    out.position.add(this.jit);
    // 당기기·빨려 듦·버둥
    out.position.addScaledVector(P.D1, -this.tug * 0.02 + this.sinkD);
    if (this.state === 'pinned') out.position.addScaledVector(P.D1, -0.004 * Math.sin(time * 60) * this.tug);
    // 겁나서 떨림
    const tr = this.tremble * (0.0012 + this.arm.I * 0.002);
    out.position.x += Math.sin(time * 37 + (this.arm.side === 'L' ? 0 : 2)) * tr;
    out.position.y += Math.sin(time * 41.3 + 1) * tr;
    // 숨 쉬는 듯한 미세한 움직임
    out.position.y += Math.sin(time * 1.7 + (this.arm.side === 'L' ? 0 : 1.3)) * 0.0025 * (1 - sc);
  }
}

// ------------------------------------------------------------------ 태권도 판정
let chain = [];
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
  if (mode !== 'play' || !round || round.ended) { fist.punchCharge = 0; fist.goBack(BACK_T); return; }
  const a = fist.arm;
  const chargeK = fist.autoPunch ? 0 : clamp(fist.punchCharge || 0, 0, 1);
  const chargeHit = smooth(chargeK);
  // 아주 짧은 실수 홀드는 일반타처럼 보이고 들린다. 의미 있게 모은 구간부터 전용 연출을 서서히 연다.
  const powerFxK = smooth(clamp((chargeK - 0.10) / 0.90, 0, 1));
  const res = { flesh: 0, scrap: 0, ev: [], point: null, finger: -1 };
  const W = wall.def;
  const skill = skillFx ? skillFx.skill : SKILLS[0];
  const full = chargeK >= 0.98;
  const P = poses(a.side, a);
  // 벽 고유 반응 먼저 (걸림·경련 등)
  fx.lastContact = P.contact.clone();
  const react = wall.impact(fist, a, P.contact) || {};
  // 피해량
  const striker = hitter(a);
  const base = W.dmg * DAMAGE_PACE * rnd(0.8, 1.2) * (react.dmgMul || 1);
  let left = base;
  if (a.scrap && (a.scrap.lumpHP > 0 || a.scrap.pipeHP > 0)) {
    // 모아치기는 벽의 종류와 무관하게 충격이 손으로 되돌아온다. 고철은 완충 약 세 번에 붕괴한다.
    const sd = W.scrapDmg * DAMAGE_PACE * rnd(0.8, 1.25) * (react.dmgMul || 1) + CHARGE_SCRAP * chargeHit;
    a.damageScrap(sd, res);
    scrapBreakFx(a, res, P.contact);
    // 연결부 살도 다침(철사가 파고듦)
    a.damageFlesh(base * 0.12 + CHARGE_JOINT * chargeHit, W.kind, res);
    a.addWound(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.004, 0.012), Math.min(a.cutZ, 0.006) - 0.036), 0.03, WT.WIRE, Math.min(1, 0.4 + (140 - a.scrap.lumpHP) / 170));
    a._apply();
    left = 0;
  } else {
    // 회오리: 비틀린 손목이 일찍 꺾여 처짐
    if (skill.id === 'twist' && chargeHit > 0.3 && a.I < 0.5 && !a.wristBroken) a.tWrist = Math.max(a.I + 0.012, a.tWrist - 0.08 * chargeHit);
    // 완충 세 번이면 건강한 주먹이 사라질 만큼 고정 자해량을 더한다. 벽에는 피해를 저장하지 않는다.
    // 모은 기술의 성격(화상·동상·감전…)이 내 손에 그대로 남는다.
    a.damageFlesh(left + CHARGE_FLESH * chargeHit, chargeHit > 0.02 ? skillKind(W.kind, skill, chargeHit) : W.kind, res);
  }
  // 크레딧
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  if (fist.pendingChain) { const l = fist.pendingChain; l.credits = credits; l.done = true; fist.pendingChain = null; if (l.group) payTkd(l.group); }
  addCredits(credits);
  // 연출 — power: 피·살점 양, feel: 손맛(멈춤·화면 반동·떨림)
  const power = clamp(0.4 + res.flesh * 40 + res.ev.length * 0.3, 0.3, 1.6);
  const evW = eventWeight(res.ev);
  const tier = WALLS.indexOf(W) / (WALLS.length - 1);
  const feel = clamp(0.8 + tier * 0.25 + evW, 0.6, 1.9);
  fx.impact(a, P.contact, power, res, W, react);
  fx.impactDust(P.contact, W.id, feel, striker);
  sfx.impact(W.id, res, power, a, a.side, feel);
  if (powerFxK >= 0.04) {
    const scrap = striker === 'scrap' || striker === 'pipe';
    // 기본 기술(충격파)은 원래 연출, 나머지는 벽마다의 기술 연출
    if (!skillFx || skill.id === 'shock') fx.powerImpact?.(P.contact, { strength: powerFxK, scrap, side: a.side, full });
    else skillFx.impact(a.side, P.contact, powerFxK, { scrap, full, arm: a, fist });
    sfx.powerImpact?.(a.side, scrap, powerFxK);
  }
  // 잔상 연타: 모은 첫 대가 꽂히면 여러 대가 이어서 들어감
  if (skill.id === 'barrage' && !fist.autoPunch && chargeK >= 0.35 && !react.stick && a.canPunch()) { fist.rushing = true; fist.barrage = 4 + Math.round(5 * chargeK); }
  else if (fist.rushing && fist.autoPunch && skillFx) skillFx.barrageHit(a.side, P.contact, fist.barrage === 0);
  for (const e of res.ev) handleEvent(a, e, P.contact);
  dropCrushed(a);
  a.kick(power);
  // 멈춤: 연타 중엔 짧게, 뼈가 부러지거나 떨어져 나가면 길게
  const pacedHs = (react.stick ? 0.045 : 0.052 + tier * 0.014) / (1 + 0.35 * rush) + Math.min(0.09, evW * 0.12);
  // 난타 중에도 벽에 닿은 프레임은 읽히게 하되, 입력 리듬을 막을 만큼 길게 멈추지는 않는다.
  const normalHs = Math.max(0.034, pacedHs);
  let hs = Math.max(normalHs, 0.034 + powerFxK * 0.056);
  if (fist.rushing && fist.autoPunch) hs = 0.022;
  if (skill.id === 'final' && full) hs = Math.max(hs, 0.13);
  hitstop = Math.max(hitstop, hs);
  fist.hitFeel(feel + chargeHit * 0.55, react, a, hs);
  camKick(a.side, feel, evW);
  if (powerFxK >= 0.04) camPowerKick(a.side, powerFxK);
  rush = Math.min(6, rush + 1);
  vibrate(chargeK > 0.85 ? [45, 35, 70] : res.ev.length ? [30, 25, 30] : Math.round(16 + feel * 10));
  round.punches++;
  // 걸림 상태
  if (fist.rushing && !react.stick) {
    if (fist.barrage > 0) { fist.state = 'rush'; fist.rushT = fist.rushT0 = 0.026; }
    else { fist.rushing = false; fist.aimOff.set(0, 0, 0); fist.state = 'spasm'; fist.spasm = 0; fist.spasmT = fist.spasmT0 = 0.05; }
  }
  else if (react.stick === 'stuck') { fist.state = 'stuck'; fist.stuckTaps = react.taps || 3; fist.stuckT = 0; showHint('stuck'); }
  else if (react.stick === 'pinned') { fist.state = 'pinned'; fist.pinT = react.pin || 2; fist.stuckTaps = 99; showHint('pinned'); }
  else if (react.stick === 'sink') { fist.state = 'sink'; fist.sinkT = react.sink || 0.4; }
  else if (react.spasm && !fist.autoPunch) { fist.state = 'spasm'; fist.spasm = react.spasm; fist.spasmT = fist.spasmT0 = 0.06; }
  else if (fist.autoPunch && fist.spasm > 0) { fist.state = 'spasm'; fist.spasmT = fist.spasmT0 = 0.07; }
  else if (fist.autoPunch) { fist.state = 'spasm'; fist.spasmT = fist.spasmT0 = 0.05; }
  if (react.flinch) fist.flinchUntil = now + react.flinch;
  fist.punchCharge = 0;
  checkRoundEnd();
}

// mfract: 손등뼈 골절(너클이 꺼짐), fract: 손가락뼈 골절, open: 뼈가 살을 뚫고 나옴, nail: 손톱이 깨짐
// crush: 앞면이 더 짓이겨짐, finger: 손가락이 짓이겨져 뭉개짐, hand: 손목 위가 다 없어짐, stump: 팔뚝 끝이 짓이겨짐
const EV_CREDITS = { mfract: 36, fract: 36, open: 45, nail: 24, finger: 60, wrist: 90, hand: 180, crush: 0, stump: 12, lumpGone: 24, pipeGone: 15 };
const EV_WEIGHT = { mfract: 0.42, fract: 0.3, open: 0.35, nail: 0.1, finger: 0.38, wrist: 0.45, hand: 0.7, crush: 0.05, stump: 0.08, lumpGone: 0.3, pipeGone: 0.2 };
function eventCredits(evs) {
  let c = 0;
  for (const e of evs) c += EV_CREDITS[e.t] || 0;
  return c;
}
// 사건이 클수록 손맛을 키움
function eventWeight(evs) {
  let w = 0;
  for (const e of evs) w += EV_WEIGHT[e.t] || 0;
  return Math.min(1, w);
}

function handleEvent(a, e, contact) {
  const c = contact || fx.lastContact;
  switch (e.t) {
    case 'mfract': sfx.play('crack', 1.0, { rate: 0.8 }); sfx.play('knuckle', 0.55, { rate: 0.62 }); hitstop = Math.max(hitstop, 0.1); round.fract++; break;
    case 'fract': sfx.play('crack', 0.85); hitstop = Math.max(hitstop, 0.08); round.fract++; break;
    case 'open': {
      sfx.play('bonePop', 0.95); hitstop = Math.max(hitstop, 0.07);
      const sh = a.shards[a.shards.length - 1];
      if (sh) fx.spurt(sh.getWorldPosition(new THREE.Vector3()), 16);
      break;
    }
    case 'nail': sfx.play('nailRip', 0.6); round.nail++; break;
    case 'wrist': sfx.play('crack', 1.0, { rate: 0.72 }); hitstop = Math.max(hitstop, 0.1); break;
    case 'crush': if (c) fx.mash(c, 0.6); break;
    case 'finger': sfx.play('mash', 0.85); if (c) fx.mash(c, 1.1); round.finger++; break;
    case 'hand': sfx.play('mash', 1.0, { rate: 0.85 }); if (c) fx.mash(c, 2.0); round.hand++; hitstop = Math.max(hitstop, 0.12); break;
    case 'lumpGone': case 'pipeGone': round.scrapGone++; break;
  }
}
// 짓이겨진 자리에 붙어 있던 유리·쥐덫은 떨어져 나감
function dropCrushed(a) {
  for (const o of a.takeDropped()) fx.dropObject(o, a);
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
  if (a.scrap && a.scrap.lumpHP > 0) { a.damageScrap(W.scrapDmg * 0.3 * DAMAGE_PACE, res); scrapBreakFx(a, res, fx.lastContact || poses(a.side, a).contact); } else a.damageFlesh(W.dmg * 0.35 * DAMAGE_PACE, W.kind, res);
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  addCredits(credits);
  wall.tug(fist, a);
  sfx.play('tear', 0.55 + Math.random() * 0.2);
  for (const e of res.ev) handleEvent(a, e, null);
  dropCrushed(a);
  camTug(a.side);
  vibrate(14);
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
  if (a.scrap && a.scrap.lumpHP > 0) { a.damageScrap(W.scrapDmg * 0.5 * DAMAGE_PACE, res); scrapBreakFx(a, res, poses(a.side, a).contact); } else a.damageFlesh(W.dmg * 0.6 * DAMAGE_PACE, W.kind, res);
  const credits = Math.round(res.flesh * FLESH_RATE * W.mult + res.scrap * SCRAP_RATE * W.mult + eventCredits(res.ev) * W.mult);
  addCredits(credits);
  wall.release(fist, a, poses(a.side, a).contact);
  sfx.play('rip', 0.9);
  for (const e of res.ev) handleEvent(a, e, null);
  dropCrushed(a);
  // 확 뜯겨 나옴
  fist.goBack(0.24);
  fist.flickV += 2.4;
  hitstop = Math.max(hitstop, 0.05);
  camPull(a.side);
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
function resetArmMotion(side) {
  const f = fists[side], a = arms[side];
  f.resetMotion();
  f.pose(_pos);
  a.root.position.copy(_pos.position); a.root.quaternion.copy(_pos.quaternion);
  a.squash = 0; a.U.uImp.value.set(9, 0, 0.016);
  a._pp = null; a._vp = null; a._acc.set(0, 0, 0);
  a.update(0, time);
}

function newRound() {
  cancelAllInputs();
  round = { punches: 0, earned: 0, fract: 0, nail: 0, finger: 0, hand: 0, scrapGone: 0, scrapParts: 0, tkd: 0, ended: false, endT: 0 };
  chain = [];
  for (const s of ['L', 'R']) resetArmMotion(s);
  hitstop = 0; rush = 0; cam.trauma = 0;
  for (const s of CAM_SPRINGS) s.reset();
  skillFx?.clear();
}

function checkRoundEnd() {
  if (!round || round.ended) return;
  const L = arms.L, R = arms.R;
  if (!L.hasFist() && !R.hasFist()) {
    round.ended = true; round.endT = time;
    cancelAllInputs();
    // 판이 끝나면 남은 입력·감전 연타를 멈추고 팔만 가드로 돌아옴.
    for (const f of Object.values(fists)) {
      f.queue = 0; f.autoPunch = false; f.pendingChain = null; f.spasm = 0;
      f.barrage = 0; f.rushing = false; f.aimOff.set(0, 0, 0);
      if (f.state !== 'idle' && f.state !== 'back') f.goBack(BACK_T);
    }
    chain = [];
    setTimeout(() => endRound(), 1500);
  }
}

function endRound() {
  if (mode !== 'play') return;
  cancelAllInputs();
  mode = 'shop';
  document.body.classList.remove('playing');
  skillFx?.clear();
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
  const def = WALLS.find((w) => w.id === id) || WALLS[0];
  id = def.id;
  skillFx?.clear();
  if (wall) { fx.clearPowerImpact?.(); fx.persist(); wall.dispose(); }
  wall = createWall(id, { scene, renderer, fx, G, WALL_D, anat: ANAT, fists, lightPool, contactOf: (s) => poses(s, arms[s]).contact });
  G.wall = id;
  fx.bindWall(wall);
  // 모아치기 기술은 지금 벽을 따라감
  skillFx?.setSkill(SKILL_OF[id]);
  // 새 벽 재질은 미리(가능하면 백그라운드로) 컴파일
  try { if (renderer.compileAsync) renderer.compileAsync(wall.group, camera, scene).catch(() => {}); } catch (e) {}
  sfx.ambience(id);
  if (ui) ui.hud(mode === 'play');
}

// ------------------------------------------------------------------ 입력
const fists = {};
const KEY_SIDE = new Map([
  ['KeyF', 'L'], ['KeyA', 'L'], ['ArrowLeft', 'L'], ['KeyD', 'L'], ['KeyS', 'L'],
  ['KeyJ', 'R'], ['KeyL', 'R'], ['ArrowRight', 'R'], ['KeyK', 'R'], ['Semicolon', 'R'],
]);
const inputOwner = { L: null, R: null };
const pointerInputs = new Map();
const mouseInputs = new Map();
const keyInputs = new Map();

function beginSideHold(side, token) {
  sfx.unlock();
  if (mode !== 'play' || !fists[side] || inputOwner[side] !== null) return false;
  if (!fists[side].beginHold(time, realSeconds())) return false;
  inputOwner[side] = token;
  return true;
}
function finishSideHold(side, token, cancel = false) {
  if (!side || inputOwner[side] !== token || !fists[side]) return;
  inputOwner[side] = null;
  fists[side].endHold(time, realSeconds(), cancel);
}
function cancelAllInputs() {
  for (const side of ['L', 'R']) {
    if (fists[side]) fists[side].cancelHold();
    inputOwner[side] = null;
  }
  pointerInputs.clear();
  mouseInputs.clear();
  keyInputs.clear();
}

// 디버그 자동 테스트는 기존 즉시 타격을 그대로 쓴다.
function pressSide(side) {
  sfx.unlock();
  if (mode === 'play') fists[side].press(time);
}
window.addEventListener('keydown', (e) => {
  const side = KEY_SIDE.get(e.code);
  if (!side) return;
  e.preventDefault();
  if (e.repeat || keyInputs.has(e.code)) return;
  const token = 'key:' + e.code;
  if (beginSideHold(side, token)) keyInputs.set(e.code, side);
});
window.addEventListener('keyup', (e) => {
  const side = keyInputs.get(e.code);
  if (!side) return;
  e.preventDefault();
  keyInputs.delete(e.code);
  finishSideHold(side, 'key:' + e.code, false);
});

// 터치·펜은 누른 화면의 좌우를 각각 독립적으로 잡는다.
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const side = e.clientX < innerWidth / 2 ? 'L' : 'R';
  e.preventDefault();
  const token = `pointer:${e.pointerId}`;
  if (!beginSideHold(side, token)) return;
  pointerInputs.set(token, side);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
}, { passive: false });
function finishPointer(e, cancel) {
  const token = `pointer:${e.pointerId}`;
  const side = pointerInputs.get(token);
  if (!side) return;
  pointerInputs.delete(token);
  finishSideHold(side, token, cancel);
}
canvas.addEventListener('pointerup', (e) => { e.preventDefault(); finishPointer(e, false); }, { passive: false });
canvas.addEventListener('pointercancel', (e) => finishPointer(e, true));
canvas.addEventListener('lostpointercapture', (e) => finishPointer(e, true));

// Pointer Events는 마우스의 첫 버튼 down/마지막 버튼 up만 보장한다.
// 양 버튼을 겹쳐 눌러 양손을 동시에 모을 수 있도록 마우스는 버튼별 이벤트로 따로 관리한다.
canvas.addEventListener('mousedown', (e) => {
  const side = e.button === 0 ? 'L' : e.button === 2 ? 'R' : null;
  if (!side) return;
  e.preventDefault();
  const token = `mouse:${e.button}`;
  if (mouseInputs.has(e.button) || !beginSideHold(side, token)) return;
  mouseInputs.set(e.button, side);
});
window.addEventListener('mouseup', (e) => {
  const side = mouseInputs.get(e.button);
  if (!side) return;
  mouseInputs.delete(e.button);
  finishSideHold(side, `mouse:${e.button}`, false);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// 다른 앱·탭으로 가거나 화면이 꺼지면 소리를 통째로 멈추고, 돌아오면 다시 켬
function goBackground() { cancelAllInputs(); sfx?.suspend(); }
function comeBack() { if (!document.hidden && document.hasFocus()) sfx?.resume(); }
window.addEventListener('blur', goBackground);
window.addEventListener('focus', comeBack);
window.addEventListener('pagehide', goBackground);
window.addEventListener('pageshow', comeBack);
document.addEventListener('visibilitychange', () => { if (document.hidden) goBackground(); else comeBack(); });
document.addEventListener('freeze', goBackground);

function vibrate(p) { try { if (navigator.vibrate && G.vibrate !== false) navigator.vibrate(p); } catch (e) {} }

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
  baseFov = layout.portrait ? 74 : 58;
  camera.fov = baseFov + cam.fov.x;
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
  const raw = Math.max(0, (nowMs - last) / 1000);
  adaptRes(raw);
  last = nowMs;
  advance(Math.min(0.05, raw));
  render();
}
// 한 걸음: 멈춤(히트스톱) 동안은 세상 시간만 거의 멈추고, 화면 반동·주먹 떨림은 실제 시간으로 흐름
function advance(rdt) {
  // 대폭발 슬로모션: 세상 시간만 느려짐(화면 반동·덮개는 실제 시간)
  const ts = skillFx ? skillFx.timeScale : 1;
  let dt = rdt * ts;
  if (hitstop > 0) { const h = Math.min(hitstop, rdt); hitstop -= rdt; dt = (rdt - h + h * HS_SLOW) * ts; }
  time += dt; rtime += rdt;
  rush = Math.max(0, rush - rdt * 2.5);
  step(dt, rdt);
}

function step(dt, rdt = dt) {
  for (const s of ['L', 'R']) {
    const f = fists[s], A = arms[s];
    f.tremble = wall ? wall.def.fear : 0;
    if (mode === 'play') f.update(dt, time);
    f.feel(rdt);
    f.pose(_pos);
    A.root.position.copy(_pos.position);
    A.root.quaternion.copy(_pos.quaternion);
    A.squash = f.comp * f.squashK;
    A.U.uImp.value.set(f.impT, f.ripA, f.ripZ);
    A.update(dt, time);
    if (A.scrapObj) A.scrapObj.update(dt, time);
  }
  // 슬라임 산에 고철이 삭음
  if (mode === 'play' && round && !round.ended) {
    for (const s of ['L', 'R']) {
      const a = arms[s], so = a.scrapObj;
      if (so && so.corrode > 0 && a.scrap.lumpHP > 0) {
        so.corrode -= dt;
        const res = { flesh: 0, scrap: 0, ev: [], point: null };
        a.damageScrap(dt * 9 * DAMAGE_PACE, res);
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
        a.damageFlesh(a.bleed * dt * DAMAGE_PACE, wall.def.kind, res);
        const c = res.flesh * FLESH_RATE * wall.def.mult + eventCredits(res.ev) * wall.def.mult;
        a._bleedAcc = (a._bleedAcc || 0) + c;
        if (a._bleedAcc >= 1) { const n = Math.floor(a._bleedAcc); a._bleedAcc -= n; addCredits(n); }
        for (const e of res.ev) handleEvent(a, e, null);
        dropCrushed(a);
        if (res.ev.length) checkRoundEnd();
      }
    }
  }
  if (wall) wall.update(dt, time, arms, fists);
  fx.update(dt, time, rdt);
  if (skillFx) {
    for (const s of ['L', 'R']) {
      const f = fists[s];
      let k = 0;
      const holding = mode === 'play' && f.inputHeld && f.chargeStart >= 0 && f.state === 'idle' && now() >= f.flinchUntil;
      if (holding) k = smooth(clamp((realSeconds() - f.chargeStart - CHARGE_START) / (CHARGE_FULL - CHARGE_START), 0, 1));
      skillFx.setCharge(s, k, holding);
    }
    skillFx.update(dt, rdt, time);
    // 중력이 터지거나 대폭발이 날 때 화면이 크게 밀림
    if (skillFx.camPunch) { const n = skillFx.camPunch; skillFx.camPunch = 0; cam.trauma = Math.min(1, cam.trauma + 0.5 * n); cam.push.kick(-0.012 * n); cam.fov.kick(-4 * n); cam.pitch.kick(-1.2 * n * D2R); }
  }
  camUpdate(rdt);
}
function now() { return time; }

let freeCam = null;   // 디버그: {p, t}
const _dbs = new THREE.Vector2();
function render() {
  camera.position.set(0, 0, 0);
  camera.lookAt(0, -0.075, -1);
  // 반동(스프링) + 흔들림(trauma) — 카메라 자기 축 기준
  const a = Math.pow(cam.trauma, 1.5), t = rtime, P = cam.ph;
  const nz = (i, f1, f2) => Math.sin(t * f1 + P[i]) * 0.62 + Math.sin(t * f2 + P[i + 3]) * 0.38;
  camera.translateZ(cam.push.x);
  camera.rotateX(cam.pitch.x + a * 1.0 * D2R * nz(0, 107, 163));
  camera.rotateY(cam.yaw.x + a * 0.75 * D2R * nz(1, 97, 151));
  camera.rotateZ(cam.roll.x + a * 1.4 * D2R * nz(2, 113, 173));
  const fov = baseFov + cam.fov.x - (skillFx ? skillFx.zoom * 7 : 0);
  if (Math.abs(fov - camera.fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
  // 입자 크기: 화면 높이(픽셀)와 시야각에 맞춤 — 세로 폰 화면(배율 2)에서 예전과 같은 크기
  PUFF_SCALE.value = renderer.getDrawingBufferSize(_dbs).y / (2 * Math.tan(camera.fov * D2R / 2)) / 1120;
  if (freeCam) { camera.position.copy(freeCam.p); camera.lookAt(freeCam.t); }
  renderer.clear();
  renderer.render(scene, camera);
  // 잔상 연타: 지나간 자리마다 반투명한 팔을 덧그림
  if (skillFx) skillFx.renderGhosts();
}

// ------------------------------------------------------------------ 시작
async function boot() {
  resize();
  const hadSave = load();
  assets = await loadArmAssets();
  initAnatomy(assets.header);
  fx = new FX(scene, renderer, G, lightPool);
  fx.anat = ANAT;
  sfx = new SFX();
  // 소리를 꺼 두고 나갔으면 다시 들어와도 꺼진 채로
  sfx.setMuted(!!G.muted);
  await sfx.prepare();
  arms.L = new Arm(assets, 'L'); arms.R = new Arm(assets, 'R');
  scene.add(arms.L.root, arms.R.root);
  fists.L = new Fist(arms.L); fists.R = new Fist(arms.R);
  skillFx = new SkillFX({ scene, camera, renderer, fx, sfx, arms, fists, lightPool, lights: [hemi, key, fill, rim, ...lightPool], getWall: () => wall });
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
  for (const mat of [fx.meatMat, fx.fatMat, fx.boneMat, fx.skinBitMat, fx.nailMat, fx.dropMat, arms.L.shardMat, arms.R.shardMat, arms.L.pulpMat, arms.R.pulpMat, arms.L.flapMat, arms.R.flapMat]) add(new THREE.Mesh(fx.meatGeos[0], mat));
  // 속살·뼈는 살이 터지기 전엔 숨어 있음 → 처음 터질 때 멈칫하지 않게 미리 컴파일
  const hidden = [];
  for (const s of ['L', 'R']) for (const m of [arms[s].meat, arms[s].bone]) if (!m.visible) { m.visible = true; hidden.push(m); }
  try { renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  for (const m of hidden) m.visible = false;
  for (const m of tmp) scene.remove(m);
  skillFx.warm();
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
    if (!arms.L.hasFist() && !arms.R.hasFist()) {
      mode = 'shop';
      document.body.classList.remove('playing');
      ui.hidePanels(); ui.showShop(round || { earned: 0 });
      return false;
    }
    mode = 'play';
    document.body.classList.add('playing');
    newRound();
    ui.credits(G.credits, 0);
    render();
    ui.hidePanels(); ui.hud(true);
    // 처음 치는 벽이면 이 벽의 모아치기를 한 줄로 알려 줌(처음 시작이면 조작 안내가 먼저)
    const sk = SKILL_OF[G.wall];
    if (!G.seenHints.controls) showHint('controls');
    else if (sk && sk.id !== 'shock' && !G.seenSkill[sk.id]) { G.seenSkill[sk.id] = true; ui.say(`새 모아치기: ${sk.name}`); save(); }
    return true;
  },
  newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    location.reload();
  },
  buyWall(id) {
    const d = WALLS.find((w) => w.id === id);
    if (!d || G.owned.includes(id) || G.credits < d.price) return false;
    // 벽은 순서대로만 — 건너뛰면 그 벽의 모아치기를 못 보고 지나가게 됨
    if (nextWall() !== d) return false;
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
    resetArmMotion(side);
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
    resetArmMotion(side);
    G.arms[side] = armSnapshot(a);
    save(); sfx.play('scrapOn', 0.9); return true;
  },
  canStart() { return arms.L.hasFist() || arms.R.hasFist(); },
  restorePrice, scrapPrice: (s) => scrapPrice(arms[s]),
  nextWall: () => nextWall(),
  armInfo(s) { const a = arms[s]; return { flesh: a.I < 0.5, I: a.I, scrap: !!(a.scrap && a.scrap.lumpHP > 0), fist: a.hasFist(), crushed: a.crushZ < 0.095, broken: a.brokenK() > 0 }; },
  toggleSound(on) { sfx.setMuted(!on); G.muted = !on; save(); },
  isMuted() { return !!G.muted; },
};

function nextWall() { return WALLS.find((w) => !G.owned.includes(w.id)) || null; }
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
  for (let i = 0; i < n; i++) advance(dt);
  if (draw) render();
}
window.__cg = { tick, setManual(v) { manual = v; }, G, arms, fists, get wall() { return wall; }, actions, setWall, press: pressSide, get mode() { return mode; }, set mode(v) { mode = v; }, step, newRound, get round() { return round; }, addCredits, poses, camera, scene, renderer, set freeCam(v) { freeCam = v ? { p: new THREE.Vector3(...v.p), t: new THREE.Vector3(...v.t) } : null; }, THREE, SEG, get ANAT() { return ANAT; }, get fx() { return fx; }, get sfx() { return sfx; }, cam, get hitstop() { return hitstop; }, get skillFx() { return skillFx; }, get time() { return time; } };

boot().catch((e) => { console.error(e); const el = $('#err'); if (el) { el.textContent = '불러오기 실패: ' + e.message; el.style.display = 'block'; } });

