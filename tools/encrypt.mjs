#!/usr/bin/env node
// private/trip-secret.json (+ private/vouchers/*) → data/secret.enc (AES-GCM 256, PBKDF2-SHA256)
//
//   node tools/encrypt.mjs                    # 터미널에서 비밀번호를 숨김 입력 (두 번)
//   echo "비밀번호" | node tools/encrypt.mjs --password-stdin
//   ALOHA_PW=... node tools/encrypt.mjs
//   옵션: --in <원본.json>  --out <출력.enc>  --new-salt  --iter <횟수>
//
// 같은 비밀번호로 다시 암호화하면 기존 파일의 salt 를 그대로 써서, 이미 예약 지갑을 연 폰은
// 비밀번호를 다시 묻지 않고 새 내용으로 바뀐다. 비밀번호를 바꾸면 salt 도 새로 만든다.
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import {
  encryptJSON, decryptJSON, b64ToBytes, normalizePassword,
  DEFAULT_ITER, MIN_PASSWORD_LENGTH,
} from '../js/crypto.js';
import { validateSecret } from './validate.mjs';
import { parseArgs, readPassword, loadPrivateSecret, deepEqual, ENC_PATH, PRIVATE_JSON } from './lib/secret-io.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inPath = args.in || PRIVATE_JSON;
  const outPath = args.out || ENC_PATH;

  const { secret, warnings } = loadPrivateSecret(inPath);
  const check = validateSecret(secret);
  for (const w of [...warnings, ...check.warnings]) console.log(`⚠️  ${w}`);
  if (check.errors.length) {
    for (const e of check.errors) console.error(`❌ ${e}`);
    throw new Error('원본에 오류가 있어 암호화하지 않았습니다.');
  }

  const password = await readPassword(args, { confirm: true });
  const pw = normalizePassword(password);
  if (pw.length < MIN_PASSWORD_LENGTH) throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  if (pw.length < 12) console.log('⚠️  비밀번호가 12자보다 짧습니다. 공개 저장소에 올라가는 파일이므로 긴 문장형 비밀번호를 권장합니다.');

  // 기존 파일을 같은 비밀번호로 열 수 있으면 salt·iter 를 재사용
  let salt;
  let iter = args.iter ? Number(args.iter) : DEFAULT_ITER;
  let reused = false;
  if (!args['new-salt'] && existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, 'utf8'));
      await decryptJSON(prev, pw);
      salt = b64ToBytes(prev.salt);
      if (!args.iter) iter = prev.iter;
      reused = true;
    } catch {
      // 비밀번호가 바뀌었거나 기존 파일이 깨짐 → 새 salt
    }
  }

  const env = await encryptJSON(secret, pw, { iter, salt });
  const text = JSON.stringify(env) + '\n';

  // 다시 풀어서 원본과 같은지 확인한 뒤에만 저장
  const { data } = await decryptJSON(JSON.parse(text), pw);
  if (!deepEqual(data, secret)) throw new Error('자체 검사 실패: 복호화 결과가 원본과 다릅니다. 저장하지 않았습니다.');

  writeFileSync(outPath, text);
  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(`✅ 암호화 완료 → ${outPath}`);
  console.log(`   예약 ${secret.bookings.length}건 · 바우처 ${Object.keys(secret.vouchers || {}).length}장 · ${kb}KB · PBKDF2 ${env.iter.toLocaleString()}회`);
  console.log(reused
    ? '   같은 비밀번호 → 기존 salt 재사용 (이미 연 폰은 비밀번호를 다시 묻지 않습니다)'
    : '   새 salt 사용 (폰에서 비밀번호를 한 번 다시 입력해야 합니다)');
  console.log('   다음: node tools/build-precache.mjs && git add data/secret.enc sw.js && git commit');
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
