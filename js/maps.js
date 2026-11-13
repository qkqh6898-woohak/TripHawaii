// 지도 — 미리 그려 둔 약도(오프라인) + 날짜별 동선(시간표·장소) + Google 지도 경로 · 전체 일정 요약
import { html, setHTML, onSwipe, copyText, downloadFile, toast } from './util.js';
import { getTrip, dayByDate, placesOfDay, hotel, place as getPlace, directionsUrl, mapSize, CAT_LABEL, CAT_ICON } from './trip.js';
import * as time from './time.js';
import { openViewer } from './viewer.js';
import { bindItemClicks, timeHtml } from './ui.js';
import { routeStops, dayRouteLinks, dayHead, missingInfo, summaryText, buildKml, timeLabel } from './route.js';

const MAPS = {
  hawaii: { label: '하와이 전체', src: 'maps/overview-hawaii.png', alt: '하와이 전체 일정 지도' },
  oahu: { label: '오아후', src: 'maps/oahu.png', alt: '오아후 장소 지도', island: 'oahu' },
  bigisland: { label: '빅아일랜드', src: 'maps/big-island.png', alt: '빅아일랜드 장소 지도', island: 'bigisland' },
  day: { label: '날짜별' },
  summary: { label: '일정 요약' },
  korea: { label: '한국↔하와이', src: 'maps/korea-hawaii.png', alt: '한국과 하와이 이동 지도' },
};
const FILTERS = [['all', '전체'], ['hotel', '숙소'], ['sight', '관광'], ['shop', '쇼핑'], ['food', '음식'], ['tour', '투어'], ['move', '이동']];

function defaultDate() {
  const info = getTrip().trip;
  const p = time.tripPhase(info);
  return p.phase === 'during' ? p.date : info.start;
}

// 구글 지도로 그날 경로 전체 열기 (섬이 바뀌는 날은 섬별 버튼)
function routeButtonsHtml(day, { small = false } = {}) {
  const links = dayRouteLinks(day);
  return links.map((l) => html`
    <a class="btn ${small ? 'btn-small' : 'btn-primary btn-block'}" href="${l.url}" target="_blank" rel="noopener noreferrer" data-route="${l.island}">
      🗺 ${small ? '경로' : '구글 지도에서 이날 경로 전체 보기'}${links.length > 1 ? ` · ${l.label}` : ''} (${l.stops}곳)
    </a>`);
}

const headLine = (day) => {
  const h = dayHead(day);
  return `${time.fmtDate(day.date)} · ${h.n}일차 · ${h.island}${h.hotel ? ` · 숙소 ${h.hotel}` : ''}`;
};

// 날짜별 지도 아래: 시간순 동선 (번호는 약도의 번호와 같다)
function dayRouteHtml(day) {
  const stops = routeStops(day);
  const loose = day.items.filter((it) => !getPlace(it.place) && it.clock !== 'home');
  return html`
    <section class="card route">
      <h2>🧭 이날 동선</h2>
      <p class="muted small">${headLine(day)}</p>
      <ol class="place-list route-list">
        ${stops.map((s) => html`
          <li class="place-row cat-${s.place.cat}">
            <button type="button" class="place-main" data-place="${s.place.id}">
              <span class="route-pin" aria-label="약도 번호 ${s.pin}">${s.pin}</span>
              <span class="place-text">
                <b>${s.time ? `${s.time} ` : ''}${s.place.name}</b>
                <span class="muted small">${s.auto === 'start' ? '숙소에서 출발' : s.auto === 'end' ? '숙소로 돌아옴' : s.items.map((it) => it.title).join(' → ')}</span>
              </span>
            </button>
            <a class="btn btn-small" href="${directionsUrl(s.place)}" target="_blank" rel="noopener noreferrer" aria-label="${s.place.name} 길찾기">🧭 길찾기</a>
          </li>`)}
      </ol>
      ${routeButtonsHtml(day)}
      ${loose.length ? html`<p class="muted small"><b>장소가 없는 일정</b> (경로에 안 들어가요): ${loose.map((it) => `${timeLabel(it, day)} ${it.title}`).join(' · ')}</p>` : ''}
      <p class="muted small">'길찾기'는 지금 있는 곳에서 그 장소까지, '경로 전체'는 그날 들르는 곳을 순서대로 이어서 보여줘요. 둘 다 Google 지도로 열리고 인터넷이 필요해요.</p>
    </section>`;
}

