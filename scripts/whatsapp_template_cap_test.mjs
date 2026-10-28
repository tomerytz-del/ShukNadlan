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
});

test("אחרי המיזוג: burst_prepare פעם אחת ב-claim, ו-cap_allow גם ב-claim וגם בשליחה", () => {
  const claim = extract("notification_push_claim");
  const prepares = claim.match(/perform public\.notification_push_burst_prepare\(\)/g) || [];
  assert.equal(prepares.length, 1);
  assert.match(claim, /whatsapp_template_cap_allow\(v_log\)/);
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
