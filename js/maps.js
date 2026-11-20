// 지도 — 미리 그려 둔 약도(오프라인) + 날짜별 동선(시간표·장소) + Google 지도 경로 · 전체 일정 요약
import { html, setHTML, onSwipe, copyText, downloadFile, toast, haptic } from './util.js';
import { prefs, setPref } from './prefs.js';
import { getTrip, dayByDate, placesOfDay, hotel, place as getPlace, directionsUrl, directionsTo, directionsPlan, homeOnOahu, mapSize, mapLevels, CAT_LABEL, CAT_ICON } from './trip.js';
import { transitDoc, dirFrom, stopQuery, stopLabel, nearestStop } from './transit.js';
import { planHtml } from './ui.js';
import * as time from './time.js';
import { openViewer } from './viewer.js';
import { bindItemClicks, timeHtml } from './ui.js';
import { routeStops, dayRouteLinks, dayHead, missingInfo, summaryText, buildKml, timeLabel } from './route.js';
import { loadEats, eatQuery, eatsCsv, searchUrl as gSearch, embedButtonHtml } from './gmap.js';

const MAPS = {
  hawaii: { label: '하와이 전체', src: 'maps/overview-hawaii.png', alt: '하와이 전체 일정 지도' },
  oahu: { label: '오아후', src: 'maps/oahu.png', alt: '오아후 장소 지도', island: 'oahu' },
  bigisland: { label: '빅아일랜드', src: 'maps/big-island.png', alt: '빅아일랜드 장소 지도', island: 'bigisland' },
  day: { label: '날짜별' },
  summary: { label: '일정 요약' },
  eats: { label: '맛집' },
  transit: { label: '🚋 교통' },
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

// ───────────── 트롤리 · 대중교통 (data/transit.json) ─────────────
const TRANSIT_LAYER = 'https://www.google.com/maps/@21.2830,-157.8330,14z/data=!5m1!1e2';   // 구글 지도 '대중교통' 표시
function transitHtml() {
  const doc = transitDoc();
  if (!doc) return html`<p class="muted empty">교통 정보를 불러오지 못했어요.</p>`;
  const pink = doc.lines.find((l) => l.id === 'pink');
  const home = homeOnOahu();
  const near = home ? nearestStop(home.lat, home.lng) : null;
  const from = dirFrom();
  const routeLink = (list) => {
    const qs = list.map(stopQuery);
    const params = new URLSearchParams({ api: '1', origin: qs[0], destination: qs[qs.length - 1], travelmode: 'driving' });
    if (qs.length > 2) params.set('waypoints', qs.slice(1, -1).join('|'));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  };
  const open = pink.stops.filter((s) => s.status !== 'closed');
  return html`
    <section class="card">
      <h2>🧭 길찾기 출발점</h2>
      <p class="muted small">앱의 모든 '길찾기'(오아후)가 어디서 출발할지 정해요. 빅아일랜드는 렌터카라 내 위치에서 출발해요.</p>
      <div class="seg" role="group" aria-label="길찾기 출발점">
        <button type="button" class="seg-btn ${from === 'stop' ? 'is-on' : ''}" data-dirfrom="stop" aria-pressed="${from === 'stop' ? 'true' : 'false'}">🚋 트롤리 정거장</button>
        <button type="button" class="seg-btn ${from === 'here' ? 'is-on' : ''}" data-dirfrom="here" aria-pressed="${from === 'here' ? 'true' : 'false'}">📍 내 위치</button>
      </div>
      <p class="small">${from === 'stop' ? html`가까운 핑크라인 정거장(걸어서 ${doc.walk_km}km 안)에서 <b>걸어서</b>, 멀면 숙소 근처 정거장${near ? html`(<b>${stopLabel(near.stop)}</b>)` : ''}에서 <b>대중교통</b>으로 안내해요.` : '폰의 현재 위치에서 출발해요.'}</p>
    </section>

    <section class="card">
      <h2><span class="line-dot" data-line="pink"></span> ${pink.name}</h2>
      <p><b>${pink.fare}</b></p>
      <p class="small">${pink.every} · ${pink.hours}</p>
      <ul class="small notes">${pink.notes.map((n) => html`<li>· ${n}</li>`)}</ul>
      <div class="btn-row">
        <a class="btn btn-small" href="${routeLink(open.filter((s) => s.no <= 7))}" target="_blank" rel="noopener noreferrer">🗺 노선 ①~⑦ 구글 지도</a>
        <a class="btn btn-small" href="${routeLink(open.filter((s) => s.no >= 7))}" target="_blank" rel="noopener noreferrer">🗺 노선 ⑦~⑬ 구글 지도</a>
        <a class="btn btn-small" href="${pink.official}" target="_blank" rel="noopener noreferrer">🕒 공식 시간표</a>
      </div>
    </section>
    <ol class="stop-list">
      ${pink.stops.map((s) => html`
        <li class="card stop ${s.status === 'closed' ? 'is-closed' : ''} ${near && near.stop.id === s.id ? 'is-home' : ''}" data-stop="${s.id}">
          <h3><span class="stop-no">${s.no}</span> ${s.name}${near && near.stop.id === s.id ? html` <span class="tag tag-booking">숙소 근처</span>` : ''}${s.status === 'closed' ? html` <span class="tag tag-must">운행 제외</span>` : ''}</h3>
          <p class="muted small">${s.name_en} · ${s.addr}</p>
          ${s.note ? html`<p class="small">${s.note}</p>` : ''}
          <div class="btn-row">
            <a class="btn btn-small" href="${gSearch(stopQuery(s))}" target="_blank" rel="noopener noreferrer">📍 구글 지도 앱</a>
          </div>
          ${embedButtonHtml(stopQuery(s), `${s.name} 정거장 구글 지도`)}
        </li>`)}
    </ol>

    <h2 class="section-title">다른 트롤리 노선</h2>
    ${doc.lines.filter((l) => l.id !== 'pink').map((l) => html`
      <section class="card">
        <h3><span class="line-dot" data-line="${l.id}"></span> ${l.name}</h3>
        <p class="small"><b>${l.fare}</b> · ${l.every}</p>
        <p class="small">${l.about}</p>
        <a class="link-btn" href="${l.official}" target="_blank" rel="noopener noreferrer">공식 노선 안내 ›</a>
      </section>`)}
    <p class="muted small">${doc.passes}</p>

    <h2 class="section-title">버스 · 전철</h2>
    ${doc.public.map((b) => html`
      <section class="card">
        <h3>${b.icon} ${b.name}</h3>
        <p class="small">${b.text}</p>
        <div class="btn-row">
          ${(b.links || []).map((l) => html`<a class="btn btn-small" href="${l.url}" target="_blank" rel="noopener noreferrer">🔗 ${l.label}</a>`)}
        </div>
      </section>`)}
    <section class="card">
      <h3>🗺 구글 지도로 대중교통 보기</h3>
      <div class="btn-row">
        <a class="btn btn-small" href="${TRANSIT_LAYER}" target="_blank" rel="noopener noreferrer">🚌 와이키키 대중교통 노선도</a>
        ${near ? html`<a class="btn btn-small" href="https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', origin: stopQuery(near.stop), travelmode: 'transit' }).toString()}" target="_blank" rel="noopener noreferrer">🚏 숙소 근처 정거장에서 대중교통 길찾기</a>` : ''}
      </div>
      <p class="muted small">구글 지도에는 버스·전철(더버스·스카이라인)이 나오고, 와이키키 트롤리는 나오지 않을 수 있어요. ${doc.note}</p>
    </section>`;
}

function bindTransit(root, ctx) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dirfrom]');
    if (!b) return;
    await setPref('dirFrom', b.dataset.dirfrom);
    haptic();
    toast(b.dataset.dirfrom === 'here' ? '길찾기가 내 위치에서 출발해요' : '길찾기가 트롤리 정거장에서 출발해요');
    ctx.rerender();
  });
}

