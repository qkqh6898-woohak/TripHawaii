// 여행 경비 — 달러/원 입력, 원화 환산(입력한 날의 환율로 고정), 분류·결제자 합계, 정산,
// 두 폰 사이 주고받기(QR·코드·파일), 팁 계산기. 계산 함수는 위쪽에 모아 단위 테스트한다.
import * as db from './db.js';
import { html, raw, setHTML, fmtKRW, fmtUSD, fmtMoney, toast, openSheet, confirmSheet, copyText, downloadFile, pickFileText } from './util.js';
import { bytesToB64, b64ToBytes } from './crypto.js';
import { prefs, setPref, PAYERS } from './prefs.js';
import { getTrip } from './trip.js';
import * as time from './time.js';
import * as wallet from './wallet.js';
import qrcode from '../vendor/qrcode.js';

export const CATS = { food: '식비', shop: '쇼핑', transport: '교통', hotel: '숙소', tour: '투어', etc: '기타' };
export const CAT_ICONS = { food: '🍽', shop: '🛍', transport: '🚕', hotel: '🏨', tour: '🎟', etc: '💳' };
export const METHODS = { card: '카드', cash: '현금' };
const CAT_KEYS = Object.keys(CATS);
const PAYER_KEYS = Object.keys(PAYERS);
const METHOD_KEYS = Object.keys(METHODS);
const SHARE_PREFIX = 'j1.';
export const QR_MAX_URL = 1500;      // 이보다 길면 QR 이 너무 촘촘해져 잘 안 찍힌다
const MAX_IMPORT = 3000;

// ───────────────────────────── 계산 (DOM 없음) ─────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100;

export function toKRW(amount, currency, rate, feePct = 0, method = 'card') {
  const a = Number(amount) || 0;
  if (currency === 'KRW') return Math.round(a);
  const fee = method === 'card' ? Number(feePct) || 0 : 0;   // 수수료는 카드 결제에만
  return Math.round(a * Number(rate) * (1 + fee / 100));
}

export function newId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

/**
 * 새 지출 만들기
 * @param {{amount:number|string, currency:'USD'|'KRW', cat:string, payer:string, method:string, memo?:string, date:string, personal?:boolean}} input
 * @param {{rate:number, fee:number, device:string, now?:number}} env
 */
export function makeExpense(input, env) {
  const now = env.now == null ? Date.now() : env.now;
  const amount = round2(Number(String(input.amount).replace(/,/g, '')));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('금액을 입력해 주세요');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new Error('날짜를 확인해 주세요');
  const currency = input.currency === 'KRW' ? 'KRW' : 'USD';
  const method = METHOD_KEYS.includes(input.method) ? input.method : 'card';
  const rate = Number(env.rate) > 0 ? Number(env.rate) : 0;
  if (currency === 'USD' && !rate) throw new Error('환율을 먼저 설정해 주세요');
  const fee = Number(env.fee) || 0;
  return {
    id: input.id || newId(),
    date: input.date, amount, currency,
    krw: toKRW(amount, currency, rate, fee, method),
    rate, fee,
    cat: CAT_KEYS.includes(input.cat) ? input.cat : 'etc',
    payer: PAYER_KEYS.includes(input.payer) ? input.payer : 'joint',
    method,
    memo: String(input.memo || '').trim().slice(0, 200),
    device: String(env.device || ''),
    createdAt: now, updatedAt: now,
    deleted: false,
    personal: !!input.personal,
    prepaid: !!input.prepaid,
    ...(input.bookingId ? { bookingId: String(input.bookingId) } : {}),
  };
}

// 고치기: 환율·수수료는 처음 입력한 값 그대로 (나중에 환율을 바꿔도 과거 금액이 변하지 않게)
export function editExpense(old, input, now = Date.now()) {
  const next = makeExpense({ ...input, id: old.id, prepaid: old.prepaid, bookingId: old.bookingId },
    { rate: old.rate || input.rate, fee: old.fee, device: old.device, now });
  return { ...next, createdAt: old.createdAt, updatedAt: Math.max(now, (old.updatedAt || 0) + 1) };
}

export const usdOf = (e) => (e.currency === 'USD' ? e.amount : (e.rate > 0 ? e.krw / e.rate : 0));

