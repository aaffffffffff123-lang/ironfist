// 철권 — 화면(제목·HUD·결과·가게)
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const SWATCH = {
  cement: 'linear-gradient(135deg,#c9c5bd,#a9a59d)',
  gravel: 'radial-gradient(circle at 30% 30%,#d6d0c4 0 18%,transparent 19%),radial-gradient(circle at 70% 60%,#7d776f 0 16%,transparent 17%),radial-gradient(circle at 40% 80%,#a8a093 0 14%,transparent 15%),#8f8a82',
  traps: 'linear-gradient(90deg,#d9b483 0 70%,#b9b9bb 70% 74%,#d9b483 74%)',
  glass: 'linear-gradient(135deg,#2f9c55 0 30%,#9a9890 30% 45%,#7b3f12 45% 60%,#9a9890 60%)',
  nails: 'repeating-linear-gradient(90deg,#a98a66 0 6px,#8b6c4b 6px 7px),#a98a66',
  freezer: 'linear-gradient(90deg,#eef3f7 0 45%,#dfe7ee 45% 50%,#eef3f7 50%)',
  hotplate: 'radial-gradient(circle,#ffb347 0 15%,#ff5a1f 35%,#5a5a5c 70%)',
  slime: 'radial-gradient(circle at 35% 35%,#d8ff9c,#7fcf2f 60%,#5aa61d)',
  electric: 'repeating-linear-gradient(45deg,#9aa3ab 0 2px,transparent 2px 9px),repeating-linear-gradient(-45deg,#9aa3ab 0 2px,#d7dade 2px 9px)',
  spikes: 'radial-gradient(circle at 50% 50%,#5b4636 0 22%,transparent 23%),#9c948a',
};

