// 철권 — 벽 8종
import * as THREE from 'three';
import { Scrap } from './scrap.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// 벽 정의 — dmg: 살 손실(0~1 단위), scrapDmg: 고철 피해, mult: 참을성 배율, fear: 처음 열었을 때 대기 중 주먹 떨림
// pace·space: 이 벽에서 살·고철이 닳는 빠르기. 어느 벽이든 맨손 한 판이 보통 속도로 2분 안팎, 고철 한 판이 1분 안팎이 되게 맞춤
export const WALLS = [
  { id: 'cement', name: '시멘트 벽', mult: 1.0, dmg: 0.0115, scrapDmg: 8, pace: 0.44, space: 0.35, fear: 0.0, kind: {} },
  { id: 'gravel', name: '자갈 박힌 벽', mult: 1.6, dmg: 0.0135, scrapDmg: 9, pace: 0.375, space: 0.3, fear: 0.15, kind: { abr: 0.45 } },
  { id: 'glass', name: '소주병 조각 벽', mult: 3.4, dmg: 0.0150, scrapDmg: 10, pace: 0.28, space: 0.28, fear: 0.45, kind: { cut: 0.75, punct: 1 } },
  { id: 'nails', name: '못 박힌 벽', mult: 5.6, dmg: 0.0160, scrapDmg: 11, pace: 0.45, space: 0.35, fear: 0.6, kind: { punct: 3 } },
  { id: 'freezer', name: '냉동창고 벽', mult: 6.6, dmg: 0.0170, scrapDmg: 10, pace: 0.38, space: 0.3, fear: 0.6, kind: {} },
  { id: 'hotplate', name: '달군 철판', mult: 9.0, dmg: 0.0185, scrapDmg: 12, pace: 0.28, space: 0.23, fear: 0.75, kind: { burn: 0.45 } },
  { id: 'electric', name: '전기 벽', mult: 15.5, dmg: 0.0200, scrapDmg: 14, pace: 0.085, space: 0.072, fear: 0.9, kind: { elec: 0.55 } },
  { id: 'spikes', name: '쇠꼬챙이 가시벽', mult: 20.0, dmg: 0.0260, scrapDmg: 18, pace: 0.235, space: 0.17, fear: 1.0, kind: { punct: 1 } },
];
// 가시벽에 먼저 다녀간 사람이 남긴 고철 주먹이 꿰여 있는 꼬챙이 자리(벽 좌표)
export const OLD_FIST_AT = { x: -0.0975, y: 0.135 };

// ------------------------------------------------------------------ GLSL
export const NOISE2 = /* glsl */`
float h31w(vec3 p){ p = fract(p*0.3183099 + vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31w(i+vec3(0,0,0)),h31w(i+vec3(1,0,0)),f.x), mix(h31w(i+vec3(0,1,0)),h31w(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31w(i+vec3(0,0,1)),h31w(i+vec3(1,0,1)),f.x), mix(h31w(i+vec3(0,1,1)),h31w(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fb(vec3 p){ return vn(p)*0.5 + vn(p*2.03+1.7)*0.27 + vn(p*4.11+3.3)*0.15 + vn(p*8.3+9.1)*0.08; }
float vn2(vec2 p){ return vn(vec3(p, 0.37)); }
float fb2(vec2 p){ return fb(vec3(p, 0.71)); }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
vec2 h22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// 보로노이 경계까지 거리 근사(d2-d1) — 각진 실금용
float vEdge(vec2 x){ vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec2 r = g + h22(n + g) - f; float d = length(r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return d2 - d1; }
vec3 perturbW(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize( dFdx( surf_pos ) ); vec3 vSigmaY = normalize( dFdy( surf_pos ) ); vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN ); vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;

// 공통 유니폼(피 지도·시간)
export const SHARED = {
  uBlood: { value: null },
  uBloodRect: { value: new THREE.Vector4(-0.6, -0.75, 1.2, 1.2) },
  uTime: { value: 0 },
};

const BLOOD_GLSL = /* glsl */`
uniform sampler2D uBlood;
uniform vec4 uBloodRect;
uniform float uTime;
varying vec3 vWPos;
vec4 bloodAt(vec2 p){ vec2 uv = (p - uBloodRect.xy) / uBloodRect.zw; if (uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0) return vec4(0.0); return texture2D(uBlood, uv); }
`;

// MeshStandardMaterial에 월드좌표·피 지도·표면 함수를 꽂는다.
// surf: GLSL 본문. 쓸 수 있는 변수: vec2 p(벽면 xy), vec3 wp, inout col, rough, metal, hgt, emis, bumpK
export function patchSurface(mat, surf, opts = {}) {
  const { bump = 1.0, blood = true, key = 'x', extraDecl = '', bloodMode = 'normal' } = opts;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SHARED, opts.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vLoc;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLoc = transformed;
        vec4 cgWP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        cgWP = instanceMatrix * cgWP;
        #endif
        vWPos = (modelMatrix * cgWP).xyz;`);
    let f = sh.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;\n' + NOISE2 + BLOOD_GLSL + extraDecl);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 col = diffuseColor.rgb; float rough = roughness; float metal = metalness; float hgt = 0.0; vec3 emis = vec3(0.0); float bumpK = ${bump.toFixed(4)};
      vec2 p = vWPos.xy; vec3 wp = vWPos;
      ${surf}
      ${blood ? (bloodMode === 'burnt' ? `
      vec4 bm = bloodAt(p);
      float ba = smoothstep(0.42, 0.85, bm.a);
      vec3 bc = mix(vec3(0.05,0.02,0.015), vec3(0.20,0.05,0.025), bm.r * 3.0);
      col = mix(col, bc, ba * 0.95); rough = mix(rough, 0.75, ba); hgt += ba * 0.4;
      // 오래전에 눌어붙어 새까맣게 탄 딱지(아주 어두운 자국)는 철판이 달아도 빛이 비치지 않음
      float charK = 1.0 - smoothstep(0.02, 0.07, bm.r);
      emis *= 1.0 - ba * (0.85 + 0.14 * charK);` : bloodMode === 'frozen' ? `
      vec4 bm = bloodAt(p);
      col = mix(col, bm.rgb * vec3(0.62, 0.42, 0.5), bm.a * 0.95);
      col = mix(col, vec3(0.78, 0.84, 0.9), bm.a * smoothstep(0.8, 0.95, vn(vec3(p*700.0, 1.0))) * 0.3);
      rough = mix(rough, 0.18, bm.a); metal = mix(metal, 0.0, bm.a); hgt += bm.a * 0.4;` : `
      vec4 bm = bloodAt(p);
      // 갓 묻은 피는 붉고 번들거림, 오래 말라붙은 피는 갈색이고 광이 없음(색의 붉은 정도로 가름)
      float wet = smoothstep(0.80, 0.94, (bm.r - bm.g) / max(bm.r, 0.004));
      col = mix(col, bm.rgb, bm.a * 0.97);
      rough = mix(rough, mix(0.66, 0.16, wet), smoothstep(0.1, 0.7, bm.a)); metal = mix(metal, 0.0, bm.a);
      hgt += bm.a * (0.16 + 0.34 * wet);`) : ''}
      diffuseColor.rgb = col;
    `);
    f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;');
    f = f.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = metal;');
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * bumpK; normal = perturbW(-vViewPosition, normal, dH, faceDirection); }`);
    f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emis;');
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'cgw-' + key;
  return mat;
}

