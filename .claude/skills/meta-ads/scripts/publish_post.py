#!/usr/bin/env python3
"""Publish (or schedule) an organic post on the Facebook Page.

Useful for property posts you later boost: publish here, then reference
the returned post_id in a campaign spec with `"format": "existing_post"`.

Writes are public and immediate (unless scheduled). Same rules as every
other write in this skill: --dry-run first, explicit --confirm.

Needs a Page token with pages_manage_posts + pages_read_engagement
(derived automatically from META_ACCESS_TOKEN).

Usage:
  python scripts/publish_post.py --message-file post.txt --image a.jpg --dry-run
  python scripts/publish_post.py --message-file post.txt --image a.jpg --image b.jpg --image c.jpg --confirm
  python scripts/publish_post.py --message "..." --link https://example.co.il/property/12 --confirm
  python scripts/publish_post.py --message-file post.txt --image a.jpg --schedule "2026-10-12 09:30" --confirm
  python scripts/publish_post.py --list --limit 10        # recent posts with IDs (for boosting)

Instagram publishing is NOT covered: the IG Content Publishing API needs
images at a public URL and a separate permission set. Post to IG from the
app, or boost the FB post onto IG placements via create_campaign.py.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from meta_client import (
    GRAPH_BASE,
    MetaAPIError,
    get_default_page,
    get_page_token,
    get_version,
    paginate,
    post,
    print_json,
)

TZ = ZoneInfo("Asia/Jerusalem")


def upload_unpublished_photo(page_id: str, token: str, path: Path) -> str:
    import requests

    url = f"{GRAPH_BASE}/{get_version()}/{page_id}/photos"
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    with path.open("rb") as f:
        resp = requests.post(
            url,
            data={"access_token": token, "published": "false"},
            files={"source": (path.name, f, mime)},
            timeout=120,
        )
    if not resp.ok:
        raise RuntimeError(f"Photo upload failed ({resp.status_code}): {resp.text[:400]}")
    return resp.json()["id"]


def schedule_ts(s: str) -> int:
    dt = datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    delta = dt.timestamp() - datetime.now(TZ).timestamp()
    if not 600 <= delta <= 75 * 24 * 3600:
        raise SystemExit("--schedule must be between 10 minutes and 75 days from now (Israel time)")
    return int(dt.timestamp())


def main():
    ap = argparse.ArgumentParser(description="Publish a Facebook Page post")
    ap.add_argument("--page-id", default=None, help="Defaults to META_PAGE_ID")
    ap.add_argument("--message")
    ap.add_argument("--message-file", help="UTF-8 text file with the post body (easier for Hebrew)")
    ap.add_argument("--image", action="append", default=[], help="Image file; repeat for up to 10")
    ap.add_argument("--link", help="Link post (no images)")
    ap.add_argument("--schedule", help="'YYYY-MM-DD HH:MM' Israel time")
    ap.add_argument("--require", help="Text that must appear in the message (e.g. broker license line)")
    ap.add_argument("--list", action="store_true", help="List recent Page posts")
    ap.add_argument("--limit", type=int, default=10)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--confirm", action="store_true")
    args = ap.parse_args()

    page_id = args.page_id or get_default_page()
    if not page_id:
        print_json({"ok": False, "error": "Need --page-id or META_PAGE_ID"})
        sys.exit(2)

    try:
        if args.list:
            tok = get_page_token(page_id)
            posts = []
            for p in paginate(f"{page_id}/posts",
                              {"fields": "id,created_time,message,permalink_url", "limit": args.limit},
                              max_pages=1, token=tok):
                p["message"] = (p.get("message") or "")[:120]
                posts.append(p)
            print_json({"ok": True, "page_id": page_id, "posts": posts,
                        "hint": "Use id as post_id with format existing_post to boost"})
            return

        message = args.message
        if args.message_file:
            message = Path(args.message_file).read_text(encoding="utf-8").strip()
        if not message:
            ap.error("--message or --message-file is required")
        if args.require and args.require not in message:
            print_json({"ok": False, "error": f"required text missing from message: {args.require}"})
            sys.exit(2)
        if args.link and args.image:
            ap.error("use either --link or --image, not both")
        images = [Path(p).expanduser().resolve() for p in args.image]
        missing = [str(p) for p in images if not p.exists()]
        if missing:
            ap.error(f"image not found: {missing}")
        if len(images) > 10:
            ap.error("max 10 images")
        sched = schedule_ts(args.schedule) if args.schedule else None

        plan = {
            "page_id": page_id,
            "message": message,
            "images": [p.name for p in images],
            "link": args.link,
            "scheduled_for": args.schedule + " (Israel)" if sched else "publish immediately (public)",
        }
        if not args.confirm:
            print_json({"ok": True, "dry_run": True, "plan": plan})
            return

        tok = get_page_token(page_id)
        data: dict = {"message": message}
        if sched:
            data["published"] = "false"
            data["scheduled_publish_time"] = str(sched)
        if args.link:
            data["link"] = args.link
        if images:
            ids = [upload_unpublished_photo(page_id, tok, p) for p in images]
            data["attached_media"] = json.dumps([{"media_fbid": i} for i in ids])
        res = post(f"{page_id}/feed", data, token=tok)
        print_json({"ok": True, "post_id": res.get("id"), "plan": plan,
                    "next": "To boost: put this post_id in a campaign spec ad with format existing_post"})
    except MetaAPIError as e:
        print_json({"ok": False, "error": str(e), "body": e.body})
        sys.exit(1)
    except RuntimeError as e:
        print_json({"ok": False, "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
