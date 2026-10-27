// 철권 — 효과음 합성 (불러올 때 한 번 만들어 둠) + 녹음한 맨주먹 타격음 + 태권도 목소리
import VOICE_B64 from './voice.js';
import PUNCH from './punch.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
export const WHOOSH_PEAK = 0.09;   // 휘두르는 바람이 가장 커지는 시점(초) — 이 순간이 벽에 닿는 순간과 맞게 재생

// ------------------------------------------------------------------ DSP
class Synth {
  constructor(sr) { this.sr = sr; }
  buf(sec) { return new Float32Array(Math.max(1, Math.floor(sec * this.sr))); }
  noise(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.random() * 2 - 1; return a; }
  // RBJ 바이쿼드 (주파수 f 는 숫자 또는 시간→주파수 함수)
  filt(x, type, f, q = 0.707, gainDb = 0) {
    const sr = this.sr, y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b1, b2, a1, a2;
    const coef = (fr) => {
      fr = Math.min(Math.max(fr, 10), sr * 0.45);
      const w0 = TAU * fr / sr, cs = Math.cos(w0), sn = Math.sin(w0), al = sn / (2 * q);
      let B0, B1, B2, A0, A1, A2;
      if (type === 'lp') { B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
      else if (type === 'hp') { B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
      else if (type === 'bp') { B0 = al; B1 = 0; B2 = -al; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
      else { const A = Math.pow(10, gainDb / 40); B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A; }
      b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
    };
    const dyn = typeof f === 'function';
    if (!dyn) coef(f);
    for (let i = 0; i < x.length; i++) {
      if (dyn && (i & 31) === 0) coef(f(i / sr));
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  // 지수 감쇠 엔벨로프
  envExp(n, att, tau, delay = 0) {
    const e = new Float32Array(n), sr = this.sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr - delay;
      e[i] = t < 0 ? 0 : (t < att ? t / att : Math.exp(-(t - att) / tau));
    }
    return e;
  }
  mul(a, b) { for (let i = 0; i < a.length; i++) a[i] *= b[i]; return a; }
  gain(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
  add(dst, src, at = 0, g = 1) { const o = Math.floor(at * this.sr); for (let i = 0; i < src.length && i + o < dst.length; i++) if (i + o >= 0) dst[i + o] += src[i] * g; return dst; }
  // 음정이 떨어지는 사인(둔탁한 몸통)
  sweep(sec, f0, f1, tauF, tauA, att = 0.001) {
    const n = Math.floor(sec * this.sr), a = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / this.sr; const f = f1 + (f0 - f1) * Math.exp(-t / tauF);
      ph += TAU * f / this.sr;
      const env = t < att ? t / att : Math.exp(-(t - att) / tauA);
      a[i] = Math.sin(ph) * env;
    }
    return a;
  }
  // 고유진동(금속·나무 울림)
  modal(sec, parts, att = 0.0005) {
    const n = Math.floor(sec * this.sr), a = new Float32Array(n);
    for (const [f, amp, tau] of parts) {
      const ph = Math.random() * TAU, w = TAU * f / this.sr;
      for (let i = 0; i < n; i++) { const t = i / this.sr; a[i] += Math.sin(ph + w * i) * amp * (t < att ? t / att : 1) * Math.exp(-t / tau); }
    }
    return a;
  }
  // 알갱이 같은 짧은 딱딱 소리 묶음 (부서짐·뼈·자갈)
  grains(sec, count, lo, hi, durLo, durHi, envFn, q = 3) {
    const out = this.buf(sec);
    for (let k = 0; k < count; k++) {
      const t0 = envFn ? envFn(Math.random()) : Math.random() * sec;
      const d = rnd(durLo, durHi);
      const g = this.noise(Math.floor(d * this.sr) + 2);
      for (let i = 0; i < g.length; i++) { const u = i / g.length; g[i] *= Math.sin(Math.PI * u) ** 2; }
      const f = this.filt(g, 'bp', rnd(lo, hi), q);
      this.add(out, f, t0, rnd(0.3, 1) * (1 - t0 / sec * 0.7));
    }
    return out;
  }
  sat(a, k = 1.5) { const n = Math.tanh(k); for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * k) / n; return a; }
  norm(a, peak = 0.92) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) this.gain(a, peak / m); return a; }
  fadeOut(a, sec = 0.01) { const n = Math.floor(sec * this.sr); for (let i = 0; i < n && i < a.length; i++) a[a.length - 1 - i] *= i / n; return a; }
}

// ------------------------------------------------------------------ 소리 설계
function design(S) {
  const B = {};
  const put = (name, fn, n = 3) => { B[name] = []; for (let i = 0; i < n; i++) B[name].push(S.fadeOut(S.norm(fn(i)))); };

  // 휘두르는 바람: 점점 커지고 높아지다 WHOOSH_PEAK(맞는 순간)에 가장 크고 곧바로 끊김
  put('whoosh', () => {
    const T = WHOOSH_PEAK, d = T + 0.04, n = S.noise(Math.floor(d * S.sr));
    const f0 = rnd(240, 330), f1 = rnd(1500, 2100);
    let y = S.filt(n, 'bp', (t) => f0 + (f1 - f0) * Math.pow(Math.min(1, t / T), 1.5), 1.35);
    y = S.filt(y, 'lp', 6500, 0.7);
    // 소매 펄럭이는 낮은 바람
    const lo = S.filt(S.noise(y.length), 'bp', (t) => 140 + 260 * Math.min(1, t / T), 0.9);
    for (let i = 0; i < y.length; i++) {
      const t = i / S.sr;
      const e = t < T ? Math.pow(t / T, 2.3) : Math.exp(-(t - T) / 0.011);
      y[i] = (y[i] + lo[i] * 0.45) * e;
    }
    return y;
  }, 4);

  // 맨주먹 뼈가 단단한 데 부딪는 '똑' (너클)
  put('knuckle', () => {
    const out = S.buf(0.12);
    const click = S.filt(S.noise(Math.floor(0.003 * S.sr)), 'hp', 2600, 0.7);
    S.add(out, S.mul(click, S.envExp(click.length, 0.00004, 0.0007)), 0, 1.0);
    S.add(out, S.modal(0.11, [[rnd(640, 760), 0.9, 0.017], [rnd(1220, 1420), 0.65, 0.010], [rnd(2250, 2600), 0.38, 0.006], [rnd(3700, 4200), 0.22, 0.0035]], 0.0002), 0.0002, 0.85);
    const body = S.filt(S.noise(Math.floor(0.04 * S.sr)), 'bp', rnd(900, 1200), 1.8);
    S.add(out, S.mul(body, S.envExp(body.length, 0.0003, 0.008)), 0, 0.5);
    return S.sat(out, 1.4);
  }, 6);

  // 벽 재질 — 저음 몸통은 녹음 펀치가 맡고, 여기선 재질 특유의 소리만
  const knock = (f, q, tau, g = 1) => { const k = S.filt(S.noise(Math.floor((tau * 7 + 0.004) * S.sr)), 'bp', f * rnd(0.88, 1.12), q); return S.gain(S.mul(k, S.envExp(k.length, 0.0003, tau)), g); };
  const dok = (f0, f1, tau, drive = 2.6) => S.sat(S.sweep(tau * 7, f0 * rnd(0.92, 1.08), f1, tau * 0.6, tau), drive);
  put('matCement', () => {
    const o = S.buf(0.2);
    S.add(o, knock(1450, 1.5, 0.011), 0, 0.9);
    S.add(o, dok(210, 120, 0.024), 0, 0.55);
    S.add(o, S.grains(0.07, 46, 2400, 7000, 0.0003, 0.0012, (r) => r * r * 0.06), 0.001, 0.4);
    return o;
  }, 5);
  put('matGravel', () => {
    const o = S.buf(0.22);
    S.add(o, knock(1300, 1.4, 0.010), 0, 0.75);
    S.add(o, dok(200, 115, 0.022), 0, 0.5);
    S.add(o, S.grains(0.12, 150, 1300, 5600, 0.0004, 0.0018, (r) => r * r * 0.1), 0.0, 0.85);
    return o;
  }, 5);
  put('matWood', () => {
    const o = S.buf(0.3);
    S.add(o, knock(900, 1.4, 0.012), 0, 0.7);
    S.add(o, S.modal(0.28, [[rnd(200, 240), 0.9, 0.05], [rnd(470, 520), 0.65, 0.035], [rnd(880, 980), 0.4, 0.025], [rnd(1650, 1800), 0.22, 0.014]]), 0, 0.85);
    return o;
  }, 5);
  put('matPanel', () => {
    const o = S.buf(0.45);
    S.add(o, knock(1000, 1.3, 0.010), 0, 0.7);
    S.add(o, S.modal(0.42, [[rnd(150, 175), 0.8, 0.08], [rnd(390, 420), 0.55, 0.055], [rnd(760, 820), 0.35, 0.045], [rnd(1330, 1400), 0.18, 0.028]]), 0, 0.8);
    return o;
  }, 4);
  put('matSteel', () => {
    const o = S.buf(0.8);
    S.add(o, knock(1500, 1.5, 0.009), 0, 0.65);
    S.add(o, S.modal(0.78, [[rnd(290, 320), 0.5, 0.22], [rnd(740, 790), 0.4, 0.16], [rnd(1400, 1480), 0.26, 0.11], [rnd(2450, 2600), 0.16, 0.07], [rnd(3800, 3950), 0.09, 0.045]]), 0, 0.75);
    return o;
  }, 4);
  put('matMesh', () => {
    const o = S.buf(0.5);
    S.add(o, knock(1700, 1.4, 0.009), 0, 0.6);
    S.add(o, S.grains(0.26, 70, 1800, 5200, 0.001, 0.004, (r) => r * 0.22, 8), 0, 0.6);
    S.add(o, S.modal(0.45, [[rnd(520, 560), 0.3, 0.13], [rnd(1220, 1300), 0.25, 0.09], [rnd(2900, 3100), 0.15, 0.06]]), 0, 0.55);
    return o;
  }, 4);
  put('matStone', () => {
    const o = S.buf(0.2);
    S.add(o, knock(1250, 1.5, 0.012), 0, 0.85);
    S.add(o, dok(190, 105, 0.03), 0, 0.6);
    S.add(o, S.grains(0.08, 60, 2000, 6000, 0.0003, 0.0014, (r) => r * r * 0.07), 0.001, 0.45);
    return o;
  }, 4);

  // 주먹이 단단한 데 박힐 때 몸통 (고철·그루터기용 — 녹음 펀치를 안 쓰는 경우)
  const thudCore = (lowF = 120, knockF = 1100, skin = 1) => {
    const d = 0.32, out = S.buf(d);
    S.add(out, S.sat(S.sweep(0.28, lowF * rnd(1.0, 1.25), lowF * 0.38, 0.03, 0.065), 2.2), 0, 1.0);
    const kn = S.filt(S.noise(Math.floor(0.08 * S.sr)), 'bp', knockF * rnd(0.85, 1.15), 1.4);
    S.add(out, S.mul(kn, S.envExp(kn.length, 0.0005, 0.016)), 0, 0.75);
    const sl = S.filt(S.noise(Math.floor(0.04 * S.sr)), 'hp', 1900, 0.8);
    S.add(out, S.mul(sl, S.envExp(sl.length, 0.0002, 0.006)), 0.0, 0.55 * skin);
    return out;
  };
  // 무게감 있는 짧은 '쿵' — 저음 배음을 키워 작은 스피커에서도 들리게
  put('heft', () => {
    const o = S.buf(0.22);
    S.add(o, S.sat(S.sweep(0.2, rnd(180, 210), 62, 0.012, 0.05), 3.4), 0, 1.0);
    const b = S.filt(S.noise(Math.floor(0.08 * S.sr)), 'lp', 900, 0.9);
    S.add(o, S.mul(b, S.envExp(b.length, 0.0005, 0.018)), 0, 0.45);
    return S.filt(o, 'lp', 2400, 0.7);
  }, 4);

  // 뼈 부러짐(셀러리 꺾는 소리 계열)
  put('crack', () => {
    const d = 0.32, out = S.buf(d);
    const nT = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < nT; k++) {
      const t0 = k * rnd(0.003, 0.009);
      const im = S.noise(Math.floor(0.0007 * S.sr) + 4);
      const r = S.filt(im, 'bp', rnd(1900, 4200), rnd(4, 9));
      const tail = S.buf(0.03); S.add(tail, r, 0, 1);
      S.mul(tail, S.envExp(tail.length, 0.0001, rnd(0.004, 0.009)));
      S.add(out, tail, t0, rnd(0.6, 1));
    }
    S.add(out, S.grains(0.12, 90, 900, 3400, 0.0003, 0.0018, (r) => 0.015 + r * r * 0.1, 4), 0, 0.55);
    S.add(out, S.sweep(0.08, 210, 120, 0.02, 0.022), 0, 0.6);
    // 축축한 꼬리
    const wet = S.filt(S.noise(Math.floor(0.12 * S.sr)), 'lp', 900, 1);
    S.add(out, S.mul(wet, S.envExp(wet.length, 0.004, 0.03)), 0.01, 0.35);
    return out;
  }, 5);

