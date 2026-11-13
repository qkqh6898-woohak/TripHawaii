// 동선 요약 — 날짜별 시간표·장소, Google 지도 경로 링크, '내 지도'용 KML, 아직 비어 있는 정보
// (화면과 무관한 계산만 둔다 → tests/route.test.mjs 에서 그대로 검사)
import { getTrip, place, hotel, placesOfDay, ISLAND_LABEL, islandLabel } from './trip.js';
import * as time from './time.js';

const MAX_WAYPOINTS = 9;     // Google 지도 주소가 받는 경유지 수 (앱 기준)
const q = (p) => (p.addr ? `${p.name_en || p.name}, ${p.addr}` : `${p.lat},${p.lng}`);
const x = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// 일정 한 줄의 시각 글자: '09:45' · '07:30~11:30' · '18:00쯤' · '03:50 (한국 시간)' · '종일'
export function timeLabel(item, day) {
  if (item.allday) return '종일';
  if (item.clock === 'home') {
    const z = time.homeClock(day.date, item.start, getTrip().trip);
    return `${z.time} (한국 시간)`;
  }
  return `${item.start || ''}${item.end ? `~${item.end}` : ''}${item.approx ? '쯤' : ''}`;
}

const hotelPlace = (day) => (day && day.hotel && hotel(day.hotel) ? place(hotel(day.hotel).place) : null);

/**
 * 그날 들르는 곳을 시간 순서대로 (같은 곳이 이어지면 하나로 묶음).
 * 일정에 적혀 있지 않아도 '전날 잔 숙소에서 출발'과 '오늘 숙소로 복귀'를 앞뒤에 붙인다 (auto: true).
 * pin = 약도에 찍힌 번호 (처음 나온 순서), 숙소가 일정에 없으면 '숙'
 * @returns {{place: object, time: string, items: object[], pin: string, auto?: 'start'|'end'}[]}
 */
export function routeStops(day) {
  const days = getTrip().days;
  const order = placesOfDay(day);
  const pin = (p) => (order.includes(p) ? String(order.indexOf(p) + 1) : '숙');
  const stops = [];
  for (const it of day.items || []) {
    const p = place(it.place);
    if (!p) continue;
    const last = stops[stops.length - 1];
    if (last && last.place === p) last.items.push(it);
    else stops.push({ place: p, time: timeLabel(it, day), items: [it], pin: pin(p) });
  }
  if (!stops.length) return stops;
  const from = hotelPlace(days[days.indexOf(day) - 1]);
  if (from && stops[0].place !== from && stops[0].place.island === from.island) stops.unshift({ place: from, time: '', items: [], pin: pin(from), auto: 'start' });
  const to = hotelPlace(day);
  const end = stops[stops.length - 1].place;
  if (to && end !== to && end.island === to.island) stops.push({ place: to, time: '', items: [], pin: pin(to), auto: 'end' });
  return stops;
}

/**
 * 그날 경로 전체를 Google 지도 길찾기로 여는 주소 (API 키 불필요 · 인터넷 필요).
 * 섬이 바뀌는 날은 차로 이어지지 않으므로 섬별로 나눈다.
 * @returns {{island: string, label: string, url: string, stops: number}[]}
 */
export function dayRouteLinks(day) {
  const runs = [];
  for (const s of routeStops(day)) {
    const last = runs[runs.length - 1];
    if (last && last.island === s.place.island) { if (last.places[last.places.length - 1] !== s.place) last.places.push(s.place); } else runs.push({ island: s.place.island, places: [s.place] });
  }
  return runs.filter((r) => r.places.length >= 2).map((r) => {
    const mid = r.places.slice(1, -1).slice(0, MAX_WAYPOINTS);
    const params = new URLSearchParams({ api: '1', origin: q(r.places[0]), destination: q(r.places[r.places.length - 1]) });
    if (mid.length) params.set('waypoints', mid.map(q).join('|'));
    if (r.island === 'bigisland') params.set('travelmode', 'driving');   // 빅아일랜드는 렌터카
    return { island: r.island, label: ISLAND_LABEL[r.island] || r.island, url: `https://www.google.com/maps/dir/?${params.toString()}`, stops: r.places.length };
  });
}

// 하루 요약 머리글에 쓰는 값
export function dayHead(day) {
  const t = getTrip();
  const h = day.hotel ? hotel(day.hotel) : null;
  return { n: t.days.indexOf(day) + 1, island: islandLabel(day), hotel: h ? h.name : '', title: day.title };
}

