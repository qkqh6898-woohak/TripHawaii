// 기기별 설정값 (IndexedDB settings 저장소) — 화면은 settings.js 가 그린다
import * as db from './db.js';
import { uuid, setHaptic } from './util.js';

export const OWNERS = { woohak: '우학', seonghee: '성희' };
export const PAYERS = { woohak: '우학', seonghee: '성희', joint: '공동' };

// 환율 기본값: 온라인이면 앱이 한 번 자동으로 최신 값으로 바꾼다 (설정에서 직접 고칠 수도 있음)
export const DEFAULT_RATE = 1400;

const DEFAULTS = {
  owner: null,            // 이 폰 주인: 'woohak' | 'seonghee'
  rate: DEFAULT_RATE,     // 1 USD = ? KRW
  rateDate: null,         // 환율 기준일
  rateSource: 'default',  // default | auto | manual
  rateFetched: null,      // 마지막으로 자동 환율을 받은 날 (YYYY-MM-DD)
  fee: 0,                 // 해외 카드 결제 수수료 (%)
  theme: 'auto',          // auto | light | dark
  font: 'm',              // s | m | l
  ttsRate: 1,
  lock: false,            // 예약 지갑을 열 때마다 비밀번호 입력
  lastSharedAt: 0,        // 마지막으로 경비를 보낸 시각
  lastBackupAt: 0,        // 마지막으로 백업 파일을 저장한 시각
  deviceId: null,
  installHintDismissed: false,
  favPhrases: [],
  haptic: true,           // 체크·즐겨찾기 때 짧은 진동 (지원하는 폰에서만)
  ideaFav: [],            // 추천 코스 중 관심 표시한 것
};

let cache = null;

export async function loadPrefs() {
  const rows = await db.getAll('settings');
  cache = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) cache[r.key] = r.value;
  if (!cache.deviceId) {
    cache.deviceId = uuid().slice(0, 8);
    await db.setSetting('deviceId', cache.deviceId);
  }
  applyPrefs();
  return cache;
}

export const prefs = () => cache || DEFAULTS;

export async function setPref(key, value) {
  if (!cache) cache = { ...DEFAULTS };
  cache[key] = value;
  await db.setSetting(key, value);
  applyPrefs();
}

export function applyPrefs() {
  const p = prefs();
  setHaptic(p.haptic !== false);
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (p.theme === 'auto') delete el.dataset.theme; else el.dataset.theme = p.theme;
  el.dataset.font = p.font || 'm';
}

export function ownerName(id) {
  return OWNERS[id] || PAYERS[id] || '';
}

// 회화 문장의 {spouse} 자리에 들어갈 말
export function spouseWord() {
  const o = prefs().owner;
  if (o === 'woohak') return 'wife';
  if (o === 'seonghee') return 'husband';
  return 'partner';
}
