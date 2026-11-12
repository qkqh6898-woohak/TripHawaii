// 한국어 유튜브 영상 — 일정별로 미리 볼 영상과 유튜브 검색 바로가기 (인터넷이 될 때만 열림)
import { html, setHTML } from './util.js';
import * as time from './time.js';

let doc = null;
const GROUPS = [['oahu', '오아후'], ['bigisland', '빅아일랜드'], ['prep', '준비 · 전체']];

export async function loadVideos() {
  if (doc) return doc;
  try {
    const res = await fetch('data/videos.json', { cache: 'no-cache' });
    doc = res.ok ? await res.json() : { topics: [] };
  } catch {
    doc = { topics: [] };
  }
  return doc;
}

export const searchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
// 영상 id 는 11자(영문·숫자·-·_)만 허용한다
export const watchUrl = (v) => (/^[A-Za-z0-9_-]{11}$/.test(v) ? `https://www.youtube.com/watch?v=${v}` : null);

export async function topicsForDate(date) {
  const d = await loadVideos();
  return (d.topics || []).filter((t) => (t.dates || []).includes(date));
}

export function topicHtml(t, { compact = false } = {}) {
  const picks = (t.picks || []).filter((p) => watchUrl(p.v));
  return html`
    <div class="video-topic">
      ${compact ? '' : html`<h3>${t.icon || '📺'} ${t.title}${(t.dates || []).length ? html` <span class="muted small">${t.dates.map((x) => time.fmtMD(x)).join(' · ')}</span>` : ''}</h3>`}
      ${compact ? html`<p class="video-topic-name">${t.icon || '📺'} ${t.title}</p>` : ''}
      <ul class="video-list">
        ${picks.map((p) => html`<li><a class="video-link" href="${watchUrl(p.v)}" target="_blank" rel="noopener noreferrer"><span class="video-play" aria-hidden="true">▶</span><span>${p.title}</span></a></li>`)}
        <li><a class="video-link video-search" href="${searchUrl(t.q)}" target="_blank" rel="noopener noreferrer"><span class="video-play" aria-hidden="true">🔎</span><span>유튜브에서 더 찾아보기 — “${t.q}”</span></a></li>
      </ul>
    </div>`;
}

export async function render(root) {
  const d = await loadVideos();
  const topics = d.topics || [];
  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> 📺 하와이 영상</h1>
    <p class="banner">일정에 맞춰 찾아 둔 한국어 유튜브 영상이에요. 누르면 유튜브가 열리고, <b>인터넷이 필요해요</b> (출발 전 와이파이에서 보기 좋아요).</p>
    ${GROUPS.map(([g, label]) => {
    const list = topics.filter((t) => t.group === g);
    if (!list.length) return '';
    return html`<h2 class="section-title">${label}</h2>${list.map((t) => html`<section class="card">${topicHtml(t)}</section>`)}`;
  })}
    <p class="muted small">영상은 검색으로 찾은 것이라 내용을 하나하나 확인하지는 못했어요. 오래된 영상은 요금·예약 방법이 달라졌을 수 있으니 참고용으로 봐 주세요.</p>`);
}
