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

test('יומני הכסף שורדים מחיקת חשבון (set null, לא cascade)', () => {
  const t = accountsMig.text;
  assert.match(t, /account_id uuid references public\.professional_accounts\(id\) on delete set null/);
  assert.match(t, /professional_id uuid references public\.professional_accounts\(id\) on delete set null/);
});

test('הרכישה במסד: סוג, אישור, עיר ויתרה אמיתית', () => {
  const t = accountsMig.text;
  assert.match(t, /v_acct\.kind <> 'real_estate_lawyer'[\s\S]{0,120}not_a_lawyer/);
  assert.match(t, /v_acct\.shelf_enabled is not true[\s\S]{0,120}shelf_not_approved/);
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
  assert.match(purchaseFn, /shelf_not_approved: 403/);
});

test('פתיחת חשבון: אסימון הכרטיסייה, בלי אישור מדף אוטומטי, וניקוי משתמש שנוצר חלקית', () => {
  assert.match(config, /\[functions\.professional-account\]\s*verify_jwt = false/);
  assert.match(accountFn, /from\("ad_placement_access"\)[\s\S]{0,80}eq\("manage_token", token\)/);
  // כתובת הכניסה היא זו שבכרטיסייה, לא כתובת מהגוף
  assert.match(accountFn, /card\.contact_email/);
  assert.equal(/shelf_enabled/.test(accountFn.replace(/\/\/.*$/gm, '').replace(/\*\*shelf_enabled[^\n]*/g, '')), false, 'האישור למדף אינו נקבע בפתיחה');
  assert.match(accountFn, /deleteUser\(authUser\.user\.id\)/);
  assert.match(accountFn, /terms_accepted !== true/);
  // רק כרטיסיית בעל מקצוע חיה או ממתינה לאישור, ועיר רק בהתאמה יחידה
  assert.match(accountFn, /placement_type !== "professional_card"[\s\S]{0,120}"active", "pending_approval"/);
  assert.match(accountFn, /cities\.length === 1/);
  // manage_link: האסימון יוצא רק לפי JWT
  assert.match(accountFn, /action === "manage_link"[\s\S]{0,400}auth\.getUser\(\)/);
});

