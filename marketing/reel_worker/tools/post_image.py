#!/usr/bin/env python3
"""Single-image property post graphic for שוק הנדל״ן (replaces photo carousels in FB group posts).
Nothing here posts anything or writes to the database.

    post_image.py <property_id|listing_number> [--variant auto|classic|modern|commercial|premium]
                  [--size 1080x1350|1080x1080] [--snapshot FILE] [--out PATH]
    post_image.py --contact-sheet DIR [--out PATH]

Data: a READ-ONLY snapshot made by tools/sync_query.sql (Supabase project obookujgolazrwycsiyn, never
property_owners), default queue/snapshot_raw.json, falling back to queue/state.json. Uses only structured fields:
deal/type/category, price (+VAT flag), rooms, size, floor/total floors, street/house no., neighborhood, city,
features, condition, price_per_sqm, garden_sqm, land_zoning, move_in_date/move_in_soon, images + property_image_tags
(has_branding photos are skipped), agent display name/phone/license (agency_members), agency name/logo (agencies).
Missing values are omitted, never invented. No ethics/disclosure line. Tomer's details appear only because his own
listings carry him as the agent; every property shows its own agent.

One layout for every listing (2026-10-25): full-bleed wide hero photo, logos on the photo (no top strip), deal pill +
type, place, street, number tiles, 1-3 extra photos, feature icons, contact bar. Only the colours change:
--variant auto|sale|rent|commercial (auto: commercial category -> commercial, else rent/sale by deal_type).
Old names are aliases: classic/premium -> sale, modern -> rent.
"""
import os as _os, sys as _sys
_sys.path[:] = [x for x in _sys.path if _os.path.abspath(x or ".") != _os.path.dirname(_os.path.abspath(__file__))]
import argparse, hashlib, importlib.util, io, json, math, os, re, sys
from datetime import date
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


Q = _load("fbqueue", os.path.join(TOOLS, "queue.py"))
R = _load("fbreel", os.path.join(TOOLS, "reel.py"))      # reuse select_photos (has_branding skip, room order)

FONT = next((x for x in (os.environ.get("POST_IMAGE_FONT"),
                         "/usr/share/fonts/truetype/sand-box/google/Heebo/Heebo-VariableFont_wght.ttf",
                         os.path.join(ROOT, "fonts", "Heebo-VariableFont_wght.ttf"),
                         os.path.join(TOOLS, "fonts", "Heebo-VariableFont_wght.ttf")) if x and os.path.exists(x)),
            "/usr/share/fonts/truetype/sand-box/google/Heebo/Heebo-VariableFont_wght.ttf")
LOGO = os.path.join(ROOT, "brand", "logo_transparent.png")
CACHE = os.path.join(ROOT, ".cache", "post_image"); os.makedirs(CACHE, exist_ok=True)
BRAND = "שוק הנדל״ן"

NAVY, NAVY_D, ROYAL = (16, 40, 104), (9, 24, 66), (47, 65, 124)
GOLD, GOLD_L, GOLD_D = (201, 166, 98), (240, 214, 150), (160, 120, 52)
WHITE = (255, 255, 255)

HOUSE_TYPES = {"בית פרטי/קוטג'", "דו משפחתי", "וילה", "משק חקלאי", "מגרש", "מגרשים", "נחלה"}
FEM_TYPES = {"דירה", "דירת גן", "יחידת דיור", "חנויות/שטח מסחרי"}
COND = {"new": ("חדש", "חדשה"), "new_from_contractor": ("חדש מקבלן", "חדשה מקבלן"),
        "renovated": ("משופץ", "משופצת"), "maintained": ("מתוחזק", "מתוחזקת")}
FEAT_LABEL = dict(Q.FEAT, ac="מיזוג", building_shelter="מקלט בבניין", ev_charger="עמדת טעינה",
                  renovated_feature="משופץ", comms="תשתית תקשורת")
FEAT_ICON = {"mamad": "shield", "mamak": "shield", "building_shelter": "shield", "parking": "parking",
             "elevator": "elevator", "balcony": "balcony", "sun_balcony": "sun", "ac": "snow", "cold_room": "snow",
             "storage": "box", "renovated_feature": "sparkle", "furnished": "sofa", "accessible": "access",
             "high_ceiling": "ceiling", "loading_ramp": "truck", "kitchenette": "cup", "meeting_room": "meeting",
             "comms": "wifi", "alarm": "bell", "cameras": "camera", "ev_charger": "bolt"}


# ------------------------------------------------------------------ fonts + text
_fc = {}


def F(size, w=700):
    k = (int(size), int(w))
    if k not in _fc:
        f = ImageFont.truetype(FONT, k[0], layout_engine=ImageFont.Layout.RAQM)
        f.set_variation_by_axes([k[1]]); _fc[k] = f
    return _fc[k]


def heb(t):
    return any("\u0590" <= c <= "\u05ff" for c in t)


def dirn(t):
    return "rtl" if heb(t) else "ltr"


_scratch = ImageDraw.Draw(Image.new("L", (8, 8)))


def tw(t, size, w=700):
    return _scratch.textlength(t, font=F(size, w), direction=dirn(t))


def fit(t, size, w, maxw, minsize=16):
    while size > minsize and tw(t, size, w) > maxw:
        size -= 2
    return size


def text(im, xy, t, size, w=700, fill=WHITE, anchor="rm", maxw=None, minsize=16, shadow=None):
    """Draw text (RTL for Hebrew via raqm). Returns the size actually used."""
    if not t:
        return size
    if maxw:
        size = fit(t, size, w, maxw, minsize)
    d = ImageDraw.Draw(im, "RGBA")
    if shadow:
        lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(lay).text((xy[0] + shadow[0], xy[1] + shadow[1]), t, font=F(size, w), fill=shadow[2],
                                 anchor=anchor, direction=dirn(t))
        im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(shadow[3] if len(shadow) > 3 else 4)))
    d.text(xy, t, font=F(size, w), fill=fill, anchor=anchor, direction=dirn(t))
    return size


def grad_text(im, xy, t, size, w=900, anchor="mm", maxw=None, top=GOLD_L, bottom=GOLD_D, shadow=True):
    if maxw:
        size = fit(t, size, w, maxw)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).text(xy, t, font=F(size, w), fill=255, anchor=anchor, direction=dirn(t))
    bb = mask.getbbox()
    if not bb:
        return
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0)); sh.putalpha(mask.point(lambda v: v * 0.55))
        im.alpha_composite(sh.transform(im.size, Image.AFFINE, (1, 0, -4, 0, 1, -6)).filter(ImageFilter.GaussianBlur(6)))
    g = vgrad((im.width, bb[3] - bb[1]), [(0, top), (.55, (225, 190, 120)), (1, bottom)])
    full = Image.new("RGBA", im.size, (0, 0, 0, 0)); full.paste(g, (0, bb[1]))
    full.putalpha(mask)
    im.alpha_composite(full)


