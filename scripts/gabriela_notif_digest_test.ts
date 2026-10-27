// תקציר התראות: חלונות, הפחתה, והחזרה. בלי מסד ובלי וואטסאפ.
//   node --experimental-strip-types scripts/gabriela_notif_digest_test.ts

import { readFileSync } from "node:fs";
import {
  applyLessGate,
  digestWindowOpen,
  isLessKeptType,
  LESS_HOLD_DAYS,
  LESS_KEPT_TYPES,
  LESS_TITLE,
  minutesInTimeZone,
  parseLessButton,
  parseMoreButton,
  RESTORE_COMMAND,
  RESTORE_TITLE,
  topicBreak,
  topicLabel,
} from "../supabase/functions/notification-push/notif-digest.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : " - " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}

const sql = readFileSync(
  new URL("../supabase/migrations/20271027160000_gabriela_notif_digest.sql", import.meta.url),
  "utf8",
);
const prioritySql = readFileSync(
  new URL("../supabase/migrations/20270420090000_notification_push_priority.sql", import.meta.url),
  "utf8",
);

/** הנוסחה שב-notif_il_digest_open, מתוך גוף הפונקציה ולא עותק נפרד. */
function digestOpenFromSql(source: string, at: Date, radius: number | null): boolean {
  const start = source.indexOf("function public.notif_il_digest_open");
  const end = source.indexOf("comment on function public.notif_il_digest_open");
  const fn = source.slice(start, end);
  if (!fn.includes("at time zone 'Asia/Jerusalem'")) throw new Error("השעון אינו ישראל");
  if (!fn.includes("extract(hour from") || !fn.includes("extract(minute from")) {
    throw new Error("הדקה אינה נגזרת מהשעה ומהדקה");
  }
  const windows = [1, 2, 3].map((i) => {
    const m = fn.match(new RegExp(`notif_digest_window_${i}'\\),\\s*(\\d+)`));
    if (!m) throw new Error(`חלון ${i} חסר`);
    return Number(m[1]);
  });
  const clamp = fn.match(
    /abs\(clock\.minute - wins\.w\) <= greatest\(0, least\(coalesce\(p_window_minutes, (\d+)\), (\d+)\)\)/,
  );
  if (!clamp) throw new Error("תנאי החלון ב-SQL השתנה");
  const minute = minutesInTimeZone(at, "Asia/Jerusalem");
  const r = Math.max(0, Math.min(radius ?? Number(clamp[1]), Number(clamp[2])));
  return windows.some((w) => Math.abs(minute - w) <= r);
}

// 27.10.2026 אחרי שעון החורף (UTC+2). 08:30 = 06:30 UTC. 13:00 = 11:00. 17:30 = 15:30.
check("08:30 פתוח ב-SQL", digestOpenFromSql(sql, new Date("2026-10-27T06:30:00.000Z"), 15));
check("08:44 פתוח ב-SQL", digestOpenFromSql(sql, new Date("2026-10-27T06:44:00.000Z"), 15));
check("08:46 סגור ב-SQL", !digestOpenFromSql(sql, new Date("2026-10-27T06:46:00.000Z"), 15));
check("09:00 סגור ב-SQL", !digestOpenFromSql(sql, new Date("2026-10-27T07:00:00.000Z"), 15));
check("13:00 פתוח ב-SQL", digestOpenFromSql(sql, new Date("2026-10-27T11:00:00.000Z"), 15));
check("17:30 פתוח ב-SQL", digestOpenFromSql(sql, new Date("2026-10-27T15:30:00.000Z"), 15));
check("רדיוס 0 רק על הדקה", digestOpenFromSql(sql, new Date("2026-10-27T06:30:00.000Z"), 0)
  && !digestOpenFromSql(sql, new Date("2026-10-27T06:31:00.000Z"), 0));
check("רדיוס חסר הוא 15", digestOpenFromSql(sql, new Date("2026-10-27T06:44:00.000Z"), null)
  && !digestOpenFromSql(sql, new Date("2026-10-27T06:46:00.000Z"), null));
check("רדיוס נחתך ב-120", !digestOpenFromSql(sql, new Date("2026-10-27T04:00:00.000Z"), 500));

const tsOpen = digestWindowOpen(new Date("2026-10-27T06:30:00.000Z"), [510, 780, 1050], 15);
check("העותק ב-TS תואם את 08:30", tsOpen === digestOpenFromSql(sql, new Date("2026-10-27T06:30:00.000Z"), 15));

