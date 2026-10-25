// ============================================================================
// חבילת ההשקה 24.10.2026 - קמפיינים מושהים במטא, בלי להפעיל כלום.
//
// ‏create_campaign של הקונסולה משאיר את הסט ואת המודעות ACTIVE בכוונה
// (המתג היחיד הוא הקמפיין). כאן זה הפוך, ובכוונה בנפרד: כל קמפיין, כל סט
// וכל מודעה נוצרים PAUSED, ותומר מדליק אותם בעצמו ב-Ads Manager.
//
// ‏buildLaunchPlan ו-collectWriteOps טהורות. הבדיקה ב-index קוראת ל-Graph
// לחיפוש טירגוט, לזהות הדף, ול-generatepreviews על כל קריאייטיב (GET, בלי
// ליצור). executeLaunch שולח רק את מה שהן בנו, ורק לנתיבי יצירה של חשבון
// המודעות (לא לעדכון של קמפיין קיים).
//
// ‏HOUSING: קונים, שוכרים, משקיעים, ריטרגטינג והערכת שווי. גיוס מתווכים
// ובעלי משרדים אינו מודעת דיור (חבילת ההשקה, ו-ads_rules סעיף ג). הצהרה
// כזו הייתה מוחקת טירגוט תפקידים ומכריחה גיל 18-65. רדיוס דיור הוא 25 ק"מ
// (15 מייל אצל מטא), לא 15.
// ============================================================================

export const LAUNCH_KEY = "q4_20261024";
export const PIXEL_ID = "2269705306930561";
export const PAGE_ID_EXPECTED = "1318798364655572";
export const BROKER_FORM_ID = "4629964190604707";
export const OFFICE_FORM_ID = "2999391313564730";
// טופס הערכת השווי. יש גם טופס owner ישן יותר ("מוכרים נכס - עפולה") ואסור
// ש-A5 ייפול עליו רק כי שניהם kind=owner.
export const VALUATION_FORM_ID = "1644441057276438";
export const VALUATION_FORM_NAME = "הערכת שווי חינם - עפולה";
export const SELLERS_FORM_ID = "29809576818631130";
export const DISCLOSURE_DEFAULT = 'שוק נדל"ן | תומר יצחק, רישיון תיווך 3134355';
export const GOOGLE_BUYERS_DAILY_ILS = 30;
export const GOOGLE_BUYERS_CAMPAIGN = "24350623422";
export const PROTECTED_CAMPAIGN_IDS = ["120251311382930267"];
export const HOUSING_MIN_RADIUS_KM = 25;
export const CREATIVE_BUCKET = "marketing-creatives";
export const PAUSED_STATUS = "PAUSED";

const SITE = "https://shuknadlan.co.il";
const LEAD_LINK = "https://fb.me/";
const HEADLINE_WARN = 40;
const DESCRIPTION_LIMIT = 25;

export type TermType = "interest" | "work_position" | "work_employer" | "behavior";
export type Term = { type: TermType; name: string; id?: string };
export type ImageRatio = "1x1" | "9x16" | "4x5";

export type ImageRef = {
  key: string;
  path: string;
  sha256: string;
  ratio: ImageRatio;
};

export type AudienceDef = {
  key: string;
  name: string;
  kind: "website";
  rule: unknown;
};

export type SkippedItem = {
  key: string;
  reason: string;
  headline?: string;
  message?: string;
};

export type LaunchError = { code: string; detail: string };

export type AdDef = {
  key: string;
  name: string;
  headline: string;
  message: string;
  description?: string;
  cta: string;
  images: ImageRef[];
  landingUrl: string | null;
  leadFormId: string | null;
};

export type AdSetDef = {
  key: string;
  name: string;
  dailyBudgetIls: number;
  destination: "lead_form" | "website";
  leadFormId: string | null;
  leadFormName?: string | null;
  optimization: "LEAD_GENERATION" | "LANDING_PAGE_VIEWS";
  ageMin: number;
  ageMax: number;
  geo:
    | { mode: "radius"; radiusKm: number; points: { label: string; lat: number; lng: number }[] }
    | { mode: "country"; country: "IL" }
    | { mode: "regions"; country: "IL"; queries: string[] };
  // אובייקטים במערך מחוברים ב-AND. בתוך אובייקט, התנאים מחוברים ב-OR.
  flexible: Term[][];
  audienceKeys: string[];
  extraAudienceIds: string[];
  ads: AdDef[];
  notes: string[];
};

export type CampaignDef = {
  key: string;
  name: string;
  objective: "OUTCOME_LEADS" | "OUTCOME_TRAFFIC";
  housing: boolean;
  adSets: AdSetDef[];
};

export type LaunchPlan = {
  ok: boolean;
  launchKey: string;
  campaigns: CampaignDef[];
  audiences: AudienceDef[];
  images: ImageRef[];
  skipped: SkippedItem[];
  warnings: string[];
  errors: LaunchError[];
  budget: {
    metaDailyIls: number;
    googleDailyIls: number;
    googleCampaignId: string;
    totalDailyIls: number;
    maxDailyIls: number;
  };
};

export type LaunchInput = {
  disclosure: string;
  maxDailyBudget: number;
  pageId: string;
  instagramUserId?: string;
  pixelId?: string;
  brokerFormId?: string;
  officeFormId?: string;
  includeA5?: boolean;
  ownerFormId?: string | null;
  ownerFormName?: string | null;
  b2CustomerAudienceId?: string | null;
  externalDailyIls?: number;
};

export type WriteOp = {
  objectKey: string;
  kind: "image" | "audience" | "campaign" | "adset" | "creative" | "ad";
  name: string;
  pathSuffix: "adimages" | "customaudiences" | "campaigns" | "adsets" | "adcreatives" | "ads";
  body: Record<string, string>;
  imageKey?: string;
};

const WRITE_SUFFIXES = new Set(["adimages", "customaudiences", "campaigns", "adsets", "adcreatives", "ads"]);
const STATUS_KINDS = new Set(["campaign", "adset", "ad"]);

// מרכזי ערים לסיכת הרדיוס. עפולה מ-markets.js. השאר מרכז היישוב, לא תיבת השוק.
const NORTH_CITIES = [
  { label: "עפולה", lat: 32.6078, lng: 35.2897 },
  { label: "נצרת", lat: 32.6996, lng: 35.3035 },
  { label: "נוף הגליל", lat: 32.7090, lng: 35.3240 },
  { label: "מגדל העמק", lat: 32.6780, lng: 35.2400 },
  { label: "יקנעם", lat: 32.6596, lng: 35.1100 },
  { label: "בית שאן", lat: 32.4973, lng: 35.4963 },
  { label: "טבריה", lat: 32.7959, lng: 35.5309 },
  { label: "חדרה", lat: 32.4340, lng: 34.9195 },
  { label: "חיפה", lat: 32.7940, lng: 34.9896 },
];

const AFULA = NORTH_CITIES[0];

const INTEREST_RESIDENTIAL: Term = { type: "interest", name: "Residential real estate", id: "6849417269780" };
const INTEREST_COACHING: Term = { type: "interest", name: "Real estate marketing and coaching", id: "6849945059527" };
const INTEREST_BROKER: Term = { type: "interest", name: "Real estate broker" };
const INTEREST_MADLAN: Term = { type: "interest", name: "Madlan" };

const B1_POSITIONS: Term[] = [
  { type: "work_position", name: "Real Estate Agent" },
  { type: "work_position", name: "Real Estate Broker" },
  { type: "work_position", name: "Realtor" },
  { type: "work_position", name: "Real Estate Consultant" },
];
const EMPLOYERS: Term[] = [
  { type: "work_employer", name: "RE/MAX Israel" },
  { type: "work_employer", name: "Anglo Saxon" },
  { type: "work_employer", name: "Century 21 Israel" },
  { type: "work_employer", name: "Keller Williams Israel" },
  { type: "work_employer", name: "Homebox" },
];
// תפקידים כלליים. בקבוצה שלהם לבד, אחרת Owner מתפרש על כל בעל עסק בצפון.
const B3_GENERIC_POSITIONS: Term[] = [
  { type: "work_position", name: "Owner" },
  { type: "work_position", name: "Founder" },
  { type: "work_position", name: "Managing Director" },
  { type: "work_position", name: "Branch Manager" },
  { type: "work_position", name: "Franchise Owner" },
];
const B3_RE_POSITIONS: Term[] = [
  { type: "work_position", name: "Broker Owner" },
  { type: "work_position", name: "Real Estate Broker" },
];
const SMALL_BIZ: Term = { type: "behavior", name: "Small business owners" };

function im(key: string, rel: string, ratio: ImageRatio, sha256: string): ImageRef {
  return { key, path: `20261024/${rel}`, sha256, ratio };
}

const IMG = {
  b1Fomo11: im("b1_fomo_1x1", "creatives/brokers/B1_fomo_live55_match_1x1.png", "1x1", "5c8a1cb54bc1597ed760eeb405b22d4ad8de7a3aab362016f131b7c8fcb8a6d7"),
  b1Fomo916: im("b1_fomo_9x16", "creatives/brokers/B1_fomo_live55_match_9x16.png", "9x16", "e82db380e387004c6ccdcd93cd36b8f88f23c6b3b69a732f7096c7bd7a627023"),
  h11: im("concept_h_1x1", "creative/concept_H_v3_1x1.png", "1x1", "0badea353144ef59ff3c32b13c5602b7ec0dea710e0159a181a8e6f2274a39ff"),
  h45: im("concept_h_4x5", "creative/concept_H_v3_4x5.png", "4x5", "00256edf942873f55bcb22a26da61d28eb27810139dbba240baee6b86d57c200"),
  e11: im("concept_e_1x1", "creative/concept_E_v3_alt32_1x1.png", "1x1", "647f791abe40c557287cefe1c45d8a36558872c6574ab44612f70fee030fb328"),
  e45: im("concept_e_4x5", "creative/concept_E_v3_alt32_4x5.png", "4x5", "36ffebd7fd5e31968dfac05036bdf3649fda6617c8e626c844b9c7abf848d241"),
  g111: im("concept_g1_1x1", "creative/concept_G1_v3_1x1.png", "1x1", "4cba441c9f5f7bd3cf0c5d9a09ecfb383412830fcbdc972832b4df8ce10d818d"),
  g145: im("concept_g1_4x5", "creative/concept_G1_v3_4x5.png", "4x5", "786c095570ddb558d76878638066441dc07f7f78d880050169e418fe209841e2"),
  d11: im("concept_d_1x1", "creative/concept_D_v3_1x1.png", "1x1", "9f217d60cb3bfa7e17d455404eac16352593b7126413a558d03395644a4f41df"),
  d45: im("concept_d_4x5", "creative/concept_D_v3_4x5.png", "4x5", "c65e1da910de1b56eeda9af0c0353b32371d38a9fa509a0757967b22f7b645fe"),
  g211: im("concept_g2_1x1", "creative/concept_G2_v3_1x1.png", "1x1", "7521b353d279cf090764cc52f302431e44cb448aba169d67bc03c174267ad565"),
  g245: im("concept_g2_4x5", "creative/concept_G2_v3_4x5.png", "4x5", "cb1f108d0f133b62cbafb29052b683d94cefe27b7d0d3582d07f66d010774226"),
  oo1_11: im("oo1_1x1", "creatives/office_owners/OO1_dashboard_one_screen_1x1.png", "1x1", "48e4e2afb54dccfb2f1e744a7f0063691874283142bc8039fc24caf43dd583a7"),
  oo1_916: im("oo1_9x16", "creatives/office_owners/OO1_dashboard_one_screen_9x16.png", "9x16", "6401d30fc29074ae250f36bc0db24acb2fdcd9a60ceae82f0bc4e527a75152fa"),
  oo2_11: im("oo2_1x1", "creatives/office_owners/OO2_mentor_weekly_1x1.png", "1x1", "1fdd07fcd0e14f520aab3417cade1cb05fe6e6714775e74767cc397b43022004"),
  oo2_916: im("oo2_9x16", "creatives/office_owners/OO2_mentor_weekly_9x16.png", "9x16", "8fcffd5b632f1f7ea3fbb4ab8f32831e46ef799cca0873e552ad572459c059f8"),
  oo3_11: im("oo3_1x1", "creatives/office_owners/OO3_mentor_gabriela_1x1.png", "1x1", "9baa22b45fae47ef031672dd08a5d82bc13da043f53c34ada4e26b7cc2bc7f9b"),
  oo3_916: im("oo3_9x16", "creatives/office_owners/OO3_mentor_gabriela_9x16.png", "9x16", "de62e24cd48ed78130e5c4f92a22569502a69bb4e4345ebd50f64313d8cae2c1"),
  oo4_11: im("oo4_1x1", "creatives/office_owners/OO4_who_didnt_answer_1x1.png", "1x1", "d03cffdd7877190dc841938b7c778568d823a6e2ef91ec4c6a651027e46ff92e"),
  oo4_916: im("oo4_9x16", "creatives/office_owners/OO4_who_didnt_answer_9x16.png", "9x16", "670eef2d4c5e5f7e085efccd1c5090bb48a29bbe4a6ff56bbc4312806615ae5c"),
  a1_11: im("a1_1x1", "creatives/buyers/A1_first_apartment_viz_1x1.png", "1x1", "85f9bee1dda482989f39a7415889cf40acdbd60f977c2cc0c9bbb6c7e155e750"),
  a1_916: im("a1_9x16", "creatives/buyers/A1_first_apartment_viz_9x16.png", "9x16", "aeaa024e211e206afed4afae81abe80556a5a71e6f191c994af97c333553c3a0"),
  a2_11: im("a2_1x1", "creatives/buyers/A2_upgraders_viz_1x1.png", "1x1", "096e0166ff3b10d864d52b6cf4c2d94b854d0e8e1a90268962d023498fc9fdc4"),
  a2_916: im("a2_9x16", "creatives/buyers/A2_upgraders_viz_9x16.png", "9x16", "3757b2721cf2e9c88093a7a54fe181a8e551cfda26216fa0d0e5307c4d76861d"),
  a3_11: im("a3_1x1", "creatives/buyers/A3_renters_gabriela_1x1.png", "1x1", "70071df155ed13b6bee3728bc14bf9eb545541794b60164fb50c724875efe77f"),
  a3_916: im("a3_9x16", "creatives/buyers/A3_renters_gabriela_9x16.png", "9x16", "ac5f8f3c9f6869213aa5771ae326938a36e3ef4d618e45422420f9186f337dd1"),
  a4_11: im("a4_1x1", "creatives/buyers/A4_investors_prices_1x1.png", "1x1", "e2a11d4c811b70cfe457b0628af8be92a129020c4bcf3305221851e5c2834b40"),
  a4_916: im("a4_9x16", "creatives/buyers/A4_investors_prices_9x16.png", "9x16", "6e4a8c6c5ff456359225e8399c34ca9f8613d648eeb3dfe6336d94779b81ff50"),
  a5_11: im("a5_1x1", "creatives/owners_valuation/A5_owner_viz_1x1.png", "1x1", "21d072144939504cb55837edd085419667cff11c878bbe974c7b904c18cf49ae"),
  a5_916: im("a5_9x16", "creatives/owners_valuation/A5_owner_viz_9x16.png", "9x16", "2adccfa418df709a0aed6a22764b6021a9ada6422cd2cba7fcb837edd7ebb046"),
  rt1_11: im("rt1_1x1", "creatives/retargeting/RT1_back_to_viz_1x1.png", "1x1", "e5ced9f273534e1b1ec01adc8568d268e35ced3906b0938b5373eba31b7c622d"),
  rt1_916: im("rt1_9x16", "creatives/retargeting/RT1_back_to_viz_9x16.png", "9x16", "b17838c2e57dd0c4ac0a7a4c003a47756bb67d42d4a0bde5590a9bc4ecf3415a"),
  rt2_11: im("rt2_1x1", "creatives/retargeting/RT2_saved_search_gabriela_1x1.png", "1x1", "bc001ea04e46602c07d4f2a2bb29177a194266fc1ffd3082670e91f53332d596"),
  rt2_916: im("rt2_9x16", "creatives/retargeting/RT2_saved_search_gabriela_9x16.png", "9x16", "72b1631224922c06ca61d0651ded81050dbeeddd487a45b54bbb8154983ea6ae"),
};

