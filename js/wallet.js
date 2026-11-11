// 예약 지갑 — data/secret.enc 를 비밀번호로 풀어 예약번호·연락처·바우처를 보여준다.
// 복호화한 내용은 이 기기(IndexedDB)에만 저장하고, 설정에서 '열 때마다 비밀번호'를 켜면 저장하지 않는다.
import * as db from './db.js';
import { decryptJSON, decryptWithKey, sha256Hex, checkEnvelope, CryptoError, MIN_PASSWORD_LENGTH } from './crypto.js';
import { html, setHTML, toast, copyText, fmtMoney, confirmSheet } from './util.js';
import { prefs } from './prefs.js';
import { getTrip, dayByDate, bookingIdsOfDay } from './trip.js';
import * as time from './time.js';
import { openViewer } from './viewer.js';

const ENC_URL = 'data/secret.enc';
const MAX_FAILS = 5;
const LOCKOUT_MS = 30 * 1000;
export const TYPE_ORDER = ['flight', 'hotel', 'car', 'tour', 'food', 'etc'];
export const TYPE_LABEL = { flight: '항공', hotel: '숙소', car: '렌터카', tour: '투어', food: '식당', etc: '기타' };
const TYPE_ICON = { flight: '✈️', hotel: '🏨', car: '🚗', tour: '🎟', food: '🍽', etc: '📌' };

let session = null;        // { data, encHash }  — 열린 상태
let enc = null;            // { text, hash, env } — 저장소에 올라온 암호화 파일 (없으면 null)
let stale = false;         // 새 파일이 올라왔는데 아직 비밀번호로 다시 열지 않음
let justUpdated = false;
let initDone = null;

