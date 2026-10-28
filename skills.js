// 철권 — 모아치기 기술. 벽마다 하나씩 붙어 있고, 벽을 새로 사면 그 벽의 기술을 쓴다.
// 원칙: 아무리 화려해도 벽에는 피·살점 말고 아무 흔적도 남지 않는다. 화려해질수록 내 손만 더 망가진다.
import * as THREE from 'three';
import { ANAT, makeGhostMaterial } from './arm.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const easeOut = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const TAU = Math.PI * 2;
const V = () => new THREE.Vector3();

// ------------------------------------------------------------------ 기술 정의
// kind: 모아친 주먹(살)에 남는 상처 성격 — 벽 성격 위에 덧붙는다
export const SKILLS = [
  { id: 'shock', wall: 'cement', name: '충격파' },
  { id: 'sonic', wall: 'gravel', name: '음속 돌파', kind: { abr: 0.75 } },
  { id: 'barrage', wall: 'glass', name: '잔상 연타' },
  { id: 'twist', wall: 'nails', name: '회오리', kind: { fractBoost: 0.07 } },
  { id: 'frost', wall: 'freezer', name: '냉기', kind: { frost: 0.78 } },
  { id: 'fire', wall: 'hotplate', name: '화염', kind: { burn: 1.0 } },
  { id: 'gravity', wall: 'slime', name: '중력', kind: { fractBoost: 0.06 } },
  { id: 'bolt', wall: 'electric', name: '번개', kind: { elec: 1.0 } },
  { id: 'final', wall: 'spikes', name: '대폭발', kind: { burn: 0.85, elec: 0.75, abr: 0.5, fractBoost: 0.06 } },
];
export const SKILL_OF = Object.fromEntries(SKILLS.map((s) => [s.wall, s]));

// 벽 성격 + 기술 성격(모은 만큼)
export function skillKind(wallKind, skill, k) {
  const out = Object.assign({}, wallKind || {});
  if (!skill || !skill.kind || k <= 0.02) return out;
  for (const [key, v] of Object.entries(skill.kind)) {
    if (key === 'fractBoost') out.fractBoost = (out.fractBoost || 0) + v * k;
    else out[key] = Math.max(out[key] || 0, v * k);
  }
  return out;
}

// ------------------------------------------------------------------ 공용 GLSL
const NOISE = /* glsl */`
float sk_h(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float sk_n(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(sk_h(i),sk_h(i+vec3(1,0,0)),f.x), mix(sk_h(i+vec3(0,1,0)),sk_h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(sk_h(i+vec3(0,0,1)),sk_h(i+vec3(1,0,1)),f.x), mix(sk_h(i+vec3(0,1,1)),sk_h(i+vec3(1,1,1)),f.x),f.y), f.z); }
float sk_fbm(vec3 p){ return sk_n(p)*0.5 + sk_n(p*2.07+1.7)*0.3 + sk_n(p*4.13+3.9)*0.2; }
`;
// 효과 색 톤: 그냥 ACES로 누르면 밝은 불·번개가 크림색으로 바래 보임 →
// 가장 센 채널 기준으로 밝기만 눌러 색 비율을 지킨 값을 주로 섞음(밝아도 주황은 주황, 파랑은 파랑)
const TONE = /* glsl */`
  #if defined( TONE_MAPPING )
  {
    vec3 c_ = max(gl_FragColor.rgb, vec3(0.0));
    float m_ = max(max(c_.r, c_.g), c_.b);
    vec3 hp_ = m_ > 1e-5 ? c_ * (dot(toneMapping(vec3(m_)), vec3(1.0 / 3.0)) / m_) : c_;
    gl_FragColor.rgb = mix(toneMapping(c_), hp_, 0.8);
  }
  #endif
  #include <colorspace_fragment>
`;

// ------------------------------------------------------------------ 입자 무늬(4×2)
// 0 부드러운 빛 · 1 불티 · 2 불길 · 3 연기 · 4 반짝임 · 5 고리 · 6 빗살 · 7 얼음 조각
function makeAtlas() {
  const S = 128, c = document.createElement('canvas');
  c.width = S * 4; c.height = S * 2;
  const x = c.getContext('2d');
  const R = (k) => { const v = Math.sin(k * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const cell = (i, fn) => { x.save(); x.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2); fn(); x.restore(); };
  const radial = (r, stops, cx = 0, cy = 0) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill();
  };
  cell(0, () => radial(62, [[0, 1], [0.2, 0.7], [0.5, 0.22], [1, 0]]));
  cell(1, () => radial(44, [[0, 1], [0.3, 0.95], [0.55, 0.32], [1, 0]]));
  cell(2, () => {
    // 아래는 둥글고 위로 갈수록 가늘게 흔들리는 불길
    for (let k = 0; k < 16; k++) {
      const t = k / 15, y = 36 - t * 92, rr = (1 - t) * 28 + 6, xx = Math.sin(t * 5.2 + 1.1) * 8 * t;
      const g = x.createRadialGradient(xx, y, 0, xx, y, rr);
      const a = 0.34 * (1 - t * 0.5);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(xx, y, rr, 0, TAU); x.fill();
    }
  });
  cell(3, () => {
    for (let k = 0; k < 18; k++) {
      const a = R(k) * TAU, d = R(k + 20) * 26, r = 18 + R(k + 40) * 24;
      const px = Math.cos(a) * d, py = Math.sin(a) * d * 0.85, sh = 205 + Math.floor(R(k + 60) * 50);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${sh},${sh},${sh},0.3)`); g.addColorStop(1, `rgba(${sh},${sh},${sh},0)`);
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    }
  });
  cell(4, () => {
    radial(20, [[0, 1], [0.45, 0.55], [1, 0]]);
    for (const ang of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const L = ang % (Math.PI / 2) ? 34 : 60, W = ang % (Math.PI / 2) ? 2 : 3.4;
      x.save(); x.rotate(ang);
      const g = x.createLinearGradient(-L, 0, L, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, L, W, 0, 0, TAU); x.fill();
      x.restore();
    }
  });
  cell(5, () => radial(62, [[0, 0], [0.66, 0], [0.8, 1], [0.88, 0.55], [1, 0]]));
  cell(6, () => {
    // 빗살: 오른쪽(머리)이 굵고 밝고 왼쪽(꼬리)으로 가늘게 사라짐
    const g = x.createLinearGradient(-62, 0, 62, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.75)'); g.addColorStop(0.9, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(-62, 0); x.quadraticCurveTo(20, -13, 58, -7); x.quadraticCurveTo(64, 0, 58, 7); x.quadraticCurveTo(20, 13, -62, 0); x.fill();
  });
  cell(7, () => {
    const g = x.createLinearGradient(-30, -40, 30, 40);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0.9)');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -52); x.lineTo(26, -6); x.lineTo(0, 52); x.lineTo(-26, 6); x.closePath(); x.fill();
    radial(14, [[0, 1], [1, 0]], 6, -14);
  });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 2;
  return t;
}

// ------------------------------------------------------------------ 입자 (화면을 향한 판, 속도 방향으로 늘어나기도 함)
class Sprites {
  constructor(max, atlas, { blending = THREE.NormalBlending, order = 5 } = {}) {
    this.max = max; this.p = [];
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aCol = mk(4); this.aSz = mk(4); this.aVel = mk(3);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iSz', this.aSz); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: atlas } },
      transparent: true, depthWrite: false, depthTest: true, blending,
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iSz; attribute vec3 iVel;
        varying vec2 vUv; varying vec4 vCol;
        void main(){
          vec4 head = modelViewMatrix * vec4(iPos, 1.0);
          vec4 c4 = head; vec2 sz = iSz.xy; vec2 ax;
          if (dot(iVel, iVel) > 1e-12) {
            vec4 tail = modelViewMatrix * vec4(iPos - iVel, 1.0);
            vec2 d = head.xy - tail.xy; float L = length(d);
            ax = L > 1e-7 ? d / L : vec2(1.0, 0.0);
            c4 = (head + tail) * 0.5; sz.x += L;
          } else { ax = vec2(cos(iSz.z), sin(iSz.z)); }
          vec2 ay = vec2(-ax.y, ax.x);
          c4.xy += ax * position.x * sz.x + ay * position.y * sz.y;
          gl_Position = projectionMatrix * c4;
          float col = mod(iSz.w, 4.0), row = floor(iSz.w / 4.0 + 0.01);
          vUv = vec2((col + uv.x) * 0.25, (1.0 - row + uv.y) * 0.5);
          vCol = iCol;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; varying vec2 vUv; varying vec4 vCol;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * vCol.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol.rgb * t.rgb, a);
          ${TONE}
        }`,
    });
    this.obj = new THREE.Mesh(g, this.mat);
    this.obj.frustumCulled = false; this.obj.renderOrder = order;
  }
  // o: x,y,z, vx,vy,vz, life, s0,s1 크기(m), sy 세로 비, c0,c1 [r,g,b], a 불투명, fin 나타나는 비율, fout 사라지는 지수,
  //    tile, rot, spin, drag(초당 남는 비율), g 중력, st 늘이기(초), att 끌어당길 점, attK, swirl, eat
  emit(o) {
    if (this.p.length >= this.max) return null;
    const q = Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 0.5, s0: 0.01, s1: 0.01, sy: 1, c0: [1, 1, 1], c1: null, a: 1, fin: 0.08, fout: 1, tile: 0, rot: 0, spin: 0, drag: 1, g: 0, st: 0, att: null, attK: 0, swirl: 0, eat: 0, ease: false }, o);
    if (!q.c1) q.c1 = q.c0;
    this.p.push(q);
    return q;
  }
  clear() { this.p.length = 0; this.geo.instanceCount = 0; }
  update(dt) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      if (q.att) {
        const dx = q.att.x - q.x, dy = q.att.y - q.y, dz = q.att.z - q.z;
        const d = Math.hypot(dx, dy, dz) + 1e-5;
        if (d < q.eat) continue;
        const acc = q.attK / Math.max(d, 0.03);
        q.vx += (dx / d) * acc * dt; q.vy += (dy / d) * acc * dt; q.vz += (dz / d) * acc * dt;
        if (q.swirl) { q.vx += (-dy / d) * q.swirl * dt; q.vy += (dx / d) * q.swirl * dt; }
      }
      if (q.drag !== 1) { const dr = Math.pow(q.drag, dt); q.vx *= dr; q.vy *= dr; q.vz *= dr; }
      q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rot += q.spin * dt;
      P[n++] = q;
    }
    P.length = n;
    const pos = this.aPos.array, col = this.aCol.array, sz = this.aSz.array, vel = this.aVel.array;
    for (let i = 0; i < n; i++) {
      const q = P[i], u = q.t / q.life, e = q.ease ? easeOut(u) : u;
      const s = q.s0 + (q.s1 - q.s0) * e;
      const a = q.a * Math.min(1, u / q.fin) * Math.pow(1 - u, q.fout);
      pos[i * 3] = q.x; pos[i * 3 + 1] = q.y; pos[i * 3 + 2] = q.z;
      col[i * 4] = q.c0[0] + (q.c1[0] - q.c0[0]) * u;
      col[i * 4 + 1] = q.c0[1] + (q.c1[1] - q.c0[1]) * u;
      col[i * 4 + 2] = q.c0[2] + (q.c1[2] - q.c0[2]) * u;
      col[i * 4 + 3] = a;
      sz[i * 4] = s; sz[i * 4 + 1] = s * q.sy; sz[i * 4 + 2] = q.rot; sz[i * 4 + 3] = q.tile;
      vel[i * 3] = q.vx * q.st; vel[i * 3 + 1] = q.vy * q.st; vel[i * 3 + 2] = q.vz * q.st;
    }
    this.geo.instanceCount = n;
    if (n) { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSz.needsUpdate = true; this.aVel.needsUpdate = true; }
  }
}

