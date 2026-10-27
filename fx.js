// 철권 — 효과: 피 지도(벽에 묻는 피), 핏방울, 살점·뼛조각·찢긴 살가죽, 연기·김·거품·불꽃·전기
import * as THREE from 'three';
import { SHARED, rockGeo } from './walls.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const G_ = new THREE.Vector3(0, -9.8, 0);

// 벽마다 맞을 때 날리는 먼지(dust)·부스러기(grit) — n·g: 개수, size·gs: 크기 배율, atFist: 벽면이 아니라 주먹 자리에서(꼬챙이)
const DUST = {
  cement:   { dust: 0xfaf8f4, grit: 0x5f5a54, n: 18, g: 12, alpha: 0.62, size: 1.25, gs: 1.0 },
  gravel:   { dust: 0xf4f0e8, grit: 0x544f49, n: 18, g: 18, alpha: 0.6, size: 1.25, gs: 1.2 },
  traps:    { dust: 0xfbf0dc, grit: 0x8c6438, n: 14, g: 10, alpha: 0.55, size: 1.1, gs: 1.0 },
  glass:    { dust: 0xf6f4ef, grit: 0x2f8a4c, n: 15, g: 12, alpha: 0.55, size: 1.15, gs: 0.9 },
  nails:    { dust: 0xfaeedb, grit: 0x6e4a2a, n: 14, g: 10, alpha: 0.55, size: 1.1, gs: 1.0 },
  freezer:  { dust: 0xffffff, grit: 0xf4fbff, n: 20, g: 14, alpha: 0.7, size: 1.3, gs: 1.0 },
  hotplate: { dust: 0xd9d2c8, grit: 0xffb04a, n: 0, g: 12, alpha: 0.0, size: 1.0, gs: 0.8 },   // 연기는 smokeBurst가 맡음
  slime:    { dust: 0xd8f7b0, grit: 0x8fd23c, n: 0, g: 18, alpha: 0.0, size: 1.0, gs: 1.6 },
  electric: { dust: 0xf2f4f6, grit: 0x7d848b, n: 10, g: 9, alpha: 0.5, size: 1.05, gs: 0.9 },
  spikes:   { dust: 0xeee2d2, grit: 0x6b3f22, n: 8, g: 12, alpha: 0.45, size: 1.0, gs: 1.1, atFist: true },
};

