import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTrip, validatePhrases, validateChecklists, validateSecret } from '../tools/validate.mjs';
import { scanText, checkPath, checkEncFile, collectKnownSecrets } from '../tools/scan-secrets.mjs';

const load = (rel) => JSON.parse(readFileSync(new URL('../' + rel, import.meta.url), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const trip = load('data/trip.json');
const allFilesExist = { fileExists: () => true };

test('실제 trip.json 은 검증을 통과한다', () => {
  const r = validateTrip(trip, allFilesExist);
  assert.deepEqual(r.errors, []);
});

test('여행 기간은 11/15~11/27 13일이고 날짜가 연속된다', () => {
  assert.equal(trip.days.length, 13);
  assert.equal(trip.days[0].date, '2026-11-15');
  assert.equal(trip.days[12].date, '2026-11-27');
});

test('깨뜨린 JSON ① 날짜 하나가 빠지면 실패', () => {
  const t = clone(trip);
  t.days.splice(3, 1);
  const r = validateTrip(t, allFilesExist);
  assert.ok(r.errors.some((e) => e.includes('연속되지 않습니다')), r.errors.join('\n'));
});

test('깨뜨린 JSON ② 없는 장소를 가리키면 실패 (한국어 메시지)', () => {
  const t = clone(trip);
  t.days[2].items[2].place = 'kualoaa';
  const r = validateTrip(t, allFilesExist);
  assert.ok(r.errors.some((e) => e.includes('place "kualoaa"가 places에 없습니다')), r.errors.join('\n'));
});

test('깨뜨린 JSON ③ 시간 형식이 틀리면 실패', () => {
  const t = clone(trip);
  t.days[0].items[3].start = '25:00';
  assert.ok(validateTrip(t, allFilesExist).errors.some((e) => e.includes('HH:MM')));
  const t2 = clone(trip);
  t2.days[0].items[3].start = '9:30';
  assert.ok(validateTrip(t2, allFilesExist).errors.some((e) => e.includes('HH:MM')));
});

test('깨뜨린 JSON ④ 하루 안에서 시간순이 아니면 실패', () => {
  const t = clone(trip);
  t.days[1].items[2].start = '06:00';
  assert.ok(validateTrip(t, allFilesExist).errors.some((e) => e.includes('시간순이 아닙니다')));
});

test('깨뜨린 JSON ⑤ 좌표가 하와이 범위를 벗어나면 실패', () => {
  const t = clone(trip);
  t.places[0].lat = 37.46; // 인천
  t.places[0].lng = 126.44;
  assert.ok(validateTrip(t, allFilesExist).errors.some((e) => e.includes('하와이 범위')));
});

test('깨뜨린 JSON ⑥ schema·중복 id·없는 숙소·지도 파일 누락도 잡는다', () => {
  const a = clone(trip); a.schema = 2;
  assert.ok(validateTrip(a, allFilesExist).errors.some((e) => e.includes('schema')));
  const b = clone(trip); b.days[4].items[1].id = b.days[4].items[0].id;
  assert.ok(validateTrip(b, allFilesExist).errors.some((e) => e.includes('중복')));
  const c = clone(trip); c.days[5].hotel = 'nowhere';
  assert.ok(validateTrip(c, allFilesExist).errors.some((e) => e.includes('hotels 에 없습니다')));
  const d = validateTrip(trip, { fileExists: (p) => !p.startsWith('maps/') });
  assert.ok(d.errors.some((e) => e.includes('지도 파일이 없습니다')));
});

test('사진 파일이 아직 없으면 오류가 아니라 경고', () => {
  const r = validateTrip(trip, { fileExists: (p) => !p.startsWith('photos/') });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('사진 파일이 아직 없습니다')));
});

test('예약 id 참조 무결성 (--with-secret)', () => {
  const r = validateTrip(trip, allFilesExist);
  const ok = validateTrip(trip, { ...allFilesExist, bookingIds: r.bookingRefs });
  assert.deepEqual(ok.errors, []);
  const missing = validateTrip(trip, { ...allFilesExist, bookingIds: r.bookingRefs.filter((id) => id !== 'kualoa') });
  assert.ok(missing.errors.some((e) => e.includes('booking "kualoa"')));
});

