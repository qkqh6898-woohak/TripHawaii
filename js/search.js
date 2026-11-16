// 통합 검색 — 앱에 저장된 맛집, 장소, 일정, 쇼핑 리스트를 즉시 검색한다.
import { html, setHTML } from './util.js';
import { getTrip, directionsTo } from './trip.js';
import { loadEats, searchUrl } from './gmap.js';
import { loadChecklists } from './checklist.js';
import { searchCatalog } from './search-core.js';

const FILTERS = [
  ['all', '전체'], ['food', '🍽 맛집'], ['places', '📍 장소'],
  ['schedule', '📅 일정'], ['shopping', '🛍 쇼핑'],
];
const GROUPS = [
  ['food', '🍽 맛집', '곳'],
  ['places', '📍 장소', '곳'],
  ['schedule', '📅 일정', '개'],
  ['shopping', '🛍 쇼핑 제품', '개'],
];
const EXAMPLES = ['우동', '포케', '커피', '세포라', '스투시'];

function rowHtml(item) {
  if (item.kind === 'schedule') return html`
    <li class="card search-card">
      <div class="search-card-title"><b>${item.title}</b><span class="tag">일정</span></div>
      <p class="muted small">${item.subtitle}${item.note ? ' · ' + item.note : ''}</p>
      <a class="link-btn" href="#/day/${item.date}">📅 해당 날짜 일정 보기 ›</a>
    </li>`;
  if (item.kind === 'shopping') return html`
    <li class="card search-card">
      <div class="search-card-title"><b>${item.title}</b></div>
      <p class="muted small">🛍 ${item.subtitle}</p>
      <a class="link-btn" href="#/check?tab=shopping&store=${encodeURIComponent(item.groupId)}">구매 체크리스트 보기 ›</a>
    </li>`;

  const plan = item.date ? html`<a class="btn btn-small" href="#/day/${item.date}">📅 일정 보기</a>` : '';
  return html`
    <li class="card search-card">
      <div class="search-card-title"><b>${item.kind === 'food' ? '🍽' : '📍'} ${item.title}</b>${item.date ? html` <span class="tag tag-booking">여행 일정에 있음</span>` : ''}</div>
      <p class="muted small">${item.subtitle}</p>
      ${item.note ? html`<p class="small">${item.note}</p>` : ''}
      ${item.address ? html`<p class="muted small">${item.address}</p>` : ''}
      <div class="btn-row">
        <a class="btn btn-small" href="${searchUrl(item.mapQuery)}" target="_blank" rel="noopener noreferrer">📍 지도</a>
        <a class="btn btn-small" href="${directionsTo(item.mapQuery, { island: item.island, stop: item.stop })}" target="_blank" rel="noopener noreferrer">🧭 길찾기</a>
        ${plan}
      </div>
    </li>`;
}

