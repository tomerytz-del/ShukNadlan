#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
דפי ההצטרפות של בעלי המקצוע והיזמים - ארבעה דפים סטטיים מתבנית אחת.

## למה מחולל ולא קובץ אחד שנבנה ב-JS

דף שהתוכן שלו נכתב ב-JS נראה ריק לסורק ולמנועי AI, ודפי הצטרפות הם בדיוק
מה שמחפשים בגוגל ("הצטרפות כיועץ משכנתאות"). לכן כל דף הוא קובץ HTML סטטי
עם תוכנו בתוכו, אבל **המבנה נכתב פעם אחת, כאן**: ארבעה דפים שנכתבו ביד
היו מתפצלים אחרי השינוי השלישי (כותרת אחת מתוקנת, שלוש לא).

הקבצים שנוצרים (`join-*.html` בשורש) נשמרים בריפו, ו-`--check` (workflow
`join_pages.yml`) נכשל כשהם אינם מה שהמחולל מייצר. כלומר **לא עורכים אותם
ביד**: משנים כאן ומריצים `python scripts/build_join_pages.py`.

## מה נלקח מ-for-brokers.html

הכותרת העליונה, הפוטר (כולל באנר מחפשי הנכס) וגיליון הסגנון נלקחים מ-
`for-brokers.html` בזמן ההרצה, ולא משוכפלים כאן: שינוי בפוטר המשותף מתעדכן
בדפים האלה בהרצה אחת, וה-`--check` אומר שצריך להריץ.

## מה כתוב בדפים, ומה לא

עובדות על מה שקיים בפלטפורמה בלבד. **אין מחירים בדפים**: מחיר כתוב בעוד מקום
הוא מקום שישכחו לעדכן (הסקיל `pricing-change`), ולכן הם מפנים לדף ההרשמה
ולחלון האישור שבו המחיר מוצג לפני החיוב. **אין הבטחת לידים או הכנסה.**
"הפרסום חינם" אינו כתוב כאן מאותה סיבה: הוא הטבה זמנית שיש לה רשימת מקומות
שמעדכנים בכיבוי (`docs/professional-cards.md`).

הרצה:
    python scripts/build_join_pages.py           # כותב את הקבצים
    python scripts/build_join_pages.py --check   # נכשל אם הם לא עדכניים
