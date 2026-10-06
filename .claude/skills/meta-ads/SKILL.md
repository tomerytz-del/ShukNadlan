---
name: meta-ads
description: Plan, create, analyze and manage Meta ads (Facebook, Instagram, Click-to-WhatsApp) via the Marketing API — including lead-form campaigns, carousels, boosting Page posts, publishing Page posts, downloading leads, and writing Hebrew real-estate ad copy and creative. Use when the user mentions Meta/FB/IG ads, Ads Manager, lead ads, Instant Forms, ROAS, CPA, CPL, CTR, ad spend, campaign or ad set performance, creative fatigue, pausing an ad, changing a budget, duplicating a winner, launching a campaign, or writing ad copy/posts for a property. Trigger on Hebrew like פרסום בפייסבוק/באינסטגרם, קמפיין, צור קמפיין, מודעת לידים, טופס לידים, לידים מפייסבוק, קרוסלה, קידום פוסט, פוסט לדף, מודעה לנכס, קופי למודעה, ביצועי קמפיין. Trigger even if auth isn't set up — the skill walks through setup. Do NOT use for organic Instagram analytics or Google Ads.
---

# Meta Ads (Marketing API)

Pull ad performance data from Meta (Facebook, Instagram, Messenger, Click-to-WhatsApp, Threads), run analyses, help write the creative, and — with explicit confirmation — write changes back: pause, budget change, duplicate, full campaign creation (image, carousel, boosted post; website, lead-form or WhatsApp destination), lead-form creation, Page posts, and lead download.

## When to consult this skill

Any question about Meta ad performance, creative health, audience/placement mix, or campaign management. If the user asks "how are my ads doing" without specifying a platform, ask whether they mean Meta or Google before defaulting.

## Three things to internalize before touching any script

