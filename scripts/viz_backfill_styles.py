#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
השלמת הסגנונות החסרים בהדמיות של נכסים פרטיים (‏viz-speed שינוי 1, 1.11.2026).

**עולה כסף, ולכן ברירת המחדל היא ריצה יבשה:** הסקריפט סופר מה חסר ומדפיס את
העלות, ולא שולח דבר. הרצה אמיתית רק עם ‎--run --yes‎, ורק אחרי שתומר אישר את
המספרים (‏docs/property-visualizations.md, "מהירות ועלות").

מה הוא עושה ב-‎--run‎: לכל זוג (נכס, סגנון) שחסר - קריאה פנימית אחת ל-
property-visualize-base עם ה-style, בדיוק כמו הטריגר של הפרסום. הפונקציה
בודקת בעצמה זכאות, תמונות ומה שכבר קיים, ולכן הרצה חוזרת אינה משלמת פעמיים.
שתי קריאות במקביל לכל היותר, עם הפסקה ביניהן.

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/viz_backfill_styles.py
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/viz_backfill_styles.py --run --yes

מחירים לתמונה (‏ai.google.dev/gemini-api/docs/pricing, 1.11.2026) - לחישוב בלבד.
"""

import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

STYLES = ["modern_clean", "mediterranean_white", "warm_scandi", "modern_luxury"]
LAND = ("מגרש", "קרקע", "נחל", "משק", "חקלא")
PRICE = {   # $ לתמונה
    "gemini-3.1-flash-image-preview (היום, 1K)": (0.069, 0.089),
    "gemini-3.1-flash-lite-image / nano-banana-2.1 (1K)": (0.0336, 0.0336),
}


def api(path, method="GET", body=None, timeout=60):
    url = os.environ["SUPABASE_URL"].rstrip("/") + path
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def plan():
    props = api("/rest/v1/properties?select=id,deal_type,property_type&status=eq.active&category=eq.residential&limit=1000")
    props = [p for p in props if not any(w in (p.get("property_type") or "") for w in LAND)]
    rows = api("/rest/v1/property_visualizations?select=property_id,style_key,target,mode,status,result_url"
               "&kind=eq.private_room&limit=10000")
    out = []
    for p in props:
        mode = "staging" if p["deal_type"] == "rent" else "renovation"
        mine = [r for r in rows if r["property_id"] == p["id"] and r["mode"] == mode]
        targets = {r["target"] for r in mine}
        if not targets:
            continue   # נכס שעוד לא קיבל אף הדמיה - הבסיס שלו ייווצר בפרסום/בתור הקיים, לא כאן
        if not api("/rest/v1/rpc/property_visualizations_enabled", "POST", {"p_property_id": p["id"]}):
            continue
        done = {(r["style_key"], r["target"]) for r in mine if r["status"] == "done" and r["result_url"]}
        for s in STYLES:
            miss = [t for t in targets if (s, t) not in done]
            if miss:
                out.append((p["id"], s, len(miss)))
    return out


def main():
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        sys.exit("חסרים SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY")
    todo = plan()
    images = sum(n for _, _, n in todo)
    print(f"נכסים: {len({p for p, _, _ in todo})} · קריאות (נכס, סגנון): {len(todo)} · תמונות: {images}")
    for model, (lo, hi) in PRICE.items():
        print(f"  {model}: ${images * lo:.2f}" + (f" - ${images * hi:.2f}" if hi != lo else ""))
    if "--run" not in sys.argv:
        print("\nריצה יבשה - לא נשלח דבר. להרצה: --run --yes (רק אחרי אישור של תומר).")
        return
    if "--yes" not in sys.argv:
        sys.exit("--run דורש גם --yes")

    def go(item):
        pid, style, _ = item
        try:
            r = api("/functions/v1/property-visualize-base", "POST", {"property_id": pid, "style": style}, timeout=30)
            return pid, style, (r or {}).get("job_id") or (r or {}).get("note") or "ok"
        except Exception as e:   # noqa: BLE001
            return pid, style, f"שגיאה: {e}"
        finally:
            time.sleep(1.5)

    with ThreadPoolExecutor(max_workers=2) as ex:
        for pid, style, res in ex.map(go, todo):
            print(pid, style, res)


if __name__ == "__main__":
    main()
