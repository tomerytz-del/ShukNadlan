"""ניסוח מבזק אחד ב-Claude, עם פלט מובנה ומאומת.

אותה שיטה כמו מנוע הלידים: מעבירים ל-`client.messages.parse()` את מודל
ה-Pydantic, ה-SDK מתרגם אותו ל-JSON Schema שהמודל מחויב אליו, ומחזיר מופע
מאומת ב-`response.parsed_output`. אין פרסינג ידני של טקסט.

ההבדל מהלידים: כאן המודל לא רק מסווג אלא גם *מנסח מחדש*. כותרת של אתר
חדשות נכתבה בשביל אתר החדשות — היא נשענת על ההקשר שבעמוד, מכילה את שם
המותג, ולעיתים היא קליקבייט. שורת מבזק באתר נדל"ן צריכה להיקרא לבדה,
בהעברת עין אחת.
"""

from __future__ import annotations

import logging
from typing import Optional

import anthropic

from .config import Settings
from .models import MAX_HEADLINE_CHARS, NewsAnalysis
from .relevance import shorten_headline

log = logging.getLogger(__name__)


SYSTEM_PROMPT = f"""\
אתה עורך/ת חדשות נדל"ן של "שוק הנדל"ן של עפולה" — מרקטפלייס הנדל"ן של עפולה \
והעמק. אתה מקבל ידיעה בודדת שנאספה מפרסומי עיריית עפולה או מאתר חדשות/נדל"ן \
ישראלי, ומכין ממנה שורת מבזק לרצועת החדשות בדף הבית.

## א. האם הידיעה בכלל נכנסת

‏is_relevant=true רק לידיעה שיש בה ערך לקונה, מוכר, שוכר, משכיר או משקיע \
בעפולה ובעמק. כלומר: שוק הדיור, מחירים ועסקאות, תכנון ובנייה, התחדשות \
עירונית, מכרזי קרקע, משכנתאות וריבית, תשתיות שמשפיעות על ערך נכסים.

‏is_relevant=false עבור: פרסומת או תוכן שיווקי של קבלן/משרד תיווך, ידיעה \
שאינה נדל"ן (פלילים, ספורט, פוליטיקה כללית), ידיעה על מניה או דוח כספי של \
חברה, מדריך כללי בלי חדשות בתוכו, כותרת ריקה או קטועה.

## ב. היקף

- "afula" — הידיעה עוסקת בעפולה עצמה (כולל עפולה עילית וגבעת המורה).
- "region" — עמק יזרעאל והסביבה: מגדל העמק, בית שאן, נצרת, יישובי העמק, \
  הגלבוע, עמק המעיינות.
- "national" — ידיעה ארצית שאינה קשורה לאזור ספציפי.

בספק בין מקומי לארצי — הכרע לפי מה שהידיעה *עוסקת* בו, לא לפי מה שהיא מזכירה \
דרך אגב.

## ג. שורת המבזק (headline)

- עברית, עד {MAX_HEADLINE_CHARS} תווים, משפט עובדתי אחד.
- מתחילה בעיקר: מה קרה ולמי זה נוגע.
- **בלי** שם האתר או המקור, **בלי** תאריך, **בלי** אימוג'י, **בלי** סימני \
  קריאה, **בלי** קליקבייט ("לא תאמינו", "כל מה שצריך לדעת").
- מספרים ומחירים — כתוב אותם במלואם ובפורמט ישראלי (1,850,000 ₪).
- אם הידיעה מקומית, שם היישוב צריך להופיע בשורה.

דוגמאות טובות:
"עיריית עפולה אישרה תוכנית ל-320 יחידות דיור בגבעת המורה"
"בנק ישראל הותיר את הריבית ללא שינוי בפעם השלישית ברציפות"
"מחיר ממוצע לדירת 4 חדרים בעפולה עלה ב-3.1% ברבעון האחרון"

## ד. התקציר (summary)

1 עד 2 משפטים שמסבירים מה קרה ולמה זה משנה לשוק בעפולה. עובדתי, בלי קריאה \
לפעולה, בלי שיווק ובלי המלצות השקעה. אל תמציא נתונים שאינם בידיעה — אם פרט \
חסר, פשוט אל תזכיר אותו.

## ה. ציון (relevance_score, 1 עד 10)

- 8-10 — ידיעה מקומית קונקרטית על עפולה והעמק, או החלטה ארצית עם השפעה \
  ישירה ומיידית על קונים ומוכרים (ריבית, מס רכישה, מחיר למשתכן).
- 5-7 — ידיעת שוק ארצית מבוססת נתונים, או ידיעה מקומית שולית.
- 1-4 — קשר רופף לנדל"ן, ידיעה ישנה, תוכן שיווקי או כותרת בלי תוכן. \
  כאשר is_relevant=false הציון חייב להיות בטווח 1-4.

## ו. מפתח האירוע (story_key)

זהו השדה שמונע מאותו אירוע להופיע ברצועה ארבע פעמים מארבעה אתרים. הפורמט \
קבוע — שלושה חלקים מופרדים בקו אנכי:

    נושא|אירוע|תקופה

הכלל היחיד שחשוב: **שני עיתונאים שכתבו על אותו אירוע חייבים לקבל ממך את \
אותו מפתח בדיוק**, גם אם הכותרות שלהם שונות לגמרי. לכן:

- **שמות עצם, לא פעלים מוטים.** "הורדה" — לא "הוריד", לא "ירדה", לא \
  "הפחית", לא "יוזלו". הנטייה בעברית היא בדיוק מה ששובר את ההתאמה.
- בלי שם האתר, בלי מספרים מדויקים (0.25% מול "רבע אחוז" זה אותו אירוע), \
  בלי מילות קישור ובלי תיאורים ("דרמטי", "היסטורי").
- התקופה היא חודש הידיעה בפורמט YYYY-MM.

ארבע הכותרות האלה — "בנק ישראל מוריד את הריבית ברבע אחוז", "בפעם השלישית \
ברצף: הריבית ירדה ב-0.25%", "הריבית ירדה - בכמה יתכווץ החזר המשכנתא" \
ו-"נעילה חיובית בבורסה אחרי הפחתת הריבית" — כולן אותו אירוע, וכולן צריכות \
לקבל: ‎ריבית בנק ישראל|הורדה|2026-09

לעומת זאת "בנק ישראל הותיר את הריבית ללא שינוי" הוא אירוע *אחר*: \
‎ריבית בנק ישראל|הותרה ללא שינוי|2026-09

## ז. פלט

החזר אך ורק את האובייקט המובנה לפי הסכמה. אל תוסיף טקסט חופשי או עיצוב מסביב.
"""


