#!/usr/bin/env python3
"""Find the Page / Instagram / WhatsApp identity to run ads from.

Read-only. Prints every Facebook Page the token can see, with its linked
Instagram business account and the Page's tasks, plus the Pages the ad
account is allowed to promote. Use the result to fill `identity` in a
campaign spec and META_PAGE_ID in .env.

Usage:
  python scripts/list_pages.py [--account-id act_123]
"""
from __future__ import annotations

import argparse
import sys

from meta_client import MetaAPIError, get_default_account, normalize_account_id, paginate, print_json

PAGE_FIELDS = "id,name,tasks,instagram_business_account{id,username},whatsapp_number,link"


def main():
    ap = argparse.ArgumentParser(description="List Pages + IG accounts usable for ads")
    ap.add_argument("--account-id", default=None)
    args = ap.parse_args()

    out: dict = {"ok": True}
    try:
        pages = list(paginate("me/accounts", {"fields": PAGE_FIELDS}))
        out["pages"] = [
            {
                "page_id": p["id"],
                "name": p.get("name"),
                "instagram_user_id": (p.get("instagram_business_account") or {}).get("id"),
                "instagram_username": (p.get("instagram_business_account") or {}).get("username"),
                "whatsapp_number": p.get("whatsapp_number"),
                "can_advertise": "ADVERTISE" in (p.get("tasks") or []),
                "can_create_content": "CREATE_CONTENT" in (p.get("tasks") or []),
            }
            for p in pages
        ]
    except MetaAPIError as e:
        out["pages_error"] = str(e)

    acct = args.account_id or get_default_account()
    if acct:
        try:
            acct = normalize_account_id(acct)
            promo = list(paginate(f"{acct}/promote_pages", {"fields": "id,name"}))
            out["promotable_by_" + acct] = promo
        except MetaAPIError as e:
            out["promote_pages_error"] = str(e)

    if not out.get("pages") and "pages_error" in out:
        out["ok"] = False
        print_json(out)
        sys.exit(1)
    print_json(out)


if __name__ == "__main__":
    main()
