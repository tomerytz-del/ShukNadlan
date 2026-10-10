"""Align a person's recording of a known script to reference TTS lines (with word timings) using MFCC + subsequence DTW.

Usage: python3 -I align_voice.py <user.wav> <align-project-dir> <out.json>
Line order follows plan.json. The line `repeat_id` was said several times; the LAST take before the next line is used.
"""
import json
import sys

import librosa
import numpy as np

SR = 16000
HOP = 160  # 10 ms
REPEAT_ID = "matches"


def feats(y):
    m = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=20, hop_length=HOP, n_fft=512)[1:]
    d = librosa.feature.delta(m)
    f = np.vstack([m, d])
    f = (f - f.mean(axis=1, keepdims=True)) / (f.std(axis=1, keepdims=True) + 1e-6)
    return f


def subseq(q, y):
    D, wp = librosa.sequence.dtw(X=q, Y=y, subseq=True, metric="cosine")
    cost = D[-1, :] / q.shape[1]
    end = int(np.argmin(cost))
    D2, wp2 = librosa.sequence.dtw(X=q, Y=y[:, : end + 1], subseq=True, metric="cosine")
    wp2 = wp2[::-1]
    return wp2, float(cost[end])


def main():
    user_path, proj, out = sys.argv[1:4]
    plan = json.load(open(f"{proj}/plan.json"))
    vos = json.load(open(f"{proj}/assets/voiceovers.json"))
    y, _ = librosa.load(user_path, sr=SR)
    U = feats(y)
    n = U.shape[1]
    ids = [s["id"] for s in plan["scenes"]]
    Q = {}
    for i in ids:
        q, _ = librosa.load(f"{proj}/{vos[i]['key']}", sr=SR)
        q, idx = librosa.effects.trim(q, top_db=35)
        Q[i] = (feats(q), idx[0] / SR, vos[i]["words"])

    def find(i, lo, hi):
        wp, c = subseq(Q[i][0], U[:, lo:hi])
        return [(a, b + lo) for a, b in wp], c

    result = {}
    pos = 0
    k = 0
    while k < len(ids):
        i = ids[k]
        if i == REPEAT_ID and k + 1 < len(ids):
            nxt = ids[k + 1]
            # find the next line first, then the last take of this one just before it
            wpn, cn = find(nxt, pos + Q[i][0].shape[1] // 2, n)
            nstart = wpn[0][1]
            qlen = Q[i][0].shape[1]
            lo = max(pos, nstart - int(qlen * 1.7))
            wp, c = find(i, lo, nstart)
        else:
            wp, c = find(i, pos, n)
        start, end = wp[0][1], wp[-1][1]
        qf, off, words = Q[i]
        mapping = {}
        for a, b in wp:
            mapping.setdefault(a, b)
        qa = np.array(sorted(mapping))
        def to_user(sec):
            f = int(round((sec - off) * SR / HOP))
            f = int(np.clip(f, qa[0], qa[-1]))
            j = qa[np.searchsorted(qa, f)] if f <= qa[-1] else qa[-1]
            return mapping[int(j)] * HOP / SR
        uw = [{"word": w["word"], "startSec": round(to_user(w["startSec"]), 3), "endSec": round(to_user(w["endSec"]), 3)} for w in words]
        result[i] = {"startSec": start * HOP / SR, "endSec": end * HOP / SR, "cost": round(c, 3), "words": uw}
        print(f"{i:10s} {start*HOP/SR:6.2f}-{end*HOP/SR:6.2f}  cost {c:.3f}  first {uw[0]['word']}@{uw[0]['startSec']:.2f} last {uw[-1]['word']}@{uw[-1]['endSec']:.2f}")
        pos = end
        k += 1
    json.dump(result, open(out, "w"), ensure_ascii=False, indent=1)


main()
