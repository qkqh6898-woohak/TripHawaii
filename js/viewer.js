// 전체 화면 이미지 보기 — 지도·사진·바우처를 두 손가락으로 확대하고 끌어서 옮긴다.
// 사진이 여러 장이면 좌우로 밀어 넘긴다.
import { html, setHTML, pushLayer, dropLayer } from './util.js';

const MAX_SCALE = 6;
const SWIPE_MIN = 50;

/**
 * @param {string|Array<string|{src:string, alt?:string}>} src  이미지 하나 또는 여러 장
 * @param {string} alt
 * @param {{hint?: string, index?: number}} opts  index: 여러 장일 때 처음 보여줄 번호
 */
export function openViewer(src, alt = '', opts = {}) {
  const items = (Array.isArray(src) ? src : [{ src, alt }]).map((x) => (typeof x === 'string' ? { src: x, alt: '' } : x));
  if (!items.length) return null;
  const many = items.length > 1;
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
      <button type="button" class="viewer-btn" data-v="zoom" aria-label="확대/원래대로">⊕</button>
      <button type="button" class="viewer-btn" data-v="close" aria-label="닫기">✕</button>
    </div>
    ${many ? html`
      <button type="button" class="viewer-nav viewer-prev" data-v="prev" aria-label="이전 사진">‹</button>
      <button type="button" class="viewer-nav viewer-next" data-v="next" aria-label="다음 사진">›</button>` : ''}
    ${opts.hint || many ? html`<p class="viewer-hint">${opts.hint || '좌우로 밀어 넘기고, 두 손가락으로 확대할 수 있어요'}</p>` : ''}`);
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
      const next = Math.min(MAX_SCALE, Math.max(1, startScale * (dist(pts[0], pts[1]) / startDist)));
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
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
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
    if (many && e.key === 'ArrowRight') show(index + 1);
    if (many && e.key === 'ArrowLeft') show(index - 1);
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'close') close();
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
  wrap.querySelector('[data-v="close"]').focus({ preventScroll: true });
  return { close, show };
}
