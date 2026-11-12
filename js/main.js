// 앱 시작점 — 주소(#/화면) 읽기, 하단 탭, 초기화, 새 버전·오프라인 표시
import { html, setHTML, $, closeAllSheets, toast } from './util.js';
import * as time from './time.js';
import * as db from './db.js';
import { loadPrefs } from './prefs.js';
import { loadTrip, getTrip } from './trip.js';
import { registerSW, updateReady, applyUpdate, checkForUpdate } from './sw-client.js';
import { initTTS } from './tts.js';
import { notify } from './ui.js';
import * as wallet from './wallet.js';
import * as weather from './weather.js';
import * as today from './today.js';
import * as days from './days.js';
import * as maps from './maps.js';
import * as more from './more.js';
import * as checklist from './checklist.js';
import * as expenses from './expenses.js';
import * as phrases from './phrases.js';
import * as settings from './settings.js';
import * as videos from './videos.js';

const VIEWS = {
  today: { mod: today, tab: 'today', title: '오늘' },
  days: { mod: days, tab: 'days', title: '일정' },
  day: { mod: days, tab: 'days', title: '일정' },
  maps: { mod: maps, tab: 'maps', title: '지도' },
  wallet: { mod: wallet, tab: 'wallet', title: '예약' },
  more: { mod: more, tab: 'more', title: '더보기' },
  check: { mod: checklist, tab: 'more', title: '체크리스트' },
  money: { mod: expenses, tab: 'more', title: '경비' },
  import: { mod: { render: expenses.renderImport }, tab: 'more', title: '경비 가져오기' },
  phrases: { mod: phrases, tab: 'more', title: '여행 영어' },
  settings: { mod: settings, tab: 'more', title: '설정' },
  videos: { mod: videos, tab: 'more', title: '하와이 영상' },
};

let current = null;
let renderSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const cut = raw.indexOf('?');
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const qs = cut < 0 ? '' : raw.slice(cut + 1);
  const safe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const parts = path.split('/').filter(Boolean).map(safe);
  const name = VIEWS[parts[0]] ? parts[0] : 'today';
  return { name, params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs)) };
}

function navigate(hash, replace = false) {
  if (replace) history.replaceState(null, '', location.pathname + location.search + hash);
  else location.hash = hash;
  if (replace) renderRoute();
}

async function renderRoute({ keepScroll = false } = {}) {
  const route = parseHash();
  const view = VIEWS[route.name];
  const seq = ++renderSeq;
  const el = document.createElement('div');
  el.className = `view view-${route.name}`;
  const ctx = { ...route, navigate, rerender: () => renderRoute({ keepScroll: true }) };
  try {
    await view.mod.render(el, ctx);
  } catch (e) {
    console.error(e);
    setHTML(el, html`
      <div class="card">
        <h2>화면을 그리지 못했어요</h2>
        <p class="muted">${e && e.message ? e.message : '알 수 없는 오류'}</p>
        <button type="button" class="btn btn-primary" data-reload>다시 열기</button>
      </div>`);
  }
  if (seq !== renderSeq) return; // 그리는 동안 다른 화면으로 넘어감
  if (current && current.view !== view && current.view.mod.leave) current.view.mod.leave();
  const y = window.scrollY;
  $('#view').replaceChildren(el);
  document.querySelectorAll('#tabs a').forEach((a) => {
    const on = a.dataset.tab === view.tab;
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${view.title} · Aloha Trip`;
  window.scrollTo(0, keepScroll ? y : 0);
  current = { route, view };
}

const busy = () => document.body.classList.contains('sheet-open') || document.body.classList.contains('viewer-open');

// 짧은 시간에 여러 알림(오프라인 준비·날씨 등)이 겹쳐도 화면은 한 번만 다시 그린다
let refreshTimer = null;
function refreshIfLive(what) {
  if (!current) return;
  const live = current.view.mod.live || [];
  if (!live.includes(what)) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!busy()) renderRoute({ keepScroll: true }); }, 200);
}

function updateTopbar() {
  const bar = $('#status');
  if (!bar) return;
  setHTML(bar, html`
    ${navigator.onLine === false ? html`<span class="pill pill-off" title="인터넷 연결 없음">오프라인</span>` : ''}
    ${updateReady() ? html`<button type="button" class="pill pill-update" data-apply-update>새 버전 적용</button>` : ''}`);
}

function fatal(message) {
  setHTML($('#view'), html`
    <div class="card">
      <h2>일정을 불러오지 못했어요</h2>
      <p class="muted">${message}</p>
      <p class="muted small">처음 여는 것이라면 인터넷에 연결한 뒤 다시 열어 주세요. 한 번 열고 나면 인터넷 없이도 보여요.</p>
      <button type="button" class="btn btn-primary" data-reload>다시 열기</button>
    </div>`);
}

async function boot() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-reload]')) location.reload();
    if (e.target.closest('[data-apply-update]')) applyUpdate();
  });

  // 미리보기·테스트용 시각 고정: ?now=2026-11-17T09:12 (하와이 시각)
  const fixed = time.parseNowParam(new URLSearchParams(location.search).get('now'));
  if (fixed != null) time.setNowOverride(fixed);

  try { await loadPrefs(); } catch (e) { console.warn('설정을 읽지 못했어요', e); }
  try {
    await loadTrip();
  } catch (e) {
    fatal(e && e.message ? e.message : '');
    registerSW();
    return;
  }
  initTTS();

  window.addEventListener('hashchange', () => { closeAllSheets(); renderRoute(); });
  window.addEventListener('aloha:update', (e) => {
    const what = e.detail && e.detail.what;
    if (what === 'sw-update') { updateTopbar(); toast('새 버전이 준비됐어요 — 위의 \'새 버전 적용\'을 눌러 주세요', 4000); }
    refreshIfLive(what);
  });
  window.addEventListener('online', updateTopbar);
  window.addEventListener('offline', updateTopbar);

  if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/today');
  await renderRoute();
  updateTopbar();
  document.documentElement.classList.add('is-ready');

  // 여기부터는 화면을 막지 않고 뒤에서 진행
  registerSW().then(() => updateTopbar());
  db.requestPersist();
  wallet.initWallet();   // 첫 화면이 이미 기다렸다 그렸으므로 다시 그리지 않는다
  weather.refreshAll().then((r) => { if (r.updated) notify('weather'); });
  settings.autoRate();

  // 시계·남은 시간 갱신 (30초마다), 앱으로 돌아왔을 때 새로 고침
  setInterval(() => refreshIfLive('clock'), 30 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshIfLive('clock');
    checkForUpdate();
    weather.refreshAll().then((r) => { if (r.updated) notify('weather'); });
  });
}

boot();

// 개발·테스트 도구에서 상태를 볼 수 있게
window.__aloha = { time, getTrip };
