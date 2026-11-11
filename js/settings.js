// 설정 — 이 폰 주인, 화면, 환율, 예약 잠금, 오프라인 준비 상태, 백업/복원, 설치 방법
import * as db from './db.js';
import { html, setHTML, toast, confirmSheet, downloadFile, pickFileText, fmtKRW, isIOS, isStandalone } from './util.js';
import { prefs, setPref, loadPrefs, OWNERS, DEFAULT_RATE } from './prefs.js';
import { offlineStatus, checkForUpdate, updateReady, applyUpdate, swSupported } from './sw-client.js';
import { mergeExpenses, sanitizeExpense, listExpenses } from './expenses.js';
import * as wallet from './wallet.js';
import * as weather from './weather.js';
import * as time from './time.js';

export const live = ['offline', 'sw-update'];

const RATE_URLS = [
  'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW',
  'https://api.frankfurter.app/latest?from=USD&to=KRW',
];

// 최신 환율 (Frankfurter, 무료·키 없음). 엉뚱한 값은 버린다.
export async function fetchRate() {
  for (const url of RATE_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      const r = j && j.rates ? Number(j.rates.KRW) : NaN;
      if (r > 500 && r < 5000) return { rate: Math.round(r * 10) / 10, date: typeof j.date === 'string' ? j.date : null };
    } catch { /* 다음 주소로 */ }
  }
  throw new Error('환율을 가져오지 못했어요. 인터넷 연결을 확인하거나 직접 입력해 주세요.');
}

// 사용자가 직접 정하지 않았다면 온라인일 때 한 번 자동으로 최신 환율을 넣는다
export async function autoRate() {
  const p = prefs();
  if (p.rateSource === 'manual') return false;
  const today = new Date().toISOString().slice(0, 10);
  if (p.rateSource === 'auto' && p.rateDate && p.rateFetched === today) return false;
  if (navigator.onLine === false) return false;
  try {
    const r = await fetchRate();
    await setPref('rate', r.rate);
    await setPref('rateDate', r.date);
    await setPref('rateSource', 'auto');
    await setPref('rateFetched', today);
    return true;
  } catch {
    return false;
  }
}

// ───────────── 백업 / 복원 (예약 정보는 포함하지 않는다) ─────────────
const BACKUP_PREFS = ['owner', 'rate', 'rateDate', 'rateSource', 'fee', 'theme', 'font', 'ttsRate', 'favPhrases'];

export async function buildBackup() {
  const p = prefs();
  return {
    app: 'alohatrip', v: 1, kind: 'backup', exportedAt: Date.now(), device: p.deviceId,
    expenses: await db.getAll('expenses'),
    checks: await db.getAll('checks'),
    notes: await db.getAll('notes'),
    settings: Object.fromEntries(BACKUP_PREFS.map((k) => [k, p[k]])),
  };
}

const cleanCheck = (c) => (c && typeof c.id === 'string' && c.id.length <= 120
  ? { id: c.id, done: !!c.done, by: typeof c.by === 'string' ? c.by.slice(0, 16) : null, updatedAt: Number(c.updatedAt) || 0 } : null);
const cleanNote = (n) => (n && typeof n.id === 'string' && n.id.length <= 60 && typeof n.text === 'string'
  ? { id: n.id, text: n.text.slice(0, 2000), updatedAt: Number(n.updatedAt) || 0 } : null);

