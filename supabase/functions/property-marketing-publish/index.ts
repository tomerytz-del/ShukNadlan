import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// תיאור שיווקי ופרסום לדף הפייסבוק — השרת שמרוקן את property_publications.
//
// ‏נקרא מ-pg_cron כל חמש דקות (‏§8 במיגרציה 20260906090000). הטריגר על
// ‏properties כותב לתור ברגע שהנכס נעשה active, וכאן קורים שני הדברים:
//
//   1. אם אין לנכס `marketing_description` — Claude כותב אחד, יחד עם
//      ‏`post_text` קצר לרשתות. שניהם נשמרים על הנכס, ולכן הם זמינים גם
//      ל-CRM, לדף הנכס ולכל ערוץ שיתווסף אחר כך. מה שהסוכן/ת כתב/ה לא
//      נדרס לעולם — בלי `force` הקוד לא נוגע בשדה מלא.
//   2. הפוסט יוצא לדף הפייסבוק של האתר.
//
// שני מסלולי פרסום, לפי מה שמוגדר בסודות:
//
//   ‏FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN → פרסום ישיר ל-Graph API.
//     המסלול המועדף בפרויקט הזה: אפליקציית ה-Meta וה-System User כבר קיימים
//     בזכות בוט הוואטסאפ, הטוקן אינו פג, ואין תלות חיצונית בדרך לדף.
//   ‏MAKE_FACEBOOK_WEBHOOK_URL  → הפוסט נשלח כ-JSON ל-Make, ושם מודול
//     ‏"Facebook Pages › Create a Post" מפרסם. שימושי כשרוצים לפצל את אותו
//     נכס לכמה ערוצים או לשנות את מבנה הפוסט בלי פריסה.
//
// ‏Graph מקבל עדיפות אם שניהם מוגדרים. בלי אף אחד מהם הפונקציה מחזירה
// ‏publish_not_configured ולא נוגעת בתור — נכס לא "נכשל" רק כי עוד לא
// חיברנו את הערוץ.
//
// ‏האימות זהה ל-saved-search-notify: סוד ה-cron ב-header, או service role,
// או JWT של מנהל/ת פלטפורמה (המסלול הידני, לכפתור עתידי ב-CRM).
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CRON_SECRET = Deno.env.get("ALERT_CRON_SECRET") || "";
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5";

const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_FACEBOOK_WEBHOOK_URL") || "";
const MAKE_WEBHOOK_SECRET = Deno.env.get("MAKE_WEBHOOK_SECRET") || "";

const FB_PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID") || "";
const FB_PAGE_TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
const GRAPH_VERSION = Deno.env.get("FACEBOOK_GRAPH_VERSION") || "v23.0";

// כמה נכסים בהרצה. הקצב האמיתי נשמר בתקרה היומית שב-pricing_config; כאן זו
// רק הגנה על זמן הריצה של הפונקציה — כל נכס הוא קריאה ל-Claude ועד שש
// קריאות ל-Meta.
const BATCH = 5;
const MAX_PHOTOS = 5;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// עובדות הנכס — אותה שפה שהאתר מדבר בה
// ---------------------------------------------------------------------------

const nis = (n: number | null | undefined) =>
  n === null || n === undefined ? "" : "₪" + Math.round(Number(n)).toLocaleString("he-IL");

/** "₪1,850,000" למכירה · "₪4,800 לחודש" להשכרה. */
function priceLine(row: any): string {
  if (row.price === null || row.price === undefined) return "";
  return row.deal_type === "rent" ? `${nis(row.price)} לחודש` : nis(row.price);
}

/** "4 חדרים · 98 מ״ר · קומה 3 מתוך 8" — רק מה שקיים במודעה. */
function specLine(row: any): string {
  const floor = row.floor === null || row.floor === undefined
    ? null
    : row.total_floors ? `קומה ${row.floor} מתוך ${row.total_floors}` : `קומה ${row.floor}`;
  return [
    row.rooms ? `${row.rooms} חדרים` : null,
    row.size_sqm ? `${Math.round(row.size_sqm)} מ״ר` : null,
    row.garden_sqm ? `גינה ${Math.round(row.garden_sqm)} מ״ר` : null,
    floor,
  ].filter(Boolean).join(" · ");
}

