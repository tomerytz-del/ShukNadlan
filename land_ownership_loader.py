#!/usr/bin/env python3
"""טעינת סוג הבעלות בקרקע (טאבו) מ-data.gov.il ל-`land_ownership`.

המקור: משרד המשפטים, "סוג בעלות בנכסים הרשומים בפנקסי המקרקעין". הקובץ
הוא שורה לכל תת-חלקה (‏2.87 מיליון), והטבלה היא שורה לכל חלקה (‏1.13
מיליון). הפירוט וההחלטות: ‏docs/land-ownership.md.

רץ ב-GitHub Actions (‏land_ownership.yml) עם SERVICE_ROLE_KEY - מפתח שעוקף
RLS - ולכן אך ורק בצד השרת.

## אותו כלל של מנוע העסקאות

**רשומה פגומה נזרקת ונספרת, ולא מנוחשת.** גוש או חלקה שאינם מספר, סוג
בעלות שאינו אחד מחמשת הידועים - נספרים ב-`rows_rejected`. מעבר ל-1% מהם
ההרצה נכשלת: זה כבר לא רעש אלא קובץ בפורמט אחר.

## ולמה הטעינה לא מוחקת עד הסוף

הכתיבה במנות, והמחיקה של הישן ב-`land_ownership_finish` - שבודקת קודם
שנכתבו לפחות 900 אלף חלקות. הורדה שנקטעה באמצע היא CSV תקין עם חצי
מהשורות, ובלי הבדיקה הזו "הצלחה" הייתה מוחקת חצי מדינה.

    python3 land_ownership_loader.py                  # טעינה (דילוג אם הקובץ לא השתנה)
    python3 land_ownership_loader.py --force          # טעינה גם אם לא השתנה
    python3 land_ownership_loader.py --file x.csv --dry-run   # ניתוח בלבד, בלי רשת ובלי מסד
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import io
import json
import logging
import os
import sys
import tempfile
import time
from typing import Iterable, Iterator

import requests

log = logging.getLogger("land_ownership")

RESOURCE_ID = "a1a91496-d692-4420-bc21-3487600b71a5"
CKAN_SHOW = "https://data.gov.il/api/3/action/resource_show?id=" + RESOURCE_ID
CKAN_DATASTORE = "https://data.gov.il/api/3/action/datastore_search"

# ‏**הזיהוי ש-data.gov.il מבקש מלקוחות חיצוניים**, ולא דפדפן מזויף. בהרצה
# הראשונה (26.9.2026) ה-API של CKAN ענה ל-GitHub, ושרת הקבצים (e.data.gov.il)
# החזיר 403 ל-"ShukNadlanBot". אם גם זה נחסם - `datastore_search`, למטה.
USER_AGENT = "datagov-external-client"
DATASTORE_PAGE = 32000

HEADER = ["גוש", "חלקה", "תת חלקה", "תיאור שיטה", "סוג בעלות"]

# חמש הקטגוריות של המקור. כל ערך אחר נדחה - לא ממופה ל"אחר".
OWNERSHIP = {
    "פרטית": "P",
    "מדינה": "S",
    "רשות מקומית": "L",
    "מעורב": "M",
    "אחר": "O",
}

# שוויון בין סוגים באותה חלקה: הסוג שמחייב בדיקה נבחר. "פרטית" אחרונה -
# לומר "מדינה" על חלקה חצויה ולהוסיף mixed_units עדיף על להשמיט את זה.
TIE_ORDER = "SLMOP"

MAX_REJECT_RATIO = 0.01
MIN_PARCELS = 900_000
CHUNK = 5000


# ---------------------------------------------------------------------------
# החלק הטהור: CSV → חלקות. בלי רשת ובלי מסד, ולכן נבדק ב-land_ownership_test.py
# ---------------------------------------------------------------------------

def reduce_rows(lines: Iterable[str]) -> tuple[dict[tuple[int, int], tuple[str, bool]], dict]:
    """מחזירה ({(גוש, חלקה): (סוג, mixed_units)}, סטטיסטיקה).

    זורקת ValueError אם הכותרת אינה הכותרת הצפויה: עמודה שזזה הייתה
    ממפה "חלקה" ל"תת חלקה" בשקט, וכל הטבלה הייתה שגויה ונראית תקינה.
    """
    reader = csv.reader(lines)
    header = [h.strip() for h in next(reader, [])]
    if header[:5] != HEADER:
        raise ValueError(f"כותרת לא צפויה: {header!r}, ציפינו ל-{HEADER!r}")

    counts: dict[tuple[int, int], collections.Counter] = collections.defaultdict(collections.Counter)
    stats = collections.Counter()

    for row in reader:
        stats["read"] += 1
        if len(row) < 5:
            stats["rejected"] += 1
            continue
        gush, helka, _sub, method, kind = (c.strip() for c in row[:5])

        # לא מוסדר: מספור אחר, שמתנגש במספור המוסדר (ראו המיגרציה).
        if method:
            stats["skipped"] += 1
            continue

        code = OWNERSHIP.get(kind)
        if not (gush.isdigit() and helka.isdigit()) or code is None or len(gush) > 9 or len(helka) > 9:
            stats["rejected"] += 1
            continue

        counts[(int(gush), int(helka))][code] += 1

    parcels: dict[tuple[int, int], tuple[str, bool]] = {}
    for key, c in counts.items():
        best = max(c.items(), key=lambda kv: (kv[1], -TIE_ORDER.index(kv[0])))[0]
        parcels[key] = (best, len(c) > 1)

    stats["parcels"] = len(parcels)
    stats["mixed"] = sum(1 for _, m in parcels.values() if m)
    return parcels, dict(stats)


def check_quality(stats: dict) -> str | None:
    """מחזירה הודעת שגיאה אם הקובץ אינו ראוי לטעינה, או None."""
    read = stats.get("read", 0)
    if read == 0:
        return "הקובץ ריק"
    if stats.get("rejected", 0) / read > MAX_REJECT_RATIO:
        return f"{stats['rejected']} מתוך {read} שורות נדחו - מעל {MAX_REJECT_RATIO:.0%}. פורמט אחר?"
    if stats.get("parcels", 0) < MIN_PARCELS:
        return f"רק {stats.get('parcels', 0)} חלקות, הסף {MIN_PARCELS}. קובץ חלקי?"
    return None


# ---------------------------------------------------------------------------
# רשת
# ---------------------------------------------------------------------------

def resolve_source(session) -> tuple[str, str | None]:
    """הכתובת ותאריך העדכון של הקובץ, מ-CKAN. ‏LAND_OWNERSHIP_URL עוקף."""
    override = os.environ.get("LAND_OWNERSHIP_URL", "").strip()
    if override:
        return override, None
    res = session.get(CKAN_SHOW, timeout=60)
    res.raise_for_status()
    body = res.json()
    if not body.get("success"):
        raise RuntimeError(f"CKAN החזיר success=false: {json.dumps(body)[:500]}")
    result = body["result"]
    return result["url"], result.get("last_modified") or result.get("metadata_modified")


class SourceBlocked(RuntimeError):
    """שרת הקבצים לא נתן את הקובץ: 401/403, או עמוד HTML (בדיקת בוטים) עם 200.

    בהרצה השנייה (26.9.2026) הוא החזיר 200 עם text/html - ולכן זו אינה רק
    שאלה של קוד סטטוס. שגיאת שרת (5xx) אינה חסימה, ולכן אינה כאן.
    """


def download(session, url: str) -> str:
    """מוריד לקובץ זמני ומחזיר את הנתיב. עמוד HTML במקום CSV הוא כשל."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "wb") as out, session.get(url, stream=True, timeout=300) as res:
        if res.status_code in (401, 403):
            raise SourceBlocked(f"שרת הקבצים החזיר {res.status_code}")
        res.raise_for_status()
        ctype = res.headers.get("Content-Type", "")
        if "html" in ctype.lower():
            raise SourceBlocked(f"התקבל {ctype} במקום CSV - כנראה עמוד חסימה")
        for chunk in res.iter_content(1 << 20):
            out.write(chunk)
    log.info("הורדו %.1f MB", os.path.getsize(path) / 1e6)
    return path


