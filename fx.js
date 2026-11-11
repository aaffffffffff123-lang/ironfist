// 철권 — 효과: 피 지도(벽에 묻는 피), 핏방울, 살점·뼛조각·찢긴 살가죽, 연기·김·거품·불꽃·전기
import * as THREE from 'three';
import { SHARED, rockGeo, OLD_FIST_AT } from './walls.js';

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
    } else if (t === 'o') {
      this.drawOld(op);
    }
    x.restore();
    this.dirty = true;
  }
  // 먼저 다녀간 사람들의 자국: 오래 말라붙어 갈색으로 바랜 피, 얼어붙은 남의 살가죽
  // ['o', 종류(0 자국 1 흘러내림 2 살가죽 3 끌린 자국), x, y, 크기, 모양(그림 번호·굵기), 각도, 세월(0~1), 짙기(1~)]
  // 짙기: 나무·달군 철판처럼 마른 피가 묻혀 안 보이는 바탕에서 더 짙고 검게
  drawOld(op) {
    const [, sub, wx, wy, size, v, rot, age, boost = 1] = op;
    const x = this.ctx;
    const k = BM_SIZE / this.rect.z;
    const [px, py] = this.px(wx, wy);
    const dk = 1 - (boost - 1) * 0.7;
    const r = Math.round((70 + age * 10) * dk), g = Math.round((30 + age * 28) * dk), b = Math.round((21 + age * 22) * dk);
    const a = Math.min(1, (0.82 - age * 0.4) * boost);
    x.save();
    if (sub === 0) {
      const t = this.oldTmp || (this.oldTmp = document.createElement('canvas'));
      t.width = t.height = 256;
      const c = t.getContext('2d');
      c.drawImage(this.sprites[v], 0, 0);
      // 그림의 짙고 옅은 결은 남기고 색만 마른 피로
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = `rgba(${r},${g},${b},0.86)`; c.fillRect(0, 0, 256, 256);
      const s = size * k;
      x.translate(px, py); x.rotate(rot); x.globalAlpha = a;
      // 아주 짙게(달군 철판): 두 번 찍어 빈틈 없이 눌어붙은 딱지로
      for (let i = boost >= 1.5 ? 2 : 1; i > 0; i--) x.drawImage(t, -s, -s, s * 2, s * 2);
    } else if (sub === 1) {
      const L = size * k, Wd = Math.max(1.2, v * k);
      x.globalAlpha = a * 0.9;
      x.fillStyle = `rgb(${r - 6},${g - 4},${b - 3})`;
      x.beginPath(); x.moveTo(px - Wd / 2, py); x.lineTo(px + Wd / 2, py);
      x.quadraticCurveTo(px + Wd * 0.5 + rot * L * 0.06, py + L * 0.5, px + Wd * 0.3, py + L);
      x.arc(px, py + L, Wd * 0.62, 0, Math.PI);
      x.quadraticCurveTo(px - Wd * 0.5 + rot * L * 0.06, py + L * 0.5, px - Wd / 2, py);
      x.closePath(); x.fill();
    } else if (sub === 2) {
      const s = size * k;
      x.translate(px, py); x.rotate(rot);
      x.globalAlpha = 0.9 - age * 0.25;
      x.fillStyle = `rgb(${Math.round(196 - age * 30)},${Math.round(170 - age * 26)},${Math.round(158 - age * 20)})`;
      x.beginPath();
      for (let i = 0; i <= 12; i++) { const an = (i / 12) * Math.PI * 2; const rr = s * (0.7 + Math.sin(i * 2.7 + rot * 9) * 0.25); i ? x.lineTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.7) : x.moveTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.7); }
      x.fill();
      x.fillStyle = `rgba(${r},${g},${b},0.85)`; x.beginPath(); x.arc(s * 0.1, 0, s * 0.3, 0, 7); x.fill();
    } else if (sub === 3) {
      // 주먹을 댄 채 아래로 끌려 내려간 자국(너클 줄무늬)
      const L = size * k, Wd = v * k;
      x.translate(px, py); x.rotate(rot);
      const gr = x.createLinearGradient(0, 0, L, 0);
      gr.addColorStop(0, `rgba(${r},${g},${b},${a})`); gr.addColorStop(0.65, `rgba(${r},${g},${b},${a * 0.6})`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr;
      for (let i = 0; i < 4; i++) { const yy = (i / 3 - 0.5) * Wd; x.fillRect(0, yy - Wd * 0.09, L * (0.75 + 0.25 * Math.sin(i * 2.3 + rot)), Wd * 0.17); }
    }
    x.restore();
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
  // old: 먼저 다녀간 사람들의 자국 — 맨 밑에 깔고, 내 피 기록과 따로 둬서 오래 쳐도 지워지지 않음
  load(ops, old) {
    this.clear();
    for (const op of old || []) this.drawOp(op);
    this.ops = (ops || []).slice();
    for (const op of this.ops) this.drawOp(op, true);
    this.dirty = true;
  }
}

