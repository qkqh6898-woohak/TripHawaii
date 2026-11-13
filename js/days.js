// 일정 — 날짜별 시간 일정 + 지도 + 사진 + 준비물
import { html, setHTML, onSwipe, haptic } from './util.js';
import { getTrip, dayByDate, hotel, place as getPlace, islandLabel, hotelEvents, mapSize, dayPhotos, mapLevels } from './trip.js';
import * as time from './time.js';
import { itemRowHtml, bindItemClicks, carouselHtml, bindCarousels } from './ui.js';
import { weatherHtml } from './weather.js';
import { getChecks, packingItems, setCheck } from './checklist.js';
import { openViewer } from './viewer.js';
import { topicsForDate, topicHtml } from './videos.js';
import * as wallet from './wallet.js';
import { noticesForDate, ideasForDate, noticeHtml, ideaHtml, bindIdeas } from './ideas.js';

export const live = ['weather'];

function defaultDate() {
  const info = getTrip().trip;
  const p = time.tripPhase(info);
  if (p.phase === 'during') return p.date;
  return p.phase === 'after' ? info.end : info.start;
}

export function hotelBannersHtml(date) {
  return hotelEvents(date).map(({ type, hotel: h }) => {
    const t = type === 'checkin' ? h.checkin_time : h.checkout_time;
    const text = type === 'checkin'
      ? `오늘 체크인 · ${h.name}${t ? ` (${t}부터)` : ''}`
      : `오늘 체크아웃 · ${h.name}${t ? ` (${t}까지)` : ''}`;
    return html`<button type="button" class="banner banner-hotel" data-place="${h.place}">🏨 ${text}</button>`;
  });
}

