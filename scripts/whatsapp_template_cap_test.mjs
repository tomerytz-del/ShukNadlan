/**
 * תקרת תבניות וואטסאפ: 0 / 1 / 2 ביום, מרווח 8 שעות, ליד מעל הגג, טיפ מעל הגג.
 *
 *     node scripts/whatsapp_template_cap_test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20271030000200_whatsapp_template_cap.sql"),
  "utf8",
);
const push = readFileSync(
  join(root, "supabase/functions/notification-push/index.ts"),
  "utf8",
);

function extract(name) {
  const re = new RegExp(
    `create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`,
  );
  const found = migration.match(re);
  if (!found) throw new Error(`missing ${name}`);
  return found[0];
}

test("הדגל כבוי, והסיבה נרשמת ביומן בלי להזיז את השעון", () => {
  assert.match(migration, /'whatsapp_template_cap_enabled', 'false'/);
  assert.match(migration, /whatsapp_template_cap_exempt_types', '\["new_lead","agenda_reminder","showcase_meeting"\]'/);
  const usage = extract("whatsapp_template_cap_usage");
  assert.match(usage, /whatsapp_status in \('sent', 'pending'\)/);
  assert.doesNotMatch(usage, /showcase_meeting|exempt_types/);
  assert.match(migration, /skipped_template_cap/);
  assert.match(migration, /last_error = 'skipped_template_cap'/);
  assert.doesNotMatch(migration, /created_at = now\(\) - interval '25 hours'/);
  assert.doesNotMatch(migration, /claim_inner/);
  assert.match(migration, /interval '2 days'/);
  assert.match(migration, /Asia\/Jerusalem/);
  const holds = extract("notification_push_log_holds");
  assert.doesNotMatch(holds, /skipped_template_cap/);
  const allow = extract("whatsapp_template_cap_allow");
  assert.doesNotMatch(allow, /suppress_push/);
});

test("אחרי המיזוג: burst_prepare פעם אחת ב-claim, ו-cap_allow גם ב-claim וגם בשליחה", () => {
  const claim = extract("notification_push_claim");
  const prepares = claim.match(/perform public\.notification_push_burst_prepare\(\)/g) || [];
  assert.equal(prepares.length, 1);
  assert.match(claim, /whatsapp_template_cap_allow\(v_log\)/);
  assert.match(claim, /skipped_template_cap/);
  assert.match(claim, /notif_il_digest_open/);
  assert.match(claim, /lheld/);
  const due = extract("notification_push_due_agents");
  assert.match(due, /l\.whatsapp_status = 'failed'/);
  assert.doesNotMatch(due, /not public\.notification_push_log_holds\(l\.whatsapp_status/);
  assert.match(claim, /interval '72 hours'/);
  assert.match(claim, /whatsapp_template_cap_limit\('whatsapp_template_cap_daily'/);
  assert.match(claim, /not v_cap_held/);
  assert.doesNotMatch(claim, /false, 1, 2, 8/);
  const backlog = readFileSync(
    join(root, "supabase/migrations/20271030000300_template_cap_backlog.sql"),
    "utf8",
  );
  assert.match(backlog, /skipped_template_cap/);
  assert.match(backlog, /a\.in_service_window/);
  assert.doesNotMatch(backlog, /a\.in_window\b/);
  assert.match(push, /templateCapAllows\(sb, row\.log_id\)/);
  assert.match(push, /rpc\("whatsapp_template_cap_allow"/);
});

test("0, 1 או 2 תבניות; מתחת ל-8 שעות ומעליהן; ליד מעל הגג; טיפ מעל הגג", () => {
  const psqlArgs = process.env.PGHOST
  ? ["-h", process.env.PGHOST, "-U", process.env.PGUSER || "postgres", "-d", process.env.PGDATABASE || "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
  : ["postgres", "-v", "ON_ERROR_STOP=1", "-q"];

const sql = `
begin;
${extract("whatsapp_template_local_day")}
${extract("whatsapp_template_cap_decide")}
${extract("whatsapp_template_cap_exempt_parse")}
do $t$
begin
  -- 0 שנשלחו: מותר, גם טיפ.
  if not public.whatsapp_template_cap_decide(0, null, false, 1, 2, 8) then
    raise exception '0 sent should allow a tip';
  end if;

  -- 1 שנשלחה, פחות מ-8 שעות: טיפ נעצר.
  if public.whatsapp_template_cap_decide(1, 7.9, false, 1, 2, 8) then
    raise exception '1 sent under 8h should block a tip';
  end if;

  -- 1 שנשלחה, 8 שעות ומעלה: השניה מותרת. 2 הוא גג, לא יעד.
  if not public.whatsapp_template_cap_decide(1, 8, false, 1, 2, 8) then
    raise exception '1 sent over 8h should allow the second template';
  end if;
  if not public.whatsapp_template_cap_decide(1, 8.01, false, 1, 2, 8) then
    raise exception '1 sent well over 8h should allow the second template';
  end if;

  -- 2 שנשלחו: טיפ מעל הגג נעצר, גם אחרי 8 שעות.
  if public.whatsapp_template_cap_decide(2, 9, false, 1, 2, 8) then
    raise exception '2 sent should block a tip';
  end if;
  if public.whatsapp_template_cap_decide(2, 1, false, 1, 2, 8) then
    raise exception '2 sent under 8h should block a tip';
  end if;

  -- ליד מעל הגג יוצא, גם מתחת ל-8 שעות וגם אחרי 2.
  if not public.whatsapp_template_cap_decide(2, 1, true, 1, 2, 8) then
    raise exception 'lead above the cap should still send';
  end if;
  if not public.whatsapp_template_cap_decide(1, 1, true, 1, 2, 8) then
    raise exception 'lead under 8h should still send';
  end if;

  -- גבול היממה: 21:30 UTC ביולי הוא כבר מחר בירושלים, 20:30 עדיין היום.
  if public.whatsapp_template_local_day('2026-07-15 21:30:00+00')
       is distinct from date '2026-07-16' then
    raise exception '21:30 UTC in July is the next Jerusalem day';
  end if;
  if public.whatsapp_template_local_day('2026-07-15 20:30:00+00')
       is distinct from date '2026-07-15' then
    raise exception '20:30 UTC in July is still the same Jerusalem day';
  end if;

  -- ברירת המחדל, מערך מההגדרה, וערך שבור שחוזר לברירת המחדל.
  if public.whatsapp_template_cap_exempt_parse(null)
       is distinct from array['new_lead', 'agenda_reminder', 'showcase_meeting']::text[] then
    raise exception 'missing exempt list should default to lead, reminder and showing';
  end if;
  if public.whatsapp_template_cap_exempt_parse('["new_lead"]')
       is distinct from array['new_lead']::text[] then
    raise exception 'exempt list should follow the config array';
  end if;
  if public.whatsapp_template_cap_exempt_parse('not-json')
       is distinct from array['new_lead', 'agenda_reminder', 'showcase_meeting']::text[] then
    raise exception 'broken exempt list should fall back to the default';
  end if;
end
$t$;
rollback;
`;
  execFileSync("psql", psqlArgs, {
    input: sql,
    encoding: "utf8",
  });
});

test("שלוש שורות skipped_template_cap לא מורידות סוכן/ת עם ליד חדש", () => {
  const psqlArgs = process.env.PGHOST
    ? ["-h", process.env.PGHOST, "-U", process.env.PGUSER || "postgres", "-d", process.env.PGDATABASE || "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"]
    : ["postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
  const due = extract("notification_push_due_agents");
  const sql = `
begin;
create table public.pricing_config (key text primary key, value int, description text);
insert into public.pricing_config (key, value) values ('notif_push_max_failures_24h', 3);
create table public.agency_members (
  id uuid primary key, display_name text, phone_e164 text, active boolean,
  closed_at timestamptz, closure_requested_at timestamptz, tier text, billing_status text
);
create table public.agent_notification_preferences (agent_id uuid, whatsapp_off_types text[]);
create table public.agent_notif_less (agent_id uuid, notif_type text, expires_at timestamptz);
create table public.agent_reminder_preferences (agent_id uuid, quiet_from_hour int, quiet_to_hour int, quiet_days smallint[]);
create table public.whatsapp_conversations (agent_id uuid, last_message_at timestamptz);
create table public.notification_push_log (
  id uuid primary key default gen_random_uuid(), agent_id uuid,
  notification_ids uuid[], channel_mode text,
  whatsapp_status text, last_error text, created_at timestamptz default now()
);
create or replace function public.notification_known_types() returns text[] language sql as $$ select array['new_lead']::text[] $$;
create or replace function public.notification_push_priority_types() returns text[] language sql as $$ select array['new_lead','agenda_reminder']::text[] $$;
create or replace function public.notification_push_less_kept(p text) returns boolean language sql as $$ select false $$;
create or replace function public.notif_il_digest_open(p int) returns boolean language sql as $$ select false $$;
create or replace function public.notification_agent_send_quiet(a int,b int,c smallint[],d timestamptz,e int) returns boolean language sql as $$ select false $$;
create or replace function public.agent_backlog_waiting(p uuid, t timestamptz) returns boolean language sql as $$ select false $$;
create or replace function public.whatsapp_template_cap_on() returns boolean language sql as $$ select true $$;
create or replace function public.notification_push_log_holds(p_status text, p_created timestamptz) returns boolean language sql as $$
  select p_status in ('sent','skipped') $$;
insert into public.agency_members (id, display_name, phone_e164, active, tier, billing_status)
values
  ('11111111-1111-1111-1111-111111111111', 't', '+972501111111', true, 'mid', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'f', '+972502222222', true, 'mid', 'active');
insert into public.notification_push_log (agent_id, whatsapp_status)
select '11111111-1111-1111-1111-111111111111', 'skipped_template_cap' from generate_series(1,4);
insert into public.notification_push_log (agent_id, whatsapp_status, created_at)
select '22222222-2222-2222-2222-222222222222', 'failed', now() - interval '30 minutes'
  from generate_series(1,3);
${due};
select
  (select count(*)::text from public.notification_push_due_agents()
    where agent_id = '11111111-1111-1111-1111-111111111111'
      and 'new_lead' = any(whatsapp_types))
  || ' ' ||
  (select count(*)::text from public.notification_push_due_agents()
    where agent_id = '22222222-2222-2222-2222-222222222222');
rollback;
`;
  const out = execFileSync("psql", psqlArgs, { input: sql, encoding: "utf8" }).trim();
  assert.equal(out, "1 0");
});
