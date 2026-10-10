"""Second pass: snap each line's span to real pauses, then align words inside the line with a global DTW against the reference TTS.

Usage: python3 -I align_lines.py <user.wav> <align-project-dir> <coarse.json> <out.json> [spans.json]

spans.json (optional): {"<scene id>": [start_sec, end_sec]} - pins a line's span by hand when the snapping to pauses
picks the wrong pause (a line said in one breath with the next one, or a breath that looks like a word). Read the
loudness around the boundary first; a breath is about -50dB, speech about -20dB.
"""
import json
import subprocess
import sys

import librosa
import numpy as np

SR = 16000
HOP = 160

user_path, proj, coarse_path, out_path = sys.argv[1:5]
fixed = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else {}
plan = json.load(open(f"{proj}/plan.json"))
vos = json.load(open(f"{proj}/assets/voiceovers.json"))
coarse = json.load(open(coarse_path))
y, _ = librosa.load(user_path, sr=SR)
total = len(y) / SR

# pauses of 0.15 s or more at -42 dB
log = subprocess.run(["ffmpeg", "-i", user_path, "-af", "silencedetect=noise=-42dB:d=0.15", "-f", "null", "-"], capture_output=True, text=True).stderr
starts, ends = [], []
for line in log.splitlines():
    if "silence_start:" in line:
        starts.append(float(line.split("silence_start:")[1].split()[0]))
    if "silence_end:" in line:
        ends.append(float(line.split("silence_end:")[1].split("|")[0].split()[0]))
pauses = list(zip(starts, ends + [total] * (len(starts) - len(ends))))
speech_starts = [0.0] + [e for _, e in pauses]  # where voice resumes after a pause
speech_ends = [s for s, _ in pauses] + [total]


def nearest(v, arr):
    return min(arr, key=lambda a: abs(a - v))


def feats(sig):
    m = librosa.feature.mfcc(y=sig, sr=SR, n_mfcc=20, hop_length=HOP, n_fft=512)[1:]
    f = np.vstack([m, librosa.feature.delta(m)])
    return (f - f.mean(axis=1, keepdims=True)) / (f.std(axis=1, keepdims=True) + 1e-6)


out = {}
for s in plan["scenes"]:
    i = s["id"]
    c = coarse[i]
    if i in fixed:
        st, en = float(fixed[i][0]), float(fixed[i][1])
    else:
        st = nearest(c["startSec"], [v for v in speech_starts if v < c["endSec"] - 0.3])
        en = nearest(c["endSec"], [v for v in speech_ends if v > st + 0.3])
    seg = y[int(st * SR): int(en * SR)]
    q, _ = librosa.load(f"{proj}/{vos[i]['key']}", sr=SR)
    q, idx = librosa.effects.trim(q, top_db=35)
    off = idx[0] / SR
    qlen = len(q) / SR
    D, wp = librosa.sequence.dtw(X=feats(q), Y=feats(seg), metric="cosine")
    wp = wp[::-1]
    first = {}
    for a, b in wp:
        first.setdefault(int(a), int(b))
    qa = np.array(sorted(first))

    def to_user(sec):
        f = int(np.clip(round((sec - off) * SR / HOP), qa[0], qa[-1]))
        j = qa[min(np.searchsorted(qa, f), len(qa) - 1)]
        return st + first[int(j)] * HOP / SR

    words = []
    for w in vos[i]["words"]:
        words.append({"word": w["word"], "startSec": round(to_user(w["startSec"]), 3), "endSec": round(to_user(min(w["endSec"], off + qlen)), 3)})
    out[i] = {"startSec": round(st, 3), "endSec": round(en, 3), "words": words}
    print(f"{i:10s} {st:6.2f}-{en:6.2f}  " + " ".join(f"{w['word']}@{w['startSec']-st:.2f}" for w in words))
json.dump(out, open(out_path, "w"), ensure_ascii=False, indent=1)
