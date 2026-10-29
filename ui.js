// 철권 — 화면(제목·HUD·결과·다음 판 준비)
import { SKILL_OF } from './skills.js';
const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// 막대 길이. jump면 움직이는 모습 없이 바로
function setBar(el, k, jump) {
  if (jump) { el.style.transition = 'none'; el.style.width = (k * 100).toFixed(2) + '%'; void el.offsetWidth; el.style.transition = ''; }
  else el.style.width = (k * 100).toFixed(2) + '%';
}

const SWATCH = {
  cement: 'linear-gradient(180deg,#efe7d2 0 58%,#2c5a43 58% 64%,#4a8a68 64%)',
  gravel: 'radial-gradient(circle at 30% 30%,#d6d0c4 0 18%,transparent 19%),radial-gradient(circle at 70% 60%,#7d776f 0 16%,transparent 17%),radial-gradient(circle at 40% 80%,#a8a093 0 14%,transparent 15%),#8f8a82',
  glass: 'linear-gradient(135deg,#2f9c55 0 30%,#9a9890 30% 45%,#7b3f12 45% 60%,#9a9890 60%)',
  nails: 'repeating-linear-gradient(90deg,#a98a66 0 6px,#8b6c4b 6px 7px),#a98a66',
  freezer: 'linear-gradient(90deg,#eef3f7 0 45%,#dfe7ee 45% 50%,#eef3f7 50%)',
  hotplate: 'radial-gradient(circle,#ffb347 0 15%,#ff5a1f 35%,#5a5a5c 70%)',
  electric: 'repeating-linear-gradient(45deg,#9aa3ab 0 2px,transparent 2px 9px),repeating-linear-gradient(-45deg,#9aa3ab 0 2px,#d7dade 2px 9px)',
  spikes: 'radial-gradient(circle at 50% 50%,#5b4636 0 22%,transparent 23%),#9c948a',
};

