#!/usr/bin/env python3
"""Create a complete Meta ad campaign from a spec JSON.

Builds the full object tree in one shot:
  campaign -> ad sets -> creatives + ads

Supported destinations (spec field `destination`):
  website    — click goes to `landing_url` (default)
  lead_form  — Instant Form inside Facebook/Instagram (needs `lead_form_id`,
               create one with create_lead_form.py)
  whatsapp   — Click-to-WhatsApp; opens a WhatsApp chat with the Page's
               connected business number

Supported ad formats (per ad, field `format`):
  image          — single image (default)
  carousel       — 2-10 cards, each with its own image + headline
  existing_post  — boost an existing Page post by its ID (website destination only)

Safety:
  - Refuses to write without either --dry-run or --confirm.
  - Defaults the campaign, ad sets and ads to PAUSED.
  - Every created object is written to a state file, *including on failure
    half-way*, so rollback_creation.py can clean up partial trees.
  - Optional `required_disclosure`: every ad's text must contain it (used for
    the Israeli broker-license disclosure — see references/real-estate-creative.md).

Usage:
  python scripts/create_campaign.py --spec spec.json --dry-run
  python scripts/create_campaign.py --spec spec.json --dry-run --offline   # no API calls
  python scripts/create_campaign.py --spec spec.json --confirm

See references/campaign-creation.md for the spec format.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
from pathlib import Path

from meta_client import (
    GRAPH_BASE,
    MetaAPIError,
    get,
    get_token,
    get_version,
    normalize_account_id,
    post,
    print_json,
)

# Currencies with no minor unit (Meta returns/accepts whole-unit amounts).
ZERO_DECIMAL = {"JPY", "KRW", "VND", "ISK", "TWD", "XAF", "XOF", "CLP"}

DEFAULT_PLACEMENTS = {
    "publisher_platforms": ["facebook", "instagram"],
    "instagram_positions": ["stream", "story", "reels"],
    "facebook_positions": ["feed", "story", "video_feeds"],
}
# Removed by Meta in v26.0 (2026-07-29). Requests that include it fail.
REMOVED_IG_POSITIONS = {"explore", "explore_home"}

VALID_CTAS = {
    "LEARN_MORE", "SIGN_UP", "SHOP_NOW", "BOOK_TRAVEL", "DOWNLOAD",
    "GET_OFFER", "GET_QUOTE", "SUBSCRIBE", "CONTACT_US", "APPLY_NOW",
    "WATCH_MORE", "INSTALL_MOBILE_APP", "USE_APP", "MESSAGE_PAGE",
    "WHATSAPP_MESSAGE", "NO_BUTTON", "CALL_NOW", "BOOK_NOW",
}
LEAD_FORM_CTAS = {"APPLY_NOW", "DOWNLOAD", "GET_QUOTE", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE"}

DESTINATIONS = {"website", "lead_form", "whatsapp"}
FORMATS = {"image", "carousel", "existing_post"}

LEAD_FORM_LINK = "https://fb.me/"
WHATSAPP_LINK = "https://api.whatsapp.com/send"

# Defaults per destination: (objective, optimization_goal, billing_event, default CTA)
DEST_DEFAULTS = {
    "website": ("OUTCOME_TRAFFIC", "LINK_CLICKS", "IMPRESSIONS", "LEARN_MORE"),
    "lead_form": ("OUTCOME_LEADS", "LEAD_GENERATION", "IMPRESSIONS", "LEARN_MORE"),
    "whatsapp": ("OUTCOME_ENGAGEMENT", "CONVERSATIONS", "IMPRESSIONS", "WHATSAPP_MESSAGE"),
}


# ─── Helpers ───────────────────────────────────────────────────────────────
def destination(spec: dict) -> str:
    return spec.get("destination", "website")


def objective(spec: dict) -> str:
    return spec.get("objective") or DEST_DEFAULTS[destination(spec)][0]


def get_account_currency(account_id: str) -> str:
    resp = get(account_id, {"fields": "currency"})
    return resp.get("currency", "USD")


def major_to_minor(amount_major: float, currency: str) -> int:
    """Convert 50.00 ILS → 5000 agorot. 1000 JPY → 1000."""
    if currency.upper() in ZERO_DECIMAL:
        return int(round(amount_major))
    return int(round(amount_major * 100))


def resolve_interest_ids(interest_names: list[str]) -> list[dict]:
    """Resolve interest names → {id, name} via /search?type=adinterest (top hit)."""
    out, seen, missing = [], set(), []
    for name in interest_names:
        resp = get("search", {"type": "adinterest", "q": name, "limit": 3})
        hits = resp.get("data", [])
        if not hits:
            missing.append(name)
            continue
        top = hits[0]
        tid = top.get("id")
        if tid and tid not in seen:
            out.append({"id": tid, "name": top.get("name")})
            seen.add(tid)
    if missing:
        print(f"[warn] No interest match for: {missing}", file=sys.stderr)
    return out


def resolve_path(p: str) -> Path:
    path = Path(p).expanduser()
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    return path


_UPLOADED: dict[str, str] = {}


def upload_image(account_id: str, image_path: Path) -> str:
    """POST image bytes to /act_.../adimages. Returns the hash. Cached per path."""
    key = str(image_path)
    if key in _UPLOADED:
        return _UPLOADED[key]
    import requests

    mime = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    url = f"{GRAPH_BASE}/{get_version()}/{account_id}/adimages"
    with image_path.open("rb") as f:
        files = {image_path.name: (image_path.name, f, mime)}
        resp = requests.post(url, data={"access_token": get_token()}, files=files, timeout=120)
    if not resp.ok:
        raise RuntimeError(f"Image upload failed ({resp.status_code}): {resp.text[:500]}")
    body = resp.json()
    info = body.get("images", {}).get(image_path.name)
    if not info or not info.get("hash"):
        raise RuntimeError(f"No hash in upload response: {body}")
    _UPLOADED[key] = info["hash"]
    return info["hash"]


def build_targeting(t: dict, resolved_interests: list[dict]) -> dict:
    out: dict = {}

    geo = t.get("geo_locations")
    if not geo and t.get("countries"):
        geo = {"countries": t["countries"]}
    if geo:
        out["geo_locations"] = geo

    if "age_min" in t:
        out["age_min"] = int(t["age_min"])
    if "age_max" in t:
        out["age_max"] = int(t["age_max"])
    if "genders" in t:
        out["genders"] = t["genders"]
    if "locales" in t:
        out["locales"] = t["locales"]

    if resolved_interests:
        out["flexible_spec"] = [
            {"interests": [{"id": i["id"], "name": i["name"]} for i in resolved_interests]}
        ]

    platforms = t.get("publisher_platforms", DEFAULT_PLACEMENTS["publisher_platforms"])
    out["publisher_platforms"] = platforms
    if "instagram" in platforms:
        out["instagram_positions"] = t.get(
            "instagram_positions", DEFAULT_PLACEMENTS["instagram_positions"]
        )
    if "facebook" in platforms:
        out["facebook_positions"] = t.get(
            "facebook_positions", DEFAULT_PLACEMENTS["facebook_positions"]
        )

    # v26 requires advantage_audience to be explicit for regulated categories;
    # we always send it explicitly (1 = let Meta expand, 0 = strict).
    out["targeting_automation"] = {"advantage_audience": 1 if t.get("advantage_audience", True) else 0}

    if "custom_audiences" in t:
        out["custom_audiences"] = t["custom_audiences"]
    if "excluded_custom_audiences" in t:
        out["excluded_custom_audiences"] = t["excluded_custom_audiences"]
    return out


def ad_texts(ad: dict) -> list[str]:
    """All user-visible copy of an ad, for disclosure checks."""
    texts = [ad.get("message", ""), ad.get("headline", ""), ad.get("description", "")]
    for c in ad.get("cards", []):
        texts += [c.get("headline", ""), c.get("description", "")]
    return texts


# ─── Validation ────────────────────────────────────────────────────────────
def validate_spec(spec: dict) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). No errors = valid."""
    errs: list[str] = []
    warns: list[str] = []
    dest = destination(spec)
    obj = objective(spec)

    if not spec.get("campaign_name"):
        errs.append("campaign_name is required")
    if dest not in DESTINATIONS:
        errs.append(f"destination must be one of {sorted(DESTINATIONS)}")
        return errs, warns
    if dest == "website" and not spec.get("landing_url"):
        # landing_url only needed if some ad isn't an existing_post
        if any(ad.get("format", "image") != "existing_post"
               for a in spec.get("ad_sets", []) for ad in a.get("ads", [])):
            errs.append("landing_url is required when destination is 'website'")
    if spec.get("landing_url") and not str(spec["landing_url"]).startswith("https://"):
        errs.append("landing_url must start with https://")
    if not spec.get("identity", {}).get("page_id"):
        errs.append("identity.page_id is required")
    if dest == "lead_form" and obj != "OUTCOME_LEADS":
        errs.append("destination 'lead_form' requires objective OUTCOME_LEADS")
    if dest == "whatsapp" and obj not in {"OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC"}:
        errs.append("destination 'whatsapp' requires objective ENGAGEMENT / LEADS / SALES / TRAFFIC")
    if not spec.get("ad_sets"):
        errs.append("at least one ad_set is required")

    cats = spec.get("special_ad_categories", [])
    if "HOUSING" in cats and not spec.get("special_ad_category_country"):
        errs.append("special_ad_categories HOUSING needs special_ad_category_country (e.g. [\"IL\"])")

    disclosure = (spec.get("required_disclosure") or "").strip()

    for i, a in enumerate(spec.get("ad_sets", [])):
        prefix = f"ad_sets[{i}]"
        if not a.get("name"):
            errs.append(f"{prefix}.name is required")
        if "daily_budget" not in a and "lifetime_budget" not in a:
            errs.append(f"{prefix} needs daily_budget or lifetime_budget (in major units)")
        if "lifetime_budget" in a and not a.get("end_time"):
            errs.append(f"{prefix}.lifetime_budget needs end_time (ISO 8601)")
        if dest == "lead_form" and not (a.get("lead_form_id") or spec.get("lead_form_id")):
            errs.append(f"{prefix}: lead_form_id is required (spec or ad set level)")
        if not a.get("ads"):
            errs.append(f"{prefix}.ads must have at least one ad")

        t = a.get("targeting", {})
        if not (t.get("countries") or t.get("geo_locations")):
            errs.append(f"{prefix}.targeting needs countries or geo_locations")
        bad_pos = REMOVED_IG_POSITIONS & set(t.get("instagram_positions", []))
        if bad_pos:
            errs.append(f"{prefix}.targeting.instagram_positions: {sorted(bad_pos)} removed by Meta in v26")
        if "HOUSING" in cats:
            if "genders" in t:
                errs.append(f"{prefix}: HOUSING ads cannot target by gender")
            if t.get("age_min", 18) != 18 or t.get("age_max", 65) != 65:
                errs.append(f"{prefix}: HOUSING ads must use ages 18-65+ (remove age_min/age_max)")
            if t.get("excluded_custom_audiences"):
                warns.append(f"{prefix}: exclusions are restricted for HOUSING ads")
        if "geo_locations" in t:
            for c in t["geo_locations"].get("custom_locations", []) + t["geo_locations"].get("cities", []):
                r = c.get("radius")
                if r is not None and c.get("distance_unit", "mile") == "kilometer" and r < 15 and "HOUSING" in cats:
                    errs.append(f"{prefix}: HOUSING radius must be ≥15 km")

        set_image = a.get("image_path") or a.get("image_hash")
        if a.get("image_path") and not resolve_path(a["image_path"]).exists():
            errs.append(f"{prefix}.image_path does not exist: {resolve_path(a['image_path'])}")

        for j, ad in enumerate(a.get("ads", [])):
            ap = f"{prefix}.ads[{j}]"
            fmt = ad.get("format", "image")
            if fmt not in FORMATS:
                errs.append(f"{ap}.format must be one of {sorted(FORMATS)}")
                continue
            if not ad.get("name"):
                errs.append(f"{ap}.name is required")

            if fmt == "existing_post":
                if not ad.get("post_id"):
                    errs.append(f"{ap}.post_id is required for existing_post (format: <pageid>_<postid>)")
                if dest != "website":
                    errs.append(f"{ap}: existing_post is only supported with destination 'website'")
                if disclosure:
                    warns.append(f"{ap}: can't verify required_disclosure inside an existing post — check it manually")
                continue

            if not ad.get("message"):
                errs.append(f"{ap}.message is required")

            if fmt == "image":
                if not ad.get("headline"):
                    errs.append(f"{ap}.headline is required")
                img = ad.get("image_path") or ad.get("image_hash") or set_image
                if not img:
                    errs.append(f"{ap} needs image_path / image_hash (on the ad or its ad set)")
                if ad.get("image_path") and not resolve_path(ad["image_path"]).exists():
                    errs.append(f"{ap}.image_path does not exist: {resolve_path(ad['image_path'])}")
                if len(ad.get("headline", "")) > 40:
                    warns.append(f"{ap}.headline is {len(ad['headline'])} chars — truncates on mobile above ~40")

            if fmt == "carousel":
                cards = ad.get("cards", [])
                if not 2 <= len(cards) <= 10:
                    errs.append(f"{ap}.cards must have 2-10 cards")
                for k, c in enumerate(cards):
                    cp = f"{ap}.cards[{k}]"
                    if not (c.get("image_path") or c.get("image_hash")):
                        errs.append(f"{cp} needs image_path or image_hash")
                    if c.get("image_path") and not resolve_path(c["image_path"]).exists():
                        errs.append(f"{cp}.image_path does not exist: {resolve_path(c['image_path'])}")
                    if not c.get("headline"):
                        errs.append(f"{cp}.headline is required")
                    if c.get("link") and dest != "website":
                        warns.append(f"{cp}.link ignored — destination is {dest}")
                    if len(c.get("headline", "")) > 32:
                        warns.append(f"{cp}.headline is {len(c['headline'])} chars — carousel cards truncate above ~32")

            default_cta = DEST_DEFAULTS[dest][3]
            cta = ad.get("cta", default_cta)
            if cta not in VALID_CTAS:
                errs.append(f"{ap}.cta '{cta}' is not a recognized CTA type")
            if dest == "lead_form" and cta not in LEAD_FORM_CTAS:
                errs.append(f"{ap}.cta '{cta}' not allowed with lead forms; use one of {sorted(LEAD_FORM_CTAS)}")
            if dest == "whatsapp" and cta != "WHATSAPP_MESSAGE":
                errs.append(f"{ap}.cta must be WHATSAPP_MESSAGE for whatsapp destination")

            if disclosure and not any(disclosure in t for t in ad_texts(ad)):
                errs.append(f"{ap}: required_disclosure '{disclosure}' is missing from the ad copy")

            if len(ad.get("message", "")) > 125 and "\n" not in ad["message"][:125]:
                warns.append(f"{ap}.message: only the first ~125 chars show before 'See more' — front-load the hook")

    return errs, warns