// 새로 연 벽에 처음부터 있는 남의 자국(벽 좌표). 첫 벽(시멘트)에는 없음
export function makeOldMarks(id) {
  const ops = [];
  const R = Math.random, f4 = (v) => +v.toFixed(4), f2 = (v) => +v.toFixed(2);
  const dripK = id === 'freezer' ? 0.3 : id === 'hotplate' ? 0.22 : 1;
  const boost = id === 'nails' ? 1.35 : id === 'hotplate' ? 1.8 : 1;
  // 다녀간 사람마다 선 자리·키·어깨너비가 달라 주먹 자리가 조금씩 다름. 앞사람일수록 오래돼 바램
  const people = 3 + Math.floor(R() * 3);
  for (let n = 0; n < people; n++) {
    const cx = rnd(-0.025, 0.025), h = rnd(-0.17, 0.08), sp = rnd(0.036, 0.085);
    const age = clamp(0.95 - 0.75 * (n + 1) / people + rnd(-0.08, 0.12), 0.12, 1);
    for (const sg of [-1, 1]) {
      const m = 1 + Math.floor(R() * 2.4);
      for (let i = 0; i < m; i++) {
        ops.push(['o', 0, f4(cx + sg * sp + rnd(-0.014, 0.014)), f4(h + rnd(-0.014, 0.014)), f4(rnd(0.03, 0.046)), Math.floor(R() * 6), f2(sg * rnd(0.05, 0.35)), f2(clamp(age + rnd(-0.1, 0.1), 0, 1)), boost]);
      }
      if (R() < 0.55) ops.push(['o', 0, f4(cx + sg * sp + rnd(-0.04, 0.04)), f4(h + rnd(-0.035, 0.035)), f4(rnd(0.012, 0.024)), 6 + Math.floor(R() * 4), f2(rnd(0, 6.28)), f2(age), boost]);
      if (dripK && R() < 0.6) ops.push(['o', 1, f4(cx + sg * sp + rnd(-0.016, 0.016)), f4(h - rnd(0.004, 0.014)), f4(rnd(0.05, 0.2) * dripK), f4(rnd(0.0022, 0.0042)), f2(rnd(-1, 1)), f2(age), boost]);
    }
  }
  // 한 사람은 주먹을 벽에 댄 채 주저앉음
  if (dripK === 1 && id !== 'spikes' && R() < 0.85) {
    const sg = R() < 0.5 ? -1 : 1;
    ops.push(['o', 3, f4(sg * rnd(0.04, 0.07)), f4(rnd(-0.08, 0.0)), f4(rnd(0.12, 0.22)), f4(rnd(0.022, 0.03)), f2(Math.PI / 2 + rnd(-0.12, 0.12)), f2(rnd(0.25, 0.7)), boost]);
  }
  // 냉동창고: 뜯겨 얼어붙은 남의 살가죽
  if (id === 'freezer') for (let i = 0; i < 6; i++) ops.push(['o', 2, f4(rnd(-0.11, 0.11)), f4(rnd(-0.15, 0.06)), f4(rnd(0.006, 0.013)), 0, f2(rnd(0, 6.28)), f2(R())]);
  // 가시벽: 꿰인 채 남은 고철 주먹 밑으로 말라붙은 피
  if (id === 'spikes') {
    const P = OLD_FIST_AT;
    ops.push(['o', 0, f4(P.x + rnd(-0.01, 0.01)), f4(P.y - 0.02), 0.03, 6 + Math.floor(R() * 4), f2(rnd(0, 6.28)), 0.7]);
    ops.push(['o', 1, f4(P.x + 0.004), f4(P.y - 0.03), 0.16, 0.0035, 0.4, 0.75]);
    ops.push(['o', 1, f4(P.x - 0.012), f4(P.y - 0.026), 0.09, 0.0026, -0.5, 0.8]);
  }
  return ops;
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
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aD', new THREE.BufferAttribute(this.data, 2).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
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
    this.obj = new THREE.Points(g, this.mat); this.obj.frustumCulled = false; this.obj.renderOrder = 4; this.obj.visible = false;
    this.p = []; this.baseSize = size; this.baseOpacity = opacity;
  }
  emit(o) { if (this.p.length >= this.max) this.p.shift(); this.p.push(Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, t: 0, size: this.baseSize, grow: 1, g: 0, drag: 1, a: this.baseOpacity }, o)); }
  update(dt) {
    const n = this.p.length;
    if (!n) { this.obj.visible = false; return; }
    let alive = 0;
    for (let i = 0; i < n; i++) {
      const q = this.p[i]; q.t += dt;
      q.vy += q.g * dt; const dr = Math.pow(q.drag, dt);
      q.vx *= dr; q.vy *= dr; q.vz *= dr;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.t < q.life) this.p[alive++] = q;
    }
    this.p.length = alive;
    const m = this.p.length;
    this.obj.visible = m > 0;
    this.obj.geometry.setDrawRange(0, m);
    if (!m) return;
    for (let i = 0; i < m; i++) {
        const q = this.p[i]; const k = q.t / q.life;
        this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
        this.data[i * 2] = q.size * (1 + (q.grow - 1) * k) * 900;
        // pop: 터지듯 바로 진하게 나타났다 사라짐(먼지·부스러기), 아니면 서서히 피었다 사라짐(연기·김)
        this.data[i * 2 + 1] = q.a * (q.pop ? Math.min(1, k / 0.05) * Math.pow(1 - k, 1.7) : Math.sin(Math.min(1, k * 1.0 + 0.05) * Math.PI) * (1 - k * 0.3));
    }
    for (const [attr, count] of [[this.obj.geometry.attributes.position, m * 3], [this.obj.geometry.attributes.aD, m * 2]]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(0, count); attr.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ 달군 철판에 눌어붙은 살: 익다가 타 들어감
// 붙자마자 치익 하고 김이 확 오르고, 몇 초면 겉이 허옇게 익고, 스무 초 남짓 노릇노릇,
// 반 분이 넘으면 까맣게 타며 연기가 짙어짐. 기름이 튀며 타닥거리고 다 탄 뒤엔 조용해짐
const COOK = { done: 6, brown: 20, char: 44, ash: 72 };   // 붙은 뒤 초
function cookK(c) {
  if (c <= COOK.done) return 0.22 * (c / COOK.done);
  if (c <= COOK.brown) return 0.22 + 0.28 * (c - COOK.done) / (COOK.brown - COOK.done);
  if (c <= COOK.char) return 0.5 + 0.36 * (c - COOK.brown) / (COOK.char - COOK.brown);
  return Math.min(1, 0.86 + 0.14 * (c - COOK.char) / (COOK.ash - COOK.char));
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
// 날것 → 익음 → 노릇(갈색) — 종류마다(탄 색은 다 같음)
const GRILL_COL = {
  meat: [SRGB(0.48, 0.07, 0.05), SRGB(0.62, 0.47, 0.42), SRGB(0.38, 0.17, 0.07)],
  fat: [SRGB(0.86, 0.70, 0.50), SRGB(0.93, 0.85, 0.68), SRGB(0.68, 0.40, 0.13)],
  skin: [SRGB(0.88, 0.67, 0.56), SRGB(0.84, 0.66, 0.55), SRGB(0.55, 0.29, 0.12)],
  bone: [SRGB(0.92, 0.88, 0.79), SRGB(0.90, 0.85, 0.74), SRGB(0.64, 0.47, 0.30)],
  nail: [SRGB(0.94, 0.85, 0.80), SRGB(0.90, 0.80, 0.70), SRGB(0.56, 0.38, 0.22)],
};
GRILL_COL.patch = GRILL_COL.skin; GRILL_COL.meatpatch = GRILL_COL.meat;
function grillMaterial(kind) {
  const [raw, done, brown] = GRILL_COL[kind] || GRILL_COL.meat;
  const U = { uCook: { value: 0 }, uRaw: { value: raw }, uDone: { value: done }, uBrown: { value: brown }, uSeed: { value: Math.random() * 10 }, uFl: { value: 1 } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 });
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGL = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGL; uniform float uCook; uniform vec3 uRaw; uniform vec3 uDone; uniform vec3 uBrown; uniform float uSeed; uniform float uFl;
      float gh(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float gn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(gh(i),gh(i+vec3(1,0,0)),f.x), mix(gh(i+vec3(0,1,0)),gh(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(gh(i+vec3(0,0,1)),gh(i+vec3(1,0,1)),f.x), mix(gh(i+vec3(0,1,1)),gh(i+vec3(1,1,1)),f.x),f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 얇은 가장자리부터 먼저 익고 타며, 군데군데 얼룩지게
        float nz = gn(vGL * 2.7 + uSeed) * 0.6 + gn(vGL * 7.3 + uSeed * 2.0) * 0.4;
        float gc = uCook + (nz - 0.5) * 0.24 + clamp(length(vGL.xy) - 0.55, 0.0, 0.5) * 0.25;
        vec3 chr = vec3(0.032, 0.024, 0.02);
        vec3 gcol = mix(uRaw, uDone, smoothstep(0.0, 0.22, gc));
        gcol = mix(gcol, uBrown, smoothstep(0.2, 0.52, gc));
        gcol = mix(gcol, chr, smoothstep(0.5, 0.88, gc));
        // 다 탄 겉은 쩍쩍 갈라짐
        float crk = smoothstep(0.62, 0.92, gc) * (1.0 - smoothstep(0.0, 0.07, abs(gn(vGL * 8.5 + uSeed) - 0.5)));
        gcol = mix(gcol, chr * 0.4, crk * 0.7);
        diffuseColor.rgb = gcol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.18, 0.6, smoothstep(0.0, 0.24, gc));
        roughnessFactor = mix(roughnessFactor, 0.34, smoothstep(0.24, 0.5, gc) * (1.0 - smoothstep(0.5, 0.78, gc)));
        roughnessFactor = mix(roughnessFactor, 0.96, smoothstep(0.55, 0.86, gc));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // 타는 동안 갈라진 틈이 철판 열에 빨갛게 비침(다 타면 사그라듦)
        totalEmissiveRadiance += vec3(1.0, 0.26, 0.035) * crk * 1.4 * uFl * (1.0 - smoothstep(0.93, 1.0, uCook));`);
  };
  m.customProgramCacheKey = () => 'cg-grill-1';
  return m;
}
// 철판에 눌어붙은 얇은 살갗·살 조각(바닥은 납작, 가운데가 살짝 솟음, 테두리는 들쭉날쭉)
function patchGeometry() {
  const N = 18, pos = [0, 0, 0.32], idx = [];
  const R = (k) => { const x = Math.sin(k * 51.7 + 3.3) * 43758.5453; return x - Math.floor(x); };
  for (const [ring, rk, h] of [[1, 0.55, 0.22], [2, 1.0, 0.04]]) {
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2, r = rk * (0.78 + R(j * 3 + ring) * 0.38);
      pos.push(Math.cos(a) * r, Math.sin(a) * r * 0.82, h + (R(j + 40 * ring) - 0.5) * 0.08);
    }
  }
  for (let j = 0; j < N; j++) idx.push(0, 1 + j, 1 + (j + 1) % N);
  for (let j = 0; j < N; j++) { const a = 1 + j, b = 1 + (j + 1) % N, c = 1 + N + j, d = 1 + N + (j + 1) % N; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ 전기 아크
class Arcs {
  constructor() {
    this.max = 12; this.seg = 14;
    const n = this.max * this.seg * 6 * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 6; this.obj.visible = false;
    this.arcs = [];
    this.points = Array.from({ length: this.seg + 1 }, () => new THREE.Vector3());
    this.layers = [[3.5, [0.25, 0.45, 1.0]], [1, [0.95, 0.97, 1.0]]];
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
    let alive = 0;
    for (const a of this.arcs) { a.t += dt; if (a.t < a.life) this.arcs[alive++] = a; }
    this.arcs.length = alive;
    this.obj.visible = alive > 0;
    if (!alive) { this.obj.geometry.setDrawRange(0, 0); return; }
    for (const a of this.arcs) {
      const fl = Math.random() < 0.3 ? 0.4 : 1;
      const I = (1 - a.t / a.life) * fl;
      const pts = this.points;
      for (let i = 0; i <= this.seg; i++) {
        const t = i / this.seg;
        const tmp = pts[i];
        tmp.lerpVectors(a.a, a.b, t);
        const j = Math.sin(t * Math.PI) * 0.018;
        tmp.x += (Math.random() - 0.5) * j; tmp.y += (Math.random() - 0.5) * j; tmp.z += (Math.random() - 0.5) * j * 0.4;
      }
      for (const [wmul, c] of this.layers) {
        for (let i = 0; i < this.seg; i++) {
          const p0 = pts[i], p1 = pts[i + 1];
          const w = a.width * wmul;
          for (let q = 0; q < 6; q++) {
            const p = q === 0 || q === 3 || q === 5 ? p0 : p1;
            const plus = q === 2 || q === 4 || q === 5;
            this.pos[k * 3] = p.x + (plus ? w : -w);
            this.pos[k * 3 + 1] = p.y + (plus ? w : 0);
            this.pos[k * 3 + 2] = p.z;
            this.col[k * 3] = c[0] * I; this.col[k * 3 + 1] = c[1] * I; this.col[k * 3 + 2] = c[2] * I; k++;
          }
        }
      }
    }
    this.obj.geometry.setDrawRange(0, k);
    for (const attr of [this.obj.geometry.attributes.position, this.obj.geometry.attributes.color]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(0, k * 3); attr.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ 모아치기 전용 충격
// 기존 Puffs는 먼지·김처럼 부드러운 잔효과에 적합하지만, 주 이펙트로 키우면
// 둥근 점 스프라이트가 그대로 드러난다. 압력파와 불꽃은 방향과 깊이가 읽히는
// 별도 3D 지오메트리로 만든다.
function powerRingMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uAlpha: { value: 0 }, uAge: { value: 0 }, uSeed: { value: Math.random() * 100 },
      uColor: { value: new THREE.Color().setRGB(1.15, 0.92, 0.68) },
    },
    vertexShader: `varying float vR; varying float vN;
      uniform float uAge; uniform float uSeed;
      void main(){
        vec3 p = position;
        float a = atan(p.y, p.x);
        float n = sin(a * 7.0 + uSeed) * 0.020 + sin(a * 13.0 - uSeed * 1.7) * 0.010 + sin(a * 19.0 + uSeed * 0.4) * 0.006;
        p.xy *= 1.0 + n * (1.0 - uAge * 0.45);
        vR = clamp((length(position.xy) - 0.82) / 0.18, 0.0, 1.0);
        vN = 0.72 + 0.28 * sin(a * 11.0 + uSeed * 2.1);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `varying float vR; varying float vN;
      uniform float uAlpha; uniform vec3 uColor;
      void main(){
        float band = smoothstep(0.0, 0.26, vR) * (1.0 - smoothstep(0.62, 1.0, vR));
        float a = uAlpha * band * vN;
        if(a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

class PowerStreaks {
  constructor(max = 56) {
    this.max = max; this.stride = 12; this.p = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * this.stride * 3);
    this.col = new Float32Array(max * this.stride * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.obj = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    }));
    this.obj.frustumCulled = false; this.obj.renderOrder = 8;
  }
  burst(c, n, strength, scrap, side) {
    const sg = side === 'L' ? -1 : 1;
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      // 벽면을 긁으며 바깥으로 찢어지되, 일부만 카메라 쪽으로 튀어 깊이를 만든다.
      const a = (i / Math.max(1, n)) * Math.PI * 2 + rnd(-0.34, 0.34);
      const sp = rnd(1.15, 2.65) * (0.48 + strength * 0.66) * (scrap ? 1 : 0.78);
      this.p.push({
        p: c.clone().add(new THREE.Vector3(rnd(-0.004, 0.004), rnd(-0.004, 0.004), rnd(0.002, 0.010))),
        v: new THREE.Vector3(Math.cos(a) * sp + sg * rnd(0.0, 0.24), Math.sin(a) * sp * 0.78 + rnd(0.12, 0.52), rnd(0.18, 0.95)),
        t: 0, life: rnd(0.085, 0.150), len: rnd(0.030, 0.068) * (0.48 + strength * 0.66),
        width: rnd(0.00065, 0.00125) * (scrap ? 1 : 0.72) * (0.55 + strength * 0.45), scrap,
      });
    }
  }
  update(dt) {
    for (const q of this.p) {
      q.t += dt; q.v.y -= 3.8 * dt; q.v.multiplyScalar(Math.pow(0.20, dt)); q.p.addScaledVector(q.v, dt);
    }
    this.p = this.p.filter((q) => q.t < q.life);
    let at = 0;
    const put = (p, r, g, b) => {
      this.pos[at * 3] = p.x; this.pos[at * 3 + 1] = p.y; this.pos[at * 3 + 2] = p.z;
      this.col[at * 3] = r; this.col[at * 3 + 1] = g; this.col[at * 3 + 2] = b; at++;
    };
    const ribbon = (tip, dir, perp, len, width, color) => {
      const mid = tip.clone().addScaledVector(dir, -len * 0.44);
      const tail = tip.clone().addScaledVector(dir, -len);
      const p1 = mid.clone().addScaledVector(perp, width), p2 = mid.clone().addScaledVector(perp, -width);
      put(tip, ...color); put(p1, ...color); put(tail, ...color);
      put(tip, ...color); put(tail, ...color); put(p2, ...color);
    };
    for (const q of this.p) {
      const fade = Math.pow(Math.max(0, 1 - q.t / q.life), 1.45);
      const dir = q.v.clone().normalize();
      const perp = new THREE.Vector3(-dir.y, dir.x, 0);
      if (perp.lengthSq() < 1e-5) perp.set(1, 0, 0); else perp.normalize();
      // 철권은 탁한 주황 금속불꽃, 맨손은 채도를 뺀 아이보리 압력광으로 구분한다.
      const outer = q.scrap ? [1.12, 0.34, 0.07] : [0.82, 0.72, 0.58];
      const core = q.scrap ? [2.15, 1.32, 0.52] : [1.70, 1.52, 1.26];
      ribbon(q.p, dir, perp, q.len, q.width * 1.8, outer.map((v) => v * fade));
      ribbon(q.p, dir, perp, q.len * 0.72, q.width * 0.48, core.map((v) => v * fade));
    }
    this.obj.geometry.setDrawRange(0, at);
    this.obj.geometry.attributes.position.needsUpdate = true;
    this.obj.geometry.attributes.color.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.obj.geometry.setDrawRange(0, 0); }
}

// ------------------------------------------------------------------ FX
export class FX {
  constructor(scene, renderer, G, lightPool = []) {
    this.scene = scene; this.G = G; this.lightPool = lightPool;
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
    // 먼저 다녀간 사람들이 남긴 마른 살점(못·꼬챙이·철판)
    this.oldGroup = new THREE.Group(); scene.add(this.oldGroup);
    this.driedMat = new THREE.MeshStandardMaterial({ color: 0x3d1b12, roughness: 0.86, metalness: 0 });
    this.charMat = new THREE.MeshStandardMaterial({ color: 0x1d130f, roughness: 0.95, metalness: 0 });
    // 입자
    this.smoke = new Puffs(160, { color: 0xbdb5ad, size: 0.03, opacity: 0.35 }); scene.add(this.smoke.obj);
    this.steam = new Puffs(120, { color: 0xffffff, size: 0.025, opacity: 0.25 }); scene.add(this.steam.obj);
    this.sparkP = new Puffs(200, { color: 0xffd28a, size: 0.004, additive: true, opacity: 1 }); scene.add(this.sparkP.obj);
    this.sparkB = new Puffs(200, { color: 0x9fd8ff, size: 0.005, additive: true, opacity: 1 }); scene.add(this.sparkB.obj);
    this.frost = new Puffs(150, { color: 0xf2f8ff, size: 0.012, opacity: 0.6 }); scene.add(this.frost.obj);
    // 벽에 맞는 순간 터지는 먼지·부스러기(색은 벽마다)
    this.dust = new Puffs(160, { color: 0xe4ded3, size: 0.014, opacity: 0.4 }); scene.add(this.dust.obj);
    this.grit = new Puffs(200, { color: 0x77716a, size: 0.003, opacity: 0.95 }); scene.add(this.grit.obj);
    this.dust.obj.renderOrder = 5; this.grit.obj.renderOrder = 5;
    // 모아치기: 장면 안에서 실제 깊이와 방향이 읽히는 짧은 전용 효과들.
    // 풀을 처음부터 장면에 올려 광원 개수가 플레이 중 바뀌지 않게 한다.
    this.powerRingGeo = new THREE.RingGeometry(0.82, 1, 96, 1);
    this.powerRings = Array.from({ length: 4 }, () => {
      const mat = powerRingMaterial();
      const mesh = new THREE.Mesh(this.powerRingGeo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 7;
      scene.add(mesh);
      return { mesh, mat, active: false, t: 0, life: 0.12, r0: 0.025, r1: 0.24, strength: 1 };
    });
    this.powerStreaks = new PowerStreaks(56); scene.add(this.powerStreaks.obj);
    this.powerArcs = new Arcs(); this.powerArcs.obj.renderOrder = 9; scene.add(this.powerArcs.obj);
    const flashGeo = new THREE.IcosahedronGeometry(1, 1);
    this.powerFlashes = Array.from({ length: 2 }, () => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.65, 1.22, 0.72), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      });
      const mesh = new THREE.Mesh(flashGeo, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 10;
      scene.add(mesh);
      return { mesh, mat, light: null, active: false, t: 0, life: 0.032, strength: 1 };
    });
    this.ambient = [];
    this.wall = null;
    this.armRefs = null;
    // 달군 철판: 눌어붙은 살 조각마다 익는 시간, 김·연기·기름 튐(벽이 바뀌어도 장면에 그대로 두고 철판에서만 냄)
    this.patchGeo = patchGeometry();
    this.grill = {
      list: [], flash: 0, searT: -9, popT: 0, popBudget: 0,
      // 철판 한가운데가 하얗게 달아올라 있어 김은 살짝 잿빛, 타는 연기는 짙은 회갈색이어야 보임
      steam: new Puffs(260, { color: 0xd9d3cc, size: 0.012, opacity: 0.36 }),
      smoke: new Puffs(240, { color: 0x5f5650, size: 0.02, opacity: 0.34 }),
      spat: new Puffs(140, { color: 0xfff0c4, size: 0.002, opacity: 0.95 }),
    };
    for (const P of [this.grill.steam, this.grill.smoke, this.grill.spat]) { P.obj.renderOrder = 4; scene.add(P.obj); }
    this.sfx = null;   // 게임이 넣어 줌(지글거림)
  }
  isHot() { return !!(this.wall && this.wall.def.id === 'hotplate'); }
  // 처음 나올 때 멈칫하지 않게 미리 컴파일할 재질
  warmMats() { return [grillMaterial('meat')]; }
  // 벽에 꽂힌 고철 부품은 개수 제한(오래된 것부터 치움) — 계속 쌓이면 무거워짐
  capStuck(list, obj, max) {
    list.push(obj);
    while (list.length > max) { const o = list.shift(); if (o.parent) o.parent.remove(o); }
  }
  bindWall(wall) {
    // 이전 벽의 피·살점 저장 → 새 벽 불러오기
    if (this.wall) this.saveWall(this.wall.def.id);
    this.wall = wall;
    this.clearPowerImpact();
    const dc = DUST[wall.def.id];
    if (dc) { this.dust.mat.uniforms.uColor.value.set(dc.dust); this.grit.mat.uniforms.uColor.value.set(dc.grit); }
    this.stuckScrap = [];
    this.blood.load((this.G.decals || {})[wall.def.id], this.oldMarks(wall.def.id));
    this.loadStuck((this.G.stuck || {})[wall.def.id]);
    this.placeOldBits(wall);
  }
  // 벽마다 한 번 만들어 저장(다음에 와도 같은 자리)
  oldMarks(id) {
    if (id === 'cement' || id === 'paper') return [];
    this.G.old = this.G.old || {};
    if (!Array.isArray(this.G.old[id])) this.G.old[id] = makeOldMarks(id);
    return this.G.old[id];
  }
  placeOldBits(wall) {
    this.oldGroup.clear();
    const id = wall.def.id, D = wall.D;
    if (id === 'cement' || id === 'paper') return;
    const near = (list, r, n) => list.map((s) => [Math.min(Math.hypot(s.x + 0.05, s.y + 0.05), Math.hypot(s.x - 0.05, s.y + 0.05)), s])
      .filter((a) => a[0] < r).sort(() => Math.random() - 0.5).slice(0, n).map((a) => a[1]);
    const bit = (x, y, z, s, mat, flat = 0.55) => {
      const m = new THREE.Mesh(this.meatGeos[Math.floor(Math.random() * 3)], mat);
      m.position.set(x, y, z); m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
      m.scale.set(s * rnd(1.0, 1.4), s * rnd(0.7, 1.0), s * flat);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    if (id === 'nails' && wall.nails) for (const n of near(wall.nails, 0.13, 7)) this.oldGroup.add(bit(n.x + rnd(-0.002, 0.002), n.y + rnd(-0.002, 0.002), -D + rnd(0.024, 0.046), rnd(0.0045, 0.0075), this.driedMat));
    if (id === 'spikes' && wall.spikes) {
      for (const s of near(wall.spikes, 0.16, 3)) this.oldGroup.add(bit(s.x + rnd(-0.003, 0.003), s.y + rnd(-0.003, 0.003), -D + rnd(0.04, 0.19), rnd(0.004, 0.0075), this.driedMat));
      this.oldGroup.add(bit(OLD_FIST_AT.x + rnd(-0.003, 0.003), OLD_FIST_AT.y - 0.006, -D + rnd(0.05, 0.07), 0.006, this.driedMat));
    }
    if (id === 'hotplate') for (let i = 0; i < 4; i++) this.oldGroup.add(bit(rnd(-0.1, 0.1), rnd(-0.14, 0.05), -D + 0.0015, rnd(0.003, 0.0055), this.charMat, 0.3));
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
    if (blood > 0.12 || (fistPrint && W.id !== 'spikes')) {
      // 타격면 핏자국
      // 살 주먹이면 너클 자국(가로로 눕힘, 팔 쪽으로 살짝 기울임), 아니면 그냥 튄 피
      const tilt = (arm.side === 'L' ? -1 : 1) * rnd(0.05, 0.3);
      this.blood.splat(cx + rnd(-0.008, 0.008), cy + rnd(-0.008, 0.008), (fistPrint ? 0.03 : 0.012) + blood * (fistPrint ? 0.012 : 0.022), { dark: Math.random() * 0.3, knuckle: fistPrint, rot: fistPrint ? tilt : undefined, alpha: fistPrint ? clamp(0.22 + blood * 1.6, 0.22, 0.95) : clamp(0.3 + blood * 0.9, 0.3, 0.95) });
      // 흘러내림: 언 벽은 짧게 얼어붙고, 달군 철판은 지글지글 말라 버림
      const dripK = W.id === 'freezer' ? 0.22 : W.id === 'hotplate' ? 0.12 : 1;
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
    // 달군 철판: 맞은 자리 살갗·짓이겨진 살이 철판에 눌어붙음(석쇠에 고기 들러붙듯) — 붙은 데서 익다가 탐
    if (W.id === 'hotplate' && !scrapHit) {
      const fresh = arm.I < 0.3;
      if (Math.random() < (fresh ? 0.3 + arm.I * 1.8 : 0.8)) {
        this.stickChunk(new THREE.Vector3(cx + rnd(-0.014, 0.014), cy + rnd(-0.01, 0.008), wallZ + 0.0008), rnd(0.0045, 0.009) * (fresh ? 1 : 1.3), fresh ? 'patch' : 'meatpatch', [0, 0, +rnd(0, 6.28).toFixed(2)]);
      }
    }
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

  // 모아치기 접촉 전용. 벽 자체에는 아무 흔적도 남기지 않고, 공기·빛·금속 불꽃만 잠깐 터진다.
  powerImpact(c, { strength = 1, scrap = false, side = 'L', full = false } = {}) {
    if (!c) return;
    const k = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);
    if (k < 0.04) return;
    const wallZ = this.wall ? this.wall.surfaceZ() : c.z;
    const p = new THREE.Vector3(c.x, c.y, Math.max(c.z, wallZ) + 0.008);

    const ring = this.powerRings.find((r) => !r.active) || this.powerRings.reduce((a, b) => a.t / a.life > b.t / b.life ? a : b);
    ring.active = true; ring.t = 0; ring.life = 0.085 + k * 0.045;
    ring.r0 = 0.016 + k * 0.017; ring.r1 = 0.09 + k * 0.165; ring.strength = k;
    ring.mesh.visible = true; ring.mesh.position.copy(p); ring.mesh.scale.setScalar(ring.r0);
    ring.mat.uniforms.uAge.value = 0; ring.mat.uniforms.uSeed.value = Math.random() * 100;
    ring.mat.uniforms.uAlpha.value = 0.28 + k * 0.72;
    if (scrap) ring.mat.uniforms.uColor.value.setRGB(1.45, 0.86, 0.34);
    else ring.mat.uniforms.uColor.value.setRGB(1.05, 0.92, 0.76);

    const flash = this.powerFlashes.find((f) => !f.active) || this.powerFlashes.reduce((a, b) => a.t / a.life > b.t / b.life ? a : b);
    // 저프레임에서도 적어도 한 장은 읽히되, 화면 전체를 덮는 플래시는 되지 않게 국소 수명만 늘린다.
    this.releasePowerLight(flash);
    flash.active = true; flash.t = 0; flash.life = 0.070 + k * 0.025; flash.strength = k;
    flash.mesh.visible = true; flash.mesh.position.copy(p).add(new THREE.Vector3(0, 0, 0.012));
    flash.mesh.scale.setScalar(0.005 + k * 0.012); flash.mat.opacity = 0.32 + k * 0.50;
    flash.mat.color.setRGB(scrap ? 1.75 : 1.48, scrap ? 1.18 : 1.32, scrap ? 0.62 : 1.02);
    flash.light = this.lightPool.find((l) => !l.userData.busy && !l.userData.powerBusy) || null;
    if (flash.light) {
      flash.light.userData.powerBusy = true;
      flash.light.position.copy(p).add(new THREE.Vector3(0, 0, 0.035));
      flash.light.color.set(scrap ? 0xffc47d : 0xffe5c4);
      flash.light.distance = 0.7; flash.light.decay = 2;
      flash.light.intensity = 1.4 + k * 7.6;
    }

    const n = Math.round((scrap ? 4 : 2) + (scrap ? 16 : 5) * k);
    this.powerStreaks.burst(p, n, k, scrap, side);

    if (full) {
      const arcs = 2 + (Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < arcs; i++) {
        const a = (i / arcs) * Math.PI * 2 + rnd(-0.55, 0.55), r = rnd(0.035, 0.075);
        const start = p.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.75, rnd(-0.001, 0.006)));
        const end = p.clone().add(new THREE.Vector3(rnd(-0.018, 0.018), rnd(-0.014, 0.022), rnd(0.032, 0.065)));
        this.powerArcs.add(start, end, rnd(0.080, 0.115), rnd(0.0007, 0.00115));
      }
    }
  }

  releasePowerLight(flash) {
    if (!flash.light) return;
    flash.light.intensity = 0;
    flash.light.userData.powerBusy = false;
    flash.light = null;
  }

  clearPowerImpact() {
    for (const r of this.powerRings) { r.active = false; r.mesh.visible = false; r.mat.uniforms.uAlpha.value = 0; }
    for (const f of this.powerFlashes) { f.active = false; f.mesh.visible = false; f.mat.opacity = 0; this.releasePowerLight(f); }
    this.powerStreaks.clear();
    this.powerArcs.arcs.length = 0; this.powerArcs.update(0);
  }

  updatePowerImpact(dt) {
    for (const r of this.powerRings) {
      if (!r.active) continue;
      r.t += dt;
      if (r.t >= r.life) { r.active = false; r.mesh.visible = false; r.mat.uniforms.uAlpha.value = 0; continue; }
      const u = r.t / r.life, e = 1 - Math.pow(1 - u, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.uniforms.uAge.value = u;
      const appear = Math.min(1, u / 0.1);
      r.mat.uniforms.uAlpha.value = appear * Math.pow(1 - u, 1.55) * (0.28 + r.strength * 0.72);
    }
    for (const f of this.powerFlashes) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.life) { f.active = false; f.mesh.visible = false; f.mat.opacity = 0; this.releasePowerLight(f); continue; }
      const u = f.t / f.life, fade = Math.pow(1 - u, 1.6);
      f.mat.opacity = (0.32 + f.strength * 0.50) * fade;
      f.mesh.scale.multiplyScalar(1 + dt * 9);
      if (f.light) f.light.intensity = (1.4 + f.strength * 7.6) * fade;
    }
    // 마지막 입자가 죽는 프레임에는 한 번 비우고, 그 뒤 유휴 프레임에는 GPU 버퍼를 건드리지 않는다.
    if (this.powerStreaks.p.length) this.powerStreaks.update(dt);
    if (this.powerArcs.arcs.length) this.powerArcs.update(dt);
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
    // 달군 철판엔 닿는 족족 눌어붙음
    const hot = this.isHot();
    const stick = Math.random() < (kind === 'bone' ? (hot ? 0.5 : 0.25) : (hot ? 0.85 : 0.55));
    this.flying.push({ m, v: new THREE.Vector3(rnd(-1.2, 1.2), rnd(-0.4, 1.6), stick ? rnd(-0.6, -0.1) : rnd(0.2, 0.9)), w: new THREE.Vector3(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)), t: 0, kind, stick, size });
  }

  // 벽에 붙어 남는 살점(저장). 달군 철판이면 붙은 순간부터 익는 시간(c)을 셈
  stickChunk(p, size, kind = 'meat', rot = null) {
    const rec = { k: kind, p: [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)], s: +size.toFixed(4), r: rot || [rnd(0, 6), rnd(0, 6), rnd(0, 6)].map((v) => +v.toFixed(2)) };
    if (this.isHot()) rec.c = 0;
    this.addStuckMesh(rec);
    this.stuckList.push(rec);
    if (this.stuckList.length > 140) { this.stuckList.shift(); const o = this.stuckGroup.children[0]; if (o) { this.stuckGroup.remove(o); this._unGrill(o); } }
    if (rec.c === 0) this._sear(p, size);
  }
  addStuckMesh(rec) {
    const hot = this.isHot();
    const flat = rec.k === 'patch' || rec.k === 'meatpatch';
    const mat = hot ? grillMaterial(rec.k) : ({ meat: this.meatMat, fat: this.fatMat, bone: this.boneMat, skin: this.skinBitMat, nail: this.nailMat, patch: this.skinBitMat, meatpatch: this.meatMat }[rec.k] || this.meatMat);
    const geo = flat ? this.patchGeo : rec.k === 'bone' ? this.boneGeo : (rec.k === 'skin' || rec.k === 'nail') ? this.nailGeo : this.meatGeos[Math.abs(Math.floor(rec.p[0] * 1000)) % 3];
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(rec.p); m.rotation.set(rec.r[0], rec.r[1], rec.r[2]);
    if (flat) m.scale.set(rec.s * 1.25, rec.s, rec.s);
    else m.scale.set(rec.s * 1.2, rec.s, rec.s * 0.55);
    m.castShadow = true;
    this.stuckGroup.add(m);
    if (hot) {
      if (!(rec.c >= 0)) rec.c = COOK.ash + 8;   // 예전에 붙어 있던 건 다 타 버린 채로
      this.grill.list.push({ m, rec, U: mat.userData.U, s0: m.scale.clone(), acc: [Math.random(), Math.random(), Math.random()], sz: clamp(rec.s / 0.006, 0.5, 2.2), bone: rec.k === 'bone' });
    }
  }
  _unGrill(o) {
    const L = this.grill.list, i = L.findIndex((g) => g.m === o);
    if (i >= 0) { L[i].m.material.dispose(); L.splice(i, 1); }
  }
  loadStuck(list) {
    for (const g of this.grill.list) g.m.material.dispose();
    this.grill.list = []; this.grill.flash = 0;
    this.stuckGroup.clear(); this.stuckList = (list || []).slice();
    // 철판에 다시 와 보면 두고 간 살은 이미 새까맣게 타 있음
    if (this.isHot()) for (const r of this.stuckList) r.c = Math.max(Number.isFinite(r.c) ? r.c : 0, COOK.ash + 8);
    for (const r of this.stuckList) this.addStuckMesh(r);
  }
  // 갓 눌어붙은 순간: 치익 — 김이 확 오름
  _sear(p, size) {
    const G = this.grill;
    for (let i = 0; i < 9; i++) G.steam.emit({ x: p.x + rnd(-0.004, 0.004), y: p.y + rnd(-0.003, 0.004), z: p.z + 0.004, vx: rnd(-0.05, 0.05), vy: rnd(0.08, 0.22), vz: rnd(0.01, 0.07), g: 0.08, drag: 0.6, life: rnd(0.6, 1.2), size: rnd(0.007, 0.014), grow: 3.0, a: rnd(0.3, 0.48) });
    G.flash = Math.min(2.2, G.flash + 0.4 + size * 40);
    const now = performance.now() * 0.001;
    if (this.sfx && now - G.searT > 0.07) { G.searT = now; this.sfx.play('sear', Math.min(0.92, 0.42 + size * 55), { pan: clamp(p.x * 3, -0.6, 0.6), jitter: 0.14, verbAmt: 0.26 }); }
  }
  // 매 프레임: 익는 정도·오그라듦·김·연기·기름 튐·지글거림
  updateGrill(dt, time) {
    const G = this.grill, L = G.list;
    G.flash *= Math.exp(-dt / 0.3);
    let level = G.flash;
    if (!this.isHot()) { this.sfx?.grill?.(0); return; }
    // 김·연기가 한꺼번에 너무 많이 나지 않게 초당 총량을 나눠 씀
    let rS = 0, rK = 0, rP = 0;
    const rates = [];
    for (const g of L) {
      const c = g.rec.c = Math.min(COOK.ash + 8, g.rec.c + dt * (g.bone ? 0.5 : 1));
      const sz = g.sz;
      const steam = (c < 0.7 ? 9 : 5 * Math.exp(-(c - 0.7) / 6.5) + 0.35 * Math.exp(-c / 40)) * sz;
      const smoke = (2.6 * sstep(16, 30, c) * (1 - sstep(50, 74, c)) + 0.25 * sstep(5, 12, c) * (1 - sstep(12, 22, c))) * sz;
      const pop = g.bone ? 0 : (g.rec.k === 'fat' ? 4.2 : 2.2) * Math.exp(-c / 9) * Math.min(1.6, sz) + 0.5 * sstep(24, 36, c) * (1 - sstep(48, 66, c));
      rates.push(steam, smoke, pop);
      rS += steam; rK += smoke; rP += pop;
      level += (0.9 * Math.exp(-c / 11) + 0.22 * sstep(22, 38, c) * (1 - sstep(54, 76, c))) * Math.min(1.5, sz);
      // 색: 날것 → 허옇게 익음 → 노릇 → 숯. 익으며 오그라들고, 다 타면 조금 더 쪼그라듦
      const k = cookK(c);
      g.U.uCook.value = k;
      g.U.uFl.value = 0.75 + 0.25 * Math.sin(time * 7 + g.acc[0] * 20) * Math.sin(time * 3.1 + g.acc[1] * 9);
      const shr = 1 - 0.2 * sstep(0, 26, c) - 0.08 * sstep(40, 70, c);
      g.m.scale.set(g.s0.x * shr, g.s0.y * shr, g.s0.z * (1 - 0.3 * sstep(0, 30, c)));
    }
    const kS = Math.min(1, 70 / Math.max(1, rS)), kK = Math.min(1, 42 / Math.max(1, rK)), kP = Math.min(1, 26 / Math.max(1, rP));
    for (let i = 0; i < L.length; i++) {
      const g = L[i], p = g.m.position, sz = g.sz;
      g.acc[0] += rates[i * 3] * kS * dt;
      while (g.acc[0] >= 1) {
        g.acc[0] -= 1;
        G.steam.emit({ x: p.x + rnd(-0.003, 0.003), y: p.y + rnd(-0.002, 0.003), z: p.z + 0.003, vx: rnd(-0.025, 0.025), vy: rnd(0.05, 0.13), vz: rnd(0.005, 0.04), g: 0.06, drag: 0.7, life: rnd(0.8, 1.6), size: rnd(0.007, 0.014) * (0.7 + 0.3 * sz), grow: 3.6, a: rnd(0.22, 0.36) });
      }
      g.acc[1] += rates[i * 3 + 1] * kK * dt;
      while (g.acc[1] >= 1) {
        g.acc[1] -= 1;
        G.smoke.emit({ x: p.x + rnd(-0.003, 0.003), y: p.y + rnd(-0.002, 0.003), z: p.z + 0.004, vx: rnd(-0.02, 0.02), vy: rnd(0.04, 0.1), vz: rnd(0.005, 0.03), g: 0.05, drag: 0.75, life: rnd(1.6, 3.0), size: rnd(0.013, 0.024), grow: 4.0, a: rnd(0.22, 0.38) });
      }
      g.acc[2] += rates[i * 3 + 2] * kP * dt;
      while (g.acc[2] >= 1) {
        g.acc[2] -= 1;
        const a = rnd(0, Math.PI * 2), sp = rnd(0.25, 0.9);
        G.spat.emit({ x: p.x + rnd(-0.002, 0.002), y: p.y + rnd(-0.002, 0.002), z: p.z + 0.002, vx: Math.cos(a) * sp * 0.6, vy: Math.abs(Math.sin(a)) * sp + 0.2, vz: rnd(0.1, 0.55), g: -6.5, drag: 0.5, life: rnd(0.18, 0.42), size: rnd(0.0012, 0.0026), grow: 0.6, a: 0.95, pop: 1 });
        // 타닥 — 튀는 기름 몇 개에 하나꼴로 소리
        if (this.sfx && Math.random() < 0.55 && G.popBudget > 0) { G.popBudget -= 1; this.sfx.play('fryPop', rnd(0.12, 0.34), { pan: clamp(p.x * 3, -0.7, 0.7), jitter: 0.25, verbAmt: 0.12 }); }
      }
    }
    G.popBudget = Math.min(3, G.popBudget + dt * 16);
    this.sfx?.grill?.(level);
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
    if (k > 0.9 && Math.random() < 0.7) this.blood.drip(c.x + rnd(-0.015, 0.015), c.y - rnd(0, 0.01), rnd(0.08, 0.22) * (this.wall.def.id === 'freezer' ? 0.25 : 1), rnd(0.0025, 0.005));
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
    const hot = this.isHot();
    for (const d of this.drops) {
      d.t += dt; d.vy -= 9.8 * dt; d.vx *= 0.995; d.vz *= 0.995;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.z <= wallZ) {
        // 벽에 닿음 → 점. 달군 철판이면 핏방울이 닿자마자 치익 끓어 김이 됨
        if (Math.random() < 0.85) this.blood.drop(d.x, d.y, d.r * rnd(0.8, 1.6));
        if (hot && Math.random() < 0.55) {
          this.grill.steam.emit({ x: d.x, y: d.y, z: wallZ + 0.003, vx: rnd(-0.02, 0.02), vy: rnd(0.06, 0.15), vz: rnd(0.01, 0.04), g: 0.06, drag: 0.7, life: rnd(0.4, 0.9), size: rnd(0.004, 0.008), grow: 3, a: rnd(0.16, 0.3) });
          this.grill.flash = Math.min(2.2, this.grill.flash + 0.035);
        }
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
    this.updateGrill(dt, time);
    this.grill.steam.update(dt); this.grill.smoke.update(dt); this.grill.spat.update(dt);
    this.smoke.update(dt); this.steam.update(dt); this.sparkP.update(dt); this.sparkB.update(dt); this.frost.update(dt);
    this.dust.update(rdt); this.grit.update(rdt);
    this.updatePowerImpact(rdt);
  }
}