// 백업 파일 내용을 합친다 (같은 항목은 나중에 고친 쪽). 반환: 가져온 개수
export async function restoreBackup(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('백업 파일을 읽을 수 없어요.'); }
  if (!doc || doc.app !== 'alohatrip') throw new Error('Aloha Trip 백업 파일이 아니에요.');
  const result = { expenses: 0, checks: 0, notes: 0 };

  const incoming = (Array.isArray(doc.expenses) ? doc.expenses : []).map(sanitizeExpense).filter(Boolean);
  const merged = mergeExpenses(await listExpenses(), incoming);
  if (merged.changed.length) await db.bulkPut('expenses', merged.changed);
  result.expenses = merged.changed.length;

  for (const [store, clean] of [['checks', cleanCheck], ['notes', cleanNote]]) {
    const local = new Map((await db.getAll(store)).map((r) => [r.id, r]));
    const rows = (Array.isArray(doc[store]) ? doc[store] : []).map(clean).filter(Boolean)
      .filter((r) => !local.has(r.id) || (r.updatedAt || 0) > (local.get(r.id).updatedAt || 0));
    if (rows.length) await db.bulkPut(store, rows);
    result[store] = rows.length;
  }

  if (doc.settings && typeof doc.settings === 'object') {
    const p = prefs();
    const s = doc.settings;
    if (!p.owner && (s.owner === 'woohak' || s.owner === 'seonghee')) await setPref('owner', s.owner);
    if (Array.isArray(s.favPhrases)) {
      const favs = [...new Set([...(p.favPhrases || []), ...s.favPhrases.filter((x) => typeof x === 'string' && x.length < 20)])];
      await setPref('favPhrases', favs);
    }
    if (p.rateSource === 'default' && Number(s.rate) > 500 && Number(s.rate) < 5000) {
      await setPref('rate', Number(s.rate));
      await setPref('rateSource', 'manual');
    }
  }
  return result;
}

export async function wipeAll() {
  for (const store of Object.keys(db.STORES)) await db.clear(store);
  await wallet.lockNow();
  await loadPrefs();
}

function segHtml(name, options, value) {
  return html`<div class="pick" role="group">${Object.entries(options).map(([k, label]) => html`
    <label class="pick-item"><input type="radio" name="${name}" value="${k}" ${String(value) === k ? 'checked' : ''}><span>${label}</span></label>`)}</div>`;
}

function offlineHtml(st) {
  if (!st.supported) return html`<p class="status status-bad">✗ 이 브라우저는 오프라인 저장을 지원하지 않아요.</p>`;
  if (st.ready) return html`<p class="status status-ok" data-offline="ready">✓ 오프라인 준비 완료 <span class="muted small">(파일 ${st.cached}/${st.total} · 버전 ${st.version})</span></p>`;
  if (st.total) return html`<p class="status status-wait" data-offline="partial">… 저장 중 (파일 ${st.cached}/${st.total}) — 잠시 뒤 다시 확인해 주세요</p>`;
  return html`<p class="status status-wait" data-offline="waiting">… 오프라인 준비 중 — 인터넷에 연결한 채로 잠시 기다린 뒤 '다시 확인'을 눌러 주세요</p>`;
}

