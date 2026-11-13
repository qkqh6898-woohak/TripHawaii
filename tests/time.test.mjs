import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../js/time.js';

const trip = JSON.parse(readFileSync(new URL('../data/trip.json', import.meta.url), 'utf8'));
const info = trip.trip;
const at = (s) => T.parseNowParam(s);            // 하와이 시각
const utc = (...a) => Date.UTC(...a);

test('HST = UTC-10, KST = UTC+9 (한국이 19시간 빠름)', () => {
  const ms = utc(2026, 10, 17, 19, 12); // 11/17 19:12 UTC
  assert.deepEqual([T.zoned(ms, T.HST).date, T.zoned(ms, T.HST).time], ['2026-11-17', '09:12']);
  assert.deepEqual([T.zoned(ms, T.KST).date, T.zoned(ms, T.KST).time], ['2026-11-18', '04:12']);
  assert.equal(T.fmtZoned(ms, T.HST), '11/17(화) 09:12');
  assert.equal(T.fmtZoned(ms, T.KST), '11/18(수) 04:12');
});

test('출발편: 인천 22:50 (한국) = 하와이 03:50 같은 날', () => {
  const dep = Date.parse('2026-11-15T22:50+09:00');
  const h = T.zoned(dep, T.HST);
  assert.equal(h.date, '2026-11-15');
  assert.equal(h.time, '03:50');
  assert.equal(T.zonedToEpoch('2026-11-15', '03:50', T.HST), dep);
  assert.equal(T.zonedToEpoch('2026-11-15', '22:50', T.KST), dep);
});

test('zonedToEpoch ↔ zoned 왕복, 자정 넘김', () => {
  const ms = T.zonedToEpoch('2026-11-17', '23:59', T.HST);
  assert.equal(T.zoned(ms + T.MIN, T.HST).date, '2026-11-18');
  assert.equal(T.zoned(ms + T.MIN, T.HST).time, '00:00');
  assert.equal(T.zoned(T.zonedToEpoch('2026-12-31', '23:30', T.KST) + T.HOUR, T.KST).date, '2027-01-01');
});

test('?now= 값 해석: 기본은 하와이 시각, 시간대가 붙으면 그대로', () => {
  assert.equal(at('2026-11-17T09:12'), utc(2026, 10, 17, 19, 12));
  assert.equal(at('2026-11-17'), utc(2026, 10, 17, 10, 0));
  assert.equal(at('2026-11-18T04:12+09:00'), utc(2026, 10, 17, 19, 12));
  assert.equal(at('2026-11-17T19:12Z'), utc(2026, 10, 17, 19, 12));
  assert.equal(at('2026-11-18T04:12 09:00'), utc(2026, 10, 17, 19, 12));   // 주소창의 + → 공백
  assert.equal(at('2026-11-17 09:12'), utc(2026, 10, 17, 19, 12));
  assert.equal(at('엉뚱한 값'), null);
});

test('날짜 도우미', () => {
  assert.equal(T.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(T.diffDays('2026-11-15', '2026-11-27'), 12);
  assert.equal(T.fmtDate('2026-11-15'), '11/15(일)');
  assert.equal(T.fmtDate('2026-11-27'), '11/27(금)');
  assert.equal(T.weekday('2026-11-11'), '수');
});

test('남은 시간 표시', () => {
  assert.equal(T.fmtDuration(33 * T.MIN), '33분');
  assert.equal(T.fmtDuration(125 * T.MIN), '2시간 5분');
  assert.equal(T.fmtDuration(2 * T.HOUR), '2시간');
  assert.equal(T.fmtDuration(3 * T.DAY + 4 * T.HOUR + 10 * T.MIN), '3일 4시간');
  assert.equal(T.fmtDuration(20 * 1000), '1분 미만');
  assert.equal(T.fmtDuration(-5000), '1분 미만');
});

test('여행 전: D-day 는 한국 날짜 기준', () => {
  // 한국 11/11(수) 낮
  assert.deepEqual(T.tripPhase(info, Date.parse('2026-11-11T12:00+09:00')).dday, 4);
  // 한국 11/14(토) 밤 = D-1
  assert.equal(T.tripPhase(info, Date.parse('2026-11-14T23:00+09:00')).dday, 1);
  // 한국 11/15(일) 오전 = 하와이는 아직 11/14 → 여행 전이지만 D-DAY
  const p = T.tripPhase(info, Date.parse('2026-11-15T10:00+09:00'));
  assert.equal(p.phase, 'before');
  assert.equal(p.dday, 0);
});

test('여행 중·후 판단은 하와이 날짜 기준', () => {
  // 한국 11/15 19:50 (공항 도착) = 하와이 11/15 00:50 → 여행 1일차
  const first = T.tripPhase(info, Date.parse('2026-11-15T19:50+09:00'));
  assert.deepEqual([first.phase, first.dayIndex, first.totalDays], ['during', 0, 13]);
  assert.equal(T.tripPhase(info, at('2026-11-17T09:12')).dayIndex, 2);
  assert.equal(T.tripPhase(info, at('2026-11-27T15:00')).phase, 'during');
  assert.equal(T.tripPhase(info, at('2026-11-27T23:59')).phase, 'during');
  const after = T.tripPhase(info, at('2026-11-28T00:00'));
  assert.deepEqual([after.phase, after.daysSince], ['after', 1]);
});

test('진행 중 / 다음 일정: 11/17 09:12 → 다음은 10:00 쉐라톤 알로하 랜딩', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-17T09:12'));
  assert.equal(r.current, null);
  assert.equal(r.next.item.id, '1117-1');
  assert.equal(T.fmtDuration(r.next.startMs - at('2026-11-17T09:12')), '48분');
});

