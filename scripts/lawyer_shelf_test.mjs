/**
 * מדף עורכי הדין: החיווט בין המסד, פונקציית הרכישה וה-CRM.
 *
 * כל מה שנבדק כאן שקט כשהוא נשבר: מגירה שמוצגת למי שאינו/ה עו"ד אינה שגיאה, ודגל
 * שחדל להיות נעול מוכר שאלות של לקוחות לכל סוכן/ת שיחליט/תחליט לתת לעצמו/ה אותו.
 *
 *     node scripts/lawyer_shelf_test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const crmJs = read('assets/crm.js');
const crmHtml = read('crm.html');
const fn = read('supabase/functions/lawyer-lead-purchase/index.ts');
const config = read('supabase/config.toml');

test('הדגל is_lawyer נעול בהגדרה האחרונה של protect_sensitive_agency_member_fields', () => {
  const dir = join(root, 'supabase/migrations');
  let last = null;
  for (const f of readdirSync(dir).sort()) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (/create (or replace )?function public\.protect_sensitive_agency_member_fields/.test(text)) last = { f, text };
  }
  assert.ok(last, 'אין הגדרה לטריגר');
  // מיגרציה מאוחרת שמעתיקה גוף ישן מוחקת את הנעילה בלי שגיאה, ולכן בודקים את האחרונה
  assert.match(last.text, /new\.is_lawyer := old\.is_lawyer/, `${last.f} אינה נועלת is_lawyer`);
  assert.match(last.text, /new\.is_mortgage_advisor := old\.is_mortgage_advisor/, `${last.f} אינה נועלת is_mortgage_advisor`);
});

test('המגירה ב-CRM נפתחת רק ל-is_lawyer, והדגל נטען עם הסוכן/ת', () => {
  assert.match(crmJs, /is_mortgage_advisor, is_lawyer, phone/);
  assert.match(crmJs, /setShelfLawyerVisible\(agent\.is_lawyer\);\s*if \(agent\.is_lawyer\)\{\s*await loadLawyerShelf\(agent\.id\);/);
  assert.match(crmJs, /if \(tab === 'lawyer' && !shelfLawyerOpen\) return;/);
  // כפתור המגירה נולד מוסתר
  assert.match(crmHtml, /<button[^>]*data-shelf-tab="lawyer"[^>]*\bhidden\b/);
  assert.match(crmHtml, /data-shelf-pane="lawyer" hidden/);
});

test('המדף נקרא מה-view הסגור, והרכישה עוברת בפונקציית ה-Edge', () => {
  assert.match(crmJs, /\.from\('lawyer_leads_public'\)/);
  assert.equal(/\.from\('lawyer_leads'\)\s*\.select\([^)]*\)\s*\.eq\('status'/.test(crmJs), false, 'המדף אינו קורא מהטבלה');
  assert.match(crmJs, /\/functions\/v1\/lawyer-lead-purchase/);
  // הלידים שנרכשו נקראים מהטבלה, לפי sold_to_agent_id (ה-policy מגביל לקונה)
  assert.match(crmJs, /\.from\('lawyer_leads'\)[\s\S]{0,200}\.eq\('sold_to_agent_id', agentId\)/);
});

test('הרכישה: JWT, בדיקת is_lawyer, ופונקציית ה-DB היחידה', () => {
  assert.match(config, /\[functions\.lawyer-lead-purchase\]\s*verify_jwt = true/);
  assert.match(fn, /auth\.getUser\(\)/);
  assert.match(fn, /mfaGate/);
  assert.match(fn, /\.select\("id, active, is_lawyer"\)/);
  assert.match(fn, /rpc\("purchase_lawyer_lead"/);
  // הסוכן/ת נגזר מה-JWT, לא מה-body
  assert.equal(/body\.(agent_id|agentId|p_agent_id)/.test(fn), false);
  assert.match(fn, /not_a_lawyer: 403/);
});

test('החלון מציג את המחיר לפני החיוב, ושמות המשתמש בשאלה לא נשלחים לכרטיס בלי הסתרה', () => {
  assert.match(crmJs, /confirmPurchase\(\{\s*title: 'אישור רכישת שאלה לעו״ד'/);
  assert.match(crmJs, /price: lawyerLeadPrice/);
  // השאלה במדף היא question_text (אחרי redact_contact_text), לא question
  const shelfCard = crmJs.slice(crmJs.indexOf('function buildLawyerShelfCard'), crmJs.indexOf('async function loadPurchasedLawyerLeads'));
  assert.ok(shelfCard.includes('lead.question_text'));
  assert.equal(/lead\.question\b(?!_)/.test(shelfCard), false, 'כרטיס המדף אינו קורא את השאלה הגולמית');
});
