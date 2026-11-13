// 전체 화면 이미지 보기 — 지도·사진·바우처를 두 손가락으로 확대하고 끌어서 옮긴다.
// 사진이 여러 장이면 좌우로 밀어 넘긴다.
// 지도는 '단계'(levels)를 받을 수 있다: 두 손가락으로 오므리면 더 넓은 지도로 넘어간다
// (이날 지도 → 섬 전체 → 하와이 전체). 아래 버튼·⊖ 버튼·마우스 휠·'-' 키로도 같다.
import { html, setHTML, pushLayer, dropLayer } from './util.js';

const MAX_SCALE = 6;
const SWIPE_MIN = 50;
const OUT_MIN_SCALE = 0.5;     // 더 넓은 지도가 있을 때 오므릴 수 있는 만큼
const OUT_SWITCH = 0.8;        // 이보다 작게 오므리고 손을 떼면 다음 단계로

/**
 * @param {string|Array<string|{src:string, alt?:string}>} src  이미지 하나 또는 여러 장
 * @param {string} alt
 * @param {{hint?: string, index?: number, levels?: {src:string, alt?:string, label:string}[]}} opts
 *   index: 여러 장일 때 처음 보여줄 번호 · levels: 좁은 지도 → 넓은 지도 순서 (첫 번째가 src 와 같은 지도)
 */
