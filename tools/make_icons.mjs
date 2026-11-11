#!/usr/bin/env node
// 앱 아이콘 다시 만들기 (히비스커스) — Playwright(Chromium) 가 있는 환경에서만 실행한다.
//   node tools/make_icons.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright 가 전역에 설치된 환경에서도 찾을 수 있게 require 로 불러온다
const { chromium } = createRequire(import.meta.url)('playwright');

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff9a62"/><stop offset="1" stop-color="#c8402a"/>
    </linearGradient>
    <radialGradient id="petal" cx="50%" cy="100%" r="95%">
      <stop offset="0" stop-color="#ffc2cf"/><stop offset=".55" stop-color="#fff3f5"/><stop offset="1" stop-color="#ffffff"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <path d="M0 418 Q64 392 128 418 T256 418 T384 418 T512 418 V512 H0Z" fill="#0b7285" opacity=".38"/>
  <path d="M0 452 Q64 428 128 452 T256 452 T384 452 T512 452 V512 H0Z" fill="#0b7285" opacity=".45"/>
  <g transform="translate(256 246) scale(${scale})">
    <g fill="url(#petal)" stroke="#ffffff" stroke-width="3">
      ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-92" rx="70" ry="104" transform="rotate(${a})"/>`).join('')}
    </g>
    <circle r="30" fill="#c8402a"/>
    <path d="M0 0 L58 -132" stroke="#ffcf5c" stroke-width="13" stroke-linecap="round"/>
    <circle cx="58" cy="-132" r="15" fill="#ffcf5c"/>
    <circle cx="36" cy="-128" r="8" fill="#ffcf5c"/>
    <circle cx="70" cy="-108" r="8" fill="#ffcf5c"/>
  </g>
</svg>`;

const targets = [
  ['icon-512.png', 512, 1.0],
  ['icon-192.png', 192, 1.0],
  ['apple-touch-icon.png', 180, 1.0],
  ['icon-maskable-512.png', 512, 0.72],   // 마스크에 잘리지 않게 가운데 80% 안에 그림을 둔다
];

const browser = await chromium.launch();
for (const [name, size, scale] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg(scale)}`);
  await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log('  icons/' + name);
}
await browser.close();
