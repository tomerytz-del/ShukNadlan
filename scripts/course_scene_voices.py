#!/usr/bin/env python3
"""
הקולות והקבצים של סצנות "עצרו את התמונה" בקורס ההכנה.

משותף ל-scripts/course_content_sql.py (שמוסיף לכל שורה את שם קובץ הקול שלה
ובודק שהוא קיים) ול-scripts/course_scene_audio.py (שמפיק את הקבצים החסרים).
אם שניהם לא מחשבים את אותו שם, הנגן מבקש קובץ שאינו קיים והסצנה שותקת.

הקולות הם אותם קולות של הרילסים (marketing/reel_worker/tools/reel.py, VOICES):
הילה ואבי של Azure. יש רק שני קולות עבריים, ולכן הדמויות נבדלות בגובה ובקצב.
"""
import hashlib

# דובר -> (קול, קצב, גובה). דמות חדשה מקבלת שורה כאן וב-LOOK שב-assets/course-scene.js.
PROFILES = {
    'noa':    ('he-IL-HilaNeural', '+10%', '+0%'),
    'dana':   ('he-IL-HilaNeural', '+12%', '+9%'),
    'ido':    ('he-IL-AvriNeural', '+14%', '+5%'),
    'moshe':  ('he-IL-AvriNeural', '+0%',  '-9%'),
    'mentor': ('he-IL-AvriNeural', '+4%',  '-5%'),
    'judge':  ('he-IL-AvriNeural', '-6%',  '-14%'),
}
CHARACTERS = ('noa', 'dana', 'ido', 'moshe')
AUDIO_DIR = 'assets/course-scenes'


def audio_name(voice_key, text):
    """שם הקובץ נגזר מהקול ומהטקסט: שינוי במשפט = קובץ חדש, והישן לא נדרס."""
    v, rate, pitch = PROFILES[voice_key]
    return hashlib.sha1(('%s|%s|%s|%s' % (v, rate, pitch, text)).encode('utf-8')).hexdigest()[:16]


def spoken(beats, freeze=None):
    """כל משפט מדובר ברצף צעדים: (האובייקט שנושא אותו, הדובר, הטקסט)."""
    out = []
    for b in beats or []:
        if not isinstance(b, dict):
            continue
        if b.get('say') and b.get('text'):
            out.append((b, b['say'], b['text']))
        if b.get('vo'):
            out.append((b, b.get('voice') or 'mentor', b['vo']))
        cut = b.get('cut')
        if isinstance(cut, dict) and cut.get('vo'):
            out.append((cut, 'mentor', cut['vo']))
        court = b.get('court')
        if isinstance(court, dict) and court.get('vo'):
            out.append((court, 'judge', court['vo']))
    return out


def scene_lines(lesson):
    """כל המשפטים של שיעור: הפתיחות שבצעדים והסופים שעל השאלות."""
    out = []
    for st in lesson.get('steps') or []:
        if isinstance(st, dict) and st.get('type') == 'scene':
            out += spoken(st.get('beats'))
            if st.get('freeze'):
                out.append((st, 'mentor', st['freeze']))
    for qu in lesson.get('questions') or []:
        sc = qu.get('scene')
        if isinstance(sc, dict):
            out += spoken(sc.get('right')) + spoken(sc.get('wrong'))
    return out
