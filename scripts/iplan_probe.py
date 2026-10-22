#!/usr/bin/env python3
"""בדיקה לפני שבונים: האם שירות XPlan של מינהל התכנון עונה ל-GitHub Actions, ומה בו.

ייעוד ותוכניות אינם בשכבת החלקות הפתוחה (docs/parcels-open.md), ו-GovMap
מותר לנו רק מצד הלקוח. מינהל התכנון מפרסם את אותו מידע בשירות ArcGIS ציבורי
(‏ags.iplan.gov.il, "קווים כחולים" - XPlan), בלי טוקן, ובעמוד השירות ב-gov.il
כתוב שהנתונים הגולמיים "ניתנים לשימוש חופשי". שכבה 4 - ייעודי קרקע (מבא"ת),
שכבה 1 - תחומי התוכניות.

שלוש שאלות, ולכן בדיקה ולא קוד:

1. השרת עונה ל-GitHub, **עם אימות TLS רגיל**? (לא מבטלים אימות.)
2. מה חוזר לנקודה - בעפולה (מול השכבה העירונית) ומחוץ לה.
3. יש גם מאגר להורדה ב-data.gov.il ("תוכניות מקוונות")?

קריאה בלבד, בלי מסד ובלי סודות. ‏.github/workflows/iplan_probe.yml.
"""

from __future__ import annotations

import json
import sys

import requests

BASE = "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic"
XPLAN = f"{BASE}/Xplan_6991/MapServer"
CKAN = "https://data.gov.il/api/3/action"
USER_AGENT = "shuknadlan.co.il planning probe"

# (שם, x, y, inSR). דפנה 4 עפולה - הנקודה שאומתה מול השכבה העירונית; חלקת
# הייחוס של עפולה ב-ITM; ושתי נקודות מחוץ לעפולה ב-WGS84.
POINTS = [
    ("דפנה 4 עפולה", 227917.84, 724484.08, 2039),
    ("עפולה 16742/96", 227673.75, 724876.11, 2039),
    ("ראשון לציון - מרכז", 34.8044, 31.9642, 4326),
    ("חיפה - הדר", 34.9896, 32.8065, 4326),
]


def get(session, url, **params):
    res = session.get(url, params=params, timeout=60)
    ctype = res.headers.get("Content-Type", "")
    if res.status_code != 200 or not res.text.lstrip().startswith(("{", "[")):
        raise RuntimeError(f"{res.status_code} {ctype}: {res.text[:200]}")
    return res.json()


def point_query(session, layer: int, x: float, y: float, sr: int) -> list[dict]:
    data = get(session, f"{XPLAN}/{layer}/query",
               where="1=1", geometry=json.dumps({"x": x, "y": y}), geometryType="esriGeometryPoint",
               inSR=str(sr), spatialRel="esriSpatialRelIntersects", outFields="*",
               returnGeometry="false", f="json")
    if "error" in data:
        raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))
    return [f.get("attributes", {}) for f in data.get("features", [])]


def main() -> int:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    ok = True

    try:
        root = get(s, BASE, f="json")
        print("✓ שירותים:", json.dumps([x.get("name") for x in root.get("services", [])], ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print("✗ ספריית השירותים:", e)
        ok = False

    try:
        meta = get(s, XPLAN, f="json")
        print("✓ שכבות:", json.dumps([(l["id"], l["name"]) for l in meta.get("layers", [])], ensure_ascii=False))
        for lid in (1, 4):
            lm = get(s, f"{XPLAN}/{lid}", f="json")
            print(f"  שכבה {lid}: maxRecordCount={lm.get('maxRecordCount')} | שדות:",
                  json.dumps([f["name"] for f in lm.get("fields", [])], ensure_ascii=False))
            cnt = get(s, f"{XPLAN}/{lid}/query", where="1=1", returnCountOnly="true", f="json")
            print(f"  שכבה {lid}: {cnt.get('count')} ישויות")
    except Exception as e:  # noqa: BLE001
        print("✗ מטא-דאטה:", e)
        ok = False

    for name, x, y, sr in POINTS:
        for lid in (4, 1):
            try:
                rows = point_query(s, lid, x, y, sr)
                print(f"\n== {name} | שכבה {lid}: {len(rows)}")
                for r in rows[:6]:
                    print(json.dumps(r, ensure_ascii=False, default=str)[:900])
            except Exception as e:  # noqa: BLE001
                print(f"\n✗ {name} | שכבה {lid}:", e)
                ok = False

    s.headers["User-Agent"] = "datagov-external-client"
    for q in ("תוכניות מקוונות", "xplan", "קווים כחולים", "יעודי קרקע", "מינהל התכנון"):
        try:
            res = get(s, f"{CKAN}/package_search", q=q, rows=10)
            print(f"\nCKAN '{q}':")
            for p in res["result"]["results"]:
                org = (p.get("organization") or {}).get("title")
                print(" ", json.dumps({"name": p.get("name"), "title": p.get("title"), "org": org,
                                       "license": p.get("license_title"),
                                       "resources": [(r.get("name"), r.get("format"), r.get("url"), r.get("last_modified"))
                                                     for r in p.get("resources", [])][:6]},
                                      ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            print(f"✗ CKAN '{q}':", e)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
