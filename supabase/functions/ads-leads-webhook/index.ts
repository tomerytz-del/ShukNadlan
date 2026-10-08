import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { MetaClient } from "../_shared/meta-graph.ts";
import { LEAD_FIELDS, leadgenIds, pageToken, routeLead, signatureValid, storeLead, timingSafeEqual } from "../_shared/meta-leads.ts";

// ============================================================================
// ads-leads-webhook — מטא מודיעה על ליד חדש מטופס מיידי (שלב 4,
// docs/marketing-console.md)
//
// ‏GET  ‏hub.mode=subscribe — אימות המנוי מול META_WEBHOOK_VERIFY_TOKEN.
// ‏POST ‏leadgen — חתימת X-Hub-Signature-256 (HMAC-SHA256 של הגוף הגולמי עם
//       ‏META_APP_SECRET), ואז לכל leadgen_id: שליפת הליד מ-Graph, שמירה
//       ב-ads_leads, ושליחה למסלול (‏_shared/meta-leads.ts).
//
// ‏verify_jwt = false: מטא אינה שולחת JWT. האימות הוא החתימה, והיא
// ‏fail-closed - בלי META_APP_SECRET כל POST נדחה ב-503, כי webhook שמקבל
// כל גוף בלי לבדוק הוא נקודה שכל אחד יכול לייצר בה לידים.
//
// ‏**תמיד 200 על POST חתום**, גם כשליד בודד נכשל: מטא מנסה שוב על כל תשובה
// אחרת, ושוב, ובסוף משביתה את המנוי. ליד שנכשל נשאר failed ב-ads_leads,
// והסנכרון השעתי (ads-admin, sync_leads) מנסה אותו שוב.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";
const ADS_TOKEN = Deno.env.get("META_ADS_ACCESS_TOKEN") || "";
const PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID") || "";
const PAGE_TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && VERIFY_TOKEN && timingSafeEqual(token, VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  if (!APP_SECRET) {
    console.error("ads-leads-webhook: META_APP_SECRET אינו מוגדר - כל POST נדחה");
    return new Response("not_configured", { status: 503 });
  }

  const raw = await req.text();
  if (!(await signatureValid(raw, req.headers.get("x-hub-signature-256"), APP_SECRET))) {
    return new Response("bad_signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const ids = leadgenIds(payload);
  if (!ids.length) return new Response("ok", { status: 200 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const token = await pageToken(ADS_TOKEN, PAGE_ID, PAGE_TOKEN || ADS_TOKEN);
  if (!token) {
    console.error("ads-leads-webhook: אין טוקן לשליפת לידים (META_ADS_ACCESS_TOKEN / FACEBOOK_PAGE_ACCESS_TOKEN)");
    return new Response("ok", { status: 200 });
  }
  const meta = new MetaClient(token, APP_SECRET);

  for (const id of ids) {
    try {
      const lead = await meta.get(id, { fields: LEAD_FIELDS });
      await storeLead(sb, lead, "webhook");
      const r = await routeLead(sb, { supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY }, String(lead.id));
      if (r.error) console.warn("ads-leads-webhook: ליד", id, r.status, r.error);
    } catch (e) {
      // הליד לא נשמר - הסנכרון השעתי ימשוך אותו לפי הטופס.
      console.error("ads-leads-webhook: שליפת ליד נכשלה", id, (e as Error).message);
    }
  }
  return new Response("ok", { status: 200 });
});
