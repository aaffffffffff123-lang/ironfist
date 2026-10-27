// 철권 — 팔(살·속살·뼈) 메시, 상처 셰이더, 부상 진행
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
  return { header, geos };
}

// ------------------------------------------------------------------ GLSL 공통
const NOISE_GLSL = /* glsl */`
float h31(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm3(vec3 p){ return vnoise(p)*0.55 + vnoise(p*2.13+3.1)*0.3 + vnoise(p*4.31+7.7)*0.15; }
vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize( dFdx( surf_pos ) ); vec3 vSigmaY = normalize( dFdy( surf_pos ) ); vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN ); vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;
export const NW = 40;   // 상처 최대 개수
export const NSEG = 17;

// 상처 종류
export const W = { BRUISE: 0, ABR: 1, CUT: 2, OPEN: 3, PUNCT: 4, BURN: 5, FROST: 6, ACID: 7, ELEC: 8, FRACT: 9, WIRE: 10 };

const WOUND_GLSL = /* glsl */`
uniform vec4 uWA[${NW}];
uniform vec4 uWB[${NW}];
uniform int uWN;
uniform float uAlive[${NSEG}];
uniform float uCutZ;
uniform float uTime;
uniform float uXray;
uniform float uWet;
varying vec3 vBind;
flat varying float vSeg;
varying float vAO;
varying float vNail;
varying float vGone;
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
bool segDead(){ int si = int(vSeg + 0.5); return uAlive[si] < 0.5; }
float cutNoise(vec3 p){ return (vnoise(p * 210.0) - 0.5) * 0.009 + (vnoise(p * 900.0) - 0.5) * 0.003; }
`;

const VERT_DECL = /* glsl */`
attribute float aSeg;
#ifdef HAS_AO
attribute float aAO;
#endif
#ifdef HAS_NAIL
attribute float aNail;
#endif
uniform float uSwell[${NSEG}];
uniform float uGone[${NSEG}];
varying vec3 vBind;
flat varying float vSeg;
varying float vAO;
varying float vNail;
varying float vGone;
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
transformed += objectNormal * uSwell[int(aSeg + 0.5)];
#ifdef USE_SKINNING
vGone = skinWeight.x * uGone[int(skinIndex.x + 0.5)] + skinWeight.y * uGone[int(skinIndex.y + 0.5)] + skinWeight.z * uGone[int(skinIndex.z + 0.5)] + skinWeight.w * uGone[int(skinIndex.w + 0.5)];
#else
vGone = 0.0;
#endif
`;

function patchVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_DECL)
    .replace('#include <begin_vertex>', VERT_BEGIN);
}

// ------------------------------------------------------------------ 재질
function makeSkinMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  m.defines = { HAS_AO: '', HAS_NAIL: '' };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\nuniform float uWrap;\nuniform vec3 uSSS;\nuniform vec3 uSkinTint;\n' + NOISE_GLSL + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (segDead()) discard;
      if (vBind.z > uCutZ + cutNoise(vBind)) discard;
      WSum ws = woundSum(vBind);
      float holeEdge = ws.open - 0.52;
      if (holeEdge > 0.0) discard;
      if (ws.acid > 0.82 && vnoise(vBind*600.0) < (ws.acid - 0.82) * 3.0) discard;
      if (ws.frost > 0.86) discard;
    `);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 col = diffuseColor.rgb * uSkinTint;
      float fd = gl_FrontFacing ? 1.0 : 0.0;
      // 손톱
      col = mix(col, col * vec3(1.02, 0.98, 0.98), vNail);
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
      float lich = smoothstep(0.47, 0.5, abs(vnoise(vBind * 350.0) - 0.5) + 0.5 - 0.02) ;
      float lfern = 1.0 - smoothstep(0.0, 0.035, abs(fbm3(vBind * 260.0) - 0.5));
      col = mix(col, vec3(0.55, 0.12, 0.10), el * lfern * 0.9);
      col = mix(col, vec3(0.03, 0.02, 0.02), smoothstep(0.55, 1.0, el) * smoothstep(0.55, 0.75, vnoise(vBind * 300.0)));
      // 철사 고리
      col = mix(col, vec3(0.20, 0.01, 0.01), clamp(ws.wire, 0.0, 1.0));
      // 피: 젖은 검붉은색
      float bl = clamp(ws.blood * (0.75 + 0.5 * vnoise(vBind * 260.0)), 0.0, 1.0);
      col = mix(col, vec3(0.25, 0.008, 0.008), bl * 0.85);
      // 손가락이 뜯겨 나간 자리: 끌려 들어간 살갗이 생살로
      float gone = smoothstep(0.10, 0.34, vGone + (vnoise(vBind * 700.0) - 0.5) * 0.16);
      vec3 torn = mix(vec3(0.36, 0.035, 0.03), vec3(0.13, 0.006, 0.005), smoothstep(0.25, 0.5, vGone));
      torn *= 0.8 + 0.4 * vnoise(vBind * 1600.0);
      col = mix(col, torn, gone);
      // 안쪽 면(구멍 너머로 보이는 속)
      col = mix(vec3(0.09, 0.004, 0.003), col, fd);
      // 엑스레이: 살은 짙은 남색으로 가라앉음
      col = mix(col, vec3(0.02, 0.05, 0.09), uXray * 0.8);
      diffuseColor.rgb = col;
      float wetness = max(max(bl, ws.abr), max(ws.cut, max(rim, max(ws.acid, gone * 0.7))));
    `);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.62, vNail * 0.0);
      roughnessFactor = mix(roughnessFactor * (0.92 + 0.16 * vnoise(vBind * 800.0)), 0.18, clamp(wetness * 1.1, 0.0, 1.0));
      roughnessFactor = mix(roughnessFactor, 0.95, charM);
      roughnessFactor = mix(roughnessFactor, 0.3, vNail * 0.6);
      roughnessFactor = mix(roughnessFactor, 0.12, 1.0 - fd);
    `);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        // 피부 결(주름·모공) + 상처 요철 — 화면공간 범프
        float hgt = vnoise(vBind * 1500.0) * 0.6 + vnoise(vBind * vec3(5200.0, 5200.0, 1800.0)) * 0.4;
        float bump = 0.0016;
        hgt += (vnoise(vBind * 900.0) * (ws.abr + ws.acid * 0.8 + charM) ) * 3.0;
        bump += 0.006 * clamp(ws.abr + blister + ws.acid + charM, 0.0, 1.0);
        vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * bump * 60.0;
        normal = perturbN(-vViewPosition, normal, dH, faceDirection);
      }
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
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-skin-1';
  return m;
}

function makeMeatMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + NOISE_GLSL + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (segDead()) discard;
      if (vBind.z > uCutZ + cutNoise(vBind) - 0.0015) discard;
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
      float fas = smoothstep(0.48, 0.5, abs(vnoise(vBind * 300.0) - 0.5) + 0.5) * 0.0;
      c = mix(c, vec3(0.85, 0.80, 0.78), smoothstep(0.82, 0.9, vnoise(vec3(vBind.x*900.0, vBind.y*900.0, vBind.z*120.0))) * 0.4);
      c = mix(c * 0.55, c, smoothstep(0.0, 0.5, 1.0 - ws.deep));
      c = mix(vec3(0.12, 0.005, 0.004), c, fd);
      c = mix(c, vec3(0.02, 0.05, 0.09), uXray * 0.8);
      diffuseColor.rgb = c;
    `);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-meat-1';
  return m;
}

function makeBoneMaterial(U, xray) {
  const m = xray
    ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + NOISE_GLSL + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (segDead()) discard;
      if (vBind.z > uCutZ + cutNoise(vBind) + 0.010) discard;
      WSum ws = woundSum(vBind);
      ${xray ? '' : 'if (max(ws.open, ws.deep) < 0.03 && vBind.z < uCutZ - 0.035) discard;'}
    `);
    f = f.replace('#include <color_fragment>', xray ? `#include <color_fragment>
      float crack = clamp(ws.fract, 0.0, 1.0) * smoothstep(0.42, 0.5, 1.0 - abs(vnoise(vBind * 700.0) - 0.5));
      vec3 xc = vec3(0.55, 0.85, 1.0) * (0.35 + 0.65 * vnoise(vBind * 300.0));
      xc = mix(xc, vec3(1.0, 0.25, 0.15) * 1.6, crack);
      diffuseColor.rgb = xc * uXray;
      diffuseColor.a = uXray;
    ` : `#include <color_fragment>
      vec3 c = mix(vec3(0.80, 0.74, 0.60), vec3(0.93, 0.89, 0.78), vnoise(vBind * 900.0));
      float crack = clamp(ws.fract, 0.0, 1.0) * smoothstep(0.44, 0.5, 1.0 - abs(vnoise(vBind * 700.0) - 0.5));
      c = mix(c, vec3(0.20, 0.02, 0.01), crack);
      float bl = clamp(ws.blood + ws.open * 0.6 + ws.deep, 0.0, 1.0) * (0.6 + 0.4 * vnoise(vBind * 400.0));
      c = mix(c, vec3(0.35, 0.02, 0.015), bl * 0.75);
      diffuseColor.rgb = c;
    `);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => xray ? 'cg-bonex-1' : 'cg-bone-1';
  return m;
}

