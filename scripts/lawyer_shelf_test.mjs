/**
 * מדף עורכי הדין וחשבון בעל המקצוע: החיווט בין המסד, פונקציות ה-Edge והדפים.
 *
 * כל מה שנבדק כאן שקט כשהוא נשבר: חשבון שנפתח עם גישה למדף בלי אישור אינו שגיאה, וטבלת ארנק
 * שהדפדפן יכול לכתוב אליה מזכה כל אחד במה שירצה.
 *
 *     node --test scripts/lawyer_shelf_test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const migDir = join(root, 'supabase/migrations');
const migrations = readdirSync(migDir).sort().map((f) => ({ f, text: readFileSync(join(migDir, f), 'utf8') }));
const accountsMig = migrations.find((m) => m.f.endsWith('_professional_accounts.sql'));
const purchaseFn = read('supabase/functions/lawyer-lead-purchase/index.ts');
const accountFn = read('supabase/functions/professional-account/index.ts');
const manageFn = read('supabase/functions/professional-manage/index.ts');
const manageHtml = read('professional-manage.html');
const crmJs = read('assets/professional-crm.js');
const crmHtml = read('professional-crm.html');
const config = read('supabase/config.toml');

test('מיגרציית החשבון קיימת, והארנק והאישור נכתבים רק מ-service_role', () => {
  assert.ok(accountsMig, 'אין מיגרציה professional_accounts');
  const t = accountsMig.text;
  assert.match(t, /revoke all on table public\.professional_accounts from public, anon, authenticated;\s*grant select on table public\.professional_accounts to authenticated;/);
  // אין policy של כתיבה ל-authenticated: shelf_enabled ו-credit_balance אינם ניתנים לעדכון מהדפדפן
  const policies = [...t.matchAll(/create policy "([^"]+)"\s+on public\.professional_accounts for (\w+)/g)];
  assert.ok(policies.length >= 1);
  for (const [, name, verb] of policies) assert.equal(verb, 'select', `policy "${name}" אינה קריאה בלבד`);
  assert.match(t, /revoke all on function public\.professional_credit_add\(uuid, numeric, text\) from public, anon, authenticated;/);
});

test('הטריגר של agency_members נועל את is_mortgage_advisor, ו-is_lawyer כבר אינו קיים', () => {
  let last = null;
  for (const m of migrations) {
    if (/create (or replace )?function public\.protect_sensitive_agency_member_fields/.test(m.text)) last = m;
  }
  assert.ok(last, 'אין הגדרה לטריגר');
  // מיגרציה מאוחרת שמעתיקה גוף ישן מוחקת נעילה בלי שגיאה, ולכן בודקים את האחרונה
  assert.match(last.text, /new\.is_mortgage_advisor := old\.is_mortgage_advisor/, `${last.f} אינה נועלת is_mortgage_advisor`);
  assert.equal(/new\.is_lawyer/.test(last.text.split(/create (or replace )?function public\.protect_sensitive_agency_member_fields/).pop()), false, 'is_lawyer הוסר');
  assert.match(accountsMig.text, /drop column if exists is_lawyer/);
});

test('הרכישה במסד: סוג, אישור, עיר ויתרה אמיתית', () => {
  const t = accountsMig.text;
  assert.match(t, /v_acct\.kind <> 'real_estate_lawyer' or v_acct\.shelf_enabled is not true/);
  assert.match(t, /v_lead\.city_id is not null and not exists/);
  assert.match(t, /returning credit_balance into v_balance/);
  assert.match(t, /revoke all on function public\.purchase_lawyer_lead\(uuid, uuid\) from public, anon, authenticated;/);
});

test('המדף נסגר לקהל ולעיר ב-view', () => {
  const view = accountsMig.text.match(/create or replace view public\.lawyer_leads_public as([\s\S]*?);/)[1];
  assert.match(view, /select public\.current_is_lawyer\(\)/);
  assert.match(view, /current_professional_works_city\(l\.city_id\)/);
  assert.match(view, /redact_contact_text\(l\.question, l\.full_name\)/);
  assert.match(view, /l\.status = 'new'/);
});

test('פונקציית הרכישה: JWT, MFA, חשבון בעל מקצוע, ופונקציית ה-DB היחידה', () => {
  assert.match(config, /\[functions\.lawyer-lead-purchase\]\s*verify_jwt = true/);
  assert.match(purchaseFn, /auth\.getUser\(\)/);
  assert.match(purchaseFn, /mfaGate/);
  assert.match(purchaseFn, /\.from\("professional_accounts"\)/);
  assert.match(purchaseFn, /rpc\("purchase_lawyer_lead"[\s\S]{0,80}p_account_id: account\.id/);
  assert.equal(/body\.(account_id|agent_id|p_account_id)/.test(purchaseFn), false, 'החשבון נגזר מה-JWT, לא מהגוף');
  assert.match(purchaseFn, /not_a_lawyer: 403/);
});

test('פתיחת חשבון: אסימון הכרטיסייה, בלי אישור מדף אוטומטי, וניקוי משתמש שנוצר חלקית', () => {
  assert.match(config, /\[functions\.professional-account\]\s*verify_jwt = false/);
  assert.match(accountFn, /from\("ad_placement_access"\)[\s\S]{0,80}eq\("manage_token", token\)/);
  // כתובת הכניסה היא זו שבכרטיסייה, לא כתובת מהגוף
  assert.match(accountFn, /card\.contact_email/);
  assert.equal(/shelf_enabled/.test(accountFn.replace(/\/\/.*$/gm, '').replace(/\*\*shelf_enabled[^\n]*/g, '')), false, 'האישור למדף אינו נקבע בפתיחה');
  assert.match(accountFn, /deleteUser\(authUser\.user\.id\)/);
  assert.match(accountFn, /terms_accepted !== true/);
  // manage_link: האסימון יוצא רק לפי JWT
  assert.match(accountFn, /action === "manage_link"[\s\S]{0,400}auth\.getUser\(\)/);
});

