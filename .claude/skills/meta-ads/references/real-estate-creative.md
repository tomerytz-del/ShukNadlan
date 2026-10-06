# Real-estate creative playbook (Israel, Hebrew)

Read this whenever the user asks for help with ad copy, images, posts, angles, or a campaign brief for a real-estate brokerage. The goal is ads that are **legal, truthful, and generate phone-ready leads** — not clever ads.

## 1. Legal & policy checks (do these first, every time)

### Israeli broker rules
The Real Estate Brokers ethics regulations (in force since 9 March 2025) require, on **every ad a broker publishes**:
- The broker's name and **broker license number**. Put it at the end of the primary text, e.g. `נדל"ן עפולה | תומר יצחק, רישיון תיווך 12345`.
- Set this exact line as `required_disclosure` in the campaign spec — `create_campaign.py` refuses to create any ad missing it, and `publish_post.py --require "<line>"` does the same for Page posts.

They also prohibit:
- Advertising a property without the **owner's consent** (ask: "יש לך הזמנת שירותי תיווך / אישור בעלים לנכס הזה?" before using it in an ad).
- Advertising a property you know is **no longer available**. Before reusing an old creative, ask whether every property in it is still on the market.
- Presenting an ad as if it came **from the owner** ("מוכר ישירות", "ללא תיווך") when it's a broker ad.

Never invent prices, room counts, "only X left", "just sold 3 units this week", or "#1 in the valley". Every number and superlative in copy or on an image must come from the user. Ask for it; leave a `<placeholder>` if they don't have it.

### Meta housing policy
- Israel is **not** one of the regions where Meta forces the `HOUSING` special ad category (that's US, Canada, Europe). Default `special_ad_categories: []`.
- If any ad set targets Europe/US/Canada (e.g. olim, diaspora investors), the campaign **must** use `["HOUSING"]` + `special_ad_category_country`, which forces ages 18–65+, all genders, ≥15 km radius, no lookalikes, no exclusions. The script enforces this.
- Regardless of category, Meta's discrimination policy applies everywhere: no copy that includes or excludes people by religion, ethnicity, family status, age, gender, disability ("מתאים לזוג צעיר בלבד", "לדתיים", "ללא ילדים" — no). Describe the **property**, not the desired buyer. Lead forms must not ask age, gender or marital status (the form script blocks them).

## 2. Pick the campaign type from the business goal

| Goal | Destination | Objective | Why |
|---|---|---|---|
| Buyers/renters for listed properties | `lead_form` | `OUTCOME_LEADS` | Phone number without leaving FB/IG; cheapest qualified lead. Default for a brokerage. |
| Sellers / exclusive listings ("רוצים למכור?") | `lead_form` | `OUTCOME_LEADS` | Form asks address + timing; this is the highest-value lead for a broker. |
| Fast conversation, people who prefer chat | `whatsapp` | `OUTCOME_ENGAGEMENT` | Very strong in Israel. Needs a WhatsApp Business number linked to the Page. Leads land in WhatsApp, not in fetch_leads. |
| Traffic to property pages on the website | `website` | `OUTCOME_TRAFFIC` | Only when the site has a good listing page + contact form; without a pixel, optimise for `LANDING_PAGE_VIEWS`. |
| Boost a post that's already doing well organically | `website` + `existing_post` | `OUTCOME_TRAFFIC` or `OUTCOME_ENGAGEMENT` | Keeps the post's likes/comments as social proof. |

Before building anything, get a short brief from the user (one message, not an interview):
1. What exactly are we selling — specific property / several / the brokerage itself / seller acquisition?
2. Area + radius (Afula city? whole Jezreel Valley?).
3. Daily budget and how long.
4. Where should leads go — form, WhatsApp, or website?
5. Broker license line (once — then reuse).
6. What images exist (real photos of the property, agent photo, logo)?

## 3. Copy that works for property ads

**Structure of the primary text (`message`)** — Hebrew, short lines, the first 125 characters must stand alone because the rest hides behind "עוד":
1. Hook (line 1): the most concrete thing — location + type + one standout fact. `4 חדרים עם מרפסת שמש בגבעת המורה ☀️`
2. 2–3 short facts, each on its own line, optionally with one emoji bullet: price (if the user wants it shown), size, floor/elevator/parking, distance to school/train.
3. One-line call to action matching the destination: `השאירו פרטים ונתאם סיור` / `שלחו הודעה בוואטסאפ ונשלח את כל הפרטים`.
4. Disclosure line (required).

**Headline (`headline`)** ≤ 40 chars (≤ 32 on carousel cards). Lead with type + neighbourhood or price: `5 חד' בעפולה עילית | 1.79 מ' ₪`.

**Angles worth A/B testing** (one angle per ad set, everything else identical):
- *The property* — a specific listing, real photo, price.
- *Choice* — carousel of 3–6 listings in the same area.
- *Local expert* — the agent's face + "מכירים כל רחוב בעפולה" (only if true) — good for seller leads.
- *Seller acquisition* — "כמה שווה הדירה שלכם בעפולה?" + free valuation offer (only if the user offers one).
- *Urgency, but true* — "ביקור פתוח בשבת 11:00" (a real event with a date), never fake scarcity.

Write 2–3 variations per angle; let the user pick. Don't ship all of them — 2 ads per ad set is plenty for budgets under ₪100/day.

**Tone**: direct, warm, local. Spoken Hebrew, not marketing Hebrew. No ALL CAPS-equivalent shouting (!!!), max 2 emojis.

## 4. Images

- **Real photos of the actual property only.** Never AI-generated or stock images of a "similar" property — that's a misleading ad under both Meta policy and the broker regulations. Stock/illustration is fine only for brand/seller-acquisition ads, clearly not depicting a listing.
- Formats: 1080×1350 (4:5) for feed, 1080×1920 (9:16) for Stories/Reels, 1080×1080 for carousel cards. JPG or PNG, < 4 MB (scripts accept both; the script detects type).
- Best first frame: bright living room or the view, horizontal lines straight, lights on, no clutter, no people's faces from the owner's family photos.
- Text on image: minimal — price or "חדש בבלעדיות" in a corner band. Hebrew text must render right-to-left. Pillow with `features=["raqm"]` (libraqm installed) handles it; otherwise run the string through `python-bidi` (`get_display`) before drawing. Either way **look at the output** before using it — reversed Hebrew is the #1 creative bug.
- Carousel: card 1 = strongest photo; keep the same crop and colour treatment across cards; `let_meta_reorder_cards: false` when card order tells a story (exterior → living room → kitchen → view).

If the user asks you to prepare images, you may crop/resize/add a text band with Pillow — but only on photos they supplied. Show them the result before it goes into a spec.

## 5. Lead form design

Use `assets/example-lead-form.json` as the base.
- 3–5 questions. Name + phone are pre-filled by Meta; every extra question costs completion rate.
- Ask the questions a broker needs to prioritise the call: deal type, budget range, timing. Use **multiple-choice** (`options`) rather than free text — faster to fill and easier to sort.
- `higher_intent: true` (adds a review screen) when the user complains about junk leads; leave it off for a first test to see volume.
- Thank-you screen: tell them when they'll be contacted and only promise what the office actually does ("נחזור אליך עוד היום" only if that's true).
- A privacy policy URL on the user's own site is mandatory.
- Forms can't be edited after creation. New questions → new form → new ads.

