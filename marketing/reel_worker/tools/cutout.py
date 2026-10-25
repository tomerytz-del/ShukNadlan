#!/usr/bin/env python3
"""Agent head-and-shoulders cutout (background removed) for reel layout D.
Runs inside the isolated venv /home/box/.venvs/rembg (pip install "rembg[cpu]"), called by reel.py:
    cutout.py IN.jpg OUT.png [--model u2net_human_seg]
Writes an RGBA PNG trimmed to the subject, plus prints JSON quality stats (alpha coverage, edge touches)."""
import os as _os, sys as _sys
# tools/queue.py shadows the stdlib "queue" module; drop this dir from sys.path before other imports
_sys.path[:] = [x for x in _sys.path if _os.path.abspath(x or ".") != _os.path.dirname(_os.path.abspath(__file__))]
import argparse, json
from PIL import Image, ImageFilter, ImageOps
from rembg import remove, new_session

ap = argparse.ArgumentParser()
ap.add_argument("inp"); ap.add_argument("out"); ap.add_argument("--model", default="u2net_human_seg")
a = ap.parse_args()
im = ImageOps.exif_transpose(Image.open(a.inp)).convert("RGB")
# drop flat white letterbox bars first
bb = im.convert("L").point(lambda v: 255 if v < 235 else 0).getbbox()
if bb: im = im.crop(bb)
cut = remove(im, session=new_session(a.model), post_process_mask=True)
# erode 1px-2px to drop the light fringe left by bright backgrounds, then soften the edge
al = cut.getchannel("A").point(lambda v: 0 if v < 24 else v).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(0.8))
cut.putalpha(al)
bb = al.point(lambda v: 255 if v > 60 else 0).getbbox()
if not bb:
    print(json.dumps({"ok": False, "reason": "empty mask"})); raise SystemExit(2)
cut = cut.crop(bb)
cov = sum(1 for v in cut.getchannel("A").getdata() if v > 128) / (cut.width * cut.height)
cut.save(a.out)
print(json.dumps({"ok": True, "size": cut.size, "coverage": round(cov, 3), "bbox_in_src": bb, "src": im.size}))
