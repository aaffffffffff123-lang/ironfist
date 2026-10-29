// 철권 — 고철 의수: 없어진 자리를 고철 덩어리·쇠파이프로 대충 메움. 맞으면 부품이 떨어져 나감.
import * as THREE from 'three';

let CACHE = null;
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const OBJ_NOISE = /* glsl */`
varying vec3 vObj;
float h3(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fb3(vec3 p){ return n3(p)*0.5 + n3(p*2.1+1.3)*0.3 + n3(p*4.3+2.7)*0.2; }
`;
function metalMat(color, rough, metal, rust, key) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + OBJ_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rs = smoothstep(${(0.62 - rust * 0.4).toFixed(3)}, ${(0.82 - rust * 0.3).toFixed(3)}, fb3(vObj * 260.0));
        float sp = smoothstep(0.7, 0.85, n3(vObj * 1400.0));
        vec3 rc = mix(vec3(0.30, 0.10, 0.03), vec3(0.50, 0.20, 0.06), n3(vObj * 700.0));
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.25 * n3(vObj * 500.0)), rc, clamp(rs + sp * ${(rust * 0.4).toFixed(3)}, 0.0, 1.0));
        float rustM = rs;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, rustM);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.25, rustM);');
  };
  m.customProgramCacheKey = () => 'scrap-' + key;
  return m;
}

function hexShape(r, hole) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? s.lineTo(x, y) : s.moveTo(x, y); }
  if (hole) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h); }
  return s;
}
function gearShape(r, teeth, hole) {
  const s = new THREE.Shape(); const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2; const tooth = (i % 4 === 1 || i % 4 === 2) ? 1.0 : 0.82;
    const x = Math.cos(a) * r * tooth, y = Math.sin(a) * r * tooth; i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h);
  return s;
}
function ringShape(r, hole) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h); return s; }
const ext = (shape, depth, bevel = 0.0006) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 10 }); g.translate(0, 0, -depth / 2); g.computeVertexNormals(); return g; };

function mergeAll(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3); let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