// ------------------------------------------------------------------ 표면 GLSL
const S_CEMENT = /* glsl */`
  vec3 c0 = srgb(vec3(0.75, 0.73, 0.69));
  float n1 = fb2(p * 2.2);
  float n2 = fb2(p * 17.0 + 4.0);
  float n3 = vn2(p * 55.0);
  float pores = smoothstep(0.83, 0.92, vn2(p * 520.0 + 7.0));
  float pores2 = smoothstep(0.86, 0.95, vn2(p * 230.0 + 3.0));
  float sw = fb2(vec2(p.x * 5.0 + sin(p.y * 7.0) * 0.6, p.y * 1.6) + 9.0);
  col = c0 * (0.83 + 0.24 * n1) * (0.94 + 0.12 * n2) * (0.97 + 0.06 * n3);
  // 흙손 자국: 비스듬히 휜 넓은 결
  float tw = fb2(vec2(p.x * 2.6 + sin(p.y * 3.1 + p.x * 1.7) * 0.9, p.y * 8.0 + sin(p.x * 4.3) * 1.4) + 11.0);
  col *= 0.95 + 0.10 * tw;
  // 습기 얼룩: 아래로 갈수록 짙게
  float damp = smoothstep(0.48, 0.72, fb2(p * 1.5 + 2.0)) * smoothstep(0.25, -0.65, p.y);
  col = mix(col, col * srgb(vec3(0.80, 0.78, 0.74)), damp * 0.65);
  col *= 1.0 - pores * 0.42 - pores2 * 0.22;
  float st = fb2(vec2(p.x * 13.0, p.y * 1.1) + 21.0);
  col *= 1.0 - smoothstep(0.58, 0.85, st) * 0.10;
  // 실금: 보로노이 경계라 각지게 꺾임, 잔떨림을 얹고 몇 군데에만
  vec2 cq = p * 3.6 + vec2(vn2(p * 38.0), vn2(p * 38.0 + 5.3)) * 0.055 + vec2(fb2(p * 6.0), fb2(p * 6.0 + 2.7)) * 0.22;
  float ce = vEdge(cq);
  float cmask = smoothstep(0.47, 0.60, fb2(p * 1.6 + 5.0));
  float cw = 0.010 + 0.012 * vn2(p * 21.0);
  float caa = fwidth(ce) * 0.8;
  float crack = (1.0 - smoothstep(cw - caa, cw + caa, ce)) * cmask;
  float chip = (1.0 - smoothstep(cw * 2.4 - caa, cw * 2.4 + caa * 2.0, ce)) * cmask;
  col *= 1.0 - crack * 0.45 - chip * 0.07;
  hgt = n2 * 0.5 + sw * 0.35 + n3 * 0.15 + tw * 0.25 - pores * 0.9 - pores2 * 0.5 - crack * 0.8;
  rough = 0.88 - n2 * 0.08 - damp * 0.06;
`;
// 칠한 시멘트 벽: 학교 복도·생활관·관공서 벽처럼 허리께 아래는 초록 유성페인트, 위는 미색. 오래돼서 군데군데 벗겨짐
export const PAINT_LINE_Y = -0.235;
const S_PAINT = /* glsl */`
  // 벗겨진 데로 보이는 밑바탕 시멘트
  vec3 cc = srgb(vec3(0.64, 0.62, 0.58)) * (0.84 + 0.26 * fb2(p * 2.2)) * (0.92 + 0.14 * fb2(p * 17.0 + 4.0));
  float cpore = smoothstep(0.80, 0.92, vn2(p * 520.0 + 7.0));
  cc *= 1.0 - cpore * 0.4;
  // 시멘트가 갈라진 데는 칠도 같이 갈라짐
  vec2 cq = p * 3.6 + vec2(vn2(p * 38.0), vn2(p * 38.0 + 5.3)) * 0.055 + vec2(fb2(p * 6.0), fb2(p * 6.0 + 2.7)) * 0.22;
  float ce = vEdge(cq);
  float cmask = smoothstep(0.50, 0.62, fb2(p * 1.6 + 5.0));
  float cw = 0.006 + 0.007 * vn2(p * 21.0);
  float caa = fwidth(ce) * 0.8;
  float crack = (1.0 - smoothstep(cw - caa, cw + caa, ce)) * cmask;
  // 두 색 경계(테이프 붙여 칠한 선이 세월에 살짝 울퉁불퉁)
  float yb = ${PAINT_LINE_Y.toFixed(3)} + (vn2(vec2(p.x * 2.3, 4.1)) - 0.5) * 0.0024;
  float ya = fwidth(p.y) * 1.2;
  float green = 1.0 - smoothstep(yb - ya, yb + ya, p.y);
  float stripe = (1.0 - green) * (1.0 - smoothstep(yb + 0.012 - ya, yb + 0.012 + ya, p.y));
  vec3 cream = srgb(vec3(0.93, 0.89, 0.785));
  vec3 grn = srgb(vec3(0.235, 0.425, 0.315));
  vec3 dgrn = srgb(vec3(0.115, 0.245, 0.175));
  vec3 pc = mix(mix(cream, grn, green), dgrn, stripe);
  // 롤러·붓 자국, 덧칠 얼룩
  float roll = fb2(vec2(p.x * 1.4, p.y * 34.0) + 3.0);
  float brush = fb2(vec2(p.x * 70.0, p.y * 2.4) + 7.0);
  float patchy = fb2(p * 3.2 + 17.0);
  pc *= 0.955 + 0.06 * mix(roll, brush, green) + 0.05 * (patchy - 0.5);
  // 미색은 누렇게 바래고, 경계 언저리엔 손때
  pc = mix(pc, pc * srgb(vec3(0.96, 0.91, 0.78)), smoothstep(0.35, 0.8, fb2(p * 1.7 + 12.0)) * (1.0 - green) * 0.75);
  float grime = (1.0 - smoothstep(0.0, 0.07, abs(p.y - yb))) * smoothstep(0.4, 0.8, fb2(p * vec2(5.0, 11.0) + 2.0));
  pc *= 1.0 - grime * 0.15;
  // 초록 칸: 신발·수레에 긁힌 자국
  float scuff = green * smoothstep(0.70, 0.88, fb2(vec2(p.x * 7.0, p.y * 26.0) + 5.0)) * smoothstep(yb - 0.03, yb - 0.22, p.y);
  pc = mix(pc, pc * 0.55 + srgb(vec3(0.06)), scuff * 0.5);
  // 칠이 벗겨진 자리: 드문드문 작게. 아래 초록 칸과 경계 근처에 조금 더
  float cn = fb2(p * 9.0 + 31.0) * 0.8 + vn2(p * 55.0) * 0.26 + vn2(p * 190.0) * 0.07;
  float chipT = 0.86 - 0.045 * smoothstep(-0.1, -0.55, p.y) - 0.04 * (1.0 - smoothstep(0.0, 0.04, abs(p.y - yb)));
  float chip = smoothstep(chipT, chipT + 0.01, cn);
  float lip = smoothstep(chipT - 0.022, chipT, cn) * (1.0 - chip);
  col = mix(pc, cc, chip);
  col *= 1.0 - lip * 0.16;
  col *= 1.0 - crack * mix(0.32, 0.5, chip);
  // 칠은 매끈하게 광이 나고(초록 에나멜이 더), 벗겨진 데는 거칠게
  float orange = vn2(p * 420.0);
  hgt = orange * 0.05 + roll * 0.06 + lip * 0.25 - chip * 0.35 + chip * fb2(p * 17.0 + 4.0) * 0.5 - crack * 0.6;
  rough = mix(mix(0.5, 0.3, green), 0.9, chip) + scuff * 0.2 + grime * 0.08 + orange * 0.03;
`;
const S_GRAVELBASE = /* glsl */`
  vec3 c0 = srgb(vec3(0.58, 0.56, 0.53));
  float n1 = fb2(p * 3.0); float g = vn2(p * 700.0); float g2 = vn2(p * 260.0 + 2.0);
  col = c0 * (0.8 + 0.3 * n1) * (0.85 + 0.3 * g2) * (0.9 + 0.2 * g);
  hgt = g * 0.6 + g2 * 0.4; rough = 0.95;
`;
const S_PLYWOOD = /* glsl */`
  vec3 w0 = srgb(vec3(0.80, 0.64, 0.43)), w1 = srgb(vec3(0.66, 0.47, 0.27));
  float warp = fb2(p * vec2(1.5, 6.0)) * 3.0;
  float grain = vn2(vec2(p.x * 3.0 + warp * 0.3, p.y * 140.0 + warp * 10.0));
  float rings = sin((p.y * 90.0 + warp * 6.0 + fb2(p * 4.0) * 5.0)) * 0.5 + 0.5;
  col = mix(w0, w1, smoothstep(0.3, 0.9, rings) * 0.55 + grain * 0.25);
  float seam = 1.0 - smoothstep(0.0, 0.002, abs(fract((p.x + 0.61) / 1.22) - 0.5) * 1.22 - 0.0);
  col *= 1.0 - (1.0 - smoothstep(0.0012, 0.003, abs(mod(p.y + 0.3, 0.61) - 0.305))) * 0.0;
  hgt = grain * 0.3 + rings * 0.2; rough = 0.72;
`;
const S_PLANKS = /* glsl */`
  float bh = 0.115; float row = floor(p.y / bh); float fy = fract(p.y / bh);
  float rs = h31w(vec3(row, 1.0, 2.0));
  vec3 wa = srgb(vec3(0.70, 0.56, 0.40)), wb = srgb(vec3(0.55, 0.43, 0.31)), wg = srgb(vec3(0.60, 0.58, 0.54));
  vec3 base = mix(wa, wb, rs);
  base = mix(base, wg, 0.35 + 0.3 * h31w(vec3(row, 7.0, 1.0)));
  float warp = fb2(vec2(p.x * 2.0, row * 3.1)) * 2.0;
  float grain = vn2(vec2(p.x * 4.0 + row * 13.0, fy * 30.0 + warp * 3.0));
  float lines = sin((fy * 26.0 + warp * 4.0 + p.x * 0.5) * 3.14159) * 0.5 + 0.5;
  col = base * (0.80 + 0.22 * grain) * (0.9 + 0.12 * lines);
  // 옹이
  vec2 kc = vec2(floor(p.x / 0.45) * 0.45 + 0.2 + rs * 0.1, (row + 0.5) * bh);
  float kd = length((p - kc) * vec2(1.0, 2.2));
  col *= 1.0 - (1.0 - smoothstep(0.006, 0.018, kd)) * 0.5;
  // 판자 틈
  float gap = 1.0 - smoothstep(0.012, 0.03, min(fy, 1.0 - fy));
  col *= 1.0 - gap * 0.75;
  hgt = grain * 0.4 + lines * 0.2 - gap * 2.0;
  rough = 0.78;
`;
const S_FREEZER = /* glsl */`
  // 스테인리스 골판 + 아래로 갈수록 두꺼운 성에 + 얼음 결정
  float rib = fract(p.x / 0.08 + 0.3);
  float prof = smoothstep(0.0, 0.1, rib) - smoothstep(0.52, 0.62, rib);
  float groove = 1.0 - smoothstep(0.0, 0.035, abs(rib - 0.57));
  vec3 steel = srgb(vec3(0.72, 0.76, 0.80)) * (0.88 + 0.12 * fb2(p * vec2(3.0, 60.0)));
  float fr = fb2(p * 5.0 + 1.0);
  float thick = smoothstep(0.38, 0.82, fr + prof * 0.12 + smoothstep(0.25, -0.65, p.y) * 0.3);
  float cryst = smoothstep(0.78, 0.96, vn2(p * 640.0 + 5.0)) * (0.3 + 0.7 * thick);
  vec3 frost = srgb(vec3(0.90, 0.94, 0.99)) * (0.92 + 0.08 * vn2(p * 160.0));
  col = mix(steel * (0.9 + 0.12 * prof) * (1.0 - groove * 0.4), frost, thick * 0.82);
  col = mix(col, srgb(vec3(0.66, 0.82, 0.95)), (1.0 - thick) * 0.22 + groove * 0.1);
  col += cryst * 0.45;
  metal = mix(0.8, 0.0, thick); rough = mix(0.32, 0.88, thick) - cryst * 0.45;
  hgt = prof * 0.6 - groove * 0.9 + vn2(p * 220.0) * thick * 0.6 + cryst * 0.5;
`;
const S_HOTPLATE = /* glsl */`
  vec2 hc = vec2(0.0, -0.04);
  float r = length((p - hc) * vec2(0.85, 1.0));
  float turb = fb(vec3(p * 9.0, uTime * 0.25));
  float heat = clamp(1.0 - r / (0.30 + turb * 0.07), 0.0, 1.0);
  heat = pow(heat, 1.25);
  vec3 steel = srgb(vec3(0.34, 0.33, 0.33)) * (0.75 + 0.35 * fb2(p * 6.0));
  float scale = smoothstep(0.55, 0.7, fb2(p * 14.0 + 4.0));
  steel = mix(steel, srgb(vec3(0.12, 0.13, 0.16)), scale * 0.6);
  // 템퍼 색 (열변색)
  float tr = r - 0.30;
  vec3 temper = mix(srgb(vec3(0.85, 0.72, 0.40)), srgb(vec3(0.55, 0.30, 0.25)), smoothstep(0.0, 0.05, tr));
  temper = mix(temper, srgb(vec3(0.35, 0.22, 0.55)), smoothstep(0.05, 0.10, tr));
  temper = mix(temper, srgb(vec3(0.25, 0.40, 0.70)), smoothstep(0.10, 0.15, tr));
  temper = mix(temper, steel, smoothstep(0.15, 0.24, tr));
  col = mix(steel, temper, smoothstep(0.42, 0.22, r));
  col = mix(col, srgb(vec3(0.25, 0.08, 0.04)), heat);
  float flick = 0.85 + 0.15 * vn(vec3(p * 30.0, uTime * 3.0));
  emis = vec3(1.0, 0.28, 0.04) * pow(heat, 1.6) * 7.0 * flick + vec3(1.0, 0.65, 0.2) * pow(heat, 4.0) * 6.0 * flick;
  hgt = fb2(p * 40.0) * 0.4 + scale * 0.3;
  metal = mix(0.85, 0.2, heat); rough = mix(0.45, 0.7, heat) + scale * 0.1;
`;
const S_STONE = /* glsl */`
  // 거친 돌·시멘트 (가시벽 바탕)
  vec2 q = p * vec2(1.0, 1.0);
  vec3 c0 = srgb(vec3(0.62, 0.58, 0.53));
  float n1 = fb2(q * 4.0); float n2 = fb2(q * 20.0 + 2.0); float n3 = vn2(q * 140.0);
  float blk = abs(fract(q.y / 0.16 + 0.5 * step(0.5, fract(q.x / 0.6))) - 0.5);
  float mortar = 1.0 - smoothstep(0.0, 0.04, abs(fract(q.y / 0.16) - 0.0));
  col = c0 * (0.75 + 0.35 * n1) * (0.9 + 0.2 * n2) * (0.93 + 0.1 * n3);
  col = mix(col, col * srgb(vec3(0.75, 0.55, 0.40)), smoothstep(0.55, 0.8, fb2(q * 3.0 + 8.0)) * 0.5);
  hgt = n2 * 0.6 + n3 * 0.4; rough = 0.93;
`;
const S_BACKCON = /* glsl */`
  vec3 c0 = srgb(vec3(0.66, 0.66, 0.64));
  float n1 = fb2(p * 3.0); float n2 = fb2(p * 25.0);
  col = c0 * (0.82 + 0.25 * n1) * (0.92 + 0.12 * n2);
  hgt = n2; rough = 0.9;
`;