class NewsAnalyzer:
    """עוטף את לקוח Anthropic ומוסיף את הפרומפט הקבוע ואת מדיניות השגיאות."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    def analyze(self, *, url: str, title: str, content: str, source_name: str,
                source_scope: str) -> Optional[NewsAnalysis]:
        """מנסח מבזק אחד. מחזיר None אם הניתוח נכשל — הקורא סופר כשגיאה."""
        parts = []
        if source_name:
            parts.append(f"מקור: {source_name} (היקף משוער: {source_scope})")
        if title:
            parts.append(f"כותרת: {title}")
        if content:
            parts.append(f"גוף הידיעה:\n{content}")
        text = "\n\n".join(parts).strip()
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
                        # מעלות הקלט על כל ידיעה נוספת באותה הרצה.
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": text}],
                output_format=NewsAnalysis,
            )
        except anthropic.APIStatusError as err:
            log.error("שגיאת API בניתוח %s: %s", url, err)
            return None
        except anthropic.APIConnectionError as err:
            log.error("שגיאת רשת בניתוח %s: %s", url, err)
            return None

        if response.stop_reason == "refusal":
            log.warning("המודל סירב לנתח את %s", url)
            return None
        if response.stop_reason == "max_tokens":
            log.warning("הניתוח של %s נקטע לפני סיום", url)
            return None

        analysis = response.parsed_output
        if analysis is None:
            log.warning("לא התקבל פלט מובנה עבור %s", url)
            return None

        return _apply_editorial_rules(analysis)


def _apply_editorial_rules(analysis: NewsAnalysis) -> NewsAnalysis:
    """
    אכיפה בקוד של מה שלא נכון להשאיר לשיקול דעת המודל.

    אורך הכותרת נאכף כאן ולא רק בפרומפט: הרצועה חותכת שורה ארוכה באמצע
    מילה, וזה נראה כמו תקלה. ‏shorten_headline חותך על גבול מילה ומוסיף
    שלוש נקודות.
    """
    updates: dict = {}
    headline = shorten_headline(analysis.headline)
    if headline != analysis.headline:
        updates["headline"] = headline
    if not analysis.is_relevant and analysis.relevance_score > 4:
        updates["relevance_score"] = 4
    return analysis.model_copy(update=updates) if updates else analysis