# ─── Creative building ─────────────────────────────────────────────────────
def cta_for(dest: str, cta_type: str, spec: dict, form_id: str | None, link: str | None) -> dict:
    if dest == "lead_form":
        return {"type": cta_type, "value": {"lead_gen_form_id": form_id}}
    if dest == "whatsapp":
        return {"type": "WHATSAPP_MESSAGE", "value": {"app_destination": "WHATSAPP"}}
    return {"type": cta_type, "value": {"link": link}}


def build_object_story_spec(
    spec: dict, ad: dict, form_id: str | None, hash_for, set_image: str | None
) -> dict:
    """Build object_story_spec for image / carousel ads. `hash_for(path_or_hash_dict)`
    returns an image hash (uploading if needed)."""
    dest = destination(spec)
    landing = spec.get("landing_url")
    link = {"website": landing, "lead_form": LEAD_FORM_LINK, "whatsapp": WHATSAPP_LINK}[dest]
    cta_type = ad.get("cta", DEST_DEFAULTS[dest][3])

    ld: dict = {"link": link, "message": ad["message"]}
    fmt = ad.get("format", "image")

    if fmt == "image":
        ld["name"] = ad["headline"]
        ld["image_hash"] = hash_for(ad) or set_image
        if ad.get("description"):
            ld["description"] = ad["description"]
        ld["call_to_action"] = cta_for(dest, cta_type, spec, form_id, link)
    else:  # carousel
        children = []
        for c in ad["cards"]:
            card_link = c.get("link", landing) if dest == "website" else link
            child = {
                "link": card_link,
                "name": c["headline"],
                "image_hash": hash_for(c),
                "call_to_action": cta_for(dest, cta_type, spec, form_id, card_link),
            }
            if c.get("description"):
                child["description"] = c["description"]
            children.append(child)
        ld["child_attachments"] = children
        ld["multi_share_optimized"] = bool(ad.get("let_meta_reorder_cards", False))
        ld["multi_share_end_card"] = bool(ad.get("end_card", False)) and dest == "website"
        ld["call_to_action"] = cta_for(dest, cta_type, spec, form_id, link)

    oss = {"page_id": spec["identity"]["page_id"], "link_data": ld}
    if spec["identity"].get("instagram_user_id"):
        oss["instagram_user_id"] = spec["identity"]["instagram_user_id"]
    return oss


