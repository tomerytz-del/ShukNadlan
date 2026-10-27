/**
 * וואטסאפ על ליד נעול ל-free. הדגל כבוי, הנתיב מקביל, הכפתור לכרטיס.
 *
 *   node --experimental-strip-types scripts/free_locked_lead_test.ts
 */
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20271029110000_free_locked_lead_whatsapp.sql",
  "utf8",
);
const push = readFileSync("supabase/functions/notification-push/index.ts", "utf8");
const due = readFileSync(
  "supabase/migrations/20271028133000_gabriela_notif_digest.sql",
  "utf8",
);

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log("ok  " + name);
  else {
    failed++;
    console.log("FAIL " + name);
  }
}

check("הדגל כבוי", /free_locked_lead_whatsapp',\s*\n\s*0,/.test(sql));
check("רק free", sql.includes("m.tier = 'free'"));
check("רק ליד נעול", sql.includes("n.type = 'new_lead'") && sql.includes("ld.status is distinct from 'unlocked'"));
check("הכפתור לכרטיס", sql.includes("'/crm?goto=accLeads&lead=' || ld.id::text"));
check("תבנית אחת ב-24 שעות", sql.includes("l.channel_mode = 'template'") && sql.includes("interval '24 hours'"));
check("מחוץ לחלון ליד אחד", sql.includes("case when ag.in_window then 9 else 1 end"));
check("חותמת ולא היסטוריה", sql.includes("n.created_at > v_since") && sql.includes("coalesce(old.value, 0) is distinct from 1"));
check("שקט", sql.includes("agent_reminder_quiet_now("));
check("לא מחליף due_agents", !/create or replace function public\.notification_push_due_agents/.test(sql));
check("לא מחליף claim", !/create or replace function public\.notification_push_claim/.test(sql));
check(
  "לא מחליף את שלוש המוגנות",
  !/create or replace function public\.notify_agent_on_new_lead/.test(sql) &&
    !/create or replace function public\.notifications_apply_preferences/.test(sql),
);
check("ההחרגה ב-due_agents", /m\.tier in \('mid', 'premium'\)/.test(due));
check("קריאה מקבילית", push.includes('sb.rpc("free_locked_lead_claim"'));
check("RPC חסר לא מפיל", push.includes('code === "PGRST202"') && push.indexOf("free_locked_lead_claim") < push.indexOf("rows.length === 0"));
check("ליד נעול בלי כותרת הפרטים", push.includes("rich && !rich.masked ? LEAD_CTA : plan.label"));
check("הרשאות", sql.includes("revoke all on function public.free_locked_lead_claim(int) from public, anon, authenticated") && sql.includes("revoke all on table public.free_locked_lead_state from public, anon, authenticated"));

if (failed) {
  console.log("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall ok");
