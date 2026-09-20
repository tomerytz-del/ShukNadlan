#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מקף ארוך (— ו-–) אסור בטקסט שמוצג לגולשים.

**למה בדיקה ולא כלל בראש:** מקף ארוך אינו שובר כלום. הדף נטען, נראה תקין,
והוא פשוט נכתב בסימן שאינו שלנו — כלומר הטעות שקטה, בדיוק כמו תגית GTM
חסרה. לכן היא נתפסת ב-CI ולא בקריאה חוזרת.

**מה נבדק ומה לא.** הכלל חל על מה שגולש/ת קורא/ת: טקסט ב-HTML, מאפיינים
שמוצגים (‎alt‎, ‎title‎, ‎placeholder‎, ‎aria-label‎, ‎data-info‎, ‎content‎ של
תגיות ‎meta‎), ומחרוזות ב-JS. הוא **אינו** חל על הערות קוד — שם המקף הארוך
נשאר, כי ההערות הן התיעוד של הריפו ולא תוכן האתר.

ההפרדה נעשית במכונת מצבים ולא ב-regex: קובץ HTML כאן מכיל ‎<style>‎ ו-
‎<script>‎ עם הערות משלהם, ו-regex שמנסה להסיר אותם או מפספס או בולע טקסט
אמיתי. שתי הטעויות שקטות גם הן.

הרצה:
    python scripts/check_long_dash.py          # בדיקה
    python scripts/check_long_dash.py --fix    # החלפה למקף רגיל
