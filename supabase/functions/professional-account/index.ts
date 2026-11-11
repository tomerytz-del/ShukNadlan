import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { announceProfessionalAccount } from "../_shared/platform-signup-alert.ts";
import { likeLiteral, normalizeEmail } from "../_shared/professional-link-mail.ts";

// ============================================================================
// פתיחת חשבון כניסה לבעל/ת מקצוע שכבר יש לו/ה כרטיסייה
//
// ## הבעיה
// בעלי מקצוע (עו"ד, יועץ משכנתאות, שמאי) נרשמים בכרטיסייה ונכנסים לעריכה בקישור עם
// אסימון (professional-manage), בלי התחברות ובלי ארנק. מדף הלידים של עורכי הדין צריך
// ארנק, וחשבון CRM דורש מספר רישיון תיווך שלעו"ד אין. לכן חשבון נפרד, professional_accounts
// (docs/professional-accounts.md), כמו שליזמים יש developers ולא agency_members.
//
// ## ההרשאה: האסימון שבקישור העריכה
// מי שמחזיק/ה באסימון הוא/היא בעל/ת הכרטיסייה, ולכן רשאי/ת לפתוח לה חשבון. האסימון
// בגוף הבקשה (UUID שאי אפשר לנחש), והחיפוש רק מול ad_placement_access ב-service_role.
// כתובת הכניסה היא ה-contact_email שנרשם בכרטיסייה ולא כתובת שהוקלדה כאן: טעות הקלדה
// הייתה יוצרת חשבון בלי דרך לאפס סיסמה.
//
// ## אימות המייל: הזמנה, לא סיסמה שמוקלדת כאן
// האסימון מוחזר לטופס ההרשמה ולא רק נשלח למייל, ולכן מי שהגיש/ה כרטיסייה עם כתובת של אדם אחר
// מחזיק/ה בו. לכן אין כאן `email_confirm: true` וסיסמה שהוא/היא בחר/ה (כמו שעושים agency-signup
// ו-developer-signup, שם הכתובת היא של מי שמקליד/ה): המשתמש נוצר ב-`inviteUserByEmail`, המייל נשלח
// לכתובת שבכרטיסייה, והסיסמה נקבעת רק אחרי הלחיצה על הקישור (professional-crm). בלי לחיצה אי אפשר
// להיכנס, ולכן אין ארנק ואין מדף. כתובת שלא אושרה לא נשארת תפוסה: בקשה חוזרת (אחרי דקה) מוחקת את
// המשתמש שלא אושר (אי אפשר היה להיכנס אליו, ואין בו יתרה) ושולחת הזמנה חדשה.
//
// שליחה חוזרת שומרת את מה שמנהל/ת הפלטפורמה כבר קבע/ה (עיר, אישור מדף) ואינה שולחת התראה נוספת.
//
// ## מה נוצר, ומה לא
// נוצרים משתמש (auth), ושורת professional_accounts עם kind מהכרטיסייה, עיר מ-target_region
// וארנק ריק. **shelf_enabled נשאר false:** מי שרשאי/ת לראות ולקנות לידים נקבע על ידי מנהל/ת
// הפלטפורמה, וההתראה אליו/ה אומרת זאת. חשבון אחד לכרטיסייה (unique(card_id)).
//
// מ-10.11.2026 החשבון נפתח לכל תחום, לא רק לעו"ד: כניסה, עריכת הכרטיסייה (manage_link),
// ומדף לידים למי שיש לו (עו"ד: lawyer_leads, יועץ/ת משכנתאות: mortgage_leads). לשאר התחומים
// עדיין אין מדף, והאזור האישי אומר זאת.
//
// ## המסלול השני: כניסה עם Google (claim_by_login)
// כמו אצל הסוכנים (join-agency, "התאמת אימייל"): מי שנכנס/ת ל-professional-crm עם Google
// (או עם אימייל וסיסמה שאושר) ואין לו/ה חשבון, מקבל/ת חשבון לפי הכרטיסייה שה-contact_email
// שלה הוא כתובת הכניסה. ההוכחה כאן היא הכניסה עצמה: Google (או מייל האישור) העיד/ה
// שהכתובת של המשתמש/ת, וזה בדיוק מה שמייל ההזמנה במסלול הראשון בא להוכיח. התנאים
// מאושרים בדף לפני היצירה (terms_accepted), וה-JWT הוא ההרשאה, לא אסימון בגוף.
// כתובת בלי כרטיסייה חיה או ממתינה: no_card, והדף מסביר איפה נרשמים.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteBaseUrl = (Deno.env.get("SITE_BASE_URL") || "https://shuknadlan.co.il").replace(/\/+$/, "");
// הבקשה החוזרת לא תשלח מייל נוסף לכתובת לפני שעברה דקה מההזמנה האחרונה (גם מגבלת המייל של Supabase)
const RESEND_AFTER_MS = 60_000;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** המשתמש/ת מה-JWT שבכותרת (לא מהגוף). אותו בלוק ל-manage_link ול-claim_by_login. */
async function userFromRequest(req: Request): Promise<{ user: any } | { error: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: "missing_authorization" };
  const authed = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authed.auth.getUser();
  if (error || !data?.user) return { error: "unauthorized" };
  return { user: data.user };
}

