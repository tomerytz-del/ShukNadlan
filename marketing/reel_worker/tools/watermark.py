#!/usr/bin/env python3
"""Reusable watermark pipeline for Shuk Nadlan FB post images.

Modes
  photo : overlay a corner logo on any photo (Pillow).
      watermark.py photo --logo LOGO --in IN.jpg --out OUT.jpg
          [--corner bl|br|tl|tr] [--width-pct 12  (% of shorter side)] [--opacity 0.85] [--stroke 4] [--glow 5]
          [--center-opacity 0] [--center-width-pct 45]
  ad    : re-render an ad HTML template (headless Chrome); the text brand mark
          '<div class="brand">shuknadlan.co.il</div>' is replaced by an absolutely
          positioned bottom-left lockup: logo + domain (+ optional wordmark).
      watermark.py ad --logo LOGO --html TEMPLATE.html --assets DIR --out OUT.jpg
          [--width-pct 10] [--opacity 0.85] [--wordmark "שוק הנדל״ן"] [--mint-line 1]
          [--stroke 4] [--glow 5]
          [--domain shuknadlan.co.il] [--center-opacity 0] [--margin 56] [--margin-bottom 18]
          [--agent-name NAME --agency-name AGENCY --agency-logo FILE]  (broker card, top-left)
      DIR must contain the files the template references (e.g. hero.jpg).

LOGO may be PNG (transparency preferred), JPG, WEBP or SVG (SVG is
rasterized with headless Chrome on a transparent background).
"""
import argparse, base64, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageFilter

CHROME = shutil.which("google-chrome") or shutil.which("chromium") or "google-chrome"


def chrome_shot(html_path, out_png, w, h, transparent=False):
    cmd = [CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
           f"--window-size={w},{h}", f"--screenshot={out_png}"]
    if transparent:
        cmd.append("--default-background-color=00000000")
    cmd.append("file://" + os.path.abspath(html_path))
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)


def load_logo(path, px=1024):
    """Return an RGBA PIL image of the logo, trimmed to its visible bounds."""
    if path.lower().endswith(".svg"):
        tmp = tempfile.mkdtemp()
        svg = open(path, "rb").read()
        uri = "data:image/svg+xml;base64," + base64.b64encode(svg).decode()
        html = os.path.join(tmp, "l.html")
        open(html, "w").write(f'<html><body style="margin:0;background:transparent">'
                              f'<img src="{uri}" style="width:{px}px;height:{px}px;object-fit:contain"></body></html>')
        png = os.path.join(tmp, "l.png")
        chrome_shot(html, png, px, px, transparent=True)
        im = Image.open(png).convert("RGBA")
    else:
        im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").getbbox()
    return im.crop(bb) if bb else im


def outlined(logo, target_w, stroke=4, glow=6, color=(255, 255, 255)):
    """Resize logo to target_w and add a light outline (+ soft glow) following
    its alpha shape. Returns an RGBA image padded by stroke+glow on every side."""
    lh = round(logo.height * target_w / logo.width)
    lg = logo.resize((target_w, lh), Image.LANCZOS)
    pad = stroke + glow * 2
    canvas = Image.new("RGBA", (target_w + 2 * pad, lh + 2 * pad), (0, 0, 0, 0))
    a = Image.new("L", canvas.size, 0); a.paste(lg.getchannel("A"), (pad, pad))
    a = a.point(lambda v: 255 if v > 90 else 0)
    if stroke > 0:
        ring = a.filter(ImageFilter.MaxFilter(stroke * 2 + 1)).filter(ImageFilter.GaussianBlur(0.8))
        canvas.alpha_composite(Image.merge("RGBA", (*[Image.new("L", canvas.size, c) for c in color],
                                                     ring.point(lambda v: int(v * .92)))))
    if glow > 0:
        g = a.filter(ImageFilter.MaxFilter(stroke * 2 + 1)).filter(ImageFilter.GaussianBlur(glow))
        gl = Image.merge("RGBA", (*[Image.new("L", canvas.size, c) for c in color], g.point(lambda v: int(v * .45))))
        base = Image.new("RGBA", canvas.size, (0, 0, 0, 0)); base.alpha_composite(gl); base.alpha_composite(canvas)
        canvas = base
    canvas.alpha_composite(lg, (pad, pad))
    return canvas, pad


def with_opacity(im, op):
    a = im.getchannel("A").point(lambda v: int(v * op))
    im = im.copy(); im.putalpha(a); return im


