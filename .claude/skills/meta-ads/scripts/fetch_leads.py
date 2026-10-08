#!/usr/bin/env python3
"""Download leads from Meta Instant Forms.

Read-only. Uses a Page access token (derived from META_ACCESS_TOKEN) and
needs the `leads_retrieval` permission. Leads older than 90 days are
deleted by Meta — export regularly.

Usage:
  python scripts/fetch_leads.py --form-id 123                 # one form
  python scripts/fetch_leads.py --all-forms                   # every form on the Page
  python scripts/fetch_leads.py --ad-id 456                   # leads from one ad
  python scripts/fetch_leads.py --all-forms --since 2026-10-01 --csv leads.csv

The CSV is UTF-8 with BOM so Hebrew opens correctly in Excel.
Phone numbers are normalised to 05X-XXXXXXX when they look Israeli.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from meta_client import MetaAPIError, get_default_page, get_page_token, paginate, print_json

LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,field_data,platform,is_organic"


def normalise_il_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("972"):
        digits = "0" + digits[3:]
    if len(digits) == 10 and digits.startswith("05"):
        return f"{digits[:3]}-{digits[3:]}"
    return raw


def flatten(lead: dict) -> dict:
    row = {
        "lead_id": lead.get("id"),
        "created_time": lead.get("created_time"),
        "campaign": lead.get("campaign_name"),
        "ad_set": lead.get("adset_name"),
        "ad": lead.get("ad_name"),
        "platform": lead.get("platform"),
        "organic": lead.get("is_organic"),
        "form_id": lead.get("form_id"),
    }
    for f in lead.get("field_data", []):
        val = ", ".join(f.get("values", []))
        name = f.get("name")
        if name in ("phone_number", "phone"):
            val = normalise_il_phone(val)
        row[name] = val
    return row


def since_filter(since: str | None) -> dict:
    if not since:
        return {}
    ts = int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp())
    return {"filtering": f'[{{"field":"time_created","operator":"GREATER_THAN","value":{ts}}}]'}


def main():
    ap = argparse.ArgumentParser(description="Fetch leads from Meta Instant Forms")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--form-id")
    src.add_argument("--ad-id")
    src.add_argument("--all-forms", action="store_true")
    ap.add_argument("--page-id", default=None, help="Defaults to META_PAGE_ID")
    ap.add_argument("--since", help="YYYY-MM-DD (UTC) — only leads after this date")
    ap.add_argument("--csv", help="Also write a CSV to this path")
    args = ap.parse_args()

    page_id = args.page_id or get_default_page()
    if not page_id:
        print_json({"ok": False, "error": "Need --page-id or META_PAGE_ID (leads need a Page token)"})
        sys.exit(2)

    try:
        tok = get_page_token(page_id)
        params = {"fields": LEAD_FIELDS, **since_filter(args.since)}
        if args.form_id:
            sources = [args.form_id]
        elif args.ad_id:
            sources = [args.ad_id]
        else:
            sources = [f["id"] for f in paginate(f"{page_id}/leadgen_forms", {"fields": "id"}, token=tok)]

        leads = []
        for sid in sources:
            leads.extend(paginate(f"{sid}/leads", params, token=tok))
    except MetaAPIError as e:
        print_json({"ok": False, "error": str(e), "body": e.body,
                    "hint": "code 200/10 usually = missing leads_retrieval permission or no Page role; see references/setup.md"})
        sys.exit(1)
    except RuntimeError as e:
        print_json({"ok": False, "error": str(e)})
        sys.exit(1)

    rows = sorted((flatten(l) for l in leads), key=lambda r: r.get("created_time") or "", reverse=True)

    if args.csv:
        cols: list[str] = []
        for r in rows:
            for k in r:
                if k not in cols:
                    cols.append(k)
        with Path(args.csv).open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        print(f"[csv] {len(rows)} leads -> {args.csv}", file=sys.stderr)

    out = {"ok": True, "page_id": page_id, "sources": sources, "count": len(rows)}
    if args.csv:
        # Leads are personal data: when they're saved to a file, keep stdout to a summary.
        out["csv"] = args.csv
        out["sample"] = rows[:3]
    else:
        out["leads"] = rows
    print_json(out)


if __name__ == "__main__":
    main()
