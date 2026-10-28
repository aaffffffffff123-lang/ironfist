// 철권 — 팔(살·속살·뼈) 메시, 상처 셰이더, 부상 진행
// 다치는 순서(맨주먹으로 벽을 칠 때 실제로 상하는 순서를 따름)
//   너클 살갗이 까지고 손등이 부어오름 → 새끼·약지 쪽 손등뼈가 부러져 너클이 푹 꺼지고 손가락이 비틀림
//   → 손가락뼈가 부러지거나 빠져 덜렁거리고 주먹이 풀림 → 깨진 뼈 끝이 살을 뚫고 나오고 힘줄이 드러남
//   → 손 앞쪽부터 짓이겨져 뭉개짐(떨어져 나가는 건 살점·뼛조각뿐) → 손목 위가 다 없어진 뒤엔 팔뚝 끝이 짓이겨지며 짧아짐
import * as THREE from 'three';
import ARM_B64 from './armdata.js';

// ------------------------------------------------------------------ 데이터 로드
function b64ToBytes(b64) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64);
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function inflate(bytes) {
  const ds = new DecompressionStream('gzip');
  return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
}

export async function loadArmAssets() {
  const bytes = b64ToBytes(ARM_B64);
  const buf = (bytes[0] === 0x1f && bytes[1] === 0x8b) ? await inflate(bytes) : bytes.buffer;
  const dv = new DataView(buf);
  const hl = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
  const raw = 4 + hl + ((4 - (hl % 4)) % 4);
  const T = { float32: Float32Array, int8: Int8Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array };
  const arr = (e) => { const C = T[e.dtype]; return new C(buf, raw + e.off, e.len / C.BYTES_PER_ELEMENT); };
  const geos = {};
  for (const [name, m] of Object.entries(header.meshes)) {
    const g = new THREE.BufferGeometry();
    const q = arr(m.pos), n = m.count, lo = m.qlo, sc = m.qsc;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = lo[k] + q[i * 3 + k] * sc[k];
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(arr(m.nrm)), 3, true));
    const si2 = arr(m.si2), w1 = arr(m.w1);
    const si = new Uint8Array(n * 4), sw = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = si2[i * 2]; si[i * 4 + 1] = si2[i * 2 + 1]; sw[i * 4] = w1[i]; sw[i * 4 + 1] = 255 - w1[i]; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
    g.setAttribute('aSeg', new THREE.BufferAttribute(new Uint8Array(arr(m.seg)), 1));
    if (m.col) g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(arr(m.col)), 3, true));
    if (m.ao) g.setAttribute('aAO', new THREE.BufferAttribute(new Uint8Array(arr(m.ao)), 1, true));
    if (m.nail) g.setAttribute('aNail', new THREE.BufferAttribute(new Uint8Array(arr(m.nail)), 1));
    const ix = arr(m.idx);
    g.setIndex(new THREE.BufferAttribute(ix instanceof Uint16Array ? new Uint16Array(ix) : new Uint32Array(ix), 1));
    g.computeBoundingSphere(); g.boundingSphere.radius += 0.2;
    geos[name] = g;
  }
  addSwellAttributes(geos.skin);
  // 위팔 살갗은 붓지 않음(같은 재질을 쓰므로 빈 값만 채움)
  geos.upper.setAttribute('aSmD', new THREE.BufferAttribute(new Float32Array(geos.upper.attributes.position.count * 3), 3));
  geos.upper.setAttribute('aSmN', new THREE.BufferAttribute(new Float32Array(geos.upper.attributes.position.count * 3), 3));
  buildCrushCenters(geos.skin);
  buildDorsal(geos.skin);
  return { header, geos };
}

// 손등 살갗 높이(x, z 칸마다 가장 높은 y) — 상처·튀어나온 뼈를 살갗 바로 밑에 놓으려고
let DORSAL = null;
function buildDorsal(g) {
  const P = g.attributes.position.array, SG = g.attributes.aSeg.array, n = g.attributes.position.count;
  const x0 = -0.06, z0 = -0.05, st = 0.002, NX = 61, NZ = 86;
  const y = new Float32Array(NX * NZ).fill(-1);
  for (let i = 0; i < n; i++) {
    if (SG[i] > 1) continue;   // 팔뚝·손바닥뼈 마디만(손가락 제외)
    const ix = Math.round((P[i * 3] - x0) / st), iz = Math.round((P[i * 3 + 2] - z0) / st);
    if (ix < 0 || ix >= NX || iz < 0 || iz >= NZ) continue;
    const k = iz * NX + ix; if (P[i * 3 + 1] > y[k]) y[k] = P[i * 3 + 1];
  }
  DORSAL = { x0, z0, st, NX, NZ, y };
}
function dorsalY(x, z) {
  const D = DORSAL, ix = Math.round((x - D.x0) / D.st), iz = Math.round((z - D.z0) / D.st);
  let best = -1;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const a = ix + dx, b = iz + dz; if (a < 0 || a >= D.NX || b < 0 || b >= D.NZ) continue;
    best = Math.max(best, D.y[b * D.NX + a]);
  }
  return best > -0.5 ? best : 0.015;
}

// 손등 부기: 살갗을 매끈하게 펴서(마디 사이 골·힘줄 골이 메워짐) 조금 부풀린 모양을 미리 계산해 둠
function addSwellAttributes(g) {
  const P = g.attributes.position.array, NA = g.attributes.normal, SG = g.attributes.aSeg.array, IX = g.index.array;
  const n = g.attributes.position.count;
  // 같은 자리 꼭짓점 묶기(이음매가 벌어지지 않게)
  const map = new Map(); const wid = new Int32Array(n); let W = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[i * 3] * 2e5) + ',' + Math.round(P[i * 3 + 1] * 2e5) + ',' + Math.round(P[i * 3 + 2] * 2e5);
    let w = map.get(k); if (w === undefined) { w = W++; map.set(k, w); } wid[i] = w;
  }
  // 붓는 자리: 손등·손바닥(손목 쪽 팔뚝 끝 포함), 손가락 첫마디 뿌리, 엄지 뿌리. 팔꿈치 쪽으로 갈수록 줄어듦
  const segW = { 0: 1, 1: 1, 2: 0.55, 5: 0.55, 8: 0.55, 11: 0.55, 14: 0.6, 15: 0.3 };
  const mask = new Float32Array(W), O = new Float64Array(W * 3);
  for (let i = 0; i < n; i++) {
    const w = wid[i], z = P[i * 3 + 2];
    const zf = Math.max(0, Math.min(1, (z + 0.045) / 0.055)); const zs = zf * zf * (3 - 2 * zf);
    mask[w] = Math.max(mask[w], (segW[SG[i]] || 0) * zs);
    O[w * 3] = P[i * 3]; O[w * 3 + 1] = P[i * 3 + 1]; O[w * 3 + 2] = P[i * 3 + 2];
  }
  // 이웃 목록
  const deg = new Int32Array(W);
  const nt = IX.length / 3;
  for (let t = 0; t < nt; t++) { const a = wid[IX[t * 3]], b = wid[IX[t * 3 + 1]], c = wid[IX[t * 3 + 2]]; deg[a] += 2; deg[b] += 2; deg[c] += 2; }
  const start = new Int32Array(W + 1); for (let w = 0; w < W; w++) start[w + 1] = start[w] + deg[w];
  const nb = new Int32Array(start[W]); const fill = start.slice(0, W);
  for (let t = 0; t < nt; t++) {
    const a = wid[IX[t * 3]], b = wid[IX[t * 3 + 1]], c = wid[IX[t * 3 + 2]];
    nb[fill[a]++] = b; nb[fill[a]++] = c; nb[fill[b]++] = a; nb[fill[b]++] = c; nb[fill[c]++] = a; nb[fill[c]++] = b;
  }
  let A = Float64Array.from(O), B = new Float64Array(W * 3);
  for (let it = 0; it < 18; it++) {
    for (let w = 0; w < W; w++) {
      const m = mask[w];
      if (m <= 0 || start[w + 1] === start[w]) { B[w * 3] = A[w * 3]; B[w * 3 + 1] = A[w * 3 + 1]; B[w * 3 + 2] = A[w * 3 + 2]; continue; }
      let sx = 0, sy = 0, sz = 0; const s0 = start[w], s1 = start[w + 1];
      for (let k = s0; k < s1; k++) { const v = nb[k]; sx += A[v * 3]; sy += A[v * 3 + 1]; sz += A[v * 3 + 2]; }
      const inv = 1 / (s1 - s0), l = 0.6 * m;
      B[w * 3] = A[w * 3] + l * (sx * inv - A[w * 3]);
      B[w * 3 + 1] = A[w * 3 + 1] + l * (sy * inv - A[w * 3 + 1]);
      B[w * 3 + 2] = A[w * 3 + 2] + l * (sz * inv - A[w * 3 + 2]);
    }
    const t = A; A = B; B = t;
  }
  // 매끈해진 면의 법선
  const NS = new Float64Array(W * 3);
  for (let t = 0; t < nt; t++) {
    const a = wid[IX[t * 3]], b = wid[IX[t * 3 + 1]], c = wid[IX[t * 3 + 2]];
    const ux = A[b * 3] - A[a * 3], uy = A[b * 3 + 1] - A[a * 3 + 1], uz = A[b * 3 + 2] - A[a * 3 + 2];
    const vx = A[c * 3] - A[a * 3], vy = A[c * 3 + 1] - A[a * 3 + 1], vz = A[c * 3 + 2] - A[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { NS[v * 3] += fx; NS[v * 3 + 1] += fy; NS[v * 3 + 2] += fz; }
  }
  const D = new Float32Array(n * 3), DN = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = wid[i], m = mask[w];
    if (m <= 0) continue;
    const nx = NA.getX(i), ny = NA.getY(i), nz = NA.getZ(i);
    let dx = A[w * 3] - O[w * 3], dy = A[w * 3 + 1] - O[w * 3 + 1], dz = A[w * 3 + 2] - O[w * 3 + 2];
    // 안으로 꺼지는 쪽은 빼서 골만 메워지고 튀어나온 데는 그대로
    const dn = dx * nx + dy * ny + dz * nz;
    if (dn < 0) { dx -= nx * dn; dy -= ny * dn; dz -= nz * dn; }
    const inflate = 0.0026 * m;
    D[i * 3] = dx + nx * inflate; D[i * 3 + 1] = dy + ny * inflate; D[i * 3 + 2] = dz + nz * inflate;
    let sx = NS[w * 3], sy = NS[w * 3 + 1], sz = NS[w * 3 + 2]; const L = Math.hypot(sx, sy, sz) || 1;
    sx /= L; sy /= L; sz /= L;
    if (sx * nx + sy * ny + sz * nz < 0) { sx = -sx; sy = -sy; sz = -sz; }
    DN[i * 3] = (sx - nx) * m; DN[i * 3 + 1] = (sy - ny) * m; DN[i * 3 + 2] = (sz - nz) * m;
  }
  g.setAttribute('aSmD', new THREE.BufferAttribute(D, 3));
  g.setAttribute('aSmN', new THREE.BufferAttribute(DN, 3));
}

// 뭉개질 때 옆으로 퍼지는 기준점: z 마다 살갗 단면의 가운데
let CRUSHC = null;
function buildCrushCenters(g) {
  const P = g.attributes.position.array, n = g.attributes.position.count;
  const z0 = -0.32, step = 0.004, N = Math.ceil((0.14 - z0) / step) + 1;
  const mnx = new Float32Array(N).fill(9), mxx = new Float32Array(N).fill(-9), mny = new Float32Array(N).fill(9), mxy = new Float32Array(N).fill(-9);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const b = Math.round((z - z0) / step); if (b < 0 || b >= N) continue;
    if (x < mnx[b]) mnx[b] = x; if (x > mxx[b]) mxx[b] = x; if (y < mny[b]) mny[b] = y; if (y > mxy[b]) mxy[b] = y;
  }
  const cx = new Float32Array(N), cy = new Float32Array(N), hw = new Float32Array(N), hh = new Float32Array(N);
  let lx = 0, ly = 0, lw = 0.03, lh = 0.025;
  for (let b = 0; b < N; b++) {
    if (mnx[b] < 8) { lx = (mnx[b] + mxx[b]) / 2; ly = (mny[b] + mxy[b]) / 2; lw = (mxx[b] - mnx[b]) / 2; lh = (mxy[b] - mny[b]) / 2; }
    cx[b] = lx; cy[b] = ly; hw[b] = lw; hh[b] = lh;
  }
  // 가운데에서 각도별로 가장 먼 살갗까지 거리(움푹한 데는 메움) — 짓이겨진 끝을 덮는 살덩이 모양
  const NA = 40, rad = new Float32Array(N * NA);
  for (let i = 0; i < n; i++) {
    const z = P[i * 3 + 2], b = Math.round((z - z0) / step); if (b < 0 || b >= N) continue;
    const dx = P[i * 3] - cx[b], dy = P[i * 3 + 1] - cy[b];
    const a = Math.floor(((Math.atan2(dy, dx) / (Math.PI * 2)) + 1) * NA) % NA;
    const r = Math.hypot(dx, dy);
    if (r > rad[b * NA + a]) rad[b * NA + a] = r;
  }
  for (let b = 0; b < N; b++) {
    // 빈 각도는 양옆에서 메움 + 살짝 고르게
    const row = rad.subarray(b * NA, b * NA + NA), tmp = Float32Array.from(row);
    for (let a = 0; a < NA; a++) if (!tmp[a]) { let k = 1; while (k < NA && !tmp[(a + k) % NA] && !tmp[(a - k + NA) % NA]) k++; tmp[a] = Math.max(tmp[(a + k) % NA], tmp[(a - k + NA) % NA]) || Math.min(hw[b], hh[b]); }
    for (let a = 0; a < NA; a++) row[a] = (tmp[(a + NA - 1) % NA] + tmp[a] * 2 + tmp[(a + 1) % NA]) / 4;
  }
  CRUSHC = { z0, step, N, cx, cy, hw, hh, NA, rad };
}
// z 에서 각도별 바깥선(가운데 기준 거리 배열)
function outlineAt(z) {
  const C = CRUSHC; let b = Math.round((z - C.z0) / C.step); b = Math.max(0, Math.min(C.N - 1, b));
  return C.rad.subarray(b * C.NA, b * C.NA + C.NA);
}
// z 에서 단면 가운데(x, y)와 반폭·반높이
function sectionAt(z) {
  const C = CRUSHC; let b = Math.round((z - C.z0) / C.step); b = Math.max(0, Math.min(C.N - 1, b));
  return { x: C.cx[b], y: C.cy[b], hw: C.hw[b], hh: C.hh[b] };
}

