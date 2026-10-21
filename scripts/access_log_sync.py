#!/usr/bin/env python3
"""
מעתיק את יומני הגישה של Supabase לטבלה data_access_log, ששם הם נשמרים 3 שנים.

‏**למה:** תקנה 10 לתקנות הגנת הפרטיות (אבטחת מידע) דורשת תיעוד של כל ניסיון
גישה למאגר - מי, מתי, לאיזה רכיב, ואם הותר - ושמירה של 24 חודשים לפחות.
שער ה-API של Supabase כבר רושם את כל זה, אבל שומר ימים בודדים. הסקריפט הזה
הוא הגשר: הוא רץ כל שעה (‏.github/workflows/access_log.yml), שואל את
‏Management API על החלון שמאז הריצה הקודמת, וכותב למסד.

‏**שתי ערובות שהוא לא מאבד שורות:**
  * חפיפה של 15 דקות אחורה מהסמן בכל ריצה - שורות לוג מגיעות באיחור של
    דקות. ‏log_id הוא מפתח ראשי, ולכן החפיפה אינה מכפילה.
  * ה-API מחזיר עד 1,000 שורות לשאילתה. חלון שהחזיר 1,000 מתפצל לשניים
    עד שכל חצי קטן מהתקרה - אחרת השורות שמעבר לתקרה נעלמות בשקט.

‏**מה נכנס ומה לא** - ראו EXCLUDED_PATHS למטה ו-docs/data-access-log.md.

משתני סביבה: SUPABASE_ACCESS_TOKEN (‏Management API), ‏SUPABASE_DB_URL.
‏--dry-run מדפיס כמה שורות היו נכתבות, בלי לכתוב.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

PROJECT_REF = "obookujgolazrwycsiyn"
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/analytics/endpoints/logs"

# ‏ה-API מגביל חלון ל-24 שעות. ‏Supabase שומרת את היומן 7 ימים בתוכנית Pro,
# ולכן בריצה הראשונה (או אחרי השבתה) חוזרים עד 6 ימים - יותר מזה כבר אינו שם.
MAX_BACKFILL = timedelta(days=6)
OVERLAP = timedelta(minutes=15)
# שורות לוג מגיעות באיחור; את 3 הדקות האחרונות משאירים לריצה הבאה
LAG = timedelta(minutes=3)
# ‏3 שעות ולא שעה: השלמה של 6 ימים הייתה 288 בקשות, ו-Supabase חסמה ב-429
# אחרי כעשר (21.10.2026). ‏~5,200 שורות ביום הן ~650 לחלון - מתחת לתקרה, ומה
# שעובר אותה מתפצל ב-fetch_window.
CHUNK = timedelta(hours=3)
MIN_CHUNK = timedelta(seconds=30)
ROW_CAP = 1000
# הפסקה בין בקשות, כדי לא להגיע למגבלת הקצב מלכתחילה
PACE = 2.0


class RateLimited(RuntimeError):
    """‏429 שלא עבר גם אחרי ההמתנות. הריצה עוצרת ושומרת את מה שהספיקה."""

# ‏טבלאות עזר ציבוריות ונכסים ציבוריים: אין בהם מידע אישי, והם ~40% מהתעבורה.
# **כל טבלה שמחזיקה מידע על אדם נשארת ביומן.** מי שמוסיף/ה כאן שורה מוודא/ת
# קודם שאין בה שדה של אדם (שם, טלפון, מייל, הערה).
EXCLUDED_PATHS = (
    r"^/rest/v1/(neighborhoods|street_registry|street_registry_aliases|cities"
    r"|market_cities_public|pricing_config|articles|rss_sources|market_deals"
    r"|property_planning_info)$"
    r"|^/rest/v1/[a-z_]+_public$"
    r"|^/rest/v1/rpc/(property_map_enabled|property_visualizations_enabled"
    r"|homepage_agent_cards|homepage_agency_cards|my_wallet_refundable_amount"
    r"|my_phone_line_quota|mfa_status|agent_onboarding_state)$"
    r"|^/storage/v1/object/public/"
    r"|^/storage/v1/object/property-images/"
)

API_SQL = """
select id,
       timestamp,
       log_attributes['request.sb.auth_user'] as user_id,
       log_attributes['request.sb.jwt.authorization.payload.role'] as role,
       log_attributes['request.sb.jwt.authorization.payload.session_id'] as session_id,
       log_attributes['request.method'] as method,
       log_attributes['request.path'] as path,
       log_attributes['request.search'] as query,
       log_attributes['response.status_code'] as status,
       log_attributes['request.headers.cf_connecting_ip'] as ip,
       log_attributes['request.cf.country'] as country,
       log_attributes['request.headers.user_agent'] as user_agent
