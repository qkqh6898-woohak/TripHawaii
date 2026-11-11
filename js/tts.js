// 영어 발음 듣기 — 브라우저 내장 음성 합성(Web Speech API). 인터넷 없이도 기기 음성으로 읽는다.

let voices = [];

export function ttsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

function loadVoices() {
  try { voices = window.speechSynthesis.getVoices() || []; } catch { voices = []; }
}

export function initTTS() {
  if (!ttsSupported()) return;
  loadVoices();
  if (typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  } else {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

// 미국 영어 음성 가운데 듣기 좋은 것을 고른다
function pickVoice() {
  if (!voices.length) loadVoices();
  const us = voices.filter((v) => /^en[-_]US/i.test(v.lang));
  for (const name of ['Samantha', 'Google US English', 'Ava', 'Allison', 'Microsoft Aria', 'Microsoft Jenny']) {
    const v = us.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return us.find((v) => v.localService) || us[0] || voices.find((v) => /^en/i.test(v.lang)) || null;
}

/**
 * @param {string} text  읽을 영어 문장
 * @param {{rate?: number, onend?: Function}} opts  rate 1 = 보통, 0.7 = 천천히
 */
export function speak(text, opts = {}) {
  if (!ttsSupported() || !text) return false;
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = opts.rate || 1;
    u.pitch = 1;
    if (opts.onend) { u.onend = opts.onend; u.onerror = opts.onend; }
    synth.speak(u);
    return true;
  } catch {
    if (opts.onend) opts.onend();
    return false;
  }
}

export function stopSpeaking() {
  if (ttsSupported()) { try { window.speechSynthesis.cancel(); } catch { /* 무시 */ } }
}