// הקומיט ב-main שבו נחתמו הקבצים (סקווש של #920, אותו עץ כמו
// e489f1aed265f539d0a5f6428cae8f96a78f7bc7). ads-admin מושכת מהם לדלי,
// בלי לאגד 27MB בפונקציה (התקרה 20MB). הכתובת ציבורית; ה-sha256 נבדק לפני השמירה.
export const CREATIVE_GIT_COMMIT = "649ceb8925dc0fe712c31e58287eeabcb5b0a790";
export const CREATIVE_GIT_REPO = "tomerytz-del/ShukNadlan";

export const CREATIVE_BYTES: Record<string, number> = {
  "20261024/creative/concept_D_v3_1x1.png": 344753,
  "20261024/creative/concept_D_v3_4x5.png": 385361,
  "20261024/creative/concept_E_v3_alt32_1x1.png": 302667,
  "20261024/creative/concept_E_v3_alt32_4x5.png": 339002,
  "20261024/creative/concept_G1_v3_1x1.png": 571809,
  "20261024/creative/concept_G1_v3_4x5.png": 781639,
  "20261024/creative/concept_G2_v3_1x1.png": 573327,
  "20261024/creative/concept_G2_v3_4x5.png": 698312,
  "20261024/creative/concept_H_v3_1x1.png": 581021,
  "20261024/creative/concept_H_v3_4x5.png": 692798,
  "20261024/creatives/brokers/B1_fomo_live55_match_1x1.png": 681457,
  "20261024/creatives/brokers/B1_fomo_live55_match_9x16.png": 1084790,
  "20261024/creatives/buyers/A1_first_apartment_viz_1x1.png": 1003550,
  "20261024/creatives/buyers/A1_first_apartment_viz_9x16.png": 1412825,
  "20261024/creatives/buyers/A2_upgraders_viz_1x1.png": 913284,
  "20261024/creatives/buyers/A2_upgraders_viz_9x16.png": 1329100,
  "20261024/creatives/buyers/A3_renters_gabriela_1x1.png": 678706,
  "20261024/creatives/buyers/A3_renters_gabriela_9x16.png": 1093751,
  "20261024/creatives/buyers/A4_investors_prices_1x1.png": 473512,
  "20261024/creatives/buyers/A4_investors_prices_9x16.png": 744875,
  "20261024/creatives/office_owners/OO1_dashboard_one_screen_1x1.png": 740106,
  "20261024/creatives/office_owners/OO1_dashboard_one_screen_9x16.png": 877010,
  "20261024/creatives/office_owners/OO2_mentor_weekly_1x1.png": 677847,
  "20261024/creatives/office_owners/OO2_mentor_weekly_9x16.png": 1069459,
  "20261024/creatives/office_owners/OO3_mentor_gabriela_1x1.png": 672061,
  "20261024/creatives/office_owners/OO3_mentor_gabriela_9x16.png": 968782,
  "20261024/creatives/office_owners/OO4_who_didnt_answer_1x1.png": 314439,
  "20261024/creatives/office_owners/OO4_who_didnt_answer_9x16.png": 606302,
  "20261024/creatives/owners_valuation/A5_owner_viz_1x1.png": 846794,
  "20261024/creatives/owners_valuation/A5_owner_viz_9x16.png": 1241870,
  "20261024/creatives/retargeting/RT1_back_to_viz_1x1.png": 1013719,
  "20261024/creatives/retargeting/RT1_back_to_viz_9x16.png": 1450208,
  "20261024/creatives/retargeting/RT2_saved_search_gabriela_1x1.png": 683227,
  "20261024/creatives/retargeting/RT2_saved_search_gabriela_9x16.png": 1096632,
};

