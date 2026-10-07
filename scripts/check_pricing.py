#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מחיר שמוצג לגולשים חייב להיות המחיר שהמסד גובה.

**הכשל שהבדיקה הזו חוסמת:** מחיר אחד כתוב בשישה מקומות לפחות -
‏`pricing_config` במסד (מה שנגבה), טבלת ההשוואה והשאלות הנפוצות ב-
‏`pricing.html`, הכרטיסים ב-`assets/tiers.js`, ‏`TIER_PRICES` ב-
‏`_shared/launch-promo.ts`, ותגית ה-`description` של הדף. אף אחד מהם אינו
שובר כשאחר משתנה: מיגרציה שמעלה את המספר הווירטואלי ל-99 ₪ עוברת ירוק,
הדף ממשיך להבטיח 89, והסוכן/ת מגלה את ההפרש בארנק. זו בדיוק משפחת
הכשלים של `check_tier_gates.py` - שני צדדים בקבצים שונים - רק על מספרים.

**איך:**

1. ‏`PRICES` למטה הוא ההצהרה: המפתח ב-`pricing_config` והערך שלו. חלק
   מהמפתחות נקבעו לפני שתיקיית המיגרציות הייתה (‏`ppl_price_*`,
   ‏`free_lead_quota_monthly`), ולכן הערך כתוב כאן ולא נגזר רק מהקבצים.
2. כל מיגרציה שכותבת מפתח מהרשימה (‏insert ... values או update ... set
   value) נקראת לפי הסדר, והערך האחרון חייב להיות שווה ל-`PRICES`. מיגרציה
   שמשנה מחיר בלי לעדכן כאן - נכשלת.
3. כל מקום תצוגה ב-`DISPLAY` נבדק: כל התאמה של התבנית חייבת לשאת את הערך,
   ולפחות התאמה אחת חייבת להימצא. תבנית שלא מוצאת כלום היא כשל, לא הצלחה -
   אחרת ניסוח מחדש של שורה היה מנתק את הבדיקה בשקט.

**מה שאינו נבדק:** שהמסד בפרודקשן מחזיק את מה שבמיגרציות (זה הצינור,
‏`docs/supabase-migrations.md`), ושאלת המע״מ על חיובים מהארנק
(‏`docs/wallet-payments.md`, הסקיל `wallet-charges`).

הרצה:
    python scripts/check_pricing.py
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- ההצהרה
# המפתח ב-pricing_config -> הערך. שינוי מחיר מתחיל במיגרציה, וממשיך כאן.
PRICES = {
    'tier_mid_monthly_price':            399,
    'tier_premium_monthly_price':        599,
    'phone_line_monthly_price':          89,
    'phone_line_included_minutes':       150,
    'phone_line_overage_per_min':        0.5,
    # שיחה יוצאת נספרת דקה וחצי (20270309090000). עוד אין שיחות יוצאות, ולכן
    # אין מקום תצוגה ב-DISPLAY - מי שבונה אותן מוסיף אחד.
    'phone_line_outbound_minute_weight': 1.5,
    'promote_price':                     20,
    'promote_duration_hours':            72,
    'property_video_price_mid':          25,
    'property_video_premium_monthly_cap': 8,
    'ppl_price_buyer_renter':            25,
    'ppl_price_owner_mid':               50,
    'free_lead_quota_monthly':           10,
    # הארנק נטען לפני מע"מ (20270304090000): checkout.html מציג את הסכום לגבייה.
    'vat_rate':                          0.18,
}

