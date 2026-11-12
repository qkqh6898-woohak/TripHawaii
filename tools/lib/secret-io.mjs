// tools 공용: 비밀번호 입력, private/ 원본 읽기, 바우처 이미지 묶기
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRIVATE_JSON = join(ROOT, 'private', 'trip-secret.json');
export const VOUCHER_DIR = join(ROOT, 'private', 'vouchers');
// 공개하면 안 되는 사진(인터넷에서 찾은 남의 사진 등) — 암호화 파일 안에만 넣는다
export const PRIVATE_PHOTO_DIR = join(ROOT, 'private', 'photos');
export const ENC_PATH = join(ROOT, 'data', 'secret.enc');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; } else { args[key] = true; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = function (s) { if (!muted) rl.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

function readStdinLine() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
  });
}

// 비밀번호를 받는 방법 (우선순위): --password-stdin → 환경변수 ALOHA_PW → 터미널에서 숨김 입력
// 비밀번호는 화면·파일·기록에 남기지 않는다. (명령줄 인자로는 받지 않는다 — 셸 기록에 남기 때문)
export async function readPassword(args, { confirm = false } = {}) {
  if (args['password-stdin']) return readStdinLine();
  if (process.env.ALOHA_PW) return process.env.ALOHA_PW;
  if (!process.stdin.isTTY) {
    throw new Error('비밀번호를 받을 수 없습니다. 터미널에서 실행하거나 --password-stdin 또는 환경변수 ALOHA_PW 를 사용하세요.');
  }
  const pw = await readHidden('예약 비밀번호: ');
  if (confirm) {
    const again = await readHidden('한 번 더 입력: ');
    if (pw !== again) throw new Error('두 번 입력한 비밀번호가 서로 다릅니다.');
  }
  return pw;
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// private/trip-secret.json 을 읽고, bookings[].vouchers 에 적힌 파일을 private/vouchers/ 에서 찾아
// data URL 로 묶는다. (JSON 안에 이미 data URL 이 있으면 그대로 둔다)
export function loadPrivateSecret(path = PRIVATE_JSON, voucherDir = VOUCHER_DIR, photoDir = PRIVATE_PHOTO_DIR) {
  if (!existsSync(path)) {
    throw new Error(`원본 파일이 없습니다: ${path}\n(private/trip-secret.example.json 을 참고해 만들거나, decrypt-check.mjs --export 로 복원하세요)`);
  }
  const secret = readJSON(path);
  const vouchers = { ...(secret.vouchers || {}) };
  const warnings = [];
  for (const b of secret.bookings || []) {
    for (const name of b.vouchers || []) {
      if (vouchers[name]) continue;
      const file = join(voucherDir, name);
      if (!existsSync(file)) throw new Error(`바우처 파일이 없습니다: private/vouchers/${name} (예약 "${b.id}")`);
      const mime = MIME[extname(name).toLowerCase()];
      if (!mime) throw new Error(`지원하지 않는 바우처 형식입니다: ${name} (jpg/png/webp 만 가능)`);
      const size = statSync(file).size;
      if (size > 600 * 1024) warnings.push(`${name}: ${(size / 1024).toFixed(0)}KB — 폭 1200px·JPEG 80% 로 줄이는 것을 권장 (tools/shrink_image.py)`);
      vouchers[name] = `data:${mime};base64,${readFileSync(file).toString('base64')}`;
    }
  }
  // private/photos/ 의 사진을 모두 묶는다 (앱에서는 trip.json 의 photos/이름.jpg 자리에 보인다)
  const photos = { ...(secret.photos || {}) };
  if (existsSync(photoDir)) {
    for (const name of readdirSync(photoDir).sort()) {
      const mime = MIME[extname(name).toLowerCase()];
      if (!mime || photos[name]) continue;
      const size = statSync(join(photoDir, name)).size;
      if (size > 400 * 1024) warnings.push(`photos/${name}: ${(size / 1024).toFixed(0)}KB — tools/shrink_image.py 로 줄이는 것을 권장`);
      photos[name] = `data:${mime};base64,${readFileSync(join(photoDir, name)).toString('base64')}`;
    }
  }
  const out = { ...secret, vouchers };
  if (Object.keys(photos).length) out.photos = photos;
  return { secret: out, warnings };
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}
