"""
בדיקות המנוע מול ffmpeg אמיתי, בלי רשת ובלי מסד.

    python -m unittest media_engine.test_media_engine -v

הבדיקות מייצרות סרטון סינתטי (‏lavfi) ומריצות עליו את הרינדור. ההורדה
מוחלפת בהעתקה מקומית, כי מה שנבדק כאן הוא ffmpeg והמדידה ולא urllib.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from media_engine import ffmpeg, renderers
from media_engine.ffmpeg import RenderError


def make_video(path: Path, seconds: float, size: str = "1920x1080") -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"testsrc2=s={size}:d={seconds}:r=30",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg אינו מותקן")
class PosterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def render(self, video: Path) -> Path:
        def fake_download(url, dest):
            shutil.copy(video, dest)
            return dest
        with mock.patch.object(renderers, "download", fake_download):
            return renderers.render_poster({"video_url": "https://example.test/v.mp4"}, self.tmp)

    def test_poster_is_capped_jpeg(self):
        out = self.render(make_video(self.tmp / "in.mp4", 5))
        meta = ffmpeg.probe(out)
        self.assertEqual(meta["codec"], "mjpeg")
        self.assertEqual(meta["width"], renderers.POSTER_MAX_WIDTH)
        self.assertEqual(meta["height"], 720)

    def test_short_vertical_video(self):
        # קצר מחלון ה-thumbnail (60 פריימים) - המסנן חייב לפלוט בסוף הקלט
        out = self.render(make_video(self.tmp / "in.mp4", 1, size="720x1280"))
        meta = ffmpeg.probe(out)
        self.assertEqual((meta["width"], meta["height"]), (720, 1280))

    def test_not_a_video_fails_without_retry(self):
        bad = self.tmp / "bad.mp4"
        bad.write_bytes(b"not a video at all")
        with self.assertRaises(RenderError) as ctx:
            self.render(bad)
        self.assertFalse(ctx.exception.retryable)

    def test_probe_measures_video(self):
        meta = ffmpeg.probe(make_video(self.tmp / "in.mp4", 2))
        self.assertAlmostEqual(meta["duration"], 2, delta=0.1)
        self.assertFalse(meta["has_audio"])


class FakeClient:
    def __init__(self):
        self.completed, self.failed = [], []

    def complete(self, job_id, meta):
        self.completed.append((job_id, meta))

    def fail(self, job_id, error, retryable):
        self.failed.append((job_id, error, retryable))


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg אינו מותקן")
class ProcessTest(unittest.TestCase):
    """הלולאה של media_render.py: מה מדווח לשרת בכל מסלול."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.video = make_video(self.tmp / "in.mp4", 3)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_job(self, kind):
        import media_render
        uploads = []

        def fake_download(url, dest):
            shutil.copy(self.video, dest)
            return dest

        client = FakeClient()
        claimed = {
            "job": {"id": "j1", "kind": kind, "input": {"video_url": "https://example.test/v.mp4"}, "attempt": 1},
            "upload": {"url": "https://signed.example/secret", "content_type": "image/jpeg"},
        }
        with mock.patch.object(renderers, "download", fake_download), \
             mock.patch.object(media_render, "upload", lambda url, path, ct: uploads.append((url, path.stat().st_size, ct))):
            media_render.process(client, claimed)
        return client, uploads

    def test_poster_completes_with_measured_meta(self):
        client, uploads = self.run_job("poster")
        self.assertEqual(client.failed, [])
        self.assertEqual(len(uploads), 1)
        job_id, meta = client.completed[0]
        self.assertEqual(job_id, "j1")
        self.assertEqual(meta["width"], 1280)
        self.assertGreater(meta["bytes"], 0)
        self.assertIn("render_seconds", meta)

    def test_unknown_kind_fails_without_retry(self):
        client, uploads = self.run_job("reel")
        self.assertEqual(uploads, [])
        self.assertEqual(client.failed, [("j1", "kind_not_implemented: reel", False)])


class ClientTest(unittest.TestCase):
    def test_rejects_non_https_source(self):
        from media_engine.client import download
        with self.assertRaises(RenderError):
            download("http://example.test/v.mp4", Path("/tmp/x"))
        with self.assertRaises(RenderError):
            download(None, Path("/tmp/x"))


if __name__ == "__main__":
    unittest.main()
