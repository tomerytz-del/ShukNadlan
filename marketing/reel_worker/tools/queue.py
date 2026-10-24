#!/usr/bin/env python3
"""Facebook group posting queue for שוק נדל"ן (shuknadlan.co.il).

Nothing here posts to Facebook. It plans posts, builds assets and keeps a ledger;
a separate browser step posts, then calls `record`.

Commands
  sync         [--snapshot FILE]   rebuild queue from a Supabase snapshot (tools/sync_query.sql output)
  next         [--limit N] [--build] [--now ISO]   next posts honoring caps / dedupe / spreading
  build-assets --property <uuid|listing_number> [--force]
  record       --property P --group G --status posted|pending_approval|skipped|failed [--url U] [--note T]
  status       summary of queue, waiting lists and today's usage
  build-stories --property P       9:16 story slides  (tools/reel.py)
  build-captions --property P [--force]  reel captions <no>/reel/fb_caption.txt + ig_caption.txt
  build-reel    --property P       15s reel: reel_voice_male_v3.mp4 / reel_music_15s_v3.mp4 (+ --long/--female/--rate/--tag/--track)

Rules
  * eligible property: status=active, >=1 image, created >= 1 hour ago
  * geography/category/deal-type matching against tools/groups.json, best 3 groups per property
  * a (property, group) pair can be posted again only 14+ days after its last posted/pending_approval
  * daily cap 15 posts (posted+pending_approval, Asia/Jerusalem date), max 3 per group per day
  * copy/images: Tomer's name + license only on Tomer's own properties (is_tomer); others get SITE_LINE;
    no ethics-code line or ethics badge for anyone (owner rules 2026-10-24)
"""
import argparse, json, os, re, shutil, subprocess, sys, urllib.request, html as htmllib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
QDIR = os.path.join(ROOT, "queue")
GROUPS = os.path.join(TOOLS, "groups.json")
SNAP = os.path.join(QDIR, "snapshot_raw.json")
STATE = os.path.join(QDIR, "state.json")
LEDGER = os.path.join(QDIR, "ledger.jsonl")
LOGO = os.path.join(ROOT, "brand", "logo_transparent.png")
TZ = ZoneInfo("Asia/Jerusalem")
DAILY_CAP, GROUP_DAILY_CAP, MAX_GROUPS, REPOST_DAYS, MIN_AGE_H = 15, 3, 3, 14, 1
SITE = "https://shuknadlan.co.il/property?id={}"
# Owner rules (Tomer Itzhak, 2026-10-24):
#  * Tomer's name + license (the ads_settings disclosure line) appear ONLY on Tomer's own properties.
#    Text: the site appears once, in the closing listing line (closing_lines); images rely on the logo lockup.
#  * No ethics-code line / ethics badge anywhere, for any agent (the old ETHICS_LINE and badge were removed).
TOMER_AGENT_ID = "2f552dcf-90d0-4578-9038-cc6e7b9e26a5"     # agency_members.id, agency נדל"ן עפולה
TOMER_NAME, TOMER_AGENCY = "תומר יצחק", 'נדל"ן עפולה'
DEFAULT_DISCLOSURE = 'שוק נדל"ן | תומר יצחק, רישיון תיווך 3134355'
SITE_LINE = "שוק הנדל״ן | shuknadlan.co.il"
NORTH_REGIONS = {"north"}
BLOCKING = {"posted", "pending_approval"}


# ---------------------------------------------------------------- helpers
def now_utc(args=None):
    if args is not None and getattr(args, "now", None):
        return datetime.fromisoformat(args.now).astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load_json(p, default=None):
    if not os.path.exists(p):
        return default
    return json.load(open(p, encoding="utf-8"))


