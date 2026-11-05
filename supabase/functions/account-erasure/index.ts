import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authorizeInternalCaller } from "../_shared/cron-auth.ts";
import { eraseAgent } from "../_shared/account-erasure.ts";

// ============================================================================
// הריצה היומית של מחיקת החשבונות (pg_cron ‏account-erasure-sweep, ‏3:55)
//
// מנוי חודשי בתשלום שביקש/ה למחוק את החשבון נסגר/ת בסוף התקופה ששולמה,
// בריצה execute_scheduled_account_closures (‏3:40). הסגירה הזו היא SQL, ולכן
// היא אינה יכולה למחוק את המשתמש ב-Auth או לשחרר מספר ב-Twilio. כאן נאספים
// כל מי שנסגר/ה ביוזמתו/ה ועוד לא נמחק/ה, ומושלמת המחיקה.
// ============================================================================

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const auth = authorizeInternalCaller(req);
  if (!auth.ok) return json({ error: auth.error, detail: auth.detail }, auth.status);

  const { data: pending, error } = await supabase.rpc("accounts_pending_erasure", { p_limit: 50 });
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const row of (pending || []) as Array<{ agent_id: string }>) {
    const r = await eraseAgent(supabase, row.agent_id);
    results.push({ agent_id: row.agent_id, ...r });
  }
  return json({ erased: results.filter((r) => r.success).length, results });
});