test('הדפים: הכרטיסייה מציעה חשבון רק לעורכי דין, והאזור האישי קורא מה-view הסגור', () => {
  assert.match(manageFn, /has_account: !!acct/);
  assert.match(manageHtml, /advertiser_type === 'real_estate_lawyer'/);
  assert.match(crmJs, /\.from\('lawyer_leads_public'\)/);
  assert.match(crmJs, /\/functions\/v1\/lawyer-lead-purchase/);
  assert.match(crmJs, /\.eq\('sold_to_professional_id', account\.id\)/);
  assert.match(crmJs, /account\.kind === 'real_estate_lawyer' && account\.shelf_enabled/);
  // כרטיס המדף מציג את השאלה אחרי הסתרת פרטים (question_text), לא את השאלה הגולמית
  const shelfRender = crmJs.slice(crmJs.indexOf('async function loadShelf'), crmJs.indexOf('async function loadBought'));
  assert.ok(shelfRender.includes('question_text'));
  assert.equal(/\bl\.question\b(?!_)/.test(shelfRender), false);
  // אישור הרכישה מציג מחיר ותנאים לפני החיוב
  assert.match(crmHtml, /הרכישה כפופה לתנאי השימוש והתקנון/);
  assert.match(crmHtml, /<meta name="robots" content="noindex, nofollow">/);
  // אזור אישי: לא נמדד כפניות של גולשים (events.js)
  assert.equal(/assets\/events\.js/.test(crmHtml), false);
});

test('מדף עורכי הדין אינו יושב ב-CRM של הסוכנים', () => {
  assert.equal(/lawyer/i.test(read('assets/crm.js').replace(/real_estate_lawyer:'עו״ד מקרקעין'/, '')), false);
  assert.equal(/lawyer/i.test(read('crm.html')), false);
});
