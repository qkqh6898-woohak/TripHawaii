// 더보기 — 체크리스트·경비·회화·설정으로 가는 문
import { html, setHTML, fmtKRW, fmtUSD } from './util.js';
import { progressBefore } from './checklist.js';
import { todaySummary } from './expenses.js';
import { prefs } from './prefs.js';
import { getTrip } from './trip.js';
import * as time from './time.js';

export async function render(root) {
  const trip = getTrip();
  const phase = time.tripPhase(trip.trip);
  const prog = await progressBefore();
  const money = await todaySummary();
  const favs = (prefs().favPhrases || []).length;

  setHTML(root, html`
    <h1 class="page-title">☰ 더보기</h1>
    <div class="menu">
      <a class="card menu-item" href="#/check">
        <span class="menu-icon" aria-hidden="true">✅</span>
        <span class="menu-text"><b>체크리스트</b><span class="muted small">${phase.phase === 'before' ? `출발 전 ${prog.done}/${prog.total} 완료` : '매일 준비물 · 귀국 전 · 반입 금지 음식'}</span></span>
        <span class="menu-go" aria-hidden="true">›</span>
      </a>
      <a class="card menu-item" href="#/money">
        <span class="menu-icon" aria-hidden="true">💰</span>
        <span class="menu-text"><b>경비</b><span class="muted small">오늘 ${fmtUSD(money.todayUsd)} · 총 ${fmtKRW(money.all)} · 정산 · 팁 계산기</span></span>
        <span class="menu-go" aria-hidden="true">›</span>
      </a>
      <a class="card menu-item" href="#/phrases">
        <span class="menu-icon" aria-hidden="true">🗣</span>
        <span class="menu-text"><b>여행 영어</b><span class="muted small">상황 8개 · 40문장 · 발음 듣기${favs ? ` · ★ ${favs}` : ''}</span></span>
        <span class="menu-go" aria-hidden="true">›</span>
      </a>
      <a class="card menu-item" href="#/settings">
        <span class="menu-icon" aria-hidden="true">⚙️</span>
        <span class="menu-text"><b>설정</b><span class="muted small">환율 · 글자 크기 · 오프라인 준비 · 백업 · 설치 방법</span></span>
        <span class="menu-go" aria-hidden="true">›</span>
      </a>
    </div>

    <section class="card emergency">
      <h2>🆘 급할 때</h2>
      <p>경찰·구급차·소방은 모두 <a class="tel-big" href="tel:911">911</a></p>
      <p class="muted small">위치를 물으면 호텔 이름이나 일정 화면의 주소를 그대로 읽어 주세요.
      전화로 말하기 어려우면 <a href="#/phrases/emergency">긴급 회화</a>를 열어 들려줘도 돼요.</p>
    </section>

    <p class="muted small center">${trip.trip.title}<br>${time.fmtDate(trip.trip.start)} ~ ${time.fmtDate(trip.trip.end)}</p>`);
}
