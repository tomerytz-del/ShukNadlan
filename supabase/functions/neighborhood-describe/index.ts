import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { anthropicRow, logAiUsage } from "../_shared/ai-usage.ts";
import { noLongDash } from "../_shared/marketing-copy.ts";

// ============================================================================
// טיוטות תיאור לדפי השכונות - שלב 8 בשדרוג אזור הניהול, חלק ב
//
// פעם בשבוע (pg_cron, שני 06:17 UTC) - 10 שכונות מ-neighborhood_describe_candidates,
// כל אחת קריאה אחת למודל, ושורת draft ב-neighborhood_descriptions. **טיוטה אינה
// מתפרסמת:** היא נכנסת לתיבת המשימות (hood_draft) ומחכה לאישור ב-CRM.
//
// הקלט למודל הוא בדיוק מה שהדף מציג (neighborhood_page) - ציבורי ומצטבר:
// שם, עיר, מספר נכסים, טווחי מחיר, חציון עסקאות לפי חדרים ושכונות סמוכות.
// בלי שמות סוכנים, משרדים, לקוחות או כתובות, והפרומפט אוסר להמציא עובדות
// (מוסדות, תחבורה, אופי) שאינן בנתונים.
//
// אימות: cron (x-alert-cron-secret / service_role), או JWT של מנהל/ת פלטפורמה
// - הכפתור "יצירת טיוטות עכשיו" ב"SEO ושכונות". ‏verify_jwt = false
// (supabase/config.toml), ולכן הפונקציה מאמתת בעצמה. ‏docs/neighborhood-pages.md.
// ============================================================================

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("NEIGHBORHOOD_MODEL") || Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5-5";
const BATCH = 10;

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alert-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

const SYSTEM_PROMPT = `את/ה כותב/ת תוכן לדף שכונה באתר נדל"ן ישראלי. הקהל: מי ששוקל/ת לקנות או לשכור בשכונה.

כללים:
- כתוב/כתבי רק על סמך הנתונים שנמסרו. אל תמציא/י מוסדות, בתי ספר, תחבורה, פארקים, אופי חברתי או היסטוריה שאינם בנתונים.
- מספרים - רק כפי שהם בנתונים, ובמילים "חציון" ו"לפי עסקאות שדווחו" כשמדובר בעסקאות.
- בלי שמות של סוכנים, משרדים, אנשים או כתובות. בלי הבטחות ("השקעה בטוחה", "הזדמנות").
- עברית פשוטה, בגוף שלישי, בלי סימני קריאה. מקף רגיל (-) בלבד, לעולם לא מקף ארוך.
- intro: שתיים עד שלוש פסקאות קצרות (עד 120 מילה) שמתארות את השכונה מבחינת השוק: מה יש בה למכירה ולהשכרה, ומה טווח המחירים.
- fits: פסקה אחת (עד 60 מילה) - למי השכונה מתאימה לפי סוגי הנכסים והמחירים.
- faq: בדיוק 3 שאלות שאנשים שואלים על השכונה, עם תשובות קצרות מתוך הנתונים בלבד.`;

const SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "string" },
    fits: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: { q: { type: "string" }, a: { type: "string" } },
        required: ["q", "a"],
        additionalProperties: false,
      },
    },
  },
  required: ["intro", "fits", "faq"],
  additionalProperties: false,
};

