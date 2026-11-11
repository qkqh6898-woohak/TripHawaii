// 예약 정보 암호화/복호화 — AES-GCM 256 + PBKDF2-SHA256
// 브라우저(crypto.subtle)와 Node(globalThis.crypto.subtle)에서 같은 코드를 쓴다.
// 파일 형식(data/secret.enc, JSON):
//   { "v":1, "kdf":"PBKDF2-SHA256", "iter":600000, "salt":"base64", "iv":"base64", "ct":"base64" }

export const FORMAT_VERSION = 1;
export const KDF_NAME = 'PBKDF2-SHA256';
export const DEFAULT_ITER = 600000;
export const MIN_ITER = 100000;
export const MAX_ITER = 5000000;
export const MIN_PASSWORD_LENGTH = 8;

const te = new TextEncoder();
const td = new TextDecoder();

export class CryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) {
    throw new CryptoError('NO_WEBCRYPTO', '이 브라우저에서는 암호화 기능을 쓸 수 없어요. https 주소로 열었는지 확인해 주세요.');
  }
  return s;
}

export function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 같은 비밀번호가 기기·키보드에 따라 다르게 입력되는 일을 줄인다 (한글 조합형, 전각 문자, 앞뒤 공백).
export function normalizePassword(pw) {
  return String(pw == null ? '' : pw).normalize('NFKC').trim();
}

export function checkEnvelope(env) {
  const bad = (why) => new CryptoError('BAD_FORMAT', '예약 정보 파일 형식이 올바르지 않아요 (' + why + ').');
  if (!env || typeof env !== 'object') throw bad('객체가 아님');
  if (env.v !== FORMAT_VERSION) throw bad('버전 ' + env.v);
  if (env.kdf !== KDF_NAME) throw bad('kdf ' + env.kdf);
  if (!Number.isInteger(env.iter) || env.iter < MIN_ITER || env.iter > MAX_ITER) throw bad('iter ' + env.iter);
  for (const k of ['salt', 'iv', 'ct']) {
    if (typeof env[k] !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(env[k])) throw bad(k);
  }
  return env;
}

export async function deriveKey(password, saltBytes, iter) {
  const pw = normalizePassword(password);
  const base = await subtle().importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // 꺼낼 수 없는 키 — 기기에 저장해도 원문 키는 노출되지 않는다
    ['encrypt', 'decrypt']
  );
}

export async function encryptWithKey(key, obj, { salt, iter }) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = te.encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { v: FORMAT_VERSION, kdf: KDF_NAME, iter, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) };
}

export async function decryptWithKey(key, env) {
  checkEnvelope(env);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.ct));
  } catch (e) {
    // 비밀번호가 틀렸거나 파일이 변조된 경우 — AES-GCM은 둘을 구분하지 않는다
    throw new CryptoError('BAD_PASSWORD', '비밀번호가 맞지 않아요.');
  }
  try {
    return JSON.parse(td.decode(plain));
  } catch (e) {
    throw new CryptoError('BAD_FORMAT', '복호화한 내용이 올바른 JSON이 아니에요.');
  }
}

// 새로 암호화. salt를 넘기면 그 값을 다시 쓴다 (같은 비밀번호 → 같은 키 → 폰에서 자동 갱신 가능).
export async function encryptJSON(obj, password, opts = {}) {
  const iter = opts.iter || DEFAULT_ITER;
  if (!Number.isInteger(iter) || iter < MIN_ITER || iter > MAX_ITER) {
    throw new CryptoError('BAD_FORMAT', 'iter 범위가 올바르지 않아요.');
  }
  const salt = opts.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, iter);
  return encryptWithKey(key, obj, { salt, iter });
}

// 비밀번호로 복호화. 성공하면 { data, key } — key는 다음 갱신 때 비밀번호 없이 쓰려고 돌려준다.
export async function decryptJSON(env, password) {
  checkEnvelope(env);
  const key = await deriveKey(password, b64ToBytes(env.salt), env.iter);
  const data = await decryptWithKey(key, env);
  return { data, key };
}

export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? te.encode(input) : input;
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}