"""
from __future__ import annotations

import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "for-brokers.html"
SITE = "https://shuknadlan.co.il"
CONTACT_MAIL = "shuknadlan@gmail.com"

# ---------------------------------------------------------------------------
# התוכן. כל דף: slug (שם הקובץ והכתובת), כותרות, ויחידות תוכן.
# ‏HTML פנימי (<strong>, <a>) מותר כאן והוא נכתב כמו שהוא: התוכן שלנו, לא של גולש.
# ---------------------------------------------------------------------------
SIGNUP_PRO = "/professional-signup?type={t}"

# ניסוחים שחוזרים בכמה דפים נכתבים פעם אחת, כדי שתיקון אחד יתפוס את כולם
TRUST_PRO = "הכרטיסייה עוברת אישור של הנהלת האתר לפני שהיא עולה. תנאי הפרסום והמחיר מוצגים בדף ההרשמה, לפני שמאשרים."
FAQ_COST_PRO = ("כמה זה עולה?", "תנאי הפרסום והמחיר מוצגים בדף ההרשמה לפני שמאשרים, והנהלת האתר רשאית לשנות אותם לפי תנאי השימוש.")
FAQ_ACCOUNT_PRO = ("האם צריך חשבון באתר?", "לא. ההרשמה היא טופס קצר, ואחריה מתקבל קישור אישי לעריכת הפרופיל.")
FAQ_WHO_SEES_PRO = ("מי רואה את הכרטיסייה?", "גולשים בדף הבית, בדף בעלי המקצוע ובעמוד הפרופיל שלכם. הפניות נשלחות אליכם ישירות בוואטסאפ, בטלפון או במייל.")
STEPS_CARD_PRO = [
    "הנהלת האתר מאשרת, והכרטיסייה עולה לאוויר.",
    "משלימים תמונות ותיאור בקישור העריכה האישי שמתקבל בסיום ההרשמה. שמרו אותו: זו הדרך החוזרת לעריכה.",
]
GIVES_PROFILE_PRO = [
    "<strong>כרטיסייה ברצועת \"בעלי מקצוע נבחרים\"</strong> בדף הבית.",
    "<strong>עמוד פרופיל מלא משלכם:</strong> שם העסק, תמונות, תיאור, אזורי שירות, שנות ניסיון ומספר רישיון, עם כפתורי וואטסאפ, חיוג ומייל.",
    "<strong>הופעה בדף \"בעלי מקצוע\"</strong> תחת התחום שלכם, ובדפי השוק של האזור.",
    "<strong>עריכה בקישור אישי:</strong> אין צורך בחשבון באתר כדי לעדכן תמונות ותיאור.",
]
NO_PROMISE_PRO = "אין הבטחה לכמות פניות. הכרטיסייה היא חשיפה, והפניות מגיעות ישירות אליכם."
CLOSER_PRO = ["מוכנים", "להופיע באתר?"]
SECONDARY_ALL_PROS = {"label": "כל בעלי המקצוע באתר", "href": "/professionals"}
PARENT_PROS = {"name": "בעלי מקצוע", "href": "/professionals"}

PAGES = [
    {
        "slug": "join-mortgage-advisor",
        "parent": PARENT_PROS,
        "crumb": "יועצי משכנתאות",
        "title": "הצטרפות כיועץ/ת משכנתאות | שוק נדל״ן",
        "h1": ["הצטרפות", "כיועץ/ת משכנתאות", "בשוק נדל״ן"],
        "deck": "כרטיסייה ועמוד פרופיל באתר, וגישה ללידים ממחשבון המשכנתא לחשבון שהנהלת האתר מסמנת כחשבון של יועץ/ת משכנתאות.",
        "meta": "יועץ/ת משכנתאות? כרטיסייה ועמוד פרופיל בשוק נדל״ן, וגישה ללידים של גולשים שהשאירו פרטים אחרי חישוב במחשבון המשכנתא. כך מצטרפים.",
        "intro": [
            "גולשים באתר משתמשים במחשבון המשכנתא בדף הבית ובדף הנכס. מי שמשאיר/ה פרטים בסוף החישוב מבקש/ת שיחזרו אליו/ה, וזה ליד שנמכר ליועץ/ת משכנתאות אחד/ת בלבד.",
            "<strong>שני דברים נפרדים:</strong> הכרטיסייה פתוחה לכל יועץ/ת, והמדף של הלידים נפתח רק לחשבון CRM שמסומן ידנית על ידי הנהלת האתר.",
        ],
        "primary": {"label": "פתיחת כרטיסייה כיועץ/ת משכנתאות", "href": SIGNUP_PRO.format(t="mortgage_advisor")},
        "secondary": {"label": "גישה למדף הלידים", "href": "mailto:" + CONTACT_MAIL + "?subject=%D7%9E%D7%93%D7%A3%20%D7%9C%D7%99%D7%93%D7%99%20%D7%9E%D7%A9%D7%9B%D7%A0%D7%AA%D7%90%D7%95%D7%AA", "site_contact": True},
        "trust": TRUST_PRO,
        "gives_title": "מה מקבלים",
        "gives": [
            "<strong>כרטיסייה ברצועת \"בעלי מקצוע נבחרים\"</strong> בדף הבית, ועמוד פרופיל מלא משלכם: תמונות, תיאור, אזורי שירות ושנות ניסיון.",
            "<strong>לידים ממחשבון המשכנתא</strong> (לחשבון מסומן): לפני הרכישה רואים את נתוני החישוב - מחיר הנכס, הון עצמי, סכום ההלוואה ואחוז המימון. השם והטלפון נחשפים רק אחרי הרכישה.",
            "<strong>ליד אחד, יועץ/ת אחד/ת:</strong> כל ליד נמכר פעם אחת, ולא לכמה יועצים במקביל.",
            "<strong>אישור לפני כל חיוב:</strong> הרכישה יורדת מהארנק, והמחיר מוצג בחלון אישור לפני שהיא מתבצעת.",
        ],
        "steps_title": "איך מתחילים",
        "steps": [
            "ממלאים את טופס הכרטיסייה ובוחרים \"יועץ/ת משכנתאות\" כתחום העיסוק.",
            *STEPS_CARD_PRO,
            "לגישה למדף הלידים כותבים לנו: נפתח חשבון CRM ונסמן אותו כחשבון של יועץ/ת משכנתאות. כרטיסייה בלבד אינה פותחת את המדף.",
        ],
        "know_title": "מה חשוב לדעת",
        "know": [
            "הלידים הם פניות של גולשים, ואיננו מתחייבים לכמות, לאיכות או לסגירת עסקה.",
            "התוכן בכרטיסייה באחריות בעל/ת המקצוע. שוק נדל״ן אינו צד לעסקה ואינו נותן ייעוץ.",
        ],
        "faq": [
            ("איך מקבלים לידים של משכנתאות?", "הלידים מגיעים ממחשבון המשכנתא באתר. המדף נפתח רק לחשבון CRM שהנהלת האתר סימנה כחשבון של יועץ/ת משכנתאות, וכרטיסייה בלבד אינה פותחת אותו. לבקשת גישה כותבים לנו."),
            ("האם הליד בלעדי?", "כן. ליד נמכר ליועץ/ת אחד/ת, ואחרי שנרכש הוא יורד מהמדף של כל השאר."),
            ("כמה עולה ליד?", "המחיר מוצג בחלון האישור לפני כל רכישה, ולא נגבה דבר בלי אישור."),
        ],
        "closer": CLOSER_PRO,
    },
    {
        "slug": "join-lawyer",
        "parent": PARENT_PROS,
        "crumb": "עורכי דין",
        "title": "הצטרפות כעו״ד מקרקעין | שוק נדל״ן",
        "h1": ["הצטרפות", "כעו״ד מקרקעין", "בשוק נדל״ן"],
        "deck": "כרטיסייה ועמוד פרופיל בדף הבית ובדף בעלי המקצוע, לפני שהלקוחות הבאים שלכם מחפשים עורך/ת דין.",
        "meta": "עו״ד מקרקעין? כרטיסייה ועמוד פרופיל בשוק נדל״ן, שם קונים, מוכרים ושוכרים מחפשים בעלי מקצוע באזור. כך מצטרפים.",
        "intro": [
            "מי שקונה או מוכר דירה צריך כמעט תמיד עורך/ת דין. שוק נדל״ן מציג לגולשים בעלי מקצוע מהאזור לצד הנכסים, ועו״ד מקרקעין הוא אחד התחומים שבהם אפשר להופיע.",
        ],
        "primary": {"label": "פתיחת כרטיסייה כעו״ד מקרקעין", "href": SIGNUP_PRO.format(t="real_estate_lawyer")},
        "secondary": SECONDARY_ALL_PROS,
        "trust": TRUST_PRO,
        "gives_title": "מה מקבלים",
        "gives": GIVES_PROFILE_PRO,
        "steps_title": "איך מתחילים",
        "steps": ["ממלאים את טופס הכרטיסייה ובוחרים \"עו״ד מקרקעין\" כתחום העיסוק.", *STEPS_CARD_PRO],
        "know_title": "מה חשוב לדעת",
        "know": [
            "התוכן בכרטיסייה באחריות עורך/ת הדין. הפרסום אינו ייעוץ משפטי של האתר, ושוק נדל״ן אינו צד ליחסי עו״ד-לקוח.",
            NO_PROMISE_PRO,
        ],
        "faq": [FAQ_ACCOUNT_PRO, FAQ_WHO_SEES_PRO, FAQ_COST_PRO],
        "closer": CLOSER_PRO,
    },
    {
        "slug": "join-appraiser",
        "parent": PARENT_PROS,
        "crumb": "שמאי מקרקעין",
        "title": "הצטרפות כשמאי/ת מקרקעין | שוק נדל״ן",
        "h1": ["הצטרפות", "כשמאי/ת מקרקעין", "בשוק נדל״ן"],
        "deck": "כרטיסייה ועמוד פרופיל באתר שבו קונים ומוכרים כבר מחפשים נתונים על הנכס והאזור.",
        "meta": "שמאי/ת מקרקעין? כרטיסייה ועמוד פרופיל בשוק נדל״ן, באתר שבו גולשים בודקים מחירים, עסקאות ושכונות. כך מצטרפים.",
        "intro": [
            "גולשים באתר בודקים מחירי דירות לפי עסקאות, שכונות ונכסים. שמאי/ת מקרקעין שמופיע/ה לצד הנתונים האלה פוגש/ת אותם בדיוק ברגע שהם שואלים כמה הנכס שווה.",
        ],
        "primary": {"label": "פתיחת כרטיסייה כשמאי/ת מקרקעין", "href": SIGNUP_PRO.format(t="appraiser")},
        "secondary": SECONDARY_ALL_PROS,
        "trust": TRUST_PRO,
        "gives_title": "מה מקבלים",
        "gives": GIVES_PROFILE_PRO,
        "steps_title": "איך מתחילים",
        "steps": ["ממלאים את טופס הכרטיסייה ובוחרים \"שמאי/ת מקרקעין\" כתחום העיסוק.", *STEPS_CARD_PRO],
        "know_title": "מה חשוב לדעת",
        "know": [
            "התוכן בכרטיסייה באחריות בעל/ת המקצוע. שוק נדל״ן אינו נותן שומה ואינו צד לעסקה.",
            NO_PROMISE_PRO,
        ],
        "faq": [FAQ_ACCOUNT_PRO, FAQ_WHO_SEES_PRO, FAQ_COST_PRO],
        "closer": CLOSER_PRO,
    },
    {
        "slug": "join-developer",
        # יזם אינו בעל מקצוע בדף "בעלי מקצוע": ההורה שלו הוא הדף שמרכז את הפרויקטים
        "parent": {"name": "פרויקטים חדשים", "href": "/projects"},
        "crumb": "יזמים וקבלנים",
        "title": "הצטרפות כיזם או קבלן | שוק נדל״ן",
        "h1": ["הצטרפות", "כיזם או קבלן", "בשוק נדל״ן"],
        "deck": "דף חברה, ודף נחיתה נפרד לכל פרויקט, בדף שמרכז את כל הפרויקטים החדשים של האזור.",
        "meta": "יזם או קבלן? דף חברה ודף נחיתה לכל פרויקט בשוק נדל״ן, עם גלריה, סרטונים, סיור 3D, תמהיל דירות וחוברת מכר. כך פותחים חשבון.",
        "intro": [
            "קונים מחפשים דירה מקבלן במקום אחד, ולא באתר נפרד לכל פרויקט. החברה מקבלת עמוד משלה, וכל פרויקט מקבל דף נחיתה משלו.",
        ],
        "primary": {"label": "פתיחת חשבון יזם/קבלן", "href": "/developer-signup"},
        "secondary": {"label": "הפרויקטים באתר", "href": "/projects"},
        "trust": "המחירון מוצג בדף ההרשמה לפני פתיחת החשבון. החברה אחראית לנכונות המידע, המחירים והתמונות בדפי הפרויקטים.",
        "gives_title": "מה מקבלים",
        "gives": [
            "<strong>דף חברה אחד,</strong> עם לוגו, תמונת נושא ומשפט תדמית.",
            "<strong>דף נחיתה נפרד לכל פרויקט:</strong> גלריה, סרטונים, סיור 3D, תמהיל דירות וחוברת מכר להורדה.",
            "<strong>חשיפה בשלושה מקומות:</strong> דף הבית, דף החברה, והדף שמרכז את כל הפרויקטים.",
            "<strong>אזור ניהול משלכם,</strong> נפרד מעולם התיווך, עם ארנק ויומן חיובים.",
            "<strong>פניות ישירות:</strong> מי שפונה לפרויקט פונה למשרד המכירות שלכם, בלי עמלת תיווך. לידים של מחפשי פרויקט חדש שלא פנו לפרויקט מסוים אפשר לרכוש מהארנק, והמחיר מוצג לפני הרכישה.",
        ],
        "steps_title": "איך מתחילים",
        "steps": [
            "פותחים חשבון עם Google או בטופס. מספר התאגיד (ח״פ) נבדק מול רשם החברות בזמן ההקלדה.",
            "מעצבים את דף החברה: לוגו, תמונת נושא ותיאור.",
            "מעלים פרויקט ראשון לדף נחיתה משלו, ומפרסמים אותו.",
        ],
        "know_title": "מה חשוב לדעת",
        "know": [
            "החשבון הוא של חברה יזמית או קבלנית, ואינו חשבון של יועץ/ת נדל״ן. מי שרוצה לפרסם נכסים למכירה ולהשכרה מצטרף דרך <a href=\"/for-brokers\">דף הצטרפות המשרדים</a>.",
            "המידע, המחירים והתמונות בדפי הפרויקטים הם באחריות החברה, ואינם מהווים הצעה מחייבת.",
        ],
        "faq": [
            ("מה ההבדל בין דף חברה לדף פרויקט?", "דף החברה אחד לחברה. כל פרויקט הוא דף נחיתה נפרד עם כתובת משלו, גלריה, סרטונים, תמהיל דירות וחוברת מכר."),
            ("איך פונים אליכם?", "פנייה לפרויקט מגיעה למשרד המכירות של הפרויקט. אין עמלת תיווך על פנייה ישירה של קונה."),
            ("כמה זה עולה?", "המחירון מוצג בדף ההרשמה לפני פתיחת החשבון, ושינוי מחיר מתעדכן שם."),
        ],
        "closer": ["מוכנים", "להעלות פרויקט?"],
    },
]


# ---------------------------------------------------------------------------
# החלקים המשותפים, מ-for-brokers.html
# ---------------------------------------------------------------------------
def between(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i) + len(end)
    return text[i:j]


def shared_parts() -> dict[str, str]:
    src = SOURCE.read_text(encoding="utf-8")
    head_top = src[: src.index("<title>")]            # charset, GTM, events.js, viewport
    after_title = src[src.index("</title>") + len("</title>"):]
    icons_to_verify = after_title[: after_title.index('<link rel="canonical"')]
    return {
        "head_top": head_top,
        "icons_pwa_verify": icons_to_verify,
        "styles": between(src, "<style>", "</style>"),
        "scripts": between(src, '<script src="assets/page-bg.js" data-auto></script>',
                           '<script defer src="assets/buyer-banner.js"></script>'),
        "header": between(src, '<header class="site">', "</header>"),
        "footer": between(src, '<footer class="site">', "</footer>"),
        "noscript": between(src, "<!-- Google Tag Manager (noscript) -->",
                            "<!-- End Google Tag Manager (noscript) -->"),
    }


def esc(s: str) -> str:
    return html.escape(s, quote=True)   # כל חמשת התווים, כמו escapeHtml באתר


def nw(parts: list[str]) -> str:
    return " ".join(f'<span class="nw">{p}</span>' for p in parts)


def render(page: dict, parts: dict[str, str]) -> str:
    url = f"{SITE}/{page['slug']}"
    desc = page["meta"]
    faq_ld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
            for q, a in page["faq"]
        ],
    }
    crumbs_ld = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "דף הבית", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": page["parent"]["name"], "item": SITE + page["parent"]["href"]},
            {"@type": "ListItem", "position": 3, "name": page["crumb"], "item": url},
        ],
    }
    page_ld = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": page["title"],
        "url": url,
        "description": desc,
        "inLanguage": "he",
    }

    def ld(obj: dict) -> str:
        return '<script type="application/ld+json">\n' + json.dumps(obj, ensure_ascii=False, indent=2) + "\n</script>"

    gives = "\n".join(f"      <li>{x}</li>" for x in page["gives"])
    steps = "\n".join(f"      <li>{x}</li>" for x in page["steps"])
    know = "\n".join(f"      <li>{x}</li>" for x in page["know"])
    faq = "\n".join(
        f'      <details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in page["faq"]
    )
    intro = "\n".join(f"    <p>{p}</p>" for p in page["intro"])
    p1, p2 = page["primary"], page["secondary"]

    return f"""{parts["head_top"]}<title>{esc(page["title"])}</title>
{parts["icons_pwa_verify"]}<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="שוק נדל״ן">
<meta property="og:locale" content="he_IL">
<meta property="og:title" content="{esc(page["title"])}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/og-default.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="{esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site-footer.css">
<link rel="stylesheet" href="assets/buyer-banner.css">
<link rel="stylesheet" href="assets/design-system.css">
<link rel="stylesheet" href="assets/content-page.css">

{parts["styles"]}

{parts["scripts"]}
<script defer src="assets/markets.js"></script>
<script defer src="assets/city-context.js"></script>
<script defer src="assets/market-text.js"></script>
{ld(page_ld)}
{ld(faq_ld)}
{ld(crumbs_ld)}
</head>
<body>
{parts["noscript"]}

{parts["header"]}

<section class="page-head">
  <div class="wrap">
    <nav class="crumbs" aria-label="מיקום בדפים">
      <a href="/">דף הבית</a>
      <span aria-hidden="true">·</span>
      <a href="{page["parent"]["href"]}">{page["parent"]["name"]}</a>
      <span aria-hidden="true">·</span>
      <span aria-current="page">{page["crumb"]}</span>
    </nav>
    <h1>{nw(page["h1"])}</h1>
    <p class="deck">{page["deck"]}</p>
{intro}
    <div class="actions">
      <a class="btn btn-teal" href="{p1["href"]}">{p1["label"]}</a>
      <a class="btn btn-ghost" href="{p2["href"]}"{" data-site-contact" if p2.get("site_contact") else ""}>{p2["label"]}</a>
    </div>
    <p class="trust">{page["trust"]}</p>
  </div>
</section>

<main class="doc">
  <div class="wrap">

    <h2>{page["gives_title"]}</h2>
    <ul>
{gives}
    </ul>

    <h2>{page["steps_title"]}</h2>
    <ol>
{steps}
    </ol>

    <h2>{page["know_title"]}</h2>
    <ul>
{know}
    </ul>

    <h2>שאלות נפוצות</h2>
    <div class="faq">
{faq}
    </div>

    <section class="closer" aria-labelledby="closerTitle">
      <h2 id="closerTitle">{nw(page["closer"])}</h2>
      <div class="actions">
        <a class="btn btn-teal" href="{p1["href"]}">{p1["label"]}</a>
      </div>
    </section>

  </div>
</main>

{parts["footer"]}


</body>
</html>
"""


def wiring_problems() -> list[str]:
    """כל דף נכתב ידנית ל-_redirects, ל-sitemap.xml ול-llms.txt: בלעדיהם Netlify מגיש גם את
    /x.html בתשובה 200 (כפילות), והדף אינו בסיטמאפ. המחולל מכיר כל slug, ולכן הוא שבודק."""
    redirects = (ROOT / "_redirects").read_text(encoding="utf-8")
    sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
    out: list[str] = []
    for page in PAGES:
        slug = page["slug"]
        if not any(l.split()[:3] == [f"/{slug}.html", f"/{slug}", "301!"] for l in redirects.splitlines() if l.strip()):
            out.append(f"_redirects: חסרה שורת 301 מ-/{slug}.html ל-/{slug}")
        if f"<loc>{SITE}/{slug}</loc>" not in sitemap:
            out.append(f"sitemap.xml: חסרה הכתובת /{slug}")
        if f"{SITE}/{slug})" not in llms:
            out.append(f"llms.txt: חסר קישור ל-/{slug}")
    return out


def main(argv: list[str]) -> int:
    check = "--check" in argv
    parts = shared_parts()
    stale: list[str] = []
    for page in PAGES:
        out = ROOT / f"{page['slug']}.html"
        text = render(page, parts)
        if check:
            if not out.exists() or out.read_text(encoding="utf-8") != text:
                stale.append(out.name)
        else:
            out.write_text(text, encoding="utf-8")
            print("נכתב", out.name)
    wiring = wiring_problems() if check else []
    if stale:
        print("✗ דפי ההצטרפות אינם מה שהמחולל מייצר: " + ", ".join(stale))
        print("  הם נוצרים, לא נערכים ביד. להריץ: python scripts/build_join_pages.py")
    if wiring:
        print("✗ דף הצטרפות בלי החיווט הידני שלו:")
        for w in wiring:
            print("  - " + w)
    if stale or wiring:
        return 1
    if check:
        print(f"✓ {len(PAGES)} דפי הצטרפות תואמים למחולל.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