test('הדפים: הכרטיסייה מציעה חשבון רק לעורכי דין, והאזור האישי קורא מה-view הסגור', () => {
  assert.match(manageFn, /has_account: !!acct/);
  assert.match(manageHtml, /advertiser_type === 'real_estate_lawyer'/);
  assert.match(crmJs, /\.from\('lawyer_leads_public'\)/);
  assert.match(crmJs, /\/functions\/v1\/lawyer-lead-purchase/);
  assert.match(crmJs, /\.eq\('sold_to_professional_id', account\.id\)/);
  // מנהל/ת פלטפורמה רואה את כל החשבונות (policy): בלי סינון לפי המשתמש maybeSingle נכשל
  assert.match(crmJs, /\.from\('professional_accounts'\)[\s\S]{0,160}\.eq\('user_id', userId\)/);
  assert.match(crmJs, /account\.kind === 'real_estate_lawyer' && account\.shelf_enabled/);
  // כרטיס המדף מציג את השאלה אחרי הסתרת פרטים (question_text), לא את השאלה הגולמית
  const shelfRender = crmJs.slice(crmJs.indexOf('async function loadShelf'), crmJs.indexOf('async function loadBought'));
  assert.ok(shelfRender.includes('question_text'));
  assert.equal(/\bl\.question\b(?!_)/.test(shelfRender), false);
  // אישור הרכישה מציג מחיר ותנאים לפני החיוב
  assert.match(crmHtml, /הרכישה כפופה לתנאי השימוש והתקנון/);
  assert.match(crmHtml, /<meta name="robots" content="noindex, nofollow">/);
  // המניפסט של הסוכנים נפתח על /crm: אפליקציה מותקנת של עו"ד לא אמורה לפתוח אותו
  assert.match(crmHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  // אזור אישי: לא נמדד כפניות של גולשים (events.js)
  assert.equal(/assets\/events\.js/.test(crmHtml), false);
});

test('מדף עורכי הדין אינו יושב ב-CRM של הסוכנים', () => {
  assert.equal(/lawyer/i.test(read('assets/crm.js').replace(/real_estate_lawyer:'עו״ד מקרקעין'/, '')), false);
  assert.equal(/lawyer/i.test(read('crm.html')), false);
});

/* ---------- חיוב ישיר בכרטיס (lawyer_lead_orders) ---------- */
const orderMig = migrations.find((m) => m.f.endsWith('_lawyer_lead_card_orders.sql'));
const checkoutFn = read('supabase/functions/lawyer-lead-checkout/index.ts');
const callbackFn = read('supabase/functions/wallet-topup-callback/index.ts');

test('הזמנות הכרטיס: הטבלה סגורה לכתיבה, והפונקציות service_role בלבד', () => {
  assert.ok(orderMig, 'אין מיגרציית lawyer_lead_card_orders');
  const t = orderMig.text;
  assert.match(t, /revoke all on table public\.lawyer_lead_orders from public, anon, authenticated;\s*grant select on table public\.lawyer_lead_orders to authenticated;/);
  const policies = [...t.matchAll(/create policy "([^"]+)"\s+on public\.lawyer_lead_orders for (\w+)/g)];
  assert.ok(policies.length >= 1);
  for (const [, name, verb] of policies) assert.equal(verb, 'select', `policy "${name}" אינה קריאה בלבד`);
  for (const sig of [
    'start_lawyer_lead_order\\(uuid, uuid\\)',
    'complete_lawyer_lead_order\\(uuid, numeric, text, text, text\\)',
    'fail_lawyer_lead_order\\(uuid, text\\)',
    'purchase_lawyer_lead\\(uuid, uuid\\)',
  ]) {
    assert.match(t.replace(/\s+/g, ' '), new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated; grant execute on function public\\.${sig} to service_role;`), sig);
  }
  // רשומת החיוב שורדת מחיקת ליד וחשבון
  assert.match(t, /lead_id\s+uuid references public\.lawyer_leads\(id\) on delete set null/);
  assert.match(t, /professional_id\s+uuid references public\.professional_accounts\(id\) on delete set null/);
});

test('הליד שמור לאחר/ת: start, הארנק וה-view מכבדים את השמירה', () => {
  const t = orderMig.text;
  // start ו-purchase דוחות ליד שמור לאחר/ת
  assert.equal((t.match(/'error', 'lead_reserved'/g) || []).length, 2, 'start_lawyer_lead_order ו-purchase_lawyer_lead חייבות לדחות ליד שמור');
  // חסם על שמירות פתוחות
  assert.match(t, /v_open >= 3/);
  // ה-view: העמודה בסוף, והשומרים נשארים (check_shelf_audience בודק את האחרונה)
  assert.match(t, /create or replace view public\.lawyer_leads_public as[\s\S]*reserved_by_other[\s\S]*current_is_lawyer\(\)[\s\S]*current_professional_works_city/);
  assert.match(t, /where l\.status = 'new'/);
});

test('complete_lawyer_lead_order: משווה סכום, ושולם-בלי-ליד הוא refund_needed ולא מכירה כפולה', () => {
  const body = orderMig.text.split('create or replace function public.complete_lawyer_lead_order')[1].split('create or replace function public.fail_lawyer_lead_order')[0];
  assert.match(body, /p_verified_amount <> v_order\.amount/);
  // אי-התאמת סכום אחרי גבייה היא refund_needed (הכסף נגבה), לא failed שקט
  assert.match(body.split('p_verified_amount <> v_order.amount')[1].split('התשלום אומת')[0], /status = 'refund_needed'/);
  assert.equal(/status = 'failed'/.test(body), false, 'complete לעולם אינה מסמנת failed אחרי גבייה');
  assert.match(body, /for update/);
  for (const reason of ['lead_sold_to_other', 'already_owned', 'lead_reserved_by_other', 'lead_not_available', 'lead_deleted', 'account_deleted']) {
    assert.ok(body.includes(`'${reason}'`), `חסרה סיבה ${reason}`);
  }
  // בשורת הרכישה נרשם המחיר הנקוב ולא הסכום כולל מע"מ, כמו ברכישה מהארנק
  assert.match(body, /v_order\.amount_before_vat, 'success', 'card', p_order_id/);
  // הארנק אינו נוגע: זה חיוב בכרטיס
  assert.equal(/credit_balance/.test(body), false);
});

test('lawyer-lead-checkout: JWT ו-MFA, החשבון מה-JWT, הסכום מהמסד, פרטי פונה רק אחרי success', () => {
  assert.match(config, /\[functions\.lawyer-lead-checkout\]\s*\nverify_jwt = true/);
  assert.match(checkoutFn, /auth\.getUser\(\)/);
  assert.match(checkoutFn, /mfaGate\(authHeader\)/);
  assert.match(checkoutFn, /\.eq\("user_id", userData\.user\.id\)/);
  // הסכום נקבע ב-start_lawyer_lead_order. אין קריאה של amount/price מה-body
  assert.equal(/body\??\.(amount|price)/.test(checkoutFn), false);
  assert.match(checkoutFn, /amount: Number\(started\.amount\)/);
  // כתובות ההחזרה נושאות order_id בלבד, בלי אסימון
  assert.match(checkoutFn, /lead_payment=success&order_id=\$\{orderId\}/);
  assert.equal(/successUrl:[^\n]*token/i.test(checkoutFn), false);
  // הזמנה של אחר/ת נראית כלא קיימת, והפרטים רק ממצב success
  assert.match(checkoutFn, /order\.professional_id !== account\.id/);
  assert.match(checkoutFn, /if \(order\.status !== "success"\)/);
  // כישלון בפתיחת הטופס משחרר את הליד
  assert.match(checkoutFn, /fail_lawyer_lead_order/);
  // הפונקציה אינה סוגרת תשלום בעצמה
  assert.equal(/complete_lawyer_lead_order/.test(checkoutFn), false);
});

test('start: הזמנה פתוחה בחלון התשלום נמשכת (גם אחרי פקיעת השמירה), והשמירה מתחדשת', () => {
  const body = orderMig.text.split('create or replace function public.start_lawyer_lead_order')[1].split('create or replace function public.complete_lawyer_lead_order')[0];
  assert.match(body, /status = 'pending' and created_at > now\(\) - interval '180 minutes'/);
  assert.match(body, /update public\.lawyer_lead_orders set reserved_until = v_until/);
});

test('התראת ההחזר נשלחת שוב עד שיצאה (refund_alerted_at), וה-reconcile סורק אותה', () => {
  assert.match(orderMig.text, /refund_alerted_at\s+timestamptz/);
  assert.match(callbackFn, /\.eq\("status", "refund_needed"\)\s*\.is\("refund_alerted_at", null\)/);
  const alertTs = read('supabase/functions/_shared/platform-signup-alert.ts');
  assert.match(alertTs, /if \(sent\) \{[\s\S]*refund_alerted_at/);
});

test('ה-cron של ה-reconcile מכיר את lawyer_lead_orders (אחרת תשלום שאבד לא יתיישב)', () => {
  // ההגדרה האחרונה של wallet-topup-reconcile היא הקובעת
  let last = null;
  for (const m of migrations) if (m.text.includes("cron.schedule('wallet-topup-reconcile'")) last = m;
  assert.ok(last, 'אין תזמון reconcile');
  assert.match(last.text, /exists \(select 1 from public\.lawyer_lead_orders\s+where status = 'pending'\)/, `${last.f} אינה סורקת lawyer_lead_orders`);
  assert.match(last.text, /lawyer_lead_orders\s+where status = 'refund_needed' and refund_alerted_at is null/, `${last.f} אינה מעירה את ה-reconcile על החזר שלא הותרע`);
});

test('wallet-topup-callback: lawyer_lead הוא סוג, ו-refund_needed מתריע למנהל/ת', () => {
  assert.match(callbackFn, /lawyer_lead: \{\s*table: "lawyer_lead_orders",\s*complete: "complete_lawyer_lead_order",\s*fail: "fail_lawyer_lead_order"/);
  assert.match(callbackFn, /ALL_KINDS: OrderKind\[\] = \[[^\]]*"lawyer_lead"/);
  assert.match(callbackFn, /result\?\.error === "refund_needed"[\s\S]*announceLawyerLeadRefundNeeded/);
});

test('הדף: תשלום בכרטיס דרך lawyer-lead-checkout, ליד שמור לאחר/ת מסומן "בטיפול", וחזרה מהתשלום נשאלת בשרת', () => {
  assert.match(crmJs, /functions\/v1\/lawyer-lead-checkout/);
  assert.match(crmJs, /reserved_by_other/);
  assert.match(crmJs, /action: 'status', order_id: orderId/);
  assert.match(crmHtml, /id="buyCard"/);
  // אין "התשלום הצליח" לפי כתובת החזרה: ההצלחה נקבעת רק מתשובת השרת
  assert.match(crmJs, /data\.status === 'success'/);
});

/* ---------- קליטת "שאלה לעו"ד" עם אימות וואטסאפ ---------- */
const intakeMig = migrations.find((m) => m.f.endsWith('_lawyer_lead_intake.sql'));
const intakeFn = read('supabase/functions/lawyer-lead-intake/index.ts');
const waFile = read('supabase/functions/_shared/lawyer-lead-wa.ts');
const webhook = read('supabase/functions/whatsapp-webhook/index.ts');
const opsConfig = read('ops_agent/config.py');
const propertyHtml = read('property.html');
const propertyJs = read('assets/property.js');

test('הקליטה במסד: נייד ישראלי בלבד, נכס פעיל, ליד נכנס pending, ופונקציות service_role בלבד', () => {
  assert.ok(intakeMig, 'אין מיגרציית lawyer_lead_intake');
  const t = intakeMig.text;
  const submit = t.split('create or replace function public.lawyer_lead_submit')[1].split('create or replace function public.lawyer_lead_wa_verify')[0];
  assert.match(submit, /\^9725\[0-9\]\{8\}\$/, 'חסר נייד ישראלי');
  assert.match(submit, /p\.status = 'active'/, 'חסר נכס פעיל');
  assert.match(submit, /'pending'/);
  assert.equal(/status\s*=\s*'new'\s*,?\s*\n?\s*wa_verify/.test(submit), false, 'קליטה לא מעלה למדף');
  // בלם הצפה
  assert.match(submit, /v_n >= 5/);
  assert.match(submit, /v_n >= 20/);
  assert.match(submit, /v_n >= 200/);
  for (const sig of [
    'lawyer_lead_submit\\(uuid, text, text, text, text, text\\)',
    'lawyer_lead_wa_verify\\(text, text\\)',
    'lawyer_lead_verified\\(uuid\\)',
  ]) {
    assert.match(t.replace(/\s+/g, ' '), new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated; grant execute on function public\\.${sig} to service_role;`), sig);
  }
});