// 합계: 전체(사전결제 포함) / 현지 지출 / 오늘 / 분류별 / 날짜별
export function summarize(list, today) {
  const out = { all: 0, prepaid: 0, trip: 0, tripUsd: 0, today: 0, todayUsd: 0, byCat: {}, byDate: {}, count: 0 };
  for (const e of list) {
    if (e.deleted) continue;
    out.all += e.krw;
    if (e.prepaid) { out.prepaid += e.krw; continue; }
    out.count++;
    out.trip += e.krw;
    out.tripUsd += usdOf(e);
    out.byCat[e.cat] = (out.byCat[e.cat] || 0) + e.krw;
    out.byDate[e.date] = (out.byDate[e.date] || 0) + e.krw;
    if (e.date === today) { out.today += e.krw; out.todayUsd += usdOf(e); }
  }
  out.tripUsd = round2(out.tripUsd);
  out.todayUsd = round2(out.todayUsd);
  return out;
}

/**
 * 정산: 함께 쓴 돈은 반반. 각자 낸 금액의 차이의 절반을 덜 낸 사람이 더 낸 사람에게 보낸다.
 * '공동'으로 낸 돈과 '개인 지출'로 표시한 돈은 정산에 영향을 주지 않는다.
 */
export function settle(list) {
  const paid = { woohak: 0, seonghee: 0, joint: 0 };
  const personal = { woohak: 0, seonghee: 0 };
  for (const e of list) {
    if (e.deleted) continue;
    if (e.personal) { if (e.payer in personal) personal[e.payer] += e.krw; continue; }
    if (e.payer in paid) paid[e.payer] += e.krw;
  }
  const diff = paid.woohak - paid.seonghee;
  const amount = Math.round(Math.abs(diff) / 2);
  const transfer = amount >= 1
    ? (diff > 0 ? { from: 'seonghee', to: 'woohak', amount } : { from: 'woohak', to: 'seonghee', amount })
    : null;
  return { paid, personal, shared: paid.woohak + paid.seonghee + paid.joint, transfer };
}

// 두 폰의 기록 합치기: id 가 같으면 나중에 고친 쪽(updatedAt)이 이긴다. 삭제도 같은 방식으로 전달된다.
export function mergeExpenses(local, incoming) {
  const map = new Map(local.map((e) => [e.id, e]));
  const changed = [];
  let added = 0;
  let updated = 0;
  let same = 0;
  for (const e of incoming) {
    const cur = map.get(e.id);
    if (!cur) { map.set(e.id, e); changed.push(e); added++; }
    else if ((e.updatedAt || 0) > (cur.updatedAt || 0)) { map.set(e.id, e); changed.push(e); updated++; }
    else same++;
  }
  return { merged: [...map.values()], changed, added, updated, same };
}

// 밖에서 들어온 기록은 믿지 않는다: 형식을 확인하고 필요한 값만 남긴다
export function sanitizeExpense(o) {
  if (!o || typeof o !== 'object') return null;
  const id = String(o.id == null ? '' : o.id);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  const date = String(o.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const amount = Number(o.amount);
  const krw = Number(o.krw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) return null;
  if (!Number.isFinite(krw) || krw < 0 || krw > 1e11) return null;
  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  const e = {
    id, date, amount: round2(amount),
    currency: o.currency === 'KRW' ? 'KRW' : 'USD',
    krw: Math.round(krw), rate: num(o.rate), fee: num(o.fee),
    cat: CAT_KEYS.includes(o.cat) ? o.cat : 'etc',
    payer: PAYER_KEYS.includes(o.payer) ? o.payer : 'joint',
    method: METHOD_KEYS.includes(o.method) ? o.method : 'card',
    memo: String(o.memo == null ? '' : o.memo).slice(0, 200),
    device: String(o.device == null ? '' : o.device).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16),
    createdAt: int(o.createdAt), updatedAt: int(o.updatedAt),
    deleted: !!o.deleted, personal: !!o.personal, prepaid: !!o.prepaid,
  };
  if (o.bookingId && /^[a-z0-9-]{1,40}$/.test(String(o.bookingId))) e.bookingId = String(o.bookingId);
  return e;
}

const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

