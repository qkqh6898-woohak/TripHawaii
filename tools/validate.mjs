#!/usr/bin/env node
// 데이터 검증: data/trip.json · data/phrases.json · data/checklists.json (+ 선택: private 원본과 예약 id 대조)
//   node tools/validate.mjs                # 공개 데이터 검증
//   node tools/validate.mjs --with-secret  # private/trip-secret.json 의 예약 id 와도 대조
// 문제가 있으면 한국어 메시지를 출력하고 종료 코드 1.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CATS = ['move', 'hotel', 'sight', 'shop', 'food', 'tour', 'rest'];
export const ISLANDS = ['oahu', 'bigisland'];
// 하와이 범위 (plan 3.2)
export const BOUNDS = { latMin: 18.5, latMax: 22.5, lngMin: -160.5, lngMax: -154.5 };

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const RE_ID = /^[a-z0-9][a-z0-9-]*$/;

function isRealDate(s) {
  if (!RE_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function nextDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * @param {object} trip  trip.json 내용
 * @param {object} [opts]
 * @param {(relPath:string)=>boolean} [opts.fileExists]  지도·사진 파일 존재 확인 함수
 * @param {string[]} [opts.bookingIds]  private 원본의 예약 id 목록 (있으면 참조 무결성 검사)
 * @returns {{errors:string[], warnings:string[]}}
 */
export function validateTrip(trip, opts = {}) {
  const errors = [];
  const warnings = [];
  const fileExists = opts.fileExists || (() => true);
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!trip || typeof trip !== 'object') return { errors: ['trip.json: 객체가 아닙니다'], warnings };
  if (trip.schema !== 1) err(`schema: 1 이어야 합니다 (지금 값: ${JSON.stringify(trip.schema)})`);

  const t = trip.trip || {};
  if (!t.title) err('trip.title 이 없습니다');
  if (!isRealDate(t.start || '')) err(`trip.start 날짜 형식이 올바르지 않습니다: ${t.start}`);
  if (!isRealDate(t.end || '')) err(`trip.end 날짜 형식이 올바르지 않습니다: ${t.end}`);
  if (!t.tz) err('trip.tz 가 없습니다');
  if (!t.home_tz) err('trip.home_tz 가 없습니다');

  // 날씨 구역
  const zones = new Set();
  (trip.weather_zones || []).forEach((z, i) => {
    const at = `weather_zones[${i}]`;
    if (!z.id || !RE_ID.test(z.id)) err(`${at}: id 형식이 올바르지 않습니다`);
    if (zones.has(z.id)) err(`${at}: id "${z.id}" 가 중복됩니다`);
    zones.add(z.id);
    if (typeof z.lat !== 'number' || typeof z.lng !== 'number') err(`${at}: lat/lng 는 숫자여야 합니다`);
  });

  // 장소
  const places = new Map();
  if (!Array.isArray(trip.places) || trip.places.length === 0) err('places 가 비어 있습니다');
  (trip.places || []).forEach((p, i) => {
    const at = `places[${i}]${p && p.id ? ` (${p.id})` : ''}`;
    if (!p.id || !RE_ID.test(p.id)) err(`${at}: id 형식이 올바르지 않습니다`);
    if (places.has(p.id)) err(`${at}: id "${p.id}" 가 중복됩니다`);
    places.set(p.id, p);
    if (!p.name) err(`${at}: name 이 없습니다`);
    if (!CATS.includes(p.cat)) err(`${at}: cat "${p.cat}" 는 ${CATS.join(', ')} 중 하나여야 합니다`);
    if (!ISLANDS.includes(p.island)) err(`${at}: island "${p.island}" 는 ${ISLANDS.join(', ')} 중 하나여야 합니다`);
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      err(`${at}: lat/lng 는 숫자여야 합니다`);
    } else if (p.lat < BOUNDS.latMin || p.lat > BOUNDS.latMax || p.lng < BOUNDS.lngMin || p.lng > BOUNDS.lngMax) {
      err(`${at}: 좌표 (${p.lat}, ${p.lng}) 가 하와이 범위를 벗어났습니다`);
    }
    if (!p.addr) warn(`${at}: addr(주소)가 없습니다`);
    if (p.weather_zone && !zones.has(p.weather_zone)) err(`${at}: weather_zone "${p.weather_zone}" 가 weather_zones 에 없습니다`);
  });

  // 숙소
  const hotels = new Map();
  (trip.hotels || []).forEach((h, i) => {
    const at = `hotels[${i}]${h && h.id ? ` (${h.id})` : ''}`;
    if (!h.id || !RE_ID.test(h.id)) err(`${at}: id 형식이 올바르지 않습니다`);
    if (hotels.has(h.id)) err(`${at}: id "${h.id}" 가 중복됩니다`);
    hotels.set(h.id, h);
    if (!places.has(h.place)) err(`${at}: place "${h.place}" 가 places 에 없습니다`);
    if (!isRealDate(h.checkin || '') || !isRealDate(h.checkout || '')) err(`${at}: checkin/checkout 날짜 형식이 올바르지 않습니다`);
    else if (h.checkin >= h.checkout) err(`${at}: checkout 이 checkin 보다 뒤여야 합니다`);
    for (const k of ['checkin_time', 'checkout_time']) {
      if (h[k] != null && !RE_TIME.test(h[k])) err(`${at}: ${k} "${h[k]}" 는 HH:MM 형식이어야 합니다`);
    }
  });

  // 항공편
  const flights = new Set();
  (trip.flights || []).forEach((f, i) => {
    const at = `flights[${i}]${f && f.id ? ` (${f.id})` : ''}`;
    if (!f.id || !RE_ID.test(f.id)) err(`${at}: id 형식이 올바르지 않습니다`);
    if (flights.has(f.id)) err(`${at}: id "${f.id}" 가 중복됩니다`);
    flights.add(f.id);
    if (!RE_ISO_TZ.test(f.dep || '')) err(`${at}: dep 는 시간대가 붙은 ISO 형식이어야 합니다 (예: 2026-11-15T22:50+09:00)`);
    if (f.arr != null && !RE_ISO_TZ.test(f.arr)) err(`${at}: arr 형식이 올바르지 않습니다`);
    if (f.arr && RE_ISO_TZ.test(f.dep || '') && Date.parse(f.arr) <= Date.parse(f.dep)) err(`${at}: 도착이 출발보다 빠릅니다`);
  });

  // 날짜별 일정
  const bookingRefs = new Set();
  const itemIds = new Set();
  const days = Array.isArray(trip.days) ? trip.days : [];
  if (days.length === 0) err('days 가 비어 있습니다');
  let expected = t.start;
  days.forEach((d, di) => {
    const at = `days[${di}]${d && d.date ? ` (${d.date})` : ''}`;
    if (!isRealDate(d.date || '')) { err(`${at}: date 형식이 올바르지 않습니다`); return; }
    if (expected && d.date !== expected) err(`${at}: 날짜가 연속되지 않습니다 — ${expected} 이(가) 와야 합니다`);
    expected = nextDate(d.date);
    if (!ISLANDS.includes(d.island)) err(`${at}: island "${d.island}" 가 올바르지 않습니다`);
    if (d.to_island != null && !ISLANDS.includes(d.to_island)) err(`${at}: to_island "${d.to_island}" 가 올바르지 않습니다`);
    if (!d.title) err(`${at}: title 이 없습니다`);
    if (d.hotel != null && !hotels.has(d.hotel)) err(`${at}: hotel "${d.hotel}" 가 hotels 에 없습니다`);
    if (!d.map) err(`${at}: map(지도 파일)이 없습니다`);
    else if (!fileExists(d.map)) err(`${at}: 지도 파일이 없습니다 — ${d.map}`);
    for (const ph of d.photos || []) {
      if (!ph.src) err(`${at}: photos 항목에 src 가 없습니다`);
      else if (!fileExists(ph.src)) warn(`${at}: 사진 파일이 아직 없습니다 — ${ph.src}`);
    }
    for (const z of d.weather_zones || []) if (!zones.has(z)) err(`${at}: weather_zones "${z}" 가 없습니다`);
    if (!Array.isArray(d.packing)) err(`${at}: packing 은 배열이어야 합니다`);
    if (!Array.isArray(d.items) || d.items.length === 0) { err(`${at}: items 가 비어 있습니다`); return; }

    let prev = null;
    d.items.forEach((it, ii) => {
      const ia = `${at}.items[${ii}]${it && it.id ? ` (${it.id})` : ''}`;
      if (!it.id) err(`${ia}: id 가 없습니다`);
      else if (itemIds.has(it.id)) err(`${ia}: id "${it.id}" 가 중복됩니다`);
      itemIds.add(it.id);
      if (!it.title) err(`${ia}: title 이 없습니다`);
      if (!CATS.includes(it.cat)) err(`${ia}: cat "${it.cat}" 는 ${CATS.join(', ')} 중 하나여야 합니다`);
      if (it.allday) {
        if (it.start != null) err(`${ia}: allday 항목에는 start 를 쓰지 않습니다`);
      } else {
        if (!RE_TIME.test(it.start || '')) err(`${ia}: start "${it.start}" 는 HH:MM 형식이어야 합니다`);
        else {
          if (prev != null && it.start < prev) err(`${ia}: 시간순이 아닙니다 — ${it.start} 가 앞 일정(${prev})보다 빠릅니다`);
          prev = it.start;
        }
        if (it.end != null) {
          if (!RE_TIME.test(it.end)) err(`${ia}: end "${it.end}" 는 HH:MM 형식이어야 합니다 (자정을 넘기면 다음 날 일정으로 넣기)`);
          else if (RE_TIME.test(it.start || '') && it.end <= it.start) err(`${ia}: end(${it.end}) 가 start(${it.start}) 보다 뒤여야 합니다`);
        }
      }
      if (it.place != null && !places.has(it.place)) err(`${ia}: place "${it.place}"가 places에 없습니다`);
      if (it.flight != null && !flights.has(it.flight)) err(`${ia}: flight "${it.flight}" 가 flights 에 없습니다`);
      if (it.clock != null && it.clock !== 'home') err(`${ia}: clock 은 "home" 만 쓸 수 있습니다`);
      if (it.booking != null) {
        if (!RE_ID.test(it.booking)) err(`${ia}: booking "${it.booking}" 형식이 올바르지 않습니다`);
        bookingRefs.add(it.booking);
      }
    });
  });
  if (t.end && days.length && days[days.length - 1].date !== t.end) {
    err(`days: 마지막 날짜(${days[days.length - 1].date})가 trip.end(${t.end})와 다릅니다`);
  }

  for (const h of hotels.values()) if (h.booking) bookingRefs.add(h.booking);
  for (const f of trip.flights || []) if (f.booking) bookingRefs.add(f.booking);

  if (opts.bookingIds) {
    const known = new Set(opts.bookingIds);
    for (const ref of bookingRefs) if (!known.has(ref)) err(`booking "${ref}" 가 예약 원본(private/trip-secret.json)에 없습니다`);
    for (const id of known) if (!bookingRefs.has(id)) warn(`예약 원본의 "${id}" 는 일정 어디에서도 쓰이지 않습니다`);
  }

  return { errors, warnings, bookingRefs: [...bookingRefs] };
}