test('האימות: המספר שממנו נשלחה ההודעה הוא ההוכחה, והליד עולה למדף רק אחריו', () => {
  const verify = intakeMig.text.split('create or replace function public.lawyer_lead_wa_verify')[1].split('create or replace function public.lawyer_lead_verified')[0];
  // התאמה לפי הנייד (from של Meta), לא רק לפי הקוד
  assert.match(verify, /phone_e164 = p_from/);
  assert.match(verify, /wa_verify_requested_at > now\(\) - interval '30 minutes'/);
  assert.match(verify, /set status = 'new', phone_verified_at = now\(\), wa_verify_nonce = null/);
  // רישום ניתוב: אין עו"ד בעיר = unrouted עם סיבה, שמתריע למנהל/ת
  assert.match(verify, /'lawyer', 'lawyer_leads'/);
  assert.match(verify, /'no_lawyer_in_city'/);
});

test('ההתראה לסוכן/ת הנכס: מקושרת לנכס, ובלי שם, טלפון או שאלה (הם המוצר)', () => {
  const verify = intakeMig.text.split('create or replace function public.lawyer_lead_wa_verify')[1].split('create or replace function public.lawyer_lead_verified')[0];
  const notif = verify.split('insert into public.notifications')[1].split('end if;')[0];
  assert.match(notif, /related_property_id/);
  assert.match(notif, /v_lead\.property_id/);
  for (const forbidden of ['v_lead.full_name', 'v_lead.phone', 'v_lead.question', 'v_lead.email']) {
    assert.equal(notif.includes(forbidden), false, `ההתראה לסוכן/ת חושפת ${forbidden}`);
  }
});

