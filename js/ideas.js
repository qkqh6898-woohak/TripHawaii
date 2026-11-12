// 추천 코스 — 확정 일정이 아니라 '넣어 볼 만한 것'과 날짜별 알림(추수감사절·분출 예보 등)
import { html, setHTML, haptic } from './util.js';
import { prefs, setPref } from './prefs.js';
import { searchUrl } from './videos.js';
import * as time from './time.js';

let doc = null;
const GROUPS = [['bigisland', '빅아일랜드 (11/19~25)'], ['oahu', '오아후 (11/15~19 · 11/25~27)']];

export async function loadIdeas() {
  if (doc) return doc;
  try {
    const res = await fetch('data/ideas.json', { cache: 'no-cache' });
    doc = res.ok ? await res.json() : { notices: [], ideas: [], already: [] };
  } catch {
    doc = { notices: [], ideas: [], already: [] };
  }
  return doc;
}

export async function noticesForDate(date) {
  return ((await loadIdeas()).notices || []).filter((n) => (n.dates || []).includes(date));
}
export async function ideasForDate(date) {
  return ((await loadIdeas()).ideas || []).filter((i) => (i.dates || []).includes(date));
}

const mapsUrl = (p) => `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: `${p.name_en}, ${p.addr}` }).toString()}`;
const safeLink = (l) => (l && /^https:\/\//.test(l.url || '') ? l : null);

export function noticeHtml(n) {
  const l = safeLink(n.link);
  return html`
    <div class="notice">
      <p class="notice-title">${n.icon || '📌'} ${n.title}</p>
      <p class="notice-text">${n.text}</p>
      ${l ? html`<a class="link-btn" href="${l.url}" target="_blank" rel="noopener noreferrer">${l.label} ›</a>` : ''}
    </div>`;
}

export function ideaHtml(i, { compact = false } = {}) {
  const fav = (prefs().ideaFav || []).includes(i.id);
  const l = safeLink(i.link);
  const places = [i.place, i.place2].filter(Boolean);
  return html`
    <article class="idea ${fav ? 'is-fav' : ''}" data-idea="${i.id}">
      <header class="idea-head">
        <h3>${i.icon || '✨'} ${i.title}</h3>
        <button type="button" class="btn btn-fav ${fav ? 'is-on' : ''}" data-idea-fav aria-pressed="${fav ? 'true' : 'false'}" aria-label="관심 표시">${fav ? '★' : '☆'}</button>
      </header>
      <p class="idea-why">${i.why}</p>
      ${compact ? '' : html`<p class="idea-how">${i.how}</p>`}
      <p class="idea-when">${(i.dates || []).length
    ? html`넣기 좋은 날: ${i.dates.map((d) => html`<a class="tag tag-date" href="#/day/${d}">${time.fmtDate(d)}</a>`)}`
    : html`<span class="tag tag-tentative">지금 일정에는 맞는 날이 없어요</span>`}</p>
      ${compact ? html`<a class="link-btn" href="#/ideas">자세히 ›</a>` : html`
        <div class="btn-row">
          ${places.map((p) => html`<a class="btn btn-small" href="${mapsUrl(p)}" target="_blank" rel="noopener noreferrer">📍 ${p.name}</a>`)}
          ${i.q ? html`<a class="btn btn-small" href="${searchUrl(i.q)}" target="_blank" rel="noopener noreferrer">📺 영상 찾기</a>` : ''}
          ${l ? html`<a class="btn btn-small" href="${l.url}" target="_blank" rel="noopener noreferrer">🔗 ${l.label}</a>` : ''}
        </div>`}
    </article>`;
}

// ☆ 관심 표시 (이 폰에 저장)
export function bindIdeas(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-idea-fav]');
    if (!b) return;
    const id = b.closest('[data-idea]').dataset.idea;
    const cur = prefs().ideaFav || [];
    const on = !cur.includes(id);
    await setPref('ideaFav', on ? [...cur, id] : cur.filter((x) => x !== id));
    haptic();
    b.classList.toggle('is-on', on);
    b.textContent = on ? '★' : '☆';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.closest('[data-idea]').classList.toggle('is-fav', on);
  });
}

export async function render(root) {
  const d = await loadIdeas();
  const favs = prefs().ideaFav || [];
  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> ✨ 추천 코스</h1>
    <p class="banner">확정 일정이 아니라 <b>넣어 볼 만한 것</b>이에요. 마음에 드는 것에 ☆ 를 눌러 두고, 넣고 싶으면 Claude 에게 “○○를 11/22에 넣어줘”라고 말하면 일정에 들어가요.${favs.length ? html` <b>(관심 ${favs.length}개)</b>` : ''}</p>

    <h2 class="section-title">⚠️ 꼭 알아 둘 것</h2>
    ${(d.notices || []).map((n) => html`<section class="card">${noticeHtml(n)}</section>`)}

    ${GROUPS.map(([g, label]) => {
    const list = (d.ideas || []).filter((i) => i.island === g);
    if (!list.length) return '';
    return html`<h2 class="section-title">${label}</h2>${list.map((i) => html`<section class="card">${ideaHtml(i)}</section>`)}`;
  })}

    ${(d.already || []).length ? html`
      <h2 class="section-title">이미 일정에 있어요 ✓</h2>
      <ul class="card plain-list">${d.already.map((a) => html`<li><a href="#/day/${a.date}"><b>${time.fmtDate(a.date)}</b>&nbsp; ${a.title}</a></li>`)}</ul>` : ''}
    <p class="muted small">영업 시간·예약·통제 여부는 바뀔 수 있어요. 가기 전에 한 번 더 확인하세요. (정리한 날: ${d.updated || ''})</p>`);
  bindIdeas(root);
}