**1. Where the scripts run matters.** The scripts call `graph.facebook.com` over the open internet. Some execution environments (including Claude's Linux sandbox in certain configurations) block this endpoint via proxy. If you hit a `ProxyError` / `Tunnel connection failed: 403` on the first call, run the scripts from the **user's host machine** — macOS, Windows, or Linux — using that machine's Python. Per-OS commands:
- **macOS:** `python3 scripts/auth_check.py`, deps via `python3 -m pip install --user requests`
- **Windows:** `python scripts/auth_check.py` (or `py scripts/auth_check.py` if `python` isn't on PATH), deps via `python -m pip install --user requests`
- **Linux:** `python3 scripts/auth_check.py`, deps via `python3 -m pip install --user requests` (add `--break-system-packages` on Debian/Ubuntu 22+)

The scripts themselves are pure Python with one dependency (`requests`) and no shell/OS assumptions, so they run identically everywhere once dependencies are installed.

**2. WhatsApp is not a separate ad surface.** Click-to-WhatsApp ads run on Facebook and Instagram placements. They show up in the Marketing API as regular ads with `destination_type=WHATSAPP` and conversion events under `actions` (look for `onsite_conversion.messaging_conversation_started_7d` and similar). Don't promise the user a "WhatsApp ads dashboard" — there isn't one.

**3. Read is safe, write is not.** Insights endpoints (GET) are idempotent and harmless. Pause / budget / duplicate (POST) actions touch real money. The write rules in `references/write-actions.md` are non-negotiable — read that file before any write call.

## The 37-month data wall

Meta's insights API only serves data from the last **37 months**. Any campaign older than that returns error `3018` and is effectively invisible. If the user asks "what was my best campaign ever" and their activity predates the window, the answer is "the API can't tell you — check Ads Manager's archived reports UI." Surface this before starting a query that's going to fail.

## Before anything else: check setup + discover accounts

The first three calls are always the same:

1. `python scripts/auth_check.py` — is the token alive, what identity does it resolve to, how many ad accounts does it see?
2. `python scripts/list_accounts.py --with-recent-spend` — which accounts are actually running ads right now? (Sorted by last-30-day spend, then lifetime spend.) This tells you which account to pin as `META_AD_ACCOUNT_ID`.
3. `python scripts/list_campaigns.py` — once you have the right account, what campaigns are on it?

If any of these fail, stop and walk the user through `references/setup.md`. Don't try to be clever and guess credentials.

### How to guide a user through setup (first-timers)

`references/setup.md` is written as a click-by-click walkthrough. When a user has no credentials yet:

1. **One step at a time.** Don't dump the whole document. Ask them which OS they're on, then give them the prerequisites block for that OS. Wait for them to report "done" before moving on.
2. **Confirm the path choice.** Walk through the Step 0 decision questions with them in chat. Don't assume — especially "do you boost from Instagram?" is easy to misjudge.
3. **Read back what they paste.** When they share a token, App ID, or ad account ID, echo it back (redact tokens to the first 8 chars) and confirm you have it right before you move on. This catches the #1 setup bug: pasting the System User's ID where the Ad Account ID should go.
4. **Verify before moving on.** After they fill in `.env`, run `auth_check.py` immediately. Don't let them run analysis commands until the verification returns `ok: true` — every "the report is empty" issue traces back to a half-broken `.env`.
5. **Match their OS in every command.** If they said "I'm on Windows," don't tell them to run `python3` — tell them `python` or `py`. If they said "Mac", use `python3`. The setup.md has per-OS blocks; copy the matching one into chat.

Required env vars (user provides these once during setup):
- `META_ACCESS_TOKEN` — either a long-lived user token (Path B, 60 days) or System User token (Path A, never expires). See the decision tree below.
- `META_AD_ACCOUNT_ID` — default ad account, format `act_1234567890` (scripts accept `--account-id` to override per call).
- `META_API_VERSION` — defaults to `v26.0` (released 2026-07-29).
- `META_PAGE_ID` — the Facebook Page for lead forms, leads and posts (find it with `list_pages.py`).

The user puts these in a `.env` file at the working directory or exports them in the shell. Scripts auto-load `.env` if present. See `assets/env.template`.

## Path A vs Path B: which token type?

This is the single most common failure mode. Get it right up front.

**Use Path A (System User token) when:**
- Ads run inside a Meta Business Manager you control.
- The ad accounts you want to analyze are owned by that BM.
- You want a token that never expires.

**Use Path B (long-lived user token) when:**
- You boost posts from the Instagram app (these often create a personal ad account outside any BM — invisible to System User tokens no matter what permissions you grant).
- Your ad account is attached to your personal Facebook profile, not a BM.
- You want to see every ad account your personal FB login can access (typically the broadest view).

**Can't tell which?** Start with Path B. It sees a strict superset of what Path A sees. Once you've identified the important accounts, you can optionally move them into a BM and switch to Path A for permanence.

Full setup steps for both paths: `references/setup.md`.

## Workflow: read operations

For any read request, follow this loop:

1. **Pick the right script.** Don't reinvent. The bundled scripts cover the common cases:
   - `auth_check.py` — verify token, list visible accounts briefly
   - `list_accounts.py` — discover all ad accounts, decode status, show lifetime + optional recent spend
   - `list_campaigns.py` — campaigns under an account, with status filters
   - `fetch_insights.py` — the workhorse. Date ranges, breakdowns (publisher_platform, age, gender, country, placement, device_platform), level (account/campaign/adset/ad), custom field lists. Read its `--help` before calling.
   - `creative_fatigue.py` — frequency + CTR decay analysis at the ad level
   - `anomaly_detect.py` — compares a date range against the prior equivalent range, flags significant changes
   - `exchange_token.py` — Path B only: swap short-lived user token for 60-day long-lived token
   - `list_pages.py` — Pages the token can use, with linked Instagram account ID and WhatsApp number (fills `identity` in a spec and `META_PAGE_ID`)
   - `fetch_leads.py` — download leads from Instant Forms (one form, one ad, or every form on the Page), optional `--since` and `--csv`
   - `publish_post.py --list` — recent Page posts with IDs (to boost one)

   Write scripts (pause/budget/duplicate/create — read `write-actions.md` first):
   - `pause_ad.py` — pause/resume a single campaign, ad set, or ad
   - `update_budget.py` — modify daily or lifetime budget with 2×-per-call safety cap
   - `duplicate_ad.py` — clone an ad, ad set, or entire campaign into a new copy
   - `create_campaign.py` — build a whole campaign (campaign + ad sets + creatives + ads) from a spec JSON. Destinations: website / lead_form / whatsapp. Formats: image / carousel / existing_post. Handles image upload, interest resolution, disclosure checks. See `references/campaign-creation.md`.
   - `create_lead_form.py` — create / list / archive Instant Forms on the Page
   - `publish_post.py` — publish or schedule a Page post (text + up to 10 images, or a link)
   - `rollback_creation.py` — pause or delete every object from a `create_campaign.py` run using its state file

2. **Run it, capture JSON output.** Every script outputs structured JSON to stdout. Don't try to parse human-readable text — there isn't any. Pipe to a file if the user wants to keep the raw data: `python scripts/fetch_insights.py ... > insights.json`.

3. **Analyze with the playbooks.** Once you have the data, consult `references/analysis-playbooks.md` for the relevant pattern (fatigue, funnel, audience mix, anomalies). The playbook tells you what thresholds matter and what to recommend.

4. **Present in the user's preferred language.** If the user writes in Hebrew, respond in Hebrew. Keep metric names in English (`CTR`, `CPA`, `ROAS`) so they cross-reference cleanly with Ads Manager. If asked for a doc/dashboard, follow whatever design system skill they've set up.

## Workflow: write operations (pause, budget, duplicate)

These are the dangerous ones. Follow this protocol every time, no shortcuts:

1. **Surface the action and the impact in plain language before calling.** Example: "Pause ad `Campaign_v3` (ID 120214...). This ad spent ₪47 in the last 7 days with 0.8% CTR. Confirm?"
2. **Wait for explicit `yes` / `confirm` / the user's language equivalent in chat.** A previous "go ahead" in the conversation does not carry over. Each write needs its own confirmation.
3. **One action at a time by default.** If the user wants to bulk-pause 12 ads, present a numbered list and confirm the whole batch in one explicit message ("pause all 12") — but log each call separately.
4. **Always do a dry-run first when the script supports it** (`--dry-run` flag prints what would change without calling the API).
5. **Never auto-shift budgets above +50% in one call.** If the user wants a 3x increase, do it in steps with confirmation each time. Meta's learning phase resets on big budget changes anyway.

Full rules and edge cases in `references/write-actions.md`. Read it before calling any of: `pause_ad.py`, `update_budget.py`, `duplicate_ad.py`, `create_campaign.py`.

## Workflow: end-to-end campaign with creative help

When the user wants "a new campaign" and help with the creative, run this sequence — each numbered write is its own confirmation:

1. **Brief** — one message collecting goal, area/radius, budget & duration, destination (form / WhatsApp / site), license line, available photos. Read `references/real-estate-creative.md` first when the business is real estate.
2. **Creative** — propose 2 angles × 2–3 copy variations in Hebrew (primary text + headline), and an image plan using *their* photos. Let them pick and edit. If asked, prepare images (crop/resize/text band) with Pillow and show them.
3. **Lead form** (if destination is `lead_form`) — draft from `assets/example-lead-form.json`, `create_lead_form.py --dry-run`, read every label back → confirm → `--confirm`.
4. **Spec** — write the campaign spec (start from `assets/example-lead-campaign.json`), set `required_disclosure`. Run `--dry-run --offline` while still drafting, then a real `--dry-run`.
5. **Create** — walk the dry-run back in plain Hebrew (names, budgets per day and total, radius, form, every ad's text) → explicit confirmation → `--confirm`. Everything is created PAUSED.
6. **Launch** — the user previews the ads in Ads Manager and activates them there (or asks you to, as a separate confirmed write with `pause_ad.py --status ACTIVE`).
7. **Follow-up** — after a few days: `fetch_insights.py` for CPL/CTR per ad set, `fetch_leads.py` for the leads themselves; ask about lead quality before recommending what to pause or scale.

Organic: `publish_post.py` for listing posts; a post that performs well organically can be boosted later via `existing_post`.

## Workflow: creating a campaign from scratch

Use `create_campaign.py` to build a full campaign tree (campaign → ad sets → creatives → ads) in one shot from a spec JSON. Good for A/B flights where you want the exact same structure with disciplined naming and auditable creation history.

Before you touch the script:

1. **Check if the user has a pixel** (website destination only). No pixel → force `objective: OUTCOME_TRAFFIC` and `optimization_goal: LINK_CLICKS`. Lead-form and WhatsApp campaigns don't need a pixel — Meta measures the result itself, which is why they're the default for a local business. Don't build a conversions campaign against an account that can't measure conversions; you'd be paying Meta to optimize toward an event it never sees. Surface this to the user and let them decide whether to wait for pixel install or launch blind on traffic.
2. **Check the account balance.** Status code 3 (`UNSETTLED`) on the ad account means objects can be created but nothing will deliver until balance clears. Don't block creation, but tell the user before they expect spend.
3. **Discover the right page + Instagram identity.** Run `list_pages.py` — it shows each Page, its Instagram account ID, WhatsApp number, and whether the token can advertise on it. If several Pages qualify, ask which one.
4. **Default everything to PAUSED.** The campaign, ad sets, and ads should all be `PAUSED` at creation. The user flips ACTIVE themselves in Ads Manager once they've eyeballed the creative. This is the last safety net.
5. **Dry-run first, always.** `create_campaign.py --spec foo.json --dry-run` prints the full plan with resolved interest IDs, currency-corrected budgets, and targeting summary. Walk the dry-run back to the user in plain language before asking for `--confirm`.

Per `write-actions.md`, a fresh explicit confirmation is required for `--confirm` even if the user approved the plan earlier in the same session. That confirmation must name the action (e.g. "confirm create", "בצע יצירה") — not a generic "ok".

Full spec format, field reference, currency handling, interest resolution, state file and rollback details: `references/campaign-creation.md`.

### When NOT to use `create_campaign.py`

- **Single ad addition to existing ad set** — just call the ads endpoint directly or use the UI. Overkill to spec-and-run for one ad.
- **Duplicating a winner** — `duplicate_ad.py` is faster and preserves learning signals.
- **Video, dynamic creative, catalog, collection ads** — not supported. Workaround for video: post it on the Page from the app, then boost with `existing_post`.

## Gotchas the scripts already handle for you

- **Currency minor units.** `amount_spent`, `balance`, `spend_cap`, `daily_budget`, `lifetime_budget` are returned by Meta as strings of minor units (agorot/cents/pence). `list_accounts.py` and `list_campaigns.py` convert these to major units in a `_major` or plain decimal field. Zero-decimal currencies (JPY, KRW, VND, ISK, TWD, etc.) are not divided.
- **Account status codes.** Scripts decode 1→ACTIVE, 2→DISABLED, 3→UNSETTLED, 7→PENDING_RISK_REVIEW, etc.
- **Pagination.** All scripts auto-paginate via `meta_client.paginate()`.
- **Rate limits.** `meta_client._request()` backs off on subcodes 1487742 / 2446079 / 1487390 and retries.
- **Async insights.** `fetch_insights.py` auto-falls-back to async jobs when sync queries would time out (or you can force with `--async`).
- **DELETED campaigns.** Meta's campaigns endpoint returns error 1815001 when you request DELETED. The script's `--status` choices deliberately exclude DELETED. To see deleted campaigns, use Ads Manager UI.

## What the bundled scripts don't handle

- Initial auth / token generation (manual, see `references/setup.md`).
- Pixel / Conversions API event ingestion (separate API).
- Video upload, dynamic creative, catalog and collection ads (image, carousel and boosted posts only).
- Publishing to Instagram directly (Page posts only; IG gets the ads via placements).
- Editing a lead form after creation (Meta doesn't allow it — create a new one).
- Custom Audience creation (you can reference existing audiences, but not build new ones from here).
- Editing an already-live creative in place (you create new creatives via `create_campaign.py`; editing an existing one is a different API shape).

If the user needs something the scripts don't cover, extend the skill in a writeable copy and re-package — see `references/campaign-creation.md` for the pattern `create_campaign.py` establishes for write scripts. Don't fork separate one-off scripts in the user's working directory; consolidate into the skill so the next run benefits.

## Companion skills

If the `ad-creative` or `performance-marketing` skills are installed, use them for what they're good at — generating many copy variations, creative-testing plans, funnel-layer diagnostics, account-safety hygiene — and keep this skill for everything that touches the API. For a real-estate business, `references/real-estate-creative.md` overrides their defaults: Hebrew, calm local tone, no "aggressive" style, no fake urgency or invented numbers, and the broker disclosure line on every ad.

## Reference files

Read these on demand, not all upfront.

- `references/setup.md` — One-time setup: decision tree Path A vs Path B, how to create the app, get tokens, find account IDs. Read this when the user has no credentials, or when `auth_check.py` fails.
- `references/insights-fields.md` — Field glossary, breakdown options, common metric definitions, gotchas (attribution windows, action_attribution, deduplication). Read this when constructing a custom insights query.
- `references/analysis-playbooks.md` — Patterns for creative fatigue, audience analysis, funnel diagnosis, anomaly response. Read this when the user asks for analysis, not just data.
- `references/write-actions.md` — Mandatory before any write call. Confirmation flow, safety thresholds, rollback patterns — including the campaign-creation section before using `create_campaign.py`.
- `references/campaign-creation.md` — Spec format, destinations (website / lead_form / whatsapp), formats (image / carousel / existing_post), currency, interests, state file and rollback. Read this when the user asks to launch a campaign, A/B test, or new ad flight.
- `references/real-estate-creative.md` — Israeli broker ad rules (license disclosure, owner consent, no fictitious listings), Meta housing/discrimination policy, campaign-type choice, Hebrew copy structure and angles, image rules, lead-form design, local budgets. Read before writing any copy, form or spec for a real-estate business.
- `references/troubleshooting.md` — Common failure modes (sandbox proxy, IG boost invisible to SU tokens, missing requests module, encoding issues, 37-month cap, etc.). Read this when any script returns `ok: false` or something unexpected.

## Scaling beyond personal use

This skill is built for one user, one set of credentials, a handful of ad accounts. Multi-tenant / client-agency use (one operator managing dozens of client BMs) is a different build:
- Per-client credential storage (not everyone's tokens in one .env).
- Each client issues their own System User token from their own BM.
- Audit log of every write action, who triggered it, against which account.

Don't try to retrofit the personal skill for multi-tenant use. Tell the user it's a different build.
