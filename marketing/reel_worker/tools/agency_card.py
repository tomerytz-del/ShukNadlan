#!/usr/bin/env python3
"""Agency graphics for the regional Page / IG (Tomer 2026-10-26). Nothing here posts anything.

    agency_card.py story  <slug|name|--all> [--market afula-emek]   1080x1920 card for the IG highlight 'גם אנחנו בשוק הנדל״ן'
    agency_card.py post   <slug|name|--all> [--market afula-emek]   1080x1350 feed promo 'בואו לראות את הנכסים שלי בשוק הנדל״ן'
    agency_card.py list   [--market afula-emek]                       qualifying agencies (JSON)

Data (READ-ONLY): queue/agencies_<market>.json = result of tools/agency_query.sql (agencies + active agency_members:
display name, photo_url, show_photo_in_ads; has_listings flag + rank, NO counts). Agency page link only when the
agency's slug is listed in the site sitemap (queue/site_agency_slugs.json, pattern https://shuknadlan.co.il/agency?slug=<slug>).
Agent photos only with photo_url AND show_photo_in_ads not false; no photo -> name only (no initials circle).
Tomer's own agency (the agency of agency_members 2f552dcf-...) is excluded from the shuknadlan Pages (owner decision
2026-10-26). Exception (2026-10-27): `post <slug> --own-page` renders its promo for the agency's OWN Facebook Page
(נדל"ן עפולה): out/agencies/agency-page/<slug>_post.*. Since 2026-10-27 (v2, Tomer's clarified rule: his name + licence
MUST be on his own agency's material, only platform marketing / recruitment / other agents' listings stay without them)
the own-Page promo shows ALL the agency's agents incl. Tomer (photo + name) and carries his disclosure line
(Q.DEFAULT_DISCLOSURE) on the image and in the caption.
Story safe zones: nothing important above y 250 or below y 1580. Colours: brand navy + gold (post_image.py, social kit).
Output: out/agencies/<market>/<slug>_{story,post}.jpg (+ .json with link, highlight; post: fb/ig captions).
NO day-to-day numbers on any image or caption (owner rule 2026-10-26): no listing / sale / rent / commercial counts.
"""
import os as _os, sys as _sys
_sys.path[:] = [x for x in _sys.path if _os.path.abspath(x or ".") != _os.path.dirname(_os.path.abspath(__file__))]
import argparse, hashlib, importlib.util, json, os, re, sys, urllib.parse
from PIL import Image, ImageDraw, ImageFilter, ImageOps

TOOLS = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(TOOLS)
spec = importlib.util.spec_from_file_location("fbpostimage", os.path.join(TOOLS, "post_image.py"))
PI = importlib.util.module_from_spec(spec); spec.loader.exec_module(PI)
Q = PI.Q
OUT = os.path.join(ROOT, "out", "agencies")
SITE_AGENCY = "https://shuknadlan.co.il/agency?slug={}"
HEAD_STORY = "גם אנחנו בשוק הנדל״ן"
HEAD_POST = "בואו לראות את הנכסים שלי בשוק הנדל״ן"
# social kit tokens (social-kit/templates/common.css): sapphire, deep sapphire, brass, light brass
SAPH, SAPH_D, BRASS, BRASS_L = (14, 42, 107), (13, 27, 61), (201, 162, 39), (229, 199, 106)
WHITE, MUTED = (255, 255, 255), (176, 188, 216)
COUNT_KEYS = {"listings", "res_sale", "res_rent", "commercial", "count", "total"}   # dropped on load; never drawn


OWN_PAGE_HIDE = set()                  # v2 2026-10-27: Tomer is shown on his own agency's Page (was {Q.TOMER_AGENT_ID})
OWN_PAGE_SHOW_AGENTS = True            # v2 2026-10-27: own-Page promo shows the agency's agents (Tomer + טל אטדגי)
OWN_PAGE_DISCLOSURE = Q.DEFAULT_DISCLOSURE   # Tomer's name + licence, own agency material only (never the DB value alone)


