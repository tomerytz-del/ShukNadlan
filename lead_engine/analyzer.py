"""ניתוח פוסט בודד ב-Claude והחזרת אובייקט LeadAnalysis מאומת.

הפלט נאכף בעזרת Structured Outputs: מעבירים ל-`client.messages.parse()` את
מודל ה-Pydantic, ה-SDK מתרגם אותו ל-JSON Schema שהמודל מחויב אליו, ומחזיר
מופע מאומת ב-`response.parsed_output`. אין פרסינג ידני של טקסט ואין ניחושים.
"""

from __future__ import annotations

import logging
from typing import Optional

import anthropic

from .config import Settings
from .models import FeedEntry, LeadAnalysis

log = logging.getLogger(__name__)


SYSTEM_PROMPT = """\
אתה אנליסט נדל"ן ישראלי מנוסה. אתה מקבל פוסט בודד שנאסף מקבוצת פייסבוק, \
מלוח מודעות או מפיד RSS אחר, ומסווג אותו עבור מערכת שמוכרת לידים לסוכני נדל"ן.

## א. זיהוי צד ומקור

קבע מי כתב את הפוסט:
- "קונה פרטי" — אדם פרטי שמחפש לקנות נכס.
- "מוכר פרטי" — בעל/ת נכס פרטי/ת שמוכר/ת.
- "שוכר" — אדם פרטי שמחפש לשכור.
- "משכיר" — בעל/ת נכס פרטי/ת שמשכיר/ה.
- "מתווך/ספאם" — סוכן/ת נדל"ן, משרד תיווך, פרסומת, יזם, פוסט שיווקי, ספאם, \
פוסט כפול, או כל תוכן שאינו כוונת נדל"ן אישית.

סימנים למתווך או ספאם: אזכור משרד תיווך או שם מותג, "בלעדיות", "דמי תיווך", \
"למכירה אצלנו", "פנו אליי לעוד נכסים", "מבחר דירות", רשימת נכסים מרובים \
בפוסט אחד, חתימה מקצועית עם תפקיד, אימוג'ים שיווקיים מרובים, קישור לאתר \
משרד, או ניסוח קטלוגי חוזר.

**כלל מכריע: אם lead_side הוא "מתווך/ספאם" — is_lead חייב להיות false.**
כמו כן is_lead=false עבור פוסט שאינו עוסק בנדל"ן כלל, שאלה כללית ללא כוונה \
("מישהו יודע מה קורה עם המחירים?"), או פוסט ריק/חסר תוכן.

## ב. חילוץ שדות

חלץ אך ורק מה שכתוב בפוסט. אל תמציא ואל תשלים מהידע הכללי שלך. \
כל שדה שלא צוין — החזר null.

- city — עיר או יישוב. תקן שגיאות כתיב נפוצות ("עפולא" → "עפולה"). \
  אם צוינה רק שכונה מוכרת, ניתן להסיק את היישוב שלה.
- neighborhood — שכונה או אזור ספציפי בתוך היישוב ("גילה", "הצפון הישן", \
  "עפולה עילית", "ליד הקניון").
- property_type — אחד מתוך: "דירה", "פנטהאוז", "דירת גן", "בית פרטי", \
  "מסחרי", "מגרש", "אחר". דופלקס/קוטג'/וילה → "בית פרטי". חנות/משרד/מחסן \
  → "מסחרי".
- rooms — מספר חדרים כמספר עשרוני. "4 חד'" → 4, "3.5 חדרים" → 3.5. \
  אם צוין טווח ("3-4 חדרים") — קח את הנמוך.
- floor — קומה כמספר שלם. "קומת קרקע" → 0, "מרתף" → 1-, "קומה 3" → 3. \
  "קומה גבוהה" בלי מספר → null.
- price_budget — המחיר המבוקש או התקציב, מנורמל למספר שלם בשקלים חדשים: \
  "1.9 מיליון" → 1900000, "עד 2.3 מ'" → 2300000, "1,850,000 ש\"ח" → 1850000, \
  "5,500 לחודש" → 5500 (שכירות נשארת מחיר חודשי). אם צוין טווח — קח את העליון. \
  אם המחיר במטבע זר או לא ברור — null.
- urgency_level:
  - "גבוהה" — "מיידי", "דחוף", "בהקדם", "כניסה מיידית", "חייב עד ה-1 לחודש", \
    "בהזדמנות", "מחיר מציאה", "חייבים למכור".
  - "בינונית" — יש מסגרת זמן רכה: "בחודשים הקרובים", "לקראת ספטמבר", "גמיש".
  - "רגילה" — לא צוינה שום מסגרת זמן.

## ג. ציון איכות (lead_quality_score, 1 עד 10)

- 8-10 — ליד זהב: פוסט פרטי אותנטי, פרטים מלאים (עיר + חדרים + מחיר/תקציב), \
  כוונה ברורה וחד-משמעית, ולרוב גם דרך יצירת קשר או קריאה לפעולה ישירה.
- 5-7 — ליד בינוני: אזור ודרישות ברורים, אך חסר מחיר/תקציב או קומה או \
  פרט מהותי אחר. הכוונה עדיין ברורה.
- 1-4 — ליד נמוך או לא רלוונטי: חסרים פרטים מהותיים (אין עיר, אין סוג נכס), \
  סגנון שיווקי של סוכן/ת, שאילתה כללית מדי, או פוסט שאינו ליד כלל.

כאשר is_lead=false, הציון חייב להיות בטווח 1-4.

## ד. כותרת ותקציר שיווקיים

teaser_title — כותרת קצרה ומושכת לאתר, עד כ-60 תווים. לדוגמה: \
"קונה רציני לדירת 4 חד' בעפולה" · "משכיר דירת גן בשכונת רבין".

teaser_description — 1 עד 2 משפטים שמציגים את עיקר הצורך או הנכס ומייצרים \
עניין אצל הסוכן/ת שישקול/תשקול לרכוש את הליד.

**איסור מוחלט בשני השדות האלה:** שמות פרטיים או שמות משפחה, מספרי טלפון, \
כתובות מייל, כתובות מדויקות עם מספר בית, קישורים, שמות קבוצות פייסבוק, \
ומזהי משתמש. אזור, עיר ושכונה — מותר ורצוי.

אם is_lead=false — כתוב teaser קצר וענייני שמתאר למה נדחה \
(למשל: "פוסט שיווקי של משרד תיווך").

## ה. פלט

החזר אך ורק את האובייקט המובנה לפי הסכמה. אל תוסיף טקסט חופשי, הסברים או \
עיצוב מסביב.
"""


