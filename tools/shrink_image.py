#!/usr/bin/env python3
"""사진·바우처를 앱에 넣기 좋은 크기로 줄인다 (폭 1200px, JPEG 80%, 위치정보 등 EXIF 제거).

    python tools/shrink_image.py 원본.jpg photos/kualoa-valley.jpg
    python tools/shrink_image.py 캡처.png private/vouchers/kualoa.jpg --width 1200 --quality 80

필요: pip install Pillow
"""
import argparse
from pathlib import Path

from PIL import Image, ImageOps


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=1200, help="최대 폭 (기본 1200)")
    ap.add_argument("--quality", type=int, default=80, help="JPEG 품질 (기본 80)")
    args = ap.parse_args()

    img = ImageOps.exif_transpose(Image.open(args.src))      # 폰 사진의 회전 정보를 반영
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, "white")             # 투명 배경은 흰색으로
        bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = bg
    if img.width > args.width:
        img = img.resize((args.width, round(img.height * args.width / img.width)), Image.LANCZOS)
    dst = Path(args.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(dst, "JPEG", quality=args.quality, optimize=True, progressive=True)   # EXIF 는 저장하지 않음
    print(f"{dst}  {img.width}×{img.height}  {dst.stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
