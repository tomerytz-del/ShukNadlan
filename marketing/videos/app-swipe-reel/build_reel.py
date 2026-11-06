#!/usr/bin/env python3
"""Rough cut of the app reel from the four screen recordings.

Shots: (source, in, out, speed, crop_y, caption lines)
Canvas 1080x1920 @30fps. Each shot: trim, speed, crop 1080x1700 from the
phone recording, placed at y=110. Captions rendered with PIL (raqm, RTL)
as PNGs and overlaid with a short fade-in.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = os.path.dirname(os.path.abspath(__file__))
UP = os.environ.get("REEL_SRC", os.path.expanduser("~/reel-src"))  # the four screen recordings, not in git
C1 = f"{UP}/9b1dbefc-Screen_Recording_20261106_222921_Chrome_1.mp4"  # swipe, AI staging, Gabriela popup
C2 = f"{UP}/70e9db2e-Screen_Recording_20261106_223037_Chrome_1.mp4"  # home, list, map
C3 = f"{UP}/e03111b7-Screen_Recording_20261106_224703_Chrome.mp4"    # fast swiping
C4 = f"{UP}/0dd801bf-Screen_Recording_20261106_224943_Chrome.mp4"    # property page, calculator, visit form
LOGO = os.path.join(os.path.dirname(S), "..", "..", "assets", "logo-shuknadlan.png")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
if os.path.exists(f"{S}/fonts/Heebo-Bold.ttf"):
    FONT = f"{S}/fonts/Heebo-Bold.ttf"

W, H, FPS = 1080, 1920, 30
CROP_H = 1700
CROP_TOP = 110  # where the phone crop sits on the canvas
NAVY = (14, 42, 107)
NAVY_DARK = (8, 25, 74)
GOLD = (201, 162, 39)
WHITE = (255, 255, 255)

# (src, in, out, speed, crop_y, [caption lines], caption_pos)
# caption_pos: 'top' or 'bottom'
SHOTS = [
    (C2, 1.2, 2.3, 1.0, 200, ["כל הנכסים", "בעפולה והעמק"], "top"),
    (C2, 4.8, 8.8, 2.0, 480, ["על מפה אחת"], "top"),
    (C2, 12.6, 14.4, 1.5, 480, ["לוחצים. רואים."], "top"),
    (C3, 0.0, 10.5, 3.0, 200, ["גולשים בהחלקה"], "top"),
    (C1, 17.0, 18.8, 1.0, 460, ["אהבתם? שומרים"], "top"),
    (C1, 19.3, 21.9, 1.0, 460, ["גבריאלה כבר מציעה", "לתאם ביקור"], "top"),
    (C1, 8.0, 14.0, 2.0, 400, ["איך זה ייראה אחרי שיפוץ?", "הדמיית AI"], "top"),
    (C4, 7.6, 9.6, 1.0, 300, ["כל הפרטים בדף אחד"], "top"),
    (C4, 19.6, 26.6, 2.0, 400, ["כמה מזומן צריך להביא?", "מחשבון בתוך הדף"], "top"),
    (C4, 17.8, 19.8, 1.0, 300, ["תיאום ביקור בלחיצה"], "top"),
]
END_DUR = 3.2


def font(size):
    return ImageFont.truetype(FONT, size)


def caption_png(lines, path, gold_last=False):
    """Rounded navy pill(s), white bold RTL text, one pill per line."""
    size = 92 if max(len(l) for l in lines) <= 14 else 74
    f = font(size)
    pad_x, pad_y, gap = 44, 22, 18
    img = Image.new("RGBA", (W, 420), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    y = 20
    for i, line in enumerate(lines):
        bb = d.textbbox((0, 0), line, font=f, direction="rtl", language="he")
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        bw, bh = tw + 2 * pad_x, th + 2 * pad_y
        x0 = (W - bw) // 2
        fill = GOLD if (gold_last and i == len(lines) - 1) else NAVY
        d.rounded_rectangle([x0, y, x0 + bw, y + bh], radius=28, fill=fill + (235,))
        color = NAVY_DARK if fill == GOLD else WHITE
        d.text((x0 + pad_x - bb[0], y + pad_y - bb[1]), line, font=f, fill=color,
               direction="rtl", language="he")
        y += bh + gap
    img = img.crop((0, 0, W, y + 10))
    # soft shadow
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.paste((0, 0, 0, 110), (0, 0, img.size[0], img.size[1]), img.split()[3])
    sh = sh.filter(ImageFilter.GaussianBlur(10))
    out = Image.alpha_composite(sh, img)
    out.save(path)
    return out.size


def end_card(path):
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    # vertical gradient navy -> dark
    for y in range(H):
        t = y / H
        c = tuple(int(NAVY[i] * (1 - t) + NAVY_DARK[i] * t) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    logo = Image.open(LOGO).convert("RGBA")
    lw = 420
    logo = logo.resize((lw, int(logo.size[1] * lw / logo.size[0])))
    img.paste(logo, ((W - lw) // 2, 520), logo)
    f1, f2, f3 = font(84), font(60), font(56)
    y = 520 + logo.size[1] + 70
    for line, f, col in [("כל הנכסים בעפולה והעמק", f1, WHITE),
                         ("במקום אחד", f1, GOLD),
                         ("shuknadlan.co.il", f3, WHITE)]:
        bb = d.textbbox((0, 0), line, font=f, direction="rtl", language="he")
        tw = bb[2] - bb[0]
        d.text(((W - tw) // 2 - bb[0], y), line, font=f, fill=col, direction="rtl", language="he")
        y += (bb[3] - bb[1]) + 40
        if col == GOLD:
            y += 30
    img.save(path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else f"{S}/reel_draft.mp4"
    os.makedirs(f"{S}/cap", exist_ok=True)
    end_png = f"{S}/cap/end.png"
    end_card(end_png)

    inputs, fc, t = [], [], 0.0
    cap_inputs = []  # (index, start, dur, png)
    timeline = []
    for k, (src, a, b, sp, cy, lines, pos) in enumerate(SHOTS):
        dur = (b - a) / sp
        idx = inputs.count("-i")
        inputs += ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", src]
        # scale width to 1080 (clip 3 is 1076 wide), crop the phone content, speed, fps
        fc.append(
            f"[{idx}:v]scale=1080:-2,crop=1080:{CROP_H}:0:{cy},setpts=PTS/{sp},"
            f"fps={FPS},pad={W}:{H}:0:{CROP_TOP}:color=#0e2a6b,setsar=1[v{k}]"
        )
        png = f"{S}/cap/cap{k}.png"
        caption_png(lines, png, gold_last=(len(lines) > 1 and k in (0, 6, 8)))
        cap_inputs.append((k, t, dur, png))
        timeline.append({"shot": k, "start": round(t, 2), "dur": round(dur, 2), "caption": lines})
        t += dur
    # end card
    idx = inputs.count("-i")
    inputs += ["-loop", "1", "-t", f"{END_DUR}", "-i", end_png]
    fc.append(f"[{idx}:v]fps={FPS},format=yuv420p,setsar=1[vend]")
    total = t + END_DUR

    chain = "".join(f"[v{k}]" for k in range(len(SHOTS))) + "[vend]"
    fc.append(f"{chain}concat=n={len(SHOTS) + 1}:v=1:a=0[base]")

    # captions: looped png, fade in, delayed, overlaid
    cur = "[base]"
    for k, start, dur, png in cap_inputs:
        idx = inputs.count("-i")
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", png]
        y = 150 if True else 0
        fc.append(
            f"[{idx}:v]format=rgba,fps={FPS},fade=t=in:st=0:d=0.18:alpha=1,"
            f"setpts=PTS+{start:.3f}/TB[c{k}]"
        )
        fc.append(f"{cur}[c{k}]overlay=x=0:y={y}:eof_action=pass[o{k}]")
        cur = f"[o{k}]"
    # silent audio so platforms that expect a track are happy
    fc.append("anullsrc=r=48000:cl=stereo[a]")
    fc.append(f"{cur}format=yuv420p[vout]")

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
           "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
           "-filter_complex", ";".join(f for f in fc if not f.startswith("anullsrc")),
           "-map", "[vout]", "-map", f"{inputs.count('-i')}:a",
           "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "96k",
           "-movflags", "+faststart", out]
    json.dump(timeline, open(f"{S}/timeline.json", "w"), ensure_ascii=False, indent=1)
    print("total", round(total, 2), "s")
    subprocess.run(cmd, check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