def datastore_lines(session) -> Iterator[str]:
    """אותו תוכן דרך ה-API של CKAN, כשורות CSV - כדי ש-reduce_rows לא תשתנה.

    דרך המילוט כששרת הקבצים חוסם: ה-API הוא הממשק שהפורטל מציע לשליפה
    תוכניתית. דפדוף לפי `_links.next`, ~90 בקשות לכל המאגר. הכותרת נבנית
    מ-HEADER ולא מהשדות שחזרו: אם השמות השתנו, `reduce_rows` לא תגלה זאת
    מהכותרת - ולכן בודקים כאן שכל עמודה צפויה קיימת.
    """
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    yield buf.getvalue()

    url = f"{CKAN_DATASTORE}?resource_id={RESOURCE_ID}&limit={DATASTORE_PAGE}"
    total = None
    seen = 0
    while url:
        res = session.get(url, timeout=120)
        res.raise_for_status()
        body = res.json()
        if not body.get("success"):
            raise RuntimeError(f"datastore_search החזיר success=false: {json.dumps(body)[:300]}")
        result = body["result"]
        if total is None:
            total = result.get("total")
            names = {f.get("id") for f in result.get("fields", [])}
            missing = [h for h in HEADER if h not in names]
            if missing:
                raise ValueError(f"עמודות חסרות ב-datastore: {missing!r}")
        records = result.get("records") or []
        if not records:
            break
        for rec in records:
            buf.seek(0)
            buf.truncate()
            w.writerow([rec.get(h, "") if rec.get(h) is not None else "" for h in HEADER])
            yield buf.getvalue()
        seen += len(records)
        nxt = (result.get("_links") or {}).get("next")
        url = ("https://data.gov.il" + nxt) if nxt and seen < (total or 0) else None
    log.info("datastore: נקראו %d מתוך %s רשומות", seen, total)


