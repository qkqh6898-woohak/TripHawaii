#!/usr/bin/env python3
"""data/trip.json → maps/*.png  (일정이 바뀌면 이 스크립트를 다시 돌려 지도를 새로 그린다)

    pip install matplotlib numpy Pillow          # + 한글 글꼴 (아래 참고)
    python tools/maps/make_maps.py               # 전부 다시 그림
    python tools/maps/make_maps.py day-1117      # 이름이 일치하는 지도만

만드는 파일
    maps/korea-hawaii.png      한국 ↔ 하와이 이동
    maps/overview-hawaii.png   하와이 전체 (섬·숙소·섬간 항공)
    maps/oahu.png, maps/big-island.png   섬별 장소
    maps/day-MMDD.png          날짜별 동선 (섬을 옮기는 날은 위·아래 두 칸)
    maps/day-MMDD-wide.png     같은 날의 섬 전체 지도 — 앱에서 날짜 지도를 두 손가락으로 오므리면 이 지도로 넘어간다

한글 글꼴: 환경변수 ALOHA_FONT(ttf 경로) → tools/maps/fonts/*.ttf → koreanize-matplotlib 패키지의 나눔고딕
          → 시스템 글꼴(나눔고딕 / Noto Sans KR / 맑은 고딕 / 애플고딕) 순서로 찾는다.
해안선: tools/maps/coast/*.json (GSHHG, LGPL — extract_coast.py 참고)
지도는 위치 관계를 보여주는 약도다. 실제 길 안내는 앱의 '길찾기' 버튼(Google 지도)을 쓴다.
"""
import importlib.util
import json
import math
import os
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402
from matplotlib.patches import FancyArrowPatch, Rectangle  # noqa: E402
from PIL import Image  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "maps"

# 폰 화면(가로 약 360px)에 맞춘 캔버스: 3.6인치 × 300dpi = 1080px → 글자 9pt ≈ 화면 12px
FIG_W = 3.6
DPI = 300
PX_PER_PT = DPI / 72.0

CAT_COLOR = {
    "hotel": "#e5484d", "move": "#3b82f6", "sight": "#2e9e5b", "shop": "#8b5cf6",
    "food": "#f08c2e", "tour": "#0e9aa7", "rest": "#8d7b68",
}
CAT_KO = {"hotel": "숙소", "move": "이동", "sight": "관광", "shop": "쇼핑", "food": "음식", "tour": "투어", "rest": "휴식"}
OCEAN = "#d5ecf8"
LAND = "#f6f1e1"
LAND_HI = "#fbe3c8"
SHORE = "#b8ad8c"
INK = "#1f2937"
MUTED = "#6b7280"
ROUTE = "#374151"
ACCENT = "#e8553d"
WEEK = "월화수목금토일"

# 지도를 읽기 쉽게 해 주는 배경 지명 (이름, 위도, 경도, 종류)
CONTEXT = {
    "oahu": [
        ("호놀룰루", 21.3069, -157.8583, "town"), ("카일루아", 21.4022, -157.7394, "town"),
        ("카네오헤", 21.4181, -157.8036, "town"), ("할레이바 (노스쇼어)", 21.5928, -158.1034, "town"),
        ("카폴레이", 21.3358, -158.0861, "town"), ("진주만", 21.3649, -157.9700, "town"),
        ("하와이 카이", 21.2906, -157.7119, "town"), ("라이에", 21.6455, -157.9225, "town"),
        ("와이키키", 21.2850, -157.8380, "town"),
    ],
    "bigisland": [
        ("카일루아-코나", 19.6400, -155.9969, "town"), ("힐로", 19.7074, -155.0885, "town"),
        ("와이메아", 20.0231, -155.6718, "town"), ("나알레후", 19.0611, -155.5856, "town"),
        ("캡틴 쿡", 19.4983, -155.9217, "town"), ("하위", 20.2414, -155.8339, "town"),
        ("파호아", 19.4975, -154.9508, "town"), ("와이콜로아", 19.9375, -155.7906, "town"),
        ("마우나케아 4,207m", 19.8207, -155.4681, "peak"), ("마우나로아 4,169m", 19.4721, -155.5922, "peak"),
        ("킬라우에아", 19.4069, -155.2834, "peak"), ("후알랄라이", 19.6885, -155.8643, "peak"),
    ],
}
# (이름, 위도, 경도, 가로 정렬, 세로 정렬) — 글자가 섬·항로와 겹치지 않게 섬마다 자리를 정한다
ISLAND_LABELS = [
    ("카우아이", 21.83, -159.52, "center", "top"), ("니하우", 21.72, -160.16, "center", "top"),
    ("몰로카이", 21.27, -156.95, "center", "bottom"), ("라나이", 20.66, -157.02, "right", "top"),
    ("마우이", 20.52, -156.20, "center", "top"),
]
ISLAND_KO = {"oahu": "오아후", "bigisland": "빅아일랜드"}
AIRPORT_KO = {"ICN": "인천", "HNL": "호놀룰루", "KOA": "코나"}


