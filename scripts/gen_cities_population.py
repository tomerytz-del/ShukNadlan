#!/usr/bin/env python3
"""מחולל מיגרציית האוכלוסייה ליישובים, מקובץ רשות האוכלוסין.

    python3 scripts/gen_cities_population.py <population.csv> <YYYY-MM-DD> \\
        > supabase/migrations/<version>_cities_population.sql

הקובץ: "אוכלוסייה לפי יישוב וקבוצת גיל" של רשות האוכלוסין וההגירה, כפי
שמורד כ-CSV מ-data.gov.il - **בקידוד Windows-1255**, עם רווחים בסוף כל
שדה. העמודות: סמל_ישוב, שם_ישוב, סמל_נפה, נפה, ..., סהכ, גיל_0_5, ...
התאריך הוא תאריך הנתונים (בשם הקובץ שמורד: 2026_09_20_...).

**ההתאמה לפי סמל יישוב בלבד** (cities.muni_code), לא לפי שם: הסמל הוא
העוגן היציב מול כל מקור ממשלתי (docs/cities-and-regions.md), והשמות בקובץ
הזה כתובים אחרת מאשר ב"יישובים בישראל" ("סואעד )כמאנה( )שבט(").

**אלה מספרי רישום, לא אומדן הלמ"ס:** תושבים רשומים במרשם האוכלוסין לפי
כתובת רשומה. השורה "לא רשום" (סמל 0) אינה יישוב ואינה נכנסת.
"""

from __future__ import annotations

import csv
import io
import re
import sys


def clean(v: str | None) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def main(path: str, as_of: str) -> None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        raise SystemExit("תאריך הנתונים בצורה YYYY-MM-DD, למשל 2026-09-20")
    raw = open(path, "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1255")
    rows = [{clean(k): clean(v) for k, v in r.items()} for r in csv.DictReader(io.StringIO(text))]
    if rows and ("סמל_ישוב" not in rows[0] or "סהכ" not in rows[0]):
        raise SystemExit("שדות לא צפויים: %s" % ",".join(rows[0].keys()))

    seen: dict[str, int] = {}
    for r in rows:
        code, total = r["סמל_ישוב"], r["סהכ"]
        if not code.isdigit() or int(code) <= 0:
            continue
        if not total.isdigit():
            raise SystemExit("סה\"כ לא מספרי ביישוב %s: %r" % (code, total))
        if code in seen:
            raise SystemExit("סמל יישוב כפול בקובץ: %s" % code)
        seen[code] = int(total)

    if len(seen) < 1000:
        raise SystemExit("רק %d יישובים - הקובץ חלקי?" % len(seen))

    values = ",\n".join("  ('%s', %d)" % (c, n) for c, n in sorted(seen.items(), key=lambda x: int(x[0])))
    sys.stdout.write(HEADER % {"n": len(seen), "total": sum(seen.values()), "as_of": as_of})
    sys.stdout.write(values)
    sys.stdout.write(FOOTER % {"as_of": as_of})


HEADER = """-- ===========================================================================
-- אוכלוסייה ליישובים - מקובץ רשות האוכלוסין (נכון ל-%(as_of)s)
--
-- ‏**נוצר על ידי scripts/gen_cities_population.py - לא לערוך ביד.**
-- %(n)d יישובים, %(total)d תושבים רשומים.
--
-- עד עכשיו cities.population היה null לכל היישובים: הקובץ של
-- 20270114095000 ("יישובים בישראל") אינו נושא אוכלוסייה. הקובץ הזה כן.
--
-- ‏**ההתאמה לפי סמל יישוב (muni_code) בלבד.** יישוב בקובץ שאין לו שורה
-- ברישום - מדולג; יישוב ברישום שאינו בקובץ - נשאר כמו שהוא. הערך נדרס בכל
-- הרצה: זה נתון שמתעדכן, לא החלטה ידנית, והקובץ החדש תמיד נכון מהישן.
--
-- ‏**מרשם, לא אומדן:** תושבים רשומים לפי כתובת רשומה. זה מספיק לסדר השקה
-- ולגודל שוק, ואינו מספר לפרסם כ"אוכלוסיית העיר". ‏docs/cities-and-regions.md.
-- ===========================================================================

alter table public.cities add column if not exists population_as_of date;

comment on column public.cities.population is
  'תושבים רשומים במרשם האוכלוסין (רשות האוכלוסין, לא אומדן הלמ"ס). התאריך ב-population_as_of. ראו docs/cities-and-regions.md';
comment on column public.cities.population_as_of is
  'התאריך שהקובץ של population נכון אליו.';

with src(muni_code, population) as (values
"""

FOOTER = """
)
update public.cities c
   set population       = s.population,
       population_as_of = date '%(as_of)s'
  from src s
 where c.muni_code = s.muni_code
   and (c.population is distinct from s.population
        or c.population_as_of is distinct from date '%(as_of)s');
"""

if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
