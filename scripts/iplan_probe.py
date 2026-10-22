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
3. יש גם מאגר להורדה ב-data.gov.il ("תוכניות מקוונות")? - יש (‏xplan2), עם
   תאריך 2022 במטא-דאטה. ‏--zip מוריד אותו ובודק מה בפנים ומה התאריכים.

**ריצה 1 (22.10.2026):** ‏SSLV3_ALERT_HANDSHAKE_FAILURE - השרת מציע רק צפנים
ישנים. כאן מורידים את רמת הצופן (‏SECLEVEL=1) **ומשאירים את אימות התעודה** -
לא ‏CERT_NONE כמו בסקריפט שהגיע אלינו: בלי אימות, כל מי שבאמצע מחליף את
התשובה.

קריאה בלבד, בלי מסד ובלי סודות. ‏.github/workflows/iplan_probe.yml.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import tempfile
import zipfile

import requests
from requests.adapters import HTTPAdapter

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


class LegacyCipherAdapter(HTTPAdapter):
    """צפנים ישנים, **עם** אימות תעודה ושם שרת."""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


def inspect_zip(session, url: str) -> None:
    fd, path = tempfile.mkstemp(suffix=".zip")
    with os.fdopen(fd, "wb") as out, session.get(url, stream=True, timeout=900) as res:
        print(f"\nהורדה: {res.status_code} {res.headers.get('Content-Type')} "
              f"{res.headers.get('Content-Length')} | Last-Modified: {res.headers.get('Last-Modified')}")
        if res.status_code != 200:
            return
        for chunk in res.iter_content(1 << 20):
            out.write(chunk)
    print(f"הורדו {os.path.getsize(path) / 1e6:.1f} MB")
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        print("בקובץ:", json.dumps([(i.filename, i.file_size, "%04d-%02d-%02d" % i.date_time[:3]) for i in infos[:60]],
                                    ensure_ascii=False))
        z.extractall(tmp)
    import shapefile  # pyshp

    for root, _dirs, files in os.walk(tmp):
        for f in files:
            if not f.lower().endswith(".shp"):
                continue
            base = os.path.join(root, f[:-4])
            for enc in ("utf-8", "cp1255"):
                try:
                    sf = shapefile.Reader(base, encoding=enc)
                    fields = [x[0] for x in sf.fields[1:]]
                    print(f"\n== {f} | {enc} | {len(sf)} רשומות | {sf.shapeTypeName} | bbox {sf.bbox}")
                    print("שדות:", fields)
                    for i in range(min(2, len(sf))):
                        print("דוגמה:", json.dumps(sf.record(i).as_dict(), ensure_ascii=False, default=str)[:900])
                    # התאריך המאוחר ביותר בכל שדה תאריך - כמה טרי המאגר באמת
                    dates = [k for k, t, *_ in sf.fields[1:] if t == "D" or "date" in k.lower() or "DATE" in k]
                    for k in dates[:6]:
                        vals = [str(r[k]) for r in sf.iterRecords(fields=[k]) if r[k]]
                        print(f"  {k}: מקסימום {max(vals) if vals else None}")
                    break
                except UnicodeDecodeError:
                    continue
                except Exception as e:  # noqa: BLE001
                    print(f"✗ {f}:", e)
                    break


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
    s.mount("https://ags.iplan.gov.il/", LegacyCipherAdapter())
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
            # ספירה על כל השכבה - מידע בלבד, ונתקעת אחרי 60 שניות (ריצה 2). לא נכשלים עליה.
            try:
                cnt = get(s, f"{XPLAN}/{lid}/query", where="1=1", returnCountOnly="true", f="json")
                print(f"  שכבה {lid}: {cnt.get('count')} ישויות")
            except Exception as e:  # noqa: BLE001
                print(f"  שכבה {lid}: הספירה לא חזרה ({e})")
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

    if "--zip" in sys.argv:
        try:
            meta = get(s, f"{CKAN}/package_show", id="xplan2")["result"]
            for r in meta.get("resources", []):
                print("\nמשאב:", json.dumps({k: r.get(k) for k in ("name", "url", "size", "last_modified", "created",
                                                                   "metadata_modified", "description")},
                                            ensure_ascii=False))
            newest = max(meta["resources"], key=lambda r: r.get("last_modified") or r.get("created") or "")
            # כמו direct_url ב-parcels_open_loader.py: aws-e עונה ל-GitHub ב-HTML
            inspect_zip(s, newest["url"].replace("://aws-e.data.gov.il/", "://data.gov.il/"))
        except Exception as e:  # noqa: BLE001
            print("✗ xplan2:", e)
            ok = False

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
