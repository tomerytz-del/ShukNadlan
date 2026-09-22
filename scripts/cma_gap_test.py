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

# הבלוק השני: השורה שאומרת **על מה** הממוצע נשען. אותה שיטה בדיוק - חילוץ
# מהקוד החי והרצה ב-node - ומאותה סיבה: עותק היה מתיישן בשקט.
#
# מה שהיא מונעת: עד `20261228090000` הממוצע חושב על כל מה שנפל ברדיוס,
# כלומר דירת 5 חדרים הושוותה גם לדירות 3. חמש מתוך 20 המודעות הפעילות
# קיבלו פער בסימן הפוך, ואחת עברה מ-‎+99%‎ ל-‎+2%‎. שני המצבים שבהם הסינון
# **לא** הצליח הם אלה שבהם המספר חוזר להיות מעורבב, ולכן שתיקה שם היא
# בדיוק התקלה הישנה - רק שקטה יותר.
SAMPLE_START = "function cmaSampleNote(cov, radiusUsed){"
SAMPLE_END = "/* ---------- שכבת השוק"

# הבלוק השלישי: שכבת השוק. היא מחזירה **מחירים מבוקשים**, והסיכון היחיד
# שבה הוא שהם ייקראו כמחירי עסקה - בדיוק הערבוב ש-`20261130090000`
# נבנתה כדי למנוע. לכן נבדק שכל נוסח בה אומר זאת, בכל ארבעת המצבים.
MARKET_START = "function cmaMarketNote(cov){"
MARKET_END = "function renderCmaReport(r){"

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

SAMPLE_HARNESS = """
%s
function esc(v){ return String(v ?? ''); }
const out = {};
for (const [name, args] of Object.entries(%s)) out[name] = cmaSampleNote(args[0], args[1]);
console.log(JSON.stringify(out));
"""

# ‏`subject_rooms` מגיע מ-jsonb כמחרוזת ("3.0"), וזה בכוונה בנתוני הבדיקה:
# הצגה גולמית שלו הייתה נותנת "3.0 חדרים", וחיבור פשוט לבנד היה נותן
# "3.00.5 עד ..." במקום "2.5 עד 3.5".
SAMPLE_CASES = {
    # מודעה 1139: 34 עסקאות של 3 חדרים ב-750 מ', 146 נוספות בגודל אחר
    "exact": [{"has_statistics": True, "comparables_found": 34, "rooms_band": 0,
               "subject_rooms": "3.0", "rooms_band_reason": "exact",
               "excluded_other_rooms": 146}, 750],
    # מודעה 1144: 4.5 חדרים, אין ולו עסקה אחת כזו - ירידה ל-‎±0.5‎
    "relaxed": [{"has_statistics": True, "comparables_found": 20, "rooms_band": 0.5,
                 "subject_rooms": "4.5", "rooms_band_reason": "relaxed",
                 "excluded_other_rooms": 35}, 750],
    # מודעה 1083: 8 חדרים, אין בת השוואה בעיר כולה
    "unfiltered": [{"has_statistics": True, "comparables_found": 35, "rooms_band": None,
                    "subject_rooms": "8.0", "rooms_band_reason": "no_similar_rooms",
                    "excluded_other_rooms": 0}, 750],
    # מודעה 1090: לנכס עצמו אין מספר חדרים רשום
    "no_rooms": [{"has_statistics": True, "comparables_found": 175, "rooms_band": None,
                  "subject_rooms": None, "rooms_band_reason": "subject_rooms_missing",
                  "excluded_other_rooms": 0}, 750],
    # אין סטטיסטיקה - אין שורה, בדיוק כמו שאין פער
    "no_stats": [{"has_statistics": False, "status": "insufficient"}, 750],
}

MARKET_HARNESS = """
%s
function esc(v){ return String(v ?? ''); }
const out = {};
for (const [name, args] of Object.entries(%s)) out[name] = cmaMarketNote(args[0]);
console.log(JSON.stringify(out));
"""