def adset_payload(spec: dict, a: dict, campaign_id: str, targeting: dict, currency: str, start_time: str) -> dict:
    dest = destination(spec)
    _, opt_default, bill_default, _ = DEST_DEFAULTS[dest]
    data = {
        "name": a["name"],
        "campaign_id": campaign_id,
        "billing_event": a.get("billing_event", bill_default),
        "optimization_goal": a.get("optimization_goal", opt_default),
        "bid_strategy": a.get("bid_strategy", "LOWEST_COST_WITHOUT_CAP"),
        "targeting": json.dumps(targeting, ensure_ascii=False),
        "status": a.get("status", "PAUSED"),
        "start_time": start_time,
    }
    page_id = spec["identity"]["page_id"]
    if dest == "lead_form":
        data["destination_type"] = "ON_AD"
        data["promoted_object"] = json.dumps({"page_id": page_id})
    elif dest == "whatsapp":
        data["destination_type"] = "WHATSAPP"
        po = {"page_id": page_id}
        if spec["identity"].get("whatsapp_phone_number"):
            po["whatsapp_phone_number"] = spec["identity"]["whatsapp_phone_number"]
        data["promoted_object"] = json.dumps(po)
    if "daily_budget" in a:
        data["daily_budget"] = str(major_to_minor(a["daily_budget"], currency))
    if "lifetime_budget" in a:
        data["lifetime_budget"] = str(major_to_minor(a["lifetime_budget"], currency))
        data["end_time"] = a["end_time"]
    if "bid_amount" in a:
        data["bid_amount"] = str(major_to_minor(a["bid_amount"], currency))
    return data