function buildCache() {
  const C = {};
  C.nut = ext(hexShape(0.0085, 0.0045), 0.007);
  C.nutS = ext(hexShape(0.006, 0.003), 0.005);
  C.washer = ext(ringShape(0.011, 0.0048), 0.0016, 0.0003);
  C.gear = ext(gearShape(0.017, 14, 0.005), 0.005);
  C.gearS = ext(gearShape(0.011, 10, 0.0035), 0.004);
  {
    const head = ext(hexShape(0.0075, 0), 0.0055); head.translate(0, 0, 0.0028);
    const sh = new THREE.CylinderGeometry(0.0042, 0.0042, 0.05, 10); sh.rotateX(Math.PI / 2); sh.translate(0, 0, -0.025);
    const thr = []; for (let i = 0; i < 9; i++) { const t = new THREE.TorusGeometry(0.0043, 0.0006, 4, 10); t.translate(0, 0, -0.022 - i * 0.003); thr.push(t); }
    C.bolt = mergeAll([head, sh, ...thr]);
  }
  {
    const L = new THREE.TorusGeometry(0.008, 0.0022, 6, 18); L.scale(1, 1.7, 1); C.link = L;
  }
  {
    const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120, a = t * Math.PI * 2 * 7; pts.push(new THREE.Vector3(Math.cos(a) * 0.006, Math.sin(a) * 0.006, (t - 0.5) * 0.034)); }
    C.spring = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.0008, 5, false);
  }
  {
    const e = new THREE.TorusGeometry(0.014, 0.0065, 10, 16, Math.PI / 2);
    const c1 = new THREE.CylinderGeometry(0.0072, 0.0072, 0.008, 12); c1.translate(0.014, -0.004, 0);
    const c2 = new THREE.CylinderGeometry(0.0072, 0.0072, 0.008, 12); c2.rotateZ(Math.PI / 2); c2.translate(-0.004, 0.014, 0);
    C.elbow = mergeAll([e, c1, c2]);
  }
  {
    const p1 = new THREE.BoxGeometry(0.03, 0.022, 0.0018); p1.translate(-0.016, 0, 0);
    const p2 = new THREE.BoxGeometry(0.03, 0.022, 0.0018); p2.translate(0.016, 0, 0.0); p2.rotateY(0.6);
    const k = new THREE.CylinderGeometry(0.0028, 0.0028, 0.024, 10);
    C.hinge = mergeAll([p1, p2, k]);
  }
  {
    const r = new THREE.CylinderGeometry(0.0055, 0.0055, 0.06, 10); const ribs = [];
    for (let i = 0; i < 10; i++) { const t = new THREE.TorusGeometry(0.0057, 0.0009, 4, 10); t.rotateX(Math.PI / 2); t.rotateZ(0.25); t.translate(0, -0.027 + i * 0.006, 0); ribs.push(t); }
    C.rebar = mergeAll([r, ...ribs]);
  }
  {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.022, 0); s.lineTo(0.022, 0.0028); s.lineTo(0.0028, 0.0028); s.lineTo(0.0028, 0.022); s.lineTo(0, 0.022); s.lineTo(0, 0);
    C.angle = ext(s, 0.045, 0.0003); C.angle.translate(-0.008, -0.008, 0);
  }
  {
    const pipe = new THREE.CylinderGeometry(0.0115, 0.0115, 1, 16, 1, true); C.pipeUnit = pipe;
    const pin = new THREE.CylinderGeometry(0.0095, 0.0095, 1, 16, 1, true); C.pipeIn = pin;
  }
  // 실제 게임 화면에서 비교하는 철권 시안용 큰 부품. 기본 랜덤 철권에는 쓰지 않는다.
  C.bigNut = ext(hexShape(0.023, 0.010), 0.011, 0.0009);
  C.bigWasher = ext(ringShape(0.024, 0.0105), 0.0022, 0.00035);
  C.threadRod = new THREE.CylinderGeometry(0.0088, 0.0088, 0.082, 12);
  C.threadRod.rotateX(Math.PI / 2);
  C.kitchenCore = new THREE.BoxGeometry(0.056, 0.044, 0.052, 2, 2, 2);
  C.canPanel = new THREE.CylinderGeometry(0.018, 0.018, 0.032, 14, 1, true, 0.18, Math.PI * 1.35);
  C.tinLid = new THREE.CylinderGeometry(0.016, 0.016, 0.0018, 18);
  C.tinLid.rotateX(Math.PI / 2);
  C.spoonBowl = new THREE.SphereGeometry(0.012, 14, 9);
  C.spoonHandle = new THREE.BoxGeometry(0.0042, 0.029, 0.0022);
  C.rivet = new THREE.CylinderGeometry(0.0023, 0.0028, 0.0035, 10);
  C.rivet.rotateX(Math.PI / 2);
  C.previewPalm = new THREE.BoxGeometry(0.060, 0.044, 0.020, 2, 2, 2);
  C.pipePlate = new THREE.BoxGeometry(0.070, 0.052, 0.016, 2, 2, 1);
  C.doorSlab = new THREE.BoxGeometry(0.088, 0.058, 0.014, 2, 2, 1);
  C.doorLatch = new THREE.BoxGeometry(0.058, 0.010, 0.007);
  C.bearingRing = new THREE.TorusGeometry(0.036, 0.0025, 6, 30);
  C.bearingBall = new THREE.SphereGeometry(1, 14, 10);
  C.clampCore = new THREE.BoxGeometry(0.040, 0.036, 0.038, 2, 2, 2);
  C.clampHandle = new THREE.BoxGeometry(0.007, 0.052, 0.007);
  C.clampJaw = new THREE.BoxGeometry(0.014, 0.018, 0.014);
  C.clampPivot = new THREE.CylinderGeometry(0.006, 0.006, 0.012, 10);
  C.clampPivot.rotateX(Math.PI / 2);
  C.bikeGear = ext(gearShape(0.038, 22, 0.013), 0.006, 0.0005);
  C.bellDome = new THREE.SphereGeometry(0.017, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  C.bellDome.rotateX(Math.PI / 2);
  C.bellBase = new THREE.CylinderGeometry(0.018, 0.018, 0.003, 18);
  C.bellBase.rotateX(Math.PI / 2);
  C.brakePad = new THREE.BoxGeometry(0.029, 0.010, 0.009);
  C.heatBase = new THREE.BoxGeometry(0.074, 0.058, 0.010);
  C.heatFin = new THREE.BoxGeometry(0.0025, 0.052, 0.055);
  C.heatRail = new THREE.BoxGeometry(0.076, 0.006, 0.004);
  C.giantBoltHead = ext(hexShape(0.032, 0), 0.018, 0.0012);
  C.giantBoltNut = ext(hexShape(0.026, 0.011), 0.015, 0.001);
  C.giantBoltWasher = ext(ringShape(0.031, 0.012), 0.003, 0.0004);
  C.giantBoltRod = new THREE.CylinderGeometry(0.0112, 0.0112, 0.112, 12);
  C.giantBoltRod.rotateZ(Math.PI / 2);
  C.giantBoltThread = new THREE.TorusGeometry(0.0117, 0.0009, 4, 12);
  C.giantBoltThread.rotateY(Math.PI / 2);
  C.mat = {
    rust: metalMat(0x7a6656, 0.55, 0.75, 0.75, 'rust'),
    galv: metalMat(0xb9bec4, 0.4, 1.0, 0.18, 'galv'),
    brass: metalMat(0xc8a248, 0.32, 1.0, 0.12, 'brass'),
    black: metalMat(0x37383a, 0.5, 0.85, 0.35, 'black'),
    tape: new THREE.MeshStandardMaterial({ color: 0xa8acaf, roughness: 0.62, metalness: 0.35 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.45, metalness: 0.9 }),
    canRed: metalMat(0x7d2921, 0.48, 0.72, 0.36, 'can-red'),
    hole: new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 0.95, side: THREE.BackSide }),
  };
  return C;
}

