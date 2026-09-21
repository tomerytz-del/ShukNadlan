#!/usr/bin/env python3
"""
‏בדיקה של מכולת ה-GTM מול הקוד ומול מדיניות הפרטיות.

## הפער שהבדיקה הזו סוגרת

עד היום **התגיות עצמן היו מחוץ להישג יד של הריפו.** ‏GA4, הפיקסל של Meta
והגדרת ה-UPD מוגדרים במסך של GTM, ומי שמשנה אותם שם אינו עובר ב-PR ואינו
עובר ב-CI. הריפו ידע לוודא שה**מכולה** נטענת בכל דף (‏`check_gtm.py`), אבל
לא מה יש בתוכה.

שלוש תוצאות היו לזה, וכולן אמיתיות:

  ‏1. ‏`privacy.html` **מצהיר** שהפיקסל של Meta פועל באתר, ובריפו אין לו
     שורה אחת. כלומר הצהרה משפטית לגולשים שאי אפשר לאמת מהקוד.
  ‏2. ‏איסוף UPD נדלק בנכס GA4 בלי שורת קוד אחת, והתגלה רק מהתראה.
  ‏3. ‏`docs/analytics-events.md` אומר במפורש ש"דחיפה ל-dataLayer לבדה
     אינה מגיעה ל-GA4 — לכל אירוע צריך טריגר Custom Event מקביל ב-GTM".
     **לא הייתה שום דרך לבדוק את זה.** אירוע שנוסף ל-`events.js` בלי
     טריגר ב-GTM נדחף לשום מקום, והדף עובד בדיוק כרגיל.

הבדיקה כאן קוראת ייצוא של המכולה שמחויב לריפו, ומצליבה אותו מול הקוד.

## מה נבדק

  ‏1. **המכולה היא שלנו** — ‏`publicId` בייצוא זהה ל-GTM-NZHD7ZHT שמוטבע
     בכל 32 הדפים. ייצוא ממכולה אחרת אינו מוכיח דבר.
  ‏2. **לכל אירוע שהאתר דוחף יש מסלול ל-GA4** — טריגר ‎CUSTOM_EVENT‎ בשם
     המדויק, **וגם** תגית שנורית ממנו. זו הבדיקה שלא הייתה קיימת.
  ‏3. **אין טריגר מיותר** — טריגר לאירוע שהאתר אינו דוחף יותר הוא שארית
     משינוי שם, והוא מסתיר את זה שהאירוע החדש אינו נמדד.
  ‏4. **כל אירוע מתועד** ב-‎docs/analytics-events.md‎.
  ‏5. **מזהה מדידה אחד** — ‎G-40ZLLXSRFY‎ בכל התגיות. מזהה שני מפצל את
     הנתונים לשני נכסים בשקט, וחצי מהתנועה נעלמת מהדוח.
  ‏6. **אין UPD ואין PII במכולה** — לא ‎userProvidedData‎, לא ‎sha256_‎, ולא
     פרמטר אירוע שהוא אימייל, טלפון, שם או כתובת. זו האכיפה של ההחלטה
     ב-‎docs/analytics-user-data.md‎: מי שידליק את זה מחדש **בתוך GTM**,
     ייתפס כאן.
  ‏7. **מה שמדיניות הפרטיות מבטיחה נמצא, ומה שנמצא מובטח** — בשני
     הכיוונים. תגית שמזוהה כפרסומית ואינה מוזכרת ב-‎privacy.html‎ היא
     איסוף לא מוצהר; הצהרה ב-‎privacy.html‎ שאין לה תגית בייצוא היא
     הצהרה שגויה. הראשון גרוע יותר, והשני כבר קרה.
  ‏8. **כל תגית Custom HTML מוכרת בשמה.** ‏Custom HTML הוא JS חופשי בכל
     דף באתר, כלומר הדרך הקלה להכניס איסוף חדש בלי שאף אחד יראה. תגית
     כזו שאינה ברשימה למטה מפילה את הבדיקה, כדי שמישהו ייעצר ויסתכל.

## מה הבדיקה **אינה** יכולה לעשות, וזה חייב להיות ברור

**היא בודקת את הייצוא, לא את המכולה החיה.** אין לה גישה ל-GTM, ולכן אם
מישהו שינה משהו ב-GTM ולא ייצא מחדש — הבדיקה תעבור על תמונת מצב ישנה
ותוכיח בדיוק כלום.

זה לא פתור כאן, וזה גם לא ניתן לפתירה בלי מפתח ל-GTM API. מה שכן נעשה:
הבדיקה **מדפיסה בכל הרצה את תאריך הייצוא**, כדי שמי שקורא את הפלט יראה
בעיניים שהתמונה מלפני חצי שנה. והכלל שמצמצם את החלון כתוב ב-‎gtm/README.md‎:
**פרסום גרסה ב-GTM וייצוא מחדש הם אותה פעולה.**

## הרצה

    python scripts/check_gtm_container.py [נתיב לייצוא]

יציאה 0 = הכול מצטלב. יציאה 1 = יש ממצא, והפלט מראה מה לתקן ואיפה.

התיעוד: ‎gtm/README.md‎, ‎docs/analytics-gtm.md‎, ‎docs/analytics-user-data.md‎.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

# ‏רשימת ה-PII מגיעה מ-check_events.py ולא משוכפלת: שני הכיוונים —
# ‏מה שהקוד דוחף ומה ש-GTM שולח — חייבים לפסול בדיוק אותם שמות.
from check_events import is_pii, track_calls  # noqa: E402

EXPORT = ROOT / "gtm" / "container.json"

CONTAINER_ID = "GTM-NZHD7ZHT"
MEASUREMENT_ID = "G-40ZLLXSRFY"

# ‏סוגי תגיות שאין בהם JS חופשי, ולכן הם מתועדים בסוג שלהם ולא בשמם.
BENIGN_TYPES = {
    "gaawe": "אירוע GA4",
    "gaawc": "הגדרת GA4 (ישן)",
    "googtag": "תגית Google / הגדרת GA4",
}

# ‏תגיות Custom HTML שמישהו הסתכל עליהן. השם חייב להיות מדויק כפי שהוא
# בייצוא. תגית חדשה כאן היא **החלטה**, לא עדכון רשימה: היא מריצה JS
# חופשי בכל דף, ו-privacy.html צריך לדעת עליה.
REVIEWED_HTML_TAGS: dict[str, str] = {
    # ‏הפיקסל של Meta, מזהה 1844258613237835, נורה מהטריגר המובנה All Pages.
    # ‏מוצהר ב-privacy.html בסעיף נפרד ("פרסום ומיקוד מחדש") ולא בסעיף
    # העוגיות, כי מיקוד מחדש אינו מדידה — ראו docs/analytics-gtm.md.
    "meta pixel pageview": "פרסום ושיווק מחדש - privacy.html, 'פרסום ומיקוד מחדש'",
}

# ‏חתימות שמזהות מה תגית **עושה**, ולא איך היא נקראת. שם מתחלף, קריאה
# ל-fbq לא. כל אחת ממופה לביטוי שחייב להופיע ב-privacy.html.
CAPABILITIES = [
    {
        "key": "meta_pixel",
        "name": "הפיקסל של Meta",
        "signatures": ("connect.facebook.net", "fbq(", "fbevents.js"),
        "privacy_phrase": "הפיקסל של Meta",
        "why": "פרסום ושיווק מחדש — סוג איסוף אחר ממדידה סטטיסטית",
    },
    {
        "key": "ga4",
        "name": "Google Analytics",
        "signatures": ("gaawe", "gaawc", "googtag"),
        "privacy_phrase": "Google Analytics",
        "why": "מדידה סטטיסטית",
    },
]

# ‏חתימות של איסוף פרטים שהמשתמשים מספקים. כל אחת מהן במכולה אומרת
# ש-UPD חזר לפעול — ראו ההחלטה ב-docs/analytics-user-data.md.
UPD_SIGNATURES = (
    "userProvidedData",
    "user_data",
    "sha256_email_address",
    "sha256_phone_number",
    "enhanced_conversions",
    "enableUserProvidedData",
)

CE_EVENT_KEY = "arg1"


# ---------- קריאת הייצוא ----------


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def param(item: dict, key: str) -> str | None:
    for p in item.get("parameter") or []:
        if p.get("key") == key:
            return p.get("value")
    return None


def ce_event_name(trigger: dict) -> str | None:
    """‏שם האירוע שטריגר CUSTOM_EVENT מאזין לו."""
    for f in trigger.get("customEventFilter") or []:
        for p in f.get("parameter") or []:
            if p.get("key") == CE_EVENT_KEY:
                return str(p.get("value") or "").strip()
    return None


# ‏המפתחות שמחזיקים **שם** של פרמטר אירוע, ולא את ערכו. שלוש צורות
# שמסבירות למה זו רשימה ולא מפתח אחד:
#
#   ‏`eventParameters` + `name`  — הצורה שקובץ הייבוא שלנו כותב
#   ‏`eventSettingsTable` + `parameter` — הצורה ש-GTM **שומר** בה
#   משתנה `Google Tag Event Settings` — אותה טבלה, באובייקט נפרד
#
# ‏השנייה היא הסיבה שהכלל הזה נכתב מחדש: הוא קרא רק `eventParameters`,
# ולכן על המכולה האמיתית הוא החזיר **רשימה ריקה מכל 15 התגיות** ועבר
# ירוק בלי לבדוק דבר. ‏GTM מנרמל את הייבוא לצורה שלו בשמירה, ולכן
# הבדיקה הצליבה את מה שכתבנו ולא את מה שנשמר.
PARAM_NAME_KEYS = ("name", "parameter")


def event_param_names(item: dict) -> list[str]:
    """‏שמות פרמטרי האירוע של תגית או משתנה, בכל שלוש הצורות.

    ‏סורק רקורסיבית ולא לפי מפתח ידוע, כי הצורה הרביעית תגיע — וכשהיא
    תגיע, כלל שנשען על שם מפתח יחזור לעבור ירוק בשקט.
    """
    names: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            if node.get("type") == "MAP":
                for m in node.get("map") or []:
                    if m.get("key") in PARAM_NAME_KEYS and m.get("type") == "TEMPLATE":
                        names.append(str(m.get("value") or ""))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(item.get("parameter") or [])
    return names


# ---------- מה הקוד דוחף ----------

# ‏assets/pwa-install.js עוטף את shukTrack ב-track(), ולכן שמות האירועים
# שלו אינם נראים בחיפוש אחר shukTrack. הוא הקובץ היחיד כזה, והעוטף
# מתועד שם בשמו.
WRAPPED = {"assets/pwa-install.js": r"\btrack\(\s*'([a-z_]+)'"}


def site_events() -> dict[str, set[str]]:
    """‏שם אירוע → הקבצים שדוחפים אותו."""
    events: dict[str, set[str]] = {}

    def add(name: str, where: str) -> None:
        events.setdefault(name, set()).add(where)

    for pattern in ("*.html", "assets/*.js"):
        for path in sorted(ROOT.glob(pattern)):
            text = path.read_text(encoding="utf-8")
            for args in track_calls(text):
                m = re.match(r"\s*'([a-z_]+)'", args)
                if m:
                    add(m.group(1), path.name)

    for rel, regex in WRAPPED.items():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for name in re.findall(regex, text):
            add(name, Path(rel).name)

    return events


def documented_events() -> set[str]:
    text = (ROOT / "docs/analytics-events.md").read_text(encoding="utf-8")
    table = re.findall(r"^\|\s*`([a-z_]+)`\s*\|", text, re.MULTILINE)
    return set(table)


# ---------- הבדיקה ----------


def check(path: Path) -> tuple[list[str], list[str]]:
    """‏מחזירה (ממצאים, שורות מידע)."""
    problems: list[str] = []
    info: list[str] = []

    data = load(path)
    version = data.get("containerVersion") or {}
    container = version.get("container") or {}
    tags = version.get("tag") or []
    triggers = version.get("trigger") or []
    raw = json.dumps(data, ensure_ascii=False)

    info.append("ייצוא מ-%s, גרסת מכולה %s"
                % (data.get("exportTime", "(אין תאריך)"),
                   version.get("containerVersionId", "?")))

    # ‏1. המכולה שלנו
    public_id = container.get("publicId")
    if public_id != CONTAINER_ID:
        problems.append(
            "הייצוא הוא ממכולה %s ולא מ-%s — זו שמוטבעת בכל 32 הדפים.\n"
            "        ייצוא ממכולה אחרת אינו מוכיח דבר על האתר."
            % (public_id or "(ללא publicId)", CONTAINER_ID)
        )

    # ‏2+3. אירועים מול טריגרים ותגיות
    pushed = site_events()
    by_event: dict[str, str] = {}   # שם אירוע → triggerId
    for t in triggers:
        if t.get("type") != "CUSTOM_EVENT":
            continue
        name = ce_event_name(t)
        if name:
            by_event[name] = str(t.get("triggerId"))

    fired = set()
    for tag in tags:
        for tid in tag.get("firingTriggerId") or []:
            fired.add(str(tid))

    for name in sorted(pushed):
        where = ", ".join(sorted(pushed[name]))
        tid = by_event.get(name)
        if tid is None:
            problems.append(
                "האירוע `%s` נדחף ב-%s ואין לו טריגר CUSTOM_EVENT ב-GTM.\n"
                "        הוא נדחף ל-dataLayer ואינו מגיע ל-GA4 — הדף עובד,\n"
                "        והאירוע פשוט אינו קיים בשום דוח." % (name, where)
            )
        elif tid not in fired:
            problems.append(
                "לאירוע `%s` יש טריגר ב-GTM (‏%s) ואין תגית שנורית ממנו.\n"
                "        הטריגר נדלק לריק." % (name, tid)
            )

    for name in sorted(set(by_event) - set(pushed)):
        problems.append(
            "טריגר ל-`%s`, ואין בקוד מי שדוחף אותו. שארית משינוי שם —\n"
            "        והיא מסתירה את זה שהשם החדש אינו נמדד." % name
        )

    # ‏4. תיעוד
    documented = documented_events()
    for name in sorted(set(pushed) - documented):
        problems.append(
            "האירוע `%s` אינו בטבלה שב-docs/analytics-events.md." % name
        )

    # ‏5. מזהה מדידה אחד
    ids = {param(t, "measurementIdOverride") for t in tags}
    ids.discard(None)
    extra = {i for i in ids if i != MEASUREMENT_ID}
    if extra:
        problems.append(
            "יש במכולה מזהה מדידה שאינו %s: %s.\n"
            "        מזהה שני מפצל את הנתונים לשני נכסים בשקט."
            % (MEASUREMENT_ID, ", ".join(sorted(extra)))
        )

    # ‏6. ‏UPD ו-PII
    for sig in UPD_SIGNATURES:
        if sig in raw:
            problems.append(
                "נמצא `%s` במכולה — כלומר איסוף פרטים שהמשתמשים מספקים\n"
                "        חזר לפעול. ההחלטה שהוא כבוי, והנימוקים:\n"
                "        docs/analytics-user-data.md. אם ההחלטה השתנתה,\n"
                "        היא משתנה **שם** ולא כאן." % sig
            )
    # ‏תגיות **ומשתנים**: מגרסה 5 הפרמטרים יכולים לשבת במשתנה
    # ‏`Google Tag Event Settings` נפרד, ולא בתוך התגית. סריקת תגיות
    # לבדה הייתה מפספסת אותם, וזה בדיוק הפתח שהכלל הזה סוגר.
    for item in list(tags) + list(version.get("variable") or []):
        for name in event_param_names(item):
            if is_pii(name):
                problems.append(
                    "\"%s\" שולח פרמטר `%s` ל-GA4. ‏GA4 אוסר פרטים\n"
                    "        אישיים, והחשבון מסתכן במחיקת הנתונים."
                    % (item.get("name", "?"), name)
                )

    # ‏7. מה שמוצהר מול מה שקיים
    privacy = (ROOT / "privacy.html").read_text(encoding="utf-8")
    for cap in CAPABILITIES:
        present = any(sig in raw for sig in cap["signatures"])
        declared = cap["privacy_phrase"] in privacy
        if present and not declared:
            problems.append(
                "%s נמצא במכולה ואינו מוזכר ב-privacy.html (%s).\n"
                "        זה איסוף שלא הוצהר לגולשים."
                % (cap["name"], cap["why"])
            )
        elif declared and not present:
            problems.append(
                "‏privacy.html מצהיר על %s, ואין לו תגית בייצוא.\n"
                "        או שהתגית הוסרה מ-GTM והמדיניות לא עודכנה, או\n"
                "        שהייצוא ישן. שניהם דורשים החלטה." % cap["name"]
            )
        else:
            info.append("%s: %s" % (cap["name"], "מוצהר ונמצא" if present else "אינו במכולה ואינו מוצהר"))

    # ‏8. ‏Custom HTML מוכר בשמו
    for tag in tags:
        kind, name = tag.get("type"), tag.get("name", "?")
        if kind in BENIGN_TYPES:
            continue
        if kind == "html":
            if name not in REVIEWED_HTML_TAGS:
                problems.append(
                    "תגית Custom HTML \"%s\" שאינה ב-REVIEWED_HTML_TAGS.\n"
                    "        ‏Custom HTML הוא JS חופשי בכל דף באתר, כלומר\n"
                    "        הדרך הקלה להכניס איסוף חדש בלי שאף אחד יראה.\n"
                    "        מי שמוסיף אותה מוסיף שורה בסקריפט ומוודא\n"
                    "        ש-privacy.html מכסה אותה." % name
                )
        else:
            problems.append(
                "תגית \"%s\" מסוג `%s`, שאינו מוכר לבדיקה.\n"
                "        אם הוא תקין — להוסיף אותו ל-BENIGN_TYPES עם הסבר."
                % (name, kind)
            )

    # ‏הטריגרים המובנים (‏All Pages, Initialization) אינם ב-trigger של
    # הייצוא אלא רק כמזהה ב-firingTriggerId, ולכן "0 טריגרים" לצד שתי
    # תגיות שכן נורות הוא נכון ומבלבל. מפורש כאן.
    info.append("%d תגיות, %d טריגרים משלנו (מובנים אינם בייצוא), %d אירועים בקוד"
                % (len(tags), len(triggers), len(pushed)))
    return problems, info


def main(argv: list[str]) -> int:
    path = Path(argv[0]) if argv else EXPORT

    if not path.exists():
        print("✗ אין ייצוא של מכולת ה-GTM ב-%s" % path)
        print(
            "\nהתגיות שבתוך GTM הן היום הפינה היחידה בפלטפורמה שאינה עוברת\n"
            "ב-PR: אפשר להתחיל לאסוף סוג נתונים חדש לגמרי בלי לגעת בקוד.\n"
            "הייצוא הוא מה שמחזיר אותן לריפו.\n\n"
            "איך מייצאים (‏פעולה של דקה, ב-GTM):\n"
            "  ‏1. ‏GTM ← Admin ← Export Container\n"
            "  ‏2. לבחור את הגרסה שפורסמה (‏Published), לא Workspace\n"
            "  ‏3. לשמור את ה-JSON כ-gtm/container.json\n\n"
            "הפרטים, כולל למה דווקא הגרסה שפורסמה: gtm/README.md"
        )
        return 1

    try:
        problems, info = check(path)
    except (json.JSONDecodeError, KeyError, TypeError) as err:
        print("✗ הייצוא ב-%s אינו נקרא: %s" % (path, err))
        print("\nזהו ייצוא של GTM? הצורה הצפויה מתועדת ב-gtm/README.md.")
        return 1

    for line in info:
        print("  ‏%s" % line)
    print()

    for problem in problems:
        print("✗ %s" % problem)

    if problems:
        print(
            "\nכל ממצא כאן הוא דבר שהדפדפן אינו מגלה: הדף נטען, המדידה\n"
            "נראית עובדת, והנתון פשוט אינו מגיע — או שמגיע נתון שלא הוצהר.\n"
            "התיעוד: gtm/README.md, docs/analytics-user-data.md"
        )
        return 1

    print("✓ המכולה מצטלבת עם הקוד, עם התיעוד ועם מדיניות הפרטיות.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
