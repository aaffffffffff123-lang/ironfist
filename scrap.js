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
  C.mat = {
    rust: metalMat(0x7a6656, 0.55, 0.75, 0.75, 'rust'),
    galv: metalMat(0xb9bec4, 0.4, 1.0, 0.18, 'galv'),
    brass: metalMat(0xc8a248, 0.32, 1.0, 0.12, 'brass'),
    black: metalMat(0x37383a, 0.5, 0.85, 0.35, 'black'),
    tape: new THREE.MeshStandardMaterial({ color: 0xa8acaf, roughness: 0.62, metalness: 0.35 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.45, metalness: 0.9 }),
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
      m.castShadow = true; m.receiveShadow = true;
      lump.add(m);
      this.parts.push(m);
    }
    // 덩어리 감는 테이프 + 철사
    this.wraps = [];
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
    this.heat = 0; this.corrode = 0;
    // 달아오른 쇳덩이 빛 — 가장자리로 갈수록 흐려지는 공(납작한 원판처럼 안 보이게)
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.043, 18, 12), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { opacity: { value: 0 } }, toneMapped: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float opacity; varying vec3 vN; varying vec3 vV; void main(){ float c = pow(clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.2); gl_FragColor = vec4(vec3(1.0, 0.29, 0.06) * c * opacity * 1.6, 1.0); }',
    }));
    this.glow.scale.set(0.95, 0.8, 1.05); lump.add(this.glow);
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
        const embed = Math.random() < 0.5 && wall && wall.def.id !== 'slime';
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