// ------------------------------------------------------------------ 충격파 고리 (밝은 앞머리 + 뒤따르는 어두운 압력띠)
class Rings {
  constructor(scene, n = 10) {
    this.geo = new THREE.RingGeometry(0.5, 1, 128, 1);
    this.list = Array.from({ length: n }, () => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        uniforms: { uAlpha: { value: 0 }, uSeed: { value: 0 }, uSpiral: { value: 0 }, uT: { value: 0 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uDark: { value: 0.5 } },
        vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          varying vec2 vP; uniform float uAlpha, uSeed, uSpiral, uT, uDark; uniform vec3 uColA, uColB;
          void main(){
            float r = length(vP), a = atan(vP.y, vP.x);
            float rr = r + sin(a * 7.0 + uSeed) * 0.018 + sin(a * 13.0 - uSeed * 1.7) * 0.01 + uSpiral * 0.07 * sin(a * 3.0 + r * 16.0 - uT * 26.0);
            float x = (rr - 0.5) / 0.5;
            float bright = smoothstep(0.55, 0.84, x) * (1.0 - smoothstep(0.86, 1.0, x));
            float dark = smoothstep(0.0, 0.3, x) * (1.0 - smoothstep(0.3, 0.68, x)) * uDark;
            float al = uAlpha * clamp(bright + dark, 0.0, 1.0);
            if (al < 0.004) discard;
            vec3 col = mix(uColB, uColA, bright / (bright + dark + 1e-4));
            gl_FragColor = vec4(col, al);
            ${TONE}
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 6;
      scene.add(mesh);
      return { mesh, mat, on: false, t: 0, delay: 0, life: 0.2, r0: 0.02, r1: 0.2, a: 1, spin: 0, camFace: false };
    });
  }
  // o: p, r0, r1, life, a, colA, colB, dark, spiral, spin, delay, cam(카메라를 향함)
  spawn(o) {
    const R = this.list.find((x) => !x.on) || this.list.reduce((m, x) => (x.t / x.life > m.t / m.life ? x : m));
    R.on = true; R.t = 0; R.delay = o.delay || 0; R.life = o.life || 0.2; R.r0 = o.r0 ?? 0.02; R.r1 = o.r1 ?? 0.2; R.a = o.a ?? 1; R.spin = o.spin || 0; R.camFace = !!o.cam; R.fixed = !!o.fixed;
    R.mesh.position.copy(o.p);
    R.mesh.rotation.set(0, 0, Math.random() * TAU);
    R.mat.uniforms.uSeed.value = Math.random() * 100;
    R.mat.uniforms.uSpiral.value = o.spiral || 0;
    R.mat.uniforms.uColA.value.setRGB(...(o.colA || [1.6, 1.5, 1.35]));
    R.mat.uniforms.uColB.value.setRGB(...(o.colB || [0.3, 0.27, 0.24]));
    R.mat.uniforms.uDark.value = o.dark ?? 0.5;
    R.mesh.scale.setScalar(R.r0);
    R.mesh.visible = false;
    return R;
  }
  update(dt, camera) {
    for (const R of this.list) {
      if (!R.on) continue;
      if (R.delay > 0) { R.delay -= dt; continue; }
      R.t += dt;
      if (R.t >= R.life) { R.on = false; R.mesh.visible = false; continue; }
      const u = R.t / R.life, e = easeOut(u);
      R.mesh.visible = true;
      R.mesh.scale.setScalar(R.fixed ? R.r0 + (R.r1 - R.r0) * (0.5 + 0.5 * Math.sin(u * TAU * 2)) : R.r0 + (R.r1 - R.r0) * e);
      if (R.camFace) R.mesh.quaternion.copy(camera.quaternion);
      R.mesh.rotateZ(R.spin * dt);
      R.mat.uniforms.uT.value += dt;
      R.mat.uniforms.uAlpha.value = R.a * Math.min(1, u / 0.08) * Math.pow(1 - u, 1.4);
    }
  }
  clear() { for (const R of this.list) { R.on = false; R.mesh.visible = false; } }
}

// ------------------------------------------------------------------ 번개 (지그재그 + 가지, 바깥 빛띠는 진한 색, 속은 하얗게)
class Bolts {
  constructor(scene, maxSeg = 1600) {
    this.maxSeg = maxSeg; this.list = [];
    // 띠의 가로 위치(-1~1) — 빛띠는 가운데가 진하고 바깥으로 갈수록 흐려짐(납작한 띠로 안 보이게)
    const sideArr = new Float32Array(maxSeg * 6);
    for (let i = 0; i < maxSeg; i++) sideArr.set([-1, -1, 1, -1, 1, 1], i * 6);
    const mk = (blending, order, soft) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(maxSeg * 18), col = new Float32Array(maxSeg * 24);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('side', new THREE.BufferAttribute(sideArr, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true, blending, side: THREE.DoubleSide,
        vertexShader: /* glsl */`attribute vec4 color; attribute float side; varying vec4 vC; varying float vS; void main(){ vC = color; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`varying vec4 vC; varying float vS; void main(){
          float e = abs(vS);
          float f = ${soft ? 'pow(max(1.0 - e, 0.0), 1.25)' : 'smoothstep(1.0, 0.55, e)'};
          float a = vC.a * f; if (a < 0.003) discard; gl_FragColor = vec4(vC.rgb, a); ${TONE} }`,
      }));
      m.frustumCulled = false; m.renderOrder = order;
      scene.add(m);
      return m;
    };
    this.glow = mk(THREE.NormalBlending, 7, true);
    this.core = mk(THREE.AdditiveBlending, 9, false);
  }
  // 두 점 사이 지그재그 길 + 가지
  path(a, b, rough = 0.22, branch = 0.35, depth = 0) {
    const pts = [a.clone(), b.clone()];
    const L = a.distanceTo(b);
    let disp = L * rough;
    const dir = V().subVectors(b, a).normalize();
    const side = V().crossVectors(dir, new THREE.Vector3(0, 0, 1));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();
    const side2 = V().crossVectors(dir, side).normalize();
    for (let it = 0; it < 5; it++) {
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = V().lerpVectors(pts[i], pts[i + 1], 0.5);
        m.addScaledVector(side, (Math.random() - 0.5) * 2 * disp).addScaledVector(side2, (Math.random() - 0.5) * disp * 0.5);
        next.push(m, pts[i + 1]);
      }
      pts.length = 0; pts.push(...next);
      disp *= 0.52;
    }
    const out = [pts];
    if (depth < 2) {
      const nb = Math.random() < branch ? 1 + Math.floor(Math.random() * (depth ? 1 : 3)) : 0;
      for (let k = 0; k < nb; k++) {
        const i = 3 + Math.floor(Math.random() * (pts.length - 6));
        const s = pts[i];
        const bl = L * rnd(0.25, 0.5) * (depth ? 0.6 : 1);
        const bd = V().copy(dir).addScaledVector(side, rnd(-1.2, 1.2)).normalize();
        const e = s.clone().addScaledVector(bd, bl);
        const sub = this.path(s, e, rough * 1.1, branch * 0.5, depth + 1);
        for (const sp of sub) { sp.branch = (depth + 1); out.push(sp); }
      }
    }
    return out;
  }
  // o: width, life, flick(재생성 간격), core[r,g,b], glow[r,g,b], ga(빛띠 불투명), delay
  add(a, b, o = {}) {
    const B = Object.assign({ a: a.clone(), b: b.clone(), t: 0, life: 0.1, width: 0.0016, flick: 0.035, ft: 0, rough: 0.22, branch: 0.35, core: [1.7, 1.9, 2.6], glow: [0.05, 0.17, 0.85], ga: 0.9, delay: 0, follow: null }, o);
    B.paths = this.path(B.a, B.b, B.rough, B.branch);
    this.list.push(B);
    if (this.list.length > 40) this.list.shift();
    return B;
  }
  clear() { this.list.length = 0; this.glow.geometry.setDrawRange(0, 0); this.core.geometry.setDrawRange(0, 0); }
  update(dt, camera) {
    for (const B of this.list) {
      if (B.delay > 0) { B.delay -= dt; continue; }
      B.t += dt; B.ft += dt;
      if (B.follow) { const r = B.follow(); if (r) { B.a.copy(r[0]); B.b.copy(r[1]); } }
      if (B.ft >= B.flick) { B.ft = 0; B.paths = this.path(B.a, B.b, B.rough, B.branch); }
      B.fl = Math.random() < 0.25 ? 0.45 : 1;
    }
    this.list = this.list.filter((B) => B.t < B.life);
    const cam = camera.getWorldPosition(V());
    const fill = (mesh, wMul, useCore) => {
      const pos = mesh.geometry.attributes.position.array, col = mesh.geometry.attributes.color.array;
      let s = 0;
      const d = V(), vd = V(), pp = V();
      for (const B of this.list) {
        if (B.delay > 0) continue;
        const u = B.t / B.life;
        const I = Math.pow(1 - u, 0.7) * (B.fl ?? 1);
        const c = useCore ? B.core : B.glow, al = useCore ? I : I * B.ga;
        for (const P of B.paths) {
          const bw = P.branch ? (P.branch === 1 ? 0.55 : 0.35) : 1;
          for (let i = 0; i < P.length - 1 && s < this.maxSeg; i++) {
            const p0 = P[i], p1 = P[i + 1];
            d.subVectors(p1, p0);
            vd.subVectors(cam, p0).normalize();
            pp.crossVectors(d, vd);
            if (pp.lengthSq() < 1e-12) continue;
            const taper = P.branch ? (1 - i / P.length) : 1;
            pp.normalize().multiplyScalar(B.width * wMul * bw * (0.35 + 0.65 * taper));
            const o = s * 18;
            pos[o] = p0.x - pp.x; pos[o + 1] = p0.y - pp.y; pos[o + 2] = p0.z - pp.z;
            pos[o + 3] = p1.x - pp.x; pos[o + 4] = p1.y - pp.y; pos[o + 5] = p1.z - pp.z;
            pos[o + 6] = p1.x + pp.x; pos[o + 7] = p1.y + pp.y; pos[o + 8] = p1.z + pp.z;
            pos[o + 9] = p0.x - pp.x; pos[o + 10] = p0.y - pp.y; pos[o + 11] = p0.z - pp.z;
            pos[o + 12] = p1.x + pp.x; pos[o + 13] = p1.y + pp.y; pos[o + 14] = p1.z + pp.z;
            pos[o + 15] = p0.x + pp.x; pos[o + 16] = p0.y + pp.y; pos[o + 17] = p0.z + pp.z;
            const ca = al * (0.5 + 0.5 * taper);
            for (let q = 0; q < 6; q++) { const k = s * 24 + q * 4; col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2]; col[k + 3] = ca; }
            s++;
          }
        }
      }
      mesh.geometry.setDrawRange(0, s * 6);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.color.needsUpdate = true;
    };
    fill(this.glow, 4.2, false);
    fill(this.core, 1, true);
  }
}

// ------------------------------------------------------------------ 음속 원뿔(팔을 감싸는 수증기막)
class VaporCone {
  constructor(scene) {
    const g = new THREE.ConeGeometry(1, 1, 48, 6, true);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      uniforms: { uAlpha: { value: 0 }, uT: { value: 0 } },
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec2 vU;
        void main(){ vU = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec2 vU; uniform float uAlpha, uT;
        void main(){
          float fr = 1.0 - abs(dot(vN, vV));
          float edge = pow(fr, 1.4);
          float st = 0.55 + 0.45 * sin(vU.x * 6.2831 * 11.0 + vU.y * 4.0 - uT * 30.0) * sin(vU.x * 6.2831 * 5.0 + uT * 17.0);
          float along = smoothstep(0.0, 0.35, vU.y) * (1.0 - smoothstep(0.9, 1.0, vU.y));
          float a = uAlpha * (0.18 + 0.82 * edge) * st * along;
          if (a < 0.004) discard;
          vec3 c = mix(vec3(0.46, 0.52, 0.62), vec3(1.35, 1.4, 1.5), edge * st);
          gl_FragColor = vec4(c, a);
          ${TONE}
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.visible = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.state = null;
  }
  // 앞끝(apex)이 주먹 앞, 축은 팔 뒤쪽으로
  place(apex, dir, R, L) {
    const m = this.mesh;
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.position.copy(apex).addScaledVector(dir, -L / 2);
    m.scale.set(R, L, R);
  }
  update(dt) { this.mat.uniforms.uT.value += dt; }
}

// ------------------------------------------------------------------ 불덩이
class Fireballs {
  constructor(scene, n = 3) {
    this.geo = new THREE.SphereGeometry(1, 48, 32);
    this.list = Array.from({ length: n }, () => {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: true,
        uniforms: { uT: { value: 0 }, uAge: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uAmp: { value: 0.22 }, uHot: { value: 0 } },
        vertexShader: /* glsl */`${NOISE}
          uniform float uT, uAmp, uSeed; varying vec3 vN; varying vec3 vV; varying float vNz; varying vec3 vP;
          void main(){
            float n = sk_fbm(position * 2.3 + vec3(uSeed, uSeed * 0.7, -uT * 1.6));
            vec3 q = position * (1.0 + uAmp * (n - 0.45) * 2.2);
            vNz = n; vP = position;
            vec4 mv = modelViewMatrix * vec4(q, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`${NOISE}
          uniform float uT, uAge, uAlpha, uSeed, uHot; varying vec3 vN; varying vec3 vV; varying float vNz; varying vec3 vP;
          void main(){
            float fr = clamp(dot(vN, vV), 0.0, 1.0);
            float n2 = sk_fbm(vP * 4.6 + vec3(0.0, -uT * 2.6, uSeed));
            float n3 = sk_n(vP * 13.0 + vec3(uSeed, uT * 3.0, 0.0));
            float heat = fr * 0.5 + vNz * 0.5 + n2 * 0.45 + (n3 - 0.5) * 0.25 - uAge * 1.2 + uHot;
            float dis = n2 * 0.9 + fr * 0.25 - (uAge * 1.25 - 0.18);
            if (dis < 0.0) discard;
            vec3 c = vec3(0.07, 0.05, 0.045);
            c = mix(c, vec3(0.32, 0.03, 0.01), smoothstep(0.1, 0.3, heat));
            c = mix(c, vec3(1.25, 0.22, 0.02), smoothstep(0.3, 0.52, heat));
            c = mix(c, vec3(1.9, 0.75, 0.08), smoothstep(0.52, 0.76, heat));
            c = mix(c, vec3(2.4, 1.6, 0.6), smoothstep(0.84, 1.05, heat));
            float a = uAlpha * smoothstep(0.0, 0.14, dis) * (0.75 + 0.25 * fr);
            gl_FragColor = vec4(c, a);
            ${TONE}
          }`,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 5;
      scene.add(mesh);
      return { mesh, mat, on: false, t: 0, life: 1, r0: 0.01, r1: 0.1, grow: 0.25, delay: 0, flat: 0.35 };
    });
  }
  spawn(o) {
    const F = this.list.find((x) => !x.on) || this.list[0];
    F.on = true; F.t = 0; F.life = o.life || 1; F.r0 = o.r0 || 0.01; F.r1 = o.r1 || 0.12; F.grow = o.grow || 0.25; F.delay = o.delay || 0; F.flat = o.flat ?? 0.35;
    F.mesh.position.copy(o.p); F.mesh.scale.setScalar(F.r0);
    F.mat.uniforms.uSeed.value = Math.random() * 50; F.mat.uniforms.uHot.value = o.hot || 0; F.mat.uniforms.uAlpha.value = o.a ?? 1;
    F.mesh.visible = false;
    return F;
  }
  update(dt) {
    for (const F of this.list) {
      if (!F.on) continue;
      if (F.delay > 0) { F.delay -= dt; continue; }
      F.t += dt;
      if (F.t >= F.life) { F.on = false; F.mesh.visible = false; continue; }
      F.mesh.visible = true;
      const u = F.t / F.life;
      const g = easeOut(F.t / F.grow);
      const r = F.r0 + (F.r1 - F.r0) * g + F.r1 * 0.25 * u;
      F.mesh.scale.set(r, r, r * F.flat);
      F.mesh.position.y += dt * 0.05 * u;
      F.mat.uniforms.uT.value += dt;
      F.mat.uniforms.uAge.value = u;
    }
  }
  clear() { for (const F of this.list) { F.on = false; F.mesh.visible = false; } }
}

// ------------------------------------------------------------------ 중력: 검은 구 + 빨려 드는 원반
class DarkCore {
  constructor(scene) {
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: { uAlpha: { value: 1 } },
      vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying vec3 vN; varying vec3 vV; uniform float uAlpha;
        void main(){ float fr = 1.0 - clamp(dot(vN, vV), 0.0, 1.0);
          vec3 c = mix(vec3(0.012, 0.0, 0.026), vec3(1.5, 0.62, 2.3), pow(fr, 2.6));
          gl_FragColor = vec4(c, uAlpha); ${TONE} }`,
    }));
    this.disk = new THREE.Mesh(new THREE.RingGeometry(1.12, 2.9, 128, 3), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 1 }, uT: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`varying vec2 vP; uniform float uAlpha, uT;
        void main(){ float r = length(vP), a = atan(vP.y, vP.x);
          float sp = 0.5 + 0.5 * sin(a * 3.0 + log(r) * 9.0 - uT * 16.0);
          float band = pow(sp, 3.0);
          float fall = smoothstep(2.9, 1.4, r) * smoothstep(1.12, 1.3, r);
          vec3 c = mix(vec3(0.7, 0.22, 1.5), vec3(2.2, 1.6, 2.6), band * smoothstep(2.3, 1.2, r));
          float al = uAlpha * fall * (0.25 + 0.75 * band);
          if (al < 0.004) discard;
          gl_FragColor = vec4(c, al); ${TONE} }`,
    }));
    for (const m of [this.sphere, this.disk]) { m.visible = false; m.frustumCulled = false; scene.add(m); }
    this.sphere.renderOrder = 6; this.disk.renderOrder = 8;
    this.on = false; this.t = 0;
  }
  start(p, R = 0.07) { this.on = true; this.t = 0; this.R = R; this.p = p.clone(); this.sphere.position.copy(p); this.disk.position.copy(p); }
  // 0~0.14 커짐, 0.14~0.38 유지(빨아들임), 0.38~0.44 쪼그라듦
  update(dt) {
    if (!this.on) return;
    this.t += dt;
    const t = this.t;
    let r = 0;
    const R = this.R || 0.07;
    if (t < 0.14) r = easeOut(t / 0.14) * R;
    else if (t < 0.38) r = R + Math.sin((t - 0.14) * 40) * R * 0.05;
    else if (t < 0.44) r = R * (1 - smooth((t - 0.38) / 0.06));
    else { this.on = false; }
    const vis = this.on && r > 0.0005;
    this.sphere.visible = this.disk.visible = vis;
    if (!vis) return;
    this.sphere.scale.setScalar(r);
    this.disk.scale.setScalar(r * (1.0 + 0.15 * Math.sin(t * 30)));
    this.disk.rotation.z += dt * 9;
    this.disk.material.uniforms.uT.value += dt;
    this.disk.material.uniforms.uAlpha.value = t < 0.38 ? 1 : 1 - (t - 0.38) / 0.06;
  }
  clear() { this.on = false; this.sphere.visible = this.disk.visible = false; }
}

// ------------------------------------------------------------------ 얼음 결정
function crystalGeometry() {
  // 위는 길고 뾰족, 아래는 짧은 육각 결정
  const top = [0, 1, 0], bot = [0, -0.55, 0], ring = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ring.push([Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3]); }
  const pos = [];
  for (let i = 0; i < 6; i++) {
    const a = ring[i], b = ring[(i + 1) % 6];
    pos.push(...top, ...b, ...a);
    pos.push(...bot, ...a, ...b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
class Crystals {
  constructor(scene, max = 220) {
    this.max = max;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x5fb6ff, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.93, emissive: 0x0f4f9a, emissiveIntensity: 0.7, envMapIntensity: 2.2, flatShading: true });
    this.im = new THREE.InstancedMesh(crystalGeometry(), this.mat, max);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.count = 0; this.im.frustumCulled = false; this.im.renderOrder = 4; this.im.castShadow = false;
    scene.add(this.im);
    this.list = [];
    this.d = new THREE.Object3D();
  }
  // o: p, v, s(크기), sy(길이 비), q(방향), w(회전 속도 벡터), life, g, mode('fly'|'grow'), hold, grow
  add(o) {
    if (this.list.length >= this.max) return null;
    const c = Object.assign({ p: V(), v: V(), s: 0.01, sy: 1, q: new THREE.Quaternion(), w: V(), life: 1, t: 0, g: -6, drag: 0.6, mode: 'fly', grow: 0.06, delay: 0 }, o);
    this.list.push(c);
    return c;
  }
  clear() { this.list.length = 0; this.im.count = 0; }
  update(dt) {
    const dq = new THREE.Quaternion(), ax = V();
    let n = 0;
    for (const c of this.list) {
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.t += dt;
      if (c.t >= c.life) continue;
      if (c.mode === 'fly') {
        c.v.y += c.g * dt; c.v.multiplyScalar(Math.pow(c.drag, dt));
        c.p.addScaledVector(c.v, dt);
        const wl = c.w.length();
        if (wl > 0) { ax.copy(c.w).divideScalar(wl); dq.setFromAxisAngle(ax, wl * dt); c.q.premultiply(dq); }
      }
      const u = c.t / c.life;
      const grow = c.mode === 'grow' ? easeOut(c.t / c.grow) : 1;
      const fade = c.mode === 'fly' ? 1 - Math.pow(u, 4) : 1;
      const s = c.s * grow * fade;
      if (s < 1e-5) continue;
      this.d.position.copy(c.p); this.d.quaternion.copy(c.q); this.d.scale.set(s, s * c.sy, s);
      this.d.updateMatrix();
      this.im.setMatrixAt(n++, this.d.matrix);
    }
    this.list = this.list.filter((c) => c.t < c.life || c.delay > 0);
    this.im.count = n;
    this.im.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ 잔상(지나간 자리마다 팔이 반투명하게 남음)
// 팔마다 따로 그려야 반대쪽 팔에 잔상이 안 덮임: [살갗, 소매·철권]
const GHOST_LAYERS = { L: [3, 4], R: [5, 6] };
class Ghosts {
  constructor(arms, lights) {
    this.arms = arms;
    this.mats = {};
    this.smat = new THREE.MeshStandardMaterial({ color: 0xc8d8ff, roughness: 0.45, metalness: 0.3, transparent: true, opacity: 0.3, emissive: 0x3a5390, emissiveIntensity: 0.6, depthWrite: false });
    for (const s of ['L', 'R']) {
      const a = arms[s], [l0, l1] = GHOST_LAYERS[s];
      this.mats[s] = makeGhostMaterial(a.U);
      for (const m of [a.skin, a.upper]) m.layers.enable(l0);
    }
    for (const l of lights) for (const s of ['L', 'R']) for (const ly of GHOST_LAYERS[s]) l.layers.enable(ly);
    this.hist = { L: [], R: [] };
    this.on = { L: 0, R: 0 };
    this.mode = { L: 'trail', R: 'trail' };
  }
  record(side) {
    const r = this.arms[side].root, H = this.hist[side];
    H.push({ p: r.position.clone(), q: r.quaternion.clone() });
    if (H.length > 14) H.shift();
  }
  render(renderer, scene, camera) {
    if (this.on.L <= 0.01 && this.on.R <= 0.01) return;
    const bg = scene.background, sm = renderer.shadowMap.autoUpdate, mask = camera.layers.mask;
    scene.background = null; renderer.shadowMap.autoUpdate = false;
    const p0 = V(), q0 = new THREE.Quaternion();
    for (const s of ['L', 'R']) {
      const k = this.on[s];
      if (k <= 0.01) continue;
      const a = this.arms[s], H = this.hist[s], [l0, l1] = GHOST_LAYERS[s];
      if (a.scrapObj) a.scrapObj.group.traverse((o) => { if (o.isMesh && o !== a.scrapObj.glow) o.layers.enable(l1); });
      p0.copy(a.root.position); q0.copy(a.root.quaternion);
      const picks = [];
      if (this.mode[s] === 'shimmer') {
        // 모으는 동안: 주먹이 떨리며 옆으로 겹쳐 보임(자기 자리는 피함)
        for (let i = 0; i < 2; i++) { const d = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), 0).normalize().multiplyScalar(rnd(0.008, 0.014)); picks.push({ p: p0.clone().add(d), q: q0, a: 0.4 }); }
      } else {
        // 지나간 자리들. 지금 자리와 거의 겹치는 건 건너뜀(팔이 하얗게 뜨지 않게)
        for (const [back, al] of [[2, 0.7], [4, 0.55], [6, 0.42], [8, 0.3], [11, 0.2]]) {
          const h = H[H.length - 1 - back];
          if (h && h.p.distanceTo(p0) > 0.012) picks.push({ p: h.p, q: h.q, a: al });
        }
      }
      for (const pk of picks) {
        a.root.position.copy(pk.p); a.root.quaternion.copy(pk.q); a.root.updateMatrixWorld(true);
        scene.overrideMaterial = this.mats[s]; this.mats[s].opacity = pk.a * k;
        camera.layers.set(l0); renderer.render(scene, camera);
        if (a.scrapObj && a.scrap && a.scrap.lumpHP > 0) { scene.overrideMaterial = this.smat; this.smat.opacity = pk.a * k * 0.8; camera.layers.set(l1); renderer.render(scene, camera); }
      }
      a.root.position.copy(p0); a.root.quaternion.copy(q0); a.root.updateMatrixWorld(true);
    }
    scene.overrideMaterial = null; camera.layers.mask = mask; scene.background = bg; renderer.shadowMap.autoUpdate = sm;
  }
}

// ------------------------------------------------------------------ 화면 덮개(번쩍임·가장자리 어둠)
class Overlay {
  constructor() {
    const mk = (z) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${z};opacity:0;will-change:opacity`; document.body.appendChild(d); return d; };
    this.flashEl = mk(24); this.vigEl = mk(23);
    this.vigEl.style.background = 'radial-gradient(ellipse at 50% 58%, rgba(0,0,0,0) 38%, rgba(48,20,0,.34) 72%, rgba(20,6,0,.62) 100%)';
    this.flash = { a: 0, hold: 0, tau: 0.12 };
    this.vig = 0;
  }
  bang(color, a = 1, hold = 0, tau = 0.12) {
    this.flashEl.style.background = color;
    this.flash.a = Math.max(this.flash.a, a); this.flash.hold = Math.max(this.flash.hold, hold); this.flash.tau = tau;
  }
  update(rdt) {
    const f = this.flash;
    if (f.hold > 0) f.hold -= rdt; else f.a *= Math.exp(-rdt / f.tau);
    if (f.a < 0.004) f.a = 0;
    this.flashEl.style.opacity = f.a.toFixed(3);
    this.vigEl.style.opacity = this.vig.toFixed(3);
  }
  clear() { this.flash.a = 0; this.flash.hold = 0; this.vig = 0; this.update(0); }
}

// ------------------------------------------------------------------ 연출 감독
export class SkillFX {
  constructor({ scene, camera, renderer, fx, sfx, arms, fists, lightPool, lights, getWall }) {
    Object.assign(this, { scene, camera, renderer, fx, sfx, arms, fists, lightPool, getWall });
    const atlas = makeAtlas();
    this.norm = new Sprites(900, atlas, { blending: THREE.NormalBlending, order: 5 });
    this.add = new Sprites(900, atlas, { blending: THREE.AdditiveBlending, order: 8 });
    scene.add(this.norm.obj, this.add.obj);
    this.rings = new Rings(scene, 12);
    this.bolts = new Bolts(scene);
    this.cone = new VaporCone(scene);
    this.balls = new Fireballs(scene, 3);
    this.core = new DarkCore(scene);
    this.crys = new Crystals(scene);
    this.ghosts = new Ghosts(arms, lights);
    this.over = new Overlay();
    this.skill = SKILLS[0];
    this.S = {};
    for (const s of ['L', 'R']) this.S[s] = this._side();
    this.timeline = [];
    this.slow = { scale: 1, hold: 0, ease: 0 };
    this._timeScale = 1; this.zoom = 0; this.zoomT = 0;
    this.rt = 0;
    this.lightUse = new Map();
    this.coneOwner = null;
  }
  _side() {
    return { k: 0, holding: false, charging: false, full: false, launchK: 0, striking: false, acc: {}, att: { fr: 0, fi: 0, el: 0, gv: 0, gold: 0, rim: 0, pulse: 0, heat: 0 }, after: { fr: 0, fi: 0, el: 0, gv: 0, gold: 0, heat: 0 }, crys: [], light: null, arcT: 0, ghostK: 0, coneK: 0 };
  }
  setSkill(skill) {
    this.skill = skill || SKILLS[0];
    for (const s of ['L', 'R']) this.chargeCancel(s, true);
  }
  get timeScale() { return this._timeScale; }

