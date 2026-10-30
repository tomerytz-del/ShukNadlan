// ============================================================================
// התראת "ליד חדש" בוואטסאפ - הנוסח המלא (23.10.2026, אושר ע"י תומר).
//
// ‏notifications.title/body של new_lead נשארים כפי שהם (הפעמון, הבוט, המייל
// קוראים אותם). כאן רק ההודעה בוואטסאפ: notification-push טוען את הליד, הנכס
// והשכונה לפי lead_id, ומרכיב ממנו הודעה אישית עם שם הפונה, הערוץ שממנו הגיע/ה
// ופרטי הנכס.
//
// ליד שלא נפתח (status != 'unlocked'): **בלי שם ובלי ציטוט** - "פונה חדש/ה".
// הסוכן/ת עוד לא שילם/ה על הפרטים, והוואטסאפ לא יכול לעקוף את זה.
//
// כל כשל בטעינה מחזיר מפה ריקה, וההתראה יוצאת בנוסח הישן. אף פעם לא נופלים.
// ============================================================================

export type LeadInfo = {
  masked: boolean;
  leadType: string;
  fromPost?: boolean;
  name: string;      // "פונה חדש/ה" בליד נעול
  source: string;    // תווית בעברית, "" כשלא ידוע
  what: string;      // "דירה 4 חד׳ למכירה · רובע יזרעאל · 1,495,000 ₪", "" כשאין
  excerpt: string;   // "" בליד נעול / בלי הודעה
};

// ‏leads.source -> תווית. ‏null הוא טופס באתר (property-inquiry-intake וחבריו
// לא כותבים source). ערך לא מוכר - בלי "דרך ..." בכלל.
export const SOURCE_LABEL: Record<string, string> = {
  facebook_dm: "פייסבוק מסנג'ר",
  facebook_comment: "תגובה בפייסבוק",
  instagram_dm: "אינסטגרם דיירקט",
  instagram_comment: "תגובה באינסטגרם",
  site: "האתר",
  agent_page: "דף הסוכן באתר",
  agency_page: "דף המשרד באתר",
  whatsapp: "ווצאפ",
  call: "שיחת טלפון",
  store: "האתר",
  meta_ads_property_form: "מודעה ממומנת בפייסבוק/אינסטגרם",
  meta_ads_owner_form: "מודעה ממומנת בפייסבוק/אינסטגרם",
  meta_ads_buyer_form: "מודעה ממומנת בפייסבוק/אינסטגרם",
  // ‏פוסט שהסוכן הסורק מצא, אחרי הסכמה (scraped_lead_set_consent, docs/scraped-leads.md)
  facebook_group: "קבוצת פייסבוק",
  facebook_marketplace: "מרקטפלייס של פייסבוק",
};

// הפונה לא פנה/תה אלינו: פרסם/ה פוסט, ואישר/ה שמתווך/ת יחזור/תחזור אליו/ה
const POST_SOURCES = new Set(["facebook_group", "facebook_marketplace"]);

export function sourceLabel(src: string | null | undefined): string {
  if (src == null || String(src).trim() === "") return "האתר";
  const s = String(src).trim();
  if (SOURCE_LABEL[s]) return SOURCE_LABEL[s];
  if (s.startsWith("facebook")) return "פייסבוק";
  if (s.startsWith("instagram")) return "אינסטגרם";
  if (s.startsWith("meta_ads")) return "מודעה ממומנת בפייסבוק/אינסטגרם";
  return "";
}

export const MASKED_NAME = "פונה חדש/ה";

// ‏cta_url: עד 20 יחידות UTF-16. "👈 לפרטי הפונה ולחזרה אליו" הוא 26, ולכן זה
// (18). ‏Meta דוחה כותרת ארוכה, וההודעה הייתה יורדת לטקסט.
export const LEAD_CTA = "לפרטי הפונה ולחזרה";

const flat = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => {
  const a = Array.from(s);
  return a.length > n ? a.slice(0, n - 1).join("").trimEnd() + "…" : s;
};

function fmtRooms(r: unknown): string {
  const n = Number(r);
  if (!r || !Number.isFinite(n) || n <= 0) return "";
  return (Math.round(n * 10) / 10).toString();
}

function fmtPrice(p: unknown): string {
  const n = Number(p);
  if (!p || !Number.isFinite(n) || n <= 0) return "";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ₪";
}

type Row = Record<string, any>;

/** "דירה 4 חד׳ למכירה · רובע יזרעאל · 1,495,000 ₪" - מה שיש. */
export function describeWhat(lead: Row, prop: Row | null, hood: string | null): string {
  const type = flat(prop?.property_type || lead.property_type);
  const rooms = fmtRooms(prop?.rooms);
  const dealType = prop?.deal_type || lead.deal_type;
  const deal = dealType === "sale" ? "מכירה" : dealType === "rent" ? "השכרה" : "";
  const head = [type, rooms ? `${rooms} חד׳` : "", deal ? `ל${deal}` : ""].filter(Boolean).join(" ");
  const place = flat(hood) || flat(prop?.city || lead.city);
  const price = fmtPrice(prop?.price);
  return [head, place, price].filter(Boolean).join(" · ");
}