# ───────────────────────────── 준비 ─────────────────────────────
def setup_font():
    cands = []
    if os.environ.get("ALOHA_FONT"):
        cands.append(Path(os.environ["ALOHA_FONT"]))
    cands += sorted((HERE / "fonts").glob("*.ttf"))
    try:
        spec = importlib.util.find_spec("koreanize_matplotlib")
        if spec and spec.submodule_search_locations:
            cands += sorted((Path(list(spec.submodule_search_locations)[0]) / "fonts").glob("NanumGothic*.ttf"))
    except Exception:
        pass
    for p in cands:
        if p.exists():
            font_manager.fontManager.addfont(str(p))
    names = {f.name for f in font_manager.fontManager.ttflist}
    for name in ["NanumGothic", "Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "AppleGothic", "Apple SD Gothic Neo"]:
        if name in names:
            plt.rcParams["font.family"] = name
            plt.rcParams["axes.unicode_minus"] = False
            return name
    sys.exit("한글 글꼴을 찾지 못했습니다. 나눔고딕을 설치하거나 ALOHA_FONT=글꼴.ttf 로 지정하세요 "
             "(pip install koreanize-matplotlib 로도 글꼴이 들어옵니다).")


def load_coast(name):
    doc = json.loads((HERE / "coast" / f"{name}.json").read_text())
    return [np.asarray(p["pts"], dtype=float) for p in doc["polygons"]]


def km_per_deg(lat):
    return 111.32 * math.cos(math.radians(lat)), 110.57


def fit_extent(lons, lats, min_km=1.2, pad=0.2, ratio=None, ratio_bounds=(0.62, 1.15)):
    """점들을 담는 범위를 구한다. 반환: (lon0, lon1, lat0, lat1), 세로/가로 비율"""
    lat_c = (max(lats) + min(lats)) / 2
    lon_c = (max(lons) + min(lons)) / 2
    kx, ky = km_per_deg(lat_c)
    w = max((max(lons) - min(lons)) * kx * (1 + 2 * pad), min_km)
    h = max((max(lats) - min(lats)) * ky * (1 + 2 * pad), min_km)
    r = h / w
    target = ratio if ratio else min(max(r, ratio_bounds[0]), ratio_bounds[1])
    if r < target:
        h = w * target
    else:
        w = h / target
    return (lon_c - w / 2 / kx, lon_c + w / 2 / kx, lat_c - h / 2 / ky, lat_c + h / 2 / ky), target


def draw_base(ax, coast, extent, highlight=None, lw=0.6):
    lon0, lon1, lat0, lat1 = extent
    ax.set_xlim(lon0, lon1)
    ax.set_ylim(lat0, lat1)
    ax.set_aspect("auto")
    ax.set_facecolor(OCEAN)
    polys = [p for p in coast if p[:, 0].max() >= lon0 and p[:, 0].min() <= lon1 and p[:, 1].max() >= lat0 and p[:, 1].min() <= lat1]
    if polys:
        ax.add_collection(PolyCollection(polys, facecolors=LAND, edgecolors=SHORE, linewidths=lw, zorder=1))
    if highlight:
        hi = [p for p in polys if any(h(p) for h in highlight)]
        if hi:
            ax.add_collection(PolyCollection(hi, facecolors=LAND_HI, edgecolors="#c9966b", linewidths=lw + 0.2, zorder=1.1))
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_edgecolor("#9aa6b2")
        s.set_linewidth(0.6)


def scale_bar(ax, extent):
    lon0, lon1, lat0, lat1 = extent
    kx, _ = km_per_deg((lat0 + lat1) / 2)
    width_km = (lon1 - lon0) * kx
    nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
    length = max([n for n in nice if n <= width_km * 0.28] or [nice[0]])
    x0 = lon0 + (lon1 - lon0) * 0.04
    y0 = lat0 + (lat1 - lat0) * 0.045
    x1 = x0 + length / kx
    ax.plot([x0, x1], [y0, y0], color=INK, lw=1.4, solid_capstyle="butt", zorder=6)
    label = f"{int(length * 1000)} m" if length < 1 else f"{length:g} km"
    ax.text((x0 + x1) / 2, y0 + (lat1 - lat0) * 0.012, label, ha="center", va="bottom", fontsize=6, color=INK, zorder=6,
            bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.6))


def to_px(ax, lon, lat):
    return ax.transData.transform((lon, lat))


def repel(points_px, min_dist, iters=300):
    """겹치는 핀을 서로 밀어낸다 (화면 픽셀 기준). 반환: 옮겨진 위치"""
    pos = np.array(points_px, dtype=float)
    n = len(pos)
    if n < 2:
        return pos
    orig = pos.copy()
    rng = np.random.default_rng(7)
    for _ in range(iters):
        moved = False
        for i in range(n):
            for j in range(i + 1, n):
                d = pos[j] - pos[i]
                dist = float(np.hypot(*d))
                if dist < min_dist:
                    if dist < 1e-6:
                        ang = rng.uniform(0, 2 * math.pi)
                        d = np.array([math.cos(ang), math.sin(ang)])
                        dist = 1.0
                    push = (min_dist - dist) / 2 + 0.5
                    u = d / dist
                    pos[i] -= u * push
                    pos[j] += u * push
                    moved = True
        pos += (orig - pos) * 0.02  # 원래 자리 쪽으로 살짝 당김
        if not moved:
            break
    return pos


def clusters(points_px, threshold):
    """가까운 점끼리 묶는다 (단일 연결). 반환: 인덱스 묶음 목록"""
    n = len(points_px)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i in range(n):
        for j in range(i + 1, n):
            if np.hypot(*(np.array(points_px[i]) - np.array(points_px[j]))) < threshold:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


PIN_PT = 13.0                       # 핀 지름 (pt)
PIN_PX = PIN_PT * PX_PER_PT


def draw_pins(ax, stops, clip_extent=None):
    """stops: [{lon, lat, label, color}] — 겹치면 밀어내고 원래 위치와 선으로 잇는다."""
    if not stops:
        return
    true_px = [to_px(ax, s["lon"], s["lat"]) for s in stops]
    pos_px = repel(true_px, PIN_PX * 1.08)
    # 축 안쪽으로 넣기
    bbox = ax.get_window_extent()
    m = PIN_PX * 0.6
    pos_px[:, 0] = np.clip(pos_px[:, 0], bbox.x0 + m, bbox.x1 - m)
    pos_px[:, 1] = np.clip(pos_px[:, 1], bbox.y0 + m, bbox.y1 - m)
    inv = ax.transData.inverted()
    for s, tp, pp in zip(stops, true_px, pos_px):
        x, y = inv.transform(pp)
        if np.hypot(*(np.array(tp) - pp)) > PIN_PX * 0.35:
            ax.plot([s["lon"], x], [s["lat"], y], color=INK, lw=0.6, zorder=7)
            ax.scatter([s["lon"]], [s["lat"]], s=5, color=INK, zorder=7.1)
        ax.scatter([x], [y], s=PIN_PT ** 2, color=s["color"], edgecolors="white", linewidths=1.1, zorder=8)
        n = len(s["label"])
        ax.text(x, y, s["label"], ha="center", va="center_baseline", fontsize=7.2 if n < 2 else (6.2 if n == 2 else 4.9),
                color="white", fontweight="bold", zorder=9)


