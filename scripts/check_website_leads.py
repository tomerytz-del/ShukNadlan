#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקות שקטות סביב לידים באתר.

1. ב-property.html, ילדי .sidebar אינם מתכווצים. בלי flex-shrink:0 כרטיס
   הפנייה במחשב (מ-980px, עמודה דביקה עם max-height) קורס לגובה של שורה
   והטופס נגזר. המובייל אינו flex, אז הכלל שם לא משנה פריסה.
2. for-brokers.html ו-brokers.html טוענים את visit-attr.js במסמך, לא רק
   דרך ההזרקה המאוחרת של events.js.
3. agency-signup.html דוחף sign_up רק אחרי הצלחה אמיתית, עם method ו-role,
   ובלי פרטים אישיים.
4. מיגרציית is_demo מסמנת את משרד ההדגמה ומוציאה אותו משלושת דוחות הפלטפורמה.

    python3 scripts/check_website_leads.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    problems: list[str] = []

    prop = (ROOT / "property.html").read_text(encoding="utf-8")
    rule = re.search(r"\.sidebar > \*\{[^}]*\}", prop)
    if not rule or "flex-shrink:0" not in rule.group(0):
        problems.append(
            "property.html: חסר flex-shrink:0 על .sidebar > * "
            "(כרטיס הפנייה קורס במחשב)."
        )
    if "max-height:calc(100dvh-24px)" not in prop.replace(" ", ""):
        problems.append("property.html: חסר max-height הדביק של .sidebar מ-980px.")

    for name in ("for-brokers.html", "brokers.html"):
        text = (ROOT / name).read_text(encoding="utf-8")
        if 'src="assets/visit-attr.js"' not in text and "src='/assets/visit-attr.js'" not in text:
            problems.append(f"{name}: חסר assets/visit-attr.js.")

    signup = (ROOT / "agency-signup.html").read_text(encoding="utf-8")
    if "if (res.ok && data.success) trackOfficeSignup();" not in signup:
        problems.append("agency-signup.html: sign_up אינו נדחף רק אחרי הצלחה.")
    call = re.search(r"shukTrack\(\s*'sign_up'\s*,\s*\{([^}]*)\}\s*\)", signup)
    push = re.search(r"dataLayer\.push\(\s*\{([^}]*)\}\s*\)", signup)
    blob = " ".join(x.group(1) for x in (call, push) if x)
    if "method" not in blob or "role" not in blob:
        problems.append("agency-signup.html: ל-sign_up חסרים method ו-role.")
    if re.search(r"sign_up[\s\S]{0,240}(email|phone|name)\s*:", signup) and "method: 'email'" not in signup:
        problems.append("agency-signup.html: sign_up נושא פרט אישי.")
    # חסימת הרישיון חוזרת לפני הדחיפה
    block = signup.find("license_not_verified")
    track = signup.find("trackOfficeSignup();")
    if block < 0 or track < 0 or not (block < track):
        problems.append("agency-signup.html: דחיפת sign_up אינה אחרי דחיית הרישיון.")

    migs = sorted((ROOT / "supabase/migrations").glob("*demo_agencies_out_of_reports.sql"))
    if len(migs) != 1:
        problems.append("חסרה מיגרציה אחת בשם demo_agencies_out_of_reports.")
    else:
        sql = migs[0].read_text(encoding="utf-8")
        if "add column if not exists is_demo boolean not null default false" not in sql:
            problems.append(f"{migs[0].name}: חסרה עמודת is_demo.")
        if "cf863e10-c25d-41ed-8b22-d6899a56e95d" not in sql or "demo-office-play-review" not in sql:
            problems.append(f"{migs[0].name}: משרד ההדגמה לא מסומן.")
        for fn in ("platform_lead_report", "platform_admin_monthly_report", "platform_inventory_report"):
            if f"function public.{fn}(" not in sql or "agency_is_demo" not in sql:
                problems.append(f"{migs[0].name}: {fn} לא הוגדר מחדש בלי משרדי הדגמה.")
        if "is_platform_admin)," not in sql.replace(" ", ""):
            problems.append(f"{migs[0].name}: ספירת מנהלי הפלטפורמה השתנתה.")

    if problems:
        print("✗ לידים באתר")
        for p in problems:
            print("  - " + p)
        return 1
    print("✓ כרטיס הפנייה, ייחוס הביקור, sign_up ומשרדי ההדגמה בדוחות.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
