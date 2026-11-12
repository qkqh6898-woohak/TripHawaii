# 🌺 Aloha Trip — 하와이 신혼여행 앱

2026-11-15 ~ 11-27 하와이(오아후 + 빅아일랜드) 신혼여행을 폰 하나로 따라가는 앱입니다.
**지금 할 일과 다음 일정**, **날짜별 지도**, **예약번호·연락처**, **준비물**, **경비**, **여행 영어**를 **인터넷 없이도** 볼 수 있습니다.

- 앱 주소: **https://qkqh6898-woohak.github.io/TripHawaii/**
- 빌드 도구 없음 (순수 HTML/CSS/JS) · 홈 화면에 설치하는 PWA · 무료 서비스만 사용

---

## 1. 폰에 설치하기

### 안드로이드 (Chrome)
1. Chrome 으로 앱 주소를 엽니다.
2. 오른쪽 위 **⋮ → 홈 화면에 추가** (또는 **앱 설치**).
3. 홈 화면의 **하와이** 아이콘으로 엽니다.

### 아이폰 (Safari)
1. **Safari** 로 앱 주소를 엽니다. (카톡 안에서 열렸다면 오른쪽 아래 메뉴 → *Safari로 열기*)
2. 아래 가운데 **공유 버튼 → 홈 화면에 추가**.
3. 홈 화면의 **하와이** 아이콘으로 엽니다.

> 아이폰은 홈 화면 앱과 Safari 의 저장 공간이 서로 다릅니다. 설치한 뒤에는 **홈 화면 앱만** 써 주세요.

### 설치한 뒤 한 번만
1. **예약** 탭 → 둘이 정한 **예약 비밀번호** 입력 → 예약번호·연락처·바우처가 열립니다. (다음부터는 묻지 않습니다)
2. 첫 화면에서 **이 폰 주인**(우학/성희)을 고릅니다.
3. **더보기 → 설정 → 오프라인 준비**에 `✓ 오프라인 준비 완료`가 보이는지 확인합니다.

### 출발 전 점검표 (두 폰 모두)
- [ ] 홈 화면에 설치했고, 예약 비밀번호로 예약 지갑이 열린다
- [ ] 설정에 `✓ 오프라인 준비 완료`가 보인다
- [ ] **비행기 모드**에서 오늘 · 일정 · 지도 · 예약이 모두 열린다
- [ ] 예약 카드의 예약번호를 누르면 복사된다
- [ ] 경비 1건을 넣고 상대 폰으로 보내 본다 (경비 → 내 경비 보내기 / 받기)

---

## 2. 화면 안내

| 탭 | 내용 |
|---|---|
| 🌺 **오늘** | 하와이·한국 시각, 진행 중인 일정과 **다음 일정까지 남은 시간**, 길찾기, 오늘 준비물, 오늘 쓴 돈. 출발 전에는 D-day 와 준비 상태 |
| 📅 **일정** | 11/15~27 날짜별 시간 일정 · 지도 · 사진. 항목을 누르면 주소 복사 · 길찾기 · 연결된 예약 · 내 메모 |
| 🗺 **지도** | 한국↔하와이, 하와이 전체, 섬별, 날짜별 약도(오프라인). 누르면 크게 보고 두 손가락으로 확대 |
| 🎫 **예약** | 비밀번호로 여는 예약 지갑 — 예약번호(누르면 복사), 전화, 카카오톡 ID, 바우처 |
| ☰ **더보기** | 체크리스트 · 경비(정산, 팁 계산기) · 여행 영어(발음 듣기) · 하와이 영상(일정별 한국어 유튜브) · 설정(환율, 글자 크기, 백업) |

- ⚠ 표시와 빨간 테두리는 **늦으면 안 되는 일정**입니다. 1시간 전부터 더 강조됩니다.
- 버튼·목록 등 누르는 곳은 모두 48px 이상, 글자는 16px 이상, 색 대비는 4.5:1 이상으로 맞췄습니다.
- 일정 시각은 모두 **하와이 시간**입니다. (한국이 19시간 빠름)
- **길찾기**는 Google 지도로 열리며 인터넷이 필요합니다. 지도 탭의 약도는 인터넷 없이 보입니다.
- 날씨(Open-Meteo)와 환율(Frankfurter)은 인터넷이 될 때 자동으로 받아 두고, 끊기면 마지막 값을 보여줍니다.