export async function render(root, ctx) {
  await wallet.initWallet();   // 암호화된 사진을 먼저 받아 둔다
  const trip = getTrip();
  const info = trip.trip;
  const date = ctx.params[0] && dayByDate(ctx.params[0]) ? ctx.params[0] : defaultDate();
  const day = dayByDate(date);
  const idx = trip.days.indexOf(day);
  const phase = time.tripPhase(info);
  const isToday = phase.phase === 'during' && phase.date === date;
  const cn = isToday ? time.currentAndNext(trip.days) : null;
  const isPastDay = phase.date > date && phase.phase !== 'before';
  const h = day.hotel ? hotel(day.hotel) : null;
  const hp = h ? getPlace(h.place) : null;
  const checks = await getChecks();
  const packs = packingItems(day, checks);
  const wx = await weatherHtml(day.weather_zones, date);
  const vids = await topicsForDate(date);
  const notices = await noticesForDate(date);
  const dayIdeas = await ideasForDate(date);

  const stateOf = (it) => {
    if (isPastDay) return 'past';
    if (!cn) return '';
    if (cn.current && cn.current.item.id === it.id) return 'current';
    if (cn.past.has(it.id)) return 'past';
    if (cn.next && cn.next.item.id === it.id && cn.next.date === date) return 'next';
    return '';
  };

  setHTML(root, html`
    <h1 class="page-title">📅 일정</h1>
    <nav class="chips chips-scroll day-chips" aria-label="날짜 선택">
      ${trip.days.map((d) => html`
        <a class="chip chip-day ${d.date === date ? 'is-on' : ''} ${phase.phase === 'during' && d.date === phase.date ? 'is-today' : ''}" href="#/day/${d.date}" ${d.date === date ? html`aria-current="page"` : ''}>
          <b>${time.fmtMD(d.date)}</b><span>${time.weekday(d.date)}</span>
        </a>`)}
    </nav>

    <header class="day-head">
      <p class="day-meta">${time.fmtDate(date)} · ${idx + 1}일차 · ${islandLabel(day)}${isToday ? ' · 오늘' : ''}</p>
      <h2>${day.title}</h2>
      <p class="day-summary">${day.summary || ''}</p>
      ${hp ? html`<button type="button" class="link-btn" data-place="${hp.id}">🏨 오늘 숙소: ${h.name} ›</button>` : html`<p class="muted">🛫 오늘은 숙소 없이 귀국편에 타요</p>`}
    </header>

    ${hotelBannersHtml(date)}
    ${notices.map((n) => html`<section class="card card-notice">${noticeHtml(n)}</section>`)}
    ${wx}

    <button type="button" class="map-frame" data-map="${day.map}" data-alt="${time.fmtDate(date)} ${day.title} 지도" aria-label="지도 크게 보기">
      <img src="${day.map}" alt="${time.fmtDate(date)} ${day.title} 지도" width="${mapSize(day.map)[0]}" height="${mapSize(day.map)[1]}">
      <span class="map-zoom">🔍 탭하면 크게 · 오므리면 섬 전체</span>
    </button>

    ${carouselHtml(dayPhotos(day))}

    <h2 class="section-title">시간 일정</h2>
    <ol class="items">
      ${day.items.map((it) => itemRowHtml(it, day, stateOf(it)))}
    </ol>

    ${packs.length ? html`
      <section class="card">
        <h2>🎒 이날 챙길 것</h2>
        <ul class="check-list">
          ${packs.map((p) => html`
            <li class="check-row ${p.done ? 'is-done' : ''}"><label>
              <input type="checkbox" data-check="${p.id}" ${p.done ? 'checked' : ''}><span class="check-text">${p.text}</span></label></li>`)}
        </ul>
        <a class="link-btn" href="#/check?tab=daily&d=${date}">매일 공통 준비물까지 보기 ›</a>
      </section>` : ''}

    ${dayIdeas.length ? html`
      <section class="card">
        <h2>✨ 이날 넣어 볼 만한 것</h2>
        <p class="muted small">확정 일정이 아니에요. 마음에 들면 ☆ 를 눌러 두세요.</p>
        ${dayIdeas.map((i) => ideaHtml(i, { compact: true }))}
      </section>` : ''}

    ${vids.length ? html`
      <section class="card">
        <h2>📺 영상으로 미리 보기</h2>
        ${vids.map((t) => topicHtml(t, { compact: true }))}
        <a class="link-btn" href="#/videos">하와이 영상 모두 보기 ›</a>
      </section>` : ''}

    <p class="muted small center swipe-hint" aria-hidden="true">‹ 화면을 좌우로 밀면 날짜가 바뀌어요 ›</p>
    <nav class="day-nav" aria-label="앞뒤 날짜">
      ${idx > 0 ? html`<a class="btn" href="#/day/${trip.days[idx - 1].date}">‹ ${time.fmtMD(trip.days[idx - 1].date)}</a>` : html`<span></span>`}
      <a class="btn" href="#/maps?m=day&d=${date}">🗺 지도·장소</a>
      ${idx < trip.days.length - 1 ? html`<a class="btn" href="#/day/${trip.days[idx + 1].date}">${time.fmtMD(trip.days[idx + 1].date)} ›</a>` : html`<span></span>`}
    </nav>`);

  bindItemClicks(root);
  bindCarousels(root);
  bindIdeas(root);
  root.addEventListener('click', (e) => {
    const map = e.target.closest('[data-map]');
    if (map) openViewer(map.dataset.map, map.dataset.alt, { levels: mapLevels(map.dataset.map, map.dataset.alt) });
  });

  // 화면을 좌우로 밀면 앞·뒤 날짜로 (왼쪽으로 밀면 다음 날)
  root.classList.add('swipe-x');
  onSwipe(root, (dir) => {
    const target = dir === 'left' ? trip.days[idx + 1] : trip.days[idx - 1];
    if (!target) return;
    ctx.navigate(`#/day/${target.date}`, true, { slide: dir });
  });
  root.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-check]');
    if (!box) return;
    await setCheck(box.dataset.check, box.checked);
    haptic();
    box.closest('.check-row').classList.toggle('is-done', box.checked);
  });

  const on = root.querySelector('.day-chips .is-on');
  if (on && on.scrollIntoView) requestAnimationFrame(() => on.scrollIntoView({ inline: 'center', block: 'nearest' }));
}