export function buildLeadInfo(lead: Row, prop: Row | null, hood: string | null): LeadInfo {
  const masked = lead.status !== "unlocked";
  const name = masked ? MASKED_NAME : (clip(flat(lead.raw_name), 40) || MASKED_NAME);
  const msg = flat(lead.raw_message).replace(/"/g, "״");
  return {
    masked,
    leadType: String(lead.lead_type || ""),
    fromPost: POST_SOURCES.has(String(lead.source || "")),
    name,
    source: sourceLabel(lead.source),
    what: describeWhat(lead, prop, hood),
    excerpt: masked || !msg ? "" : clip(msg, 120),
  };
}

/** טוען ליד+נכס+שכונה לכל lead_id של new_lead באצווה. כשל - מפה ריקה. */
// deno-lint-ignore no-explicit-any
export async function loadLeadInfo(sb: any, batch: Row[]): Promise<Map<string, LeadInfo>> {
  const out = new Map<string, LeadInfo>();
  try {
    const ids = [...new Set(batch.flatMap((r) => (r.items || []) as Row[])
      .filter((it) => it.type === "new_lead" && typeof it.lead_id === "string")
      .map((it) => it.lead_id as string))];
    if (!ids.length) return out;

    const { data: leads, error } = await sb.from("leads")
      .select("id,status,lead_type,raw_name,raw_message,source,deal_type,city,property_type,property_id,neighborhood_id")
      .in("id", ids);
    if (error) throw error;

    const propIds = [...new Set((leads || []).map((l: Row) => l.property_id).filter(Boolean))];
    const props = new Map<string, Row>();
    if (propIds.length) {
      const { data, error: pErr } = await sb.from("properties")
        .select("id,property_type,rooms,price,deal_type,city,neighborhood_id").in("id", propIds);
      if (pErr) throw pErr;
      for (const p of data || []) props.set(p.id, p);
    }

    const hoodIds = [...new Set((leads || []).map((l: Row) =>
      props.get(l.property_id)?.neighborhood_id || l.neighborhood_id).filter(Boolean))];
    const hoods = new Map<string, string>();
    if (hoodIds.length) {
      const { data, error: nErr } = await sb.from("neighborhoods").select("id,name").in("id", hoodIds);
      if (nErr) throw nErr;
      for (const n of data || []) hoods.set(n.id, n.name);
    }

    for (const l of (leads || []) as Row[]) {
      const p = props.get(l.property_id) || null;
      out.set(l.id, buildLeadInfo(l, p, hoods.get(p?.neighborhood_id || l.neighborhood_id) || null));
    }
  } catch (e) {
    console.error("lead info for new_lead alert failed, using plain format", e instanceof Error ? e.message : String(e));
  }
  return out;
}

function intro(li: LeadInfo): string {
  const via = li.source ? ` דרך ${li.source}` : "";
  if (li.fromPost) {
    const who = li.leadType === "owner_inbound" ? "בעל/ת נכס" : "מחפש/ת נכס";
    return `${li.name} - ${who} - פרסם/ה פוסט ב${li.source} ואישר/ה שנחזור${li.what ? ":" : "!"}`;
  }
  if (li.leadType === "owner_inbound") return `${li.name} פנה/תה עכשיו${via} - בעל/ת נכס${li.what ? ":" : "!"}`;
  return `${li.name} פנה/תה עכשיו${via}${li.what ? " ומתעניין/ת ב:" : "!"}`;
}

/** הודעה מלאה (חלון 24 השעות), כשההודעה כולה היא ליד אחד. */
export function leadText(first: string, li: LeadInfo, _link: string | null, optOutLine: string): string {
  const lines = [
    first ? `🔥 ${first}, נכנס לך ליד חם!` : "🔥 נכנס לך ליד חם!",
    "",
    intro(li),
    ...(li.what ? [`🏠 ${li.what}`] : []),
    ...(li.excerpt ? ["", `💬 "${li.excerpt}"`] : []),
    ...(li.masked ? ["", "🔒 שם הפונה ופרטיו יוצגו אחרי פתיחת הליד במערכת."] : []),
    "",
    "⏱️ מי שחוזר ראשון - סוגר. כדאי לחזור אליו עכשיו!",
    "",
    optOutLine,
  ];
  return lines.join("\n");
}

/** שורה אחת ל-{{2}} בתבנית - בלי \n/טאב, ובלי 4+ רווחים (templateSummary מנקה שוב). */
export function leadTemplateLine(li: LeadInfo, _url: string | null, alone: boolean): string {
  const parts = [
    `🔥 ליד חם! ${intro(li)}${li.what ? ` 🏠 ${li.what}` : ""}`,
    li.excerpt ? `💬 "${clip(li.excerpt, 80)}"` : "",
    alone ? "⏱️ מי שחוזר ראשון - סוגר!" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** שורה בתוך הודעה מרוכזת (כמה התראות) - כותרת וגוף במקום הנוסח הגנרי. */
export function leadListTitle(li: LeadInfo): string {
  return `ליד חם: ${li.name}${li.source ? ` דרך ${li.source}` : ""}`;
}