// ------------------------------------------------------------------ GLSL 공통
const NOISE_CORE = /* glsl */`
float h31(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm3(vec3 p){ return vnoise(p)*0.55 + vnoise(p*2.13+3.1)*0.3 + vnoise(p*4.31+7.7)*0.15; }
`;
const PERTURB = /* glsl */`
vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize( dFdx( surf_pos ) ); vec3 vSigmaY = normalize( dFdy( surf_pos ) ); vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN ); vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;
// 짓이겨진 살: 생살·엉긴 피·기름·뼛가루가 뒤섞임
const PULP_GLSL = /* glsl */`
vec3 pulp(vec3 p){
  float a = vnoise(p * 650.0), b = vnoise(p * 1700.0 + 5.0), c = vnoise(p * 280.0 + 9.0), d = vnoise(p * 1300.0 + 2.0);
  vec3 col = mix(vec3(0.40, 0.035, 0.028), vec3(0.70, 0.11, 0.075), a);
  col = mix(col, vec3(0.16, 0.006, 0.005), smoothstep(0.52, 0.8, c) * 0.85);
  col = mix(col, vec3(0.84, 0.64, 0.40), smoothstep(0.80, 0.92, b) * 0.55);
  col = mix(col, vec3(0.92, 0.88, 0.78), smoothstep(0.86, 0.95, d) * 0.65);
  return col;
}
`;
// 짓이겨진 끝의 단면: 열린 끝으로 보이는 안쪽 면을 단면처럼 칠함(색은 단면에 비친 무늬, 법선은 단면 방향)
const CAP_COLOR = /* glsl */`
  vec3 capC = vec3(0.0);
  if (capK > 0.5) {
    capC = pulp(vec3(vBind.xy * 1.15, 0.37));
    capC = mix(capC, vec3(0.22, 0.01, 0.008), smoothstep(0.35, 0.75, vnoise(vec3(vBind.xy * 160.0, 2.0))) * 0.55);
  }
`;
const CAP_NORMAL = /* glsl */`
  if (capK > 0.5) {
    vec3 cn_ = normalize(vCutN);
    float hc_ = vnoise(vec3(vBind.xy * 900.0, 1.0)) * 0.7 + vnoise(vec3(vBind.xy * 260.0, 3.0)) * 0.6;
    vec2 dH_ = vec2(dFdx(hc_), dFdy(hc_)) * 0.9;
    normal = perturbN(-vViewPosition, cn_, dH_, 1.0);
  }
`;
export const NW = 40;   // 상처 최대 개수
export const NSEG = 17;
const ND = 8;           // 꺼진 뼈(변형) 최대 개수

// 상처 종류
export const W = { BRUISE: 0, ABR: 1, CUT: 2, OPEN: 3, PUNCT: 4, BURN: 5, FROST: 6, ACID: 7, ELEC: 8, FRACT: 9, WIRE: 10 };

// 짓이겨져 벽에 발려 없어진 데는 그리지 않음(살갗·속살·그림자 공통)
const GONE_DISCARD = /* glsl */`
  float cu = vBind.z - uCrush.x;
  float cn = vnoise(vBind * 480.0);
  if (cu > uCrush.w * (0.75 + 0.5 * cn)) discard;
`;

const WOUND_GLSL = /* glsl */`
uniform vec4 uWA[${NW}];
uniform vec4 uWB[${NW}];
uniform int uWN;
uniform vec4 uCrush;
uniform float uTime;
uniform float uWet;
varying vec3 vBind;
flat varying float vSeg;
varying float vAO;
varying float vNail;
struct WSum { float bruise; float abr; float cut; float open; float punct; float burn; float frost; float acid; float elec; float blood; float fract; float deep; float wire; };
WSum woundSum(vec3 p){
  WSum s = WSum(0.,0.,0.,0.,0.,0.,0.,0.,0.,0.,0.,0.,0.);
  for (int i = 0; i < ${NW}; i++) {
    if (i >= uWN) break;
    vec4 A = uWA[i]; vec4 B = uWB[i];
    int t = int(B.x + 0.5); float k = B.y; float sd = B.z;
    vec3 q = p - A.xyz;
    // 먼 상처는 건너뜀(노이즈 계산 아끼기) — 철사 고리는 높이만 보므로 제외
    if (t != 10 && dot(q, q) > A.w * A.w * 5.4) continue;
    float nn = vnoise(p * 430.0 + sd * 17.3);
    float n2 = vnoise(p * 1300.0 + sd * 5.1);
    float d = length(q) / A.w + (nn - 0.5) * 0.62 + (n2 - 0.5) * 0.18;
    float core = 1.0 - smoothstep(0.45, 0.95, d);
    float halo = 1.0 - smoothstep(0.75, 1.75, d);
    if (t == 0) { s.bruise = max(s.bruise, halo * k); }
    else if (t == 1) { s.abr = max(s.abr, core * k); s.bruise = max(s.bruise, halo * k * 0.7); s.blood = max(s.blood, halo * k * 0.55); }
    else if (t == 2) { // 길쭉한 열상: w = 방향 seed로 만든 선
      vec3 ax = normalize(vec3(sin(sd*6.3), cos(sd*4.1)*0.6, cos(sd*6.3)));
      float along = dot(q, ax); vec3 perp = q - ax * along;
      float dl = length(perp) / (A.w * 0.16) + (nn - 0.5) * 0.9;
      float m = (1.0 - smoothstep(0.4, 1.0, dl)) * (1.0 - smoothstep(0.7, 1.0, abs(along) / A.w));
      s.cut = max(s.cut, m * k); s.blood = max(s.blood, halo * k * 0.8); s.bruise = max(s.bruise, halo * k * 0.3);
    }
    else if (t == 3) { s.open = max(s.open, core * k); s.abr = max(s.abr, halo * k); s.blood = max(s.blood, halo * k); s.bruise = max(s.bruise, halo * k * 0.6); s.deep = max(s.deep, core * k * B.w); }
    else if (t == 4) { // 구멍(못·유리·꼬챙이)
      float dp = length(q) / (A.w * 0.32) + (nn - 0.5) * 0.25;
      s.punct = max(s.punct, (1.0 - smoothstep(0.55, 1.0, dp)) * k);
      s.blood = max(s.blood, (1.0 - smoothstep(0.8, 2.6, dp)) * k);
      s.bruise = max(s.bruise, halo * k * 0.45);
    }
    else if (t == 5) { s.burn = max(s.burn, halo * k); }
    else if (t == 6) { s.frost = max(s.frost, core * k); s.blood = max(s.blood, halo * k * 0.35); }
    else if (t == 7) { s.acid = max(s.acid, halo * k); }
    else if (t == 8) { s.elec = max(s.elec, halo * k); }
    else if (t == 9) { s.fract = max(s.fract, core * k); }
    else if (t == 10) { // 철사가 파고든 고리 (z 축 둘레)
      float dz = abs(p.z - A.z) / (A.w * 0.12) + (nn - 0.5) * 0.8;
      s.wire = max(s.wire, (1.0 - smoothstep(0.5, 1.0, dz)) * k);
      s.blood = max(s.blood, (1.0 - smoothstep(0.6, 3.5, dz)) * k * 0.9);
    }
  }
  return s;
}
varying vec3 vCutN;
${PULP_GLSL}
`;

const VERT_DECL = /* glsl */`
attribute float aSeg;
#ifdef HAS_AO
attribute float aAO;
#endif
#ifdef HAS_NAIL
attribute float aNail;
#endif
#ifdef HAS_SWELL
attribute vec3 aSmD;
attribute vec3 aSmN;
#endif
uniform float uSwell[${NSEG}];
uniform float uSwellH;
uniform vec3 uImp;   // 충격 물결 — x: 맞은 뒤 시간(초), y: 세기, z: 물결이 시작하는 자리(바인드 z)
uniform vec4 uDA[${ND}];   // 꺼진 뼈: 가운데 xyz, 반지름
uniform vec4 uDB[${ND}];   // 꺼진 만큼 xyz, 같이 움직이는 손가락 마디 번호(-1 이면 없음)
uniform int uDN;
uniform vec4 uCrush;       // x: 짓이겨진 앞면(바인드 z), y: 덩어리 두께, z: 옆으로 퍼지는 정도, w: 이만큼 넘어간 살은 벽에 발려 없어짐
uniform vec3 uCrushC;      // xy: 단면 가운데, z: 울퉁불퉁한 정도
varying vec3 vBind;
flat varying float vSeg;
varying float vAO;
varying float vNail;
varying vec3 vCutN;
${NOISE_CORE}
// 벽에 맞는 순간 손목에서 팔꿈치 쪽으로 번지는 살 물결(바깥으로 밀리는 거리)
float impRip(float z) {
  float zz = uImp.z - z;                          // 시작점에서 팔꿈치 쪽으로 떨어진 거리
  float ph = uImp.x * 2.3 - zz;                   // 물결 앞머리 뒤로 얼마나 지났는지
  float on = smoothstep(-0.008, 0.008, zz) * smoothstep(-0.006, 0.018, ph);
  float wave = sin(ph * 72.0) * exp(-max(ph, 0.0) * 8.0);
  return uImp.y * 0.0052 * exp(-uImp.x * 8.0) * exp(-max(zz, 0.0) * 2.6) * wave * on;
}
// 손가락 뼈가 따로 옮겨 주는 몫은 빼기(뿌리가 같이 내려앉는 손가락)
float dentSeg(float sg) {
  #ifdef USE_SKINNING
  if (sg < 0.0) return 1.0;
  float wf = 0.0;
  if (abs(skinIndex.x - sg) < 0.5) wf += skinWeight.x;
  if (abs(skinIndex.y - sg) < 0.5) wf += skinWeight.y;
  if (abs(skinIndex.z - sg) < 0.5) wf += skinWeight.z;
  if (abs(skinIndex.w - sg) < 0.5) wf += skinWeight.w;
  return 1.0 - wf;
  #else
  return 1.0;
  #endif
}
// 부러져 꺼진 뼈(너클이 주저앉음)
vec3 dentDisp(vec3 p) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < ${ND}; i++) {
    if (i >= uDN) break;
    vec3 q = p - uDA[i].xyz; float r = uDA[i].w;
    float s2 = dot(q, q) / (r * r);
    if (s2 < 1.0) { float f = 1.0 - s2; d += uDB[i].xyz * (f * f) * dentSeg(uDB[i].w); }
  }
  return d;
}
vec3 dentNormal(vec3 p, vec3 n) {
  vec3 m = n;
  for (int i = 0; i < ${ND}; i++) {
    if (i >= uDN) break;
    vec3 q = p - uDA[i].xyz; float r = uDA[i].w;
    float s2 = dot(q, q) / (r * r);
    if (s2 < 1.0) m += dot(uDB[i].xyz, n) * 4.0 * (1.0 - s2) * q / (r * r) * dentSeg(uDB[i].w);
  }
  return normalize(m);
}
// 앞면부터 짓이겨짐: 앞면 너머 살은 납작하게 눌리고 옆으로 퍼지며 울퉁불퉁 뭉개짐
vec3 crushMove(vec3 t, vec3 p) {
  float u = p.z - uCrush.x;
  float T = uCrush.y, S = uCrush.z;
  vec2 c = uCrushC.xy;
  if (u < -0.012) return t;
  if (u <= 0.0) {
    // 앞면 바로 뒤: 눌려서 살짝 부풂
    float k = smoothstep(-0.012, 0.0, u);
    t.xy = c + (t.xy - c) * (1.0 + S * 0.3 * k);
    return t;
  }
  float e = exp(-u / T);
  float sp = 1.0 + S * (0.3 + 0.7 * (1.0 - exp(-u / 0.007)));
  vec3 q = p * 210.0;
  vec3 nz = vec3(vnoise(q), vnoise(q + 17.1), vnoise(q + 41.7)) - 0.5;
  float w = (1.0 - exp(-u / 0.004)) * uCrushC.z;
  t.xy = c + (t.xy - c) * sp + nz.xy * 0.0065 * w;
  t.z = uCrush.x + T * (1.0 - e) + (t.z - p.z) * e + nz.z * 0.005 * w;
  return t;
}
`;
// 물결이 지나가는 자리의 법선을 기울여 빛이 따라 출렁이게 + 부기·꺼진 뼈에 맞춘 법선
const VERT_NORMAL = /* glsl */`
#include <beginnormal_vertex>
#ifdef HAS_SWELL
objectNormal = normalize(objectNormal + aSmN * uSwellH);
#endif
objectNormal = dentNormal(position, objectNormal);
if (uImp.x < 0.42 && uImp.y > 0.0) {
  float rp0 = impRip(position.z), rp1 = impRip(position.z + 0.0015);
  objectNormal = normalize(objectNormal - vec3(0.0, 0.0, (rp1 - rp0) / 0.0015));
}
`;
const VERT_BEGIN = /* glsl */`
#include <begin_vertex>
vBind = position;
vSeg = aSeg;
#ifdef HAS_AO
vAO = aAO;
#else
vAO = 1.0;
#endif
#ifdef HAS_NAIL
vNail = aNail;
#else
vNail = 0.0;
#endif
#ifdef USE_SKINNING
transformed += OBJN * (skinWeight.x * uSwell[int(skinIndex.x + 0.5)] + skinWeight.y * uSwell[int(skinIndex.y + 0.5)]);
#else
transformed += OBJN * uSwell[int(aSeg + 0.5)];
#endif
#ifdef HAS_SWELL
transformed += aSmD * uSwellH;
#endif
transformed += dentDisp(position);
// 충격파: 벽에 맞는 순간 손목에서 팔꿈치 쪽으로 살이 출렁이며 번짐
if (uImp.x < 0.42 && uImp.y > 0.0) transformed += normal * impRip(position.z);
#ifndef IS_BONE
transformed = crushMove(transformed, position);
#endif
`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n#define OBJN objectNormal\n' + VERT_DECL)
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
#ifdef USE_SKINNING
vCutN = normalize((modelViewMatrix * (skinMatrix * vec4(0.0, 0.0, 1.0, 0.0))).xyz);
#else
vCutN = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
#endif`)
    .replace('#include <begin_vertex>', VERT_BEGIN);
}
// 짓이겨진 자리는 면이 각지게(구겨진 살)
const FLAT_NORMAL = /* glsl */`
  {
    vec3 fdx_ = dFdx(vViewPosition), fdy_ = dFdy(vViewPosition);
    vec3 fn_ = normalize(cross(fdx_, fdy_));
    normal = normalize(mix(normal, fn_, clamp(mashW * 0.85, 0.0, 0.85)));
  }
`;

