// Aloha Trip 서비스 워커 — 설치할 때 앱 파일·일정·지도·사진·암호화된 예약 파일을 모두 저장해
// 인터넷 없이도 열리게 한다. 아래 PRECACHE 블록은 tools/build-precache.mjs 가 자동으로 채운다
// (파일을 고친 뒤 `node tools/build-precache.mjs` 를 실행하면 버전과 목록이 바뀐다 — 직접 고치지 말 것).

/* PRECACHE:BEGIN */
const VERSION = 'f6e5-763c';
const FILES = [
  ['index.html', '74b53b86'],
  ['manifest.webmanifest', '433937d9'],
  ['css/app.css', '5688d5b0'],
  ['js/checklist.js', 'b5ef02ff'],
  ['js/crypto.js', '98dac433'],
  ['js/days.js', '79384bd8'],
  ['js/db.js', '64891c85'],
  ['js/expenses.js', 'aeb12467'],
  ['js/main.js', 'bd152a0d'],
  ['js/maps.js', '9ccd5e90'],
  ['js/more.js', 'b8b532c7'],
  ['js/phrases.js', '60ceb0f1'],
  ['js/prefs.js', 'fae33838'],
  ['js/settings.js', '2a60c20c'],
  ['js/sw-client.js', '47f1e6bd'],
  ['js/time.js', '423a3520'],
  ['js/today.js', '8775b815'],
  ['js/trip.js', '6cc7df95'],
  ['js/tts.js', 'd3e03a07'],
  ['js/ui.js', 'b4a8e379'],
  ['js/util.js', 'b9e732c0'],
  ['js/viewer.js', 'ef9f8888'],
  ['js/wallet.js', 'e87547ff'],
  ['js/weather.js', 'f8590ea6'],
  ['vendor/qrcode.js', 'ea91d711'],
  ['data/checklists.json', '4ee23fc3'],
  ['data/phrases.json', '222339e8'],
  ['data/trip.json', 'e6645c75'],
  ['maps/big-island.png', '6ef78aad'],
  ['maps/day-1115.png', '5f4f05b4'],
  ['maps/day-1116.png', '0c324230'],
  ['maps/day-1117.png', '96c7887d'],
  ['maps/day-1118.png', 'e329ccf4'],
  ['maps/day-1119.png', '9b8327f7'],
  ['maps/day-1120.png', '9c7b8b62'],
  ['maps/day-1121.png', 'f8a529af'],
  ['maps/day-1122.png', 'e6af9d03'],
  ['maps/day-1123.png', '7cf7c87c'],
  ['maps/day-1124.png', '22346d4e'],
  ['maps/day-1125.png', '02ebc83a'],
  ['maps/day-1126.png', 'ff2c2622'],
  ['maps/day-1127.png', 'b8867e97'],
  ['maps/korea-hawaii.png', '609fac3b'],
  ['maps/oahu.png', 'b271e04b'],
  ['maps/overview-hawaii.png', '854a2b36'],
  ['icons/apple-touch-icon.png', '019d240b'],
  ['icons/icon-192.png', '38d8a1e2'],
  ['icons/icon-512.png', '81a05014'],
  ['icons/icon-maskable-512.png', '50c0042b'],
];
/* PRECACHE:END */

const PREFIX = 'at-shell-';
const CACHE = PREFIX + VERSION;
const MANIFEST_KEY = '__manifest__';
const SCOPE_PATH = new URL('./', self.location).pathname;

async function shortHash(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  let hex = '';
  for (let i = 0; i < 4; i++) hex += digest[i].toString(16).padStart(2, '0');
  return hex;
}

// 이전 버전 캐시에서 내용이 같은 파일은 다시 받지 않고 복사한다 (로밍 데이터 절약)
async function previousCaches() {
  const out = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const cache = await caches.open(name);
    const res = await cache.match(MANIFEST_KEY);
    if (!res) continue;
    try { out.push({ cache, manifest: await res.json() }); } catch { /* 무시 */ }
  }
  return out;
}

async function fetchVerified(path, hash) {
  const get = async (url) => {
    const res = await fetch(new Request(url, { cache: 'reload' }));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const body = await res.arrayBuffer();
    return { res, body, ok: (await shortHash(body)) === hash };
  };
  let got = await get(path);
  if (!got.ok) {
    // 배포 직후에는 서버가 잠시 예전 파일을 줄 수 있다 → 조금 기다렸다 한 번 더
    await new Promise((r) => setTimeout(r, 1500));
    got = await get(`${path}?v=${hash}`);
  }
  const headers = new Headers();
  const type = got.res.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  return { response: new Response(got.body, { status: 200, headers }), verified: got.ok };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const olds = await previousCaches();
    const manifest = {};
    let unverified = 0;
    await Promise.all(FILES.map(async ([path, hash]) => {
      for (const old of olds) {
        if (old.manifest[path] === hash) {
          const hit = await old.cache.match(path);
          if (hit) { await cache.put(path, hit); manifest[path] = hash; return; }
        }
      }
      const { response, verified } = await fetchVerified(path, hash);
      if (!verified) unverified++;
      await cache.put(path, response);
      manifest[path] = hash;
    }));
    await cache.put(MANIFEST_KEY, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json', 'X-Unverified': String(unverified) } }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function respond(request, url) {
  const cache = await caches.open(CACHE);
  let key = url.pathname.slice(SCOPE_PATH.length);
  if (request.mode === 'navigate' || key === '') key = 'index.html';
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch {
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;       // 날씨·환율 API 는 건드리지 않는다
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  event.respondWith(respond(request, url));
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'STATUS' && event.ports && event.ports[0]) {
    event.waitUntil((async () => {
      let cached = 0;
      try {
        const cache = await caches.open(CACHE);
        const res = await cache.match(MANIFEST_KEY);
        if (res) cached = Object.keys(await res.json()).length;
      } catch { /* 0 */ }
      event.ports[0].postMessage({ version: VERSION, total: FILES.length, cached });
    })());
  }
});