// 지금 벽에 닿은 게 무엇인지: 'hand'(살 주먹) | 'scrap'(고철 덩어리) | 'pipe' | 'stump'(그루터기)
export function hitter(arm) {
  if (arm.I < 0.5) return 'hand';
  if (arm.scrap && arm.scrap.lumpHP > 0) return 'scrap';
  if (arm.scrap && arm.scrap.pipeHP > 0) return 'pipe';
  return 'stump';
}
// 그루터기 끝 근처 상처(바인드 좌표)
function stumpWound(arm, type, k, r = 0.03) {
  const z = Math.min(arm.cutZ, 0.006);
  arm.addWound(new THREE.Vector3(rnd(-0.006, 0.006), rnd(-0.004, 0.008), z - 0.012), r, type, k);
  arm._apply();
}

// ------------------------------------------------------------------ 벽 공통
class WallBase {
  constructor(def, ctx) {
    this.def = def; this.ctx = ctx; this.D = ctx.WALL_D;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.stopDepth = 0;
    this.lights = [];
    this.disposables = [];
  }
  basePlane(surf, opts = {}) {
    const mat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: opts.metal || 0 }), surf, { key: this.def.id + '-base', bump: opts.bump || 0.8, bloodMode: opts.bloodMode });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.6), mat);
    m.position.set(0, -0.1, -this.D + (opts.z || 0));
    m.receiveShadow = true;
    this.group.add(m);
    this.disposables.push(m.geometry, mat);
    this.base = m;
    return m;
  }
  add(o) { this.group.add(o); return o; }
  // 점광원은 늘 같은 개수로 장면에 있음(개수가 바뀌면 모든 재질이 다시 컴파일됨) → 빌려 씀
  takeLight(color, intensity, distance, decay) {
    const L = this.ctx.lightPool.find((l) => !l.userData.busy);
    L.userData.busy = true; L.color.set(color); L.intensity = intensity; L.distance = distance; L.decay = decay;
    this.lights.push(L);
    return L;
  }
  impact() { return {}; }
  tug() {}
  release() {}
  update() {}
  // 피가 튀어 묻을 표면 z
  surfaceZ() { return -this.D + this.stopDepth * 0.25; }
  dispose() {
    this.ctx.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose && m.dispose()); });
    for (const l of this.lights) { l.intensity = 0; l.userData.busy = false; }
  }
}

