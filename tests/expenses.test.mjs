import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toKRW, makeExpense, editExpense, summarize, settle, mergeExpenses, sanitizeExpense,
  encodeShare, decodeShare, parseImportText, tipCalc, usdOf, QR_MAX_URL,
} from '../js/expenses.js';

const env = { rate: 1400, fee: 0, device: 'devA', now: 1000 };
let seq = 0;
const ex = (over = {}, e = env) => makeExpense({
  id: `t${String(++seq).padStart(4, '0')}`, amount: 10, currency: 'USD', cat: 'food', payer: 'woohak', method: 'card', date: '2026-11-17', ...over,
}, e);

test('원화 환산: 달러 × 환율, 카드 수수료는 카드 결제에만', () => {
  assert.equal(toKRW(84, 'USD', 1400), 117600);
  assert.equal(toKRW(100, 'USD', 1400, 1.5, 'card'), 142100);
  assert.equal(toKRW(100, 'USD', 1400, 1.5, 'cash'), 140000);
  assert.equal(toKRW(12345, 'KRW', 1400, 1.5), 12345);
  assert.equal(toKRW(9.99, 'USD', 1387.5), 13861);
});

test('지출 만들기: 환율·수수료를 기록에 함께 저장한다', () => {
  const e = ex({ amount: '84', memo: '  저녁  ' });
  assert.equal(e.krw, 117600);
  assert.equal(e.rate, 1400);
  assert.equal(e.memo, '저녁');
  assert.equal(e.deleted, false);
  assert.equal(usdOf(e), 84);
  assert.throws(() => ex({ amount: 0 }), /금액/);
  assert.throws(() => ex({ amount: 'abc' }), /금액/);
  assert.throws(() => ex({ date: '11/17' }), /날짜/);
  assert.throws(() => makeExpense({ amount: 5, currency: 'USD', date: '2026-11-17' }, { rate: 0, fee: 0 }), /환율/);
});

test('나중에 환율을 바꿔도 과거 기록의 원화 금액은 그대로', () => {
  const old = ex({ amount: 50 });                        // 1400원일 때 입력
  assert.equal(old.krw, 70000);
  const later = ex({ amount: 50 }, { ...env, rate: 1500 });
  assert.equal(later.krw, 75000);
  assert.equal(old.krw, 70000);
  // 금액을 고쳐도 처음 입력한 날의 환율(1400)로 계산
  const edited = editExpense(old, { amount: 60, currency: 'USD', cat: 'food', payer: 'woohak', method: 'card', date: old.date, rate: 1500 }, 5000);
  assert.equal(edited.krw, 84000);
  assert.equal(edited.rate, 1400);
  assert.equal(edited.id, old.id);
  assert.equal(edited.createdAt, old.createdAt);
  assert.ok(edited.updatedAt > old.updatedAt);
});

test('합계: 오늘·현지 지출·분류별, 사전 결제는 총액에만 포함', () => {
  const list = [
    ex({ amount: 84, cat: 'food' }),
    ex({ amount: 20, cat: 'transport', date: '2026-11-16' }),
    ex({ amount: 387190, currency: 'KRW', cat: 'tour', prepaid: true, payer: 'joint' }),
    { ...ex({ amount: 999 }), deleted: true },
  ];
  const s = summarize(list, '2026-11-17');
  assert.equal(s.today, 117600);
  assert.equal(s.todayUsd, 84);
  assert.equal(s.trip, 117600 + 28000);
  assert.equal(s.tripUsd, 104);
  assert.equal(s.prepaid, 387190);
  assert.equal(s.all, 117600 + 28000 + 387190);
  assert.deepEqual(s.byCat, { food: 117600, transport: 28000 });
  assert.equal(s.count, 2);
});

// 정산 — 손으로 계산한 5가지 경우
test('정산 ① 우학만 100,000원 결제 → 성희가 우학에게 50,000원', () => {
  const r = settle([ex({ amount: 100000, currency: 'KRW', payer: 'woohak' })]);
  assert.deepEqual(r.transfer, { from: 'seonghee', to: 'woohak', amount: 50000 });
});

