// ============================================================================
// קמפיין חיפוש בגוגל מכיוון פרסום (docs/marketing-console.md, שלב 7ג)
//
// ‏buildGooglePlan בונה את כל הקמפיין כבקשת mutate אחת - תקציב, קמפיין
// מושהה, מיקום ושפה, מילות שלילה, קבוצת מודעות, מילות מפתח ומודעה רספונסיבית.
// פונקציה טהורה: בלי רשת, כדי שאפשר יהיה לבדוק אותה ושה-dry_run וההרצה
// יבנו בדיוק את אותו דבר.
//
// ‏**הקמפיין נוצר PAUSED, והמודעה בתוכו ENABLED** - כמו במטא (הסקיל
// marketing-console, סעיף 3): ההפעלה היא לחיצה אחת על הקמפיין, ולא חיפוש
// אחרי מודעה מושהית בתוך קבוצה.
//
// ‏**מיקום: נוכחות בלבד** (‏PRESENCE). ברירת המחדל של גוגל היא "נוכחות או
// עניין", כלומר גם מי שגר/ה בתל אביב וחיפש/ה פעם "עפולה". לגיוס משרדים
// באזור ולחיפוש דירה באזור, זה כסף על הקהל הלא נכון.
// ============================================================================

import { customerPath, type GoogleAdsConfig, LANG_HEBREW, toMicros } from "../_shared/google-ads.ts";
import { type Direction, fillCity } from "./google-directions.ts";

export const SITE_ORIGIN = "https://shuknadlan.co.il";

// תקרות. תקציב יומי עד ₪300 בקריאה אחת: טעות הקלדה (3000 במקום 30) לא
// עוברת. גוגל רשאית להוציא עד פי 2 מהתקציב היומי ביום בודד.
export const LIMITS = {
  budgetMin: 5,
  budgetMax: 300,
  radiusMin: 1,
  radiusMax: 80,
  keywordsMax: 200,
  headlineLen: 30,
  headlinesMin: 3,
  headlinesMax: 15,
  descriptionLen: 90,
  descriptionsMin: 2,
  descriptionsMax: 4,
  keywordLen: 80,
  keywordWords: 10,
};

export type GoogleCampaignInput = {
  direction: Direction;
  market: { slug: string; path: string; city: string; lat: number; lng: number };
  daily_budget: number;
  radius_km: number;
  max_cpc: number | null;
  keywords: string[];
  negatives: string[];
  headlines: string[];
  descriptions: string[];
  stamp: string; // תאריך ושעה לשם הקמפיין - שם כפול נדחה בגוגל
};

export type GooglePlan = {
  name: string;
  final_url: string;
  summary: {
    direction: string;
    label: string;
    daily_budget: number;
    max_monthly: number;
    radius_km: number;
    city: string;
    max_cpc: number | null;
    keywords: string[];
    negatives: string[];
    headlines: string[];
    descriptions: string[];
  };
  operations: unknown[];
};

