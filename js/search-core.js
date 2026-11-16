// 통합 검색 로직 — DOM·네트워크 의존성 없이 맛집/장소/일정/쇼핑 검색 (오프라인 가능).
// 검색 결과는 앱에 실제 등록된 데이터만 반환합니다. 실시간 영업/재고 정보는 제공하지 않습니다.
const ALIAS_GROUPS = [
  ['우동', 'udon'], ['라면', 'ramen'], ['포케', 'poke', 'poké'],
  ['커피', 'coffee'], ['빙수', 'shave ice', 'shaveice'],
  ['스투시', 'stussy', 'stüssy'], ['세포라', 'sephora'],
  ['츠루톤탄', 'tsurutontan'], ['마루카메', 'marugame', 'marukame'],
  ['마카다미아', 'macadamia'], ['트롤리', 'trolley'],
  ['와이키키', 'waikiki'], ['초콜릿', 'chocolate'],
  ['새우', 'shrimp'], ['호텔', 'hotel'], ['쇼핑', 'shopping'],
];

export function foldSearch(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s\-_/.,()[\]·'’]+/g, '');
}
const synonyms = ALIAS_GROUPS.map((g) => g.map(foldSearch));

export function queryTerms(query) {
  const words = String(query || '').trim().toLocaleLowerCase().split(/[\s,·/]+/).filter(Boolean).slice(0, 6);
  return words.map((word) => {
    const n = foldSearch(word);
    const bare = n.endsWith('집') && n.length > 2 ? n.slice(0, -1) : n;
    const group = synonyms.find((g) => g.includes(bare));
    return [...new Set([n, bare, ...(group || [])])];
  });
}

function score(fields, terms) {
  if (!terms.length) return 0;
  const primary = foldSearch(fields[0]);
  const secondary = (fields.slice(1) || []).map(foldSearch);
  let points = 0;
  for (const alternatives of terms) {
    if (alternatives.some((t) => t && primary.includes(t))) {
      points += alternatives.some((t) => t && primary === t) ? 20 : 12;
    } else if (alternatives.some((t) => t && secondary.some((part) => part.includes(t)))) {
      points += 4;
    } else return 0;
  }
  return points;
}

function sorted(items) {
  return items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ko'));
}

export function searchCatalog(trip = {}, eats = {}, checklists = {}, query = '') {
  const terms = queryTerms(query);
  const result = { food: [], places: [], schedule: [], shopping: [] };
  if (!terms.length) return result;

  const tripPlaces = trip.places || [];
  const byId = new Map(tripPlaces.map((p) => [p.id, p]));
  const visit = new Map();
  for (const day of trip.days || []) {
    for (const it of day.items || []) {
      if (it.place && !visit.has(it.place)) visit.set(it.place, day.date);
    }
  }
  const categories = Object.fromEntries((eats.categories || []).map((c) => [c.id, c.title]));
  const areas = eats.areas || {};
  const eatIds = new Set();

  for (const p of eats.places || []) {
    eatIds.add(p.id);
    const related = byId.get(p.id);
    const fields = [p.name, p.name_en, categories[p.cat], areas[p.area], p.note, p.plan, p.addr, related && related.name, related && related.name_en];
    const rank = score(fields, terms);
    if (!rank) continue;
    result.food.push({
      kind: 'food', id: p.id, title: p.name, subtitle: [categories[p.cat], areas[p.area]].filter(Boolean).join(' · '),
      note: p.note || p.plan || '', address: p.addr || (related && related.addr) || '',
      mapQuery: p.q || [p.name_en || p.name, p.addr || 'Honolulu, HI'].join(', '),
      stop: p.stop || null, island: 'oahu', date: visit.get(p.id) || null, score: rank + (p.star ? 1 : 0),
    });
  }

  for (const p of tripPlaces) {
    if (eatIds.has(p.id)) continue; // 일정과 맛집에 같은 id가 있으면 맛집 결과에만 표시
    const fields = [p.name, p.name_en, p.note, p.addr, p.cat === 'food' ? '맛집 음식 식당' : ''];
    const rank = score(fields, terms);
    if (!rank) continue;
    const item = {
      kind: p.cat === 'food' ? 'food' : 'place', id: p.id, title: p.name,
      subtitle: p.cat === 'food' ? '일정에 등록된 음식점' : (p.cat === 'shop' ? '쇼핑 장소' : '여행 장소'),
      note: p.note || '', address: p.addr || '', mapQuery: p.addr ? [p.name_en || p.name, p.addr].join(', ') : (p.name_en || p.name),
      island: p.island || 'oahu', date: visit.get(p.id) || null, score: rank,
    };
    result[item.kind === 'food' ? 'food' : 'places'].push(item);
  }

  for (const day of trip.days || []) {
    for (const it of day.items || []) {
      const p = byId.get(it.place);
      const rank = score([it.title, it.note, p && p.name, p && p.name_en, p && p.note], terms);
      if (!rank) continue;
      result.schedule.push({
        kind: 'schedule', id: it.id, title: it.title, subtitle: day.date + (it.start ? ' · ' + it.start : ''),
        note: p ? p.name : '', date: day.date, score: rank,
      });
    }
  }

  for (const group of checklists.groups || []) {
    if (group.when !== 'shopping') continue;
    for (const it of group.items || []) {
      const rank = score([it.text, group.title, group.shopLabel], terms);
      if (!rank) continue;
      result.shopping.push({
        kind: 'shopping', id: it.id, title: it.text, subtitle: group.shopLabel || group.title,
        groupId: group.id, score: rank,
      });
    }
  }
  for (const key of Object.keys(result)) sorted(result[key]);
  return result;
}
