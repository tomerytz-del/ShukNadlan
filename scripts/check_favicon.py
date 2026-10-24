#!/usr/bin/env python3
"""
‏favicon שגוגל יכולה להציג, ושם האתר בדף הבית.

גוגל מציגה favicon אחד לאתר, והיא קוראת PNG ו-ICO — לא SVG. ה-SVG של
הלשונית היה 52×62, ולכן לא הופיע לוגו ליד הכתובת. הבלוק משוכפל בכל דף
HTML בשורש (אין תבנית משותפת). דף בלי הבלוק נראה תקין: הלשונית עדיין
מציגה את ה-SVG, וגוגל פשוט לא מקבלת ריבוע.

שם האתר ("שוק נדל״ן") מגיע מ-JSON-LD מסוג WebSite, ורק בדף הבית.

    python3 scripts/check_favicon.py
"""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ICON_BLOCK = """<link rel="icon" href="/assets/favicon-192.png" type="image/png" sizes="192x192">
<link rel="icon" href="/assets/favicon-96.png" type="image/png" sizes="96x96">
<link rel="icon" href="/assets/favicon-48.png" type="image/png" sizes="48x48">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" type="image/x-icon">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" sizes="any">"""

PNG_SIZES = {
    "assets/favicon-48.png": 48,
    "assets/favicon-96.png": 96,
    "assets/favicon-192.png": 192,
    "assets/logo-shuknadlan-square.png": 610,
}

SITE_NAME = "שוק נדל״ן"
HOME_URL = "https://shuknadlan.co.il/"
ORG_LOGO = "https://shuknadlan.co.il/assets/logo-shuknadlan-square.png"
LD_RE = re.compile(
    r'<script\s+type="application/ld\+json">\s*(.*?)\s*</script>',
    re.DOTALL,
)


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[12:16] != b"IHDR":
        raise ValueError("לא PNG")
    w = int.from_bytes(data[16:20], "big")
    h = int.from_bytes(data[20:24], "big")
    return w, h


def ico_sizes(path: Path) -> list[tuple[int, int]]:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise ValueError("לא קובץ ICO")
    sizes = []
    off = 6
    for _ in range(count):
        w, h = struct.unpack_from("<BB", data, off)
        sizes.append((w or 256, h or 256))
        off += 16
    return sizes


def ld_blocks(html: str) -> list[object]:
    blocks = []
    for raw in LD_RE.findall(html):
        blocks.append(json.loads(raw))
    return blocks


def main() -> int:
    failures = 0

    for rel, side in PNG_SIZES.items():
        path = ROOT / rel
        if not path.exists():
            failures += 1
            print("✗ חסר %s" % rel)
            continue
        try:
            w, h = png_size(path)
        except ValueError as err:
            failures += 1
            print("✗ %s: %s" % (rel, err))
            continue
        if (w, h) != (side, side):
            failures += 1
            print("✗ %s הוא %dx%d ולא ריבוע של %d" % (rel, w, h, side))

    ico = ROOT / "favicon.ico"
    if not ico.exists():
        failures += 1
        print("✗ חסר favicon.ico")
    else:
        try:
            sizes = ico_sizes(ico)
        except (ValueError, struct.error) as err:
            failures += 1
            print("✗ favicon.ico: %s" % err)
            sizes = []
        if (48, 48) not in sizes:
            failures += 1
            print("✗ favicon.ico בלי מסגרת 48×48 (יש %s)" % (sizes,))

    svg = (ROOT / "assets" / "favicon.svg").read_text(encoding="utf-8")
    view = re.search(r'viewBox="([^"]+)"', svg)
    parts = [float(n) for n in view.group(1).split()] if view else []
    if len(parts) != 4 or parts[2] != parts[3]:
        failures += 1
        print("✗ favicon.svg אינו ריבועי: %s" % (view.group(1) if view else "אין viewBox"))

    pages = sorted(ROOT.glob("*.html"))
    missing = []
    for path in pages:
        text = path.read_text(encoding="utf-8")
        head_end = re.search(r"</head\s*>", text, re.IGNORECASE)
        head = text[: head_end.start()] if head_end else text
        if ICON_BLOCK not in head:
            missing.append(path.name)
    if missing:
        failures += 1
        print("✗ בלי בלוק ה-favicon שגוגל קוראת:")
        for name in missing:
            print("      • %s" % name)
        print("\nהבלוק ב-index.html, מיד לפני המניפסט. הפרטים: docs/logo.md")

    home = (ROOT / "index.html").read_text(encoding="utf-8")
    try:
        blocks = ld_blocks(home)
    except json.JSONDecodeError as err:
        failures += 1
        print("✗ JSON-LD בדף הבית אינו תקין: %s" % err)
        blocks = []

    websites = [b for b in blocks if isinstance(b, dict) and b.get("@type") == "WebSite"]
    if len(websites) != 1:
        failures += 1
        print("✗ בדף הבית צריך בלוק WebSite אחד, יש %d" % len(websites))
    elif websites:
        site = websites[0]
        names = site.get("alternateName")
        if site.get("name") != SITE_NAME or site.get("url") != HOME_URL:
            failures += 1
            print("✗ WebSite: name או url אינם שם האתר והכתובת הקנונית")
        if not isinstance(names, list) or "שוק נדלן" not in names or "Shuk Nadlan" not in names:
            failures += 1
            print("✗ WebSite בלי alternateName (שוק נדלן, Shuk Nadlan)")

    orgs = [b for b in blocks if isinstance(b, dict) and b.get("@type") == "RealEstateAgent"]
    if not any(b.get("logo") == ORG_LOGO for b in orgs):
        failures += 1
        print("✗ לוגו הארגון בדף הבית אינו מצביע אל ה-PNG הריבועי")

    for path in pages:
        if path.name == "index.html":
            continue
        if '"@type": "WebSite"' in path.read_text(encoding="utf-8"):
            failures += 1
            print("✗ %s נושא WebSite. השם נקבע רק בדף הבית." % path.name)

    publisher = (ROOT / "netlify" / "edge-functions" / "og-tags.ts").read_text(encoding="utf-8")
    if "logo-shuknadlan-square.png" not in publisher:
        failures += 1
        print("✗ לוגו הארגון בכתבות (og-tags) אינו הריבוע")

    if failures:
        return 1
    print("✓ favicon ריבועי בכל %d הדפים, ושם האתר בדף הבית." % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
