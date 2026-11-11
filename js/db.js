// 기기 저장소 (IndexedDB 'alohatrip' v1) — 경비·체크·메모·날씨·설정·복호화된 예약 정보
// IndexedDB 를 쓸 수 없는 환경(일부 비공개 탭)에서는 메모리에만 저장하고 ephemeral 을 true 로 둔다.

const DB_NAME = 'alohatrip';
const DB_VERSION = 1;
export const STORES = {
  secret: 'id',       // { id:'main', data, encHash, key?, salt, iter, savedAt }
  checks: 'id',       // { id, done, by, updatedAt }
  notes: 'id',        // { id(일정 항목 id), text, updatedAt }
  expenses: 'id',     // { id, date, amount, currency, krw, rate, cat, payer, method, memo, device, createdAt, updatedAt, deleted }
  weather: 'zone',    // { zone, data, fetchedAt }
  settings: 'key',    // { key, value }
};

let dbPromise = null;
let memory = null;
export const state = { ephemeral: false };

function useMemory() {
  state.ephemeral = true;
  if (!memory) {
    memory = {};
    for (const name of Object.keys(STORES)) memory[name] = new Map();
  }
  return null;
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(useMemory()); return; }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(useMemory());
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => resolve(useMemory());
    req.onblocked = () => resolve(useMemory());
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => {
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const req = fn(os);
      if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('저장소 작업이 취소됐어요'));
    });
  });
}

const clone = (v) => (v === undefined ? v : (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))));

export function get(store, key) {
  return run(store, 'readonly', (os) => (os ? os.get(key) : clone(memory[store].get(key))));
}

export function getAll(store) {
  return run(store, 'readonly', (os) => (os ? os.getAll() : Array.from(memory[store].values()).map(clone)));
}

export function put(store, value) {
  return run(store, 'readwrite', (os) => {
    if (os) return os.put(value);
    memory[store].set(value[STORES[store]], clone(value));
    return undefined;
  }).then(() => value);
}

export function bulkPut(store, values) {
  if (!values.length) return Promise.resolve();
  return run(store, 'readwrite', (os) => {
    for (const v of values) {
      if (os) os.put(v); else memory[store].set(v[STORES[store]], clone(v));
    }
    return undefined;
  });
}

export function del(store, key) {
  return run(store, 'readwrite', (os) => {
    if (os) return os.delete(key);
    memory[store].delete(key);
    return undefined;
  });
}

export function clear(store) {
  return run(store, 'readwrite', (os) => {
    if (os) return os.clear();
    memory[store].clear();
    return undefined;
  });
}

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row && row.value !== undefined ? row.value : fallback;
}

export function setSetting(key, value) {
  return put('settings', { key, value });
}

// 브라우저가 저장 공간을 임의로 비우지 않도록 요청 (홈 화면에 설치하면 대체로 허용된다)
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* 지원하지 않는 브라우저 */ }
  return false;
}

export async function isPersisted() {
  try {
    return !!(navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted()));
  } catch {
    return false;
  }
}