// 노이즈로 울퉁불퉁하게 만든 돌멩이 지오메트리
function rockGeo(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position; const v = new THREE.Vector3();
  const r = (k) => { const x = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const offs = Array.from({ length: 6 }, (_, i) => new THREE.Vector3(r(i) - 0.5, r(i + 9) - 0.5, r(i + 19) - 0.5).normalize());
  // 같은 자리 꼭짓점은 같은 값(면이 갈라지지 않게): 위치로 해시
  const key = (x) => Math.round(x * 1e4);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1;
    offs.forEach((o, k) => { d += Math.max(0, v.dot(o)) ** 3 * (r(k + 40) - 0.35) * 0.35; });
    d += (r(key(v.x) * 0.0137 + key(v.y) * 0.0291 + key(v.z) * 0.0173 + 3) - 0.5) * 0.06;
    v.multiplyScalar(d); p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // 부드러운 법선: 같은 자리 꼭짓점의 면 법선을 평균
  const nrm = g.attributes.normal, acc = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i)) + ',' + key(p.getY(i)) + ',' + key(p.getZ(i));
    const a = acc.get(k) || [0, 0, 0]; a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i); acc.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const a = acc.get(key(p.getX(i)) + ',' + key(p.getY(i)) + ',' + key(p.getZ(i)));
    v.set(a[0], a[1], a[2]).normalize(); nrm.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function scatterGrid(x0, x1, y0, y1, step, jitter, fn) {
  if (!(step > 0.001)) return;
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) fn(x + rnd(-jitter, jitter), y + rnd(-jitter, jitter));
}

// ------------------------------------------------------------------ 1. 시멘트
class CementWall extends WallBase {
  constructor(def, ctx) { super(def, ctx); this.basePlane(S_PAINT, { bump: 0.8 }); }
}

// ------------------------------------------------------------------ 2. 자갈
class GravelWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_GRAVELBASE, { bump: 0.6 });
    const geos = [rockGeo(1, 1), rockGeo(2, 1), rockGeo(3, 1)];   // 작은 돌이라 80면이면 충분
    const mat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), `
      float n = fb(wp * 300.0);
      col *= 0.82 + 0.3 * n; hgt = n; rough = 0.55 + 0.25 * vn(wp * 900.0);
    `, { key: 'pebble', bump: 0.4 });
    const pal = ['#8d8a85', '#a59c8f', '#6f6a64', '#c9c2b6', '#5b5650', '#9a8571', '#b5a58d', '#3f3c39', '#d8d2c6'].map((c) => new THREE.Color(c));
    // 돌 모양 3가지를 고루 섞고, 주먹이 닿는 가운데 돌만 그림자를 드리움(삼각형 절약)
    const buckets = [];
    for (let gi = 0; gi < 3; gi++) for (const cast of [true, false]) buckets.push({ g: geos[gi], cast, list: [] });
    scatterGrid(-0.7, 0.7, -0.64, 0.48, 0.019, 0.006, (x, y) => {
      const cast = Math.abs(x) < 0.36 && y > -0.46 && y < 0.26;
      buckets[Math.floor(Math.random() * 3) * 2 + (cast ? 0 : 1)].list.push([x, y]);
    });
    const dummy = new THREE.Object3D();
    for (const b of buckets) {
      if (!b.list.length) continue;
      const im = new THREE.InstancedMesh(b.g, mat, b.list.length);
      b.list.forEach(([x, y], i) => {
        const s = rnd(0.0055, 0.0115);
        dummy.position.set(x, y, -this.D + s * rnd(0.15, 0.45));
        dummy.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
        dummy.scale.set(s * rnd(0.9, 1.3), s * rnd(0.75, 1.1), s * rnd(0.6, 0.9));
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, pal[Math.floor(Math.random() * pal.length)].clone().multiplyScalar(rnd(0.85, 1.1)));
      });
      im.castShadow = b.cast; im.receiveShadow = true;
      this.add(im);
    }
    this.stopDepth = 0.007;
  }
}