### 두 폰의 경비 맞추기
경비는 각자 폰에 저장됩니다. **경비 → 내 경비 보내기**에서 QR 을 띄우고 상대 폰의 **기본 카메라**로 찍으면 합쳐집니다.
기록이 많으면 *공유하기 / 코드 복사*로 카톡에 보내고, 받는 쪽은 **경비 → 받기 → 붙여넣기**를 누릅니다. 여러 번 받아도 중복되지 않습니다.
(아이폰 홈 화면 앱에서는 QR 대신 **붙여넣기**를 쓰세요.)

---

## 3. 개인정보는 이렇게 지킵니다

이 저장소는 공개입니다. 그래서 올라가는 내용을 둘로 나눴습니다.

| 공개 (`data/trip.json` 등) | 암호화 (`data/secret.enc`) |
|---|---|
| 날짜·시간·장소 이름·주소·좌표, 지도, 회화 문장, 체크리스트 | 예약번호, 예약처 연락처(전화·카카오톡·이메일), 결제 금액, 바우처 이미지, 예약자 이름 |

- `secret.enc` 는 **AES-GCM 256** 으로 암호화하고, 키는 비밀번호에서 **PBKDF2-SHA256 60만 회**로 만듭니다. 비밀번호는 저장소 어디에도 없습니다.
- 원본(`private/`)은 `.gitignore` 로 막혀 있고, 커밋할 때마다 `tools/scan-secrets.mjs` 가 전화번호·이메일·예약번호가 평문으로 들어가지 않았는지 검사합니다.
- 폰에서 한 번 열면 복호화된 내용이 **그 폰 안에만** 저장됩니다. *설정 → 열 때마다 비밀번호 묻기*를 켜면 저장하지 않습니다.
- 암호화 파일은 누구나 내려받을 수 있으므로 **비밀번호는 12자 이상 긴 문장**을 권합니다 (다른 곳에서 쓰는 비밀번호 금지).
- 여행이 끝나면 저장소를 비공개로 돌리거나 `data/secret.enc` 를 지우는 것을 권합니다.

---

## 4. 일정·예약 고치기

가장 쉬운 방법은 **Claude 에게 "하와이 앱에 ○○ 예약번호 추가해줘" 처럼 말하는 것**입니다. 직접 할 때는 아래 순서입니다.

### 일정이 바뀌었을 때
```bash
# 1) data/trip.json 을 고친다
node tools/validate.mjs                 # 형식 검사 (오류는 한국어로 알려줌)
python tools/maps/make_maps.py          # 지도 다시 그리기 (장소·순서가 바뀐 경우)
node tools/build-precache.mjs           # 오프라인 캐시 버전 올리기
git add -A && git commit -m "일정 수정" && git push
```
폰에서 앱을 다시 열면 위쪽에 **새 버전 적용** 버튼이 뜹니다.

### 예약번호·바우처를 추가할 때
```bash
node tools/decrypt-check.mjs --export   # (원본이 없을 때만) secret.enc → private/trip-secret.json 복원
# 2) private/trip-secret.json 을 고치고, 바우처는 private/vouchers/ 에 넣는다
node tools/encrypt.mjs                  # 비밀번호 입력 → data/secret.enc
node tools/build-precache.mjs
git add data/secret.enc sw.js && git commit -m "예약 정보 갱신" && git push
```
- **같은 비밀번호**로 다시 암호화하면 이미 열어 둔 폰은 비밀번호를 다시 묻지 않고 새 내용으로 바뀝니다.
- 비밀번호는 명령줄에 적지 않습니다 (터미널에서 숨김 입력, 또는 `--password-stdin`).
- 바우처 이미지는 `python tools/shrink_image.py 원본.jpg private/vouchers/이름.jpg` 로 줄여서 넣습니다.
- 형식은 `tools/private-example.json` 을 참고하세요.

