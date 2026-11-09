#!/usr/bin/env node
/* ערוץ התזכורת במסך: ההחלפה למייל היא לתצוגה, והשמירה לא מוחקת וואטסאפ.
   השער הוא tier כמו agent_reminder_due_agents, בלי billing_status.
   בלי לטעון את crm.js (הוא פותח לקוח של Supabase) ובלי רשת.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const crm = fs.readFileSync(path.join(ROOT, 'assets/crm.js'), 'utf8');
const sql = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20271030183000_reminder_free_no_whatsapp.sql'),
  'utf8',
);

function extractFunction(src, name) {
  const key = 'function ' + name + '(';
  const start = src.indexOf(key);
  if (start < 0) throw new Error('חסרה ' + name);
  let depth = 0;
  let seen = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') {
      depth--;
      if (seen && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('פונקציה לא סגורה: ' + name);
}

const waFn = extractFunction(crm, 'reminderWaAllowed');
assert(!waFn.includes('assistantTierOk'), 'השער לא אמור לעבור דרך assistantTierOk');
assert(!waFn.includes('billing_status'), 'השער לא אמור לקרוא billing_status');

const dueStart = sql.indexOf('create or replace function public.agent_reminder_due_agents');
const dueEnd = sql.indexOf('comment on function public.agent_reminder_due_agents');
assert(dueStart >= 0 && dueEnd > dueStart, 'גוף agent_reminder_due_agents לא נמצא');
const due = sql.slice(dueStart, dueEnd);
assert(due.includes("r.tier in ('mid', 'premium')"), 'המסד לא מגביל ל-mid/premium');
assert(!due.includes('billing_status'), 'המסד בודק billing_status והמסך לא');

const code = [
  'reminderWaAllowed',
  'reminderChannelsForScreen',
  'reminderChannelsEqual',
  'reminderChannelsToStore',
].map(name => extractFunction(crm, name)).join('\n');

const ctx = {
  currentAgent: null,
  reminderPrefs: { channels: ['whatsapp'] },
  REMINDER_PREF_DEFAULTS: { channels: ['whatsapp'] },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

function agent(tier, billing) {
  ctx.currentAgent = { tier: tier, billing_status: billing };
}

function eq(got, want, label) {
  assert.deepStrictEqual(got, want, label + ': ' + JSON.stringify(got));
}

agent('free', 'active');
assert.strictEqual(ctx.reminderWaAllowed(), false);
ctx.reminderPrefs = { channels: ['whatsapp'] };
eq(ctx.reminderChannelsForScreen(['whatsapp']), ['email'], 'תצוגה לחינם');
eq(ctx.reminderChannelsToStore(['email']), ['whatsapp'], 'שמירה לא דורסת וואטסאפ');

agent('mid', 'past_due');
assert.strictEqual(ctx.reminderWaAllowed(), true, 'חיוב לא פעיל לא מוריד וואטסאפ');
eq(ctx.reminderChannelsForScreen(ctx.reminderPrefs.channels), ['whatsapp'], 'אחרי שדרוג');
eq(ctx.reminderChannelsToStore(['whatsapp']), ['whatsapp'], 'שמירה בתשלום');

agent('premium', null);
assert.strictEqual(ctx.reminderWaAllowed(), true);
ctx.reminderPrefs = { channels: ['email', 'whatsapp'] };
eq(ctx.reminderChannelsForScreen(['email', 'whatsapp']), ['email', 'whatsapp'], 'premium שני הערוצים');

agent(null, 'active');
assert.strictEqual(ctx.reminderWaAllowed(), false, 'tier ריק');
ctx.reminderPrefs = { channels: ['whatsapp'] };
eq(ctx.reminderChannelsToStore(['email']), ['whatsapp'], 'ברירת מחדל בלי שורה');

agent('free', 'active');
ctx.reminderPrefs = { channels: ['whatsapp'] };
eq(ctx.reminderChannelsToStore([]), [], 'כיבוי המייל הוא בחירה');

ctx.reminderPrefs = { channels: ['email', 'whatsapp'] };
eq(ctx.reminderChannelsForScreen(['email', 'whatsapp']), ['email'], 'שני הערוצים מוצגים כמייל');
eq(ctx.reminderChannelsToStore(['email']), ['email', 'whatsapp'], 'שני הערוצים נשמרים');

ctx.reminderPrefs = { channels: ['email'] };
eq(ctx.reminderChannelsToStore(['email']), ['email'], 'מייל בלבד');

ctx.reminderPrefs = { channels: [] };
eq(ctx.reminderChannelsForScreen([]), [], 'מערך ריק');
eq(ctx.reminderChannelsToStore([]), [], 'מערך ריק נשמר');
eq(ctx.reminderChannelsToStore(['email']), ['email'], 'הדלקת מייל על מערך ריק');

agent('mid', 'active');
ctx.reminderPrefs = { channels: ['whatsapp'] };
eq(ctx.reminderChannelsToStore(['email', 'whatsapp']), ['email', 'whatsapp'], 'בתשלום נשמר מה שהמסך מראה');

console.log('reminder channels: ok');
