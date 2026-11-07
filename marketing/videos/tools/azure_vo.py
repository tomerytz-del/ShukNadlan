#!/usr/bin/env python3
"""Record a video's narration with Azure Speech's native Hebrew voices.

Writes one WAV per line and a voiceovers.json in Reelkit's format (key,
durationSec, voiceId), so build_reel.py --vo reads it the same way.

    python3 azure_vo.py lines.json out_dir [--voice he-IL-HilaNeural] [--rate +8%]

lines.json: [{"id": "hook", "text": "on-screen wording", "tts": "optional spelling for the voice"}]
`tts` carries vowel points (niqqud) or a respelling for a word the voice gets
wrong, e.g. "מְתַאֲמִים" for metaamim; pointing never goes on screen
(the reelkit skill, reference/hebrew-rtl.md).

The key: AZURE_SPEECH_KEY, or in a cloud session the environment's network
secret for <region>.tts.speech.microsoft.com, which the proxy injects in place
of the placeholder sent here. AZURE_SPEECH_REGION defaults to westeurope, the
region the property reels use (marketing/reel_worker/run_job.py).
"""
import json, os, subprocess, sys, urllib.request
from xml.sax.saxutils import escape


def tts(text, out_wav, voice, rate, region, key):
    ssml = (f"<speak version='1.0' xml:lang='he-IL'><voice name='{voice}'>"
            f"<prosody rate='{rate}'>{escape(text)}</prosody></voice></speak>")
    req = urllib.request.Request(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        data=ssml.encode("utf-8"), method="POST",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm",
                 "User-Agent": "shuknadlan-marketing-video"})
    raw = out_wav + ".raw.wav"
    with urllib.request.urlopen(req, timeout=60) as r, open(raw, "wb") as f:
        f.write(r.read())
    # trim the silence Azure leaves at both ends, keep 40 ms of air
    trim = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,"
            "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", trim, out_wav], check=True)
    os.remove(raw)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", out_wav], capture_output=True, text=True, check=True)
    return round(float(dur.stdout.strip()), 3)


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    lines_path, out_dir = args[0], args[1]
    voice = args[args.index("--voice") + 1] if "--voice" in args else "he-IL-HilaNeural"
    rate = args[args.index("--rate") + 1] if "--rate" in args else "+8%"
    region = os.environ.get("AZURE_SPEECH_REGION", "westeurope")
    key = os.environ.get("AZURE_SPEECH_KEY", "proxy-injected")
    with open(lines_path) as fh:
        lines = json.load(fh)
    assets = os.path.join(out_dir, "assets")
    os.makedirs(assets, exist_ok=True)
    out = {}
    for ln in lines:
        rel = f"assets/vo-{ln['id']}.wav"
        dur = tts(ln.get("tts") or ln["text"], os.path.join(out_dir, rel), voice, rate, region, key)
        out[ln["id"]] = {"key": rel, "durationSec": dur, "voiceId": f"azure:{voice}",
                         "text": ln["text"], "words": []}
        print(f"{ln['id']:10s} {dur:5.2f}s  {ln['text']}")
    with open(os.path.join(assets, "voiceovers.json"), "w") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print("wrote", os.path.join(assets, "voiceovers.json"))


if __name__ == "__main__":
    main()
