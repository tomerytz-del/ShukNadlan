"""
עטיפה דקה סביב ffmpeg ו-ffprobe.

**כל תוצר נמדד ב-ffprobe לפני שהוא מדווח.** זה הלקח מהסרטון השיווקי: שם
‏`compose` של fal החזיר "הצלחה" על חיתוך שלא חתך כלום, ורק מדידת האורך של
הקובץ שיצא גילתה את זה (docs/property-marketing-video.md). לכן `probe` אינו
עזר אופציונלי אלא חלק מהחוזה: `output_meta` במסד הוא מה שנמדד, לא מה
שביקשנו.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


class RenderError(Exception):
    """כשל רינדור. `retryable` אומר אם ניסיון נוסף על אותו קלט עשוי להצליח."""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def require_binaries() -> None:
    for name in ("ffmpeg", "ffprobe"):
        if not shutil.which(name):
            raise RenderError(f"{name}_not_installed", retryable=False)


def run(args: list[str], timeout: int = 600) -> None:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RenderError("ffmpeg_timeout", retryable=True)
    if proc.returncode != 0:
        # השורות האחרונות של stderr הן הסיבה. הכול נכנס ל-last_error במסד.
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        raise RenderError("ffmpeg_failed: " + " | ".join(tail), retryable=False)


def probe(path: Path) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise RenderError("ffprobe_failed: " + (proc.stderr or "").strip()[:300])
    data = json.loads(proc.stdout or "{}")
    fmt = data.get("format") or {}
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    def num(value, cast=float):
        try:
            return cast(value)
        except (TypeError, ValueError):
            return None

    return {
        "width": num(video.get("width"), int),
        "height": num(video.get("height"), int),
        "codec": video.get("codec_name"),
        # לתמונה אין אורך, ו-ffprobe מחזיר עבורה N/A או כלום
        "duration": num(fmt.get("duration")),
        "bytes": path.stat().st_size,
        "has_audio": audio is not None,
    }
