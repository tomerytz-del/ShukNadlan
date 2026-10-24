#!/usr/bin/env python3
"""
‏ליבת החיפוש - הכללים שהאתר והבוטים חולקים, בשני עותקים זהים.

שורת החיפוש בדף הבית ושני הבוטים בוואטסאפ מחליטים "האם הנכס מתאים" לפי
אותם כללים (‏docs/search-core.md). הקובץ קיים פעמיים, כי פונקציית Edge
אינה יכולה לייבא קובץ מחוץ ל-‎supabase/functions‎ ו-Netlify אינו מגיש את
‎supabase/‎:

  ‏• ‎assets/search-core.js‎ - נטען ב-index.html (זה העותק שעורכים)
  ‏• ‎supabase/functions/_shared/search-core.js‎ - העתק שלו

עותק שנשכח מאחור אינו שובר כלום ואינו נראה: האתר והבוט פשוט מחזירים
נכסים שונים לאותה בקשה. לכן הבדיקה חוסמת שני עותקים שאינם זהים בבית,
ומריצה את ‎scripts/search_core_test.cjs‎ (מול search_feature_cases.json).

    python scripts/check_search_core.py          # בדיקה
    python scripts/check_search_core.py --fix    # העתקה מ-assets לשרת
"""
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "search-core.js"
DST = ROOT / "supabase" / "functions" / "_shared" / "search-core.js"
TEST = ROOT / "scripts" / "search_core_test.cjs"


AGENT = ROOT / "supabase" / "functions" / "whatsapp-webhook" / "agent.ts"


def js_list(src: str, name: str) -> set[str]:
    """המחרוזות במערך `name = [...]` (בלי הערות בפנים)."""
    m = re.search(name + r"\s*=\s*\[(.*?)\];", src, re.S)
    if not m:
        return set()
    pairs = re.findall(r"\"((?:[^\"\\]|\\.)*)\"|'((?:[^'\\]|\\.)*)'", m.group(1))
    return {a or b for a, b in pairs}


def vocab_drift() -> list[str]:
    """‏FEATURE_CODES ו-PTYPE_NAMES בליבה מול רשימות טופס הנכס ב-agent.ts.
    קוד שחסר בליבה יורד מסינון הבוטים כ"לא מוכר" (‏knownFeature), וסוג שחסר
    נרשם כ"מילה שלא זוהתה" - שניהם בשקט, ולכן זו בדיקה ולא הערה."""
    core = SRC.read_text(encoding="utf-8")
    agent = AGENT.read_text(encoding="utf-8")
    out = []
    pairs = [
        ("FEATURE_CODES", js_list(core, "FEATURE_CODES"),
         js_list(agent, "RESIDENTIAL_FEATURES") | js_list(agent, "COMMERCIAL_FEATURES")),
        ("PTYPE_NAMES", js_list(core, "PTYPE_NAMES"),
         js_list(agent, "RESIDENTIAL_PTYPES") | js_list(agent, "COMMERCIAL_PTYPES")),
    ]
    for name, mine, theirs in pairs:
        if not theirs:
            out.append(f"לא נמצאו הרשימות של {name} ב-agent.ts")
            continue
        for v in sorted(theirs - mine):
            out.append(f"{name}: חסר '{v}'")
        for v in sorted(mine - theirs):
            out.append(f"{name}: '{v}' אינו בטופס הנכס")
    return out


def main() -> int:
    if "--fix" in sys.argv:
        shutil.copyfile(SRC, DST)
        print(f"הועתק: {SRC.relative_to(ROOT)} → {DST.relative_to(ROOT)}")
    if not DST.exists() or SRC.read_bytes() != DST.read_bytes():
        print(
            "✗ שני העותקים של ליבת החיפוש אינם זהים.\n"
            f"  עורכים את {SRC.relative_to(ROOT)} ומעתיקים:\n"
            "    python scripts/check_search_core.py --fix"
        )
        return 1
    if shutil.which("node") is None:
        print("✗ node אינו מותקן - אי אפשר להריץ את בדיקת הליבה")
        return 1
    drift = vocab_drift()
    if drift:
        print("✗ אוצר המילים של הליבה אינו תואם לטופס הנכס (agent.ts):")
        for line in drift:
            print("  " + line)
        print("  מאפיין או סוג נכס חדש - גם ב-FEATURE_CODES / PTYPE_NAMES ב-assets/search-core.js")
        return 1
    result = subprocess.run(["node", str(TEST)], cwd=ROOT)
    if result.returncode != 0:
        print("✗ בדיקת ליבת החיפוש נכשלה (הפלט למעלה)")
        return 1
    print("✓ שני העותקים של ליבת החיפוש זהים")
    return 0


if __name__ == "__main__":
    sys.exit(main())