def draw_route(ax, coords, clip=True):
    """coords: [(lon, lat), ...] 순서대로 굽은 화살표"""
    for a, b in zip(coords, coords[1:]):
        if a == b:
            continue
        pa, pb = to_px(ax, *a), to_px(ax, *b)
        if np.hypot(*(np.array(pa) - np.array(pb))) < PIN_PX * 1.3:
            continue
        ax.add_patch(FancyArrowPatch(a, b, connectionstyle="arc3,rad=0.16", arrowstyle="-|>", mutation_scale=7,
                                     lw=1.0, color=ROUTE, alpha=0.75, shrinkA=PIN_PT * 0.55, shrinkB=PIN_PT * 0.55,
                                     zorder=5, linestyle=(0, (4, 2))))


def draw_context(ax, island, extent, avoid_px, max_labels=7):
    lon0, lon1, lat0, lat1 = extent
    kx, _ = km_per_deg((lat0 + lat1) / 2)
    if (lon1 - lon0) * kx < 6:      # 아주 좁은 지도에는 배경 지명을 넣지 않는다
        return
    used = [np.array(p) for p in avoid_px]
    n = 0
    for name, lat, lon, kind in CONTEXT.get(island, []):
        if not (lon0 < lon < lon1 and lat0 < lat < lat1):
            continue
        p = np.array(to_px(ax, lon, lat))
        if any(np.hypot(*(p - q)) < PIN_PX * 2.2 for q in used):
            continue
        bbox = ax.get_window_extent()
        est_w = (text_units(name) + 1.5) * 5.8 * PX_PER_PT
        flip = p[0] + est_w > bbox.x1 - 6
        ha = "right" if flip else "left"
        label = (name + "  ") if flip else ("  " + name)
        if kind == "peak":
            ax.scatter([lon], [lat], marker="^", s=14, color="#9a8c6d", zorder=3)
            ax.text(lon, lat, label, ha=ha, va="center", fontsize=5.6, color="#7c7257", zorder=3)
        else:
            ax.scatter([lon], [lat], s=4, color="#9aa3ad", zorder=3)
            ax.text(lon, lat, label, ha=ha, va="center", fontsize=5.8, color="#7b8794", zorder=3)
        used.append(p)
        n += 1
        if n >= max_labels:
            break


def on_land(coast, lon, lat):
    from matplotlib.path import Path as MplPath
    for poly in coast:
        if poly[:, 0].min() <= lon <= poly[:, 0].max() and poly[:, 1].min() <= lat <= poly[:, 1].max():
            if MplPath(poly).contains_point((lon, lat)):
                return True
    return False


def pick_inset_corner(ax, pts_px, size_frac, cluster_px, coast):
    """확대 지도를 둘 모서리를 고른다: 묶음 위치와 다른 핀을 가리지 않고, 되도록 바다 쪽."""
    bbox = ax.get_window_extent()
    w, h = bbox.width * size_frac, bbox.width * size_frac
    pad = bbox.width * 0.02
    inv = ax.transData.inverted()
    best = None
    for name, (x, y) in {
        "ur": (bbox.x1 - w - pad, bbox.y1 - h - pad), "ul": (bbox.x0 + pad, bbox.y1 - h - pad),
        "lr": (bbox.x1 - w - pad, bbox.y0 + pad), "ll": (bbox.x0 + pad, bbox.y0 + pad),
    }.items():
        def inside(p, margin):
            return x - margin <= p[0] <= x + w + margin and y - margin <= p[1] <= y + h + margin
        covered = sum(1 for p in pts_px if inside(p, PIN_PX))
        hides_cluster = 1 if inside(cluster_px, PIN_PX * 1.5) else 0
        # 모서리 안 9곳을 찍어 땅이 얼마나 가려지는지 본다
        land = 0
        for fx in (0.2, 0.5, 0.8):
            for fy in (0.2, 0.5, 0.8):
                lon, lat = inv.transform((x + w * fx, y + h * fy))
                land += 1 if on_land(coast, lon, lat) else 0
        dist = np.hypot(*(np.array([x + w / 2, y + h / 2]) - np.array(cluster_px)))
        score = (hides_cluster, covered, land, dist)
        if best is None or score < best[0]:
            best = (score, (x, y, w, h))
    x, y, w, h = best[1]
    return [(x - bbox.x0) / bbox.width, (y - bbox.y0) / bbox.height, w / bbox.width, h / bbox.height]


def tighten(members):
    """묶음에서 혼자 멀리 떨어진 곳을 빼서 확대 지도가 핵심 구역만 담게 한다."""
    members = list(members)
    while len(members) > 3:
        lons = np.array([m["lon"] for m in members])
        lats = np.array([m["lat"] for m in members])
        kx, ky = km_per_deg(float(lats.mean()))
        d = np.hypot((lons - np.median(lons)) * kx, (lats - np.median(lats)) * ky)
        span = max((lons.max() - lons.min()) * kx, (lats.max() - lats.min()) * ky)
        far = int(np.argmax(d))
        rest = [m for j, m in enumerate(members) if j != far]
        rl = np.array([m["lon"] for m in rest])
        rt = np.array([m["lat"] for m in rest])
        span2 = max((rl.max() - rl.min()) * kx, (rt.max() - rt.min()) * ky)
        if span2 < span * 0.6:
            members = rest
        else:
            break
    return members


