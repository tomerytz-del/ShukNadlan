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
  CADENCE_EXCLUDED,
  CADENCE_GROUPS,
  CADENCE_GROUP_MAP,
  CADENCE_TYPES_BODY,
  cadenceFocus,
  cadenceGroupOf,
  cadenceOpenId,
  cadenceOptionRows,
  digestChannel,
  digestIntro,
  digestIntroFor,
  digestSlot,
  effectiveGroupCadence,
  hasCalendarDate,
  offAfterText,
  offWarn,
  orderCadenceGroups,
  parseCadenceTap,
  parseOutside,
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
  assert.equal(CADENCE_GROUPS.length, 5);
  const ids = new Set();
  for (const row of typeListRows("meetings", { new_leads: "daily" }, [])) {
    assert.ok(utf16len(row.title) <= 24, row.title);
    assert.ok(utf16len(row.description) <= 72, row.description);
    assert.ok(!ids.has(row.id));
    ids.add(row.id);
    assert.equal(hasCalendarDate(row.title + row.description), false);
  }
  assert.equal(ids.size, 5);
  assert.equal(orderCadenceGroups("meetings")[0].id, "meetings");
  assert.match(typeListRows("new_leads", { new_leads: "daily" }, [])[0].description, /פעם ביום/);
  assert.match(typeListRows(null, {}, [])[1].description, /יוצא תמיד/);
  const meetings = cadenceOptionRows("meetings", 9, [9, 13, 17]);
  assert.equal(meetings.length, 0);
  const leads = cadenceOptionRows("new_leads", 9, [9, 13, 17]);
  assert.deepEqual(leads.map((row) => row.choice), ["each", "daily", "thrice", "off"]);
  const mentor = cadenceOptionRows("system_mentor", 9, [9, 13, 17]);
  assert.deepEqual(mentor.map((row) => row.choice), ["digest", "off"]);
  for (const row of [...leads, ...mentor]) {
    assert.ok(utf16len(row.title) <= 24, row.title);
    assert.ok(utf16len(row.description) <= 72, `${row.description} (${utf16len(row.description)})`);
    assert.equal(hasCalendarDate(row.title + row.description), false);
  }
  assert.match(CADENCE_PATH, /focus=lead_wa/);
  assert.match(cadenceFocus("matches"), /focus=cadence_matches/);
  assert.equal(cadenceOpenId("new_lead"), "ncad:open:new_leads");
  assert.equal(cadenceOpenId("ops_alert"), "ncad:open");
  assert.equal(parseCadenceTap("ncad:open:new_leads")?.kind, "open");
  assert.equal(parseCadenceTap("ncad:c:meetings:off"), null);
  assert.equal(parseCadenceTap("ncad:c:new_leads:off")?.kind, "choice");
  assert.equal(parseCadenceTap("ncad:yes:new_leads")?.type, "new_leads");
  assert.equal(parseCadenceTap("ncad:more")?.kind, "types");
  assert.equal(effectiveGroupCadence({}, [], "meetings"), "each");
  assert.equal(effectiveGroupCadence({ new_leads: "daily" }, [], "new_leads"), "daily");
  assert.equal(effectiveGroupCadence({}, [], "system_mentor"), "digest");
  assert.equal(effectiveGroupCadence({ system_mentor: "off" }, [], "system_mentor"), "off");
});

test("מיפוי קבוצות, וסוג לא מוכר נופל לקבוצה 5", () => {
  assert.equal(cadenceGroupOf("new_lead"), "new_leads");
  assert.equal(cadenceGroupOf("onboarding_lead"), "new_leads");
  assert.equal(cadenceGroupOf("onboarding_property"), "system_mentor");
  assert.equal(cadenceGroupOf("agenda_reminder"), "meetings");
  assert.equal(cadenceGroupOf("showcase_meeting"), "meetings");
  assert.equal(cadenceGroupOf("open_demand"), "open_demand");
  assert.equal(cadenceGroupOf("match_digest"), "matches");
  assert.equal(cadenceGroupOf("client_match"), "matches");
  assert.equal(cadenceGroupOf("review_new"), "system_mentor");
  assert.equal(cadenceGroupOf("future_type"), "system_mentor");
  assert.equal(cadenceGroupOf("ops_alert"), null);
  assert.equal(cadenceGroupOf("security_alert"), null);
  assert.equal(cadenceGroupOf("platform_signup"), null);
  assert.equal(cadenceGroupOf("deal_sync_summary"), null);
  assert.equal(cadenceGroupOf("deal_data_gap"), null);
  for (const [type, group] of Object.entries(CADENCE_GROUP_MAP)) {
    assert.equal(cadenceGroupOf(type), group, type);
    assert.equal(CADENCE_EXCLUDED.has(type), false, type);
  }
  for (const type of CADENCE_EXCLUDED) {
    assert.equal(migration.includes(`'${type}', 'system_mentor'`), false, type);
  }
  assert.match(migration, /'new_lead', 'new_leads'/);
  assert.match(migration, /'onboarding_lead', 'new_leads'/);
  assert.match(migration, /else coalesce\(/);
  assert.match(migration, /'system_mentor'\)/);
  assert.match(migration, /notif_cadence_group\(p_type\) = 'system_mentor' then false/);
  assert.match(migration, /allow_template := r\.notif_type is distinct from 'system_mentor'/);
  assert.match(migration, /split_part\(p_slot, ':', 2\) = 'system_mentor'/);
});

