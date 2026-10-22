#!/usr/bin/env python3
"""טעינת שכבת החלקות הפתוחה של המרכז למיפוי ישראל מ-data.gov.il ל-`parcels_open`.

המקור: "חלקות shape" (‏parcel_all.zip, ‏~667MB), רישיון פתוח שמתיר שימוש
מסחרי. זו אותה שכבה של PARCEL_ALL ב-GovMap - אבל כמאגר פתוח, ולכן מותר לנו
להחזיק עותק ולשאול אותו מהשרת, בניגוד ל-GovMap (תנאי השימוש שם אוסרים
איסוף בהיקף, והמפ"י מתירים את ה-API מצד הלקוח בלבד). ‏docs/govmap.md.

שורה לחלקה: גוש, סיומת, חלקה, שטח רשום, סטטוס, יישוב, רשות - ונקודה אחת
(מרכז הטבעת החיצונית ב-WGS84) במקום המצולע.

רץ ב-GitHub Actions (‏parcels_open.yml) עם SERVICE_ROLE_KEY - בצד השרת בלבד.

## אותם כללים של land_ownership_loader.py

* **רשומה פגומה נזרקת ונספרת, ולא מנוחשת.** מעל 1% - ההרצה נכשלת.
* **הישן נמחק רק בסוף**, ב-`parcels_open_finish`, ורק אם נכתבו לפחות מיליון
  חלקות. הורדה שנקטעה לא מוחקת חצי מדינה.
* **פעם בחודש, ורק אם הקובץ השתנה** (תאריך העדכון ב-CKAN מול הטעינה האחרונה).

    python3 parcels_open_loader.py                 # טעינה (דילוג אם לא השתנה)
    python3 parcels_open_loader.py --force         # טעינה גם אם לא השתנה
    python3 parcels_open_loader.py --file x.zip --dry-run   # ניתוח בלבד
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import logging
import os
import sys
import tempfile
import time
import zipfile
from typing import Iterator

import requests

log = logging.getLogger("parcels_open")

RESOURCE_ID = "c68b4df6-c809-4bb5-a546-61fa1528fed5"
CKAN_SHOW = "https://data.gov.il/api/3/action/resource_show?id=" + RESOURCE_ID
USER_AGENT = "datagov-external-client"

# **אותה מחרוזת בדיוק** כמו ITM_DEF ב-supabase/functions/_shared/geocode/itm.ts
# וב-assets/govmap.js - אחרת הפין מהשכבה הזו והפין מ-GovMap זזים במטרים.
ITM_DEF = ("+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 "
           "+x_0=219529.584 +y_0=626907.39 +ellps=GRS80 "
           "+towgs84=23.772,17.49,17.859,-0.3132,-1.85274,1.67299,-5.4262 +units=m +no_defs +type=crs")

MAX_REJECT_RATIO = 0.01
MIN_PARCELS = 1_000_000
CHUNK = 5000


# ---------------------------------------------------------------------------
# החלק הטהור: רשומה + טבעת -> שורה. בלי רשת ובלי מסד (parcels_open_test.py)
# ---------------------------------------------------------------------------

def ring_centroid(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """מרכז המסה של טבעת (נוסחת השטח). טבעת מנוונת - מרכז התיבה."""
    if not points:
        return None
    a = cx = cy = 0.0
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-9:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))


def as_int(v) -> int | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) else None


def clean_text(v, limit: int = 100) -> str | None:
    s = str(v or "").strip()
    return s[:limit] or None


def to_row(rec: dict, centroid_itm: tuple[float, float] | None, to_wgs) -> dict | None:
    """רשומת dbf + מרכז ב-ITM -> שורת parcels_open, או None אם פגומה."""
    gush = as_int(rec.get("GUSH_NUM"))
    helka = as_int(rec.get("PARCEL"))
    suffix = as_int(rec.get("GUSH_SUFFI")) or 0
    if not gush or not helka or gush <= 0 or helka <= 0 or gush > 9_999_999 or helka > 99_999 or suffix < 0:
        return None
    area = rec.get("LEGAL_AREA")
    try:
        area = float(area)
    except (TypeError, ValueError):
        area = None
    if area is not None and (area <= 0 or area > 100_000_000):
        area = None
    lat = lng = None
    if centroid_itm:
        lng, lat = to_wgs(*centroid_itm)
        # תיבת ישראל גסה, כמו govmap_save_planning: מחוץ לה = תרגום שקרס
        if not (29.3 <= lat <= 33.5 and 34.2 <= lng <= 35.95):
            lat = lng = None
    return {
        "gush": gush, "gush_suffix": suffix, "helka": helka,
        "legal_area": area,
        "status_text": clean_text(rec.get("STATUS_TEX")),
        "locality_code": as_int(rec.get("LOCALITY_I")) or None,
        "locality_name": clean_text(rec.get("LOCALITY_N")),
        "municipality": clean_text(rec.get("REG_MUN_NA")),
        "lat": round(lat, 7) if lat is not None else None,
        "lng": round(lng, 7) if lng is not None else None,
    }


def make_transform():
    from pyproj import Transformer
    t = Transformer.from_crs(ITM_DEF, "EPSG:4326", always_xy=True)
    return lambda x, y: t.transform(x, y)


def iter_rows(shp_base: str, to_wgs, stats: collections.Counter) -> Iterator[dict]:
    import shapefile  # pyshp

    sf = shapefile.Reader(shp_base, encoding="utf-8")
    for sr in sf.iterShapeRecords():
        stats["read"] += 1
        shape = sr.shape
        pts = shape.points
        end = shape.parts[1] if len(shape.parts) > 1 else len(pts)
        ring = [(float(x), float(y)) for x, y in pts[:end]]
        row = to_row(sr.record.as_dict(), ring_centroid(ring), to_wgs)
        if row is None:
            stats["rejected"] += 1
            continue
        if row["lat"] is None:
            stats["no_point"] += 1
        yield row


# ---------------------------------------------------------------------------
# רשת
# ---------------------------------------------------------------------------

def resolve_source(session) -> tuple[str, str | None]:
    res = session.get(CKAN_SHOW, timeout=60)
    res.raise_for_status()
    body = res.json()
    if not body.get("success"):
        raise RuntimeError(f"CKAN החזיר success=false: {str(body)[:300]}")
    r = body["result"]
    return r["url"], r.get("last_modified") or r.get("metadata_modified")


def download(session, url: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".zip")
    with os.fdopen(fd, "wb") as out, session.get(url, stream=True, timeout=900) as res:
        ctype = res.headers.get("Content-Type", "")
        if res.status_code != 200 or "html" in ctype.lower():
            raise RuntimeError(f"שרת הקבצים החזיר {res.status_code} {ctype} - חסימה?")
        for chunk in res.iter_content(1 << 20):
            out.write(chunk)
    log.info("הורדו %.1f MB", os.path.getsize(path) / 1e6)
    return path


def extract(zip_path: str) -> str:
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(tmp)
        shp = [n for n in z.namelist() if n.lower().endswith(".shp")]
    if len(shp) != 1:
        raise RuntimeError(f"ציפינו ל-shp אחד בקובץ, נמצאו {shp!r}")
    return os.path.join(tmp, shp[0][:-4])


# ---------------------------------------------------------------------------
# מסד
# ---------------------------------------------------------------------------

def last_done_source_modified(client) -> str | None:
    res = (client.table("parcels_open_loads").select("source_modified")
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


def write_chunk(client, rows: list[dict]) -> None:
    for attempt in range(4):
        try:
            client.table("parcels_open").upsert(rows, on_conflict="gush,helka,gush_suffix").execute()
            return
        except Exception as err:  # noqa: BLE001 - רשת או PostgREST: נסיגה ואז כשל
            if attempt == 3:
                raise
            wait = 2 ** (attempt + 1)
            log.warning("מנה נכשלה (%s), ניסיון נוסף בעוד %ds", err, wait)
            time.sleep(wait)


# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="zip מקומי במקום הורדה")
    ap.add_argument("--dry-run", action="store_true", help="ניתוח בלבד, בלי כתיבה למסד")
    ap.add_argument("--force", action="store_true", help="טעינה גם אם הקובץ לא השתנה")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    source_url, source_modified = (args.file, None) if args.file else resolve_source(session)
    log.info("מקור: %s (עודכן %s)", source_url, source_modified or "לא ידוע")

    client = None
    if not args.dry_run:
        from supabase import create_client
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        if not args.force and same_instant(source_modified, last_done_source_modified(client)):
            log.info("הקובץ לא השתנה מאז הטעינה האחרונה - אין מה לעשות.")
            return 0

    shp_base = extract(args.file if args.file else download(session, source_url))
    to_wgs = make_transform()
    stats: collections.Counter = collections.Counter()
    batch = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    if client:
        client.table("parcels_open_loads").insert({
            "batch": batch, "source_url": source_url, "source_modified": source_modified,
        }).execute()

    pending: dict[tuple[int, int, int], dict] = {}
    written = 0
    try:
        for row in iter_rows(shp_base, to_wgs, stats):
            # אותה חלקה פעמיים באותה מנה: ‏upsert נכשל ("cannot affect row a second time")
            pending[(row["gush"], row["helka"], row["gush_suffix"])] = row
            if len(pending) >= CHUNK:
                if client:
                    write_chunk(client, [dict(r, batch=batch) for r in pending.values()])
                written += len(pending)
                pending.clear()
                if (written // CHUNK) % 20 == 0:
                    log.info("נקראו %d, נכתבו %d", stats["read"], written)
        if pending:
            if client:
                write_chunk(client, [dict(r, batch=batch) for r in pending.values()])
            written += len(pending)
    except Exception as err:  # noqa: BLE001
        if client:
            client.table("parcels_open_loads").update({
                "status": "failed", "error": str(err)[:500],
                "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }).eq("batch", batch).execute()
        log.error("✗ הטעינה נכשלה: %s. הנתונים הקודמים נשארו.", err)
        return 1

    log.info("נקראו %d חלקות: %d נדחו, %d בלי נקודה, %d נכתבו",
             stats["read"], stats["rejected"], stats["no_point"], written)
    problem = None
    if not stats["read"]:
        problem = "הקובץ ריק"
    elif stats["rejected"] / stats["read"] > MAX_REJECT_RATIO:
        problem = f"{stats['rejected']} מתוך {stats['read']} נדחו - מעל {MAX_REJECT_RATIO:.0%}. פורמט אחר?"
    elif written < MIN_PARCELS:
        problem = f"רק {written} חלקות, הסף {MIN_PARCELS}. קובץ חלקי?"

    if not client:
        if problem:
            log.error("✗ %s", problem)
            return 1
        log.info("✓ הרצה יבשה - לא נכתב דבר.")
        return 0

    client.table("parcels_open_loads").update({
        "rows_read": stats["read"], "rows_rejected": stats["rejected"],
    }).eq("batch", batch).execute()
    if problem:
        client.table("parcels_open_loads").update({
            "status": "failed", "error": problem,
            "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }).eq("batch", batch).execute()
        log.error("✗ %s. הנתונים הקודמים נשארו.", problem)
        return 1

    res = client.rpc("parcels_open_finish", {"p_batch": batch, "p_min_parcels": MIN_PARCELS}).execute()
    out = res.data or {}
    if not out.get("ok"):
        log.error("✗ הסיום נדחה: %s", out)
        return 1
    log.info("✓ נטענו %d חלקות, נמחקו %d ישנות.", out.get("parcels", 0), out.get("deleted", 0))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
