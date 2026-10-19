# remix.py <proj>: rebuild the soundtrack from out/sounds.json and mux it over out/video.mp4 -> out/video.fixed.mp4.
# `reelkit render --chunk` (0.19.1) joins the audio of the pieces out of place: lines land in other scenes or vanish.
import json, subprocess, sys
proj = sys.argv[1]
snd = json.load(open(f"{proj}/out/sounds.json"))
total = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",f"{proj}/out/video.mp4"]))
inputs, filt, labels = [], [], []
for i, s in enumerate(snd):
    path = f"{proj}/{s['path']}"
    music = "/music-" in s["path"] or s["path"].endswith("track.mp3")
    if music: inputs += ["-stream_loop", "-1"]
    inputs += ["-i", path]
    dur = max(0.01, s["end"] - s["start"])
    vol = s["volume"]
    chain = f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,volume={vol}"
    if music: chain += f",afade=t=in:d=0.5,afade=t=out:st={max(0,dur-1):.3f}:d=1"
    chain += f",adelay={int(s['start']*1000)}|{int(s['start']*1000)}[a{i}]"
    filt.append(chain); labels.append(f"[a{i}]")
filt.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,atrim=0:{total:.3f},loudnorm=I=-14:TP=-1:LRA=9[out]")
cmd = ["ffmpeg","-y","-loglevel","error"] + inputs + ["-i", f"{proj}/out/video.mp4", "-filter_complex", ";".join(filt), "-map", f"{len(snd)}:v", "-map", "[out]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f"{proj}/out/video.fixed.mp4"]
subprocess.run(cmd, check=True)
print("ok", proj, len(snd), "sounds")