export function creativeSourceUrl(storagePath: string): string {
  const clean = storagePath.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${CREATIVE_GIT_REPO}/${CREATIVE_GIT_COMMIT}/marketing/meta-creatives/${clean}`;
}

export type CreativeStorageReport = {
  total: number;
  ready: number;
  missing: string[];
  mismatched: string[];
};

// אובייקט בלי size נספר כמוכן אם הוא קיים. גודל שונה הוא קובץ אחר.
export function creativeStorageReport(
  images: ImageRef[],
  objects: { path: string; size?: number | null }[],
): CreativeStorageReport {
  const byPath = new Map(objects.map((o) => [o.path, o.size ?? null]));
  const missing: string[] = [];
  const mismatched: string[] = [];
  let ready = 0;
  for (const image of images) {
    if (!byPath.has(image.path)) {
      missing.push(image.path);
      continue;
    }
    const size = byPath.get(image.path);
    const want = CREATIVE_BYTES[image.path];
    if (typeof size === "number" && typeof want === "number" && size !== want) mismatched.push(image.path);
    else ready++;
  }
  return { total: images.length, ready, missing, mismatched };
}

export function launchWillWrite(body: { dry_run?: unknown; confirm?: unknown } | null | undefined): boolean {
  return body?.dry_run === false && body?.confirm === true;
}

export function ensureDisclosure(message: string, disclosure: string): string {
  const p = message.trim();
  const d = disclosure.trim();
  if (!d) return p;
  return p.includes(d) ? p : `${p}\n\n${d}`;
}

export async function sha256Hex(buf: Uint8Array): Promise<string> {
  const copy = new Uint8Array(buf);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasStandaloneCount(text: string, token: string): boolean {
  let from = 0;
  while (from < text.length) {
    const i = text.indexOf(token, from);
    if (i < 0) return false;
    const before = i > 0 ? text[i - 1] : "";
    const after = text[i + token.length] || "";
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    from = i + token.length;
  }
  return false;
}

function siteUrl(path: string, extra: Record<string, string>): string {
  const u = new URL(path, SITE);
  for (const [k, v] of Object.entries(extra)) {
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  }
  return u.toString();
}

const BUYER_UTM = { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "buyers_housing_q4" };
const RT_UTM = { utm_source: "meta", utm_medium: "paid_social" };

function copy(text: string, disclosure: string): string {
  return ensureDisclosure(text, disclosure);
}

function ad(partial: Omit<AdDef, "message"> & { message: string }, disclosure: string): AdDef {
  return { ...partial, message: copy(partial.message, disclosure) };
}

function urlRule(pixelId: string, value: string, days: number) {
  return {
    event_sources: [{ id: pixelId, type: "pixel" }],
    retention_seconds: days * 86400,
    filter: { operator: "and", filters: [{ field: "url", operator: "i_contains", value }] },
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function termKey(t: Term): string {
  return `${t.type}:${t.name}`;
}

export function termsNeedingIds(plan: LaunchPlan): Term[] {
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const c of plan.campaigns) {
    for (const a of c.adSets) {
      for (const group of a.flexible) {
        for (const t of group) {
          if (t.id) continue;
          const k = termKey(t);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }
      }
    }
  }
  return out;
}

export function regionQueries(plan: LaunchPlan): string[] {
  const out: string[] = [];
  for (const c of plan.campaigns) {
    for (const a of c.adSets) {
      if (a.geo.mode === "regions") {
        for (const q of a.geo.queries) if (!out.includes(q)) out.push(q);
      }
    }
  }
  return out;
}

// מטא מחזירה שמות קרובים ("North District", "REMAX") ולפעמים בעברית כשאין
// locale. התאמה רק כשהמחרוזת האנגלית מוכלת מילה-במילה דחתה את כולם, והיצירה
// נעצרה לפני שנכתב משהו. כאן מתאימים בלי רגישות לרישיות ולפיסוק, ומחוז מקבל
// גם וריאציה קרובה. שורה בלי חפיפה (Florist ל-Owner) לא נלקחת.
export type TargetingRow = { id?: string | number; key?: string | number; name?: string; type?: string };

export function compactTargetingName(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// ציון גבוה יותר מנצח, ובשוויון נשארת השורה הראשונה שמטא החזירה.
// השם שמוחזר חייב לחפוף לשאילתה: מוכל, מכיל, אותו טקסט בלי רווחים (RE/MAX
// מול REMAX), או וריאציית מחוז (North מול Northern).
export function targetingScore(query: string, name: string): number {
  const q = compactTargetingName(query);
  const n = compactTargetingName(name);
  if (!q || !n) return 0;
  if (q === n) return 1000;
  if (n.includes(q)) return 800 + q.length;
  if ((q === "northern district" || q === "north district") && (n === "north district" || n === "northern district" || (/\bnorth(ern)?\b/.test(n) && n.includes("district")))) return 700;
  if (q === "haifa district" && (n === "haifa" || (n.includes("haifa") && n.includes("district")))) return 700;
  const qs = q.replace(/ /g, "");
  const ns = n.replace(/ /g, "");
  if (qs.length >= 4 && ns.length >= 4 && (qs === ns || qs.startsWith(ns) || ns.startsWith(qs))) return 500 + Math.min(qs.length, ns.length);
  if (q.includes(n) && n.length >= 4) return 400 + n.length;
  return 0;
}

export function targetingNamesClose(query: string, name: string): boolean {
  return targetingScore(query, name) > 0;
}

export function targetingRows(res: unknown): { id: string; name: string; type: string }[] {
  const data = Array.isArray(res) ? res : (res && typeof res === "object" && Array.isArray((res as { data?: unknown }).data) ? (res as { data: TargetingRow[] }).data : []);
  return data
    .map((r) => ({
      id: String(r?.id || r?.key || ""),
      name: String(r?.name || ""),
      type: String(r?.type || ""),
    }))
    .filter((r) => r.id && r.name);
}

function rowsOfType(rows: TargetingRow[] | unknown, wantType?: string): { id: string; name: string; type: string }[] {
  const clean = targetingRows(rows);
  if (!wantType) return clean;
  const typed = clean.filter((r) => r.type);
  if (!typed.length) return clean;
  return clean.filter((r) => r.type.toLowerCase() === wantType.toLowerCase());
}

export function pickTargetingMatch(query: string, rows: TargetingRow[] | unknown, wantType?: string): { id: string; name: string } | null {
  let best: { id: string; name: string } | null = null;
  let bestScore = 0;
  for (const row of rowsOfType(rows, wantType)) {
    const score = targetingScore(query, row.name);
    if (score > bestScore) {
      bestScore = score;
      best = { id: row.id, name: row.name };
    }
  }
  return best;
}

export function acceptedTargetingMatch(query: string, rows: TargetingRow[] | unknown, wantType?: string): { id: string; name: string } | null {
  const m = pickTargetingMatch(query, rows, wantType);
  if (!m || !targetingNamesClose(query, m.name)) return null;
  return m;
}

export const SEARCH_TYPE: Record<TermType, { type: string; class?: string }> = {
  interest: { type: "adinterest" },
  work_position: { type: "adworkposition" },
  work_employer: { type: "adworkemployer" },
  behavior: { type: "adTargetingCategory", class: "behaviors" },
};

// אותה גרסת Graph ואותו טוקן כמו שאר ads-admin. locale קובע את שם המחוז
// ("Haifa District" ולא "מחוז חיפה"). בלי זה כל החיפושים נראים ככישלון.
export const TARGETING_LOCALE = "en_US";
export const REGION_FALLBACK_KM = 60;

// אימות מזהי עניין שכבר נמצאו. interest_fbid_list ולא שם, כי שם משתנה.
// valid:false יורד. שדה חלופה בתשובה לא נקרא ולא נשלח.
export function interestValiditySpec(ids: string[]): Record<string, string> {
  // מזהה מספרי, כמו בדוגמה של Marketing API. מחרוזת בתוך ה-JSON נדחית.
  const list = ids.map((id) => /^\d{5,16}$/.test(id) ? Number(id) : id);
  return {
    type: "adinterestvalid",
    interest_fbid_list: JSON.stringify(list),
    locale: TARGETING_LOCALE,
  };
}

export function invalidInterestIds(res: unknown, known: { id: string; name: string }[]): Set<string> {
  const data = Array.isArray(res)
    ? res
    : (res && typeof res === "object" && Array.isArray((res as { data?: unknown }).data) ? (res as { data: unknown[] }).data : []);
  const invalid = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const r = row as { id?: unknown; name?: unknown; valid?: unknown };
    if (r.valid !== false) continue;
    const id = r.id != null && String(r.id) ? String(r.id) : "";
    if (id) {
      invalid.add(id);
      continue;
    }
    const name = String(r.name || "").toLowerCase();
    const hit = known.find((k) => k.name.toLowerCase() === name);
    if (hit) invalid.add(hit.id);
  }
  return invalid;
}

const DEPRECATED_ID_KEYS = new Set(["deprecated_interest_id", "deprecated_interest_ids"]);

function asJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return value;
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
}

// מזהים שמטא אומרת שהוצאו משימוש. מפתח של חלופה (alternative / suggestion)
// לא נאסף, כדי שלא יוחלף עניין ב"Online advertising" וכדומה.
export function deprecatedInterestIdsFromError(errorData: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown, key: string | null): void => {
    node = asJson(node);
    if (typeof node === "string" || typeof node === "number") {
      if (key && DEPRECATED_ID_KEYS.has(key)) {
        const id = String(node);
        if (/^\d{5,25}$/.test(id)) ids.add(id);
      }
      return;
    }
    if (Array.isArray(node)) {
      if (key === "deprecated_interests") {
        for (const item of node) {
          if (!item || typeof item !== "object") continue;
          const id = String((item as { id?: unknown; deprecated_interest_id?: unknown }).deprecated_interest_id ?? (item as { id?: unknown }).id ?? "");
          if (/^\d{5,25}$/.test(id)) ids.add(id);
        }
        return;
      }
      if (key && DEPRECATED_ID_KEYS.has(key)) {
        for (const item of node) walk(item, key);
        return;
      }
      for (const item of node) walk(item, key);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/alternative|suggest|replacement/i.test(k)) continue;
      walk(v, k);
    }
  };
  walk(errorData, null);
  return [...ids];
}

export function targetingSearchSpec(query: string, kind: TermType | "region"): Record<string, string> {
  if (kind === "region") {
    return {
      type: "adgeolocation",
      location_types: JSON.stringify(["region"]),
      country_code: "IL",
      q: query,
      locale: TARGETING_LOCALE,
      limit: "25",
    };
  }
  const spec = SEARCH_TYPE[kind];
  const params: Record<string, string> = {
    type: spec.type,
    q: query,
    locale: TARGETING_LOCALE,
    limit: "25",
  };
  if (spec.class) params.class = spec.class;
  return params;
}

export type TargetingHitStatus = "found" | "dropped" | "deprecated" | "fallback" | "missing" | "unchecked";

export type TargetingHit = {
  kind: "term" | "region";
  query: string;
  term_type: string;
  required: boolean;
  status: TargetingHitStatus;
  id: string | null;
  resolved_name: string | null;
};

export type TargetingResolution = {
  plan: LaunchPlan;
  hits: TargetingHit[];
  termIds: Record<string, string>;
  regionKeys: Record<string, string>;
  warnings: string[];
  blocksCreate: boolean;
};

export function planTargetingTerms(plan: LaunchPlan): Term[] {
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const c of plan.campaigns) {
    for (const a of c.adSets) {
      for (const group of a.flexible) {
        for (const t of group) {
          const k = termKey(t);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(t);
        }
      }
    }
  }
  return out;
}

function hitBlocksCreate(h: TargetingHit): boolean {
  return h.required && (h.status === "missing" || h.status === "unchecked");
}

// מחוז חסר מחליף את הסט כולו ברדיוס. תפקיד, מעסיק או עניין בלי התאמה יורד
// מהקבוצה. קבוצה שהתרוקנה יורדת, כדי שלא יישלח flexible_spec ריק.
export function applyResolvedTargeting(plan: LaunchPlan, termIds: Record<string, string>, regionKeys: Record<string, string>, excludeKeys: Set<string> = new Set()): LaunchPlan {
  let andLost = false;
  const campaigns = plan.campaigns.map((c) => ({
    ...c,
    adSets: c.adSets.map((a) => {
      let geo = a.geo;
      if (geo.mode === "regions" && geo.queries.some((q) => !regionKeys[q])) {
        geo = { mode: "radius", radiusKm: REGION_FALLBACK_KM, points: [AFULA] };
      }
      const flexible = a.flexible
        .map((group) => group.filter((t) => !excludeKeys.has(termKey(t)) && !!(t.id || termIds[termKey(t)])))
        .filter((group) => group.length > 0);
      // שתי קבוצות הן AND. קבוצה שנעלמת משאירה OR רחב (כל Owner, או כל
      // מי שמתעניין בנדל"ן). שומרים את המבנה המקורי וסוגרים את היצירה.
      if (a.flexible.length >= 2 && flexible.length < 2) {
        andLost = true;
        return { ...a, geo, flexible: a.flexible };
      }
      return { ...a, geo, flexible };
    }),
  }));
  if (!andLost) return { ...plan, campaigns };
  return {
    ...plan,
    ok: false,
    campaigns,
    errors: [...plan.errors, {
      code: "flexible_and_lost",
      detail: "צמצום ה-AND של בעלי המשרדים נשבר כי קבוצה שלמה לא נמצאה במטא. לא נוצר סט שמרחיב את הקהל.",
    }],
  };
}

function resolutionFromHits(plan: LaunchPlan, hits: TargetingHit[], searchFailed: boolean, validityFailed = false): TargetingResolution {
  const termIds: Record<string, string> = {};
  const regionKeys: Record<string, string> = {};
  for (const h of hits) {
    if (h.kind === "term" && h.status === "found" && h.id) termIds[`${h.term_type}:${h.query}`] = h.id;
    if (h.kind === "region" && h.status === "found" && h.id) regionKeys[h.query] = h.id;
  }
  const dropped = hits.filter((h) => h.kind === "term" && h.status === "dropped");
  const deprecated = hits.filter((h) => h.kind === "term" && h.status === "deprecated");
  const regionMisses = hits.filter((h) => h.kind === "region" && h.status !== "found");
  const warnings: string[] = [];
  if (dropped.length) warnings.push(`לא נמצא במטא וירד מהטירגוט: ${dropped.map((h) => h.query).join(", ")}.`);
  if (deprecated.length) warnings.push(`עניין שהוצא משימוש וירד מהטירגוט: ${deprecated.map((h) => `${h.query} (${h.id})`).join(", ")}. החלופה שמטא מציעה לא נלקחת.`);
  const exclude = new Set([...dropped, ...deprecated].map((h) => `${h.term_type}:${h.query}`));
  if (regionMisses.length) {
    warnings.push('מחוז חיפה או מחוז הצפון לא נמצאו. הסט עובר לרדיוס 60 ק"מ סביב עפולה, שמכסה את הצפון וחיפה.');
  }
  if (searchFailed) warnings.push("חיפוש הטירגוט במטא נכשל. מה שלא נמצא ירד, והמחוזות שלא נמצאו הוחלפו ברדיוס.");
  if (validityFailed) warnings.push("בדיקת העניינים מול מטא נכשלה. עניין שהוצא משימוש עלול לעצור את האימות.");
  const applied = regionMisses.some((h) => h.status === "unchecked" || h.status === "missing")
    ? plan
    : applyResolvedTargeting(plan, termIds, regionKeys, exclude);
  return {
    plan: applied,
    hits,
    termIds,
    regionKeys,
    warnings,
    blocksCreate: hits.some(hitBlocksCreate) || applied.errors.some((e) => e.code === "flexible_and_lost"),
  };
}

// אחרי validate_only שחזר 1870247. מוריד את המזהים מהתוכנית שכבר נפתרה,
// בלי לגעת בגיאוגרפיה ובלי להכניס את החלופה.
export function omitDeprecatedInterestIds(plan: LaunchPlan, termIds: Record<string, string>, ids: string[]): { plan: LaunchPlan; termIds: Record<string, string>; names: string[] } {
  const drop = new Set(ids);
  const names: string[] = [];
  const exclude = new Set<string>();
  const nextIds = { ...termIds };
  for (const [k, id] of Object.entries(termIds)) {
    if (!k.startsWith("interest:") || !drop.has(id)) continue;
    delete nextIds[k];
    exclude.add(k);
    names.push(k.slice("interest:".length));
  }
  for (const c of plan.campaigns) {
    for (const a of c.adSets) {
      for (const group of a.flexible) {
        for (const t of group) {
          if (t.type === "interest" && t.id && drop.has(t.id)) {
            exclude.add(termKey(t));
            delete nextIds[termKey(t)];
            if (!names.includes(t.name)) names.push(t.name);
          }
        }
      }
    }
  }
  if (!exclude.size) return { plan, termIds, names: [] };
  let andLost = false;
  const campaigns = plan.campaigns.map((c) => ({
    ...c,
    adSets: c.adSets.map((a) => {
      const before = a.flexible.length;
      const flexible = a.flexible
        .map((group) => group.filter((t) => !exclude.has(termKey(t))))
        .filter((group) => group.length > 0);
      if (before >= 2 && flexible.length < 2) {
        andLost = true;
        return { ...a };
      }
      return { ...a, flexible };
    }),
  }));
  if (!andLost) return { plan: { ...plan, campaigns }, termIds: nextIds, names };
  return {
    plan: {
      ...plan,
      ok: false,
      campaigns,
      errors: [...plan.errors, {
        code: "flexible_and_lost",
        detail: "צמצום ה-AND של בעלי המשרדים נשבר כי קבוצה שלמה לא נמצאה במטא. לא נוצר סט שמרחיב את הקהל.",
      }],
    },
    termIds: nextIds,
    names,
  };
}

async function mapPool<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(width, items.length);
  if (n) await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

// קריאה בלבד. כישלון של חיפוש אחד לא מפיל את השאר: תפקיד שלא נמצא יורד,
// ומחוז שלא נמצא עובר לרדיוס. אין כאן כתיבה למטא.
export async function resolveLaunchTargeting(
  plan: LaunchPlan,
  search: (params: Record<string, string>) => Promise<unknown>,
): Promise<TargetingResolution> {
  let searchFailed = false;
  let validityFailed = false;
  async function lookup(params: Record<string, string>) {
    try {
      return await search(params);
    } catch {
      searchFailed = true;
      return { data: [] };
    }
  }
  const termHits = await mapPool(planTargetingTerms(plan), 4, async (term): Promise<TargetingHit> => {
    if (term.id) {
      return { kind: "term", query: term.name, term_type: term.type, required: false, status: "found", id: term.id, resolved_name: term.name };
    }
    const match = acceptedTargetingMatch(term.name, await lookup(targetingSearchSpec(term.name, term.type)));
    if (!match) {
      return { kind: "term", query: term.name, term_type: term.type, required: false, status: "dropped", id: null, resolved_name: null };
    }
    return { kind: "term", query: term.name, term_type: term.type, required: false, status: "found", id: match.id, resolved_name: match.name };
  });
  const interestHits = termHits.filter((h) => h.term_type === "interest" && h.status === "found" && h.id);
  if (interestHits.length) {
    try {
      const known = interestHits.map((h) => ({ id: h.id!, name: h.query }));
      const invalid = invalidInterestIds(await search(interestValiditySpec(known.map((k) => k.id))), known);
      for (const h of termHits) {
        if (h.term_type === "interest" && h.id && invalid.has(h.id)) h.status = "deprecated";
      }
    } catch {
      validityFailed = true;
    }
  }
  const regionHits = await mapPool(regionQueries(plan), 4, async (query): Promise<TargetingHit> => {
    const match = acceptedTargetingMatch(query, await lookup(targetingSearchSpec(query, "region")), "region");
    if (!match) {
      return { kind: "region", query, term_type: "region", required: true, status: "fallback", id: null, resolved_name: null };
    }
    return { kind: "region", query, term_type: "region", required: true, status: "found", id: match.id, resolved_name: match.name };
  });
  const foundRegions = regionHits.filter((h) => h.status === "found");
  const missedRegions = regionHits.filter((h) => h.status !== "found");
  // מחוז אחד בלי השני לא מכסה את הצפון. הסט עובר לרדיוס, והמחוז שנמצא
  // נשאר מסומן כנמצא כדי שיהיה גלוי מה Graph החזיר.
  const hits = missedRegions.length ? [...termHits, ...regionHits.map((h) => h.status === "found" ? h : { ...h, status: "fallback" as const })] : [...termHits, ...foundRegions];
  return resolutionFromHits(plan, hits, searchFailed, validityFailed);
}

// בלי טוקן אין חיפוש ואין גיבוי שקט. המחוזות נשארים לא נבדקים, והכפתור סגור.
export function uncheckedLaunchTargeting(plan: LaunchPlan): TargetingResolution {
  const hits: TargetingHit[] = [
    ...planTargetingTerms(plan).map((t): TargetingHit => ({
      kind: "term",
      query: t.name,
      term_type: t.type,
      required: false,
      status: t.id ? "found" : "unchecked",
      id: t.id ?? null,
      resolved_name: t.id ? t.name : null,
    })),
    ...regionQueries(plan).map((query): TargetingHit => ({
      kind: "region",
      query,
      term_type: "region",
      required: true,
      status: "unchecked",
      id: null,
      resolved_name: null,
    })),
  ];
  return {
    plan,
    hits,
    termIds: {},
    regionKeys: {},
    warnings: ["חשבון המודעות לא מחובר, אז הטירגוט לא נבדק. יצירה נשארת סגורה."],
    blocksCreate: true,
  };
}

function housingGeo() {
  return { mode: "radius" as const, radiusKm: HOUSING_MIN_RADIUS_KM, points: [AFULA] };
}

function brokerGeo() {
  return { mode: "radius" as const, radiusKm: 15, points: NORTH_CITIES };
}

export function buildLaunchPlan(input: LaunchInput): LaunchPlan {
  const disclosure = input.disclosure.trim();
  const pixelId = input.pixelId || PIXEL_ID;
  const brokerForm = input.brokerFormId || BROKER_FORM_ID;
  const officeForm = input.officeFormId || OFFICE_FORM_ID;
  const googleDaily = input.externalDailyIls ?? GOOGLE_BUYERS_DAILY_ILS;
  const warnings: string[] = [];
  const errors: LaunchError[] = [];
  const skipped: SkippedItem[] = [];

  if (!disclosure) errors.push({ code: "disclosure_missing", detail: "שורת הגילוי ריקה ב-ads_settings. לא נוצרת מודעה בלעדיה." });
  if (!input.pageId) errors.push({ code: "page_missing", detail: "חסר מזהה דף הפייסבוק (FACEBOOK_PAGE_ID)." });
  if (disclosure && disclosure !== DISCLOSURE_DEFAULT) {
    warnings.push("שורת הגילוי בהגדרות שונה מהשורה שבנוסחים. היא נוספת בסוף כל מודעה, והשורה המקורית נשארת.");
  }

  const D = disclosure || DISCLOSURE_DEFAULT;

  const audiences: AudienceDef[] = [
    {
      key: "site_visitors_30d",
      name: "SN | Site visitors 30d",
      kind: "website",
      rule: {
        inclusions: { operator: "or", rules: [urlRule(pixelId, "shuknadlan.co.il", 30)] },
        exclusions: { operator: "or", rules: [urlRule(pixelId, "/crm", 180)] },
      },
    },
    {
      key: "brokers_site_180d",
      name: "SN | Brokers site 180d",
      kind: "website",
      rule: {
        inclusions: {
          operator: "or",
          rules: [urlRule(pixelId, "/crm", 180), urlRule(pixelId, "/pricing", 180)],
        },
      },
    },
  ];

  const b2Extra = (input.b2CustomerAudienceId ?? "").trim();
  if (b2Extra && !/^\d{5,25}$/.test(b2Extra)) {
    errors.push({ code: "bad_audience_id", detail: "מזהה קהל הלקוחות של B2 צריך להיות מספר של מטא." });
  }
  if (!b2Extra) {
    warnings.push("B2 בלי רשימת 55 המתווכים. הרשימה נוצרת ידנית ב-Ads Manager (טלפון ומייל, SHA256) ומועברת כ-b2_customer_audience_id. בינתיים הקהל הוא מבקרי /crm ו-/pricing ב-180 יום.");
  }
  warnings.push("אם קהל B2 קטן מסף ההרצה, האלטרנטיבה היא Page/IG engagers ל-365 יום. היא לא נוצרת כאן.");
  warnings.push(`קמפיין ה-Reach ${PROTECTED_CAMPAIGN_IDS[0]} לא נקרא ולא משתנה. לפני שמפעילים את מודעות הקונים משהים אותו ב-Ads Manager, אחרת ₪50 שלו מצטרפים לתקרה.`);
  warnings.push("בריטרגטינג לעקוב אחרי תדירות (עד כ-3 בשבוע). מכסת תדירות לא נשלחת ב-API.");
  warnings.push("אירועי Lead ו-ViewContent עדיין לא נשלחים מהפיקסל, ולכן אי אפשר להחריג ממירים. ההחרגה היחידה בקהל האתר היא כתובת שמכילה /crm.");

  const b1 = (key: string, name: string, headline: string, message: string, images: ImageRef[]): AdDef =>
    ad({ key, name, headline, message, cta: "SIGN_UP", images, landingUrl: null, leadFormId: brokerForm }, D);

  const campaigns: CampaignDef[] = [
    {
      key: "brokers",
      name: "SN | Brokers | Leads | Q4",
      objective: "OUTCOME_LEADS",
      housing: false,
      adSets: [{
        key: "b1",
        name: "B1 Prospects",
        dailyBudgetIls: 40,
        destination: "lead_form",
        leadFormId: brokerForm,
        optimization: "LEAD_GENERATION",
        ageMin: 22,
        ageMax: 65,
        geo: brokerGeo(),
        flexible: [[...B1_POSITIONS, ...EMPLOYERS, INTEREST_RESIDENTIAL, INTEREST_COACHING, INTEREST_BROKER, INTEREST_MADLAN]],
        audienceKeys: [],
        extraAudienceIds: [],
        notes: ["Advantage+ Audience כבוי. לא מחריגים מתווכים רשומים. מיקומים Advantage+."],
        ads: [
          b1("b1_1", "B1-1 FOMO", "55 מתווכים כבר כאן. ואתה?",
            "55 מתווכים ו-32 משרדים מהצפון כבר עובדים בשוק נדל\"ן.\n120 נכסים פתוחים לשיתוף פעולה, וגבריאלה מוצאת לך התאמה גם בנכסים של אחרים.\nחצי שנה של Elite ב-₪0, בלי כרטיס אשראי.",
            [IMG.b1Fomo11, IMG.b1Fomo916]),
          b1("b1_2", "B1-2 match", "הקונה שלך. הנכס של מתווך אחר.",
            "גבריאלה מצליבה את הלקוחות שלך מול כל הנכסים הפתוחים לשת\"פ באזור.\nאת הנכס אתם סוגרים יחד.",
            [IMG.h11, IMG.h45]),
          b1("b1_3", "B1-3 offices", "32 משרדים כבר בפנים.",
            "כל המתווכים בעמק כבר כאן: CRM, החתמה דיגיטלית ללא הגבלה ושיתופי פעולה, הכל כלול.\nחצי שנה של Elite ב-₪0.",
            [IMG.e11, IMG.e45]),
          b1("b1_4", "B1-4 gabriela", "עוזרת אישית בוואטסאפ.",
            "\"תעלי את הדירה ברחוב הרצל\" - גבריאלה מעלה ומעדכנת.\nנכסים, לקוחות ויומן, מהנייד.",
            [IMG.g111, IMG.g145]),
          b1("b1_5", "B1-5 elite", "חצי שנה Elite ב-₪0.",
            "בלי כרטיס אשראי.\nגבריאלה, המנטור AI, CRM ושיתופי פעולה עם כל המתווכים באזור.",
            [IMG.d11, IMG.d45]),
        ],
      }],
    },
    {
      key: "brokers_registered",
      name: "SN | Brokers | Registered | LPV | Q4",
      objective: "OUTCOME_TRAFFIC",
      housing: false,
      adSets: [{
        key: "b2",
        name: "B2 Registered",
        dailyBudgetIls: 7,
        destination: "website",
        leadFormId: null,
        optimization: "LANDING_PAGE_VIEWS",
        ageMin: 22,
        ageMax: 65,
        geo: { mode: "country", country: "IL" },
        flexible: [],
        audienceKeys: ["brokers_site_180d"],
        extraAudienceIds: b2Extra && /^\d{5,25}$/.test(b2Extra) ? [b2Extra] : [],
        notes: [
          "יעד האתר, לא הטופס המיידי. קמפיין נפרד כי מטא לא מערבבת לידים וצפיות בדף נחיתה באותו קמפיין.",
          "המיקום הוא ישראל: הקהל עצמו (רשימה + פיקסל) הוא המגבלה.",
        ],
        ads: [
          ad({
            key: "b2_1",
            name: "B2-1 gabriela",
            headline: "הפעלת את גבריאלה?",
            message: "אתה כבר בשוק נדל\"ן. עכשיו תן לגבריאלה לעבוד בשבילך: חיבור בוואטסאפ בדקה, והיא מעלה נכסים, מתאמת פגישות ומוצאת התאמות בנכסים של שת\"פ.",
            cta: "LEARN_MORE",
            images: [IMG.g111, IMG.g145],
            landingUrl: `${SITE}/pricing?utm_source=meta&utm_medium=paid_social&utm_campaign=brokers_leads_q4&utm_content=b2_registered`,
            leadFormId: null,
          }, D),
          ad({
            key: "b2_2",
            name: "B2-2 mentor",
            headline: "כל בוקר: מה לעשות היום כדי לסגור עסקה.",
            message: "המנטור AI עובר על הלידים והנכסים שלך ונותן עד 3 משימות ברורות להיום. כבר כלול בחשבון שלך - רק להיכנס.",
            description: "המנטור AI כלול בכל מסלול",
            cta: "LEARN_MORE",
            images: [IMG.g211, IMG.g245],
            landingUrl: `${SITE}/pricing?utm_source=meta&utm_medium=paid_social&utm_campaign=brokers_leads_q4&utm_content=b2_2_mentor`,
            leadFormId: null,
          }, D),
          ad({
            key: "b2_3",
            name: "B2-3 elite",
            headline: "יש לך חשבון? קבל Elite חינם לחצי שנה.",
            message: "ב-Elite גבריאלה שולחת לך בוואטסאפ עסקאות שנסגרו בפועל ברחוב של הנכס, מנתוני רשות המסים. חצי שנה ב-₪0, בלי כרטיס אשראי.",
            description: "בלי כרטיס אשראי",
            cta: "LEARN_MORE",
            images: [IMG.g211, IMG.g245],
            landingUrl: `${SITE}/pricing?utm_source=meta&utm_medium=paid_social&utm_campaign=brokers_leads_q4&utm_content=b2_3_elite`,
            leadFormId: null,
          }, D),
        ],
      }],
    },
    {
      key: "office_owners",
      name: "SN | Office owners | Leads",
      objective: "OUTCOME_LEADS",
      housing: false,
      adSets: [{
        key: "b3",
        name: "B3 Office owners",
        dailyBudgetIls: 13,
        destination: "lead_form",
        leadFormId: officeForm,
        optimization: "LEAD_GENERATION",
        ageMin: 28,
        ageMax: 65,
        geo: { mode: "regions", country: "IL", queries: ["Haifa District", "Northern District"] },
        flexible: [
          [...B3_GENERIC_POSITIONS, SMALL_BIZ],
          [...B3_RE_POSITIONS, ...EMPLOYERS, INTEREST_RESIDENTIAL, INTEREST_COACHING, INTEREST_BROKER],
        ],
        audienceKeys: [],
        extraAudienceIds: [],
        notes: [
          "מסך הסיום של הטופס: https://shuknadlan.co.il/agency-signup?utm_source=meta&utm_medium=lead_form&utm_campaign=office_owners_q4",
          "שתי קבוצות ב-flexible_spec, והן AND: תפקיד כללי (Owner, Founder, Managing Director, Branch Manager, Franchise Owner, Small business owners) וגם תפקיד, מעסיק או עניין של נדל\"ן. Advantage+ Audience כבוי.",
        ],
        ads: [
          ad({
            key: "oo1", name: "OO1 dashboard", headline: "כל הסוכנים שלך. מסך אחד.",
            message: "מי סגר, מי גייס, ומי לא חזר ללידים?\nבדאשבורד המשרד של שוק נדל\"ן רואים לכל סוכן/ת: לידים, זמן תגובה, עסקאות ועמלות, מול התקופה הקודמת.\nכלול בכל מסלול.",
            cta: "SIGN_UP", images: [IMG.oo1_11, IMG.oo1_916], landingUrl: null, leadFormId: officeForm,
          }, D),
          ad({
            key: "oo2", name: "OO2 mentor", headline: "המנטור כבר עבר על השבוע שלך.",
            message: "כל יום ראשון בבוקר: סיכום שבועי למשרד ועד 3 החלטות לשבוע, מהמנטור AI.\nכלול בכל מסלול.",
            cta: "SIGN_UP", images: [IMG.oo2_11, IMG.oo2_916], landingUrl: null, leadFormId: officeForm,
          }, D),
          ad({
            key: "oo3", name: "OO3 mentor gabriela", headline: "המנטור מכוון. גבריאלה מבצעת.",
            message: "המנטור AI אומר לך על מה להתמקד השבוע. גבריאלה, העוזרת בוואטסאפ, קובעת את הפגישה ומעדכנת את הנכס.\nחצי שנה של Elite ב-₪0, בלי כרטיס אשראי.",
            cta: "SIGN_UP", images: [IMG.oo3_11, IMG.oo3_916], landingUrl: null, leadFormId: officeForm,
          }, D),
          ad({
            key: "oo4", name: "OO4 response", headline: "מי לא חזר ללידים השבוע?",
            message: "בדאשבורד המשרד רואים לכל סוכן/ת לידים וזמן תגובה, מול התקופה הקודמת.\nבלי לשאול ובלי אקסל.",
            cta: "SIGN_UP", images: [IMG.oo4_11, IMG.oo4_916], landingUrl: null, leadFormId: officeForm,
          }, D),
        ],
      }],
    },
    {
      key: "buyers",
      name: "SN | Buyers | HOUSING | LPV | Q4",
      objective: "OUTCOME_TRAFFIC",
      housing: true,
      adSets: [
        {
          key: "a1", name: "A1 First apartment", dailyBudgetIls: 15, destination: "website", leadFormId: null,
          optimization: "LANDING_PAGE_VIEWS", ageMin: 18, ageMax: 65, geo: housingGeo(), flexible: [],
          audienceKeys: [], extraAudienceIds: [], notes: [],
          ads: [
            ad({
              key: "a1_viz", name: "A1 viz", headline: "לפני שקובעים סיור, רואים אותה מעוצבת.",
              message: "לפני שקובעים סיור, רואים איך הדירה יכולה להיראות.\nברוב הנכסים בעפולה באתר יש הדמיית AI: לוחצים על סגנון ורואים את הדירה מרוהטת ומעוצבת.\n(ההדמיות להמחשה בלבד)",
              cta: "LEARN_MORE", images: [IMG.a1_11, IMG.a1_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&maxPrice=1500000", { ...BUYER_UTM, utm_content: "a1_viz" }),
            }, D),
            ad({
              key: "a1_v1", name: "A1 v1", headline: "דירה ראשונה בעפולה? מתחילים כאן",
              message: "מחפשים דירה ראשונה בעפולה או בעמק?\nכל הדירות למכירה, מכל משרדי התיווך באזור, במקום אחד: מחיר, תמונות ומפה.\nמסננים לפי תקציב ומספר חדרים, ובודקים החזר חודשי משוער במחשבון המשכנתא באתר.",
              cta: "LEARN_MORE", images: [IMG.a1_11, IMG.a1_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&maxPrice=1500000", { ...BUYER_UTM, utm_content: "a1_v1" }),
            }, D),
            ad({
              key: "a1_3", name: "A1-3 count", headline: "45 דירות בעפולה עד ₪1.5 מיליון",
              message: "45 דירות למכירה בעפולה עד ₪1,500,000, עם מחיר, תמונות ומפה.\nהדף כבר מסונן לתקציב. רק לבחור.",
              description: "דירה ראשונה בעפולה",
              cta: "LEARN_MORE", images: [IMG.a1_11, IMG.a1_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&maxPrice=1500000", { ...BUYER_UTM, utm_content: "a1_count" }),
            }, D),
            ad({
              key: "a1_4", name: "A1-4 alert", headline: "עלתה דירה שמתאימה לכם? תקבלו הודעה.",
              message: "משאירים פעם אחת מה מחפשים: חדרים, מחיר ואזור. כשעולה לאתר דירה מתאימה - נשלח לכם הודעה בוואטסאפ או במייל.",
              description: "עדכון על נכס חדש שמתאים",
              cta: "LEARN_MORE", images: [IMG.a1_11, IMG.a1_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&maxPrice=1500000", { ...BUYER_UTM, utm_content: "a1_alert" }),
            }, D),
          ],
        },
        {
          key: "a2", name: "A2 Upgraders", dailyBudgetIls: 10, destination: "website", leadFormId: null,
          optimization: "LANDING_PAGE_VIEWS", ageMin: 18, ageMax: 65, geo: housingGeo(), flexible: [],
          audienceKeys: [], extraAudienceIds: [], notes: [],
          ads: [
            ad({
              key: "a2_viz", name: "A2 viz", headline: "5 חדרים בעפולה. בסגנון שלך.",
              message: "ראו את הבית הבא שלכם בסגנון שאתם אוהבים.\nבחרו סגנון עיצוב וצפו בהדמיית AI מיידית של הנכס, לפני שמגיעים לסיור.\n(להמחשה בלבד)",
              cta: "LEARN_MORE", images: [IMG.a2_11, IMG.a2_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&rooms=5", { ...BUYER_UTM, utm_content: "a2_viz" }),
            }, D),
            ad({
              key: "a2_2", name: "A2-2 rooms", headline: "צריכים עוד חדר? 49 נכסים בעפולה.",
              message: "49 נכסים למכירה בעפולה עם 5 חדרים ומעלה, עם מחיר, תמונות ומפה.\nהדף כבר מסונן. רק לבחור.",
              description: "5 חדרים ומעלה בעפולה",
              cta: "LEARN_MORE", images: [IMG.a2_11, IMG.a2_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&rooms=5", { ...BUYER_UTM, utm_content: "a2_rooms" }),
            }, D),
            ad({
              key: "a2_3", name: "A2-3 types", headline: "פנטהאוז, דירת גן או בית פרטי?",
              message: "דירות, פנטהאוזים, דירות גן ובתים פרטיים בעפולה, 5 חדרים ומעלה, בחיפוש אחד.\nבוחרים סוג נכס ומשווים מחירים.",
              description: "5 חדרים ומעלה בעפולה",
              cta: "LEARN_MORE", images: [IMG.a2_11, IMG.a2_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=sale&rooms=5", { ...BUYER_UTM, utm_content: "a2_types" }),
            }, D),
          ],
        },
        {
          key: "a3", name: "A3 Renters", dailyBudgetIls: 8, destination: "website", leadFormId: null,
          optimization: "LANDING_PAGE_VIEWS", ageMin: 18, ageMax: 65, geo: housingGeo(), flexible: [],
          audienceKeys: [], extraAudienceIds: [], notes: [],
          ads: [
            ad({
              key: "a3_viz", name: "A3 gabriela", headline: "מחפשים להשכיר? כתבו לגבריאלה.",
              message: "לא בא לכם לגלול? כתבו לגבריאלה בוואטסאפ מה אתם מחפשים להשכרה, וקבלו נכסים מתאימים.",
              cta: "LEARN_MORE", images: [IMG.a3_11, IMG.a3_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=rent", { ...BUYER_UTM, utm_content: "a3_gabriela" }),
            }, D),
            ad({
              key: "a3_2", name: "A3-2 alert", headline: "דירה להשכרה עולה? תדעו מיד.",
              message: "ספרו לנו מה אתם מחפשים להשכרה, ונעדכן אתכם בוואטסאפ או במייל ברגע שעולה נכס שמתאים.\nבלי לרענן את האתר כל יום.",
              description: "עדכון על נכס חדש להשכרה",
              cta: "LEARN_MORE", images: [IMG.a3_11, IMG.a3_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=rent", { ...BUYER_UTM, utm_content: "a3_alert" }),
            }, D),
            ad({
              key: "a3_3", name: "A3-3 contact", headline: "להשכרה בעפולה: מחיר, תמונות ופרטי קשר.",
              message: "בלי 'פרטים בפרטי': רואים מחיר, תמונות ופרטי קשר. מסננים לפי חדרים ומחיר.",
              description: "נכסים להשכרה בעפולה",
              cta: "LEARN_MORE", images: [IMG.a3_11, IMG.a3_916], leadFormId: null,
              landingUrl: siteUrl("/?deal=rent", { ...BUYER_UTM, utm_content: "a3_contact" }),
            }, D),
          ],
        },
        {
          key: "a4", name: "A4 Investors", dailyBudgetIls: 7, destination: "website", leadFormId: null,
          optimization: "LANDING_PAGE_VIEWS", ageMin: 18, ageMax: 65, geo: housingGeo(), flexible: [],
          audienceKeys: [], extraAudienceIds: [], notes: [],
          ads: [
            ad({
              key: "a4_viz", name: "A4 prices", headline: "כמה באמת עולה דירה בעפולה?",
              message: "בדקו מחירי דירות בעפולה לפי עסקאות שדווחו לרשות המסים, וראו עסקאות אחרונות לפי יישוב.",
              cta: "LEARN_MORE", images: [IMG.a4_11, IMG.a4_916], leadFormId: null,
              landingUrl: siteUrl("/prices", { ...BUYER_UTM, utm_content: "a4_prices" }),
            }, D),
            ad({
              key: "a4_2", name: "A4-2 deals", headline: "מחיר מודעה או מחיר עסקה?",
              message: "המחיר במודעה הוא מה שמבקשים. המחיר בעסקה הוא מה ששילמו בפועל.\nראו מחירים חציוניים בעפולה לפי מספר חדרים, מעסקאות שדווחו לרשות המסים.",
              description: "נתוני עסקאות רשמיים",
              cta: "LEARN_MORE", images: [IMG.a4_11, IMG.a4_916], leadFormId: null,
              landingUrl: siteUrl("/prices", { ...BUYER_UTM, utm_content: "a4_deals" }),
            }, D),
            ad({
              key: "a4_3", name: "A4-3 sqm", headline: "עפולה ₪13,800 למ\"ר. חיפה ₪17,400.",
              message: "מחיר חציוני למ\"ר בדירות 4 חדרים, לפי עסקאות שדווחו לרשות המסים (9.2025-9.2026).\nמשווים ערים ומספר חדרים בטבלה אחת.",
              description: "מחירי עסקאות לפי עיר",
              cta: "LEARN_MORE", images: [IMG.a4_11, IMG.a4_916], leadFormId: null,
              landingUrl: siteUrl("/prices", { ...BUYER_UTM, utm_content: "a4_sqm" }),
            }, D),
          ],
        },
      ],
    },
    {
      key: "retargeting",
      name: "SN | Retargeting | HOUSING | LPV",
      objective: "OUTCOME_TRAFFIC",
      housing: true,
      adSets: [{
        key: "rt",
        name: "RT Site visitors",
        dailyBudgetIls: 10,
        destination: "website",
        leadFormId: null,
        optimization: "LANDING_PAGE_VIEWS",
        ageMin: 18,
        ageMax: 65,
        geo: housingGeo(),
        flexible: [],
        audienceKeys: ["site_visitors_30d"],
        extraAudienceIds: [],
        notes: ["קהל אתר 30 יום מהפיקסל, בלי /crm. בלי Lookalike."],
        ads: [
          ad({
            key: "rt1", name: "RT1 viz", headline: "הדירה שראיתם? ראו אותה מעוצבת.",
            message: "חזרו לנכסים בעפולה ובחרו סגנון. הדמיית AI מראה איך הדירה יכולה להיראות.\n(ההדמיות להמחשה בלבד)",
            cta: "LEARN_MORE", images: [IMG.rt1_11, IMG.rt1_916], leadFormId: null,
            landingUrl: siteUrl("/?deal=sale&ai=1&utm_campaign=retargeting_q4&utm_content=rt1", RT_UTM),
          }, D),
          ad({
            key: "rt2", name: "RT2 gabriela", headline: "עוד לא מצאתם? גבריאלה תחפש בשבילכם.",
            message: "כתבו לגבריאלה בוואטסאפ מה אתם מחפשים, וקבלו נכסים מתאימים.",
            cta: "LEARN_MORE", images: [IMG.rt2_11, IMG.rt2_916], leadFormId: null,
            landingUrl: siteUrl("/?deal=sale&utm_campaign=retargeting_q4&utm_content=rt2", RT_UTM),
          }, D),
          ad({
            key: "rt3", name: "RT3 calc", headline: "ראיתם נכס? כמה יהיה ההחזר החודשי?",
            message: "מכניסים מחיר, הון עצמי, ריבית ותקופה, ורואים החזר חודשי משוער במחשבון המשכנתא באתר.\n(חישוב משוער בלבד)",
            description: "מחשבון משכנתא חינמי",
            cta: "LEARN_MORE", images: [IMG.rt1_11, IMG.rt1_916], leadFormId: null,
            landingUrl: siteUrl("/?deal=sale&utm_campaign=retargeting_q4&utm_content=rt3#calc", RT_UTM),
          }, D),
          ad({
            key: "rt4", name: "RT4 new", headline: "נכסים חדשים עולים כל שבוע.",
            message: "בכל שבוע עולים לאתר נכסים חדשים למכירה בעפולה ובעמק.\nאולי מה שחיפשתם כבר כאן.",
            description: "נכסים חדשים למכירה",
            cta: "LEARN_MORE", images: [IMG.rt2_11, IMG.rt2_916], leadFormId: null,
            landingUrl: siteUrl("/?deal=sale&utm_campaign=retargeting_q4&utm_content=rt4", RT_UTM),
          }, D),
        ],
      }],
    },
  ];

  const ownerForm = (input.ownerFormId ?? "").trim();
  const ownerFormName = (input.ownerFormName ?? "").trim();
  if (input.includeA5) {
    if (ownerForm === SELLERS_FORM_ID) {
      errors.push({
        code: "a5_wrong_form",
        detail: `A5 לא משתמש בטופס מוכרים נכס - עפולה (${SELLERS_FORM_ID}). רק ${VALUATION_FORM_NAME} (${VALUATION_FORM_ID}).`,
      });
    } else if (ownerForm !== VALUATION_FORM_ID) {
      errors.push({
        code: "a5_form_missing",
        detail: `A5 נוצר רק עם טופס ${VALUATION_FORM_NAME} (${VALUATION_FORM_ID}).`,
      });
    } else {
      campaigns.find((c) => c.key === "owners") ?? campaigns.push({
        key: "owners",
        name: "SN | Owners | HOUSING | Leads | Q4",
        objective: "OUTCOME_LEADS",
        housing: true,
        adSets: [{
          key: "a5",
          name: "A5 Owner valuation",
          dailyBudgetIls: 10,
          destination: "lead_form",
          leadFormId: ownerForm,
          leadFormName: ownerFormName || VALUATION_FORM_NAME,
          optimization: "LEAD_GENERATION",
          ageMin: 18,
          ageMax: 65,
          geo: housingGeo(),
          flexible: [],
          audienceKeys: [],
          extraAudienceIds: [],
          notes: ["קמפיין נפרד: מטא A הוא צפיות בדף נחיתה, ו-A5 הוא טופס לידים."],
          ads: [ad({
            key: "a5_viz",
            name: "A5 valuation",
            headline: "כמה שווה הנכס שלכם?",
            message: "הנכס שלכם, כמו שקונים יראו אותו.\nעם הערכת השווי החינמית מקבלים גם הדמיית AI שמראה לקונים את הפוטנציאל של הנכס.\nהערכת השווי ניתנת על ידי מתווך/ת ואינה מהווה תחליף להערכת שמאי מקרקעין.",
            cta: "LEARN_MORE",
            images: [IMG.a5_11, IMG.a5_916],
            landingUrl: null,
            leadFormId: ownerForm,
          }, D)],
        }],
      });
    }
  } else {
    skipped.push({
      key: "A5",
      reason: `לא סומן. כשיסומן, A5 ישתמש רק בטופס ${VALUATION_FORM_NAME}, לא בטופס מוכרים נכס.`,
      headline: "כמה שווה הנכס שלכם?",
      message: "הנכס שלכם, כמו שקונים יראו אותו. עם הערכת השווי החינמית מקבלים גם הדמיית AI. ההסתייגות: אינה מהווה תחליף להערכת שמאי מקרקעין.",
    });
  }

  skipped.push({
    key: "OO5",
    reason: "TODO: אין קריאייטיב. מוצע צילום חלון מסירה לסוכן/ת, 1:1 ו-9:16. הנוסח לא נוצר.",
    headline: "ליד נכנס. אתה מחליט מי מטפל.",
    message: "ליד, לקוח או נכס - לחיצה אחת, והוא אצל הסוכן/ת הנכון/ה בצוות.\nהסוכן/ת מקבל/ת התראה, ואתה ממשיך לראות הכול.",
  });

  for (const c of campaigns) {
    if (c.housing && c.objective !== "OUTCOME_LEADS" && c.objective !== "OUTCOME_TRAFFIC") {
      errors.push({ code: "bad_objective", detail: c.name });
    }
    for (const a of c.adSets) {
      if (a.ads.length < 3) {
        warnings.push(`${a.name}: ${a.ads.length} מודעות. היעד הוא 3-5 איפה שהחבילה מספקת אותן. לא הומצאו נוסחים.`);
      }
      if (a.ads.length > 5) errors.push({ code: "too_many_ads", detail: a.name });
      for (const one of a.ads) {
        if (!one.message.includes(D) && disclosure) {
          errors.push({ code: "disclosure_missing", detail: one.name });
        }
        if (one.headline.length > HEADLINE_WARN) {
          warnings.push(`${one.name}: כותרת של ${one.headline.length} תווים. בטלפון נחתך מעל ${HEADLINE_WARN}.`);
        }
        const descLen = (one.description || "").length;
        if (descLen > DESCRIPTION_LIMIT) {
          warnings.push(`${one.name}: תיאור של ${descLen} תווים. מטא מציגה עד ${DESCRIPTION_LIMIT}.`);
        }
        if (one.images.length < 1) errors.push({ code: "image_required", detail: one.name });
        if (c.housing && one.message.includes("הערכת שווי") && !one.message.includes("שמאי")) {
          errors.push({ code: "valuation_disclaimer", detail: one.name });
        }
      }
      if (c.housing) {
        if (a.ageMin !== 18 || a.ageMax !== 65) {
          errors.push({ code: "housing_age", detail: `${a.name}: גיל בדיור הוא 18-65 בלבד.` });
        }
        if (a.flexible.length) errors.push({ code: "housing_detailed", detail: `${a.name}: בלי תחומי עניין במודעת דיור.` });
        if (a.geo.mode === "radius" && a.geo.radiusKm < HOUSING_MIN_RADIUS_KM) {
          errors.push({ code: "housing_radius", detail: `${a.name}: רדיוס דיור מינימלי ${HOUSING_MIN_RADIUS_KM} ק"מ.` });
        }
        if (a.geo.mode === "country") errors.push({ code: "housing_country", detail: a.name });
      }
    }
  }

  const liveCountAds: string[] = [];
  for (const c of campaigns) {
    for (const a of c.adSets) {
      for (const one of a.ads) {
        const blob = `${one.headline}\n${one.message}\n${one.description || ""}`;
        const hits: string[] = [];
        if (hasStandaloneCount(blob, "45")) hits.push("45");
        if (hasStandaloneCount(blob, "49")) hits.push("49");
        if (hasStandaloneCount(blob, "13,800")) hits.push("₪13,800");
        if (hasStandaloneCount(blob, "17,400")) hits.push("₪17,400");
        if (hits.length) liveCountAds.push(`${one.name} (${hits.join(", ")})`);
      }
    }
  }
  if (liveCountAds.length) {
    warnings.push(`מספרים חיים שצריך לרענן לפני היצירה: ${liveCountAds.join("; ")}.`);
  }

  const images: ImageRef[] = [];
  const seenImg = new Set<string>();
  let metaDaily = 0;
  for (const c of campaigns) {
    for (const a of c.adSets) {
      metaDaily += a.dailyBudgetIls;
      for (const one of a.ads) {
        for (const image of one.images) {
          if (seenImg.has(image.key)) continue;
          seenImg.add(image.key);
          images.push(image);
        }
      }
    }
  }
  const total = metaDaily + googleDaily;
  const maxDaily = Number(input.maxDailyBudget);
  if (!(maxDaily > 0)) {
    errors.push({ code: "budget_cap", detail: "תקרת התקציב ב-ads_settings אינה מספר." });
  } else if (total > maxDaily) {
    errors.push({
      code: "budget_cap",
      detail: `הסכום ₪${total} ליום (מטא ₪${metaDaily} + גוגל ₪${googleDaily}) גבוה מתקרת ₪${maxDaily}.`,
    });
  }

  return {
    ok: errors.length === 0,
    launchKey: LAUNCH_KEY,
    campaigns,
    audiences,
    images,
    skipped,
    warnings,
    errors,
    budget: {
      metaDailyIls: metaDaily,
      googleDailyIls: googleDaily,
      googleCampaignId: GOOGLE_BUYERS_CAMPAIGN,
      totalDailyIls: total,
      maxDailyIls: maxDaily,
    },
  };
}