  // 질척한 살
  put('squelch', () => {
    const d = 0.28, out = S.buf(d);
    const n = S.noise(Math.floor(0.25 * S.sr));
    let y = S.filt(n, 'bp', (t) => 300 + 700 * Math.abs(Math.sin(t * rnd(40, 70))), 2.5);
    const am = new Float32Array(y.length);
    for (let i = 0; i < am.length; i++) { const t = i / S.sr; am[i] = (0.5 + 0.5 * Math.sin(TAU * rnd(18, 30) * t + Math.sin(t * 90))) * Math.exp(-t / 0.07) * Math.min(1, t / 0.004); }
    S.add(out, S.mul(y, am), 0, 0.9);
    for (let k = 0; k < 5; k++) {
      const t0 = rnd(0, 0.12);
      S.add(out, S.sweep(0.03, rnd(260, 380), rnd(700, 1100), -0.01, rnd(0.006, 0.012)), t0, rnd(0.2, 0.45));
    }
    S.add(out, S.sweep(0.12, 90, 50, 0.03, 0.04), 0, 0.5);
    return out;
  }, 5);

  // 와작 (짓이겨짐)
  put('crunch', () => {
    const out = S.buf(0.35);
    S.add(out, S.grains(0.3, 220, 500, 2600, 0.0004, 0.003, (r) => r * r * 0.25, 3), 0, 0.9);
    const w = S.filt(S.noise(Math.floor(0.25 * S.sr)), 'lp', 700, 1.2);
    S.add(out, S.mul(w, S.envExp(w.length, 0.003, 0.06)), 0, 0.5);
    S.add(out, S.sweep(0.12, 140, 60, 0.02, 0.05), 0, 0.6);
    return out;
  }, 4);