// ------------------------------------------------------------------ 재질
function makeSkinMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  m.defines = { HAS_AO: '', HAS_NAIL: '', HAS_SWELL: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\nuniform float uWrap;\nuniform vec3 uSSS;\nuniform vec3 uSkinTint;\nuniform vec4 uAuraA;\nuniform vec4 uAuraB;\nuniform float uNailD[' + NSEG + '];\n' + NOISE_CORE + PERTURB + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      ${GONE_DISCARD}
      // 앞면 너머: 짓이겨져 눌린 살갗(피범벅). 열린 끝 안쪽은 단면
      float mashW = smoothstep(-0.0012, 0.0028, cu + (cn - 0.5) * 0.0045);
      float rimW = smoothstep(-0.013, -0.001, cu) * (1.0 - mashW);
      float capK = (uCrush.x < 0.15 && !gl_FrontFacing) ? 1.0 : 0.0;
      WSum ws = woundSum(vBind);
      float holeEdge = ws.open - 0.52;
      if (holeEdge > 0.0) discard;
      if (ws.acid > 0.82 && vnoise(vBind*600.0) < (ws.acid - 0.82) * 3.0) discard;
      if (ws.frost > 0.86) discard;
    `);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 col = diffuseColor.rgb * uSkinTint;
      float fd = gl_FrontFacing ? 1.0 : 0.0;
      // 손톱: 깨지면 밑에 피가 고여 검보라로 죽고 금이 감
      float nd = uNailD[int(vSeg + 0.5)] * vNail;
      if (nd > 0.0) {
        vec3 hem = mix(vec3(0.20, 0.03, 0.07), vec3(0.06, 0.01, 0.03), vnoise(vBind * 900.0));
        col = mix(col, hem, nd * 0.85);
        float crk = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(vBind * 520.0 + 4.0) - 0.5));
        col = mix(col, vec3(0.28, 0.015, 0.012), crk * nd);
      }
      // 멍: 보라-적색, 오래되면 짙어짐
      float bz = clamp(ws.bruise, 0.0, 1.0);
      vec3 bruiseC = mix(vec3(0.55, 0.20, 0.25), vec3(0.20, 0.06, 0.16), smoothstep(0.35, 1.0, bz));
      col = mix(col, col * bruiseC * 1.9, bz * 0.85);
      // 까짐: 붉은 생살 + 핏방울 점
      float dots = smoothstep(0.62, 0.8, vnoise(vBind * 2400.0));
      vec3 rawC = mix(vec3(0.62, 0.12, 0.09), vec3(0.32, 0.015, 0.01), dots);
      rawC = mix(rawC, vec3(0.80, 0.42, 0.36), smoothstep(0.55, 0.9, vnoise(vBind * 700.0)) * 0.35);
      col = mix(col, rawC, clamp(ws.abr, 0.0, 1.0));
      // 열상
      col = mix(col, vec3(0.16, 0.0, 0.0), clamp(ws.cut, 0.0, 1.0));
      // 구멍
      col = mix(col, vec3(0.06, 0.0, 0.0), clamp(ws.punct, 0.0, 1.0));
      // 구멍 테두리 (열린 상처 가장자리 찢긴 살)
      float rim = smoothstep(-0.18, 0.0, holeEdge) * step(0.05, ws.open);
      col = mix(col, vec3(0.42, 0.04, 0.03), rim);
      // 화상: 붉게 → 물집 → 숯
      float bu = clamp(ws.burn, 0.0, 1.0);
      col = mix(col, vec3(0.70, 0.18, 0.10), smoothstep(0.0, 0.35, bu) * 0.8);
      float blister = smoothstep(0.55, 0.8, vnoise(vBind * 520.0)) * smoothstep(0.3, 0.6, bu) * (1.0 - smoothstep(0.75, 0.95, bu));
      col = mix(col, vec3(0.95, 0.82, 0.55), blister * 0.8);
      float charM = smoothstep(0.6, 1.0, bu + (vnoise(vBind * 380.0) - 0.5) * 0.4);
      col = mix(col, vec3(0.035, 0.025, 0.02), charM);
      // 동상으로 벗겨진 자리: 창백한 생살 + 성에
      float fr = clamp(ws.frost, 0.0, 1.0);
      col = mix(col, vec3(0.86, 0.55, 0.52), fr);
      col = mix(col, vec3(0.92, 0.95, 1.0), fr * smoothstep(0.7, 0.9, vnoise(vBind * 1800.0)) * 0.8);
      // 산: 누렇게 녹아내림
      float ac = clamp(ws.acid, 0.0, 1.0);
      col = mix(col, vec3(0.80, 0.70, 0.30) * mix(1.0, 0.55, vnoise(vBind * 900.0)), smoothstep(0.0, 0.5, ac) * 0.75);
      col = mix(col, vec3(0.50, 0.08, 0.05), smoothstep(0.45, 0.85, ac) * 0.85);
      // 감전: 검게 탄 점 + 번개 무늬
      float el = clamp(ws.elec, 0.0, 1.0);
      float lfern = 1.0 - smoothstep(0.0, 0.035, abs(fbm3(vBind * 260.0) - 0.5));
      col = mix(col, vec3(0.55, 0.12, 0.10), el * lfern * 0.9);
      col = mix(col, vec3(0.03, 0.02, 0.02), smoothstep(0.55, 1.0, el) * smoothstep(0.55, 0.75, vnoise(vBind * 300.0)));
      // 철사 고리
      col = mix(col, vec3(0.20, 0.01, 0.01), clamp(ws.wire, 0.0, 1.0));
      // 피: 젖은 검붉은색
      float bl = clamp(ws.blood * (0.75 + 0.5 * vnoise(vBind * 260.0)), 0.0, 1.0);
      col = mix(col, vec3(0.25, 0.008, 0.008), bl * 0.85);
      // 짓이겨진 앞면 바로 뒤: 살갗이 쓸리고 피범벅
      col = mix(col, mix(rawC, vec3(0.30, 0.012, 0.01), 0.45 + 0.3 * vnoise(vBind * 340.0)), rimW * 0.8);
      // 짓이겨진 덩어리에 남은 살갗 조각: 피에 젖어 검붉음
      if (mashW > 0.0) col = mix(col, mix(vec3(0.46, 0.06, 0.045), vec3(0.20, 0.01, 0.008), vnoise(vBind * 900.0)), mashW * 0.88);
      // 안쪽 면(구멍으로 보이는 속). 짓이겨졌으면 열린 끝으로 보이는 단면 — 안쪽 면에서만 계산
      if (fd < 0.5) {
        ${CAP_COLOR}
        vec3 subC = mix(vec3(0.30, 0.03, 0.02), vec3(0.62, 0.42, 0.20), smoothstep(0.55, 0.85, vnoise(vBind * 820.0)) * 0.6);
        subC = mix(subC, vec3(0.14, 0.006, 0.004), smoothstep(0.4, 0.8, vnoise(vBind * 300.0 + 2.0)) * 0.5);
        col = mix(subC, capC, capK);
      }
      // 모아치기 냉기: 핏기가 가시고 너클부터 손목 쪽으로 서리가 번짐
      if (uAuraA.x > 0.001) {
        float frA = uAuraA.x;
        float zT = 0.13 - frA * 0.21;
        float cover = smoothstep(zT - 0.012, zT + 0.012, vBind.z + (vnoise(vBind * 160.0) - 0.5) * 0.03);
        col = mix(col, col * vec3(0.7, 0.86, 1.08), frA * 0.65);
        vec3 iceC = mix(vec3(0.30, 0.55, 0.92), vec3(0.74, 0.88, 1.0), smoothstep(0.5, 0.85, vnoise(vBind * 620.0)));
        // 서리는 군데군데 덩어리로 앉고, 그 사이로 시퍼렇게 언 살이 보임
        float frP = smoothstep(0.38, 0.62, vnoise(vBind * 260.0 + 3.0) * 0.7 + vnoise(vBind * 900.0) * 0.3);
        col = mix(col, iceC, cover * frA * (0.12 + 0.8 * frP));
      }
      // 모아치기 중력: 살갗이 검보랏빛으로 죽음
      if (uAuraA.w > 0.001) col = mix(col, col * vec3(0.16, 0.06, 0.2), uAuraA.w * 0.9 * (0.35 + 0.65 * smoothstep(-0.2, 0.04, vBind.z)));
      diffuseColor.rgb = col;
      float wetness = max(max(bl, ws.abr), max(ws.cut, max(rim, max(ws.acid, max(mashW, max(rimW * 0.8, capK))))));
    `);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor * (0.92 + 0.16 * vnoise(vBind * 800.0)), 0.18, clamp(wetness * 1.1, 0.0, 1.0));
      roughnessFactor = mix(roughnessFactor, 0.95, charM);
      roughnessFactor = mix(roughnessFactor, 0.3, vNail * 0.6 * (1.0 - nd));
      roughnessFactor = mix(roughnessFactor, 0.42, 1.0 - fd);
      roughnessFactor = mix(roughnessFactor, 0.2 + 0.25 * vnoise(vec3(vBind.xy * 500.0, 4.0)), capK);
    `);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        // 피부 결(주름·모공) + 상처 요철 — 화면공간 범프
        float hgt = vnoise(vBind * 1500.0) * 0.6 + vnoise(vBind * vec3(5200.0, 5200.0, 1800.0)) * 0.4;
        float bump = 0.0016;
        hgt += (vnoise(vBind * 900.0) * (ws.abr + ws.acid * 0.8 + charM + rimW) ) * 3.0;
        bump += 0.006 * clamp(ws.abr + blister + ws.acid + charM + rimW, 0.0, 1.0);
        vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * bump * 60.0;
        normal = perturbN(-vViewPosition, normal, dH, faceDirection);
      }
      ${FLAT_NORMAL}
      ${CAP_NORMAL}
    `);
    f = f.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
      `float wrapNL_ = saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) );
       vec3 irrD_ = directLight.color * ( dotNL + uSSS * max( wrapNL_ - dotNL, 0.0 ) );
       reflectedLight.directDiffuse += irrD_ * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
    f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
      float aoK = mix(1.0, vAO, 0.9);
      reflectedLight.indirectDiffuse *= aoK;
      reflectedLight.indirectSpecular *= aoK;
      reflectedLight.directDiffuse *= mix(1.0, vAO, 0.35);
    `);
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (dot(uAuraA, uAuraA) + dot(uAuraB, uAuraB) > 1e-6) {
        float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
        // 불: 너클·손등이 달아올라 이글거림
        if (uAuraA.y > 0.001) {
          float fl = 0.6 + 0.4 * vnoise(vec3(vBind.xy * 190.0, uTime * 9.0));
          float zone = 0.45 + 0.55 * smoothstep(-0.05, 0.08, vBind.z);
          totalEmissiveRadiance += vec3(1.35, 0.3, 0.03) * uAuraA.y * (0.2 + 0.8 * fres) * fl * zone;
        }
        // 전기: 살갗 밑으로 번개 무늬가 번쩍
        if (uAuraA.z > 0.001) {
          float vein = 1.0 - smoothstep(0.0, 0.022, abs(fbm3(vBind * 210.0 + vec3(0.0, 0.0, floor(uTime * 24.0) * 0.37)) - 0.5));
          float flick = step(0.32, vnoise(vec3(floor(uTime * 30.0), 1.0, 2.0)));
          float ez = 0.25 + 0.75 * smoothstep(-0.16, 0.04, vBind.z);
          totalEmissiveRadiance += vec3(0.06, 0.32, 1.5) * uAuraA.z * (vein * (0.25 + 1.0 * flick) * ez + fres * 0.3);
        }
        totalEmissiveRadiance += vec3(0.22, 0.42, 0.72) * uAuraA.x * fres * 0.6;
        totalEmissiveRadiance += vec3(0.38, 0.06, 0.9) * uAuraA.w * fres * 0.6;
        totalEmissiveRadiance += vec3(1.5, 0.72, 0.08) * uAuraB.x * (0.06 + 1.0 * fres) * (0.85 + 0.15 * sin(uTime * 40.0));
        totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * (uAuraB.y * fres * 0.75 + uAuraB.z * (0.12 + 0.8 * fres));
        totalEmissiveRadiance += vec3(1.25, 0.26, 0.04) * uAuraB.w * smoothstep(0.02, 0.09, vBind.z) * (0.55 + 0.45 * vnoise(vBind * 300.0));
      }
    `);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-skin-6';
  return m;
}

// 속살(근육·지방). 손등 너클 쪽엔 손가락 펴는 힘줄이 지나감
function makeMeatMaterial(U, anat) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, side: THREE.DoubleSide });
  const f4 = (v) => v.toFixed(4);
  // 힘줄 선: 손목 쪽(x, z) → 너클 꼭대기(x, z), 그리고 양 끝의 속살 윗면 높이
  const ten = anat.MCP.map((p, i) => `vec4(${f4(p.x * 0.55)}, ${f4(-0.004)}, ${f4(p.x)}, ${f4(p.z + 0.002)})`).join(', ');
  const tenY = anat.MCP.map((p, i) => `vec2(${f4(dorsalY(p.x * 0.55, -0.004) - 0.0035)}, ${f4(p.y + anat.MCP_R[i] - 0.0005)})`).join(', ');
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + NOISE_CORE + PERTURB + WOUND_GLSL + `
const vec4 TEN[4] = vec4[4](${ten});
const vec2 TENY[4] = vec2[4](${tenY});
float tendonAt(vec3 p) {
  float t = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 a = TEN[i].xy, b = TEN[i].zw;
    vec2 pa = p.xz - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * h) + (vnoise(p * 900.0) - 0.5) * 0.0003;
    // 속살 윗면(손등 쪽)에만: 너클 앞 비탈로 번지지 않게
    float ty = mix(TENY[i].x, TENY[i].y, h);
    float onTop = smoothstep(ty - 0.0032, ty - 0.0008, p.y);
    t = max(t, (1.0 - smoothstep(0.0009, 0.0015, d)) * onTop);
  }
  return t * smoothstep(-0.01, 0.01, p.z);
}
`);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      ${GONE_DISCARD}
      float mashW = smoothstep(-0.003, 0.002, cu);
      float capK = (uCrush.x < 0.15 && (!gl_FrontFacing || cu > -0.03)) ? 1.0 : 0.0;
      WSum ws = woundSum(vBind);
      if (ws.deep > 0.62) discard;
    `);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      float fd = gl_FrontFacing ? 1.0 : 0.0;
      // 근육 결 + 지방 + 근막
      float fib = vnoise(vec3(vBind.x * 2600.0, vBind.y * 2600.0, vBind.z * 260.0));
      vec3 muscle = mix(vec3(0.42, 0.035, 0.03), vec3(0.62, 0.09, 0.07), fib);
      float fat = smoothstep(0.74, 0.86, vnoise(vBind * 380.0 + 3.0));
      vec3 c = mix(muscle, vec3(0.80, 0.58, 0.40), fat * 0.45);
      c *= mix(0.55, 1.0, clamp(ws.open + ws.deep + ws.abr, 0.0, 1.0));
      c = mix(c, vec3(0.85, 0.80, 0.78), smoothstep(0.82, 0.9, vnoise(vec3(vBind.x*900.0, vBind.y*900.0, vBind.z*120.0))) * 0.4);
      // 힘줄: 희고 반들, 길이 방향 결
      float tend = tendonAt(vBind) * (1.0 - mashW);
      vec3 tc = mix(vec3(0.86, 0.82, 0.74), vec3(0.96, 0.93, 0.86), vnoise(vec3(vBind.x * 3000.0, vBind.y * 3000.0, vBind.z * 300.0)));
      c = mix(c, tc, tend);
      c = mix(c * 0.55, c, smoothstep(0.0, 0.5, 1.0 - ws.deep));
      if (mashW > 0.0) c = mix(c, pulp(vBind), mashW);
      c = mix(vec3(0.12, 0.005, 0.004), c, fd);
      ${CAP_COLOR}
      if (capK > 0.5) c = capC;
      diffuseColor.rgb = c;
    `);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.2, tend);
      roughnessFactor = mix(roughnessFactor, 0.16, mashW);
      roughnessFactor = mix(roughnessFactor, 0.2 + 0.25 * vnoise(vec3(vBind.xy * 500.0, 4.0)), capK);
    `);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float hm = vnoise(vec3(vBind.x * 2600.0, vBind.y * 2600.0, vBind.z * 260.0)) * 0.6 + vnoise(vBind * 900.0) * 0.5;
        vec2 dHm = vec2(dFdx(hm), dFdy(hm)) * 0.25 * (1.0 - tend * 0.7);
        normal = perturbN(-vViewPosition, normal, dHm, faceDirection);
      }
      ${FLAT_NORMAL}
      ${CAP_NORMAL}
    `);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-meat-2';
  return m;
}

// 뼈: 평소엔 살 속에 숨어 있고, 살이 터진 데와 짓이겨진 앞면에서만 보임. 앞면 너머로는 쪼개진 끝이 들쭉날쭉 삐져나옴
function makeBoneMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  m.defines = { IS_BONE: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + NOISE_CORE + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float cu = vBind.z - uCrush.x;
      // 쪼개진 끝: 들쭉날쭉한 가시
      float jag = 0.0015 + 0.0085 * smoothstep(0.3, 1.0, vnoise(vec3(vBind.xy * 950.0, vBind.z * 60.0))) + 0.002 * vnoise(vec3(vBind.xy * 300.0, 1.7));
      if (cu > jag) discard;
      WSum ws = woundSum(vBind);
      if (max(ws.open, ws.deep) < 0.03 && cu < -0.016) discard;
    `);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 c = mix(vec3(0.80, 0.74, 0.60), vec3(0.93, 0.89, 0.78), vnoise(vBind * 900.0));
      float crack = clamp(ws.fract, 0.0, 1.0) * smoothstep(0.44, 0.5, 1.0 - abs(vnoise(vBind * 700.0) - 0.5));
      c = mix(c, vec3(0.20, 0.02, 0.01), crack);
      float bl = clamp(ws.blood + ws.open * 0.6 + ws.deep + smoothstep(-0.008, -0.001, cu) * (1.0 - 0.75 * smoothstep(0.001, 0.006, cu)) * 0.85, 0.0, 1.0) * (0.6 + 0.4 * vnoise(vBind * 400.0));
      c = mix(c, vec3(0.35, 0.02, 0.015), bl * 0.75);
      // 부러진 뼈 속: 골수
      c = mix(mix(vec3(0.42, 0.06, 0.04), vec3(0.62, 0.20, 0.12), vnoise(vBind * 1200.0)), c, gl_FrontFacing ? 1.0 : 0.0);
      diffuseColor.rgb = c;
    `);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-bone-2';
  return m;
}

// 짓이겨진 끝을 덮는 살덩이: 생살·엉긴 피·기름·뼛가루, 젖어서 번들
function makePulpMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\n' + NOISE_CORE + PERTURB + PULP_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 pc = pulp(vLoc * 1.05);
        pc = mix(pc, vec3(0.20, 0.008, 0.006), smoothstep(0.4, 0.8, vnoise(vLoc * 170.0)) * 0.5);
        diffuseColor.rgb = pc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = 0.16 + 0.3 * vnoise(vLoc * 520.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float hc = vnoise(vLoc * 900.0) * 0.7 + vnoise(vLoc * 260.0) * 0.6; vec2 dH = vec2(dFdx(hc), dFdy(hc)) * 0.9; normal = perturbN(-vViewPosition, normal, dH, faceDirection); }`);
  };
  m.customProgramCacheKey = () => 'cg-pulp-1';
  return m;
}
// 짓이겨진 끝 살덩이(바인드 좌표): 단면 바깥선 안을 채우고 가운데가 울퉁불퉁 솟음. 가장자리는 눌린 살갗 뒤로 숨김
function mashCapGeometry(z, S, seed) {
  const sec = sectionAt(z), R = outlineAt(z), NA = R.length, NR = 6;
  const hsh = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return v - Math.floor(v); };
  const vn = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hsh(ix, iy), b = hsh(ix + 1, iy), c = hsh(ix, iy + 1), d = hsh(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const H = z > 0.01 ? 0.0038 : 0.003;
  const pos = [sec.x, sec.y, z - 0.0015 + H + (vn(3.1, 7.7) - 0.5) * 0.002], idx = [];
  for (let k = 1; k <= NR; k++) {
    const t = k / NR;
    for (let j = 0; j < NA; j++) {
      const a = ((j + 0.5) / NA) * Math.PI * 2;
      const edge = 1 + (vn(j * 0.9, 1.3) - 0.5) * 0.18 * t * t;
      const rr = R[j] * (1 + S * 0.3) * 0.94 * t * edge;
      const x = sec.x + Math.cos(a) * rr, y = sec.y + Math.sin(a) * rr;
      const dome = H * Math.pow(Math.max(0, 1 - t * t), 0.7);
      const lump = (vn(x * 260, y * 260) - 0.5) * 0.0045 * (0.35 + 0.65 * (1 - t)) + (vn(x * 700 + 9, y * 700) - 0.5) * 0.0015;
      pos.push(x, y, k === NR ? z - 0.004 : z - 0.0015 + dome + lump);
    }
  }
  for (let j = 0; j < NA; j++) idx.push(0, 1 + j, 1 + (j + 1) % NA);
  for (let k = 1; k < NR; k++) for (let j = 0; j < NA; j++) {
    const a = 1 + (k - 1) * NA + j, b = 1 + (k - 1) * NA + (j + 1) % NA, c = 1 + k * NA + j, d = 1 + k * NA + (j + 1) % NA;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 찢긴 살가죽: 바깥은 피 묻은 살갗, 안쪽은 생살
function makeFlapMaterial(tint) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = { value: tint };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\nuniform vec3 uTint;\n' + NOISE_CORE + PULP_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 outer = diffuseColor.rgb * uTint;
        outer = mix(outer, vec3(0.25, 0.008, 0.008), smoothstep(0.45, 0.8, vnoise(vLoc * 900.0)) * 0.55);
        vec3 inner = pulp(vLoc * 1.3) * 0.85;
        diffuseColor.rgb = gl_FrontFacing ? outer : inner;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = gl_FrontFacing ? 0.32 + 0.2 * vnoise(vLoc * 600.0) : 0.16;`);
  };
  m.customProgramCacheKey = () => 'cg-flap-1';
  return m;
}
// 너덜거리는 살가죽 한 장(로컬: x 폭, y 바깥, z 앞). 바나나 껍질처럼 바깥으로 젖혀짐
function flapGeometry(w, L, curl, seed) {
  const R = (k) => { const v = Math.sin(k * 91.7 + seed * 47.3) * 43758.5453; return v - Math.floor(v); };
  const NS = 7, NW_ = 4, pos = [], col = [], idx = [];
  const lin = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
  const SK = lin(0.98, 0.88, 0.82), BL = lin(0.55, 0.06, 0.05);
  let y = 0, z = 0;
  const rows = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, th = 0.25 + curl * t;
    if (i) { y += Math.sin(th) * L / NS; z += Math.cos(th) * L / NS; }
    rows.push([y, z, t]);
  }
  for (let i = 0; i <= NS; i++) {
    const [yy, zz, t] = rows[i];
    const half = w * 0.5 * (1 - 0.55 * t) * (0.85 + R(i) * 0.3);
    for (let j = 0; j <= NW_; j++) {
      const u = j / NW_ - 0.5;
      const rag = i === NS ? (R(j + 20) - 0.5) * L * 0.18 : 0;
      pos.push(u * 2 * half, yy + rag * Math.sin(0.25 + curl), zz + rag * Math.cos(0.25 + curl) + (R(i * 5 + j) - 0.5) * 0.0008);
      const b = Math.min(1, (1 - t) * 0.7 + R(i * 7 + j + 3) * 0.35);
      col.push(...SK.map((c, k) => c + (BL[k] - c) * b * 0.75));
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NW_; j++) {
    const a = i * (NW_ + 1) + j, b = a + 1, c = a + NW_ + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// z 에서 팔뚝뼈(요골·척골) 단면 [x, y, r]
function forearmBonesAt(z) {
  const X = HEADER.xsec;
  let best = null;
  for (const x of X) if (x.bones.length && (!best || Math.abs(x.z - z) < Math.abs(best.z - z))) best = x;
  return best ? best.bones : [];
}

// 그림자: 살과 똑같이 붓고 꺼지고 짓이겨짐
function makeDepthMaterial(U) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.defines = { HAS_SWELL: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#define OBJN normal\n' + VERT_DECL)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uCrush;\nvarying vec3 vBind;\nflat varying float vSeg;\n' + NOISE_CORE)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GONE_DISCARD);
  };
  m.customProgramCacheKey = () => 'cg-depth-2';
  return m;
}

// 잔상(잔상 연타): 살과 똑같이 붓고 짓이겨진 모양 그대로, 반투명하게 빛나는 팔
export function makeGhostMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false, emissive: new THREE.Color(0.3, 0.27, 0.32), emissiveIntensity: 1 });
  m.defines = { HAS_AO: '', HAS_NAIL: '', HAS_SWELL: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uCrush;\nvarying vec3 vBind;\n' + NOISE_CORE)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + GONE_DISCARD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vec3(0.9, 0.86, 0.9);\n  diffuseColor.a *= smoothstep(-0.15, 0.03, vBind.z);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 0.15 + 1.5 * pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);`);
  };
  m.customProgramCacheKey = () => 'cg-ghost-1';
  return m;
}

