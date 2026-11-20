"""Transcribe a long recording to a word-timed JSON (faster-whisper, Hebrew by default).

Usage: python3 -I transcribe.py <video> <out.json> [--model large-v3|<local dir>] [--language he]
                                [--device auto|cpu|cuda] [--compute-type auto] [--prompt "<terms>"]

Output (all times in seconds, from the start of <video>):
  {"language": "he", "duration": 1834.2,
   "words":    [{"i": 0, "word": "שלום", "startSec": 0.42, "endSec": 0.8}, ...],
   "segments": [{"startSec": 0.4, "endSec": 6.1, "text": "שלום וברוכים הבאים."}, ...]}

The model is downloaded from huggingface.co on first use. In a cloud session that host is blocked
(see the skill: either allow it in the environment, or run this step on a machine that can and copy
out.json back; every other tool here reads only the JSON).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("out")
ap.add_argument("--model", default="large-v3")
ap.add_argument("--language", default="he", help="'auto' to let the model detect it")
ap.add_argument("--device", default="auto")
ap.add_argument("--compute-type", default="auto")
ap.add_argument("--prompt", default="", help="terms the speaker uses (names, places) to bias the model")
a = ap.parse_args()

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit("faster-whisper is missing: pip install faster-whisper")

tmp = tempfile.mkdtemp(prefix="shorts-")
wav = os.path.join(tmp, "audio.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.video, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
duration = float(subprocess.check_output(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.video]).strip())

try:
    model = WhisperModel(a.model, device=a.device, compute_type=a.compute_type)
except Exception as e:  # download blocked, no disk, bad path
    sys.exit(f"could not load model '{a.model}': {e}\n"
             "In a cloud session huggingface.co is blocked: allow it, or transcribe elsewhere.")

segs, info = model.transcribe(
    wav,
    language=None if a.language == "auto" else a.language,
    word_timestamps=True,
    vad_filter=True,                 # silence is not speech: stops hallucinated lines over pauses
    condition_on_previous_text=False,  # one bad passage must not poison the rest
    initial_prompt=a.prompt or None,
)

words, segments = [], []
for s in segs:
    segments.append({"startSec": round(s.start, 3), "endSec": round(s.end, 3), "text": s.text.strip()})
    for w in s.words or []:
        t = w.word.strip()
        if not t:
            continue
        words.append({"i": len(words), "word": t, "startSec": round(w.start, 3), "endSec": round(max(w.end, w.start + 0.04), 3)})

json.dump({"language": info.language, "duration": round(duration, 3), "words": words, "segments": segments},
          open(a.out, "w"), ensure_ascii=False, indent=1)
print(f"{len(words)} words, {len(segments)} segments, language {info.language}, {duration/60:.1f} min -> {a.out}")