// ───────────── 맛집 목록 (data/eats.json) ─────────────
const AREA_ORDER = ['waikiki', 'diamondhead', 'kapahulu', 'alamoana', 'kaimuki', 'downtown', 'hawaiikai', 'northshore', 'oahu', 'keauhou', 'alii', 'konatown'];

function eatsHtml(doc, cat) {
  const group = (doc.groups || []).find((g) => `g-${g.id}` === cat) || null;   // 묶음 (예: 리힝무이 파인애플 주변)
  const favs = prefs().eatFav || [];
  const catOf = Object.fromEntries((doc.categories || []).map((c) => [c.id, c]));
  const list = (doc.places || [])
    .filter((p) => (cat === 'all' ? true : cat === 'fav' ? favs.includes(p.id) : cat === 'walk' ? p.area === 'waikiki' : cat === 'oceanstar' ? (p.tags || []).includes('oceanstar') : group ? group.ids.includes(p.id) : p.cat === cat))
    .sort((a, b) => (group ? group.ids.indexOf(a.id) - group.ids.indexOf(b.id) : AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area)));
  const osCount = (doc.places || []).filter((p) => (p.tags || []).includes('oceanstar')).length;
  const chips = [['all', '전체'], ['walk', '🚶 걸어서'], ['fav', `★ 찜 ${favs.length}`], ...(doc.groups || []).map((g) => [`g-${g.id}`, `${g.icon} ${g.title} ${g.ids.length}`]), ...(osCount ? [['oceanstar', `🐢 오션스타 추천 ${osCount}`]] : []), ...(doc.categories || []).map((c) => [c.id, `${c.icon} ${c.title}`])];
  const tip = cat !== 'all' ? (catOf[cat] || {}).tip : '';
  return html`
    <section class="card">
      <h2>🍽 맛집 ${(doc.places || []).length}곳</h2>
      <p class="muted small">${doc.note || ''}</p>
      <a class="btn btn-primary btn-block" href="#/search">🔎 우동 · 포케 · 커피 · 맛집 검색</a>
      <button type="button" class="btn btn-block" data-action="eats-csv">⬇ 맛집 ${(doc.places || []).length}곳을 내 구글 지도에 넣는 파일</button>
      <details class="how">
        <summary>구글 '내 지도'에 맛집을 한 번에 넣는 방법</summary>
        <ol class="how-steps">
          <li>위 버튼으로 파일(aloha-eats.csv)을 받아요.</li>
          <li>컴퓨터에서 <b>google.com/mymaps</b> → <b>새 지도 만들기 → 가져오기</b>로 파일을 골라요.</li>
          <li>'위치' 열을 고르면 구글이 주소·가게 이름으로 핀을 찍어 줘요. 제목 열은 '이름'.</li>
          <li>왼쪽 '스타일'에서 <b>종류</b>로 색을 나누면 보기 좋아요. 폰 구글 지도 앱 → 저장됨 → 지도에서 열어요.</li>
        </ol>
        <p class="muted small">핀 위치는 구글 검색 결과라 한두 곳은 다른 지점이 잡힐 수 있어요. 일정 장소는 '일정 요약'의 내 지도 파일(KML)로 따로 넣을 수 있어요.</p>
      </details>
    </section>
    <div class="chips chips-scroll" aria-label="맛집 종류 고르기">
      ${chips.map(([id, label]) => html`<a class="chip ${cat === id ? 'is-on' : ''}" href="#/maps?m=eats&cat=${id}" ${cat === id ? html`aria-current="true"` : ''}>${label}</a>`)}
    </div>
    ${cat === 'oceanstar' ? html`<p class="banner">🐢 ${(doc.sources || {}).oceanstar || ''}</p>` : ''}
    ${group ? html`<p class="banner">${group.icon} ${group.note}</p>` : ''}
    ${tip ? html`<p class="banner">💡 ${tip}</p>` : ''}
    ${!list.length ? html`<p class="muted empty">${cat === 'fav' ? '아직 찜한 곳이 없어요. 가게 옆 ☆ 를 눌러 모아 보세요.' : '이 종류의 맛집이 없어요.'}</p>` : ''}
    <ul class="eat-list">
      ${list.map((p) => {
    const c = catOf[p.cat] || {};
    const fav = favs.includes(p.id);
    return html`
        <li class="card eat ${fav ? 'is-fav' : ''}" data-eat="${p.id}">
          <div class="eat-head">
            <h3>${c.icon || '🍴'} ${p.name}${p.star ? html` <span class="tag tag-ok">추천</span>` : ''}</h3>
            <button type="button" class="btn btn-fav ${fav ? 'is-on' : ''}" data-eat-fav aria-pressed="${fav ? 'true' : 'false'}" aria-label="${p.name} 찜하기">${fav ? '★' : '☆'}</button>
          </div>
          <p class="eat-meta">${(p.tags || []).includes('oceanstar') ? html`<span class="tag tag-ok">🐢 오션스타</span> ` : ''}<span class="tag">${c.title || ''}</span> <span class="tag ${p.area === 'waikiki' ? 'tag-booking' : ''}">${(doc.areas || {})[p.area] || ''}</span>${p.plan ? html` <span class="tag tag-tentative">${p.plan}</span>` : ''}</p>
          ${p.note ? html`<p class="eat-note">${p.note}</p>` : ''}
          ${p.addr ? html`<p class="muted small">${p.addr}</p>` : ''}
          <div class="btn-row">
            <a class="btn btn-small" href="${gSearch(eatQuery(p))}" target="_blank" rel="noopener noreferrer">📍 구글 지도 앱</a>
            <a class="btn btn-small" href="${directionsTo(eatQuery(p), { island: p.island || 'oahu', stop: p.stop })}" target="_blank" rel="noopener noreferrer">🧭 길찾기</a>
          </div>
          ${planHtml(directionsPlan({ island: p.island || 'oahu', stop: p.stop }))}
          ${embedButtonHtml(eatQuery(p), `${p.name} 구글 지도`)}
        </li>`;
  })}
    </ul>
    <p class="muted small">버튼을 누르면 Google 지도로 열려요 (인터넷 필요). 이동 시간은 숙소 기준 추정이에요.</p>`;
}