def draw_panel(fig, rect, coast, island, stops, route_ids, extra_points=None, min_km=1.2):
    """지도 한 칸. stops: [{id, lon, lat, label, color}], route_ids: 장소 id 순서"""
    ax = fig.add_axes(rect)
    pts = stops + (extra_points or [])
    lons = [s["lon"] for s in pts]
    lats = [s["lat"] for s in pts]
    fig_w_px = fig.get_figwidth() * DPI
    ratio = (rect[3] * fig.get_figheight()) / (rect[2] * fig.get_figwidth())
    extent, _ = fit_extent(lons, lats, min_km=min_km, ratio=ratio)
    draw_base(ax, coast, extent)
    fig.canvas.draw()

    px = [to_px(ax, s["lon"], s["lat"]) for s in stops]
    groups = clusters(px, PIN_PX * 1.25) if len(stops) > 2 else [[i] for i in range(len(stops))]
    big = max(groups, key=len) if groups else []
    use_inset = len(big) >= 3 and len(big) < len(stops)
    by_id = {s["id"]: s for s in stops}

    if use_inset:
        inside = tighten([stops[i] for i in big])
        inside_set = {s["id"] for s in inside}
        outside = [s for s in stops if s["id"] not in inside_set]
        inside_ids = {s["id"] for s in inside}
        size = 0.47
        ccx = sum(s["lon"] for s in inside) / len(inside)
        ccy = sum(s["lat"] for s in inside) / len(inside)
        pos = pick_inset_corner(ax, [to_px(ax, s["lon"], s["lat"]) for s in outside], size, to_px(ax, ccx, ccy), coast)
        axin = ax.inset_axes(pos, zorder=10)
        ext_in, _ = fit_extent([s["lon"] for s in inside], [s["lat"] for s in inside], min_km=0.9, pad=0.32,
                               ratio=(pos[3] * rect[3] * fig.get_figheight()) / (pos[2] * rect[2] * fig.get_figwidth()))
        draw_base(axin, coast, ext_in, lw=0.5)
        for s in axin.spines.values():
            s.set_edgecolor(ACCENT)
            s.set_linewidth(1.0)
        fig.canvas.draw()
        # 본 지도에 확대 영역 표시
        cx = sum(s["lon"] for s in inside) / len(inside)
        cy = sum(s["lat"] for s in inside) / len(inside)
        box_w = max(ext_in[1] - ext_in[0], (extent[1] - extent[0]) * 0.035)
        box_h = max(ext_in[3] - ext_in[2], (extent[3] - extent[2]) * 0.035)
        ax.add_patch(Rectangle((cx - box_w / 2, cy - box_h / 2), box_w, box_h, fill=False, ec=ACCENT, lw=1.0, zorder=6))
        bb = axin.get_window_extent()
        inv = ax.transData.inverted()
        corners = [inv.transform((bb.x0, bb.y0)), inv.transform((bb.x1, bb.y0)), inv.transform((bb.x0, bb.y1)), inv.transform((bb.x1, bb.y1))]
        near = min(corners, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cy) ** 2)
        ax.plot([cx, near[0]], [cy, near[1]], color=ACCENT, lw=0.7, ls=(0, (2, 2)), zorder=6)
        # 동선: 묶음 안은 확대 지도에, 밖은 본 지도에 (묶음은 중심점으로)
        main_coords, in_coords = [], []
        for pid in route_ids:
            s = by_id.get(pid)
            if not s:
                continue
            if pid in inside_ids:
                in_coords.append((s["lon"], s["lat"]))
                if not main_coords or main_coords[-1] != (cx, cy):
                    main_coords.append((cx, cy))
            else:
                main_coords.append((s["lon"], s["lat"]))
                in_coords.append(None)
        draw_route(ax, main_coords)
        seg = []
        for c in in_coords + [None]:
            if c is None:
                if len(seg) > 1:
                    draw_route(axin, seg)
                seg = []
            else:
                seg.append(c)
        draw_context(ax, island, extent, [to_px(ax, s["lon"], s["lat"]) for s in outside] + [to_px(ax, cx, cy)])
        scale_bar(ax, extent)
        draw_pins(ax, outside)
        draw_pins(axin, inside)
        scale_bar(axin, ext_in)
    else:
        coords = [(by_id[p]["lon"], by_id[p]["lat"]) for p in route_ids if p in by_id]
        draw_route(ax, coords)
        draw_context(ax, island, extent, px)
        scale_bar(ax, extent)
        draw_pins(ax, stops)
    return ax


def text_units(s):
    return sum(1.0 if ord(c) > 0x2E7F else 0.56 for c in s)


def clip_text(s, max_units):
    if text_units(s) <= max_units:
        return s
    out, u = "", 0.0
    for c in s:
        cu = 1.0 if ord(c) > 0x2E7F else 0.56
        if u + cu > max_units - 1:
            break
        out += c
        u += cu
    return out.rstrip() + "…"


ROW_IN = 0.205      # 범례 한 줄 높이 (인치)
TITLE_IN = 0.50
MARGIN = 0.035      # 좌우 여백 (그림 폭 대비)


def draw_title(fig, title, subtitle=None):
    h = fig.get_figheight()
    ax = fig.add_axes([0, 1 - TITLE_IN / h, 1, TITLE_IN / h])
    ax.set_axis_off()
    ax.add_patch(Rectangle((0, 0), 1, 1, transform=ax.transAxes, color="#fff4ec", zorder=0))
    ax.add_patch(Rectangle((0, 0), 0.016, 1, transform=ax.transAxes, color=ACCENT, zorder=1))
    ax.text(MARGIN + 0.01, 0.62 if subtitle else 0.5, clip_text(title, 26), ha="left", va="center", fontsize=10.5, fontweight="bold", color=INK)
    if subtitle:
        ax.text(MARGIN + 0.01, 0.22, clip_text(subtitle, 40), ha="left", va="center", fontsize=6.6, color=MUTED)