from logs
where source = 'edge_logs'
  and log_attributes['request.method'] != 'OPTIONS'
  and match(log_attributes['request.path'], '^/(rest|storage|functions|graphql)/v1/')
  and not match(log_attributes['request.path'], '{excluded}')
  and (log_attributes['request.sb.jwt.authorization.payload.role'] in ('authenticated', 'service_role')
       or log_attributes['response.status_code'] in ('401', '403'))
order by timestamp
limit {cap}
"""

AUTH_SQL = """
select id,
       timestamp,
       log_attributes['auth_audit_event.actor_id'] as user_id,
       log_attributes['auth_audit_event.action'] as action,
       log_attributes['auth_audit_event.user_agent'] as user_agent
from logs
where source = 'auth_audit_logs'
order by timestamp
limit {cap}
"""


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _uuid(v) -> str | None:
    try:
        return str(uuid.UUID(str(v))) if v else None
    except ValueError:
        return None


def _ts(v: str) -> datetime:
    # ‏'2026-10-12T13:25:30.431000' ב-UTC, לפעמים עם רווח במקום T
    v = str(v).replace(" ", "T").rstrip("Z")
    return datetime.fromisoformat(v).replace(tzinfo=timezone.utc)


def query_logs(token: str, sql: str, start: datetime, end: datetime) -> list[dict]:
    params = urllib.parse.urlencode({
        "sql": sql,
        "iso_timestamp_start": _iso(start),
        "iso_timestamp_end": _iso(end),
    })
    req = urllib.request.Request(f"{API}?{params}", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    })
    time.sleep(PACE)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.load(r)
            break
        except urllib.error.HTTPError as e:
            # ‏429: מגבלת קצב של ה-Management API - מחכים (‏Retry-After אם נשלח)
            # ומנסים שוב. ההמתנות הקודמות (‏3-24 שניות) לא הספיקו לחלון שלה.
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                retry_after = e.headers.get("Retry-After", "") if e.headers else ""
                wait = int(retry_after) if retry_after.isdigit() else 10 * 2 ** attempt
                time.sleep(min(wait, 120))
                continue
            msg = f"logs API {e.code}: {e.read()[:300]!r}"
            raise (RateLimited if e.code == 429 else RuntimeError)(msg) from None
    if body.get("error"):
        raise RuntimeError(f"logs API error: {json.dumps(body['error'])[:300]}")
    return body.get("result") or []


def fetch_window(token: str, sql: str, start: datetime, end: datetime) -> list[dict]:
    """שורות החלון, ומפצל חלון שנתקע בתקרה עד שהוא נכנס."""
    rows = query_logs(token, sql, start, end)
    if len(rows) < ROW_CAP:
        return rows
    if end - start <= MIN_CHUNK:
        # לא אמור לקרות (1,000 בקשות ב-30 שניות). אם קרה - לא שותקים עליו.
        raise RuntimeError(f"more than {ROW_CAP} rows in {start}..{end}; cannot split further")
    mid = start + (end - start) / 2
    return fetch_window(token, sql, start, mid) + fetch_window(token, sql, mid, end)


def api_row(r: dict) -> tuple:
    status = str(r.get("status") or "")
    return (
        r["id"], _ts(r["timestamp"]), "api",
        _uuid(r.get("user_id")), (r.get("role") or None),
        _uuid(r.get("session_id")), r.get("method") or None,
        (r.get("path") or "")[:500] or None,
        (r.get("query") or "")[:1000] or None,
        int(status) if status.isdigit() else None,
        r.get("ip") or None, r.get("country") or None,
        (r.get("user_agent") or "")[:300] or None, None,
    )


def auth_row(r: dict) -> tuple:
    return (
        r["id"], _ts(r["timestamp"]), "auth",
        _uuid(r.get("user_id")), None, None, None, None, None, None, None, None,
        (r.get("user_agent") or "")[:300] or None, r.get("action") or None,
    )


INSERT = """
insert into public.data_access_log
  (log_id, at, kind, user_id, role, session_id, method, path, query, status,
   ip, country, user_agent, action)
