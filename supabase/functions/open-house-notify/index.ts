import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { sendPlatformEmail } from "../_shared/platform-mail-client.ts";

// ============================================================================
// "נכס חדש ביריד" — שרת ההתראות של רשימת ההמתנה.
//
// נקרא מ-pg_cron כל רבע שעה, ורק כשיש למי לשלוח (‏open_house_digest_pending()
// בתנאי ה-cron; ראו המיגרציה 20261103090000_open_house_subscribers.sql).
//
// ## הסמן, ולמה הוא לכל נרשם/ת בנפרד
//
// לכל שורה ב-open_house_subscribers יש last_notified_at. בכל סבב נשלחים
// לאדם רק הנכסים שנכנסו ליריד **אחרי** הסמן שלו, והסמן מתקדם רק אחרי
// משלוח שהצליח. משמעות שלושת הדברים האלה יחד:
//
//   · מי שנרשם/ה היום לא מקבל/ת את מי שנכנס ליריד אתמול (הסמן מתחיל ב-now()).
//   · מייל שנכשל יישלח שוב בסבב הבא — הסמן לא זז, ואין התראה שנבלעת.
//   · אין טבלת תור: הסמן *הוא* התור. תור נפרד היה טבלה שלישית שצריך לנקות,
//     והשאלה "מה חדש בשבילך" נענית ממילא בשאילתה אחת.
//
// ## המרווח המזערי
//
// ‏MIN_GAP_MINUTES (60) — שני נכסים שנכנסים ליריד ברבע שעה זה מזה מגיעים
// במייל אחד ולא בשניים. "ראשונים לדעת" אינו "שלושה מיילים בשעה": מי שקיבל
// שלושה מיילים בשעה מסיר את עצמו, ואז הוא כבר לא יודע ראשון על כלום.
// הבדיקה כאן בלבד ולא בתנאי ה-cron — התנאי שם הוא superset בכוונה, כמו כל
// שאר התנאים בפרויקט.
//
// ## התקרות
//
// ‏Gmail מוגבל ל-500 נמענים ביום (ראו platform-mail), וכל מייל כאן הוא
// נמען אחד — קישור ההסרה שבתוכו אישי. ‏BATCH=80 לסבב, ארבעה סבבים בשעה,
// כלומר התקרה נשמרת גם כשהרשימה גדלה. מי שלא נכנס/ה לסבב הזה נכנס/ת לבא:
// הרשימה ממוינת לפי הסמן, כלומר מי שמחכה הכי הרבה יוצא/ת ראשון/ה.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_BASE = `${supabaseUrl}/functions/v1`;
const SITE_BASE_URL = (Deno.env.get("SITE_BASE_URL") || "").replace(/\/$/, "");

const BATCH = 80;               // נרשמים לסבב
const MIN_GAP_MINUTES = 60;     // מרווח מזערי בין שני מיילים לאותו אדם
const MAX_ITEMS = 6;            // נכסים במייל אחד — מעבר לזה זו רשימה, לא התראה
const LOOKBACK_DAYS = 30;       // כמה אחורה בכלל נשלפים נכסים

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const nis = (n: number | null) =>
  n === null || n === undefined || !Number(n)
    ? "לפי בקשה"
    : "₪" + Math.round(Number(n)).toLocaleString("he-IL");

/** "4 חדרים · 98 מ״ר · קומה 3" — רק מה שבאמת קיים במודעה. */
function specLine(p: any): string {
  return [
    p.rooms ? `${p.rooms} חדרים` : null,
    p.size_sqm ? `${Math.round(p.size_sqm)} מ״ר` : null,
    p.floor !== null && p.floor !== undefined ? `קומה ${p.floor}` : null,
  ].filter(Boolean).join(" · ");
}

function placeLine(p: any): string {
  // ‏PostgREST מחזיר יחס אחד-לאחד כאובייקט או כמערך בן איבר אחד, לפי גרסה
  const hood = Array.isArray(p.neighborhoods) ? p.neighborhoods[0]?.name : p.neighborhoods?.name;
  return [hood, p.street, p.city].filter(Boolean).join(", ");
}

