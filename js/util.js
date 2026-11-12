// 공용 도구: 안전한 HTML 템플릿, 금액 표시, 토스트, 복사, 아래에서 올라오는 시트, 파일 내려받기

// ───────────── HTML 템플릿 (값은 자동으로 이스케이프) ─────────────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
// 이미 안전한 HTML 조각을 그대로 넣을 때만 사용
export const raw = (s) => new Raw(String(s == null ? '' : s));

function renderValue(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

// html`<p>${userText}</p>` — 끼워 넣는 값은 모두 이스케이프된다 (html`` 결과와 raw() 만 예외)
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function setHTML(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : esc(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ───────────── 숫자·금액 ─────────────
export function fmtKRW(n) {
  return '₩' + Math.round(Number(n) || 0).toLocaleString('ko-KR');
}
export function fmtUSD(n) {
  const v = Number(n) || 0;
  const hasCents = Math.abs(v - Math.round(v)) > 0.004;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}
export function fmtMoney(amount, currency) {
  return currency === 'KRW' ? fmtKRW(amount) : fmtUSD(amount);
}

export function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 짧은 문자열 해시 (체크 항목 id 용 — 보안 용도가 아님)
export function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ───────────── 환경 ─────────────
export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// 카카오톡 등 앱 안의 브라우저에서는 '홈 화면에 추가'가 되지 않는다 → 어떤 앱인지 알려준다
export function inAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/KAKAOTALK/i.test(ua)) return '카카오톡';
  if (/NAVER/i.test(ua)) return '네이버 앱';
  if (/Instagram/i.test(ua)) return '인스타그램';
  if (/FBAN|FBAV/i.test(ua)) return '페이스북';
  if (/\bLine\//i.test(ua)) return '라인';
  return '';
}

// ───────────── 좌우로 밀기(스와이프) ─────────────
// 손가락으로 화면을 좌우로 밀면 handler('left' | 'right') 를 부른다. (마우스는 제외)
// 가로로 스크롤되는 줄(날짜 칩·사진 묶음)이나 입력 칸에서 시작한 동작은 무시한다.
// el 에는 CSS 로 touch-action: pan-y 를 줘야 세로 스크롤과 함께 쓸 수 있다 (.swipe-x).
const EDGE = 24;
export function onSwipe(el, handler, { min = 60 } = {}) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    start = null;
    if (e.pointerType === 'mouse' || e.isPrimary === false) return;
    if (e.target.closest && e.target.closest('.chips-scroll, .seg-scroll, .carousel-track, input, textarea, select')) return;
    // 화면 양쪽 끝은 폰의 '뒤로 가기' 제스처 자리라서 비워 둔다 (두 동작이 겹치지 않게)
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  el.addEventListener('pointerup', (e) => {
    const s = start;
    start = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= min && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - s.t < 900) handler(dx < 0 ? 'left' : 'right');
  });
  el.addEventListener('pointercancel', () => { start = null; });
}

// ───────────── 진동 피드백 (지원하는 폰에서만 · 설정에서 끌 수 있음) ─────────────
let hapticOn = true;
export function setHaptic(on) { hapticOn = !!on; }
export function haptic(ms = 12) {
  try { if (hapticOn && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms); } catch { /* 지원하지 않는 기기 */ }
}

// ───────────── 겹쳐 뜨는 창(시트·사진 보기)과 '뒤로 가기' ─────────────
// 창을 열 때 방문 기록을 한 칸 쌓아 두면, 폰의 뒤로 가기(버튼·제스처)가 앱을 나가지 않고 창만 닫는다.
const layers = [];
let pendingBack = 0;
let settleWaiters = [];
const layerDepth = () => { try { return (history.state && history.state.alohaLayer) || 0; } catch { return 0; } };
function settled() {
  const w = settleWaiters;
  settleWaiters = [];
  w.forEach((f) => f());
}

export function pushLayer(onBack) {
  const layer = { onBack };
  layers.push(layer);
  try { history.pushState({ alohaLayer: layers.length }, ''); } catch { /* 기록을 못 쌓아도 창은 열린다 */ }
  return layer;
}

// 화면의 ✕ 등으로 닫았을 때 — 쌓아 둔 기록 한 칸을 되돌린다 (silent: 기록은 그대로 둠)
export function dropLayer(layer, { silent = false } = {}) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  if (silent || !layerDepth()) return;
  pendingBack++;
  setTimeout(() => { if (pendingBack) { pendingBack = 0; settled(); } }, 600);
  try { history.back(); } catch { pendingBack = 0; settled(); }
}

