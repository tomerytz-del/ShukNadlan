#!/usr/bin/env python3
"""שני מספרי הפער בדוח ה-CMA - הבדיקה רצה על הקוד עצמו.

**מה שהיא מונעת, והוא כבר קרה.** ‏`Number(null)` ב-JavaScript הוא **0**
ולא `NaN`, ולכן הבדיקה `Number.isFinite(a)` לבדה אינה תופסת אותו. נכס
בלי שטח מקבל `price_per_sqm: null` מ-`agent_cma_report` (העמודה היא
`case when v_subject_size > 0 ...`), ו-`jsonb_build_object` מחזיר את
המפתח **עם `null`** ולא משמיט אותו - כלומר `undefined`, שהיה נותן
`NaN`, אינו מגיע לשם לעולם.

התוצאה הייתה **"המחיר המבוקש למ״ר: נמוך ב-100% מהממוצע"** - מספר מומצא
שנקרא כממצא, על מודעות אמיתיות. ‏2 מתוך 31 המודעות הפעילות למכירה.

זה בדיוק סוג המספר שסעיף *מדידה* ב-CLAUDE.md מתאר: הדוח נטען, נראה
תקין, אין שגיאה בקונסול, והמספר פשוט שגוי.

**הבדיקה רצה על הקוד ב-`assets/crm.js` עצמו**, לא על עותק: היא חולצת
את הבלוק מהקובץ ומריצה אותו ב-node עם מטען שהוא **הפלט האמיתי** של
`agent_cma_report` על מודעה #1139. עותק היה מתיישן בשקט.

    python3 scripts/cma_gap_test.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CRM = ROOT / "assets" / "crm.js"

START = "  const cmaGapPct = (ask, avg) => {"
END = "  const compRows = comps.map("

# הפלט האמיתי של agent_cma_report על מודעה #1139 (עלייה 7, עפולה),
# הועתק משאילתת אימות מול הפרודקשן ב-21.9.2026. 80 מ"ר ב-1,320,000 ₪
# מול ממוצע 1,243,389 ₪ ו-11,406 ₪ למ"ר ב-180 עסקאות ברדיוס 750 מ'.
REAL = {
    "subject": {"price": "1320000.00", "price_per_sqm": "16500"},
    "stats": {"avg_price": "1243389", "avg_price_per_sqm": "11406",
              "comparables_count": "180", "sqm_sample_size": "180"},
}

HARNESS = """
const BLOCK = %s;
function esc(v){ return String(v ?? ''); }
function render(s, st, hasStats){ return eval(BLOCK + '; gapNote'); }
const out = {};
for (const [name, args] of Object.entries(%s)) {
  out[name] = render(args[0], args[1], args[2]);
}
console.log(JSON.stringify(out));
"""

CASES = {
    # (subject, stats, hasStats)
    "real": [REAL["subject"], REAL["stats"], True],
    # פערים קרובים - שורת ההסבר מיותרת ואסור שתופיע
    "near": [{"price": 1000000, "price_per_sqm": 10000},
             {"avg_price": 950000, "avg_price_per_sqm": 9500,
              "comparables_count": 12, "sqm_sample_size": 12}, True],
    # **הבאג**: נכס בלי שטח. price_per_sqm הוא null מפורש מה-jsonb.
    "no_size": [{"price": 1000000, "price_per_sqm": None},
                {"avg_price": 950000, "avg_price_per_sqm": 9500,
                 "comparables_count": 12, "sqm_sample_size": 12}, True],
    # אין סטטיסטיקה - אין פער בכלל, בשום צורה
    "no_stats": [REAL["subject"], {}, False],
    # מדגם מ"ר קטן מהמדגם הכולל - כל שורה נושאת את המספר שלה
    "small_sqm": [{"price": 1000000, "price_per_sqm": 10000},
                  {"avg_price": 800000, "avg_price_per_sqm": 9500,
                   "comparables_count": 40, "sqm_sample_size": 7}, True],
}


def main() -> int:
    if not shutil.which("node"):
        print("✗ ‏node אינו מותקן, ואי אפשר להריץ את הקוד האמיתי.")
        print("  הבדיקה הזו קיימת בדיוק כדי לא לבדוק עותק, ולכן היא נכשלת")
        print("  ואינה מדלגת.")
        return 1

    src = CRM.read_text(encoding="utf-8")
    if START not in src or END not in src:
        print("✗ לא נמצא בלוק הפער ב-assets/crm.js.")
        print("  אם הקוד עבר רפקטור, יש לעדכן את המחרוזות START/END כאן —")
        print("  בדיקה שאינה מוצאת את הקוד אינה בדיקה שעוברת.")
        return 1
    block = src[src.index(START):src.index(END)]

    script = HARNESS % (json.dumps(block), json.dumps(CASES, ensure_ascii=False))
    res = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True)
    if res.returncode != 0:
        print("✗ הרצת הבלוק ב-node נכשלה:\n" + (res.stderr or "").strip())
        return 1
    out = json.loads(res.stdout)

    def text(html: str) -> str:
        import re
        return re.sub(r"<[^>]+>", " ", html)

    bad = 0
    checks = [
        ("שתי השורות מופיעות על נכס אמיתי",
         "המחיר המבוקש הכולל" in out["real"] and "המחיר המבוקש למ" in out["real"]),
        ("ושני המספרים שונים זה מזה (6% מול 45%)",
         "6%" in out["real"] and "45%" in out["real"]),
        ("כל שורה נושאת את מספר העסקאות שמאחוריה",
         text(out["real"]).count("180 עסקאות") == 2),
        ("פער גדול בין השניים מקבל שורת הסבר",
         "שני המספרים רחוקים זה מזה" in out["real"]),
        ("פערים קרובים - בלי שורת הסבר מיותרת",
         "שני המספרים רחוקים" not in out["near"]),
        # ---- הבאג עצמו ----
        ("נכס בלי שטח: **אין** שורת מ\"ר",
         "המחיר המבוקש למ" not in out["no_size"]),
        ("נכס בלי שטח: **אין** אחוז מומצא",
         "100%" not in out["no_size"]),
        ("נכס בלי שטח: יש הסבר למה אין מספר",
         "אין שטח רשום לנכס" in out["no_size"]),
        ("בלי has_statistics - אין פער בכלל",
         out["no_stats"].strip() == ""),
        ("מדגם מ\"ר קטן יותר מדווח בנפרד",
         "40 עסקאות" in text(out["small_sqm"])
         and "7 עסקאות" in text(out["small_sqm"])),
    ]
    for name, ok in checks:
        bad += not ok
        print(("  ✓  " if ok else "  ✗  ") + name)

    if bad:
        print("\n✗ %d כשלים." % bad)
        return 1
    print("\n✓ הדוח מציג את שני המספרים, וכל אחד מהם נשען על נתון שקיים.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
