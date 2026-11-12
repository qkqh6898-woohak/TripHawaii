// 오늘 — 지금 시각(하와이·한국), 진행 중·다음 일정과 남은 시간, 오늘 일정·준비물·지출
import { html, setHTML, fmtKRW, fmtUSD, isStandalone, isIOS, inAppBrowser, copyText } from './util.js';
import { getTrip, dayByDate, hotel, place as getPlace, islandLabel, directionsUrl } from './trip.js';
import * as time from './time.js';
import { itemRowHtml, bindItemClicks, openItemSheet } from './ui.js';
import { weatherHtml } from './weather.js';
import { getChecks, packingItems, progressBefore, setCheck } from './checklist.js';
import { todaySummary } from './expenses.js';
import { offlineStatus, canPromptInstall, promptInstall } from './sw-client.js';
import * as wallet from './wallet.js';
import { prefs, setPref, OWNERS } from './prefs.js';
import { hotelBannersHtml } from './days.js';
import { noticesForDate, noticeHtml } from './ideas.js';

export const live = ['clock', 'weather', 'offline', 'wallet', 'install'];

function clockHtml(now, info, sub) {
  return html`
    <h1 class="sr-only">오늘</h1>
    <section class="card clock" aria-label="지금 시각">
      <div class="clock-row"><span class="clock-where">🌺 하와이</span><b class="clock-time">${time.fmtZoned(now, info.tz)}</b></div>
      <div class="clock-row clock-home"><span class="clock-where">🇰🇷 한국</span><b class="clock-time">${time.fmtZoned(now, info.home_tz)}</b></div>
      ${sub ? html`<p class="clock-sub">${sub}</p>` : ''}
      ${time.hasNowOverride() ? html`<p class="banner banner-warn small">미리보기용으로 시각을 고정했어요 (주소의 ?now=)</p>` : ''}
    </section>`;
}

function itemActionsHtml(item) {
  const p = getPlace(item.place);
  return html`
    <div class="btn-row">
      ${p && !item.flight ? html`<a class="btn btn-primary" href="${directionsUrl(p)}" target="_blank" rel="noopener noreferrer">🧭 길찾기</a>` : ''}
      ${item.booking ? html`<a class="btn" href="#/wallet?focus=${item.booking}">🎫 예약 보기</a>` : ''}
      <button type="button" class="btn" data-item="${item.id}">자세히</button>
    </div>`;
}

function nowNextHtml(cn, now, info, todayDate) {
  const parts = [];
  if (cn.current) {
    const it = cn.current.item;
    const p = getPlace(it.place);
    const left = cn.current.endMs - now;
    parts.push(html`
      <section class="card now-card cat-${it.cat}">
        <p class="now-label">${it.flight ? '✈️ 비행 중' : '지금'}</p>
        <h2>${it.title}</h2>
        <p class="now-meta">${time.fmtItemTime(it)}${p ? ` · ${p.name}` : ''}${it.end ? ` · ${it.flight ? '도착' : '끝'}까지 ${time.fmtDuration(left)}` : ''}</p>
        ${it.note ? html`<p class="muted small">${it.note}</p>` : ''}
      </section>`);
  }
  if (cn.next) {
    const it = cn.next.item;
    const p = getPlace(it.place);
    const left = cn.next.startMs - now;
    const tomorrow = cn.next.date !== todayDate;
    const urgent = it.must && left <= time.HOUR;
    const z = it.clock === 'home' ? time.homeClock(cn.next.date, it.start, info) : null;
    parts.push(html`
      <section class="card next-card cat-${it.cat} ${urgent ? 'is-urgent' : ''}">
        <p class="now-label">▶ 다음${tomorrow ? ` · ${time.fmtDate(cn.next.date)}` : ''}</p>
        <h2>${z ? `한국 ${z.time}` : time.fmtItemTime(it)} ${it.title}${it.confirmed ? ' ✅' : ''}</h2>
        <p class="now-meta">${p ? `${p.name} · ` : ''}<b class="countdown">${time.fmtDuration(left)} 남음</b></p>
        ${it.must ? html`<p class="must-line"><span aria-hidden="true">⚠</span> 늦으면 안 되는 일정이에요${urgent ? ' — 이제 움직일 시간!' : ''}</p>` : ''}
        ${it.note ? html`<p class="muted small">${it.note}</p>` : ''}
        ${itemActionsHtml(it)}
      </section>`);
  }
  if (!cn.current && !cn.next) {
    parts.push(html`<section class="card"><h2>오늘 일정은 여기까지 🌙</h2><p class="muted">편안한 비행 되세요.</p></section>`);
  }
  return parts;
}

function ownerPromptHtml() {
  if (prefs().owner) return '';
  return html`
    <section class="card owner-ask">
      <h2>이 폰은 누구 폰인가요?</h2>
      <p class="muted small">경비를 적을 때 '누가 냈나요' 기본값으로 써요. 설정에서 바꿀 수 있어요.</p>
      <div class="btn-row">
        ${Object.entries(OWNERS).map(([k, v]) => html`<button type="button" class="btn btn-primary" data-owner="${k}">${v}</button>`)}
      </div>
    </section>`;
}

