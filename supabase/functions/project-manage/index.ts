import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  bool, corsHeaders, developerCore, email, int, json, longText, MEDIA_KINDS, num, oneOf,
  phoneE164, PROJECT_FEATURES, PROJECT_PROPERTY_TYPES, PROJECT_STAGES,
  REQUIRED_DEVELOPER_FIELDS, safeUrl, slugify, stringList, text, UNIT_AVAILABILITY,
} from "../_shared/projects.ts";
import { registryMessage, verifyCompanyNumber } from "../_shared/company-registry.ts";
import { blockUnknown, cachedLookup, registryColumns, registryEnabled } from "../_shared/registry-cache.ts";

// ============================================================================
// ניהול הפרויקטים של היזם — כל הפעולות בפונקציה אחת
//
// ‏action אחד לכל פעולה, ולא שש פונקציות קצה: כולן פותחות באותן שלוש
// שורות בדיוק (מי המשתמש/ת → איזו חברה → האם הפרויקט שלה), וכולן צריכות
// את אותו ניקוי קלט. שש עותקים של הבדיקה הזו הם שש הזדמנויות לשכוח אותה
// באחת מהן.
//
// למה בכלל פונקציית קצה ולא כתיבה ישירה מהדפדפן דרך RLS: שלוש מהפעולות
// (activate_page, promote, delete) נוגעות בארנק או מוחקות נתונים, ולכן הן
// חייבות לרוץ ב-service_role מול ה-RPC-ים. ברגע שהן כאן, גם save ו-media
// עוברות כאן — אחרת חצי מהמסך מדבר עם הטבלה וחצי עם הפונקציה, ואי אפשר
// לענות על "איפה נבדק הקלט".
//
// ‏save אינו מקבל ולא נוגע ב-status, subscription_*, is_promoted,
// promoted_until, delete_* ו-views_count. אלה תוצאה של תשלום או של פעולה
// מפורשת, ולא שדות שטופס עריכה יכול לכתוב — עמודה כזו בגוף הבקשה הייתה
// הופכת "עדכון תיאור" לדף נחיתה בחינם.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_PROJECTS_PER_DEVELOPER = 60;
const MAX_MEDIA_PER_PROJECT = 120;
const MAX_UNIT_TYPES_PER_PROJECT = 40;

/** השדות שטופס העריכה רשאי לכתוב. כל מה שאינו כאן פשוט לא מגיע ל-UPDATE. */
function projectFields(body: Record<string, unknown>) {
  return {
    name: text(body.name, 120),
    tagline: text(body.tagline, 200),
    description: longText(body.description, 8000),
    marketing_summary: longText(body.marketing_summary, 4000),

    city: text(body.city, 80),
    neighborhood_id: typeof body.neighborhood_id === "string" && body.neighborhood_id
      ? body.neighborhood_id : null,
    address: text(body.address, 200),
    street: text(body.street, 120),
    lat: num(body.lat, -90, 90),
    lng: num(body.lng, -180, 180),

    project_stage: oneOf(body.project_stage, PROJECT_STAGES) ?? "pre_sale",
    occupancy_date: typeof body.occupancy_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.occupancy_date)
      ? body.occupancy_date : null,
    occupancy_text: text(body.occupancy_text, 120),

    buildings_count: int(body.buildings_count, 0, 500),
    floors_count: int(body.floors_count, 0, 200),
    total_units: int(body.total_units, 0, 10000),
    available_units: int(body.available_units, 0, 10000),

    min_price: num(body.min_price, 0, 500_000_000),
    max_price: num(body.max_price, 0, 500_000_000),
    min_rooms: num(body.min_rooms, 0, 30),
    max_rooms: num(body.max_rooms, 0, 30),
    min_size_sqm: num(body.min_size_sqm, 0, 100_000),
    max_size_sqm: num(body.max_size_sqm, 0, 100_000),
    property_types: stringList(body.property_types, PROJECT_PROPERTY_TYPES, 9),
    features: stringList(body.features, PROJECT_FEATURES, 16),

    logo_url: safeUrl(body.logo_url),
    cover_url: safeUrl(body.cover_url),
    colors: sanitizeColors(body.colors),

    video_url: safeUrl(body.video_url),
    tour_3d_url: safeUrl(body.tour_3d_url),
    brochure_url: safeUrl(body.brochure_url),

    contact_name: text(body.contact_name, 120),
    contact_phone: text(body.contact_phone, 40),
    contact_phone_e164: phoneE164(body.contact_phone),
    contact_email: email(body.contact_email),
    whatsapp_e164: phoneE164(body.whatsapp ?? body.contact_phone),
  };
}

