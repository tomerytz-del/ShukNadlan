import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { afulaAddressToCoords } from "../_shared/afula-geocode.ts";

// ============================================================================
// השלמת קואורדינטות לנכסים שיש להם כתובת מדויקת ואין להם פין
//
// נקראת מ-pg_cron פעם בשעה, ורק כשיש מה להשלים (‏geocode_backfill_pending()
// בתנאי ה-cron; ראו המיגרציה 20261105090000_geocode_backfill.sql).
//
// ## למה זה קיים
//
// ‏lat/lng נכתבים היום רק בטופס הנכס ב-CRM, שקורא ל-geocode-address בזמן
// שמירה. נכס שנכנס בדרך אחרת — אשף הייבוא המרוכז — או נכס שנשמר בדיוק
// כשה-WFS של העירייה היה למטה, נשאר בלי קואורדינטות, ונכס בלי קואורדינטות
// **נעלם מכל מפה באתר**. הוא לא שבור ולא מסומן: הוא פשוט לא שם.
//
// ## מה היא לא עושה
//
// **לא נוגעת בשום דבר מלבד lat/lng.** לא ממציאה מיקום לנכס שנרשם עם עיר
// בלבד (פין על מרכז עפולה נראה מדויק ואינו כזה — ראו docs/property-map.md),
// ולא מזיזה קואורדינטות שכבר קיימות, גם אם השכבה חושבת אחרת: ייתכן מאוד
// שסוכן/ת הזיז/ה את הפין ידנית, וזו החלטה שלו/ה.
//
// ## התור והמונה
//
// התור כולו מוגדר ב-DB (‏geocode_backfill_queue) ולא כאן, כדי שהתנאי שלפיו
// ה-cron דולק והתנאי שלפיו נבחרות שורות יהיו אותו תנאי בדיוק.
//
// כישלון סופי ("אין כזו כתובת בשכבה") מעלה את geocode_attempts, ואחרי 3
// הנכס יוצא מהתור — כתובת שגויה לא תיפתר מעצמה, וניסיון נצחי הוא רעש.
// תקלת תקשורת **לא** מעלה את המונה: ‏WFS שנפל אינו ראיה על הכתובת.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 25;          // נכסים לסבב
const MAX_FAILURES = 8;    // תקלות תקשורת רצופות שאחריהן מפסיקים את הסבב

// תקציב זמן לסבב, מתחת ל-timeout_milliseconds של ה-cron (30 שניות).
//
// נכס שלא נמצא עולה MAX_VARIANTS קריאות WFS סדרתיות, ואצווה שכולה החטאות
// יכולה לחרוג. חריגה אינה מאבדת עבודה — כל נכס נרשם מיד כשהסתיים — אבל
// ‏pg_net מדווח עליה כ-"500" שאינו מספר מה קרה. עדיף לעצור מסודר: מי
// שנשאר בתור יוצא ראשון בסבב הבא, כי המיון הוא לפי מי שממתין הכי הרבה.
const DEADLINE_MS = 20_000;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: queue, error: queueErr } = await supabase.rpc("geocode_backfill_queue", {
    p_limit: BATCH,
  });
  if (queueErr) return json({ error: "queue_failed", detail: queueErr.message }, 500);
  if (!queue || !queue.length) return json({ ok: true, checked: 0, resolved: 0 });

  let resolved = 0, notFound = 0, failed = 0;
  // תקלות רצופות פירושן שהשכבה למטה, לא שהכתובות גרועות. ממשיכים לספור
  // אותן לכל הנכסים היה מאריך את הסבב עד ל-timeout של pg_net ומסתיים
  // ב-"500" שאינו מספר מה קרה. עדיף לעצור מוקדם ולחזור בשעה הבאה.
  let streak = 0;
  let ranOut = false;
  const startedAt = Date.now();

  for (const row of queue) {
    if (Date.now() - startedAt > DEADLINE_MS) { ranOut = true; break; }
    const street = String(row.street || "").trim();
    const house = String(row.house_number || "").trim();
    if (!street || !house) continue;

    try {
      const coords = await afulaAddressToCoords(street, house);
      streak = 0;
      if (coords) {
        resolved++;
        await supabase.rpc("geocode_record_result", {
          p_id: row.id, p_lat: coords.lat, p_lng: coords.lng, p_error: null,
        });
      } else {
        notFound++;
        await supabase.rpc("geocode_record_result", {
          p_id: row.id, p_lat: null, p_lng: null, p_error: "address_not_found",
        });
      }
    } catch (err) {
      failed++;
      streak++;
      const detail = String((err && (err as Error).message) || err).slice(0, 300);
      await supabase.rpc("geocode_record_result", {
        p_id: row.id, p_lat: null, p_lng: null, p_error: detail,
      });
      if (streak >= MAX_FAILURES) break;
    }
  }

  return json({
    ok: true,
    checked: resolved + notFound + failed,
    queued: queue.length,
    resolved,
    not_found: notFound,
    failed,
    ran_out_of_time: ranOut,
  });
});
