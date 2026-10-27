#!/usr/bin/env python3
"""Facebook group posting queue for שוק נדל"ן (shuknadlan.co.il).

Nothing here posts to Facebook. It plans posts, builds assets and keeps a ledger;
a separate browser step posts, then calls `record`.

Commands
  sync         [--snapshot FILE]   rebuild queue from a Supabase snapshot (tools/sync_query.sql output)
  next         [--limit N] [--build] [--now ISO]   next posts honoring caps / dedupe / spreading
  build-assets --property <uuid|listing_number> [--force]   post.txt + ONE designed ad_image.jpg (tools/post_image.py) or text-only
  record       --property P --group G --status posted|pending_approval|skipped|failed [--url U] [--note T]
  status       summary of queue, waiting lists and today's usage
  build-stories --property P       9:16 story slides  (tools/reel.py)
  build-captions --property P [--force]  reel captions <no>/reel/fb_caption.txt + ig_caption.txt
  build-reel    --property P       15s reel: reel_voice_male_v3.mp4 / reel_music_15s_v3.mp4 (+ --long/--female/--rate/--tag/--track)
  reel-next     [--count N]         next daily-reel candidate (JSON): category pattern R,R,C; no-video listings first;
                                  agent rotation (never the previous reel's agent, fewest reels in 7 days first);
                                  render needs >= 3 usable photos
                                   action render | reuse_site_video (agent / CRM reel / daily video already on the site)
  page-next     [--count N] [--market M] [--build]  next Page/IG feed posts (listings already posted in groups,
                                  cap 3/day per market, R/C alternation, agent rotation) + page captions
  page-record   --property P --status posted|failed|skipped [--fb-url U] [--ig-url U] [--market M]
  page-captions --property P      <no>/page/fb_caption.txt + ig_caption.txt (Page/IG feed post)
  highlight-next [--count N] [--market M] [--highlight sale|rent|commercial] [--build]  story cards not yet in IG highlights
  highlight-record --property P --status added|removed|failed [--highlight H]
  highlight-stale [--market M]    highlight entries to remove by hand (sold/inactive/moved listings)
  article-next  [--count N]         next unposted site article (title, url, cover, teaser) + FB/IG captions; article-record --slug S
  agency-next   [--count N] [--build]  next agency promo post (14-day gap per agency, Tomer's agency excluded); agency-record
  market        [--property P]    city -> market lookup (tools/market_cities.json); market-cache --raw FILE refreshes it
  fetch-site-video --property P    download the site's video_url + poster -> <no>/reel/site_video.mp4 + site_cover.jpg
  price-flags                      write per_sqm_flag notes into queue/state.json (sync does it too) and print them
                                   (price per m² per month only when the agent's description says so: price_unit())

Rules
  * eligible property: status=active, >=1 image, created >= 1 hour ago
  * geography/category/deal-type matching against tools/groups.json, best 3 groups per property
  * a (property, group) pair can be posted again only 14+ days after its last posted/pending_approval
  * daily cap 18 posts (posted+pending_approval, Asia/Jerusalem date), max 3 per group per day
  * copy/images: Tomer's name + license only on Tomer's own properties (is_tomer); others get SITE_LINE;
    no ethics-code line or ethics badge for anyone (owner rules 2026-10-24)
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, urllib.request, urllib.error, urllib.parse, html as htmllib
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
DAILY_CAP, GROUP_DAILY_CAP, MAX_GROUPS, REPOST_DAYS, MIN_AGE_H = 18, 3, 3, 14, 1  # daily cap 18 per Tomer 2026-10-25 (was 15)
SITE = "https://shuknadlan.co.il/property?id={}"
# Owner rules (Tomer Itzhak, 2026-10-24):
#  * Tomer's name + license (the ads_settings disclosure line) appear ONLY on Tomer's own properties.
#    Text: the site appears once, in the closing listing line (closing_lines); images rely on the logo lockup.
#  * No ethics-code line / ethics badge anywhere, for any agent (the old ETHICS_LINE and badge were removed).
TOMER_AGENT_ID = "2f552dcf-90d0-4578-9038-cc6e7b9e26a5"     # agency_members.id, agency נדל"ן עפולה
TOMER_NAME, TOMER_AGENCY = "תומר יצחק", 'נדל"ן עפולה'
DEFAULT_DISCLOSURE = 'שוק נדל"ן | תומר יצחק, רישיון תיווך 3134355'
TOMER_LICENSE = "3134355"
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


# ---------------------------------------------------------------- markets (Tomer 2026-10-26)
# city -> market_slug from public.market_cities_public (READ-ONLY tools/market_query.sql), cached in tools/market_cities.json.
MARKETS = os.path.join(TOOLS, "market_cities.json")
DEFAULT_MARKET = "afula-emek"            # current regional Page שוק הנדל"ן של עפולה והסביבה + IG shuknadlan
MARKET_LABEL = {"afula-emek": "עפולה והעמק"}   # site wording (home page); other markets: add when their Page exists
_MK = None


def market_map():
    global _MK
    if _MK is None:
        _MK = (load_json(MARKETS) or {}).get("cities", {})
    return _MK


def market_of(p):
    """market_slug of the listing's city, or None (city not in any market, e.g. 'אזור השרון')."""
    return market_map().get((p.get("city") or "").strip())


def in_market(p, market):
    return market in (None, "", "any", "*") or market_of(p) == market


def group_markets(g):
    return g.get("markets") or ["*"]


