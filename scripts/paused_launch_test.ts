/* ============================================================================
   השקה מושהית של חבילת מטא (ads-admin/launch-package.ts)

   כל קמפיין, סט ומודעה נבנים PAUSED. HOUSING רק על דיור. התקציב כולל את
   ₪30 של גוגל. הרצה שנייה לא שולחת כלום. אין קריאה למטא מכאן.

       node --experimental-strip-types scripts/paused_launch_test.ts
   ========================================================================== */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptedTargetingMatch,
  assertSafeWrite,
  BROKER_FORM_ID,
  buildLaunchPlan,
  collectWriteOps,
  CREATIVE_BYTES,
  CREATIVE_GIT_COMMIT,
  creativeSourceUrl,
  creativeStorageReport,
  DISCLOSURE_DEFAULT,
  creativePreviewBody,
  executeLaunch,
  formatMetaError,
  LAUNCH_BUDGET_MS,
  LAUNCH_IDLE_LIMIT_MS,
  LAUNCH_WALL_LIMIT_MS,
  GOOGLE_BUYERS_CAMPAIGN,
  GOOGLE_BUYERS_DAILY_ILS,
  HOUSING_MIN_RADIUS_KM,
  knownCampaignsFromLaunch,
  LAUNCH_KEY,
  launchWillWrite,
  OFFICE_FORM_ID,
  PAGE_ID_EXPECTED,
  pausedCampaignsFromGraph,
  PAUSED_STATUS,
  pickStandInCampaign,
  deprecatedInterestIdsFromError,
  interestValiditySpec,
  omitDeprecatedInterestIds,
  pickTargetingMatch,
  PIXEL_ID,
  PROTECTED_CAMPAIGN_IDS,
  REGION_FALLBACK_KM,
  resolveLaunchIdentity,
  resolveLaunchTargeting,
  sanitizeAdSetTargeting,
  sanitizeLaunchBody,
  SELLERS_FORM_ID,
  sha256Hex,
  summarizeLaunch,
  targetingSearchSpec,
  termsNeedingIds,
  uncheckedLaunchTargeting,
  validateLaunchWrites,
  VALUATION_FORM_ID,
  VALUATION_FORM_NAME,
  type ExistingRow,
  type LaunchInput,
  type LaunchPlan,
} from "../supabase/functions/ads-admin/launch-package.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACT = "act_1651428663039877";

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => {
  console.log((cond ? "✓ " : "✗ ") + name + (cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`));
  if (!cond) fail++;
};

function baseInput(over: Partial<LaunchInput> = {}): LaunchInput {
  return {
    disclosure: DISCLOSURE_DEFAULT,
    maxDailyBudget: 150,
    pageId: PAGE_ID_EXPECTED,
    pixelId: PIXEL_ID,
    ...over,
  };
}

function idsFor(plan: LaunchPlan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of termsNeedingIds(plan)) out[`${t.type}:${t.name}`] = `id_${t.type}_${t.name.length}`;
  return out;
}

const REGIONS = { "Haifa District": "region_haifa", "Northern District": "region_north" };

function opsOf(plan: LaunchPlan, termIds = idsFor(plan)) {
  return collectWriteOps(plan, { pageId: PAGE_ID_EXPECTED, pixelId: PIXEL_ID, regionKeys: REGIONS, termIds });
}

function fileSha(rel: string): string {
  const buf = readFileSync(path.join(root, "marketing", "meta-creatives", rel));
  return createHash("sha256").update(buf).digest("hex");
}

const plan = buildLaunchPlan(baseInput());
const summary = summarizeLaunch(plan);
const built = opsOf(plan);

ok("plan ok", plan.ok, plan.errors);
ok("launch key", plan.launchKey === LAUNCH_KEY);
ok("budget 110 meta + 30 google = 140", plan.budget.metaDailyIls === 110 && plan.budget.googleDailyIls === 30 && plan.budget.totalDailyIls === 140);
ok("google campaign id fixed", plan.budget.googleCampaignId === GOOGLE_BUYERS_CAMPAIGN && GOOGLE_BUYERS_DAILY_ILS === 30);
ok("five campaigns", plan.campaigns.length === 5, plan.campaigns.map((c) => c.key));
ok("eight ad sets", plan.campaigns.reduce((n, c) => n + c.adSets.length, 0) === 8);
ok("32 images", plan.images.length === 32, plan.images.length);
ok("29 ads", plan.campaigns.reduce((n, c) => n + c.adSets.reduce((m, a) => m + a.ads.length, 0), 0) === 29);
ok("ops built", built.errors.length === 0 && built.ops.length === 105, built.errors);

const byKey = Object.fromEntries(plan.campaigns.map((c) => [c.key, c]));
ok("brokers are not housing", byKey.brokers.housing === false && byKey.brokers_registered.housing === false && byKey.office_owners.housing === false);
ok("buyers and retargeting are housing", byKey.buyers.housing === true && byKey.retargeting.housing === true);
ok("objectives", byKey.brokers.objective === "OUTCOME_LEADS" && byKey.office_owners.objective === "OUTCOME_LEADS" && byKey.brokers_registered.objective === "OUTCOME_TRAFFIC" && byKey.buyers.objective === "OUTCOME_TRAFFIC" && byKey.retargeting.objective === "OUTCOME_TRAFFIC");

const b1 = byKey.brokers.adSets[0];
const b2 = byKey.brokers_registered.adSets[0];
const b3 = byKey.office_owners.adSets[0];
ok("B1 five ads age 22 radius 15", b1.ads.length === 5 && b1.ageMin === 22 && b1.ageMax === 65 && b1.dailyBudgetIls === 40 && b1.geo.mode === "radius" && b1.geo.radiusKm === 15 && b1.geo.points.length === 9);
ok("B1 one OR group and no audience exclusion", b1.flexible.length === 1 && b1.audienceKeys.length === 0);
ok("Yad2 is not an interest on B1 or B3", !b1.flexible.some((g) => g.some((t) => /yad2|יד2/i.test(t.name))) && !b3.flexible.some((g) => g.some((t) => /yad2|יד2/i.test(t.name))));
ok("B1 lead form", b1.leadFormId === BROKER_FORM_ID && b1.ads.every((a) => a.leadFormId === BROKER_FORM_ID && a.cta === "SIGN_UP"));
ok("B1-1 is 1x1+9x16 and the legacy ads are 1x1+4x5", b1.ads[0].images.map((i) => i.ratio).join(",") === "1x1,9x16" && b1.ads.slice(1).every((a) => a.images.map((i) => i.ratio).join(",") === "1x1,4x5") && b1.ads.every((a) => a.images.length === 2));
ok("B2 three ads, gabriela on G1 and the new copy on the mentor image", b2.dailyBudgetIls === 7 && b2.ageMin === 22 && b2.destination === "website" && b2.geo.mode === "country" && b2.ads.length === 3 && b2.ads[0].landingUrl === "https://shuknadlan.co.il/pricing?utm_source=meta&utm_medium=paid_social&utm_campaign=brokers_leads_q4&utm_content=b2_registered" && b2.ads[0].images.map((i) => i.key).join(",") === "concept_g1_1x1,concept_g1_4x5" && b2.ads[1].images.map((i) => i.key).join(",") === "concept_g2_1x1,concept_g2_4x5" && b2.ads[2].images[0].key === "concept_g2_1x1" && b2.ads[1].headline === "כל בוקר: מה לעשות היום כדי לסגור עסקה." && b2.ads[2].headline === "יש לך חשבון? קבל Elite חינם לחצי שנה." && (b2.ads[1].landingUrl || "").includes("utm_content=b2_2_mentor") && (b2.ads[2].landingUrl || "").includes("utm_content=b2_3_elite") && b2.ads.every((a) => a.images.map((i) => i.ratio).join(",") === "1x1,4x5"));
ok("B3 four ads age 28 regions", b3.ads.length === 4 && b3.ageMin === 28 && b3.dailyBudgetIls === 13 && b3.leadFormId === OFFICE_FORM_ID && b3.geo.mode === "regions" && b3.geo.queries.join("|") === "Haifa District|Northern District" && b3.flexible.length === 2 && b3.ads.every((a) => a.images.map((i) => i.ratio).join(",") === "1x1,9x16"));

const buyers = byKey.buyers.adSets;
ok("buyer budgets 15+10+8+7", buyers.map((a) => a.dailyBudgetIls).join(",") === "15,10,8,7");
ok("buyer housing radius and age", buyers.every((a) => a.ageMin === 18 && a.ageMax === 65 && a.geo.mode === "radius" && a.geo.radiusKm === HOUSING_MIN_RADIUS_KM && a.flexible.length === 0 && a.ads.every((ad) => ad.images.map((i) => i.ratio).join(",") === "1x1,9x16")));
ok("A1 four ads share images", buyers[0].ads.length === 4 && buyers[0].ads.every((ad) => ad.images[0].key === buyers[0].ads[0].images[0].key));
ok("A2 and A4 headlines", buyers[1].ads[0].headline === "5 חדרים בעפולה. בסגנון שלך." && buyers[3].ads[0].headline === "כמה באמת עולה דירה בעפולה?");
ok("A1 utm", (buyers[0].ads[0].landingUrl || "").includes("utm_campaign=buyers_housing_q4") && (buyers[0].ads[0].landingUrl || "").includes("utm_content=a1_viz") && (buyers[0].ads[1].landingUrl || "").includes("utm_content=a1_v1"));

const rt = byKey.retargeting.adSets[0];
ok("retargeting one ad set 10 with four ads", rt.dailyBudgetIls === 10 && rt.ads.length === 4 && rt.audienceKeys.join(",") === "site_visitors_30d" && rt.ageMin === 18 && rt.geo.mode === "radius" && rt.geo.radiusKm === 25);
ok("rt utm kept", (rt.ads[0].landingUrl || "").includes("utm_content=rt1") && (rt.ads[0].landingUrl || "").includes("utm_source=meta") && (rt.ads[1].landingUrl || "").includes("utm_content=rt2") && (rt.ads[2].landingUrl || "").endsWith("#calc") && (rt.ads[2].landingUrl || "").includes("utm_content=rt3") && (rt.ads[3].landingUrl || "").includes("utm_content=rt4") && !(rt.ads[0].landingUrl || "").includes("{{") && rt.ads[2].images[0].key === rt.ads[0].images[0].key && rt.ads[3].images[0].key === rt.ads[1].images[0].key);

ok("A5 skipped by default", plan.skipped.some((s) => s.key === "A5") && !plan.campaigns.some((c) => c.key === "owners"));
ok("OO5 skipped with TODO", plan.skipped.some((s) => s.key === "OO5" && s.reason.includes("TODO")));
ok("disclosure once on every ad", plan.campaigns.every((c) => c.adSets.every((a) => a.ads.every((ad) => ad.message.split(DISCLOSURE_DEFAULT).length === 2))));
ok("contact sheet is not an ad image", plan.images.every((i) => !i.path.includes("contact_sheet")) && summary.images_to_upload.every((i) => !i.path.includes("contact_sheet")));
ok("buyer and retargeting variant counts", buyers.map((a) => a.ads.length).join(",") === "4,3,3,3");
const a3contact = buyers[2].ads[2];
ok("A3-3 drops the absolute contact claim", a3contact.headline === "להשכרה בעפולה: מחיר, תמונות ופרטי קשר." && a3contact.message.includes("רואים מחיר, תמונות ופרטי קשר") && !a3contact.message.includes("ישירים") && !a3contact.message.includes("בכל נכס"));
const liveWarn = plan.warnings.find((w) => w.startsWith("מספרים חיים"));
ok("dry-run lists ads with hard-coded counts", !!liveWarn && liveWarn.includes("A1-3 count (45)") && liveWarn.includes("A2-2 rooms (49)") && liveWarn.includes("A4-3 sqm (₪13,800, ₪17,400)") && !liveWarn.includes("B1"), liveWarn);
ok("A4 descriptions fit and are not warned", buyers[3].ads[1].description === "נתוני עסקאות רשמיים" && buyers[3].ads[2].description === "מחירי עסקאות לפי עיר" && !plan.warnings.some((w) => w.includes("תיאור של")));

const noA5 = buildLaunchPlan(baseInput({ includeA5: true }));
ok("A5 without the valuation form is an error", !noA5.ok && noA5.errors.some((e) => e.code === "a5_form_missing") && !noA5.campaigns.some((c) => c.key === "owners"));
const sellersA5 = buildLaunchPlan(baseInput({ includeA5: true, ownerFormId: SELLERS_FORM_ID }));
ok("A5 refuses the sellers form", !sellersA5.ok && sellersA5.errors.some((e) => e.code === "a5_wrong_form") && !sellersA5.campaigns.some((c) => c.key === "owners") && sellersA5.errors.every((e) => !e.detail.includes("נוצר עכשיו")));
const withA5 = buildLaunchPlan(baseInput({ includeA5: true, ownerFormId: VALUATION_FORM_ID, ownerFormName: VALUATION_FORM_NAME }));
const a5Set = withA5.campaigns.find((c) => c.key === "owners")?.adSets[0];
const a5Summary = summarizeLaunch(withA5).campaigns.find((c) => c.key === "owners")?.ad_sets[0];
ok("A5 included at the cap", withA5.ok && withA5.budget.totalDailyIls === 150 && withA5.campaigns.some((c) => c.key === "owners" && c.housing && c.objective === "OUTCOME_LEADS"));
ok("A5 uses the valuation form name and id", a5Set?.leadFormId === VALUATION_FORM_ID && a5Set?.leadFormName === VALUATION_FORM_NAME && a5Set?.ads[0].leadFormId === VALUATION_FORM_ID && a5Summary?.lead_form_id === VALUATION_FORM_ID && a5Summary?.lead_form_name === VALUATION_FORM_NAME && a5Set?.leadFormId !== SELLERS_FORM_ID);
ok("A5 appraiser line", withA5.campaigns.find((c) => c.key === "owners")!.adSets[0].ads[0].message.includes("שמאי"));
const overA5 = buildLaunchPlan(baseInput({ includeA5: true, ownerFormId: VALUATION_FORM_ID, maxDailyBudget: 149 }));
ok("A5 refused under 150", !overA5.ok && overA5.errors.some((e) => e.code === "budget_cap"));
const tight = buildLaunchPlan(baseInput({ maxDailyBudget: 100 }));
ok("110+30 refused at 100", !tight.ok && tight.errors.some((e) => e.code === "budget_cap") && opsOf(tight).ops.length === 0);
const googleHeavy = buildLaunchPlan(baseInput({ externalDailyIls: 50 }));
ok("google 50 pushes the total over", !googleHeavy.ok && googleHeavy.budget.totalDailyIls === 160);
const badAud = buildLaunchPlan(baseInput({ b2CustomerAudienceId: "nope" }));
ok("bad audience id refused", !badAud.ok && badAud.errors.some((e) => e.code === "bad_audience_id"));
const goodAud = buildLaunchPlan(baseInput({ b2CustomerAudienceId: "1234567890" }));
ok("customer audience attached", goodAud.ok && goodAud.campaigns.find((c) => c.key === "brokers_registered")!.adSets[0].extraAudienceIds.join(",") === "1234567890");
ok("empty disclosure refused", !buildLaunchPlan(baseInput({ disclosure: "  " })).ok);

let active = 0;
const statuses: string[] = [];
for (const op of built.ops) {
  const blob = JSON.stringify(op.body);
  if (blob.includes("ACTIVE")) active++;
  if (blob.includes(PROTECTED_CAMPAIGN_IDS[0])) active++;
  if (op.body.status) statuses.push(op.body.status);
  if (op.kind === "campaign" || op.kind === "adset" || op.kind === "ad") {
    if (op.body.status !== PAUSED_STATUS) active++;
  } else if (op.body.status) active++;
}
ok("no ACTIVE status and no protected id in any write", active === 0 && statuses.length > 0 && statuses.every((s) => s === PAUSED_STATUS), { active, statuses: [...new Set(statuses)] });

const src = readFileSync(path.join(root, "supabase/functions/ads-admin/launch-package.ts"), "utf8");
ok("source never assigns status ACTIVE", !/status:\s*["']ACTIVE["']/.test(src));

function targetingOf(objectKey: string): any {
  const op = built.ops.find((o) => o.objectKey === objectKey);
  return JSON.parse(op!.body.targeting);
}
const tB1 = targetingOf("adset:b1");
const tB3 = targetingOf("adset:b3");
const tBuy = targetingOf("adset:a1");
const tRt = targetingOf("adset:rt");
const tB2 = targetingOf("adset:b2");
ok("no genders and no publisher platforms on ad sets", [tB1, tB3, tBuy, tRt, tB2].every((t) => !t.genders && !t.publisher_platforms && t.targeting_automation.advantage_audience === 0));
ok("housing radius 25", tBuy.geo_locations.custom_locations[0].radius === 25 && tRt.geo_locations.custom_locations[0].radius === 25);
ok("B1 radius 15 on nine cities", tB1.geo_locations.custom_locations.length === 9 && tB1.geo_locations.custom_locations.every((p: { radius: number }) => p.radius === 15));
const b3Generic = ["Owner", "Founder", "Managing Director", "Branch Manager", "Franchise Owner"];
ok("B3 generic titles are AND-narrowed with real-estate titles and interests", tB3.flexible_spec.length === 2 && tB3.flexible_spec[0].work_positions.map((p: { name: string }) => p.name).join("|") === b3Generic.join("|") && tB3.flexible_spec[0].behaviors.map((p: { name: string }) => p.name).join("|") === "Small business owners" && !tB3.flexible_spec[0].interests && !tB3.flexible_spec[0].work_employers && tB3.flexible_spec[1].work_positions.some((p: { name: string }) => p.name === "Broker Owner") && tB3.flexible_spec[1].work_positions.some((p: { name: string }) => p.name === "Real Estate Broker") && !tB3.flexible_spec[1].work_positions.some((p: { name: string }) => p.name === "Owner") && tB3.flexible_spec[1].interests.some((p: { id: string }) => p.id === "6849417269780") && tB3.flexible_spec[1].interests.some((p: { id: string }) => p.id === "6849945059527") && tB3.flexible_spec[1].work_employers.length === 5 && tB3.geo_locations.regions.length === 2 && !tB3.geo_locations.countries && !tB3.publisher_platforms && !tB3.facebook_positions && !tB3.instagram_positions && !tB3.messenger_positions && !tB3.audience_network_positions && !tB1.geo_locations.countries && !tB1.publisher_platforms);
const b3Summary = summary.campaigns.find((c) => c.key === "office_owners")!.ad_sets[0];
ok("dry run shows the B3 AND groups", b3Summary.flexible_logic === "and" && b3Summary.flexible.length === 2 && b3Summary.flexible[0].map((t) => t.name).join("|") === `${b3Generic.join("|")}|Small business owners` && b3Summary.flexible[1].some((t) => t.name === "Real Estate Broker") && b3Summary.flexible[1].some((t) => t.name === "Residential real estate") && !b3Summary.flexible[0].some((t) => t.name === "Broker Owner" || t.type === "interest"));
ok("B1 flexible is one OR group", tB1.flexible_spec.length === 1 && tB1.age_min === 22);
const overlapped = sanitizeAdSetTargeting({
  geo_locations: { regions: [{ key: "1720" }, { key: "1719" }], countries: ["IL"], country_groups: ["worldwide"] },
  publisher_platforms: ["facebook", "instagram", "messenger", "audience_network"],
  facebook_positions: ["story", "marketplace", "video_feeds"],
  instagram_positions: ["story", "explore", "reels"],
  messenger_positions: ["messenger_home"],
  audience_network_positions: ["classic"],
}, true);
ok("overlapping country and orphan lead placements are dropped", !overlapped.geo_locations.countries && !overlapped.geo_locations.country_groups && overlapped.geo_locations.regions.length === 2 && !overlapped.publisher_platforms && !overlapped.facebook_positions && !overlapped.instagram_positions && !overlapped.messenger_positions && !overlapped.audience_network_positions);
const kept = sanitizeAdSetTargeting({
  geo_locations: { countries: ["IL"] },
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["feed", "story", "marketplace"],
  instagram_positions: ["stream", "story", "reels"],
}, false);
ok("a placement set that includes its parent is kept, and a country alone stays", kept.geo_locations.countries[0] === "IL" && kept.publisher_platforms.join(",") === "facebook,instagram" && kept.facebook_positions.join(",") === "feed,story,marketplace" && kept.instagram_positions.join(",") === "stream,story,reels" && !kept.messenger_positions);
const platformOnly = sanitizeAdSetTargeting({
  publisher_platforms: ["instagram"],
  instagram_positions: ["explore_home"],
  device_platforms: ["mobile"],
}, false);
ok("a platform whose positions were all orphans is removed", !platformOnly.publisher_platforms && !platformOnly.instagram_positions && platformOnly.device_platforms[0] === "mobile");
ok("buyers have no detailed targeting", !tBuy.flexible_spec);
ok("audiences referenced by placeholder", tRt.custom_audiences[0].id === "{{id:audience:site_visitors_30d}}" && tB2.custom_audiences[0].id === "{{id:audience:brokers_site_180d}}");

const housingOps = built.ops.filter((o) => o.kind === "campaign");
ok("housing flag only on housing campaigns", housingOps.map((o) => `${o.objectKey}:${o.body.special_ad_categories}:${o.body.special_ad_category_country || ""}`).join(" | ") ===
  'campaign:brokers:[]: | campaign:brokers_registered:[]: | campaign:office_owners:[]: | campaign:buyers:["HOUSING"]:["IL"] | campaign:retargeting:["HOUSING"]:["IL"]');
ok("ad set budgets in agorot", built.ops.filter((o) => o.kind === "adset").map((o) => o.body.daily_budget).join(",") === "4000,700,1300,1500,1000,800,700,1000");
ok("lead ad sets keep the page and traffic ad sets omit promoted_object", (() => {
  const sets = built.ops.filter((o) => o.kind === "adset");
  const lead = sets.filter((o) => o.body.destination_type === "ON_AD");
  const traffic = sets.filter((o) => o.body.optimization_goal === "LANDING_PAGE_VIEWS");
  return lead.length === 2 && traffic.length === 6
    && lead.every((o) => o.body.promoted_object === JSON.stringify({ page_id: PAGE_ID_EXPECTED }) && !o.body.promoted_object.includes("pixel"))
    && traffic.every((o) => !o.body.promoted_object && !JSON.stringify(o.body).includes(PIXEL_ID) && !o.body.frequency_control_specs);
})());
ok("housing ad sets stay inside the category limits", ["adset:a1", "adset:a2", "adset:a3", "adset:a4", "adset:rt"].every((key) => {
  const op = built.ops.find((o) => o.objectKey === key)!;
  const t = JSON.parse(op.body.targeting);
  const loc = t.geo_locations.custom_locations[0];
  return t.age_min === 18 && t.age_max === 65 && !t.genders && !t.flexible_spec && !t.exclusions && !t.excluded_custom_audiences
    && t.targeting_automation.advantage_audience === 0
    && loc.radius === HOUSING_MIN_RADIUS_KM && loc.distance_unit === "kilometer"
    && !op.body.promoted_object;
}) && built.ops.filter((o) => o.objectKey === "campaign:buyers" || o.objectKey === "campaign:retargeting").every((o) => o.body.special_ad_categories === "[\"HOUSING\"]" && o.body.special_ad_category_country === "[\"IL\"]"));
const a5SetOp = opsOf(withA5).ops.find((o) => o.objectKey === "adset:a5")!;
ok("A5 keeps the page promoted object and the housing limits", (() => {
  const t = JSON.parse(a5SetOp.body.targeting);
  return a5SetOp.body.destination_type === "ON_AD" && a5SetOp.body.promoted_object === JSON.stringify({ page_id: PAGE_ID_EXPECTED })
    && t.age_min === 18 && t.age_max === 65 && !t.flexible_spec && !t.exclusions
    && t.geo_locations.custom_locations[0].radius === 25 && t.geo_locations.custom_locations[0].distance_unit === "kilometer";
})());
function storyOf(body: Record<string, string>) {
  return JSON.parse(body.object_story_spec);
}
function feedOf(body: Record<string, string>) {
  return JSON.parse(body.asset_feed_spec);
}
const badPositions = ["explore", "reels", "facebook_reels", "video_feeds"];
function creativeShapeOk(body: Record<string, string>, lead: boolean) {
  const story = storyOf(body);
  const feed = feedOf(body);
  const rules = JSON.stringify(feed.asset_customization_rules.map((r: { customization_spec: unknown }) => r.customization_spec));
  const hashOk = feed.images.every((img: { hash: string }) => /^\{\{hash:[a-z0-9_]+\}\}$/.test(img.hash));
  const textOk = !!feed.bodies?.[0]?.text && !!feed.titles?.[0]?.text;
  const link = feed.link_urls?.[0]?.website_url || "";
  const leadOk = !lead || (link === "https://fb.me/" && feed.call_to_actions?.[0]?.value?.lead_gen_form_id && !feed.call_to_action_types);
  const trafficOk = lead || (link.startsWith("https://") && feed.call_to_action_types?.[0] === "LEARN_MORE" && !feed.call_to_actions && !JSON.stringify(feed).includes("lead_gen_form_id"));
  return story.page_id === PAGE_ID_EXPECTED && !story.link_data && !story.image_hash && !story.instagram_actor_id
    && !JSON.stringify(body).includes("instagram_actor_id") && !body.degrees_of_freedom_spec
    && feed.optimization_type === "PLACEMENT" && feed.ad_formats?.[0] === "SINGLE_IMAGE" && feed.images.length === 2
    && feed.images[0].adlabels[0].name === "img_feed" && feed.images[1].adlabels[0].name === "img_story"
    && hashOk && textOk && leadOk && trafficOk && feed.asset_customization_rules.length === 2
    && badPositions.every((p) => !rules.includes(p))
    && rules.includes("feed") && rules.includes("story") && !rules.includes("instagram");
}
const creativeOps = built.ops.filter((o) => o.kind === "creative");
ok("every two-image creative is placement feed without link_data", creativeOps.length === 29 && creativeOps.every((c) => {
  const lead = c.objectKey.startsWith("creative:b1_") || c.objectKey.startsWith("creative:oo");
  return creativeShapeOk(c.body, lead);
}));
ok("lead creative uses fb.me and the broker form", (() => {
  const feed = feedOf(built.ops.find((o) => o.objectKey === "creative:b1_1")!.body);
  return feed.link_urls[0].website_url === "https://fb.me/" && feed.call_to_actions[0].type === "SIGN_UP" && feed.call_to_actions[0].value.lead_gen_form_id === BROKER_FORM_ID && !feed.descriptions;
})());
ok("traffic creative uses the landing url", (() => {
  const feed = feedOf(built.ops.find((o) => o.objectKey === "creative:b2_1")!.body);
  return feed.call_to_action_types[0] === "LEARN_MORE" && feed.link_urls[0].website_url.startsWith("https://shuknadlan.co.il") && !feed.descriptions;
})());
ok("a description is labeled on both rules and an empty one is omitted", (() => {
  const withDesc = feedOf(built.ops.find((o) => o.objectKey === "creative:b2_2")!.body);
  const without = feedOf(built.ops.find((o) => o.objectKey === "creative:b1_1")!.body);
  return withDesc.descriptions[0].text === "המנטור AI כלול בכל מסלול"
    && withDesc.asset_customization_rules.every((r: { description_label?: { name: string } }) => r.description_label?.name === "desc")
    && !without.descriptions && without.asset_customization_rules.every((r: { description_label?: unknown }) => !r.description_label);
})());
const a5Creative = opsOf(withA5).ops.find((o) => o.objectKey === "creative:a5_viz")!;
ok("A5 lead creative uses the valuation form", (() => {
  const feed = feedOf(a5Creative.body);
  const story = storyOf(a5Creative.body);
  return creativeShapeOk(a5Creative.body, true) && story.page_id === PAGE_ID_EXPECTED && feed.call_to_actions[0].type === "LEARN_MORE" && feed.call_to_actions[0].value.lead_gen_form_id === VALUATION_FORM_ID && feed.link_urls[0].website_url === "https://fb.me/";
})());
const igOps = collectWriteOps(plan, { pageId: PAGE_ID_EXPECTED, pixelId: PIXEL_ID, regionKeys: REGIONS, termIds: idsFor(plan), instagramUserId: "17841400000000000" });
ok("a numeric instagram id is sent and a page id or junk is omitted", (() => {
  const story = storyOf(igOps.ops.find((o) => o.objectKey === "creative:b1_1")!.body);
  const rules = JSON.stringify(feedOf(igOps.ops.find((o) => o.objectKey === "creative:b1_1")!.body).asset_customization_rules);
  const same = collectWriteOps(plan, { pageId: PAGE_ID_EXPECTED, instagramUserId: PAGE_ID_EXPECTED, regionKeys: REGIONS, termIds: idsFor(plan) });
  const junk = collectWriteOps(plan, { pageId: PAGE_ID_EXPECTED, instagramUserId: "not-an-ig", regionKeys: REGIONS, termIds: idsFor(plan) });
  return story.instagram_user_id === "17841400000000000" && rules.includes("instagram") && !rules.includes("explore")
    && !storyOf(same.ops.find((o) => o.objectKey === "creative:b1_1")!.body).instagram_user_id
    && !storyOf(junk.ops.find((o) => o.objectKey === "creative:b1_1")!.body).instagram_user_id;
})());
ok("sharing flag off and only create paths", built.ops.filter((o) => o.kind === "campaign").every((o) => o.body.is_adset_budget_sharing_enabled === "false") && built.ops.every((o) => ["adimages", "customaudiences", "campaigns", "adsets", "adcreatives", "ads"].includes(o.pathSuffix)));

ok("unresolved region yields no ops", collectWriteOps(plan, { pageId: PAGE_ID_EXPECTED, regionKeys: {}, termIds: idsFor(plan) }).ops.length === 0);
ok("launchWillWrite default is dry-run", launchWillWrite({}) === false && launchWillWrite({ dry_run: false }) === false && launchWillWrite({ confirm: true }) === false && launchWillWrite(undefined) === false && launchWillWrite({ dry_run: false, confirm: true }) === true);

let threw = "";
try { assertSafeWrite(ACT, "campaigns", { name: "x", status: "ACTIVE" }); } catch (e) { threw = (e as Error).message; }
ok("assertSafeWrite rejects ACTIVE", threw === "refusing_non_paused_status");
threw = "";
try { assertSafeWrite(ACT, "campaigns", { name: PROTECTED_CAMPAIGN_IDS[0], status: PAUSED_STATUS }); } catch (e) { threw = (e as Error).message; }
ok("assertSafeWrite rejects the protected campaign id", threw === "refusing_protected_campaign");
threw = "";
try { assertSafeWrite(ACT, "adimages", { bytes: PROTECTED_CAMPAIGN_IDS[0] }); } catch (e) { threw = (e as Error).message; }
ok("image bytes are not scanned for the protected id", threw === "");
threw = "";
try { assertSafeWrite(ACT, "ads", { name: "x", status: PAUSED_STATUS, creative: "{{id:creative:b1_1}}" }); } catch (e) { threw = (e as Error).message; }
ok("unresolved placeholder refused", threw === "unresolved_placeholder");

const manifest = JSON.parse(readFileSync(path.join(root, "marketing/meta-creatives/20261024/manifest.json"), "utf8"));
const withA5Images = new Map(withA5.images.map((i) => [i.path, i.sha256]));
let hashBad = 0;
for (const file of manifest.files) {
  const disk = fileSha(file.path);
  if (disk !== file.sha256) hashBad++;
  if (file.ad) {
    if (withA5Images.get(file.path) !== file.sha256) hashBad++;
  } else if ([...withA5Images.keys()].some((p) => p.includes("contact_sheet"))) hashBad++;
}
ok("manifest sha256 matches the files and the plan", hashBad === 0 && manifest.files.length === 35, hashBad);
ok("sha256Hex matches node", (await sha256Hex(new Uint8Array([1, 2, 3]))) === createHash("sha256").update(Buffer.from([1, 2, 3])).digest("hex"));

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const imageBytes = new Map(plan.images.map((i) => [i.key, png]));

async function runExecute(existing: Map<string, ExistingRow>, postImpl: (path: string, body: Record<string, string>) => Promise<any>) {
  const posted: { path: string; body: Record<string, string> }[] = [];
  const recorded: string[] = [];
  const result = await executeLaunch({
    act: ACT,
    plan,
    pageId: PAGE_ID_EXPECTED,
    pixelId: PIXEL_ID,
    regionKeys: REGIONS,
    termIds: idsFor(plan),
    existing,
    images: imageBytes,
    post: async (p, body) => {
      posted.push({ path: p, body });
      return postImpl(p, body);
    },
    record: async (row) => {
      recorded.push(row.objectKey);
      existing.set(row.objectKey, { metaId: row.metaId, imageHash: row.imageHash });
    },
  });
  return { result, posted, recorded };
}

let n = 0;
const first = await runExecute(new Map(), async (p, body) => {
  n++;
  if (p.endsWith("/adimages")) return { images: { bytes: { hash: "hash_" + n } } };
  if (JSON.stringify(body).includes("ACTIVE") || JSON.stringify(body).includes(PROTECTED_CAMPAIGN_IDS[0]) || body.status && body.status !== PAUSED_STATUS) {
    throw new Error("bad status reached post");
  }
  return { id: "9000000000000" + String(n).padStart(3, "0") };
});
ok("first execute creates every object", first.result.error === undefined && first.result.created.length === 105 && first.posted.length === 105, first.result);
ok("posts stay on create paths and paused", first.posted.every((p) => /^act_\d+\/(adimages|customaudiences|campaigns|adsets|adcreatives|ads)$/.test(p.path)) && first.posted.every((p) => !p.body.status || p.body.status === PAUSED_STATUS) && first.posted.every((p) => !JSON.stringify(p.body).includes("{{")) && first.posted.every((p) => !p.body.execution_options));
ok("a real create still omits the pixel on traffic ad sets", first.posted.filter((p) => p.path.endsWith("/adsets") && p.body.optimization_goal === "LANDING_PAGE_VIEWS").every((p) => !p.body.promoted_object) && first.posted.filter((p) => p.path.endsWith("/adsets") && p.body.destination_type === "ON_AD").every((p) => p.body.promoted_object.includes(PAGE_ID_EXPECTED)));

const filled = new Map<string, ExistingRow>();
for (const op of built.ops) {
  filled.set(op.objectKey, op.kind === "image" ? { imageHash: "hash_kept" } : { metaId: "800000000000000" });
}
const second = await runExecute(filled, async () => { throw new Error("should not post"); });
ok("second execute posts nothing", second.posted.length === 0 && second.result.created.length === 0 && second.result.skipped.length === 105 && !second.result.error, second.result);

const poisoned = new Map<string, ExistingRow>([["campaign:brokers", { metaId: PROTECTED_CAMPAIGN_IDS[0] }]]);
const poison = await runExecute(poisoned, async () => ({ id: "1" }));
ok("stored protected id posts nothing", poison.posted.length === 0 && poison.result.error === "refusing_protected_campaign");

let posts = 0;
const partial = await executeLaunch({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map(),
  images: imageBytes,
  post: async () => {
    posts++;
    if (posts === 3) throw new Error("meta_down");
    return { images: { bytes: { hash: "h" + posts } } };
  },
  record: async () => {},
});
ok("failure stops further creates", partial.error === "meta_down" && partial.created.length === 2 && posts === 3, partial);
ok("the budget keeps 100s under the wall and still answers before the idle timeout", LAUNCH_BUDGET_MS === Math.min(LAUNCH_WALL_LIMIT_MS - 100_000, LAUNCH_IDLE_LIMIT_MS - 25_000) && LAUNCH_WALL_LIMIT_MS - LAUNCH_BUDGET_MS >= 100_000 && LAUNCH_BUDGET_MS < LAUNCH_IDLE_LIMIT_MS);
let budgetTicks = 0;
const budgeted = await executeLaunch({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map(),
  images: imageBytes,
  deadline: 2,
  now: () => ++budgetTicks,
  post: async (p) => {
    if (p.endsWith("/adimages")) return { images: { bytes: { hash: "hb" + budgetTicks } } };
    return { id: "910000000000000" + budgetTicks };
  },
  record: async () => {},
});
ok("a deadline stops before the next post and names the next key", budgeted.done === false && budgeted.error === undefined && budgeted.created.length === 1 && budgeted.nextKey === built.ops[1].objectKey && budgetTicks === 2 && budgeted.created[0] === built.ops[0].objectKey);
const expired = await executeLaunch({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map(),
  images: imageBytes,
  deadline: 0,
  now: () => 0,
  post: async () => { throw new Error("should not post"); },
  record: async () => {},
});
ok("an expired budget posts nothing and stays paused", expired.done === false && expired.created.length === 0 && expired.nextKey === built.ops[0].objectKey && !JSON.stringify(expired).includes("ACTIVE") && !JSON.stringify(expired).includes(PROTECTED_CAMPAIGN_IDS[0]));

const missingRegion = await executeLaunch({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  regionKeys: {},
  termIds: idsFor(plan),
  existing: new Map(),
  images: imageBytes,
  post: async () => { throw new Error("posted"); },
  record: async () => {},
});
ok("unresolved region posts nothing", missingRegion.created.length === 0 && (missingRegion.error || "").includes("region_unresolved"));

const resumed = new Map<string, ExistingRow>();
for (const op of built.ops) {
  if (op.kind === "image" && op.imageKey) resumed.set(op.objectKey, { imageHash: "kept_" + op.imageKey });
}
let resumeN = 0;
const resume = await runExecute(resumed, async (p, body) => {
  const blob = JSON.stringify(body);
  if (p.endsWith("/adimages")) throw new Error("image reposted");
  if (blob.includes("{{")) throw new Error("placeholder left in " + p);
  if (p.endsWith("/adcreatives") && !blob.includes("kept_")) throw new Error("stored hash missing");
  if (blob.includes(PROTECTED_CAMPAIGN_IDS[0])) throw new Error("protected id posted");
  resumeN++;
  return { id: "6100000000000" + String(resumeN).padStart(3, "0") };
});
ok("rerun reuses image hashes and does not reupload", !resume.result.error && resume.posted.length === 73 && resume.result.skipped.length === 32 && resume.posted.every((p) => !p.path.endsWith("/adimages")), resume.result);

class GraphReject extends Error {
  meta: Record<string, unknown>;
  constructor() {
    super("Meta API 400 (code=100, subcode=1815089): Invalid parameter");
    this.meta = {
      message: "Invalid parameter",
      code: 100,
      error_subcode: 1815089,
      error_user_title: "Terms of service not accepted",
      error_user_msg: "You can't run lead ads until your Facebook Page accepts Facebook's Lead Generation Terms of Service.",
      error_data: { blame_field_specs: [["promoted_object"]] },
      fbtrace_id: "trace",
    };
  }
}
const partialExisting = new Map<string, ExistingRow>();
for (const op of built.ops) {
  if (op.kind === "image") partialExisting.set(op.objectKey, { imageHash: "kept" });
  if (op.objectKey === "audience:site_visitors_30d") partialExisting.set(op.objectKey, { metaId: "120251671342660267" });
  if (op.objectKey === "audience:brokers_site_180d") partialExisting.set(op.objectKey, { metaId: "120251671343450267" });
  if (op.objectKey === "campaign:brokers") partialExisting.set(op.objectKey, { metaId: "120251671344150267" });
}
const resumedAtB1 = await runExecute(partialExisting, async () => { throw new GraphReject(); });
ok("rerun resumes at B1 and stores the Meta user fields", resumedAtB1.posted.length === 1 && resumedAtB1.posted[0].path.endsWith("/adsets") && resumedAtB1.posted[0].body.name === "B1 Prospects" && resumedAtB1.posted[0].body.campaign_id === "120251671344150267" && resumedAtB1.posted[0].body.status === PAUSED_STATUS && !resumedAtB1.posted[0].body.execution_options && !JSON.stringify(resumedAtB1.posted[0].body).includes(PROTECTED_CAMPAIGN_IDS[0]) && resumedAtB1.result.failedObjectKey === "adset:b1" && resumedAtB1.result.created.length === 0 && resumedAtB1.result.meta?.error_user_title === "Terms of service not accepted" && resumedAtB1.result.meta?.subcode === 1815089 && JSON.stringify(resumedAtB1.result.meta?.error_data).includes("promoted_object") && formatMetaError(new GraphReject()).includes("Lead Generation Terms") && resumedAtB1.result.request?.name === "B1 Prospects" && !JSON.stringify(resumedAtB1.result.request).includes("access_token") && !("bytes" in (resumedAtB1.result.request || {})), resumedAtB1.result);
const creativeFailExisting = new Map(partialExisting);
const creativeFail = await runExecute(creativeFailExisting, async (p) => {
  if (p.endsWith("/adcreatives")) throw new GraphReject();
  return { id: "700000000000001" };
});
ok("a creative failure logs the sanitized story spec", creativeFail.result.failedObjectKey === "creative:b1_1" && creativeFail.result.request?.object_story_spec && (creativeFail.result.request.object_story_spec as { page_id?: string; link_data?: unknown }).page_id === PAGE_ID_EXPECTED && !(creativeFail.result.request.object_story_spec as { link_data?: unknown }).link_data && (creativeFail.result.request.asset_feed_spec as { images?: { hash?: string }[] }).images?.[0]?.hash === "kept" && !JSON.stringify(creativeFail.result.request).includes("access_token") && !("bytes" in creativeFail.result.request) && creativeFail.posted.some((p) => p.path.endsWith("/adsets")) && creativeFail.posted.filter((p) => p.path.endsWith("/adcreatives")).length === 1, creativeFail.result);

const validatePosts: { path: string; body: Record<string, string> }[] = [];
const rejected = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map([["campaign:brokers", { metaId: "120251671344150267" }]]),
  post: async (p, body) => {
    validatePosts.push({ path: p, body });
    if (body.name === "B1 Prospects") throw new GraphReject();
    return { success: true };
  },
});
const b1Probe = validatePosts.find((p) => p.body.name === "B1 Prospects");
ok("validate_only checks B1 and does not create", rejected.failures.length === 1 && rejected.failures[0].objectKey === "adset:b1" && rejected.failures[0].meta?.error_user_msg?.includes("Lead Generation Terms") && !!b1Probe && b1Probe.body.execution_options === "[\"validate_only\"]" && b1Probe.body.status === PAUSED_STATUS && b1Probe.body.campaign_id === "120251671344150267" && b1Probe.path.endsWith("/adsets") && validatePosts.every((p) => p.body.execution_options === "[\"validate_only\"]") && validatePosts.some((p) => p.path.endsWith("/campaigns")) && !validatePosts.some((p) => p.path.endsWith("/adimages") || p.path.endsWith("/ads")) && !JSON.stringify(validatePosts).includes(PROTECTED_CAMPAIGN_IDS[0]));
const accepted = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map([["campaign:brokers", { metaId: "120251671344150267" }]]),
  post: async (_p, body) => {
    if (body.execution_options !== "[\"validate_only\"]" || body.status !== PAUSED_STATUS) throw new Error("bad validate body");
    if (JSON.stringify(body).includes(PROTECTED_CAMPAIGN_IDS[0])) throw new Error("reach");
    return { success: true };
  },
});
ok("validate_only checks a leads stand-in and reports a traffic ad set with no parent", accepted.failures.length === 0 && accepted.checked.includes("adset:b1") && accepted.checked.includes("adset:b3") && accepted.checked.includes("campaign:brokers_registered") && accepted.skipped.some((s) => s.objectKey === "campaign:brokers" && s.reason === "already_created") && accepted.skipped.some((s) => s.objectKey === "adset:b2" && s.reason === "unchecked:no_matching_paused_campaign") && accepted.skipped.some((s) => s.objectKey === "ad:b1_1" && s.reason.startsWith("unchecked:")));
const standPosts: { path: string; body: Record<string, string> }[] = [];
const stood = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map([
    ["campaign:brokers", { metaId: "120251671344150267" }],
    ["audience:brokers_site_180d", { metaId: "120251671343450267" }],
    ["audience:site_visitors_30d", { metaId: "120251671342660267" }],
  ]),
  accountCampaigns: [
    { id: "120251672204060267", objective: "OUTCOME_TRAFFIC", housing: false, status: PAUSED_STATUS },
    { id: PROTECTED_CAMPAIGN_IDS[0], objective: "OUTCOME_TRAFFIC", housing: true, status: PAUSED_STATUS },
    { id: "120251672300000267", objective: "OUTCOME_TRAFFIC", housing: true, status: PAUSED_STATUS },
  ],
  post: async (p, body) => {
    standPosts.push({ path: p, body });
    if (JSON.stringify(body).includes(PROTECTED_CAMPAIGN_IDS[0])) throw new Error("reach");
    if (body.execution_options !== "[\"validate_only\"]" || body.status !== PAUSED_STATUS) throw new Error("bad validate body");
    return { success: true };
  },
});
const b2Probe = standPosts.find((p) => p.body.name === "B2 Registered");
const a1Probe = standPosts.find((p) => p.body.name === "A1 First apartment");
const a1Target = a1Probe ? JSON.parse(a1Probe.body.targeting) : null;
ok("B2 is validated against a paused traffic campaign and sends no pixel", stood.failures.length === 0 && stood.checked.includes("adset:b2") && !!b2Probe && b2Probe.body.campaign_id === "120251672204060267" && b2Probe.body.optimization_goal === "LANDING_PAGE_VIEWS" && !b2Probe.body.promoted_object && !JSON.stringify(b2Probe.body).includes(PIXEL_ID) && !JSON.stringify(standPosts).includes(PROTECTED_CAMPAIGN_IDS[0]), stood.failures);
ok("a housing ad set is validated only against a housing campaign", stood.checked.includes("adset:a1") && !!a1Probe && a1Probe.body.campaign_id === "120251672300000267" && !a1Probe.body.promoted_object && a1Target.age_min === 18 && a1Target.age_max === 65 && !a1Target.flexible_spec && !a1Target.genders && !a1Target.exclusions && a1Target.geo_locations.custom_locations[0].radius === 25 && a1Target.geo_locations.custom_locations[0].distance_unit === "kilometer");
ok("stand-in ignores Reach, an active campaign, and the wrong category", pickStandInCampaign({ objective: "OUTCOME_TRAFFIC", housing: false }, [
  { id: PROTECTED_CAMPAIGN_IDS[0], objective: "OUTCOME_TRAFFIC", housing: false, status: PAUSED_STATUS },
  { id: "120251671344150267", objective: "OUTCOME_LEADS", housing: false, status: PAUSED_STATUS },
  { id: "120251672204060267", objective: "OUTCOME_TRAFFIC", housing: false, status: PAUSED_STATUS },
]) === "120251672204060267" && pickStandInCampaign({ objective: "OUTCOME_TRAFFIC", housing: true }, [
  { id: "120251672204060267", objective: "OUTCOME_TRAFFIC", housing: false, status: PAUSED_STATUS },
  { id: "120251672300000267", objective: "OUTCOME_TRAFFIC", housing: true, status: "ACTIVE" },
]) === null && pausedCampaignsFromGraph([
  { id: PROTECTED_CAMPAIGN_IDS[0], status: PAUSED_STATUS, objective: "OUTCOME_AWARENESS", special_ad_categories: [] },
  { id: "120251672300000267", status: PAUSED_STATUS, objective: "OUTCOME_TRAFFIC", special_ad_categories: ["HOUSING"] },
  { id: "120251672204060267", status: "ACTIVE", objective: "OUTCOME_TRAFFIC", special_ad_categories: [] },
]).map((c) => c.id).join(",") === "120251672300000267" && knownCampaignsFromLaunch(plan, new Map([["campaign:brokers", { metaId: PROTECTED_CAMPAIGN_IDS[0] }]])).length === 0);

const hashed = new Map<string, ExistingRow>([["campaign:brokers", { metaId: "120251671344150267" }], ["adset:b1", { metaId: "120251671910210267" }]]);
for (const op of built.ops) {
  if (op.kind === "image" && op.imageKey) hashed.set(op.objectKey, { imageHash: "hash" + op.imageKey.length });
}
const previewGets: { path: string; params: Record<string, string> }[] = [];
const previewPosts: string[] = [];
const previewFail = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: hashed,
  post: async (p, body) => {
    previewPosts.push(p);
    if (body.execution_options !== "[\"validate_only\"]") throw new Error("preview posted a real write");
    return { success: true };
  },
  get: async (p, params) => {
    previewGets.push({ path: p, params });
    const spec = JSON.parse(params.creative);
    if (spec.object_story_spec?.link_data || params.ad_format !== "DESKTOP_FEED_STANDARD" || !p.endsWith("/generatepreviews")) {
      throw new Error("bad preview");
    }
    if (spec.object_story_spec.page_id !== PAGE_ID_EXPECTED) throw new Error("page");
    throw Object.assign(new Error("Meta API 400 (code=100, subcode=1443048): Invalid parameter"), {
      meta: { message: "Invalid parameter", code: 100, error_subcode: 1443048, error_user_title: "object_story_spec", error_user_msg: "bad spec", fbtrace_id: "t" },
    });
  },
});
ok("generatepreviews reports each creative and does not create one", previewFail.failures.filter((f) => f.kind === "creative").length === 29 && previewGets.length === 29 && previewGets.every((g) => g.path.endsWith("/generatepreviews") && g.params.ad_format === "DESKTOP_FEED_STANDARD") && previewFail.failures.every((f) => f.kind !== "creative" || (f.request?.object_story_spec as { page_id?: string; link_data?: unknown } | undefined)?.page_id === PAGE_ID_EXPECTED && !(f.request?.object_story_spec as { link_data?: unknown } | undefined)?.link_data) && !previewPosts.some((p) => p.endsWith("/adcreatives")) && previewFail.failures[0].meta?.subcode === 1443048, previewFail.failures.length);
const previewOk = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: hashed,
  post: async () => ({ success: true }),
  get: async (_p, params) => {
    const spec = creativePreviewBody({ object_story_spec: params.creative });
    if (JSON.stringify(spec).includes("link_data")) throw new Error("link_data");
    return { data: [{ body: "<iframe>" }] };
  },
});
ok("a clean preview checks every creative", previewOk.failures.length === 0 && previewOk.checked.filter((k) => k.startsWith("creative:")).length === 29);
const unresolvedPreviewGets: string[] = [];
const unresolvedPreview = await validateLaunchWrites({
  act: ACT,
  plan,
  pageId: PAGE_ID_EXPECTED,
  pixelId: PIXEL_ID,
  regionKeys: REGIONS,
  termIds: idsFor(plan),
  existing: new Map([["campaign:brokers", { metaId: "120251671344150267" }]]),
  post: async () => ({ success: true }),
  get: async (p) => {
    unresolvedPreviewGets.push(p);
    throw new Error("should not preview without a hash");
  },
});
ok("a creative without a stored hash is skipped", unresolvedPreview.failures.length === 0 && unresolvedPreviewGets.length === 0 && unresolvedPreview.skipped.some((s) => s.objectKey === "creative:b1_1" && s.reason.includes("unresolved_hash")));
const sanitized = sanitizeLaunchBody({ object_story_spec: JSON.stringify({ page_id: PAGE_ID_EXPECTED }), bytes: "abc", access_token: "secret", name: "B1-1 FOMO" });
ok("sanitized failure body keeps the spec and drops the token", (sanitized?.object_story_spec as { page_id?: string })?.page_id === PAGE_ID_EXPECTED && sanitized?.name === "B1-1 FOMO" && !("bytes" in (sanitized || {})) && !("access_token" in (sanitized || {})));
let identityGets = 0;
const wrongPage = await resolveLaunchIdentity("999", "17841400000000000", async () => { identityGets++; return { id: "999" }; });
ok("a page id that is not the Afula page is refused before Meta", !!wrongPage.error && wrongPage.error.includes(PAGE_ID_EXPECTED) && identityGets === 0);
const otherPage = await resolveLaunchIdentity(PAGE_ID_EXPECTED, undefined, async () => ({ id: "1", name: "someone" }));
ok("a token that returns another page is refused", !!otherPage.error && otherPage.error.includes("1"));
const linked = await resolveLaunchIdentity(PAGE_ID_EXPECTED, "55555", async () => ({ id: PAGE_ID_EXPECTED, name: "שוק הנדל\"ן של עפולה והסביבה", instagram_business_account: { id: "77777" } }));
ok("the page-linked instagram account replaces a different secret", linked.instagramUserId === "77777" && linked.pageName?.includes("עפולה") && linked.warnings.some((w) => w.includes("77777")) && !linked.warnings.some((w) => /token|secret/i.test(w)));
let identityTries = 0;
const igUnread = await resolveLaunchIdentity(PAGE_ID_EXPECTED, "55555", async (_p, params) => {
  identityTries++;
  if (String(params.fields).includes("instagram")) throw new Error("field");
  return { id: PAGE_ID_EXPECTED, name: "page" };
});
ok("an unreadable instagram field omits the id", !igUnread.error && !igUnread.instagramUserId && igUnread.warnings.some((w) => w.includes("instagram_user_id")) && identityTries === 2);
const noPage = await resolveLaunchIdentity(PAGE_ID_EXPECTED, undefined, async () => { throw new Error("perm"); });
ok("no page access blocks the launch", !!noPage.error && noPage.error.includes("אין גישה") && noPage.error.includes("perm"));

ok("exact targeting match", pickTargetingMatch("Real Estate Agent", [{ id: "1", name: "Other" }, { id: "2", name: "Real Estate Agent" }])?.id === "2");
ok("unrelated first row is not accepted", acceptedTargetingMatch("Owner", [{ id: "9", name: "Florist" }]) === null);
ok("partial match is accepted", acceptedTargetingMatch("RE/MAX Israel", [{ id: "4", name: "RE/MAX Israel Ltd" }])?.id === "4");
ok("punctuation-insensitive employer match", acceptedTargetingMatch("RE/MAX Israel", [{ id: "8", name: "REMAX" }])?.id === "8");
ok("case-insensitive contains", acceptedTargetingMatch("anglo saxon", [{ id: "5", name: "Anglo Saxon Real Estate" }])?.id === "5");
ok("north district matches northern, city does not", acceptedTargetingMatch("Northern District", [
  { key: "city", name: "Haifa", type: "city" },
  { key: "north", name: "North District", type: "region" },
], "region")?.id === "north");
ok("haifa city is not a district", acceptedTargetingMatch("Haifa District", [{ key: "1", name: "Haifa", type: "city" }], "region") === null);
ok("haifa region beats a city of the same area", acceptedTargetingMatch("Haifa District", [
  { key: "city", name: "Haifa", type: "city" },
  { key: "region", name: "Haifa District", type: "region" },
], "region")?.id === "region");
const haifaSpec = targetingSearchSpec("Haifa District", "region");
const employerSpec = targetingSearchSpec("RE/MAX Israel", "work_employer");
const interestSpec = targetingSearchSpec("Madlan", "interest");
const positionSpec = targetingSearchSpec("Broker Owner", "work_position");
const behaviorSpec = targetingSearchSpec("Small business owners", "behavior");
ok("search specs use locale and the documented types", haifaSpec.type === "adgeolocation" && haifaSpec.location_types === '["region"]' && haifaSpec.country_code === "IL" && haifaSpec.locale === "en_US" && employerSpec.type === "adworkemployer" && employerSpec.locale === "en_US" && interestSpec.type === "adinterest" && positionSpec.type === "adworkposition" && behaviorSpec.type === "adTargetingCategory" && behaviorSpec.class === "behaviors");

const seenQueries: string[] = [];
const resolved = await resolveLaunchTargeting(plan, async (params) => {
  if (params.locale !== "en_US") throw new Error("locale");
  if (params.type === "adinterestvalid") return { data: JSON.parse(params.interest_fbid_list).map((id: number) => ({ id: String(id), valid: true })) };
  seenQueries.push(params.q);
  if (params.type === "adgeolocation") {
    if (params.q === "Haifa District") return { data: [{ key: "city", name: "Haifa", type: "city" }] };
    return { data: [{ key: "north", name: "North District", type: "region" }] };
  }
  if (params.q === "RE/MAX Israel" || params.q === "Madlan") return { data: [] };
  if (params.q === "Small business owners") return { data: [{ id: "biz", name: "Small business owner" }] };
  return { data: [{ id: "id-" + params.q.length, name: params.q }] };
});
const office = resolved.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0];
const buyersAfter = resolved.plan.campaigns.find((c) => c.key === "buyers")!.adSets;
const droppedNames = resolved.hits.filter((h) => h.status === "dropped").map((h) => h.query);
ok("optional misses drop and do not block", !resolved.blocksCreate && droppedNames.includes("RE/MAX Israel") && droppedNames.includes("Madlan") && !office.flexible.some((g) => g.some((t) => t.name === "RE/MAX Israel")) && office.flexible.length === 2 && office.flexible[0].every((t) => ["Owner", "Founder", "Managing Director", "Branch Manager", "Franchise Owner", "Small business owners"].includes(t.name)) && office.flexible[1].some((t) => t.name === "Broker Owner") && office.flexible[1].some((t) => t.name === "Residential real estate") && !office.flexible[1].some((t) => t.name === "Owner"));
ok("small business owners matches the singular name", resolved.hits.find((h) => h.query === "Small business owners")?.resolved_name === "Small business owner");
ok("preset interest is not searched", !seenQueries.includes("Residential real estate") && resolved.hits.some((h) => h.query === "Residential real estate" && h.status === "found" && h.id === "6849417269780"));
ok("one missing district falls back to Afula 60km", office.geo.mode === "radius" && office.geo.radiusKm === REGION_FALLBACK_KM && office.geo.radiusKm === 60 && office.geo.points.length === 1 && office.geo.points[0].label === "עפולה" && office.geo.points[0].lat === 32.6078 && resolved.hits.find((h) => h.query === "Haifa District")?.status === "fallback" && resolved.hits.find((h) => h.query === "Northern District")?.status === "found" && resolved.hits.find((h) => h.query === "Northern District")?.id === "north" && resolved.warnings.some((w) => w.includes("60")) && buyersAfter.every((a) => a.geo.mode === "radius" && a.geo.radiusKm === HOUSING_MIN_RADIUS_KM && a.flexible.length === 0));
const fallbackOps = collectWriteOps(resolved.plan, { pageId: PAGE_ID_EXPECTED, pixelId: PIXEL_ID, regionKeys: resolved.regionKeys, termIds: resolved.termIds });
const officeOp = fallbackOps.ops.find((op) => op.objectKey === "adset:b3");
const officeTargeting = JSON.parse(officeOp?.body.targeting || "{}");
ok("fallback ad set writes a radius and no region error", fallbackOps.errors.length === 0 && officeTargeting.geo_locations?.custom_locations?.[0]?.radius === 60 && !officeTargeting.geo_locations?.regions && buyersAfter.every((a) => a.flexible.length === 0));

const both = await resolveLaunchTargeting(plan, async (params) => {
  if (params.type === "adgeolocation") {
    const key = params.q === "Haifa District" ? "haifa" : "north";
    return { data: [{ key, name: params.q, type: "region" }] };
  }
  return { data: [{ id: "1", name: params.q }] };
});
const bothOffice = both.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0];
ok("both districts stay regions", !both.blocksCreate && both.hits.every((h) => h.kind !== "region" || h.status === "found") && bothOffice.geo.mode === "regions" && both.regionKeys["Haifa District"] === "haifa" && both.regionKeys["Northern District"] === "north");

const thrown = await resolveLaunchTargeting(plan, async () => {
  throw new Error("graph down");
});
const thrownOffice = thrown.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0];
ok("a failed search keeps the AND groups and blocks a widened OR", thrown.blocksCreate && thrown.plan.errors.some((e) => e.code === "flexible_and_lost") && thrown.hits.some((h) => h.status === "dropped") && thrown.hits.filter((h) => h.kind === "region").every((h) => h.status === "fallback") && thrownOffice.geo.mode === "radius" && thrownOffice.flexible.length === 2 && thrown.warnings.some((w) => w.includes("חיפוש הטירגוט במטא נכשל")) && thrown.warnings.some((w) => w.includes("בדיקת העניינים")));

const gone = "6003403478883";
const alt = "6003526234370";
const validSpec = interestValiditySpec([gone, "named"]);
ok("interest validity asks by numeric id", validSpec.type === "adinterestvalid" && validSpec.locale === "en_US" && validSpec.interest_fbid_list === `[${Number(gone)},"named"]`);
ok("deprecated parser ignores the suggested alternative", deprecatedInterestIdsFromError({ deprecated_interest_id: gone, alternative_interest_id: alt, suggested_interest: { id: alt } }).join(",") === gone);
ok("nested deprecated interests ignore the alternative object", deprecatedInterestIdsFromError({ deprecated_interests: [{ id: gone, name: "Yad2", alternative: { id: alt, name: "Online advertising" } }] }).join(",") === gone);
ok("string error_data parses only deprecated ids", deprecatedInterestIdsFromError(JSON.stringify({ deprecated_interest_ids: [gone], replacement_id: alt })).join(",") === gone);

const retired = await resolveLaunchTargeting(plan, async (params) => {
  if (params.locale !== "en_US") throw new Error("locale");
  if (params.type === "adinterestvalid") {
    return {
      data: JSON.parse(params.interest_fbid_list).map((id: number) => ({
        id: String(id),
        valid: String(id) !== "6849417269780",
        alternative_id: alt,
        name: "Online advertising",
      })),
    };
  }
  if (params.type === "adgeolocation") {
    const key = params.q === "Haifa District" ? "haifa" : "north";
    return { data: [{ key, name: params.q, type: "region" }] };
  }
  return { data: [{ id: "id-" + (params.q || "").length, name: params.q }] };
});
const retiredB1 = retired.plan.campaigns.find((c) => c.key === "brokers")!.adSets[0];
const retiredB3 = retired.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0];
const retiredBlob = JSON.stringify(retired.termIds) + JSON.stringify(retiredB1.flexible) + JSON.stringify(retiredB3.flexible);
ok("a deprecated preset interest is dropped and Meta's alternative is not used", !retired.blocksCreate && retired.hits.some((h) => h.query === "Residential real estate" && h.status === "deprecated" && h.id === "6849417269780") && !retiredB1.flexible.some((g) => g.some((t) => t.name === "Residential real estate")) && retiredB3.flexible.length === 2 && retiredB3.geo.mode === "regions" && !retiredB3.flexible[1].some((t) => t.name === "Residential real estate") && retiredB3.flexible[1].some((t) => t.name === "Broker Owner") && retired.warnings.some((w) => w.includes("Residential real estate") && w.includes("6849417269780") && w.includes("החלופה") && !w.includes(alt)) && !retiredBlob.includes(alt) && !retiredBlob.includes("6849417269780"));

const emptied = structuredClone(retired.plan);
emptied.ok = true;
emptied.errors = [];
emptied.campaigns.find((c) => c.key === "office_owners")!.adSets[0].flexible = [
  emptied.campaigns.find((c) => c.key === "office_owners")!.adSets[0].flexible[0],
  [{ type: "interest", name: "Residential real estate", id: "6849417269780" }],
];
const lostGroup = omitDeprecatedInterestIds(emptied, { "interest:Residential real estate": "6849417269780" }, ["6849417269780"]);
const lostOffice = lostGroup.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0];
ok("dropping the last interest of an AND group stops and does not widen", !lostGroup.plan.ok && lostGroup.plan.errors.some((e) => e.code === "flexible_and_lost") && lostOffice.flexible.length === 2 && lostOffice.geo.mode === "regions" && lostGroup.names.includes("Residential real estate") && !JSON.stringify(lostGroup.termIds).includes("6849417269780") && !JSON.stringify(lostGroup.termIds).includes(alt));
ok("Yad2 is gone from the package source", !src.includes("Yad2") && !src.includes(gone));

const unchecked = uncheckedLaunchTargeting(plan);
ok("no token leaves regions unchecked and does not invent a radius", unchecked.blocksCreate && unchecked.plan.campaigns.find((c) => c.key === "office_owners")!.adSets[0].geo.mode === "regions" && unchecked.hits.some((h) => h.required && h.status === "unchecked") && unchecked.warnings.some((w) => w.includes("לא מחובר")));

const indexSrc = readFileSync(path.join(root, "supabase/functions/ads-admin/index.ts"), "utf8");
const cronIf = indexSrc.split("\n").find((l) => l.includes("!caller.full") && l.includes("sync_insights")) || "";
ok("action is wired and cron cannot call it", indexSrc.includes('action === "create_paused_launch"') && indexSrc.includes("externalDailyIls: GOOGLE_BUYERS_DAILY_ILS") && cronIf.includes("sync_leads") && !cronIf.includes("create_paused_launch"));
const uploadFn = indexSrc.slice(indexSrc.indexOf("async function actionUploadLaunchCreatives"), indexSrc.indexOf("async function actionCreatePausedLaunch"));
ok("upload action is wired and cron cannot call it", indexSrc.includes('action === "upload_launch_creatives"') && !cronIf.includes("upload_launch_creatives") && !indexSrc.includes("upload_meta_creatives.mjs") && !uploadFn.includes("MetaClient") && !uploadFn.includes("graph.facebook.com"));
const crm = readFileSync(path.join(root, "assets/crm.js"), "utf8");
const crmHtml = readFileSync(path.join(root, "crm.html"), "utf8");
ok("crm sends dry-run and a confirmed write", crm.includes("adsLaunchDry") && crm.includes("dry_run: false") && crm.includes("confirm: true") && crm.includes("create_paused_launch"));
ok("crm shows a partial create and a timeout as a resume", crm.includes("done === false") && crm.includes("אובייקטים, לחץ שוב להמשך מ-") && crm.includes("הבקשה נקטעה בגלל זמן; מה שנוצר נשמר, לחץ שוב להמשך") && crm.includes("launch_in_progress"));
ok("crm uploads from the tab and shows the bucket count", crm.includes("adsLaunchUpload") && crm.includes("upload_launch_creatives") && crm.includes("תמונות בדלי:") && crmHtml.includes('id="adsLaunchUpload"') && !crmHtml.includes("upload_meta_creatives.mjs"));
ok("crm shows each targeting hit and the A5 form", crm.includes("adsLaunchHitLine") && crm.includes("targeting_blocks_create") && crm.includes("טופס:") && crmHtml.includes("הערכת שווי חינם"));
ok("crm shows the AND groups and a validation block", crm.includes("adsLaunchFlexibleLine") && crm.includes("צמצום AND") && crm.includes("blocks_create") && crm.includes("error_user_title") && crm.includes("meta_validation") && crm.includes("לא נבדק מול מטא"));
ok("crm shows a dropped deprecated interest", crm.includes("הוצא משימוש וירד, בלי החלופה של מטא"));
const dryFn = indexSrc.slice(indexSrc.indexOf("if (!launchWillWrite"), indexSrc.indexOf("if (!plan.ok)"));
const writeFn = indexSrc.slice(indexSrc.indexOf("if (!plan.ok)"), indexSrc.indexOf("Deno.serve"));
ok("dry run drops a deprecated interest before a second validation", dryFn.includes("validateLaunchWrites") && dryFn.includes("omitDeprecatedInterestIds") && dryFn.includes("deprecatedInterestIdsFromError") && dryFn.includes("leadgen_tos_accepted") && !dryFn.includes("execution_options") && dryFn.includes("1870247") && dryFn.includes("resolveLaunchIdentity") && dryFn.includes("loadPausedCampaigns") && dryFn.includes("body: first.request"));
ok("the real create probes only to drop a deprecated interest", writeFn.includes("omitDeprecatedInterestIds") && writeFn.includes("deprecatedInterestIdsFromError") && writeFn.includes("validateLaunchWrites") && writeFn.includes("1870247") && writeFn.includes("validate_only_returned_id"));
ok("the real create stops on a failed preview or ad set and logs the body", writeFn.includes("launchPageId") && writeFn.includes("subcode !== 1870247") && writeFn.includes("loadPausedCampaigns") && writeFn.includes("result.request") && writeFn.includes("body: first.request"));
ok("the real create stops inside a time budget and takes one launch lock", writeFn.includes("tryLaunchLock") && writeFn.includes("unlockLaunch") && writeFn.includes("LAUNCH_BUDGET_MS") && writeFn.includes("deadline") && writeFn.includes("done: false") && writeFn.includes("next_key") && writeFn.includes("launch_in_progress") && indexSrc.includes("ads_launch_try_lock") && indexSrc.includes("ads_launch_unlock"));
const validateSrc = src.slice(src.indexOf("export async function validateLaunchWrites"), src.indexOf("export function summarizeLaunch"));
const executeSrc = src.slice(src.indexOf("export async function executeLaunch"), src.indexOf("export async function validateLaunchWrites"));
ok("validate_only stays out of the real create", validateSrc.includes("validate_only") && validateSrc.includes("execution_options:") && validateSrc.includes("generatepreviews") && validateSrc.includes("pickStandInCampaign") && validateSrc.includes("unchecked:no_matching_paused_campaign") && !executeSrc.includes("execution_options:") && !executeSrc.includes("generatepreviews") && !executeSrc.includes("pickStandInCampaign") && !src.includes("instagram_actor_id"));
const prepareFn = indexSrc.slice(indexSrc.indexOf("async function preparePausedLaunch"), indexSrc.indexOf("function creativesPublic"));
ok("create resolves targeting on the dry run and does not abort on a miss", indexSrc.includes("resolveLaunchTargeting") && indexSrc.includes("uncheckedLaunchTargeting") && !indexSrc.includes("לא נמצא טירגוט עבור") && prepareFn.includes("VALUATION_FORM_ID") && prepareFn.includes("SELLERS_FORM_ID") && prepareFn.includes("הערכת שווי") && !prepareFn.includes('eq("kind", "owner")'));

const sampleUrl = creativeSourceUrl(plan.images[0].path);
ok("creative bytes come from the pinned commit", sampleUrl === `https://raw.githubusercontent.com/tomerytz-del/ShukNadlan/${CREATIVE_GIT_COMMIT}/marketing/meta-creatives/${plan.images[0].path}` && !sampleUrl.includes("graph.facebook.com"));
const listed = plan.images.map((image) => ({ path: image.path, size: CREATIVE_BYTES[image.path] }));
const fullStore = creativeStorageReport(plan.images, listed);
ok("full listing is 32 ready", plan.images.length === 32 && fullStore.ready === 32 && fullStore.missing.length === 0 && fullStore.mismatched.length === 0, fullStore);
const emptyStore = creativeStorageReport(plan.images, []);
ok("empty listing is 32 missing", emptyStore.ready === 0 && emptyStore.missing.length === 32 && emptyStore.total === 32);
const wrongStore = creativeStorageReport(plan.images, listed.map((row, n) => n === 0 ? { path: row.path, size: 1 } : row));
ok("one wrong size is mismatched", wrongStore.mismatched.length === 1 && wrongStore.ready === 31 && wrongStore.missing.length === 0);
let byteMiss = 0;
for (const image of withA5.images) {
  const disk = statSync(path.join(root, "marketing", "meta-creatives", image.path)).size;
  if (CREATIVE_BYTES[image.path] !== disk) byteMiss++;
}
ok("every ad image byte length matches the file", byteMiss === 0 && withA5.images.length === 34 && CREATIVE_BYTES["20261024/creatives/contact_sheet_20261024.jpg"] === undefined);

const uploadOut = execFileSync(process.execPath, ["scripts/upload_meta_creatives.mjs"], { cwd: root, encoding: "utf8" });
ok("upload script dry-run prints hashes and does not upload", uploadOut.includes("dry-run:") && uploadOut.includes("5c8a1cb54bc1597ed760eeb405b22d4ad8de7a3aab362016f131b7c8fcb8a6d7") && !uploadOut.includes("UPLOADED") && !/graph\.facebook\.com/.test(uploadOut));

const printable = {
  ok: summary.ok,
  launch_key: summary.launch_key,
  budget: summary.budget,
  skipped: summary.skipped.map((s) => ({ key: s.key, reason: s.reason })),
  audiences: summary.audiences.map((a) => a.name),
  images_to_upload: summary.images_to_upload.length,
  warnings: summary.warnings,
  campaigns: summary.campaigns.map((c) => ({
    name: c.name,
    objective: c.objective,
    housing: c.housing,
    special_ad_categories: c.special_ad_categories,
    status: c.status,
    ad_sets: c.ad_sets.map((a) => ({
      name: a.name,
      status: a.status,
      daily_budget_ils: a.daily_budget_ils,
      age: a.age,
      destination: a.destination,
      lead_form_id: a.lead_form_id,
      geo: a.geo.mode === "radius" ? `radius ${a.geo.radiusKm}km x ${a.geo.points.length}` : a.geo.mode === "regions" ? a.geo.queries.join(", ") : a.geo.mode,
      ads: a.ads.map((ad) => ({
        name: ad.name,
        status: ad.status,
        headline: ad.headline,
        cta: ad.cta,
        landing_url: ad.landing_url,
        images: ad.images.map((i) => `${i.ratio}:${i.sha256.slice(0, 12)}`),
      })),
    })),
  })),
};
console.log("\nDRY_RUN_SUMMARY");
console.log(JSON.stringify(printable, null, 2));

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nall paused-launch checks passed");
