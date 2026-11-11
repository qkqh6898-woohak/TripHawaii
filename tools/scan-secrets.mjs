#!/usr/bin/env node
// 커밋 전 개인정보 검사 — 저장소에 올라가는 파일에 예약번호·전화번호·이메일 등이 평문으로 없는지 확인한다.
//
//   node tools/scan-secrets.mjs            # 추적 중 + 새 파일(무시 목록 제외) 전체 검사
//   node tools/scan-secrets.mjs --staged   # 커밋 대기(staged) 내용만 검사 (pre-commit 훅)
//
// 검사 내용
//   1) 경로 규칙: private/ 아래 파일, 평문 secret·voucher 파일이 올라가지 않는지
//   2) 일반 패턴: 전화번호, 이메일, 마이리얼트립 예약번호(EXP-…), 9자리 이상 숫자열
//   3) 알려진 값: private/trip-secret.json 이 있으면 그 안의 예약번호·연락처·이름이 그대로 들어갔는지
//   4) data/secret.enc 가 암호화 형식인지 (평문 JSON 이 잘못 올라간 경우 차단)
// 공개해도 되는 값(공공기관 대표번호 등)은 tools/scan-allow.json 의 allow 목록에 적는다.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip']);

export const PATTERNS = [
  { rule: '전화번호(국제)', re: /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{4}/g },
  { rule: '전화번호(휴대폰)', re: /(?<!\d)01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g },
  { rule: '전화번호(하와이)', re: /\(?(?<!\d)808\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g },
  { rule: '이메일', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  { rule: '예약번호(EXP)', re: /EXP-\d{6,}(?:-\d+)?/g },
  { rule: '긴 숫자열(9자리 이상)', re: /(?<![\d.#x])\d{9,}(?![\d.])/g },
];

const SAFE_EMAIL_DOMAINS = ['example.com', 'example.org', 'users.noreply.github.com', 'noreply.github.com'];

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(staged) {
  if (staged) return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((f) => existsSync(join(ROOT, f)));
}

function readContent(file, staged) {
  if (staged) return execFileSync('git', ['show', `:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return readFileSync(join(ROOT, file));
}

function mask(s) {
  const t = String(s);
  if (t.length <= 4) return t[0] + '***';
  return t.slice(0, 3) + '…' + '*'.repeat(Math.min(6, t.length - 4)) + t.slice(-1);
}

// private 원본에서 "그대로 나오면 안 되는 값"을 모은다
export function collectKnownSecrets(secret) {
  const out = new Map(); // 값 → 설명
  const add = (v, why, minLen = 5) => {
    if (typeof v !== 'string') return;
    const t = v.trim();
    if (t.length >= minLen) out.set(t.toLowerCase(), why);
    const digits = t.replace(/\D/g, '');
    if (digits.length >= 8 && digits !== t) {
      out.set(digits, why + '(숫자만)');
      // 국가번호를 뺀 표기도 잡는다: +1 808… → 808…, +82 10… → 010…
      if (digits.length > 10) out.set(digits.slice(-10), why + '(국가번호 제외)');
      if (digits.startsWith('82') && digits.length >= 11) out.set('0' + digits.slice(2), why + '(국내 표기)');
    }
  };
  for (const [k, v] of Object.entries(secret.profile || {})) {
    // 이름은 한글 3자도 잡아야 하므로 최소 길이를 낮춘다
    if (Array.isArray(v)) v.forEach((x) => add(x, `profile.${k}`, 3));
    else add(v, `profile.${k}`, 3);
  }
  for (const b of secret.bookings || []) {
    for (const n of b.numbers || []) add(n.value, `예약번호(${b.id})`);
    for (const c of b.contacts || []) {
      add(c.tel, `연락처(${b.id})`);
      add(c.kakao, `카카오톡 ID(${b.id})`);
      add(c.email, `이메일(${b.id})`);
    }
  }
  return out;
}

/**
 * 텍스트 한 덩어리를 검사한다.
 * @returns {{rule:string, line:number, match:string}[]}
 */
export function scanText(text, { allow = [], known = new Map(), skipGeneric = false } = {}) {
  const findings = [];
  const squash = (v) => v.toLowerCase().replace(/[\s().-]/g, '');
  const allowList = allow.map(squash);
  // 허용 목록의 값과 같거나, 그 값의 일부(예: 국가번호를 뺀 뒷부분)면 통과
  const isAllowed = (hit) => { const h = squash(hit); return allowList.some((a) => a === h || (h.length >= 7 && a.includes(h))); };
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('scan-secrets: allow-line')) return;
    if (!skipGeneric) {
      for (const { rule, re } of PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          const hit = m[0];
          if (isAllowed(hit)) continue;
          if (rule === '이메일') {
            const domain = hit.split('@')[1].toLowerCase();
            if (SAFE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) continue;
          }
          findings.push({ rule, line: idx + 1, match: hit });
        }
      }
    }
    if (known.size) {
      const lower = line.toLowerCase();
      const digitsOnly = lower.replace(/[\s().-]/g, '');
      for (const [value, why] of known) {
        if (isAllowed(value)) continue;
        if (lower.includes(value) || (/^\d+$/.test(value) && digitsOnly.includes(value))) {
          findings.push({ rule: `알려진 개인정보: ${why}`, line: idx + 1, match: value });
        }
      }
    }
  });
  return findings;
}

export function checkPath(file) {
  const f = file.replace(/\\/g, '/');
  const problems = [];
  if (f.startsWith('private/') || f.includes('/private/')) problems.push('private/ 아래 파일은 커밋하면 안 됩니다');
  if (/(^|\/)vouchers?\//i.test(f)) problems.push('바우처 폴더는 커밋하면 안 됩니다 (암호화 파일 안에만 넣기)');
  if (/secret/i.test(f) && /\.json$/i.test(f)) problems.push('secret JSON 평문 파일은 커밋하면 안 됩니다');
  if (/voucher/i.test(f) && BINARY_EXT.has(extname(f).toLowerCase())) problems.push('바우처 이미지는 커밋하면 안 됩니다');
  return problems;
}

export function checkEncFile(text) {
  try {
    const env = JSON.parse(text);
    const keys = Object.keys(env).sort().join(',');
    if (keys !== 'ct,iter,iv,kdf,salt,v') return `암호화 형식이 아닙니다 (키: ${keys})`;
    if (env.kdf !== 'PBKDF2-SHA256' || !(env.iter >= 100000)) return 'kdf/iter 값이 올바르지 않습니다';
    return null;
  } catch {
    return 'JSON 으로 읽을 수 없습니다';
  }
}

function main() {
  const staged = process.argv.includes('--staged');
  const allowPath = join(ROOT, 'tools', 'scan-allow.json');
  const allowDoc = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  const allow = allowDoc.allow || [];
  const skipGenericIn = allowDoc.skipGenericIn || [];

  let known = new Map();
  const privatePath = join(ROOT, 'private', 'trip-secret.json');
  if (existsSync(privatePath)) {
    try { known = collectKnownSecrets(JSON.parse(readFileSync(privatePath, 'utf8'))); } catch { /* 원본이 깨졌으면 일반 패턴만 */ }
  }

  const files = listFiles(staged);
  const problems = [];
  for (const file of files) {
    for (const p of checkPath(file)) problems.push(`${file}: ${p}`);
    const buf = readContent(file, staged);
    const ext = extname(file).toLowerCase();
    if (file.replace(/\\/g, '/') === 'data/secret.enc') {
      const bad = checkEncFile(buf.toString('utf8'));
      if (bad) problems.push(`${file}: ${bad}`);
      continue; // 암호문(base64)은 패턴 검사 대상이 아님
    }
    const isBinary = BINARY_EXT.has(ext);
    const text = buf.toString(isBinary ? 'latin1' : 'utf8');
    const skipGeneric = isBinary || skipGenericIn.some((prefix) => file.replace(/\\/g, '/').startsWith(prefix));
    for (const f of scanText(text, { allow, known, skipGeneric })) {
      problems.push(`${file}:${f.line}: [${f.rule}] ${mask(f.match)}`);
    }
  }

  // .gitignore 에 private/ 가 있는지
  const gi = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : '';
  if (!/^private\/\s*$/m.test(gi)) problems.push('.gitignore: "private/" 줄이 없습니다');

  if (problems.length) {
    console.error('❌ 개인정보 검사 실패 — 아래 내용을 지우거나 private/ 로 옮긴 뒤 다시 시도하세요');
    for (const p of problems) console.error('   ' + p);
    console.error('\n(공개해도 되는 값이면 tools/scan-allow.json 의 allow 에 추가)');
    process.exit(1);
  }
  console.log(`✅ 개인정보 검사 통과 — 파일 ${files.length}개${known.size ? ` · 알려진 값 ${known.size}개 대조` : ' · 일반 패턴만 (private 원본 없음)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