test('공개 trip.json 에는 개인정보 패턴이 없다', () => {
  const text = readFileSync(new URL('../data/trip.json', import.meta.url), 'utf8');
  assert.deepEqual(scanText(text), []);
});

test('회화: 상황 8개 × 문장 5개', () => {
  const doc = load('data/phrases.json');
  assert.deepEqual(validatePhrases(doc).errors, []);
  assert.equal(doc.situations.reduce((n, s) => n + s.phrases.length, 0), 40);
  const broken = clone(doc); broken.situations[0].phrases.pop();
  assert.ok(validatePhrases(broken).errors.length > 0);
});

test('체크리스트: 항목 id 중복 없음', () => {
  const doc = load('data/checklists.json');
  assert.deepEqual(validateChecklists(doc).errors, []);
  const broken = clone(doc); broken.groups[1].items[0].id = broken.groups[0].items[0].id;
  assert.ok(validateChecklists(broken).errors.some((e) => e.includes('중복')));
});

test('예약 원본 구조 검사 (예시 파일)', () => {
  const ex = load('tools/private-example.json');
  ex.vouchers = { 'sample-tour.jpg': 'data:image/jpeg;base64,AAAA' };
  const r = validateSecret(ex);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.includes('미입력')));
  const bad = clone(ex); bad.bookings[0].contacts[0].tel = '808-555';
  assert.ok(validateSecret(bad).errors.some((e) => e.includes('tel')));
  const noVoucher = clone(ex); noVoucher.vouchers = {};
  assert.ok(validateSecret(noVoucher).errors.some((e) => e.includes('바우처')));
});

test('개인정보 스캔: 전화·이메일·예약번호 패턴을 찾는다', () => {
  const p1 = ['+1', '808', '555', '0123'].join('-');
  const p2 = ['010', '1234', '5678'].join('-');
  const mail = ['someone', 'mail.test'].join('@');
  const exp = ['EXP', '20260101', '00012345'].join('-');
  const rules = (t) => scanText(t).map((f) => f.rule);
  assert.ok(rules(`전화 ${p1}`).some((r) => r.includes('전화번호')));
  assert.ok(rules(`휴대폰 ${p2}`).some((r) => r.includes('전화번호')));
  assert.ok(rules(`메일 ${mail}`).includes('이메일'));
  assert.ok(rules(`예약 ${exp}`).includes('예약번호(EXP)'));
  assert.ok(rules('번호 ' + '1'.repeat(10)).some((r) => r.includes('긴 숫자열')));
  assert.deepEqual(scanText('11:55 쿠알로아 체크인 · 좌표 21.5209, -157.8373 · 2026-11-17'), []);
  assert.deepEqual(scanText(`허용 ${p1}`, { allow: [p1] }), []);
});

test('개인정보 스캔: private 원본의 값이 그대로 나오면 잡는다', () => {
  const secret = { profile: { names: ['홍길동전'] }, bookings: [{ id: 'x', numbers: [{ label: 'n', value: 'QWE123' }], contacts: [{ label: 't', tel: ['+1555', '000', '1111'].join('') }, { label: 'k', kakao: 'sampleid' }] }] };
  const known = collectKnownSecrets(secret);
  assert.ok(scanText('확정번호 qwe123 입니다', { known, skipGeneric: true }).length > 0);
  assert.ok(scanText('문의 (555) 000-1111', { known, skipGeneric: true }).length > 0);
  assert.ok(scanText('카톡 SampleID', { known, skipGeneric: true }).length > 0);
  assert.ok(scanText('예약자 홍길동전', { known, skipGeneric: true }).length > 0);
  assert.deepEqual(scanText('관계없는 문장', { known, skipGeneric: true }), []);
});

test('개인정보 스캔: 경로 규칙과 암호화 파일 형식', () => {
  assert.ok(checkPath('private/trip-secret.json').length > 0);
  assert.ok(checkPath('data/trip-secret.json').length > 0);
  assert.ok(checkPath('photos/voucher-kualoa.jpg').length > 0);
  assert.deepEqual(checkPath('data/trip.json'), []);
  assert.deepEqual(checkPath('data/secret.enc'), []);
  assert.equal(checkEncFile(JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, salt: 'AA==', iv: 'AA==', ct: 'AA==' })), null);
  assert.ok(checkEncFile(JSON.stringify({ schema: 1, bookings: [] })));
  assert.ok(checkEncFile('not json'));
});