// ------------------------------------------------------------------ 3. 쥐덫
function mousetrapParts() {
  // 바인드: 덫 중심 원점, 받침 판은 xy 평면(벽에 붙음), z+ 가 바깥
  const base = new THREE.BoxGeometry(0.098, 0.044, 0.010, 1, 1, 1);
  base.translate(0, 0, 0.005);
  const wire = 0.0011;
  // U자 때리개(킬바): 회전축(y=0) 기준, 열림 상태에서 위쪽(+y)으로 펼쳐져 있음
  const path = new THREE.CurvePath();
  const w = 0.036, h = 0.040;
  path.add(new THREE.LineCurve3(new THREE.Vector3(-w, 0, 0), new THREE.Vector3(-w, h, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(-w, h, 0), new THREE.Vector3(w, h, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(w, h, 0), new THREE.Vector3(w, 0, 0)));
  const bar = new THREE.TubeGeometry(path, 24, wire, 5, false);
  // 스프링 두 개
  const spring = (x0) => {
    const pts = []; for (let i = 0; i <= 80; i++) { const t = i / 80; const a = t * Math.PI * 2 * 4.5; pts.push(new THREE.Vector3(x0 + (t - 0.5) * 0.016, Math.cos(a) * 0.0045, 0.0062 + Math.sin(a) * 0.0045)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 54, 0.0007, 4, false);
  };
  const plate = new THREE.BoxGeometry(0.016, 0.022, 0.0012); plate.translate(0, -0.010, 0.0110);
  const hold = new THREE.CylinderGeometry(0.0007, 0.0007, 0.038, 5); hold.rotateZ(Math.PI / 2 * 0); hold.translate(0, -0.006, 0.0115);
  return { base, bar, springs: [spring(-0.012), spring(0.012)], plate, hold };
}

class TrapWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_PLYWOOD, { bump: 0.5 });
    const P = this.parts = mousetrapParts();
    const woodMat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), `
      vec3 w0 = srgb(vec3(0.88, 0.72, 0.50)), w1 = srgb(vec3(0.74, 0.56, 0.36));
      float gr = vn(vec3(wp.x * 900.0, wp.y * 60.0, wp.z * 900.0));
      col = mix(w0, w1, gr * 0.6 + vn(wp * 200.0) * 0.3); hgt = gr; rough = 0.7;
      // 윗면 빨간 인쇄(상표 없이 테두리와 글자 줄만)
      if (vLoc.z > 0.0095) {
        vec2 s = vLoc.xy - vec2(0.0, 0.0115);
        float inBox = step(abs(s.x), 0.034) * step(abs(s.y), 0.0072);
        float inner = step(abs(s.x), 0.0322) * step(abs(s.y), 0.0056);
        float rowId = floor((s.y + 0.0045) / 0.003);
        float rows = inner * step(abs(s.y), 0.0045) * step(0.42, fract((s.y + 0.0045) / 0.003)) * step(abs(s.x), 0.027 - mod(rowId, 2.0) * 0.006);
        float dash = step(0.3, fract(s.x / 0.0026 + rowId * 0.37)) * step(0.12, fract(s.x / 0.0105 + rowId * 0.61));
        float ink = max(inBox - inner, rows * dash) * (0.7 + 0.3 * vn(vec3(s * 2600.0, 1.0)));
        col = mix(col, srgb(vec3(0.74, 0.12, 0.09)), ink * 0.88);
      }
    `, { key: 'trapwood', bump: 0.3 });
    const metalMat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.95 }), `
      col *= 0.8 + 0.3 * vn(wp * 800.0); rough = 0.3 + 0.2 * vn(wp * 300.0); metal = 0.95;
    `, { key: 'trapmetal', bump: 0.1 });
    const copperMat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xc58b52, roughness: 0.38, metalness: 0.9 }), `metal = 0.9;`, { key: 'trapcopper', bump: 0.0 });
    this.traps = [];
    const cols = 12, rows = 26; const sx = 0.11, sy = 0.058;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * sx + (r % 2) * sx * 0.5 + rnd(-0.004, 0.004);
      const y = -0.72 + r * sy + rnd(-0.003, 0.003);
      this.traps.push({ x, y, rot: rnd(-0.05, 0.05), open: 1, ang: 0, v: 0, gone: false });
    }
    const n = this.traps.length;
    this.imBase = new THREE.InstancedMesh(P.base, woodMat, n);
    this.imBar = new THREE.InstancedMesh(P.bar, metalMat, n);
    this.imSpr = P.springs.map((g) => new THREE.InstancedMesh(g, metalMat, n));
    this.imPlate = new THREE.InstancedMesh(P.plate, copperMat, n);
    this.imHold = new THREE.InstancedMesh(P.hold, metalMat, n);
    for (const im of [this.imBase, this.imBar, ...this.imSpr, this.imPlate, this.imHold]) { im.castShadow = im === this.imBase || im === this.imBar; im.receiveShadow = true; this.add(im); im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.metalMat = metalMat; this.woodMat = woodMat; this.copperMat = copperMat;
    this._m = new THREE.Object3D();
    for (let i = 0; i < n; i++) this.setTrap(i);
    this.stopDepth = 0.016;
  }
  setTrap(i) {
    const t = this.traps[i], d = this._m;
    const z0 = -this.D;
    const hide = t.gone ? 0.00001 : (t.pop != null ? 0.35 + 0.65 * Math.min(1, t.pop) : 1);
    d.position.set(t.x, t.y, z0); d.rotation.set(0, 0, t.rot); d.scale.setScalar(hide); d.updateMatrix();
    this.imBase.setMatrixAt(i, d.matrix); this.imPlate.setMatrixAt(i, d.matrix); this.imHold.setMatrixAt(i, d.matrix);
    for (const im of this.imSpr) im.setMatrixAt(i, d.matrix);
    // 킬바: 축은 덫 중심, 열린 상태는 위로 젖혀져(바깥쪽 z) 있음
    const ang = t.open > 0.5 ? -Math.PI * 0.92 + t.ang : -t.ang;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    const bar = new THREE.Object3D();
    bar.position.set(0, 0, 0.0115); bar.quaternion.copy(q); bar.updateMatrix();
    const mm = new THREE.Matrix4().multiplyMatrices(d.matrix, bar.matrix);
    this.imBar.setMatrixAt(i, mm);
  }
  flush() { for (const im of [this.imBase, this.imBar, ...this.imSpr, this.imPlate, this.imHold]) im.instanceMatrix.needsUpdate = true; }
  impact(fist, arm, c) {
    const snaps = []; let near = [];
    this.traps.forEach((t, i) => {
      if (t.gone) return;
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d < 0.075) { if (t.open > 0.5) { t.open = 0; t.ang = 0; t.resetT = rnd(2.2, 3.6); snaps.push(i); } near.push([d, i]); }
    });
    this.flush();
    for (const i of snaps) this.setTrap(i);
    this.flush();
    const res = { snaps: snaps.length };
    // 손(또는 고철 덩어리)에 물리는 덫 — 손 앞쪽이 짓이겨진 뒤엔 물 데가 없음
    const who = hitter(arm);
    if (((who === 'hand' && arm.crushZ > 0.09) || who === 'scrap') && arm.traps.length < 4) {
      near.sort((a, b) => a[0] - b[0]);
      const take = Math.min(snaps.length ? (Math.random() < 0.6 ? 1 : 2) : 0, near.length, 4 - arm.traps.length);
      for (let k = 0; k < take; k++) {
        const i = near[k][1]; const t = this.traps[i];
        if (t.gone) continue;
        t.gone = true; t.resetT = rnd(2.5, 4.0); this.setTrap(i);
        this.attachTrap(arm, who);
      }
      this.flush();
    }
    // 매달린 덫은 맞을 때마다 조금씩 부서져 떨어짐
    for (const tr of arm.traps.slice()) {
      tr.hp -= 1;
      if (tr.hp <= 0) { tr.obj.parent && tr.obj.parent.remove(tr.obj); arm.traps.splice(arm.traps.indexOf(tr), 1); this.ctx.fx.dropObject(tr.obj, arm); }
    }
    res.dmgMul = 1 + snaps.length * 0.12;
    return res;
  }
  attachTrap(arm, who = 'hand') {
    const P = this.parts;
    const g = new THREE.Group();
    const base = new THREE.Mesh(P.base, this.woodMat); g.add(base);
    const bar = new THREE.Mesh(P.bar, this.metalMat); bar.position.z = 0.0115; bar.rotation.x = -0.25; g.add(bar);
    for (const s of P.springs) g.add(new THREE.Mesh(s, this.metalMat));
    g.add(new THREE.Mesh(P.plate, this.copperMat));
    g.traverse((o) => { o.castShadow = true; });
    const f = Math.floor(Math.random() * 4);
    if (who === 'scrap' && arm.scrapObj) {
      // 고철 덩어리 아무 데나 물고 매달림
      g.position.set(rnd(-0.02, 0.02), rnd(-0.03, -0.01), rnd(0.02, 0.045));
      g.rotation.set(rnd(0.3, 1.2), rnd(-0.6, 0.6), rnd(-0.5, 0.5));
      g.scale.setScalar(0.92);
      arm.scrapObj.lump.add(g);
    } else {
      // 너클을 문 채 손등 위로 걸쳐 있음 — 손 묶음(바인드 좌표), 카메라에서 보이게
      const A = this.ctx.anat;
      const m = A.MCP[f];
      const n = arm.traps.length;
      g.position.set(m.x * 0.7 + rnd(-0.006, 0.006), m.y + A.MCP_R[f] + 0.004 + n * 0.006, m.z - 0.022 + rnd(-0.008, 0.006));
      g.rotation.set(-Math.PI / 2 + rnd(-0.35, 0.25), 0, rnd(-0.6, 0.6));
      g.rotateX(rnd(-0.15, 0.15));
      g.scale.setScalar(0.9);
      arm.attach.hand.add(g);
    }
    arm.traps.push({ obj: g, hp: 3 + Math.floor(Math.random() * 3), f, swing: 0 });
  }
  update(dt, time, arms) {
    // 튕긴 덫·떨어져 나간 덫 자리는 잠시 뒤 새 덫이 다시 놓임(벽 장치가 금방 바닥나지 않게)
    let dirty = false;
    this.traps.forEach((t, i) => {
      if (t.resetT > 0) { t.resetT -= dt; if (t.resetT <= 0) { t.gone = false; t.open = 1; t.ang = 0; t.pop = 0; } }
      if (t.pop != null) { t.pop += dt * 4; if (t.pop >= 1) t.pop = null; this.setTrap(i); dirty = true; }
    });
    if (dirty) this.flush();
    for (const s of ['L', 'R']) for (const tr of arms[s].traps) {
      tr.swing = (tr.swing || 0) + dt;
      tr.obj.rotation.x += Math.sin(time * 9 + tr.f) * 0.004;
    }
  }
}

