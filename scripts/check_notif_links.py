#!/usr/bin/env python3
"""הקישור בוואטסאפ מוביל לאותה קטגוריה כמו הפעמון.

שתי מפות אומרות לאן התראה מובילה: ‏`NOTIF_TYPES` ב-assets/crm.js (הפעמון)
ו-`ACC_BY_TYPE` ב-supabase/functions/notification-push/index.ts (ההודעה
בוואטסאפ). סוג שחסר בשנייה אינו שגיאה - הוא נופל ל-`MANAGE_ACC`, הגדרות
ההתראות. כך שבעה סוגים (ביקורת ממתינה, ליד בלי יעד, ארבע התראות ההתחלה
ועוד) שלחו את הסוכן/ת בוואטסאפ למסך ההגדרות ולא לפריט, בלי שום סימן.

הבדיקה: כל סוג ב-NOTIF_TYPES נמצא ב-ACC_BY_TYPE עם אותה קטגוריה, וכל
קטגוריה בשתיהן קיימת כ-id ב-crm.html.

    python scripts/check_notif_links.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def bell_map() -> dict[str, str]:
    js = (ROOT / "assets/crm.js").read_text(encoding="utf-8")
    start = js.index("const NOTIF_TYPES")
    block = js[start:js.index("];", start)]
    out = {}
    for entry in re.findall(r"\{[^{}]*\btype\s*:\s*'[a-z_]+'[^{}]*\}", block, re.S):
        t = re.search(r"\btype\s*:\s*'([a-z_]+)'", entry).group(1)
        g = re.search(r"\bgoto\s*:\s*'(acc\w+)'", entry)
        if g:
            out[t] = g.group(1)
    return out


def push_map() -> dict[str, str]:
    ts = (ROOT / "supabase/functions/notification-push/index.ts").read_text(encoding="utf-8")
    start = ts.index("const ACC_BY_TYPE")
    block = ts[start:ts.index("};", start)]
    block = re.sub(r"//[^\n]*", "", block)
    return dict(re.findall(r"\b([a-z_]+)\s*:\s*\"(acc\w+)\"", block))


def main() -> int:
    html = (ROOT / "crm.html").read_text(encoding="utf-8")
    ids = set(re.findall(r'\bid="([A-Za-z0-9_-]+)"', html))
    bell, push = bell_map(), push_map()
    if not bell or not push:
        print("✗ לא נמצאה אחת המפות - הבדיקה צריכה עדכון")
        return 1

    errors = []
    for t, acc in sorted(bell.items()):
        if t not in push:
            errors.append(f"{t}: בפעמון {acc}, בוואטסאפ חסר (נופל להגדרות ההתראות)")
        elif push[t] != acc:
            errors.append(f"{t}: בפעמון {acc}, בוואטסאפ {push[t]}")
    for t, acc in sorted({**bell, **push}.items()):
        for name, m in (("NOTIF_TYPES", bell), ("ACC_BY_TYPE", push)):
            if t in m and m[t] not in ids:
                errors.append(f"{t}: {m[t]} ב-{name} אינו id ב-crm.html")

    if errors:
        for e in errors:
            print("✗", e)
        print("\nסוג התראה מוביל לאותה קטגוריה בפעמון (NOTIF_TYPES ב-assets/crm.js)")
        print("ובוואטסאפ (ACC_BY_TYPE ב-notification-push). הסקיל agent-notifications.")
        return 1
    print(f"✓ {len(bell)} סוגי התראה מובילים לאותה קטגוריה בפעמון ובוואטסאפ.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