export async function render(root, ctx) {
  const p = prefs();
  const st = await offlineStatus();
  const persisted = await db.isPersisted();
  const walletState = wallet.status();
  const ios = isIOS();

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> ⚙️ 설정</h1>

    <section class="card">
      <h2>이 폰 주인</h2>
      ${segHtml('owner', OWNERS, p.owner || '')}
      <p class="muted small">경비의 '누가 냈나요' 기본값과 회화 문장에 쓰여요.</p>
    </section>

    <section class="card">
      <h2>화면</h2>
      <h3 class="set-label">글자 크기</h3>
      ${segHtml('font', { s: '작게', m: '보통', l: '크게' }, p.font)}
      <h3 class="set-label">밝기</h3>
      ${segHtml('theme', { auto: '자동', light: '밝게', dark: '어둡게' }, p.theme)}
      <h3 class="set-label">영어 발음 속도</h3>
      ${segHtml('ttsRate', { 0.85: '느리게', 1: '보통', 1.15: '빠르게' }, p.ttsRate)}
    </section>

    <section class="card">
      <h2>환율 · 수수료</h2>
      <label class="field"><span>1달러 = 몇 원</span>
        <input type="text" inputmode="decimal" name="rate" value="${p.rate}" aria-describedby="rate-help"></label>
      <p class="muted small" id="rate-help">${p.rateSource === 'auto' ? `자동으로 받은 값${p.rateDate ? ` (${p.rateDate} 기준)` : ''}` : p.rateSource === 'manual' ? '직접 입력한 값' : `기본값 ${fmtKRW(DEFAULT_RATE)} — 인터넷에 연결되면 자동으로 최신 값이 들어와요`}
      · 이미 입력한 지출은 입력한 날의 환율 그대로예요.</p>
      <button type="button" class="btn" data-action="rate">최신 환율 가져오기</button>
      <label class="field"><span>해외 카드 결제 수수료 (%)</span>
        <input type="text" inputmode="decimal" name="fee" value="${p.fee}"></label>
    </section>

    <section class="card">
      <h2>예약 지갑</h2>
      <p class="status">${walletState === 'open' ? '🔓 열려 있어요 (이 폰에 저장됨)' : walletState === 'locked' ? '🔐 잠겨 있어요' : '예약 정보가 아직 등록되지 않았어요'}</p>
      <label class="check-inline"><input type="checkbox" name="lock" ${p.lock ? 'checked' : ''}> 열 때마다 비밀번호 묻기 (이 폰에 저장하지 않음)</label>
      ${walletState === 'open' ? html`<button type="button" class="btn" data-action="lock-now">지금 잠그기</button>` : ''}
    </section>

    <section class="card">
      <h2>오프라인 준비</h2>
      ${offlineHtml(st)}
      <p class="status ${persisted ? 'status-ok' : ''}">${persisted ? '✓ 저장 공간 보호됨' : '저장 공간 보호: 홈 화면에 설치하면 기록이 지워지지 않아요'}</p>
      ${db.state.ephemeral ? html`<p class="banner banner-warn">지금은 기록이 임시로만 저장돼요 (비공개 탭일 수 있어요). 일반 탭이나 설치한 앱에서 열어 주세요.</p>` : ''}
      ${updateReady() ? html`<button type="button" class="btn btn-primary btn-block" data-action="apply-update">새 버전 적용하기</button>` : ''}
      <div class="btn-row">
        <button type="button" class="btn" data-action="recheck">다시 확인</button>
        <button type="button" class="btn" data-action="update">업데이트 확인</button>
        <button type="button" class="btn" data-action="weather">날씨 새로 받기</button>
      </div>
      <p class="muted small">출발 전에 '오프라인 준비 완료 ✓'가 보이는지 확인하고, 비행기 모드에서 오늘·일정·지도·예약을 한 번 열어 보세요.</p>
    </section>

    <section class="card">
      <h2>백업</h2>
      <p class="muted small">경비·체크·메모를 파일로 저장해요. 예약 정보(비밀번호로 여는 내용)는 들어가지 않아요.</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="backup">백업 파일 저장</button>
        <button type="button" class="btn" data-action="restore">백업 가져오기</button>
      </div>
    </section>

    <section class="card">
      <h2>홈 화면에 설치</h2>
      ${isStandalone() ? html`<p class="status status-ok">✓ 설치한 앱으로 열려 있어요</p>` : ''}
      <details ${ios ? '' : 'open'}><summary>안드로이드 (Chrome)</summary>
        <ol class="steps"><li>Chrome 으로 이 주소를 열어요.</li><li>오른쪽 위 ⋮ → <b>홈 화면에 추가</b> (또는 <b>앱 설치</b>).</li><li>홈 화면의 '하와이' 아이콘으로 열어요.</li></ol></details>
      <details ${ios ? 'open' : ''}><summary>아이폰 (Safari)</summary>
        <ol class="steps"><li><b>Safari</b> 로 이 주소를 열어요 (카톡 안에서 열렸다면 Safari 로 다시 열기).</li><li>아래 가운데 공유 버튼 → <b>홈 화면에 추가</b>.</li><li>홈 화면의 '하와이' 아이콘으로 열고, 예약 비밀번호를 한 번 입력해요.</li></ol>
        <p class="muted small">아이폰은 홈 화면 앱과 Safari 의 저장 공간이 달라요. 설치한 뒤에는 홈 화면 앱만 써 주세요.</p></details>
    </section>

    <section class="card">
      <h2>앱 정보</h2>
      <p class="muted small">Aloha Trip · 버전 ${st.version || '확인 중'}${time.hasNowOverride() ? ' · 미리보기 시각 사용 중' : ''}<br>
      날씨 Open-Meteo · 환율 Frankfurter · 지도는 약도(해안선 GSHHG)입니다.</p>
      <button type="button" class="btn btn-danger" data-action="wipe">이 폰의 기록 모두 지우기</button>
    </section>`);

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'owner') { await setPref('owner', t.value); toast(`${OWNERS[t.value]} 폰으로 설정했어요`); }
    if (t.name === 'font') await setPref('font', t.value);
    if (t.name === 'theme') await setPref('theme', t.value);
    if (t.name === 'ttsRate') await setPref('ttsRate', Number(t.value) || 1);
    if (t.name === 'rate') {
      const v = Number(String(t.value).replace(/[^\d.]/g, ''));
      if (v > 500 && v < 5000) { await setPref('rate', v); await setPref('rateSource', 'manual'); await setPref('rateDate', null); toast('환율을 바꿨어요'); ctx.rerender(); } else { toast('환율은 500~5000 사이로 입력해 주세요'); t.value = prefs().rate; }
    }
    if (t.name === 'fee') {
      const v = Number(String(t.value).replace(/[^\d.]/g, ''));
      if (v >= 0 && v <= 10) { await setPref('fee', v); toast('수수료를 바꿨어요'); } else { toast('수수료는 0~10% 사이로 입력해 주세요'); t.value = prefs().fee; }
    }
    if (t.name === 'lock') {
      await setPref('lock', t.checked);
      if (t.checked) { await db.del('secret', 'main'); toast('이제 열 때마다 비밀번호를 물어요'); } else toast('다음에 열면 이 폰에 저장돼요');
    }
  });

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'rate') {
      a.disabled = true;
      try {
        const r = await fetchRate();
        await setPref('rate', r.rate); await setPref('rateDate', r.date); await setPref('rateSource', 'auto');
        toast(`1달러 = ${fmtKRW(r.rate)}`);
        ctx.rerender();
      } catch (err) { toast(err.message, 3500); a.disabled = false; }
    }
    if (act === 'lock-now') {
      if (await confirmSheet('예약 지갑을 잠글까요? 다시 보려면 비밀번호가 필요해요.', { ok: '잠그기', title: '예약 지갑 잠그기' })) { await wallet.lockNow(); toast('잠갔어요'); ctx.rerender(); }
    }
    if (act === 'recheck') ctx.rerender();
    if (act === 'update') { toast((await checkForUpdate()) ? '업데이트를 확인했어요' : '지금은 확인할 수 없어요'); setTimeout(() => ctx.rerender(), 1500); }
    if (act === 'apply-update') applyUpdate();
    if (act === 'weather') {
      const r = await weather.refreshAll(true);
      toast(r.updated ? `날씨를 새로 받았어요 (${r.updated}곳)` : '날씨를 받지 못했어요 (오프라인일 수 있어요)');
    }
    if (act === 'backup') {
      const doc = await buildBackup();
      downloadFile(`aloha-trip-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(doc, null, 1));
      toast('백업 파일을 저장했어요');
    }
    if (act === 'restore') {
      const f = await pickFileText();
      if (!f) return;
      try {
        const r = await restoreBackup(f.text);
        toast(`가져왔어요 — 경비 ${r.expenses} · 체크 ${r.checks} · 메모 ${r.notes}`, 3500);
        ctx.rerender();
      } catch (err) { toast(err.message, 3500); }
    }
    if (act === 'wipe') {
      const ok = await confirmSheet('이 폰에 저장된 경비·체크·메모·설정과 예약 정보를 모두 지울까요? 되돌릴 수 없어요. (먼저 백업을 권장해요)', { ok: '모두 지우기', danger: true, title: '기록 모두 지우기' });
      if (!ok) return;
      await wipeAll();
      toast('모두 지웠어요');
      ctx.rerender();
    }
  });
}