export function validatePhrases(doc) {
  const errors = [];
  const sits = doc && Array.isArray(doc.situations) ? doc.situations : [];
  if (sits.length !== 8) errors.push(`phrases: 상황은 8개여야 합니다 (지금 ${sits.length}개)`);
  const ids = new Set();
  sits.forEach((s, si) => {
    const at = `phrases.situations[${si}]${s && s.id ? ` (${s.id})` : ''}`;
    if (!s.id || !s.title) errors.push(`${at}: id/title 이 없습니다`);
    const list = Array.isArray(s.phrases) ? s.phrases : [];
    if (list.length !== 5) errors.push(`${at}: 문장은 5개여야 합니다 (지금 ${list.length}개)`);
    list.forEach((p, pi) => {
      const pa = `${at}.phrases[${pi}]`;
      if (!p.id) errors.push(`${pa}: id 가 없습니다`);
      else if (ids.has(p.id)) errors.push(`${pa}: id "${p.id}" 가 중복됩니다`);
      ids.add(p.id);
      if (!p.en || !p.ko) errors.push(`${pa}: en/ko 가 모두 있어야 합니다`);
      if (p.they && !p.they_ko) errors.push(`${pa}: they 가 있으면 they_ko 도 있어야 합니다`);
    });
  });
  return { errors, warnings: [] };
}

