#!/usr/bin/env python3
"""
‏בדיקה של הבדיקה: ‎check_gtm_container.py‎ מול מכולות מסונתזות.

**למה זה קיים.** ‏`check_gtm_container.py` היא הבדיקה היחידה בריפו שאין לה
קלט אמיתי בזמן הכתיבה: הייצוא מגיע מ-GTM, ואין גישה אליו מכאן. בדיקה
שנכתבה בלי להריץ אותה על נתון אמיתי היא בדיוק הסוג שעובר תמיד ולא תופס
כלום — ושתי הבדיקות הקודמות בריפו הזה הוכיחו את זה: שתיים משבע התקלות
שנבדקו ב-‎check_events.py‎ נתפסו רק אחרי שהבדיקה עצמה תוקנה.

לכן כל כלל מקבל כאן מכולה שמפרה אותו בכוונה, ומוודאים שהוא נתפס. מכולת
הבסיס למטה היא גם התיעוד של הצורה שהבדיקה מצפה לה.

    python scripts/check_gtm_container_test.py
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import check_gtm_container as chk  # noqa: E402

PIXEL_HTML = (
    "<script>!function(f,b,e,v,n,t,s){...}"
    "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');"
    "fbq('init','000');fbq('track','PageView');</script>"
)


def ga4_tag(tag_id: str, event: str, trigger_id: str, params: list[str] | None = None) -> dict:
    parameter = [
        {"type": "TEMPLATE", "key": "eventName", "value": event},
        {"type": "TEMPLATE", "key": "measurementIdOverride", "value": chk.MEASUREMENT_ID},
    ]
    if params:
        parameter.append({
            "type": "LIST",
            "key": "eventParameters",
            "list": [
                {"type": "MAP", "map": [
                    {"type": "TEMPLATE", "key": "name", "value": name},
                    {"type": "TEMPLATE", "key": "value", "value": "{{DLV - %s}}" % name},
                ]}
                for name in params
            ],
        })
    return {
        "tagId": tag_id,
        "name": "GA4 - %s" % event,
        "type": "gaawe",
        "parameter": parameter,
        "firingTriggerId": [trigger_id],
    }


def settings_table_tag(tag_id: str, event: str, trigger_id: str,
                       params: list[str]) -> dict:
    """‏אותה תגית, בצורה ש-GTM עצמו שומר: `eventSettingsTable` ו-`parameter`.

    ‏`ga4_tag` למעלה כותבת את הצורה שקובץ הייבוא שלנו כותב. ‏GTM מנרמל
    אותה בשמירה, ולכן בדיקה שנכתבה רק מול הצורה הראשונה מאמתת את מה
    שכתבנו במקום את מה שבאוויר.
    """
    tag = ga4_tag(tag_id, event, trigger_id)
    tag["name"] = "GA4 - %s (settings table)" % event
    tag["parameter"].append({
        "type": "LIST",
        "key": "eventSettingsTable",
        "list": [
            {"type": "MAP", "map": [
                {"type": "TEMPLATE", "key": "parameter", "value": name},
                {"type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - %s}}" % name},
            ]}
            for name in params
        ],
    })
    return tag


def ce_trigger(trigger_id: str, event: str) -> dict:
    return {
        "triggerId": trigger_id,
        "name": "CE - %s" % event,
        "type": "CUSTOM_EVENT",
        "customEventFilter": [{
            "type": "EQUALS",
            "parameter": [
                {"type": "TEMPLATE", "key": "arg0", "value": "{{_event}}"},
                {"type": "TEMPLATE", "key": "arg1", "value": event},
            ],
        }],
    }


def baseline() -> dict:
    """‏מכולה שאמורה לעבור: כל אירוע בקוד, פיקסל מוצהר, מזהה אחד."""
    events = sorted(chk.site_events())
    tags, triggers = [], []
    for i, event in enumerate(events):
        tid, tag_id = str(200 + i), str(300 + i)
        triggers.append(ce_trigger(tid, event))
        tags.append(ga4_tag(tag_id, event, tid))

    triggers.append({"triggerId": "1", "name": "All Pages", "type": "PAGEVIEW"})
    tags.append({
        "tagId": "100", "name": "Google tag", "type": "googtag",
        "parameter": [{"type": "TEMPLATE", "key": "tagId", "value": chk.MEASUREMENT_ID}],
        "firingTriggerId": ["1"],
    })
    tags.append({
        "tagId": "101", "name": "Meta Pixel", "type": "html",
        "parameter": [{"type": "TEMPLATE", "key": "html", "value": PIXEL_HTML}],
        "firingTriggerId": ["1"],
    })

    return {
        "exportFormatVersion": 2,
        "exportTime": "2026-09-21 13:00:00",
        "containerVersion": {
            "containerVersionId": "7",
            "container": {
                "name": "shuknadlan.co.il",
                "publicId": chk.CONTAINER_ID,
                "usageContext": ["WEB"],
            },
            "tag": tags,
            "trigger": triggers,
            "variable": [],
        },
    }


def run(container: dict) -> tuple[list[str], list[str]]:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "container.json"
        path.write_text(json.dumps(container, ensure_ascii=False), encoding="utf-8")
        return chk.check(path)


def drop_event(container: dict, event: str, what: str) -> dict:
    """‏מסירה מהמכולה את הטריגר ו/או התגית של אירוע."""
    cv = container["containerVersion"]
    tids = {t["triggerId"] for t in cv["trigger"]
            if t.get("type") == "CUSTOM_EVENT" and chk.ce_event_name(t) == event}
    if what in ("trigger", "both"):
        cv["trigger"] = [t for t in cv["trigger"] if t.get("triggerId") not in tids]
    if what in ("tag", "both"):
        cv["tag"] = [t for t in cv["tag"]
                     if not (set(t.get("firingTriggerId") or []) & tids)]
    return container


def main() -> int:
    # ‏שם התגית של הפיקסל אינו ידוע עד לייצוא הראשון, ולכן הוא נשתל כאן
    # ‏ולא ברשימה שבסקריפט. ראו gtm/README.md.
    chk.REVIEWED_HTML_TAGS["Meta Pixel"] = "פרסום ושיווק מחדש"

    cases: list[tuple[str, dict, str | None]] = []

    def case(label: str, mutate, expect: str | None) -> None:
        c = copy.deepcopy(baseline())
        mutate(c)
        cases.append((label, c, expect))

    case("מכולת הבסיס עוברת", lambda c: None, None)

    case("אירוע בלי טריגר",
         lambda c: drop_event(c, "contact_site", "both"),
         "ואין לו טריגר CUSTOM_EVENT")

    case("טריגר בלי תגית שנורית ממנו",
         lambda c: drop_event(c, "generate_lead", "tag"),
         "ואין תגית שנורית ממנו")

    case("טריגר לאירוע שהקוד אינו דוחף",
         lambda c: c["containerVersion"]["trigger"].append(ce_trigger("999", "contact_whatsapp")),
         "ואין בקוד מי שדוחף אותו")

    case("מכולה אחרת",
         lambda c: c["containerVersion"]["container"].update({"publicId": "GTM-XXXXXXX"}),
         "ולא מ-GTM-NZHD7ZHT")

    # ‏מפתח כפול **באותה תגית** אינו מסלול הגילוי: param() מחזיר את
    # הראשון, וזו הצורה ש-GTM מייצא בה. המקרה האמיתי — תגית נפרדת עם
    # מזהה אחר — נבדק בנפרד בסוף.
    case("מפתח כפול באותה תגית אינו ממצא (מתועד)",
         lambda c: c["containerVersion"]["tag"][0]["parameter"].append(
             {"type": "TEMPLATE", "key": "measurementIdOverride", "value": "G-OTHER12345"}),
         None)

    case("‏UPD חזר לפעול",
         lambda c: c["containerVersion"]["variable"].append(
             {"name": "UPD", "type": "awup",
              "parameter": [{"key": "userProvidedData", "value": "auto"}]}),
         "איסוף פרטים שהמשתמשים מספקים")

    case("אימייל כפרמטר אירוע",
         lambda c: c["containerVersion"]["tag"].append(
             ga4_tag("400", "generate_lead", "200", params=["em", "form_id"])),
         "‏GA4 אוסר פרטים")

    # ‏שתי הצורות שהכלל הקודם **לא** ראה, וזו לא היפותזה: הוא קרא רק
    # ‏`eventParameters`, ו-GTM שומר `eventSettingsTable`. כלומר על
    # המכולה האמיתית הוא החזיר רשימה ריקה מכל 15 התגיות ועבר ירוק.
    # שני המקרים האלה נכתבו מהצורה שבייצוא האמיתי, לא מהקובץ שלנו.
    case("אימייל בצורה ש-GTM שומר בה (eventSettingsTable)",
         lambda c: c["containerVersion"]["tag"].append(
             settings_table_tag("401", "generate_lead", "200", ["ph", "form_id"])),
         "‏GA4 אוסר פרטים")

    case("אימייל במשתנה Google Tag Event Settings נפרד",
         lambda c: c["containerVersion"].setdefault("variable", []).append(
             {"variableId": "900", "name": "Google Tag Event Settings",
              "type": "gtes",
              "parameter": [{
                  "type": "LIST", "key": "eventSettingsTable",
                  "list": [{"type": "MAP", "map": [
                      {"type": "TEMPLATE", "key": "parameter", "value": "user_email"},
                      {"type": "TEMPLATE", "key": "parameterValue", "value": "{{DLV - x}}"},
                  ]}],
              }]}),
         "‏GA4 אוסר פרטים")

    case("הפיקסל נעלם מהמכולה והמדיניות מצהירה עליו",
         lambda c: c["containerVersion"]["tag"].pop(
             next(i for i, t in enumerate(c["containerVersion"]["tag"])
                  if t["name"] == "Meta Pixel")),
         "מצהיר על הפיקסל של Meta, ואין לו תגית")

    case("‏Custom HTML לא מוכר",
         lambda c: c["containerVersion"]["tag"].append(
             {"tagId": "500", "name": "Hotjar", "type": "html",
              "parameter": [{"type": "TEMPLATE", "key": "html", "value": "<script>hj()</script>"}],
              "firingTriggerId": ["1"]}),
         "שאינה ב-REVIEWED_HTML_TAGS")

    case("סוג תגית לא מוכר",
         lambda c: c["containerVersion"]["tag"].append(
             {"tagId": "501", "name": "Something", "type": "flc", "firingTriggerId": ["1"]}),
         "שאינו מוכר לבדיקה")

    failures = 0
    for label, container, expect in cases:
        problems, _ = run(container)
        joined = "\n".join(problems)
        if expect is None:
            ok = not problems
            detail = "" if ok else problems[0].splitlines()[0]
        else:
            ok = expect in joined
            detail = "" if ok else (problems[0].splitlines()[0] if problems else "(לא נמצא ממצא)")
        print("[%s] %s%s" % ("תפס " if ok else "החמיץ", label,
                             "\n        " + detail if detail else ""))
        failures += 0 if ok else 1

    # ‏קובצי הייבוא שבריפו: מכולה בלי האירוע שלהם נכשלת, ואחרי מיזוג
    # שלהם היא עוברת. זה מה שמוכיח שהקובץ באמת מחבר את האירוע ולא רק
    # נראה כמו JSON של GTM.
    imports = (
        ("docs/gtm-events-import.json", "contact_site"),
        ("docs/gtm-events-import.json", "view_item"),
        ("docs/gtm-events-import.json", "contact_agent"),
        # ‏contact_developer הוא האירוע שנוסף לקוד אחרי גרסה 4 של המכולה,
        # כלומר היחיד שהצלבה מול הייצוא האמיתי מסמנת כחסר. המקרה הזה
        # מוכיח שקובץ הייבוא באמת מחבר אותו, לפני שמישהו מייבא אותו.
        ("docs/gtm-events-import.json", "contact_developer"),
        ("docs/gtm-pwa-import.json", "pwa_banner_shown"),
    )
    for rel, event in imports:
        imported = json.loads((ROOT / rel).read_text(encoding="utf-8"))["containerVersion"]

        without = drop_event(copy.deepcopy(baseline()), event, "both")
        problems, _ = run(without)
        missing_caught = any("ואין לו טריגר CUSTOM_EVENT" in p and event in p for p in problems)

        merged = without
        for key in ("tag", "trigger", "variable"):
            merged["containerVersion"][key].extend(imported.get(key) or [])
        problems, _ = run(merged)

        ok = missing_caught and not problems
        detail = ""
        if not missing_caught:
            detail = "החוסר עצמו לא נתפס"
        elif problems:
            detail = problems[0].splitlines()[0]
        print("[%s] %s מחבר את `%s`%s"
              % ("תפס " if ok else "החמיץ", rel, event,
                 "\n        " + detail if detail else ""))
        failures += 0 if ok else 1

    # ‏מזהה מדידה שני — נבדק בנפרד, כי param() מחזיר את הראשון בתגית
    c = copy.deepcopy(baseline())
    c["containerVersion"]["tag"].append(ga4_tag("600", "search", "200"))
    c["containerVersion"]["tag"][-1]["parameter"][1]["value"] = "G-OTHER12345"
    problems, _ = run(c)
    ok = any("מזהה מדידה שאינו" in p for p in problems)
    print("[%s] מזהה מדידה שני בתגית נפרדת" % ("תפס " if ok else "החמיץ"))
    failures += 0 if ok else 1

    print()
    if failures:
        print("✗ %d מקרים לא נתפסו." % failures)
        return 1
    print("✓ כל %d המקרים התנהגו כצפוי." % (len(cases) + len(imports) + 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
