"""Encode rendered shorts for each platform and validate them.

Usage: python3 -I export.py <out-dir> <platform: all|youtube|tiktok|instagram> <in1.mp4> [in2.mp4 ...]

Writes <out-dir>/<name>_<yt|tt|ig>.mp4 per input and platform. All are H.264 High, yuv420p, 1080x1920, 30 fps,
AAC, faststart. The platform differs only in bitrate. Then every file is checked: playable, 1080x1920, a
video and an audio stream, sound that is not silent, and a length of 3 to 90 s. A failed check exits non-zero.
"""
import json
import os
import re
import subprocess
import sys

PLAT = {  # suffix, video args, audio bitrate
    "youtube": ("yt", ["-b:v", "12M", "-maxrate", "14M", "-bufsize", "24M"], "192k"),
    "tiktok": ("tt", ["-crf", "18"], "128k"),
    "instagram": ("ig", ["-b:v", "4500k", "-maxrate", "5000k", "-bufsize", "9000k"], "128k"),
}
out_dir, which, files = sys.argv[1], sys.argv[2], sys.argv[3:]
if which != "all" and which not in PLAT or not files:
    sys.exit(__doc__)
os.makedirs(out_dir, exist_ok=True)
made = []
for f in files:
    name = os.path.splitext(os.path.basename(f))[0]
    for p in (PLAT if which == "all" else [which]):
        suf, vargs, ab = PLAT[p]
        dst = f"{out_dir}/{name}_{suf}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f, "-c:v", "libx264", "-profile:v", "high", "-level", "4.2",
                        "-preset", "slow", *vargs, "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", ab,
                        "-ar", "44100", "-movflags", "+faststart", dst], check=True)
        made.append(dst)

bad = 0
for f in made:
    streams = json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-show_entries",
         "format=duration,size", "-of", "json", f]))
    v = next((s for s in streams["streams"] if s["codec_type"] == "video"), None)
    au = next((s for s in streams["streams"] if s["codec_type"] == "audio"), None)
    dur, size = float(streams["format"]["duration"]), int(streams["format"]["size"])
    vol = subprocess.run(["ffmpeg", "-v", "info", "-i", f, "-vn", "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.search(r"max_volume: (-?[\d.]+) dB", vol)
    maxv = float(m.group(1)) if m else -99.0
    errs = []
    if not v or (v["width"], v["height"]) != (1080, 1920):
        errs.append("not 1080x1920")
    if not au:
        errs.append("no audio")
    elif maxv < -45:
        errs.append(f"audio is silent (max {maxv} dB)")
    if not 3 <= dur <= 90:
        errs.append(f"duration {dur:.1f}s outside 3-90")
    print(f"{'FAIL' if errs else 'ok  '} {f}  {dur:.1f}s  {size/1e6:.1f}MB  max {maxv} dB  {', '.join(errs)}")
    bad += bool(errs)
sys.exit(1 if bad else 0)
