#!/usr/bin/env node
/* בדיקת ליבת ייבוא הנכסים (assets/property-import-core.js) - בלי רשת ובלי מסד.

   קובץ סינתטי בפורמט של יד2 ("המודעות שלי"), בלי נתונים של אף אחד, ושתי
   הרצות: עם אוצר המילים של ה-CRM (crm.js) ועם של השרת (agent.ts +
   FEATURE_LABELS ב-marketing-copy.ts). אם השתיים לא נותנות אותה תוצאה,
   ייבוא דרך גבריאלה וייבוא ב-CRM של אותו קובץ ייצאו שונים - וזה בדיוק מה
   שהליבה המשותפת אמורה למנוע.

   הרצה: node scripts/property_import_core_test.js                       */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');

require(path.join(ROOT, 'assets/property-import-core.js'));
const C = globalThis.PropertyImportCore;

function crmVocab(){
  const src = fs.readFileSync(path.join(ROOT, 'assets/crm.js'), 'utf8');
  const take = (name) => {
    const m = src.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'));
    if (!m) throw new Error('לא נמצא ' + name + ' ב-crm.js');
    return Function('return ' + m[1])();
  };
  return {
    residentialTypes: take('RESIDENTIAL_PTYPE_OPTIONS'),
    commercialTypes: take('COMMERCIAL_PTYPE_OPTIONS'),
    features: [...take('LISTING_FEATURES'), ...take('RESIDENTIAL_PROPERTY_FEATURES'), ...take('COMMERCIAL_PROPERTY_FEATURES')],
  };
}
function serverVocab(){
  const agent = fs.readFileSync(path.join(ROOT, 'supabase/functions/whatsapp-webhook/agent.ts'), 'utf8');
  const arr = (name) => Function('return ' + agent.match(new RegExp('export const ' + name + ' = (\\[[\\s\\S]*?\\]);'))[1])();
  const copy = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/marketing-copy.ts'), 'utf8');
  const labels = Function('return ' + copy.match(/const FEATURE_LABELS[^=]*= (\{[\s\S]*?\});/)[1])();
  return { residentialTypes: arr('RESIDENTIAL_PTYPES'), commercialTypes: arr('COMMERCIAL_PTYPES'), features: Object.entries(labels) };
}

const H = ['תאריך יצירה','מספר מודעה','סטטוס','איזור מכירה','עיר / ישוב','שכונה','כתובת','מספר בית','חדרים','קומה',
  'מספר קומות','מ״ר','מ״ר בנוי','מ״ר גינה','סוכן 1','טלפון 1','סוכן 2','טלפון 2','מזגן','חנייה','ממ״ד','ריהוט',
  'תיאור המודעה','תמונות','ווידאו','סוג מודעה','תאריך כניסה','מחיר','תוקף','סוג נכס','מצב נכס','סוג עסקה','תוספות','תאריך הקפצה'];
const row = (o) => H.map(h => (h in o ? o[h] : ''));
const base = { 'סטטוס':'פעילה', 'איזור מכירה':'אזור הבדיקה', 'עיר / ישוב':'עיר בדיקה', 'סוכן 1':'סוכן א', 'טלפון 1':'050-0000001',
  'סוכן 2':'סוכן ב', 'טלפון 2':'050-0000002', 'מזגן':'כן', 'חנייה':'ללא', 'ממ״ד':'ללא', 'ריהוט':'ללא', 'תמונות':'כן', 'ווידאו':'ללא',
  'סוג מודעה':'אפורה', 'תוקף':'2099-01-01', 'תוספות':'כן', 'תאריך הקפצה':'2026-01-01', 'מ״ר גינה':0 };
const ROWS = [
  row({ ...base, 'מספר מודעה':1001, 'שכונה':'דרום עיר בדיקה', 'כתובת':'הבדיקה', 'מספר בית':'1', 'חדרים':'4.0', 'קומה':2, 'מספר קומות':0,
        'מ״ר':100, 'מ״ר בנוי':90, 'מחיר':1500000, 'סוג נכס':'דירות', 'מצב נכס':'חדש (נכס בן עד 10 שנים)', 'סוג עסקה':'מכירה', 'תאריך כניסה':'2020-01-01' }),
  row({ ...base, 'מספר מודעה':1002, 'שכונה':'שכונה מכינוי', 'חדרים':'0.0', 'מ״ר':500, 'מ״ר בנוי':500, 'מחיר':75, 'סוג נכס':'חנות', 'סוג עסקה':'מסחרי' }),
  row({ ...base, 'מספר מודעה':1003, 'מ״ר':200, 'מחיר':1200000, 'סוג נכס':'משרד', 'סוג עסקה':'מסחרי', 'מצב נכס':'בחר מצב הנכס' }),
  row({ ...base, 'מספר מודעה':1004, 'מחיר':4000, 'סוג נכס':'דירות', 'סוג עסקה':'השכרה', 'טלפון 2':'+972-50-1234567' }),
  row({ ...base, 'מספר מודעה':1005, 'מחיר':1700000, 'סוג נכס':'דירות', 'סוג עסקה':'מכירה', 'סטטוס':'פעילה' }),
  row({ ...base, 'מספר מודעה':1006, 'מחיר':999, 'סוג נכס':'דירות', 'סוג עסקה':'מכירה' }),
  row({ ...base, 'מספר מודעה':1007, 'מחיר':2000000, 'סוג נכס':'דירות', 'סוג עסקה':'מכירה' }),
  row({ ...base, 'מספר מודעה':1001, 'מחיר':1500000, 'סוג נכס':'דירות', 'סוג עסקה':'מכירה' }),
];
const HOODS = [
  { id:'h-south', name:'דרום העיר', city:'עיר בדיקה' },
  { id:'h-alias', name:'מרכז העיר', city:'עיר בדיקה' },
];
const OWN = new Map([
  [1005, { id:'own-1', title:'דירה קיימת', price:1800000, status:'archived', description:'תיאור שלי', rooms:null, features:['ac'] }],
  [1007, { id:'own-2', title:'נמכרה', price:1900000, status:'sold' }],
]);

