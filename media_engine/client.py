"""
הלקוח של media-render (supabase/functions/media-render).

**למנוע אין service_role ואין גישה למסד.** הוא מחזיק סוד אחד,
‏MEDIA_WORKER_SECRET, שמאפשר רק לקחת בקשה, לדווח עליה, ולהעלות לנתיב
שהשרת בחר. הריפו ציבורי, ולכן גם יומני הריצה ב-Actions ציבוריים - ומכאן
הכלל השני: **הכתובת החתומה להעלאה לעולם לא מודפסת.** היא נותנת הרשאת
כתיבה לקובץ, גם אם רק לאחד ורק לזמן קצר.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from media_engine.ffmpeg import RenderError

DEFAULT_ENDPOINT = "https://obookujgolazrwycsiyn.supabase.co/functions/v1/media-render"

# קובץ מקור גדול מזה אינו נכס: הדלי של הסרטונים חסום ב-50MB.
MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024


class MediaClient:
    def __init__(self, endpoint: str | None = None, secret: str | None = None):
        self.endpoint = (endpoint or os.environ.get("MEDIA_RENDER_URL") or DEFAULT_ENDPOINT).rstrip("/")
        self.secret = secret or os.environ.get("MEDIA_WORKER_SECRET") or ""
        if not self.secret:
            raise SystemExit("MEDIA_WORKER_SECRET אינו מוגדר (Settings → Secrets → Actions).")

    def _post(self, mode: str, body: dict | None = None) -> dict:
        req = urllib.request.Request(
            f"{self.endpoint}?mode={mode}",
            data=json.dumps(body or {}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "x-media-worker-secret": self.secret},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            detail = err.read()[:300].decode("utf-8", "replace")
            raise RuntimeError(f"media-render {mode}: HTTP {err.code} {detail}") from None

    def claim(self) -> dict | None:
        """בקשה אחת מהתור, או None כשהוא ריק."""
        data = self._post("claim")
        return data if data.get("job") else None

    def complete(self, job_id: str, meta: dict) -> dict:
        return self._post("complete", {"job_id": job_id, "meta": meta})

    def fail(self, job_id: str, error: str, retryable: bool) -> dict:
        return self._post("fail", {"job_id": job_id, "error": error[:1000], "retryable": retryable})


def download(url: str, dest: Path) -> Path:
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RenderError("bad_source_url", retryable=False)
    req = urllib.request.Request(url, headers={"User-Agent": "shuknadlan-media-engine"})
    total = 0
    try:
        with urllib.request.urlopen(req, timeout=120) as res, open(dest, "wb") as out:
            while chunk := res.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise RenderError("source_too_large", retryable=False)
                out.write(chunk)
    except urllib.error.HTTPError as err:
        # ‏404 לא ישתנה בניסיון הבא; ‏5xx אולי כן
        raise RenderError(f"download_http_{err.code}", retryable=err.code >= 500) from None
    except urllib.error.URLError as err:
        raise RenderError(f"download_error: {err.reason}", retryable=True) from None
    if total == 0:
        raise RenderError("empty_source", retryable=False)
    return dest


def upload(signed_url: str, path: Path, content_type: str) -> None:
    req = urllib.request.Request(
        signed_url,
        data=path.read_bytes(),
        method="PUT",
        headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": "max-age=31536000"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300):
            pass
    except urllib.error.HTTPError as err:
        # לא מדפיסים את הכתובת, רק את התשובה
        detail = err.read()[:300].decode("utf-8", "replace")
        raise RenderError(f"upload_http_{err.code}: {detail}", retryable=err.code >= 500) from None
    except urllib.error.URLError as err:
        raise RenderError(f"upload_error: {err.reason}", retryable=True) from None
