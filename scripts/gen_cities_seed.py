#!/usr/bin/env python3
"""מחולל מיגרציית הזנת היישובים מקובץ היישובים של data.gov.il.

    python3 scripts/gen_cities_seed.py <settlements.csv> > supabase/migrations/<version>_cities_seed.sql

הקובץ: "יישובים בישראל" (resource 5c78e9fa-c2e2-4771-93ff-7f400a12f7ba),
כפי שמורד כ-CSV מהאתר - **בקידוד Windows-1255**, עם רווחים בסוף כל שדה.
העמודות: סמל_ישוב, שם_ישוב, שם_ישוב_לועזי, סמל_נפה, שם_נפה, סמל_לשכת_מנא,
לשכה, סמל_מועצה_איזורית, שם_מועצה.

**מה אין בקובץ, ולכן אין במיגרציה:** קואורדינטות, אוכלוסייה, מחוז, ומעמד
מוניציפלי מלא (עירייה מול מועצה מקומית). ‏docs/cities-and-regions.md אוסר
לנחש אותם - הם נשארים null עד קובץ הלמ"ס המלא. מה שכן: סמל יישוב (העוגן
היציב מול כל מקור ממשלתי), הנפה, השיוך לאזור לפי הנפה, ו"יישוב במועצה
אזורית" כשיש סמל מועצה.

השיוך לאזור הוא 25 הכרעות, אחת לכל נפה - הן כאן, בטבלה אחת, כדי שיהיו
ניתנות לביקורת (ובמסד - `cbs_nafa` נשמר לכל יישוב).
"""

from __future__ import annotations

import csv
import io
import re
import sys

# נפה (סמל הלמ"ס) → areas.slug. חריגה ליישוב בודד היא update במיגרציה נפרדת,
# לא שינוי כאן - כך שהרצה חוזרת לא תדרוס החלטה ידנית (ה-update אינו נוגע
# ב-area_id של יישוב קיים).
NAFA_TO_AREA = {
    "11": "jerusalem-hills",   # ירושלים
    "21": "galil-golan",       # צפת
    "22": "galil-golan",       # כנרת
    "29": "galil-golan",       # גולן
    "23": "emakim",            # עפולה
    "25": "emakim",            # נצרת
    "24": "haifa-galil-mar",   # עכו
    "31": "haifa-galil-mar",   # חיפה
    "32": "hadera-carmel",     # חדרה
    "41": "sharon",            # השרון
    "42": "gush-dan",          # פתח תקווה
    "51": "gush-dan",          # תל אביב
    "52": "gush-dan",          # רמת גן
    "53": "gush-dan",          # חולון
    "43": "shfela-merkaz",     # רמלה
    "44": "shfela-merkaz",     # רחובות
    "61": "ashdod-shfela",     # אשקלון
    "62": "beer-sheva-negev",  # באר שבע
    "71": "judea-samaria",     # ג'נין
    "72": "judea-samaria",     # שכם
    "73": "judea-samaria",     # טול כרם
    "74": "judea-samaria",     # ראמאללה
    "75": "judea-samaria",     # ירדן (יריחו)
    "76": "judea-samaria",     # בית לחם
    "77": "judea-samaria",     # חברון
}


def clean(v: str | None) -> str:
    """רווחים מכווצים, וסוגריים הפוכים (")יריחו(") מיושרים - שארית ייצוא."""
    s = re.sub(r"\)([^()]*)\(", r"(\1)", str(v or ""))
    return re.sub(r"\s+", " ", s).strip()


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main(path: str) -> None:
    raw = open(path, "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1255")
    rows = [{k.strip(): clean(v) for k, v in r.items()} for r in csv.DictReader(io.StringIO(text))]

    values = []
    for r in rows:
        code = r.get("סמל_ישוב", "")
        name = r.get("שם_ישוב", "")
        nafa_code = r.get("סמל_נפה", "")
        if not code.isdigit() or int(code) <= 0 or len(name) < 2:
            continue
        area = NAFA_TO_AREA.get(nafa_code)
        if not area:
            raise SystemExit("נפה בלי שיוך לאזור: %s (%s) - להוסיף ל-NAFA_TO_AREA" % (nafa_code, r.get("שם_נפה")))
        council = r.get("סמל_מועצה_איזורית", "0")
        status = "regional_council_locality" if council.isdigit() and int(council) > 0 else "unknown"
        values.append("  (%s, %s, %s, %s, %s)" % (q(code), q(name), q(r.get("שם_נפה", "")), q(status), q(area)))

    if len(values) < 1000:
        raise SystemExit("רק %d יישובים - הקובץ חלקי?" % len(values))

    sys.stdout.write(HEADER % len(values))
    sys.stdout.write(",\n".join(values))
    sys.stdout.write(FOOTER)


