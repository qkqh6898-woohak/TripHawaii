// 여러 화면이 함께 쓰는 조각: 일정 한 줄, 일정 상세 시트, 장소 시트
import { html, openSheet, copyText, debounce, toast } from './util.js';
import { getTrip, place as getPlace, findItem, directionsUrl, coordsUrl, itemPhotos, CAT_LABEL, CAT_ICON, ISLAND_LABEL } from './trip.js';
import { openViewer } from './viewer.js';
import * as time from './time.js';
import * as wallet from './wallet.js';
import * as db from './db.js';

// 시간 칸: 한국에서 겪는 일정은 한국 시각을 크게, 하와이 시각을 작게
export function timeHtml(item, day) {
  if (item.allday) return html`<span class="t-main">종일</span>`;
  if (item.clock === 'home') {
    const z = time.homeClock(day.date, item.start, getTrip().trip);
    return html`<span class="t-main">${z.time}</span><span class="t-sub">한국 시간</span>`;
  }
  // 시각은 크게, 꾸밈말(~끝 시각 · 까지 · 쯤)은 아래 작은 줄에 — 좁은 칸에서 줄이 깨지지 않게
  const sub = [item.end ? `~${item.end}` : '', item.deadline ? '까지' : '', item.approx ? '쯤' : ''].filter(Boolean).join(' ');
  return html`<span class="t-main">${item.start}</span>${sub ? html`<span class="t-sub">${sub}</span>` : ''}`;
}

/**
 * 일정 한 줄
 * @param {'past'|'current'|'next'|''} state
 */
export function itemRowHtml(item, day, state = '') {
  const p = getPlace(item.place);
  const mark = state === 'past' ? '✓' : state === 'current' ? '●' : '○';
  const markLabel = state === 'past' ? '지남' : state === 'current' ? '진행 중' : state === 'next' ? '다음' : '예정';
  return html`
    <li class="item cat-${item.cat} ${state ? 'is-' + state : ''} ${item.must ? 'is-must' : ''} ${item.tentative ? 'is-tentative' : ''}">
      <button type="button" class="item-btn" data-item="${item.id}">
        <span class="item-mark" aria-label="${markLabel}">${mark}</span>
        <span class="item-time">${timeHtml(item, day)}</span>
        <span class="item-body">
          <span class="item-title">${item.must ? html`<span class="must-icon" aria-hidden="true">⚠</span> ` : ''}${item.title}${item.confirmed ? html` <span class="ok-icon" aria-label="예약 확정">✅</span>` : ''}</span>
          ${p || item.note ? html`<span class="item-meta">${[p ? p.name : '', item.note || ''].filter(Boolean).join(' · ')}</span>` : ''}
          <span class="item-tags">
            <span class="tag tag-cat">${CAT_ICON[item.cat] || ''} ${CAT_LABEL[item.cat] || item.cat}</span>
            ${item.must ? html`<span class="tag tag-must">늦으면 안 돼요</span>` : ''}
            ${item.tentative ? html`<span class="tag tag-tentative">미정</span>` : ''}
            ${item.booking ? html`<span class="tag tag-booking">예약</span>` : ''}
            ${itemPhotos(item).length ? html`<span class="tag tag-photo">📷 ${itemPhotos(item).length}</span>` : ''}
          </span>
        </span>
        <span class="item-go" aria-hidden="true">›</span>
      </button>
    </li>`;
}

/**
 * 사진 묶음 — 여러 장이면 좌우로 밀어 넘긴다 (누르면 크게 보기, 거기서도 밀어서 넘김)
 * @param {{src:string, alt?:string}[]} photos
 */