/** "רובע יזרעאל, עפולה" — השכונה קודמת, היא מה שמזהה את המיקום בעין. */
function placeLine(row: any): string {
  return [row.neighborhood, row.street, row.city].filter(Boolean).join(", ");
}

const propertyUrl = (id: string) =>
  `${SITE_BASE_URL}/property.html?id=${encodeURIComponent(id)}`;

/** כל מה שידוע על הנכס, בטקסט אחד — הקלט של Claude ושל בונה הפוסט. */
function facts(row: any): string {
  const dealType = row.deal_type === "rent" ? "להשכרה" : "למכירה";
  return [
    row.title ? `כותרת המודעה: ${row.title}` : null,
    `סוג עסקה: ${dealType}`,
    row.property_type ? `סוג נכס: ${row.property_type}` : null,
    placeLine(row) ? `מיקום: ${placeLine(row)}` : null,
    specLine(row) ? `נתונים: ${specLine(row)}` : null,
    priceLine(row) ? `מחיר: ${priceLine(row)}` : null,
    row.condition ? `מצב הנכס: ${row.condition}` : null,
    row.features?.length ? `מאפיינים: ${row.features.join(", ")}` : null,
    row.furniture_details ? `ריהוט: ${row.furniture_details}` : null,
    row.move_in_date ? `כניסה: ${row.move_in_date}` : null,
    row.description ? `תיאור המודעה כפי שנכתב על ידי הסוכן/ת: ${row.description}` : null,
    row.agent_name ? `סוכן/ת: ${row.agent_name}` : null,
    row.agency_name ? `משרד: ${row.agency_name}` : null,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// יצירת התיאור השיווקי
//
// ‏שתי תוצרות בקריאה אחת: תיאור ארוך (marketing_description, נשאר במערכת
// ומשמש בכל ערוץ) ופוסט קצר (post_text). הפרדה לשתי קריאות הייתה מכפילה
// עלות ומזמינה שני נוסחים שלא מדברים זה עם זה.
//
// המגבלה החשובה בפרומפט היא "רק מה שכתוב": מודל שממציא "קרוב לפארק" על נכס
// שלא נאמר עליו דבר יוצר מודעה שקרית, וזו חשיפה משפטית של הפלטפורמה — לא
// רק טקסט פחות טוב.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `את/ה קופירייטר/ית נדל"ן ישראלי/ת שכותב/ת עבור לוח הנכסים שוק נדל"ן.

חוקים מוחלטים:
1. מותר להשתמש אך ורק בעובדות שמופיעות בנתוני הנכס. אסור להמציא מרחק ממוסדות,
   נוף, שכנים, פוטנציאל השבחה, תשואה, או כל פרט שלא נמסר.
2. אין הבטחות תשואה, אין "השקעה בטוחה", אין הצהרות על מגמות מחירים.
3. אין אזכור של מוצא, דת, לאום או הרכב משפחתי — לא ישיר ולא ברמז.
4. לא לכתוב טלפונים, אימיילים או קישורים. המערכת מוסיפה אותם בעצמה.
5. עברית תקנית, גוף שלישי, ללא סימני קריאה כפולים וללא מילים כמו "מדהים",
   "חלומי", "הזדמנות שלא תחזור".
6. כשהנתונים דלים — לכתוב קצר. טקסט קצר ומדויק עדיף על טקסט ארוך ומנופח.

פלט: JSON תקין בלבד, בלי טקסט לפניו או אחריו, במבנה:
{"marketing_description": "...", "post_text": "..."}

marketing_description — 50 עד 90 מילים, פסקה אחת רציפה, מתארת את הנכס
ומסתיימת בהזמנה לצפייה.

post_text — פוסט לפייסבוק, עד 45 מילים, משפט פותח שמושך את העין, שתיים עד
שלוש אימוג'י לכל היותר, ובסוף שורה אחת עם 3 עד 5 האשטגים בעברית
(לדוגמה: #נדלן #עפולה #דירהלמכירה). בלי קישור ובלי טלפון.`;

async function generateMarketing(row: any): Promise<{ description: string; post: string } | null> {
  if (!ANTHROPIC_KEY) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `נתוני הנכס:\n${facts(row)}` }],
    }),
  });

  if (!res.ok) {
    throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  // המודל התבקש ל-JSON נקי, אבל גדר ```json היא הסטייה הנפוצה ולא שווה
  // להיכשל עליה.
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`תשובת Claude אינה JSON: ${raw.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  const description = String(parsed?.marketing_description ?? "").trim();
  const post = String(parsed?.post_text ?? "").trim();
  if (!description) throw new Error("Claude החזיר תיאור ריק");
  return { description, post: post || description };
}

// ---------------------------------------------------------------------------
// הרכבת הפוסט
//
// המבנה קבוע גם כשהטקסט משתנה: פתיח שיווקי, ואחריו שורות העובדות והקישור.
// גולש/ת בפייסבוק סורק/ת את השורות האלה לפני שהוא/היא קורא/ת מילה מהפתיח,
// ולכן הן לא נכנסות לתוך הטקסט החופשי אלא יושבות מתחתיו תמיד באותו סדר.
// ---------------------------------------------------------------------------
function buildMessage(row: any, marketing: { description: string; post: string }): string {
  const link = propertyUrl(row.property_id);
  const lead = (row.post_text?.trim() || marketing.post || marketing.description).trim();

  const lines = [lead, ""];
  const place = placeLine(row);
  const specs = specLine(row);
  const price = priceLine(row);

  if (place) lines.push(`📍 ${place}`);
  if (specs) lines.push(`🏠 ${specs}`);
  if (price) lines.push(`💰 ${price}`);
  if (row.listing_number) lines.push(`🔖 מודעה מס׳ ${row.listing_number}`);
  lines.push("");
  if (row.agent_name) {
    lines.push(`לפרטים: ${[row.agent_name, row.agency_name].filter(Boolean).join(" · ")}`);
  }
  if (!lead.includes(link)) lines.push(`🔗 ${link}`);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// פרסום — מסלול Make
// ---------------------------------------------------------------------------
async function publishViaMake(row: any, message: string, images: string[]) {
  const res = await fetch(MAKE_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MAKE_WEBHOOK_SECRET ? { "x-shuknadlan-secret": MAKE_WEBHOOK_SECRET } : {}),
    },
    body: JSON.stringify({
      property_id: row.property_id,
      listing_number: row.listing_number,
      message,
      link: propertyUrl(row.property_id),
      images,
      // השדות הבודדים נשלחים כדי שאפשר יהיה לבנות ב-Make תבנית משלו או
      // תמונה מעוצבת, בלי לפרסר את הטקסט המוכן.
      title: row.title,
      price: row.price,
      deal_type: row.deal_type,
      property_type: row.property_type,
      rooms: row.rooms,
      size_sqm: row.size_sqm,
      floor: row.floor,
      city: row.city,
      neighborhood: row.neighborhood,
      street: row.street,
      agent_name: row.agent_name,
      agency_name: row.agency_name,
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`make ${res.status}: ${body.slice(0, 300)}`);

  // ‏Make מחזיר כברירת מחדל "Accepted". תרחיש שמוגדר עם Webhook response
  // יכול להחזיר את מזהה הפוסט, ואז הוא נשמר ביומן.
  try {
    const j = JSON.parse(body);
    return { post_id: j?.post_id ?? null, post_url: j?.post_url ?? null };
  } catch {
    return { post_id: null, post_url: null };
  }
}

// ---------------------------------------------------------------------------
// פרסום — מסלול Graph API ישיר
//
// שלב אחד לכל תמונה (‏published=false, מחזיר media_fbid) ואז פוסט אחד ל-feed
// שמצרף את כולן. זה המבנה היחיד שנותן פוסט מרובה תמונות; ‎/photos‎ לבדו
// מפרסם תמונה אחת בכל פעם, כלומר חמישה פוסטים לאותו נכס.
//
// תמונה שנכשלת אינה מפילה את הפוסט: עדיף פוסט עם שלוש תמונות מתוך חמש על
// פני נכס שלא פורסם.
// ---------------------------------------------------------------------------
async function publishViaGraph(row: any, message: string, images: string[]) {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const link = propertyUrl(row.property_id);
  const mediaIds: string[] = [];

  for (const url of images.slice(0, MAX_PHOTOS)) {
    const photoForm = new URLSearchParams({
      url,
      published: "false",
      access_token: FB_PAGE_TOKEN,
    });
    const res = await fetch(`${base}/${FB_PAGE_ID}/photos`, { method: "POST", body: photoForm });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id) mediaIds.push(String(data.id));
    else console.warn("העלאת תמונה נכשלה", url, JSON.stringify(data).slice(0, 200));
  }

  const form = new URLSearchParams({ message, access_token: FB_PAGE_TOKEN });
  if (mediaIds.length) {
    mediaIds.forEach((id, i) =>
      form.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  } else {
    // בלי תמונות — פוסט קישור. פייסבוק ימשוך את התצוגה המקדימה מהעמוד.
    form.set("link", link);
  }

  const res = await fetch(`${base}/${FB_PAGE_ID}/feed`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    throw new Error(`facebook ${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  }

  const id = String(data.id);
  const postUrl = id.includes("_")
    ? `https://www.facebook.com/${FB_PAGE_ID}/posts/${id.split("_")[1]}`
    : `https://www.facebook.com/${id}`;
  return { post_id: id, post_url: postUrl };
}