# ------------------------------------------------------------------ drawing helpers
def vgrad(size, stops, horizontal=False):
    w, h = size
    n = w if horizontal else h
    t = np.linspace(0, 1, max(n, 2))
    cols = np.zeros((len(t), 3))
    for i in range(3):
        cols[:, i] = np.interp(t, [s[0] for s in stops], [s[1][i] for s in stops])
    arr = np.tile(cols[None, :, :], (h, 1, 1)) if horizontal else np.tile(cols[:, None, :], (1, w, 1))
    return Image.fromarray(arr.astype("uint8"), "RGB").convert("RGBA")


def rrect(im, box, r, fill=None, outline=None, width=0):
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(lay).rounded_rectangle(box, r, fill=fill, outline=outline, width=width)
    im.alpha_composite(lay)


def shadow_box(im, box, r, blur=18, alpha=110, off=(0, 8)):
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    b = (box[0] + off[0], box[1] + off[1], box[2] + off[0], box[3] + off[1])
    ImageDraw.Draw(lay).rounded_rectangle(b, r, fill=(0, 0, 0, alpha))
    im.alpha_composite(lay.filter(ImageFilter.GaussianBlur(blur)))


def round_mask(size, r):
    m = Image.new("L", (size[0] * 3, size[1] * 3), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] * 3 - 1, size[1] * 3 - 1), r * 3, fill=255)
    return m.resize(size, Image.LANCZOS)


def paste_round(im, src, box, r, border=None, bw=0, shadow=True):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if shadow:
        shadow_box(im, box, r, blur=14, alpha=90, off=(0, 6))
    if border and bw:
        rrect(im, (x0 - bw, y0 - bw, x1 + bw, y1 + bw), r + bw, fill=border)
    tile = src.resize((w, h), Image.LANCZOS).convert("RGBA") if src.size != (w, h) else src.convert("RGBA")
    im.paste(tile, (x0, y0), round_mask((w, h), r))


def contain(img, maxw, maxh):
    s = min(maxw / img.width, maxh / img.height)
    return img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)


# ------------------------------------------------------------------ icons (drawn, 100-unit grid, 4x supersampled)
class Pen:
    def __init__(self, px, ss=4):
        self.n = px * ss; self.s = self.n / 100.0
        self.m = Image.new("L", (self.n, self.n), 0); self.d = ImageDraw.Draw(self.m)

    def _p(self, pts): return [(x * self.s, y * self.s) for x, y in pts]

    def L(self, pts, w=7, ink=255):
        pts = self._p(pts); ww = int(w * self.s)
        self.d.line(pts, fill=ink, width=ww, joint="curve")
        for x, y in (pts[0], pts[-1]):
            self.d.ellipse((x - ww / 2, y - ww / 2, x + ww / 2, y + ww / 2), fill=ink)

    def Lc(self, pts, w=7): self.L(list(pts) + [pts[0]], w)

    def R(self, x0, y0, x1, y1, w=7, r=0, fill=False, ink=255):
        b = (x0 * self.s, y0 * self.s, x1 * self.s, y1 * self.s)
        if fill: self.d.rounded_rectangle(b, r * self.s, fill=ink)
        else: self.d.rounded_rectangle(b, r * self.s, outline=ink, width=int(w * self.s))

    def C(self, cx, cy, r, w=7, fill=False, ink=255):
        b = ((cx - r) * self.s, (cy - r) * self.s, (cx + r) * self.s, (cy + r) * self.s)
        if fill: self.d.ellipse(b, fill=ink)
        else: self.d.ellipse(b, outline=ink, width=int(w * self.s))

    def A(self, cx, cy, r, a0, a1, w=7):
        b = ((cx - r) * self.s, (cy - r) * self.s, (cx + r) * self.s, (cy + r) * self.s)
        self.d.arc(b, a0, a1, fill=255, width=int(w * self.s))

    def P(self, pts, ink=255): self.d.polygon(self._p(pts), fill=ink)

    def img(self, px): return self.m.resize((px, px), Image.LANCZOS)


def _star(cx, cy, R1, r1, n=4, rot=-90):
    return [(cx + (R1 if i % 2 == 0 else r1) * math.cos(math.radians(rot + i * 180 / n)),
             cy + (R1 if i % 2 == 0 else r1) * math.sin(math.radians(rot + i * 180 / n))) for i in range(2 * n)]


