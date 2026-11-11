#!/usr/bin/env python3
"""해안선 데이터 추출 (1회성 도구) — 결과는 tools/maps/coast/*.json 으로 저장소에 들어 있으므로
평소에는 실행할 필요가 없다. 해안선을 다시 뽑아야 할 때만 사용한다.

원본: GSHHG (Global Self-consistent, Hierarchical, High-resolution Geography; Wessel & Smith, LGPL)
      — PyPI 의 basemap-data / basemap-data-hires 패키지에 들어 있는 gshhs_*.dat 파일을 읽는다.

사용법:
    pip download --no-deps basemap-data basemap-data-hires -d dl/
    (두 .whl 을 압축 해제해 mpl_toolkits/basemap_data/ 를 만든 뒤)
    python tools/maps/extract_coast.py <.../mpl_toolkits/basemap_data>
"""
import json
import sys
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent / "coast"


def load(base: Path, res: str):
    """(type, area_km2, id, Nx2 array[lon, lat]) 목록. type 1 = 육지."""
    polys = []
    with open(base / f"gshhs_{res}.dat", "rb") as bf, open(base / f"gshhsmeta_{res}.dat") as mf:
        for line in mf:
            p = line.split()
            typ, area, npts = int(p[0]), float(p[1]), int(p[2])
            south, north, off, cnt = float(p[3]), float(p[4]), int(p[5]), int(p[6])
            if typ != 1:
                continue
            bf.seek(off)
            a = np.frombuffer(bf.read(cnt), dtype="<f4").reshape(npts, 2).astype(float)
            polys.append((typ, area, p[7], a, south, north))
    return polys


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    base = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)

    # 1) 하와이 제도 — 최고 해상도(f), 범위 안에 완전히 들어오는 섬만
    S, N, W, E = 18.7, 22.4, -160.7, -154.6
    hawaii = []
    for typ, area, pid, a, south, north in load(base, "f"):
        lon, lat = a[:, 0], a[:, 1]
        if lon.min() >= W and lon.max() <= E and lat.min() >= S and lat.max() <= N:
            hawaii.append({"area": round(area, 2), "pts": np.round(a, 5).tolist()})
    hawaii.sort(key=lambda p: -p["area"])
    (OUT / "hawaii.json").write_text(json.dumps({
        "source": "GSHHG full resolution (Wessel & Smith), LGPL — via basemap-data-hires",
        "bbox": [W, S, E, N], "polygons": hawaii}, separators=(",", ":")))
    print("hawaii.json:", len(hawaii), "polygons,", sum(len(p["pts"]) for p in hawaii), "points")

    # 2) 태평양(한국 ↔ 하와이) — 저해상도(l), 경도는 0~360 으로 펼친다 (날짜변경선을 가운데 두기 위해)
    pacific = []
    for typ, area, pid, a, south, north in load(base, "l"):
        if 0 <= area < 400:
            continue
        if north < -5 or south > 66:
            continue
        lon = a[:, 0].copy()
        if lon.max() < 0:          # 서반구에만 있는 땅(아메리카·하와이·추코트카 일부) → +360
            lon += 360
        if lon.max() < 95 or lon.min() > 262:
            continue
        pts = np.column_stack([lon, a[:, 1]])
        pacific.append({"area": round(area, 1), "pts": np.round(pts, 3).tolist()})
    pacific.sort(key=lambda p: -p["area"])
    (OUT / "pacific.json").write_text(json.dumps({
        "source": "GSHHG low resolution (Wessel & Smith), LGPL — via basemap-data",
        "lon": "0..360", "polygons": pacific}, separators=(",", ":")))
    print("pacific.json:", len(pacific), "polygons,", sum(len(p["pts"]) for p in pacific), "points")


if __name__ == "__main__":
    main()
