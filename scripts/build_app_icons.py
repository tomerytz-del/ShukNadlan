#!/usr/bin/env python3
"""
‏בניית אייקוני האפליקציה (PWA) מהלוגו.

## למה סקריפט ולא קובץ שמצויר ביד

אייקון האפליקציה הוא **PNG**: גם מנשק ההתקנה של כרום וגם מסך הבית של
אייפון אינם מקבלים SVG. הוא נבנה מ-‎assets/logo-shuknadlan.png‎ (הרינדור
התלת־ממדי של הלוגו, שנכתב ב-‎scripts/build_logo.py‎), כדי ששינוי בלוגו
יהיה הרצה ולא ציור:

    python3 scripts/build_logo.py
    python3 scripts/build_app_icons.py

הפלט נכתב ל-‎assets/‎ ונכנס לגיט (‏Netlify מפרסם קבצים סטטיים, אין שלב
בנייה בפרסום — מה שלא בריפו לא קיים באתר).

עד 24.10.2026 הסקריפט צייר את הסמל השטוח מהגאומטריה שלו ב-cairosvg, ודרש
את הגופן Heebo מותקן. הלוגו החדש הוא רינדור ואין לו וקטור, ולכן שתי
התלויות ירדו.

## למה שתי משפחות של אייקונים

‏`any` — האייקון כמו שהוא. אנדרואיד מציג אותו בתוך המסגרת של המשגר.
‏`maskable` — אנדרואיד **חותך** ממנו צורה (עיגול, ריבוע מעוגל, טיפה),
ומבטיח רק את 80% המרכזיים. אייקון ללא גרסת maskable מקבל מהמערכת ריבוע
לבן עם האייקון המוקטן בתוכו ("letterboxing"), ואייקון שנבנה כ-maskable
בלבד ייראה קטן מדי במקומות שלא חותכים. לכן שניהם, ובהם אותו ציור בשני
שיעורי הגדלה שונים.

‏`apple-touch-icon` — אייפון. שם אין maskable ואין שקיפות (רקע שקוף
הופך לשחור), והמערכת מעגלת את הפינות בעצמה.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "logo-shuknadlan.png"

# הרקע: לבן במרכז ונייר תכלכל בקצוות — אותה פלטה של האתר (‎--paper‎
# ו-‎--teal-tint‎), ולא לבן שטוח. הגוון בקצוות הוא מה שמפריד את האייקון
# מרקע לבן של מסך בית בהיר, בלי להוסיף מסגרת.
PAPER = (255, 255, 255)
PAPER_EDGE = (230, 237, 250)
BRASS = (201, 162, 39)


def radial(size: int, cx: float, cy: float, r: float) -> np.ndarray:
    """מרחק מנורמל מהמרכז (‏0 במרכז, 1 ברדיוס), חתוך ל-1."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    d = np.hypot(xx - cx * size, yy - cy * size) / (r * size)
    return np.clip(d, 0, 1)[..., None]


def background(size: int) -> Image.Image:
    t = radial(size, 0.5, 0.34, 0.78)
    bg = np.array(PAPER) * (1 - t) + np.array(PAPER_EDGE) * t
    # הילה זהובה חלשה מאחורי הפין
    g = (1 - radial(size, 0.5, 0.42, 0.62)) * 0.16
    bg = bg * (1 - g) + np.array(BRASS) * g
    return Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def icon(logo: Image.Image, size: int, logo_height_ratio: float) -> Image.Image:
    """אייקון ריבועי: רקע נייר בהיר, והלוגו במרכזו עם צל רך מתחתיו.

    ‏logo_height_ratio הוא הגובה של הלוגו כשבר מצלע הריבוע. הוא הפרמטר
    היחיד שמבדיל בין `any` ל-`maskable`: ב-maskable הלוגו קטן יותר, כדי
    שכל מה שנחתך יהיה רקע.
    """
    h = round(size * logo_height_ratio)
    w = round(logo.width * h / logo.height)
    pin = logo.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
    x, y = (size - w) // 2, (size - h) // 2

    out = background(size)
    # הצל: אותה צללית, כחולה-כהה, מוזזת מעט למטה ומטושטשת. הרינדור המקורי
    # ישב על צל, ובלעדיו הפין נראה מודבק על הרקע.
    shadow = Image.new("RGBA", (size, size), (14, 42, 107, 0))
    a = Image.new("L", (size, size), 0)
    a.paste(pin.getchannel("A"), (x, y + round(size * 0.02)))
    a = a.filter(ImageFilter.GaussianBlur(size * 0.025)).point(lambda v: int(v * 0.35))
    shadow.putalpha(a)
    out.alpha_composite(shadow)
    out.alpha_composite(pin, (x, y))
    return out.convert("RGB")


# שם הקובץ → (גודל בפיקסלים, שיעור הגובה של הלוגו)
#
# ‏0.72 ל-`any`: הלוגו ממלא את האייקון, כמו כל אייקון אפליקציה.
# ‏0.52 ל-`maskable`: הלוגו כולו בתוך 80% המרכזיים, גם כשהמערכת חותכת עיגול.
# ‏0.62 ל-apple: אייפון מעגל פינות בלבד, ולכן צריך פחות שוליים מ-maskable.
TARGETS = {
    "icon-192.png": (192, 0.72),
    "icon-512.png": (512, 0.72),
    "icon-maskable-192.png": (192, 0.52),
    "icon-maskable-512.png": (512, 0.52),
    "apple-touch-icon.png": (180, 0.62),
}


def main() -> int:
    src = Image.open(SOURCE).convert("RGBA")
    # החיתוך הדוק לפין: ב-PNG של 512×610 יש שוליים שקופים
    logo = src.crop(src.getchannel("A").getbbox())

    for name, (size, ratio) in TARGETS.items():
        out = ASSETS / name
        # אטום (‏RGB) בכוונה: שקיפות במסך הבית של אייפון הופכת לשחור.
        icon(logo, size, ratio).save(out, format="PNG", optimize=True)
        print("✓ %s  (%dx%d)" % (out.relative_to(ROOT), size, size))

    print("\nהאייקונים נבנו. ‏git add assets/*.png — בלי זה הם לא יגיעו לאתר.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
