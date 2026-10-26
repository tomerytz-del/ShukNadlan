#!/usr/bin/env node
/* כרטיס הליד ושורות תמונת המצב: זמן יחסי, שלב קיים, ושורות עם אפס
   שלא נכנסות. בלי crm.js (הוא פותח לקוח של Supabase) ובלי רשת.

   הרצה: node scripts/crm_lead_quick_test.js
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const RealDate = Date;

global.window = global;
global.addEventListener = () => {};
global.matchMedia = () => ({ matches: false });
global.document = {
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() {
    return {
      className: '', dataset: {}, style: {}, children: [],
      setAttribute() {}, addEventListener() {}, appendChild() {},
      querySelector() { return null; },
    };
  },
  body: { classList: { add() {}, remove() {}, toggle() {} } },
};
global.location = { hash: '', pathname: '/crm' };
global.leadWork = new Map();
global.esc = s => String(s == null ? '' : s);
global.plural = (n, one, many) => (n === 1 ? one : n + ' ' + many);

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/crm-leads.js'), 'utf8'), {
  filename: 'assets/crm-leads.js',
});
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/crm-home.js'), 'utf8'), {
  filename: 'assets/crm-home.js',
});

function pinClock(y, m, d, hh, mm) {
  const fixed = new RealDate(y, m - 1, d, hh, mm, 0, 0);
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed.getTime());
      else super(...args);
    }
    static now() { return fixed.getTime(); }
  };
  return fixed;
}
function localIso(y, m, d, hh, mm, ss) {
  return new RealDate(y, m - 1, d, hh, mm, ss || 0, 0).toISOString();
}

pinClock(2026, 10, 25, 15, 0);
assert.strictEqual(leadAgo(localIso(2026, 10, 25, 14, 48)), 'לפני 12 דק׳');
assert.strictEqual(leadAgo(localIso(2026, 10, 25, 14, 59, 50)), 'עכשיו');
assert.strictEqual(leadAgo(localIso(2026, 10, 25, 12, 0)), 'לפני 3 שעות');
assert.strictEqual(leadAgo(localIso(2026, 10, 24, 12, 0)), 'אתמול');
const when = leadWhen(localIso(2026, 10, 25, 14, 48));
assert.strictEqual(when.text, 'לפני 12 דק׳');
assert.ok(when.title.includes('2026'), when.title);

global.Date = RealDate;

assert.strictEqual(leadStageClass('nope'), 'new');
assert.strictEqual(leadStageClass('meeting'), 'meeting');
leadWork.set('L1', { stage: 'meeting' });
const tag = leadStageTagHtml({ id: 'L1' });
assert.ok(tag.includes('lp-st-meeting'), tag);
assert.ok(tag.includes('בתיאום פגישה / סיור'), tag);
assert.ok(!tag.includes('בטיפול'), tag);

global.currentAgent = { id: 'a1' };
global.navAccVisible = () => true;
global.accCountOf = () => 0;
global.agendaItems = [];
global.agendaDayStart = offset => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
global.agendaDue = it => (it.due_at ? new Date(it.due_at) : null);
global.agendaIsLate = it => it.late === true;
global.agendaBuckets = () => ({ today: global.agendaItems.filter(it => it.late) });
global.myPropertyRows = [];
global.propertyIsExpiring = () => false;
global.exclusivityDaysLeft = () => null;

assert.deepStrictEqual(homeSummaryItems(), []);

global.accCountOf = () => 4;
const leads = homeSummaryItems();
assert.strictEqual(leads.length, 1);
assert.strictEqual(leads[0].key, 'leads');
assert.strictEqual(leads[0].label, '4 לידים חדשים');

const atTen = new Date();
atTen.setHours(10, 0, 0, 0);
global.agendaItems = [
  { status: 'open', kind: 'meeting', due_at: atTen.toISOString() },
  { status: 'open', kind: 'showing', due_at: atTen.toISOString() },
  { status: 'open', kind: 'task', due_at: atTen.toISOString(), late: true },
];
const withDay = homeSummaryItems();
assert.ok(withDay.some(r => r.key === 'meetings' && r.label === '2 פגישות היום'), JSON.stringify(withDay));
assert.ok(withDay.some(r => r.key === 'late' && r.label === 'משימה אחת באיחור'), JSON.stringify(withDay));

global.myPropertyRows = [{ status: 'active', agent_id: 'a1', id: 'p1' }];
global.propertyIsExpiring = () => true;
assert.ok(homeSummaryItems().some(r => r.key === 'expiring' && r.label === 'נכס אחד עומד לפוג'));

global.propertyIsExpiring = () => false;
global.exclusivityDaysLeft = () => 3;
assert.ok(homeSummaryItems().some(r => r.key === 'exclusive' && r.label === 'בלעדיות אחת מסתיימת'));
global.exclusivityDaysLeft = () => 20;
assert.ok(!homeSummaryItems().some(r => r.key === 'exclusive'));
global.exclusivityDaysLeft = () => -1;
assert.ok(!homeSummaryItems().some(r => r.key === 'exclusive'));

global.navAccVisible = acc => acc !== 'accLeads';
assert.ok(!homeSummaryItems().some(r => r.key === 'leads'));

const crm = fs.readFileSync(path.join(ROOT, 'assets/crm.js'), 'utf8');
function grab(name) {
  const start = crm.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = crm.indexOf('{', start);
  let depth = 0;
  for (; i < crm.length; i++) {
    if (crm[i] === '{') depth++;
    else if (crm[i] === '}') {
      depth--;
      if (depth === 0) return crm.slice(start, i + 1);
    }
  }
  throw new Error(name);
}
vm.runInThisContext(grab('crmMoneyRaw') + '\n' + grab('crmMoneyNum') + '\n' + grab('crmMoneyText'), {
  filename: 'crm-money.js',
});
assert.strictEqual(crmMoneyRaw('1,850,000'), '1850000');
assert.strictEqual(crmMoneyRaw(null), '');
assert.strictEqual(crmMoneyNum('1,850,000'), 1850000);
assert.strictEqual(crmMoneyNum(''), null);
assert.strictEqual(crmMoneyText(1850000), '1,850,000');
assert.strictEqual(crmMoneyText(1.85), '1.85');
assert.ok(crm.includes("salePriceFromMillions(parseFloat(crmMoneyRaw("), 'המחיר נשמר בלי פסיקים');

const leadsSrc = fs.readFileSync(path.join(ROOT, 'assets/crm-leads.js'), 'utf8');
assert.ok(!/touchstart|swipe/i.test(leadsSrc), 'אין החלקה לשינוי שלב');
assert.ok(leadsSrc.includes("shukTrack('crm_lead_call'"));
assert.ok(leadsSrc.includes("shukTrack('crm_lead_handled_undo'"));

console.log('crm_lead_quick_test: ok');
