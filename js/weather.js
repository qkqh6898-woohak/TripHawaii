// 날씨 — Open-Meteo (무료, 키 없음). 온라인일 때만 받아 오고 마지막 값을 기기에 저장해 오프라인에서도 보여준다.
import * as db from './db.js';
import { html } from './util.js';
import { getTrip, zone as getZone } from './trip.js';
import * as time from './time.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset';
export const STALE_MS = 3 * time.HOUR;
const TIMEOUT_MS = 9000;

const cache = new Map(); // zoneId → { zone, data, fetchedAt }

export function buildUrl(z) {
  const p = new URLSearchParams({
    latitude: String(z.lat), longitude: String(z.lng),
    daily: DAILY, timezone: 'Pacific/Honolulu', forecast_days: '16',
  });
  if (z.elevation) p.set('elevation', String(z.elevation));
  return `${API}?${p.toString()}`;
}

// Open-Meteo 응답 → { '2026-11-17': { code, tmax, tmin, pop, uv, sunrise:'06:36', sunset:'17:50' } }
export function parseDaily(json) {
  const d = json && json.daily;
  if (!d || !Array.isArray(d.time)) throw new Error('날씨 응답 형식이 올바르지 않아요');
  const out = {};
  const num = (arr, i) => (arr && typeof arr[i] === 'number' ? arr[i] : null);
  const hhmm = (arr, i) => (arr && typeof arr[i] === 'string' && arr[i].length >= 16 ? arr[i].slice(11, 16) : null);
  d.time.forEach((date, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    out[date] = {
      code: num(d.weather_code, i),
      tmax: num(d.temperature_2m_max, i),
      tmin: num(d.temperature_2m_min, i),
      pop: num(d.precipitation_probability_max, i),
      uv: num(d.uv_index_max, i),
      sunrise: hhmm(d.sunrise, i),
      sunset: hhmm(d.sunset, i),
    };
  });
  return out;
}

// WMO 날씨 코드 → 아이콘·설명
export function describe(code) {
  if (code == null) return { icon: '🌡', label: '' };
  if (code === 0) return { icon: '☀️', label: '맑음' };
  if (code === 1) return { icon: '🌤', label: '대체로 맑음' };
  if (code === 2) return { icon: '⛅', label: '구름 조금' };
  if (code === 3) return { icon: '☁️', label: '흐림' };
  if (code === 45 || code === 48) return { icon: '🌫', label: '안개' };
  if (code >= 51 && code <= 57) return { icon: '🌦', label: '이슬비' };
  if (code >= 61 && code <= 67) return { icon: '🌧', label: '비' };
  if (code >= 71 && code <= 77) return { icon: '❄️', label: '눈' };
  if (code >= 80 && code <= 82) return { icon: '🌦', label: '소나기' };
  if (code === 85 || code === 86) return { icon: '🌨', label: '눈 소나기' };
  if (code >= 95) return { icon: '⛈', label: '뇌우' };
  return { icon: '🌡', label: '' };
}

export async function getZoneWeather(zoneId) {
  if (cache.has(zoneId)) return cache.get(zoneId);
  const row = await db.get('weather', zoneId);
  if (row) cache.set(zoneId, row);
  return row || null;
}

async function fetchZone(z) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(buildUrl(z), ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error(`날씨 서버 응답 ${res.status}`);
    const row = { zone: z.id, data: parseDaily(await res.json()), fetchedAt: Date.now() };
    cache.set(z.id, row);
    await db.put('weather', row);
    return row;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 모든 구역의 날씨를 새로 받는다 (3시간이 지난 것만, force 면 전부).
 * @returns {Promise<{updated:number, failed:number, skipped:number}>}
 */
export async function refreshAll(force = false) {
  const zones = getTrip().weather_zones || [];
  const result = { updated: 0, failed: 0, skipped: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { result.skipped = zones.length; return result; }
  await Promise.all(zones.map(async (z) => {
    const row = await getZoneWeather(z.id);
    if (!force && row && Date.now() - row.fetchedAt < STALE_MS) { result.skipped++; return; }
    try { await fetchZone(z); result.updated++; } catch { result.failed++; }
  }));
  return result;
}

export function agoLabel(fetchedAt, nowMs = Date.now()) {
  const diff = Math.max(0, nowMs - fetchedAt);
  if (diff < 10 * time.MIN) return '방금 받은 예보';
  if (diff < time.HOUR) return `${Math.round(diff / time.MIN)}분 전 기준`;
  if (diff < 48 * time.HOUR) return `${Math.round(diff / time.HOUR)}시간 전 기준`;
  return `${Math.round(diff / time.DAY)}일 전 기준`;
}

// 고지대·추운 곳 경고
export function coldNote(z, w) {
  if (!w || w.tmin == null) return '';
  if (w.tmin <= 5) return `🧥 최저 ${Math.round(w.tmin)}° — 패딩·장갑 필수`;
  if ((z && z.cold) || w.tmin <= 12) return `🧥 최저 ${Math.round(w.tmin)}° — 두꺼운 겉옷 챙기기`;
  return '';
}

const r = (n) => (n == null ? '–' : String(Math.round(n)));

// 한 줄 요약: ☀️ 28°/22° · 비 20% · 자외선 9 · 일몰 17:49
export function summaryText(w) {
  const d = describe(w.code);
  const parts = [`${d.icon} ${r(w.tmax)}°/${r(w.tmin)}°`];
  if (w.pop != null) parts.push(`비 ${r(w.pop)}%`);
  if (w.uv != null) parts.push(`자외선 ${r(w.uv)}`);
  if (w.sunset) parts.push(`일몰 ${w.sunset}`);
  return parts.join(' · ');
}

/**
 * 날짜·구역들의 날씨 카드 조각
 * @param {string[]} zoneIds
 * @param {string} date  'YYYY-MM-DD' (하와이 날짜)
 */
export async function weatherHtml(zoneIds, date, { compact = false } = {}) {
  const rows = [];
  let oldest = null;
  let any = false;
  for (const id of zoneIds || []) {
    const z = getZone(id);
    if (!z) continue;
    const row = await getZoneWeather(id);
    const w = row && row.data ? row.data[date] : null;
    if (row) { any = true; oldest = oldest == null ? row.fetchedAt : Math.min(oldest, row.fetchedAt); }
    rows.push({ z, w });
    if (compact) break;
  }
  if (!rows.length) return '';
  if (!any) {
    return html`<div class="weather"><p class="muted small">🌤 날씨는 인터넷에 연결되면 자동으로 받아 와요.</p></div>`;
  }
  return html`
    <div class="weather">
      ${rows.map(({ z, w }) => (w ? html`
        <div class="weather-row">
          <span class="weather-zone">${z.name}</span>
          <span class="weather-main">${summaryText(w)}</span>
          ${w.sunrise && !compact ? html`<span class="weather-sub">${describe(w.code).label}${describe(w.code).label ? ' · ' : ''}일출 ${w.sunrise}${w.uv != null && w.uv >= 8 ? ' · 자외선 매우 강함' : ''}</span>` : ''}
          ${coldNote(z, w) ? html`<span class="weather-warn">${coldNote(z, w)}</span>` : ''}
        </div>` : html`
        <div class="weather-row">
          <span class="weather-zone">${z.name}</span>
          <span class="weather-main muted">예보 없음 (16일 예보 범위 밖)</span>
        </div>`))}
      ${oldest != null ? html`<p class="muted small weather-age">${agoLabel(oldest)} · Open-Meteo</p>` : ''}
    </div>`;
}
