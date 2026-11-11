// 지도 — 미리 그려 둔 약도(오프라인) + 장소 목록·길찾기
import { html, setHTML } from './util.js';
import { getTrip, dayByDate, placesOfDay, hotel, place as getPlace, directionsUrl, CAT_LABEL, CAT_ICON } from './trip.js';
import * as time from './time.js';
import { openViewer } from './viewer.js';
import { bindItemClicks } from './ui.js';

const MAPS = {
  hawaii: { label: '하와이 전체', src: 'maps/overview-hawaii.png', alt: '하와이 전체 일정 지도' },
  oahu: { label: '오아후', src: 'maps/oahu.png', alt: '오아후 장소 지도', island: 'oahu' },
  bigisland: { label: '빅아일랜드', src: 'maps/big-island.png', alt: '빅아일랜드 장소 지도', island: 'bigisland' },
  day: { label: '날짜별' },
  korea: { label: '한국↔하와이', src: 'maps/korea-hawaii.png', alt: '한국과 하와이 이동 지도' },
};
const FILTERS = [['all', '전체'], ['hotel', '숙소'], ['sight', '관광'], ['shop', '쇼핑'], ['food', '음식'], ['tour', '투어'], ['move', '이동']];

function defaultDate() {
  const info = getTrip().trip;
  const p = time.tripPhase(info);
  return p.phase === 'during' ? p.date : info.start;
}

export async function render(root, ctx) {
  const trip = getTrip();
  const q = ctx.query || {};
  const phase = time.tripPhase(trip.trip);
  const m = MAPS[q.m] ? q.m : (phase.phase === 'during' ? 'day' : 'hawaii');
  const date = q.d && dayByDate(q.d) ? q.d : defaultDate();
  const cat = FILTERS.some(([k]) => k === q.cat) ? q.cat : 'all';
  const day = dayByDate(date);
  const link = (extra) => {
    const p = new URLSearchParams({ m, ...(m === 'day' ? { d: date } : {}), ...(cat !== 'all' ? { cat } : {}), ...extra });
    return `#/maps?${p.toString()}`;
  };

  let src;
  let alt;
  let places;
  if (m === 'day') {
    src = day.map;
    alt = `${time.fmtDate(date)} ${day.title} 지도`;
    places = placesOfDay(day);
    const h = day.hotel ? getPlace(hotel(day.hotel).place) : null;
    if (h && !places.includes(h)) places = [...places, h];
  } else {
    src = MAPS[m].src;
    alt = MAPS[m].alt;
    places = m === 'korea' ? [] : trip.places.filter((p) => !MAPS[m].island || p.island === MAPS[m].island);
  }
  const shown = cat === 'all' ? places : places.filter((p) => p.cat === cat);

  setHTML(root, html`
    <h1 class="page-title">🗺 지도</h1>
    <div class="seg seg-scroll" role="tablist">
      ${Object.entries(MAPS).map(([k, v]) => html`<a class="seg-btn ${m === k ? 'is-on' : ''}" href="#/maps?m=${k}${k === 'day' ? `&d=${date}` : ''}">${v.label}</a>`)}
    </div>
    ${m === 'day' ? html`
      <div class="chips chips-scroll" aria-label="날짜 선택">
        ${trip.days.map((d) => html`<a class="chip ${d.date === date ? 'is-on' : ''}" href="${link({ d: d.date })}">${time.fmtMD(d.date)}</a>`)}
      </div>` : ''}
    <button type="button" class="map-frame" data-map="${src}" data-alt="${alt}" aria-label="${alt} — 크게 보기">
      <img src="${src}" alt="${alt}" width="1080" height="1400">
      <span class="map-zoom">🔍 탭하면 크게 · 두 손가락으로 확대</span>
    </button>
    ${m === 'day' ? html`<p class="muted small"><a href="#/day/${date}">${time.fmtDate(date)} 일정 보기 ›</a></p>` : ''}

    ${places.length ? html`
      <h2 class="section-title">장소 ${shown.length}곳</h2>
      <div class="chips chips-scroll" aria-label="분류 고르기">
        ${FILTERS.filter(([k]) => k === 'all' || places.some((p) => p.cat === k)).map(([k, label]) => html`<a class="chip ${cat === k ? 'is-on' : ''}" href="${link({ cat: k })}">${label}</a>`)}
      </div>
      <ul class="place-list">
        ${shown.map((p) => html`
          <li class="place-row cat-${p.cat}">
            <button type="button" class="place-main" data-place="${p.id}">
              <span class="place-dot" aria-hidden="true">${CAT_ICON[p.cat] || '📍'}</span>
              <span class="place-text"><b>${p.name}</b><span class="muted small">${CAT_LABEL[p.cat] || ''} · ${p.name_en || ''}</span></span>
            </button>
            <a class="btn btn-small" href="${directionsUrl(p)}" target="_blank" rel="noopener noreferrer" aria-label="${p.name} 길찾기">🧭 길찾기</a>
          </li>`)}
      </ul>` : ''}
    <p class="muted small">지도는 인터넷 없이 보이는 약도예요. 실제 길 안내는 '길찾기'(Google 지도)를 써 주세요.</p>`);

  bindItemClicks(root);
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-map]');
    if (f) openViewer(f.dataset.map, f.dataset.alt);
  });
}