def save_json(p, obj):
    tmp = p + ".tmp"
    json.dump(obj, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def read_snapshot(path):
    """Accepts the raw MCP tool result ({"result": "...<untrusted-data>[...]</...>"}),
    a bare SQL row list, or the snapshot object itself."""
    raw = json.load(open(path, encoding="utf-8"))
    if isinstance(raw, dict) and "result" in raw and isinstance(raw["result"], str):
        m = re.search(r">\s*(\[.*\])\s*<", raw["result"], re.S)
        raw = json.loads(m.group(1))
    if isinstance(raw, list):
        raw = raw[0]
    if "snapshot" in raw:
        raw = raw["snapshot"]
    return raw


def groups():
    return [g for g in load_json(GROUPS)["groups"]]


def ledger():
    if not os.path.exists(LEDGER):
        return []
    return [json.loads(l) for l in open(LEDGER, encoding="utf-8") if l.strip()]


def nodash(t):
    """Platform copy rule: no long dashes anywhere."""
    if t is None:
        return t
    return re.sub(r"\s*[\u2013\u2014\u2015]\s*", ", ", str(t)).replace(" ,", ",")


def fmt_num(v):
    v = float(v)
    return f"{int(v):,}" if v == int(v) else f"{v:,.1f}"


def fmt_phone(p):
    if not p:
        return ""
    d = re.sub(r"\D", "", p)
    if d.startswith("972"):
        d = "0" + d[3:]
    if len(d) == 10 and d.startswith("05"):
        return f"{d[:3]}-{d[3:6]}-{d[6:]}"
    if len(d) == 9 and d.startswith("0"):
        return f"{d[:2]}-{d[2:5]}-{d[5:]}"
    return p


def _norm(t):
    return re.sub(r"[\s\"'״׳]", "", t or "")


def is_tomer(p):
    """True only for properties handled by Tomer Itzhak himself (agency_members id TOMER_AGENT_ID).
    Snapshots taken before sync_query.sql selected agent_id fall back to agent name + agency name
    (other agents of the same agency, e.g. טל אטדגי, are NOT Tomer)."""
    aid = p.get("agent_id")
    if aid:
        return str(aid) == TOMER_AGENT_ID
    return _norm(p.get("agent_name")) == _norm(TOMER_NAME) and _norm(p.get("agency_name")) == _norm(TOMER_AGENCY)


def agent_photo_allowed(p):
    """Agent image in ads/reels only if the agent has a profile photo (agency_members.photo_url) and has not opted
    out (agency_members.show_photo_in_ads, snapshot agent_show_photo; missing column/field = true)."""
    return bool(p.get("agent_photo")) and p.get("agent_show_photo", True) is not False


def disclosure_for(p, st=None):
    """Footer line for generated copy: the licensed disclosure (Tomer's name + license) only on Tomer's
    own properties; SITE_LINE for everyone else."""
    if is_tomer(p):
        return (st or {}).get("disclosure") or DEFAULT_DISCLOSURE
    return SITE_LINE


# ---------------------------------------------------------------- matching
def covers(group, p):
    for a in group.get("areas", []):
        if a == "national":
            return True
        kind, _, val = a.partition(":")
        if kind == "city" and val == (p.get("city") or "").strip():
            return True
        if kind == "area" and val == p.get("area_slug"):
            return True
        if kind == "region" and val == p.get("region_slug"):
            return True
    return False


def deal_ok(group, p):
    dt = group.get("deal_types", "both")
    return dt == "both" or dt == p.get("deal_type")


def assign_groups(p, gs):
    cat = p.get("category")
    cands = []
    for g in gs:
        if not g.get("active") or not g.get("page_member"):
            continue
        if not deal_ok(g, p):
            continue
        if g["category"] == "community":
            ok = cat in ("residential", "commercial") and covers(g, p)
        elif g["category"] != cat:
            ok = False
        elif g["category"] == "commercial":
            # national commercial groups are not geo-specific; 401924747253597-style groups by region
            ok = covers(g, p)
        else:
            ok = covers(g, p)
        if ok:
            cands.append(g)
    order = {"residential": 0, "commercial": 0, "community": 1}
    cands.sort(key=lambda g: (g.get("priority", 50), order.get(g["category"], 2)))
    return cands[:MAX_GROUPS]


# ---------------------------------------------------------------- sync
def cmd_sync(args):
    snap = read_snapshot(args.snapshot or SNAP)
    gs = groups()
    st = load_json(STATE, {}) or {}
    order = st.get("order", [])          # property ids, in the order they entered the queue
    now = now_utc(args)
    props = {p["id"]: p for p in snap["properties"] if p.get("status") == "active"}
    eligible, waiting_images, waiting_age, no_groups = [], [], [], []
    for p in sorted(props.values(), key=lambda x: x["listing_number"] or 0):
        imgs = [u for u in (p.get("images") or []) if u]
        if not imgs:
            waiting_images.append(p["id"]); continue
        if parse_ts(p["created_at"]) > now - timedelta(hours=MIN_AGE_H):
            waiting_age.append(p["id"]); continue
        g = assign_groups(p, gs)
        if not g:
            no_groups.append(p["id"]); continue
        p["_groups"] = [x["id"] for x in g]
        eligible.append(p["id"])
    dropped = [pid for pid in order if pid not in eligible]
    order = [pid for pid in order if pid in eligible]
    new = [pid for pid in eligible if pid not in order]          # already listing_number-sorted
    order += new
    st = {
        "synced_at": now.isoformat(), "snapshot_generated_at": snap.get("generated_at"),
        "disclosure": snap.get("disclosure") or DEFAULT_DISCLOSURE,
        "order": order, "waiting_images": waiting_images, "waiting_age": waiting_age,
        "no_matching_groups": no_groups, "dropped_last_sync": dropped,
        "properties": {pid: props[pid] for pid in set(order) | set(waiting_images) | set(waiting_age) | set(no_groups)},
    }
    save_json(STATE, st)
    pairs = sum(len(st["properties"][pid]["_groups"]) for pid in order)
    print(json.dumps({"queue_properties": len(order), "pairs": pairs, "new": len(new), "dropped": len(dropped),
                      "waiting_images": len(waiting_images), "waiting_age": len(waiting_age),
                      "no_matching_groups": len(no_groups)}, ensure_ascii=False))


# ---------------------------------------------------------------- next
def pair_history(led):
    last = {}
    for e in led:
        if e["status"] in BLOCKING:
            k = (e["property_id"], e["group_id"])
            t = parse_ts(e["timestamp"])
            if k not in last or t > last[k]:
                last[k] = t
    return last


def today_usage(led, now):
    d = now.astimezone(TZ).date()
    tot, per_g = 0, {}
    for e in led:
        if e["status"] in BLOCKING and parse_ts(e["timestamp"]).astimezone(TZ).date() == d:
            tot += 1; per_g[e["group_id"]] = per_g.get(e["group_id"], 0) + 1
    return tot, per_g


def last_posted_property(led, now):
    best = None
    for e in led:
        if e["status"] in BLOCKING:
            t = parse_ts(e["timestamp"])
            if best is None or t > best[0]:
                best = (t, e["property_id"])
    return best[1] if best else None


def cmd_next(args):
    st = load_json(STATE)
    if not st:
        sys.exit("run `queue.py sync` first")
    gname = {g["id"]: g["name"] for g in groups()}
    led, now = ledger(), now_utc(args)
    last = pair_history(led)
    used, per_g = today_usage(led, now)
    room = max(0, min(args.limit, DAILY_CAP - used))
    fresh, repost = [], []
    for rank, pid in enumerate(st["order"]):
        p = st["properties"][pid]
        for gi, gid in enumerate(p["_groups"]):
            t = last.get((pid, gid))
            if t is None:
                fresh.append((rank, gi, pid, gid))
            elif now - t >= timedelta(days=REPOST_DAYS):
                repost.append((t, rank, pid, gid))
    fresh.sort(); repost.sort()
    cands = [(pid, gid, "new") for _, _, pid, gid in fresh] + [(pid, gid, "repost") for _, _, pid, gid in repost]
    picked, prev = [], last_posted_property(led, now)
    while len(picked) < room and cands:
        choice = None
        for i, (pid, gid, kind) in enumerate(cands):
            if per_g.get(gid, 0) >= GROUP_DAILY_CAP:
                continue
            if pid == prev:
                continue
            # don't let reposts jump ahead of fresh pairs that are only blocked by spreading
            choice = i; break
        if choice is None:   # only same-property options remain: allow back-to-back
            choice = next((i for i, c in enumerate(cands) if per_g.get(c[1], 0) < GROUP_DAILY_CAP), None)
        if choice is None:
            break
        pid, gid, kind = cands.pop(choice)
        per_g[gid] = per_g.get(gid, 0) + 1
        prev = pid
        picked.append((pid, gid, kind))
    out = []
    for pid, gid, kind in picked:
        p = st["properties"][pid]
        d = asset_dir(p)
        if args.build and not assets_ready(d):
            build_assets(p, st)
        photos = sorted([os.path.join(d, f) for f in os.listdir(d) if re.match(r"photo_\d+_wm\.jpg$", f)],
                        key=lambda x: int(re.findall(r"\d+", os.path.basename(x))[0])) if os.path.isdir(d) else []
        out.append({"property_id": pid, "listing_number": p["listing_number"], "city": p.get("city"),
                    "category": p.get("category"), "deal_type": p.get("deal_type"),
                    "group_id": gid, "group_name": gname.get(gid), "group_url": f"https://www.facebook.com/groups/{gid}",
                    "kind": kind, "last_posted_at": last[(pid, gid)].isoformat() if (pid, gid) in last else None,
                    "assets_ready": assets_ready(d),
                    "ad_image": os.path.join(d, "ad_image.jpg"), "photos": photos,
                    "post_text": os.path.join(d, "post.txt"), "property_url": SITE.format(pid)})
    print(json.dumps({"today_used": used, "daily_cap": DAILY_CAP, "returned": len(out), "posts": out},
                     ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- record
def cmd_record(args):
    st = load_json(STATE) or {"properties": {}}
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid, {})
    e = {"property_id": pid, "listing_number": p.get("listing_number"), "group_id": args.group,
         "status": args.status, "timestamp": datetime.now(TZ).isoformat(timespec="seconds"),
         "post_url": args.url or "", "note": args.note or ""}
    if args.status in BLOCKING and not args.force:
        t = pair_history(ledger()).get((pid, args.group))
        if t and datetime.now(timezone.utc) - t < timedelta(days=REPOST_DAYS):
            sys.exit(f"refused: pair already {args.status}-blocked since {t.astimezone(TZ).isoformat()} "
                     f"(< {REPOST_DAYS} days). Use --force only to log a post that really happened.")
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")
    print(json.dumps(e, ensure_ascii=False))


def resolve_pid(x, st):
    if re.fullmatch(r"\d+", str(x)):
        for pid, p in st["properties"].items():
            if str(p.get("listing_number")) == str(x):
                return pid
        sys.exit(f"listing_number {x} not in state (run sync)")
    return x


# ---------------------------------------------------------------- status
def cmd_status(args):
    st = load_json(STATE)
    led, now = ledger(), now_utc(args)
    used, per_g = today_usage(led, now)
    last = pair_history(led)
    pairs = [(pid, g) for pid in st["order"] for g in st["properties"][pid]["_groups"]]
    never = sum(1 for k in pairs if k not in last)
    elig = sum(1 for k in pairs if k in last and now - last[k] >= timedelta(days=REPOST_DAYS))
    cats = {}
    for pid in st["order"]:
        c = st["properties"][pid]["category"]; cats[c] = cats.get(c, 0) + 1
    print(json.dumps({"synced_at": st["synced_at"], "queue_properties": len(st["order"]), "pairs": len(pairs),
                      "by_category": cats, "pairs_never_posted": never, "pairs_repost_eligible": elig,
                      "waiting_images": [st["properties"][x]["listing_number"] for x in st["waiting_images"]],
                      "waiting_age": [st["properties"][x]["listing_number"] for x in st["waiting_age"]],
                      "no_matching_groups": [st["properties"][x]["listing_number"] for x in st["no_matching_groups"]],
                      "today_used": used, "today_per_group": per_g}, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- assets
FEAT = {"ac": "מזגנים", "accessible": "נגיש", "alarm": "אזעקה", "balcony": "מרפסת", "building_shelter": "מקלט בבניין",
        "cameras": "מצלמות", "cold_room": "חדר קירור", "comms": "תשתית תקשורת", "elevator": "מעלית",
        "ev_charger": "עמדת טעינה לרכב", "furnished": "מרוהט", "high_ceiling": "תקרה גבוהה", "kitchenette": "מטבחון",
        "loading_ramp": "רמפת העמסה", "mamad": 'ממ"ד', "mamak": 'ממ"ק', "meeting_room": "חדר ישיבות",
        "parking": "חניה", "renovated_feature": "משופץ", "storage": "מחסן", "sun_balcony": "מרפסת שמש"}
# chip priority per category (first = most important)
FEAT_RES = ["mamad", "parking", "elevator", "balcony", "sun_balcony", "ac", "storage", "renovated_feature",
            "furnished", "accessible", "mamak", "building_shelter"]
FEAT_COM = ["parking", "loading_ramp", "high_ceiling", "elevator", "ac", "meeting_room", "kitchenette", "storage",
            "accessible", "cold_room", "ev_charger", "comms", "alarm", "cameras", "mamak", "building_shelter",
            "furnished", "renovated_feature"]
TYPE_LABEL = {"חנויות/שטח מסחרי": "חנות / שטח מסחרי", "משרדים": "משרד", "מבני תעשייה": "מבנה תעשייה",
              "מחסנים": "מחסן", "מגרשים": "מגרש", "אולמות": "אולם", "בית פרטי/קוטג'": "בית פרטי", "גג/פנטהאוז": "פנטהאוז"}
ICON = {
    "rooms": '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    "sqm": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h4M3 15h4M9 3v4M15 3v4"/>',
    "floor": '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
    "mamad": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    "ac": '<path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7"/>',
    "balcony": '<path d="M3 21h18M5 21V11h14v10M9 21v-6M15 21v-6M3 11h18"/>',
    "parking": '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
    "price": '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    "garden": '<path d="M12 22V12M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z"/>',
    "check": '<path d="M5 12l5 5L20 7"/>',
    "zoning": '<path d="M3 21h18M6 21V8l6-4 6 4v13"/><path d="M10 21v-5h4v5"/>',
}


def asset_dir(p):
    return os.path.join(ROOT, str(p["listing_number"]))


def assets_ready(d):
    return os.path.exists(os.path.join(d, "ad_image.jpg")) and os.path.exists(os.path.join(d, "post.txt"))


def size_of(p):
    for k in ("size_sqm", "built_size_sqm", "area_sqm"):
        if p.get(k):
            return p[k]
    return None


def is_lot(p):
    return p.get("property_type") in ("מגרש", "מגרשים")


def type_phrase(p, short=False):
    t = p.get("property_type") or ""
    r = p.get("rooms")
    if p.get("category") == "residential" and r and not is_lot(p):
        rs = fmt_num(r)
        if t == "דירה":
            return f"דירת {rs} חדרים"
        return f"{TYPE_LABEL.get(t, t)} {rs} חדרים"
    return TYPE_LABEL.get(t, t)


def deal_word(p):
    return {"sale": "למכירה", "rent": "להשכרה"}.get(p.get("deal_type"), "")


def floor_text(p):
    f = p.get("floor")
    if f is None or is_lot(p):
        return None
    s = "קומת קרקע" if f == 0 else f"קומה {f}"
    if p.get("total_floors"):
        s += f" מתוך {p['total_floors']}"
    return s


def price_parts(p):
    if not p.get("price"):
        return None, ""
    suf = []
    if p.get("deal_type") == "rent":
        suf.append("לחודש")
    if p.get("category") == "commercial" and p.get("price_includes_vat") is False:
        suf.append('+ מע"מ')
    return fmt_num(p["price"]), " ".join(suf)


def features(p, n=None):
    order = FEAT_COM if p.get("category") == "commercial" else FEAT_RES
    fs = [f for f in (p.get("features") or []) if f in FEAT]
    fs.sort(key=lambda f: order.index(f) if f in order else 99)
    return fs[:n] if n else fs


def chip(icon, text):
    return f'<div class="chip"><svg viewBox="0 0 24 24">{ICON.get(icon, ICON["check"])}</svg>{htmllib.escape(text)}</div>'


def ad_html(p, disc):
    e = htmllib.escape
    chips = []
    sz = size_of(p)
    if p["category"] == "residential" and not is_lot(p):
        if p.get("rooms"): chips.append(chip("rooms", f"{fmt_num(p['rooms'])} חדרים"))
        if sz: chips.append(chip("sqm", f'{fmt_num(sz)} מ"ר'))
        if floor_text(p): chips.append(chip("floor", floor_text(p)))
        if p.get("garden_sqm"): chips.append(chip("garden", f'גינה {fmt_num(p["garden_sqm"])} מ"ר'))
        for f in features(p, 6 - len(chips)):
            chips.append(chip(f if f in ICON else "check", FEAT[f]))
    else:
        if sz: chips.append(chip("sqm", f'{fmt_num(sz)} מ"ר'))
        if floor_text(p): chips.append(chip("floor", floor_text(p)))
        if p.get("price_per_sqm"):
            chips.append(chip("price", f'₪{fmt_num(p["price_per_sqm"])} למ"ר' + (" לחודש" if p["deal_type"] == "rent" else "")))
        if is_lot(p) and p.get("land_zoning"): chips.append(chip("zoning", f"ייעוד: {p['land_zoning']}"))
        if is_lot(p) and p.get("sales_area"): chips.append(chip("check", p["sales_area"]))
        for f in features(p, max(0, 6 - len(chips))):
            chips.append(chip(f if f in ICON else "check", FEAT[f]))
    street = (p.get("street") or "").strip()
    city = (p.get("city") or "").strip()
    loc = f"רחוב {street}, {city}" if street and not street.startswith("רחוב") else ", ".join(x for x in (street, city) if x)
    sub = f'<div class="sub">{e(p["neighborhood"])}</div>' if p.get("neighborhood") else ""
    num, suf = price_parts(p)
    price = (f'<div class="price"><span class="pnum">₪{num}</span>' + (f'<span class="psuf">{e(suf)}</span>' if suf else "") + "</div>") if num else "<div></div>"
    tpl = open(os.path.join(TOOLS, "ad_template.html"), encoding="utf-8").read()
    rep = {"{TAG}": e(nodash(f"{deal_word(p)} | {type_phrase(p)}")), "{NUM}": str(p["listing_number"]),
           "{LOC}": e(nodash(loc)), "{SUB}": nodash(sub), "{CHIPS}": "\n".join(chips[:6]), "{PRICE}": price,
           # no disclosure (other agents): an invisible same-height spacer keeps the band layout unchanged
           "{DISC}": f'<div class="disc">{e(nodash(disc))}</div>' if disc else '<div class="disc" style="visibility:hidden">.</div>'}
    for k, v in rep.items():
        tpl = tpl.replace(k, v)
    return tpl


def hashtags(p):
    city = re.sub(r"[\s\"'״׳-]", "", p.get("city") or "")
    if p["category"] == "commercial":
        kind = "#נדלןמסחרי"
    elif is_lot(p):
        kind = "#מגרשלמכירה"
    else:
        kind = "#דירהלמכירה" if p["deal_type"] == "sale" else "#דירהלהשכרה"
        if p.get("property_type") not in ("דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "טריפלקס"):
            kind = "#ביתלמכירה" if p["deal_type"] == "sale" else "#ביתלהשכרה"
    # FB max 3: the agency tag (owner rule 2026-10-24) replaces the generic #נדלן; #נדלן only if there is no agency
    tags = [f"#{city}" if city else None, kind, agency_hashtag(p) or "#נדלן"]
    return " ".join(dict.fromkeys(t for t in tags if t))[:200]


def agency_hashtag(p):
    """#<agency name>: quotes/gershayim, punctuation and spaces stripped (א.ב. נדל"ן -> #אבנדלן)."""
    t = re.sub(r"[\W_]+", "", p.get("agency_name") or "")
    return f"#{t}" if t else ""


def hashtags_ig(p):
    """Instagram: max 5 = city, deal/type, agency, נדלן<city>, #שוקהנדלן."""
    city = re.sub(r"[\W_]+", "", p.get("city") or "")
    base = hashtags(p).split()
    tags = base + ([f"#נדלן{city}"] if city else []) + ["#שוקהנדלן"]
    if not agency_hashtag(p): tags.insert(2, "#נדלן")
    return " ".join(list(dict.fromkeys(tags))[:5])


# ---------------------------------------------------------------- description sanitizer
SUPER_DROP = r"מדהי|חלומי|יוצא(?:ת|ים|ות)? דופן|מושלמ|מושלם|מרהיב|נדיר|הכי |ביותר|פנינה|הזדמנות|מציאה|אין כמוה|אין כמוהו|לא תאמינו"
SUPER_STRIP = [r"\s*במיקום מבוקש", r"\s*ברמה גבוהה", r"\s*במיוחד", r"\s*מרשים(?:ה|ים)?(?: בגודלו| בגודלה)?", r"\s*מפנק(?:ת|ים|ות)?",
               r"\s*מבוקש(?:ת|ים|ות)?", r"\s*יוקרתי(?:ת|ים|ות)?", r"\s*מושקע(?:ת|ים|ות)?", r"\s*מעולה", r"\s*מטופח(?:ת|ים)?"]
YIELD = r"תשואה|השקעה|עליית ערך|עליית מחירים|פוטנציאל|ישתלם|מחירים עולים|שווי עולה|(?<![\u0590-\u05FF])רווח(?:ים|י)?(?![\u0590-\u05FF])"
PEOPLE = r"בעל(?:י|ת)? הנכס|הבעלים|המוכר|המוכרת|השוכר|השוכרת|הדייר|הדיירת|המשכיר"
CONTACT = r"https?://|www\.|\S+@\S+|\d[\d\- ]{7,}\d|לתאם|לתיאום|ניתן לפנות|צרו קשר|התקשרו|לפרטים|מוזמנים"
PRICE = r"₪|ש\"ח|ש״ח|שקל|מחיר"


def clean_description(p, limit=350):
    """Marketing description (fallback: description), sanitized per the platform copy rules."""
    raw = (p.get("marketing_description") or p.get("description") or "").strip()
    if not raw:
        return ""
    t = re.sub(r"\s*[\u2013\u2014\u2015]\s*", ", ", raw)
    t = re.sub(r"\s+-\s+", ", ", t)            # spaced hyphen used as a dash
    t = re.sub(r"\s+", " ", t)
    sents = re.split(r"(?<=[.!?])\s+", t)
    names = [re.escape(x) for x in (p.get("agent_name"), p.get("agency_name"), p.get("agent2_name")) if x]
    out = []
    for snt in sents:
        snt = snt.strip()
        if not snt:
            continue
        if re.search(SUPER_DROP, snt) or re.search(YIELD, snt) or re.search(PEOPLE, snt) \
                or re.search(CONTACT, snt) or re.search(PRICE, snt) \
                or (names and re.search("|".join(names), snt)):
            continue
        for pat in SUPER_STRIP:
            snt = re.sub(pat, "", snt)
        snt = re.sub(r"\s+([,.])", r"\1", snt).replace(",,", ",").strip(" ,")
        if not snt.endswith((".", "!", "?")):
            snt += "."
        out.append(snt)
    res = ""
    for snt in out:
        if len(res) + len(snt) + 1 > limit and res:
            break
        res = (res + " " + snt).strip()
    return res


def post_text(p, disc):
    """Copy per platform PROPERTY_COPY_RULES: structured facts + the sanitized marketing description
    (clean_description) ; no superlatives,
    no names other than the handling agent/agency, no long dashes, phone/link only in system lines."""
    L = []
    sz = size_of(p)
    street, city = (p.get("street") or "").strip(), (p.get("city") or "").strip()
    emoji = "🏢" if p["category"] == "commercial" else ("🏗️" if is_lot(p) else "🏡")
    hook = f"{type_phrase(p)} {deal_word(p)}"
    if sz: hook += f', {fmt_num(sz)} מ"ר'
    if street and city: hook += f" ברחוב {street} ב{city}"
    elif city: hook += f" ב{city}"
    L.append(f"{hook} {emoji}")
    L.append("")
    # caption structure (owner, 2026-10-24): hook, specs immediately, then the descriptive paragraph;
    # the site name/link appears ONCE, in the closing listing line (closing_lines)
    addr = " ".join(x for x in (f"רחוב {street}" if street else "", p.get("house_number") or "") if x)
    loc = ", ".join(x for x in (addr, city) if x)
    if p.get("neighborhood"): loc += f" | {p['neighborhood']}"
    if loc: L.append(f"📍 {loc}")
    if p["category"] == "residential" and not is_lot(p):
        bits = [f"{fmt_num(p['rooms'])} חדרים" if p.get("rooms") else None, f'{fmt_num(sz)} מ"ר' if sz else None]
        if any(bits): L.append("🏠 " + " | ".join(b for b in bits if b))
    else:
        bits = [f'{fmt_num(sz)} מ"ר' if sz else None,
                (f'₪{fmt_num(p["price_per_sqm"])} למ"ר' + (" לחודש" if p["deal_type"] == "rent" else "")) if p.get("price_per_sqm") else None]
        if any(bits): L.append("📐 " + " | ".join(b for b in bits if b))
    if floor_text(p): L.append(f"🏢 {floor_text(p)}")
    if p.get("garden_sqm"): L.append(f'🌳 גינה {fmt_num(p["garden_sqm"])} מ"ר')
    if is_lot(p) and p.get("land_zoning"): L.append(f"🗺️ ייעוד: {p['land_zoning']}")
    if is_lot(p) and p.get("sales_area"): L.append(f"🗺️ {p['sales_area']}")
    fs = features(p)
    if fs: L.append("✨ " + " | ".join(FEAT[f] for f in fs))
    if p.get("move_in_date"):
        try:
            L.append("📅 כניסה: " + datetime.fromisoformat(p["move_in_date"]).strftime("%d/%m/%Y"))
        except Exception:
            pass
    num, suf = price_parts(p)
    if num: L.append(f"💰 מחיר: {num} ₪" + (f" {suf}" if suf else ""))      # the post.txt hook has no price
    extra = []
    if p.get("maintenance_fee"): extra.append(f"ועד בית: {fmt_num(p['maintenance_fee'])} ₪")
    if p.get("arnona"): extra.append(f"ארנונה: {fmt_num(p['arnona'])} ₪")
    if extra: L.append("🧾 " + " | ".join(extra))
    desc = clean_description(p)
    if desc:
        L += ["", desc]
    # ---- system lines (only place for names/phone/link)
    contact = contact_line(p)
    if contact:
        L += ["", "לפרטים ולתיאום ביקור:", contact]
    # no ethics-code line (owner rule 2026-10-24); Tomer's licence line only on his own listings
    L += [""] + closing_lines(p, disc, "fb") + ["", hashtags(p)]
    return nodash("\n".join(L)).rstrip() + "\n"


def contact_line(p):
    return " · ".join(x for x in (p.get("agent_name"), p.get("agency_name") if p.get("agency_name") != p.get("agent_name") else None,
                                  fmt_phone(p.get("agent_phone"))) if x)


def closing_lines(p, disc, platform):
    """The single place where the site appears (owner rule 2026-10-24):
    IG: 🔖 מודעה N באתר שוק הנדל״ן | shuknadlan.co.il   FB: 🔖 מודעה N באתר שוק הנדל״ן: <property link>
    Tomer's own properties: his disclosure line follows it."""
    n = p["listing_number"]
    L = [f"🔖 מודעה {n} באתר שוק הנדל״ן: {SITE.format(p['id'])}" if platform == "fb"
         else f"🔖 מודעה {n} באתר שוק הנדל״ן | shuknadlan.co.il"]
    if is_tomer(p):
        L.append(disc if disc and disc != SITE_LINE else DEFAULT_DISCLOSURE)
    return L


def reel_caption(p, st, platform):
    """Facebook / Instagram reel caption (the FB version is also the group reel-share text).
    Order: hook (with price), specs, descriptive paragraph, agent, tag CTA, closing listing line (site once), hashtags.
    IG has no link apart from the plain domain. No ethics line. Optional <no>/reel/caption_description.txt
    overrides the paragraph (hand-written copy)."""
    sz = size_of(p)
    street, city, nb = (p.get("street") or "").strip(), (p.get("city") or "").strip(), p.get("neighborhood")
    num, suf = price_parts(p)
    head = f"🔥 {type_phrase(p)} {deal_word(p)}" + (f" ב{city}" if city else "")
    if num: head += f", {num} ₪" + (f" {suf}" if suf else "")
    where = ", ".join(x for x in ((f"רחוב {street}" if street and not street.startswith("רחוב") else street), nb) if x)
    if where: head += f" | {where}"
    L = [head, ""]
    if p["category"] == "residential" and not is_lot(p):
        bits = [f"{fmt_num(p['rooms'])} חדרים" if p.get("rooms") else None, f'{fmt_num(sz)} מ"ר' if sz else None]
        if any(bits): L.append("🏠 " + " | ".join(b for b in bits if b))
    elif sz:
        L.append(f'📐 {fmt_num(sz)} מ"ר')
    if floor_text(p): L.append(f"🏢 {floor_text(p)}")
    fs = features(p, 4)
    if fs: L.append("✨ " + " | ".join(FEAT[f] for f in fs))
    # no 💰 bullet: the price is already in the hook
    ov = os.path.join(asset_dir(p), "reel", "caption_description.txt")
    desc = open(ov, encoding="utf-8").read().strip() if os.path.exists(ov) else clean_description(p, 260)
    if desc: L += ["", desc]
    contact = contact_line(p)
    if contact: L += ["", "לפרטים ולתיאום ביקור:", contact]
    if p["category"] == "commercial":
        what = "נכס מסחרי"
    elif is_lot(p):
        what = "מגרש"
    else:
        what = "דירה" if p.get("property_type") in ("דירה", "דירת גן", "גג/פנטהאוז", "דופלקס", "טריפלקס") else "בית"
        if p.get("deal_type") == "rent": what += " להשכרה"
    L += ["", f"מכירים מישהו שמחפש {what}" + (f" ב{city}" if city else "") + "? תייגו אותו 👇", ""]
    L += closing_lines(p, disclosure_for(p, st), platform)
    L += ["", hashtags(p) if platform == "fb" else hashtags_ig(p)]
    return nodash("\n".join(L)).rstrip() + "\n"


def write_reel_captions(p, st, force=False):
    """<no>/reel/fb_caption.txt + ig_caption.txt. Existing files are kept unless force (hand-edited captions)."""
    rd = os.path.join(asset_dir(p), "reel"); os.makedirs(rd, exist_ok=True)
    out = []
    for plat in ("fb", "ig"):
        f = os.path.join(rd, f"{plat}_caption.txt")
        if force or not os.path.exists(f):
            open(f, "w", encoding="utf-8").write(reel_caption(p, st, plat))
        out.append(f)
    return out


def fetch(url, dst):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f)


def to_jpg(src, dst):
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    im.save(dst, quality=92)


def build_assets(p, st, force=False):
    d = asset_dir(p)
    src = os.path.join(d, "src"); os.makedirs(src, exist_ok=True)
    disc = disclosure_for(p, st)
    wm = os.path.join(TOOLS, "watermark.py")
    # post.txt is always (re)generated from structured data
    open(os.path.join(d, "post.txt"), "w", encoding="utf-8").write(post_text(p, disc))
    approved = os.path.join(d, "ad_image_v2.jpg")
    if str(p["listing_number"]) == "1171" and os.path.exists(approved):
        # keep the approved ad (v2) as the live ad; v3 (broker card) is a sample pending approval
        shutil.copyfile(approved, os.path.join(d, "ad_image.jpg"))
        return d
    if not force and os.path.exists(os.path.join(d, "ad_image.jpg")) and os.path.exists(os.path.join(d, ".built")):
        return d
    imgs = [u for u in (p.get("images") or []) if u][:6]
    local = []
    for i, u in enumerate(imgs, 1):
        raw = os.path.join(src, f"img_{i}" + os.path.splitext(u.split("?")[0])[1].lower())
        if not os.path.exists(raw):
            fetch(u, raw)
        jp = os.path.join(src, f"img_{i}.jpg")
        to_jpg(raw, jp); local.append(jp)
    shutil.copyfile(local[0], os.path.join(src, "hero.jpg"))
    # ad image: Tomer's licence line only on his own listings; other agents get no extra line there because
    # the bottom-left lockup already reads "שוק הנדל״ן / shuknadlan.co.il" (= SITE_LINE)
    open(os.path.join(src, "ad.html"), "w", encoding="utf-8").write(ad_html(p, disc if is_tomer(p) else ""))
    cmd = [sys.executable, wm, "ad", "--logo", LOGO, "--html", os.path.join(src, "ad.html"), "--assets", src,
           "--out", os.path.join(d, "ad_image.jpg"),
           "--agent-name", nodash(p.get("agent_name") or ""), "--agency-name", nodash(p.get("agency_name") or "")]
    if p.get("agency_logo"):
        try:
            lp = os.path.join(src, "agency_logo" + os.path.splitext(p["agency_logo"])[1].lower())
            if not os.path.exists(lp): fetch(p["agency_logo"], lp)
            cmd += ["--agency-logo", lp]
        except Exception as ex:
            print("agency logo download failed:", ex, file=sys.stderr)
    subprocess.run(cmd, check=True)        # no ethics badge on the broker card (owner rule 2026-10-24)
    for f in os.listdir(d):
        if re.match(r"photo_\d+_wm\.jpg$", f): os.remove(os.path.join(d, f))
    for i, jp in enumerate(local[1:], 2):
        subprocess.run([sys.executable, wm, "photo", "--logo", LOGO, "--in", jp,
                        "--out", os.path.join(d, f"photo_{i}_wm.jpg")], check=True, stdout=subprocess.DEVNULL)
    open(os.path.join(d, ".built"), "w").write(datetime.now(TZ).isoformat())
    return d


def cmd_build(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid)
    if not p:
        sys.exit("property not in state (inactive or not synced)")
    if not [u for u in (p.get("images") or []) if u]:
        sys.exit("property has no images (waiting_images)")
    print(build_assets(p, st, force=args.force))


def cmd_captions(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    print("\n".join(write_reel_captions(st["properties"][pid], st, force=args.force)))


def cmd_reel(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    n = st["properties"][pid]["listing_number"]
    cmd = [sys.executable, os.path.join(TOOLS, "reel.py"), "stories" if args.cmd == "build-stories" else "reel", str(n)]
    if args.cmd == "build-reel":
        cmd += [f for f, on in (("--female", args.female), ("--long", args.long), ("--no-outro", args.no_outro)) if on]
        for f, v in (("--rate", args.rate), ("--tag", args.tag), ("--track", args.track)):
            if v: cmd += [f, v]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("sync"); a.add_argument("--snapshot"); a.add_argument("--now")
    a = sp.add_parser("next"); a.add_argument("--limit", type=int, default=DAILY_CAP); a.add_argument("--build", action="store_true"); a.add_argument("--now")
    a = sp.add_parser("build-assets"); a.add_argument("--property", required=True); a.add_argument("--force", action="store_true")
    a = sp.add_parser("record"); a.add_argument("--property", required=True); a.add_argument("--group", required=True)
    a.add_argument("--status", required=True, choices=["posted", "pending_approval", "skipped", "failed"])
    a.add_argument("--url"); a.add_argument("--note"); a.add_argument("--force", action="store_true")
    a = sp.add_parser("status"); a.add_argument("--now")
    a = sp.add_parser("build-stories"); a.add_argument("--property", required=True)
    a = sp.add_parser("build-captions"); a.add_argument("--property", required=True); a.add_argument("--force", action="store_true")
    a = sp.add_parser("build-reel"); a.add_argument("--property", required=True); a.add_argument("--female", action="store_true")
    a.add_argument("--long", action="store_true"); a.add_argument("--no-outro", action="store_true")
    a.add_argument("--rate", help="TTS rate, e.g. +8%%"); a.add_argument("--tag", help="output suffix (default v3)"); a.add_argument("--track", help="tracks.json key")
    args = ap.parse_args()
    {"sync": cmd_sync, "next": cmd_next, "build-assets": cmd_build, "record": cmd_record, "status": cmd_status,
     "build-stories": cmd_reel, "build-reel": cmd_reel, "build-captions": cmd_captions}[args.cmd](args)


if __name__ == "__main__":
    main()