/** "עד 14.10" — אותו ניסוח של assets/open-house.js, בצד השרת. */
function endLabel(p: any): string {
  const end = new Date(p.open_house_end);
  if (isNaN(end.getTime())) return "";
  const day = 864e5;
  const left = Math.floor(end.getTime() / day) - Math.floor(Date.now() / day);
  if (left <= 0) return "היום האחרון";
  if (left === 1) return "עד מחר";
  return "עד " + end.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

const propertyUrl = (id: string) =>
  SITE_BASE_URL ? `${SITE_BASE_URL}/property.html?id=${encodeURIComponent(id)}` : "";
const fairUrl = () => (SITE_BASE_URL ? `${SITE_BASE_URL}/open-house.html` : "");
const unsubUrl = (token: string) =>
  `${FUNCTIONS_BASE}/open-house-manage?action=unsubscribe&token=${encodeURIComponent(token)}`;

// ---------------------------------------------------------------------------
// ההודעה
// ---------------------------------------------------------------------------
function buildEmail(items: any[], token: string) {
  const one = items.length === 1;
  const subject = one
    ? `נכס חדש ללא עמלת תיווך: ${String(items[0].title || "").slice(0, 60)}`
    : `${items.length} נכסים חדשים ללא עמלת תיווך ביריד`;

  const text = [
    one ? "נכס חדש נכנס ליריד הבתים הפתוחים" : `${items.length} נכסים חדשים נכנסו ליריד הבתים הפתוחים`,
    "מוצעים לקונים ללא עמלת תיווך, לתקופה קצובה.",
    "",
    ...items.map((p) => [
      p.title || "נכס",
      placeLine(p),
      [nis(p.price), specLine(p)].filter(Boolean).join(" · "),
      endLabel(p),
      propertyUrl(p.id),
      "",
    ].filter(Boolean).join("\n")),
    fairUrl() ? `כל נכסי היריד: ${fairUrl()}` : "",
    "",
    `להסרה מהרשימה: ${unsubUrl(token)}`,
  ].filter(Boolean).join("\n");

  const cards = items.map((p) => {
    const img = Array.isArray(p.images) && typeof p.images[0] === "string" ? p.images[0] : "";
    const place = placeLine(p);
    const spec = specLine(p);
    const url = propertyUrl(p.id);
    return `<div style="background:#fff;border:1px solid #E4DFD6;border-radius:14px;overflow:hidden;margin:0 0 14px">
      ${img ? `<img src="${esc(img)}" alt="" style="display:block;width:100%;max-height:240px;object-fit:cover">` : ""}
      <div style="padding:16px">
        <span style="display:inline-block;background:#C8102E;color:#fff;font-size:12px;font-weight:bold;padding:3px 9px;margin:0 0 9px">ללא עמלת תיווך · ${esc(endLabel(p))}</span>
        <h2 style="margin:0 0 6px;font-size:17px;line-height:1.35">${esc(p.title || "נכס")}</h2>
        ${place ? `<p style="margin:0 0 8px;color:#5A6675;font-size:14px">${esc(place)}</p>` : ""}
        <p style="margin:0 0 14px;font-size:16px;font-weight:bold">${esc(nis(p.price))}${
          spec ? `<span style="font-weight:normal;color:#5A6675;font-size:14px"> · ${esc(spec)}</span>` : ""
        }</p>
        ${url ? `<a href="${esc(url)}" style="display:inline-block;background:#0e2a6b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:15px">לצפייה בנכס</a>` : ""}
      </div>
    </div>`;
  }).join("");

  const html = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
<body style="margin:0;background:#F5F3EF;font-family:Arial,Helvetica,sans-serif;color:#1B2A41">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#C8102E">יריד הבתים הפתוחים</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35">${
      one ? "נכס חדש נכנס ליריד" : `${items.length} נכסים חדשים נכנסו ליריד`
    }</h1>
    ${cards}
    ${fairUrl() ? `<p style="text-align:center;margin:18px 0 0"><a href="${esc(fairUrl())}" style="color:#0e2a6b;font-size:14px">כל הנכסים שביריד ←</a></p>` : ""}
    <p style="font-size:12px;color:#98A2B0;margin:18px 0 0;text-align:center">
      קיבלת את ההודעה כי נרשמת לעדכוני יריד הבתים הפתוחים בשוק נדל״ן.<br>
      <a href="${esc(unsubUrl(token))}" style="color:#98A2B0">הסרה מהרשימה</a>
    </p>
  </div>
</body></html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const now = Date.now();
  const gapBefore = new Date(now - MIN_GAP_MINUTES * 60_000).toISOString();

  // מי שמחכה הכי הרבה יוצא/ת ראשון/ה: הסמן הישן ביותר בראש
  const { data: subs, error: subsError } = await sb
    .from("open_house_subscribers")
    .select("id, email, last_notified_at, unsubscribe_token")
    .is("unsubscribed_at", null)
    .lte("last_notified_at", gapBefore)
    .order("last_notified_at", { ascending: true })
    .limit(BATCH);

  if (subsError) {
    console.error("open house subscribers read failed", subsError);
    return json({ error: "server_error" }, 500);
  }
  if (!subs || subs.length === 0) return json({ ok: true, sent: 0, reason: "no_due_subscribers" });

  // הנכסים שביריד עכשיו ונכנסו אליו אחרי הסמן המוקדם ביותר שבסבב. שאילתה
  // אחת לכל הנרשמים — החיתוך לכל אדם נעשה בזיכרון, כי הרשימה קצרה.
  /* השוואת זמנים ב-Date ולא בין מחרוזות ISO: ‏PostgREST מחזיר timestamptz
     עם היסט (‏+00:00), וברגע ששתי מחרוזות נכתבו בהיסטים שונים ההשוואה
     הלקסיקוגרפית מחזירה תשובה הפוכה מהאמת. */
  const at = (v: unknown) => new Date(String(v)).getTime();
  const oldestCursor = subs.reduce(
    (min, s) => (at(s.last_notified_at) < at(min) ? s.last_notified_at : min),
    subs[0].last_notified_at as string,
  );
  const lookbackFloor = new Date(now - LOOKBACK_DAYS * 864e5).toISOString();
  const since = at(oldestCursor) > at(lookbackFloor) ? oldestCursor : lookbackFloor;
  const nowIso = new Date(now).toISOString();

  const { data: properties, error: propsError } = await sb
    .from("properties")
    .select("id, title, price, rooms, size_sqm, floor, city, street, images, " +
            "open_house_end, open_house_joined_at, neighborhoods(name)")
    .eq("status", "active")
    .eq("open_house", true)
    .lte("open_house_start", nowIso)
    .gt("open_house_end", nowIso)
    .gt("open_house_joined_at", since)
    .order("open_house_joined_at", { ascending: false })
    .limit(60);

  if (propsError) {
    console.error("open house properties read failed", propsError);
    return json({ error: "server_error" }, 500);
  }
  if (!properties || properties.length === 0) return json({ ok: true, sent: 0, reason: "no_new_properties" });

  let sent = 0, failed = 0, skipped = 0;

  for (const sub of subs) {
    const items = properties
      .filter((p) => at(p.open_house_joined_at) > at(sub.last_notified_at))
      .slice(0, MAX_ITEMS);
    if (items.length === 0) { skipped++; continue; }

    const mail = buildEmail(items, String(sub.unsubscribe_token));
    const result = await sendPlatformEmail({ to: [String(sub.email)], ...mail });

    if (result.sent) {
      /* הסמן מתקדם רק כאן, ודרך RPC ולא update: ‏notify_count = notify_count
         + 1 אינו ניתן לביטוי ב-PostgREST בלי לקרוא קודם את הערך, וקריאה
         ואז כתיבה היא מרוץ מול הסבב הבא. ‏open_house_mark_notified עושה את
         שלושתם בפקודה אחת (סמן, מונה, ניקוי שגיאה קודמת).
         ‏now() ולא זמן הנכס האחרון: נכס שנכנס ליריד תוך כדי הסבב הזה ייכנס
         לעדכון הבא ולא ייבלע בין השניים. */
      const { error } = await sb.rpc("open_house_mark_notified", { p_id: sub.id });
      if (error) console.error("cursor update failed", error);
      sent++;
    } else {
      failed++;
      await sb.from("open_house_subscribers")
        .update({ last_error: String(result.error ?? "send_failed").slice(0, 300) })
        .eq("id", sub.id);
    }
  }

  return json({ ok: true, sent, failed, skipped, candidates: subs.length });
});
