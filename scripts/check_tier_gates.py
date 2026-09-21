#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""שורה מובחנת בטבלת המחירים חייבת גייט במסד.

**הכשל שהבדיקה הזו חוסמת, והוא כבר קרה:** ‏`pricing.html` הבטיח ב-✓ לשלושת
המסלולים "שיתוף נכסים עם כל המתווכים (Co-Broke)", בזמן שהמנוע לא הבחין בין
מסלולים כלל. טבלה בדף מכירה **אינה גייטינג** — היא טקסט — ושתי הטעויות
ההפוכות שקטות שתיהן:

* שורה מובחנת בלי גייט במסד = האתר **מבטיח מה שאינו אוכף**. מי שמשלם על
  המסלול הגבוה מקבל בדיוק את מה שמקבל מי שאינו משלם, ואיש לא יתלונן.
* גייט במסד בלי שורה בטבלה = יכולת שנמכרת ואיש אינו יודע עליה.

אין דרך לראות את שתיהן בקריאת קוד, כי שני הצדדים חיים בקבצים שונים ואף
אחד מהם אינו שובר כשהשני משתנה.

**מה שנבדק:**

1. כל שורה ב-`COMPARE` שערכיה אינם זהים בשלושת המסלולים חייבת להופיע
   ב-`GATES` למטה, עם שם פונקציית הגייט — או עם `None` ונימוק מפורש.
2. שם גייט שנרשם חייב להיות מוגדר באמת תחת `supabase/migrations/`.
3. כל גייט ב-`GATES` חייב להופיע בטבלת "איפה כל יכולת נאכפת" ב-
   `docs/pricing-and-tiers.md`.

**מה שאינו נבדק, ובמפורש:** שהגייט באמת בודק את המסלול הנכון. זו קריאת
קוד, ולא משהו שסקריפט יכול לקבוע. הבדיקה מוודאת שהשלישייה קיימת ומחוברת,
ולא שהיא נכונה.

הרצה:
    python scripts/check_tier_gates.py