// תווים שגוגל אינה מקבלת במילת מפתח. מירכאות וסוגריים מרובעים (סימני
// התאמה) מנוקים ולא נדחים - הם מגיעים מההעתקה של רשימת "התאמת ביטוי".
const KW_STRIP = /["\[\]+]/g;
const KW_BAD = /[!@%^*=|;<>~{}]/;

const clean = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ‏final_path: נתיב מלא ("/pricing") או סיומת לדף השוק ("?deal=commercial",
// ‏"#ownerBanner"). ‏UTM לפני ה-hash, אחרת הדפדפן אינו שולח אותו.
export function finalUrl(d: Direction, marketPath: string): string {
  const base = d.landing_in_market ? (marketPath || "/") : "";
  const u = new URL(d.landing_in_market ? base + d.final_path : d.final_path, SITE_ORIGIN);
  u.searchParams.set("utm_source", "google");
  u.searchParams.set("utm_medium", "cpc");
  u.searchParams.set("utm_campaign", d.key);
  return u.toString();
}

export function buildGooglePlan(cfg: GoogleAdsConfig, inp: GoogleCampaignInput): { plan: GooglePlan | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const d = inp.direction;
  const city = inp.market.city;

  const budget = Number(inp.daily_budget);
  if (!(budget >= LIMITS.budgetMin && budget <= LIMITS.budgetMax)) errors.push(`תקציב יומי בין ₪${LIMITS.budgetMin} ל-₪${LIMITS.budgetMax}`);
  const radius = Number(inp.radius_km);
  if (!(radius >= LIMITS.radiusMin && radius <= LIMITS.radiusMax)) errors.push(`רדיוס בין ${LIMITS.radiusMin} ל-${LIMITS.radiusMax} ק"מ`);
  const maxCpc = inp.max_cpc == null || inp.max_cpc === 0 ? null : Number(inp.max_cpc);
  if (maxCpc != null && !(maxCpc > 0 && maxCpc <= 50)) errors.push("מחיר מרבי לקליק בין ₪0.1 ל-₪50, או ריק");
  if (!Number.isFinite(inp.market.lat) || !Number.isFinite(inp.market.lng)) errors.push("לעיר הראשית של השוק אין קואורדינטות");

  // מילות מפתח - התאמת ביטוי.
  const keywords: string[] = [];
  for (const raw of inp.keywords || []) {
    const k = clean(String(raw).replace(KW_STRIP, " "));
    if (!k) continue;
    if (KW_BAD.test(k)) { warnings.push(`המילה "${k}" הוסרה - יש בה תו שגוגל אינה מקבלת`); continue; }
    if (k.length > LIMITS.keywordLen || k.split(" ").length > LIMITS.keywordWords) { warnings.push(`המילה "${k}" הוסרה - ארוכה מדי`); continue; }
    keywords.push(k);
  }
  const kw = uniq(keywords);
  if (!kw.length) errors.push("אין מילות מפתח");
  if (kw.length > LIMITS.keywordsMax) errors.push(`עד ${LIMITS.keywordsMax} מילות מפתח`);

  const negatives = uniq((inp.negatives || []).map((x) => clean(String(x).replace(KW_STRIP, " "))).filter((x) => x && !KW_BAD.test(x)));
  // מילה שהיא גם חיובית וגם שלילית חוסמת את עצמה - גוגל אינה מתריעה על זה.
  for (const n of negatives) {
    const hit = kw.find((k) => k.split(" ").includes(n));
    if (hit) warnings.push(`מילת השלילה "${n}" חוסמת את מילת המפתח "${hit}"`);
  }

  const fit = (list: string[], max: number, what: string) => {
    const out: string[] = [];
    for (const raw of list || []) {
      const t = clean(fillCity(String(raw), city));
      if (!t) continue;
      if (t.length > max) { warnings.push(`${what} "${t}" הוסר/ה - ${t.length} תווים, המקסימום ${max}`); continue; }
      out.push(t);
    }
    return uniq(out);
  };
  const headlines = fit(inp.headlines, LIMITS.headlineLen, "הכותרת").slice(0, LIMITS.headlinesMax);
  const descriptions = fit(inp.descriptions, LIMITS.descriptionLen, "התיאור").slice(0, LIMITS.descriptionsMax);
  if (headlines.length < LIMITS.headlinesMin) errors.push(`לפחות ${LIMITS.headlinesMin} כותרות של עד ${LIMITS.headlineLen} תווים`);
  if (descriptions.length < LIMITS.descriptionsMin) errors.push(`לפחות ${LIMITS.descriptionsMin} תיאורים של עד ${LIMITS.descriptionLen} תווים`);

  if (errors.length) return { plan: null, errors, warnings };

  const cid = customerPath(cfg);
  const budgetRn = `${cid}/campaignBudgets/-1`;
  const campaignRn = `${cid}/campaigns/-2`;
  const adGroupRn = `${cid}/adGroups/-3`;
  const name = `שוק נדלן | ${d.label} | ${city} | ${inp.stamp}`;
  const url = finalUrl(d, inp.market.path);

  const operations: unknown[] = [
    { campaignBudgetOperation: { create: {
      resourceName: budgetRn, name: name + " | תקציב", amountMicros: toMicros(budget),
      deliveryMethod: "STANDARD", explicitlyShared: false,
    } } },
    { campaignOperation: { create: {
      resourceName: campaignRn, name, status: "PAUSED",
      advertisingChannelType: "SEARCH",
      campaignBudget: budgetRn,
      // חיפוש בגוגל בלבד: בלי שותפי החיפוש ובלי רשת המדיה, שבהן התנועה זולה
      // ופחות מתכוונת - בחשבון חדש בלי המרות אין לאלגוריתם במה להבדיל.
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
      // מקסימום קליקים: בחשבון בלי היסטוריית המרות אין על מה להפעיל המרות.
      targetSpend: maxCpc != null ? { cpcBidCeilingMicros: toMicros(maxCpc) } : {},
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    } } },
    { campaignCriterionOperation: { create: {
      campaign: campaignRn,
      proximity: {
        geoPoint: { latitudeInMicroDegrees: Math.round(inp.market.lat * 1e6), longitudeInMicroDegrees: Math.round(inp.market.lng * 1e6) },
        radius: radius, radiusUnits: "KILOMETERS",
      },
    } } },
    { campaignCriterionOperation: { create: { campaign: campaignRn, language: { languageConstant: LANG_HEBREW } } } },
    ...negatives.map((n) => ({ campaignCriterionOperation: { create: { campaign: campaignRn, negative: true, keyword: { text: n, matchType: "BROAD" } } } })),
    { adGroupOperation: { create: { resourceName: adGroupRn, name: d.label, campaign: campaignRn, status: "ENABLED", type: "SEARCH_STANDARD" } } },
    ...kw.map((k) => ({ adGroupCriterionOperation: { create: { adGroup: adGroupRn, status: "ENABLED", keyword: { text: k, matchType: "PHRASE" } } } })),
    { adGroupAdOperation: { create: {
      adGroup: adGroupRn, status: "ENABLED",
      ad: {
        finalUrls: [url],
        responsiveSearchAd: { headlines: headlines.map((text) => ({ text })), descriptions: descriptions.map((text) => ({ text })) },
      },
    } } },
  ];

  return {
    plan: {
      name,
      final_url: url,
      summary: {
        direction: d.key, label: d.label, daily_budget: budget,
        // ההתחייבות של גוגל: בחודש לא יותר מ-30.4 × התקציב היומי.
        max_monthly: Math.round(budget * 30.4),
        radius_km: radius, city, max_cpc: maxCpc,
        keywords: kw, negatives, headlines, descriptions,
      },
      operations,
    },
    errors,
    warnings,
  };
}

// מזהה הקמפיין מתשובת mutate - ‏customers/123/campaigns/456 → 456.
export function createdCampaignId(response: any): string | null {
  for (const r of response?.mutateOperationResponses || []) {
    const rn = r?.campaignResult?.resourceName;
    if (rn) return String(rn).split("/").pop() || null;
  }
  return null;
}
