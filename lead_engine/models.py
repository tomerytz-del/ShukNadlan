"""המבנים שעוברים בין השלבים, ובראשם סכמת הפלט ש-Claude מחויב להחזיר."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

LeadSide = Literal["קונה פרטי", "מוכר פרטי", "שוכר", "משכיר", "מתווך/ספאם"]
PropertyType = Literal[
    "דירה", "פנטהאוז", "דירת גן", "בית פרטי", "מסחרי", "מגרש", "אחר"
]
UrgencyLevel = Literal["גבוהה", "בינונית", "רגילה"]


@dataclass(frozen=True)
class FeedEntry:
    """פריט גולמי אחד מתוך פיד RSS, אחרי ניקוי HTML."""

    source_url: str
    title: str
    content: str
    published_at: Optional[datetime]
    source_id: Optional[str] = None
    source_name: Optional[str] = None

    @property
    def prompt_text(self) -> str:
        """הטקסט שנשלח ל-Claude — כותרת וגוף הפוסט, בלי מטא־דאטה מיותר."""
        parts = []
        if self.title:
            parts.append(f"כותרת הפוסט: {self.title}")
        if self.content:
            parts.append(f"תוכן הפוסט:\n{self.content}")
        return "\n\n".join(parts).strip()


class LeadAnalysis(BaseModel):
    """
    סכמת הפלט של Claude. היא מועברת ל-`client.messages.parse()` ומתורגמת
    ל-JSON Schema שהמודל מחויב אליו, כך שהתשובה תמיד JSON תקין ומאומת.
    """

    is_lead: bool = Field(
        description="האם זהו ליד אמיתי מאדם פרטי. false עבור מתווך, ספאם, "
        "פרסומת, פוסט כללי או כל דבר שאינו כוונת נדל\"ן ממשית."
    )
    lead_side: LeadSide = Field(
        description="הצד שממנו נכתב הפוסט. 'מתווך/ספאם' תמיד יחד עם is_lead=false."
    )
    city: Optional[str] = Field(
        default=None, description="עיר או יישוב. null אם לא צוין."
    )
    neighborhood: Optional[str] = Field(
        default=None, description="שכונה או אזור ספציפי בתוך היישוב. null אם לא צוין."
    )
    property_type: Optional[PropertyType] = Field(
        default=None, description="סוג הנכס. null אם לא ניתן להסיק."
    )
    rooms: Optional[float] = Field(
        default=None, description="מספר חדרים כמספר עשרוני (3.5, 4). null אם לא צוין."
    )
    floor: Optional[int] = Field(
        default=None,
        description="קומה כמספר שלם. קומת קרקע = 0, מרתף = 1-. null אם לא צוינה.",
    )
    price_budget: Optional[float] = Field(
        default=None,
        description="המחיר המבוקש או התקציב, מנורמל לשקלים חדשים כמספר מלא "
        "(1.9 מיליון → 1900000, '5,500 לחודש' → 5500). null אם לא צוין.",
    )
    urgency_level: UrgencyLevel = Field(
        description="רמת הדחיפות לפי ניסוח הפוסט."
    )
    lead_quality_score: int = Field(
        ge=1, le=10, description="ציון איכות הליד בסולם 1 עד 10."
    )
    teaser_title: str = Field(
        description="כותרת שיווקית קצרה לאתר, ללא שמות וללא פרטי קשר."
    )
    teaser_description: str = Field(
        description="תקציר של 1–2 משפטים המציג את עיקר הצורך או הנכס, "
        "ללא שמות, טלפונים, קישורים או שם הקבוצה."
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
    analyzed: int = 0
    inserted: int = 0
    rejected: int = 0
    errors: int = 0

    def as_lines(self) -> list[str]:
        return [
            f"מקורות שנקראו: {self.sources}",
            f"פריטים בפידים: {self.entries}",
            f"כפילויות שדולגו: {self.duplicates}",
            f"נשלחו לניתוח: {self.analyzed}",
            f"לידים שנשמרו: {self.inserted}",
            f"נדחו (מתווך/ספאם/ציון נמוך): {self.rejected}",
            f"שגיאות: {self.errors}",
        ]