function geoJson(geo: AdSetDef["geo"], regionKeys: Record<string, string>): { geo: unknown; error?: string } {
  if (geo.mode === "country") return { geo: { countries: [geo.country] } };
  if (geo.mode === "radius") {
    return {
      geo: {
        custom_locations: geo.points.map((p) => ({
          latitude: round6(p.lat),
          longitude: round6(p.lng),
          radius: geo.radiusKm,
          distance_unit: "kilometer",
        })),
      },
    };
  }
  const regions = [];
  for (const q of geo.queries) {
    const key = regionKeys[q];
    if (!key) return { geo: null, error: `region_unresolved:${q}` };
    regions.push({ key });
  }
  return { geo: { regions, countries: [geo.country] } };
}

function flexibleJson(groups: Term[][], termIds: Record<string, string>): { spec: unknown[] | null; error?: string } {
  const spec = [];
  for (const group of groups) {
    const bucket: Record<string, { id: string; name: string }[]> = {};
    const field: Record<TermType, string> = {
      interest: "interests",
      work_position: "work_positions",
      work_employer: "work_employers",
      behavior: "behaviors",
    };
    for (const t of group) {
      const id = t.id || termIds[termKey(t)];
      if (!id) return { spec: null, error: `term_unresolved:${termKey(t)}` };
      const f = field[t.type];
      (bucket[f] ??= []).push({ id, name: t.name });
    }
    spec.push(bucket);
  }
  return { spec };
}

