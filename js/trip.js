// data/trip.json 불러오기와 조회 (장소·숙소·날짜), 길찾기 링크

let trip = null;
let index = null;
let mapSizes = {};
let photoFiles = null;   // 실제로 들어 있는 사진 (null = 목록을 못 읽음 → 모두 있다고 본다)

export const CAT_LABEL = { move: '이동', hotel: '숙소', sight: '관광', shop: '쇼핑', food: '음식', tour: '투어', rest: '휴식' };
export const CAT_ICON = { move: '🚗', hotel: '🏨', sight: '🌋', shop: '🛍', food: '🍽', tour: '🎟', rest: '🌴' };
export const ISLAND_LABEL = { oahu: '오아후', bigisland: '빅아일랜드' };

function buildIndex(t) {
  return {
    places: new Map((t.places || []).map((p) => [p.id, p])),
    hotels: new Map((t.hotels || []).map((h) => [h.id, h])),
    days: new Map((t.days || []).map((d) => [d.date, d])),
    flights: new Map((t.flights || []).map((f) => [f.id, f])),
    zones: new Map((t.weather_zones || []).map((z) => [z.id, z])),
  };
}

// 테스트·도구에서 직접 넣을 때
export function setTrip(t) {
  trip = t;
  index = buildIndex(t);
  return trip;
}

export async function loadTrip() {
  if (trip) return trip;
  const res = await fetch('data/trip.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`일정 파일을 불러오지 못했어요 (${res.status})`);
  const t = await res.json();
  if (!t || t.schema !== 1 || !Array.isArray(t.days)) throw new Error('일정 파일 형식이 올바르지 않아요');
  try {
    const m = await fetch('data/maps.json', { cache: 'no-cache' });
    if (m.ok) mapSizes = await m.json();
  } catch { /* 크기를 몰라도 지도는 보인다 */ }
  try {
    const ph = await fetch('data/photos.json', { cache: 'no-cache' });
    if (ph.ok) photoFiles = new Set(await ph.json());
  } catch { /* 목록이 없으면 걸러 내지 않는다 */ }
  return setTrip(t);
}

export const getTrip = () => trip;
// 지도 이미지의 실제 크기 [가로, 세로] — <img width height> 에 넣어 로딩 중 화면 밀림을 막는다
export const mapSize = (src) => (Array.isArray(mapSizes[src]) ? mapSizes[src] : [1080, 1400]);
// 지도 크게 보기에서 오므렸을 때 넘어갈 더 넓은 지도들 (좁은 것 → 넓은 것)
const OVERVIEW = 'maps/overview-hawaii.png';
export function mapLevels(src, alt = '') {
  const known = Object.keys(mapSizes).length > 0;
  const has = (s) => !known || Array.isArray(mapSizes[s]);
  const out = [{ src, alt, label: '이 지도' }];
  const day = /^maps\/day-(\d{4})\.png$/.exec(src || '');
  if (day) {
    out[0].label = '이날 지도';
    const wide = `maps/day-${day[1]}-wide.png`;
    if (has(wide)) out.push({ src: wide, alt: `${alt} — 섬 전체`, label: '섬 전체' });
  } else if (src === 'maps/oahu.png') out[0].label = '오아후';
  else if (src === 'maps/big-island.png') out[0].label = '빅아일랜드';
  else return out;                     // 하와이 전체·한국↔하와이는 더 넓은 지도가 없다
  if (has(OVERVIEW)) out.push({ src: OVERVIEW, alt: '하와이 전체 일정 지도', label: '하와이 전체' });
  return out;
}
// 예약 지갑을 열면 받는 암호화된 사진 { '이름.jpg': 'data:image/...' } — wallet.js 가 넣어 준다
let privatePhotos = {};
export function setPrivatePhotos(map) { privatePhotos = map && typeof map === 'object' ? map : {}; }
const privateKey = (src) => String(src || '').replace(/^photos\//, '');
const hasPhoto = (ph) => !!(ph && ph.src && (privatePhotos[privateKey(ph.src)] || !photoFiles || photoFiles.has(ph.src)));
// 화면에 넣을 실제 주소: 암호화된 사진이 있으면 그것(data:), 없으면 공개 photos/ 파일
export const photoUrl = (src) => privatePhotos[privateKey(src)] || src;
// 일정 항목의 사진 (여러 장 가능) — 실제로 있는 것만, 화면용 주소로
export const itemPhotos = (item) => (item && Array.isArray(item.photos) ? item.photos.filter(hasPhoto).map((ph) => ({ src: photoUrl(ph.src), alt: ph.alt || item.title || '' })) : []);
// 그날의 사진 전부: 날짜에 직접 붙인 사진 + 각 항목의 사진 (중복 제거)
export function dayPhotos(day) {
  const out = [];
  const seen = new Set();
  const push = (ph, title) => { if (hasPhoto(ph) && !seen.has(ph.src)) { seen.add(ph.src); out.push({ src: photoUrl(ph.src), alt: ph.alt || title || '' }); } };
  for (const ph of day.photos || []) push(ph, day.title);
  for (const it of day.items || []) for (const ph of it.photos || []) push(ph, it.title);
  return out;
}
export const place = (id) => (id && index ? index.places.get(id) || null : null);
export const hotel = (id) => (id && index ? index.hotels.get(id) || null : null);
export const dayByDate = (date) => (index ? index.days.get(date) || null : null);
export const flight = (id) => (id && index ? index.flights.get(id) || null : null);
export const zone = (id) => (id && index ? index.zones.get(id) || null : null);

export function islandLabel(day) {
  const a = ISLAND_LABEL[day.island] || day.island;
  return day.to_island ? `${a} → ${ISLAND_LABEL[day.to_island] || day.to_island}` : a;
}

// 그날 체크인·체크아웃하는 숙소
export function hotelEvents(date) {
  const out = [];
  for (const h of trip.hotels || []) {
    if (h.checkout === date) out.push({ type: 'checkout', hotel: h });
    if (h.checkin === date) out.push({ type: 'checkin', hotel: h });
  }
  return out;
}

// Google 지도 길찾기 링크 (키 불필요). 이름+주소로 찾으면 좌표보다 정확한 입구로 안내된다.
export function directionsUrl(p) {
  const dest = p.addr ? `${p.name_en || p.name}, ${p.addr}` : `${p.lat},${p.lng}`;
  const params = new URLSearchParams({ api: '1', destination: dest });
  if (p.island === 'bigisland') params.set('travelmode', 'driving'); // 빅아일랜드는 렌터카 이동
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// 좌표로 바로 여는 링크 (이름 검색이 엉뚱한 곳을 가리킬 때 대비)
export function coordsUrl(p) {
  const params = new URLSearchParams({ api: '1', query: `${p.lat},${p.lng}` });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

// 하루 일정에 연결된 예약 id (순서 유지, 중복 제거)
export function bookingIdsOfDay(day) {
  const ids = [];
  for (const it of day.items || []) if (it.booking && !ids.includes(it.booking)) ids.push(it.booking);
  return ids;
}

// 일정 항목 id → { day, item }
export function findItem(itemId) {
  for (const d of trip.days) {
    const it = d.items.find((x) => x.id === itemId);
    if (it) return { day: d, item: it };
  }
  return null;
}

// 그날 일정에 나오는 장소들 (순서 유지, 중복 제거)
export function placesOfDay(day) {
  const out = [];
  for (const it of day.items || []) {
    const p = place(it.place);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