  // 찢어짐 (못·냉동벽에서 뜯어낼 때)
  put('tear', () => {
    const d = rnd(0.18, 0.3), out = S.buf(d);
    let t = 0;
    while (t < d * 0.9) {
      const rate = 150 + 280 * Math.random();
      t += 1 / rate * rnd(0.4, 1.6);
      const im = S.noise(Math.floor(rnd(0.0006, 0.002) * S.sr) + 3);
      const r = S.filt(im, 'bp', rnd(900, 3200), 3);
      const env = Math.sin(Math.PI * Math.min(1, t / d)) ** 0.6;
      S.add(out, r, t, env * rnd(0.4, 1));
    }
    const wet = S.filt(S.noise(out.length), 'lp', 1100, 1);
    S.add(out, S.mul(wet, S.envExp(wet.length, 0.02, d * 0.35)), 0, 0.25);
    return out;
  }, 5);
  put('rip', () => {
    const out = S.buf(0.5);
    S.add(out, B.tear[0] ? B.tear[Math.floor(Math.random() * B.tear.length)] : S.buf(0.1), 0, 1);
    S.add(out, B.squelch[Math.floor(Math.random() * B.squelch.length)], 0.05, 0.8);
    S.add(out, S.sweep(0.12, 160, 70, 0.02, 0.04), 0.0, 0.5);
    return out;
  }, 3);
  put('nailRip', () => {
    const out = S.buf(0.18);
    S.add(out, S.grains(0.08, 60, 1500, 4500, 0.0003, 0.0012, (r) => r * 0.06, 5), 0, 0.8);
    const c = S.filt(S.noise(200), 'bp', 3800, 6); S.add(out, S.mul(c, S.envExp(c.length, 0.0001, 0.002)), 0.065, 1);
    return out;
  }, 3);
  put('detach', () => {
    const out = S.buf(0.7);
    S.add(out, B.tear[Math.floor(Math.random() * B.tear.length)], 0, 0.9);
    S.add(out, B.crack[Math.floor(Math.random() * B.crack.length)], 0.02, 0.6);
    S.add(out, B.squelch[Math.floor(Math.random() * B.squelch.length)], 0.12, 1.0);
    return out;
  }, 3);
  put('stump', () => {
    const out = S.buf(0.35);
    S.add(out, thudCore(90, 600, 0.3), 0, 0.8);
    S.add(out, B.crunch[Math.floor(Math.random() * B.crunch.length)], 0.0, 0.8);
    S.add(out, B.squelch[Math.floor(Math.random() * B.squelch.length)], 0.02, 0.7);
    return out;
  }, 4);
  put('stumpTwitch', () => { const o = S.buf(0.12); const w = S.filt(S.noise(o.length), 'lp', 500, 1); S.add(o, S.mul(w, S.envExp(w.length, 0.01, 0.03)), 0, 1); return o; }, 2);

