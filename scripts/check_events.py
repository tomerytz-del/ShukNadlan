#!/usr/bin/env python3
"""
‏בדיקה שכל קישור קשר בדף נמדד כמה שהוא, ושאין פרטים אישיים ב-GA4.

## הבעיה

‏`assets/events.js` מאזין **מואצל** על ה-document: הוא סופר כל קישור
‎wa.me‎, ‎tel:‎ ו-‎mailto:‎ בדף, מאיפה שלא הגיע, ומדווח ‎contact_agent‎ —
פנייה של גולש/ת למתווך/ת. זה המדד העסקי המרכזי של הפלטפורמה.

אבל **לא כל ‎wa.me‎ בדף הוא פנייה למתווך/ת**, ושלוש פעמים עד היום התברר
שקישור אחר נספר כך:

  ‏1. **העוזר הציבורי בוואטסאפ** — תועד ונפתר ב-‎data-bot‎, וזו הצורה
     שהשתיים הבאות מחקות.
  ‏2. **כפתור "שתפו בוואטסאפ"** ב-‎project.html‎ — ‎wa.me/?text=‎ בלי מספר
     כלל. שיתוף הוא ההיפך מפנייה: הוא מפיץ את המודעה החוצה.
  ‏3. **המספר של שוק נדל״ן עצמו** בבלוק הקשר שבתחתית הדף, שיושב בכל 11
     הדפים הנמדדים. כל מי שהתקשר **אלינו** נספר כליד למתווך.

לשלושתם אותה צורה של כשל: המדידה עובדת, המספר בדוח גדל, ואף אחד לא יודע
שהוא מנופח. אין שגיאה, אין דבר שנשבר, ואי אפשר לתקן את הנתונים למפרע.

## מה נבדק

  ‏1. **כל עוגן ‎wa.me‎/‎tel:‎/‎mailto:‎ בדף שטוען ‎events.js‎ מסווג.** קישור
     למספר או למייל של סוכן/ת נספר כ-‎contact_agent‎ וזה תקין; כל השאר
     חייב אחד מארבעת הסימונים — ‎data-bot‎, ‎data-share‎,
     ‎data-site-contact‎ או ‎data-developer‎.
  ‏2. **‎wa.me/?text=‎ ו-‎mailto:?‎ נושאים ‎data-share‎** בכל קובץ שיש בו
     כאלה, גם אם הדף אינו נמדד היום. אלה הסוגים שנבנים ב-JS ולא כעוגן
     ב-HTML, ולכן הבדיקה כאן היא על הקובץ ולא על העוגן.
  ‏3. **המספר והמייל של הפלטפורמה נושאים ‎data-site-contact‎** בכל דף
     שנמדד. המייל נוסף אחרי שהתברר ב-Tag Assistant ש-‎mailto:‎ לא נמדד
     כלל: לחיצה עליו נפלה ב-‎return‎ של המאזין ולא דחפה דבר.
  ‏4. **קישור קשר של חברה יזמית נושא ‎data-developer‎** — גם בדף החברה
     וגם בשני כפתורי משרד המכירות ב-‎project.html‎. זה אינו תיקון של
     קישור שנספר בטעות אלא הפרדת שני משפכים: קונה מיזם ישירות אינו
     פנייה למתווך/ת.
  ‏5. **דף האזור האישי אינו טוען ‎events.js‎.** שם סוכנים מתקשרים ללקוחות
     של עצמם, וזה היה נספר כפניות של גולשים (‏CLAUDE.md).
  ‏6. **אין פרטים אישיים באירוע.** ‏GA4 אוסר שליחת PII, וחשבון שנתפס
     מסתכן במחיקת הנתונים. הבדיקה עוברת על כל קריאת ‎shukTrack‎ בריפו
     ופוסלת שם פרמטר שהוא אימייל, טלפון, שם או כתובת.

## מה הבדיקה הזו **אינה** רואה

היא קוראת קבצים, ולכן היא עוצרת בגבול הריפו:

  • **מה שיושב בתוך GTM.** התגיות עצמן — GA4, הפיקסל של Meta, והגדרת
    ‏UPD — מוגדרות במסך של GTM ולא בקוד. שינוי שם אינו עובר כאן.
  • **מי הנמען של קישור שנבנה ב-JS מתוך נתוני המסד.** ‏‎wa.me‎ עם מספר
    של סוכן/ת הוא ‎contact_agent‎ וזה תקין מעצם טבעו. מה שכן נבדק שם הוא
    **שם השדה** שממנו הכתובת נבנית: ‎developer.phone‎ ו-
    ‎project.contact_phone_e164‎ מזוהים בקוד ודורשים ‎data-developer‎.

הפער הראשון הוא אמיתי, וכתוב מה עושים איתו ב-‎docs/analytics-user-data.md‎.

## הרצה

    python scripts/check_events.py

יציאה 0 = הכול מסווג. יציאה 1 = יש ממצא, והפלט מראה מה להוסיף ואיפה.

התיעוד: ‎docs/analytics-events.md‎, ‎docs/analytics-user-data.md‎.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ‏המספר של שוק נדל״ן עצמו, כפי שהוא מופיע בבלוק הקשר בתחתית הדפים.
SITE_PHONE = "+972546929991"

# ‏וכתובת המייל שלנו, באותו בלוק. היא נוספה אחרי שהתברר ב-Tag Assistant
# ש-mailto: לא נמדד בכלל — ראו ההערה ב-assets/events.js.
SITE_EMAIL = "shuknadlan@gmail.com"

# ‏המספר העסקי של העוזר הציבורי (assets/bot-link.js). קישור אליו מסומן
# ‏data-bot, ולכן הוא נבדק כאן רק כדי שלא ייחשב "מספר של סוכן/ת".
BOT_PHONE = "972532494740"

# ‏דפי האזור האישי — אסור להם לטעון events.js.
PRIVATE_PAGES = {"crm", "developer-crm", "professional-manage"}

EVENTS_JS = re.compile(r'<script[^>]+src="assets/events\.js"')

# כל עוגן בדף. נשמר שלם, כדי שאפשר יהיה לבדוק את המאפיינים שבו.
ANCHOR = re.compile(r"<a\b[^>]*>", re.IGNORECASE)
HREF = re.compile(r'\bhref="([^"]*)"', re.IGNORECASE)

MARKERS = ("data-bot", "data-share", "data-site-contact", "data-developer")

# ‏קישורי שיתוף — wa.me או mailto: **בלי נמען**. נבדקים ברמת הקובץ, כי
# הם נבנים ב-JS ולא כעוגן ב-HTML.
WA_SHARE = re.compile(r"wa\.me/\?text=")
MAIL_SHARE = re.compile(r"mailto:\?")

# ---------- חברה יזמית ----------

# ‏שדות הקשר של חברה יזמית ושל משרד המכירות של פרויקט שלה. שניהם חייבים
# ‏data-developer, כי ברירת המחדל של המאזין היא contact_agent.
#
# ‏**ולמה גם `project.` ולא רק `developer.`:** ‏`projects.developer_id`
# הוא `not null`, ו-`projects.contact_*` מתועד במיגרציה כמשרד המכירות של
# הפרויקט — כלומר אין בפרויקט מספר שאינו של היזם.
DEV_FIELD = re.compile(
    r"\bdeveloper\.(?:phone|email|whatsapp)|\bproject\.(?:contact_|whatsapp_)"
)
CONTACT_SCHEME = re.compile(r"tel:|mailto:|wa\.me/|api\.whatsapp\.com/")

# ---------- ‏PII ----------

# ‏שמות פרמטרים שאסור שיגיעו ל-GA4.
#
# ‏**מה שכן מותר, ולמה זה לא סתירה:** ‎item_name‎ (כותרת נכס), ‎search_term‎
# ‏(מה שהוקלד בחיפוש), ‎city‎ ו-‎deal_type‎ מתארים את **המודעה**, לא את
# האדם — ובאתר נדל״ן זה כל הדוח. ‏PII הוא מה שמזהה את הגולש/ת.
#
# ‏**והקיצורים הקצרים:** ‎em‎, ‎ph‎, ‎fn‎, ‎ln‎ הם השמות שגוגל עצמה נותנת
# לאימייל, טלפון, שם פרטי ושם משפחה ב-UPD (ראו ה-‎tv.1~em.‎ ב-
# ‏docs/analytics-user-data.md). מי שיעתיק דוגמה מהתיעוד של גוגל יקבל
# בדיוק את השמות האלה, ולכן הם נבדקים למרות שהם שני תווים.
PII_KEYS = {
    "name", "full_name", "first_name", "last_name", "fname", "lname",
    "address", "street_address", "city_address", "id_number", "national_id",
    "user_id_number", "birthday", "birthdate",
    "em", "ph", "fn", "ln",
}
PII_PATTERN = re.compile(
    r"(?:^|_)(email|mail|phone|tel|mobile|msisdn)(?:$|_)|^sha256_", re.IGNORECASE
)

KEY = re.compile(r"(?:^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:")

SITE_FILES = ("*.html", "assets/*.js")


def is_pii(key: str) -> bool:
    return key.lower() in PII_KEYS or bool(PII_PATTERN.search(key))


def track_calls(text: str) -> list[str]:
    """‏גוף הארגומנטים של כל קריאת shukTrack, עם איזון סוגריים."""
    out: list[str] = []
    for m in re.finditer(r"shukTrack\s*\(", text):
        depth, i = 1, m.end()
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        out.append(text[m.end(): i - 1])
    return out


# ---------- הבדיקה ----------


def contact_links(text: str) -> list[str]:
    """‏עוגנים שהמאזין ב-events.js תופס: wa.me, tel: ו-mailto:."""
    found = []
    for tag in ANCHOR.findall(text):
        href = HREF.search(tag)
        if not href:
            continue
        url = href.group(1)
        if url.startswith(("https://wa.me/", "https://api.whatsapp.com/",
                           "tel:", "mailto:")):
            found.append(tag)
    return found


def classify(tag: str) -> str | None:
    """‏מה חסר בעוגן הזה, או None אם הוא תקין."""
    if any(marker in tag.lower() for marker in MARKERS):
        return None

    href = HREF.search(tag)
    url = href.group(1) if href else ""

    if SITE_PHONE.replace("+", "") in url.replace("+", ""):
        return (
            "המספר של שוק נדל״ן עצמו, בלי data-site-contact — כל לחיצה\n"
            "            עליו נספרת כפנייה למתווך/ת"
        )
    if SITE_EMAIL in url:
        return (
            "כתובת המייל של שוק נדל״ן עצמה, בלי data-site-contact — כל\n"
            "            לחיצה עליה נספרת כפנייה למתווך/ת"
        )
    if BOT_PHONE in url:
        return "המספר של העוזר הציבורי, בלי data-bot"
    if WA_SHARE.search(url) or url in ("https://wa.me/", "https://wa.me"):
        return "קישור שיתוף (wa.me בלי מספר), בלי data-share"
    if MAIL_SHARE.search(url) or url == "mailto:":
        return "קישור שיתוף (mailto: בלי נמען), בלי data-share"
    return None  # מספר של סוכן/ת — contact_agent, וזה תקין


def check_page(path: Path) -> list[str]:
    name = path.stem
    text = path.read_text(encoding="utf-8")
    measured = bool(EVENTS_JS.search(text))
    problems: list[str] = []

    if name in PRIVATE_PAGES and measured:
        problems.append(
            "דף אזור אישי שטוען events.js. שם סוכנים מתקשרים ללקוחות\n"
            "            של עצמם, וזה נספר כפניות של גולשים (CLAUDE.md)."
        )

    if measured:
        for tag in contact_links(text):
            problem = classify(tag)
            if problem:
                problems.append("%s\n            %s" % (problem, tag.strip()[:100]))

    return problems


COMMENT = re.compile(r"<!--.*?-->|/\*.*?\*/|^\s*//.*?$", re.DOTALL | re.MULTILINE)


def strip_comments(text: str) -> str:
    """‏בלי הערות.

    ‏בלעדי זה הבדיקה למטה **עברה בטעות**: ההערה שמסבירה למה יש ‎data-share‎
    על הכפתור מכילה את המילה ‎data-share‎, ולכן מחיקת הסימון מהעוגן עצמו
    לא הפילה כלום. בדיקה שנשענת על מחרוזת חייבת להסתכל רק על קוד.
    """
    return COMMENT.sub(" ", text)


def check_share_files() -> list[str]:
    """‏קובץ שבונה wa.me/?text= חייב לסמן data-share בקוד עצמו.

    ‏העוגן הזה נבנה ב-JS (‏‎'<a … href="' + href + '"'‎), ולכן בדיקת העוגן
    שלמעלה אינה רואה את הכתובת שבו — היא בסך הכול שרשור. הבדיקה כאן היא
    לכן ברמת הקובץ, וזה הכי הדוק שאפשר בלי להריץ את הדף.
    """
    problems = []
    for pattern in SITE_FILES:
        for path in sorted(ROOT.glob(pattern)):
            if path.stem in PRIVATE_PAGES or path.name == "crm.js":
                continue  # האזור האישי אינו נמדד
            code = strip_comments(path.read_text(encoding="utf-8"))
            for pattern, what in ((WA_SHARE, "wa.me/?text="), (MAIL_SHARE, "mailto:?")):
                if pattern.search(code) and "data-share" not in code:
                    problems.append(
                        "%s בונה %s ואין בו data-share — הכפתור\n"
                        "        ייספר כפנייה למתווך/ת ברגע שהדף יימדד"
                        % (path.name, what)
                    )
    return problems


def check_developer_links() -> list[str]:
    """‏קישור קשר שנבנה מנתוני חברה יזמית חייב data-developer.

    ‏העוגנים האלה נבנים ב-JS, ולכן ‎classify()‎ שלמעלה אינה יכולה להכריע
    עליהם: ה-‎href‎ שהיא מחלצת הוא ‎"tel:+'‎ — תחילית של שרשור, בלי המספר.
    לכן הבדיקה כאן היא על **תג הפתיחה כפי שהוא נכתב בקוד**, מ-‎<a‎ ועד
    ה-‎>‎ הראשון, כולל השרשור שבתוכו. זה הדוק יותר מבדיקה ברמת הקובץ
    (‏`check_share_files`), כי הוא מצמיד את הדרישה לעוגן עצמו.
    """
    problems = []
    for pattern in SITE_FILES:
        for path in sorted(ROOT.glob(pattern)):
            if path.stem in PRIVATE_PAGES or path.name == "crm.js":
                continue  # האזור האישי אינו נמדד
            code = strip_comments(path.read_text(encoding="utf-8"))
            for tag in ANCHOR.findall(code):
                if not (CONTACT_SCHEME.search(tag) and DEV_FIELD.search(tag)):
                    continue
                if any(marker in tag.lower() for marker in MARKERS):
                    continue
                problems.append(
                    "%s בונה קישור קשר של חברה יזמית בלי data-developer —\n"
                    "        הוא ייספר כפנייה למתווך/ת:\n"
                    "        %s" % (path.name, " ".join(tag.split())[:120])
                )
    return problems


def check_pii() -> list[str]:
    problems = []
    for pattern in SITE_FILES:
        for path in sorted(ROOT.glob(pattern)):
            text = path.read_text(encoding="utf-8")
            for args in track_calls(text):
                for key in KEY.findall(args):
                    if is_pii(key):
                        problems.append(
                            "%s שולח `%s` ל-GA4. ‏GA4 אוסר פרטים אישיים,\n"
                            "        והחשבון מסתכן במחיקת הנתונים."
                            % (path.name, key)
                        )
    return problems


def main() -> int:
    pages = sorted(ROOT.glob("*.html"))
    if not pages:
        print("לא נמצאו דפי HTML בשורש — משהו בבדיקה עצמה שבור.")
        return 1

    failed = {p: probs for p in pages if (probs := check_page(p))}
    for path, problems in failed.items():
        print("✗ %s" % path.name)
        for problem in problems:
            print("      • %s" % problem)

    others = check_share_files() + check_developer_links() + check_pii()
    for problem in others:
        print("✗ %s" % problem)

    if failed or others:
        print(
            "\nכל אחד מהממצאים האלה משאיר את המדידה עובדת — היא פשוט סופרת\n"
            "דבר אחר ממה שהכותרת בדוח אומרת, ואי אפשר לתקן נתונים למפרע.\n"
            "ארבעת הסימונים ומה כל אחד אומר: docs/analytics-events.md"
        )
        return 1

    measured = [p.name for p in pages if EVENTS_JS.search(p.read_text(encoding="utf-8"))]
    print(
        "✓ %d דפים נמדדים, וכל קישור קשר בהם מסווג. אין פרטים אישיים\n"
        "  באף קריאת shukTrack." % len(measured)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
