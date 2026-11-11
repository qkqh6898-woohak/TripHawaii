// 전체 화면 이미지 보기 — 지도·사진·바우처를 두 손가락으로 확대하고 끌어서 옮긴다
import { html, setHTML } from './util.js';

const MAX_SCALE = 6;

export function openViewer(src, alt = '', opts = {}) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', alt || '이미지 보기');
  setHTML(wrap, html`
    <div class="viewer-stage"><img alt="${alt}" draggable="false"></div>
    <div class="viewer-bar">
      <span class="viewer-title">${alt}</span>
      <button type="button" class="viewer-btn" data-v="zoom" aria-label="확대/원래대로">⊕</button>
      <button type="button" class="viewer-btn" data-v="close" aria-label="닫기">✕</button>
    </div>
    ${opts.hint ? html`<p class="viewer-hint">${opts.hint}</p>` : ''}`);
  const stage = wrap.querySelector('.viewer-stage');
  const img = wrap.querySelector('img');
  img.src = src;

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

  const apply = () => { img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`; };

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

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      startDist = dist(pts[0], pts[1]);
      startScale = scale;
      startMid = mid(pts[0], pts[1]);
      startT = { tx, ty };
    } else {
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
      if (scale > 1) {
        tx = startT.tx + dx;
        ty = startT.ty + dy;
        clamp();
        apply();
      }
    }
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      startMid = { x: p.x, y: p.y };
      startT = { tx, ty };
      startDist = 0;
    }
    if (pointers.size === 0 && !moved && e.type === 'pointerup') {
      const t = Date.now();
      if (t - lastTap < 320) {          // 두 번 탭: 확대 ↔ 원래대로
        if (scale > 1.05) { scale = 1; tx = 0; ty = 0; apply(); } else zoomAt(2.5, e.clientX, e.clientY);
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

  const close = () => {
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    document.body.classList.remove('viewer-open');
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'close') close();
    if (b.dataset.v === 'zoom') {
      if (scale > 1.05) { scale = 1; tx = 0; ty = 0; apply(); } else {
        const r = stage.getBoundingClientRect();
        zoomAt(2.5, r.left + r.width / 2, r.top + r.height / 2);
      }
    }
  });

  root.appendChild(wrap);
  document.body.classList.add('viewer-open');
  wrap.querySelector('[data-v="close"]').focus({ preventScroll: true });
  return { close };
}
