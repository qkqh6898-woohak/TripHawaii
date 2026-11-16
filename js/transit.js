// 트롤리·대중교통 — data/transit.json
// 길찾기 출발점: 기본은 '가까운 트롤리 정거장'(내 위치를 쓰지 않음). 설정에서 '내 위치'로 바꿀 수 있다.
//   · 목적지에서 걸어갈 만한 거리(walk_km)에 핑크라인 정거장이 있으면 → 그 정거장에서 걸어서
//   · 멀면 → 숙소에서 가까운 정거장에서 대중교통(버스·전철)으로
//   · 빅아일랜드는 렌터카라 그대로 (내 위치에서 운전)

let doc = null;
let from = 'stop';

export function setTransit(d) { doc = d && Array.isArray(d.lines) ? d : null; }
export const transitDoc = () => doc;
export function setDirFrom(v) { from = v === 'here' ? 'here' : 'stop'; }
export const dirFrom = () => from;

export const pinkLine = () => (doc ? doc.lines.find((l) => l.id === 'pink') || null : null);
export const openStops = () => ((pinkLine() || {}).stops || []).filter((s) => s.status !== 'closed' && typeof s.lat === 'number');
export const stopById = (id) => ((pinkLine() || {}).stops || []).find((s) => s.id === id) || null;
export const stopQuery = (s) => `${s.name_en}, ${s.addr}`;
export const stopLabel = (s) => `핑크라인 ${'①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'[s.no - 1] || s.no} ${s.name}`;

export function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export function nearestStop(lat, lng) {
  let best = null;
  for (const s of openStops()) {
    const d = km(lat, lng, s.lat, s.lng);
    if (!best || d < best.km) best = { stop: s, km: d };
  }
  return best;
}

/**
 * 길찾기 계획. null 이면 예전처럼 '내 위치'에서 출발.
 * @param {{island?:string, lat?:number, lng?:number, stop?:string}} dest
 * @param {{lat:number, lng:number}|null} home  숙소 위치 (멀 때 출발 정거장을 고르는 기준)
 * @returns {{stop:object, mode:'walking'|'transit', km?:number}|null}
 */
export function dirPlan(dest, home) {
  if (from === 'here' || !doc || !dest || (dest.island && dest.island !== 'oahu')) return null;
  const walk = doc.walk_km || 1;
  if (dest.stop) {
    const s = stopById(dest.stop);
    if (s && s.status !== 'closed') return { stop: s, mode: 'walking' };
  }
  if (typeof dest.lat === 'number') {
    const n = nearestStop(dest.lat, dest.lng);
    if (n && n.km <= walk) return { stop: n.stop, mode: 'walking', km: n.km };
  }
  const base = home ? nearestStop(home.lat, home.lng) : null;
  const s = base ? base.stop : openStops()[0];
  return s ? { stop: s, mode: 'transit' } : null;
}