async function fetchEnc() {
  try {
    const res = await fetch(ENC_URL, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    const env = checkEnvelope(JSON.parse(text));
    return { text, env, hash: await sha256Hex(text) };
  } catch {
    return null;
  }
}

async function persist(data, encHash, key, env) {
  if (prefs().lock) { await db.del('secret', 'main'); return; }
  try {
    await db.put('secret', { id: 'main', data, encHash, key, salt: env.salt, iter: env.iter, savedAt: Date.now() });
  } catch {
    // 키를 저장하지 못하는 브라우저면 내용만 저장
    await db.put('secret', { id: 'main', data, encHash, salt: env.salt, iter: env.iter, savedAt: Date.now() });
  }
}

// 앱 시작 때 한 번: 저장된 내용 불러오기 + 새 파일이 있으면 (가능하면) 비밀번호 없이 갱신
export function initWallet(force = false) {
  if (initDone && !force) return initDone;
  initDone = (async () => {
    const stored = prefs().lock ? null : await db.get('secret', 'main');
    if (stored && stored.data && !session) session = { data: stored.data, encHash: stored.encHash };
    enc = await fetchEnc();
    stale = false;
    if (enc && session && session.encHash !== enc.hash) {
      let refreshed = false;
      if (stored && stored.key && stored.salt === enc.env.salt && stored.iter === enc.env.iter) {
        try {
          const data = await decryptWithKey(stored.key, enc.env);
          session = { data, encHash: enc.hash };
          await persist(data, enc.hash, stored.key, enc.env);
          refreshed = true;
          justUpdated = true;
        } catch { /* 비밀번호가 바뀐 경우 → 다시 입력 */ }
      }
      if (!refreshed) stale = true;
    }
    return status();
  })();
  return initDone;
}

// 'none' = 암호화 파일이 아직 없음, 'locked' = 잠김, 'open' = 열림
export function status() {
  if (session) return 'open';
  return enc ? 'locked' : 'none';
}
export const isStale = () => stale;
export function profile() {
  return session && session.data.profile ? session.data.profile : {};
}

export function bookings() {
  if (!session) return [];
  const list = [...(session.data.bookings || [])];
  const rank = (b) => { const i = TYPE_ORDER.indexOf(b.type); return i < 0 ? TYPE_ORDER.length : i; };
  return list.sort((a, b) => rank(a) - rank(b) || String(a.date || '').localeCompare(String(b.date || '')));
}
export function booking(id) {
  return session ? (session.data.bookings || []).find((b) => b.id === id) || null : null;
}
export function voucher(name) {
  return session && session.data.vouchers ? session.data.vouchers[name] || null : null;
}
export function missingCount() {
  return bookings().filter((b) => !(b.numbers || []).length).length;
}
// 경비 화면의 '사전 결제 가져오기' 용
export function prepaidList() {
  return bookings().filter((b) => b.paid && b.paid.amount > 0)
    .map((b) => ({ id: b.id, title: b.title, type: b.type, date: b.date, amount: b.paid.amount, currency: b.paid.currency }));
}

async function failState() {
  return (await db.getSetting('walletFail', null)) || { count: 0, until: 0 };
}

export async function lockoutRemaining() {
  const f = await failState();
  return Math.max(0, f.until - Date.now());
}

export async function unlock(password) {
  const wait = await lockoutRemaining();
  if (wait > 0) throw new CryptoError('LOCKED_OUT', `여러 번 틀려서 잠시 멈췄어요. ${Math.ceil(wait / 1000)}초 뒤에 다시 시도해 주세요.`);
  if (!enc) enc = await fetchEnc();
  if (!enc) throw new CryptoError('NO_FILE', '예약 정보 파일이 아직 없어요.');
  try {
    const { data, key } = await decryptJSON(enc.env, password);
    session = { data, encHash: enc.hash };
    stale = false;
    await persist(data, enc.hash, key, enc.env);
    await db.setSetting('walletFail', { count: 0, until: 0 });
    return data;
  } catch (e) {
    if (e instanceof CryptoError && e.code === 'BAD_PASSWORD') {
      const f = await failState();
      const count = f.count + 1;
      if (count >= MAX_FAILS) {
        await db.setSetting('walletFail', { count: 0, until: Date.now() + LOCKOUT_MS });
        throw new CryptoError('LOCKED_OUT', `비밀번호를 ${MAX_FAILS}번 틀렸어요. 30초 뒤에 다시 시도해 주세요.`);
      }
      await db.setSetting('walletFail', { count, until: 0 });
      throw new CryptoError('BAD_PASSWORD', `비밀번호가 맞지 않아요. (${count}/${MAX_FAILS})`);
    }
    throw e;
  }
}

export async function lockNow() {
  session = null;
  stale = false;
  await db.del('secret', 'main');
}

// 국제 번호를 읽기 쉽게 끊어 쓴다 (미국 +1 은 3-3-4 자리, 한국 +82 는 2-4-4 자리)
export function fmtTel(tel) {
  let m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(tel);
  if (m) return `+1 ${m[1]}-${m[2]}-${m[3]}`;
  m = /^\+82(\d{2})(\d{3,4})(\d{4})$/.exec(tel);
  if (m) return `+82 ${m[1]}-${m[2]}-${m[3]}`;
  return tel;
}

// ───────────────────────────── 화면 ─────────────────────────────
function numbersHtml(b) {
  if (!(b.numbers || []).length) {
    return html`<p class="wallet-missing">${b.status === 'todo' ? '아직 예약 전이에요' : '예약번호 미입력 — 받으면 추가할게요'}</p>`;
  }
  return html`<div class="wallet-numbers">${b.numbers.map((n) => html`
    <button type="button" class="copy-row" data-copy="${n.value}" data-copy-label="${n.label} 복사했어요">
      <span class="copy-label">${n.label}</span>
      <span class="copy-value">${n.value}</span>
      <span class="copy-hint">복사</span>
    </button>`)}</div>`;
}

function contactsHtml(b) {
  if (!(b.contacts || []).length) return '';
  return html`<div class="wallet-contacts">${b.contacts.map((c) => {
    if (c.tel) return html`<a class="contact" href="tel:${c.tel}"><span>📞 ${c.label}</span><b>${fmtTel(c.tel)}</b></a>`;
    if (c.kakao) return html`<button type="button" class="contact" data-copy="${c.kakao}" data-copy-label="카카오톡 ID를 복사했어요"><span>💬 ${c.label}</span><b>${c.kakao}</b><i>ID 복사</i></button>`;
    if (c.email) return html`<a class="contact" href="mailto:${c.email}"><span>✉️ ${c.label}</span><b>${c.email}</b></a>`;
    if (c.url && /^https:\/\//.test(c.url)) return html`<a class="contact" href="${c.url}" target="_blank" rel="noopener noreferrer"><span>🔗 ${c.label}</span><b>열기</b></a>`;
    return '';
  })}</div>`;
}

// anchor=false: 같은 예약을 한 화면에 두 번 그릴 때(오늘 쓰는 예약) id 가 겹치지 않게 한다
export function bookingCardHtml(b, { compact = false, anchor = true } = {}) {
  const missing = !(b.numbers || []).length;
  const vouchers = (b.vouchers || []).filter((v) => voucher(v));
  return html`
    <article class="card wallet-card ${missing ? 'is-missing' : ''}" ${anchor ? html`id="booking-${b.id}"` : ''} data-booking="${b.id}">
      <header class="wallet-head">
        <span class="wallet-icon" aria-hidden="true">${TYPE_ICON[b.type] || '📌'}</span>
        <div>
          <h3>${b.title}</h3>
          <p class="muted">${[TYPE_LABEL[b.type], b.vendor, b.date ? time.fmtDate(b.date) : ''].filter(Boolean).join(' · ')}</p>
        </div>
      </header>
      ${numbersHtml(b)}
      ${(b.times || []).length ? html`<dl class="wallet-times">${b.times.map((t) => html`<div><dt>${t.label}</dt><dd>${t.value}</dd></div>`)}</dl>` : ''}
      ${compact ? '' : contactsHtml(b)}
      ${b.paid ? html`<p class="wallet-paid">결제 완료 <b>${fmtMoney(b.paid.amount, b.paid.currency)}</b></p>` : ''}
      ${!compact && (b.notes || []).length ? html`<ul class="wallet-notes">${b.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ''}
      ${vouchers.length ? html`<div class="wallet-vouchers">${vouchers.map((v) => html`
        <button type="button" class="voucher" data-voucher="${v}" aria-label="바우처 크게 보기">
          <img src="${voucher(v)}" alt="바우처 ${v}" loading="lazy"><span>바우처 크게 보기</span>
        </button>`)}</div>` : ''}
      ${compact ? html`<a class="btn btn-small" href="#/wallet?focus=${b.id}">예약 지갑에서 자세히</a>` : ''}
    </article>`;
}

function passwordFormHtml(message) {
  return html`
    <form class="card wallet-lock" data-form="unlock" autocomplete="off">
      <div class="lock-emoji" aria-hidden="true">🔐</div>
      <h2>${message || '예약 지갑이 잠겨 있어요'}</h2>
      <p class="muted">예약번호·연락처·바우처는 암호화되어 있어요. 둘이 정한 비밀번호를 입력하면 이 폰에서 열립니다.</p>
      <label class="field">
        <span>예약 비밀번호</span>
        <input type="password" name="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required minlength="${MIN_PASSWORD_LENGTH}" placeholder="비밀번호">
      </label>
      <label class="check-inline"><input type="checkbox" data-toggle="show-pw"> 비밀번호 보기</label>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">열기</button>
      <p class="muted small">입력한 비밀번호는 이 폰 안에서 확인만 하고 어디로도 보내지 않아요.</p>
    </form>`;
}

function emptyHtml() {
  return html`
    <div class="card empty-card">
      <div class="lock-emoji" aria-hidden="true">🎫</div>
      <h2>예약 정보가 아직 등록되지 않았어요</h2>
      <p class="muted">예약 비밀번호를 정하면 예약번호·연락처·바우처가 암호화되어 이곳에 들어옵니다.
      등록된 뒤에는 앱을 다시 열면 자동으로 보여요.</p>
      <a class="btn" href="#/days">일정 보러 가기</a>
    </div>`;
}

export async function render(root, ctx) {
  await initWallet();
  const st = status();
  const trip = getTrip();
  if (st === 'none') { setHTML(root, html`<h1 class="page-title">🎫 예약</h1>${emptyHtml()}`); return; }
  if (st === 'locked') {
    setHTML(root, html`<h1 class="page-title">🎫 예약</h1>${passwordFormHtml()}`);
    bind(root, ctx);
    return;
  }

  const list = bookings();
  const filter = (ctx.query && ctx.query.type) || 'all';
  const shown = filter === 'all' ? list : list.filter((b) => b.type === filter);
  const types = TYPE_ORDER.filter((t) => list.some((b) => b.type === t));
  const phase = time.tripPhase(trip.trip);
  const today = phase.phase === 'during' ? dayByDate(phase.date) : null;
  const todayIds = today ? bookingIdsOfDay(today) : [];
  const todayList = filter === 'all' ? todayIds.map((id) => booking(id)).filter(Boolean) : [];
  const missing = missingCount();

  setHTML(root, html`
    <h1 class="page-title">🎫 예약</h1>
    ${stale ? html`
      <div class="banner banner-warn">예약 정보가 업데이트됐어요. 비밀번호를 다시 입력하면 새 내용이 보여요. (지금은 이전 내용)</div>
      ${passwordFormHtml('새 예약 정보 열기')}` : ''}
    ${justUpdated ? html`<div class="banner banner-ok">예약 정보가 새 내용으로 바뀌었어요.</div>` : ''}
    <div class="chips" role="tablist" aria-label="예약 종류">
      <a class="chip ${filter === 'all' ? 'is-on' : ''}" href="#/wallet">전체 ${list.length}</a>
      ${types.map((t) => html`<a class="chip ${filter === t ? 'is-on' : ''}" href="#/wallet?type=${t}">${TYPE_LABEL[t]}</a>`)}
    </div>
    ${missing ? html`<p class="muted small">예약번호가 아직 없는 예약 ${missing}건은 흐리게 표시돼요.</p>` : ''}
    ${todayList.length ? html`<h2 class="section-title">오늘 쓰는 예약</h2>${todayList.map((b) => bookingCardHtml(b, { anchor: false }))}<h2 class="section-title">전체 예약</h2>` : ''}
    ${shown.map((b) => bookingCardHtml(b))}
    <div class="card">
      <button type="button" class="btn btn-block" data-action="lock">지금 잠그기</button>
      <p class="muted small">잠그면 이 폰에 저장된 예약 내용이 지워지고, 다시 볼 때 비밀번호가 필요해요.
      매번 비밀번호를 묻게 하려면 <a href="#/settings">설정</a>에서 바꿀 수 있어요.</p>
    </div>`);
  justUpdated = false;
  bind(root, ctx);

  const focus = ctx.query && ctx.query.focus;
  if (focus) {
    const el = root.querySelector(`#booking-${CSS.escape(focus)}`);
    if (el) {
      el.classList.add('is-focus');
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }
}

// 예약 카드 안의 복사·바우처 버튼 (다른 화면에서도 재사용)
export function bindBookingActions(root) {
  root.addEventListener('click', (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { e.preventDefault(); copyText(copy.dataset.copy, copy.dataset.copyLabel || '복사했어요'); return; }
    const v = e.target.closest('[data-voucher]');
    if (v) {
      const src = voucher(v.dataset.voucher);
      if (src) openViewer(src, '바우처', { hint: '직원에게 보여줄 때는 화면 밝기를 올려 주세요. 두 손가락으로 확대할 수 있어요.' });
    }
  });
}

function bind(root, ctx) {
  bindBookingActions(root);
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-toggle="show-pw"]')) {
      const input = e.target.closest('form').querySelector('input[name="password"]');
      input.type = e.target.checked ? 'text' : 'password';
    }
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="unlock"]');
    if (!form) return;
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const error = form.querySelector('.form-error');
    const input = form.querySelector('input[name="password"]');
    error.hidden = true;
    btn.disabled = true;
    btn.textContent = '확인하는 중…';
    try {
      await unlock(input.value);
      input.value = '';
      toast('예약 지갑을 열었어요');
      ctx.rerender();
    } catch (err) {
      error.textContent = err instanceof CryptoError ? err.message : '열지 못했어요. 다시 시도해 주세요.';
      error.hidden = false;
      btn.disabled = false;
      btn.textContent = '열기';
      input.select();
    }
  });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="lock"]')) return;
    const ok = await confirmSheet('예약 지갑을 잠글까요? 다시 보려면 비밀번호가 필요해요.', { ok: '잠그기', title: '예약 지갑 잠그기' });
    if (!ok) return;
    await lockNow();
    toast('잠갔어요');
    ctx.rerender();
  });
}