test('정산 ② 우학 100,000 · 성희 60,000 → 성희가 우학에게 20,000원', () => {
  const r = settle([
    ex({ amount: 100000, currency: 'KRW', payer: 'woohak' }),
    ex({ amount: 60000, currency: 'KRW', payer: 'seonghee' }),
  ]);
  assert.deepEqual(r.transfer, { from: 'seonghee', to: 'woohak', amount: 20000 });
  assert.deepEqual(r.paid, { woohak: 100000, seonghee: 60000, joint: 0 });
});

test('정산 ③ 공동 결제만 있으면 정산할 금액 없음', () => {
  const r = settle([ex({ amount: 200000, currency: 'KRW', payer: 'joint' })]);
  assert.equal(r.transfer, null);
  assert.equal(r.shared, 200000);
});

test('정산 ④ 개인 지출은 제외: 우학 80,000(그중 30,000 개인) · 성희 50,000 → 없음', () => {
  const r = settle([
    ex({ amount: 50000, currency: 'KRW', payer: 'woohak' }),
    ex({ amount: 30000, currency: 'KRW', payer: 'woohak', personal: true }),
    ex({ amount: 50000, currency: 'KRW', payer: 'seonghee' }),
  ]);
  assert.equal(r.transfer, null);
  assert.deepEqual(r.personal, { woohak: 30000, seonghee: 0 });
});

test('정산 ⑤ 달러 결제: 우학 $100 카드 · 성희 $50 현금 (1,400원) → 성희가 35,000원, 삭제된 기록은 무시', () => {
  const r = settle([
    ex({ amount: 100, payer: 'woohak', method: 'card' }),
    ex({ amount: 50, payer: 'seonghee', method: 'cash' }),
    { ...ex({ amount: 500, payer: 'seonghee' }), deleted: true },
  ]);
  assert.deepEqual(r.transfer, { from: 'seonghee', to: 'woohak', amount: 35000 });
});

test('정산: 성희가 더 냈으면 방향이 반대, 1원 미만은 정산 없음', () => {
  assert.deepEqual(settle([ex({ amount: 30000, currency: 'KRW', payer: 'seonghee' })]).transfer, { from: 'woohak', to: 'seonghee', amount: 15000 });
  assert.equal(settle([]).transfer, null);
});

test('병합: 새 기록은 추가, 같은 id 는 나중에 고친 쪽, 중복 없음', () => {
  const a = ex({ amount: 10 });
  const b = ex({ amount: 20 });
  const c = ex({ amount: 30 });
  const local = [a, b];
  const bNewer = { ...b, amount: 25, krw: 35000, updatedAt: b.updatedAt + 10 };
  const aOlder = { ...a, amount: 1, updatedAt: a.updatedAt - 10 };
  const r = mergeExpenses(local, [aOlder, bNewer, c]);
  assert.equal(r.merged.length, 3);
  assert.deepEqual([r.added, r.updated, r.same], [1, 1, 1]);
  assert.equal(r.merged.find((e) => e.id === a.id).amount, 10);   // 내 것이 더 최신 → 유지
  assert.equal(r.merged.find((e) => e.id === b.id).amount, 25);   // 상대가 더 최신 → 교체
  assert.deepEqual(r.changed.map((e) => e.id).sort(), [b.id, c.id].sort());
  // 같은 것을 한 번 더 받아도 변화 없음
  const again = mergeExpenses(r.merged, [aOlder, bNewer, c]);
  assert.deepEqual([again.added, again.updated, again.merged.length], [0, 0, 3]);
});

test('병합: 삭제도 전달된다 (나중에 삭제한 쪽이 이김)', () => {
  const a = ex({ amount: 10 });
  const deleted = { ...a, deleted: true, updatedAt: a.updatedAt + 5 };
  const r = mergeExpenses([a], [deleted]);
  assert.equal(r.updated, 1);
  assert.equal(r.merged[0].deleted, true);
  assert.equal(summarize(r.merged, a.date).trip, 0);
  // 삭제 뒤에 상대가 예전 기록을 다시 보내도 되살아나지 않는다
  assert.equal(mergeExpenses(r.merged, [a]).merged[0].deleted, true);
});