export function carouselHtml(photos) {
  if (!photos || !photos.length) return '';
  const many = photos.length > 1;
  return html`
    <div class="carousel" data-carousel>
      <div class="carousel-track ${many ? 'is-many' : ''}" ${many ? html`tabindex="0" role="group" aria-label="사진 ${photos.length}장 — 좌우로 밀어 보기"` : ''}>
        ${photos.map((ph, i) => html`
          <button type="button" class="carousel-slide" data-gallery="${i}" aria-label="${ph.alt || '사진'} 크게 보기 (${i + 1}/${photos.length})">
            <img src="${ph.src}" alt="${ph.alt || ''}" loading="lazy" draggable="false">
            ${ph.alt ? html`<span class="carousel-cap">${ph.alt}</span>` : ''}
          </button>`)}
      </div>
      ${many ? html`<p class="carousel-count"><b data-carousel-now>1</b> / ${photos.length} <span class="muted">· 좌우로 밀어 보세요</span></p>` : ''}
    </div>`;
}

// 사진 묶음 동작: 밀 때 '몇 번째' 표시 갱신, 누르면 전체 화면(여러 장이면 이어서 넘김)
export function bindCarousels(root) {
  root.querySelectorAll('[data-carousel] .carousel-track').forEach((track) => {
    const now = track.parentNode.querySelector('[data-carousel-now]');
    if (!now) return;
    let ticking = false;
    track.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const slides = track.querySelectorAll('.carousel-slide');
        const center = track.scrollLeft + track.clientWidth / 2;
        let best = 0;
        slides.forEach((s, i) => { if (s.offsetLeft <= center) best = i; });
        now.textContent = String(best + 1);
      });
    }, { passive: true });
  });
  root.addEventListener('click', (e) => {
    const slide = e.target.closest('[data-gallery]');
    if (!slide) return;
    const list = Array.from(slide.closest('.carousel-track').querySelectorAll('.carousel-slide img')).map((img) => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' }));
    openViewer(list, '', { index: Number(slide.dataset.gallery) || 0 });
  });
}

export function placeBlockHtml(p) {
  return html`
    <div class="place-block">
      <h3>${CAT_ICON[p.cat] || '📍'} ${p.name}</h3>
      <p class="muted">${p.name_en || ''}${p.island ? ` · ${ISLAND_LABEL[p.island] || ''}` : ''}</p>
      ${p.note ? html`<p class="place-note">${p.note}</p>` : ''}
      ${p.addr ? html`
        <button type="button" class="copy-row" data-copy="${p.addr}" data-copy-label="주소를 복사했어요">
          <span class="copy-label">주소</span><span class="copy-value copy-addr">${p.addr}</span><span class="copy-hint">복사</span>
        </button>` : ''}
      <div class="btn-row">
        <a class="btn btn-primary" href="${directionsUrl(p)}" target="_blank" rel="noopener noreferrer">🧭 길찾기</a>
        <a class="btn" href="${coordsUrl(p)}" target="_blank" rel="noopener noreferrer">📍 지도에서 위치 보기</a>
      </div>
      <p class="muted small">길찾기는 인터넷이 될 때 Google 지도로 열려요.</p>
    </div>`;
}

function bindCommon(sheet) {
  wallet.bindBookingActions(sheet.body);
  bindCarousels(sheet.body);
  sheet.body.addEventListener('click', (e) => {
    const copy = e.target.closest('.place-block [data-copy]');
    if (copy) { copyText(copy.dataset.copy, copy.dataset.copyLabel); return; }
    if (e.target.closest('a[href^="#/"]')) sheet.close();
  });
}