test("אישור קצר, בלי תאריך, וחלון הסיכום", () => {
  for (const choice of ["each", "daily", "thrice", "off"]) {
    const line = typeConfirmLine("new_leads", choice, true, 9, [9, 13, 17]);
    assert.equal(hasCalendarDate(line), false, line);
    assert.ok(line.length < 280, line);
  }
  assert.equal(hasCalendarDate(digestIntro(0, 9)), false);
  assert.match(digestIntro(0, 9), /יום ראשון ב-9:00/);
  assert.match(digestIntroFor("matches", 0, 9), /התאמות/);
  assert.match(offAfterText("new_leads"), /לשאול אותי/);
  assert.match(offAfterText("new_leads"), /לשונית הלידים/);
  assert.match(offAfterText("open_demand"), /ביקוש הפתוח/);
  assert.match(offWarn("new_leads"), /עלול לעבור הלאה/);
  assert.match(offWarn("matches"), /שת״פ/);
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
  assert.equal(parseOutside("send"), "cap");
  assert.equal(parseOutside("bell"), "bell");
  assert.equal(digestChannel(false, parseOutside("send"), false), "bell");
  assert.equal(digestChannel(false, parseOutside("send"), true, 1), "template");
  assert.equal(digestChannel(true, parseOutside("send"), false, 3), "text");
  assert.equal(digestChannel(false, "cap", true, 3), "bell");
  assert.equal(digestChannel(false, parseOutside("send"), true, 3), "bell");
  for (const id of ["new_leads", "open_demand", "matches", "system_mentor"]) {
    assert.equal(CADENCE_GROUPS.find((g) => g.id === id)?.confirmOff, true, id);
  }
  assert.equal(CADENCE_GROUPS.find((g) => g.id === "meetings")?.confirmOff, false);
});

test("הדגל כבוי, האכיפה ב-claim, ובלי לגעת ביצירת הליד", () => {
  assert.match(migration, /'notif_cadence_button_enabled', 'false'/);
  assert.match(migration, /notif_lead_digest_outside', 'cap'/);
  assert.match(migration, /notification_push_lead_wa_sendable/);
  assert.match(migration, /whatsapp_cadence jsonb/);
  assert.doesNotMatch(migration, /lead_wa_cadence/);
  assert.match(migration, /notif_cadence_group_map/);
  assert.match(migration, /function public.notif_cadence_group/);
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
  assert.match(settings, /cadenceChipsVisible/);
  assert.match(settings, /notifCadenceFlag/);
  assert.match(settings, /assistantTierOk/);
  assert.match(settings, /data-cadence-off-yes/);
  assert.match(settings, /cadenceOffArmed/);
  assert.doesNotMatch(settings, /lead_wa_cadence/);
  const claimStart = migration.indexOf("create or replace function public.notification_push_claim");
  const claimEnd = migration.indexOf("comment on function public.notification_push_claim(int)", claimStart);
  const claim = migration.slice(claimStart, claimEnd);
  assert.match(claim, /not n\.suppress_push/);
  assert.match(claim, /notification_push_burst_prepare\(\)/);
  assert.match(claim, /'action_path', n\.action_path/);
  assert.match(claim, /notification_push_lead_wa_sendable\(n\.agent_id, n\.type, n\.created_at\)/);
  assert.match(claim, /notif_burst_stale_hours/);
  assert.match(claim, /burst_digest/);
  assert.doesNotMatch(claim, /24 \* 7/);
  assert.match(migration, /v_type in \('new_leads', 'open_demand', 'matches', 'system_mentor'\)/);
  assert.match(migration, /c\.value in \('cap', 'bell'\)/);
  assert.doesNotMatch(migration, /c\.value in \('cap', 'bell', 'send'\)/);
  const single = push.slice(push.indexOf('if (plan.kind === "single")'), push.indexOf('if (plan.kind === "buttons")'));
  assert.match(single, /return ctaMessage\(/);
  assert.doesNotMatch(single, /replyButtonsMessage/);
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
