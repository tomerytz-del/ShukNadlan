import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPlatformEmail, PLATFORM_CONTACT_EMAIL } from "../_shared/platform-mail-client.ts";
import {
  grantLaunchPromo, PROMO_TIER, TIERS, TIER_NAMES, TIER_PRICES, type Tier,
} from "../_shared/launch-promo.ts";
import { blockedResponse, checkBrokerLicense } from "../_shared/broker-license-gate.ts";
import { announcePlatformSignup } from "../_shared/platform-signup-alert.ts";
import { freeAgentSlug } from "../_shared/agent-slug.ts";

// ============================================================================
// חיבור חשבון לכרטיס סוכן/ת קיים — "המערכת מזהה אותי"
//
// זו החוליה שהייתה חסרה. עד היום החיבור בין חשבון auth לשורת agency_members
// נעשה **רק** ברגע יצירת השורה, ולכן כל פער בין הכתובת שהוקלדה לבין הכתובת
// שאיתה נכנסים בפועל היה סופי: המשתמש/ת נראה/ית למערכת חדש/ה לגמרי וקיבל/ה
// את מסך "עדיין לא פתחת משרד תיווך" — גם כשהכרטיס שלו/ה יושב במשרד ומחכה.
//
// שלוש דרכי זיהוי, מהחזקה לחלשה. resolve מנסה אותן לפי הסדר:
//
//   1. אסימון הזמנה (?invite=…). הוכחה שהמנהל/ת שלח/ה את הקישור הזה לאדם
//      הזה. עובד גם כשהכתובת שהוקלדה שגויה, כי אפשר להעביר את הקישור בכל דרך.
//   2. התאמת אימייל. כתובת הכניסה זהה לכתובת שעל כרטיס ממתין — משייכים מיד,
//      בלי לשאול. זה הרוב המוחלט של המקרים, והוא צריך להיות שקוף לגמרי.
//   3. בקשת שיוך לפי מספר רישיון (claim), באישור מנהל/ת. זו רשת הביטחון
//      לטעות ההקלדה עצמה: הכתובת על הכרטיס פשוט אינה הכתובת של האדם.
//      מספר רישיון הוא מידע ציבורי ולכן לבדו אינו משייך — האישור האנושי של
//      מנהל/ת המשרד הוא מה שסוגר את הפרצה.
//
// בכל שלושת המסלולים, השיוך גם **מיישר את האימייל** על הכרטיס לכתובת שאיתה
// נכנסים בפועל. אחרת אותה טעות תחזור בכניסה הבאה.
//
// **השלב שלפני השיוך: מה שרק הסוכן/ת יכול/ה למסור.** טופס ההזמנה מבקש
// ממנהל/ת המשרד אימייל ונייד בלבד, ולכן כרטיס ממתין נולד בלי מספר רישיון
// ולעיתים גם בלי שם. ‏resolve שמזהה כרטיס כזה מחזיר `status:"needs_license"`
// **בלי לשייך**, והמסך שואל את הסוכן/ת. השיחה השנייה מגיעה עם המספר, הוא
// נבדק מול רשם המתווכים, ורק אז `bind` רץ. כלומר השער החוקי לא נחלש: הוא
// פשוט עבר למי שהתעודה בידיו/ה — וזה גם מי שיכול/ה לערער עליה.
//
// ‏שתי תוספות מתקופת ההשקה:
//
//   • **הענקת ההטבה בשיוך.** ‏ההזמנה כבר לא נושאת מסלול — מנהל/ת המשרד
//     מזמין/ה, והמסלול נקבע אצל הסוכן/ת. ברגע שהשיוך מצליח, השורה מקבלת
//     Elite לחצי שנה דרך ‎grant_launch_promo‎ (אידמפוטנטית: קריאה שנייה
//     אינה מאריכה).
//   • **‏set_tier** — הפעולה שדרכה הסוכן/ת בוחר/ת מסלול לעצמו/ה. זו הדרך
//     היחידה: ‎tier‎ ושדות ההטבה נעולים מול הדפדפן בטריגר
//     ‎protect_sensitive_agency_member_fields‎.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;


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
const normEmail = (raw: unknown) => String(raw ?? "").trim().toLowerCase();

