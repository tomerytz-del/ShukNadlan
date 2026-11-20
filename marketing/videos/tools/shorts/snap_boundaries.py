"""Snap approved segments to word and sentence boundaries, so no clip starts or ends mid-word.

Usage: python3 -I snap_boundaries.py <transcript.json> <segments.json> <out.json> [--video <file>] [--min 8] [--max 60]

segments.json: {"segments": [{"id": 1, "start": 262.0, "end": 301.0, "hook1": "...", "hook2": "...", "score": 87}]}
Start moves to the nearest word start (never later than the word that was inside the clip), end moves to the
end of the sentence if it is within 3 s, else to the nearest word end, plus a short tail. With --video the cut
points are then nudged into the nearest real pause (ffmpeg silencedetect) within 0.35 s.
"""
import argparse
import json
import re
import subprocess
import sys

ap = argparse.ArgumentParser()
ap.add_argument("transcript")
ap.add_argument("segments")
ap.add_argument("out")
ap.add_argument("--video")
ap.add_argument("--min", type=float, default=8.0)
ap.add_argument("--max", type=float, default=60.0)
ap.add_argument("--lead", type=float, default=0.12, help="seconds of room before the first word")
ap.add_argument("--tail", type=float, default=0.35, help="seconds of room after the last word")
a = ap.parse_args()

tr = json.load(open(a.transcript))
words = tr["words"]
dur = tr["duration"]
SENT_END = re.compile(r"[.?!…]$")


def silences(video):
    """[(start, end)] of pauses of at least 0.25 s at -32 dB."""
    p = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", video, "-vn", "-af", "silencedetect=n=-32dB:d=0.25",
                        "-f", "null", "-"], capture_output=True, text=True)
    st, out = None, []
    for line in p.stderr.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m:
            st = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and st is not None:
            out.append((st, float(m.group(1))))
            st = None
    return out


sil = silences(a.video) if a.video else []


def nudge(t, pad_side):
    """Move t into a pause that is within 0.35 s (to the pause's middle, clamped so words are not cut)."""
    best = None
    for s, e in sil:
        if e < t - 0.35 or s > t + 0.35:
            continue
        mid = (s + e) / 2
        if best is None or abs(mid - t) < abs(best - t):
            best = mid
    return t if best is None else best


res = json.load(open(a.segments))["segments"]
out, notes = [], []
for seg in res:
    inside = [w for w in words if w["endSec"] > seg["start"] and w["startSec"] < seg["end"]]
    if not inside:
        notes.append(f"segment {seg['id']}: no speech in {seg['start']}-{seg['end']}, dropped")
        continue
    first = min(inside, key=lambda w: abs(w["startSec"] - seg["start"]))
    start = first["startSec"] - a.lead
    last = min(inside, key=lambda w: abs(w["endSec"] - seg["end"]))
    # extend to the end of the sentence if it closes within 3 s
    cur = last
    while not SENT_END.search(cur["word"]) and cur["i"] + 1 < len(words) and words[cur["i"] + 1]["endSec"] - last["endSec"] <= 3.0:
        cur = words[cur["i"] + 1]
    if SENT_END.search(cur["word"]):
        last = cur
    end = last["endSec"] + a.tail
    if sil:
        start = min(nudge(start, "s"), first["startSec"] - 0.03)
        end = max(nudge(end, "e"), last["endSec"] + 0.1)
    start, end = max(0.0, start), min(dur, end)
    if end - start > a.max:
        end = start + a.max
        notes.append(f"segment {seg['id']}: longer than {a.max:.0f}s, cut at the limit (check the ending)")
    if end - start < a.min:
        notes.append(f"segment {seg['id']}: only {end-start:.1f}s (min {a.min:.0f}), kept - check it stands alone")
    out.append({**seg, "start": round(start, 3), "end": round(end, 3),
                "deltaStartMs": round((start - seg["start"]) * 1000), "deltaEndMs": round((end - seg["end"]) * 1000)})

json.dump({"segments": out}, open(a.out, "w"), ensure_ascii=False, indent=1)
for s in out:
    print(f"#{s['id']}: {s['start']:.2f}-{s['end']:.2f} ({s['end']-s['start']:.1f}s)  start {s['deltaStartMs']:+d}ms  end {s['deltaEndMs']:+d}ms")
for n in notes:
    print("note:", n, file=sys.stderr)