HEADER = """-- ===========================================================================
-- הזנת היישובים - מקובץ "יישובים בישראל" (data.gov.il, 5c78e9fa-…)
--
-- ‏**נוצר על ידי scripts/gen_cities_seed.py - לא לערוך ביד.** %d יישובים.
--
-- ‏docs/cities-and-regions.md, "הזנת הערים". מה נכנס: סמל יישוב (muni_code,
-- העוגן היציב), השם, הנפה (cbs_nafa), מעמד "יישוב במועצה אזורית" כשיש סמל
-- מועצה, והאזור לפי הנפה. מה **לא** נכנס, כי אינו בקובץ ואסור לנחש:
-- קואורדינטות, אוכלוסייה, מחוז, והמעמד המלא (עירייה/מועצה מקומית).
--
-- ## שני מסלולים, ובשניהם החלטה ידנית אינה נדרסת
--
--  1. **עיר שכבר ברישום** (21 ערי השווקים, לפי name_key - "קריית אתא" שלנו
--     = "קרית אתא" של הקובץ): מקבלת muni_code, cbs_nafa ו-municipal_status
--     **רק היכן שהם ריקים**. השם, ה-slug, האזור, השוק ו-is_live לא נוגעים.
--  2. **יישוב חדש**: נכנס כ-source='seed', ‏slug זמני c-<סמל> (הסכמה חוסמת
--     is_live עליו), is_live=false. כלומר: אינו מופיע באתר, אינו בשום
--     שוק - ורק מאפשר ל-properties.city_id להתמלא ליישוב שנרשם בו נכס.
--
-- הרצה חוזרת (קובץ שנתי חדש) היא אותה מיגרציה עם version חדש.
-- ===========================================================================

with src(muni_code, name, cbs_nafa, municipal_status, area_slug) as (values
"""

FOOTER = """
), matched as (
  -- מסלול 1: עיר קיימת לפי name_key, או לפי muni_code אם כבר נקשרה
  update public.cities c
     set muni_code        = coalesce(c.muni_code, s.muni_code),
         cbs_nafa         = coalesce(c.cbs_nafa, s.cbs_nafa),
         municipal_status = case when c.municipal_status is null or c.municipal_status = 'unknown'
                                 then s.municipal_status else c.municipal_status end
    from src s
   where c.name_key = public.city_name_key(s.name)
      or c.muni_code = s.muni_code
  returning s.muni_code
)
-- מסלול 2: כל השאר
insert into public.cities (area_id, name, slug, muni_code, cbs_nafa, municipal_status, source)
select a.id, s.name, 'c-' || s.muni_code, s.muni_code, s.cbs_nafa, s.municipal_status, 'seed'
  from src s
  join public.areas a on a.slug = s.area_slug
 where s.muni_code not in (select muni_code from matched)
   and not exists (select 1 from public.cities c
                    where c.name_key = public.city_name_key(s.name) or c.muni_code = s.muni_code)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- ההשלמה: נכסים, משרדים ושכונות ביישובים שנכנסו עכשיו מקבלים city_id.
-- ---------------------------------------------------------------------------
do $$
declare
  v integer;
  v_total integer := 0;
begin
  loop
    v := public.properties_backfill_city_id(200);
    v_total := v_total + v;
    exit when v = 0;
  end loop;
  raise notice 'properties.city_id: הושלמו % שורות', v_total;
end $$;

do $$
declare r record;
begin
  select * into r from public.agencies_backfill_city_id();
  raise notice 'agencies.city_id: % מכתובת, % מנכסים, % נותרו ריקים',
    r.from_address, r.from_properties, r.still_null;
end $$;

do $$
declare v_done integer;
begin
  update public.neighborhoods n
     set city_id = public.city_id_for_name(n.city)
   where n.city_id is null
     and public.city_id_for_name(n.city) is not null;
  get diagnostics v_done = row_count;
  raise notice 'neighborhoods.city_id: הושלמו % שורות', v_done;
end $$;
"""

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