// ------------------------------------------------------------------ 피 지도
const BM_SIZE = 1024;
class BloodMap {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = BM_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    SHARED.uBlood.value = this.tex;
    this.rect = SHARED.uBloodRect.value;  // x0, y0, w, h
    this.dirty = false; this.lastUp = 0;
    this.ops = []; this.drips = [];
    this.sprites = this.makeSprites();
  }
  makeSprites() {
    // 0~5: 주먹 자국(너클 네 개가 찍힌 얼룩), 6~9: 그냥 튄 피
    const out = [];
    for (let v = 0; v < 10; v++) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d', { willReadFrequently: true });
      const R = (k) => { const s = Math.sin(k * 12.9898 + v * 78.233) * 43758.5453; return s - Math.floor(s); };
      x.translate(128, 128);
      const blob = (cx, cy, r0, k0, col, n = 16, wob = 0.5, sy = 1) => {
        x.fillStyle = col; x.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2; const rr = r0 * (1 - wob / 2 + R(i % n + k0) * wob);
          const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * sy;
          if (i === 0) x.moveTo(px, py); else x.quadraticCurveTo(cx + Math.cos(a - Math.PI / n) * rr * 1.1, cy + Math.sin(a - Math.PI / n) * rr * 1.1 * sy, px, py);
        }
        x.fill();
      };
      // 올챙이 모양 방울: 머리는 둥글고 꼬리는 바깥을 향함
      const tadpole = (px, py, r, a, L, col) => {
        const ca = Math.cos(a), sa = Math.sin(a), tx = px + ca * L, ty = py + sa * L;
        x.fillStyle = col; x.beginPath();
        x.moveTo(px - sa * r, py + ca * r);
        x.quadraticCurveTo(px + ca * L * 0.4 - sa * r * 0.3, py + sa * L * 0.4 + ca * r * 0.3, tx, ty);
        x.quadraticCurveTo(px + ca * L * 0.4 + sa * r * 0.3, py + sa * L * 0.4 - ca * r * 0.3, px + sa * r, py - ca * r);
        x.arc(px, py, r, a - Math.PI / 2, a + Math.PI / 2, true);
        x.fill();
      };
      const red = (k, a = 0.95) => `rgba(${105 + Math.floor(R(k) * 45)},${3 + Math.floor(R(k + 1) * 6)},${3 + Math.floor(R(k + 2) * 5)},${a})`;
      if (v < 6) {
        // 너클 자국 네 개 + 그 사이가 번진 얼룩
        const sp = 46 + R(2) * 8;
        blob(0, 4, 92, 7, 'rgba(118,8,8,0.55)', 20, 0.35, 0.42);
        for (let i = 0; i < 4; i++) {
          const kx = (i - 1.5) * sp + (R(i + 10) - 0.5) * 8, ky = Math.abs(i - 1.5) * 7 + (R(i + 14) - 0.5) * 8;
          const kr = (i === 1 || i === 2 ? 25 : 20) + R(i + 18) * 6;
          blob(kx, ky, kr, 30 + i * 7, red(i + 40, 0.95), 14, 0.55, 0.85);
          blob(kx + (R(i + 50) - 0.5) * 6, ky + (R(i + 54) - 0.5) * 5, kr * 0.55, 60 + i * 5, 'rgba(62,2,2,0.9)', 12, 0.6, 0.8);
          // 살갗 결이 찍힌 듯 밝은 틈
          x.strokeStyle = 'rgba(150,20,18,0.5)'; x.lineWidth = 1.2;
          for (let j = 0; j < 3; j++) { x.beginPath(); x.moveTo(kx - kr * 0.6, ky - kr * 0.3 + j * kr * 0.3); x.lineTo(kx + kr * 0.6, ky - kr * 0.25 + j * kr * 0.3 + (R(i * 3 + j) - 0.5) * 4); x.stroke(); }
        }
      } else {
        // 가운데 덩어리 + 가장자리 가시
        blob(0, 0, 40 + R(1) * 14, 3, red(3, 0.95), 18, 0.6);
        blob((R(4) - 0.5) * 10, (R(5) - 0.5) * 10, 24, 9, 'rgba(66,2,2,0.9)', 14, 0.6);
        const spikes = 6 + Math.floor(R(6) * 6);
        for (let i = 0; i < spikes; i++) {
          const a = R(i + 20) * Math.PI * 2, r0 = 36 + R(i + 21) * 10;
          tadpole(Math.cos(a) * r0 * 0.75, Math.sin(a) * r0 * 0.75, 5 + R(i + 22) * 5, a, 18 + R(i + 23) * 26, red(i + 24));
        }
      }
      // 튄 방울: 바깥으로 꼬리 달린 것 + 둥근 것
      const nt = v < 6 ? 16 : 22;
      for (let i = 0; i < nt; i++) {
        const a = R(i + 100) * Math.PI * 2; const d = (v < 6 ? 70 : 58) + R(i + 140) * 52;
        const r = 1.6 + R(i + 180) * 4.2;
        const px = Math.cos(a) * d, py = Math.sin(a) * d * (v < 6 ? 0.8 : 1);
        if (R(i + 200) < 0.6) tadpole(px, py, r, a, r * (2.5 + R(i + 220) * 3), red(i + 240, 0.92));
        else { x.fillStyle = red(i + 260, 0.9); x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); }
      }
      // 아주 작은 안개 점
      for (let i = 0; i < 46; i++) {
        const a = R(i + 300) * Math.PI * 2; const d = 40 + R(i + 340) * 86;
        x.fillStyle = red(i + 380, 0.55 + R(i + 3) * 0.35);
        x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, 0.6 + R(i + 420) * 1.4, 0, 7); x.fill();
      }
      out.push(c);
    }
    return out;
  }
  // 벽 좌표 → 캔버스 픽셀
  px(x, y) { const r = this.rect; return [((x - r.x) / r.z) * BM_SIZE, (1 - (y - r.y) / r.w) * BM_SIZE]; }
  splat(x, y, size, opts = {}) {
    const v = opts.knuckle ? Math.floor(Math.random() * 6) : 6 + Math.floor(Math.random() * 4);
    const rot = opts.rot ?? Math.random() * 6.28;
    const op = ['s', +x.toFixed(4), +y.toFixed(4), +size.toFixed(4), v, +rot.toFixed(2), opts.dark || 0, +(opts.alpha ?? 0.95).toFixed(2)];
    this.drawOp(op); this.ops.push(op); this.trim();
  }
  drop(x, y, r, dark = 0) {
    const op = ['d', +x.toFixed(4), +y.toFixed(4), +r.toFixed(4), dark];
    this.drawOp(op); this.ops.push(op); this.trim();
  }
  smear(x, y, size, ang) {
    const op = ['m', +x.toFixed(4), +y.toFixed(4), +size.toFixed(4), +ang.toFixed(2)];
    this.drawOp(op); this.ops.push(op); this.trim();
  }
  drip(x, y, len, w) {
    this.drips.push({ x, y, len, w, t: 0, dur: rnd(2, 5) });
  }
  skin(x, y, size) {
    const op = ['k', +x.toFixed(4), +y.toFixed(4), +size.toFixed(4), Math.random()];
    this.drawOp(op); this.ops.push(op); this.trim();
  }
  trim() { if (this.ops.length > 1600) this.ops.splice(0, this.ops.length - 1600); this.dirty = true; }
  drawOp(op, aged = false) {
    const x = this.ctx;
    const [t] = op;
    const k = BM_SIZE / this.rect.z;
    x.save();
    if (aged) x.globalAlpha = 0.85;
    if (t === 's') {
      const [, wx, wy, size, v, rot, dark, al] = op;
      const [px, py] = this.px(wx, wy);
      const s = size * k;
      x.translate(px, py); x.rotate(rot);
      x.globalAlpha *= al ?? 0.95;
      x.drawImage(this.sprites[v], -s, -s, s * 2, s * 2);
      if (dark) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgba(20,0,0,${dark})`; x.fillRect(-s, -s, s * 2, s * 2); }
    } else if (t === 'd') {
      const [, wx, wy, r, dark] = op;
      const [px, py] = this.px(wx, wy);
      x.fillStyle = dark ? 'rgba(60,2,2,0.95)' : `rgba(${100 + Math.random() * 40},4,4,0.95)`;
      x.beginPath(); x.arc(px, py, Math.max(0.7, r * k), 0, 7); x.fill();
    } else if (t === 'm') {
      const [, wx, wy, size, ang] = op;
      const [px, py] = this.px(wx, wy);
      x.translate(px, py); x.rotate(ang);
      const L = size * k, Wd = size * k * 0.35;
      const g = x.createLinearGradient(0, 0, L, 0);
      g.addColorStop(0, 'rgba(90,3,3,0.95)'); g.addColorStop(0.7, 'rgba(110,5,5,0.7)'); g.addColorStop(1, 'rgba(110,5,5,0)');
      x.fillStyle = g;
      for (let i = 0; i < 7; i++) { const yy = (i / 6 - 0.5) * Wd; x.fillRect(0, yy, L * (0.5 + Math.random() * 0.5), Wd / 9 + Math.random() * 2); }
    } else if (t === 'r') {
      // 흘러내린 자국
      const [, wx, wy, len, w] = op;
      const [px, py] = this.px(wx, wy);
      x.fillStyle = 'rgba(95,3,3,0.9)';
      const L = len * k, Wd = Math.max(1.2, w * k);
      x.beginPath(); x.moveTo(px - Wd / 2, py); x.lineTo(px + Wd / 2, py); x.lineTo(px + Wd * 0.35, py + L); x.arc(px, py + L, Wd * 0.7, 0, Math.PI); x.closePath(); x.fill();
    } else if (t === 'k') {
      // 벗겨진 가죽 조각(냉동창고)
      const [, wx, wy, size, seed] = op;
      const [px, py] = this.px(wx, wy);
      const s = size * k;
      x.translate(px, py); x.rotate(seed * 6);
      x.fillStyle = 'rgba(228,172,150,0.97)';
      x.beginPath();
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; const rr = s * (0.7 + Math.sin(i * 3.1 + seed * 9) * 0.25); i ? x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.7) : x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.7); }
      x.fill();
      x.fillStyle = 'rgba(160,30,25,0.8)'; x.beginPath(); x.arc(0, 0, s * 0.35, 0, 7); x.fill();
    }
    x.restore();
    this.dirty = true;
  }
  update(dt, time) {
    for (const d of this.drips) {
      const prev = d.t; d.t = Math.min(1, d.t + dt / d.dur);
      const e0 = 1 - Math.pow(1 - prev, 2), e1 = 1 - Math.pow(1 - d.t, 2);
      if (e1 > e0) {
        const op = ['r', d.x, d.y - d.len * e0, d.len * (e1 - e0), d.w];
        this.drawOp(op); this.ops.push(op);
      }
    }
    this.drips = this.drips.filter((d) => d.t < 1);
    if (this.dirty && time - this.lastUp > 0.07) { this.tex.needsUpdate = true; this.dirty = false; this.lastUp = time; }
  }
  clear() { this.ctx.clearRect(0, 0, BM_SIZE, BM_SIZE); this.ops = []; this.drips = []; this.dirty = true; }
  load(ops) { this.clear(); this.ops = (ops || []).slice(); for (const op of this.ops) this.drawOp(op, true); this.dirty = true; }
}

// ------------------------------------------------------------------ 부드러운 점 입자
// 점 크기 배율 — 화면 해상도·시야각에 맞춰 게임이 넣음(고해상도 폰에서 입자가 작아 보이지 않게)
export const PUFF_SCALE = { value: 1 };
function spriteTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d', { willReadFrequently: true });
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
const SPRITE = spriteTex();

class Puffs {
  // 연기·김·거품·불꽃 공용
  constructor(max, { color = 0xffffff, additive = false, size = 0.02, opacity = 0.5 } = {}) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.data = new Float32Array(max * 2); // size, alpha
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aD', new THREE.BufferAttribute(this.data, 2));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: SPRITE }, uColor: { value: new THREE.Color(color) }, uScale: PUFF_SCALE },
      vertexShader: `attribute vec2 aD; varying float vA; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aD.x * uScale / -mv.z; vA = aD.y; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(uColor, t.a * vA); if (gl_FragColor.a < 0.003) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 4;
    this.p = []; this.baseSize = size; this.baseOpacity = opacity;
  }
  emit(o) { if (this.p.length >= this.max) this.p.shift(); this.p.push(Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, t: 0, size: this.baseSize, grow: 1, g: 0, drag: 1, a: this.baseOpacity }, o)); }
  update(dt) {
    const n = this.p.length;
    for (let i = 0; i < n; i++) {
      const q = this.p[i]; q.t += dt;
      q.vy += q.g * dt; const dr = Math.pow(q.drag, dt);
      q.vx *= dr; q.vy *= dr; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    this.p = this.p.filter((q) => q.t < q.life);
    const m = this.p.length;
    for (let i = 0; i < this.max; i++) {
      if (i < m) {
        const q = this.p[i]; const k = q.t / q.life;
        this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
        this.data[i * 2] = q.size * (1 + (q.grow - 1) * k) * 900;
        // pop: 터지듯 바로 진하게 나타났다 사라짐(먼지·부스러기), 아니면 서서히 피었다 사라짐(연기·김)
        this.data[i * 2 + 1] = q.a * (q.pop ? Math.min(1, k / 0.05) * Math.pow(1 - k, 1.7) : Math.sin(Math.min(1, k * 1.0 + 0.05) * Math.PI) * (1 - k * 0.3));
      } else { this.data[i * 2 + 1] = 0; this.data[i * 2] = 0; }
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.aD.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ 전기 아크
class Arcs {
  constructor() {
    this.max = 12; this.seg = 14;
    const n = this.max * this.seg * 6 * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 6;
    this.arcs = [];
  }
  add(a, b, life = 0.12, width = 0.0016) { if (this.arcs.length >= this.max) this.arcs.shift(); this.arcs.push({ a: a.clone(), b: b.clone(), t: 0, life, width, seed: Math.random() * 100 }); }
  burst(c, n, D) {
    for (let i = 0; i < n; i++) {
      const a = new THREE.Vector3(c.x + rnd(-0.12, 0.12), c.y + rnd(-0.12, 0.12), -D + 0.012);
      this.add(a, c.clone().add(new THREE.Vector3(rnd(-0.02, 0.02), rnd(-0.01, 0.03), rnd(0.0, 0.05))), rnd(0.08, 0.22), rnd(0.0012, 0.0026));
    }
  }
  idle(D) {
    const x = rnd(-0.4, 0.4), y = rnd(-0.6, 0.3);
    this.add(new THREE.Vector3(x, y, -D + 0.013), new THREE.Vector3(x + rnd(-0.08, 0.08), y + rnd(-0.08, 0.08), -D + 0.013), rnd(0.05, 0.12), 0.001);
  }
  update(dt) {
    let k = 0;
    const tmp = new THREE.Vector3(), prev = new THREE.Vector3();
    for (const a of this.arcs) a.t += dt;
    this.arcs = this.arcs.filter((a) => a.t < a.life);
    const zero = () => { this.pos.fill(0); this.col.fill(0); };
    zero();
    for (const a of this.arcs) {
      const fl = Math.random() < 0.3 ? 0.4 : 1;
      const I = (1 - a.t / a.life) * fl;
      const pts = [];
      for (let i = 0; i <= this.seg; i++) {
        const t = i / this.seg;
        tmp.lerpVectors(a.a, a.b, t);
        const j = Math.sin(t * Math.PI) * 0.018;
        tmp.x += (Math.random() - 0.5) * j; tmp.y += (Math.random() - 0.5) * j; tmp.z += (Math.random() - 0.5) * j * 0.4;
        pts.push(tmp.clone());
      }
      for (const [wmul, c] of [[3.5, [0.25, 0.45, 1.0]], [1, [0.95, 0.97, 1.0]]]) {
        for (let i = 0; i < this.seg; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const w = a.width * wmul;
          const pv = [p0.x - w, p0.y, p0.z, p1.x - w, p1.y, p1.z, p1.x + w, p1.y + w, p1.z, p0.x - w, p0.y, p0.z, p1.x + w, p1.y + w, p1.z, p0.x + w, p0.y + w, p0.z];
          for (let q = 0; q < 6; q++) {
            if (k >= this.pos.length / 3) break;
            this.pos[k * 3] = pv[q * 3]; this.pos[k * 3 + 1] = pv[q * 3 + 1]; this.pos[k * 3 + 2] = pv[q * 3 + 2];
            this.col[k * 3] = c[0] * I; this.col[k * 3 + 1] = c[1] * I; this.col[k * 3 + 2] = c[2] * I; k++;
          }
        }
      }
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ FX
export class FX {
  constructor(scene, renderer, G) {
    this.scene = scene; this.G = G;
    this.blood = new BloodMap();
    // 핏방울
    this.dropMax = 600;
    this.dropMat = new THREE.MeshStandardMaterial({ color: 0x5a0303, roughness: 0.12, metalness: 0 });
    this.dropIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.dropMat, this.dropMax);
    this.dropIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.dropIM.frustumCulled = false; this.dropIM.count = 0;
    scene.add(this.dropIM);
    this.drops = [];
    // 살점·뼈 조각
    this.meatGeos = [rockGeo(11, 1), rockGeo(12, 1), rockGeo(13, 1)];
    this.meatMat = new THREE.MeshStandardMaterial({ color: 0x7a1410, roughness: 0.22, metalness: 0 });
    this.fatMat = new THREE.MeshStandardMaterial({ color: 0xd9b07a, roughness: 0.35 });
    this.boneMat = new THREE.MeshStandardMaterial({ color: 0xece2cb, roughness: 0.5 });
    this.skinBitMat = new THREE.MeshStandardMaterial({ color: 0xe0ab90, roughness: 0.5, side: THREE.DoubleSide });
    this.nailMat = new THREE.MeshStandardMaterial({ color: 0xf0d8cf, roughness: 0.3, side: THREE.DoubleSide });
    this.boneGeo = (() => { const g = new THREE.TetrahedronGeometry(1, 0); g.scale(0.6, 1.6, 0.6); return g; })();
    this.nailGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 0.12, 12, 1, true, -0.9, 1.8); g.rotateZ(Math.PI / 2); g.scale(0.6, 1, 1); return g; })();
    this.flying = [];          // 날아가는 살점·뼛조각·부품(메시)
    this.stuckGroup = new THREE.Group(); scene.add(this.stuckGroup);
    this.stuckList = [];
    // 입자
    this.smoke = new Puffs(160, { color: 0xbdb5ad, size: 0.03, opacity: 0.35 }); scene.add(this.smoke.obj);
    this.steam = new Puffs(120, { color: 0xffffff, size: 0.025, opacity: 0.25 }); scene.add(this.steam.obj);
    this.sparkP = new Puffs(200, { color: 0xffd28a, size: 0.004, additive: true, opacity: 1 }); scene.add(this.sparkP.obj);
    this.sparkB = new Puffs(200, { color: 0x9fd8ff, size: 0.005, additive: true, opacity: 1 }); scene.add(this.sparkB.obj);
    this.bubbleP = new Puffs(150, { color: 0xeaffd8, size: 0.005, opacity: 0.8 }); scene.add(this.bubbleP.obj);
    this.frost = new Puffs(150, { color: 0xf2f8ff, size: 0.012, opacity: 0.6 }); scene.add(this.frost.obj);
    // 벽에 맞는 순간 터지는 먼지·부스러기(색은 벽마다)
    this.dust = new Puffs(160, { color: 0xe4ded3, size: 0.014, opacity: 0.4 }); scene.add(this.dust.obj);
    this.grit = new Puffs(200, { color: 0x77716a, size: 0.003, opacity: 0.95 }); scene.add(this.grit.obj);
    this.dust.obj.renderOrder = 5; this.grit.obj.renderOrder = 5;
    this.ambient = [];
    this.wall = null;
    this.armRefs = null;
  }
  // 벽에 꽂힌 고철 부품은 개수 제한(오래된 것부터 치움) — 계속 쌓이면 무거워짐
  capStuck(list, obj, max) {
    list.push(obj);
    while (list.length > max) { const o = list.shift(); if (o.parent) o.parent.remove(o); }
  }
  bindWall(wall) {
    // 이전 벽의 피·살점 저장 → 새 벽 불러오기
    if (this.wall) this.saveWall(this.wall.def.id);
    this.wall = wall;
    const dc = DUST[wall.def.id];
    if (dc) { this.dust.mat.uniforms.uColor.value.set(dc.dust); this.grit.mat.uniforms.uColor.value.set(dc.grit); }
    this.stuckScrap = [];
    this.blood.load((this.G.decals || {})[wall.def.id]);
    this.loadStuck((this.G.stuck || {})[wall.def.id]);
  }
  saveWall(id) {
    this.G.decals = this.G.decals || {}; this.G.stuck = this.G.stuck || {};
    this.G.decals[id] = this.blood.ops.slice(-1600);
    this.G.stuck[id] = this.stuckList.slice(-140);
  }
  persist() { if (this.wall) this.saveWall(this.wall.def.id); }

  // 타격 연출
  impact(arm, c, power, res, W, react) {
    const wallZ = this.wall.surfaceZ();
    const flesh = arm.I < 0.5 ? arm.I : 0.5 + (arm.I - 0.5) * 0.6;
    const openN = arm.wounds.filter((w) => (w.type === 3 || w.type === 1 || w.type === 2 || w.type === 4) && w.k > 0.3).length;
    let blood = clamp(flesh * 3.0 + openN * 0.08 + (W.id === 'nails' || W.id === 'glass' || W.id === 'spikes' ? 0.25 : 0), 0, 1.6);
    if (W.id === 'hotplate') blood *= 0.5;
    const scrapHit = res.scrap > 0;
    if (scrapHit) {
      this.sparks(c, 10 + Math.floor(power * 8), 0xffd28a);
      blood *= 0.35;
    }
    const cx = c.x, cy = c.y;
    const fistPrint = !scrapHit && arm.I < 0.5 && arm.crushZ > 0.09;   // 주먹 모양이 남아 있을 때만 너클 자국
    // 살 주먹은 첫 대부터 옅은 너클 자국(살갗이 쓸린 자리)이 남고 칠수록 진해짐
    if (blood > 0.12 || (fistPrint && W.id !== 'slime' && W.id !== 'spikes')) {
      // 타격면 핏자국
      // 살 주먹이면 너클 자국(가로로 눕힘, 팔 쪽으로 살짝 기울임), 아니면 그냥 튄 피
      const tilt = (arm.side === 'L' ? -1 : 1) * rnd(0.05, 0.3);
      this.blood.splat(cx + rnd(-0.008, 0.008), cy + rnd(-0.008, 0.008), (fistPrint ? 0.03 : 0.012) + blood * (fistPrint ? 0.012 : 0.022), { dark: Math.random() * 0.3, knuckle: fistPrint, rot: fistPrint ? tilt : undefined, alpha: fistPrint ? clamp(0.22 + blood * 1.6, 0.22, 0.95) : clamp(0.3 + blood * 0.9, 0.3, 0.95) });
      // 흘러내림: 언 벽은 짧게 얼어붙고, 달군 철판은 지글지글 말라 버림
      const dripK = W.id === 'freezer' ? 0.22 : W.id === 'hotplate' ? 0.12 : W.id === 'slime' ? 0 : 1;
      if (dripK && blood > 0.6 && Math.random() < 0.45) this.blood.drip(cx + rnd(-0.02, 0.02), cy - rnd(0.0, 0.015), rnd(0.05, 0.22) * dripK, rnd(0.002, 0.0045));
    }
    // 핏방울
    const n = Math.floor(blood * 34 + (blood > 0.2 ? 6 : 0));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const sp = rnd(0.4, 2.6) * (0.6 + blood * 0.4);
      this.spawnDrop(cx + rnd(-0.01, 0.01), cy + rnd(-0.01, 0.01), wallZ + rnd(0.01, 0.04),
        Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + rnd(-0.2, 0.8), rnd(-0.3, 0.6) * (Math.random() < 0.2 ? 2.2 : 1), rnd(0.0007, 0.0028) * (0.7 + blood * 0.4));
    }
    // 살점·뼛조각
    if (!scrapHit && arm.I > 0.18) {
      const m = Math.floor(rnd(0, 1.5 + flesh * 6));
      for (let i = 0; i < m; i++) this.chunk(c, wallZ, Math.random() < 0.82 ? 'meat' : (Math.random() < 0.5 ? 'fat' : 'skin'), rnd(0.002, 0.005) * (1 + flesh));
      if (res.ev.some((e) => e.t === 'fract' || e.t === 'mfract') || (arm.I > 0.35 && Math.random() < 0.35)) for (let i = 0; i < 2; i++) this.chunk(c, wallZ, 'bone', rnd(0.0018, 0.004));
    }
    // 벽 성격별
    if (W.id === 'hotplate') this.smokeBurst(c, 1 + power * 0.5);
    if (W.id === 'gravel' && arm.I < 0.5) for (let i = 0; i < 3; i++) this.chunk(c, wallZ, 'skin', rnd(0.0015, 0.003));
  }

  // 벽에 닿는 순간: 먼지가 확 퍼지고 부스러기가 튐 (feel: 타격 세기 0.6~1.9)
  impactDust(c, wallId, feel, who) {
    const d = DUST[wallId];
    if (!d) return;
    const k = Math.min(1.5, feel);
    const z = (d.atFist ? c.z : this.wall.surfaceZ()) + 0.004;
    const nD = Math.round(d.n * 1.5 * (0.75 + 0.35 * k) * (who === 'scrap' ? 1.3 : 1));
    for (let i = 0; i < nD; i++) {
      // 주먹 그림자에 가리지 않게 벽면을 따라 빠르게 고리처럼 퍼지고, 몇 개는 천천히 피어올라 좀 더 남음
      const slow = i % 4 === 0;
      const a = (i / nD) * Math.PI * 2 + rnd(-0.3, 0.3), sp = (slow ? rnd(0.15, 0.4) : rnd(0.8, 2.1)) * (0.8 + 0.3 * k);
      this.dust.emit({ x: c.x + rnd(-0.012, 0.012), y: c.y + rnd(-0.01, 0.01), z: z + rnd(0, 0.01),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75 + rnd(-0.03, 0.12), vz: slow ? rnd(0.15, 0.45) : rnd(0.03, 0.25),
        drag: 0.0009, g: -0.25, life: slow ? rnd(0.65, 1.0) : rnd(0.3, 0.55), size: rnd(0.016, 0.03) * d.size, grow: slow ? 2.8 : 3.4, a: d.alpha * rnd(0.8, 1), pop: 1 });
    }
    const nG = Math.round(d.g * (0.7 + 0.4 * k));
    for (let i = 0; i < nG; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.45, 1.5) * (0.85 + 0.25 * k);
      this.grit.emit({ x: c.x + rnd(-0.008, 0.008), y: c.y + rnd(-0.006, 0.006), z: z + 0.002,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 + rnd(0.1, 0.6), vz: rnd(0.15, 0.9),
        drag: 0.35, g: -7.5, life: rnd(0.3, 0.6), size: rnd(0.0018, 0.0036) * d.gs, grow: 1, a: 0.95, pop: 1 });
    }
  }

  spawnDrop(x, y, z, vx, vy, vz, r) {
    if (this.drops.length >= this.dropMax) this.drops.shift();
    this.drops.push({ x, y, z, vx, vy, vz, r, t: 0 });
  }

  chunk(c, wallZ, kind, size) {
    const mat = { meat: this.meatMat, fat: this.fatMat, bone: this.boneMat, skin: this.skinBitMat }[kind];
    const geo = kind === 'bone' ? this.boneGeo : kind === 'skin' ? this.nailGeo : this.meatGeos[Math.floor(Math.random() * 3)];
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(size * rnd(0.8, 1.4), size * rnd(0.6, 1.1), size * rnd(0.6, 1.2));
    m.position.set(c.x + rnd(-0.01, 0.01), c.y + rnd(-0.01, 0.01), wallZ + 0.01);
    m.castShadow = true;
    this.scene.add(m);
    const stick = Math.random() < (kind === 'bone' ? 0.25 : 0.55);
    this.flying.push({ m, v: new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.4, 1.6), stick ? rnd(-0.6, -0.1) : rnd(0.2, 0.9)), w: new THREE.Vector3(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)), t: 0, kind, stick, size });
  }

  // 벽에 붙어 남는 살점(저장)
  stickChunk(p, size, kind = 'meat', rot = null) {
    const rec = { k: kind, p: [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)], s: +size.toFixed(4), r: rot || [rnd(0, 6), rnd(0, 6), rnd(0, 6)].map((v) => +v.toFixed(2)) };
    this.addStuckMesh(rec);
    this.stuckList.push(rec);
    if (this.stuckList.length > 140) { this.stuckList.shift(); const o = this.stuckGroup.children[0]; if (o) this.stuckGroup.remove(o); }
  }
  addStuckMesh(rec) {
    const mat = { meat: this.meatMat, fat: this.fatMat, bone: this.boneMat, skin: this.skinBitMat, nail: this.nailMat }[rec.k] || this.meatMat;
    const geo = rec.k === 'bone' ? this.boneGeo : (rec.k === 'skin' || rec.k === 'nail') ? this.nailGeo : this.meatGeos[Math.abs(Math.floor(rec.p[0] * 1000)) % 3];
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(rec.p); m.rotation.set(rec.r[0], rec.r[1], rec.r[2]);
    m.scale.set(rec.s * 1.2, rec.s, rec.s * 0.55);
    m.castShadow = true;
    this.stuckGroup.add(m);
  }
  loadStuck(list) {
    this.stuckGroup.clear(); this.stuckList = (list || []).slice();
    for (const r of this.stuckList) this.addStuckMesh(r);
  }

  smear(c, size) { this.blood.smear(c.x, c.y, size, rnd(-2.2, -0.9)); }
  skinPatch(c) { for (let i = 0; i < 2; i++) this.blood.skin(c.x + rnd(-0.015, 0.015), c.y + rnd(-0.012, 0.012), rnd(0.006, 0.012)); }

  tearBits(arm, wall, n) {
    const c = this.lastContact || new THREE.Vector3();
    for (let i = 0; i < n; i++) this.spawnDrop(c.x, c.y, wall.surfaceZ() + 0.03, rnd(-0.6, 0.6), rnd(-0.3, 0.6), rnd(0, 0.5), rnd(0.0008, 0.002));
  }

  // 짓이겨진 앞면에서 살점·뼛조각·찢긴 살가죽이 튀고 피가 뿜어짐 (c: 벽에 닿은 자리, k: 양)
  mash(c, k = 1) {
    const wallZ = this.wall.surfaceZ();
    const n = Math.round(rnd(2, 4) * k);
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const kind = r < 0.55 ? 'meat' : r < 0.75 ? 'bone' : r < 0.9 ? 'skin' : 'fat';
      this.chunk(c, wallZ, kind, (kind === 'bone' ? rnd(0.0022, 0.0045) : rnd(0.0028, 0.0065)) * (0.85 + k * 0.15));
    }
    const nd = Math.round(18 * k);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 2.4);
      this.spawnDrop(c.x + rnd(-0.012, 0.012), c.y + rnd(-0.01, 0.01), wallZ + rnd(0.01, 0.03), Math.cos(a) * sp, Math.sin(a) * sp * 0.8 + rnd(-0.1, 0.7), rnd(-0.2, 0.7), rnd(0.0008, 0.0026));
    }
    this.blood.splat(c.x + rnd(-0.006, 0.006), c.y + rnd(-0.006, 0.006), 0.022 + 0.012 * k, { dark: Math.random() * 0.4, alpha: 0.95 });
    if (k > 0.9 && Math.random() < 0.7 && this.wall.def.id !== 'slime') this.blood.drip(c.x + rnd(-0.015, 0.015), c.y - rnd(0, 0.01), rnd(0.08, 0.22) * (this.wall.def.id === 'freezer' ? 0.25 : 1), rnd(0.0025, 0.005));
  }
  // 살을 뚫고 나온 뼈 자리에서 피가 찍 (p: 월드 좌표)
  spurt(p, n = 12) {
    for (let i = 0; i < n; i++) this.spawnDrop(p.x, p.y, p.z, rnd(-0.5, 0.5), rnd(0.2, 1.4), rnd(-0.6, 0.2), rnd(0.0007, 0.0018));
  }
  dropObject(obj, arm) {
    // 팔에 붙어 있던 물건을 떨어뜨림(쥐덫 등)
    const holder = new THREE.Group();
    obj.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    obj.matrixWorld.decompose(p, q, s);
    holder.position.copy(p); holder.quaternion.copy(q);
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.scale.set(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    holder.add(obj); this.scene.add(holder);
    this.flying.push({ m: holder, v: new THREE.Vector3(rnd(-0.3, 0.3), rnd(0, 0.5), rnd(0, 0.3)), w: new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)), t: 0, kind: 'obj', stick: false, size: 0.05 });
  }
  // 고철 부품이 떨어져 나감(벽에 박히기도)
  flyScrapPart(obj, embed) {
    obj.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    obj.matrixWorld.decompose(p, q, s);
    const holder = new THREE.Group(); holder.position.copy(p); holder.quaternion.copy(q);
    obj.parent && obj.parent.remove(obj);
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.scale.set(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    holder.add(obj); this.scene.add(holder);
    this.flying.push({ m: holder, v: new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.2, 1.3), embed ? -1.5 : rnd(-0.25, 0.35)), w: new THREE.Vector3(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25)), t: 0, kind: 'scrap', stick: embed, size: 0.01, scrapObj: obj });
  }

  sparks(c, n, color) {
    const P = color === 0x9fd8ff ? this.sparkB : this.sparkP;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.8, 3.2);
      P.emit({ x: c.x, y: c.y, z: c.z + 0.01, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 + 0.6, vz: rnd(0.2, 1.4), g: -7, drag: 0.4, life: rnd(0.12, 0.4), size: rnd(0.003, 0.006), a: 1 });
    }
  }
  smokeBurst(c, k) {
    for (let i = 0; i < 10 * k; i++) this.smoke.emit({ x: c.x + rnd(-0.03, 0.03), y: c.y + rnd(-0.02, 0.03), z: c.z + rnd(0.01, 0.05), vx: rnd(-0.05, 0.05), vy: rnd(0.12, 0.32), vz: rnd(0.0, 0.08), drag: 0.6, life: rnd(0.9, 1.8), size: rnd(0.018, 0.035), grow: 3.0, a: 0.22 });
  }
  bubbles(c, n) {
    for (let i = 0; i < n; i++) this.bubbleP.emit({ x: c.x + rnd(-0.03, 0.03), y: c.y + rnd(-0.03, 0.02), z: c.z + rnd(-0.01, 0.01), vx: rnd(-0.02, 0.02), vy: rnd(0.02, 0.08), vz: 0, life: rnd(0.8, 2.0), size: rnd(0.003, 0.008), a: 0.8 });
  }
  frostPuff(arm, n) {
    const c = this.lastContact || new THREE.Vector3();
    for (let i = 0; i < n; i++) this.frost.emit({ x: c.x + rnd(-0.03, 0.03), y: c.y + rnd(-0.02, 0.02), z: c.z + rnd(0.0, 0.03), vx: rnd(-0.2, 0.2), vy: rnd(-0.1, 0.2), vz: rnd(0.05, 0.3), drag: 0.3, life: rnd(0.5, 1.2), size: rnd(0.006, 0.016), grow: 2, a: 0.7 });
  }
  makeMist(color, k) {
    const P = new Puffs(90, { color, size: 0.08, opacity: 0.18 });
    const self = this;
    return {
      obj: P.obj, update(dt) {
        if (Math.random() < dt * 14) P.emit({ x: rnd(-0.5, 0.5), y: rnd(-0.75, -0.3), z: rnd(-0.6, -0.45), vx: rnd(-0.02, 0.02), vy: rnd(0.02, 0.06), vz: rnd(0, 0.02), life: rnd(3, 6), size: rnd(0.06, 0.12), grow: 1.8, a: 0.16, drag: 0.9 });
        P.update(dt);
      },
    };
  }
  makeSmoke(color) {
    const P = new Puffs(120, { color, size: 0.05, opacity: 0.2 });
    let boost = 0;
    return {
      obj: P.obj, boost(k) { boost = Math.max(boost, k); },
      update(dt) {
        boost = Math.max(0, boost - dt * 0.6);
        if (Math.random() < dt * (3 + boost * 22)) P.emit({ x: rnd(-0.18, 0.18), y: rnd(-0.2, 0.08), z: -0.6 + rnd(0.0, 0.03), vx: rnd(-0.01, 0.01), vy: rnd(0.06, 0.14), vz: rnd(0.0, 0.02), life: rnd(1.8, 3.2), size: rnd(0.03, 0.055), grow: 2.5, a: 0.07 + boost * 0.06, drag: 0.9 });
        P.update(dt);
      },
    };
  }
  makeArcs() { const A = new Arcs(); return { obj: A.obj, burst: (c, n, D) => A.burst(c, n, D), idle: (D) => A.idle(D), update: (dt) => A.update(dt) }; }

  // ------------------------------------------------ 매 프레임
  // rdt: 실제 시간 — 먼지·부스러기는 멈춤(히트스톱) 중에도 터져 나감
  update(dt, time, rdt = dt) {
    SHARED.uTime.value = time;
    const wallZ = this.wall ? this.wall.surfaceZ() : -0.62;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), dir = new THREE.Vector3();
    let k = 0;
    const alive = [];
    for (const d of this.drops) {
      d.t += dt; d.vy -= 9.8 * dt; d.vx *= 0.995; d.vz *= 0.995;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.z <= wallZ) {
        // 벽에 닿음 → 점
        if (Math.random() < 0.85) this.blood.drop(d.x, d.y, d.r * rnd(0.8, 1.6));
        continue;
      }
      if (d.y < -0.9 || d.t > 3 || d.z > 0.2) continue;
      alive.push(d);
      p.set(d.x, d.y, d.z);
      dir.set(d.vx, d.vy, d.vz); const sp = dir.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      const st = 1 + Math.min(3, sp * 0.6);
      s.set(d.r, d.r * st, d.r);
      m.compose(p, q, s);
      if (k < this.dropMax) this.dropIM.setMatrixAt(k++, m);
    }
    this.drops = alive;
    this.dropIM.count = k; this.dropIM.instanceMatrix.needsUpdate = true;
    // 날아가는 덩어리
    const keep = [];
    for (const f of this.flying) {
      f.t += dt;
      f.v.y -= 9.8 * dt;
      f.m.position.addScaledVector(f.v, dt);
      f.m.rotation.x += f.w.x * dt; f.m.rotation.y += f.w.y * dt; f.m.rotation.z += f.w.z * dt;
      if (f.stick && f.m.position.z <= wallZ + f.size * 0.4) {
        // 벽에 붙음
        if (f.kind === 'scrap') {
          f.m.position.z = wallZ + rnd(-0.002, 0.004);
          this.wall.group.attach(f.m);
          this.capStuck(this.stuckScrap, f.m, 40);
          continue;
        }
        // 슬라임 벽: 살점·뼛조각이 슬라임 속에 떠 있음
        if (this.wall && this.wall.addFloater) { this.scene.remove(f.m); f.m.castShadow = false; this.wall.addFloater(f.m); continue; }
        this.scene.remove(f.m);
        this.stickChunk(new THREE.Vector3(f.m.position.x, f.m.position.y, wallZ + f.size * 0.3), f.size, f.kind === 'nail' ? 'nail' : f.kind, [f.m.rotation.x, f.m.rotation.y, f.m.rotation.z]);
        this.blood.drop(f.m.position.x, f.m.position.y, f.size * 0.9);
        continue;
      }
      if (f.m.position.y < -0.95 || f.t > 4) { this.scene.remove(f.m); continue; }
      keep.push(f);
    }
    this.flying = keep;
    this.blood.update(dt, time);
    this.smoke.update(dt); this.steam.update(dt); this.sparkP.update(dt); this.sparkB.update(dt); this.bubbleP.update(dt); this.frost.update(dt);
    this.dust.update(rdt); this.grit.update(rdt);
  }
}
