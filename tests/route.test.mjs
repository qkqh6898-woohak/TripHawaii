import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTrip, dayByDate } from '../js/trip.js';
import { routeStops, dayRouteLinks, missingInfo, summaryText, buildKml, timeLabel } from '../js/route.js';

const trip = setTrip(JSON.parse(readFileSync(new URL('../data/trip.json', import.meta.url), 'utf8')));
const ids = (date) => routeStops(dayByDate(date)).map((s) => s.place.id);
const params = (url) => new URL(url).searchParams;

test('동선: 시간순으로 묶고, 전날 숙소 출발 · 오늘 숙소 복귀를 붙인다', () => {
  assert.deepEqual(ids('2026-11-17'), ['hilton', 'sheraton', 'kualoa', 'hilton']);
  assert.deepEqual(ids('2026-11-20'), ['konacoast', 'punaluu', 'punaluu-bakeshop', 'volcano', 'volcano-village', 'konacoast']);
  assert.deepEqual(ids('2026-11-15').slice(0, 2), ['hnl', 'hilton']);          // 첫날은 공항에서 시작
  assert.equal(ids('2026-11-27').at(-1), 'hnl');                                // 마지막 날은 공항에서 끝
  const s = routeStops(dayByDate('2026-11-17'));
  assert.equal(s[0].auto, 'start');
  assert.equal(s.at(-1).auto, 'end');
  assert.deepEqual(s.map((v) => v.pin), ['숙', '1', '2', '숙']);                 // 약도 번호와 같은 번호
  assert.equal(s[1].time, '09:45');
  assert.equal(s[2].items.length, 3);                                           // 쿠알로아에서 이어지는 일정 3개
});

test('동선: 모든 날짜에 경로 주소가 있고 형식이 맞다', () => {
  for (const day of trip.days) {
    const links = dayRouteLinks(day);
    assert.ok(links.length >= 1, `${day.date} 경로 없음`);
    for (const l of links) {
      assert.match(l.url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
      const p = params(l.url);
      assert.ok(p.get('origin') && p.get('destination'));
      assert.ok((p.get('waypoints') || '').split('|').filter(Boolean).length <= 9);
      assert.equal(p.get('travelmode'), l.island === 'bigisland' ? 'driving' : null);
    }
  }
  const d20 = params(dayRouteLinks(dayByDate('2026-11-20'))[0].url);
  assert.match(d20.get('origin'), /^Kona Coast Resort/);
  assert.equal(d20.get('waypoints').split('|').length, 4);
});

test('동선: 섬이 바뀌는 날은 섬별로 나눈다', () => {
  const l = dayRouteLinks(dayByDate('2026-11-19'));
  assert.deepEqual(l.map((v) => v.island), ['oahu', 'bigisland']);
  assert.match(params(l[0].url).get('destination'), /Inouye International Airport/);
  assert.match(params(l[1].url).get('origin'), /Kona International Airport/);
});

test('빈 정보 찾기: 미정 · 장소 없는 식사 · 만나는 장소 · 항공편', () => {
  const m = missingInfo();
  const has = (item, kind) => m.some((v) => v.item === item && v.kind === kind);
  assert.ok(has('1122-1', 'tentative'));
  assert.ok(has('1126-4', 'place'));            // 마지막 저녁
  assert.ok(has('1118-1', 'meet'));             // 가이드 미팅 장소
  assert.ok(has('1116-2', 'place'));            // 줌줌 투어 장소
  assert.ok(!m.some((v) => v.item === '1117-8'));   // '카톡 확인'은 장소가 필요 없는 일
  assert.ok(!m.some((v) => v.item === '1115-1'));   // 한국에서의 일정은 제외
  assert.ok(m.some((v) => v.kind === 'flight' && /편명/.test(v.what)));
});

test('요약 글·KML: 날짜·시각·장소가 들어가고 개인 정보는 없다', () => {
  const s = summaryText();
  assert.match(s, /■ 11\/17\(화\) · 3일차 · 오아후 · 숙소 힐튼가든인/);
  assert.match(s, / {2}11:55 {2}쿠알로아 랜치 티켓 오피스 체크인 @ 쿠알로아 랜치 티켓 오피스/);
  assert.equal(timeLabel(trip.days[0].items[1], trip.days[0]), '22:50 (한국 시간)');
  const kml = buildKml();
  assert.equal((kml.match(/<Placemark>/g) || []).length, trip.places.length);
  assert.match(kml, /<coordinates>-157\.\d+,21\.\d+,0<\/coordinates>/);
  assert.match(kml, /11\/17\(화\) 11:55 쿠알로아 랜치 티켓 오피스 체크인/);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(kml), 'XML 특수문자는 모두 바꿔야 함');
  assert.ok(!/booking|예약번호/.test(kml));
});