// deno-lint-ignore no-explicit-any
function factsText(d: any): string {
  const lines = [
    `שכונה: ${d.name}`,
    `עיר: ${d.city}`,
    `נכסים פעילים באתר: ${d.props_active || 0} (${d.props_sale || 0} למכירה, ${d.props_rent || 0} להשכרה)`,
  ];
  if (d.sale_min) lines.push(`טווח מחירים מבוקש למכירה: ${d.sale_min} עד ${d.sale_max} ש"ח`);
  if (d.rent_min) lines.push(`טווח שכר דירה מבוקש: ${d.rent_min} עד ${d.rent_max} ש"ח לחודש`);
  // deno-lint-ignore no-explicit-any
  const types = [...new Set((d.props || []).map((p: any) => p.property_type).filter(Boolean))];
  if (types.length) lines.push(`סוגי נכסים במודעות: ${types.join(", ")}`);
  if (d.deals) {
    lines.push(`עסקאות למגורים שדווחו לרשות המסים (24 חודשים): ${d.deals}`);
    if (d.median_price) lines.push(`מחיר עסקה חציוני: ${d.median_price} ש"ח${d.median_ppsqm ? `, ${d.median_ppsqm} ש"ח למ"ר` : ""}`);
    // deno-lint-ignore no-explicit-any
    for (const r of d.by_rooms || []) {
      if (r.median_price) lines.push(`- ${r.rooms >= 6 ? "5.5+" : r.rooms <= 3 ? "עד 3" : r.rooms} חדרים: ${r.deals} עסקאות, חציון ${r.median_price} ש"ח`);
    }
  }
  // deno-lint-ignore no-explicit-any
  const sib = (d.siblings || []).map((s: any) => s.name).slice(0, 8);
  if (sib.length) lines.push(`שכונות נוספות בעיר: ${sib.join(", ")}`);
  return lines.join("\n");
}

async function authorize(req: Request): Promise<Response | null> {
  const internal = authorizeInternalCaller(req);
  if (internal.ok) return null;
  const auth = req.headers.get("Authorization") || "";
  if (auth) {
    const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data, error } = await authed.rpc("current_is_platform_admin");
    if (!error && data === true) return null;
    return json({ error: "forbidden" }, 403);
  }
  return json({ error: internal.error, detail: internal.detail }, internal.status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const denied = await authorize(req);
  if (denied) return denied;
  if (!ANTHROPIC_KEY) return json({ error: "anthropic_not_configured" }, 503);

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { data: cands, error } = await sb.rpc("neighborhood_describe_candidates", { p_limit: BATCH });
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const summary = { candidates: (cands || []).length, drafted: 0, failed: 0 };
  // deno-lint-ignore no-explicit-any
  for (const c of (cands || []) as any[]) {
    try {
      const { data: page, error: pErr } = await sb.rpc("neighborhood_page", { p_city: c.city_slug, p_slug: c.slug });
      if (pErr || !page) throw new Error(pErr?.message || "no_page");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          // ‏max_tokens כולל חשיבה (ראו marketing-copy.ts) - לא לקצץ
          max_tokens: 6000,
          system: SYSTEM_PROMPT,
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
          messages: [{ role: "user", content: `נתוני השכונה:\n${factsText(page)}` }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      logAiUsage(anthropicRow("neighborhood_describe", data?.model || MODEL, data?.usage));
      // deno-lint-ignore no-explicit-any
      const text = (data?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
      const out = JSON.parse(text);
      const clean = (s: unknown) => noLongDash(String(s ?? "")).trim();
      const faq = (Array.isArray(out.faq) ? out.faq : []).slice(0, 3)
        // deno-lint-ignore no-explicit-any
        .map((f: any) => ({ q: clean(f.q), a: clean(f.a) })).filter((f: { q: string; a: string }) => f.q && f.a);
      const intro = clean(out.intro);
      if (intro.length < 40) throw new Error("intro_too_short");
      const { error: insErr } = await sb.from("neighborhood_descriptions").insert({
        neighborhood_id: c.neighborhood_id, status: "draft", intro, fits: clean(out.fits) || null, faq,
        model: data?.model || MODEL, input_tokens: data?.usage?.input_tokens ?? null, output_tokens: data?.usage?.output_tokens ?? null,
      });
      if (insErr) throw new Error(insErr.message);
      summary.drafted++;
    } catch (e) {
      summary.failed++;
      console.error("neighborhood draft failed", c.city_slug, c.slug, (e as Error).message);
    }
  }
  return json({ ok: true, ...summary });
});