// v26: explore הוסר. facebook_reels, reels ו-video_feeds אינם ברשימת
// Placement Asset Customization, וכלל עם מיקום לא מוכר מפיל את כל
// ה-object_story_spec (1443048, יומן 129). שתי כללים, פיד מול סטורי.
// בלי חשבון אינסטגרם של הדף לא שולחים מיקומי אינסטגרם: מזהה חסר שם
// נחשב שדה לא תקין באותו subcode.
function placementRules(withDescription: boolean, withInstagram: boolean) {
  const shared: Record<string, unknown> = {
    body_label: { name: "body" },
    title_label: { name: "title" },
    link_url_label: { name: "link" },
  };
  if (withDescription) shared.description_label = { name: "desc" };
  const platforms = withInstagram ? ["facebook", "instagram"] : ["facebook"];
  const feedPositions: Record<string, unknown> = {
    publisher_platforms: platforms,
    facebook_positions: ["feed", "marketplace", "search"],
  };
  const storyPositions: Record<string, unknown> = {
    publisher_platforms: platforms,
    facebook_positions: ["story"],
  };
  if (withInstagram) {
    feedPositions.instagram_positions = ["stream", "profile_feed"];
    storyPositions.instagram_positions = ["story"];
  }
  return [
    {
      customization_spec: feedPositions,
      image_label: { name: "img_feed" },
      ...shared,
    },
    {
      customization_spec: storyPositions,
      image_label: { name: "img_story" },
      ...shared,
    },
  ];
}

