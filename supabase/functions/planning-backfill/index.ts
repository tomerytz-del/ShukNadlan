import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { lookupPlanning } from "../_shared/afula-planning.ts";

// ============================================================================
// השלמת מידע תכנוני לנכסים שכבר במסד
//
// נקראת מ-pg_cron פעם בשעה, ורק כשיש מה להשלים
// (‏planning_backfill_pending() בתנאי ה-cron; המיגרציה 20261110090000).
//
// ## למה זה קיים
//
// ‏property_planning_info נכתבת רק בטופס הנכס ב-CRM. נכס שנכנס מאשף הייבוא
// או מהעוזר בוואטסאפ לא נוגע בה — וכך נמדדו 70 נכסים פעילים בעפולה מול
// **2 שורות** בטבלה. אותו כשל שכבר תועד על הגיאוקוד, ואותו פתרון.
//
// ## למה לא לקרוא ל-afula-planning-lookup
//
// היא דורשת JWT של סוכן/ת עם מסלול Mid/Premium, ולסורק אין משתמש/ת. שתיהן
// חולקות את השליפה עצמה ב-_shared/afula-planning.ts — ולא מחזיקות שני
// העתקים, שזה בדיוק הבאג שתוקן היום פעמיים.
//
// ## מה היא לא עושה
//
// **לא דורסת מידע קיים.** נכס שכבר יש לו גוש אינו בתור כלל, כי ייתכן
// שהמידע שלו עודכן ידנית או נשלף על כתובת מדויקת יותר.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 20;          // נכסים לסבב
const MAX_FAILURES = 5;    // תקלות תקשורת רצופות שאחריהן מפסיקים

// תקציב זמן לסבב, מתחת ל-timeout_milliseconds של ה-cron (60 שניות). כל נכס
// הוא כמה שאילתות WFS סדרתיות; חריגה אינה מאבדת עבודה — כל נכס נרשם מיד
// כשהסתיים — אבל pg_net מדווח עליה כ-"500" שאינו מספר מה קרה.
const DEADLINE_MS = 45_000;

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

  const { data: queue, error: queueErr } = await supabase.rpc("planning_backfill_queue", {
    p_limit: BATCH,
  });
  if (queueErr) return json({ error: "queue_failed", detail: queueErr.message }, 500);
  if (!queue || !queue.length) return json({ ok: true, checked: 0, resolved: 0 });

  let resolved = 0, notFound = 0, failed = 0;
  let streak = 0;
  let ranOut = false;
  const startedAt = Date.now();

  for (const row of queue) {
    if (Date.now() - startedAt > DEADLINE_MS) { ranOut = true; break; }

    try {
      const result = await lookupPlanning({
        street: String(row.street || "").trim(),
        house_number: String(row.house_number || "").trim(),
      });
      streak = 0;

      if (result.ok) {
        resolved++;
        await supabase.rpc("planning_record_result", { p_id: row.id, p_record: result.record });
      } else {
        // תשובה סופית מהשכבה — אין כזו כתובת. מעלה את המונה.
        notFound++;
        await supabase.rpc("planning_record_result", {
          p_id: row.id, p_error: result.error, p_transient: false,
        });
      }
    } catch (err) {
      // תקלת תקשורת/שכבה. **לא** מעלה את המונה: WFS שנפל אינו ראיה על הכתובת.
      failed++;
      streak++;
      await supabase.rpc("planning_record_result", {
        p_id: row.id,
        p_error: String((err && (err as Error).message) || err).slice(0, 300),
        p_transient: true,
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