def open_lines(path: str) -> Iterator[str]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        yield from f


# ---------------------------------------------------------------------------
# מסד
# ---------------------------------------------------------------------------

def last_done_source_modified(client) -> str | None:
    res = (client.table("land_ownership_loads").select("source_modified")
           .eq("status", "done").order("finished_at", desc=True).limit(1).execute())
    rows = res.data or []
    return rows[0]["source_modified"] if rows else None


def same_instant(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    def parse(s: str) -> dt.datetime:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    return parse(a) == parse(b)


def upsert_all(client, parcels: dict, batch: str) -> int:
    items = list(parcels.items())
    written = 0
    for start in range(0, len(items), CHUNK):
        rows = [{"gush": g, "helka": h, "ownership": o, "mixed_units": m, "batch": batch}
                for (g, h), (o, m) in items[start:start + CHUNK]]
        for attempt in range(4):
            try:
                client.table("land_ownership").upsert(rows, on_conflict="gush,helka").execute()
                break
            except Exception as err:  # noqa: BLE001 - רשת או PostgREST, נסיגה ואז כשל
                if attempt == 3:
                    raise
                wait = 2 ** (attempt + 1)
                log.warning("מנה %d נכשלה (%s), ניסיון נוסף בעוד %ds", start // CHUNK, err, wait)
                time.sleep(wait)
        written += len(rows)
        if (start // CHUNK) % 20 == 0:
            log.info("נכתבו %d / %d", written, len(items))
    return written


# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="CSV מקומי במקום הורדה")
    ap.add_argument("--dry-run", action="store_true", help="ניתוח בלבד, בלי כתיבה למסד")
    ap.add_argument("--force", action="store_true", help="טעינה גם אם הקובץ לא השתנה")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    source_url, source_modified = (args.file, None) if args.file else (None, None)
    client = None
    session = None

    if not args.file:
        session = requests.Session()
        session.headers["User-Agent"] = USER_AGENT
        source_url, source_modified = resolve_source(session)
        log.info("מקור: %s (עודכן %s)", source_url, source_modified or "לא ידוע")

    if not args.dry_run:
        from supabase import create_client
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        if not args.force and same_instant(source_modified, last_done_source_modified(client)):
            log.info("הקובץ לא השתנה מאז הטעינה האחרונה - אין מה לעשות.")
            return 0

    if args.file:
        lines = open_lines(args.file)
    else:
        try:
            lines = open_lines(download(session, source_url))
        except SourceBlocked as err:
            log.warning("%s - עוברים ל-datastore_search", err)
            lines = datastore_lines(session)
    parcels, stats = reduce_rows(lines)
    log.info("נקראו %d שורות: %d לא מוסדרות (דולגו), %d נדחו → %d חלקות, %d מעורבות",
             stats.get("read", 0), stats.get("skipped", 0), stats.get("rejected", 0),
             stats["parcels"], stats["mixed"])
    by_kind = collections.Counter(o for o, _ in parcels.values())
    log.info("לפי סוג: %s", dict(by_kind.most_common()))

    problem = check_quality(stats)
    if problem:
        log.error("✗ %s", problem)
        return 1
    if args.dry_run:
        log.info("✓ הרצה יבשה - לא נכתב דבר.")
        return 0

    batch = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    client.table("land_ownership_loads").insert({
        "batch": batch, "source_url": source_url, "source_modified": source_modified,
        "rows_read": stats.get("read", 0), "rows_skipped": stats.get("skipped", 0),
        "rows_rejected": stats.get("rejected", 0), "parcels": stats["parcels"],
    }).execute()

    try:
        upsert_all(client, parcels, batch)
    except Exception as err:  # noqa: BLE001
        client.table("land_ownership_loads").update({
            "status": "failed", "error": str(err)[:500],
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }).eq("batch", batch).execute()
        log.error("✗ הכתיבה נכשלה: %s. הנתונים הקודמים נשארו.", err)
        return 1

    res = client.rpc("land_ownership_finish", {"p_batch": batch, "p_min_parcels": MIN_PARCELS}).execute()
    out = res.data or {}
    if not out.get("ok"):
        log.error("✗ הסיום נדחה: %s", out)
        return 1
    log.info("✓ נטענו %d חלקות, נמחקו %d ישנות.", out.get("parcels", 0), out.get("deleted", 0))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
