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
  const close = (result) => {
    if (closed) return;
    closed = true;
    wrap.remove();
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
  root.appendChild(wrap);
  openSheets++;
  document.body.classList.add('sheet-open');
  const first = wrap.querySelector('.sheet [autofocus], .sheet-head .icon-btn');
  if (first) { try { first.focus({ preventScroll: true }); } catch { /* 무시 */ } }
  return { el: wrap, body, close };
}

export function closeAllSheets() {
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