def photo(args):
    base = Image.open(args.inp).convert("RGBA")
    W, H = base.size
    logo = load_logo(args.logo)
    lw = int(min(W, H) * args.width_pct / 100)
    if args.center_opacity > 0:
        cw = int(W * args.center_width_pct / 100); ch = int(logo.height * cw / logo.width)
        c = with_opacity(logo.resize((cw, ch), Image.LANCZOS), args.center_opacity)
        base.alpha_composite(c, ((W - cw) // 2, (H - ch) // 2))
    k = lw / 132  # scale stroke with logo size (defaults tuned for 132px)
    lg, pad = outlined(logo, lw, stroke=max(0, round(args.stroke * k)), glow=max(0, round(args.glow * k)))
    m = int(min(W, H) * 0.035)
    x = (m if args.corner[1] == "l" else W - lw - m) - pad
    y = (m if args.corner[0] == "t" else H - (lg.height - 2 * pad) - m) - pad
    sh = Image.new("RGBA", lg.size, (0, 0, 0, 0)); sh.putalpha(lg.getchannel("A").point(lambda v: int(v * .35)))
    sh = sh.filter(ImageFilter.GaussianBlur(max(2, lw // 30)))
    base.alpha_composite(sh, (x + 2, y + 4))
    base.alpha_composite(with_opacity(lg, args.opacity), (x, y))
    base.convert("RGB").save(args.out, quality=92)
    print("wrote", args.out, base.size)


def esc(t):
    return (t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def agent_card(args, tmp):
    """Handling-broker block, top-left under the listing-number tag: white rounded
    card with the agency logo (if any) + agent name + agency name (Hebrew, RTL).
    Without a logo it shows the names only."""
    name, agency = (args.agent_name or "").strip(), (args.agency_name or "").strip()
    if not (name or agency or args.agency_logo):
        return "", ""
    img = ""
    if args.agency_logo and os.path.exists(args.agency_logo):
        try:
            lg = Image.open(args.agency_logo).convert("RGBA")
            # trim flat white/transparent margins so the logo fills its slot
            bg = Image.new("RGBA", lg.size, (255, 255, 255, 255)); bg.alpha_composite(lg)
            gray = bg.convert("L").point(lambda v: 255 if v < 240 else 0)
            bb = gray.getbbox()
            if bb:
                bg = bg.crop(bb)
            bg.convert("RGB").save(os.path.join(tmp, "agency_logo.png"))
            img = '<img class="aglogo" src="agency_logo.png">'
        except Exception as e:  # unreadable logo -> names only
            print("agency logo skipped:", e, file=sys.stderr)
    lines = ""
    if name:
        lines += f'<div class="agn">{esc(name)}</div>'
    if agency and agency != name:
        lines += f'<div class="aga">{esc(agency)}</div>'
    badge = ""   # ethics badge removed for all agents (owner rule 2026-10-24); --badge is ignored
    html = (f'<div class="agcard{" hasbadge" if badge else ""}">' + img + (f'<div class="agt">{lines}</div>' if lines else '') + badge + '</div>')
    css = ('.agcard{position:absolute;top:%dpx;left:48px;display:flex;align-items:center;gap:16px;direction:ltr;'
           'background:rgba(255,255,255,.94);border-radius:16px;padding:12px 18px;box-shadow:0 6px 20px rgba(0,0,0,.25);'
           'max-width:660px;z-index:6}'
           '.agcard .agbadge{height:72px;width:72px;object-fit:contain;display:block}'
           '.agcard.hasbadge .aglogo{height:60px;max-width:150px}'
           '.agcard .aglogo{height:84px;max-width:200px;object-fit:contain;display:block;border-radius:8px}'
           '.agcard .agt{direction:rtl;text-align:right;color:#0f3b33;font-family:Rubik,sans-serif;min-width:0}'
           '.agcard .agn{font-size:32px;font-weight:700;line-height:1.15;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;max-width:420px}'  # full name, never truncated (wraps)
           '.agcard .aga{font-size:24px;font-weight:500;line-height:1.2;opacity:.8;margin-top:4px;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;max-width:420px}'
           % args.agent_top)
    return html, css


def ad(args):
    """Re-render the ad template with an absolutely-positioned logo lockup at
    bottom-left (so the rest of the layout stays pixel-identical). The original
    text brand mark is removed and re-drawn beside the logo."""
    tpl = open(args.html, encoding="utf-8").read()
    marker = '<div class="brand">shuknadlan.co.il</div>'
    if marker not in tpl:
        sys.exit("brand marker not found in template")
    tmp = tempfile.mkdtemp(dir=args.assets)  # inside assets dir; template refs resolve via ../
    logo = load_logo(args.logo)
    W = 1200
    lw = int(W * args.width_pct / 100)
    lg, pad = outlined(logo, lw, stroke=args.stroke, glow=args.glow)
    lg.save(os.path.join(tmp, "logo.png"))
    logo.save(os.path.join(tmp, "logo_plain.png"))
    txt = ""
    if args.wordmark:
        txt += f'<div class="bw">{args.wordmark}</div>'
    if args.domain:
        txt += f'<div class="bd">{args.domain}</div>'
    lock = (f'<div class="wmlock"><img src="logo.png" style="width:{lg.width}px;height:auto;display:block;'
            f'margin:-{pad}px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35))">'
            + (f'<div class="bt">{txt}</div>' if txt else '') + '</div>')
    css = (f'.wmlock{{position:absolute;left:{args.margin}px;bottom:{args.margin_bottom}px;display:flex;'
           f'align-items:center;gap:18px;direction:ltr;opacity:{args.opacity};z-index:5;color:#fff}}'
           f'.wmlock .bt{{direction:rtl;text-align:right;margin-left:{pad}px}}'
           f'.wmlock .bw{{font-family:Rubik,sans-serif;font-weight:800;font-size:40px;line-height:1.05;color:#fff;direction:rtl;text-shadow:0 2px 6px rgba(0,0,0,.35)}}'
           f'.wmlock .bd{{font-family:Rubik,sans-serif;font-size:22px;font-weight:500;direction:ltr;text-align:right;'
           f'color:rgba(255,255,255,.88);margin-top:8px;padding-top:6px;'
           f'border-top:{"2px solid #9be3c9" if args.mint_line else "0"}}}'
           f'.cwm{{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);'
           f'width:{int(W*.42)}px;opacity:{args.center_opacity};pointer-events:none}}')
    agent_html, agent_css = agent_card(args, tmp)
    css += agent_css
    lock += agent_html
    html = tpl.replace(marker, '<div class="brand"></div>')
    html = html.replace("</style>", css + "</style>")
    html = html.replace("url(hero.jpg)", "url(../hero.jpg)")
    if args.center_opacity > 0:
        html = html.replace('<div class="band">', '<img class="cwm" src="logo_plain.png"><div class="band">', 1)
    html = html.replace("</div></body>", lock + "</div></body>", 1)
    hp = os.path.join(tmp, "ad.html"); open(hp, "w", encoding="utf-8").write(html)
    png = os.path.join(tmp, "ad.png")
    chrome_shot(hp, png, 1200, 1500)
    Image.open(png).convert("RGB").save(args.out, quality=92)
    shutil.rmtree(tmp)
    print("wrote", args.out)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="mode", required=True)
    a = sp.add_parser("photo"); a.add_argument("--logo", required=True); a.add_argument("--in", dest="inp", required=True)
    a.add_argument("--out", required=True); a.add_argument("--corner", default="bl", choices=["bl", "br", "tl", "tr"])
    a.add_argument("--width-pct", type=float, default=12); a.add_argument("--opacity", type=float, default=0.85)
    a.add_argument("--stroke", type=int, default=4); a.add_argument("--glow", type=int, default=5)
    a.add_argument("--center-opacity", type=float, default=0); a.add_argument("--center-width-pct", type=float, default=45)
    b = sp.add_parser("ad"); b.add_argument("--logo", required=True); b.add_argument("--html", required=True)
    b.add_argument("--assets", required=True); b.add_argument("--out", required=True)
    b.add_argument("--stroke", type=int, default=4); b.add_argument("--glow", type=int, default=5)
    b.add_argument("--width-pct", type=float, default=10); b.add_argument("--opacity", type=float, default=0.85)
    b.add_argument("--wordmark", default="שוק הנדל״ן")
    b.add_argument("--mint-line", type=int, default=1); b.add_argument("--domain", default="shuknadlan.co.il")
    b.add_argument("--center-opacity", type=float, default=0)
    b.add_argument("--margin", type=int, default=56); b.add_argument("--margin-bottom", type=int, default=18)
    b.add_argument("--agent-name", default=""); b.add_argument("--agency-name", default="")
    b.add_argument("--agency-logo", default="", help="local image file (png/jpg/webp)")
    b.add_argument("--badge", default="", help="DEPRECATED, ignored: no ethics badge on any ad (owner rule 2026-10-24)")
    b.add_argument("--agent-top", type=int, default=136, help="top px of the agent card (left column, under the number tag)")
    args = p.parse_args()
    photo(args) if args.mode == "photo" else ad(args)


if __name__ == "__main__":
    main()