def group_accepts(g, p):
    """groups.json 'markets': a listing outside the group's market(s) never goes to that group ('*' = any)."""
    ms = group_markets(g)
    return "*" in ms or market_of(p) in ms


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
    own properties; SITE_LINE for everyone else.
    2026-10-27: ads_settings.disclosure_line was changed on 26.10 to just 'שוק נדל"ן' (no name / licence), so the DB
    value is used for Tomer's listings only if it still carries BOTH his name and licence number; otherwise
    DEFAULT_DISCLOSURE (Tomer's name + licence is mandatory on his own listings, owner rule 2026-10-27)."""
    if is_tomer(p):
        d = (st or {}).get("disclosure") or ""
        return d if (_norm(TOMER_NAME) in _norm(d) and TOMER_LICENSE in d) else DEFAULT_DISCLOSURE
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
        if not group_accepts(g, p):
            continue                       # market rule (Tomer 2026-10-26): e.g. Sharon listings never in Afula groups
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
    for p in props.values():      # site video fields (sync_query.sql 2026-10-25); older snapshots lack them
        p.setdefault("video_url", None); p.setdefault("video_poster_url", None)
        p.setdefault("site_video_type", "none" if not p.get("video_url") else None)
        p.setdefault("open_job", False)
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
    apply_per_sqm_flags(props.values())      # per_sqm_flag notes (owner rule 2026-10-25)
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
                      "no_matching_groups": len(no_groups),
                      "site_video": {t: sum(1 for p in props.values() if p.get("site_video_type") == t)
                                     for t in ("none", "kling", "agent", "crm_reel", "daily", None)
                                     if any(p.get("site_video_type") == t for p in props.values())},
                      "open_jobs": sum(1 for p in props.values() if p.get("open_job"))}, ensure_ascii=False))


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
    gby = {g["id"]: g for g in groups()}
    led, now = ledger(), now_utc(args)
    skipped_market = []
    last = pair_history(led)
    used, per_g = today_usage(led, now)
    room = max(0, min(args.limit, DAILY_CAP - used))
    fresh, repost = [], []
    for rank, pid in enumerate(st["order"]):
        p = st["properties"][pid]
        if not in_market(p, getattr(args, "market", None)):
            continue
        for gi, gid in enumerate(p["_groups"]):
            g = gby.get(gid)
            if g is None or not g.get("active") or not group_accepts(g, p):
                skipped_market.append({"listing_number": p["listing_number"], "group_id": gid, "city": p.get("city"),
                                       "market": market_of(p)})
                continue                   # market rule also applies to a state.json synced before the rule
            t = last.get((pid, gid))
            if t is None:
                fresh.append((rank, gi, pid, gid))
            elif now - t >= timedelta(days=REPOST_DAYS):
                repost.append((t, rank, pid, gid))
    fresh.sort(); repost.sort()
    cands = [(pid, gid, "new") for _, _, pid, gid in fresh] + [(pid, gid, "repost") for _, _, pid, gid in repost]
    picked, prev = [], last_posted_property(led, now)
    cat_of = lambda pid: st["properties"][pid].get("category")
    round_cats = {"residential": 0, "commercial": 0}
    while len(picked) < room and cands:
        # Tomer 2026-10-25: every round mixes commercial AND residential listings
        # (private browsers never see commercial-only posts). Aim for the category
        # with fewer picks in this round (tie -> residential); fall back if none fits.
        want = min(round_cats, key=lambda c: (round_cats[c], c != "residential"))
        choice = None
        for i, (pid, gid, kind) in enumerate(cands):
            if per_g.get(gid, 0) >= GROUP_DAILY_CAP:
                continue
            if pid == prev:
                continue
            if cat_of(pid) != want and any(cat_of(c[0]) == want and per_g.get(c[1], 0) < GROUP_DAILY_CAP
                                           for c in cands):
                continue
            # don't let reposts jump ahead of fresh pairs that are only blocked by spreading
            choice = i; break
        if choice is None:   # only same-property options remain: allow back-to-back
            choice = next((i for i, c in enumerate(cands) if per_g.get(c[1], 0) < GROUP_DAILY_CAP), None)
        if choice is None:
            break
        pid, gid, kind = cands.pop(choice)
        if cat_of(pid) in round_cats:
            round_cats[cat_of(pid)] += 1
        per_g[gid] = per_g.get(gid, 0) + 1
        prev = pid
        picked.append((pid, gid, kind))
    out = []
    for pid, gid, kind in picked:
        p = st["properties"][pid]
        d = asset_dir(p)
        if args.build and not assets_ready(d):
            build_assets(p, st)
        image = ad_image_of(d)
        out.append({"property_id": pid, "listing_number": p["listing_number"], "city": p.get("city"), "market": market_of(p),
                    "category": p.get("category"), "deal_type": p.get("deal_type"),
                    "group_id": gid, "group_name": gname.get(gid), "group_url": f"https://www.facebook.com/groups/{gid}",
                    "kind": kind, "last_posted_at": last[(pid, gid)].isoformat() if (pid, gid) in last else None,
                    "assets_ready": assets_ready(d),
                    # single designed graphic; null = text-only post (no usable photo). Attach exactly `attach`.
                    "image": image, "text_only": assets_ready(d) and image is None,
                    "attach": [image] if image else [],
                    "ad_image": image, "photos": [],
                    "post_text": os.path.join(d, "post.txt"), "property_url": SITE.format(pid)})
    print(json.dumps({"today_used": used, "daily_cap": DAILY_CAP, "returned": len(out), "posts": out,
                      **({"skipped_market": skipped_market} if skipped_market else {})},
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
    allp = sorted(st["properties"].values(), key=lambda x: x["listing_number"] or 0)
    cats = {}
    for pid in st["order"]:
        c = st["properties"][pid]["category"]; cats[c] = cats.get(c, 0) + 1
    print(json.dumps({"synced_at": st["synced_at"], "queue_properties": len(st["order"]), "pairs": len(pairs),
                      "by_category": cats, "pairs_never_posted": never, "pairs_repost_eligible": elig,
                      "waiting_images": [st["properties"][x]["listing_number"] for x in st["waiting_images"]],
                      "waiting_age": [st["properties"][x]["listing_number"] for x in st["waiting_age"]],
                      "no_matching_groups": [st["properties"][x]["listing_number"] for x in st["no_matching_groups"]],
                      "price_per_sqm_from_description": [p["listing_number"] for p in allp if per_sqm(p)],
                      "suspect_price_no_explicit_unit": [p["listing_number"] for p in allp if suspect_price(p)],
                      "price_unit_notes": {str(p["listing_number"]): "description states another per-m² number: "
                                           + "; ".join(price_unit_info(p)["conflicts"])
                                           for p in allp if suspect_price(p) and price_unit_info(p)["conflicts"]},
                      "today_used": used, "today_per_group": per_g}, ensure_ascii=False, indent=1))


def cmd_price_flags(args):
    """Write per_sqm_flag notes into queue/state.json (sync does this too) and print them."""
    st = load_json(STATE)
    apply_per_sqm_flags(st["properties"].values())
    save_json(STATE, st)
    out = []
    for p in sorted(st["properties"].values(), key=lambda x: x["listing_number"] or 0):
        f = p.get("per_sqm_flag")
        if f:
            num, suf = price_parts(p)
            out.append({"listing_number": p["listing_number"], "price": p.get("price"), "size": size_of(p),
                        "display": f"{num} ₪ {suf}".strip(), **f})
    print(json.dumps(out, ensure_ascii=False, indent=1))


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


BUILD_TAG = "single_image_v1"   # group-post assets: one designed graphic (tools/post_image.py) or text-only


def build_info(d):
    """Contents of <no>/.built when it was written by the single-image build, else None (old carousel build)."""
    try:
        info = json.load(open(os.path.join(d, ".built"), encoding="utf-8"))
        return info if isinstance(info, dict) and info.get("build") == BUILD_TAG else None
    except Exception:
        return None


def ad_image_of(d):
    """Path of the group-post graphic, or None for a text-only post (no usable photo)."""
    info = build_info(d)
    if not info or not info.get("image"):
        return None
    p = os.path.join(d, "ad_image.jpg")
    return p if os.path.exists(p) else None


def assets_ready(d):
    info = build_info(d)
    return bool(info) and os.path.exists(os.path.join(d, "post.txt")) and \
        (not info.get("image") or os.path.exists(os.path.join(d, "ad_image.jpg")))


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


# ---------------------------------------------------------------- price unit (owner decision, Tomer 2026-10-25)
# Some agents type the per-m² rent into the price field (1305: price 20, 3,000 m²). The price is shown as per m² per
# month ('X ₪ למ"ר לחודש') ONLY when the agent's own text (description / marketing_description) says so explicitly:
# the price number with ש"ח/₪/שקל and למ"ר / למטר / לממ"ר / per sqm, or wording like 'מחיר למ"ר: X'. Never inferred
# from the price/size ratio. Per-m² listings never show a computed total or a computed price per m².
_PU_NUM = r'(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)'
_PU_CUR = r'(?:ש"ח|ש״ח|ש\'\'ח|ש”ח|₪|שקלים|שקל|nis|ils)'
_PU_SQM = r'(?:ל\s*-?\s*מ"ר|ל\s*-?\s*מ״ר|ל\s*-?\s*מ”ר|ל\s*-?\s*מטר(?:\s*רבוע)?|לממ"ר|לממ״ר|לכל\s+מ"ר|לכל\s+מ״ר|לכל\s+מטר|/\s*מ"ר|/\s*מ״ר|/\s*מטר|per\s*sq\.?\s*m|per\s*sqm|per\s*m2|per\s*m²|/\s*sqm|/\s*m2)'
_PU_MID = r'(?:\s*לחודש)?(?:\s*\+?\s*מע"מ)?\s*'
_PU_PATTERNS = [
    re.compile(_PU_NUM + r'\s*' + _PU_CUR + _PU_MID + _PU_SQM, re.I),                          # 20 ש"ח למ"ר
    re.compile(_PU_CUR + r'\s*' + _PU_NUM + _PU_MID + _PU_SQM, re.I),                          # ₪20 למ"ר
    re.compile(r'(?:מחיר|שכירות|שכ"ד|דמי\s+שכירות)\s*(?:מבוקש\s*)?(?:לחודש\s*)?' + _PU_SQM
               + r'\s*(?:לחודש)?\s*[:\-]?\s*' + _PU_CUR + r'?\s*' + _PU_NUM, re.I),             # מחיר למ"ר: 20
    re.compile(r'price\s*per\s*(?:sq\.?\s*m|sqm|m2|m²)\s*[:\-]?\s*' + _PU_CUR + r'?\s*' + _PU_NUM, re.I),
]


def _pu_num(s):
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def price_unit_info(p):
    """{'unit': 'per_sqm_month'|'month'|'total', 'field', 'phrase', 'conflicts': [phrases with ANOTHER number]}.
    'field'/'phrase' = where the description states the listed price per m² (exact quote)."""
    price = p.get("price")
    unit = "month" if p.get("deal_type") == "rent" else "total"
    info = {"unit": unit, "field": None, "phrase": None, "conflicts": []}
    if not price or p.get("deal_type") != "rent":
        return info
    for field in ("description", "marketing_description"):
        txt = p.get(field) or ""
        for rx in _PU_PATTERNS:
            for m in rx.finditer(txt):
                v = _pu_num(m.group(1))
                phrase = " ".join(m.group(0).split())
                if v is not None and abs(v - float(price)) < 1e-6:
                    if not info["phrase"]:
                        info.update(unit="per_sqm_month", field=field, phrase=phrase)
                elif phrase not in info["conflicts"]:
                    info["conflicts"].append(phrase)
    return info


def price_unit(p):
    """'per_sqm_month' (price is per m² per month, stated in the agent's description) | 'month' (rent) | 'total' (sale)."""
    return price_unit_info(p)["unit"]


def per_sqm(p):
    return price_unit(p) == "per_sqm_month"


def suspect_price(p):
    """Commercial rent with price < 500 whose description does NOT state per m² (posted as-is, listed for Tomer)."""
    pr = p.get("price")
    return (p.get("category") == "commercial" and p.get("deal_type") == "rent" and pr and float(pr) < 500
            and not per_sqm(p))


def per_sqm_flag(p):
    """Note stored on the property in state.json (sync / price-flags); None for unaffected listings."""
    i = price_unit_info(p)
    if i["unit"] == "per_sqm_month":
        return {"unit": "per_sqm_month", "field": i["field"], "phrase": i["phrase"],
                "note": 'price shown as ₪ למ"ר לחודש: the agent\'s description states it per m² (owner rule 2026-10-25); no total computed'}
    if suspect_price(p):
        f = {"unit": "month", "suspect": True,
             "note": "commercial rent price < 500 and the description does not state per m²; posted as-is per Tomer"}
        if i["conflicts"]:
            f["description_per_sqm_other_number"] = i["conflicts"]
        return f
    return None


def apply_per_sqm_flags(props):
    for p in props:
        f = per_sqm_flag(p)
        if f: p["per_sqm_flag"] = f
        else: p.pop("per_sqm_flag", None)


def price_parts(p):
    if not p.get("price"):
        return None, ""
    suf = []
    u = price_unit(p)
    if u == "per_sqm_month":
        suf.append('למ"ר לחודש')
    elif u == "month":
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
        if p.get("price_per_sqm") and not per_sqm(p):
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


def post_text(p, disc, platform="fb"):
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
                (f'₪{fmt_num(p["price_per_sqm"])} למ"ר' + (" לחודש" if p["deal_type"] == "rent" else "")) if p.get("price_per_sqm") and not per_sqm(p) else None]
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
    if platform == "ig":   # IG Page feed post (Tomer 2026-10-26): no links, "מודעה מס' N באתר shuknadlan.co.il", 5 hashtags
        L += [""] + closing_lines(p, disc, "ig_page") + ["", hashtags_ig(p)]
    else:
        L += [""] + closing_lines(p, disc, "fb") + ["", hashtags(p)]
    return nodash("\n".join(L)).rstrip() + "\n"


def contact_line(p):
    return " · ".join(x for x in (p.get("agent_name"), p.get("agency_name") if p.get("agency_name") != p.get("agent_name") else None,
                                  fmt_phone(p.get("agent_phone"))) if x)


def closing_lines(p, disc, platform):
    """The single place where the site appears (owner rule 2026-10-24):
    IG: 🔖 מודעה N באתר שוק הנדל״ן | shuknadlan.co.il   FB: 🔖 מודעה N באתר שוק הנדל״ן: <property link>
    Tomer's own properties: his disclosure line comes BEFORE it (2026-10-27): a line of text right after the
    link line glues onto the URL when a composer drops the newline (Facebook groups, 27.10 13:18 - the link
    became ...?id=<uuid>שוק and 404'd). The link line is therefore always the last text line of the block
    (only a blank line + hashtags follow; a lost newline there gives <uuid>#tag, a harmless fragment)."""
    n = p["listing_number"]
    if platform == "ig_page":
        L = [f"🔖 מודעה מס' {n} באתר shuknadlan.co.il"]
    else:
        L = [f"🔖 מודעה {n} באתר שוק הנדל״ן: {SITE.format(p['id'])}" if platform == "fb"
             else f"🔖 מודעה {n} באתר שוק הנדל״ן | shuknadlan.co.il"]
    if is_tomer(p):
        L.insert(0, disc if disc and disc != SITE_LINE else DEFAULT_DISCLOSURE)
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


_PI = None


def _post_image():
    global _PI
    if _PI is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location("fbpostimage", os.path.join(TOOLS, "post_image.py"))
        _PI = importlib.util.module_from_spec(spec); spec.loader.exec_module(_PI)
    return _PI


def build_assets(p, st, force=False):
    """Group-post assets (owner approval 2026-10-25): post.txt + ONE designed graphic ad_image.jpg
    (tools/post_image.py, variant auto by category/deal, 1080x1350). No carousel photo_N_wm.jpg files any more.
    No usable photo (none / all has_branding / download failed) -> no image: the post goes out text-only.
    A previous ad_image.jpg (old template) is kept as src/ad_image_prev.jpg, never attached."""
    d = asset_dir(p)
    src = os.path.join(d, "src"); os.makedirs(src, exist_ok=True)
    disc = disclosure_for(p, st)
    # post.txt is always (re)generated from structured data (unchanged copy rules)
    open(os.path.join(d, "post.txt"), "w", encoding="utf-8").write(post_text(p, disc))
    if not force and build_info(d) and assets_ready(d):
        return d
    ad = os.path.join(d, "ad_image.jpg")
    if os.path.exists(ad) and not build_info(d):
        shutil.move(ad, os.path.join(src, "ad_image_prev.jpg"))
    try:
        res = _post_image().build_post_image(p, ad)
    except Exception as ex:
        print(f"post_image failed for {p.get('listing_number')}: {ex}; posting text-only", file=sys.stderr)
        res = {"image": None, "variant": None, "photos": 0, "error": str(ex)}
    if not res.get("image") and os.path.exists(ad):
        os.remove(ad)   # never leave a stale graphic behind a text-only post
    json.dump({"build": BUILD_TAG, "at": datetime.now(TZ).isoformat(),
               "image": "ad_image.jpg" if res.get("image") else None,
               "variant": res.get("variant"), "photos": res.get("photos", 0),
               **({"error": res["error"]} if res.get("error") else {})},
              open(os.path.join(d, ".built"), "w", encoding="utf-8"), ensure_ascii=False)
    return d


def cmd_build(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid)
    if not p:
        sys.exit("property not in state (inactive or not synced)")
    d = build_assets(p, st, force=args.force)
    print(json.dumps({"dir": d, "image": ad_image_of(d), "post_text": os.path.join(d, "post.txt")}, ensure_ascii=False))


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
        cmd += [f for f, on in (("--female", args.female), ("--long", args.long), ("--no-outro", args.no_outro),
                                         ("--meta-v2", getattr(args, "meta_v2", False))) if on]
        for f, v in (("--rate", args.rate), ("--tag", args.tag), ("--track", args.track)):
            if v: cmd += [f, v]
    subprocess.run(cmd, check=True)


# ---------------------------------------------------------------- daily reel selection (owner approval 2026-10-25)
REELS = os.path.join(QDIR, "reels.jsonl")
REUSE_TYPES = {"agent", "crm_reel", "daily"}        # site already has a video we must not replace: reuse it
VIDEO_TIER = {"none": 0, "kling": 1, "agent": 2, "crm_reel": 2, "daily": 2}
REEL_PATTERN = ["residential", "residential", "commercial"]


def reels_log():
    if not os.path.exists(REELS):
        return []
    out = []
    for l in open(REELS, encoding="utf-8"):
        if l.strip():
            try: out.append(json.loads(l))
            except Exception: pass
    return out


def _reel_prop(e, st):
    """state.json property of a reels.jsonl entry (by property_id, else listing_number), or None."""
    for p in st["properties"].values():
        if (e.get("property_id") and p["id"] == e["property_id"]) or str(p.get("listing_number")) == str(e.get("listing_number")):
            return p
    return None


def _reel_cat(e, st):
    if e.get("category"):
        return e["category"]
    p = _reel_prop(e, st)
    return p.get("category") if p else None


def agent_key(p):
    """Agent identity for reel rotation: agency_members id, else the normalised agent name (old snapshots)."""
    return p.get("agent_id") or (("name:" + _norm(p.get("agent_name"))) if p.get("agent_name") else None)


def _reel_agent(e, st):
    if e.get("agent_id"):
        return e["agent_id"]
    p = _reel_prop(e, st)
    return agent_key(p) if p else None


def usable_photos(p):
    """Photos a reel can use: same rule as reel.select_photos / post_image (has_branding photos are skipped)."""
    tags = {t.get("url"): t for t in (p.get("image_tags") or []) if isinstance(t, dict)}
    return [u for u in (p.get("images") or []) if u and not (tags.get(u) or {}).get("has_branding")]


MIN_REEL_PHOTOS = 3     # render only with >= 3 usable photos (1006 / 1090 gave near-empty reels, 2026-10-26)
AGENT_WINDOW_DAYS = 7   # agent rotation: count each agent's reels in the last 7 days (Tomer 2026-10-26)


def next_reel_category(cats):
    """R, R, C pattern; never two commercial in a row. cats = categories of past reels, oldest first."""
    cats = [c for c in cats if c]
    if not cats or cats[-1] == "commercial":
        return "residential"
    run = 0
    for c in reversed(cats):
        if c == "commercial": break
        run += 1
    return "commercial" if run >= 2 else "residential"


SITE_SLOT_TYPES = {"agent"}            # "a video the agent uploaded themself" (Tomer 2026-10-26)
SITE_SOURCES = {"site_video", "reuse_site_video", "agent_video"}


def reel_source(e):
    """reels.jsonl entry -> 'site_video' (published the agent's own site video) | 'render' (our render)."""
    if e.get("action") == "reuse_site_video" or e.get("source") in SITE_SOURCES:
        return "site_video"
    return "render"


def reel_slot(sources):
    """Slot rule (Tomer 2026-10-26, updated the same evening): of every 3 daily reels 2 are agent-uploaded site
    videos and 1 is our render. If the last 2 reels were both site videos -> 'render', else 'site_video'
    (an empty site-video slot falls back to a render in the same category)."""
    return "render" if sources[-2:] == ["site_video", "site_video"] else "site_video"


def reel_candidates(st, done_ids, done_nos, market=DEFAULT_MARKET):
    out = []
    for p in st["properties"].values():
        if p.get("status") != "active" or p["id"] in done_ids or str(p.get("listing_number")) in done_nos:
            continue
        if not in_market(p, market):
            continue                       # regional Page: only listings whose city belongs to its market
        if p.get("open_job"):
            continue                       # a CRM reel is being produced right now
        vt = p.get("site_video_type") or ("none" if not p.get("video_url") else "agent")
        has_photos = any(u for u in (p.get("images") or []))
        reuse = vt in REUSE_TYPES and bool(p.get("video_url"))
        if not (has_photos or reuse):
            continue
        if vt in REUSE_TYPES and not reuse:
            vt = "none"
        n_ok = len(usable_photos(p))
        if not reuse and n_ok < MIN_REEL_PHOTOS:
            continue                       # render needs >= 3 usable (non-branded) photos
        # slot kind: 'site_video' = agent upload; 'render' = none/kling; crm_reel/daily (must be reused, not ours to
        # re-render, not an agent upload) only fill a site-video slot after the agent uploads
        kind = "render" if not reuse else "site_video"
        out.append(p | {"_vt": vt, "_reuse": reuse, "_photos": n_ok, "_agent": agent_key(p), "_kind": kind,
                        "_agent_upload": vt in SITE_SLOT_TYPES})
    out.sort(key=lambda p: (VIDEO_TIER.get(p["_vt"], 1), 0 if p["_agent_upload"] else 1, p.get("listing_number") or 0))
    return out


def reel_item(p, fallback, agent_stats=None, agent_repeat=False, slot=None, slot_fallback=False):
    a = (agent_stats or {}).get(p["_agent"], {})
    return {"listing_number": p["listing_number"], "property_id": p["id"], "category": p.get("category"),
            "deal_type": p.get("deal_type"), "city": p.get("city"), "market": market_of(p), "site_video_type": p["_vt"],
            "action": "reuse_site_video" if p["_reuse"] else "render",
            "source": "site_video" if p["_reuse"] else "render", "slot": slot,
            "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "agency_name": p.get("agency_name"),
            "reels_last_7d": a.get("n7", 0), "agent_last_reel": a.get("last_date"), "usable_photos": p["_photos"],
            "video_url": p.get("video_url"), "video_poster_url": p.get("video_poster_url"),
            **({"category_fallback": True} if fallback else {}),
            **({"slot_fallback": True} if slot_fallback else {}),
            **({"agent_repeat": True} if agent_repeat else {})}


def pick_reel(pool, stats, prev_agent, used_agents):
    """Agent rotation inside one category pool (already in tier/listing order):
    never the previous reel's agent, no agent twice in one --count call (each only if another agent is eligible),
    then fewest reels in the last 7 days, then oldest last reel (never = oldest), then the existing order."""
    rest = [p for p in pool if p["_agent"] is None or p["_agent"] != prev_agent]
    repeat = not rest
    pool2 = rest or pool                   # only the previous agent left in this category: the pattern wins
    fresh = [p for p in pool2 if p["_agent"] is None or p["_agent"] not in used_agents]
    pool2 = fresh or pool2
    def key(ip):
        i, p = ip; a = stats.get(p["_agent"], {})
        return (a.get("n7", 0), a.get("last", (-1, -1)), i)
    return min(enumerate(pool2), key=key)[1], repeat


def agent_stats_from(entries, agent_of, today):
    """entries in time order -> ({agent: {n7, last, last_date}}, previous agent)."""
    stats, prev = {}, None
    for i, e in enumerate(entries):
        ag = agent_of(e)
        prev = ag
        if not ag: continue
        try: d = datetime.fromisoformat(str(e.get("date"))[:10]).date()
        except Exception: d = None
        a = stats.setdefault(ag, {"n7": 0, "last": (-1, -1), "last_date": None})
        if d and 0 <= (today - d).days < AGENT_WINDOW_DAYS: a["n7"] += 1
        k = (d.toordinal() if d else -1, i)
        if k > a["last"]: a["last"], a["last_date"] = k, (d.isoformat() if d else None)
    return stats, prev


def cmd_reel_next(args):
    """Next daily-reel candidate(s). Does not change any state; record the reel in queue/reels.jsonl after publishing
    (with agent_id, action and source from this output)."""
    st = load_json(STATE)
    log = reels_log()
    cats = [_reel_cat(e, st) for e in log]
    sources = [reel_source(e) for e in log]
    done_ids = {e.get("property_id") for e in log if e.get("property_id")}
    done_nos = {str(e.get("listing_number")) for e in log if e.get("listing_number")}
    cands = reel_candidates(st, done_ids, done_nos, args.market)
    today = now_utc(args).astimezone(TZ).date()
    stats, prev_agent = agent_stats_from(log, lambda e: _reel_agent(e, st), today)
    picks, used = [], set()
    for j in range(max(1, args.count)):
        want = next_reel_category(cats)
        slot = reel_slot(sources)
        other_slot = "render" if slot == "site_video" else "site_video"
        # order of preference: wanted category + slot kind -> wanted category, other kind (slot_fallback)
        # -> other category (category_fallback; never commercial right after commercial), slot kind first
        tiers = [(want, slot, False, False), (want, other_slot, False, True)]
        alt = "commercial" if want == "residential" else "residential"
        if not (alt == "commercial" and cats and cats[-1] == "commercial"):
            tiers += [(alt, slot, True, False), (alt, other_slot, True, True)]
        pool = []
        for cat, kind, fb, sfb in tiers:
            pool = [p for p in cands if p.get("category") == cat and p["_kind"] == kind]
            if kind == "site_video" and any(p["_agent_upload"] for p in pool):
                pool = [p for p in pool if p["_agent_upload"]]     # agent uploads before CRM/daily reuse
            if pool: break
        if not pool:
            break
        p, rep = pick_reel(pool, stats, prev_agent, used)
        picks.append(reel_item(p, fb, stats, rep, slot, sfb)); cands.remove(p); cats.append(p.get("category"))
        sources.append("site_video" if p["_reuse"] else "render")
        # simulate the pick for the next one (same day)
        ag = p["_agent"]; prev_agent = ag
        if ag:
            used.add(ag)
            a = stats.setdefault(ag, {"n7": 0, "last": (-1, -1), "last_date": None})
            a["n7"] += 1; a["last"], a["last_date"] = (today.toordinal(), len(log) + j), today.isoformat()
    if args.count <= 1:
        print(json.dumps(picks[0] if picks else None, ensure_ascii=False, indent=1))
    else:
        print(json.dumps(picks, ensure_ascii=False, indent=1))


def _download(url, dst):
    """-> (ok, http_status or error). Atomic: writes dst.part then renames."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r, open(dst + ".part", "wb") as f:
            shutil.copyfileobj(r, f)
            status = r.status
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    if os.path.getsize(dst + ".part") == 0:
        os.remove(dst + ".part"); return False, "empty file"
    os.replace(dst + ".part", dst)
    return True, status


def cmd_fetch_site_video(args):
    """Download the property's site video (properties.video_url) and poster for reuse in the daily reel posts."""
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid)
    if not p:
        sys.exit("property not in state (inactive or not synced)")
    url = p.get("video_url")
    res = {"listing_number": p["listing_number"], "site_video_type": p.get("site_video_type"), "video_url": url}
    if not url:
        res["error"] = "no video_url on the site"; print(json.dumps(res, ensure_ascii=False)); sys.exit(1)
    rd = os.path.join(asset_dir(p), "reel"); os.makedirs(rd, exist_ok=True)
    vid, cov = os.path.join(rd, "site_video.mp4"), os.path.join(rd, "site_cover.jpg")
    ok, info = _download(url, vid)
    if not ok:
        res["error"] = f"video download failed ({info})" + ("; storage URL is not public" if "/object/public/" not in url or str(info).startswith("HTTP 4") else "")
        print(json.dumps(res, ensure_ascii=False)); sys.exit(1)
    res["video"] = vid
    try:
        pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration",
                             "-of", "json", vid], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        js = json.loads(pr.stdout or "{}")
        v = [x for x in js.get("streams", []) if x.get("codec_type") == "video"]
        res["probe"] = {"duration": round(float(js.get("format", {}).get("duration") or 0), 2),
                        "width": v[0].get("width") if v else None, "height": v[0].get("height") if v else None,
                        "vcodec": v[0].get("codec_name") if v else None,
                        "audio": any(x.get("codec_type") == "audio" for x in js.get("streams", []))}
    except Exception as ex:
        res["probe_error"] = str(ex)
    poster = p.get("video_poster_url")
    if poster:
        ok, info = _download(poster, cov + ".src")
        if ok:
            try: to_jpg(cov + ".src", cov); res["cover"], res["cover_source"] = cov, "video_poster_url"
            except Exception as ex: res["cover_error"] = str(ex)
            os.remove(cov + ".src")
        else:
            res["cover_error"] = f"poster download failed ({info})"
    if "cover" not in res:     # no poster on the site: first frame (+0.5s) of the video
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "0.5", "-i", vid, "-frames:v", "1", "-q:v", "2", cov],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)
        if r.returncode == 0 and os.path.exists(cov):
            res["cover"], res["cover_source"] = cov, "frame_0.5s"
        else:
            res["cover_error"] = (res.get("cover_error", "") + " frame grab failed").strip()
    print(json.dumps(res, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- Page / IG feed posts (Tomer 2026-10-26)
# Every listing posted in groups also goes ONCE as a feed post on its market's regional FB Page + IG shuknadlan,
# with its designed ad_image.jpg. Log: queue/page_posts.jsonl (one line per attempt, written by page-record).
PAGE_LOG = os.path.join(QDIR, "page_posts.jsonl")
PAGE_DAILY_CAP = 3
PAGES = {"afula-emek": {"fb_page": 'שוק הנדל"ן של עפולה והסביבה', "ig": "shuknadlan"}}


def jsonl(path):
    if not os.path.exists(path):
        return []
    out = []
    for l in open(path, encoding="utf-8"):
        if l.strip():
            try: out.append(json.loads(l))
            except Exception: pass
    return out


def append_jsonl(path, obj):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def page_caption_files(p, st, force=True):
    """<no>/page/fb_caption.txt (post_text: property link, max 3 hashtags incl. agency) and ig_caption.txt
    (same body, no link, "🔖 מודעה מס' N באתר shuknadlan.co.il", 5 hashtags). Regenerated from structured data."""
    d = os.path.join(asset_dir(p), "page"); os.makedirs(d, exist_ok=True)
    disc = disclosure_for(p, st)
    out = {}
    for plat in ("fb", "ig"):
        f = os.path.join(d, f"{plat}_caption.txt")
        if force or not os.path.exists(f):
            open(f, "w", encoding="utf-8").write(post_text(p, disc, plat))
        out[plat] = f
    return out


def group_posted_first(led):
    """property_id -> first group post time (posted or pending_approval)."""
    first = {}
    for e in led:
        if e.get("status") in BLOCKING:
            t = parse_ts(e["timestamp"])
            if e["property_id"] not in first or t < first[e["property_id"]]:
                first[e["property_id"]] = t
    return first


def cmd_page_next(args):
    """Next Page/IG feed posts for one market (read only). Cap 3 per Asia/Jerusalem day per market (posted lines in
    page_posts.jsonl), alternate residential/commercial (residential first), agent rotation as for reels,
    only listings already posted (or pending approval) in groups and never page-posted."""
    st = load_json(STATE)
    market = args.market
    led, now = ledger(), now_utc(args)
    today = now.astimezone(TZ).date()
    log = [e for e in jsonl(PAGE_LOG) if e.get("market", DEFAULT_MARKET) == market]
    done = {e["property_id"] for e in log if e.get("status") == "posted"}
    used = sum(1 for e in log if e.get("status") == "posted" and str(e.get("date")) == today.isoformat())
    room = max(0, min(args.count, PAGE_DAILY_CAP - used))
    first = group_posted_first(led)
    cands, no_image = [], []
    for pid, t in sorted(first.items(), key=lambda x: x[1]):
        p = st["properties"].get(pid)
        if not p or p.get("status") != "active" or pid in done or not in_market(p, market):
            continue
        d = asset_dir(p)
        if args.build and not assets_ready(d):
            build_assets(p, st)
        if not ad_image_of(d):
            no_image.append(p["listing_number"]); continue      # IG needs an image: text-only listings are skipped
        cands.append(p | {"_agent": agent_key(p), "_first": t})
    stats, prev = agent_stats_from(log and [e for e in log if e.get("status") == "posted"],
                                   lambda e: e.get("agent_id") or agent_key(st["properties"].get(e.get("property_id"), {})), today)
    cats = [e.get("category") for e in log if e.get("status") == "posted"]
    picks, used_ag = [], set()
    for j in range(room):
        want = "commercial" if cats and cats[-1] == "residential" else "residential"
        pool = [p for p in cands if p.get("category") == want]; fb = False
        if not pool:
            pool = [p for p in cands if p.get("category") != want]; fb = True
        if not pool:
            break
        p, rep = pick_reel(pool, stats, prev, used_ag)
        cands.remove(p); cats.append(p.get("category"))
        cap = page_caption_files(p, st) if args.build else {}
        a = stats.get(p["_agent"], {})
        picks.append({"listing_number": p["listing_number"], "property_id": p["id"], "category": p.get("category"),
                      "deal_type": p.get("deal_type"), "city": p.get("city"), "market": market,
                      "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "agency_name": p.get("agency_name"),
                      "page_posts_last_7d": a.get("n7", 0), "first_group_post": p["_first"].astimezone(TZ).isoformat(),
                      "image": ad_image_of(asset_dir(p)), "fb_caption": cap.get("fb"), "ig_caption": cap.get("ig"),
                      "property_url": SITE.format(p["id"]),
                      **({"category_fallback": True} if fb else {}), **({"agent_repeat": True} if rep else {})})
        ag = p["_agent"]; prev = ag
        if ag:
            used_ag.add(ag); s_ = stats.setdefault(ag, {"n7": 0, "last": (-1, -1), "last_date": None})
            s_["n7"] += 1; s_["last"], s_["last_date"] = (today.toordinal(), 10 ** 6 + j), today.isoformat()
    print(json.dumps({"market": market, "page": PAGES.get(market), "today_posted": used, "daily_cap": PAGE_DAILY_CAP,
                      "remaining_candidates": len(cands), "skipped_no_image": no_image, "posts": picks},
                     ensure_ascii=False, indent=1))


def cmd_page_record(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid) or {}
    if args.status == "posted" and any(e.get("property_id") == pid and e.get("status") == "posted"
                                       and e.get("market", DEFAULT_MARKET) == args.market for e in jsonl(PAGE_LOG)) and not args.force:
        sys.exit("already page-posted in this market (use --force to log a second real post)")
    now = datetime.now(TZ)
    e = {"listing_number": p.get("listing_number"), "property_id": pid, "market": args.market, "category": p.get("category"),
         "agent_id": p.get("agent_id"), "date": now.date().isoformat(), "timestamp": now.isoformat(timespec="seconds"),
         "status": args.status, "fb_url": args.fb_url or "", "ig_url": args.ig_url or "", "note": args.note or ""}
    append_jsonl(PAGE_LOG, e); print(json.dumps(e, ensure_ascii=False))


def cmd_page_captions(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    print(json.dumps(page_caption_files(st["properties"][pid], st), ensure_ascii=False))


# ---------------------------------------------------------------- IG story highlights (Tomer 2026-10-26)
# One 1080x1920 story card per listing (tools/post_image.py story) for the highlights למכירה / להשכרה / מסחרי.
# Log: queue/highlights.jsonl (one line per add/remove, written by highlight-record). The last line per
# (property, market) is its current state.
HL_LOG = os.path.join(QDIR, "highlights.jsonl")
HIGHLIGHT_NAME = {"sale": "למכירה", "rent": "להשכרה", "commercial": "מסחרי"}


def highlight_of(p):
    if p.get("category") == "commercial":
        return "commercial"
    return "rent" if p.get("deal_type") == "rent" else "sale"


def story_card_path(p):
    return os.path.join(asset_dir(p), "highlight", "story_card.jpg")


def hl_current(market):
    cur = {}
    for e in jsonl(HL_LOG):
        if e.get("market", DEFAULT_MARKET) == market:
            cur[e["property_id"]] = e
    return cur


def cmd_highlight_next(args):
    st = load_json(STATE)
    cur = hl_current(args.market)
    todo = [p for p in st["properties"].values() if p.get("status") == "active" and in_market(p, args.market)
            and (cur.get(p["id"], {}).get("status") != "added")
            and (not args.highlight or highlight_of(p) == args.highlight)]
    todo.sort(key=lambda p: p.get("listing_number") or 0)
    # interleave the three highlights so each one grows gradually
    by = {h: [p for p in todo if highlight_of(p) == h] for h in HIGHLIGHT_NAME}
    order = []
    while any(by.values()):
        for h in HIGHLIGHT_NAME:
            if by[h]: order.append(by[h].pop(0))
    out = []
    for p in order[:args.count]:
        f = story_card_path(p)
        if args.build and not os.path.exists(f):
            subprocess.run([sys.executable, os.path.join(TOOLS, "post_image.py"), "story", str(p["listing_number"])],
                           check=False, stdout=subprocess.DEVNULL)
        out.append({"listing_number": p["listing_number"], "property_id": p["id"], "highlight": highlight_of(p),
                    "highlight_name": HIGHLIGHT_NAME[highlight_of(p)], "image": f if os.path.exists(f) else None,
                    "link_sticker": SITE.format(p["id"])})
    counts = {h: sum(1 for p in todo if highlight_of(p) == h) for h in HIGHLIGHT_NAME}
    print(json.dumps({"market": args.market, "pending": counts, "returned": len(out), "items": out}, ensure_ascii=False, indent=1))


def cmd_highlight_record(args):
    st = load_json(STATE)
    pid = resolve_pid(args.property, st)
    p = st["properties"].get(pid) or {}
    prev = hl_current(args.market).get(pid, {})
    h = args.highlight or (highlight_of(p) if p else prev.get("highlight"))
    now = datetime.now(TZ)
    e = {"listing_number": p.get("listing_number") or prev.get("listing_number"), "property_id": pid, "market": args.market,
         "highlight": h, "status": args.status, "date": now.date().isoformat(), "timestamp": now.isoformat(timespec="seconds"),
         "note": args.note or ""}
    append_jsonl(HL_LOG, e); print(json.dumps(e, ensure_ascii=False))


def cmd_highlight_stale(args):
    """Listings still marked 'added' in a highlight that should come out (sold / inactive / no longer in state,
    moved to another market, or now in another highlight). Removal is manual on IG, then highlight-record --status removed."""
    st = load_json(STATE)
    out = []
    for pid, e in hl_current(args.market).items():
        if e.get("status") != "added":
            continue
        p = st["properties"].get(pid)
        why = None
        if not p or p.get("status") != "active": why = "not active any more (sold / rented / archived)"
        elif not in_market(p, args.market): why = f"city not in market {args.market}"
        elif highlight_of(p) != e.get("highlight"): why = f"now belongs in {highlight_of(p)}"
        if why:
            out.append({"listing_number": e.get("listing_number"), "property_id": pid, "highlight": e.get("highlight"),
                        "highlight_name": HIGHLIGHT_NAME.get(e.get("highlight")), "added": e.get("date"), "reason": why})
    print(json.dumps({"market": args.market, "remove_by_hand": out}, ensure_ascii=False, indent=1))


def cmd_market(args):
    if args.property:
        st = load_json(STATE)
        p = st["properties"][resolve_pid(args.property, st)]
        print(json.dumps({"listing_number": p["listing_number"], "city": p.get("city"), "market": market_of(p)}, ensure_ascii=False))
        return
    st = load_json(STATE) or {"properties": {}}
    cnt = {}
    for p in st["properties"].values():
        k = market_of(p) or "(none)"; cnt[k] = cnt.get(k, 0) + 1
    print(json.dumps({"cities_cached": len(market_map()), "active_by_market": cnt}, ensure_ascii=False, indent=1))


def cmd_market_cache(args):
    """Rebuild tools/market_cities.json from a raw MCP result of tools/market_query.sql."""
    raw = load_json(args.raw)
    if isinstance(raw, dict) and isinstance(raw.get("result"), str):
        raw = json.loads(re.search(r">\s*(\[.*\])\s*<", raw["result"], re.S).group(1))
    m = {r["city"]: r["market_slug"] for r in raw}
    old = load_json(MARKETS) or {}
    save_json(MARKETS, {"_doc": old.get("_doc", "city -> market_slug"), "generated_at": datetime.now(TZ).isoformat(timespec="seconds"),
                        "cities": m})
    print(json.dumps({"cities": len(m), "markets": len(set(m.values()))}))



# ---------------------------------------------------------------- Page feed variety (Tomer 2026-10-26)
# (1) site articles  (2) agency promo posts. Data = READ-ONLY snapshots (tools/article_query.sql -> queue/articles.json,
# tools/agency_query.sql -> queue/agencies_<market>.json). Logs: queue/article_posts.jsonl, queue/agency_posts.jsonl.
ARTICLES = os.path.join(QDIR, "articles.json")
ARTICLE_LOG = os.path.join(QDIR, "article_posts.jsonl")
AGENCY_LOG = os.path.join(QDIR, "agency_posts.jsonl")
ARTICLE_URL = "https://shuknadlan.co.il/article?slug={}"
AGENCY_GAP_DAYS = 14


def _rows(path, key):
    raw = load_json(path) or {}
    if isinstance(raw, dict) and isinstance(raw.get("result"), str):
        rows = json.loads(re.search(r">\s*(\[.*\])\s*<", raw["result"], re.S).group(1))
        return rows[0].get("json_agg") or []
    return raw.get(key, [])


def article_flags(a):
    t = " ".join(x for x in (a.get("title"), a.get("subtitle")) if x)
    fl = []
    if re.search(SUPER_DROP, t): fl.append("superlative_in_title")
    if re.search(YIELD, t): fl.append("investment_claim_in_title")
    return fl


def article_teaser(a, limit=220):
    """Subtitle if any, else the first clean sentences of the body (same sanitizer as listing copy: no superlatives,
    no yield/investment claims, no prices, no contact details)."""
    if (a.get("subtitle") or "").strip():
        return nodash(a["subtitle"].strip())
    return clean_description({"description": (a.get("teaser_src") or "").replace("\u200b", "")}, limit)


def article_caption(a, platform):
    url = ARTICLE_URL.format(urllib.parse.quote(a["slug"]))
    title = nodash((a.get("title") or "").replace("\u200b", "").strip())
    L = [f"📰 {title}", ""]
    t = article_teaser(a)
    if t: L += [t, ""]
    if platform == "fb":
        L += [f"🔗 לכתבה המלאה באתר שוק הנדל״ן: {url}", "", "#עפולה #נדלןעפולה #שוקהנדלן"]
    else:
        L += ["הכתבה המלאה באתר shuknadlan.co.il", "", "#עפולה #נדלןעפולה #נדלן #מדריךנדלן #שוקהנדלן"]
    return nodash("\n".join(L)).rstrip() + "\n"


def cmd_article_next(args):
    arts = [a for a in _rows(ARTICLES, "articles") if a.get("status") == "published"]
    done = {e["slug"] for e in jsonl(ARTICLE_LOG) if e.get("status") == "posted" and e.get("market", DEFAULT_MARKET) == args.market}
    out, flagged = [], []
    for a in sorted(arts, key=lambda a: a.get("published_at") or ""):          # oldest first: evergreen backlog
        if a["slug"] in done: continue
        fl = article_flags(a)
        if fl and not args.allow_flagged:
            flagged.append({"slug": a["slug"], "title": a["title"], "flags": fl}); continue
        if len(out) >= args.count: continue
        d = os.path.join(ROOT, "out", "articles"); os.makedirs(d, exist_ok=True)
        base = os.path.join(d, a["slug"][-6:])
        for plat in ("fb", "ig"):
            open(f"{base}_{plat}_caption.txt", "w", encoding="utf-8").write(article_caption(a, plat))
        out.append({"slug": a["slug"], "title": a["title"], "category": a.get("category"), "published_at": a.get("published_at"),
                    "url": ARTICLE_URL.format(urllib.parse.quote(a["slug"])), "image": a.get("cover_url"),
                    "teaser": article_teaser(a), "flags": fl, "fb_caption": base + "_fb_caption.txt",
                    "ig_caption": base + "_ig_caption.txt"})
    print(json.dumps({"market": args.market, "published": len(arts), "posted": len(done), "skipped_flagged": flagged,
                      "items": out}, ensure_ascii=False, indent=1))


def cmd_article_record(args):
    now = datetime.now(TZ)
    e = {"slug": args.slug, "market": args.market, "status": args.status, "date": now.date().isoformat(),
         "timestamp": now.isoformat(timespec="seconds"), "fb_url": args.fb_url or "", "ig_url": args.ig_url or "", "note": args.note or ""}
    append_jsonl(ARTICLE_LOG, e); print(json.dumps(e, ensure_ascii=False))


def cmd_agency_next(args):
    """Next agency promo post(s): agencies with active listings in the market (Tomer's own agency excluded for now),
    at most one post per agency per 14 days; never posted first (by rank from agency_query.sql), then oldest last post."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("fbagencycard", os.path.join(TOOLS, "agency_card.py"))
    AC = importlib.util.module_from_spec(spec); spec.loader.exec_module(AC)
    ags, excluded = AC.load_agencies(args.market)
    now = now_utc(args)
    last = {}
    for e in jsonl(AGENCY_LOG):
        if e.get("status") == "posted" and e.get("market", DEFAULT_MARKET) == args.market:
            t = parse_ts(e["timestamp"]); last[e["agency_id"]] = max(t, last.get(e["agency_id"], t))
    due = [a for a in ags if a["id"] not in last or now - last[a["id"]] >= timedelta(days=AGENCY_GAP_DAYS)]
    due.sort(key=lambda a: (a["id"] in last, last.get(a["id"], now), a.get("rank", 0), a["name"]))
    out = []
    for a in due[:args.count]:
        meta = AC.write(a, args.market, "post") if args.build else {}
        out.append({"agency": a["name"], "agency_id": a["id"], "slug": a["slug"],
                    "agency_url": a["url"], "last_posted": last[a["id"]].astimezone(TZ).isoformat() if a["id"] in last else None,
                    "image": meta.get("image"), "fb_caption": meta.get("fb_caption"), "ig_caption": meta.get("ig_caption")})
    print(json.dumps({"market": args.market, "qualifying": len(ags), "due": len(due), "excluded_for_now": excluded,
                      "gap_days": AGENCY_GAP_DAYS, "items": out}, ensure_ascii=False, indent=1))


def cmd_agency_record(args):
    now = datetime.now(TZ)
    e = {"agency_id": args.agency_id, "market": args.market, "status": args.status, "date": now.date().isoformat(),
         "timestamp": now.isoformat(timespec="seconds"), "fb_url": args.fb_url or "", "ig_url": args.ig_url or "", "note": args.note or ""}
    append_jsonl(AGENCY_LOG, e); print(json.dumps(e, ensure_ascii=False))



# ---------------------------------------------------------------- agency's own Facebook Page (Tomer 2026-10-27)
# Every active listing of Tomer or another agent of HIS agency (נדל"ן עפולה) also goes to the agency's business Page
# "נדל"ן עפולה Nadlan Afula" as a feed post (designed ad_image.jpg + group post text + agency brand line) and as a Page
# STORY (post_image.py story card); the agency's reels may be shared there too; plus the agency promo (agency_card.py
# --own-page, Tomer hidden) and site articles. Only that agency's listings, never other agencies'.
# Log: queue/agency_page_posts.jsonl, one line per attempt: {page, kind: listing|story|reel|promo|article, ...}.
AGENCY_PAGE_LOG = os.path.join(QDIR, "agency_page_posts.jsonl")
AGENCY_PAGES = {
    "נדלן-עפולה": {
        "agency_id": "01f2122b-4143-4660-a189-b4760d972ede", "agency_name": 'נדל"ן עפולה', "agency_slug": "נדלן-עפולה",
        "members": {TOMER_AGENT_ID: "תומר יצחק", "8e5da176-ad0b-4a16-883d-036b0bb5596d": "טל אטדגי"},   # 2026-10-27 snapshot
        "fb_page": 'נדל"ן עפולה  Nadlan Afula', "fb_page_id": "672704589434820", "fb_username": "Nadlan.Afula",
        "zernio_account": "6adb53c8ec2e042d4c68f95a",   # same FB connection as the shuknadlan Page; post with platformSpecificData.pageId
        "instagram": None,                              # Zernio: no IG professional account linked to this Page (2026-10-27)
        "market": "afula-emek"},
}
AGENCY_PAGE_ALIASES = {"01f2122b-4143-4660-a189-b4760d972ede": "נדלן-עפולה", 'נדל"ן עפולה': "נדלן-עפולה",
                       "nadlan-afula": "נדלן-עפולה", "Nadlan.Afula": "נדלן-עפולה"}
AGENCY_PAGE_GAP_DAYS = 14          # same listing again on the Page (feed post / story) only after 14 days
AGENCY_PAGE_CAPS = {"listing": 2, "story": 2, "reel": 1}   # per Asia/Jerusalem day
AGENCY_PAGE_PROMO_GAP = 14         # agency promo at most once per 14 days
AGENCY_PAGE_ARTICLE_GAP = 3        # at most one article every 3 days (~2 a week)


def agency_page_cfg(key):
    k = AGENCY_PAGE_ALIASES.get(key, key)
    if k not in AGENCY_PAGES:
        sys.exit(f"unknown agency page {key}; known: {list(AGENCY_PAGES)}")
    return k, AGENCY_PAGES[k]


def agency_of_page(p, cfg):
    """True only for a listing of this agency. The snapshot has no agency_id, so the agency NAME must match exactly
    (normalised); agent ids outside cfg['members'] are still accepted (new agents) but reported as unknown_agents."""
    return _norm(p.get("agency_name")) == _norm(cfg["agency_name"])


def agency_brand_line(cfg):
    slugs = set((load_json(os.path.join(QDIR, "site_agency_slugs.json")) or {}).get("slugs", []))
    if cfg["agency_slug"] in slugs:
        return f"🏠 כל הנכסים של {cfg['agency_name']} באתר שוק הנדל״ן: https://shuknadlan.co.il/agency?slug={urllib.parse.quote(cfg['agency_slug'])}"
    return f"🏠 כל הנכסים של {cfg['agency_name']} באתר שוק הנדל״ן | shuknadlan.co.il"


def agency_page_caption(p, st, cfg):
    """Group post text (post_text fb: listing link + Tomer's disclosure ONLY on his own listings, other agents show
    their own contact line) + one short שוק הנדל״ן brand line before the hashtags."""
    t = post_text(p, disclosure_for(p, st), "fb").rstrip("\n").split("\n")
    i = len(t) - 1 if t and t[-1].startswith("#") else len(t)
    t[i:i] = [agency_brand_line(cfg), ""]
    out = nodash("\n".join(t)).rstrip() + "\n"
    if not is_tomer(p):
        assert "3134355" not in out and "תומר יצחק" not in out, p["listing_number"]
    return out


def _ap_log(page):
    return [e for e in jsonl(AGENCY_PAGE_LOG) if e.get("page") == page]


def _ap_last(log, kind, key="property_id", status=("posted",)):
    last = {}
    for e in log:
        if e.get("kind") == kind and e.get("status") in status and e.get(key):
            t = parse_ts(e["timestamp"]); last[e[key]] = max(t, last.get(e[key], t))
    return last


def _ap_today(log, kind, today):
    return sum(1 for e in log if e.get("kind") == kind and e.get("status") == "posted" and e.get("date") == today.isoformat())


def agency_reels(st, cfg):
    """Reels that may also go to the agency Page: (a) published reels in queue/reels.jsonl of this agency's listings
    (FB/IG URLs from the entry, local video if still on disk), (b) the agents' own site videos (site_video_type agent:
    fetch-site-video), (c) rendered reel files on disk not yet published anywhere (listed, lower priority)."""
    seen, out = set(), []
    for e in reels_log():
        p = _reel_prop(e, st)
        if not p or not agency_of_page(p, cfg):
            continue
        rd = os.path.join(asset_dir(p), "reel")
        vids = sorted(glob.glob(os.path.join(rd, "reel_voice_male_*.mp4")), key=os.path.getmtime) if os.path.isdir(rd) else []
        if os.path.exists(os.path.join(rd, "site_video.mp4")): vids.append(os.path.join(rd, "site_video.mp4"))
        seen.add(p["id"])
        out.append({"listing_number": p["listing_number"], "property_id": p["id"], "source": "reels.jsonl",
                    "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "category": p.get("category"),
                    "active": p.get("status") == "active", "date": e.get("date"), "fb_reel_url": e.get("reel_url"),
                    "ig_url": e.get("ig_url"), "video": vids[-1] if vids else None, "fb_caption":
                    os.path.join(rd, "fb_caption.txt") if os.path.exists(os.path.join(rd, "fb_caption.txt")) else None})
    for p in sorted(st["properties"].values(), key=lambda p: p.get("listing_number") or 0):
        if p["id"] in seen or p.get("status") != "active" or not agency_of_page(p, cfg):
            continue
        rd = os.path.join(asset_dir(p), "reel")
        vids = sorted(glob.glob(os.path.join(rd, "reel_voice_male_*.mp4")), key=os.path.getmtime) if os.path.isdir(rd) else []
        if p.get("site_video_type") == "agent":
            out.append({"listing_number": p["listing_number"], "property_id": p["id"], "source": "agent_site_video",
                        "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "category": p.get("category"),
                        "active": True, "video_url": p.get("video_url"),
                        "video": os.path.join(rd, "site_video.mp4") if os.path.exists(os.path.join(rd, "site_video.mp4")) else None,
                        "fetch": f"python3 tools/queue.py fetch-site-video --property {p['listing_number']}"})
        elif vids and len(usable_photos(p)) >= MIN_REEL_PHOTOS:      # 1006/1036/1090-type near-empty renders are left out
            out.append({"listing_number": p["listing_number"], "property_id": p["id"], "source": "rendered_unpublished",
                        "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "category": p.get("category"),
                        "active": True, "video": vids[-1]})
    return out


def cmd_agency_reels(args):
    st = load_json(STATE)
    page, cfg = agency_page_cfg(args.agency)
    done = _ap_last(_ap_log(page), "reel")
    rs = agency_reels(st, cfg)
    for r in rs: r["on_agency_page"] = r["property_id"] in done
    print(json.dumps({"page": cfg["fb_page"], "agency": cfg["agency_name"], "reels": rs}, ensure_ascii=False, indent=1))


def _story_card(p, build):
    f = story_card_path(p)
    if build and not os.path.exists(f):
        subprocess.run([sys.executable, os.path.join(TOOLS, "post_image.py"), "story", str(p["listing_number"])],
                       check=False, stdout=subprocess.DEVNULL)
    return f if os.path.exists(f) else None


def cmd_agency_page_next(args):
    """Next items for the agency's own FB Page (read only, changes no log). Listing feed posts (cap 2/day), the same
    listings as Page stories (cap 2/day), optionally 1 reel/day, the agency promo (14-day gap) and an article (3-day gap)."""
    st = load_json(STATE)
    page, cfg = agency_page_cfg(args.agency)
    now = now_utc(args); today = now.astimezone(TZ).date()
    log = _ap_log(page)
    inc = {x.strip() for x in (args.include or "").split(",") if x.strip()}
    bad = inc - {"promo", "article", "story", "reel", "all"}
    if bad: sys.exit(f"--include: unknown {bad}")
    if "all" in inc: inc = {"promo", "article", "story", "reel"}
    last = _ap_last(log, "listing")
    used = _ap_today(log, "listing", today)
    room = max(0, min(args.count, AGENCY_PAGE_CAPS["listing"] - used))
    cands, no_image, blocked, unknown = [], [], 0, set()
    for p in st["properties"].values():
        if p.get("status") != "active" or not agency_of_page(p, cfg):
            continue
        if p.get("agent_id") and p["agent_id"] not in cfg["members"]: unknown.add((p["agent_id"], p.get("agent_name")))
        if p["id"] in last and now - last[p["id"]] < timedelta(days=AGENCY_PAGE_GAP_DAYS):
            blocked += 1; continue
        d = asset_dir(p)
        lazy = False
        if not ad_image_of(d):
            # never built and has usable photos: built lazily when picked (--build); else not on the Page
            if not (build_info(d) is None and usable_photos(p)):
                no_image.append(p["listing_number"]); continue
            lazy = True
        cands.append(p | {"_agent": agent_key(p), "_last": last.get(p["id"]), "_lazy": lazy})
    # never posted first, then oldest last post; then listing order
    cands.sort(key=lambda p: (p["_last"] is not None, p["_last"] or now, p.get("listing_number") or 0))
    posted = [e for e in log if e.get("kind") == "listing" and e.get("status") == "posted"]
    stats, prev = agent_stats_from(posted, lambda e: e.get("agent_id"), today)
    cats = [e.get("category") for e in posted]
    picks, used_ag, j = [], set(), -1
    while len(picks) < room:
        j += 1
        want = "commercial" if cats and cats[-1] == "residential" else "residential"
        pool = [p for p in cands if p.get("category") == want]; fb = False
        if not pool:
            pool = [p for p in cands if p.get("category") != want]; fb = True
        if not pool:
            break
        # keep the never-posted / oldest-first order inside pick_reel's agent rotation (it sorts by agent keys, stable)
        p, rep = pick_reel(pool, stats, prev, used_ag)
        cands.remove(p)
        if p["_lazy"]:
            if not args.build:
                p["_unbuilt"] = True
            else:
                build_assets(p, st)
                if not ad_image_of(asset_dir(p)):
                    no_image.append(p["listing_number"]); continue
        cats.append(p.get("category"))
        cap = None
        if args.build:
            cd = os.path.join(asset_dir(p), "agency_page"); os.makedirs(cd, exist_ok=True)
            cap = os.path.join(cd, f"{page}_fb_caption.txt")
            open(cap, "w", encoding="utf-8").write(agency_page_caption(p, st, cfg))
        picks.append({"kind": "listing", "listing_number": p["listing_number"], "property_id": p["id"],
                      "category": p.get("category"), "deal_type": p.get("deal_type"), "city": p.get("city"),
                      "agent_id": p.get("agent_id"), "agent_name": p.get("agent_name"), "tomer_branding": is_tomer(p),
                      "last_on_page": p["_last"].astimezone(TZ).isoformat() if p["_last"] else None,
                      "image": ad_image_of(asset_dir(p)), "attach": [x for x in [ad_image_of(asset_dir(p))] if x],
                      "fb_caption": cap, **({"needs_build": True} if p.get("_unbuilt") else {}),
                      "property_url": SITE.format(p["id"]),
                      **({"category_fallback": True} if fb else {}), **({"agent_repeat": True} if rep else {})})
        ag = p["_agent"]; prev = ag
        if ag:
            used_ag.add(ag); s_ = stats.setdefault(ag, {"n7": 0, "last": (-1, -1), "last_date": None})
            s_["n7"] += 1; s_["last"], s_["last_date"] = (today.toordinal(), 10 ** 6 + j), today.isoformat()
    res = {"page": cfg["fb_page"], "fb_page_id": cfg["fb_page_id"], "zernio_account": cfg["zernio_account"],
           "instagram": cfg["instagram"], "agency": cfg["agency_name"], "today_posted": used,
           "caps": AGENCY_PAGE_CAPS, "gap_days": AGENCY_PAGE_GAP_DAYS, "remaining_candidates": len(cands),
           "blocked_gap": blocked, "skipped_no_image": sorted(no_image),
           "unbuilt_candidates": sum(1 for p in cands if p["_lazy"]),
           **({"unknown_agents": sorted(map(list, unknown))} if unknown else {}), "posts": picks}
    if "story" in inc:
        s_last = _ap_last(log, "story")
        s_room = max(0, AGENCY_PAGE_CAPS["story"] - _ap_today(log, "story", today))
        items = []
        for it in picks:                                   # story = the same listings as today's feed posts
            if len(items) >= s_room: break
            if it["property_id"] in s_last and now - s_last[it["property_id"]] < timedelta(days=AGENCY_PAGE_GAP_DAYS):
                continue
            p = st["properties"][it["property_id"]]
            img = _story_card(p, args.build)
            if img:
                items.append({"kind": "story", "listing_number": p["listing_number"], "property_id": p["id"],
                              "image": img, "link_sticker": SITE.format(p["id"]),
                              "note": "Page story = image only (no caption); link sticker only when posted by hand"})
        res["stories"] = items
    if "reel" in inc:
        r_done = _ap_last(log, "reel")
        r_room = max(0, AGENCY_PAGE_CAPS["reel"] - _ap_today(log, "reel", today))
        rs = [r for r in agency_reels(st, cfg) if r["active"] and r["property_id"] not in r_done
              and (r.get("video") or r.get("video_url"))]
        order = {"reels.jsonl": 0, "agent_site_video": 1, "rendered_unpublished": 2}
        rs.sort(key=lambda r: (order[r["source"]], r.get("date") or "", r["listing_number"]))
        for r in rs[:r_room]:
            p = st["properties"][r["property_id"]]
            if args.build:
                write_reel_captions(p, st)
                r["fb_caption"] = os.path.join(asset_dir(p), "reel", "fb_caption.txt")
        res["reels"] = rs[:r_room]; res["reels_pending"] = len(rs)
    if "promo" in inc:
        pl = [parse_ts(e["timestamp"]) for e in log if e.get("kind") == "promo" and e.get("status") == "posted"]
        due = not pl or now - max(pl) >= timedelta(days=AGENCY_PAGE_PROMO_GAP)
        item = {"kind": "promo", "due": due, "last_posted": max(pl).astimezone(TZ).isoformat() if pl else None}
        if due and args.build:
            import importlib.util
            spec = importlib.util.spec_from_file_location("fbagencycard", os.path.join(TOOLS, "agency_card.py"))
            AC = importlib.util.module_from_spec(spec); spec.loader.exec_module(AC)
            ags, _ = AC.load_agencies(cfg["market"], own=cfg["agency_slug"])
            if ags:
                meta = AC.write(ags[0], cfg["market"], "post", subdir="agency-page")
                cap = open(meta["fb_caption"], encoding="utf-8").read()
                # v2 2026-10-27: Tomer's own agency promo shows its agents and MUST carry his name + licence
                assert ("3134355" in cap and "תומר יצחק" in cap) or "תומר" not in cap, "own-agency promo: Tomer shown without licence"
                item.update({"image": meta["image"], "fb_caption": meta["fb_caption"], "agents_shown": meta["agents_shown"]})
        res["promo"] = item
    if "article" in inc:
        al = [e for e in log if e.get("kind") == "article" and e.get("status") == "posted"]
        due = not al or now - max(parse_ts(e["timestamp"]) for e in al) >= timedelta(days=AGENCY_PAGE_ARTICLE_GAP)
        done = {e.get("slug") for e in al}
        item = {"kind": "article", "due": due}
        if due:
            for a in sorted([a for a in _rows(ARTICLES, "articles") if a.get("status") == "published"],
                            key=lambda a: a.get("published_at") or ""):
                if a["slug"] in done or (article_flags(a) and not args.allow_flagged):
                    continue
                d = os.path.join(ROOT, "out", "articles", "agency-page"); os.makedirs(d, exist_ok=True)
                f = os.path.join(d, f"{page}_{a['slug'][-6:]}_fb_caption.txt")
                cap = article_caption(a, "fb")
                assert "3134355" not in cap and "תומר" not in cap
                open(f, "w", encoding="utf-8").write(cap)
                item.update({"slug": a["slug"], "title": a["title"], "url": ARTICLE_URL.format(urllib.parse.quote(a["slug"])),
                             "image": a.get("cover_url"), "fb_caption": f}); break
        res["article"] = item
    print(json.dumps(res, ensure_ascii=False, indent=1))


def cmd_agency_page_record(args):
    page, cfg = agency_page_cfg(args.agency)
    now = datetime.now(TZ)
    e = {"page": page, "kind": args.kind, "status": args.status, "date": now.date().isoformat(),
         "timestamp": now.isoformat(timespec="seconds"), "url": args.url or "", "note": args.note or ""}
    if args.kind in ("listing", "story", "reel"):
        if not args.property: sys.exit("--property is required for listing/story/reel")
        st = load_json(STATE)
        pid = resolve_pid(args.property, st)
        p = st["properties"].get(pid) or {}
        if p and not agency_of_page(p, cfg):
            sys.exit(f"listing {args.property} is not a listing of {cfg['agency_name']}: refusing")
        if args.status == "posted" and not args.force:
            last = _ap_last(_ap_log(page), args.kind).get(pid)
            if last and now - last < timedelta(days=AGENCY_PAGE_GAP_DAYS) and args.kind != "reel":
                sys.exit(f"{args.kind} for this listing posted {last.isoformat()} (< {AGENCY_PAGE_GAP_DAYS} days); use --force")
            if last and args.kind == "reel":
                sys.exit("this reel is already on the agency Page; use --force")
        e.update({"listing_number": p.get("listing_number"), "property_id": pid, "category": p.get("category"),
                  "agent_id": p.get("agent_id")})
    elif args.kind == "article":
        if not args.slug: sys.exit("--slug is required for article")
        e["slug"] = args.slug
    append_jsonl(AGENCY_PAGE_LOG, e); print(json.dumps(e, ensure_ascii=False))


# ---------------------------------------------------------------- group "נדל"ן מסחרי בצפון" (Tomer 2026-10-27)
# Besides the commercial listings that `next` already sends there, the group may get commercial-topic site articles
# and app marketing / recruitment for agents (social-kit brokers material; real benefits only, no counts).
COMMERCIAL_GROUP = "401924747253597"
COMMERCIAL_GROUP_LOG = os.path.join(QDIR, "commercial_group_posts.jsonl")
COMMERCIAL_GROUP_WEEKLY = 3            # extra (non-listing) posts per 7 days, max 1 per day
RECRUIT_GAP_DAYS = 14                  # the recruitment post again only after 14 days
ARTICLE_COMMERCIAL_RE = r"מסחרי|משרד(?:ים)? להשכרה|חנו(?:ת|יות)|תעשי|לוגיסט|מחסנ|עסק(?:ים)? |נדל.?ן מניב|שטחי מסחר"
ARTICLE_AGENTS_RE = r"מתווכ|משרדי תיווך|CRM|A\.?I|בינה מלאכותית"
SOCIAL_KIT = "/workspace/social-kit"
RECRUIT_URL = ("https://shuknadlan.co.il/agency-signup?utm_source=facebook&utm_medium=social"
               "&utm_campaign=brokers_commercial-north&utm_content=group")


def commercial_article_kind(a):
    """'commercial' = commercial real-estate topic (title / subtitle / category), 'agents' = written for brokers
    (category בלוג המתווכים and a broker / AI / CRM topic in the title). None = not for the commercial group."""
    t = " ".join(x for x in (a.get("title"), a.get("subtitle"), a.get("category")) if x)
    if re.search(ARTICLE_COMMERCIAL_RE, t):
        return "commercial"
    if a.get("category") == "בלוג המתווכים" and re.search(ARTICLE_AGENTS_RE, " ".join(x for x in (a.get("title"), a.get("subtitle")) if x)):
        return "agents"
    return None


def group_article_caption(a):
    url = ARTICLE_URL.format(urllib.parse.quote(a["slug"]))
    title = nodash((a.get("title") or "").replace("\u200b", "").strip())
    L = [f"📰 {title}", ""]
    t = article_teaser(a)
    if t: L += [t, ""]
    L += [f"🔗 לכתבה המלאה באתר שוק הנדל״ן: {url}", "", "#נדלןמסחרי #מתווכים #שוקהנדלן"]
    return nodash("\n".join(L)).rstrip() + "\n"


def recruit_caption():
    """Agent recruitment / app marketing. Only benefits stated on /pricing and /agency-signup (social-kit evidence/,
    checked 2026-10-26); no counts; no personal names."""
    L = ["מתווכים ומשרדי תיווך בצפון 👋",
         "שוק הנדל״ן: מערכת לניהול, שיווק וסגירת עסקאות, כולל נכסים מסחריים.",
         "",
         "מה כלול בכל מסלול, גם בלי דמי מנוי:",
         "✔ פרסום נכסים ללא הגבלה + פרסום אוטומטי לפייסבוק ולאינסטגרם",
         "✔ CRM לנכסים, לידים, לקוחות ועמלות + מנטור AI שמכוון אתכם כל בוקר",
         "✔ שיתופי פעולה (Co-Broke) עם כל המתווכים בפלטפורמה",
         "✔ החתמה דיגיטלית ללא הגבלה מהנייד",
         "✔ מנוע התאמות: כל נכס חדש נבדק מול הלקוחות שלכם",
         "✔ הקפצה חינם לראש התוצאות כל 24 שעות, ודף משרד ודף סוכן/ת ממותגים",
         "",
         "🎁 תקופת השקה: 6 חודשי Elite ב-0 ₪, בלי כרטיס אשראי ובלי התחייבות.",
         "הצטרפות בשתי דקות 👇",
         RECRUIT_URL, "", "#נדלןמסחרי #מתווכים #שוקהנדלן"]
    out = nodash("\n".join(L)) + "\n"
    assert "3134355" not in out and "תומר" not in out
    return out


def recruit_images():
    d = os.path.join(SOCIAL_KIT, "out", "afula-emek", "brokers-highlight")
    fs = [os.path.join(d, f"broker-story-{i}-1080x1920.png") for i in (3, 7)]   # 'כלול בכל מסלול' + 'מצטרפים' (region-neutral)
    return [f for f in fs if os.path.exists(f)]


def cmd_commercial_group_next(args):
    """Next extra post(s) for the group נדל"ן מסחרי בצפון (read only): alternates article / recruitment, max 1 per day
    and 3 per 7 days; recruitment repeats after 14 days; each article once. Posted by the browser step as the Page."""
    now = now_utc(args); today = now.astimezone(TZ).date()
    log = [e for e in jsonl(COMMERCIAL_GROUP_LOG) if e.get("status") == "posted"]
    wk = [e for e in log if now - parse_ts(e["timestamp"]) < timedelta(days=7)]
    room = 0 if any(e.get("date") == today.isoformat() for e in log) else max(0, COMMERCIAL_GROUP_WEEKLY - len(wk))
    arts = [a for a in _rows(ARTICLES, "articles") if a.get("status") == "published"]
    done = {e.get("slug") for e in log if e.get("kind") == "article"}
    qual = [{"slug": a["slug"], "title": a["title"], "kind": commercial_article_kind(a), "flags": article_flags(a),
             "posted": a["slug"] in done} for a in arts if commercial_article_kind(a)]
    todo = [a for a in sorted(arts, key=lambda a: (commercial_article_kind(a) != "commercial", a.get("published_at") or ""))
            if commercial_article_kind(a) and a["slug"] not in done]
    todo = [a for a in todo if args.allow_flagged or not article_flags(a)]
    rl = [parse_ts(e["timestamp"]) for e in log if e.get("kind") == "recruit"]
    recruit_due = not rl or now - max(rl) >= timedelta(days=RECRUIT_GAP_DAYS)
    last_kind = log[-1].get("kind") if log else None
    d = os.path.join(ROOT, "out", "commercial_group"); os.makedirs(d, exist_ok=True)
    items = []
    for _ in range(min(room, args.count)):
        want = "article" if last_kind == "recruit" else "recruit"
        if want == "recruit" and not recruit_due: want = "article"
        if want == "article" and not todo: want = "recruit" if recruit_due else None
        if want is None: break
        if want == "recruit":
            f = os.path.join(d, "recruit_fb_caption.txt"); open(f, "w", encoding="utf-8").write(recruit_caption())
            items.append({"kind": "recruit", "attach": recruit_images(), "caption": f, "link": RECRUIT_URL}); recruit_due = False
        else:
            a = todo.pop(0)
            f = os.path.join(d, f"article_{a['slug'][-6:]}_fb_caption.txt"); open(f, "w", encoding="utf-8").write(group_article_caption(a))
            items.append({"kind": "article", "article_kind": commercial_article_kind(a), "slug": a["slug"], "title": a["title"],
                          "url": ARTICLE_URL.format(urllib.parse.quote(a["slug"])), "image": a.get("cover_url"), "caption": f})
        last_kind = want
    g = next((x for x in groups() if x["id"] == COMMERCIAL_GROUP), {})
    print(json.dumps({"group_id": COMMERCIAL_GROUP, "group_name": g.get("name"), "group_url": f"https://www.facebook.com/groups/{COMMERCIAL_GROUP}",
                      "posting_identity": "browser step, as the Page (Zernio cannot post to groups)",
                      "posted_last_7d": len(wk), "weekly_cap": COMMERCIAL_GROUP_WEEKLY, "qualifying_articles": qual,
                      "items": items}, ensure_ascii=False, indent=1))


def cmd_commercial_group_record(args):
    now = datetime.now(TZ)
    if args.kind == "article" and not args.slug: sys.exit("--slug is required for article")
    e = {"group_id": COMMERCIAL_GROUP, "kind": args.kind, "slug": args.slug or "", "status": args.status,
         "date": now.date().isoformat(), "timestamp": now.isoformat(timespec="seconds"), "url": args.url or "", "note": args.note or ""}
    append_jsonl(COMMERCIAL_GROUP_LOG, e); print(json.dumps(e, ensure_ascii=False))



def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("sync"); a.add_argument("--snapshot"); a.add_argument("--now")
    a = sp.add_parser("next"); a.add_argument("--limit", type=int, default=DAILY_CAP); a.add_argument("--build", action="store_true"); a.add_argument("--now")
    a.add_argument("--market", help="only listings of this market (default: no extra filter; groups.json markets always apply)")
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
    a.add_argument("--meta-v2", action="store_true", help="daily default reel (reel_voice_male_metav2.mp4 + cover_metav2.jpg)")
    a = sp.add_parser("reel-next"); a.add_argument("--count", type=int, default=1, help="simulate the next N picks (list)")
    a.add_argument("--now", help="ISO time for the 7-day agent window (default now)")
    a.add_argument("--market", default=DEFAULT_MARKET, help="market slug (default afula-emek; 'any' = no filter)")
    a = sp.add_parser("page-next"); a.add_argument("--count", type=int, default=PAGE_DAILY_CAP); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--build", action="store_true", help="build missing ad_image.jpg and write <no>/page captions"); a.add_argument("--now")
    a = sp.add_parser("page-record"); a.add_argument("--property", required=True); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--status", required=True, choices=["posted", "failed", "skipped"]); a.add_argument("--fb-url"); a.add_argument("--ig-url")
    a.add_argument("--note"); a.add_argument("--force", action="store_true")
    a = sp.add_parser("page-captions"); a.add_argument("--property", required=True)
    a = sp.add_parser("highlight-next"); a.add_argument("--count", type=int, default=10); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--highlight", choices=list(HIGHLIGHT_NAME)); a.add_argument("--build", action="store_true")
    a = sp.add_parser("highlight-record"); a.add_argument("--property", required=True); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--status", required=True, choices=["added", "removed", "failed"]); a.add_argument("--highlight", choices=list(HIGHLIGHT_NAME))
    a.add_argument("--note")
    a = sp.add_parser("highlight-stale"); a.add_argument("--market", default=DEFAULT_MARKET)
    a = sp.add_parser("article-next"); a.add_argument("--count", type=int, default=1); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--allow-flagged", action="store_true", help="include articles whose title has superlative / investment wording")
    a = sp.add_parser("article-record"); a.add_argument("--slug", required=True); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--status", required=True, choices=["posted", "failed", "skipped"]); a.add_argument("--fb-url"); a.add_argument("--ig-url"); a.add_argument("--note")
    a = sp.add_parser("agency-next"); a.add_argument("--count", type=int, default=1); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--build", action="store_true", help="render the 1080x1350 promo + captions (tools/agency_card.py)"); a.add_argument("--now")
    a = sp.add_parser("agency-record"); a.add_argument("--agency-id", required=True); a.add_argument("--market", default=DEFAULT_MARKET)
    a.add_argument("--status", required=True, choices=["posted", "failed", "skipped"]); a.add_argument("--fb-url"); a.add_argument("--ig-url"); a.add_argument("--note")
    a = sp.add_parser("agency-page-next", help="agency's own FB Page: listing posts (+ --include story,reel,promo,article)")
    a.add_argument("--agency", default="נדלן-עפולה", help="slug / id / name (default נדלן-עפולה)")
    a.add_argument("--count", type=int, default=AGENCY_PAGE_CAPS["listing"]); a.add_argument("--include", default="")
    a.add_argument("--build", action="store_true", help="build missing ad images / story cards / captions / promo")
    a.add_argument("--allow-flagged", action="store_true"); a.add_argument("--now")
    a = sp.add_parser("agency-page-record"); a.add_argument("--agency", default="נדלן-עפולה")
    a.add_argument("--kind", required=True, choices=["listing", "story", "reel", "promo", "article"])
    a.add_argument("--property"); a.add_argument("--slug")
    a.add_argument("--status", required=True, choices=["posted", "failed", "skipped"]); a.add_argument("--url"); a.add_argument("--note")
    a.add_argument("--force", action="store_true")
    a = sp.add_parser("agency-reels", help="reels (published / agent site videos / rendered) of the agency's listings")
    a.add_argument("--agency", default="נדלן-עפולה")
    a = sp.add_parser("commercial-group-next"); a.add_argument("--count", type=int, default=1)
    a.add_argument("--allow-flagged", action="store_true"); a.add_argument("--now")
    a = sp.add_parser("commercial-group-record"); a.add_argument("--kind", required=True, choices=["article", "recruit"])
    a.add_argument("--slug"); a.add_argument("--status", required=True, choices=["posted", "failed", "skipped"])
    a.add_argument("--url"); a.add_argument("--note")
    a = sp.add_parser("market"); a.add_argument("--property")
    a = sp.add_parser("market-cache"); a.add_argument("--raw", required=True)
    a = sp.add_parser("fetch-site-video"); a.add_argument("--property", required=True)
    a = sp.add_parser("price-flags")
    args = ap.parse_args()
    {"page-next": cmd_page_next, "page-record": cmd_page_record, "page-captions": cmd_page_captions,
     "highlight-next": cmd_highlight_next, "highlight-record": cmd_highlight_record, "highlight-stale": cmd_highlight_stale,
     "article-next": cmd_article_next, "article-record": cmd_article_record,
     "agency-next": cmd_agency_next, "agency-record": cmd_agency_record,
     "agency-page-next": cmd_agency_page_next, "agency-page-record": cmd_agency_page_record, "agency-reels": cmd_agency_reels,
     "commercial-group-next": cmd_commercial_group_next, "commercial-group-record": cmd_commercial_group_record,
     "market": cmd_market, "market-cache": cmd_market_cache,
     "reel-next": cmd_reel_next, "fetch-site-video": cmd_fetch_site_video,
     "sync": cmd_sync, "next": cmd_next, "build-assets": cmd_build, "record": cmd_record, "status": cmd_status,
     "build-stories": cmd_reel, "build-reel": cmd_reel, "build-captions": cmd_captions,
     "price-flags": cmd_price_flags}[args.cmd](args)


if __name__ == "__main__":
    main()
