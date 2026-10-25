#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ה-CSS של דוח ה-CMA זהה ב-crm.html וב-cma.html.

הדוח מוצג בשני מקומות: ב-CRM (הסוכן/ת מדפיס/ה) ובדף /cma?k= (הקישור
שגבריאלה שולחת, גם ללקוח/ה). הקוד משותף (assets/cma-render.js), אבל ה-CSS
נשאר מוטבע בכל דף - CLAUDE.md: <link rel="stylesheet"> הוסיף חצי שנייה
לציור הראשון של ה-CRM. לכן שני עותקים, ובדיקה ששניהם זהים בין הסמנים
CMA-CSS:BEGIN ו-CMA-CSS:END. בלעדיה תיקון בדוח באחד הדפים משאיר את השני
נראה אחרת, ואף אחד לא ישים לב עד שלקוח/ה ישלח/תשלח צילום מסך.

    python3 scripts/check_cma_css.py
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEGIN = "/* CMA-CSS:BEGIN"
END = "/* CMA-CSS:END */"


def block(name):
    text = open(os.path.join(ROOT, name), encoding="utf-8").read()
    a, b = text.find(BEGIN), text.find(END)
    if a < 0 or b < a:
        return None
    return text[a:b]


def main():
    crm, page = block("crm.html"), block("cma.html")
    if crm is None or page is None:
        print("✗ לא נמצאו הסמנים CMA-CSS:BEGIN / CMA-CSS:END ב-%s."
              % ("crm.html" if crm is None else "cma.html"))
        return 1
    if crm != page:
        a, b = crm.splitlines(), page.splitlines()
        i = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
        print("✗ ה-CSS של הדוח שונה בין crm.html ל-cma.html (שורה %d בבלוק):" % (i + 1))
        print("  crm.html: %s" % (a[i] if i < len(a) else "(סוף)"))
        print("  cma.html: %s" % (b[i] if i < len(b) else "(סוף)"))
        print("להעתיק את הבלוק כמו שהוא מהקובץ ששונה לשני.")
        return 1
    print("✓ ה-CSS של דוח ה-CMA זהה ב-crm.html וב-cma.html (%d שורות)." % len(crm.splitlines()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
