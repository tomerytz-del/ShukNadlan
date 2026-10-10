"""Tell which recorded take is which script line, when lines were repeated in an order the script does not predict.

Usage: python3 -I match_takes.py <user.wav> <align-project-dir> '<[[start, end], ...]>'
The spans are the speech blocks between silences (read them off the energy of the recording). Each block is
compared with every reference TTS line (MFCC + DTW, cost normalised by both lengths); the lowest cost names the
line. Take the LAST block of each line, and pin it with align_lines.py's spans.json.
"""
import json
import sys

import librosa
import numpy as np

SR = 16000
HOP = 160


def feats(y):
    m = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=20, hop_length=HOP, n_fft=512)[1:]
    f = np.vstack([m, librosa.feature.delta(m)])
    return (f - f.mean(1, keepdims=True)) / (f.std(1, keepdims=True) + 1e-6)


def main():
    user_path, proj, spans = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    plan = json.load(open(f"{proj}/plan.json"))
    vos = json.load(open(f"{proj}/assets/voiceovers.json"))
    y, _ = librosa.load(user_path, sr=SR)
    ids = [s["id"] for s in plan["scenes"]]
    ref = {}
    for i in ids:
        q, _ = librosa.load(f"{proj}/{vos[i]['key']}", sr=SR)
        q, _ = librosa.effects.trim(q, top_db=35)
        ref[i] = feats(q)
    print("block       " + " ".join(f"{i:>8s}" for i in ids))
    for a, b in spans:
        u = feats(y[int(a * SR):int(b * SR)])
        row = []
        for i in ids:
            D, _ = librosa.sequence.dtw(X=ref[i], Y=u, metric="cosine")
            row.append(D[-1, -1] / (ref[i].shape[1] + u.shape[1]))
        print(f"{a:5.2f}-{b:5.2f} " + " ".join(f"{r:8.3f}" for r in row) + "  -> " + ids[int(np.argmin(row))])


if __name__ == "__main__":
    main()