def icon_mask(name, px):
    p = Pen(px)
    if name == "rooms":      # bed
        p.L([(12, 26), (12, 84)]); p.R(12, 50, 88, 70, 7, r=4); p.L([(88, 70), (88, 84)]); p.R(22, 36, 44, 50, 6, r=5)
    elif name == "sqm":
        p.R(12, 12, 88, 88, 7, r=10); p.L([(32, 68), (68, 32)], 7)
        p.L([(50, 32), (68, 32), (68, 50)], 7); p.L([(32, 50), (32, 68), (50, 68)], 7)
    elif name == "floor":
        p.L([(10, 88), (10, 72), (30, 72), (30, 54), (50, 54), (50, 36), (70, 36), (70, 18), (90, 18)], 7)
    elif name == "shield":
        p.Lc([(50, 8), (84, 20), (84, 46), (76, 68), (50, 92), (24, 68), (16, 46), (16, 20)], 7)
        p.L([(35, 50), (46, 61), (66, 39)], 7)
    elif name == "parking":
        p.R(10, 10, 90, 90, 7, r=16); p.L([(38, 74), (38, 26), (54, 26)], 9); p.A(54, 40, 14, -90, 90, 9); p.L([(54, 54), (38, 54)], 9)
    elif name == "elevator":
        p.R(20, 8, 80, 92, 7, r=8); p.P([(50, 22), (37, 40), (63, 40)]); p.P([(50, 78), (37, 60), (63, 60)])
    elif name == "balcony":
        p.L([(8, 44), (92, 44)], 7); p.L([(8, 86), (92, 86)], 7)
        for x in (12, 31, 50, 69, 88): p.L([(x, 44), (x, 86)], 6)
    elif name == "sun":
        p.C(50, 44, 15, 7)
        for k in range(8):
            a = math.radians(k * 45); p.L([(50 + 25 * math.cos(a), 44 + 25 * math.sin(a)), (50 + 34 * math.cos(a), 44 + 34 * math.sin(a))], 6)
        p.L([(10, 90), (90, 90)], 6)
    elif name == "snow":
        for a in (90, 30, 150):
            r = math.radians(a); dx, dy = 40 * math.cos(r), 40 * math.sin(r)
            p.L([(50 - dx, 50 - dy), (50 + dx, 50 + dy)], 7)
            for sgn in (1, -1):
                ex, ey = 50 + sgn * dx * .72, 50 + sgn * dy * .72
                for off in (35, -35):
                    rr = math.radians(a + (0 if sgn > 0 else 180) + 180 + off)
                    p.L([(ex, ey), (ex + 13 * math.cos(rr), ey + 13 * math.sin(rr))], 6)
    elif name == "box":
        p.R(16, 36, 84, 88, 7, r=4); p.R(9, 18, 91, 37, 7, r=4); p.L([(40, 54), (60, 54)], 7)
    elif name == "sparkle":
        p.P(_star(44, 56, 36, 9)); p.P(_star(78, 20, 16, 4))
    elif name == "sofa":
        p.R(22, 26, 78, 54, 7, r=8); p.R(8, 44, 26, 76, 7, r=7); p.R(74, 44, 92, 76, 7, r=7)
        p.L([(26, 64), (74, 64)], 7); p.L([(16, 76), (16, 88)], 7); p.L([(84, 76), (84, 88)], 7)
    elif name == "access":
        p.C(58, 13, 9, fill=True); p.L([(54, 28), (50, 58), (72, 58), (82, 84)], 8); p.L([(52, 40), (70, 40)], 7)
        p.A(44, 64, 24, 110, 400, 7)
    elif name == "ceiling":
        p.L([(10, 10), (90, 10)], 7); p.L([(10, 90), (90, 90)], 7); p.L([(50, 24), (50, 76)], 7)
        p.L([(38, 36), (50, 24), (62, 36)], 7); p.L([(38, 64), (50, 76), (62, 64)], 7)
    elif name == "truck":
        p.R(6, 26, 58, 70, 7, r=4); p.L([(58, 38), (76, 38), (92, 56), (92, 70), (58, 70)], 7)
        p.C(26, 76, 9, fill=True); p.C(74, 76, 9, fill=True)
    elif name == "cup":
        p.R(18, 36, 64, 84, 7, r=8); p.A(66, 56, 13, -90, 90, 7)
        for x in (30, 42, 54): p.L([(x, 12), (x, 24)], 6)
    elif name == "meeting":
        p.R(16, 42, 84, 62, 7, r=8)
        for x in (28, 50, 72): p.C(x, 24, 8, 6); p.C(x, 80, 8, 6)
    elif name == "wifi":
        for r in (18, 36, 54): p.A(50, 82, r, 225, 315, 8)
        p.C(50, 82, 7, fill=True)
    elif name == "bell":
        p.Lc([(50, 12), (68, 22), (72, 58), (86, 72), (14, 72), (28, 58), (32, 22)], 7); p.C(50, 84, 7, fill=True)
    elif name == "camera":
        p.R(8, 28, 92, 82, 7, r=10); p.C(50, 55, 15, 7); p.R(32, 16, 56, 28, 6, r=3)
    elif name == "bolt":
        p.P([(58, 6), (22, 56), (46, 56), (38, 94), (78, 40), (54, 40), (64, 6)])
    elif name == "tag":
        p.Lc([(10, 10), (50, 10), (90, 50), (50, 90), (10, 50)], 7); p.C(30, 30, 7, 6)
    elif name == "leaf":
        p.L([(50, 92), (50, 40)], 7)
        p.Lc([(50, 62), (32, 62), (16, 48), (14, 30), (32, 34), (46, 46)], 6)
        p.Lc([(50, 44), (64, 44), (82, 30), (86, 12), (66, 14), (54, 28)], 6)
    elif name == "map":
        p.Lc([(8, 22), (36, 10), (64, 22), (92, 10), (92, 78), (64, 90), (36, 78), (8, 90)], 7)
        p.L([(36, 10), (36, 78)], 6); p.L([(64, 22), (64, 90)], 6)
    elif name == "calendar":
        p.R(12, 18, 88, 88, 7, r=8); p.L([(12, 38), (88, 38)], 7); p.L([(32, 8), (32, 26)], 7); p.L([(68, 8), (68, 26)], 7)
        for x in (32, 50, 68):
            for y in (54, 72): p.C(x, y, 5, fill=True)
    elif name == "pin":
        p.C(50, 36, 30, fill=True); p.P([(24, 50), (76, 50), (50, 96)]); p.C(50, 36, 12, fill=True, ink=0)
    elif name == "house":
        p.L([(8, 50), (50, 12), (92, 50)], 8); p.R(20, 44, 80, 90, 8, r=3); p.R(42, 62, 58, 90, 6)
    elif name == "building":
        p.R(22, 8, 78, 92, 7, r=3)
        for x in (36, 64):
            for y in (24, 42, 60): p.R(x - 5, y - 4, x + 5, y + 4, fill=True)
    elif name == "phone":
        h = Pen(px)
        h.R(30, 6, 62, 26, fill=True, r=7); h.R(30, 74, 62, 94, fill=True, r=7)
        h.d.arc((22 * h.s, 12 * h.s, 62 * h.s, 88 * h.s), 90, 270, fill=255, width=int(15 * h.s))
        h.m = h.m.rotate(-38, resample=Image.BICUBIC, center=(h.n / 2, h.n / 2)); return h.img(px)
    else:  # check
        p.L([(18, 52), (42, 74), (84, 28)], 10)
    return p.img(px)


def icon(name, px, color):
    m = icon_mask(name, px)
    im = Image.new("RGBA", (px, px), color + (0,) if len(color) == 3 else color); im.putalpha(m)
    return im


