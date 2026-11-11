#!/usr/bin/env node
// 노트북에서 앱을 미리 보는 작은 서버 (GitHub Pages 와 같은 /TripHawaii/ 경로로 띄운다)
//   node tools/serve.mjs            → http://localhost:8765/TripHawaii/
//   node tools/serve.mjs 9000       → 포트 지정
// 시각을 바꿔 보려면 주소 끝에 ?now=2026-11-17T09:12 (하와이 시각)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ALOHA_ROOT: 다른 폴더(테스트용 사본)를 대상으로 돌릴 때 지정
const ROOT = process.env.ALOHA_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/TripHawaii/';
const PORT = Number(process.argv[2]) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.enc': 'application/octet-stream', '.md': 'text/plain; charset=utf-8',
};
// 저장소에는 있지만 사이트로 내보내면 안 되는 경로
const BLOCKED = ['private', '.git', 'node_modules'];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.writeHead(302, { Location: BASE }); res.end(); return; }
    if (!url.pathname.startsWith(BASE)) { res.writeHead(404); res.end('not found'); return; }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const safe = normalize(rel);
    if (safe.startsWith('..') || safe.split(sep).some((part) => BLOCKED.includes(part))) { res.writeHead(403); res.end('forbidden'); return; }
    const file = join(ROOT, safe);
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e && e.message));
  }
});

server.listen(PORT, () => console.log(`Aloha Trip 미리보기 → http://localhost:${PORT}${BASE}`));