// 테이프 띠(구겨진)
function tapeBand(rng, r, w) {
  const g = new THREE.CylinderGeometry(r, r, w, 28, 3, true);
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + (rng() - 0.5) * 0.12; v.x *= k; v.z *= k; v.y += (rng() - 0.5) * w * 0.25; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals();
  return g;
}
function wireLoop(rng, r) {
  const pts = []; const turns = 2 + Math.floor(rng() * 2);
  for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * Math.PI * 2 * turns; pts.push(new THREE.Vector3(Math.cos(a) * r * (1 + (rng() - 0.5) * 0.1), (t - 0.5) * 0.012 + (rng() - 0.5) * 0.002, Math.sin(a) * r * (1 + (rng() - 0.5) * 0.1))); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.0009, 5, false);
}

// 파마가 풀리며 생긴 라면 꼬다리. X/Y 평면으로 뻗고 Z로 조금씩 튀어나온다.
function wireTendril(rng, angle, len, turns) {
  const pts = [];
  const dx = Math.cos(angle), dy = Math.sin(angle), px = -dy, py = dx;
  for (let i = 0; i <= 72; i++) {
    const t = i / 72, a = t * Math.PI * 2 * turns + rng() * 0.08;
    const travel = 0.013 + len * t;
    const curl = (0.0046 - t * 0.0012) * Math.sin(a);
    pts.push(new THREE.Vector3(
      dx * travel + px * curl,
      dy * travel + py * curl,
      0.005 + Math.cos(a) * 0.004 + t * 0.005
    ));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 150, 0.00105, 5, false);
}