def round_icon(name, d, bg, fg, ring=None, scale=.52):
    out = Image.new("RGBA", (d * 3, d * 3), (0, 0, 0, 0)); dr = ImageDraw.Draw(out)
    if ring: dr.ellipse((0, 0, d * 3 - 1, d * 3 - 1), fill=ring); dr.ellipse((9, 9, d * 3 - 10, d * 3 - 10), fill=bg)
    else: dr.ellipse((0, 0, d * 3 - 1, d * 3 - 1), fill=bg)
    out = out.resize((d, d), Image.LANCZOS)
    ip = int(d * scale); ic = icon(name, ip, fg)
    out.alpha_composite(ic, ((d - ip) // 2, (d - ip) // 2)); return out


# ------------------------------------------------------------------ data
def load_props(path=None):
    for cand in ([path] if path else [os.path.join(ROOT, "queue", "snapshot_raw.json")]):
        if cand and os.path.exists(cand):
            return Q.read_snapshot(cand).get("properties", [])
    st = Q.load_json(Q.STATE) or {}
    return list((st.get("properties") or {}).values())


def find_prop(key, path=None):
    props = load_props(path)
    for p in props:
        if str(p.get("id")) == str(key) or str(p.get("listing_number")) == str(key):
            return p
    st = Q.load_json(Q.STATE) or {}
    for p in (st.get("properties") or {}).values():
        if str(p.get("id")) == str(key) or str(p.get("listing_number")) == str(key):
            return p
    sys.exit(f"property {key} not found in snapshot/state (run tools/sync_query.sql -> queue/snapshot_raw.json)")


def cached(url, ext=".img"):
    fn = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest()[:16] + ext)
    if not os.path.exists(fn):
        Q.fetch(url, fn)
    return fn


def open_img(url):
    try:
        im = Image.open(cached(url)); im = ImageOps.exif_transpose(im); return im.convert("RGB")
    except Exception as e:
        print(f"  ! image failed {url[-40:]}: {e}", file=sys.stderr); return None


def pick_photos(p, n=4):
    """reel.select_photos order (exterior opener, then rooms; has_branding photos skipped). If the listing has
    photos but all of them are branded, nothing is used (placeholder art instead)."""
    imgs = [u for u in (p.get("images") or []) if u]
    tags = {t["url"]: t for t in (p.get("image_tags") or [])}
    clean = [u for u in imgs if not (tags.get(u) or {}).get("has_branding")]
    if not clean:
        return []
    sel = [u for u, _ in R.select_photos(p, maxn=8) if u in clean]
    for u in clean:
        if u not in sel: sel.append(u)
    out = []
    for u in sel:
        im = open_img(u)
        if im is not None and min(im.size) >= 200:
            out.append(im)
        if len(out) >= n + 2: break
    if not out:
        return []
    # hero: the first landscape photo among the first three, else the opener
    hero_i = next((i for i, im in enumerate(out[:3]) if im.width / im.height >= 1.15), 0)
    out.insert(0, out.pop(hero_i))
    return out[:n]


def smart_crop(img, w, h):
    """Crop to w:h. The free axis is placed by edge energy (detail) blended with the centre (portraits lean up)."""
    ar, tr = img.width / img.height, w / h
    if abs(ar - tr) < 1e-3:
        return img.resize((w, h), Image.LANCZOS)
    small = img.copy(); small.thumbnail((256, 256))
    e = np.asarray(small.convert("L").filter(ImageFilter.FIND_EDGES)).astype(float)
    if ar > tr:   # too wide: choose x
        cw = int(img.height * tr); prof = e.sum(0); win = max(1, int(round(cw / img.width * len(prof))))
        sc = np.convolve(prof, np.ones(win), "valid"); best = int(np.argmax(sc)) / len(prof) * img.width
        centre = (img.width - cw) / 2; x = int(.55 * centre + .45 * best); x = max(0, min(img.width - cw, x))
        box = (x, 0, x + cw, img.height)
    else:         # too tall: choose y
        ch = int(img.width / tr); prof = e.sum(1); win = max(1, int(round(ch / img.height * len(prof))))
        sc = np.convolve(prof, np.ones(win), "valid"); best = int(np.argmax(sc)) / len(prof) * img.height
        centre = (img.height - ch) * .40; y = int(.75 * centre + .25 * best); y = max(0, min(img.height - ch, y))
        box = (0, y, img.width, y + ch)
    return img.crop(box).resize((w, h), Image.LANCZOS)


def placeholder(w, h, p, dark=NAVY_D, light=ROYAL):
    im = vgrad((w, h), [(0, light), (1, dark)])
    ic = icon("building" if p.get("category") == "commercial" else ("map" if Q.is_lot(p) else "house"), int(min(w, h) * .42), (255, 255, 255))
    ic.putalpha(ic.getchannel("A").point(lambda v: v * .22)); im.alpha_composite(ic, ((w - ic.width) // 2, (h - ic.height) // 2))
    return im.convert("RGB")


def agency_logo(p):
    """agencies.logo_url, trimmed to its main content (screenshots of a logo are cropped to the logo itself:
    the largest blob of non-background pixels plus any blob >= 8% of it). The logo keeps its own background;
    meta["bg"] is that background colour (None when the file is transparent) so cards can be filled with it
    and the logo sits seamlessly. Cached in .cache/post_image/agency_<hash>.png/.json."""
    url = p.get("agency_logo")
    if not url:
        return None, None
    key = hashlib.sha1(url.encode()).hexdigest()[:12]
    out = os.path.join(CACHE, f"agency_{key}.png"); mp = out[:-4] + ".json"
    if not (os.path.exists(out) and os.path.exists(mp)):
        from scipy import ndimage
        try:
            raw = ImageOps.exif_transpose(Image.open(cached(url, ".logo"))).convert("RGBA")
        except Exception as e:
            print(f"  ! agency logo failed: {e}", file=sys.stderr); return None, None
        al = np.asarray(raw.getchannel("A")).astype(int)
        rgb = np.asarray(raw.convert("RGB")).astype(int)
        transparent = al.min() < 250
        if transparent:
            fg = al > 40; bgc = None
        else:
            border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]); bgc = np.median(border, 0)
            fg = np.abs(rgb - bgc).max(2) > 40
        res = raw
        for _ in range(2):   # 2nd pass: a solid tile found inside a screenshot becomes the new background
            sub_rgb = np.asarray(res.convert("RGB")).astype(int); sub_al = np.asarray(res.getchannel("A")).astype(int)
            fg = (sub_al > 40) if transparent else (np.abs(sub_rgb - bgc).max(2) > 40)
            if not fg.any():
                break
            k = max(3, int(max(fg.shape) * .035))
            lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=k))
            sizes = ndimage.sum(fg, lab, range(1, n + 1))
            keep = [i + 1 for i, s in enumerate(sizes) if s >= .08 * sizes.max()]
            ys, xs = np.where(np.isin(lab, keep) & fg)
            tight = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
            ins = 3 if min(tight[2] - tight[0], tight[3] - tight[1]) > 40 else 0   # skip anti-aliased edge
            t = res.crop((tight[0] + ins, tight[1] + ins, tight[2] - ins, tight[3] - ins)); tr = np.asarray(t.convert("RGB")).astype(int)
            b2 = np.concatenate([tr[0], tr[-1], tr[:, 0], tr[:, -1]]); m2 = np.median(b2, 0)
            if not transparent and np.abs(m2 - bgc).max() > 60 and (np.abs(b2 - m2).max(1) < 40).mean() > .8:
                res, bgc = t, m2          # content sits on its own solid tile: use the tile, then trim inside it
                continue
            pad = int(max(fg.shape) * .02)
            res = res.crop((max(0, tight[0] - pad), max(0, tight[1] - pad), min(fg.shape[1], tight[2] + pad), min(fg.shape[0], tight[3] + pad)))
            break
        vis = np.asarray(res.convert("RGB")).astype(float)[np.asarray(res.getchannel("A")) > 128]
        lum = float((vis @ [.299, .587, .114]).mean()) if len(vis) else 255
        res.save(out)
        json.dump({"bg": [int(x) for x in bgc] if bgc is not None else None, "lum": round(lum, 1)}, open(mp, "w"))
    return Image.open(out).convert("RGBA"), json.load(open(mp))


def logo_bg(meta):
    """Card fill for a logo: its own background colour; transparent light logos get navy, others white."""
    if meta and meta.get("bg"):
        return tuple(meta["bg"])
    if meta and meta.get("lum", 0) > 200:
        return NAVY
    return WHITE


