# Aloha Trip — 작업 안내 (Claude 용)

하와이 신혼여행(2026-11-15~27) PWA. 빌드 도구 없음. 사용법·구조·절차는 `README.md` 를 먼저 읽는다.

## 꼭 지킬 것
- **공개 저장소다.** 예약번호·전화번호·이메일·카카오톡 ID·이름(성 포함)·결제 금액은 `private/` 원본과 암호화된 `data/secret.enc` 에만 둔다.
  공개 파일(`data/trip.json`, 코드, 문서, 커밋 메시지)에는 쓰지 않는다. `data/trip.json` 은 예약을 `booking` id 로만 가리킨다.
- 커밋 전에 `npm run check` (개인정보 검사 → 데이터 검증 → 캐시 목록 → 단위 테스트). 훅: `git config core.hooksPath .githooks`
- 앱이 읽는 파일(코드·data·maps·photos·icons)을 바꿨으면 **반드시** `node tools/build-precache.mjs` 를 돌리고 `sw.js` 를 함께 커밋한다. 안 그러면 폰이 새 내용을 받지 않는다.
- 예약 비밀번호는 저장소·파일·명령줄 인자·커밋 메시지·메모리에 남기지 않는다. `encrypt.mjs` 에는 `--password-stdin` 으로 넘긴다.
- 사진은 사용자가 준 것만 (`tools/shrink_image.py` 로 줄여서). 웹 사진 금지. 일정 항목의 `photos` 배열에 붙이고(여러 장 가능), `build-precache` 가 만드는 `data/photos.json` 에 있는 파일만 앱에 보인다.

## 자주 하는 일
- 일정 수정: `data/trip.json` → `node tools/validate.mjs` → (장소·순서가 바뀌면) `python tools/maps/make_maps.py` → `build-precache` → 커밋.
- 예약 추가: `private/trip-secret.json` 이 없으면 `node tools/decrypt-check.mjs --export --password-stdin` 으로 복원 → 수정 → `node tools/encrypt.mjs --password-stdin`
  (같은 비밀번호면 salt 를 재사용해 폰이 비밀번호 없이 갱신됨) → `build-precache` → `data/secret.enc`, `sw.js` 커밋.
- 화면 확인: `node tools/serve.mjs` 후 `…/TripHawaii/?now=2026-11-17T09:12` (하와이 시각 고정). 전체 흐름은 `node tests/smoke.spec.mjs`.

## 설계 메모
- 시각은 모두 하와이 시간(HST)으로 저장하고 `js/time.js` 로만 계산한다 (한국 시각은 표시용).
- 화면 모듈은 `render(root, ctx)` 를 내보내고, 값은 `util.js` 의 `html` 템플릿으로만 넣는다 (자동 이스케이프). `innerHTML` 직접 사용 금지.
- 밖에서 들어오는 데이터(경비 가져오기·백업 복원)는 `sanitizeExpense` 등으로 걸러서 저장한다.
- 문서에 없는 사실(운영 시간, 좌표 등)을 넣을 때는 출처를 확인하고, 추정이면 일정 메모에 추정이라고 적는다.
