// 피드백 · 버그 알리기 — GitHub 이슈 작성 화면을 내용이 채워진 채로 연다 (또는 내용을 복사해 카톡으로)
import { html, setHTML, copyText, isStandalone } from './util.js';
import { offlineStatus } from './sw-client.js';
import * as time from './time.js';
import { getTrip } from './trip.js';
import { KINDS, REPO, issueUrl, issueBody, issueTitle, deviceLabel, getLastRoute, getLastError } from './feedback-core.js';

async function collectInfo() {
  let version = '';
  try { version = (await offlineStatus()).version || ''; } catch { /* 서비스 워커 없음 */ }
  const t = getTrip();
  const z = time.zoned(time.now(), (t && t.trip.tz) || 'Pacific/Honolulu');
  return {
    version, route: getLastRoute() || '', device: deviceLabel(navigator.userAgent || ''), width: window.innerWidth,
    standalone: isStandalone(), online: navigator.onLine !== false, hst: `${z.date} ${z.time}`, error: getLastError(),
  };
}

export async function render(root, ctx) {
  const q = ctx.query || {};
  let kind = KINDS[q.kind] ? q.kind : 'bug';
  const info = await collectInfo();
  if (q.err) info.error = String(q.err).slice(0, 200);

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> 🐞 피드백 · 버그 알리기</h1>
    <p class="banner banner-warn">GitHub 이슈는 <b>누구나 볼 수 있는 공개 글</b>이에요. 예약번호 · 전화번호 · 이름(성 포함) · 결제 금액 · 사진은 넣지 마세요.</p>
    <section class="card">
      <div class="seg" role="group" aria-label="피드백 종류">
        ${Object.entries(KINDS).map(([id, k]) => html`<button type="button" class="seg-btn ${id === kind ? 'is-on' : ''}" data-kind="${id}" aria-pressed="${id === kind ? 'true' : 'false'}">${k.title}</button>`)}
      </div>
      <label class="field"><span>제목</span>
        <input type="text" name="fb-title" maxlength="80" placeholder="예) 경비 받기 버튼이 안 보여요" autocomplete="off"></label>
      <label class="field"><span>내용</span>
        <textarea name="fb-text" rows="6" maxlength="4000" placeholder="어느 화면에서 무엇을 눌렀더니 어떻게 됐는지 적어 주세요.&#10;예) 더보기 → 경비 → 아래로 내려도 받기 버튼이 없어요">${q.err ? `오류 메시지: ${String(q.err).slice(0, 200)}\n\n어떤 화면에서 무엇을 하다가 생겼는지: ` : ''}</textarea></label>
      <label class="check-inline"><input type="checkbox" name="fb-info" checked> 앱 정보 함께 보내기 (버전 · 화면 · 기기 종류 — 개인 정보 없음)</label>
      <details class="how"><summary>함께 보내는 앱 정보 보기</summary><pre class="fb-preview" data-fb-preview></pre></details>
      <a class="btn btn-primary btn-block" data-fb-gh href="#" target="_blank" rel="noopener noreferrer">🐙 GitHub 이슈로 보내기</a>
      <button type="button" class="btn btn-block" data-fb-copy>📋 내용 복사 (카톡으로 보내기)</button>
      <p class="muted small">GitHub 에 로그인되어 있으면 내용이 채워진 이슈 작성 화면이 열려요. 마지막에 <b>Submit new issue</b> 를 눌러야 올라가요. GitHub 계정이 없으면 '내용 복사'로 우학에게 보내 주세요.</p>
      <p class="muted small">올라간 이슈 보기: <a href="https://github.com/${REPO}/issues" target="_blank" rel="noopener noreferrer">github.com/${REPO}/issues</a></p>
    </section>`);

  const $t = root.querySelector('[name="fb-title"]');
  const $x = root.querySelector('[name="fb-text"]');
  const $i = root.querySelector('[name="fb-info"]');
  const $gh = root.querySelector('[data-fb-gh]');
  const $pv = root.querySelector('[data-fb-preview]');
  const opts = () => ({ kind, title: $t.value, text: $x.value, info: $i.checked ? info : null });
  const update = () => {
    $gh.href = issueUrl(opts());
    $pv.textContent = $i.checked ? issueBody({ kind, text: '', info }).split('---')[1] || '' : '(보내지 않음)';
  };
  update();
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  root.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      kind = k.dataset.kind;
      root.querySelectorAll('[data-kind]').forEach((b) => { const on = b === k; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      update();
      return;
    }
    if (e.target.closest('[data-fb-copy]')) {
      const o = opts();
      copyText(`${issueTitle(o)}\n\n${issueBody(o)}`, '피드백 내용을 복사했어요. 카톡에 붙여넣어 보내 주세요.');
    }
  });
}