test('보내기 코드: 왕복하면 내용이 같다 (한글 메모·삭제·개인·사전결제 포함)', () => {
  const list = [
    ex({ amount: 12.5, memo: '마루카메 우동 🍜', cat: 'food', payer: 'seonghee', method: 'cash' }),
    { ...ex({ amount: 387190, currency: 'KRW', cat: 'tour', payer: 'joint', prepaid: true, bookingId: 'kualoa' }) },
    { ...ex({ amount: 40, personal: true, cat: 'shop' }), deleted: true },
  ];
  const code = encodeShare(list, { device: 'devA', owner: 'woohak', at: 123 });
  assert.match(code, /^j1\.[A-Za-z0-9_-]+$/);
  const back = decodeShare(code);
  assert.equal(back.owner, 'woohak');
  assert.equal(back.from, 'devA');
  assert.deepEqual(back.expenses, list);
  // 주소째로 붙여넣어도 된다
  assert.deepEqual(decodeShare(`https://example.com/TripHawaii/#/import?d=${code}`).expenses, list);
  assert.deepEqual(parseImportText(`  ${code}\n`).expenses, list);
});

test('보내기 코드: 지출 5건은 QR 한 장에 들어간다', () => {
  const list = Array.from({ length: 5 }, (_, i) => ex({ amount: 10 + i, memo: `점심 ${i}` }));
  const url = `https://qkqh.github.io/TripHawaii/#/import?d=${encodeShare(list, { device: 'devA', owner: 'woohak' })}`;
  assert.ok(url.length <= QR_MAX_URL, `주소 길이 ${url.length}`);
});

test('가져오기: 잘못된 입력은 한국어 오류로 거절한다', () => {
  assert.throws(() => decodeShare('hello'), /형식/);
  assert.throws(() => decodeShare('j1.!!!!'), /형식|깨졌/);
  assert.throws(() => decodeShare('j1.' + Buffer.from('{"v":2,"x":[]}').toString('base64url')), /형식/);
  assert.throws(() => decodeShare('j1.' + Buffer.from('{"v":1,"x":[["a"]]}').toString('base64url')), /올바르지 않은/);
  assert.throws(() => parseImportText(''), /비어/);
  assert.throws(() => parseImportText('{"app":"other","expenses":[]}'), /Aloha Trip/);
});

test('가져오기: 밖에서 온 기록은 값을 걸러 낸다 (스크립트·이상한 분류·음수)', () => {
  const e = sanitizeExpense({ id: 'abcd1234', date: '2026-11-17', amount: 10, krw: 14000, cat: '<script>', payer: 'hacker', method: 'x', memo: '<img src=x onerror=alert(1)>'.repeat(20), device: 'dev!@#A', updatedAt: '55', extra: 'ignored' });
  assert.equal(e.cat, 'etc');
  assert.equal(e.payer, 'joint');
  assert.equal(e.method, 'card');
  assert.equal(e.memo.length, 200);
  assert.equal(e.device, 'devA');
  assert.equal(e.updatedAt, 55);
  assert.equal('extra' in e, false);
  assert.equal(sanitizeExpense({ id: 'a b', date: '2026-11-17', amount: 1, krw: 1 }), null);
  assert.equal(sanitizeExpense({ id: 'abcd', date: '2026-11-17', amount: -5, krw: 1 }), null);
  assert.equal(sanitizeExpense({ id: 'abcd', date: 'today', amount: 5, krw: 1 }), null);
  assert.equal(sanitizeExpense(null), null);
});

test('파일로 내보낸 JSON 도 가져올 수 있다', () => {
  const list = [ex({ amount: 15 }), ex({ amount: 25, payer: 'seonghee' })];
  const text = JSON.stringify({ app: 'alohatrip', v: 1, kind: 'expenses', device: 'devB', exportedAt: 9, expenses: list });
  assert.deepEqual(parseImportText(text).expenses, list);
});

test('팁 계산기: $80 에 20% → 팁 $16, 합계 $96, 1인당 $48', () => {
  assert.deepEqual(tipCalc(80, 20, 2), { tip: 16, total: 96, each: 48 });
  assert.deepEqual(tipCalc(47.5, 18, 2), { tip: 8.55, total: 56.05, each: 28.03 });
  assert.deepEqual(tipCalc(0, 22, 2), { tip: 0, total: 0, each: 0 });
});