def campaign_payload(spec: dict) -> dict:
    data = {
        "name": spec["campaign_name"],
        "objective": objective(spec),
        "status": spec.get("status", "PAUSED"),
        "special_ad_categories": json.dumps(spec.get("special_ad_categories", [])),
        "buying_type": spec.get("buying_type", "AUCTION"),
    }
    if spec.get("special_ad_category_country"):
        data["special_ad_category_country"] = json.dumps(spec["special_ad_category_country"])
    return data


# ─── Planning (dry-run) ────────────────────────────────────────────────────
def plan(spec: dict, account_id: str, offline: bool = False) -> dict:
    currency = spec.get("currency", "ILS") if offline else get_account_currency(account_id)
    dest = destination(spec)
    out = {
        "account_id": account_id,
        "currency": currency,
        "offline": offline,
        "campaign": {k: v for k, v in campaign_payload(spec).items()},
        "destination": dest,
        "identity": spec["identity"],
        "landing_url": spec.get("landing_url"),
        "required_disclosure": spec.get("required_disclosure"),
        "ad_sets": [],
    }
    out["campaign"]["special_ad_categories"] = spec.get("special_ad_categories", [])
    total_daily_minor = 0
    total_ads = 0
    images: set[str] = set()

    for a in spec["ad_sets"]:
        t = a.get("targeting", {})
        if t.get("interest_ids"):
            interests = [{"id": i, "name": f"<preset:{i}>"} for i in t["interest_ids"]]
        elif t.get("interests"):
            interests = (
                [{"id": "<resolved at confirm>", "name": n} for n in t["interests"]]
                if offline else resolve_interest_ids(t["interests"])
            )
        else:
            interests = []
        targeting = build_targeting(t, interests)

        daily_minor = None
        if "daily_budget" in a:
            daily_minor = major_to_minor(a["daily_budget"], currency)
            total_daily_minor += daily_minor

        payload = adset_payload(spec, a, "<new campaign>", targeting, currency, "<now+1h>")
        payload["targeting"] = targeting
        if "promoted_object" in payload:
            payload["promoted_object"] = json.loads(payload["promoted_object"])

        ads_plan = []
        for ad in a["ads"]:
            fmt = ad.get("format", "image")
            entry = {"name": ad["name"], "format": fmt}
            if fmt == "existing_post":
                entry["post_id"] = ad["post_id"]
            else:
                entry["cta"] = ad.get("cta", DEST_DEFAULTS[dest][3])
                entry["message"] = ad["message"]
                if fmt == "image":
                    entry["headline"] = ad["headline"]
                    entry["image"] = ad.get("image_path") or ad.get("image_hash") or a.get("image_path") or a.get("image_hash")
                    images.add(str(entry["image"]))
                else:
                    entry["cards"] = [
                        {"headline": c["headline"], "image": c.get("image_path") or c.get("image_hash"),
                         "link": c.get("link", spec.get("landing_url")) if dest == "website" else None}
                        for c in ad["cards"]
                    ]
                    images.update(str(c["image"]) for c in entry["cards"])
            ads_plan.append(entry)
        total_ads += len(ads_plan)

        out["ad_sets"].append({
            "name": a["name"],
            "daily_budget_major": a.get("daily_budget"),
            "lifetime_budget_major": a.get("lifetime_budget"),
            "lead_form_id": (a.get("lead_form_id") or spec.get("lead_form_id")) if dest == "lead_form" else None,
            "adset_payload": payload,
            "ads": ads_plan,
        })

    out["totals"] = {
        "ad_sets": len(spec["ad_sets"]),
        "ads": total_ads,
        "images_to_upload": len(images),
        "objects_to_create": 1 + len(spec["ad_sets"]) + 2 * total_ads,
        "total_daily_budget_major": total_daily_minor / (1 if currency.upper() in ZERO_DECIMAL else 100),
    }
    return out