  // ---------------------------------------------------------------- 팔 위의 점들
  _fwd(side) { return V().set(0, 0, 1).applyQuaternion(this.arms[side].root.quaternion); }
  _up(side) { return V().set(0, 1, 0).applyQuaternion(this.arms[side].root.quaternion); }
  _scrapLump(side) { const a = this.arms[side]; return a.scrap && a.scrap.lumpHP > 0 && a.scrapObj ? a.scrapObj.lump : null; }
  // 주먹 앞면 가운데(월드)
  front(side) {
    const a = this.arms[side], lump = this._scrapLump(side);
    if (lump) return lump.getWorldPosition(V()).addScaledVector(this._fwd(side), 0.03);
    const r = a.reach();
    return a.root.localToWorld(V().set(0, 0.006, Math.max(0.0, r - 0.01)));
  }
  // 손등·너클 위 아무 점(월드). 짓이겨진 앞쪽은 피함
  handPoint(side) {
    const a = this.arms[side], lump = this._scrapLump(side);
    if (lump) return lump.localToWorld(V().set(rnd(-0.03, 0.03), rnd(-0.02, 0.028), rnd(-0.02, 0.04)));
    if (a.I >= 0.5) return this.forearmPoint(side, Math.min(a.cutZ, 0) - rnd(0.0, 0.03));
    const zMax = Math.min(a.cutZ, 0.11) - 0.006;
    if (Math.random() < 0.5) {
      // 주먹 둘레를 고르게(팔 기준 좌표라 좌우 팔 모두 같은 모양)
      const ang = Math.random() * TAU;
      return a.root.localToWorld(V().set(Math.cos(ang) * 0.036, Math.sin(ang) * 0.026 + 0.008, Math.min(rnd(0.01, a.reach() - 0.006), zMax)));
    }
    const f = Math.floor(Math.random() * 4);
    const k = ANAT.MCP[f];
    const p = V().set(k.x + rnd(-0.006, 0.006), k.y + rnd(0.0, 0.008), Math.min(k.z + rnd(-0.004, 0.008), zMax));
    if (Math.random() < 0.45) { p.z = Math.min(rnd(0.0, 0.06), zMax); p.y = 0.018 + rnd(0, 0.006); p.x = rnd(-0.03, 0.03); }
    return p.applyMatrix4(a.attach.hand.matrixWorld);
  }
  knuckle(side, i) {
    const a = this.arms[side], lump = this._scrapLump(side);
    if (lump) { const ang = (i / 6) * TAU; return lump.localToWorld(V().set(Math.cos(ang) * 0.026, Math.sin(ang) * 0.02, 0.035)); }
    if (a.I >= 0.3) { const ang = (i / 6) * TAU; return a.root.localToWorld(V().set(Math.cos(ang) * 0.022, Math.sin(ang) * 0.016 + 0.006, Math.max(0.0, a.reach() - 0.012))); }
    const k = ANAT.MCP[i % 4];
    return V().set(k.x + (i >= 4 ? 0.006 : 0), k.y + 0.006 + (i >= 4 ? -0.004 : 0), k.z + 0.004).applyMatrix4(a.attach.hand.matrixWorld);
  }
  forearmPoint(side, z, ang = Math.random() * TAU, r = 1) {
    const a = this.arms[side];
    return V().set(Math.cos(ang) * 0.031 * r, Math.sin(ang) * 0.024 * r + 0.002, z).applyMatrix4(a.attach.forearm.matrixWorld);
  }
  _n(side, key, rate, dt) {
    const S = this.S[side];
    S.acc[key] = (S.acc[key] || 0) + rate * dt;
    const n = Math.floor(S.acc[key]);
    S.acc[key] -= n;
    return n;
  }
  _light() {
    const L = this.lightPool.find((l) => !l.userData.busy && !l.userData.powerBusy && !l.userData.skillBusy);
    if (L) { L.userData.skillBusy = true; L.intensity = 0; }
    return L || null;
  }
  _freeLight(L) { if (L) { L.intensity = 0; L.userData.skillBusy = false; } }
  // 잠깐 번쩍이는 점광원
  _flashLight(p, color, I, tau) {
    const L = this._light();
    if (!L) return;
    // 물리 점광원이라 주먹 바로 앞에서는 아주 작은 값도 눈부심(열쇠 조명의 몇 배) — 살갗이 하얗게 날아가지 않게 낮춰 씀
    const J = I * 0.05;
    L.color.set(color); L.position.copy(p); L.distance = 1.4; L.decay = 2; L.intensity = J;
    this.lightUse.set(L, { I: J, tau, t: 0 });
  }
  _at(delay, fn) { this.timeline.push({ t: delay, fn }); }