export class Scrap {
  constructor(arm, seed) {
    if (!CACHE) CACHE = buildCache();
    this.arm = arm;
    const rng = this.rng = mulberry(Math.floor(seed));
    this.group = new THREE.Group();
    arm.attach.forearm.add(this.group);
    const C = CACHE, M = C.mat;
    // 붙이는 자리: 그루터기 끝(cutZ) → 원래 손목(0.004)까지는 쇠파이프
    const stumpZ = Math.min(arm.cutZ, 0.006);
    const wristZ = 0.004;
    this.pipe = null;
    let pipeHP = 0;
    if (stumpZ < -0.012) {
      const len = wristZ - stumpZ + 0.02;
      const pipe = new THREE.Mesh(C.pipeUnit, M.rust);
      pipe.scale.set(1, len, 1); pipe.rotation.x = Math.PI / 2;
      pipe.position.set(0, 0.0, stumpZ + len / 2 - 0.012);
      const inner = new THREE.Mesh(C.pipeIn, new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.9, side: THREE.BackSide }));
      inner.scale.set(1, len, 1); inner.rotation.x = Math.PI / 2; inner.position.copy(pipe.position);
      this.group.add(pipe, inner);
      this.pipe = pipe; this.pipeInner = inner;
      pipeHP = 30 + len * 140;
    }
    // 그루터기 묶는 호스 밴드·철사·테이프
    for (let k = 0; k < 2; k++) {
      const band = new THREE.Mesh(tapeBand(rng, 0.0315 + k * 0.001, 0.014), M.tape);
      band.rotation.x = Math.PI / 2; band.position.set(0, -0.001, stumpZ - 0.012 - k * 0.012);
      band.scale.set(1.0, 1, 0.72);
      this.group.add(band);
    }
    const clamp = new THREE.Mesh(tapeBand(rng, 0.033, 0.009), M.galv);
    clamp.rotation.x = Math.PI / 2; clamp.position.set(0, -0.001, stumpZ - 0.02); clamp.scale.set(1, 1, 0.72);
    this.group.add(clamp);
    const screw = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.007, 0.012), M.galv); screw.position.set(0.0, 0.026, stumpZ - 0.02); this.group.add(screw);
    // 덩어리
    this.parts = [];
    const lump = new THREE.Group();
    lump.position.set(0, -0.004, 0.050);
    this.group.add(lump); this.lump = lump;
    const previewKind = new URLSearchParams(location.search).get('scrapPreview') || '';
    this.previewKind = previewKind;
    const keep = (o) => {
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      lump.add(o); this.parts.push(o); return o;
    };

    if (previewKind === 'wire') {
      // 기본형보다 외곽 부피가 두 배 가까이 읽히는 철사 파마 덩어리.
      const core = keep(new THREE.Mesh(new THREE.DodecahedronGeometry(0.028, 0), M.rust));
      core.position.set(0, -0.001, 0.009); core.scale.set(1.18, 1.0, 0.65);
      for (let i = 0; i < 18; i++) {
        const w = new THREE.Mesh(wireLoop(rng, 0.042 + rng() * 0.010), i % 5 === 0 ? M.copper : M.wire);
        w.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
        w.scale.set(1.08 + rng() * 0.18, 0.95 + rng() * 0.18, 0.55);
        lump.add(w);
      }
      this.tendrils = [];
      const dirs = [-2.9, -2.35, -1.8, -1.18, -0.55, 0.1, 0.72, 1.35, 1.98, 2.55];
      for (let i = 0; i < dirs.length; i++) {
        const w = new THREE.Mesh(wireTendril(rng, dirs[i], 0.052 + rng() * 0.028, 2.4 + rng() * 1.8), i % 4 === 0 ? M.copper : M.wire);
        w.position.z = -0.004 + rng() * 0.007;
        w.rotation.z = (rng() - 0.5) * 0.18;
        lump.add(w); this.tendrils.push(w);
      }
      for (let i = 0; i < 3; i++) {
        const m = keep(new THREE.Mesh(i === 1 ? C.nutS : C.washer, i === 1 ? M.brass : M.galv));
        m.position.set((i - 1) * 0.012, (i % 2 ? 1 : -1) * 0.008, 0.031 + i * 0.002);
        m.rotation.set(rng() * 2, rng() * 2, rng() * 2);
      }
    } else if (previewKind === 'bolt') {
      // 화면을 가로지르는 볼트 한 개: 왼쪽 육각 머리, 오른쪽 너트와 드러난 나사산.
      const rod = keep(new THREE.Mesh(C.giantBoltRod, M.black));
      rod.position.set(0.001, -0.002, 0.009); rod.rotation.z = -0.08;
      for (let i = 0; i < 15; i++) {
        const t = keep(new THREE.Mesh(C.giantBoltThread, i % 4 === 0 ? M.galv : M.rust));
        t.position.set(-0.026 + i * 0.0054, -0.002 + i * 0.0004, 0.009);
        t.rotation.z = -0.08;
      }
      const head = keep(new THREE.Mesh(C.giantBoltHead, M.galv));
      head.rotation.set(0, Math.PI / 2, -0.08); head.position.set(-0.050, 0.002, 0.009);
      const washer = keep(new THREE.Mesh(C.giantBoltWasher, M.rust));
      washer.rotation.set(0, Math.PI / 2, -0.08); washer.position.set(0.018, -0.003, 0.009);
      const nut = keep(new THREE.Mesh(C.giantBoltNut, M.brass));
      nut.rotation.set(0, Math.PI / 2, -0.08); nut.position.set(0.033, -0.004, 0.009);
      const mount = keep(new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.032, 0.014), M.rust));
      mount.position.set(0, 0, -0.018); mount.rotation.z = 0.05;
    } else if (previewKind === 'kitchen') {
      // 큰 비대칭 캔판과 처진 뚜껑이 먼저 보이고, 식기·철수세미는 그 위의 조연이다.
      const core = keep(new THREE.Mesh(C.kitchenCore, M.rust));
      core.position.z = 0.008; core.scale.set(1.08, 0.92, 0.88); core.rotation.z = 0.06;
      const redWing = keep(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.060, 16, 1, true, 0.2, Math.PI * 1.35), M.canRed));
      redWing.position.set(-0.052, 0.004, 0.006); redWing.rotation.set(0.08, 0.52, 0.30); redWing.scale.set(1.15, 1, 0.62);
      const tinWing = keep(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.052, 16, 1, true, 0.1, Math.PI * 1.25), M.galv));
      tinWing.position.set(0.045, -0.012, 0.002); tinWing.rotation.set(-0.08, -0.55, -0.24); tinWing.scale.set(1.0, 1, 0.66);
      const lid = keep(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.002, 20), M.brass));
      lid.rotation.x = Math.PI / 2; lid.position.set(0.052, -0.034, 0.020); lid.rotation.z = 0.45;
      const spoonPos = [[-0.023, 0.008, -0.28], [0, 0.012, 0.03], [0.023, 0.005, 0.34]];
      for (let i = 0; i < spoonPos.length; i++) {
        const [x, y, rz] = spoonPos[i], spoon = new THREE.Group();
        const bowl = new THREE.Mesh(C.spoonBowl, i === 1 ? M.brass : M.galv);
        bowl.position.y = 0.007; bowl.scale.set(0.82, 1.18, 0.28);
        const handle = new THREE.Mesh(C.spoonHandle, i === 1 ? M.brass : M.galv); handle.position.y = -0.012;
        spoon.add(bowl, handle); spoon.position.set(x, y, 0.040); spoon.rotation.z = rz; keep(spoon);
      }
      for (let i = 0; i < 9; i++) {
        const wool = new THREE.Mesh(wireLoop(rng, 0.010 + rng() * 0.005), M.wire);
        wool.position.set(0.010 + (rng() - 0.5) * 0.045, 0.035 + (rng() - 0.5) * 0.018, 0.004 + rng() * 0.010);
        wool.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI); wool.scale.set(0.9, 0.75, 0.45); lump.add(wool);
      }
    } else if (previewKind === 'hand') {
      const palm = keep(new THREE.Mesh(C.previewPalm, M.rust));
      palm.position.set(0, 0, 0.016); palm.rotation.z = -0.03;
      const xs = [-0.025, -0.008, 0.010, 0.026], ys = [0.039, 0.044, 0.041, 0.034];
      const lens = [0.72, 0.92, 0.82, 0.62], rz = [-0.23, -0.07, 0.12, 0.29];
      for (let i = 0; i < 4; i++) {
        const f = keep(new THREE.Mesh(C.rebar, M.rust));
        f.position.set(xs[i], ys[i], 0.017 + i * 0.001); f.scale.set(0.82, lens[i], 0.82); f.rotation.z = rz[i];
        const kn = keep(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.014), i === 2 ? M.galv : M.rust));
        kn.position.set(xs[i], 0.014, 0.039); kn.rotation.z = rz[i] * 0.5;
      }
      const thumb = keep(new THREE.Mesh(C.rebar, M.rust));
      thumb.position.set(-0.041, -0.001, 0.016); thumb.scale.set(0.82, 0.50, 0.82); thumb.rotation.z = 1.03;
    } else if (previewKind === 'pipes') {
      const plate = keep(new THREE.Mesh(C.pipePlate, M.black)); plate.position.z = -0.012;
      const specs = [[-0.028, 0.012, 0.011, 0.048], [-0.009, 0.015, 0.0095, 0.043], [0.011, 0.012, 0.0125, 0.050], [0.030, 0.006, 0.010, 0.045], [0.003, -0.019, 0.013, 0.046]];
      for (const [x, y, r, len] of specs) {
        const shell = keep(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16, 1, true), M.rust));
        shell.rotation.x = Math.PI / 2; shell.position.set(x, y, 0.019);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.78, len + 0.001, 16, 1, true), M.hole);
        inner.rotation.x = Math.PI / 2; inner.position.copy(shell.position); lump.add(inner);
        const collar = keep(new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.0016, 5, 18), M.galv));
        collar.position.set(x, y, 0.043);
      }
    } else if (previewKind === 'door') {
      const slab = keep(new THREE.Mesh(C.doorSlab, M.rust)); slab.position.z = 0.023; slab.rotation.z = 0.03;
      for (const [x, y, rz] of [[-0.023, 0.012, -0.08], [0.018, 0.013, 0.09], [-0.014, -0.017, 0.03]]) {
        const h = keep(new THREE.Mesh(C.hinge, M.galv)); h.position.set(x, y, 0.035); h.rotation.z = rz; h.scale.setScalar(0.72);
      }
      const latch = keep(new THREE.Mesh(C.doorLatch, M.brass)); latch.position.set(-0.010, 0.014, 0.039);
      const lock = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.023, 0.008), M.brass); body.position.y = -0.008;
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.010, 0.0028, 6, 18, Math.PI), M.galv); shackle.position.y = 0.006;
      lock.add(body, shackle); lock.position.set(0.028, -0.004, 0.039); keep(lock);
      const handle = keep(new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0034, 7, 20, Math.PI), M.galv));
      handle.position.set(-0.020, -0.018, 0.040); handle.rotation.z = Math.PI;
    } else if (previewKind === 'bearing') {
      const cage = new THREE.Group();
      for (const [rx, ry, rz] of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) {
        const ring = new THREE.Mesh(C.bearingRing, M.rust); ring.rotation.set(rx, ry, rz); ring.scale.y = 0.86; cage.add(ring);
      }
      cage.position.z = 0.007; keep(cage);
      const balls = [[-0.017, 0.010, 0.010, 0.011], [0.012, 0.013, 0.018, 0.012], [-0.006, -0.015, 0.024, 0.0115], [0.021, -0.010, 0.004, 0.0105]];
      for (let i = 0; i < balls.length; i++) {
        const [x, y, z, r] = balls[i], b = keep(new THREE.Mesh(C.bearingBall, i === 2 ? M.brass : M.galv));
        b.position.set(x, y, z); b.scale.setScalar(r);
      }
    } else if (previewKind === 'clamps') {
      const core = keep(new THREE.Mesh(C.clampCore, M.rust)); core.position.z = 0.010;
      [0, 2.08, 4.16].forEach((a, i) => {
        const g = new THREE.Group(); g.rotation.z = a + (i - 1) * 0.12;
        for (const s of [-1, 1]) {
          const h = new THREE.Mesh(C.clampHandle, i === 1 ? M.galv : M.rust); h.position.set(s * 0.009, -0.030, 0.004); h.rotation.z = s * 0.19; g.add(h);
          const jaw = new THREE.Mesh(C.clampJaw, M.black); jaw.position.set(s * 0.006, 0.010, 0.033); jaw.rotation.z = -s * 0.12; g.add(jaw);
        }
        const pivot = new THREE.Mesh(C.clampPivot, M.brass); pivot.position.set(0, 0, 0.025); g.add(pivot); keep(g);
      });
    } else if (previewKind === 'bicycle') {
      const gear = keep(new THREE.Mesh(C.bikeGear, M.rust)); gear.position.z = 0.034; gear.rotation.z = 0.08;
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2, link = keep(new THREE.Mesh(C.link, i % 3 ? M.black : M.galv));
        link.position.set(Math.cos(a) * 0.043, Math.sin(a) * 0.035, 0.018); link.rotation.z = a + Math.PI / 2 + (i % 2 ? 0.35 : -0.35); link.scale.setScalar(0.52);
      }
      for (let i = 0; i < 4; i++) {
        const tail = keep(new THREE.Mesh(C.link, M.rust)); tail.position.set(0.020 + i * 0.003, -0.047 - i * 0.011, 0.015); tail.rotation.z = i % 2 ? 0.6 : -0.3; tail.scale.setScalar(0.55);
      }
      const bell = new THREE.Group(); bell.add(new THREE.Mesh(C.bellBase, M.black), new THREE.Mesh(C.bellDome, M.brass)); bell.position.set(0.044, 0.023, 0.021); keep(bell);
      const pad = keep(new THREE.Mesh(C.brakePad, M.black)); pad.position.set(-0.034, -0.030, 0.032); pad.rotation.z = -0.25;
    } else if (previewKind === 'heatsink') {
      const base = keep(new THREE.Mesh(C.heatBase, M.black)); base.position.z = -0.020;
      for (let i = 0; i < 11; i++) {
        const fin = keep(new THREE.Mesh(C.heatFin, i === 2 || i === 8 ? M.rust : M.galv));
        fin.position.set(-0.033 + i * 0.0066, 0, 0.008);
        if (i >= 8) { fin.rotation.z = (i - 7) * 0.08; fin.position.y -= (i - 7) * 0.002; }
      }
      for (const y of [-0.027, 0.027]) {
        const rail = keep(new THREE.Mesh(C.heatRail, M.rust)); rail.position.set(0, y, 0.038);
      }
    } else {
      const kinds = ['nut', 'nut', 'nutS', 'washer', 'gear', 'gearS', 'bolt', 'bolt', 'link', 'link', 'spring', 'elbow', 'hinge', 'rebar', 'angle'];
      const mats = { nut: ['galv', 'rust', 'black'], nutS: ['galv', 'brass'], washer: ['galv', 'rust'], gear: ['rust', 'black'], gearS: ['brass', 'rust'], bolt: ['galv', 'black', 'rust'], link: ['rust', 'galv'], spring: ['galv', 'black'], elbow: ['rust', 'galv'], hinge: ['brass', 'rust'], rebar: ['rust'], angle: ['rust', 'black'] };
      const n = 14 + Math.floor(rng() * 5);
      for (let i = 0; i < n; i++) {
        const k = kinds[Math.floor(rng() * kinds.length)];
        const mList = mats[k];
        const m = new THREE.Mesh(C[k], M[mList[Math.floor(rng() * mList.length)]]);
        // 타원체 안쪽에 대충 쌓음. 앞(+z)쪽에 더 몰리게
        const u = rng() * 2 - 1, th = rng() * Math.PI * 2, rr = Math.cbrt(rng()) * 0.9;
        const s = Math.sqrt(1 - u * u);
        m.position.set(Math.cos(th) * s * rr * 0.033, u * rr * 0.026, Math.sin(th) * s * rr * 0.040 + 0.006);
        m.rotation.set(rng() * 6.28, rng() * 6.28, rng() * 6.28);
        const sc = 0.85 + rng() * 0.45; m.scale.setScalar(sc);
        keep(m);
      }
    }
    // 덩어리 감는 테이프 + 철사
    this.wraps = [];
    if (previewKind === 'wire') {
      for (let k = 0; k < 5; k++) {
        const w = new THREE.Mesh(wireLoop(rng, 0.046 + k * 0.0015), k === 1 || k === 4 ? M.copper : M.wire);
        w.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI); w.scale.set(1.12, 1.02, 0.55);
        lump.add(w); this.wraps.push(w);
      }
    } else if (previewKind === 'bolt') {
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(tapeBand(rng, 0.024 + k * 0.001, 0.006), M.tape);
        b.rotation.x = Math.PI / 2; b.position.z = -0.022 + k * 0.008; b.scale.set(1, 1, 0.66);
        lump.add(b); this.wraps.push(b);
      }
    } else if (previewKind === 'kitchen') {
      for (let k = 0; k < 2; k++) {
        const b = new THREE.Mesh(tapeBand(rng, 0.026 + k * 0.001, 0.006), k ? M.tape : M.wire);
        b.rotation.x = Math.PI / 2; b.position.z = -0.020 + k * 0.008; b.scale.set(1, 1, 0.68);
        lump.add(b); this.wraps.push(b);
      }
    } else if (!previewKind || previewKind === 'base') {
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(tapeBand(rng, 0.036 - k * 0.002, 0.012 + rng() * 0.006), M.tape);
        b.rotation.set(rng() * 3.14, rng() * 3.14, rng() * 3.14); b.scale.set(1, 1, 0.82);
        b.castShadow = true; lump.add(b); this.wraps.push(b);
      }
      for (let k = 0; k < 2; k++) {
        const w = new THREE.Mesh(wireLoop(rng, 0.037), rng() < 0.5 ? M.copper : M.wire);
        w.rotation.set(rng() * 3.14, rng() * 3.14, rng() * 3.14); w.scale.set(1, 1, 0.85);
        lump.add(w); this.wraps.push(w);
      }
    }
    // 덩어리 → 그루터기 사이를 잇는 쇠막대 두어 개
    if (!this.pipe) {
      for (let k = 0; k < 2; k++) {
        const r = new THREE.Mesh(C.rebar, M.rust);
        r.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.3; r.rotation.z = (rng() - 0.5) * 0.4;
        r.position.set((k ? 1 : -1) * 0.012, (rng() - 0.5) * 0.01, 0.012);
        this.group.add(r);
      }
    }
    this.state = { lumpHP: 140, pipeHP, partsLeft: this.parts.length };
    this.totalLump = 140;
    this.heat = 0;
    // 달아오른 쇳덩이 빛 — 가장자리로 갈수록 흐려지는 공(납작한 원판처럼 안 보이게)
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.043, 18, 12), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { opacity: { value: 0 } }, toneMapped: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float c = pow(clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.2); gl_FragColor = vec4(vec3(1.0, 0.29, 0.06) * c * opacity * 1.6, 1.0); }',
    }));
    if (previewKind === 'bolt') this.glow.scale.set(0.68, 0.68, 1.2);
    else if (previewKind === 'kitchen') this.glow.scale.set(1.0, 0.82, 0.96);
    else this.glow.scale.set(0.95, 0.8, 1.05);
    lump.add(this.glow);
  }
  // 맞을 때 부품이 떨어져 나감. 떨어진 개수 반환
  onDamage(hit, fx, wall, contact) {
    let n = 0;
    const st = this.state;
    if (hit === 'lump') {
      const want = Math.ceil(this.parts.length * (1 - st.lumpHP / this.totalLump) * 1.05);
      const lost = this.initialParts ? this.initialParts - this.parts.length : 0;
      if (!this.initialParts) this.initialParts = this.parts.length;
      const target = Math.ceil(this.initialParts * (1 - st.lumpHP / this.totalLump));
      while (this.initialParts - this.parts.length < target && this.parts.length) {
        // 앞쪽(벽쪽) 부품부터
        this.parts.sort((a, b) => b.position.z - a.position.z);
        const p = this.parts.shift();
        const embed = Math.random() < 0.5 && !!wall;
        fx.flyScrapPart(p, embed);
        n++;
      }
      // 테이프·철사도 하나씩 풀림
      const wl = Math.floor(this.wraps.length * (1 - st.lumpHP / this.totalLump));
      while (this.wraps.length && this.wraps.length > (5 - wl)) { const w = this.wraps.pop(); w.parent && w.parent.remove(w); }
      if (st.lumpHP <= 0) {
        for (const p of this.parts) fx.flyScrapPart(p, Math.random() < 0.4);
        n += this.parts.length; this.parts = [];
        for (const w of this.wraps) w.parent && w.parent.remove(w);
        this.wraps = [];
        // 덩어리에 물려 있던 쥐덫도 같이 떨어짐
        const arm = this.arm;
        for (const tr of arm.traps.slice()) {
          if (tr.obj.parent !== this.lump) continue;
          arm.traps.splice(arm.traps.indexOf(tr), 1);
          if (fx.dropObject) fx.dropObject(tr.obj, arm); else this.lump.remove(tr.obj);
        }
      }
    } else if (hit === 'pipe' && this.pipe) {
      const k = Math.max(0.05, st.pipeHP / (this.pipeHP0 || (this.pipeHP0 = st.pipeHP + 1)));
      this.pipe.rotation.z = (1 - k) * 0.25; this.pipe.rotation.y = (1 - k) * 0.15;
      if (st.pipeHP <= 0) { fx.flyScrapPart(this.pipe, false); if (this.pipeInner) this.pipeInner.parent && this.pipeInner.parent.remove(this.pipeInner); this.pipe = null; n++; }
    }
    st.partsLeft = this.parts.length;
    return n;
  }
  update(dt, time) {
    if (this.lump) this.lump.rotation.z = Math.sin(time * 13) * 0.004;
    this.heat = Math.max(0, this.heat - dt * 0.12);
    this.glow.material.uniforms.opacity.value = Math.min(0.55, this.heat * 0.6) * (0.85 + Math.sin(time * 9) * 0.15);
    this.glow.visible = this.heat > 0.01 && this.state.lumpHP > 0;
  }
  dispose() { this.group.parent && this.group.parent.remove(this.group); }
}