// 지출 목록 → 짧은 코드 (QR·붙여넣기용). 배열로 줄여 담는다.
export function encodeShare(list, meta = {}) {
  const rows = list.map((e) => [
    e.id, e.date, e.amount, e.currency === 'KRW' ? 1 : 0, e.krw,
    CAT_KEYS.indexOf(e.cat), PAYER_KEYS.indexOf(e.payer), METHOD_KEYS.indexOf(e.method),
    e.memo || '', e.device || '', e.createdAt || 0, e.updatedAt || 0,
    (e.deleted ? 1 : 0) | (e.personal ? 2 : 0) | (e.prepaid ? 4 : 0),
    e.rate || 0, e.fee || 0, e.bookingId || 0,
  ]);
  const payload = { v: 1, f: meta.device || '', o: meta.owner || '', t: meta.at || Date.now(), x: rows };
  return SHARE_PREFIX + b64url(new TextEncoder().encode(JSON.stringify(payload)));
}

// 코드(또는 코드가 든 주소) → { from, owner, at, expenses }
export function decodeShare(input) {
  let code = String(input || '').trim();
  const m = /[?&#]d=([A-Za-z0-9._-]+)/.exec(code);
  if (m) code = m[1];
  if (!code.startsWith(SHARE_PREFIX)) throw new Error('가져올 수 없는 형식이에요. 코드를 처음부터 끝까지 복사했는지 확인해 주세요.');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(code.slice(SHARE_PREFIX.length))));
  } catch {
    throw new Error('코드가 깨졌어요. 다시 받아 주세요.');
  }
  if (!payload || payload.v !== 1 || !Array.isArray(payload.x) || payload.x.length > MAX_IMPORT) throw new Error('가져올 수 없는 형식이에요.');
  const expenses = [];
  for (const r of payload.x) {
    if (!Array.isArray(r)) throw new Error('가져올 수 없는 형식이에요.');
    const flags = Number(r[12]) || 0;
    const e = sanitizeExpense({
      id: r[0], date: r[1], amount: r[2], currency: r[3] === 1 ? 'KRW' : 'USD', krw: r[4],
      cat: CAT_KEYS[r[5]], payer: PAYER_KEYS[r[6]], method: METHOD_KEYS[r[7]],
      memo: r[8], device: r[9], createdAt: r[10], updatedAt: r[11],
      deleted: !!(flags & 1), personal: !!(flags & 2), prepaid: !!(flags & 4),
      rate: r[13], fee: r[14], bookingId: r[15] || undefined,
    });
    if (!e) throw new Error('코드 안에 올바르지 않은 기록이 있어요.');
    expenses.push(e);
  }
  return {
    from: String(payload.f || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16),
    owner: PAYER_KEYS.includes(payload.o) ? payload.o : '',
    at: Number(payload.t) || 0,
    expenses,
  };
}

// 붙여넣은 글·파일 내용 → 지출 목록 (코드, 주소, 내보낸 JSON, 백업 파일 모두 받는다)
export function parseImportText(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('내용이 비어 있어요.');
  if (t.startsWith('{')) {
    let doc;
    try { doc = JSON.parse(t); } catch { throw new Error('파일을 읽을 수 없어요.'); }
    if (doc && typeof doc.code === 'string') return decodeShare(doc.code);
    if (!doc || doc.app !== 'alohatrip' || !Array.isArray(doc.expenses) || doc.expenses.length > MAX_IMPORT) throw new Error('Aloha Trip 에서 내보낸 파일이 아니에요.');
    const expenses = doc.expenses.map(sanitizeExpense);
    if (expenses.some((e) => !e)) throw new Error('파일 안에 올바르지 않은 기록이 있어요.');
    return { from: String(doc.device || ''), owner: '', at: Number(doc.exportedAt) || 0, expenses };
  }
  return decodeShare(t);
}

export function tipCalc(amount, pct, people = 2) {
  const a = Number(amount) || 0;
  const tip = round2(a * (Number(pct) || 0) / 100);
  const total = round2(a + tip);
  return { tip, total, each: round2(total / Math.max(1, people)) };
}

// ───────────────────────────── 저장소 ─────────────────────────────
export const listExpenses = () => db.getAll('expenses');

export function expenseDate(nowMs = time.now()) {
  const info = getTrip().trip;
  const p = time.tripPhase(info, nowMs);
  return p.phase === 'during' ? p.date : time.zoned(nowMs, info.home_tz).date;
}

export async function todaySummary() {
  return summarize(await listExpenses(), expenseDate());
}

