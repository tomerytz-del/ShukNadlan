#!/usr/bin/env python3
"""הגוף האחרון של פונקציה משותפת, לפי version ולא לפי שם הקובץ.

בדגל כבוי scraped_lead_notify_demand שומרת את תקרת 15 של 20271029140000.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations"


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


def version_of(path: Path) -> str:
    name = path.name
    return name[:14] if len(name) >= 14 and name[:14].isdigit() else name


def bodies(text: str) -> list[tuple[str, str]]:
    found = []
    for m in re.finditer(r"create\s+or\s+replace\s+function\s+(public\.\w+)", text, re.I):
        q = re.search(r"\$([A-Za-z0-9_]*)\$", text[m.end():])
        if not q:
            continue
        tag = q.group(0)
        start = m.end() + q.end()
        end = text.find(tag, start)
        if end < 0:
            continue
        found.append((m.group(1).lower(), text[start:end]))
    return found


def main() -> int:
    final: dict[str, str] = {}
    where: dict[str, str] = {}
    for path in sorted(MIG.glob("*.sql"), key=lambda p: (version_of(p), p.name)):
        for name, body in bodies(path.read_text(encoding="utf-8")):
            final[name] = body
            where[name] = path.name
    body = final.get("public.scraped_lead_notify_demand")
    if not body:
        fail("אין scraped_lead_notify_demand")
    off = body.split("if not v_on then", 1)[-1].split("else", 1)[0]
    if "notif_burst_demand_fanout" not in off or "s.rn > v_fanout" not in off and "s.rn > v_cap" not in off:
        fail(f"דגל כבוי ב-{where['public.scraped_lead_notify_demand']} בלי תקרת 15")
    if "s.rn >" not in off:
        fail("דגל כבוי לא מגביל וואטסאפ לפי דירוג")
    print("✓ דגל כבוי שומר את תקרת 15 של הביקוש הפתוח.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
