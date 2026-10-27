// תקציר התראות: חלונות, קיבוץ, וכפתור. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_notif_digest_test.ts

import { readFileSync } from "node:fs";
import {
  LESS_TITLE,
  digestWindowOpen,
  parseLessButton,
  topicLabel,
  withTopicHeaders,
} from "../supabase/functions/notification-push/notif-digest.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

// 27.10.2026 אחרי שעון החורף (UTC+2). 08:30 = 06:30 UTC. 13:00 = 11:00. 17:30 = 15:30.
const windows = [510, 780, 1050];
check("08:30 פתוח", digestWindowOpen(new Date("2026-10-27T06:30:00.000Z"), windows, 15));
check("08:44 פתוח", digestWindowOpen(new Date("2026-10-27T06:44:00.000Z"), windows, 15));
check("09:00 סגור", !digestWindowOpen(new Date("2026-10-27T07:00:00.000Z"), windows, 15));
check("13:00 פתוח", digestWindowOpen(new Date("2026-10-27T11:00:00.000Z"), windows, 15));
check("17:30 פתוח", digestWindowOpen(new Date("2026-10-27T15:30:00.000Z"), windows, 15));
check("רדיוס 0 רק על הדקה", digestWindowOpen(new Date("2026-10-27T06:30:00.000Z"), windows, 0)
  && !digestWindowOpen(new Date("2026-10-27T06:31:00.000Z"), windows, 0));

check("כפתור פחות", parseLessButton("nless:client_match") === "client_match");
check("כפתור זר", parseLessButton("scn:abc") === null && parseLessButton("nless:Bad") === null);
check("כותרת עד 20", [...LESS_TITLE].length <= 20 && !LESS_TITLE.includes("\u2014"));
check("תווית בעברית", topicLabel("client_match") === "התאמות" && topicLabel("nope") === "עדכון");

const grouped = withTopicHeaders([
  { type: "new_lead", title: "ליד חדש" },
  { type: "client_match", title: "דירה ברחוב הרצל" },
  { type: "client_match", title: "עוד דירה" },
]);
check("קיבוץ לפי נושא", grouped[0].title.startsWith("התאמות:") && grouped[2].title === "לידים: ליד חדש", grouped.map((g) => g.title));
check("בלי מקף ארוך בקיבוץ", grouped.every((g) => !g.title.includes("\u2014") && !g.title.includes("\u2013")));

const sql = readFileSync(new URL("../supabase/migrations/20271027160000_gabriela_notif_digest.sql", import.meta.url), "utf8");
check("דגלים כבויים", sql.includes("('notif_digest_enabled', 0") && sql.includes("('notif_stop_131049', 0") && sql.includes("('notif_topic_group', 0"));
check("תקרה 4 רק עם הדגל", sql.includes("when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)"));
check("131049 לא שולח תבנית", sql.includes("cfg.stop_131049 = 1") && sql.includes("131049"));
check("פחות כאלה בטבלה", sql.includes("agent_notif_less") && sql.includes("revoke all on table public.agent_notif_less from public, anon, authenticated"));
check("לא נוגעים במנעול ה-claim", !sql.includes("notification_push_claim"));

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ תקציר התראות: כל הבדיקות עברו");
