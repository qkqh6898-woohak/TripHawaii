import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptJSON, decryptJSON, decryptWithKey, checkEnvelope, normalizePassword,
  b64ToBytes, bytesToB64, sha256Hex, CryptoError, DEFAULT_ITER, MIN_ITER,
} from '../js/crypto.js';

// 테스트는 빠르게 돌도록 최소 반복 횟수를 쓴다 (실제 파일은 DEFAULT_ITER)
const FAST = { iter: MIN_ITER };
const sample = {
  schema: 1,
  bookings: [{ id: 'sample', title: '예시 투어 🌺', numbers: [{ label: '확정번호', value: 'ABC123' }] }],
  vouchers: { 'a.jpg': 'data:image/jpeg;base64,' + 'A'.repeat(5000) },
};

test('암호화 → 복호화 결과가 원본과 같다', async () => {
  const env = await encryptJSON(sample, '테스트 비밀번호 aloha', FAST);
  assert.equal(env.v, 1);
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.equal(b64ToBytes(env.salt).length, 16);
  assert.equal(b64ToBytes(env.iv).length, 12);
  const { data } = await decryptJSON(env, '테스트 비밀번호 aloha');
  assert.deepEqual(data, sample);
});

test('암호문에는 원문이 보이지 않는다', async () => {
  const env = await encryptJSON(sample, 'correct horse battery', FAST);
  const text = JSON.stringify(env);
  assert.ok(!text.includes('ABC123'));
  assert.ok(!text.includes('bookings'));
});

test('틀린 비밀번호는 실패한다', async () => {
  const env = await encryptJSON(sample, 'right-password', FAST);
  await assert.rejects(() => decryptJSON(env, 'wrong-password'), (e) => e instanceof CryptoError && e.code === 'BAD_PASSWORD');
});

test('변조된 암호문은 실패한다', async () => {
  const env = await encryptJSON(sample, 'right-password', FAST);
  const ct = b64ToBytes(env.ct);
  ct[10] ^= 0xff;
  const tampered = { ...env, ct: bytesToB64(ct) };
  await assert.rejects(() => decryptJSON(tampered, 'right-password'), (e) => e.code === 'BAD_PASSWORD');
  const badIv = { ...env, iv: bytesToB64(new Uint8Array(12)) };
  await assert.rejects(() => decryptJSON(badIv, 'right-password'), (e) => e.code === 'BAD_PASSWORD');
});

test('같은 내용도 암호화할 때마다 결과가 다르다 (무작위 salt·iv)', async () => {
  const a = await encryptJSON(sample, 'pw-12345678', FAST);
  const b = await encryptJSON(sample, 'pw-12345678', FAST);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('salt 를 재사용하면 예전에 만든 키로 새 파일을 열 수 있다 (비밀번호 재입력 없이 갱신)', async () => {
  const first = await encryptJSON(sample, 'same-password', FAST);
  const { key } = await decryptJSON(first, 'same-password');
  const updated = { ...sample, bookings: [...sample.bookings, { id: 'new', title: '추가 예약' }] };
  const second = await encryptJSON(updated, 'same-password', { ...FAST, salt: b64ToBytes(first.salt) });
  assert.equal(second.salt, first.salt);
  assert.notEqual(second.iv, first.iv);
  assert.deepEqual(await decryptWithKey(key, second), updated);
  // salt 가 바뀌면 예전 키로는 열 수 없다
  const rotated = await encryptJSON(updated, 'same-password', FAST);
  await assert.rejects(() => decryptWithKey(key, rotated), (e) => e.code === 'BAD_PASSWORD');
});

test('비밀번호 정규화: 한글 조합형·앞뒤 공백 차이를 흡수한다', async () => {
  const nfc = '하와이신혼여행';
  const nfd = nfc.normalize('NFD');
  assert.notEqual(nfc, nfd);
  assert.equal(normalizePassword(nfd), normalizePassword(nfc));
  const env = await encryptJSON(sample, nfc, FAST);
  const { data } = await decryptJSON(env, '  ' + nfd + ' ');
  assert.deepEqual(data, sample);
});

test('형식이 잘못된 파일은 BAD_FORMAT', async () => {
  const env = await encryptJSON(sample, 'pw-12345678', FAST);
  assert.throws(() => checkEnvelope({ ...env, v: 2 }), (e) => e.code === 'BAD_FORMAT');
  assert.throws(() => checkEnvelope({ ...env, kdf: 'MD5' }), (e) => e.code === 'BAD_FORMAT');
  assert.throws(() => checkEnvelope({ ...env, iter: 1000 }), (e) => e.code === 'BAD_FORMAT');
  assert.throws(() => checkEnvelope({ ...env, ct: undefined }), (e) => e.code === 'BAD_FORMAT');
  assert.throws(() => checkEnvelope(null), (e) => e.code === 'BAD_FORMAT');
  await assert.rejects(() => decryptJSON({ schema: 1, bookings: [] }, 'pw'), (e) => e.code === 'BAD_FORMAT');
});

test('기본 반복 횟수는 60만 회 이상', () => {
  assert.ok(DEFAULT_ITER >= 600000);
});

test('sha256Hex', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('큰 데이터(바우처 3MB)도 왕복된다', async () => {
  const big = { vouchers: { 'big.jpg': 'data:image/jpeg;base64,' + 'Q'.repeat(3 * 1024 * 1024) } };
  const env = await encryptJSON(big, 'pw-12345678', FAST);
  const { data } = await decryptJSON(env, 'pw-12345678');
  assert.equal(data.vouchers['big.jpg'].length, big.vouchers['big.jpg'].length);
});
