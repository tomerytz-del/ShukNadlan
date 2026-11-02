#!/usr/bin/env python3
"""הבדיקה של הבדיקה: מחזור העדכון של העסקאות (`_deal_sync_cycle`).

הסוכן שמושך עסקאות רץ בדפדפן ואין לו תזמון בשרת, ולכן הממצא הזה הוא
המקום היחיד שבו מחזור שנעצר נראה. ‏probe שתפקידו לשתוק רוב הזמן הוא
ה-probe שבאג בו אינו מתגלה לעולם - ולכן שלושת המצבים נבדקים כאן.

    python3 scripts/ops_deal_sync_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ops_agent.probes.behavior import _deal_fail_kind, _deal_sync_cycle  # noqa: E402


class _Db:
    def __init__(self, row, has=True):
        self._row, self._has = row, has
        self.sql = ""

    def has_table(self, name):
        return self._has

    def has_column(self, table, column):
        return self._has

    def rows(self, sql, params=None):
        self.sql = sql
        return [self._row] if "deal_sync:cycle" in sql else []


class _Ctx:
    def __init__(self, row, has=True):
        self.db = _Db(row, has)
        self.checks = 0

    def count(self):
        self.checks += 1


def row(overdue, last_ok_days, failing=0, no_data=0, paused=0):
    return {"overdue": overdue, "failing": failing, "active": 243,
            "no_data": no_data, "no_data_paused": paused,
            "no_data_top": [{"status": "שגיאה: אין חלקות עם עסקאות", "n": no_data,
                             "names": ["כפר %d" % i for i in range(no_data)]}]
                           if no_data else [],
            "last_ok": None if last_ok_days is None else "2026-10-01",
            "last_ok_days": last_ok_days, "oldest": ["חדרה", "חריש"]}


failed = 0


def check(name, ok):
    global failed
    print(("✓ " if ok else "✗ ") + name)
    if not ok:
        failed += 1


def _Ctx_sql(r):
    c = _Ctx(r)
    list(_deal_sync_cycle(c))
    return c.db.sql


def run(r, has=True):
    return list(_deal_sync_cycle(_Ctx(r, has)))


fs = run(row(214, None))
check("לא רץ מעולם, 214 ממתינים - deal_sync_stopped בינוני",
      len(fs) == 1 and fs[0].code == "deal_sync_stopped" and fs[0].severity == "medium"
      and fs[0].metric == 214 and "מעולם" in fs[0].title)

fs = run(row(40, 30))
check("לא רץ 30 ימים - deal_sync_stopped עם מספר הימים",
      len(fs) == 1 and fs[0].code == "deal_sync_stopped" and "30 ימים" in fs[0].title)

fs = run(row(6, 3, failing=4))
check("רץ לפני 3 ימים, 6 בפיגור (4 נכשלים) - deal_sync_overdue נמוך",
      len(fs) == 1 and fs[0].code == "deal_sync_overdue" and fs[0].severity == "low"
      and "4 מהם נכשלים" in fs[0].title)

# ‏2.11.2026: ‏249 יישובים שלא נמשכו מעולם ונכשלו (אין להם נתונים ב-GovMap)
# נספרו כ"חורגים ממחזור העדכון". השאילתה מוציאה אותם מ-overdue, וכאן נבדק
# שהם מקבלים ממצא מידע משלהם ולא מדליקים את הפיגור.
fs = run(row(0, 7, no_data=249, paused=42))
check("249 בלי נתונים ב-GovMap, אין פיגור - רק deal_sync_no_data במידע",
      len(fs) == 1 and fs[0].code == "deal_sync_no_data" and fs[0].severity == "info"
      and fs[0].subject == "deals:no_data" and fs[0].metric == 249
      and fs[0].evidence["paused_all_kinds"] == 42)

fs = run(row(6, 3, failing=6, no_data=249))
check("גם בלי נתונים וגם יישובים שנמשכו בעבר ונכשלים - שני ממצאים נפרדים",
      {f.code for f in fs} == {"deal_sync_no_data", "deal_sync_overdue"})

check("השאילתה מוציאה מ-overdue יישוב שלא נמשך מעולם ונכשל",
      "not (\n                   s.last_synced_at is null" in
      _Ctx_sql(row(0, 2)))

# ‏33 הנוסחים האמיתיים של 2.11.2026 (‏deal_settlements.last_status), עם הסוג
# שכל אחד חייב לקבל. נוסח חדש שהסוכן ממציא נופל ל-no_data - וזה הכיוון הבטוח:
# הוא נשאר בממצא המידע ואינו מוסיף "שם שגוי" לרשימה שמישהו יתקן.
REAL = [
    ("name", 15, "שגיאה: היישוב לא נמצא בחיפוש של Govmap"),
    ("name", 1, 'שגיאה: בחיפוש של Govmap מופיע רק "פורייה (נווה עובד)" - יישוב אחר'),
    ("name", 1, "שגיאה: ב-Govmap מופיע ככפר רתמים ואין חלקות עסקאות בשכבה"),
    ("other_city", 1, 'שגיאה: "עסקאות ביישוב" החזיר את הרשימה הכללית (1500, גושים מכל הארץ) - לא נכתב'),
    ("other_city", 1, "שגיאה: החלקה שנבחרה החזירה עסקאות של עיר אחרת (רמת דן, 1500) - לא נכתב"),
    ("other_city", 1, "שגיאה: החלקה בתחום היישוב מציגה עסקאות ראש העין (פסגות אפק) - לא ניתן לשייך"),
    ("other_city", 1, 'שגיאה: "עסקאות ביישוב" בחלקה שנבחרה מחזיר 1500 עסקאות מגושים מכל הארץ (דלי כללי), לא של שני - לא נכתב'),
    ("other_city", 1, "שגיאה: החלקות היחידות עם עסקאות בתחום מציגות רחובות של קרית ארבע - לא ניתן לשייך"),
    ("other_city", 1, "שגיאה: בלחיצה על המפה התקבלו עסקאות של אשקלון - לא נכתב"),
    ("other_city", 1, "שגיאה: החלקה בתוך היישוב שייכת לרשימה של משאבי שדה - לא נכתב"),
    ("no_data", 1, "שגיאה: אין חלקות עם עסקאות ביישוב ב-Govmap"),
    ("no_data", 6, "שגיאה: לא נמצא פוליגון יישוב/חלקות עסקאות במפה"),
    ("no_data", 1, 'שגיאה: בחלקות שבמרכז היישוב אין לשונית "עסקאות ביישוב" ב-Govmap'),
    ("no_data", 48, "שגיאה: ב-Govmap אין פוליגון יישוב / חלקות עם עסקאות"),
    ("no_data", 17, "שגיאה: אין חלקות/עסקאות בשכבה בתחום היישוב ב-Govmap"),
    ("no_data", 12, "שגיאה: ב-Govmap אין פוליגון יישוב, והחלקות הסמוכות לא החזירו עסקאות"),
    ("no_data", 5, 'שגיאה: בחלקה שבתוך היישוב אין לשונית "עסקאות ביישוב" ב-Govmap'),
    ("no_data", 9, 'שגיאה: בחלקות שבתוך היישוב אין לשונית "עסקאות ביישוב" ב-Govmap'),
    ("no_data", 5, 'שגיאה: אין טאב "עסקאות ביישוב" ב-Govmap (רק עסקאות בחלקה)'),
    ("no_data", 1, 'שגיאה: ב-Govmap החלקות ביישוב מציגות רק לשונית "בחלקה" עם עסקה ישנה, אין לשונית "עסקאות ביישוב"'),
    ("no_data", 53, "שגיאה: אין חלקות עם עסקאות בתוך היישוב ב-Govmap"),
    ("no_data", 1, "שגיאה: ב-Govmap אין פוליגון יישוב ואין חלקות עם עסקאות סביב הנקודה"),
    ("no_data", 1, "שגיאה: לא נמצאו חלקות עסקאות במפה סביב היישוב"),
    ("no_data", 1, 'שגיאה: יש רק לשונית "עסקאות בחלקה וברחוב" (52), אין "עסקאות ביישוב"'),
    ("no_data", 1, 'שגיאה: אין חלקות מסומנות בתוך היישוב, ובחלקה במרכזו אין לשונית "עסקאות ביישוב"'),
    ("no_data", 1, "שגיאה: פאנל העסקאות ריק בחלקות המגורים ובחלקה הגדולה יש רק לשונית בחלקה, בלי עסקאות ביישוב"),
    ("no_data", 6, "שגיאה: אין רשימת עסקאות ביישוב ב-Govmap (רק עסקה בודדת בחלקה)"),
    ("no_data", 2, "שגיאה: אין רשימת עסקאות ביישוב ב-Govmap (רק עסקאות בחלקה)"),
    ("no_data", 30, "שגיאה: לא נמצאה רשימת עסקאות ביישוב בלחיצה על המפה"),
    ("no_data", 13, "שגיאה: אין חלקות עסקאות בשכבה בתוך היישוב ב-Govmap"),
    ("no_data", 1, 'שגיאה: ב-Govmap אין פוליגון יישוב; בחלקה הסמוכה אין לשונית "עסקאות ביישוב"'),
    ("no_data", 9, "שגיאה: במפת Govmap אין חלקות עם שכבת עסקאות בתחום היישוב - לא ניתן לפתוח טבלת עסקאות"),
    ("no_data", 1, 'שגיאה: החלקות בתוך היישוב ב-Govmap בלי לשונית "עסקאות ביישוב" (כנראה נספרות בירושלים)'),
]
wrong = [(st, k, _deal_fail_kind(st)) for k, _, st in REAL if _deal_fail_kind(st) != k]
check("33 הנוסחים האמיתיים מסווגים נכון", not wrong)
for w in wrong:
    print("    ", w)
check("הקידומות שהסקיל מבקש מסווגות לפי עצמן",
      _deal_fail_kind("שגיאה: שם: X") == "name"
      and _deal_fail_kind("שגיאה: עיר אחרת: X") == "other_city"
      and _deal_fail_kind("שגיאה: אין נתונים: X") == "no_data")

r = row(0, 7, no_data=249, paused=42)
r["no_data_top"] = [{"status": st, "n": n, "names": ["%s %d" % (k, i) for i in range(n)]}
                    for k, n, st in REAL]
fs = {f.code: f for f in run(r)}
check("249 האמיתיים - שלושה ממצאים: 17 שם, 7 עיר אחרת, 225 בלי נתונים",
      set(fs) == {"deal_sync_name_mismatch", "deal_sync_other_city", "deal_sync_no_data"}
      and fs["deal_sync_name_mismatch"].metric == 17
      and fs["deal_sync_other_city"].metric == 7
      and fs["deal_sync_no_data"].metric == 225)
check("שם שגוי - נמוך, עם שמות היישובים בפירוט; השניים האחרים מידע",
      fs["deal_sync_name_mismatch"].severity == "low"
      and "name 0" in fs["deal_sync_name_mismatch"].detail
      and fs["deal_sync_other_city"].severity == "info"
      and fs["deal_sync_no_data"].severity == "info")
check("לכל סוג נושא משלו - תיקון השמות סוגר רק את הממצא שלהם",
      len({f.subject for f in fs.values()}) == 3)

check("אין פיגור - אין ממצא", not run(row(0, 2)))
check("אין פיגור גם כשלא רץ מעולם (הכול חדש) - אין ממצא", not run(row(0, None)))
check("לפני המיגרציה (אין last_attempt_at) - אין ממצא ואין שגיאה", not run(row(9, None), has=False))
check("נושא יציב אחד - הממצא נסגר כשהמחזור חוזר",
      {f.subject for f in run(row(214, None)) + run(row(6, 3))} == {"deals:sync"})

print("\n✓ ‏_deal_sync_cycle מדווחת בדיוק מתי שצריך" if not failed else "\n✗ %d נכשלו" % failed)
sys.exit(1 if failed else 0)
