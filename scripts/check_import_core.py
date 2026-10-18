#!/usr/bin/env python3
"""
‏ליבת ייבוא הנכסים - קוד אחד לדפדפן ולשרת, בשני עותקים זהים.

האשף ב-CRM והייבוא דרך גבריאלה בוואטסאפ מריצים את אותו קוד
(‏docs/property-import.md). הוא קיים פעמיים, כי פונקציית Edge אינה יכולה
לייבא קובץ מחוץ ל-‎supabase/functions‎ ו-Netlify אינו מגיש את ‎supabase/‎:

  ‏• ‎assets/property-import-core.js‎ - נטען ב-crm.html (זה העותק שעורכים)
  ‏• ‎supabase/functions/_shared/property-import-core.js‎ - העתק שלו

עותק שנשכח מאחור אינו שובר כלום ואינו נראה: הקובץ נקלט ב-CRM ונקלט
בוואטסאפ, ופשוט אחרת - סוג נכס שזוהה כאן ונדחה שם, הודעה אחרת, שכונה
אחרת. לכן הבדיקה חוסמת שני עותקים שאינם זהים בבית, ומריצה את
‎scripts/property_import_core_test.js‎ (שמשווה גם בין אוצר המילים של
ה-CRM לזה של השרת).

    python scripts/check_import_core.py          # בדיקה
    python scripts/check_import_core.py --fix    # העתקה מ-assets לשרת
"""
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "property-import-core.js"
DST = ROOT / "supabase" / "functions" / "_shared" / "property-import-core.js"
TEST = ROOT / "scripts" / "property_import_core_test.js"


def main() -> int:
    if "--fix" in sys.argv:
        shutil.copyfile(SRC, DST)
        print(f"הועתק: {SRC.relative_to(ROOT)} → {DST.relative_to(ROOT)}")
    if not DST.exists() or SRC.read_bytes() != DST.read_bytes():
        print(
            "✗ שני העותקים של ליבת הייבוא אינם זהים.\n"
            f"  עורכים את {SRC.relative_to(ROOT)} ומעתיקים:\n"
            "    python scripts/check_import_core.py --fix"
        )
        return 1
    if shutil.which("node") is None:
        print("✗ node אינו מותקן - אי אפשר להריץ את בדיקת הליבה")
        return 1
    result = subprocess.run(["node", str(TEST)], cwd=ROOT)
    if result.returncode != 0:
        print("✗ בדיקת ליבת הייבוא נכשלה (הפלט למעלה)")
        return 1
    print("✓ שני העותקים של ליבת הייבוא זהים")
    return 0


if __name__ == "__main__":
    sys.exit(main())
