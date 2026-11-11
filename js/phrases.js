// 상황별 영어 회화 카드 (8상황 × 5문장) + 발음 듣기
import { html, setHTML, toast } from './util.js';
import { prefs, setPref, spouseWord } from './prefs.js';
import { speak, stopSpeaking, ttsSupported } from './tts.js';
import * as wallet from './wallet.js';

let doc = null;

export async function loadPhrases() {
  if (doc) return doc;
  const res = await fetch('data/phrases.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('회화 문장을 불러오지 못했어요');
  doc = await res.json();
  return doc;
}

// {name} → 예약자 영문 이름(예약 지갑을 열었을 때만), {spouse} → wife / husband
export function fill(text, lang = 'en') {
  const name = wallet.profile().reservation_name;
  return String(text || '')
    .replace(/\{name\}/g, name || (lang === 'en' ? 'my name' : '제'))
    .replace(/\{spouse\}/g, spouseWord());
}

function phraseHtml(p, favs) {
  const fav = favs.includes(p.id);
  return html`
    <article class="card phrase" data-phrase="${p.id}">
      ${p.they ? html`
        <div class="phrase-they">
          <span class="phrase-who">상대가 하는 말</span>
          <p class="phrase-en" lang="en">${fill(p.they)}</p>
          <p class="phrase-ko">${fill(p.they_ko, 'ko')}</p>
          <button type="button" class="btn btn-small" data-say="they">🔊 듣기</button>
        </div>
        <span class="phrase-who">내가 하는 말</span>` : ''}
      <p class="phrase-en phrase-mine" lang="en">${fill(p.en)}</p>
      <p class="phrase-ko">${fill(p.ko, 'ko')}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-say="en">🔊 듣기</button>
        <button type="button" class="btn" data-say="slow">🐢 천천히</button>
        <button type="button" class="btn btn-fav ${fav ? 'is-on' : ''}" data-fav aria-pressed="${fav ? 'true' : 'false'}" aria-label="즐겨찾기">${fav ? '★' : '☆'}</button>
      </div>
    </article>`;
}

export async function render(root, ctx) {
  const d = await loadPhrases();
  await wallet.initWallet();
  const favs = prefs().favPhrases || [];
  const id = ctx.params[0];
  const all = d.situations.flatMap((s) => s.phrases.map((p) => ({ ...p, situation: s })));
  const can = ttsSupported();

  if (!id) {
    setHTML(root, html`
      <h1 class="page-title"><a class="back" href="#/more" aria-label="더보기로">‹</a> 🗣 여행 영어</h1>
      ${can ? '' : html`<div class="banner banner-warn">이 브라우저는 발음 듣기를 지원하지 않아요. 문장은 그대로 볼 수 있어요.</div>`}
      <div class="grid-2">
        ${d.situations.map((s) => html`
          <a class="card tile" href="#/phrases/${s.id}">
            <span class="tile-icon" aria-hidden="true">${s.icon}</span>
            <span class="tile-title">${s.title}</span>
            <span class="muted small">${s.phrases.length}문장</span>
          </a>`)}
      </div>
      <a class="card tile tile-wide" href="#/phrases/fav">
        <span class="tile-icon" aria-hidden="true">★</span>
        <span class="tile-title">즐겨찾기</span>
        <span class="muted small">${favs.length}문장</span>
      </a>
      <p class="muted small">발음은 폰에 들어 있는 미국 영어 음성으로 읽어요 (인터넷 없이도 됩니다).
      예약 지갑을 열면 문장 속 이름이 예약자 이름으로 바뀌어요.</p>`);
    return;
  }

  const sit = d.situations.find((s) => s.id === id);
  const list = id === 'fav' ? all.filter((p) => favs.includes(p.id)) : (sit ? sit.phrases : []);
  const title = id === 'fav' ? '★ 즐겨찾기' : (sit ? `${sit.icon} ${sit.title}` : '여행 영어');

  setHTML(root, html`
    <h1 class="page-title"><a class="back" href="#/phrases" aria-label="상황 목록으로">‹</a> ${title}</h1>
    <div class="chips chips-scroll">
      ${d.situations.map((s) => html`<a class="chip ${s.id === id ? 'is-on' : ''}" href="#/phrases/${s.id}">${s.icon} ${s.title}</a>`)}
      <a class="chip ${id === 'fav' ? 'is-on' : ''}" href="#/phrases/fav">★ 즐겨찾기</a>
    </div>
    ${sit && sit.tip ? html`<p class="banner">💡 ${sit.tip}</p>` : ''}
    ${!list.length ? html`<p class="muted empty">${id === 'fav' ? '아직 즐겨찾기한 문장이 없어요. 문장 아래 ☆ 를 눌러 모아 보세요.' : '문장이 없어요.'}</p>` : ''}
    ${list.map((p) => phraseHtml(p, favs))}`);

  if (!can) root.querySelectorAll('[data-say]').forEach((b) => { b.disabled = true; });

  root.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-phrase]');
    if (!card) return;
    const p = all.find((x) => x.id === card.dataset.phrase);
    if (!p) return;
    const say = e.target.closest('[data-say]');
    if (say) {
      const kind = say.dataset.say;
      const text = kind === 'they' ? fill(p.they) : fill(p.en);
      root.querySelectorAll('.is-speaking').forEach((b) => b.classList.remove('is-speaking'));
      say.classList.add('is-speaking');
      const ok = speak(text, { rate: kind === 'slow' ? 0.65 : (prefs().ttsRate || 1), onend: () => say.classList.remove('is-speaking') });
      if (!ok) { say.classList.remove('is-speaking'); toast('이 브라우저에서는 발음을 들을 수 없어요'); }
      return;
    }
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      const cur = prefs().favPhrases || [];
      const on = !cur.includes(p.id);
      await setPref('favPhrases', on ? [...cur, p.id] : cur.filter((x) => x !== p.id));
      favBtn.classList.toggle('is-on', on);
      favBtn.textContent = on ? '★' : '☆';
      favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (id === 'fav' && !on) ctx.rerender();
    }
  });
}

export function leave() {
  stopSpeaking();
}