function run(vocab){
  C.configure(vocab);
  const headers = H.map(h => C.text(h));
  const S = { headers, rows: ROWS, mapping: C.autoMap(headers), overrides: {},
    hoodAliases: [{ neighborhood_id:'h-alias', alias:'שכונה מכינוי' }],
    yad2Taken: new Map([[1006, 'עמית/ה במשרד']]), ownByYad2: OWN, existingKeys: new Set(),
    neighborhoods: HOODS, canonicalStreet: (v) => ({ ok:true, name:String(v).trim() }),
    agent: { id:'me', agency_id:'office', phone:'0501234567' }, maxImages: 8 };
  S.yad2 = C.detectYad2(headers);
  const at = (n) => headers.findIndex(h => C.norm(h) === C.norm(n));
  S.mapping.listing_expires_at = -1;
  S.yad2Agent1 = { name: at('סוכן 1'), phone: at('טלפון 1') };
  S.mapping.yad2_listing_id = at('מספר מודעה');
  S.featureColumns = C.detectFeatureColumns(headers, S.mapping);
  return C.parseAll(S);
}

const crm = run(crmVocab());
const server = run(serverVocab());
assert.deepStrictEqual(server, crm, 'אוצר המילים של השרת נותן תוצאה אחרת מזה של ה-CRM');

const [r1, r2, r3, r4, r5, r6, r7, r8] = crm;
const fail = (r) => r.errors.join(' | ');
// קובץ יד2: "ללא" = לא, 0 = ריק, מצב עם סוגריים, תאריך שעבר = כניסה מיידית, "תוקף" אינו נקלט
assert.strictEqual(r1.errors.length, 0, fail(r1));
assert.strictEqual(r1.payload.category, 'residential');
assert.strictEqual(r1.payload.property_type, 'דירה');
assert.strictEqual(r1.payload.condition, 'new');
assert.strictEqual(r1.payload.total_floors, undefined);
assert.strictEqual(r1.payload.garden_sqm, undefined);
assert.strictEqual(r1.payload.move_in_soon, true);
assert.strictEqual(r1.payload.listing_expires_at, undefined);
assert.strictEqual(r1.payload.yad2_listing_id, 1001);
assert.deepStrictEqual(r1.payload.features, ['ac']);
assert.strictEqual(r1.payload.neighborhood_id, 'h-south', 'התאמה רכה: "דרום עיר בדיקה" → "דרום העיר"');
assert.ok(!r1.warnings.some(w => /תמונה|מאפיינים שלא זוהו|לא תקין/.test(w)), r1.warnings.join(' | '));
// מסחרי בלי מכירה/השכרה, ומחיר למ"ר; כינוי שכונה הוא ברירת מחדל (hoodFallback)
assert.strictEqual(r2.payload.category, 'commercial');
assert.strictEqual(r2.payload.deal_type, 'rent');
assert.strictEqual(r2.payload.price, 37500);
assert.strictEqual(r2.guessed.deal_type, 'השכרה');
assert.strictEqual(r2.hoodFallback, 'h-alias');
assert.strictEqual(r3.payload.deal_type, 'sale');
assert.strictEqual(r3.payload.condition, null);
// סוכן 2 הוא המייבא/ת - השותף/ה הוא סוכן 1
assert.strictEqual(r4.payload.agent2_name, 'סוכן א');
// ייבוא חוזר: חוזר לפרסום ומחיר מתעדכן; מה שמלא אצלי לא נדרס; מאפיין רק מתווסף
assert.strictEqual(r5.mode, 'update', fail(r5));
assert.strictEqual(r5.targetId, 'own-1');
assert.strictEqual(r5.patch.price, 1700000);
assert.strictEqual(r5.patch.status, 'active');
assert.strictEqual(r5.patch.description, undefined, 'תיאור שכבר מלא נדרס');
assert.strictEqual(r5.patch.features, undefined, 'מאפיין קיים נוסף פעמיים');
// מודעה של עמית/ה - דחייה עם השם ועם מה לעשות
assert.ok(r6.errors.length && /עמית\/ה במשרד/.test(r6.errors[0]) && /לתיקון:/.test(r6.errors[0]), fail(r6));
// נמכר - לא נוגעים
assert.strictEqual(r7.mode, 'same');
assert.deepStrictEqual(r7.patch, {});
// אותה מודעה פעמיים בקובץ - השנייה נדחית
assert.ok(r8.errors.some(e => /מופיעה כבר בשורה 2/.test(e)), fail(r8));

const sum = C.summarize(crm);
assert.deepStrictEqual([sum.insert, sum.update, sum.same, sum.rejected], [4, 1, 1, 2]);

// הודעות שמירה: לכל אחת סיבה ומה לעשות
const t = C.insertErrorText({ code:'23514', message:'violates check constraint "properties_total_floors_check"' }, e => e.message);
assert.ok(/מספר הקומות/.test(t) && /לתיקון:/.test(t), t);
assert.ok(/לתיקון:/.test(C.insertErrorText({ message:'TypeError: Failed to fetch' })));

console.log('✓ ליבת הייבוא: ' + crm.length + ' שורות, CRM ושרת זהים, ייבוא חוזר, מסחרי, כינויים והודעות שמירה');