// ------------------------------------------------------------------ 상수/해부
const SEG = {};
let ANAT = null, HEADER = null;

export function initAnatomy(header) {
  HEADER = header;
  header.segs.forEach((n, i) => (SEG[n] = i));
  const a = header.anat;
  const v = (x) => new THREE.Vector3().fromArray(x);
  ANAT = {
    MCP: a.MCP.map(v), PIP: a.PIP.map(v), DIP: a.DIP.map(v), TIP: a.TIP.map(v),
    T: a.T.map(v), FDIR: a.FDIR.map((f) => f.map(v)), MCP_R: a.MCP_R, FR: a.FR,
  };
  return { SEG, ANAT };
}
export { SEG, ANAT };

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };

// 뭉개짐이 진행되는 자리(바인드 z)
const FIST_FRONT = 0.099;   // 주먹 앞면
const NO_CRUSH = 0.16;      // 아직 안 뭉개짐
const WRIST_Z = 0.004;      // 손목
const ELBOW_Z = -0.262;     // 팔꿈치 바로 앞
const CRUSH_I0 = 0.30;      // 이 손실부터 손 앞면이 짓이겨지기 시작
const LUMP_T = 0.0045;      // 짓이겨져 눌린 살 두께
function crushZOf(I) {
  if (I <= CRUSH_I0) return NO_CRUSH;
  if (I < 0.5) return FIST_FRONT - ((I - CRUSH_I0) / (0.5 - CRUSH_I0)) * (FIST_FRONT - WRIST_Z);
  return WRIST_Z - Math.min(1, (I - 0.5) / 0.5) * (WRIST_Z - ELBOW_Z);
}

