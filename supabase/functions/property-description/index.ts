import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { generateMarketingCopy } from "../_shared/marketing-copy.ts";

// ============================================================================
// תיאור שיווקי לנכס — השרת של שני המסלולים.
//
// ‏1. **אוטומטי.** ‏pg_cron קורא כאן כל חמש דקות (‏§9 במיגרציה 20260925090000)
//    ומרוקן את property_description_jobs: נכס פעיל שנשמר בלי תיאור שיווקי
//    מקבל אחד, שנכתב מהנתונים שהסוכן/ת הזין/ה בטופס. הטקסט נשמר על
//    ‏`properties` — ולכן הוא זמין מיד לדף הנכס, ל-CRM, לפוסט בפייסבוק ולכל
//    ערוץ שיתווסף אחר כך.
//
// ‏2. **ידני.** הסוכן/ת לוחץ/ת "רענון תיאור שיווקי" ב-CRM, ומקבל/ת נוסח חדש
//    שנכתב מהנתונים **כפי שהם עכשיו**. שני מצבים:
//      ‏preview — מחזיר את הטקסט למסך בלי לשמור. זו ברירת המחדל: החלטה על
//                נוסח שיווקי היא של הסוכן/ת, לא של המערכת.
//      ‏apply   — כותב ושומר. המצב היחיד שבו תיאור קיים נדרס, וגם הוא רק
//                בעקבות לחיצה מפורשת.
//
// **הכלל שלא נשבר:** במסלול האוטומטי אי אפשר לדרוס טקסט של אדם. זה לא תנאי
// בקוד הזה אלא בשאילתת התור עצמה (‏pending_property_descriptions), שמחזירה
// אך ורק נכסים שאין להם תיאור. גם באג כאן לא יכול למחוק נוסח שנכתב ביד.
//
// האימות: סוד ה-cron / service role למסלול האוטומטי, ו-JWT של סוכן/ת למסלול
// הידני. ההרשאה על הנכס וה-cooldown נבדקים במסד (‏request_property_description)
// ולא כאן — אותו עיקרון כמו ב-bump_property.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5";

// כמה נכסים בהרצה אחת. הקצב האמיתי נשמר בתקרה היומית שב-pricing_config; כאן
// זו רק הגנה על זמן הריצה — כל נכס הוא קריאה אחת ל-Anthropic.
const BATCH = 5;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Sb = any;

