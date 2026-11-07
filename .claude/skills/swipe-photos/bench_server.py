#!/usr/bin/env python3
"""bench server: repo static (+ swipe.js override) + fake Supabase storage render/image."""
import hashlib, io, mimetypes, pathlib, random, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[3]
PORT = int(sys.argv[1]); SWIPE = pathlib.Path(sys.argv[2])
CACHE = {}
def ratio(path):
    h = int(hashlib.md5(path.encode()).hexdigest(), 16) % 10
    return 0.75 if h < 7 else (1.5 if h < 9 else 0.5625)  # h/w: portrait mostly? w/h below
def make(path, w):
    k = (path, w)
    if k in CACHE: return CACHE[k]
    r = ratio(path); hgt = max(8, int(w * r))
    rnd = random.Random(path)
    # noisy gradient so JPEG size is realistic (~70-150KB at 800w)
    base = Image.effect_noise((max(8,w//4), max(8,hgt//4)), 60).convert("RGB").resize((w, hgt))
    tint = Image.new("RGB", (w, hgt), (rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)))
    img = Image.blend(base, tint, 0.45)
    b = io.BytesIO(); img.save(b, "JPEG", quality=70); CACHE[k] = b.getvalue(); return CACHE[k]
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def send(self, body, ctype, cache):
        self.send_response(200); self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", cache)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urlparse(self.path); p = u.path
        if p.startswith("/storage/v1/render/image/public/"):
            w = int(parse_qs(u.query).get("width", ["800"])[0])
            return self.send(make(p, w), "image/jpeg", "public, max-age=3600")
        if p.startswith("/storage/v1/object/public/"):
            return self.send(make(p, 1600), "image/jpeg", "public, max-age=3600")
        p = p.lstrip("/") or "index.html"
        if "." not in p and (ROOT / (p + ".html")).exists(): p += ".html"
        f = SWIPE if p == "assets/swipe.js" else ROOT / p
        try: body = f.read_bytes()
        except OSError:
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
        self.send(body, mimetypes.guess_type(f.name)[0] or "application/octet-stream", "no-cache")
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