"""
import os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- המיפוי
# שורה ב-COMPARE -> הפונקציה במסד שאוכפת אותה.
#
# ‏`None` הוא הצהרה מודעת ש"אין גייט ואין צורך בו", עם נימוק. הוא **לא**
# דרך לשתק את הבדיקה: מי שכותב None מצהיר בכתב, וזה נקרא ב-PR.
GATES = {
    'עוזר אישי בוואטסאפ - נכסים, לקוחות והתאמות בהודעה, תמונה או הקלטה':
        'TIER_ALLOWED',
    'תיאור שיווקי אוטומטי ב-AI':                  'property_description_tier_ok',
    'סרטון שיווקי אוטומטי מהתמונות':               'property_video_tier',
    'הפקת סיור וירטואלי 360° בתוך דף הנכס':        'property_virtual_tour_eligible',
    'הדמיות AI לנכס פרטי - 4 סגנונות עיצוב':       'property_visualizations_enabled',
    'הדמיות AI לנכסים מסחריים':                    'property_visualizations_enabled',
    'מפת מיקום מדויקת בדף הנכס':                   'property_map_enabled',
    # ‏`claim_lead` חיה בפרודקשן ואין לה קובץ מיגרציה בריפו: היא נוצרה
    # ב"מיגרציה 013", מסדרת מספור שקדמה לתיקייה הזו. זה ממצא בפני עצמו
    # ונרשם כאן ולא מוסתר — ראו LEGACY_GATES.
    'דוח CMA - ניתוח שוק והשוואת מחירים':          'agent_cma_report',
    'מידע תכנוני - גוש, חלקה וייעוד קרקע':         'agent_property_planning',
    'חיפוש עסקאות שנסגרו לפי כתובת':               'agent_market_deals_lookup',
    'לידי קונה/שוכר':                              'claim_lead',
    'לידי בעל-נכס (מוכר/משכיר)':                   'claim_lead',
    'הפניה אוטומטית של לידי בעל-נכס אליך':         'lead_audience_size',
}

# גייטים שאינם פונקציה במסד אלא בדיקה ב-Edge Function. הם עדיין חייבים
# להופיע בטבלת התיעוד, ולכן הם כאן ולא מחוץ לבדיקה.
EDGE_GATES = {
    'TIER_ALLOWED': 'supabase/functions/whatsapp-webhook/index.ts',
}

# פונקציות שקיימות בפרודקשן ואין להן קובץ תחת supabase/migrations/, מפני
# שהן נוצרו לפני שהתיקייה הזו הייתה. הבדיקה מקבלת אותן ולא מחפשת קובץ.
#
# **זו רשימה שאמורה להתכווץ ולא לגדול.** שם חדש כאן פירושו DDL שהוחל מחוץ
# לצינור, וזה הכלל שאסור להפר (CLAUDE.md).
LEGACY_GATES = {'claim_lead'}


# ------------------------------------------------------------- COMPARE
def _scan(text, on_open, on_close):
    """סורק תו-תו ומכבד מחרוזות JS. ‏regex על מערך עם גרשים בעברית
       (`סוכן/ת`, `ז'בוטינסקי`) מסווג הפוך, וזה בדיוק סוג הכשל שהריפו
       כבר שילם עליו ב-check_long_dash."""
    depth, q, esc = 0, None, False
    for i, c in enumerate(text):
        if q:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == q: q = None
            continue
        if c in '"\'`': q = c; continue
        if c == '[':
            depth += 1; on_open(depth, i)
        elif c == ']':
            on_close(depth, i); depth -= 1
            if depth == 0: return i
    return -1


def compare_block(src):
    i = src.index('const COMPARE = [')
    i = src.index('[', i)
    end = _scan(src[i:], lambda d, j: None, lambda d, j: None)
    if end < 0: sys.exit('✗ מערך COMPARE אינו נסגר ב-pricing.html')
    return src[i:i + end + 1]


def compare_rows(block):
    """[(label, [free, mid, premium])] — שורה היא מערך שנפתח בעומק 4."""
    spans, start = [], {}
    def op(d, i):
        if d == 4: start['i'] = i
    def cl(d, i):
        if d == 4 and 'i' in start: spans.append(block[start.pop('i'):i + 1])
    _scan(block, op, cl)

    rows = []
    for raw in spans:
        parts, d, q, esc, buf = [], 0, None, False, ''
        for c in raw[1:-1]:
            if q:
                buf += c
                if esc: esc = False
                elif c == '\\': esc = True
                elif c == q: q = None
                continue
            if c in '"\'`': q = c; buf += c; continue
            if c in '[{(': d += 1
            if c in ']})': d -= 1
            if c == ',' and d == 0: parts.append(buf.strip()); buf = ''
            else: buf += c
        if buf.strip(): parts.append(buf.strip())
        if len(parts) < 4: continue
        unq = lambda p: p[1:-1] if p[:1] in '"\'' else p
        rows.append((unq(parts[0]), [unq(p) for p in parts[1:4]]))
    return rows


# --------------------------------------------------------------- driver
def main():
    src = open(os.path.join(ROOT, 'pricing.html'), encoding='utf-8').read()
    rows = compare_rows(compare_block(src))
    if not rows:
        print('✗ לא זוהתה אף שורה ב-COMPARE. בדיקה שאינה רואה כלום אינה בדיקה.')
        return 1

    sql = ''
    for f in sorted(glob.glob(os.path.join(ROOT, 'supabase', 'migrations', '*.sql'))):
        sql += open(f, encoding='utf-8').read()
    docs = open(os.path.join(ROOT, 'docs', 'pricing-and-tiers.md'), encoding='utf-8').read()

    problems = []

    # 1. שורה מובחנת בלי רישום
    for label, vals in rows:
        if len(set(vals)) == 1: continue
        if label not in GATES:
            problems.append(
                f'שורה מובחנת ב-COMPARE בלי גייט רשום: {label!r}\n'
                f'        ערכים: {vals}\n'
                f'        הוסיפו אותה ל-GATES ב-scripts/check_tier_gates.py, עם שם\n'
                f'        פונקציית הגייט או None ונימוק.')

    # 2. גייט שנרשם וקיים באמת
    for label, gate in GATES.items():
        if gate is None: continue
        if gate in LEGACY_GATES: continue
        if gate in EDGE_GATES:
            path = os.path.join(ROOT, EDGE_GATES[gate])
            if not os.path.exists(path):
                problems.append(f'הגייט {gate!r} ({label!r}) מצביע על קובץ שאינו קיים: {EDGE_GATES[gate]}')
            elif gate not in open(path, encoding='utf-8').read():
                problems.append(f'הגייט {gate!r} ({label!r}) אינו מופיע ב-{EDGE_GATES[gate]}')
            continue
        if not re.search(r'function\s+public\.' + re.escape(gate) + r'\s*\(', sql):
            problems.append(
                f'הגייט {gate!r} ({label!r}) אינו מוגדר תחת supabase/migrations/.')

    # 3. הגייט מתועד
    for label, gate in GATES.items():
        if gate is None: continue
        if gate not in docs:
            problems.append(
                f'הגייט {gate!r} ({label!r}) אינו מופיע בטבלת האכיפה ב-\n'
                f'        docs/pricing-and-tiers.md.')

    if problems:
        print(f'✗ {len(problems)} בעיות בגייטינג של המסלולים:\n')
        for p in problems: print('  · ' + p + '\n')
        print('הרקע המלא: .claude/skills/new-tier-capability/SKILL.md')
        return 1

    diff = sum(1 for _, v in rows if len(set(v)) > 1)
    print(f'✓ {diff} שורות מובחנות ב-COMPARE, לכולן גייט רשום, קיים ומתועד '
          f'(מתוך {len(rows)} שורות).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