/** עובדות הנכס מהמסד — מקור אמת אחד לשני המסלולים. */
async function loadFacts(sb: Sb, propertyId: string) {
  const { data, error } = await sb.rpc("property_marketing_facts", {
    p_property_id: propertyId,
  });
  if (error) throw new Error(`קריאת נתוני הנכס נכשלה: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("הנכס לא נמצא");
  return row;
}

/** כתיבת הנוסח. מפרידה בין "לא הוגדר מפתח" (מצב התקנה) לבין כישלון אמיתי. */
async function writeCopy(row: Record<string, unknown>) {
  const copy = await generateMarketingCopy(row, { apiKey: ANTHROPIC_KEY, model: CLAUDE_MODEL });
  if (!copy) throw new Error("ANTHROPIC_API_KEY אינו מוגדר");
  return copy;
}

// ---------------------------------------------------------------------------
// המסלול האוטומטי — ריקון התור
// ---------------------------------------------------------------------------
async function drainQueue(sb: Sb, limit: number) {
  const { data: jobs, error } = await sb.rpc("pending_property_descriptions", { p_limit: limit });
  if (error) return json({ error: "queue_read_failed", detail: error.message }, 500);
  if (!jobs?.length) return json({ ok: true, processed: 0 });

  const results: unknown[] = [];
  for (const job of jobs) {
    try {
      // התפיסה קודמת לכל השאר: שתי הרצות חופפות של ה-cron מושכות את אותה
      // שורה, ובלעדיה שתיהן היו משלמות על אותו טקסט.
      const { data: claimed } = await sb.rpc("claim_property_description", { p_job_id: job.job_id });
      if (!claimed) {
        results.push({ property_id: job.property_id, skipped: "claimed_by_another_run" });
        continue;
      }

      const row = await loadFacts(sb, job.property_id);
      const copy = await writeCopy(row);

      const { data: saved, error: applyErr } = await sb.rpc("apply_property_marketing_description", {
        p_property_id: job.property_id,
        p_description: copy.description,
        p_post_text: copy.post,
      });
      if (applyErr) throw new Error(`שמירת התיאור נכשלה: ${applyErr.message}`);
      if (!saved) throw new Error("שמירת התיאור לא עדכנה אף שורה");

      await sb.rpc("mark_property_description", { p_job_id: job.job_id, p_ok: true, p_error: null });
      results.push({ property_id: job.property_id, reason: job.reason, generated: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("כתיבת תיאור שיווקי נכשלה", job.property_id, message);
      await sb.rpc("mark_property_description", {
        p_job_id: job.job_id,
        p_ok: false,
        p_error: message.slice(0, 500),
      });
      results.push({ property_id: job.property_id, error: message });
    }
  }

  return json({ ok: true, processed: results.length, results });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const internal = authorizeInternalCaller(req);
  const authHeader = req.headers.get("Authorization") || "";
  const sb = createClient(supabaseUrl, serviceRoleKey);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // ‏pg_cron שולח בקשה בלי גוף
  }

  const propertyId: string | null = body?.property_id ?? null;
  const mode: string = body?.mode === "apply" ? "apply" : "preview";

  // ---------------------------------------------------------------------
  // ריקון התור — הקוראים הפנימיים בלבד
  // ---------------------------------------------------------------------
  if (!propertyId) {
    if (!internal.ok) {
      if (internal.status === 503) return json({ error: internal.error, detail: internal.detail }, 503);
      return json({ error: "unauthorized" }, 401);
    }
    if (!ANTHROPIC_KEY) {
      // לא נוגעים בתור: השורות ימתינו להגדרת המפתח ולא יישרפו על ניסיונות
      // כושלים במצב שבו אף אחת מהן לא הייתה יכולה להצליח.
      return json({ error: "copy_not_configured", detail: "ANTHROPIC_API_KEY אינו מוגדר" }, 503);
    }
    return await drainQueue(sb, BATCH);
  }

  // ---------------------------------------------------------------------
  // המסלול הידני — סוכן/ת שביקש/ה נוסח לנכס מסוים
  //
  // ההרשאה וה-cooldown נבדקים במסד, בהקשר של ה-JWT עצמו. קורא פנימי
  // (‏service role / cron) מדלג על הבדיקה הזו: אין לו auth.uid(), והוא ממילא
  // מהימן.
  // ---------------------------------------------------------------------
  let jobId: string | null = null;

  if (!internal.ok) {
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: gate, error: gateErr } = await authed.rpc("request_property_description", {
      p_property_id: propertyId,
    });
    if (gateErr) return json({ error: "request_failed", detail: gateErr.message }, 500);

    const codes: Record<string, number> = {
      not_authenticated: 401,
      not_your_property: 403,
      property_not_found: 404,
      cooldown_active: 429,
    };
    if (gate?.error) {
      return json(
        { error: gate.error, retry_after_seconds: gate.retry_after_seconds ?? null },
        codes[gate.error] ?? 400,
      );
    }
    jobId = gate?.job_id ?? null;
  }

  if (!ANTHROPIC_KEY) {
    return json({ error: "copy_not_configured", detail: "ANTHROPIC_API_KEY אינו מוגדר" }, 503);
  }

  try {
    const row = await loadFacts(sb, propertyId);
    const copy = await writeCopy(row);
    const hadDescription = Boolean(String(row.marketing_description ?? "").trim());

    if (mode === "apply") {
      const { data: saved, error: applyErr } = await sb.rpc("apply_property_marketing_description", {
        p_property_id: propertyId,
        p_description: copy.description,
        p_post_text: copy.post,
      });
      if (applyErr) throw new Error(`שמירת התיאור נכשלה: ${applyErr.message}`);
      if (!saved) throw new Error("שמירת התיאור לא עדכנה אף שורה");
      if (jobId) await sb.rpc("mark_property_description", { p_job_id: jobId, p_ok: true, p_error: null });

      return json({
        ok: true,
        mode: "apply",
        property_id: propertyId,
        marketing_description: copy.description,
        post_text: copy.post,
        replaced: hadDescription,
      });
    }

    // תצוגה מקדימה: הטקסט חוזר למסך ואינו נשמר.
    //
    // מה קורה לשורת התור תלוי במצב הנכס. יש לו כבר תיאור — הבקשה מוצתה,
    // והשורה נסגרת. אין לו — הנכס עדיין זקוק לטקסט, והשורה חוזרת לתור עם
    // ההשהיה הרגילה: חלון לסוכן/ת להדביק ולשמור את מה שראה/תה, ואם לא —
    // המסלול האוטומטי ישלים בעצמו, בדיוק כפי שהיה עושה בלי הלחיצה הזו.
    if (jobId) {
      if (hadDescription) {
        await sb.rpc("mark_property_description", { p_job_id: jobId, p_ok: true, p_error: null });
      } else {
        await sb.rpc("queue_property_description", {
          p_property_id: propertyId,
          p_reason: "missing",
          p_force: true,
          p_delay_minutes: null,
        });
      }
    }

    return json({
      ok: true,
      mode: "preview",
      property_id: propertyId,
      marketing_description: copy.description,
      post_text: copy.post,
      current_source: row.marketing_description_source ?? null,
      was_stale: row.marketing_description_stale ?? false,
      replaced: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("כתיבת תיאור שיווקי נכשלה", propertyId, message);
    if (jobId) {
      await sb.rpc("mark_property_description", {
        p_job_id: jobId,
        p_ok: false,
        p_error: message.slice(0, 500),
      });
    }
    return json({ error: "generation_failed", detail: message.slice(0, 300) }, 502);
  }
});