export class UI {
  constructor({ G, WALLS, hadSave, actions }) {
    this.G = G; this.WALLS = WALLS; this.A = actions; this.hadSave = hadSave;
    this.el = {
      title: $('#title'), hud: $('#hud'), credits: $('#credits'), plus: $('#plus'), wallName: $('#wallName'),
      hint: $('#hint'), shop: $('#shop'), sound: $('#sound'),
    };
    this.bind();
  }
  bind() {
    $('#btnStart').addEventListener('click', () => this.A.start());
    $('#btnNew').addEventListener('click', () => { if (confirm('처음부터 다시 할까요? 크레딧과 벽이 모두 사라집니다.')) this.A.newGame(); });
    this.el.sound.addEventListener('click', (e) => { e.stopPropagation(); const on = this.A.isMuted(); this.A.toggleSound(on); this.syncSound(); });
    $('#btnNext').addEventListener('click', () => {
      // 주먹이 하나도 없으면 고철부터 달고 시작
      if (!this.A.canStart()) for (const s of ['L', 'R']) if (!this.A.armInfo(s).fist) this.A.scrap(s);
      if (this.A.canStart()) { this.hidePanels(); this.A.start(); } else { this.deny(); this.renderShop(); }
    });
    this.syncSound();
    $('#ctrlHint').textContent = touch ? '화면 왼쪽을 누르면 왼주먹, 오른쪽을 누르면 오른주먹' : 'F · J 키, 또는 마우스 왼쪽 · 오른쪽 클릭';
  }
  syncSound() { this.el.sound.classList.toggle('off', this.A.isMuted()); }
  ready() {
    const fresh = !this.hadSave || (this.G.stats.rounds === 0 && this.G.credits === 0);
    $('#btnStart').textContent = fresh ? '시작' : '이어하기';
    $('#btnNew').style.display = fresh ? 'none' : '';
    this.el.title.classList.add('show');
    this.hud(false);
    this.credits(this.G.credits, 0);
  }
  hidePanels() { this.el.title.classList.remove('show'); this.el.shop.classList.remove('show'); }
  hud(on) {
    this.el.hud.classList.toggle('show', on);
    const w = this.WALLS.find((x) => x.id === this.G.wall);
    this.el.wallName.textContent = w ? w.name : '';
  }
  credits(total, add, bonus) {
    this.el.credits.textContent = fmt(total);
    if (add > 0) {
      const p = document.createElement('span');
      p.className = 'pop' + (bonus ? ' bonus' : '');
      p.textContent = '+' + fmt(add);
      this.el.plus.appendChild(p);
      while (this.el.plus.children.length > 4) this.el.plus.firstChild.remove();
      setTimeout(() => p.remove(), 900);
      this.el.credits.classList.remove('bump'); void this.el.credits.offsetWidth; this.el.credits.classList.add('bump');
    }
  }
  hint(id) {
    const txt = {
      controls: touch ? '화면 왼쪽·오른쪽을 눌러 주먹을 내지르세요' : 'F · J 키나 마우스 왼쪽·오른쪽 클릭으로 주먹을 내지르세요',
      stuck: '손이 박혔습니다. 같은 쪽을 연달아 눌러 빼세요',
      pinned: '팔이 꿰였습니다. 같은 쪽을 눌러 버둥거리면 빨리 빠집니다',
    }[id];
    if (!txt) return;
    const h = this.el.hint;
    h.textContent = txt; h.classList.add('show');
    clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show'), 3800);
  }
  // ------------------------------------------------ 결과 + 가게
  showShop(round) {
    this.hud(false);
    const s = this.el.shop;
    $('#rEarned').textContent = '+' + fmt(round.earned);
    const stats = [
      ['부러진 뼈', round.fract], ['빠진 손톱', round.nail], ['떨어진 손가락', round.finger], ['떨어진 손', round.hand],
      ['떨어진 고철 부품', round.scrapParts], ['태권도', round.tkd],
    ].filter(([, v]) => v > 0);
    $('#rStats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${fmt(v)}</b><span>${k}</span></div>`).join('') || '<div class="stat"><b>0</b><span>남긴 상처</span></div>';
    this.renderShop();
    s.classList.add('show');
    s.scrollTop = 0;
  }
  renderShop() {
    const G = this.G, A = this.A;
    $('#sCredits').textContent = fmt(G.credits);
    // 팔
    const arms = $('#sArms'); arms.innerHTML = '';
    for (const side of ['L', 'R']) {
      const info = A.armInfo(side);
      const card = document.createElement('div'); card.className = 'arm';
      let state;
      if (info.fist && info.flesh) state = info.I < 0.02 ? '멀쩡함' : '다친 손';
      else if (info.scrap) state = '고철 손';
      else if (info.I < 0.999) state = `손 없음 · 팔뚝 ${Math.round((1 - (info.I - 0.5) / 0.5) * 100)}% 남음`;
      else state = '팔꿈치까지 없음';
      const rp = A.restorePrice(), sp = A.scrapPrice(side);
      card.innerHTML = `<div class="armHead"><b>${side === 'L' ? '왼팔' : '오른팔'}</b><span class="armState">${state}</span></div>
        <div class="armBtns">
          <button class="btn sub" data-act="scrap" ${info.fist ? 'disabled' : ''}>고철 달기 <em>${fmt(sp)}</em></button>
          <button class="btn sub" data-act="restore" ${info.flesh && info.I < 0.02 ? 'disabled' : ''}>손 회복 <em>${fmt(rp)}</em></button>
        </div>`;
      card.querySelector('[data-act=scrap]').addEventListener('click', () => { if (!A.scrap(side)) this.deny(); this.renderShop(); });
      card.querySelector('[data-act=restore]').addEventListener('click', () => { if (!A.restore(side)) this.deny(); this.renderShop(); });
      arms.appendChild(card);
    }
    // 벽
    const list = $('#sWalls'); list.innerHTML = '';
    for (const w of this.WALLS) {
      const owned = G.owned.includes(w.id), cur = G.wall === w.id;
      const row = document.createElement('button');
      row.className = 'wall' + (cur ? ' cur' : '') + (owned ? ' owned' : '') + (!owned && G.credits < w.price ? ' poor' : '');
      row.innerHTML = `<span class="sw" style="background:${SWATCH[w.id]}"></span>
        <span class="wt"><b>${w.name}</b><small>${w.desc}</small></span>
        <span class="wp">${cur ? '<i>사용 중</i>' : owned ? '<i class="o">바꾸기</i>' : '<em>' + fmt(w.price) + '</em>'}<small>크레딧 ×${w.mult}</small></span>`;
      row.addEventListener('click', () => {
        if (cur) return;
        if (owned) A.selectWall(w.id);
        else { const r = A.buyWall(w.id); if (r === 'need') { this.toast('고철 달 크레딧은 남겨 둬야 합니다'); this.deny(); return; } if (!r) { this.deny(); return; } }
        this.renderShop();
      });
      list.appendChild(row);
    }
    const can = A.canStart();
    const btn = $('#btnNext');
    if (can) { btn.disabled = false; btn.textContent = '다음 판'; $('#nextNote').textContent = ''; }
    else {
      const need = ['L', 'R'].filter((s) => !A.armInfo(s).fist).map((s) => A.scrapPrice(s));
      const all = need.reduce((x, y) => x + y, 0), one = Math.min(...need);
      if (G.credits >= one) { btn.disabled = false; btn.innerHTML = `고철 달고 다음 판 <em class="np">${fmt(G.credits >= all ? all : one)}</em>`; $('#nextNote').textContent = ''; }
      else { btn.disabled = true; btn.textContent = '다음 판'; $('#nextNote').textContent = '크레딧이 모자랍니다.'; }
    }
  }
  deny() { const c = $('#sCredits'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  toast(t) { const h = this.el.hint; h.textContent = t; h.classList.add('show', 'top'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show', 'top'), 2400); }
}