class LeadAnalyzer:
    """עוטף את לקוח Anthropic ומוסיף את הפרומפט הקבוע ואת מדיניות השגיאות."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def analyze(self, entry: FeedEntry) -> Optional[LeadAnalysis]:
        """מנתח פוסט אחד. מחזיר None אם הניתוח נכשל — הקורא סופר כשגיאה."""
        text = entry.prompt_text
        if not text:
            return None

        try:
            response = self._client.messages.parse(
                model=self._settings.model,
                max_tokens=self._settings.max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        # הפרומפט זהה בכל קריאה — שמירה במטמון חוסכת כ-90%
                        # מעלות הקלט על כל פוסט נוסף באותה הרצה.
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": text}],
                output_format=LeadAnalysis,
            )
        except anthropic.APIStatusError as err:
            log.error("שגיאת API בניתוח %s: %s", entry.source_url, err)
            return None
        except anthropic.APIConnectionError as err:
            log.error("שגיאת רשת בניתוח %s: %s", entry.source_url, err)
            return None

        if response.stop_reason == "refusal":
            log.warning("המודל סירב לנתח את %s", entry.source_url)
            return None
        if response.stop_reason == "max_tokens":
            log.warning("הניתוח של %s נקטע לפני סיום", entry.source_url)
            return None

        analysis = response.parsed_output
        if analysis is None:
            log.warning("לא התקבל פלט מובנה עבור %s", entry.source_url)
            return None

        return _apply_business_rules(analysis)


def _apply_business_rules(analysis: LeadAnalysis) -> LeadAnalysis:
    """אכיפה בקוד של הכללים שלא נכון להשאיר לשיקול דעת המודל."""
    updates: dict = {}
    if analysis.lead_side == "מתווך/ספאם" and analysis.is_lead:
        updates["is_lead"] = False
    if (updates.get("is_lead", analysis.is_lead) is False) and analysis.lead_quality_score > 4:
        updates["lead_quality_score"] = 4
    return analysis.model_copy(update=updates) if updates else analysis
