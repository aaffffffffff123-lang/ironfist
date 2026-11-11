// Loaded once; mirrored per arm, with impact motion handled by the panel CSS.
export function fistDent(side) {
  return `<span class="fistDent" role="img" aria-label="${side === 'L' ? '왼팔' : '오른팔'} 철권 장착됨"><img class="dentMetal" src="./fist-dent.webp?v=1" alt="" width="384" height="384" draggable="false"></span>`;
}
