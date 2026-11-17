/**
 * סיכום שיתופים: דגל כבוי, בלי לשלוח שוב מה שכבר יצא, בלי תבנית.
 *
 *   node --experimental-strip-types scripts/share_digest_test.ts
 */
import { readFileSync } from "node:fs";
import {
  isShareOnlyBatch,
  shareDigestBody,
  shareDigestItems,
  textBodyHead,
  textBodyItemLine,
} from "../supabase/functions/_shared/share-digest.ts";

const sql = readFileSync(
  "supabase/migrations/20271112121000_share_digest.sql",
  "utf8",
);
const wording = readFileSync(
  "supabase/migrations/20271117140000_share_digest_clear_copy.sql",
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

const build = sql.slice(
  sql.indexOf("function public.share_digest_build"),
  sql.indexOf("comment on function public.share_digest_build"),
);
const previewFn = sql.slice(
  sql.indexOf("function public.share_digest_preview"),
  sql.indexOf("comment on function public.share_digest_preview"),
);

check("הדגל דלוק", /share_digest_enabled', 1,/.test(sql));
check("12:30", /share_digest_hhmm', 1230,/.test(sql));
check("חלון חצי שעה", build.includes("v_delta >= 30"));
check("שש משבצות", build.includes("mod(pg_catalog.hashtext(ag.id::text)::bigint, 6)") && build.includes("v_delta < v_slot * 5"));
check("בלי יומן שליחה", sql.includes("n.id = any (l.notification_ids)") && sql.includes("not exists ("));
check("אחרי חותמת ההדלקה", build.includes("n.created_at > v_since") && previewFn.includes("s.enabled_at is not null") && !sql.includes("date_trunc"));
check("שיתוף בודד בפעמון", sql.includes("new.suppress_push := true") && sql.includes("new.title = 'נכס חדש שותף איתך'"));
check("לא מחליף את פונקציית השיתוף", !/create or replace function public\.share_property_for_agent/.test(sql));
check(
  "לא מחליף את שלוש המוגנות",
  !/create or replace function public\.notify_agent_on_new_lead/.test(sql) &&
    !/create or replace function public\.notifications_apply_preferences/.test(sql) &&
    !/create or replace function public\.notification_push_priority_types/.test(sql),
);
check("סוג חדש", sql.includes("notification_types_add(array['share_digest'])"));
check("בלי תבנית", !sql.includes("channel_mode") && !sql.includes("folded_log_id") && build.includes("or not ag.in_window"));
check("שישי עד 13:00", build.includes("notification_agent_send_quiet($1, $2, $3, $4, 1)") && build.includes("v_dow = 6"));
check("יום שישי לא שקט שלם", !build.includes("agent_reminder_quiet_now(ag.quiet_from, ag.quiet_to, ag.quiet_days)"));
check("שורות לפני ההכנסה", build.indexOf("jsonb_agg") < build.indexOf("insert into public.notifications"));
check("גוף סופי בהכנסה", build.includes("v_body") && build.includes("v_path") && build.includes("action_path"));
check("בלי מציין מקום", !build.includes("delete from public.notifications") && !/update public\.notifications/.test(build));
check("דחיפה מכבדת suppress_push", sql.includes("if coalesce(new.suppress_push, false) then"));
check("דחיפה לפי action_path", sql.includes("coalesce(btrim(new.action_path), '')"));
check("השומר מכסה", sql.includes("notification_push_priority_types") && sql.includes("notification_push_less_kept_types"));
check("free בלי וואטסאפ", sql.includes("ag.tier is distinct from 'mid' and ag.tier is distinct from 'premium'"));
check("תצוגה בלי טלפון", sql.includes("agent_first_name text") && !/phone/.test(previewFn));
check("קובץ יבש", preview.includes("select * from public.share_digest_preview()") && !/insert /i.test(preview));
const expandAt = push.indexOf("await expandShareDigest(sb");
const sendAt = push.indexOf("await sendWhatsapp(", expandAt);
check("נפתח לפני הקיפול", expandAt > 0 && expandAt < push.indexOf("arrange(expanded)"));
check(
  "כשל שורות לא שולח מציין מקום",
  push.includes("class ShareDigestLinesError") &&
    push.includes("share digest lines failed, retry next cycle") &&
    expandAt < sendAt &&
    push.indexOf("share digest lines failed, retry next cycle") < sendAt &&
    !push.includes("if (error || !Array.isArray(data) || data.length === 0) return items"),
);
check("בלי תבנית בשליחה", push.includes("share digest bell only, never a utility template"));
check("לא system", push.includes('it.type === "system"'));
check("הכול לשיתופים", links.includes('t === "share_digest"') && links.includes('"/crm?goto=accSharedWithMe"'));
check("textBody קורא את כותרת הסיכום", push.includes("textBodyHead(first, items)") && push.includes("isShareOnlyBatch(items)"));
check(
  "textBody בלי כתובת כש-noLinks",
  push.includes("textBodyItemLine(it, {") && push.includes("link: path && !noLinks ?"),
);

const describe = wording.slice(
  wording.indexOf("function public.share_digest_describe"),
  wording.indexOf("comment on function public.share_digest_describe"),
);
const buildNow = wording.slice(
  wording.indexOf("function public.share_digest_build"),
  wording.indexOf("comment on function public.share_digest_build"),
);
const previewNow = wording.slice(
  wording.indexOf("function public.share_digest_preview"),
  wording.indexOf("comment on function public.share_digest_preview"),
);
const linesNow = wording.slice(
  wording.indexOf("function public.share_digest_lines_for_log"),
  wording.indexOf("comment on function public.share_digest_lines_for_log"),
);
check("עמודות חדשות nullable", ["city text", "deal_type text", "rooms numeric", "neighborhood text"].every((col) => wording.includes("add column if not exists " + col)));
check("משפט אחד במסד", describe.includes("when 'sale' then 'למכירה'") && describe.includes("when 'rent' then 'להשכרה'") && describe.includes("'1 חדר'") && describe.includes("' חדרים'"));
check("בלי מחיר ריק במשפט", describe.includes("מחיר לא צוין") && describe.includes("then null"));
check("drop לפני שינוי חתימה", wording.indexOf("drop function if exists public.share_digest_lines_for_log(uuid)") < wording.indexOf("function public.share_digest_lines_for_log"));
check("היומן מחזיר את השדות בסוף", linesNow.includes("l.city, l.deal_type, l.rooms, l.neighborhood"));
check("הבנייה שומרת אותם", buildNow.includes("'city'") && buildNow.includes("'deal'") && buildNow.includes("'rooms'") && buildNow.includes("'neighborhood'") && buildNow.includes("neighborhoods nb"));
check("כותרת לפי מספר", buildNow.includes("when v_n = 1 then 'נכס חדש שותף איתך'") && buildNow.includes("נכסים חדשים שותפו איתך"));
check("בלי שם · סוג", !buildNow.includes("ptype || ' · '") && buildNow.includes("שותף ע\"י "));
check("שם פרטי בלבד", buildNow.includes("split_part(btrim(coalesce(sh.display_name, '')), ' ', 1)"));
check("בלי רחוב ומספר בית", !buildNow.includes("street") && !buildNow.includes("house_number") && !previewNow.includes("street") && !describe.includes("phone"));
check("תצוגה בלי טלפון", !/phone/.test(previewNow));
check("הרשאות לשלושת התפקידים", ["share_digest_describe(text, text, text, text, numeric, text)", "share_digest_lines_for_log(uuid)", "share_digest_preview()", "share_digest_build()"].every((sig) =>
  wording.includes("revoke all on function public." + sig + " from public, anon, authenticated") &&
  wording.includes("grant execute on function public." + sig + " to service_role"),
));

const lines = [
  { sharer_first_name: "דנה כהן", property_type: "דירה", price_label: "1,500,000 ₪", property_id: "11111111-1111-1111-1111-111111111111", city: "חיפה", deal_type: "sale", rooms: 3, neighborhood: "הדר" },
  { sharer_first_name: "דנה כהן", property_type: "פנטהאוז", price_label: "3,200,000 ₪", property_id: "22222222-2222-2222-2222-222222222222", city: "עפולה", deal_type: "rent", rooms: "4.0" },
  { sharer_first_name: "יוסי", property_type: "", price_label: "", property_id: "33333333-3333-3333-3333-333333333333" },
];
const body = shareDigestBody(lines);
check("משפט ולא שם · סוג", body.startsWith("דירה למכירה בחיפה (הדר), 3 חדרים, 1,500,000 ₪\nשותף ע\"י דנה"));
check("שם פרטי בלבד בגוף", body.includes("שותף ע\"י דנה") && !body.includes("כהן"));
check("שורה ישנה בלי העמודות", body.includes("נכס\nשותף ע\"י יוסי") && !body.includes("מחיר לא צוין"));
const items = shareDigestItems(lines);
check("שלושה כפתורים", items.length === 3 && items.every((it) => it.type === "share_digest"));
check("נתיב לנכס", items[0].action_path === "/crm?goto=accSharedWithMe&property=11111111-1111-1111-1111-111111111111");
check("בלי טלפון בפריט", !JSON.stringify(items).includes("05") && !JSON.stringify(items).includes("+972"));
check("בלי כתובת בפריט", !JSON.stringify(items).includes("http") && !JSON.stringify(items).includes("wa.me"));

const aviya = {
  sharer_first_name: "אביה",
  property_type: "גג/פנטהאוז",
  price_label: "4,650,000 ₪",
  property_id: "44444444-4444-4444-4444-444444444444",
  city: "עפולה",
  deal_type: "sale",
  rooms: 5,
  neighborhood: null,
};
const one = shareDigestItems([aviya]);
check("שיתוף אחד: המשפט", one[0].title === "גג/פנטהאוז למכירה בעפולה, 5 חדרים, 4,650,000 ₪" && one[0].body === "שותף ע\"י אביה");
check("textBody שיתוף אחד", textBodyHead("תומר לוי", one) === "תומר, נכס חדש שותף איתך:");
check(
  "textBody שורת שיתוף אחד",
  textBodyItemLine(one[0], { onlyShares: true, link: null }) ===
    "🏠 גג/פנטהאוז למכירה בעפולה, 5 חדרים, 4,650,000 ₪\n   שותף ע\"י אביה",
);

const two = shareDigestItems([
  aviya,
  { ...aviya, property_id: "55555555-5555-5555-5555-555555555555", property_type: "דירה", rooms: 3, price_label: "1,200,000 ₪", sharer_first_name: "יוסי" },
]);
check("textBody כמה שיתופים", textBodyHead("תומר", two) === "תומר, 2 נכסים חדשים שותפו איתך:" && isShareOnlyBatch(two));
check("שתי שורות בית", two.map((it) => textBodyItemLine(it, { onlyShares: true, link: null })).every((line) => line.startsWith("🏠 ") && line.includes("\n   שותף ע\"י ")));

const mixed = [
  { type: "new_lead", title: "ליד חדש", body: "דירה בחיפה" },
  one[0],
];
check("textBody אצווה מעורבת", textBodyHead("תומר", mixed) === "תומר, מה שחדש אצלך:");
check(
  "textBody שיתוף בתוך אצווה",
  textBodyItemLine(one[0], { onlyShares: false, link: null }) ===
    "🔔 נכס ששותף איתך: גג/פנטהאוז למכירה בעפולה, 5 חדרים, 4,650,000 ₪ (שותף ע\"י אביה)",
);
check("הליד נשאר שורה רגילה", textBodyItemLine(mixed[0], { onlyShares: false, link: null }) === "🔔 ליד חדש\n   דירה בחיפה");

const sparse = shareDigestItems([{
  sharer_first_name: "אביה",
  property_type: "גג/פנטהאוז",
  price_label: "4,650,000 ₪",
  property_id: aviya.property_id,
  deal_type: "sale",
}]);
check("בלי עיר ובלי חדרים", sparse[0].title === "גג/פנטהאוז למכירה, 4,650,000 ₪" && !sparse[0].title.includes("חדר") && !sparse[0].title.includes("ב"));

const legacy = shareDigestItems([{
  sharer_first_name: "אביה",
  property_type: "גג/פנטהאוז",
  price_label: "4,650,000 ₪",
  property_id: aviya.property_id,
}]);
check("שורה ישנה בלי השדות החדשים", legacy[0].title === "גג/פנטהאוז, 4,650,000 ₪" && legacy[0].body === "שותף ע\"י אביה");

const hood = shareDigestItems([{ ...aviya, neighborhood: "גבעת המורה" }]);
check("שכונה בסוגריים", hood[0].title === "גג/פנטהאוז למכירה בעפולה (גבעת המורה), 5 חדרים, 4,650,000 ₪");
const same = shareDigestItems([{ ...aviya, neighborhood: "עפולה" }]);
check("שכונה זהה לעיר יורדת", same[0].title === "גג/פנטהאוז למכירה בעפולה, 5 חדרים, 4,650,000 ₪");
const oneRoom = shareDigestItems([{ ...aviya, rooms: "1.0", price_label: "מחיר לא צוין", city: "", neighborhood: "גבעת המורה" }]);
check("חדר אחד ובלי מחיר", oneRoom[0].title === "גג/פנטהאוז למכירה בגבעת המורה, 1 חדר");
const half = shareDigestItems([{ ...aviya, rooms: "3.5", city: null }]);
check("חצי חדר", half[0].title.startsWith("גג/פנטהאוז למכירה, 3.5 חדרים"));
check("בלי שם", textBodyHead("", one) === "נכס חדש שותף איתך:");
check("תזכורת נשארת תזכורת", textBodyHead("תומר", [{ type: "agenda_reminder" }]) === "תומר, תזכורת מהיומן:");
check(
  "noLinks בלי כתובת",
  !textBodyItemLine(one[0], { onlyShares: true, link: null }).includes("http") &&
    textBodyItemLine(one[0], { onlyShares: true, link: "https://shuknadlan.co.il/crm?goto=accSharedWithMe" }).includes("https://"),
);

if (failed) {
  console.log("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall ok");
