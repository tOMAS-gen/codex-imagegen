#!/usr/bin/env python3
"""Build an edit mask for the imagegen CLI route.

The Images edit endpoint reads the mask's ALPHA channel: pixels with alpha 0 are the
region the model may repaint, everything else is held. This script produces a mask that
is the same size as the source image, carries the source pixels for easy visual review,
and punches alpha 0 through the regions you name.

Coordinates accept pixels (`120`) or percentages of the corresponding axis (`25%`).
Regions are repeatable and additive.

    py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --rect 0,60%,100%,100%
    py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --ellipse 50%,50%,30%,30%
    py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --polygon 10,10 200,10 200,180
    py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --rect 25%,25%,75%,75% --invert

Requires Pillow:  uv pip install pillow   (or: py -3 -m pip install pillow)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

MAX_MASK_BYTES = 50 * 1024 * 1024

try:
    from PIL import Image, ImageChops, ImageDraw
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write(
        "Pillow is required to build a mask but is not installed.\n"
        "Install it with:  uv pip install pillow\n"
        "            or:  py -3 -m pip install pillow\n"
    )
    raise SystemExit(2)


def _die(message: str) -> "NoReturn":  # type: ignore[valid-type]
    sys.stderr.write(f"error: {message}\n")
    raise SystemExit(1)


def parse_scalar(token: str, extent: int, *, label: str) -> int:
    """Resolve one coordinate against its axis length. Accepts `120` or `25%`."""
    token = token.strip()
    if not token:
        _die(f"{label}: empty coordinate")
    try:
        if token.endswith("%"):
            return int(round(float(token[:-1]) / 100.0 * extent))
        return int(round(float(token)))
    except ValueError:
        _die(f"{label}: {token!r} is not a number or percentage")


def parse_pairs(tokens: list[str], size: tuple[int, int], *, label: str) -> list[tuple[int, int]]:
    width, height = size
    points: list[tuple[int, int]] = []
    for token in tokens:
        parts = token.split(",")
        if len(parts) != 2:
            _die(f"{label}: expected `x,y` pairs, got {token!r}")
        points.append((parse_scalar(parts[0], width, label=label), parse_scalar(parts[1], height, label=label)))
    return points


def parse_quad(value: str, size: tuple[int, int], *, label: str) -> tuple[int, int, int, int]:
    width, height = size
    parts = value.split(",")
    if len(parts) != 4:
        _die(f"{label}: expected 4 comma-separated values, got {value!r}")
    return (
        parse_scalar(parts[0], width, label=label),
        parse_scalar(parts[1], height, label=label),
        parse_scalar(parts[2], width, label=label),
        parse_scalar(parts[3], height, label=label),
    )


def build_selection(image_size: tuple[int, int], args: argparse.Namespace) -> Image.Image:
    """White (255) marks the editable region; black (0) marks everything to preserve."""
    selection = Image.new("L", image_size, 0)
    draw = ImageDraw.Draw(selection)
    drew_something = False

    for value in args.rect or []:
        x1, y1, x2, y2 = parse_quad(value, image_size, label="--rect")
        draw.rectangle([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)], fill=255)
        drew_something = True

    for value in args.ellipse or []:
        cx, cy, rx, ry = parse_quad(value, image_size, label="--ellipse")
        if rx <= 0 or ry <= 0:
            _die("--ellipse: rx and ry must be positive")
        draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
        drew_something = True

    for tokens in args.polygon or []:
        points = parse_pairs(tokens, image_size, label="--polygon")
        if len(points) < 3:
            _die("--polygon: needs at least 3 points")
        draw.polygon(points, fill=255)
        drew_something = True

    if not drew_something:
        _die("no region given. Use at least one of --rect, --ellipse or --polygon.")

    if args.invert:
        selection = ImageChops.invert(selection)
    return selection


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create a same-size PNG edit mask where alpha=0 marks the editable region.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--image", required=True, help="source image the mask must match")
    parser.add_argument("--out", required=True, help="destination .png for the mask")
    parser.add_argument("--rect", action="append", metavar="x1,y1,x2,y2", help="rectangular region (repeatable)")
    parser.add_argument("--ellipse", action="append", metavar="cx,cy,rx,ry", help="elliptical region (repeatable)")
    parser.add_argument("--polygon", action="append", nargs="+", metavar="x,y", help="polygon region (repeatable)")
    parser.add_argument("--invert", action="store_true", help="edit everything EXCEPT the named regions")
    parser.add_argument("--force", action="store_true", help="overwrite an existing mask file")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.image):
        _die(f"source image not found: {args.image}")
    if not args.out.lower().endswith(".png"):
        _die("--out must be a .png: the mask needs an alpha channel")
    if os.path.exists(args.out) and not args.force:
        _die(f"{args.out} already exists. Pass --force to overwrite.")

    base = Image.open(args.image).convert("RGBA")
    selection = build_selection(base.size, args)

    # Editable (255 in the selection) becomes alpha 0; preserved area stays fully opaque.
    alpha = ImageChops.invert(selection)
    mask = base.copy()
    mask.putalpha(alpha)

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    mask.save(args.out, "PNG")

    size_bytes = os.path.getsize(args.out)
    if size_bytes > MAX_MASK_BYTES:
        _die(f"mask is {size_bytes} bytes, over the 50MB API limit. Use a smaller source image.")

    total = base.size[0] * base.size[1]
    # histogram()[0] counts fully-unselected pixels; everything else is editable.
    editable = total - selection.histogram()[0]
    print(
        json.dumps(
            {
                "mask": os.path.abspath(args.out),
                "size": {"width": base.size[0], "height": base.size[1]},
                "bytes": size_bytes,
                "editable_pixels": editable,
                "editable_fraction": round(editable / total, 4) if total else 0.0,
                "note": "alpha=0 marks the editable region; masking is prompt-guided, not pixel-exact",
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
