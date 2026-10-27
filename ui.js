// 철권 — 화면(제목·HUD·결과·가게)
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const SWATCH = {
  cement: 'linear-gradient(135deg,#c9c5bd,#a9a59d)',
  gravel: 'radial-gradient(circle at 30% 30%,#d6d0c4 0 18%,transparent 19%),radial-gradient(circle at 70% 60%,#7d776f 0 16%,transparent 17%),radial-gradient(circle at 40% 80%,#a8a093 0 14%,transparent 15%),#8f8a82',
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
      if (this.A.canStart()) this.A.start();
      else { this.deny(); this.renderShop(); }
    });
    this.syncSound();
    $('#ctrlHint').textContent = touch ? '화면 좌·우: 짧게 타격 · 길게 눌렀다 떼면 모아치기' : 'F · J / 마우스 좌·우: 짧게 타격 · 길게 눌렀다 떼면 모아치기';
  }
  syncSound() { this.el.sound.classList.toggle('off', this.A.isMuted()); }
  ready() {
    const fresh = !this.hadSave || (this.G.stats.rounds === 0 && this.G.credits === 0);
    $('#btnStart').textContent = fresh ? '시작' : '이어하기';
    $('#btnNew').style.display = fresh ? 'none' : '';
    this.el.title.inert = false;
    this.el.title.setAttribute('aria-hidden', 'false');
    this.el.title.classList.add('show');
    this.hud(false);
    this.credits(this.G.credits, 0);
  }
  hidePanels() {
    this.el.title.classList.remove('show');
    this.el.title.inert = true;
    this.el.title.setAttribute('aria-hidden', 'true');
    this.el.shop.classList.remove('show');
    this.el.shop.inert = true;
    this.el.shop.setAttribute('aria-hidden', 'true');
    clearTimeout(this._ht);
    this.el.hint.classList.remove('show', 'top');
  }
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
      controls: touch ? '짧게 누르면 타격 · 길게 눌렀다 떼면 모아치기' : 'F · J를 짧게 누르면 타격 · 길게 눌렀다 떼면 모아치기',
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
    clearTimeout(this._ht);
    this.el.hint.classList.remove('show', 'top');
    $('#wallPicker').open = false;
    this.renderShop();
    s.inert = false;
    s.setAttribute('aria-hidden', 'false');
    s.classList.add('show');
    $('.shopBody').scrollTop = 0;
  }
  renderShop() {
    const G = this.G, A = this.A;
    $('#sCredits').textContent = fmt(G.credits);
    // 장착은 팔별로 직접 선택한다. 다음 판 버튼에서는 구매하지 않는다.
    const arms = $('#sArms'); arms.innerHTML = '';
    for (const side of ['L', 'R']) {
      const info = A.armInfo(side), label = side === 'L' ? '왼팔' : '오른팔';
      const card = document.createElement('div');
      card.className = 'arm' + (info.fist ? ' ready' : '');
      card.dataset.side = side;
      const state = info.scrap ? '철권 장착됨' : info.fist ? (info.I < 0.02 ? '맨손' : '다친 맨손') : '철권 없음';
      const rp = A.restorePrice(), sp = A.scrapPrice(side);
      const healthy = info.flesh && info.I < 0.02;
      const primary = info.fist ? '<div class="armReady">사용 가능</div>' :
        `<button class="btn sub" data-act="scrap" ${G.credits < sp ? 'disabled' : ''}><span>${label}에 철권 장착</span><em>${fmt(sp)} 크레딧</em></button>`;
      card.innerHTML = `<div class="armHead"><b>${label}</b><span class="armState">${state}</span></div>
        <div class="armBtns">${primary}
          ${healthy ? '' : `<button class="btn sub restore" data-act="restore" ${G.credits < rp ? 'disabled' : ''}><span>${label} 회복</span><em>${fmt(rp)} 크레딧</em></button>`}
        </div>${!info.fist && G.credits < sp ? `<p class="armCostNote">${fmt(sp - G.credits)} 크레딧 부족</p>` : ''}`;
      card.querySelector('[data-act=scrap]')?.addEventListener('click', () => {
        if (!A.scrap(side)) this.deny();
        this.renderShop();
      });
      card.querySelector('[data-act=restore]')?.addEventListener('click', () => {
        if (!A.restore(side)) this.deny();
        this.renderShop();
      });
      arms.appendChild(card);
    }
    // 벽은 현재 선택만 먼저 보여 주고, 목록은 필요할 때 펼친다.
    const selected = this.WALLS.find((w) => w.id === G.wall);
    $('#sWallName').textContent = selected ? selected.name : '';
    $('#sWallMult').textContent = selected ? '수입 ×' + selected.mult : '';
    const reserve = A.canStart() ? 0 : Math.min(A.scrapPrice('L'), A.scrapPrice('R'));
    const list = $('#sWalls'); list.innerHTML = '';
    for (const w of this.WALLS) {
      const owned = G.owned.includes(w.id), cur = G.wall === w.id;
      const poor = !owned && G.credits < w.price;
      const needsArm = !owned && !poor && G.credits - w.price < reserve;
      const row = document.createElement('button');
      row.className = 'wall' + (cur ? ' cur' : '') + (owned ? ' owned' : '') + (poor || needsArm ? ' poor' : '');
      row.disabled = cur || poor || needsArm;
      row.innerHTML = `<span class="sw" style="background:${SWATCH[w.id]}"></span>
        <span class="wt"><b>${w.name}</b><small>${w.desc}</small></span>
        <span class="wp">${cur ? '<i>선택됨</i>' : owned ? '<i class="o">선택</i>' : '<em>구매 ' + fmt(w.price) + '</em>'}<small>수입 ×${w.mult}</small>${needsArm || poor ? '<small>' + (needsArm ? '철권 비용 필요' : '크레딧 부족') + '</small>' : ''}</span>`;
      row.addEventListener('click', () => {
        if (cur) return;
        if (owned) A.selectWall(w.id);
        else { const r = A.buyWall(w.id); if (r === 'need') { this.toast('철권 장착 비용은 남겨 둬야 합니다'); this.deny(); return; } if (!r) { this.deny(); return; } }
        this.renderShop();
      });
      list.appendChild(row);
    }
    const left = A.armInfo('L').fist, right = A.armInfo('R').fist;
    const btn = $('#btnNext');
    btn.disabled = !A.canStart();
    btn.textContent = left && right ? '양팔로 다음 판' : left ? '왼팔로 다음 판' : right ? '오른팔로 다음 판' : '철권을 장착하세요';
    $('#nextNote').textContent = left && right ? '' : left || right ? '다른 쪽도 장착하거나, 한쪽만으로 시작하세요.' : '한쪽만 장착해도 시작할 수 있습니다.';
  }
  deny() { const c = $('#sCredits'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  toast(t) { const h = this.el.hint; h.textContent = t; h.classList.add('show', 'top'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show', 'top'), 2400); }
}