test('data_retention_run מכסה את lawyer_leads, ולא כותבת לעמודה המחושבת', () => {
  const fn = intakeMig.text.split('create or replace function public.data_retention_run()')[1];
  assert.match(fn, /from public\.lawyer_leads/);
  const upd = fn.split('update public.lawyer_leads')[1].split(';')[0];
  assert.match(upd, /full_name = 'נמחק', phone = '', email = null/);
  assert.equal(/phone_e164/.test(upd), false, 'phone_e164 מחושבת (generated)');
  // question עם CHECK של 10 תווים: מוחלפת בטקסט ולא ב-null
  assert.match(upd, /question = '[^']{10,}'/);
});

test('רישום הניתוב מכיר ליד עו"ד (lead_kind ו-lead_table)', () => {
  assert.match(intakeMig.text, /lead_kind in \('agent_owner','agent_buyer','mortgage_advisor','lawyer'\)/);
  assert.match(intakeMig.text, /lead_table in \('leads','saved_searches','mortgage_leads','lawyer_leads'\)/);
});

test('lawyer-lead-intake: ציבורית עם בלם, ומחזירה רק "אומת" ב-status', () => {
  assert.match(config, /\[functions\.lawyer-lead-intake\]\s*\nverify_jwt = false/);
  assert.match(opsConfig, /"lawyer-lead-intake"/, 'חייבת להיות מוצהרת פומבית ב-PUBLIC_EDGE_FUNCTIONS');
  assert.match(intakeFn, /hashIp\(clientIp\(req\)/);
  assert.match(intakeFn, /MAX_BODY/);
  // status: מחזיר {verified} בלבד
  const status = intakeFn.split('body?.action === "status"')[1].split('body?.action !== "submit"')[0];
  assert.match(status, /return json\(\{ verified: data === true \}\)/);
  assert.equal(/full_name|phone|question/.test(status), false);
  // שגיאת מסד אינה מחזירה את הטקסט שלה לגולש/ת
  assert.equal(/detail:\s*error\.message/.test(intakeFn), false);
});

test('whatsapp-webhook תופס "אימות שאלה" לפני זיהוי הסוכן/ת', () => {
  const call = webhook.indexOf('handleLawyerLeadVerify(supabase');
  const agentLookup = webhook.indexOf('.eq("phone_e164", from)');
  assert.ok(call > 0, 'הוובהוק אינו קורא ל-handleLawyerLeadVerify');
  assert.ok(agentLookup > 0 && call < agentLookup, 'הקריאה חייבת לבוא לפני השאילתה על agency_members, אחרת הפונה מקבל/ת "איני מזהה את מספר הטלפון שלך"');
  assert.match(waFile, /אימות\\s\*שאלה/);
  assert.match(waFile, /lawyer_lead_wa_verify/);
});

test('הדף: הקישור לוואטסאפ מסווג כמספר האתר, וההצלחה נקבעת רק מתשובת השרת', () => {
  assert.match(propertyHtml, /id="lqWaBtn" data-site-contact/);
  assert.match(propertyJs, /functions\/v1\/lawyer-lead-intake/);
  assert.match(propertyJs, /action:'status', lead_id: leadId/);
  assert.match(propertyJs, /data\.verified === true\) lqShowDone/);
  // הדיסקליימרים בטופס
  assert.match(propertyHtml, /אינה יוצרת יחסי עורך דין-לקוח/);
  assert.match(propertyHtml, /אל תשלחו סיסמאות, פרטי תשלום או מסמכי זהות/);
  assert.match(propertyHtml, /הסוכן\/ת של הנכס יקבל\/תקבל הודעה/);
});