test('끝 시각이 없으면 다음 일정 시작까지 진행 중', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-17T10:30'));
  assert.equal(r.current.item.id, '1117-2');           // 10:15 픽업 출발 ~ 11:55
  assert.equal(r.next.item.id, '1117-3');
  assert.ok(r.past.has('1117-1'));
});

test('끝 시각이 있으면 그 시각까지 진행 중 (UTV 12:40–15:40)', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-17T14:00'));
  assert.equal(r.current.item.id, '1117-4');
  assert.equal(r.current.endMs, at('2026-11-17T15:40'));
  assert.equal(r.next.item.id, '1117-9');             // 16:15 복귀 버스 체크인
  // 15:40~16:15 사이는 진행 중인 일정 없음
  assert.equal(T.currentAndNext(trip.days, at('2026-11-17T16:00')).current, null);
});

test('출발일: 한국 22:50 이후 비행 중, 도착 뒤에는 입국', () => {
  const inFlight = T.currentAndNext(trip.days, Date.parse('2026-11-16T01:00+09:00'));
  assert.equal(inFlight.current.item.id, '1115-2');
  assert.equal(inFlight.current.item.flight, 'yp151');
  const beforeDep = T.currentAndNext(trip.days, Date.parse('2026-11-15T21:00+09:00'));
  assert.equal(beforeDep.current.item.id, '1115-1');
  assert.equal(beforeDep.next.item.id, '1115-2');
});

test('하루의 마지막 일정 뒤에는 내일 첫 일정이 다음', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-17T23:30'));
  assert.equal(r.current, null);
  assert.equal(r.next.item.id, '1118-1');
  assert.equal(r.next.date, '2026-11-18');
});

test('마지막 날 14:20 출발 뒤에는 다음 일정이 없다', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-27T15:00'));
  assert.equal(r.current.item.id, '1127-4');
  assert.equal(r.next, null);
  assert.equal(T.currentAndNext(trip.days, at('2026-11-27T16:00')).current, null);
});

test('여행 전: 첫날 첫 일정이 다음', () => {
  const r = T.currentAndNext(trip.days, Date.parse('2026-11-14T20:00+09:00'));
  assert.equal(r.today, null);
  assert.equal(r.next.item.id, '1115-1');
});

test('종일 일정(11/22)은 진행 중·다음 계산에서 빠진다', () => {
  const r = T.currentAndNext(trip.days, at('2026-11-22T10:00'));
  assert.equal(r.current, null);
  assert.equal(r.next.item.id, '1122-2');
});

test('일정 시각 표시', () => {
  assert.equal(T.fmtItemTime({ start: '09:45' }), '09:45');
  assert.equal(T.fmtItemTime({ start: '12:40', end: '15:40' }), '12:40–15:40');
  assert.equal(T.fmtItemTime({ start: '12:00', approx: true }), '12:00경');
  assert.equal(T.fmtItemTime({ start: '11:55', deadline: true }), '11:55까지');
  assert.equal(T.fmtItemTime({ allday: true }), '종일');
});

test('한국에서 겪는 일정은 한국 시각으로 (00:50 HST = 19:50 KST)', () => {
  const z = T.homeClock('2026-11-15', '00:50', info);
  assert.deepEqual([z.date, z.time], ['2026-11-15', '19:50']);
  assert.equal(T.homeClock('2026-11-15', '03:50', info).time, '22:50');
});

test('현재 시각 고정', () => {
  T.setNowOverride(at('2026-11-17T09:12'));
  assert.equal(T.now(), at('2026-11-17T09:12'));
  assert.ok(T.hasNowOverride());
  T.setNowOverride(null);
  assert.ok(Math.abs(T.now() - Date.now()) < 1000);
});