function usableInstagramId(pageId: string, instagramUserId?: string): string | undefined {
  const id = (instagramUserId || "").trim();
  if (!/^\d{5,25}$/.test(id) || id === pageId) return undefined;
  return id;
}

export function collectWriteOps(plan: LaunchPlan, ctx: {
  pageId: string;
  instagramUserId?: string;
  pixelId?: string;
  regionKeys?: Record<string, string>;
  termIds?: Record<string, string>;
}): { ops: WriteOp[]; errors: string[] } {
  if (!plan.ok) return { ops: [], errors: plan.errors.map((e) => e.code) };
  const pixelId = ctx.pixelId || PIXEL_ID;
  const regionKeys = ctx.regionKeys ?? {};
  const termIds = ctx.termIds ?? {};
  const errors: string[] = [];
  const ops: WriteOp[] = [];

  for (const image of plan.images) {
    ops.push({
      objectKey: `image:${image.key}`,
      kind: "image",
      name: image.path.split("/").pop() || image.key,
      pathSuffix: "adimages",
      body: {},
      imageKey: image.key,
    });
  }
  for (const audience of plan.audiences) {
    const used = plan.campaigns.some((c) => c.adSets.some((a) => a.audienceKeys.includes(audience.key)));
    if (!used) continue;
    ops.push({
      objectKey: `audience:${audience.key}`,
      kind: "audience",
      name: audience.name,
      pathSuffix: "customaudiences",
      body: {
        name: audience.name,
        prefill: "1",
        rule: JSON.stringify(audience.rule),
      },
    });
  }

  for (const c of plan.campaigns) {
    const campBody: Record<string, string> = {
      name: c.name,
      objective: c.objective,
      status: PAUSED_STATUS,
      special_ad_categories: JSON.stringify(c.housing ? ["HOUSING"] : []),
      buying_type: "AUCTION",
      is_adset_budget_sharing_enabled: "false",
    };
    if (c.housing) campBody.special_ad_category_country = JSON.stringify(["IL"]);
    ops.push({
      objectKey: `campaign:${c.key}`,
      kind: "campaign",
      name: c.name,
      pathSuffix: "campaigns",
      body: campBody,
    });

    for (const a of c.adSets) {
      const g = geoJson(a.geo, regionKeys);
      if (g.error) errors.push(g.error);
      const flex = flexibleJson(a.flexible, termIds);
      if (flex.error) errors.push(flex.error);
      const customAudiences = [
        ...a.audienceKeys.map((k) => ({ id: `{{id:audience:${k}}}` })),
        ...a.extraAudienceIds.map((id) => ({ id })),
      ];
      const targeting: Record<string, unknown> = {
        geo_locations: g.geo,
        age_min: a.ageMin,
        age_max: a.ageMax,
        targeting_automation: { advantage_audience: 0 },
      };
      if (flex.spec && flex.spec.length) targeting.flexible_spec = flex.spec;
      if (customAudiences.length) targeting.custom_audiences = customAudiences;
      const adsetBody: Record<string, string> = {
        name: a.name,
        campaign_id: `{{id:campaign:${c.key}}}`,
        billing_event: "IMPRESSIONS",
        optimization_goal: a.optimization,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        daily_budget: String(Math.round(a.dailyBudgetIls * 100)),
        targeting: JSON.stringify(targeting),
        status: PAUSED_STATUS,
      };
      if (a.destination === "lead_form") {
        adsetBody.destination_type = "ON_AD";
        adsetBody.promoted_object = JSON.stringify({ page_id: ctx.pageId });
      } else {
        adsetBody.promoted_object = JSON.stringify({ pixel_id: pixelId });
      }
      ops.push({
        objectKey: `adset:${a.key}`,
        kind: "adset",
        name: a.name,
        pathSuffix: "adsets",
        body: adsetBody,
      });

      for (const one of a.ads) {
        const feed = one.images[0];
        const story = one.images[1];
        const message = one.message.trim();
        const headline = one.headline.trim();
        const description = (one.description || "").trim();
        if (!message || !headline) errors.push(`creative_text:${one.key}`);
        if (!feed) errors.push(`creative_image:${one.key}`);
        const lead = !!one.leadFormId;
        const link = lead ? LEAD_LINK : (one.landingUrl || "").trim();
        if (!lead && !/^https:\/\/\S+$/.test(link)) errors.push(`creative_link:${one.key}`);
        // שתי תמונות: asset_feed_spec בלבד, ו-object_story_spec הוא הדף
        // (ואינסטגרם אם יש). link_data עם image_hash ליד asset_feed_spec
        // הוא בדיוק subcode 1443048 (יומן 129, creative:b1_1). אין
        // degrees_of_freedom_spec על ה-feed: השדה הזה שייך ל-link_data,
        // ושדה לא מוכר באותו גוף נדחה כ-object_story_spec לא תקין.
        // תמונה אחת: link_data בלי feed, כמו campaign.ts.
        const ig = usableInstagramId(ctx.pageId, ctx.instagramUserId);
        const oss: Record<string, unknown> = { page_id: ctx.pageId };
        if (ig) oss.instagram_user_id = ig;
        const creativeBody: Record<string, string> = { name: one.name };
        if (feed && story) {
          const feedSpec: Record<string, unknown> = {
            ad_formats: ["SINGLE_IMAGE"],
            optimization_type: "PLACEMENT",
            images: [
              { hash: `{{hash:${feed.key}}}`, adlabels: [{ name: "img_feed" }] },
              { hash: `{{hash:${story.key}}}`, adlabels: [{ name: "img_story" }] },
            ],
            bodies: [{ text: message, adlabels: [{ name: "body" }] }],
            titles: [{ text: headline, adlabels: [{ name: "title" }] }],
            link_urls: [{ website_url: link, adlabels: [{ name: "link" }] }],
            asset_customization_rules: placementRules(!!description, !!ig),
          };
          if (description) feedSpec.descriptions = [{ text: description, adlabels: [{ name: "desc" }] }];
          if (lead) feedSpec.call_to_actions = [{ type: one.cta, value: { lead_gen_form_id: one.leadFormId } }];
          else feedSpec.call_to_action_types = [one.cta];
          creativeBody.object_story_spec = JSON.stringify(oss);
          creativeBody.asset_feed_spec = JSON.stringify(feedSpec);
        } else if (feed) {
          creativeBody.degrees_of_freedom_spec = JSON.stringify({
            creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } },
          });
          const linkData: Record<string, unknown> = {
            link,
            message,
            name: headline,
            image_hash: `{{hash:${feed.key}}}`,
            call_to_action: lead
              ? { type: one.cta, value: { lead_gen_form_id: one.leadFormId } }
              : { type: one.cta, value: { link } },
          };
          if (description) linkData.description = description;
          creativeBody.object_story_spec = JSON.stringify({ ...oss, link_data: linkData });
        }
        ops.push({
          objectKey: `creative:${one.key}`,
          kind: "creative",
          name: one.name,
          pathSuffix: "adcreatives",
          body: creativeBody,
        });
        ops.push({
          objectKey: `ad:${one.key}`,
          kind: "ad",
          name: one.name,
          pathSuffix: "ads",
          body: {
            name: one.name,
            adset_id: `{{id:adset:${a.key}}}`,
            creative: JSON.stringify({ creative_id: `{{id:creative:${one.key}}}` }),
            status: PAUSED_STATUS,
          },
        });
      }
    }
  }

  if (errors.length) return { ops: [], errors };
  return { ops, errors };
}