function installHtml() {
  if (isStandalone() || prefs().installHintDismissed) return '';
  const inApp = inAppBrowser();
  if (inApp) {
    return html`
      <section class="card install-hint">
        <h2>📲 ${inApp} 안에서 열렸어요</h2>
        <p>여기서는 홈 화면에 설치할 수 없어요. 메뉴(⋮ 또는 공유 버튼)에서 <b>다른 브라우저로 열기</b>를 눌러
        ${isIOS() ? 'Safari' : 'Chrome'} 로 연 다음 설치해 주세요.</p>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-action="copy-url">앱 주소 복사</button>
          <button type="button" class="btn" data-action="hide-install">닫기</button>
        </div>
      </section>`;
  }
  return html`
    <section class="card install-hint">
      <h2>📲 홈 화면에 설치해 주세요</h2>
      ${isIOS()
    ? html`<p>Safari 아래의 <b>공유 버튼</b> → <b>홈 화면에 추가</b>. 설치해야 기록이 지워지지 않고 인터넷 없이도 열려요.</p>`
    : html`<p>Chrome 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b> (또는 앱 설치). 인터넷 없이도 열려요.</p>`}
      <div class="btn-row">
        ${canPromptInstall() ? html`<button type="button" class="btn btn-primary" data-action="install">앱 설치</button>` : ''}
        <a class="btn" href="#/settings">설치 방법 자세히</a>
        <button type="button" class="btn" data-action="hide-install">닫기</button>
      </div>
    </section>`;
}

async function statusCardsHtml() {
  const st = await offlineStatus();
  const ws = wallet.status();
  return html`
    <section class="card ready">
      <h2>출발 준비 확인</h2>
      <ul class="ready-list">
        <li class="${st.ready ? 'ok' : 'wait'}"><a href="#/settings">${st.ready ? '✓ 오프라인 준비 완료' : (st.supported ? '… 오프라인 준비 중 (인터넷 연결 유지)' : '✗ 이 브라우저는 오프라인 저장을 지원하지 않아요')}</a></li>
        <li class="${ws === 'open' ? 'ok' : 'wait'}"><a href="#/wallet">${ws === 'open' ? `✓ 예약 지갑 열림 · 예약 ${wallet.bookings().length}건${wallet.missingCount() ? ` (번호 미입력 ${wallet.missingCount()}건)` : ''}` : ws === 'locked' ? '🔐 예약 지갑 잠김 — 비밀번호로 열어 두세요' : '예약 정보가 아직 등록되지 않았어요'}</a></li>
        <li class="${isStandalone() ? 'ok' : 'wait'}"><a href="#/settings">${isStandalone() ? '✓ 홈 화면 앱으로 실행 중' : '홈 화면에 설치하면 더 안전해요'}</a></li>
      </ul>
    </section>`;
}

function dayPreviewHtml(day, title) {
  return html`
    <h2 class="section-title">${title}</h2>
    <ol class="items">${day.items.map((it) => itemRowHtml(it, day, ''))}</ol>
    <a class="btn btn-block" href="#/day/${day.date}">${time.fmtDate(day.date)} 일정 자세히 ›</a>`;
}

async function renderBefore(root, trip, now, phase) {
  const info = trip.trip;
  const dep = (trip.flights || [])[0];
  const depMs = dep ? Date.parse(dep.dep) : time.zonedToEpoch(info.start, '00:00', info.tz);
  const prog = await progressBefore();
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const first = trip.days[0];
  setHTML(root, html`
    ${clockHtml(now, info, '')}
    <section class="card hero">
      <p class="hero-dday">${phase.dday === 0 ? 'D-DAY' : `D-${phase.dday}`}</p>
      <p class="hero-text">${phase.dday === 0 ? '오늘 출발해요! ' : ''}출발까지 <b>${time.fmtDuration(depMs - now)}</b></p>
      <p class="muted">${dep ? `${time.fmtZoned(depMs, info.home_tz)} 인천 출발 ${dep.no || ''} (한국 시간)` : time.fmtDate(info.start)}</p>
    </section>
    ${ownerPromptHtml()}
    ${installHtml()}
    <a class="card card-link" href="#/check?tab=before">
      <h2>✅ 출발 전 체크리스트</h2>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}" aria-label="체크리스트 진행률"><div class="progress-bar" data-pct="${pct}"></div></div>
      <p class="muted small">${prog.done}/${prog.total} 완료 (${pct}%) ›</p>
    </a>
    ${await statusCardsHtml()}
    ${dayPreviewHtml(first, `첫날 미리보기 · ${time.fmtDate(first.date)} ${first.title}`)}`);
}