// ---------------------------------------------------------------------------
// טיפול בנכס אחד
// ---------------------------------------------------------------------------
async function handle(sb: any, row: any, opts: { force: boolean; dryRun: boolean }) {
  const images: string[] = (row.images ?? []).filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u));
  if (row.marketing_image && /^https?:\/\//.test(row.marketing_image)) {
    // התמונה השיווקית המעוצבת קודמת לגלריה — היא נבנתה בדיוק בשביל פוסט כזה.
    images.unshift(row.marketing_image);
  }

  // 1. תיאור שיווקי — רק אם אין, אלא אם ביקשו במפורש לכתוב מחדש
  let generated = false;
  let marketing = {
    description: (row.marketing_description || "").trim(),
    post: (row.post_text || "").trim(),
  };

  if (!marketing.description || opts.force) {
    const fresh = await generateMarketing(row);
    if (fresh) {
      marketing = fresh;
      generated = true;
      if (!opts.dryRun) {
        const patch: Record<string, string> = { marketing_description: fresh.description };
        // ‏post_text של הסוכן/ת נשאר שלו/ה גם בכתיבה מחדש: המערכת משלימה
        // מה שחסר, לא מחליפה מה שנכתב ביד.
        if (!row.post_text?.trim()) patch.post_text = fresh.post;
        const { error } = await sb.from("properties").update(patch).eq("id", row.property_id);
        if (error) throw new Error(`שמירת התיאור נכשלה: ${error.message}`);
      }
    } else if (!marketing.description) {
      throw new Error("אין תיאור שיווקי ו-ANTHROPIC_API_KEY לא מוגדר");
    }
  }

  // 2. הפוסט
  const message = buildMessage(row, marketing);
  if (opts.dryRun) {
    return { property_id: row.property_id, dry_run: true, generated, message, images };
  }

  // ‏Graph קודם: מי שהגדיר טוקן דף התכוון לפרסם ישירות, ו-webhook ישן של
  // ‏Make שנשאר בסודות לא צריך לחטוף את הפוסט בשקט.
  const result = FB_PAGE_ID && FB_PAGE_TOKEN
    ? await publishViaGraph(row, message, images)
    : await publishViaMake(row, message, images);

  const { error: markErr } = await sb.rpc("mark_property_publication", {
    p_publication_id: row.publication_id,
    p_ok: true,
    p_message: message,
    p_post_id: result.post_id,
    p_post_url: result.post_url,
    p_error: null,
    p_description_generated: generated,
  });
  // הפוסט כבר בפייסבוק. שורה שנשארת pending תפורסם שוב בעוד חצי שעה, ולכן
  // כישלון בסימון לא נזרק אלא נרשם ומתוקן בכתיבה ישירה לטבלה — הדרך השנייה
  // לאותו מסד.
  if (markErr) {
    console.error("סימון הפרסום נכשל", row.property_id, markErr.message);
    await sb.from("property_publications").update({
      status: "posted",
      message,
      post_id: result.post_id,
      post_url: result.post_url,
      posted_at: new Date().toISOString(),
      description_generated: generated,
    }).eq("id", row.publication_id);
  }

  return { property_id: row.property_id, generated, post_id: result.post_id, post_url: result.post_url };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // אותה בחירה כמו ב-saved-search-notify: הסוד אופציונלי, כי הפונקציה לא
  // מקבלת תוכן מהקורא אלא מרוקנת תור קיים. ‏JWT של מנהל/ת פלטפורמה נבדק
  // בנפרד ומאפשר את המסלול הידני.
  const authHeader = req.headers.get("Authorization") || "";
  const cronOk = !CRON_SECRET || req.headers.get("x-alert-cron-secret") === CRON_SECRET;
  const serviceOk = authHeader === `Bearer ${serviceRoleKey}`;

  const sb = createClient(supabaseUrl, serviceRoleKey);

  let adminOk = false;
  if (!cronOk && !serviceOk && authHeader) {
    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await authed.auth.getUser();
    if (userData?.user) {
      const { data: member } = await sb
        .from("agency_members")
        .select("is_platform_admin, active")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      adminOk = Boolean(member?.active && member?.is_platform_admin);
    }
  }

  if (!cronOk && !serviceOk && !adminOk) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // ‏pg_cron שולח בקשה בלי גוף
  }

  const propertyId: string | null = body?.property_id ?? null;
  const force = Boolean(body?.force);
  const dryRun = Boolean(body?.dry_run);

  if (!dryRun && !MAKE_WEBHOOK_URL && !(FB_PAGE_ID && FB_PAGE_TOKEN)) {
    // אף ערוץ לא מחובר. לא נוגעים בתור: השורות ימתינו לחיבור ולא יישרפו
    // על חמישה ניסיונות כושלים.
    return json({ error: "publish_not_configured" }, 500);
  }

  // בקשה ידנית לנכס מסוים — מכניסים אותו לתור (או מחזירים אותו אליו) לפני
  // המשיכה. בלי זה נכס שכבר פורסם לא יופיע ברשימה.
  //
  // ‏בדיקה יבשה לא מחזירה שורה לתור: המשמעות הייתה שהצצה בטקסט של נכס
  // שכבר פורסם מזמינה אותו לפרסום שני בהרצת ה-cron הבאה. לכן dry_run רואה
  // רק נכס שממתין ממילא.
  if (propertyId) {
    const { error } = await sb.rpc("queue_property_publication", {
      p_property_id: propertyId,
      p_channel: "facebook_page",
      p_force: !dryRun,
      p_delay_minutes: 0,
    });
    if (error) return json({ error: "queue_failed", detail: error.message }, 500);
  }

  const { data: rows, error } = await sb.rpc("pending_property_publications", {
    p_limit: propertyId ? 1 : BATCH,
    p_property_id: propertyId,
  });
  if (error) return json({ error: "queue_read_failed", detail: error.message }, 500);
  if (!rows?.length) {
    return json({
      ok: true,
      processed: 0,
      ...(propertyId
        ? { note: "הנכס אינו ממתין לפרסום — לא פעיל, או שכבר פורסם ובבדיקה יבשה לא מחזירים אותו לתור" }
        : {}),
    });
  }

  const results: any[] = [];
  for (const row of rows) {
    try {
      // התפיסה קודמת לכל השאר. שתי הרצות חופפות של ה-cron מושכות את אותה
      // שורה, ובלי זה שתיהן היו מפרסמות את אותו נכס.
      if (!dryRun) {
        const { data: claimed } = await sb.rpc("claim_property_publication", {
          p_publication_id: row.publication_id,
        });
        if (!claimed) {
          results.push({ property_id: row.property_id, skipped: "claimed_by_another_run" });
          continue;
        }
      }
      results.push(await handle(sb, row, { force, dryRun }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("פרסום נכס נכשל", row.property_id, message);
      if (!dryRun) {
        await sb.rpc("mark_property_publication", {
          p_publication_id: row.publication_id,
          p_ok: false,
          p_message: null,
          p_post_id: null,
          p_post_url: null,
          p_error: message.slice(0, 500),
          p_description_generated: false,
        });
      }
      results.push({ property_id: row.property_id, error: message });
    }
  }

  return json({ ok: true, processed: results.length, results });
});
