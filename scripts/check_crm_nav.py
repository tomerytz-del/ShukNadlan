#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""קטגוריה ב-CRM שאינה בניווט היא מסך שאי אפשר להגיע אליו.

**זה קרה, וזו הסיבה שהבדיקה נולדה:** מסך "ייבוא עסקאות רשמיות" נבנה, נפרס,
ועבד — והוא לא היה רשום ב-`NAV_GROUPS`. הוא ישב ב-DOM בתוך
`#platformAdminSection`, נראה מצוין למי שגלל/ה עד אליו, ולא הופיע בשום
תפריט. מנהל/ת הפלטפורמה חיפש/ה אותו ולא מצא/ה.

**למה זה שקט לגמרי:** הדף נטען, האקורדיון תקין, אין שגיאה בקונסול, ובדיקה
ידנית של מי שיודע/ת איפה הקוד תמיד "מוצאת" אותו. מה שאין הוא הדרך להגיע —
ורק מי שאינו יודע איפה זה יושב מגלה את זה.

הבדיקה משווה שתי רשימות:

  * כל `<details class="acc" id="...">` ב-`crm.html`
  * כל `{ acc:'...' }` ב-`NAV_GROUPS` שב-`assets/crm.js`

וגם את הכיוון ההפוך: רשומת ניווט שמצביעה על מזהה שאינו קיים ב-HTML היא
פריט תפריט שלחיצה עליו אינה עושה דבר.

הרצה:
    python scripts/check_crm_nav.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# קטגוריות שקיימות ב-HTML ובמכוון אינן בתפריט, עם נימוק. כמו ב-
# check_tier_gates, זו הצהרה בכתב שנקראת ב-PR ולא דרך להשתיק.
NOT_IN_NAV = {
    # אין כרגע. שם שנכנס לכאן חייב נימוק בשורה שלו.
}

# יעדי ניווט שאינם אקורדיון: ראש הדשבורד בכל אחת משתי התצוגות.
SENTINELS = {'__home', '__adminHome'}


def main():
    html = open(os.path.join(ROOT, 'crm.html'), encoding='utf-8').read()
    js = open(os.path.join(ROOT, 'assets', 'crm.js'), encoding='utf-8').read()

    accs = dict(re.findall(
        r'<details class="acc[^"]*" id="(\w+)"[^>]*>\s*<summary>\s*<span class="acc-title">([^<]*)',
        html))
    # מזהים שמוגדרים כקבוע (NAV_ADMIN_HOME) נפתרים לערך שלהם
    consts = dict(re.findall(r"const\s+(NAV_\w+)\s*=\s*'(\w+)'", js))
    nav = set(re.findall(r"\{\s*acc:\s*'(\w+)'", js))
    for m in re.findall(r"\{\s*acc:\s*(NAV_\w+)", js):
        if m in consts: nav.add(consts[m])

    problems = []
    for acc, title in sorted(accs.items()):
        if acc in nav or acc in NOT_IN_NAV: continue
        problems.append(f'{acc} ({title.strip()[:40]}) קיים ב-crm.html ואינו ב-NAV_GROUPS.')

    for acc in sorted(nav):
        if acc in SENTINELS: continue
        if acc not in accs:
            problems.append(f'{acc} רשום ב-NAV_GROUPS ואין לו אקורדיון ב-crm.html.')

    if problems:
        print(f'✗ {len(problems)} קטגוריות מנותקות מהניווט:\n')
        for p in problems: print('  · ' + p)
        print('\nהוסיפו רשומה ב-NAV_GROUPS ב-assets/crm.js, או שם ב-NOT_IN_NAV עם נימוק.')
        return 1

    print(f'✓ כל {len(accs)} הקטגוריות ב-crm.html רשומות בניווט, ואין רשומת ניווט יתומה.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