async function importExpenses(parsed) {
  const local = await listExpenses();
  const r = mergeExpenses(local, parsed.expenses);
  if (r.changed.length) await db.bulkPut('expenses', r.changed);
  return r;
}

// ───────────────────────────── 화면 ─────────────────────────────
function pickHtml(name, options, value) {
  return html`<div class="pick">${Object.entries(options).map(([k, label]) => html`
    <label class="pick-item"><input type="radio" name="${name}" value="${k}" ${k === value ? 'checked' : ''}><span>${label}</span></label>`)}</div>`;
}

function openExpenseSheet(existing, ctx, preset = {}) {
  const p = prefs();
  const e = existing || {};
  const sheet = openSheet(html`
    <form data-form="expense" autocomplete="off" novalidate>
      <div class="amount-row">
        <input name="amount" type="text" inputmode="decimal" enterkeyhint="done" placeholder="0" aria-label="금액"
               value="${e.amount != null ? e.amount : (preset.amount != null ? preset.amount : '')}" autofocus>
        ${pickHtml('currency', { USD: '$ 달러', KRW: '₩ 원' }, e.currency || 'USD')}
      </div>
      <p class="muted amount-krw" aria-live="polite"></p>
      <fieldset class="field-group"><legend>분류</legend>
        ${pickHtml('cat', Object.fromEntries(CAT_KEYS.map((k) => [k, `${CAT_ICONS[k]} ${CATS[k]}`])), e.cat || preset.cat || 'food')}</fieldset>
      <fieldset class="field-group"><legend>누가 냈나요</legend>${pickHtml('payer', PAYERS, e.payer || p.owner || 'joint')}</fieldset>
      <fieldset class="field-group"><legend>결제</legend>${pickHtml('method', METHODS, e.method || 'card')}</fieldset>
      <label class="field"><span>메모</span><input name="memo" type="text" maxlength="100" value="${e.memo || preset.memo || ''}" placeholder="예: 마루카메 우동"></label>
      <label class="field"><span>날짜</span><input name="date" type="date" value="${e.date || expenseDate()}" required></label>
      <label class="check-inline"><input type="checkbox" name="personal" ${e.personal ? 'checked' : ''}> 개인 지출 (정산에서 제외)</label>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        ${existing ? html`<button type="button" class="btn btn-danger" data-action="delete">삭제</button>` : ''}
        <button type="submit" class="btn btn-primary">${existing ? '고치기' : '저장'}</button>
      </div>
      ${existing && existing.rate ? html`<p class="muted small">입력한 날의 환율 ${fmtKRW(existing.rate)} / $1${existing.fee ? ` · 수수료 ${existing.fee}%` : ''} 로 계산돼요.</p>` : ''}
    </form>`, { title: existing ? '지출 고치기' : '지출 추가' });

  const form = sheet.body.querySelector('form');
  const preview = sheet.body.querySelector('.amount-krw');
  const err = sheet.body.querySelector('.form-error');
  const read = () => {
    const fd = new FormData(form);
    return {
      amount: String(fd.get('amount') || '').replace(/[^\d.]/g, ''), currency: fd.get('currency'), cat: fd.get('cat'),
      payer: fd.get('payer'), method: fd.get('method'), memo: fd.get('memo'), date: fd.get('date'), personal: fd.get('personal') === 'on',
    };
  };
  const updatePreview = () => {
    const v = read();
    const a = Number(v.amount) || 0;
    if (v.currency === 'KRW') { preview.textContent = a ? `${fmtKRW(a)} (환산 없음)` : ''; return; }
    const rate = existing && existing.rate ? existing.rate : p.rate;
    const fee = existing ? existing.fee : p.fee;
    preview.textContent = a ? `≈ ${fmtKRW(toKRW(a, 'USD', rate, fee, v.method))} (환율 ${fmtKRW(rate)}${v.method === 'card' && fee ? ` + 수수료 ${fee}%` : ''})` : `1달러 = ${fmtKRW(rate)}`;
  };
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  updatePreview();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const v = read();
      const record = existing
        ? editExpense(existing, { ...v, rate: p.rate })
        : makeExpense(v, { rate: p.rate, fee: p.fee, device: p.deviceId });
      await db.put('expenses', record);
      sheet.close();
      toast(existing ? '고쳤어요' : '저장했어요');
      ctx.rerender();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });
  sheet.body.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-action="delete"]')) return;
    // 지우지 않고 '삭제됨'으로 표시해야 상대 폰에도 삭제가 전달된다
    await db.put('expenses', { ...existing, deleted: true, updatedAt: Math.max(Date.now(), (existing.updatedAt || 0) + 1) });
    sheet.close();
    toast('삭제했어요');
    ctx.rerender();
  });
  return sheet;
}

