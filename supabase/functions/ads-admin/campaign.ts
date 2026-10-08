import { MetaClient } from "../_shared/meta-graph.ts";

// ============================================================================
// יצירת קמפיין — הגרסה ב-Deno של ‎.claude/skills/meta-ads/scripts/create_campaign.py‎
// (שלב 5, docs/marketing-console.md)
//
// ‏buildPlan() טהורה: מקבלת את מה ש-index.ts אסף מהמסד (טיוטה, נכס, טופס,
// שורות הגילוי) ומחזירה תוכנית מלאה, שגיאות ואזהרות - בלי רשת. ‏dry_run
// מציג אותה בחלון האישור, ו-execute() יוצרת אותה בדיוק.
//
// ההבדלים מהסקיל, ולמה:
//   - עץ אחד: קמפיין, סט אחד, ומודעה לכל נוסח שנבחר (1-3). זה המבנה
//     שהסקיל ממליץ עליו לתקציב מתחת ל-₪100 ליום (real-estate-creative.md §3).
//   - **הקמפיין PAUSED, הסט והמודעות ACTIVE** - המתג היחיד הוא הקמפיין
//     (המיגרציה 20270314090000 מסבירה למה).
//   - תמונה מגיעה מכתובת (תמונות הנכס, או קובץ באחסון שלנו), לא מדיסק:
//     הפונקציה מורידה אותה ומעלה ל-adimages כ-bytes.
//   - בלי interests ובלי HOUSING: הטירגוט הוא רדיוס בישראל, ומטא אינה
//     מחייבת את הקטגוריה בישראל (real-estate-creative.md §1). אזהרה, לא
//     חסימה, כי זה משתנה אצל מטא ולא אצלנו.
//   - מטבע: ILS בלבד. חשבון במטבע אחר נדחה ב-index.ts, ולא מנוחש.
// ============================================================================

export type Destination = "lead_form" | "whatsapp" | "website";
export type Format = "image" | "carousel";

export const DESTINATIONS: Destination[] = ["lead_form", "whatsapp", "website"];
export const FORMATS: Format[] = ["image", "carousel"];

export type Variant = { angle: string; primary_text: string; headline: string; description: string; cta: string };

export type GeoPoint = { lat: number; lng: number; radius_km: number; label: string };

export type PlanInput = {
  audience: "property" | "platform";
  campaignName: string;
  pageId: string;
  instagramUserId?: string;
  destination: Destination;
  format: Format;
  variants: Variant[];
  disclosure: string;           // השורה שנוספת בסוף הטקסט הראשי של כל מודעה
  images: string[];             // ‏image: הראשונה; carousel: 2-10
  landingUrl?: string;          // ‏website בלבד
  leadFormId?: string;          // ‏lead_form בלבד
  dailyBudget: number;          // שקלים
  endTime?: string;             // ISO
  geo: GeoPoint[];
  ageMin: number;
  ageMax: number;
};

