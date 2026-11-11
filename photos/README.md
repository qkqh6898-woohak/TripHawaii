# photos

직접 찍었거나 받은 사진만 넣습니다 (웹에서 가져온 사진은 넣지 않습니다).
아래 이름으로 넣으면 해당 날짜의 일정 화면에 자동으로 보이고, 없는 사진은 그냥 건너뜁니다.

| 파일 이름 | 날짜 | 설명 |
|---|---|---|
| `royal-hawaiian-center.jpg` | 11/15 | 로열하와이안센터 |
| `wolfgang.jpg` | 11/15 | 울프강 스테이크 |
| `waikiki-sunset.jpg` | 11/15 | 와이키키 노을 산책 |
| `musubi.jpg` | 11/15 | 무스비 |
| `kualoa-valley.jpg` | 11/17 | 쿠알로아 랜치 계곡 |
| `kualoa-beach.jpg` | 11/17 | 쿠알로아 해변과 산 |
| `westin-hapuna.jpg` | 11/23 | 웨스틴 하푸나비치 리조트 |

넣는 방법 (폭 1200px 로 줄이고 위치정보를 지웁니다):

```bash
python tools/shrink_image.py 원본.jpg photos/kualoa-valley.jpg
node tools/build-precache.mjs
git add -A && git commit -m "사진 추가" && git push
```

다른 날짜에 사진을 더 넣으려면 `data/trip.json` 의 해당 날짜에 `"photos": [{ "src": "photos/이름.jpg", "alt": "설명" }]` 를 추가합니다.
이 저장소는 공개이므로 얼굴이 나온 사진은 올리기 전에 한 번 더 생각해 주세요.