// ------------------------------------------------------------------ 튀어나온 뼛조각
let _shardGeos = null;
function shardGeometries() {
  if (_shardGeos) return _shardGeos;
  _shardGeos = [0, 1, 2].map((sd) => {
    const R = (k) => { const x = Math.sin(k * 91.7 + sd * 47.3 + 3.1) * 43758.5453; return x - Math.floor(x); };
    const lin = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];
    const IV = lin(0.95, 0.91, 0.82), IV2 = lin(0.84, 0.78, 0.64), BL = lin(0.42, 0.04, 0.03), MAR = lin(0.55, 0.14, 0.09);
    const M = 10, K = 7, a0 = R(1) * 6.28;
    // 비스듬히 쪼개진 끝: 한쪽은 길고 뾰족, 반대쪽은 짧음 + 들쭉날쭉
    const top = []; for (let j = 0; j < M; j++) { const a = (j / M) * Math.PI * 2; top.push(0.42 + 0.58 * Math.pow(0.5 + 0.5 * Math.cos(a - a0), 1.6) + (R(j + 30) - 0.5) * 0.12); }
    const pos = [], col = [], idx = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      for (let j = 0; j < M; j++) {
        const a = (j / M) * Math.PI * 2;
        const y = t * top[j];
        // 끝으로 갈수록 가늘어지고, 긴 쪽 끝은 뾰족하게 모임
        const tipK = Math.max(0, y - 0.42) / 0.58;
        const rr = (1 - 0.22 * y) * (1 - 0.7 * tipK * tipK) * (0.92 + R(j * 3 + k + 11) * 0.16);
        pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr * 0.85);
        const v = 0.86 + R(j * 7 + k + 50) * 0.28;
        const c = y < 0.28 ? BL.map((x, i) => x + (IV2[i] - x) * (y / 0.28) ** 1.5) : IV.map((x, i) => x + (IV2[i] - x) * R(j + k * 9 + 70) * 0.7);
        col.push(c[0] * v, c[1] * v, c[2] * v);
      }
    }
    for (let k = 0; k < K; k++) for (let j = 0; j < M; j++) {
      const a = k * M + j, b = k * M + (j + 1) % M, c = (k + 1) * M + j, d = (k + 1) * M + (j + 1) % M;
      idx.push(a, c, b, b, c, d);
    }
    // 쪼개진 단면(골수): 끝 테두리를 안쪽으로 모음
    const ci = pos.length / 3; pos.push(0, 0.44, 0); col.push(...MAR);
    for (let j = 0; j < M; j++) idx.push(ci, K * M + (j + 1) % M, K * M + j);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
  return _shardGeos;
}