const LEAD_FORM_LINK = "https://fb.me/";
const WHATSAPP_LINK = "https://api.whatsapp.com/send";
const LEAD_FORM_CTAS = new Set(["APPLY_NOW", "DOWNLOAD", "GET_QUOTE", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE"]);
const WEBSITE_CTAS = new Set(["LEARN_MORE", "SIGN_UP", "CONTACT_US", "GET_QUOTE", "APPLY_NOW", "SUBSCRIBE"]);

const DEST: Record<Destination, { objective: string; optimization: string; defaultCta: string }> = {
  website: { objective: "OUTCOME_TRAFFIC", optimization: "LANDING_PAGE_VIEWS", defaultCta: "LEARN_MORE" },
  lead_form: { objective: "OUTCOME_LEADS", optimization: "LEAD_GENERATION", defaultCta: "LEARN_MORE" },
  whatsapp: { objective: "OUTCOME_ENGAGEMENT", optimization: "CONVERSATIONS", defaultCta: "WHATSAPP_MESSAGE" },
};

// תקרות התצוגה (‏meta-ads/references/ad-text-limits.md)
export const CARD_HEADLINE_MAX = 32;
export const HEADLINE_MAX = 40;
export const HOOK_MAX = 125;

// השורה נכנסת בסוף הטקסט, אחרי שורה ריקה. טקסט שכבר נושא אותה אינו מקבל
// אותה פעמיים (נוסח שנערך ביד והשורה הודבקה בו).
export function withDisclosure(primary: string, disclosure: string): string {
  const p = primary.trim();
  if (!disclosure) return p;
  return p.includes(disclosure) ? p : `${p}\n\n${disclosure}`;
}

export function ctaFor(dest: Destination, wanted: string): { cta: string; changed: boolean } {
  if (dest === "whatsapp") return { cta: "WHATSAPP_MESSAGE", changed: wanted !== "WHATSAPP_MESSAGE" };
  const allowed = dest === "lead_form" ? LEAD_FORM_CTAS : WEBSITE_CTAS;
  return allowed.has(wanted) ? { cta: wanted, changed: false } : { cta: DEST[dest].defaultCta, changed: true };
}

export function buildTargeting(geo: GeoPoint[], ageMin: number, ageMax: number) {
  return {
    geo_locations: {
      custom_locations: geo.map((g) => ({
        latitude: Math.round(g.lat * 1e6) / 1e6,
        longitude: Math.round(g.lng * 1e6) / 1e6,
        radius: g.radius_km,
        distance_unit: "kilometer",
      })),
    },
    age_min: ageMin,
    age_max: ageMax,
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed", "story", "video_feeds"],
    instagram_positions: ["stream", "story", "reels"],
    // ‏v26 דורש את השדה במפורש. 1 = מטא רשאית להרחיב מעבר לגיל - הרדיוס
    // הוא המסנן האמיתי, ו-interests רק מצמצמים קהל מקומי קטן ממילא.
    targeting_automation: { advantage_audience: 1 },
  };
}

type CreativePlan = {
  name: string;
  variant: number;
  cta: string;
  message: string;
  headline: string;
  description: string;
  images: string[];
};

export type Plan = {
  campaign: Record<string, unknown>;
  adset: Record<string, unknown>;
  creatives: CreativePlan[];
  summary: {
    destination: Destination;
    format: Format;
    daily_budget: number;
    end_time: string | null;
    days: number | null;
    max_spend: number | null;
    geo: GeoPoint[];
    age: [number, number];
    ads: number;
    images: number;
    landing_url: string | null;
    lead_form_id: string | null;
  };
};

export function buildPlan(inp: PlanInput): { plan: Plan | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const d = DEST[inp.destination];

  if (!inp.pageId) errors.push("page_missing");
  if (!inp.disclosure) errors.push("disclosure_missing");
  if (!inp.variants.length) errors.push("no_variants");
  if (inp.variants.length > 3) errors.push("too_many_variants");
  if (!inp.geo.length) errors.push("no_geo");
  if (inp.destination === "lead_form" && !inp.leadFormId) errors.push("lead_form_required");
  if (inp.destination === "website" && !(inp.landingUrl ?? "").startsWith("https://")) errors.push("landing_url_required");
  if (inp.format === "image" && inp.images.length < 1) errors.push("image_required");
  if (inp.format === "carousel" && inp.images.length < 2) errors.push("carousel_needs_2_images");

  const images = inp.format === "carousel" ? inp.images.slice(0, 10) : inp.images.slice(0, 1);
  const creatives: CreativePlan[] = inp.variants.map((v, i) => {
    const { cta, changed } = ctaFor(inp.destination, v.cta);
    if (changed) warnings.push(`נוסח ${i + 1}: הכפתור הוחלף ל-${cta}, כי ${v.cta || "הכפתור שנבחר"} אינו אפשרי ביעד הזה`);
    const message = withDisclosure(v.primary_text, inp.disclosure);
    const headline = v.headline.trim();
    if (!message.trim() || !headline) errors.push(`variant_${i + 1}_incomplete`);
    if (inp.format === "carousel" && headline.length > CARD_HEADLINE_MAX) {
      // בקרוסלה הכותרת יושבת על כל כרטיס, ומטא חותכת מעל 32 - חיתוך שלנו
      // היה משנה נוסח מאושר בשקט. עדיף לקצר בעורך.
      errors.push(`variant_${i + 1}_headline_too_long_for_carousel`);
    } else if (headline.length > HEADLINE_MAX) {
      warnings.push(`נוסח ${i + 1}: הכותרת ${headline.length} תווים - נחתכת בטלפון מעל ${HEADLINE_MAX}`);
    }
    const firstLine = message.split("\n")[0] ?? "";
    if (firstLine.length > HOOK_MAX) warnings.push(`נוסח ${i + 1}: השורה הראשונה ארוכה מ-${HOOK_MAX} תווים - השאר מתקפל מתחת ל"עוד"`);
    return { name: `v${i + 1}`, variant: i, cta, message, headline, description: v.description.trim(), images };
  });

  for (const g of inp.geo) {
    if (!(g.radius_km >= 1 && g.radius_km <= 80)) errors.push("bad_radius");
    if (!(g.lat > 29 && g.lat < 34 && g.lng > 34 && g.lng < 36.5)) errors.push("geo_outside_israel");
  }
  if (!(inp.ageMin >= 18 && inp.ageMax <= 65 && inp.ageMin <= inp.ageMax)) errors.push("bad_age");
  if (inp.destination === "whatsapp") {
    warnings.push("יעד וואטסאפ: השיחות נפתחות במספר הוואטסאפ שמחובר לדף, ולא נכנסות ל-ads_leads. ודאו שמישהו עונה שם.");
  }

  const days = inp.endTime ? Math.max(1, Math.round((Date.parse(inp.endTime) - Date.now()) / 86_400_000)) : null;
  const plan: Plan = {
    campaign: {
      name: inp.campaignName,
      objective: d.objective,
      status: "PAUSED",
      special_ad_categories: [],
      buying_type: "AUCTION",
    },
    adset: {
      name: `${inp.campaignName} · סט`,
      billing_event: "IMPRESSIONS",
      optimization_goal: d.optimization,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      daily_budget: Math.round(inp.dailyBudget * 100),
      ...(inp.endTime ? { end_time: inp.endTime } : {}),
      targeting: buildTargeting(inp.geo, inp.ageMin, inp.ageMax),
      status: "ACTIVE",
      ...(inp.destination === "lead_form" ? { destination_type: "ON_AD", promoted_object: { page_id: inp.pageId } } : {}),
      ...(inp.destination === "whatsapp" ? { destination_type: "WHATSAPP", promoted_object: { page_id: inp.pageId } } : {}),
    },
    creatives,
    summary: {
      destination: inp.destination,
      format: inp.format,
      daily_budget: inp.dailyBudget,
      end_time: inp.endTime ?? null,
      days,
      max_spend: days ? Math.round(inp.dailyBudget * days) : null,
      geo: inp.geo,
      age: [inp.ageMin, inp.ageMax],
      ads: creatives.length,
      images: images.length,
      landing_url: inp.destination === "website" ? inp.landingUrl ?? null : null,
      lead_form_id: inp.destination === "lead_form" ? inp.leadFormId ?? null : null,
    },
  };
  return { plan: errors.length ? null : plan, errors: [...new Set(errors)], warnings };
}

// object_story_spec לנוסח אחד. ‏hashes - התמונות שהועלו, באותו סדר כמו
// creative.images.
export function storySpec(inp: Pick<PlanInput, "pageId" | "instagramUserId" | "destination" | "format" | "landingUrl" | "leadFormId">,
  c: CreativePlan, hashes: string[]) {
  const link = inp.destination === "website" ? inp.landingUrl! : inp.destination === "lead_form" ? LEAD_FORM_LINK : WHATSAPP_LINK;
  const cta = inp.destination === "lead_form"
    ? { type: c.cta, value: { lead_gen_form_id: inp.leadFormId } }
    : inp.destination === "whatsapp"
    ? { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } }
    : { type: c.cta, value: { link } };

  const ld: Record<string, unknown> = { link, message: c.message, call_to_action: cta };
  if (inp.format === "image") {
    ld.name = c.headline;
    ld.image_hash = hashes[0];
    if (c.description) ld.description = c.description;
  } else {
    ld.child_attachments = hashes.map((h) => ({
      link, name: c.headline, image_hash: h, call_to_action: cta,
      ...(c.description ? { description: c.description } : {}),
    }));
    // סדר התמונות הוא סדר הגלריה של הנכס - התמונה הראשית ראשונה.
    ld.multi_share_optimized = false;
    ld.multi_share_end_card = false;
  }
  const oss: Record<string, unknown> = { page_id: inp.pageId, link_data: ld };
  if (inp.instagramUserId) oss.instagram_user_id = inp.instagramUserId;
  return oss;
}

// ---------------------------------------------------------------------------
// תמונות
//
// ‏index.ts מוודא את המקור (תמונות הנכס מהמסד, או כתובת ברשימת המארחים
// שלנו). כאן: סוג, גודל, והעלאה כ-bytes.
// ---------------------------------------------------------------------------
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function toBase64(buf: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH));
  return btoa(s);
}