// ------------------------------------------------------------------ 4. 소주병 조각
function shardGeo(seed) {
  const r = (k) => { const x = Math.sin(k * 91.7 + seed * 47.3) * 43758.5453; return x - Math.floor(x); };
  // 바닥 삼각형 + 끝이 뾰족한 쐐기
  const pts = [];
  const n = 3 + Math.floor(r(1) * 2);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + r(i + 3) * 0.8; const rr = 0.6 + r(i + 7) * 0.5; pts.push(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr * 0.45, 0)); }
  const tip = new THREE.Vector3((r(11) - 0.5) * 0.6, (r(12) - 0.5) * 0.3, 1.0 + r(13) * 0.9);
  const thick = 0.12 + r(14) * 0.1;
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
  }
  // 두께감: 바닥면
  for (let i = 1; i < n - 1; i++) pos.push(pts[0].x, pts[0].y, -thick, pts[i + 1].x, pts[i + 1].y, -thick, pts[i].x, pts[i].y, -thick);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

class GlassWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_CEMENT.replace('srgb(vec3(0.75, 0.73, 0.69))', 'srgb(vec3(0.66, 0.64, 0.60))'), { bump: 1.0 });
    const mats = {
      green: new THREE.MeshPhysicalMaterial({ color: 0x2f9c55, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.78, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0x0b3518, emissiveIntensity: 0.6 }),
      brown: new THREE.MeshPhysicalMaterial({ color: 0x8a4a12, roughness: 0.05, transparent: true, opacity: 0.8, envMapIntensity: 2.0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x2a1203, emissiveIntensity: 0.5 }),
      clear: new THREE.MeshPhysicalMaterial({ color: 0xdfeee6, roughness: 0.03, transparent: true, opacity: 0.55, envMapIntensity: 2.4, clearcoat: 1, clearcoatRoughness: 0.02 }),
    };
    this.mats = mats;
    const geos = [shardGeo(1), shardGeo(2), shardGeo(3), shardGeo(4)];
    this.geos = geos;
    const dummy = new THREE.Object3D();
    const byKind = { green: [], brown: [], clear: [] };
    scatterGrid(-0.7, 0.7, -0.75, 0.55, 0.026, 0.009, (x, y) => {
      const k = Math.random() < 0.72 ? 'green' : Math.random() < 0.6 ? 'brown' : 'clear';
      byKind[k].push([x, y]);
    });
    for (const [k, list] of Object.entries(byKind)) {
      const per = Math.ceil(list.length / geos.length);
      geos.forEach((g, gi) => {
        const part = list.slice(gi * per, gi * per + per);
        const im = new THREE.InstancedMesh(g, mats[k], part.length);
        part.forEach(([x, y], i) => {
          const s = rnd(0.008, 0.016);
          dummy.position.set(x, y, -this.D - 0.002);
          dummy.rotation.set(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(0, 6.28));
          dummy.scale.set(s, s, s * rnd(0.7, 1.4));
          dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
        });
        im.castShadow = true; im.receiveShadow = false;
        this.add(im);
      });
    }
    this.stopDepth = 0.010;
  }
  impact(fist, arm, c) {
    const who = hitter(arm);
    if (who === 'scrap' || who === 'pipe') { this.ctx.fx.sparks(c, 8, 0xffd28a); return { dmgMul: 1 }; }
    if (who === 'stump') { stumpWound(arm, 2, 1, 0.026); stumpWound(arm, 4, 1, 0.03); return { dmgMul: 1.1 }; }
    if (arm.I < 0.5 && arm.crushZ > 0.09) {
      // 손에 유리 조각이 박힌 채 남음
      const A = this.ctx.anat;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && arm.embedded.length < 14; i++) {
        const f = Math.floor(Math.random() * 4);
        const base = A.MCP[f].clone().add(new THREE.Vector3(rnd(-0.008, 0.008), rnd(0.002, 0.010), rnd(0.002, 0.009)));
        const k = Math.random() < 0.75 ? 'green' : 'brown';
        const m = new THREE.Mesh(this.geos[Math.floor(Math.random() * 4)], this.mats[k]);
        const s = rnd(0.0035, 0.0065);
        m.scale.set(s, s, s * rnd(0.8, 1.3));
        m.position.copy(base);
        // 바깥(위·앞)을 향해 비스듬히 박힘
        m.lookAt(base.clone().add(new THREE.Vector3(rnd(-0.6, 0.6), rnd(0.4, 1.0), rnd(0.2, 1.0))));
        m.castShadow = true;
        arm.attach.hand.add(m);
        arm.embedded.push(m);
        arm.addWound(base, rnd(0.006, 0.009), 2, 1);
      }
      arm.bleed = Math.min(0.012, 0.0016 + arm.embedded.length * 0.0007);
    }
    return { dmgMul: 1 };
  }
}

// ------------------------------------------------------------------ 5. 못
class NailWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_PLANKS, { bump: 0.8 });
    const L = 0.054;
    const shaft = new THREE.CylinderGeometry(0.0016, 0.0016, L * 0.82, 7, 1);
    shaft.translate(0, L * 0.41, 0);
    const tip = new THREE.ConeGeometry(0.0016, L * 0.18, 7, 1); tip.translate(0, L * 0.82 + L * 0.09, 0);
    const g = mergeGeos([shaft, tip]); g.rotateX(Math.PI / 2);   // +Z로 튀어나옴
    this.nailGeo = g; this.L = L;
    const mat = patchSurface(new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.28, metalness: 0.95 }), `
      float rust = smoothstep(0.55, 0.85, fb(wp * 160.0 + 3.0));
      col = mix(col, srgb(vec3(0.45, 0.22, 0.10)), rust * 0.8);
      metal = mix(0.95, 0.3, rust); rough = mix(0.26, 0.85, rust); hgt = rust;
    `, { key: 'nail', bump: 0.2 });
    this.nails = [];
    const dummy = new THREE.Object3D();
    const list = [];
    scatterGrid(-0.66, 0.66, -0.64, 0.48, 0.028, 0.008, (x, y) => list.push([x, y]));
    const im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach(([x, y], i) => {
      dummy.position.set(x, y, -this.D);
      // 뒤에서 박아 넣은 못이라 제각각 비스듬함
      dummy.rotation.set(rnd(-0.22, 0.22), rnd(-0.22, 0.22), 0);
      dummy.scale.set(1, 1, rnd(0.8, 1.15));
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      this.nails.push({ x, y });
    });
    im.castShadow = true; im.receiveShadow = true;
    this.add(im);
    this.stopDepth = 0.013;
    this.fleshMat = new THREE.MeshStandardMaterial({ color: 0x8a1610, roughness: 0.25 });
  }
  impact(fist, arm, c) {
    const who = hitter(arm);
    if (who === 'scrap') return { stick: 'stuck', releaseAfter: 0.24, dmgMul: 1.1 };
    if (who === 'pipe') return { dmgMul: 1 };
    if (who === 'stump') { stumpWound(arm, 4, 1, 0.03); return { stick: 'stuck', releaseAfter: 0.24, dmgMul: 1.1 }; }
    return { stick: 'stuck', releaseAfter: 0.24, dmgMul: 1.1 };
  }
  tug(fist, arm) { if (hitter(arm) !== 'scrap') this.ctx.fx.tearBits(arm, this, 3); }
  release(fist, arm, c) {
    if (hitter(arm) === 'scrap') {
      // 고철 덩어리에서 부품 하나쯤은 못에 걸려 남음
      const so = arm.scrapObj;
      if (so && so.parts.length > 3 && Math.random() < 0.7) { so.parts.sort((a, b) => b.position.z - a.position.z); this.ctx.fx.flyScrapPart(so.parts.shift(), true); so.state.partsLeft = so.parts.length; }
      return;
    }
    // 못에 살점이 걸려 남음
    const near = this.nails.map((n) => [Math.hypot(n.x - c.x, n.y - c.y), n]).filter((a) => a[0] < 0.045).sort((a, b) => a[0] - b[0]).slice(0, 5);
    for (const [, n] of near) this.ctx.fx.stickChunk(new THREE.Vector3(n.x + rnd(-0.002, 0.002), n.y + rnd(-0.002, 0.002), -this.D + rnd(0.015, 0.04)), rnd(0.003, 0.006), 'meat');
    this.ctx.fx.smear(c, 0.05);
  }
}

