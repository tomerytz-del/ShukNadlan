#!/usr/bin/env python3
"""
‏בניית אייקוני האפליקציה (PWA) מהגאומטריה של הלוגו.

## למה סקריפט ולא קובץ שמצויר ביד

הסמל של האתר קיים כבר בשלושה קובצי SVG — ‎assets/logo-shuknadlan.svg‎,
‏‎logo-shuknadlan-dark.svg‎ ו-‎favicon.svg‎ — ואותה גאומטריה בדיוק (הפין,
הגג, האות ש) מופיעה בשלושתם. אייקון האפליקציה הוא המופע הרביעי שלה,
והפעם כ-**PNG**: גם מנשק ההתקנה של כרום וגם מסך הבית של אייפון אינם
מקבלים SVG.

‏PNG שצויר ידנית פעם אחת הוא עותק שאיש לא יכול לעדכן: מי שישנה את הלוגו
מחר יעדכן שלושה קובצי SVG, ואת ה-PNG-ים לא — כי אין לו/ה במה. הסקריפט
הזה הוא ה"במה": הגאומטריה כתובה כאן פעם אחת, וכל האייקונים נבנים ממנה.

**שינוי בלוגו נכנס גם לכאן**, ואז מריצים:

    pip install cairosvg
    python3 scripts/build_app_icons.py

הפלט נכתב ל-‎assets/‎ ונכנס לגיט (‏Netlify מפרסם קבצים סטטיים, אין שלב
בנייה בפרסום — מה שלא בריפו לא קיים באתר).

## הגופן

האות ש היא טקסט ב-Heebo ExtraBold, אותו גופן שהאתר טוען. ‏cairosvg מרנדר
טקסט דרך הגופנים המותקנים במכונה, ולכן לפני ההרצה צריך ש-Heebo יהיה
מותקן — אחרת cairo ייפול לגופן ברירת מחדל והאות תיראה אחרת מהלוגו:

    curl -L -o ~/.fonts/Heebo-ExtraBold.ttf \\
      "https://fonts.gstatic.com/s/heebo/v28/NGSpv5_NC0k9P_v6ZUCbLRAHxK1ECSuccg.ttf"
    fc-cache -f

הסקריפט בודק שהגופן נמצא ונעצר אם לא. אייקון שנבנה בגופן אחר לא ייראה
שבור — הוא רק לא יהיה הלוגו, ואת זה מגלים אחרי שהוא כבר על מסך הבית של
אנשים.

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

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# ---------------------------------------------------------------------------
# הגאומטריה — מועתקת מ-assets/logo-shuknadlan.svg (פין ספיר, גג לבן,
# ‏ש מוזהבת). זו הווריאציה לרקע בהיר, כי הרקע של האייקון הוא נייר בהיר.
# תיבת הציור המקורית היא 52×62.
# ---------------------------------------------------------------------------
LOGO_W, LOGO_H = 52.0, 62.0
PIN_PATH = "M26 60 C26 60 48 38 48 24 C48 11.8 38.2 2 26 2 C13.8 2 4 11.8 4 24 C4 38 26 60 26 60 Z"
ROOF_PATH = "M13 26 L26 14 L39 26"

SAPPHIRE = "#0e2a6b"
BRASS = "#c9a227"

# הרקע: לבן במרכז ונייר תכלכל בקצוות — אותה פלטה של האתר (‎--paper‎
# ו-‎--teal-tint‎), ולא לבן שטוח. הגוון בקצוות הוא מה שמפריד את האייקון
# מרקע לבן של מסך בית בהיר, בלי להוסיף מסגרת.
PAPER = "#ffffff"
PAPER_EDGE = "#e6edfa"

FONT_STACK = "Heebo, sans-serif"


def icon_svg(size: int, logo_height_ratio: float) -> str:
    """‏SVG של אייקון ריבועי: רקע נייר בהיר, והלוגו הספירי במרכזו.

    ‏logo_height_ratio הוא הגובה של הלוגו כשבר מצלע הריבוע. הוא הפרמטר
    היחיד שמבדיל בין `any` ל-`maskable`: ב-maskable הלוגו קטן יותר, כדי
    שכל מה שנחתך יהיה רקע.
    """
    scale = (size * logo_height_ratio) / LOGO_H
    dx = (size - LOGO_W * scale) / 2
    dy = (size - LOGO_H * scale) / 2
    # רדיוס ההילה נגזר מהגודל כדי שהאייקון ייראה זהה בכל הרזולוציות.
    glow = size * 0.62

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}"
     viewBox="0 0 {size} {size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="78%">
      <stop offset="0%" stop-color="{PAPER}"/>
      <stop offset="100%" stop-color="{PAPER_EDGE}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="{BRASS}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="{BRASS}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{size}" height="{size}" fill="url(#bg)"/>
  <circle cx="{size * 0.5:.2f}" cy="{size * 0.42:.2f}" r="{glow:.2f}" fill="url(#glow)"/>
  <g transform="translate({dx:.3f} {dy:.3f}) scale({scale:.5f})">
    <path d="{PIN_PATH}" fill="{SAPPHIRE}"/>
    <path d="{ROOF_PATH}" fill="none" stroke="#ffffff" stroke-width="5"
          stroke-linejoin="miter" stroke-linecap="butt"/>
    <text x="26" y="41" text-anchor="middle" fill="{BRASS}"
          font-family="{FONT_STACK}" font-weight="800" font-size="18">ש</text>
  </g>
</svg>"""


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


def heebo_installed() -> bool:
    if not shutil.which("fc-list"):
        return True  # אין fontconfig — אי אפשר לבדוק, וההערה בתיעוד תצטרך להספיק
    out = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
    return "heebo" in out.lower()


def main() -> int:
    try:
        import cairosvg  # noqa: PLC0415  — תלות של הסקריפט בלבד, לא של האתר
    except ImportError:
        print("חסר cairosvg. התקנה:  pip install cairosvg")
        return 1

    if not heebo_installed():
        print(
            "‏Heebo אינו מותקן במכונה. בלעדיו האות ש תרונדר בגופן אחר,\n"
            "והאייקון ייראה כמעט נכון — וזה הסוג הגרוע. ההתקנה:\n\n"
            "  mkdir -p ~/.fonts && curl -L -o ~/.fonts/Heebo-ExtraBold.ttf \\\n"
            '    "https://fonts.gstatic.com/s/heebo/v28/'
            'NGSpv5_NC0k9P_v6ZUCbLRAHxK1ECSuccg.ttf"\n'
            "  fc-cache -f"
        )
        return 1

    for name, (size, ratio) in TARGETS.items():
        out = ASSETS / name
        cairosvg.svg2png(
            bytestring=icon_svg(size, ratio).encode("utf-8"),
            write_to=str(out),
            output_width=size,
            output_height=size,
        )
        print("✓ %s  (%dx%d)" % (out.relative_to(ROOT), size, size))

    print("\nהאייקונים נבנו. ‏git add assets/*.png — בלי זה הם לא יגיעו לאתר.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