  // ---------------------------------------------------------------- 모으기
  // game이 매 프레임 넣음: k(0~1, 모은 정도), holding(가드에서 누르는 중)
  setCharge(side, k, holding) {
    const S = this.S[side];
    S.k = holding ? k : 0; S.holding = holding;
    if (holding && k > 0.001 && !S.charging) {
      S.charging = true; S.full = false;
      this.sfx.chargeStart?.(side, this.skill.id);
    }
    if (S.charging && holding && k >= 0.999 && !S.full) {
      S.full = true;
      S.att.pulse = 1;
      this.sfx.play('ready', 0.55, { pan: side === 'L' ? -0.3 : 0.3, jitter: 0.03 });
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
    }
    if (S.charging && !holding && !S.striking) this.chargeCancel(side);
  }
  chargeCancel(side, quiet) {
    const S = this.S[side];
    if (S.charging) this.sfx.chargeStop?.(side, quiet ? 0.02 : 0.12);
    S.charging = false; S.full = false; S.k = 0; S.holding = false;
    for (const c of S.crys) c.t = c.life;
    S.crys.length = 0;
  }
  // 모은 주먹을 내지름
  launch(side, k, fist) {
    const S = this.S[side], id = this.skill.id;
    S.charging = false; S.full = false; S.striking = true; S.launchK = k; S.k = 0;
    this.sfx.chargeStop?.(side, 0.03);
    const pan = side === 'L' ? -0.3 : 0.3;
    const full = k >= 0.95;
    switch (id) {
      case 'sonic': this.sfx.play('lSonic', 0.75 + 0.25 * k, { pan, jitter: 0.04 }); this.coneOwner = side; break;
      case 'barrage': this.sfx.play('flurry', 0.8, { pan, jitter: 0.05 }); break;
      case 'twist': this.sfx.play('lTwist', 0.8, { pan, jitter: 0.04 }); break;
      case 'fire': this.sfx.play('lFire', 0.75, { pan, jitter: 0.05 }); break;
      case 'bolt': this.sfx.play('zap', 0.5, { pan }); break;
      case 'final':
        this.sfx.play('lFinal', 0.9, { pan: pan * 0.5, jitter: 0.02 });
        if (full) { this.slow.scale = 0.3; this.slow.hold = 9; this.slow.ease = 0; }
        break;
    }
  }

