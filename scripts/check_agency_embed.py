#!/usr/bin/env python3
"""
‏בדיקה שאיש אינו מצרף את המשרד לשורת הסוכן/ת ב-embed של PostgREST.

## למה זו בדיקה ולא הערה

ל-`agent_share_exclusions` מפתח ראשי מורכב **‏(agent_id, agency_id)**, וזו
בעיני PostgREST טבלת-קישור בין `agency_members` ל-`agencies`. לכן יש שני
נתיבים בין שתי הטבלאות — המפתח הזר הישיר, והקשר רבים-לרבים דרכה —
ו-PostgREST מסרב לבחור:

    ‏PGRST201 (HTTP 300): Could not embed because more than one relationship
    was found for 'agency_members' and 'agencies'

‏**‏השאילתה כולה נכשלת, לא רק ה-embed**, ו-supabase-js מחזיר `data: null`.
קוד שלא בודק `error` ממשיך עם "לא נמצאה שורה" — ולכן זה נראה כמו נתון חסר
ולא כמו תקלה. ארבעה כשלים אמיתיים נבעו מזה, וכל אחד מהם היה שקט:

  ‏· `_shared/platform-signup-alert.ts` — מנהל/ת הפלטפורמה לא קיבל/ה ולו
    התראת הצטרפות אחת. אפס שורות `platform_signup` במסד.
  ‏· `whatsapp-webhook/agent.ts` — כל ניסיון להכין הסכם מהבוט נענה ב"לא
    נמצאו פרטי הסוכן/ת".
  ‏· `create-own-agency` — כרטיס מנותק לא זוהה, והאימוץ נפל ב-23505.
  ‏· `whatsapp-webhook/index.ts` — זיהוי הסוכן/ת נפל לגמרי.

הפתרון בכל המקרים זהה: שאילתה שנייה לפי `agency_id`. ‏`_shared/agency-lookup.ts`
מחזיק אותה, ואת ההסבר המלא.

## מה הבדיקה חוסמת ומה לא

נחסם: ‎agencies(…)‎ בתוך ‎select‎ שמקורו ‎agency_members‎.

לא נחסם: ‎agencies(…)‎ על `properties` (ראו ‏property.html, ‏index.html).
שם אין דו-משמעות — ל-`property_shares` מפתח ראשי בודד (`id`), ולכן היא
אינה טבלת קישור. **הגבול עובר במפתח הראשי המורכב, לא בקיומם של שני מפתחות
זרים.** ‏גם ‎agencies!<שם_המפתח_הזר>(…)‎ מותר: הוא מפרש את הנתיב במפורש.

הרצה ידנית:

    python scripts/check_agency_embed.py

יציאה 0 = תקין. יציאה 1 = יש embed חדש, והפלט מראה איפה ומה לכתוב במקומו.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# הקבצים שנסרקים: ‏Edge Functions ודפי האתר. ‏`_shared/agency-lookup.ts`
# וקובץ הבדיקה הזה מדברים על הדפוס ולכן מוחרגים.
TARGETS = sorted(
    [p for p in ROOT.glob("supabase/functions/**/*.ts")]
    + [p for p in ROOT.glob("*.html")]
    + [p for p in ROOT.glob("assets/*.js")]
)
EXEMPT_FILES = {
    ROOT / "supabase" / "functions" / "_shared" / "agency-lookup.ts",
}

# ‏.from('agency_members') — בגרשיים בודדים או כפולים, עם או בלי רווחים.
FROM_RE = re.compile(r"""\.from\(\s*["']agency_members["']\s*\)""")

# ‏agencies( בתוך מחרוזת select. ‏agencies!fk( מותר — הנתיב מפורש.
EMBED_RE = re.compile(r"""(?<![!\w])agencies\s*\(""")

# כמה תווים אחרי ‎.from('agency_members')‎ נחשבים "אותה שרשרת". השרשראות
# בפועל קצרות בהרבה; הרווח כאן נדיב בכוונה, כי המחיר של פספוס גבוה מהמחיר
# של התראה.
CHAIN_WINDOW = 600

FIX = """
    ‏להחליף בשאילתה שנייה לפי agency_id:

        import { loadAgency } from "../_shared/agency-lookup.ts";

        const { data: member } = await supabase
          .from("agency_members").select("…, agency_id").eq("id", id).maybeSingle();
        const agency = await loadAgency(supabase, member?.agency_id);

    ‏בדפי HTML: שאילתה נוספת על agencies לפי member.agency_id.
"""


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def find_violations(path: Path) -> list[tuple[int, str]]:
    text = path.read_text(encoding="utf-8")
    hits: list[tuple[int, str]] = []
    for m in FROM_RE.finditer(text):
        window = text[m.end() : m.end() + CHAIN_WINDOW]
        # עוצרים בסוף השרשרת: הצהרה הבאה שמתחילה שרשרת אחרת
        stop = window.find(".from(")
        if stop != -1:
            window = window[:stop]
        e = EMBED_RE.search(window)
        if e:
            pos = m.end() + e.start()
            hits.append((line_of(text, pos), text[pos : pos + 60].strip()))
    return hits


def main() -> int:
    failures: list[str] = []

    for path in TARGETS:
        if path in EXEMPT_FILES or path.name == "check_agency_embed.py":
            continue
        for line, snippet in find_violations(path):
            rel = path.relative_to(ROOT)
            failures.append(f"  {rel}:{line}  →  {snippet}")

    if failures:
        print("‏embed של agencies על agency_members — PostgREST יחזיר PGRST201")
        print("‏והשאילתה כולה תיכשל בשקט. המקומות:\n")
        print("\n".join(failures))
        print(FIX)
        print("‏הרקע המלא: supabase/functions/_shared/agency-lookup.ts")
        return 1

    print(f"‏תקין — אין embed של agencies על agency_members ({len(TARGETS)} קבצים).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
