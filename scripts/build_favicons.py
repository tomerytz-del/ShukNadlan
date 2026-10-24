#!/usr/bin/env python3
"""
‏אייקונים לגוגל מתוך הלוגו הקיים — ריפוד לריבוע, בלי למתוח.

‏‎assets/logo-shuknadlan.png‎ נבנה ב-‎scripts/build_logo.py‎ מהרינדור של
הלוגו: ‏512×610, שקוף, והפין ממורכז. גוגל דורשת favicon ביחס 1:1, ולוגו ארגון שלפחות
‏112×112. מוסיפים שוליים משני הצדדים עד שהקנבס ריבועי (‏610×610). הפיקסלים
של הסמל עצמו אינם נדגמים מחדש.

ממנו נגזרים, בקנה מידה אחיד:

  ‏‎assets/logo-shuknadlan-square.png‎  — ‎logo‎ בנתונים המובנים
  ‏‎assets/favicon-48.png‎, ‎-96‎, ‎-192‎ — ‎<link rel="icon">‎
  ‏‎favicon.ico‎ בשורש — 16, 32 ו-48

ה-SVG של הלשונית (‎assets/favicon.svg‎) אינו נבנה כאן אלא ב-build_logo.py,
עם viewBox ריבועי (‎-5 0 62 62‎) — אותו ריפוד.

    python3 scripts/build_favicons.py
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "logo-shuknadlan.png"

# ‏610 הוא גובה המקור, ולכן הריפוד הוא אופקי בלבד והסמל אינו מוקטן.
SIDE = 610
FAVICON_PNGS = (48, 96, 192)
ICO_SIZES = (16, 32, 48)


def square_pad(src: Image.Image) -> Image.Image:
    if src.width > SIDE or src.height > SIDE:
        raise SystemExit("הלוגו גדול מהריבוע %d — לא מכווצים אותו כאן" % SIDE)
    canvas = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    x = (SIDE - src.width) // 2
    y = (SIDE - src.height) // 2
    canvas.paste(src, (x, y))
    # הריפוד לא נגע בפיקסלים של המקור
    crop = canvas.crop((x, y, x + src.width, y + src.height))
    if crop.tobytes() != src.tobytes():
        raise SystemExit("הריפוד שינה פיקסלים של הסמל")
    return canvas


def save_png(im: Image.Image, path: Path) -> None:
    """‏PNG בפלטה של 256 צבעים עם פיזור. הלוגו רינדור עם מעברי צבע, וב-RGBA
    מלא הריבוע שקל 316KB; בפלטה הוא כשישית מזה, בלי הבדל שנראה בגודל אמיתי."""
    pal = im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    pal.save(path, format="PNG", optimize=True)


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """‏ICO עם מסגרות PNG, כדי שהשקיפות תישמר (הפורמט הישן של BMP מאבד אותה)."""
    blobs = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        blobs.append(buf.getvalue())

    count = len(blobs)
    header = struct.pack("<HHH", 0, 1, count)
    entries = b""
    offset = 6 + 16 * count
    for im, blob in zip(images, blobs):
        w = im.width if im.width < 256 else 0
        h = im.height if im.height < 256 else 0
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(header + entries + b"".join(blobs))


def main() -> int:
    src = Image.open(SOURCE).convert("RGBA")
    if src.size != (512, 610):
        raise SystemExit("ציפיתי ל-512×610, קיבלתי %s. לא מנחשים ריפוד אחר." % (src.size,))

    master = square_pad(src)
    square_path = ASSETS / "logo-shuknadlan-square.png"
    save_png(master, square_path)
    print("✓ %s  (%dx%d)" % (square_path.relative_to(ROOT), SIDE, SIDE))

    for size in FAVICON_PNGS:
        im = master.resize((size, size), Image.Resampling.LANCZOS)
        out = ASSETS / ("favicon-%d.png" % size)
        save_png(im, out)
        print("✓ %s  (%dx%d)" % (out.relative_to(ROOT), size, size))

    # ‏16 ו-32 נגזרים מהמאסטר, לא מ-48 שכבר הוקטן
    ico_frames = [master.resize((s, s), Image.Resampling.LANCZOS) for s in ICO_SIZES]
    ico_path = ROOT / "favicon.ico"
    write_ico(ico_path, ico_frames)
    print("✓ %s  (%s)" % (ico_path.relative_to(ROOT), ", ".join("%d" % s for s in ICO_SIZES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
