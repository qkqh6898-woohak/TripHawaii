#!/usr/bin/env node
// sw.js 의 오프라인 캐시 목록과 버전을 다시 만든다.
//   node tools/build-precache.mjs          # sw.js 갱신
//   node tools/build-precache.mjs --check  # 최신인지 확인만 (CI·커밋 훅) — 다르면 종료 코드 1
// 앱 파일·일정·지도·사진·data/secret.enc 가운데 하나라도 바뀌면 버전이 바뀌고,
// 폰의 앱은 다음에 열 때 새 파일을 받아 '새 버전 적용' 버튼을 보여준다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ALOHA_ROOT: 다른 폴더(테스트용 사본)를 대상으로 돌릴 때 지정
const ROOT = process.env.ALOHA_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const BEGIN = '/* PRECACHE:BEGIN */';
const END = '/* PRECACHE:END */';

const SOURCES = [
  { dir: '.', files: ['index.html', 'manifest.webmanifest'] },
  { dir: 'css', ext: ['.css'] },
  { dir: 'js', ext: ['.js'] },
  { dir: 'vendor', ext: ['.js'] },
  { dir: 'data', ext: ['.json', '.enc'] },
  { dir: 'maps', ext: ['.png'] },
  { dir: 'photos', ext: ['.jpg', '.jpeg', '.png', '.webp'] },
  { dir: 'icons', ext: ['.png'] },
];

function listFiles() {
  const out = [];
  for (const src of SOURCES) {
    const abs = join(ROOT, src.dir);
    if (!existsSync(abs)) continue;
    const names = src.files || readdirSync(abs).filter((n) => src.ext.includes(extname(n).toLowerCase()));
    for (const name of names.sort()) {
      const full = join(abs, name);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      out.push(src.dir === '.' ? name : `${src.dir}/${name}`);
    }
  }
  return out;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// 지도 이미지의 실제 크기를 data/maps.json 에 적어 둔다 → 화면이 이미지 자리를 미리 잡아 로딩 중에 밀리지 않는다
function mapSizesJson() {
  const dir = join(ROOT, 'maps');
  const sizes = {};
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png')).sort()) {
      const buf = readFileSync(join(dir, name));
      if (buf.length > 24 && buf.toString('latin1', 12, 16) === 'IHDR') sizes[`maps/${name}`] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    }
  }
  return JSON.stringify(sizes) + '\n';
}

// 실제로 들어 있는 사진 파일 목록 → 앱은 이 목록에 있는 사진만 보여준다 (아직 없는 사진 때문에 빈칸이 생기지 않게)
function photoListJson() {
  const dir = join(ROOT, 'photos');
  const list = existsSync(dir)
    ? readdirSync(dir).filter((n) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(n).toLowerCase())).sort().map((n) => `photos/${n}`)
    : [];
  return JSON.stringify(list) + '\n';
}

function build() {
  let mapsStale = false;
  for (const [name, text] of [['maps.json', mapSizesJson()], ['photos.json', photoListJson()]]) {
    const path = join(ROOT, 'data', name);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    mapsStale = true;
    if (!process.argv.includes('--check')) writeFileSync(path, text);
  }
  const files = listFiles().map((p) => [p, sha(readFileSync(join(ROOT, p))).slice(0, 8)]);
  const swPath = join(ROOT, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const a = sw.indexOf(BEGIN);
  const b = sw.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error('sw.js 에서 PRECACHE 블록을 찾지 못했습니다');
  const shell = sw.slice(0, a) + sw.slice(b + END.length);            // 블록을 뺀 나머지 코드
  const v = sha(JSON.stringify(files) + sha(shell)).slice(0, 8);
  const version = `${v.slice(0, 4)}-${v.slice(4)}`;
  const block = `${BEGIN}\nconst VERSION = '${version}';\nconst FILES = [\n${files.map(([p, h]) => `  ['${p}', '${h}'],`).join('\n')}\n];\n${END}`;
  const next = sw.slice(0, a) + block + sw.slice(b + END.length);
  const bytes = files.reduce((n, [p]) => n + statSync(join(ROOT, p)).size, 0);
  return { swPath, current: sw, next, version, count: files.length, bytes, mapsStale };
}

const check = process.argv.includes('--check');
const r = build();
if (check) {
  if (r.current !== r.next || r.mapsStale) {
    console.error('❌ sw.js 의 캐시 목록이 최신이 아닙니다 → node tools/build-precache.mjs 를 실행하고 sw.js 를 함께 커밋하세요');
    process.exit(1);
  }
  console.log(`✅ 오프라인 캐시 목록 최신 — 버전 ${r.version} · 파일 ${r.count}개 · ${(r.bytes / 1024 / 1024).toFixed(2)}MB`);
} else {
  if (r.current !== r.next) writeFileSync(r.swPath, r.next);
  console.log(`${r.current !== r.next ? '✏️  sw.js 갱신' : '변경 없음'} — 버전 ${r.version} · 파일 ${r.count}개 · ${(r.bytes / 1024 / 1024).toFixed(2)}MB`);
}
