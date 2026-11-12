import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ============================================================================
// קליטת מלאי מודעות מיד2 וממדלן. הסורק שולח פעמיים ביום את מה שחי עכשיו
// בעיר, והמסד מעדכן, מסמן מה ירד, ופותח ליד רק למודעה חדשה אחרי סנכרון
// ראשון שקט. docs/listing-inventory.md
//
// האימות: header x-listing-intake-secret מול LISTING_INTAKE_SECRET.
// בלי הסוד כל בקשה נדחית (503). הסוד לא נכתב לקוד.
// verify_jwt = false: לסורק אין JWT של Supabase.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("LISTING_INTAKE_SECRET") ?? "";

const MAX_BODY = 1_000_000;
const MAX_ITEMS = 2000;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(aa.length, bb.length, 1);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0 && a.length > 0 && b.length > 0;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isSource(v: string): v is "yad2" | "madlan" {
  return v === "yad2" || v === "madlan";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("listing-inventory-intake: LISTING_INTAKE_SECRET is not set");
    return json({ error: "not_configured" }, 503);
  }
  const given = req.headers.get("x-listing-intake-secret") ?? "";
  if (!timingSafeEqual(given, SECRET)) return json({ error: "unauthorized" }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "payload_too_large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_payload" }, 400);
  }
  const rec = body as Record<string, unknown>;
  const source = typeof rec.source === "string" ? rec.source : "";
  const city = typeof rec.city === "string" ? rec.city.trim() : "";
  if (!isSource(source)) return json({ error: "invalid_source" }, 400);
  if (!city || city.length > 80) return json({ error: "missing_city" }, 400);
  if (!Array.isArray(rec.items)) return json({ error: "invalid_items" }, 400);
  if (rec.items.length > MAX_ITEMS) return json({ error: "too_many_items" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await sb.rpc("listing_inventory_sync", {
    p_source: source,
    p_city: city,
    p_items: rec.items,
  });
  if (error) {
    console.error("listing-inventory-intake rpc failed", error.message);
    return json({ error: "db_error" }, 500);
  }
  const result = data as { error?: unknown } | null;
  if (result && typeof result.error === "string") return json(result, 400);
  return json(result ?? {});
});
