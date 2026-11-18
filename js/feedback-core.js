// 피드백 → GitHub 이슈 (계산만, 화면 없음 — 단위 테스트용)
// 토큰 없이 '새 이슈' 작성 화면을 내용이 채워진 채로 연다. 마지막 제출은 사람이 GitHub 에서 누른다.
// 공개 저장소라 이슈도 공개된다: 앱이 자동으로 넣는 정보에는 개인 정보(예약·경비·이름)를 넣지 않는다.

export const REPO = 'qkqh6898-woohak/TripHawaii';
export const KINDS = {
  bug: { label: 'bug', prefix: '[버그]', title: '🐞 버그' },
  idea: { label: 'enhancement', prefix: '[개선]', title: '💡 개선 아이디어' },
  question: { label: 'question', prefix: '[질문]', title: '❓ 질문' },
};
const MAX_BODY = 6000;          // 주소 길이 제한 때문에 본문은 이 정도로 자른다

let lastRoute = '';
let lastErr = '';
// 피드백 화면에 오기 직전 화면 — 주소 뒤 ?… 는 버린다 (경비 공유 코드 같은 내용이 들어 있을 수 있음)
export const safeRoute = (hash) => String(hash || '').split('?')[0].slice(0, 60);
export function setLastRoute(hash) { lastRoute = safeRoute(hash); }
export const getLastRoute = () => lastRoute;
export function noteError(msg) { lastErr = String(msg || '').replace(/[?#][^\s]*/g, '').slice(0, 200); }
export const getLastError = () => lastErr;

// 'Android · Chrome' 처럼 짧게 (전체 User-Agent 는 보내지 않는다)
export function deviceLabel(ua = '') {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '기타';
  const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /KAKAOTALK/i.test(ua) ? '카카오톡 브라우저' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : '기타';
  return `${os} · ${br}`;
}

export function issueBody({ kind = 'bug', text = '', info = null } = {}) {
  const k = KINDS[kind] || KINDS.bug;
  const lines = [`**종류:** ${k.title}`, '', String(text || '').trim() || '(내용 없음)'];
  if (info) {
    lines.push('', '---', '<sub>앱이 자동으로 넣은 정보 (개인 정보 없음)</sub>', '');
    for (const [label, v] of [['앱 버전', info.version], ['화면', info.route], ['기기', info.device], ['화면 폭', info.width && `${info.width}px`],
      ['설치(홈 화면 앱)', info.standalone == null ? '' : (info.standalone ? '예' : '아니오')], ['인터넷', info.online == null ? '' : (info.online ? '연결됨' : '끊김')],
      ['하와이 시각', info.hst], ['최근 오류', info.error]]) {
      if (v) lines.push(`- ${label}: ${v}`);
    }
  }
  const body = lines.join('\n');
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n…(길어서 잘림)` : body;
}

export function issueTitle({ kind = 'bug', title = '', text = '' } = {}) {
  const k = KINDS[kind] || KINDS.bug;
  const t = String(title || '').trim() || String(text || '').trim().split('\n')[0].slice(0, 60) || '(제목 없음)';
  return t.startsWith(k.prefix) ? t : `${k.prefix} ${t}`;
}

export function issueUrl(opts = {}) {
  const k = KINDS[opts.kind] || KINDS.bug;
  const params = new URLSearchParams({ title: issueTitle(opts), body: issueBody(opts), labels: k.label });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}