export async function render(root, ctx) {
  const [eats, lists] = await Promise.all([loadEats(), loadChecklists()]);
  const trip = getTrip();
  const initial = String((ctx.query && ctx.query.q) || '').slice(0, 100);
  let type = FILTERS.some(([k]) => k === (ctx.query && ctx.query.type)) ? ctx.query.type : 'all';

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/today" aria-label="오늘 화면으로">‹</a> 🔎 통합 검색</h1>
    <section class="card search-panel">
      <form role="search" data-search-form>
        <label for="trip-search-input" class="search-label">하와이 맛집 · 쇼핑 · 장소 · 일정</label>
        <div class="search-input-row">
          <input id="trip-search-input" type="search" data-search-input inputmode="search" enterkeyhint="search"
            placeholder="예: 우동, 포케, 세포라, 스투시" autocomplete="off" maxlength="100"
            spellcheck="false" value="${initial}" aria-controls="trip-search-results">
          <button type="button" class="btn btn-small" data-search-clear aria-label="검색어 지우기">지우기</button>
        </div>
      </form>
      <div class="chips chips-scroll" aria-label="빠른 검색어">
        ${EXAMPLES.map((v) => html`<button type="button" class="chip" data-example="${v}">${v}</button>`)}
      </div>
    </section>
    <nav class="chips chips-scroll" aria-label="검색 결과 필터" data-search-filters>
      ${FILTERS.map(([k, title]) => html`<button type="button" class="chip ${k === type ? 'is-on' : ''}" data-search-type="${k}" aria-pressed="${k === type}">${title}</button>`)}
    </nav>
    <div id="trip-search-results" data-search-results aria-live="polite"></div>
    <p class="muted small search-disclaimer">등록된 여행 자료에서 검색하며, 새 식당이나 실시간 영업 여부를 인터넷에서 찾아 주는 기능은 아니에요. 구글 지도·길찾기는 인터넷이 필요합니다.</p>
  `);

  const input = root.querySelector('[data-search-input]');
  const output = root.querySelector('[data-search-results]');
  const updateUrl = () => {
    const params = new URLSearchParams();
    if (input.value.trim()) params.set('q', input.value.trim());
    if (type !== 'all') params.set('type', type);
    const hash = '#/search' + (params.toString() ? '?' + params.toString() : '');
    // 입력마다 라우터를 새로 그리지 않으면서 뒤로 가기 때 검색어는 복원한다.
    history.replaceState(history.state, '', location.pathname + location.search + hash);
  };
  const draw = () => {
    const query = input.value.trim();
    updateUrl();
    if (!query) {
      setHTML(output, html`<section class="card search-empty"><h2>무엇을 찾으세요?</h2><p class="muted">위에서 '우동'을 누르면 츠루톤탄·마루카메 등 앱에 등록된 우동집을 찾을 수 있어요.</p></section>`);
      return;
    }
    const results = searchCatalog(trip, eats, lists, query);
    const selected = GROUPS.filter(([kind]) => type === 'all' || type === kind);
    const count = selected.reduce((n, [kind]) => n + results[kind].length, 0);
    if (!count) {
      setHTML(output, html`<section class="card search-empty"><h2>“${query}” 검색 결과가 없어요</h2><p class="muted small">다른 한글·영어 단어로 검색하거나 '전체' 필터를 선택해 보세요.</p></section>`);
      return;
    }
    setHTML(output, html`
      <p class="muted small search-count">“${query}” 검색 결과 ${count}개</p>
      ${selected.map(([kind, name, unit]) => {
        const entries = results[kind];
        if (!entries.length) return '';
        return html`
          <section class="search-section" aria-label="${name}">
            <h2 class="section-title">${name} <span class="muted small">${entries.length}${unit}</span></h2>
            <ul class="search-list">${entries.slice(0, 25).map(rowHtml)}</ul>
            ${entries.length > 25 ? html`<p class="muted small">상위 25개만 표시됩니다. 검색어를 더 구체적으로 입력해 보세요.</p>` : ''}
          </section>`;
      })}
    `);
  };

  input.addEventListener('input', draw);
  root.querySelector('[data-search-form]').addEventListener('submit', (e) => { e.preventDefault(); draw(); input.blur(); });
  root.querySelector('[data-search-clear]').addEventListener('click', () => { input.value = ''; draw(); input.focus(); });
  root.addEventListener('click', (e) => {
    const example = e.target.closest('[data-example]');
    if (example) { input.value = example.dataset.example; draw(); input.focus(); return; }
    const filter = e.target.closest('[data-search-type]');
    if (filter) {
      type = filter.dataset.searchType;
      root.querySelectorAll('[data-search-type]').forEach((btn) => {
        const active = btn.dataset.searchType === type;
        btn.classList.toggle('is-on', active);
        btn.setAttribute('aria-pressed', String(active));
      });
      draw();
    }
  });
  draw();
  // 처음 검색 아이콘으로 들어왔을 때 입력에 즉시 타이핑할 수 있게 한다.
  try { input.focus({ preventScroll: true }); } catch { /* 자동 포커스 차단 환경 */ }
}
