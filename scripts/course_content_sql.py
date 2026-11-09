#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""תוכן קורס ההכנה למבחן המתווכים: מ-JSON למיגרציה.

    python3 scripts/course_content_sql.py                 # כותב את המיגרציה
    python3 scripts/course_content_sql.py --check         # רק מאמת את ה-JSON
    python3 scripts/course_content_sql.py --allow-answer-change=exam-2024-05-q07   # תיקון מפתח אמיתי

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
שיעור יכול לשאת `steps`: רצף של `concept` (title, text, icon), `example`
(title, text, law) ו-`check` (question = slug של שאלה **באותו שיעור**). כשיש
צעדים, כל שאלה בשיעור חייבת צעד check, אחרת היא נספרת כשגויה בסיום.

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
import subprocess
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, 'course-content')
MIGRATIONS = os.path.join(ROOT, 'supabase', 'migrations')
VERSION_FILE = os.path.join(CONTENT, '.version')

LONG_DASH = re.compile('[–—]')
ANSWERS_FILE = os.path.join(CONTENT, '.answers.json')
# הפניה למקום של חלופה בהסבר של שאלת practice. השרת מערבב את סדר החלופות
# לכל ניסיון (20271106170001), ולכן "חלופה ג" מצביעה אצל כל לומד/ת על חלופה
# אחרת. תופס: חלופה/תשובה/אפשרות/מסיח + אות, סדר (הראשונה..האחרונה), ואות
# עם גרש לבדה ("ב' שגויה").
ORDER_REF = re.compile(
    r"(?:ה?חלופ(?:ה|ות)|ה?תשוב(?:ה|ות)|ה?אפשר(?:ות|ויות)|ה?מסיח(?:ים)?)\s+(?:[אבגד]['׳]?(?![א-ת])|ה(?:ראשונה|שנייה|שלישית|רביעית|אחרונה))"
    r"|(?:^|\s)[אבגד]['׳]\s")


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


