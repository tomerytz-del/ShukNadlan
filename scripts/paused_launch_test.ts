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
  executeLaunch,
  GOOGLE_BUYERS_CAMPAIGN,
  GOOGLE_BUYERS_DAILY_ILS,
  HOUSING_MIN_RADIUS_KM,
  LAUNCH_KEY,
  launchWillWrite,
  OFFICE_FORM_ID,
  PAGE_ID_EXPECTED,
  PAUSED_STATUS,
  pickTargetingMatch,
  PIXEL_ID,
  PROTECTED_CAMPAIGN_IDS,
  sha256Hex,
  summarizeLaunch,
  termsNeedingIds,
  type ExistingRow,
  type LaunchInput,
  type LaunchPlan,
} from "../supabase/functions/ads-admin/launch-package.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACT = "act_1651428663039877";
const OWNER_FORM = "1111222233334444";

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
ok("A5 without a form is an error", !noA5.ok && noA5.errors.some((e) => e.code === "a5_form_missing") && !noA5.campaigns.some((c) => c.key === "owners"));
const withA5 = buildLaunchPlan(baseInput({ includeA5: true, ownerFormId: OWNER_FORM }));
ok("A5 included at the cap", withA5.ok && withA5.budget.totalDailyIls === 150 && withA5.campaigns.some((c) => c.key === "owners" && c.housing && c.objective === "OUTCOME_LEADS"));
ok("A5 appraiser line", withA5.campaigns.find((c) => c.key === "owners")!.adSets[0].ads[0].message.includes("שמאי"));
const overA5 = buildLaunchPlan(baseInput({ includeA5: true, ownerFormId: OWNER_FORM, maxDailyBudget: 149 }));
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
ok("B3 flexible AND and known interest ids", tB3.flexible_spec.length === 2 && JSON.stringify(tB3).includes("6849417269780") && JSON.stringify(tB3).includes("6849945059527") && tB3.geo_locations.regions.length === 2);
ok("B1 flexible is one OR group", tB1.flexible_spec.length === 1 && tB1.age_min === 22);
ok("buyers have no detailed targeting", !tBuy.flexible_spec);
ok("audiences referenced by placeholder", tRt.custom_audiences[0].id === "{{id:audience:site_visitors_30d}}" && tB2.custom_audiences[0].id === "{{id:audience:brokers_site_180d}}");

const housingOps = built.ops.filter((o) => o.kind === "campaign");
ok("housing flag only on housing campaigns", housingOps.map((o) => `${o.objectKey}:${o.body.special_ad_categories}:${o.body.special_ad_category_country || ""}`).join(" | ") ===
  'campaign:brokers:[]: | campaign:brokers_registered:[]: | campaign:office_owners:[]: | campaign:buyers:["HOUSING"]:["IL"] | campaign:retargeting:["HOUSING"]:["IL"]');
ok("ad set budgets in agorot", built.ops.filter((o) => o.kind === "adset").map((o) => o.body.daily_budget).join(",") === "4000,700,1300,1500,1000,800,700,1000");
ok("lead ads point at the form and traffic at the pixel", built.ops.find((o) => o.objectKey === "adset:b1")!.body.destination_type === "ON_AD" && built.ops.find((o) => o.objectKey === "adset:b1")!.body.promoted_object.includes(PAGE_ID_EXPECTED) && built.ops.find((o) => o.objectKey === "adset:a1")!.body.promoted_object.includes(PIXEL_ID) && !built.ops.find((o) => o.objectKey === "adset:a1")!.body.frequency_control_specs);
ok("placement swap lives on the creative", (() => {
  const c = built.ops.find((o) => o.objectKey === "creative:b1_1")!;
  const feed = JSON.parse(c.body.asset_feed_spec);
  return feed.optimization_type === "PLACEMENT" && feed.images.length === 2 && feed.images[0].adlabels[0].name === "img_feed" && feed.images[1].adlabels[0].name === "img_story" && c.body.degrees_of_freedom_spec.includes("OPT_OUT");
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
ok("posts stay on create paths and paused", first.posted.every((p) => /^act_\d+\/(adimages|customaudiences|campaigns|adsets|adcreatives|ads)$/.test(p.path)) && first.posted.every((p) => !p.body.status || p.body.status === PAUSED_STATUS) && first.posted.every((p) => !JSON.stringify(p.body).includes("{{")));

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

ok("exact targeting match", pickTargetingMatch("Real Estate Agent", [{ id: "1", name: "Other" }, { id: "2", name: "Real Estate Agent" }])?.id === "2");
ok("unrelated first row is not accepted", acceptedTargetingMatch("Owner", [{ id: "9", name: "Florist" }]) === null);
ok("partial match is accepted", acceptedTargetingMatch("RE/MAX Israel", [{ id: "4", name: "RE/MAX Israel Ltd" }])?.id === "4");

const indexSrc = readFileSync(path.join(root, "supabase/functions/ads-admin/index.ts"), "utf8");
const cronIf = indexSrc.split("\n").find((l) => l.includes("!caller.full") && l.includes("sync_insights")) || "";
ok("action is wired and cron cannot call it", indexSrc.includes('action === "create_paused_launch"') && indexSrc.includes("externalDailyIls: GOOGLE_BUYERS_DAILY_ILS") && cronIf.includes("sync_leads") && !cronIf.includes("create_paused_launch"));
const uploadFn = indexSrc.slice(indexSrc.indexOf("async function actionUploadLaunchCreatives"), indexSrc.indexOf("async function actionCreatePausedLaunch"));
ok("upload action is wired and cron cannot call it", indexSrc.includes('action === "upload_launch_creatives"') && !cronIf.includes("upload_launch_creatives") && !indexSrc.includes("upload_meta_creatives.mjs") && !uploadFn.includes("MetaClient") && !uploadFn.includes("graph.facebook.com"));
const crm = readFileSync(path.join(root, "assets/crm.js"), "utf8");
const crmHtml = readFileSync(path.join(root, "crm.html"), "utf8");
ok("crm sends dry-run and a confirmed write", crm.includes("adsLaunchDry") && crm.includes("dry_run: false") && crm.includes("confirm: true") && crm.includes("create_paused_launch"));
ok("crm uploads from the tab and shows the bucket count", crm.includes("adsLaunchUpload") && crm.includes("upload_launch_creatives") && crm.includes("תמונות בדלי:") && crmHtml.includes('id="adsLaunchUpload"') && !crmHtml.includes("upload_meta_creatives.mjs"));

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