// ------------------------------------------------------------------ 6. 냉동창고
class FreezerWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_FREEZER, { bump: 0.9, bloodMode: 'frozen' });
    this.stopDepth = 0.004;
    // 찬 김
    this.mist = ctx.fx.makeMist(0xeef6ff, 0.18);
    this.add(this.mist.obj);
  }
  impact(fist, arm, c) {
    const who = hitter(arm);
    if (who === 'scrap' || who === 'pipe') return { stick: 'stuck', releaseAfter: 0.30 };
    return { stick: 'stuck', releaseAfter: 0.30 };
  }
  tug(fist, arm) { this.ctx.fx.frostPuff(arm, 6); }
  release(fist, arm, c) {
    const who = hitter(arm);
    if (who === 'scrap' || who === 'pipe') { this.ctx.fx.frostPuff(arm, 10); return; }
    if (who === 'stump') { stumpWound(arm, 6, 1, 0.03); this.ctx.fx.skinPatch(c); this.ctx.fx.frostPuff(arm, 12); return; }
    // 가죽이 벽에 남음
    if (arm.I < 0.5) {
      const A = this.ctx.anat;
      for (let i = 0; i < 2; i++) {
        const f = Math.floor(Math.random() * 4);
        arm.addWound(A.MCP[f].clone().add(new THREE.Vector3(rnd(-0.006, 0.006), rnd(0.002, 0.010), rnd(0.002, 0.008))), rnd(0.009, 0.014), 6, 1);
      }
      arm._apply();
    }
    this.ctx.fx.skinPatch(c);
    this.ctx.fx.frostPuff(arm, 14);
  }
  update(dt, time) { this.mist.update(dt, time); }
}

// ------------------------------------------------------------------ 7. 달군 철판
class HotPlateWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_HOTPLATE, { bump: 0.5, metal: 0.8, bloodMode: 'burnt' });
    // 테두리 볼트
    const boltG = new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6); boltG.rotateX(Math.PI / 2); boltG.translate(0, 0, 0.003);
    const bm = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.9 });
    const pts = [];
    for (let x = -0.62; x <= 0.62; x += 0.155) { pts.push([x, 0.42], [x, -0.70]); }
    for (let y = -0.55; y <= 0.3; y += 0.155) { pts.push([-0.62, y], [0.62, y]); }
    const im = new THREE.InstancedMesh(boltG, bm, pts.length); const d = new THREE.Object3D();
    pts.forEach(([x, y], i) => { d.position.set(x, y, -this.D); d.rotation.set(0, 0, rnd(0, 1)); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.castShadow = true; this.add(im);
    // 열기 조명
    const L = this.takeLight(0xff6a20, 0.6, 0.9, 1.6);
    L.position.set(0, -0.04, -this.D + 0.06);
    this.heatLight = L;
    this.smoke = ctx.fx.makeSmoke(0xeadccd, 0.0);
    this.add(this.smoke.obj);
    this.stopDepth = 0.0;
  }
  impact(fist, arm, c) {
    const who = hitter(arm);
    this.ctx.fx.smokeBurst(c, 1.0);
    this.smoke.boost(1.2);
    if (who === 'scrap' || who === 'pipe') {
      if (arm.scrapObj) arm.scrapObj.heat = Math.min(1, (arm.scrapObj.heat || 0) + 0.3);
      stumpWound(arm, 5, Math.min(1, 0.3 + (arm.scrapObj ? arm.scrapObj.heat : 0.5) * 0.7), 0.032);
    }
    if (who === 'stump') stumpWound(arm, 5, 0.9, 0.03);
    return { flinch: 0.28, dmgMul: 1 };
  }
  update(dt, time) {
    this.heatLight.intensity = 0.55 + Math.sin(time * 7) * 0.04 + Math.sin(time * 17.3) * 0.03;
    this.smoke.update(dt, time);
  }
}

// ------------------------------------------------------------------ 8. 전기
class ElectricWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_BACKCON, { bump: 0.6, z: -0.03 });
    // 마름모 철망 (알파 패턴)
    const gm = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.38, metalness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
    patchSurface(gm, `
      vec2 q = vec2(p.x + p.y, p.x - p.y) / 0.042;
      vec2 fq = abs(fract(q) - 0.5);
      float wire = 1.0 - smoothstep(0.035, 0.07, min(fq.x, fq.y));
      if (wire < 0.5) discard;
      col *= 0.8 + 0.3 * vn(vec3(p * 300.0, 1.0)); hgt = wire; metal = 0.9; rough = 0.35;
    `, { key: 'mesh', bump: 0.2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), gm);
    mesh.position.set(0, -0.1, -this.D + 0.012);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.add(mesh);
    // 애자·전선
    const insG = new THREE.CylinderGeometry(0.012, 0.016, 0.03, 12); insG.rotateX(Math.PI / 2); insG.translate(0, 0, 0.012);
    const insM = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.15, metalness: 0 });
    const ins = [];
    for (let x = -0.6; x <= 0.6; x += 0.3) for (const y of [0.38, -0.66]) ins.push([x, y]);
    const imI = new THREE.InstancedMesh(insG, insM, ins.length); const d = new THREE.Object3D();
    ins.forEach(([x, y], i) => { d.position.set(x, y, -this.D - 0.02); d.updateMatrix(); imI.setMatrixAt(i, d.matrix); });
    imI.castShadow = true; this.add(imI);
    for (const y of [0.38, -0.66]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.5 }));
      w.rotation.z = Math.PI / 2; w.position.set(0, y, -this.D + 0.014); this.add(w);
    }
    // 경고판: 노란 삼각형 + 번개
    const sign = makeHVSign(); sign.position.set(-0.17, 0.2, -this.D + 0.016); this.add(sign);
    this.arcs = ctx.fx.makeArcs(); this.add(this.arcs.obj);
    this.flash = this.takeLight(0x9fd0ff, 0, 1.2, 1.4);
    this.flash.position.set(0, 0, -this.D + 0.1);
    this.hum = 0;
    this.stopDepth = 0.014;
  }
  impact(fist, arm, c) {
    this.arcs.burst(c, 6, this.D);
    this.flash.position.set(c.x, c.y, c.z + 0.06);
    this.flash.intensity = 6;
    this.ctx.fx.sparks(c, 26, 0x9fd8ff);
    const who = hitter(arm);
    if (who !== 'hand') stumpWound(arm, 8, 0.85, 0.034);
    return { spasm: fist.autoPunch ? 0 : 2 + Math.floor(Math.random() * 2), dmgMul: 1 };
  }
  update(dt, time) {
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 30);
    if (Math.random() < dt * 0.9) this.arcs.idle(this.D);
    this.arcs.update(dt);
  }
}