/** העיר לפי שם האזור שבכרטיסייה: התאמה יחידה בלבד. שם שמשותף לשתי ערים, או אזור שאינו עיר,
 *  משאיר ריק (ההתראה למנהל/ת אומרת להשלים) ולא בוחר עיר באקראי, כי העיר קובעת אילו לידים עו"ד רואה.
 *  משותף לשני מסלולי הפתיחה (אסימון ו-claim_by_login). */
async function cityIdForRegion(supabase: any, region: unknown): Promise<string | null> {
  const name = typeof region === "string" ? region.trim() : "";
  if (!name) return null;
  const { data: cities } = await supabase.from("cities").select("id").eq("name", name).limit(2);
  return cities && cities.length === 1 ? cities[0].id : null;
}

/** שורת החשבון מהכרטיסייה, בלי user_id ו-city_id (נקבעים לפי המסלול). אותה צורה בשני המסלולים. */
function accountRowFromCard(card: any) {
  const displayName = String(card.advertiser_name || card.business_name || "").trim();
  return {
    card_id: card.id as string,
    kind: card.advertiser_type as string,
    display_name: displayName.length >= 2 ? displayName : "בעל/ת מקצוע",
    phone: (card.phone_e164 ?? null) as string | null,
    terms_accepted_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ‏manage_link: חשבון מחובר מקבל את קישור עריכת הכרטיסייה שלו, כדי שלא יצטרך לשמור את
  // הקישור המקורי. האסימון יושב ב-ad_placement_access (נגיש ל-service_role בלבד), ולכן
  // הוא יוצא רק לבעל החשבון, לפי ה-JWT ולא לפי גוף הבקשה.
  if (body.action === "manage_link") {
    const who = await userFromRequest(req);
    if ("error" in who) return json({ error: who.error }, 401);
    const { data: acct } = await supabase
      .from("professional_accounts").select("card_id").eq("user_id", who.user.id).maybeSingle();
    if (!acct?.card_id) return json({ error: "no_card" }, 404);
    const { data: acc } = await supabase
      .from("ad_placement_access").select("manage_token").eq("placement_id", acct.card_id).maybeSingle();
    if (!acc) return json({ error: "no_card" }, 404);
    return json({ url: "/professional-manage?token=" + encodeURIComponent(acc.manage_token) });
  }

  // ‏claim_by_login: חשבון לפי כתובת הכניסה המאומתת (Google, או סיסמה אחרי אישור המייל)
  if (body.action === "claim_by_login") {
    const who = await userFromRequest(req);
    if ("error" in who) return json({ error: who.error }, 401);
    const user = who.user;
    // התנאים: השורה במסך הכניסה ("בכניסה אתם מאשרים") היא האישור, והדף שולח true. בלעדיו אין חשבון
    if (body.terms_accepted !== true) {
      return json({ error: "terms_not_accepted", detail: "פתיחת החשבון מותנית באישור תנאי השימוש" }, 400);
    }
    const email = normalizeEmail(user.email);
    // הכתובת היא ההוכחה, ולכן רק כתובת שאושרה: Google מאשרת, הרשמה בסיסמה מאשרת במייל
    if (!email || !(user.email_confirmed_at || user.confirmed_at)) {
      return json({ error: "email_not_verified" }, 403);
    }

    // כשל במסד הוא 500, לא "אין כרטיסייה": no_card מוציא את המשתמש/ת ושולח להרשמה
    const { data: mine, error: mineErr } = await supabase
      .from("professional_accounts").select("id, erased_at").eq("user_id", user.id).maybeSingle();
    if (mineErr) return json({ error: "db_error", detail: mineErr.message }, 500);
    if (mine && !mine.erased_at) return json({ success: true, account_exists: true });

    // הכרטיסיות בכתובת הזו: גם paused (הפרופיל שלה עדיין נערך, ובעליה לא אמור/ה להירשם שוב)
    const { data: cards, error: cardsErr } = await supabase
      .from("ad_placements")
      .select("id, advertiser_name, business_name, advertiser_type, contact_email, phone_e164, target_region, status, created_at")
      .eq("placement_type", "professional_card")
      .in("status", ["active", "pending_approval", "paused"])
      .ilike("contact_email", likeLiteral(email))
      .order("created_at", { ascending: false })
      .limit(5);
    if (cardsErr) return json({ error: "db_error", detail: cardsErr.message }, 500);
    if (!cards?.length) return json({ error: "no_card" }, 404);

    // הכרטיסייה שנבחרת: בלי חשבון של אחר/ת, ומביניהן חיה לפני ממתינה, וחדשה לפני ישנה. חשבון של
    // הזמנה שלא נלחצה (משתמש/ת שלא אישר/ה) מפנה את מקומו כמו במסלול האסימון: אי אפשר היה להיכנס
    // אליו, ואין בו כלום. חשבון מאושר של אחר/ת אינו מחובר שוב (card_has_account)
    const { data: accounts, error: accErr } = await supabase
      .from("professional_accounts").select("id, card_id, user_id, erased_at, city_id, shelf_enabled")
      .in("card_id", cards.map((c: any) => c.id));
    if (accErr) return json({ error: "db_error", detail: accErr.message }, 500);
    const rank = (s: string) => (s === "active" ? 0 : s === "pending_approval" ? 1 : 2);
    const ordered = [...cards].sort((a: any, b: any) => rank(a.status) - rank(b.status) || (a.created_at < b.created_at ? 1 : -1));
    let card: any = null;
    // הזמנה שלא נלחצה שמפנה את מקומה: המשתמש/ת שיימחק/תימחק, ומה שמנהל/ת כבר קבע/ה לשורה שלו/ה
    let stale: { userId: string; city_id: string | null; shelf_enabled: boolean } | null = null;
    let sawTaken = false;
    for (const c of ordered) {
      const acct = (accounts ?? []).find((a: any) => a.card_id === c.id && !a.erased_at && a.user_id);
      if (!acct || acct.user_id === user.id) { card = c; break; }
      // כשל ב-Auth API הוא 500 (הדף מבקש רענון), לא "הכרטיסייה תפוסה" שמוציא את המשתמש/ת
      const { data: au, error: auErr } = await supabase.auth.admin.getUserById(acct.user_id);
      if (auErr) return json({ error: "auth_error", detail: auErr.message }, 500);
      if (au?.user && !au.user.email_confirmed_at) {
        card = c;
        stale = { userId: au.user.id, city_id: acct.city_id ?? null, shelf_enabled: !!acct.shelf_enabled };
        break;
      }
      sawTaken = true;
    }
    if (!card) {
      return sawTaken
        ? json({ error: "card_has_account", detail: "לכרטיסייה הזו כבר יש חשבון כניסה אחר. כתבו לנו ונחבר." }, 409)
        : json({ error: "no_card" }, 404);
    }

    if (stale) {
      // ה-cascade מוחק גם את שורת החשבון שלא אושר; העיר ואישור המדף שלה עוברים לשורה החדשה
      const { error: delErr } = await supabase.auth.admin.deleteUser(stale.userId);
      if (delErr) {
        console.error("professional account claim: deleting unconfirmed user failed", delErr.message);
        return json({ error: "auth_error", detail: delErr.message }, 500);
      }
    }
    const row = accountRowFromCard(card);
    const { data: account, error: insErr } = await supabase
      .from("professional_accounts")
      .insert({ ...row, user_id: user.id, city_id: stale?.city_id ?? await cityIdForRegion(supabase, card.target_region) })
      .select("id")
      .single();
    if (insErr || !account) {
      console.error("professional account claim insert failed", insErr?.message);
      return json({ error: "db_error", detail: insErr?.message ?? "insert_failed" }, 500);
    }
    if (stale) {
      // כמו בשליחה חוזרת במסלול האסימון: האישור שכבר ניתן נשמר, ואין התראה שנייה למנהל/ת
      if (stale.shelf_enabled) {
        const { error: keepErr } = await supabase
          .from("professional_accounts").update({ shelf_enabled: true }).eq("id", account.id);
        if (keepErr) console.error("professional account claim: carrying shelf_enabled failed", keepErr.message);
      }
    } else {
      await announceProfessionalAccount(supabase, account.id);
    }
    return json({ success: true, created: true });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!UUID_RE.test(token)) return json({ error: "invalid_token" }, 400);
  // התנאים נאכפים בשרת ולא בתיבת סימון בדפדפן (כמו בשאר ההרשמות)
  if (body.terms_accepted !== true) {
    return json({ error: "terms_not_accepted", detail: "פתיחת החשבון מותנית באישור תנאי השימוש" }, 400);
  }

  const { data: access } = await supabase
    .from("ad_placement_access").select("placement_id").eq("manage_token", token).maybeSingle();
  if (!access) return json({ error: "invalid_token" }, 404);

  const { data: card } = await supabase
    .from("ad_placements")
    .select("id, advertiser_name, business_name, advertiser_type, contact_email, phone_e164, target_region, status, placement_type")
    .eq("id", access.placement_id).maybeSingle();
  if (!card) return json({ error: "card_not_found" }, 404);
  // רק כרטיסיית בעל מקצוע חיה או ממתינה לאישור: אסימון של כרטיסייה שהוסרה או שאינה של בעל מקצוע
  // אינו פותח ארנק
  if (card.placement_type !== "professional_card" || !["active", "pending_approval"].includes(card.status)) {
    return json({ error: "card_not_active", detail: "הכרטיסייה אינה פעילה" }, 409);
  }
  if (!card.contact_email) return json({ error: "card_without_email" }, 409);

  const { data: existing } = await supabase
    .from("professional_accounts").select("id, user_id, erased_at, city_id, shelf_enabled").eq("card_id", card.id).maybeSingle();
  // מה שמנהל/ת הפלטפורמה כבר קבע/ה לחשבון שלא אושר (עיר, אישור מדף) עובר לשורה החדשה, ולא נמחק עם ה-cascade
  let carried: { city_id: string | null; shelf_enabled: boolean } | null = null;
  if (existing) {
    // חשבון שאושר (או שנמחק) נשאר כמות שהוא. חשבון שההזמנה אליו לא נלחצה: שולחים הזמנה חדשה
    const stale = existing.user_id && !existing.erased_at
      ? (await supabase.auth.admin.getUserById(existing.user_id)).data?.user
      : null;
    if (!stale || stale.email_confirmed_at) {
      return json({ error: "account_exists", detail: "כבר נפתח חשבון לכרטיסייה הזו. אפשר להתחבר, או לאפס סיסמה." }, 409);
    }
    const sentAt = Date.parse(stale.invited_at || stale.created_at || "");
    if (Number.isFinite(sentAt) && Date.now() - sentAt < RESEND_AFTER_MS) {
      return json({ error: "resend_too_soon", detail: "שלחנו הזמנה לפני רגע. אפשר לבקש שוב בעוד דקה." }, 429);
    }
    // אי אפשר היה להיכנס אליו, ולכן אין בו יתרה, הזמנות או לידים. ה-cascade מוחק גם את שורת החשבון
    const { error: delErr } = await supabase.auth.admin.deleteUser(stale.id);
    if (delErr) {
      console.error("professional account: deleting unconfirmed user failed", delErr.message);
      return json({ error: "auth_error", detail: delErr.message }, 500);
    }
    carried = { city_id: existing.city_id ?? null, shelf_enabled: !!existing.shelf_enabled };
  }

  const cityId = await cityIdForRegion(supabase, card.target_region);
  const email = String(card.contact_email).trim().toLowerCase();
  const row = accountRowFromCard(card);
  const displayName = row.display_name;

  // מייל ההזמנה הוא ההוכחה שהכתובת של מי שפותח/ת את החשבון. רק הלחיצה עליו מאשרת את הכתובת
  const { data: authUser, error: authErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName, account_type: "professional" },
    redirectTo: `${siteBaseUrl}/professional-crm`,
  });
  if (authErr || !authUser?.user) {
    // כתובת שכבר רשומה (למשל סוכן/ת שהוא/היא גם בעל/ת מקצוע): לא מחברים חשבון קיים לפי אסימון
    if (/already|registered|exists/i.test(authErr?.message || "")) {
      return json({
        error: "email_in_use",
        detail: "הכתובת שבכרטיסייה כבר רשומה באתר. כתבו לנו ונחבר את החשבון.",
      }, 409);
    }
    // ‏429 של מגבלת המיילים של Supabase, או SMTP שנפל: אין משתמש (ההזמנה נכשלה לפני שנשלחה), ואפשר לנסות שוב
    console.error("professional account invite failed", authErr?.message);
    return json({
      error: "invite_failed",
      detail: "לא הצלחנו לשלוח את מייל האימות. נסו שוב בעוד רגע.",
    }, 502);
  }

  const { data: account, error: insErr } = await supabase
    .from("professional_accounts")
    .insert({ ...row, user_id: authUser.user.id, city_id: carried?.city_id ?? cityId })
    .select("id")
    .single();

  if (insErr || !account) {
    // לא משאירים משתמש בלי חשבון: ניסיון חוזר היה נתקע על "הכתובת כבר רשומה"
    await supabase.auth.admin.deleteUser(authUser.user.id);
    console.error("professional account insert failed", insErr?.message);
    return json({ error: "db_error", detail: insErr?.message ?? "insert_failed" }, 500);
  }

  if (carried) {
    // שליחה חוזרת, לא חשבון חדש: בלי התראה נוספת למנהל/ת, והאישור שכבר ניתן נשמר
    if (carried.shelf_enabled) {
      const { error: keepErr } = await supabase
        .from("professional_accounts").update({ shelf_enabled: true }).eq("id", account.id);
      if (keepErr) console.error("professional account: carrying shelf_enabled failed", keepErr.message);
    }
  } else {
    await announceProfessionalAccount(supabase, account.id);
  }

  return json({ success: true, verification_sent: true, login_email: email, login_url: "/professional-crm" });
});
