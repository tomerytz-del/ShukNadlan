#!/usr/bin/env python3
"""
מנוע המדיה - נקודת הכניסה. רץ ב-GitHub Actions (media_render.yml).

ריצה אחת מרוקנת את התור: לוקחת בקשה, מרנדרת, מודדת, מעלה ומדווחת, וחוזרת
על זה עד שאין עוד או שנגמר תקציב הזמן. ריצה לכל בקשה הייתה משלמת חצי דקה
של עליית runner על כל אחת. התור והספים במסד ובשרת: docs/media-worker.md.

הרצה:
    python media_render.py                 # עד שהתור ריק
    python media_render.py --max-jobs 1    # בקשה אחת
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
import time
from pathlib import Path

from media_engine import ffmpeg
from media_engine.client import MediaClient, upload
from media_engine.ffmpeg import RenderError
from media_engine.renderers import RENDERERS

log = logging.getLogger("media_render")

# ה-job ב-Actions חסום ב-30 דקות. משאירים מרווח כדי לא להיחתך באמצע העלאה,
# כי בקשה שנחתכה נתקעת ב-rendering עד שה-cron מחזיר אותה לתור.
TIME_BUDGET_SECONDS = 22 * 60


def process(client: MediaClient, claimed: dict) -> None:
    job = claimed["job"]
    job_id, kind = job["id"], job["kind"]
    log.info("בקשה %s (%s), ניסיון %s", job_id, kind, job.get("attempt"))

    renderer = RENDERERS.get(kind)
    if renderer is None:
        client.fail(job_id, f"kind_not_implemented: {kind}", retryable=False)
        log.warning("סוג %s עוד לא ממומש במנוע", kind)
        return

    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="media-") as tmp:
            out = renderer(job.get("input") or {}, Path(tmp))
            meta = ffmpeg.probe(out)
            meta["render_seconds"] = round(time.monotonic() - started, 1)
            upload(claimed["upload"]["url"], out, claimed["upload"]["content_type"])
    except RenderError as err:
        log.error("נכשל: %s (retryable=%s)", err, err.retryable)
        client.fail(job_id, str(err), retryable=err.retryable)
        return
    except Exception as err:  # באג במנוע: לא לנסות שוב על אותו קלט בלולאה
        log.exception("שגיאה לא צפויה")
        client.fail(job_id, f"engine_error: {type(err).__name__}: {err}", retryable=False)
        return

    client.complete(job_id, meta)
    log.info("הושלם: %s", meta)


def main() -> int:
    parser = argparse.ArgumentParser(description="מנוע המדיה")
    parser.add_argument("--max-jobs", type=int, default=50)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ffmpeg.require_binaries()
    client = MediaClient()

    deadline = time.monotonic() + TIME_BUDGET_SECONDS
    done = 0
    while done < args.max_jobs and time.monotonic() < deadline:
        claimed = client.claim()
        if not claimed:
            break
        process(client, claimed)
        done += 1

    log.info("סיום: %d בקשות", done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
