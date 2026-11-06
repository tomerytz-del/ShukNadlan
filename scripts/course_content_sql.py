#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""תוכן קורס ההכנה למבחן המתווכים: מ-JSON למיגרציה.

    python3 scripts/course_content_sql.py                 # כותב את המיגרציה
    python3 scripts/course_content_sql.py --check         # רק מאמת את ה-JSON

## למה JSON ולא SQL ביד

שאלה ממבחן היא ארבע חלופות, תשובה, הסבר והפניה, בעברית מלאה בגרשיים. SQL
ידני לכל אחת מ-200+ שאלות הוא בדיוק המקום שבו גרש לא מוכפל מפיל את כל
צינור המיגרציות (הסקיל `new-migration`, כלל 5). כאן הגרשיים מוכפלים
בקוד, ומקף ארוך הופך למקף רגיל בכל טקסט שמוצג ללומד/ת (CLAUDE.md).

## המבנה

כל קובץ ב-`course-content/*.json` ו-`course-content/exams/*.json`:

    {"chapter": {"slug": "...", "title": "...", "summary": "...", "position": N},
     "lessons": [{"slug", "title", "position", "intro", "body_html", "key_points",
                  "source_ref", "is_free", "video_url", "questions": [...]}]}

`chapter` עם `slug` בלבד מצרף שיעורים לפרק שהוגדר בקובץ אחר (מבחני העבר).
שאלה: `slug` (ייחודי גלובלית), `question`, `options` (4), `correct` (0-3),
`explanation`, `law_ref`, `kind` (practice/exam), `source`, `needs_review`.

## מה המיגרציה עושה

`upsert` לפי slug, ולכן הרצה חוזרת מעדכנת ולא מכפילה (אידמפוטנטית), ושיעור
או שאלה שנמחקו מה-JSON מסומנים `published = false` ולא נמחקים - ההתקדמות
והניסיונות של הלומדים מצביעים עליהם.

