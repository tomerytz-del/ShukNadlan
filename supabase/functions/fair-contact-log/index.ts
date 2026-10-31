import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleFairContact, type FairContactArgs } from "../_shared/fair-contact.ts";

// לחיצה על וואטסאפ או על חיוג בנכס ביריד. ציבורית: הגולש אינו מחובר.
// verify_jwt = false. ההגנה מהצפה ב-fair_contact_click (תקרה לפי IP,
// כפילות של אותו דפדפן). אין כאן ליד ואין התראה. המלח של ה-IP בסוד
// FAIR_CONTACT_IP_SALT, לא בקוד שנשלח לדפדפן.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve((req) => {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handleFairContact(req, {
    salt: Deno.env.get("FAIR_CONTACT_IP_SALT") || "",
    call: async (args: FairContactArgs) => {
      const { data, error } = await supabase.rpc("fair_contact_click", args);
      return {
        data: data && typeof data === "object" ? data as Record<string, unknown> : null,
        error: error ? { message: error.message } : null,
      };
    },
  });
});
