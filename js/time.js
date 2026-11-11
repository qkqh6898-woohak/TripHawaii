// 시간 계산 — 일정은 하와이 시간(HST)으로 저장하고, 화면에는 하와이·한국 시간을 함께 보여준다.
// 이 파일은 DOM 을 쓰지 않는다 (Node 단위 테스트에서 그대로 불러 쓴다).

export const HST = 'Pacific/Honolulu';
export const KST = 'Asia/Seoul';
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let nowOverride = null;

// 테스트·미리보기용: 현재 시각을 고정한다 (null 이면 실제 시각)
export function setNowOverride(ms) {
  nowOverride = ms == null ? null : Number(ms);
}
export function hasNowOverride() {
  return nowOverride != null;
}
export function now() {
  return nowOverride != null ? nowOverride : Date.now();
}

const fmtCache = new Map();
function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const pad = (n) => String(n).padStart(2, '0');

// 어떤 순간(ms)을 시간대 tz 의 달력 날짜·시각으로 바꾼다
export function zoned(ms, tz) {
  const p = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const hh = p.hour === 24 ? 0 : p.hour;
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return {
    y: p.year, m: p.month, d: p.day, hh, mm: p.minute, ss: p.second,
    dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    date, time: `${pad(hh)}:${pad(p.minute)}`,
  };
}

// 시간대 tz 의 달력 날짜·시각 → 순간(ms)
export function zonedToEpoch(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms) => {
    const z = zoned(ms, tz);
    return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ms / 1000) * 1000;
  };
  let ms = guess - offsetAt(guess);
  ms = guess - offsetAt(ms); // 서머타임 경계 보정 (HST·KST 는 서머타임이 없지만 일반화)
  return ms;
}

// ?now=2026-11-17T09:12  → 하와이 시각으로 해석. 끝에 Z 나 +09:00 이 붙으면 그대로 해석.
export function parseNowParam(str, tz = HST) {
  if (!str) return null;
  // 주소창에서는 '+' 가 공백으로 바뀌므로 '…T10:00 09:00' 꼴도 '+09:00' 으로 읽는다
  const s = String(str).trim().replace(/(T\d{2}:\d{2}(?::\d{2})?) (\d{2}:?\d{2})$/, '$1+$2').replace(' ', 'T');
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : ms;
  }
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(s);
  if (!m) return null;
  return zonedToEpoch(m[1], m[2] || '00:00', tz);
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// b - a (일)
export function diffDays(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / DAY);
}

export function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// '2026-11-17' → '11/17(화)'
export function fmtDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${weekday(date)})`;
}
export function fmtMD(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

// 순간 → '11/17(화) 09:12'
export function fmtZoned(ms, tz) {
  const z = zoned(ms, tz);
  return `${fmtDate(z.date)} ${z.time}`;
}

// 남은 시간 표시: '33분', '2시간 5분', '3일 4시간'
export function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / MIN));
  if (total < 1) return '1분 미만';
  const d = Math.floor(total / (60 * 24));
  const h = Math.floor((total % (60 * 24)) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

/**
 * 여행 전 / 여행 중 / 여행 후
 * - 여행 전의 D-day 는 한국 날짜 기준 (출발 전에는 한국에 있으므로)
 * - 여행 중·후 판단은 하와이 날짜 기준
 */
export function tripPhase(tripInfo, ms = now()) {
  const tz = tripInfo.tz || HST;
  const home = tripInfo.home_tz || KST;
  const hstDate = zoned(ms, tz).date;
  const homeDate = zoned(ms, home).date;
  if (hstDate < tripInfo.start) {
    return { phase: 'before', date: hstDate, dday: Math.max(0, diffDays(homeDate, tripInfo.start)) };
  }
  if (hstDate > tripInfo.end) {
    return { phase: 'after', date: hstDate, daysSince: diffDays(tripInfo.end, hstDate) };
  }
  return {
    phase: 'during', date: hstDate,
    dayIndex: diffDays(tripInfo.start, hstDate),          // 0 = 첫날
    totalDays: diffDays(tripInfo.start, tripInfo.end) + 1,
  };
}

// 하루 일정의 각 항목에 시작·끝 순간을 붙인다 (종일 항목은 제외)
export function timedItems(day, tz = HST) {
  const list = [];
  for (const it of day.items || []) {
    if (it.allday || !it.start) continue;
    list.push({ item: it, date: day.date, startMs: zonedToEpoch(day.date, it.start, tz), endMs: null });
  }
  list.sort((a, b) => a.startMs - b.startMs);
  list.forEach((e, i) => {
    if (e.item.end) {
      e.endMs = zonedToEpoch(day.date, e.item.end, tz);
    } else {
      // 끝 시각이 없으면 다음 일정 시작까지, 마지막 일정은 1시간
      const next = list.slice(i + 1).find((n) => n.startMs > e.startMs);
      e.endMs = next ? next.startMs : e.startMs + HOUR;
    }
  });
  return list;
}

/**
 * 지금 진행 중인 일정과 다음 일정
 * @param {object[]} days  trip.days
 * @returns {{ today: object[]|null, current: object|null, next: object|null, past: Set<string> }}
 *   current/next: { item, date, startMs, endMs }  (next 는 내일 첫 일정일 수 있음 — date 로 구분)
 */
export function currentAndNext(days, ms = now(), tz = HST) {
  const date = zoned(ms, tz).date;
  const idx = days.findIndex((d) => d.date === date);
  const result = { date, today: null, current: null, next: null, past: new Set() };
  if (idx < 0) {
    // 여행 전: 첫날 첫 일정이 '다음'
    if (days.length && date < days[0].date) result.next = timedItems(days[0], tz)[0] || null;
    return result;
  }
  const today = timedItems(days[idx], tz);
  result.today = today;
  for (const e of today) {
    if (e.startMs <= ms && ms < e.endMs) result.current = e;      // 겹치면 더 늦게 시작한 일정
    if (e.endMs <= ms) result.past.add(e.item.id);
  }
  result.next = today.find((e) => e.startMs > ms) || null;
  if (!result.next && idx + 1 < days.length) {
    result.next = timedItems(days[idx + 1], tz)[0] || null;
  }
  return result;
}

// 일정 항목의 시각 표시: '09:45', '12:40–15:40', '12:00경', '11:55까지', '종일'
export function fmtItemTime(item) {
  if (item.allday) return '종일';
  let s = item.start || '';
  if (item.end) s += `–${item.end}`;
  if (item.approx) s += '경';
  if (item.deadline) s += '까지';
  return s;
}

// 한국에서 겪는 일정(출발 전 공항 등)은 한국 시각으로 바꿔 보여준다
export function homeClock(date, hhmm, tripInfo) {
  const ms = zonedToEpoch(date, hhmm, tripInfo.tz || HST);
  return zoned(ms, tripInfo.home_tz || KST);
}
