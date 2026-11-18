import test from 'node:test';
import assert from 'node:assert/strict';
import { issueUrl, issueTitle, issueBody, safeRoute, deviceLabel, noteError, getLastError } from '../js/feedback-core.js';

test('이슈 주소: 저장소 · 제목 머리말 · 라벨', () => {
  const u = new URL(issueUrl({ kind: 'bug', title: '받기 버튼이 안 보여요', text: '경비 화면' }));
  assert.equal(u.origin + u.pathname, 'https://github.com/qkqh6898-woohak/TripHawaii/issues/new');
  assert.equal(u.searchParams.get('title'), '[버그] 받기 버튼이 안 보여요');
  assert.equal(u.searchParams.get('labels'), 'bug');
  assert.equal(new URL(issueUrl({ kind: 'idea', text: '지도에 x' })).searchParams.get('labels'), 'enhancement');
  assert.equal(issueTitle({ kind: 'question', text: '첫 줄\n둘째 줄' }), '[질문] 첫 줄');
});

test('개인 정보 막기: 주소 뒤 ?… 는 버리고, 본문은 잘라 보낸다', () => {
  assert.equal(safeRoute('#/import?d=j1.SECRETDATA'), '#/import');
  noteError('Failed at https://x.test/a?token=abc');
  assert.ok(!getLastError().includes('token'));
  const body = issueBody({ text: 'x'.repeat(9000), info: { route: '#/money', version: 'v1' } });
  assert.ok(body.length < 6100 && body.endsWith('(길어서 잘림)'));
  const withInfo = issueBody({ text: '내용', info: { route: '#/money', device: 'Android · Chrome', online: true } });
  assert.match(withInfo, /- 화면: #\/money/);
  assert.match(withInfo, /- 인터넷: 연결됨/);
  assert.doesNotMatch(issueBody({ text: '내용', info: null }), /자동으로 넣은 정보/);
});

test('기기 이름은 짧게', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile Safari/537'), 'Android · Chrome');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17 Mobile Safari/604'), 'iOS · Safari');
});