// 창을 닫으며 되돌린 기록이 정리될 때까지 기다린다 (주소를 바꾸기 전에 부른다)
export function layersSettled() {
  if (!pendingBack) return Promise.resolve();
  return new Promise((resolve) => { settleWaiters.push(resolve); });
}

export const openLayerCount = () => layers.length;

function closeLayersSilently() {
  for (const l of layers.splice(0).reverse()) { try { l.onBack(); } catch { /* 무시 */ } }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    if (pendingBack > 0) { pendingBack--; if (!pendingBack) settled(); }
    const depth = (e.state && e.state.alohaLayer) || 0;
    while (layers.length > depth) { const l = layers.pop(); try { l.onBack(); } catch { /* 무시 */ } }
  });
  // 창 안의 앱 링크(#/…)를 누르면: 창을 닫고, 창 때문에 쌓인 기록 자리에 새 화면을 넣는다
  // (이렇게 해야 뒤로 가기를 눌렀을 때 아무 일도 안 일어나는 '빈 칸'이 생기지 않는다)
  document.addEventListener('click', (e) => {
    if (!layers.length || e.defaultPrevented || e.button) return;
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || a.target === '_blank') return;
    e.preventDefault();
    const href = a.getAttribute('href');
    const hadEntry = layerDepth() > 0;
    closeLayersSilently();
    if (hadEntry) {
      history.replaceState(null, '', location.pathname + location.search + href);
      window.dispatchEvent(new Event('hashchange'));
    } else {
      location.hash = href;
    }
  }, true);
}

// ───────────── 토스트 ─────────────
let toastTimer;
export function toast(message, ms = 2200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  root.textContent = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el.parentNode) el.remove(); }, ms);
}

export async function copyText(text, label = '복사했어요') {
  const value = String(text);
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch { /* 아래 방법으로 다시 시도 */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? label : '복사하지 못했어요. 길게 눌러 직접 복사해 주세요.');
  return ok;
}

// ───────────── 시트 (아래에서 올라오는 창) ─────────────
let openSheets = 0;
/**
 * @param {Raw|string} content  html`` 결과
 * @param {{title?: string, onClose?: Function, full?: boolean}} opts
 * @returns {{el: HTMLElement, body: HTMLElement, close: Function}}
 */
export function openSheet(content, opts = {}) {
  const root = document.getElementById('sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  setHTML(wrap, html`
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet ${opts.full ? 'sheet-full' : ''}" role="dialog" aria-modal="true" aria-label="${opts.title || '상세'}">
      <header class="sheet-head">
        <h2>${opts.title || ''}</h2>
        <button type="button" class="icon-btn" data-sheet-close aria-label="닫기">✕</button>
      </header>
      <div class="sheet-body"></div>
    </section>`);
  const body = wrap.querySelector('.sheet-body');
  setHTML(body, content);
  const previousFocus = document.activeElement;
  let closed = false;
  const close = (result, viaBack = false) => {
    if (closed) return;
    closed = true;
    wrap.remove();
    dropLayer(layer, { silent: viaBack });
    openSheets = Math.max(0, openSheets - 1);
    if (!openSheets) document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) { try { previousFocus.focus({ preventScroll: true }); } catch { /* 무시 */ } }
    if (opts.onClose) opts.onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  const layer = pushLayer(() => close(undefined, true));
  root.appendChild(wrap);
  openSheets++;
  document.body.classList.add('sheet-open');
  const first = wrap.querySelector('.sheet [autofocus], .sheet-head .icon-btn');
  if (first) { try { first.focus({ preventScroll: true }); } catch { /* 무시 */ } }
  return { el: wrap, body, close };
}

export function closeAllSheets() {
  closeLayersSilently();
  const root = document.getElementById('sheet-root');
  if (root) root.textContent = '';
  openSheets = 0;
  document.body.classList.remove('sheet-open');
}

// 확인 창: Promise<boolean>
export function confirmSheet(message, { ok = '확인', cancel = '취소', danger = false, title = '확인' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const sheet = openSheet(html`
      <p class="confirm-msg">${message}</p>
      <div class="btn-row">
        <button type="button" class="btn" data-answer="no">${cancel}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${ok}</button>
      </div>`, { title, onClose: () => { if (!answered) resolve(false); } });
    sheet.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return;
      answered = true;
      resolve(b.dataset.answer === 'yes');
      sheet.close();
    });
  });
}

// ───────────── 파일 ─────────────
export function downloadFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFileText(accept = 'application/json,.json,.txt') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}
