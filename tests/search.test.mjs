import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldSearch, queryTerms, searchCatalog } from '../js/search-core.js';

const load = (rel) => JSON.parse(readFileSync(new URL('../' + rel, import.meta.url), 'utf8'));
const trip = load('data/trip.json');
const eats = load('data/eats.json');
const shops = load('data/checklists.json');
const search = (query) => searchCatalog(trip, eats, shops, query);

test('검색어 정규화: 공백·대소문자·유니코드 처리', () => {
  assert.equal(foldSearch('  Udon-Gama '), 'udongama');
  assert.equal(queryTerms('우동').length, 1);
});

test('우동 → 츠루톤탄·마루카메·Udon Gama-Dashi, 중복 없이 3곳', () => {
  const result = search('우동');
  assert.ok(result.food.some((p) => p.title.includes('츠루톤탄')), '츠루톤탄 결과');
  assert.ok(result.food.some((p) => p.title.includes('마루카메')), '마루카메 결과');
  assert.ok(result.food.some((p) => p.title.includes('Gama-Dashi')), '가마 다시 결과');
  assert.equal(new Set(result.food.map((p) => p.id)).size, result.food.length, '같은 음식점 중복 금지');
  assert.ok(result.food.every((p) => p.mapQuery && p.title));
});

test('udon, 우동집, 츠루톤탄 검색도 정상', () => {
  for (const query of ['udon', '우동집', '츠루톤탄']) {
    const r = search(query);
    assert.ok(r.food.some((p) => p.title.includes('츠루톤탄')), query);
  }
});

test('포케·커피는 맛집과 장소를 검색한다', () => {
  assert.ok(search('포케').food.some((p) => /poke|poké/i.test(p.title + ' ' + p.subtitle)));
  assert.ok(search('커피').food.length + search('커피').places.length > 0);
});

test('세포라와 Glossier는 기존 쇼핑 체크리스트를 연결한다', () => {
  const sephora = search('세포라').shopping;
  assert.ok(sephora.length > 0);
  assert.ok(sephora.some((p) => p.groupId === 'shop-sephora'));
  const glossier = search('Glossier').shopping;
  assert.ok(glossier.length > 0);
  assert.ok(glossier.every((p) => p.groupId === 'shop-sephora'));
});

test('일정 제목 검색과 날짜 링크 연결', () => {
  const r = search('츠루톤탄');
  assert.ok(r.schedule.some((p) => /^2026-11-/.test(p.date)));
  assert.ok(r.schedule.some((p) => p.title.includes('츠루톤탄')));
});

test('빈 검색·없는 결과는 빈 배열', () => {
  for (const query of ['', '   ', '세상에없는무작위검색어987']) {
    const result = search(query);
    assert.ok(Object.values(result).every((list) => list.length === 0), query);
  }
});

test('다중 검색어는 AND 조건으로 교집합만 반환', () => {
  const result = search('츠루톤탄 우동');
  assert.ok(result.food.some((p) => p.id === 'tsurutontan'));
  assert.ok(!result.food.some((p) => p.id === 'udongama'));
});