/** שם ואימייל של סוכן/ת נכנסים לגוף מייל — טקסט שהמשתמש/ת שולט/ת בו. */
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** מספרי רישיון מוקלדים עם רווחים ומקפים לסירוגין; ההשוואה על הספרות בלבד. */
const normLicense = (raw: unknown) => String(raw ?? "").replace(/[\s-]/g, "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* resolve בלי body הוא קריאה חוקית */ }

  const authedClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await authedClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const user = userData.user;
  const userEmail = normEmail(user.email);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const action = ["resolve", "claim", "decide", "cancel_claim", "set_tier"].includes(body?.action)
    ? body.action : "resolve";

  /** הענקת הטבת ההשקה. כישלון כאן לא מפיל את השיוך — המשרד חשוב מהמתנה. */
  const grantPromo = (memberId: string) => grantLaunchPromo(supabase, memberId);

  /**
   * סוף מסלול ההצטרפות, לשלושת המסלולים כאחד: ההטבה, ואז ההתראה למנהל/ת
   * הפלטפורמה על מתווך/ת שהצטרף/ה.
   *
   * שתי הפעולות יחד ובסדר הזה, ולא כל אחת אצל הקורא: ההתראה נושאת את המסלול,
   * והמסלול נקבע בשורה שמעליה. קורא ששכח אחת מהן היה מדווח "Pay&GO" על
   * מצטרף/ת שקיבל/ה Elite — או לא מדווח כלל.
   */
  async function joined(memberId: string) {
    const promo = await grantPromo(memberId);
    await announcePlatformSignup(supabase, memberId, "agent");
    return promo;
  }

  /**
   * שער הרישיון על כרטיס קיים.
   *
   * ‏bind הוא הרגע שבו חשבון נקשר לכרטיס — כלומר **הכניסה הראשונה** של
   * הסוכן/ת למערכת — ולכן הוא המקום הנכון לשער, ולא שלושת המסלולים בנפרד.
   *
   * הבדיקה חד-פעמית ולא חוזרת, ולכן:
   *   • כרטיס שכבר אומת (‏verified/manual) עובר **בלי קריאת רשת בכלל**.
   *     זה הרוב: ‏add-team-member כבר בדק אותו ביצירה.
   *   • כרטיס שמעולם לא נבדק (‏license_checked_at ריק — כלומר נוצר לפני
   *     המיגרציה) נבדק עכשיו, בכניסה הראשונה שלו. זו בדיוק ההגדרה.
   *   • כרטיס שנבדק ונחסם נבדק שוב, כי ‎checkBrokerLicense‎ שואל קודם כול
   *     אם בינתיים אושר ערעור — וזה המסלול שדרכו מי שנחסם/ה נכנס/ת.
   */
  async function licenseGate(memberId: string) {
    const { data: card } = await supabase
      .from("agency_members")
      .select("license_number, license_status, license_checked_at, display_name, email")
      .eq("id", memberId).maybeSingle();
    if (!card) return null;

    if (card.license_checked_at && ["verified", "manual"].includes(card.license_status)) return null;

    // כרטיס בלי מספר רישיון **אינו** עובר. מאז שטופס ההזמנה הפסיק לבקש את
    // המספר, זה מצבו הרגיל של כל כרטיס ממתין — ו-`fillMissingProfile` הוא
    // שגובה אותו מהסוכן/ת לפני השיוך. אם בכל זאת הגענו לכאן בלי מספר, משהו
    // עקף את המסלול הזה, והתשובה הנכונה היא סירוב ולא מעבר בשקט: זה ההבדל
    // בין שער לבין קישוט.
    if (!card.license_number) {
      return {
        error: "license_required",
        detail: "כדי להיכנס למערכת צריך למסור את מספר רישיון התיווך.",
      };
    }

    const decision = await checkBrokerLicense(supabase, card.license_number, {
      who: card.display_name || undefined,
      email: card.email || userEmail || undefined,
      source: "join-agency",
    });

    // התוצאה נרשמת בכל מקרה — גם כשהיא מתירה. זה התיעוד החד-פעמי של
    // הבדיקה, ובלעדיו היא הייתה רצה שוב בכל כניסה.
    await supabase.from("agency_members").update(decision.columns).eq("id", memberId);

    return decision.allowed ? null : blockedResponse(decision, card.license_number);
  }

  /**
   * מה שהכרטיס עוד לא יודע על בעליו — ומי שמוסר/ת אותו הוא/היא עצמו/ה.
   *
   * טופס ההזמנה מבקש ממנהל/ת המשרד שני פרטי קשר בלבד, ולכן כרטיס ממתין
   * נולד **בלי מספר רישיון** ולעיתים גם בלי שם. שניהם נאספים כאן, במסך
   * הפתיחה של הסוכן/ת, ברגע שלפני השיוך.
   *
   * **זה אותו שער בדיוק, רק במקום שבו הוא יכול לעבוד.** עד היום המספר
   * נבדק בטופס של מנהל/ת המשרד: ספרה שגויה חסמה הזמנה תקינה, ומסלול
   * הערעור — שדורש צילום תעודה — נפתח בידי מי שהתעודה אינה אצלו/ה. עכשיו
   * הבדיקה רצה מול מי שהמספר שלו/ה, והערעור נפתח עם המסמך ביד.
   *
   * ארבע תשובות, וכל אחת מסך אחר אצל הקורא:
   *   ok      — יש רישיון (כרטיס ותיק), או שנמסר עכשיו ועבר. אפשר לשייך.
   *   needs   — עוד לא נמסר. זה **אינו** כישלון: זו הבקשה הראשונה.
   *   blocked — נמסר ונחסם. תשובת הערעור המלאה, כמו בכל מסלול אחר.
   *   invalid — מה שהוקלד אינו יכול להיות מספר רישיון.
   */
  async function fillMissingProfile(memberId: string) {
    const { data: card } = await supabase
      .from("agency_members")
      .select("id, display_name, license_number, email")
      .eq("id", memberId).maybeSingle();
    if (!card) return { error: "member_not_found" as const };
    if (card.license_number) return { ok: true as const };

    const license = normLicense(body?.license_number);
    const name = String(body?.display_name || "").trim().slice(0, 80);
    if (!license) return { needs: { display_name: card.display_name || "" } };

    // אותו טווח של טופס הערעור (`broker-license-appeal`), כדי ששני המקומות
    // שמקבלים מספר רישיון מאדם לא יחלקו עליו.
    if (!/^\d{3,8}$/.test(license)) return { invalid: "invalid_license" as const };

    // **רישיון שייך לאדם אחד.** בלי הבדיקה הזו שני כרטיסים יכולים לשאת את
    // אותו מספר — ואז `claim` מוצא שניים, מחזיר `license_not_found`, ורשת
    // הביטחון של טעות ההקלדה נשברת לשניהם בבת אחת.
    const { data: rows } = await supabase
      .from("agency_members").select("id, license_number").not("license_number", "is", null);
    if ((rows || []).some((r: any) => r.id !== memberId && normLicense(r.license_number) === license)) {
      return { taken: true as const };
    }

    const decision = await checkBrokerLicense(supabase, license, {
      who: name || card.display_name || undefined,
      email: card.email || userEmail || undefined,
      source: "join-agency",
    });
    if (!decision.allowed) return { blocked: blockedResponse(decision, license) };

    const patch: Record<string, unknown> = { license_number: license, ...decision.columns };
    // השם נכתב רק כשהכרטיס נוצר בלעדיו. כשמנהל/ת המשרד כבר מילא/ה אותו,
    // הוא כבר מוצג ברשימת הצוות ו-`slug` נגזר ממנו — ושינוי שלו כאן היה
    // מחליף כתובת של דף שכבר קיים. מי שרוצה לתקן עושה זאת מהפרופיל.
    if (name && !card.display_name) {
      patch.display_name = name;
      patch.slug = await freeAgentSlug(supabase, name);
    }

    const { error } = await supabase.from("agency_members").update(patch).eq("id", memberId);
    if (error) return { error: "db_error" as const, detail: error.message };
    return { ok: true as const };
  }

  /** שם המשרד למסך הפתיחה — מי שנוחת/ת בו צריך/ה לדעת לאן הוזמן/ה. */
  async function agencyNameOf(memberId: string) {
    const { data: m } = await supabase
      .from("agency_members").select("agency_id").eq("id", memberId).maybeSingle();
    if (!m?.agency_id) return "";
    const { data: a } = await supabase
      .from("agencies").select("name").eq("id", m.agency_id).maybeSingle();
    return a?.name || "";
  }

  /**
   * התשובה של `fillMissingProfile` כמענה HTTP. נקודה אחת לשני מסלולי
   * הזיהוי, כדי שלא ייווצר הבדל בין מי שהגיע/ה עם קישור למי שנקלט/ה
   * בהתאמת אימייל.
   */
  async function profileGateResponse(memberId: string, via: string) {
    const prep = await fillMissingProfile(memberId);
    if ("ok" in prep) return null;
    if ("needs" in prep) {
      return json({
        status: "needs_license",
        via,
        agency_name: await agencyNameOf(memberId),
        display_name: prep.needs.display_name,
      });
    }
    if ("blocked" in prep) return json(prep.blocked, 403);
    if ("taken" in prep) return json({ error: "license_in_use" }, 409);
    if ("invalid" in prep) return json({ error: prep.invalid }, 400);
    return json({ error: prep.error, detail: (prep as any).detail }, 500);
  }

  /** השיוך עצמו. נקודה אחת, כדי ששלושת המסלולים לא יתפצלו בהתנהגות. */
  async function bind(memberId: string, opts: { inviteToken?: string } = {}) {
    // השער קודם לכתיבה: כרטיס חסום לא מקבל user_id, ולכן הכניסה הבאה תראה
    // בדיוק את אותו מסך ולא "כבר משויך/ת".
    const blocked = await licenseGate(memberId);
    if (blocked) return { blocked };

    const patch: Record<string, unknown> = { user_id: user.id };
    // יישור האימייל לכתובת הכניסה — אחרת הכרטיס נשאר עם הכתובת השגויה
    // וההתאמה האוטומטית לא תעבוד גם בפעם הבאה.
    if (userEmail) patch.email = userEmail;

    const { data: bound, error: bindErr } = await supabase
      .from("agency_members").update(patch).eq("id", memberId)
      .select("id, slug, agency_id, display_name").single();

    if (bindErr) {
      // ‏one_agency_per_user: החשבון כבר משויך לכרטיס אחר.
      if ((bindErr as any).code === "23505") return { error: "already_member" as const };
      return { error: "db_error" as const, detail: bindErr.message };
    }

    if (opts.inviteToken) {
      await supabase.from("agency_invitations")
        .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: user.id })
        .eq("token", opts.inviteToken);
    }
    // כל הזמנה אחרת שממתינה לאותו כרטיס כבר מיותרת
    await supabase.from("agency_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("member_id", memberId).eq("status", "pending");

    return { member: bound };
  }

  try {
    // =====================================================================
    // resolve — מה המערכת יודעת עלי, ומה עכשיו
    // =====================================================================
    if (action === "resolve") {
      const { data: mine } = await supabase
        .from("agency_members").select("id, slug, agency_id").eq("user_id", user.id).maybeSingle();
      if (mine) return json({ status: "member", member_slug: mine.slug });

      // --- 1. אסימון הזמנה ---
      const token = String(body?.token || "").trim();
      if (token) {
        const { data: invite } = await supabase
          .from("agency_invitations")
          .select("id, token, member_id, status, expires_at")
          .eq("token", token).maybeSingle();

        if (!invite) return json({ status: "invite_invalid", reason: "not_found" });
        if (invite.status === "accepted") return json({ status: "invite_invalid", reason: "used" });
        if (invite.status !== "pending") return json({ status: "invite_invalid", reason: "revoked" });
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
          return json({ status: "invite_invalid", reason: "expired" });
        }

        const { data: member } = await supabase
          .from("agency_members").select("id, user_id").eq("id", invite.member_id).maybeSingle();
        if (!member) return json({ status: "invite_invalid", reason: "not_found" });
        if (member.user_id) return json({ status: "invite_invalid", reason: "used" });

        // מספר הרישיון (ואם חסר — גם השם) לפני השיוך, ולא אחריו: כרטיס
        // שקיבל `user_id` הוא כרטיס שנכנס/ה אליו, ואין טעם לבקש רישיון
        // ממי שכבר בפנים.
        const gate = await profileGateResponse(invite.member_id, "invite");
        if (gate) return gate;

        const res = await bind(invite.member_id, { inviteToken: token });
        if ("blocked" in res) return json(res.blocked, 403);
        if ("error" in res) return json({ status: "error", error: res.error, detail: (res as any).detail }, 409);
        const promo = await joined(invite.member_id);
        return json({ status: "joined", via: "invite", member_slug: res.member!.slug, promo });
      }

      // --- 2. התאמת אימייל ---
      if (userEmail) {
        const { data: matches } = await supabase
          .from("agency_members").select("id, slug")
          .is("user_id", null).ilike("email", userEmail).limit(2);

        // יותר מהתאמה אחת = לא ברור לאיזה כרטיס, ולכן לא משייכים בשקט.
        if (matches && matches.length === 1) {
          const gate = await profileGateResponse(matches[0].id, "email");
          if (gate) return gate;

          const res = await bind(matches[0].id);
          // חסימת רישיון אינה "לא הצלחנו לשייך" ואסור לה ליפול בשקט למסך
          // הבא: הכרטיס נמצא, הכתובת תואמת, ומה שעוצר הוא הרישיון. בלי
          // ההחזרה הזו הסוכן/ת היה/תה מקבל/ת "עדיין לא פתחת משרד" ולא מבין/ה
          // למה.
          if ("blocked" in res) return json(res.blocked, 403);
          if (!("error" in res)) {
            const promo = await joined(matches[0].id);
            return json({ status: "joined", via: "email", member_slug: res.member!.slug, promo });
          }
        }
      }

      // --- 3. בקשת שיוך שכבר הוגשה וממתינה ---
      const { data: claim } = await supabase
        .from("agency_member_claims").select("id, agency_id, created_at")
        .eq("user_id", user.id).eq("status", "pending").maybeSingle();
      if (claim) {
        const { data: agency } = await supabase
          .from("agencies").select("name").eq("id", claim.agency_id).maybeSingle();
        return json({ status: "claim_pending", claim_id: claim.id, agency_name: agency?.name || "" });
      }

      return json({ status: "none" });
    }

    // =====================================================================
    // claim — "יש לי כרטיס במשרד, זה מספר הרישיון שלי"
    // =====================================================================
    if (action === "claim") {
      const license = normLicense(body?.license_number);
      if (!license) return json({ error: "missing_fields", required: ["license_number"] }, 400);

      const { data: mine } = await supabase
        .from("agency_members").select("id").eq("user_id", user.id).maybeSingle();
      if (mine) return json({ error: "already_member" }, 409);

      // ההשוואה על ספרות בלבד, ולכן היא נעשית כאן ולא ב-SQL. הכרטיסים
      // במסד ספורים, והשליפה מוגבלת לעמודות שאין בהן מידע רגיש.
      const { data: rows } = await supabase
        .from("agency_members").select("id, agency_id, display_name, license_number, user_id, active");
      const found = (rows || []).filter((r: any) => normLicense(r.license_number) === license);

      if (found.length !== 1) return json({ error: "license_not_found" }, 404);
      const target = found[0] as any;
      if (target.user_id === user.id) return json({ error: "already_member" }, 409);

      // השער כאן הוא **מוקדם**, לא נוסף: ‏decide יבדוק שוב לפני השיוך עצמו.
      // הנקודה היא לא להשאיר אדם ממתין לאישור מנהל/ת שממילא ייחסם אחריו —
      // ולתת לו/ה את מסלול הערעור עכשיו, כשהוא/היא מול המסך.
      const blocked = await licenseGate(target.id);
      if (blocked) return json(blocked, 403);

      const { error: insErr } = await supabase.from("agency_member_claims").insert({
        member_id: target.id,
        agency_id: target.agency_id,
        user_id: user.id,
        claim_email: userEmail,
        claim_name: user.user_metadata?.full_name || null,
        license_number: license,
      });
      if (insErr) {
        if ((insErr as any).code === "23505") return json({ error: "claim_already_pending" }, 409);
        return json({ error: "db_error", detail: insErr.message }, 500);
      }

      // שם המשרד הוא כל מה שמוחזר. הוא מאשר לסוכן/ת שהגיע/ה למקום הנכון,
      // בלי לחשוף פרטי אדם אחר על סמך מספר רישיון בלבד.
      const { data: agency } = await supabase
        .from("agencies").select("name").eq("id", target.agency_id).maybeSingle();
      return json({ success: true, agency_name: agency?.name || "" });
    }

    // =====================================================================
    // cancel_claim — ביטול בקשה שהוגשה בטעות (למשל מספר רישיון שגוי)
    // =====================================================================
    if (action === "cancel_claim") {
      const { error } = await supabase
        .from("agency_member_claims")
        .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: user.id })
        .eq("user_id", user.id).eq("status", "pending");
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json({ success: true });
    }

    // =====================================================================
    // decide — מנהל/ת מאשר/ת או דוחה בקשת שיוך
    // =====================================================================
    if (action === "decide") {
      const claimId = String(body?.claim_id || "");
      const decision = body?.decision === "approve" ? "approved" : body?.decision === "reject" ? "rejected" : null;
      if (!claimId || !decision) {
        return json({ error: "missing_fields", required: ["claim_id", "decision"] }, 400);
      }

      const { data: caller } = await supabase
        .from("agency_members").select("id, agency_id, role, active").eq("user_id", user.id).maybeSingle();
      if (!caller || !caller.active || caller.role !== "manager") return json({ error: "managers_only" }, 403);

      const { data: claim } = await supabase
        .from("agency_member_claims")
        .select("id, member_id, agency_id, user_id, claim_email, status")
        .eq("id", claimId).maybeSingle();
      if (!claim || claim.agency_id !== caller.agency_id) return json({ error: "claim_not_found" }, 404);
      if (claim.status !== "pending") return json({ error: "claim_already_decided" }, 409);

      if (decision === "approved") {
        // המסלול הזה משייך בעצמו ואינו עובר דרך bind, ולכן הוא צריך את השער
        // במפורש. בלעדיו אישור של מנהל/ת משרד היה הדלת האחורית שעוקפת את
        // בדיקת הרישיון — והיא הדלת שהכי קל להגיע אליה.
        const blocked = await licenseGate(claim.member_id);
        if (blocked) return json(blocked, 403);

        // ניתוק החשבון הישן ושיוך החדש. זה בדיוק התיקון של "הכרטיס קשור
        // לחשבון שאיש לא ייכנס אליו" — ובלעדיו התיקון היחיד הוא ידני, במסד.
        const { error: updErr } = await supabase
          .from("agency_members")
          .update({ user_id: claim.user_id, email: claim.claim_email })
          .eq("id", claim.member_id);
        if (updErr) {
          if ((updErr as any).code === "23505") return json({ error: "already_member" }, 409);
          return json({ error: "db_error", detail: updErr.message }, 500);
        }
        await supabase.from("agency_invitations")
          .update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: claim.user_id })
          .eq("member_id", claim.member_id).eq("status", "pending");
        // אישור בקשת שיוך הוא הצטרפות לכל דבר, ולכן גם כאן ההטבה מוענקת
        // וההתראה יוצאת.
        await joined(claim.member_id);
      }

      const { error: decErr } = await supabase
        .from("agency_member_claims")
        .update({ status: decision, decided_at: new Date().toISOString(), decided_by: caller.id })
        .eq("id", claimId);
      if (decErr) return json({ error: "db_error", detail: decErr.message }, 500);

      return json({ success: true, decision });
    }

    // =====================================================================
    // set_tier — הסוכן/ת בוחר/ת מסלול לעצמו/ה
    //
    // שלוש תשובות אפשריות, וההבדל ביניהן הוא מה שמונע חלוקת מסלולים
    // בתשלום בלחיצה:
    //
    //   applied   — המסלול נכנס לתוקף עכשיו. זה המצב ל-Pay&GO (אין מה
    //               לגבות) ולאישור הטבת ההשקה (הוענקה כבר בשרת).
    //   requested — מסלול בתשלום מחוץ לתקופת ההטבה. **המסלול לא משתנה**:
    //               נרשמת בקשה, נשלח מייל להנהלה, והשדרוג בפועל נעשה אחרי
    //               הסדרת התשלום. כל עוד אין מנוע מנויים, כל התנהגות אחרת
    //               כאן פירושה Elite חינם למי שלוחץ/ת.
    //   promo_locked — ניסיון לבחור מסלול אחר בזמן ההטבה. בתקופת ההשקה
    //               כולם על Elite; אין מה לרדת ממנו כשהוא חינם.
    // =====================================================================
    if (action === "set_tier") {
      const tier = String(body?.tier || "") as Tier;
      if (!TIERS.includes(tier)) return json({ error: "invalid_tier", allowed: TIERS }, 400);

      const { data: me } = await supabase
        .from("agency_members")
        // ‏pending_tier_change נטען כאן ולא רק נכתב: בלעדיו הבדיקה שמתחת
        // ("בקשה זהה כבר פתוחה") משווה מול undefined, לעולם אינה מתקיימת, וכל
        // לחיצה חוזרת שולחת מייל נוסף להנהלה על אותה בקשה בדיוק.
        .select("id, agency_id, display_name, email, tier, tier_source, pending_tier_change, promo_tier, promo_ends_at, promo_ended_at, active, released_at")
        .eq("user_id", user.id).maybeSingle();
      if (!me) return json({ error: "no_matching_agent_profile" }, 403);
      if (!me.active || me.released_at) return json({ error: "member_inactive" }, 403);

      // =====================================================================
      // הנעילה: בשלב הזה מסלול אינו משתנה מהדפדפן, בכלל
      //
      // ‏set_tier החילה ירידה ל-Pay&GO **מיד** — וזו לחיצה אחת בדף המסלולים,
      // שחוזרת ל-CRM כ-`?tier=free` ונצרכת בטעינת הדשבורד בלי שאלה. כך ירד
      // חשבון מ-Elite ל-Pay&GO בטעות, והירידה גוררת גם מחיקה חד-כיוונית של
      // מספרי טלפון מהתיאורים ומהביו (`paygo_text_rules_apply`): נזק שחזרה
      // למסלול אינה מתקנת.
      //
      // מה שעדיין מותר הוא **אישור המסלול הקיים** — אותה חתימת "ראיתי"
      // שהשער מבקש בכניסה הראשונה, ובכלל זה אישור הטבת ההשקה. היא אינה
      // משנה מסלול, ובלעדיה סוכן/ת חדש/ה נתקע/ת בשער.
      //
      // **מה בדיוק נחסם:** כל בקשה שהייתה נכנסת לתוקף מיד — כלומר מעבר
      // ל-Pay&GO, שהוא היחיד שהוחל בלחיצה. מסלול בתשלום ממילא אינו משנה
      // כלום אלא רושם בקשה שההנהלה מאשרת במסך ניהול המנויים, וזו גם הדרך
      // לתקן מסלול שהשתנה בטעות — ולכן היא נשארת פתוחה. התוצאה: **אף
      // מסלול אינו משתנה מהדפדפן**, ובכל שינוי יש אדם שמאשר ושורת יומן.
      //
      // הפתיחה תהיה כאן, כשיהיה מנוע מנויים: `TIER_SWITCH_OPEN = true`,
      // ובצד התצוגה `SWITCH.open` ב-`assets/tiers.js`.
      // =====================================================================
      const TIER_SWITCH_OPEN = false;
      if (!TIER_SWITCH_OPEN && tier !== me.tier && tier === "free") {
        return json({
          status: "tier_locked",
          current_tier: me.tier,
          requested_tier: tier,
          detail: "מעבר ל-Pay&GO סגור כרגע ונעשה מולנו. כתבו ל-shuknadlan@gmail.com ונטפל בזה.",
        }, 409);
      }

      const promoActive = !!me.promo_ends_at && !me.promo_ended_at &&
                          new Date(me.promo_ends_at) > new Date();

      if (promoActive) {
        const promoTier = (me.promo_tier || PROMO_TIER) as Tier;
        if (tier !== promoTier) {
          return json({
            status: "promo_locked",
            promo_tier: promoTier,
            promo_ends_at: me.promo_ends_at,
            detail: `בתקופת ההשקה כל הסוכנים על ${TIER_NAMES[promoTier]} ללא תשלום. בחירת מסלול תיפתח בתום התקופה.`,
          }, 409);
        }
        // אישור ההטבה. המסלול כבר premium מרגע ההענקה — מה שנרשם כאן הוא
        // שהמסך נראה, ולכן המקור נשאר "הטבה" ולא "בחירה": בתום התקופה
        // ‎expire_launch_promos‎ מוריד/ה בדיוק את המקור הזה ל-Pay&GO.
        const { error } = await supabase.rpc("record_tier_selection", {
          p_member_id: me.id,
          p_tier: promoTier,
          p_source: "launch_promo_accepted",
          p_note: "אישור הטבת ההשקה במסך בחירת המסלול",
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ status: "applied", tier: promoTier, promo_ends_at: me.promo_ends_at });
      }

      if (tier === "free") {
        const { error } = await supabase.rpc("record_tier_selection", {
          p_member_id: me.id, p_tier: "free", p_source: "self", p_note: "בחירה עצמית במסך המסלולים",
        });
        if (error) return json({ error: "db_error", detail: error.message }, 500);
        return json({ status: "applied", tier: "free" });
      }

      // מסלול בתשלום: בקשה, לא שינוי.
      // בקשה זהה שכבר פתוחה לא נרשמת פעמיים ולא מייצרת מייל שני — לחיצה
      // חוזרת אחרי שהתשובה כבר נאמרה היא הדבר הטבעי ביותר לעשות.
      if (me.pending_tier_change === tier) {
        return json({
          status: "requested",
          tier,
          current_tier: me.tier,
          already: true,
          detail: `הבקשה למסלול ${TIER_NAMES[tier]} כבר נקלטה. ניצור קשר להסדרת התשלום.`,
        });
      }

      const { error: reqErr } = await supabase
        .from("agency_members")
        .update({ pending_tier_change: tier, pending_tier_change_at: new Date().toISOString().slice(0, 10) })
        .eq("id", me.id);
      if (reqErr) return json({ error: "db_error", detail: reqErr.message }, 500);

      await supabase.from("tier_changes").insert({
        member_id: me.id, agency_id: me.agency_id,
        from_tier: me.tier, to_tier: tier, source: "requested",
        note: "בקשת שדרוג מדף המסלולים - ממתינה להסדרת תשלום",
      });

      const { data: agency } = await supabase
        .from("agencies").select("name").eq("id", me.agency_id).maybeSingle();
      const price = TIER_PRICES[tier];
      const who = `${me.display_name || "סוכן/ת"} (${me.email || userEmail}) · ${agency?.name || "ללא משרד"}`;
      await sendPlatformEmail({
        to: [PLATFORM_CONTACT_EMAIL],
        subject: `בקשת שדרוג מסלול: ${TIER_NAMES[tier]} - ${String(me.display_name || me.email || "").slice(0, 80)}`,
        html: `<div dir="rtl" style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.7">
          <p><b>${esc(who)}</b> ביקש/ה לעבור למסלול <b>${TIER_NAMES[tier]}</b> (₪${price} לחודש + מע״מ).</p>
          <p>המסלול <b>לא</b> שונה - הבקשה רשומה ב-<code>pending_tier_change</code>, וההפעלה נעשית אחרי הסדרת התשלום.</p>
        </div>`,
        text: `${who} ביקש/ה לעבור ל-${TIER_NAMES[tier]} (₪${price} + מע"מ). המסלול לא שונה - ההפעלה אחרי הסדרת התשלום.`,
      });

      return json({
        status: "requested",
        tier,
        current_tier: me.tier,
        detail: `הבקשה למסלול ${TIER_NAMES[tier]} נקלטה. ניצור קשר להסדרת התשלום, והמסלול יופעל מיד אחריה.`,
      });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err: any) {
    return json({ error: "unhandled", detail: String(err?.message ?? err) }, 500);
  }
});