values %s
on conflict (log_id) do nothing
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    dsn = os.environ.get("SUPABASE_DB_URL", "")
    if not token or not dsn:
        print("::error::SUPABASE_ACCESS_TOKEN ו-SUPABASE_DB_URL נדרשים", file=sys.stderr)
        return 1

    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(dsn, connect_timeout=15)
    conn.autocommit = False
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("select synced_until from public.data_access_log_sync where id = 1")
        row = cur.fetchone()
    synced = row[0] if row and row[0] else None

    start = max((synced or now - MAX_BACKFILL) - OVERLAP, now - MAX_BACKFILL)
    end = now - LAG
    api_sql = API_SQL.format(excluded=EXCLUDED_PATHS.replace("'", "''").replace("\\", "\\\\"), cap=ROW_CAP)
    auth_sql = AUTH_SQL.format(cap=ROW_CAP)

    total = 0
    error = None
    # ‏429 אחרי שחלונות כבר נכתבו אינו כישלון: בהשלמה ארוכה (אחרי השבתה) זה
    # צפוי, והריצה הבאה ממשיכה מהסמן. ריצה כזו יוצאת ירוקה עם אזהרה, ולא
    # אדומה בכל שעה עד שההשלמה נגמרת. ‏429 בלי שום התקדמות - נכשל.
    partial = None
    t = start
    try:
        while t < end:
            t2 = min(t + CHUNK, end)
            try:
                rows = [api_row(r) for r in fetch_window(token, api_sql, t, t2)]
                rows += [auth_row(r) for r in fetch_window(token, auth_sql, t, t2)]
            except RateLimited:
                if t == start:
                    raise
                partial = t
                break
            if not args.dry_run:
                with conn.cursor() as cur:
                    if rows:
                        psycopg2.extras.execute_values(cur, INSERT, rows, page_size=500)
                    cur.execute(
                        "update public.data_access_log_sync set synced_until = %s where id = 1", (t2,))
                conn.commit()
            total += len(rows)
            print(f"{_iso(t)} .. {_iso(t2)}: {len(rows)} rows")
            t = t2
    except Exception as e:  # noqa: BLE001 - נרשם בסמן ומפיל את הריצה
        conn.rollback()
        error = str(e)[:500]

    if not args.dry_run:
        with conn.cursor() as cur:
            if error is None:
                cur.execute(
                    "update public.data_access_log_sync set synced_until = %s, last_run_at = now(),"
                    " last_rows = %s, last_error = null where id = 1", (partial or end, total))
            else:
                cur.execute(
                    "update public.data_access_log_sync set last_run_at = now(), last_rows = %s,"
                    " last_error = %s where id = 1", (total, error))
        conn.commit()
    conn.close()

    if error:
        print(f"::error::הסנכרון נכשל: {error}", file=sys.stderr)
        return 1
    if partial:
        print(f"::warning::מגבלת קצב של Supabase - נעצר ב-{_iso(partial)},"
              f" הריצה הבאה ממשיכה משם ({total} שורות נכתבו)")
    print(f"done: {total} rows {'(dry run)' if args.dry_run else 'written'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
