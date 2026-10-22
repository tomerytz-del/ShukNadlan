#!/usr/bin/env python3
"""בדיקה לפני שכותבים טוען: האם שכבת החלקות הפתוחה זמינה מ-GitHub Actions, ומה בה.

שכבות GovMap אינן מקור לעותק משלנו - תנאי השימוש שלהן אוסרים איסוף בהיקף
בלי אישור בכתב (docs/govmap.md, "תנאי השימוש"). מה שמותר הוא מאגר פתוח
ב-data.gov.il, ושם נמצאה שכבת **החלקות** של המרכז למיפוי ישראל (shape).

שתי שאלות פתוחות, ולכן בדיקה ולא טוען:

1. **שרת הקבצים עונה?** ‏e.data.gov.il חסם את GitHub ב-26.9.2026 (403, ואז
   עמוד HTML עם 200 - docs/land-ownership.md). שם הייתה דרך מילוט דרך
   ‏datastore_search; ל-shapefile אין כזו.
2. **אילו שדות?** גוש, חלקה, שטח רשום, סטטוס, יישוב - ובאיזו רשת קואורדינטות.

הבדיקה רק קוראת: CKAN, הורדה לקובץ זמני, ופתיחת ה-shapefile. אין מסד.

    python3 scripts/parcels_probe.py              # חיפוש, הורדה וקריאה
    python3 scripts/parcels_probe.py --list-only  # רק מה שיש ב-CKAN
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import zipfile

import requests

CKAN = "https://data.gov.il/api/3/action"
# אותו זיהוי שהטוען של הטאבו משתמש בו (land_ownership_loader.py)
USER_AGENT = "datagov-external-client"
QUERIES = ["חלקות", "חלקות shape", "גושים", "קדסטר"]


def find_resources(session) -> list[dict]:
    seen, out = set(), []
    for q in QUERIES:
        res = session.get(f"{CKAN}/package_search", params={"q": q, "rows": 20}, timeout=60)
        res.raise_for_status()
        for pkg in res.json()["result"]["results"]:
            org = (pkg.get("organization") or {}).get("title") or ""
            for r in pkg.get("resources", []):
                if r["id"] in seen:
                    continue
                seen.add(r["id"])
                out.append({
                    "package": pkg.get("name"), "title": pkg.get("title"), "org": org,
                    "license": pkg.get("license_title"), "resource_id": r["id"],
                    "resource": r.get("name"), "format": r.get("format"), "url": r.get("url"),
                    "size": r.get("size"), "modified": r.get("last_modified") or r.get("metadata_modified"),
                })
    return out


def pick(resources: list[dict]) -> dict | None:
    """שכבת החלקות של המרכז למיפוי: shape/zip, "חלקות" בשם, ולא "שומה"."""
    def ok(r):
        text = f"{r['title']} {r['resource']}"
        fmt = (r["format"] or "").upper()
        return ("חלקות" in text and "שומה" not in text and "מיפוי" in r["org"]
                and (fmt in ("SHP", "ZIP", "SHAPEFILE") or (r["url"] or "").lower().endswith(".zip")))
    cands = [r for r in resources if ok(r)]
    return max(cands, key=lambda r: int(r["size"] or 0), default=None)


def probe_download(session, url: str) -> str | None:
    fd, path = tempfile.mkstemp(suffix=".zip")
    with os.fdopen(fd, "wb") as out, session.get(url, stream=True, timeout=600) as res:
        ctype = res.headers.get("Content-Type", "")
        print(f"הורדה: {res.status_code} {ctype} {res.headers.get('Content-Length')}")
        if res.status_code != 200 or "html" in ctype.lower():
            print("✗ שרת הקבצים לא נתן את הקובץ (חסימה?)")
            print(res.text[:300] if "html" in ctype.lower() else "")
            return None
        for chunk in res.iter_content(1 << 20):
            out.write(chunk)
    print(f"✓ הורדו {os.path.getsize(path) / 1e6:.1f} MB")
    return path


def read_shapefile(path: str) -> None:
    import shapefile  # pyshp

    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        print("בקובץ:", json.dumps(names[:30], ensure_ascii=False))
        z.extractall(tmp)
    for shp in [n for n in names if n.lower().endswith(".shp")]:
        base = os.path.join(tmp, shp[:-4])
        prj = base + ".prj"
        print(f"\n== {shp}")
        if os.path.exists(prj):
            print("prj:", open(prj, encoding="utf-8", errors="replace").read()[:300])
        for enc in ("utf-8", "cp1255"):
            try:
                sf = shapefile.Reader(base, encoding=enc)
                print("encoding:", enc, "| רשומות:", len(sf), "| סוג:", sf.shapeTypeName, "| bbox:", sf.bbox)
                print("שדות:", [f[0] for f in sf.fields[1:]])
                for i in range(min(3, len(sf))):
                    print("דוגמה:", json.dumps(sf.record(i).as_dict(), ensure_ascii=False, default=str))
                break
            except UnicodeDecodeError:
                continue


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list-only", action="store_true")
    args = ap.parse_args(argv)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    resources = find_resources(session)
    print(f"נמצאו {len(resources)} משאבים:")
    for r in resources:
        print(json.dumps(r, ensure_ascii=False))
    chosen = pick(resources)
    print("\nנבחר:", json.dumps(chosen, ensure_ascii=False))
    if not chosen or args.list_only:
        return 0 if chosen or args.list_only else 1
    path = probe_download(session, chosen["url"])
    if not path:
        return 1
    read_shapefile(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