_brand = {}
GLOW_PAD = 16


def brand_lockup(h, text_color=NAVY, glow=True):
    """שוק הנדל״ן pin logo (transparent cutout brand/logo_transparent.png, anti-aliased edges) with the name under it
    in Heebo brand navy. No frame/box: a soft white outer glow keeps it visible on dark and light backgrounds
    (a tighter, stronger halo behind the text so the navy name stays readable on dark panels).
    Returns an RGBA image; the glow padding is part of the image (offset GLOW_PAD)."""
    k = (h, text_color, glow)
    if k in _brand: return _brand[k].copy()
    logo = Image.open(LOGO).convert("RGBA"); logo = logo.crop(logo.getbbox())
    th = int(h * .25); lh = h - th - int(h * .04)
    lg = contain(logo, 10 ** 4, lh)
    fs = int(th * 1.12); tws = tw(BRAND, fs, 800)
    P = GLOW_PAD
    W = int(max(lg.width, tws) + 6) + 2 * P; Hh = h + 2 * P
    logo_l = Image.new("RGBA", (W, Hh), (0, 0, 0, 0)); logo_l.alpha_composite(lg, ((W - lg.width) // 2, P))
    text_l = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    ImageDraw.Draw(text_l).text((W / 2, P + h), BRAND, font=F(fs, 800), fill=text_color, anchor="md", direction="rtl")
    out = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    if glow:
        def halo(layer, grow, blur, strength):
            a = layer.getchannel("A").filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(blur))
            g = Image.new("RGBA", layer.size, (255, 255, 255, 0)); g.putalpha(a.point(lambda v: min(255, int(v * strength))))
            return g
        out.alpha_composite(halo(logo_l, 5, max(4, h // 14), 0.85))       # soft outer glow around the pin
        out.alpha_composite(halo(text_l, 7, max(3, h // 30), 1.6))        # tighter halo behind the name
        out.alpha_composite(halo(text_l, 3, max(6, h // 12), 0.7))
    out.alpha_composite(logo_l); out.alpha_composite(text_l)
    _brand[k] = out; return out.copy()


# ------------------------------------------------------------------ facts (structured only)
def fem(p): return p.get("property_type") in FEM_TYPES


def facts(p):
    f = {}
    f["deal"] = Q.deal_word(p)
    f["type"] = Q.TYPE_LABEL.get(p.get("property_type"), p.get("property_type") or "")
    f["title"] = Q.type_phrase(p)
    num, suf = Q.price_parts(p)
    f["price"] = f"₪{num}" if num else None
    f["price_suf"] = suf
    sz = Q.size_of(p)
    f["sqm"] = f'{Q.fmt_num(sz)} מ"ר' if sz else None
    f["sqm_num"] = Q.fmt_num(sz) if sz else None
    f["rooms"] = Q.fmt_num(p["rooms"]) if p.get("rooms") and p.get("category") == "residential" and not Q.is_lot(p) else None
    fl = p.get("floor")
    if fl is not None and not Q.is_lot(p) and p.get("property_type") not in ("בית פרטי/קוטג'", "דו משפחתי", "וילה"):
        f["floor"] = "קרקע" if fl == 0 else str(fl)
        f["floor_txt"] = Q.floor_text(p)
        f["floor_short"] = ("קומת קרקע" if fl == 0 else f"קומה {fl}") + (f"/{p['total_floors']}" if p.get("total_floors") else "")
    else:
        f["floor"] = f["floor_txt"] = f["floor_short"] = None
    street = " ".join(x for x in (p.get("street"), p.get("house_number")) if x)
    parts = [x for x in (street, p.get("neighborhood"), p.get("city")) if x]
    f["address"] = ", ".join(dict.fromkeys(parts))
    f["place"] = ", ".join(x for x in (p.get("neighborhood"), p.get("city")) if x)
    pps = p.get("price_per_sqm")
    if not pps and p.get("price") and sz and p.get("category") == "commercial":
        pps = round(float(p["price"]) / float(sz))
    if p.get("deal_type") == "rent" and p.get("category") != "commercial":
        pps = None
    f["ppsqm"] = f'₪{Q.fmt_num(round(float(pps)))} למ"ר' if pps else None
    f["ppsqm_num"] = f"₪{Q.fmt_num(round(float(pps)))}" if pps else None
    feats = p.get("features") or []
    f["exclusive"] = "exclusive" in feats
    f["price_dropped"] = "price_dropped" in feats
    c = COND.get(p.get("condition"))
    f["condition"] = (c[1] if fem(p) else c[0]) if c else None
    mi = None
    if p.get("move_in_date"):
        try:
            dd = date.fromisoformat(str(p["move_in_date"])[:10])
            mi = "כניסה מיידית" if dd <= date.today() else f"כניסה {dd.month:02d}/{dd.year}"
        except ValueError:
            pass
    elif p.get("move_in_soon"):
        mi = "כניסה קרובה"
    f["movein"] = None if Q.is_lot(p) else mi
    f["garden"] = f'גינה {Q.fmt_num(p["garden_sqm"])} מ"ר' if p.get("garden_sqm") and p.get("property_type") in ("דירת גן", "בית פרטי/קוטג'", "דו משפחתי", "וילה") else None
    f["zoning"] = f'ייעוד: {p["land_zoning"]}' if p.get("land_zoning") else None
    f["features"] = [(FEAT_ICON.get(k, "check"), FEAT_LABEL[k]) for k in Q.features(p)]
    f["highlight"] = highlight(f, p)
    f["agent"] = (p.get("agent_name") or "").strip() or None
    f["agency"] = (p.get("agency_name") or "").strip() or None
    f["phone"] = Q.fmt_phone(p.get("agent_phone")) or None
    f["license"] = p.get("agent_license")
    f["listing"] = p.get("listing_number")
    return f


def highlight(f, p, ppsqm=True):
    return " · ".join(x for x in (f["condition"], f["movein"], f["garden"],
                                  f["ppsqm"] if ppsqm and p.get("deal_type") == "sale" else None) if x)


def panel_items(f, p, n, skip=()):
    items = list(f["features"])
    extra = [("sqm", f["sqm"], "sqm"), ("floor", f["floor_txt"], "floor"), ("tag", f["ppsqm"], "ppsqm"),
             ("leaf", f["garden"], "garden"), ("map", f["zoning"], "zoning"), ("calendar", f["movein"], "movein"),
             ("sparkle", f["condition"], "condition")]
    for ic, lab, key in extra:
        if len(items) >= n: break
        if lab and key not in skip: items.append((ic, lab))
    if p.get("category") == "commercial":   # commercial: size first
        pass
    return items[:n]


# ------------------------------------------------------------------ shared blocks
def ribbons(im, f, x_right, y, style="gold"):
    """'בלעדי' / 'המחיר ירד' tags right-aligned at (x_right, y)."""
    tags = []
    if f["exclusive"]: tags.append(("בלעדי", (GOLD, NAVY_D)))
    if f["price_dropped"]: tags.append(("המחיר ירד", ((214, 48, 49), WHITE)))
    x = x_right
    for t, (bg, fg) in tags:
        w = int(tw(t, 30, 800)) + 40
        shadow_box(im, (x - w, y, x, y + 50), 25, blur=8, alpha=90, off=(0, 3))
        rrect(im, (x - w, y, x, y + 50), 25, fill=bg)
        text(im, (x - w / 2, y + 26), t, 30, 800, fg, "mm")
        x -= w + 12


def agency_block(im, logo, meta, f, box, on_dark=True, card=True, surface=WHITE):
    """Agency logo (or the agency name when there is none) centred in box. The logo keeps its own background:
    a card is filled with that colour, and without a card a rounded tile is drawn when it differs from the surface."""
    x0, y0, x1, y1 = box
    if logo is not None:
        fill = logo_bg(meta)
        if card:
            shadow_box(im, box, 20, blur=12, alpha=90, off=(0, 5)); rrect(im, box, 20, fill=fill)
            if fill != WHITE: rrect(im, box, 20, outline=WHITE, width=3)
            pad = 10 if meta and meta.get("bg") else 14
        else:
            pad = 0
        lg = contain(logo, x1 - x0 - 2 * pad, y1 - y0 - 2 * pad)
        lx, ly = (x0 + x1 - lg.width) // 2, (y0 + y1 - lg.height) // 2
        if not card and sum(abs(a - b) for a, b in zip(fill, surface)) > 60:
            lg = contain(logo, x1 - x0 - 16, y1 - y0 - 16); lx, ly = (x0 + x1 - lg.width) // 2, (y0 + y1 - lg.height) // 2
            rrect(im, (lx - 8, ly - 8, lx + lg.width + 8, ly + lg.height + 8), 12, fill=fill)
        im.alpha_composite(lg, (lx, ly))
    elif f["agency"]:
        if card:
            shadow_box(im, box, 20, blur=12, alpha=90, off=(0, 5)); rrect(im, box, 20, fill=WHITE)
            x0, y0, x1, y1 = x0 + 14, y0 + 14, x1 - 14, y1 - 14
        col = NAVY if card or not on_dark else WHITE
        text(im, ((x0 + x1) / 2, (y0 + y1) / 2), f["agency"], 40, 800, col, "mm", maxw=x1 - x0)


def agency_card_width(logo, h, pad=14, minw=220, maxw=440, f=None):
    if logo is not None:
        s = (h - 2 * pad) / logo.height
        return int(max(minw, min(maxw, logo.width * s + 2 * pad)))
    if f and f["agency"]:
        return int(max(minw, min(maxw, tw(f["agency"], 40, 800) + 50)))
    return minw


def contact_bar(im, f, box, bg, fg_name, fg_phone, icon_bg, icon_fg, sub_col, radius=26, border=None, label="לפרטים:"):
    x0, y0, x1, y1 = box; h = y1 - y0
    shadow_box(im, box, radius, blur=16, alpha=110, off=(0, 6))
    if border: rrect(im, (x0 - 4, y0 - 4, x1 + 4, y1 + 4), radius + 4, fill=border)
    if isinstance(bg, Image.Image):
        im.paste(bg.resize((x1 - x0, h)), (x0, y0), round_mask((x1 - x0, h), radius))
    else:
        rrect(im, box, radius, fill=bg)
    d = int(h * .7); ic = round_icon("phone", d, icon_bg, icon_fg)
    im.alpha_composite(ic, (x0 + 24, y0 + (h - d) // 2))
    # phone number (LTR) left, name block right
    left = x0 + 24 + d + 18
    name_w = 0
    if f["agent"]:
        line1 = f"{label} {f['agent']}" if label else f["agent"]
        name_w = min(tw(line1, 34, 700), (x1 - left) * .48)
    if f["phone"]:
        avail = x1 - 30 - left - (name_w + 30 if f["agent"] else 0)
        s = fit(f["phone"], int(h * .56), 800, avail, 30)
        text(im, (left, y0 + h / 2 + 2), f["phone"], s, 800, fg_phone, "lm")
        used = tw(f["phone"], s, 800)
        name_max = x1 - 30 - (left + used + 30)
    else:
        name_max = x1 - left - 40
    if f["agent"]:
        line1 = f"{label} {f['agent']}" if label else f["agent"]
        sub = f["agency"] or ""
        if f.get("license"): sub = (sub + " · " if sub else "") + f"רישיון {f['license']}"
        if sub:
            text(im, (x1 - 30, y0 + h * .36), line1, 34, 700, fg_name, "rm", maxw=name_max)
            text(im, (x1 - 30, y0 + h * .70), sub, 24, 500, sub_col, "rm", maxw=name_max)
        else:
            text(im, (x1 - 30, y0 + h / 2), line1, 36, 700, fg_name, "rm", maxw=name_max)


def feature_grid(im, items, box, cols, icon_d, icon_bg, icon_fg, label_col, label_size=28, inline=True, ring=None):
    """inline=True: icon right + label left (reference style); else icon above label."""
    if not items: return
    x0, y0, x1, y1 = box
    rows = math.ceil(len(items) / cols)
    cw, ch = (x1 - x0) / cols, (y1 - y0) / rows
    for i, (ic, lab) in enumerate(items):
        r, c = divmod(i, cols)
        n_in_row = min(cols, len(items) - r * cols)
        off = (cols - n_in_row) * cw / 2
        cx_r = x1 - off - c * cw   # RTL: first item at the right
        cy = y0 + ch * (r + .5)
        ri = round_icon(ic, icon_d, icon_bg, icon_fg, ring=ring)
        if inline:
            im.alpha_composite(ri, (int(cx_r - 14 - icon_d), int(cy - icon_d / 2)))
            text(im, (cx_r - 14 - icon_d - 12, cy), lab, label_size, 700, label_col, "rm", maxw=cw - icon_d - 40, minsize=18)
        else:
            cx = cx_r - cw / 2
            im.alpha_composite(ri, (int(cx - icon_d / 2), int(cy - icon_d / 2 - label_size * .7)))
            text(im, (cx, cy + icon_d / 2 - label_size * .7 + 10), lab, label_size, 700, label_col, "mt", maxw=cw - 12, minsize=16)


def photo_tiles(im, photos, p, boxes, r, border=None, bw=0, dark=NAVY_D, light=ROYAL):
    for i, b in enumerate(boxes):
        w, h = b[2] - b[0], b[3] - b[1]
        src = smart_crop(photos[i], w, h) if i < len(photos) else placeholder(w, h, p, dark, light)
        paste_round(im, src, b, r, border, bw)


# ------------------------------------------------------------------ one layout, three palettes
# Owner feedback 2026-10-25: a single layout for everything (wide full-bleed hero photo, info block as in the
# old "premium" design, no top strip), in three colour schemes: sale, rent, commercial (commercial wins).
PALETTES = {
    "sale": {        # navy + gold (brand)
        "bg": (10, 22, 58), "panel": (20, 38, 88), "acc": (212, 175, 105), "acc_l": (243, 222, 165),
        "text": WHITE, "muted": (168, 180, 210), "on_acc": (10, 22, 58)},
    "rent": {        # deep teal + turquoise
        "bg": (5, 46, 54), "panel": (10, 70, 80), "acc": (45, 212, 191), "acc_l": (167, 243, 230),
        "text": WHITE, "muted": (150, 196, 200), "on_acc": (5, 46, 54)},
    "commercial": {  # charcoal + electric blue
        "bg": (20, 23, 30), "panel": (36, 41, 52), "acc": (30, 144, 255), "acc_l": (125, 196, 255),
        "text": WHITE, "muted": (150, 160, 178), "on_acc": WHITE},
}
ALIASES = {"classic": "sale", "premium": "sale", "modern": "rent"}
# Rent palette candidates (owner 2026-10-25: turquoise too loud). Tomer picked "forest" (Forest & Champagne) 2026-10-25;
# choose with --rent-palette NAME or env POST_IMAGE_RENT_PALETTE=NAME.
RENT_PALETTES = {
    "teal": PALETTES["rent"],
    "copper": {      # (a) warm black graphite + muted burnt copper (warmer/browner base than commercial's blue-grey charcoal)
        "bg": (26, 21, 18), "panel": (46, 38, 33), "acc": (192, 120, 72), "acc_l": (236, 190, 152),
        "text": WHITE, "muted": (184, 166, 152), "on_acc": (26, 21, 18)},
    "forest": {      # (b) deep forest green + champagne
        "bg": (15, 38, 30), "panel": (27, 58, 46), "acc": (201, 180, 132), "acc_l": (238, 225, 192),
        "text": WHITE, "muted": (163, 186, 170), "on_acc": (15, 38, 30)},
    "espresso": {    # (c) espresso brown / taupe + sand gold
        "bg": (46, 32, 24), "panel": (72, 54, 42), "acc": (205, 170, 118), "acc_l": (240, 220, 182),
        "text": WHITE, "muted": (196, 176, 156), "on_acc": (46, 32, 24)},
}
RENT_PALETTE = os.environ.get("POST_IMAGE_RENT_PALETTE", "forest")


def auto_variant(p):
    if p.get("category") == "commercial": return "commercial"
    return "rent" if p.get("deal_type") == "rent" else "sale"


def hexc(c): return "#%02X%02X%02X" % c


def layout(p, f, photos, logo, meta, W, H, pal):
    BG, PANEL, ACC, ACC_L, TXT, MUTED, ON = (pal[k] for k in ("bg", "panel", "acc", "acc_l", "text", "muted", "on_acc"))
    im = Image.new("RGBA", (W, H), BG + (255,))
    sq = H < 1200
    com = p.get("category") == "commercial"
    # --- what goes below the hero (decides the hero height)
    stats = []
    if f["price"]: stats.append((f["price"], f["price_suf"] or "מחיר"))
    if f["rooms"]: stats.append((f["rooms"], "חדרים"))
    if f["sqm_num"]:
        stats.append((f["sqm_num"], 'מ"ר מגרש' if Q.is_lot(p) else 'מ"ר בנוי' if p.get("built_size_sqm") and not com else 'מ"ר'))
    if (com or Q.is_lot(p)) and f["ppsqm_num"]:
        stats.append((f["ppsqm_num"], 'למ"ר' + (" לחודש" if p.get("deal_type") == "rent" else "")))
    if f["floor"] and len(stats) < 4: stats.append((f["floor"], "קומה"))
    stats = stats[:4]
    items = panel_items(f, p, 6, skip=("sqm", "floor", "ppsqm", "movein", "condition", "garden"))
    if sq: items = items[:3]
    feat_h = 0 if not items else (130 if len(items) > 3 else 78)
    extra = photos[1:4] if not sq else []
    thumb_h = 196 if extra else 0
    bar_h = 118 if not sq else 100
    stats_h = 128 if stats else 0
    fixed = 6 + stats_h + (thumb_h + 16 if extra else 0) + (feat_h + 10 if items else 0) + bar_h + 40 + 14
    hero_h = max(560 if not sq else 520, min(1000, H - fixed))
    # --- hero, full bleed, no top strip
    src = smart_crop(photos[0], W, hero_h) if photos else placeholder(W, hero_h, p, BG, PANEL)
    im.paste(src, (0, 0))
    top = Image.linear_gradient("L").rotate(180).resize((W, 230)).point(lambda v: int(v * .6))
    ov = Image.new("RGBA", (W, 230), (0, 0, 0, 0)); ov.putalpha(top); im.alpha_composite(ov, (0, 0))
    fade = Image.linear_gradient("L").resize((W, 430)).point(lambda v: int(min(255, v * 1.04)))
    ov = Image.new("RGBA", (W, 430), BG + (0,)); ov.putalpha(fade); im.alpha_composite(ov, (0, hero_h - 430))
    ImageDraw.Draw(im).rectangle((18, 18, W - 18, H - 18), outline=ACC + (210,), width=2)
    # --- logos: site lockup chip left, agency right
    hh = 104 if not sq else 90
    lock = brand_lockup(hh + 4)
    im.alpha_composite(lock, (40 - GLOW_PAD, 36 - GLOW_PAD))
    if logo is not None or f["agency"]:
        aw = agency_card_width(logo, hh, pad=12, minw=150, maxw=380, f=f)
        agency_block(im, logo, meta, f, (W - 38 - aw, 38, W - 38, 38 + hh))
    ribbons(im, f, W - 38, 38 + hh + 16)
    # --- title block over the fade: deal pill + type, place, street, highlight
    hl = highlight(f, p, ppsqm=False)
    street = " ".join(x for x in (p.get("street"), p.get("house_number")) if x)
    big = f["place"] or f["title"]
    y = hero_h - 34 - (40 if hl else 0) - (46 if street else 0) - 92 - 62
    deal = f["deal"]; dw = tw(deal, 34, 800) + 48
    kind = f["title"] if f["title"] != big else f["type"]
    kw = tw(kind, 34, 700) if kind else 0
    row_w = dw + (18 + kw if kind else 0); x_r = W / 2 + row_w / 2
    shadow_box(im, (x_r - dw, y, x_r, y + 54), 27, blur=8, alpha=110, off=(0, 3))
    rrect(im, (x_r - dw, y, x_r, y + 54), 27, fill=ACC)
    text(im, (x_r - dw / 2, y + 28), deal, 34, 800, ON, "mm")
    if kind:
        text(im, (x_r - dw - 18, y + 28), kind, 34, 700, ACC_L, "rm", maxw=W - 140 - dw, shadow=(0, 2, (0, 0, 0, 200), 5))
    y += 62
    text(im, (W / 2, y + 46), big, 74, 900, TXT, "mm", maxw=W - 120, shadow=(0, 3, (0, 0, 0, 210), 8))
    y += 92
    if street:
        sw = tw(street, 32, 600); s = fit(street, 32, 600, W - 200); sw = tw(street, s, 600)
        pin = icon("pin", 32, ACC); x0 = W / 2 - (sw + 42) / 2
        im.alpha_composite(pin, (int(x0 + sw + 10), int(y + 4)))
        text(im, (x0 + sw, y + 21), street, s, 600, TXT, "rm", shadow=(0, 2, (0, 0, 0, 200), 5))
        y += 46
    if hl:
        text(im, (W / 2, y + 18), hl, 29, 500, ACC_L, "mm", maxw=W - 140)
    y = hero_h + 6
    # --- number tiles with thin separators
    if stats:
        k = len(stats); sw = (W - 120) / k
        for i, (v, lab) in enumerate(stats):
            cx = W - 60 - sw * (i + .5)
            text(im, (cx, y + 46), v, 58 if i == 0 else 54, 800, ACC_L if i == 0 else TXT, "mm", maxw=sw - 20)
            text(im, (cx, y + 96), lab, 26, 500, MUTED, "mm", maxw=sw - 16)
            if i: ImageDraw.Draw(im).line([(W - 60 - sw * i, y + 20), (W - 60 - sw * i, y + 108)], fill=ACC + (130,), width=2)
        y += stats_h
    bar = (40, H - 40 - bar_h, W - 40, H - 40)
    # --- extra photos row: 1-3 tiles, centred
    if extra:
        k = len(extra); gap = 14
        tw_ = (W - 80 - gap * 2) // 3 if k < 3 else (W - 80 - gap * (k - 1)) // k
        if k == 2: tw_ = (W - 80 - gap) // 2
        if k == 1: tw_ = (W - 80) // 2
        row = k * tw_ + gap * (k - 1); xr = W / 2 + row / 2
        for i, ph in enumerate(extra):
            bx = (int(xr - (i + 1) * tw_ - i * gap), y, int(xr - i * tw_ - i * gap), y + thumb_h)
            paste_round(im, smart_crop(ph, bx[2] - bx[0], thumb_h), bx, 8, ACC, 2)
        y += thumb_h + 16
    if items:
        feature_grid(im, items, (40, y, W - 40, y + feat_h), 2 if len(items) in (2, 4) else 3, 52, PANEL, ACC_L, TXT, 27, ring=ACC)
    contact_bar(im, f, bar, PANEL, TXT, ACC_L, ACC, ON, MUTED, radius=14, border=ACC)
    return im


def render(p, variant="auto", size=(1080, 1350)):
    v = ALIASES.get(variant, variant)
    v = auto_variant(p) if v == "auto" else v
    f = facts(p)
    photos = pick_photos(p, 4)
    logo, meta = agency_logo(p)
    pal = RENT_PALETTES.get(RENT_PALETTE, PALETTES["rent"]) if v == "rent" else PALETTES[v]
    im = layout(p, f, photos, logo, meta, *size, pal)
    return im.convert("RGB"), v, f, len(photos)


def build_post_image(p, out, variant="auto", size=(1080, 1350)):
    """Used by queue.py for group posts. Writes the single designed graphic to `out` and returns
    {"image": out, "variant": v, "photos": n}; when the listing has no usable photo (none, all flagged
    has_branding, or downloads failed) nothing is written and {"image": None, ...} is returned (text-only post)."""
    if not pick_photos(p, 1):
        return {"image": None, "variant": None, "photos": 0}
    im, v, f, n = render(p, variant, size)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmp = out + ".tmp.jpg"
    im.save(tmp, quality=92, optimize=True, progressive=True); os.replace(tmp, out)
    return {"image": out, "variant": v, "photos": n}


def contact_sheet(src_dir, out, cols=3, tile_w=360):
    files = sorted(x for x in os.listdir(src_dir) if x.lower().endswith(".jpg") and not x.startswith("contact_sheet"))
    if not files: sys.exit("no jpgs")
    ims = [Image.open(os.path.join(src_dir, x)).convert("RGB") for x in files]
    th = max(int(tile_w * im.height / im.width) for im in ims)
    rows = math.ceil(len(ims) / cols); lab = 40
    sheet = Image.new("RGB", (cols * (tile_w + 20) + 20, rows * (th + lab + 20) + 20), (235, 237, 242))
    dr = ImageDraw.Draw(sheet)
    for i, (fn, im) in enumerate(zip(files, ims)):
        r, c = divmod(i, cols); x = 20 + c * (tile_w + 20); y = 20 + r * (th + lab + 20)
        t = im.resize((tile_w, int(tile_w * im.height / im.width)), Image.LANCZOS); sheet.paste(t, (x, y))
        dr.text((x, y + t.height + 6), fn, font=F(20, 600), fill=(30, 30, 40))
    sheet.save(out, quality=90); return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("property", nargs="?", help="properties.id (uuid) or listing_number")
    ap.add_argument("--variant", default="auto", choices=["auto"] + list(PALETTES) + list(ALIASES),
                    help="colour scheme: auto (commercial > rent > sale), sale, rent, commercial; old names classic/premium->sale, modern->rent")
    ap.add_argument("--size", default="1080x1350", help="1080x1350 (default, 4:5) or 1080x1080")
    ap.add_argument("--rent-palette", choices=list(RENT_PALETTES), help="rent colour candidate (default forest / env POST_IMAGE_RENT_PALETTE)")
    ap.add_argument("--snapshot", help="snapshot JSON (default queue/snapshot_raw.json, then queue/state.json)")
    ap.add_argument("--out")
    ap.add_argument("--contact-sheet", metavar="DIR")
    a = ap.parse_args()
    if a.contact_sheet:
        print(contact_sheet(a.contact_sheet, a.out or os.path.join(a.contact_sheet, "contact_sheet.jpg"))); return
    if not a.property: ap.error("property required")
    p = find_prop(a.property, a.snapshot)
    W, H = (int(x) for x in a.size.lower().split("x"))
    global RENT_PALETTE
    if a.rent_palette: RENT_PALETTE = a.rent_palette
    im, v, f, n = render(p, a.variant, (W, H))
    out = a.out or os.path.join(Q.asset_dir(p), f"post_image_{v}_{W}x{H}.jpg")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.save(out, quality=92, optimize=True, progressive=True)
    print(json.dumps({"out": out, "listing": p.get("listing_number"), "variant": v, "photos": n,
                      "agent": f["agent"], "agency": f["agency"], "phone": f["phone"],
                      "agency_logo": bool(p.get("agency_logo"))}, ensure_ascii=False))


if __name__ == "__main__":
    main()