  // ---------------------------------------------------------------- 맞는 순간
  // o: scrap, full, arm, fist
  impact(side, contact, k, o = {}) {
    const S = this.S[side], id = this.skill.id;
    S.striking = false;
    if (S.light) { this._freeLight(S.light); S.light = null; }
    const wall = this.getWall();
    const wz = wall ? wall.surfaceZ() : contact.z;
    const p = V().set(contact.x, contact.y, Math.max(contact.z, wz) + 0.006);
    const F = this.front(side);
    const pan = side === 'L' ? -0.25 : 0.25;
    const kk = clamp(k, 0, 1);
    switch (id) {
      case 'sonic': this._iSonic(side, p, F, kk, pan); break;
      case 'barrage': this._iBarrage(side, p, kk, pan); break;
      case 'twist': this._iTwist(side, p, kk, pan); break;
      case 'frost': this._iFrost(side, p, kk, pan); break;
      case 'fire': this._iFire(side, p, F, kk, pan, o); break;
      case 'gravity': this._iGravity(side, p, kk, pan); break;
      case 'bolt': this._iBolt(side, p, F, kk, pan); break;
      case 'final': this._iFinal(side, p, F, kk, pan, o); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- 공용 조각
  // 크게 번지는 빛 한 덩이
  _glow(p, size, col, a = 0.9, life = 0.16, sys = 'add', z = 0.012) {
    this[sys].emit({ x: p.x, y: p.y, z: p.z + z, life, s0: size * 0.35, s1: size, c0: col, a, fin: 0.04, fout: 1.6, tile: 0, ease: true });
  }
  _star(p, size, col, a = 1, life = 0.12) {
    this.add.emit({ x: p.x, y: p.y, z: p.z + 0.014, life, s0: size * 0.5, s1: size, c0: col, a, fin: 0.04, fout: 1.3, tile: 4, rot: rnd(0, TAU), spin: rnd(-3, 3), ease: true });
  }
  // 벽면을 따라 퍼지는 먼지 고리
  _dustRing(p, n, k, col = [0.62, 0.57, 0.5], a = 0.6, sp = 1.6, size = 0.09) {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.2, 0.2), s = rnd(0.7, 1.3) * sp * (0.6 + 0.6 * k);
      this.norm.emit({ x: p.x, y: p.y, z: p.z + rnd(0, 0.01), vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.8, vz: rnd(0.02, 0.2), drag: 0.02, life: rnd(0.4, 0.7), s0: size * 0.2, s1: size * rnd(0.8, 1.25), c0: col, a: a * rnd(0.7, 1), fin: 0.05, fout: 1.3, tile: 3, rot: rnd(0, TAU), spin: rnd(-2, 2), ease: true });
    }
  }
  // 만화식 집중선 — 어두운 빗살이라 밝은 벽에서도 또렷함
  _speedLines(p, n, k, col = [0.14, 0.14, 0.18], a = 0.85, len = 0.12, w = 0.007, sys = 'norm') {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.12, 0.12), s = rnd(2.0, 3.2) * (0.75 + 0.4 * k);
      this[sys].emit({ x: p.x + Math.cos(ang) * 0.04, y: p.y + Math.sin(ang) * 0.04, z: p.z + 0.006, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, vz: 0, drag: 0.01, life: rnd(0.14, 0.24), s0: w, s1: w * 0.5, sy: 1, c0: col, a, fin: 0.04, fout: 1, tile: 6, st: len * rnd(0.7, 1.3) / s });
    }
  }
  _sparks(p, n, k, c0, c1, sp = 2.4, g = -6, life = 0.4, st = 0.03, size = 0.006) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU, s = rnd(0.5, 1) * sp * (0.6 + 0.5 * k);
      this.add.emit({ x: p.x, y: p.y, z: p.z + 0.01, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.85 + rnd(0, 0.5), vz: rnd(0.1, 0.9), drag: 0.25, g, life: rnd(0.4, 1) * life, s0: size, s1: size * 0.4, sy: 0.7, c0, c1, a: 1, fin: 0.02, fout: 1, tile: 1, st });
    }
  }
  // 모으는 동안 주먹으로 오므라드는 공기 고리
  _inRing(side, F, e, colA, colB, r0 = 0.15, every = 0.12, spiral = 0, a = 0.75) {
    const S = this.S[side];
    S.ringT = (S.ringT || 0) - this._fdt;
    if (S.ringT > 0) return;
    S.ringT = every;
    this.rings.spawn({ p: F.clone().addScaledVector(this._fwd(side), 0.01), r0: r0 * (0.75 + 0.35 * e), r1: 0.035, life: 0.28, a: a * e, colA, colB, dark: 0.85, cam: true, spiral, spin: spiral ? 9 : 0 });
  }

  _iSonic(side, p, F, k, pan) {
    this._flashLight(V().set(p.x, p.y + 0.02, p.z + 0.12), 0xf4f7ff, 5.5 * k, 0.12);
    this._glow(p, 0.3 * (0.6 + 0.4 * k), [1.4, 1.45, 1.6], 0.55, 0.14);
    this.rings.spawn({ p, r0: 0.03, r1: 0.34 + 0.14 * k, life: 0.32, a: 1, colA: [1.9, 1.9, 2.0], colB: [0.2, 0.2, 0.25], dark: 0.9 });
    this.rings.spawn({ p, r0: 0.03, r1: 0.56 + 0.2 * k, life: 0.44, a: 0.9, colA: [1.7, 1.75, 1.9], colB: [0.24, 0.24, 0.3], dark: 0.75, delay: 0.06 });
    this._speedLines(p, 40, k);
    this._dustRing(p, 34, k, [0.66, 0.62, 0.56], 0.7, 2.0, 0.12);
    if (this.coneOwner === side) { this.coneOwner = null; this.coneBurst = { t: 0, p: F.clone(), dir: this._fwd(side), k }; }
    this.sfx.play('iSonic', 0.85 + 0.2 * k, { pan, jitter: 0.04, verbAmt: 0.6 });
  }
  _iBarrage(side, p, k, pan) {
    this._flashLight(V().set(p.x, p.y + 0.02, p.z + 0.1), 0xeef3ff, 4 * k, 0.1);
    this._star(p, 0.16, [1.7, 1.75, 1.9], 0.9, 0.14);
    this.rings.spawn({ p, r0: 0.02, r1: 0.22, life: 0.2, a: 0.95, colA: [1.8, 1.8, 1.9], colB: [0.22, 0.22, 0.27], dark: 0.75 });
    this._speedLines(p, 18, k);
    this.S[side].ghostK = 1;
    this.sfx.play('iSonic', 0.4, { pan, rate: 1.3 });
  }
  // 잔상 연타 중 한 대
  barrageHit(side, contact, last) {
    const wall = this.getWall();
    const p = V().set(contact.x, contact.y, Math.max(contact.z, wall ? wall.surfaceZ() : contact.z) + 0.006);
    this._star(p, last ? 0.2 : rnd(0.09, 0.13), [1.7, 1.75, 1.95], 0.95, last ? 0.16 : 0.09);
    this._speedLines(p, last ? 24 : 9, last ? 1 : 0.6, [0.14, 0.14, 0.18], 0.8, last ? 0.13 : 0.07, last ? 0.007 : 0.005);
    this._dustRing(p, last ? 16 : 6, 0.6, [0.62, 0.6, 0.57], 0.5, 1.4, last ? 0.1 : 0.06);
    if (last) {
      this._flashLight(V().set(p.x, p.y + 0.02, p.z + 0.1), 0xeef3ff, 5, 0.12);
      this.rings.spawn({ p, r0: 0.03, r1: 0.36, life: 0.3, a: 1, colA: [1.9, 1.9, 2.0], colB: [0.2, 0.2, 0.25], dark: 0.85 });
      this.sfx.play('iSonic', 0.75, { pan: side === 'L' ? -0.25 : 0.25 });
    }
  }
  _iTwist(side, p, k, pan) {
    this._flashLight(V().set(p.x, p.y + 0.02, p.z + 0.12), 0xe6eeff, 5.5 * k, 0.14);
    this._glow(p, 0.26, [1.4, 1.45, 1.6], 0.5, 0.16);
    // 벽면을 따라 돌며 퍼지는 소용돌이
    this.rings.spawn({ p, r0: 0.03, r1: 0.4 + 0.1 * k, life: 0.55, a: 1, colA: [1.75, 1.75, 1.85], colB: [0.2, 0.2, 0.24], dark: 0.85, spiral: 1, spin: 16 });
    this.rings.spawn({ p, r0: 0.03, r1: 0.24 + 0.06 * k, life: 0.4, a: 0.9, colA: [1.8, 1.8, 1.9], colB: [0.2, 0.19, 0.22], dark: 0.75, spiral: 1, spin: -20, delay: 0.05 });
    const sg = side === 'L' ? 1 : -1;
    for (let i = 0; i < 80; i++) {
      const ang = Math.random() * TAU, r = rnd(0.015, 0.07), s = rnd(1.2, 2.4) * (0.7 + 0.4 * k);
      this.norm.emit({ x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r, z: p.z + rnd(0, 0.025), vx: Math.cos(ang) * s * 0.35, vy: Math.sin(ang) * s * 0.35, vz: rnd(0.0, 0.2), drag: 0.1, life: rnd(0.35, 0.6), s0: 0.007, s1: 0.004, sy: 1, c0: i % 3 ? [0.16, 0.17, 0.21] : [0.55, 0.5, 0.42], a: 0.85, fin: 0.04, fout: 1.1, tile: 6, st: 0.045, att: p.clone(), attK: -0.4, swirl: sg * 44 });
    }
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * TAU, r = rnd(0.02, 0.08);
      this.norm.emit({ x: p.x + Math.cos(ang) * r, y: p.y + Math.sin(ang) * r, z: p.z + rnd(0, 0.02), vx: Math.cos(ang) * 0.4, vy: Math.sin(ang) * 0.4, drag: 0.2, life: rnd(0.5, 0.8), s0: 0.03, s1: rnd(0.09, 0.13), c0: [0.64, 0.6, 0.53], a: 0.6, fin: 0.05, fout: 1.2, tile: 3, rot: rnd(0, TAU), spin: sg * rnd(3, 6), att: p.clone(), attK: -0.25, swirl: sg * 22, ease: true });
    }
    this._speedLines(p, 20, k);
    this.sfx.play('iTwist', 0.9, { pan, jitter: 0.04 });
  }
  _iFrost(side, p, k, pan) {
    const S = this.S[side];
    // 너클에 자라던 얼음이 깨져 튐
    for (const c of S.crys) { c.mode = 'fly'; c.t = 0; c.life = rnd(0.5, 0.9); c.v.set(rnd(-0.8, 0.8), rnd(0.2, 1.2), rnd(0.1, 0.8)); c.w.set(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)); }
    S.crys.length = 0;
    this._flashLight(V().set(p.x, p.y + 0.02, p.z + 0.12), 0x6fb8ff, 7 * k, 0.22);
    this._glow(p, 0.3, [0.35, 0.75, 1.6], 0.55, 0.2, 'norm');
    // 벽면에 얼음꽃이 피었다가 산산조각
    const n = Math.round(11 + 8 * k);
    const bloom = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.25, 0.25);
      const dir = V().set(Math.cos(ang), Math.sin(ang), rnd(0.25, 0.85)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const c = this.crys.add({ p: p.clone().addScaledVector(dir, 0.015), s: rnd(0.03, 0.05) * (0.7 + 0.4 * k), sy: rnd(1.8, 2.9), q, mode: 'grow', grow: 0.07, life: 0.36 + rnd(0, 0.06) });
      if (c) bloom.push(c);
    }
    this._at(0.34, () => {
      for (const c of bloom) {
        for (let j = 0; j < 3; j++) {
          const ang = Math.random() * TAU;
          this.crys.add({ p: c.p.clone().add(V().set(rnd(-0.03, 0.03), rnd(-0.03, 0.03), rnd(0, 0.03))), v: V().set(Math.cos(ang) * rnd(0.4, 1.6), Math.sin(ang) * rnd(0.3, 1.4) + 0.4, rnd(0.1, 1.0)), s: rnd(0.008, 0.016), sy: rnd(1.2, 2.2), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6))), w: V().set(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25)), life: rnd(0.6, 1.1), g: -5 });
        }
      }
      for (let i = 0; i < 34; i++) this.add.emit({ x: p.x + rnd(-0.14, 0.14), y: p.y + rnd(-0.1, 0.14), z: p.z + rnd(0.01, 0.06), vx: rnd(-0.1, 0.1), vy: rnd(-0.25, -0.05), life: rnd(0.5, 1.0), s0: rnd(0.014, 0.024), s1: 0, c0: [0.9, 1.5, 2.6], a: 0.95, fin: 0.1, fout: 0.6, tile: 4, rot: rnd(0, TAU), spin: rnd(-6, 6) });
      this.rings.spawn({ p, r0: 0.03, r1: 0.28, life: 0.26, a: 0.9, colA: [1.0, 1.6, 2.4], colB: [0.05, 0.18, 0.45], dark: 0.9 });
      this.sfx.play('tinkle', 0.7, { pan, jitter: 0.06 });
    });
    // 첫 순간의 결정 파편 + 찬 김
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * TAU;
      this.crys.add({ p: p.clone(), v: V().set(Math.cos(ang) * rnd(0.8, 2.4), Math.sin(ang) * rnd(0.6, 2.0) + 0.3, rnd(0.2, 1.2)), s: rnd(0.008, 0.017), sy: rnd(1.3, 2.4), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6))), w: V().set(rnd(-30, 30), rnd(-30, 30), rnd(-30, 30)), life: rnd(0.5, 1.0), g: -6 });
    }
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * TAU + rnd(-0.2, 0.2), s = rnd(0.5, 1.2);
      this.norm.emit({ x: p.x, y: p.y, z: p.z + 0.01, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.8, vz: rnd(0, 0.12), drag: 0.03, life: rnd(0.7, 1.2), s0: 0.03, s1: rnd(0.1, 0.15), c0: [0.42, 0.64, 0.95], c1: [0.7, 0.82, 0.98], a: 0.6, fin: 0.05, fout: 1.2, tile: 3, rot: rnd(0, TAU), spin: rnd(-1, 1), ease: true });
    }
    this.rings.spawn({ p, r0: 0.03, r1: 0.34, life: 0.36, a: 1, colA: [1.0, 1.6, 2.4], colB: [0.05, 0.18, 0.45], dark: 0.95 });
    this._speedLines(p, 24, k, [0.06, 0.16, 0.36], 0.85, 0.12, 0.007);
    S.after.fr = 1;
    this.sfx.play('iFrost', 0.95, { pan, jitter: 0.03 });
  }
  _iFire(side, p, F, k, pan, o) {
    const c = V().set(p.x, p.y, p.z + 0.012);
    this._flashLight(V().set(p.x, p.y + 0.03, p.z + 0.14), 0xff6a1a, 9 * k, 0.36);
    this._glow(c, 0.34, [1.9, 0.75, 0.12], 0.75, 0.18, 'norm');
    this.balls.spawn({ p: c, r0: 0.02, r1: 0.16 + 0.07 * k, grow: 0.2, life: 1.0 + 0.3 * k, hot: 0.12, flat: 0.3 });
    this.balls.spawn({ p: c.clone().add(V().set(rnd(-0.05, 0.05), 0.06, 0.005)), r0: 0.01, r1: 0.09 + 0.04 * k, grow: 0.18, life: 0.85, hot: 0.05, flat: 0.35, delay: 0.06 });
    for (let i = 0; i < 72; i++) {
      const ang = Math.random() * TAU, s = rnd(0.5, 1.8) * (0.6 + 0.5 * k);
      this.norm.emit({ x: c.x, y: c.y, z: c.z + 0.01, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.8 + 0.25, vz: rnd(0.02, 0.2), drag: 0.05, g: 0.6, life: rnd(0.35, 0.65), s0: 0.03, s1: rnd(0.08, 0.13), sy: 1.25, c0: [2.2, 0.8, 0.12], c1: [0.4, 0.04, 0.02], a: 0.95, fin: 0.04, fout: 1.1, tile: 2, rot: rnd(-0.4, 0.4), ease: true });
    }
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * TAU, s = rnd(0.6, 2.6);
      this.add.emit({ x: c.x, y: c.y, z: c.z + 0.02, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s + 0.4, vz: rnd(0.1, 0.8), drag: 0.4, g: -1.2, life: rnd(0.7, 1.4), s0: 0.006, s1: 0.0025, c0: [2.7, 1.35, 0.35], c1: [1.4, 0.3, 0.05], a: 1, fin: 0.02, fout: 0.8, tile: 1, st: 0.016 });
    }
    for (let i = 0; i < 22; i++) {
      this.norm.emit({ x: c.x + rnd(-0.07, 0.07), y: c.y + rnd(-0.01, 0.08), z: c.z + rnd(0.0, 0.03), vx: rnd(-0.06, 0.06), vy: rnd(0.12, 0.34), vz: rnd(0, 0.03), drag: 0.5, life: rnd(1.3, 2.2), s0: 0.05, s1: rnd(0.15, 0.22), c0: [0.12, 0.1, 0.09], c1: [0.36, 0.34, 0.32], a: 0.6, fin: 0.22, fout: 1.3, tile: 3, rot: rnd(0, TAU), spin: rnd(-0.6, 0.6), ease: true });
    }
    this.rings.spawn({ p: c, r0: 0.03, r1: 0.32, life: 0.28, a: 0.95, colA: [2.3, 1.1, 0.25], colB: [0.25, 0.05, 0.02], dark: 0.85 });
    this._speedLines(c, 26, k, [0.18, 0.05, 0.02], 0.85, 0.13, 0.008);
    this.S[side].after.heat = 1;
    if (o.arm && o.arm.scrapObj) o.arm.scrapObj.heat = Math.max(o.arm.scrapObj.heat, 0.7);
    this.sfx.play('iFire', 1.0, { pan, jitter: 0.03, verbAmt: 0.5 });
  }
  _iGravity(side, p, k, pan) {
    const c = V().set(p.x, p.y, p.z + 0.014);
    this.core.start(c, 0.07 + 0.02 * k);
    this.gravity = { t: 0, p: c.clone(), k };
    this._glow(c, 0.3, [0.16, 0.05, 0.26], 0.7, 0.4, 'norm', 0.004);
    // 둘레의 먼지·빛·피를 끌어들임
    for (let i = 0; i < 110; i++) {
      const ang = Math.random() * TAU, r = rnd(0.1, 0.4);
      const x = c.x + Math.cos(ang) * r, y = c.y + Math.sin(ang) * r * 0.9, z = c.z + rnd(0.0, 0.09);
      const t = i % 3;
      this[t === 0 ? 'add' : 'norm'].emit({ x, y, z, vx: -Math.sin(ang) * 0.5, vy: Math.cos(ang) * 0.5, life: 0.44, att: c, attK: rnd(1.8, 2.8), swirl: 7, eat: 0.014, s0: t === 0 ? 0.012 : 0.007, s1: 0.003, sy: 1, c0: t === 0 ? [1.5, 0.75, 2.5] : t === 1 ? [0.14, 0.05, 0.24] : [0.42, 0.38, 0.4], a: 0.95, fin: 0.12, fout: 0.3, tile: t === 0 ? 0 : 6, st: t === 0 ? 0 : 0.04 });
    }
    this.rings.spawn({ p: c, r0: 0.4, r1: 0.06, life: 0.4, a: 0.9, colA: [1.5, 0.85, 2.3], colB: [0.1, 0.03, 0.18], dark: 0.95 });
    this.rings.spawn({ p: c, r0: 0.26, r1: 0.05, life: 0.32, a: 0.8, colA: [1.6, 1.0, 2.4], colB: [0.12, 0.04, 0.2], dark: 0.9, delay: 0.08 });
    this._at(0.43, () => {
      this._glow(c, 0.55, [2.0, 1.4, 2.6], 1, 0.2);
      this.rings.spawn({ p: c, r0: 0.03, r1: 0.52, life: 0.36, a: 1, colA: [1.9, 1.3, 2.5], colB: [0.14, 0.05, 0.24], dark: 0.9 });
      this.rings.spawn({ p: c, r0: 0.03, r1: 0.32, life: 0.28, a: 0.85, colA: [1.9, 1.7, 2.3], colB: [0.16, 0.06, 0.26], dark: 0.75, delay: 0.04 });
      for (let i = 0; i < 60; i++) {
        const ang = Math.random() * TAU, s = rnd(1.0, 3.2);
        this.add.emit({ x: c.x, y: c.y, z: c.z + 0.01, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, vz: rnd(0, 0.6), drag: 0.05, life: rnd(0.22, 0.42), s0: 0.008, s1: 0.003, sy: 1, c0: [1.7, 0.95, 2.7], c1: [0.6, 0.2, 1.2], a: 1, fin: 0.02, fout: 1, tile: 6, st: 0.04 });
      }
      this._speedLines(c, 34, 1, [0.12, 0.04, 0.2], 0.9, 0.16, 0.008);
      this._flashLight(V().set(c.x, c.y, c.z + 0.12), 0xc89bff, 11, 0.25);
      this.camPunch = (this.camPunch || 0) + 1;
      this.sfx.play('gBoom', 1.0, { pan, jitter: 0.02, verbAmt: 0.7 });
    });
    this.S[side].after.gv = 1;
    this.sfx.play('gSuck', 0.9, { pan, jitter: 0.02 });
  }
  _iBolt(side, p, F, k, pan) {
    const top = V().set(p.x + rnd(-0.12, 0.12), p.y + 0.95, p.z + rnd(0.02, 0.1));
    const end = F.clone().add(V().set(0, 0.01, 0.0));
    const nStrike = k > 0.6 ? 3 : 2;
    for (let i = 0; i < nStrike; i++) {
      this._at(i * 0.08, () => {
        const t = top.clone().add(V().set(rnd(-0.06, 0.06), 0, rnd(-0.02, 0.02)));
        this.bolts.add(t, end, { life: 0.1, width: 0.004 + 0.002 * k, flick: 0.03, rough: 0.2, branch: 0.95 });
        this.over.bang('rgba(120,170,255,1)', 0.12 + 0.08 * k, 0, 0.05);
        this._flashLight(V().set(end.x, end.y + 0.05, end.z + 0.1), 0xa8ccff, 12 * k, 0.08);
        this._glow(end, 0.3, [1.2, 1.6, 2.6], 0.9, 0.12);
        if (i > 0) this.sfx.play('zap', 0.6, { pan, jitter: 0.08 });
      });
    }
    // 벽면을 타고 사방으로 기어가는 전기
    for (let i = 0; i < 11; i++) {
      const ang = (i / 11) * TAU + rnd(-0.3, 0.3), L = rnd(0.16, 0.38) * (0.7 + 0.5 * k);
      const b = V().set(p.x + Math.cos(ang) * L, p.y + Math.sin(ang) * L, p.z - 0.002);
      this.bolts.add(p, b, { life: rnd(0.14, 0.3), width: 0.0022, flick: 0.04, rough: 0.3, branch: 0.7, delay: rnd(0, 0.07) });
    }
    this._sparks(p, 70, k, [1.6, 2.0, 2.8], [0.6, 0.9, 2.0], 2.8, -4, 0.5, 0.025, 0.007);
    this.rings.spawn({ p, r0: 0.03, r1: 0.3, life: 0.24, a: 0.9, colA: [1.6, 1.9, 2.7], colB: [0.1, 0.18, 0.42], dark: 0.7 });
    this.S[side].after.el = 1;
    this.sfx.play('iBolt', 1.0, { pan: pan * 0.4, jitter: 0.02, verbAmt: 0.8 });
    this.sfx.play('thunder', 0.75, { delay: 0.05, jitter: 0.05, verbAmt: 1 });
  }
  _iFinal(side, p, F, k, pan, o) {
    const full = k >= 0.95;
    const big = full ? 1 : 0.55 + 0.4 * k;
    if (full) {
      this.over.bang('#fffaf0', 1, 0.03, 0.06);
      this.slow.scale = 0.33; this.slow.hold = 0.62; this.slow.ease = 0.45;
      this.sfx.muffle?.(1.3);
      this.sfx.play('tinnitus', 0.2, { verb: false, dry: true, jitter: 0, delay: 0.14 });
    } else {
      this.slow.scale = 1; this.slow.hold = 0;
      this.over.bang('#fff6e8', 0.55, 0, 0.15);
    }
    const c = V().set(p.x, p.y, p.z + 0.01);
    this._glow(c, 0.34 * big, [2.2, 0.8, 0.14], 0.5, 0.2);
    this.balls.spawn({ p: c, r0: 0.04, r1: 0.3 * big, grow: 0.42, life: 1.5, hot: 0.2, flat: 0.3 });
    this.balls.spawn({ p: c.clone().add(V().set(rnd(-0.08, -0.04), 0.08, 0.0)), r0: 0.02, r1: 0.17 * big, grow: 0.3, life: 1.2, hot: 0.1, delay: 0.08, flat: 0.35 });
    this.balls.spawn({ p: c.clone().add(V().set(rnd(0.04, 0.08), -0.02, 0.0)), r0: 0.02, r1: 0.15 * big, grow: 0.3, life: 1.1, hot: 0.1, delay: 0.14, flat: 0.35 });
    for (const [d, r1, life] of [[0, 0.7, 0.4], [0.06, 1.0, 0.55], [0.14, 1.3, 0.7]]) {
      this.rings.spawn({ p: c, r0: 0.04, r1: r1 * big, life, a: 1, colA: [2.5, 1.25, 0.3], colB: [0.36, 0.12, 0.04], dark: 0.75, delay: d });
    }
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU + rnd(-0.3, 0.3), L = rnd(0.4, 0.75) * big;
      this.bolts.add(c, V().set(c.x + Math.cos(ang) * L, c.y + Math.sin(ang) * L, c.z + rnd(-0.01, 0.06)), { life: rnd(0.28, 0.46), width: 0.003, flick: 0.035, rough: 0.28, branch: 0.85, delay: rnd(0.0, 0.08) });
    }
    this.bolts.add(V().set(c.x + rnd(-0.1, 0.1), c.y + 1.0, c.z + 0.06), F, { life: 0.14, width: 0.005, flick: 0.03, branch: 1 });
    for (let i = 0; i < Math.round(110 * big); i++) {
      const ang = Math.random() * TAU, s = rnd(0.8, 2.6) * big;
      this.norm.emit({ x: c.x, y: c.y, z: c.z + 0.02, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.85 + 0.2, vz: rnd(0.05, 0.5), drag: 0.04, g: 0.5, life: rnd(0.5, 0.95), s0: 0.05, s1: rnd(0.14, 0.2), sy: 1.2, c0: [2.6, 1.35, 0.35], c1: [0.5, 0.09, 0.03], a: 0.94, fin: 0.03, fout: 1.0, tile: 2, rot: rnd(-0.4, 0.4), ease: true });
    }
    for (let i = 0; i < Math.round(160 * big); i++) {
      const ang = Math.random() * TAU, s = rnd(0.8, 3.8) * big;
      this.add.emit({ x: c.x, y: c.y, z: c.z + 0.02, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s + 0.5, vz: rnd(0.1, 1.2), drag: 0.35, g: -2.5, life: rnd(0.8, 1.8), s0: 0.007, s1: 0.003, c0: i % 4 ? [2.8, 1.55, 0.45] : [1.6, 2.0, 2.8], c1: [1.3, 0.3, 0.05], a: 1, fin: 0.02, fout: 0.7, tile: 1, st: 0.02 });
    }
    for (let i = 0; i < Math.round(50 * big); i++) {
      const ang = Math.random() * TAU;
      this.crys.add({ p: c.clone(), v: V().set(Math.cos(ang) * rnd(1.0, 3.2), Math.sin(ang) * rnd(0.8, 2.8) + 0.4, rnd(0.2, 1.4)), s: rnd(0.008, 0.018), sy: rnd(1.3, 2.4), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6))), w: V().set(rnd(-30, 30), rnd(-30, 30), rnd(-30, 30)), life: rnd(0.6, 1.3), g: -5 });
    }
    for (let i = 0; i < Math.round(40 * big); i++) {
      const ang = Math.random() * TAU, s = rnd(0.2, 1.0) * big;
      this.norm.emit({ x: c.x + Math.cos(ang) * 0.06, y: c.y + Math.sin(ang) * 0.06, z: c.z + rnd(0.01, 0.06), vx: Math.cos(ang) * s, vy: Math.sin(ang) * s * 0.7 + 0.18, vz: rnd(0, 0.12), drag: 0.25, life: rnd(1.8, 2.8), s0: 0.08, s1: rnd(0.28, 0.42) * big, c0: [0.2, 0.17, 0.15], c1: [0.48, 0.45, 0.42], a: 0.55, fin: 0.2, fout: 1.4, tile: 3, rot: rnd(0, TAU), spin: rnd(-0.5, 0.5), ease: true });
    }
    this._speedLines(c, 44, 1, [0.18, 0.1, 0.04], 0.9, 0.2, 0.01);
    this._flashLight(V().set(c.x, c.y + 0.03, c.z + 0.16), 0xff9a40, 4 * big, 0.28);
    const S = this.S[side];
    S.after.gold = 1; S.after.heat = 1; S.after.el = 0.6;
    if (o.arm && o.arm.scrapObj) o.arm.scrapObj.heat = Math.max(o.arm.scrapObj.heat, 0.6);
    this.camPunch = (this.camPunch || 0) + 2;
    this.sfx.play('iFinal', 1.0, { verb: true, verbAmt: 1, jitter: 0.01 });
    this.sfx.play('iBolt', 0.6, { jitter: 0.02 });
  }

  // ---------------------------------------------------------------- 매 프레임
  // 연출 시간은 히트스톱에 안 멈춤(세상이 멈춘 사이 충격이 터져 나감). 대폭발 슬로모션에는 같이 느려짐
  update(dt, rdt, time) {
    this.rt += rdt;
    // 느린 화면 — 대폭발을 내지르다 판이 끝나는 등 맞지 않고 끝나면 바로 풀림
    const sl = this.slow;
    if (sl.hold > 5 && !this.S.L.striking && !this.S.R.striking) { sl.hold = 0; sl.ease = 0.2; }
    if (sl.hold > 0) { sl.hold -= rdt; this._timeScale = sl.scale; }
    else if (sl.scale < 1) {
      sl.ease = Math.max(0.05, sl.ease);
      sl.scale = Math.min(1, sl.scale + rdt / sl.ease * (1 - sl.scale + 0.05));
      this._timeScale = sl.scale;
    } else this._timeScale = 1;
    const fdt = this._fdt = rdt * this._timeScale;
    for (const s of ['L', 'R']) this.arms[s].root.updateMatrixWorld(true);
    for (const s of ['L', 'R']) this._sideFrame(s, fdt, rdt, time);
    // 예약된 일
    if (this.timeline.length) {
      for (const e of this.timeline) e.t -= fdt;
      const due = this.timeline.filter((e) => e.t <= 0);
      this.timeline = this.timeline.filter((e) => e.t > 0);
      for (const e of due) e.fn();
    }
    this._coneFrame(fdt);
    this._gravityFrame(fdt);
    this.norm.update(fdt); this.add.update(fdt);
    this.rings.update(fdt, this.camera);
    this.bolts.update(fdt, this.camera);
    this.cone.update(fdt);
    this.balls.update(fdt);
    this.core.update(fdt);
    this.crys.update(fdt);
    // 빌린 점광원 꺼짐
    for (const [L, u] of this.lightUse) {
      u.t += fdt;
      L.intensity = u.I * Math.exp(-u.t / u.tau);
      if (u.t > u.tau * 5) { this.lightUse.delete(L); this._freeLight(L); }
    }
    // 대폭발 모으는 동안 화면이 당겨지고 가장자리가 어두워짐
    let zt = 0;
    if (this.skill.id === 'final') for (const s of ['L', 'R']) { const S = this.S[s]; zt = Math.max(zt, S.holding ? S.k : S.striking ? S.launchK * 0.8 : 0); }
    this.zoom += (zt - this.zoom) * Math.min(1, rdt * (zt > this.zoom ? 5 : 9));
    this.over.vig = this.zoom * 0.85;
    this.over.update(rdt);
  }

  _sideFrame(side, dt, rdt, time) {
    const S = this.S[side], id = this.skill.id, fist = this.fists[side], arm = this.arms[side];
    const striking = fist.state === 'out' && fist.punchCharge > 0;
    if (!striking && S.striking && fist.state !== 'hit') S.striking = false;
    const e = S.holding ? S.k : striking ? S.launchK : 0;
    // 기운(살갗 위)
    const at = { fr: 0, fi: 0, el: 0, gv: 0, gold: 0, rim: 0 };
    if (e > 0) {
      if (id === 'frost') at.fr = e;
      else if (id === 'fire') at.fi = e;
      else if (id === 'gravity') at.gv = e;
      else if (id === 'bolt') at.el = e;
      else if (id === 'final') { at.gold = e; at.fi = 0.4 * e; at.el = 0.3 * e; }
      else at.rim = (id === 'shock' ? 0.5 : 0.8) * e;
    }
    const A = S.att, AF = S.after;
    const toward = (key, tgt, up, down) => { A[key] += (tgt - A[key]) * Math.min(1, dt * (tgt > A[key] ? up : down)); };
    AF.fr = Math.max(0, AF.fr - dt * 0.55); AF.heat = Math.max(0, AF.heat - dt * 0.4); AF.el = Math.max(0, AF.el - dt * 3); AF.gv = Math.max(0, AF.gv - dt * 2.2); AF.gold = Math.max(0, AF.gold - dt * 2);
    toward('fr', Math.max(at.fr, AF.fr * 0.85), 10, 6);
    toward('fi', at.fi, 12, 6);
    toward('el', Math.max(at.el, AF.el), 14, 8);
    toward('gv', Math.max(at.gv, AF.gv), 10, 6);
    toward('gold', Math.max(at.gold, AF.gold), 10, 4);
    toward('rim', at.rim, 12, 8);
    A.pulse = Math.max(0, A.pulse - rdt * 6);
    A.heat = AF.heat;
    const hasFlesh = arm.I < 0.995;
    arm.U.uAuraA.value.set(A.fr, A.fi, A.el, A.gv);
    arm.U.uAuraB.value.set(A.gold, A.rim, hasFlesh ? A.pulse : 0, A.heat);
    // 잔상
    const rushing = !!fist.rushing;
    if (id === 'barrage' && (rushing || S.ghostK > 0)) this.ghosts.record(side);
    let gk = 0, gmode = 'trail';
    if (id === 'barrage') {
      if (S.holding && S.k > 0.05) { gk = S.k * 0.9; gmode = 'shimmer'; }
      if (rushing) { gk = 1; gmode = 'trail'; S.ghostK = 1; }
      else S.ghostK = Math.max(0, S.ghostK - rdt * 5);
      if (!rushing && S.ghostK > 0) gk = Math.max(gk, S.ghostK);
    }
    if (!rushing && !(S.holding && S.k > 0.05) && S.ghostK <= 0) this.ghosts.hist[side].length = 0;
    this.ghosts.on[side] = gk; this.ghosts.mode[side] = gmode;
    // 모으는 동안·내지르는 동안 뿜는 것들
    if (e > 0.01) this._emitCharge(side, id, e, dt, rdt, striking);
    else if (S.light) { this._freeLight(S.light); S.light = null; }
    // 냉기: 너클에 자라는 얼음(모으는 동안만, 맞으면 깨짐)
    if (id === 'frost' && (S.holding || striking) && e > 0.05) {
      while (S.crys.length < 8) {
        const c = this.crys.add({ mode: 'grow', grow: 0.001, life: 99, s: 0.01, sy: rnd(1.5, 2.4) });
        if (!c) break;
        c.idx = S.crys.length; c.tilt = V().set(rnd(-0.6, 0.6), rnd(0.2, 1.0), rnd(0.3, 1.0));
        S.crys.push(c);
      }
      const fw = this._fwd(side), up = this._up(side);
      for (const c of S.crys) {
        const kp = this.knuckle(side, c.idx);
        const dir = V().copy(fw).multiplyScalar(c.tilt.z).addScaledVector(up, c.tilt.y).add(V().set(c.tilt.x * 0.5, 0, 0)).normalize();
        c.p.copy(kp).addScaledVector(dir, 0.004);
        c.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        c.s = (0.005 + 0.016 * e) * (0.8 + 0.25 * Math.sin(c.idx * 3.1));
        c.t = 0.5;
      }
    } else if (S.crys.length && !(S.holding || striking)) {
      for (const c of S.crys) { c.mode = 'fly'; c.t = 0; c.life = 0.4; c.v.set(rnd(-0.3, 0.3), rnd(-0.2, 0.3), rnd(0, 0.3)); }
      S.crys.length = 0;
    }
    // 불: 맞은 뒤에도 주먹에서 연기가 피어오름
    if (AF.heat > 0.05 && arm.I < 0.995) {
      const n = this._n(side, 'afterSmoke', 16 * AF.heat, dt);
      for (let i = 0; i < n; i++) { const hp = this.handPoint(side); this.norm.emit({ x: hp.x, y: hp.y, z: hp.z, vx: rnd(-0.02, 0.02), vy: rnd(0.08, 0.16), vz: rnd(-0.01, 0.02), drag: 0.6, life: rnd(0.9, 1.4), s0: 0.015, s1: 0.055, c0: [0.28, 0.25, 0.23], c1: [0.52, 0.5, 0.48], a: 0.4 * AF.heat, fin: 0.2, fout: 1.2, tile: 3, rot: rnd(0, TAU), spin: rnd(-1, 1), ease: true }); }
    }
  }

  _emitCharge(side, id, e, dt, rdt, striking) {
    const S = this.S[side];
    const F = this.front(side), fw = this._fwd(side);
    const n = (key, rate) => this._n(side, key, rate, dt);
    switch (id) {
      case 'shock': {
        if (!striking) this._inRing(side, F, e, [1.7, 1.7, 1.75], [0.3, 0.29, 0.28], 0.11, 0.16, 0, 0.55);
        for (let i = n('dust', 12 * e); i > 0; i--) { const p = this.handPoint(side); this.norm.emit({ x: p.x, y: p.y, z: p.z, vx: rnd(-0.03, 0.03), vy: rnd(0.04, 0.12), life: 0.6, s0: 0.006, s1: 0.003, c0: [0.45, 0.42, 0.38], a: 0.6, tile: 1 }); }
        break;
      }
      case 'sonic': {
        if (!striking) this._inRing(side, F, e, [1.8, 1.85, 2.0], [0.2, 0.22, 0.3], 0.16, 0.11);
        // 주먹으로 빨려 드는 공기 빗살
        for (let i = n('air', (striking ? 30 : 85) * e); i > 0; i--) {
          const ang = Math.random() * TAU, r = rnd(0.1, 0.24);
          const p = V().set(F.x + Math.cos(ang) * r, F.y + Math.sin(ang) * r * 0.85, F.z + rnd(-0.05, 0.12));
          const v = V().subVectors(F, p); const d = v.length(); v.multiplyScalar(rnd(1.2, 1.7) / d);
          this.norm.emit({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: d / v.length() * 0.9, s0: 0.006, s1: 0.004, sy: 1, c0: [0.2, 0.24, 0.34], a: 0.75, fin: 0.25, fout: 0.6, tile: 6, st: 0.06 });
        }
        if (striking && this.coneOwner === side) {
          const fist = this.fists[side];
          const u = clamp(fist.u, 0, 1);
          this.cone.mesh.visible = true;
          this.cone.place(F.clone().addScaledVector(fw, 0.012), fw, 0.055 + 0.045 * smooth(u), 0.16 + 0.08 * u);
          this.cone.mat.uniforms.uAlpha.value = 1.0 * S.launchK * smooth(u / 0.3);
        }
        break;
      }
      case 'barrage': {
        if (!striking) this._inRing(side, F, e, [1.8, 1.8, 1.9], [0.22, 0.22, 0.27], 0.12, 0.07, 0, 0.6);
        for (let i = n('lines', 40 * e); i > 0; i--) {
          const ang = Math.random() * TAU, s = rnd(0.9, 1.5);
          this.norm.emit({ x: F.x + Math.cos(ang) * 0.045, y: F.y + Math.sin(ang) * 0.04, z: F.z, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life: 0.13, s0: 0.006, s1: 0.003, sy: 1, c0: [0.16, 0.16, 0.2], a: 0.75, fin: 0.1, fout: 1, tile: 6, st: 0.05 });
        }
        break;
      }
      case 'twist': {
        if (!striking) this._inRing(side, F, e, [1.75, 1.75, 1.85], [0.2, 0.2, 0.24], 0.15, 0.13, 1);
        // 팔뚝을 감고 도는 바람
        const sg = side === 'L' ? 1 : -1;
        for (let i = n('wind', (striking ? 200 : 110) * e); i > 0; i--) {
          const z = rnd(-0.17, 0.05), ang = Math.random() * TAU, rr = rnd(1.4, 2.1);
          const p = this.forearmPoint(side, z, ang, rr), p2 = this.forearmPoint(side, z + (striking ? 0.03 : 0.004), ang + 0.5 * sg, rr);
          const v = p2.sub(p).multiplyScalar(1 / 0.05);
          this.norm.emit({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life: 0.13, s0: 0.0055, s1: 0.0035, sy: 1, c0: i % 4 ? [0.2, 0.22, 0.28] : [0.56, 0.5, 0.42], a: 0.75, fin: 0.15, fout: 1, tile: 6, st: 0.045 });
        }
        break;
      }
      case 'frost': {
        for (let i = n('mist', 34 * e); i > 0; i--) {
          const p = this.handPoint(side);
          this.norm.emit({ x: p.x, y: p.y - 0.006, z: p.z, vx: rnd(-0.03, 0.03), vy: rnd(-0.14, -0.05), vz: rnd(0, 0.03), drag: 0.5, life: rnd(0.8, 1.2), s0: 0.02, s1: rnd(0.05, 0.075), c0: [0.48, 0.68, 0.96], c1: [0.74, 0.85, 0.98], a: 0.5, fin: 0.2, fout: 1.2, tile: 3, rot: rnd(0, TAU), spin: rnd(-1, 1), ease: true });
        }
        for (let i = n('glint', 20 * e); i > 0; i--) {
          const p = this.handPoint(side).add(V().set(rnd(-0.02, 0.02), rnd(-0.012, 0.02), rnd(-0.012, 0.012)));
          this.add.emit({ x: p.x, y: p.y, z: p.z, life: rnd(0.15, 0.3), s0: rnd(0.014, 0.022), s1: 0, c0: [0.9, 1.5, 2.6], a: 1, fin: 0.25, fout: 1, tile: 4, rot: rnd(0, TAU) });
        }
        this._inRing(side, F, e, [1.0, 1.6, 2.4], [0.05, 0.18, 0.45], 0.14, 0.14, 0, 0.7);
        if (!S.light) S.light = this._light();
        if (S.light) { S.light.color.set(0x5aa8ff); S.light.distance = 0.8; S.light.decay = 2; S.light.position.copy(F).add(V().set(0, 0.06, 0.12)); S.light.intensity = 0.03 * (1.2 * e); }
        break;
      }
      case 'fire': {
        const up = V().set(0, 1, 0);
        const upA = this._up(side);
        for (let i = n('flame', (striking ? 190 : 150) * e); i > 0; i--) {
          const p = this.handPoint(side).addScaledVector(upA, 0.008).add(V().set(rnd(-0.01, 0.01), 0, rnd(-0.01, 0.01)));
          const v = up.clone().multiplyScalar(rnd(0.25, 0.55)).add(V().set(rnd(-0.06, 0.06), 0, rnd(-0.03, 0.05)));
          if (striking) v.addScaledVector(fw, -rnd(0.4, 0.9));
          this.norm.emit({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, drag: 0.4, life: rnd(0.22, 0.4), s0: 0.025, s1: rnd(0.055, 0.075), sy: 1.6, c0: [2.3, 0.85, 0.12], c1: [0.45, 0.04, 0.02], a: 0.95, fin: 0.1, fout: 1.1, tile: 2, rot: rnd(-0.25, 0.25), ease: true });
        }
        for (let i = n('core', 70 * e); i > 0; i--) {
          const p = this.handPoint(side);
          this.add.emit({ x: p.x, y: p.y + 0.006, z: p.z, vx: rnd(-0.03, 0.03), vy: rnd(0.2, 0.4), vz: 0, life: rnd(0.15, 0.26), s0: 0.016, s1: 0.032, sy: 1.5, c0: [2.0, 1.2, 0.35], c1: [1.2, 0.3, 0.04], a: 0.7, fin: 0.15, fout: 1, tile: 2, rot: rnd(-0.2, 0.2) });
        }
        for (let i = n('smoke', 22 * e); i > 0; i--) {
          const p = this.handPoint(side);
          this.norm.emit({ x: p.x, y: p.y + 0.05, z: p.z, vx: rnd(-0.02, 0.02), vy: rnd(0.14, 0.24), drag: 0.6, life: rnd(0.8, 1.2), s0: 0.03, s1: 0.09, c0: [0.1, 0.085, 0.08], c1: [0.36, 0.34, 0.33], a: 0.55, fin: 0.25, fout: 1.2, tile: 3, rot: rnd(0, TAU), spin: rnd(-1, 1), ease: true });
        }
        for (let i = n('ember', 20 * e); i > 0; i--) {
          const p = this.handPoint(side);
          this.add.emit({ x: p.x, y: p.y, z: p.z, vx: rnd(-0.12, 0.12), vy: rnd(0.25, 0.55), vz: rnd(-0.05, 0.1), drag: 0.6, life: rnd(0.5, 0.9), s0: 0.005, s1: 0.002, c0: [2.7, 1.45, 0.4], c1: [1.5, 0.3, 0.05], a: 1, fin: 0.05, fout: 0.8, tile: 1 });
        }
        if (!S.light) S.light = this._light();
        if (S.light) {
          S.light.color.set(0xff7a2a); S.light.distance = 0.9; S.light.decay = 2;
          S.light.position.copy(F).add(V().set(0, 0.06, 0.12));
          S.light.intensity = 0.03 * ((1.0 + 2.6 * e) * (0.75 + 0.25 * Math.sin(this.rt * 31) * Math.sin(this.rt * 17.3)));
        }
        const arm = this.arms[side];
        if (arm.scrapObj) arm.scrapObj.heat = Math.max(arm.scrapObj.heat || 0, 0.6 * e);
        break;
      }
      case 'gravity': {
        for (let i = n('pull', 110 * e); i > 0; i--) {
          const ang = Math.random() * TAU, r = rnd(0.1, 0.32);
          const t = Math.random();
          const p = V().set(F.x + Math.cos(ang) * r, F.y + Math.sin(ang) * r * 0.9, F.z + rnd(-0.05, 0.1));
          const kind = t < 0.4 ? 0 : t < 0.8 ? 1 : 2;
          this[kind === 0 ? 'add' : 'norm'].emit({ x: p.x, y: p.y, z: p.z, vx: -Math.sin(ang) * 0.3, vy: Math.cos(ang) * 0.3, life: 0.6, att: F, attK: rnd(0.9, 1.5), swirl: 4, eat: 0.02, s0: kind === 0 ? 0.01 : 0.006, s1: 0.003, sy: 1, c0: kind === 0 ? [1.4, 0.65, 2.3] : kind === 1 ? [0.14, 0.05, 0.24] : [0.38, 0.34, 0.36], a: 0.9, fin: 0.2, fout: 0.4, tile: kind === 0 ? 0 : 6, st: kind === 0 ? 0 : 0.04 });
        }
        // 주먹 둘레가 일그러지며 오므라드는 고리
        this._inRing(side, F, e, [1.5, 0.85, 2.3], [0.08, 0.02, 0.15], 0.17, 0.12, 0, 0.8);
        if (!S.light) S.light = this._light();
        if (S.light) { S.light.color.set(0xa070ff); S.light.distance = 0.8; S.light.decay = 2; S.light.position.copy(F).add(V().set(0, 0.06, 0.12)); S.light.intensity = 0.03 * (1.2 * e * (0.8 + 0.2 * Math.sin(this.rt * 12))); }
        break;
      }
      case 'bolt': {
        S.arcT -= dt;
        if (S.arcT <= 0) {
          S.arcT = rnd(0.018, 0.04) / (0.4 + e);
          const nArc = Math.random() < e ? 2 : 1;
          for (let i = 0; i < nArc; i++) {
            const a = Math.random() < 0.55 ? this.handPoint(side) : this.forearmPoint(side, rnd(-0.18, 0.02), Math.random() * TAU, 1.15);
            const b = a.clone().add(V().set(rnd(-0.05, 0.05), rnd(-0.03, 0.05), rnd(-0.04, 0.04)));
            this.bolts.add(a, b, { life: rnd(0.05, 0.1), width: 0.0016 + 0.0012 * e, flick: 0.025, rough: 0.35, branch: 0.45 });
          }
        }
        for (let i = n('spark', 30 * e); i > 0; i--) {
          const p = this.handPoint(side), ang = Math.random() * TAU, s = rnd(0.3, 0.9);
          this.add.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, vz: rnd(-0.2, 0.4), g: -3, life: rnd(0.1, 0.22), s0: 0.005, s1: 0.002, sy: 0.7, c0: [1.6, 2.0, 2.8], c1: [0.6, 0.9, 2], a: 1, fin: 0.02, tile: 1, st: 0.02 });
        }
        if (!S.light) S.light = this._light();
        if (S.light) {
          S.light.color.set(0x6a9cff); S.light.distance = 0.9; S.light.decay = 2;
          S.light.position.copy(F).add(V().set(0, 0.06, 0.12));
          S.light.intensity = 0.03 * ((Math.random() < 0.35 ? 3.5 : 1.0) * e);
        }
        break;
      }
      case 'final': {
        if (!striking) this._inRing(side, F, e, [2.4, 1.3, 0.25], [0.3, 0.12, 0.03], 0.2, 0.1, 0, 0.8);
        for (let i = n('gold', 130 * e); i > 0; i--) {
          const ang = Math.random() * TAU, r = rnd(0.12, 0.36);
          const p = V().set(F.x + Math.cos(ang) * r, F.y + Math.sin(ang) * r * 0.9, F.z + rnd(-0.06, 0.12));
          const bright = i % 3 === 0;
          this[bright ? 'add' : 'norm'].emit({ x: p.x, y: p.y, z: p.z, vx: -Math.sin(ang) * 0.3, vy: Math.cos(ang) * 0.3, life: 0.55, att: F, attK: rnd(1.0, 1.6), swirl: 5, eat: 0.025, s0: 0.007, s1: 0.0035, sy: 1, c0: bright ? [2.5, 1.7, 0.55] : [1.5, 0.62, 0.06], a: bright ? 1 : 0.9, fin: 0.2, fout: 0.4, tile: 6, st: 0.05 });
        }
        for (let i = n('flame', (striking ? 140 : 60) * e); i > 0; i--) {
          const p = this.handPoint(side);
          const v = V().set(rnd(-0.06, 0.06), rnd(0.22, 0.45), rnd(-0.03, 0.05));
          if (striking) v.addScaledVector(fw, -rnd(0.4, 0.9));
          this.norm.emit({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, drag: 0.4, life: rnd(0.2, 0.34), s0: 0.018, s1: 0.042, sy: 1.6, c0: [2.7, 1.7, 0.45], c1: [0.8, 0.14, 0.03], a: 0.92, fin: 0.12, fout: 1.1, tile: 2, rot: rnd(-0.25, 0.25), ease: true });
        }
        S.arcT -= dt;
        if (S.arcT <= 0) {
          S.arcT = rnd(0.03, 0.06);
          const a = this.handPoint(side), b = a.clone().add(V().set(rnd(-0.06, 0.06), rnd(-0.03, 0.06), rnd(-0.04, 0.04)));
          this.bolts.add(a, b, { life: rnd(0.05, 0.09), width: 0.0018, flick: 0.025, rough: 0.35, branch: 0.45 });
        }
        for (let i = n('glint', 24 * e); i > 0; i--) {
          const p = this.handPoint(side).add(V().set(rnd(-0.035, 0.035), rnd(-0.02, 0.035), rnd(-0.02, 0.02)));
          this.add.emit({ x: p.x, y: p.y, z: p.z, life: rnd(0.15, 0.3), s0: rnd(0.014, 0.022), s1: 0, c0: [2.3, 2.0, 1.25], a: 1, fin: 0.25, fout: 1, tile: 4, rot: rnd(0, TAU) });
        }
        if (!S.light) S.light = this._light();
        if (S.light) {
          S.light.color.set(0xffa040); S.light.distance = 1.0; S.light.decay = 2;
          S.light.position.copy(F).add(V().set(0, 0.06, 0.12));
          S.light.intensity = 0.03 * ((1.2 + 3.3 * e) * (0.85 + 0.15 * Math.sin(this.rt * 37)));
        }
        break;
      }
    }
  }

  _coneFrame(dt) {
    const B = this.coneBurst;
    if (B) {
      B.t += dt;
      const u = B.t / 0.24;
      if (u >= 1) { this.coneBurst = null; this.cone.mesh.visible = false; }
      else {
        this.cone.mesh.visible = true;
        this.cone.place(B.p.clone().addScaledVector(B.dir, 0.02 + 0.08 * easeOut(u)), B.dir, 0.08 + 0.16 * easeOut(u), 0.16 * (1 - 0.5 * u));
        this.cone.mat.uniforms.uAlpha.value = 0.85 * B.k * Math.pow(1 - u, 1.6);
      }
    } else if (!this.coneOwner) this.cone.mesh.visible = false;
  }
  // 중력: 날던 핏방울도 검은 구로 빨려 듦
  _gravityFrame(dt) {
    const G = this.gravity;
    if (!G) return;
    G.t += dt;
    if (G.t > 0.42) { this.gravity = null; return; }
    const c = G.p;
    for (const d of this.fx.drops) {
      const dx = c.x - d.x, dy = c.y - d.y, dz = c.z - d.z, dd = Math.hypot(dx, dy, dz) + 1e-4;
      if (dd > 0.4) continue;
      if (dd < 0.015) { d.t = 99; continue; }
      const a = 9 / Math.max(dd, 0.04);
      d.vx += (dx / dd) * a * dt - (dy / dd) * 4 * dt; d.vy += (dy / dd) * a * dt + (dx / dd) * 4 * dt + 9.8 * dt; d.vz += (dz / dd) * a * dt;
    }
  }

  renderGhosts() { this.ghosts.render(this.renderer, this.scene, this.camera); }

  // 처음 쓸 때 멈칫하지 않게 재질을 미리 컴파일
  warm() {
    const objs = [this.norm.obj, this.add.obj, this.cone.mesh, this.core.sphere, this.core.disk, this.crys.im, this.bolts.glow, this.bolts.core, ...this.rings.list.map((r) => r.mesh), ...this.balls.list.map((b) => b.mesh)];
    const vis = objs.map((o) => o.visible);
    for (const o of objs) o.visible = true;
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn(e); }
    objs.forEach((o, i) => { o.visible = vis[i]; });
    // 그림자 지도가 먼저 있어야 잔상이 그걸 읽을 수 있음 — 한 번 그려 둠(로딩 화면에 가려 안 보임)
    try { this.renderer.render(this.scene, this.camera); } catch (e) { console.warn(e); }
    // 잔상 재질도 한 번 그려 둠
    for (const s of ['L', 'R']) { this.ghosts.record(s); this.ghosts.record(s); this.ghosts.record(s); this.ghosts.on[s] = 0.02; this.ghosts.mode[s] = 'shimmer'; }
    try { this.ghosts.render(this.renderer, this.scene, this.camera); } catch (e) { console.warn(e); }
    for (const s of ['L', 'R']) { this.ghosts.on[s] = 0; this.ghosts.hist[s].length = 0; }
  }

  // 판이 바뀌거나 벽을 바꿀 때 남은 연출 정리
  clear() {
    for (const s of ['L', 'R']) {
      this.chargeCancel(s, true);
      const S = this.S[s];
      S.striking = false;
      if (S.light) { this._freeLight(S.light); S.light = null; }
      for (const k of Object.keys(S.after)) S.after[k] = 0;
      for (const k of Object.keys(S.att)) S.att[k] = 0;
      this.arms[s].U.uAuraA.value.set(0, 0, 0, 0); this.arms[s].U.uAuraB.value.set(0, 0, 0, 0);
      this.ghosts.on[s] = 0; this.ghosts.hist[s].length = 0; S.ghostK = 0;
    }
    this.norm.clear(); this.add.clear(); this.rings.clear(); this.bolts.clear(); this.balls.clear(); this.core.clear(); this.crys.clear();
    this.cone.mesh.visible = false; this.coneOwner = null; this.coneBurst = null; this.gravity = null;
    this.timeline.length = 0;
    for (const [L] of this.lightUse) this._freeLight(L);
    this.lightUse.clear();
    this.slow.scale = 1; this.slow.hold = 0; this._timeScale = 1; this.zoom = 0;
    this.over.clear();
  }
}