  // 쥐덫 탁!
  put('snap', () => {
    const out = S.buf(0.3);
    const c = S.filt(S.noise(Math.floor(0.0004 * S.sr) + 3), 'hp', 2500, 0.7); S.add(out, c, 0, 1);
    S.add(out, S.modal(0.08, [[rnd(1700, 1900), 0.7, 0.012], [rnd(3000, 3300), 0.5, 0.009], [rnd(5200, 5600), 0.3, 0.005]]), 0, 0.8);
    S.add(out, S.modal(0.3, [[rnd(4100, 4400), 0.12, 0.09], [rnd(6200, 6500), 0.06, 0.05]]), 0.001, 1);
    S.add(out, S.sweep(0.05, 300, 180, 0.01, 0.012), 0, 0.4);
    return out;
  }, 4);

  // 유리 으스러짐
  put('glass', () => {
    const out = S.buf(0.45);
    S.add(out, S.grains(0.2, 200, 3000, 10000, 0.0002, 0.0012, (r) => r * r * 0.18, 4), 0, 0.9);
    for (let k = 0; k < 14; k++) {
      const f = rnd(2600, 7800);
      S.add(out, S.modal(0.2, [[f, 1, rnd(0.02, 0.09)], [f * rnd(1.5, 2.6), 0.4, rnd(0.01, 0.05)]]), rnd(0, 0.18), rnd(0.08, 0.25));
    }
    return out;
  }, 4);

