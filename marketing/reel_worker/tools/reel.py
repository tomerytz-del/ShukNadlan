#!/usr/bin/env python3
"""Stories + Reel builder for one listing (sample tooling; nothing is posted).

    reel.py stories <listing_number>          -> <n>/story/story_01.jpg ...
    reel.py reel    <listing_number> [--long] [--female] [--no-outro] [--synth-music]
        default: 15s (5 slides, cuts on the beat) + 2.5s brand outro, male voice (he-IL-AvriNeural +20%/+8Hz)
        -> <n>/reel/reel_voice_male_final.mp4 + reel_music_15s_final.mp4
        --long -> ~25s 7-slide cut: reel_voice_<gender>.mp4 + reel_music_v2.mp4
        --layout A|B|C  on-screen layout (A = current default; B/C = redesign mockups, see build_mockup)
    reel.py mockup  <listing_number> --layout B|C   -> <n>/reel/mockup_<L>/frame_*.png + preview_<L>.mp4 (~5s)

Photo selection uses property_image_tags (from the snapshot, queue/state.json): opener = exterior
without third-party branding (else living room), then living room, kitchen, balcony, bedroom,
bathroom ... (one per room type, has_branding=true skipped), max 6 photos + a closing card.
Override with <n>/story/selection.json: [{"url": "...", "title": "...", "sub": "...", "vo": "..."}].
Captions/voiceover use only structured facts (copy rules: no superlatives, no long dashes).
Music: brand/music/tracks.json (default: "Funky House" by Of Far Different Nature, CC0, 128 BPM); --synth-music
uses tools/music_bed.py. TTS: edge-tts (Microsoft neural he-IL). Outro: brand/outro_1080x1920.mp4 (tools/outro.py).
"""
import os as _os, sys as _sys
# tools/queue.py shadows the stdlib "queue" module; drop this dir from sys.path before stdlib imports
_sys.path[:] = [x for x in _sys.path if _os.path.abspath(x or ".") != _os.path.dirname(_os.path.abspath(__file__))]
import argparse, asyncio, html as H, importlib.util, json, os, re, shutil, subprocess, sys
from PIL import Image, ImageFilter, ImageOps

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


Q = _load("fbqueue", os.path.join(TOOLS, "queue.py"))
WM = _load("fbwatermark", os.path.join(TOOLS, "watermark.py"))
W, HGT, FPS, XF = 1080, 1920, 30, 0.5
ROOM_ORDER = ["living_room", "kitchen", "balcony", "master_bedroom", "bedroom", "bathroom", "mamad", "dining_room", "garden", "other"]
LABEL = {"living_room": "סלון", "kitchen": "מטבח", "balcony": "מרפסת", "master_bedroom": "חדר שינה", "bedroom": "חדר שינה",
         "bathroom": "חדר רחצה", "mamad": 'ממ"ד', "dining_room": "פינת אוכל", "garden": "גינה", "office": "משרד",
         "storefront": "חזית", "facade": "", "yard": "", "other": ""}
ROOMS_WORD = {1: "חדר אחד", 1.5: "חדר וחצי", 2: "שני חדרים", 2.5: "שניים וחצי חדרים", 3: "שלושה חדרים", 3.5: "שלושה וחצי חדרים",
              4: "ארבעה חדרים", 4.5: "ארבעה וחצי חדרים", 5: "חמישה חדרים", 5.5: "חמישה וחצי חדרים", 6: "שישה חדרים",
              7: "שבעה חדרים", 8: "שמונה חדרים"}
FLOOR_WORD = {0: "קומת קרקע", 1: "קומה ראשונה", 2: "קומה שנייה", 3: "קומה שלישית", 4: "קומה רביעית", 5: "קומה חמישית",
              6: "קומה שישית", 7: "קומה שביעית", 8: "קומה שמינית", 9: "קומה תשיעית", 10: "קומה עשירית"}


def chrome(html_path, out_png, transparent=False):
    WM.chrome_shot(html_path, out_png, W, HGT, transparent=transparent)


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode:
        sys.exit("command failed: " + " ".join(cmd[:6]) + "\n" + r.stderr[-2000:])
    return r.stdout


def dur(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).strip())


def prop(n):
    st = Q.load_json(Q.STATE)
    for p in st["properties"].values():
        if str(p["listing_number"]) == str(n):
            return p, st
    sys.exit(f"listing {n} not in queue/state.json (run queue.py sync)")


# ------------------------------------------------------------------ selection + captions
def select_photos(p, maxn=6):
    imgs = [u for u in (p.get("images") or []) if u]
    tags = {t["url"]: t for t in (p.get("image_tags") or [])}
    pos = {u: i for i, u in enumerate(imgs)}
    ok = [u for u in imgs if not (tags.get(u) or {}).get("has_branding")]
    def rt(u): return (tags.get(u) or {}).get("room_type")
    def main_first(us): return sorted(us, key=lambda u: ((tags.get(u) or {}).get("space_role") != "main", pos[u]))
    ext = main_first([u for u in ok if (tags.get(u) or {}).get("photo_type") == "exterior"])
    pick = []
    opener = ext[0] if ext else (main_first([u for u in ok if rt(u) == "living_room"]) or ok or imgs)[0]
    pick.append((opener, "opener"))
    for r in ROOM_ORDER:
        if len(pick) >= maxn: break
        c = main_first([u for u in ok if rt(u) == r and u not in [x for x, _ in pick]])
        if c and not (r == "bedroom" and any(k == "master_bedroom" for _, k in pick)):
            pick.append((c[0], r))
    for u in ok:  # untagged / leftovers, in listing order
        if len(pick) >= min(maxn, 5): break
        if u not in [x for x, _ in pick]:
            pick.append((u, rt(u) or "other"))
    return pick


def facts(p):
    out = []
    sz = Q.size_of(p)
    a = " · ".join(x for x in (f"{Q.fmt_num(p['rooms'])} חדרים" if p.get("rooms") and p["category"] == "residential" else None,
                                f'{Q.fmt_num(sz)} מ"ר' if sz else None) if x)
    if a: out.append(("size", a))
    if Q.floor_text(p): out.append(("floor", Q.floor_text(p)))
    fs = Q.features(p, 4)
    if fs: out.append(("features", " · ".join(Q.FEAT[f] for f in fs)))
    return out


def spoken(t):
    t = t.replace('מ"ר', "מטר").replace("מ״ר", "מטר").replace(" · ", ", ").replace("·", ",")
    t = re.sub(r"₪\s*([\d,]+)", r"\1 שקלים", t)
    return Q.nodash(t)


def spoken_rooms(p):
    r = p.get("rooms")
    return ROOMS_WORD.get(float(r) if r and float(r) != int(r) else int(r), f"{Q.fmt_num(r)} חדרים") if r else None