export class UI {
  constructor({ G, WALLS, hadSave, actions }) {
    this.G = G; this.WALLS = WALLS; this.A = actions; this.hadSave = hadSave;
    this.el = {
      title: $('#title'), hud: $('#hud'), endure: $('#endureBox'), fill: $('#endureFill'), wallName: $('#wallName'),
      hint: $('#hint'), shop: $('#shop'), sound: $('#sound'),
    };
    this._fillK = -1;
    this.bind();
  }
  bind() {
    $('#btnStart').addEventListener('click', () => this.A.start());
    $('#btnNew').addEventListener('click', () => { if (confirm('처음부터 다시 할까요? 쌓은 참을성과 열린 벽이 모두 사라집니다.')) this.A.newGame(); });
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
    const fresh = !this.hadSave || (this.G.stats.rounds === 0 && !(this.G.endure > 0));
    $('#btnStart').textContent = fresh ? '시작' : '이어하기';
    $('#btnNew').style.display = fresh ? 'none' : '';
    this.el.title.inert = false;
    this.el.title.setAttribute('aria-hidden', 'false');
    this.el.title.classList.add('show');
    this.hud(false);
    this.endure(this.A.goal());
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
  // 참을성 막대(판 중 오른쪽 위). 피가 새는 동안처럼 자주 불려도 화면은 한 프레임에 한 번만 고침
  endure(g, bonus) {
    if (!g) return;
    const k = Math.max(0, Math.min(1, (g.endure - g.from) / Math.max(1, g.to - g.from)));
    this._g = g;
    if (bonus) { const b = this.el.endure; b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const gg = this._g, kk = Math.max(0, Math.min(1, (gg.endure - gg.from) / Math.max(1, gg.to - gg.from)));
      // 목표가 바뀌면(새 벽·새 손) 막대가 거꾸로 줄어드는 게 보이지 않게 바로 그 자리에서 시작
      const key = gg.kind + ':' + gg.from;
      if (key !== this._hudKey) { this._hudKey = key; setBar(this.el.fill, kk, true); this._fillK = kk; }
      else if (Math.abs(kk - this._fillK) > 0.0015) { setBar(this.el.fill, kk, false); this._fillK = kk; }
      this.el.endure.classList.toggle('full', kk >= 1);
      this.el.endure.setAttribute('aria-valuenow', String(Math.round(kk * 100)));
    });
    return k;
  }
  goalFull(g) {
    this.say(g.kind === 'wall' ? '참을성을 길렀습니다. 이 판이 끝나면 다음 벽이 열립니다' : '참을성을 길렀습니다. 이 판이 끝나면 양손이 새로 생깁니다', 4200);
  }
  hint(id) {
    const txt = {
      controls: touch ? '짧게 누르면 타격 · 길게 눌렀다 떼면 모아치기' : 'F · J를 짧게 누르면 타격 · 길게 눌렀다 떼면 모아치기',
      stuck: '잠깐 붙었다가 저절로 떨어집니다',
      pinned: '팔이 꿰였습니다. 같은 쪽을 연달아 눌러 빼세요',
    }[id];
    if (!txt) return;
    this.say(txt);
  }
  // 아래쪽에 한 줄 안내
  say(txt, ms = 3800) {
    const h = this.el.hint;
    h.classList.remove('top');
    h.textContent = txt; h.classList.add('show');
    clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show'), ms);
  }
  // ------------------------------------------------ 결과 + 다음 판 준비
  showShop(round) {
    this.hud(false);
    const s = this.el.shop;
    $('#rEarned').textContent = '+' + fmt(round.endured || 0);
    // 이어하기로 바로 준비 화면에 왔으면(친 판이 없으면) 이번 판 줄은 숨김
    $('.res').hidden = !(round.endured > 0 || round.punches > 0);
    // 이번 판으로 벽이 열렸거나 새 손이 생겼으면 맨 위에 알림
    const op = $('#opened');
    const w = round.opened ? this.WALLS.find((x) => x.id === round.opened) : null;
    if (w) {
      $('#openedSw').style.background = SWATCH[w.id];
      $('#openedSw').style.display = '';
      $('#openedTitle').textContent = '새 벽이 열렸습니다';
      $('#openedName').textContent = w.name;
      $('#openedNote').textContent = `양손이 새로 생겼습니다 · 모아치기: ${SKILL_OF[w.id]?.name || ''}`;
      op.hidden = false;
    } else if (round.fresh) {
      $('#openedSw').style.display = 'none';
      $('#openedTitle').textContent = '양손이 새로 생겼습니다';
      $('#openedName').textContent = '';
      $('#openedNote').textContent = '참을성이 다시 쌓이면 또 새 손이 생깁니다';
      op.hidden = false;
    } else op.hidden = true;
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
    // 다음 목표까지 막대
    const g = A.goal();
    const k = Math.max(0, Math.min(1, (g.endure - g.from) / Math.max(1, g.to - g.from)));
    $('#goalLabel').textContent = g.kind === 'wall' ? '다음 벽' : '새 손까지';
    $('#goalName').textContent = g.kind === 'wall' ? g.wall.name : '';
    $('#goalLeft').textContent = k >= 1 ? '다 참' : `${fmt(g.to - g.endure)} 더`;
    const key = g.kind + ':' + g.from;
    setBar($('#goalFill'), k, key !== this._shopKey);
    this._shopKey = key;
    $('#goal').classList.toggle('full', k >= 1);
    // 팔마다 직접 철권을 단다(공짜)
    const arms = $('#sArms'); arms.innerHTML = '';
    for (const side of ['L', 'R']) {
      const info = A.armInfo(side), label = side === 'L' ? '왼팔' : '오른팔';
      const card = document.createElement('div');
      card.className = 'arm' + (info.fist ? ' ready' : '');
      card.dataset.side = side;
      const state = info.scrap ? '철권 장착됨' : info.fist ? (info.I < 0.02 ? '맨손' : '다친 맨손') : '철권 없음';
      const primary = info.fist ? '<div class="armReady">사용 가능</div>' :
        `<button class="btn sub" data-act="scrap"><span>${label}에 철권 장착</span></button>`;
      card.innerHTML = `<div class="armHead"><b>${label}</b><span class="armState">${state}</span></div><div class="armBtns">${primary}</div>`;
      card.querySelector('[data-act=scrap]')?.addEventListener('click', () => {
        if (!A.scrap(side)) this.deny();
        this.renderShop();
      });
      arms.appendChild(card);
    }
    // 벽은 지금 고른 것만 먼저 보여 주고, 목록은 필요할 때 펼친다.
    const selected = this.WALLS.find((w) => w.id === G.wall);
    $('#sWallName').textContent = selected ? selected.name : '';
    $('#sWallMult').textContent = selected ? `모아치기: ${SKILL_OF[selected.id]?.name || ''}` : '';
    const next = A.nextWall ? A.nextWall() : null;
    const list = $('#sWalls'); list.innerHTML = '';
    for (const w of this.WALLS) {
      const owned = G.owned.includes(w.id), cur = G.wall === w.id;
      const isNext = !owned && next && next.id === w.id;
      const sk = SKILL_OF[w.id];
      const row = document.createElement('button');
      row.className = 'wall' + (cur ? ' cur' : '') + (owned ? ' owned' : ' locked');
      row.disabled = cur || !owned;
      const right = cur ? '<i>선택됨</i>' : owned ? '<i class="o">선택</i>' : '<em>잠김</em>';
      const note = isNext ? `참을성 ${fmt(Math.max(0, g.to - g.endure))} 더` : !owned ? '앞 벽부터' : '';
      row.innerHTML = `<span class="sw" style="background:${SWATCH[w.id]}"></span>
        <span class="wt"><b>${w.name}</b><span class="sk">모아치기: ${sk ? sk.name : ''}</span><small>${w.desc}</small></span>
        <span class="wp">${right}${note ? '<small>' + note + '</small>' : ''}</span>`;
      row.addEventListener('click', () => {
        if (cur || !owned) return;
        A.selectWall(w.id);
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
  deny() { const c = $('#sArms'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  toast(t) { const h = this.el.hint; h.textContent = t; h.classList.add('show', 'top'); clearTimeout(this._ht); this._ht = setTimeout(() => h.classList.remove('show', 'top'), 2400); }
}