// 손가락 마디 하나의 흔들림(굽힘 th, 옆 ph)
function jointStep(J, lam, th0, ph0, F, dir, side, h) {
  const K = 1400 - 1320 * lam, C = 2 * 0.3 * Math.sqrt(K);
  const cx = dir.y * F.z - dir.z * F.y, cy = dir.z * F.x - dir.x * F.z, cz = dir.x * F.y - dir.y * F.x;
  const ts = cx * side.x + cy * side.y + cz * side.z;
  const G = 1.0 * lam;
  J.om += (-K * (J.th - th0) - C * J.om + G * cx) * h; J.th += J.om * h;
  const Ks = K * 1.8, Cs = 2 * 0.36 * Math.sqrt(Ks);
  J.nu += (-Ks * (J.ph - ph0) - Cs * J.nu + G * 0.7 * ts) * h; J.ph += J.nu * h;
  if (J.th < -0.38) { J.th = -0.38; J.om = Math.max(0, J.om) * 0.3; }
  if (J.th > 0.5) { J.th = 0.5; J.om = Math.min(0, J.om) * 0.3; }
  if (J.ph < -0.22) { J.ph = -0.22; J.nu = Math.max(0, J.nu) * 0.3; }
  if (J.ph > 0.22) { J.ph = 0.22; J.nu = Math.min(0, J.nu) * 0.3; }
}
const AX_X = new THREE.Vector3(1, 0, 0);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ------------------------------------------------------------------ 팔
export class Arm {
  constructor(assets, side, opts = {}) {
    this.side = side;               // 'L' | 'R'
    this.sign = side === 'L' ? -1 : 1;
    const U = this.U = {
      uWA: { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, 0, 0.01)) },
      uWB: { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uWN: { value: 0 },
      uSwell: { value: new Array(NSEG).fill(0) },
      uSwellH: { value: 0 },
      uImp: { value: new THREE.Vector3(9, 0, 0.015) },
      uDA: { value: Array.from({ length: ND }, () => new THREE.Vector4(0, 0, 0, 0.01)) },
      uDB: { value: Array.from({ length: ND }, () => new THREE.Vector4(0, 0, 0, -1)) },
      uDN: { value: 0 },
      uCrush: { value: new THREE.Vector4(NO_CRUSH, 0.0045, 0.24, 0.012) },
      uCrushC: { value: new THREE.Vector3(0, 0, 1) },
      uNailD: { value: new Array(NSEG).fill(0) },
      uTime: { value: 0 },
      uWet: { value: 0 },
      uWrap: { value: 0.55 },
      uSSS: { value: new THREE.Color(1.0, 0.32, 0.20) },
      uSkinTint: { value: new THREE.Color().setRGB(...(new URLSearchParams(location.search).get('tint') || '0.86,0.70,0.60').split(',').map(Number)) },
      // 모아치기 기운 — A: 서리, 불, 전기, 중력 / B: 금빛, 테두리빛, 완충 번쩍, 맞은 뒤 남은 열
      uAuraA: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAuraB: { value: new THREE.Vector4(0, 0, 0, 0) },
    };
    this.squash = 0;                      // 벽에 맞아 손이 눌린 정도(0~1, 게임이 매 프레임 넣음)
    this.root = new THREE.Group();        // 위치·자세 (게임이 조종)
    this.mirror = new THREE.Group();      // 오른팔은 좌우 반전
    if (side === 'R') this.mirror.scale.x = -1;
    this.root.add(this.mirror);
    // 뼈대
    const bones = HEADER.segs.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
    HEADER.segs.forEach((n, i) => {
      const p = HEADER.parent[i];
      const piv = new THREE.Vector3().fromArray(HEADER.pivot[i]);
      if (p < 0) bones[i].position.copy(piv);
      else { bones[i].position.copy(piv).sub(new THREE.Vector3().fromArray(HEADER.pivot[p])); bones[p].add(bones[i]); }
    });
    this.bones = bones;
    this.basePos = bones.map((b) => b.position.clone());
    this.skeleton = new THREE.Skeleton(bones);
    this.skinMat = makeSkinMaterial(U);
    this.meatMat = makeMeatMaterial(U, ANAT);
    this.boneMat = makeBoneMaterial(U);
    const mk = (geo, mat) => { const m = new THREE.SkinnedMesh(geo, mat); m.frustumCulled = false; return m; };
    this.skin = mk(assets.geos.skin, this.skinMat);
    this.upper = mk(assets.geos.upper, this.skinMat);
    this.meat = mk(assets.geos.meat, this.meatMat);
    this.bone = mk(assets.geos.bone, this.boneMat);
    this.skin.add(bones[0]);
    this.mirror.add(this.skin, this.upper, this.meat, this.bone);
    this.skin.bind(this.skeleton);
    for (const m of [this.upper, this.meat, this.bone]) m.bind(this.skeleton, this.skin.bindMatrix);
    this.skin.castShadow = true; this.skin.receiveShadow = true;
    this.upper.castShadow = true; this.upper.receiveShadow = true;
    this.skin.customDepthMaterial = makeDepthMaterial(U);
    this.upper.customDepthMaterial = this.skin.customDepthMaterial;
    this.meat.receiveShadow = true; this.bone.receiveShadow = true;
    // 부착물(유리·덫·고철·튀어나온 뼈)을 붙일 묶음 — 뼈를 따라감
    this.attach = {};
    for (const n of ['hand', 'forearm']) {
      const g = new THREE.Group(); bones[SEG[n]].add(g); this.attach[n] = g;
      g.position.fromArray(HEADER.pivot[SEG[n]]).multiplyScalar(-1);   // 자식 좌표 = 바인드 좌표
    }
    // 반팔 소매: 팔 메시 끝(위팔)을 덮음 — 가로 화면에서 짧아진 팔이 앞으로 나올 때 끝이 안 보이게
    this.sleeveGroup = new THREE.Group(); bones[SEG.forearm].add(this.sleeveGroup);
    this.sleeveGroup.position.fromArray(HEADER.pivot[SEG.forearm]).multiplyScalar(-1);
    this.sleeveGroup.add(makeSleeve());
    this.shardMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 });
    this.pulpMat = makePulpMaterial();
    this.flapMat = makeFlapMaterial(U.uSkinTint.value);
    this.cap = null; this.capZ = 99;
    this.sb = null;   // 짓이겨진 끝의 뼛조각·살가죽
    // 마디별 굽힘·옆 축
    this.axes = [0, 1, 2, 3].map((f) => ({
      p: ANAT.FDIR[f][0].clone(), m: ANAT.FDIR[f][1].clone(),
      sp: new THREE.Vector3().crossVectors(ANAT.FDIR[f][0], AX_X).normalize(),
      sm: new THREE.Vector3().crossVectors(ANAT.FDIR[f][1], AX_X).normalize(),
    }));
    this.reset();
  }

  // 팔 상태 완전 초기화(새 살)
  reset() {
    this.I = 0;               // 손실량 0(멀쩡) ~ 0.5(손목 위 없음) ~ 1(팔꿈치)
    this.wounds = [];         // {p:Vector3, r, type, k, seed, deep}
    this.spots = [];          // 반복 타격 지점의 누적
    this.swell = new Array(NSEG).fill(0);
    this.swellH = 0;
    this.handScale = new THREE.Vector3(1, 1, 1);
    this.crushZ = NO_CRUSH;
    this.events = { fract: 0, nail: 0, finger: 0, hand: 0, scrap: 0 };
    // 손등뼈: 새끼·약지 쪽부터 부러짐(복서 골절), 그다음 가운데·검지. 부러진 것 중 두세 개는 나중에 살을 뚫고 나옴
    this.mc = [0, 1, 2, 3].map((i) => ({ i, broken: false, t: 9, open: false, tOpen: 9, d: new THREE.Vector3(), c: new THREE.Vector3(), r: 0.017, twist: 0, flex: 0 }));
    const order = Math.random() < 0.7 ? [3, 2, 1, 0] : [2, 3, 1, 0];
    const ranges = [[0.05, 0.10], [0.10, 0.16], [0.15, 0.22], [0.19, 0.27]];
    order.forEach((f, k) => { this.mc[f].t = rnd(ranges[k][0], ranges[k][1]); });
    const opens = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 2 : 3);
    for (const f of opens) this.mc[f].tOpen = this.mc[f].t + rnd(0.05, 0.10);
    this.fingerState = [0, 1, 2, 3].map((i) => ({ broken: false, mashed: false, nailD: 0,
      tFract: rnd(0.12, 0.30) + (i >= 2 ? 0.02 : 0),
      bend: [rnd(-1, 1) > 0 ? 1 : -1, rnd(0.35, 0.65), Math.random() < 0.5 ? 'p' : 'm'] }));
    this.thumbState = { broken: false, mashed: false, tFract: rnd(0.16, 0.30) };
    this.wristBroken = false; this.tWrist = rnd(0.34, 0.40);   // 손 앞쪽이 짓이겨지는 게 먼저 보이고 그다음 손목이 꺾여 처짐
    this.dangle = 0; this.dangleV = 0;
    this.boneRot = HEADER.segs.map(() => new THREE.Quaternion());
    this.boneRotTarget = HEADER.segs.map(() => new THREE.Quaternion());
    this.J = [0, 1, 2, 3].map(() => ({ mcp: { th: 0, om: 0, ph: 0, nu: 0 }, pip: { th: 0, om: 0, ph: 0, nu: 0 } }));
    this.loose = [0, 0, 0, 0];
    this.sqRes = 0;
    this._pp = null; this._vp = null; this._acc = new THREE.Vector3();
    this.embedded = [];        // 박힌 유리 등
    this.traps = [];           // 매달린 쥐덫
    this.shards = [];          // 살을 뚫고 나온 뼛조각
    this.dropped = [];         // 짓이겨지며 떨어질 부착물(게임이 떨어뜨림)
    this.bleed = 0;            // 초당 손실(유리)
    this.acidT = 0;            // 산 지속
    this.scrap = null;         // 고철 부착 상태
    for (const g of Object.values(this.attach)) g.clear();
    if (this.cap) { this.cap.geometry.dispose(); this.cap = null; }
    this.capZ = 99; this.capSeed = Math.random() * 100;
    if (this.sb) { for (const f of this.sb.flaps) f.mesh.geometry.dispose(); this.sb = null; }
    this.bones.forEach((b, i) => { b.position.copy(this.basePos[i]); b.quaternion.identity(); b.scale.set(1, 1, 1); });
    this.material = 'flesh';
    this._apply();
  }

  // 저장된 손실 상태까지 다시 진행(상처·골절 자리는 새로 정해짐)
  setStump(I) {
    const res = { flesh: 0, scrap: 0, ev: [], point: null };
    while (this.I < I - 1e-6) this.damageFlesh(Math.min(0.012, I - this.I), {}, res);
    for (const o of this.dropped) o.parent && o.parent.remove(o);
    this.dropped = [];
    for (let i = 0; i < this.boneRot.length; i++) this.boneRot[i].copy(this.boneRotTarget[i]);
    if (this.wristBroken) this.dangle = 1;
  }
  get cutZ() { return this.crushZ; }   // 고철·벽이 그루터기 끝으로 씀
  hasFlesh() { return this.I < 0.5; }
  hasFist() { return this.I < 0.5 || (this.scrap && this.scrap.lumpHP > 0); }
  canPunch() { return this.I < 0.995 || (this.scrap && (this.scrap.lumpHP > 0 || this.scrap.pipeHP > 0)); }
  // 주먹 앞면(타격면)이 팔 원점(손목)에서 +Z로 얼마나 앞에 있는지
  reach() {
    if (this.I < 0.5) { const f = Math.min(0.097, this.crushZ + LUMP_T * 0.85); return f > 0 ? f * this.handScale.z : f; }
    if (this.scrap && this.scrap.lumpHP > 0) return 0.097;
    if (this.scrap && this.scrap.pipeHP > 0) return 0.0;
    return this.crushZ + LUMP_T * 0.8;
  }
  // 부러진 손등뼈 비율(0~1) — 클수록 맞을 때 손이 깊이 우그러짐
  brokenK() { let n = 0; for (const m of this.mc) if (m.broken) n++; return n / 4; }
  squashZ() { return this.I < 0.5 ? 0.1 + 0.16 * this.brokenK() : 0.1; }

  // ------------------------------------------------ 상처
  addWound(p, r, type, k, deep = 0) {
    // 같은 종류의 가까운 상처가 있으면 키운다
    let best = null, bd = 1e9;
    for (const w of this.wounds) {
      if (w.type !== type) continue;
      const d = w.p.distanceTo(p);
      if (d < bd) { bd = d; best = w; }
    }
    if (best && bd < Math.max(best.r, r) * 0.7) {
      best.k = Math.min(1, Math.max(best.k, k) + k * 0.25);
      best.r = Math.min(best.r * 1.06 + r * 0.05, Math.max(best.r, r) * 1.6, 0.03);
      best.deep = Math.max(best.deep, deep);
      return best;
    }
    const w = { p: p.clone(), r, type, k: Math.min(1, k), seed: Math.random() * 10, deep };
    this.wounds.push(w);
    if (this.wounds.length > NW) {
      // 가장 약한 멍부터 버림
      let mi = 0, mv = 1e9;
      this.wounds.forEach((x, i) => { const v = x.k * (x.type === W.BRUISE ? (x.dorsal ? 3 : 0.3) : 1) * (x.type === W.OPEN ? 4 : 1); if (v < mv) { mv = v; mi = i; } });
      this.wounds.splice(mi, 1);
    }
    return w;
  }

  // 주먹 앞면의 타격 지점(바인드 좌표) 고르기
  impactPoint() {
    const A = ANAT;
    const r = Math.random();
    const pick = r < 0.38 ? 1 : r < 0.70 ? 0 : r < 0.90 ? 2 : 3;
    const base = A.MCP[pick];
    const t = Math.random();
    const p = new THREE.Vector3();
    if (t < 0.6) {
      // 너클(앞·위)
      p.copy(base).add(new THREE.Vector3(rnd(-0.004, 0.004), 0.004 + rnd(-0.003, 0.004), A.MCP_R[pick] * 0.85));
    } else {
      // 첫마디 앞면
      const d1 = A.FDIR[pick][0];
      p.copy(base).addScaledVector(d1, rnd(0.008, 0.03)).add(new THREE.Vector3(rnd(-0.004, 0.004), 0, A.FR[pick][0] * 0.95));
    }
    return { p, finger: pick };
  }
  // 짓이겨진 앞면의 타격 지점
  frontPoint() {
    const z = Math.min(this.crushZ, FIST_FRONT), s = sectionAt(z);
    return new THREE.Vector3(s.x + rnd(-0.7, 0.7) * s.hw, s.y + rnd(-0.6, 0.6) * s.hh, z);
  }
  stumpPoint() { return this.frontPoint(); }

  // 손등뼈가 꺼진 만큼 p 가 옮겨지는 양(바인드 좌표)
  _dentAt(p) {
    const out = new THREE.Vector3();
    for (const m of this.mc) {
      if (!m.broken) continue;
      const s2 = p.distanceToSquared(m.c) / (m.r * m.r);
      if (s2 < 1) out.addScaledVector(m.d, (1 - s2) * (1 - s2));
    }
    return out;
  }
  // 짓이겨진 정도(손가락 f, 4는 엄지)
  _mashK(f) {
    const z0 = f === 4 ? ANAT.T[2].z : ANAT.MCP[f].z;
    return smooth01((z0 + 0.013 - this.crushZ) / 0.012);
  }

  // ------------------------------------------------ 피해 적용 (살)
  // kind: 벽이 주는 상처 성격, dI: 손실 증가량
  damageFlesh(dI, kind, out) {
    if (this.I >= 0.999) return;
    const prev = this.I;
    this.I = Math.min(1, this.I + dI);
    out.flesh += this.I - prev;
    const z0 = this.crushZ;
    this.crushZ = crushZOf(this.I);
    if (prev < 0.5) this._fistDamage(prev, kind, out);
    if (this.crushZ < z0 - 1e-7) this._crushed(z0, this.crushZ, out);
    if (prev < 0.5 && this.I >= 0.5) { out.ev.push({ t: 'hand' }); this.events.hand++; }
    if (this.I >= 0.5) this._stumpDamage(prev, kind, out);
    this._apply();
  }

  _fistDamage(prev, kind, out) {
    const I = Math.min(this.I, 0.5);
    const crushing = this.crushZ < FIST_FRONT;
    if (!crushing) {
      const hit = this.impactPoint();
      out.point = hit.p.clone();
      out.finger = hit.finger;
      // 반복 지점 누적
      let sp = this.spots.find((s) => s.p.distanceTo(hit.p) < 0.009);
      if (!sp) { sp = { p: hit.p.clone(), s: 0 }; this.spots.push(sp); }
      // 한 대마다 쌓이는 몫은 벽의 pace에 맞춤(판이 길어져도 살이 터지는 빠르기는 손이 망가지는 정도를 따라감)
      sp.s += (I - prev) * 9 + 0.06 * (kind.pace ?? 1);
      const s = sp.s;
      // 기본 둔상 진행: 멍 → 까짐 → 열린 상처 → 뼈 노출
      const rr = rnd(0.0065, 0.0105);
      const q = hit.p;
      this.addWound(q, rr * 1.5, W.BRUISE, clamp01(0.25 + s * 0.6));
      if (s > 0.22 || kind.abr) this.addWound(q, rr, W.ABR, clamp01((s - 0.12) * 1.6 + (kind.abr || 0)));
      if (s > 0.55) this.addWound(q, rr * 1.05, W.OPEN, clamp01((s - 0.45) * 1.3), clamp01((s - 1.0) * 1.2));
      this._kindWounds(hit.p, kind, sp.s);
      // 손가락이 풀려 손끝이 벽에 닿으면 손톱이 깨짐
      const f = hit.finger, fs = this.fingerState[f];
      if (this.loose[f] > 0.45 && !fs.mashed && fs.nailD < 1 && Math.random() < 0.35) {
        if (fs.nailD === 0) { out.ev.push({ t: 'nail', f }); this.events.nail++; }
        fs.nailD = Math.min(1, fs.nailD + rnd(0.45, 0.7));
        this.addWound(ANAT.DIP[f].clone().lerp(ANAT.TIP[f], 0.75), 0.007, W.ABR, 0.8);
      }
    } else {
      const p = this.frontPoint();
      out.point = p.clone();
      out.finger = -1;
      // 짓이겨진 앞면 바로 뒤가 까지고 피멍
      const s = sectionAt(this.crushZ), a = Math.random() * Math.PI * 2;
      const rim = new THREE.Vector3(s.x + Math.cos(a) * s.hw * rnd(0.6, 1.0), s.y + Math.sin(a) * s.hh * rnd(0.6, 1.0), this.crushZ - rnd(0.004, 0.011));
      this.addWound(rim, rnd(0.008, 0.013), W.ABR, 1);
      this.addWound(rim, 0.018, W.BRUISE, 1);
      this._kindWounds(rim, kind, 1);
    }
    // 손등 전체에 번지는 멍(맞을수록 넓고 짙게)
    if (I > 0.04) {
      const bk = clamp01((I - 0.04) / 0.22);
      for (const [x, z] of [[-0.014, 0.045], [0.012, 0.05], [-0.02, 0.07], [0.016, 0.072]]) {
        if (z > this.crushZ - 0.01) continue;
        const q = new THREE.Vector3(x, dorsalY(x, z), z);
        const w = this.wounds.find((w) => w.type === W.BRUISE && w.dorsal && w.p.distanceTo(q) < 0.002);
        if (w) w.k = Math.max(w.k, bk * 0.9); else { const nw = this.addWound(q, 0.024, W.BRUISE, bk * 0.9); nw.dorsal = true; }
      }
    }
    // 부기: 손등이 빵빵해짐 + 손가락이 소시지처럼
    const nMC = this.brokenK() * 4;
    this.swellH = Math.min(1, (I / 0.16) * 0.75 + nMC * 0.07);
    const sw = Math.min(0.0032, I * 0.013);
    for (let f = 0; f < 4; f++) for (const c of 'pmd') this.swell[SEG[`f${f}${c}`]] = sw * (c === 'p' ? 0.7 : c === 'm' ? 0.6 : 0.45);
    this.swell[SEG.t1] = sw * 0.6; this.swell[SEG.t2] = sw * 0.45;
    // 손등뼈가 부러질수록 손이 짧고 넓적해짐
    this.handScale.set(1 + nMC * 0.025, 1 - nMC * 0.02, 1 - nMC * 0.018);
    // 사건
    const boost = kind.fractBoost || 0;
    for (const m of this.mc) {
      if (!m.broken && I >= m.t - boost && this._mashK(m.i) < 0.5) { m.broken = true; out.ev.push({ t: 'mfract', f: m.i }); this.events.fract++; this._breakMetacarpal(m); }
      if (m.broken && !m.open && I >= m.tOpen && this._mashK(m.i) < 0.2) { m.open = true; out.ev.push({ t: 'open', f: m.i }); this._openFracture(m); }
    }
    this.fingerState.forEach((fs, i) => {
      if (!fs.broken && !fs.mashed && I >= fs.tFract - boost) {
        fs.broken = true; out.ev.push({ t: 'fract', f: i }); this.events.fract++;
        const bp = (fs.bend[2] === 'p' ? ANAT.MCP[i] : ANAT.PIP[i]).clone();
        this.addWound(bp, 0.007, W.FRACT, 1);
        this.addWound(bp, 0.013, W.BRUISE, 0.9);
      }
    });
    const ts = this.thumbState;
    if (!ts.broken && !ts.mashed && I >= ts.tFract) {
      ts.broken = true; out.ev.push({ t: 'fract', f: 4 }); this.events.fract++;
      this.boneRotTarget[SEG.t1].setFromAxisAngle(new THREE.Vector3(0, 1, 0.3).normalize(), rnd(0.28, 0.45));
      this.addWound(ANAT.T[1], 0.008, W.FRACT, 1);
      this.addWound(ANAT.T[1], 0.014, W.BRUISE, 0.9);
    }
    if (!this.wristBroken && I >= this.tWrist) {
      this.wristBroken = true; out.ev.push({ t: 'wrist' }); this.events.fract++;
      this.addWound(new THREE.Vector3(0, 0.0, -0.004), 0.016, W.FRACT, 1);
      this.addWound(new THREE.Vector3(0, 0.012, -0.002), 0.02, W.BRUISE, 1);
      this.addWound(new THREE.Vector3(0.022, 0.008, -0.006), 0.012, W.OPEN, 0.8, 0.5);
    }
    // 주먹이 풀림: 부러진 손가락은 다 풀리고, 손등뼈가 부러진 손가락도 힘이 빠짐. 많이 부러질수록 성한 손가락도 같이
    let nB = 0;
    for (const m of this.mc) if (m.broken) nB++;
    for (const fs of this.fingerState) if (fs.broken) nB++;
    const g = Math.min(1, nB / 6);
    for (let f = 0; f < 4; f++) this.loose[f] = Math.max(this.fingerState[f].broken ? 1 : 0, this.mc[f].broken ? 0.75 : 0, g * 0.55);
    this._updateDeformTargets();
  }

  // 벽 성격별 상처
  _kindWounds(p, kind, s) {
    if (kind.cut && Math.random() < kind.cut) this.addWound(p.clone().add(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.008, 0.008), 0)), rnd(0.008, 0.016), W.CUT, rnd(0.6, 1));
    if (kind.punct) for (let i = 0; i < kind.punct; i++) {
      const q = p.clone().add(new THREE.Vector3(rnd(-0.02, 0.02), rnd(-0.02, 0.01), rnd(-0.002, 0.002)));
      this.addWound(q, rnd(0.006, 0.009), W.PUNCT, 1);
    }
    if (kind.burn) for (let i = 0; i < 3; i++) {
      const q = (this.crushZ < FIST_FRONT ? p.clone() : ANAT.MCP[i % 4].clone()).add(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.03, 0.006), 0.01));
      this.addWound(q, rnd(0.016, 0.026), W.BURN, clamp01(kind.burn + s * 0.15));
    }
    if (kind.frost) this.addWound(p, rnd(0.010, 0.016), W.FROST, clamp01(kind.frost));
    if (kind.acid) for (let i = 0; i < 2; i++) {
      const q = (this.crushZ < FIST_FRONT ? p.clone() : ANAT.MCP[Math.floor(Math.random() * 4)].clone()).add(new THREE.Vector3(rnd(-0.012, 0.012), rnd(-0.035, 0.008), rnd(-0.01, 0.012)));
      this.addWound(q, rnd(0.014, 0.024), W.ACID, clamp01(kind.acid));
    }
    if (kind.elec) this.addWound(p.clone().add(new THREE.Vector3(rnd(-0.015, 0.015), rnd(-0.02, 0.01), 0)), rnd(0.018, 0.03), W.ELEC, clamp01(kind.elec));
  }

  // 손등뼈 목이 부러져 너클이 손바닥·손목 쪽으로 주저앉고, 그 손가락이 비틀림
  _breakMetacarpal(m) {
    const f = m.i, A = ANAT;
    m.c.copy(A.MCP[f]).add(new THREE.Vector3(0, A.MCP_R[f] * 0.7, -0.003));
    m.r = 0.0165;
    m.d.set(rnd(-0.0008, 0.0008), -rnd(0.0095, 0.0115), -rnd(0.0075, 0.009));
    // 꺾인 뼈 끝이 손등 쪽으로 솟아 혹이 됨
    const hz = A.MCP[f].z - 0.024;
    m.hc = new THREE.Vector3(A.MCP[f].x * 0.92, dorsalY(A.MCP[f].x * 0.92, hz) - 0.004, hz);
    m.hd = new THREE.Vector3(0, rnd(0.0035, 0.0048), 0.001);
    m.twist = (Math.random() < 0.5 ? -1 : 1) * rnd(0.16, 0.26);
    m.flex = rnd(0.08, 0.16);
    const zb = A.MCP[f].z - 0.012;
    this.addWound(new THREE.Vector3(A.MCP[f].x, dorsalY(A.MCP[f].x, zb), zb), 0.02, W.BRUISE, 1);
    this.addWound(A.MCP[f].clone().add(new THREE.Vector3(0, 0.0, -0.014)), 0.008, W.FRACT, 1);
  }

  // 깨진 손등뼈 끝이 손등 살을 뚫고 나옴
  _openFracture(m) {
    const f = m.i, A = ANAT;
    const bx = A.MCP[f].x + rnd(-0.003, 0.003), bz = A.MCP[f].z - 0.015 + rnd(-0.003, 0.002);
    const base = new THREE.Vector3(bx, dorsalY(bx, bz) - 0.0015, bz);
    base.add(this._dentAt(base));
    const dir = new THREE.Vector3(rnd(-0.45, 0.45), 1, rnd(-1.0, -0.2)).normalize();
    const geo = shardGeometries()[Math.floor(Math.random() * 3)];
    const mesh = new THREE.Mesh(geo, this.shardMat);
    const len = rnd(0.021, 0.027), r = rnd(0.0027, 0.0033);
    mesh.position.copy(base).addScaledVector(dir, -0.0045);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.rotateY(Math.random() * 6.28);
    mesh.scale.set(r, len, r);
    mesh.castShadow = true;
    this.attach.hand.add(mesh);
    this.shards.push(mesh);
    this.addWound(base, 0.0045, W.OPEN, 1, 0.1);
    this.addWound(base, 0.011, W.ABR, 0.9);
    this.addWound(base.clone().add(new THREE.Vector3(0, 0.001, -0.004)), 0.014, W.CUT, 1);
  }

  // 부러져 꺾인 자세(목표). 흔들림은 update 에서 따로 얹음
  _updateDeformTargets() {
    for (let f = 0; f < 4; f++) {
      const m = this.mc[f], fs = this.fingerState[f];
      const qp = this.boneRotTarget[SEG[`f${f}p`]].identity(), qm = this.boneRotTarget[SEG[`f${f}m`]].identity();
      if (m.broken) {
        // 손가락이 제 축으로 비틀려 옆 손가락 위로 겹침 + 살짝 더 굽음
        qp.multiply(_q1.setFromAxisAngle(ANAT.FDIR[f][0], m.twist)).multiply(_q2.setFromAxisAngle(AX_X, m.flex));
      }
      if (fs.broken) {
        const [sg, amt, joint] = fs.bend;
        if (joint === 'p') qp.multiply(_q1.setFromAxisAngle(new THREE.Vector3(0.25 * sg, 0, 1).normalize(), sg * amt * 0.55));
        else qm.multiply(_q1.setFromAxisAngle(new THREE.Vector3(1, sg * 0.4, 0).normalize(), -amt * 0.9));
      }
    }
  }

  // 앞면이 z0 → z 로 짓이겨져 들어옴
  _crushed(z0, z, out) {
    if (Math.floor(z0 / 0.004) !== Math.floor(z / 0.004)) out.ev.push({ t: 'crush' });
    this.fingerState.forEach((fs, f) => {
      if (!fs.mashed && z < ANAT.MCP[f].z - 0.004) { fs.mashed = true; out.ev.push({ t: 'finger', f }); this.events.finger++; }
    });
    const ts = this.thumbState;
    if (!ts.mashed && z < ANAT.T[2].z - 0.008) { ts.mashed = true; out.ev.push({ t: 'finger', f: 4 }); this.events.finger++; }
    // 짓이겨진 자리에 붙어 있던 것: 유리·쥐덫은 떨어지고, 튀어나온 뼈는 뭉개진 덩어리 속으로
    for (const o of this.attach.hand.children.slice()) {
      if (o === this.cap || o.userData.stumpBit || o.position.z <= z - 0.004) continue;
      const si = this.shards.indexOf(o);
      if (si >= 0) { this.shards.splice(si, 1); this.attach.hand.remove(o); continue; }
      const ti = this.traps.findIndex((t) => t.obj === o);
      if (ti >= 0) this.traps.splice(ti, 1);
      const gi = this.embedded.indexOf(o);
      if (gi >= 0) this.embedded.splice(gi, 1);
      this.dropped.push(o);
    }
    this.bleed = this.embedded.length ? Math.min(0.012, 0.0016 + this.embedded.length * 0.0007) : 0;
    // 벽에 발려 없어진 데의 상처는 버림
    this.wounds = this.wounds.filter((w) => w.p.z < z + 0.03);
    if (z <= WRIST_Z + 1e-6) { this.traps.length = 0; this.embedded.length = 0; this.bleed = 0; }
  }

  _stumpDamage(prev, kind, out) {
    out.point = this.frontPoint();
    // 그루터기 끝 살이 짓이겨짐
    const z = this.crushZ, s = sectionAt(z);
    this.addWound(new THREE.Vector3(s.x + rnd(-0.008, 0.008), s.y + rnd(-0.006, 0.01), z - 0.006), rnd(0.028, 0.036), W.ABR, 1);
    this.addWound(new THREE.Vector3(s.x + rnd(-0.008, 0.008), s.y + rnd(-0.004, 0.012), z - 0.016), 0.03, W.BRUISE, 1);
    if (Math.floor(prev * 40) !== Math.floor(this.I * 40) && this.I > 0.5) out.ev.push({ t: 'stump' });
  }

  // 짓이겨지며 떨어질 부착물을 넘겨줌(게임이 바닥으로 떨어뜨림)
  takeDropped() { const d = this.dropped; this.dropped = []; return d; }

  // ------------------------------------------------ 고철
  // 고철 HP 피해. 살 연결부도 조금 다침
  damageScrap(d, out) {
    const s = this.scrap; if (!s) return 0;
    let left = d;
    if (s.lumpHP > 0) {
      const take = Math.min(s.lumpHP, left); s.lumpHP -= take; left -= take; out.scrap += take;
      out.scrapHit = 'lump';
      if (s.lumpHP <= 0) { out.ev.push({ t: 'lumpGone' }); }
    } else if (s.pipeHP > 0) {
      const take = Math.min(s.pipeHP, left); s.pipeHP -= take; left -= take; out.scrap += take;
      out.scrapHit = 'pipe';
      if (s.pipeHP <= 0) out.ev.push({ t: 'pipeGone' });
    }
    return left;
  }

  // ------------------------------------------------ 반영
  _apply() {
    const U = this.U;
    U.uSwell.value = this.swell.slice();
    U.uSwellH.value = this.swellH;
    const n = Math.min(this.wounds.length, NW);
    for (let i = 0; i < n; i++) {
      const w = this.wounds[i];
      U.uWA.value[i].set(w.p.x, w.p.y, w.p.z, w.r);
      U.uWB.value[i].set(w.type, w.k, w.seed, w.deep || 0);
    }
    U.uWN.value = n;
    // 꺼진 손등뼈
    let k = 0;
    for (const m of this.mc) {
      if (!m.broken || k >= ND - 1) continue;
      U.uDA.value[k].set(m.c.x, m.c.y, m.c.z, m.r);
      U.uDB.value[k].set(m.d.x, m.d.y, m.d.z, SEG[`f${m.i}p`]);
      k++;
      U.uDA.value[k].set(m.hc.x, m.hc.y, m.hc.z, 0.013);
      U.uDB.value[k].set(m.hd.x, m.hd.y, m.hd.z, -1);
      k++;
    }
    U.uDN.value = k;
    // 짓이겨진 앞면
    const z = this.crushZ, s = sectionAt(Math.min(z, FIST_FRONT));
    const handK = smooth01((z - 0.0) / 0.03);
    U.uCrush.value.set(z, 0.0045, 0.08 + 0.14 * handK, 0.012);
    U.uCrushC.value.set(s.x, s.y, 1);
    // 손톱
    const nd = U.uNailD.value;
    for (let f = 0; f < 4; f++) nd[SEG[`f${f}d`]] = this.fingerState[f].nailD;
    // 속살·뼈는 살갗이 터졌거나 짓이겨졌을 때만 그림(가려진 채로 그리면 낭비)
    const holes = z < FIST_FRONT + 0.01 || this.shards.length > 0 ||
      this.wounds.some((w) => (w.type === W.OPEN && w.k > 0.35) || (w.type === W.ACID && w.k > 0.6) || (w.type === W.FROST && w.k > 0.6));
    this.meat.visible = holes; this.bone.visible = holes;
    this._updateCap();
    this._updateStumpBits();
  }

  // 짓이겨진 끝: 쪼개진 뼈가 들쭉날쭉 삐져나오고, 찢긴 살가죽이 너덜거림
  _makeStumpBits() {
    const geos = shardGeometries();
    const sb = { bones: [], mcs: [], flaps: [] };
    const mkShard = () => { const m = new THREE.Mesh(geos[Math.floor(Math.random() * 3)], this.shardMat); m.castShadow = true; m.userData.stumpBit = true; return m; };
    // 팔뚝뼈 두 개
    for (let k = 0; k < 2; k++) sb.bones.push({ mesh: mkShard(), len: rnd(0.026, 0.036), tilt: new THREE.Vector3((k ? 1 : -1) * rnd(0.25, 0.6), rnd(0.35, 0.8), 1).normalize(), spin: Math.random() * 6.28, rs: rnd(0.5, 0.68) });
    // 손등뼈 끝(손이 짓이겨지는 동안)
    const fs = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 3);
    for (const f of fs) sb.mcs.push({ f, mesh: mkShard(), len: rnd(0.018, 0.025), tilt: new THREE.Vector3(rnd(-0.5, 0.5), rnd(0.3, 0.9), 1).normalize(), spin: Math.random() * 6.28 });
    // 살가죽 서너 장
    const n = 3 + Math.floor(Math.random() * 2), a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + rnd(-0.4, 0.4);
      const g = flapGeometry(rnd(0.014, 0.021), rnd(0.02, 0.03), rnd(1.5, 2.5), Math.random() * 100);
      const mesh = new THREE.Mesh(g, this.flapMat); mesh.castShadow = true;
      const piv = new THREE.Group(); piv.add(mesh); piv.userData.stumpBit = true;
      sb.flaps.push({ piv, mesh, a, ang: 0, vel: 0 });
    }
    this.sb = sb;
  }
  _updateStumpBits() {
    const z = this.crushZ;
    if (z > FIST_FRONT - 0.004) { if (this.sb) for (const o of this._stumpObjs()) o.parent && o.parent.remove(o); return; }
    if (!this.sb) this._makeStumpBits();
    const parent = this.I < 0.5 ? this.attach.hand : this.attach.forearm;
    const sec = sectionAt(z), R = outlineAt(z), NA = R.length, S = this.U.uCrush.value.z;
    const up = new THREE.Vector3(0, 1, 0);
    // 팔뚝뼈: 손목이 짓이겨질 즈음부터
    const fb = forearmBonesAt(Math.min(z, -0.008));
    this.sb.bones.forEach((b, k) => {
      const on = z < 0.016 && fb[k];
      if (!on) { b.mesh.parent && b.mesh.parent.remove(b.mesh); return; }
      const [bx, by, br] = fb[k];
      b.mesh.position.set(bx, by, z - 0.007);
      b.mesh.quaternion.setFromUnitVectors(up, b.tilt); b.mesh.rotateY(b.spin);
      b.mesh.scale.set(br * b.rs, b.len, br * b.rs);
      if (b.mesh.parent !== parent) parent.add(b.mesh);
    });
    // 손등뼈: 손이 짓이겨지는 동안
    this.sb.mcs.forEach((b) => {
      const M = ANAT.MCP[b.f];
      const t = (z - 0.012) / (M.z - 0.004 - 0.012);
      const on = t > 0.05 && t < 0.97 && !this.mc[b.f].open;
      if (!on) { b.mesh.parent && b.mesh.parent.remove(b.mesh); return; }
      b.mesh.position.set(M.x * (0.6 + 0.4 * t), -0.002 + (M.y - 0.002) * t, z - 0.005);
      b.mesh.quaternion.setFromUnitVectors(up, b.tilt); b.mesh.rotateY(b.spin);
      b.mesh.scale.set(0.0036, b.len, 0.0036);
      if (b.mesh.parent !== parent) parent.add(b.mesh);
    });
    // 살가죽: 짓이겨진 테두리에 붙어 바깥으로 젖혀짐
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), M4 = new THREE.Matrix4();
    for (const f of this.sb.flaps) {
      const j = Math.floor(((f.a / (Math.PI * 2)) % 1 + 1) % 1 * NA);
      const r = R[j] * (1 + S * 0.3) * 0.92;
      Y.set(Math.cos(f.a), Math.sin(f.a), 0); X.crossVectors(Y, Z);
      f.piv.position.set(sec.x + Y.x * r, sec.y + Y.y * r, z - 0.003);
      f.base = (f.base || new THREE.Quaternion()).setFromRotationMatrix(M4.makeBasis(X, Y, Z));
      f.piv.quaternion.copy(f.base);
      if (f.piv.parent !== parent) parent.add(f.piv);
    }
  }
  _stumpObjs() {
    const sb = this.sb; if (!sb) return [];
    return [...sb.bones.map((b) => b.mesh), ...sb.mcs.map((b) => b.mesh), ...sb.flaps.map((f) => f.piv)];
  }

  // 짓이겨진 끝을 덮는 살덩이(앞면이 1.5mm 넘게 옮겨 가면 새로 빚음)
  _updateCap() {
    const z = this.crushZ;
    const parent = this.I < 0.5 ? this.attach.hand : this.attach.forearm;
    if (z > FIST_FRONT) { if (this.cap) { this.cap.parent && this.cap.parent.remove(this.cap); this.cap.geometry.dispose(); this.cap = null; this.capZ = 99; } return; }
    if (this.cap && Math.abs(z - this.capZ) < 0.0015 && this.cap.parent === parent) return;
    if (this.cap) { this.cap.parent && this.cap.parent.remove(this.cap); this.cap.geometry.dispose(); }
    this.cap = new THREE.Mesh(mashCapGeometry(z, this.U.uCrush.value.z, this.capSeed + z * 50), this.pulpMat);
    this.cap.castShadow = true; this.cap.receiveShadow = true;
    parent.add(this.cap);
    this.capZ = z;
  }

  // 매 프레임
  update(dt, time) {
    this.U.uTime.value = time;
    // 손목 덜렁거림
    const hb = this.bones[SEG.hand];
    if (this.wristBroken && this.I < 0.5) {
      const target = 1.0;
      this.dangleV += ((target - this.dangle) * 60 - this.dangleV * 7) * dt;
      this.dangle += this.dangleV * dt;
      const q = _q1.setFromAxisAngle(_v1.set(1, 0, 0.15).normalize(), this.dangle * 0.95);
      hb.quaternion.copy(q);
    } else hb.quaternion.identity();
    // 벽에 박힌 순간 손이 앞뒤로 납작해지고 옆으로 퍼짐 — 손등뼈가 부러질수록 더 깊이 우그러지고, 맞은 뒤에도 천천히 펴짐
    const b = this.brokenK();
    const sqDyn = this.I < 0.5 ? this.squash : 0;
    this.sqRes = Math.max(this.sqRes * Math.exp(-dt / 0.35), sqDyn * b * 0.6);
    const sq = Math.max(sqDyn, this.sqRes);
    const SZ = this.squashZ();
    hb.scale.set(this.handScale.x * (1 + (0.07 + 0.06 * b) * sq), this.handScale.y * (1 + 0.05 * sq), this.handScale.z * (1 - SZ * sq));
    this._fingerUpdate(dt);
    // 고철을 달면 그루터기 끝(뼛조각·살가죽)은 테이프 속에 묻힘
    if (this.sb) {
      const covered = !!(this.scrap && (this.scrap.lumpHP > 0 || this.scrap.pipeHP > 0));
      for (const o of this._stumpObjs()) o.visible = !covered;
      if (this.cap) this.cap.visible = !covered;
    }
    // 살가죽 너덜: 맞으면 펄럭였다가 축 처짐
    if (this.sb && this.crushZ < FIST_FRONT - 0.004) for (const f of this.sb.flaps) {
      f.vel += (-160 * f.ang - 7 * f.vel) * dt; f.ang += f.vel * dt;
      f.ang = Math.max(-0.9, Math.min(0.9, f.ang));
      if (f.base) f.piv.quaternion.copy(f.base).multiply(_q1.setFromAxisAngle(AX_X, f.ang + 0.08 * Math.sin(time * 2.1 + f.a * 3)));
    }
  }

  // 부러진 손가락: 꺾인 채 힘없이 덜렁거림(팔 움직임·중력에 흔들림), 벽에 닿으면 다시 접힘
  _fingerUpdate(dt) {
    // 팔이 움직이며 생기는 관성 + 중력 (손 기준 좌표)
    const p = this.root.position;
    if (dt > 1e-5) {
      if (this._pp) {
        const v = _v1.subVectors(p, this._pp).divideScalar(dt);
        if (this._vp) {
          const a = _v2.subVectors(v, this._vp).divideScalar(dt);
          if (a.length() > 140) a.setLength(140);
          this._acc.lerp(a, Math.min(1, dt * 30));
        }
        this._vp = (this._vp || new THREE.Vector3()).copy(v);
      }
      this._pp = (this._pp || new THREE.Vector3()).copy(p);
    }
    const F = new THREE.Vector3(0, -9.8, 0).sub(this._acc).applyQuaternion(_q1.copy(this.root.quaternion).invert());
    if (this.side === 'R') F.x = -F.x;
    F.applyQuaternion(_q1.copy(this.bones[SEG.hand].quaternion).invert());
    const steps = Math.max(1, Math.ceil(dt / 0.004)), h = dt / steps;
    const pressed = this.squash > 0.35;
    for (let f = 0; f < 4; f++) {
      const mash = this._mashK(f);
      const lam = this.loose[f] * (1 - mash);
      const J = this.J[f], ax = this.axes[f];
      const pipLam = lam * (this.fingerState[f].broken && this.fingerState[f].bend[2] === 'm' ? 1 : 0.8);
      const splay = (f - 1.5) * 0.05 * lam;
      if (dt > 0) for (let s = 0; s < steps; s++) {
        jointStep(J.mcp, lam, -0.18 * lam, splay, F, ax.p, ax.sp, h);
        jointStep(J.pip, pipLam, -0.24 * pipLam, 0, F, ax.m, ax.sm, h);
      }
      if (pressed && lam > 0.05) { J.mcp.th = Math.max(J.mcp.th, -0.05); J.pip.th = Math.max(J.pip.th, -0.08); }
      const ip = SEG[`f${f}p`], im = SEG[`f${f}m`], id = SEG[`f${f}d`];
      for (const i of [ip, im, id]) this.boneRot[i].slerp(this.boneRotTarget[i], Math.min(1, dt * 18));
      const bp = this.bones[ip], bm = this.bones[im], bd = this.bones[id];
      bp.quaternion.copy(this.boneRot[ip]).multiply(_q1.setFromAxisAngle(AX_X, J.mcp.th)).multiply(_q2.setFromAxisAngle(ax.sp, J.mcp.ph));
      bm.quaternion.copy(this.boneRot[im]).multiply(_q1.setFromAxisAngle(AX_X, J.pip.th)).multiply(_q2.setFromAxisAngle(ax.sm, J.pip.ph));
      bd.quaternion.copy(this.boneRot[id]);
      if (mash > 0) { bp.quaternion.slerp(_qI, mash); bm.quaternion.slerp(_qI, mash); bd.quaternion.slerp(_qI, mash); }
      // 손등뼈가 꺼진 만큼 손가락 뿌리도 같이 내려앉음
      bp.position.copy(this.basePos[ip]);
      if (this.mc[f].broken) bp.position.addScaledVector(this.mc[f].d, 1 - mash);
    }
    // 엄지
    for (const i of [SEG.t0, SEG.t1, SEG.t2]) {
      this.boneRot[i].slerp(this.boneRotTarget[i], Math.min(1, dt * 18));
      this.bones[i].quaternion.copy(this.boneRot[i]);
      const tm = this._mashK(4);
      if (tm > 0) this.bones[i].quaternion.slerp(_qI, tm);
    }
  }

  // 충격 순간 덜렁이는 손 튕김 + 풀린 손가락이 벽에 부딪혀 접혔다 튀어나옴
  kick(power) {
    this.dangleV -= 14 * power;
    if (this.sb) for (const f of this.sb.flaps) f.vel += rnd(5, 11) * power * (Math.random() < 0.5 ? -1 : 1);
    for (let f = 0; f < 4; f++) {
      const lam = this.loose[f] * (1 - this._mashK(f));
      if (lam < 0.05) continue;
      const J = this.J[f];
      J.mcp.om += 9 * power * lam; J.pip.om += 12 * power * lam;
      J.mcp.nu += rnd(-4, 4) * lam;
    }
  }
}