function openTipSheet(ctx) {
  const sheet = openSheet(html`
    <div class="tip">
      <label class="field"><span>음식값 (세금 전·달러)</span>
        <input type="text" inputmode="decimal" data-tip="amount" placeholder="0" autofocus></label>
      <div class="pick" role="group" aria-label="팁 비율">
        ${[18, 20, 22].map((n) => html`<label class="pick-item"><input type="radio" name="tip-pct" value="${n}" ${n === 20 ? 'checked' : ''}><span>${n}%</span></label>`)}
      </div>
      <dl class="tip-out">
        <div><dt>팁</dt><dd data-out="tip">$0</dd></div>
        <div><dt>합계</dt><dd data-out="total">$0</dd></div>
        <div><dt>1인당</dt><dd data-out="each">$0</dd></div>
        <div><dt>원화로</dt><dd data-out="krw">₩0</dd></div>
      </dl>
      <p class="muted small">계산서에 'gratuity' 나 'service charge' 가 이미 있으면 팁이 포함된 거예요.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="tip-add">이 합계로 지출 추가</button>
    </div>`, { title: '팁 계산기' });
  const calc = () => {
    const amount = Number(String(sheet.body.querySelector('[data-tip="amount"]').value).replace(/[^\d.]/g, '')) || 0;
    const pct = Number(sheet.body.querySelector('input[name="tip-pct"]:checked').value);
    const r = tipCalc(amount, pct, 2);
    const set = (k, v) => { sheet.body.querySelector(`[data-out="${k}"]`).textContent = v; };
    set('tip', fmtUSD(r.tip));
    set('total', fmtUSD(r.total));
    set('each', fmtUSD(r.each));
    set('krw', fmtKRW(toKRW(r.total, 'USD', prefs().rate, prefs().fee, 'card')));
    return r;
  };
  sheet.body.addEventListener('input', calc);
  sheet.body.addEventListener('change', calc);
  sheet.body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-action="tip-add"]')) return;
    const r = calc();
    sheet.close();
    openExpenseSheet(null, ctx, { amount: r.total || '', cat: 'food' });
  });
}

function shareUrl(code) {
  return `${location.origin}${location.pathname}#/import?d=${code}`;
}

async function openShareSheet(ctx) {
  const p = prefs();
  const all = await listExpenses();
  const fresh = all.filter((e) => (e.updatedAt || 0) > (p.lastSharedAt || 0));
  let scope = fresh.length ? 'new' : 'all';

  const sheet = openSheet(html`<div class="share"></div>`, { title: '내 경비 보내기' });
  const box = sheet.body.querySelector('.share');

  const draw = () => {
    const list = scope === 'new' ? fresh : all;
    const code = encodeShare(list, { device: p.deviceId, owner: p.owner });
    const url = shareUrl(code);
    let qr = '';
    if (list.length && url.length <= QR_MAX_URL) {
      const q = qrcode(0, 'L');
      q.addData(url);
      q.make();
      qr = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    }
    setHTML(box, html`
      <div class="pick" role="group" aria-label="보낼 범위">
        <label class="pick-item"><input type="radio" name="scope" value="new" ${scope === 'new' ? 'checked' : ''} ${fresh.length ? '' : 'disabled'}><span>새로 바뀐 것 ${fresh.length}건</span></label>
        <label class="pick-item"><input type="radio" name="scope" value="all" ${scope === 'all' ? 'checked' : ''}><span>전체 ${all.length}건</span></label>
      </div>
      ${!list.length ? html`<p class="muted">보낼 기록이 없어요.</p>` : html`
        ${qr ? html`
          <div class="qr" role="img" aria-label="경비 QR 코드">${raw(qr)}</div>
          <p class="muted small">상대 폰의 <b>기본 카메라</b>로 찍으면 앱이 열리면서 가져와요.</p>`
        : html`<p class="banner">QR 에 담기엔 기록이 많아요. 아래 '공유하기'나 '코드 복사'로 보내 주세요.</p>`}
        <div class="btn-row">
          ${navigator.share ? html`<button type="button" class="btn btn-primary" data-share="native">공유하기 (카톡 등)</button>` : ''}
          <button type="button" class="btn" data-share="copy">코드 복사</button>
          <button type="button" class="btn" data-share="file">파일로 저장</button>
        </div>
        <p class="muted small">아이폰 홈 화면 앱에서는 받은 코드를 복사해 경비 화면의 <b>받기 → 붙여넣기</b>로 넣어 주세요.</p>
        <button type="button" class="btn btn-block" data-share="done">상대가 받았어요 ✓</button>`}`);
    box.dataset.code = code;
  };
  draw();

  const markSent = async () => { await setPref('lastSharedAt', Date.now()); };
  box.addEventListener('change', (e) => {
    if (e.target.name === 'scope') { scope = e.target.value; draw(); }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    const code = box.dataset.code;
    const url = shareUrl(code);
    if (b.dataset.share === 'native') {
      try { await navigator.share({ title: 'Aloha Trip 경비', text: url }); await markSent(); } catch { /* 취소 */ }
    } else if (b.dataset.share === 'copy') {
      if (await copyText(url, '코드를 복사했어요. 카톡으로 보내 주세요.')) await markSent();
    } else if (b.dataset.share === 'file') {
      const list = scope === 'new' ? fresh : all;
      downloadFile(`aloha-expenses-${expenseDate()}.json`, JSON.stringify({ app: 'alohatrip', v: 1, kind: 'expenses', device: p.deviceId, exportedAt: Date.now(), expenses: list }, null, 1));
      await markSent();
    } else if (b.dataset.share === 'done') {
      await markSent();
      sheet.close();
      toast('보낸 것으로 표시했어요');
      ctx.rerender();
    }
  });
}

