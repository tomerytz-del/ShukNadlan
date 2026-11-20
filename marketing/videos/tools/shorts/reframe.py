"""Cut one segment out of the long recording as a 1080x1920 clip: face-tracked crop, sound kept.

Usage: python3 -I reframe.py <video> <start> <end> <out.mp4> [--mode face|center|screen] [--meta out.json]

face    talking head: a 9:16 window follows the speaker's face (Haar cascade, no model download). The window
        only moves when the face leaves the middle of it, and moves smoothly, so it never jitters.
center  fixed centre crop (use when no face is found, or for a wide shot with the speaker in the middle).
screen  screen recording or slides: the whole picture, fitted to the width over a blurred copy of itself.

Re-encodes (a crop cannot be stream-copied). Exits non-zero if the result is not 1080x1920 with sound.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("start", type=float)
ap.add_argument("end", type=float)
ap.add_argument("out")
ap.add_argument("--mode", default="face", choices=["face", "center", "screen"])
ap.add_argument("--meta")
ap.add_argument("--fps", type=float, default=4.0, help="face samples per second")
a = ap.parse_args()

W, H = 1080, 1920
cap = cv2.VideoCapture(a.video)
sw, sh = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
dur = a.end - a.start
cw = min(sw, int(round(sh * 9 / 16 / 2)) * 2)  # window width in source pixels, even


def face_track():
    """[(t, centre_x or None)] from the segment, t relative to its start."""
    cas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    scale = 640.0 / sw if sw > 640 else 1.0
    out, t = [], 0.0
    while t < dur:
        cap.set(cv2.CAP_PROP_POS_MSEC, (a.start + t) * 1000)
        ok, fr = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(cv2.resize(fr, None, fx=scale, fy=scale) if scale != 1 else fr, cv2.COLOR_BGR2GRAY)
        faces = cas.detectMultiScale(g, scaleFactor=1.1, minNeighbors=5, minSize=(int(g.shape[0] * 0.08),) * 2)
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            out.append((t, (x + w / 2) / scale))
        else:
            out.append((t, None))
        t += 1.0 / a.fps
    return out


def smooth_path(track):
    """Per-sample window left edge: fill gaps, median-filter, then follow with a dead zone and easing."""
    xs = np.array([np.nan if c is None else c for _, c in track], dtype=float)
    n = len(xs)
    idx = np.arange(n)
    good = ~np.isnan(xs)
    if good.sum() == 0:
        return None, 0.0
    xs = np.interp(idx, idx[good], xs[good])
    k = 5
    pad = np.pad(xs, k // 2, mode="edge")
    xs = np.array([np.median(pad[i:i + k]) for i in range(n)])
    cam, path = xs[0], []
    dead = cw * 0.10      # the face may drift this far from the middle before the window moves
    for x in xs:
        if abs(x - cam) > dead:
            cam += (x - cam - np.sign(x - cam) * dead) * 0.18  # ease toward it
        path.append(cam)
    left = np.clip(np.array(path) - cw / 2, 0, sw - cw)
    return left, float(good.mean())


def keyframes(track, left):
    """Thin the path to points where the window really moved (>= 6 source px), as (t, left)."""
    pts = [(track[0][0], float(left[0]))]
    for (t, _), x in zip(track[1:], left[1:]):
        if abs(x - pts[-1][1]) >= 6:
            pts.append((t, float(x)))
    pts.append((track[-1][0] if track[-1][0] > pts[-1][0] else pts[-1][0] + 0.01, float(left[-1])))
    return pts


def x_expr(pts):
    """ffmpeg expression for a piecewise-linear window position over the clip's time t."""
    e = f"{pts[-1][1]:.1f}"
    for (t0, x0), (t1, x1) in reversed(list(zip(pts, pts[1:]))):
        seg = f"{x0:.1f}+({x1:.1f}-{x0:.1f})*(t-{t0:.3f})/{max(t1 - t0, 0.01):.3f}"
        e = f"if(lt(t,{t1:.3f}),{seg},{e})"
    return e


meta = {"mode": a.mode, "source": f"{sw}x{sh}", "start": a.start, "end": a.end}
if a.mode == "screen":
    fc = (f"[0:v]split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=30:5,"
          f"eq=brightness=-0.15[bg];[b]scale={W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]")
else:
    pts = None
    if a.mode == "face":
        track = face_track()
        left, cover = smooth_path(track) if track else (None, 0.0)
        meta["faceCoverage"] = round(cover, 2)
        if left is None or cover < 0.3:
            print(f"warning: a face in only {cover:.0%} of samples, using a centre crop", file=sys.stderr)
            meta["mode"] = "center"
        else:
            pts = keyframes(track, left)
            meta["windowKeyframes"] = len(pts)
    xe = x_expr(pts) if pts else f"{(sw - cw) // 2}"
    fc = f"[0:v]crop=w={cw}:h={sh}:x='{xe}':y=0,scale={W}:{H}:flags=lanczos,format=yuv420p[v]"
cap.release()

sf = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
sf.write(fc)
sf.close()
cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{a.start:.3f}", "-to", f"{a.end:.3f}", "-i", a.video,
       "-filter_complex_script", sf.name, "-map", "[v]", "-map", "0:a:0",
       "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", a.out]
subprocess.run(cmd, check=True)
os.unlink(sf.name)

probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,duration",
                                            "-of", "json", a.out]))["streams"]
v = next(s for s in probe if s["codec_type"] == "video")
if (v["width"], v["height"]) != (W, H) or not any(s["codec_type"] == "audio" for s in probe):
    sys.exit(f"bad output: {v['width']}x{v['height']}, audio={any(s['codec_type']=='audio' for s in probe)}")
meta["duration"] = round(float(v["duration"]), 2)
if a.meta:
    json.dump(meta, open(a.meta, "w"), indent=1)
print(json.dumps(meta, ensure_ascii=False))