MARKET_CASES = {
    # החציון נשען על נכסים שתואמים גם במאפיינים
    "features": [{"market_comparables_total": 9, "market_feature_matched": 4,
                  "market_band_reason": "features", "market_radius_meters": 1000,
                  "min_market_required": 3}],
    # יש מתחרים, אין די תואמי מאפיינים
    "rooms_only": [{"market_comparables_total": 7, "market_feature_matched": 1,
                    "market_band_reason": "rooms_only", "market_radius_meters": 1000,
                    "min_market_required": 3}],
    # לנכס עצמו לא רשומים מאפיינים
    "no_features": [{"market_comparables_total": 7, "market_feature_matched": 0,
                     "market_band_reason": "subject_features_missing",
                     "market_radius_meters": 1000, "min_market_required": 3}],
    # מתחת לסף - אין חציון, רק הרשימה
    "too_few": [{"market_comparables_total": 2, "market_feature_matched": 0,
                 "market_band_reason": "too_few", "market_radius_meters": 1000,
                 "min_market_required": 3}],
    # אין מתחרים בכלל - אין בלוק
    "none": [{"market_comparables_total": 0, "market_band_reason": None}],
}

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

    def run(script):
        res = subprocess.run(["node", "--input-type=module", "-e", script],
                             capture_output=True, text=True)
        if res.returncode != 0:
            print("✗ הרצת הבלוק ב-node נכשלה:\n" + (res.stderr or "").strip())
            return None
        return json.loads(res.stdout)

    def block(start, end, what):
        if start not in src or end not in src:
            print("✗ לא נמצא %s ב-assets/crm.js." % what)
            print("  אם הקוד עבר רפקטור, יש לעדכן את סימני החילוץ כאן —")
            print("  בדיקה שאינה מוצאת את הקוד אינה בדיקה שעוברת.")
            return None
        return src[src.index(start):src.index(end)]

    gap_block = block(START, END, "בלוק הפער")
    sample_block = block(SAMPLE_START, SAMPLE_END, "‏cmaSampleNote")
    market_block = block(MARKET_START, MARKET_END, "‏cmaMarketNote")
    if gap_block is None or sample_block is None or market_block is None:
        return 1

    out = run(HARNESS % (json.dumps(gap_block), json.dumps(CASES, ensure_ascii=False)))
    sample = run(SAMPLE_HARNESS % (sample_block, json.dumps(SAMPLE_CASES, ensure_ascii=False)))
    market = run(MARKET_HARNESS % (market_block, json.dumps(MARKET_CASES, ensure_ascii=False)))
    if out is None or sample is None or market is None:
        return 1

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
        # ---- על מה הממוצע נשען ----
        ("התאמה מדויקת: נאמר מספר החדרים והרדיוס",
         "3 חדרים" in text(sample["exact"]) and "750" in sample["exact"]),
        ("ו-3.0 מה-jsonb מוצג כ-3 ולא כ-3.0",
         "3.0 חדרים" not in text(sample["exact"])),
        ("ומה שנשאר בחוץ בגלל הגודל - נספר ונאמר",
         "146 עסקאות נוספות" in text(sample["exact"])),
        ("בנד מורחב: נאמר שהטווח הורחב ומהו",
         "4 עד 5 חדרים" in text(sample["relaxed"])
         and "בדיוק" in text(sample["relaxed"])),
        ("בלי עסקאות דומות: נאמר שאין סינון, ושהמ\"ר מהימן יותר",
         "אינה מסוננת לפי מספר חדרים" in text(sample["unfiltered"])
         and "למ״ר" in sample["unfiltered"]),
        ("נכס בלי מספר חדרים: הדוח מבקש להשלים אותו",
         "השלימו את מספר החדרים" in text(sample["no_rooms"])),
        ("ואינו מתיימר שההשוואה סוננה",
         "אינה מסוננת לפי מספר חדרים" in text(sample["no_rooms"])),
        ("בלי has_statistics - אין שורת מדגם בכלל",
         sample["no_stats"].strip() == ""),
        # ---- שכבת השוק: מחיר מבוקש, ולעולם לא כמחיר עסקה ----
        ("כל מצב בשכבת השוק אומר שאלה מחירים מבוקשים",
         all("מחירים מבוקשים" in text(market[k])
             for k in ("features", "rooms_only", "no_features", "too_few"))),
        ("ושכולם אינם נכנסים לממוצע שלמעלה",
         all("אינם נכנסים לממוצע" in text(market[k])
             for k in ("features", "rooms_only", "no_features", "too_few"))),
        ("התאמת מאפיינים: נאמר על כמה נכסים החציון נשען",
         "4" in text(market["features"]) and "במאפיינים" in text(market["features"])),
        ("אין די תואמים: נאמר שהחציון נשען על חדרים בלבד",
         "לא נמצאו די נכסים שתואמים גם במאפיינים" in text(market["rooms_only"])),
        ("נכס בלי מאפיינים: הדוח מבקש לסמן אותם",
         "בכרטיס הנכס" in text(market["no_features"])),
        ("מתחת לסף: **אין** חציון, ונאמר למה",
         "אין כאן חציון" in text(market["too_few"])),
        ("אין מתחרים בכלל - אין בלוק שוק",
         market["none"].strip() == ""),
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
