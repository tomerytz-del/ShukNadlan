"""
הרינדורים עצמם, אחד לכל `kind` ב-media_renders.

בשלב 0 קיים רק `poster`. הוא נבחר להיות הראשון כי הוא מוכיח את כל הצינור
(שיגור, לקיחה, הורדה, ffmpeg, מדידה, העלאה, דיווח) כמעט בלי סיכון: תוצר
שגוי הוא תמונה, ושום דבר באתר עדיין לא קורא אותה.
"""

from __future__ import annotations

from pathlib import Path

from media_engine import ffmpeg
from media_engine.client import download
from media_engine.ffmpeg import RenderError

# תמונת פתיחה רחבה מזה לא נראית טוב יותר על אריח או בדף הנכס, רק שוקלת.
POSTER_MAX_WIDTH = 1280


def render_poster(job_input: dict, workdir: Path) -> Path:
    """
    פריים מייצג מהסרטון, כ-JPEG.

    **לא הפריים הראשון.** סרטון שהועלה מהטלפון נפתח לעתים קרובות בפריים
    שחור או מטושטש, וקליפ של Kling מתחיל לפני שהמצלמה זזה. לכן מדלגים
    לשליש הראשון (עד שנייה), ומשם `thumbnail` בוחר את הפריים המייצג ביותר
    מתוך החלון - המסנן הזה בוחר את הפריים הקרוב ביותר להיסטוגרמה הממוצעת,
    כלומר מדלג על הבזקים ועל מעברים.
    """
    src = download(job_input.get("video_url"), workdir / "source")
    meta = ffmpeg.probe(src)
    if not meta.get("width"):
        raise RenderError("source_has_no_video", retryable=False)

    duration = meta.get("duration") or 0
    seek = min(1.0, duration / 3) if duration else 0
    out = workdir / "poster.jpg"
    ffmpeg.run([
        "-ss", f"{seek:.2f}", "-i", str(src),
        "-vf", f"thumbnail=60,scale='min({POSTER_MAX_WIDTH},iw)':-2",
        "-frames:v", "1", "-q:v", "3",
        str(out),
    ])
    if not out.exists() or out.stat().st_size == 0:
        raise RenderError("poster_empty", retryable=False)
    return out


RENDERERS = {
    "poster": render_poster,
}
