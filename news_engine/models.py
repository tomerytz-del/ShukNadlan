"""המבנים של מנוע המבזקים, ובראשם סכמת הפלט ש-Claude מחויב להחזיר."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel, Field

# היקף גיאוגרפי. הערכים זהים ל-check constraint של news_items.scope, כי הם
# נכתבים לעמודה כמו שהם.
NewsScope = Literal["afula", "region", "national"]

NewsCategory = Literal[
    "עיריית עפולה",
    "תכנון ובנייה",
    "שוק הדיור",
    "משכנתאות וריבית",
    "עסקאות ומחירים",
    "תשתיות ותחבורה",
    "אחר",
]

# מגבלת אורך הכותרת. הרצועה היא שורה אחת שנחתכת ב-ellipsis, ולכן כותרת
# ארוכה לא "נכנסת בקטן" אלא פשוט נעלמת באמצע.
MAX_HEADLINE_CHARS = 90


class NewsAnalysis(BaseModel):
    """
    סכמת הפלט של Claude, מועברת ל-`client.messages.parse()` ומתורגמת
    ל-JSON Schema שהמודל מחויב אליו — התשובה תמיד JSON תקין ומאומת.
    """

    is_relevant: bool = Field(
        description="האם הפריט הוא ידיעת נדל\"ן/דיור אמיתית שרלוונטית לגולשי "
        "מרקטפלייס הנדל\"ן של עפולה. false עבור פרסומת, ידיעה שאינה נדל\"ן, "
        "ידיעה כפולה או כותרת ריקה."
    )
    scope: NewsScope = Field(
        description="afula = עוסק בעפולה עצמה, region = עמק יזרעאל והסביבה "
        "(מגדל העמק, בית שאן, נצרת, יישובי העמק), national = ידיעה ארצית."
    )
    category: NewsCategory = Field(description="נושא הידיעה.")
    headline: str = Field(
        description=f"שורת המבזק בעברית, עד {MAX_HEADLINE_CHARS} תווים. משפט "
        "עובדתי אחד שאפשר לקרוא בהעברת עין, בלי שם האתר, בלי תאריך ובלי אימוג'י."
    )
    summary: str = Field(
        description="1–2 משפטים שמסבירים מה קרה ולמה זה מעניין קונה, מוכר או "
        "משקיע בעפולה. בלי קריאה לפעולה ובלי שיווק."
    )
    relevance_score: int = Field(
        ge=1, le=10, description="עד כמה הידיעה מעניינת את קהל האתר, 1 עד 10."
    )
    reasoning: Optional[str] = Field(
        default=None, description="משפט קצר שמסביר את הסיווג ואת הציון (לתחקור פנימי)."
    )


@dataclass
class RunStats:
    """סיכום הרצה אחת — מודפס ללוג ולסיכום ה-Workflow."""

    sources: int = 0
    entries: int = 0
    duplicates: int = 0
    filtered_out: int = 0
    too_old: int = 0
    analyzed: int = 0
    inserted: int = 0
    rejected: int = 0
    errors: int = 0

    def as_lines(self) -> list[str]:
        return [
            f"מקורות שנקראו: {self.sources}",
            f"פריטים בפידים: {self.entries}",
            f"כפילויות שדולגו: {self.duplicates}",
            f"נפסלו בסינון מילות המפתח: {self.filtered_out}",
            f"ישנים מדי: {self.too_old}",
            f"נשלחו לניתוח: {self.analyzed}",
            f"מבזקים שפורסמו: {self.inserted}",
            f"נדחו (לא רלוונטי/ציון נמוך): {self.rejected}",
            f"שגיאות: {self.errors}",
        ]