# ─── Execution (write) ─────────────────────────────────────────────────────
def execute(spec: dict, account_id: str, state: dict) -> dict:
    """Create everything. Mutates `state` as it goes so a crash leaves a usable record."""
    currency = get_account_currency(account_id)
    state["currency"] = currency
    dest = destination(spec)

    camp = post(f"{account_id}/campaigns", data=campaign_payload(spec))
    campaign_id = camp["id"]
    state["campaign_id"] = campaign_id
    state["objects"].append({"type": "campaign", "id": campaign_id, "name": spec["campaign_name"]})
    print(f"[+] campaign: {campaign_id} — {spec['campaign_name']}", file=sys.stderr)

    def hash_for(obj: dict) -> str | None:
        if obj.get("image_hash"):
            return obj["image_hash"]
        if obj.get("image_path"):
            p = resolve_path(obj["image_path"])
            already = str(p) in _UPLOADED
            h = upload_image(account_id, p)
            if not already:
                state["objects"].append({"type": "image", "hash": h, "file": p.name})
                print(f"[+] image: {p.name} -> {h[:16]}…", file=sys.stderr)
            return h
        return None

    start_time = str(int(time.time()) + 3600)
    out_ad_sets = []
    for a in spec["ad_sets"]:
        t = a.get("targeting", {})
        if t.get("interest_ids"):
            interests = [{"id": i, "name": f"preset-{i}"} for i in t["interest_ids"]]
        elif t.get("interests"):
            interests = resolve_interest_ids(t["interests"])
        else:
            interests = []
        targeting = build_targeting(t, interests)

        set_image = hash_for(a)
        form_id = a.get("lead_form_id") or spec.get("lead_form_id")

        adset = post(f"{account_id}/adsets", data=adset_payload(spec, a, campaign_id, targeting, currency, start_time))
        adset_id = adset["id"]
        state["objects"].append({"type": "adset", "id": adset_id, "name": a["name"]})
        print(f"[+] ad set: {adset_id} — {a['name']}", file=sys.stderr)

        ads_created = []
        for ad_cfg in a["ads"]:
            fmt = ad_cfg.get("format", "image")
            if fmt == "existing_post":
                creative_payload = {
                    "name": f"Creative_{ad_cfg['name']}",
                    "object_story_id": ad_cfg["post_id"],
                }
            else:
                oss = build_object_story_spec(spec, ad_cfg, form_id, hash_for, set_image)
                creative_payload = {
                    "name": f"Creative_{ad_cfg['name']}",
                    "object_story_spec": json.dumps(oss, ensure_ascii=False),
                }
            if not ad_cfg.get("standard_enhancements", False):
                creative_payload["degrees_of_freedom_spec"] = json.dumps(
                    {"creative_features_spec": {"standard_enhancements": {"enroll_status": "OPT_OUT"}}}
                )
            creative = post(f"{account_id}/adcreatives", data=creative_payload)
            creative_id = creative["id"]
            state["objects"].append({"type": "creative", "id": creative_id, "name": creative_payload["name"]})

            ad = post(
                f"{account_id}/ads",
                data={
                    "name": f"Ad_{ad_cfg['name']}",
                    "adset_id": adset_id,
                    "creative": json.dumps({"creative_id": creative_id}),
                    "status": ad_cfg.get("status", "PAUSED"),
                },
            )
            ad_id = ad["id"]
            state["objects"].append({"type": "ad", "id": ad_id, "name": f"Ad_{ad_cfg['name']}"})
            ads_created.append({"ad_id": ad_id, "creative_id": creative_id, "name": ad_cfg["name"], "format": fmt})
            print(f"[+] ad: {ad_id} — {ad_cfg['name']}", file=sys.stderr)

        out_ad_sets.append({"adset_id": adset_id, "ads": ads_created})
        state["ad_sets"] = out_ad_sets

    state["ad_sets"] = out_ad_sets
    return state