def load_agencies(market, own=None):
    """Qualifying agencies of a market. Tomer's agency is excluded (shuknadlan Pages rule) unless `own` names it
    (slug / name / id): then ONLY that agency is returned, for its own Facebook Page (queue.py agency-page-next),
    with Tomer removed from the agents shown (OWN_PAGE_HIDE)."""
    path = os.path.join(Q.QDIR, f"agencies_{market}.json")
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("result"), str):      # raw MCP result
        rows = json.loads(re.search(r">\s*(\[.*\])\s*<", raw["result"], re.S).group(1)); raw = {"agencies": rows[0]["json_agg"]}
    ags = raw["agencies"]
    slugs = set((Q.load_json(os.path.join(Q.QDIR, "site_agency_slugs.json")) or {}).get("slugs", []))
    out, excluded = [], []
    for a in ags:
        if own is not None:
            if own not in (a.get("slug"), a.get("name"), a.get("id")):
                continue
            a = dict(a, _own_page=True, members=[m for m in a.get("members") or [] if m.get("id") not in OWN_PAGE_HIDE]
                     if OWN_PAGE_SHOW_AGENTS else [])
        elif any(m.get("id") == Q.TOMER_AGENT_ID for m in a.get("members") or []):
            excluded.append(a["name"]); continue                       # Tomer's agency: excluded on the shuknadlan Pages
        if not (a.get("has_listings") if "has_listings" in a else a.get("listings")):
            continue
        a = {k: v for k, v in a.items() if k not in COUNT_KEYS}
        a = dict(a)
        a["url"] = SITE_AGENCY.format(urllib.parse.quote(a["slug"])) if a.get("slug") in slugs else None
        a["agents"] = sorted([m for m in a.get("members") or [] if (m.get("name") or "").strip()],
                             key=lambda m: (m.get("rank", 0), m.get("role") != "manager"))
        out.append(a)
    return out, excluded


def find(ags, key):
    for a in ags:
        if key in (a["slug"], a["name"], a["id"]):
            return a
    sys.exit(f"agency {key} not in the qualifying list")


def img_from(url, ext=".img"):
    if url and not re.match(r"https?://", url):          # site-relative paths, e.g. assets/agents/<name>.jpg
        url = "https://shuknadlan.co.il/" + url.lstrip("/")
    try:
        return ImageOps.exif_transpose(Image.open(PI.cached(url, ext))).convert("RGB")
    except Exception as e:
        print(f"  ! image failed {url[-40:]}: {e}", file=sys.stderr); return None


def logo_of(a):
    return PI.agency_logo({"agency_logo": a.get("logo_url")}) if a.get("logo_url") else (None, None)


def agent_photo(m):
    if not m.get("photo_url") or m.get("show_photo") is False:
        return None
    return img_from(m["photo_url"], ".agent")


def circle(img, d, ring=BRASS, rw=6):
    ph = ImageOps.fit(img, (d * 2, d * 2), Image.LANCZOS, centering=(.5, .32)).resize((d, d), Image.LANCZOS)
    m = Image.new("L", (d * 3, d * 3), 0); ImageDraw.Draw(m).ellipse((0, 0, d * 3 - 1, d * 3 - 1), fill=255)
    out = Image.new("RGBA", (d + 2 * rw, d + 2 * rw), (0, 0, 0, 0))
    ImageDraw.Draw(out).ellipse((0, 0, d + 2 * rw - 1, d + 2 * rw - 1), fill=ring + (255,))
    out.paste(ph, (rw, rw), m.resize((d, d), Image.LANCZOS)); return out


def place_line(a, market):
    """Number-free sub-line under the agency name (never a count)."""
    place = Q.MARKET_LABEL.get(market, "")
    t = f"משרד תיווך ב{place}" if place else "משרד תיווך בשוק הנדל״ן"
    assert not re.search(r"\d", t), t
    return t


SUB_LINE = "כל הנכסים של המשרד במקום אחד"