function bindEats(root, doc) {
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="eats-csv"]')) {
      downloadFile('aloha-eats.csv', eatsCsv(doc), 'text/csv');
      toast('파일을 받았어요 — 아래 방법대로 구글 내 지도에 넣어 보세요', 3500);
      return;
    }
    const b = e.target.closest('[data-eat-fav]');
    if (!b) return;
    const id = b.closest('[data-eat]').dataset.eat;
    const cur = prefs().eatFav || [];
    const on = !cur.includes(id);
    await setPref('eatFav', on ? [...cur, id] : cur.filter((x) => x !== id));
    haptic();
    b.classList.toggle('is-on', on);
    b.textContent = on ? '★' : '☆';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.closest('[data-eat]').classList.toggle('is-fav', on);
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
  const showSeg = () => { const seg = root.querySelector('.seg-scroll .is-on'); if (seg && seg.scrollIntoView) requestAnimationFrame(() => seg.scrollIntoView({ inline: 'center', block: 'nearest' })); };
  if (m === 'summary') {
    setHTML(root, html`${navHtml}${summaryHtml(trip)}`);
    bindSummary(root);
    showSeg();
    return;
  }
  if (m === 'transit') {
    setHTML(root, html`${navHtml}${transitHtml()}`);
    bindTransit(root, ctx);
    showSeg();
    return;
  }
  if (m === 'eats') {
    const doc = await loadEats();
    const ids = new Set(['all', 'walk', 'fav', 'oceanstar', ...(doc.groups || []).map((g) => `g-${g.id}`), ...(doc.categories || []).map((c) => c.id)]);
    const ecat = ids.has(q.cat) ? q.cat : 'all';
    setHTML(root, html`${navHtml}${eatsHtml(doc, ecat)}`);
    bindEats(root, doc);
    const on = root.querySelector('.chips-scroll .is-on');
    const seg = root.querySelector('.seg-scroll .is-on');
    requestAnimationFrame(() => [seg, on].forEach((el) => { if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }));
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
      <span class="map-zoom">🔍 탭하면 크게${mapLevels(src).length > 1 ? ' · 오므리면 더 넓게' : ''}</span>
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
    if (f) openViewer(f.dataset.map, f.dataset.alt, { levels: mapLevels(f.dataset.map, f.dataset.alt) });
  });
}