def draw_legend(fig, rows, y_top_in, note=None):
    """rows: [{label, color, text}] — 그림 아래쪽에 번호 목록을 그린다. y_top_in: 범례 윗변(아래에서부터 인치)"""
    h = fig.get_figheight()
    n = len(rows) + (1 if note else 0)
    ax = fig.add_axes([0, 0, 1, y_top_in / h])
    ax.set_axis_off()
    ax.set_xlim(0, FIG_W)
    ax.set_ylim(0, y_top_in)
    y = y_top_in - ROW_IN * 0.62
    for r in rows:
        if r.get("label"):
            ax.scatter([0.22], [y], s=(PIN_PT * 0.86) ** 2, color=r["color"], edgecolors="white", linewidths=0.6, zorder=2)
            ax.text(0.22, y, r["label"], ha="center", va="center_baseline", fontsize=6.3 if len(r["label"]) < 2 else 5.4,
                    color="white", fontweight="bold", zorder=3)
            ax.text(0.40, y, clip_text(r["text"], 31), ha="left", va="center_baseline", fontsize=7.6, color=INK)
        else:
            ax.text(0.13, y, clip_text(r["text"], 35), ha="left", va="center_baseline", fontsize=7.0, color=MUTED)
        y -= ROW_IN
    if note:
        ax.text(0.13, y, clip_text(note, 44), ha="left", va="center_baseline", fontsize=5.8, color=MUTED)


def save(fig, name):
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.png"
    fig.savefig(path, dpi=DPI, facecolor="white")
    plt.close(fig)
    # 용량 줄이기: 색상 수를 줄인 팔레트 PNG
    img = Image.open(path).convert("RGB")
    img = img.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}×{img.size[1]}  {path.stat().st_size / 1024:.0f}KB")


def fmt_date(date):
    y, m, d = map(int, date.split("-"))
    import datetime
    return f"{m}/{d}({WEEK[datetime.date(y, m, d).weekday()]})"


def md(date):
    return f"{int(date[5:7])}/{int(date[8:10])}"


# ───────────────────────────── 날짜별 지도 ─────────────────────────────
def day_panels(trip, day):
    """하루 일정을 섬별 칸으로 나눈다. 반환: [{island, stops, route}], 범례 줄"""
    places = {p["id"]: p for p in trip["places"]}
    hotels = {h["id"]: h for h in trip["hotels"]}
    order = []          # 처음 나온 순서의 장소 id
    first_time = {}
    route = []
    for it in day["items"]:
        pid = it.get("place")
        if not pid or pid not in places:
            continue
        t = it.get("end") if it.get("flight") and it.get("end") else it.get("start")
        if pid not in order:
            order.append(pid)
            first_time[pid] = (t or "", it)
        if not route or route[-1] != pid:
            route.append(pid)
    hotel_place = hotels[day["hotel"]]["place"] if day.get("hotel") else None

    stops, rows = [], []
    for i, pid in enumerate(order, 1):
        p = places[pid]
        t, it = first_time[pid]
        stops.append({"id": pid, "lon": p["lng"], "lat": p["lat"], "label": str(i), "color": CAT_COLOR[p["cat"]], "island": p["island"]})
        tail = " · 오늘 숙소" if pid == hotel_place else ""
        rows.append({"label": str(i), "color": CAT_COLOR[p["cat"]], "text": f"{t}  {p['name']}{tail}".strip()})
    if hotel_place and hotel_place not in order:
        p = places[hotel_place]
        stops.append({"id": hotel_place, "lon": p["lng"], "lat": p["lat"], "label": "숙", "color": CAT_COLOR["hotel"], "island": p["island"]})
        rows.append({"label": "숙", "color": CAT_COLOR["hotel"], "text": f"{p['name']} (오늘 숙소)"})

    islands = []
    for s in stops:
        if s["island"] not in islands:
            islands.append(s["island"])
    # 섬을 옮기는 날은 출발 섬 → 도착 섬 순서
    if day.get("to_island") and day["island"] in islands and day["to_island"] in islands:
        islands = [day["island"], day["to_island"]]
    panels = [{"island": isl, "stops": [s for s in stops if s["island"] == isl],
               "route": [pid for pid in route if places[pid]["island"] == isl]} for isl in islands]
    return panels, rows


def make_day(trip, day, coast):
    panels, rows = day_panels(trip, day)
    flights = {f["id"]: f for f in trip.get("flights", [])}
    notes = []
    for it in day["items"]:
        f = flights.get(it.get("flight") or "")
        if f:
            arr = f" → {it['end']}" if it.get("end") and f["from"] != "ICN" else ""
            if f["from"] == "ICN":
                notes.append("항공  인천 22:50(한국 시간) 출발 → 호놀룰루 정오 무렵 도착")
            else:
                notes.append(f"항공  {it['start']} {AIRPORT_KO.get(f['from'], f['from'])}{arr} {AIRPORT_KO.get(f['to'], f['to'])}".replace("  →", " →"))
    legend_rows = rows + [{"text": n} for n in notes]
    legend_in = ROW_IN * (len(legend_rows) + 0.9) + 0.06

    panel_h = [FIG_W * (1 - 2 * MARGIN) * (0.80 if len(panels) > 1 else 0.98)] * len(panels)
    gap = 0.07
    label_in = 0.19 if len(panels) > 1 else 0.0
    fig_h = TITLE_IN + sum(panel_h) + (gap + label_in) * len(panels) + legend_in
    fig = plt.figure(figsize=(FIG_W, fig_h), dpi=DPI)
    isl = ISLAND_KO[day["island"]] + (f" → {ISLAND_KO[day['to_island']]}" if day.get("to_island") else "")
    draw_title(fig, f"{fmt_date(day['date'])}  {day['title']}", f"{isl} · 번호는 방문 순서")

    y = fig_h - TITLE_IN
    for pn, ph in zip(panels, panel_h):
        if label_in:
            y -= label_in
            fig.text(MARGIN + 0.005, (y + label_in * 0.32) / fig_h, ISLAND_KO[pn["island"]], ha="left", va="center",
                     fontsize=7.4, fontweight="bold", color=ACCENT)
        y -= gap / 2 + ph
        rect = [MARGIN, y / fig_h, 1 - 2 * MARGIN, ph / fig_h]
        draw_panel(fig, rect, coast, pn["island"], pn["stops"], pn["route"])
        y -= gap / 2
    draw_legend(fig, legend_rows, legend_in, note="약도입니다 — 실제 길 안내는 앱의 '길찾기' 버튼을 쓰세요")
    save(fig, f"day-{day['date'][5:7]}{day['date'][8:10]}")


