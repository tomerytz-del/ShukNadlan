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
  CADENCE_BUTTON_TITLE,
  CADENCE_CTA,
  CADENCE_LIST_BUTTON,
  CADENCE_MENU_BODY,
  CADENCE_PATH,
  cadenceRows,
  confirmLine,
  digestChannel,
  digestIntro,
  digestSlot,
  hasCalendarDate,
  utf16len,
} from "../supabase/functions/_shared/notif-cadence.ts";

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
  assert.ok(utf16len(CADENCE_CTA) <= 20);
  assert.ok(utf16len(CADENCE_LIST_BUTTON) <= 20);
  const rows = cadenceRows(9, [9, 13, 17]);
  const ids = new Set();
  for (const row of rows) {
    assert.ok(utf16len(row.title) <= 24, row.title);
    assert.ok(utf16len(row.description) <= 72, row.description);
    assert.ok(!ids.has(row.id));
    ids.add(row.id);
    assert.equal(hasCalendarDate(row.title + row.description), false);
  }
  assert.equal(ids.size, 4);
  assert.match(CADENCE_MENU_BODY, /אפשר תמיד לשנות את זה גם במערכת/);
  assert.equal(hasCalendarDate(CADENCE_MENU_BODY), false);
  assert.match(CADENCE_PATH, /focus=lead_wa/);
  assert.doesNotMatch(CADENCE_PATH, /goto=accLeads$/);
});

test("אישור קצר, בלי תאריך, וחלון הסיכום", () => {
  for (const choice of ["each", "daily", "thrice", "off"]) {
    const line = confirmLine(choice, true, 9, [9, 13, 17]);
    assert.equal(hasCalendarDate(line), false, line);
    assert.ok(line.length < 180, line);
  }
  assert.equal(hasCalendarDate(digestIntro(0, 9)), false);
  assert.match(digestIntro(0, 9), /יום ראשון ב-9:00/);

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
  assert.equal(digestChannel(false, "send", false), "template");
});

test("הדגל כבוי, האכיפה ב-claim, ובלי לגעת ביצירת הליד", () => {
  assert.match(migration, /'notif_cadence_button_enabled', 'false'/);
  assert.match(migration, /notif_lead_digest_outside', 'cap'/);
  assert.match(migration, /notification_push_lead_wa_sendable/);
  assert.match(migration, /notify_agent_on_new_lead/);
  assert.doesNotMatch(migration, /create or replace function public\.notify_agent_on_new_lead/);
  assert.doesNotMatch(migration, /create or replace function public\.notifications_apply_preferences/);
  assert.doesNotMatch(migration, /create or replace function public\.social_lead/);
  assert.match(push, /notification_push_prepare_lead_cadence/);
  assert.match(hook, /cadenceIdFromMessage/);
  assert.match(setup, /התאמת קצב התראות/);
  assert.match(setup, /לא מגישים/);
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
