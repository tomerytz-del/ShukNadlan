#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקת טיפוסים ל-Edge Functions, כמחגר (ratchet) ולא כשער.

## למה הבדיקה הזו קיימת

‏`supabase functions deploy` אינה מריצה בדיקת טיפוסים: היא מאגדת את הקוד
ופורסת. כלומר שדה ש-`select` לא טען, `null` שלא נבדק או שם פונקציה שהוקלד
לא נכון עוברים עד הפרודקשן, ושם הם נראים כמו "הבוט לא ענה".

בזמן שהבדיקה נכתבה (26.9.2026) נמדדו 46 פונקציות נקיות לגמרי ו-14 עם
שגיאות, רובן בקבצים ישנים שנכתבו כ-JS בתוך `.ts` (בעיקר
`_shared/afula-planning.ts`, שנספר בכל פונקציה שמייבאת אותו).

## למה מחגר ולא "אפס שגיאות"

בדיקה שנכשלת מהיום הראשון היא בדיקה שמכבים. במקום זה, `edge_types_baseline.json`
רושם כמה שגיאות יש היום לכל פונקציה:

  • ‏**פונקציה שאינה ברשימה חייבת להיות על אפס.** זה רוב הפונקציות, וכל
    פונקציה חדשה נולדת כך.
  • ‏**עלייה מעל הרשום נכשלת.** קוד חדש אינו מוסיף שגיאות, גם בקובץ ישן.
  • ‏**ירידה אינה נכשלת**, אבל מודפסת עם הפקודה לעדכון - כדי שהרף יירד
    באותו PR שתיקן, ולא יחזיר את השגיאות בשקט בפעם הבאה.

## מה היא לא יודעת

המספרים תלויים בגרסת Deno ובגרסאות התלויות (`jsr:@supabase/supabase-js@2`
אינה נעולה לגרסה מדויקת). לכן גרסת Deno נעולה ב-workflow, ועלייה שאינה
קשורה ל-diff היא קודם כול שאלה על גרסה.

    python3 scripts/check_edge_types.py            # בדיקה
    python3 scripts/check_edge_types.py --update   # כתיבת הרף מחדש
    python3 scripts/check_edge_types.py whatsapp-webhook   # פונקציה אחת
"""
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCS = os.path.join(ROOT, "supabase", "functions")
BASELINE = os.path.join(ROOT, "scripts", "edge_types_baseline.json")
DENO = os.environ.get("DENO", "deno")

ANSI = re.compile(r"\x1b\[[0-9;]*m")
TS_ERROR = re.compile(r"^TS\d+ \[ERROR\]")


def functions():
    out = []
    for name in sorted(os.listdir(FUNCS)):
        if name.startswith("_"):
            continue
        if os.path.isfile(os.path.join(FUNCS, name, "index.ts")):
            out.append(name)
    return out


def check(name):
    """מחזירה (שם, מספר שגיאות, פלט). ‏None = הבדיקה עצמה לא רצה."""
    entry = os.path.join("supabase", "functions", name, "index.ts")
    proc = subprocess.run(
        [DENO, "check", entry], cwd=ROOT,
        capture_output=True, text=True, env={**os.environ, "NO_COLOR": "1"},
    )
    text = ANSI.sub("", proc.stdout + proc.stderr)
    count = sum(1 for line in text.splitlines() if TS_ERROR.match(line))
    # יציאה שאינה אפס בלי אף שגיאת TS היא כשל של הכלי (רשת, תלות שלא
    # נפתרה, תחביר) - ולא "אפס שגיאות". אסור שזה ייספר כהצלחה.
    if proc.returncode != 0 and count == 0:
        return name, None, text
    return name, count, text


def main(argv):
    update = "--update" in argv
    only = [a for a in argv if not a.startswith("-")]

    try:
        with open(BASELINE, encoding="utf-8") as f:
            baseline = json.load(f)
    except FileNotFoundError:
        baseline = {}

    names = only or functions()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, names))

    broken = [(n, t) for n, c, t in results if c is None]
    if broken:
        for n, t in broken:
            print(f"✗ {n}: deno check לא רץ עד הסוף (לא שגיאת טיפוס)\n{t[-2000:]}\n")
        return 1

    counts = {n: c for n, c, _ in results}

    if update:
        merged = dict(baseline) if only else {}
        merged.update({n: c for n, c in counts.items() if c})
        for n, c in counts.items():
            if not c:
                merged.pop(n, None)
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(merged.items())), f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"הרף נכתב: {len(merged)} פונקציות עם שגיאות, "
              f"{sum(merged.values())} בסך הכול.")
        return 0

    worse, better = [], []
    for n, c in counts.items():
        allowed = baseline.get(n, 0)
        if c > allowed:
            worse.append((n, c, allowed))
        elif c < allowed:
            better.append((n, c, allowed))

    # פונקציה שנמחקה ונשארה ברף: לא כשל, אבל רף שמחזיק שם מת הוא רף שקר.
    stale = [n for n in baseline if not only and n not in counts]

    for n, c, allowed in better:
        print(f"↓ {n}: {c} שגיאות (הרף {allowed}). כדאי להוריד את הרף באותו PR: "
              f"python3 scripts/check_edge_types.py --update")
    for n in stale:
        print(f"? {n}: ברף אבל אין פונקציה כזו. להריץ --update.")

    if worse:
        for n, c, allowed in worse:
            print(f"\n✗ {n}: {c} שגיאות טיפוס, הרף {allowed}.")
            _, _, text = next(r for r in results if r[0] == n)
            print(text[-4000:])
        print("\nקוד חדש אינו מוסיף שגיאות טיפוס. לתקן, או - אם העלייה אינה "
              "מה-diff (גרסת Deno או תלות) - לבדוק את הגרסאות לפני שמעדכנים את הרף.")
        return 1

    total = sum(counts.values())
    print(f"✓ {len(counts)} פונקציות, {total} שגיאות קיימות, אף אחת חדשה.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