### 사진을 넣을 때
`photos/README.md` 에 적힌 파일 이름으로 `photos/` 에 넣으면 해당 날짜에 자동으로 보입니다.
```bash
python tools/shrink_image.py 원본.jpg photos/kualoa-valley.jpg
node tools/build-precache.mjs && git add -A && git commit -m "사진 추가" && git push
```

---

## 5. 개발

```bash
node tools/serve.mjs                    # http://localhost:8765/TripHawaii/ 미리보기
                                        #   …/TripHawaii/?now=2026-11-17T09:12 → 그 시각(하와이)의 화면
npm test                                # 단위 테스트 (시간·암호화·경비·데이터 검증)
node tests/smoke.spec.mjs               # 브라우저 스모크 테스트 (Playwright 가 있을 때)
npm run check                           # 개인정보 검사 + 데이터 검증 + 캐시 목록 + 단위 테스트
git config core.hooksPath .githooks     # 커밋 전 자동 검사 켜기 (저장소를 새로 받았을 때 한 번)
```

```
index.html · manifest.webmanifest · sw.js(오프라인) · css/app.css
js/      main(주소→화면) today days maps wallet checklist expenses phrases settings more
         time(하와이·한국 시각) trip db prefs crypto weather tts sw-client ui viewer util
data/    trip.json(일정·장소) phrases.json checklists.json videos.json(유튜브) secret.enc(암호화된 예약)
maps/    make_maps.py 가 trip.json 으로 그린 약도 PNG
photos/  대표 사진 (직접 찍거나 받은 사진만)
tools/   validate · encrypt · decrypt-check · scan-secrets · build-precache · serve · maps/
tests/   *.test.mjs(단위) · smoke.spec.mjs(브라우저)
private/ ⚠️ 커밋 금지 — 예약 원본 (trip-secret.json, vouchers/)
```

지도 다시 그리기에는 Python 과 `pip install matplotlib numpy Pillow koreanize-matplotlib` 가 필요합니다
(한글 글꼴은 `koreanize-matplotlib` 에 들어 있는 나눔고딕을 씁니다).

---

## 6. 문제 해결

| 증상 | 해결 |
|---|---|
| 예약 탭에 "아직 등록되지 않았어요" | 암호화 파일이 아직 올라가지 않았습니다. 올린 뒤 앱을 다시 열어 **새 버전 적용** |
| 비밀번호가 맞는데 안 열림 | 한/영·대소문자 확인. 5번 틀리면 30초 기다립니다 |
| "오프라인 준비 중"에서 안 넘어감 | 인터넷에 연결한 채 앱을 닫았다 다시 열고 *설정 → 다시 확인*. 비공개(시크릿) 탭에서는 저장되지 않습니다 |
| 새 일정이 안 보임 | 앱을 다시 열어 위쪽 **새 버전 적용**을 누르거나 *설정 → 업데이트 확인* |
| 아이폰에서 QR 로 받은 경비가 앱에 안 보임 | Safari 로 열린 것입니다. 코드를 복사해 홈 화면 앱의 *경비 → 받기 → 붙여넣기* |
| 기록이 사라졌다 | 홈 화면에 설치하지 않으면 브라우저가 지울 수 있습니다. *설정 → 백업 파일 저장*을 가끔 해 두세요 |
| 발음이 안 들림 | 무음 모드·미디어 음량을 확인하세요. 일부 브라우저는 영어 음성이 없을 수 있습니다 |
| 길찾기가 엉뚱한 곳 | 장소 화면의 *지도에서 위치 보기*(좌표 기준)를 써 보고, 주소 복사로 직접 검색하세요 |

---

## 7. 출처 · 라이선스

- 앱 코드: MIT (`LICENSE`)
- QR 코드: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) — `vendor/`
- 날씨: [Open-Meteo](https://open-meteo.com/) · 환율: [Frankfurter](https://frankfurter.dev/)
- 지도 해안선: GSHHG (Wessel & Smith, LGPL) — `tools/maps/coast/`
- 음식 반입 안내: [미국 세관(CBP)](https://www.cbp.gov/travel/international-visitors/agricultural-items) · [Akamai Arrival](https://akamaiarrival.hawaii.gov/)
- 지도는 위치 관계를 보여주는 약도이며, 운영 시간·규정은 바뀔 수 있으니 출발 전에 공식 사이트로 확인하세요.