async function confirmAndImport(parsed, ctx) {
  const local = await listExpenses();
  const dry = mergeExpenses(local, parsed.expenses);
  if (!dry.changed.length) { toast('이미 모두 가져온 기록이에요'); return false; }
  const who = parsed.owner ? `${PAYERS[parsed.owner]} 폰에서 온 ` : '';
  const ok = await confirmSheet(`${who}경비 ${parsed.expenses.length}건 중 새 기록 ${dry.added}건, 바뀐 기록 ${dry.updated}건을 가져올까요?`, { ok: '가져오기', title: '경비 가져오기' });
  if (!ok) return false;
  const r = await importExpenses(parsed);
  toast(`가져왔어요 (새 ${r.added} · 바뀜 ${r.updated})`);
  if (ctx) ctx.rerender();
  return true;
}

function openReceiveSheet(ctx) {
  const sheet = openSheet(html`
    <div class="receive">
      <ol class="steps">
        <li>상대 폰에서 <b>경비 → 내 경비 보내기</b>를 열어요.</li>
        <li>QR 을 이 폰의 기본 카메라로 찍거나, 카톡으로 받은 코드를 복사해 아래에 붙여넣어요.</li>
      </ol>
      <label class="field"><span>받은 코드 붙여넣기</span>
        <textarea rows="4" data-in="code" placeholder="https://…#/import?d=j1.…" spellcheck="false" autocapitalize="off"></textarea></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="button" class="btn" data-recv="paste">붙여넣기</button>
        <button type="button" class="btn" data-recv="file">파일에서 가져오기</button>
        <button type="button" class="btn btn-primary" data-recv="go">가져오기</button>
      </div>
    </div>`, { title: '경비 받기' });
  const ta = sheet.body.querySelector('[data-in="code"]');
  const err = sheet.body.querySelector('.form-error');
  const run = async (text) => {
    err.hidden = true;
    try {
      const parsed = parseImportText(text);
      if (await confirmAndImport(parsed, ctx)) sheet.close();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  };
  sheet.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-recv]');
    if (!b) return;
    if (b.dataset.recv === 'paste') {
      try { ta.value = await navigator.clipboard.readText(); } catch { toast('붙여넣기 권한이 없어요. 칸을 길게 눌러 붙여넣어 주세요.'); }
    } else if (b.dataset.recv === 'file') {
      const f = await pickFileText();
      if (f) await run(f.text);
    } else if (b.dataset.recv === 'go') {
      await run(ta.value);
    }
  });
}