  // 못 박힘(푹)
  put('impale', () => {
    const out = S.buf(0.4);
    S.add(out, S.sweep(0.18, 110, 55, 0.03, 0.05), 0, 0.8);
    const w = S.filt(S.noise(Math.floor(0.2 * S.sr)), 'bp', (t) => 500 + 900 * Math.exp(-t / 0.04), 1.6);
    S.add(out, S.mul(w, S.envExp(w.length, 0.002, 0.04)), 0, 0.9);
    S.add(out, S.grains(0.08, 40, 900, 2600, 0.0004, 0.0015, (r) => r * 0.07, 4), 0.005, 0.6);
    return out;
  }, 4);
  put('spike', () => {
    const out = S.buf(0.7);
    S.add(out, B.impale[Math.floor(Math.random() * B.impale.length)], 0, 1);
    // 뼈를 긁고 지나가는 쇠
    const s = S.filt(S.noise(Math.floor(0.35 * S.sr)), 'bp', (t) => 1800 - 900 * t, 9);
    S.add(out, S.mul(s, S.envExp(s.length, 0.02, 0.12)), 0.02, 0.6);
    S.add(out, B.crack[Math.floor(Math.random() * B.crack.length)], 0.04, 0.8);
    return out;
  }, 3);

  // 치이익 (달군 철판)
  put('sizzle', () => {
    const d = 1.4, out = S.buf(d);
    const h = S.filt(S.filt(S.noise(out.length), 'hp', 2200, 0.7), 'lp', 9000, 0.7);
    S.add(out, S.mul(h, S.envExp(h.length, 0.015, 0.45)), 0, 0.55);
    S.add(out, S.grains(d, 520, 2500, 9000, 0.0002, 0.0008, (r) => -Math.log(1 - r * 0.98) * 0.32, 2), 0, 0.85);
    S.add(out, S.grains(0.6, 30, 600, 1600, 0.002, 0.006, (r) => r * 0.5, 2), 0.02, 0.4);
    return out;
  }, 3);

  // 냉동 성에 바스락
  put('frost', () => {
    const out = S.buf(0.3);
    S.add(out, S.grains(0.25, 160, 3500, 9000, 0.0002, 0.0007, (r) => r * r * 0.2, 3), 0, 0.8);
    return out;
  }, 3);

  // 슬라임 뿌직 / 쪽(빨아들임)
  put('gloop', () => {
    const out = S.buf(0.5);
    for (let k = 0; k < 6; k++) S.add(out, S.sweep(0.08, rnd(140, 220), rnd(380, 620), -0.02, rnd(0.02, 0.04)), rnd(0, 0.1), rnd(0.4, 0.8));
    const w = S.filt(S.noise(Math.floor(0.4 * S.sr)), 'bp', (t) => 250 + 500 * Math.abs(Math.sin(t * 22)), 3);
    S.add(out, S.mul(w, S.envExp(w.length, 0.01, 0.09)), 0, 0.9);
    S.add(out, S.sweep(0.2, 90, 45, 0.04, 0.06), 0, 0.6);
    return out;
  }, 4);
  put('suction', () => {
    const out = S.buf(0.35);
    const w = S.filt(S.noise(Math.floor(0.25 * S.sr)), 'bp', (t) => 300 + 1600 * Math.min(1, t / 0.2), 4);
    S.add(out, S.mul(w, S.envExp(w.length, 0.12, 0.03)), 0, 0.8);
    S.add(out, S.sweep(0.06, 180, 620, -0.03, 0.015), 0.19, 1.0);
    return out;
  }, 3);
  put('fizz', () => {
    const out = S.buf(1.2);
    S.add(out, S.grains(1.2, 300, 4000, 11000, 0.0002, 0.0006, (r) => r * 1.15, 2), 0, 0.6);
    return out;
  }, 2);

