import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { classifyImage, corsHeaders, fetchAsBase64, json } from "../_shared/visualization.ts";

// ============================================================================
// סיווג תמונות נכס — מיובא מ-classify-photos של nadlan-afula.co.il.
//
// ‏POST { property_id }  — מסווג נכס אחד
// ‏POST { limit: 100 }   — מסווג את מה שממתין בכל הנכסים הזכאים (backfill/cron)
//
// שים לב: ההדמיה עצמה כבר קוראת ל-ensureTagged ומסווגת מה שחסר לה תוך כדי,
// ולכן הפונקציה הזו אינה תנאי לעבודה שוטפת. היא קיימת לשני דברים: מילוי
// לאחור אחרי הפעלת המנגנון, והרצה תקופתית שמפזרת את עלות הסיווג מראש כדי
// שהגולש/ת לא יחכה לה בזמן אמת.
//
// ‏verify_jwt=false כדי שאפשר יהיה לקרוא לה מ-cron/backfill בלי JWT של
// משתמש/ת. הקלט אמנם אינו משפיע על *מה* שנכתב — רק על כמה שורות לעבד —
// אבל כל קריאה שורפת GEMINI_API_KEY (עד 300 סיווגים בבקשה, לפי `limit`
// שמגיע מגוף הבקשה), ולכן היא דורשת אימות פנימי כמו שאר הקוראים של ה-cron.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VISION_MODEL = Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-3.1-flash-lite";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "gemini_not_configured" }, 500);

  let body: any = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // אין גוף בקשה — ברירת המחדל תופסת
  }

  const propertyId: string | null = body.property_id ?? null;
  const limit = Math.min(Number(body.limit) || 100, 300);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- סנכרון properties.images -> property_image_tags -------------------
  // ‏properties.images הוא מקור האמת. כל תמונה שאין לה עדיין שורת תיוג
  // מקבלת אחת; תמונה שהוסרה מהמערך פשוט נשארת מאחור ולא נבחרת יותר.
  let propsQuery = supabase
    .from("properties")
    .select("id, images")
    .eq("status", "active")
    .not("images", "eq", "{}");

  propsQuery = propertyId ? propsQuery.eq("id", propertyId) : propsQuery.limit(200);

  const { data: props, error: propsErr } = await propsQuery;
  if (propsErr) return json({ error: "db_error", detail: propsErr.message }, 500);
  if (!props || props.length === 0) return json({ ok: true, synced: 0, processed: 0 });

  const toSync: Array<{ property_id: string; image_url: string }> = [];
  for (const p of props) {
    for (const url of (p.images ?? []).filter(Boolean)) {
      toSync.push({ property_id: p.id, image_url: url });
    }
  }

  if (toSync.length > 0) {
    // מנות של 500 — upsert ענק בבקשה אחת נופל על גודל ה-payload
    for (let i = 0; i < toSync.length; i += 500) {
      await supabase
        .from("property_image_tags")
        .upsert(toSync.slice(i, i + 500), { onConflict: "property_id,image_url", ignoreDuplicates: true });
    }
  }

  // ---- סיווג מה שממתין --------------------------------------------------
  let pendingQuery = supabase
    .from("property_image_tags")
    .select("id, image_url")
    .is("classified_at", null)
    .limit(limit);

  if (propertyId) pendingQuery = pendingQuery.eq("property_id", propertyId);

  const { data: pending, error: pendErr } = await pendingQuery;
  if (pendErr) return json({ error: "db_error", detail: pendErr.message }, 500);
  if (!pending || pending.length === 0) {
    return json({ ok: true, synced: toSync.length, processed: 0, message: "אין תמונות ממתינות לסיווג" });
  }

  let processed = 0;
  let failed = 0;
  // הסיבות נאספות ומוחזרות בתשובה. בלעדיהן "failed: 5" הוא מספר בלי משמעות,
  // ולא היה שום הבדל גלוי בין מודל בשם שגוי, מכסה שנגמרה ותמונה פגומה.
  const reasons = new Set<string>();
  const BATCH = 5;

  for (let i = 0; i < pending.length; i += BATCH) {
    await Promise.all(
      pending.slice(i, i + BATCH).map(async (row: any) => {
        const img = await fetchAsBase64(row.image_url);
        if (!img) {
          failed++;
          reasons.add("לא ניתן להוריד את התמונה");
          return;
        }
        const { error: classifyErr, ...tags } = await classifyImage(apiKey, img.mime, img.data);
        // כשל בקריאה ל-Gemini אינו תיוג. השורה נשארת בלי classified_at כדי
        // שההרצה הבאה תנסה אותה שוב — אחרת תקלה חולפת הייתה מקבעת את הנכס
        // כ"אין תמונות מתאימות" לצמיתות.
        if (classifyErr) {
          failed++;
          reasons.add(classifyErr);
          return;
        }
        const { error: updErr } = await supabase
          .from("property_image_tags")
          .update({ ...tags, classified_at: new Date().toISOString(), model: VISION_MODEL })
          .eq("id", row.id);
        if (updErr) {
          failed++;
          reasons.add(`db: ${updErr.message}`);
        } else processed++;
      })
    );
  }

  return json({
    // ‏ok משקף את מה שקרה בפועל: ריצה שבה כל התמונות נכשלו אינה הצלחה.
    ok: failed === 0,
    synced: toSync.length,
    processed,
    failed,
    ...(reasons.size ? { reasons: [...reasons] } : {}),
    model: VISION_MODEL,
    more_pending: pending.length === limit,
  });
});
