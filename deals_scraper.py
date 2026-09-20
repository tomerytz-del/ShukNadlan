#!/usr/bin/env python3
"""
מנוע העסקאות הרשמיות — נקודת הכניסה.

מזין את דוח ה-CMA במה שחסר לו יותר מכול: **עסקאות אמיתיות**. עד כה הדוח
הכיר רק את העסקאות שנסגרו דרך הפלטפורמה עצמה, כלומר הוא תיאר את הפעילות
שלנו ולא את השוק. כאן נמשך מאגר עסקאות המקרקעין של רשות המיסים
(‏nadlan.gov.il) — שנבנה מדיווחי מס שבח ומס רכישה, ולכן המחיר בו הוא
מחיר עסקה ולא מחיר פרסום.

זרימת ההרצה, לכל עיר:
  1. פתרון שם היישוב למזהה החיפוש של המקור.
  2. דפדוף בעסקאות, עמוד אחר עמוד.
  3. **נרמול קפדני** — רשומה שחסר בה מחיר או תאריך נזרקת ונספרת, לא
     מנוחשת. ראו deals_engine/normalize.py.
  4. **סף פענוח** — אם יותר מרבע מהרשומות לא נפענחו, ההרצה נכשלת ולא
     כותבת דבר: סביר שהמקור שינה שם שדה, ומאגר חלקי שנכתב תחת
     ‏price_basis='official' גרוע ממאגר ריק.
  5. ‏upsert לפי external_key — ההרצה חוזרת על אותם חודשים בכוונה, כי
     רשות המיסים מפרסמת עסקה חודשים אחרי שנסגרה.

הקואורדינטות **אינן** נקבעות כאן: העסקה נכתבת עם רחוב ומספר בית, ו-
‏geocode-backfill משלים אותן מאותה שכבת כתובות של עיריית עפולה שממנה
מקבלים פין הנכסים עצמם (`docs/geocoding.md`). כך עסקה ונכס נמדדים
באותה סרגל, וזה מה שהופך את חישוב הרדיוס למשמעותי.

הרצה:
    python deals_scraper.py                  # הרצה מלאה
    python deals_scraper.py --dry-run        # למשוך ולנרמל בלי לכתוב
    python deals_scraper.py --city עפולה     # עיר אחת
    python deals_scraper.py --limit 20       # לכל היותר 20 עסקאות לעיר
    python deals_scraper.py --probe עפולה    # מה המקור באמת מחזיר

‏--probe הוא הצעד הראשון בכל מכונה עם גישה לרשת: מיפוי השדות ב-
‏deals_engine/nadlan.py נכתב לפי התיעוד ולא אומת מול תשובה חיה, כי
הסביבה שבה נכתב הקוד חסומה מ-nadlan.gov.il. ראו
‏docs/market-deals-official.md.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from datetime import date

from deals_engine.config import ConfigError, Settings, load_settings
from deals_engine.nadlan import (
    ENDPOINTS, FIELDS, NadlanClient, NadlanError, extract_records, missing_fields, pick,
)
from deals_engine.normalize import SkipRecord, normalize
from deals_engine.run import run_city, summarize
from deals_engine.store import DealsStore

log = logging.getLogger("deals_scraper")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ייבוא עסקאות מרשות המיסים")
    parser.add_argument("--dry-run", action="store_true", help="למשוך ולנרמל בלי לכתוב ל-Supabase")
    parser.add_argument("--city", action="append", default=[], metavar="שם",
                        help="עיר בודדת (אפשר לחזור על הדגל)")
    parser.add_argument("--limit", type=int, default=None, help="מקסימום עסקאות לעיר")
    parser.add_argument("--probe", metavar="עיר",
                        help="להדפיס את התשובה הגולמית ואת מיפוי השדות, בלי לכתוב דבר")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def _dump(label: str, value: object, limit: int = 3000) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2)
    print(text[:limit])
    if len(text) > limit:
        print(f"... (נחתך, סה\"כ {len(text)} תווים)")


def probe(settings: Settings, city: str) -> int:
    """מה המקור באמת מחזיר — ומה מתוך FIELDS לא נמצא בו.

    זו הפקודה שמאמתת את המתאם. היא אינה כותבת דבר, ואינה צריכה
    ‏SUPABASE_* — אפשר להריץ אותה מכל מכונה שיש לה גישה ל-nadlan.gov.il.

    הפלט בנוי כדי שאפשר יהיה להדביק אותו כמו שהוא ולתקן ממנו את
    ‏`FIELDS`: הוא מדפיס את **הגוף הגולמי** של שתי הקריאות לפני כל ניסיון
    לפרש אותו, כי כשהפירוש הוא זה שנשבר, פלט מפורש אינו מראה זאת.
    """
    client = NadlanClient(settings)

    print("=" * 72)
    print(f"‏1. פתרון היישוב — POST {ENDPOINTS['resolve']}")
    print(f"   גוף הבקשה: {{'query': '{city}'}}")
    print("=" * 72)
    try:
        scope = client.resolve_city(city)
    except NadlanError as err:
        print(f"✗ הקריאה נכשלה: {err}")
        print()
        print("אם זו חסימה (403/407) — זו מדיניות רשת ולא באג בקוד.")
        print("אם זה גוף שאינו JSON — סביר ש-WAF החזיר עמוד HTML.")
        return 1
    _dump("scope", scope)

    print()
    print("=" * 72)
    print(f"‏2. עמוד עסקאות ראשון — POST {ENDPOINTS['deals']}")
    print("=" * 72)
    payload = dict(scope) if isinstance(scope, dict) else {}
    payload["PageNo"] = 1
    print(f"   גוף הבקשה: התשובה מסעיף 1 + PageNo=1")
    try:
        body = client.post(ENDPOINTS["deals"], payload)
    except NadlanError as err:
        print(f"✗ הקריאה נכשלה: {err}")
        return 1

    # הגוף הגולמי **לפני** הפירוש. זה מה שמאפשר לתקן גם את
    # ‏`_extract_records` ולא רק את `FIELDS`.
    print()
    print("--- הגוף כפי שחזר ---")
    if isinstance(body, dict):
        print(f"מפתחות עליונים: {', '.join(sorted(body.keys()))}")
    elif isinstance(body, list):
        print(f"רשימה ישירה, {len(body)} איברים")
    _dump("body", body)

    records = extract_records(body)
    print()
    print(f"--- extract_records מצא {len(records)} רשומות ---")
    if not records:
        print("לא זוהו רשומות. התשובה למעלה היא מה שצריך כדי לתקן את")
        print("‏extract_records ב-deals_engine/nadlan.py — הוא מחפש את רשימת")
        print("המילונים הראשונה שיש בה שדה מחיר או מזהה עסקה.")
        return 1

    first = records[0]
    print()
    print("--- הרשומה הראשונה ---")
    _dump("first", first)

    print()
    print("=" * 72)
    print("‏3. מיפוי השדות")
    print("=" * 72)
    absent = missing_fields(first)
    for name in FIELDS:
        value = pick(first, name)
        mark = "✗" if value is None else "✓"
        print(f"  {mark} {name:<14} -> {value!r}")

    print()
    print(f"מפתחות שחזרו בפועל: {', '.join(sorted(first.keys()))}")

    # נרמול אמיתי על שלוש הרשומות הראשונות: שדה שנמצא אבל בפורמט לא צפוי
    # (תאריך, מחיר עם תו מיוחד) מתגלה רק כאן ולא בטבלה שלמעלה.
    print()
    print("=" * 72)
    print("‏4. נרמול בפועל — 3 הרשומות הראשונות")
    print("=" * 72)
    ok = 0
    for i, record in enumerate(records[:3], 1):
        try:
            row = normalize(city, record, not_before=date(1900, 1, 1))
            ok += 1
            print(f"  ✓ {i}: {row['sold_at']} · {row['sale_price']:,.0f} ₪ · "
                  f"{row['property_type']} · {row['size_sqm']} מ\"ר · "
                  f"רחוב={row['street']!r} מס׳={row['house_number']!r}")
        except SkipRecord as skip:
            print(f"  ✗ {i}: נדחתה — {skip}")

    print()
    if absent or ok < len(records[:3]):
        print("⚠ המתאם אינו תואם למקור.")
        if absent:
            print(f"  שדות שלא נמצאו: {', '.join(absent)}")
        print("  יש לעדכן את FIELDS ב-deals_engine/nadlan.py. שום קובץ אחר.")
        return 1

    print("✓ כל השדות נמצאו והנרמול עבר. המתאם תואם למקור.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    try:
        settings = load_settings() if not args.probe else _probe_settings()
    except ConfigError as err:
        log.error("%s", err)
        return 2

    if args.probe:
        try:
            return probe(settings, args.probe)
        except NadlanError as err:
            log.error("‏probe נכשל: %s", err)
            return 1

    cities = tuple(args.city) or settings.cities
    client = NadlanClient(settings)
    store = None if args.dry_run else DealsStore(settings)

    results = [run_city(client, store, settings, city, limit=args.limit) for city in cities]

    print()
    print(summarize(results))

    # קוד יציאה שאינו אפס על כל עיר שנפלה: ‏workflow ירוק שלא ייבא דבר
    # הוא בדיוק התקלה השקטה שהיומן במסד בא לתפוס.
    failed = [r.city for r in results if r.error]
    if failed:
        log.error("ערים שנכשלו: %s", ", ".join(failed))
        return 1
    return 0


def _probe_settings() -> Settings:
    """‏probe אינו נוגע ב-Supabase, ולכן אינו דורש את המפתחות שלו."""
    return Settings(supabase_url="-", supabase_service_role_key="-")


if __name__ == "__main__":
    sys.exit(main())
