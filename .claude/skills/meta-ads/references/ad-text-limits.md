# Ad text limits per platform

Taken from the `ad-creative` skill (MIT, `references/platform-specs.md`) when it was
evaluated for this repo. The skill itself was **not** installed: its default style is
"aggressive" and written for another market. Only the limits are kept here, because
they are facts about the platforms, not style. `ads-admin/copy.ts` (`LIMITS`,
`checkVariant`) enforces the Meta row as warnings.

## Meta (Facebook / Instagram)

| Element | Visible | Hard limit | Notes |
| --- | --- | --- | --- |
| Primary text | ~125 chars before "See more" | none | The first 125 characters must stand on their own. We cap at 500. |
| Headline | 40 | 40 | Bold line under the creative. Shorter is safer. |
| Description | 25 | 25 | Under the headline; not shown on every placement. |
| Display link | 40 | 40 | Optional. |
| Carousel card headline | 32 | 32 | Per card. |

## Google Ads (Responsive Search Ads) — for step 7 of the console

| Element | Limit | Quantity |
| --- | --- | --- |
| Headline | 30 | up to 15 |
| Description | 90 | up to 4 |
| Display URL path | 15 each | 2 |

Headlines must read correctly alone and in any combination. Pin only when necessary.

## LinkedIn

| Element | Recommended | Max |
| --- | --- | --- |
| Intro text | 150 | 600 |
| Headline | 70 | 200 |
| Description | 100 | 300 |

## TikTok

| Element | Limit |
| --- | --- |
| Ad text | 100 |
| Product name | 40 |
| Selling points | 25 each, 3-4 |
| Disclaimer (creative-level) | ≤ 89 (TikTok rejects 90+) |

## X (Twitter)

| Element | Limit |
| --- | --- |
| Post text | 280 |
| Card headline | 70 |
| Card description | 200 |