/** 아직 비어 있거나 확인이 필요한 정보 (자동으로 찾을 수 있는 것만) */
export function missingInfo() {
  const t = getTrip();
  const out = [];
  // 같은 예약의 다른 일정에 장소가 있으면 그 예약은 '장소를 아는 것'으로 본다
  const placedBookings = new Set(t.days.flatMap((d) => d.items).filter((i) => i.booking && place(i.place)).map((i) => i.booking));
  for (const day of t.days) {
    for (const it of day.items) {
      const base = { date: day.date, item: it.id, time: timeLabel(it, day), title: it.title };
      if (it.tentative) { out.push({ ...base, kind: 'tentative', what: '할지 말지 · 시간이 정해지지 않았어요' }); continue; }
      if (it.pending) { out.push({ ...base, kind: 'wait', what: it.pending }); continue; }   // 우리가 정하는 것이 아니라 연락을 기다리는 것
      if (place(it.place) || it.clock === 'home') continue;
      const meet = /미팅|만나는|픽업/.test(it.title);
      if (meet) out.push({ ...base, kind: 'meet', what: '만나는 장소(정확한 위치)가 없어요' });
      else if (['food', 'shop', 'sight', 'tour'].includes(it.cat) && !(it.booking && placedBookings.has(it.booking))) out.push({ ...base, kind: 'place', what: '장소가 정해지지 않았어요' });
      else if (it.cat === 'tour' && !/확인/.test(it.title)) out.push({ ...base, kind: 'place', what: '투어 장소(집합·진행 위치)가 없어요' });
    }
  }
  for (const f of t.flights || []) {
    const date = String(f.dep || '').slice(0, 10);
    const name = `${f.from} → ${f.to}${f.no ? ` ${f.no}` : ''}`;
    if (!f.no) out.push({ date, kind: 'flight', title: name, time: '', what: '항공사·편명이 없어요 (터미널·체크인 창구 확인에 필요)' });
    if (!f.arr || f.arr_approx) out.push({ date, kind: 'flight', title: name, time: '', what: '도착 시각이 확정되지 않았어요 (e-티켓 확인)' });
  }
  return out;
}

/** 카카오톡 등에 붙여넣을 글자 요약 (날짜 · 시간표 · 장소) */
export function summaryText() {
  const t = getTrip();
  const lines = [`${t.trip.title} — 일정 요약 (시각은 하와이 시간)`];
  for (const day of t.days) {
    const h = dayHead(day);
    lines.push('', `■ ${time.fmtDate(day.date)} · ${h.n}일차 · ${h.island}${h.hotel ? ` · 숙소 ${h.hotel}` : ''}`, `  ${day.title}`);
    for (const it of day.items) {
      const p = place(it.place);
      lines.push(`  ${timeLabel(it, day)}  ${it.title}${p ? ` @ ${p.name}` : ''}${it.tentative ? ' (미정)' : ''}`);
    }
    for (const r of dayRouteLinks(day)) lines.push(`  경로(${r.label}): ${r.url}`);
  }
  return lines.join('\n');
}

/**
 * Google '내 지도'(My Maps)에 가져올 KML — 장소마다 핀 하나, 설명에 방문 날짜·시각·일정.
 * 공개 일정에 있는 장소만 담는다 (예약번호 등 개인 정보 없음).
 */
export function buildKml() {
  const t = getTrip();
  const visits = new Map();
  for (const day of t.days) for (const it of day.items) {
    const p = place(it.place);
    if (!p) continue;
    if (!visits.has(p)) visits.set(p, []);
    visits.get(p).push(`${time.fmtDate(day.date)} ${timeLabel(it, day)} ${it.title}`);
  }
  const mark = (p) => {
    const v = visits.get(p) || [];
    const desc = [...v, p.addr || '', p.note || ''].filter(Boolean).join('\n');
    return `      <Placemark><name>${x(p.name)}</name><description>${x(desc)}</description><Point><coordinates>${Number(p.lng)},${Number(p.lat)},0</coordinates></Point></Placemark>`;
  };
  const folders = Object.keys(ISLAND_LABEL).map((id) => {
    const list = t.places.filter((p) => p.island === id);
    return `    <Folder><name>${x(ISLAND_LABEL[id])}</name>\n${list.map(mark).join('\n')}\n    </Folder>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><name>${x(t.trip.title)}</name>\n${folders.join('\n')}\n  </Document>\n</kml>\n`;
}