# ───────────────────────────── 날짜별 지도의 '섬 전체' ─────────────────────────────
ISLAND_CENTER = {"oahu": (-157.97, 21.47, 0.4, 0.3), "bigisland": (-155.5, 19.6, 0.7, 0.8)}


def island_extent(coast, island, ratio, pad=0.07):
    """섬 해안선 전체가 들어가는 범위 (그림 칸의 세로/가로 비율에 맞춤)"""
    cx, cy, rx, ry = ISLAND_CENTER[island]
    polys = [p for p in coast if abs(p[:, 0].mean() - cx) < rx and abs(p[:, 1].mean() - cy) < ry]
    lons = np.concatenate([p[:, 0] for p in polys])
    lats = np.concatenate([p[:, 1] for p in polys])
    ext, _ = fit_extent([lons.min(), lons.max()], [lats.min(), lats.max()], min_km=10, pad=pad, ratio=ratio)
    return ext


def group_label(labels):
    """가까이 붙은 핀 여러 개를 하나로 묶을 때 쓰는 글자: '2-4' 처럼 이어지면 범위, 아니면 '3곳'"""
    nums = [int(x) for x in labels if x.isdigit()]
    others = [x for x in labels if not x.isdigit()]
    if not others and nums and nums == list(range(min(nums), max(nums) + 1)):
        return f"{min(nums)}-{max(nums)}" if max(nums) < 10 else f"{len(nums)}곳"
    if len(labels) == 2 and len("".join(labels)) <= 2:
        return "·".join(labels)          # 예: 1·숙 (1번과 숙소가 붙어 있음)
    return f"{len(labels)}곳"


def make_day_wide(trip, day, coast):
    panels, rows = day_panels(trip, day)
    if not panels:
        return
    places = [p for p in trip["places"]]
    n = len(panels)
    ratio_day = 0.80 if n > 1 else 0.98          # make_day 의 칸 비율과 같게 (빨간 네모가 날짜 지도 범위와 맞도록)
    panel_w_in = FIG_W * (1 - 2 * MARGIN)
    panel_h = [panel_w_in * (1.0 if pn["island"] == "oahu" else 1.12) * (0.78 if n > 1 else 1.0) for pn in panels]
    legend_rows = rows + [{"text": "빨간 네모 = 날짜 지도에서 보이는 범위 · 회색 점 = 다른 장소"}]
    legend_in = ROW_IN * (len(legend_rows) + 0.9) + 0.06
    gap = 0.07
    label_in = 0.19 if n > 1 else 0.0
    fig_h = TITLE_IN + sum(panel_h) + (gap + label_in) * n + legend_in
    fig = plt.figure(figsize=(FIG_W, fig_h), dpi=DPI)
    isl = " → ".join(ISLAND_KO[pn["island"]] for pn in panels)
    draw_title(fig, f"{fmt_date(day['date'])}  {day['title']}", f"{isl} 전체 · 번호는 방문 순서")
    y = fig_h - TITLE_IN
    for pn, ph in zip(panels, panel_h):
        if label_in:
            y -= label_in
            fig.text(MARGIN + 0.005, (y + label_in * 0.32) / fig_h, ISLAND_KO[pn["island"]], ha="left", va="center",
                     fontsize=7.4, fontweight="bold", color=ACCENT)
        y -= gap / 2 + ph
        ax = fig.add_axes([MARGIN, y / fig_h, 1 - 2 * MARGIN, ph / fig_h])
        extent = island_extent(coast, pn["island"], ph / panel_w_in)
        draw_base(ax, coast, extent)
        fig.canvas.draw()
        stops = pn["stops"]
        ids = {s["id"] for s in stops}
        others = [p for p in places if p["island"] == pn["island"] and p["id"] not in ids]
        if others:
            ax.scatter([p["lng"] for p in others], [p["lat"] for p in others], s=7, color="#9aa3ad", edgecolors="white", linewidths=0.4, zorder=4)
        # 날짜 지도에 보이는 범위
        dext, _ = fit_extent([s["lon"] for s in stops], [s["lat"] for s in stops], min_km=1.2, ratio=ratio_day)
        min_w = (extent[1] - extent[0]) * 0.035
        min_h = (extent[3] - extent[2]) * 0.035
        cx, cy = (dext[0] + dext[1]) / 2, (dext[2] + dext[3]) / 2
        bw, bh = max(dext[1] - dext[0], min_w), max(dext[3] - dext[2], min_h)
        ax.add_patch(Rectangle((cx - bw / 2, cy - bh / 2), bw, bh, fill=False, ec=ACCENT, lw=1.3, zorder=6))
        by_id = {s["id"]: s for s in stops}
        draw_route(ax, [(by_id[p]["lon"], by_id[p]["lat"]) for p in pn["route"] if p in by_id])
        px = [to_px(ax, s["lon"], s["lat"]) for s in stops]
        draw_context(ax, pn["island"], extent, px, max_labels=6)
        scale_bar(ax, extent)
        # 섬 전체 크기에서는 가까운 곳끼리 핀이 겹치므로 하나로 묶는다
        groups = clusters(px, PIN_PX * 1.25) if len(stops) > 1 else [[0]]
        merged = []
        for g in groups:
            members = [stops[i] for i in g]
            if len(members) == 1:
                merged.append(members[0])
            else:
                merged.append({"id": "+".join(m["id"] for m in members), "lon": sum(m["lon"] for m in members) / len(members),
                               "lat": sum(m["lat"] for m in members) / len(members),
                               "label": group_label([m["label"] for m in members]), "color": INK})
        draw_pins(ax, merged)
        y -= gap / 2
    draw_legend(fig, legend_rows, legend_in, note="약도입니다 — 실제 길 안내는 앱의 '길찾기' 버튼을 쓰세요")
    save(fig, f"day-{day['date'][5:7]}{day['date'][8:10]}-wide")


