#!/usr/bin/env python3
"""כל סקריפט classic ב-CRM חולק את אותו היקף גלובלי למשתני let / const / class.

שני קבצים שמצהירים על אותו שם ברמה העליונה = הקובץ שרץ שני נופל ב-
SyntaxError "Identifier ... has already been declared", ו-crm.js כולו לא
רץ: מסך הכניסה ריק, בלי שורה אחת בלוג של השרת, והבדיקות שאינן מריצות את
שני הקבצים יחד עוברות ירוק. ככה קרה ב-11.11.2026 עם leadReportBusy
(assets/crm-lead-reports.js מול assets/crm.js).

הבדיקה מכסה את הסקריפטים שב-crm.html ואת קבוצות הטעינה העצלה
(assets/crm-lazy.js). קובץ שעטוף ב-IIFE (שורה ראשונה בקוד "(function")
אינו חולק היקף ולכן פטור.
"""
import re, sys, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent

def strip_comments(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    return re.sub(r'^\s*//.*$', '', t, flags=re.M)

def files():
    out = []
    html = (ROOT / 'crm.html').read_text(encoding='utf-8')
    out += [m for m in re.findall(r'<script[^>]*\bsrc="(assets/[^"?]+\.js)"', html)]
    lazy = ROOT / 'assets' / 'crm-lazy.js'
    if lazy.exists():
        out += re.findall(r"\['(assets/[^']+\.js)'", lazy.read_text(encoding='utf-8'))
    seen, uniq = set(), []
    for f in out:
        if f not in seen:
            seen.add(f); uniq.append(f)
    return uniq

def main():
    decl = collections.defaultdict(set)
    for f in files():
        p = ROOT / f
        if not p.exists():
            continue
        t = strip_comments(p.read_text(encoding='utf-8'))
        code = re.sub(r"^\s*(['\"])use strict\1;?\s*", '', t.lstrip())
        if re.match(r'\(\s*function\b|\(\s*\(\s*\)\s*=>|\(\s*async\b', code):
            continue
        for m in re.finditer(r'^(?:let|const|class)\s+([A-Za-z_$][\w$]*)', t, re.M):
            decl[m.group(1)].add(f)
    bad = {k: sorted(v) for k, v in decl.items() if len(v) > 1}
    if bad:
        print('✗ אותו שם let/const/class ברמה העליונה בכמה קבצים של ה-CRM (הקובץ השני לא ירוץ):')
        for k, v in sorted(bad.items()):
            print(f'  {k}: ' + ', '.join(v))
        print('להחליף שם בקובץ החדש, או לעטוף אותו ב-IIFE. הפרטים: scripts/check_crm_globals.py')
        return 1
    print(f'✓ אין הצהרות כפולות ברמה העליונה בין {len(files())} סקריפטי ה-CRM.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
