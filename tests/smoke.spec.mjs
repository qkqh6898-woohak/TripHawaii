#!/usr/bin/env node
// 스모크 테스트 (Playwright) — 실제 브라우저로 앱 전체 흐름을 한 번 훑는다.
//   node tests/smoke.spec.mjs            # 폰(390×844)·노트북(1280×800) 두 크기
//   node tests/smoke.spec.mjs --shots 폴더   # 화면 캡처도 저장
//
// 저장소를 건드리지 않도록 임시 폴더에 사이트 사본을 만들고, 거기에 테스트용 암호화 파일
// (tools/private-example.json 을 테스트 비밀번호로 암호화)을 넣어 서비스 워커까지 그대로 돌린다.
// 날씨·환율 API 는 가짜 응답으로 바꾼다. Playwright 가 없으면 건너뛴다(종료 코드 0).
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { encryptJSON, b64ToBytes, MIN_ITER } from '../js/crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'smoke-test-password';
const NOW = '2026-11-17T09:12';        // 하와이 시각으로 고정
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'laptop', width: 1280, height: 800 }];
const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? process.argv[shotsArg + 1] : null;

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.log('⏭  Playwright 가 없어 스모크 테스트를 건너뜁니다 (README 의 수동 점검표를 사용하세요)');
  process.exit(0);
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ───────────── 임시 사이트 만들기 ─────────────
async function buildSite() {
  const dir = mkdtempSync(join(tmpdir(), 'aloha-smoke-'));
  for (const name of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'data', 'maps', 'icons', 'photos']) {
    if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name), { recursive: true });
  }
  // 사진 묶음을 시험하려고 임시 사본에만 사진 두 장을 넣는다 (아이콘을 복사 — 저장소에는 넣지 않음)
  mkdirSync(join(dir, 'photos'), { recursive: true });
  for (const name of ['kualoa-valley.jpg', 'kualoa-beach.jpg']) cpSync(join(ROOT, 'icons', 'icon-192.png'), join(dir, 'photos', name));
  const secret = JSON.parse(readFileSync(join(ROOT, 'tools', 'private-example.json'), 'utf8'));
  secret.vouchers = { 'sample-tour.jpg': PNG_1PX };
  secret.photos = { 'hanauma.jpg': PNG_1PX };            // 암호화된 사진 (예약 지갑을 열어야 보임)
  // 실제 일정의 예약 id 하나를 넣어 '일정 → 예약' 연결도 확인한다
  secret.bookings.push({ id: 'kualoa', type: 'tour', title: '테스트 쿠알로아', date: '2026-11-17', numbers: [{ label: '확정번호', value: 'TESTCONF1' }], times: [], contacts: [], paid: { amount: 387190, currency: 'KRW' }, notes: [], vouchers: [] });
  mkdirSync(join(dir, 'data'), { recursive: true });
  const env = await encryptJSON(secret, PASSWORD, { iter: MIN_ITER });
  writeFileSync(join(dir, 'data', 'secret.enc'), JSON.stringify(env) + '\n');
  rebuildPrecache(dir);
  return { dir, secret, env };
}

function rebuildPrecache(dir) {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build-precache.mjs')], { env: { ...process.env, ALOHA_ROOT: dir }, stdio: 'pipe' });
}

function startServer(dir, port) {
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(port)], { env: { ...process.env, ALOHA_ROOT: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버가 뜨지 않았습니다')), 8000);
    child.stdout.on('data', () => { clearTimeout(timer); resolve(child); });
    child.on('exit', (code) => reject(new Error(`서버 종료 (${code})`)));
  });
}

function weatherJson() {
  const time = [];
  for (let i = 0; i < 16; i++) time.push(new Date(Date.UTC(2026, 10, 11 + i)).toISOString().slice(0, 10));
  const fill = (v) => time.map(() => v);
  return {
    latitude: 21.25, longitude: -157.75, timezone: 'Pacific/Honolulu',
    daily: {
      time, weather_code: fill(1), temperature_2m_max: fill(28.2), temperature_2m_min: fill(21.6),
      precipitation_probability_max: fill(20), uv_index_max: fill(9.1),
      sunrise: time.map((d) => `${d}T06:38`), sunset: time.map((d) => `${d}T17:49`),
    },
  };
}