// 전체 일정 요약: 날짜 · 시간표 · 장소
function summaryHtml(trip) {
  const miss = missingInfo();
  const noPlace = new Set(miss.filter((m) => m.kind === 'place' || m.kind === 'meet').map((m) => m.item));
  const waiting = new Map(miss.filter((m) => m.kind === 'wait').map((m) => [m.item, m.what]));   // 장소가 필요한데 없는 일정
  return html`
    <section class="card">
      <h2>📋 전체 일정 요약</h2>
      <p class="muted small">날짜 · 시간표 · 장소를 한 번에 봐요. 시각은 하와이 시간, 날짜를 누르면 그날 일정으로 가요.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="copy-summary">📋 글자로 복사 (카톡용)</button>
        <button type="button" class="btn" data-action="kml">⬇ 구글 '내 지도'용 파일</button>
      </div>
      <details class="how">
        <summary>구글 '내 지도'에 모든 장소를 넣는 방법</summary>
        <ol class="how-steps">
          <li>위의 <b>⬇ 구글 '내 지도'용 파일</b>을 눌러 파일(aloha-trip.kml)을 받아요.</li>
          <li>컴퓨터에서 <b>google.com/mymaps</b> 를 열고 <b>새 지도 만들기 → 가져오기</b>에서 받은 파일을 골라요.</li>
          <li>폰의 구글 지도 앱 → <b>저장됨(내 장소) → 지도</b>에서 그 지도를 열면, 장소 ${trip.places.length}곳이 핀으로 보이고 핀을 누르면 방문 날짜·시각이 나와요.</li>
        </ol>
        <p class="muted small">파일에는 공개 일정의 장소·시각만 들어 있어요 (예약번호 등은 없음).</p>
      </details>
    </section>

    ${miss.length ? html`
      <section class="card">
        <h2>❓ 아직 비어 있는 정보 ${miss.length}개</h2>
        <p class="muted small">정해지면 Claude 에게 알려 주세요. 장소가 생기면 지도와 경로에 자동으로 들어가요.</p>
        <ul class="plain-list miss-list">
          ${miss.map((m) => html`<li><a href="#/day/${m.date}"><span><b>${time.fmtMD(m.date)}${m.time ? ` ${m.time}` : ''}</b> ${m.title}<br><span class="muted small">${m.what}</span></span></a></li>`)}
        </ul>
      </section>` : ''}

    ${trip.days.map((day) => html`
      <section class="card sum-day" data-sum="${day.date}">
        <h2><a href="#/day/${day.date}">${time.fmtDate(day.date)} · ${dayHead(day).n}일차 ›</a></h2>
        <p class="muted small">${dayHead(day).island}${dayHead(day).hotel ? ` · 숙소 ${dayHead(day).hotel}` : ' · 귀국'} · ${day.title}</p>
        <ol class="sum-list">
          ${day.items.map((it) => {
    const p = getPlace(it.place);
    return html`
            <li class="sum-row ${it.tentative ? 'is-tentative' : ''}">
              <span class="sum-time">${timeHtml(it, day)}</span>
              <span class="sum-what"><b>${it.title}</b>${it.tentative ? html` <span class="tag tag-tentative">미정</span>` : ''}
                ${p ? html`<span class="sum-place">📍 ${p.name}</span>` : noPlace.has(it.id) ? html`<span class="sum-place">📍 장소 미정</span>` : waiting.has(it.id) ? html`<span class="sum-place">⏳ ${waiting.get(it.id)}</span>` : ''}</span>
            </li>`;
  })}
        </ol>
        <div class="btn-row">
          ${routeButtonsHtml(day, { small: true })}
          <a class="btn btn-small" href="#/maps?m=day&d=${day.date}">약도 · 동선</a>
        </div>
      </section>`)}
    <p class="muted small">경로 버튼은 Google 지도로 열리고 인터넷이 필요해요. 폰에 구글 지도 앱이 있으면 앱으로 열려요.</p>`;
}

function bindSummary(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'copy-summary') copyText(summaryText(), '일정 요약을 복사했어요. 카톡에 붙여넣어 보세요.');
    if (a.dataset.action === 'kml') { downloadFile('aloha-trip.kml', buildKml(), 'application/vnd.google-earth.kml+xml'); toast('파일을 받았어요 — 아래 방법대로 구글 내 지도에 넣어 보세요', 3500); }
  });
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

  const navHtml = html`
    <h1 class="page-title">🗺 지도</h1>
    <nav class="seg seg-scroll" aria-label="지도 종류">
      ${Object.entries(MAPS).map(([k, v]) => html`<a class="seg-btn ${m === k ? 'is-on' : ''}" href="#/maps?m=${k}${k === 'day' ? `&d=${date}` : ''}" ${m === k ? html`aria-current="page"` : ''}>${v.label}</a>`)}
    </nav>`;
  if (m === 'summary') {
    setHTML(root, html`${navHtml}${summaryHtml(trip)}`);
    bindSummary(root);
    return;
  }

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
    ${navHtml}
    ${m === 'day' ? html`
      <div class="chips chips-scroll" aria-label="날짜 선택">
        ${trip.days.map((d) => html`<a class="chip ${d.date === date ? 'is-on' : ''}" href="${link({ d: d.date })}">${time.fmtMD(d.date)}</a>`)}
      </div>` : ''}
    <button type="button" class="map-frame" data-map="${src}" data-alt="${alt}" aria-label="${alt} — 크게 보기">
      <img src="${src}" alt="${alt}" width="${mapSize(src)[0]}" height="${mapSize(src)[1]}">
      <span class="map-zoom">🔍 탭하면 크게 · 두 손가락으로 확대</span>
    </button>
    ${m === 'day' ? html`<p class="muted small"><a class="link-btn" href="#/day/${date}">${time.fmtDate(date)} 일정 보기 ›</a></p>${dayRouteHtml(day)}` : ''}

    ${m !== 'day' && places.length ? html`
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
    <p class="muted small">지도는 인터넷 없이 보이는 약도예요. 실제 길 안내는 '길찾기'(Google 지도)를 써 주세요. 날짜·시간표·장소를 한 번에 보려면 위의 <a href="#/maps?m=summary">일정 요약</a>을 눌러 주세요.</p>`);

  if (m === 'day') {
    const i = trip.days.indexOf(day);
    root.classList.add('swipe-x');
    onSwipe(root, (dir) => {
      const target = dir === 'left' ? trip.days[i + 1] : trip.days[i - 1];
      if (!target) return;
      ctx.navigate(link({ d: target.date }), true, { slide: dir });
    });
  }
  bindItemClicks(root);
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-map]');
    if (f) openViewer(f.dataset.map, f.dataset.alt);
  });
}
