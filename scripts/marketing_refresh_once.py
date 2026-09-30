"""רענון חד-פעמי של התיאור השיווקי והפוסט לנכסים הפעילים (30.9.2026).

למה: הפרומפט השתנה (PR #518) - הפוסט כבר לא חוזר על שורות העובדות,
והמאפיינים מגיעים למודל בעברית. נוסח שכבר נשמר אינו משתנה מעצמו.

מה נוגעים בו, ומה לא:
  * רק נכסים שהתיאור שלהם נכתב בידי Claude (marketing_description_source='ai').
    טקסט שסוכן/ת כתב/ה ביד נשאר כמו שהוא.
  * הקריאה היא כקורא פנימי (service role) ובלי שורת תור, ולכן
    mark_property_description לא נקראת ואין התראה לסוכן/ת.
  * עדכון התיאור והפוסט אינו מפעיל פרסום חדש ברשתות ואינו שולח התראות
    לחיפושים שמורים: הטריגרים האלה מאזינים ל-status, מחיר ומפרט בלבד.

  python scripts/marketing_refresh_once.py --dry-run   # רשימה בלבד
  python scripts/marketing_refresh_once.py
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def request(method: str, path: str, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, method=method, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pause", type=float, default=3.0)
    args = ap.parse_args()

    status, rows = request(
        "GET",
        "/rest/v1/properties?select=id,listing_number"
        "&status=eq.active&marketing_description_source=eq.ai&order=listing_number",
    )
    if status != 200:
        print(f"קריאת הנכסים נכשלה: {status} {rows}")
        return 1
    if args.limit:
        rows = rows[: args.limit]
    print(f"{len(rows)} נכסים פעילים עם תיאור שנכתב בידי Claude")

    if args.dry_run:
        print(", ".join(str(r["listing_number"]) for r in rows))
        return 0

    failed = []
    for i, r in enumerate(rows, 1):
        status, res = request(
            "POST",
            "/functions/v1/property-description",
            {"property_id": r["id"], "mode": "apply", "replace_post": True},
        )
        ok = status == 200 and isinstance(res, dict) and res.get("ok")
        print(f"[{i}/{len(rows)}] מודעה {r['listing_number']}: {'✓' if ok else f'✗ {status} {res}'}")
        if not ok:
            failed.append(r["listing_number"])
            # מפתח Anthropic שנדחה יפיל את כולם - אין טעם להמשיך.
            if status == 503:
                break
        time.sleep(args.pause)

    print(f"\nהסתיים: {len(rows) - len(failed)} עודכנו, {len(failed)} נכשלו {failed or ''}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