  // 전기 지지직
  put('zap', () => {
    const d = rnd(0.32, 0.45), out = S.buf(d);
    const f = rnd(95, 125); let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / S.sr; ph += f / S.sr;
      const saw = ((ph % 1) * 2 - 1);
      const gate = Math.random() < 0.02 ? 0 : 1;
      out[i] += Math.tanh(saw * 4) * 0.35 * gate * Math.exp(-t / (d * 0.6));
    }
    const cr = S.filt(S.noise(out.length), 'hp', 2400, 0.7);
    for (let i = 0; i < cr.length; i++) { const t = i / S.sr; cr[i] *= (Math.random() < 0.18 ? 1 : 0.08) * Math.exp(-t / (d * 0.5)); }
    S.add(out, cr, 0, 0.9);
    const sn = S.filt(S.noise(Math.floor(0.003 * S.sr)), 'hp', 3000, 0.7); S.add(out, sn, 0, 1.4);
    return S.sat(out, 1.8);
  }, 4);

  // 고철
  put('clank', () => {
    const out = S.buf(0.8);
    S.add(out, thudCore(130, 1800, 0.2), 0, 0.5);
    const base = rnd(300, 700);
    S.add(out, S.modal(0.7, [[base, 0.6, rnd(0.08, 0.2)], [base * rnd(2.3, 2.8), 0.45, rnd(0.06, 0.12)], [base * rnd(4.1, 5.3), 0.3, rnd(0.03, 0.08)], [base * rnd(6.8, 8.2), 0.18, 0.03]]), 0, 0.9);
    for (let k = 0; k < 5; k++) { const f = rnd(1800, 5200); S.add(out, S.modal(0.15, [[f, 1, rnd(0.015, 0.05)]]), rnd(0.03, 0.25), rnd(0.08, 0.2)); }
    return out;
  }, 5);
  put('ping', () => { const f = rnd(2200, 4800); const o = S.modal(0.3, [[f, 1, 0.07], [f * 2.71, 0.4, 0.03]]); return o; }, 4);
  put('wire', () => {
    const out = S.buf(0.4); const f = rnd(700, 1100);
    S.add(out, S.modal(0.4, [[f, 0.8, 0.12], [f * 2.01, 0.4, 0.08], [f * 3.02, 0.2, 0.05]]), 0, 0.6);
    const c = S.filt(S.noise(150), 'hp', 3000, 0.7); S.add(out, c, 0, 0.8);
    return out;
  }, 2);
  put('scrapOn', () => {
    const out = S.buf(0.9);
    for (let k = 0; k < 6; k++) S.add(out, B.clank[Math.floor(Math.random() * B.clank.length)], k * rnd(0.05, 0.12), rnd(0.15, 0.4));
    const r = S.filt(S.noise(Math.floor(0.4 * S.sr)), 'bp', 1600, 0.8); S.add(out, S.mul(r, S.envExp(r.length, 0.1, 0.1)), 0.35, 0.3);
    return out;
  }, 2);

  // 화면
  put('click', () => { const o = S.modal(0.06, [[rnd(1800, 2000), 1, 0.01], [3900, 0.3, 0.006]]); return o; }, 2);
  put('buy', () => { const o = S.buf(0.5); S.add(o, S.modal(0.4, [[1567, 0.8, 0.12], [3134, 0.3, 0.06]]), 0, 0.6); S.add(o, S.modal(0.4, [[2093, 0.8, 0.15], [4186, 0.3, 0.07]]), 0.07, 0.6); S.add(o, thudCore(160, 2000, 0), 0, 0.15); return o; }, 1);
  put('restore', () => { const o = S.buf(0.6); const w = S.filt(S.noise(o.length), 'bp', (t) => 400 + 2400 * t, 1.2); S.add(o, S.mul(w, S.envExp(w.length, 0.25, 0.08)), 0, 0.7); return o; }, 1);
  put('end', () => { const o = S.buf(1.0); S.add(o, S.sweep(0.9, 70, 48, 0.2, 0.35), 0, 0.9); return o; }, 1);
  return B;
}

// 반복 배경음 (벽마다)
function ambientBuffers(S) {
  const loops = {};
  const mk = (sec, fn) => { const a = fn(sec); const n = Math.floor(0.25 * S.sr); for (let i = 0; i < n; i++) { const k = i / n; a[i] = a[i] * k + a[a.length - n + i] * (1 - k); } return S.norm(a.subarray(0, a.length - n), 0.5); };
  loops.room = mk(4, (d) => S.filt(S.filt(S.noise(Math.floor(d * S.sr)), 'lp', 380, 0.7), 'hp', 50, 0.7));
  loops.freezer = mk(4, (d) => {
    const n = Math.floor(d * S.sr), o = S.filt(S.noise(n), 'bp', 900, 0.6);
    let ph = 0; for (let i = 0; i < n; i++) { ph += 118 / S.sr; o[i] = o[i] * 0.4 + Math.sin(TAU * ph) * 0.25 + Math.sin(TAU * ph * 2) * 0.12; }
    return o;
  });
  loops.hotplate = mk(4, (d) => {
    const n = Math.floor(d * S.sr), o = S.filt(S.noise(n), 'lp', 260, 0.8);
    const h = S.filt(S.noise(n), 'hp', 3000, 0.7);
    for (let i = 0; i < n; i++) o[i] = o[i] * 1.2 + h[i] * 0.08 * (Math.random() < 0.04 ? 3 : 1);
    return o;
  });
  loops.electric = mk(4, (d) => {
    const n = Math.floor(d * S.sr), o = new Float32Array(n); let ph = 0;
    for (let i = 0; i < n; i++) { ph += 60 / S.sr; o[i] = Math.sin(TAU * ph) * 0.4 + Math.sin(TAU * ph * 2) * 0.3 + Math.sin(TAU * ph * 3) * 0.15 + Math.sin(TAU * ph * 5) * 0.06; }
    const cr = S.filt(S.noise(n), 'hp', 3000, 0.7); for (let i = 0; i < n; i++) o[i] += cr[i] * (Math.random() < 0.002 ? 1.2 : 0.01);
    return o;
  });
  loops.slime = mk(4, (d) => {
    const o = S.buf(d);
    for (let k = 0; k < 40; k++) S.add(o, S.sweep(0.05, rnd(160, 260), rnd(400, 700), -0.02, rnd(0.01, 0.025)), rnd(0, d - 0.1), rnd(0.05, 0.2));
    S.add(o, S.filt(S.noise(o.length), 'lp', 300, 0.7), 0, 0.15);
    return o;
  });
  return loops;
}

