// 체크리스트 — 출발 전 / 매일 / 날짜별 준비물 / 귀국 전 / 반입 금지 음식
// 체크 상태는 이 폰(IndexedDB checks)에 저장한다.
import * as db from './db.js';
import { html, setHTML, hashStr, toast, confirmSheet } from './util.js';
import { getTrip, dayByDate } from './trip.js';
import { prefs, ownerName } from './prefs.js';
import * as time from './time.js';

let doc = null;

export async function loadChecklists() {
  if (doc) return doc;
  const res = await fetch('data/checklists.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('체크리스트를 불러오지 못했어요');
  doc = await res.json();
  return doc;
}

export const packId = (date, text) => `pack:${date}:${hashStr(text)}`;
export const dailyId = (date, itemId) => `daily:${date}:${itemId}`;

export async function getChecks() {
  const rows = await db.getAll('checks');
  return new Map(rows.map((r) => [r.id, r]));
}

export async function setCheck(id, done) {
  await db.put('checks', { id, done: !!done, by: prefs().owner || null, updatedAt: Date.now() });
}

// 그날 준비물(일정에 적힌 것) + 체크 여부
export function packingItems(day, checks) {
  return (day.packing || []).map((text) => {
    const id = packId(day.date, text);
    return { id, text, done: !!(checks.get(id) && checks.get(id).done) };
  });
}

// 출발 전 그룹 전체 진행률
export async function progressBefore() {
  const d = await loadChecklists();
  const checks = await getChecks();
  let done = 0;
  let total = 0;
  for (const g of d.groups) {
    if (g.when !== 'before') continue;
    for (const it of g.items) {
      total++;
      if (checks.get(it.id) && checks.get(it.id).done) done++;
    }
  }
  return { done, total };
}

function ownerChip(owner) {
  if (!owner) return '';
  const label = owner === 'both' ? '공동' : ownerName(owner);
  return html`<span class="owner owner-${owner}">${label}</span>`;
}

function rowHtml(id, text, done, owner, url) {
  return html`
    <li class="check-row ${done ? 'is-done' : ''}">
      <label>
        <input type="checkbox" data-check="${id}" ${done ? 'checked' : ''}>
        <span class="check-text">${text}</span>
      </label>
      ${ownerChip(owner)}
      ${url && /^https:\/\//.test(url) ? html`<a class="check-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="관련 사이트 열기">🔗</a>` : ''}
    </li>`;
}

function progressHtml(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="진행률">
      <div class="progress-bar" data-pct="${pct}"></div>
    </div>
    <p class="muted small progress-text">${done}/${total} 완료 (${pct}%)</p>`;
}

function groupHtml(g, checks, who) {
  const items = g.items.filter((it) => who === 'all' || it.owner === who || it.owner === 'both' || !it.owner);
  if (!items.length) return '';
  const done = items.filter((it) => checks.get(it.id) && checks.get(it.id).done).length;
  return html`
    <section class="card check-group" data-group="${g.id}">
      <h2>${g.icon || ''} ${g.title}</h2>
      ${g.intro ? html`<p class="check-intro">${g.intro}</p>` : ''}
      ${progressHtml(done, items.length)}
      <ul class="check-list">
        ${items.map((it) => rowHtml(it.id, it.text, !!(checks.get(it.id) && checks.get(it.id).done), it.owner, it.url))}
      </ul>
      ${(g.links || []).length ? html`<p class="check-links">${g.links.map((l) => html`<a href="${l.url}" target="_blank" rel="noopener noreferrer">🔗 ${l.label}</a>`)}</p>` : ''}
    </section>`;
}

const TABS = [['before', '출발 전'], ['daily', '매일'], ['days', '날짜별'], ['return', '귀국 전']];

function defaultDate() {
  const info = getTrip().trip;
  const p = time.tripPhase(info);
  if (p.phase === 'during') return p.date;
  return p.phase === 'after' ? info.end : info.start;
}

export async function render(root, ctx) {
  const d = await loadChecklists();
  const checks = await getChecks();
  const trip = getTrip();
  const tab = (ctx.query && ctx.query.tab) || (time.tripPhase(trip.trip).phase === 'before' ? 'before' : 'daily');
  const who = (ctx.query && ctx.query.who) || 'all';
  const date = (ctx.query && ctx.query.d && dayByDate(ctx.query.d)) ? ctx.query.d : defaultDate();
  const q = (extra) => {
    const p = new URLSearchParams({ tab, who, ...(tab === 'daily' ? { d: date } : {}), ...extra });
    return `#/check?${p.toString()}`;
  };

  let body = '';
  if (tab === 'before' || tab === 'return') {
    body = d.groups.filter((g) => g.when === tab).map((g) => groupHtml(g, checks, who));
  } else if (tab === 'daily') {
    const day = dayByDate(date);
    const daily = d.groups.filter((g) => g.when === 'daily');
    const commonRows = daily.flatMap((g) => g.items.map((it) => {
      const id = dailyId(date, it.id);
      return rowHtml(id, it.text, !!(checks.get(id) && checks.get(id).done), null);
    }));
    const packs = packingItems(day, checks);
    const all = daily.reduce((n, g) => n + g.items.length, 0) + packs.length;
    const done = packs.filter((p) => p.done).length
      + daily.reduce((n, g) => n + g.items.filter((it) => checks.get(dailyId(date, it.id)) && checks.get(dailyId(date, it.id)).done).length, 0);
    body = html`
      <div class="chips chips-scroll" aria-label="날짜 선택">
        ${trip.days.map((x) => html`<a class="chip ${x.date === date ? 'is-on' : ''}" href="${q({ d: x.date })}">${time.fmtMD(x.date)}</a>`)}
      </div>
      <section class="card check-group">
        <h2>🎒 ${time.fmtDate(date)} 챙길 것</h2>
        <p class="muted">${day.title}</p>
        ${progressHtml(done, all)}
        ${packs.length ? html`<h3 class="check-sub">이날 준비물</h3><ul class="check-list">${packs.map((p) => rowHtml(p.id, p.text, p.done, null))}</ul>` : ''}
        <h3 class="check-sub">매일 공통</h3>
        <ul class="check-list">${commonRows}</ul>
      </section>`;
  } else {
    body = trip.days.map((day) => {
      const packs = packingItems(day, checks);
      if (!packs.length) return '';
      const done = packs.filter((p) => p.done).length;
      return html`
        <details class="card check-day" ${day.date === defaultDate() ? 'open' : ''}>
          <summary><b>${time.fmtDate(day.date)}</b> ${day.title} <span class="muted">${done}/${packs.length}</span></summary>
          <ul class="check-list">${packs.map((p) => rowHtml(p.id, p.text, p.done, null))}</ul>
        </details>`;
    });
  }

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> ✅ 체크리스트</h1>
    <nav class="seg" aria-label="체크리스트 종류">
      ${TABS.map(([id, label]) => html`<a class="seg-btn ${tab === id ? 'is-on' : ''}" href="#/check?tab=${id}&who=${who}" ${tab === id ? html`aria-current="page"` : ''}>${label}</a>`)}
    </nav>
    ${tab === 'before' || tab === 'return' ? html`
      <div class="chips" aria-label="담당 고르기">
        ${[['all', '전체'], ['woohak', '우학'], ['seonghee', '성희']].map(([id, label]) => html`<a class="chip ${who === id ? 'is-on' : ''}" href="${q({ who: id })}">${label}</a>`)}
      </div>` : ''}
    ${body}
    <div class="card">
      <button type="button" class="btn btn-block" data-action="reset">이 화면의 체크 모두 지우기</button>
    </div>`);

  root.querySelectorAll('.progress-bar').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });

  root.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-check]');
    if (!box) return;
    await setCheck(box.dataset.check, box.checked);
    box.closest('.check-row').classList.toggle('is-done', box.checked);
    const group = box.closest('.check-group, .check-day');
    if (group) {
      const boxes = group.querySelectorAll('[data-check]');
      const done = group.querySelectorAll('[data-check]:checked').length;
      const bar = group.querySelector('.progress-bar');
      const text = group.querySelector('.progress-text');
      const pct = boxes.length ? Math.round((done / boxes.length) * 100) : 0;
      if (bar) bar.style.width = `${pct}%`;
      if (text) text.textContent = `${done}/${boxes.length} 완료 (${pct}%)`;
      const count = group.querySelector('summary .muted');
      if (count) count.textContent = `${done}/${boxes.length}`;
    }
  });

  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="reset"]')) return;
    const ids = Array.from(root.querySelectorAll('[data-check]')).map((b) => b.dataset.check);
    if (!ids.length) return;
    const ok = await confirmSheet(`이 화면의 체크 ${ids.length}개를 모두 지울까요?`, { ok: '지우기', danger: true, title: '체크 지우기' });
    if (!ok) return;
    for (const id of ids) await db.del('checks', id);
    toast('체크를 지웠어요');
    ctx.rerender();
  });
}