def hook(p):
    city = p.get("city") or ""
    if p["category"] == "commercial":
        return f"מחפשים {Q.type_phrase(p)} {Q.deal_word(p)} ב{city}?"
    kind = "דירה" if p.get("property_type") in ("דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "טריפלקס") else "בית"
    return f"מחפשים {kind}{' להשכרה' if p['deal_type'] == 'rent' else ''} ב{city}?"


def plan(p):
    sel_path = os.path.join(Q.asset_dir(p), "story", "selection.json")
    if os.path.exists(sel_path):
        return json.load(open(sel_path, encoding="utf-8"))
    pick = select_photos(p)
    fq = facts(p)
    city, nb = p.get("city") or "", p.get("neighborhood")
    slides = []
    for i, (u, kind) in enumerate(pick):
        if kind == "opener":
            title = Q.type_phrase(p)
            sub = ", ".join(x for x in (nb, city) if x)
            kick = ""  # deal type is already in the top tag
            rooms_sp = spoken_rooms(p) if p["category"] == "residential" else None
            tp = Q.type_phrase(p) if not rooms_sp or p.get("property_type") != "דירה" else f"דירת {rooms_sp}"
            loc_sp = (nb[1:] if nb.startswith("ה") else nb) if nb else city
            vo = f"{hook(p)} {tp} {Q.deal_word(p)} ב{loc_sp}."
        else:
            title = LABEL.get(kind, "")
            f = None
            while fq:
                k, v = fq.pop(0)
                if k == "features":
                    v = " · ".join(x for x in v.split(" · ") if x != title)
                if v: f = (k, v); break
            sub = f[1] if f else ""
            kick = ""
            if not title and sub:
                title, sub = sub, ""
            sp_sub = sub
            if f and f[0] == "floor" and p.get("floor") in FLOOR_WORD and not p.get("total_floors"):
                sp_sub = FLOOR_WORD[p["floor"]]
            if f and f[0] == "size" and spoken_rooms(p):
                sp_sub = sub.replace(f"{Q.fmt_num(p['rooms'])} חדרים", spoken_rooms(p))
            vo = ", ".join(x for x in (title, sp_sub) if x) + "."
        slides.append({"url": u, "kind": kind, "kicker": kick, "title": Q.nodash(title), "sub": Q.nodash(sub), "vo": spoken(vo)})
    num, suf = Q.price_parts(p)
    contact = ", ".join(x for x in (p.get("agent_name"), p.get("agency_name")) if x)
    vo = (f"{num} שקלים{(' ' + suf) if suf else ''}. " if num else "") + (f"לפרטים: {contact}." if contact else "")
    slides.append({"url": None, "kind": "closing", "vo": spoken(vo)})
    for s in slides:
        s["vo"] = s["vo"].replace('+ מע"מ', 'פלוס מע"מ')
    return slides


# ------------------------------------------------------------------ rendering
CSS = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;overflow:hidden;background:transparent}
body{font-family:'Rubik','IBM Plex Sans Hebrew',sans-serif;color:#fff;direction:rtl}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.shade{position:absolute;inset:0;background:linear-gradient(to top,rgba(8,30,26,.95) 0%,rgba(8,30,26,.88) 22%,rgba(8,30,26,.35) 42%,rgba(8,30,26,0) 55%),linear-gradient(to bottom,rgba(0,0,0,.38) 0%,rgba(0,0,0,0) 22%)}
.tag{position:absolute;top:262px;right:48px;max-width:640px;background:#0f5c4d;color:#fff;font-weight:700;font-size:40px;padding:12px 30px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.num{position:absolute;top:270px;left:48px;background:rgba(255,255,255,.92);color:#0f3b33;font-weight:600;font-size:26px;padding:11px 22px;border-radius:12px}
.cap{position:absolute;right:64px;left:64px;bottom:560px;text-align:right}
.kick{display:inline-block;background:#ffd47a;color:#0f3b33;font-weight:700;font-size:34px;padding:6px 20px;border-radius:10px;margin-bottom:18px}
.title{font-size:84px;font-weight:800;line-height:1.08;text-shadow:0 3px 12px rgba(0,0,0,.35)}
.sub{font-size:44px;font-weight:500;margin-top:14px;opacity:.95;line-height:1.25}
.bar{width:120px;height:6px;background:#9be3c9;border-radius:3px;margin-top:22px;margin-right:0}
.foot{position:absolute;left:48px;right:48px;bottom:360px;height:130px;display:flex;align-items:center;justify-content:space-between;direction:ltr}
.lock{display:flex;align-items:center;gap:16px}
.lock img{height:118px;display:block}
.lock .bw{font-weight:800;font-size:40px;line-height:1.05;direction:rtl;text-align:right}
.lock .bd{font-size:22px;font-weight:500;color:rgba(255,255,255,.88);margin-top:6px;padding-top:5px;border-top:2px solid #9be3c9;direction:ltr;text-align:right}
.card{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.95);border-radius:16px;padding:10px 16px;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:560px;direction:ltr}
.card .t{direction:rtl;text-align:right;color:#0f3b33;min-width:0}
.card .n{font-size:32px;font-weight:700;line-height:1.12;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;max-width:400px}
.card .a{font-size:24px;font-weight:500;opacity:.8;line-height:1.15;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;max-width:400px;margin-top:3px}
.card .lg{height:60px;max-width:140px;object-fit:contain;border-radius:8px}
.card .bd2{height:70px;width:70px;object-fit:contain}
/* closing */
.cl{position:absolute;left:64px;right:64px;top:250px;bottom:350px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0}
.cl .lockc{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:34px}
.cl .lockc img{height:210px}
.cl .lockc .bw{font-weight:800;font-size:64px}
.cl .ctag{background:#0f5c4d;border:2px solid #9be3c9;font-weight:700;font-size:48px;padding:10px 28px;border-radius:14px}
.cl .loc{font-size:62px;font-weight:700;margin-top:28px}
.cl .nb{font-size:42px;opacity:.9;margin-top:6px}
.cl .price{font-size:150px;font-weight:800;color:#ffd47a;margin-top:26px;line-height:1}
.cl .pn{direction:ltr;unicode-bidi:isolate}
.cl .ps{font-size:44px;font-weight:600;margin-right:14px}
.cl .bcard{margin-top:40px;background:rgba(255,255,255,.96);color:#0f3b33;border-radius:22px;padding:20px 30px;display:flex;align-items:center;gap:22px;direction:ltr;box-shadow:0 8px 26px rgba(0,0,0,.3)}
.cl .bcard .t{direction:rtl;text-align:right}
.cl .bcard .n{font-size:56px;font-weight:800}
.cl .bcard .a{font-size:38px;font-weight:500;opacity:.85;margin-top:4px}
.cl .bcard .ph{font-size:58px;font-weight:700;direction:ltr;unicode-bidi:isolate;margin-top:6px;color:#0f5c4d}
.cl .bcard .lg{height:96px;max-width:200px;object-fit:contain}
.cl .bcard .bd2{height:140px;width:140px}
.cl .site{font-size:48px;font-weight:600;direction:ltr;margin-top:34px;color:#9be3c9}
.cl .lnum{font-size:34px;opacity:.85;margin-top:10px}
.cl .disc{font-size:30px;opacity:.75;margin-top:18px}
.clbg{position:absolute;inset:0;background:linear-gradient(rgba(8,40,34,.86),rgba(8,30,26,.94))}
/* navy closing theme (matches brand outro A; colours sampled from the logo) */
.navy .clbg{background:radial-gradient(ellipse at 50% 30%,rgba(26,50,112,.88) 0%,rgba(10,22,58,.93) 55%,rgba(4,9,28,.97) 100%)}
.navy .cl .lockc img{filter:drop-shadow(0 0 3px #fff) drop-shadow(0 0 18px rgba(212,178,112,.55)) drop-shadow(0 8px 14px rgba(0,0,0,.5))}
.navy .cl .ctag{background:#16307a;border-color:#d9b876}
.navy .cl .price{color:#e6c27e}
.navy .cl .site{color:#d9b876}
.navy .cl .bcard{color:#0c2258}
.navy .cl .bcard .ph{color:#16307a}
"""


def card_html(p, big=False):
    e = H.escape
    lg = '<img class="lg" src="agency_logo.png">' if os.path.exists(os.path.join(CUR, "agency_logo.png")) else ""
    bd = ""   # no ethics badge on story / reel broker cards (owner rule 2026-10-24)
    ph = f'<div class="ph">{e(Q.fmt_phone(p.get("agent_phone")))}</div>' if big and p.get("agent_phone") else ""
    ag = p.get("agency_name") if p.get("agency_name") != p.get("agent_name") else ""
    return (f'<div class="{"bcard" if big else "card"}">{lg}<div class="t"><div class="n">{e(Q.nodash(p.get("agent_name") or ""))}</div>'
            + (f'<div class="a">{e(Q.nodash(ag))}</div>' if ag else "") + ph + f'</div>{bd}</div>')


def slide_html(p, s, idx, mode, disc):
    """mode: story (all layers), static (transparent overlay w/o caption), caption (transparent caption only)"""
    e = H.escape
    tag = e(Q.nodash(f"{Q.deal_word(p)} | {Q.type_phrase(p)}"))
    parts = []
    if s["kind"] == "closing":
        num, suf = Q.price_parts(p)
        street, city = (p.get("street") or "").strip(), p.get("city") or ""
        loc = f"רחוב {street}, {city}" if street else city
        price = (f'<div class="price"><span class="pn">₪{num}</span>' + (f'<span class="ps">{e(suf)}</span>' if suf else "") + "</div>") if num else ""
        inner = (f'<div class="cl"><div class="lockc"><img src="logo.png"><div class="bw">שוק הנדל״ן</div></div>'
                 f'<div class="ctag">{tag}</div><div class="loc">{e(Q.nodash(loc))}</div>'
                 + (f'<div class="nb">{e(p["neighborhood"])}</div>' if p.get("neighborhood") else "")
                 + price + card_html(p, big=True)
                 + f'<div class="site">shuknadlan.co.il</div><div class="lnum">מודעה מס\' {p["listing_number"]}</div>'
                 # disc = Q.disclosure_for(p): Tomer's licence line only on his own listings. For other agents it is
                 # SITE_LINE, which this card already shows (lockup "שוק הנדל״ן" + the site line), so it is not repeated.
                 + (f'<div class="disc">{e(Q.nodash(disc))}</div>' if disc and disc != Q.SITE_LINE else "") + '</div>')
        if mode in ("story", "static"):
            parts.append(f'<div class="bg" style="background-image:url(bg_{idx:02d}.jpg)"></div><div class="clbg"></div>' if mode == "story" else '<div class="clbg"></div>')
        if mode in ("story", "caption"):
            parts.append(inner)
    else:
        if mode == "story":
            parts.append(f'<div class="bg" style="background-image:url(bg_{idx:02d}.jpg)"></div>')
        if mode in ("story", "static"):
            parts.append('<div class="shade"></div>'
                         f'<div class="tag">{tag}</div><div class="num">מודעה מס\' {p["listing_number"]}</div>'
                         '<div class="foot"><div class="lock"><img src="logo.png"><div><div class="bw">שוק הנדל״ן</div>'
                         '<div class="bd">shuknadlan.co.il</div></div></div>' + card_html(p) + '</div>')
        if mode in ("story", "caption"):
            parts.append('<div class="cap">' + (f'<div class="kick">{e(s["kicker"])}</div>' if s.get("kicker") else "")
                         + (f'<div class="title">{e(s["title"])}</div>' if s.get("title") else "")
                         + (f'<div class="sub">{e(s["sub"])}</div>' if s.get("sub") else "") + '<div class="bar"></div></div>')
    return f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>{CSS}</style></head><body class="{CLOSE_THEME if s["kind"] == "closing" else ""}">{"".join(parts)}</body></html>'


# ------------------------------------------------------------------ layouts B / C (mockups, 2026-10-24; default stays "A")
# Instagram Reels safe zone on 1080x1920: nothing important above y=154 (top 8%), below y=1536 (bottom 20%)
# or right of x=918 (right 15%, IG action buttons). Brand: navy #0c2258 / royal #2f417c / gold #c1a371..#e6c27e.
LAYOUT = "A"
SAFE_TOP, SAFE_BOTTOM, SAFE_RIGHT = 154, 1536, 918
CSS_V2 = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;overflow:hidden;background:transparent}
body{font-family:'Rubik','IBM Plex Sans Hebrew',sans-serif;color:#fff;direction:rtl}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.pn{direction:ltr;unicode-bidi:isolate}
.topshade{position:absolute;left:0;right:0;top:0;height:560px;background:linear-gradient(to bottom,rgba(4,12,38,.72) 0%,rgba(4,12,38,.45) 45%,rgba(4,12,38,0) 100%)}
.botshade{position:absolute;left:0;right:0;bottom:0;height:1000px;background:linear-gradient(to top,rgba(4,12,38,.96) 0%,rgba(6,16,48,.9) 38%,rgba(8,22,62,.55) 62%,rgba(8,22,62,0) 100%)}
/* logo lockup (top-left) */
.lock{display:flex;align-items:center;gap:12px;direction:ltr}
.lock img{height:86px;display:block;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45))}
.lock .bw{font-weight:800;font-size:32px;line-height:1.05;direction:rtl;text-align:right;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.45)}
.lock .bd{font-size:18px;font-weight:500;color:rgba(255,255,255,.9);margin-top:5px;padding-top:4px;border-top:2px solid #d9b876;direction:ltr;text-align:right}
/* listing tag */
.lt{display:inline-flex;align-items:center;gap:10px;border:2px solid #d9b876;color:#f4e2b5;background:rgba(12,34,88,.62);border-radius:999px;padding:7px 20px 8px;font-size:25px;font-weight:500;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.3)}
.lt b{font-weight:800;color:#e6c27e;font-size:28px}
/* deal + price (top-right, inside the IG safe zone) */
.deal{display:inline-block;background:rgba(12,34,88,.9);border:2px solid #d9b876;color:#fff;font-weight:700;font-size:34px;padding:8px 24px 9px;border-radius:14px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.price{font-weight:800;color:#e6c27e;line-height:1;white-space:nowrap;text-shadow:0 3px 14px rgba(0,0,0,.55)}
.psuf{font-size:30px;font-weight:600;color:#fff;margin-right:10px}
/* room caption */
.cap{position:absolute;text-align:right}
.cap .title{font-size:78px;font-weight:800;line-height:1.05;text-shadow:0 3px 12px rgba(0,0,0,.45)}
.cap .sub{font-size:40px;font-weight:500;margin-top:10px;opacity:.95;text-shadow:0 2px 8px rgba(0,0,0,.45)}
.cap .bar{width:110px;height:6px;background:#d9b876;border-radius:3px;margin-top:18px;margin-right:0}
/* agent card */
.ag{display:flex;align-items:center;gap:20px;direction:rtl}
.ag .av{flex:none;border-radius:50%;object-fit:cover;border:4px solid #d9b876;background:#0c2258;display:block}
.ag .ini{flex:none;border-radius:50%;border:4px solid #d9b876;background:radial-gradient(circle at 35% 30%,#2f417c,#0c2258);color:#e6c27e;font-weight:800;display:flex;align-items:center;justify-content:center}
.ag .t{min-width:0;text-align:right}
.ag .n{font-weight:800;line-height:1.1;white-space:normal;overflow-wrap:anywhere;text-wrap:balance}
.ag .a{font-weight:500;line-height:1.15;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;opacity:.85}
.ag .ph{font-weight:700;direction:ltr;unicode-bidi:isolate;white-space:nowrap}
.ag .alg{flex:none;object-fit:contain;background:#fff;border-radius:10px;padding:6px}
/* ---- B: clean corners, agent card lower-third left */
.B .lockpos{position:absolute;top:172px;left:48px}
.B .ltpos{position:absolute;top:290px;left:48px}
.B .tr{position:absolute;top:172px;right:162px;display:flex;flex-direction:column;align-items:flex-start;gap:12px}
.B .price{font-size:84px}
.B .cap{right:162px;left:48px;bottom:640px}
.B .ag{position:absolute;left:48px;bottom:396px;max-width:700px;background:rgba(255,255,255,.96);color:#0c2258;border-radius:24px;padding:16px 26px 16px 22px;box-shadow:0 10px 30px rgba(0,0,0,.35);border-bottom:5px solid #d9b876}
.B .ag .av,.B .ag .ini{width:132px;height:132px}
.B .ag .ini{font-size:50px}
.B .ag .n{font-size:40px;max-width:430px}
.B .ag.long .n{font-size:31px}
.B .ag .a{font-size:26px;margin-top:2px;max-width:400px}
.B .ag .ph{font-size:34px;color:#16307a;margin-top:6px}
.B .ag .alg{height:84px;max-width:150px}
/* ---- C: bold navy/gold glass bar on top + full lower-third agent bar */
.C .bartop{position:absolute;top:166px;left:36px;right:162px;height:262px;border-radius:30px;background:linear-gradient(135deg,rgba(12,34,88,.9) 0%,rgba(47,65,124,.84) 100%);border:2px solid rgba(217,184,118,.9);box-shadow:0 14px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.18);backdrop-filter:blur(10px)}
.C .bartop .gl{position:absolute;left:0;right:0;top:0;height:6px;border-radius:30px 30px 0 0;background:linear-gradient(90deg,#c1a371,#e6c27e,#c1a371)}
.C .lockpos{position:absolute;top:196px;left:64px}
.C .lock img{height:96px}
.C .ltpos{position:absolute;top:326px;left:64px}
.C .tr{position:absolute;top:194px;right:192px;display:flex;flex-direction:column;align-items:flex-start;gap:14px}
.C .deal{background:linear-gradient(90deg,#c1a371,#e6c27e);color:#0c2258;border:0;font-size:32px}
.C .price{font-size:86px;text-shadow:0 3px 10px rgba(0,0,0,.35)}
.C .cap{right:162px;left:48px;bottom:668px}
.C .cap .kick{display:inline-block;background:rgba(12,34,88,.85);border:2px solid #d9b876;color:#f4e2b5;font-size:30px;font-weight:600;padding:6px 20px;border-radius:999px;margin-bottom:14px}
.C .cap .title{font-size:96px}
.C .agbar{position:absolute;left:36px;right:162px;top:1318px;height:200px;border-radius:30px;background:linear-gradient(135deg,rgba(12,34,88,.94),rgba(22,48,122,.9));border:2px solid rgba(217,184,118,.9);box-shadow:0 14px 40px rgba(0,0,0,.45)}
.C .ag{position:absolute;left:62px;right:186px;top:1338px;height:160px;color:#fff}
.C .ag .av,.C .ag .ini{width:160px;height:160px;border-width:5px;box-shadow:0 8px 22px rgba(0,0,0,.45)}
.C .ag .ini{font-size:60px}
.C .ag .n{font-size:44px}
.C .ag.long .n{font-size:32px}
.C .ag .a{font-size:27px;margin-top:2px;color:#f4e2b5;opacity:1}
.C .ag .ph{font-size:38px;color:#e6c27e;margin-top:6px}
.C .ag .alg{height:96px;max-width:170px;margin-right:auto}
.C .ag .cta{margin-right:auto;flex:none;border:2px solid #d9b876;color:#f4e2b5;border-radius:16px;padding:10px 18px;font-size:26px;font-weight:600;text-align:center;line-height:1.25}
"""

# ---- Layout D geometry: Meta Reels/Stories safe zone (FB + IG), 1080x1920 (owner requests 2026-10-24).
# Unsafe: top 14% (y < 270), bottom 35% (y > 1250), right action-icon column (x > 960 for y 900..1650); side margins ~6% (65px).
# Top block (logo / ad tag left; deal pill with location, gold price, spec row right) starts just below y 270 with 65px
# margins. Everything at y >= 900 (room title, compact navy agent bar, cutout) uses symmetric 120px margins so it clears the
# icon column; the bar sits as low as allowed (bottom edge y 1245) and is compact (156px) so the photo stays visible.
D_SAFE_TOP, D_SAFE_BOTTOM, D_MX, D_ICON_X, D_ICON_Y0, D_ICON_Y1 = 270, 1250, 65, 960, 900, 1650
D_TOP = D_SAFE_TOP + 20                      # 290: top row starts here
D_LX = W - D_ICON_X                          # 120: symmetric lower-block margin (left = right)
D_BAR_BOT, D_BAR_H = 1245, 156               # bar y 1089..1245 (5px above the bottom-35% line)
D_BAR_TOP = D_BAR_BOT - D_BAR_H
D_IN = 20                                    # inner padding of the bar
D_SIDE_W = 132                               # logo + CTA column (bar's left end)
D_FIG_R = D_LX + 24                          # figure / circle right offset (x right edge = 936)
D_CIRC = 132                                 # gold-ring circle fallback diameter
D_TXT_L = D_LX + D_IN + D_SIDE_W + 16        # 288: text block left x
D_CAP_BOT = D_BAR_TOP - 30                   # room-title block bottom edge (y 1059): sits just above the bar
D_CAP_BOT_NOBAR = D_SAFE_BOTTOM - 8          # clips without the agent bar: title block ends at y 1242 (photo middle clear)
D_NAVY_A = .76                               # navy panel opacity (pill, spec row, tag, agent bar, closing card): lighter look
D_ANIM = 0.6                                 # entry animation (first clip): top block + bar slide/fade in, ease-out
D_ANIM_A0 = 0.4                              # their opacity at frame 0 (so the default cover frame shows them)
D_ICONS = {   # 24x24 line icons (stroke = currentColor)
    "rooms": '<path d="M4 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M15 7h4v13"/><path d="M2 20h20"/><circle cx="12" cy="12.5" r=".9" fill="currentColor"/>',
    "area": '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M8 16l8-8M12 8h4v4M12 16H8v-4"/>',
    "floor": '<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/><path d="M3 20h18"/>',
    "parking": '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M10 17V7h3.5a3 3 0 0 1 0 6H10"/>',
    "elevator": '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 10l3-3 3 3M9 14l3 3 3-3"/>',
    "mamad": '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    "pin": '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
}
CSS_D = f"""
/* ---- D = B top (no bar) + compact navy agent bar, placed inside the Meta Reels safe zone */
.D .topshade{{height:620px;background:linear-gradient(to bottom,rgba(4,12,38,.62) 0%,rgba(4,12,38,.55) 40%,rgba(4,12,38,.32) 70%,rgba(4,12,38,0) 100%)}}
.D .botshade{{height:1100px;background:linear-gradient(to top,rgba(4,12,38,.97) 0%,rgba(6,16,48,.9) 30%,rgba(8,22,62,.7) 52%,rgba(8,22,62,.42) 68%,rgba(8,22,62,.18) 84%,rgba(8,22,62,0) 100%)}}
.D .lockpos{{top:{D_TOP}px;left:{D_MX}px}}
.D .lock .bw{{font-size:34px}}
.D .lock .bd{{font-size:27px;font-weight:600;color:#fff;letter-spacing:.4px;margin-top:6px;padding-top:5px;text-shadow:0 2px 8px rgba(0,0,0,.5)}}
.D .ltpos{{top:{D_TOP + 116}px;left:{D_MX}px}}
.D .lt{{font-size:18px;gap:7px;padding:5px 14px 6px;border-width:1.5px;background:rgba(12,34,88,{D_NAVY_A - .1:.2f});text-shadow:0 1px 4px rgba(0,0,0,.5)}}
.D .lt b{{font-size:20px}}
.D .tr{{top:{D_TOP}px;right:{D_MX}px;align-items:flex-start;gap:12px;max-width:{W - 2 * D_MX - 330}px}}
.D .deal{{max-width:{W - 2 * D_MX - 330}px;padding:8px 24px 10px;background:rgba(12,34,88,{D_NAVY_A});text-shadow:0 1px 6px rgba(0,0,0,.45)}}
.D .deal .loc{{display:flex;align-items:center;gap:8px;font-size:26px;font-weight:500;color:#f4e2b5;margin-top:4px;white-space:normal;text-wrap:balance;line-height:1.15}}
.D .deal .loc svg{{width:26px;height:26px;flex:none;fill:none;stroke:#e6c27e;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}}
.D .specs{{display:flex;align-items:center;gap:0;background:rgba(12,34,88,{D_NAVY_A - .04:.2f});border:1.5px solid rgba(217,184,118,.75);border-radius:16px;padding:9px 6px;text-shadow:0 1px 6px rgba(0,0,0,.45);box-shadow:0 6px 18px rgba(0,0,0,.3)}}
.D .specs .sp{{display:flex;align-items:center;gap:8px;padding:0 16px;font-size:28px;font-weight:600;color:#fff;white-space:nowrap;line-height:1}}
.D .specs .sp + .sp{{border-right:1.5px solid rgba(217,184,118,.45)}}
.D .specs svg{{width:30px;height:30px;flex:none;fill:none;stroke:#e6c27e;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}}
.D .specs b{{font-weight:800;color:#e6c27e;direction:ltr;unicode-bidi:isolate}}
.D .cap{{right:{D_LX}px;left:{D_LX}px;bottom:{HGT - D_CAP_BOT}px}}
.D.nobar .cap{{bottom:{HGT - D_CAP_BOT_NOBAR}px}}
.D .cap .title{{font-size:74px}}
.D .cap .sub{{font-size:38px;margin-top:6px}}
.D .cap .bar{{margin-top:14px}}
.D .dbar{{position:absolute;left:{D_LX}px;right:{D_LX}px;top:{D_BAR_TOP}px;height:{D_BAR_H}px;border-radius:26px;background:linear-gradient(135deg,rgba(12,34,88,{D_NAVY_A + .04:.2f}),rgba(22,48,122,{D_NAVY_A:.2f}));border:2px solid rgba(217,184,118,.9);box-shadow:0 14px 40px rgba(0,0,0,.45)}}
.D .dbar .gl{{position:absolute;left:28px;right:28px;top:-1px;height:3px;border-radius:2px;background:linear-gradient(90deg,rgba(193,163,113,0),#e6c27e,rgba(193,163,113,0))}}
.D .dfig{{position:absolute;right:{D_FIG_R}px;bottom:{HGT - D_BAR_BOT + 2}px;width:auto;display:block;filter:drop-shadow(0 8px 14px rgba(0,0,0,.55)) drop-shadow(0 0 2px rgba(0,0,0,.35));
  -webkit-mask-image:linear-gradient(to bottom,#000 84%,rgba(0,0,0,0) 100%);mask-image:linear-gradient(to bottom,#000 84%,rgba(0,0,0,0) 100%)}}
.D .dcirc{{position:absolute;right:{D_FIG_R}px;top:{D_BAR_TOP - 50}px;width:{D_CIRC}px;height:{D_CIRC}px;border-radius:50%;object-fit:cover;border:4px solid #d9b876;box-shadow:0 12px 28px rgba(0,0,0,.55);background:#0c2258}}
.D .dt{{position:absolute;top:{D_BAR_TOP + 10}px;height:{D_BAR_H - 20}px;left:{D_TXT_L}px;display:flex;flex-direction:column;justify-content:center;text-align:right;color:#fff}}
.D .dt .n{{font-size:38px;font-weight:800;line-height:1.08;white-space:normal;overflow-wrap:anywhere;text-wrap:balance}}
.D .dt .n .a{{font-size:25px;font-weight:500;color:#f4e2b5;white-space:nowrap}}
.D .dt.long .n{{font-size:28px}}
.D .dt.long .n .a{{font-size:22px}}
.D .dt .agy{{font-size:24px;font-weight:500;color:#f4e2b5;line-height:1.12;margin-top:1px;white-space:normal;text-wrap:balance}}
.D .dt.nofig .n{{font-size:40px}}
.D .dt.nofig.long .n{{font-size:32px}}
.D .dt .ph{{font-size:33px;font-weight:700;color:#e6c27e;direction:ltr;unicode-bidi:isolate;margin-top:3px;line-height:1.08}}
.D .dt .lic{{font-size:17px;font-weight:400;color:rgba(230,214,180,.62);margin-top:3px;letter-spacing:.3px;line-height:1.1}}
.D .dside{{position:absolute;left:{D_LX + D_IN}px;top:{D_BAR_TOP + 10}px;height:{D_BAR_H - 20}px;width:{D_SIDE_W}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}}
.D .dside .alg{{max-height:58px;max-width:{D_SIDE_W}px;object-fit:contain;display:block}}
.D .alg.dark{{filter:drop-shadow(0 0 1px rgba(255,255,255,.9)) drop-shadow(0 0 6px rgba(255,255,255,.45))}}
.D .alg.boxed{{border:2px solid #d9b876;border-radius:10px}}
.D .dside .cta{{border:2px solid #d9b876;color:#0c2258;background:linear-gradient(90deg,#c1a371,#e6c27e);border-radius:13px;padding:8px 14px;font-size:26px;font-weight:700;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.3)}}
/* ---- D closing card (~2s): blurred photo + navy, agent cutout over a navy card, contact, listing line; all inside the safe zone */
.dclbg{{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,rgba(26,50,112,.78) 0%,rgba(10,22,58,.88) 55%,rgba(4,9,28,.95) 100%)}}
.dcl{{position:absolute;left:{D_LX}px;right:{D_LX}px;top:{D_TOP}px;bottom:{HGT - D_BAR_BOT}px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;color:#fff}}
.dcl .lockc{{display:flex;align-items:center;gap:16px;direction:ltr}}
.dcl .lockc img{{height:104px;display:block;filter:drop-shadow(0 0 3px #fff) drop-shadow(0 0 16px rgba(212,178,112,.5)) drop-shadow(0 8px 14px rgba(0,0,0,.5))}}
.dcl .lockc .bw{{font-weight:800;font-size:46px;line-height:1.05;direction:rtl;text-align:right}}
.dcl .lockc .bd{{font-size:30px;font-weight:600;margin-top:6px;padding-top:6px;border-top:2px solid #d9b876;direction:ltr;text-align:right}}
.dcl .mid{{display:flex;flex-direction:column;align-items:center;width:100%}}
.dcl .cfig{{height:330px;width:auto;display:block;margin-bottom:-74px;position:relative;z-index:2;filter:drop-shadow(0 12px 22px rgba(0,0,0,.55));
  -webkit-mask-image:linear-gradient(to bottom,#000 86%,rgba(0,0,0,0) 100%);mask-image:linear-gradient(to bottom,#000 86%,rgba(0,0,0,0) 100%)}}
.dcl .ccirc{{width:230px;height:230px;border-radius:50%;object-fit:cover;border:6px solid #d9b876;margin-bottom:-70px;position:relative;z-index:2;box-shadow:0 12px 28px rgba(0,0,0,.55);background:#0c2258}}
.dcl .card{{width:100%;background:linear-gradient(135deg,rgba(12,34,88,{D_NAVY_A + .04:.2f}),rgba(22,48,122,{D_NAVY_A:.2f}));border:2px solid rgba(217,184,118,.9);border-radius:32px;padding:96px 44px 36px;display:flex;flex-direction:column;align-items:center;box-shadow:0 18px 44px rgba(0,0,0,.5)}}
.dcl .card.nofig{{padding-top:40px}}
.dcl .n{{font-size:56px;font-weight:800;line-height:1.1;text-wrap:balance;overflow-wrap:anywhere}}
.dcl .long .n{{font-size:42px}}
.dcl .arow{{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:12px;direction:rtl}}
.dcl .arow .a{{font-size:34px;font-weight:500;color:#f4e2b5}}
.dcl .arow .alg{{max-height:66px;max-width:190px;object-fit:contain;display:block}}
.dcl .ph{{font-size:66px;font-weight:800;color:#e6c27e;direction:ltr;unicode-bidi:isolate;margin-top:14px;line-height:1.05}}
.dcl .lic{{font-size:23px;color:rgba(230,214,180,.66);margin-top:8px;letter-spacing:.3px}}
.dcl .cta{{margin-top:24px;border:2px solid #d9b876;color:#0c2258;background:linear-gradient(90deg,#c1a371,#e6c27e);border-radius:18px;padding:12px 54px 14px;font-size:38px;font-weight:800;box-shadow:0 6px 16px rgba(0,0,0,.35)}}
.dcl .foot{{font-size:31px;font-weight:500;color:#f4e2b5;line-height:1.3}}
.dcl .foot b{{color:#e6c27e;font-weight:800}}
.dcl .foot .dom{{direction:ltr;unicode-bidi:isolate;color:#fff;font-weight:600}}
.dcl .disc{{font-size:22px;color:rgba(255,255,255,.75);margin-top:6px}}
"""
CSS_V2 += CSS_D


def initials(name):
    w = [x for x in re.split(r"\s+", (name or "").strip()) if x]
    return "".join(x[0] for x in w[:2]) or "?"


def prep_avatar(src, dst, focus=None, px=320):
    """Square avatar from the agent photo: trims flat white/near-white margins, then crops a square around
    focus = {"cx","cy" (fractions of the trimmed photo), "size" (fraction of its short side)}."""
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    bb = im.convert("L").point(lambda v: 255 if v < 235 else 0).getbbox()
    if bb: im = im.crop(bb)
    f = {"cx": .5, "cy": .4, "size": 1.0}; f.update(focus or {})
    side = int(min(im.size) * min(1.0, f["size"]))
    cx, cy = f["cx"] * im.width, f["cy"] * im.height
    x0 = int(min(max(0, cx - side / 2), im.width - side)); y0 = int(min(max(0, cy - side / 2), im.height - side))
    im.crop((x0, y0, x0 + side, y0 + side)).resize((px, px), Image.LANCZOS).save(dst, quality=93)


def prep_agent_media(p, work):
    """Agent photo (agency_members.photo_url, snapshot field agent_photo) and agency logo (agencies.logo_url)
    are downloaded into the listing folder (<no>/agent_photo.*, <no>/agency_logo.*); the avatar crop goes to work/.
    Optional <no>/agent_photo_focus.json = {"cx":..,"cy":..,"size":..}; else photo_position "x% y%" if set."""
    d = Q.asset_dir(p)
    for f in ("agent_avatar.jpg", "agent_cutout.png", "agent_cutout.json"):   # never reuse another run's image
        if os.path.exists(os.path.join(work, f)): os.remove(os.path.join(work, f))
    if Q.agent_photo_allowed(p):
        try:
            ext = os.path.splitext(p["agent_photo"].split("?")[0])[1].lower() or ".jpg"
            raw = os.path.join(d, "agent_photo" + ext)
            if not os.path.exists(raw): Q.fetch(p["agent_photo"], raw)
            focus = None
            fj = os.path.join(d, "agent_photo_focus.json")
            if os.path.exists(fj):
                focus = json.load(open(fj))
            elif p.get("agent_photo_position"):
                m = re.findall(r"([\d.]+)%", p["agent_photo_position"])
                if len(m) >= 2: focus = {"cx": float(m[0]) / 100, "cy": float(m[1]) / 100}
            prep_avatar(raw, os.path.join(work, "agent_avatar.jpg"), focus)
            if LAYOUT == "D":
                make_cutout(p, raw, work)
        except Exception as ex:
            print("agent photo skipped (initials fallback):", ex, file=sys.stderr)
    if LAYOUT == "D":
        try:
            prep_agency_logo(p, work)
        except Exception as ex:
            print("agency logo background removal skipped:", ex, file=sys.stderr)
    if p.get("agency_logo") and os.path.exists(os.path.join(work, "agency_logo.png")):
        shutil.copyfile(os.path.join(work, "agency_logo.png"), os.path.join(d, "agency_logo.png"))


REMBG_PY = "/home/box/.venvs/rembg/bin/python"      # isolated venv: pip install "rembg[cpu]"
CUTOUT_CACHE = os.path.join(ROOT, "brand", "agent_cache")


def make_cutout(p, raw, work):
    """Layout D: background-removed head-and-shoulders of the agent (tools/cutout.py, rembg u2net_human_seg).
    Cached per agent + photo URL in brand/agent_cache/<agent_id>_<hash>.png and copied to <no>/agent_cutout.png.
    Cropped to head+shoulders (height <= 0.95 x width). On failure / a poor mask the circle fallback is used."""
    import hashlib
    dst = os.path.join(work, "agent_cutout.png")
    if os.path.exists(dst): os.remove(dst)
    os.makedirs(CUTOUT_CACHE, exist_ok=True)
    key = f'{p.get("agent_id") or Q._norm(p.get("agent_name"))}_{hashlib.sha1((p.get("agent_photo") or "").encode()).hexdigest()[:8]}'
    cache = os.path.join(CUTOUT_CACHE, key + ".png")
    if not os.path.exists(cache):
        if not os.path.exists(REMBG_PY):
            print("rembg venv missing; circle fallback", file=sys.stderr); return None
        r = subprocess.run([REMBG_PY, os.path.join(TOOLS, "cutout.py"), raw, cache], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            info = json.loads(r.stdout.strip().splitlines()[-1])
        except Exception:
            info = {"ok": False}
        if r.returncode or not info.get("ok") or info.get("coverage", 0) < 0.3:
            print("cutout rejected; circle fallback:", info, file=sys.stderr)
            if os.path.exists(cache): os.remove(cache)
            return None
    c = Image.open(cache).convert("RGBA")
    h = min(c.height, int(c.width * 0.95))
    c = c.crop((0, 0, c.width, h))
    c.save(dst); shutil.copyfile(dst, os.path.join(Q.asset_dir(p), "agent_cutout.png"))
    json.dump({"head_frac": head_fraction(c)}, open(os.path.join(work, "agent_cutout.json"), "w"))
    return dst


def head_fraction(c):
    """Head height / figure height, from the alpha width profile: the head ends where the silhouette
    widens into the shoulders (row width > 1.6 x the median head width)."""
    import numpy as np
    a = np.asarray(c.getchannel("A")) > 128
    w = a.sum(1); top = int(np.argmax(w > 0))
    head = w[top: top + max(8, c.height // 6)]
    hw = float(np.median(head[head > 0])) if (head > 0).any() else c.width * .3
    for y in range(top + 5, c.height):
        if w[y] > 1.6 * hw:
            return round(min(.6, max(.2, (y - top) / c.height)), 3)
    return .42


def prep_agency_logo(p, work):
    """Agency logo for the navy bar (layout D): the flat background (colour of the border pixels, white or any
    solid colour) is removed by a flood fill from the image border, the result trimmed; cached per logo URL in
    brand/agency_cache/<hash>.png (+ .json). Dark logos get a light glow (class dark); logos whose background could
    not be removed keep it with a thin gold outline instead of a white box (class boxed)."""
    import hashlib, numpy as np
    from scipy import ndimage
    for f in ("agency_logo_nobg.png", "agency_logo_nobg.json"):
        if os.path.exists(os.path.join(work, f)): os.remove(os.path.join(work, f))
    src = os.path.join(work, "agency_logo_raw")
    if not p.get("agency_logo") or not os.path.exists(src):
        return None
    os.makedirs(os.path.join(ROOT, "brand", "agency_cache"), exist_ok=True)
    key = hashlib.sha1(p["agency_logo"].encode()).hexdigest()[:12]
    out = os.path.join(ROOT, "brand", "agency_cache", key + ".png"); meta = out[:-4] + ".json"
    if not (os.path.exists(out) and os.path.exists(meta)):
        im = Image.open(src).convert("RGBA")
        bgw = Image.new("RGBA", im.size, (255, 255, 255, 255)); bgw.alpha_composite(im)
        rgb = np.asarray(bgw.convert("RGB")).astype(int); al = np.asarray(im.getchannel("A")).astype(float)
        border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
        bgc = np.median(border, 0)
        uniform = (np.abs(border - bgc).max(1) < 40).mean() > .85
        removed = False
        if al.min() < 250:                    # already transparent: keep its own alpha
            alpha = al; removed = True
        elif uniform:
            d = np.abs(rgb - bgc).max(2)
            close = d < 48
            lab, _ = ndimage.label(close)
            edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
            bgreg = np.isin(lab, list(edge_labels))
            ring = ndimage.binary_dilation(bgreg, iterations=2) & ~bgreg
            alpha = np.full(d.shape, 255.0); alpha[bgreg] = 0
            alpha[ring] = np.clip((d[ring] - 20) / 110 * 255, 0, 255)
            removed = True
        else:
            alpha = al
        res = Image.fromarray(np.dstack([rgb, alpha]).astype("uint8"), "RGBA")
        bb = Image.fromarray((alpha > 40).astype("uint8") * 255).getbbox()
        if bb: res = res.crop(bb)
        vis = np.asarray(res.convert("RGB")).astype(float)[np.asarray(res.getchannel("A")) > 128]
        lum = float((vis @ [.299, .587, .114]).mean()) if len(vis) else 255
        res.save(out); json.dump({"removed": removed, "dark": lum < 90, "lum": round(lum, 1), "bg": [int(x) for x in bgc]}, open(meta, "w"))
    shutil.copyfile(out, os.path.join(work, "agency_logo_nobg.png")); shutil.copyfile(meta, os.path.join(work, "agency_logo_nobg.json"))
    shutil.copyfile(out, os.path.join(Q.asset_dir(p), "agency_logo_nobg.png"))
    return out


def agent_html_v2(p, layout):
    e = H.escape
    name = Q.nodash(p.get("agent_name") or "")
    ag = p.get("agency_name") if p.get("agency_name") != p.get("agent_name") else ""
    # no profile photo or opted out (show_photo_in_ads=false): no agent image at all (no initials)
    av = '<img class="av" src="agent_avatar.jpg">' if os.path.exists(os.path.join(CUR, "agent_avatar.jpg")) else ""
    alg = '<img class="alg" src="agency_logo.png">' if os.path.exists(os.path.join(CUR, "agency_logo.png")) else ""
    ph = Q.fmt_phone(p.get("agent_phone"))
    t = (f'<div class="t"><div class="n">{e(name)}</div>' + (f'<div class="a">{e(Q.nodash(ag))}</div>' if ag else "")
         + (f'<div class="ph">{e(ph)}</div>' if ph else "") + "</div>")
    tail = alg or ('<div class="cta">לתיאום<br>ביקור</div>' if layout == "C" else "")
    # full name always shown (wraps, never truncated); long names get a smaller size so the card stays in the safe zone
    return f'<div class="ag{" long" if len(name) > 20 else ""}">{av}{t}{tail}</div>'


def agent_html_d(p, part="all"):
    """D: compact navy bar + cutout figure (or gold-ring circle) + full name, agency, phone, the agent's OWN
    broker licence (small, subtle; omitted when missing), agency logo if any, CTA 'צור קשר'.
    Short names: name / agency / phone / licence on 4 tight lines; long names (> 20 chars): agency follows the
    name inline (smaller, gold) so the block still fits the 156px bar."""
    e = H.escape
    name = Q.nodash(p.get("agent_name") or "")
    ag = Q.nodash(p.get("agency_name")) if p.get("agency_name") and p.get("agency_name") != p.get("agent_name") else ""
    long = len(name) > 20
    fig_h = None
    if os.path.exists(os.path.join(CUR, "agent_cutout.png")):
        # only ~a quarter of the head rises above the bar's top edge (D_BAR_TOP); figure bottom = bar bottom - 2
        meta = os.path.join(CUR, "agent_cutout.json")
        hf = json.load(open(meta)).get("head_frac", .42) if os.path.exists(meta) else .42
        fig_h = int(round((D_BAR_H - 2) / (1 - 0.25 * hf)))
        fig = f'<img class="dfig" style="height:{fig_h}px" src="agent_cutout.png">'
    elif os.path.exists(os.path.join(CUR, "agent_avatar.jpg")):
        fig = '<img class="dcirc" src="agent_avatar.jpg">'
    else:
        fig = ""       # no photo / opted out: no image, no initials; the text block takes the photo's place
    ph = Q.fmt_phone(p.get("agent_phone"))
    lic = str(p.get("agent_license") or "").strip()
    if long:
        nm = f'<div class="n">{e(name)}' + (f'<span class="a"> · {e(ag)}</span>' if ag else "") + "</div>"
    else:
        nm = f'<div class="n">{e(name)}</div>' + (f'<div class="agy">{e(ag)}</div>' if ag else "")
    # x where the text block must end; no image: 40px inside the bar's right edge (bar right edge = D_ICON_X)
    fw = D_CIRC
    if fig_h:
        c = Image.open(os.path.join(CUR, "agent_cutout.png")); fw = int(fig_h * c.width / c.height)
    right_edge = W - D_FIG_R - fw - 20 if fig else W - D_LX - 40
    t = (f'<div style="width:{right_edge - D_TXT_L}px" class="dt{" long" if long else ""}{"" if fig else " nofig"}">' + nm
         + (f'<div class="ph">{e(ph)}</div>' if ph else "")
         + (f'<div class="lic">רישיון תיווך {e(lic)}</div>' if lic else "") + "</div>")
    side = f'<div class="dside">{agency_logo_d()}<div class="cta">צור קשר</div></div>'
    return '<div class="dbar"><div class="gl"></div></div>' + side + t + fig


def agency_logo_d():
    """Agency logo with its flat background removed (prep_agency_logo); never a white frame."""
    if not os.path.exists(os.path.join(CUR, "agency_logo_nobg.png")):
        return ""
    lm = json.load(open(os.path.join(CUR, "agency_logo_nobg.json")))
    cls = "alg" + (" dark" if lm.get("dark") else "") + ("" if lm.get("removed") else " boxed")
    return f'<img class="{cls}" src="agency_logo_nobg.png">'


def d_specs(p):
    """Spec row under the price: rooms, area, floor, parking (+ mamad / elevator if they fit). Only fields that exist.
    Values: properties.rooms, size_of() (size_sqm / built_size_sqm / area_sqm), floor (+ total_floors), features[]."""
    lot = Q.is_lot(p); fs = set(p.get("features") or [])
    items = []
    if p.get("rooms") and p.get("category") == "residential" and not lot:
        items.append(("rooms", Q.fmt_num(p["rooms"]), "חד׳"))
    sz = Q.size_of(p)
    if sz:
        items.append(("area", Q.fmt_num(sz), "מ״ר"))
    if p.get("floor") is not None and not lot:
        f = p["floor"]
        if f == 0:
            items.append(("floor", "", "קרקע"))
        else:
            items.append(("floor", f"{f}/{p['total_floors']}" if p.get("total_floors") else str(f), "קומה", True))
    if "parking" in fs:
        items.append(("parking", "", "חניה"))
    for k, lbl in (("mamad", "ממ״ד"), ("elevator", "מעלית")):
        if k in fs:
            items.append((k, "", lbl, None, "opt"))
    max_w = W - 2 * D_MX - 330

    def est(its):   # rough width: icon 30 + gap 8 + text (~13px/char at 28px, measured) + 32 padding, + 12 row padding
        return 12 + sum(70 + 13 * (len(x[1]) + len(x[2]) + (1 if x[1] else 0)) for x in its)
    while len(items) > 1 and est(items) > max_w:
        opt = [x for x in items if len(x) > 4]
        items.remove(opt[-1] if opt else items[-1])
    out = []
    for it in items:
        k, v, lbl = it[0], it[1], it[2]
        pre = len(it) > 3 and it[3] is True          # "קומה 2": label before the number
        txt = (f'{H.escape(lbl)} <b>{H.escape(v)}</b>' if pre else (f'<b>{H.escape(v)}</b> {H.escape(lbl)}' if v else H.escape(lbl)))
        out.append(f'<span class="sp"><svg viewBox="0 0 24 24">{D_ICONS[k]}</svg><span>{txt}</span></span>')
    return f'<div class="specs">{"".join(out)}</div>' if out else ""


def d_deal(p):
    """Deal pill: 'למכירה | דירת 5 חדרים · עפולה, <שכונה>' on one line when short, else the location on a
    second smaller line with a pin icon. City only when there is no neighbourhood."""
    e = H.escape
    main = Q.nodash(f"{Q.deal_word(p)} | {Q.type_phrase(p)}")
    loc = ", ".join(x for x in (p.get("city"), p.get("neighborhood")) if x)
    if not loc:
        return f'<div class="deal">{e(main)}</div>'
    if len(main) + len(loc) + 3 <= 30:
        return f'<div class="deal">{e(main)} · {e(loc)}</div>'
    return f'<div class="deal"><div>{e(main)}</div><div class="loc"><svg viewBox="0 0 24 24">{D_ICONS["pin"]}</svg><span>{e(loc)}</span></div></div>'


def closing_html_d(p, s, idx, mode, disc):
    """D closing card (~2s): blurred photo + navy, site lockup, agent cutout (or circle photo, or no image when there is
    no photo / opt-out per agent_photo_allowed), full name, agency + logo (no white frame), phone, small licence, CTA,
    'מודעה N באתר שוק הנדל״ן | shuknadlan.co.il'. Tomer's disclosure (disclosure_for) only on his own listings."""
    e = H.escape
    name = Q.nodash(p.get("agent_name") or "")
    ag = Q.nodash(p.get("agency_name")) if p.get("agency_name") and p.get("agency_name") != p.get("agent_name") else ""
    if os.path.exists(os.path.join(CUR, "agent_cutout.png")):
        fig = '<img class="cfig" src="agent_cutout.png">'
    elif os.path.exists(os.path.join(CUR, "agent_avatar.jpg")):
        fig = '<img class="ccirc" src="agent_avatar.jpg">'
    else:
        fig = ""
    ph = Q.fmt_phone(p.get("agent_phone")); lic = str(p.get("agent_license") or "").strip()
    alg = agency_logo_d()
    arow = f'<div class="arow">{alg}' + (f'<div class="a">{e(ag)}</div>' if ag else "") + "</div>" if (alg or ag) else ""
    card = (f'<div class="card{"" if fig else " nofig"}{" long" if len(name) > 20 else ""}"><div class="n">{e(name)}</div>' + arow
            + (f'<div class="ph">{e(ph)}</div>' if ph else "") + (f'<div class="lic">רישיון תיווך {e(lic)}</div>' if lic else "")
            + '<div class="cta">צור קשר</div></div>')
    foot = (f'<div class="footw"><div class="foot">מודעה <b class="pn">{p["listing_number"]}</b> באתר שוק הנדל״ן | <span class="dom">shuknadlan.co.il</span></div>'
            + (f'<div class="disc">{e(Q.nodash(disc))}</div>' if disc and disc != Q.SITE_LINE else "") + "</div>")
    inner = ('<div class="dcl"><div class="lockc"><img src="logo.png"><div><div class="bw">שוק הנדל״ן</div>'
             '<div class="bd">shuknadlan.co.il</div></div></div>' + f'<div class="mid">{fig}{card}</div>' + foot + "</div>")
    parts = []
    if mode == "story":
        parts.append(f'<div class="bg" style="background-image:url(bg_{idx:02d}.jpg)"></div>')
    if mode in ("story", "static"):
        parts.append('<div class="dclbg"></div>')
    if mode in ("story", "caption"):
        parts.append(inner)
    return (f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>{CSS_V2}</style></head>'
            f'<body class="B D DC">{"".join(parts)}</body></html>')


def slide_html_v2(p, s, idx, mode, disc, layout, bar=True):
    """Layouts B / C / D for photo slides (B/C keep the navy closing card; D has its own closing card).
    mode: story (all layers), static (transparent overlay w/o caption), caption (caption only); D also
    dbase (shades only), dtop (top block only), dbar (agent bar only) for the entry animation."""
    if s["kind"] == "closing":
        return closing_html_d(p, s, idx, mode if mode in ("story", "static", "caption") else "static", disc) if layout == "D" \
            else slide_html(p, s, idx, mode, disc)
    e = H.escape
    num, suf = Q.price_parts(p)
    price = (f'<div class="price"><span class="pn">₪{num}</span>' + (f'<span class="psuf">{e(suf)}</span>' if suf else "") + "</div>") if num else ""
    sh_shade = mode in ("story", "static", "dbase"); sh_top = mode in ("story", "static", "dtop"); sh_bar = mode in ("story", "static", "dbar") and (bar or layout != "D")
    parts = []
    if mode == "story":
        parts.append(f'<div class="bg" style="background-image:url(bg_{idx:02d}.jpg)"></div>')
    if sh_shade:
        parts.append('<div class="topshade"></div><div class="botshade"></div>')
        if layout == "C":
            parts.append('<div class="bartop"><div class="gl"></div></div><div class="agbar"></div>')
    if sh_top:
        deal = d_deal(p) if layout == "D" else f'<div class="deal">{e(Q.nodash(f"{Q.deal_word(p)} | {Q.type_phrase(p)}"))}</div>'
        parts.append('<div class="lockpos"><div class="lock"><img src="logo.png"><div><div class="bw">שוק הנדל״ן</div>'
                     '<div class="bd">shuknadlan.co.il</div></div></div></div>'
                     f'<div class="ltpos"><div class="lt">מודעה <b class="pn">{p["listing_number"]}</b> באתר</div></div>'
                     f'<div class="tr">{deal}{price}{d_specs(p) if layout == "D" else ""}</div>')
    if sh_bar:
        parts.append(agent_html_d(p) if layout == "D" else agent_html_v2(p, layout))
    if mode in ("story", "caption"):
        kick = f'<div class="kick">{e(s["kicker"])}</div>' if s.get("kicker") else ""
        parts.append('<div class="cap">' + kick + (f'<div class="title">{e(s["title"])}</div>' if s.get("title") else "")
                     + (f'<div class="sub">{e(s["sub"])}</div>' if s.get("sub") else "") + '<div class="bar"></div></div>')
    return (f'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>{CSS_V2}</style></head>'
            f'<body class="{("B D" + ("" if bar else " nobar")) if layout == "D" else layout}">{"".join(parts)}</body></html>')


def render_slide(p, s, idx, mode, disc):
    return slide_html(p, s, idx, mode, disc) if LAYOUT == "A" else slide_html_v2(p, s, idx, mode, disc, LAYOUT)


def overlay_layers(p, s, i, disc, layout, work, outdir, animate, tag="", bar=True):
    """Transparent overlay PNGs for one slide clip. Returns (static_layers, caption_png).
    D + animate (first photo clip): three layers (shades, top block, agent bar) so the top block and the bar can
    slide/fade in; otherwise one static layer."""
    def shot(mode):
        hp = os.path.join(work, f"{tag}{mode}_{i:02d}.html")
        open(hp, "w", encoding="utf-8").write(slide_html_v2(p, s, i, mode, disc, layout, bar) if layout != "A" else slide_html(p, s, i, mode, disc))
        png = os.path.join(outdir, f"_{tag}{mode}_{i:02d}.png"); chrome(hp, png, transparent=True); return png
    modes = (("dbase", "dtop", "dbar") if bar else ("dbase", "dtop")) if (layout == "D" and animate and s["kind"] != "closing") else ("static",)
    return [shot(m) for m in modes], shot("caption")


def layers_fc(n_static):
    """filter_complex fragment: inputs 1..n_static are overlay layers ([b0] = moving photo). n_static == 1: one static
    layer. Otherwise (D entry animation, first clip) layer 1 = shades (static), layer 2 = top block (slides down 40px),
    layer 3 = agent bar (slides up 56px); each eases out (cubic) over D_ANIM s while its opacity goes D_ANIM_A0 -> 1, so
    frame 0 (the default cover on most platforms) already shows the top block and the bar. Output label [b1]."""
    if n_static == 1:
        return "[1:v]format=rgba[st];[b0][st]overlay=0:0[b1];"
    a = D_ANIM; fd = round(a * 0.8, 3); offs = [-40, 56]
    out, last = "[1:v]format=rgba[s1];[b0][s1]overlay=0:0[l1];", "[l1]"
    for j in range(2, n_static + 1):
        y = f"{offs[j - 2]}*pow(1-min(t/{a},1),3)"
        lab = "[b1]" if j == n_static else f"[l{j}]"
        # faint copy (alpha D_ANIM_A0) + fading copy at the same moving position: alpha = A0 + (1 - A0) * fade
        out += (f"[{j}:v]format=rgba,split[f{j}][g{j}];[f{j}]colorchannelmixer=aa={D_ANIM_A0}[h{j}];"
                f"[g{j}]fade=in:st=0:d={fd}:alpha=1[k{j}];{last}[h{j}]overlay=x=0:y='{y}'[m{j}];[m{j}][k{j}]overlay=x=0:y='{y}'{lab};")
        last = lab
    return out


def caption_fc(n_in, cd, fd, rise, sp, closing_d=False):
    """Caption layer (input n_in) over [b1] -> [v]. D closing card: longer entry (fade 0.5s + 64px ease-out rise over
    0.65s); everything else keeps the short caption rise."""
    if closing_d:
        y = f"64*pow(1-min(max((t-{cd:.3f})/0.65,0),1),3)"
        return (f"[{n_in}:v]format=rgba,fade=in:st={cd:.3f}:d=0.5:alpha=1[cp];"
                f"[b1][cp]overlay=x=0:y='{y}':format=auto,format=yuv420p[v]")
    return (f"[{n_in}:v]format=rgba,fade=in:st={cd:.3f}:d={fd}:alpha=1[cp];"
            f"[b1][cp]overlay=x=0:y='if(lt(t,{cd:.3f}),{rise},max(0,{rise}-(t-{cd:.3f})*{sp}))':format=auto,format=yuv420p[v]")


FLY_Z = 0.18          # D fly-through: forward push-in 1.0 -> 1.18 over each photo clip (constant speed = no stop/start)
FLY_TAIL_Z = 0.32     # outgoing clip during the transition: extra zoom, accelerating (ease-in) + blur up to FLY_BLUR px
FLY_BLUR = 9
FLY_HEAD_BLUR = 4     # incoming clip: starts slightly soft (4px) and sharpens during the transition
FLY_XF = 0.45         # zoom-through transition length (s)
FLY_FOCI = [(.5, .46), (.47, .5), (.53, .48), (.5, .52), (.48, .46), (.52, .5)]


# ---- D closing card motion (Tomer 2026-10-24): staggered eased entrances, CTA pop + pulse, ~1s hold; no brand outro after it.
D_CLOSE_S = 3.3          # closing card on screen after the zoom-through transition (entrance ~1.3s, 2 CTA pulses, ~1s hold)
D_CLOSE_T0 = 0.25        # entrance starts this long after the clip starts (inside the 0.45s transition)
# element -> (start s after T0, duration s, dy px (start offset, eases to 0), start scale, scale anchor (fx, fy) of the sprite)
D_CLOSE_SEQ = [
    ("lockc", 0.00, 0.50, -40, 1.0, (.5, .5)),
    ("fig",   0.12, 0.60,  80, 0.9, (.5, 1.0)),
    ("card",  0.22, 0.55,  90, 1.0, (.5, .5)),
    ("n",     0.50, 0.38,  24, 1.0, (.5, .5)),
    ("arow",  0.56, 0.38,  24, 1.0, (.5, .5)),
    ("ph",    0.62, 0.38,  24, 1.0, (.5, .5)),
    ("lic",   0.68, 0.38,  24, 1.0, (.5, .5)),
    ("cta",   0.80, 0.45,   0, 0.6, (.5, .5)),     # pop: easeOutBack overshoot
    ("footw", 0.95, 0.35,  16, 1.0, (.5, .5)),
]
D_CLOSE_Z = ["lockc", "card", "fig", "n", "arow", "ph", "lic", "cta", "footw"]   # draw (stacking) order
D_CLOSE_PULSES = [1.45, 2.00]   # CTA pulse starts (s after T0), 0.5s each: scale +5% and a gold glow
D_CLOSE_SEL = {"lockc": ".lockc", "fig": ".cfig,.ccirc", "card": ".card", "n": ".n", "arow": ".arow", "ph": ".ph",
               "lic": ".lic", "cta": ".cta", "footw": ".footw"}


def _ease_out_cubic(x):
    x = min(max(x, 0.0), 1.0); return 1 - (1 - x) ** 3


def _ease_out_back(x, s=1.9):
    x = min(max(x, 0.0), 1.0); x -= 1; return 1 + (s + 1) * x ** 3 + s * x ** 2


def closing_layers_d(p, s, i, disc, work, outdir):
    """Renders the closing card as separate transparent sprites (one Chrome shot per element, the others hidden with
    visibility:hidden so the layout is identical). Returns (static navy overlay RGBA, {name: (sprite, x0, y0)})."""
    base = closing_html_d(p, s, i, "caption", disc)
    hp = os.path.join(work, "dclose_static.html"); png = os.path.join(outdir, "_dclose_static.png")
    open(hp, "w", encoding="utf-8").write(closing_html_d(p, s, i, "static", disc)); chrome(hp, png, transparent=True)
    static = Image.open(png).convert("RGBA")
    sprites = {}
    for name, sel in D_CLOSE_SEL.items():
        vis = ",".join(f".dcl {x},.dcl {x} *" for x in sel.split(",")) if name != "card" else ".dcl .card"
        css = f"<style>.dcl *{{visibility:hidden}}{vis}{{visibility:visible}}</style></head>"
        hp = os.path.join(work, f"dclose_{name}.html"); png = os.path.join(outdir, f"_dclose_{name}.png")
        open(hp, "w", encoding="utf-8").write(base.replace("</head>", css, 1)); chrome(hp, png, transparent=True)
        im = Image.open(png).convert("RGBA"); bb = im.getchannel("A").point(lambda v: 255 if v > 3 else 0).getbbox()
        if bb:
            pad = 30; bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W, bb[2] + pad), min(HGT, bb[3] + pad))
            sprites[name] = (im.crop(bb), bb[0], bb[1])
    return static, sprites


def _place(frame, spr, x0, y0, alpha, dy=0.0, scale=1.0, anchor=(.5, .5)):
    """Composite a sprite at a subpixel offset / scale (affine, bicubic) with opacity alpha."""
    if alpha <= 0.003: return
    w, h = spr.size; ax, ay = anchor[0] * w, anchor[1] * h
    m = int(max(w, h) * max(0.0, scale - 1)) + 4
    cx0, cy0 = int(x0) - m, int(y0 + dy) - m; cw, ch = w + 2 * m, h + 2 * m
    a = 1 / scale
    c = (cx0 - x0 - ax) / scale + ax; f = (cy0 - y0 - dy - ay) / scale + ay
    t = spr.transform((cw, ch), Image.AFFINE, (a, 0, c, 0, a, f), resample=Image.BICUBIC)
    if alpha < 0.997:
        t.putalpha(t.getchannel("A").point(lambda v: int(v * alpha)))
    frame.alpha_composite(t, dest=(max(cx0, 0), max(cy0, 0)), source=(max(0, -cx0), max(0, -cy0)))


def closing_clip_d(p, s, i, k, disc, work, outdir, d, head, out_mp4):
    """Whole D closing clip rendered per frame in Python (30fps): blurred photo with a slow eased push-in that continues
    the fly-through (soft at the start, inside the zoom-through transition), navy overlay, then the staggered entrances
    (D_CLOSE_SEQ), the CTA pop + D_CLOSE_PULSES, and a still hold to the end."""
    static, sp = closing_layers_d(p, s, i, disc, work, outdir)
    glow = None
    if "cta" in sp:
        cta = sp["cta"][0]; g = Image.new("RGBA", cta.size, (230, 194, 126, 0))
        g.putalpha(cta.getchannel("A").filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(14)))
        glow = g
    p_ = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{HGT}", "-r", str(FPS), "-i", "-",
                           "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", out_mp4], stdin=subprocess.PIPE)
    for n, bg in enumerate(fly_frames(os.path.join(work, f"bgbig_{i:02d}.jpg"), d, k, head, 0, z_span=0.08, ease="out")):
        t = n / FPS - D_CLOSE_T0
        fr = bg.convert("RGBA"); fr.alpha_composite(static)
        # draw order follows the HTML stacking (cutout above the card panel), timing follows D_CLOSE_SEQ
        for name, st0, dur_, dy0, sc0, anc in sorted(D_CLOSE_SEQ, key=lambda x: D_CLOSE_Z.index(x[0])):
            if name not in sp: continue
            spr, x0, y0 = sp[name]; q = (t - st0) / dur_
            if q <= 0: continue
            if name == "cta":
                sc = sc0 + (1 - sc0) * _ease_out_back(q); al = min(1.0, q / 0.45)
                for ps in D_CLOSE_PULSES:
                    pq = (t - ps) / 0.5
                    if 0 < pq < 1:
                        import math
                        kk = math.sin(math.pi * pq); sc *= 1 + 0.05 * kk
                        if glow: _place(fr, glow, x0, y0, 0.85 * kk, 0, 1 + 0.08 * kk, anc)
                _place(fr, spr, x0, y0, al, 0, sc, anc)
            else:
                e_ = _ease_out_cubic(q)
                _place(fr, spr, x0, y0, min(1.0, q * 1.4), dy0 * (1 - e_), sc0 + (1 - sc0) * e_, anc)
        p_.stdin.write(fr.convert("RGB").tobytes())
    p_.stdin.close()
    if p_.wait():
        sys.exit("closing_clip_d: ffmpeg failed")
    for f in os.listdir(outdir):
        if f.startswith("_dclose_"): os.remove(os.path.join(outdir, f))
    return out_mp4


def fly_frames(src_big, d, k, head, tail, z_span=FLY_Z, ease="linear", ease_in_start=False):
    """Generator of background frames (PIL RGB, 1080x1920) with the fly-through push-in: float crop boxes from the 2x
    source (Image.resize(box=...) is subpixel-accurate, so no zoompan integer-step jitter).
    ease: "linear" (constant speed; ease_in_start = start from rest over 0.6s) or "out" (closing card: settles).
    head / tail = transition seconds at the start / end (incoming soft focus / outgoing zoom-through + blur)."""
    im = Image.open(src_big).convert("RGB"); SW, SH = im.size
    d, head, tail = float(d), float(head), float(tail)       # build_reel passes numpy floats
    fx, fy = FLY_FOCI[k % len(FLY_FOCI)]
    N = int(round(d * FPS)); body = max(0.01, d - tail)
    for n in range(N):
        t = n / FPS
        u = min(t, body) / d
        if ease == "out":
            u = 1 - (1 - u) ** 2
        elif ease_in_start:   # very first clip: start from rest (ease-in over the first 0.6s), then constant speed
            r = 0.6 / d; u = (u * u / (2 * r)) if u < r else (u - r / 2)
            u = u / (1 - r / 2)
        z = 1.0 + z_span * u
        blur = 0.0
        if tail and t > body:
            q = (t - body) / tail
            z = (1.0 + z_span * body / d) * (1 + FLY_TAIL_Z * q * q); blur = FLY_BLUR * q * q
        if head and t < head:
            blur = max(blur, FLY_HEAD_BLUR * (1 - t / head) ** 2)
        cw, ch = SW / z, SH / z
        x0 = min(max(fx * SW - cw / 2, 0), SW - cw); y0 = min(max(fy * SH - ch / 2, 0), SH - ch)
        fr = im.resize((W, HGT), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch), reducing_gap=2.0)
        if blur > 0.3:
            fr = fr.filter(ImageFilter.GaussianBlur(float(blur)))
        yield fr


def fly_bg(src_big, out_mp4, d, k, head, tail, z_span=FLY_Z, ease_in_start=False):
    """Background clip for layout D with the fly-through push-in (see fly_frames), encoded to out_mp4."""
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{HGT}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", out_mp4], stdin=subprocess.PIPE)
    for fr in fly_frames(src_big, d, k, head, tail, z_span, "linear", ease_in_start):
        p.stdin.write(fr.tobytes())
    p.stdin.close()
    if p.wait():
        sys.exit("fly_bg: ffmpeg failed")
    return out_mp4


def clip_bg(layout, work, i, k, d, N, has_prev, has_next, closing, outdir, xfs, zexpr=None, xexpr=None):
    """Background input + filter head for one clip -> ([ffmpeg input args], filter producing [b0]).
    D: Python-rendered fly-through push-in (fly_bg) with zoom-through tails; others: the old zoompan Ken Burns."""
    src = os.path.join(work, f"bgbig_{i:02d}.jpg")
    if layout == "D":
        mp = os.path.join(outdir, f"_flybg_{k + 1:02d}.mp4")
        fly_bg(src, mp, d, k, head=xfs if has_prev else 0, tail=0 if closing or not has_next else xfs,
               z_span=0.05 if closing else FLY_Z, ease_in_start=(k == 0))
        return ["-i", mp], "[0:v]format=yuv420p,setpts=PTS-STARTPTS[b0];"
    return (["-loop", "1", "-framerate", str(FPS), "-t", f"{d:.3f}", "-i", src],
            f"[0:v]zoompan=z='{zexpr}':x='{xexpr}':y='(ih-ih/zoom)*0.45':d=1:s={W}x{HGT}:fps={FPS},format=yuv420p[b0];")


def build_mockup(n, layout, kinds=("living_room", "balcony"), seconds=5.0, track=None, closing_s=None, no_photo=False):
    """Layout mockup: still PNGs of 2 photo slides (+ D: cover frame and closing card) and an MP4 preview (music bed).
    D: fly-through push-in per photo + zoom-through transitions, entry animation (top block + agent bar) on the first
    clip, agent bar ONLY on the first clip / cover, ~2s closing card with its own entry animation. Output:
    <n>/reel/mockup_<layout>/frame_<k>_<kind>.png (+ frame_cover.png, frame_closing.png) + preview_<layout>.mp4.
    Nothing is posted."""
    global LAYOUT
    LAYOUT = layout
    p, st = prop(n)
    base = Q.asset_dir(p); work = os.path.join(base, "story", "src")
    slides = prepare(p, st, work)
    prep_agent_media(p, work)
    if no_photo:      # preview of the no-photo / opt-out case: no agent image anywhere (restored at the end)
        for f in ("agent_cutout.png", "agent_cutout.json", "agent_avatar.jpg"):
            if os.path.exists(os.path.join(work, f)): os.remove(os.path.join(work, f))
    sfx = "_no_photo" if no_photo else ""
    disc = Q.disclosure_for(p, st)
    out = os.path.join(base, "reel", f"mockup_{layout}"); os.makedirs(out, exist_ok=True)
    pick = [(slides.index(s) + 1, s) for k in kinds for s in slides if s["kind"] == k][:2]
    D = layout == "D"
    if D:
        pick.append((len(slides), slides[-1]))          # closing card
    XFS = FLY_XF if D else 0.3
    closing_s = closing_s or (D_CLOSE_S if D else 2.0)
    n_photo = len(pick) - (1 if D else 0)
    d_photo = (seconds + XFS * (n_photo - 1)) / n_photo
    durs = [d_photo] * n_photo + ([closing_s + XFS] if D else [])
    clips, pngs = [], []
    for k, (i, s) in enumerate(pick):
        bar = (k == 0) or not D                          # D: agent bar only on the first photo clip (and the cover)
        hp = os.path.join(work, f"mock{layout}_story_{i:02d}.html")
        open(hp, "w", encoding="utf-8").write(slide_html_v2(p, s, i, "story", disc, layout, bar))
        png = os.path.join(out, (f"frame_closing{sfx}.png" if s["kind"] == "closing" else f"frame_{k+1}_{s['kind']}{sfx}.png")); chrome(hp, png); pngs.append(png)
        if D and k == 0:
            shutil.copyfile(png, os.path.join(out, f"frame_cover{sfx}.png")); pngs.append(os.path.join(out, f"frame_cover{sfx}.png"))
        if D and s["kind"] == "closing":     # whole closing clip rendered per frame (staggered motion), no overlay chain
            c = os.path.join(out, f"_clip_{k+1}.mp4")
            clips.append(closing_clip_d(p, s, i, k, disc, work, out, durs[k], XFS, c)); continue
        layers, cap = overlay_layers(p, s, i, disc, layout, work, out, animate=(k == 0), tag=f"mock{layout}_", bar=bar)
        d_each = durs[k]; N = int(round(d_each * FPS)); z0, z1 = (1.03, 1.12) if k % 2 == 0 else (1.12, 1.03)
        if s["kind"] == "closing": z0, z1 = 1.0, 1.05
        cd = 0.12 + (XFS / 2 if k else 0)
        bg_in, bg_fc = clip_bg(layout, work, i, k, d_each, N, k > 0, k < len(pick) - 1, s["kind"] == "closing", out, XFS,
                               f"{z0}+({z1}-{z0})*on/{N}", "(iw-iw/zoom)*0.5")
        fc = bg_fc + layers_fc(len(layers)) + caption_fc(len(layers) + 1, cd, 0.25, 30, 150, D and s["kind"] == "closing")
        c = os.path.join(out, f"_clip_{k+1}.mp4")
        ins = bg_in + sum([["-loop", "1", "-framerate", str(FPS), "-t", f"{d_each:.3f}", "-i", x] for x in [*layers, cap]], [])
        run(["ffmpeg", "-y", "-v", "error", *ins, "-filter_complex", fc, "-map", "[v]", "-frames:v", str(N),
             "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-r", str(FPS), c])
        clips.append(c)
    total = sum(durs) - XFS * (len(durs) - 1)
    meta = json.load(open(os.path.join(MUSIC_DIR, "tracks.json"))); tr = meta["tracks"][track or meta["default"]]
    mp4 = os.path.join(out, f"preview_{layout}{sfx}.mp4")
    trans = ["fade"] if D else ["smoothleft", "fadefast", "fade"]
    xf, last, off = "", "[0:v]", 0.0
    for k in range(1, len(clips)):
        off += durs[k - 1] - XFS
        xf += f"{last}[{k}:v]xfade=transition={trans[(k - 1) % len(trans)]}:duration={XFS}:offset={off:.3f}[x{k}];"; last = f"[x{k}]"
    xf = (xf + f"{last}null[v]") if xf else "[0:v]null[v]"
    run(["ffmpeg", "-y", "-v", "error", *sum([["-i", c] for c in clips], []), "-ss", f"{tr['start']:.3f}", "-i", os.path.join(MUSIC_DIR, tr["file"]),
         "-filter_complex", xf + f";[{len(clips)}:a]atrim=0:{total:.2f},afade=t=in:d=0.2,afade=t=out:st={total - 0.8:.2f}:d=0.8,volume=0.7[a]",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
         "-t", f"{total:.2f}", "-movflags", "+faststart", mp4])
    for f in os.listdir(out):
        if f.startswith("_"): os.remove(os.path.join(out, f))
    if no_photo: prep_agent_media(p, work)
    print(json.dumps({"layout": layout, "frames": pngs, "preview": mp4, "seconds": round(total, 2)}, ensure_ascii=False))
    return pngs, mp4


def prep_bg(src, dst, big=None):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    if im.width / im.height > 0.75:   # landscape-ish: blurred fill + fitted photo
        bg = ImageOps.fit(im, (W, HGT)).filter(ImageFilter.GaussianBlur(40))
        bg = Image.blend(bg, Image.new("RGB", bg.size, (8, 30, 26)), .35)
        fw = W; fh = int(im.height * W / im.width)
        bg.paste(im.resize((fw, fh), Image.LANCZOS), (0, int(HGT * .42 - fh / 2)))
        out = bg
    else:
        out = ImageOps.fit(im, (W, HGT), Image.LANCZOS, centering=(.5, .45))
    out.save(dst, quality=93)
    if big:
        out.resize((W * 2, HGT * 2), Image.LANCZOS).save(big, quality=92)


def prepare(p, st, work):
    global CUR
    CUR = work
    os.makedirs(work, exist_ok=True)
    logo = WM.load_logo(Q.LOGO)
    lg, pad = WM.outlined(logo, 150, stroke=4, glow=5)
    lg.save(os.path.join(work, "logo.png"))
    if p.get("agency_logo"):
        try:
            raw = os.path.join(work, "agency_logo_raw")
            if not os.path.exists(raw): Q.fetch(p["agency_logo"], raw)
            a = Image.open(raw).convert("RGBA"); bg = Image.new("RGBA", a.size, (255, 255, 255, 255)); bg.alpha_composite(a)
            bb = bg.convert("L").point(lambda v: 255 if v < 240 else 0).getbbox()
            (bg.crop(bb) if bb else bg).convert("RGB").save(os.path.join(work, "agency_logo.png"))
        except Exception as ex:
            print("agency logo skipped:", ex, file=sys.stderr)
    slides = plan(p)
    for i, s in enumerate(slides, 1):
        u = s["url"] or slides[0]["url"]
        raw = os.path.join(work, "photo_" + re.sub(r"[^\w.]", "_", u.rsplit("/", 1)[-1]))
        if not os.path.exists(raw): Q.fetch(u, raw)
        prep_bg(raw, os.path.join(work, f"bg_{i:02d}.jpg"), os.path.join(work, f"bgbig_{i:02d}.jpg"))
        if s["kind"] == "closing":
            Image.open(os.path.join(work, f"bg_{i:02d}.jpg")).filter(ImageFilter.GaussianBlur(18)).save(os.path.join(work, f"bg_{i:02d}.jpg"))
            Image.open(os.path.join(work, f"bgbig_{i:02d}.jpg")).filter(ImageFilter.GaussianBlur(36)).save(os.path.join(work, f"bgbig_{i:02d}.jpg"))
    json.dump(slides, open(os.path.join(work, "plan.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return slides


def build_stories(n):
    p, st = prop(n)
    d = os.path.join(Q.asset_dir(p), "story"); work = os.path.join(d, "src")
    slides = prepare(p, st, work)
    if LAYOUT != "A": prep_agent_media(p, work)
    for f in os.listdir(d):
        if re.match(r"story_\d+\.jpg$", f): os.remove(os.path.join(d, f))
    for i, s in enumerate(slides, 1):
        hp = os.path.join(work, f"story_{i:02d}.html")
        open(hp, "w", encoding="utf-8").write(render_slide(p, s, i, "story", Q.disclosure_for(p, st)))
        png = os.path.join(work, f"story_{i:02d}.png"); chrome(hp, png)
        Image.open(png).convert("RGB").save(os.path.join(d, f"story_{i:02d}.jpg"), quality=92)
    with open(os.path.join(d, "captions.txt"), "w", encoding="utf-8") as f:
        for i, s in enumerate(slides, 1):
            f.write(f"story_{i:02d}: {s['kind']} | {s.get('kicker','')} | {s.get('title','')} | {s.get('sub','')}\n")
    print("stories:", d, len(slides))
    return p, st, slides


# ------------------------------------------------------------------ reel
VOICES = {"male": ("he-IL-AvriNeural", "+12%", "+0Hz"), "female": ("he-IL-HilaNeural", "+10%", "+0Hz")}
MUSIC_DIR = os.path.join(ROOT, "brand", "music")
OUTRO_VARIANT = "A"            # brand outro: A = deep navy radial (default), B = navy->royal diagonal + gold glow
CLOSE_THEME = "navy"           # closing price/broker card theme ("" = the old dark green)
def outro_path(v=None):
    f = os.path.join(ROOT, "brand", f"outro_{v or OUTRO_VARIANT}_1080x1920.mp4")
    return f if os.path.exists(f) else os.path.join(ROOT, "brand", "outro_1080x1920.mp4")
OUTRO = outro_path()
OUTRO_SFX = os.path.join(ROOT, "brand", "outro_sfx.wav")
SR = 44100


async def _tts(text, out, voice, rate, pitch):
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(out)


def tts(text, out, voice, rate="+20%", pitch="+8Hz"):
    asyncio.run(_tts(text, out, voice, rate, pitch))


def read_wav(path):
    """decode any audio to float32 stereo 44.1k via ffmpeg"""
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         stdout=subprocess.PIPE, check=True).stdout
    return np.frombuffer(raw, "<f4").reshape(-1, 2).copy()


def write_wav(path, x):
    import numpy as np, wave
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype("<i2").tobytes())


# ---- spoken Hebrew helpers (v3 script)
_U_M = ["", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"]
_U_F = ["", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"]
_TEENS_M = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר", "שישה עשר", "שבעה עשר", "שמונה עשר", "תשעה עשר"]
_TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]
_HUND = ["", "מאה", "מאתיים", "שלוש מאות", "ארבע מאות", "חמש מאות", "שש מאות", "שבע מאות", "שמונה מאות", "תשע מאות"]
_THOU = {1: "אלף", 2: "אלפיים", 3: "שלושת אלפים", 4: "ארבעת אלפים", 5: "חמשת אלפים", 6: "ששת אלפים", 7: "שבעת אלפים",
         8: "שמונת אלפים", 9: "תשעת אלפים", 10: "עשרת אלפים"}


def _under1000(n):
    parts = []
    if n >= 100: parts.append(_HUND[n // 100]); n %= 100
    if 10 <= n < 20: parts.append(_TEENS_M[n - 10]); n = 0
    elif n >= 20: parts.append(_TENS[n // 10]); n %= 10
    if n: parts.append(_U_M[n])
    if len(parts) > 1: parts[-1] = "ו" + parts[-1]
    return " ".join(parts)


def num_words(n):
    """Integer -> spoken Hebrew (masculine counting, for מטר/שקל), e.g. 1590000 -> מיליון חמש מאות ותשעים אלף."""
    n = int(round(n))
    if n == 0: return "אפס"
    groups = []
    m, n = divmod(n, 1_000_000)
    if m: groups.append("מיליון" if m == 1 else ("שני מיליון" if m == 2 else _under1000(m) + " מיליון"))
    t, n = divmod(n, 1000)
    if t: groups.append(_THOU[t] if t in _THOU else _under1000(t) + " אלף")
    if n: groups.append(_under1000(n))
    if len(groups) > 1 and not any(w.startswith("ו") for w in groups[-1].split()):
        groups[-1] = "ו" + groups[-1]
    return " ".join(groups)


# words the TTS engine mispronounces (checked by speech-to-text); pointed (niqqud) spellings
NIQQUD = {"מאה וחמישים": "מֵאָה וַחֲמִישִׁים", "מרפסת": "מִרְפֶּסֶת", 'ממ"ד': 'מַמָּ"ד', "ומיזוג אוויר": "וּמִיזּוּג אֲוִיר", "מיזוג אוויר": "מִיזּוּג אֲוִיר",
          "ומיזוג": "וּמִיזּוּג", "מיזוג": "מִיזּוּג", "דברו": "דַּבְּרוּ"}
FEAT_SPOKEN = {"ac": "מיזוג אוויר", "mamad": 'ממ"ד', "balcony": "מרפסת", "sun_balcony": "מרפסת שמש", "parking": "חניה", "elevator": "מעלית",
               "storage": "מחסן", "furnished": "ריהוט", "accessible": "נגישות", "loading_ramp": "רמפת העמסה", "high_ceiling": "תקרה גבוהה",
               "meeting_room": "חדר ישיבות", "kitchenette": "מטבחון", "mamak": 'ממ"ק', "renovated_feature": "שיפוץ"}


def with_niqqud(t):
    for a, b in sorted(NIQQUD.items(), key=lambda x: -len(x[0])):
        t = re.sub(r"(?<![\u0590-\u05FF])" + re.escape(a) + r"(?![\u0590-\u05FF])", b, t)
    return t


def join_and(items):
    items = [x for x in items if x]
    if len(items) <= 1: return "".join(items)
    return ", ".join(items[:-1]) + " ו" + items[-1]


def v3_script(p, slides):
    """Flowing natural sentences (facts only), one per slide; numbers as words."""
    city, nb = p.get("city") or "", p.get("neighborhood")
    rs = spoken_rooms(p) if p["category"] == "residential" and not Q.is_lot(p) else None
    if p["category"] == "commercial":
        s1 = f"מחפשים {Q.type_phrase(p)} {Q.deal_word(p)} ב{city}?"
    elif rs and p.get("property_type") == "דירה":
        s1 = f"מחפשים דירת {rs} ב{city}?"
    else:
        s1 = hook(p)
    loc = (nb[1:] if nb and nb.startswith("ה") else nb)
    # facts only: no "exactly what you wanted" style claims
    if nb:
        s2 = f"היא כאן, ב{loc}." if not nb.startswith("השכונה") else f"היא כאן, בשכונה{nb[len('השכונה'):]}."
    else:
        s2 = "היא כאן."
    sz = Q.size_of(p); fl = p.get("floor")
    bits = []
    if sz: bits.append(f"{num_words(sz)} מטר")
    if fl is not None and not Q.is_lot(p):
        bits.append("בקומת קרקע" if fl == 0 else (f"ב{FLOOR_WORD[fl]}" if fl in FLOOR_WORD else f"בקומה {num_words(fl)}"))
    s3 = ", ".join(bits) + "," if bits else ""
    fs = [FEAT_SPOKEN[f] for f in Q.features(p, 4) if f in FEAT_SPOKEN]
    s4 = ("עם " + join_and(fs) + ".") if fs else ""
    num, suf = Q.price_parts(p)
    price = f"{num_words(p['price'])} שקל" + (" לחודש" if p.get("deal_type") == "rent" else "") + (' פלוס מע"מ' if 'מע"מ' in suf else "") + "." if num else ""
    first = (p.get("agent_name") or "").split()[0] if p.get("agent_name") else ""
    s5 = (price + " " + (f"דברו עכשיו עם {first}." if first else "דברו איתנו עכשיו.")).strip()
    lines = [s1, s2, s3, s4, s5]
    # if a middle line is empty, merge neighbours so every slide still has a sentence
    lines = [l for l in lines[:-1] if l] + [lines[-1]]
    while len(lines) < len(slides): lines.insert(-1, "")
    if len(lines) > len(slides):
        lines = lines[:len(slides) - 1] + [" ".join(lines[len(slides) - 1:])]
    return [with_niqqud(Q.nodash(l)) for l in lines]


def short_vo(p, slides):
    """Punchy 15s sales script: facts only, exclamation delivery."""
    city = p.get("city") or ""
    rs = spoken_rooms(p) if p["category"] == "residential" and not Q.is_lot(p) else None
    if p["category"] == "commercial":
        first = f"מחפשים {Q.type_phrase(p)} {Q.deal_word(p)} ב{city}?!"
    elif rs and p.get("property_type") == "דירה":
        first = f"מחפשים דירת {rs} ב{city}?!"
    else:
        first = hook(p).rstrip("?") + "?!"
    out = []
    for k, s in enumerate(slides):
        if s["kind"] == "opener":
            out.append(first)
        elif s["kind"] == "closing":
            num, suf = Q.price_parts(p)
            name = p.get("agent_name")
            out.append((f"{num} שקל{(' ' + suf) if suf else ''}! " if num else "") + (f"דברו עם {name}!" if name else "דברו איתנו!"))
        else:
            v = s["vo"].rstrip(".")
            v = v.replace(" ו", ", ") if False else v
            out.append(v + "!")
    return [spoken(x).replace('+ מע"מ', 'פלוס מע"מ') for x in out]


def build_reel(n, gender="male", long=False, outro=True, synth_music=False, rate=None, tag_out="v4", track=None):
    import numpy as np
    if LAYOUT == "D": outro = False      # D ends with the animated closing card only (owner decision 2026-10-24)
    p, st, story_slides = build_stories(n)
    base = Q.asset_dir(p); work = os.path.join(base, "story", "src"); rd = os.path.join(base, "reel"); os.makedirs(rd, exist_ok=True)
    tag = "long" if long else f"short_{tag_out}"
    tmp = os.path.join(rd, "work_" + tag); os.makedirs(tmp, exist_ok=True)
    disc = Q.disclosure_for(p, st)
    Q.write_reel_captions(p, st)   # fb_caption.txt / ig_caption.txt (kept if they already exist)
    voice, rate0, pitch = VOICES[gender]
    rate = rate or rate0
    # ---- slides
    if long:
        slides = story_slides
        lines = [s["vo"] for s in slides]
    else:
        photos = [s for s in story_slides if s["kind"] != "closing"][:4]
        slides = photos + [story_slides[-1]]
        lines = v3_script(p, slides)
    idx = [story_slides.index(s) + 1 for s in slides]  # bg/bgbig file index
    # ---- voice segments
    vo_d = []
    for i, line in enumerate(lines, 1):
        raw = os.path.join(tmp, f"vo_{i:02d}_raw.mp3"); mp = os.path.join(tmp, f"vo_{i:02d}.wav")
        tts(line, raw, voice, rate, pitch)
        # trim TTS padding gently (keep word tails such as a final ק; 40 ms safety at both ends)
        run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
             "silenceremove=start_periods=1:start_threshold=-60dB,areverse,adelay=40:all=1,apad=pad_dur=0.04", "-ar", str(SR), "-ac", "2", mp])
        vo_d.append(dur(mp))
    # ---- music + beat grid
    meta = json.load(open(os.path.join(MUSIC_DIR, "tracks.json")))
    tr = meta["tracks"][track or meta["default"]]
    beat = tr.get("beat_period") or 60.0 / tr["bpm"]
    if synth_music: beat = 60 / 112
    # ---- timeline: cut points on the beat
    XFS = (0.28 if not long else XF) if LAYOUT != "D" else FLY_XF     # D: zoom-through transition
    vst = None
    if long:
        D = [max(4.8 if s["kind"] == "closing" else 3.0, vo_d[i] + (1.2 if s["kind"] == "closing" else 0.7)) for i, s in enumerate(slides)]
        cuts = [0.0]
        for d_ in D[:-1]:
            cuts.append(cuts[-1] + round(d_ / beat) * beat)
        body = cuts[-1] + max(9, round(D[-1] / beat)) * beat
    else:
        # continuous, natural flow: sentences follow each other with a short breath; each cut lands
        # on the beat just before its sentence starts (slide is on screen before the words)
        GAP = 0.25
        vst = [0.2]
        for d_ in vo_d[:-1]:
            vst.append(vst[-1] + d_ + GAP)
        cuts = [0.0]
        for k in range(1, len(slides)):
            c = np.floor((vst[k] - 0.12) / beat) * beat
            cuts.append(max(c, cuts[-1] + 3 * beat))
            if vst[k] < cuts[k] + 0.12: vst[k] = cuts[k] + 0.12
        vo_end = vst[-1] + vo_d[-1]
        body = max(30, int(np.ceil((vo_end + 0.7) / beat))) * beat
    if LAYOUT == "D":    # closing card on screen >= D_CLOSE_S after its transition (entrance + pulses + ~1s hold)
        body = max(body, float(np.ceil((cuts[-1] + XFS / 2 + D_CLOSE_S) / beat)) * beat)
    bounds = cuts + [body]
    starts = [0.0] + [c - XFS / 2 for c in cuts[1:]]
    ends = [c + XFS / 2 for c in cuts[1:]] + [body]
    # ---- per-slide clips
    clips = []
    for k, s in enumerate(slides):
        i = idx[k]
        # D: the first clip gets the entry animation (top block + agent bar slide/fade in over D_ANIM s)
        # D: agent bar only on the first photo clip (+ cover); entry animation there (top block + bar, D_ANIM s)
        layers, cap = overlay_layers(p, s, i, disc, LAYOUT, work, tmp, animate=(k == 0), bar=(k == 0 or LAYOUT != "D"))
        d_ = ends[k] - starts[k]; N = int(round(d_ * FPS))
        zin = k % 2 == 0
        amp = 0.16 if not long else 0.09
        z0, z1 = (1.03, 1.03 + amp) if zin else (1.03 + amp, 1.03)
        if s["kind"] == "closing": z0, z1 = 1.0, 1.06
        px0, px1 = [(0.5, 0.5), (0.25, 0.75), (0.75, 0.25), (0.5, 0.5)][k % 4]
        zexpr = f"{z0}+({z1}-{z0})*on/{N}"
        xexpr = f"(iw-iw/zoom)*({px0}+({px1}-{px0})*on/{N})"
        cd = (0.08 if not long else 0.25) + (XFS / 2 if k else 0)
        fd = 0.2 if not long else 0.55
        rise = 30 if not long else 46
        sp = rise / (0.2 if not long else 0.5)
        if LAYOUT == "D" and s["kind"] == "closing":
            clips.append(closing_clip_d(p, s, i, k, disc, work, tmp, d_, XFS, os.path.join(tmp, f"clip_{k+1:02d}.mp4"))); continue
        bg_in, bg_fc = clip_bg(LAYOUT, work, i, k, d_, N, k > 0, k < len(slides) - 1, s["kind"] == "closing", tmp, XFS, zexpr, xexpr)
        fc = bg_fc + layers_fc(len(layers)) + caption_fc(len(layers) + 1, cd, fd, rise, sp, LAYOUT == "D" and s["kind"] == "closing")
        out = os.path.join(tmp, f"clip_{k+1:02d}.mp4")
        run(["ffmpeg", "-y", *bg_in,
             *sum([["-loop", "1", "-framerate", str(FPS), "-t", f"{d_:.3f}", "-i", x] for x in [*layers, cap]], []),
             "-filter_complex", fc, "-map", "[v]", "-frames:v", str(N), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
             "-pix_fmt", "yuv420p", "-r", str(FPS), out])
        clips.append(out)
    trans = (["smoothleft", "fadefast", "smoothright", "fadefast"] * 4) if not long else (["fade", "smoothleft", "fade", "smoothright"] * 4)
    if LAYOUT == "D": trans = ["fade"] * 16          # dissolve over the fly-through zoom tails = flying into the next room
    if LAYOUT == "D":   # reel cover / thumbnail: first photo slide WITH the agent bar (pass it as the cover when publishing)
        hp = os.path.join(work, "cover_D.html")
        open(hp, "w", encoding="utf-8").write(slide_html_v2(p, slides[0], idx[0], "story", disc, "D", True))
        chrome(hp, os.path.join(tmp, "cover.png"))
        Image.open(os.path.join(tmp, "cover.png")).convert("RGB").save(os.path.join(rd, f"cover_{tag_out}.jpg"), quality=93)
    inputs = sum([["-i", c] for c in clips], [])
    fc, last = "", "[0:v]"
    for k in range(1, len(clips)):
        fc += f"{last}[{k}:v]xfade=transition={trans[k-1]}:duration={XFS}:offset={starts[k]:.3f}[x{k}];"; last = f"[x{k}]"
    total = body
    if outro and os.path.exists(OUTRO):
        fc += f"[{len(clips)}:v]fps={FPS},scale={W}:{HGT},setsar=1,format=yuv420p[ou];{last}[ou]concat=n=2:v=1:a=0[vout]"
        inputs += ["-i", OUTRO]; last = "[vout]"; total = body + dur(OUTRO)
    silent = os.path.join(tmp, "video_silent.mp4")
    run(["ffmpeg", "-y", *inputs, "-filter_complex", fc.rstrip(";"), "-map", last, "-c:v", "libx264", "-preset", "medium",
         "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart", silent])
    # ---- audio (numpy mix)
    nT = int(round(total * SR))
    if synth_music:
        mw = os.path.join(tmp, "music_src.wav"); run([sys.executable, os.path.join(TOOLS, "music_bed.py"), mw, "--seconds", f"{total + 1:.2f}"])
        music = read_wav(mw)
    else:
        mw = os.path.join(tmp, "music_src.wav")
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{tr['start']:.3f}", "-i", os.path.join(MUSIC_DIR, tr["file"]),
             "-t", f"{total + 0.5:.3f}", "-af", tr.get("eq", "anull"), "-ar", str(SR), "-ac", "2", mw])
        music = read_wav(mw)
    if len(music) < nT:  # loop if the track is shorter
        music = np.concatenate([music] * (nT // len(music) + 1))
    music = music[:nT]
    t = np.arange(nT) / SR
    fade = np.clip(t / 0.15, 0, 1) * np.clip((total - t) / 1.4, 0, 1)
    music *= fade[:, None]
    def rms(x): return float(np.sqrt(np.mean(x ** 2)) + 1e-9)
    music *= 10 ** (-16 / 20) / rms(music)          # music bed normalized to -16 dBFS RMS
    vo = np.zeros((nT, 2), np.float32); mask = np.zeros(nT, np.float32); placed = []
    prev_end = 0.0
    for k, d_ in enumerate(vo_d):
        seg = read_wav(os.path.join(tmp, f"vo_{k+1:02d}.wav"))
        st0 = vst[k] if not long else max(bounds[k] + (0.15 if k else 0.2), prev_end + 0.22)   # small natural gap between sentences
        a0 = int(st0 * SR); a1 = min(nT, a0 + len(seg))
        vo[a0:a1] += seg[:a1 - a0]; mask[a0:a1] = 1; placed.append(round(st0, 2)); prev_end = st0 + d_
    vo_active = vo[mask > 0]
    vo *= 10 ** (-12 / 20) / rms(vo_active)          # voice at -12 dBFS RMS while speaking
    music_voice = music.copy()
    # ducking envelope: hold through gaps < 0.45s, 120 ms attack / 300 ms release
    m = mask.copy(); gap = int(0.45 * SR); on = np.where(m > 0)[0]
    if len(on):
        ch = np.diff(on); brk = np.where(ch > 1)[0]
        for b in brk:
            if ch[b] < gap: m[on[b]:on[b + 1]] = 1
    env = np.zeros(nT, np.float32); att, rel = 1 / (0.12 * SR), 1 / (0.30 * SR); e = 0.0
    for i0 in range(0, nT, 64):   # block-wise smoother
        tgt = m[i0]; e = min(1, e + att * 64) if tgt > e else max(0, e - rel * 64); env[i0:i0 + 64] = e
    # music under voice: aim for ~19 dB below the voice while speaking (measured on the actual segments)
    sp0 = mask > 0
    r0 = 20 * np.log10(rms(music[sp0]) / rms(vo[sp0]))
    duck_db = min(0.0, -19.0 - r0)
    g = 10 ** ((duck_db * env) / 20)
    music_voice *= g[:, None]
    sfx = np.zeros((nT, 2), np.float32)
    if outro and os.path.exists(OUTRO_SFX):
        sx = read_wav(OUTRO_SFX) * 10 ** (-6 / 20); a0 = int(body * SR); a1 = min(nT, a0 + len(sx)); sfx[a0:a1] = sx[:a1 - a0]
    mix_music = music + sfx * 0.6
    mix_voice = music_voice + vo + sfx * 0.6
    # measured ducking (during speech)
    sp_mask = mask > 0
    duck_meas = 20 * np.log10(rms(music_voice[sp_mask]) / rms(vo[sp_mask]))
    for nm, x in (("music", mix_music), ("voice", mix_voice)):
        pk = np.abs(x).max()
        if pk > 0.95: x *= 0.95 / pk
        write_wav(os.path.join(tmp, f"mix_{nm}.wav"), x)
    if long:
        out_music, out_voice = os.path.join(rd, "reel_music_v2.mp4"), os.path.join(rd, f"reel_voice_{gender}.mp4")
    else:
        out_music = os.path.join(rd, f"reel_music_15s_{tag_out}.mp4")
        out_voice = os.path.join(rd, f"reel_voice_{gender}_{tag_out}.mp4")
    for src, out in ((os.path.join(tmp, "mix_music.wav"), out_music), (os.path.join(tmp, "mix_voice.wav"), out_voice)):
        run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-i", src, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-shortest", "-movflags", "+faststart", out])
    vf = os.path.join(rd, f"voiceover_{tag}.txt")
    with open(vf, "w", encoding="utf-8") as f:
        f.write(f"# Voiceover listing {p['listing_number']} ({'25s' if long else '15s'} cut) TTS: edge-tts {voice} rate {rate} pitch {pitch}\n")
        f.write("# Facts only (structured listing data), no superlatives, no long dashes.\n\n")
        for k, line in enumerate(lines):
            f.write(f"[{placed[k]:05.2f}s] slide {k+1} ({slides[k]['kind']}): {line}\n")
    info = {"mode": tag, "voice": voice, "rate": rate, "pitch": pitch, "beat": beat, "cuts": cuts, "body": body, "total": total,
            "vo_seconds": vo_d, "vo_starts": placed, "music_under_voice_db": round(duck_meas, 1),
            "music": "synth (tools/music_bed.py)" if synth_music else tr, "outputs": [out_music, out_voice]}
    json.dump(info, open(os.path.join(rd, f"timeline_{tag}.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({"total": round(total, 2), "body": round(body, 2), "duck_db": round(duck_meas, 1), "out": [out_music, out_voice]}, ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["stories", "reel", "mockup"]); ap.add_argument("listing")
    ap.add_argument("--layout", choices=["A", "B", "C", "D"], default="A",
                    help="on-screen layout: A = current (default); B = logo top-left, deal+price top-right, agent card lower-third left; "
                         "C = navy/gold glass top bar + lower-third agent bar; D = B top + navy agent bar with pop-out agent cutout, "
                         "agent licence and 'צור קשר' (B/C/D are mockups pending approval)")
    ap.add_argument("--female", action="store_true", help="he-IL-HilaNeural instead of the default male he-IL-AvriNeural")
    ap.add_argument("--long", action="store_true", help="~25s / 7-slide cut instead of the default 15s / 5-slide cut")
    ap.add_argument("--no-outro", action="store_true"); ap.add_argument("--synth-music", action="store_true")
    ap.add_argument("--rate", help="TTS rate override, e.g. +8%%"); ap.add_argument("--tag", default="v4", help="output suffix")
    ap.add_argument("--outro", choices=["A", "B"], default="A", help="brand outro variant (A navy radial, B navy->royal + gold glow)")
    ap.add_argument("--close-theme", choices=["navy", "green"], default="navy", help="closing price/broker card colours")
    ap.add_argument("--track", help="key in brand/music/tracks.json (default: its 'default')")
    ap.add_argument("--no-photo", action="store_true", help="mockup only: preview the no-agent-photo / opt-out variant (*_no_photo files)")
    a = ap.parse_args()
    OUTRO = outro_path(a.outro); CLOSE_THEME = "" if a.close_theme == "green" else "navy"; LAYOUT = a.layout
    if a.cmd == "mockup": build_mockup(a.listing, "B" if a.layout == "A" else a.layout, track=a.track, no_photo=a.no_photo)
    elif a.cmd == "stories": build_stories(a.listing)
    else: build_reel(a.listing, "female" if a.female else "male", a.long, not a.no_outro, a.synth_music, a.rate, a.tag, a.track)
