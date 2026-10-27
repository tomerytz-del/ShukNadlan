/**
 * סיכום שיתופים: דגל כבוי, בלי לשלוח שוב מה שכבר יצא, בלי תבנית שנייה.
 *
 *   node --experimental-strip-types scripts/share_digest_test.ts
 */
import { readFileSync } from "node:fs";
import { shareDigestBody, shareDigestItems } from "../supabase/functions/_shared/share-digest.ts";

const sql = readFileSync(
  "supabase/migrations/20271029120000_share_digest.sql",
  "utf8",
);
const push = readFileSync("supabase/functions/notification-push/index.ts", "utf8");
const preview = readFileSync("scripts/share_digest_preview.sql", "utf8");
const links = readFileSync("supabase/functions/_shared/agent-deep-link.ts", "utf8");

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log("ok  " + name);
  else {
    failed++;
    console.log("FAIL " + name);
  }
}

check("הדגל כבוי", /share_digest_enabled', 0,/.test(sql));
check("12:30", /share_digest_hhmm', 1230,/.test(sql));
check("חלון עשר דקות", sql.includes("v_delta >= 10"));
check("בלי יומן שליחה", sql.includes("n.id = any (l.notification_ids)") && sql.includes("not exists ("));
check("אחרי הסיכום הקודם", sql.includes("n.created_at > greatest("));
check("שיתוף בודד בפעמון", sql.includes("new.suppress_push := true") && sql.includes("new.title = 'נכס חדש שותף איתך'"));
check("לא מחליף את פונקציית השיתוף", !/create or replace function public\.share_property_for_agent/.test(sql));
check(
  "לא מחליף את שלוש המוגנות",
  !/create or replace function public\.notify_agent_on_new_lead/.test(sql) &&
    !/create or replace function public\.notifications_apply_preferences/.test(sql),
);
check("סוג חדש", sql.includes("notification_types_add(array['share_digest'])"));
check("תבנית אחת", sql.includes("l.channel_mode = 'template'") && sql.includes("not ag.in_window and v_tpl"));
check("תצוגה בלי טלפון", sql.includes("agent_first_name text") && !/phone/.test(
  sql.slice(sql.indexOf("function public.share_digest_preview"), sql.indexOf("comment on function public.share_digest_preview")),
));
check("קובץ יבש", preview.includes("select * from public.share_digest_preview()") && !/insert /i.test(preview));
check("נפתח לפני הקיפול", push.includes("expandShareDigest") && push.indexOf("expandShareDigest(sb") < push.indexOf("arrange(expanded)"));
check("לא system", push.includes('it.type === "system"'));
check("הכול לשיתופים", links.includes('t === "share_digest"') && links.includes('"/crm?goto=accSharedWithMe"'));

const lines = [
  { sharer_first_name: "דנה כהן", property_type: "דירה", price_label: "1,500,000 ₪", property_id: "11111111-1111-1111-1111-111111111111" },
  { sharer_first_name: "דנה כהן", property_type: "פנטהאוז", price_label: "3,200,000 ₪", property_id: "22222222-2222-2222-2222-222222222222" },
  { sharer_first_name: "יוסי", property_type: "", price_label: "", property_id: "33333333-3333-3333-3333-333333333333" },
];
const body = shareDigestBody(lines);
check("מקבץ לפי שם פרטי", body.startsWith("דנה כהן\nדירה · 1,500,000 ₪\nפנטהאוז · 3,200,000 ₪"));
check("שם שני", body.includes("יוסי\nנכס · מחיר לא צוין"));
check("בלי שם מלא בקבוצה השנייה", !body.includes("כהן\nנכס"));
const items = shareDigestItems(lines);
check("שלושה כפתורים", items.length === 3 && items.every((it) => it.type === "share_digest"));
check("נתיב לנכס", items[0].action_path === "/crm?goto=accSharedWithMe&property=11111111-1111-1111-1111-111111111111");
check("בלי טלפון בפריט", !JSON.stringify(items).includes("05") && !JSON.stringify(items).includes("+972"));

if (failed) {
  console.log("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall ok");