export function validateChecklists(doc) {
  const errors = [];
  const groups = doc && Array.isArray(doc.groups) ? doc.groups : [];
  if (groups.length === 0) errors.push('checklists: groups 가 비어 있습니다');
  const ids = new Set();
  const gids = new Set();
  const owners = Object.keys((doc && doc.owners) || {});
  groups.forEach((g, gi) => {
    const at = `checklists.groups[${gi}]${g && g.id ? ` (${g.id})` : ''}`;
    if (!g.id || !g.title) errors.push(`${at}: id/title 이 없습니다`);
    if (gids.has(g.id)) errors.push(`${at}: 그룹 id "${g.id}" 가 중복됩니다`);
    gids.add(g.id);
    if (!['before', 'daily', 'return'].includes(g.when)) errors.push(`${at}: when "${g.when}" 은 before/daily/return 중 하나여야 합니다`);
    (g.items || []).forEach((it, ii) => {
      const ia = `${at}.items[${ii}]`;
      if (!it.id) errors.push(`${ia}: id 가 없습니다`);
      else if (ids.has(it.id)) errors.push(`${ia}: 항목 id "${it.id}" 가 중복됩니다`);
      ids.add(it.id);
      if (!it.text) errors.push(`${ia}: text 가 없습니다`);
      if (it.owner && owners.length && !owners.includes(it.owner)) errors.push(`${ia}: owner "${it.owner}" 가 owners 에 없습니다`);
    });
  });
  return { errors, warnings: [] };
}