def logo_card(im, a, logo, meta, box):
    x0, y0, x1, y1 = box
    if logo is not None:
        fill = PI.logo_bg(meta)
        PI.shadow_box(im, box, 28, blur=16, alpha=120, off=(0, 8)); PI.rrect(im, box, 28, fill=fill)
        PI.rrect(im, box, 28, outline=BRASS, width=4)
        lg = PI.contain(logo, x1 - x0 - 60, y1 - y0 - 50)
        im.alpha_composite(lg, ((x0 + x1 - lg.width) // 2, (y0 + y1 - lg.height) // 2))
        return True
    return False


def agents_grid(im, agents, x0, x1, y, max_rows=2, d=170, name_size=30, cols=3):
    """Photo agents in a grid (ring + name), agents without photo as a name line below. Returns the bottom y."""
    W = x1 - x0
    ph = [(m, agent_photo(m)) for m in agents]
    with_p = [(m, p) for m, p in ph if p is not None][:cols * max_rows]
    without = [m for m, p in ph if p is None] + [m for m, p in ph if p is not None][cols * max_rows:]
    rows = [with_p[i:i + cols] for i in range(0, len(with_p), cols)]
    for r in rows:
        n = len(r); cw = W / cols; off = (cols - n) * cw / 2
        for i, (m, p) in enumerate(r):
            cx = x1 - off - cw * (i + .5)
            c = circle(p, d)
            PI.shadow_box(im, (int(cx - d / 2), y, int(cx + d / 2), y + d), d // 2, blur=12, alpha=110, off=(0, 6))
            im.alpha_composite(c, (int(cx - c.width / 2), y))
            PI.text(im, (cx, y + d + 34), m["name"].strip(), name_size, 700, WHITE, "mm", maxw=cw - 16, minsize=18)
        y += d + 70
    if without:
        names = " · ".join(m["name"].strip() for m in without[:6])
        PI.text(im, ((x0 + x1) / 2, y + 22), names, 30, 600, BRASS_L, "mm", maxw=W, minsize=20); y += 56
    return y


def background(W, H):
    im = PI.vgrad((W, H), [(0, SAPH_D), (.45, SAPH), (1, SAPH_D)])
    glow = Image.new("L", (W, H), 0); ImageDraw.Draw(glow).ellipse((W * .1, H * .12, W * .9, H * .5), fill=90)
    lay = Image.new("RGBA", (W, H), (22, 59, 143, 0)); lay.putalpha(glow.filter(ImageFilter.GaussianBlur(160)))
    im.alpha_composite(lay)
    ImageDraw.Draw(im).rectangle((18, 18, W - 18, H - 18), outline=BRASS + (200,), width=2)
    return im


def hero_image(a, market):
    """Agency cover (agencies.cover_url) if any, else the first usable photo of the agency's market listing with the
    most usable photos (post_image.pick_photos order)."""
    if a.get("cover_url"):
        im = img_from(a["cover_url"], ".cover")
        if im is not None and min(im.size) >= 300:
            return im, "agency_cover"
    st = Q.load_json(Q.STATE)
    props = [p for p in st["properties"].values() if p.get("status") == "active" and p.get("agency_name") == a["name"]
             and Q.in_market(p, market)]
    props.sort(key=lambda p: (-len(Q.usable_photos(p)), p["listing_number"]))
    for p in props[:3]:
        ph = PI.pick_photos(p, 1)
        if ph: return ph[0], f"listing_{p['listing_number']}"
    return None, None


def story(a, market):
    W, H = 1080, 1920
    im = background(W, H)
    lock = PI.brand_lockup(150); im.alpha_composite(lock, ((W - lock.width) // 2, 262 - PI.GLOW_PAD))
    PI.grad_text(im, (W / 2, 500), HEAD_STORY, 88, 900, "mm", maxw=W - 120, top=(250, 232, 180), bottom=BRASS)
    logo, meta = logo_of(a)
    y = 580
    if logo_card(im, a, logo, meta, (190, y, W - 190, y + 300)):
        y += 340
        PI.text(im, (W / 2, y + 30), a["name"], 56, 800, WHITE, "mm", maxw=W - 140)
        y += 84
    else:
        PI.text(im, (W / 2, y + 90), a["name"], 84, 900, WHITE, "mm", maxw=W - 140, shadow=(0, 3, (0, 0, 0, 160), 8))
        y += 190
    cl = place_line(a, market); cw = PI.tw(cl, 38, 800) + 70
    PI.rrect(im, (W / 2 - cw / 2, y, W / 2 + cw / 2, y + 66), 33, fill=BRASS)
    PI.text(im, (W / 2, y + 34), cl, 38, 800, SAPH_D, "mm")
    y += 82
    PI.text(im, (W / 2, y + 20), SUB_LINE, 30, 500, MUTED, "mm"); y += 50
    y += 30
    y = agents_grid(im, a["agents"], 60, W - 60, y, max_rows=2 if y < 1100 else 1, d=160)
    if a["url"] and y < 1500:
        PI.text(im, (W / 2, 1540), "לעמוד המשרד באתר: shuknadlan.co.il", 32, 700, BRASS_L, "mm", maxw=W - 140)
    PI.text(im, (W / 2, 1680), "shuknadlan.co.il", 30, 600, MUTED, "mm")     # below the safe zone: not key info
    return im


def post(a, market):
    W, H = 1080, 1350
    im = background(W, H)
    hero, hero_src = hero_image(a, market)
    hh = 640 if hero is not None else 420      # no cover and no listing photo: content moves up
    if hero is not None and a.get("_own_page") and not a["agents"]:
        hh = 900                               # own-Page promo without agents: taller hero, no empty band
    if hero is not None:       # hero fades into the background itself (no seam)
        h = PI.smart_crop(hero, W, hh).convert("RGBA")
        h.alpha_composite(Image.new("RGBA", (W, hh), SAPH_D + (70,)))
        m = Image.new("L", (W, hh), 255)
        m.paste(Image.linear_gradient("L").rotate(180).resize((W, 320)), (0, hh - 320))
        im.paste(h, (0, 0), m)
    top = Image.linear_gradient("L").rotate(180).resize((W, 260)).point(lambda v: int(v * .65))
    ov = Image.new("RGBA", (W, 260), (0, 0, 0, 0)); ov.putalpha(top); im.alpha_composite(ov, (0, 0))
    ImageDraw.Draw(im).rectangle((18, 18, W - 18, H - 18), outline=BRASS + (200,), width=2)
    lock = PI.brand_lockup(108); im.alpha_composite(lock, (44 - PI.GLOW_PAD, 40 - PI.GLOW_PAD))
    logo, meta = logo_of(a)
    if logo is not None:
        aw = PI.agency_card_width(logo, 120, pad=12, minw=180, maxw=420)
        logo_card(im, a, logo, meta, (W - 44 - aw, 40, W - 44, 160))
    PI.grad_text(im, (W / 2, hh - 60), HEAD_POST, 62, 900, "mm", maxw=W - 100, top=(250, 232, 180), bottom=BRASS)
    y = hh
    PI.text(im, (W / 2, y + 36), a["name"], 58, 800, WHITE, "mm", maxw=W - 140)
    y += 84
    cl = place_line(a, market); cw = PI.tw(cl, 36, 800) + 64
    PI.rrect(im, (W / 2 - cw / 2, y, W / 2 + cw / 2, y + 62), 31, fill=BRASS)
    PI.text(im, (W / 2, y + 32), cl, 36, 800, SAPH_D, "mm"); y += 76
    PI.text(im, (W / 2, y + 18), SUB_LINE, 28, 500, MUTED, "mm"); y += 46
    y += 30
    y = agents_grid(im, a["agents"], 60, W - 60, y, max_rows=1 if hero is not None else 2, d=180, name_size=30, cols=4)
    if a.get("_own_page") and any(m.get("id") == Q.TOMER_AGENT_ID for m in a["agents"]):
        PI.text(im, (W / 2, H - 118), OWN_PAGE_DISCLOSURE, 24, 500, MUTED, "mm", maxw=W - 140)   # own agency: licence line
    PI.text(im, (W / 2, H - 70), "כל הנכסים של המשרד באתר shuknadlan.co.il", 30, 700, BRASS_L, "mm", maxw=W - 140)
    return im, hero_src


def post_caption(a, market, platform):
    """Feed caption: FB with the agency page link (if verified), IG without links; max 3 / 5 hashtags."""
    place = Q.MARKET_LABEL.get(market, "")
    tag = Q.agency_hashtag({"agency_name": a["name"]})
    L = [f"🏠 {HEAD_POST}", "", f"{a['name']}, {place_line(a, market)}."]
    names = [m["name"].strip() for m in a["agents"][:6]]
    if names: L += ["", "המתווכים במשרד: " + ", ".join(names)]
    if platform == "fb":
        L += ["", f"🔗 לעמוד המשרד באתר שוק הנדל״ן: {a['url']}" if a["url"] else "🔗 כל הנכסים באתר shuknadlan.co.il"]
        tags = ["#" + re.sub(r"[\W_]+", "", place.split()[0]) if place else None, tag, "#שוקהנדלן"]
    else:
        L += ["", "כל הנכסים של המשרד באתר shuknadlan.co.il"]
        tags = ["#" + re.sub(r"[\W_]+", "", place.split()[0]) if place else None, tag, "#נדלן", "#מתווכים", "#שוקהנדלן"]
    if a.get("_own_page") and any(m.get("id") == Q.TOMER_AGENT_ID for m in a["agents"]):
        L += ["", OWN_PAGE_DISCLOSURE]                 # Tomer's own agency: name + licence (rule 2026-10-27)
    L += ["", " ".join(dict.fromkeys(t for t in tags if t))]
    assert not re.search(r"\d", "\n".join(x for x in L if "http" not in x and x != OWN_PAGE_DISCLOSURE)), "no counts"
    return Q.nodash("\n".join(L)).rstrip() + "\n"


def write(a, market, kind, out=None, subdir=None):
    """subdir: output folder under out/agencies (default = market; 'agency-page' for the agency's own Page)."""
    d = os.path.join(OUT, subdir or market); os.makedirs(d, exist_ok=True)
    base = os.path.join(d, f"{a['slug']}_{kind}")
    hero_src = None
    if kind == "story":
        im = story(a, market)
    else:
        im, hero_src = post(a, market)
        for plat in ("fb", "ig"):
            open(f"{base}_{plat}_caption.txt", "w", encoding="utf-8").write(post_caption(a, market, plat))
    path = out or base + ".jpg"
    q = PI.save_small(im.convert("RGB"), path)
    meta = {"image": path, "agency": a["name"], "agency_id": a["id"], "slug": a["slug"], "market": market, "kind": kind,
            "highlight": "agencies" if kind == "story" else None, "agency_url": a["url"],
            "agents_shown": [m["name"] for m in a["agents"]],
            "agent_photos": sum(1 for m in a["agents"] if m.get("photo_url") and m.get("show_photo") is not False),
            "hero": hero_src, "kb": round(os.path.getsize(path) / 1024), "quality": q,
            **({"fb_caption": base + "_fb_caption.txt", "ig_caption": base + "_ig_caption.txt"} if kind == "post" else {})}
    json.dump(meta, open(base + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return meta


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=["story", "post", "list"]); ap.add_argument("agency", nargs="?")
    ap.add_argument("--all", action="store_true"); ap.add_argument("--market", default=Q.DEFAULT_MARKET); ap.add_argument("--out")
    ap.add_argument("--own-page", action="store_true",
                    help="promo for the agency's OWN Facebook Page (Tomer's agency incl. its agents + Tomer's licence line; out/agencies/agency-page/)")
    a = ap.parse_args()
    if a.own_page:
        ags, _ = load_agencies(a.market, own=a.agency)
        if not ags: sys.exit(f"agency {a.agency} not found in queue/agencies_{a.market}.json")
        print(json.dumps(write(ags[0], a.market, a.kind, a.out, subdir="agency-page"), ensure_ascii=False)); return
    ags, excl = load_agencies(a.market)
    if a.kind == "list":
        print(json.dumps({"market": a.market, "qualifying": len(ags), "excluded_for_now": excl,
                          "agencies": [{"name": x["name"], "slug": x["slug"], "rank": x.get("rank"), "url": x["url"],
                                        "logo": bool(x.get("logo_url")), "cover": bool(x.get("cover_url")),
                                        "agents": len(x["agents"])} for x in ags]}, ensure_ascii=False, indent=1)); return
    todo = ags if a.all else [find(ags, a.agency)] if a.agency else ap.error("agency or --all")
    for x in todo:
        print(json.dumps(write(x, a.market, a.kind, a.out if not a.all else None), ensure_ascii=False))


if __name__ == "__main__":
    main()
