#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
שער הגאוקוד מול התור: ענף הנכסים של geocode_backfill_pending() חייב לשאול
את אותם תנאים כמו ענף הנכסים של geocode_backfill_queue().

שער צר מהתור משאיר שורות בתור לנצח, בשקט: ה-cron לא קורא לפונקציה, והנכס
נשאר עם פין משוער ובלי שכונה (26.11.2026: 11 נכסים, 864 הרצות "0 rows").
שער רחב מהתור מפעיל את הפונקציה לשווא. התנאים כתובים פעמיים בכוונה
(docs/geocoding.md), ולכן הבדיקה היא ההצלבה.

הבדיקה קוראת את ההגדרה **האחרונה** של כל פונקציה (לפי מספר המיגרציה), ומשווה את
תנאי ה-where על `p.` בענף הנכסים, מנורמלים. אין חיבור למסד.

    python3 scripts/check_geocode_gate.py
"""
import re
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"


def latest_body(name):
    pat = re.compile(r"create\s+or\s+replace\s+function\s+public\." + name + r"\s*\(", re.I)
    best = None
    for f in sorted(MIGRATIONS.glob("*.sql")):
        text = f.read_text(encoding="utf-8")
        for m in pat.finditer(text):
            end = text.find("$$;", text.find("$$", m.end()) + 2)
            if end > 0:
                best = (f.name, text[m.start():end])
    return best


def property_conditions(body):
    """תנאי p.* בענף הנכסים (מה-where הראשון עד ה-union / ה-or exists הבא), מנורמלים."""
    m = re.search(r"\bwhere\b(.*?)(?:union\s+all|or\s+exists|\)\s*q\b|\Z)", body, re.S | re.I)
    chunk = m.group(1) if m else ""
    chunk = re.sub(r"--[^\n]*", "", chunk)
    chunk = re.sub(r"p_max_attempts", "3::smallint", chunk)
    chunk = re.sub(r"p_retry_after", "interval '20 hours'", chunk)
    chunk = re.sub(r"\s+", " ", chunk).lower()
    # ב-where של הענף אין "and" בתוך סוגריים, ולכן פיצול על and מספיק
    return [x.strip() for x in re.split(r"\band\b", chunk) if "p." in x]


def main():
    queue = latest_body("geocode_backfill_queue")
    gate = latest_body("geocode_backfill_pending")
    if not queue or not gate:
        print("לא נמצאה הגדרה של התור או של השער")
        return 1
    q, g = property_conditions(queue[1]), property_conditions(gate[1])
    # הצלבה לפי קבוצת הפרדיקטים על p. (בלי הצטרפות לספק, שהיא באותו מבנה בשניהם)
    key = lambda xs: {re.sub(r"[\s()]", "", x) for x in xs}
    only_q, only_g = key(q) - key(g), key(g) - key(q)
    if only_q or only_g:
        print("שער הגאוקוד (%s) והתור (%s) שואלים תנאים שונים על נכסים:" % (gate[0], queue[0]))
        for x in sorted(only_q):
            print("  רק בתור: " + x)
        for x in sorted(only_g):
            print("  רק בשער: " + x)
        print("שער צר מהתור משאיר נכסים בתור לנצח. עדכנו את שניהם באותה מיגרציה (docs/geocoding.md).")
        return 1
    print("✓ שער הגאוקוד זהה לתור בענף הנכסים (%d תנאים; שער: %s, תור: %s)" % (len(key(q)), gate[0], queue[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
