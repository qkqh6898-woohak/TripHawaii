#!/usr/bin/env node
// data/secret.enc 를 비밀번호로 풀어 확인한다.
//
//   node tools/decrypt-check.mjs            # 풀리는지 + private 원본과 같은지 확인
//   node tools/decrypt-check.mjs --export   # 풀어서 private/trip-secret.json (+ private/vouchers/) 로 복원
//   옵션: --in <파일.enc>  --password-stdin  (또는 환경변수 ALOHA_PW)
//
// --export 는 원본 파일이 없는 새 컴퓨터·새 작업 환경에서 예약 정보를 고칠 때 쓴다.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decryptJSON } from '../js/crypto.js';
import { validateSecret } from './validate.mjs';
import { parseArgs, readPassword, loadPrivateSecret, deepEqual, ENC_PATH, PRIVATE_JSON, VOUCHER_DIR, PRIVATE_PHOTO_DIR } from './lib/secret-io.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in || ENC_PATH;
  if (!existsSync(inPath)) throw new Error(`암호화 파일이 없습니다: ${inPath}`);
  const env = JSON.parse(readFileSync(inPath, 'utf8'));
  const password = await readPassword(args);
  const { data } = await decryptJSON(env, password);

  const check = validateSecret(data);
  if (check.errors.length) {
    for (const e of check.errors) console.error(`❌ ${e}`);
    throw new Error('복호화는 됐지만 내용 구조에 오류가 있습니다.');
  }
  const nVouchers = Object.keys(data.vouchers || {}).length;
  console.log(`✅ 복호화 성공 — 예약 ${data.bookings.length}건 · 바우처 ${nVouchers}장 · 사진 ${Object.keys(data.photos || {}).length}장`);
  const missing = data.bookings.filter((b) => !(b.numbers || []).length).map((b) => b.id);
  if (missing.length) console.log(`   예약번호 미입력: ${missing.join(', ')}`);

  if (args.export) {
    const outPath = typeof args.export === 'string' ? args.export : PRIVATE_JSON;
    if (existsSync(outPath) && !args.force) throw new Error(`${outPath} 가 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.`);
    mkdirSync(dirname(outPath), { recursive: true });
    // 바우처는 파일로 풀고, JSON 에는 넣지 않는다 (encrypt.mjs 가 다시 묶는다)
    const vouchers = data.vouchers || {};
    if (nVouchers) mkdirSync(VOUCHER_DIR, { recursive: true });
    for (const [name, dataUrl] of Object.entries(vouchers)) {
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      writeFileSync(join(VOUCHER_DIR, name.replace(/[\\/]/g, '_')), Buffer.from(b64, 'base64'));
    }
    const photos = data.photos || {};
    if (Object.keys(photos).length) mkdirSync(PRIVATE_PHOTO_DIR, { recursive: true });
    for (const [name, dataUrl] of Object.entries(photos)) {
      writeFileSync(join(PRIVATE_PHOTO_DIR, name.replace(/[\\/]/g, '_')), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
    }
    const { vouchers: _omit, photos: _omit2, ...rest } = data;
    writeFileSync(outPath, JSON.stringify({ ...rest, vouchers: {} }, null, 2) + '\n');
    console.log(`📄 원본 복원 → ${outPath}${nVouchers ? ` (+ private/vouchers/ ${nVouchers}장)` : ''}${Object.keys(photos).length ? ` (+ private/photos/ ${Object.keys(photos).length}장)` : ''}`);
    console.log('   이 파일들은 .gitignore 로 커밋되지 않습니다. 고친 뒤 node tools/encrypt.mjs 를 실행하세요.');
    return;
  }

  if (existsSync(PRIVATE_JSON)) {
    const { secret } = loadPrivateSecret();
    if (deepEqual(secret, data)) console.log('✅ private 원본과 내용이 같습니다');
    else throw new Error('private 원본과 암호화 파일의 내용이 다릅니다. node tools/encrypt.mjs 로 다시 암호화하세요.');
  } else {
    console.log('ℹ️  private/trip-secret.json 이 없어 원본 비교는 건너뜁니다 (--export 로 복원 가능)');
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