המיגרציה נכתבת לקובץ אחד קבוע, `supabase/migrations/<VERSION>_course_content.sql`,
ש-VERSION שלו נקבע בפעם הראשונה ונשמר ב-`course-content/.version`. כל עוד
המיגרציה לא רצה בפרודקשן (אותו PR), הרצה חוזרת פשוט מעדכנת את אותו קובץ.
**אחרי שהיא רצה**, הצינור לא יריץ אותה שוב, ולכן עדכון תוכן מריצים עם
`--bump`: הקובץ הישן הופך לקובץ ריק (ה-version שלו רשום בפרודקשן, ומחיקה
הייתה שוברת את `db push`) ונוצר קובץ חדש עם version חדש. הפרטים:
docs/exam-course.md.
"""
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, 'course-content')
MIGRATIONS = os.path.join(ROOT, 'supabase', 'migrations')
VERSION_FILE = os.path.join(CONTENT, '.version')

LONG_DASH = re.compile('[–—]')


def q(s):
    """מחרוזת SQL: גרש מוכפל, מקף ארוך למקף רגיל, None ל-null."""
    if s is None:
        return 'null'
    s = LONG_DASH.sub('-', str(s))
    return "'" + s.replace("'", "''") + "'"


def jq(obj):
    return q(json.dumps(obj, ensure_ascii=False)) + '::jsonb'


def load():
    files = sorted(glob.glob(os.path.join(CONTENT, '*.json'))) + \
        sorted(glob.glob(os.path.join(CONTENT, 'exams', '*.json')))
    chapters = {}
    order = []
    problems = []
    for path in files:
        with open(path, encoding='utf-8') as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                problems.append('%s: JSON שבור: %s' % (os.path.relpath(path, ROOT), e))
                continue
        ch = data.get('chapter') or {}
        slug = ch.get('slug')
        if not slug:
            problems.append('%s: אין chapter.slug' % os.path.relpath(path, ROOT))
            continue
        if slug not in chapters:
            chapters[slug] = {'slug': slug, 'lessons': []}
            order.append(slug)
        if ch.get('title'):
            chapters[slug].update({k: ch[k] for k in ('title', 'summary', 'position') if k in ch})
        for lesson in data.get('lessons') or []:
            lesson['_file'] = os.path.relpath(path, ROOT)
            chapters[slug]['lessons'].append(lesson)
    return [chapters[s] for s in order], problems


def validate(chapters):
    problems = []
    seen_q = set()
    seen_l = set()
    for ch in chapters:
        if 'title' not in ch:
            problems.append('פרק %s: אין קובץ שמגדיר title' % ch['slug'])
        for lesson in ch['lessons']:
            key = (ch['slug'], lesson.get('slug'))
            if not lesson.get('slug') or not lesson.get('title'):
                problems.append('%s: שיעור בלי slug או title' % lesson['_file'])
                continue
            if key in seen_l:
                problems.append('%s: שיעור כפול %s' % (lesson['_file'], lesson['slug']))
            seen_l.add(key)
            for i, qu in enumerate(lesson.get('questions') or []):
                where = '%s / %s / שאלה %d' % (lesson['_file'], lesson['slug'], i + 1)
                s = qu.get('slug')
                if not s:
                    problems.append(where + ': אין slug')
                elif s in seen_q:
                    problems.append(where + ': slug כפול ' + s)
                seen_q.add(s)
                opts = qu.get('options')
                if not isinstance(opts, list) or len(opts) != 4 or not all(isinstance(o, str) and o.strip() for o in opts):
                    problems.append(where + ': options חייב להיות 4 מחרוזות')
                c = qu.get('correct')
                if not isinstance(c, int) or c < 0 or c > 3:
                    problems.append(where + ': correct חייב להיות 0-3')
                acc = qu.get('accepted')
                if acc is not None and (not isinstance(acc, list) or not all(isinstance(a, int) and 0 <= a <= 3 for a in acc)):
                    problems.append(where + ': accepted חייב להיות רשימת אינדקסים 0-3')
                if not qu.get('question') or not qu.get('explanation'):
                    problems.append(where + ': חסר question או explanation')
                if qu.get('kind', 'practice') not in ('practice', 'exam'):
                    problems.append(where + ': kind לא מוכר')
    return problems


def render(chapters):
    out = []
    out.append('-- ============================================================================')
    out.append('-- תוכן קורס ההכנה למבחן המתווכים - נוצר אוטומטית')
    out.append('--')
    out.append('-- **אין לערוך ביד.** המקור הוא course-content/*.json, והקובץ הזה נוצר ב-')
    out.append('-- scripts/course_content_sql.py. upsert לפי slug, ולכן ניתן להרצה חוזרת.')
    out.append('-- מה שנעלם מה-JSON מסומן published = false ולא נמחק (ההתקדמות מצביעה עליו).')
    out.append('-- נוצר: %s. הפרטים: docs/exam-course.md' % datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'))
    out.append('-- ============================================================================')
    out.append('')
    chapter_slugs, lesson_keys, question_slugs = [], [], []
    for ch in chapters:
        chapter_slugs.append(ch['slug'])
        out.append('-- ---- פרק: %s' % ch['slug'])
        out.append('insert into public.course_chapters (slug, title, summary, position, published)')
        out.append('values (%s, %s, %s, %d, true)' % (q(ch['slug']), q(ch['title']), q(ch.get('summary')), int(ch.get('position', 0))))
        out.append('on conflict (slug) do update set title = excluded.title, summary = excluded.summary,')
        out.append('  position = excluded.position, published = true;')
        out.append('')
        for lesson in ch['lessons']:
            lesson_keys.append((ch['slug'], lesson['slug']))
            out.append('insert into public.course_lessons (chapter_id, slug, title, position, intro, body_html, key_points, source_ref, video_url, is_free, published)')
            out.append('select c.id, %s, %s, %d, %s, %s, %s, %s, %s, %s, true' % (
                q(lesson['slug']), q(lesson['title']), int(lesson.get('position', 0)),
                q(lesson.get('intro')), q(lesson.get('body_html') or ''),
                jq(lesson.get('key_points') or []), q(lesson.get('source_ref')),
                q(lesson.get('video_url')), 'true' if lesson.get('is_free') else 'false'))
            out.append('  from public.course_chapters c where c.slug = %s' % q(ch['slug']))
            out.append('on conflict (chapter_id, slug) do update set title = excluded.title, position = excluded.position,')
            out.append('  intro = excluded.intro, body_html = excluded.body_html, key_points = excluded.key_points,')
            out.append('  source_ref = excluded.source_ref, video_url = coalesce(excluded.video_url, public.course_lessons.video_url),')
            out.append('  is_free = excluded.is_free, published = true, updated_at = now();')
            out.append('')
            for i, qu in enumerate(lesson.get('questions') or []):
                question_slugs.append(qu['slug'])
                # ‏"published": false בשאלה - נשארת במאגר לתיעוד אבל לא נשאלת
                # (למשל שאלה שהרשם קיבל בה כל תשובה בגלל טעות דפוס).
                pub = 'false' if qu.get('published') is False else 'true'
                # ‏"accepted": [1, 3] - מועד שבו הרשם קיבל יותר מתשובה אחת
                acc = qu.get('accepted')
                acc_sql = ('array[%s]::smallint[]' % ','.join(str(int(a)) for a in acc)) if acc else 'null'
                out.append('insert into public.course_questions (slug, chapter_id, lesson_id, kind, source, question, options, correct, accepted, explanation, law_ref, position, published)')
                out.append('select %s, l.chapter_id, l.id, %s, %s, %s, %s, %d, %s, %s, %s, %d, %s' % (
                    q(qu['slug']), q(qu.get('kind', 'practice')), q(qu.get('source')),
                    q(qu['question']), jq(qu['options']), int(qu['correct']), acc_sql,
                    q(qu['explanation']), q(qu.get('law_ref')), i + 1, pub))
                out.append('  from public.course_lessons l join public.course_chapters c on c.id = l.chapter_id')
                out.append('  where c.slug = %s and l.slug = %s' % (q(ch['slug']), q(lesson['slug'])))
                out.append('on conflict (slug) do update set chapter_id = excluded.chapter_id, lesson_id = excluded.lesson_id,')
                out.append('  kind = excluded.kind, source = excluded.source, question = excluded.question, options = excluded.options,')
                out.append('  correct = excluded.correct, accepted = excluded.accepted, explanation = excluded.explanation, law_ref = excluded.law_ref,')
                out.append('  position = excluded.position, published = excluded.published;')
                out.append('')
    out.append('-- ---- מה שאינו ב-JSON יותר יורד מהאוויר, ולא נמחק')
    out.append('update public.course_questions set published = false where slug not in (%s);' %
               ', '.join(q(s) for s in question_slugs))
    out.append('update public.course_lessons l set published = false')
    out.append('  from public.course_chapters c where c.id = l.chapter_id and (c.slug, l.slug) not in (%s);' %
               ', '.join('(%s, %s)' % (q(a), q(b)) for a, b in lesson_keys))
    out.append('update public.course_chapters set published = false where slug not in (%s);' %
               ', '.join(q(s) for s in chapter_slugs))
    out.append('')
    return '\n'.join(out)


def current_version():
    if os.path.exists(VERSION_FILE):
        return open(VERSION_FILE, encoding='utf-8').read().strip()
    return None


def new_version():
    # גדול מכל מיגרציה קיימת, בצורת YYYYMMDDHHMMSS
    existing = sorted(os.path.basename(p)[:14] for p in glob.glob(os.path.join(MIGRATIONS, '*.sql')))
    last = existing[-1] if existing else '20000101000000'
    now = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    v = max(now, str(int(last) + 1))
    return v


def main():
    chapters, problems = load()
    problems += validate(chapters)
    counts = (len(chapters), sum(len(c['lessons']) for c in chapters),
              sum(len(l.get('questions') or []) for c in chapters for l in c['lessons']))
    review = [qu['slug'] for c in chapters for l in c['lessons'] for qu in (l.get('questions') or []) if qu.get('needs_review')]
    if problems:
        print('בעיות בתוכן:')
        for p in problems:
            print('  - ' + p)
        return 1
    print('%d פרקים, %d שיעורים, %d שאלות' % counts)
    if review:
        print('שאלות שמסומנות needs_review (%d): %s' % (len(review), ', '.join(review)))
    if '--check' in sys.argv:
        return 0

    version = current_version()
    if '--bump' in sys.argv or not version:
        if version:
            # הקובץ הישן כבר רשום ב-schema_migrations בפרודקשן. מחיקה שלו
            # הייתה שוברת את db push ("Remote migration versions not found"),
            # ולכן הוא נשאר - כקובץ ריק שמצביע על החדש.
            old = os.path.join(MIGRATIONS, version + '_course_content.sql')
            nv = new_version()
            with open(old, 'w', encoding='utf-8') as f:
                f.write('-- תוכן הקורס: הוחלף ב-%s_course_content.sql (scripts/course_content_sql.py --bump).\n'
                        '-- הקובץ נשאר כי ה-version שלו כבר רשום בפרודקשן. אין כאן DDL.\n'
                        'select 1;\n' % nv)
            version = nv
        else:
            version = new_version()
        with open(VERSION_FILE, 'w', encoding='utf-8') as f:
            f.write(version + '\n')
    target = os.path.join(MIGRATIONS, version + '_course_content.sql')
    with open(target, 'w', encoding='utf-8') as f:
        f.write(render(chapters))
    print('נכתב: ' + os.path.relpath(target, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
