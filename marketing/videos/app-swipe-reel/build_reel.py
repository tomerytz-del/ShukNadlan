#!/usr/bin/env python3
"""The swipe reel, cut from four real screen recordings of the site.

Story (docs/reels-playbook.md): problem -> discovery -> solution -> CTA.
Each shot is one voice-over line; the caption is the short form of the line.
Canvas 1080x1920 @30fps. Each shot: trim, speed, crop 1080x1700 from the
phone recording, placed at y=110. Captions rendered with PIL (raqm, RTL)
as PNGs and overlaid with a short fade-in, in the top third only: the
bottom 35% stays clean (Instagram UI, and the playbook rule).

Usage:
    REEL_SRC=<dir with the 4 recordings> REEL_FONT=<Heebo-Bold.ttf> \
        python3 build_reel.py out.mp4 [--vo voiceovers.json] [--music track.mp3] [--sfx assets/lib]

--vo is Reelkit's assets/voiceovers.json (one file per scene, scene ids =
LINES[i]["id"]): each shot is then stretched or trimmed to its line (speed
within +-20%, a frozen last frame beyond that) and the lines are laid on the
timeline. --music is looped under the voice, ducked. --sfx is Reelkit's
assets/lib with the four sounds in SFX (pulled with `reelkit assets pull`):
a soft whoosh on every cut, and the cues each line lists. Without --vo the
shots keep their planned length and the track is silent. The recordings, the font,
the voice files and the music are not in git.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = os.path.dirname(os.path.abspath(__file__))
UP = os.environ.get("REEL_SRC", os.path.expanduser("~/reel-src"))
C1 = f"{UP}/9b1dbefc-Screen_Recording_20261106_222921_Chrome_1.mp4"  # swipe, AI staging, Gabriela popup
C2 = f"{UP}/70e9db2e-Screen_Recording_20261106_223037_Chrome_1.mp4"  # home, list, map
C3 = f"{UP}/e03111b7-Screen_Recording_20261106_224703_Chrome.mp4"    # fast swiping
C4 = f"{UP}/0dd801bf-Screen_Recording_20261106_224943_Chrome.mp4"    # property page, calculator, visit form
HK = f"{UP}/43824f23-20261105_163348.mp4"  # the hook: the platform's street sign in Afula, filmed from a window (5.11.2026)
LOGO = os.path.normpath(os.path.join(S, "..", "..", "..", "assets", "logo-shuknadlan.png"))
FONT = os.environ.get("REEL_FONT") or "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

W, H, FPS = 1080, 1920, 30
CROP_H = 1700
CROP_TOP = 110          # where the phone crop sits on the canvas
CAPTION_Y = 150         # captions live in the top third
TEXT_FLOOR = int(H * 0.65)  # nothing textual below this line (bottom 35% clean)
NAVY = (12, 34, 88)     # #0c2258
NAVY_DARK = (7, 20, 56)
GOLD = (230, 194, 126)  # #e6c27e
WHITE = (255, 255, 255)

# One entry per voice-over line. A shot is (src, in, out, speed, crop_y[, opts]);
# a line may span two shots. gold = which caption line gets the gold pill.
# opts: full=True for 9:16 footage shown whole (no phone crop); zoom=1.2 and
# focus=(fx, fy) for a slow push-in toward that point; ambience=gain keeps the
# clip's own sound under the voice; cut="whip" for the sound on the cut into it.
LINES = [
    dict(id="hook", vo="ראיתם את השלט הזה בעפולה? זה מה שמסתתר מאחוריו.",
         caption=["ראיתם את השלט הזה?", "זה מה שמאחוריו"], gold=None,
         shots=[(HK, 2.5, 5.3, 1.3, 0, dict(full=True, zoom=1.22, focus=(0.42, 0.5), ambience=0.6)),
                (C2, 0.6, 2.6, 1.0, 200, dict(cut="whip"))]),  # the sign, then the real home page
    dict(id="all", vo="כל הנכסים של עפולה והעמק, בחיפוש אחד.",
         caption=["כל הנכסים של עפולה והעמק", "בחיפוש אחד"], gold=1,
         shots=[(C2, 4.6, 10.6, 1.6, 480)]),
    dict(id="swipe", vo="מחפשים דירה כמו שגוללים בטלפון?",
         caption=["מחפשים דירה", "כמו שגוללים בטלפון?"], gold=None,
         shots=[(C3, 0.0, 9.4, 3.0, 200)],
         sfx=[(0.5, "whoosh"), (1.1, "whoosh"), (2.0, "whoosh"), (2.5, "whoosh")]),  # the swipes, at 3x
    dict(id="save", vo="ימינה שומרים, שמאלה מדלגים.",
         caption=["ימינה שומרים", "שמאלה מדלגים"], gold=0,
         shots=[(C1, 17.0, 18.9, 1.0, 460), (C3, 5.3, 6.5, 1.0, 200)],
         sfx=[(1.5, "pop"), (2.6, "pop")]),  # the "שמירה" stamp, then the "דילוג" stamp
    dict(id="gabriela", vo="שמרתם שלושה? גבריאלה כבר מציעה לתאם ביקור.",
         caption=["שמרתם 3?", "גבריאלה מציעה לתאם ביקור"], gold=None,
         shots=[(C1, 19.2, 23.3, 1.0, 460)],
         sfx=[(0.3, "ping")]),  # Gabriela's offer pops up
    dict(id="staging", vo="רוצים לראות איך זה ייראה אחרי שיפוץ? הדמיית AI.",
         caption=["איך זה ייראה אחרי שיפוץ?", "הדמיית AI"], gold=1,
         shots=[(C1, 8.0, 14.8, 1.5, 400)]),
    dict(id="cash", vo="וכמה מזומן צריך להביא? המחשבון בתוך הדף.",
         caption=["כמה מזומן צריך להביא?", "המחשבון בתוך הדף"], gold=None,
         shots=[(C4, 19.6, 27.6, 1.95, 400)]),
]
END = dict(id="cta", vo="חדש באתר: מחליקים על דירות בעפולה והעמק. הקישור בביו.", dur=3.8,
           sfx=[(0.0, "chime")])
VO_GAP = 0.25        # silence after each line before the next shot
MUSIC_GAIN = 0.07    # music about 13 dB under the voice (Reelkit lines are about -24 LUFS; the skill wants 10 to 22 dB)
STRETCH = (0.8, 1.25)  # speed change allowed to fit a line; beyond it, freeze or trim
# Voices that must never be heard in a platform video again (Tomer, 7.11.2026):
# Reelkit's only Hebrew voice "Daniel". A voiceovers.json recorded with it is refused.
BANNED_VOICES = {"HjnCa0x8VgfBjy158Gpj"}
# Sound effects by job (reference/sound-design in the reelkit skill: one sound per job,
# the same every time). Paths are inside --sfx (Reelkit's assets/lib). Gains sit the
# -16 LUFS library files under a -24 LUFS voice.
SFX = {
    "whoosh": ("sfx-ui-soft-whoosh/clip.mp3", 0.22),          # transition: every cut
    "pop": ("sfx-h0avxtjl0kfr/kt-pop-soft.wav", 0.32),         # engage: a stamp lands
    "ping": ("sfx-ui-notification-ping/clip.mp3", 0.30),       # Gabriela's message arrives
    "chime": ("sfx-ui-success-chime/clip.mp3", 0.25),          # payoff: the end card, under the last line
    "whip": ("sfx-k7eiyien0i35/kt-swipe-whip.wav", 0.40),      # attention: the cut from the street into the app
}


def font(size):
    return ImageFont.truetype(FONT, size)


def caption_png(lines, path, gold=None):
    """Rounded pills, one per line, white-on-navy or navy-on-gold, RTL."""
    size = 92 if max(len(l) for l in lines) <= 14 else 72
    f = font(size)
    pad_x, pad_y, gap = 44, 20, 16
    img = Image.new("RGBA", (W, 480), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 20
    for i, line in enumerate(lines):
        bb = d.textbbox((0, 0), line, font=f, direction="rtl", language="he")
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        bw, bh = tw + 2 * pad_x, th + 2 * pad_y
        x0 = (W - bw) // 2
        is_gold = (gold == i)
        fill = GOLD if is_gold else NAVY
        d.rounded_rectangle([x0, y, x0 + bw, y + bh], radius=28, fill=fill + (238,))
        d.text((x0 + pad_x - bb[0], y + pad_y - bb[1]), line, font=f,
               fill=NAVY_DARK if is_gold else WHITE, direction="rtl", language="he")
        y += bh + gap
    img = img.crop((0, 0, W, y + 10))
    assert CAPTION_Y + img.size[1] < TEXT_FLOOR, "caption reaches the clean bottom zone"
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 110), (0, 0, img.size[0], img.size[1]), img.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    Image.alpha_composite(sh, img).save(path)


def end_card(path):
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] * (1 - t) + NAVY_DARK[i] * t) for i in range(3)))
    logo = Image.open(LOGO).convert("RGBA")
    lw = 340
    logo = logo.resize((lw, int(logo.size[1] * lw / logo.size[0])))
    img.paste(logo, ((W - lw) // 2, 290), logo)
    y = 290 + logo.size[1] + 50
    for line, f, col in [("חדש: מחליקים על דירות", font(80), WHITE),
                         ("בעפולה והעמק", font(80), WHITE),
                         ("הקישור בביו", font(80), GOLD),
                         ("shuknadlan.co.il/swipe", font(52), WHITE)]:
        bb = d.textbbox((0, 0), line, font=f, direction="rtl", language="he")
        d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], y), line, font=f, fill=col,
               direction="rtl", language="he")
        y += (bb[3] - bb[1]) + 34
    assert y < TEXT_FLOOR, "end card text reaches the clean bottom zone"
    img.save(path)


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else f"{S}/reel.mp4"
    vo_json = args[args.index("--vo") + 1] if "--vo" in args else None
    music = args[args.index("--music") + 1] if "--music" in args else None
    sfx_dir = args[args.index("--sfx") + 1] if "--sfx" in args else None
    cues = []  # (time, job)
    cap_dir = os.path.join(os.path.dirname(out) or ".", "cap")
    os.makedirs(cap_dir, exist_ok=True)
    end_png = f"{cap_dir}/end.png"
    end_card(end_png)

    vo = {}
    if vo_json:
        with open(vo_json) as fh:
            raw = json.load(fh)
        project = os.path.dirname(os.path.dirname(os.path.abspath(vo_json)))  # keys are project-relative
        for sid, v in raw.items():
            if v.get("voiceId") in BANNED_VOICES:
                sys.exit(f"voice line '{sid}' was recorded with a banned voice ({v['voiceId']}); "
                         "change voiceId in the Reelkit plan and run reelkit assets voiceover --all --redo")
            vo[sid] = (os.path.join(project, v["key"]), float(v["durationSec"]))

    inputs, fc = [], []
    n_in = lambda: inputs.count("-i")
    seg_labels, caps, timeline, t = [], [], [], 0.0
    amb_labels, music_start = [], 0.0
    for li, line in enumerate(LINES):
        start = t
        shots = line["shots"]
        for off, job in line.get("sfx", []):
            cues.append((start + off, job))
        d0 = sum((sh[2] - sh[1]) / sh[3] for sh in shots)
        target = d0
        if line["id"] in vo:
            target = max(vo[line["id"]][1] + VO_GAP, 1.0)
        ratio = target / d0
        for shot in shots:
            src, a, b, sp, cy = shot[:5]
            opts = shot[5] if len(shot) > 5 else {}
            k = len(seg_labels)
            idx = n_in()
            inputs += ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", src]
            # fit the shot to its share of the line: slow down or speed up within STRETCH,
            # freeze the last frame or trim beyond it
            share = (b - a) / sp / d0 * target
            if t > 0:
                cues.append((t, opts.get("cut", "whoosh")))  # every cut
            sp2 = sp / max(min(ratio, STRETCH[1]), STRETCH[0]) if ratio != 1 else sp
            nat = (b - a) / sp2
            fit = f"tpad=stop_mode=clone:stop_duration={share - nat:.3f}," if nat < share - 0.01 else ""
            if opts.get("full"):
                n_frames = max(int(share * FPS), 1)
                z, (fx, fy) = opts.get("zoom", 1.0), opts.get("focus", (0.5, 0.5))
                push = (f"zoompan=z='1+({z}-1)*min(on/{n_frames},1)':x='iw*{fx}-(iw/zoom)*{fx}':"
                        f"y='ih*{fy}-(ih/zoom)*{fy}':d=1:s={W}x{H}:fps={FPS},") if z != 1.0 else ""
                fc.append(f"[{idx}:v]scale={W}:{H},setpts=PTS/{sp2:.4f},fps={FPS},{push}{fit}"
                          f"trim=duration={share:.3f},setpts=PTS-STARTPTS,setsar=1[v{k}]")
                if opts.get("ambience"):
                    ms = int(t * 1000)
                    fc.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                              f"atempo={sp2:.4f},atrim=duration={share:.3f},volume={opts['ambience']},"
                              f"afade=t=out:st={share - 0.35:.3f}:d=0.35,adelay={ms}|{ms}[amb{k}]")
                    amb_labels.append(f"[amb{k}]")
                    music_start = max(music_start, t + share)  # the music drops in on the cut out of the footage
            else:
                fc.append(f"[{idx}:v]scale=1080:-2,crop=1080:{CROP_H}:0:{cy},setpts=PTS/{sp2:.4f},"
                          f"fps={FPS},{fit}trim=duration={share:.3f},setpts=PTS-STARTPTS,"
                          f"pad={W}:{H}:0:{CROP_TOP}:color=#0c2258,setsar=1[v{k}]")
            seg_labels.append(f"[v{k}]")
            t += share
        png = f"{cap_dir}/cap{li}.png"
        caption_png(line["caption"], png, gold=line["gold"])
        caps.append((li, start, t - start, png))
        timeline.append({"line": line["id"], "start": round(start, 2), "end": round(t, 2), "vo": line["vo"]})
    end_dur = max(END["dur"], vo[END["id"]][1] + 0.6) if END["id"] in vo else END["dur"]
    idx = n_in()
    inputs += ["-loop", "1", "-t", f"{end_dur:.3f}", "-i", end_png]
    fc.append(f"[{idx}:v]fps={FPS},format=yuv420p,setsar=1[vend]")
    timeline.append({"line": END["id"], "start": round(t, 2), "end": round(t + end_dur, 2), "vo": END["vo"]})
    for off, job in END.get("sfx", []):
        cues.append((t + off, job))
    cues.append((t, "whoosh"))
    end_start, total = t, t + end_dur
    fc.append("".join(seg_labels) + f"[vend]concat=n={len(seg_labels) + 1}:v=1:a=0[base]")

    cur = "[base]"
    for li, start, dur, png in caps:
        idx = n_in()
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", png]
        fc.append(f"[{idx}:v]format=rgba,fps={FPS},fade=t=in:st=0:d=0.18:alpha=1,"
                  f"setpts=PTS+{start:.3f}/TB[c{li}]")
        fc.append(f"{cur}[c{li}]overlay=x=0:y={CAPTION_Y}:eof_action=pass[o{li}]")
        cur = f"[o{li}]"
    fc.append(f"{cur}format=yuv420p[vout]")

    # audio: each line at its start, music looped and ducked under it
    a_labels = []
    if vo:
        for entry in timeline:
            sid = entry["line"]
            if sid not in vo:
                continue
            idx = n_in()
            inputs += ["-i", vo[sid][0]]
            fc.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                      f"adelay={int(entry['start'] * 1000)}|{int(entry['start'] * 1000)}[a{sid}]")
            a_labels.append(f"[a{sid}]")
    if a_labels:
        fc.append("".join(a_labels) + f"amix=inputs={len(a_labels)}:normalize=0,"
                  f"apad=whole_dur={total:.3f}[voice]")
    if music:
        idx = n_in()
        inputs += ["-stream_loop", "-1", "-i", music]
        mlen = total - music_start
        mst = int(music_start * 1000)
        fc.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                  f"atrim=duration={mlen:.3f},volume={MUSIC_GAIN},"
                  f"afade=t=in:d=0.25,afade=t=out:st={mlen - 1.6:.3f}:d=1.6,adelay={mst}|{mst}[music]")
    s_labels = []
    if sfx_dir:
        for n, (when, job) in enumerate(sorted(cues)):
            rel, gain = SFX[job]
            idx = n_in()
            inputs += ["-i", os.path.join(sfx_dir, rel)]
            ms = int(when * 1000)
            fc.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
                      f"volume={gain},adelay={ms}|{ms}[s{n}]")
            s_labels.append(f"[s{n}]")
    if s_labels:
        fc.append("".join(s_labels) + f"amix=inputs={len(s_labels)}:normalize=0,"
                  f"apad=whole_dur={total:.3f},atrim=duration={total:.3f}[sfx]")
    if amb_labels:
        fc.append("".join(amb_labels) + (f"amix=inputs={len(amb_labels)}:normalize=0," if len(amb_labels) > 1 else "")
                  + f"apad=whole_dur={total:.3f},atrim=duration={total:.3f}[amb]")
    beds = [l for l, ok in (("[music]", bool(music)), ("[amb]", bool(amb_labels)), ("[sfx]", bool(s_labels)), ("[voice]", bool(a_labels))) if ok]
    if beds:
        fc.append("".join(beds) + (f"amix=inputs={len(beds)}:normalize=0:duration=first," if len(beds) > 1 else "")
                  + "loudnorm=I=-14:TP=-1.5:LRA=9[aout]")
    else:
        idx = n_in()
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        fc.append(f"[{idx}:a]atrim=duration={total:.3f}[aout]")

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
           "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
           "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "160k",
           "-movflags", "+faststart", out]
    with open(os.path.join(os.path.dirname(out) or ".", "timeline.json"), "w") as fh:
        json.dump(timeline, fh, ensure_ascii=False, indent=1)
    print("total", round(total, 2), "s")
    subprocess.run(cmd, check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
