#!/usr/bin/env python3
"""ההגדרה האחרונה של פונקציות משותפות, לפי סדר ה-version.

מיגרציה מאוחרת שכותבת את הפונקציה מחדש מגוף ישן מוחקת בשקט את מה
שנכנס לפניה. הבדיקה קוראת את הקבצים בסדר השם ונועלת את הגוף האחרון.

כאן, אחרי חלון שישי: send_window_open, תקרת הטלפון, window_on,
suppress_push, burst_prepare, action_path, showcase, ומכסת 15
של הביקוש הפתוח. אין כאן דרישה ל-notification_push_mark_deferred
בתוך ה-claim: הגוף האחרון בענף הזה אינו קורא לה, וה-PR הזה אינו
בונה את ה-claim מחדש.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIG = ROOT / "supabase/migrations"
WIN = MIG / "20271030000100_customer_send_window.sql"

NEED = {
    "public.notification_push_claim": (
        "not n.suppress_push",
        "notification_push_burst_prepare()",
        "action_path",
        "related_showcase_id",
        "'showcase_id'",
    ),
    "public.notification_push_due_agents": (
        "window_on",
        "notification_agent_send_quiet",
    ),
    "public.scraped_lead_notify_demand": (
        "notif_burst_demand_fanout",
    ),
    "public.send_window_open": (
        "Asia/Jerusalem",
        "il_holidays",
        "v_dow = 6",
        "v_kind = 'holiday'",
        "v_kind = 'eve'",
        "v_h >= 8 and v_h < 13",
        "v_h >= 8 and v_h < 21",
    ),
    "public.notification_send_window_open": (
        "send_window_open('agent'",
    ),
    "public.saved_search_quiet_now": (
        "send_window_open('saved_search'",
    ),
    "public.customer_phone_claim": (
        "for update",
        ">= 3",
    ),
    "public.customer_digest_groups": (
        "customer_digest_enabled",
    ),
    "public.app_push_on_saved_search_alert": (
        "send_window_open('customer_push'",
        "customer_phone_claim",
        "customer_message_defer",
    ),
}


def fail(msg: str) -> None:
    print(f"✗ {msg}")
    sys.exit(1)


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


def version_of(path: Path) -> str:
    name = path.name
    return name[:14] if len(name) >= 14 and name[:14].isdigit() else name


def main() -> int:
    if not WIN.is_file():
        fail("חסרה 20271030000100_customer_send_window.sql")
    version = WIN.name.split("_", 1)[0]
    if not (version > "20271029250000"):
        fail(f"{version} אינו אחרי ההסלמה של #1049")
    src = WIN.read_text(encoding="utf-8")
    if "('customer_digest_enabled', 0," not in src:
        fail("customer_digest_enabled אינו נולד 0")
    if "revoke all on table public.il_holidays from public, anon, authenticated;" not in src:
        fail("il_holidays אינה סגורה")
    if "grant select, insert, update, delete on table public.il_holidays to service_role;" not in src:
        fail("אין grant ל-service_role על il_holidays")
    if src.count("'holiday'") < 10 or src.count("'eve'") < 10:
        fail("זרע החגים חסר")

    final: dict[str, str] = {}
    where: dict[str, str] = {}
    # סדר הפריסה הוא ה-version, לא שם הקובץ שאחריו.
    for path in sorted(MIG.glob("*.sql"), key=lambda p: (version_of(p), p.name)):
        for name, body in bodies(path.read_text(encoding="utf-8")):
            final[name] = body
            where[name] = path.name
    for name, needles in NEED.items():
        body = final.get(name)
        if body is None:
            fail(f"אין הגדרה ל-{name}")
        low = body.lower()
        for needle in needles:
            if needle.lower() not in low:
                fail(f"{name} ב-{where[name]} בלי {needle}")
    quiet = final["public.saved_search_quiet_now"]
    if "customer_send_window_on" not in quiet or "send_window_open('saved_search'" not in quiet:
        fail("saved_search_quiet_now אינו עובר לחלון האחיד כשהדגל דלוק")
    if "agent_backlog_waiting" not in final["public.notification_push_due_agents"]:
        fail("פיזור הבוקר של הסוכנים נעלם מ-due_agents")
    demand = final["public.scraped_lead_notify_demand"]
    off = demand.split("if not v_on then", 1)[-1].split("else", 1)[0] if "if not v_on then" in demand else demand
    if "notif_burst_demand_fanout" not in off or ("s.rn > v_fanout" not in off and "s.rn > v_cap" not in off):
        fail(f"דגל כבוי ב-{where['public.scraped_lead_notify_demand']} בלי תקרת 15")
    due = final["public.notification_push_due_agents"]
    claim = final["public.notification_push_claim"]
    if version_of(Path(where["public.notification_push_due_agents"])) < "20271030000200":
        fail("due_agents האחרון בסדר הפריסה ישן מתקרת התבניות")
    if version_of(Path(where["public.notification_push_claim"])) < "20271030000200":
        fail("claim האחרון בסדר הפריסה ישן מתקרת התבניות")
    for needle in (
        "skipped_template_cap",
        "whatsapp_status in ('sent', 'pending')",
        "notification_agent_send_quiet",
        "window_on",
        "agent_backlog_waiting",
        "whatsapp_template_cap_on",
    ):
        if needle not in due:
            fail(f"due_agents האחרון בלי {needle}")
    if "action_path" not in claim or "'showcase_id'" not in claim:
        fail("claim האחרון בלי action_path או showcase_id")
    notify = final["public.scraped_lead_notify_demand"]
    off = notify.split("if not v_on then", 1)[-1].split("else", 1)[0] if "if not v_on then" in notify else notify
    if "s.rn > v_cap" not in off and "s.rn > v_fanout" not in off:
        fail("תקרת 15 של הביקוש הפתוח נעלמה מהגוף האחרון")
    if version_of(Path(where["public.notification_push_claim"])) < "20271031260000":
        fail("claim האחרון בסדר הפריסה ישן מהחריץ השמור של התקציר")
    if "template_cap_digest_reserved" not in claim or "whatsapp_template_cap_digest_channel" not in claim:
        fail("החריץ השמור של התקציר נעלם מה-claim")
    if "if v_cap_held and public.whatsapp_template_cap_on()" not in claim:
        fail("החריץ השמור רץ גם כשתקרת התבניות כבויה")
    backlog = final.get("public.notification_push_has_backlog", "")
    if "skipped_template_cap" in backlog and "interval '72 hours'" not in backlog:
        fail("has_backlog לא שומר פריט תקרה 72 שעות")
    if "a.in_window" in backlog and "a.in_service_window" not in backlog:
        fail("has_backlog מסנן תקרה בעמודה שאינה ב-due_agents")
    if version_of(Path(where["public.notification_push_has_backlog"])) < "20271031260000":
        fail("has_backlog האחרון בסדר הפריסה ישן מהחריץ השמור")
    if "whatsapp_template_cap_digest_kind" not in backlog:
        fail("has_backlog מעיר את הקרון גם כשהמרווח של 8 השעות לא מתקיים")
    if where["public.notification_send_window_open"] != WIN.name:
        fail("notification_send_window_open נדרס אחרי חלון הלקוחות")
    if where["public.saved_search_quiet_now"] != WIN.name:
        fail("saved_search_quiet_now נדרס אחרי חלון הלקוחות")
    if "customer_digest_enabled" not in final["public.customer_digest_groups"]:
        fail("התקציר אינו קורא את הדגל")
    if "return;" not in final["public.customer_digest_groups"]:
        fail("התקציר אינו יכול להישאר ריק כשהדגל כבוי")

    notify = (ROOT / "supabase/functions/saved-search-notify/index.ts").read_text(encoding="utf-8")
    loop = notify.find("for (const a of alerts")
    claim = notify.find("customer_phone_claim")
    if loop < 0 or claim < loop:
        fail("תקרת הטלפון נבדקת לפני הסבב ולא בתוך הלולאה")
    if notify.find("send_window_open") > loop:
        fail("חלון החיפוש השמור נבדק אחרי שהסבב התחיל")
    house = (ROOT / "supabase/functions/open-house-notify/index.ts").read_text(encoding="utf-8")
    if house.find("send_window_open") > house.find('.from("open_house_subscribers")'):
        fail("היריד נשאל לפני החלון")
    if "customer_window_hold" not in house or "customer_phone_claim" not in house:
        fail("היריד אינו נספר בתקרת הטלפון")

    print(f"✓ {len(NEED)} פונקציות. הגוף האחרון שומר את החלון, את התקרה ואת מה שכבר נכנס לפניהן.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