# ------------------------------------------------------------- התצוגה
# (קובץ, תבנית עם קבוצת לכידה אחת למספר, המפתח). כל התאמה נבדקת.
N = r'(\d+(?:\.\d+)?)'
DISPLAY = [
    # המסלולים
    ('assets/tiers.js', r"id: 'mid',[\s\S]*?priceMonthly: " + N,      'tier_mid_monthly_price'),
    ('assets/tiers.js', r"id: 'premium',[\s\S]*?priceMonthly: " + N,  'tier_premium_monthly_price'),
    ('supabase/functions/_shared/launch-promo.ts', r'mid: ' + N,       'tier_mid_monthly_price'),
    ('supabase/functions/_shared/launch-promo.ts', r'premium: ' + N,   'tier_premium_monthly_price'),
    ('pricing.html', r'PROFESSIONAL ב-₪' + N,                          'tier_mid_monthly_price'),
    ('pricing.html', r'Elite ב-₪' + N,                                 'tier_premium_monthly_price'),
    ('pricing.html', r'לפני מע״מ: ₪' + N + ' ו-₪',                     'tier_mid_monthly_price'),
    ('pricing.html', r'ו-₪' + N + ' לחודש, וכך',                       'tier_premium_monthly_price'),
    # עמוד התשלום של המנוי (20270307090000)
    ('checkout.html', r"mid: \{ name: 'PROFESSIONAL', price: " + N,  'tier_mid_monthly_price'),
    ('checkout.html', r"premium: \{ name: 'Elite', price: " + N,     'tier_premium_monthly_price'),
    # המע״מ בעמוד התשלום
    ('checkout.html', r'const VAT_RATE = ' + N,                        'vat_rate'),
    # המספר הווירטואלי
    ('pricing.html', r'₪' + N + r' לחודש \+ מע״מ',                     'phone_line_monthly_price'),
    ('assets/tiers.js', r'₪' + N + r' לחודש \+ מע״מ',                  'phone_line_monthly_price'),
    ('pricing.html', r"'" + N + r' בחודש, ואז ₪[\d.]+ לדקה',          'phone_line_included_minutes'),
    ('pricing.html', r'כולל ' + N + r' דקות שיחה',                     'phone_line_included_minutes'),
    ('pricing.html', r'ואז ₪' + N + r' לדקה',                          'phone_line_overage_per_min'),
    ('pricing.html', r'ומעבר\s+לזה ₪' + N + r' לדקה',                  'phone_line_overage_per_min'),
    # שיווק
    ('pricing.html', r"'₪" + N + r' ל-\d+ שעות',                       'promote_price'),
    ('pricing.html', r"'₪\d+ ל-" + N + r' שעות',                       'promote_duration_hours'),
    ('pricing.html', r'₪' + N + r' להפקה',                             'property_video_price_mid'),
    ('assets/tiers.js', r'₪' + N + r' להפקה',                          'property_video_price_mid'),
    ('pricing.html', r"'" + N + r' בחודש · ללא חיוב',                  'property_video_premium_monthly_cap'),
    ('assets/tiers.js', r"'" + N + r' סרטונים שיווקיים בחודש',         'property_video_premium_monthly_cap'),
    # לידים
    ('pricing.html', r"'" + N + r" בחודש, ואז ₪\d+'",                 'free_lead_quota_monthly'),
    ('pricing.html', r"'\d+ בחודש, ואז ₪" + N + "'",                   'ppl_price_buyer_renter'),
    ('pricing.html', r"נכלל במכסה, ואז ₪" + N,                         'ppl_price_buyer_renter'),
    ('assets/tiers.js', r'₪' + N + r' לפנייה',                         'ppl_price_buyer_renter'),
    ('assets/tiers.js', r"'" + N + r' פניות בחינם בחודש',              'free_lead_quota_monthly'),
    ('pricing.html', r'₪' + N + r' לליד',                              'ppl_price_owner_mid'),
    ('assets/tiers.js', r'₪' + N + r' לליד',                           'ppl_price_owner_mid'),
]


def num(s):
    v = float(s)
    return int(v) if v.is_integer() else v


def migration_values():
    """{key: (value, file)} - הערך האחרון שמיגרציה כותבת לכל מפתח.
       ‏insert ... on conflict do nothing אינו דורס ערך שכבר נקבע."""
    out = {}
    keys = '|'.join(map(re.escape, PRICES))
    for f in sorted(glob.glob(os.path.join(ROOT, 'supabase', 'migrations', '*.sql'))):
        sql = re.sub(r'--[^\n]*', '', open(f, encoding='utf-8').read())
        for stmt in sql.split(';'):
            if 'pricing_config' not in stmt:
                continue
            name = os.path.basename(f)
            low = stmt.lower()
            m = re.search(r'update\s+public\.pricing_config\s+set\s+value\s*=\s*' + N +
                          r"[\s\S]*?where\s+key\s*=\s*'(" + keys + ")'", stmt, re.I)
            if m:
                out[m.group(2)] = (num(m.group(1)), name)
                continue
            if not re.search(r'insert\s+into\s+public\.pricing_config', stmt, re.I):
                continue
            keep = 'do nothing' in low
            for k, v in re.findall(r"\(\s*'(" + keys + r")'\s*,\s*" + N, stmt):
                if keep and k in out:
                    continue
                out[k] = (num(v), name)
    return out


def main():
    problems = []

    for k, (v, name) in migration_values().items():
        if v != PRICES[k]:
            problems.append(f'{k}: המיגרציה {name} קובעת {v}, ו-PRICES אומר {PRICES[k]}.\n'
                            f'        מחיר שהשתנה במסד משנה גם את PRICES ואת כל מקומות התצוגה.')

    for path, pat, key in DISPLAY:
        full = os.path.join(ROOT, path)
        if not os.path.exists(full):
            problems.append(f'{path} אינו קיים (התבנית של {key}).')
            continue
        text = open(full, encoding='utf-8').read()
        found = re.findall(pat, text)
        if not found:
            problems.append(f'{path}: התבנית של {key} לא מצאה דבר ({pat!r}).\n'
                            f'        אם הנוסח השתנה - עדכנו את התבנית ב-DISPLAY. בדיקה שלא\n'
                            f'        רואה את המחיר אינה בודקת אותו.')
            continue
        for v in found:
            if num(v) != PRICES[key]:
                problems.append(f'{path}: {key} מוצג {num(v)}, והמסד גובה {PRICES[key]}.')

    if problems:
        print(f'✗ {len(problems)} פערים בין המחירים שמוצגים למחירים שנגבים:\n')
        for p in problems:
            print('  · ' + p + '\n')
        print('הרקע: .claude/skills/pricing-change/SKILL.md')
        return 1

    print(f'✓ {len(PRICES)} מחירים, {len(DISPLAY)} מקומות תצוגה - כולם תואמים את pricing_config.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