// 녹음 펀치 base64(16비트 PCM) → Float32
function pcm16(b64) {
  const s = atob(b64), n = s.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = s.charCodeAt(i * 2) | (s.charCodeAt(i * 2 + 1) << 8); if (v & 0x8000) v -= 0x10000; out[i] = v / 32768; }
  return out;
}

// 벽마다 어떤 재질 소리를 섞는지
const MAT = { cement: 'matCement', gravel: 'matGravel', traps: 'matWood', glass: 'matCement', nails: 'matWood', freezer: 'matPanel', hotplate: 'matSteel', slime: null, electric: 'matMesh', spikes: null };
const THUD = { cement: 'matCement', gravel: 'matGravel', traps: 'matWood', glass: 'matCement', nails: 'matWood', freezer: 'matPanel', hotplate: 'matSteel', slime: null, electric: 'matMesh', spikes: null };

// ------------------------------------------------------------------ 재생
export class SFX {
  constructor() {
    this.ctx = null; this.B = null; this.muted = false;
    this.ready = false; this.pendingAmb = null;
    this.SR = 44100;
  }
  // 불러오는 동안 미리 합성(첫 타격 때 멈칫하지 않게)
  async prepare() {
    const S = new Synth(this.SR);
    await new Promise((r) => setTimeout(r, 0));
    this.raw = design(S);
    await new Promise((r) => setTimeout(r, 0));
    this.rawAmb = ambientBuffers(S);
    try {
      this.rawPunch = { heavy: PUNCH.heavy.map(pcm16), medium: PUNCH.medium.map(pcm16) };
    } catch (e) { console.warn('punch', e); this.rawPunch = null; }
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      // 믹스: 전체 → 부드러운 압축(공격 시간을 둬서 타격 첫머리는 살림) → 리미터(겹쳐도 안 찢어지게)
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 8; this.comp.ratio.value = 2.6; this.comp.attack.value = 0.012; this.comp.release.value = 0.16;
      this.lim = c.createDynamicsCompressor();
      this.lim.threshold.value = -1.5; this.lim.knee.value = 0; this.lim.ratio.value = 20; this.lim.attack.value = 0.001; this.lim.release.value = 0.07;
      this.master.connect(this.comp); this.comp.connect(this.lim); this.lim.connect(c.destination);
      // 짧은 방 울림
      this.verb = c.createConvolver();
      const L = Math.floor(c.sampleRate * 0.32), pre = Math.floor(c.sampleRate * 0.006), ir = c.createBuffer(2, L, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = pre; i < L; i++) { const k = (i - pre) / (L - pre); d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 3.6) * (i < pre + 60 ? (i - pre) / 60 : 1); } }
      this.verb.buffer = ir; this.verbGain = c.createGain(); this.verbGain.gain.value = 0.13;
      this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
      // 미리 만든 소리를 버퍼로
      const SR = this.SR;
      this.B = {};
      for (const [k, list] of Object.entries(this.raw)) this.B[k] = list.map((a) => { const b = c.createBuffer(1, a.length, SR); b.copyToChannel(a, 0); return b; });
      if (this.rawPunch) {
        const mk = (a) => { const b = c.createBuffer(1, a.length, PUNCH.sr); b.copyToChannel(a, 0); return b; };
        this.B.punchH = this.rawPunch.heavy.map(mk);
        this.B.punchM = this.rawPunch.medium.map(mk);
      }
      this.amb = {};
      for (const [k, a] of Object.entries(this.rawAmb)) { const b = c.createBuffer(1, a.length, SR); b.copyToChannel(a, 0); this.amb[k] = b; }
      this.ready = true;
      this.loadVoice();
      if (this.pendingAmb) this.ambience(this.pendingAmb);
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  }
  async loadVoice() {
    try {
      const bin = atob(VOICE_B64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      this.voiceBuf = await this.ctx.decodeAudioData(u.buffer);
    } catch (e) { console.warn('voice', e); }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.9; }
  // opts: rate, jitter, delay, verb(false면 울림 없음), verbAmt, pan(-1 왼쪽 ~ 1 오른쪽)
  play(name, vol = 1, opts = {}) {
    if (!this.ready || !this.B[name] || !this.B[name].length) return;
    const c = this.ctx, list = this.B[name];
    const src = c.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() - 0.5) * (opts.jitter ?? 0.12));
    const g = c.createGain(); g.gain.value = vol;
    src.connect(g);
    let out = g;
    if (opts.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan)); g.connect(p); out = p; }
    out.connect(this.master);
    if (opts.verb !== false) { const s = c.createGain(); s.gain.value = opts.verbAmt ?? 1; g.connect(s); s.connect(this.verb); }
    src.start(c.currentTime + (opts.delay || 0));
  }
  // 휘두르는 바람 — 주먹이 벽에 닿는 순간(dur 초 뒤)에 가장 커지게
  whoosh(side, dur, vol = 0.3) {
    const T = WHOOSH_PEAK;
    let rate = 1, delay = 0;
    if (dur >= T) delay = dur - T; else rate = T / dur;
    this.play('whoosh', vol, { rate, delay, jitter: 0.05, pan: side === 'L' ? -0.38 : 0.38, verbAmt: 0.25 });
  }
  voice(id) {
    if (!this.ready || !this.voiceBuf) return;
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.voiceBuf;
    const g = c.createGain(); g.gain.value = 1.0;
    src.connect(g); g.connect(this.master);
    const s = c.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(this.verb);
    src.start();
  }
  ambience(id) {
    if (!this.ready) { this.pendingAmb = id; return; }
    const key = { freezer: 'freezer', hotplate: 'hotplate', electric: 'electric', slime: 'slime' }[id] || 'room';
    if (this.ambSrc) { try { this.ambGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); this.ambSrc.stop(this.ctx.currentTime + 1); } catch (e) {} }
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.amb[key]; src.loop = true;
    const g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime({ room: 0.05, freezer: 0.10, hotplate: 0.16, electric: 0.07, slime: 0.10 }[key], c.currentTime, 0.4);
    src.connect(g); g.connect(this.master); src.start();
    this.ambSrc = src; this.ambGain = g;
  }
  // 타격 묶음 — side: 친 팔('L'|'R'), feel: 타격 세기(연출용, 0.6~1.9)
  impact(wallId, res, power, arm, side = 'L', feel = 1) {
    const v = Math.min(1, 0.62 + power * 0.28);
    const k = Math.min(1.25, 0.85 + (feel - 0.8) * 0.4);
    const pan = side === 'L' ? -0.2 : 0.2;
    const scrap = res.scrap > 0;
    const mat = MAT[wallId], thud = THUD[wallId];
    if (scrap) {
      // 쇳덩이가 벽을 때림: 쨍 + 묵직한 쿵
      this.play('clank', Math.max(0.85, v), { pan }); if (Math.random() < 0.5) this.play('ping', 0.4, { delay: rnd(0.04, 0.12), pan: pan * 2 });
      this.play('heft', 0.75 * k, { pan, verbAmt: 0.6 });
      if (thud) this.play(thud, 0.5, { pan });
    } else if (arm.I >= 0.5) {
      // 손 없는 팔뚝 끝이 짓이겨짐
      this.play('stump', 1.0, { pan });
      this.play('punchH', 0.7 * k, { pan, jitter: 0.1, rate: 0.88 });
      if (thud) this.play(thud, 0.5, { pan });
    } else {
      // 살 주먹: 녹음 펀치(몸통) + 너클 뼈 '똑' + 벽 재질
      const heavy = feel > 1.05 || Math.random() < 0.55;
      this.play(heavy ? 'punchH' : 'punchM', 0.95 * k, { pan, jitter: 0.09, verbAmt: 0.7 });
      this.play('knuckle', 0.42 * v, { pan, jitter: 0.1, verbAmt: 0.4 });
      if (mat) this.play(mat, 0.6 * v, { pan, jitter: 0.08 });
      const I = arm.I;
      if (I > 0.06) this.play('squelch', Math.min(1, 0.25 + I * 2.0) * v, { delay: 0.005, pan });
      if (I > 0.28) this.play('crunch', Math.min(1, (I - 0.2) * 2.2) * v, { delay: 0.008, pan });
    }
    switch (wallId) {
      case 'gravel': if (!scrap) this.play('crunch', 0.3); break;
      case 'traps': this.play('snap', 0.9, { delay: 0.004 }); if (Math.random() < 0.6) this.play('snap', 0.6, { delay: rnd(0.02, 0.06) }); break;
      case 'glass': this.play('glass', 0.85, { delay: 0.003 }); break;
      case 'nails': if (scrap) this.play('ping', 0.7, { delay: 0.006, rate: 1.25 }); else this.play('impale', 0.9, { delay: 0.005 }); break;
      case 'freezer': this.play('frost', 0.7, { delay: 0.005 }); break;
      case 'hotplate': this.play('sizzle', scrap ? 0.45 : 0.95, { delay: 0.01, jitter: 0.06 }); break;
      case 'slime': this.play('gloop', 1.0); this.play('fizz', 0.4, { delay: 0.3 }); break;
      case 'electric': this.play('zap', 1.0); break;
      case 'spikes': if (scrap) { this.play('ping', 0.8, { rate: 0.8 }); this.play('clank', 0.6, { delay: 0.02, rate: 0.85 }); } else this.play('spike', 1.0); break;
    }
  }
}
