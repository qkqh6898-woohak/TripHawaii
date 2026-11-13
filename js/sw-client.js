// 서비스 워커 등록·업데이트 확인·오프라인 준비 상태 조회
let registration = null;
let waiting = null;
let reloading = false;

function announce(what) {
  window.dispatchEvent(new CustomEvent('aloha:update', { detail: { what } }));
}

export const swSupported = () => 'serviceWorker' in navigator;

// 대기 중인 새 버전이 있는지 직접 확인 (이벤트를 놓쳤을 때를 대비)
function syncWaiting(reg = registration) {
  if (!reg || !reg.waiting || !navigator.serviceWorker.controller || waiting === reg.waiting) return;
  waiting = reg.waiting;
  announce('sw-update');
}

function watch(reg) {
  const track = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        if (navigator.serviceWorker.controller) { waiting = reg.waiting || worker; announce('sw-update'); }
        else announce('offline');
      }
      if (worker.state === 'activated') announce('offline');
    });
  };
  syncWaiting(reg);
  track(reg.installing);
  reg.addEventListener('updatefound', () => track(reg.installing));
  // 앱을 연 직후 1분 동안은 몇 초마다 한 번 더 확인한다 (설치가 등록보다 먼저 끝나는 경우)
  let n = 0;
  const timer = setInterval(() => { syncWaiting(reg); if (++n >= 20 || waiting) clearInterval(timer); }, 3000);
}

export async function registerSW() {
  if (!swSupported()) return null;
  try {
    registration = await navigator.serviceWorker.register('sw.js');
    if (!registration) return null;
    watch(registration);
    // 앱을 열 때마다 새 버전이 있는지 바로 확인한다 (브라우저의 자동 확인은 늦게 올 때가 있음)
    if (navigator.serviceWorker.controller) registration.update().then(() => syncWaiting()).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) { location.reload(); return; }
      announce('offline');
    });
    return registration;
  } catch (e) {
    console.warn('서비스 워커 등록 실패', e);
    return null;
  }
}

export const updateReady = () => !!waiting;

// 새 버전 적용: 대기 중인 서비스 워커를 바로 켜고 화면을 새로 연다
export function applyUpdate() {
  if (!waiting) return false;
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => location.reload(), 4000); // controllerchange 가 오지 않는 경우 대비
  return true;
}

export async function checkForUpdate() {
  if (!registration) return false;
  try { await registration.update(); syncWaiting(); return true; } catch { return false; }
}

function ask(worker, message, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data); };
    try { worker.postMessage(message, [ch.port2]); } catch { clearTimeout(timer); resolve(null); }
  });
}

/**
 * 오프라인 준비 상태
 * @returns {Promise<{supported:boolean, ready:boolean, version?:string, cached?:number, total?:number, installing?:boolean}>}
 */
export async function offlineStatus() {
  if (!swSupported()) return { supported: false, ready: false };
  const reg = registration || (await navigator.serviceWorker.getRegistration());
  const active = reg && reg.active;
  if (!active) return { supported: true, ready: false, installing: !!(reg && (reg.installing || reg.waiting)) };
  const res = await ask(active, { type: 'STATUS' });
  if (!res) return { supported: true, ready: false };
  return {
    supported: true, version: res.version, cached: res.cached, total: res.total,
    ready: res.total > 0 && res.cached >= res.total && !!navigator.serviceWorker.controller,
  };
}

// ───────────── 설치 버튼 (안드로이드 Chrome 의 '앱 설치' 창) ─────────────
let installEvent = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    announce('install');
  });
  window.addEventListener('appinstalled', () => { installEvent = null; announce('install'); });
}
export const canPromptInstall = () => !!installEvent;
export async function promptInstall() {
  if (!installEvent) return false;
  const ev = installEvent;
  installEvent = null;
  try { ev.prompt(); const choice = await ev.userChoice; return choice && choice.outcome === 'accepted'; } catch { return false; }
}
