#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""סוג התראה חדש נוסף לאילוץ הקיים, ולא כותב אותו מחדש.

`notifications_type_check` הוא רשימה סגורה של סוגי ההתראה, וכל סוג חדש
החליף אותה במלואה:

    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications add constraint notifications_type_check
      check (type in ('new_lead', 'system', ..., 'הסוג_שלי'));

זה עובד כל עוד PR אחד פתוח בכל פעם. באוקטובר 2026 היו שניים: ‏#702 הוסיף
`security_alert`, ו-#711 הוסיף `showcase_meeting`, וכל אחד העתיק את הרשימה
מ-main. מי שהיה ממוזג שני היה מוחק את הסוג של הראשון - ואם כבר נכתבו שורות
מהסוג הזה, ה-`add constraint` נכשל וכל צינור המיגרציות נעצר.

שתי הבדיקות של PR (גרסאות, הרשאות) אינן רואות את זה: כל קובץ תקין לבדו.

מ-`20270420090000` הדרך היא

    select public.notification_types_add(array['הסוג_שלי']);

שמוסיפה למה שקיים ברגע הריצה, בכל סדר מיזוג. הבדיקה חוסמת רשימה קשיחה
במיגרציה שהגרסה שלה מאוחרת מזו; הישנות כבר רצו.

    python scripts/check_notif_type_constraint.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CUTOFF = "20270420090000"

# ‏`check (type in ('...` - רשימה של ליטרלים. ‏`in (%s)` בתוך execute format
# (כמו ב-notification_types_add עצמה) אינו נתפס, כי אין שם ליטרל.
HARD_LIST = re.compile(
    r"constraint\s+notifications_type_check\s+check\s*\(\s*type\s+(?:in\s*\(|=\s*any\s*\(\s*array\s*\[)\s*'",
    re.I,
)


def main() -> int:
    bad = []
    for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        version = path.name.split("_", 1)[0]
        if version <= CUTOFF:
            continue
        text = path.read_text(encoding="utf-8")
        for m in HARD_LIST.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            bad.append(f"{path.relative_to(ROOT)}:{line}")
    if not bad:
        print("notifications_type_check: אין רשימה קשיחה במיגרציה חדשה.")
        return 0
    print("רשימה קשיחה של notifications_type_check במיגרציה חדשה:\n")
    for b in bad:
        print(f"  {b}")
    print(
        "\nהיא דורסת סוג שנוסף ב-PR מקביל. במקומה:\n\n"
        "    select public.notification_types_add(array['הסוג_החדש']);\n\n"
        "ראו .claude/skills/agent-notifications/SKILL.md, סעיף 4."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
