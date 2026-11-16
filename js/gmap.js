// 구글 지도 연결 — 앱 안에 바로 띄우는 지도(인터넷 필요), 맛집 목록, '내 지도'용 CSV
// 지도 띄우기는 API 키가 필요 없는 퍼가기 주소를 쓴다 (누를 때만 불러와 데이터를 아낀다).
import { html, toast } from './util.js';

export const embedUrl = (query) => `https://maps.google.com/maps?${new URLSearchParams({ q: query, z: '16', hl: 'ko', output: 'embed' }).toString()}`;
export const searchUrl = (query) => `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query }).toString()}`;
export const dirUrl = (query) => `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: query }).toString()}`;

// '🗺 여기서 지도 보기' 버튼 — 누르면 그 자리에 구글 지도가 열린다
export function embedButtonHtml(query, title) {
  return html`<div class="map-embed" data-embed-box><button type="button" class="btn btn-small" data-embed="${query}" data-embed-title="${title || '구글 지도'}">🗺 여기서 지도 보기</button></div>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-embed]');
    if (!b) return;
    if (navigator.onLine === false) { toast('구글 지도는 인터넷이 될 때 보여요'); return; }
    const box = b.closest('[data-embed-box]');
    const frame = document.createElement('iframe');
    frame.src = embedUrl(b.dataset.embed);
    frame.title = b.dataset.embedTitle || '구글 지도';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.setAttribute('allowfullscreen', '');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-small';
    close.textContent = '지도 닫기';
    close.addEventListener('click', () => { box.replaceChildren(b); });
    box.replaceChildren(frame, close);
  });
}

// ───────────── 맛집 (data/eats.json) ─────────────
let eatsDoc = null;
export async function loadEats() {
  if (eatsDoc) return eatsDoc;
  try {
    const res = await fetch('data/eats.json', { cache: 'no-cache' });
    eatsDoc = res.ok ? await res.json() : { categories: [], places: [], areas: {} };
  } catch {
    eatsDoc = { categories: [], places: [], areas: {} };
  }
  return eatsDoc;
}
export const eatQuery = (p) => p.q || [p.name_en || p.name, p.addr || 'Honolulu, HI'].join(', ');

// 구글 '내 지도'(My Maps)에 가져오는 CSV — '위치' 열의 주소·이름으로 구글이 핀을 찍는다 (좌표 필요 없음)
const cell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function eatsCsv(doc) {
  const catOf = Object.fromEntries((doc.categories || []).map((c) => [c.id, c.title]));
  const rows = [['이름', '위치', '종류', '지역', '메모']];
  for (const p of doc.places || []) {
    rows.push([p.name, eatQuery(p), catOf[p.cat] || '', (doc.areas || {})[p.area] || '', [p.note, p.plan].filter(Boolean).join(' · ')]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