// ───────────── 한 화면 크기의 전체 흐름 ─────────────
async function runFlow(browser, base, vp) {
  const log = (m) => console.log(`  [${vp.name}] ${m}`);
  const problems = [];
  const newContext = async () => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: 'ko-KR', acceptDownloads: true });
    await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(weatherJson()) }));
    await ctx.route(/frankfurter\.(dev|app)/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ amount: 1, base: 'USD', date: '2026-11-10', rates: { KRW: 1400 } }) }));
    await ctx.addInitScript(() => {
      window.__spoken = [];
      if (window.speechSynthesis) {
        const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang }); try { orig(u); } catch { /* 음성이 없는 환경 */ } };
      }
    });
    return ctx;
  };
  const watch = (page) => {
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/photos\//.test(m.text()) && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !/\/photos\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  };
  const ready = async (page) => { await page.waitForSelector('html.is-ready', { timeout: 10000 }); await page.waitForTimeout(250); };
  const go = async (page, hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction((h) => location.hash === h, hash);
    await page.waitForTimeout(350);
  };
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${vp.name}-${name}.png`), fullPage: true }); } };
  const text = (page, sel) => page.locator(sel).first().innerText();

  const ctx = await newContext();
  const page = await ctx.newPage();
  watch(page);

  // 1) 오늘: 하와이·한국 시각, 다음 일정과 남은 시간
  await page.goto(`${base}?now=${NOW}#/today`);
  await ready(page);
  const clocks = await page.locator('.clock-time').allInnerTexts();
  assert.deepEqual(clocks, ['11/17(화) 09:12', '11/18(수) 04:12'], '하와이·한국 시각');
  const next = await text(page, '.next-card');
  assert.match(next, /09:45/);
  assert.match(next, /33분 남음/);
  assert.match(await text(page, '.clock-sub'), /3일차.*오아후.*힐튼가든인/);
  assert.match(await page.locator('.next-card a.btn-primary').getAttribute('href'), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  log('오늘: 시각·다음 일정·길찾기 링크 ✓');

  // 2) 서비스 워커가 모든 파일을 저장할 때까지 기다림
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.active || !navigator.serviceWorker.controller) return false;
    return new Promise((res) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => res(e.data.total > 0 && e.data.cached >= e.data.total);
      reg.active.postMessage({ type: 'STATUS' }, [ch.port2]);
      setTimeout(() => res(false), 1500);
    });
  }, null, { timeout: 40000, polling: 500 });
  await go(page, '#/settings');
  await page.waitForSelector('[data-offline="ready"]', { timeout: 8000 });
  log('설정: 오프라인 준비 완료 ✓');

  // 3) 날씨(가짜 응답)가 오늘 화면에 보임
  await go(page, '#/today');
  await page.waitForFunction(() => /28°\/22°/.test(document.querySelector('#view').innerText), null, { timeout: 8000 });
  assert.match(await text(page, '.weather'), /일몰 17:49/);
  log('오늘: 날씨 ✓');
  await shot(page, 'today');

  // 4) 일정: 날짜 칩 13개, 시간 일정, 지도 이미지, 항목 상세 → 길찾기
  await go(page, '#/day/2026-11-17');
  assert.equal(await page.locator('.day-chips .chip').count(), 13);
  assert.equal(await page.locator('.items .item').count(), 8);
  await page.waitForFunction(() => { const i = document.querySelector('.map-frame img'); return i && i.complete && i.naturalWidth > 0; });
  assert.match(await page.locator('.video-link').first().getAttribute('href'), /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);   // 그날의 한국어 영상
  // 사진: 그날 묶음 2장, 항목에 📷 2, 항목 상세에서 크게 보기 → 버튼·밀기로 넘김
  const touch = (sel, x1, x2) => page.evaluate(([q, a1, a2]) => {
    const el = document.querySelector(q);
    const o = (x) => ({ bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 400 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(a1)));
    el.dispatchEvent(new PointerEvent('pointermove', o((a1 + a2) / 2)));
    el.dispatchEvent(new PointerEvent('pointerup', o(a2)));
  }, [sel, x1, x2]);
  assert.equal(await page.locator('.view .carousel-slide').count(), 2);
  assert.match(await text(page, '[data-item="1117-4"] .tag-photo'), /2/);
  assert.equal(await page.locator('[data-item="1117-1"] .tag-photo').count(), 0);
  await page.locator('[data-item="1117-4"]').click();
  await page.waitForSelector('.sheet .carousel-slide');
  assert.equal(await page.locator('.sheet .carousel-slide').count(), 2);
  await page.locator('.sheet .carousel-slide').first().click();
  await page.waitForSelector('.viewer img');
  assert.equal(await text(page, '.viewer-count'), '1 / 2');
  await page.locator('.viewer [data-v="next"]').click();
  assert.equal(await text(page, '.viewer-count'), '2 / 2');
  await touch('.viewer-stage', 100, 300);                               // 오른쪽으로 밀면 이전 사진
  assert.equal(await text(page, '.viewer-count'), '1 / 2');
  await touch('.viewer-stage', 300, 100);                               // 왼쪽으로 밀면 다음 사진
  assert.equal(await text(page, '.viewer-count'), '2 / 2');
  await touch('.viewer-stage', 300, 100);                               // 마지막에서는 제자리
  assert.equal(await text(page, '.viewer-count'), '2 / 2');
  await page.locator('.viewer [data-v="close"]').click();
  await page.locator('.sheet [data-sheet-close]').first().click();
  // 화면을 좌우로 밀어 날짜 이동
  await touch('.view .day-head', 320, 80);
  await page.waitForFunction(() => location.hash === '#/day/2026-11-18');
  await page.waitForSelector('.view-day');
  await page.waitForTimeout(300);
  await touch('.view .day-head', 80, 320);
  await page.waitForFunction(() => location.hash === '#/day/2026-11-17');
  await page.waitForTimeout(300);
  await touch('.view .day-head', 200, 230);                             // 조금만 움직이면 넘어가지 않음
  await touch('.view .day-chips', 320, 80);                             // 날짜 줄에서 시작한 동작은 무시
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => location.hash), '#/day/2026-11-17');
  await page.locator('[data-item="1117-3"]').click();
  await page.waitForSelector('.sheet');
  assert.match(await text(page, '.sheet'), /쿠알로아 랜치 티켓 오피스/);
  assert.match(await page.locator('.sheet .place-block a.btn-primary').getAttribute('href'), /google\.com\/maps\/dir/);
  assert.match(await text(page, '.sheet'), /예약 지갑에서 보기/);               // 아직 잠겨 있음
  await page.locator('.sheet .memo').fill('여권 챙기기 메모');
  await page.waitForFunction(() => /저장했어요/.test(document.querySelector('.memo-state').textContent), null, { timeout: 4000 });
  await page.locator('.sheet [data-sheet-close]').first().click();
  await shot(page, 'day');
  log('일정: 13일·시간 일정·지도·사진 넘기기·밀어서 날짜 이동·상세·메모 ✓');

  // 5) 지도: 탭 전환, 크게 보기(확대), 장소 목록
  await go(page, '#/maps?m=oahu');
  await page.waitForFunction(() => { const i = document.querySelector('.map-frame img'); return i && i.complete && i.naturalWidth > 0; });
  assert.ok(await page.locator('.place-row').count() >= 10);
  await page.locator('.map-frame').click();
  await page.waitForSelector('.viewer img');
  await page.locator('.viewer [data-v="zoom"]').click();
  assert.match(await page.locator('.viewer img').getAttribute('style'), /scale\(2\.5\)/);
  await page.locator('.viewer [data-v="close"]').click();
  await go(page, '#/maps?m=day&d=2026-11-20');
  assert.match(await page.locator('.map-frame img').getAttribute('src'), /day-1120\.png/);
  await shot(page, 'maps');
  log('지도: 섬별·날짜별·확대 ✓');

  // 6) 예약 지갑: 틀린 비밀번호 → 오류, 맞는 비밀번호 → 카드·복사·전화·바우처
  await go(page, '#/wallet');
  await page.waitForSelector('[data-form="unlock"]');
  await page.locator('input[name="password"]').fill('wrong-password');
  await page.locator('[data-form="unlock"] button[type="submit"]').click();
  await page.waitForFunction(() => { const e = document.querySelector('.form-error'); return e && !e.hidden; }, null, { timeout: 15000 });
  assert.match(await text(page, '.form-error'), /맞지 않아요.*1\/5/);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('[data-form="unlock"] button[type="submit"]').click();
  await page.waitForSelector('.wallet-card', { timeout: 15000 });
  assert.equal(await page.locator('.wallet-card').count() >= 3, true);
  assert.match(await text(page, '#booking-sample-tour'), /SAMPLE-ABC123/);
  assert.match(await page.locator('#booking-sample-tour a.contact').first().getAttribute('href'), /^tel:\+/);
  assert.equal(await page.locator('#booking-sample-hotel.is-missing').count(), 1);          // 번호 없는 예약은 흐리게
  await page.locator('#booking-sample-tour [data-voucher]').click();
  await page.waitForSelector('.viewer img');
  assert.match(await text(page, '.viewer-hint'), /밝기/);
  await page.locator('.viewer [data-v="close"]').click();
  await shot(page, 'wallet');
  log('예약: 잠금 해제·예약번호·전화·바우처 ✓');

  // 7) 새로 열어도 비밀번호 없이 열림 + 일정 상세에 예약번호가 붙음
  await page.reload();
  await ready(page);
  await page.waitForSelector('.wallet-card');
  await go(page, '#/day/2026-11-17');
  await page.locator('[data-item="1117-3"]').click();
  await page.waitForSelector('.sheet .wallet-card');
  assert.match(await text(page, '.sheet'), /TESTCONF1/);
  await page.locator('.sheet [data-sheet-close]').first().click();
  // 암호화된 사진: 지갑을 연 뒤에만 11/18 하나우마베이 항목에 보인다
  await go(page, '#/day/2026-11-18');
  assert.equal(await page.locator('.view .carousel-slide').count(), 1);
  assert.match(await page.locator('.view .carousel-slide img').getAttribute('src'), /^data:image\//);
  assert.match(await text(page, '[data-item="1118-3"] .tag-photo'), /1/);
  await go(page, '#/day/2026-11-17');
  await page.locator('[data-item="1117-3"]').click();
  await page.waitForSelector('.sheet .wallet-card');
  assert.equal(await page.locator('.sheet .memo').inputValue(), '여권 챙기기 메모');
  await page.locator('.sheet [data-sheet-close]').first().click();
  log('예약: 두 번째부터 비밀번호 없이 열림, 일정과 연결 ✓');

  // 8) 경비: $84 추가 → ₩117,600, 정산, 사전 결제 넣기, 팁 계산기
  await go(page, '#/money');
  await page.locator('[data-action="add"]').click();
  await page.waitForSelector('[data-form="expense"]');
  await page.locator('[data-form="expense"] input[name="amount"]').fill('84');
  await page.locator('[data-form="expense"] input[name="memo"]').fill('스모크 저녁');
  await page.locator('[data-form="expense"] .pick-item:has(input[name="payer"][value="woohak"])').click();
  await page.locator('[data-form="expense"] button[type="submit"]').click();
  await page.waitForSelector('.expense');
  assert.match(await text(page, '.money-summary'), /₩117,600/);
  assert.match(await text(page, '.settle'), /성희\s*→\s*우학\s*₩58,800/);
  await page.locator('[data-action="prepaid"]').click();
  await page.waitForFunction(() => /사전 결제/.test(document.querySelector('.money-total').innerText), null, { timeout: 5000 });
  assert.match(await text(page, '.money-total'), /₩604,790/);                              // 117,600 + 100,000 + 387,190
  await page.locator('[data-action="tip"]').click();
  await page.locator('[data-tip="amount"]').fill('80');
  assert.equal(await text(page, '[data-out="total"]'), '$96');
  assert.equal(await text(page, '[data-out="each"]'), '$48');
  await page.locator('.sheet [data-sheet-close]').first().click();
  await shot(page, 'money');
  log('경비: 입력·환산·정산·사전 결제·팁 ✓');

  // 9) 경비 보내기(QR) → 다른 폰에서 가져오기 → 한 번 더 받아도 중복 없음
  await page.locator('[data-action="share"]').click();
  await page.waitForSelector('.share .qr svg');
  const code = await page.locator('.share').getAttribute('data-code');
  assert.match(code, /^j1\./);
  await page.locator('.sheet [data-sheet-close]').first().click();
  const ctx2 = await newContext();
  const other = await ctx2.newPage();
  watch(other);
  await other.goto(`${base}?now=${NOW}#/import?d=${code}`);
  await ready(other);
  assert.match(await text(other, '#view'), /새 기록 3건/);            // 직접 입력 1 + 사전 결제 2
  await other.locator('[data-action="import"]').click();
  await other.waitForSelector('.expense');
  assert.match(await text(other, '.money-total'), /₩604,790/);
  await other.goto(`${base}?now=${NOW}#/import?d=${code}`);
  await other.reload();
  await ready(other);
  assert.match(await text(other, '#view'), /새 기록 0건/);
  assert.equal(await other.locator('[data-action="import"]').isDisabled(), true);
  await ctx2.close();
  log('경비: QR 코드로 보내고 받기, 중복 없음 ✓');

  // 10) 회화: 5문장, 듣기·천천히
  await go(page, '#/phrases/immigration');
  assert.equal(await page.locator('.phrase').count(), 5);
  await page.locator('.phrase').first().locator('[data-say="en"]').click();
  await page.locator('.phrase').first().locator('[data-say="slow"]').click();
  const spoken = await page.evaluate(() => window.__spoken);
  assert.equal(spoken.length, 2);
  assert.equal(spoken[0].text, "We're here on our honeymoon.");
  assert.equal(spoken[0].lang, 'en-US');
  assert.ok(spoken[1].rate < spoken[0].rate);
  await go(page, '#/phrases/rentalcar');
  assert.match(await text(page, '.phrase-mine'), /reservation under Gildong Hong/);       // 예약 지갑을 열면 예약자 이름이 들어감
  await shot(page, 'phrases');
  log('회화: 40문장 중 상황별 5문장·발음·이름 채우기 ✓');

  // 11) 체크리스트: 체크 → 새로 열어도 유지
  await go(page, '#/check?tab=before&who=all');
  await page.locator('[data-check="docs-passport"]').check();
  await page.waitForTimeout(200);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('[data-check="docs-passport"]').isChecked(), true);
  await shot(page, 'check');
  log('체크리스트: 저장 유지 ✓');

  // 12) 백업 → 모두 지우기 → 복원하면 같아짐
  await go(page, '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="backup"]').click()]);
  const backupPath = join(tmpdir(), `aloha-backup-${vp.name}-${Date.now()}.json`);
  await download.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  assert.equal(backup.expenses.length, 3);
  assert.equal('secret' in backup, false, '백업에는 예약 정보가 없어야 함');
  assert.ok(!JSON.stringify(backup).includes('SAMPLE-ABC123'));
  await page.locator('[data-action="wipe"]').click();
  await page.locator('.sheet [data-answer="yes"]').click();
  await page.waitForTimeout(500);
  await go(page, '#/money');
  assert.equal(await page.locator('.expense').count(), 0);
  await go(page, '#/settings');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-action="restore"]').click()]);
  await chooser.setFiles(backupPath);
  await page.waitForTimeout(600);
  await go(page, '#/money');
  assert.equal(await page.locator('.expense').count(), 3);
  assert.match(await text(page, '.money-total'), /₩604,790/);
  await go(page, '#/check?tab=before&who=all');
  assert.equal(await page.locator('[data-check="docs-passport"]').isChecked(), true);
  rmSync(backupPath, { force: true });
  log('백업 → 삭제 → 복원 동일 ✓');

  // 13) 오프라인(비행기 모드): 오늘·일정·지도·예약이 모두 열림
  // (모두 지우면서 저장해 둔 날씨도 지워졌으므로, 온라인 상태에서 한 번 다시 받아 둔다)
  await page.goto(`${base}?now=${NOW}#/today`);
  await page.reload();
  await ready(page);
  await page.waitForFunction(() => /28°\/22°/.test(document.querySelector('#view').innerText), null, { timeout: 8000 });
  await go(page, '#/wallet');
  await page.waitForSelector('[data-form="unlock"]');                 // 모두 지웠으므로 다시 잠김
  await ctx.setOffline(true);
  await page.reload();
  await ready(page);
  await page.locator('input[name="password"]').fill(PASSWORD);        // 오프라인에서도 저장된 파일로 열 수 있어야 함
  await page.locator('[data-form="unlock"] button[type="submit"]').click();
  await page.waitForSelector('.wallet-card', { timeout: 15000 });
  await go(page, '#/today');
  assert.match(await text(page, '.next-card'), /09:45/);
  assert.match(await text(page, '.weather'), /28°\/22°/);              // 마지막으로 받은 날씨
  assert.equal(await page.locator('.pill-off').count(), 1);
  await go(page, '#/day/2026-11-20');
  await page.waitForFunction(() => { const i = document.querySelector('.map-frame img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  await go(page, '#/maps?m=bigisland');
  await page.waitForFunction(() => { const i = document.querySelector('.map-frame img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  await go(page, '#/phrases/emergency');
  assert.equal(await page.locator('.phrase').count(), 5);
  await shot(page, 'offline-today');
  await ctx.setOffline(false);
  log('오프라인: 오늘·일정·지도·예약·회화 ✓');

  await ctx.close();
  return problems;
}

// ───────────── 여행 전·출발일·마지막 날·여행 후 화면 ─────────────
async function runPhases(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', serviceWorkers: 'block' });
  await ctx.route(/open-meteo|frankfurter/, (r) => r.abort());
  const page = await ctx.newPage();
  const view = async (now) => {
    await page.goto(`${base}?now=${encodeURIComponent(now)}#/today`);
    await page.reload();
    await page.waitForSelector('html.is-ready');
    await page.waitForTimeout(200);
    return page.locator('#view').innerText();
  };
  let t = await view('2026-11-14T10:00+09:00');                    // 한국 11/14 오전
  assert.match(t, /D-1/);
  assert.match(t, /출발까지 1일 12시간/);
  assert.match(t, /첫날 미리보기/);
  t = await view('2026-11-15T10:00+09:00');                        // 출발 당일 오전 (하와이는 아직 11/14)
  assert.match(t, /D-DAY/);
  assert.match(t, /오늘 출발해요/);
  t = await view('2026-11-15T22:00+09:00');                        // 공항, 출발 50분 전
  assert.match(t, /1일차/);
  assert.match(t, /한국 22:50 인천 출발 YP151/);
  assert.match(t, /50분 남음/);
  assert.match(t, /이제 움직일 시간/);                              // 늦으면 안 되는 일정 1시간 전 강조
  t = await view('2026-11-15T03:50');                              // 하와이 03:50 = 이륙
  assert.match(t, /비행 중/);
  assert.match(t, /도착까지 8시간 10분/);
  t = await view('2026-11-19T09:00');                              // 섬 이동일: 체크아웃·체크인 배너
  assert.match(t, /오늘 체크아웃 · 힐튼가든인/);
  assert.match(t, /오늘 체크인 · 코나코스트 리조트 \(16:00부터\)/);
  assert.match(t, /오아후 → 빅아일랜드/);
  t = await view('2026-11-27T15:00');                              // 귀국편 출발 직후
  assert.match(t, /13일차/);
  assert.match(t, /YP152 인천행 출발/);
  assert.doesNotMatch(t, /▶ 다음/);
  t = await view('2026-11-28T09:00');
  assert.match(t, /여행 끝/);
  await ctx.close();
  console.log('  [phases] 여행 전(D-1·D-DAY) · 출발 직전 · 비행 중 · 섬 이동일 · 마지막 날 · 여행 후 ✓');
}

// ───────────── 예약 정보 갱신: 같은 비밀번호로 다시 암호화 → 새 버전 적용 → 비밀번호 없이 바뀜 ─────────────
async function runUpdate(browser, base, site) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  await ctx.route(/open-meteo|frankfurter/, (r) => r.abort());
  const page = await ctx.newPage();
  const swReady = () => page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && reg.active && navigator.serviceWorker.controller);
  }, null, { timeout: 30000, polling: 300 });
  await page.goto(`${base}?now=${NOW}#/wallet`);
  await page.waitForSelector('html.is-ready');
  await swReady();
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('[data-form="unlock"] button[type="submit"]').click();
  await page.waitForSelector('#booking-sample-hotel.is-missing', { timeout: 15000 });

  // 저장소 쪽: 빠졌던 예약번호를 채워 같은 비밀번호·같은 salt 로 다시 암호화하고 캐시 목록을 갱신
  const next = JSON.parse(JSON.stringify(site.secret));
  next.bookings.find((b) => b.id === 'sample-hotel').numbers = [{ label: '예약번호', value: 'NEWHOTEL77' }];
  const env2 = await encryptJSON(next, PASSWORD, { iter: MIN_ITER, salt: b64ToBytes(site.env.salt) });
  writeFileSync(join(site.dir, 'data', 'secret.enc'), JSON.stringify(env2) + '\n');
  rebuildPrecache(site.dir);

  await page.reload();                                               // 앱을 다시 열면 새 버전을 받아 둔다
  await page.waitForSelector('html.is-ready');
  await page.waitForSelector('[data-apply-update]', { timeout: 30000 });
  assert.equal(await page.locator('#booking-sample-hotel.is-missing').count(), 1);   // 적용 전에는 예전 내용
  await Promise.all([page.waitForEvent('load'), page.locator('[data-apply-update]').click()]);
  await page.waitForSelector('html.is-ready');
  await page.waitForSelector('#booking-sample-hotel', { timeout: 15000 });
  await page.waitForFunction(() => /NEWHOTEL77/.test(document.querySelector('#view').innerText), null, { timeout: 15000 });
  assert.equal(await page.locator('[data-form="unlock"]').count(), 0, '비밀번호를 다시 묻지 않아야 함');
  assert.equal(await page.locator('#booking-sample-hotel.is-missing').count(), 0);
  await ctx.close();
  console.log('  [update] 예약 정보 갱신 → 새 버전 적용 → 비밀번호 없이 새 내용 ✓');
}

// ───────────── 실행 ─────────────
const site = await buildSite();
const dir = site.dir;
const port = 18000 + Math.floor(Math.random() * 1000);
const server = await startServer(dir, port);
const base = `http://localhost:${port}/TripHawaii/`;
const browser = await chromium.launch();
let failed = false;
try {
  console.log('▶ 시각별 화면');
  await runPhases(browser, base);
  for (const vp of VIEWPORTS) {
    console.log(`▶ ${vp.name} ${vp.width}×${vp.height}`);
    const problems = await runFlow(browser, base, vp);
    if (problems.length) {
      failed = true;
      console.error(`  [${vp.name}] 브라우저 오류 ${problems.length}건:\n   ` + [...new Set(problems)].join('\n   '));
    }
  }
  console.log('▶ 예약 정보 갱신');
  await runUpdate(browser, base, site);
} catch (e) {
  failed = true;
  console.error('❌ ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? '\n❌ 스모크 테스트 실패' : '\n✅ 스모크 테스트 통과');
process.exit(failed ? 1 : 0);
