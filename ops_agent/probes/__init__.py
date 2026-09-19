"""רשימת הבדיקות שהסוכן מריץ.

כל probe היא פונקציה אחת שמקבלת הקשר ומחזירה ממצאים. היא **אינה** מחליטה
מה לעשות איתם, אינה כותבת למסד ואינה מדפיסה — זה תפקידו של `run.py`.
הפרדה זו היא מה שמאפשר להריץ probe בודדת מקומית (`--only security`) בלי
לגעת בכלום.

הסדר כאן הוא סדר ההרצה: בדיקות המסד קודמות כי הן הזולות והמהירות, ובדיקות
הרשת החיות אחרונות כי הן היחידות שתלויות בצד שלישי.
"""

from __future__ import annotations

from . import behavior, database, frontend, pipeline, security

# (שם, פונקציה, האם דורשת מסד)
PROBES = (
    ("database", database.run, True),
    ("security", security.run, True),
    ("behavior", behavior.run, True),
    ("pipeline", pipeline.run, True),
    ("frontend", frontend.run, False),
)

PROBE_NAMES = tuple(name for name, _, _ in PROBES)
