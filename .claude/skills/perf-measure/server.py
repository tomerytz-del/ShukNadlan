#!/usr/bin/env python3
"""שרת מדידה שמחקה את Netlify — הכותרות הן חצי מהמדידה.

‏Netlify מגיש את האתר הזה כך, ו-`_headers` בשורש הוא מה שקובע:

* ‏HTML/JS/CSS נדחסים (‏brotli למי שתומך, ‏gzip לשאר).
* אין להם `max-age` ארוך בכוונה — שמות הקבצים אינם נושאים חתימת תוכן.
  מה שנשאר הוא אימות מחדש מול `ETag`, שמחזיר `304` קצר כשאין שינוי.
* קבצים בינאריים ב-`assets/` מקבלים יום.

**שרת בלי הכותרות האלה הורס את המדידה בשקט.** בלי `Cache-Control`
‏Chromium אינו שומר את התשובה בכלל, ואז "ביקור חוזר" יוריד הכול מחדש
ויראה בדיוק כמו ביקור ראשון — כלומר המדידה תגיד שאין שום רווח במטמון.

הרצה:  python server.py 8741 [before.html]
"""
import gzip, hashlib, mimetypes, pathlib, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[3]   # שורש הריפו
EXTRA = pathlib.Path.cwd()                           # מכאן נלקחת גרסת ה"לפני"
LOCAL = set(sys.argv[2:]) or {"before.html"}
COMPRESSIBLE = {".html", ".js", ".css", ".json", ".svg", ".webmanifest", ".xml", ".txt"}
LONG = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0].lstrip("/") or "index.html"
        # ‏כמו Netlify: /about מוגש מ-about.html. הקישורים באתר נכתבים בצורה
        # הזו (‏scripts/check_canonical.py), ובלי השורה הזו כל ניווט במדידה
        # היה 404 — כלומר מספר שנראה מצוין ואינו מודד כלום.
        if "." not in path and (ROOT / (path + ".html")).exists():
            path += ".html"
        f = EXTRA / path if path in LOCAL else ROOT / path
        try:
            body = f.read_bytes()
        except OSError:
            self.send_response(404); self.send_header("Content-Length", "0")
            self.end_headers(); return

        etag = '"%s"' % hashlib.md5(body).hexdigest()
        if (self.headers.get("If-None-Match") or "") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "public, max-age=0, must-revalidate")
            self.end_headers(); return

        headers = {
            "Content-Type": mimetypes.guess_type(f.name)[0] or "application/octet-stream",
            "ETag": etag,
            "Cache-Control": ("public, max-age=86400" if f.suffix in LONG
                              else "public, max-age=0, must-revalidate"),
        }
        if f.suffix in COMPRESSIBLE and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 6)      # רמה 6, כמו שמגישים בפועל
            headers["Content-Encoding"] = "gzip"

        self.send_response(200)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8741
    print("מגיש את %s על 127.0.0.1:%d (מקומי: %s)" % (ROOT, port, ", ".join(sorted(LOCAL))))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