/** ‏colors מוזרק ל-documentElement.style בדף הפרויקט, ולכן הוא נבדק כאן
 *  ולא רק מוצג: ערך שאינו צבע הקס הוא הזרקת CSS לכל מי שיפתח את הדף. */
function sanitizeColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const key of ["brand", "brand_dark", "accent", "accent_dark"]) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim())) out[key] = v.trim().toLowerCase();
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: developer } = await supabase
    .from("developers").select("id, status").eq("user_id", userData.user.id).maybeSingle();

  const action = typeof body.action === "string" ? body.action : "";

  // ---------------------------------------------------------------------
  // פתיחת חברה למי שכבר מחובר/ת
  //
  // זהו המסלול של כניסת Google: היא יוצרת משתמש ב-auth.users אבל לא שורת
  // ‏developers, ולכן הכניסה הראשונה נוחתת על מסך "פתיחת חברה" ומגיעה
  // לכאן. ‏developer-signup אינו מתאים — הוא יוצר גם את חשבון ה-Auth,
  // ולמשתמש/ת הזה/הזאת כבר יש אחד.
  //
  // הפעולה היחידה שמותרת לפני שיש חברה, ולכן היא נבדקת לפני הבדיקה
  // שלמטה. גרעין פרטי החברה נדרש כאן במלואו, בדיוק כמו בטופס ההרשמה.
  // ---------------------------------------------------------------------
  if (action === "create_developer") {
    if (developer) return json({ error: "developer_exists" }, 409);

    const core = developerCore(body);
    if (!core.ok) {
      return json({
        error: "missing_fields", missing: core.missing, invalid: core.invalid,
        required: REQUIRED_DEVELOPER_FIELDS,
      }, 400);
    }

    // אותה בדיקה בדיוק של developer-signup — מסלול Google אינו פרצה
    // שעוקפת את רשם החברות.
    let registry = null;
    if (await registryEnabled(supabase)) {
      registry = await cachedLookup(supabase, core.value.company_number, verifyCompanyNumber);
      if (registry.status === "inactive" || (registry.status === "not_found" && await blockUnknown(supabase))) {
        return json({
          error: "company_registry_rejected",
          registry_status: registry.status,
          detail: registryMessage(registry),
        }, 409);
      }
    }

    let baseSlug = slugify(core.value.name, "developer");
    let finalSlug = baseSlug;
    for (let attempt = 2; ; attempt++) {
      const { data: taken } = await supabase
        .from("developers").select("id").eq("slug", finalSlug).maybeSingle();
      if (!taken) break;
      finalSlug = `${baseSlug}-${attempt}`;
      if (attempt > 50) { finalSlug = `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`; break; }
    }

    const { data: created, error } = await supabase
      .from("developers")
      .insert({
        user_id: userData.user.id,
        slug: finalSlug,
        name: core.value.name,
        company_number: core.value.company_number,
        contact_name: core.value.contact_name,
        phone: core.value.phone,
        phone_e164: core.value.phone_e164,
        address: core.value.address,
        city: core.value.city,
        legal_name: text(body.legal_name, 160),
        tagline: text(body.tagline, 160),
        // הכתובת מ-Google היא ברירת המחדל, ולא ערך שהמשתמש/ת בחר/ה
        // להציג. אפשר לשנות אותה במסך דף החברה.
        email: email(body.email) ?? userData.user.email ?? null,
        website: safeUrl(body.website),
        founded_year: int(body.founded_year, 1900, new Date().getFullYear()),
        projects_delivered: int(body.projects_delivered, 0, 5000),
        ...(registry ? registryColumns(registry) : {}),
      })
      .select("id, slug")
      .single();

    if (error) {
      // ‏unique על company_number: אותה חברה כבר רשומה תחת חשבון אחר.
      // ההודעה הזו חשובה — בלעדיה זו "שגיאת מסד" בלי שום דרך קדימה.
      if (/developers_company_number_key/.test(error.message)) {
        return json({ error: "company_number_taken" }, 409);
      }
      return json({ error: "db_error", detail: error.message }, 500);
    }
    return json({
      success: true, developer_id: created.id, developer_slug: created.slug,
      registry_status: registry?.status ?? "unverified",
      registry_message: registry ? registryMessage(registry) : null,
    });
  }

  if (!developer) return json({ error: "no_developer_account" }, 403);
  if (developer.status !== "active") return json({ error: "developer_suspended" }, 403);
  const projectId = typeof body.project_id === "string" ? body.project_id : null;

  // כל פעולה שנוגעת בפרויקט מאמתת בעלות פעם אחת, כאן. ה-RPC-ים בודקים
  // שוב בעצמם — הם security definer ואי אפשר להישען על כך שהקורא בדק.
  async function ownProject(): Promise<boolean> {
    if (!projectId) return false;
    const { data } = await supabase
      .from("projects").select("id").eq("id", projectId).eq("developer_id", developer.id).maybeSingle();
    return !!data;
  }

  try {
    switch (action) {
      // ---------------------------------------------------------------
      case "save": {
        const fields = projectFields(body);
        if (!fields.name) return json({ error: "missing_name" }, 400);

        if (projectId) {
          if (!await ownProject()) return json({ error: "not_your_project" }, 403);
          const { data, error } = await supabase
            .from("projects").update(fields).eq("id", projectId).select("id, slug, status").single();
          if (error) return json({ error: "db_error", detail: error.message }, 500);
          return json({ success: true, project: data });
        }

        // התקרה אינה מגבלה עסקית אלא בלם: חשבון שנפרץ יכול היה לייצר
        // אלפי דפי נחיתה ריקים לפני שמישהו שם לב.
        const { data: existing } = await supabase
          .from("projects").select("id").eq("developer_id", developer.id);
        if ((existing?.length ?? 0) >= MAX_PROJECTS_PER_DEVELOPER) {
          return json({ error: "project_limit_reached", limit: MAX_PROJECTS_PER_DEVELOPER }, 409);
        }

        // פרויקט חדש נולד כטיוטה. הוא עולה לאוויר רק ב-activate_page,
        // כלומר אחרי שהמנוי החודשי שולם — אין מסלול שבו דף נחיתה מתפרסם
        // בלי חיוב.
        const { data, error } = await supabase
          .from("projects").insert({ ...fields, developer_id: developer.id, status: "draft" })
          .select("id, slug, status").single();
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ success: true, project: data });
      }

      // ---------------------------------------------------------------
      case "set_status": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        // רק השהיה וחידוש. חזרה ל-active מותרת אך ורק כשהמנוי בתוקף,
        // אחרת "השהיה" הייתה הופכת לדרך לפרסם בחינם.
        const next = oneOf(body.status, ["active", "paused"] as const);
        if (!next) return json({ error: "bad_status" }, 400);
        if (next === "active") {
          const { data: p } = await supabase
            .from("projects").select("subscription_expires_at").eq("id", projectId).single();
          const until = p?.subscription_expires_at ? new Date(p.subscription_expires_at) : null;
          if (!until || until <= new Date()) return json({ error: "subscription_required" }, 402);
        }
        const { error } = await supabase.from("projects").update({ status: next }).eq("id", projectId);
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ success: true, status: next });
      }

      // ---------------------------------------------------------------
      case "activate_page": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const { data, error } = await supabase.rpc("project_activate_page", {
          p_project_id: projectId, p_developer_id: developer.id,
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json(data, data?.error ? (data.error === "insufficient_balance" ? 402 : 400) : 200);
      }

      // ---------------------------------------------------------------
      case "promote": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const { data, error } = await supabase.rpc("project_promote", {
          p_project_id: projectId, p_developer_id: developer.id,
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        const status: Record<string, number> = {
          insufficient_balance: 402, already_promoted: 409, page_not_live: 409, not_your_project: 403,
        };
        return json(data, data?.error ? (status[data.error] ?? 400) : 200);
      }

      // ---------------------------------------------------------------
      // מחיקה בשני צעדים. הצעד הראשון מוריד את הדף מהאוויר ומחזיר טוקן;
      // הצעד השני מוחק, ורק עם אותו טוקן. הטוקן אינו סוד — הוא ההוכחה
      // שהמסך שמאשר הוא המסך שביקש, ולא לחיצה כפולה על אותו כפתור.
      case "request_delete": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const { data, error } = await supabase.rpc("project_request_delete", {
          p_project_id: projectId, p_developer_id: developer.id,
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json(data, data?.error ? 400 : 200);
      }

      case "cancel_delete": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const { data, error } = await supabase.rpc("project_cancel_delete", {
          p_project_id: projectId, p_developer_id: developer.id,
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json(data, data?.error ? 400 : 200);
      }

      case "confirm_delete": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const token = typeof body.confirm_token === "string" ? body.confirm_token : null;
        if (!token) return json({ error: "missing_confirm_token" }, 400);
        const { data, error } = await supabase.rpc("project_confirm_delete", {
          p_project_id: projectId, p_developer_id: developer.id, p_token: token,
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json(data, data?.error ? 400 : 200);
      }

      // ---------------------------------------------------------------
      // הגלריה נשמרת כרשימה שלמה ולא כפריטים בודדים: הסדר הוא נתון, וגרירה
      // של תמונה במסך משנה את כל המספרים. מחיקה והוספה מחדש בטרנזקציה אחת
      // היא גם מה שמונע מצב שבו שני פריטים נושאים אותו sort_order.
      case "save_media": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const raw = Array.isArray(body.media) ? body.media : [];
        const items = raw.slice(0, MAX_MEDIA_PER_PROJECT).map((m, i) => {
          const item = (m ?? {}) as Record<string, unknown>;
          const url = safeUrl(item.url);
          if (!url) return null;
          return {
            project_id: projectId,
            kind: oneOf(item.kind, MEDIA_KINDS) ?? "image",
            url,
            thumb_url: safeUrl(item.thumb_url),
            title: text(item.title, 120),
            caption: text(item.caption, 400),
            file_size: int(item.file_size, 0, 2_000_000_000),
            downloadable: bool(item.downloadable),
            sort_order: i,
          };
        }).filter((m): m is NonNullable<typeof m> => m !== null);

        const { error: delErr } = await supabase.from("project_media").delete().eq("project_id", projectId);
        if (delErr) return json({ error: "db_error", detail: delErr.message }, 500);
        if (items.length) {
          const { error } = await supabase.from("project_media").insert(items);
          if (error) return json({ error: "db_error", detail: error.message }, 500);
        }
        return json({ success: true, count: items.length });
      }

      // ---------------------------------------------------------------
      case "save_unit_types": {
        if (!await ownProject()) return json({ error: "not_your_project" }, 403);
        const raw = Array.isArray(body.unit_types) ? body.unit_types : [];
        const items = raw.slice(0, MAX_UNIT_TYPES_PER_PROJECT).map((u, i) => {
          const item = (u ?? {}) as Record<string, unknown>;
          const name = text(item.name, 80);
          if (!name) return null;
          return {
            project_id: projectId,
            name,
            rooms: num(item.rooms, 0, 30),
            size_sqm: num(item.size_sqm, 0, 100_000),
            balcony_sqm: num(item.balcony_sqm, 0, 10_000),
            garden_sqm: num(item.garden_sqm, 0, 100_000),
            floor_plan_url: safeUrl(item.floor_plan_url),
            price: num(item.price, 0, 500_000_000),
            units_total: int(item.units_total, 0, 10_000),
            units_available: int(item.units_available, 0, 10_000),
            availability: oneOf(item.availability, UNIT_AVAILABILITY) ?? "available",
            notes: text(item.notes, 400),
            sort_order: i,
          };
        }).filter((u): u is NonNullable<typeof u> => u !== null);

        const { error: delErr } = await supabase.from("project_unit_types").delete().eq("project_id", projectId);
        if (delErr) return json({ error: "db_error", detail: delErr.message }, 500);
        if (items.length) {
          const { error } = await supabase.from("project_unit_types").insert(items);
          if (error) return json({ error: "db_error", detail: error.message }, 500);
        }
        return json({ success: true, count: items.length });
      }

      // ---------------------------------------------------------------
      // ---------------------------------------------------------------
      // עריכת דף החברה. גרעין החובה נדרש גם כאן: חברה שתוכל לרוקן את
      // הח״פ במסך העריכה אחרי שמילאה אותו בהרשמה היא בדיוק אותה חברה
      // בלי ח״פ. ה-CHECK במסד היה תופס את זה בכל מקרה — הבדיקה כאן היא
      // מה שהופך את זה מ"שגיאת מסד" להודעה שאפשר לפעול לפיה.
      case "save_developer": {
        const core = developerCore({ ...body, company_name: body.name ?? body.company_name });
        if (!core.ok) {
          return json({
            error: "missing_fields", missing: core.missing, invalid: core.invalid,
            required: REQUIRED_DEVELOPER_FIELDS,
          }, 400);
        }
        // שינוי הח״פ מבטל את האימות הקודם — הוא נעשה על מספר אחר. בלי
        // זה אפשר היה להירשם עם מספר תקין ואז להחליף אותו לכל דבר,
        // והשורה הייתה ממשיכה להציג "מאומת".
        const { data: before } = await supabase
          .from("developers").select("company_number").eq("id", developer.id).single();
        let registry = null;
        if (before?.company_number !== core.value.company_number && await registryEnabled(supabase)) {
          registry = await cachedLookup(supabase, core.value.company_number, verifyCompanyNumber);
          if (registry.status === "inactive" || (registry.status === "not_found" && await blockUnknown(supabase))) {
            return json({
              error: "company_registry_rejected",
              registry_status: registry.status,
              detail: registryMessage(registry),
            }, 409);
          }
        }

        const { error } = await supabase.from("developers").update({
          name: core.value.name,
          company_number: core.value.company_number,
          ...(registry ? registryColumns(registry) : {}),
          contact_name: core.value.contact_name,
          phone: core.value.phone,
          phone_e164: core.value.phone_e164,
          address: core.value.address,
          city: core.value.city,
          legal_name: text(body.legal_name, 160),
          logo_url: safeUrl(body.logo_url),
          cover_url: safeUrl(body.cover_url),
          colors: sanitizeColors(body.colors),
          tagline: text(body.tagline, 200),
          description: longText(body.description, 8000),
          email: email(body.email),
          website: safeUrl(body.website),
          founded_year: int(body.founded_year, 1900, new Date().getFullYear()),
          projects_delivered: int(body.projects_delivered, 0, 5000),
        }).eq("id", developer.id);
        if (error) {
          if (/developers_company_number_key/.test(error.message)) {
            return json({ error: "company_number_taken" }, 409);
          }
          return json({ error: "db_error", detail: error.message }, 500);
        }
        return json({
          success: true,
          registry_status: registry?.status ?? null,
          registry_message: registry ? registryMessage(registry) : null,
        });
      }

      // ---------------------------------------------------------------
      // טעינת ארנק. ‏test_mode כל עוד אין ספק סליקה מחובר — בדיוק כמו
      // wallet-topup בעולם התיווך, כולל התקרה שמונעת "טעינה" של מיליון.
      case "topup": {
        const amount = num(body.amount, 100, 5000);
        if (amount === null) return json({ error: "bad_amount", min: 100, max: 5000 }, 400);
        const { error: topErr } = await supabase.from("developer_topups")
          .insert({ developer_id: developer.id, amount, status: "paid", test_mode: true });
        if (topErr) return json({ error: "db_error", detail: topErr.message }, 500);

        const { data: current } = await supabase
          .from("developers").select("credit_balance").eq("id", developer.id).single();
        const next = Number(current?.credit_balance ?? 0) + amount;
        const { error } = await supabase
          .from("developers").update({ credit_balance: next }).eq("id", developer.id);
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ success: true, credit_balance: next, test_mode: true });
      }

      // ---------------------------------------------------------------
      // תמונת מצב אחת לדשבורד: החברה, הפרויקטים והמחירים. הדשבורד קורא
      // הכול דרך RLS חוץ מהמחירים, ולכן זה מה שחוסך לו שאילתה שנייה.
      case "bootstrap": {
        const [{ data: dev }, { data: projects }, { data: prices }] = await Promise.all([
          supabase.from("developers").select("*").eq("id", developer.id).single(),
          supabase.from("projects").select("*").eq("developer_id", developer.id)
            .order("created_at", { ascending: false }),
          supabase.from("pricing_config").select("key, value").in("key", [
            "project_page_monthly_price", "project_page_period_days",
            "project_promote_weekly_price", "project_promote_duration_days",
            "project_lead_price",
          ]),
        ]);
        const pricing: Record<string, number> = {};
        (prices ?? []).forEach((r: { key: string; value: number }) => { pricing[r.key] = Number(r.value); });
        return json({ success: true, developer: dev, projects: projects ?? [], pricing });
      }

      default:
        return json({ error: "unknown_action", detail: action || "(ריק)" }, 400);
    }
  } catch (err) {
    return json({ error: "unhandled", detail: String((err as Error)?.message ?? err) }, 500);
  }
});
