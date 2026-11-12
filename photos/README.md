# photos

직접 찍었거나 받은 사진만 넣습니다 (웹에서 가져온 사진은 넣지 않습니다).
사진은 **일정 항목마다 여러 장** 붙일 수 있고, 앱에서는 좌우로 밀어 넘겨 봅니다.
여기에 파일이 실제로 있는 사진만 보이므로, 아직 없는 사진 때문에 빈칸이 생기지는 않습니다.

## 지금 자리가 잡혀 있는 사진

아래 이름으로 넣으면 바로 보입니다.

| 파일 이름 | 날짜 · 일정 | 설명 |
|---|---|---|
| `royal-hawaiian-center.jpg` | 11/15 로열하와이안센터 쇼핑 | 로열하와이안센터 |
| `wolfgang.jpg` | 11/15 울프강 스테이크 | 울프강 스테이크 |
| `waikiki-sunset.jpg` | 11/15 와이키키 해변 산책 | 와이키키 노을 산책 |
| `musubi.jpg` | 11/15 무스비 사기 | 무스비 |
| `kualoa-valley.jpg`, `kualoa-beach.jpg` | 11/17 디럭스 UTV 투어 (2장) | 쿠알로아 계곡 · 해변과 산 |
| `westin-hapuna.jpg` | 11/23 웨스틴 하푸나비치 체크인 | 웨스틴 하푸나비치 리조트 |

## 넣는 방법

```bash
python tools/shrink_image.py 원본.jpg photos/kualoa-valley.jpg   # 폭 1200px 로 줄이고 위치정보를 지움
node tools/build-precache.mjs                                     # 사진 목록(data/photos.json)과 캐시 버전 갱신
git add -A && git commit -m "사진 추가" && git push
```

## 다른 일정에 사진을 더 붙이려면

`data/trip.json` 에서 해당 일정 항목에 `photos` 를 추가합니다 (여러 장이면 순서대로 넘겨집니다).

```json
{ "id": "1120-2", "start": "09:30", "title": "푸날루우 블랙샌드비치",
  "photos": [
    { "src": "photos/punaluu-1.jpg", "alt": "검은 모래 해변" },
    { "src": "photos/punaluu-2.jpg", "alt": "바다거북" }
  ] }
```

- 그날 화면 위쪽의 사진 묶음에는 그날 모든 항목의 사진이 순서대로 모여 보입니다.
- 이 저장소는 공개이므로 얼굴이 나온 사진은 올리기 전에 한 번 더 생각해 주세요.
