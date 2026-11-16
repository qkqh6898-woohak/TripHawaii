import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTrip, place, directionsUrl, directionsTo } from '../js/trip.js';
import { setTransit, setDirFrom, nearestStop, dirPlan, openStops } from '../js/transit.js';
import * as T from '../js/time.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
setTrip(load('trip.json'));
setTransit(load('transit.json'));
const q = (url) => new URL(url).searchParams;

test('핑크라인: 운행 제외 정거장은 빼고, 숙소 근처 정거장을 고른다', () => {
  assert.ok(!openStops().some((s) => s.status === 'closed'));
  const hilton = place('hilton');
  assert.equal(nearestStop(hilton.lat, hilton.lng).stop.id, 'p5');          // 힐튼가든인 → ⑤ 마루카메 우동 앞
  const halepuna = place('halepuna');
  assert.equal(nearestStop(halepuna.lat, halepuna.lng).stop.id, 'p1');      // 할레푸나 → ① 와이키키 쇼핑 플라자
});

test('길찾기: 가까우면 정거장에서 걸어서, 멀면 숙소 근처 정거장에서 대중교통', () => {
  setDirFrom('stop');
  T.setNowOverride(T.parseNowParam('2026-11-16T15:00'));                  // 힐튼가든인에 묵는 날
  const near = q(directionsUrl(place('alo-cafe')));
  assert.match(near.get('origin'), /Marugame Udon|Duke Kahanamoku|Hilton Waikiki/);
  assert.equal(near.get('travelmode'), 'walking');
  const far = q(directionsUrl(place('hanauma')));
  assert.match(far.get('origin'), /^Marugame Udon Waikiki, 2310 Kuhio Ave/);
  assert.equal(far.get('travelmode'), 'transit');
  T.setNowOverride(T.parseNowParam('2026-11-26T09:00'));                  // 할레푸나에 묵는 날
  assert.match(q(directionsUrl(place('diamond-head'))).get('origin'), /^Waikiki Shopping Plaza/);
  T.setNowOverride(null);
});

test('맛집은 지정한 정거장, 빅아일랜드는 그대로 운전, 내 위치로 바꾸면 출발점 없음', () => {
  setDirFrom('stop');
  const eat = q(directionsTo('Ono Seafood, 747 Kapahulu Ave', { island: 'oahu', stop: 'p10' }));
  assert.match(eat.get('origin'), /Ala Moana Center/);
  assert.equal(eat.get('travelmode'), 'walking');
  const big = q(directionsUrl(place('konacoast')));
  assert.equal(big.get('origin'), null);
  assert.equal(big.get('travelmode'), 'driving');
  setDirFrom('here');
  assert.equal(q(directionsUrl(place('alo-cafe'))).get('origin'), null);
  assert.equal(dirPlan({ island: 'oahu', lat: 21.28, lng: -157.83 }, null), null);
  setDirFrom('stop');
});
