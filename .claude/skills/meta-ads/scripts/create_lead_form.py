#!/usr/bin/env python3
"""Create (or list) Instant Forms — Meta lead-ad forms — on a Facebook Page.

Lead forms live on the Page, not the ad account, so these calls use a Page
access token (derived automatically from META_ACCESS_TOKEN; see
meta_client.get_page_token).

A form can't be edited after creation (Meta locks it once it exists). To
change questions, create a new form and point new ads at it, then archive
the old one with --archive.

Usage:
  python scripts/create_lead_form.py --list [--page-id 123]
  python scripts/create_lead_form.py --spec form.json --dry-run
  python scripts/create_lead_form.py --spec form.json --confirm
  python scripts/create_lead_form.py --archive <FORM_ID> --confirm

Spec format (see assets/example-lead-form.json):
{
  "page_id": "1234567890",              # optional if META_PAGE_ID is set
  "name": "קונים - עפולה - אוק 2026",   # internal name, not shown to users
  "locale": "he_IL",
  "higher_intent": true,                 # adds a review step before submit → fewer, better leads
  "headline": "מחפשים דירה בעפולה?",      # question page headline (optional)
  "questions": [
    {"type": "FULL_NAME"},
    {"type": "PHONE"},
    {"type": "CUSTOM", "key": "budget", "label": "מה התקציב?",
     "options": ["עד 1.2 מיליון", "1.2-1.6 מיליון", "מעל 1.6 מיליון"]},
    {"type": "CUSTOM", "key": "rooms", "label": "כמה חדרים?"}
  ],
  "privacy_policy": {"url": "https://example.co.il/privacy", "link_text": "מדיניות פרטיות"},
  "thank_you": {
    "title": "תודה! נחזור אליך היום",
    "body": "בינתיים אפשר לראות את כל הנכסים באתר",
    "button_text": "לנכסים באתר",
    "website_url": "https://example.co.il"
  }
}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from meta_client import (
    MetaAPIError,
    get_default_page,
    get_page_token,
    paginate,
    post,
    print_json,
)

STANDARD_TYPES = {
    "FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE", "CITY",
    "STREET_ADDRESS", "ZIP", "STATE", "COUNTRY", "JOB_TITLE", "COMPANY_NAME",
    "DATE_OF_BIRTH", "GENDER", "MARITIAL_STATUS",
}
# Asking these on a housing-related form invites discrimination complaints
# and Meta rejection. Block them outright.
DISALLOWED_FOR_HOUSING = {"DATE_OF_BIRTH", "GENDER", "MARITIAL_STATUS"}


def page_id_from(spec: dict | None, cli: str | None) -> str:
    pid = cli or (spec or {}).get("page_id") or get_default_page()
    if not pid:
        raise SystemExit("No page id: pass --page-id, set page_id in the spec, or META_PAGE_ID in .env")
    return str(pid)


def validate(spec: dict) -> list[str]:
    errs = []
    if not spec.get("name"):
        errs.append("name is required")
    qs = spec.get("questions", [])
    if not qs:
        errs.append("questions must have at least one entry")
    has_contact = any(q.get("type") in {"PHONE", "EMAIL"} for q in qs)
    if not has_contact:
        errs.append("include PHONE or EMAIL — a lead you can't contact is useless")
    keys = set()
    for i, q in enumerate(qs):
        t = q.get("type")
        if t == "CUSTOM":
            if not q.get("label"):
                errs.append(f"questions[{i}]: CUSTOM needs a label")
            k = q.get("key")
            if not k:
                errs.append(f"questions[{i}]: CUSTOM needs a stable key (latin, e.g. 'budget')")
            elif k in keys:
                errs.append(f"questions[{i}]: duplicate key '{k}'")
            keys.add(k)
            opts = q.get("options")
            if opts is not None and not (2 <= len(opts) <= 25):
                errs.append(f"questions[{i}]: options must have 2-25 items")
        elif t not in STANDARD_TYPES:
            errs.append(f"questions[{i}]: unknown type '{t}'")
        if t in DISALLOWED_FOR_HOUSING:
            errs.append(f"questions[{i}]: '{t}' is not allowed on real-estate forms (discrimination risk)")
    if len(qs) > 6:
        errs.append("more than 6 questions — completion rate collapses; keep it to 3-5")
    pp = spec.get("privacy_policy", {})
    if not pp.get("url", "").startswith("https://"):
        errs.append("privacy_policy.url (https) is required by Meta for every lead form")
    ty = spec.get("thank_you")
    if ty and ty.get("website_url") and not ty["website_url"].startswith("https://"):
        errs.append("thank_you.website_url must be https://")
    return errs


def build_payload(spec: dict) -> dict:
    questions = []
    for q in spec["questions"]:
        if q["type"] == "CUSTOM":
            item = {"type": "CUSTOM", "key": q["key"], "label": q["label"]}
            if q.get("options"):
                item["options"] = [
                    {"key": f"{q['key']}_{n}", "value": v} for n, v in enumerate(q["options"], 1)
                ]
            questions.append(item)
        else:
            questions.append({"type": q["type"]})

    payload = {
        "name": spec["name"],
        "locale": spec.get("locale", "he_IL"),
        "questions": json.dumps(questions, ensure_ascii=False),
        "privacy_policy": json.dumps(
            {"url": spec["privacy_policy"]["url"],
             "link_text": spec["privacy_policy"].get("link_text", "מדיניות פרטיות")},
            ensure_ascii=False,
        ),
        "block_display_for_non_targeted_viewer": "true",
    }
    if spec.get("higher_intent"):
        payload["is_optimized_for_quality"] = "true"
    if spec.get("headline"):
        payload["question_page_custom_headline"] = spec["headline"]
    ty = spec.get("thank_you")
    if ty:
        tp = {
            "title": ty.get("title", "תודה!"),
            "body": ty.get("body", "נחזור אליך בהקדם"),
            "button_type": "VIEW_WEBSITE" if ty.get("website_url") else "NONE",
        }
        if ty.get("website_url"):
            tp["button_text"] = ty.get("button_text", "לאתר")
            tp["website_url"] = ty["website_url"]
        payload["thank_you_page"] = json.dumps(tp, ensure_ascii=False)
        if ty.get("website_url"):
            payload["follow_up_action_url"] = ty["website_url"]
    return payload


def main():
    ap = argparse.ArgumentParser(description="Create / list / archive Meta Instant Forms")
    ap.add_argument("--page-id", default=None)
    ap.add_argument("--spec")
    ap.add_argument("--list", action="store_true", help="List forms on the Page")
    ap.add_argument("--archive", metavar="FORM_ID", help="Archive a form (needs --confirm)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--confirm", action="store_true")
    args = ap.parse_args()

    try:
        if args.list:
            pid = page_id_from(None, args.page_id)
            tok = get_page_token(pid)
            forms = list(paginate(f"{pid}/leadgen_forms",
                                  {"fields": "id,name,status,locale,leads_count,created_time"}, token=tok))
            print_json({"ok": True, "page_id": pid, "count": len(forms), "forms": forms})
            return

        if args.archive:
            if not args.confirm:
                print_json({"ok": True, "dry_run": True, "would_archive": args.archive})
                return
            # archive is done on the form node; we need a page token for the owning page
            pid = page_id_from(None, args.page_id)
            res = post(args.archive, {"status": "ARCHIVED"}, token=get_page_token(pid))
            print_json({"ok": True, "archived": args.archive, "result": res})
            return

        if not args.spec:
            ap.error("--spec, --list or --archive is required")
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        errs = validate(spec)
        if errs:
            print_json({"ok": False, "validation_errors": errs})
            sys.exit(2)
        payload = build_payload(spec)

        if args.dry_run or not args.confirm:
            readable = {k: (json.loads(v) if k in {"questions", "privacy_policy", "thank_you_page"} else v)
                        for k, v in payload.items()}
            print_json({"ok": True, "dry_run": True, "page_id": spec.get("page_id") or args.page_id or "<META_PAGE_ID>",
                        "payload": readable,
                        "note": "Forms can't be edited after creation. Review every label now."})
            return

        pid = page_id_from(spec, args.page_id)
        res = post(f"{pid}/leadgen_forms", payload, token=get_page_token(pid))
        print_json({"ok": True, "page_id": pid, "form_id": res.get("id"),
                    "next": "Put this form_id in your campaign spec as lead_form_id."})
    except MetaAPIError as e:
        print_json({"ok": False, "error": str(e), "body": e.body})
        sys.exit(1)
    except RuntimeError as e:
        print_json({"ok": False, "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