HEB_MONTHS = {'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6, 'יולי': 7,
              'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12}
# "שאלה 14, יולי 2026" / "שאלה 20 במבחן יולי 2025": ציטוט של שאלה אמיתית מהמאגר
CITATION = re.compile(r'שאלה (\d{1,2})(?:,| ב?מבחן| ממבחן| למבחן| במועד)? (?:[במ](?=' + '|'.join(HEB_MONTHS) + r'))?(' + '|'.join(HEB_MONTHS) + r') (\d{4})')


def check_citations(chapters, problems, warnings):
    """כל ציטוט של שאלה מהמאגר חייב להצביע על שאלה שקיימת ומפורסמת; שאלה
    שמסומנת needs_review מודפסת כאזהרה. כך לא מלמדים "הרשם הכריע" על שאלה
    שבוטלה במפתח הרשמי."""
    bank = {}
    for ch in chapters:
        for lesson in ch['lessons']:
            for qu in (lesson.get('questions') or []):
                if qu.get('kind') == 'exam' and qu.get('slug'):
                    bank[qu['slug']] = qu
    for ch in chapters:
        for lesson in ch['lessons']:
            texts = []
            for qu in (lesson.get('questions') or []):
                if qu.get('kind', 'practice') == 'practice':
                    texts.append(('שאלה ' + str(qu.get('slug')), qu.get('explanation') or ''))
            for st in (lesson.get('steps') or []):
                if isinstance(st, dict) and st.get('type') in ('concept', 'example'):
                    texts.append(('צעד ' + str(st.get('title')), ' '.join(str(st.get(k) or '') for k in ('title', 'text', 'law'))))
            texts.append(('גוף השיעור', lesson.get('body_html') or ''))
            texts.append(('פתיח', lesson.get('intro') or ''))
            texts.append(('נקודות המפתח', ' '.join(str(k) for k in (lesson.get('key_points') or []))))
            for where, text in texts:
                for m in CITATION.finditer(text):
                    slug = 'exam-%s-%02d-q%02d' % (m.group(3), HEB_MONTHS[m.group(2)], int(m.group(1)))
                    src = '%s / %s / %s' % (lesson.get('_file'), lesson.get('slug') or '?', where)
                    if slug not in bank:
                        problems.append(src + ': מצטט "%s" ואין שאלה כזו במאגר (%s)' % (m.group(0), slug))
                    elif bank[slug].get('published') is False:
                        problems.append(src + ': מצטט "%s" שבוטלה במפתח הרשמי (%s). שאלה שבוטלה אינה תקדים' % (m.group(0), slug))
                    elif bank[slug].get('needs_review'):
                        warnings.append(src + ': מצטט "%s" שמסומנת needs_review' % m.group(0))


def validate(chapters, answers_snapshot=None, allowed_answer_changes=(), warnings=None):
    answers_snapshot = answers_snapshot or {}
    problems = []
    check_citations(chapters, problems, warnings if warnings is not None else [])
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
            steps = lesson.get('steps') or []
            # רק שאלות שמפורסמות: course_attempt_start מחזירה רק אותן, וצעד check
            # שמצביע על שאלה שאינה חוזרת היה קלף שאי אפשר לענות עליו
            qslugs = {qu.get('slug') for qu in (lesson.get('questions') or []) if qu.get('published', True)}
            retired = {qu.get('slug') for qu in (lesson.get('questions') or []) if not qu.get('published', True)}
            checked = set()
            for i, st in enumerate(steps):
                where = '%s / %s / צעד %d' % (lesson['_file'], lesson['slug'], i + 1)
                t = st.get('type') if isinstance(st, dict) else None
                if t not in ('concept', 'example', 'check'):
                    problems.append(where + ': type חייב להיות concept / example / check')
                elif t == 'check':
                    if st.get('question') in retired:
                        problems.append(where + ': check מצביע על שאלה שאינה מפורסמת (published: false): %s' % st.get('question'))
                    elif st.get('question') not in qslugs:
                        problems.append(where + ': check מצביע על שאלה שאינה בשיעור: %s' % st.get('question'))
                    checked.add(st.get('question'))
                elif not st.get('title') or not st.get('text'):
                    problems.append(where + ': חסר title או text')
            if steps and qslugs - checked:
                # שאלה בלי צעד check לא הייתה נענית לעולם, ונספרת כשגויה בסיום
                problems.append('%s / %s: שאלות בלי צעד check: %s' % (lesson['_file'], lesson['slug'], ', '.join(sorted(qslugs - checked))))
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
                # שאלה שנכתבה לקורס (לא של הרשם): הסקירה של 6.11.2026 מצאה שב-25
                # מתוך 34 הנכונה הייתה הארוכה ביותר, ולומד/ת לומד/ת לבחור את
                # הארוכה. והשרת מערבב את החלופות של practice בכל ניסיון, ולכן
                # הסבר שמפנה לאות ("חלופה ג") היה מצביע על חלופה אחרת אצל כל לומד/ת.
                if qu.get('kind', 'practice') == 'practice':
                    if isinstance(opts, list) and len(opts) == 4 and all(isinstance(o, str) for o in opts) \
                            and isinstance(c, int) and 0 <= c <= 3:
                        longest_other = max(len(o) for i, o in enumerate(opts) if i != c)
                        ratio = len(opts[c]) / max(1, longest_other)
                        if ratio > 1.3 or ratio < 0.5:
                            problems.append(where + ': הנכונה ארוכה פי %.2f מהמסיחה הארוכה (מותר 0.5-1.3)' % ratio)
                    if ORDER_REF.search(qu.get('explanation') or ''):
                        problems.append(where + ': ההסבר מפנה למקום של חלופה (אות או סדר), והשרת מערבב את הסדר')
                # slug קיים שה-correct שלו השתנה: שאלה שנכתבה מחדש מקבלת slug חדש,
                # אחרת ניסיון פתוח (answers.c הוא אינדקס) נבדק מול חלופה אחרת
                snap = answers_snapshot.get(s)
                snap_c = snap[0] if isinstance(snap, list) else snap
                snap_opts = snap[1] if isinstance(snap, list) and isinstance(snap[1], list) else None
                if snap is not None and isinstance(c, int) and snap_c != c \
                        and s not in allowed_answer_changes:
                    problems.append(where + ': correct השתנה (%s -> %s) תחת אותו slug. שאלה שנכתבה מחדש מקבלת slug חדש; '
                                    'תיקון מפתח אמיתי: --allow-answer-change=%s' % (snap_c, c, s))
                # אותו correct, אבל החלופות הוחלפו בסדר: ניסיון פתוח והסדר המעורבב
                # (option_orders) שמורים לפי אינדקס, ולכן הנכונה הייתה עוברת לטקסט אחר.
                # כל חלופה שהייתה בתמונה ונמצאת עכשיו במקום אחר היא החלפת סדר, גם
                # כשבאותה עריכה תוקן כתיב בחלופה אחרת. תיקון כתיב במקום מותר.
                elif snap_opts is not None and isinstance(opts, list) and s not in allowed_answer_changes:
                    moved = [(j, opts.index(t)) for j, t in enumerate(snap_opts)
                             if t in opts and opts.index(t) != j and opts.count(t) == 1]
                    if moved:
                        problems.append(where + ': חלופות זזו ממקומן תחת אותו slug (%s). סדר החלופות קבוע; '
                                        'שאלה שנכתבה מחדש מקבלת slug חדש' % ', '.join('%d->%d' % m for m in moved))
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
            out.append('insert into public.course_lessons (chapter_id, slug, title, position, intro, body_html, key_points, steps, source_ref, video_url, is_free, published)')
            out.append('select c.id, %s, %s, %d, %s, %s, %s, %s, %s, %s, %s, true' % (
                q(lesson['slug']), q(lesson['title']), int(lesson.get('position', 0)),
                q(lesson.get('intro')), q(lesson.get('body_html') or ''),
                jq(lesson.get('key_points') or []), jq(lesson.get('steps') or []),
                q(lesson.get('source_ref')),
                q(lesson.get('video_url')), 'true' if lesson.get('is_free') else 'false'))
            out.append('  from public.course_chapters c where c.slug = %s' % q(ch['slug']))
            out.append('on conflict (chapter_id, slug) do update set title = excluded.title, position = excluded.position,')
            out.append('  intro = excluded.intro, body_html = excluded.body_html, key_points = excluded.key_points,')
            out.append('  steps = excluded.steps,')
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


def applied_on_main(path):
    """התוכן של המיגרציה כפי שהיא ב-origin/main, או None כשאינה שם (או שאין git)."""
    rel = os.path.relpath(path, ROOT)
    try:
        # ref מקומי ישן היה מכבה את השמירה בשקט אחרי PR של מישהו אחר
        f = subprocess.run(['git', 'fetch', '-q', 'origin', 'main'], cwd=ROOT,
                           capture_output=True, text=True, timeout=60)
        if f.returncode != 0:
            print('אזהרה: git fetch origin main נכשל, והבדיקה אם המיגרציה כבר במיין רצה מול ref מקומי')
        out = subprocess.run(['git', 'show', 'origin/main:' + rel], cwd=ROOT,
                             capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        print('אזהרה: אין git, ולכן לא נבדק אם המיגרציה כבר במיין. אם היא רצה בפרודקשן, צריך --bump')
        return None
    return out.stdout if out.returncode == 0 else None


def load_answers():
    # slug -> [correct, ארבע החלופות] כפי שנכתב במיגרציה האחרונה (פורמט ישן: רק correct).
    # נכתב בכל הרצה שמייצרת.
    if os.path.exists(ANSWERS_FILE):
        return json.load(open(ANSWERS_FILE, encoding='utf-8'))
    return {}


def main():
    allowed = set()
    for arg in sys.argv[1:]:
        if arg.startswith('--allow-answer-change='):
            allowed.update(x.strip() for x in arg.split('=', 1)[1].split(',') if x.strip())
    chapters, problems = load()
    warnings = []
    problems += validate(chapters, load_answers(), allowed, warnings)
    counts = (len(chapters), sum(len(c['lessons']) for c in chapters),
              sum(len(l.get('questions') or []) for c in chapters for l in c['lessons']))
    review = [qu['slug'] for c in chapters for l in c['lessons'] for qu in (l.get('questions') or []) if qu.get('needs_review')]
    if problems:
        print('בעיות בתוכן:')
        for p in problems:
            print('  - ' + p)
        return 1
    print('%d פרקים, %d שיעורים, %d שאלות' % counts)
    for w in warnings:
        print('אזהרה: ' + w)
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
    sql = render(chapters)
    on_main = applied_on_main(target)
    def body(x):   # בלי שורת "נוצר:", שמשתנה בכל הרצה
        return '\n'.join(l for l in x.splitlines() if not l.startswith('-- נוצר:'))
    if on_main is not None and body(on_main) != body(sql) and '--bump' not in sys.argv:
        # הקובץ כבר במיין, כלומר כנראה כבר רץ בפרודקשן. כתיבה מחדש באותו version
        # עוברת ירוק ב-CI, ו-db push מדלג עליה: התוכן החדש לא היה מגיע לאתר.
        print('המיגרציה %s כבר ב-origin/main (וכנראה כבר רצה בפרודקשן), והתוכן השתנה.\n'
              'מריצים עם --bump כדי ליצור מיגרציה חדשה.' % os.path.relpath(target, ROOT))
        return 1
    with open(target, 'w', encoding='utf-8') as f:
        f.write(sql)
    with open(ANSWERS_FILE, 'w', encoding='utf-8') as f:
        json.dump({qu['slug']: [qu['correct'], qu['options']]
                   for c in chapters for l in c['lessons'] for qu in (l.get('questions') or [])},
                  f, ensure_ascii=False, indent=0, sort_keys=True)
        f.write('\n')
    print('נכתב: ' + os.path.relpath(target, ROOT))
    return 0


if __name__ == '__main__':
    sys.exit(main())