// private/trip-secret.json (암호화 전 원본) 구조 검사
export function validateSecret(secret) {
  const errors = [];
  const warnings = [];
  if (!secret || typeof secret !== 'object') return { errors: ['secret: 객체가 아닙니다'], warnings };
  if (secret.schema !== 1) errors.push('secret.schema 는 1 이어야 합니다');
  const TYPES = ['flight', 'hotel', 'car', 'tour', 'food', 'etc'];
  const ids = new Set();
  const vouchers = secret.vouchers || {};
  (secret.bookings || []).forEach((b, i) => {
    const at = `secret.bookings[${i}]${b && b.id ? ` (${b.id})` : ''}`;
    if (!b.id || !RE_ID.test(b.id)) errors.push(`${at}: id 형식이 올바르지 않습니다`);
    if (ids.has(b.id)) errors.push(`${at}: id "${b.id}" 가 중복됩니다`);
    ids.add(b.id);
    if (!b.title) errors.push(`${at}: title 이 없습니다`);
    if (!TYPES.includes(b.type)) errors.push(`${at}: type "${b.type}" 은 ${TYPES.join(', ')} 중 하나여야 합니다`);
    if (b.date && !isRealDate(b.date)) errors.push(`${at}: date 형식이 올바르지 않습니다`);
    for (const n of b.numbers || []) if (!n.label || !n.value) errors.push(`${at}: numbers 항목에는 label 과 value 가 있어야 합니다`);
    for (const c of b.contacts || []) {
      if (!c.label) errors.push(`${at}: contacts 항목에 label 이 없습니다`);
      if (!c.tel && !c.kakao && !c.email && !c.url) errors.push(`${at}: contacts 항목에 tel/kakao/email/url 중 하나가 필요합니다`);
      if (c.tel && !/^\+\d{8,15}$/.test(c.tel)) errors.push(`${at}: tel "${c.tel}" 은 + 기호와 국가번호 뒤에 숫자만 씁니다`);
    }
    if (b.paid && (typeof b.paid.amount !== 'number' || !['KRW', 'USD'].includes(b.paid.currency))) errors.push(`${at}: paid 는 { amount: 숫자, currency: KRW|USD } 형식이어야 합니다`);
    for (const v of b.vouchers || []) if (!vouchers[v]) errors.push(`${at}: 바우처 "${v}" 가 vouchers 에 없습니다`);
    if (!(b.numbers || []).length && b.status !== 'todo') warnings.push(`${at}: 예약번호 미입력`);
  });
  for (const [name, data] of Object.entries(vouchers)) {
    if (typeof data !== 'string' || !data.startsWith('data:image/')) errors.push(`secret.vouchers["${name}"]: data:image/... 형식이어야 합니다`);
  }
  return { errors, warnings, ids: [...ids] };
}

function loadJSON(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`${rel}: 파일이 없습니다`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${rel}: JSON 형식 오류 — ${e.message}`);
  }
}

async function main() {
  const withSecret = process.argv.includes('--with-secret');
  const quiet = process.argv.includes('--quiet');
  const errors = [];
  const warnings = [];
  const run = (label, fn) => {
    try {
      const r = fn();
      errors.push(...r.errors.map((m) => `${label}: ${m}`));
      warnings.push(...(r.warnings || []).map((m) => `${label}: ${m}`));
      return r;
    } catch (e) {
      errors.push(e.message);
      return null;
    }
  };

  let bookingIds;
  if (withSecret) {
    const { loadPrivateSecret } = await import('./lib/secret-io.mjs');
    const r = run('private/trip-secret.json', () => {
      const { secret, warnings: w } = loadPrivateSecret();
      const v = validateSecret(secret);
      v.warnings.push(...w);
      return v;
    });
    if (r) bookingIds = r.ids;
  }

  run('data/trip.json', () => validateTrip(loadJSON('data/trip.json'), {
    fileExists: (rel) => existsSync(join(ROOT, rel)),
    bookingIds,
  }));
  run('data/phrases.json', () => validatePhrases(loadJSON('data/phrases.json')));
  run('data/checklists.json', () => validateChecklists(loadJSON('data/checklists.json')));

  if (!quiet) for (const w of warnings) console.log(`⚠️  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`❌ ${e}`);
    console.error(`\n검증 실패: 오류 ${errors.length}건`);
    process.exit(1);
  }
  console.log(`✅ 데이터 검증 통과 (경고 ${warnings.length}건)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
