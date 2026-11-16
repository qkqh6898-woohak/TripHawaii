import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eatsCsv, eatQuery, embedUrl } from '../js/gmap.js';

const doc = JSON.parse(readFileSync(new URL('../data/eats.json', import.meta.url), 'utf8'));

test('맛집 CSV: 머리줄 + 63곳, 쉼표·따옴표가 있으면 감싼다', () => {
  const csv = eatsCsv(doc);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], '이름,위치,종류,지역,메모');
  assert.equal(lines.length, 1 + doc.places.length);
  assert.ok(lines.some((l) => l.startsWith('House Without A Key,"House Without A Key, Halekulani, 2199 Kalia Rd')));
  const tricky = eatsCsv({ categories: [{ id: 'x', title: 'X' }], areas: {}, places: [{ id: 'a', cat: 'x', name: 'A "B"', addr: '1 St' }] });
  assert.equal(tricky.split('\n')[1].split(',')[0], '"A ""B"""');
});

test('검색어와 앱 안 지도 주소', () => {
  assert.equal(eatQuery({ name: '한강', q: 'Korean restaurant, 1236 Waimanu St' }), 'Korean restaurant, 1236 Waimanu St');
  assert.equal(eatQuery({ name: 'X', name_en: 'X Bar' }), 'X Bar, Honolulu, HI');
  const u = new URL(embedUrl('Ono Seafood, 747 Kapahulu Ave'));
  assert.equal(u.origin + u.pathname, 'https://maps.google.com/maps');
  assert.equal(u.searchParams.get('output'), 'embed');
  assert.equal(u.searchParams.get('q'), 'Ono Seafood, 747 Kapahulu Ave');
});
