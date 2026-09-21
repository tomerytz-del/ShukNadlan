#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""‏version כפול, שם קובץ פסול, ו-version שאינו גדול מהאחרון שב-main.

## למה הבדיקה הזו קיימת, ולמה **על PR-ים**

בדיקת הכפילות כבר קיימת בריפו — אבל רק ב-`supabase_migrations.yml`, שרץ
ב-**push ל-main**. כלומר היא מגלה את הבעיה כשהיא **כבר תקלת פרודקשן**:
ה-HTML באוויר, הסכימה לא, והצעד שנכשל הוא השלישי ב-job — לפני שהוא נוגע
במסד, ולכן **כל** המיגרציות של אותו מיזוג דולגו, וכל push עתידי ל-main
ייכשל באותו שלב עד שהכפילות תיפתר. זה חוסם את המיגרציות של כולם.

זה קרה כאן **ארבע פעמים**, והפעמיים האחרונות היו באותה שעה:

| מתי | הקבצים | המחיר |
| --- | --- | --- |
| ‏3.9.2026 | ‎#77 ו-‎#78, שניהם `20260903120000` | ארבע מיגרציות נעצרו לימים |
| ‏14.9.2026 | `agency_page_buyer_leads` ו-`page_background` | **שש** נעצרו יחד |
| ‏21.9.2026 | `new_projects` ו-`visualizations_recent_gallery` | **עשר** נעצרו; ה-CRM הודיע "אין נכס שמתאים" לסוכן/ת עם 54 נכסים |
| ‏21.9.2026 | `hayetzira_stand_in_pin` ו-`revoke_anon_read_rpc` | סגירת ההרשאות לא רצה, ו-main נחסם |

‏CLAUDE.md מתאר את המקור: **"הכפילות נוצרת בין שני ענפים, לא בתוך אחד.
שני PR-ים מקבילים שכל אחד בחר 'היום בצהריים' כמספר יעברו בנפרד ויתנגשו
רק במיזוג השני."** ולכן זו בדיוק המשפחה שהריפו חוסם ב-CI: שקטה בכתיבה,
יקרה בפריסה.

## מה הבדיקה כן תופסת, ומה לא — וזה חשוב לדעת

היא רצה על **מיזוג הדמה** של ה-PR (זה מה ש-`actions/checkout` מוציא
באירוע `pull_request`), ולכן היא רואה את הקבצים של הענף **ושל הבסיס**
יחד. כך היא הייתה תופסת את ההתנגשות של 21.9 מול `20261224090000`, שכבר
היה ב-main כשה-PR נפתח.

**מה שהיא אינה תופסת:** PR שעבר ירוק, ואחר כך PR אחר מוזג ולוקח את אותו
מספר. ‏GitHub אינו מריץ מחדש את הבדיקות כשהבסיס זז, ולכן ההתנגשות השנייה
של 21.9 — שנוצרה 25 שניות לפני המיזוג — עוברת. מה שסוגר את הפער הזה הוא
הגדרה ולא קוד: לדרוש שהענף יהיה מעודכן מול הבסיס לפני מיזוג
(‏"Require branches to be up to date before merging"), ואז הבדיקה רצה
מחדש על הבסיס החדש.

## שלוש בדיקות

1. **שם הקובץ** `YYYYMMDDHHMMSS_שם.sql`. קובץ שאינו תואם אינו רק לא
   מסודר: בדיקת הכפילות ב-workflow הפריסה מחלצת את ה-version ב-`sed`,
   וקובץ שאינו תואם מחזיר את השם המלא — כלומר הוא **נעלם מהבדיקה**.
2. **‏version ייחודי.** זה ההרג בפועל.
3. **‏version גדול מהאחרון שבבסיס** (רק כשנמסר `--base-ref`). ‏CLAUDE.md
   דורש "ייחודי **וגדול מהאחרון**", ויש לזה טעם מעשי: `db push` מריץ לפי
   סדר, ו-version חדש שנמצא **מתחת** למה שכבר רץ הוא מיגרציה שתדולג
   בשקט — כלל 0 ב-docs/supabase-migrations.md, "ירוק אומר לא נכשל, לא
   נכנס".