export function walkStatuses(value: unknown, found: string[]): void {
  if (Array.isArray(value)) {
    for (const v of value) walkStatuses(v, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "status" && typeof v === "string") found.push(v);
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          walkStatuses(JSON.parse(t), found);
        } catch {
          /* not json */
        }
      }
    } else {
      walkStatuses(v, found);
    }
  }
}

export function assertSafeWrite(act: string, pathSuffix: string, body: Record<string, string>): void {
  if (!/^act_\d+$/.test(act)) throw new Error("refusing_bad_account");
  if (!WRITE_SUFFIXES.has(pathSuffix)) throw new Error("refusing_unexpected_write_path");
  const path = `${act}/${pathSuffix}`;
  // בייטי תמונה לא נסרקים: רצף הספרות של הקמפיין המוגן יכול להופיע במקרה ב-base64.
  const { bytes: _bytes, ...rest } = body;
  const blob = path + "\n" + JSON.stringify(rest);
  for (const id of PROTECTED_CAMPAIGN_IDS) {
    if (blob.includes(id)) throw new Error("refusing_protected_campaign");
  }
  if (/\{\{(id|hash|bytes):/.test(blob)) throw new Error("unresolved_placeholder");
  const statuses: string[] = [];
  walkStatuses(body, statuses);
  for (const s of statuses) {
    if (s !== PAUSED_STATUS) throw new Error("refusing_non_paused_status");
  }
  if (STATUS_KINDS.has(pathSuffix === "adsets" ? "adset" : pathSuffix === "ads" ? "ad" : pathSuffix === "campaigns" ? "campaign" : "")) {
    if (body.status !== PAUSED_STATUS) throw new Error("refusing_non_paused_status");
  }
}

function substitute(body: Record<string, string>, ids: Map<string, string>, hashes: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = v.replace(/\{\{(id|hash):([^}]+)\}\}/g, (_m, kind: string, key: string) => {
      const val = kind === "id" ? ids.get(key) : hashes.get(key);
      if (!val) throw new Error(`unresolved_${kind}:${key}`);
      return val;
    });
  }
  return out;
}

function toBase64(buf: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH));
  return btoa(s);
}

export type ExistingRow = { metaId?: string | null; imageHash?: string | null };

// גוף השגיאה של מטא, בלי לייבא את MetaError: הבדיקה רצה ב-node, והלקוח
// קורא את Deno.env בטעינה. השדות נשמרים כמו שמטא החזירה אותם.
export type MetaErrorFields = {
  code: number | null;
  subcode: number | null;
  message: string | null;
  error_user_title: string | null;
  error_user_msg: string | null;
  error_data: unknown;
  fbtrace_id: string | null;
};

export function metaFieldsOf(e: unknown): MetaErrorFields | null {
  const meta = (e as { meta?: unknown } | null)?.meta;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  return {
    code: typeof m.code === "number" ? m.code : null,
    subcode: typeof m.error_subcode === "number" ? m.error_subcode : null,
    message: typeof m.message === "string" ? m.message : null,
    error_user_title: typeof m.error_user_title === "string" ? m.error_user_title : null,
    error_user_msg: typeof m.error_user_msg === "string" ? m.error_user_msg : null,
    error_data: "error_data" in m ? m.error_data : null,
    fbtrace_id: typeof m.fbtrace_id === "string" ? m.fbtrace_id : null,
  };
}

export function formatMetaError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const meta = metaFieldsOf(e);
  if (!meta) return message;
  const extra = [meta.error_user_title, meta.error_user_msg].filter((s): s is string => !!s);
  return extra.length ? `${message} | ${extra.join(" | ")}` : message;
}

export type LaunchFailure = {
  objectKey: string;
  kind: string;
  name: string;
  message: string;
  meta: MetaErrorFields | null;
  request?: Record<string, unknown> | null;
};

// גוף הבקשה ליומן. בלי בייטי תמונה ובלי שדות שנשמעים כמו טוקן.
export function sanitizeLaunchBody(body: Record<string, string> | undefined): Record<string, unknown> | null {
  if (!body) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "bytes" || /token|secret|proof|authorization/i.test(k)) continue;
    if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        /* נשאר מחרוזת */
      }
    }
    out[k] = v;
  }
  return out;
}

export function creativePreviewBody(body: Record<string, string>): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  for (const key of ["object_story_spec", "asset_feed_spec", "degrees_of_freedom_spec"] as const) {
    if (!body[key]) continue;
    try {
      spec[key] = JSON.parse(body[key]);
    } catch {
      spec[key] = body[key];
    }
  }
  return spec;
}