check("כפתור פחות", parseLessButton("nless:client_match") === "client_match");
check("כפתור החזרה", parseMoreButton("nmore:client_match") === "client_match");
check("כפתור זר", parseLessButton("scn:abc") === null && parseMoreButton("nless:client_match") === null);
check("כותרות עד 20", [...LESS_TITLE].length <= 20 && [...RESTORE_TITLE].length <= 20);
check("פקודת החזרה", RESTORE_COMMAND === "החזר התראות" && LESS_HOLD_DAYS === 30);
check("תווית בעברית", topicLabel("client_match") === "התאמות" && topicLabel("nope") === "עדכון");

const ordered = [
  { type: "new_lead", title: "ליד חדש", path: "/crm?goto=accLeads&lead=1" },
  { type: "client_match", title: "דירה ברחוב הרצל", path: "/crm?goto=accClients&client=2" },
  { type: "client_match", title: "עוד דירה", path: "/crm?goto=accClients&client=3" },
];
const labels = ordered.map((it, i) => topicBreak(i ? ordered[i - 1].type : null, it.type));
check("נושא בלי מיון", labels[0] === "לידים" && labels[1] === "התאמות" && labels[2] === null, labels);
check("הכותרת והקישור לא משתנים", ordered[0].title === "ליד חדש" && ordered[1].path.includes("client=2"));
check("בלי מקף ארוך בתווית", labels.every((g) => g == null || (!g.includes("\u2014") && !g.includes("\u2013"))));

const kept = ["new_lead", "agenda_reminder", "showcase_meeting", "client_match"];
check("דחוף לא יורד מחוץ לחלון", applyLessGate(kept, ["new_lead", "agenda_reminder", "client_match"], {
  digestOpen: false, lastSentAgoMin: null, windowRadiusMin: 15,
}).join(",") === "new_lead,agenda_reminder,showcase_meeting");
check("בחלון בלי שליחה קודמת הסוג נשאר", applyLessGate(["client_match"], ["client_match"], {
  digestOpen: true, lastSentAgoMin: null, windowRadiusMin: 15,
}).join(",") === "client_match");
check("בחלון אחרי שליחה הסוג ממתין", applyLessGate(["client_match", "new_lead"], ["client_match"], {
  digestOpen: true, lastSentAgoMin: 20, windowRadiusMin: 15,
}).join(",") === "new_lead");
check("חלון הבא מחזיר את הסוג", applyLessGate(["client_match"], ["client_match"], {
  digestOpen: true, lastSentAgoMin: 31, windowRadiusMin: 15,
}).join(",") === "client_match");
check("תזכורת נשמרת", isLessKeptType("agenda_reminder") && !isLessKeptType("client_match"));

const prioFn = prioritySql.slice(
  prioritySql.indexOf("function public.notification_push_priority_types"),
  prioritySql.indexOf("comment on function public.notification_push_priority_types"),
);
const prioList = [...prioFn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check("הדחוף ב-SQL הוא אותה רשימה", prioList.join(",") === [...LESS_KEPT_TYPES].slice().sort().join(",")
  || prioList.join(",") === LESS_KEPT_TYPES.join(","), prioList);

const agentsBlock = sql.slice(sql.indexOf("agents as ("), sql.indexOf("recent as ("));
check("פחות כאלה לא נמחק מהרשימה מראש", !agentsBlock.includes("not exists"));
check("הפחתה רק לשורה בתוקף", sql.includes("less.expires_at > now()"));
check("דחוף ועדיפות לא ברשימת ההפחתה", sql.includes("less.notif_type <> all"));
check("הפחתה אחרי ה-CASE", sql.includes("raw_types") && sql.includes("greatest(s.digest_win, 1) * 2"));
check("שקט נשאר על urgent", sql.includes("t = any(cfg.urgent)"));
check("hold_hours מה-cfg", sql.includes("make_interval(hours => (select hold_hours from cfg))"));
check("hold_hours לא נקרא שוב", sql.split("notif_131049_hold_hours").length === 3);
check("דגלים כבויים", sql.includes("('notif_digest_enabled', 0") && sql.includes("('notif_stop_131049', 0") && sql.includes("('notif_topic_group', 0"));
check("תקרה 4 רק עם הדגל", sql.includes("when cfg.digest_on = 1 then least(cfg.digest_cap, cfg.cap)"));
check("131049 לא שולח תבנית", sql.includes("cfg.stop_131049 = 1") && sql.includes("131049"));
check("החזרה לסוכן/ת", sql.includes("grant select, delete on table public.agent_notif_less to authenticated")
  && sql.includes("for delete") && sql.includes("current_agent_id()"));
check("anon סגור", sql.includes("revoke all on table public.agent_notif_less from public, anon"));
check("לא נוגעים במנעול ה-claim", !sql.includes("notification_push_claim"));

if (failed) {
  console.log(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log("\n✓ תקציר התראות: כל הבדיקות עברו");
