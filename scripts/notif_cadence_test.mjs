/**
 * כפתור התאמת קצב ההתראות. הדגל כבוי.
 *
 *     node scripts/notif_cadence_test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import {
  CADENCE_BACK_TITLE,
  CADENCE_BUTTON_TITLE,
  CADENCE_DONE_TITLE,
  CADENCE_LIST_BUTTON,
  CADENCE_MORE_TITLE,
  CADENCE_OFF_AFTER,
  CADENCE_OFF_CONFIRM_TITLE,
  CADENCE_PATH,
  CADENCE_SAVED_CTA,
  CADENCE_TYPE_BUTTON,
  CADENCE_TYPES,
  CADENCE_TYPES_BODY,
  cadenceFocus,
  cadenceOpenId,
  cadenceOptionRows,
  digestChannel,
  digestIntro,
  digestIntroFor,
  digestSlot,
  effectiveCadence,
  hasCalendarDate,
  offAfterText,
  orderCadenceTypes,
  parseCadenceTap,
  typeConfirmLine,
  typeListRows,
  utf16len,
} from "../supabase/functions/_shared/notif-cadence.ts";
import {
  CLAIM_TITLE,
  DEMAND_FORBIDDEN,
  claimRows,
  directPostUrl,
  excludeSocialBuyer,
  hasCalendarDate as demandHasDate,
  openDemandBrief,
} from "../supabase/functions/_shared/open-demand-brief.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20271029310000_notif_cadence_button.sql"),
  "utf8",
);
const push = readFileSync(join(root, "supabase/functions/notification-push/index.ts"), "utf8");
const hook = readFileSync(join(root, "supabase/functions/whatsapp-webhook/index.ts"), "utf8");
const setup = readFileSync(join(root, "docs/whatsapp-setup.md"), "utf8");

test("כותרות הכפתור והשורות בתוך המגבלה, ומזהים ייחודיים", () => {
  assert.ok(utf16len(CADENCE_BUTTON_TITLE) <= 20);
  assert.ok(utf16len(CADENCE_OFF_CONFIRM_TITLE) <= 20, CADENCE_OFF_CONFIRM_TITLE);
  assert.ok(utf16len(CADENCE_BACK_TITLE) <= 20, CADENCE_BACK_TITLE);
  assert.ok(utf16len(CADENCE_MORE_TITLE) <= 20, CADENCE_MORE_TITLE);
  assert.ok(utf16len(CADENCE_DONE_TITLE) <= 20, CADENCE_DONE_TITLE);
  assert.ok(utf16len(CADENCE_SAVED_CTA) <= 20);
  assert.ok(utf16len(CADENCE_TYPE_BUTTON) <= 20);
  assert.ok(utf16len(CADENCE_LIST_BUTTON) <= 20);
  assert.equal(hasCalendarDate(CADENCE_OFF_AFTER), false);
  assert.equal(hasCalendarDate(CADENCE_TYPES_BODY), false);
  assert.equal(CADENCE_TYPES.length, 10);
  const ids = new Set();
  for (const row of typeListRows("agenda_reminder", { new_lead: "daily" }, ["system"])) {
    assert.ok(utf16len(row.title) <= 24, row.title);
    assert.ok(utf16len(row.description) <= 72, row.description);
    assert.ok(!ids.has(row.id));
    ids.add(row.id);
    assert.equal(hasCalendarDate(row.title + row.description), false);
  }
  assert.equal(ids.size, 10);
  assert.equal(orderCadenceTypes("agenda_reminder")[0].id, "agenda_reminder");
  assert.match(typeListRows(null, { new_lead: "daily" }, [])[0].description, /פעם ביום/);
  assert.match(typeListRows(null, {}, ["system"])[3].description, /ללא/);
  const agenda = cadenceOptionRows("agenda_reminder", 9, [9, 13, 17]);
  assert.deepEqual(agenda.map((row) => row.choice), ["each", "off"]);
  const leads = cadenceOptionRows("new_lead", 9, [9, 13, 17]);
  assert.deepEqual(leads.map((row) => row.choice), ["each", "daily", "thrice", "off"]);
  for (const row of [...agenda, ...leads]) {
    assert.ok(utf16len(row.title) <= 24, row.title);
    assert.ok(utf16len(row.description) <= 72, `${row.description} (${utf16len(row.description)})`);
    assert.equal(hasCalendarDate(row.title + row.description), false);
  }
  assert.equal(new Set(leads.map((row) => row.id)).size, 4);
  assert.match(CADENCE_PATH, /focus=lead_wa/);
  assert.match(cadenceFocus("match_digest"), /focus=cadence_match_digest/);
  assert.equal(cadenceOpenId("new_lead"), "ncad:open:new_lead");
  assert.equal(parseCadenceTap("ncad:open:new_lead")?.kind, "open");
  assert.equal(agenda.some((row) => row.id.endsWith(":day")), false);
  assert.equal(parseCadenceTap("ncad:c:agenda_reminder:off")?.kind, "choice");
  assert.equal(parseCadenceTap("ncad:yes:system")?.type, "system");
  assert.equal(parseCadenceTap("ncad:more")?.kind, "types");
  assert.equal(effectiveCadence({}, ["new_lead"], "new_lead"), "off");
  assert.equal(effectiveCadence({}, [], "new_lead"), "each");
  assert.equal(effectiveCadence({ agenda_reminder: "daily" }, [], "agenda_reminder"), "each");
});

test("אישור קצר, בלי תאריך, וחלון הסיכום", () => {
  for (const choice of ["each", "daily", "thrice", "off"]) {
    const line = typeConfirmLine("new_lead", choice, true, 9, [9, 13, 17]);
    assert.equal(hasCalendarDate(line), false, line);
    assert.ok(line.length < 220, line);
  }
  assert.equal(hasCalendarDate(digestIntro(0, 9)), false);
  assert.match(digestIntro(0, 9), /יום ראשון ב-9:00/);
  assert.match(digestIntroFor("match_digest", 0, 9), /התאמות/);
  assert.match(offAfterText("new_lead"), /לשאול אותי/);
  assert.match(offAfterText("open_demand"), /ביקוש הפתוח/);
  assert.doesNotMatch(offAfterText("agenda_reminder"), /לשאול/);
  assert.equal(hasCalendarDate(offAfterText("open_demand")), false);

  const win = 15;
  const sunMorning = new Date("2026-07-12T06:05:00Z");
  const slot = digestSlot(sunMorning, "thrice", 9, [9, 13, 17], win);
  assert.equal(slot && slot.hour, 9);
  assert.equal(slot && slot.dow, 0);
  assert.equal(digestSlot(new Date("2026-07-12T06:20:00Z"), "daily", 9, [9, 13, 17], win), null);
  assert.equal(digestSlot(new Date("2026-07-17T10:00:00Z"), "thrice", 9, [9, 13, 17], win), null);
  assert.ok(digestSlot(new Date("2026-07-17T06:00:00Z"), "thrice", 9, [9, 13, 17], win));
  assert.equal(digestSlot(new Date("2026-07-18T06:00:00Z"), "thrice", 9, [9, 13, 17], win), null);
  assert.equal(digestSlot(new Date("2026-01-18T07:00:00Z"), "daily", 9, [9, 13, 17], win)?.dow, 0);

  assert.equal(digestChannel(true, "cap", false), "text");
  assert.equal(digestChannel(false, "cap", false), "bell");
  assert.equal(digestChannel(false, "cap", true), "template");
  assert.equal(digestChannel(false, "bell", true), "bell");
  assert.equal(digestChannel(false, "send", false), "bell");
  assert.equal(digestChannel(false, "send", true, 1), "template");
  assert.equal(digestChannel(true, "send", false, 3), "text");
  assert.equal(digestChannel(false, "cap", true, 3), "bell");
  assert.equal(digestChannel(false, "send", true, 3), "bell");
});

test("הדגל כבוי, האכיפה ב-claim, ובלי לגעת ביצירת הליד", () => {
  assert.match(migration, /'notif_cadence_button_enabled', 'false'/);
  assert.match(migration, /notif_lead_digest_outside', 'cap'/);
  assert.match(migration, /notification_push_lead_wa_sendable/);
  assert.match(migration, /whatsapp_cadence jsonb/);
  assert.doesNotMatch(migration, /lead_wa_cadence/);
  assert.match(migration, /p_type = 'client_match'/);
  assert.match(migration, /agent_type_cadence\(p_agent, 'match_digest'\)/);
  assert.match(migration, /whatsapp_template_cap_decide\(v_count, v_hours, false/);
  assert.match(migration, /digest_ordinal/);
  assert.match(migration, /coalesce\(v_ordinal, 1\) >= 3/);
  assert.match(migration, /p_except uuid default null/);
  assert.match(migration, /notif_cadence_pending/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /open_demand_rows\(public\.current_agent_id\(\)\)/);
  assert.match(migration, /open_demand_rows\(p_agent\)/);
  assert.match(migration, /open_demand_claim_core\(public\.current_agent_id\(\)/);
  assert.match(migration, /open_demand_claim_core\(p_agent, p_id\)/);
  assert.match(migration, /open_demand_stats_core/);
  assert.match(migration, /revoke all on function public\.open_demand_list_for_agent/);
  assert.match(migration, /revoke all on function public\.open_demand_claim_for_agent/);
  assert.match(migration, /notify_agent_on_new_lead/);
  assert.doesNotMatch(migration, /create or replace function public\.notify_agent_on_new_lead/);
  assert.doesNotMatch(migration, /create or replace function public\.notifications_apply_preferences/);
  assert.doesNotMatch(migration, /create or replace function public\.social_lead/);
  assert.match(push, /notification_push_prepare_lead_cadence/);
  assert.match(push, /lead_wa_digest_cap_allows/);
  assert.match(push, /template_cap/);
  assert.match(push, /p_except: row\.log_id/);
  assert.match(push, /cadenceOpenId/);
  assert.match(hook, /cadenceIdFromMessage/);
  assert.match(hook, /p_type: type/);
  assert.match(hook, /ncad:yes:/);
  const settings = readFileSync(join(root, "assets/crm-settings.js"), "utf8");
  assert.match(settings, /npCadence-/);
  assert.match(settings, /whatsapp_cadence/);
  assert.doesNotMatch(settings, /lead_wa_cadence/);
  assert.match(setup, /התאמת קצב התראות/);
  assert.match(setup, /לא מגישים/);
});

test("ביקוש פתוח בלי פרטי קשר ובלי תאריך", () => {
  const agent = readFileSync(join(root, "supabase/functions/whatsapp-webhook/agent.ts"), "utf8");
  const tool = agent.slice(agent.indexOf("async function toolOpenDemandLeads"), agent.indexOf("async function toolListLeads"));
  assert.match(tool, /tier === "free"/);
  assert.match(tool, /open_demand_list_for_agent/);
  assert.match(tool, /open_demand_stats_for_agent/);
  assert.match(tool, /social_buyer_open_demand_enabled/);
  assert.match(tool, /excludeSocialBuyer/);
  assert.doesNotMatch(tool, /post_url|display_phone|raw_name|email/);
  assert.equal(excludeSocialBuyer(false, "seeker_inbound", "facebook_dm"), false);
  assert.equal(excludeSocialBuyer(true, "seeker_inbound", "facebook_dm"), true);
  assert.equal(excludeSocialBuyer(true, "seeker_inbound", "facebook_group"), false);
  assert.equal(excludeSocialBuyer(true, "owner_inbound", "facebook_dm"), false);
  const claims = claimRows([
    { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", summary: "מחפש/ת לקנות דירה · עפולה", locked: false },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", summary: "מחפש/ת לקנות דירה · עפולה", locked: false },
    { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", summary: "מוכר/ת דירה", locked: true },
  ]);
  assert.equal(claims.length, 2);
  assert.equal(new Set(claims.map((row) => row.id)).size, 2);
  assert.equal(new Set(claims.map((row) => row.title)).size, 2);
  for (const row of claims) {
    assert.ok(row.title.length <= 24);
    assert.equal(row.description, CLAIM_TITLE);
    assert.equal(demandHasDate(row.title), false);
  }
  const brief = openDemandBrief({
    id: "11111111-1111-1111-1111-111111111111",
    lead_type: "seeker_inbound",
    city: "עפולה",
    neighborhood: "גבעת המורה",
    deal_type: "sale",
    property_type: "דירה",
    rooms: 4,
    budget: 1500000,
    posted_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  }, new Date(), false);
  for (const key of Object.keys(brief)) assert.equal(DEMAND_FORBIDDEN.includes(key), false, key);
  assert.equal(demandHasDate(brief.summary + brief.age), false);
  assert.match(brief.action_path, /tab=demand&demand=/);
  assert.equal(directPostUrl("https://www.facebook.com/groups/1/posts/2"), "https://www.facebook.com/groups/1/posts/2");
  assert.equal(directPostUrl("https://m.facebook.com/story.php?id=1"), "https://m.facebook.com/story.php?id=1");
  assert.equal(directPostUrl("https://instagram.com/p/abc"), "https://instagram.com/p/abc");
  assert.equal(directPostUrl("http://www.facebook.com/x"), null);
  assert.equal(directPostUrl("https://evil.facebook.com/x"), null);
  assert.equal(directPostUrl("https://user:pass@facebook.com/x"), null);
  assert.equal(directPostUrl("https://shuknadlan.co.il/crm?goto=accLeads&tab=demand"), null);
  assert.equal(DEMAND_FORBIDDEN.includes("source_post_url"), true);
  const locked = openDemandBrief({
    id: "11111111-1111-1111-1111-111111111111",
    city: "עפולה",
    posted_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  }, new Date(), true);
  assert.equal(locked.locked, true);
  assert.match(locked.action_path, /tab=demand$/);
  assert.match(locked.age, /יום /);
});

test("חלון הסיכום במסד זהה לכלל בשעון ירושלים", () => {
  const fn = migration.slice(
    migration.indexOf("create or replace function public.lead_wa_digest_slot"),
    migration.indexOf("comment on function public.lead_wa_digest_slot"),
  );
  assert.ok(fn.includes("Asia/Jerusalem"));
  const psqlArgs = process.env.PGHOST
    ? ["-h", process.env.PGHOST, "-U", process.env.PGUSER || "postgres", "-d", process.env.PGDATABASE || "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
    : ["postgres", "-v", "ON_ERROR_STOP=1", "-q"];
  const sql = `
begin;
${fn}
do $t$
declare
  v text;
begin
  v := public.lead_wa_digest_slot('2026-07-12 06:05:00+00', 'thrice', 9, array[9,13,17], 15);
  if v is null or split_part(v, '|', 2) <> '9' or split_part(v, '|', 1) <> '0' then
    raise exception 'sunday 09:05 jerusalem should be the 9 slot, got %', v;
  end if;
  if public.lead_wa_digest_slot('2026-07-17 10:00:00+00', 'thrice', 9, array[9,13,17], 15) is not null then
    raise exception 'friday 13:00 should be skipped';
  end if;
  if public.lead_wa_digest_slot('2026-07-18 06:00:00+00', 'daily', 9, array[9,13,17], 15) is not null then
    raise exception 'saturday should be skipped';
  end if;
  if split_part(public.lead_wa_digest_slot('2026-07-17 06:00:00+00', 'thrice', 9, array[9,13,17], 15), '|', 1) <> '5' then
    raise exception 'friday 09:00 should stay';
  end if;
end
$t$;
rollback;
`;
  execFileSync("psql", psqlArgs, { input: sql, encoding: "utf8" });
});