async function importPrepaid(ctx) {
  const list = await listExpenses();
  const have = new Set(list.map((e) => e.id));
  const typeCat = { hotel: 'hotel', tour: 'tour', flight: 'transport', car: 'transport', food: 'food' };
  const add = wallet.prepaidList().filter((b) => !have.has(`prepaid-${b.id}`)).map((b) => makeExpense({
    id: `prepaid-${b.id}`, amount: b.amount, currency: b.currency, cat: typeCat[b.type] || 'etc', payer: 'joint', method: 'card',
    memo: `사전 결제 · ${b.title}`, date: b.date || getTrip().trip.start, prepaid: true, bookingId: b.id,
  }, { rate: prefs().rate, fee: 0, device: prefs().deviceId }));
  if (!add.length) { toast('가져올 사전 결제가 없어요'); return; }
  await db.bulkPut('expenses', add);
  toast(`사전 결제 ${add.length}건을 넣었어요`);
  ctx.rerender();
}

export async function render(root, ctx) {
  await wallet.initWallet();
  const p = prefs();
  const all = await listExpenses();
  const live = all.filter((e) => !e.deleted);
  const today = expenseDate();
  const sum = summarize(all, today);
  const st = settle(all);
  const cats = CAT_KEYS.map((k) => [k, sum.byCat[k] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const dates = [...new Set(live.map((e) => e.date))].sort().reverse();
  const have = new Set(all.map((e) => e.id));
  const prepaidNew = wallet.prepaidList().filter((b) => !have.has(`prepaid-${b.id}`)).length;
  const fresh = all.filter((e) => (e.updatedAt || 0) > (p.lastSharedAt || 0)).length;

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> 💰 경비</h1>
    <section class="card money-summary">
      <p class="money-total">총 ${fmtKRW(sum.all)}${sum.prepaid ? html` <span class="muted small">(사전 결제 ${fmtKRW(sum.prepaid)} 포함)</span>` : ''}</p>
      <dl class="money-grid">
        <div><dt>오늘 ${time.fmtMD(today)}</dt><dd>${fmtUSD(sum.todayUsd)}<small>${fmtKRW(sum.today)}</small></dd></div>
        <div><dt>현지 지출</dt><dd>${fmtUSD(sum.tripUsd)}<small>${fmtKRW(sum.trip)}</small></dd></div>
      </dl>
      <button type="button" class="btn btn-primary btn-block" data-action="add">+ 지출 추가</button>
      <p class="muted small">환율 1달러 = ${fmtKRW(p.rate)}${p.fee ? ` · 카드 수수료 ${p.fee}%` : ''} · <a href="#/settings">바꾸기</a></p>
    </section>

    ${cats.length ? html`
      <section class="card">
        <h2>분류별 (현지 지출)</h2>
        <ul class="bars">${cats.map(([k, v]) => html`
          <li><span class="bar-label">${CAT_ICONS[k]} ${CATS[k]}</span>
              <span class="bar"><span class="bar-fill" data-pct="${Math.round((v / sum.trip) * 100)}"></span></span>
              <span class="bar-value">${Math.round((v / sum.trip) * 100)}% · ${fmtKRW(v)}</span></li>`)}</ul>
      </section>` : ''}

    <section class="card">
      <h2>정산</h2>
      ${st.transfer
    ? html`<p class="settle"><b>${PAYERS[st.transfer.from]}</b> → <b>${PAYERS[st.transfer.to]}</b> <span class="settle-amount">${fmtKRW(st.transfer.amount)}</span></p>`
    : html`<p class="settle">정산할 금액이 없어요 👍</p>`}
      <p class="muted small">우학 결제 ${fmtKRW(st.paid.woohak)} · 성희 결제 ${fmtKRW(st.paid.seonghee)} · 공동 ${fmtKRW(st.paid.joint)}
      ${st.personal.woohak || st.personal.seonghee ? html`<br>개인 지출(정산 제외): 우학 ${fmtKRW(st.personal.woohak)} · 성희 ${fmtKRW(st.personal.seonghee)}` : ''}</p>
      <p class="muted small">함께 쓴 돈은 반반으로 보고, 더 낸 사람이 차액의 절반을 받아요.</p>
    </section>

    <section class="card">
      <h2>두 폰 맞추기</h2>
      <div class="btn-row">
        <button type="button" class="btn" data-action="share">내 경비 보내기${fresh ? html` <span class="count">${fresh}</span>` : ''}</button>
        <button type="button" class="btn" data-action="receive">받기</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn" data-action="tip">🧮 팁 계산기</button>
        ${prepaidNew ? html`<button type="button" class="btn" data-action="prepaid">사전 결제 ${prepaidNew}건 넣기</button>` : ''}
      </div>
    </section>

    <h2 class="section-title">내역 ${live.length}건</h2>
    ${!live.length ? html`<p class="muted empty">아직 기록이 없어요. '+ 지출 추가'로 시작해 보세요.</p>` : ''}
    ${dates.map((d) => {
    const rows = live.filter((e) => e.date === d).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const total = rows.reduce((n, e) => n + e.krw, 0);
    return html`
      <section class="card expense-day">
        <h3>${time.fmtDate(d)} <span class="muted">${fmtKRW(total)}</span></h3>
        <ul class="expense-list">${rows.map((e) => html`
          <li><button type="button" class="expense" data-expense="${e.id}">
            <span class="expense-icon" aria-hidden="true">${CAT_ICONS[e.cat]}</span>
            <span class="expense-body">
              <span class="expense-title">${e.memo || CATS[e.cat]}</span>
              <span class="expense-meta">${CATS[e.cat]} · ${PAYERS[e.payer]} · ${METHODS[e.method]}${e.personal ? ' · 개인' : ''}${e.prepaid ? ' · 사전 결제' : ''}</span>
            </span>
            <span class="expense-amount">${fmtMoney(e.amount, e.currency)}${e.currency === 'USD' ? html`<small>${fmtKRW(e.krw)}</small>` : ''}</span>
          </button></li>`)}</ul>
      </section>`;
  })}`);

  root.querySelectorAll('.bar-fill').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });

  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-expense]');
    if (row) { openExpenseSheet(live.find((x) => x.id === row.dataset.expense), ctx); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'add') openExpenseSheet(null, ctx);
    if (a.dataset.action === 'tip') openTipSheet(ctx);
    if (a.dataset.action === 'share') openShareSheet(ctx);
    if (a.dataset.action === 'receive') openReceiveSheet(ctx);
    if (a.dataset.action === 'prepaid') importPrepaid(ctx);
  });

  if (ctx.query && ctx.query.add === '1') openExpenseSheet(null, ctx);
}

// #/import?d=코드 — QR 을 찍거나 받은 주소를 열었을 때
export async function renderImport(root, ctx) {
  const code = ctx.query && ctx.query.d;
  let parsed = null;
  let error = '';
  try { parsed = decodeShare(code || ''); } catch (e) { error = e.message; }
  let dry = null;
  if (parsed) dry = mergeExpenses(await listExpenses(), parsed.expenses);

  setHTML(root, html`
    <h1 class="page-title">📥 경비 가져오기</h1>
    ${error ? html`<div class="card"><p class="form-error">${error}</p><a class="btn btn-block" href="#/money">경비 화면으로</a></div>` : html`
      <section class="card">
        <p>${parsed.owner ? html`<b>${PAYERS[parsed.owner]}</b> 폰에서 보낸 ` : ''}경비 <b>${parsed.expenses.length}건</b></p>
        <p class="muted">새 기록 ${dry.added}건 · 바뀐 기록 ${dry.updated}건 · 이미 있는 기록 ${dry.same}건</p>
        <div class="btn-row">
          <a class="btn" href="#/money">취소</a>
          <button type="button" class="btn btn-primary" data-action="import" ${dry.changed.length ? '' : 'disabled'}>${dry.changed.length ? '가져오기' : '가져올 것이 없어요'}</button>
        </div>
      </section>
      <section class="card">
        <p class="muted small">홈 화면에 설치한 앱이 아니라 브라우저에서 열렸나요? 아이폰은 둘의 저장 공간이 달라요.
        그럴 땐 아래 코드를 복사해 앱의 <b>경비 → 받기</b>에 붙여넣어 주세요.</p>
        <button type="button" class="btn btn-block" data-action="copy-code">코드 복사</button>
      </section>`}`);

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'copy-code') copyText(shareUrl(code), '코드를 복사했어요');
    if (a.dataset.action === 'import') {
      const r = await importExpenses(parsed);
      toast(`가져왔어요 (새 ${r.added} · 바뀜 ${r.updated})`);
      ctx.navigate('#/money', true);
    }
  });
}
