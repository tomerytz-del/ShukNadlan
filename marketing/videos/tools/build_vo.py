"""Cut the person's cleaned recording into one file per scene, speed it up, and write assets/voiceovers.json.

Usage: python3 -I build_vo.py <project-dir> <clean.wav> <align.json> <tempo>
"""
import json
import subprocess
import sys

import librosa
import numpy as np

proj, clean, align_path, tempo = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
plan = json.load(open(f"{proj}/plan.json"))
al = json.load(open(align_path))
y, sr = librosa.load(clean, sr=48000)
PACE = {"slow": 0.92, "normal": 1, "fast": 1.1}

out = {}
for s in plan["scenes"]:
    a = al[s["id"]]
    # refine the cut to where the voice really starts and ends near the aligned span
    lo = a["startSec"]
    hi = a["endSec"]
    seg = y[int(lo * sr): int(hi * sr)]
    _, (i0, i1) = librosa.effects.trim(seg, top_db=32, frame_length=1024, hop_length=256)
    start = max(0.0, lo + i0 / sr - 0.03)
    end = min(len(y) / sr, lo + i1 / sr + 0.06)
    key = f"assets/vo-{s['id']}.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", clean,
                    "-af", f"atempo={tempo},afade=t=in:d=0.02,afade=t=out:st={(end-start)/tempo-0.04:.3f}:d=0.04",
                    "-ar", "44100", "-ac", "1", "-b:a", "192k", f"{proj}/{key}"], check=True)
    dur = (end - start) / tempo
    words = []
    for w in a["words"]:
        st = min(max((w["startSec"] - start) / tempo, 0.0), dur)
        en = min(max((w["endSec"] - start) / tempo, st + 0.05), dur)
        words.append({"word": w["word"], "startSec": round(st, 3), "endSec": round(en, 3)})
    out[s["id"]] = {"key": key, "durationSec": round(dur, 3), "words": words, "text": s["narration"],
                    "voiceId": plan["voiceId"], "speed": PACE[plan.get("pace", "normal")]}
    print(f"{s['id']:10s} {start:6.2f}-{end:6.2f} -> {dur:5.2f}s  {' '.join(w['word']+'@'+format(w['startSec'],'.2f') for w in words)}")
json.dump(out, open(f"{proj}/assets/voiceovers.json", "w"), ensure_ascii=False, indent=1)