// ------------------------------------------------------------------ 반팔 소매
let _sleeve = null;
function makeSleeve() {
  if (!_sleeve) {
    const z0 = -0.432, z1 = -0.98, R0 = 0.066, R1 = 0.08;
    const g = new THREE.CylinderGeometry(1, 1, 1, 32, 14, true);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.5);   // z: 0 → 1
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = v.z, ang = Math.atan2(v.y, v.x);
      // 천 주름: 길이 방향으로 굽이치는 골 + 끝단은 살짝 벌어짐
      const wr = 1 + 0.035 * Math.sin(ang * 5 + t * 9) * Math.min(1, t * 6) + 0.02 * Math.sin(ang * 11 - t * 5);
      const r = (R0 + (R1 - R0) * Math.pow(t, 0.7)) * wr;
      p.setXYZ(i, v.x * r, v.y * r * 1.1 + 0.002, z0 + (z1 - z0) * t);
    }
    g.computeVertexNormals();
    const hem = new THREE.TorusGeometry(R0 * 1.01, 0.0042, 8, 40);
    hem.scale(1, 1.1, 1); hem.translate(0, 0.002, z0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2f3a56, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSl;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSl = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSl;\n' + NOISE_CORE)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float weave = vnoise(vSl * vec3(2600.0, 2600.0, 900.0));
          diffuseColor.rgb *= 0.88 + 0.16 * weave + 0.08 * vnoise(vSl * 90.0);
          if (!gl_FrontFacing) diffuseColor.rgb *= 0.25;`);
    };
    const tube = new THREE.Mesh(g, mat), ring = new THREE.Mesh(hem, mat);
    tube.castShadow = ring.castShadow = true; tube.receiveShadow = ring.receiveShadow = true;
    tube.frustumCulled = ring.frustumCulled = false;
    _sleeve = { tube, ring };
  }
  const grp = new THREE.Group();
  grp.add(_sleeve.tube.clone(), _sleeve.ring.clone());
  return grp;
}