# ───────────────────────────── 섬별 지도 ─────────────────────────────
def make_island(trip, island, name, coast):
    places = [p for p in trip["places"] if p["island"] == island]
    hotel_places = {h["place"]: h for h in trip["hotels"]}
    stops, rows = [], []
    for i, p in enumerate(places, 1):
        stops.append({"id": p["id"], "lon": p["lng"], "lat": p["lat"], "label": str(i), "color": CAT_COLOR[p["cat"]]})
        h = hotel_places.get(p["id"])
        tail = f"  {md(h['checkin'])}–{md(h['checkout'])}" if h else ""
        rows.append({"label": str(i), "color": CAT_COLOR[p["cat"]], "text": f"{p['name']}{tail}"})
    cats = []
    for p in places:
        if p["cat"] not in cats:
            cats.append(p["cat"])
    legend_in = ROW_IN * (len(rows) + 1.9) + 0.06
    map_h = FIG_W * (1 - 2 * MARGIN) * (1.0 if island == "oahu" else 1.12)
    fig_h = TITLE_IN + 0.06 + map_h + legend_in
    fig = plt.figure(figsize=(FIG_W, fig_h), dpi=DPI)
    info = next((i for i in trip.get("islands", []) if i["id"] == island), {})
    draw_title(fig, f"{ISLAND_KO[island]} 장소 지도", info.get("dates", ""))
    rect = [MARGIN, (legend_in) / fig_h, 1 - 2 * MARGIN, map_h / fig_h]
    draw_panel(fig, rect, coast, island, stops, [], min_km=8)
    cat_line = "색: " + " · ".join(f"{CAT_KO[c]}" for c in cats)
    draw_legend(fig, rows + [{"text": ""}], legend_in, note=None)
    # 분류 색 안내 (맨 아래)
    ax = fig.add_axes([0, 0, 1, (ROW_IN * 1.5) / fig_h])
    ax.set_axis_off()
    ax.set_xlim(0, FIG_W)
    ax.set_ylim(0, 1)
    x = 0.16
    for c in cats:
        ax.scatter([x], [0.55], s=22, color=CAT_COLOR[c], zorder=2)
        ax.text(x + 0.08, 0.55, CAT_KO[c], ha="left", va="center_baseline", fontsize=6.4, color=MUTED)
        x += 0.16 + 0.085 * (len(CAT_KO[c]) + 1.4)
    del cat_line
    save(fig, name)


