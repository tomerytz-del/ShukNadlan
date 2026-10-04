#!/usr/bin/env python3
"""
‏בדיקה שכל הודעת פתיחה שהאתר ממלא לגבריאלה מזוהה כ"הגיע/ה מהאתר".

## הבעיה

‏הפאנל "פניות לגבריאלה" ב-crm סופר כמה פונים שאינם סוכנים הגיעו מהאתר.
‏wa.me אינו מעביר שום פרמטר מלבד הטקסט, ולכן ‏`siteEntryOf()` ב-
‏`whatsapp-webhook/index.ts` מזהה את המקור לפי ביטוי בהודעת הפתיחה
(‏"הגעתי מדף הבית", "חיפשתי באתר", "הגעתי מהאתר").

ניסוח מחדש של הודעה באתר, בלי לעדכן את הרשימה, אינו שובר כלום: הכפתור
עובד, גבריאלה עונה - ו**כל** הפניות מאותו כפתור עוברות בשקט ל-"direct".
המספר בפאנל יורד, ונראה כאילו הכפתור הפסיק לעבוד.

## מה נבדק

  ‏1. כל הודעת פתיחה ב-‏`assets/home.js` וב-‏`assets/bot-link.js`
     (‏`*_HELLO = '...'` ו-‏`draw('...')`) מכילה ביטוי מ-‏`SITE_ENTRY_PHRASES`.
  ‏2. כל קריאה ל-‏`ShukBot.link(` / ‏`ShukBot.anchorHtml(` בקובץ JS או HTML
     מקבלת הודעה שנבדקה בסעיף 1 (משתנה מוכר או מחרוזת שמכילה ביטוי).
  ‏3. כל ביטוי מופיע גם במילוי למפרע שבמיגרציה ‏20270214090000.

    python scripts/check_bot_entry.py

הפרטים: docs/whatsapp-public-bot.md, "כמה פניות מגיעות מהאתר".
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEBHOOK = ROOT / "supabase/functions/whatsapp-webhook/index.ts"
MIGRATION = ROOT / "supabase/migrations/20270214090000_whatsapp_public_entry.sql"
HELLO_FILES = [ROOT / "assets/home.js", ROOT / "assets/bot-link.js"]

# משתנים שמחזיקים הודעת פתיחה ונבדקים בסעיף 1. ‏`hello` הוא הפרמטר של
# ‏`draw()` ב-renderEmptyBotLink, ושני הערכים שלו נבדקים שם.
KNOWN_HELLO_VARS = {"GAB_HELLO", "hello"}

# ‏bot-link.js מגדיר את ShukBot ואת הקישור עצמו - הקריאות שבו אינן נקודת כניסה
SKIP_CALLS_IN = {"assets/bot-link.js"}


def phrases() -> list[str]:
    src = WEBHOOK.read_text(encoding="utf-8")
    block = re.search(r"SITE_ENTRY_PHRASES[^=]*=\s*\[(.*?)\];", src, re.S)
    if not block:
        sys.exit(f"לא נמצא SITE_ENTRY_PHRASES ב-{WEBHOOK.relative_to(ROOT)}")
    found = re.findall(r'\[\s*"([^"]+)"\s*,\s*"[a-z_]+"\s*\]', block.group(1))
    if not found:
        sys.exit("SITE_ENTRY_PHRASES ריק")
    return found


def main() -> int:
    errors: list[str] = []
    ph = phrases()

    def matches(text: str) -> bool:
        return any(p in text for p in ph)

    hellos = 0
    for f in HELLO_FILES:
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"(?:\b\w*HELLO\s*=\s*|\bdraw\(\s*)'([^']*)'", src):
            hellos += 1
            if not matches(m.group(1)):
                line = src.count("\n", 0, m.start()) + 1
                errors.append(
                    f"{f.relative_to(ROOT)}:{line}: הודעת הפתיחה '{m.group(1)}' אינה מכילה "
                    f"אף ביטוי מ-SITE_ENTRY_PHRASES ({', '.join(ph)}) - הפניות ממנה ייספרו direct.")
    # רצפה: אם הניתוח מפספס הכול, "אפס שגיאות" אינו אומר דבר
    if hellos < 3:
        errors.append(f"נמצאו רק {hellos} הודעות פתיחה (צפויות לפחות 3) - הבדיקה כבר אינה רואה את הקוד.")

    files = [p for p in ROOT.glob("*.html")] + list((ROOT / "assets").glob("*.js"))
    for f in files:
        rel = str(f.relative_to(ROOT))
        if rel in SKIP_CALLS_IN:
            continue
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"ShukBot\.(?:link|anchorHtml)\(\s*([^,)]*)", src):
            arg = m.group(1).strip()
            lit = re.fullmatch(r"'([^']*)'|\"([^\"]*)\"", arg)
            ok = (arg in KNOWN_HELLO_VARS) or (lit and matches(lit.group(1) or lit.group(2) or ""))
            if not ok:
                line = src.count("\n", 0, m.start()) + 1
                errors.append(
                    f"{rel}:{line}: קישור לגבריאלה עם הודעת פתיחה '{arg}' שהבדיקה אינה מכירה. "
                    f"ההודעה חייבת להכיל ביטוי מ-SITE_ENTRY_PHRASES, ואם היא במשתנה חדש - "
                    f"להוסיף אותו ל-KNOWN_HELLO_VARS ולבדוק אותו.")

    mig = MIGRATION.read_text(encoding="utf-8")
    for p in ph:
        if f"'%{p}%'" not in mig:
            errors.append(f"{MIGRATION.relative_to(ROOT)}: הביטוי '{p}' חסר במילוי למפרע.")

    if errors:
        print("הודעות הפתיחה לגבריאלה אינן מזוהות כהגעה מהאתר:\n")
        for e in errors:
            print("  - " + e)
        print("\nהפרטים: docs/whatsapp-public-bot.md, \"כמה פניות מגיעות מהאתר\".")
        return 1
    print(f"OK - {hellos} הודעות פתיחה, {len(ph)} ביטויים.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