## 6. Budgets & structure for a local brokerage

- Area: radius around the city centre (`custom_locations`, km) rather than a city name — Israeli city targeting is coarse. Afula centre ≈ 32.6078, 35.2897; 15–25 km covers the valley towns.
- Start: 1 campaign, 2 ad sets (two angles), ₪30–50/day each, 7 days, Advantage+ audience on, age 25–60, no interests (local radius is already the filter; interests just shrink the audience).
- Judge on cost per lead **and lead quality** (did they answer the phone? were they in budget?) — ask the user after a week, then pause the weaker angle with `pause_ad.py` and move budget with `update_budget.py`.
- Don't touch a new ad set for 3–4 days; Meta's learning phase needs ~50 results/week to settle and a small local budget won't reach that — judge on trend, not day-to-day noise.

## 7. Organic posts (`publish_post.py`)

Same copy rules, longer is fine (no truncation issue on organic). Good cadence: a new-listing post when a property is signed, a "נמכר ✅" post when it sells (with owner consent), and a neighbourhood/market post occasionally. A listing post that gets good organic engagement in its first 24–48 hours is the best candidate to boost with `existing_post`.

## 8. Checklist before `--confirm`

- [ ] Disclosure line present in every ad (script checks).
- [ ] Every property shown is available and has owner consent (ask).
- [ ] Every number/claim came from the user.
- [ ] Photos are real, of the actual property, and Hebrew on images reads correctly.
- [ ] Destination matches where the office will actually answer (form leads → someone calls them back fast; WhatsApp → someone watches WhatsApp).
- [ ] Budget, dates, radius read back to the user in plain Hebrew.