# ─── Entry point ───────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Create a Meta ad campaign from a spec JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--spec", required=True, help="Path to campaign spec JSON")
    grp = parser.add_mutually_exclusive_group(required=True)
    grp.add_argument("--dry-run", action="store_true", help="Plan only, no writes")
    grp.add_argument("--confirm", action="store_true", help="Actually create everything")
    parser.add_argument("--offline", action="store_true",
                        help="With --dry-run: validate and plan without any API call (assumes spec.currency or ILS)")
    parser.add_argument("--account-id", default=None, help="Override META_AD_ACCOUNT_ID")
    parser.add_argument("--state-out", default=None,
                        help="Where to write the state JSON (default: alongside spec with _state suffix)")
    args = parser.parse_args()

    spec_path = Path(args.spec).expanduser().resolve()
    if not spec_path.exists():
        print(f"spec not found: {spec_path}", file=sys.stderr)
        sys.exit(2)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))

    errs, warns = validate_spec(spec)
    for w in warns:
        print(f"[warn] {w}", file=sys.stderr)
    if errs:
        print_json({"ok": False, "validation_errors": errs, "warnings": warns})
        sys.exit(2)

    if args.dry_run:
        account_id = args.account_id or "act_<offline>" if args.offline else normalize_account_id(args.account_id)
        try:
            p = plan(spec, account_id, offline=args.offline)
        except MetaAPIError as e:
            print_json({"ok": False, "error": str(e), "body": e.body})
            sys.exit(1)
        p["warnings"] = warns
        print_json(p)
        return

    account_id = normalize_account_id(args.account_id)
    state_file = Path(args.state_out) if args.state_out else spec_path.with_name(
        f"{spec_path.stem}_state_{int(time.time())}.json"
    )
    state: dict = {"ok": True, "account_id": account_id, "created_at": int(time.time()), "objects": []}
    try:
        execute(spec, account_id, state)
    except Exception as e:
        state["ok"] = False
        state["error"] = f"{type(e).__name__}: {e}"
        if isinstance(e, MetaAPIError):
            state["error_body"] = e.body
        state["rollback_hint"] = (
            f"Partial tree created ({len(state['objects'])} objects). "
            f"python scripts/rollback_creation.py --state {state_file} --pause"
        )
        state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        print_json(state)
        sys.exit(1)
    state_file.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[state] -> {state_file}", file=sys.stderr)
    print_json(state)


if __name__ == "__main__":
    main()