function makeHVSign() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 230;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#f5c518'; x.strokeStyle = '#141414'; x.lineWidth = 14; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(128, 14); x.lineTo(244, 214); x.lineTo(12, 214); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#141414';
  x.beginPath(); x.moveTo(140, 62); x.lineTo(98, 140); x.lineTo(128, 140); x.lineTo(110, 196); x.lineTo(160, 116); x.lineTo(130, 116); x.lineTo(150, 62); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.099), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, transparent: true }));
  return m;
}

// ------------------------------------------------------------------ 9. 쇠꼬챙이
class SpikeWall extends WallBase {
  constructor(def, ctx) {
    super(def, ctx);
    this.basePlane(S_STONE, { bump: 1.1 });
    const L = 0.27;
    const g = new THREE.ConeGeometry(0.0075, L, 10, 6, false);
    // 원뿔을 살짝 덜 뾰족하게 + 뿌리 굵게
    const pa = g.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i); const t = (v.y + L / 2) / L; // 0 뿌리 → 1 끝
      const s = Math.pow(1 - t, 0.75) / Math.max(1e-4, 1 - t);
      v.x *= isFinite(s) ? Math.min(s, 3) : 1; v.z *= isFinite(s) ? Math.min(s, 3) : 1;
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.translate(0, L / 2, 0); g.rotateX(Math.PI / 2);
    const mat = patchSurface(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.7, metalness: 0.7 }), `
      float rust = fb(wp * 90.0);
      col = mix(srgb(vec3(0.40, 0.24, 0.14)), srgb(vec3(0.20, 0.17, 0.16)), smoothstep(0.35, 0.7, rust));
      col *= 0.8 + 0.35 * vn(wp * 600.0);
      metal = mix(0.25, 0.8, smoothstep(0.5, 0.8, rust)); rough = mix(0.9, 0.5, smoothstep(0.5, 0.8, rust)); hgt = rust;
    `, { key: 'spike', bump: 0.4 });
    this.spikes = [];
    const list = [];
    // 기존보다 가로·세로 간격을 각각 절반으로 줄인 촘촘한 엇갈림 격자
    const spacing = 0.0475;
    for (let row = 0, y = -0.72; y <= 0.46; y += spacing, row++) {
      for (let x = -0.62; x <= 0.62; x += spacing) {
        list.push([x + (row % 2) * spacing * 0.5, y]);
      }
    }
    const im = new THREE.InstancedMesh(g, mat, list.length); const d = new THREE.Object3D();
    list.forEach(([x, y], i) => { d.position.set(x, y, -this.D); d.rotation.set(rnd(-0.03, 0.03), rnd(-0.03, 0.03), 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); this.spikes.push({ x, y }); });
    im.castShadow = true; im.receiveShadow = true;
    this.add(im);
    this.L = L;
    this.stopDepth = 0.13;
    this.addOldFist();
  }
  // 먼저 다녀간 사람의 고철 주먹: 꼬챙이에 꿰인 채 버려져 녹슬어 있음
  addOldFist() {
    const holder = { attach: { forearm: new THREE.Group() }, cutZ: -0.03, traps: [] };
    const sc = new Scrap(holder, 4243);
    if (sc.glow) sc.glow.parent && sc.glow.parent.remove(sc.glow);
    const g = holder.attach.forearm;
    const rustSurf = `
      float r1 = fb(wp * 140.0); float r2 = vn(wp * 900.0); float r3 = fb(wp * 37.0 + 5.0);
      col = mix(srgb(vec3(0.38, 0.21, 0.11)), srgb(vec3(0.19, 0.13, 0.10)), smoothstep(0.35, 0.75, r1));
      col = mix(col, srgb(vec3(0.55, 0.31, 0.14)), smoothstep(0.72, 0.9, r2) * 0.55);
      col *= TINT;
      metal = 0.35 * smoothstep(0.62, 0.9, r1 * r3 * 1.6); rough = 0.88 - 0.22 * smoothstep(0.62, 0.9, r1);
      hgt = r1 * 0.6 + r2 * 0.35;
    `;
    const rustA = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.3 }), rustSurf.replace('TINT', 'vec3(1.0)'), { key: 'oldrustA', bump: 0.5 });
    const rustB = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.3 }), rustSurf.replace('TINT', 'vec3(0.78, 0.74, 0.72)'), { key: 'oldrustB', bump: 0.5 });
    const tape = patchSurface(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05 }), `
      col = srgb(vec3(0.46, 0.42, 0.36)) * (0.75 + 0.35 * fb(wp * 220.0)); rough = 0.95; metal = 0.02; hgt = vn(wp * 700.0) * 0.4;
    `, { key: 'oldtape', bump: 0.3 });
    let k = 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.side === THREE.BackSide) return;   // 쇠파이프 안쪽
      const isTape = m.metalness < 0.5 && m.roughness > 0.55 && m.roughness < 0.7;
      o.material = isTape ? tape : (k++ % 3 === 0 ? rustB : rustA);
      o.castShadow = true; o.receiveShadow = true;
    });
    // 주먹 앞(+z)이 벽을 향하게 뒤집고, 바깥으로 나온 쇠파이프 쪽이 아래로 처짐. 덩어리 가운데로 꼬챙이가 지나감
    const P = OLD_FIST_AT;
    g.rotation.set(0.3, Math.PI + 0.12, 0.35);
    g.position.set(P.x + 0.008, P.y - 0.013, -this.D + 0.164);
    g.updateMatrixWorld(true);
    this.add(g);
    this.oldFist = g;
  }
  // 타격 지점을 가장 가까운 꼬챙이에 맞춤
  snapContact(c) {
    let best = null, bd = 1e9;
    for (const s of this.spikes) { const d = Math.hypot(s.x - c.x, s.y - c.y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  impact(fist, arm, c) {
    const who = hitter(arm);
    if (who === 'scrap' || who === 'pipe') { this.ctx.fx.sparks(c, 14, 0xffd28a); return { stick: 'pinned', pin: 1.4, dmgMul: 1.1 }; }
    if (who === 'stump') { stumpWound(arm, 3, 1, 0.03); stumpWound(arm, 4, 1, 0.03); }
    // 꿰인 자리: 입구는 너클, 출구는 팔뚝 등쪽
    if (arm.I < 0.5) {
      const A = this.ctx.anat;
      arm.addWound(A.MCP[1].clone().add(new THREE.Vector3(0.004, 0.006, 0.006)), 0.011, 3, 1, 0.9);
      arm.addWound(new THREE.Vector3(rnd(-0.008, 0.008), 0.02, rnd(-0.06, -0.03)), 0.009, 3, 1, 0.9);
      arm.addWound(new THREE.Vector3(rnd(-0.008, 0.008), 0.02, rnd(-0.06, -0.03)), 0.02, 0, 1);
      arm._apply();
    }
    return { stick: 'pinned', pin: 2.2, dmgMul: 1.15 };
  }
  tug(fist, arm) { if (hitter(arm) !== 'scrap') this.ctx.fx.tearBits(arm, this, 2); }
  release(fist, arm, c) {
    if (hitter(arm) === 'scrap') return;
    this.ctx.fx.stickChunk(new THREE.Vector3(c.x + rnd(-0.004, 0.004), c.y + rnd(-0.004, 0.004), -this.D + rnd(0.05, 0.16)), rnd(0.006, 0.01), 'meat');
    this.ctx.fx.stickChunk(new THREE.Vector3(c.x, c.y, -this.D + rnd(0.02, 0.2)), rnd(0.004, 0.007), 'meat');
  }
}

// ------------------------------------------------------------------ 유틸
function mergeGeos(gs) {
  let pos = [], nrm = [], idx = [], off = 0;
  for (const g0 of gs) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
export { mergeGeos, rockGeo };

const CLASSES = { cement: CementWall, gravel: GravelWall, glass: GlassWall, nails: NailWall, freezer: FreezerWall, hotplate: HotPlateWall, electric: ElectricWall, spikes: SpikeWall };

export function createWall(id, ctx) {
  const def = WALLS.find((w) => w.id === id) || WALLS[0];
  const C = CLASSES[def.id];
  return new C(def, ctx);
}