export async function uploadImage(meta: MetaClient, act: string, url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!res.ok) throw new Error(`image_fetch_failed ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (type !== "image/jpeg" && type !== "image/png") throw new Error(`image_type_${type || "unknown"}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  const r = await meta.post(`${act}/adimages`, { bytes: toBase64(buf) });
  const first = r?.images ? Object.values(r.images)[0] as any : null;
  if (!first?.hash) throw new Error("image_upload_no_hash");
  return String(first.hash);
}

// ---------------------------------------------------------------------------
// יצירה. ‏record() נקראת אחרי כל אובייקט - ‏index.ts כותב אותה ל-ads_campaigns
// מיד, כדי שעץ חלקי יישאר רשום גם אם הפונקציה נחתכת באמצע.
// ---------------------------------------------------------------------------
export type Created = { type: string; id?: string; hash?: string; name?: string };

export async function execute(
  meta: MetaClient,
  act: string,
  inp: PlanInput,
  plan: Plan,
  record: (o: Created) => Promise<void>,
): Promise<{ campaignId: string; adsetId: string; ads: { ad_id: string; creative_id: string; name: string }[] }> {
  // התמונות קודם: תמונה בסוג שגוי (WebP מייבוא) או שנמחקה היא הכשל הסביר
  // ביותר, ועדיף שייפול לפני שיש קמפיין בחשבון. תמונה שעלתה ואין לה מודעה
  // היא שורה בספרייה, לא הוצאה. כל תמונה עולה פעם אחת לכל הנוסחים.
  const hashOf = new Map<string, string>();
  for (const url of plan.creatives[0]?.images ?? []) {
    if (hashOf.has(url)) continue;
    const h = await uploadImage(meta, act, url);
    hashOf.set(url, h);
    await record({ type: "image", hash: h });
  }

  const camp = await meta.post(`${act}/campaigns`, {
    name: String(plan.campaign.name),
    objective: String(plan.campaign.objective),
    status: "PAUSED",
    special_ad_categories: JSON.stringify(plan.campaign.special_ad_categories),
    buying_type: "AUCTION",
  });
  const campaignId = String(camp.id);
  await record({ type: "campaign", id: campaignId, name: String(plan.campaign.name) });

  const a = plan.adset as Record<string, any>;
  const adsetData: Record<string, string | number> = {
    name: a.name,
    campaign_id: campaignId,
    billing_event: a.billing_event,
    optimization_goal: a.optimization_goal,
    bid_strategy: a.bid_strategy,
    daily_budget: a.daily_budget,
    targeting: JSON.stringify(a.targeting),
    status: "ACTIVE",
  };
  if (a.end_time) adsetData.end_time = a.end_time;
  if (a.destination_type) adsetData.destination_type = a.destination_type;
  if (a.promoted_object) adsetData.promoted_object = JSON.stringify(a.promoted_object);
  const adset = await meta.post(`${act}/adsets`, adsetData);
  const adsetId = String(adset.id);
  await record({ type: "adset", id: adsetId, name: a.name });

  const ads: { ad_id: string; creative_id: string; name: string }[] = [];
  for (const c of plan.creatives) {
    const hashes = c.images.map((u) => hashOf.get(u)!);
    const creative = await meta.post(`${act}/adcreatives`, {
      name: `${plan.campaign.name} · ${c.name}`,
      object_story_spec: JSON.stringify(storySpec(inp, c, hashes)),
      // שיפורי "standard enhancements" משנים את התמונה והטקסט (חיתוך, בהירות,
      // טקסט על התמונה). בנכס זה כבר לא התמונה שהבעלים אישרו.
      degrees_of_freedom_spec: JSON.stringify({ creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } }),
    });
    const creativeId = String(creative.id);
    await record({ type: "creative", id: creativeId, name: c.name });
    const ad = await meta.post(`${act}/ads`, {
      name: `${plan.campaign.name} · ${c.name}`,
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "ACTIVE",
    });
    const adId = String(ad.id);
    await record({ type: "ad", id: adId, name: c.name });
    ads.push({ ad_id: adId, creative_id: creativeId, name: c.name });
  }
  return { campaignId, adsetId, ads };
}