"""
import glob
import os
import re
import subprocess
import sys

MIG_DIR = 'supabase/migrations'
NAME_RE = re.compile(r'^(\d{14})_[^/]+\.sql$')


def added_vs_base(base_ref: str):
    """הקבצים שה-PR הוסיף, וה-version הגבוה שבבסיס.

    מחזיר (added, base_max) או None כשאין git או שה-ref אינו נפתר — אז
    הבדיקה השלישית מדולגת במקום להיכשל על סביבה.
    """
    def git(*args):
        return subprocess.run(('git',) + args, capture_output=True,
                              text=True, timeout=60)

    if git('rev-parse', '--verify', base_ref).returncode != 0:
        return None

    r = git('diff', '--name-only', '--diff-filter=A',
            f'{base_ref}...HEAD', '--', MIG_DIR)
    if r.returncode != 0:
        return None
    added = {os.path.basename(p) for p in r.stdout.split('\n') if p.strip()}

    r = git('ls-tree', '--name-only', base_ref, f'{MIG_DIR}/')
    if r.returncode != 0:
        return None
    base_versions = []
    for p in r.stdout.split('\n'):
        m = NAME_RE.match(os.path.basename(p.strip()))
        if m:
            base_versions.append(m.group(1))
    return added, (max(base_versions) if base_versions else None)


def main() -> int:
    base_ref = None
    argv = sys.argv[1:]
    if '--base-ref' in argv:
        i = argv.index('--base-ref')
        if i + 1 < len(argv):
            base_ref = argv[i + 1]

    paths = sorted(glob.glob(f'{MIG_DIR}/*.sql'))
    if not paths:
        print(f'✗ לא נמצאו מיגרציות ב-{MIG_DIR}/ — האם הריצה מהשורש?')
        return 1

    bad = 0

    # 1. שם הקובץ
    versions = {}
    for path in paths:
        m = NAME_RE.match(os.path.basename(path))
        if not m:
            bad += 1
            print(f'✗ {path}')
            print('    שם הקובץ אינו YYYYMMDDHHMMSS_שם.sql. קובץ כזה נעלם')
            print('    מבדיקת הכפילות של workflow הפריסה, שמחלצת version ב-sed.')
            continue
        versions.setdefault(m.group(1), []).append(path)

    # 2. ‏version ייחודי
    for version, group in sorted(versions.items()):
        if len(group) > 1:
            bad += 1
            print(f'✗ ‏version כפול: {version}')
            for p in group:
                print(f'      {p}')
            print('    זה מפיל את **כל** ה-job בפריסה, לפני שהוא נוגע במסד,')
            print('    ולכן גם מיגרציות תקינות באותו מיזוג לא ירוצו.')
            print('    התיקון: לשנות שם לקובץ שמוזג מאוחר יותר (הוא עוד לא')
            print('    רץ, ולכן אין מה לתקן בהיסטוריה).')

    # 3. ‏version גדול מהאחרון שבבסיס
    if base_ref:
        info = added_vs_base(base_ref)
        if info is None:
            print(f'· הבדיקה מול הבסיס דולגה: {base_ref} אינו נפתר כאן.')
        else:
            added, base_max = info
            if base_max:
                for name in sorted(added):
                    m = NAME_RE.match(name)
                    if m and m.group(1) <= base_max:
                        bad += 1
                        print(f'✗ {MIG_DIR}/{name}')
                        print(f'    ה-version {m.group(1)} אינו גדול מהאחרון')
                        print(f'    שב-{base_ref} ({base_max}). ‏db push מריץ לפי')
                        print('    סדר, ולכן מיגרציה שנמצאת מתחת למה שכבר רץ')
                        print('    עלולה להידלג **בשקט** — ה-workflow יהיה ירוק')
                        print('    והסכימה לא תשתנה.')
            if added:
                print(f'· {len(added)} מיגרציות חדשות מול {base_ref}'
                      + (f' (הגבוה בבסיס: {base_max})' if base_max else ''))

    if bad:
        print(f'\n{bad} בעיות. ‏version כפול חוסם את הפריסה לכל המיגרציות '
              'שאחריו, לא רק לשלו.')
        return 1

    print(f'✓ {len(paths)} מיגרציות: שמות תקינים וכל ה-version-ים ייחודיים.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