export function openViewer(src, alt = '', opts = {}) {
  const items = (Array.isArray(src) ? src : [{ src, alt }]).map((x) => (typeof x === 'string' ? { src: x, alt: '' } : x));
  if (!items.length) return null;
  const many = items.length > 1;
  const levels = !many && Array.isArray(opts.levels) && opts.levels.length > 1 ? opts.levels : null;
  let level = 0;
  if (levels) items[0] = { src: levels[0].src, alt: levels[0].alt || alt };
  let index = Math.min(Math.max(0, opts.index || 0), items.length - 1);

  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', '이미지 보기');
  setHTML(wrap, html`
    <div class="viewer-stage"><img alt="" draggable="false"></div>
    <div class="viewer-bar">
      <span class="viewer-title"></span>
      ${many ? html`<span class="viewer-count" aria-live="polite"></span>` : ''}
      ${levels ? html`<button type="button" class="viewer-btn" data-v="out" aria-label="더 넓게 보기">⊖</button>` : ''}
      <button type="button" class="viewer-btn" data-v="zoom" aria-label="확대/원래대로">⊕</button>
      <button type="button" class="viewer-btn" data-v="close" aria-label="닫기">✕</button>
    </div>
    ${many ? html`
      <button type="button" class="viewer-nav viewer-prev" data-v="prev" aria-label="이전 사진">‹</button>
      <button type="button" class="viewer-nav viewer-next" data-v="next" aria-label="다음 사진">›</button>` : ''}
    ${opts.hint || many || levels ? html`
      <div class="viewer-foot">
        ${levels ? html`<nav class="viewer-levels" aria-label="지도 범위">${levels.map((l, i) => html`<button type="button" class="viewer-level" data-lv="${i}" aria-pressed="${i === 0 ? 'true' : 'false'}">${l.label}</button>`)}</nav>` : ''}
        <p class="viewer-hint">${opts.hint || (levels ? '두 손가락으로 오므리면 더 넓게, 벌리면 확대돼요' : '좌우로 밀어 넘기고, 두 손가락으로 확대할 수 있어요')}</p>
      </div>` : ''}`);
  const stage = wrap.querySelector('.viewer-stage');
  const img = wrap.querySelector('img');
  const title = wrap.querySelector('.viewer-title');
  const count = wrap.querySelector('.viewer-count');

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map();
  let startDist = 0;
  let startScale = 1;
  let startMid = null;
  let startT = null;
  let lastTap = 0;
  let moved = false;
  let wasPinch = false;

  const apply = () => { img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`; };
  const wider = () => !!levels && level < levels.length - 1;
  const minScale = () => (wider() ? OUT_MIN_SCALE : 1);

  // 지도 단계 바꾸기 — 넓어질 때는 새 지도가 크게 시작해 줄어들고, 좁아질 때는 작게 시작해 커진다
  function setLevel(n) {
    if (!levels) return;
    const next = Math.min(Math.max(0, n), levels.length - 1);
    if (next === level && scale === 1) return;
    const dir = next > level ? 'out' : 'in';
    level = next;
    scale = 1; tx = 0; ty = 0;
    apply();
    img.src = levels[level].src;
    img.alt = levels[level].alt || '';
    title.textContent = levels[level].alt || levels[level].label;
    wrap.dataset.level = String(level);
    wrap.querySelectorAll('[data-lv]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lv === String(level) ? 'true' : 'false'));
    const out = wrap.querySelector('[data-v="out"]');
    if (out) out.disabled = !wider();
    img.classList.remove('lv-out', 'lv-in');
    void img.offsetWidth;            // 같은 효과를 다시 시작하기 위해
    img.classList.add(dir === 'out' ? 'lv-out' : 'lv-in');
  }
  img.addEventListener('animationend', () => img.classList.remove('lv-out', 'lv-in'));
  const goWider = () => { if (zoomed()) { scale = 1; tx = 0; ty = 0; apply(); } else if (wider()) setLevel(level + 1); };

  function show(i) {
    index = Math.min(Math.max(0, i), items.length - 1);
    scale = 1; tx = 0; ty = 0;
    apply();
    img.src = items[index].src;
    img.alt = items[index].alt || '';
    title.textContent = items[index].alt || '';
    if (count) count.textContent = `${index + 1} / ${items.length}`;
    wrap.dataset.index = String(index);
    if (many) {
      wrap.querySelector('.viewer-prev').disabled = index === 0;
      wrap.querySelector('.viewer-next').disabled = index === items.length - 1;
    }
  }

  function clamp() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const iw = img.clientWidth * scale;
    const ih = img.clientHeight * scale;
    const mx = Math.max(0, (iw - sw) / 2);
    const my = Math.max(0, (ih - sh) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }

  function zoomAt(newScale, cx, cy) {
    const rect = stage.getBoundingClientRect();
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    const k = newScale / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = newScale;
    clamp();
    apply();
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const zoomed = () => scale > 1.05;

  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      startDist = dist(pts[0], pts[1]);
      startScale = scale;
      startMid = mid(pts[0], pts[1]);
      startT = { tx, ty };
      wasPinch = true;
    } else {
      moved = false;
      wasPinch = false;
      startMid = { x: e.clientX, y: e.clientY };
      startT = { tx, ty };
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (pts.length === 2 && startDist > 0) {
      const next = Math.min(MAX_SCALE, Math.max(minScale(), startScale * (dist(pts[0], pts[1]) / startDist)));
      const m = mid(pts[0], pts[1]);
      zoomAt(next, m.x, m.y);
      moved = true;
    } else if (pts.length === 1 && startMid) {
      const dx = e.clientX - startMid.x;
      const dy = e.clientY - startMid.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (zoomed()) {
        tx = startT.tx + dx;
        ty = startT.ty + dy;
        clamp();
        apply();
      } else if (many && !wasPinch) {
        tx = dx;                    // 넘기는 동안 손가락을 따라온다
        apply();
      }
    }
  });

  const end = (e) => {
    const start = startMid;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      startMid = { x: p.x, y: p.y };
      startT = { tx, ty };
      startDist = 0;
      return;
    }
    if (pointers.size !== 0) return;
    if (scale < 1) {                  // 오므려서 원래보다 작아졌으면: 많이 오므렸으면 넓은 지도로, 아니면 제자리
      if (wasPinch && scale < OUT_SWITCH && wider()) setLevel(level + 1);
      else { scale = 1; tx = 0; ty = 0; apply(); }
      return;
    }
    if (many && !zoomed() && !wasPinch && start && e.type === 'pointerup') {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
        show(index + (dx < 0 ? 1 : -1));      // 왼쪽으로 밀면 다음 사진 (끝에서는 제자리)
        return;
      }
    }
    if (!zoomed()) { tx = 0; ty = 0; apply(); }
    if (!moved && e.type === 'pointerup') {
      const t = Date.now();
      if (t - lastTap < 320) {          // 두 번 탭: 확대 ↔ 원래대로
        if (zoomed()) { scale = 1; tx = 0; ty = 0; apply(); } else zoomAt(2.5, e.clientX, e.clientY);
        lastTap = 0;
      } else {
        lastTap = t;
      }
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  let wheelAt = 0;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0 && !zoomed() && wider()) {     // 휠을 내리면(축소) 넓은 지도로
      if (Date.now() - wheelAt > 450) { wheelAt = Date.now(); setLevel(level + 1); }
      return;
    }
    const next = Math.min(MAX_SCALE, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    zoomAt(next, e.clientX, e.clientY);
  }, { passive: false });

  let closed = false;
  const close = (viaBack = false) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    document.body.classList.remove('viewer-open');
    dropLayer(layer, { silent: viaBack === true });
  };
  const layer = pushLayer(() => close(true));   // 폰의 뒤로 가기로도 닫힌다
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (levels && e.key === '-') goWider();
    if (many && e.key === 'ArrowRight') show(index + 1);
    if (many && e.key === 'ArrowLeft') show(index - 1);
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    const lv = e.target.closest('[data-lv]');
    if (lv) { setLevel(Number(lv.dataset.lv)); return; }
    const b = e.target.closest('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'close') close();
    if (b.dataset.v === 'out') goWider();
    if (b.dataset.v === 'prev') show(index - 1);
    if (b.dataset.v === 'next') show(index + 1);
    if (b.dataset.v === 'zoom') {
      if (zoomed()) { scale = 1; tx = 0; ty = 0; apply(); } else {
        const r = stage.getBoundingClientRect();
        zoomAt(2.5, r.left + r.width / 2, r.top + r.height / 2);
      }
    }
  });

  root.appendChild(wrap);
  document.body.classList.add('viewer-open');
  show(index);
  if (levels) {
    wrap.dataset.level = '0';
    title.textContent = levels[0].alt || levels[0].label;
    for (const l of levels.slice(1)) { const pre = new Image(); pre.src = l.src; }   // 넘어갈 때 바로 보이게 미리 읽기
  }
  wrap.querySelector('[data-v="close"]').focus({ preventScroll: true });
  return { close, show };
}