# ───────────────────────────── 하와이 전체 ─────────────────────────────
def make_overview(trip, coast):
    places = {p["id"]: p for p in trip["places"]}
    map_h = FIG_W * (1 - 2 * MARGIN) * 0.78
    rows = []
    stops = []
    for i, h in enumerate(trip["hotels"], 1):
        p = places[h["place"]]
        stops.append({"id": h["id"], "lon": p["lng"], "lat": p["lat"], "label": str(i), "color": CAT_COLOR["hotel"]})
        rows.append({"label": str(i), "color": CAT_COLOR["hotel"],
                     "text": f"{md(h['checkin'])}–{md(h['checkout'])}  {h['name']} ({h.get('nights', '?')}박)"})
    inter = [f for f in trip.get("flights", []) if f["from"] in ("HNL", "KOA") and f["to"] in ("HNL", "KOA")]
    for f in inter:
        rows.append({"text": f"섬간 항공  {md(f['dep'][:10])} {f['dep'][11:16]} {AIRPORT_KO[f['from']]} → {f['arr'][11:16]} {AIRPORT_KO[f['to']]}"})
    legend_in = ROW_IN * (len(rows) + 0.9) + 0.06
    fig_h = TITLE_IN + 0.06 + map_h + legend_in
    fig = plt.figure(figsize=(FIG_W, fig_h), dpi=DPI)
    t = trip["trip"]
    draw_title(fig, "하와이 전체 일정", f"{md(t['start'])}–{md(t['end'])} · 오아후 → 빅아일랜드 → 오아후")
    ax = fig.add_axes([MARGIN, legend_in / fig_h, 1 - 2 * MARGIN, map_h / fig_h])
    extent = (-160.45, -154.55, 18.75, 22.45)
    ratio = map_h / (FIG_W * (1 - 2 * MARGIN))
    lat_c = (extent[2] + extent[3]) / 2
    kx, ky = km_per_deg(lat_c)
    w_km = (extent[1] - extent[0]) * kx
    h_km = w_km * ratio
    extent = (extent[0], extent[1], lat_c - h_km / 2 / ky, lat_c + h_km / 2 / ky)

    def is_visited(poly):
        cx, cy = poly[:, 0].mean(), poly[:, 1].mean()
        return (abs(cx + 157.97) < 0.4 and abs(cy - 21.47) < 0.3) or (abs(cx + 155.5) < 0.7 and abs(cy - 19.6) < 0.8)

    draw_base(ax, coast, extent, highlight=[is_visited])
    fig.canvas.draw()
    for name, lat, lon, ha, va in ISLAND_LABELS:
        ax.text(lon, lat, name, ha=ha, va=va, fontsize=5.8, color="#7b8794", zorder=3)
    info = {i["id"]: i for i in trip.get("islands", [])}
    ax.text(-158.02, 21.86, f"오아후\n{info.get('oahu', {}).get('dates', '')}", ha="center", va="bottom", fontsize=7.2,
            fontweight="bold", color=INK, linespacing=1.25, zorder=6,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#e6c3a5", lw=0.6, alpha=0.92))
    ax.text(-156.78, 19.42, f"빅아일랜드\n{info.get('bigisland', {}).get('dates', '')}", ha="center", va="center", fontsize=7.2,
            fontweight="bold", color=INK, linespacing=1.25, zorder=6,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#e6c3a5", lw=0.6, alpha=0.92))
    hnl, koa = places.get("hnl"), places.get("koa")
    if hnl and koa:
        a, b = (hnl["lng"], hnl["lat"]), (koa["lng"], koa["lat"])
        for (p, q, rad) in [(a, b, -0.22), (b, a, -0.22)]:
            ax.add_patch(FancyArrowPatch(p, q, connectionstyle=f"arc3,rad={rad}", arrowstyle="-|>", mutation_scale=7,
                                         lw=1.0, color=CAT_COLOR["move"], alpha=0.85, zorder=5, linestyle=(0, (4, 2)),
                                         shrinkA=4, shrinkB=4))
    scale_bar(ax, extent)
    draw_pins(ax, stops)
    draw_legend(fig, rows, legend_in)
    save(fig, "overview-hawaii")


# ───────────────────────────── 한국 ↔ 하와이 ─────────────────────────────
def great_circle(lat1, lon1, lat2, lon2, n=80):
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    d = 2 * math.asin(math.sqrt(math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2))
    out = []
    for i in range(n + 1):
        f = i / n
        a = math.sin((1 - f) * d) / math.sin(d)
        b = math.sin(f * d) / math.sin(d)
        x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
        y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
        z = a * math.sin(p1) + b * math.sin(p2)
        lat = math.degrees(math.atan2(z, math.hypot(x, y)))
        lon = math.degrees(math.atan2(y, x)) % 360
        out.append((lon, lat))
    return out, d * 6371.0


def make_korea_hawaii(trip, coast):
    flights = {f["id"]: f for f in trip.get("flights", [])}
    out_f = next((f for f in trip.get("flights", []) if f["from"] == "ICN"), None)
    back_f = next((f for f in trip.get("flights", []) if f["to"] == "ICN"), None)
    del flights
    rows = []
    if out_f:
        rows.append({"label": "가", "color": ACCENT, "text": f"{md(out_f['dep'][:10])} {out_f['dep'][11:16]} 인천 출발 → 같은 날 정오 무렵 호놀룰루"})
    if back_f:
        rows.append({"label": "오", "color": CAT_COLOR["move"], "text": f"{md(back_f['dep'][:10])} {back_f['dep'][11:16]} 호놀룰루 출발 → 다음 날 저녁 인천"})
    rows.append({"text": "시차: 한국이 하와이보다 19시간 빠릅니다"})
    rows.append({"text": "예) 하와이 오전 9시 = 한국 다음 날 새벽 4시"})
    legend_in = ROW_IN * (len(rows) + 0.5) + 0.06
    map_h = FIG_W * (1 - 2 * MARGIN) * 0.66
    fig_h = TITLE_IN + 0.06 + map_h + legend_in
    fig = plt.figure(figsize=(FIG_W, fig_h), dpi=DPI)
    t = trip["trip"]
    draw_title(fig, "한국 ↔ 하와이", f"{md(t['start'])} 출발 · {md(t['end'])} 귀국편 탑승")
    ax = fig.add_axes([MARGIN, legend_in / fig_h, 1 - 2 * MARGIN, map_h / fig_h])
    extent = (112, 216, 3, 58)
    draw_base(ax, coast, extent, lw=0.35)
    fig.canvas.draw()
    icn = (126.44, 37.46)
    hnl = ((-157.92) % 360, 21.32)
    arc, dist = great_circle(icn[1], icn[0], hnl[1], hnl[0])
    xs, ys = [p[0] for p in arc], [p[1] for p in arc]
    ax.plot(xs, ys, color=ACCENT, lw=1.5, zorder=5)
    mid = len(arc) // 2
    ax.annotate("", xy=arc[mid + 2], xytext=arc[mid], arrowprops=dict(arrowstyle="-|>", color=ACCENT, lw=1.5), zorder=5)
    ys2 = [y - 3.2 * math.sin(math.pi * i / (len(arc) - 1)) for i, y in enumerate(ys)]
    ax.plot(xs, ys2, color=CAT_COLOR["move"], lw=1.3, ls=(0, (4, 2)), zorder=5)
    ax.annotate("", xy=(xs[mid - 2], ys2[mid - 2]), xytext=(xs[mid], ys2[mid]),
                arrowprops=dict(arrowstyle="-|>", color=CAT_COLOR["move"], lw=1.3), zorder=5)
    ax.axvline(180, color="#7b8794", lw=0.6, ls=(0, (1, 3)), zorder=2)
    ax.text(180.8, 5.2, "날짜변경선", fontsize=5.6, color="#7b8794", ha="left", va="bottom", zorder=3)
    for (x, y), name, ha, dx in [(icn, "인천 (서울)", "left", 2.0), (hnl, "호놀룰루", "right", -2.0)]:
        ax.scatter([x], [y], s=34, color=INK, edgecolors="white", linewidths=0.9, zorder=8)
        ax.text(x + dx, y - 3.3, name, ha=ha, va="top", fontsize=7.6, fontweight="bold", color=INK, zorder=8,
                bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.85))
    ax.text(xs[mid], ys[mid] + 2.2, f"약 {round(dist, -2):,.0f} km", ha="center", va="bottom", fontsize=6.4, color=INK, zorder=6,
            bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.8))
    for name, x, y in [("일본", 135.5, 31.2), ("태평양", 170, 17), ("알래스카", 204, 56.8)]:
        ax.text(x, y, name, ha="center", va="center", fontsize=5.8, color="#7b8794", zorder=3)
    draw_legend(fig, rows, legend_in)
    save(fig, "korea-hawaii")


def main():
    only = sys.argv[1:]
    font = setup_font()
    trip = json.loads((ROOT / "data" / "trip.json").read_text(encoding="utf-8"))
    hawaii = load_coast("hawaii")
    print(f"글꼴: {font}")

    def want(name):
        return not only or any(o in name for o in only)

    if want("korea-hawaii"):
        make_korea_hawaii(trip, load_coast("pacific"))
    if want("overview-hawaii"):
        make_overview(trip, hawaii)
    if want("oahu"):
        make_island(trip, "oahu", "oahu", hawaii)
    if want("big-island"):
        make_island(trip, "bigisland", "big-island", hawaii)
    for day in trip["days"]:
        name = f"day-{day['date'][5:7]}{day['date'][8:10]}"
        if want(name):
            make_day(trip, day, hawaii)
        if want(name + "-wide"):
            make_day_wide(trip, day, hawaii)


if __name__ == "__main__":
    main()