export async function openItemSheet(itemId) {
  const found = findItem(itemId);
  if (!found) return null;
  const { day, item } = found;
  const info = getTrip().trip;
  const p = getPlace(item.place);
  const note = await db.get('notes', item.id);
  await wallet.initWallet();
  const b = item.booking ? wallet.booking(item.booking) : null;

  let when = '';
  if (item.allday) {
    when = `${time.fmtDate(day.date)} 종일`;
  } else {
    const startMs = time.zonedToEpoch(day.date, item.start, info.tz);
    const k = time.zoned(startMs, info.home_tz);
    when = `하와이 ${time.fmtDate(day.date)} ${time.fmtItemTime(item)} · 한국 ${time.fmtDate(k.date)} ${k.time}`;
  }

  const sheet = openSheet(html`
    <div class="item-detail cat-${item.cat}">
      <p class="detail-when">${when}</p>
      <div class="item-tags">
        <span class="tag tag-cat">${CAT_ICON[item.cat] || ''} ${CAT_LABEL[item.cat] || ''}</span>
        ${item.confirmed ? html`<span class="tag tag-ok">✅ 예약 확정</span>` : ''}
        ${item.must ? html`<span class="tag tag-must">⚠ 늦으면 안 돼요</span>` : ''}
        ${item.tentative ? html`<span class="tag tag-tentative">미정</span>` : ''}
        ${item.approx ? html`<span class="tag">시간은 대략</span>` : ''}
      </div>
      ${item.note ? html`<p class="detail-note">${item.note}</p>` : ''}
      ${carouselHtml(itemPhotos(item).map((ph) => ({ src: ph.src, alt: ph.alt || item.title })))}
      ${p ? placeBlockHtml(p) : ''}
      ${item.booking ? html`
        <h3 class="sheet-sub">예약</h3>
        ${b ? wallet.bookingCardHtml(b, { compact: true, anchor: false }) : html`
          <a class="btn btn-block" href="#/wallet?focus=${item.booking}">🔐 예약 지갑에서 보기</a>
          <p class="muted small">${wallet.status() === 'none' ? '예약 정보가 아직 등록되지 않았어요.' : '예약번호·연락처는 예약 지갑을 열면 보여요.'}</p>`}` : ''}
      <h3 class="sheet-sub">내 메모</h3>
      <textarea class="memo" rows="3" maxlength="2000" placeholder="이 일정에 대한 메모 (이 폰에만 저장돼요)" aria-label="내 메모">${note ? note.text : ''}</textarea>
      <p class="muted small memo-state" aria-live="polite"></p>
      <a class="btn btn-block" href="#/day/${day.date}">${time.fmtDate(day.date)} 일정 전체 보기</a>
    </div>`, { title: item.title });

  bindCommon(sheet);
  const memo = sheet.body.querySelector('.memo');
  const stateEl = sheet.body.querySelector('.memo-state');
  const save = debounce(async () => {
    const text = memo.value.trim();
    if (text) await db.put('notes', { id: item.id, text, updatedAt: Date.now() });
    else await db.del('notes', item.id);
    stateEl.textContent = text ? '메모를 저장했어요' : '';
  }, 500);
  memo.addEventListener('input', save);
  return sheet;
}

export function openPlaceSheet(placeId) {
  const p = getPlace(placeId);
  if (!p) return null;
  const uses = [];
  for (const d of getTrip().days) {
    for (const it of d.items) if (it.place === placeId) uses.push({ d, it });
  }
  const sheet = openSheet(html`
    ${placeBlockHtml(p)}
    ${uses.length ? html`
      <h3 class="sheet-sub">이 장소가 나오는 일정</h3>
      <ul class="plain-list">${uses.map(({ d, it }) => html`
        <li><a href="#/day/${d.date}"><b>${time.fmtDate(d.date)} ${time.fmtItemTime(it)}</b> ${it.title}</a></li>`)}</ul>` : ''}`,
  { title: p.name });
  bindCommon(sheet);
  return sheet;
}

// 화면 안의 일정 줄·장소 버튼을 누르면 시트를 연다
export function bindItemClicks(root) {
  root.addEventListener('click', (e) => {
    const item = e.target.closest('[data-item]');
    if (item) { openItemSheet(item.dataset.item); return; }
    const pl = e.target.closest('[data-place]');
    if (pl) { e.preventDefault(); openPlaceSheet(pl.dataset.place); }
  });
}

export function notify(what) {
  window.dispatchEvent(new CustomEvent('aloha:update', { detail: { what } }));
}

export { toast };
