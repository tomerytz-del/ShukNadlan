#!/usr/bin/env python3
"""
מפיק את קובצי הקריינות של סצנות "עצרו את התמונה" בקורס ההכנה.

    python3 scripts/course_scene_audio.py          # מפיק רק את מה שחסר
    python3 scripts/course_scene_audio.py --list   # מה חסר, בלי להפיק

כל משפט מדובר בסצנה (בצעדי scene ובסופים שעל השאלות) הופך ל-
assets/course-scenes/<שם>.mp3, והשם נגזר מהקול ומהטקסט (scripts/course_scene_voices.py).
לכן משפט שהשתנה מקבל קובץ חדש, וקובץ קיים לעולם אינו נדרס.

הקול: Azure Speech, אותו מסלול של הרילסים (marketing/reel_worker/run_job.py, azure_tts).
המפתח: AZURE_SPEECH_KEY ו-AZURE_SPEECH_REGION, או סשן ענן בסביבה shuknadlan,
שבה ה-proxy מוסיף את המפתח לבקשות ל-westeurope.tts.speech.microsoft.com בעצמו.
צריך ffmpeg (חיתוך שקט בקצוות וקידוד מונו 40kbps, כ-25KB למשפט).

אחרי ההפקה: python3 scripts/course_content_sql.py --check (שבודק שאין משפט בלי קובץ).
"""
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import time
import urllib.error
from email.utils import parsedate_to_datetime
import urllib.request
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import course_scene_voices as voices  # noqa: E402
import course_content_sql as content  # noqa: E402

ROOT = content.ROOT


def retry_after(value):
    """Retry-After הוא מספר שניות או תאריך HTTP; כל דבר אחר - 0, והקורא בוחר המתנה בעצמו."""
    if not value:
        return 0
    try:
        return max(0, int(value))
    except ValueError:
        pass
    try:
        return max(0, int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()))
    except (TypeError, ValueError):
        return 0


def tts(text, who, out):
    voice, rate, pitch = voices.PROFILES[who]
    ssml = (f"<speak version='1.0' xml:lang='he-IL'><voice name='{voice}'>"
            f"<prosody rate='{rate}' pitch='{pitch}'>{escape(text)}</prosody></voice></speak>")
    region = os.environ.get('AZURE_SPEECH_REGION', 'westeurope')
    # בלי מפתח בסביבה: ה-proxy של סשן הענן מחליף את הערך הזה במפתח השמור
    key = os.environ.get('AZURE_SPEECH_KEY', 'injected-by-proxy')
    req = urllib.request.Request(
        f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'), method='POST',
        headers={'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml',
                 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'shuknadlan-course'})
    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, 'raw.mp3')
        # למפתח יש מכסה לדקה (429). מחכים כמה שהשרת מבקש, וגם מעט בין בקשה לבקשה
        # ותקלת רשת חולפת (timeout, ניתוק) לא מפילה הרצה של עשרות משפטים
        for attempt in range(8):
            try:
                with urllib.request.urlopen(req, timeout=60) as r, open(raw, 'wb') as f:
                    f.write(r.read())
                break
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503) or attempt == 7:
                    raise
                wait = retry_after(e.headers.get('Retry-After')) or 10 * (attempt + 1)
                print('  %d מ-Azure, מחכים %d שניות' % (e.code, wait))
                time.sleep(wait)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == 7:
                    raise
                print('  תקלת רשת (%s), מנסים שוב' % e)
                time.sleep(5 * (attempt + 1))
        # שקט בקצוות היה משאיר את הבועה פתוחה על כלום
        trim = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
                'silenceremove=start_periods=1:start_threshold=-45dB,areverse')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af', trim, '-ac', '1', '-b:a', '40k', out], check=True)


def main():
    chapters, _problems = content.load()
    todo = {}
    for ch in chapters:
        for lesson in ch['lessons']:
            for _obj, who, text in voices.scene_lines(lesson):
                if who not in voices.PROFILES:
                    continue
                name = voices.audio_name(who, text)
                path = os.path.join(ROOT, voices.AUDIO_DIR, name + '.mp3')
                if not os.path.exists(path):
                    todo[name] = (who, text, path)
    if not todo:
        print('✓ לכל משפט בסצנות יש קובץ קול.')
        return 0
    if '--list' in sys.argv:
        for who, text, _p in todo.values():
            print('%-7s %s' % (who, text))
        print('%d משפטים בלי קובץ.' % len(todo))
        return 1
    os.makedirs(os.path.join(ROOT, voices.AUDIO_DIR), exist_ok=True)
    for n, (who, text, path) in enumerate(todo.values()):
        if n:
            time.sleep(1.5)  # המכסה של המפתח לדקה
        tts(text, who, path)
        print('נכתב %s  (%s) %s' % (os.path.relpath(path, ROOT), who, text[:50]))
    print('✓ %d קבצים חדשים.' % len(todo))
    return 0


if __name__ == '__main__':
    sys.exit(main())
