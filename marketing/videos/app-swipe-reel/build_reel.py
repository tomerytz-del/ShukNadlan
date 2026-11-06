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
        python3 build_reel.py out.mp4 [voiceover.wav]

The optional voiceover is one file with the lines in order (see README);
when given, it is mixed in as the audio track as-is. The recordings and the
font are not in git.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = os.path.dirname(os.path.abspath(__file__))
UP = os.environ.get("REEL_SRC", os.path.expanduser("~/reel-src"))
C1 = f"{UP}/9b1dbefc-Screen_Recording_20261106_222921_Chrome_1.mp4"  # swipe, AI staging, Gabriela popup
C2 = f"{UP}/70e9db2e-Screen_Recording_20261106_223037_Chrome_1.mp4"  # home, list, map
C3 = f"{UP}/e03111b7-Screen_Recording_20261106_224703_Chrome.mp4"    # fast swiping
C4 = f"{UP}/0dd801bf-Screen_Recording_20261106_224943_Chrome.mp4"    # property page, calculator, visit form
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

# One entry per voice-over line. A shot is (src, in, out, speed, crop_y);
# a line may span two shots. gold = which caption line gets the gold pill.
LINES = [
    dict(vo="לא עוד עשרים טאבים של משרדים.",
         caption=["לא עוד 20 טאבים", "של משרדים"], gold=None,
         shots=[(C2, 1.0, 3.6, 1.0, 200)]),
    dict(vo="כל הנכסים של עפולה והעמק, בחיפוש אחד.",
         caption=["כל הנכסים של עפולה והעמק", "בחיפוש אחד"], gold=1,
         shots=[(C2, 4.8, 9.4, 1.6, 480)]),
    dict(vo="מחפשים דירה כמו שגוללים בטלפון?",
         caption=["מחפשים דירה", "כמו שגוללים בטלפון?"], gold=None,
         shots=[(C3, 0.0, 7.0, 3.0, 200)]),
    dict(vo="ימינה שומרים, שמאלה מדלגים.",
         caption=["ימינה שומרים", "שמאלה מדלגים"], gold=0,
         shots=[(C1, 17.0, 18.9, 1.0, 460), (C3, 5.5, 6.4, 1.0, 200)]),
    dict(vo="שמרתם שלושה? גבריאלה כבר מציעה לתאם ביקור.",
         caption=["שמרתם 3?", "גבריאלה מציעה לתאם ביקור"], gold=None,
         shots=[(C1, 19.3, 22.3, 1.0, 460)]),
    dict(vo="רוצים לראות איך זה ייראה אחרי שיפוץ? הדמיית AI.",
         caption=["איך זה ייראה אחרי שיפוץ?", "הדמיית AI"], gold=1,
         shots=[(C1, 8.0, 14.0, 2.0, 400)]),
    dict(vo="וכמה מזומן צריך להביא? המחשבון בתוך הדף.",
         caption=["כמה מזומן צריך להביא?", "המחשבון בתוך הדף"], gold=None,
         shots=[(C4, 19.6, 26.0, 2.1, 400)]),
]
END = dict(vo="חדש באתר: מחליקים על דירות בעפולה והעמק. הקישור בביו.", dur=3.8)


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
    out = sys.argv[1] if len(sys.argv) > 1 else f"{S}/reel.mp4"
    vo = sys.argv[2] if len(sys.argv) > 2 else None
    cap_dir = os.path.join(os.path.dirname(out) or ".", "cap")
    os.makedirs(cap_dir, exist_ok=True)
    end_png = f"{cap_dir}/end.png"
    end_card(end_png)

    inputs, fc = [], []
    n_in = lambda: inputs.count("-i")
    seg_labels, caps, timeline, t = [], [], [], 0.0
    for li, line in enumerate(LINES):
        start = t
        for src, a, b, sp, cy in line["shots"]:
            k = len(seg_labels)
            idx = n_in()
            inputs += ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", src]
            fc.append(f"[{idx}:v]scale=1080:-2,crop=1080:{CROP_H}:0:{cy},setpts=PTS/{sp},"
                      f"fps={FPS},pad={W}:{H}:0:{CROP_TOP}:color=#0c2258,setsar=1[v{k}]")
            seg_labels.append(f"[v{k}]")
            t += (b - a) / sp
        png = f"{cap_dir}/cap{li}.png"
        caption_png(line["caption"], png, gold=line["gold"])
        caps.append((li, start, t - start, png))
        timeline.append({"line": li, "start": round(start, 2), "end": round(t, 2), "vo": line["vo"]})
    idx = n_in()
    inputs += ["-loop", "1", "-t", f"{END['dur']}", "-i", end_png]
    fc.append(f"[{idx}:v]fps={FPS},format=yuv420p,setsar=1[vend]")
    timeline.append({"line": "end", "start": round(t, 2), "end": round(t + END["dur"], 2), "vo": END["vo"]})
    total = t + END["dur"]
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

    if vo:
        a_idx = n_in()
        inputs += ["-i", vo]
        amap = f"{a_idx}:a"
    else:
        a_idx = n_in()
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        amap = f"{a_idx}:a"

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
           "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", amap,
           "-t", f"{total:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "128k",
           "-movflags", "+faststart", out]
    with open(os.path.join(os.path.dirname(out) or ".", "timeline.json"), "w") as fh:
        json.dump(timeline, fh, ensure_ascii=False, indent=1)
    print("total", round(total, 2), "s")
    subprocess.run(cmd, check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