// 엑스레이: 뼈는 겉테(피질)가 밝고, 살은 실루엣만 희미하게
function makeXrayMaterial(U, kind) {
  const m = new THREE.MeshNormalMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: kind === 'bone' ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vXV;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvXV = -mvPosition.xyz;');
    let f = shader.fragmentShader;
    f = f.replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>\n#include <common>\nvarying vec3 vXV;\n' + NOISE_GLSL + WOUND_GLSL);
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (segDead()) discard;
      if (vBind.z > uCutZ + cutNoise(vBind) + ${kind === 'bone' ? '0.010' : '0.0'}) discard;`);
    f = f.replace('gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );', kind === 'bone' ? `
      WSum ws = woundSum(vBind);
      vec3 N = normalize(normal); vec3 V = normalize(vXV);
      float fr = 1.0 - abs(dot(N, V));
      float edge = pow(fr, 1.5);
      float crack = clamp(ws.fract, 0.0, 1.0) * smoothstep(0.42, 0.5, 1.0 - abs(vnoise(vBind * 700.0) - 0.5));
      vec3 xc = vec3(0.66, 0.88, 1.0) * (0.12 + 0.62 * edge) * (0.82 + 0.36 * vnoise(vBind * 300.0));
      xc = mix(xc, vec3(1.0, 0.30, 0.18) * 1.5, crack);
      gl_FragColor = vec4(xc * uXray, 1.0);` : `
      vec3 N = normalize(normal); vec3 V = normalize(vXV);
      float fr = 1.0 - abs(dot(N, V));
      vec3 xc = vec3(0.32, 0.55, 0.74) * (0.05 + 0.36 * pow(fr, 2.0));
      gl_FragColor = vec4(xc * uXray, 1.0);`);
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'cg-x-' + kind;
  return m;
}

function makeDepthMaterial(U) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeg;\nuniform float uSwell[' + NSEG + '];\nvarying vec3 vBind;\nflat varying float vSeg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position; vSeg = aSeg;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uAlive[' + NSEG + '];\nuniform float uCutZ;\nvarying vec3 vBind;\nflat varying float vSeg;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uAlive[int(vSeg+0.5)] < 0.5) discard;\nif (vBind.z > uCutZ) discard;');
  };
  m.customProgramCacheKey = () => 'cg-depth-1';
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

// 세그먼트 자식 목록
function descendants(i) {
  const out = [i];
  HEADER.parent.forEach((p, j) => { if (p === i) out.push(...descendants(j)); });
  return out;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------------ 팔
export class Arm {
  constructor(assets, side, opts = {}) {
    this.side = side;               // 'L' | 'R'
    this.sign = side === 'L' ? -1 : 1;
    const U = this.U = {
      uWA: { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, 0, 0.01)) },
      uWB: { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uWN: { value: 0 },
      uAlive: { value: new Array(NSEG).fill(1) },
      uSwell: { value: new Array(NSEG).fill(0) },
      uGone: { value: new Array(NSEG).fill(0) },
      uCutZ: { value: 1.0 },
      uTime: { value: 0 },
      uXray: { value: 0 },
      uWet: { value: 0 },
      uWrap: { value: 0.55 },
      uSSS: { value: new THREE.Color(1.0, 0.32, 0.20) },
      uSkinTint: { value: new THREE.Color().setRGB(...(new URLSearchParams(location.search).get('tint') || '0.86,0.70,0.60').split(',').map(Number)) },
    };
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
    this.skeleton = new THREE.Skeleton(bones);
    this.skinMat = makeSkinMaterial(U);
    this.meatMat = makeMeatMaterial(U);
    this.boneMat = makeBoneMaterial(U, false);
    this.xrayMat = makeXrayMaterial(U, 'bone');
    this.xskinMat = makeXrayMaterial(U, 'skin');
    const mk = (geo, mat) => { const m = new THREE.SkinnedMesh(geo, mat); m.frustumCulled = false; return m; };
    this.skin = mk(assets.geos.skin, this.skinMat);
    this.upper = mk(assets.geos.upper, this.skinMat);
    this.meat = mk(assets.geos.meat, this.meatMat);
    this.bone = mk(assets.geos.bone, this.boneMat);
    this.xray = mk(assets.geos.bone, this.xrayMat);
    this.xray.layers.set(1); this.xray.renderOrder = 10;
    this.xskin = mk(assets.geos.skin, this.xskinMat); this.xskin.layers.set(1); this.xskin.renderOrder = 9;
    this.xupper = mk(assets.geos.upper, this.xskinMat); this.xupper.layers.set(1); this.xupper.renderOrder = 9;
    this.skin.add(bones[0]);
    this.mirror.add(this.skin, this.upper, this.meat, this.bone, this.xray, this.xskin, this.xupper);
    this.skin.bind(this.skeleton);
    for (const m of [this.upper, this.meat, this.bone, this.xray, this.xskin, this.xupper]) m.bind(this.skeleton, this.skin.bindMatrix);
    this.skin.castShadow = true; this.skin.receiveShadow = true;
    this.upper.castShadow = true; this.upper.receiveShadow = true;
    this.upper.customDepthMaterial = makeDepthMaterial(U);
    this.meat.receiveShadow = true; this.bone.receiveShadow = true;
    this.skin.customDepthMaterial = makeDepthMaterial(U);
    // 부착물(유리·덫·고철)을 붙일 묶음 — 뼈를 따라감
    this.attach = {};
    for (const n of ['hand', 'forearm']) {
      const g = new THREE.Group(); bones[SEG[n]].add(g); this.attach[n] = g;
      g.position.fromArray(HEADER.pivot[SEG[n]]).multiplyScalar(-1);   // 자식 좌표 = 바인드 좌표
    }
    // 반팔 소매: 팔 메시 끝(위팔)을 덮음 — 가로 화면에서 짧아진 팔이 앞으로 나올 때 끝이 안 보이게
    this.sleeveGroup = new THREE.Group(); bones[SEG.forearm].add(this.sleeveGroup);
    this.sleeveGroup.position.fromArray(HEADER.pivot[SEG.forearm]).multiplyScalar(-1);
    this.sleeveGroup.add(makeSleeve());
    // 그루터기 덮개
    this.capGroup = new THREE.Group(); bones[SEG.forearm].add(this.capGroup);
    this.capGroup.position.fromArray(HEADER.pivot[SEG.forearm]).multiplyScalar(-1);
    this.capMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0 });
    this.reset();
  }

  // 팔 상태 완전 초기화(새 살)
  reset() {
    this.I = 0;               // 손실량 0(멀쩡) ~ 0.5(손 없음) ~ 1(팔꿈치)
    this.wounds = [];         // {p:Vector3, r, type, k, seed, deep, born}
    this.spots = [];          // 반복 타격 지점의 누적
    this.alive = new Array(NSEG).fill(1);
    this.swell = new Array(NSEG).fill(0);
    this.gone = new Array(NSEG).fill(0);       // 뜯겨 나간(오므라든) 마디
    this.handScale = new THREE.Vector3(1, 1, 1);
    this.cutZ = 1.0;
    this.events = { fract: 0, nail: 0, finger: 0, hand: 0, scrap: 0 };
    this.fingerState = [0, 1, 2, 3].map((i) => ({ broken: false, gone: false, nail: true,
      tFract: rnd(0.07, 0.22) + (i >= 2 ? 0.05 : 0), tNail: rnd(0.10, 0.30), tGone: rnd(0.24, 0.40) + (i === 1 ? 0.04 : 0),
      bend: [rnd(-1, 1) > 0 ? 1 : -1, rnd(0.45, 0.85), Math.random() < 0.5 ? 'p' : 'm'] }));
    this.thumbState = { broken: false, gone: false, nail: true, tFract: rnd(0.16, 0.30), tNail: rnd(0.2, 0.36), tGone: rnd(0.36, 0.45) };
    this.wristBroken = false; this.tWrist = rnd(0.40, 0.46);
    this.dangle = 0; this.dangleV = 0;
    this.boneRot = HEADER.segs.map(() => new THREE.Quaternion());
    this.boneRotTarget = HEADER.segs.map(() => new THREE.Quaternion());
    this.embedded = [];        // 박힌 유리 등
    this.traps = [];           // 매달린 쥐덫
    this.bleed = 0;            // 초당 손실(유리)
    this.acidT = 0;            // 산 지속
    this.scrap = null;         // 고철 부착 상태
    for (const g of Object.values(this.attach)) g.clear();
    this.capGroup.clear(); this.cap = null; this.capZ = 99;
    this.fingerCaps = [];
    this.material = 'flesh';
    this._apply();
  }

  // 저장된 손실 상태로 되돌림(상처는 새로)
  setStump(I) {
    if (I < 0.5) {
      const res = { flesh: 0, scrap: 0, ev: [], point: null };
      while (this.I < I - 1e-6) this.damageFlesh(Math.min(0.012, I - this.I), {}, res);
      return;
    }
    this.I = Math.min(1, I);
    if (this.I >= 0.5) {
      for (const n of ['hand', 't0', 't1', 't2']) this.alive[SEG[n]] = 0;
      for (let f = 0; f < 4; f++) for (const c of 'pmd') this.alive[SEG[`f${f}${c}`]] = 0;
      this.fingerState.forEach((fs) => { fs.gone = true; fs.broken = true; fs.nail = false; });
      Object.assign(this.thumbState, { gone: true, broken: true, nail: false });
      this.wristBroken = true;
      this.cutZ = 0.006 - ((this.I - 0.5) / 0.5) * 0.266;
      this.addWound(new THREE.Vector3(0, 0.006, Math.min(this.cutZ, 0.0) - 0.014), 0.026, W.BRUISE, 1);
    }
    this._apply();
  }
  hasFlesh() { return this.I < 0.5; }
  hasFist() { return this.I < 0.5 || (this.scrap && this.scrap.lumpHP > 0); }
  canPunch() { return this.I < 0.995 || (this.scrap && (this.scrap.lumpHP > 0 || this.scrap.pipeHP > 0)); }
  // 주먹 앞면(타격면)이 팔 원점(손목)에서 +Z로 얼마나 앞에 있는지
  reach() {
    if (this.I < 0.5 || (this.scrap && this.scrap.lumpHP > 0)) return 0.097;
    if (this.scrap && this.scrap.pipeHP > 0) return 0.0;
    return Math.min(0.0, this.cutZ);
  }

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
      this.wounds.forEach((x, i) => { const v = x.k * (x.type === W.BRUISE ? 0.3 : 1) * (x.type === W.OPEN ? 4 : 1); if (v < mv) { mv = v; mi = i; } });
      this.wounds.splice(mi, 1);
    }
    return w;
  }

  // 주먹 앞면의 타격 지점(바인드 좌표) 고르기
  impactPoint() {
    const A = ANAT;
    const r = Math.random();
    const pick = r < 0.38 ? 1 : r < 0.70 ? 0 : r < 0.90 ? 2 : 3;
    const fs = this.fingerState[pick];
    const base = A.MCP[pick];
    const t = Math.random();
    const p = new THREE.Vector3();
    if (t < 0.6 || fs.gone) {
      // 너클(앞·위)
      p.copy(base).add(new THREE.Vector3(rnd(-0.004, 0.004), 0.004 + rnd(-0.003, 0.004), A.MCP_R[pick] * 0.85));
    } else {
      // 첫마디 앞면
      const d1 = A.FDIR[pick][0];
      p.copy(base).addScaledVector(d1, rnd(0.008, 0.03)).add(new THREE.Vector3(rnd(-0.004, 0.004), 0, A.FR[pick][0] * 0.95));
    }
    return { p, finger: pick };
  }

  // 손 없는 그루터기의 타격면 지점
  stumpPoint() {
    const z = Math.min(this.cutZ, 0.0);
    return new THREE.Vector3(rnd(-0.015, 0.015), rnd(-0.01, 0.012), z);
  }

  // ------------------------------------------------ 피해 적용 (살)
  // kind: 벽이 주는 상처 성격, dI: 손실 증가량
  damageFlesh(dI, kind, out) {
    if (this.I >= 0.999) return;
    const prev = this.I;
    this.I = Math.min(1, this.I + dI);
    out.flesh += this.I - prev;
    if (prev < 0.5) this._fistDamage(prev, kind, out);
    if (this.I >= 0.5) this._stumpDamage(prev, kind, out);
  }

  _fistDamage(prev, kind, out) {
    const I = Math.min(this.I, 0.5);
    const hit = this.impactPoint();
    out.point = hit.p.clone();
    out.finger = hit.finger;
    // 반복 지점 누적
    let sp = this.spots.find((s) => s.p.distanceTo(hit.p) < 0.009);
    if (!sp) { sp = { p: hit.p.clone(), s: 0 }; this.spots.push(sp); }
    sp.s += (I - prev) * 9 + 0.06;
    const s = sp.s;
    // 기본 둔상 진행: 멍 → 까짐 → 열린 상처 → 뼈 노출
    const rr = rnd(0.0065, 0.0105);
    this.addWound(hit.p, rr * 1.5, W.BRUISE, clamp01(0.25 + s * 0.6));
    if (s > 0.22 || kind.abr) this.addWound(hit.p, rr, W.ABR, clamp01((s - 0.12) * 1.6 + (kind.abr || 0)));
    if (s > 0.55) this.addWound(hit.p, rr * 1.05, W.OPEN, clamp01((s - 0.45) * 1.3), clamp01((s - 1.0) * 1.2));
    // 벽 성격별 상처
    if (kind.cut && Math.random() < kind.cut) this.addWound(hit.p.clone().add(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.008, 0.008), 0)), rnd(0.008, 0.016), W.CUT, rnd(0.6, 1));
    if (kind.punct) for (let i = 0; i < kind.punct; i++) {
      const q = hit.p.clone().add(new THREE.Vector3(rnd(-0.02, 0.02), rnd(-0.02, 0.01), rnd(-0.002, 0.002)));
      this.addWound(q, rnd(0.006, 0.009), W.PUNCT, 1);
    }
    if (kind.burn) for (let i = 0; i < 3; i++) {
      const q = ANAT.MCP[i % 4].clone().add(new THREE.Vector3(rnd(-0.01, 0.01), rnd(-0.03, 0.006), 0.01));
      this.addWound(q, rnd(0.016, 0.026), W.BURN, clamp01(kind.burn + sp.s * 0.15));
    }
    if (kind.frost) this.addWound(hit.p, rnd(0.010, 0.016), W.FROST, clamp01(kind.frost));
    if (kind.acid) for (let i = 0; i < 2; i++) {
      const q = ANAT.MCP[Math.floor(Math.random() * 4)].clone().add(new THREE.Vector3(rnd(-0.012, 0.012), rnd(-0.035, 0.008), rnd(-0.01, 0.012)));
      this.addWound(q, rnd(0.014, 0.024), W.ACID, clamp01(kind.acid));
    }
    if (kind.elec) this.addWound(hit.p.clone().add(new THREE.Vector3(rnd(-0.015, 0.015), rnd(-0.02, 0.01), 0)), rnd(0.018, 0.03), W.ELEC, clamp01(kind.elec));
    // 붓기
    const sw = Math.min(0.0024, I * 0.007);
    this.swell[SEG.hand] = sw * 0.6;
    for (let f = 0; f < 4; f++) for (const c of 'pmd') this.swell[SEG[`f${f}${c}`]] = sw * (c === 'p' ? 0.9 : 0.5);
    this.handScale.set(1 + I * 0.10, 1 - Math.max(0, I - 0.25) * 0.55, 1 - Math.max(0, I - 0.3) * 0.25);
    // 사건: 골절·손톱·손가락
    const boost = kind.fractBoost || 0;
    this.fingerState.forEach((fs, i) => {
      if (fs.gone) return;
      if (!fs.broken && I >= fs.tFract - boost) {
        fs.broken = true; out.ev.push({ t: 'fract', f: i }); this.events.fract++;
        const [sg, amt, joint] = fs.bend;
        const q = new THREE.Quaternion();
        if (joint === 'p') q.setFromAxisAngle(new THREE.Vector3(0.25 * sg, 0, 1).normalize(), sg * amt * 0.9);
        else q.setFromAxisAngle(new THREE.Vector3(1, sg * 0.4, 0).normalize(), -amt * 1.15);
        this.boneRotTarget[SEG[`f${i}${joint}`]].copy(q);
        const bp = (joint === 'p' ? ANAT.MCP[i] : ANAT.PIP[i]).clone();
        this.addWound(bp, 0.007, W.FRACT, 1);
        this.addWound(bp, 0.013, W.BRUISE, 0.9);
      }
      if (fs.nail && I >= fs.tNail - boost * 0.5) {
        fs.nail = false; out.ev.push({ t: 'nail', f: i }); this.events.nail++;
        const tp = ANAT.DIP[i].clone().lerp(ANAT.TIP[i], 0.7);
        this.addWound(tp, 0.0075, W.ABR, 1);
        this.addWound(tp, 0.009, W.OPEN, 0.7);
      }
      if (!fs.gone && I >= fs.tGone) {
        fs.gone = true; out.ev.push({ t: 'finger', f: i }); this.events.finger++;
        for (const c of 'pmd') { this.gone[SEG[`f${i}${c}`]] = 1; this.alive[SEG[`f${i}${c}`]] = 0; }
        this.addWound(ANAT.MCP[i].clone().add(new THREE.Vector3(0, -0.004, 0.004)), 0.012, W.ABR, 1);
        this.addWound(ANAT.MCP[i].clone().add(new THREE.Vector3(0, 0.002, -0.006)), 0.016, W.BRUISE, 1);
        this._addFingerPlug(i);
      }
    });
    const ts = this.thumbState;
    if (!ts.broken && I >= ts.tFract) {
      ts.broken = true; out.ev.push({ t: 'fract', f: 4 }); this.events.fract++;
      this.boneRotTarget[SEG.t1].setFromAxisAngle(new THREE.Vector3(0, 1, 0.3).normalize(), rnd(0.5, 0.9));
      this.addWound(ANAT.T[1], 0.008, W.FRACT, 1);
    }
    if (ts.nail && I >= ts.tNail) { ts.nail = false; out.ev.push({ t: 'nail', f: 4 }); this.events.nail++; this.addWound(ANAT.T[2].clone().lerp(ANAT.T[3], 0.7), 0.008, W.ABR, 1); }
    if (!ts.gone && I >= ts.tGone) { ts.gone = true; out.ev.push({ t: 'finger', f: 4 }); this.events.finger++; this.gone[SEG.t1] = 1; this.gone[SEG.t2] = 1; this.alive[SEG.t1] = 0; this.alive[SEG.t2] = 0; this._addFingerPlug(4); this.addWound(ANAT.T[1].clone(), 0.012, W.ABR, 1); }
    if (!this.wristBroken && I >= this.tWrist) {
      this.wristBroken = true; out.ev.push({ t: 'wrist' }); this.events.fract++;
      this.addWound(new THREE.Vector3(0, 0.0, -0.004), 0.016, W.FRACT, 1);
      this.addWound(new THREE.Vector3(0, 0.012, -0.002), 0.02, W.BRUISE, 1);
      this.addWound(new THREE.Vector3(0.022, 0.008, -0.006), 0.012, W.OPEN, 0.8, 0.5);
    }
    if (prev < 0.5 && this.I >= 0.5) {
      // 손이 떨어져 나감
      out.ev.push({ t: 'hand' }); this.events.hand++;
      for (const n of ['hand', 't0', 't1', 't2']) this.alive[SEG[n]] = 0;
      for (let f = 0; f < 4; f++) for (const c of 'pmd') this.alive[SEG[`f${f}${c}`]] = 0;
      this.cutZ = 0.006;
      this.attach.hand.clear(); this.embedded = []; this.traps = []; this.bleed = 0;
      this.wounds = this.wounds.filter((w) => w.p.z < -0.004);
      this.addWound(new THREE.Vector3(0, 0.006, -0.012), 0.024, W.BRUISE, 1);
    }
    this._apply();
  }

  _stumpDamage(prev, kind, out) {
    // 0.5 → 1.0 : 손목(0.006) → 팔꿈치 근처(-0.26)
    const t = (this.I - 0.5) / 0.5;
    const z = 0.006 - t * 0.266;
    this.cutZ = z;
    out.point = this.stumpPoint();
    // 그루터기 끝 살이 짓이겨짐
    this.addWound(new THREE.Vector3(rnd(-0.008, 0.008), rnd(-0.006, 0.01), Math.min(z, 0.0) - 0.006), rnd(0.028, 0.036), W.ABR, 1);
    this.addWound(new THREE.Vector3(rnd(-0.008, 0.008), rnd(-0.004, 0.012), Math.min(z, 0.0) - 0.016), 0.03, W.BRUISE, 1);
    if (Math.floor(prev * 40) !== Math.floor(this.I * 40) && this.I > 0.5) out.ev.push({ t: 'stump' });
    this._apply();
  }

  // 떨어져 나간 손가락 자리에 마개(손 묶음에 붙음 → 손을 따라감)
  _addFingerPlug(f) {
    const A = ANAT;
    let base, dir, r;
    if (f === 4) { base = A.T[1].clone(); dir = A.T[2].clone().sub(A.T[1]).normalize(); r = 0.0106; }
    else { base = A.MCP[f].clone(); dir = A.FDIR[f][0].clone().normalize(); r = A.FR[f][0]; }
    const grp = new THREE.Group();
    grp.position.copy(base).addScaledVector(dir, r * 0.12);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    grp.rotateZ(Math.random() * Math.PI * 2);
    const plug = new THREE.Mesh(plugGeometry(Math.random()), this.capMat);
    plug.scale.setScalar(r * 0.86);
    plug.castShadow = true;
    const knob = new THREE.Mesh(knobGeometry(), this.knobMat || (this.knobMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 })));
    knob.scale.set(r * 0.40, r * 0.36, r * 0.30);
    knob.position.set(r * 0.06, r * 0.05, r * 0.34);
    grp.add(plug, knob);
    this.attach.hand.add(grp);
    this.fingerCaps.push(grp);
  }

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
    U.uAlive.value = this.alive.slice();
    U.uSwell.value = this.swell.slice();
    U.uGone.value = this.gone.slice();

    U.uCutZ.value = this.cutZ;
    const n = Math.min(this.wounds.length, NW);
    for (let i = 0; i < n; i++) {
      const w = this.wounds[i];
      U.uWA.value[i].set(w.p.x, w.p.y, w.p.z, w.r);
      U.uWB.value[i].set(w.type, w.k, w.seed, w.deep || 0);
    }
    U.uWN.value = n;
    this.bones[SEG.hand].scale.copy(this.handScale);
    // 속살·뼈는 피부에 구멍이 있을 때만 그림(가려진 채로 그리면 낭비)
    const holes = this.cutZ < 0.5 || this.alive.some((v) => v < 0.5) ||
      this.wounds.some((w) => (w.type === W.OPEN && w.k > 0.35) || (w.type === W.ACID && w.k > 0.6) || (w.type === W.FROST && w.k > 0.6));
    this.meat.visible = holes; this.bone.visible = holes;
    this._updateCap();
  }

  // 그루터기 덮개(단면): 살·지방·뼈
  _updateCap() {
    const z = this.cutZ;
    if (z > 0.5) { if (this.cap) { this.capGroup.remove(this.cap); this.cap.geometry.dispose(); this.cap = null; } this.capZ = 99; return; }
    if (Math.abs(z - this.capZ) < 0.0015 && this.cap) return;
    this.capZ = z;
    if (this.cap) { this.capGroup.remove(this.cap); this.cap.geometry.dispose(); }
    this.cap = makeCapMesh(HEADER.xsec, Math.min(z, 0.006), this.capMat, this.seedCap || (this.seedCap = Math.random() * 100));
    this.capGroup.add(this.cap);
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
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.15).normalize(), this.dangle * 0.95);
      hb.quaternion.copy(q);
    } else hb.quaternion.identity();
    // 부러진 손가락: 목표 회전으로 튐(스프링)
    for (let i = 2; i < HEADER.segs.length; i++) {
      const b = this.bones[i];
      b.quaternion.slerp(this.boneRotTarget[i], Math.min(1, dt * 18));
    }
  }

  // 충격 순간 덜렁이는 손 튕김
  kick(power) { this.dangleV -= 14 * power; }
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
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSl;\n' + NOISE_GLSL)
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

// ------------------------------------------------------------------ 떨어진 손가락 자리 마개
// 짓이겨진 살 덩이 + 드러난 관절머리. 로컬 +Z = 손가락이 있던 방향
const _plugGeoCache = {};
function plugGeometry(seed) {
  const key = Math.floor(seed * 7) % 5;
  if (_plugGeoCache[key]) return _plugGeoCache[key];
  const g = new THREE.SphereGeometry(1, 22, 16);
  const pos = g.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const lin = (c) => c.map((x) => Math.pow(x, 2.2));
  const C_MUS = lin([0.58, 0.07, 0.055]), C_MUS2 = lin([0.75, 0.16, 0.12]), C_DK = lin([0.26, 0.015, 0.012]), C_FAT = lin([0.93, 0.80, 0.48]), C_SKIN = lin([0.80, 0.50, 0.42]);
  const h = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + key * 19.3) * 43758.5453; return s - Math.floor(s); };
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const q = (k) => Math.round(k * 1000) / 1000;
    const r1 = h(q(v.x), q(v.y), q(v.z));
    const lump = Math.sin(v.x * 5.3 + key) * Math.sin(v.y * 4.7 + key * 1.7) * Math.cos(v.z * 3.9 + key * 2.3);
    const front = v.z;                      // -1(손 안쪽) ~ 1(손가락 쪽)
    const rad = 1 + lump * 0.16 + (r1 - 0.5) * 0.12;
    const sz = front > 0 ? 0.62 + lump * 0.12 : 0.5;
    pos.setXYZ(i, v.x * rad * 1.18, v.y * rad * 1.18, v.z * sz);
    // 색: 가장자리 찢긴 피부 → 근육 → 가운데 검붉은 피
    const rr = Math.sqrt(v.x * v.x + v.y * v.y);
    let c;
    if (front < -0.2) c = C_DK;
    else if (rr > 0.93 && front < 0.35) c = C_SKIN;
    else c = r1 > 0.55 ? C_MUS : (r1 > 0.22 ? C_DK : C_MUS2);
    const dark = front > 0.55 ? 0.5 + r1 * 0.25 : 0.75 + r1 * 0.3;
    col[i * 3] = c[0] * dark; col[i * 3 + 1] = c[1] * dark; col[i * 3 + 2] = c[2] * dark;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  _plugGeoCache[key] = g;
  return g;
}
let _knobGeo = null;
function knobGeometry() {
  if (_knobGeo) return _knobGeo;
  const g = new THREE.SphereGeometry(1, 16, 12);
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    pos.setXYZ(i, v.x * 0.95, v.y * 0.8, v.z * 0.9);
    // 관절 연골: 희고 반들, 아래쪽은 피
    const blood = Math.max(0, -v.y * 0.9 + Math.sin(v.x * 9.0) * 0.25 - 0.1);
    const c = [Math.pow(0.92 - blood * 0.6, 2.2), Math.pow(0.86 - blood * 0.8, 2.2), Math.pow(0.78 - blood * 0.75, 2.2)];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  _knobGeo = g;
  return g;
}

// ------------------------------------------------------------------ 그루터기 단면 메시
function makeCapMesh(xsec, z, mat, seed) {
  // z에 맞는 단면 보간
  let i = 0;
  while (i < xsec.length - 2 && xsec[i + 1].z < z) i++;
  const a = xsec[i], b = xsec[i + 1];
  const t = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
  const N = a.pts.length;
  const pts = [];
  for (let k = 0; k < N; k++) pts.push([a.pts[k][0] + (b.pts[k][0] - a.pts[k][0]) * t, a.pts[k][1] + (b.pts[k][1] - a.pts[k][1]) * t]);
  const cx = a.c[0] + (b.c[0] - a.c[0]) * t, cy = a.c[1] + (b.c[1] - a.c[1]) * t;
  const bones = (t < 0.5 ? a.bones : b.bones);
  const R = 3;  // 동심 고리: 피부(바깥) → 지방 → 근육
  const pos = [], col = [], idx = [];
  const rand = (k) => { const x = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453; return x - Math.floor(x); };
  const lin = (r, g, b2) => [Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b2, 2.2)];
  const C_SKIN = lin(0.86, 0.62, 0.52), C_FAT = lin(0.95, 0.85, 0.55), C_MUS = lin(0.62, 0.10, 0.08), C_DK = lin(0.38, 0.03, 0.03), C_BONE = lin(0.95, 0.90, 0.80), C_MAR = lin(0.55, 0.12, 0.08);
  // 중심
  pos.push(cx, cy, z + 0.004); col.push(...C_DK);
  const rings = [0.08, 0.16, 0.55, 1.0];
  const rcols = [C_SKIN, C_FAT, C_MUS, C_DK];
  for (let r = 0; r < rings.length; r++) {
    for (let k = 0; k < N; k++) {
      const s = 1 - rings[r] * 0.92;
      const j = (rand(k + r * 31) - 0.5) * 0.004 * (r === 0 ? 1.5 : 0.6);
      const x = cx + (pts[k][0] - cx) * s * (1 + j * 8), y = cy + (pts[k][1] - cy) * s * (1 + j * 8);
      const dz = r === 0 ? -0.002 + rand(k * 3.1) * 0.006 : 0.001 + rings[r] * 0.003 + (rand(k * 7.7 + r) - 0.5) * 0.003;
      pos.push(x, y, z + dz);
      const c = rcols[r]; const vv = 0.8 + rand(k * 5.3 + r) * 0.4;
      col.push(c[0] * vv, c[1] * vv, c[2] * vv);
    }
  }
  // 삼각형: 링 사이
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < N; k++) {
      const a0 = 1 + r * N + k, a1 = 1 + r * N + ((k + 1) % N), b0 = 1 + (r + 1) * N + k, b1 = 1 + (r + 1) * N + ((k + 1) % N);
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const last = 1 + (rings.length - 1) * N;
  for (let k = 0; k < N; k++) idx.push(last + k, 0, last + ((k + 1) % N));
  // 뼈 단면(요골·척골) — 살짝 튀어나온 원통 + 들쭉날쭉 끝
  for (const bb of bones) {
    const [bx, by, br] = bb;
    const base = pos.length / 3; const M = 14;
    const len = 0.006 + rand(bx * 99) * 0.010;
    pos.push(bx, by, z + len + 0.002); col.push(...C_MAR);
    for (let k = 0; k < M; k++) {
      const an = (k / M) * Math.PI * 2;
      const jag = 0.6 + rand(k + bx * 50) * 0.8;
      pos.push(bx + Math.cos(an) * br, by + Math.sin(an) * br, z + len * jag); col.push(...C_BONE);
    }
    for (let k = 0; k < M; k++) {
      const an = (k / M) * Math.PI * 2;
      pos.push(bx + Math.cos(an) * br * 1.02, by + Math.sin(an) * br * 1.02, z - 0.002); col.push(C_BONE[0] * 0.8, C_BONE[1] * 0.75, C_BONE[2] * 0.7);
    }
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      idx.push(base, base + 1 + k, base + 1 + k1);  // 끝면(골수)
      const t0 = base + 1 + k, t1 = base + 1 + k1, b0 = base + 1 + M + k, b1 = base + 1 + M + k1;
      idx.push(b0, t1, t0, b0, b1, t1);
    }
    // 골수 안쪽 짙게
    col[base * 3] = C_MAR[0]; col[base * 3 + 1] = C_MAR[1]; col[base * 3 + 2] = C_MAR[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