async function renderDuring(root, trip, now, phase) {
  const info = trip.trip;
  const day = dayByDate(phase.date);
  const cn = time.currentAndNext(trip.days, now, info.tz);
  const h = day.hotel ? hotel(day.hotel) : null;
  const sub = [`${phase.dayIndex + 1}일차 (${phase.totalDays}일 중)`, islandLabel(day), h ? h.name : '귀국하는 날'].join(' · ');
  const checks = await getChecks();
  const packs = packingItems(day, checks);
  const money = await todaySummary();
  const wx = await weatherHtml(day.weather_zones, phase.date, { compact: true });
  const notices = await noticesForDate(phase.date);

  const stateOf = (it) => {
    if (cn.current && cn.current.item.id === it.id) return 'current';
    if (cn.past.has(it.id)) return 'past';
    if (cn.next && cn.next.item.id === it.id && cn.next.date === phase.date) return 'next';
    return '';
  };

  setHTML(root, html`
    ${clockHtml(now, info, sub)}
    ${wx}
    ${hotelBannersHtml(phase.date)}
    ${nowNextHtml(cn, now, info, phase.date)}
    ${notices.map((n) => html`<section class="card card-notice">${noticeHtml(n)}</section>`)}
    ${ownerPromptHtml()}
    ${installHtml()}

    <h2 class="section-title">오늘 일정 · ${day.title}</h2>
    <ol class="items">${day.items.map((it) => itemRowHtml(it, day, stateOf(it)))}</ol>
    <div class="btn-row">
      <a class="btn" href="#/day/${phase.date}">📅 오늘 자세히</a>
      <a class="btn" href="#/maps?m=day&d=${phase.date}">🗺 오늘 지도</a>
    </div>

    ${packs.length ? html`
      <section class="card">
        <h2>🎒 오늘 챙길 것</h2>
        <ul class="check-list">${packs.map((p) => html`
          <li class="check-row ${p.done ? 'is-done' : ''}"><label><input type="checkbox" data-check="${p.id}" ${p.done ? 'checked' : ''}><span class="check-text">${p.text}</span></label></li>`)}</ul>
        <a class="link-btn" href="#/check?tab=daily&d=${phase.date}">매일 공통 준비물 ›</a>
      </section>` : ''}

    <section class="card money-today">
      <h2>💰 오늘 쓴 돈</h2>
      <p class="money-line"><b>${fmtUSD(money.todayUsd)}</b> <span class="muted">(${fmtKRW(money.today)})</span></p>
      <div class="btn-row">
        <a class="btn btn-primary" href="#/money?add=1">+ 지출 추가</a>
        <a class="btn" href="#/money">경비 보기</a>
      </div>
    </section>`);
}

async function renderAfter(root, trip, now) {
  const info = trip.trip;
  const money = await todaySummary();
  setHTML(root, html`
    ${clockHtml(now, info, '')}
    <section class="card hero">
      <p class="hero-dday">🌺</p>
      <p class="hero-text">여행 끝! 수고했어요</p>
      <p class="muted">${time.fmtDate(info.start)} ~ ${time.fmtDate(info.end)} · ${trip.days.length}일</p>
    </section>
    <section class="card">
      <h2>💰 총 경비</h2>
      <p class="money-line"><b>${fmtKRW(money.all)}</b>${money.prepaid ? html` <span class="muted small">(사전 결제 ${fmtKRW(money.prepaid)} 포함)</span>` : ''}</p>
      <div class="btn-row"><a class="btn btn-primary" href="#/money">정산 보기</a><a class="btn" href="#/settings">백업 저장</a></div>
    </section>
    <a class="btn btn-block" href="#/days">📅 일정 다시 보기</a>`);
}

export async function render(root) {
  const trip = getTrip();
  const now = time.now();
  const phase = time.tripPhase(trip.trip, now);
  await wallet.initWallet();
  if (phase.phase === 'before') await renderBefore(root, trip, now, phase);
  else if (phase.phase === 'during') await renderDuring(root, trip, now, phase);
  else await renderAfter(root, trip, now);

  root.querySelectorAll('.progress-bar').forEach((el) => { el.style.width = `${el.dataset.pct}%`; });
  bindItemClicks(root);
  root.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-check]');
    if (!box) return;
    await setCheck(box.dataset.check, box.checked);
    box.closest('.check-row').classList.toggle('is-done', box.checked);
  });
  root.addEventListener('click', async (e) => {
    const owner = e.target.closest('[data-owner]');
    if (owner) {
      await setPref('owner', owner.dataset.owner);
      const card = owner.closest('.owner-ask');
      if (card) card.remove();
      return;
    }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'hide-install') { await setPref('installHintDismissed', true); a.closest('.install-hint').remove(); }
    if (a.dataset.action === 'install') { await promptInstall(); }
    if (a.dataset.action === 'copy-url') copyText(location.origin + location.pathname, '주소를 복사했어요. 브라우저 주소창에 붙여넣어 주세요.');
  });
}

export { openItemSheet };
