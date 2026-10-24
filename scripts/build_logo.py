#!/usr/bin/env python3
"""
‏בניית כל קובצי הלוגו מהרינדור התלת־ממדי — מקור אחד, בלי ציור ביד.

הלוגו של האתר (מ-24.10.2026) הוא רינדור: פין ספיר מבריק עם שפת זכוכית,
גג כסוף ואות ש מוזהבת. אין לו וקטור, ולכן כל הקבצים נגזרים מתמונה אחת:

  ‏‎marketing/brand/logo-source.jpg‎       — הקובץ שהתקבל, על רקע שמנת
  ‏‎marketing/brand/logo-3d-master.png‎    — אחרי חיתוך הרקע (נכתב כאן)

ומהמאסטר:

  ‏‎assets/logo-shuknadlan.png‎      ‏512×610 שקוף — og, ומקור ל-build_favicons
  ‏‎assets/logo-shuknadlan-hd.webp‎  ‏480 גובה — מסך הפתיחה וההמתנה בגודל גדול
  ‏‎assets/logo-shuknadlan.svg‎      כותרות וכרטיסים (רקע בהיר)
  ‏‎assets/logo-shuknadlan-dark.svg‎ הפוטר (רקע כהה) — עם הילה בהירה
  ‏‎assets/favicon.svg‎              לשונית הדפדפן, ריבועי
  ‏‎assets/og-default.png‎           כרטיס השיתוף — הפין מוחלף, הטקסט נשאר

## למה קובצי ה-SVG עוטפים רסטר

‏61 דפים מצביעים אל ‎logo-shuknadlan.svg‎ עם ‎width="52" height="62"‎. קובץ
SVG שמכיל ‎<image>‎ עם data URI נצבע כמו כל SVG אחר בתוך ‎<img>‎ (בלי בקשה
נוספת — data URI מותר גם במסמך SVG שנטען כתמונה), ולכן החלפת הלוגו לא נגעה
באף דף. הרסטר בתוכו הוא פי 3 מגובה ה-viewBox, כדי שיהיה חד בכל צפיפות
מסך עד 64px (כרטיס הכניסה).

## הרצה

    pip install pillow scipy
    python3 scripts/build_logo.py
    python3 scripts/build_favicons.py
    python3 scripts/build_app_icons.py

הסדר חשוב: שני האחרונים קוראים את ‎assets/logo-shuknadlan.png‎ שנכתב כאן.
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BRAND = ROOT / "marketing" / "brand"
SOURCE = BRAND / "logo-source.jpg"
MASTER = BRAND / "logo-3d-master.png"


# ---------------------------------------------------------------------------
# חיתוך
# ---------------------------------------------------------------------------
def cut(src: Image.Image) -> Image.Image:
    """הסרת רקע השמנת והצל שמתחת לפין.

    הרקע והצל ניטרליים (‏b - r בין ‎-8‎ ל-‎+4‎), וכל פיקסל של הפין — קו
    המתאר הכהה, שפת הזכוכית והפנים — נוטה לכחול. לכן המסכה היא "כחול",
    הרכיב הגדול ביותר, עם החורים (הגג והאות) ממולאים. שפת הזכוכית נשארת
    אטומה בכוונה: על רקע כהה היא מה שמפריד את הפין מהרקע.
    """
    from scipy import ndimage as ndi  # noqa: PLC0415 — תלות של הסקריפט בלבד

    im = np.asarray(src.convert("RGB")).astype(np.int32)
    blue = (im[..., 2] - im[..., 0]) > 18
    lab, n = ndi.label(blue)
    if n == 0:
        raise SystemExit("לא נמצא פין כחול במקור")
    sizes = ndi.sum(blue, lab, range(1, n + 1))
    pin = lab == (1 + int(np.argmax(sizes)))
    pin = ndi.binary_closing(pin, iterations=6)
    pin = ndi.binary_fill_holes(pin)
    # שני פיקסלים פנימה: השוליים החיצוניים הם תערובת עם השמנת, ועל רקע כהה
    # הם היו נראים כהילה בהירה דקה.
    pin = ndi.binary_erosion(pin, iterations=2)

    alpha = ndi.gaussian_filter(pin.astype(np.float32), 1.0)
    alpha = np.clip((alpha - 0.5) * 2.2 + 0.5, 0, 1)

    ys, xs = np.where(alpha > 0.01)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([im.astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(rgba[y0:y1, x0:x1].copy(), "RGBA")


# ---------------------------------------------------------------------------
# כלים
# ---------------------------------------------------------------------------
def scale_to_height(im: Image.Image, height: int) -> Image.Image:
    """הקטנה עם אלפא מוכפל, אחרת הצבע של פיקסלים שקופים זולג לשוליים."""
    width = round(im.width * height / im.height)
    return im.convert("RGBa").resize((width, height), Image.LANCZOS).convert("RGBA")


def place(im: Image.Image, canvas_w: int, canvas_h: int) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((canvas_w - im.width) // 2, (canvas_h - im.height) // 2))
    return canvas


def halo(im: Image.Image, radius: float, opacity: float, pad: int) -> Image.Image:
    """הילה לבנה רכה מאחורי הפין — רק לגרסה של הרקע הכהה."""
    w, h = im.width + 2 * pad, im.height + 2 * pad
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    base.alpha_composite(im, (pad, pad))
    a = base.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    a = a.point(lambda v: int(v * opacity))
    glow = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    glow.putalpha(a)
    glow.alpha_composite(base)
    return glow


def webp_uri(im: Image.Image, quality: int = 90) -> str:
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def svg_wrap(view_box: str, box: tuple[float, float, float, float], uri: str,
             comment: str, extra: str = "") -> str:
    x, y, w, h = box
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s"%s>\n'
        "  <!-- %s\n"
        "       נבנה ב-scripts/build_logo.py מ-marketing/brand/logo-3d-master.png.\n"
        "       אין לערוך ביד: מריצים את הסקריפט. -->\n"
        '  <image x="%.2f" y="%.2f" width="%.2f" height="%.2f" '
        'preserveAspectRatio="xMidYMid meet" href="%s"/>\n'
        "</svg>\n" % (view_box, extra, comment, x, y, w, h, uri)
    )


def fit_box(im: Image.Image, view_w: float, view_h: float, height: float,
            x0: float = 0.0, y0: float = 0.0) -> tuple[float, float, float, float]:
    w = height * im.width / im.height
    return (x0 + (view_w - w) / 2, y0 + (view_h - height) / 2, w, height)


# ---------------------------------------------------------------------------
# כרטיס השיתוף
# ---------------------------------------------------------------------------
# התיבה שנצבעת מחדש ב-og-default.png: מכסה את הפין הישן וגם את החדש עם
# ההילה שלו, כך שהרצה חוזרת מוחקת את הקודם במלואו. הטקסט משמאל לה (עד
# ‏x=720) נשאר כמו שהוא.
OG_PIN_BOX = (730, 140, 1030, 490)


def rebuild_og(master: Image.Image) -> None:
    path = ASSETS / "og-default.png"
    og = Image.open(path).convert("RGB")
    arr = np.asarray(og).astype(np.float64)
    h, w, _ = arr.shape

    # הרקע הוא מעבר אלכסוני חלק. מתאימים לו מישור (‏a + bx + cy) לכל ערוץ
    # מתוך פיקסלים שאין בהם טקסט ואין בהם פין, וצובעים בו את תיבת הפין.
    yy, xx = np.mgrid[0:h, 0:w]
    sample = np.ones((h, w), bool)
    sample[150:480, 180:720] = False                      # הטקסט
    x0, y0, x1, y1 = OG_PIN_BOX
    sample[y0 - 10:y1 + 10, x0 - 10:x1 + 10] = False      # הפין
    A = np.column_stack([np.ones(sample.sum()), xx[sample], yy[sample]])
    patch_y, patch_x = yy[y0:y1, x0:x1], xx[y0:y1, x0:x1]
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, arr[..., c][sample], rcond=None)
        arr[y0:y1, x0:x1, c] = coef[0] + coef[1] * patch_x + coef[2] * patch_y
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    pin = halo(scale_to_height(master, 270), radius=14, opacity=0.22, pad=24)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    out.alpha_composite(pin, (cx - pin.width // 2, cy - pin.height // 2))
    out.convert("RGB").save(path, optimize=True)
    print("✓ assets/og-default.png")


# ---------------------------------------------------------------------------
def main() -> int:
    if not SOURCE.exists():
        raise SystemExit("חסר %s" % SOURCE.relative_to(ROOT))
    master = cut(Image.open(SOURCE))
    master.save(MASTER, optimize=True)
    print("✓ %s  (%dx%d)" % (MASTER.relative_to(ROOT), master.width, master.height))

    # ‏512×610 — הגודל ש-build_favicons.py דורש. הפין בגובה 600, ממורכז.
    png = place(scale_to_height(master, 600), 512, 610)
    # פלטה של 256 צבעים עם פיזור: ‏50KB במקום 305KB, בלי הבדל שנראה.
    png.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG) \
        .save(ASSETS / "logo-shuknadlan.png", optimize=True)
    print("✓ assets/logo-shuknadlan.png  (512x610)")

    hd = scale_to_height(master, 480)
    hd.save(ASSETS / "logo-shuknadlan-hd.webp", quality=90, method=6)
    print("✓ assets/logo-shuknadlan-hd.webp  (%dx480)" % hd.width)

    # ‏viewBox ‏52×62 נשמר: כל ה-<img> באתר נושאים width="52" height="62".
    light = scale_to_height(master, 186)
    (ASSETS / "logo-shuknadlan.svg").write_text(svg_wrap(
        "0 0 52 62", fit_box(light, 52, 62, 61), webp_uri(light),
        "‏הלוגו לרקע בהיר: כותרות, כרטיסים, דוחות."), encoding="utf-8")
    print("✓ assets/logo-shuknadlan.svg")

    # בפוטר (‎#0d1b3d‎) קו המתאר הכחול של הפין כמעט נבלע ברקע. ההילה הלבנה
    # הרכה מחזירה לו את הקצה בלי להחליף צבעים — הפין נשאר אותו פין.
    dark = halo(scale_to_height(master, 168), radius=7, opacity=0.38, pad=9)
    (ASSETS / "logo-shuknadlan-dark.svg").write_text(svg_wrap(
        "0 0 52 62", fit_box(dark, 52, 62, 62), webp_uri(dark),
        "‏הלוגו לרקע כהה — הפוטר: אותו פין עם הילה בהירה."), encoding="utf-8")
    print("✓ assets/logo-shuknadlan-dark.svg")

    # לשונית: ריבוע (‎-5 0 62 62‎, גוגל דורשת 1:1). שפת הזכוכית הבהירה היא
    # מה שמבדיל את הפין משורת לשוניות כהה, ולכן אין כאן היפוך לפי ערכת צבעים.
    fav = scale_to_height(master, 128)
    (ASSETS / "favicon.svg").write_text(svg_wrap(
        "-5 0 62 62", fit_box(fav, 62, 62, 60, x0=-5), webp_uri(fav),
        "‏אייקון הלשונית, ריבועי.",
        extra=' width="48" height="48" role="img" aria-label="שוק הנדל״ן של עפולה והסביבה"'),
        encoding="utf-8")
    print("✓ assets/favicon.svg")

    rebuild_og(master)
    print("\nעכשיו: python3 scripts/build_favicons.py && python3 scripts/build_app_icons.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
