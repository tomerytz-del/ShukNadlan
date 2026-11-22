// סדר משבצות, 131049 מ-delivery_detail, ותקציר. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/wa_agent_notify_priority_test.ts

import { readFileSync } from "node:fs";
import {
  digestSummary,
  logHit131049,
  planTemplateSlots,
  templateTier,
  templatesHeld,
  TIER1_TYPES,
} from "../supabase/functions/notification-push/template-priority.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const item = (type: string) => ({ type, id: type });

check("שורה 1", TIER1_TYPES.every((type) => templateTier(type) === 1));
check("ביקוש פתוח הוא שורה 2", templateTier("open_demand") === 2);
check("סיכום הוא שורה 3", templateTier("match_digest") === 3 && templateTier("share_digest") === 3);

const mixed = planTemplateSlots(
  [item("match_digest"), item("open_demand"), item("new_lead"), item("ops_alert")],
  { template: true, reclaim: false },
);
check("שורה 1 קודם, והשאר נדחים", mixed.send.map((it) => it.type).sort().join(",") === "new_lead,ops_alert"
  && mixed.defer.map((it) => it.type).sort().join(",") === "match_digest,open_demand"
  && mixed.digest === false, mixed);

const demandFirst = planTemplateSlots(
  [item("match_digest"), item("open_demand"), item("share_digest")],
  { template: true, reclaim: false },
);
check("ביקוש פתוח קודם לסיכום", demandFirst.send.map((it) => it.type).join(",") === "open_demand"
  && demandFirst.defer.map((it) => it.type).sort().join(",") === "match_digest,share_digest");

const onlySummary = planTemplateSlots([item("match_digest")], { template: true, reclaim: false });
check("סיכום לבד יוצא כשאין שורה גבוהה", onlySummary.send.length === 1 && onlySummary.defer.length === 0
  && onlySummary.digest === false);

const summaries = planTemplateSlots(
  [item("match_digest"), item("share_digest")],
  { template: true, reclaim: false },
);
check("כמה סיכומים נארזים לתקציר", summaries.digest && summaries.defer.length === 0
  && summaries.send.length === 2);

const reclaim = planTemplateSlots(
  [item("open_demand"), item("match_digest")],
  { template: true, reclaim: true },
);
check("תקציר של מה שכבר נעצר לא מתפצל שוב", reclaim.defer.length === 0 && reclaim.digest
  && reclaim.send.length === 2);

const inWindow = planTemplateSlots(
  [item("new_lead"), item("match_digest")],
  { template: false, reclaim: false },
);
check("בתוך החלון אין משבצת תבנית", inWindow.send.length === 2 && inWindow.defer.length === 0);

const urgent = planTemplateSlots(
  [item("agenda_reminder"), item("showcase_meeting"), item("open_demand")],
  { template: true, reclaim: false },
);
check("תזכורת וסיור לא נדחים לתקציר", urgent.send.length === 2 && urgent.defer.length === 1
  && urgent.defer[0].type === "open_demand" && urgent.digest === false);

const kept = planTemplateSlots(
  [item("new_lead"), item("security_alert"), item("match_digest")],
  { template: true, reclaim: false },
);
check("התראת אבטחה נשארת עם הליד", kept.send.map((it) => it.type).sort().join(",") === "new_lead,security_alert"
  && kept.defer.map((it) => it.type).join(",") === "match_digest");

const detail = "131049 · This message was not delivered to maintain healthy ecosystem engagement.";
check("131049 מ-delivery_detail", logHit131049("", detail) && logHit131049(null, detail));
check("131049 מ-last_error", logHit131049("whatsapp 400: (#131049) healthy", ""));
check("בלי 131049", !logHit131049("template_cap", "") && !logHit131049("sent", "131050 opted out"));

check("חסימה מחוץ לחלון", templatesHeld({ stopOn: true, hit: true, inWindow: false }));
check("חלון פתוח הוא טקסט", !templatesHeld({ stopOn: true, hit: true, inWindow: true }));
check("הדגל כבוי לא עוצר", !templatesHeld({ stopOn: false, hit: true, inWindow: false }));

const text = digestSummary([
  item("open_demand"), item("open_demand"),
  item("match_digest"),
  item("share_digest"),
  item("new_lead"),
]);
check("נוסח תקציר", text === "יש לך 2 ביקושים פתוחים, סיכום התאמות אחד ועדכון אחד. הפרטים בפעמון.", text);
check("בלי כתובת ובלי טלפון", !/https?:\/\//.test(text) && !/(?:\+972|972|0\d{8,})/.test(text)
  && !text.includes("\u2014") && !text.includes("\u2013"));
check("שורה 1 לא נספרת בתקציר", !text.includes("ליד") && digestSummary([item("new_lead")]).startsWith("יש עדכונים"));
check("ביקוש אחד", digestSummary([item("open_demand")]) === "יש לך ביקוש פתוח אחד. הפרטים בפעמון.");

const sql = readFileSync(
  new URL("../supabase/migrations/20271130100000_wa_agent_notify_priority.sql", import.meta.url),
  "utf8",
);
const push = readFileSync(
  new URL("../supabase/functions/notification-push/index.ts", import.meta.url),
  "utf8",
);
check("המיגרציה קוראת גם ל-delivery_detail", sql.includes("notification_log_hit_131049(l.last_error, l.delivery_detail)")
  && sql.includes("position('131049' in coalesce(p_detail, '')) > 0")
  && sql.includes("position('131049' in coalesce(p_error, '')) > 0"));
check("מחוץ לחלון אין תבנית", /coalesce\(r\.hit_131049, false\)[\s\S]{0,400}then '\{\}'::text\[\]/.test(sql));
check("הדגלים נדלקים", sql.includes("('notif_digest_enabled', 1,") && sql.includes("('notif_stop_131049', 1,"));
check("השבת ותקרת התבניות לא נערכות", (sql.match(/notif_send_window_friday_enabled/g) || []).length === 1
  && !sql.includes("whatsapp_template_cap_daily")
  && !sql.includes("whatsapp_template_cap_hard_max")
  && !sql.includes("whatsapp_template_cap_gap_hours"));
check("אין מחיקה", !/\bdelete\s+from\b/i.test(sql));
check("השליחה מפצלת לפי השורה", push.includes("planTemplateSlots") && push.includes("digestSummary")
  && push.includes('action_path: "/crm?goto=bell"'));
check("שקט השבת נשאר בגוף", sql.includes("notification_agent_send_quiet"));

if (failed) {
  console.error(`נכשלו ${failed}`);
  process.exit(1);
}
console.log("עבר");