"""
import sys, os, glob

DASHES = '—–―'          # em, en, horizontal bar
VISIBLE_ATTRS = ('alt', 'title', 'placeholder', 'aria-label', 'data-info', 'content')

# ---------------------------------------------------------------- scanner
# מחזיר רשימת (index, char, kind) לכל מקף ארוך בקובץ, כש-kind הוא 'text'
# (מוצג) או 'comment' (לא מוצג). הסריקה היא תו-תו כי זה מה שמבדיל נכון בין
# ‎/*‎ שבתוך מחרוזת לבין ‎/*‎ שפותח הערה.
def scan(src, is_html):
    out = []
    i, n = 0, len(src)
    # מצבי-על: html | script | style ; ובתוכם code | str | comment
    mode = 'html' if is_html else 'script'
    quote = None
    prev = None          # התו המשמעותי האחרון בקוד, למבחן regex/חילוק
    while i < n:
        c = src[i]

        if mode == 'html':
            if src.startswith('<!--', i):
                j = src.find('-->', i)
                j = n if j < 0 else j + 3
                for k in range(i, j):
                    if src[k] in DASHES: out.append((k, src[k], 'comment'))
                i = j; continue
            if src.startswith('<script', i) and _tag_opens(src, i):
                j = src.find('>', i)
                if j < 0: break
                _mark_tag(src, i, j, out)
                mode, i = 'script', j + 1; continue
            if src.startswith('<style', i) and _tag_opens(src, i):
                j = src.find('>', i)
                if j < 0: break
                _mark_tag(src, i, j, out)
                mode, i = 'style', j + 1; continue
            if c == '<':                      # any other tag: attributes only
                j = src.find('>', i)
                if j < 0: break
                _mark_tag(src, i, j, out)
                i = j + 1; continue
            if c in DASHES: out.append((i, c, 'text'))
            i += 1; continue

        close = '</script>' if mode == 'script' else '</style>'
        if is_html and src.startswith(close, i):
            mode, i = 'html', i + len(close); continue

        if quote is not None:
            if c == '\\': i += 2; continue
            if c in DASHES: out.append((i, c, 'text'))      # string literal
            if c == quote: quote = None
            i += 1; continue

        if src.startswith('//', i) and mode == 'script':
            j = src.find('\n', i); j = n if j < 0 else j
            for k in range(i, j):
                if src[k] in DASHES: out.append((k, src[k], 'comment'))
            i = j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2
            for k in range(i, j):
                if src[k] in DASHES: out.append((k, src[k], 'comment'))
            i = j; continue
        if c == '/' and mode == 'script' and _regex_here(src, i, prev):
            # ‏**ליטרל regex, ולכן חייבים לדלג עליו שלם.** בלי זה, regex
            # שמכיל גרש או מרכאות — למשל ‎/["'״׳]/g‎ ב-
            # ‎assets/property-card.js‎ — פותח "מחרוזת" מדומה, וכל הקובץ
            # שאחריו מסווג הפוך. כך דווקא ה-regex-ים ששומרים על הטקסט
            # יצאו כ"טקסט" והוחלפו. זה קרה, ונתפס בבדיקת ה-diff.
            j = i + 1; cls = False
            while j < n:
                d = src[j]
                if d == '\\': j += 2; continue
                if d == '[': cls = True
                elif d == ']': cls = False
                elif d == '/' and not cls: break
                elif d == '\n': break          # לא regex אחרי הכול
                j += 1
            for k in range(i, min(j + 1, n)):
                if src[k] in DASHES: out.append((k, src[k], 'code'))
            prev = '/'; i = min(j + 1, n); continue
        if c in '"\'`' and mode == 'script':
            quote = c; i += 1; continue
        if c not in ' \t\n\r': prev = c
        if c in DASHES:
            # ‏**קוד, ולא טקסט — וזה הסעיף החשוב בקובץ הזה.** מקף ארוך אינו
            # תו חוקי בשום מקום ב-JS או ב-CSS מחוץ למחרוזת או להערה, ולכן
            # אם הגענו לכאן הוא כמעט תמיד יושב בתוך **regex**. והחלפה שם
            # אינה שינוי טקסט אלא שינוי התנהגות:
            #
            #     /^[\s,·—–-]+$/  →  /^[\s,·---]+$/
            #
            # מחלקת התווים שנועדה לנקות מקפים ארוכים הפסיקה להכיר אותם,
            # ובנוסף ‎-‎ האמצעי הפך לאופרטור טווח. שתי התקלות שקטות: הקוד
            # עדיין מתקמפל, ה-regex עדיין תקין, והוא פשוט מפסיק להתאים.
            #
            # זה קרה בפועל בניקוי הראשון, בתשעה regex-ים, ונתפס בבדיקה
            # חוזרת של ה-diff. לכן קוד מסומן כ-'code' ולעולם אינו מוחלף.
            out.append((i, c, 'code'))
        i += 1
    return out


# ‏`/` הוא או חילוק או תחילת regex, וההכרעה היא לפי מה שקדם לו. אחרי ערך
# (משתנה, מספר, סוגר) זה חילוק; אחרי אופרטור, פסיק, סוגר פותח או מילת
# מפתח — זה regex. זו ההיוריסטיקה המקובלת, והיא מספיקה לקוד אמיתי.
_RE_BEFORE = set('(,=:[!&|?{};+-*%~^<>')

def _regex_here(src, i, prev):
    if src.startswith('//', i) or src.startswith('/*', i):
        return False
    if prev is None or prev in _RE_BEFORE:
        return True
    # ‏return/typeof וחברותיהן: מילה שלמה שאחריה regex ולא חילוק
    j = i - 1
    while j >= 0 and src[j] in ' \t\n\r': j -= 1
    k = j
    while k >= 0 and (src[k].isalpha() or src[k] == '_'): k -= 1
    return src[k+1:j+1] in ('return','typeof','instanceof','in','of','new',
                            'delete','void','case','do','else','yield','await')


def _tag_opens(src, i):
    j = i + 7 if src.startswith('<script', i) else i + 6
    return j < len(src) and (src[j] in ' \t\n>')


def _mark_tag(src, start, end, out):
    """בתוך תגית: רק ערכי מאפיינים שמוצגים נחשבים טקסט."""
    seg = src[start:end]
    low = seg.lower()
    for k, ch in enumerate(seg):
        if ch not in DASHES: continue
        kind = 'comment'
        for a in VISIBLE_ATTRS:
            p = low.rfind(a + '=', 0, k)
            if p < 0: continue
            q = seg[p + len(a) + 1: k]
            if q and q[0] in '"\'' and q[0] not in q[1:]:
                kind = 'text'; break
        out.append((start + k, ch, kind))


# ---------------------------------------------------------------- driver
def files():
    pats = ['*.html', 'assets/*.js', 'netlify/edge-functions/*.ts',
            'supabase/functions/*/*.ts']
    seen = []
    for p in pats: seen += sorted(glob.glob(p))
    return seen


def main():
    fix = '--fix' in sys.argv
    bad, fixed = [], 0
    for f in files():
        src = open(f, encoding='utf-8').read()
        hits = [h for h in scan(src, f.endswith('.html')) if h[2] == 'text']
        if not hits: continue
        if fix:
            chars = list(src)
            for idx, ch, _ in hits: chars[idx] = '-'
            open(f, 'w', encoding='utf-8').write(''.join(chars))
            fixed += len(hits)
        else:
            bad.append((f, len(hits), hits[:3], src))

    if fix:
        print(f"✓ הוחלפו {fixed} מקפים ארוכים במקף רגיל.")
        return 0
    if not bad:
        print("✓ אין מקף ארוך בטקסט שמוצג לגולשים.")
        return 0
    total = sum(n for _, n, _, _ in bad)
    print(f"✗ {total} מקפים ארוכים בטקסט שמוצג, ב-{len(bad)} קבצים:\n")
    for f, n, sample, src in bad[:12]:
        print(f"  {n:4d}  {f}")
        for idx, ch, _ in sample:
            line = src.count('\n', 0, idx) + 1
            ctx = src[max(0, idx - 34):idx + 34].replace('\n', ' ')
            print(f"        שורה {line}: …{ctx.strip()}…")
    if len(bad) > 12: print(f"  ועוד {len(bad)-12} קבצים")
    print("\nלתיקון:  python scripts/check_long_dash.py --fix")
    return 1


if __name__ == '__main__':
    sys.exit(main())