// הדף חייב להיות שוק הנדל"ן של עפולה והסביבה, והטוקן חייב לקרוא אותו.
// אינסטגרם נלקח מהחשבון המחובר לדף. מזהה אחר, או מזהה משתמש, לא נשלח.
export async function resolveLaunchIdentity(
  pageId: string,
  instagramUserId: string | undefined,
  get: (path: string, params: Record<string, string>) => Promise<unknown>,
): Promise<{ pageId: string; pageName: string | null; instagramUserId?: string; warnings: string[]; error?: string }> {
  const warnings: string[] = [];
  if (pageId !== PAGE_ID_EXPECTED) {
    return {
      pageId,
      pageName: null,
      warnings,
      error: `מזהה הדף ${pageId || "(ריק)"} אינו הדף שוק הנדל"ן של עפולה והסביבה (${PAGE_ID_EXPECTED}). לא נוצר קריאייטיב.`,
    };
  }
  type PageIdentity = { id?: unknown; name?: unknown; instagram_business_account?: { id?: unknown } };
  let page: PageIdentity | null = null;
  try {
    page = await get(pageId, { fields: "id,name,instagram_business_account{id}" }) as PageIdentity;
  } catch (e) {
    try {
      page = await get(pageId, { fields: "id,name" }) as PageIdentity;
      warnings.push("לא נקרא חשבון האינסטגרם של הדף. הקריאייטיב נשלח בלי instagram_user_id.");
    } catch (e2) {
      return {
        pageId,
        pageName: null,
        warnings,
        error: `אין גישה לדף ${PAGE_ID_EXPECTED} עם הטוקן. ${formatMetaError(e2 || e)}`,
      };
    }
  }
  const id = String(page?.id || "");
  const name = typeof page?.name === "string" ? page.name : null;
  if (id !== PAGE_ID_EXPECTED) {
    return {
      pageId,
      pageName: name,
      warnings,
      error: `הטוקן החזיר דף ${id || "בלי מזהה"} ולא את ${PAGE_ID_EXPECTED}.`,
    };
  }
  const linked = String(page?.instagram_business_account?.id || "");
  const given = (instagramUserId || "").trim();
  let ig: string | undefined;
  if (/^\d{5,25}$/.test(linked) && linked !== id) {
    ig = linked;
    if (given && given !== linked) {
      warnings.push(`מזהה האינסטגרם בסודות אינו החשבון המחובר לדף. נשלח את החשבון המחובר לדף (${linked}).`);
    }
  } else if (given) {
    warnings.push("לדף אין חשבון אינסטגרם מחובר. הקריאייטיב נשלח בלי instagram_user_id.");
  }
  return { pageId: id, pageName: name, instagramUserId: ig, warnings };
}

export async function executeLaunch(args: {
  act: string;
  plan: LaunchPlan;
  pageId: string;
  instagramUserId?: string;
  pixelId?: string;
  regionKeys: Record<string, string>;
  termIds: Record<string, string>;
  existing: Map<string, ExistingRow>;
  images: Map<string, Uint8Array>;
  post: (path: string, body: Record<string, string>) => Promise<any>;
  record: (row: { objectKey: string; kind: string; name: string; metaId?: string; imageHash?: string }) => Promise<void>;
}): Promise<{
  created: string[];
  skipped: string[];
  error?: string;
  failedObjectKey?: string;
  failedName?: string;
  failedKind?: string;
  failedPath?: string;
  meta?: MetaErrorFields | null;
  request?: Record<string, unknown> | null;
}> {
  for (const row of args.existing.values()) {
    if (row.metaId && PROTECTED_CAMPAIGN_IDS.includes(row.metaId)) {
      return { created: [], skipped: [], error: "refusing_protected_campaign" };
    }
  }
  const { ops, errors } = collectWriteOps(args.plan, {
    pageId: args.pageId,
    instagramUserId: args.instagramUserId,
    pixelId: args.pixelId,
    regionKeys: args.regionKeys,
    termIds: args.termIds,
  });
  if (errors.length) return { created: [], skipped: [], error: errors.join(",") };

  const ids = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const [key, row] of args.existing) {
    if (row.metaId) ids.set(key, row.metaId);
    if (row.imageHash && key.startsWith("image:")) hashes.set(key.slice("image:".length), row.imageHash);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  let current: WriteOp | null = null;
  let currentBody: Record<string, string> | undefined;
  try {
    for (const op of ops) {
      current = op;
      const prev = args.existing.get(op.objectKey);
      if (op.kind === "image" && prev?.imageHash) {
        skipped.push(op.objectKey);
        continue;
      }
      if (op.kind !== "image" && prev?.metaId) {
        skipped.push(op.objectKey);
        continue;
      }
      let body = substitute(op.body, ids, hashes);
      if (op.kind === "image" && op.imageKey) {
        const bytes = args.images.get(op.imageKey);
        if (!bytes) throw new Error(`creative_bytes_missing:${op.imageKey}`);
        body = { ...body, bytes: toBase64(bytes) };
      }
      currentBody = body;
      assertSafeWrite(args.act, op.pathSuffix, body);
      const res = await args.post(`${args.act}/${op.pathSuffix}`, body);
      if (op.kind === "image") {
        const first = res?.images ? Object.values(res.images)[0] as { hash?: string } : null;
        const hash = String(first?.hash ?? "");
        if (!hash) throw new Error("image_upload_no_hash");
        hashes.set(op.imageKey!, hash);
        await args.record({ objectKey: op.objectKey, kind: op.kind, name: op.name, imageHash: hash });
      } else {
        const id = String(res?.id ?? "");
        if (!id || PROTECTED_CAMPAIGN_IDS.includes(id)) throw new Error(id ? "refusing_protected_campaign" : "meta_no_id");
        ids.set(op.objectKey, id);
        await args.record({ objectKey: op.objectKey, kind: op.kind, name: op.name, metaId: id });
      }
      created.push(op.objectKey);
    }
  } catch (e) {
    return {
      created,
      skipped,
      error: formatMetaError(e),
      failedObjectKey: current?.objectKey,
      failedName: current?.name,
      failedKind: current?.kind,
      failedPath: current ? `${args.act}/${current.pathSuffix}` : undefined,
      meta: metaFieldsOf(e),
      request: sanitizeLaunchBody(currentBody),
    };
  }
  return { created, skipped };
}

// בדיקה מול מטא בלי יצירה. execution_options=validate_only על סט ומודעה
// בלבד (Ad Account Ad Sets / Ads). תמונה לא נשלחת. בלי מזהה אב הקריאה
// נדלגת, כי מטא דורשת campaign_id אמיתי לסט ו-adset_id למודעה, ואין
// מזהה מקריאת validate_only (התשובה היא {"success":true}).
export async function validateLaunchWrites(args: {
  act: string;
  plan: LaunchPlan;
  pageId: string;
  instagramUserId?: string;
  pixelId?: string;
  regionKeys: Record<string, string>;
  termIds: Record<string, string>;
  existing: Map<string, ExistingRow>;
  post: (path: string, body: Record<string, string>) => Promise<unknown>;
  get?: (path: string, params: Record<string, string>) => Promise<unknown>;
}): Promise<{ checked: string[]; skipped: { objectKey: string; reason: string }[]; failures: LaunchFailure[] }> {
  const checked: string[] = [];
  const skipped: { objectKey: string; reason: string }[] = [];
  const failures: LaunchFailure[] = [];
  if (!args.plan.ok) return { checked, skipped, failures };
  const { ops, errors } = collectWriteOps(args.plan, {
    pageId: args.pageId,
    instagramUserId: args.instagramUserId,
    pixelId: args.pixelId,
    regionKeys: args.regionKeys,
    termIds: args.termIds,
  });
  if (errors.length) {
    failures.push({ objectKey: "plan", kind: "plan", name: "plan", message: errors.join(","), meta: null });
    return { checked, skipped, failures };
  }
  const ids = new Map<string, string>();
  const hashes = new Map<string, string>();
  for (const [key, row] of args.existing) {
    if (row.metaId) ids.set(key, row.metaId);
    if (row.imageHash && key.startsWith("image:")) hashes.set(key.slice("image:".length), row.imageHash);
  }
  for (const op of ops) {
    if (op.kind !== "adset" && op.kind !== "ad") continue;
    let body: Record<string, string>;
    try {
      body = substitute(op.body, ids, hashes);
    } catch (e) {
      skipped.push({ objectKey: op.objectKey, reason: (e as Error).message || "unresolved" });
      continue;
    }
    body = { ...body, execution_options: "[\"validate_only\"]" };
    try {
      assertSafeWrite(args.act, op.pathSuffix, body);
      const res = await args.post(`${args.act}/${op.pathSuffix}`, body) as { id?: string } | null;
      if (res?.id) {
        failures.push({
          objectKey: op.objectKey,
          kind: op.kind,
          name: op.name,
          message: `validate_only_returned_id:${res.id}`,
          meta: null,
        });
        break;
      }
      checked.push(op.objectKey);
    } catch (e) {
      failures.push({
        objectKey: op.objectKey,
        kind: op.kind,
        name: op.name,
        message: formatMetaError(e),
        meta: metaFieldsOf(e),
      });
    }
  }
  // POST /adcreatives אינו תומך ב-validate_only. התצוגה המקדימה היא GET
  // ולא יוצרת קריאייטיב. בלי hash שמור (התמונה עולה רק ביצירה) מדלגים.
  const accidental = failures.some((f) => f.message.startsWith("validate_only_returned_id"));
  if (args.get && !accidental) {
    for (const op of ops) {
      if (op.kind !== "creative") continue;
      if (args.existing.get(op.objectKey)?.metaId) {
        skipped.push({ objectKey: op.objectKey, reason: "already_created" });
        continue;
      }
      let body: Record<string, string>;
      try {
        body = substitute(op.body, ids, hashes);
      } catch (e) {
        skipped.push({ objectKey: op.objectKey, reason: (e as Error).message || "unresolved" });
        continue;
      }
      const request = sanitizeLaunchBody(body);
      try {
        assertSafeWrite(args.act, op.pathSuffix, body);
        await args.get(`${args.act}/generatepreviews`, {
          creative: JSON.stringify(creativePreviewBody(body)),
          ad_format: "DESKTOP_FEED_STANDARD",
        });
        checked.push(op.objectKey);
      } catch (e) {
        failures.push({
          objectKey: op.objectKey,
          kind: op.kind,
          name: op.name,
          message: formatMetaError(e),
          meta: metaFieldsOf(e),
          request,
        });
      }
    }
  }
  return { checked, skipped, failures };
}

export function summarizeLaunch(plan: LaunchPlan) {
  return {
    launch_key: plan.launchKey,
    ok: plan.ok,
    budget: plan.budget,
    warnings: plan.warnings,
    errors: plan.errors,
    skipped: plan.skipped,
    protected_campaign_ids: PROTECTED_CAMPAIGN_IDS,
    audiences: plan.audiences.map((a) => ({ key: a.key, name: a.name, rule: a.rule })),
    images_to_upload: plan.images.map((i) => ({ key: i.key, path: i.path, sha256: i.sha256, ratio: i.ratio })),
    campaigns: plan.campaigns.map((c) => ({
      key: c.key,
      name: c.name,
      objective: c.objective,
      housing: c.housing,
      special_ad_categories: c.housing ? ["HOUSING"] : [],
      special_ad_category_country: c.housing ? ["IL"] : [],
      status: PAUSED_STATUS,
      ad_sets: c.adSets.map((a) => ({
        key: a.key,
        name: a.name,
        status: PAUSED_STATUS,
        daily_budget_ils: a.dailyBudgetIls,
        destination: a.destination,
        lead_form_id: a.leadFormId,
        lead_form_name: a.leadFormName || "",
        optimization: a.optimization,
        age: [a.ageMin, a.ageMax],
        geo: a.geo,
        audiences: a.audienceKeys,
        extra_audience_ids: a.extraAudienceIds,
        flexible_logic: a.flexible.length > 1 ? "and" : a.flexible.length === 1 ? "or" : "none",
        flexible: a.flexible.map((group) => group.map((t) => ({ type: t.type, name: t.name }))),
        notes: a.notes,
        ads: a.ads.map((ad) => ({
          key: ad.key,
          name: ad.name,
          status: PAUSED_STATUS,
          headline: ad.headline,
          message: ad.message,
          description: ad.description || "",
          cta: ad.cta,
          landing_url: ad.landingUrl,
          lead_form_id: ad.leadFormId,
          images: ad.images.map((i) => ({ key: i.key, path: i.path, sha256: i.sha256, ratio: i.ratio })),
        })),
      })),
    })),
  };
}
