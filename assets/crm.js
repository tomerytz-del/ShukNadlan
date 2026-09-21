const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
const CLAIM_FUNCTION_URL = SUPABASE_URL + '/functions/v1/lead-claim';
const DEV_SWITCH_FUNCTION_URL = SUPABASE_URL + '/functions/v1/dev-switch-mode';
const GEOCODE_FUNCTION_URL = SUPABASE_URL + '/functions/v1/geocode-address';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const createAgencyScreen = document.getElementById('createAgencyScreen');
const toastEl = document.getElementById('toast');
let currentAgent = null;
const SUPPORT_EMAIL = 'support@shuknadlan.co.il'; // כתובת placeholder — תוקם בפועל בהמשך

function showToast(msg, ms=3200){
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> toastEl.style.display='none', ms);
}

/* ================= ערעור על חסימת רישיון תיווך =================
   ‏openLicenseAppeal נקראת מכל מקום שקיבל license_not_verified. שלושת
   המסלולים ב-CRM (פתיחת משרד, הוספה לצוות, בקשת שיוך) חולקים אותה, כי
   ההודעה והפעולה זהות.

   הקובץ נשלח כ-data URL בגוף ה-JSON ולא כהעלאה ישירה: הדלי broker-licenses
   פרטי ואין לדפדפן גישה אליו בכלל. ההעלאה נעשית בשרת, ב-service_role, אחרי
   בדיקת גודל וסוג. */
const LICENSE_APPEAL_URL = SUPABASE_URL + '/functions/v1/broker-license-appeal';
const MAX_APPEAL_BYTES = 5 * 1024 * 1024;

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload  = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

let licenseAppealCtx = null;

/**
 * @param {{license:string, detail?:string, name?:string, email?:string, source:string}} ctx
 */
function openLicenseAppeal(ctx){
  licenseAppealCtx = ctx;
  document.getElementById('laReason').textContent = ctx.detail || '';
  document.getElementById('laName').value  = ctx.name  || '';
  document.getElementById('laEmail').value = ctx.email || '';
  document.getElementById('laPhone').value = '';
  document.getElementById('laNote').value  = '';
  document.getElementById('laFile').value  = '';
  document.getElementById('laFeedback').textContent = '';
  const btn = document.getElementById('laSubmit');
  btn.disabled = false; btn.textContent = 'שליחת הצילום לבדיקה';
  document.getElementById('licenseAppealModal').style.display = 'flex';
}

document.getElementById('laCancel').addEventListener('click', ()=>{
  document.getElementById('licenseAppealModal').style.display = 'none';
});

document.getElementById('laSubmit').addEventListener('click', async ()=>{
  if (!licenseAppealCtx) return;
  const name  = document.getElementById('laName').value.trim();
  const email = document.getElementById('laEmail').value.trim();
  const phone = document.getElementById('laPhone').value.trim();
  const note  = document.getElementById('laNote').value.trim();
  const file  = document.getElementById('laFile').files[0];
  const fb    = document.getElementById('laFeedback');
  const btn   = document.getElementById('laSubmit');

  const fail = (msg) => { fb.style.color = 'var(--brick)'; fb.textContent = msg; };

  if (!name || !email) return fail('נא למלא שם מלא ואימייל');
  if (!file)           return fail('נא לצרף צילום של הרישיון');
  if (file.size > MAX_APPEAL_BYTES) return fail('הקובץ גדול מ-5MB. אפשר לצלם מחדש או לדחוס.');

  btn.disabled = true; btn.textContent = 'שולח…'; fb.textContent = '';
  try{
    const res = await fetch(LICENSE_APPEAL_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({
        action: 'submit',
        license_number: licenseAppealCtx.license,
        applicant_name: name,
        applicant_email: email,
        applicant_phone: phone || null,
        note: note || null,
        source: licenseAppealCtx.source,
        document: await readAsDataUrl(file),
      }),
    });
    const data = await res.json();

    // ‏already_pending ו-already_approved אינם כישלון אלא התשובה עצמה.
    if (data.status === 'received' || data.status === 'already_pending' || data.status === 'already_approved'){
      document.getElementById('licenseAppealModal').style.display = 'none';
      showToast(data.detail || 'הצילום התקבל', 6000);
      return;
    }
    fail(data.detail || ('שגיאה: ' + (data.error || 'לא ידועה')));
    btn.disabled = false; btn.textContent = 'שליחת הצילום לבדיקה';
  } catch(err){
    console.error(err);
    fail('שגיאת רשת - נסו שוב');
    btn.disabled = false; btn.textContent = 'שליחת הצילום לבדיקה';
  }
});

/* ---------- Accordion sections ----------
   כל נושא בדשבורד הוא <details class="acc"> מקופל. מצב הפתיחה נשמר ב-localStorage
   כדי שהסוכן/ת יחזרו לאותה תצוגה, ו-openAcc() פותח קטגוריה כשמגיעים אליה מקישור
   (התראה על ליד, עריכת נכס) כדי שהתוכן לא "ייעלם" בתוך קטגוריה סגורה. */
const ACC_STATE_KEY = 'crmAccordionState';

function accReadState(){
  try{ return JSON.parse(localStorage.getItem(ACC_STATE_KEY) || '{}'); }
  catch(e){ return {}; }
}

function accWriteState(state){
  try{ localStorage.setItem(ACC_STATE_KEY, JSON.stringify(state)); }catch(e){}
}

function accSetCount(accId, value){
  const el = document.getElementById(accId + 'Count');
  if (el) el.textContent = (value === 0 || value == null || value === '') ? '' : String(value);
  // המונה נשמר גם כמספר, כי חלק מהקטגוריות מציגות אותו כטקסט ("₪1,240"
  // בארנק). הניווט ובלוק "דורש טיפול מיידי" צריכים לדעת רק כמה יש כאן.
  accCounts[accId] = (typeof value === 'number') ? value
    : Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
  refreshNavCounts();
}

/* שורת הסיכום שמתחת לשם הקטגוריה. בניגוד ל-accSetCount היא טקסט בלבד ולא
   נכנסת ל-accCounts: היא מספרת מה יש שם, לא כמה דחוף. קטגוריה בלי סיכום
   פשוט לא מקבלת שורה (‏.acc-sum:empty). */
function accSetSummary(accId, text){
  const el = document.getElementById(accId + 'Sum');
  if (el) el.textContent = text || '';
}

/* טווח מחירים לשורת סיכום. שני קצוות ולא ממוצע: מה שסוכן/ת צריך/ה לדעת
   בלי לפתוח הוא אם יש כאן משהו בתקציב שלו/ה. */
function priceRangeLabel(values){
  const nums = (values || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return '';
  return compactRange(Math.min(...nums), Math.max(...nums));
}

/* עברית מבחינה בין יחיד לרבים, ולכן "1 התאמות" ו-"1 נכסים נפתחו" נכתבים
   בדיוק בשורות שנועדו להיקרא במבט — ונראים שם כמו תקלה בנתון ולא כמו
   ניסוח. ‏plural() הוא הניסוח היחיד לספירה כזו, כדי שהשורה, הגלולה
   והכרטיס לא יתפצלו שוב: מי שמתקן במקום אחד מתקן בכולם.
   ‏1.5 נשאר רבים ("1.5 חדרים"), כי רק 1 בדיוק הוא יחיד. */
function plural(n, one, many, countText){
  return n === 1 ? one : (countText === undefined ? n : countText) + ' ' + many;
}

/* טווח מקוצר, עם סימן המטבע והיחידה פעם אחת: "₪1–1.2 מ׳" ולא
   "₪1 מ׳–₪1.2 מ׳". שני מחירים מלאים בשורה קצרה נקראים כשני מחירים
   נפרדים ולא כטווח — וברוחב טלפון הם גם מה שדוחק את שאר השורה החוצה.
   קצוות ביחידות שונות ("₪900 א׳–₪1.2 מ׳") נשארים מלאים: שם היחידה היא
   חלק מהמספר ולא חזרה עליו. */
function compactRange(min, max){
  const low = shekelCompact(min), high = shekelCompact(max);
  if (low === high) return low;
  const unitOf = s => (/ (?:מ׳|א׳)$/.exec(s) || [''])[0];
  const unit = unitOf(low);
  if (unit !== unitOf(high)) return low + '-' + high;
  // ‏slice(1) מוריד את ה-₪ מהקצה השני; היחידה נשארת עליו, בסוף הטווח
  return (unit ? low.slice(0, low.length - unit.length) : low) + '-' + high.slice(1);
}

/* הערך השכיח ברשימה — האזור/העיר שמייצג/ת את הרשימה בשורה אחת */
function topValue(values){
  const counts = {};
  (values || []).filter(Boolean).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries[0][0] : '';
}

function openAcc(accId){
  const el = document.getElementById(accId);
  if (!el) return null;
  if (!el.open){
    el.open = true;
    const state = accReadState();
    state[accId] = true;
    accWriteState(state);
  }
  return el;
}

function initAccordions(){
  const state = accReadState();
  document.querySelectorAll('#dashboard details.acc').forEach(acc=>{
    if (Object.prototype.hasOwnProperty.call(state, acc.id)) acc.open = !!state[acc.id];
    acc.addEventListener('toggle', ()=>{
      const s = accReadState();
      s[acc.id] = acc.open;
      accWriteState(s);
      // Leaflet מחשב את גודל המפה בזמן היצירה — אם היא נוצרה בזמן שהקטגוריה
      // הייתה סגורה (רוחב 0), צריך לרענן את המידות ברגע הפתיחה.
      if (acc.open && acc.id === 'accPlanning' && planningMap) planningMap.invalidateSize();
    });
  });
}
initAccordions();

/* ---------- שני הדשבורדים המכווצים ----------
   כל ‏.dash-panel נפתח ונסגר בלחיצה על הכותרת שלו, ומתחיל מכווץ לחצי מהגובה
   הטבעי של התוכן. הגובה נמדד ולא מקובע: התוכן של הדשבורד האישי משתנה לפי
   המסלול והתפקיד, ושל דשבורד הפלטפורמה לפי הנתונים שחזרו — max-height קבוע
   ב-CSS היה חותך אצל אחד ומשאיר חלל ריק אצל השני.

   ‏max-height (ולא height/hidden) כדי שהמעבר יהיה מונפש, ו-overflow:hidden
   על ‏.dp-body דואג שהתוכן החתוך לא ייתפס לגלילה או ל-Tab. */
const DASH_PANEL_KEY = 'crmDashPanels';

function dashPanelState(){
  try{ return JSON.parse(localStorage.getItem(DASH_PANEL_KEY) || '{}'); }
  catch(e){ return {}; }
}

/* מדידה אחת לכל פאנל. נקראת גם בטעינת הדשבורד וגם מ-ResizeObserver, כי
   פאנל שנמדד בזמן ש-#dashboard עדיין display:none מקבל 0 — וחצי מאפס הוא
   פאנל שנראה שבור. */
function dashPanelsMeasure(){
  document.querySelectorAll('#dashboard .dash-panel').forEach(panel=>{
    const inner = panel.querySelector('.dp-inner');
    if (!inner) return;
    const full = inner.scrollHeight;
    if (!full) return;
    panel.style.setProperty('--dp-full', full + 'px');
    // חצי מהגובה — עם רצפה ותקרה, ושתיהן זהות לשני הפאנלים כדי ששניהם
    // ייראו מכווצים באותה מידה. בלי התקרה, "חצי" נגזר מהתוכן: הכרטיס הכחול
    // לבדו גבוה ~350px במסך טלפון, וחצי מהפאנל האישי (מעל 600px) מילא מסך
    // שלם — בעוד שדשבורד הפלטפורמה, שצפוף הרבה יותר, נראה קומפקטי באותו
    // חישוב בדיוק. הרצפה (150px) שומרת שהצצה לא תהיה פס דק חסר משמעות.
    const cap = Math.max(170, Math.min(300, Math.round(window.innerHeight * 0.34)));
    panel.style.setProperty('--dp-peek',
      Math.max(150, Math.min(Math.round(full / 2), cap)) + 'px');
  });
}
// שינוי גובה החלון מזיז את התקרה, ו-ResizeObserver על התוכן לא מרגיש בזה
window.addEventListener('resize', dashPanelsMeasure);

function dashPanelSetOpen(panel, open, persist){
  panel.classList.toggle('is-open', open);
  const head = panel.querySelector('.dp-head');
  if (head){
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    const label = head.querySelector('.dp-toggle-label');
    if (label) label.textContent = open ? 'כיווץ' : 'הרחבה';
  }
  if (!persist) return;
  const state = dashPanelState();
  state[panel.id] = open;
  try{ localStorage.setItem(DASH_PANEL_KEY, JSON.stringify(state)); }catch(e){}
}

function initDashPanels(){
  const state = dashPanelState();
  document.querySelectorAll('#dashboard .dash-panel').forEach(panel=>{
    const head = panel.querySelector('.dp-head');
    const inner = panel.querySelector('.dp-inner');
    if (!head || !inner) return;
    // ברירת המחדל היא מכווץ; מי שפתח/ה בביקור קודם חוזר/ת לפתוח
    dashPanelSetOpen(panel, !!state[panel.id], false);
    head.addEventListener('click', ()=>{
      dashPanelsMeasure();
      dashPanelSetOpen(panel, !panel.classList.contains('is-open'), true);
    });
    if (window.ResizeObserver){
      new ResizeObserver(dashPanelsMeasure).observe(inner);
    }
  });
  dashPanelsMeasure();
}
initDashPanels();

/* ---------- Pricing config ----------
   המחירים יושבים ב-pricing_config ב-DB (עם policy קריאה פומבית) ולא מקודדים
   כאן, כדי שדיאלוג האישור יציג בדיוק את הסכום שהשרת עומד לגבות.          */
let pricingConfig = {};
async function loadPricing(){
  const { data } = await sb.from('pricing_config').select('key, value');
  pricingConfig = Object.fromEntries((data||[]).map(r => [r.key, Number(r.value)]));
}
function priceOf(key, fallback){
  const v = pricingConfig[key];
  return (v === undefined || v === null || Number.isNaN(v)) ? fallback : v;
}

/* ---------- צד הליד ----------
   מוכר/משכיר (בעל/ת הנכס) מול קונה/שוכר (מתעניין/ת). מחזיר את התגית שמוצגת
   בראש הכרטיס ואת מחלקת הצבע של הרקע — אותה שפה בלידים הפנימיים ובמדף. */
function leadKind(lead){
  const rent = lead.deal_type === 'rent';
  if (lead.lead_type === 'owner_inbound'){
    return { cls:'kind-owner', icon:'🔑', label: rent ? 'ליד משכיר · בעל/ת נכס' : 'ליד מוכר · בעל/ת נכס' };
  }
  if (lead.lead_type === 'agent_direct_inquiry'){
    return { cls:'kind-buyer', icon:'✉️', label:'פנייה ישירה · מתעניין/ת' };
  }
  /* בקשת הדמיה — אותו שם שבו קוראת לה תצוגת מנהל/ת הפלטפורמה
     (`ADM_LEAD_TYPES`), ולא שם רביעי לאותו דבר.

     בלי הענף הזה הליד נפל לברירת המחדל והוצג כ"ליד שוכר/קונה". הצד היה
     נכון — הפונה הוא/היא צד הביקוש, ולכן גם כאן `kind-buyer` והתמחור
     ב-`claimCost()` לא משתנה — אבל מה שמייחד את הליד נעלם, והוא בדיוק מה
     שפותח את השיחה: הוא/היא כבר ראה/תה את המקום הזה כעסק או כבית.

     מה בדיוק ההדמיה הראתה — עסק וסוגו, הלבשת בית או נכס פרטי — יושב ב-
     `property_details` (נכתב ב-`property-visualize`) ומוצג בכרטיס. */
  if (lead.lead_type === 'visualization'){
    return { cls:'kind-buyer', icon:'🎨', label:'בקשת הדמיה · מתעניין/ת' };
  }
  return { cls:'kind-buyer', icon:'🔎', label: rent ? 'ליד שוכר · מתעניין/ת' : 'ליד קונה · מתעניין/ת' };
}

// במדף ה-RSS הצד מגיע כטקסט מהסיווג של Claude, לא כ-lead_type
const SHELF_KIND = {
  'מוכר פרטי': { cls:'kind-owner', icon:'🔑' },
  'משכיר':     { cls:'kind-owner', icon:'🔑' },
  'קונה פרטי': { cls:'kind-buyer', icon:'🔎' },
  'שוכר':      { cls:'kind-buyer', icon:'🔎' },
};
function shelfKind(side){
  const k = SHELF_KIND[side] || { cls:'kind-buyer', icon:'•' };
  return { ...k, label: (side || 'ליד') + (k.cls === 'kind-owner' ? ' · בעל/ת נכס' : ' · מתעניין/ת') };
}

/* ---------- דיאלוג אישור רכישה ----------
   כל פעולה שמוציאה כסף מהארנק עוברת כאן. הסכום מוצג בגדול, ונדרש סימון
   מפורש של "אני מבין/ה שזו רכישה" לפני שכפתור החיוב נדלק — הקריאה לשרת
   יוצאת רק אחרי לחיצה עליו. השורה הראשונה ב-lines היא הכותרת המודגשת.

   ‏requireAck ו-hidePrice מרחיבים אותו לפעולות שאינן רכישה אבל דורשות בדיוק
   את אותו "אישרתי שוב שאני בטוח/ה" — ניתוק סוכן/ת מהמשרד הוא כזה. תיבת
   הסימון היא מה שהופך לחיצה מהירה להחלטה, ולכן עדיף להשתמש בדיאלוג הקיים
   מאשר לשרשר שני confirm() של הדפדפן זה אחרי זה. */
/* ---------- יתרת הארנק ----------
   מספר אחד בשלושה מקומות (פס המדדים, כותרת קטגוריית הארנק ודיאלוג הרכישה),
   ולכן כתיבה אחת: כל מי שמעדכן יתרה עובר דרך כאן ולא מרענן חצי מסך.        */
function setAgentBalance(value){
  const n = Number(value) || 0;
  if (currentAgent) currentAgent.credit_balance = n;
  const el = document.getElementById('creditBalance');
  if (el) el.textContent = shekel(n);
  accSetCount('accWallet', shekel(n));
  return n;
}

/* היתרה שעל המסך מתיישנת אחרי כל רכישה, וברגע שמציגים אותה לפני חיוב היא
   חייבת להיות אמיתית. השאילתה היא שורה אחת, והחלון כבר פתוח בזמן שהיא רצה —
   לכן היא לא מעכבת כלום. נכשלה? נשארים עם מה שידוע, בלי להיתקע. */

/* כמה צריך לטעון כדי שהרכישה תעבור. הטעינות הן בקפיצות של 100, ולכן זו
   העלייה לסכום המותר הקרוב ביותר שמכסה את החוסר — לא החוסר עצמו.
   מחזירה null כשיש כיסוי.

   ‏gap גדול מ-500 אינו אפשרי היום (הפריט היקר ביותר הוא ₪350), אבל אם ייווצר
   כזה עדיף להציע את המקסימום מאשר להחזיר undefined ולשבור את הכפתור. */
const TOPUP_AMOUNTS = [100, 200, 300, 400, 500];
function topupNeeded(balance, price){
  const gap = Number(price) - Number(balance);
  if (!(gap > 0)) return null;
  return TOPUP_AMOUNTS.find(a => a >= gap) || TOPUP_AMOUNTS[TOPUP_AMOUNTS.length - 1];
}

async function refreshAgentBalance(){
  if (!currentAgent) return 0;
  const { data, error } = await sb.from('agency_members')
    .select('credit_balance').eq('id', currentAgent.id).single();
  if (error || !data) return Number(currentAgent.credit_balance) || 0;
  return setAgentBalance(data.credit_balance);
}

function confirmPurchase({ title, lines = [], price = 0, ackText, confirmLabel, requireAck = false, hidePrice = false }){
  const overlay   = document.getElementById('purchaseModal');
  const ackBox    = document.getElementById('pmAck');
  const ackWrap   = document.getElementById('pmAckWrap');
  const confirmBtn= document.getElementById('pmConfirm');
  const cancelBtn = document.getElementById('pmCancel');
  const priceEl   = document.getElementById('pmPrice');
  const walletEl  = document.getElementById('pmWallet');
  const topupBtn  = document.getElementById('pmWalletTopup');
  const noteEl    = document.getElementById('pmWalletNote');
  const paid = Number(price) > 0;
  const needAck = paid || requireAck;      // מה שמדליק את כפתור האישור
  const showWallet = paid && !hidePrice;
  let enough = true;                       // מתעדכן כשהיתרה האמיתית חוזרת

  document.getElementById('pmTitle').textContent = title;
  document.getElementById('pmBody').innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join('');
  priceEl.textContent = paid ? `לחיוב עכשיו: ${shekel(price)} מיתרת הארנק` : 'ללא עלות - לא ייגבה תשלום';
  priceEl.className = 'pm-price' + (paid ? '' : ' free');
  priceEl.style.display = hidePrice ? 'none' : '';
  document.getElementById('pmAckText').textContent = ackText ||
    `אני מבין/ה שזו רכישה, ושאישור הפעולה יחייב את הארנק שלי ב-${shekel(price)}.`;

  ackWrap.style.display = needAck ? 'flex' : 'none';
  ackBox.checked = false;
  confirmBtn.textContent = confirmLabel || (paid ? `אישור רכישה וחיוב ${shekel(price)}` : 'אישור');
  confirmBtn.disabled = needAck;           // נדלק רק אחרי סימון ה"אני מבין/ה"

  /* היתרה מצוירת פעמיים: מיד מהערך שביד, כדי שהחלון לא ייפתח על מקף, ושוב
     כשהקריאה לשרת חוזרת. אין כיסוי — הכפתור נחסם וההצעה היא לטעון. */
  function paintWallet(balance){
    const after = balance - Number(price);
    enough = after >= 0;
    document.getElementById('pmWalletNow').textContent   = shekel(balance);
    // אין כיסוי? השורה מודדת את החוסר ולא מציגה "₪0" שנשמע כמו יתרה
    document.getElementById('pmWalletAfter').textContent =
      enough ? shekel(after) : `חסרים ${shekel(Math.abs(after))}`;
    walletEl.classList.toggle('is-short', !enough);
    noteEl.hidden = enough;
    /* החוסר מתורגם לסכום טעינה קונקרטי, וכך גם הכפתור. הניסוח הקודם —
       "טענו את הארנק וחזרו לרכישה" — הטיל על הסוכן/ת לחשב כמה חסר, לנווט
       לקטגוריה אחרת, לבחור סכום, ולזכור לחזור. */
    if (!enough){
      const need = topupNeeded(balance, price);
      noteEl.textContent = `חסרים ${shekel(Math.abs(after))}. טעינה של ${shekel(need)} תכסה את הרכישה.`;
      topupBtn.textContent = `טעינה מהירה של ${shekel(need)} ←`;
    } else {
      topupBtn.textContent = 'טעינת הארנק ←';
    }
    syncConfirm();
  }

  function syncConfirm(){
    confirmBtn.disabled = (needAck && !ackBox.checked) || (showWallet && !enough);
  }

  walletEl.hidden = !showWallet;
  if (showWallet){
    paintWallet(Number(currentAgent && currentAgent.credit_balance) || 0);
    refreshAgentBalance().then(balance => {
      // החלון אולי כבר נסגר בינתיים — אז אין למי לצייר
      if (overlay.style.display !== 'none') paintWallet(balance);
    });
  }

  overlay.style.display = 'flex';

  return new Promise(resolve => {
    const onAck     = ()=> syncConfirm();
    const onConfirm = ()=> { if (!confirmBtn.disabled) done(true); };
    const onCancel  = ()=> done(false);
    const onKey     = (e)=> { if (e.key === 'Escape') done(false); };
    const onBackdrop= (e)=> { if (e.target === overlay) done(false); };
    /* ---------- טעינה מהירה ----------
       הכפתור טוען את הסכום שחסר בדיוק, בלי לעזוב את הרכישה.

       שני מסלולים, לפי מה שהשרת מחזיר:

       ‏redirect_url  — סליקה אמיתית. יציאה לעמוד התשלום היא בלתי נמנעת (שם
                       נמסרים פרטי הכרטיס), ולכן שומרים לאן לחזור וממשיכים.
       אין redirect  — מצב בדיקה. הזיכוי כבר קרה, ולכן **נשארים בדיאלוג**,
                       מרעננים את היתרה ומציירים מחדש. הרכישה ממשיכה מהמקום
                       שבו נעצרה.

       נפילה חזרה לקטגוריית הארנק נשמרת לשגיאות: עדיף מסלול ארוך שעובד על
       פני הודעת שגיאה שמשאירה את הסוכן/ת בלי מוצא. */
    /* גם הטעינה המהירה עוברת ב-checkout.html, מאותה סיבה שהכפתור בקטגוריית
       הארנק עובר בו: אין חיוב באתר בלי פרטי חשבונית ובלי אישור תקנון. מה
       שהיה כאן "לחיצה אחת עד מורנינג" הוא עכשיו לחיצה אחת עד עמוד התשלום,
       עם הסכום שחסר כבר בחירה מראש. */
    const onTopup = ()=>{
      const balance = Number(currentAgent && currentAgent.credit_balance) || 0;
      const need = topupNeeded(balance, price);
      if (!need){ done(false); gotoSection('accWallet', 'topupAmount'); return; }
      done(false);
      location.href = 'checkout.html?product=wallet&amount=' + encodeURIComponent(need);
    };

    function done(value){
      ackBox.removeEventListener('change', onAck);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      topupBtn.removeEventListener('click', onTopup);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      overlay.style.display = 'none';
      resolve(value);
    }

    ackBox.addEventListener('change', onAck);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    topupBtn.addEventListener('click', onTopup);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    (paid ? ackBox : confirmBtn).focus();
  });
}

/* ---------- ניהול מסכים ----------
   כל המסכים של הדף (המתנה / כניסה / פתיחת משרד / שגיאת טעינה / דשבורד) חיים
   באותו קובץ, והמעבר ביניהם עובר דרך פונקציה אחת: מה שנדלק כאן מכבה את כל
   השאר. קודם כל מסך כיבה והדליק display בעצמו, ומספיק היה לשכוח מסך אחד כדי
   ששניים יוצגו יחד או שאף אחד לא יוצג — זה מקור לא קטן ל"קפיצות" במסך. */
const SCREEN_CARDS = {
  boot:         'bootCard',
  login:        'loginCardMain',
  identify:     'identifyScreen',
  claimPending: 'claimPendingScreen',
  released:     'releasedScreen',
  closed:       'closedScreen',
  createAgency: 'createAgencyScreen',
  loadError:    'loadErrorScreen',
  ethicsGate:   'ethicsGateScreen',
  tierGate:     'tierGateScreen',
};

function showScreen(name){
  const onDashboard = name === 'dashboard';
  dashboard.style.display = onDashboard ? 'block' : 'none';
  document.body.classList.toggle('dash-active', onDashboard);
  // הרקע הזורם שייך לדשבורד בלבד: מסכי הכניסה ופתיחת המשרד ממשיכים על
  // פלטת הנייר. ‏PageBg מגיע מ-assets/page-bg.js — אותו רקע של האתר.
  if (window.PageBg) onDashboard ? PageBg.mount() : PageBg.unmount();
  loginScreen.style.display = onDashboard ? 'none' : 'flex';
  for (const [key, id] of Object.entries(SCREEN_CARDS)){
    const el = document.getElementById(id);
    if (el) el.style.display = (key === name) ? 'block' : 'none';
  }
  // תפריט הבדיקה שייך לדשבורד בלבד; renderDevMenu() מדליק אותו מחדש בעת הצורך
  if (!onDashboard) document.getElementById('devMenu').style.display = 'none';
  // הסרגל התחתון הוא position:fixed, ובלי זה הוא היה נשאר על מסך הכניסה
  const bnav = document.getElementById('bottomNav');
  if (bnav) bnav.hidden = !onDashboard || dashView === 'admin';
  // ה-FAB של ההחתמה הוא position:fixed מאותה סיבה בדיוק, ויורד מכאן איתו
  updateScrollUi();
  // הפאנלים המכווצים נמדדים רק כשהם באמת על המסך: אלמנט בתוך display:none
  // מחזיר scrollHeight אפס, וחצי מאפס אינו חצי
  if (onDashboard) requestAnimationFrame(dashPanelsMeasure);
}

/* הודעה שממתינה למסך הכניסה. נחוצה כי כשחוזרים מ-Google עם שגיאה, המסך שמוצג
   בסוף הוא מסך הכניסה — ובלי זה הסוכן/ת פשוט "מוצא/ת את עצמו/ה" מול טופס
   הסיסמה בלי שום הסבר למה ההתחברות לא עבדה. */
let pendingAuthMessage = '';

function showLoginCard(message){
  clearTimeout(bootWatchdog);
  cleanAuthParamsFromUrl();
  const alreadyOnLogin = document.getElementById('loginCardMain').style.display === 'block';
  const text = message || pendingAuthMessage;
  pendingAuthMessage = '';
  // הגעה למסך ממסך אחר מנקה הודעה ישנה; קריאה חוזרת כשכבר עומדים כאן (המאזין
  // ו-boot() יכולים שניהם להגיע לכאן על אותה טעינה) לא מוחקת הודעה שכבר מוצגת
  if (text || !alreadyOnLogin) document.getElementById('loginError').textContent = text || '';
  // בלי הבאנר, מי שלחץ/ה על קישור ההזמנה רואה מסך כניסה סתמי ואין לו/ה שום
  // דרך לדעת שהקישור נקלט ושההצטרפות תושלם מיד אחרי ההתחברות.
  const invited = !!readInviteToken();
  const banner = document.getElementById('inviteBanner');
  const openingAgency = !invited && readNewAgencyIntent();
  // אותו באנר, שני נוסחים. מי שבא/ה מ"פתיחת משרד עם Google" צריך/ה לדעת
  // שהוא/היא במקום הנכון — מסך כניסה סתמי נראה כמו טעות בניווט. הנוסח נכתב
  // בכל קריאה ולא רק בענף החדש, אחרת הראשון שנכתב נשאר לתמיד.
  banner.textContent = openingAgency
    ? '🏢 פתיחת משרד תיווך - מתחברים עם Google, וטופס פתיחת המשרד ייפתח מיד אחרי.'
    : '✉️ הוזמנת להצטרף לצוות משרד. אפשר להיכנס עם Google, או ליצור כאן חשבון עם אימייל וסיסמה - והחיבור לכרטיס ייעשה אוטומטית.';
  banner.style.display = (invited || openingAgency) ? 'block' : 'none';
  // יצירת החשבון נפתחת רק למי שבאמת הוזמן/ה. זו לא "הרשמה לאתר": חשבון בלי
  // כרטיס ממתין במשרד לא יוביל לשום מקום מלבד מסך "מי את/ה?".
  document.getElementById('inviteSignup').style.display = invited ? 'block' : 'none';
  resetGoogleButton();
  showScreen('login');
}

function showBootCard(message){
  document.getElementById('bootMessage').textContent = message;
  showScreen('boot');
}

/* ---------- ניקוי תשובת Google מהכתובת ----------
   Google מחזיר את התשובה בכתובת עצמה: בהצלחה כ-#access_token=… (או ?code=…),
   בכישלון כ-error/error_description. supabase-js קורא אותה בעצמו בזמן האתחול,
   ומרגע שסיים היא חייבת לרדת מהכתובת — אחרת האסימון נשאר בהיסטוריית הדפדפן,
   ורענון או "חזור" מנסים לעבד שוב תשובה שכבר נוצלה ומחזירים את המשתמש/ת
   למסך הכניסה. הקריאה לפונקציה נעשית רק אחרי שה-session בידינו. */
const AUTH_HASH_KEYS  = ['access_token','refresh_token','provider_token','provider_refresh_token','expires_in','expires_at','token_type','error','error_code','error_description'];
// ‏invite ו-tier נכללים בניקוי מאותה סיבה כמו האסימונים: שניהם נקראים פעם אחת
// ל-sessionStorage (למטה), ומרגע שנוצלו אין סיבה שיישארו בהיסטוריה ובשיתוף.
const AUTH_QUERY_KEYS = ['code','state','error','error_code','error_description','invite','tier','new_agency'];

/* ---------- אסימון ההזמנה ----------
   נקרא בטעינת הדף לפני כל ניקוי, ונשמר ב-sessionStorage ולא רק במשתנה: מי
   שמגיע/ה מקישור ההזמנה כמעט תמיד עדיין לא מחובר/ת, וההתחברות עם Google
   טוענת את הדף מחדש עם redirectTo שהוא origin+pathname בלבד — כלומר בלי
   ה-query. בלי השמירה, כל הזמנה שנפתחה במסלול Google הייתה מתאדה בדיוק
   ברגע שהיא נדרשת. הניקוי נעשה מיד כשהאסימון נוצל. */
const INVITE_STORE_KEY = 'shuknadlan.invite_token';

function readInviteToken(){
  try{
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    if (fromUrl){ sessionStorage.setItem(INVITE_STORE_KEY, fromUrl); return fromUrl; }
    return sessionStorage.getItem(INVITE_STORE_KEY) || '';
  } catch(_){
    // גלישה פרטית חוסמת sessionStorage; ההזמנה עדיין תעבוד בכניסה עם סיסמה,
    // שאינה עוזבת את הדף
    try { return new URLSearchParams(window.location.search).get('invite') || ''; }
    catch(__){ return ''; }
  }
}
function clearInviteToken(){
  try { sessionStorage.removeItem(INVITE_STORE_KEY); } catch(_){ /* ראו למעלה */ }
}

// קריאה מיידית בטעינת הדף, ובכוונה כאן ולא בשימוש הראשון: 'invite' נמצא
// ברשימת המפתחות שמנוקים מהכתובת, ו-cleanAuthParamsFromUrl() רצה כבר בדרך
// למסך הכניסה. בלי ההעברה הזו ל-sessionStorage לפניה, כל הזמנה שנפתחה בחשבון
// לא מחובר הייתה נמחקת מהכתובת לפני שמישהו הספיק לקרוא אותה.
readInviteToken();

/* ---------- המסלול שנבחר בדף המסלולים ----------
   אותו סיפור בדיוק כמו אסימון ההזמנה, ומאותה סיבה: ‏pricing.html מחזיר/ה
   לכאן עם ‎?tier=premium‎, וברוב המקרים הכניסה שאחרי היא Google — שטוענת את
   הדף מחדש בלי ה-query. בלי השמירה, כל מי שנכנס/ת עם Google היה/הייתה מגיע/ה
   לשער הבחירה בלי שהבחירה שכבר נעשתה בדף המסלולים תיזכר, ונדרש/ת לבחור שוב.

   הבחירה נצרכת פעם אחת (‏consumePendingTier) ונמחקת — רענון אחרי הבחירה לא
   אמור לשלוח אותה שוב. וכמו כל שאר הפרמטרים כאן, זו תצוגה בלבד: מה שנקבע
   בפועל נקבע ב-‎join-agency/set_tier‎ מול ה-JWT, כולל נעילת ההטבה. */
const TIER_STORE_KEY = 'shuknadlan.pending_tier';

function readPendingTier(){
  try{
    const fromUrl = new URLSearchParams(window.location.search).get('tier');
    if (fromUrl){ sessionStorage.setItem(TIER_STORE_KEY, fromUrl); return fromUrl; }
    return sessionStorage.getItem(TIER_STORE_KEY) || '';
  } catch(_){
    try { return new URLSearchParams(window.location.search).get('tier') || ''; }
    catch(__){ return ''; }
  }
}
function clearPendingTier(){
  try { sessionStorage.removeItem(TIER_STORE_KEY); } catch(_){ /* ראו למעלה */ }
}
readPendingTier();

/* ---------- "באתי לפתוח משרד" ----------
   ‏agency-signup.html מציע/ה שתי דרכים לפתוח משרד: הטופס שבדף (אימייל
   וסיסמה), או כניסה עם Google — שמגיעה לכאן עם ‎?new_agency=1‎. הדגל נשמר
   באותה דרך בדיוק כמו אסימון ההזמנה והמסלול, ומאותה סיבה: ההתחברות עם
   Google חוזרת אל ‎origin + pathname‎ בלי ה-query.

   מה שהוא עושה הוא לדלג על מסך "מי את/ה?" — שהשאלה שבו כבר נענתה בדף
   הקודם — ולפתוח ישר את טופס פתיחת המשרד. הוא **אינו** מעניק שום דבר:
   ‏create-own-agency בודק/ת הרשאות מול ה-JWT כרגיל, וחשבון שכבר יש לו משרד
   יקבל `already_has_agency` בדיוק כמו קודם. */
const NEW_AGENCY_KEY = 'shuknadlan.new_agency';

function readNewAgencyIntent(){
  try{
    if (new URLSearchParams(window.location.search).get('new_agency') === '1'){
      sessionStorage.setItem(NEW_AGENCY_KEY, '1');
      return true;
    }
    return sessionStorage.getItem(NEW_AGENCY_KEY) === '1';
  } catch(_){
    try { return new URLSearchParams(window.location.search).get('new_agency') === '1'; }
    catch(__){ return false; }
  }
}
function clearNewAgencyIntent(){
  try { sessionStorage.removeItem(NEW_AGENCY_KEY); } catch(_){ /* ראו למעלה */ }
}
readNewAgencyIntent();

function cleanAuthParamsFromUrl(){
  // ‏history.state ולא null: הרשומה עשויה להיות הזקיף של exit-guard.js
  if (!window.history || !window.history.replaceState) return;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const dropHash = AUTH_HASH_KEYS.some(k => hashParams.has(k));
  let dropped = false;
  for (const key of AUTH_QUERY_KEYS){
    if (query.has(key)){ query.delete(key); dropped = true; }
  }
  if (!dropHash && !dropped) return;
  const search = query.toString();
  history.replaceState(history.state, '',
    window.location.pathname + (search ? '?' + search : '') + (dropHash ? '' : window.location.hash));
}

// קריאת שגיאת OAuth מהכתובת. נעשית בטעינה, לפני שהכתובת מנוקה.
const oauthError = (()=>{
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const pick = (key)=> hashParams.get(key) || query.get(key) || '';
  // ‏code הוא הקוד היבש (access_denied וכו') ו-description הוא הטקסט לבני אדם;
  // הביטול מזוהה לפי הקוד, אבל ההודעה שמוצגת היא התיאור אם הגיע כזה
  return { code: pick('error') || pick('error_code'), description: pick('error_description') };
})();
if (oauthError.code || oauthError.description){
  pendingAuthMessage = /access_denied|cancel/i.test(oauthError.code)
    ? 'ההתחברות עם Google בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.'
    : 'ההתחברות עם Google נכשלה: ' + (oauthError.description || oauthError.code);
}

/* רשת ביטחון: אם בדיקת ההתחברות נתקעת (רשת איטית, שרת שלא עונה), לא נשאיר את
   הסוכן/ת מול ספינר אינסופי — נציג את מסך הכניסה עם הסבר. */
const bootWatchdog = setTimeout(()=>{
  showLoginCard('בדיקת ההתחברות מתעכבת. אפשר להתחבר כאן, או לרענן את הדף.');
}, 15000);

/* ---------- Auth ---------- */
const googleLoginBtn = document.getElementById('googleLoginBtn');

function resetGoogleButton(){
  googleLoginBtn.disabled = false;
  googleLoginBtn.querySelector('.gl-label').textContent = 'התחברות עם Google';
}

googleLoginBtn.addEventListener('click', async ()=>{
  document.getElementById('loginError').textContent = '';
  // נעילה וחיווי: הניתוב ל-Google לוקח רגע, ובלי זה נראה היה שהלחיצה לא נקלטה —
  // ולחיצה נוספת פתחה ניתוב שני באמצע הראשון (שם נולדות חלק מה"קפיצות")
  googleLoginBtn.disabled = true;
  googleLoginBtn.querySelector('.gl-label').textContent = 'מעבירים ל-Google…';
  // redirectTo נשאר origin+pathname בלי query, כדי שיתאים בדיוק לכתובת שמוגדרת
  // ברשימת ה-Redirect URLs של Supabase. כתובת שלא ברשימה מוחלפת ב-Site URL,
  // ואז החזרה מ-Google נוחתת בדף הבית במקום כאן.
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error){
    resetGoogleButton();
    document.getElementById('loginError').textContent = 'לא הצלחנו לפתוח את החיבור ל-Google: ' + error.message;
  }
  // בהצלחה הדפדפן מנותב ל-Google; החזרה מטופלת ב-onAuthStateChange למטה
});

document.getElementById('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'מתחבר…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'כניסה';
  if (error){
    errEl.textContent = error.message === 'Invalid login credentials'
      ? 'אימייל או סיסמה שגויים'
      : 'שגיאת התחברות: ' + error.message;
    return;
  }
  await routeAfterAuth(data.session);
});

/* יצירת חשבון למי שהוזמן/ה — שני מסלולי סיום, ושניהם מסתיימים בשיוך:

   ‏1. הפרויקט לא דורש אימות אימייל → חוזר session, ומכאן זה בדיוק כמו כניסה
      רגילה: ‏routeAfterAuth → join-agency מול האסימון → הכרטיס מחובר.
   ‏2. הפרויקט דורש אימות → אין session, ונשלח מייל. אחרי האישור הסוכן/ת
      נוחת/ת כאן בלי האסימון שבכתובת — ודווקא אז נכנס לפעולה מסלול התאמת
      האימייל ב-join-agency (השלב השני ב-resolve), כי הכרטיס נושא בדיוק את
      הכתובת שאליה נשלחה ההזמנה. לכן אין כאן מבוי סתום בשום מקרה.

   כתובת שכבר רשומה אינה מדווחת ככזו — ‏Supabase מטשטש/ת את זה בכוונה, כדי
   שלא ניתן יהיה לברר מהמסך הזה מי רשום/ה. לכן ההודעה מכסה את שני המצבים. */
document.getElementById('inviteSignupBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn = document.getElementById('inviteSignupBtn');
  const errEl = document.getElementById('loginError');
  // ריק ולא צבע מפורש: ‏#loginError כבר צבוע ב-var(--brick), וזה הצבע שכל
  // שאר השגיאות במסך הזה מקבלות.
  errEl.style.color = '';
  errEl.textContent = '';
  if (!email){ errEl.textContent = 'יש להזין את האימייל שקיבל את ההזמנה.'; return; }
  if ((password || '').length < 8){ errEl.textContent = 'הסיסמה צריכה להיות באורך 8 תווים לפחות.'; return; }

  btn.disabled = true; btn.textContent = 'יוצר חשבון…';
  try{
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    if (error){
      errEl.textContent = 'יצירת החשבון נכשלה: ' + error.message;
      return;
    }
    if (data.session){ await routeAfterAuth(data.session); return; }
    errEl.style.color = 'var(--ink)';
    errEl.textContent = 'שלחנו מייל לאישור הכתובת. אחרי האישור אפשר להיכנס כאן, וההצטרפות למשרד תושלם אוטומטית. ' +
                        'אם כבר יש לך חשבון - אפשר פשוט להיכנס עם הסיסמה הקיימת.';
  } catch(err){
    console.error('invite signup failed', err);
    errEl.textContent = 'שגיאת רשת - נסו שוב';
  } finally{
    btn.disabled = false; btn.textContent = 'יצירת חשבון וסיסמה';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  routedUserId = null;
  showLoginCard();
});

document.getElementById('cancelCreateAgency').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  routedUserId = null;
  showLoginCard();
});

document.getElementById('createAgencyBtn').addEventListener('click', async ()=>{
  const agencyName = document.getElementById('caAgencyName').value.trim();
  const managerName = document.getElementById('caManagerName').value.trim();
  const license = document.getElementById('caLicense').value.trim();
  const feedback = document.getElementById('createAgencyFeedback');
  const btn = document.getElementById('createAgencyBtn');
  if (!agencyName || !managerName || !license){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'נא למלא את כל השדות';
    return;
  }
  if (!document.getElementById('caEthicsConsent').checked){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'פתיחת המשרד מותנית באישור הקוד האתי';
    return;
  }
  btn.disabled = true; btn.textContent = 'פותח משרד…'; feedback.textContent = '';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/create-own-agency', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      // בלי initial_tier: המסלול נקבע בשרת — הטבת ההשקה למשרד חדש, ובחירה
      // אמיתית בתום התקופה. סוכן/ת שנותק/ה שומר/ת בכל מקרה על המסלול
      // והארנק הקיימים (‏adopt_released_member_into_agency).
      body: JSON.stringify({ agency_name: agencyName, manager_name: managerName, license_number: license, ethics_code_accepted: true }),
    });
    const data = await res.json();

    // רישיון שלא אומת — מודאל הערעור במקום שורת שגיאה. הטופס נשאר פתוח
    // מאחוריו, כך שאפשר גם פשוט לתקן ספרה שהוקלדה שגוי ולנסות שוב.
    if (res.status === 403 && data.error === 'license_not_verified'){
      const { data: { user } } = await sb.auth.getUser();
      openLicenseAppeal({
        license: data.license_number || license,
        detail:  data.detail,
        name:    managerName,
        email:   user?.email || '',
        source:  'create-own-agency',
      });
      btn.disabled = false; btn.textContent = 'פתיחת המשרד שלי';
      return;
    }

    if (!res.ok || data.error){
      if (data.error === 'already_has_agency'){
        feedback.style.color = 'var(--red)';
        feedback.textContent = data.agency_name
          ? `כבר יש לך משרד רשום במערכת - "${data.agency_name}". לא ניתן לפתוח יותר ממשרד אחד.`
          : 'כבר יש לך משרד רשום במערכת - לא ניתן לפתוח יותר מאחד.';
        btn.disabled = false; btn.textContent = 'פתיחת המשרד שלי';
        return;
      }
      feedback.style.color = 'var(--red)';
      feedback.textContent = 'שגיאה: ' + (data.detail || data.error);
      btn.disabled = false; btn.textContent = 'פתיחת המשרד שלי';
      return;
    }
    // המעבר הושלם — הדגל יורד, אחרת מסך פתיחת המשרד יישאר "במצב אימוץ"
    // אם נחזור אליו מסיבה כלשהי
    const wasAdopted = !!data.adopted;
    const movedProps = data.moved?.properties || 0;
    releasedAgent = null;
    // מסך ההמתנה במקום כיבוי ידני של הכרטיס: כך אין רגע ריק בין סגירת מסך
    // פתיחת המשרד לבין הופעת הדשבורד. showScreen() מכבה את הכרטיס בעצמו.
    showBootCard('טוענים את איזור הסוכנים…');
    await loadDashboard(session.user);
    if (wasAdopted){
      showToast(movedProps > 0
        ? `המשרד נפתח. ${plural(movedProps, 'נכס אחד עבר איתך', 'נכסים עברו איתך')}.`
        : 'המשרד נפתח, וכל מה שרשום על שמך עבר איתך.');
    }
  } catch(err){
    console.error(err);
    // חוזרים למסך פתיחת המשרד — אחרת ההודעה נכתבת לכרטיס שכבר לא מוצג
    // והמסך נשאר תקוע על ההמתנה
    showScreen('createAgency');
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
    btn.disabled = false; btn.textContent = 'פתיחת המשרד שלי';
  }
});

/* ---------- Post-auth routing: decide dashboard vs "create your agency" ----------
   הפרדה מפורשת בין שלושה מצבים: יש שורת חבר/ה במשרד → דשבורד; אין שורה → מסך
   פתיחת משרד; שאילתה שנכשלה → מסך שגיאה. בלי ההפרדה הזו, כל תקלה זמנית נראית
   לסוכן/ת ותיק/ה כאילו המערכת לא מזהה אותם ומבקשת מהם לפתוח משרד חדש. */
/* מי שנותק/ה מהמשרד ופותח/ת משרד משלו/ה עובר/ת באותו מסך — אבל השורה שלו/ה
   כבר קיימת, ולכן חלק מהשדות לא רלוונטיים: השם והרישיון באים מהכרטיס, והמסלול
   והארנק ממשיכים כמו שהם ולא נבחרים מחדש. הדגל הזה הוא מה שמבדיל. */
let releasedAgent = null;

function showCreateAgencyScreen(){
  const adopting = !!releasedAgent;
  document.getElementById('caTierField').style.display = adopting ? 'none' : '';
  document.getElementById('caAdoptNote').style.display = adopting ? 'block' : 'none';
  document.getElementById('caTitle').textContent = adopting ? 'פתיחת המשרד שלך' : 'ברוך/ה הבא/ה!';
  document.getElementById('caSubtitle').textContent = adopting
    ? 'המשרד יהיה שלך, ואת/ה מנהל/ת שלו. כל מה שרשום על שמך יעבור אליו.'
    : 'עדיין לא פתחת משרד תיווך במערכת. כל סוכן יכול להיות בעלים של משרד אחד בלבד - בואו נקים אותו.';
  if (adopting){
    // הכרטיס כבר קיים; מילוי מראש מונע שם או רישיון שנכתבים מחדש בשוגג
    document.getElementById('caManagerName').value = releasedAgent.display_name || '';
    document.getElementById('caLicense').value = releasedAgent.license_number || '';
  }
  showScreen('createAgency');
}

function showReleasedScreen(agent, agencyName){
  releasedAgent = agent;
  document.getElementById('relAgencyName').textContent = agencyName || '';
  showScreen('released');
}

document.getElementById('relOpenAgencyBtn').addEventListener('click', ()=> showCreateAgencyScreen());
document.getElementById('relLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut(); routedUserId = null; releasedAgent = null; showLoginCard();
});

/* ---------- חשבון סגור ----------
   נקרא/ת מ-loadDashboard לפני כל שער אחר שאחרי הניתוק. אין מכאן המשך:
   הכניסה נגמרת במסך הזה. */
function showClosedScreen(agent){
  document.getElementById('closedDate').textContent = hebDate(agent.closed_at);
  showScreen('closed');
  // בקשת ההחזר, אם נפתחה, היא הדבר היחיד שעוד "רץ" אחרי הסגירה — ולכן היא
  // הדבר היחיד שהמסך הזה טורח לשלוף מהשרת.
  const note = document.getElementById('closedRefundNote');
  note.textContent = '';
  sb.from('wallet_refunds')
    .select('amount, status').eq('agent_id', agent.id)
    .in('status', ['requested','completed'])
    .order('requested_at', { ascending:false }).limit(1).maybeSingle()
    .then(({ data })=>{
      if (!data) return;
      note.textContent = data.status === 'completed'
        ? 'ההחזר על יתרת הארנק (' + shekel(data.amount) + ') בוצע. '
        : 'בקשת ההחזר על יתרת הארנק (' + shekel(data.amount) + ') נפתחה ומטופלת. ';
    })
    .catch(()=>{ /* המסך עומד גם בלי השורה הזו */ });
}
document.getElementById('closedLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut(); routedUserId = null; showLoginCard();
});

/* ---------- זיהוי חשבון שאין לו כרטיס משויך ----------
   נקודה אחת שמפרידה בין "אין לך משרד" לבין "יש לך כרטיס, הוא פשוט לא מחובר".
   הבירור עצמו נעשה ב-join-agency, כי הוא דורש service role: השוואה מול כרטיסים
   ממתינים ואימות אסימון הזמנה אינם דברים שאפשר לחשוף ללקוח. */
async function callJoinAgency(payload){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok:false, data:{ error:'no_session' } };
  const res = await fetch(SUPABASE_URL + '/functions/v1/join-agency', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch(_){ /* ראו callTeamInvite */ }
  return { ok: res.ok && !data.error, data };
}

const INVITE_INVALID_TEXT = {
  used:     'קישור ההזמנה כבר נוצל. אם כבר הצטרפת עם חשבון אחר - יש להתחבר איתו.',
  expired:  'תוקף קישור ההזמנה פג. אפשר לבקש ממנהל/ת המשרד לשלוח אותו שוב.',
  revoked:  'ההזמנה בוטלה על ידי מנהל/ת המשרד.',
  not_found:'קישור ההזמנה אינו תקין. כדאי לוודא שהועתק במלואו.',
};

async function resolveMembership(user, { alreadyResolved = false } = {}){
  // שומר נגד לולאה: join-agency רואה את השורה עם service role, אבל אם
  // ה-select של הלקוח לא רואה אותה (הרשאה, שכפול), loadDashboard היה חוזר
  // לכאן, וכאן שוב ל-loadDashboard — בלי סוף ובלי שום דבר על המסך.
  if (alreadyResolved){
    showAuthLoadError('החשבון חובר לכרטיס, אבל טעינת הפרטים נכשלה. נסו לרענן את הדף.');
    return;
  }

  showBootCard('מזהים את החשבון…');
  const token = readInviteToken();
  const { data } = await callJoinAgency({ action:'resolve', token });

  if (data.status === 'joined' || data.status === 'member'){
    // ההזמנה נוצלה — היא לא צריכה להישאר ולנסות לפעול שוב בכניסה הבאה
    clearInviteToken();
    if (data.status === 'joined') showToast('החשבון חובר לכרטיס שלך במשרד');
    // עכשיו השורה קיימת, והטעינה הרגילה תמצא אותה
    await loadDashboard(user, { alreadyResolved:true });
    return;
  }

  if (data.status === 'claim_pending'){ showClaimPendingScreen(user, data.agency_name); return; }

  // הכרטיס נמצא — חסרים בו הפרטים שרק הסוכן/ת יכול/ה למסור. **השיוך עוד
  // לא נעשה**, ובכוונה: כרטיס שקיבל חשבון הוא כרטיס שנכנסו אליו, ואין טעם
  // לבקש רישיון ממי שכבר בפנים. המסך הזה הוא גם שער הקוד האתי — אותה לחיצה
  // מוסרת את המספר, מאשרת את הקוד ומשייכת.
  if (data.status === 'needs_license'){
    showEthicsGate({
      needsLicense: true,
      needsName: !data.display_name,
      displayName: data.display_name || '',
      agencyName: data.agency_name || '',
    });
    return;
  }

  // הכרטיס נמצא — ומה שעוצר הוא הרישיון, לא הזיהוי. בלי הענף הזה המסך הבא
  // היה "לא מצאנו כרטיס", והסיבה האמיתית לא הייתה מגיעה לאף אחד.
  if (data.error === 'license_not_verified'){
    showIdentifyScreen(user, data.detail || 'רישיון התיווך לא אומת מול רשם המתווכים.');
    openLicenseAppeal({
      license: data.license_number || '',
      detail:  data.detail,
      email:   user?.email || '',
      source:  'join-agency',
    });
    return;
  }

  // מי שהגיע/ה מ"פתיחת משרד" עם Google כבר ענה/תה על השאלה שמסך הזיהוי
  // שואל. ‏status:'none' שם פירושו בדיוק מה שהוא ביקש: אין כרטיס, ולכן
  // פותחים משרד — ואין סיבה להציג לו/ה קודם מסך ששואל אם אולי כן יש.
  if (data.status === 'none' && readNewAgencyIntent()){
    clearNewAgencyIntent();
    showCreateAgencyScreen();
    return;
  }

  // אסימון שנכשל: מציגים למה, ומשאירים את מסלול מספר הרישיון פתוח — הוא
  // עובד גם כשהקישור פג או כבר נוצל.
  let notice = '';
  if (data.status === 'invite_invalid'){
    clearInviteToken();
    notice = INVITE_INVALID_TEXT[data.reason] || INVITE_INVALID_TEXT.not_found;
  } else if (data.error){
    notice = 'הזיהוי האוטומטי לא הצליח. אפשר להזדהות ידנית כאן.';
  }
  showIdentifyScreen(user, notice);
}

function showIdentifyScreen(user, notice){
  document.getElementById('idEmail').textContent = user?.email || '';
  document.getElementById('idNotice').textContent = notice || '';
  document.getElementById('idFeedback').textContent = '';
  document.getElementById('idLicense').value = '';
  showScreen('identify');
}

function showClaimPendingScreen(user, agencyName){
  document.getElementById('claimEmail').textContent = user?.email || '';
  document.getElementById('claimAgencyName').textContent = agencyName || '';
  document.getElementById('claimFeedback').textContent = '';
  showScreen('claimPending');
}

document.getElementById('idClaimBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('idClaimBtn');
  const feedback = document.getElementById('idFeedback');
  const license = document.getElementById('idLicense').value.trim();
  if (!license){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'יש להזין את מספר רישיון התיווך.';
    return;
  }
  btn.disabled = true; btn.textContent = 'בודקים…'; feedback.textContent = '';
  const { ok, data } = await callJoinAgency({ action:'claim', license_number:license });
  btn.disabled = false; btn.textContent = 'חיבור לכרטיס הקיים שלי';

  // הכרטיס נמצא — הרישיון שעליו הוא מה שלא אומת. זו הודעה אחרת לגמרי
  // מ-license_not_found ("אין כרטיס כזה"), ולכן היא לא נכנסת למפה שלמטה.
  if (data.error === 'license_not_verified'){
    const { data: { user } } = await sb.auth.getUser();
    openLicenseAppeal({
      license: data.license_number || license,
      detail:  data.detail,
      email:   user?.email || '',
      source:  'join-agency-claim',
    });
    feedback.style.color = 'var(--brick)';
    feedback.textContent = data.detail || 'רישיון התיווך לא אומת מול רשם המתווכים.';
    return;
  }

  if (!ok){
    const messages = {
      license_not_found:     'לא נמצא כרטיס עם מספר הרישיון הזה. כדאי לוודא מול מנהל/ת המשרד שהכרטיס נפתח, ושהמספר זהה.',
      already_member:        'החשבון הזה כבר מחובר לכרטיס. נסו לרענן את הדף.',
      claim_already_pending: 'כבר נשלחה בקשה והיא ממתינה לאישור מנהל/ת המשרד.',
    };
    feedback.style.color = 'var(--red)';
    feedback.textContent = messages[data.error] || 'הבקשה נכשלה, אנא נסו שוב.';
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  showClaimPendingScreen(session?.user, data.agency_name);
});

document.getElementById('idOpenAgencyBtn').addEventListener('click', ()=> showCreateAgencyScreen());
document.getElementById('idLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut(); routedUserId = null; showLoginCard();
});

document.getElementById('claimRefreshBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('claimRefreshBtn');
  const feedback = document.getElementById('claimFeedback');
  btn.disabled = true; btn.textContent = 'בודקים…';
  const { data: { session } } = await sb.auth.getSession();
  if (!session){ showLoginCard('פג תוקף החיבור - יש להתחבר מחדש.'); return; }
  await routeAfterAuth(session, { force:true });
  btn.disabled = false; btn.textContent = 'בדיקה אם אושר';
  // אם האישור עבר, routeAfterAuth כבר החליף מסך; אם עדיין לא — נשארנו כאן
  if (document.getElementById('claimPendingScreen').style.display === 'block'){
    feedback.style.color = 'var(--ink-soft)';
    feedback.textContent = 'הבקשה עדיין ממתינה לאישור.';
  }
});

document.getElementById('claimCancelBtn').addEventListener('click', async ()=>{
  if (!confirm('לבטל את הבקשה? אפשר יהיה לשלוח אחת חדשה עם מספר רישיון אחר.')) return;
  await callJoinAgency({ action:'cancel_claim' });
  const { data: { session } } = await sb.auth.getSession();
  showIdentifyScreen(session?.user, '');
});

document.getElementById('claimLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut(); routedUserId = null; showLoginCard();
});

function showAuthLoadError(detail){
  // הניתוב לא הושלם, ולכן routedUserId מתאפס — כך "נסיון נוסף" (או אירוע
  // התחברות חדש) באמת יריץ את הטעינה שוב ולא ייחשב כמי שכבר נטען
  routedUserId = null;
  document.getElementById('loadErrorDetail').textContent = detail || '';
  showScreen('loadError');
}

document.getElementById('retryLoadBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('retryLoadBtn');
  btn.disabled = true; btn.textContent = 'טוען…';
  const { data: { session } } = await sb.auth.getSession();
  if (!session) showLoginCard('פג תוקף החיבור - יש להתחבר מחדש.');
  else await routeAfterAuth(session, { force:true });
  btn.disabled = false; btn.textContent = 'נסיון נוסף';
});

document.getElementById('loadErrorLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  routedUserId = null;
  showLoginCard();
});

/* ---------- ניתוב אחרי התחברות ----------
   נקודת כניסה אחת לכל המצבים: טעינת הדף, חזרה מ-Google, כניסה עם סיסמה
   ו"נסיון נוסף". שני שומרים כאן, ושניהם נועדו למנוע את אותה תופעה — המסך
   שנבנה מחדש מתחת לידיים:
   ‏authRouting  — ניתוב שכבר רץ; קריאה נוספת מצטרפת אליו במקום להתחיל ניתוב
                   מקביל. קודם לכן boot() וגם onAuthStateChange קראו לכאן על
                   אותה כניסה עצמה, ושתי טעינות דשבורד רצו זו על זו.
   ‏routedUserId — מי כבר מוצג/ת על המסך. ‏supabase-js משדר SIGNED_IN מחדש גם
                   בחזרה ללשונית ובחידוש אסימון, ובלי הבדיקה הזו כל חזרה
                   ללשונית טענה את כל הדשבורד מחדש באמצע העבודה. */
let authRouting = null;
let routedUserId = null;

function routeAfterAuth(session, { force = false } = {}){
  const userId = session?.user?.id;
  if (!userId) return Promise.resolve();
  if (authRouting) return authRouting;
  if (!force && routedUserId === userId) return Promise.resolve();
  authRouting = (async ()=>{
    try { await routeAfterAuthOnce(session.user); }
    catch(err){
      // תקלה בבניית המסך היא לא "אינך מחובר/ת". בלי הגבול הזה כל חריגה בטעינת
      // הדשבורד גלשה החוצה והחזירה את הסוכן/ת לטופס הסיסמה אחרי שההתחברות
      // כבר הצליחה — בדיוק ההרגשה של "פתאום חוזרים למסך הכניסה".
      console.error(err);
      if (dashboard.style.display === 'block'){
        // הדשבורד כבר על המסך: כשל בטעינת קטגוריה בודדת לא מוחק את מה שכבר נטען
        showToast('חלק מהנתונים לא נטענו. נסו לרענן את הדף.');
      } else {
        showAuthLoadError('שגיאה בטעינת המסך: ' + (err?.message || err));
      }
    }
    finally { authRouting = null; }
  })();
  return authRouting;
}

async function routeAfterAuthOnce(user){
  clearTimeout(bootWatchdog);
  cleanAuthParamsFromUrl();
  routedUserId = user.id;
  showBootCard('טוענים את איזור הסוכנים…');
  // אין כאן שאילתת agency_members נפרדת: loadDashboard() ממילא שולף את השורה
  // ומבדיל בעצמו בין שגיאה (מסך שגיאה) לבין אין-שורה (מסך פתיחת משרד).
  // השאילתה הכפולה הוסיפה סיבוב רשת שלם לכל כניסה, לפני שמשהו הופיע על המסך.
  await loadDashboard(user);
}

/* ---------- Dashboard ---------- */
async function loadDashboard(user, { alreadyResolved = false } = {}){
  // ה-user מגיע מה-session שכבר בידינו. קריאה ל-getUser() כאן הייתה סיבוב רשת
  // נוסף לפני שמשהו מוצג על המסך — עוד שנייה של "מסך שלא ברור מה קורה בו".
  if (!user){
    const { data: { session } } = await sb.auth.getSession();
    user = session?.user;
  }
  if (!user){ showLoginCard('פג תוקף החיבור - יש להתחבר מחדש.'); return; }

  // שם המשרד נטען בשאילתה נפרדת ולא ב-embed‏ (agencies(name)): ל-agent_share_exclusions
  // יש מפתח ראשי מורכב (agent_id, agency_id), ולכן PostgREST רואה גם קשר רבים-לרבים
  // בין agency_members ל-agencies, לא יודע לבחור נתיב יחיד, ומחזיר PGRST201 (HTTP 300)
  // על כל embed כזה — כלומר **כל השאילתה** נכשלת ולא רק ה-embed. ההסבר המלא ורשימת
  // הקוראים: supabase/functions/_shared/agency-lookup.ts.
  const AGENT_FIELDS = 'id, agency_id, slug, display_name, bio, photo_url, photo_position, cover_url, license_number, role, tier, credit_balance, free_quota_used, free_quota_cycle_start, is_platform_admin, is_mortgage_advisor, phone, email, ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at, years_experience, specialties, credentials, service_area, gallery, released_at';
  // עמודות המסלול וההטבה נוספו במיגרציה מאוחרת יותר, ולכן הן בסל אחד עם
  // page_bg: אם המיגרציה עוד לא רצה, ה-fallback למטה טוען את הפרופיל בלעדיהן
  // והדשבורד נפתח כרגיל — בלי שער בחירת מסלול ובלי באנר הטבה.
  const TIER_FIELDS = 'tier_selected_at, tier_source, pending_tier_change, promo_tier, promo_started_at, promo_ends_at, promo_ended_at';
  // עמודות סגירת החשבון נוספו במיגרציה 20261018090000, ולכן הן נוסעות באותו
  // סל סובלני: סביבה שהמיגרציה עוד לא רצה בה נכנסת לדשבורד בלי מקטע הסגירה,
  // ולא נתקעת במסך שגיאה.
  const CLOSURE_FIELDS = 'closure_requested_at, closure_effective_at, closed_at';
  let { data: agent, error: agentErr } = await sb
    .from('agency_members')
    .select(AGENT_FIELDS + ', page_bg, id_number, ' + TIER_FIELDS + ', ' + CLOSURE_FIELDS)
    .eq('user_id', user.id)
    .maybeSingle();

  // ‏page_bg (בחירת רקע דף הסוכן/ת) נוספה אחרי שה-CRM כבר היה באוויר.
  // ‏PostgREST מפיל את *כל* השאילתה על עמודה חסרה, וזו השאילתה שפותחת את
  // הדשבורד — ולכן סביבה שהמיגרציה עוד לא רצה בה נכנסת בלעדיה, ובחירת
  // הרקע פשוט לא מוצגת. ראו supabase/migrations/20260914091000_page_background.sql.
  if (agentErr && /page_bg|id_number|promo_|tier_selected_at|tier_source|closure_|closed_at/.test(agentErr.message || '')){
    console.warn('עמודה שנוספה במיגרציה מאוחרת עוד לא קיימת - נטען הפרופיל בלעדיה:', agentErr);
    ({ data: agent, error: agentErr } = await sb
      .from('agency_members').select(AGENT_FIELDS).eq('user_id', user.id).maybeSingle());
  }

  if (agentErr){ showAuthLoadError('שגיאה: ' + agentErr.message); return; }
  if (!agent){
    // אין agency_members לחשבון הזה. עד כאן זה נכון — אבל **לא** נכון להסיק
    // מכך מיד "אין לך משרד": זו הייתה בדיוק התקלה. סוכן/ת שהמנהל/ת כבר
    // הוסיף/ה, שהאימייל על הכרטיס שלו/ה הוקלד עם אות אחת עודפת, נחת/ה כאן
    // וקיבל/ה הוראה לפתוח משרד מיותר — בזמן שהכרטיס שלו/ה יושב במשרד ומחכה.
    //
    // לכן קודם מנסים לזהות (הזמנה → אימייל → בקשת שיוך), ורק אם באמת אין שום
    // קצה חוט מגיעים למסך פתיחת המשרד. ההבחנה מול agentErr למעלה נשמרת:
    // שאילתה שנכשלה היא מסך שגיאה, לא "אין לך משרד".
    await resolveMembership(user, { alreadyResolved });
    return;
  }

  let agencyName = '';
  if (agent.agency_id){
    // הכתובת נטענת יחד עם השם כי היא נכנסת לבלוק "לבין" בהסכמי התיווך
    const { data: agency } = await sb.from('agencies').select('name, address').eq('id', agent.agency_id).maybeSingle();
    agencyName = agency?.name || '';
    window.currentAgency = agency || null;
  }

  // ניתוק מהמשרד קודם לכל השאר, ובפרט לשער הקוד האתי: מי שכבר לא במשרד לא
  // אמור/ה להתבקש לחתום על משהו בשמו לפני שהוא/היא בכלל יודע/ת שהושעה/תה.
  if (agent.released_at){ showReleasedScreen(agent, agencyName); return; }

  // חשבון שנסגר ביוזמת הסוכן/ת. אחרי בדיקת הניתוק ולא לפניה: מי שהושעה/תה
  // **וגם** סגר/ה צריך/ה לראות קודם שהוא/היא מחוץ למשרד — זו ההודעה
  // שמסבירה את הכפתור "פתיחת משרד". מכאן אין המשך לדשבורד.
  if (agent.closed_at){ showClosedScreen(agent); return; }

  currentAgent = agent;

  // שער האישור לפני הדשבורד: סוכן/ת שנוסף/ה על ידי מנהל/ת המשרד לא עבר/ה
  // בשום טופס הרשמה, והכניסה הזו היא ההזדמנות הראשונה לאישור אישי.
  if (ethicsNeedsGate(agent)){ showEthicsGate(); return; }

  // ואחריו שער המסלול: מה שההצטרפות נותנת, ומה ממשיך אחריה. גם הוא מוצג
  // פעם אחת — או פעם נוספת ביום שההטבה נגמרת. ‏?tier=… הוא חזרה מדף
  // המסלולים עם בחירה, והיא נסגרת על אותו מסך כדי שהתשובה (נכנס לתוקף /
  // בקשה נקלטה / נעול בתקופת ההטבה) תוצג במקום אחד.
  // ---------------------------------------------------------------------
  // שער המסלול — ומתי הוא **אינו** מסך
  //
  // בתקופת ההשקה אין כאן בחירה: כולם מקבלים Elite, ושני המסלולים האחרים
  // מוצגים נעולים. כלומר המסך היה עמוד שלם שכל תפקידו לחיצה אחת על
  // האפשרות היחידה, בין ההתחברות לבין הדשבורד. מה שהוא אמר — מה קיבלת
  // ועד מתי — נאמר ממילא ברצועת ההטבה שבראש הדשבורד, ונשאר שם.
  //
  // לכן ההטבה מאושרת כאן בשקט (אותה `set_tier` בדיוק, אותה רשומה
  // ב-`tier_changes`), והמסך נשמר לרגע שבו יש בו החלטה אמיתית: תום
  // ההטבה (`promo_expired`), או חזרה מדף המסלולים עם בחירה (`?tier=`).
  // ---------------------------------------------------------------------
  const requestedTier = consumePendingTier();
  const promo = promoOf(agent);
  // בחירה שחזרה מדף המסלולים מוצגת על המסך — אבל לא בתקופת ההטבה, שבה
  // התשובה היחידה שהשרת יכול לתת לה היא "נעול עד תום ההטבה". להציג מסך
  // שכל תפקידו לומר לא, למי שממילא מקבל/ת את המסלול המלא, הוא בדיוק סוג
  // המסך שהשינוי הזה בא להוריד.
  if (requestedTier && !promo.active){
    showTierGate();
    chooseTier(requestedTier, null);
    return;
  }
  if (tierNeedsGate(agent)){
    if (promo.active) await acceptPromoSilently(agent, promo);
    else { showTierGate(); return; }
  }

  showScreen('dashboard');
  // הגריד נבנה לפני הטעינות, כדי שהמונים שמגיעים מהן ימצאו תגית לכתוב אליה
  renderQuickActions();
  // והניווט נכנס לתוקף כבר כאן ולא רק בסוף הטעינה: המסך עומד מול הסוכן/ת
  // בזמן שהקטגוריות נטענות, וסינון שנכנס באיחור מקפל מתחת לאצבע מסך שכבר
  // קוראים בו. המונים עוד אינם בידינו, ולכן הסרגלים נבנים שוב בכל
  // ‏accSetCount (ראו refreshNavCounts) — כאן נקבע רק מה מוצג.
  applyNavFilter();
  renderSideNav();
  renderBottomNav();

  renderHeaderAvatar(agent);
  document.getElementById('agentName').textContent = agent.display_name;
  document.getElementById('agentAgency').textContent = agencyName;
  renderTierBadge(agent);
  renderPromoStrip(agent);
  // מדריך ההתחלה ברקע: הוא מוצג רק למיעוט (סוכן/ת חדש/ה במסלול mid ומעלה),
  // ואין סיבה שכל השאר יחכו לקריאה שתחזיר להם אפס שורות.
  loadOnboarding().catch(err => console.warn('טעינת מדריך ההתחלה נכשלה:', err));
  setAgentBalance(agent.credit_balance);

  // מצב הסליקה והחזרה מעמוד התשלום — שניהם ברקע. הראשון רק צובע טקסט,
  // והשני מחכה ל-webhook; לא מעכבים בגללם את בניית הדשבורד.
  probeTopupMode();
  handleTopupReturn();
  refreshRefundSection();
  // מקטע הסגירה נטען ברקע כמו שאר מקטעי ההגדרות: הוא לא על המסך הראשון,
  // והמצב שבו הוא תלוי (בקשה פתוחה, חסם, סכום להחזר) מגיע מהשרת.
  loadClosureSection().catch(err => console.warn('טעינת מקטע סגירת החשבון נכשלה:', err));

  // המחירים נטענים לפני הלידים, כי דיאלוג האישור מציג את הסכום שייגבה בפועל
  await loadPricing();
  const freeQuota = priceOf('free_lead_quota_monthly', 10);
  document.getElementById('quotaUsed').textContent =
    agent.tier === 'free' ? (quotaUsedThisCycle() + ' / ' + freeQuota) : 'ללא הגבלה';
  renderQuotaMeter(freeQuota);

  // רשימת השת"פ נטענת לפני הנכסים: היא מזינה את ספירת המשרדים שמוצגת
  // בדיאלוג האישור של "פתיחה לשת״פ" בשורת הנכס
  await loadSharePartners(agent);
  await loadProperties(agent.id);
  await loadLeads(agent.id);
  await loadLeadShelf(agent.id);
  await loadSavedSearchShelf(agent.id);
  await loadSharedWithMe();
  await loadClients();
  await loadClientAlerts();
  await loadAgreements();
  await loadNotifications(agent.id);
  await loadNotifPrefs(agent.id);
  // התזכורות ברקע: הן מחושבות במסד על כל הנכסים של הסוכן/ת, והקטגוריה שלהן
  // יושבת בהגדרות החשבון ולא במסך הראשון. ‏catch כדי שסביבה שהמיגרציה עוד לא
  // רצה בה תיפתח כרגיל, בלי הקטגוריה.
  loadReminders(agent.id).catch(err => console.warn('טעינת התזכורות נכשלה:', err));
  await loadPreferences(agent.id);
  loadWhatsappSettings(agent);
  loadProfileSettings(agent);
  loadEthicsSettings(agent);

  // display נקבע בשני הכיוונים ולא רק ל-block, כדי שהחלפת תפקיד מתפריט הבדיקה
  // (מנהל/ת → סוכן/ת) באמת תסתיר את אזור הניהול בלי לרענן את העמוד.
  // שתי מגירות ולא אחת: הן רחוקות זו מזו בעמוד כי סדר הקטגוריות הוא סדר
  // הניווט, והן נפתחות ונסגרות יחד — ראו את ההערה מעל #managerBrandingSection.
  const managerDisplay = agent.role === 'manager' ? 'block' : 'none';
  document.getElementById('managerSection').style.display = managerDisplay;
  document.getElementById('managerBrandingSection').style.display = managerDisplay;
  if (agent.role === 'manager'){
    await loadBranding(agent.agency_id);
    await loadTeam(agent.agency_id, agent.id);
    await loadPendingReviews(agent.agency_id);
    await loadAgencyEthics(agent.agency_id);
  } else {
    document.getElementById('ethicsAgencyBlock').hidden = true;
  }

  // כלי הפלטפורמה נטענים למנהל/ת פלטפורמה, אבל *מוצגים* רק בתצוגת מנהל/ת —
  // ‏setDashView בסוף הפונקציה הוא מי שקובע. הטעינה כאן ולא שם, כדי שהמעבר
  // בין התצוגות יהיה מיידי ולא ימתין לרשת.
  if (agent.is_platform_admin){
    await loadLicenseAppeals();
    await loadRefundQueue();
    await loadSubscriptionsAdmin();
    await loadNeighborhoodsAdmin();
    await loadRssSourcesAdmin();
    await loadArticlesAdmin();
    await loadProfessionalCardsAdmin();
    await loadUnroutedLeads();
  }

  // מגירת המשכנתאות בחנות הלידים פתוחה רק ליועצ/ת משכנתאות. כמו
  // managerSection, המצב נקבע בשני הכיוונים כדי שהסרת הדגל תסגור את המגירה
  // בלי לרענן את העמוד.
  setShelfMortgageVisible(agent.is_mortgage_advisor);
  if (agent.is_mortgage_advisor){
    await loadMortgageShelf(agent.id);
  }

  renderDevMenu(agent);

  // הניווט נבנה בסוף, אחרי שההרשאות והמונים כבר במקומם: הוא נגזר מה-DOM
  // (navAccVisible), ובנייה מוקדמת מדי הייתה מייצרת מפה של דשבורד חצי-טעון
  renderGreeting(agent);
  renderViewSwitch();
  setDashView('agent', { initial:true });
  renderQuickActions();
  refreshNavCounts();
  dashPanelsMeasure();

  // אחרון, ובכוונה: הניווט לפי ?goto= נשען על navAccVisible ועל המונים, ולכן
  // הוא חייב לרוץ אחרי שהניווט וההרשאות כבר במקומם.
  handleGotoParam();
}

/* ---------- ‏?goto=accXxx — נחיתה ישירה בקטגוריה ----------
   קישור בתזכורת שנשלחה במייל או בוואטסאפ מוביל לכאן: המסד מחזיק לכל ממצא את
   מזהה הקטגוריה שבה מטפלים בו (‏action_acc ב-agent_reminder_findings), ושרת
   התזכורות עוטף אותו ל-‏crm.html?goto=<accId>. תזכורת שמנחיתה בראש הדשבורד
   ומשאירה את הסוכן/ת לחפש היא חצי תזכורת.

   שתי בדיקות ולא אחת, ושתיהן על הערך שהגיע מהכתובת:

   • ‏תחילית `acc` וקבוצת תווים סגורה — כך שערך מהכתובת לעולם אינו מגיע
     כברירת מחדל ל-getElementById עם משהו שאינו מזהה קטגוריה.
   • ‏navAccVisible — קטגוריה שאינה גלויה לתפקיד הזה (קישור ישן, או קישור
     שהועבר בין סוכנים) פשוט לא נפתחת, ולא נגללת לשום מקום.

   הכתובת מנוקה מיד — רענון דף לא אמור לקפוץ שוב — ורק המפתח שלנו, בדיוק כמו
   ב-cleanAuthParamsFromUrl ו-handleTopupReturn: מחיקת כל ה-query הייתה מוחקת
   גם את invite, ו-replaceState עם null במקום history.state הורס את הזקיף של
   exit-guard.js. */
function handleGotoParam(){
  const params = new URLSearchParams(location.search);
  const raw = params.get('goto');
  if (!raw) return;

  if (window.history && window.history.replaceState){
    params.delete('goto');
    const search = params.toString();
    history.replaceState(history.state, '',
      location.pathname + (search ? '?' + search : '') + location.hash);
  }

  if (!/^acc[A-Za-z0-9]{1,40}$/.test(raw)) return;
  if (!navAccVisible(raw)) return;
  gotoSection(raw);
}

/* הברכה נושאת את השם ואת שעת היום — היא הדבר הראשון שנקרא בעמוד, ולכן היא
   גם המקום הנכון לתת הקשר במקום עוד כותרת גנרית */
function renderGreeting(agent){
  const el = document.getElementById('dashGreet');
  if (!el) return;
  const first = String(agent.display_name || '').trim().split(/\s+/)[0] || '';
  const hour = new Date().getHours();
  const part = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
  el.textContent = part + (first ? ', ' + first : '') + ' - הנה תמונת המצב שלך להיום';
}

/* ---------- Test menu (מצב בדיקה) ----------
   מאפשר למנהל הפלטפורמה לעבור בין מסלולים (free/mid/premium) ובין תפקידים
   (סוכן/ת רגיל/ה ↔ מנהל/ת משרד) בלי לפתוח חשבון נפרד לכל צירוף.
   השינוי עצמו נעשה ב-Edge Function dev-switch-mode, כי הטריגר
   protect_sensitive_agency_member_fields נועל את tier/role מול הדפדפן. */
function renderDevMenu(agent){
  const menu = document.getElementById('devMenu');
  if (!agent.is_platform_admin){ menu.style.display = 'none'; return; }
  menu.style.display = 'flex';
  document.querySelectorAll('#devTierPills button').forEach(b =>
    b.classList.toggle('active', b.dataset.tier === agent.tier));
  document.querySelectorAll('#devRolePills button').forEach(b =>
    b.classList.toggle('active', b.dataset.role === agent.role));
}

document.getElementById('devMenuToggle').addEventListener('click', ()=>{
  document.getElementById('devMenu').classList.toggle('open');
});

async function devSwitch(changes, pills){
  pills.forEach(b => b.disabled = true);
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(DEV_SWITCH_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify(changes),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const messages = {
        not_platform_admin: 'תפריט הבדיקה זמין רק למנהל פלטפורמה',
        no_matching_agent_profile: 'לא נמצא פרופיל סוכן/ת לחשבון הזה',
      };
      showToast(messages[data.error] || ('שגיאה: ' + (data.error || 'לא ידועה')));
      return;
    }

    const roleLabels = { agent:'סוכן/ת', manager:'מנהל/ת משרד' };
    showToast(`מצב בדיקה: ${roleLabels[data.role]} · מסלול ${Tiers.label(data.tier)}`);
    await loadDashboard();
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת - נסו שוב');
  } finally {
    pills.forEach(b => b.disabled = false);
  }
}

document.getElementById('devTierPills').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-tier]');
  if (!btn || btn.classList.contains('active')) return;
  devSwitch({ tier: btn.dataset.tier }, [...document.querySelectorAll('#devTierPills button')]);
});

document.getElementById('devRolePills').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-role]');
  if (!btn || btn.classList.contains('active')) return;
  devSwitch({ role: btn.dataset.role }, [...document.querySelectorAll('#devRolePills button')]);
});

/* ---------- Neighborhoods admin (platform admin only) ---------- */
async function loadNeighborhoodsAdmin(){
  const listEl = document.getElementById('neighborhoodsAdminList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data, error } = await sb.from('neighborhoods').select('id, city, name, boundary').order('name');
  if (error){ listEl.innerHTML = '<div class="empty-state">שגיאה: ' + error.message + '</div>'; return; }
  accSetCount('accNeighborhoods', (data||[]).length);
  listEl.innerHTML = '';
  (data||[]).forEach(n=>{
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)';
    row.innerHTML = `<span style="font-size:.88rem;flex:1 1 auto;min-width:0">${n.name} <span style="color:var(--ink-soft);font-size:.74rem">(${n.city})</span></span>`;

    // מסומנת או לא — מה שקובע איך השכונה נראית במפת החיפוש. הקישור פותח את
    // כלי הסימון כשהיא כבר נבחרת, כדי שהתיקון יהיה במרחק לחיצה אחת.
    const marked = Array.isArray(n.boundary) && n.boundary.length >= 3;
    const shape = document.createElement('a');
    shape.href = 'neighborhood-boundary.html?hood=' + encodeURIComponent(n.id);
    shape.target = '_blank';
    shape.rel = 'noopener';
    shape.style.cssText = 'font-size:.74rem;font-weight:700;white-space:nowrap;text-decoration:none;' +
      (marked ? 'color:var(--ink-soft)' : 'color:var(--gold-dark)');
    shape.textContent = marked ? `✓ מסומנת · ${n.boundary.length} נק׳` : 'סימון על המפה ←';
    shape.title = marked
      ? 'לשכונה יש גבול על המפה. לחיצה פותחת אותו לעריכה.'
      : 'אין לשכונה גבול - במפת החיפוש היא מוצגת כעיגול מוערך.';
    row.appendChild(shape);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost';
    delBtn.style.padding = '5px 12px';
    delBtn.textContent = 'מחיקה';
    delBtn.addEventListener('click', async ()=>{
      if (!confirm(`למחוק את "${n.name}"? נכסים/העדפות שמשויכים אליה יאבדו את השיוך (לא יימחקו).`)) return;
      // ניקוי הפניות לפני מחיקה, כדי לא להיתקל ב-FK constraint
      await sb.from('properties').update({ neighborhood_id: null }).eq('neighborhood_id', n.id);
      const { data: prefRows } = await sb.from('agent_lead_preferences').select('agent_id, preferred_neighborhoods');
      for (const row of (prefRows||[])){
        if ((row.preferred_neighborhoods||[]).includes(n.id)){
          await sb.from('agent_lead_preferences').update({
            preferred_neighborhoods: row.preferred_neighborhoods.filter(id => id !== n.id)
          }).eq('agent_id', row.agent_id);
        }
      }
      const { error: delErr } = await sb.from('neighborhoods').delete().eq('id', n.id);
      if (delErr){ showToast('שגיאה במחיקה: ' + delErr.message); return; }
      showToast('השכונה נמחקה');
      await loadNeighborhoodsAdmin();
    });
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });
}

document.getElementById('addNeighborhoodAdminBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('newNeighborhoodAdminName');
  const name = input.value.trim();
  if (!name) return;
  const { error } = await sb.from('neighborhoods').insert({ city: 'עפולה', name });
  if (error){
    showToast(error.code === '23505' ? 'השכונה כבר קיימת ברשימה' : ('שגיאה: ' + error.message));
    return;
  }
  input.value = '';
  showToast('השכונה נוספה בהצלחה');
  await loadNeighborhoodsAdmin();
});

/* ---------- RSS sources admin (platform admin only) ----------
   מזין את מנוע הלידים האוטומטי (scraper.py) שרץ ב-GitHub Actions כל 30 דקות.
   הסקרייפר קורא את הטבלה הזו בתחילת כל הרצה, ולכן הוספה/כיבוי כאן נכנסים
   לתוקף בהרצה הבאה בלי לגעת בקוד. הכתיבה מוגנת ב-RLS: policy של
   rss_sources מתיר INSERT/UPDATE/DELETE רק ל-is_platform_admin. */
const RSS_SOURCE_TYPE_LABELS = {
  facebook_group: 'קבוצת פייסבוק',
  google_alert: 'התראת Google',
  yad2: 'יד2',
  board: 'לוח מודעות',
  telegram: 'טלגרם',
  other: 'אחר',
};

function rssLastRunLabel(source){
  if (!source.last_fetched_at) return 'טרם נקרא';
  const when = new Date(source.last_fetched_at).toLocaleString('he-IL', { dateStyle:'short', timeStyle:'short' });
  if (source.last_status === 'error') return 'שגיאה · ' + when;
  return 'נקרא לאחרונה ' + when;
}

async function loadRssSourcesAdmin(){
  const listEl = document.getElementById('rssSourcesAdminList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('rss_sources')
    .select('id, name, url, source_type, active, last_fetched_at, last_status, last_error, items_seen, leads_created')
    .order('created_at');

  if (error){
    // 42P01 = הטבלה לא קיימת עדיין — כלומר schema.sql טרם הורץ בפרויקט
    listEl.innerHTML = '<div class="empty-state">' +
      (error.code === '42P01'
        ? 'טבלת rss_sources לא קיימת עדיין - הריצו את schema.sql ב-Supabase.'
        : 'שגיאה: ' + error.message) + '</div>';
    return;
  }

  const sources = data || [];
  accSetCount('accRssSources',
    plural(sources.filter(s => s.active).length, 'מקור אחד פעיל', 'פעילים'));

  if (!sources.length){
    listEl.innerHTML = '<div class="empty-state">אין עדיין מקורות. הוסיפו פיד RSS ראשון למעלה.</div>';
    return;
  }

  listEl.innerHTML = '';
  sources.forEach(source => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--line)';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';

    const name = document.createElement('span');
    name.style.cssText = 'font-size:.88rem;font-weight:700';
    name.textContent = source.name;
    head.appendChild(name);

    const type = document.createElement('span');
    type.style.cssText = 'font-size:.66rem;font-weight:800;background:var(--teal-tint);color:var(--ink-soft);padding:2px 7px;border-radius:5px';
    type.textContent = RSS_SOURCE_TYPE_LABELS[source.source_type] || source.source_type;
    head.appendChild(type);

    if (!source.active){
      const paused = document.createElement('span');
      paused.style.cssText = 'font-size:.66rem;font-weight:800;background:var(--gold-tint);color:var(--gold-dark);padding:2px 7px;border-radius:5px';
      paused.textContent = 'מושהה';
      head.appendChild(paused);
    }
    row.appendChild(head);

    const url = document.createElement('div');
    url.dir = 'ltr';
    url.style.cssText = 'font-size:.72rem;color:var(--ink-soft);text-align:left;word-break:break-all;margin-top:2px';
    url.textContent = source.url;
    row.appendChild(url);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:.72rem;color:var(--ink-soft);margin-top:2px';
    meta.textContent = rssLastRunLabel(source) +
      ' · ' + plural(source.items_seen || 0, 'פריט אחד', 'פריטים')
    + ' · ' + plural(source.leads_created || 0, 'ליד אחד', 'לידים');
    row.appendChild(meta);

    if (source.last_status === 'error' && source.last_error){
      const err = document.createElement('div');
      err.style.cssText = 'font-size:.72rem;color:var(--gold);margin-top:2px;word-break:break-word';
      err.textContent = source.last_error;
      row.appendChild(err);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:8px';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-ghost';
    toggleBtn.style.padding = '5px 12px';
    toggleBtn.textContent = source.active ? 'השהיה' : 'הפעלה';
    toggleBtn.addEventListener('click', async ()=>{
      toggleBtn.disabled = true;
      const { error: updErr } = await sb.from('rss_sources')
        .update({ active: !source.active }).eq('id', source.id);
      if (updErr){ showToast('שגיאה: ' + updErr.message); toggleBtn.disabled = false; return; }
      showToast(source.active ? 'המקור הושהה' : 'המקור הופעל');
      await loadRssSourcesAdmin();
    });
    actions.appendChild(toggleBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost';
    delBtn.style.padding = '5px 12px';
    delBtn.textContent = 'מחיקה';
    delBtn.addEventListener('click', async ()=>{
      if (!confirm(`למחוק את המקור "${source.name}"? הלידים שכבר נאספו ממנו יישארו במערכת.`)) return;
      delBtn.disabled = true;
      const { error: delErr } = await sb.from('rss_sources').delete().eq('id', source.id);
      if (delErr){ showToast('שגיאה במחיקה: ' + delErr.message); delBtn.disabled = false; return; }
      showToast('המקור נמחק');
      await loadRssSourcesAdmin();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

document.getElementById('addRssSourceBtn').addEventListener('click', async ()=>{
  const nameInput = document.getElementById('newRssSourceName');
  const urlInput  = document.getElementById('newRssSourceUrl');
  const typeInput = document.getElementById('newRssSourceType');
  const name = nameInput.value.trim();
  const url  = urlInput.value.trim();

  if (!name || !url){ showToast('נדרשים שם וכתובת פיד'); return; }
  let parsed;
  try { parsed = new URL(url); } catch { showToast('כתובת הפיד אינה תקינה'); return; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:'){
    showToast('כתובת הפיד חייבת להתחיל ב-http או https'); return;
  }

  const btn = document.getElementById('addRssSourceBtn');
  btn.disabled = true;
  const { error } = await sb.from('rss_sources').insert({
    name, url, source_type: typeInput.value, active: true,
  });
  btn.disabled = false;

  if (error){
    showToast(error.code === '23505' ? 'הפיד הזה כבר קיים ברשימה' : ('שגיאה: ' + error.message));
    return;
  }
  nameInput.value = '';
  urlInput.value = '';
  showToast('המקור נוסף - ייקרא בהרצה הבאה של המנוע');
  await loadRssSourcesAdmin();
});

/* ---------- כתבות ובלוגים (platform admin only) ----------
   המקור של רצועת "כתבות ובלוגים" בדף הבית ושל article.html. הכתיבה מוגנת
   ב-RLS: policy של articles מתיר INSERT/UPDATE/DELETE רק ל-is_platform_admin,
   וקריאה ציבורית מוגבלת ל-status='published'.

   טופס אחד משמש גם ליצירה וגם לעריכה — articleState.editingId הוא ההבדל
   היחיד ביניהם, ושני כפתורי השמירה נבדלים רק בסטטוס שהם שולחים. */
const ARTICLES_BUCKET = 'property-images'; // אותו bucket ציבורי; הנתיב מפריד בין נכסים לכתבות
let articleState = { editingId:null, cover:null, pendingDeletes:[] };

function articleCoverPath(url){
  const marker = '/storage/v1/object/public/' + ARTICLES_BUCKET + '/';
  const i = String(url).indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length));
}

function renderArticleCover(){
  renderSingleImage('arCoverPreview', articleState.cover, 'cover', clearArticleCover);
}

function clearArticleCover(){
  const slot = articleState.cover;
  if (!slot) return;
  if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
  // מוחקים מה-Storage רק אחרי שהשמירה ל-DB הצליחה, כדי לא לאבד תמונה
  // שעדיין מוצגת בכתבה שפורסמה
  if (slot.url){
    const path = articleCoverPath(slot.url);
    if (path) articleState.pendingDeletes.push(path);
  }
  articleState.cover = null;
  renderArticleCover();
  renderArticlePreview();
}

document.getElementById('arCoverInput').addEventListener('change', async (e)=>{
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file) return;
  try{
    const blob = await fileToResizedBlob(file, 1600);
    const previous = articleState.cover;
    if (previous){
      if (previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      if (previous.url){
        const path = articleCoverPath(previous.url);
        if (path) articleState.pendingDeletes.push(path);
      }
    }
    articleState.cover = { blob, previewUrl: URL.createObjectURL(blob) };
    renderArticleCover();
    renderArticlePreview();
  } catch(err){
    console.warn('article cover resize failed', err);
    showToast('לא ניתן לקרוא את הקובץ');
  }
});

function renderArticlePreview(){
  const title = document.getElementById('arTitle').value.trim();
  const subtitle = document.getElementById('arSubtitle').value.trim();
  const category = document.getElementById('arCategory').value.trim();

  document.getElementById('apTitle').textContent = title || 'הכותרת של הכתבה';
  document.getElementById('apSub').textContent = subtitle || 'כותרת המשנה תופיע כאן, וגם כתקציר בכרטיס וברשתות.';
  document.getElementById('apKicker').textContent = category || 'מגזין שוק נדל״ן';
  document.getElementById('arSubtitleCount').textContent = String(document.getElementById('arSubtitle').value.length);

  const slot = articleState.cover;
  const src = slot ? (slot.previewUrl || slot.url) : null;
  // ריק מחזיר את הגרדיאנט שמוגדר ב-CSS במקום להשאיר תמונה ישנה
  document.getElementById('apCover').style.backgroundImage = src ? `url("${String(src).replace(/"/g, '%22')}")` : '';
}

['arTitle','arSubtitle','arCategory'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderArticlePreview);
});

function resetArticleForm(){
  if (articleState.cover && articleState.cover.previewUrl) URL.revokeObjectURL(articleState.cover.previewUrl);
  articleState = { editingId:null, cover:null, pendingDeletes:[] };
  ['arTitle','arSubtitle','arCategory','arBody','arAuthor'].forEach(id=>{
    document.getElementById(id).value = '';
  });
  document.getElementById('arSaveBtn').textContent = 'שמירה כטיוטה';
  document.getElementById('arPublishBtn').textContent = 'שמירה ופרסום';
  document.getElementById('arCancelBtn').hidden = true;
  document.getElementById('arFeedback').textContent = '';
  renderArticleCover();
  renderArticlePreview();
}

function startArticleEdit(article){
  if (articleState.cover && articleState.cover.previewUrl) URL.revokeObjectURL(articleState.cover.previewUrl);
  articleState = {
    editingId: article.id,
    cover: article.cover_url ? { url: article.cover_url } : null,
    pendingDeletes: [],
  };
  document.getElementById('arTitle').value    = article.title || '';
  document.getElementById('arSubtitle').value = article.subtitle || '';
  document.getElementById('arCategory').value = article.category || '';
  document.getElementById('arBody').value     = article.body || '';
  document.getElementById('arAuthor').value   = article.author_name || '';
  // כתבה שכבר פורסמה נשמרת בחזרה כמפורסמת — הכפתור השני הוא "עדכון", לא
  // "פרסום", כדי שלא ייראה כאילו הוא מפרסם משהו בפעם הראשונה
  const published = article.status === 'published';
  document.getElementById('arSaveBtn').textContent = published ? 'שמירה והחזרה לטיוטה' : 'שמירה כטיוטה';
  document.getElementById('arPublishBtn').textContent = published ? 'עדכון הכתבה המפורסמת' : 'שמירה ופרסום';
  document.getElementById('arCancelBtn').hidden = false;
  renderArticleCover();
  renderArticlePreview();
  openAcc('accArticles');
  document.getElementById('arTitle').scrollIntoView({ behavior:'smooth', block:'center' });
}

document.getElementById('arCancelBtn').addEventListener('click', resetArticleForm);

async function uploadArticleCover(blob){
  // הקידומת היא מזהה הסוכן/ת, כמו בכל שאר ההעלאות מה-CRM: זה הנתיב
  // שמדיניות ה-Storage של ה-bucket מצפה לו.
  const name = `${currentAgent.id}/articles/${crypto.randomUUID()}.${imageBlobExt(blob)}`;
  const { error } = await sb.storage.from(ARTICLES_BUCKET).upload(name, blob, {
    contentType:imageBlobType(blob), cacheControl:'31536000', upsert:false,
  });
  if (error) throw error;
  return sb.storage.from(ARTICLES_BUCKET).getPublicUrl(name).data.publicUrl;
}

/* ‏status הוא הפרמטר היחיד שמבדיל בין שני הכפתורים. published_at נקבע
   בטריגר בצד ה-DB, ולכן עדכון של כתבה שכבר פורסמה לא מקפיץ אותה מחדש
   לראש הרצועה. */
async function saveArticle(status){
  const title = document.getElementById('arTitle').value.trim();
  if (!title){ showToast('נדרשת כותרת לכתבה'); return; }

  const saveBtn = document.getElementById('arSaveBtn');
  const publishBtn = document.getElementById('arPublishBtn');
  const feedback = document.getElementById('arFeedback');
  saveBtn.disabled = publishBtn.disabled = true;
  feedback.textContent = 'שומר…';

  try{
    let coverUrl = articleState.cover ? (articleState.cover.url || null) : null;
    if (articleState.cover && articleState.cover.blob){
      coverUrl = await uploadArticleCover(articleState.cover.blob);
    }

    const payload = {
      title,
      subtitle:    document.getElementById('arSubtitle').value.trim() || null,
      category:    document.getElementById('arCategory').value.trim() || null,
      body:        document.getElementById('arBody').value.trim() || null,
      author_name: document.getElementById('arAuthor').value.trim() || null,
      cover_url:   coverUrl,
      status,
    };

    let error;
    if (articleState.editingId){
      ({ error } = await sb.from('articles').update(payload).eq('id', articleState.editingId));
    } else {
      payload.created_by = currentAgent ? currentAgent.id : null;
      ({ error } = await sb.from('articles').insert(payload));
    }
    if (error) throw error;

    // התמונות שהוחלפו נמחקות רק עכשיו, אחרי שהשורה כבר לא מצביעה עליהן
    if (articleState.pendingDeletes.length){
      sb.storage.from(ARTICLES_BUCKET).remove(articleState.pendingDeletes).catch(()=>{});
    }

    resetArticleForm();
    showToast(status === 'published' ? 'הכתבה פורסמה באתר' : 'הכתבה נשמרה כטיוטה');
    await loadArticlesAdmin();
  } catch(err){
    console.warn('שמירת כתבה נכשלה:', err);
    feedback.textContent = 'שגיאה: ' + (err.message || 'לא ניתן לשמור');
  } finally {
    saveBtn.disabled = publishBtn.disabled = false;
  }
}

document.getElementById('articleForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  saveArticle('draft');
});
document.getElementById('arPublishBtn').addEventListener('click', ()=> saveArticle('published'));

/* ---------- לידים ללא יעד (מנהל פלטפורמה) ----------
   ‏lead_routing_open הוא ה-view של יומן ניתוב הלידים: כל ליד שנקלט מווידג'ט
   כלשהו ולא נמצא לו קהל, וטרם טופל. ה-view הוא security_invoker ונשען על
   ה-policy של הטבלה, ולכן סוכן/ת רגיל/ה שיפתח/תפתח אותו יקבל/תקבל רשימה
   ריקה ולא שגיאה.

   אין כאן שם או טלפון של אף פונה: היומן מתאר את *הניתוב*, לא את הליד. */
const UNROUTED_KIND_LABELS = {
  agent_owner:'ליד בעל/ת נכס',
  agent_buyer:'ליד מחפש/ת דירה',
  mortgage_advisor:'ליד ייעוץ משכנתאות',
};
const UNROUTED_REASONS = {
  no_mortgage_advisor:'אין יועצ/ת משכנתאות רשומ/ה בפלטפורמה',
  no_eligible_agents:'אין סוכני PROFESSIONAL/Elite עם העדפות לידים פעילות',
  no_matching_agent_preferences:'יש סוכנים, אך אף אחד לא מוגדר לאזור/סוג הנכס הזה',
  no_active_agents:'אין סוכנים פעילים שיכולים לקנות את הליד',
  below_min_intent:'ציון ההתעניינות נמוך מהסף למדף מחפשי הדירה',
  agency_without_active_member:'הליד הגיע מדף משרד שאין בו סוכן/ת פעיל/ה',
};
const UNROUTED_SOURCES = {
  homepage_owner_wizard:'אשף הערכת שווי (דף הבית)',
  homepage_buyer_wizard:'באנר מחפשי נכס (דף הבית)',
  homepage_search_agent:'הסוכן החכם (תוצאות חיפוש)',
  homepage_mortgage_calc:'מחשבון משכנתא (דף הבית)',
  property_page_mortgage_calc:'מחשבון משכנתא (דף נכס)',
  homepage_yield_calc:'מחשבון תשואה (דף הבית)',
  agency_page_owner_wizard:'הערכת שווי (דף משרד)',
  agency_page_yield_calc:'מחשבון תשואה (דף משרד)',
};

async function loadUnroutedLeads(){
  const listEl = document.getElementById('unroutedLeadsList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('lead_routing_open')
    .select('id, created_at, source, lead_kind, lead_table, lead_id, recipients, reason, summary, city, deal_type, property_type, audience_now')
    .limit(50);

  if (error){
    // 42P01 = ה-view עדיין לא קיים, כלומר המיגרציה טרם רצה על המסד
    listEl.innerHTML = '<div class="empty-state">' +
      (error.code === '42P01'
        ? 'יומן ניתוב הלידים לא קיים עדיין - הריצו את המיגרציה 20260913090000_lead_routing.sql ב-Supabase.'
        : 'שגיאה: ' + error.message) + '</div>';
    return;
  }

  const rows = data || [];
  accSetCount('accUnroutedLeads',
    rows.length ? plural(rows.length, 'ליד אחד ממתין', 'ממתינים') : '');

  if (!rows.length){
    listEl.innerHTML = '<div class="empty-state">כל הלידים שנקלטו מצאו יעד. 🎯</div>';
    return;
  }

  listEl.innerHTML = '';
  rows.forEach(row => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--line)';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    const title = document.createElement('strong');
    title.style.fontSize = '.9rem';
    title.textContent = UNROUTED_KIND_LABELS[row.lead_kind] || 'ליד';
    head.appendChild(title);
    const when = document.createElement('span');
    when.style.cssText = 'font-size:.72rem;color:var(--ink-soft)';
    when.textContent = new Date(row.created_at).toLocaleString('he-IL', { dateStyle:'short', timeStyle:'short' });
    head.appendChild(when);
    // קהל שגדל מאז מסמן ליד שאפשר לשחרר עכשיו — זו הפעולה, לא רק המידע
    if (row.audience_now > 0){
      const ready = document.createElement('span');
      ready.className = 'status-pill status-shared';
      ready.textContent = 'יש קהל עכשיו (' + row.audience_now + ')';
      head.appendChild(ready);
    }
    item.appendChild(head);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:.78rem;color:var(--ink-soft);margin-top:4px;line-height:1.6';
    meta.textContent = [
      UNROUTED_SOURCES[row.source] || row.source,
      row.summary,
      UNROUTED_REASONS[row.reason] || row.reason,
    ].filter(Boolean).join(' · ');
    item.appendChild(meta);

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-ghost';
    done.style.cssText = 'margin-top:8px;font-size:.78rem;padding:7px 14px';
    done.textContent = 'סימון כטופל';
    done.addEventListener('click', async ()=>{
      done.disabled = true;
      const { error: upErr } = await sb.from('lead_routing_log')
        .update({ resolved_at: new Date().toISOString(), resolved_by: currentAgent.id })
        .eq('id', row.id);
      if (upErr){ done.disabled = false; alert('העדכון נכשל: ' + upErr.message); return; }
      await loadUnroutedLeads();
    });
    item.appendChild(done);

    listEl.appendChild(item);
  });
}

/* ==========================================================================
   לוח הבקרה החודשי של מנהל/ת הפלטפורמה
   --------------------------------------------------------------------------
   קריאה אחת ל-RPC ‏platform_admin_monthly_report מחזירה את כל הדוח: שורה
   לכל חודש בחלון, תמונת "עכשיו" מצטברת, התור הפתוח ופירוט לפי משרד. ה-RPC
   הוא security definer שמחזיר מספרים בלבד — הוא עוקף את ה-RLS בכוונה, כי
   ‏agency_members, leads ו-lead_charges חסומות בפני מנהל/ת פלטפורמה בדיוק
   כמו בפני כל אחד אחר, וזה נכון שהן יישארו כך. ראו את המיגרציה
   ‏20260916090000_platform_admin_dashboard.sql.

   כל ההשוואות ("עלייה/ירידה") נגזרות כאן ולא ב-SQL: הן תמיד בין החודש
   האחרון בחלון לזה שלפניו, ואין טעם שהשרת יחשב מה שממילא יושב בשתי שורות
   סמוכות של אותו מערך.
   ========================================================================== */
const ADM_MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                         'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

/* סוגי הלידים, בסדר שבו מנהל/ת הפלטפורמה חושב/ת עליהם: קודם מה שנכנס
   מהאתר עצמו, ואחר כך המדפים שנמכרים. המפתחות תואמים ל-jsonb שחוזר מה-RPC. */
const ADM_LEAD_TYPES = [
  { key:'property_inquiry',     label:'פנייה על נכס',        sub:'מתעניין/ת שהשאיר/ה פרטים בדף נכס' },
  { key:'owner_inbound',        label:'ליד בעל/ת נכס',       sub:'מוכר/משכיר מאשף הערכת השווי' },
  { key:'agent_direct_inquiry', label:'פנייה ישירה',         sub:'מדף הסוכן/ת או מדף המשרד' },
  { key:'visualization',        label:'בקשת הדמיה',          sub:'גולש/ת שביקש/ה הדמיית עיצוב' },
  { key:'saved_search',         label:'מחפש/ת דירה',         sub:'חיפוש שמור - ליד קונה מובנה' },
  { key:'mortgage',             label:'ייעוץ משכנתאות',      sub:'מחשבון המשכנתא בדף הבית ובדף נכס' },
  { key:'rss',                  label:'ליד ממדף ה-RSS',      sub:'פוסט חיצוני שסווג כליד אמיתי' },
];

/* מקורות ההכנסה. קידום נכסים אינו מכירת ליד ולכן הוא אחרון ומסומן ככזה —
   ערבוב שלו לתוך "הכנסות מלידים" היה מייפה את המספר שהוא לא. */
const ADM_REVENUE_SOURCES = [
  { key:'site_leads',   label:'פתיחת לידים מהאתר',      sub:'חיוב על פתיחת ליד משויך' },
  { key:'saved_search', label:'מכירת לידי מחפשי דירה',  sub:'מדף החיפושים השמורים' },
  { key:'mortgage',     label:'מכירת לידי משכנתאות',    sub:'מדף יועצי המשכנתאות' },
  { key:'rss_leads',    label:'מכירת לידים ממדף RSS',   sub:'לידים שנאספו מפידים חיצוניים' },
  { key:'promotions',   label:'קידום נכסים',            sub:'לא מכירת ליד - מוצג בנפרד' },
];

/* התור הפתוח. ‏goto מוגדר רק היכן שיש באמת לאן ללכת: "לידים ללא טיפול"
   אינם הלידים *שלי*, ולכן קישור ל-accLeads היה מוביל למסך אחר לגמרי. */
const ADM_QUEUE = [
  { key:'site_leads',      label:'לידי אתר שלא נפתחו',   sub:'משויכים לסוכן/ת וממתינים לפתיחה' },
  { key:'unrouted',        label:'לידים ללא יעד',         sub:'נקלטו ואין קהל שיקבל אותם', goto:'accUnroutedLeads' },
  { key:'mortgage_leads',  label:'לידי משכנתאות בחנות',   sub:'ממתינים ליועצ/ת שירכוש/תרכוש' },
  { key:'saved_searches',  label:'מחפשי דירה בחנות',      sub:'חיפושים שמורים שטרם נמכרו',   goto:'accLeadShelf' },
  { key:'rss_leads',       label:'לידי RSS בחנות',        sub:'לידים חיצוניים שטרם נמכרו',   goto:'accLeadShelf' },
  { key:'reviews_pending', label:'ביקורות לאישור',        sub:'חוות דעת שממתינות למודרציה' },
];

const admInt   = n => Number(n || 0).toLocaleString('he-IL');
const admMoney = n => '₪' + Math.round(Number(n) || 0).toLocaleString('he-IL');

function admMonthLabel(ym, short){
  const [y, m] = String(ym || '').split('-');
  const name = ADM_MONTH_NAMES[Number(m) - 1] || ym;
  return short ? name.slice(0, 3) + '׳' + String(y).slice(2) : name + ' ' + y;
}

function admEl(tag, cls, text){
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

/* חץ ההשוואה מול החודש הקודם. שלושה מצבים בלבד, וכל אחד מהם אומר משהו אחר:
   ‏"חדש" = היה אפס ועכשיו יש, אחוז = יש ממה להשוות, "ללא שינוי" = זהה או
   שני החודשים אפס. אחוז מתוך אפס אינו מספר, ולכן הוא לא מוצג כאחוז. */
function admDeltaChip(current, previous){
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const chip = admEl('span', 'adm-delta');
  if (cur === prev){
    chip.classList.add('flat');
    chip.textContent = '- ללא שינוי';
    return chip;
  }
  if (prev === 0){
    chip.classList.add('up');
    chip.textContent = '▲ חדש החודש';
    return chip;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  chip.classList.add(pct > 0 ? 'up' : 'down');
  chip.textContent = (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%';
  chip.title = 'החודש ' + admInt(cur) + ' · בחודש הקודם ' + admInt(prev);
  return chip;
}

function admTile(label, value, opts){
  const o = opts || {};
  const tile = admEl('div', 'adm-tile' + (o.wine ? ' adm-tile-wine' : ''));
  tile.appendChild(admEl('span', 'adm-tile-lbl', label));
  tile.appendChild(admEl('span', 'adm-tile-val', value));
  const foot = admEl('div', 'adm-tile-foot');
  if (o.delta) foot.appendChild(o.delta);
  if (o.note) foot.appendChild(admEl('span', null, o.note));
  tile.appendChild(foot);
  return tile;
}

function admBlock(title, note){
  const block = admEl('section', 'adm-block');
  block.appendChild(admEl('h3', 'adm-h', title));
  if (note) block.appendChild(admEl('p', 'adm-note', note));
  return block;
}

/* שורת נתון עם פס יחס. ‏share הוא החלק מתוך הסך הכל של החודש — הפס הוא מה
   שהופך "12" ו-"3" לתמונה במקום לשני מספרים. */
function admRow(name, sub, value, share, delta, isTotal){
  const row = admEl('div', 'adm-row' + (isTotal ? ' adm-row-total' : ''));
  const nameCell = admEl('div', 'adm-row-name', name);
  if (sub) nameCell.appendChild(admEl('small', null, sub));
  row.appendChild(nameCell);
  if (delta) row.appendChild(delta); else row.appendChild(admEl('span'));
  row.appendChild(admEl('span', 'adm-row-val', value));
  if (share !== null && share !== undefined){
    const bar = admEl('div', 'adm-bar');
    const fill = admEl('span');
    fill.style.width = Math.max(0, Math.min(100, share)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
  }
  return row;
}

/* גרף עמודות פשוט: עמודה לכל חודש, גובה יחסי לחודש הגבוה בחלון. החודש
   הנוכחי מסומן בזהב כי הוא היחיד שעדיין לא נגמר — השוואה שלו לחודש מלא
   תמיד "נמוכה", וחשוב שזה ייראה. */
function admChart(months, pick, format){
  const values = months.map(pick);
  const max = Math.max(1, ...values);
  const wrap = admEl('div');
  const chart = admEl('div', 'adm-chart');
  values.forEach((v, i)=>{
    const col = admEl('div', 'adm-col');
    const bar = admEl('div', 'adm-col-bar' + (i === values.length - 1 ? ' is-now' : ''));
    bar.style.height = Math.max(3, Math.round((v / max) * 100)) + '%';
    bar.title = admMonthLabel(months[i].month) + ': ' + format(v);
    col.appendChild(bar);
    chart.appendChild(col);
  });
  wrap.appendChild(chart);
  const axis = admEl('div', 'adm-axis');
  months.forEach(m => axis.appendChild(admEl('span', null, admMonthLabel(m.month, true))));
  wrap.appendChild(axis);
  return wrap;
}

let adminReportMonths = 6;
let adminReportBusy = false;

async function loadAdminReport(){
  const host = document.getElementById('adminReport');
  if (!host || adminReportBusy) return;
  adminReportBusy = true;
  const refreshBtn = document.getElementById('adminRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  host.innerHTML = '<div class="empty-state">טוען את נתוני הפלטפורמה…</div>';

  const { data, error } = await sb.rpc('platform_admin_monthly_report', { p_months: adminReportMonths });

  adminReportBusy = false;
  if (refreshBtn) refreshBtn.disabled = false;

  if (error){
    // ‏PGRST202/42883 = הפונקציה לא קיימת, כלומר המיגרציה טרם רצה על המסד
    // (‏PostgREST מחזיר את הראשון כשהיא חסרה מ-schema cache).
    // ‏42501 = הפונקציה קיימת וסירבה: החשבון אינו מנהל/ת פלטפורמה.
    host.innerHTML = '';
    const msg = (error.code === '42883' || error.code === 'PGRST202')
      ? 'הדוח לא קיים עדיין במסד - הריצו את המיגרציה 20260916090000_platform_admin_dashboard.sql.'
      : (error.code === '42501' || /not_platform_admin/.test(error.message || ''))
        ? 'הדוח פתוח למנהל/ת פלטפורמה בלבד.'
        : 'שגיאה בטעינת הדוח: ' + error.message;
    host.appendChild(admEl('div', 'empty-state', msg));
    dashPanelsMeasure();
    return;
  }

  renderAdminReport(data || {});
  loadAdminPwaReport();
}

/* ---------- התקנות האפליקציה (PWA) ----------
   ‏RPC נפרד ולא ענף בדוח החודשי: הדוח החודשי עונה על שאלות של כסף וקהל
   והוא כבר ארוך, ולהתקנות יש חלון זמן משלהן. הבלוק נוסף בסוף הפאנל אחרי
   שהדוח כבר צויר, ולכן הוא מגיע רגע אחריו ולא מעכב אותו.

   ‏**למה המספרים כאן אינם זהים ל-GA4, וזה לא באג:** המונה הזה במסד סופר
   גם את מי שיש לו/ה חוסם פרסומות (שם GTM כלל לא נטען) וגם התקנות מתוך
   ה-CRM (שאינו טוען את events.js במכוון). המספר כאן יהיה תמיד **גבוה
   יותר**, והוא הנכון מבין השניים לשאלה "כמה התקינו".

   חלון הזמן נגזר מבורר החודשים של הפאנל, כדי שלא יהיה בורר שני שאומר
   משהו אחר על אותו מסך. הפרטים: docs/pwa-install.md */
const PWA_MODE_LABELS = {
  'prompt':     'אנדרואיד / כרום',
  'ios':        'אייפון - ספארי',
  'ios-other':  'אייפון - דפדפן אחר',
  'in-app':     'דפדפן פנימי (פייסבוק/אינסטגרם)',
  'mac-safari': 'מק - ספארי',
  'unknown':    'לא ידוע',
};

async function loadAdminPwaReport(){
  const host = document.getElementById('adminReport');
  if (!host) return;

  const { data, error } = await sb.rpc('platform_pwa_report',
    { p_days: adminReportMonths * 30 });

  const block = admBlock('האפליקציה במסך הבית (PWA)',
    'כמה אנשים ראו את ההצעה להתקין וכמה הגיעו עד הסוף. נספר במסד שלנו ולא ב-GA4, ולכן כולל גם גולשים עם חוסם פרסומות וגם התקנות מתוך ה-CRM.');

  if (error){
    // ‏PGRST202/42883 = הפונקציה טרם קיימת במסד (המיגרציה לא רצה עדיין).
    // זו אינה שגיאה שצריך להבהיל בגללה: הדשבורד שלם בלעדיה.
    const msg = (error.code === '42883' || error.code === 'PGRST202')
      ? 'מונה ההתקנות טרם קיים במסד - הריצו את המיגרציה 20261124090000_pwa_install_events.sql.'
      : 'שגיאה בטעינת מונה ההתקנות: ' + error.message;
    block.appendChild(admEl('div', 'empty-state', msg));
    host.appendChild(block);
    dashPanelsMeasure();
    return;
  }

  const rep     = data || {};
  const funnel  = rep.funnel || {};
  const days    = Number(rep.window_days) || 30;
  const shown   = Number(funnel.banner_shown)  || 0;
  const clicked = Number(funnel.install_click) || 0;
  const helped  = Number(funnel.help_open)     || 0;
  const done    = Number(funnel.installed)     || 0;

  block.appendChild(admEl('p', 'adm-legend',
    'סך ההתקנות שהושלמו מאז ומתמיד: ' + admInt(rep.installed_total) +
    ' · בחלון של ' + plural(days, 'יום אחד', 'ימים', admInt(days)) + ': ' + admInt(done)));

  /* המשפך. ‏share הוא החלק מתוך "ראו את ההצעה" — בלי הפס האלה ארבעה
     מספרים נפרדים, ואי אפשר לראות איפה אנשים נושרים. */
  const pct = n => (shown > 0 ? (n / shown) * 100 : 0);
  const rows = admEl('div', 'adm-rows');
  rows.appendChild(admRow('ראו את ההצעה', 'הרצועה עלתה בתחתית הדף', admInt(shown), 100));
  rows.appendChild(admRow('לחצו על הכפתור', null, admInt(clicked), pct(clicked)));
  rows.appendChild(admRow('פתחו את ההסבר', 'אייפון ומק - שם אין התקנה בלחיצה', admInt(helped), pct(helped)));
  rows.appendChild(admRow('אישרו בדיאלוג המערכת', null, admInt(funnel.accepted), pct(Number(funnel.accepted) || 0)));
  rows.appendChild(admRow('התקנות שהושלמו', 'הדפדפן דיווח appinstalled', admInt(done), pct(done), null, true));
  block.appendChild(rows);

  /* ‏אייפון הוא הסיפור שהטבלה הזו מספרת: שם לא ייתכן "התקנות שהושלמו",
     כי הדפדפן אינו מדווח על "הוספה למסך הבית". "פתחו הסבר" הוא הקצה של
     המדידה שם, ולכן הוא טור נפרד ולא חלק מאותו משפך. */
  const byPlatform = Array.isArray(rep.by_platform) ? rep.by_platform : [];
  if (byPlatform.length){
    const wrap = admEl('div', 'adm-table-wrap');
    const table = admEl('table', 'adm-table');
    const thead = admEl('thead');
    const hrow = admEl('tr');
    /* "הותקנו" הוא העמודה השנייה ולא האחרונה, ו"לחצו" ירד מכאן (הוא כבר
       במשפך למעלה): בטלפון הטבלה גוללת לרוחב, וחמש עמודות דחפו דווקא את
       המספר שבגללו פותחים את הבלוק אל מחוץ למסך. */
    ['מסלול','הותקנו','פתחו הסבר','ראו'].forEach(h => hrow.appendChild(admEl('th', null, h)));
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = admEl('tbody');
    byPlatform.forEach(row => {
      const tr = admEl('tr');
      tr.appendChild(admEl('td', null, PWA_MODE_LABELS[row.platform] || row.platform));
      tr.appendChild(admEl('td', null, admInt(row.installed)));
      tr.appendChild(admEl('td', null, admInt(row.helped)));
      tr.appendChild(admEl('td', null, admInt(row.shown)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);
  }

  /* מאיזה דף מתקינים בפועל — זו השאלה שקובעת לאן כדאי להחזיר את הכפתור */
  const byPage = Array.isArray(rep.by_page) ? rep.by_page : [];
  if (byPage.length){
    block.appendChild(admEl('p', 'adm-legend', 'מאיזה דף לוחצים על ההתקנה'));
    const facts = admEl('div', 'adm-facts');
    byPage.forEach(row => {
      const fact = admEl('div', 'adm-fact');
      fact.appendChild(admEl('span', 'adm-fact-lbl', row.page));
      fact.appendChild(admEl('span', 'adm-fact-val', admInt(row.clicked) + ' לחיצות'));
      facts.appendChild(fact);
    });
    block.appendChild(facts);
  }

  if (!shown && !clicked && !done){
    block.appendChild(admEl('div', 'empty-state',
      'עדיין לא נרשמו אירועי התקנה בחלון הזה. הרצועה עולה רק בדפדפן שיודע להתקין, ורק למי שלא סגר/ה אותה בשבועיים האחרונים.'));
  }

  host.appendChild(block);
  dashPanelsMeasure();
}

function renderAdminReport(report){
  const host = document.getElementById('adminReport');
  if (!host) return;
  host.innerHTML = '';

  const months = Array.isArray(report.months) ? report.months : [];
  if (!months.length){
    host.appendChild(admEl('div', 'empty-state', 'אין עדיין נתונים להצגה.'));
    dashPanelsMeasure();
    return;
  }
  const now  = months[months.length - 1];
  const prev = months.length > 1 ? months[months.length - 2] : null;
  const zero = { leads:{}, revenue:{} };
  const prevSafe = prev || zero;
  const totals = report.totals || {};
  const queue  = report.untreated || {};

  const stamp = document.getElementById('adminStamp');
  if (stamp && report.generated_at){
    stamp.textContent = 'עודכן ' + new Date(report.generated_at)
      .toLocaleString('he-IL', { dateStyle:'short', timeStyle:'short' });
  }

  /* ---- 1. ארבעת המספרים של החודש ---- */
  const tiles = admEl('div', 'adm-tiles');
  tiles.appendChild(admTile('משרדים שהצטרפו', admInt(now.agencies_new), {
    delta: admDeltaChip(now.agencies_new, prevSafe.agencies_new),
    note: 'סה״כ ' + admInt(totals.agencies) + ' במערכת',
  }));
  tiles.appendChild(admTile('סוכנים שהצטרפו', admInt(now.agents_new), {
    delta: admDeltaChip(now.agents_new, prevSafe.agents_new),
    note: 'סה״כ ' + plural(totals.agents_active, 'סוכן/ת אחד/ת פעיל/ה', 'פעילים',
                          admInt(totals.agents_active)),
  }));
  tiles.appendChild(admTile('לידים שנקלטו', admInt(now.leads_total), {
    delta: admDeltaChip(now.leads_total, prevSafe.leads_total),
    note: plural(admQueueTotal(queue), 'ליד אחד ממתין לטיפול', 'ממתינים לטיפול',
                 admInt(admQueueTotal(queue))),
  }));
  tiles.appendChild(admTile('הכנסות החודש', admMoney(now.revenue_total), {
    wine: true,
    delta: admDeltaChip(now.revenue_total, prevSafe.revenue_total),
    note: 'טעינות ארנק: ' + admMoney(now.topups),
  }));
  host.appendChild(tiles);

  /* ---- 2. לידים לפי סוג, עם חץ מול החודש הקודם ---- */
  const leadsBlock = admBlock('לידים לפי סוג · ' + admMonthLabel(now.month),
    'החץ משווה לחודש הקודם (' + (prev ? admMonthLabel(prev.month) : 'אין נתוני השוואה') + '). הפס מציג את חלקו של כל סוג מסך הלידים החודש.');
  const leadRows = admEl('div', 'adm-rows');
  const leadTotal = Number(now.leads_total) || 0;
  ADM_LEAD_TYPES.forEach(type=>{
    const cur = Number((now.leads || {})[type.key]) || 0;
    const was = Number((prevSafe.leads || {})[type.key]) || 0;
    leadRows.appendChild(admRow(
      type.label, type.sub, admInt(cur),
      leadTotal ? (cur / leadTotal) * 100 : 0,
      admDeltaChip(cur, was)));
  });
  leadRows.appendChild(admRow('סך הלידים החודש', null, admInt(leadTotal), null,
    admDeltaChip(leadTotal, prevSafe.leads_total), true));
  leadsBlock.appendChild(leadRows);
  host.appendChild(leadsBlock);

  /* ---- 3. התור הפתוח ---- */
  const queueBlock = admBlock('ממתין לטיפול עכשיו',
    'זהו תור פתוח ולא נתון חודשי: כל מה שנקלט ואיש עדיין לא נגע בו, בלי קשר למועד.'
    + (queue.oldest_days
        ? ' הליד הוותיק ביותר שלא נפתח ממתין '
          + plural(queue.oldest_days, 'יום אחד', 'ימים', admInt(queue.oldest_days)) + '.'
        : ''));
  const queueGrid = admEl('div', 'adm-queue');
  ADM_QUEUE.forEach(item=>{
    const count = Number(queue[item.key]) || 0;
    const card = admEl(item.goto && count ? 'button' : 'div',
      'adm-q' + (count ? ' is-hot' : ' is-clear'));
    if (item.goto && count){
      card.type = 'button';
      card.dataset.goto = item.goto;
    }
    card.appendChild(admEl('span', 'adm-q-val', admInt(count)));
    card.appendChild(admEl('span', 'adm-q-lbl', item.label));
    card.appendChild(admEl('span', 'adm-q-sub', item.sub));
    queueGrid.appendChild(card);
  });
  queueBlock.appendChild(queueGrid);
  host.appendChild(queueBlock);

  /* ---- 4. הכנסות לפי מקור ---- */
  const revBlock = admBlock('הכנסות לפי מקור · ' + admMonthLabel(now.month),
    'הכנסה = חיוב שנגבה בפועל. טעינת ארנק אינה הכנסה - היא כסף שנכנס לארנק ועדיין שייך לסוכן/ת, ולכן היא מוצגת בשורה נפרדת ולא מסתכמת לסך הכל.');
  const revRows = admEl('div', 'adm-rows');
  const revTotal = Number(now.revenue_total) || 0;
  ADM_REVENUE_SOURCES.forEach(src=>{
    const cur = (now.revenue || {})[src.key] || {};
    const was = (prevSafe.revenue || {})[src.key] || {};
    const amount = Number(cur.amount) || 0;
    const count  = Number(cur.count) || 0;
    revRows.appendChild(admRow(
      src.label,
      src.sub + (count ? ' · ' + admInt(count) + ' חיובים' : ' · אין חיובים החודש'),
      admMoney(amount),
      revTotal ? (amount / revTotal) * 100 : 0,
      admDeltaChip(amount, Number(was.amount) || 0)));
  });
  revRows.appendChild(admRow('סך ההכנסות החודש', null, admMoney(revTotal), null,
    admDeltaChip(revTotal, prevSafe.revenue_total), true));
  revRows.appendChild(admRow('טעינות ארנק (תזרים, לא הכנסה)', null, admMoney(now.topups), null,
    admDeltaChip(now.topups, prevSafe.topups)));
  revBlock.appendChild(revRows);
  host.appendChild(revBlock);

  /* ---- 5. מגמה על פני החלון ---- */
  const trendBlock = admBlock(
    'מגמה - ' + plural(months.length, 'החודש האחרון', 'חודשים אחרונים', admInt(months.length)),
    'העמודה הזהובה היא החודש הנוכחי, שעדיין לא הסתיים - הוא תמיד ייראה נמוך מחודש מלא.');
  trendBlock.appendChild(admEl('p', 'adm-legend', 'לידים שנקלטו בכל חודש'));
  trendBlock.appendChild(admChart(months, m => Number(m.leads_total) || 0, admInt));
  trendBlock.appendChild(admEl('p', 'adm-legend', 'הכנסות בכל חודש'));
  trendBlock.appendChild(admChart(months, m => Number(m.revenue_total) || 0, admMoney));
  host.appendChild(trendBlock);

  /* ---- 6. עוד מידע שחשוב לדעת ---- */
  const windowSum = key => months.reduce((s, m) => s + (Number(m[key]) || 0), 0);
  const factsBlock = admBlock('עוד מידע על הפלטפורמה', 'ה"סה״כ" הוא מצב עכשיו; מה שמסומן "בחלון" מסכם את כל החודשים בטווח שנבחר.');
  const facts = admEl('div', 'adm-facts');
  [
    ['משרדים במערכת',            admInt(totals.agencies)],
    ['סוכנים פעילים',            admInt(totals.agents_active) + ' מתוך ' + admInt(totals.agents)],
    ['מנהלי משרד',               admInt(totals.managers)],
    ['פילוח מסלולים',            Tiers.label('free') + ' ' + admInt(totals.tier_free) +
                                 ' · ' + Tiers.label('mid') + ' ' + admInt(totals.tier_mid) +
                                 ' · ' + Tiers.label('premium') + ' ' + admInt(totals.tier_premium)],
    ['יועצי משכנתאות רשומים',    admInt(totals.mortgage_advisors)],
    ['הזמנות סוכנים פתוחות',     admInt(totals.pending_invitations)],
    ['נכסים פעילים באתר',        admInt(totals.properties_active) + ' מתוך ' + admInt(totals.properties_total)],
    ['נכסים בקידום בתשלום',      admInt(totals.properties_promoted)],
    ['נכסים חדשים בחלון',        admInt(windowSum('properties_new'))],
    ['עסקאות שנסגרו בחלון',      admInt(windowSum('deals_closed')) + ' · ' + admMoney(windowSum('deals_volume'))],
    ['הכנסות מצטברות בחלון',     admMoney(windowSum('revenue_total'))],
    ['יתרות בארנקי הסוכנים',     admMoney(totals.wallet_balance)],
    ['חיפושים שמורים פעילים',    admInt(totals.saved_searches)],
    ['נרשמים לניוזלטר',          admInt(totals.newsletter) + ' · ' + admInt(windowSum('newsletter_new')) + ' בחלון'],
    ['ביקורות שהתקבלו בחלון',    admInt(windowSum('reviews_new'))],
  ].forEach(([label, value])=>{
    const fact = admEl('div', 'adm-fact');
    fact.appendChild(admEl('span', 'adm-fact-lbl', label));
    fact.appendChild(admEl('span', 'adm-fact-val', value));
    facts.appendChild(fact);
  });
  factsBlock.appendChild(facts);
  host.appendChild(factsBlock);

  /* ---- 7. פירוט לפי משרד ---- */
  const agencies = Array.isArray(report.agencies) ? report.agencies : [];
  if (agencies.length){
    const agencyBlock = admBlock('משרדים - פעילות בחלון הנבחר',
      'ההכנסה כאן היא רכישות לידים בלבד (פתיחה, מדף RSS, משכנתאות ומחפשי דירה). קידום נכסים אינו משויך למשרד ולכן אינו נספר בטור הזה.');
    const wrap = admEl('div', 'adm-table-wrap');
    const table = admEl('table', 'adm-table');
    const thead = admEl('thead');
    const hrow = admEl('tr');
    ['משרד','סוכנים פעילים','בתשלום','נכסים פעילים','רכישות','הכנסה'].forEach(h => hrow.appendChild(admEl('th', null, h)));
    thead.appendChild(hrow);
    table.appendChild(thead);
    const tbody = admEl('tbody');
    agencies.forEach(a=>{
      const tr = admEl('tr');
      tr.appendChild(admEl('td', null, a.name || '-'));
      tr.appendChild(admEl('td', 'num', admInt(a.members)));
      tr.appendChild(admEl('td', 'num', admInt(a.paid_members)));
      tr.appendChild(admEl('td', 'num', admInt(a.active_properties)));
      tr.appendChild(admEl('td', 'num', admInt(a.purchases)));
      tr.appendChild(admEl('td', 'num', admMoney(a.revenue)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    agencyBlock.appendChild(wrap);
    host.appendChild(agencyBlock);
  }

  /* כותרת הפאנל היא התקציר שרואים כשהוא מכווץ — זה מה שהופך "עוד פאנל
     סגור" ל"יש משהו שדורש תשומת לב". */
  const sub = document.getElementById('adminPanelSub');
  if (sub){
    sub.textContent = admMonthLabel(now.month)
      + ' · ' + plural(now.leads_total, 'ליד אחד', 'לידים', admInt(now.leads_total)) + ' · '
      + admMoney(now.revenue_total) + ' · '
      + plural(admQueueTotal(queue), 'ליד אחד ממתין לטיפול', 'ממתינים לטיפול',
               admInt(admQueueTotal(queue)));
  }

  dashPanelsMeasure();
}

/* סך התור הפתוח. ‏site_unassigned אינו נספר כאן: ליד בלי סוכן/ת כבר נספר
   ב-site_leads (הוא גם לא נפתח), וספירה כפולה הייתה מנפחת את המספר. */
function admQueueTotal(queue){
  return ADM_QUEUE.reduce((sum, item) => sum + (Number(queue[item.key]) || 0), 0);
}

/* ‏#dashPanelAdmin ולא ‏.adm-range לבדו: פאנל הלידים משתמש באותו רכיב בורר
   בדיוק, ובורר לא מתוחם היה מסמן את הכפתור הנכון בשני הפאנלים וטוען את
   הדוח הלא נכון. */
document.querySelectorAll('#dashPanelAdmin .adm-range button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    adminReportMonths = Number(btn.dataset.months) || 6;
    document.querySelectorAll('#dashPanelAdmin .adm-range button')
      .forEach(b => b.classList.toggle('is-on', b === btn));
    loadAdminReport();
  });
});
document.getElementById('adminRefreshBtn').addEventListener('click', loadAdminReport);

/* ==========================================================================
   בקרת מנוע הלידים — הפאנל השלישי
   --------------------------------------------------------------------------
   הדוח החודשי (‏renderAdminReport למעלה) סופר לידים לפי *סוג*, כלומר לפי
   הקהל שהם מיועדים לו. כאן השאלה הפוכה: מאיפה הם *הגיעו*. שתי השאלות
   נראות דומות ואינן — באנר אחד בדף הבית מזין שלושה סוגי לידים, ואותו סוג
   ליד נכנס משבעה מקומות שונים.

   הכל מגיע מקריאה אחת ל-platform_lead_report; ראו את המיגרציה
   ‏20261122090000_lead_analytics.sql להסבר על שרשרת שיוך המקור ועל
   הגדרת הטריות.                                                          */

/* התוויות בעברית יושבות כאן ולא במסד, כמו ב-ADM_LEAD_TYPES: המסד מחזיר
   מפתחות, והדפדפן מתרגם. ‏lxLabel נופל למפתח הגולמי ולא ל"אחר" — מקור חדש
   שנולד בקוד של הווידג'טים ואין לו עדיין שורה כאן חייב להופיע בדוח בשמו
   ולא להיעלם לתוך דלי אנונימי. */
const LX_CHANNELS = {
  homepage:      'הבאנרים בדף הבית',
  property_page: 'דף הנכס',
  agency_page:   'דף המשרד',
  agent_page:    'דף הסוכן/ת',
  whatsapp_bot:  'הבוט בוואטסאפ',
  footer:        'באנר הפוטר',
  project_page:  'דפי הפרויקטים',
  open_house:    'יריד הבתים הפתוחים',
  rss_engine:    'מנוע ה-RSS',
  unattributed:  'ללא שיוך מקור',
  other:         'אחר',
};

/* צבע לכל ערוץ — בסדר קבוע, ולעולם לא לפי דירוג.
   ערוץ שנעלם מהחלון לא צובע מחדש את מי שנשאר, ולכן אפשר להשוות שני טווחים
   זה לזה. ששת הצבעים עברו אימות מול עיוורון צבעים (deutan/tritan) ומול
   ניגודיות הרקע; מי שמעבר להם מקבל אפור ומקובץ ל"אחר" בגרף בלבד — הטבלה
   למטה מפרטת כל ערוץ בשמו ובמספרו. */
const LX_CHAN_COLOR = {
  homepage:      '#c73b30',
  property_page: '#0a8ba3',
  agency_page:   '#a8730c',
  agent_page:    '#9457d6',
  whatsapp_bot:  '#2f9b52',
  footer:        '#2f6fd0',
};
const LX_CHAN_ORDER = ['homepage','property_page','agency_page','agent_page','whatsapp_bot','footer'];
const LX_REST = '#8c99a6';

const LX_SOURCES = {
  homepage_owner_wizard:       'אשף הערכת השווי · דף הבית',
  homepage_buyer_wizard:       'באנר מחפשי נכס · דף הבית',
  homepage_search_agent:       'הסוכן החכם · מעל תוצאות החיפוש',
  homepage_mortgage_calc:      'מחשבון משכנתא · דף הבית',
  homepage_yield_calc:         'מחשבון תשואה · דף הבית',
  footer_buyer_wizard:         'באנר מחפשי נכס · הפוטר',
  property_page_owner_wizard:  '"חושבים למכור?" · תיבת ההדמיות',
  property_page_buyer_wizard:  'באנר מחפשי נכס · דף הנכס',
  property_page_mortgage_calc: 'מחשבון משכנתא · דף הנכס',
  property_page_inquiry:       'טופס פנייה על נכס',
  property_page_visualization: 'בקשת הדמיה בדף הנכס',
  agency_page_owner_wizard:    'אשף הערכת שווי · דף המשרד',
  agency_page_yield_calc:      'מחשבון תשואה · דף המשרד',
  agency_page_buyer_wizard:    'באנר מחפשי נכס · דף המשרד',
  agency_page:                 'אחד מכלי דף המשרד',
  agent_page_owner_wizard:     'אשף הערכת שווי · דף הסוכן/ת',
  agent_page_yield_calc:       'מחשבון תשואה · דף הסוכן/ת',
  agent_page_buyer_wizard:     'באנר מחפשי נכס · דף הסוכן/ת',
  agent_page_direct:           'פנייה ישירה לסוכן/ת',
  whatsapp_bot:                'הבוט בוואטסאפ',
  whatsapp_bot_owner_wizard:   'הבוט בוואטסאפ · מסלול מוכר/ת',
  whatsapp_bot_search_agent:   'הבוט בוואטסאפ · מסלול מחפש/ת',
  whatsapp_bot_mortgage_calc:  'הבוט בוואטסאפ · מסלול משכנתא',
  projects_page:               'מדף הפרויקטים החדשים',
  project_page:                'דף נחיתה של פרויקט',
  open_house_page:             'יריד הבתים הפתוחים',
  rss_engine:                  'מנוע ה-RSS (סריקת פידים)',
  unattributed:                'ללא שיוך מקור',
};

const LX_KINDS = {
  agent_owner:      'בעל/ת נכס',
  agent_buyer:      'מחפש/ת דירה',
  mortgage_advisor: 'ייעוץ משכנתאות',
  developer:        'מחפש/ת פרויקט חדש',
};

/* סוגי הלידים כפי שהם מופיעים בטבלת המשרדים */
const LX_TYPES = {
  owner_inbound:        'בעלי נכס',
  property_inquiry:     'פניות על נכס',
  agent_direct_inquiry: 'פניות ישירות',
  visualization:        'הדמיות',
  saved_search:         'מחפשי דירה',
  mortgage:             'משכנתאות',
  rss:                  'מדף RSS',
  project:              'פרויקטים',
};

/* ארבעת מצבי הטריות. הסקאלה היא המסר, ולכן הצבעים אינם קטגוריים אלא
   רציפים — מחם לקר — ולכל אחד יש גם תווית, לא רק גוון. */
const LX_TEMPS = [
  { key:'hot',     label:'חם',     sub:'בתוך חלון המענה' },
  { key:'warm',    label:'פושר',   sub:'עדיין רלוונטי' },
  { key:'cooling', label:'מתקרר',  sub:'כנראה כבר דיבר/ה עם מישהו' },
  { key:'cold',    label:'קר',     sub:'מלאי, לא ליד' },
];

const lxLabel = (map, key) => map[key] || key || '-';

/* שעות לניסוח קריא. 24 → "יממה", 72 → "3 ימים": הסף נשמר במסד בשעות כי
   זו היחידה שבה הוא נמדד, אבל אף אחד לא חושב ב-168 שעות. */
function lxDur(hours){
  const h = Number(hours) || 0;
  if (h < 24) return plural(h, 'שעה אחת', 'שעות', admInt(h));
  if (h === 24) return 'יממה';
  const days = h / 24;
  return plural(days, 'יום אחד', 'ימים', Number.isInteger(days) ? admInt(days) : days.toFixed(1));
}

/* אחוז שמותר להציג. מכנה אפס אינו "אפס אחוז" אלא "אין מה לחשב". */
function lxPct(part, whole){
  const w = Number(whole) || 0;
  if (!w) return null;
  return Math.round((Number(part) || 0) / w * 100);
}

const lxColor = ch => LX_CHAN_COLOR[ch] || LX_REST;

/* הגרף המוערם: עמודה לכל דלי זמן, מקטע לכל ערוץ.
   ששת הערוצים בעלי הצבע הקבוע מוצגים בנפרד; כל השאר מתקבצים ל"אחר" —
   סדרה שביעית באפור ולא גוון חדש שנוצר בזמן ריצה. */
function lxStackChart(trend){
  const present = new Set();
  trend.forEach(t => Object.keys(t.channels || {}).forEach(c => present.add(c)));
  const series = LX_CHAN_ORDER.filter(c => present.has(c));
  const hasRest = [...present].some(c => !LX_CHAN_COLOR[c]);

  const max = Math.max(1, ...trend.map(t => Number(t.leads) || 0));
  const wrap = admEl('div');
  const chart = admEl('div', 'lx-chart');

  trend.forEach(t=>{
    const col = admEl('div', 'lx-col');
    const chans = t.channels || {};
    const total = Number(t.leads) || 0;
    if (!total){
      col.appendChild(admEl('div', 'lx-col-empty'));
    } else {
      const rest = Object.keys(chans).filter(c => !LX_CHAN_COLOR[c])
        .reduce((sum, c) => sum + (Number(chans[c]) || 0), 0);
      const parts = series
        .filter(c => chans[c])
        .map(c => [c, Number(chans[c]) || 0]);
      if (rest) parts.push(['__rest', rest]);
      parts.forEach(([c, n])=>{
        const seg = admEl('i');
        seg.style.height = Math.max(2, Math.round((n / max) * 100)) + '%';
        seg.style.background = c === '__rest' ? LX_REST : lxColor(c);
        seg.title = (c === '__rest' ? 'ערוצים נוספים' : lxLabel(LX_CHANNELS, c))
          + ': ' + admInt(n) + ' מתוך ' + admInt(total) + ' · ' + t.bucket;
        col.appendChild(seg);
      });
    }
    col.title = t.bucket + ' · ' + plural(total, 'ליד אחד', 'לידים', admInt(total));
    chart.appendChild(col);
  });
  wrap.appendChild(chart);

  /* ציר: רק קצוות ואמצע. תווית לכל דלי אינה ציר אלא קיר טקסט, ובטלפון
     היא גולשת מהמסך. */
  if (trend.length){
    const axis = admEl('div', 'adm-axis');
    const marks = [0, Math.floor((trend.length - 1) / 2), trend.length - 1];
    trend.forEach((t, i)=> axis.appendChild(
      admEl('span', null, marks.includes(i) ? t.bucket.slice(5) : '')));
    wrap.appendChild(axis);
  }

  const keys = admEl('div', 'lx-keys');
  series.forEach(c=>{
    const k = admEl('span', 'lx-key');
    const dot = admEl('b'); dot.style.background = lxColor(c);
    k.appendChild(dot);
    k.appendChild(admEl('span', null, lxLabel(LX_CHANNELS, c)));
    keys.appendChild(k);
  });
  if (hasRest){
    const k = admEl('span', 'lx-key');
    const dot = admEl('b'); dot.style.background = LX_REST;
    k.appendChild(dot);
    k.appendChild(admEl('span', null, 'ערוצים נוספים'));
    keys.appendChild(k);
  }
  wrap.appendChild(keys);
  return wrap;
}

let leadReportDays = 30;
let leadReportBusy = false;

async function loadLeadReport(){
  const host = document.getElementById('leadReport');
  if (!host || leadReportBusy) return;
  leadReportBusy = true;
  const refreshBtn = document.getElementById('leadRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  host.innerHTML = '<div class="empty-state">טוען את נתוני הלידים…</div>';

  const { data, error } = await sb.rpc('platform_lead_report', { p_days: leadReportDays });

  leadReportBusy = false;
  if (refreshBtn) refreshBtn.disabled = false;

  if (error){
    // ‏PGRST202/42883 = הפונקציה חסרה מ-schema cache, כלומר המיגרציה טרם רצה.
    // ‏42501 = הפונקציה קיימת וסירבה: החשבון אינו מנהל/ת פלטפורמה.
    host.innerHTML = '';
    const msg = (error.code === '42883' || error.code === 'PGRST202')
      ? 'דוח הלידים לא קיים עדיין במסד - הריצו את המיגרציה 20261122090000_lead_analytics.sql.'
      : (error.code === '42501' || /not_platform_admin/.test(error.message || ''))
        ? 'הדוח פתוח למנהל/ת פלטפורמה בלבד.'
        : 'שגיאה בטעינת דוח הלידים: ' + error.message;
    host.appendChild(admEl('div', 'empty-state', msg));
    dashPanelsMeasure();
    return;
  }

  renderLeadReport(data || {});
}

function renderLeadReport(report){
  const host = document.getElementById('leadReport');
  if (!host) return;
  host.innerHTML = '';

  const totals   = report.totals     || {};
  const policy   = report.policy     || {};
  const queue    = report.open_queue || {};
  const response = report.response   || {};
  const range    = report.range      || {};
  const channels = Array.isArray(report.by_channel) ? report.by_channel : [];
  const sources  = Array.isArray(report.by_source)  ? report.by_source  : [];
  const kinds    = Array.isArray(report.by_kind)    ? report.by_kind    : [];
  const trend    = Array.isArray(report.trend)      ? report.trend      : [];
  const agencies = Array.isArray(report.agencies)   ? report.agencies   : [];

  const stamp = document.getElementById('leadStamp');
  if (stamp && report.generated_at){
    stamp.textContent = 'עודכן ' + new Date(report.generated_at)
      .toLocaleString('he-IL', { dateStyle:'short', timeStyle:'short' });
  }

  const leads   = Number(totals.leads) || 0;
  const routed  = (Number(totals.assigned) || 0) + (Number(totals.shelf) || 0);
  const rangeTxt = 'ב-' + admInt(range.days) + ' הימים האחרונים';

  /* ---- 1. ארבעת המספרים של החלון ---- */
  const tiles = admEl('div', 'adm-tiles');
  tiles.appendChild(admTile('לידים שנקלטו', admInt(leads), {
    note: plural(totals.sources, 'מקור אחד', 'מקורות', admInt(totals.sources))
        + ' · ' + plural(totals.channels, 'ערוץ אחד', 'ערוצים', admInt(totals.channels)),
  }));
  tiles.appendChild(admTile('הגיעו ליעד', admInt(routed), {
    note: leads
      ? (lxPct(routed, leads) + '% מהלידים · ' + admInt(totals.unrouted) + ' ללא יעד')
      : 'אין לידים בחלון',
  }));
  tiles.appendChild(admTile('נמכרו או נפתחו', admInt(totals.sold), {
    note: leads ? (lxPct(totals.sold, leads) + '% מהלידים') : '-',
  }));
  // ‏admTile יודע לצבוע כרטיס בורדו (הפלטה של דוח הפלטפורמה); כאן מחליפים
  // אותה בטורקיז של הפאנל הזה, כדי ששני הפאנלים לא ייראו כמו אותו דוח.
  const revTile = admTile('הכנסה מהלידים', admMoney(totals.revenue), {
    wine: true,
    note: 'מיוחסת לליד ולא למועד הרכישה',
  });
  revTile.classList.replace('adm-tile-wine', 'lx-tile-teal');
  tiles.appendChild(revTile);
  host.appendChild(tiles);

  /* ---- 2. טריות: המדיניות, הרצועה, וארבעת הדליים ---- */
  const tempBlock = admBlock('טריות הלידים · מה ממתין עכשיו',
    'זהו תור פתוח ולא נתון חלון: כל ליד שנקלט ואיש עדיין לא נגע בו, בלי קשר למועד. '
    + 'ליד שנפתח או נמכר יצא מהתור ואינו מזדקן עוד.');
  tempBlock.className += ' lx-block';

  const pol = admEl('p', 'lx-policy');
  pol.innerHTML =
    'המדיניות: ליד <b>חם</b> עד ' + esc(lxDur(policy.hot_hours)) + ' מהקליטה, '
    + '<b>פושר</b> עד ' + esc(lxDur(policy.warm_hours)) + ', '
    + '<b>מתקרר</b> עד ' + esc(lxDur(policy.cooling_hours)) + ', '
    + 'ומעבר לכך <b>קר</b>. הספים יושבים ב-<code>pricing_config</code> '
    + '(<code>lead_hot_hours</code> ואחיו) וניתנים לכיול בלי שינוי קוד.';
  tempBlock.appendChild(pol);

  const qTotal = Number(queue.total) || 0;
  if (qTotal){
    const strip = admEl('div', 'lx-temp');
    strip.setAttribute('role', 'img');
    strip.setAttribute('aria-label', LX_TEMPS
      .map(t => t.label + ' ' + admInt(queue[t.key])).join(', '));
    LX_TEMPS.forEach(t=>{
      const n = Number(queue[t.key]) || 0;
      if (!n) return;
      const seg = admEl('span', 't-' + t.key);
      seg.style.width = (n / qTotal * 100) + '%';
      seg.title = t.label + ': ' + admInt(n);
      strip.appendChild(seg);
    });
    tempBlock.appendChild(strip);
  }

  const temps = admEl('div', 'lx-temps');
  LX_TEMPS.forEach(t=>{
    const n = Number(queue[t.key]) || 0;
    const card = admEl('div', 'lx-t lx-t-' + t.key);
    card.appendChild(admEl('span', 'lx-t-val', admInt(n)));
    card.appendChild(admEl('span', 'lx-t-lbl', t.label));
    card.appendChild(admEl('span', 'lx-t-sub',
      qTotal ? (lxPct(n, qTotal) + '% מהתור · ' + t.sub) : t.sub));
    temps.appendChild(card);
  });
  tempBlock.appendChild(temps);

  tempBlock.appendChild(admEl('p', 'adm-note', qTotal
    ? (plural(qTotal, 'ליד אחד ממתין, והוא כבר', 'לידים ממתינים, והוותיק שבהם כבר',
              admInt(qTotal)) + ' ' + lxDur(queue.oldest_hours) + '.'
       + ((Number(queue.cooling) || 0) + (Number(queue.cold) || 0)
          ? ' ' + admInt((Number(queue.cooling) || 0) + (Number(queue.cold) || 0))
            + ' מהם כבר מעבר לסף החם - אלה שדורשים החלטה.'
          : ''))
    : 'אין כרגע ליד שממתין לטיפול.'));
  host.appendChild(tempBlock);

  /* ---- 3. זמן התגובה ---- */
  const waited = Number(totals.waited) || 0;
  const respBlock = admBlock('זמן התגובה · ' + rangeTxt,
    'נמדד רק על לידים שבאמת המתינו. ליד שהגיע פתוח מהרגע הראשון - מדף המשרד, '
    + 'מדף הסוכן/ת או מתיבת ההדמיות - מוחרג: הוא לא חיכה לאיש, וספירתו כ"תגובה '
    + 'תוך אפס שעות" הייתה מכריזה על הישג במדד שלא נמדד בו כלל.');
  respBlock.className += ' lx-block';
  const facts = admEl('div', 'adm-facts');
  [
    ['לידים שהמתינו לפתיחה', admInt(waited) + ' מתוך ' + admInt(leads)],
    ['הגיעו פתוחים מלכתחילה', admInt(totals.born_open)],
    ['חציון זמן התגובה',      waited ? lxDur(response.median_hours) : '-'],
    ['ממוצע זמן התגובה',      waited ? lxDur(response.avg_hours) : '-'],
    ['נענו בתוך החלון החם',   waited ? (admInt(response.within_hot) + ' · ' + lxPct(response.within_hot, waited) + '%') : '-'],
    ['נענו לפני שהתקררו',     waited ? (admInt(response.within_warm) + ' · ' + lxPct(response.within_warm, waited) + '%') : '-'],
  ].forEach(([label, value])=>{
    const fact = admEl('div', 'adm-fact');
    fact.appendChild(admEl('span', 'adm-fact-lbl', label));
    fact.appendChild(admEl('span', 'adm-fact-val', value));
    facts.appendChild(fact);
  });
  respBlock.appendChild(facts);
  host.appendChild(respBlock);

  /* ---- 4. לפי ערוץ ---- */
  const chanBlock = admBlock('מאיפה נכנסו הלידים · ' + rangeTxt,
    'ערוץ הוא הקיבוץ של המקורות: "דף הבית" מאגד את אשף הערכת השווי, באנר מחפשי '
    + 'הנכס, הסוכן החכם ושני המחשבונים. הפירוט המלא בטבלה שמתחת.');
  chanBlock.className += ' lx-block';
  const chanRows = admEl('div', 'adm-rows');
  channels.forEach(c=>{
    const n = Number(c.leads) || 0;
    const row = admRow(
      lxLabel(LX_CHANNELS, c.channel),
      plural(c.sources, 'מקור אחד', 'מקורות', admInt(c.sources))
        + ' · ' + plural(c.sold, 'ליד אחד נמכר', 'נמכרו', admInt(c.sold)) + ' · ' + admMoney(c.revenue)
        + (Number(c.unrouted) ? ' · ' + admInt(c.unrouted) + ' ללא יעד' : ''),
      admInt(n), leads ? (n / leads) * 100 : 0);
    // הנקודה קושרת את השורה לצבע שלה בגרף המוערם — בלעדיה שתי התצוגות הן
    // שני דוחות שאין ביניהם קשר ויזואלי
    const nameCell = row.querySelector('.adm-row-name');
    if (nameCell){
      const dot = admEl('b', 'lx-dot');
      dot.style.background = lxColor(c.channel);
      nameCell.insertBefore(dot, nameCell.firstChild);
    }
    chanRows.appendChild(row);
  });
  if (!channels.length) chanRows.appendChild(admEl('div', 'empty-state', 'לא נקלטו לידים בחלון הזה.'));
  chanBlock.appendChild(chanRows);
  host.appendChild(chanBlock);

  /* ---- 5. לפי מקור — הפירוט המלא ---- */
  const srcBlock = admBlock('הפירוט לפי מקור · ' + rangeTxt,
    'כל שורה היא וידג״ט אחד. "ללא יעד" = הליד נקלט ולא היה מי שיקבל אותו - '
    + 'זה הכשל היחיד כאן; "ללא אישור" = הפונה ביקש/ה התראות בלבד, וזו בחירה שלו/ה ולא תקלה.');
  srcBlock.className += ' lx-block';
  if (!sources.length){
    srcBlock.appendChild(admEl('div', 'empty-state', 'לא נקלטו לידים בחלון הזה.'));
    host.appendChild(srcBlock);
  } else {
  const srcWrap = admEl('div', 'adm-table-wrap');
  const srcTable = admEl('table', 'adm-table');
  const srcHead = admEl('thead');
  const srcHrow = admEl('tr');
  ['מקור','ערוץ','קהל','לידים','שויכו','למדף','ללא יעד','ללא אישור','נמכרו','הכנסה']
    .forEach(h => srcHrow.appendChild(admEl('th', null, h)));
  srcHead.appendChild(srcHrow);
  srcTable.appendChild(srcHead);
  const srcBody = admEl('tbody');
  sources.forEach(r=>{
    const tr = admEl('tr');
    tr.appendChild(admEl('td', null, lxLabel(LX_SOURCES, r.source)));
    tr.appendChild(admEl('td', null, lxLabel(LX_CHANNELS, r.channel)));
    tr.appendChild(admEl('td', null, lxLabel(LX_KINDS, r.lead_kind)));
    tr.appendChild(admEl('td', 'num', admInt(r.leads)));
    tr.appendChild(admEl('td', 'num', admInt(r.assigned)));
    tr.appendChild(admEl('td', 'num', admInt(r.shelf)));
    tr.appendChild(admEl('td', 'num', admInt(r.unrouted)));
    tr.appendChild(admEl('td', 'num', admInt(r.no_consent)));
    tr.appendChild(admEl('td', 'num', admInt(r.sold)));
    tr.appendChild(admEl('td', 'num', admMoney(r.revenue)));
    srcBody.appendChild(tr);
  });
  srcTable.appendChild(srcBody);
  srcWrap.appendChild(srcTable);
  srcBlock.appendChild(srcWrap);
  if (Number(totals.unattributed)){
    srcBlock.appendChild(admEl('p', 'adm-note',
      plural(totals.unattributed, 'ליד אחד בחלון הזה נכנס', 'לידים בחלון הזה נכנסו',
             admInt(totals.unattributed)) + ' בלי שיוך מקור. לידים כאלה '
      + 'נקלטו לפני שיומן הניתוב נכנס לאוויר, או דרך מסלול שאינו רושם מקור. '
      + 'הם נספרים ככל ליד אחר - ומוצגים ככאלה ולא מנוחשים.'));
  }
  host.appendChild(srcBlock);
  }

  /* ---- 6. לפי קהל היעד ---- */
  const kindBlock = admBlock('לפי קהל היעד · ' + rangeTxt,
    'אותם לידים בדיוק, חתוכים לפי מי אמור לקבל אותם ולא לפי מאיפה הגיעו.');
  kindBlock.className += ' lx-block';
  const kindRows = admEl('div', 'adm-rows');
  kinds.forEach(k=>{
    const n = Number(k.leads) || 0;
    kindRows.appendChild(admRow(
      lxLabel(LX_KINDS, k.lead_kind),
      admInt(k.sold) + ' נמכרו · ' + admMoney(k.revenue)
        + (Number(k.unrouted) ? ' · ' + admInt(k.unrouted) + ' ללא יעד' : ''),
      admInt(n), leads ? (n / leads) * 100 : 0));
  });
  if (!kinds.length) kindRows.appendChild(admEl('div', 'empty-state', 'אין נתונים בחלון הזה.'));
  kindBlock.appendChild(kindRows);
  host.appendChild(kindBlock);

  /* ---- 7. המגמה, מוערמת לפי ערוץ ---- */
  if (trend.length && leads){
    const bucketName = range.bucket === 'month' ? 'חודש' : (range.bucket === 'week' ? 'שבוע' : 'יום');
    const trendBlock = admBlock('מגמה - עמודה לכל ' + bucketName,
      'גובה העמודה הוא סך הלידים, והמקטעים בתוכה הם ההרכב לפי ערוץ. '
      + 'ששת הערוצים המרכזיים מוצגים בצבעם הקבוע; השאר מקובצים ל"ערוצים נוספים" - '
      + 'ומפורטים בשמם בטבלאות שלמעלה.');
    trendBlock.className += ' lx-block';
    trendBlock.appendChild(lxStackChart(trend));
    host.appendChild(trendBlock);
  }

  /* ---- 8. מה כל משרד קיבל ---- */
  const agBlock = admBlock('מה כל משרד קיבל · ' + rangeTxt,
    '"קיבל" = לידים ששויכו למשרד ישירות, ועוד לידים שרכש מהמדפים. פתיחת ליד ששויך '
    + 'ממילא אינה קבלה שנייה של אותו ליד, ולכן היא נספרת בטור "נפתחו" בלבד.');
  agBlock.className += ' lx-block';

  // הטורים נגזרים מהנתונים: סוג שאף משרד לא קיבל בחלון הזה לא מקבל טור ריק
  if (!agencies.length){
    agBlock.appendChild(admEl('div', 'empty-state', 'אף משרד לא קיבל ליד בחלון הזה.'));
    host.appendChild(agBlock);
  } else {
  const typeKeys = Object.keys(LX_TYPES).filter(t =>
    agencies.some(a => Number((a.by_type || {})[t])));
  const agWrap = admEl('div', 'adm-table-wrap');
  const agTable = admEl('table', 'adm-table');
  const agHead = admEl('thead');
  const agHrow = admEl('tr');
  ['משרד','סה״כ קיבל','שויכו','נרכשו','נפתחו']
    .concat(typeKeys.map(t => LX_TYPES[t]))
    .concat(['הוצאה'])
    .forEach(h => agHrow.appendChild(admEl('th', null, h)));
  agHead.appendChild(agHrow);
  agTable.appendChild(agHead);
  const agBody = admEl('tbody');
  agencies.forEach(a=>{
    const tr = admEl('tr');
    tr.appendChild(admEl('td', null, a.name || '-'));
    tr.appendChild(admEl('td', 'num', admInt(a.received)));
    tr.appendChild(admEl('td', 'num', admInt(a.assigned)));
    tr.appendChild(admEl('td', 'num', admInt(a.bought)));
    tr.appendChild(admEl('td', 'num', admInt(a.opened)));
    typeKeys.forEach(t => tr.appendChild(
      admEl('td', 'num', admInt((a.by_type || {})[t]))));
    tr.appendChild(admEl('td', 'num', admMoney(a.spend)));
    agBody.appendChild(tr);
  });
  agTable.appendChild(agBody);
  agWrap.appendChild(agTable);
  agBlock.appendChild(agWrap);
  host.appendChild(agBlock);
  }

  /* הכותרת היא מה שרואים כשהפאנל מכווץ, ולכן היא נושאת את שלוש השורות
     התחתונות: כמה נכנסו, מי הוביל, ומה מתקרר. */
  const top = channels[0];
  const sub = document.getElementById('leadPanelSub');
  if (sub){
    const coldish = (Number(queue.cooling) || 0) + (Number(queue.cold) || 0);
    sub.textContent = plural(leads, 'ליד אחד', 'לידים', admInt(leads)) + ' ' + rangeTxt
      + (top ? ' · מוביל: ' + lxLabel(LX_CHANNELS, top.channel) : '')
      + ' · ' + plural(queue.hot, 'ליד אחד חם', 'חמים', admInt(queue.hot))
      + (coldish ? ' · ' + plural(coldish, 'ליד אחד התקרר', 'התקררו', admInt(coldish)) : '');
  }

  dashPanelsMeasure();
}

document.querySelectorAll('#leadRange button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    leadReportDays = Number(btn.dataset.days) || 30;
    document.querySelectorAll('#leadRange button')
      .forEach(b => b.classList.toggle('is-on', b === btn));
    loadLeadReport();
  });
});
document.getElementById('leadRefreshBtn').addEventListener('click', loadLeadReport);

/* ==========================================================================
   הפאנל הרביעי — בריאות, ביצועים ואבטחה
   --------------------------------------------------------------------------
   הנתונים מגיעים מ-platform_ops_report, שקורא את ops_findings — הטבלה
   שהסוכן התפעולי (ops_scan.py, ב-GitHub Actions) כותב אליה כל שש שעות.

   ‏**הדף לא סורק כלום בעצמו, ובכוונה.** בדיקת שאילתות איטיות, הרשאות
   ‏RLS ומשקל דפים דורשת חיבור שעוקף RLS ודורשת זמן; בדפדפן היא הייתה גם
   בלתי אפשרית וגם מסוכנת. הדף מציג את מה שכבר נמצא.

   הפרטים והספים: docs/ops-agent.md.
   ========================================================================== */
const OPS_SEV_LABELS = {
  critical: 'חמור', high: 'גבוה', medium: 'בינוני', low: 'נמוך', info: 'מידע',
};
const OPS_AREA_LABELS = {
  health:      'בריאות',
  performance: 'ביצועים',
  frontend:    'חוויית הגולש/ת',
  behavior:    'התנהגות',
  security:    'אבטחה',
  cost:        'משאבים',
};

let opsReportDays = 30;
let opsReportBusy = false;

async function loadOpsReport(){
  const host = document.getElementById('opsReport');
  if (!host || opsReportBusy) return;
  opsReportBusy = true;
  const refreshBtn = document.getElementById('opsRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  host.innerHTML = '<div class="empty-state">טוען את מצב המערכת…</div>';

  const { data, error } = await sb.rpc('platform_ops_report', { p_days: opsReportDays });

  opsReportBusy = false;
  if (refreshBtn) refreshBtn.disabled = false;

  if (error){
    // ‏PGRST202/42883 = המיגרציה טרם רצה. ‏42501 = לא מנהל/ת פלטפורמה.
    host.innerHTML = '';
    const msg = (error.code === '42883' || error.code === 'PGRST202')
      ? 'הדוח התפעולי לא קיים עדיין במסד - הריצו את המיגרציה 20261127090000_ops_agent.sql.'
      : (error.code === '42501' || /not_platform_admin/.test(error.message || ''))
        ? 'הדוח פתוח למנהל/ת פלטפורמה בלבד.'
        : 'שגיאה בטעינת הדוח התפעולי: ' + error.message;
    host.appendChild(admEl('div', 'empty-state', msg));
    dashPanelsMeasure();
    return;
  }

  renderOpsReport(data || {});
}

function renderOpsReport(report){
  const host = document.getElementById('opsReport');
  if (!host) return;
  host.innerHTML = '';

  const scan     = report.scan     || null;
  const counts   = report.counts   || {};
  const areas    = Array.isArray(report.areas)    ? report.areas    : [];
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const resolved = Array.isArray(report.resolved) ? report.resolved : [];

  const stampEl = document.getElementById('opsStamp');
  if (stampEl) stampEl.textContent = report.generated_at
    ? 'עודכן ' + new Date(report.generated_at).toLocaleString('he-IL')
    : '';

  /* ---- רצועת הסריקה האחרונה ----
     ראשונה על המסך בכוונה. סוכן שהפסיק לרוץ מציג בדיוק אותו מסך כמו
     מערכת בריאה, וזו הטעות שהכי קל ליפול בה. */
  const ageMin = scan ? Number(scan.age_minutes) || 0 : null;
  const stale  = scan === null || ageMin > 60 * 24;   // יממה בלי סריקה
  const strip  = admEl('div', 'ops-stamp' + (stale ? ' stale' : ''));
  if (!scan){
    strip.appendChild(admEl('span', null,
      'הסוכן התפעולי עדיין לא רץ אף פעם. עד שירוץ, המסך הזה ריק - וזה לא אומר שהכול תקין.'));
  } else {
    strip.appendChild(admEl('span', null, 'נסרק ' + opsAgo(ageMin)));
    const failed = Array.isArray(scan.failed_probes) ? scan.failed_probes : [];
    if (failed.length){
      // בדיקה שנפלה אינה "אין ממצאים" — והמסך חייב לומר את זה במפורש
      strip.appendChild(admEl('span', 'ops-flag worse',
        'בדיקות שנפלו: ' + failed.join(', ')));
    }
    if (stale){
      strip.appendChild(admEl('span', null,
        '- הסריקה אמורה לרוץ כל שש שעות. לבדוק את ops_agent.yml בלשונית Actions.'));
    }
  }
  host.appendChild(strip);

  /* ---- ארבעה מספרי כותרת ---- */
  const tiles = admEl('div', 'adm-tiles');
  const crit  = Number(counts.critical) || 0;
  const high  = Number(counts.high) || 0;
  tiles.appendChild(admTile('דורש טיפול מיידי', admInt(crit + high),
    { wine: crit > 0, note: crit ? admInt(crit) + ' חמורים' : 'חמור: אין' }));
  tiles.appendChild(admTile('ממצאים פתוחים', admInt(counts.open),
    { note: Number(counts.muted) ? admInt(counts.muted) + ' מושתקים' : null }));
  tiles.appendChild(admTile('חדשים ביממתיים', admInt(counts.new)));
  tiles.appendChild(admTile('נסגרו בחלון', admInt(resolved.length),
    { note: 'מאליהם, בלי שסומנו' }));
  host.appendChild(tiles);

  /* ---- לפי תחום ---- */
  if (areas.length){
    const block = admBlock('לפי תחום',
      'כמה ממצאים פתוחים בכל תחום, וכמה מהם דחופים.');
    const rows = admEl('div', 'adm-rows');
    const max = Math.max(1, ...areas.map(a => Number(a.open) || 0));
    areas.forEach(a => {
      const open = Number(a.open) || 0;
      const urgent = Number(a.urgent) || 0;
      rows.appendChild(admRow(
        OPS_AREA_LABELS[a.area] || a.area,
        urgent ? urgent + ' דחופים' : null,
        admInt(open), (open / max) * 100));
    });
    block.appendChild(rows);
    host.appendChild(block);
  }

  /* ---- הממצאים ---- */
  const block = admBlock('הממצאים',
    'ממוין לפי חומרה. לחיצה על שורה פותחת את הפירוט ואת ההצעה לתיקון.');
  if (!findings.length){
    block.appendChild(admEl('div', 'empty-state', scan
      ? 'אין ממצאים פתוחים. הסריקה האחרונה עברה נקייה.'
      : 'אין נתונים עדיין.'));
  } else {
    findings.forEach(f => block.appendChild(opsItem(f)));
  }
  host.appendChild(block);

  /* ---- מה נסגר ----
     בלי הבלוק הזה הדשבורד מראה רק חובות ואף פעם לא תשלומים, ואז הוא
     מדכא במקום להועיל. */
  if (resolved.length){
    const done = admBlock('נסגרו מאליהם',
      'ממצאים שלא חזרו בסריקה האחרונה - כלומר תוקנו, בכוונה או דרך אגב.');
    const facts = admEl('div', 'adm-facts');
    resolved.slice(0, 12).forEach(r => {
      const fact = admEl('div', 'adm-fact');
      fact.appendChild(admEl('span', 'adm-fact-lbl', r.title));
      fact.appendChild(admEl('span', 'adm-fact-val',
        'היה פתוח ' + plural(r.lasted_days, 'יום אחד', 'ימים', admInt(r.lasted_days))));
      facts.appendChild(fact);
    });
    done.appendChild(facts);
    host.appendChild(done);
  }

  const sub = document.getElementById('opsPanelSub');
  if (sub){
    sub.textContent = (crit + high)
      ? plural(crit + high, 'ממצא אחד דורש טיפול', 'ממצאים דורשים טיפול', admInt(crit + high))
        + ' · ' + plural(counts.open, 'ממצא אחד פתוח', 'פתוחים', admInt(counts.open))
      : (Number(counts.open)
          ? plural(counts.open, 'ממצא אחד פתוח, ואינו דחוף',
                   'ממצאים פתוחים, אף אחד דחוף', admInt(counts.open))
          : 'הכול תקין בסריקה האחרונה');
  }

  dashPanelsMeasure();
}

function opsAgo(minutes){
  const m = Number(minutes) || 0;
  if (m < 90)      return 'לפני ' + plural(Math.max(1, Math.round(m)), 'דקה אחת', 'דקות');
  if (m < 60 * 36) return 'לפני ' + plural(Math.round(m / 60), 'שעה אחת', 'שעות');
  return 'לפני ' + plural(Math.round(m / 1440), 'יום אחד', 'ימים');
}

/* ‏**טקסט** מהממצא הופך להדגשה אמיתית.
   ----------------------------------------------------------------
   הממצאים נכתבים ב-ops_agent עם הדגשות בסגנון Markdown, והן נושאות
   משקל: "‏**לא** להוציא את קטעי ה-GTM" הוא אזהרה, לא קישוט. בלי
   הפונקציה הזו הדשבורד הציג את הכוכביות כטקסט גולמי.

   ‏**בלי innerHTML, ובכוונה.** הפיצול בונה צמתים ומכניס את הטקסט דרך
   ‏textContent, ולכן ערך מהמסד אינו יכול להפוך ל-HTML — גם אם ממצא
   יכיל יום אחד תו שנראה כמו תגית. זו הסיבה שאין כאן קריאה ל-escapeHtml:
   אין מה לברוח ממנו כשלא מרכיבים מחרוזת HTML מלכתחילה (CLAUDE.md).

   מספר אי-זוגי של ‎**‎ פשוט נשאר טקסט — חלוקה ל-split נותנת את החלקים
   הזוגיים כרגיל, ואין מצב שבו חלק מהטקסט נעלם. */
function opsRich(el, text){
  String(text == null ? '' : text).split('**').forEach((part, i)=>{
    if (!part) return;
    el.appendChild(i % 2 ? admEl('strong', null, part)
                         : document.createTextNode(part));
  });
  return el;
}

/* שורת ממצא אחת. ‏details ולא div פתוח: 40 ממצאים פתוחים הם קיר טקסט,
   והשורה הסגורה נושאת כבר את כל מה שצריך כדי להחליט אם לפתוח. */
function opsItem(f){
  const item = admEl('details', 'ops-item' + (f.muted ? ' is-muted' : ''));
  item.setAttribute('data-sev', f.severity);

  const head = admEl('summary');
  head.appendChild(admEl('span', 'ops-sev ' + f.severity,
    OPS_SEV_LABELS[f.severity] || f.severity));
  head.appendChild(admEl('span', 'ops-title', f.title));

  if (f.is_new) head.appendChild(admEl('span', 'ops-flag new', 'חדש'));
  if (f.trend === 'worse') head.appendChild(admEl('span', 'ops-flag worse', '▲ מחמיר'));
  if (f.trend === 'better') head.appendChild(admEl('span', 'ops-flag', '▼ משתפר'));
  if (f.muted) head.appendChild(admEl('span', 'ops-flag', 'מושתק'));

  const age = Number(f.age_days) || 0;
  head.appendChild(admEl('span', 'ops-meta',
    (OPS_AREA_LABELS[f.area] || f.area) + ' · ' +
    (age >= 1 ? 'פתוח ' + plural(age, 'יום אחד', 'ימים', admInt(age)) : 'פתוח מהיום')));
  item.appendChild(head);

  const body = admEl('div', 'ops-body');
  body.appendChild(opsRich(admEl('p'), f.detail));

  /* המספר והמגמה. ‏prev_metric הוא מה שהופך "יש בעיה" ל"היא גדלה
     מ-3 ל-11", וזה ההבדל בין דיווח לניטור. */
  if (f.metric !== null && f.metric !== undefined){
    const unit = f.metric_unit ? ' ' + f.metric_unit : '';
    let line = 'המדד: ' + admInt(f.metric) + unit;
    if (f.prev_metric !== null && f.prev_metric !== undefined
        && Number(f.prev_metric) !== Number(f.metric)){
      line += ' (בסריקה הקודמת ' + admInt(f.prev_metric) + unit + ')';
    }
    body.appendChild(admEl('p', null, line));
  }

  if (f.suggestion){
    const fix = admEl('div', 'ops-fix');
    fix.appendChild(admEl('strong', null, 'מה לעשות: '));
    opsRich(fix, f.suggestion);
    body.appendChild(fix);
  }

  /* הראיות כ-JSON גולמי, ב-LTR. זה לא יפה ובכוונה: זו התוכן שמעתיקים
     לשאילתה או ל-Issue, ועיצוב שלו היה רק מסתיר פרטים. */
  const ev = f.evidence;
  if (ev && typeof ev === 'object' && Object.keys(ev).length){
    const pre = admEl('pre', 'ops-ev', JSON.stringify(ev, null, 2));
    body.appendChild(pre);
  }

  const actions = admEl('div', 'ops-actions');
  const muteBtn = admEl('button', null, f.muted ? 'ביטול ההשתקה' : 'להשתיק ל-30 יום');
  muteBtn.type = 'button';
  muteBtn.addEventListener('click', async ()=>{
    muteBtn.disabled = true;
    const { error } = await sb.rpc('platform_ops_mute',
      { p_key: f.key, p_days: f.muted ? 0 : 30 });
    if (error){
      muteBtn.disabled = false;
      alert('ההשתקה נכשלה: ' + error.message);
      return;
    }
    loadOpsReport();
  });
  actions.appendChild(muteBtn);
  body.appendChild(actions);

  item.appendChild(body);
  return item;
}

document.querySelectorAll('#opsRange button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    opsReportDays = Number(btn.dataset.days) || 30;
    document.querySelectorAll('#opsRange button')
      .forEach(b => b.classList.toggle('is-on', b === btn));
    loadOpsReport();
  });
});
document.getElementById('opsRefreshBtn').addEventListener('click', loadOpsReport);

/* ==========================================================================
   הפאנל החמישי — מצבת המערכת
   --------------------------------------------------------------------------
   ‏platform_inventory_report מחזיר מסמך אחד עם תשע קבוצות. הרינדור כאן
   מונע מ**מפרט** ולא מקוד לכל שדה: כל קבוצה היא רשימת [מפתח, תווית],
   ולכן הוספת מספר חדש לדוח היא שורה אחת כאן ושורה אחת במיגרציה.

   השדות שאינם מופיעים במפרט פשוט לא מוצגים — כך RPC שהתקדם לפני הדף
   אינו שובר אותו, והדף אינו מציג שדה שאין לו תווית בעברית.
   ========================================================================== */
const INV_GROUPS = [
  { key: 'properties', title: 'נכסים',
    note: 'המלאי עצמו: כמה יש, כמה באוויר, ומה חסר במודעות.',
    fields: [
      ['total', 'נכסים במערכת'], ['active', 'מפורסמים כרגע'],
      ['new', 'נוספו בחלון'], ['promoted', 'בקידום פעיל'],
      ['with_images', 'עם תמונות'], ['with_text', 'עם תיאור שיווקי'],
      ['geocoded', 'ממוקמים על המפה'], ['with_video', 'עם סרטון'],
      ['with_tour', 'עם סיור וירטואלי'], ['open_house', 'עם בית פתוח'],
      ['avg_price', 'מחיר ממוצע'], ['median_price', 'מחיר חציוני'],
    ] },
  { key: 'collaboration', title: 'שיתופי פעולה',
    note: 'השאלה שהפלטפורמה נבנתה סביבה: כמה נכסים עוברים בין משרדים, ובאיזו צורה משפטית.',
    fields: [
      ['shares', 'שיתופים שנעשו'], ['shares_new', 'שיתופים בחלון'],
      ['properties_shared', 'נכסים ששותפו'], ['opted_in', 'נכסים פתוחים לשיתוף'],
      ['agencies_sharing', 'משרדים ששיתפו'], ['agencies_receiving', 'משרדים שקיבלו'],
      ['agreements', 'הסכמים'], ['agreements_signed', 'הסכמים חתומים'],
      ['exclusivities_active', 'בלעדיות בתוקף'], ['contracts', 'חוזים'],
      ['contracts_signed', 'חוזים חתומים'], ['opted_out_agents', 'סוכנים שחסמו שיתוף'],
    ] },
  { key: 'clients', title: 'לקוחות המתווכים',
    note: 'הלקוחות שהמתווכים מנהלים אצלנו, וההתאמות שהמערכת מצאה להם.',
    fields: [
      ['total', 'לקוחות בסך הכול'], ['active', 'לקוחות פעילים'],
      ['new', 'נוספו בחלון'], ['with_agent', 'סוכנים שמנהלים לקוחות'],
      ['per_agent', 'ממוצע לקוחות לסוכן/ת'],
      ['matches', 'התאמות שנמצאו'], ['matches_seen', 'התאמות שנצפו'],
    ] },
  { key: 'media', title: 'הדמיות, סרטונים ומדיה',
    note: 'מה שהמערכת ייצרה בעצמה עבור המודעות.',
    fields: [
      ['visualizations', 'הדמיות שנוצרו'], ['visualizations_done', 'הדמיות מוכנות'],
      ['visualizations_new', 'הדמיות בחלון'], ['videos', 'סרטונים שהופקו'],
      ['videos_new', 'סרטונים בחלון'], ['virtual_tours', 'סיורים וירטואליים'],
      ['image_tags', 'תמונות שסווגו'], ['project_media', 'מדיה של פרויקטים'],
    ] },
  { key: 'people', title: 'משרדים, סוכנים ויזמים',
    note: 'מי נמצא בפלטפורמה, וכמה מהם משלמים.',
    fields: [
      ['agencies', 'משרדים'], ['agencies_new', 'משרדים שהצטרפו בחלון'],
      ['agents', 'סוכנים פעילים'], ['agents_new', 'סוכנים שהצטרפו בחלון'],
      ['paying', 'במסלול בתשלום'], ['license_verified', 'רישיון מאומת'],
      ['agents_onboarded', 'השלימו הקמה'], ['agents_closed', 'חשבונות שנסגרו'],
      ['mortgage_advisors', 'יועצי משכנתאות'], ['developers', 'יזמים'],
      ['platform_admins', 'מנהלי פלטפורמה'],
    ] },
  { key: 'demand', title: 'ביקוש ולידים',
    note: 'כל מה שמגיע מצד המחפשים - בכל הערוצים.',
    fields: [
      ['leads', 'לידים בסך הכול'], ['leads_new', 'לידים בחלון'],
      ['leads_open', 'לידים שלא נפתחו'], ['mortgage_leads', 'לידי משכנתא'],
      ['project_leads', 'לידי פרויקטים'], ['rss_leads', 'לידים ממנוע ה-RSS'],
      ['rss_leads_sold', 'לידי RSS שנמכרו'], ['saved_searches', 'חיפושים שמורים פעילים'],
      ['saved_alerts_sent', 'התראות שנשלחו'], ['reviews', 'ביקורות שפורסמו'],
      ['avg_rating', 'דירוג ממוצע'],
    ] },
  { key: 'money', title: 'כסף',
    note: 'סכומים של עסקאות שהצליחו בלבד. טעינות במצב בדיקה אינן נספרות.',
    money: true,
    fields: [
      ['topups', 'טעינות ארנק'], ['topups_window', 'טעינות בחלון'],
      ['subscriptions', 'מנויים'], ['lead_charges', 'חיובי לידים'],
      ['search_purchases', 'רכישות מהסוכן החכם'], ['mortgage_purchases', 'רכישות לידי משכנתא'],
      ['rss_purchases', 'רכישות לידי RSS'], ['promotions', 'קידומים'],
      ['videos', 'סרטוני שיווק'], ['ads', 'פרסום באתר'],
      ['project_charges', 'חיובי פרויקטים'], ['developer_topups', 'טעינות יזמים'],
      ['refunds', 'החזרים'], ['wallet_balance', 'יתרה בארנקים'],
    ] },
  { key: 'audience', title: 'קהל ותנועה',
    note: 'מי מגיע לאתר, ובאיזה ערוץ הוא נשאר איתנו.',
    fields: [
      ['property_views', 'צפיות בנכסים בחלון'], ['unique_visitors', 'מבקרים ייחודיים'],
      ['whatsapp_in', 'הודעות נכנסות בוואטסאפ'], ['whatsapp_chats', 'שיחות עם סוכנים'],
      ['whatsapp_public', 'שיחות עם הבוט הציבורי'], ['newsletter', 'נרשמים לניוזלטר'],
      ['open_house_subs', 'נרשמים לבתים פתוחים'], ['pwa_installs', 'התקנות האפליקציה'],
      ['notifications', 'התראות שנשלחו בחלון'], ['notifications_unread', 'התראות שלא נקראו'],
    ] },
  { key: 'projects', title: 'פרויקטים חדשים',
    note: 'הצד היזמי של הפלטפורמה.',
    fields: [
      ['total', 'פרויקטים'], ['published', 'מפורסמים'], ['new', 'נוספו בחלון'],
      ['units', 'יחידות דיור'], ['units_free', 'יחידות פנויות'],
      ['views', 'צפיות בחלון'],
    ] },
  { key: 'content', title: 'תוכן ומאגרי מידע',
    note: 'מה שממלא את האתר מעבר למודעות.',
    fields: [
      ['articles', 'כתבות'], ['news_items', 'מבזקים שפורסמו'],
      ['news_new', 'מבזקים בחלון'], ['neighborhoods', 'שכונות'],
      ['streets', 'רחובות במאגר'], ['market_deals', 'עסקאות שוק'],
      ['planning_info', 'נכסים עם מידע תכנוני'],
    ] },
];

let invReportDays = 30;
let invReportBusy = false;

async function loadInventoryReport(){
  const host = document.getElementById('invReport');
  if (!host || invReportBusy) return;
  invReportBusy = true;
  const refreshBtn = document.getElementById('invRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  host.innerHTML = '<div class="empty-state">טוען את מצבת המערכת…</div>';

  const { data, error } = await sb.rpc('platform_inventory_report',
    { p_days: invReportDays });

  invReportBusy = false;
  if (refreshBtn) refreshBtn.disabled = false;

  if (error){
    host.innerHTML = '';
    const msg = (error.code === '42883' || error.code === 'PGRST202')
      ? 'המצבת לא קיימת עדיין במסד - הריצו את המיגרציה 20261127090000_ops_agent.sql.'
      : (error.code === '42501' || /not_platform_admin/.test(error.message || ''))
        ? 'הדוח פתוח למנהל/ת פלטפורמה בלבד.'
        : 'שגיאה בטעינת המצבת: ' + error.message;
    host.appendChild(admEl('div', 'empty-state', msg));
    dashPanelsMeasure();
    return;
  }

  renderInventoryReport(data || {});
}

function renderInventoryReport(report){
  const host = document.getElementById('invReport');
  if (!host) return;
  host.innerHTML = '';

  const days = Number(report.window_days) || 30;
  const stampEl = document.getElementById('invStamp');
  if (stampEl) stampEl.textContent = report.generated_at
    ? 'נכון ל-' + new Date(report.generated_at).toLocaleString('he-IL')
    : '';

  /* ארבעה מספרי כותרת — אלה שנשאלים בפועל כשמישהו שואל "מה יש לכם" */
  const props  = report.properties    || {};
  const collab = report.collaboration || {};
  const clients= report.clients       || {};
  const media  = report.media         || {};
  const tiles = admEl('div', 'adm-tiles');
  tiles.appendChild(admTile('נכסים מפורסמים', admInt(props.active),
    { note: 'מתוך ' + admInt(props.total) + ' במערכת', wine: true }));
  tiles.appendChild(admTile('שיתופי פעולה', admInt(collab.shares),
    { note: plural(collab.properties_shared, 'נכס אחד שותף', 'נכסים שותפו', admInt(collab.properties_shared)) }));
  tiles.appendChild(admTile('לקוחות המתווכים', admInt(clients.total),
    { note: admInt(clients.per_agent) + ' בממוצע לסוכן/ת' }));
  tiles.appendChild(admTile('הדמיות שבוצעו', admInt(media.visualizations),
    { note: admInt(media.videos) + ' סרטונים' }));
  host.appendChild(tiles);

  host.appendChild(admEl('p', 'adm-note',
    'כל מספר הוא מצבת מלאה מאז ומתמיד, אלא אם כתוב "בחלון" - ואז הוא ' +
    admInt(days) + ' הימים האחרונים.'));

  INV_GROUPS.forEach(group => {
    const data = report[group.key];
    if (!data || typeof data !== 'object') return;

    // שדה שאין לו ערך אינו מוצג כאפס: "0" ו"לא נמדד" הם דברים שונים
    const pairs = group.fields.filter(([k]) =>
      data[k] !== null && data[k] !== undefined);
    if (!pairs.length) return;

    const block = admBlock(group.title, group.note);
    const facts = admEl('div', 'adm-facts');
    pairs.forEach(([k, label])=>{
      const fact = admEl('div', 'adm-fact');
      fact.appendChild(admEl('span', 'adm-fact-lbl', label));
      fact.appendChild(admEl('span', 'adm-fact-val',
        group.money ? '₪' + admInt(data[k]) : admInt(data[k])));
      facts.appendChild(fact);
    });
    block.appendChild(facts);

    // פילוחים: מפתח→מספר. מוצגים כשורות עם פס יחס, כי החלק היחסי הוא
    // המידע — "34 שכירות" לבד אינו אומר דבר בלי "מתוך כמה".
    ['by_status', 'by_deal', 'by_category', 'by_tier', 'leads_by_type',
     'leads_by_status', 'agreements_by_kind', 'agreements_by_status',
     'visualizations_by_kind', 'visualization_jobs',
     'video_jobs'].forEach(breakdownKey => {
      const raw = data[breakdownKey];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const entries = Object.entries(raw)
        .map(([k, v]) => [k, Number(v) || 0])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);
      if (entries.length < 2) return;
      const total = entries.reduce((s, [, v]) => s + v, 0);
      block.appendChild(admEl('p', 'adm-legend',
        INV_BREAKDOWN_LABELS[breakdownKey] || breakdownKey));
      const rows = admEl('div', 'adm-rows');
      entries.forEach(([k, v]) => rows.appendChild(
        admRow(INV_VALUE_LABELS[k] || k, null, admInt(v), (v / total) * 100)));
      block.appendChild(rows);
    });

    // ערים מובילות — מערך ולא אובייקט, ולכן טיפול נפרד
    if (Array.isArray(data.top_cities) && data.top_cities.length){
      block.appendChild(admEl('p', 'adm-legend', 'ערים מובילות'));
      const max = Math.max(1, ...data.top_cities.map(c => Number(c.n) || 0));
      const rows = admEl('div', 'adm-rows');
      data.top_cities.forEach(c => rows.appendChild(
        admRow(c.city, null, admInt(c.n), ((Number(c.n) || 0) / max) * 100)));
      block.appendChild(rows);
    }

    host.appendChild(block);
  });

  const sub = document.getElementById('invPanelSub');
  if (sub){
    sub.textContent = plural(props.active, 'נכס אחד', 'נכסים', admInt(props.active)) + ' · ' +
      plural(collab.shares, 'שיתוף אחד', 'שיתופים', admInt(collab.shares)) + ' · ' +
      plural(clients.total, 'לקוח/ה אחד/ת', 'לקוחות', admInt(clients.total)) + ' · ' +
      admInt(media.visualizations) + ' הדמיות';
  }

  dashPanelsMeasure();
}

const INV_BREAKDOWN_LABELS = {
  by_status: 'לפי סטטוס',
  by_deal: 'לפי סוג עסקה',
  by_category: 'לפי קטגוריה',
  by_tier: 'לפי מסלול',
  leads_by_type: 'לידים לפי סוג',
  leads_by_status: 'לידים לפי סטטוס',
  agreements_by_kind: 'הסכמים לפי סוג',
  agreements_by_status: 'הסכמים לפי מצב',
  visualizations_by_kind: 'הדמיות לפי סוג',
  visualization_jobs: 'משימות הדמיה לפי מצב',
  video_jobs: 'משימות סרטון לפי מצב',
};

/* תרגום ערכי סטטוס לעברית. ערך שאין לו תרגום מוצג כמו שהוא — עדיף
   מפתח באנגלית מאשר שורה שנעלמת. */
const INV_VALUE_LABELS = {
  active: 'פעיל', unpublished: 'לא מפורסם', archived: 'בארכיון',
  draft: 'טיוטה', paused: 'מושהה', closed: 'סגור',
  sale: 'מכירה', rent: 'השכרה', commercial: 'מסחרי', land: 'קרקע',
  signed: 'חתום', sent: 'נשלח', cancelled: 'בוטל',
  pending: 'ממתין', processing: 'בעיבוד', done: 'הושלם', failed: 'נכשל',
  unlocked: 'נפתח', locked: 'נעול', refunded: 'הוחזר', success: 'הצליח',
  exclusive_sell: 'בלעדיות מכירה', exclusive_buy: 'בלעדיות קנייה',
  sell: 'מכירה', buy: 'קנייה',
  private_room: 'חדר פרטי', commercial_business: 'עסק מסחרי',
  apartment: 'דירה', house: 'בית', penthouse: 'פנטהאוז',
};

document.querySelectorAll('#invRange button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    invReportDays = Number(btn.dataset.days) || 30;
    document.querySelectorAll('#invRange button')
      .forEach(b => b.classList.toggle('is-on', b === btn));
    loadInventoryReport();
  });
});
document.getElementById('invRefreshBtn').addEventListener('click', loadInventoryReport);

async function loadArticlesAdmin(){
  const listEl = document.getElementById('articlesAdminList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, subtitle, category, cover_url, body, author_name, status, published_at, updated_at')
    .order('updated_at', { ascending:false });

  if (error){
    // 42P01 = הטבלה לא קיימת עדיין — כלומר המיגרציה טרם הורצה בפרויקט
    listEl.innerHTML = '<div class="empty-state">' +
      (error.code === '42P01'
        ? 'טבלת articles לא קיימת עדיין - הריצו את המיגרציה 20260829180000_articles.sql ב-Supabase.'
        : 'שגיאה: ' + error.message) + '</div>';
    return;
  }

  const articles = data || [];
  accSetCount('accArticles', articles.filter(a => a.status === 'published').length + ' פורסמו');

  if (!articles.length){
    listEl.innerHTML = '<div class="empty-state">אין עדיין כתבות. כתבו את הראשונה בטופס שלמעלה.</div>';
    return;
  }

  listEl.innerHTML = '';
  articles.forEach(article => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--line)';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';

    const title = document.createElement('span');
    title.style.cssText = 'font-size:.88rem;font-weight:700';
    title.textContent = article.title;
    head.appendChild(title);

    const badge = document.createElement('span');
    const published = article.status === 'published';
    badge.style.cssText = 'font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:5px;' +
      (published ? 'background:var(--teal-tint);color:var(--teal-dark)' : 'background:var(--gold-tint);color:var(--gold-dark)');
    badge.textContent = published ? 'מפורסמת' : 'טיוטה';
    head.appendChild(badge);

    if (article.category){
      const cat = document.createElement('span');
      cat.style.cssText = 'font-size:.66rem;font-weight:800;background:var(--paper);color:var(--ink-soft);padding:2px 7px;border-radius:5px';
      cat.textContent = article.category;
      head.appendChild(cat);
    }
    row.appendChild(head);

    if (article.subtitle){
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:.74rem;color:var(--ink-soft);margin-top:2px';
      sub.textContent = article.subtitle;
      row.appendChild(sub);
    }

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:.72rem;color:var(--ink-soft);margin-top:2px';
    const when = article.published_at || article.updated_at;
    meta.textContent = (published ? 'פורסמה ' : 'עודכנה ') +
      new Date(when).toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' }) +
      (article.author_name ? ' · ' + article.author_name : '');
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-ghost';
    editBtn.style.padding = '5px 12px';
    editBtn.textContent = 'עריכה';
    editBtn.addEventListener('click', ()=> startArticleEdit(article));
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-ghost';
    toggleBtn.style.padding = '5px 12px';
    toggleBtn.textContent = published ? 'החזרה לטיוטה' : 'פרסום';
    toggleBtn.addEventListener('click', async ()=>{
      toggleBtn.disabled = true;
      const { error: updErr } = await sb.from('articles')
        .update({ status: published ? 'draft' : 'published' }).eq('id', article.id);
      if (updErr){ showToast('שגיאה: ' + updErr.message); toggleBtn.disabled = false; return; }
      showToast(published ? 'הכתבה הוסרה מהאתר' : 'הכתבה פורסמה באתר');
      await loadArticlesAdmin();
    });
    actions.appendChild(toggleBtn);

    if (published){
      const viewLink = document.createElement('a');
      viewLink.className = 'btn btn-ghost';
      viewLink.style.padding = '5px 12px';
      viewLink.target = '_blank';
      viewLink.rel = 'noopener';
      viewLink.href = 'article.html?slug=' + encodeURIComponent(article.slug || article.id);
      viewLink.textContent = 'צפייה';
      actions.appendChild(viewLink);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost';
    delBtn.style.padding = '5px 12px';
    delBtn.textContent = 'מחיקה';
    delBtn.addEventListener('click', async ()=>{
      if (!confirm(`למחוק את הכתבה "${article.title}"? הפעולה אינה הפיכה.`)) return;
      delBtn.disabled = true;
      const { error: delErr } = await sb.from('articles').delete().eq('id', article.id);
      if (delErr){ showToast('שגיאה במחיקה: ' + delErr.message); delBtn.disabled = false; return; }
      // התמונה כבר לא מוצגת בשום מקום — best-effort, כמו בשאר המחיקות
      const path = article.cover_url ? articleCoverPath(article.cover_url) : null;
      if (path) sb.storage.from(ARTICLES_BUCKET).remove([path]).catch(()=>{});
      // עריכה פתוחה של הכתבה שנמחקה הייתה נשמרת בחזרה כשורה חדשה
      if (articleState.editingId === article.id) resetArticleForm();
      showToast('הכתבה נמחקה');
      await loadArticlesAdmin();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

/* ---------- כרטיסיות בעלי מקצוע (platform admin only) ----------
   מוצר פרסום צד-שלישי: מי שקונה אותו אינו סוכן, אין לו חשבון באתר ואין לו
   שורה ב-agency_members (ראו docs/professional-cards.md). עד עכשיו הצד
   היחיד שיכול היה לגעת בכרטיסייה היה בעל/ת המקצוע עצמו/ה, דרך קישור
   הניהול — ולכן רישום בדיקה, כפילות או מי שביקש/ה לרדת מהאתר נשארו שם.

   הקריאה והמחיקה עוברות בשתי פונקציות מסד (admin_list_professional_cards,
   admin_delete_professional_card) שבודקות current_is_platform_admin()
   בעצמן, כמו admin_apply_tier_change. הן לא רק שער: על ad_placements יש
   קריאה ציבורית של שורות active בלבד, ובלעדיהן כרטיסייה מושהית או שפג
   תוקפה — בדיוק זו שצריך לטפל בה — לא הייתה נראית כאן בכלל.
   המיגרציה: 20261019090000_professional_card_admin.sql. */
const PRO_MEDIA_BUCKET = 'property-images';

/* אותן תוויות של דף הבית, professionals.html ו-professional.html — התחום
   נשמר כמפתח באנגלית ומתורגם רק בתצוגה. */
const PRO_TYPE_LABELS = {
  mortgage_advisor:'יועץ/ת משכנתאות', appraiser:'שמאי/ת מקרקעין', architect:'אדריכל/ית',
  interior_designer:'מעצב/ת פנים', real_estate_lawyer:'עו״ד מקרקעין', general:'בעל/ת מקצוע',
};

/* "מוצגת באתר" אינו status='active' בלבד: כרטיסייה שתקופת הפרסום שלה
   נגמרה נשארת active בטבלה, ו-professional_cards_public מסננת אותה לפי
   התאריכים. אותו תנאי בדיוק חוזר כאן, אחרת המסך היה אומר "פעילה" על
   כרטיסייה שאף אחד כבר לא רואה. התאריך ב-UTC כמו current_date במסד. */
function proCardIsLive(card){
  if (card.status !== 'active') return false;
  const today = new Date().toISOString().slice(0, 10);
  if (card.starts_at && card.starts_at > today) return false;
  if (card.ends_at   && card.ends_at   < today) return false;
  return true;
}

function proPill(text, css){
  const el = document.createElement('span');
  el.style.cssText = 'font-size:.66rem;font-weight:800;padding:2px 7px;border-radius:5px;' + css;
  el.textContent = text;
  return el;
}

async function loadProfessionalCardsAdmin(){
  const listEl = document.getElementById('professionalsAdminList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb.rpc('admin_list_professional_cards');
  if (error){
    // ‏PGRST202/42883 = הפונקציה לא קיימת, כלומר המיגרציה טרם רצה על המסד
    listEl.innerHTML = '<div class="empty-state">' + (
      (error.code === '42883' || error.code === 'PGRST202')
        ? 'הרשימה לא קיימת עדיין במסד - הריצו את המיגרציה 20261019090000_professional_card_admin.sql.'
        : (error.code === '42501' || /not_platform_admin/.test(error.message || ''))
          ? 'הרשימה פתוחה למנהל/ת פלטפורמה בלבד.'
          : 'שגיאה: ' + error.message
    ) + '</div>';
    return;
  }

  const cards = Array.isArray(data) ? data : [];
  const live = cards.filter(proCardIsLive).length;
  accSetCount('accProfessionals', cards.length);
  accSetSummary('accProfessionals', cards.length
    ? live + ' מתוך ' + cards.length + ' מוצגות באתר'
    : '');

  if (!cards.length){
    listEl.innerHTML = '<div class="empty-state">אין עדיין בעלי מקצוע רשומים.</div>';
    return;
  }

  listEl.innerHTML = '';
  cards.forEach(card => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--line)';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';

    const name = document.createElement('span');
    name.style.cssText = 'font-size:.88rem;font-weight:700';
    name.textContent = card.advertiser_name || 'ללא שם';
    head.appendChild(name);

    head.appendChild(proPill(
      PRO_TYPE_LABELS[card.advertiser_type] || card.advertiser_type || 'בעל/ת מקצוע',
      'background:var(--teal-tint);color:var(--ink-soft)'));

    if (!proCardIsLive(card)){
      head.appendChild(proPill(
        card.status !== 'active' ? 'לא פעילה' : 'מחוץ לתקופת הפרסום',
        'background:var(--gold-tint);color:var(--gold-dark)'));
    }
    // רישום בדיקה נראה על המסך בדיוק כמו מפרסם משלם. הדגל הזה הוא ההבדל,
    // והוא השיקול הראשון בהחלטה אם למחוק.
    if (card.test_mode){
      head.appendChild(proPill('בדיקה', 'background:var(--gold-tint);color:var(--gold-dark)'));
    }
    if (!card.profile_filled){
      head.appendChild(proPill('פרופיל לא מולא', 'background:var(--paper);color:var(--ink-soft)'));
    }
    row.appendChild(head);

    if (card.business_name){
      const biz = document.createElement('div');
      biz.style.cssText = 'font-size:.78rem;color:var(--ink-soft);margin-top:2px';
      biz.textContent = card.business_name;
      row.appendChild(biz);
    }

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:.72rem;color:var(--ink-soft);margin-top:2px';
    meta.textContent = [
      card.target_region,
      'נרשם/ה ' + new Date(card.created_at).toLocaleDateString('he-IL'),
      card.ends_at ? 'פרסום עד ' + new Date(card.ends_at).toLocaleDateString('he-IL') : null,
      card.gallery_count ? plural(card.gallery_count, 'תמונה אחת בגלריה', 'תמונות בגלריה') : null,
    ].filter(Boolean).join(' · ');
    row.appendChild(meta);

    // כתובת החיוב — לא ציבורית בשום מסך אחר, וכאן היא הדרך היחידה ליצור
    // קשר עם מי שמאחורי הכרטיסייה לפני שמסירים אותה.
    if (card.contact_email){
      const mail = document.createElement('div');
      mail.dir = 'ltr';
      mail.style.cssText = 'font-size:.72rem;color:var(--ink-soft);text-align:left;word-break:break-all;margin-top:2px';
      mail.textContent = card.contact_email;
      row.appendChild(mail);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:8px';

    const viewLink = document.createElement('a');
    viewLink.className = 'btn btn-ghost';
    viewLink.style.padding = '5px 12px';
    viewLink.target = '_blank';
    viewLink.rel = 'noopener';
    viewLink.href = 'professional.html?slug=' + encodeURIComponent(card.slug || card.id);
    viewLink.textContent = 'צפייה';
    actions.appendChild(viewLink);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-ghost';
    delBtn.style.padding = '5px 12px';
    delBtn.textContent = 'מחיקה';
    delBtn.addEventListener('click', async ()=>{
      const label = card.business_name || card.advertiser_name || 'הכרטיסייה';
      if (!confirm(`למחוק את "${label}"? הכרטיסייה, עמוד הפרופיל, קישור הניהול שנשלח למפרסם והתמונות באחסון יימחקו. הפעולה אינה הפיכה.`)) return;
      delBtn.disabled = true;

      const { data: res, error: delErr } = await sb.rpc('admin_delete_professional_card', { p_id: card.id });
      if (delErr){ showToast('שגיאה במחיקה: ' + delErr.message); delBtn.disabled = false; return; }
      if (res && res.error){
        showToast(res.error === 'not_found' ? 'הכרטיסייה כבר לא קיימת' : 'שגיאה במחיקה: ' + res.error);
        delBtn.disabled = false;
        await loadProfessionalCardsAdmin();
        return;
      }

      // התמונות כבר לא מוצגות בשום מקום — best-effort, כמו במחיקת כתבה.
      // הנתיבים מגיעים מהמסד ולא מהמסך, כי אחרי המחיקה הכתובות כבר לא
      // קיימות בשום שורה.
      const media = Array.isArray(res && res.media) ? res.media : [];
      if (media.length) sb.storage.from(PRO_MEDIA_BUCKET).remove(media).catch(()=>{});

      showToast('הכרטיסייה נמחקה');
      await loadProfessionalCardsAdmin();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    listEl.appendChild(row);
  });
}

/* ---------- Lead preferences (module 2 §3 — every agent, regardless of role) ---------- */
let allNeighborhoods = [];
async function loadPreferences(agentId){
  const { data: neighborhoods } = await sb.from('neighborhoods').select('id, city, name').order('name');
  allNeighborhoods = neighborhoods || [];

  const { data: prefs } = await sb
    .from('agent_lead_preferences')
    .select('preferred_neighborhoods, preferred_property_types, preferred_deal_types, active')
    .eq('agent_id', agentId)
    .maybeSingle();

  renderNeighborhoodCheckboxes(prefs?.preferred_neighborhoods || []);

  document.querySelectorAll('.prefPropertyType').forEach(cb=>{
    cb.checked = (prefs?.preferred_property_types || []).includes(cb.value);
  });
  document.querySelectorAll('.prefDealType').forEach(cb=>{
    cb.checked = (prefs?.preferred_deal_types || []).includes(cb.value);
  });
  document.getElementById('prefsActive').checked = prefs ? prefs.active : true;
  accSetCount('accPrefs', (prefs && prefs.active) ? 'פעיל' : 'כבוי');
}

function renderNeighborhoodCheckboxes(selectedIds){
  const el = document.getElementById('neighborhoodCheckboxes');
  el.innerHTML = '';
  allNeighborhoods.forEach(n=>{
    const label = document.createElement('label');
    label.style.cssText = 'font-weight:400;font-size:.8rem;background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:5px 12px;display:inline-flex;align-items:center;gap:5px;cursor:pointer';
    label.innerHTML = `<input type="checkbox" class="prefNeighborhood" value="${n.id}" style="margin:0" ${selectedIds.includes(n.id) ? 'checked' : ''}> ${n.name}`;
    el.appendChild(label);
  });
}

document.getElementById('prefsForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('savePrefsBtn');
  const feedback = document.getElementById('prefsFeedback');
  btn.disabled = true; btn.textContent = 'שומר…'; feedback.textContent = '';

  const preferred_neighborhoods = Array.from(document.querySelectorAll('.prefNeighborhood:checked')).map(cb=>cb.value);
  const preferred_property_types = Array.from(document.querySelectorAll('.prefPropertyType:checked')).map(cb=>cb.value);
  const preferred_deal_types = Array.from(document.querySelectorAll('.prefDealType:checked')).map(cb=>cb.value);
  const active = document.getElementById('prefsActive').checked;

  const { error } = await sb.from('agent_lead_preferences').upsert({
    agent_id: currentAgent.id,
    preferred_neighborhoods,
    preferred_property_types,
    preferred_deal_types,
    active,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_id' });

  btn.disabled = false; btn.textContent = 'שמירת העדפות';
  if (error){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאה: ' + error.message;
    return;
  }
  feedback.style.color = 'var(--blue)';
  feedback.textContent = 'ההעדפות נשמרו בהצלחה!';
  accSetCount('accPrefs', active ? 'פעיל' : 'כבוי');
  setTimeout(()=>{ feedback.textContent=''; }, 2500);
});

/* ---------- WhatsApp ----------
   מספר הטלפון כאן הוא מפתח הזיהוי של הבוט: ה-Edge Function ‏whatsapp-webhook
   מחפש את הסוכן/ת לפי agency_members.phone_e164, שנגזרת אוטומטית מ-phone.
   בלי מספר מעודכן — הבוט יענה "איני מזהה את מספר הטלפון שלך". */
/* המספר העסקי של העוזר (Meta WhatsApp Cloud API). מזהה ציבורי ולא סוד —
   הוא מודפס על כל הודעה שהעוזר שולח — ולכן הוא יושב כאן ולא ב-Secrets.
   אם המספר מוחלף ב-Meta, זו השורה שמתעדכנת, ולצדה docs/whatsapp-setup.md. */
const ASSISTANT_WA_NUMBER = '972532494740';
const ASSISTANT_WA_DISPLAY = '053-249-4740';

/* הודעת הפתיחה אינה קישוט. שתי סיבות:
   ‏1. היא חוסכת לסוכן/ת את "מה כותבים לבוט" ברגע הראשון, שהוא הרגע שבו
      רוב האנשים סוגרים את החלון.
   ‏2. היא פותחת את חלון 24 השעות של Meta, וזה מה שמאפשר להתראות לצאת
      כטקסט חופשי מלא (עם קישורים, ובחינם) במקום כתבנית. */
const ASSISTANT_WA_HELLO = 'שלום, מה אפשר לעשות כאן?';

/* ---------- הכרטיס שפותח את הצ'אט ----------
   ‏disabled ולא מוסתר כשאין מספר שמור: כפתור שנעלם נראה כמו באג, וכפתור
   שאומר "קודם שמרו את המספר" הוא הוראה. והסדר הזה חשוב — בוט שמקבל הודעה
   ממספר שאינו רשום עונה "איני מזהה את מספר הטלפון שלך", וזו חוויה ראשונה
   גרועה שאפשר פשוט למנוע. */
function renderWaStartCard(phone){
  const card = document.getElementById('waStartCard');
  if (!card) return;
  card.hidden = false;
  document.getElementById('waStartNum').textContent = ASSISTANT_WA_DISPLAY;

  const saved = !!String(phone || '').trim();
  card.classList.toggle('is-locked', !saved);
  document.getElementById('waStartBtn').href = saved
    ? `https://wa.me/${ASSISTANT_WA_NUMBER}?text=${encodeURIComponent(ASSISTANT_WA_HELLO)}`
    : '#';
  document.getElementById('waStartBtnLabel').textContent = saved
    ? "פתיחת צ'אט עם העוזר"
    : 'קודם שמרו את המספר שלכם למטה';
  document.getElementById('waStartHint').textContent = saved
    ? 'חשוב: יש לשלוח מהמכשיר שבו מותקן המספר שרשום למטה - לפי המספר הזה העוזר מזהה אתכם.'
    : '';
}

function loadWhatsappSettings(agent){
  document.getElementById('waPhone').value = agent.phone || '';
  accSetCount('accWhatsapp', agent.phone ? 'מחובר' : 'לא מוגדר');
  renderWaStartCard(agent.phone);

  /* המסלול נאמר לשני הכיוונים, כי שניהם נכונים: מי שבמסלול צריך לדעת
     שהמספר הוא מה שמחבר אותו/ה, ומי שלא — למה ההודעה לא תיענה. שמירת
     המספר עצמה נשארת פתוחה לכולם: היא משרתת גם את תזכורות הוואטסאפ
     (ראו "תזכורות וטיפים"), שאינן חלק מהעוזר. */
  const note = document.getElementById('waTierNote');
  if (note){
    note.innerHTML = assistantTierOk()
      ? 'העוזר זמין במסלול שלך. אם ההודעה לא נענתה - בדקו שהמספר כאן הוא ' +
        'המספר שממנו שלחתם.'
      : 'העוזר האישי זמין במסלולים <strong>PROFESSIONAL</strong> ו-<strong>Elite</strong>. ' +
        'במסלול Pay&amp;GO אפשר להוסיף ולעדכן נכסים מהדשבורד, והודעה לעוזר תיענה ' +
        'בהסבר ובקישור. <a href="pricing.html" target="_blank" rel="noopener">לפרטים ולשדרוג</a>';
  }
}

document.getElementById('whatsappForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('saveWhatsappBtn');
  const feedback = document.getElementById('whatsappFeedback');
  const phone = document.getElementById('waPhone').value.trim();

  // בדיקה מקדימה בצד הלקוח מול אותו כלל של normalize_msisdn בשרת — עדיף להגיד
  // "המספר לא נראה תקין" מאשר לשמור מספר שהבוט לעולם לא יזהה
  if (phone && phone.replace(/\D/g, '').length < 9){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'המספר לא נראה תקין - צריך מספר ישראלי מלא.';
    return;
  }

  btn.disabled = true; btn.textContent = 'שומר…'; feedback.textContent = '';

  const { error } = await sb.from('agency_members')
    .update({ phone: phone || null, updated_at: new Date().toISOString() })
    .eq('id', currentAgent.id);

  btn.disabled = false; btn.textContent = 'שמירת המספר';
  if (error){
    feedback.style.color = 'var(--red)';
    // 23505 = מספר הוואטסאפ כבר משויך לסוכן/ת אחר/ת (אינדקס ייחודי על phone_e164)
    feedback.textContent = error.code === '23505'
      ? 'המספר הזה כבר רשום אצל סוכן/ת אחר/ת במערכת.'
      : 'שגיאה: ' + error.message;
    return;
  }

  currentAgent.phone = phone || null;
  accSetCount('accWhatsapp', phone ? 'מחובר' : 'לא מוגדר');
  // הכפתור נפתח באותה לחיצה שבה נשמר המספר — בלי רענון ובלי לחפש אותו שוב
  renderWaStartCard(phone);
  // וההערה ב"ניהול התראות" תלויה גם היא במספר שמור
  syncNotifWaNote();
  feedback.style.color = 'var(--blue)';
  feedback.textContent = phone ? 'המספר נשמר - אפשר לפתוח את הצ׳אט למעלה.' : 'הגישה מוואטסאפ כובתה.';
  setTimeout(()=>{ feedback.textContent=''; }, 3000);
});

/* ==========================================================================
   עדכון פרטי הסוכן/ת
   --------------------------------------------------------------------------
   הקטגוריה שנפתחת בלחיצה על האווטאר בכותרת. עורכת את שורת agency_members של
   הסוכן/ת עצמו/ה — שם, מספר רישיון, תיאור, תמונת סוכן/ת ותמונת נושא — ואלה
   בדיוק השדות שדף הסוכן/ת הציבורי (agent.html) קורא מה-view.

   התמונות נשמרות ב-Storage לפני הכתיבה ל-DB, ותמונה שהוחלפה נמחקת רק אחרי
   שהשמירה הצליחה — אותה תבנית של מיתוג המשרד, כדי לא לאבד תמונה שעדיין
   מוצגת באתר אם השמירה נכשלת באמצע.
   ========================================================================== */
const PROFILE_BUCKET = 'property-images'; // אותו bucket ציבורי; הנתיב מפריד בין נכסים לפרופיל
let profileState = null;

/* תחומי ההתמחות — אוצר מילים סגור ולא טקסט חופשי, כדי שהתגיות בדף הסוכן/ת
   ייראו אותו דבר אצל כולם ויהיו ניתנות לסינון בהמשך. הערך שנשמר הוא התווית
   עצמה: זו רשימת תצוגה, ואין קוד שמפרש אותה. */
const SPECIALTY_OPTIONS = [
  'מגורים', 'מסחרי', 'מגרשים וקרקעות', 'השקעות ונכסים מניבים',
  'יזמות ופרויקטים', 'שכירות', 'תמ״א והתחדשות עירונית', 'משקי בית ונחלות',
];
const MAX_SPECIALTIES = 4;

/* עד ארבעה תחומים — מעבר לזה שורת התגיות בראש הדף נשברת לשלוש שורות
   ומפסיקה להיסרק במבט אחד. הנעילה היא ויזואלית: מה שכבר מסומן תמיד נשאר לחיץ. */
function renderSpecialtyChoices(selected){
  const container = document.getElementById('pfSpecialties');
  const chosen = Array.isArray(selected) ? selected : [];
  container.innerHTML = SPECIALTY_OPTIONS.map(label => `
    <label class="checkbox-item"><input type="checkbox" value="${label}" ${chosen.includes(label) ? 'checked' : ''}> ${label}</label>
  `).join('');
  container.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', ()=>{ enforceSpecialtyLimit(); renderProfilePreview(); });
  });
  enforceSpecialtyLimit();
}

function selectedSpecialties(){
  return Array.from(document.querySelectorAll('#pfSpecialties input:checked')).map(el => el.value);
}

function enforceSpecialtyLimit(){
  const full = selectedSpecialties().length >= MAX_SPECIALTIES;
  document.querySelectorAll('#pfSpecialties input').forEach(input => {
    input.disabled = full && !input.checked;
    input.closest('.checkbox-item').style.opacity = input.disabled ? '.45' : '';
  });
}

/* ---- מיקוד תמונת הסוכן/ת ----
   התמונה מוצגת בכל הדפים ב-object-fit:cover, כלומר תמיד נחתכת למידות של
   החלון שמציג אותה. ברירת המחדל של הדפדפן היא לחתוך סביב מרכז הקובץ, ובפורטרט
   טיפוסי הפנים יושבות מעל המרכז — ומה שנחתך הוא הראש. הנקודה שנשמרת כאן היא
   מה שחייב להישאר בפריים, והיא נכתבת ל-photo_position ומוזנת ל-object-position
   בכל מקום שהתמונה מוצגת בו. */
const DEFAULT_PHOTO_POS = { x:50, y:25 };

function parsePhotoPosition(value){
  const m = /^(\d{1,3})% (\d{1,3})%$/.exec(value || '');
  if (!m) return { ...DEFAULT_PHOTO_POS };
  return { x: Math.min(100, +m[1]), y: Math.min(100, +m[2]) };
}

function photoPositionCss(pos){
  const p = pos || DEFAULT_PHOTO_POS;
  return `${Math.round(p.x)}% ${Math.round(p.y)}%`;
}

/* האווטאר בכותרת מציג את התמונה אם יש, ואת האות הראשונה אם אין */
function renderHeaderAvatar(agent){
  const initial = document.getElementById('avatarInitial');
  const photo = document.getElementById('avatarPhoto');
  const url = agent && agent.photo_url;
  initial.textContent = ((agent && agent.display_name) || '?')[0];
  initial.hidden = !!url;
  photo.hidden = !url;
  if (url){
    photo.src = url;
    photo.style.setProperty('--photo-pos', photoPositionCss(parsePhotoPosition(agent.photo_position)));
  } else {
    photo.removeAttribute('src');
  }
}

/* פרופיל בלי תמונה או בלי תיאור נראה חצי-ריק ללקוח, ולכן הקטגוריה מסומנת
   "להשלמה" עד שיש שניהם */
function profileComplete(agent){
  return !!(agent && agent.photo_url && (agent.bio || '').trim());
}

/* תמונת הרקע של המשרד, ברירת המחדל לרצועה בראש דף הסוכן/ת. נטענת בנפרד
   מ-brandingState, שקיים רק אצל מנהל/ת משרד. */
let agencyCoverUrl = null;
async function loadAgencyCover(agencyId){
  if (!agencyId) return;
  const { data } = await sb.from('agencies').select('cover_url').eq('id', agencyId).maybeSingle();
  agencyCoverUrl = (data && data.cover_url) || null;
  if (agencyCoverUrl) renderProfilePreview();
}

function loadProfileSettings(agent){
  // טעינה חוזרת (החלפת תפקיד בתפריט הבדיקה, למשל) לא אמורה להשאיר blob URL תלוי באוויר
  if (profileState){
    ['photo','cover'].forEach(k=>{
      const slot = profileState[k];
      if (slot && slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
    });
    (profileState.gallery || []).forEach(item=>{
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }
  profileState = {
    photo: agent.photo_url ? { url: agent.photo_url } : null,
    cover: agent.cover_url ? { url: agent.cover_url } : null,
    photoPos: parsePhotoPosition(agent.photo_position),
    // אותו מבנה בדיוק כמו גלריית המשרד: {url, caption} לפי הסדר
    gallery: (Array.isArray(agent.gallery) ? agent.gallery : [])
      .filter(g => g && g.url)
      .map(g => ({ url: g.url, caption: g.caption || '' })),
    // ‏'' = "כמו המשרד". ‏agency_members.page_bg יכול להיות NULL (ברירת מחדל)
    // או 'flow'/'plain' כעקיפה אישית — ראו המיגרציה 20260914091000.
    pageBg: agent.page_bg === 'flow' || agent.page_bg === 'plain' ? agent.page_bg : '',
    pendingDeletes: [],
  };
  renderProfileBgChoice();
  document.getElementById('pfName').value = agent.display_name || '';
  document.getElementById('pfLicense').value = agent.license_number || '';
  document.getElementById('pfIdNumber').value = agent.id_number || '';
  document.getElementById('pfBio').value = agent.bio || '';
  document.getElementById('pfYears').value = agent.years_experience == null ? '' : agent.years_experience;
  document.getElementById('pfArea').value = agent.service_area || '';
  document.getElementById('pfCredentials').value = agent.credentials || '';
  renderSpecialtyChoices(agent.specialties);
  // slug יכול להיות ריק לסוכנים ותיקים — agent.html יודע לקבל גם id גולמי
  document.getElementById('pfViewPageLink').href = 'agent.html?slug=' + encodeURIComponent(agent.slug || agent.id);
  accSetCount('accProfile', profileComplete(agent) ? '' : 'להשלמה');
  renderProfileImages();
  renderProfilePreview();
  loadAgencyCover(agent.agency_id);
}

/* ---------- רקע דף הסוכן/ת ----------
   שלוש אפשרויות, ולא שתיים כמו במקטע המיתוג של המשרד: הראשונה היא "כמו
   המשרד" — ברירת המחדל, שנשמרת כ-NULL ומשאירה את ההחלטה אצל מנהל/ת המשרד.
   שתי האחרות הן עקיפה אישית של דף הסוכן/ת בלבד, וחזרה לראשונה מחזירה את
   ברירת המחדל. אותם כרטיסים ואותו CSS (‏.bg-choice/.bg-card) של המשרד. */
const PROFILE_BG_OPTIONS = [
  { id:'',      thumb:'inherit', name:'כמו המשרד (ברירת מחדל)', desc:'מה שנבחר במקטע המיתוג של המשרד' },
  { id:'flow',  thumb:'flow',    name:'הרקע של האתר',           desc:'שמש, קו רקיע וגלים שזורמים עם הגלילה' },
  { id:'plain', thumb:'plain',   name:'רקע חלק',                desc:'צבע נייר אחיד, בלי תנועה' },
];

function renderProfileBgChoice(){
  const box = document.getElementById('pfBgChoice');
  if (!box || !profileState) return;
  box.textContent = '';
  PROFILE_BG_OPTIONS.forEach(opt=>{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bg-card' + (profileState.pageBg === opt.id ? ' active' : '');
    card.setAttribute('aria-pressed', profileState.pageBg === opt.id ? 'true' : 'false');
    card.innerHTML = `<div class="bg-thumb ${opt.thumb}"></div>
      <div><div class="bname">${opt.name}</div><div class="bdesc">${opt.desc}</div></div>`;
    card.addEventListener('click', ()=>{
      profileState.pageBg = opt.id;
      renderProfileBgChoice();
    });
    box.appendChild(card);
  });
}

function renderProfileImages(){
  if (!profileState) return;
  renderSingleImage('pfPhotoPreview', profileState.photo, 'logo', ()=> clearProfileImage('photo'));
  renderSingleImage('pfCoverPreview', profileState.cover, 'cover', ()=> clearProfileImage('cover'));
  renderPhotoFocus();
  renderProfileGalleryAdmin();
}

/* ---- הגלריה האישית של הסוכן/ת ----
   אותה עריכה בדיוק שיש לגלריית המשרד — הוספה, סידור, כיתוב ומחיקה — רק
   שהיא כותבת ל-agency_members.gallery ולא ל-agencies.gallery, ולכן כל סוכן/ת
   עורך/ת את שלו/ה. */
document.getElementById('pfGalleryInput').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!profileState) return;
  const room = MAX_GALLERY_IMAGES - profileState.gallery.length;
  if (room <= 0){ showToast(`אפשר עד ${MAX_GALLERY_IMAGES} תמונות בגלריה`); return; }
  for (const file of files.slice(0, room)){
    try{
      const blob = await fileToResizedBlob(file, 1600);
      profileState.gallery.push({ blob, previewUrl: URL.createObjectURL(blob), caption: '' });
    } catch(err){
      console.warn('profile gallery resize failed', file.name, err);
      showToast('קובץ אחד לא נטען: ' + file.name);
    }
  }
  if (files.length > room) showToast(`${plural(room, 'נוספה תמונה אחת בלבד', 'תמונות בלבד', 'נוספו ' + room)} - המקסימום הוא ${MAX_GALLERY_IMAGES}`);
  renderProfileGalleryAdmin();
});

function renderProfileGalleryAdmin(){
  const grid = document.getElementById('pfGalleryGrid');
  const empty = document.getElementById('pfGalleryEmpty');
  if (!grid) return;
  grid.textContent = '';
  const items = profileState ? profileState.gallery : [];
  empty.style.display = items.length === 0 ? 'block' : 'none';

  items.forEach((item, i)=>{
    const cell = document.createElement('div');
    cell.className = 'gallery-admin-item';

    const ph = document.createElement('div');
    ph.className = 'ph';
    const img = document.createElement('img');
    img.src = item.previewUrl || item.url;
    img.alt = '';
    ph.appendChild(img);

    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.title = 'מחיקה'; x.textContent = '✕';
    x.addEventListener('click', ()=> removeProfileGalleryImage(i));
    ph.appendChild(x);

    if (i > 0){
      const right = document.createElement('button');
      right.type = 'button'; right.className = 'move move-right'; right.title = 'הזזה ימינה'; right.textContent = '›';
      right.addEventListener('click', ()=> moveProfileGalleryImage(i, -1));
      ph.appendChild(right);
    }
    if (i < items.length - 1){
      const left = document.createElement('button');
      left.type = 'button'; left.className = 'move move-left'; left.title = 'הזזה שמאלה'; left.textContent = '‹';
      left.addEventListener('click', ()=> moveProfileGalleryImage(i, 1));
      ph.appendChild(left);
    }
    if (!item.url){
      const tag = document.createElement('span');
      tag.className = 'pending';
      tag.textContent = 'ממתין לשמירה';
      ph.appendChild(tag);
    }

    const caption = document.createElement('input');
    caption.type = 'text';
    caption.placeholder = 'כיתוב (לא חובה)';
    caption.maxLength = 90;
    caption.value = item.caption || '';
    caption.addEventListener('input', ()=> { item.caption = caption.value; });

    cell.appendChild(ph);
    cell.appendChild(caption);
    grid.appendChild(cell);
  });
}

function removeProfileGalleryImage(i){
  const [item] = profileState.gallery.splice(i, 1);
  if (!item) return;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.url) queueProfileDelete(item.url);
  renderProfileGalleryAdmin();
}

function moveProfileGalleryImage(i, delta){
  const target = i + delta;
  if (target < 0 || target >= profileState.gallery.length) return;
  const [item] = profileState.gallery.splice(i, 1);
  profileState.gallery.splice(target, 0, item);
  renderProfileGalleryAdmin();
}

/* ---- כלי סימון נקודת המיקוד ----
   ה-stage מציג את התמונה במלואה (contain), ולכן שטח התמונה בתוכו קטן מהמלבן
   עצמו. שתי הפונקציות למטה מתרגמות בין קואורדינטות העכבר/המגע לקואורדינטות
   *התמונה*, לפי אותו חישוב contain שהדפדפן עושה — אחרת הסימון היה זז ביחס
   לאצבע בכל תמונה שאינה ריבועית. */
function focusImageRect(){
  const stage = document.getElementById('pfFocusStage');
  const img = document.getElementById('pfFocusImg');
  const box = stage.getBoundingClientRect();
  const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
  const scale = Math.min(box.width / nw, box.height / nh) || 0;
  const w = nw * scale, h = nh * scale;
  return { box, w, h, offsetX: (box.width - w) / 2, offsetY: (box.height - h) / 2 };
}

function renderPhotoFocus(){
  const wrap = document.getElementById('pfPhotoFocus');
  const img = document.getElementById('pfFocusImg');
  const slot = profileState && profileState.photo;
  const src = slot ? (slot.previewUrl || slot.url) : null;
  wrap.hidden = !src;
  if (!src){ img.removeAttribute('src'); return; }
  if (img.getAttribute('src') !== src) img.src = src;
  positionFocusDot();
}

function positionFocusDot(){
  if (!profileState || !profileState.photo) return;
  const dot = document.getElementById('pfFocusDot');
  const { box, w, h, offsetX, offsetY } = focusImageRect();
  // ה-details סגור (רוחב 0) או שהתמונה עוד לא נטענה — הסימון ימוקם בפעם
  // הבאה שה-ResizeObserver יתעורר
  if (!box.width || !w) return;
  const pos = profileState.photoPos || DEFAULT_PHOTO_POS;
  dot.style.left = ((offsetX + w * pos.x / 100) / box.width * 100) + '%';
  dot.style.top = ((offsetY + h * pos.y / 100) / box.height * 100) + '%';
}

function setFocusFromPointer(e){
  const { box, w, h, offsetX, offsetY } = focusImageRect();
  if (!w || !h) return;
  const clamp = v => Math.max(0, Math.min(100, v));
  profileState.photoPos = {
    x: clamp((e.clientX - box.left - offsetX) / w * 100),
    y: clamp((e.clientY - box.top - offsetY) / h * 100),
  };
  positionFocusDot();
  renderProfilePreview();
}

(function initPhotoFocus(){
  const stage = document.getElementById('pfFocusStage');
  const img = document.getElementById('pfFocusImg');
  let dragging = false;

  stage.addEventListener('pointerdown', e => {
    if (!profileState || !profileState.photo) return;
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    setFocusFromPointer(e);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', e => { if (dragging) setFocusFromPointer(e); });
  ['pointerup','pointercancel'].forEach(type => stage.addEventListener(type, e => {
    dragging = false;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  }));

  img.addEventListener('load', positionFocusDot);
  // הקטגוריה בדשבורד היא <details>: כשהיא סגורה ל-stage אין מידות, ולכן
  // הסימון ממוקם מחדש ברגע שהיא נפתחת (וגם בכל שינוי רוחב מסך)
  if (window.ResizeObserver) new ResizeObserver(positionFocusDot).observe(stage);

  document.getElementById('pfFocusReset').addEventListener('click', ()=>{
    if (!profileState) return;
    profileState.photoPos = { ...DEFAULT_PHOTO_POS };
    positionFocusDot();
    renderProfilePreview();
  });
})();

function queueProfileDelete(url){
  const path = storagePathFromPublicUrl(url);
  if (path) profileState.pendingDeletes.push(path);
}

function clearProfileImage(kind){
  const slot = profileState[kind];
  if (!slot) return;
  if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
  if (slot.url) queueProfileDelete(slot.url);
  profileState[kind] = null;
  renderProfileImages();
  renderProfilePreview();
}

async function pickProfileImage(e, kind, maxDim){
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file || !profileState) return;
  try{
    const blob = await fileToResizedBlob(file, maxDim);
    const previous = profileState[kind];
    if (previous){
      if (previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      if (previous.url) queueProfileDelete(previous.url);
    }
    profileState[kind] = { blob, previewUrl: URL.createObjectURL(blob) };
    // תמונה חדשה מתחילה ממיקוד ברירת המחדל: הנקודה שסומנה על התמונה הקודמת
    // לא אומרת דבר על החדשה
    if (kind === 'photo') profileState.photoPos = { ...DEFAULT_PHOTO_POS };
    renderProfileImages();
    renderProfilePreview();
  } catch(err){
    console.warn('profile image resize failed', err);
    showToast('לא ניתן לקרוא את הקובץ');
  }
}

document.getElementById('pfPhotoInput').addEventListener('change', (e)=> pickProfileImage(e, 'photo', 640));
document.getElementById('pfCoverInput').addEventListener('change', (e)=> pickProfileImage(e, 'cover', 1920));

/* התצוגה המקדימה מחקה את ראש דף הסוכן/ת, ומתעדכנת מהטופס בזמן הקלדה */
function renderProfilePreview(){
  const nameEl = document.getElementById('pfName');
  const bioEl = document.getElementById('pfBio');
  const name = nameEl.value.trim();
  const license = document.getElementById('pfLicense').value.trim();
  const bio = bioEl.value.trim();

  document.getElementById('ppName').textContent = name || 'השם שלך';
  document.getElementById('ppLicense').textContent = license ? ('רישיון תיווך ' + license) : '';
  // התו בתצוגה המקדימה מופיע בדיוק כשהוא מופיע בדף הציבורי — כך הסוכן/ת רואה
  // מיד מה האישור בקטגוריה שמתחת עשה לדף שלו/ה
  const ppBadge = document.getElementById('ppBadge');
  if (ppBadge) ppBadge.hidden = !ethicsBadgeActive(currentAgent);
  document.getElementById('ppBio').textContent = bio || 'התיאור שתכתבו כאן יופיע בראש דף הסוכן/ת.';
  document.getElementById('pfBioCount').textContent = String(bioEl.value.length);

  // אותה שורת תגיות שתופיע בדף הציבורי, באותו סדר — כך שמה שנראה כאן הוא מה שיש שם
  const pills = document.getElementById('ppPills');
  if (pills){
    const years = parseInt(document.getElementById('pfYears').value, 10);
    const items = [];
    if (Number.isFinite(years) && years > 0) items.push(years + '+ שנות ניסיון');
    selectedSpecialties().forEach(s => items.push(s));
    const credentials = document.getElementById('pfCredentials').value.trim();
    if (credentials) items.push(credentials);
    pills.innerHTML = items.map(t => `<span>${esc(t)}</span>`).join('');
  }

  // בלי תמונת נושא אישית דף הסוכן/ת מציג את תמונת הרקע של המשרד — והתצוגה
  // המקדימה מראה בדיוק את אותה נפילה
  const coverSrc = (profileState && profileState.cover ? (profileState.cover.previewUrl || profileState.cover.url) : null)
    || agencyCoverUrl;
  // ריק מחזיר את הגרדיאנט שמוגדר ב-CSS במקום להשאיר תמונה ישנה
  document.getElementById('ppCover').style.backgroundImage = coverSrc ? `url("${coverSrc}")` : '';

  const avatar = document.getElementById('ppAvatar');
  const photoSrc = profileState && profileState.photo ? (profileState.photo.previewUrl || profileState.photo.url) : null;
  avatar.textContent = '';
  if (photoSrc){
    const img = document.createElement('img');
    img.src = photoSrc; img.alt = '';
    // אותה נקודת מיקוד שמסומנת מתחת לטופס — כאן היא נראית בפועל על הפריים
    img.style.setProperty('--photo-pos', photoPositionCss(profileState.photoPos));
    avatar.appendChild(img);
  } else {
    avatar.textContent = (name || '?')[0];
  }
}

['pfName','pfLicense','pfBio','pfYears','pfCredentials','pfArea'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderProfilePreview);
});

async function uploadProfileBlob(blob, prefix){
  const name = `${currentAgent.id}/profile/${prefix}-${crypto.randomUUID()}.${imageBlobExt(blob)}`;
  const { error } = await sb.storage.from(PROFILE_BUCKET).upload(name, blob, {
    contentType:imageBlobType(blob), cacheControl:'31536000', upsert:false,
  });
  if (error) throw error;
  return sb.storage.from(PROFILE_BUCKET).getPublicUrl(name).data.publicUrl;
}

document.getElementById('profileForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent || !profileState) return;
  const btn = document.getElementById('pfSaveBtn');
  const feedback = document.getElementById('pfFeedback');
  const name = document.getElementById('pfName').value.trim();
  const license = document.getElementById('pfLicense').value.trim();
  const bio = document.getElementById('pfBio').value.trim();
  // שדות התגיות — כולם רשות, וריק נשמר כ-null ולא כמחרוזת ריקה, כדי שדף
  // הסוכן/ת יוכל פשוט לבדוק "יש ערך?" בלי לנקות רווחים בצד שלו
  const yearsRaw = document.getElementById('pfYears').value.trim();
  const years = yearsRaw === '' ? null : parseInt(yearsRaw, 10);
  const serviceArea = document.getElementById('pfArea').value.trim();
  const credentials = document.getElementById('pfCredentials').value.trim();
  const specialties = selectedSpecialties();

  if (years !== null && (!Number.isFinite(years) || years < 0 || years > 70)){
    feedback.style.color = 'var(--wine)';
    feedback.textContent = 'שנות הוותק צריכות להיות מספר בין 0 ל-70.';
    return;
  }

  if (!name || !license){
    feedback.style.color = 'var(--wine)';
    feedback.textContent = 'שם מלא ומספר רישיון הם שדות חובה.';
    return;
  }

  const uploading = (profileState.photo && !profileState.photo.url)
    || (profileState.cover && !profileState.cover.url)
    || profileState.gallery.some(g => !g.url);
  btn.disabled = true; btn.textContent = 'שומר…';
  feedback.style.color = 'var(--ink-soft)';
  feedback.textContent = uploading ? 'מעלה תמונות…' : 'שומר…';

  try{
    // מעלים קודם ורק אז כותבים ל-DB: אם ההעלאה נכשלת, השורה נשארת עקבית עם ה-Storage
    if (profileState.photo && !profileState.photo.url){
      profileState.photo.url = await uploadProfileBlob(profileState.photo.blob, 'photo');
    }
    if (profileState.cover && !profileState.cover.url){
      profileState.cover.url = await uploadProfileBlob(profileState.cover.blob, 'cover');
    }
    for (const item of profileState.gallery){
      if (!item.url) item.url = await uploadProfileBlob(item.blob, 'gallery');
    }

    feedback.textContent = 'שומר…';
    // קוראים את השורה חזרה במקום להניח מה נשמר: טריגר ההגנה על agency_members
    // מחזיר שדות נעולים לערכם הישן בשקט, ועדיף להציג את מה שבאמת יושב ב-DB
    const patch = {
      display_name: name,
      license_number: license,
      id_number: document.getElementById('pfIdNumber').value.trim() || null,
      bio: bio || null,
      photo_url: profileState.photo ? profileState.photo.url : null,
      photo_position: profileState.photo ? photoPositionCss(profileState.photoPos) : null,
      cover_url: profileState.cover ? profileState.cover.url : null,
      years_experience: years,
      service_area: serviceArea || null,
      credentials: credentials || null,
      specialties: specialties.length ? specialties : null,
      gallery: profileState.gallery.map(g => ({ url: g.url, caption: (g.caption || '').trim() })),
      // ‏'' = "כמו המשרד", ונשמר כ-NULL כדי שדף הסוכן/ת יירש את בחירת המשרד
      page_bg: profileState.pageBg || null,
      updated_at: new Date().toISOString(),
    };
    const RETURNED = 'display_name, license_number, id_number, bio, photo_url, photo_position, cover_url, ' +
      'years_experience, service_area, credentials, specialties, gallery';

    const saveProfile = (body, returned) => sb.from('agency_members').update(body)
      .eq('id', currentAgent.id).select(returned).single();

    let { data: saved, error } = await saveProfile(patch, RETURNED + ', page_bg');
    // ‏page_bg נוספה אחרי שה-CRM כבר היה באוויר. בסביבה שבה המיגרציה עוד לא
    // רצה, PostgREST מפיל את *כל* השמירה על עמודה חסרה — ולכן נסיון שני בלי
    // בחירת הרקע בלבד: לפרופיל עצמו יש חשיבות גדולה יותר מהעדפת התצוגה.
    if (error && /page_bg|id_number/.test(error.message || '')){
      console.warn('שמירה נכשלה על עמודה חסרה - נשמר הפרופיל בלעדיה:', error);
      const { page_bg, id_number, ...core } = patch;
      ({ data: saved, error } = await saveProfile(core, RETURNED.replace('id_number, ', '')));
    }
    if (error) throw error;

    // ניקוי best-effort: השורה כבר לא מצביעה על הקבצים האלה
    if (profileState.pendingDeletes.length){
      sb.storage.from(PROFILE_BUCKET).remove(profileState.pendingDeletes).catch(()=>{});
      profileState.pendingDeletes = [];
    }

    Object.assign(currentAgent, saved);
    document.getElementById('pfName').value = saved.display_name || '';
    document.getElementById('pfLicense').value = saved.license_number || '';
    document.getElementById('pfIdNumber').value = saved.id_number || '';
    document.getElementById('pfBio').value = saved.bio || '';
    document.getElementById('pfYears').value = saved.years_experience == null ? '' : saved.years_experience;
    document.getElementById('pfArea').value = saved.service_area || '';
    document.getElementById('pfCredentials').value = saved.credentials || '';
    renderSpecialtyChoices(saved.specialties);
    // מה שחזר מה-DB, ולא מה שנבחר במסך: אם הנסיון השני ויתר על בחירת הרקע,
    // הכרטיסים חייבים להראות את מה שבאמת נשמר
    profileState.pageBg = saved.page_bg === 'flow' || saved.page_bg === 'plain' ? saved.page_bg : '';
    renderProfileBgChoice();
    renderHeaderAvatar(currentAgent);
    document.getElementById('agentName').textContent = saved.display_name || '';
    accSetCount('accProfile', profileComplete(currentAgent) ? '' : 'להשלמה');
    renderProfileImages();
    renderProfilePreview();

    feedback.style.color = 'var(--green)';
    feedback.textContent = saved.license_number === license
      ? 'הפרטים נשמרו - דף הסוכן/ת שלך מעודכן.'
      : 'הפרטים נשמרו, אך מספר הרישיון לא עודכן - פנו להנהלת הפלטפורמה.';
    showToast('פרטי הסוכן/ת עודכנו');
    // צעד התמונות במדריך ההתחלה עשוי להיסגר בשמירה הזו
    refreshOnboarding();
  } catch(err){
    console.error('profile save failed', err);
    feedback.style.color = 'var(--wine)';
    feedback.textContent = 'שמירה נכשלה: ' + (err.message || 'שגיאה לא צפויה');
  } finally{
    btn.disabled = false; btn.textContent = 'שמירת הפרטים';
  }
});

/* ==========================================================================
   הקוד האתי ותו האיכות
   --------------------------------------------------------------------------
   האישור נשמר ב-agency_members (ולמנהל/ת משרד גם ב-agencies), והוא התנאי
   היחיד להצגת התו בדפים הציבוריים: ה-view agency_members_public מחשב
   ‏has_ethics_badge = accepted_at is not null and revoked_at is null‏.

   שלוש נקודות שהמסד אוכף ולא הדפדפן, ולכן אין כאן ניסיון לעקוף אותן:
     • החותמת נקבעת ב-now() בטריגר — התאריך שנשלח מכאן הוא רק סימון "אשר".
     • רק הסוכן/ת עצמו/ה יכול/ה לאשר; מנהל/ת לא חותמ/ת במקום סוכן/ת.
     • הסרת תו (revoked_at) שמורה להנהלת הפלטפורמה — כאן היא רק מוצגת.
   ========================================================================== */
const ETHICS_CODE_VERSION = '2026-08';

const ETHICS_CLAUSES = [
  'רישוי והסמכה כחוק - רישיון תיווך מקרקעין בתוקף מטעם משרד המשפטים.',
  'נאמנות ושקיפות מלאה ללקוח - תמונת מצב אובייקטיבית, בלי הסתרת מידע מהותי.',
  'שיתופי פעולה פתוחים (Co-Broke) - נכסים בבלעדיות נפתחים לכלל הקהילה המקצועית.',
  'אימוץ טכנולוגיה וחדשנות - כלי AI ואוטומציה לניתוח, תמחור ושיווק.',
  'אמינות ודיוק בפרסום - בלי מודעות פיתיון ובלי נכס ללא הרשאה בכתב.',
  'ייצוג הוגן ומניעת ניגוד עניינים - גילוי נאות מראש בייצוג שני הצדדים.',
  'סודיות והגנת מידע - שמירה על פרטיות הלקוח ועל נתוניו העסקיים.',
  'שכר טרחה ברור ומראש - הסכם בכתב, בלי אותיות קטנות וחיובים נסתרים.',
  'מקצועיות ולמידה מתמדת - עדכון שוטף בחקיקה, במגמות ובכלים חדשים.',
  'תרבות של גישור וכבוד הדדי - משא ומתן מגשר וקידום עסקאות Win-Win.',
];

/* ============================================================================
   המסלול: תגית, רצועה ושער הבחירה
   ----------------------------------------------------------------------------
   שלושת אלה קוראים את אותם שדות מ-currentAgent ומאותו קטלוג (assets/tiers.js),
   ולכן הם תמיד מספרים את אותו סיפור: מה יש עכשיו, עד מתי, ומה הצעד הבא.

   ‏**המסלול עצמו לעולם לא נכתב מכאן.** ‏tier ושדות ההטבה נעולים בטריגר
   ‎protect_sensitive_agency_member_fields‎ מול הדפדפן — כל בחירה עוברת ב-
   ‎join-agency‎ עם ה-JWT, ושם גם נאכפת נעילת תקופת ההשקה. שורת update מה-
   console לא תשנה מסלול, וזו בדיוק הכוונה.
   ========================================================================== */

/** מצב ההטבה של השורה שבידינו, בפורמט אחד לכל הצרכנים. */
function promoOf(agent){
  return (window.Tiers ? Tiers.promoState(agent || {}) : { active:false, ended:false, daysLeft:null, endsAt:null, tier:null });
}

/** הכתובת לדף המסלולים עם ההקשר של הסוכן/ת — כדי שהכרטיס הנכון יסומן שם. */
function pricingUrl(agent){
  const params = new URLSearchParams({ from: 'crm' });
  if (agent?.tier) params.set('current', agent.tier);
  if (agent?.promo_ends_at && !agent?.promo_ended_at) params.set('promo_ends', agent.promo_ends_at);
  return 'pricing.html?' + params.toString();
}

/* ---------------------------------------------------------------------------
 * מדיניות התוכן הציבורי — האזהרה בטופס
 *
 * שני כללים, ורק אחד מהם תלוי במסלול:
 *
 *   • **קישור לדף חיצוני אסור בכל המסלולים**, ובכל התיאורים — נכס, משרד
 *     ומתווך/ת.
 *   • **מספר טלפון בתיאור אסור ב-Pay&GO בלבד.** ‏PROFESSIONAL ו-Elite
 *     משלמים על הערוץ הזה ורשאים.
 *
 * האכיפה עצמה יושבת בטריגר במסד (`20261120090000_public_text_policy.sql`)
 * ולא כאן: התיאור נכתב גם מהעוזר בוואטסאפ וגם מ-`property-description`,
 * ובדיקה בדפדפן הייתה מכסה מקור אחד מתוך שלושה. **ההודעה הזו היא הסבר
 * מראש, לא שער** — מי שיכתוב בכל זאת, הטקסט יישמר נקי ותצא התראה.
 *
 * ‏**התמונות מופיעות כאן ורק כאן.** אין אכיפה על מספר שצרוב בתוך תצלום —
 * זה היה דורש קריאת ראייה לכל תמונה — ולכן האזהרה היא כל מה שיש.
 *
 * ובכוונה **לא** ב-`pricing.html`: עמוד המחירים מוכר מסלול, והוא לא המקום
 * שבו לומדים מה אסור לכתוב.
 * ------------------------------------------------------------------------- */
function renderTextPolicyHint(agent){
  const el = document.getElementById('npTextPolicyHint');
  if (!el) return;

  const payGo = agent?.tier === 'free';
  const parts = ['אין לכלול בתיאור קישורים לדפים חיצוניים, לרבות פרופילי פייסבוק ואינסטגרם.'];
  if (payGo){
    parts.push('<strong>במסלול Pay&amp;GO אסור להעלות מספרי טלפון בתיאור או בתמונות.</strong> ' +
               'הפונים מגיעים דרך כפתורי הקשר בדף הנכס.');
  }
  parts.push('מה שייכתב בכל זאת יוסר אוטומטית בשמירה, ותישלח על כך התראה.');

  el.innerHTML = parts.join(' ');
  el.hidden = false;
}

function renderTierBadge(agent){
  renderTextPolicyHint(agent);
  const badge = document.getElementById('tierBadge');
  if (!badge) return;
  // המילה "מסלול" יורדת במסך צר (ראו .tier-word ב-CSS) — שם אין מקום גם לה
  // וגם ללוגו שבמרכז הכותרת, ושם המסלול לבדו נושא את כל המידע
  const name = window.Tiers ? Tiers.label(agent.tier) : agent.tier;
  badge.innerHTML = '<span class="tier-word">מסלול </span>' + esc(name);
  badge.className = 'tier-badge tier-' + agent.tier;
  badge.href = pricingUrl(agent);
  const promo = promoOf(agent);
  badge.title = promo.active
    ? `מסלול ${name} · הטבת ההשקה פעילה עד ${Tiers.formatDate(promo.endsAt)}`
    : `המסלול שלי (${name}) ואפשרויות השדרוג`;
}

function renderPromoStrip(agent){
  const strip = document.getElementById('promoStrip');
  if (!strip) return;
  const promo = promoOf(agent);

  // בקשת שדרוג פתוחה קודמת להטבה: מי שביקש/ה מסלול וקיבל/ה "ניצור קשר"
  // צריך/ה לראות שהבקשה עדיין קיימת. בלי זה הבקשה נעלמת מהמסך ברגע שהמסך
  // נסגר, והשאלה "מה קרה עם זה?" מגיעה בטלפון.
  if (agent.pending_tier_change){
    strip.classList.remove('is-urgent');
    strip.href = pricingUrl(agent);
    document.getElementById('promoStripTitle').textContent =
      'בקשת המעבר ל-' + Tiers.label(agent.pending_tier_change) + ' נקלטה';
    document.getElementById('promoStripSub').textContent =
      'ניצור קשר להסדרת התשלום, והמסלול יופעל מיד אחריה. עד אז לא חל שינוי.';
    strip.hidden = false;
    return;
  }

  if (!promo.active){ strip.hidden = true; return; }

  const urgent = promo.daysLeft <= 30;
  strip.classList.toggle('is-urgent', urgent);
  strip.href = pricingUrl(agent);
  document.getElementById('promoStripTitle').textContent = urgent
    ? `הטבת ההשקה מסתיימת בעוד ${plural(promo.daysLeft, 'יום אחד', 'ימים')}`
    : `${Tiers.label(promo.tier)} במתנה - עד ${Tiers.formatDate(promo.endsAt)}`;
  document.getElementById('promoStripSub').textContent = urgent
    ? 'אחרי התאריך הזה מי שלא בחר/ה מסלול ממשיך/ה ב-Pay&GO. לבחירת המסלול ←'
    : 'כל היכולות פתוחות, בלי תשלום. לפירוט המסלולים ←';
  strip.hidden = false;
}

/* ==========================================================================
   מדריך ההתחלה
   --------------------------------------------------------------------------
   סוכן/ת חדש/ה במסלול PROFESSIONAL ומעלה נוחת/ת על דשבורד מלא ביכולות שכולן
   מחכות שיחפשו אותן. ששת הצעדים כאן הם הסדר שבו הן מתחילות לעבוד, והוא
   השרשרת העסקית עצמה — מלאי, התחייבות, ומאיפה מגיע הלקוח/ה הבא/ה:

     1. העוזר בוואטסאפ — משם נפתחים נכסים ולקוחות מהטלפון
     2. תמונת פרופיל ותמונת נושא (ולמנהל/ת משרד — גם לוגו ותמונת נושא למשרד)
     3. הנכס הראשון
     4. הלקוח/ה הראשון/ה
     5. ההסכם הראשון
     6. הליד הראשון מחנות הלידים

   **המצב אינו נשמר כאן ואינו נשמר כצ׳קליסט.** ‏agent_onboarding_state()
   מחשבת אותו במסד מהמציאות בכל קריאה — יש שיחה בוואטסאפ? יש photo_url? יש
   נכס? — ולכן צעד שנסגר מחוץ לדשבורד נסגר גם בכרטיס. זה לא ניואנס: הצעד
   הראשון הוא בדיוק הכלי שבו נפתח לא פעם הנכס הראשון, וכרטיס שמסמן "בוצע"
   רק על מה שנעשה בטופס היה מדווח שקר לכל מי שעשה/תה בדיוק מה שביקשנו.

   ארבעת הצעדים האחרונים מקבלים גם דרבון בפעמון (‏onboarding_property,
   ‏onboarding_client, ‏onboarding_agreement, ‏onboarding_lead) — טריגרים
   במסד, שכל אחד מהם נולד ברגע שהצעד שלפניו נסגר. הכרטיס הוא ההכוונה;
   ההתראה היא מה שמגיע גם למי שסגר/ה את הדשבורד.

   ראו docs/agent-onboarding.md.
   ========================================================================== */

/* ‏done נקרא מהשורה שהמסד החזיר, ולא מחושב כאן שוב: תנאי משוכפל בין שרת
   לדפדפן מתפצל, ואז ההתראה יוצאת בזמן שהכרטיס עוד מציג את הצעד כפתוח. */
const ONBOARD_STEPS = [
  { key:'whatsapp', name:'חיבור העוזר האישי בוואטסאפ',
    text:'שומרים את מספר הוואטסאפ שלכם ושולחים לעוזר הודעה ראשונה. משם אפשר להעלות נכס, לשלוח תמונות של דירה או להקליט הודעה - בלי לפתוח את המחשב.',
    cta:'לחיבור העוזר',
    done: s => s.whatsapp_done,
    run:  ()=> gotoSection('accWhatsapp', 'waPhone') },
  { key:'profile', name:'תמונת פרופיל ותמונת נושא',
    text:'זה מה שלקוח/ה רואה בדף הסוכן/ת שלכם ובכל נכס שתפרסמו. דף בלי תמונות נראה כמו כרטיס שלא הושלם.',
    cta:'לעדכון הפרופיל',
    done: s => s.profile_done,
    run:  ()=> gotoSection('accProfile') },
  /* צעד של מנהל/ת משרד בלבד — לסוכן/ת בצוות אין דף משרד לערוך, ושורה
     שאי אפשר לסגור אותה היא מדריך שלא נגמר לעולם. */
  { key:'agency', name:'לוגו ותמונת נושא לדף המשרד',
    text:'דף המשרד הוא הכותרת שמעל כל הצוות שלכם. הלוגו ותמונת הנושא נכנסים אליו ולכל דפי הסוכנים שתחתיו.',
    cta:'לעיצוב דף המשרד',
    when: s => s.is_manager,
    done: s => s.agency_done,
    run:  ()=> gotoSection('accBranding') },
  { key:'property', name:'הנכס הראשון',
    text:'מודעה אחת פותחת את כל השאר: היא נכנסת למדפים באתר, מוצלבת מול קובץ הלקוחות, ומזינה את המדדים במסך הזה.',
    cta:'הוספת נכס',
    done: s => s.property_done,
    run:  ()=> openInlineForm('accProperties', 'addPropertyForm', 'toggleAddProperty') },
  { key:'client', name:'הלקוח/ה הראשון/ה בקובץ',
    text:'קובץ הלקוחות הוא מה שמפעיל את ההתאמות: כל נכס חדש שנכנס - שלכם או של משרד שותף - נבדק מולו אוטומטית.',
    cta:'הוספת לקוח/ה',
    done: s => s.client_done,
    run:  ()=> openInlineForm('accClients', 'addClientForm', 'toggleAddClient') },
  /* אשף ההחתמה ולא ניווט לקטגוריה: הסכם נוצר בתוכו, והוא ממלא את עצמו
     מהנכס ומהלקוח/ה שכבר במערכת — כלומר משני הצעדים שמעליו. */
  { key:'agreement', name:'ההסכם הראשון',
    text:'הזמנת שירותי תיווך היא מה שהופך נכס ולקוח/ה לעמלה. האשף ממלא את המסמך מהפרטים שכבר במערכת, ושולח לחתימה בקישור.',
    cta:'יצירת הסכם',
    done: s => s.agreement_done,
    run:  ()=> openAgreementWizard() },
  { key:'lead', name:'הליד הראשון מחנות הלידים',
    text:'מאיפה מגיע הלקוח/ה הבא/ה: לידי בעל-נכס, מחפשי דירה ולידי משכנתא לפי אזורי הפעילות שלך. במסלול שלך רובם כלולים במנוי.',
    cta:'לחנות הלידים',
    done: s => s.lead_done,
    run:  ()=> gotoSection('accLeadShelf') },
];

/* השורה שהמסד החזיר, או null כשאין מדריך. משמש גם את NOTIF_TYPES: תיבות
   הסימון של ארבע התראות הדרבון מוצגות ב"ניהול התראות" רק כל עוד המדריך חי. */
let onboardState = null;
let onboardLastLoad = 0;

function onboardingLive(){ return !!onboardState; }

async function loadOnboarding(){
  const box = document.getElementById('onbGuide');
  if (!box) return;
  onboardLastLoad = Date.now();
  try{
    const { data, error } = await sb.rpc('agent_onboarding_state');
    if (error) throw error;
    onboardState = (Array.isArray(data) ? data[0] : data) || null;
    renderOnboarding();
  } catch(err){
    // ‏Netlify מפרסם את ה-HTML תוך שניות, והמיגרציה רצה ב-Actions — יש חלון
    // של דקות שבו הפונקציה עוד לא קיימת. הכרטיס פשוט לא מוצג, כמו שאר
    // היכולות שנשענות על מיגרציה טרייה (ראו loadDashboard).
    console.warn('מדריך ההתחלה אינו זמין:', err);
    onboardState = null;
    box.hidden = true;
  }
}

/* מה שנקרא אחרי שמירה שעשויה לסגור צעד. שתי קריאות ולא אחת: הדרבון על הצעד
   הבא נולד בטריגר במסד **באותה שמירה**, והפעמון נטען בכניסה לדשבורד בלבד —
   בלי הרענון כאן ההתראה שמעודדת את הצעד הבא הייתה מופיעה רק בטעינה הבאה,
   כלומר בדיוק לא ברגע שבו היא רלוונטית. שתיהן קורות רק בזמן המדריך. */
function refreshOnboarding(){
  if (!onboardingLive()) return;
  loadOnboarding();
  if (currentAgent) loadNotifications(currentAgent.id);
}

function renderOnboarding(){
  const box = document.getElementById('onbGuide');
  if (!box) return;
  const state = onboardState;
  if (!state){ box.hidden = true; return; }

  const steps = ONBOARD_STEPS.filter(s => !s.when || s.when(state));
  const doneCount = steps.filter(s => s.done(state)).length;
  const list = document.getElementById('onbList');
  const sub  = document.getElementById('onbSub');
  const prog = document.getElementById('onbProgress');

  // ‏just_finished מגיע מהקריאה שסגרה את המדריך, והיא היחידה — בקריאה הבאה
  // הפונקציה כבר מחזירה אפס שורות. זה בדיוק אורך החיים הנכון של "סיימת".
  if (state.just_finished){
    document.getElementById('onbTitle').textContent = 'סיימת את מדריך ההתחלה';
    prog.textContent = '✓';
    sub.textContent = 'העוזר מחובר, הפרופיל מוצג, יש נכס, יש לקוח/ה, נוצר הסכם ונרכש ליד. מכאן זה המסך הרגיל שלך - והמדריך לא יחזור.';
    list.innerHTML = '';
    box.hidden = false;
    return;
  }

  document.getElementById('onbTitle').textContent = 'מדריך ההתחלה';
  prog.textContent = doneCount + ' מתוך ' + steps.length;
  // מספר הצעדים נגזר מהרשימה ולא נכתב במילים: למנהל/ת משרד יש צעד נוסף
  // (דף המשרד), וטקסט שאומר "ארבעה" מול חמש שורות הוא טקסט שלא נקרא שוב
  // אחרי שנכתב.
  sub.textContent = doneCount
    ? 'נשאר לסגור את מה שמסומן למטה. אפשר בכל סדר.'
    : steps.length + ' צעדים קצרים שהופכים את החשבון החדש למשרד עובד.';

  // הצעד הפתוח הראשון הוא היחיד שמקבל כפתור: מדריך שכל שורה בו מציעה פעולה
  // הוא רשימה, ורשימה לא אומרת במה מתחילים.
  const nextKey = (steps.find(s => !s.done(state)) || {}).key;

  list.innerHTML = '';
  steps.forEach((step, i)=>{
    const isDone = step.done(state);
    const isNow  = step.key === nextKey;
    const li = document.createElement('li');
    li.className = 'onb-step' + (isDone ? ' is-done' : isNow ? ' is-now' : '');
    li.innerHTML =
      '<span class="onb-mark" aria-hidden="true">' + (isDone ? '✓' : String(i + 1)) + '</span>'
      + '<div class="onb-body">'
      +   '<div class="onb-name">' + esc(step.name) + '</div>'
      +   (isDone ? '' : '<p class="onb-text">' + esc(step.text) + '</p>')
      + '</div>';
    if (isNow){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'onb-go';
      btn.textContent = step.cta;
      btn.addEventListener('click', ()=> step.run());
      li.querySelector('.onb-body').appendChild(btn);
    }
    list.appendChild(li);
  });
  box.hidden = false;
}

/* הסתרה היא בקשה להפסיק, ולא רק להעלים כרטיס: אותה חותמת במסד סוגרת גם את
   ארבע התראות הדרבון. לכן היא נאמרת במפורש בשאלה. */
document.getElementById('onbDismiss').addEventListener('click', async ()=>{
  if (!confirm('להסתיר את מדריך ההתחלה? גם ההתראות שמזכירות את הצעדים הבאים ייפסקו.')) return;
  try{
    const { error } = await sb.rpc('agent_onboarding_dismiss');
    if (error) throw error;
  } catch(err){
    console.warn('הסתרת מדריך ההתחלה נכשלה:', err);
  }
  onboardState = null;
  document.getElementById('onbGuide').hidden = true;
});

/* הצעד הראשון נסגר **מחוץ לדף הזה** — בשיחה בוואטסאפ — ולכן החזרה ללשונית
   היא הרגע שבו כדאי לשאול שוב. החניקה ל-15 שניות היא כדי שמעבר בין
   לשוניות לא יהפוך לקריאה בכל החלפה. */
document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState !== 'visible') return;
  if (!onboardingLive() || !currentAgent) return;
  if (Date.now() - onboardLastLoad < 15000) return;
  loadOnboarding();
});

/* ---------- שער הבחירה ----------
   מוצג בשני רגעים, ורק בהם: בכניסה הראשונה (המסלול הגיע מההטבה ואיש לא
   אישר אותו), וביום שההטבה נגמרה (‏tier_source = 'promo_expired' — השרת כבר
   העביר ל-Pay&GO, וזו ההזדמנות לבחור אחרת).

   מי שבחר/ה בעצמו/ה — ‎tier_source = 'self'‎ — לא רואה אותו יותר, וגם לא
   סוכן/ת ותיק/ה מלפני המיגרציה: אצלו/ה ‎tier_source‎ ריק אבל אין הטבה, ואין
   סיבה לעצור אותו/ה בדרך לדשבורד. */
function tierNeedsGate(agent){
  if (!agent || !window.Tiers) return false;
  // בקשת שדרוג פתוחה = הבחירה כבר נעשתה וממתינה להסדרת תשלום. להציג שוב את
  // אותו מסך היה נראה כאילו הבקשה לא נקלטה, וזו הזמנה לשלוח אותה שוב.
  if (agent.pending_tier_change) return false;
  if (agent.tier_source === 'promo_expired') return true;
  return !agent.tier_selected_at && agent.tier_source === 'launch_promo';
}

/* אישור ההטבה בלי מסך.

   זו אותה קריאה בדיוק שהכפתור "מתחילים" הפעיל — `set_tier` עם מסלול
   ההטבה — ולכן היא נרשמת זהה: ‏`tier_selected_at` נחתם, המקור נשאר
   `launch_promo_accepted`, ובתום התקופה `expire_launch_promos` מוריד/ה
   בדיוק את המקור הזה ל-Pay&GO. מה שהשתנה הוא רק שאיש לא נדרש ללחוץ על
   האפשרות היחידה שהייתה על המסך.

   **כישלון כאן אינו עוצר את הכניסה.** המסלול כבר premium מרגע ההענקה
   בשרת; מה שלא נכתב הוא החותמת שאומרת "נראה ואושר", והתוצאה הגרועה
   ביותר היא שהיא תיכתב בכניסה הבאה. לחסום דשבורד בגלל חותמת היה הופך
   תקלת רשת רגעית למסך שגיאה בכניסה הראשונה של סוכן/ת חדש/ה. */
async function acceptPromoSilently(agent, promo){
  try{
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const res = await fetch(SUPABASE_URL + '/functions/v1/join-agency', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ action:'set_tier', tier: promo.tier || Tiers.PROMO.tier }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.status === 'applied'){
      agent.tier_selected_at = new Date().toISOString();
      agent.tier_source = 'launch_promo_accepted';
    }
  } catch(err){
    console.warn('אישור ההטבה בשקט נכשל - יינתן ניסיון נוסף בכניסה הבאה:', err);
  }
}

function showTierGate(){
  renderTierGate();
  document.getElementById('tgFeedback').textContent = '';
  showScreen('tierGate');
}

function renderTierGate(){
  const agent = currentAgent || {};
  const promo = promoOf(agent);
  const box = document.getElementById('tgPlans');
  const title = document.getElementById('tgTitle');
  const sub = document.getElementById('tgSubtitle');
  document.getElementById('tgCompare').href = pricingUrl(agent);

  if (promo.active){
    const gift = Tiers.byId(promo.tier || Tiers.PROMO.tier);
    title.textContent = 'קיבלת ' + gift.name + ' במתנה';
    sub.textContent = `${Tiers.PROMO.months} חודשים של המסלול המלא, ללא תשלום - עד ${Tiers.formatDate(promo.endsAt)}. ` +
                      'בתום התקופה תוכל/י לבחור מסלול, ומי שלא בוחר/ת ממשיך/ה ב-Pay&GO.';
  } else if (agent.tier_source === 'promo_expired'){
    title.textContent = 'תקופת ההטבה הסתיימה';
    sub.textContent = 'החשבון עבר ל-Pay&GO - בלי דמי מנוי, עם 10 לידי קונה/שוכר בחודש. ' +
                      'הנכסים, הלידים והלקוחות נשארו במקומם. אפשר להישאר כך, או לשדרג.';
  } else {
    title.textContent = 'בחירת מסלול';
    sub.textContent = 'אפשר לעבור בין המסלולים בכל חודש. מה שנבחר כאן הוא נקודת הפתיחה.';
  }

  box.textContent = '';
  // בתקופת ההטבה המסלול שניתן במתנה עולה לראש: הוא הכרטיס היחיד שאפשר
  // ללחוץ עליו, וכרטיס פעיל שיושב אחרי שניים אפורים נראה כמו הערת שוליים.
  const order = Tiers.list();
  if (promo.active){
    const giftId = promo.tier || Tiers.PROMO.tier;
    order.sort((a, b) => (b.id === giftId) - (a.id === giftId));
  }
  order.forEach(tier => {
    const isGift = promo.active && tier.id === (promo.tier || Tiers.PROMO.tier);
    const locked = promo.active && !isGift;      // בתקופת ההשקה אין ירידה מ-Elite
    const isCurrent = !promo.active && tier.id === agent.tier;

    const card = document.createElement('div');
    card.className = 'tg-plan' + (isGift ? ' is-hero' : '') + (locked ? ' is-locked' : '');

    // שלושה יתרונות ולא שבעה: זה מסך החלטה, לא דף מכירה. הפירוט המלא
    // נמצא בקישור להשוואה שמתחת לכרטיסים.
    const feats = tier.features.filter(f => f.on).slice(0, 3)
      .map(f => '<li>' + esc(f.text) + '</li>').join('');

    card.innerHTML =
      (isGift ? '<span class="tg-gift">מתנת ההצטרפות · ' + Tiers.PROMO.months + ' חודשים</span>' : '') +
      '<div class="tg-head"><span class="tg-name">' + esc(tier.name) + '</span>' +
      '<span class="tg-price">' + esc(isGift ? 'ללא תשלום' : Tiers.priceText(tier.id)) +
      (tier.vat && !isGift ? ' + מע״מ' : '') + '</span></div>' +
      '<div class="tg-line">' + esc(tier.pitch) + '</div>' +
      '<ul class="tg-feats">' + feats + '</ul>';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-block ' + (isGift || (!promo.active && !isCurrent && tier.id !== 'free') ? 'btn-gold' : 'btn-ghost');
    btn.textContent = locked ? 'ייפתח בתום ההטבה'
      : isGift ? 'מתחילים'
      : isCurrent ? 'המסלול הנוכחי שלי - להמשיך'
      : 'בחירה ב-' + tier.name;
    btn.disabled = locked;
    btn.addEventListener('click', () => chooseTier(tier.id, btn));
    card.appendChild(btn);
    box.appendChild(card);
  });

  if (promo.active){
    const note = document.createElement('p');
    note.className = 'tg-locked-note';
    note.textContent = 'בתקופת ההשקה כל הסוכנים נמצאים ב-' +
      Tiers.label(promo.tier || Tiers.PROMO.tier) + '. בחירה בין מסלולים תיפתח בתום התקופה.';
    box.appendChild(note);
  }
}

/* בחירת מסלול — הקריאה היחידה שמשנה מסלול בכל ה-CRM.
   שלוש תשובות מהשרת, וכל אחת מסך אחר: applied נכנס לדשבורד, requested
   מציג שהבקשה נקלטה (מסלול בתשלום אינו מופעל בלחיצה — הוא נסגר מול
   ההנהלה), ו-promo_locked הוא ניסיון לעקוף את נעילת ההשקה. */
async function chooseTier(tierId, btn){
  const feedback = document.getElementById('tgFeedback');
  const original = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = 'רגע…'; }
  feedback.style.color = 'var(--ink-soft)';
  feedback.textContent = '';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/join-agency', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ action: 'set_tier', tier: tierId }),
    });
    const data = await res.json().catch(() => ({}));

    if (data.status === 'promo_locked'){
      feedback.style.color = 'var(--red)';
      feedback.textContent = data.detail || 'בתקופת ההשקה אי אפשר לשנות מסלול.';
      return;
    }
    if (!res.ok || data.error){
      feedback.style.color = 'var(--red)';
      feedback.textContent = 'שגיאה: ' + (data.detail || data.error || res.status);
      return;
    }

    if (data.status === 'requested'){
      // המסלול לא השתנה, ולכן גם המסך לא מתיימר לומר שהוא כן.
      feedback.style.color = 'var(--ink)';
      feedback.textContent = data.detail || 'הבקשה נקלטה. ניצור קשר להסדרת התשלום.';
      // מסמנים שהבקשה פתוחה, כדי שהמסך לא יחזור עד שהיא תטופל
      if (currentAgent) currentAgent.pending_tier_change = tierId;
      setTimeout(()=>{ showBootCard('טוענים את איזור הסוכנים…'); loadDashboard(); }, 2600);
      return;
    }

    showBootCard('טוענים את איזור הסוכנים…');
    await loadDashboard();
    if (window.Tiers) showToast('המסלול שלך: ' + Tiers.label(data.tier || tierId));
  } catch(err){
    console.error('set_tier failed', err);
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
  } finally{
    if (btn){ btn.disabled = false; btn.textContent = original; }
  }
}

document.getElementById('tgLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  location.reload();
});

/* חזרה מדף המסלולים עם בחירה (‏crm.html?tier=mid). הבחירה נשמרה כבר בטעינת
   הדף (‏readPendingTier), וכאן היא נצרכת פעם אחת ונמחקת — רענון של הדף אחרי
   הבחירה לא אמור לשלוח אותה שוב. ערך שאינו מסלול מוכר נזרק בשקט: הוא יכול
   להגיע רק מכתובת שנערכה ביד. */
function consumePendingTier(){
  const raw = readPendingTier();
  clearPendingTier();
  if (!raw || !window.Tiers || !Tiers.byId(raw)) return null;
  return raw;
}

let ethicsAgency = null;   // שורת המשרד, נטענת רק למנהל/ת משרד

/* ---------- שער האישור בכניסה הראשונה ----------
   מוצג לסוכן/ת שטרם אישר/ה — בפועל רק למי שמנהל/ת המשרד הוסיף/ה, כי שני
   מסלולי פתיחת המשרד חותמים בעצמם והוותיקים נחתמו ב-grandfathering.
   מי שהתו שלו/ה הוסר אינו/ה נעצר/ת כאן: ההסרה היא החלטה של ההנהלה, לא
   סיבה לחסום גישה למערכת. */
function ethicsNeedsGate(agent){
  return !!agent && !agent.ethics_code_accepted_at && !agent.ethics_badge_revoked_at;
}

/* ---------- מסך הפתיחה: מה שהסוכן/ת מוסר/ת, פעם אחת ----------
   עד היום היו כאן שני מסכים נפרדים אחרי ההתחברות — אישור הקוד האתי, ואז
   שער בחירת המסלול — ולפניהם, בטופס של מנהל/ת המשרד, מספר רישיון שהוקלד
   עבור מישהו אחר. עכשיו זה מסך אחד: השם (אם חסר), מספר הרישיון, הקוד האתי,
   ולחיצה אחת שעושה את שלושתם.

   ‏gateMode מחזיק את מה שהמסך צריך לדעת כשהוא נפתח **לפני** שיש כרטיס
   מחובר: במצב הזה `currentAgent` עדיין ריק, כי השיוך עצמו מחכה למספר
   הרישיון. */
let gateMode = { needsLicense:false, needsName:false, agencyName:'', displayName:'' };

function showEthicsGate(mode = {}){
  gateMode = { needsLicense:false, needsName:false, agencyName:'', displayName:'', ...mode };

  const list = document.getElementById('gateClauses');
  if (!list.children.length){
    ETHICS_CLAUSES.forEach(text=>{
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }

  document.getElementById('gateProfile').style.display = gateMode.needsLicense ? 'block' : 'none';
  document.getElementById('gateNameField').style.display = gateMode.needsName ? 'block' : 'none';
  document.getElementById('gateSub').textContent = gateMode.needsLicense
    ? (gateMode.agencyName ? 'ההזמנה למשרד ' + gateMode.agencyName + ' ממתינה לך. ' : '') +
      'נותרו מספר הרישיון ואישור הקוד האתי - וזהו, אפשר להתחיל לעבוד.'
    : 'לפני הכניסה - אישור הקוד האתי של הפלטפורמה. זהו התנאי להצגת תו האיכות בדף שלך ובמודעות הנכסים, והוא נחתם אישית על ידך בלבד.';

  document.getElementById('gateConsent').checked = false;
  document.getElementById('gateFeedback').textContent = '';
  showScreen('ethicsGate');
}

/* החתימה על הקוד האתי, מול מזהה כרטיס מפורש.
   במסלול ההזמנה הכרטיס נקשר לחשבון רק שורה אחת קודם לכן, ולכן `currentAgent`
   עדיין אינו מלא — המזהה מגיע מבחוץ ולא ממנו. */
async function acceptEthicsFor(memberId){
  const { data: saved, error } = await sb.from('agency_members').update({
    ethics_code_accepted_at: new Date().toISOString(),
    ethics_code_version: ETHICS_CODE_VERSION,
    updated_at: new Date().toISOString(),
  }).eq('id', memberId)
    .select('ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at')
    .single();
  if (error) throw error;
  // בלי אימות שהחותמת באמת נכתבה, כישלון שקט של הטריגר היה מכניס למערכת
  // סוכן/ת בלי אישור — בדיוק מה שהשער נועד למנוע
  if (!saved?.ethics_code_accepted_at) throw new Error('האישור לא נשמר');
  return saved;
}

const GATE_LICENSE_ERRORS = {
  invalid_license: 'מספר הרישיון אינו תקין - ספרות בלבד, בין 3 ל-8.',
  license_in_use:  'מספר הרישיון הזה כבר רשום אצל סוכן/ת אחר/ת במערכת. אם זה שלך - פנו אלינו.',
};

document.getElementById('gateAcceptBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('gateAcceptBtn');
  const feedback = document.getElementById('gateFeedback');
  const fail = (text)=>{ feedback.style.color = 'var(--red)'; feedback.textContent = text; };

  const license = document.getElementById('gateLicense').value.trim();
  const name = document.getElementById('gateName').value.trim();

  // הסדר כאן הוא סדר התיקון: קודם מה שהוקלד, ורק אחר כך תיבת האישור. מי
  // ששכח/ה שדה לא אמור/ה לגלות זאת אחרי שסימן/ה את הקוד האתי.
  if (gateMode.needsLicense && !license) return fail('יש להזין את מספר רישיון התיווך.');
  if (gateMode.needsName && !name) return fail('יש להזין שם מלא.');
  if (!document.getElementById('gateConsent').checked){
    return fail('יש לסמן את תיבת האישור כדי להמשיך.');
  }

  btn.disabled = true; btn.textContent = 'שומר…';
  feedback.style.color = 'var(--ink-soft)'; feedback.textContent = '';
  try{
    let memberId = currentAgent?.id || null;

    if (gateMode.needsLicense){
      // השיחה השנייה עם join-agency: אותה פעולת `resolve`, הפעם עם המספר.
      // היא מאמתת מול רשם המתווכים, כותבת את המספר על הכרטיס, ורק אז
      // משייכת אותו לחשבון.
      const { data } = await callJoinAgency({
        action: 'resolve',
        token: readInviteToken(),
        license_number: license,
        display_name: name || undefined,
      });

      // רישיון שלא אומת — אותו מודאל ערעור של כל שאר המסלולים, והפעם הוא
      // נפתח מול מי שהתעודה בידיו/ה. זו כל הסיבה שהשדה כאן ולא בטופס של
      // מנהל/ת המשרד.
      if (data.error === 'license_not_verified'){
        const { data: { user } } = await sb.auth.getUser();
        openLicenseAppeal({
          license: data.license_number || license,
          detail:  data.detail,
          // השם שעל הכרטיס כשהוא כבר קיים — טופס הערעור דורש אותו, ואין
          // סיבה לבקש שוב ממי שמנהל/ת המשרד כבר מילא/ה עבורו/ה.
          name:    name || gateMode.displayName || '',
          email:   user?.email || '',
          source:  'join-agency',
        });
        return;
      }
      if (GATE_LICENSE_ERRORS[data.error]) return fail(GATE_LICENSE_ERRORS[data.error]);
      if (data.status === 'invite_invalid'){
        return fail(INVITE_INVALID_TEXT[data.reason] || INVITE_INVALID_TEXT.not_found);
      }
      if (data.status !== 'joined' && data.status !== 'member'){
        return fail('החיבור לכרטיס לא הצליח: ' + (data.detail || data.error || 'שגיאה לא צפויה'));
      }

      clearInviteToken();
      // השורה קיימת עכשיו, והמזהה שלה הוא מה שחסר כדי לחתום עליה.
      const { data: { user } } = await sb.auth.getUser();
      const { data: row } = await sb.from('agency_members')
        .select('id').eq('user_id', user.id).maybeSingle();
      if (!row) throw new Error('הכרטיס חובר, אבל טעינת הפרטים נכשלה. נסו לרענן.');
      memberId = row.id;
    }

    if (!memberId) throw new Error('שגיאה לא צפויה - נסו לרענן את הדף.');
    const saved = await acceptEthicsFor(memberId);
    if (currentAgent) Object.assign(currentAgent, saved);

    showBootCard('טוענים את איזור הסוכנים…');
    await loadDashboard();
  } catch(err){
    // המסך נשאר כמו שהוא — עם מה שהוקלד בו. ‏showEthicsGate מחדש כאן היה
    // מנקה את תיבת האישור ומכריח לסמן שוב אחרי תקלת רשת.
    console.error('ethics gate accept failed', err);
    fail('שמירה נכשלה: ' + (err.message || 'שגיאה לא צפויה'));
  } finally{
    btn.disabled = false; btn.textContent = 'אישור הקוד וכניסה למערכת';
  }
});

document.getElementById('gateLogoutBtn').addEventListener('click', async ()=>{
  await sb.auth.signOut();
  location.reload();
});

function ethicsBadgeActive(row){
  return !!(row && row.ethics_code_accepted_at && !row.ethics_badge_revoked_at);
}

function ethicsDateLabel(iso){
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { year:'numeric', month:'long', day:'numeric' });
}

function renderEthicsState(agent){
  const box = document.getElementById('ethicsState');
  const title = document.getElementById('ethicsStateTitle');
  const note = document.getElementById('ethicsStateNote');
  const pill = document.getElementById('ethicsStatePill');
  const saveBtn = document.getElementById('ethicsSaveBtn');
  const withdrawBtn = document.getElementById('ethicsWithdrawBtn');
  const consent = document.getElementById('ethicsConsent');
  const form = document.getElementById('ethicsForm');

  const accepted = !!agent.ethics_code_accepted_at;
  const revoked = !!agent.ethics_badge_revoked_at;
  const active = ethicsBadgeActive(agent);
  const stale = accepted && !revoked && agent.ethics_code_version !== ETHICS_CODE_VERSION;

  box.classList.toggle('is-pending', !active);
  box.classList.toggle('is-revoked', revoked);
  consent.checked = false;
  withdrawBtn.hidden = !active;

  if (revoked){
    // הסרה היא החלטה של הנהלת הפלטפורמה — אישור חוזר מכאן לא יחזיר את התו,
    // ולכן הטופס נסגר במקום להציע פעולה שלא תעבוד
    title.textContent = 'תו האיכות הוסר';
    note.textContent = 'התו הוסר בתאריך ' + ethicsDateLabel(agent.ethics_badge_revoked_at) +
      ' בעקבות בדיקת עמידה בתקנון. להחזרתו יש לפנות להנהלת הפלטפורמה.';
    pill.textContent = 'התו הוסר';
    form.hidden = true;
    accSetCount('accEthics', 'התו הוסר');
    return;
  }

  form.hidden = false;
  if (stale){
    title.textContent = 'הקוד האתי עודכן';
    note.textContent = 'אישרת את גרסה ' + (agent.ethics_code_version || 'קודמת') +
      '. כדי שהתו יישאר בתוקף יש לאשר את הנוסח המעודכן.';
    pill.textContent = 'נדרש אישור מחדש';
    saveBtn.textContent = 'אישור הנוסח המעודכן';
    accSetCount('accEthics', 'נדרש אישור');
  } else if (active){
    title.textContent = 'תו האיכות פעיל';
    note.textContent = 'אישרת את הקוד האתי בתאריך ' + ethicsDateLabel(agent.ethics_code_accepted_at) +
      '. התו מוצג בדף שלך, בדף המשרד ולצד תמונתך בכל מודעת נכס.';
    pill.textContent = 'פעיל';
    accSetCount('accEthics', '');
  } else {
    title.textContent = 'תו האיכות טרם הופעל';
    note.textContent = 'אישור עשרת הסעיפים מדליק את התו בדף שלך ובכל מודעות הנכסים.';
    pill.textContent = 'נדרש אישור';
    saveBtn.textContent = 'אישור הקוד והפעלת התו';
    accSetCount('accEthics', 'נדרש אישור');
  }
  // תיבת האישור נלווית לכפתור האישור — בלעדיו היא סימון שלא עושה דבר
  saveBtn.hidden = active && !stale;
  consent.closest('.ethics-consent').hidden = saveBtn.hidden;
}

function loadEthicsSettings(agent){
  const list = document.getElementById('ethicsClauses');
  if (!list.children.length){
    ETHICS_CLAUSES.forEach(text=>{
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
  }
  renderEthicsState(agent);
  // מי שעוד לא אישר/ה מקבל/ת את הקטגוריה פתוחה: בלי אישור אין תו, וזה הדבר
  // הראשון שכדאי לסגור אחרי ההצטרפות
  if (!agent.ethics_code_accepted_at && !agent.ethics_badge_revoked_at){
    document.getElementById('accEthics').open = true;
  }
}

document.getElementById('ethicsForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const feedback = document.getElementById('ethicsFeedback');
  const btn = document.getElementById('ethicsSaveBtn');
  if (!document.getElementById('ethicsConsent').checked){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'יש לסמן את תיבת האישור לפני הפעלת התו.';
    return;
  }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'שומר…';
  feedback.style.color = 'var(--ink-soft)';
  feedback.textContent = '';
  try{
    // התאריך שנשלח הוא סימון בלבד — הטריגר במסד דורס אותו ב-now(). קוראים
    // את השורה חזרה כדי להציג את מה שבאמת נשמר, ולא את מה שביקשנו לשמור.
    const { data: saved, error } = await sb.from('agency_members').update({
      ethics_code_accepted_at: new Date().toISOString(),
      ethics_code_version: ETHICS_CODE_VERSION,
      updated_at: new Date().toISOString(),
    }).eq('id', currentAgent.id)
      .select('ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at')
      .single();
    if (error) throw error;

    Object.assign(currentAgent, saved);
    renderEthicsState(currentAgent);
    renderProfilePreview();
    if (ethicsBadgeActive(currentAgent)){
      feedback.style.color = 'var(--teal)';
      feedback.textContent = 'התו הופעל - הוא מוצג מעכשיו בדף שלך ובמודעות הנכסים.';
      showToast('תו האיכות הופעל');
    } else {
      feedback.style.color = 'var(--brick)';
      feedback.textContent = 'האישור לא נשמר. נסו שוב, ואם זה חוזר - פנו להנהלת הפלטפורמה.';
    }
  } catch(err){
    console.error('ethics accept failed', err);
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שמירה נכשלה: ' + (err.message || 'שגיאה לא צפויה');
  } finally{
    btn.disabled = false;
    if (btn.textContent === 'שומר…') btn.textContent = original;
  }
});

/* ביטול אישור מרצון — לא הסרה משמעתית. מנקה את החותמת, ולכן התו יורד מכל
   המקומות הציבוריים עד לאישור חוזר. */
document.getElementById('ethicsWithdrawBtn').addEventListener('click', async ()=>{
  if (!currentAgent) return;
  if (!confirm('לבטל את האישור? התו יוסר מדף הסוכן/ת שלך ומכל מודעות הנכסים עד לאישור חוזר.')) return;
  const feedback = document.getElementById('ethicsFeedback');
  try{
    const { data: saved, error } = await sb.from('agency_members').update({
      ethics_code_accepted_at: null,
      ethics_code_version: null,
      updated_at: new Date().toISOString(),
    }).eq('id', currentAgent.id)
      .select('ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at')
      .single();
    if (error) throw error;
    Object.assign(currentAgent, saved);
    renderEthicsState(currentAgent);
    renderProfilePreview();
    feedback.style.color = 'var(--ink-soft)';
    feedback.textContent = 'האישור בוטל והתו הוסר מהדפים הציבוריים.';
  } catch(err){
    console.error('ethics withdraw failed', err);
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'הביטול נכשל: ' + (err.message || 'שגיאה לא צפויה');
  }
});

/* ---------- התו של המשרד (מנהל/ת בלבד) ---------- */
async function loadAgencyEthics(agencyId){
  const block = document.getElementById('ethicsAgencyBlock');
  block.hidden = false;
  const { data, error } = await sb.from('agencies')
    .select('ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at')
    .eq('id', agencyId).maybeSingle();
  if (error || !data){ block.hidden = true; return; }
  ethicsAgency = data;
  renderAgencyEthicsState();
}

function renderAgencyEthicsState(){
  const note = document.getElementById('ethicsAgencyNote');
  const btn = document.getElementById('ethicsAgencyBtn');
  const consent = document.getElementById('ethicsAgencyConsent');
  const row = ethicsAgency || {};
  const stale = row.ethics_code_accepted_at && !row.ethics_badge_revoked_at &&
    row.ethics_code_version !== ETHICS_CODE_VERSION;

  if (row.ethics_badge_revoked_at){
    note.textContent = 'התו של המשרד הוסר בתאריך ' + ethicsDateLabel(row.ethics_badge_revoked_at) +
      '. להחזרתו יש לפנות להנהלת הפלטפורמה.';
    consent.closest('.ethics-consent').hidden = true;
    btn.hidden = true;
    return;
  }
  consent.closest('.ethics-consent').hidden = false;
  if (ethicsBadgeActive(row) && !stale){
    note.textContent = 'התו של המשרד פעיל מאז ' + ethicsDateLabel(row.ethics_code_accepted_at) +
      ' ומוצג בראש דף המשרד.';
    consent.closest('.ethics-consent').hidden = true;
    btn.hidden = true;
  } else {
    note.textContent = stale
      ? 'הקוד האתי עודכן - יש לאשר את הנוסח המעודכן בשם המשרד כדי שהתו יישאר בתוקף.'
      : 'אישור בשם המשרד מדליק את התו בראש דף המשרד. הוא אינו מחליף את האישור האישי של כל סוכן/ת.';
    btn.hidden = false;
    btn.textContent = stale ? 'אישור הנוסח המעודכן בשם המשרד' : 'אישור בשם המשרד';
  }
}

document.getElementById('ethicsAgencyBtn').addEventListener('click', async ()=>{
  if (!currentAgent || !currentAgent.agency_id) return;
  const feedback = document.getElementById('ethicsAgencyFeedback');
  const btn = document.getElementById('ethicsAgencyBtn');
  if (!document.getElementById('ethicsAgencyConsent').checked){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'יש לסמן את תיבת האישור.';
    return;
  }
  btn.disabled = true;
  feedback.style.color = 'var(--ink-soft)';
  feedback.textContent = 'שומר…';
  try{
    const { data: saved, error } = await sb.from('agencies').update({
      ethics_code_accepted_at: new Date().toISOString(),
      ethics_code_version: ETHICS_CODE_VERSION,
    }).eq('id', currentAgent.agency_id)
      .select('ethics_code_accepted_at, ethics_code_version, ethics_badge_revoked_at')
      .single();
    if (error) throw error;
    ethicsAgency = saved;
    document.getElementById('ethicsAgencyConsent').checked = false;
    renderAgencyEthicsState();
    feedback.style.color = 'var(--teal)';
    feedback.textContent = 'התו של המשרד הופעל.';
    showToast('תו האיכות של המשרד הופעל');
  } catch(err){
    console.error('agency ethics accept failed', err);
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שמירה נכשלה: ' + (err.message || 'שגיאה לא צפויה');
  } finally{
    btn.disabled = false;
  }
});

/* ---------- Review moderation (manager only) ---------- */
async function loadPendingReviews(agencyId){
  const el = document.getElementById('reviewModerationList');
  el.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data: reviews, error } = await sb
    .from('reviews')
    .select('id, rating, agency_rating, text, reviewer_display_name, created_at')
    .eq('agency_id', agencyId)
    .eq('status', 'pending')
    .order('created_at', { ascending:false });

  if (error){ el.innerHTML = '<div class="empty-state">שגיאה: ' + error.message + '</div>'; return; }
  accSetCount('accReviews', (reviews||[]).length);
  if (!reviews || reviews.length === 0){ el.innerHTML = '<div class="empty-state">אין ביקורות הממתינות לאישור.</div>'; return; }

  el.innerHTML = '';
  reviews.forEach(r=>{
    const card = document.createElement('div');
    card.className = 'card lead-card';
    card.innerHTML = `
      <div class="lead-top">
        <div>
          <div class="lead-name">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
        </div>
      </div>
      ${tagsHtml([
        { text:'👤 ' + (r.reviewer_display_name || 'לקוח מאומת'), cls:'tag-key' },
        { text:`⭐ המתווך/ת ${r.rating}/5`, cls: r.rating >= 4 ? 'tag-good' : 'tag-warn' },
        // הדירוג הישיר של המשרד הוא שאלה אופציונלית בטופס, ולכן התגית מופיעה
        // רק כשניתנה תשובה. מנהל/ת המשרד מאשר/ת את הביקורת — וצריך/ה לראות
        // את שני הדירוגים שהאישור מפרסם, לא רק את זה של המתווך/ת.
        ...(r.agency_rating ? [{
          text:`🏢 המשרד ${r.agency_rating}/5`,
          cls: r.agency_rating >= 4 ? 'tag-good' : 'tag-warn',
        }] : []),
        { text:'📅 ' + hebDate(r.created_at) },
      ])}
      ${r.text ? `<div class="lead-meta" style="margin-top:6px">${esc(r.text)}</div>` : ''}
      <div class="lead-actions"></div>
    `;
    const actions = card.querySelector('.lead-actions');

    addCardAction(actions, {
      label:'✅ אישור ופרסום', cls:'btn-gold',
      onClick:()=> moderateReview(r.id, 'published', agencyId),
    });
    addCardAction(actions, {
      label:'✖ דחייה',
      onClick:()=> moderateReview(r.id, 'rejected', agencyId),
    });

    el.appendChild(card);
  });
}

async function moderateReview(reviewId, newStatus, agencyId){
  // חשוב: אין כאן עריכת תוכן הביקורת עצמה (רק אישור/דחייה) - כדי לשמור על אמינות
  // האימות (מודול 3 §3.4). ה-RLS policy "manager moderate own agency reviews" כבר
  // קיים ומגביל את זה לשורות של המשרד שלו בלבד.
  const { error } = await sb.from('reviews').update({ status: newStatus }).eq('id', reviewId);
  if (error){ showToast('שגיאה: ' + error.message); return; }
  showToast(newStatus === 'published' ? 'הביקורת פורסמה' : 'הביקורת נדחתה');
  await loadPendingReviews(agencyId);
}

/* ---------- Wallet top-up ----------
   טעינת ארנק היא שתי פעולות ולא אחת: כאן נפתח התשלום, והזיכוי קורה בשרת
   אחרי שמורנינג מאשר/ת את החיוב. לכן שום דבר בקובץ הזה לא מצהיר "נטענו" -
   היתרה שמגיעה מהמסד היא ההצהרה היחידה, והיא גם היחידה שאפשר לסמוך עליה. */

/* מצב הסליקה נקבע בשרת לפי הסודות שמוגדרים בו, ולא בקוד הדף. כך המעבר
   ממצב בדיקה לסליקה אמיתית קורה בהגדרת סוד - בלי לפרסם HTML מחדש ובלי
   רגע שבו הכפתור אומר דבר אחד והשרת עושה אחר. */
async function probeTopupMode(){
  const badge = document.getElementById('topupModeBadge');
  const note  = document.getElementById('topupModeNote');
  const btn   = document.getElementById('topupBtn');
  try{
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const res = await fetch(SUPABASE_URL + '/functions/v1/wallet-topup', {
      headers:{ 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    });
    if (!res.ok) return;
    const data = await res.json();
    const live = data.configured === true;

    badge.style.display = live ? 'none' : '';
    note.textContent = live
      ? 'ממשיכים לעמוד התשלום - שם ממלאים את פרטי החשבונית ומאשרים את התקנון. פרטי הכרטיס נמסרים בעמוד של מורנינג בלבד, ואינם עוברים דרך האתר.'
      : 'טרם חובר ספק סליקה - הטעינה כאן להדגמה/בדיקה בלבד, לא כרטיס אשראי אמיתי.';
    /* הכפתור מוביל לעמוד התשלום בשני המצבים, ולכן הוא לא מבטיח "טעינה" -
       גם במצב בדיקה הטעינה קורית שם, אחרי אישור התקנון, ולא בלחיצה כאן. */
    btn.textContent = 'המשך לתשלום';
  } catch(err){
    // הבדיקה נכשלה. משאירים את הממשק כמו שהוא - עדיף בלי הצהרה על מצב
    // מאשר הצהרה שאולי שגויה. הכפתור עדיין עובד, והשרת יחליט.
    console.error('probeTopupMode', err);
  }
}

/* **הטעינה עוברת דרך checkout.html ולא פונה ל-wallet-topup מכאן.**

   עד היום הכפתור הזה פתח תשלום ישירות, ובדרך דילג על שני דברים שחייבים
   לקרות לפני חיוב: איסוף פרטי הלקוח/ה לחשבונית (שם, טלפון, מדינה, אימייל)
   ואישור מפורש של התקנון. ‏checkout.html עושה את שניהם, ומשם ממשיכים לאותה
   נקודת קצה בדיוק - ולכן זו הפניה ולא מסלול חדש.

   עמוד תשלום אחד לכל חיוב באתר הוא גם מה שחברת הסליקה דורשת: צ'קבוקס תקנון
   בעמוד שבו משלמים. שני מסלולים במקביל היו אומרים שהדרישה מתקיימת באחד
   ונעקפת בשני. ראו docs/wallet-payments.md. */
document.getElementById('topupBtn').addEventListener('click', ()=>{
  const amount = Number(document.getElementById('topupAmount').value);
  location.href = 'checkout.html?product=wallet&amount=' + encodeURIComponent(amount);
});

/* ---------- החזרה מעמוד התשלום ----------
   ‏?topup=success אינו הוכחה שהכסף נכנס: הוא רק אומר שמורנינג החזיר/ה את
   הגולש/ת דרך כתובת ההצלחה. הזיכוי עצמו קורה ב-webhook, שעשוי להגיע שנייה
   אחרי - או, אם משהו השתבש, רק ב-reconcile. לכן כאן לא מציגים סכום ולא
   כותבים "נטען", אלא בודקים את השורה במסד עד שהיא נסגרת.

   הכתובת מנוקה מיד - רענון דף אחרי טעינה לא אמור להיראות כמו טעינה חדשה -
   אבל **רק שני המפתחות שלנו**, ובדיוק כמו ב-cleanAuthParamsFromUrl(): מחיקת
   כל ה-query הייתה מוחקת גם את invite, ו-replaceState עם null במקום
   history.state הורס את הזקיף של exit-guard.js. */
async function handleTopupReturn(){
  const params = new URLSearchParams(location.search);
  const outcome = params.get('topup');
  const topupId = params.get('topup_id');
  if (!outcome) return;

  if (window.history && window.history.replaceState){
    params.delete('topup'); params.delete('topup_id');
    const search = params.toString();
    history.replaceState(history.state, '',
      location.pathname + (search ? '?' + search : '') + location.hash);
  }
  document.getElementById('accWallet')?.setAttribute('open', '');
  const feedback = document.getElementById('topupFeedback');
  if (!feedback) return;

  if (outcome !== 'success'){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'התשלום לא הושלם. לא בוצע חיוב.';
    return;
  }

  feedback.style.color = 'var(--muted)';
  feedback.textContent = 'התשלום התקבל - מעדכנים את היתרה…';

  // חמישה ניסיונות על פני ~12 שניות. אם ה-webhook מאחר יותר מזה, ההודעה
  // מפנה להיסטוריה במקום להיתקע על "מעדכנים" - הכסף לא אבד, הוא בדרך.
  for (let i = 0; i < 5; i++){
    await new Promise(r => setTimeout(r, i === 0 ? 1200 : 2600));
    if (!topupId){ await refreshAgentBalance(); break; }
    const { data } = await sb.from('wallet_topups')
      .select('status, amount').eq('id', topupId).maybeSingle();
    if (data?.status === 'success'){
      await refreshAgentBalance();
      feedback.style.color = 'var(--blue)';
      feedback.textContent = `נטענו ₪${data.amount} לארנק.`;
      return;
    }
    if (data?.status === 'failed'){
      feedback.style.color = 'var(--red)';
      feedback.textContent = 'התשלום לא אושר. לא בוצע חיוב.';
      return;
    }
  }
  await refreshAgentBalance();
  feedback.style.color = 'var(--muted)';
  feedback.textContent = 'התשלום נקלט והיתרה תתעדכן בדקות הקרובות. אפשר לעקוב בהיסטוריית החיובים.';
}

/* ---------- החזר יתרה שלא מומשה ----------
   המדיניות: אפשר לבקש בכל עת החזר על כסף שנטען ולא מומש. הבקשה מורידה את
   הסכום מהיתרה מיד - כך אי אפשר לבקש החזר ואז להוציא את אותו כסף - ומנהל/ת
   פלטפורמה מבצע/ת את ההחזר במורנינג ומסמן/ת שבוצע.

   התקרה אינה היתרה אלא my_wallet_refundable_amount(): כסף שנוצר במצב בדיקה
   מעולם לא שולם, והחזר כנגדו היה מוציא כסף אמיתי כנגד כלום. לכן במצב בדיקה
   הסקציה כולה פשוט לא מוצגת. */
async function refreshRefundSection(){
  const section = document.getElementById('refundSection');
  if (!section || !currentAgent) return;
  try{
    const [{ data: refundable }, { data: open }] = await Promise.all([
      sb.rpc('my_wallet_refundable_amount'),
      sb.from('wallet_refunds')
        .select('id, amount, requested_at')
        .eq('agent_id', currentAgent.id).eq('status', 'requested').maybeSingle(),
    ]);

    const max = Number(refundable) || 0;
    // אין בקשה פתוחה ואין מה להחזיר - אין מה להציג.
    if (!open && max <= 0){ section.style.display = 'none'; return; }
    section.style.display = '';

    document.getElementById('refundOpen').style.display  = open ? '' : 'none';
    document.getElementById('refundForm').style.display  = open ? 'none' : '';
    document.getElementById('refundIntro').textContent = open
      ? 'הבקשה בטיפול. הסכום כבר ירד מהיתרה ואינו זמין לרכישות.'
      : `ניתן להחזר: ${shekel(max)}. הסכום יורד מהיתרה עם הבקשה, וההחזר מבוצע לאותו אמצעי תשלום.`;

    if (open){
      document.getElementById('refundOpenText').textContent =
        `בקשת החזר על ${shekel(open.amount)} — נשלחה ב-${new Date(open.requested_at).toLocaleDateString('he-IL')}.`;
    } else {
      document.getElementById('refundAmount').max = max;
    }
  } catch(err){
    console.error('refreshRefundSection', err);
  }
}

document.getElementById('refundBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('refundBtn');
  const feedback = document.getElementById('refundFeedback');
  const amount = Number(document.getElementById('refundAmount').value);
  if (!Number.isFinite(amount) || amount <= 0){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'הזינו סכום להחזר.';
    return;
  }
  const ok = await confirmPurchase({
    title: 'בקשת החזר יתרה',
    lines: [`הסכום ${shekel(amount)} ירד מהארנק מיד ולא יהיה זמין לרכישות.`,
            'ההחזר מבוצע לאותו אמצעי תשלום, לאחר בדיקה.',
            'אפשר לבטל את הבקשה כל עוד לא בוצעה, והיתרה תחזור.'],
    price: 0, hidePrice: true, requireAck: true,
    ackText: 'אני מבין/ה שהסכום יורד מהארנק עם שליחת הבקשה.',
    confirmLabel: 'שליחת הבקשה',
  });
  if (!ok) return;

  btn.disabled = true; feedback.textContent = '';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/wallet-refund', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ action:'request', amount,
                             note: document.getElementById('refundNote').value || null }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      feedback.style.color = 'var(--red)';
      feedback.textContent =
        data.error === 'amount_exceeds_refundable' ? `הסכום גבוה מהניתן להחזר (${shekel(data.refundable)}).` :
        data.error === 'refund_already_open'       ? 'כבר יש בקשת החזר פתוחה.' :
        data.error === 'insufficient_balance'      ? 'אין יתרה מספקת.' :
        'שגיאה בשליחת הבקשה - נסו שוב';
      return;
    }
    feedback.style.color = 'var(--blue)';
    feedback.textContent = 'הבקשה נשלחה.';
    document.getElementById('refundNote').value = '';
    document.getElementById('refundAmount').value = '';
    await refreshAgentBalance();
    await refreshRefundSection();
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('refundCancelBtn').addEventListener('click', async ()=>{
  const feedback = document.getElementById('refundFeedback');
  const { data: open } = await sb.from('wallet_refunds')
    .select('id').eq('agent_id', currentAgent.id).eq('status','requested').maybeSingle();
  if (!open){ await refreshRefundSection(); return; }

  const ok = await confirmPurchase({
    title: 'ביטול בקשת ההחזר',
    lines: ['הסכום יחזור לארנק ויהיה זמין לרכישות.'],
    price: 0, hidePrice: true, confirmLabel: 'ביטול הבקשה',
  });
  if (!ok) return;

  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/wallet-refund', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ action:'cancel', refund_id: open.id }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      feedback.style.color = 'var(--red)';
      feedback.textContent = 'שגיאה בביטול - נסו שוב';
      return;
    }
    feedback.style.color = 'var(--blue)';
    feedback.textContent = 'הבקשה בוטלה והיתרה חזרה.';
    await refreshAgentBalance();
    await refreshRefundSection();
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
  }
});

/* ============================================================================
   סגירת החשבון והפסקת ההתקשרות
   ============================================================================
   המקטע כאן לא מחליט כלום - כל מה שהוא מציג מגיע מ-close-account בפעולת
   ‏preview, כי כל שורה בו תלויה בחשבון עצמו: כמה מודעות ירדו, כמה כסף
   יוחזר, מאיזה תאריך, ומה (אם בכלל) חוסם. מסך שמבקש אישור על "מה שיקרה"
   ומנחש את מה שיקרה הוא לא אישור.

   שני האישורים אינם שני כפתורים: הראשון הוא סימון הבנה, והשני הוא הקלדה
   מלאה של "סגירת חשבון". ההקלדה נבדקת שוב בשרת - נקודת קצה שסוגרת חשבון
   בקריאה אחת מסקריפט מבטלת את כל מה שהחלון הזה בא לעשות.
   ============================================================================ */

const CLOSE_PHRASE = 'סגירת חשבון';
let closureSummary = null;

async function callCloseAccount(payload){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok:false, data:{ error:'no_session' } };
  const res = await fetch(SUPABASE_URL + '/functions/v1/close-account', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch(_){ /* ראו callJoinAgency */ }
  return { ok: res.ok && !data.error, data };
}

/* המשפט על הכסף. הוא נבנה פעם אחת ומוצג בשני מקומות - במקטע ובדיאלוג -
   כי אלה בדיוק אותם נתונים, ושתי גרסאות של אותו משפט הן שתי הזדמנויות
   לסתור זו את זו. */
function closureMoneyText(s){
  const parts = [];
  if (s.refund_already_open != null){
    parts.push('כבר יש בקשת החזר פתוחה על ' + shekel(s.refund_already_open) + ', והיא ממשיכה כרגיל.');
  } else if (s.refundable > 0){
    parts.push('יתרת הארנק שנטענה ולא מומשה - ' + shekel(s.refundable) + ' - תיפתח אוטומטית כבקשת החזר.');
  } else if (s.credit_balance > 0){
    parts.push('בארנק יש ' + shekel(s.credit_balance) + ', אבל אין מזה סכום שנטען בתשלום וטרם מומש, ולכן אין מה להחזיר.');
  } else {
    parts.push('אין יתרה בארנק, ולכן אין החזר.');
  }
  if (s.subscription_until){
    parts.push('את/ה במנוי חודשי ששולם עד ' + hebDate(s.subscription_until) +
               '. אין זיכוי יחסי על החודש שכבר שולם, ולכן ההתקשרות נפסקת בתאריך הזה - ועד אז הכול ממשיך לעבוד כרגיל.');
  } else {
    parts.push('אינך במנוי חודשי בתשלום, ולכן הסגירה נכנסת לתוקף מיד.');
  }
  return parts.join(' ');
}

async function loadClosureSection(){
  const acc = document.getElementById('accCloseAccount');
  if (!acc) return;
  const { ok, data } = await callCloseAccount({ action:'preview' });
  // הפונקציה עוד לא פרוסה, או שהמיגרציה עוד לא רצה. הקטגוריה יורדת מהמסך
  // במקום להציג "סגירת חשבון" שלא תעבוד - ראו את אותה דוקטרינה ב-page_bg.
  // ‏style.display ולא hidden: זה מה ש-navAccVisible בודק, וקטגוריה שירדה
  // מהעמוד צריכה לרדת גם משלושת הניווטים.
  if (!ok || !data.summary){
    acc.style.display = 'none';
    refreshNavCounts();
    return;
  }
  acc.style.display = '';

  const s = data.summary;
  closureSummary = s;

  const pending  = document.getElementById('closurePending');
  const offer    = document.getElementById('closureOffer');
  const blocked  = document.getElementById('closureBlocked');
  const isPending = !!s.closure_requested_at && !s.closed_at;

  pending.hidden = !isPending;
  offer.hidden   = isPending;

  if (isPending){
    const due = new Date(s.closure_effective_at);
    const overdue = !isNaN(due.getTime()) && due.getTime() <= Date.now();
    document.getElementById('closurePendingTitle').textContent =
      overdue ? 'הסגירה ממתינה להשלמה' : 'בקשת הסגירה נרשמה';
    document.getElementById('closurePendingBody').textContent = overdue
      // המועד עבר והשורה עדיין פתוחה - כמעט תמיד החסם של מנהל/ת אחרון/ה.
      ? 'המועד שנקבע (' + hebDate(s.closure_effective_at) + ') כבר עבר, והסגירה עדיין לא הושלמה. '
        + 'ברוב המקרים הסיבה היא שאת/ה המנהל/ת הפעיל/ה היחיד/ה במשרד ויש בו עוד סוכנים - '
        + 'מינוי מנהל/ת נוסף/ת ב"צוות המשרד" משחרר את זה. לעזרה: 054-6929991.'
      : 'החשבון ייסגר ב-' + hebDate(s.closure_effective_at) + ' - בתום תקופת החיוב ששולמה. '
        + 'עד אז הדף, המודעות והלידים ממשיכים כרגיל, ואפשר לבטל את הבקשה.';
    accSetCount('accCloseAccount', 'בקשה פתוחה');
    return;
  }

  accSetCount('accCloseAccount', '');
  blocked.hidden = s.blocker !== 'last_manager';
  document.getElementById('closeAccountBtn').disabled = !!s.blocker;
  document.getElementById('closureProps').textContent =
    s.active_properties === 0 ? 'אין כרגע מודעות פעילות'
    : s.active_properties === 1 ? 'מודעה פעילה אחת'
    : plural(s.active_properties, 'מודעה פעילה אחת', 'מודעות פעילות');
  document.getElementById('closureMoney').textContent = closureMoneyText(s);
}

/* ---------- האישור הכפול ---------- */
const caModal = document.getElementById('closeAccountModal');

function closeCaModal(){
  caModal.style.display = 'none';
  document.getElementById('caStep1').hidden = false;
  document.getElementById('caStep2').hidden = true;
  document.getElementById('caAck').checked = false;
  document.getElementById('caNext').disabled = true;
  document.getElementById('caPhrase').value = '';
  document.getElementById('caConfirm').disabled = true;
  document.getElementById('caModalFeedback').textContent = '';
}

document.getElementById('closeAccountBtn').addEventListener('click', async ()=>{
  const feedback = document.getElementById('closureFeedback');
  feedback.textContent = '';
  // המצב נקרא מחדש לפני הפתיחה: המסך יכול להיות פתוח מאז הבוקר, ובינתיים
  // נטענו לידים, נוספו סוכנים למשרד או ירדה מודעה.
  await loadClosureSection();
  const s = closureSummary;
  if (!s) return;
  // בקשה נפתחה בינתיים (טאב אחר, מכשיר אחר) - המקטע כבר עבר למצב "ממתין",
  // ואין מה לאשר שוב.
  if (s.closure_requested_at || s.closed_at) return;
  if (s.blocker){
    feedback.style.color = '#b42318';
    feedback.textContent = s.blocker === 'last_manager'
      ? 'אי אפשר לסגור כל עוד את/ה המנהל/ת היחיד/ה במשרד עם סוכנים פעילים.'
      : 'לא ניתן לסגור את החשבון כרגע.';
    return;
  }

  const list = document.getElementById('caStep1List');
  list.textContent = '';
  [
    'דף הסוכן/ת שלך יורד מהאוויר, וגם הכרטיס שלך בספריית המתווכים.',
    s.active_properties > 0
      ? plural(s.active_properties, 'מודעה פעילה אחת יורדת', 'מודעות פעילות יורדות') + ' מהאתר ומהחיפוש.'
      : 'אין כרגע מודעות פעילות שיירדו.',
    'לא נשלחות אליך יותר פניות, התראות או מיילים, והמייל שלך יוצא מרשימת התפוצה.',
    'הכניסה לאיזור הסוכנים נסגרת. אין לזה כפתור חזרה.',
  ].forEach(text=>{
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  document.getElementById('caStep1Money').textContent = closureMoneyText(s);
  document.getElementById('caStep2Note').textContent = s.subscription_until
    ? 'לאחר האישור הבקשה תירשם, והסגירה תבוצע ב-' + hebDate(s.subscription_until) + '. עד אז אפשר לבטל אותה מכאן.'
    : 'לאחר האישור הסגירה מתבצעת מיד.';
  document.getElementById('caConfirm').textContent =
    s.subscription_until ? 'רישום בקשת הסגירה' : 'סגירת החשבון';

  caModal.style.display = 'flex';
  document.getElementById('caAck').focus();
});

document.getElementById('caAck').addEventListener('change', e=>{
  document.getElementById('caNext').disabled = !e.target.checked;
});
document.getElementById('caNext').addEventListener('click', ()=>{
  document.getElementById('caStep1').hidden = true;
  document.getElementById('caStep2').hidden = false;
  document.getElementById('caPhrase').focus();
});
document.getElementById('caBack').addEventListener('click', ()=>{
  document.getElementById('caStep2').hidden = true;
  document.getElementById('caStep1').hidden = false;
});
document.getElementById('caPhrase').addEventListener('input', e=>{
  document.getElementById('caConfirm').disabled = e.target.value.trim() !== CLOSE_PHRASE;
});
document.getElementById('caCancel1').addEventListener('click', closeCaModal);
caModal.addEventListener('click', e=>{ if (e.target === caModal) closeCaModal(); });
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape' && caModal.style.display !== 'none') closeCaModal();
});

document.getElementById('caConfirm').addEventListener('click', async ()=>{
  const btn = document.getElementById('caConfirm');
  const modalFeedback = document.getElementById('caModalFeedback');
  btn.disabled = true;
  modalFeedback.style.color = 'var(--ink-soft)';
  modalFeedback.textContent = 'סוגרים…';

  const { ok, data } = await callCloseAccount({
    action: 'request',
    confirm: CLOSE_PHRASE,
    reason: (document.getElementById('closureReason').value || '').trim() || null,
  });

  if (!ok){
    modalFeedback.style.color = '#b42318';
    modalFeedback.textContent = data.error === 'last_manager'
      ? 'אי אפשר לסגור כל עוד את/ה המנהל/ת היחיד/ה במשרד עם סוכנים פעילים. לעזרה: 054-6929991'
      : data.error === 'closure_already_requested' ? 'כבר קיימת בקשת סגירה פתוחה.'
      : data.error === 'already_closed' ? 'החשבון כבר סגור.'
      : 'הפעולה נכשלה. אפשר לנסות שוב, או לפנות לתמיכה: 054-6929991';
    btn.disabled = false;
    return;
  }

  closeCaModal();
  // סגירה מיידית: אין למה לחזור בדשבורד - טוענים מחדש, ו-loadDashboard
  // ינחית על מסך "החשבון נסגר". סגירה מתוזמנת: רק מרעננים את המקטע.
  if (data.closed) location.reload();
  else await loadClosureSection();
});

document.getElementById('closureCancelBtn').addEventListener('click', async ()=>{
  const btn = document.getElementById('closureCancelBtn');
  const feedback = document.getElementById('closureFeedback');
  btn.disabled = true;
  const { ok, data } = await callCloseAccount({ action:'cancel' });
  btn.disabled = false;
  if (!ok){
    feedback.style.color = '#b42318';
    feedback.textContent = data.error === 'already_closed'
      ? 'החשבון כבר נסגר ואי אפשר לבטל מכאן. התמיכה: 054-6929991'
      : 'ביטול הבקשה נכשל - אפשר לנסות שוב.';
    return;
  }
  feedback.style.color = '#1c6b4a';
  feedback.textContent = 'בקשת הסגירה בוטלה. החשבון ממשיך כרגיל.';
  await loadClosureSection();
});

/* ---------- תור בקשות ההחזר (מנהל/ת פלטפורמה) ----------
   הרשימה מגיעה מ-Edge Function ולא ב-select ישיר, כי הפעולות שלידה נוגעות
   ביתרה - ואת אלה מותר להריץ רק ב-service_role. אותה פונקציה מאמתת
   ‏is_platform_admin בעצמה ולא סומכת על כך שהכפתור מוצג רק למנהל/ת. */
async function callRefundApi(payload){
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/wallet-refund', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json() };
}

/* ================= ערעורי רישיון תיווך - הצד של ההנהלה =================
   ‏broker_license_appeals קריאה למנהל/ת פלטפורמה דרך RLS, אבל הטעינה כאן
   עוברת דרך הפונקציה ולא דרך select ישיר, מסיבה אחת: ‏document_path לבדו
   חסר ערך - הדלי פרטי. הפונקציה מחזירה במקומו **קישור חתום** של עשר דקות,
   וזו הדרך היחידה לראות את הצילום. */
async function callLicenseAppealApi(payload){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok:false, data:{ error:'no_session' } };
  const res = await fetch(LICENSE_APPEAL_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch(_){ /* ראו callTeamInvite */ }
  return { ok: res.ok && !data.error, data };
}

async function loadLicenseAppeals(){
  const host = document.getElementById('licenseAppealsList');
  if (!host) return;
  const { ok, data } = await callLicenseAppealApi({ action:'list', status:'pending' });
  if (!ok){
    host.innerHTML = '<div class="empty-state">שגיאה בטעינת הערעורים.</div>';
    return;
  }
  const rows = data.appeals || [];
  accSetCount('accLicenseAppeals', rows.length || '');
  if (!rows.length){ host.innerHTML = '<div class="empty-state">אין ערעורי רישיון ממתינים.</div>'; return; }

  host.innerHTML = rows.map(r => `
    <div style="border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px" data-appeal="${esc(r.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong style="font-size:.85rem">${esc(r.applicant_name)}</strong>
        <strong style="font-size:.85rem;direction:ltr">רישיון ${esc(r.license_number)}</strong>
      </div>
      <div style="font-size:.74rem;color:var(--muted);margin:2px 0 6px">
        <span style="direction:ltr;display:inline-block">${esc(r.applicant_email)}</span>
        ${r.applicant_phone ? ' · <span style="direction:ltr;display:inline-block">' + esc(r.applicant_phone) + '</span>' : ''}
        · ${new Date(r.created_at).toLocaleDateString('he-IL')}
        ${r.source ? ' · ' + esc(r.source) : ''}
      </div>
      ${r.note ? `<div style="font-size:.76rem;background:var(--paper-raised);border-radius:8px;padding:7px 9px;margin-bottom:8px">${esc(r.note)}</div>` : ''}
      ${r.document_url
        ? `<a href="${esc(r.document_url)}" target="_blank" rel="noopener"
              style="display:inline-block;font-size:.78rem;color:var(--teal);font-weight:600">📄 פתיחת צילום הרישיון</a>
           <div style="font-size:.68rem;color:var(--muted);margin-top:3px">הקישור תקף לעשר דקות. רענון הרשימה מייצר חדש.</div>`
        : '<div style="font-size:.74rem;color:var(--brick)">הצילום לא נטען - נסו לרענן.</div>'}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button type="button" class="btn btn-gold apApproveBtn" style="white-space:nowrap;font-size:.78rem">✅ אישור ופתיחת המשרד</button>
        <button type="button" class="btn btn-ghost apRejectBtn" style="white-space:nowrap;font-size:.78rem">✕ דחייה</button>
      </div>
    </div>`).join('');

  const decide = async (btn, decision, note) => {
    const card = btn.closest('[data-appeal]');
    btn.disabled = true;
    const { data } = await callLicenseAppealApi({
      action: 'decide', appeal_id: card.dataset.appeal, decision, decision_note: note || null,
    });
    if (data.error){ showToast('שגיאה: ' + (data.detail || data.error)); btn.disabled = false; return; }
    showToast(decision === 'approve'
      ? 'הרישיון אושר - הכניסה נפתחה והודעה נשלחה במייל'
      : 'הערעור נדחה וההודעה נשלחה');
    await loadLicenseAppeals();
  };

  host.querySelectorAll('.apApproveBtn').forEach(btn => btn.addEventListener('click', async ()=>{
    const ok2 = await confirmPurchase({
      title: 'אישור רישיון התיווך',
      lines: ['אשרו רק אחרי שראיתם את הצילום ושהפרטים בו תואמים.',
              'האישור פותח את הכניסה למערכת מיד, ומשחרר גם כרטיס קיים שנחסם.'],
      price: 0, hidePrice: true, requireAck: true,
      ackText: 'ראיתי את הצילום והוא רישיון תיווך בתוקף.', confirmLabel: 'אישור',
    });
    if (!ok2) return;
    await decide(btn, 'approve', null);
  }));

  host.querySelectorAll('.apRejectBtn').forEach(btn => btn.addEventListener('click', async ()=>{
    // הנימוק חובה — הוא נשלח לפונה, ודחייה בלי נימוק היא מבוי סתום.
    const reason = prompt('סיבת הדחייה (תישלח לפונה במייל):');
    if (reason === null) return;
    if (!reason.trim()){ showToast('נדרש נימוק לדחייה'); return; }
    await decide(btn, 'reject', reason.trim());
  }));
}

async function loadRefundQueue(){
  const host = document.getElementById('refundQueueList');
  if (!host) return;
  const { ok, data } = await callRefundApi({ action:'list', status:'requested' });
  if (!ok || data.error){
    host.innerHTML = '<div class="empty-state">שגיאה בטעינת התור.</div>';
    return;
  }
  const rows = data.refunds || [];
  accSetCount('accRefundQueue', rows.length || '');
  if (!rows.length){ host.innerHTML = '<div class="empty-state">אין בקשות החזר פתוחות.</div>'; return; }

  host.innerHTML = rows.map(r => {
    // ההקצאה היא מה שהופך את השורה לניתנת לביצוע: מול אילו עסקאות מקוריות
    // לזכות. בלעדיה מי שמבצע/ת את ההחזר צריך/ה לנחש.
    const alloc = (r.allocation || []).map(a =>
      `<div style="font-size:.72rem;color:var(--muted)">טעינה ${esc(String(a.topup_id).slice(0,8))}… - ${shekel(a.amount)}</div>`).join('');
    return `
    <div style="border:1px solid var(--line);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px" data-refund="${esc(r.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <strong style="font-size:.85rem">${esc(r.agency_members?.display_name || 'סוכן/ת')}</strong>
        <strong style="font-size:.9rem">${shekel(r.amount)}</strong>
      </div>
      <div style="font-size:.74rem;color:var(--muted);margin:2px 0 6px">
        ${new Date(r.requested_at).toLocaleDateString('he-IL')}${r.agent_note ? ' - ' + esc(r.agent_note) : ''}
      </div>
      ${alloc}
      <div style="display:flex;gap:6px;margin-top:8px">
        <input type="text" class="refundNoteInput" placeholder="מס' מסמך זיכוי"
               style="flex:1;min-width:0;border:1.5px solid var(--line);border-radius:var(--radius-sm);padding:7px 9px;font-size:.78rem">
        <button type="button" class="btn btn-gold refundDoneBtn" style="white-space:nowrap;font-size:.78rem">בוצע</button>
        <button type="button" class="btn btn-ghost refundRejectBtn" style="white-space:nowrap;font-size:.78rem">דחייה</button>
      </div>
    </div>`;
  }).join('');

  host.querySelectorAll('.refundDoneBtn').forEach(btn => btn.addEventListener('click', async ()=>{
    const card = btn.closest('[data-refund]');
    const creditNote = card.querySelector('.refundNoteInput').value.trim();
    const ok2 = await confirmPurchase({
      title: 'סימון ההחזר כבוצע',
      lines: ['אשרו רק אחרי שההחזר בוצע בפועל בממשק מורנינג.',
              'הפעולה אינה מחזירה כסף בעצמה - היא רק רושמת שזה קרה.'],
      price: 0, hidePrice: true, requireAck: true,
      ackText: 'ביצעתי את ההחזר במורנינג.', confirmLabel: 'סימון כבוצע',
    });
    if (!ok2) return;
    btn.disabled = true;
    const { data } = await callRefundApi({ action:'complete', refund_id: card.dataset.refund, credit_note_id: creditNote || null });
    if (data.error){ showToast('שגיאה: ' + data.error); btn.disabled = false; return; }
    showToast('ההחזר סומן כבוצע');
    await loadRefundQueue();
  }));

  host.querySelectorAll('.refundRejectBtn').forEach(btn => btn.addEventListener('click', async ()=>{
    const card = btn.closest('[data-refund]');
    // הנימוק חובה — הוא מוצג לסוכן/ת, ודחייה בלי נימוק היא מבוי סתום.
    const reason = prompt('סיבת הדחייה (תוצג לסוכן/ת):');
    if (!reason || !reason.trim()) return;
    btn.disabled = true;
    const { data } = await callRefundApi({ action:'reject', refund_id: card.dataset.refund, reason: reason.trim() });
    if (data.error){ showToast('שגיאה: ' + data.error); btn.disabled = false; return; }
    showToast('הבקשה נדחתה והיתרה הוחזרה');
    await loadRefundQueue();
  }));
}

/* ============================================================================
   ניהול מנויים — מנהל/ת פלטפורמה
   ----------------------------------------------------------------------------
   ‏set_tier רושמת בקשה כשמסלול בתשלום נבחר מחוץ לתקופת ההטבה, ומייל יוצא
   להנהלה. כאן נסגר הצד השני: אישור, דחייה, ותמונת מצב של מי נמצא איפה.

   כל הכתיבה עוברת בשלוש פונקציות מסד (‏admin_apply_tier_change,
   ‏admin_reject_tier_change) שבודקות ‎current_is_platform_admin()‎ בעצמן.
   הכפתורים כאן מוסתרים ממי שאינו/ה מנהל/ת פלטפורמה, אבל זו נוחות ולא
   הגנה — ההגנה היא שם.                                                      */

/* איזו קטגוריה בתמונת המצב פתוחה כרגע (null = אף אחת). מוצהר כאן ולא ליד
   הפונקציות שמשתמשות בו: ‏let אינו מורם, ו-loadSubscriptionsAdmin קוראת בו. */
let subsDrillBucket = null;

async function loadSubscriptionsAdmin(){
  const reqHost = document.getElementById('subsRequests');
  const logHost = document.getElementById('subsLog');
  const ovHost  = document.getElementById('subsOverview');
  if (!reqHost) return;

  const [{ data: overview }, { data: requests, error: reqErr }, { data: log }] = await Promise.all([
    sb.rpc('subscription_overview'),
    sb.rpc('pending_tier_requests'),
    sb.rpc('recent_tier_changes', { p_limit: 40 }),
  ]);

  // ---- תמונת המצב ----
  const ov = overview || {};
  // הסדר הוא סדר הדחיפות ולא סדר המסלולים: ב-RTL הפריט הראשון יושב מימין,
  // ושתי השאלות שדורשות פעולה — כמה בקשות פתוחות וכמה הטבות נגמרות — הן
  // הראשונות שהעין פוגשת.
  const stats = [
    { key: 'pending',         n: ov.pending,         label: 'בקשות פתוחות', urgent: true },
    { key: 'promo_ending_30', n: ov.promo_ending_30, label: 'הטבות שנגמרות החודש', hot: true },
    { key: 'promo_active',    n: ov.promo_active,    label: 'בתוך ההטבה' },
    { key: 'premium',         n: ov.premium,         label: Tiers.label('premium') },
    { key: 'mid',             n: ov.mid,             label: Tiers.label('mid') },
    { key: 'free',            n: ov.free,            label: Tiers.label('free') },
  ];
  // כל מספר פותח את הרשימה השמית שמאחוריו — "11 Elite" בלי "מי" הוא מספר
  // שאי אפשר לעשות איתו כלום, ועד היום התשובה הזו הצריכה SQL Editor.
  // ‏"בקשות פתוחות" הוא היוצא מן הכלל: הרשימה שלו כבר למטה, עם כפתורי
  // האישור, ולכן הוא קופץ אליה במקום לצייר אותה פעם שנייה.
  ovHost.innerHTML = stats.map(s => {
    const n = Number(s.n || 0);
    const isPending = s.key === 'pending';
    const open = !isPending && s.key === subsDrillBucket && n > 0;
    const cls = 'subs-stat'
      + (n > 0 && s.urgent ? ' is-urgent' : (n > 0 && s.hot ? ' is-hot' : ''))
      + (open ? ' is-open' : '');
    return `<button type="button" class="${cls}" data-bucket="${esc(s.key)}"${n ? '' : ' disabled'}
              aria-controls="${isPending ? 'subsRequests' : 'subsDrill'}"${
              isPending ? '' : ` aria-expanded="${open ? 'true' : 'false'}"`}>
        <b>${n.toLocaleString('he-IL')}</b><span>${esc(s.label)}</span>${
        n > 0 && s.urgent ? '<em class="ss-flag">דורש טיפול</em>' : ''}
      </button>`;
  }).join('');

  // מאזין אחד על המכולה ולא על הכפתורים: ‏ovHost שורד את הרינדור מחדש,
  // והכפתורים לא — מאזין לכל כפתור היה מצטבר בכל רענון של הקטגוריה.
  if (!ovHost.dataset.wired){
    ovHost.dataset.wired = '1';
    ovHost.addEventListener('click', ev => {
      const btn = ev.target.closest('.subs-stat');
      if (!btn || btn.disabled) return;
      if (btn.dataset.bucket === 'pending'){ flashPendingRequests(); return; }
      toggleSubsDrill(btn.dataset.bucket);
    });
  }

  // רשימה שהייתה פתוחה לפני הרענון נפתחת מחדש: אחרי אישור בקשה המספרים
  // משתנים, והרשימה שממנה יצאנו היא בדיוק זו שרוצים לראות מעודכנת. אם
  // הקטגוריה התרוקנה בינתיים היא נסגרת — מספר אפס אינו לחיץ, ורשימה ריקה
  // שנשארת פתוחה מתחת לכפתור שכבר אינו מסומן היא בדיוק סוג הדבר שמבלבל.
  if (subsDrillBucket){
    const still = stats.find(x => x.key === subsDrillBucket);
    if (still && Number(still.n || 0) > 0) renderSubsDrill(subsDrillBucket);
    else closeSubsDrill();
  }

  // ---- תור הבקשות ----
  if (reqErr){
    reqHost.innerHTML = '<div class="empty-state">שגיאה בטעינת הבקשות: ' + esc(reqErr.message) + '</div>';
    return;
  }
  const rows = requests || [];
  accSetCount('accSubscriptions', rows.length || '');

  if (!rows.length){
    reqHost.innerHTML = '<div class="empty-state">אין בקשות שדרוג פתוחות.</div>';
  } else {
    reqHost.innerHTML = rows.map(r => {
      const price = Tiers.byId(r.wanted_tier)?.priceMonthly || 0;
      // המייל מוכן מראש עם השם והמסלול: הפעולה האמיתית כאן היא שיחה עם
      // אדם על תשלום, והמסך צריך להוביל אליה ולא רק לעדכן עמודה.
      const mail = 'mailto:' + encodeURIComponent(r.member_email || '') +
        '?subject=' + encodeURIComponent(`שדרוג ל-${Tiers.label(r.wanted_tier)} - שוק נדל״ן`) +
        '&body=' + encodeURIComponent(
          `שלום ${r.member_name || ''},\n\nקיבלנו את בקשתך לעבור למסלול ${Tiers.label(r.wanted_tier)} ` +
          `(₪${price} לחודש + מע״מ).\n\n`);
      return `
      <div class="subs-req" data-member="${esc(r.member)}" data-tier="${esc(r.wanted_tier)}">
        <div class="sr-top">
          <span class="sr-name">${esc(r.member_name || 'סוכן/ת')}</span>
          <!-- "מ-X ל-Y" ולא "X ← Y": ב-RTL חץ בין שני שמות נקרא לשני
               הכיוונים, ופה ההבדל הוא בין שדרוג לירידה. -->
          <span class="sr-move">מ-${esc(Tiers.label(r.now_tier))} ל-<b>${esc(Tiers.label(r.wanted_tier))}</b>
            ${price ? '· ₪' + price.toLocaleString('he-IL') + ' לחודש' : ''}</span>
        </div>
        <div class="sr-meta">
          ${esc(r.agency_name || 'ללא משרד')}
          ${r.asked_on ? ' · הבקשה מ-' + esc(hebDate(r.asked_on)) : ''}
          ${r.member_email ? ' · <span style="direction:ltr;display:inline-block">' + esc(r.member_email) + '</span>' : ''}
          · יתרת ארנק ${shekel(r.wallet_balance || 0)}
        </div>
        <div class="sr-acts">
          <button type="button" class="btn btn-gold subsApproveBtn">אישור והחלה</button>
          <button type="button" class="btn btn-ghost subsRejectBtn">דחייה</button>
          ${r.member_email ? `<a class="sr-mail" href="${mail}">מייל לסוכן/ת ←</a>` : ''}
        </div>
      </div>`;
    }).join('');

    reqHost.querySelectorAll('.subsApproveBtn').forEach(btn => btn.addEventListener('click', async ()=>{
      const card = btn.closest('[data-member]');
      const tier = card.dataset.tier;
      const name = card.querySelector('.sr-name').textContent;
      // ‏requireAck: זו החלטה כספית. תיבת הסימון היא מה שהופך לחיצה מהירה
      // להחלטה, בדיוק כמו ברכישות ובהשעיית סוכן/ת.
      const okToGo = await confirmPurchase({
        title: 'אישור מסלול ' + Tiers.label(tier),
        lines: [`${name} יעבור/תעבור למסלול ${Tiers.label(tier)} מיד עם האישור.`,
                'המסלול נכנס לתוקף עכשיו, והחיוב מוסדר מחוץ למערכת.'],
        price: 0, hidePrice: true, requireAck: true,
        ackText: 'התשלום הוסדר.', confirmLabel: 'אישור המסלול',
      });
      if (!okToGo) return;
      btn.disabled = true;
      const { data, error } = await sb.rpc('admin_apply_tier_change', {
        p_member_id: card.dataset.member, p_tier: tier, p_note: null,
      });
      if (error || data?.error){
        showToast('שגיאה: ' + (data?.error || error.message));
        btn.disabled = false;
        return;
      }
      showToast(`${data.name || name} עבר/ה ל-${Tiers.label(data.to_tier)}`);
      await loadSubscriptionsAdmin();
    }));

    reqHost.querySelectorAll('.subsRejectBtn').forEach(btn => btn.addEventListener('click', async ()=>{
      const card = btn.closest('[data-member]');
      // נימוק חובה: הדחייה נרשמת ביומן, ושורה בלי סיבה לא עונה על השאלה
      // שנשאלת עליה חודש אחר כך.
      const reason = prompt('סיבת הדחייה (נרשמת ביומן):');
      if (!reason || !reason.trim()) return;
      btn.disabled = true;
      const { data, error } = await sb.rpc('admin_reject_tier_change', {
        p_member_id: card.dataset.member, p_note: reason.trim(),
      });
      if (error || data?.error){
        showToast('שגיאה: ' + (data?.error || error.message));
        btn.disabled = false;
        return;
      }
      showToast('הבקשה נדחתה ונרשמה ביומן');
      await loadSubscriptionsAdmin();
    }));
  }

  // ---- היומן ----
  const SRC_LABELS = {
    launch_promo:           'הטבת השקה',
    launch_promo_accepted:  'אישור ההטבה',
    self:                   'בחירה עצמית',
    platform_admin:         'אישור הנהלה',
    promo_expired:          'תום ההטבה',
    requested:              'בקשת שדרוג',
    request_rejected:       'בקשה נדחתה',
  };
  const entries = log || [];
  logHost.innerHTML = entries.length
    ? entries.map(e => `
      <div class="subs-log-row">
        <span>
          <b>${esc(e.member_name || '')}</b>
          ${e.was_tier && e.was_tier !== e.became_tier
              ? 'מ-' + esc(Tiers.label(e.was_tier)) + ' ל-' + esc(Tiers.label(e.became_tier))
              : esc(Tiers.label(e.became_tier))}
          <span style="color:var(--ink-soft)">· ${esc(SRC_LABELS[e.change_src] || e.change_src)}</span>
        </span>
        <span class="sl-when">${esc(hebDate(e.changed_on))}</span>
      </div>`).join('')
    : '<div class="empty-state">אין עדיין שינויי מסלול.</div>';
}

/* ----------------------------------------------------------------------------
   הרשימה שמאחורי המספר
   ----------------------------------------------------------------------------
   לחיצה שנייה על אותו מספר סוגרת. מסך הניהול ארוך, ורשימה של אחד־עשר שמות
   שנשארת פתוחה דוחפת את תור הבקשות אל מחוץ למסך.

   ‏subscription_members מסננת בדיוק באותם תנאים של subscription_overview —
   אחרת מספר שנלחץ ורשימה שנפתחת היו סותרים זה את זה.                        */

const SUBS_BUCKET_WHAT = {
  free:            () => 'במסלול ' + Tiers.label('free'),
  mid:             () => 'במסלול ' + Tiers.label('mid'),
  premium:         () => 'במסלול ' + Tiers.label('premium'),
  promo_active:    () => 'בתוך תקופת ההטבה',
  promo_ending_30: () => 'שההטבה שלהם נגמרת החודש',
};

function subsStatButtons(){
  return document.querySelectorAll('#subsOverview .subs-stat');
}

function toggleSubsDrill(bucket){
  if (subsDrillBucket === bucket){ closeSubsDrill(); return; }
  subsDrillBucket = bucket;
  subsStatButtons().forEach(b => {
    const on = b.dataset.bucket === bucket;
    b.classList.toggle('is-open', on);
    if (b.dataset.bucket !== 'pending') b.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
  renderSubsDrill(bucket);
}

function closeSubsDrill(){
  subsDrillBucket = null;
  const host = document.getElementById('subsDrill');
  if (host){ host.hidden = true; host.innerHTML = ''; }
  subsStatButtons().forEach(b => {
    b.classList.remove('is-open');
    if (b.dataset.bucket !== 'pending') b.setAttribute('aria-expanded', 'false');
  });
}

async function renderSubsDrill(bucket){
  const host = document.getElementById('subsDrill');
  if (!host) return;
  host.hidden = false;
  host.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb.rpc('subscription_members', { p_bucket: bucket });
  // תשובה שחזרה אחרי שנלחץ מספר אחר לא תדרוס את הרשימה שמוצגת עכשיו.
  if (subsDrillBucket !== bucket) return;
  if (error){
    host.innerHTML = '<div class="empty-state">שגיאה בטעינת הרשימה: ' + esc(error.message) + '</div>';
    return;
  }

  const rows = data || [];
  const what = (SUBS_BUCKET_WHAT[bucket] || (() => ''))();
  const count = plural(rows.length, 'סוכן/ת אחד/ת', 'סוכנים/ות', rows.length.toLocaleString('he-IL'));
  const head = `
    <div class="sd-head">
      <b>${esc(count)} ${esc(what)}</b>
      <button type="button" class="sd-close" id="subsDrillClose">סגירה ✕</button>
    </div>`;

  host.innerHTML = head + (rows.length ? rows.map(r => {
    // השורה עונה על שלוש השאלות שנשאלות מיד אחרי "מי": באיזה משרד, איך
    // יוצרים קשר, ומתי זה נגמר. בלעדיהן צריך לחזור למסד בשביל כל שם.
    const meta = [
      esc(r.agency_name || 'ללא משרד'),
      r.member_email ? '<span style="direction:ltr;display:inline-block">' + esc(r.member_email) + '</span>' : '',
      r.promo_ends ? 'ההטבה נגמרת ב-' + esc(hebDate(r.promo_ends)) : '',
      r.wanted_tier ? 'ביקש/ה ' + esc(Tiers.label(r.wanted_tier)) : '',
      'יתרת ארנק ' + esc(shekel(r.wallet_balance || 0)),
    ].filter(Boolean).join(' · ');
    return `
      <div class="sd-row">
        <div>
          <a class="sd-name" href="agent.html?slug=${esc(encodeURIComponent(r.member_slug || ''))}"
             target="_blank" rel="noopener">${esc(r.member_name || 'סוכן/ת')}</a>
          <div class="sd-meta">${meta}</div>
        </div>
        <span class="sd-tier">${esc(Tiers.label(r.now_tier))}</span>
      </div>`;
  }).join('') : '<div class="empty-state">אין כרגע אף אחד/ת בקטגוריה הזו.</div>');

  const closeBtn = document.getElementById('subsDrillClose');
  if (closeBtn) closeBtn.addEventListener('click', closeSubsDrill);
}

/* ‏"בקשות פתוחות" הוא קיצור דרך ולא רשימה נוספת: תור הבקשות, עם כפתורי
   האישור והדחייה, כבר יושב מתחת לתמונת המצב. ההדגשה הרגעית היא מה שמונע
   את ההרגשה שהלחיצה לא עשתה כלום כשהתור כבר נראה על המסך. */
function flashPendingRequests(){
  const host = document.getElementById('subsRequests');
  if (!host) return;
  closeSubsDrill();
  host.scrollIntoView({ behavior: 'smooth', block: 'center' });
  host.classList.remove('subs-flash');
  void host.offsetWidth;          // הפעלת האנימציה מחדש גם בלחיצה רצופה
  host.classList.add('subs-flash');
  setTimeout(() => host.classList.remove('subs-flash'), 1600);
}

const toggleBillingBtn = document.getElementById('toggleBillingHistory');
const billingHistoryList = document.getElementById('billingHistoryList');
toggleBillingBtn.addEventListener('click', async ()=>{
  const showing = billingHistoryList.style.display !== 'none';
  billingHistoryList.style.display = showing ? 'none' : 'block';
  toggleBillingBtn.textContent = showing ? 'הצגת היסטוריית חיובים' : 'הסתרת היסטוריית חיובים';
  if (!showing) await loadBillingHistory();
});

async function loadBillingHistory(){
  billingHistoryList.innerHTML = '<div class="empty-state">טוען…</div>';
  const [{ data: charges }, { data: promotions }, { data: topups }, { data: shelfPurchases }, { data: mortgagePurchases }, { data: refunds }] = await Promise.all([
    sb.from('lead_charges').select('amount, status, created_at').eq('agent_id', currentAgent.id).order('created_at', { ascending:false }).limit(10),
    sb.from('promotion_charges').select('amount, status, created_at').eq('agent_id', currentAgent.id).order('created_at', { ascending:false }).limit(10),
    sb.from('wallet_topups').select('amount, status, test_mode, created_at').eq('agent_id', currentAgent.id).order('created_at', { ascending:false }).limit(10),
    sb.from('rss_lead_purchases').select('amount, status, created_at').eq('agent_id', currentAgent.id).order('created_at', { ascending:false }).limit(10),
    sb.from('mortgage_lead_purchases').select('amount, status, created_at').eq('agent_id', currentAgent.id).order('created_at', { ascending:false }).limit(10),
    sb.from('wallet_refunds').select('amount, status, requested_at').eq('agent_id', currentAgent.id).order('requested_at', { ascending:false }).limit(10),
  ]);
  const items = [
    ...(charges||[]).map(c=>({ label:'פתיחת ליד', amount: -c.amount, status: c.status, date: c.created_at })),
    ...(promotions||[]).map(p=>({ label:'קידום נכס', amount: -p.amount, status: p.status, date: p.created_at })),
    // טעינה עשויה להיות תלויה או כושלת, ולא רק מוצלחת. בלי הסימון הזה שורת
    // 'pending' נראית זהה לטעינה שנכנסה — כלומר הסוכן/ת סופר/ת כסף שאין.
    ...(topups||[]).map(t=>({
      label:'טעינת ארנק' + (t.test_mode ? ' (בדיקה)' : '') +
            (t.status === 'pending' ? ' - ממתין לתשלום' :
             t.status === 'failed'  ? ' - לא הושלמה' : ''),
      amount: t.amount, status: t.status, date: t.created_at,
      settled: t.status === 'success',
    })),
    ...(shelfPurchases||[]).map(p=>({ label:'רכישת ליד מהחנות', amount: -p.amount, status: p.status, date: p.created_at })),
    ...(mortgagePurchases||[]).map(p=>({ label:'רכישת ליד משכנתאות', amount: -p.amount, status: p.status, date: p.created_at })),
    // בקשה שנדחתה או בוטלה החזירה את היתרה, ולכן היא אינה תנועה כספית —
    // מוצגת דהויה כרשומה היסטורית בלבד, כמו טעינה שלא הושלמה.
    ...(refunds||[]).map(r=>({
      label:'החזר יתרה' +
            (r.status === 'requested' ? ' - בטיפול' :
             r.status === 'rejected'  ? ' - נדחתה' :
             r.status === 'cancelled' ? ' - בוטלה' : ''),
      amount: -r.amount, status: r.status, date: r.requested_at,
      settled: r.status === 'requested' || r.status === 'completed',
    })),
  ].sort((a,b)=> new Date(b.date) - new Date(a.date));

  if (items.length === 0){ billingHistoryList.innerHTML = '<div class="empty-state">אין עדיין היסטוריית חיובים.</div>'; return; }
  /* שורה שלא נסגרה מוצגת דהויה ובלי צבע של סכום שנכנס. ‏settled מוגדר רק
     על טעינות; לכל שאר הסוגים הוא undefined, והם נשארים כפי שהיו. */
  billingHistoryList.innerHTML = items.map(it => {
    const unsettled = it.settled === false;
    const color = unsettled ? 'var(--muted)' : (it.amount<0 ? 'var(--red)' : 'var(--blue)');
    return `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:.82rem${unsettled?';opacity:.6':''}">
      <span>${it.label}</span>
      <span style="font-weight:700;color:${color}">${unsettled?'':(it.amount<0?'-':'+')}₪${Math.abs(it.amount)}</span>
    </div>`;
  }).join('');
}

/* ---------- Planning lookup tool: clean fields + parcel map (not raw JSON) ---------- */
let planningMap = null;
document.getElementById('planLookupBtn').addEventListener('click', async ()=>{
  /* אותו תיקון כתיב כמו בטופס הנכס, ובלי חסימה: הכלי הזה הוא בדיקה ולא
     שמירה, ולמי שהכתיב שלו עקשן יש ממילא את מסלול גוש+חלקה שאינו עובר דרך
     שכבת הכתובות. מה שכן — "העליה" שברשימה כתובה "עלייה" יישלח כ-"עלייה",
     במקום לחזור עם 404 שנראה כמו כתובת שאינה קיימת. */
  const street = canonicalStreet(document.getElementById('planStreet').value, STREET_PLANNING_CITY).name;
  document.getElementById('planStreet').value = street;
  const houseNum = document.getElementById('planHouseNum').value.trim();
  const gush = document.getElementById('planGush').value.trim();
  const helka = document.getElementById('planHelka').value.trim();
  const feedback = document.getElementById('planFeedback');
  const btn = document.getElementById('planLookupBtn');
  const upgradeNotice = document.getElementById('planUpgradeNotice');
  const resultPanel = document.getElementById('planResultPanel');

  upgradeNotice.style.display = 'none';
  resultPanel.style.display = 'none';
  feedback.textContent = '';

  const body = (gush && helka) ? { gush, helka } : { street, house_number: houseNum };
  if (!(gush && helka) && !(street && houseNum)){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'נא למלא כתובת (רחוב+מספר) או גוש+חלקה';
    return;
  }

  btn.disabled = true; btn.textContent = 'בודק…';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/afula-planning-lookup', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.status === 402 || data.error === 'upgrade_required'){
      upgradeNotice.style.display = 'block';
      return;
    }
    if (!res.ok || data.error){
      const messages = {
        address_not_found: 'לא נמצאה כתובת מתאימה במערכת ה-GIS של העירייה',
        parcel_not_found: 'לא נמצאה חלקה תואמת לגוש/חלקה שהוזנו',
      };
      feedback.style.color = 'var(--red)';
      feedback.textContent = messages[data.error] || ('שגיאה: ' + (data.detail || data.error));
      return;
    }

    renderPlanningResult(data.data);
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
  } finally {
    btn.disabled = false; btn.textContent = 'בדיקת מידע תכנוני';
  }
});

function renderPlanningResult(d){
  const fieldsEl = document.getElementById('planFields');
  const plansEl = document.getElementById('planPlansList');
  const resultPanel = document.getElementById('planResultPanel');

  const fields = [
    ['גוש', d.gush || '-'],
    ['חלקה', d.helka || '-'],
    ['שטח חלקה (מ"ר)', d.parcel_area_sqm ? Math.round(d.parcel_area_sqm).toLocaleString('he-IL') : '-'],
    ['סטטוס חלקה', d.parcel_status || '-'],
    ['ייעוד קרקע', d.land_use_designation || '-'],
    ['עדכון אחרון', d.looked_up_at ? new Date(d.looked_up_at).toLocaleDateString('he-IL') : '-'],
  ];
  fieldsEl.innerHTML = fields.map(([label, value]) => `
    <div style="background:var(--paper);border-radius:var(--radius-sm);padding:10px 12px">
      <div style="font-size:.7rem;color:var(--ink-soft);font-weight:700">${label}</div>
      <div style="font-size:.9rem;margin-top:2px">${value}</div>
    </div>`).join('');

  const plans = d.applicable_plans || [];
  plansEl.innerHTML = plans.length
    ? `<div style="font-size:.75rem;font-weight:700;color:var(--ink-soft);margin-bottom:6px">תוכניות תכנון החלות על החלקה (${plans.length})</div>` +
      plans.map(p => `<div style="font-size:.82rem;padding:6px 0;border-bottom:1px solid var(--line)">${p.number || '-'}${p.description ? ' · ' + p.description : ''}</div>`).join('')
    : '<div style="font-size:.8rem;color:var(--ink-soft)">לא נמצאו תוכניות תכנון החלות על החלקה</div>';

  resultPanel.style.display = 'block';

  // מפת החלקה — נבנית מחדש בכל חיפוש (Leaflet לא תומך ביצירה כפולה על אותו div)
  const mapEl = document.getElementById('planMap');
  if (planningMap){ planningMap.remove(); planningMap = null; }
  if (!window.L || !d.lat || !d.lng){ mapEl.style.display = 'none'; return; }
  mapEl.style.display = 'block';

  /* מפה בגובה 280px בתוך פאנל נגלל היא מלכודת גלילה: הגלגלת מעליה הייתה
     מקרבת אותה במקום להמשיך בדף, ובמובייל אצבע אחת הזיזה אותה. ההדלקה לפי
     focus שהייתה כאן לא פתרה את זה אלא דחתה: ‏Leaflet יורה focus על *לחיצה*
     במפה, ומאותו רגע הגלגלת שוב קירבה במקום לגלול. ‏MapGestures מטפל בשתי
     המחוות — אצבע אחת וגלגלת לבדה גוללות, שתי אצבעות ו-Ctrl/⌘ + גלגלת
     מזיזות ומקרבות. */
  planningMap = L.map('planMap', { scrollWheelZoom:false }).setView([d.lat, d.lng], 18);
  if (window.MapGestures) MapGestures.apply(planningMap);
  /* זום 20 גבוה מהזום הטבעי של חלק מהספקים; MapTiles מגדיר maxNativeZoom
     בהתאם, ולכן מפת התכנון ממשיכה להתקרב במקום להציג ריבועים ריקים. */
  MapTiles.addTo(planningMap, { maxZoom:20 });

  if (d.geometry_wgs84){
    try{
      const geoLayer = L.geoJSON(d.geometry_wgs84, {
        style: { color:'#8B2332', weight:2, fillColor:'#8B2332', fillOpacity:0.15 }
      }).addTo(planningMap);
      planningMap.fitBounds(geoLayer.getBounds(), { padding:[20,20] });
    } catch(e){
      console.warn('לא ניתן היה לצייר את גבולות החלקה:', e);
      L.marker([d.lat, d.lng]).addTo(planningMap);
    }
  } else {
    L.marker([d.lat, d.lng]).addTo(planningMap);
  }
}

/* ---------- Office branding (manager only) ----------
   מנהל המשרד שולט כאן על מה שלקוח רואה ב-agency.html: ערכת צבעים, לוגו,
   תמונת נושא וגלריית תמונות המשרד. הכל נשמר בשורת ה-agencies של המשרד
   (colors / logo_url / cover_url / gallery), שה-RLS מרשה רק למנהל לעדכן.  */

const BRANDING_BUCKET = 'property-images'; // אותו bucket ציבורי; הנתיב מפריד בין נכסים למיתוג
const MAX_GALLERY_IMAGES = 24;

// ארבע ערכות שגורות בענף הנדל״ן. כל ערכה מגדירה את מלוא הטוקנים שדף המשרד
// צורך, כדי שהחלפה תיתן עיצוב שלם ולא רק כותרת בצבע אחר.
const BRAND_PALETTES = [
  { id:'navy_gold', name:'נייבי וזהב', desc:'קלאסי ויוקרתי - ברירת המחדל של הענף',
    primary:'#1c3a5e', primary_dark:'#122840', accent:'#c0912f', accent_dark:'#8e6a1e',
    paper:'#edeae3', paper_raised:'#fbfaf7', line:'#d6d1c6' },
  { id:'emerald_stone', name:'אמרלד ואבן', desc:'בוטיק ירוק - נכסי יוקרה ופרויקטים',
    primary:'#14513f', primary_dark:'#0c3729', accent:'#a97f45', accent_dark:'#7e5d2e',
    paper:'#e9ede9', paper_raised:'#f8faf8', line:'#cbd5cc' },
  { id:'terracotta_sand', name:'טרהקוטה וחול', desc:'ים־תיכוני וחם - וילות ובתים פרטיים',
    primary:'#8f3d22', primary_dark:'#6b2b16', accent:'#2c6e6b', accent_dark:'#1d504e',
    paper:'#f0e9e1', paper_raised:'#fdfaf6', line:'#dfd1c2' },
  { id:'graphite_copper', name:'גרפיט ונחושת', desc:'אורבני ומודרני - דירות בעיר ומשרדים',
    primary:'#2e3440', primary_dark:'#1d222b', accent:'#b35c31', accent_dark:'#8a4522',
    paper:'#eaeaec', paper_raised:'#fafafb', line:'#d2d3d8' },
];

const BRAND_COLOR_KEYS = ['primary','primary_dark','accent','accent_dark','paper','paper_raised','line'];
const BRAND_COLOR_INPUTS = {
  primary:'brColorPrimary', primary_dark:'brColorPrimaryDark',
  accent:'brColorAccent', accent_dark:'brColorAccentDark',
  paper:'brColorPaper', paper_raised:'brColorPaperRaised', line:'brColorLine',
};

let brandingState = null; // { agencyName, agencySlug, palette, colors, logo, cover, gallery, pendingDeletes }

// תמיד מחזיר hex באותיות קטנות — matchPalette משווה מחרוזות, ו-input[type=color]
// ממילא מחזיר ערכים בכתיב קטן, אז ערבוב רישיות היה מפספס התאמות
function normalizeHex(value, fallback){
  const fb = typeof fallback === 'string' ? fallback.toLowerCase() : fallback;
  if (typeof value !== 'string') return fb;
  let v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v.slice(1).split('').map(c=>c+c).join('');
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fb;
}

// יחס ניגודיות WCAG — משמש רק לאזהרה למנהל, לא לחסימה
function relativeLuminance(hex){
  const channels = [1,3,5].map(i=>{
    const c = parseInt(hex.slice(i, i+2), 16) / 255;
    return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  });
  return 0.2126*channels[0] + 0.7152*channels[1] + 0.0722*channels[2];
}
function contrastRatio(a, b){
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la,lb) + 0.05) / (Math.min(la,lb) + 0.05);
}
/* צבע הטקסט שרץ *על* גוון המשרד — בכפתורי ה-CTA, בכותרות הבאנרים ובתגיות.
   הכלל חייב להיות זהה בדיוק לזה של agency.html (‏readableOn שם), אחרת
   התצוגה המקדימה כאן מבטיחה משהו אחר ממה שהלקוח יראה בדף עצמו: מעדיפים
   את הצבע שעובר 4.5:1 — הסף של WCAG לטקסט רגיל, וה-CTA ב-‎.82rem‎ מודגש
   הוא טקסט רגיל — כשגם וגם, הלבן מנצח, וכשאף אחד לא עובר נבחר הגבוה. */
const ON_COLOR_INK = '#1b1f26';
function readableOn(hex){
  const onWhite = contrastRatio(hex, '#ffffff');
  const onInk = contrastRatio(hex, ON_COLOR_INK);
  if (onWhite >= 4.5) return '#ffffff';
  if (onInk >= 4.5) return ON_COLOR_INK;
  return onWhite >= onInk ? '#ffffff' : ON_COLOR_INK;
}

async function loadBranding(agencyId){
  const { data: agency, error } = await sb.from('agencies')
    .select('name, slug, tagline, address, specialties, logo_url, cover_url, colors, gallery').eq('id', agencyId).single();
  if (error || !agency){
    document.getElementById('brFeedback').textContent = 'לא ניתן לטעון את הגדרות המיתוג.';
    return;
  }
  const stored = agency.colors || {};
  const base = BRAND_PALETTES[0];
  const colors = {};
  BRAND_COLOR_KEYS.forEach(k => { colors[k] = normalizeHex(stored[k], base[k]); });

  brandingState = {
    agencyName: agency.name,
    agencySlug: agency.slug,
    palette: stored.palette || matchPalette(colors) || 'custom',
    colors,
    pageBg: normalizePageBg(stored.page_bg),
    logo:  agency.logo_url  ? { url: agency.logo_url }  : null,
    cover: agency.cover_url ? { url: agency.cover_url } : null,
    gallery: (Array.isArray(agency.gallery) ? agency.gallery : [])
      .filter(g => g && g.url)
      .map(g => ({ url: g.url, caption: g.caption || '' })),
    specialties: window.Specialties ? Specialties.resolve(agency.specialties) : [],
    pendingDeletes: [],
  };

  document.getElementById('brTagline').value = agency.tagline || '';
  renderTaglineCount();
  document.getElementById('brAddress').value = agency.address || '';
  document.getElementById('brViewPageLink').href = 'agency.html?slug=' + encodeURIComponent(agency.slug);
  renderPaletteGrid();
  renderBgChoice();
  syncColorInputs();
  renderBrandImages();
  renderGalleryAdmin();
  renderSpecialtyPicker();
  loadSpecialtySuggestion(agencyId);
  renderBrandPreview();
}

/* ---------- תחומי ההתמחות ----------
   הבחירה נשמרת בשורת המשרד ומוצגת כתגיות בראש דף המשרד. הרשימה עצמה
   יושבת ב-assets/specialties.js, כדי שהיא תהיה זהה כאן, בטופס פתיחת המשרד
   ובדף הציבורי. */
function renderSpecialtyPicker(){
  const grid = document.getElementById('brSpecGrid');
  if (!grid || !window.Specialties || !brandingState) return;
  const chosen = brandingState.specialties;
  const full = chosen.length >= Specialties.MAX_SELECTED;

  document.getElementById('brSpecMax').textContent = Specialties.MAX_SELECTED;
  document.getElementById('brSpecCount').textContent = chosen.length;

  grid.textContent = '';
  Specialties.list().forEach(item=>{
    const on = chosen.includes(item.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spec-opt' + (on ? ' on' : '');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // התקרה נאכפת גם במסד; כאן היא רק מונעת קליק שייכשל בשמירה
    if (!on && full) btn.disabled = true;
    btn.innerHTML = `<span class="ic">${Specialties.iconFor(item.id)}</span>
      <span style="min-width:0"><span class="nm">${esc(item.label)}</span>
      <span class="ds" style="display:block">${esc(item.hint)}</span></span>`;
    btn.addEventListener('click', ()=> toggleSpecialty(item.id));
    grid.appendChild(btn);
  });
}

function toggleSpecialty(id){
  const chosen = brandingState.specialties;
  const at = chosen.indexOf(id);
  if (at >= 0) chosen.splice(at, 1);
  else if (chosen.length < Specialties.MAX_SELECTED) chosen.push(id);
  renderSpecialtyPicker();
  renderBrandPreview();
}

/* מה שהמערכת רואה בנכסים של המשרד בפועל. זו הצעה ולא קביעה: תגית היא
   הצהרה מקצועית של המשרד, ומודעה בודדת לא הופכת אותו למומחה לקרקעות. כל עוד
   לא נבחר דבר, הדף הציבורי ממילא מציג את הגזירה הזאת — וההצעה כאן היא
   ההזדמנות להחליף אותה בבחירה מודעת. */
async function loadSpecialtySuggestion(agencyId){
  const box = document.getElementById('brSpecSuggest');
  if (!box || !window.Specialties) return;
  const { data: props } = await sb.from('properties')
    .select('property_type, deal_type, category')
    .eq('agency_id', agencyId).eq('status', 'active').limit(200);
  const suggested = Specialties.derive(props || []).ids
    .filter(id => !brandingState.specialties.includes(id));
  if (!suggested.length){ box.style.display = 'none'; return; }

  const labels = suggested.map(id => Specialties.byId(id).label);
  box.textContent = '';
  const text = document.createElement('span');
  text.innerHTML = 'לפי הנכסים הפעילים במשרד נראה שאתם עוסקים גם ב<b>' +
    labels.map(esc).join('</b>, <b>') + '</b>. ';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'להוסיף לתחומים שלי';
  add.addEventListener('click', ()=>{
    suggested.forEach(id=>{
      if (!brandingState.specialties.includes(id) && brandingState.specialties.length < Specialties.MAX_SELECTED){
        brandingState.specialties.push(id);
      }
    });
    renderSpecialtyPicker();
    renderBrandPreview();
    loadSpecialtySuggestion(agencyId);
  });
  box.appendChild(text);
  box.appendChild(add);
  box.style.display = 'block';
}

// ערכה נחשבת "נבחרת" רק אם כל הטוקנים תואמים — אחרת זו התאמה אישית
function matchPalette(colors){
  const hit = BRAND_PALETTES.find(p => BRAND_COLOR_KEYS.every(k => p[k] === colors[k]));
  return hit ? hit.id : null;
}

function renderPaletteGrid(){
  const grid = document.getElementById('paletteGrid');
  grid.textContent = '';
  BRAND_PALETTES.forEach(p=>{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'palette-card' + (brandingState.palette === p.id ? ' active' : '');
    card.innerHTML = `<div class="palette-swatches">
        <span style="background:${p.primary_dark}"></span>
        <span style="background:${p.primary}"></span>
        <span style="background:${p.accent}"></span>
        <span style="background:${p.paper}"></span>
      </div>
      <div><div class="pname">${p.name}</div><div class="pdesc">${p.desc}</div></div>`;
    card.addEventListener('click', ()=> applyPalette(p.id));
    grid.appendChild(card);
  });
}

function applyPalette(paletteId){
  const p = BRAND_PALETTES.find(x => x.id === paletteId);
  if (!p) return;
  brandingState.palette = p.id;
  BRAND_COLOR_KEYS.forEach(k => { brandingState.colors[k] = p[k]; });
  renderPaletteGrid();
  syncColorInputs();
  renderBrandPreview();
}

function syncColorInputs(){
  BRAND_COLOR_KEYS.forEach(k=>{
    document.getElementById(BRAND_COLOR_INPUTS[k]).value = brandingState.colors[k];
  });
}

/* ---------- רקע דף המשרד ----------
   שתי אפשרויות, ולכן שני כרטיסים שמראים את הרקע עצמו במקום שני שמות.
   'flow' הוא ברירת המחדל של האתר וגם הערך שנשמר כשבוחרים בו במפורש;
   'plain' מכבה את שכבת הרקע ומשאיר את צבע הנייר של ערכת המשרד. שורה בלי
   ערך כלל (כל המשרדים שנפתחו לפני השינוי) מתנהגת כמו 'flow'.

   הערך נשמר בתוך ‎colors‎ ולא בעמודה משלו: ‏colors היא כבר ה-blob של "איך
   דף המשרד נראה", היא נטענת ונשמרת ביחידה אחת כאן, ו-agency.html שולף
   אותה ב-select('*'). ראו supabase/migrations/20260914091000_page_background.sql. */
const PAGE_BG_DEFAULT = 'flow';
const PAGE_BG_OPTIONS = [
  { id:'flow',  name:'הרקע של האתר (ברירת מחדל)', desc:'שמש, קו רקיע וגלים שזורמים עם הגלילה - כמו בדף הבית' },
  { id:'plain', name:'רקע חלק',                    desc:'צבע נייר אחיד לפי הערכה שבחרתם, בלי תנועה' },
];

function normalizePageBg(value){
  return value === 'plain' ? 'plain' : PAGE_BG_DEFAULT;
}

function renderBgChoice(){
  const box = document.getElementById('brBgChoice');
  if (!box || !brandingState) return;
  box.textContent = '';
  PAGE_BG_OPTIONS.forEach(opt=>{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bg-card' + (brandingState.pageBg === opt.id ? ' active' : '');
    card.setAttribute('aria-pressed', brandingState.pageBg === opt.id ? 'true' : 'false');
    card.innerHTML = `<div class="bg-thumb ${opt.id}"></div>
      <div><div class="bname">${opt.name}</div><div class="bdesc">${opt.desc}</div></div>`;
    card.addEventListener('click', ()=>{
      brandingState.pageBg = opt.id;
      renderBgChoice();
    });
    box.appendChild(card);
  });
}

/* אורך המוטו — הגבול שמעבר לו הוא נחתך בדף המשרד (שורה אחת מתחת לשם).
   אותו מספר יושב ב-maxlength של השדה, במונה שלצדו ובחיתוך שלפני השמירה. */
const AGENCY_TAGLINE_MAX = 60;

function renderTaglineCount(){
  const input = document.getElementById('brTagline');
  const out = document.getElementById('brTaglineCount');
  if (!input || !out) return;
  out.textContent = `· ${input.value.trim().length}/${AGENCY_TAGLINE_MAX}`;
}

// המוטו נראה עכשיו בתצוגה המקדימה, ולכן הוא מתעדכן תוך כדי הקלדה
document.getElementById('brTagline').addEventListener('input', ()=>{
  renderTaglineCount();
  if (brandingState) renderBrandPreview();
});

BRAND_COLOR_KEYS.forEach(k=>{
  document.getElementById(BRAND_COLOR_INPUTS[k]).addEventListener('input', (e)=>{
    if (!brandingState) return;
    brandingState.colors[k] = normalizeHex(e.target.value, brandingState.colors[k]);
    // שינוי ידני מנתק מהערכה המוכנה — אחרת נשמור שם ערכה שכבר לא מתאר את הצבעים
    brandingState.palette = matchPalette(brandingState.colors) || 'custom';
    renderPaletteGrid();
    renderBrandPreview();
  });
});

// גוון בהיר של צבע — אותה נוסחה ש-agency.html מקבל מ-color-mix ב-14%
function tintOf(hex, ratio = 0.14){
  const channel = i => parseInt(hex.slice(i, i+2), 16);
  const mix = v => Math.round(v * ratio + 255 * (1 - ratio));
  return '#' + [1,3,5].map(i => mix(channel(i)).toString(16).padStart(2,'0')).join('');
}

/* הצבע שבו ייכתבו המחיר, הכוכבים ואייקוני הקפסולות על רקע הכרטיסים. זו אותה
   נסיגה בדיוק שדף המשרד מבצע: המשני הכהה, אחריו המשני, ורק אם שניהם בהירים
   מדי — הראשי הכהה. חייב להישאר זהה ל-applyBranding ב-agency.html. */
function accentInkOf(c){
  return [c.accent_dark, c.accent, c.primary_dark].find(hex => contrastRatio(hex, c.paper_raised) >= 4.5) || '#1b1f26';
}

function renderBrandPreview(){
  if (!brandingState) return;
  const c = brandingState.colors;
  const preview = document.getElementById('brandPreview');
  const vars = {
    '--bp-brand': c.primary,
    '--bp-brand-dark': c.primary_dark,
    '--bp-accent': c.accent,
    '--bp-paper': c.paper,
    '--bp-paper-raised': c.paper_raised,
    '--bp-surface': c.paper_raised,
    '--bp-line': c.line,
    '--bp-on-brand': readableOn(c.primary),
    '--bp-on-accent': readableOn(c.accent),
    '--bp-accent-ink': accentInkOf(c),
    '--bp-brand-tint': tintOf(c.primary),
    '--bp-accent-tint': tintOf(c.accent),
  };
  Object.keys(vars).forEach(k => preview.style.setProperty(k, vars[k]));
  preview.style.borderColor = c.line;

  const cover = document.getElementById('bpCover');
  const coverSrc = brandingState.cover ? (brandingState.cover.previewUrl || brandingState.cover.url) : null;
  cover.style.background = coverSrc
    ? `linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.05) 55%), url("${coverSrc}") center/cover`
    : `linear-gradient(120deg, ${c.primary_dark}, ${c.primary})`;

  const logo = document.getElementById('bpLogo');
  const logoSrc = brandingState.logo ? (brandingState.logo.previewUrl || brandingState.logo.url) : null;
  logo.textContent = '';
  if (logoSrc){
    // תמונת לוגו מכסה את הריבוע — הגרדיאנט של הערכה מתחתיה רק היה מציץ בקצוות
    logo.style.background = 'transparent';
    const img = document.createElement('img');
    img.src = logoSrc;
    img.alt = '';
    logo.appendChild(img);
  } else {
    logo.style.background = '';
    logo.textContent = (brandingState.agencyName || '?')[0];
  }

  document.getElementById('bpName').textContent = brandingState.agencyName || 'המשרד שלי';
  const taglineInput = document.getElementById('brTagline');
  document.getElementById('bpTagline').textContent = taglineInput ? taglineInput.value.trim() : '';
  const specsRow = document.getElementById('bpSpecs');
  if (specsRow && window.Specialties){
    specsRow.innerHTML = Specialties.chipsHtml(brandingState.specialties, { className:'bp-spec' });
  }

  renderContrastWarning();
}

/* צבע בהיר מדי הופך טקסט בדף המשרד לבלתי קריא — מזהירים במקום לחסום, כי
   מותג הוא בחירה של המשרד. שתי הבדיקות מכסות את שני המקומות שבהם צבע נושא
   טקסט: הכותרות על רקע הדף, והמחירים/כוכבים על רקע הכרטיסים. */
function renderContrastWarning(){
  const c = brandingState.colors;
  const el = document.getElementById('brContrastWarn');
  const notes = [];

  const heading = contrastRatio(c.primary_dark, c.paper);
  if (heading < 4.5){
    notes.push(`הניגודיות בין "ראשי כהה" לרקע הדף נמוכה (${heading.toFixed(1)}:1, מומלץ 4.5 ומעלה) - הכותרות בדף המשרד יהיו קשות לקריאה.`);
  }
  // הצבע המשני משמש כמילוי — הקו מתחת לתמונת הנושא ותגית ההשכרה. גוון
  // שכמעט זהה לרקע פשוט נעלם, וזה לא משהו שהדף יכול לתקן לבד.
  const accentFill = contrastRatio(c.accent, c.paper_raised);
  if (accentFill < 1.6){
    notes.push('הצבע המשני כמעט זהה לרקע הכרטיסים - הקו מתחת לתמונת הנושא ותגיות ההשכרה כמעט לא ייראו בדף המשרד.');
  }
  // ובמקביל הוא נושא טקסט — מחירים, כוכבים ואייקוני הקפסולות. אקסנט בהיר מדי
  // ייעלם שם, ולכן הדף מחליף אותו אוטומטית בצבע הראשי.
  const accentInk = Math.max(contrastRatio(c.accent_dark, c.paper_raised), accentFill);
  if (accentInk < 4.5){
    notes.push(`הצבע המשני בהיר מדי ביחס לרקע הכרטיסים (${accentInk.toFixed(1)}:1) - המחירים והכוכבים בדף המשרד יוצגו בצבע הראשי במקומו.`);
  }

  el.textContent = '';
  notes.forEach(text=>{
    const line = document.createElement('div');
    line.textContent = 'שימו לב: ' + text;
    el.appendChild(line);
  });
  el.style.display = notes.length ? 'block' : 'none';
}

/* ---------- לוגו ותמונת נושא ---------- */
function renderBrandImages(){
  renderSingleImage('brLogoPreview', brandingState.logo, 'logo', ()=> clearBrandImage('logo'));
  renderSingleImage('brCoverPreview', brandingState.cover, 'cover', ()=> clearBrandImage('cover'));
}

function renderSingleImage(containerId, slot, kind, onRemove){
  const wrap = document.getElementById(containerId);
  wrap.textContent = '';
  if (!slot) return;
  const box = document.createElement('div');
  box.className = 'single-img-box' + (kind === 'logo' ? ' logo-box' : '');
  const img = document.createElement('img');
  img.src = slot.previewUrl || slot.url;
  img.alt = '';
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'x'; x.title = 'הסרה'; x.textContent = '✕';
  x.addEventListener('click', onRemove);
  box.appendChild(img); box.appendChild(x);
  wrap.appendChild(box);
}

function clearBrandImage(kind){
  const slot = brandingState[kind];
  if (!slot) return;
  if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
  // מוחקים מה-Storage רק אחרי שהשמירה ל-DB הצליחה, כדי לא לאבד תמונה שעדיין מוצגת בדף
  if (slot.url) queueDelete(slot.url);
  brandingState[kind] = null;
  renderBrandImages();
  renderBrandPreview();
}

function queueDelete(url){
  const path = storagePathFromPublicUrl(url);
  if (path) brandingState.pendingDeletes.push(path);
}

document.getElementById('brLogoInput').addEventListener('change', (e)=> pickSingleImage(e, 'logo', 512));
document.getElementById('brCoverInput').addEventListener('change', (e)=> pickSingleImage(e, 'cover', 1920));

async function pickSingleImage(e, kind, maxDim){
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file || !brandingState) return;
  try{
    const blob = await fileToResizedBlob(file, maxDim);
    const previous = brandingState[kind];
    if (previous){
      if (previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      if (previous.url) queueDelete(previous.url);
    }
    brandingState[kind] = { blob, previewUrl: URL.createObjectURL(blob) };
    renderBrandImages();
    renderBrandPreview();
  } catch(err){
    console.warn('branding image resize failed', err);
    showToast('לא ניתן לקרוא את הקובץ');
  }
}

/* ---------- גלריית המשרד ---------- */
document.getElementById('brGalleryInput').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!brandingState) return;
  const room = MAX_GALLERY_IMAGES - brandingState.gallery.length;
  if (room <= 0){ showToast(`אפשר עד ${MAX_GALLERY_IMAGES} תמונות בגלריה`); return; }
  for (const file of files.slice(0, room)){
    try{
      const blob = await fileToResizedBlob(file, 1600);
      brandingState.gallery.push({ blob, previewUrl: URL.createObjectURL(blob), caption: '' });
    } catch(err){
      console.warn('gallery resize failed', file.name, err);
      showToast('קובץ אחד לא נטען: ' + file.name);
    }
  }
  if (files.length > room) showToast(`${plural(room, 'נוספה תמונה אחת בלבד', 'תמונות בלבד', 'נוספו ' + room)} - המקסימום הוא ${MAX_GALLERY_IMAGES}`);
  renderGalleryAdmin();
});

function renderGalleryAdmin(){
  const grid = document.getElementById('brGalleryGrid');
  const empty = document.getElementById('brGalleryEmpty');
  grid.textContent = '';
  const items = brandingState ? brandingState.gallery : [];
  empty.style.display = items.length === 0 ? 'block' : 'none';

  items.forEach((item, i)=>{
    const cell = document.createElement('div');
    cell.className = 'gallery-admin-item';

    const ph = document.createElement('div');
    ph.className = 'ph';
    const img = document.createElement('img');
    img.src = item.previewUrl || item.url;
    img.alt = '';
    ph.appendChild(img);

    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.title = 'מחיקה'; x.textContent = '✕';
    x.addEventListener('click', ()=> removeGalleryImage(i));
    ph.appendChild(x);

    if (i > 0){
      const right = document.createElement('button');
      right.type = 'button'; right.className = 'move move-right'; right.title = 'הזזה ימינה'; right.textContent = '›';
      right.addEventListener('click', ()=> moveGalleryImage(i, -1));
      ph.appendChild(right);
    }
    if (i < items.length - 1){
      const left = document.createElement('button');
      left.type = 'button'; left.className = 'move move-left'; left.title = 'הזזה שמאלה'; left.textContent = '‹';
      left.addEventListener('click', ()=> moveGalleryImage(i, 1));
      ph.appendChild(left);
    }
    if (!item.url){
      const tag = document.createElement('span');
      tag.className = 'pending';
      tag.textContent = 'ממתין לשמירה';
      ph.appendChild(tag);
    }

    const caption = document.createElement('input');
    caption.type = 'text';
    caption.placeholder = 'כיתוב (לא חובה)';
    caption.maxLength = 90;
    caption.value = item.caption || '';
    caption.addEventListener('input', ()=> { item.caption = caption.value; });

    cell.appendChild(ph);
    cell.appendChild(caption);
    grid.appendChild(cell);
  });
}

function removeGalleryImage(i){
  const [item] = brandingState.gallery.splice(i, 1);
  if (!item) return;
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.url) queueDelete(item.url);
  renderGalleryAdmin();
}

function moveGalleryImage(i, delta){
  const target = i + delta;
  if (target < 0 || target >= brandingState.gallery.length) return;
  const [item] = brandingState.gallery.splice(i, 1);
  brandingState.gallery.splice(target, 0, item);
  renderGalleryAdmin();
}

/* ---------- שמירה ---------- */
async function uploadBrandingBlob(blob, prefix){
  const name = `${currentAgent.id}/branding/${prefix}-${crypto.randomUUID()}.${imageBlobExt(blob)}`;
  const { error } = await sb.storage.from(BRANDING_BUCKET).upload(name, blob, {
    contentType:imageBlobType(blob), cacheControl:'31536000', upsert:false,
  });
  if (error) throw error;
  return sb.storage.from(BRANDING_BUCKET).getPublicUrl(name).data.publicUrl;
}

document.getElementById('brSaveBtn').addEventListener('click', async ()=>{
  if (!brandingState || !currentAgent) return;
  const btn = document.getElementById('brSaveBtn');
  const feedback = document.getElementById('brFeedback');
  btn.disabled = true; btn.textContent = 'שומר…';
  feedback.style.color = 'var(--ink-soft)';
  feedback.textContent = 'מעלה תמונות…';
  try{
    // מעלים קודם, ורק אז כותבים ל-DB: אם העלאה נכשלת, השורה נשארת עקבית עם ה-Storage
    if (brandingState.logo && !brandingState.logo.url){
      brandingState.logo.url = await uploadBrandingBlob(brandingState.logo.blob, 'logo');
    }
    if (brandingState.cover && !brandingState.cover.url){
      brandingState.cover.url = await uploadBrandingBlob(brandingState.cover.blob, 'cover');
    }
    for (const item of brandingState.gallery){
      if (!item.url) item.url = await uploadBrandingBlob(item.blob, 'gallery');
    }

    const colors = { palette: brandingState.palette, page_bg: normalizePageBg(brandingState.pageBg) };
    BRAND_COLOR_KEYS.forEach(k => { colors[k] = brandingState.colors[k]; });

    feedback.textContent = 'שומר…';
    const { error } = await sb.from('agencies').update({
      colors,
      tagline: document.getElementById('brTagline').value.trim().slice(0, AGENCY_TAGLINE_MAX) || null,
      address: document.getElementById('brAddress').value.trim().slice(0, 160) || null,
      specialties: brandingState.specialties.slice(0, Specialties.MAX_SELECTED),
      logo_url:  brandingState.logo  ? brandingState.logo.url  : null,
      cover_url: brandingState.cover ? brandingState.cover.url : null,
      gallery: brandingState.gallery.map(g => ({ url: g.url, caption: (g.caption || '').trim() })),
    }).eq('id', currentAgent.agency_id);
    if (error) throw error;

    // ניקוי best-effort: השורה כבר לא מצביעה על הקבצים האלה
    if (brandingState.pendingDeletes.length){
      sb.storage.from(BRANDING_BUCKET).remove(brandingState.pendingDeletes).catch(()=>{});
      brandingState.pendingDeletes = [];
    }
    renderGalleryAdmin(); // התגית "ממתין לשמירה" יורדת מהתמונות שהועלו
    feedback.style.color = 'var(--teal)';
    feedback.textContent = 'המיתוג נשמר - דף המשרד מעודכן.';
    showToast('המיתוג של המשרד עודכן');
    refreshOnboarding();
  } catch(err){
    console.error('branding save failed', err);
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שמירה נכשלה: ' + (err.message || 'שגיאה לא צפויה');
  } finally{
    btn.disabled = false; btn.textContent = 'שמירת המיתוג';
  }
});

/* ---------- Team management (manager only) ---------- */
const toggleMemberBtn = document.getElementById('toggleAddMember');
const addMemberForm = document.getElementById('addMemberForm');
toggleMemberBtn.addEventListener('click', ()=>{
  const showing = addMemberForm.style.display !== 'none';
  addMemberForm.style.display = showing ? 'none' : 'block';
  toggleMemberBtn.textContent = showing ? '+ הוספת סוכן/ת לצוות' : '✕ ביטול';
  // הקישור של ההזמנה הקודמת יורד מהמסך, כדי שלא ייראה כאילו הוא שייך להזמנה
  // החדשה שמקלידים עכשיו
  document.getElementById('inviteResult').style.display = 'none';
});

/* קריאה אחת לכל שלוש הפעולות של add-team-member (invite / resend / revoke),
   כדי שהכותרות, ה-JWT וטיפול השגיאות לא ייכתבו שלוש פעמים בשלוש גרסאות. */
async function callTeamInvite(payload){
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/add-team-member', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch(_){ /* גוף ריק — data.error יישאר undefined ו-res.ok יכריע */ }
  return { ok: res.ok && !data.error, data };
}

const TEAM_INVITE_ERRORS = {
  managers_only:  'רק מנהל/ת משרד יכול/ה להוסיף סוכנים.',
  invalid_email:  'כתובת האימייל אינה תקינה.',
  email_in_use:   'הכתובת הזו כבר משויכת לסוכן/ת במערכת.',
  invalid_phone:  'מספר הנייד אינו תקין - נדרש נייד ישראלי, למשל 050-1234567.',
  phone_in_use:   'מספר הנייד הזה כבר רשום אצל סוכן/ת אחר/ת במערכת.',
  already_joined: 'הסוכן/ת כבר חיבר/ה את החשבון - אין צורך בהזמנה נוספת.',
  member_not_found: 'הכרטיס לא נמצא. נסו לרענן את הדף.',
  missing_fields: 'צריך אימייל וגם טלפון נייד - ההזמנה יוצאת בשני הערוצים.',
};

/* שני ערוצים, ולכן ארבעה מצבים ולא שניים. הניסוח נגזר מהם ישירות, כי
   "ההזמנה נשלחה" על הזמנה שיצאה רק בחצי הוא בדיוק סוג המשפט שגורם לאף אחד
   לא לבדוק. */
function inviteDeliveryLine(data, email){
  const to = email ? ' ל' + email : '';
  if (data.email_sent && data.wa_sent) return { ok:true,  title:'✅ ההזמנה נשלחה בוואטסאפ ובמייל' + to };
  if (data.wa_sent)                    return { ok:true,  title:'✅ ההזמנה נשלחה בוואטסאפ (המייל לא יצא)' };
  if (data.email_sent)                 return { ok:true,  title:'✅ ההזמנה נשלחה במייל' + to + ' (הוואטסאפ לא יצא)' };
  return { ok:false, title:'⚠️ ההזמנה נוצרה, אבל לא יצאה בשום ערוץ' };
}

/* הצגת הקישור אחרי הזמנה או שליחה חוזרת. הוא מוצג גם כשהמייל יצא בהצלחה:
   מייל שנחת בספאם נראה בדיוק כמו מייל שלא נשלח, ושליחה בוואטסאפ עוקפת את
   שניהם. זו גם הדרך היחידה להשלים הזמנה כשהכתובת שהוקלדה אינה נכונה. */
function showInviteResult(data, email){
  const box   = document.getElementById('inviteResult');
  const title = document.getElementById('inviteResultTitle');
  const note  = document.getElementById('inviteResultNote');
  const url   = document.getElementById('inviteResultUrl');
  const acts  = document.getElementById('inviteResultActions');

  const delivery = inviteDeliveryLine(data, email);
  title.textContent = delivery.title;
  note.textContent = delivery.ok
    ? 'הסוכן/ת יופיע/תופיע ברשימה כ"ממתין/ה" עד לכניסה הראשונה. אפשר גם לשלוח את הקישור ישירות:'
    : 'אפשר לשלוח את הקישור האישי ידנית, או לתקן את הכתובת ולשלוח שוב מרשימת הצוות.';
  url.value = data.invite_url || '';
  box.style.display = 'block';

  acts.innerHTML = '';
  addCardAction(acts, {
    label: '📋 העתקת הקישור',
    cls: 'btn-gold',
    onClick: async ()=>{
      try { await navigator.clipboard.writeText(data.invite_url); showToast('הקישור הועתק'); }
      catch(_){ url.select(); showToast('יש להעתיק ידנית'); }
    },
  });
  /* ‏wa.me בלי מספר פותח את בורר אנשי הקשר, וזה היה המסלול היחיד כאן. כשיש
     נייד על הכרטיס הוא נכנס לכתובת עצמה, וההודעה יוצאת לסוכן/ת בלחיצה אחת —
     בלי לחפש בשם שאולי עוד לא שמור בטלפון. ‏wa.me מבקש ספרות עם קידומת מדינה
     ובלי +, כלומר בדיוק הצורה של ‎phone_e164‎ — ולשם ממיר localPhone. */
  const waDigits = data.phone ? localPhone(data.phone).replace(/^0/, '972') : '';
  addCardAction(acts, {
    label: waDigits ? '💬 שליחה בוואטסאפ לסוכן/ת' : '💬 שליחה בוואטסאפ',
    onClick: ()=>{
      const text = 'הוזמנת להצטרף לצוות המשרד בשוק נדל״ן - כל הנכסים, הלידים והלקוחות שלך במקום אחד: ' + data.invite_url;
      window.open('https://wa.me/' + waDigits + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
    },
  });
}

document.getElementById('addMemberForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const btn = document.getElementById('addMemberBtn');
  const feedback = document.getElementById('addMemberFeedback');
  const email = document.getElementById('nmEmail').value.trim().toLowerCase();
  btn.disabled = true; btn.textContent = 'שולח…'; feedback.textContent = '';
  try{
    // ‏אין כאן יותר טיפול ב-license_not_verified: הטופס אינו שולח מספר
    // רישיון, ולכן הבדיקה — והערעור שאחריה — קורים אצל הסוכן/ת עצמו/ה
    // במסך הפתיחה, עם התעודה ביד.
    const { ok, data } = await callTeamInvite({
      action: 'invite',
      member_name: document.getElementById('nmName').value,
      member_email: email,
      member_phone: document.getElementById('nmPhone').value,
    });

    if (!ok){
      feedback.style.color = 'var(--red)';
      feedback.innerHTML = TEAM_INVITE_ERRORS[data.error]
        ? TEAM_INVITE_ERRORS[data.error]
        : `שליחת ההזמנה לא הצליחה, אנא נסו שוב.<br>לתמיכה: <a href="mailto:${SUPPORT_EMAIL}" style="color:var(--blue)">${SUPPORT_EMAIL}</a>`;
      btn.disabled = false; btn.textContent = 'שליחת הזמנה';
      return;
    }
    document.getElementById('addMemberForm').reset();
    showInviteResult(data, email);
    await loadTeam(currentAgent.agency_id, currentAgent.id);
    addMemberForm.style.display = 'none';
    toggleMemberBtn.textContent = '+ הוספת סוכן/ת לצוות';
    feedback.textContent = '';
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--red)';
    feedback.innerHTML = `שליחת ההזמנה לא הצליחה, אנא נסו שוב.<br>לתמיכה: <a href="mailto:${SUPPORT_EMAIL}" style="color:var(--blue)">${SUPPORT_EMAIL}</a>`;
  } finally {
    btn.disabled = false; btn.textContent = 'שליחת הזמנה';
  }
});

/* שלושת סוגי העסקה של מקרא המפה בדף הבית, באותו סדר ובאותם צבעים
   (ראו .td-sale/.td-rent/.td-commercial ב-CSS). */
const TEAM_DEAL_KINDS = [
  { key:'sale',       label:'למכירה' },
  { key:'rent',       label:'להשכרה' },
  { key:'commercial', label:'מסחריים' },
];

async function loadTeam(agencyId, callerId){
  const el = document.getElementById('teamList');
  el.innerHTML = '<div class="empty-state">טוען…</div>';
  // רשימת הצוות בבורר "סוכן 2" נטענת פעם אחת ונשמרת במטמון. כל כניסה לרשימת
  // הצוות (שרצה גם אחרי הוספה, ניתוק או שינוי סוכן/ת) מבטלת אותו, כדי שהבורר
  // לא יציג צוות ישן עד לרענון הדף.
  agencyColleagues = null;
  // מאותה סיבה גם בורר ההיקף בייצוא לאקסל: סוכן/ת שהתווסף/ה או הושעה/תה
  // צריך/ה להופיע שם כמו שהוא/היא מופיע/ה ברשימה שמתחת
  expTeamCache = null;
  // ‏user_id ו-email נטענים כדי להבחין בין סוכן/ת שכבר נכנס/ה לבין הזמנה
  // שממתינה. בלי ההבחנה הזו כרטיס תקוע נראה ברשימה בדיוק כמו כרטיס פעיל,
  // ואף אחד לא יודע שהמייל לא הגיע ליעד.
  const { data: members, error } = await sb
    .from('agency_members')
    .select('id, display_name, role, tier, active, license_number, user_id, email, phone, released_at')
    .eq('agency_id', agencyId)
    .order('role', { ascending:false });

  if (error){ el.innerHTML = '<div class="empty-state">שגיאה: ' + error.message + '</div>'; return; }
  accSetCount('accTeam', (members||[]).length);

  // מספר הנכסים הפעילים של כל חבר/ת צוות, מפוצל למכירה ולהשכרה — באותם שני
  // צבעים של המקרא שמתחת למפה בדף הבית, כדי שהקוד ייקרא אותו דבר בשני
  // המקומות. שאילתה אחת לכל הצוות ולא אחת לכל שורה; נכסים פעילים קריאים
  // ממילא (מפת החיפוש בדף הבית נבנית מהם), ולכן אין כאן חשיפה חדשה.
  //
  // dealCounts נשאר null אם הספירה נכשלה — עדיף להציג שום מספר מאשר 0 שגוי.
  const memberIds = (members||[]).map(m=>m.id);
  let dealCounts = null;
  if (memberIds.length){
    const { data: propRows, error: propErr } = await sb
      .from('properties')
      .select('agent_id, deal_type, category')
      .eq('status', 'active')
      .in('agent_id', memberIds);
    if (!propErr){
      dealCounts = {};
      memberIds.forEach(id => { dealCounts[id] = { sale:0, rent:0, commercial:0 }; });
      (propRows||[]).forEach(p=>{
        const c = dealCounts[p.agent_id];
        // מסחרי גובר על deal_type — בדיוק כמו dealKind() בדף הבית: "חנות
        // להשכרה" נספרת שם כמסחרית, ולכן גם כאן, אחרת אותו נכס יופיע
        // בשני המקומות בשני צבעים
        if (c) c[p.category === 'commercial' ? 'commercial' : (p.deal_type === 'rent' ? 'rent' : 'sale')]++;
      });
    }
  }

  const roleLabels = { manager:'מנהל/ת', agent:'סוכן/ת' };

  el.innerHTML = '';
  members.forEach(m=>{
    const counts = dealCounts && dealCounts[m.id];
    // סוג שאין בו נכסים לא מקבל מספר — שורת שם עם "0" משולש היא רעש.
    const shown = counts ? TEAM_DEAL_KINDS.filter(k => counts[k.key] > 0) : [];
    // role="img" + aria-label: הצבע לבדו לא נגיש, ולכן הסוגריים מוסתרות
    // מהקורא ומוחלפות במשפט מלא
    const dealsHtml = !counts ? '' : ` <span class="team-deals" role="img"
          title="${shown.length ? 'נכסים פעילים: ' + shown.map(k => counts[k.key] + ' ' + k.label).join(', ') : 'אין נכסים פעילים'}"
          aria-label="${shown.length ? 'נכסים פעילים: ' + shown.map(k => counts[k.key] + ' ' + k.label).join(', ') : 'אין נכסים פעילים'}"
      >(${shown.length
            ? shown.map(k => `<b class="td-${k.key}">${counts[k.key]}</b>`).join(' · ')
            : '<b class="td-none">0</b>'})</span>`;
    // כרטיס בלי user_id הוא הזמנה שטרם נענתה. זה הסימן היחיד שמגלה כתובת
    // שהוקלדה שגוי — קודם לא היה סימן כזה בכלל, כי הכרטיס נקשר מיד לחשבון
    // שנוצר על הכתובת השגויה ונראה פעיל לחלוטין.
    const pending = !m.user_id;
    // מנותק/ת: המנהל/ת כבר השעה, והסוכן/ת עוד לא פתח/ה משרד משלו/ה. זהו
    // החלון היחיד שבו אפשר לבטל — ברגע שהמשרד נפתח השורה כבר לא כאן.
    const released = !!m.released_at;
    const statusLabel = pending ? 'ממתין/ה' : released ? 'מנותק/ת' : (m.active ? 'פעיל' : 'לא פעיל');
    const el2 = document.createElement('div');
    el2.className = 'card lead-card';
    el2.innerHTML = `
      <div class="lead-top">
        <div>
          <div class="lead-name">${esc(m.display_name || 'סוכן/ת חדש/ה')}${m.id === callerId ? ' (את/ה)' : ''}${dealsHtml}</div>
          ${pending ? `<div style="font-size:.75rem;color:var(--ink-soft);margin-top:3px;direction:ltr;text-align:right">${esc(m.email || '')}</div>` : ''}
        </div>
        <span class="status-pill status-${(pending || released || !m.active) ? 'masked' : 'unlocked'}">${statusLabel}</span>
      </div>
      ${tagsHtml([
        { text:roleLabels[m.role], cls: m.role === 'manager' ? 'tag-key' : '' },
        // כרטיס שממתין להזמנה עדיין לא בחר מסלול: העמודה יושבת על ברירת
        // המחדל ‎free‎, והבחירה נעשית אצל הסוכן/ת בכניסה הראשונה. להציג כאן
        // "מסלול Pay&GO" היה מדווח על החלטה שאיש לא קיבל — ובתקופת ההשקה גם
        // סותר את מה שיקרה בפועל, כי השיוך מעניק Elite.
        pending
          ? { text:'מסלול - טרם נבחר' }
          : { text:'מסלול ' + Tiers.label(m.tier), cls: m.tier === 'free' ? '' : 'tag-info' },
        // ‏כרטיס ממתין אינו נושא מספר רישיון: הסוכן/ת מוסר/ת אותו במסך
        // הפתיחה של עצמו/ה, ושם הוא נבדק מול רשם המתווכים. תגית "רישיון"
        // ריקה כאן הייתה נראית כמו כרטיס פגום.
        m.license_number
          ? { text:'🪪 רישיון ' + m.license_number }
          : { text:'🪪 רישיון - בכניסה הראשונה' },
        // המספר מוצג ולא רק נערך: ספרה שגויה מתגלה כשקוראים אותה, לא
        // כשפותחים שדה עריכה. כרטיס בלי מספר אינו מציג תגית ריקה — ‏tagsHtml
        // מסנן, וכפתור הפעולה שמתחת ממילא אומר "הוספת נייד".
        m.phone && { text:'📱 ' + localPhone(m.phone) },
      ])}
      ${pending ? `<p style="font-size:.75rem;color:var(--ink-soft);line-height:1.5;margin:8px 0 0">
        ההזמנה נשלחה ועדיין לא נענתה. אם הכתובת שגויה - כאן מתקנים ושולחים שוב.
      </p>` : ''}
      ${released ? `<p style="font-size:.75rem;color:var(--brick);line-height:1.5;margin:8px 0 0">
        הושעה/תה מהמשרד ב-${esc(hebDate(m.released_at))}. בכניסה הבאה יתבקש/תתבקש לפתוח משרד משלו/ה,
        והנכסים${counts && counts.sale + counts.rent + counts.commercial > 0 ? ` (${counts.sale + counts.rent + counts.commercial})` : ''} יעברו איתו/ה.
        עד אז אפשר לבטל.
      </p>` : ''}
      <div class="lead-actions"></div>
    `;
    if (pending){
      const actions = el2.querySelector('.lead-actions');
      addCardAction(actions, {
        label: '✉️ שליחה מחדש / תיקון כתובת',
        cls: 'btn-gold',
        onClick: async ()=>{
          const next = prompt('כתובת האימייל לשליחת ההזמנה:', m.email || '');
          if (next === null) return;
          const { ok, data } = await callTeamInvite({ action:'resend', member_id:m.id, member_email:next.trim() });
          if (!ok){ showToast(TEAM_INVITE_ERRORS[data.error] || 'השליחה נכשלה'); return; }
          showInviteResult(data, data.email);
          showToast(inviteDeliveryLine(data, '').ok
            ? 'ההזמנה נשלחה מחדש'
            : 'ההזמנה נוצרה - השליחה נכשלה, אפשר להעתיק קישור');
          await loadTeam(agencyId, callerId);
        },
      });
      addPhoneAction(actions, m, agencyId, callerId);
      addCardAction(actions, {
        label: '🗑 ביטול ההזמנה',
        onClick: async ()=>{
          if (!confirm('לבטל את ההזמנה ולמחוק את הכרטיס של ' + m.display_name + '?')) return;
          const { ok, data } = await callTeamInvite({ action:'revoke', member_id:m.id });
          if (!ok){ showToast(TEAM_INVITE_ERRORS[data.error] || 'הביטול נכשל'); return; }
          showToast('ההזמנה בוטלה');
          await loadTeam(agencyId, callerId);
        },
      });
    } else if (released){
      const actions = el2.querySelector('.lead-actions');
      addCardAction(actions, {
        label: '↩ ביטול ההשעיה',
        cls: 'btn-gold',
        onClick: async ()=>{
          if (!confirm('להחזיר את ' + m.display_name + ' למשרד? הכרטיס והנכסים נשארים כאן.')) return;
          const { ok, data } = await callRelease({ action:'undo', member_id:m.id });
          if (!ok){ showToast(RELEASE_ERRORS[data.error] || 'הפעולה נכשלה'); return; }
          showToast('הסוכן/ת חזר/ה למשרד');
          await loadTeam(agencyId, callerId);
        },
      });
    } else if (m.id !== callerId){
      // עריכת תפקיד/סטטוס זמינה רק לחברי צוות אחרים - לא לעצמך (הטריגר ב-DB חוסם
      // עריכה-עצמית של role/active בכל מקרה, כדי שאף אחד לא "יקדם את עצמו" בעצמו)
      const actions = el2.querySelector('.lead-actions');
      const newRole = m.role === 'manager' ? 'agent' : 'manager';

      addPhoneAction(actions, m, agencyId, callerId);

      addCardAction(actions, {
        label: m.role === 'manager' ? '↓ הורדה לסוכן/ת' : '↑ קידום למנהל/ת',
        onClick: ()=> updateMemberField(m.id, { role: newRole }, agencyId, callerId),
      });

      // השעיה = ניתוק מהמשרד. הכפתור אומר את זה במפורש, כי הפעולה הישנה
      // ("השעיה" שלא חסמה כלום) לימדה שזו לחיצה קלה בלי משמעות.
      //
      // שורה לא-פעילה שאינה מנותקת יכולה להיווצר רק מעריכה ישירה במסד, אבל
      // בלי הענף הזה היא הייתה נשארת בלי שום דרך להחזיר אותה לפעילות.
      if (m.active){
        const owned = counts ? counts.sale + counts.rent + counts.commercial : 0;
        addCardAction(actions, {
          label: '⏸ השעיה וניתוק מהמשרד',
          onClick: ()=> releaseMember(m, owned, agencyId, callerId),
        });
      } else {
        addCardAction(actions, {
          label: '▶ הפעלה מחדש',
          cls: 'btn-gold',
          onClick: ()=> updateMemberField(m.id, { active: true }, agencyId, callerId),
        });
      }
    }
    el.appendChild(el2);
  });

  await loadClaimRequests(agencyId, callerId);
}

/* ---------- בקשות שיוך ממתינות ----------
   סוכן/ת שהכרטיס שלו/ה קיים אבל מקושר לכתובת אחרת (או לחשבון שנוצר על כתובת
   שהוקלדה שגוי) מזדהה במספר הרישיון, וההחלטה מגיעה לכאן. זה מה שמאפשר לתקן
   שיוך שבור מתוך הממשק - עד היום התיקון היחיד היה עריכה ידנית במסד. */
async function loadClaimRequests(agencyId, callerId){
  const el = document.getElementById('claimRequests');
  if (!el) return;
  const { data: claims, error } = await sb
    .from('agency_member_claims')
    .select('id, member_id, claim_email, claim_name, license_number, created_at')
    .eq('agency_id', agencyId).eq('status', 'pending')
    .order('created_at', { ascending:true });

  // כשל בשליפה לא מוחק את רשימת הצוות שכבר מוצגת מעליה
  if (error || !claims || !claims.length){ el.innerHTML = ''; return; }

  const { data: members } = await sb
    .from('agency_members').select('id, display_name, email, user_id').eq('agency_id', agencyId);
  const byId = Object.fromEntries((members || []).map(m => [m.id, m]));

  el.innerHTML = '';
  claims.forEach(c=>{
    const target = byId[c.member_id];
    const card = document.createElement('div');
    card.className = 'card lead-card';
    card.style.borderColor = 'var(--gold)';
    card.innerHTML = `
      <div class="lead-top">
        <div><div class="lead-name">בקשת חיבור לכרטיס ${esc(target?.display_name || '')}</div></div>
        <span class="status-pill status-masked">ממתינה</span>
      </div>
      <p style="font-size:.8rem;line-height:1.6;margin:8px 0 0">
        ${esc(c.claim_name || 'סוכן/ת')} מבקש/ת לחבר את החשבון
        <b style="direction:ltr;display:inline-block">${esc(c.claim_email)}</b>
        לכרטיס שעל מספר רישיון <b>${esc(c.license_number)}</b>.
        ${target?.user_id
          ? '<br><span style="color:var(--brick)">שימו לב: הכרטיס מקושר כרגע לחשבון אחר' +
            (target.email ? ' (<span style="direction:ltr;display:inline-block">' + esc(target.email) + '</span>)' : '') +
            '. אישור ינתק אותו ויחבר את החשבון החדש.</span>'
          : ''}
      </p>
      <p style="font-size:.75rem;color:var(--ink-soft);line-height:1.5;margin:8px 0 0">
        לאשר רק אם את/ה מזהה את האדם. מספר רישיון הוא מידע ציבורי, והאישור שלך הוא מה שמונע חיבור של מישהו זר.
      </p>
      <div class="lead-actions"></div>`;

    const actions = card.querySelector('.lead-actions');
    const decide = async (decision, label)=>{
      if (!confirm(label)) return;
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/join-agency', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
        body: JSON.stringify({ action:'decide', claim_id:c.id, decision }),
      });
      const data = await res.json().catch(()=>({}));
      // הרישיון על הכרטיס לא אומת. מנהל/ת המשרד אינו/ה מי שמערער/ת — הצילום
      // הוא של הסוכן/ת — ולכן כאן רק מוסבר מה חוסם, בלי לפתוח טופס.
      if (data.error === 'license_not_verified'){
        showToast('החיבור נחסם: ' + (data.detail || 'רישיון התיווך על הכרטיס לא אומת מול רשם המתווכים.'), 8000);
        return;
      }
      if (!res.ok || data.error){ showToast('הפעולה נכשלה: ' + (data.error || res.status)); return; }
      showToast(decision === 'approve' ? 'החשבון חובר לכרטיס' : 'הבקשה נדחתה');
      await loadTeam(agencyId, callerId);
    };
    addCardAction(actions, {
      label:'✅ אישור החיבור', cls:'btn-gold',
      onClick: ()=> decide('approve', 'לחבר את ' + c.claim_email + ' לכרטיס של ' + (target?.display_name || '') + '?'),
    });
    addCardAction(actions, {
      label:'✕ דחייה',
      onClick: ()=> decide('reject', 'לדחות את הבקשה?'),
    });
    el.appendChild(card);
  });
}

/* ---------- השעיה = ניתוק מהמשרד ----------
   הפעולה הקודמת כתבה active=false ישירות לטבלה, ולא חסמה שום דבר: אף מקום
   בקוד לא בדק את הדגל בכניסה, ולכן "סוכן/ת מושעה/ת" המשיך/ה לעבוד כרגיל.
   עכשיו זו פעולת שרת עם משמעות אחת — הסוכן/ת יוצא/ת, והנכסים עוברים איתו/ה
   כשייפתח המשרד החדש. שלוש העמודות נעולות בטריגר, ולכן אין לזה קיצור דרך
   בעדכון ישיר מהדפדפן. */
async function callRelease(payload){
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/functions/v1/release-team-member', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify(payload),
  });
  let data = {};
  try { data = await res.json(); } catch(_){ /* ראו callTeamInvite */ }
  return { ok: res.ok && !data.error, data };
}

const RELEASE_ERRORS = {
  managers_only:      'רק מנהל/ת משרד יכול/ה להשעות סוכנים.',
  cannot_release_self:'אי אפשר להשעות את עצמך.',
  last_manager:       'זה המנהל/ת הפעיל/ה היחיד/ה במשרד. יש לקדם מנהל/ת נוסף/ת קודם, אחרת המשרד יישאר בלי מי שינהל אותו.',
  member_not_joined:  'הסוכן/ת עדיין לא חיבר/ה חשבון. הפעולה המתאימה כאן היא ביטול ההזמנה.',
  already_released:   'הסוכן/ת כבר מושעה/ת.',
  member_not_found:   'הכרטיס לא נמצא. נסו לרענן את הדף.',
};

async function releaseMember(m, ownedCount, agencyId, callerId){
  const lines = [
    `${m.display_name} יוצא/ת מהמשרד.`,
    'בכניסה הבאה יתבקש/תתבקש לפתוח משרד תיווך משלו/ה.',
    ownedCount > 0
      ? `${ownedCount} הנכסים הפעילים שלו/ה יעברו איתו/ה למשרד החדש, ויירדו מהמשרד שלך.`
      : 'הנכסים שלו/ה, אם יש, יעברו איתו/ה למשרד החדש.',
    'גם הלידים והלקוחות שרשומים על שמו/ה עוברים. היסטוריית החיובים נשארת אצלך.',
    'אפשר לבטל את ההשעיה כל עוד המשרד החדש טרם נפתח.',
  ];
  const ok = await confirmPurchase({
    title: 'השעיה וניתוק מהמשרד',
    lines,
    hidePrice: true,
    requireAck: true,
    ackText: `אני מבין/ה ש-${m.display_name} יוצא/ת מהמשרד ושהנכסים עוברים איתו/ה.`,
    confirmLabel: 'השעיה וניתוק',
  });
  if (!ok) return;

  const { ok: done, data } = await callRelease({ action:'release', member_id:m.id });
  if (!done){ showToast(RELEASE_ERRORS[data.error] || 'ההשעיה נכשלה'); return; }
  showToast(m.display_name + ' הושעה/תה ונותק/ה מהמשרד');
  await loadTeam(agencyId, callerId);
}

/* ---------- תיקון הנייד של חבר/ת צוות ----------
   את המספר מקליד/ה מי שאינו/ה בעליו, וספרה שגויה לא מתגלה עד שמישהו מנסה
   לחייג. כל עוד הכרטיס ממתין להזמנה אין אף אחד אחר שיכול לתקן — לסוכן/ת
   עדיין אין חשבון להיכנס אליו. אחרי ההצטרפות שתי הדרכים פתוחות: כאן,
   ובאזור האישי של הסוכן/ת ("וואטסאפ").

   ‏prompt ולא טופס, כמו בתיקון הכתובת שלידו: פרט אחד, והשדה נפתח על הערך
   הקיים כדי שתיקון ספרה יהיה תיקון ספרה. שדה ריק מסיר את המספר — הנרמול
   והבדיקה נעשים בשרת, באותה פונקציה שמקבלת אותו בהוספה. */
function addPhoneAction(actions, m, agencyId, callerId){
  addCardAction(actions, {
    label: m.phone ? '📱 תיקון הנייד' : '📱 הוספת נייד',
    onClick: async ()=>{
      const next = prompt('הנייד של ' + m.display_name + ' (שדה ריק - הסרת המספר):', localPhone(m.phone));
      if (next === null) return;
      const { ok, data } = await callTeamInvite({ action:'set_phone', member_id:m.id, member_phone:next });
      if (!ok){ showToast(TEAM_INVITE_ERRORS[data.error] || 'העדכון נכשל'); return; }
      showToast(data.phone ? 'המספר עודכן' : 'המספר הוסר');
      await loadTeam(agencyId, callerId);
    },
  });
}

async function updateMemberField(memberId, changes, agencyId, callerId){
  const label = 'role' in changes ? (changes.role === 'manager' ? 'לקדם את הסוכן/ת למנהל/ת?' : 'להוריד את הסוכן/ת ממנהל לסוכן רגיל?')
    : (changes.active ? 'להפעיל מחדש את הסוכן/ת?' : 'להשעות את הסוכן/ת? לא יוכל/תוכל להתחבר עד הפעלה מחדש.');
  if (!confirm(label)) return;
  const { error } = await sb.from('agency_members').update(changes).eq('id', memberId);
  if (error){ showToast('שגיאה: ' + error.message); return; }
  showToast('העדכון בוצע בהצלחה');
  await loadTeam(agencyId, callerId);
}

/* ---------- My Properties ---------- */
/* ---------- Property intake vocabulary (mirrors index.html's search filters —
   kept in sync manually since these are separate static files, no shared module) ---------- */
const RESIDENTIAL_PTYPE_OPTIONS = [
  'דירה','דירת גן','גג/פנטהאוז','דופלקס','מרתף/פרטר','טריפלקס','יחידת דיור','סטודיו/לופט',
  'בית פרטי/קוטג\'','דו משפחתי','משק חקלאי/נחלה','משק עזר',
  'מגרש','בניין מגורים','מחסן','חניה','קב\' רכישה/זכות לנכס',
];
const COMMERCIAL_PTYPE_OPTIONS = ['משרדים','חנויות/שטח מסחרי','מבני תעשייה','אולמות','חלל עבודה משותף','בניין משרדים','מגרשים','מחסנים','סטודיו','כללי','מרתף','חניון','בית מלון','קליניקות'];
/* ‏"עם תמונה" ו-"יש סיור 3D" היו כאן כדגלים ידניים, והוסרו: המערכת כבר יודעת
   את שניהם מהנתונים עצמם — ‎images‎ ו-‎tour_3d_url‎ — וסימון ידני רק מאפשר
   לו לסתור אותם. בפועל הוא גם סתר: ל-48 נכסים היו תמונות ורק אחד סומן, כך
   שהסינון "עם תמונה" בדף הבית החביא כמעט את כל המלאי. הסינון בדף הבית עובד
   מאז על העמודות עצמן, ואין מה לסמן כאן. נשארו רק שתי הצהרות שאין להן מקור
   אחר בנתונים ורק הסוכן/ת יכול/ה לתת אותן.                                */
const LISTING_FEATURES = [
  ['moshav_kibbutz_only','במושב/קיבוץ'],
  ['price_dropped','המחיר ירד לאחרונה'],
];
const RESIDENTIAL_PROPERTY_FEATURES = [
  ['parking','חניה'],['elevator','מעלית'],['balcony','מרפסת'],['sun_balcony','מרפסת שמש'],['ac','מיזוג'],['bars','סורגים'],
  ['accessible','גישה לנכים'],['renovated_feature','משופצת'],['furnished','מרוהטת'],['mamad','ממ״ד'],
  ['exclusive','בבלעדיות'],['building_shelter','מקלט בבניין'],['mamak','ממ״ק'],['storage','מחסן'],
];
const COMMERCIAL_PROPERTY_FEATURES = [
  ['parking','נכס עם חניה'],['elevator','מעלית'],['balcony','מרפסת'],['ac','מזגן'],['high_ceiling','תקרה גבוהה'],
  ['cameras','מצלמות'],['kitchenette','מטבחון'],['alarm','אזעקה'],['meeting_room','חדר ישיבות'],
  ['loading_ramp','רמפת העמסה'],['comms','תקשורת'],['cold_room','חדר קירור'],
];

function populatePropertyTypeSelect(category){
  const select = document.getElementById('npType');
  const options = category === 'commercial' ? COMMERCIAL_PTYPE_OPTIONS : RESIDENTIAL_PTYPE_OPTIONS;
  select.innerHTML = options.map(o => `<option value="${o}">${o}</option>`).join('');
}
function renderFeatureCheckboxes(containerId, items, preselected){
  const container = document.getElementById(containerId);
  container.innerHTML = items.map(([value,label]) => `
    <label class="checkbox-item"><input type="checkbox" value="${value}" ${preselected.includes(value)?'checked':''}> ${label}</label>
  `).join('');
}
function getCheckedValues(containerId){
  return Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map(el => el.value);
}
/* ---------- קרקע ----------
   סוג הנכס גובר על ה-category: "מגרשים" יושב ברשימה המסחרית ו-"מגרש"
   ברשימת המגורים, ושניהם קרקע. אותו ביטוי מופיע ב-assets/specialties.js
   וב-property.html — שלושת הקבצים סטטיים ובלי מודול משותף, ולכן הסנכרון
   ידני כמו שאר האוצרות כאן.                                               */
const LAND_TYPE_RE = /מגרש|קרקע|נחל|משק|חקלא/;

function isLandTypeSelected(){
  return LAND_TYPE_RE.test(document.getElementById('npType').value || '');
}

function updateLandPlanningFields(){
  document.getElementById('npLandPlanningFields').style.display = isLandTypeSelected() ? 'block' : 'none';
}

function updateFormForCategory(category, preselectedFeatures){
  preselectedFeatures = preselectedFeatures || [];
  populatePropertyTypeSelect(category);
  const isCommercial = category === 'commercial';
  document.getElementById('npConditionField').style.display = isCommercial ? 'none' : 'block';
  document.getElementById('npCommercialLocFields').style.display = isCommercial ? 'block' : 'none';
  renderFeatureCheckboxes('npListingFeatures', LISTING_FEATURES, preselectedFeatures);
  renderFeatureCheckboxes('npPropertyFeatures', isCommercial ? COMMERCIAL_PROPERTY_FEATURES : RESIDENTIAL_PROPERTY_FEATURES, preselectedFeatures);
  // החלפת קטגוריה מאתחלת את רשימת סוגי הנכס, ולכן גם את השאלה אם זו קרקע
  updateLandPlanningFields();
}

document.getElementById('npType').addEventListener('change', updateLandPlanningFields);

/* ---------- יריד הבתים הפתוחים ----------
   שני שדות תאריך שנפתחים רק כשהסימון דלוק, ושלוש בדיקות שעוברות עליהם לפני
   השמירה. הן כאן ולא ב-DB כי הן כללי מוצר: ה-check במסד אוכף "חלון תקין"
   (סוף אחרי התחלה), והשאר — אורך מרבי, סיום שלא עבר — הוא מה שמגדיר את
   היריד עצמו ומשתנה איתו. ראו docs/open-house-fair.md.

   התאריכים נשמרים כ-timestamptz: תחילת היום המקומי ליום הפתיחה, וסופו
   (23:59:59) ליום הסגירה — כי "עד 14.10" בטופס פירושו כולל ה-14.10. אילו
   נשמר חצות של אותו יום, נכס היה נופל מהיריד בבוקר היום שהסוכן/ת הבטיח/ה
   שהוא עוד בו.                                                             */
const OPEN_HOUSE_DEFAULT_DAYS = 14;

function openHouseStamp(value, endOfDay){
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59).toISOString()
    : new Date(y, m - 1, d, 0, 0, 0).toISOString();
}

// הכיוון ההפוך, לטופס: תאריך מקומי ולא ‎toISOString().slice(0,10)‎ — 23:59:59
// בישראל הוא כבר למחרת ב-UTC, והשדה היה מציג יום אחד יותר מכפי שנשמר.
function openHouseDateInput(value){
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function openHouseToday(){
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* הכלל עצמו, על שני ערכים — הטופס והמודאל שבכרטיס הנכס קוראים לו שניהם.
   שתי בדיקות נפרדות לאותו חלון הן שני כללים שיתפצלו. */
function openHouseWindowError(start, end){
  if (!start || !end) return 'כדי לצרף את הנכס ליריד צריך למלא תאריך תחילה ותאריך סיום.';
  if (end < start) return 'תאריך הסיום מוקדם מתאריך התחילה.';
  if (end < openHouseToday()) return 'תאריך הסיום כבר עבר - היריד הוא תקופה שעוד לפניכם.';
  const maxDays = priceOf('open_house_max_days', 30);
  const days = openHouseDays(start, end);
  if (days > maxDays) return `תקופת היריד מוגבלת ל-${maxDays} ימים, וזו ${plural(days, 'יום אחד', 'ימים')}.`;
  return '';
}

function openHouseDays(start, end){
  return Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
}

/* מחזירה הודעת שגיאה, או '' כשהחלון תקין. הסימון כבוי = אין מה לבדוק. */
function openHouseError(){
  if (!document.getElementById('npOpenHouse').checked) return '';
  return openHouseWindowError(
    document.getElementById('npOpenHouseStart').value,
    document.getElementById('npOpenHouseEnd').value,
  );
}

/* ההודעה שמתחת לשדות עונה על השאלה "מה בעצם הבטחתי": כמה ימים, ועד מתי.
   היא נכתבת בכל שינוי ולא רק בשמירה — שגיאה שמתגלה אחרי לחיצה על "פרסום"
   היא שגיאה שהתגלתה מאוחר מדי. */
function syncOpenHouseFields(){
  const on = document.getElementById('npOpenHouse').checked;
  const dates = document.getElementById('npOpenHouseDates');
  const note = document.getElementById('npOpenHouseNote');
  dates.style.display = on ? 'grid' : 'none';
  if (!on){ note.textContent = ''; return; }

  const startEl = document.getElementById('npOpenHouseStart');
  const endEl   = document.getElementById('npOpenHouseEnd');
  // ברירת מחדל שמחזיקה את רוב המקרים: מהיום, לשבועיים. סוכן/ת שרוצה אחרת
  // משנה תאריך; סוכן/ת שרק רוצה להצטרף לא צריך/ה למלא כלום.
  if (!startEl.value) startEl.value = openHouseToday();
  if (!endEl.value){
    const end = new Date();
    end.setDate(end.getDate() + OPEN_HOUSE_DEFAULT_DAYS - 1);
    endEl.value = openHouseDateInput(end);
  }
  startEl.min = openHouseToday();
  endEl.min = startEl.value || openHouseToday();

  const err = openHouseError();
  note.style.color = err ? 'var(--brick)' : 'var(--ink-soft)';
  if (err){ note.textContent = err; return; }
  const days = openHouseDays(startEl.value, endEl.value);
  // אותו פורמט תאריך שהאתר הציבורי מציג ("13.9" ולא "13.09.2026"), מאותה
  // פונקציה — ההודעה כאן היא מה שהסוכן/ת מבטיח/ה, והיא צריכה להיקרא כמו
  // מה שיופיע בדף הנכס
  const fmt = v => OpenHouse.hebDay(new Date(v + 'T00:00:00'));
  note.textContent = `${plural(days, 'יום אחד', 'ימים')} ביריד - ללא עמלת תיווך לקונה מ-${fmt(startEl.value)} ועד ${fmt(endEl.value)} (כולל).`;
}

['npOpenHouse','npOpenHouseStart','npOpenHouseEnd'].forEach(id =>
  document.getElementById(id).addEventListener('change', syncOpenHouseFields));

/* ---------- היריד מכרטיס הנכס ----------
   אותם שני תאריכים של הטופס, אבל בהישג יד: ההשתתפות ביריד היא החלטה
   שחוזרת ("הנכס הזה, לשבועיים הקרובים") ולא פרט שממלאים פעם אחת כשמפרסמים
   מודעה. סוכן/ת שצריך/ה לפתוח טופס עריכה מלא ולגלול עד הסוף כדי לסמן —
   לא יעשה/תעשה את זה.

   הכתיבה כאן היא ‎update‎ ישיר על שלוש העמודות בלבד, ולא שמירה של הטופס:
   כך שום שדה אחר בנכס לא נוגע, וסוכן/ת שפתח/ה את הכרטיס באמצע עריכה לא
   מאבד/ת אותה.                                                            */
function openHouseModalSync(){
  const start = document.getElementById('ohModalStart').value;
  const end   = document.getElementById('ohModalEnd').value;
  const note  = document.getElementById('ohModalNote');
  const err   = openHouseWindowError(start, end);
  note.style.color = err ? 'var(--brick)' : 'var(--ink-soft)';
  document.getElementById('ohModalEnd').min = start || openHouseToday();
  if (err){ note.textContent = err; return false; }
  const fmt = v => OpenHouse.hebDay(new Date(v + 'T00:00:00'));
  note.textContent = `${plural(openHouseDays(start, end), 'יום אחד', 'ימים')} ביריד - ללא עמלת תיווך לקונה מ-${fmt(start)} ועד ${fmt(end)} (כולל).`;
  return true;
}

function openOpenHouseModal(p, agentId){
  const overlay  = document.getElementById('ohModal');
  const startEl  = document.getElementById('ohModalStart');
  const endEl    = document.getElementById('ohModalEnd');
  const saveBtn  = document.getElementById('ohModalSave');
  const removeBtn= document.getElementById('ohModalRemove');
  const cancelBtn= document.getElementById('ohModalCancel');
  const inFair   = OpenHouse.live(p) || OpenHouse.upcoming(p);

  document.getElementById('ohModalTitle').textContent = inFair
    ? '🏷 תקופת ההשתתפות ביריד' : '🏷 הכנסת הנכס ליריד הבתים הפתוחים';
  document.getElementById('ohModalName').textContent =
    `${p.property_type || 'נכס'} · ${propertyTabAddress(p)} · מודעה #${p.listing_number ?? '-'}`;

  // נכס שכבר ביריד נפתח על החלון שלו; נכס חדש — מהיום, לשבועיים
  startEl.value = inFair ? openHouseDateInput(p.open_house_start) : openHouseToday();
  if (inFair){
    endEl.value = openHouseDateInput(p.open_house_end);
  } else {
    const end = new Date();
    end.setDate(end.getDate() + OPEN_HOUSE_DEFAULT_DAYS - 1);
    endEl.value = openHouseDateInput(end);
  }
  startEl.min = openHouseToday();
  saveBtn.textContent = inFair ? 'עדכון התקופה' : 'הכנסה ליריד';
  // ‏style.display ולא ‎hidden‎: אין בדף כלל ‎[hidden]{display:none !important}‎,
  // ול-‎.btn‎ יש display משלו שגובר על ברירת המחדל של הדפדפן — הכפתור היה
  // מוצג גם לנכס שאינו ביריד. אותה מלכודת של שדות התאריך בטופס.
  removeBtn.style.display = inFair ? '' : 'none';
  openHouseModalSync();
  overlay.style.display = 'flex';

  // הטקסט המקורי נשמר כדי שסגירה באמצע שמירה לא תשאיר "שומר…" על הכפתור
  const saveLabel = saveBtn.textContent;
  const removeLabel = removeBtn.textContent;

  const onChange = () => openHouseModalSync();
  startEl.addEventListener('change', onChange);
  endEl.addEventListener('change', onChange);

  const close = () => {
    overlay.style.display = 'none';
    startEl.removeEventListener('change', onChange);
    endEl.removeEventListener('change', onChange);
    saveBtn.removeEventListener('click', onSave);
    removeBtn.removeEventListener('click', onRemove);
    cancelBtn.removeEventListener('click', close);
    overlay.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    saveBtn.disabled = removeBtn.disabled = false;
    saveBtn.textContent = saveLabel;
    removeBtn.textContent = removeLabel;
  };
  const onBackdrop = e => { if (e.target === overlay) close(); };
  const onKey = e => { if (e.key === 'Escape') close(); };

  async function write(patch, busyLabel, doneLabel, btn){
    const original = btn.textContent;
    saveBtn.disabled = removeBtn.disabled = true;
    btn.textContent = busyLabel;
    const { error } = await sb.from('properties').update(patch).eq('id', p.id);
    if (error){
      document.getElementById('ohModalNote').style.color = 'var(--brick)';
      document.getElementById('ohModalNote').textContent = 'השמירה נכשלה: ' + error.message;
      saveBtn.disabled = removeBtn.disabled = false;
      btn.textContent = original;
      return;
    }
    close();
    showToast(doneLabel);
    await loadProperties(agentId);
  }

  async function onSave(){
    if (!openHouseModalSync()) return;
    await write({
      open_house: true,
      open_house_start: openHouseStamp(startEl.value, false),
      open_house_end:   openHouseStamp(endEl.value, true),
    }, 'שומר…', inFair ? 'תקופת היריד עודכנה' : 'הנכס נכנס ליריד הבתים הפתוחים', saveBtn);
  }

  /* יציאה מהיריד מכבה את הדגל ומשאירה את התאריכים: הם ההיסטוריה של הנכס,
     ואף תצוגה באתר לא נשענת עליהם בלי הדגל. */
  async function onRemove(){
    await write({ open_house: false }, 'מוציא…', 'הנכס הוצא מהיריד', removeBtn);
  }

  saveBtn.addEventListener('click', onSave);
  removeBtn.addEventListener('click', onRemove);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', onBackdrop);
  document.addEventListener('keydown', onKey);
}

let currentCategory = 'residential';
document.querySelectorAll('[data-category]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('[data-category]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    updateFormForCategory(currentCategory);
  });
});
updateFormForCategory('residential'); // אתחול ראשוני כשהעמוד נטען
syncMarketingCopyField(null);         // הטופס נפתח במצב "נכס חדש"

/* ---------- Property images (2.1) ----------
   ההקטנה נעשית בצד הלקוח לפני ההעלאה: תמונה מהטלפון היא 3-6MB, ואחרי
   resize ל-1600px ו-q=0.82 היא יורדת לכ-150-300KB ב-WebP (‏200-400KB
   ב-JPEG, בדפדפן שלא מקודד WebP). ה-bucket חוסם מעל 3MB ממילא, אז בלי
   ההקטנה העלאות מהמובייל היו נכשלות.                                      */
const IMAGES_BUCKET = 'property-images';
const MAX_IMAGES = 8;
const MAX_IMAGE_DIM = 1600;

// רשימה מסודרת אחת, כי הסדר הוא נתון בפני עצמו (איבר 0 = התמונה הראשית).
// כל איבר הוא { url } לתמונה ששמורה כבר, או { blob, previewUrl } לקובץ חדש.
let imageSlots = [];

/* ‏WebP במקום JPEG באותה איכות נראית — כ-30% פחות בייטים על כל תמונה שתעלה
   מכאן והלאה, בלי לגעת בשום תמונה קיימת. דפדפן שלא יודע לקודד WebP
   (‏canvas.toBlob מחזיר null או נופל חזרה ל-PNG) מקבל JPEG כמו קודם, ולכן
   הסיומת ו-Content-Type נגזרים מה-blob שחזר ולא מקובעים מראש.

   אבל לא בכל מקום: תמונות הנכס יוצאות אל מחוץ לדפדפן שלנו —
   ‏property-marketing-publish מעלה אותן ל-‎/photos‎ של פייסבוק (‏Graph מתעד
   JPEG/PNG/GIF/BMP/TIFF, לא WebP; תמונה שנדחית נבלעת ב-console.warn והפוסט
   יוצא בלעדיה), ו-saved-search-notify מטמיעה את הראשונה כ-<img> במייל
   ההתראה (‏Outlook ל-Windows לא מרנדר WebP). לכן המדיה של הנכס נשארת JPEG,
   ו-WebP רץ במקומות שהצרכן היחיד שלהם הוא דפדפן: פרופיל, מיתוג וכתבות.

   להעביר גם את הנכסים ל-WebP = לשנות את הקבוע הזה, אחרי פוסט בדיקה אחד
   בעמוד הפייסבוק ובדיקת מייל התראה ב-Outlook. */
const IMAGE_TYPE_BROWSER  = 'image/webp';   // נצפה רק בדפדפן שלנו
const IMAGE_TYPE_EXTERNAL = 'image/jpeg';   // יוצא לפייסבוק ולמיילים
const IMAGE_BLOB_EXT = { 'image/webp':'webp', 'image/jpeg':'jpg', 'image/png':'png' };
function imageBlobExt(blob){ return IMAGE_BLOB_EXT[blob && blob.type] || 'jpg'; }
function imageBlobType(blob){ return IMAGE_BLOB_EXT[blob && blob.type] ? blob.type : 'image/jpeg'; }

function fileToResizedBlob(file, maxDim = MAX_IMAGE_DIM, quality = 0.82, preferType = IMAGE_TYPE_BROWSER){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const encode = (type)=> new Promise(res => canvas.toBlob(res, type, quality));
      encode(preferType)
        .then(first => (first && first.type === preferType) ? first : encode('image/jpeg'))
        .then(blob => blob ? resolve(blob) : reject(new Error('encode failed')))
        .catch(reject);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('לא ניתן לקרוא את הקובץ')); };
    img.src = url;
  });
}

function renderImagePreview(){
  const wrap = document.getElementById('npImagePreview');
  wrap.innerHTML = '';
  imageSlots.forEach((slot, i)=>{
    const el = document.createElement('div');
    el.className = 'img-thumb';
    el.innerHTML = `<img src="${slot.url || slot.previewUrl}" alt="">
      <button type="button" class="x" title="הסרה">✕</button>
      ${i === 0 ? '<div class="main-tag">ראשית</div>' : '<button type="button" class="star" title="הפוך לראשית">★</button>'}`;
    el.querySelector('.x').addEventListener('click', ()=> removeImage(i));
    const star = el.querySelector('.star');
    if (star) star.addEventListener('click', ()=> makeImageMain(i));
    wrap.appendChild(el);
  });
}

function removeImage(i){
  const [slot] = imageSlots.splice(i, 1);
  if (!slot) return;
  if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
  if (slot.url){
    // ניקוי best-effort מה-Storage; גם אם נכשל, הנכס כבר לא מצביע על הקובץ
    const path = storagePathFromPublicUrl(slot.url);
    if (path) sb.storage.from(IMAGES_BUCKET).remove([path]).catch(()=>{});
  }
  renderImagePreview();
}

function makeImageMain(i){
  const [slot] = imageSlots.splice(i, 1);
  if (slot) imageSlots.unshift(slot);
  renderImagePreview();
}

function storagePathFromPublicUrl(url){
  const marker = '/storage/v1/object/public/' + IMAGES_BUCKET + '/';
  const i = String(url).indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length));
}

function resetImageState(){
  imageSlots.forEach(s => { if (s.previewUrl) URL.revokeObjectURL(s.previewUrl); });
  imageSlots = [];
  document.getElementById('npImages').value = '';
  renderImagePreview();
  resetMarketingImage();
  resetVideoState();
}

/* התמונה השיווקית היא נכס נפרד מהגלריה — תמונה מעוצבת אחת לפרסום. אותו
   מנגנון הקטנה והעלאה, אבל סלוט יחיד ולא רשימה מסודרת.                     */
let marketingImageSlot = null;

function resetMarketingImage(){
  if (marketingImageSlot?.previewUrl) URL.revokeObjectURL(marketingImageSlot.previewUrl);
  marketingImageSlot = null;
  document.getElementById('npMarketingImage').value = '';
  renderMarketingImagePreview();
}

function renderMarketingImagePreview(){
  const wrap = document.getElementById('npMarketingImagePreview');
  wrap.innerHTML = '';
  if (!marketingImageSlot) return;
  const el = document.createElement('div');
  el.className = 'img-thumb';
  el.innerHTML = `<img src="${marketingImageSlot.url || marketingImageSlot.previewUrl}" alt="">
    <button type="button" class="x" title="הסרה">✕</button>`;
  el.querySelector('.x').addEventListener('click', ()=>{
    // בניגוד לגלריה לא מוחקים כאן מה-Storage: הקובץ מוסר מהנכס בשמירה עצמה
    // (marketing_image נשמר null), ומחיקה מוקדמת הייתה שוברת "ביטול" באמצע עריכה
    resetMarketingImage();
  });
  wrap.appendChild(el);
}

document.getElementById('npMarketingImage').addEventListener('change', async (e)=>{
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file) return;
  try{
    // התמונה הראשונה בפוסט הפייסבוק ובמייל ההתראה — ראו fileToResizedBlob
    const blob = await fileToResizedBlob(file, MAX_IMAGE_DIM, 0.82, IMAGE_TYPE_EXTERNAL);
    if (marketingImageSlot?.previewUrl) URL.revokeObjectURL(marketingImageSlot.previewUrl);
    marketingImageSlot = { blob, previewUrl: URL.createObjectURL(blob) };
    renderMarketingImagePreview();
  } catch(err){
    console.warn('resize failed', file.name, err);
    showToast('התמונה השיווקית לא נטענה: ' + file.name);
  }
});

// מעלה את התמונה השיווקית אם היא חדשה, ומחזיר את ה-URL (או null כשאין).
async function resolveMarketingImageUrl(propertyId){
  if (!marketingImageSlot) return null;
  if (marketingImageSlot.url) return marketingImageSlot.url;
  const name = `${currentAgent.id}/${propertyId}/marketing-${crypto.randomUUID()}.${imageBlobExt(marketingImageSlot.blob)}`;
  const { error } = await sb.storage.from(IMAGES_BUCKET).upload(name, marketingImageSlot.blob, {
    contentType:imageBlobType(marketingImageSlot.blob), cacheControl:'31536000', upsert:false,
  });
  if (error) throw error;
  const url = sb.storage.from(IMAGES_BUCKET).getPublicUrl(name).data.publicUrl;
  marketingImageSlot.url = url;
  return url;
}

/* ---------- סרטון הנכס ----------
   ‏video_url במסד היא כתובת אחת, ולכן גם כאן יש מקור אחד לסרטון — אבל שתי
   דרכים להגיע אליו: קובץ שמועלה לדלי property-videos, או קישור חיצוני
   (יוטיוב/וימאו) שמודבק בשדה שמתחתיו. בחירת קובץ מנטרלת את שדה הקישור,
   והסרתו מחזירה אותו — כך אף פעם אין שני ערכים שמתחרים על אותה עמודה.

   הקובץ נדחס במכשיר לפני ההעלאה, וזה לא נוחוּת אלא תנאי לכך שהפיצ'ר עובד
   בכלל: דקה גולמית מהטלפון היא 65-170MB (‏MB לדקה = Mbps × 7.5), והתקרה של
   הדלי היא 50MB — כלומר כמעט כל סרטון שנבחר ישירות מהגלריה היה נדחה. אחרי
   הדחיסה דקה שוקלת כ-20MB, וגם מכסת האחסון הכוללת (1GB במסלול הנוכחי)
   מחזיקה פי כמה סרטונים.

   הדחיסה נשענת על MediaRecorder ולא על WebCodecs, למרות ש-WebCodecs מהיר
   בהרבה: היא עוברת דרך אותו נגן שמנגן את הקובץ ממילא, ולכן כל מה שהמכשיר
   יודע לפתוח הוא גם מה שהיא יודעת לדחוס — כולל HEVC מאייפון, שמפענח שם
   מקומית. ‏WebCodecs היה מחייב demuxer ו-muxer חיצוניים, טיפול ידני
   בסיבוב, ב-timestamps וב-סנכרון האודיו, והוא נתמך רק מ-iOS 17. המחיר:
   הדחיסה רצה בקצב הנגינה — דקת חומר ≈ דקת המתנה, ולכן יש מד התקדמות
   וכפתור ביטול.                                                            */
const VIDEOS_BUCKET = 'property-videos';
const MAX_VIDEO_MB = 50;          // חייב להתאים ל-file_size_limit של הדלי במיגרציה
const VIDEO_TARGET_MB = 40;       // תקציב למקודד — מרווח מתחת לתקרה, כי VBR חורג
const VIDEO_SKIP_COMPRESS_MB = 8; // מתחת לזה הדחיסה רק תוריד איכות בלי להרוויח
const VIDEO_MAX_SECONDS = 60;
const VIDEO_AUDIO_KBPS = 96;
const VIDEO_MIN_KBPS = 700, VIDEO_MAX_KBPS = 3500;
const VIDEO_MIME_EXT = { 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov' };
document.getElementById('npVideoMaxLen').textContent = fmtMinutes(VIDEO_MAX_SECONDS);

// חלק מהמכשירים מוסרים קובץ מהגלריה בלי mime — אז הסיומת היא הגיבוי.
function isAcceptedVideo(file){
  return !!VIDEO_MIME_EXT[file.type] || /\.(mp4|m4v|webm|mov|qt)$/i.test(file.name);
}

function fmtClock(sec){
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ‏"1 דקות" ו-"2 דקות" הן שגיאות עברית, ולכן המספר לא מודבק לטקסט כמו שהוא
function fmtMinutes(sec){
  const m = sec / 60;
  if (m === 1) return 'דקה אחת';
  if (m === 2) return 'שתי דקות';
  return plural(m, 'דקה אחת', 'דקות');
}

/* קורא אורך ומידות בלי לנגן ובלי לפענח פריימים. אותו נגן שקורא כאן הוא גם
   זה שינגן בדף הנכס, ולכן קובץ שנכשל כאן לא היה מתנגן ממילא אצל הצופים. */
function probeVideoMeta(file){
  return new Promise((resolve, reject)=>{
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const cleanup = ()=>{ URL.revokeObjectURL(url); video.removeAttribute('src'); };
    video.onloadedmetadata = ()=>{
      const meta = { duration:video.duration, width:video.videoWidth, height:video.videoHeight };
      cleanup();
      resolve(meta);
    };
    video.onerror = ()=>{
      cleanup();
      reject(new Error('הדפדפן לא הצליח לפתוח את הסרטון - ייתכן שהפורמט לא נתמך במכשיר הזה'));
    };
    video.src = url;
  });
}

function assertVideoLength(duration){
  if (!isFinite(duration) || duration <= 0) throw new Error('לא ניתן לקרוא את אורך הסרטון');
  if (duration > VIDEO_MAX_SECONDS)
    throw new Error(`הסרטון ארוך מדי (${fmtClock(duration)}) - עד ${fmtMinutes(VIDEO_MAX_SECONDS)}. יש לקצר אותו ולנסות שוב`);
}

/* פורמט הפלט נקבע לפי מה שהדפדפן יודע להקליט. ‏MP4 ראשון כי הוא מתנגן בכל
   מקום; ‏WebM הוא הגיבוי בכרום שאין בו מקודד H.264. הערך שחוזר מפריד בין
   מחרוזת הבדיקה (עם codecs) לבין ה-mime הבסיסי — ‏allowed_mime_types של
   הדלי משווה מול הטיפוס הבסיסי, ו-'video/webm;codecs=vp8' לא היה עובר. */
function pickRecorderMime(){
  const candidates = [
    ['video/mp4;codecs=avc1.4d002a,mp4a.40.2', 'video/mp4',  'mp4'],
    ['video/mp4',                              'video/mp4',  'mp4'],
    ['video/webm;codecs=vp9,opus',             'video/webm', 'webm'],
    ['video/webm;codecs=vp8,opus',             'video/webm', 'webm'],
    ['video/webm',                             'video/webm', 'webm'],
  ];
  for (const [test, mime, ext] of candidates){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(test)) return { test, mime, ext };
  }
  return null;
}

/* דוחס את הקובץ דרך קנבס: הסרטון מתנגן, כל פריים מצויר בגודל היעד, ו-
   ‏MediaRecorder מקליט את זרם הקנבס יחד עם פס הקול. מחזיר ‎{ blob, mime, ext }‎.
   ‏abort הוא אובייקט שהקורא יכול לסמן בו ביטול. */
async function compressVideo(file, onProgress, abort){
  const target = pickRecorderMime();
  if (!target) throw new Error('הדפדפן הזה לא תומך בדחיסת וידאו - נסו מכשיר או דפדפן אחר');

  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  const srcUrl = URL.createObjectURL(file);
  video.src = srcUrl;

  let audioCtx = null, stopped = false;
  try{
    await new Promise((resolve, reject)=>{
      video.onloadedmetadata = resolve;
      video.onerror = ()=> reject(new Error('הדפדפן לא הצליח לפתוח את הסרטון - ייתכן שהפורמט לא נתמך במכשיר הזה'));
    });

    const duration = video.duration;
    assertVideoLength(duration); // ‏prepareVideoForUpload כבר בדקה, וזו שמירה על עצמאות הפונקציה
    if (!video.videoWidth || !video.videoHeight) throw new Error('לא ניתן לקרוא את מידות הסרטון');

    // הביטרייט נגזר מהאורך ולא קבוע מראש, כך שהתוצאה נכנסת לתקציב בכל אורך.
    // בתקרה הנוכחית (דקה) החישוב תמיד נעצר ב-VIDEO_MAX_KBPS, כלומר כל סרטון
    // מקבל את האיכות המקסימלית ויוצא סביב 26MB; ההצמדה לרצפה ולירידת
    // הרזולוציה נשארת כדי שהעלאת התקרה בעתיד לא תחרוג מהתקציב בשקט.
    // ‏720p בביטרייט נמוך מדי נראה גרוע יותר מ-480p באותו ביטרייט.
    const budgetKbps = (VIDEO_TARGET_MB * 8192) / duration;
    const videoKbps = Math.round(Math.min(VIDEO_MAX_KBPS, Math.max(VIDEO_MIN_KBPS, budgetKbps - VIDEO_AUDIO_KBPS)));
    const maxDim = videoKbps >= 2000 ? 1280 : 854;

    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    // מידות זוגיות — מקודדי וידאו דורשים זאת, ומספר אי-זוגי מפיל את ההקלטה
    canvas.width  = Math.max(2, Math.round(video.videoWidth  * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const ctx = canvas.getContext('2d', { alpha:false });

    const stream = canvas.captureStream(30);

    // פס הקול נמשך דרך WebAudio ולא דרך video.captureStream: האחרון לא נתמך
    // בספארי, ו-createMediaElementSource גם מנתב את הצליל מהרמקולים החוצה,
    // כך שהדחיסה לא נשמעת בזמן שהיא רצה.
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaElementSource(video).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      if (audioCtx.state === 'suspended') await audioCtx.resume().catch(()=>{});
    } catch(err){
      console.warn('פס הקול לא נלכד, הסרטון יידחס בלי סאונד:', err);
    }

    const chunks = [];
    const rec = new MediaRecorder(stream, {
      mimeType: target.test,
      videoBitsPerSecond: videoKbps * 1000,
      audioBitsPerSecond: VIDEO_AUDIO_KBPS * 1000,
    });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const recStopped = new Promise(resolve => { rec.onstop = resolve; });

    // ‏requestVideoFrameCallback מצייר בדיוק פריים אחד לכל פריים שהוצג, ולכן
    // לא מכפיל ולא מפספס; rAF הוא הגיבוי לדפדפנים שאין בהם את ה-API.
    const paint = ()=>{
      if (stopped) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (onProgress) onProgress(Math.min(1, video.currentTime / duration));
      schedule();
    };
    const schedule = video.requestVideoFrameCallback
      ? ()=> video.requestVideoFrameCallback(paint)
      : ()=> requestAnimationFrame(paint);

    // ההמתנה נרשמת לפני play כדי שסרטון קצר מאוד לא יסתיים לפני שהאזנו לו
    const finished = new Promise((resolve, reject)=>{
      video.onended = resolve;
      abort.onCancel = ()=>{
        const err = new Error('הדחיסה בוטלה');
        err.cancelled = true;
        reject(err);
      };
    });

    // ‏start בלי timeslice בכוונה: עם timeslice הכותרת נכתבת לפני שהאורך
    // ידוע, ותוצאת החיבור של המקטעים היא קובץ WebM שמדווח duration=Infinity —
    // כלומר סרגל ניגון שבור בדף הנכס. בלעדיו יוצא blob אחד סגור ותקין,
    // ואותה כמות זיכרון בדיוק (ממילא צברנו את כל המקטעים).
    rec.start();
    schedule();
    try{
      await video.play();
    } catch(err){
      // מדיניות ההשמעה האוטומטית של הדפדפן חוסמת ניגון עם סאונד כשאישור
      // המשתמש/ת פג. השתקה עוקפת את זה — במחיר סרטון בלי פס קול, שעדיין
      // עדיף על כישלון מוחלט.
      video.muted = true;
      await video.play();
    }

    try{
      await finished;
    } finally {
      stopped = true;
      video.pause();
      if (rec.state !== 'inactive') rec.stop();
    }
    await recStopped;

    const blob = new Blob(chunks, { type: target.mime });
    if (!blob.size) throw new Error('הדחיסה החזירה קובץ ריק');
    return { blob, mime: target.mime, ext: target.ext };
  } finally {
    stopped = true;
    abort.onCancel = null;
    try{ video.pause(); } catch(err){ /* כבר עצור */ }
    video.removeAttribute('src');
    URL.revokeObjectURL(srcUrl);
    if (audioCtx) audioCtx.close().catch(()=>{});
  }
}

/* מכין קובץ שנבחר להעלאה ומחזיר ‎{ blob, mime, ext, label }‎. שלושה מסלולים:
   קובץ קטן בפורמט מוכר עולה כמו שהוא, קובץ גדול נדחס, ודחיסה שנכשלה נופלת
   חזרה למקור אם הוא בכלל נכנס בתקרה. */
async function prepareVideoForUpload(file, onProgress, abort){
  const origMB = file.size / 1048576;
  const knownMime = VIDEO_MIME_EXT[file.type];

  // תקרת האורך נבדקת כאן ולא בתוך הדחיסה, כי היא חלה על כל קובץ: סרטון
  // דחוס היטב יכול להיות ארוך בזמן וקל במשקל, ודרך מסלול הדילוג על הדחיסה
  // הוא היה נכנס בלי שאיש בדק את אורכו.
  const meta = await probeVideoMeta(file);
  assertVideoLength(meta.duration);

  if (knownMime && origMB <= VIDEO_SKIP_COMPRESS_MB){
    return { blob:file, mime:file.type, ext:knownMime,
             fileName:file.name, note:`${origMB.toFixed(1)}MB` };
  }

  let out;
  try{
    out = await compressVideo(file, onProgress, abort);
  } catch(err){
    if (err.cancelled) throw err;
    if (knownMime && origMB <= MAX_VIDEO_MB){
      console.warn('דחיסה נכשלה, מעלים את המקור:', err);
      showToast('הדחיסה לא הצליחה - הסרטון יועלה כמו שהוא');
      return { blob:file, mime:file.type, ext:knownMime,
               fileName:file.name, note:`${origMB.toFixed(1)}MB · ללא דחיסה` };
    }
    throw err;
  }

  const outMB = out.blob.size / 1048576;
  if (outMB > MAX_VIDEO_MB)
    throw new Error(`גם אחרי דחיסה הסרטון שוקל ${outMB.toFixed(0)}MB - יש לקצר אותו ולנסות שוב`);
  return { ...out, fileName:file.name,
           note:`נדחס מ-${origMB.toFixed(0)}MB ל-${outMB.toFixed(1)}MB` };
}

// ‏null כשאין סרטון; ‎{ url }‎ לסרטון ששמור כבר; ‎{ blob, mime, ext, label,
// previewUrl }‎ לקובץ חדש שכבר עבר הכנה וטרם הועלה.
let videoSlot = null;
// הכתובת שהייתה שמורה בנכס כשנפתחה העריכה. נשמרת כדי למחוק את הקובץ הישן
// מה-Storage אחרי שמירה שהחליפה או הסירה אותו — ורק אז: מחיקה כבר בלחיצה על
// ✕ הייתה מוחקת את הסרטון גם כשהעריכה מבוטלת באמצע.
let videoOriginalUrl = null;

function videoStoragePath(url){
  const marker = '/storage/v1/object/public/' + VIDEOS_BUCKET + '/';
  const i = String(url || '').indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length));
}

function renderVideoPreview(){
  const wrap = document.getElementById('npVideoPreview');
  const urlInput = document.getElementById('npVideoUrl');
  wrap.innerHTML = '';
  // שדה הקישור מנוטרל כל עוד יש קובץ, וההסבר יושב ב-hint שמתחתיו ולא
  // ב-placeholder: שדה מנוטרל בלי סיבה נראית לעין הוא תקלה מבחינת מי
  // שמסתכל/ת עליו, אבל placeholder ארוך פשוט נחתך בשדה צר.
  urlInput.disabled = !!videoSlot;
  urlInput.placeholder = videoSlot ? 'יש כבר סרטון מועלה' : 'https://www.youtube.com/watch?v=…';
  document.getElementById('npVideoUrlHint').textContent = videoSlot
    ? 'להזנת קישור חיצוני יש להסיר קודם את הסרטון שהועלה (✕ על התצוגה המקדימה)'
    : 'יוטיוב, וימאו או צילומי רחפן - כתובת מלאה שמתחילה ב-https';
  if (!videoSlot) return;

  const el = document.createElement('div');
  el.className = 'video-thumb';
  const src = videoSlot.url || videoSlot.previewUrl;
  // ‏bdi עוטף אך ורק את שם הקובץ. שם לועזי בתוך משפט עברי מבלבל את אלגוריתם
  // הדו-כיווניות (תו פיסוק בקצהו קופץ לצד הלא נכון), אבל עטיפת המשפט כולו
  // הייתה מזהה אותו כלועזי לפי התו החזק הראשון והופכת את סדר המילים בעברית.
  const meta = videoSlot.fileName
    ? `<bdi>${esc(videoSlot.fileName)}</bdi> · ${esc(videoSlot.note)} - יועלה בשמירה`
    : 'סרטון שמור על הנכס';
  el.innerHTML = `<video src="${esc(src)}" controls preload="metadata" playsinline></video>
    <button type="button" class="x" title="הסרת הסרטון">✕</button>
    <div class="meta">${meta}</div>`;
  el.querySelector('.x').addEventListener('click', removeVideo);
  wrap.appendChild(el);
}

function removeVideo(){
  if (videoSlot?.previewUrl) URL.revokeObjectURL(videoSlot.previewUrl);
  videoSlot = null;
  document.getElementById('npVideoFile').value = '';
  renderVideoPreview();
}

function resetVideoState(){
  // סגירת הטופס באמצע דחיסה מבטלת אותה — אחרת היא הייתה ממשיכה לרוץ ברקע
  // ומסיימת לתוך טופס שכבר לא קיים
  if (videoBusy?.abort?.onCancel) videoBusy.abort.onCancel();
  if (videoSlot?.previewUrl) URL.revokeObjectURL(videoSlot.previewUrl);
  videoSlot = null;
  videoOriginalUrl = null;
  document.getElementById('npVideoFile').value = '';
  document.getElementById('npVideoUrl').value = '';
  renderVideoPreview();
}

/* מצב "עסוק": הדחיסה רצה בזמן אמת, ולכן חייבים לחסום שמירה של הנכס באמצע —
   שמירה כזו הייתה מעלה נכס בלי הסרטון שהמשתמש/ת בדיוק ממתין/ה לו. */
let videoBusy = null; // ‎{ abort }‎ כשדחיסה רצה, אחרת null

function setVideoBusy(busy, text){
  videoBusy = busy;
  document.getElementById('npVideoFile').disabled = !!busy;
  document.getElementById('addPropertyBtn').disabled = !!busy;
  document.getElementById('npVideoProgress').hidden = !busy;
  document.getElementById('npVideoProgressFill').style.width = '0%';
  if (busy) document.getElementById('npVideoProgressTxt').textContent = text || 'מעבד…';
}

function setVideoProgress(frac){
  const pct = Math.round(frac * 100);
  document.getElementById('npVideoProgressFill').style.width = pct + '%';
  document.getElementById('npVideoProgressTxt').textContent =
    `דוחס את הסרטון… ${pct}% - יש להשאיר את החלון פתוח`;
}

document.getElementById('npVideoCancel').addEventListener('click', ()=>{
  if (videoBusy?.abort?.onCancel) videoBusy.abort.onCancel();
});

document.getElementById('npVideoFile').addEventListener('change', async (e)=>{
  const file = (e.target.files || [])[0];
  e.target.value = ''; // מאפשר לבחור שוב את אותו קובץ אחרי הסרה
  if (!file || videoBusy) return;
  // כפתור השמירה מנוטרל בדיוק לאורך שמירה שרצה. החלפת סרטון באמצע שמירה
  // הייתה משנה את videoSlot מתחת לרגליים של resolveVideoUrl, ובסופה
  // setVideoBusy היה מחזיר את הכפתור לפעולה בזמן שהשמירה עוד רצה.
  if (document.getElementById('addPropertyBtn').disabled){
    showToast('לא ניתן להחליף סרטון בזמן שמירה - נסו שוב בעוד רגע');
    return;
  }
  if (!isAcceptedVideo(file)){
    showToast('פורמט לא נתמך - יש להעלות MP4, WebM או MOV');
    return;
  }

  const abort = { onCancel:null };
  setVideoBusy({ abort }, 'קורא את הסרטון…');
  let prepared;
  try{
    prepared = await prepareVideoForUpload(file, setVideoProgress, abort);
  } catch(err){
    if (!err.cancelled){
      console.warn('הכנת הסרטון נכשלה:', err);
      showToast(err.message || 'הסרטון לא נטען');
    }
    setVideoBusy(null);
    return;
  }
  setVideoBusy(null);

  if (videoSlot?.previewUrl) URL.revokeObjectURL(videoSlot.previewUrl);
  videoSlot = { ...prepared, previewUrl: URL.createObjectURL(prepared.blob) };
  // הקובץ גובר על הקישור, ולכן הקישור נמחק כאן ולא נשאר "רפאים" בשדה מנוטרל
  const urlInput = document.getElementById('npVideoUrl');
  if (urlInput.value.trim()){
    urlInput.value = '';
    showToast('הקישור החיצוני הוסר - הסרטון יילקח מהקובץ שהועלה');
  }
  renderVideoPreview();
});

// מעלה את הקובץ אם הוא חדש, ומחזיר את הכתובת הציבורית (או null כשאין סרטון).
async function resolveVideoUrl(propertyId){
  if (!videoSlot) return null;
  if (videoSlot.url) return videoSlot.url;
  const name = `${currentAgent.id}/${propertyId}/video-${crypto.randomUUID()}.${videoSlot.ext}`;
  const { error } = await sb.storage.from(VIDEOS_BUCKET).upload(name, videoSlot.blob, {
    contentType: videoSlot.mime, cacheControl:'31536000', upsert:false,
  });
  if (error) throw error;
  const url = sb.storage.from(VIDEOS_BUCKET).getPublicUrl(name).data.publicUrl;
  // מרגע זה הסלוט הוא "שמור": ניסיון שמירה חוזר לא יעלה את אותו קובץ פעמיים
  if (videoSlot.previewUrl) URL.revokeObjectURL(videoSlot.previewUrl);
  videoSlot = { url };
  renderVideoPreview();
  return url;
}

// מוחק מה-Storage סרטון שהוחלף או הוסר בשמירה. best-effort: הנכס כבר לא
// מצביע עליו, ולכן כישלון כאן משאיר קובץ יתום ולא שובר כלום.
function cleanupReplacedVideo(finalUrl){
  if (videoOriginalUrl && videoOriginalUrl !== finalUrl){
    const path = videoStoragePath(videoOriginalUrl);
    if (path) sb.storage.from(VIDEOS_BUCKET).remove([path]).catch(()=>{});
  }
  videoOriginalUrl = finalUrl || null;
}

/* ==========================================================================
   רשימת הרחובות
   --------------------------------------------------------------------------
   שם רחוב אינו טקסט חופשי אלא **מפתח חיפוש**: ממנו נגזרים ה-lat/lng שבלעדיהם
   הנכס נעלם מכל מפה, וממנו נגזר המידע התכנוני. "יהושוע חנקין" במקום "יהושע
   חנקין" מחזיר 404 מנומק שנראה בדיוק כמו כתובת שאינה קיימת, ואף אחד לא מקבל
   הודעה. לכן בוחרים מרשימה, ולא מקלידים.

   שלושה כללים שמסבירים כמעט כל שורה כאן:

   1. **אכיפה רק כשיש על מה להישען.** עיר נאכפת רק אם יש לה ברשימה רחוב אחד
      לפחות שמקורו בשכבת העירייה (‏source='gis'). כך עיר שאין לה שכבה חוזרת
      להקלדה חופשית במקום לחסום שמירה, וגם החלון שבין המיזוג לסנכרון הראשון
      (הרשימה כולה 'legacy') עובר בלי שאף אחד ייתקע.

   2. **שליפה שנכשלה אינה רשימה ריקה.** ‏streetRegistryReady נשאר שקרי, ואז
      אין אכיפה בכלל. תקלת רשת רגעית לא תמנע מסוכן/ת לפרסם נכס.

   3. **מפתח, לא השוואת מחרוזות.** ‏streetNameKey כאן הוא העתק של
      ‏public.street_name_key שבמסד. ההעתקה מודעת — לפרויקט הזה אין מודול
      משותף בין ה-HTML הסטטי ל-SQL, כמו ביטוי הקרקע ששוכפל בחמישה קבצים
      (ראו docs/land-planning.md). מי שמוסיף/ה ציר כתיב מעדכן/ת את שניהם,
      והמסד הוא הקובע: הוא זה שמחזיק את האינדקס הייחודי.

   הפרטים: docs/street-registry.md
   ========================================================================== */
/* העיר של כלי המידע התכנוני. ‏afula-planning-lookup עובדת מול שכבת עפולה
   בלבד, וכך גם כותרת האקורדיון. */
const STREET_PLANNING_CITY = 'עפולה';

let streetRegistry = null;            // null = טרם נטענה
let streetRegistryReady = false;      // האם מותר לאכוף רשימה סגורה
let streetsByCity = new Map();        // city -> [שמות, ממוינים]
let streetKeyIndex = new Map();       // city -> Map(key -> השם הקנוני)
let streetEnforcedCities = new Set(); // ערים שיש להן רחוב אחד לפחות מה-GIS

/* העתק של public.street_name_key. הסדר אינו שרירותי: ה"א פותחת יורדת לפני
   כיווץ היו"ד ולפני ה"א סופית, אחרת "העליה" ו-"עלייה" אינם מתכנסים. */
function streetNameKey(name){
  const base = String(name ?? '')
    .replace(/['"`׳״‘’“”]/g, '')
    .replace(/[־-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const key = base
    .replace(/^(רחוב|רח|שדרות|שדרת|שד)\s+/, '')
    .replace(/^ה/, '')
    .replace(/י{2,}/g, 'י')
    .replace(/ה$/, '');
  return key || base;
}

async function ensureStreetsLoaded(){
  if (streetRegistry) return streetRegistry;
  const { data, error } = await sb.from('street_registry')
    .select('city, name, source')
    .eq('active', true)
    .order('name');
  if (error){
    // ‏streetRegistry נשאר null כדי שהניסיון הבא ישלוף מחדש, ו-ready שקרי
    // כדי שבינתיים השדה יתנהג כמו טקסט חופשי — כמו שהתנהג עד היום.
    console.warn('רשימת הרחובות לא נטענה - שדה הרחוב נשאר חופשי:', error.message);
    streetRegistryReady = false;
    return [];
  }
  streetRegistry = data || [];
  streetsByCity = new Map();
  streetKeyIndex = new Map();
  streetEnforcedCities = new Set();
  streetRegistry.forEach(row => {
    if (!streetsByCity.has(row.city)){
      streetsByCity.set(row.city, []);
      streetKeyIndex.set(row.city, new Map());
    }
    streetsByCity.get(row.city).push(row.name);
    const keys = streetKeyIndex.get(row.city);
    const k = streetNameKey(row.name);
    // הראשון מנצח — הרשימה ממוינת, וממילא האינדקס הייחודי במסד מבטיח
    // שלא יהיו שתי שורות עם אותו מפתח באותה עיר.
    if (!keys.has(k)) keys.set(k, row.name);
    if (row.source === 'gis') streetEnforcedCities.add(row.city);
  });
  streetRegistryReady = streetRegistry.length > 0;
  refreshStreetOptions();
  return streetRegistry;
}

/* כל datalist מוגבל לעיר אחת: רשימה שמערבבת ערים היא רשימה שבה בוחרים רחוב
   של עיר אחרת בלי לשים לב. עיר שאין לה רחובות מקבלת רשימה ריקה, כלומר שדה
   טקסט רגיל. */
function populateStreetOptions(listId, city){
  const list = document.getElementById(listId);
  if (!list) return;
  const names = streetsByCity.get(String(city || '').trim()) || [];
  list.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
}

/* שלוש הרשימות יחד: זו של הטופס לפי שדה העיר, זו של המידע התכנוני על
   עפולה, וזו של חיפוש העסקאות לפי שדה העיר שלו. כל אחת עוקבת אחרי העיר
   **שלה** - רשימה משותפת הייתה מציגה רחובות של עיר אחרת בלי שום סימן. */
function refreshStreetOptions(){
  populateStreetOptions('streetOptions', document.getElementById('npCity')?.value || '');
  populateStreetOptions('planStreetOptions', STREET_PLANNING_CITY);
  populateStreetOptions('mdStreetOptions', document.getElementById('mdCity')?.value || '');
}

function streetEnforced(city){
  return streetRegistryReady && streetEnforcedCities.has(String(city || '').trim());
}

/* מתרגמת מה שהוקלד לשם הקנוני שברשימה.
   ‏{ ok:false } פירושו "לא ברשימה, והעיר הזו נאכפת" — הקורא מחליט אם לחסום
   (טופס הנכס) או רק להתריע (ייבוא מקובץ, כלי המידע התכנוני). */
function canonicalStreet(value, city){
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { ok:true, name:'' };
  const keys = streetKeyIndex.get(String(city || '').trim());
  const hit = keys ? keys.get(streetNameKey(raw)) : null;
  if (hit) return { ok:true, name:hit };
  return { ok: !streetEnforced(city), name: raw };
}

/* השורה מתחת לשדה. שלושה מצבים, וכל אחד אומר מה לעשות עכשיו:
   ריק           — מה שהוקלד הוא בדיוק מה שברשימה
   הערה אפורה    — הכתיב יתוקן לכתיב הרשמי בשמירה
   הערה אדומה    — לא ברשימה, ולידה הכפתור שמוסיף אותו */
function refreshStreetHint(){
  const input = document.getElementById('npStreet');
  const hint  = document.getElementById('npStreetHint');
  if (!input || !hint) return;
  const city = document.getElementById('npCity').value.trim();
  const raw  = input.value.replace(/\s+/g, ' ').trim();
  if (!raw || !streetEnforced(city)){ hint.innerHTML = ''; return; }
  const hit = (streetKeyIndex.get(city) || new Map()).get(streetNameKey(raw));
  if (hit){
    hint.style.color = 'var(--ink-soft)';
    hint.textContent = hit === raw ? '' : `ייכתב «${hit}» - הכתיב שבשכבת הכתובות של העירייה`;
    return;
  }
  hint.style.color = 'var(--brick)';
  hint.innerHTML = `«${esc(raw)}» אינו ברשימת הרחובות של ${esc(city)}. בדקו את הכתיב, `
    + `או <button type="button" id="npStreetAddBtn" class="btn btn-ghost" `
    + `style="padding:4px 12px;font-size:.72rem;margin-inline-start:4px">הוסיפו אותו לרשימה</button>`;
}

/* הוספה ידנית — דלת היציאה. רחוב חדש נולד לפני שהוא מגיע למאגר של העירייה,
   ומתווך/ת שנחסם/ת עד שהעירייה תתעדכן ימציא/תמציא עוקף. ה-RPC מחזיר תמיד את
   השם הקנוני, ולכן הכפתור הזה הוא גם "תקנו לי את הכתיב" כשהרחוב כבר קיים
   בכתיב אחר. */
async function addStreetToRegistry(){
  const input = document.getElementById('npStreet');
  const hint  = document.getElementById('npStreetHint');
  const city  = document.getElementById('npCity').value.trim();
  const raw   = input.value.replace(/\s+/g, ' ').trim();
  if (!raw || !city) return;
  hint.style.color = 'var(--ink-soft)';
  hint.textContent = 'מוסיף לרשימה…';
  const { data, error } = await sb.rpc('street_registry_add', { p_city: city, p_name: raw });
  if (error){
    hint.style.color = 'var(--brick)';
    hint.textContent = 'הוספת הרחוב נכשלה: ' + error.message;
    return;
  }
  streetRegistry = null;               // טעינה מחדש, כדי שהרשימה תכיל אותו
  await ensureStreetsLoaded();
  input.value = data || raw;
  refreshStreetOptions();
  refreshStreetHint();

  /* מקרה אחד שבו ההוספה "הצליחה" והשדה עדיין חסום: הרחוב כבר קיים ברשימה
     אבל **מכובה** — למשל כתיב ישן שהסנכרון הראשון לא אישר. ה-RPC מחזיר אותו
     ובכוונה אינו מדליק אותו מחדש (כיבוי הוא החלטה של מנהל/ת הפלטפורמה).
     בלי ההודעה הזו, הלחיצה על הכפתור הייתה נראית כאילו לא עשתה כלום. */
  if (!canonicalStreet(input.value, city).ok){
    hint.style.color = 'var(--brick)';
    hint.textContent = `«${input.value}» כבר קיים ברשימה אך אינו פעיל - קרוב לוודאי כתיב `
      + 'שהשכבה של העירייה לא אישרה. בחרו את הרחוב מתוך הרשימה הנפתחת.';
  }
}

document.getElementById('npStreetHint').addEventListener('click', (e)=>{
  if (e.target.id === 'npStreetAddBtn') addStreetToRegistry();
});
document.getElementById('npStreet').addEventListener('input', refreshStreetHint);
document.getElementById('npStreet').addEventListener('change', refreshStreetHint);
/* העיר קובעת גם את הרשימה וגם אם יש אכיפה בכלל, ולכן שינוי שלה מרענן את שתיהן */
document.getElementById('npCity').addEventListener('input', ()=>{
  populateStreetOptions('streetOptions', document.getElementById('npCity').value);
  refreshStreetHint();
});
/* כלי המידע התכנוני יושב באקורדיון נפרד ועשוי להיפתח לפני טופס הנכס */
document.getElementById('planStreet').addEventListener('focus', ensureStreetsLoaded, { once:true });

/* ‏allNeighborhoods נטענת ב-loadPreferences, שרצה אחרי loadProperties. הטופס
   נפתח רק בלחיצה, ולכן מספיק לוודא כאן שהרשימה קיימת לפני שמאכלסים את הבורר. */
async function ensureNeighborhoodsLoaded(){
  if (allNeighborhoods.length) return;
  const { data } = await sb.from('neighborhoods').select('id, city, name').order('name');
  allNeighborhoods = data || [];
}

async function populateNeighborhoodSelect(selectedId){
  await ensureNeighborhoodsLoaded();
  const select = document.getElementById('npNeighborhood');
  select.innerHTML = '<option value="">- לא צוין -</option>' +
    allNeighborhoods.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join('');
  select.value = selectedId || '';
}

/* ---------- סוכן/ת 2 על המודעה ----------
   שני מצבים לאותו זוג שדות (agent2_name / agent2_phone): בחירה של חבר/ת צוות
   מהמשרד — ואז השם והטלפון נכתבים מהכרטיס ולא מהזיכרון — או הקלדה חופשית של
   גורם חיצוני (סוכן/ת ממשרד אחר, שותף/ה לעסקה). המסד נשאר כפי שהוא: בשני
   המצבים נשמרים אותם שם וטלפון כטקסט, ולכן עמוד הנכס והייבוא מקובץ לא משתנים.

   הרשימה נקראת מ-agency_members_public ולא מ-agency_members: ה-view קריא לכל
   משתמש/ת מחובר/ת, מסנן ממילא כרטיסים לא פעילים (וגם מנותקים — ניתוק מכבה
   active), ואינו חושף אימייל, יתרה או נתוני מנוי של חברי הצוות. */
let agencyColleagues = null; // null = טרם נטענה; מערך = נטענה (גם אם ריקה)

async function ensureColleaguesLoaded(){
  if (agencyColleagues) return agencyColleagues;
  if (!currentAgent?.agency_id){ agencyColleagues = []; return agencyColleagues; }
  const { data, error } = await sb
    .from('agency_members_public')
    .select('id, display_name, phone_e164')
    .eq('agency_id', currentAgent.agency_id)
    .neq('id', currentAgent.id)
    .order('display_name');
  // כשל בשליפה לא חוסם את הטופס — נשארת ההקלדה החופשית
  agencyColleagues = error ? [] : (data || []);
  return agencyColleagues;
}

/* מנרמל טלפון לצורת "05...", כדי שאפשר יהיה להשוות ‎phone_e164‎ של הכרטיס
   למספר שנשמר על הנכס (שנכתב בזמנו כטקסט חופשי, עם או בלי מקפים). */
function localPhone(value){
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  return digits.startsWith('0') ? digits : '0' + digits;
}

function agent2Colleague(id){
  return (agencyColleagues || []).find(m => m.id === id) || null;
}

/* מסנכרן את זוג השדות למצב שנבחר בבורר. לא מנקה שדות בעצמו: הניקוי שייך
   לאירוע ה-change ולפתיחת טופס חדש, כדי שטעינת נכס קיים לא תמחק את מה שנשמר. */
function syncAgent2Fields(){
  const mode = document.getElementById('npAgent2Pick').value;
  const row = document.getElementById('npAgent2Manual');
  const nameEl = document.getElementById('npAgent2Name');
  const phoneEl = document.getElementById('npAgent2Phone');
  const member = agent2Colleague(mode);

  if (member){
    nameEl.value = member.display_name || '';
    phoneEl.value = localPhone(member.phone_e164);
  }
  // גם בבחירת חבר/ת צוות השדות מוצגים — כדי לראות מה בדיוק ייכתב על המודעה —
  // אבל לקריאה בלבד: מקור האמת הוא הכרטיס במשרד.
  const readonly = !!member;
  [nameEl, phoneEl].forEach(el=>{
    el.readOnly = readonly;
    el.style.background = readonly ? 'var(--paper)' : '';
    el.style.color = readonly ? 'var(--ink-soft)' : '';
  });
  row.style.display = mode ? 'grid' : 'none';
}

/* ‏name/phone הם מה ששמור על הנכס (ריקים בטופס חדש): אם הם תואמים כרטיס של
   חבר/ת צוות הבורר ייפתח עליו/ה, אחרת כל ערך שמור נחשב הקלדה חופשית. */
async function populateAgent2Select(name, phone){
  const select = document.getElementById('npAgent2Pick');
  const colleagues = await ensureColleaguesLoaded();
  select.innerHTML = '<option value="">- ללא -</option>' +
    colleagues.map(m => `<option value="${m.id}">${esc(m.display_name || 'סוכן/ת ללא שם')}</option>`).join('') +
    '<option value="manual">אחר - הקלדת שם וטלפון</option>';

  const savedName = (name || '').trim();
  const savedPhone = localPhone(phone);
  const match = (savedName || savedPhone)
    ? colleagues.find(m =>
        (m.display_name || '').trim() === savedName &&
        (!savedPhone || localPhone(m.phone_e164) === savedPhone))
    : null;

  select.value = match ? match.id : ((savedName || savedPhone) ? 'manual' : '');
  syncAgent2Fields();
}

document.getElementById('npAgent2Pick').addEventListener('change', ()=>{
  // כל מעבר בין מצבים מנקה תחילה: אחרת שם של חבר/ת צוות היה נשאר בשדה שהפך
  // להקלדה חופשית (ולהפך). ‏syncAgent2Fields ממלאת מיד מחדש כשנבחר/ה סוכן/ת.
  document.getElementById('npAgent2Name').value = '';
  document.getElementById('npAgent2Phone').value = '';
  syncAgent2Fields();
});

document.getElementById('npImages').addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // מאפשר לבחור שוב את אותו קובץ אחרי הסרה
  const room = MAX_IMAGES - imageSlots.length;
  if (room <= 0){ showToast(`אפשר עד ${MAX_IMAGES} תמונות לנכס`); return; }
  for (const file of files.slice(0, room)){
    try{
      // תמונות הנכס מתפרסמות בפייסבוק ונשלחות במיילי ההתראות — ראו
      // fileToResizedBlob. לכן JPEG ולא WebP.
      const blob = await fileToResizedBlob(file, MAX_IMAGE_DIM, 0.82, IMAGE_TYPE_EXTERNAL);
      imageSlots.push({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch(err){
      console.warn('resize failed', file.name, err);
      showToast('קובץ אחד לא נטען: ' + file.name);
    }
  }
  if (files.length > room) showToast(`${plural(room, 'נוספה תמונה אחת בלבד', 'תמונות בלבד', 'נוספו ' + room)} - המקסימום הוא ${MAX_IMAGES}`);
  renderImagePreview();
});

// מעלה את הקבצים החדשים ומחזיר את רשימת ה-URLs המלאה לפי סדר התצוגה.
async function resolveImageUrls(propertyId){
  const urls = [];
  for (const slot of imageSlots){
    if (slot.url){ urls.push(slot.url); continue; }
    const name = `${currentAgent.id}/${propertyId}/${crypto.randomUUID()}.${imageBlobExt(slot.blob)}`;
    const { error } = await sb.storage.from(IMAGES_BUCKET).upload(name, slot.blob, {
      contentType:imageBlobType(slot.blob), cacheControl:'31536000', upsert:false,
    });
    if (error) throw error;
    const url = sb.storage.from(IMAGES_BUCKET).getPublicUrl(name).data.publicUrl;
    slot.url = url; // כדי שניסיון שמירה חוזר לא יעלה את אותו קובץ פעמיים
    urls.push(url);
  }
  return urls;
}

const toggleBtn = document.getElementById('toggleAddProperty');
const addForm = document.getElementById('addPropertyForm');
toggleBtn.addEventListener('click', ()=>{
  const showing = addForm.style.display !== 'none';
  addForm.style.display = showing ? 'none' : 'block';
  toggleBtn.textContent = showing ? '+ הוספת נכס חדש' : '✕ ביטול';
  if (showing){
    editingPropertyId = null;
    editingPropertyOriginalAddress = null;
    document.getElementById('addPropertyForm').reset();
    document.getElementById('npCity').value = 'עפולה';
    populateNeighborhoodSelect('');
    document.getElementById('npStreetHint').innerHTML = '';
    ensureStreetsLoaded();
    populateAgent2Select('', '');
    resetImageState();
    syncMarketingCopyField(null);
    renderPropertyStatusPanel(null);
    document.getElementById('addPropertyBtn').textContent = 'פרסום הנכס';
    currentCategory = 'residential';
    document.querySelectorAll('[data-category]').forEach(b=> b.classList.toggle('active', b.dataset.category === 'residential'));
    updateFormForCategory('residential');
  }
});

/* ==========================================================================
   נכס כפול
   --------------------------------------------------------------------------
   אותה דירה נקלטה פעמיים: פעם כשנמכרה לפני שנה, ופעם עכשיו כשחזרה לשוק.
   התוצאה היא שתי מודעות לאותה כתובת — שתי היסטוריות צפיות, שני מספרי
   מודעה שהסוכן/ת מוסר/ת בטלפון, ולידים שמתחלקים בין השתיים.

   הבדיקה רצה רק בדרך ל-insert (בעריכה אין מה לבדוק), על הנכסים של הסוכן/ת
   עצמו/ה — ‏RLS ממילא לא מחזירה אחרים. ההשוואה נעשית בדפדפן ולא ב-SQL כי
   "עלייה 20" ו"עלייה  20 " הם אותה כתובת, ו-eq לא יודע את זה.
   ========================================================================== */

/* השוואת טקסט חופשי: רווחים כפולים, גרשיים וסימני פיסוק אינם הבדל אמיתי
   בין שתי כתובות. "רח׳"/"רחוב" יורדים כי חצי מהסוכנים כותבים אותם וחצי לא. */
function propNormText(value){
  return String(value == null ? '' : value)
    .replace(/^\s*(רחוב|רח['׳]?)\s+/u, '')
    .replace(/["'׳״,.\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* מספרים משווים רק כששניהם קיימים: נכס ישן בלי קומה רשומה לא אמור להיפסל
   מול טופס שבו הוזנה קומה, אבל קומה 2 מול קומה 5 היא דירה אחרת בבניין. */
function propNumEq(a, b){
  if (a == null || a === '' || b == null || b === '') return true;
  return Number(a) === Number(b);
}

/* מחזירה את הנכס הקיים שהכי סביר שהוא אותו נכס, או null.
   נכס פעיל קודם לארכיון: מודעה כפולה *באוויר* היא הנזק הגדול יותר. */
async function findPropertyDuplicate(payload){
  if (!currentAgent) return null;
  const city   = propNormText(payload.city);
  const street = propNormText(payload.street);
  const house  = propNormText(payload.house_number);
  const title  = propNormText(payload.title);
  if (!city || (!street && !title)) return null;

  const { data, error } = await sb.from('properties')
    .select('id, listing_number, title, price, rooms, floor, deal_type, property_type, city, street, house_number, status, images, marketing_image, video_url, listing_expires_at, updated_at')
    .eq('agent_id', currentAgent.id)
    .limit(500);
  if (error){ console.warn('duplicate check failed', error.message); return null; }

  const sameAddress = p => !!(street && house
    && propNormText(p.city) === city
    && propNormText(p.street) === street
    && propNormText(p.house_number) === house);

  // גיבוי לנכס בלי כתובת מלאה — אותו מפתח שבו משתמשת בדיקת הכפילות בייבוא
  const sameTitlePrice = p => !!(title && propNormText(p.title) === title
    && Number(p.price) === Number(payload.price));

  // אותה כתובת אך דירה אחרת בבניין: מספר חדרים או קומה שונים
  const sameUnit = p => propNumEq(p.rooms, payload.rooms) && propNumEq(p.floor, payload.floor)
    && (!p.deal_type || !payload.deal_type || p.deal_type === payload.deal_type);

  const matches = (data || []).filter(p => (sameAddress(p) && sameUnit(p)) || sameTitlePrice(p));
  if (!matches.length) return null;

  matches.sort((a, b) => {
    const liveA = a.status === 'active' ? 0 : 1;
    const liveB = b.status === 'active' ? 0 : 1;
    if (liveA !== liveB) return liveA - liveB;
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });
  return { match: matches[0], total: matches.length };
}

/* 'restore' = לעדכן את המודעה הקיימת (ולהחזיר לפרסום אם היא בארכיון),
   'new' = לפרסם בכל זאת מודעה שנייה, 'cancel' = חזרה לטופס.               */
function confirmDuplicateProperty({ match, total }){
  const overlay = document.getElementById('dupModal');
  const restoreBtn = document.getElementById('dupRestore');
  const newBtn     = document.getElementById('dupNew');
  const cancelBtn  = document.getElementById('dupCancel');
  const isLive = match.status === 'active';

  document.getElementById('dupTitle').textContent = isLive
    ? 'הנכס הזה כבר מפורסם אצלך'
    : 'נכס דומה קיים אצלך בארכיון';
  document.getElementById('dupListing').textContent = 'מודעה #' + (match.listing_number ?? '-');
  const statusEl = document.getElementById('dupStatus');
  statusEl.className = 'status-pill ' + (isLive ? 'status-unlocked' : 'status-off');
  statusEl.textContent = PROPERTY_STATUS_LABELS[match.status] || match.status;
  document.getElementById('dupName').textContent =
    [match.property_type, [match.street, match.house_number].filter(Boolean).join(' '), match.city]
      .filter(Boolean).join(', ') || (match.title || 'נכס ללא כותרת');
  document.getElementById('dupMeta').textContent = [
    shekel(match.price),
    match.rooms ? plural(match.rooms, 'חדר אחד', 'חדרים') : '',
    (match.floor || match.floor === 0) ? 'קומה ' + match.floor : '',
    'עודכן ' + hebDate(match.updated_at),
    total > 1 ? 'ועוד ' + plural(total - 1, 'מודעה דומה אחת', 'מודעות דומות') : '',
  ].filter(Boolean).join(' · ');
  document.getElementById('dupNote').textContent = isLive
    ? 'עדכון המודעה הקיימת ישמור על מספר המודעה, הצפיות, הלידים והמידע התכנוני שנצברו עליה. פרסום כנכס חדש ייצור מודעה שנייה לאותה כתובת.'
    : 'החזרה לפרסום תעדכן את המודעה הקיימת בפרטים שמילאת ותחזיר אותה לאתר - עם מספר המודעה, הצפיות, הלידים והמידע התכנוני שכבר נצברו. שדות שהשארת ריקים יישארו כפי שהיו.';
  restoreBtn.textContent = isLive ? '✏️ עדכון המודעה הקיימת' : '↩ החזרה לפרסום ועדכון';

  overlay.style.display = 'flex';

  return new Promise(resolve => {
    const onRestore = ()=> done('restore');
    const onNew     = ()=> done('new');
    const onCancel  = ()=> done('cancel');
    const onKey     = (e)=> { if (e.key === 'Escape') done('cancel'); };
    const onBackdrop= (e)=> { if (e.target === overlay) done('cancel'); };

    function done(value){
      restoreBtn.removeEventListener('click', onRestore);
      newBtn.removeEventListener('click', onNew);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      overlay.style.display = 'none';
      resolve(value);
    }

    restoreBtn.addEventListener('click', onRestore);
    newBtn.addEventListener('click', onNew);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    restoreBtn.focus();
  });
}

/* ==========================================================================
   אותו נכס אצל שני משרדים
   --------------------------------------------------------------------------
   ‏findPropertyDuplicate מעל רואה רק את הנכסים של הסוכן/ת עצמו/ה — ‏RLS לא
   תיתן לה יותר מזה, ולכן היא לעולם לא תראה את הכפילות שבאמת מזיקה: אותה
   דירה שבעליה מסרו לחמישה משרדים, מתפרסמת חמש פעמים.

   הבדיקה החוצה־משרדים היא ‎check_property_availability‎ במסד — פונקציית
   ‏SECURITY DEFINER שרואה מעבר ל-RLS ומחזירה **שמות בלבד**: מי מפרסם/ת את
   הנכס ומאיזה משרד. לא מזהה, לא טלפון, ולא מועד סיום של בלעדיות.

   היא נוחות, לא גבול: האכיפה עצמה היא בטריגר ‎properties_guard_duplicate‎,
   ולכן גם מי שיקרא ל-API ישירות ייחסם.
   ========================================================================== */
async function checkPropertyAvailability(payload, ownerPhone){
  const { data, error } = await sb.rpc('check_property_availability', {
    p_city: payload.city,
    p_street: payload.street,
    p_house_number: payload.house_number,
    p_rooms: payload.rooms,
    p_floor: payload.floor,
    p_deal_type: payload.deal_type,
    p_owner_phone: ownerPhone || null,
  });
  // כישלון בבדיקה אינו עוצר פרסום — הטריגר במסד ייחסם בכל מקרה, והודעת
  // שגיאה על שירות שלא ענה היא לא מה שצריך לעצור סוכן/ת באמצע טופס
  if (error){ console.warn('availability check failed', error.message); return null; }
  return data;
}

const PROPERTY_BLOCK_STATES = ['exclusive_elsewhere', 'duplicate_elsewhere', 'duplicate_same_agency'];

/* ‏'draft' = לשמור את הנכס בלי לפרסם ולפתוח אשף בלעדיות, ‏'cancel' = חזרה
   לטופס. אין כאן אפשרות "לפרסם בכל זאת": המסד יחסום אותה ממילא.           */
function confirmBlockedProperty(verdict){
  const overlay   = document.getElementById('blockModal');
  const draftBtn  = document.getElementById('blockDraft');
  const cancelBtn = document.getElementById('blockCancel');
  const exclusive = verdict.state === 'exclusive_elsewhere';
  const sameAgency = verdict.state === 'duplicate_same_agency';

  document.getElementById('blockTitle').textContent = exclusive
    ? 'הנכס נמצא בבלעדיות של מתווך/ת אחר/ת'
    : sameAgency ? 'הנכס כבר מפורסם במשרד שלכם' : 'הנכס כבר מפורסם במערכת';
  document.getElementById('blockHolder').textContent =
    `${verdict.agent_name} · ${verdict.agency_name}`;
  document.getElementById('blockMeta').textContent = sameAgency
    ? (verdict.listing_number ? 'מודעה #' + verdict.listing_number : '')
    : 'אותה כתובת, אותה דירה ואותם בעלים';
  document.getElementById('blockNote').textContent = sameAgency
    ? 'הנכס כבר באוויר מטעם המשרד. מודעה שנייה לאותו נכס מפצלת את הלידים ואת הצפיות בין שתי מודעות. '
      + 'אפשר לשמור את הנכס אצלכם בלי לפרסם, ולתאם עם הסוכן/ת שמחזיק/ה בו.'
    : exclusive
      ? 'כל עוד הבלעדיות בתוקף אי אפשר לפרסם את הנכס. אם החתמתם בלעדיות חדשה מול בעל/ת הנכס - '
        + 'שמרו אותו כאן בלי לפרסם, החתימו את ההסכם במערכת, ואז אפשר יהיה לפרסם על פיו. '
        + 'המתווך/ת הקודם/ת יקבל/תקבל התראה והמודעה שלו/ה תרד מפרסום.'
      : 'הדרך היחידה לפרסם נכס שכבר קיים במערכת היא הסכם בלעדיות חתום מול בעל/ת הנכס. '
        + 'שמרו את הנכס כאן בלי לפרסם, החתימו בלעדיות במערכת, ואז אפשר יהיה לפרסם על פיה - '
        + 'המודעה הקיימת תרד מפרסום והסוכן/ת שלה יקבל/תקבל התראה.';
  draftBtn.textContent = sameAgency
    ? 'שמירה בלי פרסום'
    : 'שמירה בלי פרסום + החתמת בלעדיות';

  overlay.style.display = 'flex';

  return new Promise(resolve => {
    const onDraft   = ()=> done('draft');
    const onCancel  = ()=> done('cancel');
    const onKey     = (e)=> { if (e.key === 'Escape') done('cancel'); };
    const onBackdrop= (e)=> { if (e.target === overlay) done('cancel'); };

    function done(value){
      draftBtn.removeEventListener('click', onDraft);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      overlay.style.display = 'none';
      resolve(value);
    }

    draftBtn.addEventListener('click', onDraft);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    draftBtn.focus();
  });
}

/* בעדכון של נכס קיים מתוך טופס "נכס חדש" — שדה ריק בטופס אינו הוראה למחוק.
   מי שמילא/ה מחיר וחדרים בלבד לא התכוון/ה למחוק את התיאור השיווקי שנכתב
   בפעם הקודמת, ולכן ריקים יורדים מה-payload ורק מה שהוקלד גובר.            */
function propNonEmptyPatch(payload){
  const patch = {};
  Object.entries(payload).forEach(([key, value])=>{
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && !value.length) return;
    if (typeof value === 'number' && Number.isNaN(value)) return;
    patch[key] = value;
  });
  return patch;
}

/* פרטי בעל/ת נכס שנכתבו לתוך טקסט ציבורי נמחקים במסד — טריגר
   ‏properties_redact_owner_details, ולא בדיקה כאן. הסיבה: לטבלה כותבים גם
   אשף הייבוא, ‏property-description ו-property-marketing-publish, ובדיקה
   בטופס הייתה מכסה מסלול אחד מארבעה.

   מה שכן שייך לכאן הוא הדיווח. שמירה שקטה שמשנה את הטקסט משאירה את הסוכן/ת
   עם נוסח אחד בטופס ונוסח אחר בדף הנכס, בלי לדעת למה — ולכן קוראים את מה
   שנשמר בפועל (אחרי הטריגר, ואחרי שמירת שם הבעלים שרצה מיד לפניו) ואומרים
   מה הוסר. ‏docs/owner-privacy.md                                          */
const OWNER_REDACT_FIELDS = {
  description: 'תיאור המודעה',
  marketing_description: 'התיאור השיווקי',
  post_text: 'טקסט הפוסט',
};

async function reportOwnerRedaction(propertyId, sent){
  const fields = Object.keys(OWNER_REDACT_FIELDS)
    .filter(key => String(sent?.[key] ?? '').trim());
  if (!propertyId || !fields.length) return;
  const { data, error } = await sb.from('properties')
    .select(fields.join(',')).eq('id', propertyId).maybeSingle();
  if (error || !data) return;
  const changed = fields.filter(key => (data[key] ?? '') !== (sent[key] ?? ''));
  if (!changed.length) return;
  showToast('פרטי בעל/ת הנכס הוסרו מ' + changed.map(k=> OWNER_REDACT_FIELDS[k]).join(' ומ') +
            ' - טקסט שגלוי לכל גולש/ת. השם והטלפון שמורים בשדות הפנימיים של הנכס.', 6000);
}

document.getElementById('addPropertyForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('addPropertyBtn');
  const feedback = document.getElementById('addPropertyFeedback');
  const planningStatus = document.getElementById('addPropertyPlanningStatus');
  btn.disabled = true; btn.textContent = editingPropertyId ? 'שומר…' : 'מפרסם…'; feedback.textContent = ''; planningStatus.textContent = '';

  const lat = document.getElementById('npLat').value;
  const lng = document.getElementById('npLng').value;
  let   street = document.getElementById('npStreet').value.trim();
  const houseNumber = document.getElementById('npHouseNumber').value.trim();
  const city = document.getElementById('npCity').value.trim();

  /* הרשימה הסגורה נאכפת כאן ולא ברכיב: ‏datalist מציע ואינו חוסם, וכל
     הטעם בשדה הזה הוא שהשם שנשמר יהיה השם שהשכבה של העירייה מכירה —
     ממנו נגזרים גם הפין על המפה וגם המידע התכנוני.

     שתי תוצאות אפשריות:
       נמצא ברשימה  -> ‏street מוחלף בכתיב הקנוני, גם אם הוקלד אחרת
       לא נמצא      -> עצירה, עם הפנייה לכפתור "הוסיפו אותו לרשימה"

     ‏canonicalStreet מחזירה ok גם כשלא נמצא, בעיר שאין לה רשימה מאושרת —
     ואז השדה מתנהג כמו טקסט חופשי, כמו שהתנהג עד היום. */
  const streetMatch = canonicalStreet(street, city);
  if (!streetMatch.ok){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = `הרחוב «${street}» אינו ברשימת הרחובות של ${city}. `
      + 'בחרו רחוב מהרשימה, או הוסיפו אותו בכפתור שמתחת לשדה.';
    refreshStreetHint();
    document.getElementById('npStreet').focus();
    btn.disabled = false;
    btn.textContent = editingPropertyId ? 'שמירת שינויים' : 'פרסום הנכס';
    return;
  }
  street = streetMatch.name;
  document.getElementById('npStreet').value = street;

  // lat/lng לא חובה בטופס, אבל בלעדיהם הנכס לא מקבל פין במפת עמוד הבית
  // (renderMap שם מדלגת על נכסים בלי lat/lng) — אז כשיש כתובת בעפולה
  // וטרם הוזנו קואורדינטות ידנית, מנסים לגאוקד אותה אוטומטית ברקע דרך
  // geocode-address (זמין לכל סוכן/ת, בלי הגבלת מנוי). אם זה נכשל
  // (כתובת לא נמצאה / בעיית רשת) פשוט ממשיכים בלי lat/lng כמו קודם.
  let resolvedLat = lat, resolvedLng = lng;
  if (!resolvedLat && !resolvedLng && street && houseNumber && city === 'עפולה'){
    try{
      const { data: { session } } = await sb.auth.getSession();
      const geoRes = await fetch(GEOCODE_FUNCTION_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
        body: JSON.stringify({ street, house_number: houseNumber }),
      });
      const geoData = await geoRes.json();
      if (geoRes.ok && geoData.success){
        resolvedLat = geoData.lat;
        resolvedLng = geoData.lng;
      }
    } catch(err){
      console.warn('גיאוקוד אוטומטי נכשל, הנכס יישמר בלי מיקום על המפה:', err);
    }
  }

  /* קישורי מדיה: ה-check במסד דורש ‎http(s)‎, ושגיאת constraint חוזרת כטקסט
     פוסטגרס לא קריא — לכן נבדק כאן, עם הודעה בעברית ליד השדה עצמו. */
  const mediaUrl = (id, label)=>{
    const value = document.getElementById(id).value.trim();
    if (!value) return null;
    if (!/^https?:\/\/\S+$/i.test(value)) throw new Error(`${label} חייב להיות כתובת מלאה שמתחילה ב-http`);
    return value.slice(0, 1000);
  };
  let tour3dUrl, videoUrl;
  try{
    tour3dUrl = mediaUrl('npTour3dUrl', 'הקישור לסיור הווירטואלי');
    // סרטון מועלה גובר על קישור חיצוני (שדה הקישור ממילא מנוטרל כשיש קובץ).
    // קובץ שטרם הועלה מקבל כאן null, והכתובת האמיתית נכתבת אחרי ההעלאה —
    // שרצה רק אחרי שלנכס יש id, כי הוא חלק מהנתיב ב-Storage.
    videoUrl  = videoSlot ? (videoSlot.url || null) : mediaUrl('npVideoUrl', 'הקישור לסרטון');
  } catch(err){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = err.message;
    btn.disabled = false;
    btn.textContent = editingPropertyId ? 'שמירת שינויים' : 'פרסום הנכס';
    return;
  }

  /* חלון היריד נבדק לפני שנוגעים במסד: ‏check שנכשל חוזר כטקסט פוסטגרס
     ("violates check constraint properties_open_house_window_chk"), והסוכן/ת
     שסימן/ה השתתפות בלי למלא תאריכים צריך/ה לדעת בעברית מה חסר. */
  const openHouseProblem = openHouseError();
  if (openHouseProblem){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = openHouseProblem;
    syncOpenHouseFields();
    document.getElementById('npOpenHouseStart').focus();
    btn.disabled = false;
    btn.textContent = editingPropertyId ? 'שמירת שינויים' : 'פרסום הנכס';
    return;
  }
  const openHouseOn = document.getElementById('npOpenHouse').checked;

  const payload = {
    title: document.getElementById('npTitle').value,
    category: currentCategory,
    property_type: document.getElementById('npType').value,
    deal_type: document.getElementById('npDeal').value,
    price: parseFloat(document.getElementById('npPrice').value),
    rooms: document.getElementById('npRooms').value ? parseFloat(document.getElementById('npRooms').value) : null,
    city: document.getElementById('npCity').value,
    street: street || null,
    house_number: houseNumber || null,
    address: (street || houseNumber) ? (street + (houseNumber ? ' ' + houseNumber : '')) : null,
    neighborhood_id: document.getElementById('npNeighborhood').value || null,
    sales_area: document.getElementById('npSalesArea').value.trim() || null,
    floor: document.getElementById('npFloor').value ? parseInt(document.getElementById('npFloor').value) : null,
    total_floors: document.getElementById('npTotalFloors').value ? parseInt(document.getElementById('npTotalFloors').value) : null,
    size_sqm: document.getElementById('npSizeSqm').value ? parseFloat(document.getElementById('npSizeSqm').value) : null,
    built_size_sqm: document.getElementById('npBuiltSizeSqm').value ? parseFloat(document.getElementById('npBuiltSizeSqm').value) : null,
    garden_sqm: document.getElementById('npGardenSqm').value ? parseFloat(document.getElementById('npGardenSqm').value) : null,
    description: document.getElementById('npDescription').value.trim() || null,
    marketing_description: document.getElementById('npMarketingDescription').value.trim() || null,
    post_text: document.getElementById('npPostText').value.trim() || null,
    furniture_details: document.getElementById('npFurnitureDetails').value.trim() || null,
    tour_3d_url: tour3dUrl,
    video_url: videoUrl,
    listing_expires_at: document.getElementById('npExpiresAt').value || null,
    agent2_name: document.getElementById('npAgent2Name').value.trim() || null,
    agent2_phone: document.getElementById('npAgent2Phone').value.trim() || null,
    condition: currentCategory === 'commercial' ? null : (document.getElementById('npCondition').value || null),
    project_status: document.getElementById('npProjectStatus').value || null,
    move_in_date: document.getElementById('npMoveInDate').value || null,
    move_in_soon: document.getElementById('npMoveInSoon').checked,
    open_house: openHouseOn,
    restrooms_location: currentCategory === 'commercial' ? (document.getElementById('npRestrooms').value || null) : null,
    storage_location: currentCategory === 'commercial' ? (document.getElementById('npStorageLoc').value || null) : null,
    mamad_location: currentCategory === 'commercial' ? (document.getElementById('npMamadLoc').value || null) : null,
    features: [...getCheckedValues('npListingFeatures'), ...getCheckedValues('npPropertyFeatures')],
  };

  /* שדות התכנון נשמרים רק כשהנכס באמת קרקע, ומתאפסים כשסוג הנכס שונה בעריכה
     מ"מגרש" ל"דירה": ערך שנשאר מאחור בשדה מוסתר היה ממשיך להופיע בדף הנכס. */
  const landValue = (id, parse) => {
    if (!isLandTypeSelected()) return null;
    const raw = document.getElementById(id).value.trim();
    return raw ? (parse ? parse(raw) : raw) : null;
  };
  /* התאריכים נכתבים רק כשהנכס נכנס ליריד. יציאה ממנו מכבה את הדגל ומשאירה
     אותם: הם ההיסטוריה של הנכס ("היה ביריד עד 14.10"), ואף תצוגה באתר לא
     נשענת עליהם בלי הדגל. */
  if (openHouseOn){
    payload.open_house_start = openHouseStamp(document.getElementById('npOpenHouseStart').value, false);
    payload.open_house_end   = openHouseStamp(document.getElementById('npOpenHouseEnd').value, true);
  }

  payload.land_zoning              = landValue('npLandZoning');
  payload.land_building_rights_pct = landValue('npLandBuildingPct', parseFloat);
  payload.land_max_units           = landValue('npLandMaxUnits', v => parseInt(v, 10));
  payload.land_max_floors          = landValue('npLandMaxFloors', v => parseInt(v, 10));
  payload.land_planning_notes      = landValue('npLandPlanningNotes');

  if (resolvedLat) payload.lat = parseFloat(resolvedLat);
  if (resolvedLng) payload.lng = parseFloat(resolvedLng);

  // בעריכה: האם הכתובת בפועל השתנתה? רק אז נקלוט מידע תכנוני מחדש — לא בכל שמירה,
  // כדי לא לבזבז קריאות WFS מיותרות על שינויים שלא נוגעים לכתובת (מחיר, תיאור וכו').
  const addressActuallyChanged = editingPropertyId && editingPropertyOriginalAddress &&
    (editingPropertyOriginalAddress.street !== street || editingPropertyOriginalAddress.house_number !== houseNumber);

  // שומרים קודם את הנכס ורק אז מעלים תמונות: הנתיב ב-Storage מכיל את
  // property_id, שקיים רק אחרי ה-insert. אם ההעלאה תיכשל, הנכס עצמו כבר
  // שמור והסוכן יכול לנסות שוב דרך "עריכה" במקום לאבד את כל הטופס.
  let error, newPropertyId = editingPropertyId;
  // מה שנשלח בפועל לשדות הטקסט הציבוריים — מול זה נבדק מה שחזר מהמסד
  let sentText = payload;
  // הנכס שהוחזר מהארכיון (או עודכן במקום פרסום כפול) — נשמר כדי שהמדיה
  // הקיימת לא תימחק בהמשך ושההודעה בסוף תגיד מה באמת קרה
  let restoredProperty = null;
  // נכס חדש נוצר תמיד כ-‎unpublished‎ ומתפרסם בצעד נפרד (ראו ההערה למטה).
  // ‏publishAfterInsert מכבה את הצעד הזה כשהסוכן/ת בחר/ה לשמור בלי לפרסם,
  // ו-publishError נושא את סיבת הסירוב אל הודעת הסיום.
  let publishAfterInsert = false;
  let publishError = null;
  let signExclusivityAfterSave = false;
  const ownerName = document.getElementById('npOwnerName').value.trim();
  const ownerPhone = document.getElementById('npOwnerPhone').value.trim();
  if (editingPropertyId){
    ({ error } = await sb.from('properties').update(payload).eq('id', editingPropertyId));
  } else {
    btn.textContent = 'בודק כפילות…';
    const duplicate = await findPropertyDuplicate(payload);
    const choice = duplicate ? await confirmDuplicateProperty(duplicate) : 'new';
    if (choice === 'cancel'){
      btn.disabled = false; btn.textContent = 'פרסום הנכס';
      return;
    }
    btn.textContent = 'מפרסם…';

    if (choice === 'restore'){
      restoredProperty = duplicate.match;
      const patch = propNonEmptyPatch(payload);
      sentText = patch;
      patch.status = 'active';
      // תוקף שכבר עבר היה מחזיר את המודעה למצב "פג תוקף" באותו רגע — כמו
      // ב-setPropertyStatus, הוא מתאפס והסוכן/ת יכול/ה להגדיר חדש בעריכה
      if (propertyIsExpired(restoredProperty) && !payload.listing_expires_at){
        patch.listing_expires_at = null;
      }
      ({ error } = await sb.from('properties').update(patch).eq('id', restoredProperty.id));
      newPropertyId = restoredProperty.id;
    } else {
      /* אימות חוצה־משרדים לפני היצירה: ‏findPropertyDuplicate מעל רואה רק
         את הנכסים של הסוכן/ת עצמו/ה, והכפילות שבאמת מזיקה היא זו שבין
         משרדים — אותה דירה שבעליה מסרו לחמישה משרדים. */
      btn.textContent = 'מאמת מול המערכת…';
      const verdict = await checkPropertyAvailability(payload, ownerPhone);
      publishAfterInsert = true;
      if (verdict && PROPERTY_BLOCK_STATES.includes(verdict.state)){
        if (await confirmBlockedProperty(verdict) === 'cancel'){
          btn.disabled = false; btn.textContent = 'פרסום הנכס';
          return;
        }
        publishAfterInsert = false;   // נשמר אצל הסוכן/ת, לא עולה לאתר
        // הכפתור בחלון הבטיח גם החתמת בלעדיות — האשף נפתח על הנכס שנשמר,
        // בסוף השמירה. כפילות בתוך אותו משרד אינה עניין של בלעדיות אלא של
        // תיאום בין שני סוכנים, ולכן שם האשף לא נפתח.
        signExclusivityAfterSave = verdict.state !== 'duplicate_same_agency';
      }
      btn.textContent = publishAfterInsert ? 'מפרסם…' : 'שומר…';

      payload.agency_id = currentAgent.agency_id;
      payload.agent_id = currentAgent.id;
      /* הנכס נוצר כ-‎unpublished‎ ומתפרסם רק אחרי שפרטי הבעלים נשמרו.
         זה לא זהירות יתר: זהות הבעלים יושבת ב-‎property_owners‎, שנכתבת רק
         אחרי שיש ‎property_id‎ — ובלעדיה החסימה במסד אינה יכולה להבדיל בין
         "אותה דירה" לבין "הדירה השכנה, אותה קומה ואותו מספר חדרים", והייתה
         חוסמת מודעה תקינה. */
      payload.status = 'unpublished';
      const { data: inserted, error: insertErr } = await sb.from('properties').insert(payload).select('id').single();
      error = insertErr;
      newPropertyId = inserted?.id;
    }
  }

  // פרטי הבעלים יושבים בטבלה נפרדת (property_owners) כי properties נקראת
  // על ידי כל גולש/ת. השמירה נפרדת, ולכן כישלון כאן לא מפיל את שמירת הנכס.
  if (!error && newPropertyId){
    const { error: ownerErr } = (ownerName || ownerPhone)
      ? await sb.from('property_owners').upsert({
          property_id: newPropertyId,
          owner_name: ownerName || null,
          owner_phone: ownerPhone || null,
        }, { onConflict: 'property_id' })
      : await sb.from('property_owners').delete().eq('property_id', newPropertyId);
    if (ownerErr){
      console.error(ownerErr);
      showToast('הנכס נשמר, אך פרטי הבעלים לא נשמרו: ' + ownerErr.message);
    }
  }

  /* הפרסום עצמו — אחרי שהבעלים נשמרו, כי הם חלק מזהות הנכס שהמסד בודק.
     סירוב כאן אינו מאבד את הטופס: הנכס כבר קיים כ"ירד מפרסום", והסיבה
     נאמרת בעברית בהודעת הסיום יחד עם הדרך להמשיך (בלוק הסטטוס בכרטיס). */
  if (!error && newPropertyId && publishAfterInsert){
    btn.textContent = 'מפרסם…';
    const { error: pubErr } = await sb.from('properties').update({ status: 'active' }).eq('id', newPropertyId);
    if (pubErr) publishError = pubErr;
  }

  if (!error && newPropertyId){
    // שם השלב נשמר כדי שהודעת הכישלון תגיד מה בדיוק לא עלה — סרטון של 50MB
    // נופל מסיבות אחרות מתמונה של 300KB, ו"העלאת הקבצים נכשלה" לא עוזר לאף אחד.
    let mediaStage = 'העלאת התמונות';
    try{
      btn.textContent = 'מעלה תמונות…';
      const urls = await resolveImageUrls(newPropertyId);
      const marketingUrl = await resolveMarketingImageUrl(newPropertyId);

      mediaStage = 'העלאת הסרטון';
      if (videoSlot && !videoSlot.url) btn.textContent = 'מעלה סרטון…';
      const uploadedVideoUrl = await resolveVideoUrl(newPropertyId);

      mediaStage = 'שמירת קישורי המדיה';
      const mediaPatch = { images: urls, marketing_image: marketingUrl, video_url: uploadedVideoUrl ?? videoUrl };
      // נכס שהוחזר מהארכיון: טופס "נכס חדש" נפתח בלי מדיה, ולכן ערך ריק כאן
      // הוא "לא העליתי כלום" ולא "מחקו את התמונות שכבר יש"
      if (restoredProperty){
        if (!urls.length && (restoredProperty.images || []).length) delete mediaPatch.images;
        if (!marketingUrl && restoredProperty.marketing_image) delete mediaPatch.marketing_image;
        if (!mediaPatch.video_url && restoredProperty.video_url) delete mediaPatch.video_url;
      }
      // כל שלושת השדות נשמרו כפי שהיו — אין מה לכתוב, ו-update ריק הוא שגיאה
      const { error: imgErr } = Object.keys(mediaPatch).length
        ? await sb.from('properties').update(mediaPatch).eq('id', newPropertyId)
        : {};
      if (imgErr) throw imgErr;
      cleanupReplacedVideo(uploadedVideoUrl ?? videoUrl);
    } catch(imgError){
      console.error(imgError);
      btn.disabled = false; btn.textContent = editingPropertyId ? 'שמירת שינויים' : 'פרסום הנכס';
      feedback.style.color = 'var(--brick)';
      feedback.textContent = `הנכס נשמר, אך ${mediaStage} נכשלה: ` + (imgError.message || 'שגיאה');
      await loadProperties(currentAgent.id);
      return;
    }
  }

  btn.disabled = false; btn.textContent = editingPropertyId ? 'שמירת שינויים' : 'פרסום הנכס';
  if (error){
    console.error(error);
    feedback.style.color = 'var(--brick)';
    // שגיאת חסימה מגיעה מהטריגר במסד ומנוסחת בעברית — מציגים אותה כמו שהיא
    feedback.textContent = 'שגיאה: ' + propertyStatusErrorText(error);
    return;
  }
  // הנכס נשמר אך לא עלה לאתר — או כי הסוכן/ת בחר/ה בכך, או כי המסד סירב
  let savedWithoutPublishing = false;
  if (publishError || (!editingPropertyId && !restoredProperty && !publishAfterInsert)){
    savedWithoutPublishing = true;
    feedback.style.color = 'var(--brick)';
    feedback.textContent = (publishError
      ? 'הנכס נשמר אך לא פורסם - ' + propertyStatusErrorText(publishError)
      : 'הנכס נשמר במצב "ירד מפרסום" ולא עלה לאתר.')
      + ' אפשר להחתים בלעדיות ולפרסם אותו מבלוק הסטטוס שבכרטיס הנכס.';
  } else {
    feedback.style.color = 'var(--teal)';
    feedback.textContent = restoredProperty
      ? (restoredProperty.status === 'active'
          ? `המודעה הקיימת (#${restoredProperty.listing_number ?? '-'}) עודכנה - לא נוצרה מודעה כפולה`
          : `המודעה הוחזרה מהארכיון ועודכנה (#${restoredProperty.listing_number ?? '-'})`)
      : (editingPropertyId ? 'הנכס עודכן בהצלחה!' : 'הנכס פורסם בהצלחה!');
  }

  await reportOwnerRedaction(newPropertyId, sentText);

  // קליטת/עדכון מידע תכנוני: (א) פעם ראשונה בקליטת נכס חדש, או (ב) כשהכתובת השתנתה
  // בעריכה — כדי לשמור על דיוק המידע. לא נשלף מחדש בשמירות שלא נוגעות לכתובת.
  // נכס שהוחזר מהארכיון כבר נסרק בעבר על אותה כתובת — אין טעם בקריאת WFS נוספת
  const shouldFetchPlanning = (!editingPropertyId && !restoredProperty && newPropertyId && street && houseNumber) ||
    (addressActuallyChanged && street && houseNumber);

  if (shouldFetchPlanning){
    planningStatus.textContent = editingPropertyId ? 'הכתובת השתנתה - מעדכן מידע תכנוני…' : 'קולט מידע תכנוני ברקע…';
    try{
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUPABASE_URL + '/functions/v1/afula-planning-lookup', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
        body: JSON.stringify({ street, house_number: houseNumber }),
      });
      const planData = await res.json();
      if (res.ok && planData.data){
        const d = planData.data;
        await sb.from('property_planning_info').upsert({
          property_id: newPropertyId,
          gush: d.gush, helka: d.helka,
          parcel_area_sqm: d.parcel_area_sqm, parcel_status: d.parcel_status,
          land_use_designation: d.land_use_designation,
          applicable_plans: d.applicable_plans,
          geometry_wgs84: d.geometry_wgs84,
          lat: d.lat, lng: d.lng,
          looked_up_at: new Date().toISOString(),
        }, { onConflict: 'property_id' });
        planningStatus.textContent = 'מידע תכנוני עודכן ונשמר לנכס ✓';
      } else if (planData.error === 'upgrade_required'){
        planningStatus.textContent = 'מידע תכנוני לא נקלט - זמין ב-PROFESSIONAL וב-Elite';
      } else {
        planningStatus.textContent = 'לא נמצא מידע תכנוני לכתובת זו';
      }
    } catch(err){
      console.warn('planning auto-fetch failed:', err);
      planningStatus.textContent = '';
    }
  }

  document.getElementById('addPropertyForm').reset();
  document.getElementById('npCity').value = 'עפולה';
  // ‏reset() מרוקן את שדה הרחוב אך לא את ההערה שמתחתיו
  document.getElementById('npStreetHint').innerHTML = '';
  // ‏form.reset() לא מחזיר את בורר סוכן 2 למצב "ללא": האפשרויות שלו נבנות
  // בקוד, ושדות השם והטלפון עשויים להישאר לקריאה בלבד מהבחירה הקודמת.
  populateAgent2Select('', '');
  resetImageState();
  syncMarketingCopyField(null);
  // ‏reset() מכבה את תיבת הסימון אך לא מקפל את שדות התאריך שנפתחו בגללה
  syncOpenHouseFields();
  renderPropertyStatusPanel(null);
  editingPropertyId = null;
  editingPropertyOriginalAddress = null;
  currentCategory = 'residential';
  document.querySelectorAll('[data-category]').forEach(b=> b.classList.toggle('active', b.dataset.category === 'residential'));
  updateFormForCategory('residential');
  await loadProperties(currentAgent.id);
  // הנכס שזה עתה פורסם עשוי להתאים ללקוח/ה בקובץ שלך — הטריגר כבר פתח את
  // ההתראה, וכאן היא נשלפת בלי שיהיה צורך לרענן את העמוד
  await loadClientAlerts();
  // ואותו נכס עשוי להיות הראשון, ולסגור צעד במדריך ההתחלה
  refreshOnboarding();
  /* נכס שנשמר ולא פורסם: ההודעה מסבירה למה ומה עושים הלאה, ו-1.5 שניות
     אינן מספיקות כדי לקרוא אותה. הטופס נשאר פתוח עד שסוגרים אותו. */
  if (!savedWithoutPublishing){
    setTimeout(()=>{
      addForm.style.display='none';
      toggleBtn.textContent='+ הוספת נכס חדש';
      document.getElementById('addPropertyBtn').textContent = 'פרסום הנכס';
      feedback.textContent='';
    }, 1500);
  }

  // "שמירה בלי פרסום + החתמת בלעדיות" — החלק השני של ההבטחה. האשף נפתח
  // כאן ולא לפני השמירה, כי הוא דורש property_id.
  if (signExclusivityAfterSave && newPropertyId){
    await openAgreementWizard({
      kind: payload.deal_type === 'rent' ? 'exclusive_landlord' : 'exclusive_sell',
      propertyId: newPropertyId,
    });
  }
});

/* ---------- חיפוש, סינון ומיון ברשימת "הנכסים שלי" ----------
   הרשימה נטענת פעם אחת ל-myPropertyRows, וכל סינון/מיון הוא מקומי: הסוכן/ת
   מקליד/ה בשדה החיפוש תוך כדי גלילה, ואין סיבה להחזיר את המסך למצב "טוען…"
   על כל תו. לכן loadProperties() אחראית רק על הבאת הנתונים ועל המידע הנלווה
   (צפיות, מידע תכנוני, ספירת שת״פ), ו-renderProperties() על התצוגה.       */
/* חמישה מצבים, ושלושה מהם אינם "לא פעיל" סתם:
     active       — באוויר, נקרא על ידי כל גולש/ת
     unpublished  — ירד מפרסום זמנית. המודעה חיה, היא פשוט לא באתר עכשיו
     sold/rented  — העסקה נסגרה, והנכס נכנס ל"עסקאות אחרונות"
     archived     — ארכיון: לא עובדים עליו, ולא רוצים לראות אותו ברשימה
   ההפרדה בין ‎unpublished‎ ל-‎archived‎ היא כל הטעם: עד שהיא נוספה, סוכן/ת
   שרצה/תה להוריד מודעה לשבועיים בחר/ה בין "נמכר" שהוא שקר שנכנס לאתר לבין
   "הוסר" שנראה כמו סוף הדרך — ובפועל השאיר/ה את המודעה באוויר. */
const PROPERTY_STATUS_LABELS = {
  active:'מפורסם', unpublished:'ירד מפרסום', sold:'נמכר', rented:'הושכר', archived:'בארכיון',
};

/* שלושה גוונים ולא שניים: ירוק למה שחי באתר עכשיו, זהב למה שיורד ממנו
   זמנית ואמור לחזור, ואפור למה שנסגר. "ירד מפרסום" באפור היה נראה כמו
   ארכיון — וזו בדיוק ההבחנה שהוספנו. */
function propertyStatusPillClass(status){
  if (status === 'active') return 'status-unlocked';
  if (status === 'unpublished') return 'status-masked';
  return 'status-off';
}

/* ---------- הרשימה כטאבים ----------
   כרטיס נכס מלא הוא חצי מסך טלפון, וסוכן/ת עם חמישים נכסים גלל/ה עשרים
   מסכים כדי למצוא אחד. לכן הרשימה מציגה טאבים קצרים — סוג, כתובת ומחיר —
   ורק לחיצה על טאב פותחת מתחתיו את הכרטיס המלא כפי שהיה, על כל התגיות
   והפעולות שבו.

   הרשימה עצמה היא אזור גלילה בגובה של כעשרה טאבים: גוללים בתוכה למעלה
   ולמטה, בלי כפתורי דפדוף. הטאבים נבנים בקבוצות של עשרה תוך כדי גלילה
   (‏IntersectionObserver על סוף הרשימה) — כך גם חמש מאות נכסים לא בונים
   חמש מאות שורות DOM בטעינה הראשונה. */
const PROP_TABS_CHUNK = 10;
let propTabsShown = PROP_TABS_CHUNK;
let propTabsObserver = null;
const expandedPropertyIds = new Set();

let myPropertyRows = [];
let myPropertyAgentId = null;
let propertyViewCounts = {};
let propertyPlanningInfo = {};

// טקסט אחד לחיפוש חופשי בכל מה שמזהה נכס — כולל בעל/ת הנכס, שגלוי רק כאן
function propertySearchBlob(p){
  const ownerRow = Array.isArray(p.property_owners) ? p.property_owners[0] : p.property_owners;
  // שם השכונה יושב בטבלה נפרדת; אם המטמון עוד לא נטען פשוט לא מחפשים לפיו
  const neighborhood = allNeighborhoods.find(n => n.id === p.neighborhood_id);
  return [
    p.title, p.city, neighborhood?.name, p.sales_area, p.street, p.house_number,
    p.property_type, p.description, p.marketing_description,
    p.listing_number != null ? '#' + p.listing_number : null,
    p.listing_number, p.agent2_name,
    ownerRow?.owner_name, ownerRow?.owner_phone,
    PROPERTY_STATUS_LABELS[p.status],
  ].filter(v => v !== null && v !== undefined && v !== '').join(' ').toLowerCase();
}

function propertyIsPromoted(p){
  return !!p.is_promoted && (!p.promoted_until || msLeft(p.promoted_until) > 0);
}
function propertyIsExpired(p){
  return !!p.listing_expires_at &&
    new Date(p.listing_expires_at) < new Date(new Date().toDateString());
}

// מיון עולה/יורד על שדה מספרי: ערך חסר תמיד יורד לסוף, בשני הכיוונים —
// נכס בלי מ״ר לא אמור לקפוץ לראש הרשימה רק כי מיינו מהנמוך לגבוה
function numericCompare(a, b, dir){
  const av = (a === null || a === undefined || a === '') ? null : Number(a);
  const bv = (b === null || b === undefined || b === '') ? null : Number(b);
  const aMissing = av === null || Number.isNaN(av);
  const bMissing = bv === null || Number.isNaN(bv);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === 'asc' ? av - bv : bv - av;
}
const hebCompare = (a, b) => String(a || '').localeCompare(String(b || ''), 'he');
const timeCompare = (a, b, dir) =>
  dir === 'asc' ? new Date(a || 0) - new Date(b || 0) : new Date(b || 0) - new Date(a || 0);

// בונה את רשימות הסינון מהנכסים שנטענו בפועל, ולא מרשימת הסוגים המלאה —
// אין טעם להציע "בית מלון" לסוכן/ת שכל הנכסים שלו/ה דירות
function syncPropertyFilterOptions(){
  fillFilterSelect('propTypeFilter',
    uniqueSorted(myPropertyRows.map(p => p.property_type)), 'כל סוגי הנכס');
  fillFilterSelect('propCityFilter',
    uniqueSorted(myPropertyRows.map(p => p.city)), 'כל הערים');
}

function uniqueSorted(values){
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => hebCompare(a, b));
}

// שמירה על הבחירה הקיימת כשהרשימה נבנית מחדש (אחרי הוספה/עריכה של נכס)
function fillFilterSelect(selectId, values, allLabel){
  const select = document.getElementById(selectId);
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `<option value="">${esc(allLabel)}</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (values.includes(previous)) select.value = previous;
}

// מצב הפקדים כאובייקט אחד — משמש גם לסינון, גם לשורת הספירה וגם לכפתור הניקוי
function propertyFilterState(){
  const val = id => (document.getElementById(id)?.value ?? '');
  return {
    q: val('propSearch').trim().toLowerCase(),
    status: val('propStatusFilter'),
    deal: val('propDealFilter'),
    type: val('propTypeFilter'),
    city: val('propCityFilter'),
    extra: val('propExtraFilter'),
    sort: val('propSort') || 'created_desc',
  };
}

function filterProperties(rows, f){
  return rows.filter(p => {
    if (f.status && p.status !== f.status) return false;
    if (f.deal && p.deal_type !== f.deal) return false;
    if (f.type && p.property_type !== f.type) return false;
    if (f.city && p.city !== f.city) return false;
    if (f.extra === 'promoted'   && !propertyIsPromoted(p)) return false;
    if (f.extra === 'shared'     && !p.shared_with_partners) return false;
    if (f.extra === 'not_shared' && p.shared_with_partners) return false;
    if (f.extra === 'no_images'  && (p.images && p.images.length)) return false;
    if (f.extra === 'expired'    && !propertyIsExpired(p)) return false;
    if (!f.q) return true;
    return propertySearchBlob(p).includes(f.q);
  });
}

function sortProperties(rows, sort){
  const sorted = rows.slice();
  const comparators = {
    created_desc: (a, b) => timeCompare(a.created_at, b.created_at, 'desc'),
    created_asc:  (a, b) => timeCompare(a.created_at, b.created_at, 'asc'),
    price_desc:   (a, b) => numericCompare(a.price, b.price, 'desc'),
    price_asc:    (a, b) => numericCompare(a.price, b.price, 'asc'),
    rooms_desc:   (a, b) => numericCompare(a.rooms, b.rooms, 'desc'),
    rooms_asc:    (a, b) => numericCompare(a.rooms, b.rooms, 'asc'),
    size_desc:    (a, b) => numericCompare(a.size_sqm, b.size_sqm, 'desc'),
    views_desc:   (a, b) => numericCompare(propertyViewCounts[a.id] || 0, propertyViewCounts[b.id] || 0, 'desc'),
    title_asc:    (a, b) => hebCompare(a.title, b.title),
  };
  return sorted.sort(comparators[sort] || comparators.created_desc);
}

// "מציג X מתוך Y" מופיע רק כשמשהו באמת מסונן — אחרת זו שורה מיותרת
function updateFilterFoot(countId, clearId, shown, total, active){
  const countEl = document.getElementById(countId);
  const clearEl = document.getElementById(clearId);
  if (countEl) countEl.textContent = active ? `מציג ${shown} מתוך ${total}` : '';
  if (clearEl) clearEl.hidden = !active;
}

function renderProperties(){
  const listEl = document.getElementById('propertiesList');
  const toolbar = document.getElementById('propToolbar');
  if (!listEl) return;

  if (toolbar) toolbar.hidden = myPropertyRows.length === 0;

  if (myPropertyRows.length === 0){
    listEl.innerHTML = '<div class="empty-state">עדיין לא פרסמת נכסים.</div>';
    updateFilterFoot('propFilterCount', 'propClearFilters', 0, 0, false);
    return;
  }

  const f = propertyFilterState();
  const active = !!(f.q || f.status || f.deal || f.type || f.city || f.extra);
  const rows = sortProperties(filterProperties(myPropertyRows, f), f.sort);
  updateFilterFoot('propFilterCount', 'propClearFilters', rows.length, myPropertyRows.length, active);

  if (rows.length === 0){
    listEl.innerHTML = '<div class="empty-state">אין נכס שמתאים לחיפוש או לסינון הנוכחי.</div>';
    return;
  }
  renderPropertyTabs(listEl, rows, myPropertyAgentId);
}

function clearPropertyFilters(){
  ['propSearch','propStatusFilter','propDealFilter','propTypeFilter','propCityFilter','propExtraFilter']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderPropertiesFromTop();
}

// כל שינוי בסינון/מיון מחזיר את הרשימה לראשה: מקום הגלילה של רשימה קודמת
// אינו אומר דבר על הרשימה החדשה
function renderPropertiesFromTop(){
  propTabsShown = PROP_TABS_CHUNK;
  const scroller = document.querySelector('#propertiesList .prop-scroll');
  if (scroller) scroller.scrollTop = 0;
  renderProperties();
}

document.getElementById('propSearch').addEventListener('input', renderPropertiesFromTop);
['propStatusFilter','propDealFilter','propTypeFilter','propCityFilter','propExtraFilter','propSort']
  .forEach(id => document.getElementById(id).addEventListener('change', renderPropertiesFromTop));
document.getElementById('propClearFilters').addEventListener('click', clearPropertyFilters);

/* רשימת העמודות של "הנכסים שלי". קבוע ולא מחרוזת אינליין, כי גם ייצוא
   הנכסים לאקסל שולף את אותן עמודות — עמודה שנוספת כאן חייבת להגיע גם לקובץ
   שיורד, ושתי רשימות היו נפרדות תוך שבוע. */
const PROPERTY_SELECT_COLUMNS = 'id, listing_number, title, price, price_per_sqm, deal_type, rooms, property_type, status, created_at, updated_at, is_promoted, promoted_until, last_free_bump_at, images, marketing_image, city, neighborhood_id, sales_area, street, house_number, lat, lng, category, features, condition, project_status, floor, total_floors, size_sqm, built_size_sqm, garden_sqm, description, marketing_description, marketing_description_source, marketing_description_at, marketing_description_stale, post_text, furniture_details, tour_3d_url, has_virtual_tour, video_url, listing_expires_at, agent2_name, agent2_phone, move_in_date, move_in_soon, open_house, open_house_start, open_house_end, restrooms_location, storage_location, mamad_location, land_zoning, land_building_rights_pct, land_max_units, land_max_floors, land_planning_notes, shared_with_partners, shared_at, property_owners(owner_name, owner_phone)';

async function loadProperties(agentId){
  const listEl = document.getElementById('propertiesList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data: props, error } = await sb
    .from('properties')
    .select(PROPERTY_SELECT_COLUMNS)
    .eq('agent_id', agentId)
    .order('created_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת נכסים: ' + error.message + '</div>';
    return;
  }
  accSetCount('accProperties', (props||[]).length);
  // סיכום ללא פתיחה: כמה מהם חיים באתר עכשיו, וכמה כסף הם מייצגים
  const activeProps = (props||[]).filter(p => p.status === 'active');
  accSetSummary('accProperties', activeProps.length
    ? plural(activeProps.length, 'נכס אחד פעיל', 'פעילים') + ' · ' + priceRangeLabel(activeProps.map(p => p.price))
    : ((props||[]).length ? 'אין נכסים פעילים' : ''));
  dashProperties = props || [];
  myPropertyRows = props || [];
  myPropertyAgentId = agentId;
  renderDashboardOverview();
  if (!props || props.length === 0){
    propertyViewCounts = {}; propertyPlanningInfo = {}; propertyShareCounts = {};
    syncPropertyFilterOptions();
    renderProperties();
    return;
  }
  const propertyIds = props.map(p=>p.id);
  const { data: viewRows } = await sb.from('property_views').select('property_id').in('property_id', propertyIds);
  propertyViewCounts = {};
  (viewRows||[]).forEach(v => { propertyViewCounts[v.property_id] = (propertyViewCounts[v.property_id]||0) + 1; });

  const { data: planningRows } = await sb.from('property_planning_info').select('*').in('property_id', propertyIds);
  propertyPlanningInfo = {};
  (planningRows||[]).forEach(pl => { propertyPlanningInfo[pl.property_id] = pl; });

  // כמה משרדים קיבלו בפועל כל נכס — ה-policy על property_shares מחזירה לבעל
  // הנכס את השורות שלו, ולכן אפשר לספור מכאן בלי לעבור דרך פונקציה
  propertyShareCounts = {};
  const { data: shareRows } = await sb.from('property_shares')
    .select('property_id').in('property_id', propertyIds);
  (shareRows||[]).forEach(s => {
    propertyShareCounts[s.property_id] = (propertyShareCounts[s.property_id]||0) + 1;
  });

  // כדי שהחיפוש החופשי יכסה גם שם שכונה — הקריאה ממוטמעת ומחזירה מיד
  // אחרי הפעם הראשונה
  await ensureNeighborhoodsLoaded();

  syncPropertyFilterOptions();
  renderProperties();
}

/* ---- הטאבים: השורה הקצרה, אזור הגלילה, והכרטיס שנפתח מתחתיה ---- */

// הכתובת כפי שהיא נמסרת בטלפון — רחוב ומספר, ואז העיר. אין רחוב (קרקע
// חקלאית, מגרש) — נופלים לכותרת המודעה, שתמיד קיימת.
function propertyTabAddress(p){
  const street = [p.street, p.house_number].filter(Boolean).join(' ');
  return [street, p.city].filter(Boolean).join(', ') || (p.title || '').trim();
}

function renderPropertyTabs(listEl, rows, agentId){
  // פעולה על נכס (קידום, סימון כנמכר, עריכה) טוענת את הרשימה מחדש. בלי
  // שמירת מקום הגלילה הרשימה הייתה קופצת לראשה אחרי כל פעולה, והנכס
  // שעבדו עליו נעלם מהמסך.
  const keepScroll = listEl.querySelector('.prop-scroll')?.scrollTop || 0;
  propTabsObserver?.disconnect();
  propTabsObserver = null;
  propTabsShown = Math.min(Math.max(propTabsShown, PROP_TABS_CHUNK), rows.length);

  listEl.innerHTML = `
    <div class="prop-scroll" tabindex="0" role="region" aria-label="רשימת הנכסים שלי - ניתן לגלול">
      <div class="prop-progress" aria-hidden="true"><span></span></div>
      <div class="prop-tabs"></div>
      <div class="prop-tail" aria-hidden="true"></div>
    </div>
    <div class="prop-scroll-foot">
      <span class="prop-scroll-hint" aria-live="polite"></span>
      <button type="button" class="prop-to-top" hidden>↑ לראש הרשימה</button>
    </div>`;

  const scroller = listEl.querySelector('.prop-scroll');
  const tabsWrap = listEl.querySelector('.prop-tabs');
  const tail     = listEl.querySelector('.prop-tail');
  const hint     = listEl.querySelector('.prop-scroll-hint');
  const toTop    = listEl.querySelector('.prop-to-top');

  const drawTabs = ()=>{
    for (let i = tabsWrap.childElementCount; i < propTabsShown; i++){
      tabsWrap.appendChild(buildPropertyTab(rows[i], agentId));
    }
    hint.textContent = propTabsShown >= rows.length
      ? `כל ${rows.length} הנכסים ברשימה`
      : `מוצגים ${propTabsShown} מתוך ${rows.length} · גללו להמשך`;
    // מד ההתקדמות מופיע רק כשיש מה לגלול
    scroller.classList.toggle('is-scrollable', scroller.scrollHeight > scroller.clientHeight + 4);
  };

  const growList = ()=>{
    if (propTabsShown >= rows.length) return;
    propTabsShown = Math.min(propTabsShown + PROP_TABS_CHUNK, rows.length);
    drawTabs();
    if (propTabsShown >= rows.length){ propTabsObserver?.disconnect(); propTabsObserver = null; }
    fillViewport();
  };

  // ‏IntersectionObserver מדווח על *שינוי* חיתוך, ולכן סוף רשימה שנשאר גלוי
  // אחרי הוספת קבוצה לא היה מדווח שוב והטעינה הייתה נעצרת. הבדיקה הזו
  // ממשיכה למלא כל עוד סוף הרשימה עדיין בתוך אזור הגלילה.
  const fillViewport = ()=> requestAnimationFrame(()=>{
    if (propTabsShown >= rows.length || !tail.isConnected) return;
    if (tail.getBoundingClientRect().top <= scroller.getBoundingClientRect().bottom + 160) growList();
  });

  drawTabs();
  if (propTabsShown < rows.length){
    if ('IntersectionObserver' in window){
      propTabsObserver = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) growList();
      }, { root: scroller, rootMargin: '160px' });
      propTabsObserver.observe(tail);
      fillViewport();
    } else {
      propTabsShown = rows.length;
      drawTabs();
    }
  }

  scroller.scrollTop = keepScroll;
  const syncToTop = ()=>{ toTop.hidden = scroller.scrollTop < 240; };
  scroller.addEventListener('scroll', syncToTop, { passive:true });
  toTop.addEventListener('click', ()=>{
    scroller.scrollTo({ top:0, behavior:'smooth' });
    scroller.focus({ preventScroll:true });
  });
  syncToTop();
}

/* ---------- שורת הטאב הגנרית ----------
   שמונה רשימות בדשבורד מדברות את המחווה הזו: קובץ הלקוחות, הלידים שלי,
   ושש רשימות חנות הלידים — מדף ורכישות לכל אחת משלוש המגירות. ‏
   `buildPropertyTab()` שמתחת הוא המקור שממנו היא נלקחה, והוא נשאר בנפרד:
   יש לו אזור גלילה משלו, טעינה בקבוצות ומצב שנשמר בין רינדורים.

   **הכל נכנס כטקסט, והפונקציה מבריחה** — ולא כ-HTML מוכן מכל קוראת. שמונה
   קוראות שכל אחת מבריחה בעצמה הן בדיוק המצב שבו אחת מהן שוכחת; זה הלקח
   של `escapeHtml` ב-CLAUDE.md, ולכן אין כאן דלת אחורית ל-HTML. האייקון
   הוא היחיד שנכנס כמו שהוא, והוא תמיד ליטרל מהטבלאות שבקוד.

   `list` הוא מרחב השם של מזהה הפאנל: אותו ליד יושב גם במדף וגם ברשימת
   הרכישות עם אותו `id`, ובלי הקידומת היו שני אלמנטים עם אותו `id` בדף.

   הכרטיס מגיע כפונקציה ולא כאלמנט בנוי: הוא נבנה בפתיחה ונזרק בסגירה,
   וזה כל מה שחוסך את מסך הכרטיסים המלאים שממנו ברחנו. */
function buildTabRow({ key, list = 'tab', expanded, cls = '', icon = '', title,
                       sub = '', pill = null, price = '', priceNote = '', buildCard }){
  const isOpen = expanded.has(key);
  const el = document.createElement('div');
  el.className = ('prop-tab ' + cls).trim() + (isOpen ? ' is-open' : '');
  const panelId = 'tabPanel-' + esc(list) + '-' + esc(String(key));

  el.innerHTML = `
    <button type="button" class="prop-tab-head" aria-expanded="${isOpen}" aria-controls="${panelId}">
      <span class="prop-tab-main">
        <span class="prop-tab-title">${icon ? icon + ' ' : ''}${esc(title)}</span>
        <span class="prop-tab-sub">${esc(sub)}</span>
      </span>
      ${pill ? `<span class="tab-pill ${esc(pill.cls || 'status-pill status-masked')}">${esc(pill.text)}</span>` : ''}
      ${price ? `<span class="prop-tab-price">${esc(price)}${
        priceNote ? ` <span class="per">${esc(priceNote)}</span>` : ''}</span>` : ''}
      <svg class="prop-tab-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div class="prop-tab-panel" id="${panelId}"${isOpen ? '' : ' hidden'}></div>`;

  const head = el.querySelector('.prop-tab-head');
  const panel = el.querySelector('.prop-tab-panel');
  const fillPanel = ()=> panel.appendChild(buildCard());
  if (isOpen) fillPanel();

  head.addEventListener('click', ()=>{
    const opening = !expanded.has(key);
    panel.innerHTML = '';
    if (opening){ expanded.add(key); fillPanel(); }
    else expanded.delete(key);
    panel.hidden = !opening;
    el.classList.toggle('is-open', opening);
    head.setAttribute('aria-expanded', String(opening));
    // כרטיס שנפתח בתחתית המסך נפתח מחוצה לו — ‏nearest מזיז את המינימום
    // הדרוש כדי לראות אותו, ולא מקפיץ את הדף כולו
    if (opening) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  return el;
}

/* תאריך קצר לשורת טאב: "18.9" למה שנכנס השנה, "18.9.25" לשנה אחרת.
   התאריך הוא הפרט האחרון בשורה, כלומר הראשון שנחתך כשהשם והעיר ארוכים —
   ותאריך מלא שנחתך באמצע ("…9.2026") נראה כמו תקלה. המלא ממתין בכרטיס. */
function tabShortDate(ts){
  const d = ts ? new Date(ts) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const short = d.getDate() + '.' + (d.getMonth() + 1);
  return d.getFullYear() === new Date().getFullYear()
    ? short : short + '.' + String(d.getFullYear()).slice(-2);
}

function buildPropertyTab(p, agentId){
  const isOpen = expandedPropertyIds.has(p.id);
  const el = document.createElement('div');
  el.className = 'prop-tab' + (isOpen ? ' is-open' : '');
  const panelId = 'propTabPanel-' + esc(String(p.id));
  const priceHtml = shekel(p.price) + (p.deal_type === 'rent' ? ' <span class="per">לחודש</span>' : '');
  // השורה השנייה היא רק מה שמזהה ומה שדחוף: המספר שנמסר בטלפון, הסטטוס,
  // וכוכב הקידום. כל השאר מחכה לפתיחת הכרטיס.
  const sub = [
    `מודעה #${esc(String(p.listing_number ?? '-'))}`,
    esc(PROPERTY_STATUS_LABELS[p.status] || p.status || ''),
    propertyIsPromoted(p) ? '🌟 מקודם' : '',
    OpenHouse.live(p) ? '🏷 ביריד' : '',
  ].filter(Boolean).join(' · ');

  el.innerHTML = `
    <button type="button" class="prop-tab-head" aria-expanded="${isOpen}" aria-controls="${panelId}">
      <span class="prop-tab-main">
        <span class="prop-tab-title">${esc(p.property_type || 'נכס')} · ${esc(propertyTabAddress(p))}</span>
        <span class="prop-tab-sub">${sub}</span>
      </span>
      <span class="prop-tab-price">${priceHtml}</span>
      <svg class="prop-tab-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div class="prop-tab-panel" id="${panelId}"${isOpen ? '' : ' hidden'}></div>`;

  const head = el.querySelector('.prop-tab-head');
  const panel = el.querySelector('.prop-tab-panel');
  // הכרטיס נבנה בפתיחה ונזרק בסגירה: עשרה כרטיסים מלאים בזיכרון הם בדיוק
  // המסך שממנו ברחנו, וגם מאזיני הפעולות שבהם נשארים תלויים
  const fillPanel = ()=> panel.appendChild(buildPropertyCard(p, agentId));
  if (isOpen) fillPanel();

  head.addEventListener('click', ()=>{
    const opening = !expandedPropertyIds.has(p.id);
    if (opening){
      expandedPropertyIds.add(p.id);
      panel.innerHTML = '';
      fillPanel();
    } else {
      expandedPropertyIds.delete(p.id);
      panel.innerHTML = '';
    }
    panel.hidden = !opening;
    el.classList.toggle('is-open', opening);
    head.setAttribute('aria-expanded', String(opening));
    // כרטיס שנפתח בתחתית אזור הגלילה נפתח מחוץ למסך — ‏nearest מזיז את
    // המינימום הדרוש כדי לראות אותו, ולא מקפיץ את הדף כולו
    if (opening) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
  });
  return el;
}

function buildPropertyCard(p, agentId){
  const statusLabels = PROPERTY_STATUS_LABELS;
  const viewCounts = propertyViewCounts;
  const planningByProperty = propertyPlanningInfo;

  const priceHtml = shekel(p.price) + (p.deal_type === 'rent' ? ' <span class="per">לחודש</span>' : '');
  // ‏promoted_until ריק = קידום ידני/היסטורי בלי מועד סיום, נחשב פעיל
  const isCurrentlyPromoted = propertyIsPromoted(p);
  // תוקף המודעה הוא תזכורת לסוכן/ת בלבד — הוא לא מוריד את הנכס מהאתר
  const expired = propertyIsExpired(p);
  // ‏property_owners מוגן ב-RLS, ולכן השורה הזו מגיעה רק לסוכן/ת של הנכס
  // ולמנהל/ת המשרד — ולכל האחרים היא פשוט לא קיימת בתשובה.
  const ownerRow = Array.isArray(p.property_owners) ? p.property_owners[0] : p.property_owners;
  const ownerName = (ownerRow?.owner_name || '').trim();
  const ownerPhone = localPhone(ownerRow?.owner_phone);
  const ownerWa = waLink(ownerRow?.owner_phone);
  const planning = planningByProperty[p.id];
  const mktState = marketingCopyState(p);
  const el = document.createElement('div');
  el.className = 'card lead-card prop-card' + (isCurrentlyPromoted ? ' is-promoted' : '');
  /* תמונת הכותרת, ולמה היא גדולה מהבול שבשורה הסגורה: הכרטיס הפתוח הוא
     הרגע שבו הסוכן/ת מוודא/ת שנפתח הנכס הנכון, ובול של 52px אינו מאפשר
     את זה. נכס בלי תמונות מקבל משבצת עם סמל בית ולא חור בפריסה - ולמה
     היא ריקה כתוב בתגית "ללא תמונות" שממילא מוצגת.
     ‏esc על ה-src: הכתובת מגיעה מהמסד, והיא נכנסת למאפיין. */
  const heroHtml = (p.images && p.images.length)
    ? `<img class="pc-hero-img" src="${esc(p.images[0])}" alt="" loading="lazy">`
    : `<span class="pc-hero-img pc-hero-ph" aria-hidden="true">${cardIconSvg('home')}</span>`;
  // כל פרט הוא תגית קצרה משלו: קודם המזהה שהסוכן/ת מוסר/ת בטלפון, אחר כך
  // מאפייני הנכס. **הסדר התהפך:** התגיות שדורשות פעולה עלו לראש הרשימה,
  // מיד אחרי המזהה, כי שורת התגיות מכווצת עכשיו לשתי שורות ומה שאינו נכנס
  // בהן יורד אל מאחורי "+N" (ראו clampCardTags). קודם הן ישבו בסוף והצבע
  // לבדו תפס את העין - אבל צבע אינו עוזר לתגית שאינה על המסך.
  //
  // ושלוש תגיות ירדו מכאן לגמרי, כולן כפילויות של מה שכבר מוצג:
  //   סוג הנכס  - הפרט הראשון בשורה הסגורה שמעל ("דירה · עלייה 7, עפולה")
  //   יריד      - אריח היריד אומר את אותם שלושה מצבים בדיוק, בצבע מלא
  const tags = tagsHtml([
    { text:`מודעה #${p.listing_number ?? '-'}`, cls:'tag-key' },
    expired && { text:`⏳ פג תוקף ${tabShortDate(p.listing_expires_at)}`, cls:'tag-warn' },
    (!p.images || !p.images.length) && { text:'📷 ללא תמונות', cls:'tag-warn' },
    // התיאור השיווקי הוא מה שמופיע בדף הנכס כשאין תיאור מודעה, ולכן
    // היעדרו הוא חוסר במודעה עצמה — באותו גוון אזהרה של "ללא תמונות".
    p.status === 'active' && mktState.tag && { text: mktState.tag, cls:'tag-warn' },
    p.rooms && { html:`🛏 <b>${esc(p.rooms)}</b> חדרים` },
    { html:`👁 <b>${viewCounts[p.id]||0}</b> צפיות` },
    p.price_per_sqm && { text:`📐 ${shekel(p.price_per_sqm)}/מ״ר` },
    // ‏"גו״ח" הוא הקיצור שמתווכים משתמשים בו ממילא, והוא חוסך כאן כמחצית
    // מרוחב התגית הארוכה ביותר בשורה
    planning && { text:`📍 גו״ח ${planning.gush||'-'}/${planning.helka||'-'}`, cls:'tag-info' },
    !expired && p.listing_expires_at && { text:`⏳ בתוקף עד ${tabShortDate(p.listing_expires_at)}` },
  ]);

  /* שני בנים ישירים: המידע והפעולות. בטלפון הם נערמים בסדר הזה, וברוחב
     של מחשב הם נפרסים לשתי עמודות. ההחלטה מתי נשענת על @container ולא
     על רוחב החלון; ראו ‎.prop-card‎ ב-CSS.

     ובלוק הסטטוס יושב **בשורת הכותרת**, בקצה שנשאר פנוי בה. קודם היה לו
     בלוק משלו ברוחב הכרטיס, ואז רצועה שנגללת לרוחב - שתיהן עלו בשורה
     שלמה על כל נכס שנפתח. השורה הזו כבר קיימת ממילא, והמקום בקצה שלה
     היה ריק: הסטטוס עולה שם אפס גובה. */
  /* שורת הבעלים, ולמה הטלפון בה הוא קישור ולא טקסט: זה המספר שהסוכן/ת
     מחייג/ת אליו יותר מכל מספר אחר במערכת - "מתי אפשר להראות", "ירדנו
     במחיר?", "יש הצעה". עד כה הוא היה טקסט אפור בתוך שורה, כלומר סימון
     בעכבר והעתקה, או הקלדה ידנית בטלפון.
     שתי דרכים כי שתיהן בשימוש: שיחה למי שעונה, וואטסאפ למי שלא.
     ‏bdi על המספר - ספרות בתוך שורה עברית הן רצף LTR שאלגוריתם ה-bidi
     מצרף אליו את מה שסביבו, ומספר שמופיע אחרי נקודה או מקף היה מוצג
     בסדר הפוך. */
  const ownerHtml = (ownerName || ownerPhone) ? `
    <div class="pc-owner">
      <span class="pc-owner-lbl">בעלים${ownerName ? ': ' + esc(ownerName) : ''}</span>
      ${ownerPhone ? `<a class="pc-owner-act" href="tel:${esc(ownerPhone)}"
        title="חיוג לבעל/ת הנכס">${cardIconSvg('phone')}<bdi>${esc(ownerPhone)}</bdi></a>` : ''}
      ${ownerWa ? `<a class="pc-owner-act pc-owner-wa" href="${esc(ownerWa)}"
        target="_blank" rel="noopener noreferrer"
        title="וואטסאפ לבעל/ת הנכס" aria-label="וואטסאפ לבעל/ת הנכס"
        >${cardIconSvg('chat')}<span>וואטסאפ</span></a>` : ''}
    </div>` : '';

  const sharePill = p.shared_with_partners
    ? `<span class="status-pill status-shared" title="בשת״פ · הופץ ${hebDate(p.shared_at)}">🤝 ${plural(propertyShareCounts[p.id] || 0, 'משרד אחד', 'משרדים')}</span>`
    : '';
  el.innerHTML = `
    <div class="pc-col-main">
      <div class="pc-hero">
        ${heroHtml}
        <div class="pc-hero-body">
          ${isCurrentlyPromoted && p.promoted_until ? `<span class="lead-kind">🌟 מקודם · ${esc(timeLeftLabel(p.promoted_until))}</span>` : (isCurrentlyPromoted ? '<span class="lead-kind">🌟 מקודם</span>' : '')}
          <div class="pc-hero-head">
            <div class="lead-name">${esc(p.title)}</div>
            <div class="pc-status-slot"></div>
          </div>
          <div class="prop-price">${priceHtml}</div>
          ${sharePill ? `<div class="pill-row">${sharePill}</div>` : ''}
        </div>
      </div>
      ${tags}
      ${ownerHtml}
      ${isCurrentlyPromoted && p.promoted_until ? `<div class="lead-meta">הקידום בתוקף עד ${hebDateTime(p.promoted_until)} · אחר כך ניתן לקדם שוב</div>` : ''}
    </div>
    <div class="pc-col-side">
      <div class="pc-sec-head pc-quick-head">פעולות מהירות</div>
      <div class="pc-grid"></div>
      <div class="pc-hub" hidden>
        <div class="pc-sec-head">כלי AI ודאטה</div>
        <div class="pc-hub-row"></div>
      </div>
    </div>
  `;
  const actions = el.querySelector('.pc-grid');
  const hub = el.querySelector('.pc-hub');
  const hubRow = hub.querySelector('.pc-hub-row');

  /* הסטטוס בשורת הכותרת: "האם המודעה באוויר" היא השאלה הראשונה שנשאלת
     על כל נכס, ולכן היא בשורה הראשונה - רק בלי לעלות בשורה משלה.
     ראו buildPropertyStatusPanel. */
  el.querySelector('.pc-status-slot').replaceWith(buildPropertyStatusPanel(p, agentId));

  /* סדר הפעולות, ולמה שני מקטעים ולא רשימה אחת: ראו את ההערה שמעל
     ‎.pc-grid‎ ב-CSS. כאן רק החלוקה עצמה -
       ‎actions‎ = כל מה שעושים לנכס, מהעריכה ועד ההכנסה ליריד,
       ‎hubRow‎  = כלי ה-AI והדאטה, שנדרשים פעם בכמה נכסים.
     התוויות ברשת קצרות במכוון: ברוחב עמודה של שליש מסך, כל מילה שנייה
     יורדת שורה ומגביהה את כל השורה. ההסבר המלא נשאר ב-title. */
  addQuickAction(actions, {
    label:'עריכה', icon:'pencil', tone:'teal',
    title:'עריכת פרטי המודעה', onClick:()=> openEditProperty(p),
  });

  if (p.status === 'active'){
    // הדרך לראות את המודעה כמו שהיא נראית ללקוח/ה - אותו עמוד שה-QR מוביל
    // אליו. בלשונית חדשה כדי שה-CRM יישאר פתוח מאחור, ורק לנכס פעיל: דף
    // הנכס טוען ‎status=active‎ בלבד ולכל השאר יציג "לא נמצא".
    // ראשון בשורה יחד עם "עריכה": זו הבדיקה שעושים מיד אחרי כל שינוי.
    addQuickAction(actions, {
      label:'דף נכס', icon:'link', tone:'teal',
      title:'פתיחת עמוד הנכס באתר בלשונית חדשה',
      href:'property.html?id=' + encodeURIComponent(p.id), blank:true,
    });
  }

  // החתמת בעל/ת הנכס - הטופס נפתח כשפרטי הנכס והבעלים כבר בתוכו
  addQuickAction(actions, {
    label:'החתמה', icon:'signature', tone:'green',
    title:'הזמנת שירותי תיווך מבעל/ת הנכס, עם פרטי הנכס שכבר במערכת',
    onClick:()=> openAgreementWizard({ kind: p.deal_type === 'rent' ? 'landlord' : 'sell', propertyId: p.id }),
  });

  if (p.status === 'active'){
    /* שת"פ ויריד הבתים הפתוחים היו שני כפתורים רחבים בשורה משלהם מתחת
       לרשת. שתי שורות שלמות לשתי פעולות, בזמן שהרשת שמעליהן נגמרה
       באמצע שורה - כלומר גם גובה מיותר וגם שתי שפות לאותו כרטיס. הן
       אריחים כמו כל השאר, והצבע הוא שממשיך לומר מה הן:

         שת"פ  - ירוק מלא כשהנכס עדיין לא מופץ, ירוק רך כשהוא כבר בשת"פ
                 (אז זו הפצה מחודשת, לא פתיחה).
         יריד  - אדום מלא כשהנכס מחוץ ליריד, אדום רך כשהוא בתוכו (אז זו
                 כבר תיאור מצב והדרך לשנות אותו, ולא קריאה לפעולה).

       זו בדיוק ההבחנה שהייתה בין ‎btn-share‎ ל-‎btn-ghost‎ ובין
       ‎btn-openhouse‎ ל-‎btn-openhouse-on‎, והיא עברה כמו שהיא לאריחים. */
    addQuickAction(actions, {
      label: p.shared_with_partners ? 'עדכון הפצה' : 'שת״פ',
      icon:'partners', tone: p.shared_with_partners ? 'green' : 'share',
      title: p.shared_with_partners
        ? 'הפצה מחודשת של הנכס למשרדים שברשימת השת״פ'
        : 'פתיחת הנכס לשיתוף פעולה - ההפצה יוצאת מיד למשרדים שברשימה',
      onClick: btn => shareProperty(p, btn, agentId),
    });

    /* יריד הבתים הפתוחים. מתוך כל הפעולות בכרטיס זו היחידה שמשנה את מה
       שהקונה ישלם בפועל, והיא גם היחידה שחוזרים אליה מדי כמה שבועות
       ("הנכס הזה, לשבועיים הקרובים"). לכן היא אריח מלא בצבע ולא עוד
       אריח בהיר ברשת - כפתור שמיני ברשת של שתים־עשרה פעולות הוא כפתור
       שאיש לא מצא, וזה בדיוק מה שקרה כשהשדות ישבו רק בטופס העריכה.

       התווית אומרת שלושה דברים שונים לפי מצב הנכס - מחוץ ליריד, בתוכו,
       או מחכה לתאריך - כי זו השאלה הראשונה שנשאלת במבט על הכרטיס. אין
       כאן מחיר: ההשתתפות חינם ובלי תלות במסלול. ראו docs/open-house-fair.md */
    const ohLive = OpenHouse.live(p);
    const ohSoon = OpenHouse.upcoming(p);
    addQuickAction(actions, {
      label: ohLive ? `ביריד · ${OpenHouse.endLabel(p)}`
           : ohSoon ? `ביריד מ-${OpenHouse.hebDay(OpenHouse.startsAt(p))}`
           : 'הכנסה ליריד',
      icon:'tag', tone: ohLive || ohSoon ? 'fair-on' : 'fair',
      title: ohLive || ohSoon
        ? 'שינוי תקופת ההשתתפות ביריד הבתים הפתוחים, או הוצאה ממנו'
        : 'הצעת הנכס ללא עמלת תיווך לקונה, לתקופה קצובה - בדף היריד ובסימן משלו על המפה',
      onClick: () => openOpenHouseModal(p, agentId),
    });

    addQuickAction(actions, {
      label:'הקפצה', icon:'arrowUp', tone:'green', badge:'חינם', badgeFree:true,
      title:'העלאת הנכס לראש התוצאות · פעם ב-24 שעות',
      onClick:btn => bumpProperty(p.id, btn, agentId),
    });

    if (!isCurrentlyPromoted){
      const price = shekel(priceOf('promote_price', 20));
      const hours = priceOf('promote_duration_hours', 72);
      addQuickAction(actions, {
        label:'קידום', icon:'megaphone', tone:'gold', badge:price,
        title:`קידום בתשלום - ${price} ל-${plural(hours, 'שעה אחת', 'שעות')} בסלוטים המקודמים`,
        onClick:btn => promoteProperty(p, btn, agentId),
      });
    }

    // מדבקה להדבקה על השלט בשטח - עמוד הנכס באתר מוצג רק לנכס פעיל,
    // ולכן גם הכפתור נמצא כאן ולא לצד "עריכה"
    addQuickAction(actions, {
      label:'מדבקת QR', icon:'qr', tone:'sand',
      title:'הפקת מדבקת QR להדבקה על השלט',
      onClick:btn => openQrSticker(p, btn),
    });

    if (p.shared_with_partners){
      addQuickAction(actions, {
        label:'ביטול שת״פ', icon:'close', tone:'red',
        title:'הפסקת השיתוף — הנכס יורד מרשימת השת״פ של המשרדים',
        onClick:btn => unshareProperty(p, btn, agentId),
      });
    }
  }

  // הכפתור מוצג רק ל-mid/premium; ה-gating עצמו נאכף ב-cma_report ב-DB.
  //
  // על נכס להשכרה הוא נשאר לחיץ בכוונה, ו-agent_cma_report היא שמסרבת עם
  // ‏rent_not_supported: מאגר העסקאות הוא מאגר מכר, והשוואת שכ״ד חודשי מולו
  // היא מספר חסר משמעות (היא הציגה "נמוך ב-99% מהשוק"). הכלל יושב במסד ולא
  // כאן מאותה סיבה שהגידור למסלול יושב שם - כפתור שנעלם נראה כמו באג,
  // וכלל שיושב בדפדפן בלבד אינו חל על העוזר בוואטסאפ.
  if (currentAgent && (currentAgent.tier === 'mid' || currentAgent.tier === 'premium')){
    addHubAction(hubRow, {
      label:'דוח CMA', icon:'chart',
      title: p.deal_type === 'rent'
        ? 'הדוח מבוסס על עסקאות מכר בלבד, ולכן אינו זמין לנכס להשכרה'
        : 'דוח השוואת מחירים לנכס, מהעסקאות באזור',
      onClick:btn => openCmaReport(p.id, btn),
    });
  }

  if (planning){
    addHubAction(hubRow, {
      label:'מידע תכנוני', icon:'map', title:'המידע התכנוני השמור של הנכס',
      onClick:()=>{
        renderPlanningResult(planning);
        // הכפתור יושב בכרטיס נכס, והמידע התכנוני יושב בלשונית אחרת של
        // הסרגל התחתון: בלי המעבר ללשונית הגלילה הגיעה לאלמנט שנמצא
        // ב-display:none, כלומר לשום מקום
        gotoSection('accPlanning', null, { scrollTo:'#planResultPanel' });
      },
    });
  }

  // כתיבת נוסח מהנתונים - הצעה בלבד, נשמרת רק באישור בתוך החלון.
  // "רענון" ולא "יצירה" כשכבר יש תיאור: זו אותה פעולה, אבל המילה אומרת
  // לסוכן/ת מה עומד להשתנות.
  // הכפתור מוצג ל-mid/premium בלבד, בדיוק כמו דוח CMA; ה-gating עצמו נאכף
  // ב-request_property_description ובתור עצמו, ולא כאן.
  if (p.status === 'active' && descriptionTierOk()){
    addHubAction(hubRow, {
      label: mktState.level === 'missing' ? 'תיאור שיווקי' : 'רענון תיאור',
      icon:'sparkles', title: mktState.note,
      onClick: btn => openMarketingCopy(p, btn, agentId),
    });
  }

  if (p.status === 'active'){
    /* הפקת סרטון שיווקי מהתמונות של הנכס.
       הכפתור מוצג ל-mid ול-premium בלבד - ‎free‎ אינו רואה אותו, וה-gating
       האמיתי נאכף ב-‎property_video_tier‎ ב-DB ולא כאן. שתי מילים שונות לאותה
       פעולה: נכס בלי סרטון "מפיק", ונכס שכבר יש לו סרטון "מחליף" - כי זו
       בדיוק ההבחנה שהסוכן/ת צריך/ה לעשות לפני שהקיים נמחק. */
    if (currentAgent && (currentAgent.tier === 'mid' || currentAgent.tier === 'premium')){
      const hasVideo = !!p.video_url;
      const isMid = currentAgent.tier === 'mid';
      const vidPrice = priceOf('property_video_price_mid', 25);
      addHubAction(hubRow, {
        label: hasVideo ? 'סרטון חדש'
             : isMid ? `סרטון · ${shekel(vidPrice)}`
             : 'הפקת סרטון',
        icon:'film',
        title: hasVideo
          ? 'הפקת סרטון שיווקי חדש מהתמונות — יחליף את הסרטון הקיים'
          : 'הפקת סרטון שיווקי קצר מהתמונות של הנכס',
        onClick: btn => produceMarketingVideo(p, btn, agentId),
      });
    }

    /* סיור 360° בנגן שלנו, מתמונות פנורמה שהסוכן/ת מעלה. **ההפקה** היא
       יכולת של Elite בלבד; סיור שהופק נשאר בדף הנכס גם אם המסלול ירד אחר
       כך. אין כאן מחיר לכל הפקה (אין ספק חיצוני שמחייב), ולכן זה מסלול
       ולא ארנק.

       ההסתרה כאן היא תצוגה בלבד: הגבול האמיתי הוא ב-policies של
       ‎property_virtual_tours‎ ושל דלי ‎property-tours‎, כי העורך כותב ישירות
       למסד ולא דרך Edge Function (‏20261028090000_virtual_tour_elite_only).
       הכפתור אומר "בנייה" או "עריכה" לפי ‎has_virtual_tour‎, שנכתב בטריגר
       ולכן אפשר לסמוך עליו. */
    if (currentAgent && currentAgent.tier === 'premium'){
      addHubAction(hubRow, {
        label: p.has_virtual_tour ? 'עריכת סיור 360°' : 'סיור 360°',
        icon:'globe',
        title: p.has_virtual_tour
          ? 'הוספת חללים ונקודות מעבר לסיור הקיים'
          : 'בניית סיור וירטואלי מתמונות 360° — מוצג בתוך דף הנכס',
        onClick: btn => openTourEditor(p, btn),
      });
    }
  }

  // בלוק כלי ה-AI מוצג רק אם נכנס אליו משהו: במסלול החינמי, ועל נכס
  // שאינו פעיל, כל הכלים שלו מסוננים - וכותרת מעל שורה ריקה היא הבטחה
  // שלא נשמרת. ‏:empty ב-CSS לא היה עוזר כאן, כי הכותרת עצמה בפנים.
  hub.hidden = !hubRow.childElementCount;

  // מספר העמודות נקבע כאן ולא ב-CSS, כי הוא תלוי בכמה פריטים נכנסו בפועל
  balanceGrid(actions);
  balanceGrid(hubRow);
  clampCardTags(el.querySelector('.pc-col-main > .card-tags'));
  return el;
}

/* ---------- שורת התגיות: שתי שורות, והשאר מאחורי "+N" ----------
   מספר התגיות אינו קבוע (בין שתיים לתשע), ורוחבן משתנה עם התוכן. ברוחב
   טלפון התוצאה הייתה שלוש ואפילו ארבע שורות של גלולות אפורות - בדיוק
   הקיר שהתגיות נועדו למנוע, כי שורה שלישית של פרטים כבר אינה נסרקת.

   שתי שורות תמיד, ומה שמעבר יורד אל מאחורי כפתור "+N" שפותח אותן.
   ‏**לכן הסדר התהפך למעלה:** מה שנשאר גלוי הן שתי השורות הראשונות, ולכן
   התגיות שדורשות פעולה (פג תוקף, ללא תמונות, ללא תיאור) עלו לראש - הן
   אלה שאסור שייעלמו, ותגית "בתוקף עד" יכולה לחכות ללחיצה.

   ה-CSS אינו יכול לעשות את זה לבד: הוא יודע לחתוך בגובה (`max-height`),
   אבל לא לספור כמה נחתכו ולא להשאיר מקום לכפתור. המדידה כאן היא
   ‏`offsetTop` - כל תגית בשורה מסוימת חולקת את אותו ערך, ולכן מספר
   הערכים השונים הוא מספר השורות. */
function clampCardTags(wrap){
  if (!wrap) return;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'card-tag tag-more';
  more.hidden = true;
  wrap.appendChild(more);

  const tags = ()=> Array.from(wrap.children).filter(el => el !== more);
  let expanded = false;

  const apply = ()=>{
    if (expanded) return;
    const all = tags();
    all.forEach(t => { t.hidden = false; });
    more.hidden = true;
    if (!all.length) return;

    const rows = [...new Set(all.map(t => t.offsetTop))].sort((a, b)=> a - b);
    if (rows.length <= 2) return;

    // ראש השורה השלישית. הסתרת תגיות מהסוף אינה מזיזה את מה שלפניהן,
    // ולכן הסף הזה נשאר תקף גם אחרי ההסתרה.
    const cut = rows[2];
    let hiddenCount = 0;
    all.forEach(t => { if (t.offsetTop >= cut){ t.hidden = true; hiddenCount++; } });
    more.hidden = false;
    more.textContent = '+' + hiddenCount;
    // הכפתור עצמו תופס מקום, ועלול לדחוף תגית נוספת לשורה השלישית
    let guard = all.length;
    while (more.offsetTop >= cut && guard-- > 0){
      const last = all.filter(t => !t.hidden).pop();
      if (!last) break;
      last.hidden = true;
      more.textContent = '+' + (++hiddenCount);
    }
  };

  more.addEventListener('click', ()=>{
    expanded = true;
    tags().forEach(t => { t.hidden = false; });
    more.hidden = true;
  });

  /* מדידה דורשת פריסה, ולכן ב-rAF: ברגע הזה הכרטיס עדיין לא חובר למסמך
     וכל ה-offsetTop הם 0. ‏ResizeObserver מחזיק את זה גם בסיבוב מסך -
     והוא בודק את **הרוחב** בלבד, כי ה-apply עצמו משנה את הגובה וכל
     תגובה לגובה הייתה לולאה אינסופית. */
  requestAnimationFrame(apply);
  if (typeof ResizeObserver === 'undefined') return;
  let lastWidth = -1;
  const ro = new ResizeObserver(entries => {
    if (!wrap.isConnected){ ro.disconnect(); return; }
    const width = Math.round(entries[0].contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    apply();
  });
  ro.observe(wrap);
}

/* ---------- שתי שורות, ולא שורה שלישית עם אריח בודד ----------
   מספר האריחים בכרטיס נכס אינו קבוע: הוא נע בין חמישה לתשעה לפי מסלול,
   סטטוס, מצב השיתוף והאם הנכס כבר מקודם. ברשת ברוחב קבוע התוצאה הייתה
   שורה שלישית ובה פריט אחד - "ביטול שת״פ" לבדו מתחת לשתי שורות מלאות,
   וכך גם "עריכת סיור 360°" בבלוק הכלים.

   ‏`--pc-fit` הוא מספר העמודות שבו הכול נכנס לשתי שורות. הרוחב עדיין
   מגביל אותו: ה-CSS לוקח `min(--pc-max, --pc-fit)`, ולכן בטלפון נשארות
   שלוש עמודות גם כשהחישוב כאן מבקש חמש - ושם מה שמונע את המראה הקרוע
   הוא `justify-content:center`, שמרכז שורה אחרונה חלקית במקום להדביק
   אותה לקצה. */
function balanceGrid(grid){
  const n = grid.childElementCount;
  if (!n) return;
  grid.style.setProperty('--pc-fit', String(Math.max(2, Math.ceil(n / 2))));
}

/* ---------- תיאור שיווקי מהנתונים ----------
   המנגנון עצמו יושב במסד וב-Edge Function (מיגרציה 20260925090000): נכס
   שנשמר בלי תיאור שיווקי מקבל אחד אוטומטית כעבור עשר דקות, וכשנתוני הנכס
   משתנים אחרי שהתיאור נכתב - הוא מסומן `marketing_description_stale` וכאן
   מוצעת כתיבה מחדש.

   הכלל שמנחה את כל המסך הזה: **המערכת מציעה, הסוכן/ת מחליט/ה.** הכפתורים
   כאן מבקשים נוסח (mode=preview) ואינם שומרים דבר; השמירה היא פעולה נפרדת
   של הסוכן/ת, ולכן גם הטקסט שנשמר ממנה נרשם על שמו/ה ולא על שם המכונה -
   מי שקרא/ה, ערך/ה ואישר/ה מודעה אחראי/ת לה.                              */

const DESCRIPTION_FUNCTION_URL = SUPABASE_URL + '/functions/v1/property-description';

/* התיאור השיווקי הוא יכולת של המסלולים בתשלום (‏docs/pricing-and-tiers.md).
   כאן זו שאלה של תצוגה בלבד - האכיפה יושבת ב-request_property_description
   ובתור עצמו, ולכן גם מי שיקרא לפונקציה מה-console יקבל upgrade_required. */
function descriptionTierOk(){
  return currentAgent?.tier === 'mid' || currentAgent?.tier === 'premium';
}

const MKT_ERRORS = {
  not_authenticated: 'צריך להתחבר מחדש',
  not_your_property: 'הנכס אינו שלך',
  property_not_found: 'הנכס לא נמצא',
  cooldown_active: 'רגע — בקשה קודמת עדיין בטיפול. נסו שוב בעוד כמה שניות',
  copy_not_configured: 'כתיבת התיאורים לא מוגדרת עדיין במערכת',
  upgrade_required: 'כתיבת תיאור שיווקי ב-AI זמינה במסלולים PROFESSIONAL ו-Elite',
  generation_failed: 'כתיבת הנוסח נכשלה — נסו שוב',
};

/** מבקשת נוסח מהשרת. לא שומרת כלום - מחזירה טקסט למסך. */
async function fetchMarketingCopy(propertyId){
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(DESCRIPTION_FUNCTION_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
    body: JSON.stringify({ property_id: propertyId, mode:'preview' }),
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok || data.error){
    const base = MKT_ERRORS[data.error] || 'שגיאה בכתיבת הנוסח';
    throw new Error(data.error === 'cooldown_active' && data.retry_after_seconds
      ? `רגע - אפשר לבקש נוסח נוסף בעוד ${data.retry_after_seconds} שניות`
      : base);
  }
  return data;
}

/* מצב התיאור של נכס, בשפה אחת לכרטיס ולטופס. הסדר הוא סדר הדחיפות: נכס בלי
   תיאור הוא מודעה חסרה, נכס שהנתונים שלו השתנו הוא מודעה לא מדויקת, וכל
   השאר הוא רק מידע. */
function marketingCopyState(p){
  if (!(p.marketing_description || '').trim()){
    // הכתיבה האוטומטית היא יכולת של המסלולים בתשלום, ולכן ההבטחה הזו
    // נאמרת רק למי שהיא באמת חלה עליו/ה.
    return { level:'missing', tag:'✍️ ללא תיאור שיווקי',
             note: descriptionTierOk()
               ? 'לנכס אין תיאור שיווקי. המערכת כותבת אחד אוטומטית מהנתונים, ואפשר לבקש נוסח עכשיו.'
               : 'לנכס אין תיאור שיווקי. כתיבה אוטומטית ב-AI זמינה במסלולים PROFESSIONAL ו-Elite — בינתיים אפשר לכתוב תיאור בעריכת הנכס.' };
  }
  if (p.marketing_description_stale){
    return { level:'stale', tag:'♻️ כדאי לרענן תיאור',
             note:'נתוני הנכס השתנו מאז שהתיאור נכתב — כדאי לבקש נוסח מעודכן.' };
  }
  if (p.marketing_description_source === 'ai'){
    return { level:'ai', tag:null,
             note:'התיאור נכתב אוטומטית מהנתונים' + (p.marketing_description_at ? ' ב-' + hebDate(p.marketing_description_at) : '') + '. אפשר לערוך אותו בחופשיות.' };
  }
  return { level:'ok', tag:null, note:'התיאור נכתב על ידיכם. בקשת נוסח חדש תציע חלופה — היא לא תדרוס כלום עד שתשמרו.' };
}

/* ---- הטופס: כפתור "כתיבת נוסח מהנתונים" ---- */

function syncMarketingCopyField(p){
  const btn = document.getElementById('npGenDesc');
  const hint = document.getElementById('npGenDescHint');
  if (!btn || !hint) return;
  if (!p){
    // נכס חדש: אין עדיין id, ולכן אין מה לקרוא ממנו נתונים. זה לא חסך -
    // הנכס ייכנס לתור בשמירה ויקבל תיאור לבד.
    btn.disabled = true;
    hint.className = 'mkt-note';
    hint.textContent = 'אחרי הפרסום המערכת כותבת תיאור שיווקי מהנתונים לבד. אפשר גם לבקש נוסח בכל שלב מכרטיס הנכס.';
    return;
  }
  // ‏Pay&GO: הכפתור נשאר על המסך ומסביר מה חסר, במקום להיעלם בלי סיבה.
  // כפתור שנעלם נראה כמו באג; כפתור שאומר "זמין ב-PROFESSIONAL" הוא הצעה.
  if (!descriptionTierOk()){
    btn.disabled = true;
    hint.className = 'mkt-note';
    hint.textContent = 'כתיבת תיאור שיווקי ב-AI זמינה במסלולים PROFESSIONAL ו-Elite. במסלול הנוכחי אפשר לכתוב תיאור ידני בשדה שמעל.';
    return;
  }
  const state = marketingCopyState(p);
  btn.disabled = false;
  hint.className = 'mkt-note' + (state.level === 'missing' || state.level === 'stale' ? ' warn' : '');
  hint.textContent = state.note;
}

document.getElementById('npGenDesc').addEventListener('click', async ()=>{
  if (!editingPropertyId) return;
  const btn = document.getElementById('npGenDesc');
  const hint = document.getElementById('npGenDescHint');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'כותב…';
  try{
    const data = await fetchMarketingCopy(editingPropertyId);
    document.getElementById('npMarketingDescription').value = data.marketing_description || '';
    // טקסט פוסט שנכתב ביד לא נדרס גם כאן: המערכת משלימה מה שחסר.
    const postField = document.getElementById('npPostText');
    if (!postField.value.trim()) postField.value = data.post_text || '';
    hint.className = 'mkt-note warn';
    hint.textContent = 'נוסח חדש נכתב מהנתונים העדכניים. אפשר לערוך אותו — הוא נשמר רק בלחיצה על "שמירת שינויים".';
  } catch(err){
    hint.className = 'mkt-note warn';
    hint.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

/* ---- הכרטיס: חלון ההצעה ---- */

let mktProperty = null;
let mktAgentId = null;

async function openMarketingCopy(property, btn, agentId){
  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'כותב…'); }
  try{
    const data = await fetchMarketingCopy(property.id);
    mktProperty = property;
    mktAgentId = agentId;
    document.getElementById('mktFacts').textContent =
      [`מודעה #${property.listing_number ?? '—'}`, property.title, shekel(property.price)].filter(Boolean).join(' · ');
    document.getElementById('mktDesc').value = data.marketing_description || '';
    document.getElementById('mktPost').value = data.post_text || '';
    const hasExisting = Boolean((property.marketing_description || '').trim());
    document.getElementById('mktHint').textContent = hasExisting
      ? 'הנוסח נכתב מהנתונים העדכניים של הנכס. שמירה תחליף את התיאור והפוסט הקיימים.'
      : 'הנוסח נכתב מנתוני הנכס. אפשר לערוך אותו לפני השמירה.';
    document.getElementById('mktModal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  } catch(err){
    showToast(err.message);
  } finally {
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
  }
}

function closeMarketingCopy(){
  document.getElementById('mktModal').style.display = 'none';
  document.body.style.overflow = '';
  mktProperty = null;
}

document.getElementById('mktClose').addEventListener('click', closeMarketingCopy);
document.getElementById('mktModal').addEventListener('click', (e)=>{
  if (e.target.id === 'mktModal') closeMarketingCopy();
});

document.getElementById('mktRegen').addEventListener('click', async (e)=>{
  if (!mktProperty) return;
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'כותב…';
  try{
    const data = await fetchMarketingCopy(mktProperty.id);
    document.getElementById('mktDesc').value = data.marketing_description || '';
    document.getElementById('mktPost').value = data.post_text || '';
  } catch(err){
    showToast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById('mktSave').addEventListener('click', async (e)=>{
  if (!mktProperty) return;
  const desc = document.getElementById('mktDesc').value.trim();
  if (!desc){ showToast('אין מה לשמור — התיאור ריק'); return; }
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שומר…';
  const { error } = await sb.from('properties').update({
    marketing_description: desc,
    post_text: document.getElementById('mktPost').value.trim() || null,
  }).eq('id', mktProperty.id);
  btn.disabled = false; btn.textContent = original;
  if (error){ showToast('שגיאה בשמירה: ' + error.message); return; }
  const agentId = mktAgentId;
  closeMarketingCopy();
  showToast('התיאור השיווקי נשמר ומוצג בדף הנכס');
  if (agentId) await loadProperties(agentId);
});

async function bumpProperty(propertyId, btn, agentId){
  const original = actionLabel(btn);
  btn.disabled = true; setActionLabel(btn, 'מקפיץ…');
  const { data, error } = await sb.rpc('bump_property', { p_property_id: propertyId });
  if (error || data?.error){
    const messages = { cooldown_active: 'כבר הקפצת את הנכס הזה ב-24 השעות האחרונות', not_your_property: 'שגיאת הרשאה' };
    showToast(messages[data?.error] || 'שגיאה בהקפצה');
    btn.disabled = false; setActionLabel(btn, original);
    return;
  }
  showToast('הנכס הוקפץ בהצלחה!');
  btn.disabled = false; setActionLabel(btn, original);
  await loadProperties(agentId);
}

async function promoteProperty(property, btn, agentId){
  const price = priceOf('promote_price', 20);
  const hours = priceOf('promote_duration_hours', 72);
  const approved = await confirmPurchase({
    title: 'אישור קידום נכס',
    lines: [
      `📣 קידום מודעה · ${property.title || 'הנכס שלך'}`,
      `הנכס יופיע בסלוטים המקודמים בתוצאות החיפוש למשך ${plural(hours, 'שעה אחת', 'שעות')} מרגע האישור.`,
      'בתום החלון הקידום נגמר מעצמו ולא מתחדש אוטומטית — מי שרוצה להמשיך מקדם שוב בתשלום נוסף.',
    ],
    price,
    ackText: `אני מבין/ה שזו רכישה, ושאישור הפעולה יחייב את הארנק שלי ב-${shekel(price)} עבור ${plural(hours, 'שעה אחת', 'שעות')} קידום.`,
    confirmLabel: `אישור קידום וחיוב ${shekel(price)}`,
  });
  if (!approved) return;

  const propertyId = property.id;
  const original = actionLabel(btn);
  btn.disabled = true; setActionLabel(btn, 'מקדם…');
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/promote-property', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ property_id: propertyId }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const messages = {
        insufficient_balance: `יתרה לא מספיקה - נדרש ₪${data.required}. טענו קרדיט ונסו שוב`,
        already_promoted: 'הנכס כבר מקודם',
      };
      showToast(messages[data.error] || 'שגיאה בקידום');
      btn.disabled = false; setActionLabel(btn, original);
      return;
    }
    showToast(`הנכס מקודם ל-${data.duration_hours || hours} השעות הקרובות! חויבת ${shekel(data.price_charged)} · עד ${hebDateTime(data.promoted_until)}`);
    // הקידום חייב את הארנק - היתרה שעל המסך צריכה לדעת על כך מיד
    await refreshAgentBalance();
    await loadProperties(agentId);
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת — נסו שוב');
    btn.disabled = false; setActionLabel(btn, original);
  }
}

/* ---------- הפקת סרטון שיווקי ----------
   התמונות של הנכס נשלחות ל-fal.ai, כל אחת הופכת לקליפ קצר בתנועת מצלמה,
   והרצף נשמר על הנכס ב-‎video_url‎ - אותו שקע שאליו מעלים סרטון מהמכשיר.

   ההפקה לוקחת דקות ולכן היא **לא** תלויה בחלון הזה: הבקשה נשלחת, fal מחזיר/ה
   תשובה ל-‎property-video-callback‎, והסרטון נשמר גם אם ה-CRM נסגר באמצע.
   ה-polling כאן הוא רק כדי להראות התקדמות למי שנשאר/ת לחכות.               */
const VIDEO_POLL_MS = 5000;
const VIDEO_POLL_TIMEOUT_MS = 12 * 60 * 1000;

async function produceMarketingVideo(property, btn, agentId){
  const isMid = currentAgent?.tier === 'mid';
  const price = isMid ? priceOf('property_video_price_mid', 25) : 0;
  const maxClips = priceOf('property_video_clip_count', 5);
  const secs  = priceOf('property_video_clip_seconds', 5);
  const hasVideo = !!property.video_url;

  // התקרה היא תקרה, לא יעד: הסרטון לוקח סצנה לכל תמונה עד המקסימום, ולכן
  // המספר שמוצג הוא מה שהנכס הזה באמת יקבל ולא הבטחה גנרית.
  const nImages = Array.isArray(property.images) ? property.images.filter(Boolean).length : 0;
  const scenes  = Math.max(1, Math.min(nImages, maxClips));
  const total   = Math.round(scenes * secs * 10) / 10;

  const lines = [
    `🎬 סרטון שיווקי · ${property.title || 'הנכס שלך'}`,
    `${scenes} סצנות של ${secs} שניות - סרטון של כ-${total} שניות, בתנועת מצלמה כמו מרחפן.`,
    'ההפקה נמשכת כמה דקות ורצה בשרת — אפשר לסגור את החלון בינתיים.',
  ];
  // ההחלפה נאמרת במפורש ובשורה נפרדת: זה החלק שאי אפשר לבטל.
  if (hasVideo) lines.push('⚠️ לנכס כבר יש סרטון. הסרטון החדש יחליף אותו, והישן יימחק.');

  const approved = await confirmPurchase({
    title: hasVideo ? 'החלפת הסרטון בסרטון מופק' : 'אישור הפקת סרטון',
    lines,
    price,
    requireAck: true,
    ackText: isMid
      ? `אני מבין/ה שזו רכישה, ושאישור הפעולה יחייב את הארנק שלי ב-${shekel(price)} עבור סרטון אחד.`
      : (hasVideo
          ? 'אני מבין/ה שהסרטון הקיים יימחק ויוחלף בסרטון המופק.'
          : 'אני מאשר/ת הפקת סרטון שיווקי לנכס הזה.'),
    confirmLabel: isMid ? `אישור והפקה · חיוב ${shekel(price)}` : 'אישור והפקה',
  });
  if (!approved) return;

  const original = actionLabel(btn);
  btn.disabled = true;
  setActionLabel(btn, 'שולח…');

  let jobId = null;
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/property-video-create', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ property_id: property.id, replace_existing: hasVideo }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const messages = {
        insufficient_balance: `יתרה לא מספיקה - נדרש ${shekel(data.required)}. טענו קרדיט ונסו שוב`,
        not_eligible:         'הפקת סרטון זמינה לסוכני MID ו-Premium בלבד',
        monthly_cap_reached:  `נוצלה המכסה החודשית (${data.used}/${data.cap} סרטונים). המכסה מתחדשת בתחילת החודש`,
        job_in_progress:      'כבר רצה הפקת סרטון לנכס הזה — יש להמתין לסיומה',
        video_exists:         'לנכס כבר יש סרטון — יש לאשר החלפה',
        no_images:            'אין תמונות לנכס הזה — אי אפשר להפיק ממנו סרטון',
        not_enough_images:    data.message || 'אין מספיק תמונות מתאימות להפקת סרטון',
        fal_not_configured:   'שירות הווידאו לא מוגדר במערכת — יש לפנות לתמיכה',
        fal_submit_failed:    'שירות הווידאו לא זמין כרגע — לא בוצע חיוב, נסו שוב בהמשך',
      };
      showToast(messages[data.error] || 'שגיאה בהפקת הסרטון');
      btn.disabled = false; setActionLabel(btn, original);
      return;
    }
    jobId = data.job_id;
    // חיוב יצא - היתרה שעל המסך צריכה לדעת מיד, כמו בקידום
    if (data.amount_charged > 0) await refreshAgentBalance();
    showToast(`ההפקה החלה · ${data.clips} קליפים · כ-${data.estimated_seconds} שניות. אפשר לסגור את החלון`);
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת — נסו שוב');
    btn.disabled = false; setActionLabel(btn, original);
    return;
  }

  // ---- מעקב ----
  // כישלון מזכה את הארנק אוטומטית בצד השרת, ולכן גם כאן מרעננים את היתרה.
  const started = Date.now();
  const poll = async ()=>{
    if (Date.now() - started > VIDEO_POLL_TIMEOUT_MS){
      btn.disabled = false; setActionLabel(btn, original);
      showToast('ההפקה נמשכת יותר מהצפוי — היא ממשיכה ברקע. רעננו את הדף בעוד כמה דקות');
      return;
    }
    const { data, error } = await sb.rpc('property_video_job_status', { p_job_id: jobId });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row){ setTimeout(poll, VIDEO_POLL_MS); return; }

    if (row.status === 'done'){
      showToast('הסרטון מוכן והוצמד לנכס 🎬');
      await loadProperties(agentId);
      return;
    }
    if (row.status === 'failed'){
      btn.disabled = false; setActionLabel(btn, original);
      showToast(price > 0
        ? 'ההפקה נכשלה — החיוב הוחזר לארנק. אפשר לנסות שוב'
        : 'ההפקה נכשלה — לא נוצלה מכסה. אפשר לנסות שוב');
      if (price > 0) await refreshAgentBalance();
      return;
    }

    const label = row.status === 'merging' ? 'מחבר…'
      : row.status === 'uploading' ? 'שומר…'
      : `מפיק… ${row.clips_done}/${row.clips_total}`;
    setActionLabel(btn, label);
    setTimeout(poll, VIDEO_POLL_MS);
  };
  setTimeout(poll, VIDEO_POLL_MS);
}

/* ==========================================================================
   סטטוס הנכס - בלוק אחד, שני מקומות
   --------------------------------------------------------------------------
   עד כאן המצב של נכס נקבע בשלושה מקומות שונים: "סמן כנמכר" בתחתית הכרטיס,
   "החזרה לפרסום" שהחליף אותו כשהנכס לא היה פעיל, ו"ארכיון" שלא היה קיים
   בכלל. הורדה זמנית מהאתר - הדבר שסוכנים באמת צריכים - לא הייתה אפשרית,
   ולכן מודעות של דירות שכבר לא בשוק נשארו באוויר.

   ‏buildPropertyStatusPanel בונה בלוק אחד שמוצג גם בראש כרטיס הנכס וגם
   בראש טופס העריכה. הוא מציג את המצב הנוכחי, את המצבים שאפשר לעבור
   אליהם, ואת מה שחוסם מעבר - והוא הדרך היחידה בקוד לשנות סטטוס.

   ## הבלעדיות

   האכיפה כולה במסד (‏properties_guard_duplicate). כאן רק התצוגה:
   ‏property_listing_context מחזירה מי מחזיק/ה בבלעדיות על הנכס, והכפתור
   "מפורסם" מנוטרל כשהמחזיק/ה אינו/ה אנחנו. אם המסד יחסום בכל זאת (מירוץ
   בין שני סוכנים), ההודעה שלו היא זו שתוצג - ‏hint מזהה את הסוג.
   ========================================================================== */

/* התרגום היחיד של שגיאת מסד לעברית. ה-hint נקבע ב-raise ... using hint,
   וה-message כבר כתוב בעברית מלאה - ולכן הוא מוצג כמו שהוא. */
function propertyStatusErrorText(error){
  if (!error) return '';
  if (error.hint === 'exclusive_elsewhere' || error.hint === 'duplicate_elsewhere'
      || error.hint === 'duplicate_same_agency' || error.hint === 'exclusivity_agreement_required'
      || error.hint === 'address_incomplete'){
    return error.message;
  }
  if (error.code === '23503') return 'אי אפשר למחוק את הנכס — מקושרים אליו חוזה או עסקה שמורים.';
  return error.message || 'שגיאה לא ידועה';
}

const PROPERTY_STATUS_CONFIRM = {
  active:      'להחזיר את הנכס לפרסום? המודעה תופיע שוב באתר.',
  unpublished: 'להוריד את הנכס מפרסום? המודעה תיעלם מהאתר ותישאר אצלך במערכת — אפשר להחזיר אותה בכל רגע.',
  sold:        'לסמן את הנכס כנמכר? המודעה תרד מהאתר והנכס ייכנס ל"עסקאות אחרונות".',
  rented:      'לסמן את הנכס כהושכר? המודעה תרד מהאתר.',
  archived:    'להעביר את הנכס לארכיון? המודעה תרד מהאתר והנכס יצא מרשימת העבודה היומית.',
};

/* שינוי סטטוס. ‏listing_expires_at שכבר עבר מתאפס בחזרה לפרסום - אחרת
   הנכס חוזר לאוויר וברגע הבא כבר מסומן "פג תוקף". */
/* תאריך היום לפי השעון המקומי ולא לפי UTC. ‏toISOString על שעון ישראל
   מחזיר אחרי חצות את *אתמול*, וזה היה מתעד עסקאות ביום הלא נכון. */
function isoToday(){
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ---------- מחיר הסגירה בפועל ----------
   עד כאן `handle_property_sold` רשמה למאגר העסקאות את `price` - המחיר
   ש**התפרסם**. פער המיקוח נכנס כך למאגר כאילו היה מחיר סגירה, ומשם הוא
   יצא לדוחות ה-CMA של שאר הסוכנים/ות, לרצועת המבזקים בדף הבית ("נמכרה
   ב-₪X") ולעמוד המשרד.

   לכן הסימון "נמכר" שואל. מי שאינו יודע/ת או אינו רוצה למסור - מבטל/ת,
   והעסקה נרשמת עם `price_basis='asking'` ומסומנת בדוח כ"מחיר מבוקש".
   הוויתור על המספר בסדר; הוויתור על ההבחנה אינו. */
function askClosingDetails(property){
  const asking = Number(property.price) || 0;
  const raw = prompt(
    'מה היה מחיר הסגירה בפועל?\n\n'
    + 'המספר נכנס למאגר העסקאות ומשמש בדוחות ה-CMA של האזור.\n'
    + 'ביטול או שדה ריק — תירשם ההצעה שבפרסום, והיא תסומן בדוחות כ"מחיר מבוקש".',
    asking ? String(asking) : '');
  if (raw === null) return {};

  const price = Number(String(raw).replace(/[^\d.]/g, ''));
  if (!(price > 0)) return {};

  const today = isoToday();
  const dateRaw = String(prompt('תאריך סגירת העסקה (YYYY-MM-DD):', today) || '').trim();
  // תאריך עתידי נחסם כאן: אין אילוץ במסד, כי CHECK אינו יכול לקרוא ל-
  // ‏current_date (היא STABLE ולא IMMUTABLE).
  const on = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) && dateRaw <= today ? dateRaw : today;

  return { sale_closed_price: price, sale_closed_on: on };
}

async function setPropertyStatus(property, nextStatus, btn, agentId){
  if (property.status === nextStatus) return;
  if (!confirm(PROPERTY_STATUS_CONFIRM[nextStatus] || 'לשנות את סטטוס הנכס?')) return;

  const patch = { status: nextStatus };
  if (nextStatus === 'active' && propertyIsExpired(property)) patch.listing_expires_at = null;
  // חייב להיות באותו update: ‏trg_property_sold רץ על השורה הזו ורואה רק
  // את `new`. כתיבה שנייה אחרי שינוי הסטטוס הייתה מאחרת את הטריגר.
  if (nextStatus === 'sold') Object.assign(patch, askClosingDetails(property));

  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'מעדכן…'); }
  const { error } = await sb.from('properties').update(patch).eq('id', property.id);
  if (error){
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
    showToast(propertyStatusErrorText(error), 6000);
    return;
  }
  showToast(
    nextStatus === 'active'      ? 'הנכס חזר לפרסום ומופיע שוב באתר'
    : nextStatus === 'unpublished' ? 'הנכס ירד מפרסום — הוא נשאר אצלך במערכת'
    : nextStatus === 'sold'        ? (patch.sale_closed_price
        ? 'הנכס סומן כנמכר, ומחיר הסגירה נרשם במאגר העסקאות'
        : 'הנכס סומן כנמכר — המחיר המבוקש נרשם במאגר ומסומן ככזה')
    : nextStatus === 'rented'      ? 'הנכס סומן כהושכר'
    : 'הנכס הועבר לארכיון');
  await loadProperties(agentId);
  refreshOpenPropertyStatusPanel(property.id);
}

/* הכרטיס נבנה מחדש ב-loadProperties, אבל הטופס לא - ובלוק הסטטוס שבתוכו
   היה ממשיך להציג את המצב הקודם אחרי שינוי שנעשה ממנו עצמו. */
function refreshOpenPropertyStatusPanel(propertyId){
  if (editingPropertyId !== propertyId) return;
  const fresh = myPropertyRows.find(row => row.id === propertyId);
  if (fresh) renderPropertyStatusPanel(fresh, myPropertyAgentId);
}

/* מחיקה סופית. שני אישורים ולא אחד: זו הפעולה היחידה בכרטיס שאין ממנה דרך
   חזרה, והיא מוחקת יחד עם הנכס גם את הצפיות, המידע התכנוני והמדיה שלו.
   קבצי ה-Storage נמחקים **לפני** השורה: אחריה כבר אין דרך לדעת אילו קבצים
   היו שייכים לה, והם היו נשארים בדלי לנצח. */
async function deletePropertyForever(property, btn, agentId){
  const name = property.title || 'הנכס';
  if (!confirm(`למחוק לצמיתות את "${name}" (מודעה #${property.listing_number ?? '—'})?\n\n`
    + 'יימחקו גם התמונות, הסרטון, הצפיות והמידע התכנוני שנצברו עליו. '
    + 'אם רק רוצים להוריד את המודעה מהאתר — בחרו "ירד מפרסום" או "ארכיון".')) return;
  if (!confirm('אין דרך לשחזר נכס שנמחק. למחוק?')) return;

  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'מוחק…'); }

  const paths = (property.images || []).map(storagePathFromPublicUrl).filter(Boolean);
  const marketingPath = property.marketing_image ? storagePathFromPublicUrl(property.marketing_image) : null;
  if (marketingPath) paths.push(marketingPath);
  if (paths.length) await sb.storage.from(IMAGES_BUCKET).remove(paths).catch(()=>{});
  const videoPath = videoStoragePath(property.video_url);
  if (videoPath) await sb.storage.from(VIDEOS_BUCKET).remove([videoPath]).catch(()=>{});

  const { error } = await sb.from('properties').delete().eq('id', property.id);
  if (error){
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
    showToast(propertyStatusErrorText(error), 6000);
    return;
  }
  expandedPropertyIds.delete(property.id);
  // הטופס פתוח על הנכס שנמחק - הוא נסגר, אחרת "שמירת שינויים" תכתוב לשורה
  // שכבר לא קיימת ותחזור עם שגיאה שאי אפשר להבין
  if (editingPropertyId === property.id){
    editingPropertyId = null;
    editingPropertyOriginalAddress = null;
    renderPropertyStatusPanel(null);
    addForm.style.display = 'none';
    toggleBtn.textContent = '+ הוספת נכס חדש';
    document.getElementById('addPropertyBtn').textContent = 'פרסום הנכס';
  }
  showToast('הנכס נמחק');
  await loadProperties(agentId);
}

/* תביעת בלעדיות: מפרסמת את הנכס על סמך הסכם בלעדיות חתום, מורידה את
   המודעות המתחרות ומתריעה לסוכנים שלהן. כל זה קורה ב-RPC אחד במסד - כאן
   רק האישור וההודעה. */
async function claimPropertyExclusivity(property, btn, agentId){
  if (!confirm('לפרסם את הנכס על סמך הסכם הבלעדיות החתום?\n\n'
    + 'מודעות קיימות לאותו נכס אצל מתווכים אחרים ירדו מפרסום, והם יקבלו התראה '
    + 'עם שמך, שם המשרד ומועד סיום הבלעדיות.')) return;

  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'רושם בלעדיות…'); }
  const { data, error } = await sb.rpc('claim_property_exclusivity', { p_property_id: property.id });
  if (error){
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
    showToast(propertyStatusErrorText(error), 7000);
    return;
  }
  const superseded = data?.superseded || 0;
  showToast(superseded
    ? `הנכס פורסם בבלעדיות עד ${hebDate(data.ends_on)} · ${plural(superseded, 'מודעה מתחרה אחת ירדה', 'מודעות מתחרות ירדו')} מפרסום`
    : `הנכס פורסם בבלעדיות עד ${hebDate(data.ends_on)}`, 6000);
  await loadProperties(agentId);
  refreshOpenPropertyStatusPanel(property.id);
}

/* הערת ההקשר: מה המסד יודע על הנכס שהסוכן/ת אינו/ה יכול/ה לראות בעצמו/ה -
   בלעדיות של משרד אחר, או מודעה מתחרה באוויר. שם המתווך/ת ושם המשרד בלבד:
   מועד סיום הבלעדיות אינו נאמר למי שאינו/ה מחזיק/ה בה. */
function propertyContextNote(ctx){
  if (!ctx) return null;
  const until = ctx.signed_until ? ` (עד ${hebDate(ctx.signed_until)})` : '';
  switch (ctx.state){
    case 'exclusive_mine':
      return { text: `🔒 הנכס בבלעדיותכם עד ${hebDate(ctx.ends_on)}.`, warn:false };
    case 'exclusive_elsewhere':
      return { text: `הנכס נמצא בבלעדיות של ${ctx.agent_name} ממשרד ${ctx.agency_name}, ולכן אי אפשר לפרסם אותו.`
        + (ctx.signed_agreement_id ? ` יש לכם הסכם בלעדיות חתום על הנכס${until} - אפשר לפרסם על פיו.` : ''), warn:true };
    case 'duplicate_elsewhere':
      return { text: `הנכס כבר מפורסם במערכת על ידי ${ctx.agent_name} ממשרד ${ctx.agency_name}. `
        + (ctx.signed_agreement_id
            ? `יש לכם הסכם בלעדיות חתום על הנכס${until} - אפשר לפרסם על פיו.`
            : `כדי לפרסם אותו צריך הסכם בלעדיות חתום מול בעל/ת הנכס.`), warn:true };
    case 'duplicate_same_agency':
      return { text: `הנכס כבר מפורסם במשרד שלכם על ידי ${ctx.agent_name}`
        + (ctx.listing_number ? ` (מודעה #${ctx.listing_number})` : '') + '.', warn:true };
    case 'unknown':
      return { text: 'לנכס אין עיר, רחוב ומספר בית מלאים, ולכן המערכת אינה יכולה לוודא שהוא אינו כפול.', warn:false };
    default:
      return ctx.signed_agreement_id
        ? { text: `יש לכם הסכם בלעדיות חתום על הנכס${until}.`, warn:false }
        : null;
  }
}

/* המצבים שמוצגים ככפתורים, לפי סדר הדחיפות. ‏sold/rented הם אותו מקום
   בשורה - נכס להשכרה לא "נמכר". */
function propertyStatusChoices(p){
  const deal = p.deal_type === 'rent' ? 'rented' : 'sold';
  return [
    { status:'active',      label:'מפורסם',     title:'המודעה מופיעה באתר' },
    { status:'unpublished', label:'ירד מפרסום', title:'המודעה יורדת מהאתר ונשארת אצלך במערכת' },
    { status:deal,          label: deal === 'rented' ? 'הושכר' : 'נמכר',
      title:'העסקה נסגרה — המודעה יורדת מהאתר והנכס נכנס ל״עסקאות אחרונות״' },
    { status:'archived',    label:'ארכיון',     title:'הנכס יוצא מרשימת העבודה היומית' },
  ];
}

/* מזהה רץ לתפריט. אותו נכס יכול להציג שני בלוקי סטטוס בו-זמנית - אחד
   בכרטיס ואחד בטופס העריכה - ו-id שנגזר מ-property_id היה מופיע פעמיים
   במסמך, כלומר `aria-controls` של אחד מהם היה מצביע על התפריט של השני. */
let pspSeq = 0;

/* בונה את הבלוק ומחזיר אותו מיד; הקשר הבלעדיות נטען אחריו ומעדכן את
   ההערה ואת הכפתורים. בלי זה כל פתיחת כרטיס הייתה ממתינה לקריאת רשת. */
function buildPropertyStatusPanel(p, agentId){
  const el = document.createElement('div');
  el.className = 'prop-status-panel' + (p.status === 'active' ? ' psp-live' : '');
  /* שורה אחת סגורה, ותפריט שנפתח מתחתיה.

     קודם היו כאן חמישה כפתורים ברוחב מינימלי של 104px: בטלפון הם נערמו
     לשלוש שורות, ובלוק שגובהו שליש מסך ישב בראש כל נכס. ניסיון הביניים
     היה רצועה שנגללת לרוחב - היא אמנם החזירה את הגובה לשורה, אבל גלילה
     אופקית באגודל היא מחווה שנתקלים בה במקרה: היד גוללת את הרשימה למטה,
     והרצועה זזה הצידה. חמור מזה, מה שלא נכנס לרוחב פשוט לא היה קיים.

     עכשיו סגור = שבב אחד ("סטטוס · מפורסם"), ופתוח = תפריט אנכי שנגלל
     למטה כמו כל דבר אחר במסך. הרווח כפול: בלוק הסטטוס אינו תופס שורה
     שלמה במצב הרגיל, וכשהוא פתוח **כל** האפשרויות שם, כל אחת עם
     ההסבר שלה - הסבר שב-`title` בלבד לא היה מגיע לטלפון לעולם. */
  const menuId = 'pspMenu-' + (++pspSeq);
  el.innerHTML = `
    <button type="button" class="psp-toggle" aria-expanded="false" aria-controls="${menuId}">
      <span class="psp-label">סטטוס</span>
      <span class="psp-now">${escapeHtml(PROPERTY_STATUS_LABELS[p.status] || p.status || '')}</span>
      <svg class="psp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </button>
    <div class="psp-note" hidden></div>
    <div class="psp-menu" id="${menuId}" hidden>
      <div class="psp-actions" role="group" aria-label="שינוי סטטוס הנכס"></div>
    </div>`;

  const note = el.querySelector('.psp-note');
  const toggle = el.querySelector('.psp-toggle');
  const menu = el.querySelector('.psp-menu');
  const actions = el.querySelector('.psp-actions');
  const buttons = {};

  /* התפריט נפתח כלפי מטה, ומתהפך כלפי מעלה כשאין לו מקום.

     **למה בכלל לבדוק:** הוא מרחף, והאקורדיון שמעליו הוא ‏`overflow:hidden`
     (בלעדיו רקע הכותרת שלו גולש מהפינות המעוגלות). תפריט שיוצא מתחתית
     הכרטיס האחרון ברשימה פשוט נחתך שם - וזה קורה דווקא במחשב, שבו שבב
     הסטטוס יושב מתחת לתמונת הנושא, כלומר נמוך בכרטיס.

     הגבול הוא המוקדם מבין תחתית הכרטיס לתחתית החלון, וההיפוך נעשה רק אם
     למעלה באמת יש מקום - אחרת עדיף תפריט שגולש מעט מאשר תפריט הפוך
     שנחתך משני הצדדים. */
  const placeMenu = ()=>{
    el.classList.remove('psp-up');
    const card = el.closest('.lead-card');
    const limit = Math.min(window.innerHeight - 8,
      card ? card.getBoundingClientRect().bottom : Infinity);
    const height = menu.getBoundingClientRect().height;
    const chip = toggle.getBoundingClientRect();
    if (chip.bottom + 6 + height > limit && chip.top - 6 - height > 8) el.classList.add('psp-up');
  };

  const setMenuOpen = open => {
    menu.hidden = !open;
    el.classList.toggle('psp-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) placeMenu(); else el.classList.remove('psp-up');
  };
  toggle.addEventListener('click', ()=> setMenuOpen(menu.hidden));
  /* לחיצה מחוץ לתפריט סוגרת אותו. המאזין מסיר את עצמו ברגע שהבלוק יצא
     מהמסמך - הכרטיס נבנה מחדש בכל ‎loadProperties‎, וכל פתיחה של כרטיס
     הייתה מותירה עוד מאזין על ‎document‎ לנצח. */
  function closeOnOutsideClick(e){
    if (!el.isConnected){ document.removeEventListener('click', closeOnOutsideClick); return; }
    if (menu.hidden || el.contains(e.target)) return;
    setMenuOpen(false);
  }
  document.addEventListener('click', closeOnOutsideClick);
  // ‏Escape סוגר ומחזיר את המיקוד לשבב, ולא משאיר אותו על כפתור שנעלם
  el.addEventListener('keydown', e=>{
    if (e.key !== 'Escape' || menu.hidden) return;
    setMenuOpen(false);
    toggle.focus();
  });

  /* התווית יושבת ב-.pc-label גם כאן, ולא ישירות בכפתור: ‏setPropertyStatus
     ו-deletePropertyForever מחליפות אותה ל"מעדכן…" דרך setActionLabel, ו-
     ‏textContent היה מוחק איתה גם את שורת ההסבר. ראו שם. */
  const addChoice = (opts)=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'psp-btn' + (opts.cls ? ' ' + opts.cls : '');
    btn.innerHTML = `<span class="pc-label">${escapeHtml(opts.label)}</span>`
      + `<span class="psp-hint">${escapeHtml(opts.title)}</span>`;
    btn.title = opts.title;
    if (opts.onClick) btn.addEventListener('click', ()=> opts.onClick(btn));
    actions.appendChild(btn);
    return btn;
  };

  propertyStatusChoices(p).forEach(choice=>{
    const current = choice.status === p.status;
    const btn = addChoice({
      label: choice.label, title: choice.title,
      cls: current ? 'is-current' : '',
      onClick: current ? null : b => setPropertyStatus(p, choice.status, b, agentId),
    });
    if (current) btn.disabled = true;
    buttons[choice.status] = btn;
  });

  addChoice({
    label:'מחיקה', title:'מחיקה סופית של הנכס וכל מה שנצבר עליו', cls:'psp-danger',
    onClick: b => deletePropertyForever(p, b, agentId),
  });

  // ההקשר מהמסד - בלעדיות ומודעות מתחרות. כישלון כאן אינו שובר את הבלוק:
  // הכפתורים ממשיכים לעבוד, והמסד ממילא הוא שחוסם.
  sb.rpc('property_listing_context', { p_property_id: p.id }).then(({ data: ctx, error })=>{
    if (error || !ctx || !el.isConnected) return;
    const info = propertyContextNote(ctx);
    if (info){
      note.hidden = false;
      note.className = 'psp-note' + (info.warn ? ' psp-warn' : '');
      note.textContent = info.text;
    }
    const blocked = ctx.state === 'exclusive_elsewhere' || ctx.state === 'duplicate_elsewhere'
                 || ctx.state === 'duplicate_same_agency';
    if (blocked){
      el.classList.add('psp-blocked');
      if (buttons.active && !buttons.active.classList.contains('is-current')){
        buttons.active.disabled = true;
        buttons.active.title = info ? info.text : 'הנכס חסום לפרסום';
      }
    }
    // הסכם בלעדיות חתום ובתוקף - הדרך לפרסם נכס שחסום, ולהצהיר על בלעדיות
    // שכבר קיימת גם כשהוא אינו חסום.
    if (ctx.signed_agreement_id && ctx.state !== 'exclusive_mine'){
      addChoice({
        label:'🔒 פרסום בבלעדיות', cls:'psp-claim',
        title:'פרסום הנכס על סמך הסכם הבלעדיות החתום - מודעות מתחרות ירדו מפרסום',
        onClick: b => claimPropertyExclusivity(p, b, agentId),
      });
    } else if (blocked && !ctx.signed_agreement_id){
      addChoice({
        label:'✍️ החתמת בלעדיות',
        title:'פתיחת הסכם בלעדיות על הנכס - אחרי החתימה אפשר לפרסם אותו',
        onClick: ()=> openAgreementWizard({
          kind: p.deal_type === 'rent' ? 'exclusive_landlord' : 'exclusive_sell',
          propertyId: p.id,
        }),
      });
    }
  }).catch(()=>{});

  return el;
}

/* הבלוק בראש טופס העריכה. נקרא מ-openEditProperty, ומתרוקן כשהטופס חוזר
   למצב "נכס חדש". */
function renderPropertyStatusPanel(p, agentId){
  const slot = document.getElementById('npStatusPanel');
  if (!slot) return;
  slot.innerHTML = '';
  if (!p){ slot.hidden = true; return; }
  slot.hidden = false;
  slot.appendChild(buildPropertyStatusPanel(p, agentId));
}

/* ==========================================================================
   סיור 360° - העורך
   --------------------------------------------------------------------------
   הסיור הוא רצף של תמונות פנורמה (‏equirectangular 360°) שהסוכן/ת מעלה -
   אחת לכל חלל - ונקודות מעבר שמחברות ביניהן. הכול נשמר ב-
   ‏property_virtual_tours.scenes במבנה ש-Pannellum מקבלת כמו שהוא, ומתנגן
   בדף הנכס בלי ספק חיצוני ובלי מנוי חודשי.

   ## שלוש החלטות שמסבירות את הקוד

   **1. הפנורמה מועלית ברגע הבחירה, לא בשמירה.** בטופס הנכס המדיה מחכה
   לשמירה כי בנכס חדש עוד אין ‎property_id‎ לנתיב ב-Storage. כאן הנכס כבר
   קיים - ולכן אפשר להעלות מיד, ואז הנגן מציג את הקובץ האמיתי מהכתובת
   האמיתית. מה שנראה בחלון הזה הוא בדיוק מה שהגולש/ת תראה.

   המחיר הוא קבצים יתומים כשיוצאים בלי לשמור, ולכן כל פנורמה שהועלתה בחלון
   הזה מסומנת ‎isNew‎ ונמחקת ביציאה בלי שמירה; ופנורמה של חלל שנמחק נכנסת
   ל-‎trash‎ ונמחקת רק **אחרי** שמירה מוצלחת - מחיקה מיידית שלה הייתה משאירה
   את הסיור השמור מצביע על קובץ שכבר לא קיים, אם העריכה בוטלה באמצע.

   **2. המעבר חזרה נלחץ ולא מנוחש.** אחרי שמסמנים "מעבר למטבח", העורך עובר
   למטבח ומבקש ללחוץ על הדלת חזרה. אפשר היה לייצר את החץ ההפוך לבד ב-
   ‎yaw+180‎, אבל שתי פנורמות אינן מצולמות באותו כיוון - החץ היה נוחת על
   קיר. שתי לחיצות הן גם מה שנותן את ‎targetYaw‎ המדויק לשני הכיוונים: מי
   שנכנס למטבח מסתובב אוטומטית *מהדלת* אל תוך החדר, כמו בכניסה אמיתית.

   **3. סדר החללים נשמר בשדה ‎order‎ ולא בסדר המפתחות.** ‏jsonb בפוסטגרס
   ממיין מפתחות מחדש (לפי אורך ואז בייטים) - הסדר שנכתב מכאן אינו הסדר
   שיחזור. ‏Pannellum מתעלמת ממפתחות שאינה מכירה, ולכן ‎order‎ נוסע יחד עם
   הסצנה בלי לשבור דבר.
   ========================================================================== */

const TOURS_BUCKET = 'property-tours';
/* 4096×2048 ולא יותר: קנבס גדול מ-16.7 מגה-פיקסל נחתך בשקט ב-Safari של
   אייפון (הפלט יוצא ריק), ו-4096 רוחב הם 8.4 - מרווח בטוח. זו גם הרזולוציה
   שמצלמות 360 ביתיות מוסרות ממילא, ואחריה הקובץ שוקל 1-3MB במקום 15. */
const PANO_MAX_WIDTH = 4096;
const PANO_MAX_SCENES = 12;
const PANO_MAX_HOTSPOTS = 12;
/* פנורמה שאינה 2:1 אינה equirectangular מלאה, ו-Pannellum תמתח אותה על כדור
   שלם - תקרה ורצפה יתעוותו והחדר ייראה שבור. עדיף לומר את זה בהעלאה. */
const PANO_RATIO_MIN = 1.85, PANO_RATIO_MAX = 2.15;

/* ‏Pannellum מה-CDN, עם גיבוי - בדיוק כמו SheetJS בייבוא הקבצים. היא נטענת
   רק בפתיחת החלון: ‏CRM שטוען אותה תמיד היה משלם עליה בכל כניסה.

   ‏jsdelivr ראשון ולא cdnjs (שממנו נטענת Leaflet בעמוד הזה) מסיבה אחת: זו
   הכתובת הרשמית שבתיעוד של Pannellum, ו-‎build/pannellum.js‎ בחבילת ה-npm
   הוא הבנייה המוקטנת. ‏script שמקבל 404 מפעיל onerror, ולכן כתובת שנחסמה
   או השתנתה נופלת לשנייה בלי שהמשתמש/ת רואה דבר.                          */
const PANNELLUM_CSS_URLS = [
  'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css',
  'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.min.css',
];
const PANNELLUM_JS_URLS = [
  'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.min.js',
];

let pannellumPromise = null;
function loadPannellum(){
  if (window.pannellum) return Promise.resolve(window.pannellum);
  if (pannellumPromise) return pannellumPromise;
  pannellumPromise = new Promise((resolve, reject)=>{
    // ה-CSS נטען במקביל ואינו חוסם: בלעדיו הנגן עדיין מנגן, רק הפקדים
    // שלו נראים עירומים — ואין סיבה להפיל בגללו את כל החלון.
    (function cssNext(i){
      if (i >= PANNELLUM_CSS_URLS.length) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PANNELLUM_CSS_URLS[i];
      link.onerror = ()=>{ link.remove(); cssNext(i + 1); };
      document.head.appendChild(link);
    })(0);

    (function jsNext(i){
      if (i >= PANNELLUM_JS_URLS.length){
        pannellumPromise = null;
        reject(new Error('טעינת נגן הסיור נכשלה - בדקו את חיבור האינטרנט ונסו שוב'));
        return;
      }
      const s = document.createElement('script');
      s.src = PANNELLUM_JS_URLS[i];
      s.onload = ()=> window.pannellum ? resolve(window.pannellum) : jsNext(i + 1);
      s.onerror = ()=>{ s.remove(); jsNext(i + 1); };
      document.head.appendChild(s);
    })(0);
  });
  return pannellumPromise;
}

/* ‎scenes‎ הוא מערך מסודר ולא אובייקט: הסדר הוא נתון (מי ראשון ברשימה),
   וההמרה לאובייקט של Pannellum נעשית בנקודה אחת — ‎tourScenesObject‎.       */
const tourState = {
  property: null,
  agentId: null,
  scenes: [],          // [{ id, title, panorama, path, isNew, pitch, yaw, hfov, hotSpots:[] }]
  currentId: null,
  initialId: null,
  trash: [],           // נתיבי Storage למחיקה אחרי שמירה מוצלחת
  viewer: null,
  pending: null,       // { pitch, yaw } של לחיצה שממתינה לבחירת יעד
  awaitingBack: null,  // { fromSceneId, hotSpotId } — ממתינים ללחיצה על המעבר חזרה
  dirty: false,
  busy: false,
  open: false,
};

function tourShortId(){
  return (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
}
function tourRound(n){ return Math.round(n * 100) / 100; }
function tourNormYaw(y){ return tourRound(((y + 180) % 360 + 360) % 360 - 180); }
function tourCurrentScene(){ return tourState.scenes.find(s => s.id === tourState.currentId) || null; }
function tourSceneById(id){ return tourState.scenes.find(s => s.id === id) || null; }

function tourSetStatus(text, cls){
  const el = document.getElementById('tourStatus');
  el.textContent = text || '';
  el.className = 'tour-status' + (cls ? ' ' + cls : '');
}

function tourSetBusy(busy, text){
  tourState.busy = !!busy;
  ['tourSaveBtn','tourDeleteBtn','tourSetViewBtn','tourSpotAdd'].forEach(id=>{
    document.getElementById(id).disabled = !!busy;
  });
  document.getElementById('tourAddFile').disabled = !!busy;
  if (text) tourSetStatus(text);
}

/* ---------- הכנת הפנורמה ----------
   פענוח אחד: ממנו נגזרות גם בדיקת היחס וגם ההקטנה. ‏WebP כשהדפדפן יודע
   לקודד (הצרכן היחיד של הקובץ הוא הנגן שלנו באותו דפדפן), ‏JPEG כשלא —
   שני הסוגים פתוחים ב-allowed_mime_types של הדלי.                          */
function preparePanorama(file){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      const ratio = img.width / img.height;
      if (!img.width || !img.height) return reject(new Error('לא ניתן לקרוא את מידות התמונה'));
      if (ratio < PANO_RATIO_MIN || ratio > PANO_RATIO_MAX){
        return reject(new Error(
          `התמונה אינה פנורמה 360° מלאה (יחס ${ratio.toFixed(2)}:1 במקום 2:1). ` +
          'יש להעלות קובץ equirectangular מהמצלמה או ממצב הפנורמה של הטלפון'));
      }
      const scale = Math.min(1, PANO_MAX_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d', { alpha:false }).drawImage(img, 0, 0, canvas.width, canvas.height);
      const encode = (type)=> new Promise(res => canvas.toBlob(res, type, 0.82));
      encode(IMAGE_TYPE_BROWSER)
        .then(first => (first && first.type === IMAGE_TYPE_BROWSER) ? first : encode(IMAGE_TYPE_EXTERNAL))
        .then(blob => blob ? resolve(blob) : reject(new Error('קידוד התמונה נכשל')))
        .catch(reject);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('לא ניתן לפתוח את התמונה')); };
    img.src = url;
  });
}

/* ---------- פתיחת החלון ---------- */
async function openTourEditor(property, btn){
  // הכפתור ממילא מוצג ל-Elite בלבד, וזו השכבה שמונעת מסך שנפתח ומת בשמירה:
  // ‏policy תדחה את הכתיבה, וכבר השקענו בהעלאת פנורמות. האכיפה עצמה במסד.
  if (!currentAgent || currentAgent.tier !== 'premium'){
    showToast('הפקת סיור 360° היא יכולת של מסלול Elite - אפשר לשדרג במסך המסלול');
    return;
  }
  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'פותח עורך…'); }
  try{
    await loadPannellum();
    const { data, error } = await sb.from('property_virtual_tours')
      .select('initial_scene, scenes')
      .eq('property_id', property.id)
      .maybeSingle();
    if (error) throw error;

    tourState.property = property;
    tourState.agentId  = currentAgent.id;
    tourState.scenes   = tourScenesFromRow(data);
    tourState.initialId = (data && data.initial_scene) || (tourState.scenes[0]?.id ?? null);
    if (!tourSceneById(tourState.initialId)) tourState.initialId = tourState.scenes[0]?.id ?? null;
    tourState.currentId = tourState.initialId;
    tourState.trash = [];
    tourState.pending = null;
    tourState.awaitingBack = null;
    tourState.dirty = false;

    document.getElementById('tourSub').textContent =
      (property.title ? property.title + ' · ' : '') +
      'מעלים תמונת 360° לכל חלל, ולוחצים על דלת או מעבר כדי לקשר בין החללים. הסיור מוצג בדף הנכס.';
    // חלון שנסגר באמצע העלאה השאיר את הכפתורים מנוטרלים; פתיחה חדשה היא
    // תמיד התחלה נקייה
    tourSetBusy(false);
    tourSetStatus(tourState.scenes.length ? '' : 'הסיור ריק - מתחילים מהחלל הראשון');
    openTourModal();
    tourRenderSide();
    tourRebuildViewer();
  } catch(err){
    console.error(err);
    showToast(err.message || 'לא ניתן לפתוח את עורך הסיור');
  } finally {
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
  }
}

// המרה מהשורה במסד למערך המסודר של העורך. ‎order‎ הוא מה ששומר על הסדר
// (‏jsonb ממיין מפתחות מחדש), ושורה ישנה בלעדיו נופלת לסדר המפתחות כפי שהוא.
function tourScenesFromRow(row){
  const raw = (row && row.scenes && typeof row.scenes === 'object') ? row.scenes : {};
  return Object.keys(raw)
    .map((id, i)=>{
      const s = raw[id] || {};
      return {
        id,
        title: String(s.title || 'חלל'),
        panorama: String(s.panorama || ''),
        path: tourStoragePath(s.panorama),
        isNew: false,
        order: Number.isFinite(s.order) ? s.order : i,
        pitch: Number.isFinite(s.pitch) ? s.pitch : 0,
        yaw:   Number.isFinite(s.yaw)   ? s.yaw   : 0,
        hfov:  Number.isFinite(s.hfov)  ? s.hfov  : 110,
        hotSpots: Array.isArray(s.hotSpots) ? s.hotSpots.map(h => ({
          id: h.id || ('hs-' + tourShortId()),
          pitch: Number(h.pitch) || 0,
          yaw: Number(h.yaw) || 0,
          type: 'scene',
          text: String(h.text || 'מעבר'),
          sceneId: String(h.sceneId || ''),
          targetYaw: Number.isFinite(h.targetYaw) ? h.targetYaw : null,
        })) : [],
      };
    })
    .filter(s => s.panorama)
    .sort((a, b) => a.order - b.order);
}

function tourStoragePath(url){
  const marker = '/storage/v1/object/public/' + TOURS_BUCKET + '/';
  const i = String(url || '').indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length));
}

/* ---------- הנגן ----------
   נבנה מחדש בכל שינוי מבני (חלל נוסף/נמחק, נקודה נוספה/הוסרה) ולא מתוקן
   בהדרגה: יש בדיוק מסלול אחד שממיר מצב לקונפיגורציה, ולכן אין מצב שהמסך
   מראה משהו אחר ממה שיישמר. בנייה מחדש היא מיידית — התמונה כבר במטמון.  */
function tourRebuildViewer(keepView){
  const host = document.getElementById('tourPano');
  const view = keepView && tourState.viewer ? tourViewerAngles() : null;

  if (tourState.viewer){
    try{ tourState.viewer.destroy(); } catch(e){ /* נגן שכבר מת */ }
    tourState.viewer = null;
  }
  host.innerHTML = '';

  if (!tourState.scenes.length){
    host.classList.add('is-empty');
    host.textContent = 'כאן תוצג הפנורמה של החלל הנבחר';
    tourRenderStageBar();
    return;
  }
  host.classList.remove('is-empty');

  const first = tourSceneById(tourState.currentId) ? tourState.currentId : tourState.scenes[0].id;
  tourState.currentId = first;

  /* שמירת הזווית נעשית בקונפיגורציה ולא ב-‎setPitch‎ אחרי הבנייה: הסצנה
     נטענת אסינכרונית, וקריאה לפקדים לפני שהיא עלתה נבלעת. האובייקט הזה
     נוצר מחדש בכל קריאה, ולכן הדריסה כאן אינה נוגעת במצב שיישמר. */
  const scenes = tourScenesObject();
  if (view && scenes[first]){
    scenes[first].pitch = view.pitch;
    scenes[first].yaw   = view.yaw;
    scenes[first].hfov  = view.hfov;
  }

  tourState.viewer = pannellum.viewer(host, {
    default: {
      firstScene: first,
      autoLoad: true,
      showControls: true,
      sceneFadeDuration: 400,
      // הכיתוב על החץ מופיע כטולטיפ של Pannellum; ‏hotSpotDebug כבוי כדי
      // שהעורך יראה בדיוק את מה שהגולש/ת יראה
      hotSpotDebug: false,
    },
    scenes,
  });
  // מעבר בין חללים דרך החצים הוא גם ניווט של העורך: הרשימה מימין חייבת
  // לעקוב, אחרת הנקודות שמוצגות בה שייכות לחלל אחר מזה שעל המסך.
  try{
    tourState.viewer.on('scenechange', (id)=>{
      tourState.currentId = id;
      tourState.pending = null;
      // מי שניווט בעצמו/ה לחלל אחר כבר לא נמצא/ת בחדר שבו ביקשנו לסמן את
      // המעבר חזרה, ולחיצה שם הייתה שותלת את החץ בחדר הלא נכון
      if (tourState.awaitingBack){
        tourState.awaitingBack = null;
        tourSetStatus('המעבר חזרה לא סומן - אפשר להוסיף אותו בכל רגע בלחיצה מהחלל השני');
      }
      document.getElementById('tourSpotForm').hidden = true;
      tourRenderSide();
    });
  } catch(e){ /* בלי האירוע, הרשימה מתעדכנת בלחיצה על שם החלל */ }

  tourRenderStageBar();
}

function tourViewerAngles(){
  try{
    return { pitch: tourState.viewer.getPitch(), yaw: tourState.viewer.getYaw(), hfov: tourState.viewer.getHfov() };
  } catch(e){ return null; }
}

/* אובייקט הסצנות של Pannellum — אותו אחד בדיוק שנשמר במסד ושמוזן לנגן.
   נקודה שהיעד שלה כבר לא קיים מושמטת: הנגן זורק שגיאה על סצנה חסרה, ושורה
   כזו במסד הייתה שוברת את הסיור גם אצל הגולשים.                           */
function tourScenesObject(){
  const known = new Set(tourState.scenes.map(s => s.id));
  const out = {};
  tourState.scenes.forEach((s, i)=>{
    out[s.id] = {
      title: s.title,
      type: 'equirectangular',
      panorama: s.panorama,
      order: i,
      pitch: s.pitch, yaw: s.yaw, hfov: s.hfov,
      hotSpots: (s.hotSpots || []).filter(h => known.has(h.sceneId)).map(h=>{
        const hs = { id: h.id, pitch: h.pitch, yaw: h.yaw, type: 'scene', text: h.text, sceneId: h.sceneId };
        if (Number.isFinite(h.targetYaw)) hs.targetYaw = h.targetYaw;
        return hs;
      }),
    };
  });
  return out;
}

/* ---------- הרשימה שמימין ---------- */
function tourRenderSide(){
  const wrap = document.getElementById('tourRooms');
  wrap.innerHTML = '';
  document.getElementById('tourRoomsEmpty').hidden = tourState.scenes.length > 0;

  tourState.scenes.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'tour-room' + (s.id === tourState.currentId ? ' active' : '');
    row.innerHTML =
      `<button type="button" class="name" title="פתיחת החלל בנגן"></button>` +
      (s.id === tourState.initialId ? '<span class="tag">פתיחה</span>' : '') +
      `<button type="button" class="icon" data-act="start" title="שהסיור ייפתח מכאן">★</button>` +
      `<button type="button" class="icon" data-act="rename" title="שינוי שם החלל">✎</button>` +
      `<button type="button" class="icon danger" data-act="remove" title="הסרת החלל">✕</button>`;
    row.querySelector('.name').textContent = s.title;
    row.querySelector('.name').addEventListener('click', ()=> tourSelectScene(s.id));
    row.querySelector('[data-act=start]').addEventListener('click', ()=> tourSetOpeningScene(s.id));
    row.querySelector('[data-act=rename]').addEventListener('click', ()=> tourRenameScene(s.id));
    row.querySelector('[data-act=remove]').addEventListener('click', ()=> tourRemoveScene(s.id));
    wrap.appendChild(row);
  });

  const scene = tourCurrentScene();
  const spotsWrap = document.getElementById('tourSpotsWrap');
  spotsWrap.hidden = !scene;
  if (scene){
    const list = document.getElementById('tourSpots');
    list.innerHTML = '';
    const spots = (scene.hotSpots || []).filter(h => tourSceneById(h.sceneId));
    document.getElementById('tourSpotsEmpty').hidden = spots.length > 0;
    spots.forEach(h=>{
      const el = document.createElement('div');
      el.className = 'tour-spot';
      el.innerHTML = '<span class="txt"></span><button type="button" class="icon" title="הסרת הנקודה">✕</button>';
      el.querySelector('.txt').textContent = h.text + ' → ' + (tourSceneById(h.sceneId)?.title || '');
      el.querySelector('.icon').addEventListener('click', ()=> tourRemoveHotspot(scene.id, h.id));
      list.appendChild(el);
    });
  }
  tourRenderStageBar();
}

function tourRenderStageBar(){
  const hint = document.getElementById('tourStageHint');
  const setView = document.getElementById('tourSetViewBtn');
  const scene = tourCurrentScene();
  setView.disabled = !scene || tourState.busy;

  if (!scene){
    hint.textContent = 'יש להוסיף חלל ראשון כדי להתחיל';
  } else if (tourState.awaitingBack){
    const from = tourSceneById(tourState.awaitingBack.fromSceneId);
    hint.textContent = `לחצו עכשיו על הדלת או המעבר שחוזרים ל"${from ? from.title : 'החלל הקודם'}"`;
  } else if (tourState.scenes.length < 2){
    hint.textContent = 'החלל מוצג כמו שיוצג בדף הנכס. אחרי שיהיו שני חללים אפשר לקשר ביניהם בלחיצה.';
  } else {
    hint.textContent = 'סובבו את התמונה ולחצו על דלת או מעבר כדי להוסיף שם נקודת מעבר.';
  }
}

function tourSelectScene(id){
  if (tourState.currentId === id) return;
  tourState.currentId = id;
  tourState.pending = null;
  tourState.awaitingBack = null;
  document.getElementById('tourSpotForm').hidden = true;
  if (tourState.viewer){
    try{ tourState.viewer.loadScene(id); tourRenderSide(); return; }
    catch(e){ /* נופלים לבנייה מחדש */ }
  }
  tourRenderSide();
  tourRebuildViewer();
}

/* ---------- הוספת חלל ---------- */
document.getElementById('tourAddFile').addEventListener('change', async (e)=>{
  const file = (e.target.files || [])[0];
  e.target.value = '';
  if (!file || tourState.busy) return;
  if (tourState.scenes.length >= PANO_MAX_SCENES){
    showToast(`אפשר עד ${PANO_MAX_SCENES} חללים בסיור אחד`);
    return;
  }

  const name = (prompt('שם החלל (סלון, מטבח, חדר שינה…):') || '').trim();
  if (!name) return;

  tourSetBusy(true, 'מכין את הפנורמה…');
  try{
    const blob = await preparePanorama(file);
    tourSetStatus('מעלה את הפנורמה…');
    const id = 'sc-' + tourShortId();
    const path = `${tourState.agentId}/${tourState.property.id}/${id}.${imageBlobExt(blob)}`;
    const { error } = await sb.storage.from(TOURS_BUCKET).upload(path, blob, {
      contentType: imageBlobType(blob), cacheControl:'31536000', upsert:false,
    });
    if (error) throw error;
    const panorama = sb.storage.from(TOURS_BUCKET).getPublicUrl(path).data.publicUrl;

    tourState.scenes.push({
      id, title:name.slice(0, 40), panorama, path, isNew:true,
      order: tourState.scenes.length, pitch:0, yaw:0, hfov:110, hotSpots:[],
    });
    if (!tourState.initialId) tourState.initialId = id;
    tourState.currentId = id;
    tourState.dirty = true;
    tourSetBusy(false);
    tourSetStatus('החלל נוסף - לא לשכוח לשמור בסוף');
    tourRenderSide();
    tourRebuildViewer();
  } catch(err){
    console.error(err);
    tourSetBusy(false);
    tourSetStatus(err.message || 'העלאת הפנורמה נכשלה', 'err');
  }
});

function tourRenameScene(id){
  const scene = tourSceneById(id);
  if (!scene) return;
  const name = (prompt('שם החלל:', scene.title) || '').trim();
  if (!name || name === scene.title) return;
  scene.title = name.slice(0, 40);
  // הכיתוב על החצים שמובילים לחלל הזה נכתב מהשם הישן; מי שלא שינה אותו
  // ידנית מקבל את החדש, ומי שכן — נשאר עם הנוסח שלו/ה.
  tourState.scenes.forEach(s => (s.hotSpots || []).forEach(h=>{
    if (h.sceneId === id && /^מעבר ל/.test(h.text)) h.text = 'מעבר ל' + name;
  }));
  tourState.dirty = true;
  tourRenderSide();
  tourRebuildViewer(true);
}

function tourRemoveScene(id){
  const scene = tourSceneById(id);
  if (!scene) return;
  const incoming = tourState.scenes.reduce((n, s)=>
    n + (s.id === id ? 0 : (s.hotSpots || []).filter(h => h.sceneId === id).length), 0);
  const warn = incoming ? `\n\n${incoming} נקודות מעבר שמובילות אליו יוסרו גם הן.` : '';
  if (!confirm(`להסיר את "${scene.title}" מהסיור?${warn}`)) return;

  // הקובץ נמחק רק אחרי שמירה מוצלחת: יציאה בלי לשמור משאירה את הסיור
  // השמור שלם, והוא עדיין מצביע על הפנורמה הזו.
  if (scene.path) tourState.trash.push(scene.path);
  tourState.scenes = tourState.scenes.filter(s => s.id !== id);
  tourState.scenes.forEach(s => { s.hotSpots = (s.hotSpots || []).filter(h => h.sceneId !== id); });
  if (tourState.initialId === id) tourState.initialId = tourState.scenes[0]?.id ?? null;
  if (tourState.currentId === id) tourState.currentId = tourState.initialId;
  tourState.pending = null;
  tourState.awaitingBack = null;
  document.getElementById('tourSpotForm').hidden = true;
  tourState.dirty = true;
  tourRenderSide();
  tourRebuildViewer();
}

function tourSetOpeningScene(id){
  if (tourState.initialId === id) return;
  tourState.initialId = id;
  tourState.dirty = true;
  tourSetStatus('החלל הזה יהיה הפתיחה של הסיור');
  tourRenderSide();
}

document.getElementById('tourSetViewBtn').addEventListener('click', ()=>{
  const scene = tourCurrentScene();
  const angles = tourViewerAngles();
  if (!scene || !angles) return;
  scene.pitch = tourRound(angles.pitch);
  scene.yaw   = tourRound(angles.yaw);
  scene.hfov  = tourRound(angles.hfov);
  tourState.dirty = true;
  tourSetStatus(`זווית הפתיחה של "${scene.title}" נקבעה למה שרואים עכשיו`);
});

/* ---------- נקודות המעבר ----------
   הלחיצה מזוהה כאן ולא דרך אירועי Pannellum: גרירה לסיבוב הפנורמה מסתיימת
   גם היא ב-mouseup, ובלי סף התזוזה כל סיבוב היה מוסיף נקודה.               */
let tourPointerStart = null;
const tourPanoEl = document.getElementById('tourPano');

tourPanoEl.addEventListener('pointerdown', (e)=>{
  tourPointerStart = { x:e.clientX, y:e.clientY, t:Date.now() };
});

tourPanoEl.addEventListener('pointerup', (e)=>{
  const start = tourPointerStart;
  tourPointerStart = null;
  if (!start || !tourState.viewer || tourState.busy) return;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;  // גרירה, לא לחיצה
  if (Date.now() - start.t > 700) return;                                // לחיצה ארוכה
  // לחיצה על חץ קיים או על פקדי הנגן אינה בקשה להוסיף נקודה חדשה
  if (e.target.closest && e.target.closest('.pnlm-hotspot-base, .pnlm-hotspot, .pnlm-controls-container, .pnlm-control, .pnlm-load-box, .pnlm-error-msg')) return;

  let coords = null;
  try{ coords = tourState.viewer.mouseEventToCoords(e); } catch(err){ coords = null; }
  if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])){
    showToast('לא ניתן לקרוא את המיקום בתמונה - נסו שוב');
    return;
  }
  const pitch = tourRound(coords[0]);
  const yaw   = tourNormYaw(coords[1]);

  if (tourState.awaitingBack){ tourCompleteBackHotspot(pitch, yaw); return; }
  tourOpenSpotForm(pitch, yaw);
});

function tourOpenSpotForm(pitch, yaw){
  const scene = tourCurrentScene();
  if (!scene) return;
  if (tourState.scenes.length < 2){
    showToast('צריך שני חללים לפחות כדי לקשר ביניהם - הוסיפו עוד חלל');
    return;
  }
  if ((scene.hotSpots || []).length >= PANO_MAX_HOTSPOTS){
    showToast(`אפשר עד ${PANO_MAX_HOTSPOTS} נקודות מעבר בחלל אחד`);
    return;
  }

  tourState.pending = { pitch, yaw };
  const select = document.getElementById('tourSpotTarget');
  select.innerHTML = '';
  tourState.scenes.filter(s => s.id !== scene.id).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title;
    select.appendChild(opt);
  });
  document.getElementById('tourSpotText').value = 'מעבר ל' + (tourSceneById(select.value)?.title || '');
  document.getElementById('tourSpotForm').hidden = false;
  select.focus();
}

// שינוי היעד מעדכן גם את הכיתוב: הוא נגזר מהשם ממילא, ומי שרוצה נוסח אחר
// כותב אותו אחרי הבחירה.
document.getElementById('tourSpotTarget').addEventListener('change', (e)=>{
  document.getElementById('tourSpotText').value = 'מעבר ל' + (tourSceneById(e.target.value)?.title || '');
});

document.getElementById('tourSpotCancel').addEventListener('click', ()=>{
  tourState.pending = null;
  document.getElementById('tourSpotForm').hidden = true;
});

document.getElementById('tourSpotAdd').addEventListener('click', ()=>{
  const scene = tourCurrentScene();
  const pending = tourState.pending;
  if (!scene || !pending) return;
  const targetId = document.getElementById('tourSpotTarget').value;
  const target = tourSceneById(targetId);
  if (!target) return;

  const hotSpot = {
    id: 'hs-' + tourShortId(),
    pitch: pending.pitch,
    yaw: pending.yaw,
    type: 'scene',
    text: (document.getElementById('tourSpotText').value.trim() || ('מעבר ל' + target.title)).slice(0, 60),
    sceneId: targetId,
    targetYaw: null,
  };
  scene.hotSpots = scene.hotSpots || [];
  scene.hotSpots.push(hotSpot);
  tourState.pending = null;
  tourState.dirty = true;
  document.getElementById('tourSpotForm').hidden = true;

  const wantBack = document.getElementById('tourSpotBack').checked
    && (target.hotSpots || []).length < PANO_MAX_HOTSPOTS;
  if (wantBack){
    // עוברים לחלל היעד ומחכים ללחיצה על הדלת חזרה. זו לחיצה ולא ניחוש:
    // שתי פנורמות אינן מצולמות באותו כיוון, ו-yaw+180 היה נוחת על קיר.
    tourState.awaitingBack = { fromSceneId: scene.id, hotSpotId: hotSpot.id };
    tourState.currentId = targetId;
    tourSetStatus(`נוספה נקודה. עכשיו לחצו ב"${target.title}" על הדלת שחוזרת ל"${scene.title}"`);
    tourRenderSide();
    tourRebuildViewer();
    return;
  }
  tourSetStatus('נקודת המעבר נוספה');
  tourRenderSide();
  tourRebuildViewer(true);
});

// הלחיצה השנייה: מייצרת את החץ ההפוך, ומכאן ידועות שתי הזוויות — ולכן
// אפשר לקבוע targetYaw לשני הכיוונים. מי שנכנס לחדר מסתובב אוטומטית
// *מהדלת* אל תוך החדר, כמו בכניסה אמיתית.
function tourCompleteBackHotspot(pitch, yaw){
  const pendingBack = tourState.awaitingBack;
  tourState.awaitingBack = null;
  const target = tourCurrentScene();
  const from = tourSceneById(pendingBack.fromSceneId);
  if (!target || !from || target.id === from.id){ tourRenderSide(); return; }
  const forward = (from.hotSpots || []).find(h => h.id === pendingBack.hotSpotId);
  if (!forward){ tourRenderSide(); return; }

  const backSpot = {
    id: 'hs-' + tourShortId(),
    pitch, yaw, type:'scene',
    text: 'חזרה ל' + from.title,
    sceneId: from.id,
    targetYaw: tourNormYaw(forward.yaw + 180),
  };
  target.hotSpots = target.hotSpots || [];
  target.hotSpots.push(backSpot);
  forward.targetYaw = tourNormYaw(yaw + 180);
  tourState.dirty = true;
  tourSetStatus(`המעבר בין "${from.title}" ל"${target.title}" מוגדר בשני הכיוונים`);
  tourRenderSide();
  tourRebuildViewer(true);
}

function tourRemoveHotspot(sceneId, hotSpotId){
  const scene = tourSceneById(sceneId);
  if (!scene) return;
  scene.hotSpots = (scene.hotSpots || []).filter(h => h.id !== hotSpotId);
  tourState.dirty = true;
  tourRenderSide();
  tourRebuildViewer(true);
}

/* ---------- שמירה ומחיקה ---------- */
document.getElementById('tourSaveBtn').addEventListener('click', async ()=>{
  if (tourState.busy || !tourState.property) return;
  /* חלל שאינו הפתיחה ואף נקודת מעבר אינה מובילה אליו הוא חלל שהגולש/ת
     פשוט לא תראה — הפנורמה הועלתה ונשמרה, והיא מחוץ לסיור. זו טעות נפוצה
     מספיק (מוסיפים ארבעה חדרים ומקשרים שניים) כדי לשאול לפני השמירה, אבל
     לא שגיאה: אפשר לשמור באמצע העבודה ולהמשיך מחר. */
  const unreachable = tourState.scenes.filter(s =>
    s.id !== tourState.initialId &&
    !tourState.scenes.some(o => o.id !== s.id && (o.hotSpots || []).some(h => h.sceneId === s.id)));
  if (unreachable.length && !confirm(
      `אף נקודת מעבר לא מובילה אל: ${unreachable.map(s => s.title).join(', ')}.\n` +
      'הגולש/ת לא תגיע אליהם מתוך הסיור. לשמור בכל זאת?')) return;

  tourSetBusy(true, 'שומר את הסיור…');
  try{
    const { error } = await sb.from('property_virtual_tours').upsert({
      property_id: tourState.property.id,
      initial_scene: tourState.initialId,
      scenes: tourScenesObject(),
    }, { onConflict: 'property_id' });
    if (error) throw error;

    // עכשיו — ורק עכשיו — הפנורמות של חללים שנמחקו כבר אינן מוזכרות בשום
    // סיור שמור, ואפשר למחוק אותן. ‏best-effort: כישלון משאיר קובץ יתום.
    if (tourState.trash.length){
      sb.storage.from(TOURS_BUCKET).remove(tourState.trash.slice()).catch(()=>{});
      tourState.trash = [];
    }
    tourState.scenes.forEach(s => { s.isNew = false; });
    tourState.dirty = false;
    tourSetBusy(false);
    tourSetStatus('הסיור נשמר ומוצג בדף הנכס', 'ok');
    showToast('הסיור נשמר 🌐');
    // ‏has_virtual_tour מתעדכן בטריגר; הרשימה בדשבורד צריכה לדעת עליו
    if (tourState.agentId) loadProperties(tourState.agentId);
  } catch(err){
    console.error(err);
    tourSetBusy(false);
    tourSetStatus('השמירה נכשלה: ' + (err.message || 'שגיאה'), 'err');
  }
});

document.getElementById('tourDeleteBtn').addEventListener('click', async ()=>{
  if (tourState.busy || !tourState.property) return;
  if (!confirm('למחוק את הסיור כולו? כל הפנורמות ונקודות המעבר יימחקו, והכפתור ירד מדף הנכס.')) return;

  tourSetBusy(true, 'מוחק…');
  try{
    const { error } = await sb.from('property_virtual_tours').delete().eq('property_id', tourState.property.id);
    if (error) throw error;
    const paths = tourState.scenes.map(s => s.path).filter(Boolean).concat(tourState.trash);
    if (paths.length) sb.storage.from(TOURS_BUCKET).remove(paths).catch(()=>{});
    tourState.scenes = [];
    tourState.trash = [];
    tourState.initialId = null;
    tourState.currentId = null;
    tourState.dirty = false;
    tourSetBusy(false);
    tourRenderSide();
    tourRebuildViewer();
    showToast('הסיור נמחק');
    if (tourState.agentId) loadProperties(tourState.agentId);
    closeTourModal();
  } catch(err){
    console.error(err);
    tourSetBusy(false);
    tourSetStatus('המחיקה נכשלה: ' + (err.message || 'שגיאה'), 'err');
  }
});

/* ---------- פתיחה, סגירה ויציאה בלי לשמור ---------- */
let tourHistoryEntry = false;

function openTourModal(){
  document.getElementById('tourModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  tourState.open = true;
  try{ history.pushState({ tourEditor:true }, ''); tourHistoryEntry = true; }
  catch(e){ tourHistoryEntry = false; }
}

function closeTourModal(fromHistory){
  const modal = document.getElementById('tourModal');
  if (modal.style.display === 'none') return;

  // שינויים שלא נשמרו: הפנורמות שהועלו בחלון הזה עדיין אינן מוזכרות בשום
  // סיור שמור, ולכן היציאה מוחקת אותן. בלי זה כל עריכה מבוטלת הייתה
  // משאירה קבצים בדלי לנצח.
  if (tourState.dirty && !fromHistory){
    if (!confirm('יש שינויים שלא נשמרו. לצאת ולבטל אותם?')) return;
  }
  if (tourState.dirty){
    const fresh = tourState.scenes.filter(s => s.isNew).map(s => s.path).filter(Boolean);
    if (fresh.length) sb.storage.from(TOURS_BUCKET).remove(fresh).catch(()=>{});
  }

  if (tourState.viewer){
    try{ tourState.viewer.destroy(); } catch(e){}
    tourState.viewer = null;
  }
  document.getElementById('tourPano').innerHTML = '';
  document.getElementById('tourSpotForm').hidden = true;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  tourState.open = false;
  tourState.scenes = [];
  tourState.trash = [];
  tourState.pending = null;
  tourState.awaitingBack = null;
  tourState.dirty = false;
  tourState.property = null;

  const hadEntry = tourHistoryEntry;
  tourHistoryEntry = false;
  if (!fromHistory && hadEntry){ try{ history.back(); }catch(e){} }
}

document.getElementById('tourCloseBtn').addEventListener('click', ()=> closeTourModal());
document.getElementById('tourCloseX').addEventListener('click', ()=> closeTourModal());
document.getElementById('tourModal').addEventListener('click', (e)=>{
  if (e.target.id === 'tourModal') closeTourModal();
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && tourState.open) closeTourModal();
});
window.addEventListener('popstate', ()=>{
  if (tourHistoryEntry) closeTourModal(true);
});

/* ==========================================================================
   מדבקת QR לשלט
   --------------------------------------------------------------------------
   הסוכן/ת מדביק/ה על השלט שבשטח קוד שסריקתו פותחת את עמוד הנכס באתר. הכול
   נעשה בדפדפן ובלי שרת: המדבקה מצוירת על canvas בגודל A6 ב-300dpi, וממנה
   נבנה קובץ PDF בן עמוד אחד.

   גם מקודד ה-QR וגם כתיבת ה-PDF ממומשים כאן ולא נטענים מ-CDN, כי מדבקה
   שנכשלת ברגע שספרייה חיצונית לא נטענת היא מדבקה שלא מודפסת. המקודד תומך
   במצב בייטים ובגרסאות 1–10 (עד 271 בייט) — יותר מספיק לכתובת עמוד נכס.
   ========================================================================== */

/* טבלאות התקן: לכל גרסה ורמת תיקון —
   [קודי תיקון לבלוק, בלוקים בקבוצה 1, קודי מידע בבלוק, בלוקים בקבוצה 2, קודי מידע בבלוק] */
const QR_EC_BLOCKS = {
  M: [null,[10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],
      [16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]],
  Q: [null,[13,1,13,0,0],[22,1,22,0,0],[18,2,17,0,0],[26,2,24,0,0],[18,2,15,2,16],
      [24,4,19,0,0],[18,2,14,4,15],[22,4,18,2,19],[20,4,16,4,17],[24,6,19,2,20]],
};
const QR_ALIGN = [null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const QR_EC_BITS = { L:1, M:0, Q:3, H:2 };

// שדה גלואה GF(256) עבור קודי ריד-סולומון
const QR_EXP = new Uint8Array(512), QR_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++){ QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255];
})();
function qrMul(a, b){ return (a === 0 || b === 0) ? 0 : QR_EXP[QR_LOG[a] + QR_LOG[b]]; }
function qrGenPoly(n){
  let poly = [1];
  for (let i = 0; i < n; i++){
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++){
      next[j] ^= poly[j];
      next[j + 1] ^= qrMul(poly[j], QR_EXP[i]);
    }
    poly = next;
  }
  return poly;
}
function qrRemainder(data, ecCount){
  const gen = qrGenPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++){
    const factor = res[i];
    if (!factor) continue;
    for (let j = 1; j <= ecCount; j++) res[i + j] ^= qrMul(gen[j], factor);
  }
  return res.subarray(data.length);
}
function qrPushByte(arr, byte){ for (let i = 7; i >= 0; i--) arr.push((byte >> i) & 1); }

/* מחזיר { size, version, mask, modules } — modules הוא מערך דו-ממדי של 0/1 */
function qrEncode(text, level){
  const ec = level || 'Q';
  const bytes = new TextEncoder().encode(String(text));
  const table = QR_EC_BLOCKS[ec];

  let version = 0, spec = null;
  for (let v = 1; v <= 10; v++){
    const s = table[v];
    const capacity = (s[1] * s[2] + s[3] * s[4]) * 8;
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= capacity){ version = v; spec = s; break; }
  }
  if (!version) throw new Error('הכתובת ארוכה מדי לקוד QR');

  const totalData = spec[1] * spec[2] + spec[3] * spec[4];

  // ---- זרם הביטים: מצב בייטים, אורך, נתונים, סוגר ותווי מילוי ----
  const bits = [];
  const put = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  put(4, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const codewords = new Uint8Array(totalData);
  for (let i = 0; i < bits.length / 8; i++){
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    codewords[i] = b;
  }
  for (let i = bits.length / 8, pad = 0; i < totalData; i++, pad++) codewords[i] = pad % 2 ? 0x11 : 0xEC;

  // ---- חלוקה לבלוקים, קודי תיקון ושזירה ----
  const dataBlocks = [], ecBlocks = [];
  let pos = 0;
  const addBlocks = (count, size) => {
    for (let i = 0; i < count; i++){
      const block = codewords.subarray(pos, pos + size);
      pos += size;
      dataBlocks.push(block);
      ecBlocks.push(qrRemainder(block, spec[0]));
    }
  };
  addBlocks(spec[1], spec[2]);
  addBlocks(spec[3], spec[4]);

  const finalBits = [];
  const longest = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < longest; i++)
    dataBlocks.forEach(b => { if (i < b.length) qrPushByte(finalBits, b[i]); });
  for (let i = 0; i < spec[0]; i++)
    ecBlocks.forEach(b => qrPushByte(finalBits, b[i]));
  // ביטי שארית: בגרסאות 2–6 נוספים שבעה ביטים אפס בסוף
  if (version >= 2 && version <= 6) for (let i = 0; i < 7; i++) finalBits.push(0);

  // ---- תבניות קבועות ----
  const size = version * 4 + 17;
  const grid = [], reserved = [];
  for (let r = 0; r < size; r++){
    grid.push(new Array(size).fill(0));
    reserved.push(new Array(size).fill(false));
  }
  const setF = (r, c, v) => { grid[r][c] = v; reserved[r][c] = true; };

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++){
      const rr = row + r, cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      setF(rr, cc, (ring || core) ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++){          // שורת ועמודת התזמון
    setF(6, i, i % 2 === 0 ? 1 : 0);
    setF(i, 6, i % 2 === 0 ? 1 : 0);
  }

  const centers = QR_ALIGN[version];           // עוגני היישור, למעט אלה שנופלים על עוגני הזיהוי
  centers.forEach(r => centers.forEach(c => {
    if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) return;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
  }));

  setF(size - 8, 8, 1);                        // המודול הכהה הקבוע

  for (let i = 0; i < 9; i++){                 // שמירת מקום למידע הפורמט
    if (!reserved[8][i]) setF(8, i, 0);
    if (!reserved[i][8]) setF(i, 8, 0);
  }
  for (let i = 0; i < 8; i++){
    if (!reserved[8][size - 1 - i]) setF(8, size - 1 - i, 0);
    if (!reserved[size - 1 - i][8]) setF(size - 1 - i, 8, 0);
  }

  if (version >= 7){                           // מידע הגרסה, ‏BCH(18,6)
    let d = version << 12;
    for (let i = 0; i < 6; i++) if ((d >> (17 - i)) & 1) d ^= 0x1F25 << (5 - i);
    const vBits = (version << 12) | d;
    for (let i = 0; i < 18; i++){
      const bit = (vBits >> i) & 1;
      setF(Math.floor(i / 3), size - 11 + (i % 3), bit);
      setF(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  // ---- שיבוץ הנתונים בזיגזג מהפינה הימנית-תחתונה ----
  let bitIndex = 0, upward = true;
  for (let col = size - 1; col > 0; col -= 2){
    if (col === 6) col--;                      // עמודת התזמון נדלגת
    for (let i = 0; i < size; i++){
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++){
        const cc = col - c;
        if (reserved[row][cc]) continue;
        grid[row][cc] = bitIndex < finalBits.length ? finalBits[bitIndex] : 0;
        bitIndex++;
      }
    }
    upward = !upward;
  }

  // ---- בחירת המסכה בעלת ניקוד הקנס הנמוך ביותר ----
  let best = null;
  for (let mask = 0; mask < 8; mask++){
    const modules = qrApplyMask(grid, reserved, size, mask, ec);
    const score = qrPenalty(modules, size);
    if (!best || score < best.score) best = { score, modules, mask };
  }
  return { size, version, mask: best.mask, modules: best.modules };
}

/* מחיל מסכה על מודולי הנתונים וכותב את מידע הפורמט בשני העותקים */
function qrApplyMask(grid, reserved, size, mask, ec){
  const rule = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ][mask];
  const out = [];
  for (let r = 0; r < size; r++){
    out.push(new Array(size));
    for (let c = 0; c < size; c++)
      out[r][c] = reserved[r][c] ? grid[r][c] : (rule(r, c) ? grid[r][c] ^ 1 : grid[r][c]);
  }

  const fmt = (QR_EC_BITS[ec] << 3) | mask;    // חמישה ביטים עם BCH(15,5) ו-XOR קבוע
  let d = fmt << 10;
  for (let i = 0; i < 5; i++) if ((d >> (14 - i)) & 1) d ^= 0x537 << (4 - i);
  const bitsF = ((fmt << 10) | d) ^ 0x5412;
  const get = i => (bitsF >> i) & 1;
  for (let i = 0; i <= 5; i++){ out[8][i] = get(14 - i); out[i][8] = get(i); }
  out[8][7] = get(8); out[8][8] = get(7); out[7][8] = get(6);
  for (let i = 0; i <= 6; i++) out[size - 1 - i][8] = get(14 - i);
  for (let i = 0; i <= 7; i++) out[8][size - 1 - i] = get(i);
  out[size - 8][8] = 1;
  return out;
}

/* ניקוד הקנס לפי ארבעת הכללים בתקן — ככל שנמוך יותר, כך הקוד קריא יותר */
function qrPenalty(m, size){
  let score = 0;
  for (let i = 0; i < size; i++){
    for (const read of [(j) => m[i][j], (j) => m[j][i]]){
      let run = 1;
      for (let j = 1; j < size; j++){
        if (read(j) === read(j - 1)) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++)
    if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  const patA = [1,0,1,1,1,0,1,0,0,0,0], patB = [0,0,0,0,1,0,1,1,1,0,1];
  for (let i = 0; i < size; i++) for (let j = 0; j <= size - 11; j++){
    for (const read of [(k) => m[i][j + k], (k) => m[j + k][i]]){
      let a = true, b = true;
      for (let k = 0; k < 11; k++){ if (read(k) !== patA[k]) a = false; if (read(k) !== patB[k]) b = false; }
      if (a) score += 40;
      if (b) score += 40;
    }
  }
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
  return score;
}

/* ---------- ציור המדבקה ---------- */

const QR_STICKER_W = 1063;                  // רוחב המדבקה: 90 מ"מ ב-300dpi
let qrStickerPage = { w: 0, h: 0, mmW: 0, mmH: 0 };  // גודל העמוד ב-PDF, נקבע בציור

function propertyPublicLink(propertyId){
  const dir = window.location.pathname.replace(/[^/]*$/, '');
  return window.location.origin + dir + 'property.html?id=' + encodeURIComponent(propertyId);
}

function qrFit(ctx, text, maxWidth){
  let t = String(text);
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/* המדבקה: הקוד בתוך מסגרת, ומתחתיו שורת ההנחיה לסורק — וזהו. פרטי הנכס
   כבר מופיעים על השלט שעליו היא מודבקת, וכל מה שהיא צריכה להוסיף הוא הקוד
   וההסבר מה עושים איתו. גובה המדבקה נגזר מגודל הקוד, כדי שלא יישאר סביבו
   שטח לבן מיותר — וממנו נגזר גם גודל עמוד ה-PDF.                         */
function drawQrSticker(canvas, link){
  const W = QR_STICKER_W, margin = 66;
  const qr = qrEncode(link, 'Q');
  // ‏+8 = שוליים שקטים של ארבעה מודולים מכל צד, כפי שדורש התקן לסריקה
  const cell = Math.max(4, Math.floor((W - margin * 2) / (qr.size + 8)));
  const box = cell * (qr.size + 8);
  const qrX = Math.round((W - box) / 2), qrY = margin;
  const sepY = qrY + box + 44;
  const H = sepY + 196;

  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // המסגרת החיצונית היא גם קו הגזירה של המדבקה
  ctx.strokeStyle = '#C5C3BC';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, W - 20, H - 20);

  ctx.fillStyle = '#000000';
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++)
    if (qr.modules[r][c]) ctx.fillRect(qrX + (c + 4) * cell, qrY + (r + 4) * cell, cell, cell);

  ctx.strokeStyle = '#E0E7ED';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(margin, sepY);
  ctx.lineTo(W - margin, sepY);
  ctx.stroke();

  const write = (text, y, font, color) => {
    ctx.font = font; ctx.fillStyle = color;
    ctx.fillText(qrFit(ctx, text, W - margin * 2), W / 2, y);
  };
  write('סרקו לצפייה בנכס', sepY + 84, "800 56px 'Heebo', sans-serif", '#1C3A5E');
  write('כל התמונות, הפרטים ויצירת קשר ישירה', sepY + 142, "400 36px 'Heebo', sans-serif", '#565C63');

  // גודל העמוד ב-PDF, בנקודות, לפי אותם 300dpi שבהם צוירה המדבקה
  qrStickerPage = {
    w: +(W / 300 * 72).toFixed(2), h: +(H / 300 * 72).toFixed(2),
    mmW: Math.round(W / 300 * 25.4), mmH: Math.round(H / 300 * 25.4),
  };
}

/* ---------- בניית קובץ ה-PDF ----------
   עמוד אחד בגודל A6 שכולו תמונת המדבקה. ‏PDF הוא פורמט טקסטואלי עם טבלת
   היסטים בסופו, ולכן אפשר להרכיב אותו כאן ישירות מבייטים — בלי ספריית
   ייצוא ובלי בעיית גופנים בעברית, כי הטקסט כבר מצויר בתוך התמונה.       */
function buildStickerPdf(jpeg, pxW, pxH, ptW, ptH){
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const offsets = [];
  const push = part => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (num, body) => { offsets[num] = length; push(num + ' 0 obj\n'); push(body); push('\nendobj\n'); };

  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptW + ' ' + ptH + ']' +
            ' /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
  const content = 'q ' + ptW + ' 0 0 ' + ptH + ' 0 0 cm /Im0 Do Q';
  object(4, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  offsets[5] = length;
  push('5 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pxW + ' /Height ' + pxH +
       ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
  push(jpeg);
  push('\nendstream\nendobj\n');

  const xref = length;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table);
  push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  const out = new Uint8Array(length);
  let at = 0;
  chunks.forEach(c => { out.set(c, at); at += c.length; });
  return out;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
}

function canvasBlob(canvas, type, quality){
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/* ---------- החלון והכפתורים ---------- */

let qrStickerProperty = null, qrStickerLink = '';

async function openQrSticker(property, btn){
  const original = actionLabel(btn);
  if (btn){ btn.disabled = true; setActionLabel(btn, 'מכין מדבקה…'); }
  try{
    const link = propertyPublicLink(property.id);
    const canvas = document.getElementById('qrCanvas');
    // בלי ההמתנה הזו הגופנים עדיין לא זמינים ל-canvas בפתיחה הראשונה,
    // והמדבקה מצוירת בגופן ברירת המחדל של הדפדפן
    if (document.fonts && document.fonts.load){
      await Promise.all([
        document.fonts.load("800 56px 'Heebo'"),
        document.fonts.load("400 36px 'Heebo'"),
      ]).catch(()=>{});
    }
    drawQrSticker(canvas, link);
    qrStickerProperty = property;
    qrStickerLink = link;

    document.getElementById('qrSub').textContent =
      (property.title ? property.title + ' · ' : '') +
      'מדבקה להדפסה בגודל ' + qrStickerPage.mmW + ' על ' + qrStickerPage.mmH +
      ' מ״מ. סריקה של הקוד פותחת את עמוד הנכס באתר.';
    // ‏navigator.share קיים בעיקר בדפדפני מובייל — במחשב פשוט אין כפתור שיתוף
    document.getElementById('qrShareBtn').style.display = navigator.share ? '' : 'none';
    document.getElementById('qrLink').textContent = link;
    const warn = document.getElementById('qrWarn');
    // כשהדף נפתח מהדיסק (file://) הכתובת שנבנית כאן לא קיימת באינטרנט,
    // והמדבקה תוביל לשום מקום — עדיף להגיד את זה לפני ההדפסה
    if (!/^https?:$/.test(window.location.protocol)){
      warn.style.display = 'block';
      warn.textContent = 'שימו לב: הדף נפתח מקובץ מקומי ולכן הקישור שבקוד אינו כתובת אינטרנט. הפיקו את המדבקה מהאתר עצמו.';
    } else {
      warn.style.display = 'none';
    }
    openQrModal();
  } catch(err){
    console.error(err);
    showToast('שגיאה בהפקת המדבקה - נסו שוב');
  } finally {
    if (btn){ btn.disabled = false; setActionLabel(btn, original); }
  }
}

function qrStickerFilename(ext){
  const id = qrStickerProperty?.listing_number || String(qrStickerProperty?.id || '').slice(0, 8);
  return 'qr-sticker-' + (id || 'property') + '.' + ext;
}

/* פתיחה וסגירה של החלון. יש חמש דרכים לצאת ממנו — ה-✕ שנשאר דבוק לראש
   החלון, כפתור "סגירה", לחיצה על הרקע, מקש Escape, וכפתור "חזור" של
   הטלפון — כדי שלא ייווצר מצב שהמדבקה תופסת את המסך בלי יציאה.        */
let qrHistoryEntry = false;

function openQrModal(){
  document.getElementById('qrModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';   // הדף שמאחור לא נגלל יחד עם החלון
  // מצב היסטוריה ייעודי: "חזור" בטלפון סוגר את החלון במקום לצאת מה-CRM
  try{ history.pushState({ qrSticker:true }, ''); qrHistoryEntry = true; }
  catch(e){ qrHistoryEntry = false; }
}

function closeQrModal(fromHistory){
  const modal = document.getElementById('qrModal');
  if (modal.style.display === 'none') return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
  const hadEntry = qrHistoryEntry;
  qrHistoryEntry = false;
  // סגירה בלחיצה מוחקת גם את מצב ההיסטוריה, אחרת "חזור" הבא לא יעשה כלום
  if (!fromHistory && hadEntry){ try{ history.back(); }catch(e){} }
}

document.getElementById('qrCloseBtn').addEventListener('click', ()=> closeQrModal());
document.getElementById('qrCloseX').addEventListener('click', ()=> closeQrModal());
document.getElementById('qrModal').addEventListener('click', (e)=>{
  if (e.target.id === 'qrModal') closeQrModal();
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') closeQrModal();
});
window.addEventListener('popstate', ()=>{
  if (qrHistoryEntry) closeQrModal(true);
});

/* בונה את קובץ ה-PDF מהמדבקה שכבר מצוירת על ה-canvas */
async function stickerPdfBytes(){
  const canvas = document.getElementById('qrCanvas');
  const blob = await canvasBlob(canvas, 'image/jpeg', 0.95);
  if (!blob) throw new Error('canvas.toBlob נכשל');
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return buildStickerPdf(jpeg, canvas.width, canvas.height, qrStickerPage.w, qrStickerPage.h);
}

document.getElementById('qrPdfBtn').addEventListener('click', async (e)=>{
  const btn = e.currentTarget, original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מייצר PDF…';
  try{
    downloadBlob(new Blob([await stickerPdfBytes()], { type:'application/pdf' }), qrStickerFilename('pdf'));
    showToast('המדבקה ירדה כקובץ PDF - הדפיסו בגודל מקורי (100%)');
  } catch(err){
    console.error(err);
    showToast('שגיאה בהורדת ה-PDF - נסו שוב');
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

/* שיתוף ישיר מהטלפון (וואטסאפ, מייל וכו׳). דפדפן שיודע לשתף קבצים מקבל את
   ה-PDF עצמו; אחרת משתפים לפחות את הקישור לעמוד הנכס.                     */
document.getElementById('qrShareBtn').addEventListener('click', async (e)=>{
  const btn = e.currentTarget, original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מכין לשיתוף…';
  try{
    const title = 'מדבקת QR · ' + (qrStickerProperty?.title || 'נכס');
    const file = new File([await stickerPdfBytes()], qrStickerFilename('pdf'), { type:'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title });
    } else if (navigator.share){
      await navigator.share({ title, text: title, url: qrStickerLink });
    } else {
      showToast('הדפדפן לא תומך בשיתוף - השתמשו בהורדה');
    }
  } catch(err){
    if (err && err.name === 'AbortError') return;   // המשתמש/ת סגר/ה את חלון השיתוף
    console.error(err);
    showToast('שגיאה בשיתוף - נסו להוריד את הקובץ');
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById('qrPngBtn').addEventListener('click', async (e)=>{
  const btn = e.currentTarget, original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מייצר תמונה…';
  try{
    const blob = await canvasBlob(document.getElementById('qrCanvas'), 'image/png');
    if (!blob) throw new Error('canvas.toBlob נכשל');
    downloadBlob(blob, qrStickerFilename('png'));
    showToast('המדבקה ירדה כתמונה');
  } catch(err){
    console.error(err);
    showToast('שגיאה בהורדת התמונה - נסו שוב');
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
});
let editingPropertyId = null;
let editingPropertyOriginalAddress = null; // לזיהוי "האם הכתובת השתנתה" בעריכה
function openEditProperty(p){
  editingPropertyId = p.id;
  // בלוק הסטטוס ראשון בטופס — זו הפעולה שמחפשים כשנכנסים ל"עריכה" בלי
  // שיש מה לערוך ("להוריד את זה מהאתר"), והיא לא צריכה גלילה
  renderPropertyStatusPanel(p, myPropertyAgentId);
  document.getElementById('npTitle').value = p.title;
  currentCategory = p.category || 'residential';
  document.querySelectorAll('[data-category]').forEach(b=> b.classList.toggle('active', b.dataset.category === currentCategory));
  updateFormForCategory(currentCategory, p.features || []);
  document.getElementById('npType').value = p.property_type;
  updateLandPlanningFields(); // אחרי הצבת סוג הנכס, לא לפניה
  document.getElementById('npLandZoning').value = p.land_zoning || '';
  document.getElementById('npLandBuildingPct').value = p.land_building_rights_pct ?? '';
  document.getElementById('npLandMaxUnits').value = p.land_max_units ?? '';
  document.getElementById('npLandMaxFloors').value = p.land_max_floors ?? '';
  document.getElementById('npLandPlanningNotes').value = p.land_planning_notes || '';
  document.getElementById('npDeal').value = p.deal_type;
  document.getElementById('npPrice').value = p.price;
  document.getElementById('npRooms').value = p.rooms || '';
  document.getElementById('npCity').value = p.city || 'עפולה';
  document.getElementById('npStreet').value = p.street || '';
  // אסינכרונית: הנכס נשמר בזמנו בטקסט חופשי, וההערה מתחת לשדה תגיד אם
  // הכתיב שלו עדיין עומד ברשימה — בלי לגעת בנכס עד שנשמר מחדש.
  ensureStreetsLoaded().then(refreshStreetHint);
  document.getElementById('npHouseNumber').value = p.house_number || '';
  document.getElementById('npLat').value = p.lat || '';
  document.getElementById('npLng').value = p.lng || '';
  document.getElementById('npSalesArea').value = p.sales_area || '';
  populateNeighborhoodSelect(p.neighborhood_id || '');
  document.getElementById('npFloor').value = p.floor ?? '';
  document.getElementById('npTotalFloors').value = p.total_floors ?? '';
  document.getElementById('npSizeSqm').value = p.size_sqm ?? '';
  document.getElementById('npBuiltSizeSqm').value = p.built_size_sqm ?? '';
  document.getElementById('npGardenSqm').value = p.garden_sqm ?? '';
  document.getElementById('npDescription').value = p.description || '';
  document.getElementById('npMarketingDescription').value = p.marketing_description || '';
  document.getElementById('npPostText').value = p.post_text || '';
  syncMarketingCopyField(p);
  document.getElementById('npFurnitureDetails').value = p.furniture_details || '';
  document.getElementById('npTour3dUrl').value = p.tour_3d_url || '';
  document.getElementById('npExpiresAt').value = p.listing_expires_at || '';
  document.getElementById('npAgent2Name').value = p.agent2_name || '';
  document.getElementById('npAgent2Phone').value = p.agent2_phone || '';
  // אסינכרונית (שליפת הצוות) — ולכן אחרי הצבת השדות עצמם, שממנה היא נגזרת
  populateAgent2Select(p.agent2_name, p.agent2_phone);
  // ‏property_owners הוא יחס 1:1, אבל PostgREST מחזיר אותו כאובייקט או כמערך
  // בן איבר אחד לפי גרסה — מטפלים בשניהם.
  const owner = Array.isArray(p.property_owners) ? p.property_owners[0] : p.property_owners;
  document.getElementById('npOwnerName').value = owner?.owner_name || '';
  document.getElementById('npOwnerPhone').value = owner?.owner_phone || '';
  document.getElementById('npCondition').value = p.condition || '';
  document.getElementById('npProjectStatus').value = p.project_status || '';
  document.getElementById('npMoveInDate').value = p.move_in_date || '';
  document.getElementById('npMoveInSoon').checked = !!p.move_in_soon;
  // חלון היריד מוצג כפי שנשמר, גם כשהנכס כבר יצא ממנו: התאריכים נשארים על
  // הנכס, וסוכן/ת שמסמן/ת השתתפות מחדש רואה קודם את מה שהבטיח/ה בפעם הקודמת.
  document.getElementById('npOpenHouse').checked = !!p.open_house;
  document.getElementById('npOpenHouseStart').value = openHouseDateInput(p.open_house_start);
  document.getElementById('npOpenHouseEnd').value = openHouseDateInput(p.open_house_end);
  syncOpenHouseFields();
  document.getElementById('npRestrooms').value = p.restrooms_location || '';
  document.getElementById('npStorageLoc').value = p.storage_location || '';
  document.getElementById('npMamadLoc').value = p.mamad_location || '';
  editingPropertyOriginalAddress = { street: p.street || '', house_number: p.house_number || '' };
  resetImageState();
  imageSlots = (p.images || []).map(url => ({ url }));
  renderImagePreview();
  if (p.marketing_image){
    marketingImageSlot = { url: p.marketing_image };
    renderMarketingImagePreview();
  }
  // ‏video_url אחת, שני מצבים: קובץ שלנו בדלי מקבל תצוגה מקדימה עם נגן,
  // וכתובת חיצונית חוזרת לשדה הקישור. ‏videoOriginalUrl זוכרת את המצב ההתחלתי
  // כדי שהחלפה או הסרה ימחקו את הקובץ הישן מה-Storage בשמירה.
  videoOriginalUrl = p.video_url || null;
  if (videoStoragePath(p.video_url)){
    videoSlot = { url: p.video_url };
  } else {
    document.getElementById('npVideoUrl').value = p.video_url || '';
  }
  renderVideoPreview();
  addForm.style.display = 'block';
  document.getElementById('addPropertyBtn').textContent = 'שמירת שינויים';
  toggleBtn.textContent = '✕ ביטול';
  openAcc('accProperties');
  addForm.scrollIntoView({ behavior:'smooth' });
}

/* ---------- ייבוא נכסים מקובץ חיצוני (שלב א') ----------
   כל העיבוד קורה בדפדפן: הקובץ נקרא, ממופה, מנורמל ונבדק כאן, וההכנסה היא
   ‏insert רגיל בסשן של המשתמש/ת. לכן ה-policy הקיימת על properties היא
   שמירת הגבול — "agent insert own properties" מחייבת
   ‏agent_id = current_agent_id() וגם agency_id = current_agency_id().
   מכאן נובעת המגבלה של השלב הזה: אפשר לייבא רק לעצמך. ייבוא של מנהל/ת
   עבור סוכן/ת אחר/ת במשרד דורש policy נוספת, ולכן נדחה לשלב הבא.

   ‏property_type ב-DB הוא טקסט חופשי בלי CHECK — הוא נבדק כאן מול אותן
   רשימות שמזינות את הטופס הידני, אחרת ייכנסו סוגים שלא יתפסו בפילטרים
   של החיפוש באתר. condition/project_status/*_location הם enum באנגלית,
   ולכן מתורגמים מהעברית שבקובץ.                                          */

const IMPORT_MAX_ROWS = 500;
const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IMPORT_CHUNK = 50;   // גודל מנת ה-insert

/* ‏SheetJS נטענת רק בפתיחת האשף (כ-900KB) כדי לא להאט את טעינת ה-CRM.
   ‏cdn.sheetjs.com היא הכתובת הרשמית והמעודכנת; jsdelivr הוא גיבוי אם
   הראשונה חסומה/לא זמינה, ומשם ממילא נטענת כבר supabase-js.            */
const IMPORT_LIB_URLS = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];
let importLibPromise = null;
function loadImportLib(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (importLibPromise) return importLibPromise;
  importLibPromise = new Promise((resolve, reject)=>{
    let i = 0;
    (function tryNext(){
      if (i >= IMPORT_LIB_URLS.length){
        importLibPromise = null;
        reject(new Error('טעינת רכיב קריאת הקבצים נכשלה - בדקו את חיבור האינטרנט ונסו שוב'));
        return;
      }
      const s = document.createElement('script');
      s.src = IMPORT_LIB_URLS[i++];
      s.onload = ()=> window.XLSX ? resolve(window.XLSX) : tryNext();
      s.onerror = ()=>{ s.remove(); tryNext(); };
      document.head.appendChild(s);
    })();
  });
  return importLibPromise;
}

/* השדות שניתן לייבא. aliases = כותרות שהמיפוי האוטומטי מזהה בקובץ. */
const IMPORT_FIELDS = [
  // כותרת אינה חובה בקובץ: קבצי ייצוא רבים מזהים מודעה לפי כתובת ולא לפי
  // כותרת, ולכן כשהעמודה חסרה נבנית כותרת מסוג הנכס, החדרים והכתובת.
  { key:'title', label:'כותרת', hint:'אם ריק - תיווצר כותרת אוטומטית מסוג הנכס והכתובת', aliases:['כותרת','שם','שם הנכס','כותרת המודעה','title','name'] },
  { key:'status', label:'סטטוס', hint:'פעיל / נמכר / הושכר / לא פעיל - ברירת מחדל: פעיל', aliases:['סטטוס','מצב מודעה','status'] },
  { key:'category', label:'קטגוריה', hint:'מגורים / מסחרי - ברירת מחדל: מגורים', aliases:['קטגוריה','category'] },
  { key:'property_type', label:'סוג נכס', required:true, aliases:['סוג נכס','סוג הנכס','סוג','property_type','type'] },
  { key:'deal_type', label:'סוג עסקה', required:true, hint:'מכירה / השכרה', aliases:['סוג עסקה','עסקה','deal_type','deal','מכירה השכרה'] },
  { key:'price', label:'מחיר', required:true, aliases:['מחיר','מחיר מבוקש','price','מחיר בשח'] },
  { key:'city', label:'עיר', required:true, aliases:['עיר','ישוב','יישוב','city'] },
  { key:'rooms', label:'חדרים', aliases:['חדרים','מספר חדרים','חד','rooms'] },
  { key:'neighborhood', label:'שכונה', hint:'חייבת להיות שכונה שקיימת ברשימת הפלטפורמה', aliases:['שכונה','neighborhood'] },
  { key:'sales_area', label:'איזור מכירה', aliases:['איזור מכירה','אזור מכירה','איזור','אזור','sales_area','area'] },
  { key:'street', label:'רחוב', aliases:['רחוב','כתובת','street','address'] },
  // בלי הכינוי "מספר" לבדו: בקבצי ייצוא הוא כמעט תמיד "מספר מודעה"/"מספר נכס",
  // וההתאמה הרכה הייתה מכניסה מזהה מודעה לתוך הכתובת.
  { key:'house_number', label:'מספר בית', aliases:['מספר בית','מס בית','house number','house_number'] },
  { key:'floor', label:'קומה', aliases:['קומה','floor'] },
  { key:'total_floors', label:'מספר קומות', aliases:['מספר קומות','קומות','סה"כ קומות','total_floors','floors'] },
  { key:'size_sqm', label:'גודל במ"ר', aliases:['גודל','שטח','מ"ר','גודל במ"ר','שטח במ"ר','size','size_sqm'] },
  { key:'built_size_sqm', label:'מ"ר בנוי', aliases:['מ"ר בנוי','שטח בנוי','בנוי','built_size_sqm'] },
  { key:'garden_sqm', label:'מ"ר גינה', aliases:['מ"ר גינה','שטח גינה','גינה','garden_sqm','garden'] },
  { key:'description', label:'תיאור המודעה', aliases:['תיאור','תיאור המודעה','פירוט','הערות','description','notes'] },
  { key:'condition', label:'מצב הנכס', hint:'מגורים בלבד', aliases:['מצב','מצב הנכס','condition'] },
  { key:'project_status', label:'סטטוס הפרויקט', aliases:['סטטוס פרויקט','סטטוס הפרויקט','project_status'] },
  { key:'move_in_date', label:'תאריך כניסה', aliases:['תאריך כניסה','כניסה','תאריך פינוי','move_in_date'] },
  { key:'move_in_soon', label:'כניסה קרובה', hint:'כן / לא', aliases:['כניסה קרובה','כניסה מיידית','move_in_soon'] },
  { key:'listing_expires_at', label:'תוקף המודעה', aliases:['תוקף','תוקף המודעה','תפוגה','listing_expires_at','expires'] },
  { key:'features', label:'מאפיינים', hint:'מופרדים בפסיק', aliases:['מאפיינים','תוספות','מאפייני הנכס','features'] },
  // בלי הכינוי "ריהוט" לבדו: בקבצים רבים זו עמודת כן/לא שנקראת כמאפיין
  { key:'furniture_details', label:'פירוט ריהוט', aliases:['פירוט ריהוט','furniture_details'] },
  { key:'restrooms_location', label:'שירותים', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['שירותים','restrooms_location'] },
  { key:'storage_location', label:'מחסן', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['מחסן','storage_location'] },
  { key:'mamad_location', label:'ממ"ד', hint:'מסחרי בלבד · בבניין / בנכס', aliases:['ממ"ד','ממד','mamad_location'] },
  { key:'lat', label:'קו רוחב (lat)', aliases:['lat','קו רוחב','latitude'] },
  { key:'lng', label:'קו אורך (lng)', aliases:['lng','קו אורך','longitude'] },
  // ‏marketing_image לפני images בכוונה: המיפוי האוטומטי תופס כל כותרת פעם
  // אחת בלבד, והתאמה רכה של "תמונה" הייתה חוטפת את "תמונה שיווקית" לגלריה.
  { key:'marketing_image', label:'תמונה שיווקית', hint:'כתובת מלאה אחת', aliases:['תמונה שיווקית','marketing_image'] },
  // סדר הכינויים הוא סדר עדיפות: עמודת הגלריה חייבת להופיע לפני "תמונה
  // ראשית", אחרת בקובץ שיש בו את שתיהן הגלריה נשארת בלי מיפוי והתמונות אובדות.
  { key:'images', label:'קישורי תמונות', hint:'כתובות מלאות, מופרדות בפסיק', aliases:['כל התמונות (קישורים)','תמונות (כל הקישורים)','כל התמונות','קישורי תמונות','תמונות','תמונה ראשית','תמונה','images','image'] },
  { key:'tour_3d_url', label:'קישור לסיור וירטואלי', hint:'כתובת מלאה אחת', aliases:['קישור לסיור וירטואלי','סיור וירטואלי','סיור 3d','tour_3d_url','tour_url'] },
  { key:'video_url', label:'קישור לסרטון', hint:'כתובת מלאה אחת', aliases:['קישור לסרטון','סרטון','וידאו','video','video_url'] },
  { key:'marketing_description', label:'תיאור שיווקי', aliases:['תיאור שיווקי','marketing_description'] },
  { key:'post_text', label:'טקסט פוסט', aliases:['טקסט פוסט','פוסט','post','post_text'] },
  { key:'agent2_name', label:'סוכן 2', aliases:['סוכן 2','סוכן שני','agent2','agent2_name'] },
  { key:'agent2_phone', label:'טלפון 2', aliases:['טלפון 2','נייד 2','agent2_phone'] },
  { key:'owner_name', label:'בעלים - שם', hint:'פנימי · לא מוצג באתר', aliases:['בעלים','שם בעלים','owner','owner_name'] },
  { key:'owner_phone', label:'בעלים - טלפון', hint:'פנימי · לא מוצג באתר', aliases:['טלפון בעלים','נייד בעלים','owner_phone'] },
];

/* נרמול לצורך השוואה: גרשיים בכל הווריאציות, סימני כיווניות, מפרידים
   וכוכביות (בתבנית שדה חובה מסומן ב-*) — כדי ש-"מ״ר", "מ\"ר" ו-"מר"
   ייחשבו לאותו דבר. */
function impNorm(v){
  return String(v == null ? '' : v)
    .replace(/["'`״׳“”‘’*]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[_\-\/\\.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

function impText(v){
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleDateString('he-IL');
  return String(v).replace(/[\u200e\u200f]/g, '').trim();
}

/* מספרים מגיעים מהגיליון גם כ-"₪ 1,250,000" או "‎3.5 חד'". */
function impNumber(v){
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = impText(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

const IMP_TRUE_WORDS = ['כן','true','yes','1','v','✓','y','נכון','כן!'];
const IMP_FALSE_WORDS = ['לא','false','no','0','n','שגוי'];
function impBool(v){
  if (typeof v === 'boolean') return v;
  const s = impNorm(v);
  if (!s) return null;
  if (IMP_TRUE_WORDS.includes(s)) return true;
  if (IMP_FALSE_WORDS.includes(s)) return false;
  return undefined;   // לא ניתן לפענוח — מבדיל מ-null ("ריק")
}

function impPad(n){ return String(n).padStart(2, '0'); }
/* מחזירה 'yyyy-mm-dd', או null אם ריק, או undefined אם לא ניתן לפענוח. */
function impDate(v){
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)){
    // ‏getters מקומיים ולא toISOString — SheetJS בונה את התאריך בשעון המקומי,
    // ו-toISOString היה מזיז יום אחורה בישראל.
    return `${v.getFullYear()}-${impPad(v.getMonth() + 1)}-${impPad(v.getDate())}`;
  }
  const s = impText(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);          // dd/mm/yyyy
  if (m){
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${year}-${impPad(m[2])}-${impPad(m[1])}`;
  }
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);                  // yyyy-mm-dd
  if (m) return `${m[1]}-${impPad(m[2])}-${impPad(m[3])}`;
  return undefined;
}

const IMP_CATEGORY = {
  'מגורים':'residential','residential':'residential','פרטי':'residential','private':'residential',
  'מסחרי':'commercial','מסחר':'commercial','עסקי':'commercial','commercial':'commercial',
};
const IMP_DEAL = {
  'מכירה':'sale','למכירה':'sale','מכר':'sale','sale':'sale','sell':'sale',
  'השכרה':'rent','להשכרה':'rent','שכירות':'rent','rent':'rent','rental':'rent',
};
const IMP_CONDITION = {
  'חדש מקבלן':'new_from_contractor','מקבלן':'new_from_contractor','new_from_contractor':'new_from_contractor',
  'חדש':'new','new':'new',
  'משופץ':'renovated','משופצת':'renovated','renovated':'renovated',
  'שמור':'maintained','במצב שמור':'maintained','maintained':'maintained',
  'דרוש שיפוץ':'needs_renovation','זקוק לשיפוץ':'needs_renovation','needs_renovation':'needs_renovation',
};
/* סדר המילים הנרדפות אינו משנה לייבוא (זו שליפה לפי מפתח), אבל כן לייצוא:
   ‏expReverse() לוקחת את המילה העברית הראשונה לכל קוד, ולכן הראשונה חייבת
   להיות זו שמופיעה בטופס — "תכנון ראשוני" ולא "תכנון". */
const IMP_PROJECT_STATUS = {
  'תכנון ראשוני':'planning','תכנון':'planning','planning':'planning',
  'הוגשה בקשה להיתר':'permit_requested','בקשה להיתר':'permit_requested','permit_requested':'permit_requested',
  'ניתן היתר בנייה':'permit_issued','יש היתר':'permit_issued','היתר':'permit_issued','permit_issued':'permit_issued',
  'הבנייה הסתיימה':'construction_complete','הסתיימה':'construction_complete','construction_complete':'construction_complete',
};
const IMP_LOCATION = { 'בבניין':'building','בניין':'building','building':'building','בנכס':'unit','בדירה':'unit','unit':'unit' };

/* סטטוס המודעה בקובץ. "נמכר"/"הושכר" נכנסים כמו שהם — הטריגר שמייצר
   "עסקאות אחרונות" רץ על UPDATE בלבד, ולכן ייבוא היסטורי לא מזייף עסקאות. */
const IMP_PROPERTY_STATUS = {
  'פעיל':'active','פעילה':'active','active':'active','מפורסם':'active',
  'נמכר':'sold','נמכרה':'sold','sold':'sold',
  'הושכר':'rented','הושכרה':'rented','rented':'rented',
  'ירד מפרסום':'unpublished','לא מפורסם':'unpublished','unpublished':'unpublished',
  'לא פעיל':'archived','לא פעילה':'archived','ארכיון':'archived','בארכיון':'archived','הוסר':'archived','archived':'archived',
};

/* שמות מקובלים שאינם מופיעים מילה במילה ברשימות הסגורות של הטופס. */
const IMP_PTYPE_SYNONYMS = {
  // צורות רבים: בכותרות של קבצי ייצוא נפוץ "דירות, רחוב X" ולא "דירה"
  'דירות':'דירה','דירות גן':'דירת גן','קוטגים':"בית פרטי/קוטג'",'וילות':"בית פרטי/קוטג'",
  'פנטהאוז':'גג/פנטהאוז','דירת גג':'גג/פנטהאוז','גג':'גג/פנטהאוז',
  'בית פרטי':"בית פרטי/קוטג'",'קוטג':"בית פרטי/קוטג'",'וילה':"בית פרטי/קוטג'",
  'לופט':'סטודיו/לופט','סטודיו':'סטודיו/לופט',
  'פרטר':'מרתף/פרטר','מרתף':'מרתף/פרטר',
  'יחידה':'יחידת דיור','יחידת דיור':'יחידת דיור',
  'חנייה':'חניה','חניון':'חניה',
  'נחלה':'משק חקלאי/נחלה','משק חקלאי':'משק חקלאי/נחלה',
  'בניין':'בניין מגורים',
  'קבוצת רכישה':"קב' רכישה/זכות לנכס",
};
const IMP_PTYPE_SYNONYMS_COMMERCIAL = {
  'משרד':'משרדים','חנות':'חנויות/שטח מסחרי','שטח מסחרי':'חנויות/שטח מסחרי','מסחרי':'חנויות/שטח מסחרי',
  'מחסן':'מחסנים','מגרש':'מגרשים','אולם':'אולמות','קליניקה':'קליניקות',
  'תעשייה':'מבני תעשייה','מבנה תעשייה':'מבני תעשייה','מלון':'בית מלון','חלל עבודה':'חלל עבודה משותף',
};

function impMatchPropertyType(value, category){
  const v = impNorm(value);
  if (!v) return null;
  const options = category === 'commercial' ? COMMERCIAL_PTYPE_OPTIONS : RESIDENTIAL_PTYPE_OPTIONS;
  const exact = options.find(o => impNorm(o) === v);
  if (exact) return exact;
  const synonyms = category === 'commercial' ? IMP_PTYPE_SYNONYMS_COMMERCIAL : IMP_PTYPE_SYNONYMS;
  for (const key of Object.keys(synonyms)){
    if (impNorm(key) === v) return synonyms[key];
  }
  // התאמה חלקית מתקבלת רק אם היא חד-משמעית ("דירת גן" מול "דירה" תיפסל)
  const partial = options.filter(o => { const n = impNorm(o); return n.includes(v) || v.includes(n); });
  return partial.length === 1 ? partial[0] : null;
}

/* ניחוש סוג הנכס מתוך הכותרת, כשאין עמודה לסוג או שהערך שבה לא זוהה —
   בקבצי ייצוא רבים הסוג יושב רק בכותרת ("משרד, יהושע חנקין 2 — 160 מ״ר").

   ההתאמה היא על רצף מילים שלם ולא על תת-מחרוזת, כדי ש"דירות" לא ייקרא
   כ"דירה"; ומכיוון שכותרת יכולה להזכיר כמה סוגים ("משרד/חנות", "דירה עם
   מרתף"), מנצח המוקדם ביותר בכותרת — הסוג הראשי נכתב ראשון — ובאותו
   מיקום, השם הארוך ביותר ("בית פרטי" לפני "בית").

   הניחוש לעולם אינו שקט: הוא מוסיף אזהרה, צובע את השורה בצהוב ומשאיר את
   פקד התיקון פתוח עם הערך המוצע.                                          */
/* פיצול למילים על כל תו שאינו אות או ספרה — לא רק על רווח. כותרת אמיתית
   נראית "משרד, יהושע חנקין 2 — 160 מ״ר", ופסיק דבוק היה מונע כל התאמה.
   ‏impNorm עצמה נשארת כמות שהיא: היא משמשת גם להשוואות מדויקות. */
function impWords(text){
  return impNorm(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function impWordSpanIndex(words, target){
  for (let i = 0; i + target.length <= words.length; i++){
    if (target.every((w, k) => words[i + k] === w)) return i;
  }
  return -1;
}

function impGuessPropertyType(text, category){
  const words = impWords(text);
  if (!words.length) return null;
  const options = category === 'commercial' ? COMMERCIAL_PTYPE_OPTIONS : RESIDENTIAL_PTYPE_OPTIONS;
  const synonyms = category === 'commercial' ? IMP_PTYPE_SYNONYMS_COMMERCIAL : IMP_PTYPE_SYNONYMS;

  // כל אגף של אופציה מורכבת הוא מועמד בפני עצמו: "גג/פנטהאוז" נמצא גם
  // כשבכותרת כתוב רק "פנטהאוז".
  const candidates = [];
  options.forEach(o => String(o).split('/').forEach(part => candidates.push([part, o])));
  Object.entries(synonyms).forEach(([key, value]) => candidates.push([key, value]));

  let best = null;
  candidates.forEach(([name, value])=>{
    const target = impWords(name);
    if (!target.length) return;
    // שמות בני שתי אותיות ("גג") שכיחים מדי בטקסט חופשי מכדי לנחש לפיהם
    const length = target.join(' ').length;
    if (length < 3) return;
    const at = impWordSpanIndex(words, target);
    if (at < 0) return;
    if (!best || at < best.at || (at === best.at && length > best.length)) best = { at, length, value };
  });
  return best ? best.value : null;
}

/* מפת מאפיינים: גם התווית בעברית וגם הקוד עצמו מובילים לאותו ערך. */
let impFeatureMapCache = null;
/* כתיבים נפוצים שאינם התווית המדויקת שבטופס ("חנייה" מול "חניה",
   "ריהוט" מול "מרוהטת") — גם בעמודת "תוספות" וגם ככותרת עמודה. */
const IMP_FEATURE_SYNONYMS = {
  'חנייה':'parking','חניית נכים':'parking','מיזוג אוויר':'ac','מזגנים':'ac',
  'ריהוט':'furnished','מרוהט':'furnished','סורג':'bars','נגישות':'accessible',
  'נגיש לנכים':'accessible','משופץ':'renovated_feature','שופץ':'renovated_feature',
  'בלעדיות':'exclusive','ממד':'mamad','ממק':'mamak','מקלט':'building_shelter',
  'מרפסת שמש':'sun_balcony','מרפסות שמש':'sun_balcony','מעליות':'elevator',
};

function impFeatureMap(){
  if (impFeatureMapCache) return impFeatureMapCache;
  const map = Object.create(null);
  [...LISTING_FEATURES, ...RESIDENTIAL_PROPERTY_FEATURES, ...COMMERCIAL_PROPERTY_FEATURES]
    .forEach(([code, label])=>{ map[impNorm(label)] = code; map[impNorm(code)] = code; });
  Object.entries(IMP_FEATURE_SYNONYMS).forEach(([label, code])=>{ map[impNorm(label)] = code; });
  impFeatureMapCache = map;
  return map;
}

/* ---------- מצב האשף ---------- */
const importModal = document.getElementById('importModal');
const impBodyEl = document.getElementById('impBody');
const impFootEl = document.getElementById('impFoot');
let importState = null;

function impInitState(){
  importState = {
    step: 1, fileName: '', headers: [], rows: [],
    mapping: Object.create(null),   // fieldKey -> אינדקס עמודה, או -1
    // תיקונים ידניים שנעשו בשלב הבדיקה: rowNumber -> { fieldKey: ערך }.
    // הם גוברים על התא שבקובץ, ולכן שורה מתוקנת נבנית מחדש כאילו הערך
    // הגיע מהקובץ מלכתחילה — בלי מסלול ולידציה נפרד.
    overrides: Object.create(null),
    existingKeys: null,             // כותרת|מחיר של נכסים קיימים, לבדיקת כפילות
    forceStep3: false,              // אישור מעבר לבדיקה בלי מיפוי שדה חובה
    parsed: [], failed: [], busy: false,
  };
}

function impOpen(){
  if (!currentAgent) return;
  impInitState();
  importModal.style.display = 'flex';
  impSetStep(1);
}
function impClose(){
  if (importState && importState.busy) return;   // לא סוגרים באמצע insert
  importModal.style.display = 'none';
  impBodyEl.innerHTML = '';
  impFootEl.innerHTML = '';
}

function impSetStep(step){
  importState.step = step;
  document.querySelectorAll('#impSteps span').forEach(el=>{
    const n = Number(el.dataset.step);
    el.classList.toggle('done', n < step);
    el.classList.toggle('active', n === step);
  });
  ({ 1: impRenderStep1, 2: impRenderStep2, 3: impRenderStep3, 4: impRenderStep4 })[step]();
  impBodyEl.scrollTop = 0;
}

/* שם מקומי היסטורי (‏imp = ייבוא) ל-escapeHtml שב-assets/esc.js.
   ההגדרה הקודמת לא ברחה מגרש בודד. */
function impEscape(s){ return escapeHtml(s); }

/* ---------- שלב 1: בחירת קובץ ---------- */
function impRenderStep1(){
  impBodyEl.innerHTML = `
    <div class="imp-drop" id="impDrop">
      <div style="font-weight:700;margin-bottom:8px">גררו לכאן קובץ, או בחרו מהמחשב</div>
      <label class="btn btn-ghost" for="impFile" style="cursor:pointer">בחירת קובץ</label>
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv,text/csv" style="display:none">
      <div class="imp-note">Excel ‏(xlsx/xls) או CSV · עד ${IMPORT_MAX_ROWS} שורות · עד 5MB</div>
    </div>
    <p class="imp-note">אין לכם קובץ מוכן? <a href="#" id="impTemplate">הורידו את קובץ התבנית</a> - הכותרות בו כבר מזוהות אוטומטית, וגיליון נוסף מפרט את הערכים החוקיים לכל שדה.</p>
    <p class="imp-note">כל הנכסים ייקלטו כפעילים ויסומנו על שמך. ייבוא של מנהל/ת משרד עבור סוכנים אחרים יתווסף בשלב הבא.</p>
    <div class="imp-note" id="impStatus" style="min-height:1.4em"></div>`;
  impFootEl.innerHTML = '<button type="button" class="btn btn-ghost" id="impCancel">סגירה</button>';
  document.getElementById('impCancel').addEventListener('click', impClose);
  document.getElementById('impTemplate').addEventListener('click', (e)=>{ e.preventDefault(); impDownloadTemplate(); });
  document.getElementById('impFile').addEventListener('change', (e)=>{
    if (e.target.files && e.target.files[0]) impReadFile(e.target.files[0]);
  });
  const drop = document.getElementById('impDrop');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, (e)=>{ e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, (e)=>{ e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e)=>{
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) impReadFile(file);
  });
}

async function impReadFile(file){
  const status = document.getElementById('impStatus');
  const fail = (msg)=>{ status.style.color = 'var(--brick)'; status.textContent = msg; };
  status.style.color = 'var(--ink-soft)';
  status.textContent = 'קורא את הקובץ…';

  if (file.size > IMPORT_MAX_BYTES){ fail('הקובץ גדול מ-5MB. פצלו אותו לקבצים קטנים יותר.'); return; }

  let XLSX;
  try { XLSX = await loadImportLib(); }
  catch(err){ fail(err.message); return; }

  try{
    const buffer = await file.arrayBuffer();
    let workbook;
    if (/\.csv$/i.test(file.name)){
      // ‏CSV שנשמר מאקסל בעברית יוצא ב-Windows-1255 ולא ב-UTF-8. מפענחים
      // בעצמנו עם TextDecoder של הדפדפן במקום לתת לספרייה לנחש קידוד.
      let text;
      try { text = new TextDecoder('utf-8', { fatal:true }).decode(buffer); }
      catch(e){ text = new TextDecoder('windows-1255').decode(buffer); }
      workbook = XLSX.read(text.replace(/^\uFEFF/, ''), { type:'string', raw:false });
    } else {
      workbook = XLSX.read(buffer, { type:'array', cellDates:true });
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName){ fail('לא נמצא גיליון בקובץ'); return; }
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header:1, blankrows:false, defval:'' });
    // ‏header:1 ולא אובייקטים לפי כותרת — קובץ עם שתי עמודות באותו שם היה
    // מאבד אחת מהן, וכאן העמודה מזוהה לפי מיקום.
    if (!matrix.length){ fail('הגיליון ריק'); return; }

    const headers = (matrix[0] || []).map((h, i) => impText(h) || `עמודה ${i + 1}`);
    const rows = matrix.slice(1).filter(r => r.some(cell => impText(cell) !== ''));
    if (!rows.length){ fail('לא נמצאו שורות נתונים מתחת לשורת הכותרות'); return; }
    if (rows.length > IMPORT_MAX_ROWS){
      fail(`הקובץ מכיל ${plural(rows.length, 'שורה אחת', 'שורות')} - המקסימום הוא ${IMPORT_MAX_ROWS}. פצלו אותו לכמה קבצים.`);
      return;
    }

    importState.fileName = file.name;
    importState.headers = headers;
    importState.rows = rows;
    importState.mapping = impAutoMap(headers);
    impSetStep(2);
  } catch(err){
    console.error(err);
    fail('לא ניתן לקרוא את הקובץ. אם הוא נוצר בתוכנה אחרת, נסו לשמור אותו מחדש כ-xlsx או csv.');
  }
}

/* ---------- שלב 2: התאמת עמודות ---------- */
function impAutoMap(headers){
  const normalized = headers.map(impNorm);
  const mapping = Object.create(null);
  const taken = new Set();
  // כל השמות המוכרים של כל השדות. כותרת שהיא שם מדויק של שדה אחר לא תיתפס
  // בהתאמה הרכה: "סוג עסקה" נחטפה קודם לשדה "סוג נכס" דרך הכינוי "סוג",
  // ואז נפלו כל השורות גם על סוג הנכס וגם על סוג העסקה שנשאר בלי עמודה.
  const allNames = new Set();
  IMPORT_FIELDS.forEach(f=>{
    [f.label, f.key, ...(f.aliases || [])].forEach(n=>{ const v = impNorm(n); if (v) allNames.add(v); });
  });
  IMPORT_FIELDS.forEach(field=>{
    const wanted = [field.label, field.key, ...(field.aliases || [])].map(impNorm);
    const wantedSet = new Set(wanted.filter(Boolean));
    // התאמה מדויקת לפי סדר הכינויים ולא לפי סדר העמודות בקובץ: כשיש גם
    // "ריהוט" וגם "פירוט ריהוט", הכינוי הספציפי (הראשון ברשימה) מנצח.
    let idx = -1;
    for (const w of wanted){
      if (!w) continue;
      const found = normalized.findIndex((h, i) => !taken.has(i) && h === w);
      if (found > -1){ idx = found; break; }
    }
    if (idx === -1){
      // התאמה רכה: כותרת שמכילה את שם השדה ("מחיר מבוקש בש\"ח")
      idx = normalized.findIndex((h, i) => !taken.has(i) && h
        && !(allNames.has(h) && !wantedSet.has(h))
        && wanted.some(w => w.length > 2 && h.includes(w)));
    }
    mapping[field.key] = idx;
    if (idx > -1) taken.add(idx);
  });
  return mapping;
}

/* עמודות מאפיין בוליאניות: הרבה מערכות מייצאות עמודה נפרדת לכל מאפיין
   ("מזגן", "מעלית", "מרפסת שמש") עם כן/לא, במקום עמודת "תוספות" אחת.
   כל כותרת שנשארה בלי שדה ומזוהה כשם מאפיין נקראת ככה — כדי שלא צריך יהיה
   למפות עשרים עמודות ביד. חישוב מחדש בכל כניסה לשלב 3, כי המיפוי הידני
   בשלב 2 יכול לתפוס או לשחרר כותרות.                                       */
function impDetectFeatureColumns(headers, mapping){
  const taken = new Set(Object.values(mapping).filter(i => i > -1));
  const featureMap = impFeatureMap();
  const columns = [];
  headers.forEach((header, index)=>{
    if (taken.has(index)) return;
    const code = featureMap[impNorm(header)];
    if (code) columns.push({ index, code, label: header });
  });
  return columns;
}

function impRenderStep2(){
  const options = importState.headers
    .map((h, i) => `<option value="${i}">${impEscape(h)}</option>`).join('');
  const rows = IMPORT_FIELDS.map(field=>{
    const selected = importState.mapping[field.key];
    return `<tr>
      <td>${impEscape(field.label)}${field.required ? ' <span class="imp-req">*</span>' : ''}
        ${field.hint ? `<div class="imp-note" style="margin:0;font-weight:400">${impEscape(field.hint)}</div>` : ''}</td>
      <td><select data-field="${field.key}">
        <option value="-1">— לא לייבא —</option>${options}
      </select></td>
    </tr>`;
  }).join('');

  const featureColumns = impDetectFeatureColumns(importState.headers, importState.mapping);
  impBodyEl.innerHTML = `
    <p>נקראו <strong>${importState.rows.length}</strong> שורות מתוך <strong>${impEscape(importState.fileName)}</strong>.
       זיהינו את העמודות אוטומטית - עברו ותקנו במידת הצורך. שדות עם <span class="imp-req">*</span> הם חובה.</p>
    ${featureColumns.length ? `<div class="imp-note">עמודות מאפיין (כן/לא) שייקלטו אוטומטית כמאפייני נכס:
       <strong>${featureColumns.map(c => impEscape(c.label)).join(' · ')}</strong></div>` : ''}
    <div class="imp-note" id="impMapWarn" style="min-height:1.2em"></div>
    <table class="imp-map">${rows}</table>`;
  impFootEl.innerHTML = `
    <button type="button" class="btn btn-ghost" id="impBack">חזרה</button>
    <button type="button" class="btn btn-gold" id="impNext">בדיקת הנתונים</button>`;

  const nextBtn = document.getElementById('impNext');
  const warnEl = document.getElementById('impMapWarn');
  impBodyEl.querySelectorAll('select[data-field]').forEach(sel=>{
    sel.value = String(importState.mapping[sel.dataset.field] ?? -1);
    sel.addEventListener('change', ()=>{
      importState.mapping[sel.dataset.field] = Number(sel.value);
      // כל שינוי במיפוי מבטל אישור קודם על שדה חובה חסר, אחרת לחיצה אחת
      // על "המשך בכל זאת" הייתה מדלגת על האזהרה גם אחרי שהמיפוי השתנה.
      importState.forceStep3 = false;
      // התיקונים הידניים נעשו מול המיפוי הקודם — עמודה חדשה לשדה שתוקן
      // הייתה נשארת מוסתרת מאחורי התיקון הישן.
      importState.overrides = Object.create(null);
      warnEl.textContent = '';
      nextBtn.textContent = 'בדיקת הנתונים';
    });
  });
  document.getElementById('impBack').addEventListener('click', ()=> impSetStep(1));
  nextBtn.addEventListener('click', ()=>{
    // שדה חובה בלי עמודה בקובץ אינו חוסם יותר: יש קבצים שבהם הערך פשוט לא
    // קיים כעמודה (סוג הנכס בתוך הכותרת, למשל). ממשיכים לשלב הבדיקה, שם
    // כל שורה מקבלת פקד תיקון ידני לשדה החסר — כולל החלה על כל השורות.
    const missing = IMPORT_FIELDS.filter(f => f.required && (importState.mapping[f.key] ?? -1) < 0);
    if (missing.length && !importState.forceStep3){
      importState.forceStep3 = true;
      warnEl.style.color = 'var(--brick)';
      warnEl.innerHTML = `<strong>אין עמודה לשדות חובה: ${impEscape(missing.map(f => f.label).join(', '))}.</strong>
        אפשר להמשיך ולמלא אותם ידנית בשלב הבדיקה (גם לכל השורות בבת אחת) - או לחזור ולמפות עמודה.`;
      nextBtn.textContent = 'המשך ומילוי ידני';
      showToast('חסרה התאמה לשדות חובה: ' + missing.map(f => f.label).join(', '));
      return;
    }
    impSetStep(3);
  });
}

/* ---------- שלב 3: נרמול, ולידציה ותצוגה מקדימה ---------- */
function impBuildRow(rawRow, rowNumber){
  const errors = [], warnings = [];
  // ‏errorFields: השדות שהפילו את השורה, לפי מפתח. שלב הבדיקה מציג לפיהם
  // פקד תיקון ידני, ולכן כל errors.push על שדה שניתן לתקן עובר דרך fail().
  const errorFields = [];
  // שדות שהושלמו בניחוש (ולא מהקובץ ולא מתיקון ידני) — שלב הבדיקה מציג
  // אותם בפקד התיקון עם הערך המוצע, כדי שאפשר יהיה לאשר או להחליף.
  const guessed = Object.create(null);
  const fail = (key, message)=>{
    errors.push(message);
    if (!errorFields.includes(key)) errorFields.push(key);
  };
  const overrides = importState.overrides[rowNumber] || null;
  const cell = (key)=>{
    if (overrides && key in overrides) return overrides[key];
    const idx = importState.mapping[key] ?? -1;
    return idx < 0 ? '' : rawRow[idx];
  };
  const payload = {};
  // המאפיינים מתנקזים מכמה מקורות (עמודת "תוספות", עמודות כן/לא, ועמודות
  // מחסן/ממ״ד בנוסח בוליאני), ולכן נאספים לסט אחד ונכתבים ל-payload בסוף.
  const featureCodes = new Set();

  // הכותרת נבנית בסוף הפונקציה כשהעמודה ריקה — היא מסתמכת על סוג הנכס,
  // החדרים והכתובת, שכולם מנורמלים בהמשך.
  const title = impText(cell('title'));
  if (title) payload.title = title.slice(0, 200);

  let category = 'residential';
  const rawCategory = impNorm(cell('category'));
  if (rawCategory){
    if (IMP_CATEGORY[rawCategory]) category = IMP_CATEGORY[rawCategory];
    else warnings.push(`קטגוריה "${impText(cell('category'))}" לא זוהתה - נקלט כמגורים`);
  }
  payload.category = category;

  let ptype = impMatchPropertyType(cell('property_type'), category);
  if (!ptype && title){
    // ניחוש מהכותרת, קודם ברשימת הקטגוריה שבקובץ ואז בשנייה. סוג מהקטגוריה
    // השנייה גורר גם את הקטגוריה — כמו בבחירה ידנית — אחרת הוא היה נפסל שוב
    // מיד. הבדיקה חייבת לקרות כאן, לפני ש-category משמש להמשך השורה.
    let guess = impGuessPropertyType(title, category);
    let flipped = false;
    if (!guess){
      const other = category === 'commercial' ? 'residential' : 'commercial';
      const crossGuess = impGuessPropertyType(title, other);
      if (crossGuess){ guess = crossGuess; category = other; payload.category = other; flipped = true; }
    }
    if (guess){
      ptype = guess;
      guessed.property_type = guess;
      const had = impText(cell('property_type'));
      warnings.push(`${had ? `סוג נכס "${had}" לא זוהה` : 'אין ערך לסוג נכס'} - הושלם מהכותרת: "${guess}"`
        + (flipped ? ` (והקטגוריה שונתה ל${category === 'commercial' ? 'מסחרי' : 'מגורים'})` : '')
        + '. בדקו ותקנו במידת הצורך.');
    }
  }
  if (!ptype) fail('property_type', `סוג נכס "${impText(cell('property_type')) || '(ריק)'}" אינו ברשימת הסוגים ל${category === 'commercial' ? 'נכס מסחרי' : 'מגורים'}`);
  else payload.property_type = ptype;

  const deal = IMP_DEAL[impNorm(cell('deal_type'))];
  if (!deal) fail('deal_type', `סוג עסקה "${impText(cell('deal_type')) || '(ריק)'}" - יש לרשום מכירה או השכרה`);
  else payload.deal_type = deal;

  const price = impNumber(cell('price'));
  if (price === null) fail('price', 'חסר מחיר או שאינו מספר');
  else if (price <= 0) fail('price', 'המחיר חייב להיות גדול מאפס');
  else {
    payload.price = price;
    if (deal === 'sale' && price < 10000) warnings.push('מחיר נמוך במיוחד למכירה - ודאו שהמחיר בשקלים ולא באלפים');
  }

  const city = impText(cell('city'));
  if (!city) fail('city', 'חסרה עיר');
  else payload.city = city;

  const rooms = impNumber(cell('rooms'));
  if (rooms !== null){
    if (rooms <= 0) warnings.push('מספר חדרים לא תקין - לא נקלט');
    else payload.rooms = rooms;
  }

  // השכונות מנוהלות על ידי הפלטפורמה, ולכן שם שלא ברשימה לא נקלט אלא מתריע
  const rawNeighborhood = impNorm(cell('neighborhood'));
  if (rawNeighborhood){
    const match = allNeighborhoods.find(n => impNorm(n.name) === rawNeighborhood);
    if (match) payload.neighborhood_id = match.id;
    else warnings.push(`השכונה "${impText(cell('neighborhood'))}" אינה ברשימת השכונות - לא נקלטה`);
  }

  const salesArea = impText(cell('sales_area'));
  if (salesArea) payload.sales_area = salesArea.slice(0, 100);

  /* ייבוא מקובץ אינו חוסם על רחוב שאינו ברשימה, בשונה מהטופס: קובץ של 200
     שורות שנתקע על שורה אחת הוא קובץ שלא נקלט, וכתובת שתרד לגמרי היא נכס
     בלי פין במפה. לכן — תיקון כתיב בשקט כשיש התאמה, ואזהרה על השורה כשאין.
     האזהרה מגיעה למסך התיקון הידני, שם אפשר לתקן לפני הקליטה. */
  let street = impText(cell('street'));
  if (street){
    const match = canonicalStreet(street, city);
    street = match.name;
    if (!match.ok){
      warnings.push(`הרחוב "${street}" אינו ברשימת הרחובות של ${city} - נשמר כפי שהוקלד, `
        + 'וייתכן שהנכס לא יקבל מיקום על המפה');
    }
  }
  const houseNumber = impText(cell('house_number'));
  payload.street = street || null;
  payload.house_number = houseNumber || null;
  payload.address = (street || houseNumber) ? (street + (houseNumber ? ' ' + houseNumber : '')) : null;

  const rawFloor = impNorm(cell('floor'));
  if (rawFloor){
    if (rawFloor.includes('קרקע')) payload.floor = 0;
    else if (rawFloor.includes('מרתף')) payload.floor = -1;
    else {
      const floor = impNumber(cell('floor'));
      if (floor === null) warnings.push('קומה לא זוהתה - לא נקלטה');
      else payload.floor = Math.round(floor);
    }
  }

  const totalFloors = impNumber(cell('total_floors'));
  if (totalFloors !== null){
    if (totalFloors <= 0 || totalFloors > 200) warnings.push('מספר קומות לא תקין - לא נקלט');
    else payload.total_floors = Math.round(totalFloors);
  }

  [['size_sqm','גודל במ"ר'], ['built_size_sqm','מ"ר בנוי'], ['garden_sqm','מ"ר גינה']].forEach(([key, label])=>{
    const n = impNumber(cell(key));
    if (n !== null){
      if (n <= 0) warnings.push(`${label} לא תקין - לא נקלט`);
      else payload[key] = n;
    }
  });

  [['description', 5000], ['marketing_description', 5000], ['post_text', 5000],
   ['furniture_details', 300], ['agent2_name', 100], ['agent2_phone', 40]].forEach(([key, max])=>{
    const value = impText(cell(key));
    if (value) payload[key] = value.slice(0, max);
  });

  const expires = impDate(cell('listing_expires_at'));
  if (expires === undefined) warnings.push('תוקף המודעה לא זוהה - לא נקלט');
  else if (expires) payload.listing_expires_at = expires;

  // ‏condition שייך למגורים בלבד, וה-*_location למסחרי בלבד — בדיוק כמו
  // שהטופס הידני שולח null בצד השני.
  //
  // עמודות "מחסן"/"ממ״ד" מגיעות בשני נוסחים: מיקום (בבניין/בנכס) בקבצים
  // מסחריים, וכן/לא בקבצים של דירות. ערך בוליאני נקלט כמאפיין ולא כמיקום,
  // כדי שקובץ מגורים לא יאבד את המחסן והממ״ד ולא יקבל אזהרה מיותרת.
  const LOCATION_FEATURE_CODES = { storage_location:'storage', mamad_location:'mamad' };
  ['restrooms_location','storage_location','mamad_location'].forEach(key=>{
    const raw = impNorm(cell(key));
    if (!raw) return;
    const value = IMP_LOCATION[raw];
    if (value && category === 'commercial'){ payload[key] = value; return; }
    const bool = impBool(cell(key));
    if (bool === true && LOCATION_FEATURE_CODES[key]){ featureCodes.add(LOCATION_FEATURE_CODES[key]); return; }
    if (bool === false || (value && category !== 'commercial')) return;
    warnings.push(`הערך "${impText(cell(key))}" אינו בבניין/בנכס ואינו כן/לא - לא נקלט`);
  });

  if (category === 'commercial'){
    payload.condition = null;
  } else {
    const raw = impNorm(cell('condition'));
    if (raw){
      const value = IMP_CONDITION[raw];
      if (value) payload.condition = value;
      else warnings.push(`מצב הנכס "${impText(cell('condition'))}" לא זוהה - לא נקלט`);
    }
  }

  const rawStatus = impNorm(cell('project_status'));
  if (rawStatus){
    const value = IMP_PROJECT_STATUS[rawStatus];
    if (value) payload.project_status = value;
    else warnings.push(`סטטוס פרויקט "${impText(cell('project_status'))}" לא זוהה - לא נקלט`);
  }

  const moveIn = impDate(cell('move_in_date'));
  if (moveIn === undefined) warnings.push('תאריך כניסה לא זוהה - לא נקלט');
  else if (moveIn) payload.move_in_date = moveIn;

  const soon = impBool(cell('move_in_soon'));
  if (soon === undefined) warnings.push('"כניסה קרובה" לא זוהה - יש לרשום כן/לא');
  else if (soon !== null) payload.move_in_soon = soon;

  const rawFeatures = impText(cell('features'));
  if (rawFeatures){
    const map = impFeatureMap();
    const unknown = [];
    rawFeatures.split(/[,;|]/).forEach(part=>{
      const key = impNorm(part);
      if (!key) return;
      if (map[key]) featureCodes.add(map[key]);
      else unknown.push(part.trim());
    });
    if (unknown.length) warnings.push('מאפיינים שלא זוהו ולא נקלטו: ' + unknown.join(', '));
  }

  // עמודה נפרדת לכל מאפיין (כן/לא) — ראו impDetectFeatureColumns
  (importState.featureColumns || []).forEach(col=>{
    if (impBool(rawRow[col.index]) === true) featureCodes.add(col.code);
  });

  if (featureCodes.size) payload.features = [...featureCodes];

  const lat = impNumber(cell('lat')), lng = impNumber(cell('lng'));
  if (lat !== null && lng !== null){
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180){ payload.lat = lat; payload.lng = lng; }
    else warnings.push('קואורדינטות לא תקינות - לא נקלטו');
  } else if (lat !== null || lng !== null){
    warnings.push('נדרשים גם קו רוחב וגם קו אורך - לא נקלטו');
  }

  const rawImages = impText(cell('images'));
  if (rawImages){
    const urls = [], bad = [];
    rawImages.split(/[,;|\s]+/).forEach(part=>{
      const url = part.trim();
      if (!url) return;
      if (/^https?:\/\/\S+$/i.test(url)) urls.push(url);
      else bad.push(url);
    });
    if (urls.length > MAX_IMAGES) warnings.push(`${plural(urls.length, 'נמצאה תמונה אחת', 'תמונות נמצאו')} - ייקלטו ${MAX_IMAGES} הראשונות`);
    if (bad.length) warnings.push('קישורי תמונה לא תקינים (נדרשת כתובת מלאה עם http): ' + bad.slice(0, 3).join(', '));
    if (urls.length) payload.images = urls.slice(0, MAX_IMAGES);
  }

  const marketingImage = impText(cell('marketing_image'));
  if (marketingImage){
    if (/^https?:\/\/\S+$/i.test(marketingImage)) payload.marketing_image = marketingImage;
    else warnings.push('קישור התמונה השיווקית אינו כתובת מלאה - לא נקלט');
  }

  // קישורי מדיה: ‏check במסד דוחה כל דבר שאינו http(s), ולכן קישור פגום
  // נופל כאן עם אזהרה במקום להפיל את כל שורת הייבוא
  [['tour_3d_url','הקישור לסיור הווירטואלי'], ['video_url','הקישור לסרטון']].forEach(([key, label])=>{
    const url = impText(cell(key));
    if (!url) return;
    if (/^https?:\/\/\S+$/i.test(url)) payload[key] = url.slice(0, 1000);
    else warnings.push(`${label} אינו כתובת מלאה - לא נקלט`);
  });

  if (!payload.title){
    const parts = [
      payload.property_type || '',
      payload.rooms ? plural(payload.rooms, 'חדר אחד', 'חדרים') : '',
      payload.address || '',
      payload.city || '',
    ].filter(Boolean);
    if (parts.length){
      payload.title = parts.join(', ').slice(0, 200);
      warnings.push('אין עמודת כותרת - נוצרה כותרת אוטומטית: ' + payload.title);
    } else {
      fail('title', 'חסרה כותרת ואי אפשר לבנות אותה (אין סוג נכס, כתובת או עיר)');
    }
  }

  payload.agency_id = currentAgent.agency_id;
  payload.agent_id = currentAgent.id;

  const rawPropertyStatus = impNorm(cell('status'));
  if (!rawPropertyStatus) payload.status = 'active';
  else if (IMP_PROPERTY_STATUS[rawPropertyStatus]) payload.status = IMP_PROPERTY_STATUS[rawPropertyStatus];
  else {
    payload.status = 'active';
    warnings.push(`סטטוס "${impText(cell('status'))}" לא זוהה - הנכס נקלט כפעיל`);
  }

  // פרטי הבעלים לא יושבים ב-properties אלא ב-property_owners, ולכן הם נשמרים
  // בצד ה-row ולא ב-payload, ונכנסים בשלב נפרד אחרי שנוצר ה-property_id.
  const owner = {
    owner_name: impText(cell('owner_name')).slice(0, 100) || null,
    owner_phone: impText(cell('owner_phone')).slice(0, 40) || null,
  };

  return {
    rowNumber, raw: rawRow, payload, errors, warnings, errorFields, guessed,
    fixedFields: overrides ? Object.keys(overrides) : [],
    owner: (owner.owner_name || owner.owner_phone) ? owner : null,
  };
}

/* השדות שאפשר לתקן ידנית בשלב הבדיקה — בדיוק אלה שיכולים להפיל שורה
   (ראו fail() ב-impBuildRow). התיקון נכתב ל-importState.overrides, השורה
   נבנית מחדש דרך אותה ולידציה, ואם היא נקייה היא נכנסת לספירת "מוכנים
   לייבוא" — בלי לצאת מהאשף ובלי קובץ תיקונים נפרד.                        */
const IMPORT_FIX_FIELDS = {
  property_type: { label:'סוג נכס' },
  deal_type:     { label:'סוג עסקה' },
  price:         { label:'מחיר' },
  city:          { label:'עיר' },
  title:         { label:'כותרת' },
};

function impSetOverride(rowNumber, field, value){
  const bag = importState.overrides[rowNumber] || (importState.overrides[rowNumber] = Object.create(null));
  const text = String(value == null ? '' : value).trim();
  if (!text){
    delete bag[field];
    if (field === 'property_type') delete bag.category;
  } else {
    bag[field] = text;
    // בחירת סוג נכס מרשימת הקטגוריה השנייה גוררת גם את הקטגוריה, אחרת הסוג
    // שנבחר היה נופל שוב מול הרשימה של הקטגוריה שהגיעה מהקובץ.
    if (field === 'property_type'){
      if (RESIDENTIAL_PTYPE_OPTIONS.includes(text)) bag.category = 'מגורים';
      else if (COMMERCIAL_PTYPE_OPTIONS.includes(text)) bag.category = 'מסחרי';
    }
  }
  if (!Object.keys(bag).length) delete importState.overrides[rowNumber];
}

/* אזהרות הכפילות נמחקות עם כל בנייה מחדש של השורה, ולכן הן מסומנות תמיד
   על כל הקובץ ביחד ואחרי impRevalidate — ולא שורה-שורה. */
function impMarkDuplicates(){
  const seen = new Map();
  importState.parsed.forEach(row=>{
    if (row.errors.length) return;
    const key = `${impNorm(row.payload.title)}|${row.payload.price}|${impNorm(row.payload.address || '')}`;
    if (seen.has(key)) row.warnings.push(`שורה זהה לשורה ${seen.get(key)} בקובץ`);
    else seen.set(key, row.rowNumber);
  });
  const existingKeys = importState.existingKeys;
  if (!existingKeys || !existingKeys.size) return;
  importState.parsed.forEach(row=>{
    if (row.errors.length) return;
    if (existingKeys.has(`${impNorm(row.payload.title)}|${Number(row.payload.price)}`)){
      row.warnings.push('נכס עם אותה כותרת ומחיר כבר קיים אצלך (פעיל או בארכיון) - ייתכן שזו כפילות');
    }
  });
}

/* בנייה מחדש של *כל* השורות אחרי תיקון ידני. יקר פחות מלנהל עדכון נקודתי:
   תיקון בשורה אחת יכול לשנות גם אזהרות כפילות בשורות אחרות. */
function impRevalidate(){
  importState.parsed = importState.rows.map((row, i) => impBuildRow(row, i + 2)); // +2: שורה 1 היא הכותרות
  impMarkDuplicates();
}

function impFixRowHtml(row, colspan, pendingCount){
  const keys = [...row.errorFields, ...row.fixedFields, ...Object.keys(row.guessed)]
    .filter((k, i, arr) => IMPORT_FIX_FIELDS[k] && arr.indexOf(k) === i);
  if (!keys.length) return '';

  const controls = keys.map(key=>{
    const override = (importState.overrides[row.rowNumber] || {})[key];
    const done = override !== undefined && String(override) !== '';
    // ערך שנוחש מוצג בפקד אבל אינו נחשב תיקון: הוא נשאר מסומן כהצעה עד
    // שבוחרים בו (או בערך אחר) במפורש.
    const guess = done ? undefined : row.guessed[key];
    const value = done ? override : guess;
    const attrs = `data-fix-row="${row.rowNumber}" data-fix-field="${key}"`;
    const current = impNorm(value || '');
    let control;
    if (key === 'property_type'){
      const opts = (list)=> list.map(o =>
        `<option value="${impEscape(o)}"${impNorm(o) === current ? ' selected' : ''}>${impEscape(o)}</option>`).join('');
      control = `<select ${attrs}><option value="">- בחרו סוג -</option>
        <optgroup label="מגורים">${opts(RESIDENTIAL_PTYPE_OPTIONS)}</optgroup>
        <optgroup label="מסחרי">${opts(COMMERCIAL_PTYPE_OPTIONS)}</optgroup></select>`;
    } else if (key === 'deal_type'){
      control = `<select ${attrs}><option value="">- בחרו -</option>` +
        ['מכירה','השכרה'].map(o => `<option value="${o}"${impNorm(o) === current ? ' selected' : ''}>${o}</option>`).join('') +
        `</select>`;
    } else if (key === 'price'){
      // step="any": עם min="1" ו-step="1000" הדפדפן מחשיב כחוקיים רק 1, 1001, 2001…
      // כלומר כמעט כל מחיר אמיתי נצבע כשגוי וחיצי ההעלאה/הורדה קופצים לערכים מוזרים.
      control = `<input type="number" min="1" step="any" placeholder="מחיר בשקלים" value="${impEscape(value ?? '')}" ${attrs}>`;
    } else if (key === 'city'){
      control = `<input type="text" list="impCityList" placeholder="שם היישוב" value="${impEscape(value ?? '')}" ${attrs}>`;
    } else {
      control = `<input type="text" maxlength="200" placeholder="כותרת המודעה" value="${impEscape(value ?? '')}" ${attrs}>`;
    }
    // כמה שורות *אחרות* עדיין נכשלות על אותו שדה — כדי שקובץ שבו חסרה
    // עמודה שלמה ייפתר בלחיצה אחת ולא בחמישים בחירות זהות.
    const others = (pendingCount[key] || 0) - (row.errorFields.includes(key) ? 1 : 0);
    // הכפתור מוחל את מה שמופיע בפקד — גם ערך שנוחש, ולכן הוא פעיל גם כשעדיין
    // אין override, ובלבד שיש בפקד ערך כלשהו.
    const all = others > 0
      ? `<button type="button" class="imp-fixall" data-fixall-row="${row.rowNumber}" data-fixall-field="${key}"
           ${(done || guess) ? '' : 'disabled'}>↧ גם ב-${plural(others, 'שורה אחת', 'שורות')} שנכשלו</button>`
      : '';
    const state = done ? ' done' : (guess ? ' guess' : '');
    const mark = done ? ' ✓' : (guess ? ' · הושלם מהכותרת' : '');
    return `<div class="fix-field${state}">
        <span class="fix-label">${IMPORT_FIX_FIELDS[key].label}${mark}</span>${control}
      </div>${all}`;
  }).join('');

  return `<tr class="imp-fixrow"><td colspan="${colspan}"><div class="imp-fix">${controls}</div></td></tr>`;
}

/* שורת התיקון יושבת בתא שמשתרע על כל רוחב הטבלה, שרחבה מהמסך. הרוחב הגלוי
   נמדד כאן ונכתב כמשתנה CSS, כדי שהפקדים יישברו לשורות במקום לגלוש. */
function impSyncFixWidth(){
  const wrap = document.getElementById('impTableWrap');
  if (wrap) wrap.style.setProperty('--imp-fixw', Math.max(140, wrap.clientWidth - 20) + 'px');
}
window.addEventListener('resize', ()=>{
  if (importState && importState.step === 3) impSyncFixWidth();
});

/* ציור מחדש של הסיכום, הטבלה והכפתורים בלבד — הקליפה של שלב 3 (כולל
   ה-datalist של הערים) נשארת, כדי שתיקון לא יאפס את הגלילה בטבלה. */
function impPaintPreview(focus){
  const previewFields = importState.previewFields || [];
  const colspan = previewFields.length + 2;
  const valid = importState.parsed.filter(r => !r.errors.length);
  const invalid = importState.parsed.filter(r => r.errors.length);
  const warned = valid.filter(r => r.warnings.length);
  const fixed = valid.filter(r => r.fixedFields.length);
  const guessedRows = valid.filter(r => Object.keys(r.guessed).length && !r.fixedFields.includes('property_type'));

  const pendingCount = Object.create(null);
  invalid.forEach(r => r.errorFields.forEach(k => { pendingCount[k] = (pendingCount[k] || 0) + 1; }));

  const body = importState.parsed.map(row=>{
    const cls = row.errors.length ? 'bad' : (row.fixedFields.length ? 'fixed' : (row.warnings.length ? 'warn' : ''));
    const cells = previewFields.map(f=>{
      const idx = importState.mapping[f.key];
      return `<td>${impEscape(impText(row.raw[idx]).slice(0, 40))}</td>`;
    }).join('');
    const messages = [...row.errors, ...row.warnings];
    return `<tr class="${cls}">
      <td>${row.rowNumber}</td>${cells}
      <td class="imp-msg ${row.errors.length ? 'bad' : ''}">${impEscape(messages.join(' · ')) || '✓'}</td>
    </tr>${impFixRowHtml(row, colspan, pendingCount)}`;
  }).join('');

  document.getElementById('impSum').innerHTML = `
    <span class="imp-chip ok">${valid.length} מוכנים לייבוא</span>
    ${invalid.length ? `<span class="imp-chip bad">${invalid.length} עם שגיאה — תקנו כאן או שידולגו</span>` : ''}
    ${fixed.length ? `<span class="imp-chip fix">${fixed.length} תוקנו ידנית</span>` : ''}
    ${guessedRows.length ? `<span class="imp-chip guess">${guessedRows.length} סוג נכס הושלם מהכותרת - בדקו</span>` : ''}
    ${warned.length ? `<span class="imp-chip">${warned.length} עם אזהרה - ייובאו חלקית</span>` : ''}`;

  const wrap = document.getElementById('impTableWrap');
  const scroll = wrap ? wrap.scrollTop : 0;
  document.getElementById('impRows').innerHTML = body;
  impSyncFixWidth();

  impFootEl.innerHTML = `
    <button type="button" class="btn btn-ghost" id="impBack">חזרה למיפוי</button>
    ${invalid.length ? '<button type="button" class="btn btn-ghost" id="impErrors">הורדת השגיאות</button>' : ''}
    <button type="button" class="btn btn-gold" id="impRun" ${valid.length ? '' : 'disabled'}>ייבוא ${plural(valid.length, 'נכס אחד', 'נכסים')}</button>`;
  document.getElementById('impBack').addEventListener('click', ()=> impSetStep(2));
  const errBtn = document.getElementById('impErrors');
  if (errBtn) errBtn.addEventListener('click', ()=> impDownloadErrors(invalid.map(r => ({ raw:r.raw, message:r.errors.join(' · ') }))));
  document.getElementById('impRun').addEventListener('click', ()=> impSetStep(4));

  if (focus){
    const el = impBodyEl.querySelector(`[data-fix-row="${focus.row}"][data-fix-field="${focus.field}"]`);
    if (el) el.focus();
  }
  if (wrap) wrap.scrollTop = scroll;
}

async function impRenderStep3(){
  impBodyEl.innerHTML = '<div class="empty-state">בודק את הנתונים…</div>';
  impFootEl.innerHTML = '';

  // ‏impBuildRow ממפה שם שכונה מהקובץ ל-neighborhood_id מול הרשימה הזו,
  // ומאותה רשימה נבנית גם השלמת הערים בתיקון הידני.
  await ensureNeighborhoodsLoaded();
  // ‏impBuildRow מיישר שם רחוב מול הרשימה הזו, ומתריע כשאין התאמה
  await ensureStreetsLoaded();
  importState.featureColumns = impDetectFeatureColumns(importState.headers, importState.mapping);
  importState.previewFields = IMPORT_FIELDS.filter(f => (importState.mapping[f.key] ?? -1) > -1).slice(0, 7);

  // כפילויות מול נכסים שכבר קיימים אצל הסוכן/ת — נשלף פעם אחת ונשמר,
  // כי כל תיקון ידני מריץ את בדיקת הכפילות מחדש.
  if (!importState.existingKeys){
    importState.existingKeys = new Set();
    try{
      // כל הסטטוסים ולא רק פעיל: נכס שנמכר וחוזר לשוק הוא בדיוק המקרה שבו
      // הייבוא מייצר מודעה שנייה לאותה דירה
      const { data: existing } = await sb.from('properties')
        .select('title, price').eq('agent_id', currentAgent.id);
      (existing || []).forEach(p => importState.existingKeys.add(`${impNorm(p.title)}|${Number(p.price)}`));
    } catch(err){ console.warn('duplicate check failed', err); }
  }

  impRevalidate();

  const cities = [...new Set(allNeighborhoods.map(n => n.city).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));

  impBodyEl.innerHTML = `
    <div class="imp-sum" id="impSum"></div>
    <div class="imp-tablewrap" id="impTableWrap">
      <table class="imp-prev">
        <thead><tr><th>שורה</th>${importState.previewFields.map(f => `<th>${impEscape(f.label)}</th>`).join('')}<th>הערות</th></tr></thead>
        <tbody id="impRows"></tbody>
      </table>
    </div>
    <datalist id="impCityList">${cities.map(c => `<option value="${impEscape(c)}"></option>`).join('')}</datalist>
    <p class="imp-note">שורה אדומה לא תיובא — מלאו את השדה החסר בשורה שמתחתיה והיא תהפוך לירוקה ותיכנס לספירת המוכנים לייבוא.
       שורה צהובה תיובא, אך השדה שצוין בהערה יישאר ריק.
       סוג נכס שהושלם מהכותרת מסומן בפקד כהצעה — אשרו אותו או החליפו אותו לפני הייבוא.</p>`;

  impPaintPreview();
}

/* מאזינים מוצמדים לגוף האשף פעם אחת, ולא לכל פקד בכל ציור מחדש. */
impBodyEl.addEventListener('change', (e)=>{
  const el = e.target.closest && e.target.closest('[data-fix-field]');
  if (!el || !importState || importState.step !== 3) return;
  impSetOverride(Number(el.dataset.fixRow), el.dataset.fixField, el.value);
  impRevalidate();
  impPaintPreview({ row: el.dataset.fixRow, field: el.dataset.fixField });
});

impBodyEl.addEventListener('click', (e)=>{
  const btn = e.target.closest && e.target.closest('[data-fixall-field]');
  if (!btn || !importState || importState.step !== 3) return;
  const field = btn.dataset.fixallField;
  // הערך נלקח מהפקד עצמו ולא מ-overrides, כדי שגם ערך שנוחש מהכותרת
  // ניתן להחלה על שאר השורות שנכשלו.
  const control = impBodyEl.querySelector(`[data-fix-row="${btn.dataset.fixallRow}"][data-fix-field="${field}"]`);
  const source = control ? control.value.trim() : '';
  if (!source) return;
  const targets = importState.parsed.filter(r => r.errors.length && r.errorFields.includes(field));
  targets.forEach(r => impSetOverride(r.rowNumber, field, source));
  impRevalidate();
  impPaintPreview({ row: btn.dataset.fixallRow, field });
  showToast(`הערך "${source}" הוחל על ${plural(targets.length, 'שורה אחת', 'שורות')}`);
});

/* ---------- שלב 4: ההכנסה עצמה ---------- */
async function impRenderStep4(){
  const queue = importState.parsed.filter(r => !r.errors.length);
  importState.busy = true;
  importState.failed = [];
  // ‏noImage נספר כאן ולא נשלף אחר כך מהמסד: נכס בלי תמונה לא יפורסם בדף
  // הפייסבוק (ראו docs/facebook-auto-publish.md), וזו העובדה היחידה בסיכום
  // שהמייבא/ת לא יכול/ה להסיק ממנה בעצמו/ה. בייבוא של 9.9.2026 נקלטו כך
  // ‏11 נכסים, ואיש לא ידע עד שנבדק המסד.
  let done = 0, ok = 0, noImage = 0;
  const rowHasImage = row =>
    Boolean(row.payload?.images?.length) || Boolean(row.payload?.marketing_image);

  impBodyEl.innerHTML = `
    <div style="font-weight:700">מייבא ${plural(queue.length, 'נכס אחד', 'נכסים')}…</div>
    <div class="imp-bar"><i id="impProgress"></i></div>
    <div class="imp-note" id="impProgressText">0 מתוך ${queue.length}</div>
    <p class="imp-note">אל תסגרו את החלון עד לסיום.</p>`;
  impFootEl.innerHTML = '<button type="button" class="btn btn-ghost" disabled>מייבא…</button>';

  const bar = document.getElementById('impProgress');
  const text = document.getElementById('impProgressText');
  const tick = ()=>{
    bar.style.width = queue.length ? Math.round(done / queue.length * 100) + '%' : '100%';
    text.textContent = `${done} מתוך ${queue.length}`;
  };

  // פרטי הבעלים נכנסים ל-property_owners אחרי שהנכסים נוצרו. ‏select('id')
  // על insert מרובה-שורות מחזיר את השורות בסדר ההכנסה (‏INSERT … RETURNING),
  // ולכן אפשר לזווג לפי אינדקס. כישלון כאן לא פוסל את הנכס עצמו — הוא כבר
  // נשמר — אלא נרשם כאזהרה בקובץ השגיאות.
  const saveOwners = async (rows, ids)=>{
    const owners = rows
      .map((row, idx) => (row.owner && ids[idx]) ? { property_id: ids[idx], ...row.owner } : null)
      .filter(Boolean);
    if (!owners.length) return;
    const { error } = await sb.from('property_owners').insert(owners);
    if (error){
      console.error(error);
      rows.forEach(row=>{
        if (row.owner) importState.failed.push({ raw: row.raw, message: 'הנכס נקלט אך פרטי הבעלים לא נשמרו: ' + error.message });
      });
    }
  };

  for (let i = 0; i < queue.length; i += IMPORT_CHUNK){
    const chunk = queue.slice(i, i + IMPORT_CHUNK);
    const { data: insertedRows, error } = await sb.from('properties')
      .insert(chunk.map(r => r.payload)).select('id');
    if (error){
      // ‏insert קבוצתי נכשל כולו בגלל שורה אחת פגומה, ולכן חוזרים על המנה
      // שורה-שורה כדי לבודד את הנופלות ולהציל את השאר.
      for (const row of chunk){
        const { data: insertedRow, error: rowError } = await sb.from('properties')
          .insert(row.payload).select('id').single();
        // ‏propertyStatusErrorText ולא message גולמי: שורה שנדחתה בגלל נכס
        // שכבר מפורסם במערכת מקבלת את ההסבר בעברית בקובץ השגיאות
        if (rowError) importState.failed.push({ raw: row.raw, message: propertyStatusErrorText(rowError) });
        else { ok++; if (!rowHasImage(row)) noImage++; await saveOwners([row], [insertedRow?.id]); }
        done++; tick();
      }
    } else {
      await saveOwners(chunk, (insertedRows || []).map(r => r.id));
      noImage += chunk.filter(r => !rowHasImage(r)).length;
      ok += chunk.length; done += chunk.length; tick();
    }
  }

  importState.busy = false;
  const invalid = importState.parsed.filter(r => r.errors.length);
  const failedTotal = importState.failed.length + invalid.length;

  impBodyEl.innerHTML = `
    <div class="imp-sum">
      <span class="imp-chip ok">${plural(ok, 'נכס אחד נקלט', 'נכסים נקלטו')}</span>
      ${noImage ? `<span class="imp-chip guess">${noImage} בלי תמונות</span>` : ''}
      ${failedTotal ? `<span class="imp-chip bad">${failedTotal} לא נקלטו</span>` : ''}
    </div>
    <p>${ok ? 'הנכסים מפורסמים באתר ומופיעים ברשימת "הנכסים שלי".' : 'לא נקלט אף נכס.'}</p>
    ${importState.failed.length ? `<p class="imp-note">${plural(importState.failed.length, 'שורה אחת נדחתה', 'שורות נדחו')} על ידי המערכת בעת השמירה. הורידו את קובץ השגיאות כדי לראות את הסיבה לכל שורה.</p>` : ''}
    ${noImage ? `<p class="imp-note"><b>${plural(noImage, 'נכס אחד נוצר', 'נכסים נוצרו')} בלי תמונות, ולכן לא יפורסמו בדף הפייסבוק של האתר.</b> הפוסט ייצא מעצמו כ-20 דקות אחרי שתעלו את התמונה הראשונה לכל נכס - אין צורך לבקש שוב.</p>` : ''}
    <p class="imp-note">נכסים ללא קו רוחב/אורך לא יופיעו כסימון על מפת עמוד הבית. אפשר להשלים מיקום וכתובת דרך "עריכה" בכל נכס, ואז גם ייקלט המידע התכנוני.</p>
    ${ok && !noImage ? '<p class="imp-note">מומלץ לעבור על הנכסים החדשים ולהוסיף תמונות - מודעה עם תמונות מקבלת פניות רבות יותר.</p>' : ''}`;
  impFootEl.innerHTML = `
    ${failedTotal ? '<button type="button" class="btn btn-ghost" id="impErrors">הורדת קובץ השגיאות</button>' : ''}
    <button type="button" class="btn btn-gold" id="impDone">סיום</button>`;

  const errBtn = document.getElementById('impErrors');
  if (errBtn) errBtn.addEventListener('click', ()=>{
    impDownloadErrors([
      ...invalid.map(r => ({ raw:r.raw, message:r.errors.join(' · ') })),
      ...importState.failed,
    ]);
  });
  document.getElementById('impDone').addEventListener('click', impClose);

  if (ok){
    showToast(`${plural(ok, 'נכס אחד נוסף', 'נכסים נוספו')} בהצלחה`);
    await loadProperties(currentAgent.id);
  }
}

/* ---------- קבצים להורדה: תבנית וקובץ שגיאות ---------- */
async function impDownloadTemplate(){
  let XLSX;
  try { XLSX = await loadImportLib(); }
  catch(err){ showToast(err.message); return; }

  const headers = IMPORT_FIELDS.map(f => f.label + (f.required ? ' *' : ''));
  // השורות לדוגמה נבנות לפי מפתח ולא לפי מיקום, כדי שהוספת שדה ל-IMPORT_FIELDS
  // לא תזיז אותן מהעמודות שלהן.
  const sampleRows = [
    {
      title:'דירת 4 חדרים משופצת, שכונת רמת דוד', category:'מגורים', property_type:'דירה',
      deal_type:'מכירה', price:1650000, city:'עפולה', rooms:4, neighborhood:'רמת דוד',
      sales_area:'צפון העיר', street:'דפנה', house_number:'12', floor:2, total_floors:6,
      size_sqm:95, garden_sqm:'', description:'דירה מוארת עם מרפסת שמש', condition:'משופץ',
      move_in_date:'2026-10-01', move_in_soon:'כן', listing_expires_at:'2026-12-31',
      features:'מעלית, חניה, ממ"ד, מרפסת שמש', furniture_details:'מטבח מלא, ארונות',
      marketing_description:'הזדמנות נדירה בלב השכונה', post_text:'🏡 חדש אצלנו! דירת 4 חדרים…',
      tour_3d_url:'https://my.matterport.com/show/?m=example', video_url:'https://www.youtube.com/watch?v=example',
      agent2_name:'', agent2_phone:'', owner_name:'ישראל ישראלי', owner_phone:'050-0000000',
    },
    {
      title:'חנות 60 מ"ר במרכז העיר', category:'מסחרי', property_type:'חנויות/שטח מסחרי',
      deal_type:'השכרה', price:6500, city:'עפולה', street:'הנשיא', house_number:'7',
      size_sqm:60, description:'חזית לרחוב ראשי', move_in_soon:'לא',
      features:'מזגן, מצלמות', restrooms_location:'בנכס', storage_location:'בבניין',
    },
  ];
  const sample = sampleRows.map(row => IMPORT_FIELDS.map(f => row[f.key] ?? ''));
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  sheet['!cols'] = headers.map(()=> ({ wch: 18 }));

  const vocabulary = [
    ['שדה','ערכים חוקיים'],
    ['קטגוריה','מגורים · מסחרי'],
    ['סוג עסקה','מכירה · השכרה'],
    ['סוג נכס (מגורים)', RESIDENTIAL_PTYPE_OPTIONS.join(' · ')],
    ['סוג נכס (מסחרי)', COMMERCIAL_PTYPE_OPTIONS.join(' · ')],
    ['סטטוס','פעיל · נמכר · הושכר · לא פעיל (ריק = פעיל)'],
    ['מצב הנכס','חדש מקבלן · חדש · משופץ · שמור · דרוש שיפוץ'],
    ['סטטוס הפרויקט','תכנון ראשוני · הוגשה בקשה להיתר · ניתן היתר בנייה · הבנייה הסתיימה'],
    ['שירותים / מחסן / ממ"ד','בבניין · בנכס (נכסים מסחריים בלבד)'],
    ['כניסה קרובה','כן · לא'],
    ['תאריך כניסה','dd/mm/yyyy או yyyy-mm-dd'],
    ['מאפייני מודעה', LISTING_FEATURES.map(([, l]) => l).join(' · ')],
    ['מאפייני נכס (מגורים)', RESIDENTIAL_PROPERTY_FEATURES.map(([, l]) => l).join(' · ')],
    ['מאפייני נכס (מסחרי)', COMMERCIAL_PROPERTY_FEATURES.map(([, l]) => l).join(' · ')],
    ['מאפיינים בקובץ','כמה ערכים בתא אחד, מופרדים בפסיק'],
    ['קישורי תמונות',`עד ${MAX_IMAGES} כתובות מלאות (https://…), מופרדות בפסיק`],
    ['תמונה שיווקית','כתובת מלאה אחת (https://…) - תמונה מעוצבת, נפרדת מהגלריה'],
    ['תוקף המודעה','dd/mm/yyyy או yyyy-mm-dd'],
    ['שכונה','חייבת להיות שכונה מרשימת הפלטפורמה, אחרת לא תיקלט'],
    ['בעלים','שם וטלפון בעל/ת הנכס - מידע פנימי, לא מוצג באתר ולא במסך של משרד אחר'],
    ['מספר מודעה','נוצר אוטומטית במערכת - אין צורך בעמודה בקובץ'],
    ['כותרת','אם אין עמודה כזו, תיווצר כותרת מסוג הנכס, החדרים והכתובת'],
    ['עמודת מאפיין','אפשר גם עמודה לכל מאפיין ("מזגן", "מעלית") עם כן/לא - היא תזוהה לבד'],
  ];
  const vocabSheet = XLSX.utils.aoa_to_sheet(vocabulary);
  vocabSheet['!cols'] = [{ wch: 24 }, { wch: 110 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'נכסים');
  XLSX.utils.book_append_sheet(book, vocabSheet, 'ערכים חוקיים');
  XLSX.writeFile(book, 'תבנית-ייבוא-נכסים.xlsx');
}

/* קובץ השגיאות הוא הקובץ המקורי + עמודת סיבה, כדי שאפשר יהיה לתקן בו
   ולהעלות אותו שוב כמו שהוא. */
async function impDownloadErrors(rows){
  let XLSX;
  try { XLSX = await loadImportLib(); }
  catch(err){ showToast(err.message); return; }
  const header = [...importState.headers, 'סיבת הדחייה'];
  const data = rows.map(r => [...importState.headers.map((_, i) => impText(r.raw[i])), r.message]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  sheet['!cols'] = header.map((_, i) => ({ wch: i === header.length - 1 ? 60 : 18 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'שורות שנדחו');
  XLSX.writeFile(book, 'שגיאות-ייבוא-נכסים.xlsx');
}

document.getElementById('openImportProperties').addEventListener('click', impOpen);
document.getElementById('impClose').addEventListener('click', impClose);

/* ---------- ייצוא הנכסים לקובץ אקסל ----------
   הכיוון ההפוך של אשף הייבוא, ובכוונה באותו מבנה עמודות בדיוק: הקובץ שיוצא
   כאן נקרא בחזרה על ידי האשף בלי מיפוי ידני. מזה נגזרות שלוש התכליות שלו —
   גיבוי מקומי של תיק הנכסים, העברת מלאי בין מערכות, ועריכה המונית באקסל
   (שינוי מחירים לעשרים נכסים) שחוזרת פנימה כייבוא.

   **ההרשאה נשמרת ב-RLS ולא כאן.** ה-policy
   ‏"read active or own or agency properties" כבר מחזירה למנהל/ת משרד את כל
   נכסי המשרד ולסוכן/ת רגיל/ה רק את שלו/ה, וכך גם
   ‏"listing agent manages property owner" על פרטי הבעלים. בורר ההיקף מוצג
   למנהל/ת בלבד לא בגלל בדיקה בדפדפן, אלא כי לאף אחד אחר אין מה לבחור בו:
   סוכן/ת שתשנה את ה-select ידנית תקבל בדיוק את אותן שורות.

   ‏SheetJS היא אותה ספרייה של הייבוא (‏loadImportLib) — 900KB שנטענים
   בלחיצה ולא בטעינת ה-CRM.

   מה שהקובץ *לא* כולל: מספר צפיות בייצוא של נכסי סוכן/ת אחר/ת. ה-policy על
   ‎property_views‎ צרה יותר ומחזירה רק צפיות בנכסים של הקורא/ת, ועמודה של
   אפסים גרועה מעמודה שאינה קיימת.                                          */

const exportModal = document.getElementById('exportModal');

/* היפוך מפות הייבוא: הערך העברי הראשון לכל קוד. כך אוצר המילים של הקובץ
   שיוצא זהה לזה של הקובץ שנכנס בלי רשימה שנייה לתחזק — והשינוי הבא ב-IMP_*
   מגיע לשני הכיוונים יחד. מפתחות באנגלית מדולגים: הם קיימים במפות כדי לקלוט
   קבצים ממערכות אחרות, ולא בשביל להיכתב. */
function expReverse(map){
  const out = Object.create(null);
  for (const [word, code] of Object.entries(map)){
    if (!(code in out) && /[\u0590-\u05FF]/.test(word)) out[code] = word;
  }
  return out;
}
const EXP_CATEGORY       = expReverse(IMP_CATEGORY);
const EXP_DEAL           = expReverse(IMP_DEAL);
const EXP_CONDITION      = expReverse(IMP_CONDITION);
const EXP_PROJECT_STATUS = expReverse(IMP_PROJECT_STATUS);
const EXP_LOCATION       = expReverse(IMP_LOCATION);
const EXP_STATUS         = expReverse(IMP_PROPERTY_STATUS);

// ‏null ("לא נשאל") ו-false ("לא") אינם אותו דבר, ולכן ריק ולא "לא"
function expYesNo(value){
  if (value === true) return 'כן';
  if (value === false) return 'לא';
  return '';
}

/* dd/mm/yyyy — הצורה שנקראת בעברית, ושאשף הייבוא קורא בחזרה.
   עמודת DATE חוזרת כ-'yyyy-mm-dd' בלי שעה, ו-new Date() הייתה קוראת אותה
   כחצות UTC ומזיזה אותה יום אחורה בכל אזור זמן ממערב לגריניץ'. */
function expDate(value){
  if (!value) return '';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(d) ? '' : `${impPad(d.getDate())}/${impPad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/* מספרים נכתבים כמספרים ולא כטקסט: עמודת מחיר שיורדת כמחרוזת אינה ניתנת
   לסכימה, למיון או לגרף — וזו בדיוק הסיבה שמורידים אקסל ולא PDF. */
function expNumber(value){
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return isFinite(n) ? n : '';
}

const EXPORT_NUMERIC_KEYS = new Set([
  'price','rooms','floor','total_floors','size_sqm','built_size_sqm','garden_sqm','lat','lng',
]);

// ערך תא אחד, לפי אותו מפתח שדה שבו משתמש הייבוא
function expFieldValue(p, key){
  if (EXPORT_NUMERIC_KEYS.has(key)) return expNumber(p[key]);
  switch (key){
    case 'status':          return EXP_STATUS[p.status] || p.status || '';
    case 'category':        return EXP_CATEGORY[p.category] || p.category || '';
    case 'deal_type':       return EXP_DEAL[p.deal_type] || p.deal_type || '';
    case 'condition':       return EXP_CONDITION[p.condition] || p.condition || '';
    case 'project_status':  return EXP_PROJECT_STATUS[p.project_status] || p.project_status || '';
    case 'restrooms_location':
    case 'storage_location':
    case 'mamad_location':  return EXP_LOCATION[p[key]] || p[key] || '';
    // בקובץ נכתב שם השכונה ולא המזהה — הוא גם מה שהייבוא מחפש בחזרה
    case 'neighborhood':    return allNeighborhoods.find(n => n.id === p.neighborhood_id)?.name || '';
    case 'move_in_soon':    return expYesNo(p.move_in_soon);
    case 'move_in_date':
    case 'listing_expires_at': return expDate(p[key]);
    case 'features':        return (p.features || []).map(featureLabel).join(', ');
    case 'images':          return (p.images || []).join(', ');
    case 'owner_name':
    case 'owner_phone': {
      const owner = Array.isArray(p.property_owners) ? p.property_owners[0] : p.property_owners;
      return owner?.[key] || '';
    }
    default: return p[key] ?? '';
  }
}

/* עמודות שהתוכן שלהן הוא פסקה ולא ערך — בלי רוחב מיוחד הן יורדות לקו דק
   שאי אפשר לקרוא בלי להרחיב ידנית כל אחת מהן. */
const EXPORT_WIDE_LABELS = new Set([
  'כותרת','תיאור המודעה','תיאור שיווקי','טקסט פוסט','מאפיינים','קישורי תמונות',
  'פירוט ריהוט','תמונה שיווקית','קישור לסיור וירטואלי','קישור לסרטון',
]);

/* גיליון הנכסים. עמודות הייבוא נשמרות בשמות ובסדר שלהן בדיוק, ומה שאין לו
   מקבילה בייבוא (מספר מודעה, סוכן/ת, תאריכים, צפיות) עוטף אותן משני הצדדים.
   הסדר הזה גם מה שמאפשר להעלות את הקובץ בחזרה: ‏impAutoMap() מתאים לפי שם
   העמודה, והעמודות הנוספות פשוט נשארות בלי שדה. */
function expBuildPropertiesSheet(XLSX, rows, opts){
  const headers = [
    'מספר מודעה', 'סוכן/ת אחראי/ת',
    ...IMPORT_FIELDS.map(f => f.label),
    'מקודם', 'שותף עם משרדים',
    ...(opts.withViews ? ['צפיות בעמוד הנכס'] : []),
    'תאריך פרסום', 'עודכן לאחרונה',
  ];
  const data = rows.map(p => [
    p.listing_number ?? '',
    opts.agentName(p),
    ...IMPORT_FIELDS.map(f => expFieldValue(p, f.key)),
    expYesNo(propertyIsPromoted(p)),
    expYesNo(!!p.shared_with_partners),
    ...(opts.withViews ? [propertyViewCounts[p.id] || 0] : []),
    expDate(p.created_at),
    expDate(p.updated_at),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  sheet['!cols'] = headers.map(h => ({ wch: EXPORT_WIDE_LABELS.has(h) ? 42 : 16 }));
  return sheet;
}

/* גיליון שני, בייצוא של כל המשרד בלבד: שורה לכל סוכן/ת. זו השאלה הראשונה
   שמנהל/ת שואל/ת על קובץ כזה ("כמה יש לכל אחד ומה פעיל"), ובלי הגיליון היא
   דורשת PivotTable על מאות שורות.

   שווי המלאי מסוכם על נכסי המכירה בלבד: מחיר של נכס להשכרה הוא סכום חודשי,
   וחיבור של השניים מייצר מספר שנראה כמו כסף ואינו כסף. */
function expBuildTeamSheet(XLSX, rows, agentNameOf){
  const byAgent = new Map();
  rows.forEach(p => {
    const key = p.agent_id || '-';
    if (!byAgent.has(key)){
      byAgent.set(key, { name: agentNameOf(p) || '-', total:0, active:0, sale:0, rent:0, closed:0, value:0 });
    }
    const row = byAgent.get(key);
    row.total++;
    if (p.status === 'active'){
      row.active++;
      if (p.deal_type === 'rent') row.rent++;
      else { row.sale++; row.value += Number(p.price) || 0; }
    }
    if (p.status === 'sold' || p.status === 'rented') row.closed++;
  });
  const data = [...byAgent.values()]
    .sort((a, b) => b.active - a.active || hebCompare(a.name, b.name))
    .map(r => [r.name, r.total, r.active, r.sale, r.rent, r.closed, r.value]);
  const sheet = XLSX.utils.aoa_to_sheet([
    ['סוכן/ת','סה"כ נכסים','פעילים','פעילים למכירה','פעילים להשכרה','נמכרו / הושכרו','שווי המלאי הפעיל למכירה (₪)'],
    ...data,
  ]);
  sheet['!cols'] = [{ wch:26 },{ wch:13 },{ wch:11 },{ wch:15 },{ wch:16 },{ wch:16 },{ wch:26 }];
  return sheet;
}

/* ---------- מקורות השורות ---------- */

/* ‏PostgREST מחזירה 1000 שורות בברירת המחדל. משרד גדול חוצה את הגבול, וקובץ
   שנחתך בשקט גרוע מקובץ שלא ירד בכלל — לכן השליפה היא בדפים. המיון המשני לפי
   ‎id‎ נדרש כדי ששורות עם אותו ‎created_at‎ לא יקפצו בין דף לדף. */
const EXPORT_PAGE = 1000;
const EXPORT_MAX_PAGES = 20;
async function expFetchRows(agentId){
  const rows = [];
  for (let page = 0; page < EXPORT_MAX_PAGES; page++){
    let query = sb.from('properties')
      .select(PROPERTY_SELECT_COLUMNS + ', agent_id')
      .order('created_at', { ascending:false })
      .order('id', { ascending:true })
      .range(page * EXPORT_PAGE, (page + 1) * EXPORT_PAGE - 1);
    query = agentId
      ? query.eq('agent_id', agentId)
      : query.eq('agency_id', currentAgent.agency_id);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < EXPORT_PAGE) break;
  }
  return rows;
}

/* רשימת הצוות לבורר. ‏agency_members ולא agency_members_public: מנהל/ת צריך/ה
   לראות גם סוכן/ת מושעה או מנותק/ת — הנכסים שלו/ה נשארו במשרד, וייצוא שלהם
   הוא בדיוק מה שמבקשים כשמישהו עוזב. */
let expTeamCache = null;
async function expLoadTeam(){
  if (expTeamCache) return expTeamCache;
  const { data, error } = await sb.from('agency_members')
    .select('id, display_name, active')
    .eq('agency_id', currentAgent.agency_id)
    .order('display_name');
  expTeamCache = error ? [] : (data || []);
  return expTeamCache;
}

/* ---------- החלון ---------- */

const expScopeSelect   = document.getElementById('expScope');
const expFilteredWrap  = document.getElementById('expFilteredWrap');
const expFilteredCheck = document.getElementById('expFiltered');

function expCurrentScope(){
  return document.getElementById('expScopeField').hidden ? 'own' : (expScopeSelect.value || 'own');
}

/* תיבת "רק מה שמסונן" מופיעה רק כשיש סינון פעיל וההיקף הוא הנכסים שלי:
   הסינון הוא של הרשימה שעל המסך, ואין לו משמעות על שורות שנשלפות מהשרת. */
function expSyncFilteredOption(){
  const f = propertyFilterState();
  const active = !!(f.q || f.status || f.deal || f.type || f.city || f.extra);
  if (expCurrentScope() !== 'own' || !active){
    expFilteredWrap.hidden = true;
    expFilteredCheck.checked = false;
    return;
  }
  const shown = filterProperties(myPropertyRows, f).length;
  document.getElementById('expFilteredText').textContent =
    `לייצא רק את ${shown} הנכסים שברשימה לפי הסינון הפעיל, במקום את כל ${myPropertyRows.length}`;
  expFilteredWrap.hidden = false;
}

async function expOpen(){
  if (!currentAgent) return;
  const isManager = currentAgent.role === 'manager';
  if (!isManager && !myPropertyRows.length){
    showToast('אין עדיין נכסים לייצוא');
    return;
  }

  const scopeField = document.getElementById('expScopeField');
  scopeField.hidden = !isManager;
  if (isManager){
    // הבורר נבנה מחדש בכל פתיחה — סוכן/ת שנוסף/ה לצוות אחרי הכניסה לדף
    // חייב/ת להופיע בו בלי רענון
    const team = (await expLoadTeam()).filter(m => m.id !== currentAgent.id);
    expScopeSelect.innerHTML =
      '<option value="own">הנכסים שלי בלבד</option>' +
      '<option value="agency">כל נכסי המשרד - שלי ושל כל הסוכנים</option>' +
      (team.length
        ? '<optgroup label="סוכן/ת מסוים/ת">' + team.map(m =>
            `<option value="${esc(m.id)}">${esc(m.display_name || 'ללא שם')}${m.active ? '' : ' (מושעה/ת)'}</option>`
          ).join('') + '</optgroup>'
        : '');
    expScopeSelect.value = 'own';
  }

  expSyncFilteredOption();
  document.getElementById('expNote').textContent =
    'הקובץ נבנה במבנה של תבנית הייבוא - אפשר לערוך אותו באקסל ולהעלות אותו בחזרה דרך "ייבוא מקובץ". ' +
    'הוא כולל גם שם וטלפון של בעלי הנכסים, שאינם מוצגים באתר - שמרו אותו בהתאם.';
  exportModal.style.display = 'flex';
}

function expClose(){ exportModal.style.display = 'none'; }

/* שם הסוכן/ת נכנס לשם הקובץ, והוא טקסט חופשי שהוקלד בכרטיס. תו נתיב בתוכו
   ישבור את ההורדה בחלק מהדפדפנים, ולכן כל מה שאינו חוקי בשם קובץ יורד. */
function expFileName(label){
  const now = new Date();
  const clean = String(label).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'נכסים';
  return `${clean} ${impPad(now.getDate())}-${impPad(now.getMonth() + 1)}-${now.getFullYear()}.xlsx`;
}

async function expDownload(){
  const button = document.getElementById('expRun');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'מכין את הקובץ…';
  try {
    let XLSX;
    try { XLSX = await loadImportLib(); }
    catch(err){ showToast(err.message); return; }
    // שם השכונה נכתב בקובץ, ובייצוא של נכסי סוכן/ת אחר/ת המטמון עשוי להיות ריק
    await ensureNeighborhoodsLoaded();

    const scope = expCurrentScope();
    let rows, agentName, withViews = false, fileLabel, teamSheet = false;

    if (scope === 'own'){
      const useFilter = !expFilteredWrap.hidden && expFilteredCheck.checked;
      const f = propertyFilterState();
      rows = useFilter ? sortProperties(filterProperties(myPropertyRows, f), f.sort) : myPropertyRows;
      agentName = ()=> currentAgent.display_name || '';
      // הצפיות כבר בזיכרון מ-loadProperties, והן קריאות רק על נכסים של הסוכן/ת
      withViews = true;
      fileLabel = 'הנכסים שלי';
    } else {
      const team = await expLoadTeam();
      const names = Object.fromEntries(team.map(m => [m.id, m.display_name || '']));
      const agentId = scope === 'agency' ? null : scope;
      rows = await expFetchRows(agentId);
      agentName = p => names[p.agent_id] || '';
      teamSheet = !agentId;
      fileLabel = agentId ? ('נכסי ' + (names[agentId] || 'סוכן')) : 'נכסי המשרד';
    }

    if (!rows.length){ showToast('אין נכסים לייצוא בבחירה הזו'); return; }

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, expBuildPropertiesSheet(XLSX, rows, { withViews, agentName }), 'נכסים');
    if (teamSheet){
      XLSX.utils.book_append_sheet(book, expBuildTeamSheet(XLSX, rows, agentName), 'סיכום לפי סוכן');
    }
    XLSX.writeFile(book, expFileName(fileLabel));
    expClose();
    showToast(`${plural(rows.length, 'נכס אחד ירד', 'נכסים ירדו')} לקובץ`);
  } catch(err){
    showToast('הייצוא נכשל: ' + (err?.message || 'שגיאה לא ידועה'));
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

document.getElementById('openExportProperties').addEventListener('click', expOpen);
document.getElementById('expCancel').addEventListener('click', expClose);
document.getElementById('expRun').addEventListener('click', expDownload);
expScopeSelect.addEventListener('change', expSyncFilteredOption);
exportModal.addEventListener('click', e => { if (e.target === exportModal) expClose(); });
document.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape' || exportModal.style.display === 'none') return;
  expClose();
  document.getElementById('openExportProperties').focus({ preventScroll:true });
});

/* ---------- ארכיון הלידים ----------
   הקטגוריה צוברת לנצח: כל ליד שנכנס אי פעם נשאר בה, והליד שהגיע הבוקר יושב
   בראש רשימה של מאות שכבר נסגרו. הארכיון הוא הדרך להוריד כרטיס מהמסך *בלי*
   למחוק אותו — הליד, הבעלות עליו והחיוב שכבר נגבה לא משתנים, וההחזרה היא
   מחיקת שורה בטבלת ‎lead_archives‎.

   מה שהארכוב משנה בפועל: הכרטיס עובר ללשונית הארכיון, יורד מהמונה שבכותרת
   ויורד מפאנל "הלידים החמים". השלישייה הזו היא כל העניין — ליד מטופל שממשיך
   לצוץ בתור הדחוף הוא בדיוק הרעש שהפעולה נועדה להוריד.

   ‏Set של מזהים ולא שדה על הליד: ‎leads_masked‎ הוא ה-view שהדשבורד קורא,
   והוא לא מכיר את הארכיון. */
let archivedLeadIds = new Set();
let allLeads = [];
let leadsView = 'active';

/* המתג יושב ב-HTML ולא נבנה מחדש בכל רינדור, ולכן המאזין נרשם פעם אחת.
   ‏currentAgent הוא מקור ה-agentId גם כאן: ‎renderLeads‎ מעביר אותו הלאה
   לכפתורי הארכוב שבכרטיסים. */
document.getElementById('leadsSwitch').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-leads-view]');
  if (!btn || btn.dataset.leadsView === leadsView) return;
  leadsView = btn.dataset.leadsView;
  renderLeads(currentAgent?.id);
});

/* טבלה שטרם נוצרה מחזירה שני קודים שונים, ושניהם צריכים להיתפס: ‏42P01 הוא
   השגיאה של Postgres עצמו, אבל ‏PostgREST כמעט תמיד עוצר קודם — הוא בונה את
   הבקשה מול ה-schema cache שלו, ומה שלא נמצא שם נדחה כ-‏PGRST205 ("Could not
   find the table … in the schema cache") בלי שהשאילתה בכלל הגיעה למסד. בדיקה
   של ‏42P01 בלבד מפספסת בדיוק את המקרה הנפוץ. */
function isMissingTableError(error){
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/* הדשבורד לא נופל על טבלה חסרה: בלי ארכיון פשוט אין מה להסתיר, וכל הלידים
   נשארים ברשימה הפעילה — בדיוק ההתנהגות שהייתה לפני התכונה. */
async function loadArchivedLeadIds(agentId){
  const { data, error } = await sb
    .from('lead_archives')
    .select('lead_id')
    .eq('agent_id', agentId);
  if (error){
    if (!isMissingTableError(error)) console.warn('טעינת ארכיון הלידים נכשלה:', error.message);
    return new Set();
  }
  return new Set((data || []).map(r => r.lead_id));
}

async function archiveLead(lead, btn, agentId){
  btn.disabled = true;
  const { error } = await sb.from('lead_archives').insert({ lead_id: lead.id, agent_id: agentId });
  btn.disabled = false;
  if (error){
    showToast(isMissingTableError(error)
      ? 'הארכיון עדיין לא קיים - הריצו את המיגרציה 20260924090000_lead_archive.sql ב-Supabase.'
      : 'העברה לארכיון נכשלה: ' + error.message);
    return;
  }
  archivedLeadIds.add(lead.id);
  // הליד עבר רשימה, ולכן הוא לא אמור להיפתח לבד בצד השני: מצב הפתיחה
  // שמור לפי מזהה, ובלי השורה הזו הכרטיס היה ממתין פתוח בארכיון
  expandedLeadIds.delete(lead.id);
  showToast('הליד הועבר לארכיון');
  renderLeads(agentId);
}

async function unarchiveLead(lead, btn, agentId){
  btn.disabled = true;
  const { error } = await sb.from('lead_archives').delete().eq('lead_id', lead.id);
  btn.disabled = false;
  if (error){ showToast('החזרה מהארכיון נכשלה: ' + error.message); return; }
  archivedLeadIds.delete(lead.id);
  expandedLeadIds.delete(lead.id);
  showToast('הליד חזר לרשימה הפעילה');
  renderLeads(agentId);
}

async function loadLeads(agentId){
  const listEl = document.getElementById('leadsList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  // שתי השאילתות אינן תלויות זו בזו, ובטעינת דשבורד שממילא מריצה עשר
  // טעינות בזו אחר זו אין סיבה לשלם על השנייה בהמתנה נפרדת.
  const [{ data: leads, error }, archived] = await Promise.all([
    sb.from('leads_masked')
      .select('*')
      .eq('agent_id', agentId)
      .order('created_at', { ascending:false }),
    loadArchivedLeadIds(agentId),
  ]);

  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת לידים: ' + error.message + '</div>';
    return;
  }
  archivedLeadIds = archived;
  allLeads = leads || [];
  renderLeads(agentId);
}

/* הפרדה בין הטעינה לתצוגה: מעבר בין הלשוניות וארכוב של כרטיס בודד מציירים
   מחדש מהנתונים שכבר ביד, בלי לחזור לשרת. */
function renderLeads(agentId){
  const listEl = document.getElementById('leadsList');
  const active   = allLeads.filter(l => !archivedLeadIds.has(l.id));
  const archived = allLeads.filter(l =>  archivedLeadIds.has(l.id));

  // המונה בכותרת מציג לידים שעדיין לא נפתחו — זה מה שדורש טיפול. ליד שארוכב
  // הוצא מהמסך בכוונה, ולכן הוא לא נספר גם אם לא נפתח.
  accSetCount('accLeads', active.filter(l => l.status !== 'unlocked').length);
  // המונה אומר "כמה ממתינים"; הסיכום אומר מה יש שם בכלל
  accSetSummary('accLeads', active.length
    ? plural(active.length, 'ליד אחד', 'לידים') + ' · ' + plural(active.filter(l => l.status === 'unlocked').length, 'אחד מהם נפתח', 'נפתחו')
    : '');

  const sw = document.getElementById('leadsSwitch');
  document.getElementById('leadsActiveCount').textContent = active.length;
  document.getElementById('leadsArchivedCount').textContent = archived.length;
  // המתג מופיע רק כשיש בין מה למה לעבור. עד אז הוא שאלה על משהו שלא קיים.
  sw.hidden = archived.length === 0;
  if (sw.hidden) leadsView = 'active';
  sw.querySelectorAll('[data-leads-view]').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.leadsView === leadsView ? 'true' : 'false'));

  /* פאנל "הלידים החמים" ירד — הוא היה תמצית של הרשימה הזו במקום נפרד. מה
     שהוא נתן, הסדר נותן: ליד שעדיין לא נפתח עולה לראש הרשימה הפעילה, ובתוך
     כל קבוצה החדש קודם. הארכיון נשאר כרונולוגי — שם אין "דורש טיפול". */
  const showing = leadsView === 'archived' ? archived
    : active.slice().sort((a,b)=>{
        const openA = a.status === 'unlocked' ? 1 : 0;
        const openB = b.status === 'unlocked' ? 1 : 0;
        if (openA !== openB) return openA - openB;
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
  if (showing.length === 0){
    listEl.innerHTML = '<div class="empty-state">' + (
      leadsView === 'archived'
        ? 'אין לידים בארכיון.'
        : (allLeads.length === 0
            ? 'אין עדיין לידים משויכים אליך.<br>ברגע שמתעניין יפנה על אחד הנכסים שלך, הוא יופיע כאן.'
            : 'כל הלידים שלך בארכיון. עברו ללשונית הארכיון כדי להחזיר מהם.')
    ) + '</div>';
    return;
  }

  // הרשימה היא טאבים, באותה שפה של "הנכסים שלי" ו"קובץ הלקוחות".
  // ראו ההערה מעל buildLeadTab().
  listEl.innerHTML = '<div class="prop-tabs lead-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  showing.forEach(lead => tabsWrap.appendChild(buildLeadTab(lead, agentId)));
}

/* ---------- הלידים כרשימת טאבים ----------
   אותה מחווה של רשימת הנכסים וקובץ הלקוחות: שורה קצרה לכל ליד, והכרטיס
   המלא נפתח מתחתיה בלחיצה. כאן זה חשוב פי כמה — ליד נקרא פעם אחת ואז
   מטופל בטלפון, אבל הוא נשאר ברשימה לנצח: ארבעים לידים שנפתחו כבר הם
   ארבעים כרטיסים מלאים שצריך לגלול לפני הליד החדש שממתין.

   ‏`LEAD_STATUS_LABELS` ולא שרשרת שלישייה בתוך הבנייה: אותן שלוש תוויות
   נדרשות גם בשורה וגם בכרטיס, ושתי שרשראות נפרדות מתפצלות בשינוי הראשון.

   מצב הפתיחה נשמר לפי מזהה (`expandedLeadIds`), וזו לא רק נוחות: פתיחת
   ליד מרעננת את כל הדשבורד (`loadDashboard()`), ובלי הסט הזה הכרטיס היה
   נסגר בדיוק ברגע שבו הטלפון האמיתי נחשף בו. */
const LEAD_STATUS_LABELS = { unlocked:'פתוח', pending_charge:'בתהליך פתיחה' };
const expandedLeadIds = new Set();

function leadStatusLabel(lead){ return LEAD_STATUS_LABELS[lead.status] || 'מוסתר'; }

/* מה שמזהה ליד בשורה אחת: איזו עסקה, איפה, איזה נכס ומתי. צד הליד
   (מוכר מול קונה) אינו נאמר כאן — הוא האייקון והפס הצדדי, בדיוק כמו
   בכרטיס, והתווית המלאה ממתינה בו. */
function leadTabSub(lead){
  return [
    lead.deal_type === 'rent' ? 'השכרה' : (lead.deal_type === 'sale' ? 'מכירה' : ''),
    lead.city,
    lead.property_type,
    tabShortDate(lead.created_at),
  ].filter(Boolean).join(' · ');
}

/* במשבצת שבה יושב המחיר בטאב הנכס: כמה עולה לפתוח את הליד הזה — ההחלטה
   שבשבילה הרשימה הזו נסרקת, ועכשיו היא נענית בלי לפתוח כרטיס. ליד פתוח
   כבר שילם, וליד שהמסלול חוסם אינו שאלה של מחיר; בשניהם המשבצת ריקה
   וההסבר ממתין בכרטיס. */
function leadTabPrice(lead){
  if (lead.status !== 'masked') return '';
  const cost = claimCost(lead);
  if (cost.blocked) return '';
  return cost.price > 0 ? shekel(cost.price) : 'חינם';
}

function buildLeadTab(lead, agentId){
  const kind = leadKind(lead);
  const isArchived = archivedLeadIds.has(lead.id);
  const el = buildTabRow({
    key: lead.id, list:'lead', expanded: expandedLeadIds,
    cls: 'lead-tab ' + kind.cls + (isArchived ? ' is-archived' : ''),
    icon: kind.icon,
    title: lead.display_name || '-',
    sub: leadTabSub(lead),
    pill: { text: leadStatusLabel(lead),
            cls: 'status-pill status-' + (lead.status === 'unlocked' ? 'unlocked' : 'masked') },
    price: leadTabPrice(lead),
    // הכרטיס נבנה בפתיחה ונזרק בסגירה — ראו buildTabRow()
    buildCard: ()=> buildLeadCard(lead, agentId, isArchived),
  });
  el.dataset.leadId = lead.id;
  return el;
}

function buildLeadCard(lead, agentId, isArchived){
  const kind = leadKind(lead);
  const el = document.createElement('div');
  el.className = 'card lead-card ' + kind.cls + (isArchived ? ' is-archived' : '');
  const statusLabel = leadStatusLabel(lead);
  const dealLabel = lead.deal_type === 'rent' ? 'השכרה' : (lead.deal_type === 'sale' ? 'מכירה' : '');
  el.innerHTML = `
    <div class="lead-top">
      <div>
        <span class="lead-kind">${kind.icon} ${esc(kind.label)}</span>
        <div class="lead-name">${esc(lead.display_name || '-')}</div>
        <div class="lead-phone">${esc(lead.display_phone || '-')}</div>
      </div>
      <span class="status-pill status-${lead.status === 'unlocked' ? 'unlocked' : 'masked'}">${statusLabel}</span>
    </div>
    ${tagsHtml([
      dealLabel && { text:dealLabel, cls:'tag-key' },
      lead.city && { text:'📍 ' + lead.city },
      lead.property_type && { text:'🏠 ' + lead.property_type },
      { text:'📅 ' + hebDate(lead.created_at) },
    ])}
    ${lead.property_details ? `<div class="lead-meta">🏠 ${esc(lead.property_details)}</div>` : ''}
    ${lead.display_message ? `<div class="lead-meta">📍 ${esc(lead.display_message)}</div>` : ''}
    <div class="lead-actions"></div>
  `;
  const actions = el.querySelector('.lead-actions');
  if (lead.status !== 'unlocked'){
    const cost = claimCost(lead);
    addCardAction(actions, {
      label: cost.price > 0 ? `🔓 פתיחת ליד · ${shekel(cost.price)}` : '🔓 פתיחת ליד',
      cls:'btn-gold act-wide',
      title: cost.note || cost.blocked || undefined,
      onClick: btn => claimLead(lead, btn, agentId),
    });
  } else {
    // הליד פתוח - כלומר הטלפון האמיתי כבר חשוף ב-display_phone, וזו הנקודה
    // היחידה במערכת שממנה אפשר לבקש חוות דעת (הביקורת מאומתת מול הליד).
    // וואטסאפ ראשון כי זו הדרך שבה זה באמת נשלח; העתקת קישור נשארת לגיבוי.
    const wa = waLink(lead.display_phone);
    if (wa){
      addCardAction(actions, {
        label:'⭐ בקשת חוות דעת', cls:'btn-gold', title:'שליחת הקישור ללקוח/ה בוואטסאפ',
        onClick: () => sendReviewLinkWhatsApp(lead),
      });
    }
    addCardAction(actions, {
      label:'📋 העתקת קישור', title:'העתקת קישור לבקשת חוות דעת מהלקוח/ה',
      onClick: btn => copyReviewLink(lead.id, btn),
    });
  }
  /* הארכוב אחרון בשורת הפעולות ועל רוחב מלא: הוא לא מתחרה על העין עם
     "פתיחת ליד" או "בקשת חוות דעת" - הוא מה שעושים *אחרי* שסיימו. */
  addCardAction(actions, isArchived ? {
    label:'↩️ החזרה מהארכיון', cls:'btn-ghost act-wide',
    title:'הליד יחזור לרשימת הלידים הפעילים',
    onClick: btn => unarchiveLead(lead, btn, agentId),
  } : {
    label:'🗄️ העברה לארכיון', cls:'btn-ghost act-wide',
    title:'הליד יורד מהרשימה ומהתור החם ונשמר בארכיון - אפשר להחזיר אותו בכל רגע',
    onClick: btn => archiveLead(lead, btn, agentId),
  });
  return el;
}

/* הכתובת מורכבת מתיקיית הדף הנוכחי ולא מהחלפת 'crm.html' בנתיב: בפרודקשן
   הדף מוגש גם בלי הסיומת (/crm), ואז ההחלפה לא תופסת והתוצאה הייתה
   /crmreview-request.html - קישור שבור. קיצוץ המקטע האחרון עובד בשתי הצורות. */
function reviewLink(leadId){
  const dir = window.location.pathname.replace(/[^/]*$/, '');
  return window.location.origin + dir + 'review-request.html?lead=' + leadId;
}

/* פתיחת וואטסאפ עם הודעה מוכנה. הקישור נפתח בחלון חדש ולא נשלח מהשרת -
   ההודעה יוצאת מהמספר של הסוכן/ת עצמו/ה, וזו הסיבה שהיא גם נקראת אישית
   ולא כהודעת מערכת. */
function sendReviewLinkWhatsApp(lead){
  const wa = waLink(lead.display_phone);
  if (!wa){ showToast('אין מספר טלפון תקין לליד הזה'); return; }
  const name = (lead.display_name || '').trim();
  const text =
    (name ? `היי ${name},` : 'היי,') + '\n' +
    'שמחתי לעזור! אשמח מאוד אם תוכל/י להשאיר חוות דעת קצרה - זה לוקח פחות מדקה ועוזר לי מאוד:\n' +
    reviewLink(lead.id);
  window.open(wa + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

function copyReviewLink(leadId, btn){
  const link = reviewLink(leadId);
  const original = btn.textContent;
  const finish = (msg)=>{ btn.textContent = msg; setTimeout(()=> btn.textContent = original, 2000); };
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(link).then(()=> finish('✓ הקישור הועתק')).catch(()=>{
      showToast('לא ניתן להעתיק אוטומטית - הקישור: ' + link);
    });
  } else {
    // navigator.clipboard דורש HTTPS/localhost - כשפותחים file:// ישירות זה לא זמין,
    // אז מציגים את הקישור ב-toast כדי שאפשר יהיה להעתיק ידנית ולשלוח ללקוח
    showToast('העתיקו ידנית: ' + link, 8000);
  }
}

/* המחיר מחושב כאן באותה לוגיקה של claim_lead ב-DB, רק כדי להציג אותו לפני
   האישור - השרת נשאר הסמכות, והטוסט אחרי ההצלחה מציג את מה שנגבה בפועל. */
function quotaUsedThisCycle(){
  const start = currentAgent?.free_quota_cycle_start;
  if (start){
    const d = new Date(start), now = new Date();
    // מכסה חודשית: מחזור שהתחיל בחודש קודם כבר התאפס בשרת בפתיחה הבאה
    if (d.getFullYear() < now.getFullYear() ||
        (d.getFullYear() === now.getFullYear() && d.getMonth() < now.getMonth())) return 0;
  }
  return currentAgent?.free_quota_used || 0;
}

function claimCost(lead){
  const tier = currentAgent?.tier || 'free';
  if (lead.lead_type === 'owner_inbound'){
    if (tier === 'free')    return { price:0, blocked:'לידי בעל-נכס אינם זמינים במסלול Pay&GO' };
    if (tier === 'premium') return { price:0, note:'לידי בעל-נכס כלולים במסלול Elite' };
    return { price: priceOf('ppl_price_owner_mid', 50) };
  }
  if (tier === 'mid' || tier === 'premium') return { price:0, note:'לידי קונה/שוכר כלולים במסלול שלך, ללא הגבלה' };
  const quota = priceOf('free_lead_quota_monthly', 10);
  const used = quotaUsedThisCycle();
  if (used < quota) return { price:0, note:`נכלל במכסה החינמית — ${used + 1} מתוך ${quota} החודש` };
  return { price: priceOf('ppl_price_buyer_renter', 20), note:`המכסה החינמית (${quota} לחודש) נוצלה` };
}

async function claimLead(lead, btn, agentId){
  const cost = claimCost(lead);
  if (cost.blocked){ showToast(cost.blocked); return; }

  const kind = leadKind(lead);
  const approved = await confirmPurchase({
    title: cost.price > 0 ? 'אישור רכישת ליד' : 'אישור פתיחת ליד',
    lines: [
      `${kind.icon} ${kind.label}${lead.city ? ' · ' + lead.city : ''}`,
      'פתיחת הליד חושפת את השם המלא ואת מספר הטלפון של הפונה, ומשייכת אותו אליך.',
      cost.note || '',
    ].filter(Boolean),
    price: cost.price,
    confirmLabel: cost.price > 0 ? `אישור רכישה וחיוב ${shekel(cost.price)}` : 'פתיחת הליד',
  });
  if (!approved) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'פותח…';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(CLAIM_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ lead_id: lead.id }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const errorMessages = {
        exclusive_to_another_agent: 'הליד עדיין בבלעדיות לסוכן אחר',
        insufficient_balance: `יתרה לא מספיקה — נדרש ₪${data.required}. טענו קרדיט ונסו שוב`,
        free_tier_not_eligible_owner_lead: 'לידי בעל-נכס אינם זמינים במסלול Pay&GO',
        lead_already_claimed_by_someone_else: 'הליד כבר נתפס',
        already_unlocked: 'הליד כבר פתוח',
      };
      showToast(errorMessages[data.error] || ('שגיאה: ' + (data.error || 'לא ידועה')));
      btn.disabled = false; btn.textContent = original;
      return;
    }
    showToast(data.price_charged > 0 ? `הליד נפתח! חויבת ₪${data.price_charged}` : 'הליד נפתח בהצלחה, ללא עלות');
    await loadDashboard();
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת - נסו שוב');
    btn.disabled = false; btn.textContent = original;
  }
}

/* ---------- CMA report (2.3) ----------
   כל החישוב (רדיוס מתרחב, מחיר למ"ר, השוואות) נעשה בפונקציית cma_report
   ב-DB, שם גם ה-gating ל-mid/premium - כדי שלא יהיה מסלול לעקוף אותו מהלקוח.
   כאן רק התצוגה: עמוד ממותג שהסוכן מדפיס/שומר כ-PDF מהדפדפן.            */
/* ‏esc הוא שם מקומי היסטורי ל-escapeHtml שב-assets/esc.js. יש לו כאן
   מאות אתרי קריאה, ולכן נשאר כינוי ולא שונה שם. */
function esc(s){ return escapeHtml(s); }
/* שורת התגיות של כל כרטיס בדשבורד. פריט הוא מחרוזת (תוברח כאן), או
   ‏{text, cls} כשצריך גוון - tag-key למזהה, tag-info להדגשה, tag-warn למה
   שדורש טיפול, tag-good לחיובי - או {html} כשהתגית כבר בנויה כ-HTML.
   ‏null/undefined נופלים החוצה, כדי שהקורא יוכל לכתוב תנאים בתוך המערך. */
function tagsHtml(items){
  const inner = (items || []).filter(Boolean).map(item => {
    const t = typeof item === 'string' ? { text:item } : item;
    const body = t.html ?? esc(t.text);
    // תגית ריקה (ערך חסר בשורה) היא בועה לבנה בלי תוכן - עדיף בלעדיה
    return body ? `<span class="card-tag ${t.cls || ''}">${body}</span>` : '';
  }).join('');
  return inner ? `<div class="card-tags">${inner}</div>` : '';
}

/* כפתור פעולה בכרטיס. ‏cls בוחר את הגוון (btn-ghost ברירת מחדל, btn-gold
   לפעולה ראשית, btn-share לשת"פ), ‏act-wide מותח לרוחב מלא ברשת, ו-href
   הופך את הפעולה ל-<a> (חיוג / וואטסאפ / עמוד הנכס) בלי לשנות את המראה. */
function addCardAction(actions, opts){
  const el = document.createElement(opts.href ? 'a' : 'button');
  el.className = 'btn ' + (opts.cls || 'btn-ghost');
  el.textContent = opts.label;
  if (opts.title) el.title = opts.title;
  if (opts.href){
    el.href = opts.href;
    if (opts.blank){ el.target = '_blank'; el.rel = 'noopener noreferrer'; }
  }
  if (opts.onClick) el.addEventListener('click', ()=> opts.onClick(el));
  actions.appendChild(el);
  return el;
}

/* ---------- אייקוני הפעולות בכרטיס הנכס ----------
   קו־מתאר בלבד, על רשת 24×24, ו-‎stroke="currentColor"‎ — כך צבע האייקון
   הוא צבע האריח שהוא יושב בו, והוא דוהה יחד איתו כשהפעולה בעבודה.
   אימוג'י לא עושה אף אחד מהשלושה: הוא נראה אחרת בכל מערכת הפעלה, גודלו
   תלוי בגופן, וצבעו קבוע. */
const CARD_ICONS = {
  pencil:   '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  link:     '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  signature:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/><path d="M14 3v5h5"/><path d="M19.4 12.6a1.9 1.9 0 0 1 2.7 2.7L17 20.4l-3.4.6.6-3.4Z"/>',
  arrowUp:  '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  megaphone:'<path d="m3 11 18-5v12L3 14v-3Z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  qr:       '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3Z"/><path d="M18 18h3v3h-3Z"/>',
  chart:    '<path d="M3 3v18h18"/><path d="M7.5 16v-5"/><path d="M12 16V8"/><path d="M16.5 16v-3"/>',
  map:      '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
  sparkles: '<path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"/><path d="m18.5 15 .8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z"/>',
  film:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7.5 3v18"/><path d="M16.5 3v18"/><path d="M3 9h4.5"/><path d="M16.5 9H21"/><path d="M3 15h4.5"/><path d="M16.5 15H21"/>',
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  close:    '<path d="m18 6-12 12"/><path d="m6 6 12 12"/>',
  // ממלא את משבצת התמונה בכרטיס נכס שאין לו אף תמונה
  home:     '<path d="m3 10.5 9-7 9 7V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9.5 21v-6h5v6"/>',
  // שני אנשים = שת"פ בין משרדים; תווית = יריד הבתים הפתוחים
  partners: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  tag:      '<path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  /* שתי דרכי הקשר עם בעל/ת הנכס. בועת שיחה ולא הלוגו של וואטסאפ: הלוגו
     הוא צורה מלאה, וכל האייקונים כאן הם קו־מתאר ב-currentColor - העתק
     שלו בקו יוצא מעוות. המילה "וואטסאפ" לצידו אומרת מה זה. */
  phone:    '<path d="M6.6 3h3l1.5 4-2 1.4a12 12 0 0 0 6.5 6.5l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z"/>',
  chat:     '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.4-.7L3 21l1.8-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',
};

function cardIconSvg(name){
  return `<svg class="pc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CARD_ICONS[name] || ''}</svg>`;
}

/* אריח ברשת "פעולות מהירות" (אייקון מעל תווית) או צ'יפ בבלוק כלי ה-AI —
   אותו בונה, שתי צורות. ‏tone בוחר את הגוון הרך של האריח, ‏badge מוסיף
   תגית פינה ("חינם" / מחיר).

   התווית יושבת ב-<span class="pc-label"> ולא ישירות באלמנט, כי לצידה יש
   אייקון. מי שמחליף תווית לזמן פעולה חייב ללכת דרך setActionLabel — ראו
   שם את ההסבר. */
function buildCardTile(opts, kind){
  const el = document.createElement(opts.href ? 'a' : 'button');
  if (!opts.href) el.type = 'button';
  el.className = kind + (opts.tone ? ' pc-' + opts.tone : '');
  el.innerHTML = cardIconSvg(opts.icon)
    + `<span class="pc-label">${escapeHtml(opts.label)}</span>`
    + (opts.badge ? `<span class="pc-badge${opts.badgeFree ? ' pc-badge-free' : ''}">${escapeHtml(opts.badge)}</span>` : '');
  if (opts.title) el.title = opts.title;
  if (opts.href){
    el.href = opts.href;
    if (opts.blank){ el.target = '_blank'; el.rel = 'noopener noreferrer'; }
  }
  if (opts.onClick) el.addEventListener('click', ()=> opts.onClick(el));
  return el;
}

function addQuickAction(grid, opts){
  const el = buildCardTile(opts, 'pc-tile');
  grid.appendChild(el);
  return el;
}

function addHubAction(row, opts){
  const el = buildCardTile(opts, 'pc-chip');
  row.appendChild(el);
  return el;
}

/* ---------- תווית של כפתור פעולה שנמצא בעבודה ----------
   כל פעולה ארוכה בכרטיס מחליפה את התווית ל"מקפיץ…" ומחזירה אותה בסוף.
   באריח או בצ'יפ התווית היא <span> שיושב לצד אייקון SVG, ולכן
   ‎btn.textContent = '…'‎ היה מוחק את האייקון — ולא מחזיר אותו, כי מה
   שנשמר כ-original הוא הטקסט בלבד. שתי הפונקציות האלה נוגעות בתווית
   ולא באלמנט, ועובדות גם על כפתור טקסט רגיל שאין בו pc-label. */
function actionLabel(btn){
  if (!btn) return '';
  const slot = btn.querySelector('.pc-label');
  return slot ? slot.textContent : btn.textContent;
}

function setActionLabel(btn, text){
  if (!btn) return;
  const slot = btn.querySelector('.pc-label');
  if (slot) slot.textContent = text; else btn.textContent = text;
}

const shekel = n => (n === null || n === undefined) ? '-' : '₪' + Number(n).toLocaleString('he-IL');
const hebDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '-';

const hebDateTime = ts => ts ? new Date(ts).toLocaleString('he-IL',
  { day:'numeric', month:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';

/* זמן שנותר עד חותמת זמן. הקידום נמכר לחלון של 72 שעות, ולכן הספירה
   בשעות ובדקות — "נותרו 3 ימים" לא אומר לסוכן/ת מתי בדיוק זה נגמר.
   ‏קידומים היסטוריים (חלון של 30 יום) עדיין מוצגים בימים.             */
function msLeft(ts){
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t - Date.now();
}

function timeLeftLabel(ts){
  const ms = msLeft(ts);
  if (ms === null) return '';
  if (ms <= 0) return 'הסתיים';
  const minutes = Math.round(ms / 60000);
  if (minutes < 2)  return 'נותרה פחות מדקה';
  if (minutes < 60) return plural(minutes, 'נותרה דקה אחת', 'דקות', 'נותרו ' + minutes);
  const hours = Math.floor(minutes / 60);
  if (hours === 1)  return 'נותרה שעה';
  if (hours <= 72)  return plural(hours, 'נותרה שעה אחת', 'שעות', 'נותרו ' + hours);
  const days = Math.round(hours / 24);
  return plural(days, 'נותר יום אחד', 'ימים', 'נותרו ' + days);
}

/* ---------- Lead shelf: רכישת לידי RSS ----------
   המדף עצמו נקרא מ-rss_leads_public — ה-view השיווקי, בלי source_url ובלי
   הטקסט הגולמי. הרכישה עוברת ב-Edge Function ‏rss-lead-purchase (ולא ב-rpc
   ישיר), כי הטריגר protect_sensitive_agency_member_fields מבטל שינוי
   credit_balance שלא הגיע מ-service_role — חיוב מהדפדפן היה נבלע בשקט.
   אחרי הרכישה השורה המלאה נקראת ישירות מ-rss_leads: ה-policy
   "buyer reads purchased rss lead" מחזירה אותה לקונה בלבד.                */
/* ---------- חנות הלידים: המגירות והמונה המשותף ----------
   שלושת המדפים חולקים קטגוריה אחת, ולכן גם מונה אחד: מה שנספר בכותרת הוא
   כמה לידים אפשר לקנות עכשיו בחנות כולה, וההפרדה לפי מלאי חיה בכפתורי
   המגירות. מגירת המשכנתאות נפתחת רק ליועצ/ת משכנתאות — הבדיקה האמיתית
   יושבת ב-purchase_mortgage_lead, וזו כאן היא נוחות בלבד.                */
let shelfTab = 'rss';
let shelfMortgageOpen = false;

/* מצב הפתיחה של שש רשימות החנות — מדף ורכישות לכל מגירה. סט נפרד לכל
   רשימה ולא סט אחד משותף: ליד שנרכש שומר את אותו `id` גם במדף וגם ברשימת
   הרכישות, וסט משותף היה פותח לבד את הכרטיס השני. */
const shelfExpanded = {
  rss: new Set(),      rssBought: new Set(),
  saved: new Set(),    savedBought: new Set(),
  mortgage: new Set(), mortgageBought: new Set(),
};

function renderShelfTabs(){
  document.querySelectorAll('#shelfTabs [data-shelf-tab]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.shelfTab === shelfTab)));
  document.querySelectorAll('[data-shelf-pane]').forEach(pane =>
    pane.hidden = pane.dataset.shelfPane !== shelfTab);
}

function setShelfTab(tab){
  if (tab === 'mortgage' && !shelfMortgageOpen) return;
  shelfTab = tab;
  renderShelfTabs();
}

// נקרא מ-loadDashboard בשני הכיוונים, כדי שהסרת הדגל תסגור את המגירה בלי
// לרענן את העמוד — בדיוק כמו managerSection
function setShelfMortgageVisible(open){
  shelfMortgageOpen = !!open;
  const btn = document.querySelector('#shelfTabs [data-shelf-tab="mortgage"]');
  if (btn) btn.hidden = !shelfMortgageOpen;
  if (!shelfMortgageOpen && shelfTab === 'mortgage') shelfTab = 'rss';
  renderShelfTabs();
  refreshShelfCounts();
}

/* המונה של הקטגוריה והמונים שעל המגירות נכתבים ממקום אחד, כדי שלא ייווצר
   מצב שבו הכותרת אומרת 12 והמגירות מסתכמות ל-9. */
function refreshShelfCounts(){
  const rss      = shelfLeads.length;
  const saved    = savedSearchLeads.length;
  const mortgage = shelfMortgageOpen ? mortgageShelfLeads.length : 0;
  const setText = (id, n)=>{ const el = document.getElementById(id); if (el) el.textContent = n; };
  setText('shelfTabRssCount', rss);
  setText('shelfTabSavedCount', saved);
  setText('shelfTabMortgageCount', mortgage);

  const total = rss + saved + mortgage;
  accSetCount('accLeadShelf', total ? total + ' זמינים' : '');
  // מה שקובע אם שווה לפתוח את החנות היום: כמה יש, ובכמה
  accSetSummary('accLeadShelf', total
    ? [topValue(shelfLeads.map(l => l.city)), shekel(rssLeadPrice) + ' לליד']
        .filter(Boolean).join(' · ')
    : '');
}

document.getElementById('shelfTabs').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-shelf-tab]');
  if (btn) setShelfTab(btn.dataset.shelfTab);
});

let rssLeadPrice = 50;
let shelfLeads = [];

async function loadLeadShelf(agentId){
  const listEl = document.getElementById('leadShelfList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data: leads, error } = await sb
    .from('rss_leads_public')
    .select('*')
    .eq('status', 'new')
    .order('lead_quality_score', { ascending:false, nullsFirst:false })
    .order('created_at', { ascending:false })
    .limit(60);

  rssLeadPrice = priceOf('rss_lead_price', 50);
  document.getElementById('shelfPriceLabel').textContent = shekel(rssLeadPrice);

  if (error){
    // הטבלאות נוצרות ב-schema.sql + מיגרציית הרכישה; עד שהן קיימות אין טעם להבהיל
    const missing = /does not exist|schema cache/i.test(error.message || '');
    listEl.innerHTML = '<div class="empty-state">' +
      (missing ? 'מדף המוכרים והקונים לא הופעל עדיין בפרויקט הזה.' : 'שגיאה בטעינת המדף: ' + esc(error.message)) +
      '</div>';
    shelfLeads = [];
    refreshShelfCounts();
    return;
  }

  shelfLeads = leads || [];
  refreshShelfCounts();
  syncShelfCityFilter();
  renderLeadShelf();
  await loadPurchasedLeads(agentId);
}

// רשימת הערים נבנית מהמדף עצמו — אין רשימה קבועה, הפידים מביאים מה שהם מביאים
function syncShelfCityFilter(){
  const select = document.getElementById('shelfCityFilter');
  const previous = select.value;
  const cities = [...new Set(shelfLeads.map(l => l.city).filter(Boolean))].sort((a,b)=> a.localeCompare(b,'he'));
  select.innerHTML = '<option value="">כל הערים</option>' +
    cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (cities.includes(previous)) select.value = previous;
}

function renderLeadShelf(){
  const listEl = document.getElementById('leadShelfList');
  const side = document.getElementById('shelfSideFilter').value;
  const city = document.getElementById('shelfCityFilter').value;
  const filtered = shelfLeads.filter(l =>
    (!side || l.lead_side === side) && (!city || l.city === city));

  if (filtered.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (shelfLeads.length === 0
        ? 'אין כרגע לידים פנויים בחנות.<br>המנוע סורק את המקורות כל 30 דקות.'
        : 'אין לידים שמתאימים לסינון הנוכחי.') +
      '</div>';
    return;
  }

  // הרשימה היא טאבים, כמו כל רשימה אחרת בדשבורד — ראו buildTabRow()
  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  filtered.forEach(lead => {
    const kind = shelfKind(lead.lead_side);
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'shelfRss', expanded: shelfExpanded.rss,
      cls: 'lead-tab ' + kind.cls,
      icon: kind.icon,
      title: lead.teaser_title || lead.lead_side || 'ליד',
      sub: shelfTabSub(lead),
      // ציון האיכות הוא השיקול הראשון ברכישה, ולכן הוא הגלולה שבשורה
      pill: scorePill(lead.lead_quality_score, 10, 8),
      price: shekel(rssLeadPrice),
      buildCard: ()=> buildShelfLeadCard(lead),
    }));
  });
}

/* מה שצריך כדי להחליט אם לפתוח את הכרטיס: דחיפות, איפה, איזה נכס ומתי.
   שאר פרטי המדף (חדרים, קומה, תקציב) ממתינים בתגיות שבכרטיס. */
function shelfTabSub(lead){
  return [
    lead.urgency_level ? 'דחיפות ' + lead.urgency_level : null,
    lead.city,
    lead.property_type,
    tabShortDate(lead.created_at),
  ].filter(Boolean).join(' · ');
}

/* ציון בגלולה של השורה, באותם צבעים של ציוני ההתאמה: ירוק למה שחוצה את
   הרף, זהב לשאר. ציון חסר אינו גלולה ריקה אלא אין-גלולה — שורה שאומרת
   "—/10" רק גוזלת מקום מהכותרת. */
function scorePill(score, outOf, highAt){
  if (score === null || score === undefined || score === '') return null;
  return { text: `⭐ ${score}/${outOf}`,
           cls: 'score-pill ' + (Number(score) >= highAt ? 'score-high' : 'score-mid') };
}

function buildShelfLeadCard(lead){
  const kind = shelfKind(lead.lead_side);
  const el = document.createElement('div');
  el.className = 'card lead-card ' + kind.cls;
  el.innerHTML = `
    <div class="lead-top">
      <div>
        <span class="lead-kind">${kind.icon} ${esc(kind.label)}</span>
        <div class="lead-name">${esc(lead.teaser_title || lead.lead_side || 'ליד')}</div>
      </div>
      <span class="status-pill status-masked">${shekel(rssLeadPrice)}</span>
    </div>
    ${tagsHtml([
      // ציון האיכות הוא השיקול הראשון ברכישה - ולכן הוא התגית הפותחת
      { text:`⭐ איכות ${lead.lead_quality_score ?? '-'}/10`,
        cls: lead.lead_quality_score >= 8 ? 'tag-good' : 'tag-key' },
      lead.urgency_level && { text:'⚡ דחיפות ' + lead.urgency_level, cls:'tag-info' },
      ...shelfMetaParts(lead),
      { text:'📅 נוסף ' + hebDate(lead.created_at) },
    ])}
    ${lead.teaser_description ? `<div class="lead-meta">${esc(lead.teaser_description)}</div>` : ''}
    <div class="lead-actions"></div>
  `;
  addCardAction(el.querySelector('.lead-actions'), {
    label:`🛒 רכישה · ${shekel(rssLeadPrice)}`, cls:'btn-gold act-wide',
    onClick: btn => buyRssLead(lead, btn),
  });
  return el;
}

// טקסט גולמי - הדיאלוג מבריח בעצמו, ובכרטיס tagsHtml מבריח כל תגית
function shelfMetaParts(lead){
  return [
    lead.city && '📍 ' + lead.city,
    lead.neighborhood,
    lead.property_type && '🏠 ' + lead.property_type,
    lead.rooms ? '🛏 ' + plural(lead.rooms, 'חדר אחד', 'חדרים') : null,
    lead.floor != null ? '🏢 קומה ' + lead.floor : null,
    lead.price_budget ? '💰 ' + shekel(lead.price_budget) : null,
  ].filter(Boolean);
}

async function loadPurchasedLeads(agentId){
  const listEl = document.getElementById('purchasedLeadsList');
  const { data: leads, error } = await sb
    .from('rss_leads')
    .select('id, source_url, source_name, raw_title, raw_content, lead_side, city, neighborhood, property_type, rooms, floor, price_budget, urgency_level, lead_quality_score, teaser_title, sold_at')
    .eq('sold_to_agent_id', agentId)
    .order('sold_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת הלידים שנרכשו: ' + esc(error.message) + '</div>';
    return;
  }
  if (!leads || leads.length === 0){
    listEl.innerHTML = '<div class="empty-state">עוד לא רכשת לידים מהחנות.</div>';
    return;
  }

  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  leads.forEach(lead => {
    const kind = shelfKind(lead.lead_side);
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'boughtRss', expanded: shelfExpanded.rssBought,
      cls: 'lead-tab ' + kind.cls,
      icon: kind.icon,
      title: lead.teaser_title || lead.raw_title || lead.lead_side || 'ליד',
      sub: [lead.city, lead.property_type, lead.source_name].filter(Boolean).join(' · '),
      pill: { text:'נרכש ' + tabShortDate(lead.sold_at), cls:'status-pill status-unlocked' },
      buildCard: ()=> buildPurchasedLeadCard(lead, kind),
    }));
  });
}

function buildPurchasedLeadCard(lead, kind){
  const el = document.createElement('div');
  el.className = 'card lead-card ' + kind.cls;
  el.innerHTML = `
    <div class="lead-top">
      <div>
        <span class="lead-kind">${kind.icon} ${esc(kind.label)}</span>
        <div class="lead-name">${esc(lead.teaser_title || lead.raw_title || lead.lead_side || 'ליד')}</div>
      </div>
      <span class="status-pill status-unlocked">נרכש ${hebDate(lead.sold_at)}</span>
    </div>
    ${tagsHtml([
      ...shelfMetaParts(lead),
      lead.source_name && { text:'🔗 ' + lead.source_name, cls:'tag-info' },
    ])}
    ${lead.raw_content ? `<div class="lead-meta" style="white-space:pre-wrap">${esc(lead.raw_content.slice(0, 600))}${lead.raw_content.length > 600 ? '…' : ''}</div>` : ''}
    <div class="lead-actions">
      <a class="btn btn-gold act-wide" href="${esc(lead.source_url)}" target="_blank" rel="noopener noreferrer">🔗 פתיחת הפוסט המקורי</a>
    </div>
  `;
  return el;
}

async function buyRssLead(lead, btn){
  const kind = shelfKind(lead.lead_side);
  const approved = await confirmPurchase({
    title: 'אישור רכישת ליד',
    lines: [
      `${kind.icon} ${kind.label}`,
      lead.teaser_title || 'ליד מחנות הלידים',
      shelfMetaParts(lead).join(' · '),
      'הרכישה חושפת את הפוסט המקורי ואת פרטי הפונה, ומשייכת את הליד אליך בלבד.',
    ].filter(Boolean),
    price: rssLeadPrice,
  });
  if (!approved) return;

  const leadId = lead.id;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'רוכש…';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/rss-lead-purchase', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ lead_id: leadId }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const errorMessages = {
        insufficient_balance: `יתרה לא מספיקה — נדרש ${shekel(data.required)}. טענו את הארנק ונסו שוב`,
        lead_already_sold: 'הליד כבר נמכר לסוכן/ת אחר/ת',
        lead_not_available: 'הליד כבר לא זמין למכירה',
        lead_not_found: 'הליד לא נמצא',
        agent_inactive: 'החשבון אינו פעיל',
        no_matching_agent_profile: 'שגיאת הרשאה - אין פרופיל סוכן/ת מקושר',
      };
      showToast(errorMessages[data.error] || ('שגיאה: ' + (data.error || 'לא ידועה')));
      btn.disabled = false; btn.textContent = original;
      return;
    }
    showToast(data.already_purchased
      ? 'הליד כבר שלך - מופיע למטה תחת "הלידים שרכשתי"'
      : `הליד נרכש! חויבת ${shekel(data.price_charged)}. הפוסט המקורי מופיע תחת "הלידים שרכשתי"`);
    shelfExpanded.rss.delete(leadId);   // הליד ירד מהמדף - ראו shelfExpanded
    await loadDashboard();
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת - נסו שוב');
    btn.disabled = false; btn.textContent = original;
  }
}

document.getElementById('shelfSideFilter').addEventListener('change', renderLeadShelf);
document.getElementById('shelfCityFilter').addEventListener('change', renderLeadShelf);
document.getElementById('shelfRefreshBtn').addEventListener('click', ()=> {
  if (currentAgent) loadLeadShelf(currentAgent.id);
});

/* ---------- Mortgage lead shelf: רכישת לידי ייעוץ משכנתאות ----------
   אותה מכונה בדיוק כמו מדף ה-RSS למעלה, על מלאי אחר: הפניות שהושארו בטופס
   של מחשבון המשכנתא בדף הבית. המדף נקרא מ-mortgage_leads_public - נתוני
   המחשבון בלבד, בלי שם/טלפון/אימייל - והרכישה עוברת ב-Edge Function
   mortgage-lead-purchase, כי גם כאן הטריגר protect_sensitive_agency_member_fields
   מבטל שינוי credit_balance שלא הגיע מ-service_role.

   הסקציה מוצגת רק ל-is_mortgage_advisor, וגם purchase_mortgage_lead עצמה
   מסרבת לקונה שאינו מסומן כך - ה-gating בתצוגה הוא נוחות, לא הגנה.      */
let mortgageLeadPrice = 50;
let mortgageShelfLeads = [];

async function loadMortgageShelf(agentId){
  const listEl = document.getElementById('mortgageShelfList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data: leads, error } = await sb
    .from('mortgage_leads_public')
    .select('*')
    .eq('status', 'new')
    .order('created_at', { ascending:false })
    .limit(60);

  mortgageLeadPrice = priceOf('mortgage_lead_price', 50);
  document.getElementById('mortgageShelfPriceLabel').textContent = shekel(mortgageLeadPrice);

  if (error){
    const missing = /does not exist|schema cache/i.test(error.message || '');
    listEl.innerHTML = '<div class="empty-state">' +
      (missing ? 'מדף לידי המשכנתאות לא הופעל עדיין בפרויקט הזה.' : 'שגיאה בטעינת המדף: ' + esc(error.message)) +
      '</div>';
    mortgageShelfLeads = [];
    refreshShelfCounts();
    return;
  }

  mortgageShelfLeads = leads || [];
  refreshShelfCounts();
  await loadMortgageLeadProperties(mortgageShelfLeads);
  renderMortgageShelf();
  await loadPurchasedMortgageLeads(agentId);
}

/* הנכס שממנו נולד הליד. ‏mortgage_leads_public מחזירה property_id בלבד, ולכן
   הכותרות נמשכות בשאילתה אחת מרוכזת אחרי טעינת המדף - ‏properties פתוחה
   לקריאה למודעות פעילות, וליד עם נכס מוגדר שווה ליועצ/ת אחרת מליד כללי. */
// המפה נצברת ולא מוחלפת: היא מתמלאת פעם מהמדף ופעם מהלידים שנרכשו, ואיפוס
// בקריאה השנייה היה מרוקן את הכותרות של המדף בכל סינון מחדש.
let mortgagePropertyTitles = {};

async function loadMortgageLeadProperties(leads){
  const ids = [...new Set(leads.map(l => l.property_id)
    .filter(id => id && !mortgagePropertyTitles[id]))];
  if (ids.length === 0) return;
  const { data } = await sb.from('properties').select('id, title, city, price').in('id', ids);
  (data||[]).forEach(p => { mortgagePropertyTitles[p.id] = p; });
}

/* ‏Text הוא טקסט גולמי (לדיאלוג, שמבריח בעצמו), Line הוא HTML מוברח לכרטיס */
function mortgageSourceText(lead){
  const prop = lead.property_id ? mortgagePropertyTitles[lead.property_id] : null;
  if (prop) return `מנכס: ${prop.title || 'מודעה'}${prop.city ? ' · ' + prop.city : ''}`;
  if (lead.property_id) return 'מנכס שהוסר מהאתר';
  return 'ממחשבון דף הבית';
}
function mortgageSourceLine(lead){
  const icon = lead.property_id ? '🏠' : '🧮';
  return icon + ' ' + esc(mortgageSourceText(lead));
}

// מה שיועצ/ת צריכ/ה כדי להחליט אם הליד שווה ₪50, בלי לחשוף מי הפונה
function mortgageMetaParts(lead){
  return [
    lead.property_price ? 'נכס ' + shekel(lead.property_price) : null,
    lead.equity != null ? 'הון עצמי ' + shekel(lead.equity) : null,
    lead.ltv_pct != null ? Math.round(lead.ltv_pct) + '% מימון' : null,
    lead.years ? plural(lead.years, 'שנה אחת', 'שנים') : null,
    lead.interest_rate != null ? 'ריבית ' + lead.interest_rate + '%' : null,
  ].filter(Boolean);
}

// הסימון "יש ברשותי דירה" הוא ההבדל המקצועי המרכזי בליד: דירה יחידה מול
// משפר/ת דיור או משקיע/ה - שתי תקרות מימון שונות לגמרי.
function mortgageKind(lead){
  return lead.owns_property
    ? { cls:'kind-owner', icon:'🏘️', label:'יש דירה בבעלות · משפר/ת דיור או משקיע/ה' }
    : { cls:'kind-buyer', icon:'🔑', label:'דירה יחידה' };
}

function renderMortgageShelf(){
  const listEl = document.getElementById('mortgageShelfList');
  const owns = document.getElementById('mortgageOwnsFilter').value;
  const filtered = mortgageShelfLeads.filter(l =>
    !owns || (owns === 'yes' ? l.owns_property === true : l.owns_property !== true));

  if (filtered.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (mortgageShelfLeads.length === 0
        ? 'אין כרגע לידי משכנתאות פנויים בחנות.<br>לידים חדשים נכנסים מטופס מחשבון המשכנתא בדף הבית.'
        : 'אין לידים שמתאימים לסינון הנוכחי.') +
      '</div>';
    return;
  }

  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  filtered.forEach(lead => {
    const kind = mortgageKind(lead);
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'shelfMortgage', expanded: shelfExpanded.mortgage,
      cls: 'lead-tab ' + kind.cls,
      icon: kind.icon,
      // ההחזר החודשי הוא מה שמזהה ליד משכנתא בלי לחשוף מי הפונה
      title: 'החזר חודשי ' + shekel(lead.monthly_payment),
      sub: mortgageTabSub(lead),
      price: shekel(mortgageLeadPrice),
      buildCard: ()=> buildMortgageShelfCard(lead),
    }));
  });
}

/* שורת המשנה של ליד משכנתא: גודל העסקה, ההון העצמי ואחוז המימון - שלוש
   השאלות שקובעות אם הליד רלוונטי ליועצ/ת. השנים והריבית הן ההנחות שהפונה
   הזין/ה במחשבון, והן ממתינות בתגיות שבכרטיס. הסכומים מקוצרים
   (`shekelCompact`), כי שלושה סכומים מלאים בשורה אחת אינם נכנסים לטלפון. */
function mortgageTabSub(lead){
  // אחוז המימון לפני ההון העצמי: הוא הקצר מבין השניים והמכריע מביניהם,
  // ובשורה שנחתכת בקצה עדיף שמה שיישאר יהיה הוא
  return [
    lead.property_price ? 'נכס ' + shekelCompact(lead.property_price) : null,
    lead.ltv_pct != null ? Math.round(lead.ltv_pct) + '% מימון' : null,
    lead.equity != null ? 'הון עצמי ' + shekelCompact(lead.equity) : null,
    tabShortDate(lead.created_at),
  ].filter(Boolean).join(' · ');
}

function buildMortgageShelfCard(lead){
  const kind = mortgageKind(lead);
  const el = document.createElement('div');
  el.className = 'card lead-card ' + kind.cls;
  el.innerHTML = `
    <div class="lead-top">
      <div>
        <span class="lead-kind">${kind.icon} ${esc(kind.label)}</span>
        <div class="lead-name">החזר חודשי מבוקש ${shekel(lead.monthly_payment)}</div>
      </div>
      <span class="status-pill status-masked">${shekel(mortgageLeadPrice)}</span>
    </div>
    ${tagsHtml([
      ...mortgageMetaParts(lead),
      { text: lead.has_email ? '📇 שם, טלפון ואימייל' : '📇 שם וטלפון', cls:'tag-info' },
      { text:'📅 נוסף ' + hebDate(lead.created_at) },
    ])}
    <div class="lead-meta">${mortgageSourceLine(lead)}</div>
    <div class="lead-actions"></div>
  `;
  addCardAction(el.querySelector('.lead-actions'), {
    label:`🛒 רכישה · ${shekel(mortgageLeadPrice)}`, cls:'btn-gold act-wide',
    onClick: btn => buyMortgageLead(lead, btn),
  });
  return el;
}

async function loadPurchasedMortgageLeads(agentId){
  const listEl = document.getElementById('purchasedMortgageList');
  const { data: leads, error } = await sb
    .from('mortgage_leads')
    .select('id, full_name, phone, email, owns_property, property_price, equity, loan_amount, interest_rate, years, monthly_payment, ltv_pct, property_id, source, sold_at')
    .eq('sold_to_agent_id', agentId)
    .order('sold_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת הלידים שנרכשו: ' + esc(error.message) + '</div>';
    return;
  }
  if (!leads || leads.length === 0){
    listEl.innerHTML = '<div class="empty-state">עוד לא רכשת לידים מהחנות.</div>';
    return;
  }

  // הכותרות של הנכסים בלידים שנרכשו לא בהכרח נטענו במדף (ליד שנמכר יורד ממנו)
  await loadMortgageLeadProperties(leads);

  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  leads.forEach(lead => {
    const kind = mortgageKind(lead);
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'boughtMortgage', expanded: shelfExpanded.mortgageBought,
      cls: 'lead-tab ' + kind.cls,
      icon: kind.icon,
      title: lead.full_name,
      sub: ['החזר ' + shekel(lead.monthly_payment),
            lead.loan_amount != null ? 'הלוואה ' + shekelCompact(lead.loan_amount) : null,
            mortgageSourceText(lead)].filter(Boolean).join(' · '),
      pill: { text:'נרכש ' + tabShortDate(lead.sold_at), cls:'status-pill status-unlocked' },
      buildCard: ()=> buildPurchasedMortgageCard(lead),
    }));
  });
}

function buildPurchasedMortgageCard(lead){
  const kind = mortgageKind(lead);
  const el = document.createElement('div');
  el.className = 'card lead-card ' + kind.cls;
  // ‏wa.me דורש מספר בינלאומי בלי + ובלי האפס המוביל
  const waDigits = String(lead.phone).replace(/\D/g, '').replace(/^0/, '972');
  el.innerHTML = `
      <div class="lead-top">
        <div>
          <span class="lead-kind">${kind.icon} ${esc(kind.label)}</span>
          <div class="lead-name">${esc(lead.full_name)}</div>
        </div>
        <span class="status-pill status-unlocked">נרכש ${hebDate(lead.sold_at)}</span>
      </div>
      ${tagsHtml([
        { text:`💳 החזר חודשי ${shekel(lead.monthly_payment)}`, cls:'tag-key' },
        lead.loan_amount != null && { text:'🏦 הלוואה ' + shekel(lead.loan_amount) },
        ...mortgageMetaParts(lead),
      ])}
      <div class="lead-meta">${mortgageSourceLine(lead)}</div>
      <div class="lead-actions">
        <a class="btn btn-gold" href="tel:${esc(lead.phone)}">📞 ${esc(lead.phone)}</a>
        <a class="btn btn-ghost" href="https://wa.me/${esc(waDigits)}" target="_blank" rel="noopener noreferrer">💬 וואטסאפ</a>
        ${lead.email ? `<a class="btn btn-ghost" href="mailto:${esc(lead.email)}">✉️ אימייל</a>` : ''}
        ${lead.property_id && mortgagePropertyTitles[lead.property_id]
          ? `<a class="btn btn-ghost" href="property.html?id=${esc(lead.property_id)}" target="_blank" rel="noopener noreferrer">🏠 הנכס</a>` : ''}
      </div>
    `;
  return el;
}

async function buyMortgageLead(lead, btn){
  const kind = mortgageKind(lead);
  const approved = await confirmPurchase({
    title: 'אישור רכישת ליד משכנתאות',
    lines: [
      `${kind.icon} ${kind.label}`,
      mortgageSourceText(lead),
      `החזר חודשי מבוקש ${shekel(lead.monthly_payment)}`,
      mortgageMetaParts(lead).join(' · '),
      `הרכישה חושפת שם, טלפון${lead.has_email ? ' ואימייל' : ''}, ומשייכת את הליד אליך בלבד.`,
    ].filter(Boolean),
    price: mortgageLeadPrice,
  });
  if (!approved) return;

  const leadId = lead.id;
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'רוכש…';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/mortgage-lead-purchase', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ lead_id: leadId }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const errorMessages = {
        insufficient_balance: `יתרה לא מספיקה — נדרש ${shekel(data.required)}. טענו את הארנק ונסו שוב`,
        lead_already_sold: 'הליד כבר נמכר ליועצ/ת אחר/ת',
        lead_not_available: 'הליד כבר לא זמין למכירה',
        lead_not_found: 'הליד לא נמצא',
        agent_inactive: 'החשבון אינו פעיל',
        not_a_mortgage_advisor: 'החשבון אינו מסומן כיועצ/ת משכנתאות - פנו למנהל/ת הפלטפורמה',
        no_matching_agent_profile: 'שגיאת הרשאה - אין פרופיל מקושר',
      };
      showToast(errorMessages[data.error] || ('שגיאה: ' + (data.error || 'לא ידועה')));
      btn.disabled = false; btn.textContent = original;
      return;
    }
    showToast(data.already_purchased
      ? 'הליד כבר שלך - מופיע למטה תחת "הלידים שרכשתי"'
      : `הליד נרכש! חויבת ${shekel(data.price_charged)}. פרטי הקשר מופיעים תחת "הלידים שרכשתי"`);
    shelfExpanded.mortgage.delete(leadId);
    await loadDashboard();
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת - נסו שוב');
    btn.disabled = false; btn.textContent = original;
  }
}

document.getElementById('mortgageOwnsFilter').addEventListener('change', renderMortgageShelf);
document.getElementById('mortgageShelfRefreshBtn').addEventListener('click', ()=> {
  if (currentAgent) loadMortgageShelf(currentAgent.id);
});

/* ---------- מדף מחפשי הדירה: לידי הסוכן החכם ----------
   אותה מכונה כמו שני המדפים שמעל, על מלאי שהוא שונה מהם באופיו: כאן הפונה
   לא מילא/ה טופס פנייה אלא הגדיר/ה חיפוש מתמשך - תקציב, אזור ומספר חדרים -
   וקיבל/ה עליו התראות. לכן יש כאן שני דברים שאין באף מדף אחר:

     • ‏intent_score - ציון התעניינות שדועך בזמן ועולה עם כל קליק על התראה.
       ‏מי שלחץ/ה על שלושה נכסים בשבוע האחרון הוא/היא לא "פנייה", אלא
       מישהו/י שמחפש/ת עכשיו.
     • הפעילות שנחשפת אחרי הרכישה - אילו נכסים נשלחו ומה מתוכם נלחץ. זו
       שיחת הפתיחה שהסוכן/ת שילמ/ה עליה.

   המדף נקרא מ-saved_search_leads_public - קריטריונים וציון בלבד, בלי שם,
   טלפון או אימייל - והרכישה עוברת ב-Edge Function saved-search-lead-purchase,
   כי גם כאן הטריגר protect_sensitive_agency_member_fields מבטל שינוי
   ‏credit_balance שלא הגיע מ-service_role.                                  */
let savedSearchPrice = 50;
let savedSearchLeads = [];
let savedSearchHoods = new Map();   // מזהה שכונה → שם

const SS_DEAL_LABELS = { sale:'מחפש/ת לקנייה', rent:'מחפש/ת לשכירות' };

async function loadSavedSearchHoods(){
  if (savedSearchHoods.size) return;
  const { data } = await sb.from('neighborhoods').select('id, name');
  (data || []).forEach(n => savedSearchHoods.set(n.id, n.name));
}

async function loadSavedSearchShelf(agentId){
  const listEl = document.getElementById('savedSearchShelfList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data: leads, error } = await sb
    .from('saved_search_leads_public')
    .select('*')
    .eq('lead_status', 'new')
    .order('intent_score', { ascending:false, nullsFirst:false })
    .order('created_at', { ascending:false })
    .limit(60);

  savedSearchPrice = priceOf('saved_search_lead_price', 50);
  document.getElementById('savedSearchPriceLabel').textContent = shekel(savedSearchPrice);

  if (error){
    // עד שהמיגרציה רצה בפרויקט אין טעם להבהיל - אותה התנהגות כמו בשני
    // המדפים שמעל
    const missing = /does not exist|schema cache/i.test(error.message || '');
    listEl.innerHTML = '<div class="empty-state">' +
      (missing ? 'מדף מחפשי הדירה לא הופעל עדיין בפרויקט הזה.' : 'שגיאה בטעינת המדף: ' + esc(error.message)) +
      '</div>';
    savedSearchLeads = [];
    refreshShelfCounts();
    return;
  }

  await loadSavedSearchHoods();
  savedSearchLeads = leads || [];
  refreshShelfCounts();
  syncSavedSearchHoodFilter();
  renderSavedSearchShelf();
  await loadPurchasedSavedSearches(agentId);
}

// רשימת האזורים נבנית מהמדף עצמו ולא מטבלת השכונות: אין טעם להציע סינון
// לאזור שאין בו אף מחפש/ת
function syncSavedSearchHoodFilter(){
  const select = document.getElementById('savedSearchHoodFilter');
  const previous = select.value;
  const ids = new Set();
  savedSearchLeads.forEach(l => (l.neighborhood_ids || []).forEach(id => ids.add(id)));
  const opts = [...ids]
    .map(id => ({ id, name: savedSearchHoods.get(id) }))
    .filter(o => o.name)
    .sort((a,b)=> a.name.localeCompare(b.name,'he'));
  select.innerHTML = '<option value="">כל האזורים</option>' +
    opts.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
  if (opts.some(o => o.id === previous)) select.value = previous;
}

/* התקציר של החיפוש. ‏label נבנה באתר בזמן השמירה ולכן הוא הניסוח של
   המחפש/ת עצמו/ה; רק כשהוא חסר בונים תחליף מהשדות. */
function savedSearchTitle(lead){
  if (lead.label) return lead.label;
  const rooms = lead.min_rooms && lead.max_rooms && lead.min_rooms !== lead.max_rooms
      ? `${lead.min_rooms}-${lead.max_rooms} חדרים`
    : lead.min_rooms ? `${plural(lead.min_rooms, 'חדר אחד', 'חדרים')} ומעלה`
    : lead.max_rooms ? `עד ${plural(lead.max_rooms, 'חדר אחד', 'חדרים')}` : null;
  const place = savedSearchPlaces(lead).join(', ');
  return [rooms || 'נכס', place ? 'ב' + place : null,
          lead.max_price ? 'עד ' + shekel(lead.max_price) : null].filter(Boolean).join(' ');
}

function savedSearchPlaces(lead){
  const hoods = (lead.neighborhood_ids || []).map(id => savedSearchHoods.get(id)).filter(Boolean);
  return hoods.length ? hoods : (lead.cities || []);
}

function savedSearchMetaParts(lead){
  const places = savedSearchPlaces(lead);
  const budget = lead.min_price && lead.max_price ? `${shekel(lead.min_price)}-${shekel(lead.max_price)}`
    : lead.max_price ? 'עד ' + shekel(lead.max_price)
    : lead.min_price ? 'מ-' + shekel(lead.min_price) : null;
  return [
    places.length ? '📍 ' + places.join(', ') : null,
    (lead.property_types || []).length ? '🏠 ' + lead.property_types.join(', ') : null,
    budget ? '💰 ' + budget : null,
    lead.min_size_sqm ? '📐 מ-' + Math.round(lead.min_size_sqm) + ' מ״ר' : null,
    (lead.required_features || []).length ? '✓ ' + lead.required_features.length + ' דרישות' : null,
  ].filter(Boolean);
}

function renderSavedSearchShelf(){
  const listEl = document.getElementById('savedSearchShelfList');
  const deal = document.getElementById('savedSearchDealFilter').value;
  const hood = document.getElementById('savedSearchHoodFilter').value;
  const filtered = savedSearchLeads.filter(l =>
    (!deal || l.deal_type === deal) &&
    (!hood || (l.neighborhood_ids || []).includes(hood)));

  if (filtered.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (savedSearchLeads.length === 0
        ? 'אין כרגע מחפשי דירה פנויים בחנות.<br>לידים נוספים נכנסים כשמבקרים באתר שומרים חיפוש.'
        : 'אין לידים שמתאימים לסינון הנוכחי.') +
      '</div>';
    return;
  }

  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  filtered.forEach(lead => {
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'shelfSaved', expanded: shelfExpanded.saved,
      cls:'lead-tab kind-buyer', icon:'🔔',
      title: savedSearchTitle(lead),
      sub: [SS_DEAL_LABELS[lead.deal_type],
            // הקליקים הם הראיה היחידה שאינה הצהרה של הפונה על עצמו/ה
            lead.alerts_clicked > 0 ? plural(lead.alerts_clicked, 'נכס אחד נפתח', 'נכסים נפתחו')
              : (lead.alerts_sent > 0 ? plural(lead.alerts_sent, 'התראה אחת נשלחה', 'התראות נשלחו') : null),
            lead.has_phone ? 'יש טלפון' : null,
            tabShortDate(lead.created_at)].filter(Boolean).join(' · '),
      // ציון ההתעניינות הוא השיקול הראשון ברכישה, ולכן הוא הגלולה שבשורה
      pill: scorePill(lead.intent_score, 100, 75),
      price: shekel(savedSearchPrice),
      buildCard: ()=> buildSavedSearchShelfCard(lead),
    }));
  });
}

function buildSavedSearchShelfCard(lead){
    const el = document.createElement('div');
    el.className = 'card lead-card kind-buyer';
    el.innerHTML = `
      <div class="lead-top">
        <div>
          <span class="lead-kind">🔔 ${esc(SS_DEAL_LABELS[lead.deal_type] || 'מחפש/ת')}</span>
          <div class="lead-name">${esc(savedSearchTitle(lead))}</div>
        </div>
        <span class="status-pill status-masked">${shekel(savedSearchPrice)}</span>
      </div>
      ${tagsHtml([
        // ציון ההתעניינות הוא השיקול הראשון ברכישה, ולכן התגית הפותחת
        { text:`⭐ התעניינות ${lead.intent_score}/100`,
          cls: lead.intent_score >= 75 ? 'tag-good' : 'tag-key' },
        // הקליקים הם הראיה היחידה שאינה הצהרה של הפונה על עצמו/ה
        lead.alerts_clicked > 0
          ? { text:`👆 ${plural(lead.alerts_clicked, 'נכס אחד נפתח', 'נכסים נפתחו')}`, cls:'tag-good' }
          : (lead.alerts_sent > 0
              ? { text:`📤 ${plural(lead.alerts_sent, 'התראה אחת נשלחה', 'התראות נשלחו')}`, cls:'tag-info' }
              : null),
        ...savedSearchMetaParts(lead),
        lead.has_phone ? '📞 יש טלפון' : null,
        { text:'📅 נשמר ' + hebDate(lead.created_at) },
      ])}
      ${lead.free_text ? `<div class="lead-meta">חיפש/ה: “${esc(lead.free_text)}”</div>` : ''}
      <div class="lead-actions"></div>
    `;
    addCardAction(el.querySelector('.lead-actions'), {
      label:`🛒 רכישה · ${shekel(savedSearchPrice)}`, cls:'btn-gold act-wide',
      onClick: btn => buySavedSearchLead(lead, btn),
    });
    return el;
}

async function loadPurchasedSavedSearches(agentId){
  const listEl = document.getElementById('purchasedSavedSearchList');
  const { data: leads, error } = await sb
    .from('saved_searches')
    .select('id, full_name, phone, email, label, deal_type, cities, neighborhood_ids, property_types, ' +
            'min_price, max_price, min_rooms, max_rooms, min_size_sqm, required_features, free_text, ' +
            'alerts_sent, alerts_clicked, status, sold_at, agency_id')
    .eq('sold_to_agent_id', agentId)
    .order('sold_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת הלידים שנרכשו: ' + esc(error.message) + '</div>';
    return;
  }
  if (!leads || leads.length === 0){
    listEl.innerHTML = '<div class="empty-state">עוד לא רכשת מחפשי דירה מהחנות, ועוד לא הגיע ליד כזה מדף המשרד.</div>';
    return;
  }

  listEl.innerHTML = '<div class="prop-tabs shelf-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  leads.forEach(lead => {
    /* ליד שהגיע מהווידג'ט בדף המשרד לא נרכש - הוא הגיע חינם, כי הדף של
       המשרד הוא שייצר אותו. הכיתוב "נרכש" עליו פשוט לא נכון. */
    const fromAgencyPage = !!lead.agency_id;
    tabsWrap.appendChild(buildTabRow({
      key: lead.id, list:'boughtSaved', expanded: shelfExpanded.savedBought,
      cls:'lead-tab kind-buyer', icon:'🔔',
      title: lead.full_name,
      sub: [savedSearchTitle(lead),
            // מי שביטל/ה את ההתראות עדיין ליד לגיטימי, אבל זו עובדה שכדאי
            // לדעת לפני שמרימים טלפון - ולכן היא נאמרת כבר בשורה
            lead.status === 'unsubscribed' ? '🔕 הפסיק/ה את ההתראות' : null,
           ].filter(Boolean).join(' · '),
      pill: { text: (fromAgencyPage ? 'מדף המשרד ' : 'נרכש ') + tabShortDate(lead.sold_at),
              cls: 'status-pill status-unlocked' },
      buildCard: ()=> buildPurchasedSavedSearchCard(lead, fromAgencyPage),
    }));
  });
}

function buildPurchasedSavedSearchCard(lead, fromAgencyPage){
    const el = document.createElement('div');
    el.className = 'card lead-card kind-buyer';
    const waPhone = (lead.phone || '').replace(/\D/g, '').replace(/^0/, '972');
    el.innerHTML = `
      <div class="lead-top">
        <div>
          <span class="lead-kind">🔔 ${esc(SS_DEAL_LABELS[lead.deal_type] || 'מחפש/ת')}</span>
          <div class="lead-name">${esc(lead.full_name)}</div>
        </div>
        <span class="status-pill status-unlocked">${fromAgencyPage ? 'מדף המשרד' : 'נרכש'} ${hebDate(lead.sold_at)}</span>
      </div>
      ${tagsHtml([
        { text:'🔎 ' + savedSearchTitle(lead), cls:'tag-key' },
        fromAgencyPage ? { text:'🏢 הגיע מדף המשרד · ללא עלות', cls:'tag-good' } : null,
        ...savedSearchMetaParts(lead),
        // מי שביטל/ה את ההתראות עדיין ליד לגיטימי, אבל זו עובדה שכדאי לדעת
        // לפני שמרימים טלפון
        lead.status === 'unsubscribed' ? { text:'🔕 הפסיק/ה את ההתראות', cls:'tag-warn' } : null,
      ])}
      ${lead.free_text ? `<div class="lead-meta">חיפש/ה: “${esc(lead.free_text)}”</div>` : ''}
      <div class="lead-meta ss-activity">טוען פעילות…</div>
      <div class="lead-actions"></div>
    `;
    const actions = el.querySelector('.lead-actions');
    if (lead.phone){
      addCardAction(actions, { label:'📞 חיוג', href:'tel:' + lead.phone });
      addCardAction(actions, { label:'💬 וואטסאפ', cls:'btn-share',
        href:'https://wa.me/' + waPhone, blank:true });
    }
    if (lead.email){
      addCardAction(actions, { label:'✉️ מייל', href:'mailto:' + lead.email });
    }
    // הכרטיס נבנה בפתיחה, ולכן גם הפעילות נטענת אז - ולא לכל הרשימה מראש
    renderSavedSearchActivity(el.querySelector('.ss-activity'), lead.id);
    return el;
}

/* הנכסים שכבר נשלחו למחפש/ת ומה מתוכם נלחץ. זו הסיבה שהליד הזה שווה יותר
   מפנייה רגילה, ולכן היא נטענת עם הכרטיס ולא מאחורי לחיצה נוספת.

   האלמנט מגיע כפרמטר ולא נשלף ב-getElementById: הכרטיס נבנה בפתיחת הטאב,
   ובשורה שנפתחת כבר מהרינדור הוא עדיין אינו בדף בזמן הקריאה. כתיבה
   לאלמנט מנותק עובדת - הוא נכנס לדף מיד אחרי. */
async function renderSavedSearchActivity(el, searchId){
  if (!el) return;
  const { data, error } = await sb.rpc('saved_search_lead_activity', { p_search_id: searchId });
  if (error || !data || data.length === 0){
    el.textContent = error ? '' : 'עוד לא נשלחו לו/ה נכסים.';
    return;
  }
  const clicked = data.filter(r => r.clicked_at);
  const lines = (clicked.length ? clicked : data).slice(0, 4).map(r =>
    `${r.clicked_at ? '👆' : '📤'} ${esc(r.title || 'נכס')}` +
    (r.price ? ' · ' + shekel(r.price) : '') +
    (r.street ? ' · ' + esc(r.street) : ''));
  el.innerHTML =
    `<b>${clicked.length ? 'נכסים שפתח/ה:' : 'נכסים שנשלחו:'}</b><br>` + lines.join('<br>');
}

async function buySavedSearchLead(lead, btn){
  const approved = await confirmPurchase({
    title: 'אישור רכישת ליד מחפש/ת דירה',
    lines: [
      SS_DEAL_LABELS[lead.deal_type] || 'מחפש/ת דירה',
      savedSearchTitle(lead),
      savedSearchMetaParts(lead).join(' · '),
      `ציון התעניינות ${lead.intent_score}/100 · ${plural(lead.alerts_clicked, 'נכס אחד נפתח', 'נכסים נפתחו')} מתוך ${plural(lead.alerts_sent, 'התראה אחת', 'התראות')}`,
      'הרכישה חושפת שם וטלפון, ואת הנכסים שנשלחו למחפש/ת, ומשייכת את הליד אליך בלבד.',
    ].filter(Boolean),
    price: savedSearchPrice,
  });
  if (!approved) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'רוכש…';
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/saved-search-lead-purchase', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ search_id: lead.id }),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const errorMessages = {
        insufficient_balance: `יתרה לא מספיקה - נדרש ${shekel(data.required)}. טענו את הארנק ונסו שוב`,
        lead_already_sold: 'הליד כבר נמכר לסוכן/ת אחר/ת',
        lead_not_available: 'הליד כבר לא זמין - ייתכן שההתראות בוטלו',
        lead_not_found: 'הליד לא נמצא',
        agent_inactive: 'החשבון אינו פעיל',
        no_matching_agent_profile: 'שגיאת הרשאה - אין פרופיל סוכן/ת מקושר',
      };
      showToast(errorMessages[data.error] || ('שגיאה: ' + (data.error || 'לא ידועה')));
      btn.disabled = false; btn.textContent = original;
      return;
    }
    showToast(data.already_purchased
      ? 'הליד כבר שלך - מופיע למטה תחת "הלידים שרכשתי"'
      : `הליד נרכש! חויבת ${shekel(data.price_charged)}. פרטי הקשר מופיעים תחת "הלידים שרכשתי"`);
    shelfExpanded.saved.delete(lead.id);
    await loadDashboard();
  } catch(err){
    console.error(err);
    showToast('שגיאת רשת - נסו שוב');
    btn.disabled = false; btn.textContent = original;
  }
}

document.getElementById('savedSearchDealFilter').addEventListener('change', renderSavedSearchShelf);
document.getElementById('savedSearchHoodFilter').addEventListener('change', renderSavedSearchShelf);
document.getElementById('savedSearchRefreshBtn').addEventListener('click', ()=> {
  if (currentAgent) loadSavedSearchShelf(currentAgent.id);
});

/* ---------- שת"פ בין משרדי תיווך ----------
   שני צדדים לאותו מנגנון:
   • רשימת השת"פ — בחירה חד-פעמית של המשרדים שאיתם משתפים פעולה. נשמרת ב-DB
     כרשימת *הסרות* (agent_share_exclusions) ולא כרשימת בחירות, ולכן משרד חדש
     שנרשם לפלטפורמה מצטרף אוטומטית ואיש לא צריך לחזור להגדרות בשבילו.
   • ההפצה — "שיתוף" בשורת הנכס קורא ל-share_property_with_partners, שמסנכרנת
     את property_shares מול הרשימה העדכנית ומתריעה למי שקיבל את הנכס עכשיו.
   הרשימה "ששותפו איתי" נקראת מה-view shared_properties_for_me, שמסנן בעצמו
   לפי המשרד של המשתמש/ת המחובר/ת — ולכן הוא לא מקבל פרמטר של מזהה.        */
let sharePartnerAgencies = [];      // כל המשרדים בפלטפורמה חוץ מהמשרד שלי
let shareExcludedIds = new Set();   // המשרדים שהוסרו מהשת"פ שלי
let sharedWithMeRows = [];
let propertyShareCounts = {};       // property_id → כמה משרדים קיבלו את הנכס
let shareFeatureReady = false;      // false כל עוד המיגרציה לא רצה בפרויקט

const missingSchema = err => /does not exist|schema cache|could not find/i.test(err?.message || '');

const shareErrorMessages = {
  agent_not_found:      'שגיאת הרשאה - אין פרופיל סוכן/ת מקושר',
  agent_without_agency: 'החשבון אינו משויך למשרד תיווך',
  property_not_found:   'הנכס לא נמצא',
  not_your_property:    'אפשר לשתף רק נכס שפורסם על ידך',
  property_not_active:  'רק נכס פעיל אפשר לפתוח לשת״פ',
};

function sharePartnerCount(){
  return sharePartnerAgencies.filter(a => !shareExcludedIds.has(a.id)).length;
}

async function loadSharePartners(agent){
  const listEl = document.getElementById('sharePartnerList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const [agenciesRes, exclusionsRes] = await Promise.all([
    sb.from('agencies').select('id, name'),
    sb.from('agent_share_exclusions').select('agency_id').eq('agent_id', agent.id),
  ]);

  if (exclusionsRes.error){
    shareFeatureReady = false;
    listEl.innerHTML = '<div class="empty-state">' +
      (missingSchema(exclusionsRes.error)
        ? 'שיתוף נכסים בין משרדים לא הופעל עדיין בפרויקט הזה.'
        : 'שגיאה בטעינת רשימת השת״פ: ' + esc(exclusionsRes.error.message)) + '</div>';
    accSetCount('accSharePartners', '');
    return;
  }
  if (agenciesRes.error){
    listEl.innerHTML = '<div class="empty-state">שגיאה בטעינת רשימת המשרדים: ' + esc(agenciesRes.error.message) + '</div>';
    return;
  }

  shareFeatureReady = true;
  sharePartnerAgencies = (agenciesRes.data || [])
    .filter(a => a.id !== agent.agency_id)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  shareExcludedIds = new Set((exclusionsRes.data || []).map(r => r.agency_id));
  renderSharePartners();
}

function renderSharePartners(){
  const listEl = document.getElementById('sharePartnerList');
  const q = document.getElementById('partnerSearch').value.trim().toLowerCase();
  const total = sharePartnerAgencies.length;
  accSetCount('accSharePartners', total ? sharePartnerCount() + ' מתוך ' + total : '');

  if (total === 0){
    listEl.innerHTML = '<div class="empty-state">אין עדיין משרד תיווך נוסף במערכת לשיתוף פעולה.</div>';
    return;
  }
  const shown = sharePartnerAgencies.filter(a => !q || String(a.name).toLowerCase().includes(q));
  if (shown.length === 0){
    listEl.innerHTML = '<div class="empty-state">אין משרד שמתאים לחיפוש.</div>';
    return;
  }

  listEl.innerHTML = '';
  shown.forEach(a => {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !shareExcludedIds.has(a.id);
    // מצב הסימון חי ב-Set ולא ב-DOM: כשהחיפוש מסנן, חלק מהתיבות לא מרונדרות
    // בכלל, וקריאה מה-DOM בזמן השמירה הייתה מוחקת את הבחירה שלהן
    cb.addEventListener('change', ()=>{
      if (cb.checked) shareExcludedIds.delete(a.id); else shareExcludedIds.add(a.id);
      accSetCount('accSharePartners', sharePartnerCount() + ' מתוך ' + total);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + a.name));
    listEl.appendChild(label);
  });
}

async function saveSharePartners(){
  if (!currentAgent) return;
  const btn = document.getElementById('savePartnersBtn');
  const feedback = document.getElementById('partnersFeedback');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שומר…';
  feedback.textContent = '';

  // סדר הפעולות מכוון: קודם מוסיפים את ההסרות ורק אחר כך מוחקים את מי שחזר
  // לשת"פ. אם השלב השני נכשל, המצב שנשאר הוא המחמיר — לא משתפים עם מי
  // שהוסר — ולא הפוך.
  const excluded = [...shareExcludedIds];
  const included = sharePartnerAgencies.map(a => a.id).filter(id => !shareExcludedIds.has(id));
  let error = null;

  if (excluded.length){
    ({ error } = await sb.from('agent_share_exclusions').upsert(
      excluded.map(id => ({ agent_id: currentAgent.id, agency_id: id })),
      { onConflict: 'agent_id,agency_id', ignoreDuplicates: true }));
  }
  if (!error && included.length){
    ({ error } = await sb.from('agent_share_exclusions')
      .delete().eq('agent_id', currentAgent.id).in('agency_id', included));
  }

  btn.disabled = false; btn.textContent = original;
  if (error){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שגיאה בשמירה: ' + error.message;
    return;
  }
  feedback.style.color = 'var(--teal)';
  feedback.textContent = 'נשמר - ' + sharePartnerCount() + ' משרדי שת״פ.';
  showToast('רשימת השת״פ עודכנה');
}

async function shareProperty(p, btn, agentId){
  if (!shareFeatureReady){
    showToast('שיתוף נכסים בין משרדים לא הופעל עדיין בפרויקט הזה');
    return;
  }
  const targets = sharePartnerCount();
  if (targets === 0){
    showToast('לא נבחרו משרדי שת״פ - בחרו משרדים בקטגוריית "משרדי שיתוף פעולה"');
    // אותה סיבה: הקטגוריה יושבת בלשונית "עוד" והכפתור בכרטיס נכס
    gotoSection('accSharePartners');
    return;
  }

  const question = p.shared_with_partners
    ? `לסנכרן מחדש את "${p.title}" מול ${targets} משרדי השת״פ שלך? משרד שהוסר מהרשימה יאבד את הגישה לנכס.`
    : `להפיץ את "${p.title}" ל-${targets} משרדי תיווך? כל סוכן/ת במשרדים האלה יראה את הנכס ואת פרטי הקשר שלך.`;
  if (!confirm(question)) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מפיץ…';
  const { data, error } = await sb.rpc('share_property_with_partners', { p_property_id: p.id });
  if (error || data?.error){
    showToast(shareErrorMessages[data?.error] || ('שגיאה בשיתוף' + (error ? ': ' + error.message : '')));
    btn.disabled = false; btn.textContent = original;
    return;
  }
  showToast(data.newly_shared
    ? `הנכס הופץ ל-${plural(data.newly_shared, 'משרד אחד חדש', 'משרדים חדשים')} - סה״כ ${plural(data.shared_count, 'משרד אחד', 'משרדים')}`
    : `ההפצה מסונכרנת - הנכס משותף עם ${plural(data.shared_count, 'משרד אחד', 'משרדים')}`);
  await loadProperties(agentId);
}

async function unshareProperty(p, btn, agentId){
  if (!confirm(`להסיר את "${p.title}" מכל משרדי השת״פ? הנכס ייעלם מהרשימה "נכסים ששותפו איתי" אצלם.`)) return;
  const original = actionLabel(btn);
  btn.disabled = true; setActionLabel(btn, 'מסיר…');
  const { data, error } = await sb.rpc('unshare_property', { p_property_id: p.id });
  if (error || data?.error){
    showToast(shareErrorMessages[data?.error] || ('שגיאה בביטול השיתוף' + (error ? ': ' + error.message : '')));
    btn.disabled = false; setActionLabel(btn, original);
    return;
  }
  showToast('השיתוף בוטל - הנכס הוסר מ' + plural(data.removed || 0, 'משרד אחד', 'משרדים', '-' + (data.removed || 0)));
  await loadProperties(agentId);
}

async function loadSharedWithMe(){
  const listEl = document.getElementById('sharedWithMeList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('shared_properties_for_me')
    .select('*')
    .order('shared_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">' +
      (missingSchema(error)
        ? 'שיתוף נכסים בין משרדים לא הופעל עדיין בפרויקט הזה.'
        : 'שגיאה בטעינת הנכסים ששותפו: ' + esc(error.message)) + '</div>';
    accSetCount('accSharedWithMe', '');
    return;
  }

  sharedWithMeRows = data || [];
  accSetCount('accSharedWithMe', sharedWithMeRows.length);
  // טווח המחירים והאזור המרכזי — שתי השאלות שנשאלות על רשימה של נכסי אחרים
  accSetSummary('accSharedWithMe', sharedWithMeRows.length
    ? [priceRangeLabel(sharedWithMeRows.map(r => r.price)),
       topValue(sharedWithMeRows.map(r => r.city))].filter(Boolean).join(' · ')
    : '');
  syncSharedFilters();
  renderSharedWithMe();
}

// רשימות הסינון נבנות ממה ששותף בפועל, לא מרשימה קבועה
function syncSharedFilters(){
  const fill = (selectId, options, allLabel) => {
    const select = document.getElementById(selectId);
    const previous = select.value;
    select.innerHTML = `<option value="">${allLabel}</option>` +
      options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (options.some(o => o.value === previous)) select.value = previous;
  };

  const agencies = [];
  const seenAgency = new Set();
  sharedWithMeRows.forEach(r => {
    if (r.owner_agency_id && !seenAgency.has(r.owner_agency_id)){
      seenAgency.add(r.owner_agency_id);
      agencies.push({ value: r.owner_agency_id, label: r.owner_agency_name || 'משרד' });
    }
  });
  agencies.sort((a, b) => a.label.localeCompare(b.label, 'he'));
  fill('sharedAgencyFilter', agencies, 'כל המשרדים');

  const cities = [...new Set(sharedWithMeRows.map(r => r.city).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))
    .map(c => ({ value:c, label:c }));
  fill('sharedCityFilter', cities, 'כל הערים');

  const types = [...new Set(sharedWithMeRows.map(r => r.property_type).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'))
    .map(t => ({ value:t, label:t }));
  fill('sharedTypeFilter', types, 'כל סוגי הנכס');
}

function sharedAddressLine(r){
  return [r.city, [r.street, r.house_number].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ‏wa.me דורש מספר בינלאומי בלי + ובלי האפס המוביל
function waLink(phone){
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  return 'https://wa.me/' + (digits.startsWith('972') ? digits : '972' + digits.replace(/^0+/, ''));
}

function renderSharedWithMe(){
  const listEl = document.getElementById('sharedWithMeList');
  const q = document.getElementById('sharedSearch').value.trim().toLowerCase();
  const agencyId = document.getElementById('sharedAgencyFilter').value;
  const deal = document.getElementById('sharedDealFilter').value;
  const city = document.getElementById('sharedCityFilter').value;
  const type = document.getElementById('sharedTypeFilter').value;
  const sort = document.getElementById('sharedSort').value || 'shared_desc';

  const unsorted = sharedWithMeRows.filter(r => {
    if (agencyId && r.owner_agency_id !== agencyId) return false;
    if (deal && r.deal_type !== deal) return false;
    if (city && r.city !== city) return false;
    if (type && r.property_type !== type) return false;
    if (!q) return true;
    return [r.title, r.city, r.street, r.house_number, r.property_type,
            r.owner_agency_name, r.owner_agent_name, r.owner_agent_phone]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const sharedComparators = {
    shared_desc: (a, b) => timeCompare(a.shared_at, b.shared_at, 'desc'),
    shared_asc:  (a, b) => timeCompare(a.shared_at, b.shared_at, 'asc'),
    price_desc:  (a, b) => numericCompare(a.price, b.price, 'desc'),
    price_asc:   (a, b) => numericCompare(a.price, b.price, 'asc'),
    rooms_desc:  (a, b) => numericCompare(a.rooms, b.rooms, 'desc'),
    rooms_asc:   (a, b) => numericCompare(a.rooms, b.rooms, 'asc'),
    size_desc:   (a, b) => numericCompare(a.size_sqm, b.size_sqm, 'desc'),
    title_asc:   (a, b) => hebCompare(a.title, b.title),
  };
  const filtered = unsorted.slice().sort(sharedComparators[sort] || sharedComparators.shared_desc);

  updateFilterFoot('sharedFilterCount', 'sharedClearFilters',
    filtered.length, sharedWithMeRows.length, !!(q || agencyId || deal || city || type));

  if (filtered.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (sharedWithMeRows.length === 0
        ? 'עדיין לא שותפו איתך נכסים ממשרדי תיווך אחרים.'
        : 'אין נכס שמתאים לסינון הנוכחי.') + '</div>';
    return;
  }

  // הרשימה היא טאבים, כמו שאר רשימות הדשבורד — ראו buildTabRow()
  listEl.innerHTML = '<div class="prop-tabs shared-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  filtered.forEach(r => tabsWrap.appendChild(buildSharedTab(r)));
}

/* ---------- נכס ששותף איתי, כשורה ----------
   מצב הפתיחה לפי `share_id` ולא לפי `property_id`: המפתח של השורה הוא
   השיתוף, וזה גם מה שיישאר נכון אם אותו נכס ישותף פעמיים. */
const expandedSharedIds = new Set();

/* מי שיתף, כמה חדרים ומתי — מה שלא נכנס לכותרת. שם המשרד ראשון: הוא מה
   שקובע את השיחה שתתקיים, והוא הפרט היחיד כאן שאינו על הנכס אלא על מי
   שמחזיק אותו. */
function sharedTabSub(r){
  return [
    r.owner_agency_name,
    r.rooms ? plural(r.rooms, 'חדר אחד', 'חדרים') : null,
    r.size_sqm ? r.size_sqm + ' מ״ר' : null,
    tabShortDate(r.shared_at),
  ].filter(Boolean).join(' · ');
}

/* הכותרת בנויה כמו בטאב של "הנכסים שלי" — סוג הנכס והכתובת — ולא מכותרת
   המודעה: זה אותו סוג אובייקט, ולכן אותה שורה. כותרת מודעה היא טקסט חופשי
   שאורכו נע בין שלוש מילים לשורה וחצי, ובשורה שנחתכת בקצה היא דוחקת החוצה
   דווקא את מה שמזהה — הכתובת. המקורית נשארת בכרטיס. */
function buildSharedTab(r){
  return buildTabRow({
    key: r.share_id || r.property_id, list:'shared', expanded: expandedSharedIds,
    cls:'lead-tab kind-shared', icon:'🤝',
    title: (r.property_type || 'נכס') + ' · ' + propertyTabAddress(r),
    sub: sharedTabSub(r),
    pill: { text: r.deal_type === 'rent' ? 'השכרה' : 'מכירה', cls:'status-pill status-shared' },
    price: shekel(r.price),
    priceNote: r.deal_type === 'rent' ? 'לחודש' : '',
    buildCard: ()=> buildSharedCard(r),
  });
}

function buildSharedCard(r){
    const address = sharedAddressLine(r);
    const tags = tagsHtml([
      r.rooms && { html:`🛏 <b>${esc(r.rooms)}</b> חדרים` },
      r.property_type && { text:'🏠 ' + r.property_type },
      r.size_sqm && { text:`📐 ${r.size_sqm} מ״ר` },
      r.floor != null && { text:'🏢 קומה ' + r.floor },
      address && { text:'📍 ' + address, cls:'tag-info' },
    ]);

    const el = document.createElement('div');
    el.className = 'card lead-card kind-shared';
    const thumbHtml = (r.images && r.images.length)
      ? `<img class="prop-thumb-mini" src="${esc(r.images[0])}" alt="">` : '';
    el.innerHTML = `
      <div class="lead-top">
        <div style="display:flex;gap:10px;align-items:flex-start;min-width:0">
          ${thumbHtml}
          <div style="min-width:0">
            <span class="lead-kind">🤝 ${esc(r.owner_agency_name || 'משרד שותף')}</span>
            <div class="lead-name">${esc(r.title)}</div>
            <div class="prop-price">${shekel(r.price)}${r.deal_type === 'rent' ? ' <span class="per">לחודש</span>' : ''}</div>
          </div>
        </div>
        <div class="pill-row">
          <span class="status-pill status-shared">${r.deal_type === 'rent' ? 'השכרה' : 'מכירה'}</span>
        </div>
      </div>
      ${tags}
      <div class="lead-meta">שותף ${hebDate(r.shared_at)} · אחראי/ת: ${esc(r.owner_agent_name || '-')}${
        r.owner_agent_phone ? ' · <span class="lead-phone">' + esc(r.owner_agent_phone) + '</span>' : ''}</div>
      <div class="lead-actions"></div>
    `;

    const actions = el.querySelector('.lead-actions');
    if (r.owner_agent_phone){
      addCardAction(actions, {
        label:'📞 התקשרות לסוכן/ת', cls:'btn-gold',
        href:'tel:' + String(r.owner_agent_phone).replace(/[^\d+]/g, ''),
      });
      const wa = waLink(r.owner_agent_phone);
      if (wa) addCardAction(actions, { label:'💬 וואטסאפ', href:wa, blank:true });
    }
    addCardAction(actions, {
      label:'🏠 עמוד הנכס', blank:true,
      href:'property.html?id=' + encodeURIComponent(r.property_id),
    });

    return el;
}

document.getElementById('partnerSearch').addEventListener('input', renderSharePartners);
document.getElementById('partnerSelectAll').addEventListener('click', ()=>{
  shareExcludedIds.clear();
  renderSharePartners();
});
document.getElementById('partnerClearAll').addEventListener('click', ()=>{
  shareExcludedIds = new Set(sharePartnerAgencies.map(a => a.id));
  renderSharePartners();
});
document.getElementById('savePartnersBtn').addEventListener('click', saveSharePartners);

document.getElementById('sharedSearch').addEventListener('input', renderSharedWithMe);
['sharedAgencyFilter','sharedDealFilter','sharedCityFilter','sharedTypeFilter','sharedSort'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderSharedWithMe));
document.getElementById('sharedClearFilters').addEventListener('click', ()=>{
  ['sharedSearch','sharedAgencyFilter','sharedDealFilter','sharedCityFilter','sharedTypeFilter']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderSharedWithMe();
});
document.getElementById('sharedRefreshBtn').addEventListener('click', ()=> loadSharedWithMe());

/* ---------- קובץ הלקוחות ומנוע ההתאמות ----------
   הלקוחות יושבים ב-agent_clients, ולהם ה-RLS הצר ביותר בפרויקט: רק הסוכן/ת
   עצמו/ה, בלי מנהל/ת המשרד — אלה פרטים שהלקוח/ה מסר/ה לאדם ספציפי.

   ההתאמות מחושבות ב-DB ולא כאן, כי המאגר שלהן חוצה הרשאות: הנכסים של
   הסוכן/ת, של המשרד, ומה שמשרדים אחרים שיתפו עם המשרד. הפונקציה
   ‏match_properties_for_client גוזרת את הזהות מה-JWT ומחזירה גם ציון וגם
   ‏reasons — כדי שהסוכן/ת יראה למה ההתאמה חלקית, ולא רק מספר.

   שמות המאפיינים חוזרים מה-DB כמפתחות באנגלית; התוויות העבריות כבר קיימות
   כאן בקבועים של טופס הנכס, ולכן אין טעם לשכפל אותן ל-SQL.               */
// מפתחות שקיימים בשתי הרשימות (parking, ac) מקבלים את התווית של מגורים —
// היא האחרונה בשרשור, והמקרה הנפוץ. מפתחות מסחריים בלבד נשארים כמו שהם.
const FEATURE_LABELS = Object.fromEntries([
  ...LISTING_FEATURES, ...COMMERCIAL_PROPERTY_FEATURES, ...RESIDENTIAL_PROPERTY_FEATURES,
]);
const CLIENT_STATUS_LABELS = { active:'מחפש/ת', paused:'בהמתנה', closed:'סגר/ה עסקה' };
const MATCH_SOURCE_LABELS = { own:'הנכס שלי', agency:'נכס של המשרד', shared:'שותף איתי' };

let clientRows = [];
let clientMatchCounts = {};   // client_id → מספר התאמות
let clientMatchTop = {};      // client_id → שורת ההתאמה החזקה ביותר (לתצוגה המקדימה)
let editingClientId = null;
let clientFormCategory = 'residential';

function featureLabel(key){ return FEATURE_LABELS[key] || key; }

async function loadClients(){
  const listEl = document.getElementById('clientsList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('agent_clients')
    .select('*')
    .order('created_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">' +
      (missingSchema(error)
        ? 'קובץ הלקוחות לא הופעל עדיין בפרויקט הזה.'
        : 'שגיאה בטעינת הלקוחות: ' + esc(error.message)) + '</div>';
    accSetCount('accClients', '');
    return;
  }

  clientRows = data || [];

  // ספירה אחת לכל הלקוחות במקום שאילתת התאמות לכל שורה.
  // ‏client_match_top מחזירה את אותה ספירה ובנוסף את ההתאמה החזקה ביותר,
  // ומשם באה התצוגה המקדימה בכרטיס. נפילה חזרה ל-client_match_counts היא
  // בשביל מסד שהמיגרציה החדשה עדיין לא רצה בו — אז פשוט אין תצוגה מקדימה.
  clientMatchCounts = {};
  clientMatchTop = {};
  const { data: tops, error: topError } = await sb.rpc('client_match_top');
  if (!topError){
    (tops || []).forEach(r =>{
      clientMatchCounts[r.client_id] = r.match_count;
      if (r.top_score) clientMatchTop[r.client_id] = r;
    });
  } else {
    const { data: counts } = await sb.rpc('client_match_counts');
    (counts || []).forEach(r => { clientMatchCounts[r.client_id] = r.match_count; });
  }

  const totalMatches = Object.values(clientMatchCounts).reduce((a, b) => a + b, 0);
  accSetCount('accClients', clientRows.length || '');
  // ההתאמות הן מנוע הכסף של הקטגוריה הזו, ולכן הן השורה שנקראת בלי לפתוח
  accSetSummary('accClients', clientRows.length
    ? (totalMatches ? plural(totalMatches, 'התאמה אחת ממתינה', 'התאמות ממתינות') : 'אין כרגע התאמות')
    : '');
  syncClientFilterOptions();
  renderClients();
}

function clientRequirementLine(c){
  const parts = [
    c.deal_type === 'rent' ? 'שכירות' : 'קנייה',
    c.category === 'commercial' ? 'מסחרי' : 'מגורים',
    (c.cities || []).length ? c.cities.join(', ') : null,
    (c.property_types || []).length ? c.property_types.join(' / ') : null,
    (c.min_price || c.max_price)
      ? (c.min_price ? shekel(c.min_price) : '') + '-' + (c.max_price ? shekel(c.max_price) : 'ללא תקרה')
      : null,
    (c.min_rooms || c.max_rooms)
      ? ((c.min_rooms || '') + '-' + (c.max_rooms || '') + ' חדרים') : null,
    c.min_size_sqm ? 'מ-' + c.min_size_sqm + ' מ״ר' : null,
    c.max_floor != null ? 'עד קומה ' + c.max_floor : null,
    (c.required_features || []).length ? c.required_features.map(featureLabel).join(', ') : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/* רשימות הסינון של הלקוחות נבנות ממה שהוזן בפועל בכרטיסים — סוג הנכס והעיר
   הם מערכים על השורה, ולכן הם משוטחים לרשימה אחת של ערכים ייחודיים.        */
function syncClientFilterOptions(){
  fillFilterSelect('clientTypeFilter',
    uniqueSorted(clientRows.flatMap(c => c.property_types || [])),
    'כל מי שמחפש/ת - כל סוגי הנכס');
  fillFilterSelect('clientCityFilter',
    uniqueSorted(clientRows.flatMap(c => c.cities || [])),
    'כל הערים המבוקשות');
}

// טקסט אחד לחיפוש חופשי על כרטיס הלקוח/ה — כולל מה הוא/היא מחפש/ת, כדי
// ש"מי חיפש חנות בעפולה" ייענה מאותו שדה שבו מחפשים לפי שם
function clientSearchBlob(c){
  return [
    c.full_name, c.phone, c.email, c.notes,
    ...(c.cities || []), ...(c.property_types || []),
    ...(c.required_features || []).map(featureLabel),
    c.deal_type === 'rent' ? 'שכירות' : 'קנייה',
    c.category === 'commercial' ? 'מסחרי' : 'מגורים',
    CLIENT_STATUS_LABELS[c.status],
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderClients(){
  const listEl = document.getElementById('clientsList');
  const q = document.getElementById('clientSearch').value.trim().toLowerCase();
  const status = document.getElementById('clientStatusFilter').value;
  const deal = document.getElementById('clientDealFilter').value;
  const category = document.getElementById('clientCategoryFilter').value;
  const type = document.getElementById('clientTypeFilter').value;
  const city = document.getElementById('clientCityFilter').value;
  const sort = document.getElementById('clientSort').value || 'created_desc';

  const unsorted = clientRows.filter(c => {
    if (status && c.status !== status) return false;
    if (deal && c.deal_type !== deal) return false;
    if (category && c.category !== category) return false;
    // רשימה ריקה בכרטיס פירושה "לא משנה" — ולכן לקוח/ה כזה/כזו נחשב/ת
    // מתאים/ה גם לסינון לפי סוג נכס או עיר ספציפיים, בדיוק כמו במנוע ההתאמות
    if (type && (c.property_types || []).length && !(c.property_types || []).includes(type)) return false;
    if (city && (c.cities || []).length && !(c.cities || []).includes(city)) return false;
    if (!q) return true;
    return clientSearchBlob(c).includes(q);
  });

  const clientComparators = {
    created_desc: (a, b) => timeCompare(a.created_at, b.created_at, 'desc'),
    created_asc:  (a, b) => timeCompare(a.created_at, b.created_at, 'asc'),
    matches_desc: (a, b) => numericCompare(clientMatchCounts[a.id] || 0, clientMatchCounts[b.id] || 0, 'desc'),
    name_asc:     (a, b) => hebCompare(a.full_name, b.full_name),
    budget_desc:  (a, b) => numericCompare(a.max_price ?? a.min_price, b.max_price ?? b.min_price, 'desc'),
    budget_asc:   (a, b) => numericCompare(a.max_price ?? a.min_price, b.max_price ?? b.min_price, 'asc'),
  };
  const filtered = unsorted.slice().sort(clientComparators[sort] || clientComparators.created_desc);

  updateFilterFoot('clientFilterCount', 'clientClearFilters', filtered.length, clientRows.length,
    !!(q || status || deal || category || type || city));

  if (filtered.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (clientRows.length === 0
        ? 'עדיין לא הוספת לקוחות. הוסיפו לקוח/ה כדי שהמערכת תתחיל לחפש עבורם התאמות.'
        : 'אין לקוח/ה שמתאים/ה לסינון הנוכחי.') + '</div>';
    return;
  }

  // הרשימה היא טאבים, באותה שפה של "הנכסים שלי": שורה אחת לכל לקוח/ה,
  // והכרטיס המלא נפתח מתחתיה בלחיצה. ראו ההערה מעל buildClientTab().
  listEl.innerHTML = '<div class="prop-tabs client-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  filtered.forEach(c => tabsWrap.appendChild(buildClientTab(c)));
}

/* ---------- קובץ הלקוחות כרשימת טאבים ----------
   כרטיס לקוח/ה מלא הוא שם, טלפון, שורת דרישות, הערות, תצוגה מקדימה של
   ההתאמה ושלוש פעולות — כשליש מסך טלפון. קובץ של שלושים לקוחות היה עשרה
   מסכי גלילה כדי למצוא אחד. לכן הרשימה מציגה שורה קצרה לכל לקוח/ה — שם,
   מה הוא/היא מחפש/ת, כמה התאמות ממתינות ובאיזה תקציב — ורק לחיצה פותחת
   מתחתיה את הכרטיס המלא כפי שהיה, על כל מה שבו.

   אותן מחלקות `.prop-tab*` של רשימת הנכסים, ובכוונה: שתי הרשימות הן אותה
   מחווה — שורה שנפתחת — ועותק שני של אותו CSS תחת שם אחר היה מתפצל ממנה
   בשינוי הראשון. טאב לקוח/ה נושא בנוסף `.client-tab`, כאחיזה לכל כלל
   שיהיה נכון שם ולא בנכסים.

   מצב הפתיחה נשמר לפי מזהה ולא על האלמנט, כי כל פעולה על לקוח/ה (עריכה,
   מחיקה, שמירה) טוענת את הרשימה מחדש — ובלי זה הכרטיס שעבדו עליו היה
   נסגר בדיוק אחרי כל פעולה בו. */
const expandedClientIds = new Set();

/* שורת המשנה: מה שמגדיר את החיפוש. ההתאמות אינן כאן אלא בתגית נפרדת —
   ברוחב טלפון השורה הזו נחתכת, וההתאמות הן הסיבה שהקובץ הזה קיים.

   ‏"מחפש/ת" אינו נאמר: זו ברירת המחדל של הסינון ושל רוב הקובץ, ומילה
   שחוזרת בכל שורה גוזלת בדיוק את המקום שבו נחתכת העיר — מה שבאמת מבדיל
   בין השורות. סטטוס אחר (בהמתנה, סגר/ה עסקה) דווקא נאמר, כי הוא החריג. */
function clientTabSub(c){
  return [
    c.status === 'active' ? null : (CLIENT_STATUS_LABELS[c.status] || c.status),
    c.deal_type === 'rent' ? 'שכירות' : 'קנייה',
    (c.cities || []).length ? c.cities.join(', ') : null,
    (c.property_types || []).length ? c.property_types.join(' / ') : null,
  ].filter(Boolean).join(' · ');
}

/* התקציב במקום שבו יושב המחיר בטאב הנכס, ומקוצר כמוהו (‏₪1.2 מ׳): טווח
   מלא של שני צדדים ברוחב 360px דוחק את השם עצמו לשלוש אותיות ונקודות.
   הסכומים המדויקים נשארים בשורת הדרישות שבכרטיס שנפתח. */
function clientBudgetLabel(c){
  const min = Number(c.min_price) || 0;
  const max = Number(c.max_price) || 0;
  if (min && max) return compactRange(min, max);
  if (max) return 'עד ' + shekelCompact(max);
  if (min) return 'מ־' + shekelCompact(min);
  return '';
}

function buildClientTab(c){
  const matches = clientMatchCounts[c.id];
  return buildTabRow({
    key: c.id, list:'client', expanded: expandedClientIds, cls:'client-tab',
    title: c.full_name,
    sub: clientTabSub(c),
    pill: matches ? { text: plural(matches, 'התאמה אחת', 'התאמות'), cls:'tab-flag' } : null,
    price: clientBudgetLabel(c),
    priceNote: c.deal_type === 'rent' ? 'לחודש' : '',
    // הכרטיס נבנה בפתיחה ונזרק בסגירה — ראו buildTabRow()
    buildCard: ()=> buildClientCard(c),
  });
}

function buildClientCard(c){
  const matches = clientMatchCounts[c.id];
  const wa = waLink(c.phone);
  const el = document.createElement('div');
  el.className = 'card client-card';
  el.innerHTML = `
    <div class="lead-top">
      <div style="min-width:0">
        <div class="lead-name">${esc(c.full_name)}</div>
        ${c.phone ? `<div class="contact-line">
            <span class="lead-phone">${esc(c.phone)}</span>
            <a class="contact-quick" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}"
               title="חיוג ל${esc(c.full_name)}" aria-label="חיוג ל${esc(c.full_name)}">📞</a>
            ${wa ? `<a class="contact-quick is-wa" href="${esc(wa)}" target="_blank" rel="noopener noreferrer"
               title="וואטסאפ ל${esc(c.full_name)}" aria-label="וואטסאפ ל${esc(c.full_name)}">💬</a>` : ''}
          </div>` : ''}
        <div class="req-line">${esc(clientRequirementLine(c))}</div>
        ${c.notes ? `<div class="lead-meta">${esc(c.notes)}</div>` : ''}
      </div>
      <div class="pill-row">
        <span class="status-pill status-unlocked">${CLIENT_STATUS_LABELS[c.status] || c.status}</span>
        ${matches ? `<span class="status-pill status-shared">${plural(matches, 'התאמה אחת', 'התאמות')}</span>` : ''}
      </div>
      <div class="card-menu">
        <button type="button" class="card-menu-btn" aria-haspopup="true" aria-expanded="false"
                title="פעולות נוספות" aria-label="פעולות נוספות על ${esc(c.full_name)}">⋯</button>
        <div class="card-menu-pop"></div>
      </div>
    </div>
    <div class="lead-actions"></div>
    <div class="match-panel" style="display:none"></div>
  `;

  const actions = el.querySelector('.lead-actions');
  const panel = el.querySelector('.match-panel');

  // תצוגה מקדימה של ההתאמה החזקה ביותר - מיד עם פתיחת הכרטיס
  const peek = clientMatchPeek(c, () => el.querySelector('.match-cta'));
  if (peek) el.querySelector('.lead-top').insertAdjacentElement('afterend', peek);

  addCardAction(actions, { label:'✏️ עריכה', onClick:()=> openEditClient(c) });
  // הזמנת שירותי תיווך נחתמת מול הלקוח/ה, ולכן הכפתור יושב על הכרטיס שלו/ה
  // ולא רק בקטגוריית ההסכמים. סוג העסקה בכרטיס הוא שקובע איזה טופס נפתח.
  addCardAction(actions, {
    label:'✍️ החתמה על הסכם',
    title:'פתיחת הסכם תיווך עם הלקוח/ה, עם הפרטים שכבר בכרטיס',
    onClick:()=> openAgreementWizard({ kind: c.deal_type === 'rent' ? 'tenant' : 'buy', clientId: c.id }),
  });
  const matchBtn = addCardAction(actions, {
    label: matches ? `🔍 הצגת ${plural(matches, 'התאמה אחת', 'התאמות')}` : '🔍 חיפוש התאמות',
    cls:'btn-gold act-wide',
    onClick: btn => toggleClientMatches(c, btn, panel),
  });
  matchBtn.classList.add('match-cta');

  // מחיקה היא הפעולה היחידה כאן שאי אפשר לבטל, ולכן היא לא יושבת ברשת
  // הפעולות לצד "עריכה" ו"החתמה" - שלושה כפתורים באותו גודל ובאותו צבע,
  // שאחד מהם בלתי הפיך, זו לחיצה שגויה שממתינה לקרות בשטח.
  buildCardMenu(el.querySelector('.card-menu'), [
    { label:'🗑 מחיקת הלקוח/ה', danger:true, onClick:()=> deleteClient(c) },
  ]);

  return el;
}

/* ---------- תצוגה מקדימה של ההתאמה ----------
   ‏client_match_top מחזירה, לצד המונה, את שורת ההתאמה החזקה ביותר לכל
   לקוח/ה. כשהיא לא זמינה (מיגרציה שטרם רצה) פשוט אין תצוגה מקדימה -
   הכפתור והמונה ממשיכים לעבוד בדיוק כמו קודם.                          */
function clientMatchPeek(client, ctaGetter){
  const top = clientMatchTop[client.id];
  if (!top || !top.top_score) return null;

  const address = [top.top_city, [top.top_street, top.top_house_number].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const what = top.top_property_type || 'נכס';
  const price = top.top_deal_type === 'rent'
    ? shekel(top.top_price) + ' לחודש' : shekel(top.top_price);

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'match-peek';
  row.title = 'פתיחת רשימת ההתאמות המלאה';
  row.innerHTML =
    `<span class="score-pill ${top.top_score >= 85 ? 'score-high' : 'score-mid'}">${esc(String(top.top_score))}%</span>`
    + `<span class="match-peek-text">הכי מתאים: <b>${esc(what)}</b>`
    + (address ? ' ב' + esc(address) : '') + ` · ${esc(price)}</span>`;
  row.addEventListener('click', ()=>{
    const cta = ctaGetter();
    if (cta) cta.click();
  });
  return row;
}

/* ---------- תפריט שלוש הנקודות ----------
   נבנה בכל כרטיס שיש בו פעולה הרסנית. תפריט אחד פתוח בכל רגע, ולחיצה
   בכל מקום אחר סוגרת אותו — כולל גלילה עם האצבע על כרטיס אחר.          */
function buildCardMenu(wrap, items){
  if (!wrap) return;
  const btn = wrap.querySelector('.card-menu-btn');
  const pop = wrap.querySelector('.card-menu-pop');
  pop.innerHTML = '';
  items.forEach(item=>{
    const b = document.createElement('button');
    b.type = 'button';
    if (item.danger) b.className = 'is-danger';
    b.textContent = item.label;
    b.addEventListener('click', ()=>{ closeCardMenus(); item.onClick(); });
    pop.appendChild(b);
  });
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const open = wrap.classList.contains('is-open');
    closeCardMenus();
    wrap.classList.toggle('is-open', !open);
    btn.setAttribute('aria-expanded', String(!open));
  });
}

function closeCardMenus(){
  document.querySelectorAll('.card-menu.is-open').forEach(m=>{
    m.classList.remove('is-open');
    const b = m.querySelector('.card-menu-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('click', closeCardMenus);
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeCardMenus(); });

async function toggleClientMatches(client, btn, panel){
  if (panel.style.display !== 'none'){
    panel.style.display = 'none';
    btn.textContent = clientMatchCounts[client.id]
      ? `🔍 הצגת ${plural(clientMatchCounts[client.id], 'התאמה אחת', 'התאמות')}` : '🔍 חיפוש התאמות';
    return;
  }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מחפש…';
  const { data, error } = await sb.rpc('match_properties_for_client', { p_client_id: client.id });
  btn.disabled = false;

  if (error){
    showToast('שגיאה בחיפוש התאמות: ' + error.message);
    btn.textContent = original;
    return;
  }

  const rows = data || [];
  clientMatchCounts[client.id] = rows.length;
  renderClientMatches(panel, rows);
  panel.style.display = 'block';
  btn.textContent = '🔍 הסתרת ההתאמות';
}

function renderClientMatches(panel, rows){
  if (rows.length === 0){
    panel.innerHTML = '<div class="lead-meta">אין כרגע נכס שעונה על הדרישות - לא אצלך, לא במשרד ולא בין הנכסים ששותפו איתך.</div>';
    return;
  }

  panel.innerHTML = '';
  rows.forEach(m => {
    const address = [m.city, [m.street, m.house_number].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const matchTags = tagsHtml([
      { text: m.deal_type === 'rent' ? shekel(m.price) + ' לחודש' : shekel(m.price), cls:'tag-key' },
      m.rooms && { html:`🛏 <b>${esc(m.rooms)}</b> חדרים` },
      m.property_type && { text:'🏠 ' + m.property_type },
      m.size_sqm && { text:`📐 ${m.size_sqm} מ״ר` },
      m.floor != null && { text:'🏢 קומה ' + m.floor },
      address && { text:'📍 ' + address },
    ]);

    const gaps = [
      ...(m.reasons || []),
      ...((m.missing_features || []).length
        ? ['חסר: ' + m.missing_features.map(featureLabel).join(', ')] : []),
    ];

    // המשרד שמפרסם רלוונטי רק כשהוא לא שלי — בנכס שלי זה רעש
    const sourceLabel = m.source === 'shared'
      ? '🤝 ' + (m.listing_agency_name || 'משרד שותף')
      : MATCH_SOURCE_LABELS[m.source] || m.source;

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-head">
        <div>
          <span class="src-tag src-${esc(m.source)}">${esc(sourceLabel)}</span>
          <div class="match-title">${esc(m.title)}</div>
        </div>
        <span class="score-pill ${m.score >= 85 ? 'score-high' : 'score-mid'}">${m.score}%</span>
      </div>
      ${matchTags}
      ${gaps.length ? `<div class="match-gap">${gaps.map(esc).join(' · ')}</div>` : ''}
      <div class="lead-actions"></div>
    `;

    const actions = card.querySelector('.lead-actions');
    addCardAction(actions, {
      label:'🏠 עמוד הנכס', blank:true,
      href:'property.html?id=' + encodeURIComponent(m.property_id),
    });

    if (m.source !== 'own' && m.listing_agent_phone){
      addCardAction(actions, {
        label:'📞 ' + (m.listing_agent_name || 'הסוכן/ת'),
        href:'tel:' + String(m.listing_agent_phone).replace(/[^\d+]/g, ''),
      });
    }

    panel.appendChild(card);
  });
}

/* ---------- טופס הלקוח/ה ---------- */
function clientTypeOptions(){
  return (clientFormCategory === 'commercial' ? COMMERCIAL_PTYPE_OPTIONS : RESIDENTIAL_PTYPE_OPTIONS)
    .map(t => [t, t]);
}
function clientFeatureOptions(){
  return clientFormCategory === 'commercial' ? COMMERCIAL_PROPERTY_FEATURES : RESIDENTIAL_PROPERTY_FEATURES;
}

function renderClientFormLists(selectedTypes = [], selectedFeatures = []){
  renderFeatureCheckboxes('clPropertyTypes', clientTypeOptions(), selectedTypes);
  renderFeatureCheckboxes('clFeatures', clientFeatureOptions(), selectedFeatures);
}

function setClientFormCategory(category, selectedTypes = [], selectedFeatures = []){
  clientFormCategory = category;
  document.querySelectorAll('[data-client-category]').forEach(b =>
    b.classList.toggle('active', b.dataset.clientCategory === category));
  renderClientFormLists(selectedTypes, selectedFeatures);
}

function resetClientForm(){
  editingClientId = null;
  document.getElementById('addClientForm').reset();
  document.getElementById('clientFeedback').textContent = '';
  document.getElementById('saveClientBtn').textContent = 'שמירת הלקוח/ה';
  setClientFormCategory('residential');
}

function openEditClient(c){
  editingClientId = c.id;
  document.getElementById('clName').value  = c.full_name;
  document.getElementById('clPhone').value = c.phone || '';
  document.getElementById('clEmail').value = c.email || '';
  document.getElementById('clIdNumber').value = c.id_number || '';
  document.getElementById('clAddress').value  = c.address || '';
  document.getElementById('clDeal').value  = c.deal_type;
  document.getElementById('clCities').value = (c.cities || []).join(', ');
  document.getElementById('clMinPrice').value = c.min_price ?? '';
  document.getElementById('clMaxPrice').value = c.max_price ?? '';
  document.getElementById('clMinRooms').value = c.min_rooms ?? '';
  document.getElementById('clMaxRooms').value = c.max_rooms ?? '';
  document.getElementById('clMinSize').value  = c.min_size_sqm ?? '';
  document.getElementById('clMaxFloor').value = c.max_floor ?? '';
  document.getElementById('clNotes').value    = c.notes || '';
  document.getElementById('clStatus').value   = c.status;
  setClientFormCategory(c.category || 'residential', c.property_types || [], c.required_features || []);

  document.getElementById('saveClientBtn').textContent = 'עדכון הלקוח/ה';
  const form = document.getElementById('addClientForm');
  form.style.display = 'block';
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function deleteClient(c){
  if (!confirm(`למחוק את "${c.full_name}" מקובץ הלקוחות? הפעולה בלתי הפיכה.`)) return;
  const { error } = await sb.from('agent_clients').delete().eq('id', c.id);
  if (error){ showToast('שגיאה במחיקה: ' + error.message); return; }
  expandedClientIds.delete(c.id);
  if (editingClientId === c.id) resetClientForm();
  showToast('הלקוח/ה נמחק/ה');
  await loadClients();
  // ההתראות של הלקוח/ה ירדו עם השורה (on delete cascade) - בלי הרענון הן
  // היו נשארות על המסך ומצביעות על מי שכבר לא בקובץ
  await loadClientAlerts();
}

// שדה מספרי ריק הוא null ולא 0 - 0 היה נקרא כ"תקציב אפס" ומסנן הכול
const numOrNull = id => {
  const raw = document.getElementById(id).value.trim();
  return raw === '' ? null : Number(raw);
};

document.getElementById('toggleAddClient').addEventListener('click', ()=>{
  const form = document.getElementById('addClientForm');
  const opening = form.style.display === 'none';
  if (opening) resetClientForm();
  form.style.display = opening ? 'block' : 'none';
});

document.querySelectorAll('[data-client-category]').forEach(btn =>
  btn.addEventListener('click', ()=> setClientFormCategory(btn.dataset.clientCategory)));

document.getElementById('addClientForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('saveClientBtn');
  const feedback = document.getElementById('clientFeedback');
  const original = btn.textContent;

  const minPrice = numOrNull('clMinPrice'), maxPrice = numOrNull('clMaxPrice');
  const minRooms = numOrNull('clMinRooms'), maxRooms = numOrNull('clMaxRooms');
  // אותן בדיקות קיימות כ-check constraint ב-DB; כאן הן חוסכות הלוך-חזור לשרת
  if (minPrice != null && maxPrice != null && minPrice > maxPrice){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'התקציב המינימלי גבוה מהמקסימלי';
    return;
  }
  if (minRooms != null && maxRooms != null && minRooms > maxRooms){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'מינימום החדרים גבוה מהמקסימום';
    return;
  }

  const payload = {
    full_name: document.getElementById('clName').value.trim(),
    phone:  document.getElementById('clPhone').value.trim() || null,
    email:  document.getElementById('clEmail').value.trim() || null,
    id_number: document.getElementById('clIdNumber').value.trim() || null,
    address:   document.getElementById('clAddress').value.trim() || null,
    notes:  document.getElementById('clNotes').value.trim() || null,
    deal_type: document.getElementById('clDeal').value,
    category:  clientFormCategory,
    property_types: getCheckedValues('clPropertyTypes'),
    cities: document.getElementById('clCities').value.split(',').map(s => s.trim()).filter(Boolean),
    min_price: minPrice, max_price: maxPrice,
    min_rooms: minRooms, max_rooms: maxRooms,
    min_size_sqm: numOrNull('clMinSize'),
    max_floor: numOrNull('clMaxFloor'),
    required_features: getCheckedValues('clFeatures'),
    status: document.getElementById('clStatus').value,
  };

  btn.disabled = true; btn.textContent = 'שומר…';
  feedback.textContent = '';
  let error;
  if (editingClientId){
    ({ error } = await sb.from('agent_clients').update(payload).eq('id', editingClientId));
  } else {
    payload.agent_id  = currentAgent.id;
    payload.agency_id = currentAgent.agency_id;
    ({ error } = await sb.from('agent_clients').insert(payload));
  }
  btn.disabled = false; btn.textContent = original;

  if (error){
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שגיאה בשמירה: ' + error.message;
    return;
  }
  showToast(editingClientId ? 'הלקוח/ה עודכן/ה' : 'הלקוח/ה נוסף/ה - מחפשים התאמות');
  // הצעד האחרון במדריך ההתחלה, וזה גם הרגע שבו המדריך כולו נסגר
  if (!editingClientId) refreshOnboarding();
  resetClientForm();
  document.getElementById('addClientForm').style.display = 'none';
  await loadClients();
});

document.getElementById('clientSearch').addEventListener('input', renderClients);
['clientStatusFilter','clientDealFilter','clientCategoryFilter','clientTypeFilter','clientCityFilter','clientSort']
  .forEach(id => document.getElementById(id).addEventListener('change', renderClients));
document.getElementById('clientClearFilters').addEventListener('click', ()=>{
  ['clientSearch','clientStatusFilter','clientDealFilter','clientCategoryFilter','clientTypeFilter','clientCityFilter']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderClients();
});

/* ---------- התראות התאמה ----------
   מנוע ההתאמות עבד עד היום רק במשיכה: הסוכן/ת פותח/ת כרטיס לקוח/ה ולוחץ/ת
   "הצגת התאמות". נכס שנכנס בשתיים בלילה חיכה שמישהו יפתח את הכרטיס הנכון
   ביום הנכון. ההתראות הן הכיוון ההפוך - טריגר ב-DB (מיגרציה 20260829200000)
   מצליב כל נכס חדש מול קובצי הלקוחות של כל מי שרואה אותו, ופותח שורה
   ב-client_match_alerts. כאן רק התצוגה והסטטוס.

   שתי נקודות שכדאי לדעת עליהן:
   • הציון והסיבות נשמרים על שורת ההתראה ולא מחושבים מחדש בקריאה - ההתראה
     מתעדת את מצב הנכס ברגע שהוא התאים, וזה מה שצריך להסביר *למה* היא נשלחה.
   • ההתראות אינן רטרואקטיביות. לקוח/ה חדש/ה לא מציף/ה את הרשימה בכל
     הנכסים שכבר קיימים - בשבילם יש את פאנל ההתאמות בקובץ הלקוחות.        */
let alertRows = [];

function alertScope(){
  return document.getElementById('alertScopeFilter').value || 'new';
}

async function loadClientAlerts(){
  const listEl = document.getElementById('alertsList');
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb.rpc('client_match_alerts_feed',
    { p_scope: alertScope(), p_limit: 60 });

  if (error){
    listEl.innerHTML = '<div class="empty-state">' +
      (missingSchema(error)
        ? 'התראות ההתאמה לא הופעלו עדיין בפרויקט הזה.'
        : 'שגיאה בטעינת ההתראות: ' + esc(error.message)) + '</div>';
    accSetCount('accAlerts', '');
    document.getElementById('alertsFilterCount').textContent = '';
    document.getElementById('alertsMarkAll').hidden = true;
    return;
  }

  alertRows = data || [];
  renderClientAlerts();
}

function renderClientAlerts(){
  const listEl = document.getElementById('alertsList');
  const unseen = alertRows.filter(a => a.status === 'new').length;

  accSetCount('accAlerts', unseen ? plural(unseen, 'התראה אחת חדשה', 'חדשות') : '');
  document.getElementById('alertsMarkAll').hidden = unseen === 0;
  document.getElementById('alertsFilterCount').textContent = alertRows.length
    ? plural(alertRows.length, 'התראה אחת', 'התראות')
        + (unseen ? ' · ' + plural(unseen, 'אחת חדשה', 'חדשות') : '')
    : '';

  if (alertRows.length === 0){
    listEl.innerHTML = '<div class="empty-state">' +
      (alertScope() === 'new'
        ? 'אין התראות חדשות. כשייכנס נכס שעונה על הדרישות של אחד הלקוחות בקובץ - הוא יופיע כאן.'
        : 'עדיין לא נפתחו התראות התאמה.') + '</div>';
    return;
  }

  // הרשימה היא טאבים, כמו שאר רשימות הדשבורד - ראו buildTabRow()
  listEl.innerHTML = '<div class="prop-tabs alert-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  alertRows.forEach(a => tabsWrap.appendChild(buildAlertTab(a)));
}

/* ---------- התראת התאמה כשורה ----------
   ההתראה היא זוג: נכס שנכנס ולקוח/ה שהוא מתאים לו/ה. הכותרת היא הנכס,
   באותה צורה שבה הוא נכתב בכל שאר הרשימות (סוג · כתובת), ושם הלקוח/ה הוא
   הפרט הראשון בשורת המשנה - כלומר זה שלעולם אינו נחתך. שני הכיוונים
   קורים בשטח: נכס אחד שמתאים לשלושה לקוחות, ולקוח/ה אחד/ת ששלושה נכסים
   מתאימים לו/ה, ולכן אף אחד מהשניים אינו לבדו מפתח שמבדיל בין השורות.

   הפס הצדדי הזהוב מסמן את מה שטרם נצפה - בלי זה רשימת ההתראות אחידה
   לגמרי והחדש נבלע בין מה שכבר טופל. זו אותה החלטה שכבר עמדה מאחורי
   `.alert-card.is-new`, והיא פשוט עברה לשורה. */
const expandedAlertIds = new Set();

function alertAddressLine(a){
  return [a.city, [a.street, a.house_number].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

function buildAlertTab(a){
  const isNew = a.status === 'new';
  return buildTabRow({
    key: a.id, list:'alert', expanded: expandedAlertIds,
    cls: 'alert-tab' + (isNew ? ' is-new' : ''),
    icon: a.source === 'shared' ? '🤝' : '🔔',
    title: (a.property_type || 'נכס') + ' · ' + (alertAddressLine(a) || a.title || ''),
    sub: ['ל' + (a.client_name || '-'),
          // המשרד שמפרסם רלוונטי רק כשהוא לא שלי - בנכס שלי זה רעש
          a.source === 'shared' ? (a.listing_agency_name || 'משרד שותף') : null,
          tabShortDate(a.created_at)].filter(Boolean).join(' · '),
    pill: { text: a.score + '%', cls: 'score-pill ' + (a.score >= 85 ? 'score-high' : 'score-mid') },
    price: shekel(a.price),
    priceNote: a.deal_type === 'rent' ? 'לחודש' : '',
    buildCard: ()=> buildAlertCard(a),
  });
}

function buildAlertCard(a){
  const address = alertAddressLine(a);

  const alertTags = tagsHtml([
    { text: a.deal_type === 'rent' ? shekel(a.price) + ' לחודש' : shekel(a.price), cls:'tag-key' },
    a.rooms && { html:`🛏 <b>${esc(a.rooms)}</b> חדרים` },
    a.property_type && { text:'🏠 ' + a.property_type },
    a.size_sqm && { text:`📐 ${a.size_sqm} מ״ר` },
    a.floor != null && { text:'🏢 קומה ' + a.floor },
    address && { text:'📍 ' + address },
  ]);

  const gaps = [
    ...(a.reasons || []),
    ...((a.missing_features || []).length
      ? ['חסר: ' + a.missing_features.map(featureLabel).join(', ')] : []),
  ];

  // המשרד שמפרסם רלוונטי רק כשהוא לא שלי — בנכס שלי זה רעש
  const sourceLabel = a.source === 'shared'
    ? '🤝 ' + (a.listing_agency_name || 'משרד שותף')
    : MATCH_SOURCE_LABELS[a.source] || a.source;

  const card = document.createElement('div');
  card.className = 'match-card alert-card' + (a.status === 'new' ? ' is-new' : '');
  card.innerHTML = `
    <div class="match-head">
      <div>
        <span class="src-tag src-${esc(a.source)}">${esc(sourceLabel)}</span>
        <div class="alert-for">מתאים ל${esc(a.client_name)}</div>
        <div class="match-title">${esc(a.title)}</div>
      </div>
      <div style="text-align:left">
        <span class="score-pill ${a.score >= 85 ? 'score-high' : 'score-mid'}">${a.score}%</span>
        <div class="alert-when">${esc(hebDateTime(a.created_at))}</div>
      </div>
    </div>
    ${alertTags}
    ${gaps.length ? `<div class="match-gap">${gaps.map(esc).join(' · ')}</div>` : ''}
    <div class="lead-actions"></div>
  `;

  const actions = card.querySelector('.lead-actions');
  addCardAction(actions, {
    label:'🏠 עמוד הנכס', blank:true,
    href:'property.html?id=' + encodeURIComponent(a.property_id),
  });

  // ההצעה ללקוח/ה היא הפעולה שההתראה נועדה לה, ולכן הקישור נולד מוכן:
  // שם, כותרת הנכס, מחיר וקישור ציבורי - בלי להקליד כלום
  const clientWa = waLink(a.client_phone);
  if (clientWa){
    const lines = [
      `שלום ${a.client_name},`,
      `מצאתי נכס שיכול להתאים למה שאתם מחפשים: ${a.title}` + (address ? ` ב${address}` : '') + '.',
      (a.deal_type === 'rent' ? shekel(a.price) + ' לחודש' : shekel(a.price)) + '.',
      propertyPublicLink(a.property_id),
    ];
    addCardAction(actions, {
      label:'💬 שליחה ללקוח/ה', cls:'btn-gold', blank:true,
      href: clientWa + '?text=' + encodeURIComponent(lines.join('\n')),
    });
  }

  if (a.source !== 'own' && a.listing_agent_phone){
    addCardAction(actions, {
      label:'📞 ' + (a.listing_agent_name || 'הסוכן/ת'),
      href:'tel:' + String(a.listing_agent_phone).replace(/[^\d+]/g, ''),
    });
  }

  if (a.status === 'new'){
    addCardAction(actions, { label:'✓ נצפתה', onClick: btn => setAlertStatus(a, 'seen', btn) });
  }
  addCardAction(actions, {
    label:'✕ הסרה', title:'ההתראה לא תוצג שוב. הנכס עצמו נשאר בפאנל ההתאמות של הלקוח/ה.',
    onClick: btn => setAlertStatus(a, 'dismissed', btn),
  });

  return card;
}

/* ‏dismissed יורדת מהרשימה תמיד (הפיד לא מחזיר אותה), ו-seen יורדת רק
   כשמסתכלים על "חדשות בלבד" - אחרת היא נשארת ומשנה צבע.               */
async function setAlertStatus(row, status, btn){
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '…';

  const { error } = await sb.from('client_match_alerts')
    .update({ status, seen_at: row.seen_at || new Date().toISOString() })
    .eq('id', row.id);

  if (error){
    btn.disabled = false; btn.textContent = original;
    showToast('שגיאה בעדכון ההתראה: ' + error.message);
    return;
  }

  if (status === 'dismissed' || alertScope() === 'new'){
    alertRows = alertRows.filter(r => r.id !== row.id);
    expandedAlertIds.delete(row.id);   // ההתראה ירדה מהרשימה
  } else {
    row.status = status;
    row.seen_at = row.seen_at || new Date().toISOString();
  }
  renderClientAlerts();
}

async function markAllAlertsSeen(btn){
  const ids = alertRows.filter(a => a.status === 'new').map(a => a.id);
  if (!ids.length) return;

  btn.disabled = true;
  const { error } = await sb.from('client_match_alerts')
    .update({ status:'seen', seen_at:new Date().toISOString() })
    .in('id', ids);
  btn.disabled = false;

  if (error){ showToast('שגיאה בעדכון ההתראות: ' + error.message); return; }
  showToast(plural(ids.length, 'התראה אחת סומנה', 'התראות סומנו') + ' כנצפו');
  await loadClientAlerts();
}

document.getElementById('alertScopeFilter').addEventListener('change', ()=> loadClientAlerts());
document.getElementById('alertsRefreshBtn').addEventListener('click', ()=> loadClientAlerts());
document.getElementById('alertsMarkAll').addEventListener('click', e => markAllAlertsSeen(e.currentTarget));

async function openCmaReport(propertyId, btn){
  const original = actionLabel(btn);
  btn.disabled = true; setActionLabel(btn, 'מפיק…');
  const { data, error } = await sb.rpc('cma_report', { p_property_id: propertyId });
  btn.disabled = false; setActionLabel(btn, original);

  if (error){ showToast('שגיאה בהפקת הדוח: ' + error.message); return; }
  if (data?.error){
    const messages = {
      upgrade_required: data.detail || 'דוח CMA זמין ב-PROFESSIONAL וב-Elite',
      property_not_found: 'הנכס לא נמצא',
      no_matching_agent_profile: 'שגיאת הרשאה',
    };
    // ‏detail לפני ברירת המחדל: קוד שגיאה חדש שנוסף ב-agent_cma_report מגיע
    // עם נוסח עברי משלו (כך נכנס rent_not_supported), וההודעה הכללית
    // "שגיאה בהפקת הדוח" הייתה בולעת אותו בלי שאיש ישים לב.
    showToast(messages[data.error] || data.detail || 'שגיאה בהפקת הדוח', 6000);
    return;
  }
  renderCmaReport(data);
}

/* ---------- תצוגת הדוח ----------
   כלל אחד שולט כאן: **הדוח מציג רק מה שהמסד הסכים להחזיר.** ‏agent_cma_report
   מחזירה ממוצע, חציון וממוצע למ״ר אך ורק כש-`data_coverage.status = 'ok'`,
   כלומר כשיש לפחות `cma_min_comparables` עסקאות ברדיוס. בכל מצב אחר השדות
   האלה פשוט אינם ב-jsonb, ולכן אי אפשר להציג אותם גם בטעות.

   זה בא במקום המצב הקודם, שבו "תמונת השוק" הוצגה תמיד: עסקה אחת הופיעה
   כ"מחיר ממוצע", ולצידה המשפט "המחיר המבוקש גבוה ב-17% מממוצע העסקאות
   בסביבה" - שנקרא כמו ממצא ונשען על נקודה אחת.

   ‏basisLabel הוא הצד השני של אותה אמירה: שורה שמקורה במחיר מבוקש מסומנת
   ככזו בכל מקום שבו היא מופיעה, ולא נספרת כמחיר עסקה. */
const CMA_BASIS = {
  asking:   { label:'מחיר מבוקש', cls:'is-asking', title:'המחיר שהיה בפרסום - לא מחיר הסגירה' },
  reported: { label:'דווח',       cls:'',          title:'מחיר הסגירה כפי שדווח על ידי הסוכן/ת' },
  official: { label:'רשמי',       cls:'',          title:'מתוך מאגר עסקאות רשמי' },
};

function cmaBasisHtml(basis){
  const b = CMA_BASIS[basis] || CMA_BASIS.asking;
  return `<span class="cma-basis ${b.cls}" title="${esc(b.title)}">${esc(b.label)}</span>`;
}

/* ההסבר שמחליף את הסטטיסטיקה. הוא אומר שלושה דברים במפורש — כמה נמצא,
   כמה צריך, ומה נבדק — כדי שסוכן/ת שמדפיס/ה את הדוח ללקוח/ה תוכל/יוכל
   להסביר למה אין כאן מספר, במקום להתנצל על דוח ריק. */
function cmaCoverageBlock(cov){
  if (!cov) return '';
  const ageLine = cov.max_deal_age_months
    ? `נבדקו עסקאות מ-${cov.max_deal_age_months} החודשים האחרונים בלבד.` : '';
  const texts = {
    no_location: {
      t: 'לא ניתן להפיק תמונת שוק לנכס הזה',
      d: 'לנכס אין קואורדינטות במערכת, ולכן אי אפשר לאתר עסקאות בסביבתו. '
       + 'גיאוקוד נעשה על כתובת מלאה - עיר, רחוב ומספר בית.',
    },
    none: {
      t: 'אין עסקאות להשוואה בסביבת הנכס',
      d: 'לא נמצאה אף עסקה שנסגרה ברדיוס הנבדק. ' + ageLine,
    },
    insufficient: {
      t: 'אין די עסקאות כדי לחשב תמונת שוק',
      d: `${plural(cov.comparables_found, 'נמצאה עסקה אחת', 'עסקאות נמצאו')} בסביבת הנכס, והמינימום לחישוב ממוצע הוא `
       + `${cov.min_required}. ממוצע ממדגם קטן מזה אינו אמין, ולכן הוא אינו מוצג. ` + ageLine,
    },
  };
  const x = texts[cov.status];
  if (!x) return '';
  return `<div class="cma-gap">
      <div class="t">${esc(x.t)}</div>
      <div class="d">${esc(x.d)}</div>
      <ul>
        <li>עסקאות שנמצאו בסביבה: ${esc(cov.comparables_found ?? 0)}</li>
        <li>נדרש לחישוב ממוצע: ${esc(cov.min_required ?? '-')}</li>
        ${cov.oldest_considered ? `<li>העסקה הישנה ביותר שנכללה: מ-${hebDate(cov.oldest_considered)} ואילך</li>` : ''}
      </ul>
    </div>`;
}

function renderCmaReport(r){
  const s   = r.subject || {};
  const st  = r.stats || {};
  const cov = r.data_coverage || {};
  const comps = r.comparables || [];
  const cityComps = r.city_comparables || [];
  const sources = r.sources || [];
  const hasStats = !!cov.has_statistics;

  /* הפער מול השוק מוצג רק כשיש שוק להשוות אליו. זה היה המשפט המטעה
     ביותר בדוח: הוא נוסח כממצא גם כשה"ממוצע" היה עסקה אחת.

     ומעכשיו הוא **שני מספרים ולא אחד**, וזו לא הרחבה קוסמטית. הפער
     במחיר הכולל והפער למ״ר אינם אותו מספר, והם יכולים להצביע לכיוונים
     שונים לגמרי. נכס אמיתי בעפולה: 1,320,000 ₪ על 80 מ״ר, מול ממוצע
     של 1,282,937 ₪ על 113 מ״ר ב-222 עסקאות בסביבה.

       במחיר הכולל   +3%   ← נשמע כמו "המחיר בשוק"
       במחיר למ״ר   +43%   ← 16,500 מול 11,556

     שני המספרים נכונים, והם מתארים את אותו נכס. ההבדל ביניהם הוא כולו
     השטח: נכס קטן מהממוצע ייראה זול בהשוואה הכוללת גם כשהוא יקר מאוד
     לכל מטר. מי שראה רק את ה-3% קרא שהמחיר סביר, והוא לא היה.

     לכן שניהם ולא בחירה ביניהם: המחיר למ״ר הוא ההשוואה המדויקת כששטחים
     שונים, והמחיר הכולל הוא מה שהקונה באמת משלם. וכששניהם רחוקים זה
     מזה, הדוח אומר **למה** - אחרת זה נקרא כסתירה. */
  /* ‏`ask == null` לפני `Number()`, וזו לא הגנה עודפת אלא באג שנתפס.
     ‏**`Number(null)` הוא 0 ולא NaN**, ולכן נכס בלי שטח - `price_per_sqm`
     חוזר `null` מ-`agent_cma_report` כש-`size_sqm` ריק - היה מקבל
     "המחיר המבוקש למ״ר: נמוך ב-100% מהממוצע". מספר מומצא שנקרא כממצא,
     על שתיים מ-31 המודעות הפעילות למכירה.

     ‏`Number.isFinite` לבדו אינו תופס את זה כי 0 הוא סופי לגמרי, ו-
     ‏`jsonb_build_object` מחזיר את המפתח **עם `null`** ולא משמיט אותו -
     כלומר `undefined` (שהיה נותן NaN) אינו מגיע לכאן לעולם.

     ‏`a > 0` מכסה גם מחיר 0, שאינו השוואה בעלת משמעות. */
  const cmaGapPct = (ask, avg) => {
    if (ask == null || avg == null) return null;
    const a = Number(ask), v = Number(avg);
    return (Number.isFinite(a) && Number.isFinite(v) && a > 0 && v > 0)
      ? Math.round(((a - v) / v) * 100) : null;
  };
  const priceGap = hasStats ? cmaGapPct(s.price, st.avg_price) : null;
  const sqmGap   = hasStats ? cmaGapPct(s.price_per_sqm, st.avg_price_per_sqm) : null;

  function cmaGapLine(pct, what, n){
    if (pct === null) return '';
    const count = Number(n) > 0 ? ` (${esc(n)} עסקאות)` : '';
    return pct === 0
      ? `<div class="cma-note">${what}: <strong>תואם את הממוצע</strong>${count}.</div>`
      : `<div class="cma-note">${what}: <strong>${pct > 0 ? 'גבוה' : 'נמוך'} ב-${Math.abs(pct)}%</strong> `
        + `מהממוצע${count}.</div>`;
  }

  /* סף ההסבר: 10 נקודות אחוז. מתחת לזה שני המספרים מספרים אותו סיפור
     ומשפט נוסף הוא רעש; מעל לזה הם נראים כמו סתירה, ואז ההסבר הוא
     החלק החשוב יותר של הדוח. */
  const gapDiverges = priceGap !== null && sqmGap !== null
                      && Math.abs(priceGap - sqmGap) >= 10;

  const gapNote = (priceGap === null && sqmGap === null) ? '' :
      cmaGapLine(priceGap, 'המחיר המבוקש הכולל', st.comparables_count)
    + cmaGapLine(sqmGap,   'המחיר המבוקש למ״ר',  st.sqm_sample_size ?? st.comparables_count)
    + (gapDiverges
        ? '<div class="cma-note">שני המספרים רחוקים זה מזה מפני ששטח הנכס שונה מהשטח הממוצע '
          + 'בעסקאות ההשוואה. המחיר למ״ר הוא ההשוואה המדויקת יותר; המחיר הכולל הוא מה שהקונה משלם בפועל.</div>'
        : '')
    + (sqmGap === null && st.avg_price_per_sqm && !s.price_per_sqm
        ? '<div class="cma-note">אין שטח רשום לנכס, ולכן אי אפשר להשוות את המחיר למ״ר.</div>'
        : '');

  const compRows = comps.map(c => `<tr>
      <td>${esc(c.property_type)}${c.same_type === false ? ' <span class="cma-basis">סוג אחר</span>' : ''}</td>
      <td>${c.rooms ?? '-'}</td>
      <td>${shekel(c.sale_price)} ${cmaBasisHtml(c.price_basis)}</td>
      <td>${c.price_per_sqm ? shekel(c.price_per_sqm) : '-'}</td>
      <td>${esc(c.distance_meters)} מ׳</td>
      <td>${hebDate(c.sold_at)}</td>
    </tr>`).join('');

  const cityRows = cityComps.map(c => `<tr>
      <td>${esc(c.property_type)}</td>
      <td>${c.rooms ?? '-'}</td>
      <td>${shekel(c.sale_price)} ${cmaBasisHtml(c.price_basis)}</td>
      <td>${hebDate(c.sold_at)}</td>
    </tr>`).join('');

  const plans = (r.planning && Array.isArray(r.planning.applicable_plans)) ? r.planning.applicable_plans : [];

  /* שורת המקורות נבנית ממה שבאמת נכנס לדוח (`sources` מה-RPC) ולא מטקסט
     קבוע. כך מקור חדש שייכנס למאגר יופיע כאן מעצמו, ודוח בלי נתונים לא
     יטען שהוא נשען על מאגר. */
  const sourcesLine = sources.length
    ? 'מקורות הנתונים בדוח זה: ' + sources.map(x => `${esc(x.label)} (${esc(x.deals)})`).join(' · ') + '.'
    : 'לא נכללו בדוח זה עסקאות כלשהן.';

  const askingNote = cov.asking_basis_count > 0
    ? `<div class="cma-note">${esc(cov.asking_basis_count)} מהעסקאות בדוח רשומות לפי <strong>המחיר המבוקש</strong> `
      + 'שהיה בפרסום ולא לפי מחיר הסגירה, ומסומנות ככאלה בטבלאות. פער המיקוח אינו משוקלל בהן.</div>'
    : '';

  document.getElementById('cmaBody').innerHTML = `
    <div class="cma-head">
      <div class="brand"><img class="logo-img" src="assets/logo-shuknadlan.svg" alt="" width="52" height="62"> שוק נדל״ן - דוח השוואת שוק</div>
      <div class="when">הופק ב-${new Date(r.generated_at).toLocaleDateString('he-IL')}</div>
    </div>

    <h2>${esc(s.title)}</h2>
    <div class="cma-sub">
      ${esc(s.address || s.city)} · ${esc(s.property_type)} · ${s.rooms ? plural(s.rooms, 'חדר אחד', 'חדרים') : '- חדרים'} ·
      ${s.deal_type === 'rent' ? 'להשכרה' : 'למכירה'} · מחיר מבוקש ${shekel(s.price)}
      ${s.price_per_sqm ? ' · ' + shekel(s.price_per_sqm) + ' למ״ר' : ''}
    </div>

    <div class="cma-section-title">תמונת השוק</div>
    ${hasStats ? `
      <div class="cma-stats">
        <div class="cma-stat"><div class="n">${esc(st.comparables_count)}</div><div class="l">עסקאות להשוואה</div></div>
        <div class="cma-stat"><div class="n">${shekel(st.avg_price)}</div><div class="l">מחיר ממוצע</div></div>
        <div class="cma-stat"><div class="n">${shekel(st.median_price)}</div><div class="l">מחיר חציוני</div></div>
        <div class="cma-stat"><div class="n">${st.avg_price_per_sqm ? shekel(st.avg_price_per_sqm) : '-'}</div><div class="l">ממוצע למ״ר</div></div>
      </div>
      ${gapNote}
      ${r.radius_meters_used ? `<div class="cma-note">ההשוואה נערכה ברדיוס ${esc(r.radius_meters_used)} מ׳ מהנכס.</div>` : ''}
      ${!st.avg_price_per_sqm
        ? '<div class="cma-note">לא נמצאו נתוני שטח לעסקאות ההשוואה, ולכן אין ממוצע מחיר למ״ר.</div>' : ''}
      ${Number(st.same_type_count) < Number(st.comparables_count)
        ? `<div class="cma-note">${esc(st.comparables_count - st.same_type_count)} מעסקאות ההשוואה הן בסוג נכס אחר, ומסומנות בטבלה.</div>` : ''}
    ` : cmaCoverageBlock(cov)}
    ${askingNote}

    ${comps.length ? `
      <div class="cma-section-title">עסקאות בסביבת הנכס</div>
      <table class="cma-table">
        <thead><tr><th>סוג</th><th>חדרים</th><th>מחיר</th><th>למ״ר</th><th>מרחק</th><th>תאריך</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>` : ''}

    ${cityComps.length ? `
      <div class="cma-section-title">עסקאות נוספות ב${esc(s.city)} (ללא מיקום מדויק)</div>
      <div class="cma-note">העסקאות האלה אינן נכללות בחישוב שלמעלה, כי אי אפשר למקם אותן ביחס לנכס.</div>
      <table class="cma-table">
        <thead><tr><th>סוג</th><th>חדרים</th><th>מחיר</th><th>תאריך</th></tr></thead>
        <tbody>${cityRows}</tbody>
      </table>` : ''}

    ${r.planning ? `
      <div class="cma-section-title">מידע תכנוני</div>
      <table class="cma-table">
        <tbody>
          <tr><th>גוש / חלקה</th><td>${esc(r.planning.gush || '-')} / ${esc(r.planning.helka || '-')}</td></tr>
          <tr><th>שטח החלקה</th><td>${r.planning.parcel_area_sqm ? esc(r.planning.parcel_area_sqm) + ' מ״ר' : '-'}</td></tr>
          <tr><th>ייעוד קרקע</th><td>${esc(r.planning.land_use_designation || '-')}</td></tr>
          ${plans.length ? `<tr><th>תוכניות חלות</th><td>${plans.map(p => esc(p.number || p.description)).join(', ')}</td></tr>` : ''}
        </tbody>
      </table>` : ''}

    <div class="cma-foot">
      ${sourcesLine}
      המאגר אינו כולל עסקאות שלא נסגרו דרך הפלטפורמה, ולכן אינו תמונה מלאה של השוק באזור.
      ${r.planning ? 'המידע התכנוני מבוסס על שכבות ה-GIS של עיריית עפולה. ' : ''}
      הנתונים נכונים למועד ההפקה, מוצגים לצורך התרשמות כללית בלבד, ואינם מהווים שומת
      מקרקעין, ייעוץ מקצועי או תחליף לבדיקה פרטנית.
    </div>`;

  document.getElementById('cmaOverlay').style.display = 'block';
}


document.getElementById('cmaCloseBtn').addEventListener('click', ()=>{
  document.getElementById('cmaOverlay').style.display = 'none';
});
document.getElementById('cmaPrintBtn').addEventListener('click', ()=> window.print());

/* ---------- Notifications bell (2.2) ----------
   ההתראות נוצרות בטריגרים במסד, כך שגם אירוע שנכנס דרך Edge Function
   (owner-lead-intake / submit-review) או דרך הבוט בוואטסאפ מייצר שורה כאן.
   הגוף של התראת ליד לעולם לא מכיל שם/טלפון — הליד עשוי להיות עדיין masked.

   ‏NOTIF_TYPES הוא מקור האמת היחיד לסוגי ההתראות: ממנו נבנית רשימת תיבות
   הסימון ב"ניהול התראות", ממנו נגזר הפס הצדדי בפאנל, וממנו הניווט בלחיצה.
   סוג חדש שנוסף במסד צריך שורה אחת כאן — ובלעדיה הוא עדיין יוצג, רק בלי
   צבע וניווט ייעודיים.

   ‏when() מסתיר סוג שאינו רלוונטי לתפקיד: אין טעם להציע למנהל/ת פלטפורמה
   לכבות התראה שסוכן/ת רגיל/ה לעולם לא מקבל/ת, ולהפך. ‏view:'admin' מוסיף
   לזה את הצד השני — הקטגוריה שאליה ההתראה מובילה יושבת בתצוגת המנהל/ת,
   ולכן הלחיצה מעבירה לשם קודם. */
const NOTIF_TYPES = [
  { type:'new_lead',       tone:'',       goto:'accLeads',    focus:'#leadsList',
    title:'ליד חדש',
    sub:'פנייה חדשה שהשתייכה אליך - בעל/ת נכס, מתעניין/ת בנכס או פנייה ישירה.' },
  { type:'review_new',     tone:'review', goto:'accReviews',  focus:'#reviewModerationList',
    title:'ביקורת חדשה',
    sub:'חוות דעת שהתקבלה עליך, ולמנהל/ת המשרד גם ביקורת של סוכן/ת בצוות שממתינה לאישור.' },
  { type:'review_request', tone:'',       goto:'accLeads',    focus:'#leadsList',
    title:'תזכורת לבקש חוות דעת',
    sub:'אחרי סגירת עסקה, או כשליד פתוח מזמן ועדיין אין עליו חוות דעת.' },
  { type:'client_match',   tone:'',       goto:'accAlerts',   focus:'#alertsList',
    title:'התאמת נכס ללקוח/ה בקובץ',
    sub:'נכס חדש שעונה על הדרישות של אחד הלקוחות בקובץ הלקוחות שלך.' },
  { type:'deal_closed',    tone:'deal',   goto:'accTeam',     focus:'#teamList',
    title:'עסקה שנסגרה בצוות',
    sub:'נכס שסומן כנמכר או כהושכר אצל אחד הסוכנים במשרד, כולל שם הסוכן/ת ופרטי הנכס.',
    when: ()=> currentAgent && currentAgent.role === 'manager' },
  { type:'marketing_copy', tone:'',       goto:'accProperties', focus:'#propertiesList',
    title:'תיאור שיווקי שנכתב אוטומטית',
    sub:'נכס שנשמר בלי תיאור שיווקי וקיבל אחד מהנתונים שהוזנו. כדאי לעבור עליו.' },
  /* ‏refresh ולא רק ניווט: החתימה נכנסה למסד אחרי שהרשימה נטענה, ובלי
     טעינה מחדש ההסכם היה ממשיך להופיע כ"ממתין לחתימה" בדיוק במסך שאליו
     ההתראה הובילה. */
  { type:'agreement_signed', tone:'deal', goto:'accAgreements', focus:'#agreementsList',
    title:'הסכם שנחתם מרחוק',
    sub:'לקוח/ה חתם/ה בקישור שנשלח אליו/ה. חתימה במעמדך אינה מצלצלת - ראית אותה קורית.',
    refresh: ()=> loadAgreements() },
  /* ארבעת הדרבונים של מדריך ההתחלה. סוג לכל צעד ולא אחד, כי הניתוב בלחיצה נגזר
     מהסוג, וכל אחד מוביל למקום אחר. ‏when() מוריד אותם מ"ניהול התראות" ברגע
     שהמדריך נסגר: ארבע תיבות סימון לצמיתות, עבור ארבע הודעות שיוצאות פעם
     אחת בחיים, הן רעש. הניתוב עצמו לא תלוי ב-when ולכן ממשיך לעבוד גם
     אחר כך, על התראה שעדיין יושבת בפעמון. */
  { type:'onboarding_property', tone:'', goto:'accProperties', focus:'#propertiesList',
    title:'מדריך ההתחלה - הנכס הראשון',
    sub:'דרבון חד-פעמי אחרי שהפרופיל הושלם, כל עוד אין עדיין נכס.',
    when: ()=> onboardingLive() },
  { type:'onboarding_client', tone:'', goto:'accClients', focus:'#clientsList',
    title:'מדריך ההתחלה - הלקוח/ה הראשון/ה',
    sub:'דרבון חד-פעמי אחרי הנכס הראשון, כל עוד קובץ הלקוחות ריק.',
    when: ()=> onboardingLive() },
  { type:'onboarding_agreement', tone:'', goto:'accAgreements', focus:'#agreementsList',
    title:'מדריך ההתחלה - ההסכם הראשון',
    sub:'דרבון חד-פעמי כשיש כבר נכס ולקוח/ה, וטרם נוצרה הזמנת שירותי תיווך.',
    when: ()=> onboardingLive() },
  { type:'onboarding_lead', tone:'', goto:'accLeadShelf', focus:'#shelfTabs',
    title:'מדריך ההתחלה - הליד הראשון',
    sub:'דרבון חד-פעמי אחרי ההסכם הראשון, כל עוד לא נרכש ליד מחנות הלידים.',
    when: ()=> onboardingLive() },
  { type:'system',         tone:'',       goto:'accSharedWithMe', focus:'#sharedWithMeList',
    title:'שיתופי נכסים ועדכוני מערכת',
    sub:'נכס שמשרד שותף פתח לשיתוף פעולה, והודעות מערכת כלליות.' },
  { type:'review_alert',   tone:'alert',  goto:'accReviews',  focus:'#reviewModerationList',
    title:'הסלמת ביקורת כוכב אחד',
    sub:'ביקורת 1★ שנכנסה לפלטפורמה ומגיעה לבדיקת ההנהלה.',
    when: ()=> currentAgent && currentAgent.is_platform_admin },
  { type:'lead_unrouted',  tone:'alert',  goto:'accUnroutedLeads', focus:'#unroutedLeadsList',
    view:'admin',
    title:'ליד שאין למי להפנות',
    sub:'פנייה שנקלטה מהאתר ואין קהל שיקבל אותה - למשל ליד משכנתא בלי יועצ/ת רשומ/ה.',
    when: ()=> currentAgent && currentAgent.is_platform_admin },
  /* ‏goto ל"מנויים ובקשות שדרוג" ולא ללוח הבקרה: ההתראה אומרת מי הצטרף/ה
     ולאיזה מסלול, ושם — ב"יומן שינויי מסלול" — רואים את השורה עצמה. */
  { type:'platform_signup', tone:'deal', goto:'accSubscriptions', focus:'#subsLog',
    view:'admin',
    title:'הצטרפות חדשה לפלטפורמה',
    sub:'משרד תיווך שנפתח, מתווך/ת שנכנס/ת לראשונה, בעל/ת מקצוע שנרשם/ה או חברה יזמית - עם השם והמסלול.',
    when: ()=> currentAgent && currentAgent.is_platform_admin,
    refresh: ()=> loadSubscriptionsAdmin() },
  /* החלוקה בין שני הסוגים היא לפי השאלה ולא לפי הקהל: platform_signup הוא
     "מי הגיע", וזה "כסף". לכן גם תשלום של בעל/ת מקצוע יושב כאן ולא שם.
     ‏tone:'alert' כי בקשת שדרוג ממתינה לאישור, וכל עוד אין סליקה באתר היא
     גם דורשת שמישהו יסדיר תשלום מחוץ למערכת. */
  { type:'platform_upgrade', tone:'alert', goto:'accSubscriptions', focus:'#subsRequests',
    view:'admin',
    title:'תשלומים ושדרוגי מסלול',
    sub:'סוכן/ת שעבר/ה למסלול בתשלום או שביקש/ה לעבור, ותשלום של בעל/ת מקצוע שהעלה כרטיסייה לאוויר. הטבת ההשקה אינה נספרת.',
    when: ()=> currentAgent && currentAgent.is_platform_admin,
    refresh: ()=> loadSubscriptionsAdmin() },
];

const NOTIF_BY_TYPE = new Map(NOTIF_TYPES.map(t => [t.type, t]));

async function loadNotifications(agentId){
  const listEl = document.getElementById('notifList');
  const badge = document.getElementById('bellBadge');
  const { data, error } = await sb
    .from('notifications')
    .select('id, type, title, body, read, related_lead_id, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending:false })
    .limit(20);

  if (error){
    listEl.innerHTML = '<div class="empty-state" style="padding:18px">שגיאה בטעינת התראות</div>';
    return;
  }
  const items = data || [];
  const unread = items.filter(n => !n.read).length;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.style.display = unread ? 'flex' : 'none';

  if (!items.length){
    listEl.innerHTML = '<div class="empty-state" style="padding:18px">אין התראות חדשות.</div>';
    return;
  }
  listEl.innerHTML = '';
  items.forEach(n=>{
    const meta = NOTIF_BY_TYPE.get(n.type);
    const el = document.createElement('div');
    el.className = 'notif-item' + (n.read ? '' : ' unread') + (meta && meta.tone ? ' ' + meta.tone : '');
    // ‏esc(): הגוף של ההתראה מכיל היום גם טקסט שנכתב בידי לקוח/ה (ציטוט
    // מביקורת) ושמות נכסים ממשרדים אחרים — תוכן שלא נוצר כאן ולכן לא נסמך
    el.innerHTML = `<div class="t">${esc(n.title)}</div>
      ${n.body ? `<div class="b">${esc(n.body)}</div>` : ''}
      <div class="when">${new Date(n.created_at).toLocaleString('he-IL')}</div>`;
    el.addEventListener('click', async ()=>{
      if (!n.read){
        await sb.from('notifications').update({ read:true }).eq('id', n.id);
        await loadNotifications(agentId);
      }
      document.getElementById('bellPanel').style.display = 'none';
      document.getElementById('bellBtn').setAttribute('aria-expanded','false');
      // כל סוג מוביל לקטגוריה שבה באמת אפשר לעשות משהו עם ההתראה. סוג לא
      // מוכר, או קטגוריה שאינה גלויה לתפקיד הזה, פשוט סוגרים את הפאנל —
      // נחיתה רכה עדיפה על קפיצה למקום שגוי.
      const target = meta || NOTIF_BY_TYPE.get('new_lead');
      // ‏view: קטגוריות הפלטפורמה יושבות ב-#platformAdminSection, שתצוגת
      // הסוכן/ת מכבה ב-display:none — כלומר navAccVisible שמתחת היה מחזיר
      // false והלחיצה לא הייתה עושה דבר. המעבר לתצוגה קודם לבדיקה, ורק למי
      // שהתצוגה פתוחה בפניו/ה.
      if (target.view === 'admin' && dashView !== 'admin'
          && currentAgent && currentAgent.is_platform_admin) {
        setDashView('admin');
      }
      // ‏navAccVisible ולא offsetParent: קטגוריה שאינה גלויה לתפקיד הזה
      // (managerSection לסוכן/ת רגיל/ה) באמת אינה יעד — אבל קטגוריה שיושבת
      // בלשונית אחרת של הסרגל התחתון היא display:none ברגע הזה, ו-offsetParent
      // ביטל בגללה את ההתראה לגמרי במקום להעביר ללשונית שלה. ‏gotoSection הוא
      // שעושה את המעבר, ואחריו הגלילה מגיעה למקום קיים.
      if (navAccVisible(target.goto)){
        if (target.refresh) target.refresh();
        gotoSection(target.goto, null, { scrollTo: target.focus });
      }
    });
    listEl.appendChild(el);
  });
}

document.getElementById('bellBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  // stopPropagation מונע מהמאזין הגלובלי לסגור את תפריט הבורגר, ולכן סוגרים
  // אותו כאן במפורש — אחרת שני הפאנלים היו נפתחים זה על גבי זה
  closeMenuPanel();
  const panel = document.getElementById('bellPanel');
  const open = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  document.getElementById('bellBtn').setAttribute('aria-expanded', String(!open));
  if (!open && currentAgent) loadNotifications(currentAgent.id);
});

document.getElementById('bellPanel').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', ()=>{
  const panel = document.getElementById('bellPanel');
  if (panel.style.display === 'block'){
    panel.style.display = 'none';
    document.getElementById('bellBtn').setAttribute('aria-expanded','false');
  }
});

document.getElementById('markAllRead').addEventListener('click', async ()=>{
  if (!currentAgent) return;
  const { error } = await sb.from('notifications').update({ read:true })
    .eq('agent_id', currentAgent.id).eq('read', false);
  if (error){ showToast('שגיאה בסימון ההתראות'); return; }
  await loadNotifications(currentAgent.id);
});

/* ---------- "נקה נקראו" ----------
   עד עכשיו לא הייתה לפעמון שום דרך להיפטר משורה: קריאה הפכה את read
   ל-true, הרקע הוורוד ירד, והשורה נשארה עד שעשרים חדשות דחפו אותה מעבר
   ל-limit. הכפתור הזה מוחק באמת — delete במסד ולא הסתרה בדפדפן.

   **המחיקה נוגעת בכל ההתראות שנקראו ולא רק בעשרים שמוצגות.** זו הנקודה
   שדורשת את הספירה באישור: מי שרואה ארבע שורות בנות יומן לא אמור/ה לגלות
   בדיעבד שמחק/ה שבעים ושבע. הלא-נקראות אינן נוגעות בכלל. */
document.getElementById('clearRead').addEventListener('click', async ()=>{
  if (!currentAgent) return;
  const { count, error: countErr } = await sb.from('notifications')
    .select('id', { count:'exact', head:true })
    .eq('agent_id', currentAgent.id).eq('read', true);
  if (countErr){ showToast('שגיאה בטעינת ההתראות'); return; }
  if (!count){ showToast('אין התראות שנקראו למחוק'); return; }

  const what = plural(count, 'התראה אחת שכבר נקראה', 'התראות שכבר נקראו');
  if (!confirm(`למחוק ${what}? הפעולה אינה הפיכה. התראות שעדיין לא נקראו יישארו.`)) return;

  // ‏select() אחרי delete מחזיר את השורות שנמחקו בפועל, וזה לא קישוט:
  // ‏DELETE שאין לו policy תואם ב-RLS **אינו מחזיר שגיאה** — הוא מוחק אפס
  // שורות ומדווח הצלחה. בלי ההשוואה הזו כפתור מנוטרל היה נראה בדיוק כמו
  // כפתור עובד, והרשימה שלא התקצרה הייתה הרמז היחיד.
  const { data, error } = await sb.from('notifications').delete()
    .eq('agent_id', currentAgent.id).eq('read', true).select('id');
  if (error){ showToast('שגיאה במחיקת ההתראות'); return; }

  const removed = (data || []).length;
  showToast(removed === 0 ? 'לא נמחקה אף התראה - נסו לרענן את הדף'
          : removed === 1 ? 'התראה אחת נמחקה'
          : plural(removed, 'התראה אחת נמחקה', 'התראות נמחקו'));
  await loadNotifications(currentAgent.id);
});

document.getElementById('notifSettingsBtn').addEventListener('click', ()=>{
  document.getElementById('bellPanel').style.display = 'none';
  document.getElementById('bellBtn').setAttribute('aria-expanded','false');
  gotoSection('accNotifPrefs');
});

/* ---------- ניהול ההתראות ----------
   מה שנשמר במסד הוא רשימת הסוגים ה*מושתקים* ולא המסומנים, ושתי תוצאות
   נובעות מזה:

   • ברירת המחדל היא קבלת הכול בלי שורה במסד ובלי backfill — סוכן/ת שמעולם
     לא נכנס/ה לכאן מקבל/ת כל התראה, וכך גם סוג התראה חדש שייכנס בעתיד.
   • הטריגר notifications_apply_preferences במסד הוא זה שבאמת מסנן, כך
     שהתראה שכובתה לא נוצרת מלכתחילה ולא רק מוסתרת בדפדפן. */
let notifMutedTypes = [];

/* ‏whatsapp_types הוא ההיפך מ-muted_types שלידו: רשימת **מאושרים**. זה
   החריג המכוון לתבנית שחוזרת בכל הפרויקט, והסיבה ספציפית — ערוץ יוצא
   שעולה כסף, ושחסימה אחת בו מייקרת אותנו אצל כל הנמענים העתידיים דרך
   דירוג האיכות של Meta, לא נדלק לאיש בלי בקשה מפורשת. התוצאה: סוג התראה
   חדש יגיע לפעמון של כולם אוטומטית, ולוואטסאפ — רק למי שיבקש. */
let notifWhatsappTypes = [];

/* העוזר האישי בוואטסאפ הוא יכולת של PROFESSIONAL ו-Elite, ולכן גם ערוץ
   ההתראות היוצא — אותו מספר, אותה זהות. הבדיקה כאן היא לתצוגה בלבד;
   האכיפה עצמה ב-notification_push_due_agents במסד, שם נבדק גם מצב החיוב
   (‏billing_status אינו נטען לדפדפן). אותה תבנית כמו כפתור דוח ה-CMA. */
function assistantTierOk(){
  return !!currentAgent && (currentAgent.tier === 'mid' || currentAgent.tier === 'premium');
}

function notifVisibleTypes(){
  return NOTIF_TYPES.filter(t => !t.when || t.when());
}

async function loadNotifPrefs(agentId){
  const { data, error } = await sb
    .from('agent_notification_preferences')
    .select('muted_types, whatsapp_types')
    .eq('agent_id', agentId)
    .maybeSingle();

  // שגיאה כאן משמעה שהמיגרציה עוד לא רצה על המסד. במצב כזה לא חוסמים כלום:
  // הדשבורד ממשיך להציג את כל ההתראות, וזו בדיוק ברירת המחדל.
  notifMutedTypes = (!error && data && Array.isArray(data.muted_types)) ? data.muted_types : [];
  notifWhatsappTypes = (!error && data && Array.isArray(data.whatsapp_types)) ? data.whatsapp_types : [];
  renderNotifPrefs();
}

function renderNotifPrefs(){
  const el = document.getElementById('notifPrefsList');
  if (!el) return;
  const types = notifVisibleTypes();
  el.innerHTML = '';
  const tierOk = assistantTierOk();
  types.forEach(t=>{
    const muted = notifMutedTypes.includes(t.type);
    const row = document.createElement('div');
    row.className = 'np-row' + (muted || !tierOk ? ' is-off' : '');
    row.dataset.type = t.type;
    row.innerHTML = `
      <label>
        <input type="checkbox" class="notifPrefType" value="${esc(t.type)}" ${muted ? '' : 'checked'}>
        <span><span class="np-title">${esc(t.title)}</span><span class="np-sub">${esc(t.sub)}</span></span>
      </label>
      <label class="np-wa">
        <input type="checkbox" class="notifPrefWa" value="${esc(t.type)}"
          ${notifWhatsappTypes.includes(t.type) ? 'checked' : ''}
          ${muted || !tierOk ? 'disabled' : ''}>
        <span>💬 גם בוואטסאפ</span>
      </label>`;
    el.appendChild(row);
  });
  syncNotifPrefsCount();
  syncNotifWaNote();
}

/* סוג שכובה בפעמון אינו נוצר במסד מלכתחילה (הטריגר
   ‏notifications_apply_preferences מחזיר null), ולכן אין ממה לשלוח הודעה.
   במקום להשאיר תיבה שלא עושה כלום — היא מכובה ומנוקה יחד עם הפעמון. */
function syncNotifWaRow(type){
  const row = document.querySelector(`.np-row[data-type="${type}"]`);
  if (!row) return;
  const bell = row.querySelector('.notifPrefType');
  const wa = row.querySelector('.notifPrefWa');
  const allowed = bell.checked && assistantTierOk();
  row.classList.toggle('is-off', !allowed);
  wa.disabled = !allowed;
  if (!bell.checked) wa.checked = false;
}

/* ההערה אומרת את המצב בפועל ולא אזהרה כללית. סוכן/ת שסימן/ה "גם בוואטסאפ"
   בלי מספר שמור היה/הייתה מחכה להודעה שלא תגיע לעולם — וזה בדיוק סוג
   הכשל ששותק. */
function syncNotifWaNote(){
  const note = document.getElementById('notifWaNote');
  if (!note) return;

  /* המסלול קודם לכל השאר: אין טעם לומר "צריך מספר" למי שממילא אינו/ה
     במסלול שבו הערוץ פועל. וזה נאמר גם כשאין אף סימון — אחרת תיבות
     מכובות בלי הסבר נראות כמו תקלה. */
  if (!assistantTierOk()){
    note.innerHTML = 'שליחת ההתראות בוואטסאפ היא חלק מהעוזר האישי, שזמין במסלולים ' +
      'PROFESSIONAL ו-Elite. ההתראות בפעמון עובדות בכל מסלול. ' +
      '<a href="pricing.html" target="_blank" rel="noopener">לפרטים ולשדרוג</a>';
    return;
  }

  const on = document.querySelectorAll('.notifPrefWa:checked').length;
  if (!on){ note.textContent = ''; return; }
  note.textContent = (currentAgent && currentAgent.phone)
    ? `${plural(on, 'סוג התראה אחד יישלח', 'סוגי התראה יישלחו')} גם לוואטסאפ שלך (${currentAgent.phone}).`
    : 'כדי שההתראות יגיעו בוואטסאפ צריך מספר שמור בקטגוריית "העוזר בוואטסאפ" - בלעדיו הסימון כאן לא יעשה דבר.';
}

/* המונה על הקטגוריה: "הכול" כשאין מושתקים, ואחרת כמה מתוך כמה פעילים —
   כדי שאפשר יהיה לראות מהדשבורד שההתראות הצטמצמו בלי לפתוח את הקטגוריה. */
function syncNotifPrefsCount(){
  const boxes = Array.from(document.querySelectorAll('.notifPrefType'));
  if (!boxes.length){ accSetCount('accNotifPrefs', ''); return; }
  const on = boxes.filter(b => b.checked).length;
  accSetCount('accNotifPrefs', on === boxes.length ? 'הכול' : on + '/' + boxes.length);
}

/* האזנה אחת על המכיל, ולא מאזין לכל תיבה: הרשימה נבנית מחדש בכל טעינה. */
document.getElementById('notifPrefsList').addEventListener('change', (e)=>{
  if (e.target.classList.contains('notifPrefType')) syncNotifWaRow(e.target.value);
  syncNotifPrefsCount();
  syncNotifWaNote();
});

/* "סימון הכל" / "ניקוי הכל" נוגעים בפעמון בלבד, ובכוונה: הם היו כאן לפני
   ערוץ הוואטסאפ, והרחבתם אליו הייתה הופכת לחיצה אחת ל-שמונה הודעות יוצאות
   שאיש לא ביקש. ניקוי כן מוריד גם את הוואטסאפ — דרך syncNotifWaRow — כי
   סוג שכובה בפעמון לא נוצר במסד ואין ממה לשלוח. */
document.getElementById('notifPrefsAllBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.notifPrefType').forEach(cb => {
    cb.checked = true;
    syncNotifWaRow(cb.value);
  });
  syncNotifPrefsCount();
  syncNotifWaNote();
});

document.getElementById('notifPrefsNoneBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.notifPrefType').forEach(cb => {
    cb.checked = false;
    syncNotifWaRow(cb.value);
  });
  syncNotifPrefsCount();
  syncNotifWaNote();
});

document.getElementById('notifPrefsForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('saveNotifPrefsBtn');
  const feedback = document.getElementById('notifPrefsFeedback');
  btn.disabled = true; btn.textContent = 'שומר…'; feedback.textContent = '';

  // רק סוגים שגלויים לתפקיד הזה נשקלים. כך מנהל/ת שהורד/ה לסוכן/ת רגיל/ה
  // לא "מדליק/ה" בשקט התראות שכיבה/תה כשעדיין היה/הייתה מנהל/ת.
  const shown = notifVisibleTypes().map(t => t.type);
  const checked = new Set(Array.from(document.querySelectorAll('.notifPrefType:checked')).map(cb => cb.value));
  const muted = notifMutedTypes
    .filter(type => !shown.includes(type))
    .concat(shown.filter(type => !checked.has(type)));

  /* אותו היגיון בדיוק על ערוץ הוואטסאפ, ובכיוון ההפוך (רשימת מאושרים):
     סוג שאינו גלוי לתפקיד הזה נשאר כפי שהוא, ומה שהוצג נקבע לפי הסימון.
     וסוג שכובה בפעמון יוצא מהרשימה בכל מקרה — הוא לא ייווצר במסד, ושורה
     שמבטיחה הודעה שלא תישלח היא שקר שקשה לאתר. */
  const waChecked = new Set(Array.from(document.querySelectorAll('.notifPrefWa:checked')).map(cb => cb.value));
  const whatsapp = notifWhatsappTypes
    .filter(type => !shown.includes(type))
    .concat(shown.filter(type => waChecked.has(type) && checked.has(type)));

  const { error } = await sb.from('agent_notification_preferences').upsert({
    agent_id: currentAgent.id,
    muted_types: muted,
    whatsapp_types: whatsapp,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_id' });

  btn.disabled = false; btn.textContent = 'שמירת ההעדפות';
  if (error){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאה: ' + error.message;
    return;
  }
  notifMutedTypes = muted;
  notifWhatsappTypes = whatsapp;
  syncNotifPrefsCount();
  syncNotifWaNote();
  feedback.style.color = 'var(--blue)';
  const bits = [];
  bits.push(muted.length ? plural(muted.length, 'סוג התראה אחד כבוי', 'סוגי התראה כבויים') : 'מקבלים את כל ההתראות');
  if (whatsapp.length) bits.push(whatsapp.length + ' מהם יישלחו גם בוואטסאפ');
  feedback.textContent = 'נשמר - ' + bits.join(', ') + '.';
  setTimeout(()=>{ feedback.textContent=''; }, 2500);
});

/* ==========================================================================
   תזכורות וטיפים
   --------------------------------------------------------------------------
   הפעמון מדווח על אירועים. התזכורות מדווחות על **היעדר** אירוע — נכס בלי
   תמונה, שבוע בלי מודעה חדשה, תוקף התקשרות שנגמר — וזה דבר שאף טריגר לא
   יכול לגלות, כי לא קרה שום דבר שיפעיל אותו.

   **אין תור.** ‏agent_reminder_findings במסד מחשבת את הרשימה מול מצב הנכסים
   בכל קריאה, ומכאן שתי תוצאות שקשה להשיג עם תור:

   • ממצא שטופל נעלם מעצמו, בלי סימון "בוצע" ובלי טריגר — גם כשהטיפול הגיע
     מייבוא קובץ, מהבוט בוואטסאפ או מ-Edge Function ולא מהמסך הזה.
   • אותה פונקציה בדיוק מזינה את ההודעה שיוצאת במייל ובוואטסאפ, ולכן אין מצב
     שההודעה אומרת שבעה נכסים והרשימה כאן מראה חמישה.

   ‏REMINDER_KINDS הוא מקור האמת של הצד הזה לכותרות ולהסברים בפקדי הניהול,
   בדיוק כמו NOTIF_TYPES לפעמון. את **הנוסח שנשלח** בונה המסד, כי הוא נשלח
   גם למי שאינו פותח/ת את הדשבורד; כאן מדובר בתיאור הסוג בלבד. סוג חדש
   שייכנס למסד ולא יירשם כאן עדיין יופיע ברשימה ועדיין יישלח — הוא פשוט
   לא יקבל תיבת סימון משלו, ולכן שווה לזכור את השורה. */
const REMINDER_KINDS = [
  { kind:'missing_images',    title:'נכסים בלי תמונה',
    sub:'מודעה פעילה שאין בה אף תמונה. זו התזכורת שמחזירה הכי הרבה - מודעה בלי תמונה כמעט לא נפתחת.' },
  { kind:'expiring_listings', title:'תוקף מודעה שנגמר',
    sub:'תוקף ההתקשרות על מודעה פעילה מסתיים בימים הקרובים. מודעה שפג תוקפה יורדת מהמדפים.' },
  { kind:'stale_listings',    title:'מודעות שלא עודכנו מזמן',
    sub:'מודעה פעילה שלא עודכנה ולא הוקפצה חודשיים. עדכון או הקפצה מחזירים אותה לראש המדף.' },
  { kind:'idle_listings',     title:'שבוע בלי נכס חדש',
    sub:'לא נכנסה מודעה חדשה מזה זמן. זו התזכורת היחידה שאינה על נכס מסוים אלא על הקצב.' },
  { kind:'video_opportunity', title:'נכסים בלי סרטון או סיור',
    sub:'טיפ ולא משימה, ולכן הוא חוזר לכל היותר פעם בחודש גם כשהתדירות יומית.' },
];

const REMINDER_BY_KIND = new Map(REMINDER_KINDS.map(k => [k.kind, k]));

/* ברירות המחדל **זהות לאלה שבמסד** (‏agent_reminder_due_agents): סוכן/ת בלי
   שורת העדפות מקבל/ת מייל, שבועי, שש הודעות ב-30 יום ושקט 21→8. אילו הצד
   הזה היה מציג ברירת מחדל אחרת, הטופס היה "משנה" הגדרה עוד לפני שנגעו בו. */
const REMINDER_PREF_DEFAULTS = {
  channels: ['email'],
  muted_kinds: [],
  cadence: 'weekly',
  max_per_30_days: 6,
  quiet_from_hour: 21,
  quiet_to_hour: 8,
};

let reminderFindings = [];
let reminderPrefs = { ...REMINDER_PREF_DEFAULTS };

async function loadReminders(agentId){
  /* שתי הקריאות במקביל — הן אינן תלויות זו בזו, והקטגוריה הזו יושבת בהגדרות
     החשבון ולא במסך הראשון. שגיאה בשתיהן משמעה שהמיגרציה עוד לא רצה על המסד,
     ואז הקטגוריה מציגה מצב ריק ולא שוברת את הדשבורד. */
  const [findings, prefs] = await Promise.all([
    sb.rpc('agent_reminder_findings', { p_agent_id: agentId }),
    sb.from('agent_reminder_preferences')
      .select('channels, muted_kinds, cadence, max_per_30_days, quiet_from_hour, quiet_to_hour')
      .eq('agent_id', agentId).maybeSingle(),
  ]);

  if (findings.error){
    console.warn('טעינת התזכורות נכשלה:', findings.error.message);
    reminderFindings = [];
  } else {
    reminderFindings = findings.data || [];
  }

  const row = (!prefs.error && prefs.data) ? prefs.data : null;
  reminderPrefs = {
    channels:        Array.isArray(row?.channels)    ? row.channels    : REMINDER_PREF_DEFAULTS.channels.slice(),
    muted_kinds:     Array.isArray(row?.muted_kinds) ? row.muted_kinds : [],
    cadence:         row?.cadence ?? REMINDER_PREF_DEFAULTS.cadence,
    max_per_30_days: Number.isFinite(Number(row?.max_per_30_days))
                       ? Number(row.max_per_30_days) : REMINDER_PREF_DEFAULTS.max_per_30_days,
    quiet_from_hour: Number.isFinite(Number(row?.quiet_from_hour))
                       ? Number(row.quiet_from_hour) : REMINDER_PREF_DEFAULTS.quiet_from_hour,
    quiet_to_hour:   Number.isFinite(Number(row?.quiet_to_hour))
                       ? Number(row.quiet_to_hour) : REMINDER_PREF_DEFAULTS.quiet_to_hour,
  };

  renderReminders();
  renderReminderPrefs();
  loadReminderLastSent(agentId);
}

/* המונה על הקטגוריה סופר רק את מה שיש לטפל בו. ‏accSetCount הוא מקור המספרים
   לכל הניווטים, ולכן אין מצב שהתגית אומרת 3 והרשימה מציגה 2. */
function renderReminders(){
  const el = document.getElementById('remindersList');
  if (!el) return;

  if (!reminderFindings.length){
    el.innerHTML = '<div class="empty-state" style="padding:18px">הכול מסודר - אין כרגע מה להזכיר.</div>';
    accSetCount('accReminders', '');
    return;
  }

  el.innerHTML = '';
  reminderFindings.forEach(f=>{
    const muted = reminderPrefs.muted_kinds.includes(f.kind);
    const meta = REMINDER_BY_KIND.get(f.kind);
    const item = document.createElement('div');
    item.className = 'rm-item' + (muted ? ' is-muted' : '');
    /* ‏esc() על הכל: הכותרת והגוף נבנים במסד ולא כאן, והם נושאים מספרים
       ושמות שדות — תוכן שלא נוצר במסך הזה ולכן לא נסמך. */
    item.innerHTML =
      '<div class="rm-head"><span class="rm-title">' + esc(meta ? meta.title : f.title) + '</span>'
      + (f.subject_count ? '<span class="rm-badge">' + esc(String(f.subject_count)) + '</span>' : '')
      + (muted ? '<span class="rm-badge">הודעות כבויות</span>' : '')
      + '</div>'
      + '<p class="rm-body">' + esc(f.body) + '</p>';

    /* אותו מזהה קטגוריה שהמייל מקבל (‏action_acc במסד). קטגוריה שאינה גלויה
       לתפקיד הזה לא מקבלת כפתור — נחיתה רכה עדיפה על קפיצה לשום מקום. */
    if (f.action_acc && navAccVisible(f.action_acc)){
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'rm-go';
      go.textContent = 'לטיפול בזה ←';
      go.addEventListener('click', ()=> gotoSection(f.action_acc));
      item.appendChild(go);
    }
    el.appendChild(item);
  });

  accSetCount('accReminders', reminderFindings.length);
}

function renderReminderPrefs(){
  const cadence = document.getElementById('rmCadence');
  if (!cadence) return;

  document.getElementById('rmChEmail').checked    = reminderPrefs.channels.includes('email');
  document.getElementById('rmChWhatsapp').checked = reminderPrefs.channels.includes('whatsapp');
  cadence.value = ['daily','weekly','off'].includes(reminderPrefs.cadence) ? reminderPrefs.cadence : 'weekly';
  document.getElementById('rmCap').value = reminderPrefs.max_per_30_days;

  // שתי רשימות של 24 שעות. נבנות בקוד ולא ב-HTML כדי שלא יהיו 48 שורות
  // ידניות שמישהו יצטרך לתחזק.
  [['rmQuietFrom', reminderPrefs.quiet_from_hour], ['rmQuietTo', reminderPrefs.quiet_to_hour]]
    .forEach(([id, value])=>{
      const sel = document.getElementById(id);
      if (sel.options.length !== 24){
        sel.innerHTML = '';
        for (let h = 0; h < 24; h++){
          const o = document.createElement('option');
          o.value = String(h);
          o.textContent = String(h).padStart(2,'0') + ':00';
          sel.appendChild(o);
        }
      }
      sel.value = String(value);
    });

  renderReminderKinds();
  syncReminderChannelsNote();
}

function renderReminderKinds(){
  const el = document.getElementById('reminderKindsList');
  if (!el) return;
  el.innerHTML = '';
  REMINDER_KINDS.forEach(k=>{
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" class="rmKind" value="${esc(k.kind)}"
        ${reminderPrefs.muted_kinds.includes(k.kind) ? '' : 'checked'}>
      <span><span class="np-title">${esc(k.title)}</span><span class="np-sub">${esc(k.sub)}</span></span>`;
    el.appendChild(label);
  });
}

/* ההערה מתחת לערוצים אומרת את המצב בפועל ולא אזהרה כללית: מה קורה כשאין אף
   ערוץ, ומה חסר כדי שהוואטסאפ יעבוד. סוכן/ת שסימן/ה וואטסאפ בלי מספר מאומת
   היה/הייתה מחכה להודעה שלא תגיע לעולם. */
function syncReminderChannelsNote(){
  const note = document.getElementById('rmChannelsNote');
  if (!note) return;
  const email = document.getElementById('rmChEmail').checked;
  const wa = document.getElementById('rmChWhatsapp').checked;
  const parts = [];
  if (!email && !wa) parts.push('בלי ערוץ מסומן לא תישלח שום הודעה - הרשימה למעלה ממשיכה להתעדכן כרגיל.');
  if (wa && !(currentAgent && currentAgent.phone))
    parts.push('לוואטסאפ צריך מספר שמור בקטגוריית "העוזר בוואטסאפ".');
  if (email && !(currentAgent && currentAgent.email))
    parts.push('לא נמצאה כתובת מייל בפרטי הסוכן/ת.');
  note.textContent = parts.join(' ');
}

/* "ההודעה האחרונה נשלחה ב…" — הדבר היחיד שאי אפשר להסיק מהטופס עצמו, והוא
   מה שעונה על "האם זה בכלל עובד". קריאה נפרדת וקצרה, ושגיאה בה שותקת: זו
   שורת מידע ולא פקד. */
async function loadReminderLastSent(agentId){
  const el = document.getElementById('rmLastSent');
  if (!el) return;
  const { data, error } = await sb
    .from('agent_reminder_log')
    .select('created_at, sent_at, email_status, whatsapp_status')
    .eq('agent_id', agentId)
    .order('created_at', { ascending:false })
    .limit(1)
    .maybeSingle();

  if (error || !data){ el.textContent = ''; return; }
  const when = data.sent_at || data.created_at;
  const channels = [
    data.email_status === 'sent' ? 'מייל' : null,
    data.whatsapp_status === 'sent' ? 'וואטסאפ' : null,
  ].filter(Boolean);
  el.textContent = channels.length
    ? 'ההודעה האחרונה נשלחה ב-' + new Date(when).toLocaleString('he-IL') + ' (' + channels.join(' + ') + ').'
    : 'ההודעה האחרונה נרשמה ב-' + new Date(when).toLocaleString('he-IL') + ' ולא יצאה באף ערוץ.';
}

['rmChEmail','rmChWhatsapp'].forEach(id=>{
  document.getElementById(id).addEventListener('change', syncReminderChannelsNote);
});

document.getElementById('reminderPrefsForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentAgent) return;
  const btn = document.getElementById('saveReminderPrefsBtn');
  const feedback = document.getElementById('reminderPrefsFeedback');
  btn.disabled = true; btn.textContent = 'שומר…'; feedback.textContent = '';

  const channels = [];
  if (document.getElementById('rmChEmail').checked) channels.push('email');
  if (document.getElementById('rmChWhatsapp').checked) channels.push('whatsapp');

  const checked = new Set(Array.from(document.querySelectorAll('.rmKind:checked')).map(cb => cb.value));
  /* אותו היגיון כמו ב"ניהול התראות": נשמרת רשימת ה**מושתקים**, וסוג שלא הוצג
     בטופס (סוג שנוסף במסד וטרם נרשם ב-REMINDER_KINDS) שומר על מצבו הקודם
     ולא "נדלק" בשקט בשמירה. */
  const shown = REMINDER_KINDS.map(k => k.kind);
  const muted = reminderPrefs.muted_kinds
    .filter(kind => !shown.includes(kind))
    .concat(shown.filter(kind => !checked.has(kind)));

  // ‏clamp ולא הסתמכות על האילוץ במסד: 200 בשדה מספרי היה חוזר כשגיאת
  // constraint מנוסחת באנגלית, ואין שום סיבה שהסוכן/ת יראה/תראה אותה.
  const cap = Math.min(60, Math.max(0, Math.round(Number(document.getElementById('rmCap').value) || 0)));

  const payload = {
    agent_id: currentAgent.id,
    channels,
    muted_kinds: muted,
    cadence: document.getElementById('rmCadence').value,
    max_per_30_days: cap,
    quiet_from_hour: Number(document.getElementById('rmQuietFrom').value),
    quiet_to_hour: Number(document.getElementById('rmQuietTo').value),
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('agent_reminder_preferences')
    .upsert(payload, { onConflict: 'agent_id' });

  btn.disabled = false; btn.textContent = 'שמירת ההעדפות';
  if (error){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאה: ' + error.message;
    return;
  }

  reminderPrefs = {
    channels, muted_kinds: muted, cadence: payload.cadence,
    max_per_30_days: cap,
    quiet_from_hour: payload.quiet_from_hour,
    quiet_to_hour: payload.quiet_to_hour,
  };
  document.getElementById('rmCap').value = cap;
  // הרשימה נצבעת מחדש כי ההשתקה משנה את המצב של השורות (‏is-muted), לא את
  // תוכנן
  renderReminders();

  feedback.style.color = 'var(--blue)';
  feedback.textContent = payload.cadence === 'off' || !channels.length || cap === 0
    ? 'נשמר - לא יישלחו הודעות תזכורת.'
    : 'נשמר - ' + (payload.cadence === 'daily' ? 'עד הודעה ביום' : 'עד הודעה בשבוע')
      + ', לכל היותר ' + cap + ' ב-30 יום.';
  setTimeout(()=>{ feedback.textContent=''; }, 3000);
});

/* ==========================================================================
   דשבורד הביצועים של הסוכן/ת
   --------------------------------------------------------------------------
   כל מה שכאן מחושב מהנתונים שכבר נטענו לדשבורד (dashProperties/
   currentAgent) — אין שאילתה נוספת ל-Supabase ואין נתון מומצא. אם עוד לא
   הגיעו נתונים, הכרטיסים מציגים אפס ומסבירים למה.
   ========================================================================== */

let dashProperties = [];

/* עמלת התיווך המקובלת: 2% ממחיר המכירה, או דמי שכירות של חודש אחד.
   זה אומדן פוטנציאל בלבד — לא התחייבות ולא הכנסה בפועל. */
const COMMISSION_SALE_RATE = 0.02;

const DASH_ICONS = {
  building:'<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/>',
  flame:'<path d="M12 2s4 4.5 4 8a4 4 0 0 1-8 0c0-1 .4-2 .4-2S6 11 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12Z"/>',
  wallet:'<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/><circle cx="17.5" cy="15" r="1.3"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  layers:'<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  contact:'<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="8" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.6"/><line x1="15.4" y1="6.4" x2="8.6" y2="10.5"/>',
  bank:'<line x1="3" y1="21" x2="21" y2="21"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m12 3 9 5H3Z"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  article:'<path d="M4 4h12a2 2 0 0 1 2 2v13a2 2 0 0 0 2-2V8"/><path d="M18 21H5a2 2 0 0 1-2-2V4"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/>',
  menu:'<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  grip:'<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  clock:'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  chevRight:'<polyline points="9 18 15 12 9 6"/>',
  chevLeft:'<polyline points="15 18 9 12 15 6"/>',
  home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2Z"/>',
  dots:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  shield:'<path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  sliders:'<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  brush:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  chat:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z"/>',
  rss:'<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.6"/>',
  alert:'<path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  gauge:'<path d="M3 14a9 9 0 0 1 18 0"/><path d="m12 14 4-4"/><path d="M3 14v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/>',
  handshake:'<path d="m11 17 2 2a1 1 0 0 0 1.4 0l2.6-2.6"/><path d="m14 14 2.5 2.5"/><path d="M3 10 7 6l4 3 3-1 7 4v5l-3 2-4-3"/><path d="M3 10v5l3 2"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5Z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  chart:'<path d="M3 3v18h18"/><path d="m7 14 3.5-3.5 3 3L20 7"/>',
  /* שלושת האייקונים של כותרות הקבוצות בתפריט: מה שעושים (תיק), במה
     משתמשים (מפתח ברגים) ומה שמגדירים (גלגל שיניים) */
  briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/>',
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-8 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-8l-3.7 3.9Z"/>',
  /* גלגל שיניים ולא שמש: הטבעת החיצונית היא ההבדל בין השניים בגודל 18px */
  cog:'<circle cx="12" cy="12" r="2.8"/><circle cx="12" cy="12" r="7.2"/><path d="M19.2 12h2.4"/><path d="M2.4 12h2.4"/><path d="M12 4.8V2.4"/><path d="M12 19.2v2.4"/><path d="m17.1 6.9 1.7-1.7"/><path d="m5.2 18.8 1.7-1.7"/><path d="m17.1 17.1 1.7 1.7"/><path d="m5.2 5.2 1.7 1.7"/>',
  sign:'<path d="M3 19c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 3 3"/><path d="M8.5 13.5 17 5a2.1 2.1 0 0 1 3 3l-8.5 8.5"/><path d="m14.5 7.5 3 3"/>',
  /* טלפון עם חץ פנימה — "התקנת האפליקציה" בתפריט. חץ הורדה רגיל היה
     נקרא כהורדת קובץ, וכאן לא יורד שום קובץ: האתר נוסף למסך הבית. */
  install:'<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7"/><path d="m9 11 3 3 3-3"/>',
};

function dashIcon(name, cls){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
         'stroke-linejoin="round" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' +
         (DASH_ICONS[name] || '') + '</svg>';
}

/* ---------- גלילה שמעמידה את ראש האלמנט מתחת לכותרת הדביקה ----------
   ‏scrollIntoView לבדו היה מסתיר את השורה הראשונה מתחת לכותרת, ולכן
   מחשבים את ההיסט ידנית. */
function scrollToTopOf(el){
  if (!el) return;
  const header = document.querySelector('#dashboard header.crm');
  const offset = (header ? header.offsetHeight : 0) + 14;
  const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: navReduceMotion() ? 'auto' : 'smooth' });
}

/* ---------- ניווט מהדשבורד אל הקטגוריה המלאה ----------
   ‏opts.scrollTo הוא בורר לאלמנט בתוך הקטגוריה שאליו גוללים במקום לראש
   הקטגוריה — למי שהיעד שלו הוא פאנל מסוים בתוכה ולא הכותרת. */
function gotoSection(accId, focusId, opts){
  // במובייל הקטגוריה עשויה לשבת בלשונית אחרת של הסרגל התחתון. גלילה
  // לאלמנט מוסתר מגיעה לשום מקום, ולכן המעבר ללשונית קודם לכל השאר —
  // כאן ולא אצל הקוראים, כי הקוראים הם גם התראות הפעמון, גם data-goto
  // וגם כרטיסי המדדים.
  if (navFilterActive()){
    const tab = NAV_TAB_OF.get(accId) || 'more';
    if (tab !== navTab) setNavTab(tab, { silent:true });
  }
  const el = openAcc(accId);
  if (!el) return;
  const reduce = navReduceMotion();
  // ‏getClientRects: פאנל שעוד לא הוצג (‏display:none) מחזיר קופסה ריקה,
  // וגלילה אליו הייתה נוחתת על ערך השגוי של pageYOffset. במקרה כזה ראש
  // הקטגוריה הוא היעד — הוא תמיד על המסך ברגע הזה.
  const inner = opts && opts.scrollTo ? document.querySelector(opts.scrollTo) : null;
  scrollToTopOf(inner && inner.getClientRects().length ? inner : el);
  if (focusId){
    setTimeout(()=>{
      const target = document.getElementById(focusId);
      if (target) target.focus({ preventScroll:true });
    }, reduce ? 0 : 420);
  }
}

document.addEventListener('click', (e)=>{
  const trigger = e.target.closest('[data-goto]');
  if (!trigger || !document.getElementById('dashboard').contains(trigger)) return;
  gotoSection(trigger.dataset.goto, trigger.dataset.focus);
});

/* ==========================================================================
   מפת הדשבורד — מקור אמת אחד לשלושה ניווטים
   --------------------------------------------------------------------------
   סרגל הצד (דסקטופ), הסרגל התחתון (מובייל) ותפריט הבורגר נבנים כולם מהמבנה
   הזה. קודם כל אחד מהם החזיק רשימת קטגוריות משלו, ולכן קטגוריה חדשה נכנסה
   לאחד ונשכחה בשניים — וגריד "הפעולות המהירות" הפך לעותק שלישי של אותה
   רשימה בדיוק, מעל אותם אקורדיונים.

   ‏tab הוא הלשונית בסרגל התחתון שהקטגוריה שייכת אליה. כל <details class="acc">
   שאינו מופיע כאן נופל אוטומטית ל"עוד" — קטגוריה חדשה בקוד לא תיעלם מהניווט
   גם אם שכחו לרשום אותה כאן.

   את הגלוּיוּת בפועל קובע ה-DOM (ראו navAccVisible): קטגוריה שיושבת בתוך
   managerSection מוסתר לא תופיע, בלי לשכפל כאן את כללי ההרשאות.
   ========================================================================== */
const NAV_HOME = '__home';
const NAV_ADMIN_HOME = '__adminHome';

/* שלוש קבוצות ולא חמש. הרשימה לא התקצרה — היא הפסיקה להיות טור אחד ארוך:
   בתפריט הבורגר כל קבוצה מתקפלת (ראו buildMenuPanel), ורק זו שנמצאים בה
   פתוחה. חמש כותרות מעל עשרים ושניים פריטים היו חמישה גבולות שאף אחד לא
   נעצר בהם; שלוש קבוצות הן חלוקה שאפשר לזכור: מה שעושים, במה משתמשים,
   ומה שמגדירים פעם בחודש. */
const NAV_GROUPS = [
  /* סדר הפריטים כאן הוא סדר יום העבודה ולא סדר הקוד: קודם הנכסים, אחריהם
     הלקוחות והלידים שהם מייצרים, ואז ההתאמות, ההסכמים והמידע התכנוני. */
  { key:'work', label:'פעילות עסקית', icon:'briefcase', items:[
    /* דף הבית אינו "עוד סעיף ברשימה" אלא הדרך חזרה, ולכן הוא מצויר כפתור
       הפוך (ראו .menu-item.is-home) ונושא את שם הלשונית בסרגל התחתון. */
    { acc:NAV_HOME,              label:'ראשי',              icon:'home',     tab:'home' },
    { acc:'accProperties',       label:'הנכסים שלי',        icon:'building', tab:'props' },
    { acc:'accClients',          label:'קובץ הלקוחות',      icon:'contact',  tab:'clients' },
    /* לשונית הלידים היא שתי קטגוריות בלבד: מה ששלי, ומה שאפשר לקנות.
       מדפי המשכנתאות ומחפשי הדירה אינם קטגוריות נפרדות עוד — הם מגירות
       בתוך חנות הלידים (ראו #shelfTabs). */
    { acc:'accLeads',            label:'הלידים שלי',        icon:'inbox',    tab:'leads' },
    { acc:'accAlerts',           label:'התראות התאמה',      icon:'target',   tab:'clients' },
    /* ‏focus על שדה החיפוש שם את הסמן במקום שאליו באו — לא בראש רשימה
       שצריך לגלול */
    { acc:'accAgreements',       label:'הסכמים והחתמות',    icon:'sign',     tab:'docs', focus:'agrSearch' },
    { acc:'accPlanning',         label:'מידע תכנוני',       icon:'map',      tab:'more' },
    { acc:'accDealsLookup',      label:'עסקאות באזור',      icon:'chart',    tab:'more' },
    { acc:'accLeadShelf',        label:'חנות הלידים',       icon:'layers',   tab:'leads' },
  ]},
  { key:'tools', label:'כלים וצוות', icon:'wrench', items:[
    { acc:'accReports',  label:'דוחות וביצועים', icon:'chart', tab:'more' },
    { acc:'accReviews',  label:'ביקורות לאישור', icon:'star',  tab:'more' },
    { acc:'accTeam',     label:'צוות המשרד',     icon:'users', tab:'more' },
    /* נכסים ששותפו איתי הם עבודה של שיתוף פעולה ולא רשימת הנכסים שלי,
       ולכן הם כאן ליד צוות המשרד ולא בין תשעת הפריטים של יום העבודה. */
    { acc:'accSharedWithMe', label:'שותף איתי',      icon:'share', tab:'props' },
  ]},
  /* משרדי שת״פ והנכסים מוואטסאפ הם הגדרה שמבצעים פעם אחת ולא עבודה יומית,
     ולכן הם יושבים כאן ולא בין הנכסים. ‏tab:'more' ולא 'props' כדי שהקטגוריה
     בעמוד תשב באותה לשונית שבה התפריט מבטיח אותה.

     שלושת הפריטים שלפני סגירת החשבון הם שרשרת אחת: עיצוב דף הסוכן/ת, עיצוב
     דף המשרד ואז ניהול ההתראות — מה שמגדירים פעם אחת ולא חוזרים אליו. */
  { key:'account', label:'הגדרות חשבון', icon:'cog', items:[
    { acc:'accWallet',        label:'יתרת ארנק',         icon:'wallet',   tab:'more' },
    { acc:'accEthics',        label:'הקוד האתי',         icon:'shield',   tab:'more' },
    { acc:'accPrefs',         label:'העדפות לידים',      icon:'sliders',  tab:'more' },
    { acc:'accReminders',     label:'תזכורות וטיפים',    icon:'clock',    tab:'more' },
    { acc:'accSharePartners', label:'משרדי שיתוף פעולה', icon:'handshake',tab:'more' },
    { acc:'accWhatsapp',      label:'העוזר בוואטסאפ',    icon:'chat',     tab:'more' },
    { acc:'accProfile',       label:'פרטי הסוכן/ת',      icon:'user',     tab:'more' },
    { acc:'accBranding',      label:'עיצוב דף המשרד',    icon:'brush',    tab:'more' },
    { acc:'accNotifPrefs',    label:'ניהול התראות',      icon:'bell',     tab:'more' },
    /* אחרון בקבוצה, ובכוונה: הדרך החוצה קיימת ואינה מוסתרת, אבל היא גם לא
       שכנה של פעולה שעושים כל יום. */
    { acc:'accCloseAccount',  label:'סגירת החשבון',      icon:'alert',    tab:'more' },
  ]},
  /* כלי הפלטפורמה יושבים בקבוצה משלהם ומופיעים אך ורק בתצוגת מנהל/ת. זו כל
     הנקודה: הם עבודה של תפקיד אחר, ולא היה רגע שבו סוכן/ת רצה/תה לראות
     "ניהול מקורות RSS" בין "הנכסים שלי" ל"הלידים שלי". */
  { key:'admin', label:'ניהול מערכת', icon:'shield', adminOnly:true, items:[
    { acc:NAV_ADMIN_HOME,     label:'לוח בקרה חודשי', icon:'gauge',   tab:'admin' },
    { acc:'accRefundQueue',   label:'בקשות החזר',     icon:'alert',   tab:'admin' },
    { acc:'accLicenseAppeals', label:'ערעורי רישיון', icon:'shield',  tab:'admin' },
    { acc:'accSubscriptions', label:'מנויים ומסלולים', icon:'shield',  tab:'admin' },
    { acc:'accNeighborhoods', label:'ניהול שכונות',   icon:'map',     tab:'admin' },
    { acc:'accDealsImport',   label:'ייבוא עסקאות',   icon:'chart',   tab:'admin' },
    { acc:'accRssSources',    label:'מקורות RSS',     icon:'rss',     tab:'admin' },
    { acc:'accArticles',      label:'כתבות ובלוגים',  icon:'article', tab:'admin' },
    { acc:'accProfessionals', label:'בעלי מקצוע',     icon:'user',    tab:'admin' },
    { acc:'accUnroutedLeads', label:'לידים ללא יעד',  icon:'alert',   tab:'admin' },
  ]},
];

const NAV_TABS = [
  { key:'home',    label:'ראשי',   icon:'home' },
  { key:'props',   label:'נכסים',  icon:'building' },
  { key:'leads',   label:'לידים',  icon:'flame' },
  { key:'clients', label:'לקוחות', icon:'contact' },
  { key:'docs',    label:'הסכמים', icon:'sign' },
  { key:'more',    label:'עוד',    icon:'dots' },
];

/* אילו קטגוריות מצדיקות תגית אדומה. "אדום = דורש ממך פעולה עכשיו", ולכן מדף
   הלידים (הזדמנות, לא חוב) ויתרת הארנק אינם כאן. */
const NAV_HOT_ACCS = new Set(['accLeads','accAlerts','accReviews','accUnroutedLeads','accLicenseAppeals']);
const NAV_TAB_BADGE = {
  props:   [],
  leads:   ['accLeads'],
  clients: ['accAlerts'],
  /* ‏docs נשארת בלי תגית אדומה בכוונה: המונה שם הוא "ממתינים לחתימה", וזו
     המתנה ללקוח/ה ולא חוב של הסוכן/ת. */
  docs:    [],
  more:    ['accReviews'],
};

/* accId → הלשונית שהוא שייך אליה */
const NAV_TAB_OF = new Map();
NAV_GROUPS.forEach(g => g.items.forEach(it => NAV_TAB_OF.set(it.acc, it.tab)));

/* המונים של הקטגוריות. accSetCount כותב לכאן, וכל מי שמציג מספר (סרגל הצד,
   הסרגל התחתון, בלוק המשימות, כרטיס הלידים החמים) קורא מכאן — ולכן אין מצב
   שבו התגית אומרת 3 והרשימה מציגה 2. */
const accCounts = {};

let dashView = 'agent';   // 'agent' | 'admin'
let navTab   = 'home';

function accCountOf(accId){
  const n = Number(accCounts[accId]);
  return Number.isFinite(n) ? n : 0;
}

/* קטגוריה "גלויה" = היא קיימת ב-DOM ואף אב שלה אינו מוסתר. זו הבדיקה
   שמכניסה ומוציאה את managerSection ואת platformAdminSection
   משלושת הניווטים בבת אחת. ‏offsetParent אינו שמיש כאן, כי הוא מחזיר null גם
   לקטגוריה שהסינון עצמו הסתיר — ואז הניווט היה מוחק את הלשונית שהוא מציג. */
function navAccVisible(accId){
  const el = document.getElementById(accId);
  if (!el || el.style.display === 'none') return false;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement){
    if (n.style && n.style.display === 'none') return false;
  }
  return true;
}

function navItemVisible(item){
  if (item.acc === NAV_HOME) return dashView === 'agent';
  if (item.acc === NAV_ADMIN_HOME) return dashView === 'admin';
  return navAccVisible(item.acc);
}

function navGroupsForView(){
  const admin = dashView === 'admin';
  return NAV_GROUPS
    .filter(g => !!g.adminOnly === admin)
    .map(g => ({ key:g.key, label:g.label, icon:g.icon, items:g.items.filter(navItemVisible) }))
    .filter(g => g.items.length);
}

function navReduceMotion(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ---------- סרגל הצד (דסקטופ) ---------- */
function renderSideNav(){
  const nav = document.getElementById('sideNav');
  if (!nav) return;
  nav.innerHTML = '';
  navGroupsForView().forEach(group=>{
    const head = document.createElement('div');
    head.className = 'sn-group';
    head.textContent = group.label;
    nav.appendChild(head);
    group.items.forEach(item=>{
      const count = accCountOf(item.acc);
      const hot = count > 0 && NAV_HOT_ACCS.has(item.acc);
      const isHome = item.acc === NAV_HOME || item.acc === NAV_ADMIN_HOME;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn-item' + (isHome && navTab === 'home' ? ' is-on' : '');
      btn.innerHTML = dashIcon(item.icon, 'sn-ico')
        + '<span class="sn-label">' + esc(item.label) + '</span>'
        + (count ? '<span class="sn-count' + (hot ? ' is-hot' : '') + '">' + esc(String(count)) + '</span>' : '');
      btn.addEventListener('click', ()=> navGo(item));
      nav.appendChild(btn);
    });
  });
}

/* יעד ניווט אחד לכל שלושת הניווטים ולכל הכרטיסים */
function navGo(item){
  if (item.acc === NAV_HOME || item.acc === NAV_ADMIN_HOME){
    setNavTab('home');
    return;
  }
  gotoSection(item.acc, item.focus);   // הוא זה שמעביר ללשונית הנכונה
}

/* ---------- הסרגל התחתון (מובייל) ---------- */
function renderBottomNav(){
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  nav.innerHTML = '';
  NAV_TABS.forEach(tab=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bn-tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(navTab === tab.key));
    const badge = (NAV_TAB_BADGE[tab.key] || [])
      .filter(navAccVisible)
      .reduce((sum, acc) => sum + accCountOf(acc), 0);
    btn.innerHTML = dashIcon(tab.icon)
      + '<span>' + esc(tab.label) + '</span>'
      + '<span class="bn-badge">' + (badge ? esc(badge > 9 ? '9+' : String(badge)) : '') + '</span>';
    btn.addEventListener('click', ()=> setNavTab(tab.key));
    nav.appendChild(btn);
  });
}

/* ---------- הסינון ----------
   פעיל במובייל, ובכל רוחב בתצוגת מנהל/ת. בדסקטופ יש סרגל צד דביק שמראה את
   כל המפה בבת אחת, ואז הסתרת קטגוריות רק מסתירה מידע בלי להרוויח מקום. */
function navFilterActive(){
  return dashView === 'admin' || !window.matchMedia('(min-width:1024px)').matches;
}

function applyNavFilter(){
  const isAdminView = dashView === 'admin';
  const filtering = navFilterActive();
  const showHome = !filtering || navTab === 'home';

  const overview = document.getElementById('overviewBlock');
  if (overview) overview.classList.toggle('nav-off', isAdminView || !showHome);
  const adminPanel = document.getElementById('dashPanelAdmin');
  if (adminPanel) adminPanel.classList.toggle('nav-off', !isAdminView);
  const leadPanel = document.getElementById('dashPanelLeads');
  if (leadPanel) leadPanel.classList.toggle('nav-off', !isAdminView);
  const opsPanel = document.getElementById('dashPanelOps');
  if (opsPanel) opsPanel.classList.toggle('nav-off', !isAdminView);
  const invPanel = document.getElementById('dashPanelInventory');
  if (invPanel) invPanel.classList.toggle('nav-off', !isAdminView);

  document.querySelectorAll('#dashboard details.acc').forEach(acc=>{
    const tab = NAV_TAB_OF.get(acc.id) || 'more';
    const isAdminAcc = tab === 'admin';
    let show;
    if (isAdminView)     show = isAdminAcc;
    else if (isAdminAcc) show = false;
    else if (!filtering) show = true;
    else                 show = (navTab !== 'home' && tab === navTab);
    acc.classList.toggle('nav-off', !show);
  });

  const head = document.getElementById('sectionsHead');
  if (head) head.hidden = filtering || isAdminView;

  // הפס הדביק וה-FAB שייכים לדף הבית בלבד, ומעבר לשונית הוא בדיוק הרגע
  // שבו הם צריכים להיעלם — בלי גלילה שתודיע להם על כך
  updateScrollUi();
  // רכבת שהייתה מוסתרת לא ידעה למדוד את עצמה: ברגע שהיא חוזרת למסך צריך
  // לקבוע מחדש מי בראש המסלול והאם יש בכלל לאן לגלול
  if (typeof syncQuickRail === 'function') syncQuickRail();
}

function setNavTab(key, opts){
  navTab = key;
  applyNavFilter();
  renderBottomNav();
  renderSideNav();
  if (opts && opts.silent) return;
  window.scrollTo({ top:0, behavior: navReduceMotion() ? 'auto' : 'smooth' });
  // לשונית שיש בה קטגוריה אחת בלבד נפתחת מיד: לחיצה נוספת רק כדי לראות את
  // התוכן היחיד שיש שם היא לחיצה מיותרת
  const shown = [...document.querySelectorAll('#dashboard details.acc')]
    .filter(a => !a.classList.contains('nav-off') && navAccVisible(a.id));
  if (shown.length === 1) openAcc(shown[0].id);
}

/* ---------- תצוגת סוכן/ת מול תצוגת מנהל/ת ---------- */
function renderViewSwitch(){
  const sw = document.getElementById('viewSwitch');
  if (!sw) return;
  const isAdmin = !!(currentAgent && currentAgent.is_platform_admin);
  sw.hidden = !isAdmin;
  if (!isAdmin && dashView === 'admin') dashView = 'agent';
  sw.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.view === dashView)));
}

/* ‏opts.initial מסמן את הקריאה האחת שאינה לחיצה על מתג התצוגה אלא סוף
   הטעינה של הדשבורד. היא אינה מאפסת את הלשונית ואינה גוללת לראש הדף:
   ‏showScreen('dashboard') מעלה את המסך שניות לפני שהטעינות מסתיימות, ומי
   שבינתיים בחר/ה לשונית או גלל/ה נזרק/ה בחזרה לראש הדשבורד באמצע הפעולה.
   זו הייתה "הלחיצה הראשונה שלא נתפסת" — והלחיצה השנייה עבדה רק מפני
   שהטעינה כבר הסתיימה. */
function setDashView(view, opts){
  const initial = !!(opts && opts.initial);
  const isAdmin = !!(currentAgent && currentAgent.is_platform_admin);
  dashView = (view === 'admin' && isAdmin) ? 'admin' : 'agent';
  // אזור כלי הפלטפורמה קיים ב-DOM תמיד; מה שקובע אם הוא בעולם הוא כאן בלבד
  const adminSection = document.getElementById('platformAdminSection');
  if (adminSection) adminSection.style.display = (dashView === 'admin') ? 'block' : 'none';
  const adminPanel = document.getElementById('dashPanelAdmin');
  if (adminPanel) adminPanel.hidden = (dashView !== 'admin');
  const leadPanel = document.getElementById('dashPanelLeads');
  if (leadPanel) leadPanel.hidden = (dashView !== 'admin');
  const opsPanel = document.getElementById('dashPanelOps');
  if (opsPanel) opsPanel.hidden = (dashView !== 'admin');
  const invPanel = document.getElementById('dashPanelInventory');
  if (invPanel) invPanel.hidden = (dashView !== 'admin');
  if (!initial) navTab = 'home';
  renderViewSwitch();
  applyNavFilter();
  renderSideNav();
  renderBottomNav();
  const bnav = document.getElementById('bottomNav');
  if (bnav) bnav.hidden = (dashView === 'admin');
  // ארבעת הדוחות נטענים יחד. הם עונים על ארבע שאלות שונות — מה קרה בעסק
  // החודש, מאיפה נכנסים הלידים, מה שבור או איטי, וכמה יש מכל דבר — ומי
  // שנכנס/ת לתצוגת מנהל/ת שואל/ת את כולן.
  //
  // ארבע קריאות RPC במקביל ולא בטור: כל פאנל מתחיל מכווץ, ולכן מי שמחכה
  // לתשובה הוא לרוב רק הכותרת שלו. טעינה בטור הייתה מעכבת את הרביעי
  // בגלל הראשון בלי סיבה.
  if (dashView === 'admin'){
    loadAdminReport();
    loadLeadReport();
    loadOpsReport();
    loadInventoryReport();
  }
  if (!initial) window.scrollTo({ top:0, behavior:'auto' });
}

document.getElementById('viewSwitch').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-view]');
  if (btn) setDashView(btn.dataset.view);
});

/* שינוי רוחב החלון משנה אם הסינון פעיל בכלל — סיבוב מכשיר או גרירת חלון
   חייבים להחזיר את הקטגוריות למקומן ולא להשאיר אותן מוסתרות */
window.addEventListener('resize', ()=>{
  applyNavFilter();
  renderSideNav();
});

/* ==========================================================================
   דורש טיפול מיידי
   --------------------------------------------------------------------------
   הריכוז של מה שהיה מפוזר כתגיות אדומות על כפתורים שונים. כל שורה היא
   קטגוריה קיימת עם המונה שלה, והלחיצה מובילה ישר לטיפול. אין כאן ספירה
   שנייה — הכול מ-accCounts.
   ========================================================================== */
/* ‏cta הוא הפעולה עצמה, ולא עוד דרך להגיע לרשימה: ‏html שלו הוא טקסט
   קבוע מכאן (ולכן מותר לו סימון), ו-run הוא מה שקורה בלחיצה. ‏kind:'wa'
   מלביש עליו את הסמל הירוק של וואטסאפ — הסימן היחיד במסך שאומר "ההודעה
   יוצאת מכאן אל הטלפון שלהם". */
const TODO_ITEMS = [
  /* הכותרת וההקשר הם שורה אחת כל אחד בכרטיס (ראו ‎.todo-title‎), ולכן הם
     נכתבים קצרים כאן ולא נסמכים על חיתוך ב-ellipsis: משפט שנחתך באמצע
     במסך צר הוא משפט שלא נכתב. */
  { acc:'accLeads',    icon:'flame',   tone:'mint',  many:n => n + ' לידים חמים שלא נפתחו',
    one:'ליד חם אחד שלא נפתח',            sub:'הכסף שממתין לטיפול',
    cta:{ html:'פתחו את הליד עכשיו', icon:'flame', run:()=> gotoSection('accLeads') } },
  { acc:'accAlerts',   icon:'target',  tone:'sand',  many:n => n + ' התאמות נכס ללקוחות',
    one:'התאמת נכס אחת ללקוח/ה',          sub:'נכסים שעונים על הדרישות',
    cta:{ kind:'wa', html:'שלח <span class="todo-cta-em">וואטסאפ</span> ללקוח',
          run:()=> openWaShare() } },
  { acc:'accReviews',  icon:'star',    tone:'mint',  many:n => n + ' ביקורות לאישור',
    one:'ביקורת אחת לאישור',              sub:'חוות דעת שממתינות לך',
    cta:{ html:'לאישור הביקורות', icon:'check', run:()=> gotoSection('accReviews') } },
  { acc:'accUnroutedLeads', icon:'alert', many:n => n + ' לידים ללא יעד',
    one:'ליד אחד ללא יעד',                sub:'אין קהל שיקבל אותם',
    cta:{ html:'נתבו אותם לקהל', icon:'target', run:()=> gotoSection('accUnroutedLeads') } },
];

/* הסמל של וואטסאפ עצמו — נתיב מלא ולא קו, ולכן הוא לא עובר דרך dashIcon
   (שכל האייקונים שלו הם fill:none עם stroke). זה הסמל המסחרי של השירות,
   והשימוש בו כאן הוא בדיוק מה שהוא נועד לו: לסמן את הכפתור ששולח הודעה. */
function waGlyph(){
  return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.28-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.18.2-.35.23-.65.08-.3-.15-1.25-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.14-.14.3-.35.45-.53.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.66-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.07.15.2 2.1 3.2 5.08 4.49.7.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.42-.08-.12-.28-.2-.57-.34M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.89 9.89-9.89 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.89-9.88 9.89M20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45h.005c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.49-8.42"/>' +
    '</svg>';
}

/* ---------- גלילת רכבת בחצים ----------
   ‏RTL: הפריט הבא יושב שמאלה, ולכן "הבא" הוא דלתא שלילית. הצעד הוא רוחב
   כרטיס אחד ולא רוחב המסך — רכבת שמדלגת על שניים בכל לחיצה מרגישה שבורה. */
function railScroll(rail, dir){
  if (!rail) return;
  const first = rail.firstElementChild;
  const gap = parseFloat(getComputedStyle(rail).columnGap) || 10;
  const step = first ? first.getBoundingClientRect().width + gap : rail.clientWidth * .85;
  rail.scrollBy({ left:(dir === 'next' ? -step : step),
                  behavior: navReduceMotion() ? 'auto' : 'smooth' });
}

/* החצים מכבים את עצמם בקצוות: חץ שלא מזיז כלום הוא כפתור שבור. הקשירה
   נעשית פעם אחת לרכבת (‏dataset.railArmed) — ‏renderTodoList נקרא בכל
   שינוי מונה, ובלי השמירה הזו היה נערם מאזין חדש בכל פעם. */
function syncRailNav(rail, nav){
  if (!rail || !nav) return;
  const max = rail.scrollWidth - rail.clientWidth;
  const x = Math.abs(rail.scrollLeft);
  const prev = nav.querySelector('[data-dir="prev"]');
  const next = nav.querySelector('[data-dir="next"]');
  if (prev) prev.disabled = x <= 2;
  if (next) next.disabled = x >= max - 2;
}

function armRail(rail, nav){
  if (!rail || !nav || rail.dataset.railArmed) return;
  rail.dataset.railArmed = '1';
  rail.addEventListener('scroll', ()=> syncRailNav(rail, nav), { passive:true });
  window.addEventListener('resize', ()=> syncRailNav(rail, nav), { passive:true });
}

document.addEventListener('click', (e)=>{
  const arrow = e.target.closest('.rail-arrow[data-rail]');
  if (!arrow) return;
  railScroll(document.getElementById(arrow.dataset.rail), arrow.dataset.dir);
});

function renderTodoList(){
  const host = document.getElementById('todoList');
  if (!host) return;
  host.innerHTML = '';
  const section = document.getElementById('todoSection');
  const nav = document.getElementById('todoRailNav');
  const rows = TODO_ITEMS.filter(item => navAccVisible(item.acc) && accCountOf(item.acc) > 0);

  // ‏is-clear מכווץ את הבלוק לשורת סטטוס אחת ומוריד את הכותרת (ראו CSS).
  // בלוק בגובה מלא שאומר "אין כלום" הוא בדיוק השטח שהפעולות צריכות.
  if (section) section.classList.toggle('is-clear', !rows.length);
  host.classList.toggle('is-single', rows.length === 1);
  if (nav) nav.hidden = rows.length < 2;

  if (!rows.length){
    const clear = document.createElement('div');
    clear.className = 'todo-clear';
    clear.innerHTML = dashIcon('check') + '<span>הכול מטופל</span>';
    host.appendChild(clear);
    return;
  }

  rows.forEach(item=>{
    const n = accCountOf(item.acc);
    const card = document.createElement('article');
    card.className = 'todo-card' + (item.tone ? ' tone-' + item.tone : '');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'todo-row';
    open.innerHTML =
      '<span class="todo-ico">' + dashIcon(item.icon) + '</span>'
      + '<span class="todo-text">'
      +   '<span class="todo-title">' + esc(n === 1 ? item.one : item.many(n)) + '</span>'
      +   '<span class="todo-sub">' + esc(item.sub) + '</span>'
      + '</span>'
      // בלי חץ כאן: הכרטיס נגמר בכפתור פעולה שיש לו חץ משלו, ושני חצים
      // בכרטיס אחד הם רעש — ובמסך צר הם גם 27px שהכותרת צריכה כדי לא
      // להיחתך
      + '<span class="todo-count">' + esc(String(n)) + '</span>';
    open.addEventListener('click', ()=> navGo({ acc:item.acc }));
    card.appendChild(open);

    if (item.cta){
      const wa = item.cta.kind === 'wa';
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'todo-cta' + (wa ? ' todo-cta-wa' : '');
      // ‏html כאן הוא טקסט קבוע מ-TODO_ITEMS ולא נתון מהשרת — ראו ההערה שם
      cta.innerHTML =
        '<span class="todo-cta-logo">' + (wa ? waGlyph() : dashIcon(item.cta.icon || 'chevLeft')) + '</span>'
        + '<span class="todo-cta-label">' + item.cta.html + '</span>'
        + '<svg class="todo-cta-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
      cta.addEventListener('click', ()=> item.cta.run());
      card.appendChild(cta);
    }

    host.appendChild(card);
  });

  // הרשימה נבנית מחדש בכל שינוי מונה — התגים החדשים צריכים משקיף חדש
  armTodoPop();
  armRail(host, nav);
  syncRailNav(host, nav);
}

/* ==========================================================================
   פעולות מהירות
   --------------------------------------------------------------------------
   הגריד הזה היה עותק שלישי של תפריט הניווט: "הנכסים שלי", "הלידים שלי",
   "קובץ הלקוחות" — כולם כבר לשונית בסרגל התחתון, שורה בסרגל הצד ופריט
   בתפריט הבורגר. שלוש דרכים לאותו מקום אינן נגישות, הן רעש; והן גם דחקו
   למטה את מה שבאמת נעשה מהבית.

   שלושת הראשונים הם פעולות טהורות — דברים שקורים עכשיו ואין להם כניסה
   בתפריט: פתיחת נכס חדש, לקוח/ה חדש/ה ושיתוף נכס בוואטסאפ. שלושת האחרונים
   הם קיצורי דרך שנבחרו במפורש (מידע תכנוני, מצא התאמות, חנות הלידים): הם
   כן קיימים בתפריט, אבל אלה שלושת המקומות שאליהם חוזרים מהבית הכי הרבה,
   ושורה בתפריט מקופל אינה אותו דבר ככפתור על המסך הראשון.

   ‏acc הוא רק שער הגלוּיוּת (ראו navAccVisible), ‏run הוא הפעולה עצמה.
   ========================================================================== */

/* פתיחת טופס פנימי שמקופל בתוך קטגוריה: מנווטים לקטגוריה, ורק אז לוחצים על
   כפתור הפתיחה שלה — ורק אם הטופס אכן סגור, כדי שהלחיצה לא תסגור טופס
   שכבר פתוח. ההשהיה היא זמן הגלילה החלקה של gotoSection.

   הגלילה בסוף היא אל ראש הטופס ולא אל מרכזו: טופס הנכס גבוה בהרבה מהמסך,
   ו-block:'center' הביא את אמצעו למרכז החלון — כלומר נחת באמצע השדות
   במקום בשדה הראשון. */
function openInlineForm(accId, formId, toggleId){
  gotoSection(accId);
  const reduce = navReduceMotion();
  setTimeout(()=>{
    const form = document.getElementById(formId);
    const btn  = document.getElementById(toggleId);
    if (!form || !btn) return;
    if (getComputedStyle(form).display === 'none') btn.click();
    const first = form.querySelector('input:not([type=hidden]),select,textarea');
    if (first) first.focus({ preventScroll:true });
    scrollToTopOf(form);
  }, reduce ? 0 : 420);
}

/* ‏tone הוא המשפחה שאליה הפעולה שייכת, ולא קישוט לכל כפתור בנפרד:
   ‏mint לאנשים, ‏sand לנכסים, ‏navy לכסף ולהתחייבות. אותם שלושה גוונים
   בדיוק לובשים גם את שורת המדדים שמעל — ראו ההערה בטוקנים של #dashboard. */
const QUICK_ACTIONS = [
  /* ראשון וניווי מלא: הפעולה היחידה כאן שנגמרת בהתחייבות חתומה, וזו
     שמייצרת את ההכנסה. ‏id נשאר עליה כי ה-FAB הצף וגם אשף ההחתמה מחפשים
     אותה בשם הזה. */
  { acc:'accAgreements', icon:'sign',     tone:'navy', title:'החתם לקוח',
    id:'signClientCta',  aria:'החתם לקוח - הזמנת שירותי תיווך',
    run:()=> openAgreementWizard() },
  { acc:'accClients',    icon:'contact',  tone:'mint', title:'הוסף לקוח',
    run:()=> openInlineForm('accClients', 'addClientForm', 'toggleAddClient') },
  { acc:'accProperties', icon:'building', tone:'sand', title:'הוסף נכס',
    run:()=> openInlineForm('accProperties', 'addPropertyForm', 'toggleAddProperty') },
  { acc:'accProperties', icon:'chat',     tone:'mint', title:'שתף בוואטסאפ',
    run:()=> openWaShare() },
  { acc:'accAlerts',     icon:'target',   tone:'sand', title:'מצא התאמות',
    run:()=> gotoSection('accAlerts') },
  { acc:'accPlanning',   icon:'map',      tone:'navy', title:'מידע תכנוני',
    run:()=> gotoSection('accPlanning') },
  { acc:'accLeadShelf',  icon:'layers',   tone:'mint', title:'חנות הלידים',
    run:()=> gotoSection('accLeadShelf') },
];

function renderQuickActions(){
  const grid = document.getElementById('quickGrid');
  if (!grid) return;
  grid.innerHTML = '';
  QUICK_ACTIONS.filter(a => navAccVisible(a.acc)).forEach(action=>{
    const card = document.createElement('div');
    card.className = 'qa-card qa-' + (action.tone || 'navy');
    card.innerHTML = '<button type="button" class="qa-hit"'
      + (action.id ? ' id="' + action.id + '"' : '')
      + (action.aria ? ' aria-label="' + esc(action.aria) + '"' : '') + '>'
      + '<span class="qa-icon">' + dashIcon(action.icon) + '</span>'
      + '<span class="qa-title">' + esc(action.title) + '</span>'
      + '</button>';
    card.querySelector('.qa-hit').addEventListener('click',
      ()=> action.run ? action.run() : navGo(action));
    grid.appendChild(card);
  });
  armQuickStagger();
  armQuickRail();
  syncQuickRail();
  // ה-FAB נשען על מיקומו של כפתור ההחתמה, והוא נולד מחדש בכל רינדור
  if (typeof updateScrollUi === 'function') updateScrollUi();
}

/* ==========================================================================
   קרוסלת הפעולות — החצים והכפתור שבראש המסלול
   --------------------------------------------------------------------------
   הכפתורים ירדו לרוחב עמודת מדד (ראו ה-CSS של .quick-grid), ושלושה מהם
   ממלאים בדיוק את רוחב המסך. כדי שלא ייראו כמו כל מה שיש, שלוש הרמזים
   שהפונקציות כאן מתחזקות:

     · הרביעי מציץ בקצה — זה ה-CSS לבדו (הרכבת גולשת אל מעבר לשוליים)
     · החצים בשורת הכותרת — מוצגים רק כשיש לאן לגלול, ומכבים את עצמם בקצה
     · ‏.is-lead על הכפתור שבתחילת המסלול — הוא מורם, השאר שטוחים אחריו

   מ-900px זה גריד רגיל ולא רכבת: אין ראש מסלול ואין חצים, ושתי הפונקציות
   מנקות אחריהן במקום להשאיר סימון ממצב קודם.
   ========================================================================== */
function syncQuickRail(){
  const rail = document.getElementById('quickGrid');
  if (!rail) return;
  const nav   = document.getElementById('quickRailNav');
  const cards = [...rail.children];
  const isRail = (getComputedStyle(rail).gridAutoFlow || '').includes('column');
  const scrollable = rail.scrollWidth - rail.clientWidth > 2;

  if (nav){
    nav.hidden = !(isRail && scrollable);
    if (!nav.hidden) syncRailNav(rail, nav);
  }

  if (!isRail || !cards.length){
    cards.forEach(c => c.classList.remove('is-lead', 'is-rear'));
    return;
  }

  /* ‏RTL: תחילת המסלול היא הקצה הימני, ולכן "מי בראש" נמדד במרחק בין הקצה
     הימני של הכרטיס לקצה הימני של הרכבת. מדידה במיקום ולא ב-scrollLeft:
     דפדפנים לא מסכימים על הסימן של scrollLeft ב-RTL. */
  const startX = rail.getBoundingClientRect().right;
  let lead = cards[0], best = Infinity;
  cards.forEach(card=>{
    const d = Math.abs(card.getBoundingClientRect().right - startX);
    if (d < best){ best = d; lead = card; }
  });
  cards.forEach(card=>{
    card.classList.toggle('is-lead', card === lead);
    card.classList.toggle('is-rear', card !== lead);
  });
}

/* מאזין אחד לרכבת ואחד לחלון, שניהם מכוסים ב-requestAnimationFrame:
   הסימון נקרא ממיקומים אמיתיים, וקריאה כזו בכל אירוע גלילה היא בדיוק
   הדרך להפוך גרירה חלקה לגרירה קופצת. ‏dataset שומר שהקשירה תקרה פעם
   אחת — renderQuickActions נקרא מחדש בכל שינוי הרשאות. */
function armQuickRail(){
  const rail = document.getElementById('quickGrid');
  if (!rail || rail.dataset.quickArmed) return;
  rail.dataset.quickArmed = '1';
  let ticking = false;
  const onMove = ()=>{
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ ticking = false; syncQuickRail(); });
  };
  rail.addEventListener('scroll', onMove, { passive:true });
  window.addEventListener('resize', onMove, { passive:true });
}

/* ==========================================================================
   אנימציות הגלילה
   --------------------------------------------------------------------------
   חמש התנהגויות, מנוע אחד: ‏IntersectionObserver למה שנדרך בכניסה לתצוגה,
   ומאזין גלילה יחיד מכוסה ב-requestAnimationFrame למה שתלוי במיקום מדויק
   (הכיווץ וה-FAB). אין כאן ספריית אנימציות — מה שהיא הייתה נותנת כאן הוא
   בדיוק שתי השורות האלה, בתוספת משקל שנטען בכל פתיחה של הדשבורד.

   כלל אחד חוצה את כל הבלוק: ה-CSS מחזיק את שני המצבים, ה-JS רק מוסיף
   ומוריד מחלקה. מי שביקש/ה prefers-reduced-motion מקבל/ת את מצב הסיום
   מיד — הפס הדביק וה-FAB הם ממשק ולא קישוט, ולכן הם נשארים; מה שנעלם הוא
   המעבר אליהם.
   ========================================================================== */

const SCROLL_COMPACT_ON  = 80;   // הרף שממנו מתחיל הכיווץ
const SCROLL_COMPACT_OFF = 56;   // חוזרים למצב מלא רק מתחתיו — בלי זה גלילה
                                 // קטנה סביב 80px הייתה מהבהבת בין המצבים

/* הפס הדביק מציג את אותם שלושה מספרים של רכבת המדדים. הוא מעתיק אותם ולא
   מחשב אותם מחדש: מספר שני שמחושב לבד הוא מספר שיסטה ביום שבו מישהו ישנה
   את הפורמט של אחד מהם. */
function syncStickyKpis(){
  const pairs = [
    ['kpiCommissionValue', 'ksCommission'],
    ['kpiActiveValue',     'ksActive'],
    ['kpiExclusiveValue',  'ksExclusive'],
  ];
  pairs.forEach(([from, to])=>{
    const src = document.getElementById(from);
    const dst = document.getElementById(to);
    if (src && dst && dst.textContent !== src.textContent) dst.textContent = src.textContent;
  });
}

/* דף הבית פעיל = ‏#overviewBlock קיים ולא סונן החוצה. הפס הדביק וה-FAB
   שייכים לו בלבד: בלשונית "נכסים" הם היו מציגים מדדים של מסך אחר. */
function overviewOnScreen(){
  const dash = document.getElementById('dashboard');
  const block = document.getElementById('overviewBlock');
  if (!dash || !block) return false;
  if (dash.style.display === 'none') return false;
  return !block.classList.contains('nav-off');
}

/* ---------- 1 + 3: הכיווץ ל-Sticky Bar וה-FAB ---------- */
function updateScrollUi(){
  const dash = document.getElementById('dashboard');
  const sticky = document.getElementById('kpiSticky');
  const fab = document.getElementById('signClientFab');
  const cta = document.getElementById('signClientCta');
  if (!dash) return;

  const live = overviewOnScreen();
  const y = window.pageYOffset || document.documentElement.scrollTop || 0;
  const wasCompact = dash.classList.contains('is-compact');
  const compact = live && (wasCompact ? y > SCROLL_COMPACT_OFF : y > SCROLL_COMPACT_ON);

  if (compact !== wasCompact) dash.classList.toggle('is-compact', compact);
  if (sticky){
    sticky.classList.toggle('is-on', compact);
    // ‏aria-hidden ולא רק גובה 0: המספרים כאן הם כפילות של רכבת המדדים,
    // וקורא מסך שיקריא את שניהם יקריא את אותו דבר פעמיים
    sticky.setAttribute('aria-hidden', String(!compact));
    if (compact) syncStickyKpis();
  }

  /* ה-FAB נכנס כשהכרטיס הרחב עומד לצאת מהמסך מלמעלה — כלומר כשהקצה
     התחתון שלו עובר מתחת לכותרת הדביקה. בדיקה על המיקום עצמו ולא
     IntersectionObserver, כי גובה הכותרת משתנה בדיוק באותו רגע. */
  if (fab && cta){
    let show = false;
    if (live && cta.offsetParent !== null){
      const header = document.querySelector('#dashboard header.crm');
      const hdrH = header ? header.getBoundingClientRect().height : 0;
      show = cta.getBoundingClientRect().bottom < hdrH + 8;
    }
    fab.hidden = !live || !cta.isConnected;
    fab.classList.toggle('is-on', show);
    // המעטפת ולא הכפתור: היא זו שנושאת את המשטח והצל של הכרטיס
    (cta.closest('.qa-card') || cta).classList.toggle('is-morphed', show);
  } else if (fab){
    // הפעולה מוסתרת לחלוטין (למשל בלי גישה להסכמים) — אין מה להציף
    fab.hidden = true;
    fab.classList.remove('is-on');
  }
}

function initScrollUi(){
  let ticking = false;
  const onScroll = ()=>{
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(()=>{ ticking = false; updateScrollUi(); });
  };
  window.addEventListener('scroll', onScroll, { passive:true });
  window.addEventListener('resize', onScroll, { passive:true });

  const fab = document.getElementById('signClientFab');
  // ה-FAB לא מכיר את אשף ההחתמה: הוא לוחץ על הכרטיס, וכל שינוי עתידי
  // בפעולה נשאר במקום אחד
  if (fab) fab.addEventListener('click', ()=>{
    const cta = document.getElementById('signClientCta');
    if (cta) cta.click();
  });

  updateScrollUi();
}

/* ---------- 2: הבלטת התג האדום בכניסה למרכז המסך ---------- */
/* ‏rootMargin שחותך 45% מלמעלה ומלמטה משאיר רצועה של 10% במרכז המסך —
   התג קופץ כשהשורה עוברת בה, ורק פעם אחת לכל שורה. */
let todoPopObserver = null;

function armTodoPop(){
  if (navReduceMotion()) return;
  if (!('IntersectionObserver' in window)) return;
  if (todoPopObserver) todoPopObserver.disconnect();
  todoPopObserver = new IntersectionObserver((entries, obs)=>{
    entries.forEach(entry=>{
      if (!entry.isIntersecting) return;
      const el = entry.target;
      obs.unobserve(el);
      el.classList.add('is-pop');
      el.addEventListener('animationend', ()=> el.classList.remove('is-pop'), { once:true });
    });
  }, { rootMargin:'-45% 0px -45% 0px', threshold:0 });
  document.querySelectorAll('#todoList .todo-count').forEach(el => todoPopObserver.observe(el));
}

/* ---------- 4: כניסה מדורגת של הפעולות המהירות ---------- */
/* ההשהיה היא לפי שורה ולא לפי כרטיס, ומספר העמודות נקרא מהגריד עצמו —
   הוא 2 במובייל, 3 מ-900px ו-4 מ-1400px, ורק ה-CSS יודע מה מהם בתוקף. */
let quickStaggerObserver = null;

function armQuickStagger(){
  const grid = document.getElementById('quickGrid');
  if (!grid || !grid.children.length) return;

  /* בזמן שהגריד מוסתר (‏.nav-off) הדפדפן מחזיר את הערך המוצהר ולא מדוד,
     ובדפדפן שמחזיר "none" נופלים לשתי עמודות — המצב במובייל, ששם ההשהיה
     בכלל נראית.

     ברכבת האופקית (‏grid-auto-flow:column) כל הכפתורים יושבים בשורה אחת,
     ולכן ההשהיה שם היא לפי כפתור ולא לפי שורה: אחרת ששת הכפתורים היו
     נכנסים כגוש אחד. */
  const cs = getComputedStyle(grid);
  const rail = (cs.gridAutoFlow || '').includes('column');
  const track = cs.gridTemplateColumns;
  const cols = (track && track !== 'none') ? track.split(/\s+/).filter(Boolean).length : 2;
  [...grid.children].forEach((card, i)=>{
    const step = rail ? i : Math.floor(i / cols);
    card.style.setProperty('--d', (step * 40) + 'ms');
  });
  grid.classList.add('is-staged');

  if (navReduceMotion() || !('IntersectionObserver' in window)){
    grid.classList.add('is-in');
    return;
  }
  grid.classList.remove('is-in');
  if (quickStaggerObserver) quickStaggerObserver.disconnect();
  quickStaggerObserver = new IntersectionObserver((entries, obs)=>{
    entries.forEach(entry=>{
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      obs.unobserve(entry.target);
    });
  }, { rootMargin:'0px 0px -10% 0px', threshold:0.1 });
  quickStaggerObserver.observe(grid);
}

/* ---------- 5: מילוי עמודות גרף המגמה ---------- */
/* הגרף יושב היום בתוך <details> מקופל, ולכן אין צורך בטריגר נפרד לפתיחה:
   עמודה בתוך אקורדיון סגור היא בגודל אפס ואינה חותכת את התצוגה, ופתיחת
   האקורדיון מייצרת בדיוק את שינוי החיתוך ש-IntersectionObserver מדווח
   עליו. */
let trendGrowthObserver = null;

function armTrendGrowth(){
  const chart = document.getElementById('kpiCommissionSpark');
  if (!chart) return;
  chart.classList.add('is-staged');

  if (navReduceMotion() || !('IntersectionObserver' in window)){
    chart.classList.add('is-grown');
    return;
  }
  chart.classList.remove('is-grown');
  if (trendGrowthObserver) trendGrowthObserver.disconnect();
  trendGrowthObserver = new IntersectionObserver((entries, obs)=>{
    entries.forEach(entry=>{
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-grown');
      obs.unobserve(entry.target);
    });
  }, { threshold:0.25 });
  trendGrowthObserver.observe(chart);
}

initScrollUi();

/* ==========================================================================
   שיתוף נכס בוואטסאפ
   --------------------------------------------------------------------------
   הפעולה שסוכן/ת עושה עשר פעמים ביום, ועד היום דרשה: לפתוח את "הנכסים
   שלי", למצוא את הנכס, לפתוח את דף הנכס, להעתיק כתובת, לעבור לוואטסאפ
   ולהקליד את הפרטים. כאן: בוחרים נכס — ונפתחת וואטסאפ עם הודעה מוכנה.

   ‏wa.me בלי מספר פותח את בורר אנשי הקשר של וואטסאפ, ולכן אין צורך לבחור
   נמען כאן. הרשימה היא הנכסים הפעילים בלבד: דף הנכס באתר מוצג רק לנכס
   פעיל, ולינק לנכס שהוסר הוא לינק שבור.
   ========================================================================== */
function waShareText(p){
  const address = [p.city, [p.street, p.house_number].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const facts = [
    p.rooms ? plural(p.rooms, 'חדר אחד', 'חדרים') : null,
    p.size_sqm ? p.size_sqm + ' מ״ר' : null,
    p.floor != null ? 'קומה ' + p.floor : null,
  ].filter(Boolean).join(' · ');
  return [
    p.title || 'נכס למכירה',
    address,
    p.deal_type === 'rent' ? shekel(p.price) + ' לחודש' : shekel(p.price),
    facts,
    propertyPublicLink(p.id),
  ].filter(Boolean).join('\n');
}

function waShareCandidates(){
  const q = (document.getElementById('waShareSearch').value || '').trim().toLowerCase();
  return dashProperties
    .filter(p => p.status === 'active')
    .filter(p => !q || [p.title, p.city, p.street, p.house_number, p.property_type,
                        p.listing_number].filter(Boolean).join(' ').toLowerCase().includes(q));
}

function renderWaShareList(){
  const host = document.getElementById('waShareList');
  const rows = waShareCandidates();
  if (!rows.length){
    host.innerHTML = '<div class="empty-state">'
      + (dashProperties.some(p => p.status === 'active')
          ? 'אין נכס פעיל שמתאים לחיפוש.'
          : 'אין כרגע נכסים פעילים לשיתוף. נכס מתפרסם באתר ברגע שהוא נשמר כפעיל.')
      + '</div>';
    return;
  }
  host.innerHTML = '';
  rows.forEach(p=>{
    const address = [p.city, [p.street, p.house_number].filter(Boolean).join(' ')]
      .filter(Boolean).join(', ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-pick-row';
    btn.innerHTML = '<span class="wa-pick-text">'
      + '<span class="wa-pick-title">' + esc(p.title || 'נכס ללא כותרת') + '</span>'
      + '<span class="wa-pick-meta">' + esc([address, p.deal_type === 'rent'
          ? shekel(p.price) + ' לחודש' : shekel(p.price)].filter(Boolean).join(' · ')) + '</span>'
      + '</span><span class="wa-pick-go">💬</span>';
    btn.addEventListener('click', ()=>{
      window.open('https://wa.me/?text=' + encodeURIComponent(waShareText(p)),
                  '_blank', 'noopener');
      closeWaShare();
    });
    host.appendChild(btn);
  });
}

function openWaShare(){
  const modal = document.getElementById('waShareModal');
  document.getElementById('waShareSearch').value = '';
  renderWaShareList();
  modal.style.display = 'flex';
  document.getElementById('waShareSearch').focus({ preventScroll:true });
}

function closeWaShare(){
  document.getElementById('waShareModal').style.display = 'none';
}

document.getElementById('waShareSearch').addEventListener('input', renderWaShareList);
document.getElementById('waShareClose').addEventListener('click', closeWaShare);
document.getElementById('waShareModal').addEventListener('click', (e)=>{
  if (e.target.id === 'waShareModal') closeWaShare();
});

/* ---------- ריענון כל מה שתלוי במונים ----------
   accSetCount קורא לכאן, ולכן כל עדכון מונה (ליד חדש, נכס שנוסף, ביקורת
   שאושרה) מתגלגל לכל הצרכנים בלי שאף קורא יצטרך לדעת שהם קיימים. */
function refreshNavCounts(){
  renderTodoList();
  renderBottomNav();
  renderSideNav();
}

/* ---------- מד המכסה החינמית ---------- */
function renderQuotaMeter(freeQuota){
  const bar = document.getElementById('quotaBar');
  const note = document.getElementById('quotaNote');
  if (!bar || !note) return;
  if (!currentAgent || currentAgent.tier !== 'free'){
    bar.style.width = '100%';
    bar.classList.remove('is-full');
    bar.classList.add('is-unlimited');
    note.textContent = 'במסלול שלך לידי קונה/שוכר כלולים ללא הגבלה';
    return;
  }
  const used = quotaUsedThisCycle();
  const pct = freeQuota > 0 ? Math.min(100, Math.round(used / freeQuota * 100)) : 0;
  bar.style.width = pct + '%';
  bar.classList.remove('is-unlimited');
  bar.classList.toggle('is-full', used >= freeQuota);
  note.textContent = used >= freeQuota
    ? 'המכסה החודשית נוצלה - פתיחת ליד נוסף תיגבה מהארנק'
    : (plural(freeQuota - used, 'נותר ליד חינמי אחד', 'לידים חינמיים',
                 'נותרו ' + (freeQuota - used)) + ' עד סוף החודש');
}

/* ---------- מדדי הביצוע ---------- */
function dashActiveProperties(){
  return dashProperties.filter(p => p.status === 'active');
}

function propertyCommission(p){
  const price = Number(p.price) || 0;
  // בהשכרה העמלה המקובלת היא דמי שכירות של חודש; במכירה — אחוז משווי העסקה
  return p.deal_type === 'rent' ? price : price * COMMISSION_SALE_RATE;
}

function shekelShort(n){
  const v = Math.round(Number(n) || 0);
  return '₪' + v.toLocaleString('he-IL');
}

/* מספר מקוצר לעמודה צרה. במדד שרוחבו שליש שורה במסך של 360px אין מקום
   ל-"₪1,240,000" — והמספר המלא שנחתך גרוע מהמספר המעוגל שנקרא. הסכום
   המדויק נשאר ב-title של אותו אלמנט ובכרטיסי הנכסים עצמם. */
function shekelCompact(n){
  const v = Math.round(Number(n) || 0);
  if (v >= 1000000){
    const m = v / 1000000;
    return '₪' + (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10).toLocaleString('he-IL') + ' מ׳';
  }
  if (v >= 10000) return '₪' + Math.round(v / 1000).toLocaleString('he-IL') + ' א׳';
  return '₪' + v.toLocaleString('he-IL');
}

/* סדרת 6 חודשים: לכל חודש, סך הפוטנציאל של הנכסים הפעילים שכבר היו
   מפורסמים בסופו. הסטטוס הידוע לנו הוא הנוכחי, ולכן זו מגמת צבירה של
   התיק הפעיל לפי מועד הפרסום — וכך גם כתוב מתחת לגרף. */
function commissionSeries(props, months){
  months = months || 6;
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--){
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const total = props.reduce((sum, p)=>{
      const created = p.created_at ? new Date(p.created_at) : null;
      return (created && created <= monthEnd) ? sum + propertyCommission(p) : sum;
    }, 0);
    out.push({ label: monthStart.toLocaleDateString('he-IL', { month:'short' }), total });
  }
  return out;
}

/* ספירה קצרה כלפי מעלה — נותנת למספר הגדול תחושת "מד ביצועים" חי.
   מכבדת prefers-reduced-motion ומדלגת ישר לערך הסופי. */
function countUp(el, to, format){
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === to){
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const dur = 650;
  cancelAnimationFrame(Number(el.dataset.raf || 0));
  const step = (t)=>{
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * eased);
    if (k < 1) el.dataset.raf = String(requestAnimationFrame(step));
  };
  el.dataset.raf = String(requestAnimationFrame(step));
}

function renderCommissionCard(active){
  const valueEl = document.getElementById('kpiCommissionValue');
  const noteEl = document.getElementById('kpiCommissionNote');
  const deltaEl = document.getElementById('kpiCommissionDelta');
  if (!valueEl) return;

  const total = active.reduce((s, p)=> s + propertyCommission(p), 0);
  // המספר במדד מקוצר כדי להיקרא ברוחב של שליש שורה; הסכום המלא ב-title
  countUp(valueEl, total, v => shekelCompact(v));
  valueEl.title = shekelShort(total);

  noteEl.textContent = active.length === 0
    ? 'כל נכס שתפרסמו ייכנס למדד הזה'
    : `${Math.round(COMMISSION_SALE_RATE * 1000) / 10}% ממכירה · חודש שכירות מהשכרה`;

  const series = renderCommissionTrend(active, total);

  const prev = series.length > 1 ? series[series.length - 2].total : 0;
  const diff = total - prev;
  if (diff > 0){
    deltaEl.hidden = false;
    deltaEl.textContent = '▲ ' + shekelCompact(diff);
    deltaEl.title = 'עלייה של ' + shekelShort(diff) + ' החודש';
  } else {
    deltaEl.hidden = true;
  }
}

/* ---------- גרף המגמה ----------
   הגרף היה שש עמודות בלי מספר ובלי מקרא, ולכן לא היה ברור מה גובה העמודה
   שווה ולמה אחת מהן זהובה. עכשיו: הסכום הנוכחי בכותרת, אותו סכום כתווית
   מעל העמודה הפעילה (data-value → ‏::after ב-CSS), ומקרא קבוע ב-HTML. */
function renderCommissionTrend(active, total){
  const sparkEl = document.getElementById('kpiCommissionSpark');
  const axisEl = document.getElementById('kpiCommissionAxis');
  const nowEl = document.getElementById('kpiTrendNow');
  const noteEl = document.getElementById('kpiTrendNote');
  const series = commissionSeries(active);
  if (!sparkEl) return series;

  /* הגובה יושב ב---h ולא ב-height: כך אנימציית הגדילה בגלילה (‏.is-staged
     ב-CSS) יכולה להחזיק את העמודה על 0 ולשחרר אותה בכניסה לתצוגה, בלי
     שהמידע עצמו ייכתב פעמיים. ‏--i הוא סדר העמודה, לדירוג ההשהיה. */
  const max = Math.max(...series.map(s => s.total), 1);
  sparkEl.innerHTML = series.map((s, i)=>{
    const h = Math.max(5, Math.round(s.total / max * 100));
    const isNow = i === series.length - 1;
    return `<span class="${isNow ? 'is-now' : ''}" style="--h:${h}%;--i:${i}"`
      + (isNow ? ` data-value="${esc(shekelCompact(s.total))}"` : '')
      + ` title="${esc(s.label)}: ${esc(shekelShort(s.total))}"></span>`;
  }).join('');
  axisEl.innerHTML = series.map(s => `<span>${esc(s.label)}</span>`).join('');
  // הגרף נבנה מחדש בכל טעינת נכסים — האנימציה נדרכת מחדש איתו
  armTrendGrowth();

  if (nowEl){
    nowEl.textContent = shekelShort(total);
    nowEl.title = 'פוטנציאל העמלות בתיק הפעיל כרגע';
  }
  if (noteEl){
    noteEl.textContent = active.length === 0
      ? 'אין כרגע נכסים פעילים - הגרף יתמלא עם הנכס הראשון שתפרסמו.'
      : 'סך העמלה הצפויה מהנכסים הפעילים שכבר היו מפורסמים בסוף כל חודש.';
  }
  return series;
}

/* ---------- נכסים פעילים ----------
   היה שורת הערה בתוך כרטיס העמלות ("12 נכסים פעילים · 8 למכירה…"), ושם אף
   אחד לא קרא אותו. זה המכנה של כל שאר המדדים, ולכן הוא מדד. */
function renderActiveCard(active){
  const valueEl = document.getElementById('kpiActiveValue');
  const noteEl = document.getElementById('kpiActiveNote');
  const deltaEl = document.getElementById('kpiActiveDelta');
  if (!valueEl) return;

  const forRent = active.filter(p => p.deal_type === 'rent').length;
  const forSale = active.length - forRent;

  countUp(valueEl, active.length, v => String(Math.round(v)));
  noteEl.textContent = active.length === 0
    ? 'אין כרגע נכסים פעילים בתיק'
    : `${forSale} מכירה · ${forRent} השכרה`;

  const now = new Date();
  const thisMonth = active.filter(p =>{
    const d = p.created_at ? new Date(p.created_at) : null;
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  deltaEl.hidden = thisMonth === 0;
  if (thisMonth > 0) deltaEl.textContent = '▲ +' + thisMonth;
}

function renderExclusiveCard(active){
  const valueEl = document.getElementById('kpiExclusiveValue');
  const noteEl = document.getElementById('kpiExclusiveNote');
  const deltaEl = document.getElementById('kpiExclusiveDelta');
  const ratioEl = document.getElementById('kpiExclusiveRatio');
  if (!valueEl) return;

  // "בבלעדיות" הוא מאפיין הנכס exclusive — אותו אחד שמסומן בטופס הוספת נכס
  const exclusive = active.filter(p => Array.isArray(p.features) && p.features.includes('exclusive'));
  const pct = active.length ? Math.round(exclusive.length / active.length * 100) : 0;

  countUp(valueEl, exclusive.length, v => String(Math.round(v)));
  noteEl.textContent = active.length === 0
    ? 'סמנו "בבלעדיות" בטופס הנכס'
    : `${pct}% מהתיק (${exclusive.length} מתוך ${active.length})`;

  const now = new Date();
  const thisMonth = exclusive.filter(p =>{
    const d = p.created_at ? new Date(p.created_at) : null;
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  if (thisMonth > 0){
    deltaEl.hidden = false;
    deltaEl.textContent = '▲ +' + thisMonth;
    deltaEl.title = plural(thisMonth, 'נכס אחד בבלעדיות נוסף', 'נכסים בבלעדיות נוספו') + ' החודש';
  } else {
    deltaEl.hidden = true;
  }

  if (ratioEl){
    ratioEl.querySelector('span').style.width = pct + '%';
    ratioEl.setAttribute('aria-label',
      active.length ? pct + '% מהתיק הפעיל בבלעדיות' : 'אין עדיין נכסים פעילים');
  }
}

function renderDashboardOverview(){
  const active = dashActiveProperties();
  renderCommissionCard(active);
  renderActiveCard(active);
  renderExclusiveCard(active);
  renderAgentPanelSummary(active);
  // ‏countUp מגלגל את המספרים לאורך 650ms; הפס הדביק מסתנכרן בסופם
  setTimeout(syncStickyKpis, 700);
  syncStickyKpis();
}

/* תקציר בכותרת הפאנל האישי. הפאנל מתחיל מכווץ, ולכן הכותרת היא מה שרואים
   רוב הזמן — בלי המספרים כאן היא רק שם של משהו סגור. אותו תפקיד בדיוק
   ממלא #adminPanelSub בדשבורד הפלטפורמה. */
function renderAgentPanelSummary(active){
  const sub = document.getElementById('agentPanelSub');
  if (!sub) return;
  if (!active.length){
    sub.textContent = 'אין כרגע נכסים פעילים · לחצו להרחבה';
    return;
  }
  const total = active.reduce((s, p)=> s + propertyCommission(p), 0);
  const exclusive = active.filter(p => Array.isArray(p.features) && p.features.includes('exclusive')).length;
  sub.textContent = shekelShort(total) + ' פוטנציאל · ' + plural(active.length, 'נכס אחד', 'נכסים') + ' · '
    + exclusive + ' בבלעדיות';
}

/* ---------- תפריט הבורגר ----------
   אותה מפה בדיוק שממנה נבנים סרגל הצד והסרגל התחתון (NAV_GROUPS), ולכן אין
   כאן רשימת קטגוריות שנייה. קודם הרשימה נסרקה מה-DOM ישירות, וזה עבד — אבל
   אז כל אחד משלושת הניווטים הכיר את הדשבורד בדרך אחרת.

   הקבוצות כאן מתקפלות, ובסרגל הצד לא: בדסקטופ הרשימה כולה נראית בלי גלילה
   ואין מה לקפל, ובמובייל היא הייתה טור של עשרים ושניים פריטים שנפתח מעל כל
   המסך. הקבוצה שהמשתמש/ת נמצא/ת בה נפתחת לבד — אחריה מה שנשמר בפעם הקודמת. */

const MENU_GROUP_KEY = 'crmMenuGroupsOpen';

function menuGroupsOpen(){
  try {
    const raw = JSON.parse(localStorage.getItem(MENU_GROUP_KEY) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch { return {}; }
}

function menuGroupSetOpen(key, open){
  const state = menuGroupsOpen();
  state[key] = open;
  try { localStorage.setItem(MENU_GROUP_KEY, JSON.stringify(state)); } catch {}
}

/* קבוצה נפתחת אם היא מכילה את הלשונית הנוכחית, ואחרת לפי מה שנשמר. הכלל
   הראשון גובר: מי שנמצא/ת ב"לידים" ופותח/ת את התפריט מחפש/ת שם משהו.

   הלשונית "ראשי" היא היוצא מן הכלל: היא אינה שייכת לאף קבוצה (כפתור הבית
   נעוץ בראש התפריט), ולכן מדף הבית התפריט נפתח סגור כולו — כפתור בית ושלוש
   שורות, ומהן בוחרים לאן. מי שפתח/ה קבוצה ידנית מקבל/ת אותה פתוחה גם
   כאן — זו העדפה מפורשת, לא ניחוש. */
function menuGroupInitiallyOpen(group, saved){
  if (navTab !== 'home' && group.items.some(it => it.tab === navTab)) return true;
  return saved[group.key] === true;
}

function navIsHomeItem(item){
  return item.acc === NAV_HOME || item.acc === NAV_ADMIN_HOME;
}

/* פריט ניווט אחד בתפריט. דף הבית הוא היעד היחיד שאינו קטגוריה בעמוד אלא
   חזרה להתחלה, ולכן הוא נראה אחרת מכל השאר: כפתור מלא בצבעים הפוכים ועם
   אייקון בית, בלי חץ "המשך לקטגוריה" שאין לו לאן להוביל. */
function menuItemButton(navItem){
  const count  = accCountOf(navItem.acc);
  const hot    = count > 0 && NAV_HOT_ACCS.has(navItem.acc);
  const isHome = navIsHomeItem(navItem);
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item' + (isHome ? ' is-home' : '');
  /* אותו אייקון שמופיע בשורה של הקטגוריה בסרגל הצד. בטור של עשרים שורות
     טקסט בעברית האייקון הוא מה שמאפשר לזהות שורה בלי לקרוא אותה. */
  item.innerHTML =
    dashIcon(navItem.icon, 'mi-ico')
    + '<span class="mi-label">' + esc(navItem.label) + '</span>'
    + (count ? '<span class="mi-count' + (hot ? ' is-hot' : '') + '">' + esc(String(count)) + '</span>' : '')
    + (isHome ? '' : '<svg class="mi-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>');
  item.addEventListener('click', ()=>{
    closeMenuPanel();
    navGo(navItem);
  });
  return item;
}

function buildMenuPanel(){
  const panel = document.getElementById('menuPanel');
  if (!panel) return;
  panel.innerHTML = '';
  const saved = menuGroupsOpen();

  /* כפתור הבית יוצא מהקבוצה ונעוץ בראש התפריט. בתוך קבוצה מתקפלת הוא היה
     נעלם בדיוק במצב ברירת המחדל — והדרך חזרה היא הדבר האחרון שצריך לחפש
     מאחורי לחיצה נוספת. */
  const homeItems = [];
  const groups = navGroupsForView()
    .map(g => ({
      key:   g.key,
      label: g.label,
      icon:  g.icon,
      items: g.items.filter(it => { if (navIsHomeItem(it)){ homeItems.push(it); return false; } return true; }),
    }))
    .filter(g => g.items.length);

  homeItems.forEach(it => panel.appendChild(menuItemButton(it)));

  groups.forEach((group, gi)=>{
    if (gi > 0) panel.appendChild(Object.assign(document.createElement('div'), { className:'menu-sep' }));

    const sub = document.createElement('div');
    sub.className = 'menu-sub';
    sub.id = 'menuGroup-' + group.key;

    /* הסכום שמופיע על קבוצה סגורה. בלעדיו קיפול היה מסתיר עבודה שממתינה:
       "לידים חמים 3" בתוך קבוצה מקופלת הוא בדיוק ההתראה שהמסך הזה נועד
       להבליט. נספרות רק הקטגוריות שמותר להן להיות אדומות (NAV_HOT_ACCS). */
    const hotSum = group.items.reduce(
      (s, it) => s + (NAV_HOT_ACCS.has(it.acc) ? accCountOf(it.acc) : 0), 0);

    const open = menuGroupInitiallyOpen(group, saved);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu-gtoggle';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', sub.id);
    toggle.innerHTML =
      dashIcon(group.icon, 'mg-ico')
      + '<span class="mg-label">' + esc(group.label) + '</span>'
      + (hotSum ? '<span class="mg-count is-hot">' + esc(String(hotSum)) + '</span>'
                : '<span class="mg-count">' + esc(String(group.items.length)) + '</span>')
      + '<svg class="mg-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    toggle.addEventListener('click', ()=>{
      const nowOpen = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(nowOpen));
      sub.hidden = !nowOpen;
      menuGroupSetOpen(group.key, nowOpen);
    });
    panel.appendChild(toggle);

    sub.hidden = !open;
    group.items.forEach(navItem => sub.appendChild(menuItemButton(navItem)));
    panel.appendChild(sub);
  });

  if (!groups.length && !homeItems.length){
    panel.innerHTML = '<div class="menu-empty">אין קטגוריות להצגה</div>';
  }

  appendInstallMenuItem(panel);
}

/* ---------- "התקנת האפליקציה" בתחתית התפריט ----------
   הרצועה הצפה של ‎assets/pwa-install.js‎ נעלמת לשבועיים בלחיצה על ✕, והתפריט
   הוא המקום שאליו חוזרים כדי למצוא את ההתקנה שוב — בלי לחפש אותה בתפריט
   שלוש הנקודות של הדפדפן, שזו בדיוק הבעיה שהכפתור נועד לפתור.

   הפריט נולד ‎hidden‎ ונחשף רק על ידי המודול, כשיש בדפדפן הזה מה להציע
   (‏באייפון — ההסבר, בכרום — ההתקנה עצמה). כך לא נשאר בתפריט כפתור שלא
   עושה דבר, והוא גם לא מהבהב לרגע לפני שהוא מוסתר.

   התפריט נבנה מחדש בכל פתיחה, ולכן ‎refreshTriggers‎ בכל בנייה: הכפתור
   שהמודול חיבר אליו מאזין קודם כבר אינו ב-DOM. */
function appendInstallMenuItem(panel){
  // ‏canInstall בודק גם התקנה קיימת וגם דפדפן שאין לו מה להציע. בלי
  // התנאי הזה היה נשאר בתחתית התפריט קו מפריד בלי שום פריט אחריו.
  if (!panel || !window.ShukPWA || !window.ShukPWA.canInstall()) return;

  panel.appendChild(Object.assign(document.createElement('div'), { className:'menu-sep' }));

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item';
  item.hidden = true;
  item.setAttribute('data-pwa-install', '');
  item.innerHTML = dashIcon('install', 'mi-ico')
    + '<span class="mi-label">התקנת האפליקציה</span>';
  // התפריט נסגר לפני שההסבר או דיאלוג ההתקנה נפתחים מעליו
  item.addEventListener('click', closeMenuPanel);
  panel.appendChild(item);

  window.ShukPWA.refreshTriggers();
}

function closeMenuPanel(){
  const panel = document.getElementById('menuPanel');
  if (!panel || !panel.classList.contains('is-open')) return;
  panel.classList.remove('is-open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
}

document.getElementById('menuBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  const panel = document.getElementById('menuPanel');
  const open = panel.classList.contains('is-open');
  if (open){ closeMenuPanel(); return; }
  // סוגרים את פאנל ההתראות מאותה סיבה הפוכה — הוא לא נסגר מלחיצה שנעצרה כאן
  const bell = document.getElementById('bellPanel');
  bell.style.display = 'none';
  document.getElementById('bellBtn').setAttribute('aria-expanded', 'false');
  // נבנה מחדש בכל פתיחה כדי שהמונים והקטגוריות יהיו מעודכנים לרגע הזה
  buildMenuPanel();
  panel.classList.add('is-open');
  document.getElementById('menuBtn').setAttribute('aria-expanded', 'true');
  // הפריט הראשון הוא כותרת קבוצה מאז שהקבוצות מתקפלות, ולא פריט ניווט
  const first = panel.querySelector('.menu-gtoggle,.menu-item');
  if (first) first.focus({ preventScroll:true });
});

document.getElementById('menuPanel').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', closeMenuPanel);
document.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;
  if (!document.getElementById('menuPanel').classList.contains('is-open')) return;
  closeMenuPanel();
  document.getElementById('menuBtn').focus({ preventScroll:true });
});

/* ==========================================================================
   תפריט הפרופיל
   --------------------------------------------------------------------------
   כל מה שהוא "החשבון שלי" תחת פקד אחד: הפרטים האישיים, ההעדפות, ההתראות,
   הקוד האתי והיציאה. קודם הם היו מפוזרים בין האווטאר (שקפץ לפרופיל), כפתור
   יציאה קבוע בכותרת, ופריטים שהיו קבורים בעומק תפריט הבורגר בין הקטגוריות
   התפעוליות.

   הרשימה מסוננת ב-navAccVisible בדיוק כמו שאר הניווטים, ולכן קטגוריה
   שאינה קיימת לסוכן/ת הזה/הזו לא תופיע כאן.
   ========================================================================== */
const PROFILE_MENU = [
  { acc:'accProfile',    label:'פרטי הסוכן/ת' },
  { acc:'accPrefs',      label:'העדפות לידים' },
  { acc:'accReminders',  label:'תזכורות וטיפים' },
  { acc:'accNotifPrefs', label:'ניהול התראות' },
  { acc:'accEthics',     label:'הקוד האתי' },
];

function buildProfilePanel(){
  const panel = document.getElementById('profilePanel');
  if (!panel) return;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'menu-head';
  const agency = document.getElementById('agentAgency');
  head.innerHTML = '<b>' + esc(document.getElementById('agentName').textContent || '') + '</b>'
    + (agency && agency.textContent ? '<span>' + esc(agency.textContent) + '</span>' : '');
  panel.appendChild(head);

  PROFILE_MENU.filter(item => navAccVisible(item.acc)).forEach(item=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    const count = accCountOf(item.acc);
    btn.innerHTML = '<span class="mi-label">' + esc(item.label) + '</span>'
      + (count ? '<span class="mi-count">' + esc(String(count)) + '</span>' : '')
      + '<svg class="mi-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    btn.addEventListener('click', ()=>{ closeProfilePanel(); gotoSection(item.acc); });
    panel.appendChild(btn);
  });

  panel.appendChild(Object.assign(document.createElement('div'), { className:'menu-sep' }));

  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'menu-item is-signout';
  out.innerHTML = '<span class="mi-label">יציאה מהחשבון</span>';
  // הכפתור המקורי נשאר נקודת היציאה היחידה — כאן רק לוחצים עליו
  out.addEventListener('click', ()=>{
    closeProfilePanel();
    document.getElementById('logoutBtn').click();
  });
  panel.appendChild(out);
}

function closeProfilePanel(){
  const panel = document.getElementById('profilePanel');
  if (!panel || !panel.classList.contains('is-open')) return;
  panel.classList.remove('is-open');
  document.getElementById('avatarBtn').setAttribute('aria-expanded', 'false');
}

document.getElementById('avatarBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  const panel = document.getElementById('profilePanel');
  if (panel.classList.contains('is-open')){ closeProfilePanel(); return; }
  closeMenuPanel();
  const bell = document.getElementById('bellPanel');
  bell.style.display = 'none';
  document.getElementById('bellBtn').setAttribute('aria-expanded', 'false');
  buildProfilePanel();
  panel.classList.add('is-open');
  document.getElementById('avatarBtn').setAttribute('aria-expanded', 'true');
  const first = panel.querySelector('.menu-item');
  if (first) first.focus({ preventScroll:true });
});

document.getElementById('profilePanel').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', closeProfilePanel);
document.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;
  if (!document.getElementById('profilePanel').classList.contains('is-open')) return;
  closeProfilePanel();
  document.getElementById('avatarBtn').focus({ preventScroll:true });
});

/* ---------- Boot: restore existing session if present (handles Google OAuth redirect too) ----------
   אחרי החזרה מ-Google ה-session מוכן רק כשה-client סיים לקרוא את התשובה
   מהכתובת, ולכן המאזין הוא הנתיב העיקרי ו-boot() הוא רשת הביטחון שלו.
   ‏שני דגשים שבלעדיהם הכניסה מרגישה "קופצת":
   1. אין await של supabase בתוך ה-callback עצמו. הוא רץ בתוך הנעילה הפנימית
      של הלקוח, וקריאה כזו מתוכו עלולה לתקוע את הדף עד ל-timeout. לכן העבודה
      נדחית ב-setTimeout(0) והמאזין עצמו מסתיים מיד.
   2. ‏SIGNED_IN מגיע גם בחזרה ללשונית ובחידוש אסימון, לא רק בהתחברות. הסינון
      בפועל נעשה ב-routeAfterAuth() מול routedUserId. */
sb.auth.onAuthStateChange((event, session)=>{
  if (event === 'SIGNED_OUT'){
    routedUserId = null;
    setTimeout(()=> showLoginCard(), 0);
    return;
  }
  if (event !== 'INITIAL_SESSION' && event !== 'SIGNED_IN') return;
  setTimeout(()=>{
    if (session) routeAfterAuth(session);
    else if (event === 'INITIAL_SESSION') showLoginCard();
  }, 0);
});

/* ==========================================================================
   הסכמים והחתמות — הזמנת שירותי תיווך, ידנית ומרחוק
   --------------------------------------------------------------------------
   ‏ארבעה שלבים, ובסדר הזה בכוונה:

     ‏1. סוג ההסכם  → 2. פרטי ההסכם → 3. תצוגה מקדימה → 4. חתימה

   השלב השלישי הוא לא קישוט. הוא הרגע שבו הסוכן/ת רואה את המסמך **בדיוק
   כפי שהלקוח/ה יראה/תראה אותו**, לפני שהוא נשמר ונחסם לעריכה. אחריו
   ההסכם קיים במסד, גוף המסמך קפוא, והדרך היחידה לשנות טקסט היא לבטל
   ולהוציא חדש — כמו בנייר, ומאותה סיבה: הסכם שאפשר לערוך אחרי החתימה
   הוא הסכם שאפשר לטעון נגדו שנערך אחרי החתימה.

   ‏שני מסלולי חתימה לכל חותם/ת בנפרד, ולא לכל ההסכם:
     • **ידנית** — הסוכן/ת מעביר/ה את המכשיר, החותם/ת חותם/ת על המסך.
     • **מרחוק** — קישור אישי במייל או בוואטסאפ. לכל חותם/ת אסימון משלו/ה,
       כי בני זוג לא תמיד יושבים באותו חדר.
   אפשר לערבב: אחד/ת חותם/ת כאן ועכשיו, והשני/ה מקבל/ת קישור.

   כשכל החותמים חתמו, הטריגר במסד מסמן את ההסכם כחתום ו-agreement-sign
   שולח את העותק החתום לכולם.
   ========================================================================== */

const AGREEMENT_FN_URL = SUPABASE_URL + '/functions/v1/agreement-sign';

const AGR_STATUS = {
  draft:     { label:'טיוטה',            cls:'status-off' },
  sent:      { label:'נשלח לחתימה',      cls:'status-masked' },
  viewed:    { label:'נצפה ע״י הלקוח/ה', cls:'status-masked' },
  signed:    { label:'נחתם',             cls:'status-shared' },
  cancelled: { label:'בוטל',             cls:'status-off' },
};

const AGR_CONDITION_LABELS = {
  new_from_contractor:'חדש מקבלן', new:'חדש', renovated:'משופץ',
  maintained:'שמור', needs_renovation:'דרוש שיפוץ',
};

let agreementRows = [];   // ההסכמים של הסוכן/ת, כולל החותמים
let agrWizard = null;     // מצב האשף הפתוח, או null

const agrTpl = kind => (window.AgreementTemplates && window.AgreementTemplates.get(kind)) || null;
const agrKindLabel = kind => { const t = agrTpl(kind); return t ? t.docTitle : kind; };

/* ---------- טעינה ורשימה ---------- */

async function loadAgreements(){
  const listEl = document.getElementById('agreementsList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';

  const { data, error } = await sb
    .from('agreements')
    .select('*, signers:agreement_signers(*)')
    .order('created_at', { ascending:false });

  if (error){
    listEl.innerHTML = '<div class="empty-state">' + (missingSchema(error)
      ? 'מנגנון ההסכמים לא הופעל עדיין בפרויקט הזה.'
      : 'שגיאה בטעינת ההסכמים: ' + esc(error.message)) + '</div>';
    accSetCount('accAgreements', '');
    return;
  }

  agreementRows = (data || []).map(a => Object.assign({}, a, {
    signers: (a.signers || []).slice().sort((x, y) => (x.ord || 0) - (y.ord || 0)),
  }));

  const pending = agreementRows.filter(a => a.status === 'sent' || a.status === 'viewed').length;
  accSetCount('accAgreements',
    pending ? plural(pending, 'הסכם אחד ממתין לחתימה', 'ממתינים לחתימה')
            : (agreementRows.length ? plural(agreementRows.length, 'הסכם אחד', 'הסכמים') : ''));

  agrFillKindFilter();
  renderAgreements();
}

function agrFillKindFilter(){
  const sel = document.getElementById('agrKindFilter');
  if (!sel || sel.dataset.filled) return;
  sel.innerHTML = '<option value="">כל סוגי ההסכם</option>' +
    window.AgreementTemplates.keys()
      .map(k => `<option value="${esc(k)}">${esc(agrTpl(k).docTitle)}</option>`).join('');
  sel.dataset.filled = '1';
}

function agrSearchBlob(a){
  return [a.title, agrKindLabel(a.kind), a.notes,
    ...(a.signers || []).map(s => [s.full_name, s.phone, s.email, s.id_number].join(' ')),
    (a.snapshot && a.snapshot.property_line) || '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function agrSignedCount(a){
  const total = (a.signers || []).length;
  return { signed: (a.signers || []).filter(s => s.signed_at).length, total };
}

function renderAgreements(){
  const listEl = document.getElementById('agreementsList');
  if (!listEl) return;

  const q = (document.getElementById('agrSearch').value || '').trim().toLowerCase();
  const status = document.getElementById('agrStatusFilter').value;
  const kind = document.getElementById('agrKindFilter').value;
  const active = !!(q || status || kind);

  const rows = agreementRows.filter(a => {
    if (status && a.status !== status) return false;
    if (kind && a.kind !== kind) return false;
    return !q || agrSearchBlob(a).includes(q);
  });

  updateFilterFoot('agrFilterCount', 'agrClearFilters', rows.length, agreementRows.length, active);

  if (!rows.length){
    listEl.innerHTML = '<div class="empty-state">' + (agreementRows.length === 0
      ? 'עדיין לא יצרת הסכמים. "הסכם חדש" פותח את האשף - סוג ההסכם, הפרטים, תצוגה מקדימה וחתימה.'
      : 'אין הסכם שמתאים לסינון הנוכחי.') + '</div>';
    return;
  }

  // הרשימה היא טאבים, כמו שאר רשימות הדשבורד — ראו buildTabRow()
  listEl.innerHTML = '<div class="prop-tabs agr-tabs"></div>';
  const tabsWrap = listEl.querySelector('.prop-tabs');
  rows.forEach(a => tabsWrap.appendChild(buildAgreementTab(a)));
}

/* ---------- הסכם כשורה ----------
   **הכותרת היא מי חותם/ת, לא שם המסמך.** ‏`a.title` הוא סוג ההסכם
   ("הזמנת שירותי תיווך במקרקעין - קניה"), והוא חוזר מילה במילה בכל הסכם
   מאותו סוג — רשימה של שורות כאלה אינה ניתנת לסריקה. מה שמבדיל ביניהן
   הוא שם הצד השני, ולכן הוא הכותרת, וסוג המסמך יורד לשורת המשנה. בהסכם
   שעדיין אין לו צד שני (טיוטה) הכותרת נופלת חזרה לשם המסמך.

   **השלמת החתימות היא המספר שבצד**, במשבצת שבה יושב המחיר בשאר
   הרשימות: "1/2 חתמו" היא השאלה שבגללה פותחים הסכם.

   **כשל בשליחת העותק החתום נאמר בשורה** ולא רק בכרטיס: זו תקלה שקרתה
   בשקט, והסתרה שלה מאחורי לחיצה פירושה שאיש לא יידע עליה. */
const expandedAgreementIds = new Set();

function agrPartyNames(a){
  return (a.signers || []).filter(s => s.party !== 'agent').map(s => s.full_name).filter(Boolean).join(' · ');
}

function agrTabSub(a){
  return [
    a.signed_copy_error ? '⚠ העותק החתום לא נשלח' : null,
    agrPartyNames(a) ? a.title : null,   // שם המסמך ירד לכאן רק אם הוא אינו הכותרת
    (a.snapshot && a.snapshot.property_line) || null,
    tabShortDate(a.signed_at || a.created_at),
  ].filter(Boolean).join(' · ');
}

function buildAgreementTab(a){
  const st = AGR_STATUS[a.status] || { label:a.status, cls:'status-off' };
  const prog = agrSignedCount(a);
  return buildTabRow({
    key: a.id, list:'agreement', expanded: expandedAgreementIds, cls:'agr-tab',
    title: agrPartyNames(a) || a.title,
    sub: agrTabSub(a),
    pill: { text: st.label, cls: 'status-pill ' + st.cls },
    price: prog.total ? prog.signed + '/' + prog.total : '',
    priceNote: prog.total ? 'חתמו' : '',
    buildCard: ()=> buildAgreementCard(a),
  });
}

function buildAgreementCard(a){
    const st = AGR_STATUS[a.status] || { label:a.status, cls:'status-off' };
    const prog = agrSignedCount(a);
    const names = agrPartyNames(a);
    const propLine = (a.snapshot && a.snapshot.property_line) || '';

    const el = document.createElement('div');
    el.className = 'card agr-row';
    el.innerHTML = `
      <div class="agr-top">
        <div style="min-width:0">
          <div class="agr-title">${esc(a.title)}</div>
          ${names ? `<div class="agr-sub">${esc(names)}</div>` : ''}
          ${propLine ? `<div class="agr-sub">📍 ${esc(propLine)}</div>` : ''}
          <div class="agr-progress">${prog.signed}/${prog.total} חתמו · נוצר ב-${esc(hebDateTime(a.created_at))}${
            a.signed_at ? ' · נחתם ב-' + esc(hebDateTime(a.signed_at)) : ''}</div>
          ${a.signed_copy_error ? `<div class="agr-missing">העותק החתום לא נשלח במייל (${esc(a.signed_copy_error)}) - אפשר לשלוח שוב</div>` : ''}
        </div>
        <div class="pill-row"><span class="status-pill ${st.cls}">${esc(st.label)}</span></div>
      </div>
      <div class="lead-actions"></div>`;

    const actions = el.querySelector('.lead-actions');

    if (a.status !== 'cancelled'){
      addCardAction(actions, {
        label: prog.signed < prog.total ? '✍️ החתמה' : '📄 המסמך החתום',
        cls:'btn-gold act-wide',
        onClick: ()=> openAgreementSigning(a.id),
      });
    }

    addCardAction(actions, {
      label:'👁 צפייה', title:'פתיחת המסמך בלשונית חדשה',
      href:'agreement.html?t=' + encodeURIComponent(a.view_token), blank:true,
    });

    if (a.status !== 'signed' && a.status !== 'cancelled' && (a.signers || []).some(s => !s.signed_at && s.email)){
      addCardAction(actions, {
        label:'✉️ שליחת קישורים', title:'שליחת קישור חתימה אישי לכל מי שטרם חתם/ה',
        onClick: btn => agrSendLinks(a.id, null, btn),
      });
    }

    if (a.status === 'signed'){
      addCardAction(actions, {
        label:'📤 שליחת עותק שוב', title:'שליחה חוזרת של העותק החתום לכל הצדדים',
        onClick: btn => agrResendSigned(a.id, btn),
      });
    }

    if (a.status === 'draft'){
      addCardAction(actions, { label:'🗑 מחיקה', onClick:()=> agrDelete(a) });
    } else if (a.status !== 'cancelled'){
      addCardAction(actions, { label:'✖ ביטול ההסכם', onClick:()=> agrCancel(a) });
    }

    return el;
}

/* ---------- פעולות על הסכם קיים ---------- */

async function agrCallFn(payload, btn, busyLabel){
  const original = btn ? btn.textContent : null;
  if (btn){ btn.disabled = true; btn.textContent = busyLabel || 'שולח…'; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(AGREEMENT_FN_URL, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(()=> ({}));
    return { ok: res.ok && data.ok, data };
  } catch(err){
    console.error(err);
    return { ok:false, data:{ error:'network' } };
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = original; }
  }
}

const AGR_FN_ERRORS = {
  network:              'שגיאת רשת - נסו שוב בעוד רגע',
  not_your_agreement:   'ההסכם אינו שלך',
  agreement_not_found:  'ההסכם לא נמצא',
  not_fully_signed:     'ההסכם עדיין לא נחתם על ידי כל הצדדים',
  agent_inactive:       'החשבון אינו פעיל',
};

async function agrSendLinks(agreementId, signerIds, btn){
  const { ok, data } = await agrCallFn(
    { action:'send', agreement_id:agreementId, signer_ids:signerIds || undefined }, btn, 'שולח…');
  if (!ok){
    showToast('הקישורים לא נשלחו: ' + (AGR_FN_ERRORS[data.error] || data.error || 'שגיאה'));
    return false;
  }
  if (data.sent === 0 && data.candidates === 0){
    showToast('אין למי לשלוח - לאף חותם/ת שטרם חתם/ה אין כתובת מייל');
  } else if (data.failed){
    showToast(`נשלחו ${data.sent} קישורים · ${data.failed} נכשלו`);
  } else {
    showToast(`נשלחו ${data.sent} קישורי חתימה`);
  }
  await loadAgreements();
  if (agrWizard && agrWizard.agreementId === agreementId) await agrRefreshWizardRecord();
  return true;
}

async function agrResendSigned(agreementId, btn){
  const { ok, data } = await agrCallFn({ action:'finalize', agreement_id:agreementId }, btn, 'שולח…');
  if (!ok){
    showToast('העותק לא נשלח: ' + (AGR_FN_ERRORS[data.error] || data.error || 'שגיאה'));
    return;
  }
  showToast(data.copies_sent ? `העותק החתום נשלח ל-${data.copies_sent} נמענים`
                             : 'אין נמענים עם כתובת מייל');
  await loadAgreements();
}

async function agrCancel(a){
  if (!confirm('לבטל את ההסכם "' + a.title + '"?\n\nההסכם יישאר בארכיון כמבוטל, והקישורים לחתימה יפסיקו לעבוד.')) return;
  const { error } = await sb.from('agreements')
    .update({ status:'cancelled', cancelled_at:new Date().toISOString() }).eq('id', a.id);
  if (error) return showToast('הביטול נכשל: ' + error.message);
  showToast('ההסכם בוטל');
  await loadAgreements();
}

async function agrDelete(a){
  if (!confirm('למחוק את הטיוטה "' + a.title + '"?')) return;
  const { error } = await sb.from('agreements').delete().eq('id', a.id);
  if (error) return showToast('המחיקה נכשלה: ' + error.message);
  expandedAgreementIds.delete(a.id);
  showToast('הטיוטה נמחקה');
  await loadAgreements();
}

/* ==========================================================================
   האשף
   ========================================================================== */

const agrEl = id => document.getElementById(id);

function agrNewWizard(){
  return {
    step:1, kind:null,
    properties:[],          // [{property_id, label, fields:{}, notes}]
    signers:[],             // [{uid, party, full_name, id_number, phone, email, address, client_id}]
    commission:{ pct:2, amount:'', basis:'' },
    /* ‏months הוא מצב הבורר ולא נתון נוסף בהסכם: מה שנחתם ומודפס בסעיף 1
       הם שני התאריכים בלבד. ריק = הזנה ידנית של שניהם. */
    exclusive:{ from:'', until:'', months:'' },
    questionnaire:[],
    notes:'', language:'he',
    agreementId:null, record:null,
    pads:{},
  };
}

let agrUid = 0;
const agrNextUid = () => 'p' + (++agrUid);

async function openAgreementWizard(opts){
  opts = opts || {};
  agrWizard = agrNewWizard();
  agrEl('agrModal').style.display = 'flex';
  if (opts.kind) agrSetKind(opts.kind, { silent:true });
  // ‏await ולא "שגר ושכח": ‏agrAddProperty מושכת את הבעלים ואת הגוש/חלקה
  // משתי טבלאות, וציור השלב לפניה היה מציג טופס ריק שמתמלא רגע אחר כך
  if (opts.propertyId) await agrAddProperty(opts.propertyId, { silent:true });
  if (opts.clientId) agrAddClientSigner(opts.clientId, { silent:true });
  agrWizard.step = opts.kind ? 2 : 1;
  agrRender();
}

function agrCloseWizard(){
  agrEl('agrModal').style.display = 'none';
  agrWizard = null;
}

/* פתיחת האשף ישירות על שלב החתימה של הסכם שכבר קיים */
async function openAgreementSigning(agreementId){
  const row = agreementRows.find(a => a.id === agreementId);
  if (!row) return;
  agrWizard = agrNewWizard();
  agrWizard.kind = row.kind;
  agrWizard.agreementId = row.id;
  agrWizard.record = row;
  agrWizard.step = 4;
  agrEl('agrModal').style.display = 'flex';
  agrRender();
}

const AGR_STEP_LABELS = ['1 · סוג ההסכם', '2 · פרטי ההסכם', '3 · תצוגה מקדימה', '4 · חתימה'];

function agrRender(){
  if (!agrWizard) return;
  const w = agrWizard;
  const tpl = agrTpl(w.kind);

  agrEl('agrTitle').textContent = tpl ? tpl.docTitle : 'הסכם חדש';
  agrEl('agrSteps').innerHTML = AGR_STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const cls = n === w.step ? 'active' : (n < w.step ? 'done' : '');
    return `<span class="${cls}">${esc(label)}</span>`;
  }).join('');

  if (w.step === 1) agrRenderStepKind();
  else if (w.step === 2) agrRenderStepDetails();
  else if (w.step === 3) agrRenderStepPreview();
  else agrRenderStepSign();

  agrEl('agrBody').scrollTop = 0;
}

/* ---------- שלב 1: סוג ההסכם ---------- */

function agrRenderStepKind(){
  const html = window.AgreementTemplates.menu.map(group => {
    const items = group.keys.map(k => {
      const t = agrTpl(k);
      if (!t) return '';
      return `<button type="button" class="agr-kind${t.verified ? '' : ' is-draft'}" data-agr-kind="${esc(k)}">` +
        esc(t.label) +
        `<span class="hint">${esc(t.menuHint)}${t.verified ? '' : ' · נוסח לאישור'}</span></button>`;
    }).join('');
    return `<div class="agr-kind-group">${esc(group.label)}</div>` + items;
  }).join('');

  agrEl('agrBody').innerHTML =
    '<p style="margin:0 0 12px;color:var(--ink-soft)">בחרו את סוג ההסכם. הטופס, הסעיפים והמשאלון נקבעים לפי הבחירה.</p>' +
    '<div class="agr-kind-list">' + html + '</div>' +
    '<p class="imp-note" style="margin-top:14px">טופס המסומן ב"נוסח לאישור" נבנה במבנה של טופס המכירה וממתין לאישור משפטי - ' +
    'בדקו את הנוסח בתצוגה המקדימה לפני שאתם מחתימים עליו לקוח/ה.</p>';

  agrEl('agrFoot').innerHTML = '<button type="button" class="btn btn-ghost" data-agr="close">סגירה</button>';
}

function agrSetKind(kind, opts){
  const tpl = agrTpl(kind);
  if (!tpl) return;
  agrWizard.kind = kind;
  agrWizard.commission.basis = (window.AgreementTemplates.commissionBases[tpl.dealType] || [])[0]?.key || '';
  agrWizard.questionnaire = tpl.questionnaire ? tpl.questionnaire.items.map(()=> '') : [];
  if (tpl.propertyMode === 'single' && agrWizard.properties.length > 1){
    agrWizard.properties = agrWizard.properties.slice(0, 1);
  }
  // החלפת סוג הטופס מחליפה גם את רשימת שדות הנכס (מלאה מול מקוצרת). מה
  // שכבר מולא נשמר, ומה שהטופס החדש דורש ואינו קיים נפתח ריק.
  agrWizard.properties.forEach(entry => {
    tpl.propertyFields.forEach(f => {
      if (!(f.key in entry.fields)) entry.fields[f.key] = '';
    });
  });
  if (!(opts && opts.silent)){
    agrWizard.step = 2;
    agrRender();
  }
}

/* ---------- שלב 2: פרטי ההסכם ---------- */

function agrRenderStepDetails(){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);
  const bases = window.AgreementTemplates.commissionBases[tpl.dealType] || [];

  let html = '';

  if (!tpl.verified){
    html += '<div class="agr-warn"><b>הנוסח של הטופס הזה טרם אושר.</b> הוא נבנה במבנה של טופס המכירה ' +
      'ובהתאם לחוק המתווכים במקרקעין, אך לא הועתק מטופס קיים. קראו אותו בתצוגה המקדימה לפני החתמה.</div>';
  }

  /* --- נכסים ---
     חיפוש חופשי על שלושת המאגרים במקום רשימה נפתחת של הנכסים שלי בלבד:
     הסכם תיווך נחתם גם על נכס של עמית/ה במשרד ועל נכס שמשרד שת"פ שיתף,
     ו-<select> של הנכסים שלי הכריח להקליד אותם ידנית. --- */
  html += '<div class="agr-sec"><h4>' +
    (tpl.propertyMode === 'multi' ? 'הנכסים בהסכם' : 'הנכס בהסכם') + '</h4>' +
    '<div class="agr-search">' +
      '<input type="search" id="agrPropSearch" class="filter-input" style="width:100%"' +
        ' placeholder="חיפוש נכס - כתובת, עיר, סוג נכס או מספר מודעה" autocomplete="off">' +
      '<div class="agr-results" id="agrPropResults"></div>' +
    '</div>' +
    '<p class="imp-note" style="margin:8px 0 0">מחפש בנכסים שלך, בנכסי המשרד ובנכסים ' +
      'ששותפו איתך.</p>' +

    '<button type="button" class="btn btn-ghost btn-block" data-agr="toggle-manual-prop"' +
      ' style="margin-top:10px">✏️ הזנת נכס ידנית</button>' +
    '<div id="agrManualProp" hidden style="margin-top:10px;border:1.5px dashed var(--line);' +
      'border-radius:var(--radius-sm);padding:12px;background:#fff">' +
      '<div class="agr-fields">' +
        /* ‏<select> ולא <input list> ‏(datalist): בכרום לאנדרואיד הרשימה של
           datalist אינה נפתחת בלחיצה — החץ מצויר, ולא קורה דבר. הסוכן/ת
           נשאר/ת מול שדה שנראה כמו תפריט ומתנהג כמו טקסט חופשי, וכותב/ת
           "משרד" במקום "משרדים". זו גם רשימה סגורה, ולכן <select> הוא
           הפקד הנכון לה ממילא — וכך היא מוצגת בכל שאר ה-CRM (‏npType,
           אשף הייבוא). האפשרות הריקה נדרשת כדי שאיפוס הטופס אחרי ההוספה
           באמת ירוקן את השדה. */
        '<div class="agr-field"><label>סוג הנכס</label>' +
          '<select id="agrMpType"><option value="">- בחרו סוג נכס -</option>' +
            `<optgroup label="מגורים">${agrPtypeOptions(RESIDENTIAL_PTYPE_OPTIONS)}</optgroup>` +
            `<optgroup label="מסחרי">${agrPtypeOptions(COMMERCIAL_PTYPE_OPTIONS)}</optgroup>` +
          '</select></div>' +
        '<div class="agr-field"><label>עיר</label>' +
          '<input type="text" id="agrMpCity" value="עפולה"></div>' +
        '<div class="agr-field"><label>רחוב</label><input type="text" id="agrMpStreet"></div>' +
        '<div class="agr-field"><label>מס׳ בית</label><input type="text" id="agrMpHouse"></div>' +
        '<div class="agr-field"><label>מס׳ דירה</label><input type="text" id="agrMpApt"></div>' +
        '<div class="agr-field"><label>מחיר מבוקש (₪)</label>' +
          '<input type="number" id="agrMpPrice" min="0" step="1000"></div>' +
      '</div>' +
      '<button type="button" class="btn btn-gold btn-block" data-agr="add-manual-prop"' +
        ' style="margin-top:10px">הוספת הנכס</button>' +
      '<p class="imp-note" style="margin:8px 0 0">אלה השדות שנדרשים כדי לזהות את הנכס. ' +
        'כל היתר נפתח לעריכה מיד למטה, ומה שיישאר ריק מודפס במסמך כקו.</p>' +
    '</div>' +

    '<div id="agrPropChips" style="margin-top:12px"></div>' +
    (tpl.propertyMode === 'single'
      ? '<p class="imp-note">בטופס הזה מתואר נכס אחד. בחירת נכס נוסף תחליף את הקיים.</p>'
      : '<p class="imp-note">אפשר לצרף כמה נכסים - כל אחד מהם יופיע במסמך בנפרד.</p>') +
  '</div>';

  /* --- צדדים ---
     אותו מחפש כמו בנכסים, ומאותה סיבה: קובץ לקוחות של מאות שורות ברשימה
     נפתחת אחת אינו ניתן לשימוש בטלפון. --- */
  html += '<div class="agr-sec"><h4>הצדדים החותמים</h4>' +
    '<div class="agr-search">' +
      '<input type="search" id="agrClientSearch" class="filter-input" style="width:100%"' +
        ' placeholder="חיפוש בקובץ הלקוחות - שם, טלפון, אימייל או עיר" autocomplete="off">' +
      '<div class="agr-results" id="agrClientResults"></div>' +
    '</div>' +
    /* מפורש, כי לנכסים יש שלושה מאגרים ולכאן רק אחד: קובץ הלקוחות הוא
       אישי (‏RLS על agent_clients מצומצמת לסוכן/ת עצמו/ה, בלי מנהל/ת
       המשרד), ובלי השורה הזו נראה כאילו החיפוש פשוט לא מצא. */
    '<p class="imp-note" style="margin:8px 0 0">מחפש בקובץ הלקוחות שלך בלבד. ' +
      'חותם/ת שאינו/ה בקובץ נכנס/ת בהזנה ידנית.</p>' +
    '<button type="button" class="btn btn-ghost btn-block" data-agr="add-blank-signer"' +
      ' style="margin-top:10px">✏️ הזנת חותם/ת ידנית</button>' +
    '<div id="agrSignerForms" style="margin-top:12px"></div>' +
    '<p class="imp-note">החותם/ת הראשון/ה מופיע/ה במסמך כ"בין", והשני/ה כ"ובין" - בן/בת זוג או שותף/ה. ' +
    'מספר תעודת זהות נדרש בהזמנת שירותי תיווך בכתב.</p>' +
  '</div>';

  /* --- שדות הנכס --- */
  html += '<div class="agr-sec"><h4>פרטי הנכס במסמך</h4>' +
    '<p class="imp-note" style="margin:0 0 10px">מה שידוע במערכת מולא לבד. שדה שנשאר ריק מודפס במסמך כקו לחתימה ידנית.</p>' +
    '<div id="agrPropFields"></div></div>';

  /* --- עמלה --- */
  html += '<div class="agr-sec"><h4>עמלה</h4><div class="agr-grid">' +
    `<div class="agr-field"><label>אחוזים</label>
       <input type="number" id="agrPct" step="0.01" min="0" max="100" value="${esc(w.commission.pct)}"></div>` +
    `<div class="agr-field"><label>סכום עמלה (₪, לא חובה)</label>
       <input type="number" id="agrAmount" min="0" step="1" value="${esc(w.commission.amount)}" placeholder="מינימום או סכום קבוע"></div>` +
    '</div>' +
    (bases.length > 1
      ? `<div class="agr-field" style="margin-top:8px"><label>בסיס החישוב</label><select id="agrBasis">` +
        bases.map(b => `<option value="${esc(b.key)}"${b.key === w.commission.basis ? ' selected' : ''}>${esc(b.label)}</option>`).join('') +
        '</select></div>'
      : '') +
    '<p class="imp-note">המחירים המצוינים אינם כוללים מע״מ.</p>' +
  '</div>';

  /* --- בלעדיות ---
     רק התאריכים. נספח פעולות השיווק מודפס במסמך במלואו ואינו נבחר —
     ההסכם הוא "יבוצעו לפחות שתיים מהאמור כדלקמן", ובחירה מראש הייתה
     מצמצמת אותו ומחייבת דווקא בשתיים שסומנו. */
  if (tpl.exclusive){
    /* שני מסלולים לאותם שני תאריכים: בחירת מספר חודשים, או הזנה ידנית.
       ‏רוב הבלעדיות נחתמת ל"שלושה חודשים מהיום", והחישוב הזה בראש מול לוח
       שנה הוא בדיוק המקום שבו נופלת טעות של חודש. מה שנשמר בהסכם הם עדיין
       שני התאריכים — הבורר רק ממלא אותם. */
    const months = String(w.exclusive.months || '');
    const chips = [1,2,3,4,5,6].map(n =>
      `<button type="button" class="agr-chip-btn${months === String(n) ? ' is-on' : ''}"` +
      ` data-agr="ex-months" data-months="${n}">${n}</button>`).join('');

    html += '<div class="agr-sec"><h4>תקופת הבלעדיות</h4>' +
      '<div class="agr-field"><label>משך הבלעדיות - מספר חודשים</label>' +
        '<div class="agr-chip-row">' + chips +
          `<button type="button" class="agr-chip-btn is-wide${months ? '' : ' is-on'}"` +
          ' data-agr="ex-months" data-months="">תאריכים ידניים</button>' +
        '</div></div>' +
      '<div class="agr-grid" style="margin-top:10px">' +
        `<div class="agr-field"><label>מיום</label>
           <input type="date" id="agrExFrom" value="${esc(w.exclusive.from)}"></div>` +
        `<div class="agr-field"><label>ועד ליום</label>
           <input type="date" id="agrExUntil" value="${esc(w.exclusive.until)}"${months ? ' readonly' : ''}></div>` +
      '</div>' +
      `<p class="imp-note" id="agrExSummary">${esc(agrExclusiveSummary())}</p>` +
      '<p class="imp-note">התאריכים נכנסים לסעיף 1 של ההסכם. נספח פעולות השיווק, לפי תקנות ' +
      'המתווכים במקרקעין (פעולות שיווק), התשס״ה-2004, מודפס במסמך במלואו - ההתחייבות היא ' +
      'לבצע לפחות שתיים מהפעולות שברשימה.</p>' +
    '</div>';
  }

  /* --- משאלון --- */
  if (tpl.questionnaire){
    html += '<div class="agr-sec"><h4>' + esc(tpl.questionnaire.title) + '</h4>' +
      '<p class="imp-note" style="margin:0 0 10px">תשובות בעל/ת הנכס. שאלה שנשארת ריקה מודפסת במסמך עם שורה ריקה למילוי ידני.</p>' +
      tpl.questionnaire.items.map((q, i) =>
        `<div class="agr-field" style="margin-bottom:9px"><label>${i + 1}. ${esc(q)}</label>
         <textarea rows="2" data-agr-q="${i}">${esc(w.questionnaire[i] || '')}</textarea></div>`).join('') +
    '</div>';
  }

  /* --- שונות --- */
  html += '<div class="agr-sec"><h4>שונות</h4>' +
    `<div class="agr-field"><label>שפת ההסכם</label><select id="agrLang">` +
      ['he','en','ru','ar','fr'].map(l => `<option value="${l}"${w.language === l ? ' selected' : ''}>${
        ({he:'עברית',en:'אנגלית',ru:'רוסית',ar:'ערבית',fr:'צרפתית'})[l]}</option>`).join('') +
    '</select><p class="imp-note">כרגע המסמך מופק בעברית. הבחירה נשמרת לצורך תרגום עתידי.</p></div>' +
    `<div class="agr-field" style="margin-top:10px"><label>הערות להסכם (נכנסות לסעיף "הערות")</label>
       <textarea id="agrNotes" rows="3" placeholder="לדוגמה: העמלה תשולם בשני תשלומים">${esc(w.notes)}</textarea></div>` +
  '</div>';

  agrEl('agrBody').innerHTML = html;

  agrEl('agrFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-agr="back-to-kind">חזרה</button>' +
    '<button type="button" class="btn btn-gold" data-agr="to-preview">הצג הסכם ←</button>';

  agrRenderPropChips();
  agrRenderSignerForms();
  agrRenderPropFields();
  agrRenderClientResults();

  // נכסי המשרד — ובמידת הצורך גם הנכסים שלי — נטענים ברקע; הרשימה מצטיירת
  // מחדש כשהם מגיעים
  agrPropertyLoadFailed = false;   // כשל קודם אינו נגרר לפתיחה הזו
  agrRenderPropResults();
  Promise.all([agrLoadOwnProperties(), agrLoadAgencyProperties()])
    .then(()=>{ if (agrEl('agrPropResults')) agrRenderPropResults(); });
}

function agrPropertyLabel(p){
  const address = [p.street, p.house_number].filter(Boolean).join(' ');
  return [p.title, [address, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' - ');
}

function agrPtypeOptions(list){
  return list.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}

/* ==========================================================================
   מאיפה מגיעים הנכסים לאשף
   --------------------------------------------------------------------------
   שלושה מאגרים, בדיוק אלה שמנוע ההתאמות כבר מצליב מולם: הנכסים של
   הסוכן/ת, הנכסים של המשרד, ומה שמשרדי שת"פ שיתפו איתנו. הסכם תיווך נחתם
   גם על נכס שאינו שלי — זה בדיוק מה ששת"פ הוא — ורשימה שמראה רק את הנכסים
   שלי הייתה מכריחה להקליד אותו ידנית.

   שניים מהשלושה כבר בזיכרון (‏myPropertyRows, ‏sharedWithMeRows). נכסי
   המשרד נטענים פעם אחת, בפתיחה הראשונה של האשף: הם אינם דרושים לשום מסך
   אחר, וטעינה מוקדמת שלהם הייתה שאילתה שרוב הכניסות ל-CRM לא צריכות.

   ‏**האשף אינו נשען על myPropertyRows בלבד.** הרשימה ההיא נטענת בשאילתה
   הגדולה של הדשבורד, שמושכת עשרות עמודות עבור כרטיס הנכס — ודי בעמודה אחת
   חסרה בה כדי שהיא תיפול כולה ותשאיר את המערך ריק. כשזה קרה, האשף הציג
   "אין נכס שמתאים לחיפוש" על נכס שקיים במערכת: הודעה שמאשימה את מילת
   החיפוש בכשל של שאילתה אחרת לגמרי. לכן יש כאן שאילתה משלו — צרה, על
   השדות שהאשף באמת קורא — שרצה רק כשהמערך של הדשבורד ריק.
   ========================================================================== */

const AGR_SOURCE_LABELS = { own:'שלי', agency:'המשרד', shared:'שותף איתי' };

// השדות שהאשף קורא בפועל — בחיפוש, בשורת התוצאה ובמילוי פרטי הנכס במסמך.
// אותה רשימה לשני המאגרים, כדי ששורה "שלי" ושורה "של המשרד" יגיעו לקוד
// המיפוי באותה צורה בדיוק.
const AGR_PROPERTY_FIELDS =
  'id, listing_number, title, price, deal_type, property_type, rooms, floor, total_floors, ' +
  'size_sqm, built_size_sqm, garden_sqm, city, street, house_number, sales_area, features, ' +
  'condition, move_in_date, description, status, agent_id';

let agrAgencyPropertyRows = null;   // null = טרם נטען
let agrOwnPropertyRows    = null;   // גיבוי לנכסים שלי, כשטעינת הדשבורד נפלה
let agrPropertyLoadFailed = false;  // נכשלה טעינה של אחד המאגרים

async function agrLoadAgencyProperties(){
  if (agrAgencyPropertyRows) return agrAgencyPropertyRows;
  if (!currentAgent || !currentAgent.agency_id) return (agrAgencyPropertyRows = []);

  const { data, error } = await sb.from('properties')
    .select(AGR_PROPERTY_FIELDS)
    .eq('agency_id', currentAgent.agency_id)
    .neq('agent_id', currentAgent.id)
    .order('created_at', { ascending:false });

  // ‏RLS כבר מגבילה למה שמותר לראות; שגיאה כאן רק מרוקנת את המאגר הזה —
  // אבל היא נרשמת, כדי שהמסך יגיד "לא הצלחנו לטעון" ולא "לא נמצא".
  // ‏null ולא [] כדי שפתיחה הבאה של האשף תנסה שוב.
  if (error){
    console.warn('טעינת נכסי המשרד לאשף ההסכמים נכשלה:', error);
    agrPropertyLoadFailed = true;
    agrAgencyPropertyRows = null;
    return [];
  }
  agrAgencyPropertyRows = data || [];
  return agrAgencyPropertyRows;
}

/* הנכסים שלי — רק כשהדשבורד לא הביא אותם. בזרימה התקינה זו פונקציה
   שמחזירה מיד ואינה פונה למסד כלל. */
async function agrLoadOwnProperties(){
  if (myPropertyRows && myPropertyRows.length) return myPropertyRows;
  if (agrOwnPropertyRows) return agrOwnPropertyRows;
  if (!currentAgent) return [];

  const { data, error } = await sb.from('properties')
    .select(AGR_PROPERTY_FIELDS)
    .eq('agent_id', currentAgent.id)
    .order('created_at', { ascending:false });

  if (error){
    console.warn('טעינת הנכסים שלי לאשף ההסכמים נכשלה:', error);
    agrPropertyLoadFailed = true;
    agrOwnPropertyRows = null;
    return [];
  }
  agrOwnPropertyRows = data || [];
  return agrOwnPropertyRows;
}

/* ‏shared_properties_for_me הוא view עם מפתח בשם אחר (‏property_id) ועם
   חלק מהשדות בלבד. הנרמול כאן הוא מה שמאפשר לשלושת המאגרים לזרום דרך
   אותו קוד מיפוי שדות. */
function agrNormalizeShared(r){
  return Object.assign({}, r, { id: r.property_id, agency_label: r.owner_agency_name });
}

function agrPropertyCandidates(){
  const out = [];
  const own = (myPropertyRows && myPropertyRows.length) ? myPropertyRows : (agrOwnPropertyRows || []);
  own.forEach(p => out.push({ source:'own', row:p }));
  (agrAgencyPropertyRows || []).forEach(p => out.push({ source:'agency', row:p }));
  (sharedWithMeRows || []).forEach(r => out.push({ source:'shared', row:agrNormalizeShared(r) }));
  return out;
}

function agrCandidateById(id){
  return agrPropertyCandidates().find(c => c.row.id === id) || null;
}

function agrCandidateBlob(c){
  const p = c.row;
  return [p.title, p.city, p.street, p.house_number, p.property_type, p.sales_area,
          p.listing_number, p.agency_label, AGR_SOURCE_LABELS[c.source]]
    .filter(Boolean).join(' ').toLowerCase();
}

/* ---------- רשימת התוצאות ----------
   בלי חיפוש מוצגים שמונה האחרונים מכל המאגרים — מספיק כדי שברוב המקרים
   הנכס כבר יהיה על המסך, ולא כל כך הרבה שהרשימה תחליף את הטופס. */
function agrRenderPropResults(){
  const host = agrEl('agrPropResults');
  if (!host) return;
  const q = (agrEl('agrPropSearch').value || '').trim().toLowerCase();
  const picked = new Set(agrWizard.properties.map(p => p.property_id).filter(Boolean));

  let rows = agrPropertyCandidates();
  if (q) rows = rows.filter(c => agrCandidateBlob(c).includes(q));
  const total = rows.length;
  if (!q) rows = rows.slice(0, 8);

  if (!total){
    /* ההבחנה כאן היא כל העניין: "לא נמצא" אומר לסוכן/ת שהנכס אינו במערכת,
       ובכשל טעינה זו הודעה שקרית — הנכס שם, ורק לא הגענו אליו. */
    host.innerHTML = '<div class="agr-res-empty">' +
      (agrPropertyLoadFailed
         ? 'לא הצלחנו לטעון את רשימת הנכסים. רעננו את הדף ונסו שוב - ' +
           'ובינתיים אפשר להזין את הנכס ידנית.'
       : q ? 'אין נכס שמתאים לחיפוש. אפשר להזין אותו ידנית.'
           : 'אין נכסים במערכת - הזינו את הנכס ידנית.') + '</div>';
    return;
  }

  host.innerHTML = rows.map(c => {
    const p = c.row;
    const address = [[p.street, p.house_number].filter(Boolean).join(' '), p.city].filter(Boolean).join(', ');
    const bits = [
      address,
      p.property_type,
      p.rooms ? p.rooms + ' חד׳' : '',
      p.price ? shekel(p.price) : '',
      c.source === 'shared' && p.agency_label ? '🤝 ' + p.agency_label : '',
    ].filter(Boolean).join(' · ');
    const isPicked = picked.has(p.id);
    return `<button type="button" class="agr-res${isPicked ? ' is-picked' : ''}"
              data-agr="pick-prop" data-id="${esc(p.id)}"${isPicked ? ' disabled' : ''}>
        <span class="agr-src agr-src-${esc(c.source)}">${esc(AGR_SOURCE_LABELS[c.source])}</span>
        <span class="agr-res-main">
          <span class="agr-res-title">${esc(p.title || address || 'נכס ללא כותרת')}</span>
          ${bits ? `<span class="agr-res-sub">${esc(bits)}</span>` : ''}
        </span>
        <span style="font-size:1.1rem;color:var(--teal)">${isPicked ? '✓' : '+'}</span>
      </button>`;
  }).join('') +
  (q && total > rows.length ? '' : '') +
  (!q && total > 8
    ? `<div class="agr-res-empty">מוצגים 8 מתוך ${total} - הקלידו כדי לחפש</div>` : '');
}

function agrRenderPropChips(){
  const host = agrEl('agrPropChips');
  if (!host) return;
  if (!agrWizard.properties.length){
    host.innerHTML = '<p class="imp-note" style="margin:0">לא נבחר נכס.</p>';
    return;
  }
  host.innerHTML = agrWizard.properties.map(p =>
    `<div class="agr-chip">
       <span style="min-width:0"><span class="agr-src agr-src-${esc(p.source)}">${
         esc(AGR_SOURCE_LABELS[p.source] || 'ידני')}</span> ${esc(p.label)}</span>
       <button type="button" class="x" data-agr="rm-prop" data-uid="${esc(p.uid)}" aria-label="הסרה">✕</button>
     </div>`).join('');
}

/* מושך מהמערכת את מה שידוע על הנכס — כולל בעלים וגוש/חלקה, ששוכנים
   בטבלאות נפרדות דווקא כי הם רגישים מכדי לשבת ב-properties.

   ‏שתי השאילתות רצות גם על נכס של המשרד ושל שת"פ, ושתיהן עשויות לחזור
   ריקות: ה-RLS על property_owners ועל property_planning_info מצומצמת
   לסוכן/ת שהנכס שלו/ה. זה לא כשל — הסוכן/ת ימלא/תמלא את מה שחסר, וזה
   ממילא מידע שהוא/היא צריך/ה לאמת מול הבעלים לפני שהוא נכנס להסכם. */
async function agrAddProperty(propertyId, opts){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);
  const cand = agrCandidateById(propertyId);
  if (!cand) return;
  if (w.properties.some(x => x.property_id === propertyId)) return;
  const p = cand.row;

  const [ownerRes, planRes] = await Promise.all([
    sb.from('property_owners').select('*').eq('property_id', propertyId).maybeSingle(),
    // הנכסים שלי כבר נשאלו פעם אחת בטעינת הדשבורד — אין טעם בשאילתה שנייה
    propertyPlanningInfo[propertyId]
      ? Promise.resolve({ data: propertyPlanningInfo[propertyId] })
      : sb.from('property_planning_info').select('gush, helka').eq('property_id', propertyId).maybeSingle(),
  ]);
  const owner = ownerRes.data || null;
  const planning = planRes.data || null;

  const fields = {};
  (tpl ? tpl.propertyFields : window.AgreementTemplates.propertyFieldsFull).forEach(f => {
    fields[f.key] = agrFieldFromProperty(f, p, planning);
  });

  const entry = {
    uid: agrNextUid(), property_id: propertyId, source: cand.source,
    label: agrPropertyLabel(p), fields, notes: p.description || '',
  };

  if (tpl && tpl.propertyMode === 'single') w.properties = [entry];
  else w.properties.push(entry);

  // בטופס של צד הנכס, בעל/ת הנכס הוא/היא החותם/ת המתבקש/ת
  if (owner && owner.owner_name && tpl && tpl.side === 'owner' && !w.signers.length){
    w.signers.push({
      uid: agrNextUid(), party:'client', full_name: owner.owner_name,
      id_number: owner.owner_id_number || '', phone: owner.owner_phone || '',
      email: owner.owner_email || '', address: owner.owner_address || '', client_id: null,
    });
  }

  if (!(opts && opts.silent)){
    agrRenderPropChips();
    agrRenderPropFields();
    agrRenderSignerForms();
    agrRenderPropResults();
  }
}

/* ---------- הזנה ידנית ----------
   ששת השדות כאן הם מה שנדרש כדי לזהות נכס, ולא כל מה שמופיע במסמך. השאר
   נפתח מיד למטה בטופס המלא — כך שנכס שאינו במערכת נכנס בשלוש-עשרה שניות
   ולא בשלושים ושמונה שדות. */
function agrAddManualProperty(){
  const tpl = agrTpl(agrWizard.kind);
  const val = id => (agrEl(id) ? agrEl(id).value.trim() : '');
  const seed = {
    property_type: val('agrMpType'),
    city:          val('agrMpCity'),
    street:        val('agrMpStreet'),
    address:       val('agrMpStreet'),   // ‏sell/landlord קוראים לרחוב "כתובת"
    house_number:  val('agrMpHouse'),
    apartment_number: val('agrMpApt'),
    price:         val('agrMpPrice'),
  };

  if (!seed.property_type && !seed.street && !seed.city){
    showToast('מלאו לפחות סוג נכס, רחוב או עיר');
    return;
  }

  const fields = {};
  tpl.propertyFields.forEach(f => { fields[f.key] = seed[f.key] || ''; });

  const address = [seed.street, seed.house_number].filter(Boolean).join(' ');
  const entry = {
    uid: agrNextUid(), property_id: null, source: 'manual',
    label: [seed.property_type, [address, seed.city].filter(Boolean).join(', ')]
      .filter(Boolean).join(' - ') || 'נכס במילוי ידני',
    fields, notes: '',
  };

  if (tpl.propertyMode === 'single') agrWizard.properties = [entry];
  else agrWizard.properties.push(entry);

  ['agrMpType','agrMpStreet','agrMpHouse','agrMpApt','agrMpPrice']
    .forEach(id => { if (agrEl(id)) agrEl(id).value = ''; });
  agrEl('agrManualProp').hidden = true;

  agrRenderPropChips();
  agrRenderPropFields();
}

function agrFieldFromProperty(field, p, planning){
  const src = field.src;
  if (!src) return '';
  if (src.indexOf('feature:') === 0){
    const key = src.slice(8);
    return (p.features || []).includes(key) ? 'יש' : '';
  }
  if (src === 'gush')  return (planning && planning.gush)  || '';
  if (src === 'helka') return (planning && planning.helka) || '';
  if (src === 'neighborhood') return p.sales_area || '';
  if (src === 'condition') return AGR_CONDITION_LABELS[p.condition] || '';
  const v = p[src];
  return (v === null || v === undefined) ? '' : String(v);
}

/* ==========================================================================
   מה שמולא כאן חוזר לכרטיס הנכס
   --------------------------------------------------------------------------
   עד כאן פרטי הנכס במסמך היו חד-כיווניים: הם נקראו מ-properties, נשמרו
   ב-snapshot של ההסכם וב-HTML הקפוא — ונעצרו שם. גוש וחלקה הם הדוגמה
   החדה: ה-RLS על property_planning_info מצומצמת לסוכן/ת שהנכס שלו/ה,
   ולכן הם חוזרים ריקים לרוב, הסוכן/ת מברר/ת אותם מול הבעלים ומקליד/ה
   אותם כאן — וההסכם הבא על אותו נכס פותח אותם ריקים שוב.

   שתי הגבלות שהופכות את הכיוון ההפוך לבטוח:

     1. **השלמה בלבד, לא דריסה.** שדה שכבר יושב בכרטיס הנכס אינו נוגע.
        מסמך אינו מקור אמת על מודעה חיה — "מחיר מבוקש" בהסכם עשוי להיות
        המחיר שסוכם, ולא זה שמפורסם — ושמירה שקטה שמשנה מודעה באתר היא
        בדיוק מה שאסור שיקרה מאחורי הגב.
     2. **רק נכס שלי.** ה-RLS ממילא חוסמת כתיבה לנכס של עמית/ה או של
        משרד שת"פ, וכפתור שנכשל תמיד גרוע מכפתור שאינו מוצג.

   ‏feature:* אינם ברשימה בכוונה: במסמך הם טקסט חופשי ("2", "מקורה"),
   ובנכס הם דגל במערך — ותרגום לאחור היה הופך "2 חניות" ל"יש חניה".
   ‏condition בחוץ מאותה סיבה: "שמור מאוד" אינו אחד מחמשת הערכים הסגורים.
   ========================================================================== */
const AGR_WRITEBACK = {
  property_type:  { col:'property_type' },
  street:         { col:'street' },
  house_number:   { col:'house_number' },
  city:           { col:'city' },
  neighborhood:   { col:'sales_area' },
  rooms:          { col:'rooms',          num:{ min:0 } },
  floor:          { col:'floor',          num:{ int:true } },
  total_floors:   { col:'total_floors',   num:{ int:true, min:1, max:200 } },
  price:          { col:'price',          num:{ min:0 } },
  built_size_sqm: { col:'built_size_sqm', num:{ min:0 } },
  garden_sqm:     { col:'garden_sqm',     num:{ min:0 } },
  gush:           { col:'gush',   planning:true },
  helka:          { col:'helka',  planning:true },
};

/* מספר מתוך טקסט של מסמך: "1,850,000 ₪" הוא מה שמקלידים, ולא מה
   ש-numeric מקבל. ההפרדה בין "אין ספרות" ל-0 חיונית — בלעדיה "קומת
   קרקע" הייתה נשמרת כקומה 0. ערך שאינו עומד במגבלות הטבלה מוחזר null
   ופשוט אינו מוצע לשמירה, במקום להפיל את כל העדכון. */
function agrNumField(raw, rule){
  const digits = String(raw).replace(/[^\d.\-]/g, '');
  if (!digits || digits === '-' || digits === '.') return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  if (rule.int && !Number.isInteger(n)) return null;
  if (rule.min !== undefined && n < rule.min) return null;
  if (rule.max !== undefined && n > rule.max) return null;
  return n;
}

/* מה מהמסמך חסר בכרטיס הנכס. מחושב בזמן הלחיצה ולא בזמן הציור, כדי
   שלא יציג ספירה שהתיישנה בזמן שהקלידו. */
function agrWritebackPlan(entry){
  const tpl = agrTpl(agrWizard.kind);
  const cand = entry.property_id ? agrCandidateById(entry.property_id) : null;
  if (!cand || !tpl) return [];
  const p = cand.row;
  const planning = propertyPlanningInfo[entry.property_id] || null;
  const plan = [];

  tpl.propertyFields.forEach(f => {
    const map = f.src && AGR_WRITEBACK[f.src];
    if (!map) return;
    const raw = (entry.fields[f.key] || '').trim();
    if (!raw) return;
    const value = map.num ? agrNumField(raw, map.num) : raw;
    if (value === null) return;
    const current = map.planning ? (planning && planning[map.col]) : p[map.col];
    if (current !== null && current !== undefined && String(current).trim() !== '') return;
    plan.push({ label: f.label, col: map.col, value, planning: !!map.planning });
  });
  return plan;
}

/* בטופס של צד הנכס החותם/ת הוא/היא הבעלים — וזה בדיוק המידע ש-
   ‏agrAddProperty מנסה לקרוא בכיוון ההפוך כדי למלא את החותם/ת מראש.
   גם כאן: השלמה בלבד, ולכן צריך לקרוא את השורה הקיימת. */
async function agrOwnerPatch(entry){
  const tpl = agrTpl(agrWizard.kind);
  const signer = agrWizard.signers[0];
  if (!tpl || tpl.side !== 'owner' || !signer || !entry.property_id) return null;

  const { data } = await sb.from('property_owners').select('*')
    .eq('property_id', entry.property_id).maybeSingle();
  const cur = data || {};
  const patch = {};
  const fill = (col, val) => {
    if (val && !String(cur[col] || '').trim()) patch[col] = val;
  };
  fill('owner_name',      signer.full_name.trim());
  fill('owner_phone',     signer.phone.trim());
  fill('owner_email',     signer.email.trim());
  fill('owner_id_number', signer.id_number.trim());
  fill('owner_address',   signer.address.trim());
  return Object.keys(patch).length ? patch : null;
}

async function agrSaveToProperty(uid, btn){
  const entry = agrWizard.properties.find(p => p.uid === uid);
  if (!entry || !entry.property_id) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שומר…';

  const plan = agrWritebackPlan(entry);
  const ownerPatch = await agrOwnerPatch(entry);

  if (!plan.length && !ownerPatch){
    btn.disabled = false; btn.textContent = original;
    showToast('כל מה שמולא כאן כבר שמור בכרטיס הנכס');
    return;
  }

  const propPatch = {}, planPatch = {};
  plan.forEach(x => { (x.planning ? planPatch : propPatch)[x.col] = x.value; });
  const failed = [];

  if (Object.keys(propPatch).length){
    const { error } = await sb.from('properties').update(propPatch).eq('id', entry.property_id);
    if (error){ console.warn('שמירת פרטי הנכס נכשלה:', error); failed.push('פרטי הנכס'); }
    else {
      // ‏המטמון בזיכרון מתעדכן, אחרת לחיצה שנייה תציע לשמור את אותו הדבר
      const cand = agrCandidateById(entry.property_id);
      if (cand) Object.assign(cand.row, propPatch);
    }
  }
  if (Object.keys(planPatch).length){
    const { error } = await sb.from('property_planning_info')
      .upsert(Object.assign({ property_id: entry.property_id }, planPatch),
              { onConflict: 'property_id' });
    if (error){ console.warn('שמירת גוש/חלקה נכשלה:', error); failed.push('גוש/חלקה'); }
    else propertyPlanningInfo[entry.property_id] =
      Object.assign({}, propertyPlanningInfo[entry.property_id] || {}, planPatch);
  }
  if (ownerPatch){
    const { error } = await sb.from('property_owners')
      .upsert(Object.assign({ property_id: entry.property_id }, ownerPatch),
              { onConflict: 'property_id' });
    if (error){ console.warn('שמירת פרטי הבעלים נכשלה:', error); failed.push('פרטי הבעלים'); }
  }

  btn.disabled = false; btn.textContent = original;

  if (failed.length){
    showToast('חלק מהפרטים לא נשמרו בכרטיס הנכס (' + failed.join(', ') + ') - ההסכם עצמו לא נפגע');
    return;
  }
  const names = plan.map(x => x.label);
  if (ownerPatch) names.push('פרטי הבעלים');
  showToast('נשמר בכרטיס הנכס: ' + names.join(', '));
  agrRenderPropFields();
}

/* ---------- נכס שהוזן ידנית → מודעה במאגר ----------
   ‏המסלול הידני נועד לנכס שאינו במערכת, והוא הוליד עד כה נתונים שחיים
   רק בתוך ההסכם: הסכם שני על אותו נכס דרש להקליד הכול שוב, והוספתו
   כמודעה דרשה מעבר לטופס הנכסים ומילוי שלישי. הכפתור הזה סוגר את זה. */
const AGR_KIND_DEAL_TYPE = {
  sell:'sale', buy:'sale', exclusive_sell:'sale',
  landlord:'rent', tenant:'rent', exclusive_landlord:'rent',
};

async function agrAddPropertyToCatalog(uid, btn){
  const entry = agrWizard.properties.find(p => p.uid === uid);
  if (!entry || entry.property_id) return;
  if (!currentAgent || !currentAgent.agency_id){
    showToast('אפשר להוסיף נכסים למאגר רק מחשבון המשויך למשרד');
    return;
  }
  const f = entry.fields;
  const txt = k => (f[k] || '').trim();
  const propertyType = txt('property_type');
  const city   = txt('city');
  /* המסמך החתום נכתב בטקסט חופשי, ולכן שם הרחוב שבו עובר את אותו יישור כמו
     בטופס — בלי חסימה: אין כאן טופס לחזור אליו, וכתובת שתרד היא נכס בלי פין.
     הרשימה נטענת כאן ולא בפתיחת האשף, כי זה המקום היחיד בו היא נחוצה. */
  await ensureStreetsLoaded();
  const street = canonicalStreet(txt('street') || txt('address'), city).name;
  const price  = agrNumField(txt('price'), { min:0 });

  /* ‏properties דורשת את השלושה האלה ב-NOT NULL. עדיף להגיד מה חסר
     מאשר לשלוח insert שייפול על constraint. */
  const missing = [];
  if (!propertyType) missing.push('סוג הנכס');
  if (!city)  missing.push('עיר');
  if (price === null) missing.push('מחיר מבוקש');
  if (missing.length){
    showToast('כדי להוסיף למאגר חסר: ' + missing.join(', ') + ' - מלאו בפרטי הנכס במסמך');
    return;
  }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'מוסיף…';

  const address = [street, txt('house_number')].filter(Boolean).join(' ');
  const num = (k, rule) => agrNumField(txt(k), rule);
  const payload = {
    agent_id: currentAgent.id,
    agency_id: currentAgent.agency_id,
    status: 'active',
    title: [propertyType, [address, city].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    property_type: propertyType,
    category: COMMERCIAL_PTYPE_OPTIONS.includes(propertyType) ? 'commercial' : 'residential',
    // ‏dealType של התבנית הוא בסיס חישוב העמלה ותמיד 'sale'; סוג העסקה
    // של הנכס נגזר מסוג ההסכם עצמו
    deal_type: AGR_KIND_DEAL_TYPE[agrWizard.kind] || 'sale',
    city,
    street: street || null,
    house_number: txt('house_number') || null,
    price,
    rooms:          num('rooms', { min:0 }),
    floor:          num('floor', { int:true }),
    total_floors:   num('total_floors', { int:true, min:1, max:200 }),
    built_size_sqm: num('built_sqm', { min:0 }),
    garden_sqm:     num('plot_sqm', { min:0 }),
    sales_area:     txt('location') || null,
    description:    entry.notes || null,
  };

  const { data: created, error } = await sb.from('properties')
    .insert(payload).select('id').single();
  if (error){
    btn.disabled = false; btn.textContent = original;
    showToast('הוספת הנכס למאגר נכשלה: ' + error.message);
    return;
  }

  entry.property_id = created.id;
  entry.source = 'own';

  // גוש/חלקה ובעלים — best-effort, בדיוק כמו בטופס הנכסים עצמו
  const gush = txt('gush'), helka = txt('helka');
  if (gush || helka){
    const { error: planErr } = await sb.from('property_planning_info').upsert(
      { property_id: created.id, gush: gush || null, helka: helka || null },
      { onConflict: 'property_id' });
    if (planErr) console.warn('שמירת גוש/חלקה לנכס החדש נכשלה:', planErr);
    else propertyPlanningInfo[created.id] = { gush: gush || null, helka: helka || null };
  }
  const ownerPatch = await agrOwnerPatch(entry);
  if (ownerPatch){
    const { error: ownErr } = await sb.from('property_owners').upsert(
      Object.assign({ property_id: created.id }, ownerPatch), { onConflict: 'property_id' });
    if (ownErr) console.warn('שמירת פרטי הבעלים לנכס החדש נכשלה:', ownErr);
  }

  // ‏loadProperties מרענן גם את myPropertyRows, ולכן הנכס החדש נמצא מיד
  // בחיפוש של האשף ובלשונית הנכסים — בלי לרענן את הדף
  await loadProperties(currentAgent.id);

  btn.disabled = false; btn.textContent = original;
  showToast('הנכס נוסף למאגר שלך - השלימו תמונות ותיאור בלשונית "הנכסים שלי"');
  agrRenderPropChips();
  agrRenderPropFields();
  agrRenderPropResults();
}

function agrRenderPropFields(){
  const host = agrEl('agrPropFields');
  if (!host) return;
  const tpl = agrTpl(agrWizard.kind);
  if (!agrWizard.properties.length){
    host.innerHTML = '<p class="imp-note" style="margin:0">בחרו נכס כדי למלא את פרטיו.</p>';
    return;
  }
  const overrides = tpl.propertyLabelOverrides || {};

  host.innerHTML = agrWizard.properties.map((entry, idx) => {
    const inputs = tpl.propertyFields.map(f =>
      `<div class="agr-field"><label>${esc(overrides[f.key] || f.label)}</label>
         <input type="text" data-agr-pf="${esc(entry.uid)}" data-key="${esc(f.key)}" value="${esc(entry.fields[f.key] || '')}"></div>`
    ).join('');
    return (agrWizard.properties.length > 1
        ? `<div class="form-subheading">נכס ${idx + 1} · ${esc(entry.label)}</div>` : '') +
      '<div class="agr-fields">' + inputs + '</div>' +
      `<div class="agr-field" style="margin-top:9px"><label>הערות לנכס</label>
         <textarea rows="2" data-agr-pnotes="${esc(entry.uid)}">${esc(entry.notes || '')}</textarea></div>` +
      agrPropFieldsFooter(entry);
  }).join('<hr style="border:none;border-top:1px dashed var(--line);margin:14px 0">');
}

/* שורת "ומה קורה למה שמילאתי כאן" מתחת לכל נכס. היא נכתבת גם כשאין מה
   לעשות (נכס של המשרד או של שת"פ), כי השאלה נשאלת בכל מקרה — והתשובה
   השקטה עד כה הייתה "כלום". */
function agrPropFieldsFooter(entry){
  const box = inner =>
    '<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">' + inner + '</div>';

  if (!entry.property_id){
    return box(
      `<button type="button" class="btn btn-ghost btn-block" data-agr="add-to-catalog"
               data-uid="${esc(entry.uid)}">➕ הוספת הנכס למאגר שלי</button>` +
      '<p class="imp-note" style="margin:8px 0 0">הנכס הוזן ידנית וחי כרגע בהסכם הזה בלבד. ' +
      'ההוספה יוצרת ממנו מודעה בלשונית "הנכסים שלי" - עם מה שמולא כאן, כולל גוש/חלקה ' +
      'ופרטי הבעלים - כך שלא תצטרכו להזין אותו שוב.</p>');
  }
  if (entry.source !== 'own'){
    return box('<p class="imp-note" style="margin:0">הנכס אינו שלך (' +
      esc(AGR_SOURCE_LABELS[entry.source] || entry.source) + '), ולכן מה שמולא כאן נשמר ' +
      'בהסכם בלבד ואינו נכתב לכרטיס הנכס.</p>');
  }
  return box(
    `<button type="button" class="btn btn-ghost btn-block" data-agr="save-to-property"
             data-uid="${esc(entry.uid)}">💾 שמירת הפרטים גם בכרטיס הנכס</button>` +
    '<p class="imp-note" style="margin:8px 0 0">מה שהשלמתם כאן - גוש, חלקה, שטח וכל השאר - ' +
    'ייכנס לכרטיס הנכס, כך שההסכם הבא עליו כבר יימצא אותו מלא. ' +
    'שדה שכבר קיים בכרטיס אינו נדרס.</p>');
}

/* ---------- תוצאות קובץ הלקוחות ----------
   בלי חיפוש מוצגים שמונה האחרונים, כמו בנכסים. מי שכבר נבחר/ה מסומן/ת
   ואינו/ה ניתן/ת ללחיצה — הוספה כפולה של אותו/ה לקוח/ה כחותם/ת היא שגיאה
   שקטה שמתגלה רק במסמך. */
function agrRenderClientResults(){
  const host = agrEl('agrClientResults');
  if (!host) return;
  const q = (agrEl('agrClientSearch').value || '').trim().toLowerCase();
  const picked = new Set(agrWizard.signers.map(s => s.client_id).filter(Boolean));

  let rows = clientRows || [];
  if (q) rows = rows.filter(c => clientSearchBlob(c).includes(q));
  const total = rows.length;
  if (!q) rows = rows.slice(0, 8);

  if (!total){
    host.innerHTML = '<div class="agr-res-empty">' +
      (q ? 'אין לקוח/ה שמתאים/ה לחיפוש. אפשר להזין ידנית.'
         : 'קובץ הלקוחות ריק - הזינו את החותם/ת ידנית.') + '</div>';
    return;
  }

  host.innerHTML = rows.map(c => {
    const bits = [c.phone, c.email, (c.cities || []).join(', ')].filter(Boolean).join(' · ');
    const isPicked = picked.has(c.id);
    return `<button type="button" class="agr-res${isPicked ? ' is-picked' : ''}"
              data-agr="pick-client" data-id="${esc(c.id)}"${isPicked ? ' disabled' : ''}>
        <span class="agr-src agr-src-own">${esc(CLIENT_STATUS_LABELS[c.status] || c.status)}</span>
        <span class="agr-res-main">
          <span class="agr-res-title">${esc(c.full_name)}</span>
          ${bits ? `<span class="agr-res-sub">${esc(bits)}</span>` : ''}
        </span>
        <span style="font-size:1.1rem;color:var(--teal)">${isPicked ? '✓' : '+'}</span>
      </button>`;
  }).join('') +
  (!q && total > 8
    ? `<div class="agr-res-empty">מוצגים 8 מתוך ${total} - הקלידו כדי לחפש</div>` : '');
}

function agrAddClientSigner(clientId, opts){
  const c = clientRows.find(x => x.id === clientId);
  if (!c) return;
  if (agrWizard.signers.some(s => s.client_id === clientId)) return;
  agrWizard.signers.push({
    uid: agrNextUid(), party: agrWizard.signers.length ? 'partner' : 'client',
    full_name: c.full_name || '', id_number: c.id_number || '', phone: c.phone || '',
    email: c.email || '', address: c.address || '', client_id: c.id,
  });
  if (!(opts && opts.silent)){
    agrRenderSignerForms();
    agrRenderClientResults();
  }
}

function agrAddBlankSigner(){
  agrWizard.signers.push({
    uid: agrNextUid(), party: agrWizard.signers.length ? 'partner' : 'client',
    full_name:'', id_number:'', phone:'', email:'', address:'', client_id:null,
  });
  agrRenderSignerForms();
  agrRenderClientResults();
}

function agrRenderSignerForms(){
  const host = agrEl('agrSignerForms');
  if (!host) return;
  if (!agrWizard.signers.length){
    host.innerHTML = '<p class="imp-note" style="margin:0">לא נבחרו חותמים.</p>';
    return;
  }
  host.innerHTML = agrWizard.signers.map((s, i) => `
    <div class="agr-sec" style="background:#fff;margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="font-size:.84rem">${i === 0 ? 'בין' : 'ובין'} - חותם/ת ${i + 1}</b>
        <button type="button" class="x" data-agr="rm-signer" data-uid="${esc(s.uid)}" aria-label="הסרה"
                style="background:none;color:var(--brick);font-weight:800;padding:2px 6px">✕</button>
      </div>
      <div class="agr-grid">
        <div class="agr-field"><label>שם מלא</label>
          <input type="text" data-agr-sf="${esc(s.uid)}" data-key="full_name" value="${esc(s.full_name)}"></div>
        <div class="agr-field"><label>ת.ז. / ח״פ</label>
          <input type="text" data-agr-sf="${esc(s.uid)}" data-key="id_number" value="${esc(s.id_number)}"></div>
        <div class="agr-field"><label>טלפון</label>
          <input type="tel" dir="ltr" style="text-align:right" data-agr-sf="${esc(s.uid)}" data-key="phone" value="${esc(s.phone)}"></div>
        <div class="agr-field"><label>אימייל (נדרש לחתימה מרחוק)</label>
          <input type="email" dir="ltr" style="text-align:right" data-agr-sf="${esc(s.uid)}" data-key="email" value="${esc(s.email)}"></div>
      </div>
      <div class="agr-field" style="margin-top:8px"><label>כתובת (לא חובה)</label>
        <input type="text" data-agr-sf="${esc(s.uid)}" data-key="address" value="${esc(s.address)}"></div>
    </div>`).join('');
}

/* ---------- תקופת הבלעדיות ----------
   ‏"שלושה חודשים מהיום" הוא איך שסוכן/ת חושב/ת על בלעדיות, ושני תאריכים
   הם מה שההסכם דורש. הבורר מתרגם בין השניים, וההזנה הידנית נשארת פתוחה
   לתקופה שאינה עגולה (למשל בלעדיות שמסתיימת ביום מסירת הנכס). */

/* חודש קלנדרי ולא 30 יום: בלעדיות מ-31.1 לחודש מסתיימת בסוף פברואר, ולכן
   היום נחתך לאורך החודש היעד. הסיום הוא **יום לפני** אותו תאריך — תקופה של
   שלושה חודשים מ-17.09 היא עד 16.12, ולא עד 17.12 שהם שלושה חודשים ויום. */
function agrAddMonthsIso(iso, months){
  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !n || isNaN(n))) return '';
  const n = Number(months);
  if (!n) return '';
  const [y, m, d] = parts;
  const end = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  end.setDate(Math.min(d, lastDay));
  end.setDate(end.getDate() - 1);
  const pad = v => String(v).padStart(2, '0');
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

function agrTodayIso(){
  const t = new Date();
  const pad = v => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/* ‏dd/mm/yyyy — אותו פורמט שבו התאריכים מודפסים בסעיף 1 של ההסכם */
function agrSlashDate(iso){
  const parts = String(iso || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '';
}

/* השורה שמתחת לבורר. היא לא קישוט: היא מה שמוודא שהסוכן/ת רואה את התקופה
   שתודפס בפועל לפני שהמסמך נוצר ונחסם לעריכה. */
function agrExclusiveSummary(){
  const ex = agrWizard ? agrWizard.exclusive : null;
  if (!ex) return '';
  if (!ex.from || !ex.until){
    return 'בחרו משך בחודשים - "מיום" יתמלא בתאריך של היום ו"עד ליום" יחושב לפי המשך; ' +
           'או בחרו "תאריכים ידניים" והזינו את שניהם.';
  }
  const days = Math.round(
    (new Date(ex.until + 'T00:00:00') - new Date(ex.from + 'T00:00:00')) / 86400000) + 1;
  return 'בהסכם יודפס: מ-' + agrSlashDate(ex.from) + ' עד ' + agrSlashDate(ex.until) +
    (ex.months ? ` · ${ex.months} חודשי בלעדיות` : ' · תאריכים ידניים') +
    (days > 0 ? ` · ${plural(days, 'יום אחד', 'ימים')}` : ' · שימו לב: תאריך הסיום קודם לתאריך ההתחלה');
}

/* מעדכנת את השדות במקום לצייר את השלב מחדש: ציור מחדש היה מחזיר את הגלילה
   לראש הטופס הארוך, בדיוק אחרי לחיצה שנעשתה בתחתיתו. */
function agrPaintExclusive(){
  const w = agrWizard;
  const from = agrEl('agrExFrom'), until = agrEl('agrExUntil'), note = agrEl('agrExSummary');
  if (from) from.value = w.exclusive.from || '';
  if (until){
    until.value = w.exclusive.until || '';
    until.readOnly = !!w.exclusive.months;
  }
  document.querySelectorAll('[data-agr="ex-months"]').forEach(b =>
    b.classList.toggle('is-on', b.dataset.months === String(w.exclusive.months || '')));
  if (note) note.textContent = agrExclusiveSummary();
}

function agrSetExclusiveMonths(months){
  const w = agrWizard;
  if (!w) return;
  w.exclusive.months = months || '';
  if (w.exclusive.months){
    // בלי תאריך התחלה אין מה לחשב, ו"היום" הוא ההתחלה בכל בלעדיות שנחתמת עכשיו
    if (!w.exclusive.from) w.exclusive.from = agrTodayIso();
    w.exclusive.until = agrAddMonthsIso(w.exclusive.from, w.exclusive.months);
  }
  agrPaintExclusive();
}

/* ---------- קריאת הטופס ---------- */

function agrCollectDetails(){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);

  const pct = agrEl('agrPct');
  const amount = agrEl('agrAmount');
  const basis = agrEl('agrBasis');
  if (pct) w.commission.pct = pct.value.trim();
  if (amount) w.commission.amount = amount.value.trim();
  if (basis) w.commission.basis = basis.value;

  const notes = agrEl('agrNotes');
  if (notes) w.notes = notes.value.trim();
  const lang = agrEl('agrLang');
  if (lang) w.language = lang.value;

  if (tpl.exclusive){
    w.exclusive.from = agrEl('agrExFrom').value;
    w.exclusive.until = agrEl('agrExUntil').value;
  }

  if (tpl.questionnaire){
    document.querySelectorAll('[data-agr-q]').forEach(t => {
      w.questionnaire[Number(t.dataset.agrQ)] = t.value.trim();
    });
  }
}

/* ---------- שלב 3: תצוגה מקדימה ---------- */

/* ‏מחזירה פריטים ולא מחרוזות, וזו כל הנקודה: רוב מה שחסר כאן הוא **שדה
   אחד קצר** — ת.ז. של חותם/ת, ת.ז. של הסוכן/ת, שיעור העמלה. המסך הישן
   רק הודיע עליו ושלח את הסוכן/ת חזרה לשלב הקודם, לגלול עד הטופס הנכון,
   למלא, ולעבור שוב את כל האשף — בשביל תשע ספרות. פריט עם `fields` נפתח
   בשלב 3 כתיבה למילוי מהיר; פריט בלעדיהם (אין נכס, אין חותם/ת) הוא חסר
   מבני שאין לו קיצור דרך. */
function agrValidate(){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);
  const items = [];
  const add = (text, fields) => items.push({ text, fields: fields || [] });

  if (!w.properties.length) add('לא נבחרו נכסים להסכם');
  if (!w.signers.length) add('לא נבחרו לקוחות להסכם');

  w.signers.forEach((s, i) => {
    const who = s.full_name.trim() || `חותם/ת ${i + 1}`;
    if (!s.full_name.trim()){
      add(`חסר שם לחותם/ת ${i + 1}`, [{
        scope:'signer', uid:s.uid, key:'full_name',
        label:`שם מלא - חותם/ת ${i + 1}`, value:s.full_name }]);
    }
    if (!s.id_number.trim()){
      add(`חסרה ת.ז. לחותם/ת ${i + 1} (${who})`, [{
        scope:'signer', uid:s.uid, key:'id_number',
        label:`ת.ז. / ח״פ - ${who}`, value:s.id_number, inputmode:'numeric', ltr:true }]);
    }
  });

  const hasPct = w.commission.pct !== '' && Number(w.commission.pct) > 0;
  const hasAmount = w.commission.amount !== '' && Number(w.commission.amount) > 0;
  if (!hasPct && !hasAmount){
    add('לא הוזנה עמלה - אחוזים או סכום', [
      { scope:'commission', key:'pct',    label:'עמלה באחוזים',
        type:'number', step:'0.01', value:w.commission.pct },
      { scope:'commission', key:'amount', label:'או סכום עמלה (₪)',
        type:'number', value:w.commission.amount },
    ]);
  }
  if (tpl.exclusive && (!w.exclusive.from || !w.exclusive.until)){
    add('חסרה תקופת הבלעדיות', [
      { scope:'exclusive', key:'from',  label:'בלעדיות מיום', type:'date', value:w.exclusive.from },
      { scope:'exclusive', key:'until', label:'ועד ליום',     type:'date', value:w.exclusive.until },
    ]);
  }
  if (!currentAgent || !currentAgent.id_number){
    add('חסרה ת.ז. בפרטי הסוכן/ת', [{
      scope:'agent', key:'id_number', label:'ת.ז. / ח״פ שלך - תישמר בפרופיל',
      value:'', inputmode:'numeric', ltr:true }]);
  }
  return items;
}

function agrBuildDoc(){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);
  const bases = window.AgreementTemplates.commissionBases[tpl.dealType] || [];
  const basis = bases.find(b => b.key === w.commission.basis);

  return {
    template: tpl,
    agent: {
      name: currentAgent.display_name,
      id_number: currentAgent.id_number,
      license_number: currentAgent.license_number,
      phone: currentAgent.phone,
      agency_name: (currentAgent.agencies && currentAgent.agencies.name) || agrAgencyName(),
      agency_address: agrAgencyAddress(),
    },
    signers: w.signers.map(s => ({
      full_name:s.full_name, id_number:s.id_number, phone:s.phone,
      email:s.email, address:s.address, party:s.party,
    })),
    properties: w.properties.map(p => ({ fields:p.fields, notes:p.notes })),
    commission: { pct:w.commission.pct, amount:w.commission.amount, basisSuffix: basis ? basis.suffix : '' },
    exclusive: tpl.exclusive ? w.exclusive : null,
    questionnaire: w.questionnaire,
    notes: w.notes,
    createdAt: new Date(),
    verifyCode: w.record ? w.record.verify_code : '-',
  };
}

/* שם המשרד וכתובתו יושבים על currentAgent רק בחלק מהמסלולים; שתי
   הפונקציות האלה מונעות ריצה על undefined בלי לפזר בדיקות בקוד המסמך. */
function agrAgencyName(){
  return (window.currentAgency && window.currentAgency.name) || '';
}
function agrAgencyAddress(){
  return (window.currentAgency && window.currentAgency.address) || '';
}

/* תיבה אחת לכל שדה חסר. ה-data-* הם מה שמחזיר את הערך למקומו באשף —
   מזהה החותם/ת נשמר על התיבה עצמה, כדי שהאיסוף לא יצטרך לנחש סדר. */
function agrQuickFillField(f){
  return '<div class="agr-field"><label>' + esc(f.label) + '</label>' +
    `<input type="${f.type || 'text'}"` +
    (f.step ? ` step="${esc(f.step)}"` : '') +
    (f.inputmode ? ` inputmode="${esc(f.inputmode)}"` : '') +
    (f.ltr ? ' dir="ltr" style="text-align:right"' : '') +
    ' data-agr-qf="1"' +
    ` data-qf-scope="${esc(f.scope)}" data-qf-key="${esc(f.key)}"` +
    (f.uid ? ` data-qf-uid="${esc(f.uid)}"` : '') +
    ` value="${esc(f.value ?? '')}"></div>`;
}

/* ‏מילוי מהיר: כותב את מה שהוזן חזרה לאשף, מנציח את מה ששייך למסד,
   ומצייר את השלב מחדש. מה שנשאר חסר יוצג שוב — עם מה שכבר הוקלד. */
async function agrQuickFill(btn){
  const w = agrWizard;
  let agentIdNumber = null;
  const clientIdNumbers = new Map();   // client_id → ת.ז. שהוקלדה

  agrEl('agrBody').querySelectorAll('[data-agr-qf]').forEach(el => {
    const v = el.value.trim();
    const { qfScope: scope, qfKey: key, qfUid: uid } = el.dataset;
    if (scope === 'signer'){
      const s = w.signers.find(x => x.uid === uid);
      if (!s) return;
      s[key] = v;
      if (v && key === 'id_number' && s.client_id) clientIdNumbers.set(s.client_id, v);
    }
    else if (scope === 'commission') w.commission[key] = v;
    else if (scope === 'exclusive')  w.exclusive[key]  = v;
    else if (scope === 'agent' && v) agentIdNumber = v;
  });

  // מי שבחר/ה משך בחודשים והשלים/ה כאן רק את תאריך ההתחלה מקבל/ת את הסיום
  // המחושב, ולא נשלח/ת חזרה לבורר שנשאר בשלב הקודם
  if (w.exclusive.months && w.exclusive.from && !w.exclusive.until){
    w.exclusive.until = agrAddMonthsIso(w.exclusive.from, w.exclusive.months);
  }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שומר…';

  /* ‏currentAgent מתעדכן בכל מקרה: המסמך נבנה ממנו, וכשל שמירה בפרופיל
     אינו סיבה לעצור הסכם שהת.ז. עבורו כבר הוקלדה. */
  if (agentIdNumber){
    currentAgent.id_number = agentIdNumber;
    const { error } = await sb.from('agency_members')
      .update({ id_number: agentIdNumber }).eq('id', currentAgent.id);
    if (error){
      console.warn('שמירת ת.ז. בפרופיל הסוכן/ת נכשלה:', error);
      showToast('הת.ז. תשמש בהסכם הזה אך לא נשמרה בפרופיל - עדכנו אותה ב"עדכון פרטי הסוכן/ת"');
    }
  }

  // ‏best-effort, ומאותה סיבה: ההסכם ממשיך גם אם כרטיס הלקוח/ה לא עודכן
  for (const [clientId, idNumber] of clientIdNumbers){
    const { error } = await sb.from('agent_clients')
      .update({ id_number: idNumber }).eq('id', clientId);
    if (error){ console.warn('שמירת ת.ז. בכרטיס הלקוח/ה נכשלה:', error); continue; }
    const row = (clientRows || []).find(c => c.id === clientId);
    if (row) row.id_number = idNumber;
  }

  btn.disabled = false; btn.textContent = original;
  agrRender();
}

function agrRenderStepPreview(){
  const missing = agrValidate();
  const body = agrEl('agrBody');

  if (missing.length){
    const fixable  = missing.filter(m => m.fields.length);
    const blocking = missing.filter(m => !m.fields.length);
    const fields   = fixable.reduce((all, m) => all.concat(m.fields), []);

    body.innerHTML =
      '<div style="text-align:center;padding:8px 0 12px">' +
        '<div style="font-size:2rem">⚠️</div>' +
        '<h3 style="font-family:\'Frank Ruhl Libre\',serif;margin:6px 0 4px">' +
          (fixable.length ? 'חסרים כמה פרטים ליצירת ההסכם' : 'הנתונים הבאים חסרים ליצירת ההסכם:') +
        '</h3>' +
      '</div>' +
      (fixable.length
        ? '<p style="color:var(--ink-soft);margin:0 0 10px">ת.ז., עמלה ותקופת בלעדיות נדרשות כדי שההזמנה ' +
          'תהיה הזמנה בכתב כדין. אפשר להשלים אותן כאן - בלי לחזור אחורה באשף.</p>' +
          '<div style="border:1.5px dashed var(--line);border-radius:var(--radius-sm);' +
            'padding:12px;background:#fff">' +
            '<div class="agr-fields">' + fields.map(agrQuickFillField).join('') + '</div>' +
            '<p class="imp-note" style="margin:9px 0 0">מה שתמלאו כאן נשמר גם במקור: ת.ז. של חותם/ת ' +
            'שנבחר/ה מקובץ הלקוחות נכנסת לכרטיס שלו/ה, והת.ז. שלכם נשמרת בפרופיל - כדי שההסכם הבא ' +
            'לא ייעצר כאן שוב.</p>' +
          '</div>'
        : '') +
      (blocking.length
        ? `<p style="margin:${fixable.length ? '14px' : '0'} 0 6px;font-weight:700">` +
            (fixable.length ? 'ואלה דורשים חזרה לשלב פרטי ההסכם:' : '') + '</p>' +
          '<ul style="margin:0;padding-inline-start:20px;color:var(--ink-soft)">' +
            blocking.map(m => `<li style="margin-bottom:5px">${esc(m.text)}</li>`).join('') +
          '</ul>'
        : '');

    agrEl('agrFoot').innerHTML =
      '<button type="button" class="btn btn-ghost" data-agr="back-to-details">חזרה לעריכה</button>' +
      (fixable.length
        ? '<button type="button" class="btn btn-gold" data-agr="quick-fill">שמירה והמשך ←</button>'
        : '');
    return;
  }

  const html = window.AgreementDoc.buildHtml(agrBuildDoc());
  agrWizard.previewHtml = html;

  body.innerHTML =
    '<p class="imp-note" style="margin:0 0 10px">זה בדיוק מה שהלקוח/ה יראה/תראה. אחרי המעבר לשלב החתימה ' +
    'גוף המסמך ננעל לעריכה - לשינוי טקסט חוזרים לשלב הקודם.</p>' +
    '<div class="agr-preview">' + html + '</div>';

  agrEl('agrFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-agr="back-to-details">✏️ עריכה</button>' +
    '<button type="button" class="btn btn-gold" data-agr="to-sign">המשך לחתימה ←</button>';
}

/* ---------- שמירה ---------- */

async function agrSaveAndGoSign(btn){
  const w = agrWizard;
  const tpl = agrTpl(w.kind);
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'שומר…';

  try {
    const doc = agrBuildDoc();
    const propertyLine = w.properties.map(p => p.label).join(' · ');

    const payload = {
      agent_id: currentAgent.id,
      agency_id: currentAgent.agency_id || null,
      kind: w.kind,
      title: tpl.docTitle,
      commission_pct: w.commission.pct === '' ? null : Number(w.commission.pct),
      commission_amount: w.commission.amount === '' ? null : Number(w.commission.amount),
      commission_note: w.commission.basis || null,
      exclusive_from: tpl.exclusive && w.exclusive.from ? w.exclusive.from : null,
      exclusive_until: tpl.exclusive && w.exclusive.until ? w.exclusive.until : null,
      language: w.language,
      notes: w.notes || null,
      /* אימות בקוד דלוק כברירת מחדל בטופסי קונה ושוכר בלבד: שם רשימת
         הנכסים שבמסמך היא עצמה המידע שמוגן, וקישור שהועבר הלאה חושף אותה.
         בטופס של בעל/ת הנכס אין מה להגן עליו — הוא כבר יודע מה יש לו. */
      require_otp: tpl.side === 'client',
      property_ids: w.properties.map(p => p.property_id).filter(Boolean),
      client_ids: w.signers.map(s => s.client_id).filter(Boolean),
      snapshot: {
        property_line: propertyLine,
        properties: w.properties.map(p => ({ property_id:p.property_id, fields:p.fields, notes:p.notes })),
        signers: doc.signers,
        commission: doc.commission,
        exclusive: doc.exclusive,
        questionnaire: w.questionnaire,
        agent: doc.agent,
      },
    };

    let agreementId = w.agreementId;

    if (!agreementId){
      const { data, error } = await sb.from('agreements').insert(payload).select().single();
      if (error) throw error;
      agreementId = data.id;
      // ‏verify_code נוצר במסד, והוא מודפס בתחתית המסמך — ולכן ה-HTML
      // נבנה מחדש אחרי ההוספה ורק אז נשמר
      w.record = data;
    } else {
      const { data, error } = await sb.from('agreements').update(payload).eq('id', agreementId).select().single();
      if (error) throw error;
      w.record = data;
      await sb.from('agreement_signers').delete().eq('agreement_id', agreementId);
    }

    const finalHtml = window.AgreementDoc.buildHtml(
      Object.assign(agrBuildDoc(), { verifyCode: w.record.verify_code, createdAt: w.record.created_at }));

    const { error: htmlErr } = await sb.from('agreements')
      .update({ document_html: finalHtml }).eq('id', agreementId);
    if (htmlErr) throw htmlErr;

    const signerRows = w.signers.map((s, i) => ({
      agreement_id: agreementId, ord: i, party: s.party,
      full_name: s.full_name.trim(), id_number: s.id_number.trim() || null,
      phone: s.phone.trim() || null, email: s.email.trim() || null,
      address: s.address.trim() || null,
    }));
    const { error: signersErr } = await sb.from('agreement_signers').insert(signerRows);
    if (signersErr) throw signersErr;

    w.agreementId = agreementId;
    await loadAgreements();
    await agrRefreshWizardRecord();
    // ההסכם הראשון סוגר צעד במדריך ההתחלה, והטריגר במסד פתח באותו רגע את
    // הדרבון על חנות הלידים
    refreshOnboarding();
    w.step = 4;
    agrRender();
  } catch(err){
    console.error(err);
    showToast('שמירת ההסכם נכשלה: ' + (err.message || 'שגיאה'));
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function agrRefreshWizardRecord(){
  if (!agrWizard || !agrWizard.agreementId) return;
  const { data } = await sb.from('agreements')
    .select('*, signers:agreement_signers(*)').eq('id', agrWizard.agreementId).maybeSingle();
  if (data){
    data.signers = (data.signers || []).slice().sort((a, b) => (a.ord || 0) - (b.ord || 0));
    agrWizard.record = data;
  }
}

/* ---------- שלב 4: חתימה ---------- */

function agrRenderStepSign(){
  const w = agrWizard;
  const rec = w.record;
  if (!rec){
    agrEl('agrBody').innerHTML = '<div class="empty-state">ההסכם לא נטען.</div>';
    agrEl('agrFoot').innerHTML = '<button type="button" class="btn btn-ghost" data-agr="close">סגירה</button>';
    return;
  }

  const prog = agrSignedCount(rec);
  const done = prog.signed === prog.total && prog.total > 0;

  let html = '<p style="margin:0 0 12px;font-weight:600">בחתימתי, אני מאשר בזאת כי קראתי את ההסכם.</p>';

  if (done){
    html = '<div class="agr-warn" style="background:#F4F9F5;border-color:#C9E0D0;color:#2A5B36">' +
      '<b>ההסכם נחתם על ידי כל הצדדים.</b> העותק החתום נשלח במייל לכל מי שיש לו/לה כתובת.</div>' + html;
  }

  html += rec.signers.map(s => {
    if (s.signed_at){
      return `<div class="agr-signer">
        <h5>${esc(s.full_name)}${s.id_number ? ' · ת.ז. ' + esc(s.id_number) : ''}</h5>
        <div class="who">נחתם ב-${esc(hebDateTime(s.signed_at))} · ${
          s.method === 'remote' ? 'חתימה מרחוק' : 'חתימה במעמד הסוכן/ת'}</div>
        <div class="agr-signed">
          <img src="${esc(window.AgreementDoc.safeSignatureSrc(s.signature))}" alt="חתימת ${esc(s.full_name)}">
          <span class="when">✓ נחתם</span>
        </div></div>`;
    }

    const wa = waLink(s.phone);
    return `<div class="agr-signer" data-signer="${esc(s.id)}">
      <h5>${esc(s.full_name)}${s.id_number ? ' · ת.ז. ' + esc(s.id_number) : ''}, חתום כאן:</h5>
      <div class="who">${s.email ? esc(s.email) : 'ללא כתובת מייל - חתימה מרחוק אינה אפשרית'}${
        s.mail_sent_at ? ' · קישור נשלח ב-' + esc(hebDateTime(s.mail_sent_at)) : ''}${
        s.mail_error ? ' · שליחה נכשלה' : ''}</div>
      <div class="agr-pad">
        <canvas data-agr-canvas="${esc(s.id)}"></canvas>
        <div class="agr-pad-hint" data-agr-hint="${esc(s.id)}">חתימה כאן על המסך</div>
      </div>
      <div class="agr-signer-acts">
        <button type="button" class="btn btn-gold" data-agr="save-sign" data-signer="${esc(s.id)}" disabled>שמירת החתימה</button>
        <button type="button" class="btn btn-ghost" data-agr="clear-sign" data-signer="${esc(s.id)}">ניקוי</button>
        ${s.email ? `<button type="button" class="btn btn-ghost" data-agr="mail-sign" data-signer="${esc(s.id)}">✉️ שליחה במייל</button>` : ''}
        ${wa ? `<button type="button" class="btn btn-share" data-agr="wa-sign" data-signer="${esc(s.id)}">💬 וואטסאפ</button>` : ''}
        <button type="button" class="btn btn-ghost" data-agr="copy-sign" data-signer="${esc(s.id)}">🔗 העתקת קישור</button>
      </div>
    </div>`;
  }).join('');

  /* ---- חתימה מרחוק ----
     שתי ההגדרות יושבות כאן ולא בשלב הפרטים בכוונה: הן אינן חלק מהנוסח
     שנחתם אלא מהאופן שבו הוא נמסר, ולכן הן ניתנות לשינוי גם אחרי שגוף
     המסמך כבר ננעל. */
  if (!done){
    const anyEmail = rec.signers.some(s => !s.signed_at && s.email);
    html += '<div class="agr-sec" style="margin-top:18px">' +
      '<h4>חתימה מרחוק</h4>' +
      '<label class="checkbox-item" style="align-items:flex-start;margin-bottom:10px">' +
        `<input type="checkbox" data-agr-flag="allow_passport"${rec.allow_passport ? ' checked' : ''}>` +
        '<span>אפשר זיהוי באמצעות מס׳ דרכון</span></label>' +
      '<label class="checkbox-item" style="align-items:flex-start;margin-bottom:12px">' +
        `<input type="checkbox" data-agr-flag="require_otp"${rec.require_otp ? ' checked' : ''}>` +
        '<span><b>דרוש אימות בקוד לפני הצגת פרטי ההסכם המלאים.</b> ' +
        'הלקוח/ה יידרש/תידרש לאמת את זהותו/ה בקוד חד-פעמי שיישלח לכתובת המייל שלו/ה. ' +
        'חשוב במיוחד בטופס קונים/שוכרים, כי האימות מתבצע לפני שאפשר לצפות בפרטי הנכס - ' +
        'וקישור שהועבר הלאה בוואטסאפ לא יחשוף אותם.</span></label>' +
      (anyEmail
        ? '<button type="button" class="btn btn-gold btn-block" data-agr="send-all">✈ שלח לחתימה מרחוק</button>'
        : '<p class="agr-missing" style="margin:0">אין כתובת מייל לאף חותם/ת שטרם חתם/ה - ' +
          'הוסיפו כתובת, או השתמשו בכפתור וואטסאפ/העתקת קישור שליד כל חותם/ת.</p>') +
    '</div>';
  }

  html += '<div class="form-subheading" style="margin-top:18px">המסמך</div>' +
    '<div class="agr-preview">' + (rec.document_html || '') + '</div>';

  agrEl('agrBody').innerHTML = html;

  agrEl('agrFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-agr="close">סגירה</button>' +
    '<button type="button" class="btn btn-ghost" data-agr="pdf">⬇ הורדה כ-PDF</button>';

  // לוחות החתימה נבנים אחרי שה-DOM קיים, אחרת ה-canvas עדיין חסר גודל
  w.pads = {};
  rec.signers.filter(s => !s.signed_at).forEach(s => {
    const canvas = agrEl('agrBody').querySelector(`[data-agr-canvas="${s.id}"]`);
    if (!canvas) return;
    w.pads[s.id] = window.AgreementDoc.signaturePad(canvas, {
      onChange: drawn => {
        const hint = agrEl('agrBody').querySelector(`[data-agr-hint="${s.id}"]`);
        if (hint) hint.classList.toggle('is-off', drawn);
        const saveBtn = agrEl('agrBody').querySelector(`[data-agr="save-sign"][data-signer="${s.id}"]`);
        if (saveBtn) saveBtn.disabled = !drawn;
      },
    });
  });
}

async function agrSaveManualSignature(signerId, btn){
  const w = agrWizard;
  const pad = w.pads[signerId];
  if (!pad || pad.isEmpty()) return;

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'שומר…';

  const { error } = await sb.from('agreement_signers').update({
    signature: pad.toDataURL(),
    signed_at: new Date().toISOString(),
    method: 'manual',
    signed_ua: navigator.userAgent.slice(0, 400),
  }).eq('id', signerId).is('signed_at', null);

  if (error){
    showToast('שמירת החתימה נכשלה: ' + error.message);
    btn.disabled = false;
    btn.textContent = original;
    return;
  }

  await agrRefreshWizardRecord();
  await loadAgreements();

  // כשהחתימה האחרונה נכנסה, הטריגר סימן את ההסכם כחתום — וזה הרגע לשלוח
  // את העותק לכל הצדדים. ‏שליחה שנכשלת אינה מבטלת את החתימה.
  if (agrWizard.record && agrWizard.record.status === 'signed'){
    const { ok, data } = await agrCallFn({ action:'finalize', agreement_id:agrWizard.agreementId });
    showToast(ok && data.copies_sent
      ? `ההסכם נחתם · העותק החתום נשלח ל-${data.copies_sent} נמענים`
      : 'ההסכם נחתם. שליחת העותק במייל לא הצליחה - אפשר לנסות שוב מכרטיס ההסכם.');
    await loadAgreements();
  } else {
    showToast('החתימה נשמרה');
  }

  agrRender();
}

function agrSignUrl(signer){
  return location.origin + '/sign.html?t=' + encodeURIComponent(signer.sign_token);
}

function agrSignerById(id){
  return (agrWizard.record.signers || []).find(s => s.id === id);
}

async function agrCopySignLink(signerId){
  const s = agrSignerById(signerId);
  if (!s) return;
  const url = agrSignUrl(s);
  try {
    await navigator.clipboard.writeText(url);
    showToast('הקישור האישי הועתק - אפשר להדביק אותו בכל מקום');
  } catch(err){
    console.error(err);
    prompt('העתיקו את הקישור:', url);
  }
}

function agrWhatsappSign(signerId){
  const s = agrSignerById(signerId);
  if (!s) return;
  const wa = waLink(s.phone);
  if (!wa) return showToast('אין מספר טלפון תקין לחותם/ת');
  const text = `שלום ${s.full_name}, מצורף קישור אישי לקריאה ולחתימה על ` +
    `${agrWizard.record.title}:\n${agrSignUrl(s)}\n\nהקישור אישי - אין להעביר אותו הלאה.`;
  window.open(wa + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

async function agrDownloadPdf(btn){
  const rec = agrWizard.record;
  const host = document.createElement('div');
  // ‏left ולא inset-inline-start: בדף RTL הלוגי מתמפה ל-right, וההסתרה
  // הייתה גוררת את הגוף ימינה ומרחיבה את הגלילה האופקית של הדשבורד
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;background:#fff';
  host.innerHTML = (rec.document_html || '') +
    window.AgreementDoc.signatureBlockHtml(rec.signers || []);
  document.body.appendChild(host);

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'מכין את הקובץ…';
  try {
    await window.AgreementDoc.downloadPdf(host, rec.title.replace(/[\\/:*?"<>|]/g, '-') + '.pdf');
  } catch(err){
    console.error(err);
    showToast('לא הצלחנו להפיק PDF - נסו שוב');
  } finally {
    host.remove();
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ---------- חיווט האשף ---------- */

agrEl('agrModal').addEventListener('click', async (e)=>{
  if (e.target.id === 'agrModal') return;   // הרקע אינו סוגר: אשף חתימה שנסגר בטעות הוא עבודה שאבדה

  const kindBtn = e.target.closest('[data-agr-kind]');
  if (kindBtn) return agrSetKind(kindBtn.dataset.agrKind);

  const btn = e.target.closest('[data-agr]');
  if (!btn) return;
  const act = btn.dataset.agr;

  if (act === 'close') return agrCloseWizard();
  if (act === 'back-to-kind'){ agrCollectDetails(); agrWizard.step = 1; return agrRender(); }
  if (act === 'back-to-details'){ agrWizard.step = 2; return agrRender(); }
  if (act === 'to-preview'){ agrCollectDetails(); agrWizard.step = 3; return agrRender(); }
  if (act === 'ex-months') return agrSetExclusiveMonths(btn.dataset.months);
  if (act === 'quick-fill') return agrQuickFill(btn);
  if (act === 'to-sign') return agrSaveAndGoSign(btn);
  if (act === 'pick-prop') return agrAddProperty(btn.dataset.id);
  if (act === 'toggle-manual-prop'){
    const box = agrEl('agrManualProp');
    box.hidden = !box.hidden;
    if (!box.hidden) agrEl('agrMpType').focus();
    return;
  }
  if (act === 'add-manual-prop') return agrAddManualProperty();
  if (act === 'save-to-property') return agrSaveToProperty(btn.dataset.uid, btn);
  if (act === 'add-to-catalog')   return agrAddPropertyToCatalog(btn.dataset.uid, btn);
  if (act === 'rm-prop'){
    agrWizard.properties = agrWizard.properties.filter(p => p.uid !== btn.dataset.uid);
    agrRenderPropChips();
    agrRenderPropFields();
    return agrRenderPropResults();
  }
  if (act === 'pick-client') return agrAddClientSigner(btn.dataset.id);
  if (act === 'add-blank-signer') return agrAddBlankSigner();
  if (act === 'rm-signer'){
    agrWizard.signers = agrWizard.signers.filter(s => s.uid !== btn.dataset.uid);
    agrWizard.signers.forEach((s, i) => { s.party = i === 0 ? 'client' : 'partner'; });
    agrRenderSignerForms();
    return agrRenderClientResults();
  }
  if (act === 'save-sign') return agrSaveManualSignature(btn.dataset.signer, btn);
  if (act === 'clear-sign'){
    const pad = agrWizard.pads[btn.dataset.signer];
    if (pad) pad.clear();
    return;
  }
  if (act === 'mail-sign'){
    await agrSendLinks(agrWizard.agreementId, [btn.dataset.signer], btn);
    return agrRender();
  }
  if (act === 'wa-sign') return agrWhatsappSign(btn.dataset.signer);
  if (act === 'copy-sign') return agrCopySignLink(btn.dataset.signer);
  if (act === 'send-all'){
    await agrSendLinks(agrWizard.agreementId, null, btn);
    return agrRender();
  }
  if (act === 'pdf') return agrDownloadPdf(btn);
});

/* עריכה בשדות של האשף — האזנה אחת במקום מאות מאזינים */
agrEl('agrBody').addEventListener('input', async (e)=>{
  if (!agrWizard) return;
  const t = e.target;

  /* שני דגלי החתימה מרחוק נשמרים מיד ולא ב"שמירה" נפרדת: הם משנים את
     ההתנהגות של הקישור הבא שנשלח, והמרחק בין הסימון לשליחה הוא לחיצה אחת. */
  if (t.dataset.agrFlag){
    const patch = {};
    patch[t.dataset.agrFlag] = t.checked;
    const { error } = await sb.from('agreements').update(patch).eq('id', agrWizard.agreementId);
    if (error){
      showToast('העדכון נכשל: ' + error.message);
      t.checked = !t.checked;
      return;
    }
    if (agrWizard.record) agrWizard.record[t.dataset.agrFlag] = t.checked;
    showToast(t.checked ? 'ההגדרה הופעלה' : 'ההגדרה כובתה');
    return;
  }

  if (t.dataset.agrPf){
    const entry = agrWizard.properties.find(p => p.uid === t.dataset.agrPf);
    if (entry) entry.fields[t.dataset.key] = t.value;
    return;
  }
  if (t.dataset.agrPnotes){
    const entry = agrWizard.properties.find(p => p.uid === t.dataset.agrPnotes);
    if (entry) entry.notes = t.value;
    return;
  }
  if (t.dataset.agrSf){
    const signer = agrWizard.signers.find(s => s.uid === t.dataset.agrSf);
    if (signer) signer[t.dataset.key] = t.value;
    return;
  }
  /* תאריכי הבלעדיות: במצב "חודשים" תאריך הסיום נגזר מתאריך ההתחלה ומתעדכן
     בכל שינוי שלו. במצב ידני שני השדות פתוחים, והשורה שמתחתם רק מסכמת. */
  if (t.id === 'agrExFrom' || t.id === 'agrExUntil'){
    agrWizard.exclusive[t.id === 'agrExFrom' ? 'from' : 'until'] = t.value;
    if (t.id === 'agrExFrom' && agrWizard.exclusive.months){
      agrWizard.exclusive.until = agrAddMonthsIso(t.value, agrWizard.exclusive.months);
    }
    return agrPaintExclusive();
  }

  if (t.id === 'agrPropSearch') return agrRenderPropResults();
  if (t.id === 'agrClientSearch') agrRenderClientResults();
});

agrEl('agrClose').addEventListener('click', agrCloseWizard);
agrEl('newAgreementBtn').addEventListener('click', ()=> openAgreementWizard());

/* הכפתור הקבוע בדשבורד ("החתם לקוח") יושב היום ברכבת הפעולות המהירות,
   נבנה ב-renderQuickActions ופותח את האשף משם — ולא את קטגוריית ההסכמים:
   הדרך הקצרה ביותר מ"יש לי לקוח/ה מולי" ל"המסמך על המסך" היא בחירת סוג
   ההסכם, ולא רשימה של הסכמים קודמים. ראו QUICK_ACTIONS. */

agrEl('agrSearch').addEventListener('input', renderAgreements);
['agrStatusFilter','agrKindFilter'].forEach(id =>
  agrEl(id).addEventListener('change', renderAgreements));
agrEl('agrClearFilters').addEventListener('click', ()=>{
  ['agrSearch','agrStatusFilter','agrKindFilter'].forEach(id => { agrEl(id).value = ''; });
  renderAgreements();
});

/* ==========================================================================
   שאלה לפני יציאה מה-CRM
   --------------------------------------------------------------------------
   ‏assets/exit-guard.js מחזיק את המנגנון (זקיף בהיסטוריה שתופס את "אחורה"),
   וכאן נקבע מה נחשב יציאה.

   ‏always: ב-CRM כל "אחורה" נעצר, גם כשהיעד הוא דף הבית של האתר. מבחינת מי
   שעובד כאן זו עזיבה של סביבת העבודה ולא ניווט פנימי — הדשבורד, הטפסים
   הפתוחים והסינון שנבחר נמחקים בדיוק כמו ביציאה מהאתר. בדף הבית, לעומת
   זאת, מעבר פנימי הוא באמת מעבר פנימי ואין עליו שאלה.

   ‏unsaved: טופס שהוקלד ולא נשמר. הסיבה הזו קיימת רק כאן ובצדק — טופס הנכס
   הוא מסך וחצי של הקלדה, והוא נמחק בלי שאריות ברגע שהדף עוזב. "אחורה"
   בטלפון נלחץ תוך כדי גלילה.
   ========================================================================== */

/* "נגעו בטופס" נרשם מהאירוע ולא מהשוואה לערכי ברירת המחדל: חצי מהשדות כאן
   מוזנים מהקוד (עיר ברירת מחדל, טופס עריכה שנטען מהשרת), והשוואה לבדה
   הייתה מדווחת גם על טופס שאיש לא נגע בו. ‏isTrusted מפריד בין הקלדה של
   אדם לבין השמה של הקוד. */
['input','change'].forEach(type => document.addEventListener(type, (e)=>{
  if (!e.isTrusted || !e.target.closest) return;
  const form = e.target.closest('#dashboard form');
  if (form) form.dataset.touched = '1';
}, true));

/* ‏submit הוא הבקשה לשמור, וכל הטפסים בדשבורד נשמרים דרכו. אם השמירה תיכשל
   התוכן יישאר על המסך בלי הסימון — מחיר מודע: אזהרת שווא על טופס שכבר נשמר
   מטרידה יותר מהחמצה של מקרה הכישלון. */
document.addEventListener('submit', (e)=>{
  if (e.target && e.target.dataset) delete e.target.dataset.touched;
}, true);

/* התוכן עצמו ולא רק הנגיעה: "ביטול" בטופס פנימי מריץ reset() ומחזיר את כל
   השדות לברירת המחדל, ולכן טופס ריק אינו טופס שממתין לשמירה — גם אם הוקלד
   בו משהו קודם לכן. ההשוואה היא מול defaultValue ולא מול מחרוזת ריקה, כי
   "עפולה" בשדה העיר כתוב ב-HTML. רשימות נפתחות נבנות בקוד ואין להן ברירת
   מחדל אמינה, ולכן הן נספרות דרך הנגיעה בלבד. */
function crmFormHasContent(form){
  return Array.from(form.elements).some(el=>{
    if (el.disabled) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return false;
    return typeof el.value === 'string' && el.value !== el.defaultValue;
  });
}

function crmUnsavedInput(){
  return Array.from(document.querySelectorAll('#dashboard form'))
    .some(form => form.dataset.touched === '1' && crmFormHasContent(form));
}

// אחרי cleanAuthParamsFromUrl: היא כותבת מחדש את הרשומה הנוכחית בהיסטוריה,
// ורשומה שנכתבת אחרי שהזקיף נדחף היא כבר הזקיף עצמו
if (window.ExitGuard){
  ExitGuard.mount({
    always: true,
    // "לצאת מהמערכת?" כשחוזרים לדף הבית, "לצאת מהאתר?" כשבאמת עוזבים —
    // שאלה שאומרת לאן באמת הולכים ולא נוסח אחד שנכון בחצי מהמקרים
    stayMessage: 'לצאת מהמערכת?',
    unsaved: ()=> crmUnsavedInput() ? 'יש פרטים שהוקלדו ולא נשמרו. לצאת בלי לשמור?' : null,
  });
}

(async function boot(){
  // ‏INITIAL_SESSION אמור לכסות את המקרה הזה, אבל אם הוא לא הגיע (גרסת
  // supabase-js ישנה יותר, או כשל באתחול) חשוב לא להשאיר את המסך על ההמתנה.
  let session = null;
  // ה-try עוטף רק את בדיקת ה-session, לא את הניתוב שאחריה: כשל בבדיקה באמת
  // אומר "לא ידוע אם יש חיבור" ומצדיק מסך כניסה, אבל כשל בטעינת הדשבורד הוא
  // סיפור אחר לגמרי — routeAfterAuth() כבר מטפל בו ומציג את מסך השגיאה.
  try{
    ({ data: { session } } = await sb.auth.getSession());
  } catch(err){
    console.error(err);
    showLoginCard('לא הצלחנו לבדוק את מצב ההתחברות. נסו לרענן את הדף.');
    return;
  }
  if (session) await routeAfterAuth(session);
  else showLoginCard();
})();

/* ============================================================================
   ייבוא עסקאות רשמיות מ-GovMap

   מאגר העסקאות הרשמי (market_deals_official) היה ריק לגמרי, כלומר דוח
   ה-CMA - יכולת שנמכרת ב-Mid/Premium - רץ בלי נתונים בשום עיר. GovMap
   מגיש את מאגר רשות המיסים, ו-1,500 עסקאות בעפולה לבדה: הקלדה אינה
   ריאלית, אבל הטבלה נדבקת מהדפדפן כטקסט מופרד בטאבים.

   הפרסור כאן ולא בשרת, כי התצוגה המקדימה חייבת להיות מיידית לכל שורה.
   לשרת נשלחות שורות **מפורסרות**, והוא מאמת ערכים ולא מפרסר מחדש -
   אימות אינו פרסור, ולכן אלה שתי שכבות ולא שני עותקים.
   ============================================================================ */

/* הדקדוק, כפי שנבדק מול הדבקה אמיתית:

     [כתובת]                 <- שורה משלה
     [שכונה]                 <- אופציונלי
     DD.MM.YYYY \t גוש-חלקה-תת \t סוג \t חדרים \t קומה \t מ"ר \t מחיר ₪

   **שבעה שדות בשורת הנתונים ולא שמונה.** הכותרת מונה שמונה עמודות, אבל
   הכתובת יושבת בשורה נפרדת ואינה בתוכה. */
const DEALS_DATE_ROW = /^(\d{2})\.(\d{2})\.(\d{4})\t/;
const DEALS_GUSH     = /^(\d+)-(\d+)-(\d+)$/;
const DEALS_HEADER   = /^כתובת\t/;
const DEALS_FOOTER   = /^\d+[–-]\d+ of \d+$/;
const DEALS_TABLABEL = /^עסקאות ב.*\(\d+\)$/;
const DEALS_NO_INFO  = 'אין מידע';

/* תווי כיווניות (LRM/RLM ודומיהם) מגיעים בתוך ערכים כמו "קומה ‎4‏" ושוברים
   כל השוואה בלי שרואים למה - הערך נראה זהה על המסך ואינו זהה. */
function dealsClean(s){
  return String(s == null ? '' : s).replace(/[‎‏‪-‮⁦-⁩]/g, '').trim();
}
function dealsNum(s){
  const v = dealsClean(s).replace(/,/g, '').replace(/₪/g, '').trim();
  return (v === '' || v === '-') ? null : v;
}
function dealsSplitAddress(a){
  const v = dealsClean(a);
  if (!v || v === DEALS_NO_INFO) return { street: null, house: null };
  const m = v.match(/^(.*?)\s+(\d+[א-ת]?)$/);
  return m ? { street: m[1], house: m[2] } : { street: v, house: null };
}

/* external_key כולל מחיר ומ"ר, וזה לא עודף: בנתונים אמיתיים נמצאו שתי
   שורות עם אותה תת-חלקה ואותו תאריך בדיוק (17014-6-52, 29.07.2026)
   ששונות רק במ"ר ובמחיר. מפתח על גוש-חלקה+תאריך בלבד היה מוחק אחת מהן.

   ומנגד, דירות זהות בפרויקט חדש נמכרות באותו מחיר ובאותו שטח יום זה מזה
   (17014-6-51 מול 17014-6-48) - ואלה **אינן** כפילות. תת-החלקה מבדילה. */
function dealsExternalKey(r){
  return `govmap:${r.gush}-${r.helka}-${r.tat_helka}:${r.sold_at}:${r.sale_price}:${r.size_sqm || ''}`;
}

function parseGovmapDeals(text, city){
  const rows = [], errors = [];
  let buf = [];
  for (const raw of String(text || '').split(/\r?\n/)){
    const c = dealsClean(raw);
    if (!c) continue;
    /* שורת הכותרת מאפסת את החוצץ. בלי זה תוויות הסינון שמעליה ("סוג נכס",
       "מספר חדרים") נבלעות ככתובת של העסקה הראשונה, ומתקבל נכס ברחוב
       "סוג נכס". זה נתפס בהרצה על נתונים אמיתיים. */
    if (DEALS_HEADER.test(c)){ buf = []; continue; }
    if (DEALS_FOOTER.test(c) || DEALS_TABLABEL.test(c)) continue;

    const m = c.match(DEALS_DATE_ROW);
    if (!m){ buf.push(c); buf = buf.slice(-2); continue; }

    const parts = c.split('\t').map(dealsClean);
    if (parts.length < 7){ errors.push({ line: c, reason: 'שדות חסרים בשורה' }); buf = []; continue; }

    const addrLine = buf.length > 1 ? buf[buf.length - 2] : (buf.length ? buf[buf.length - 1] : '');
    const hoodLine = buf.length > 1 ? buf[buf.length - 1] : '';
    buf = [];

    const g = parts[1].match(DEALS_GUSH);
    if (!g){ errors.push({ line: c, reason: 'גוש חלקה לא תקין: ' + parts[1] }); continue; }

    const addr = dealsSplitAddress(addrLine);
    const row = {
      city: dealsClean(city),
      street: addr.street, house_number: addr.house,
      neighborhood: dealsClean(hoodLine) || null,
      sold_at: `${m[3]}-${m[2]}-${m[1]}`,
      gush: g[1], helka: g[2], tat_helka: g[3],
      property_type: parts[2] === '-' ? null : parts[2],
      rooms: dealsNum(parts[3]),
      floor: parts[4] === '-' ? null : parts[4],
      size_sqm: dealsNum(parts[5]),
      sale_price: dealsNum(parts[6]),
    };
    if (!row.sale_price){ errors.push({ line: c, reason: 'מחיר חסר' }); continue; }
    row.external_key = dealsExternalKey(row);
    rows.push(row);
  }
  return { rows, errors };
}

let dealsImportParsed = [];

function renderDealsImportPreview(rows, errors){
  const box = document.getElementById('dealsImportPreview');
  if (!box) return;
  const saveBtn = document.getElementById('dealsImportSaveBtn');
  if (!rows.length && !errors.length){
    box.innerHTML = '<div class="empty-state">לא זוהתה אף שורה. ודאו שהעתקתם את שורות הטבלה עצמן.</div>';
    if (saveBtn) saveBtn.disabled = true;
    return;
  }
  const head = `<p class="acc-sub"><strong>${rows.length}</strong> עסקאות זוהו`
    + (errors.length ? ` · <strong>${errors.length}</strong> שורות לא זוהו` : '')
    + `. בדקו את הדוגמה ואז ייבאו.</p>`;
  const sample = rows.slice(0, 8).map(r => `<tr>
      <td>${escapeHtml(r.street || '(אין כתובת)')} ${escapeHtml(r.house_number || '')}</td>
      <td>${escapeHtml(r.sold_at)}</td>
      <td>${escapeHtml(r.gush)}-${escapeHtml(r.helka)}-${escapeHtml(r.tat_helka)}</td>
      <td>${escapeHtml(r.property_type || '-')}</td>
      <td>${escapeHtml(r.rooms || '-')}</td>
      <td>${escapeHtml(r.size_sqm || '-')}</td>
      <td>${Number(r.sale_price).toLocaleString('he-IL')} ₪</td>
      <td>${escapeHtml(r.neighborhood || '')}</td>
    </tr>`).join('');
  /* שורה שלא זוהתה **נספרת ומוצגת ואינה מנוחשת** - אותו כלל של
     deals_engine, והוא חל גם על הזנה ידנית. */
  const bad = errors.length
    ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">שורות שלא זוהו (${errors.length})</summary>`
      + errors.slice(0, 20).map(e => `<div style="font-size:13px;color:var(--muted);margin:6px 0">${escapeHtml(e.reason)}: <code>${escapeHtml(e.line.slice(0, 120))}</code></div>`).join('')
      + '</details>'
    : '';
  box.innerHTML = head
    + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
    + '<thead><tr><th>כתובת</th><th>תאריך</th><th>גוש חלקה</th><th>סוג</th><th>חדרים</th><th>מ״ר</th><th>מחיר</th><th>שכונה</th></tr></thead>'
    + `<tbody>${sample}</tbody></table></div>`
    + (rows.length > 8 ? `<p class="acc-sub">מוצגות 8 מתוך ${rows.length}.</p>` : '')
    + bad;
  if (saveBtn) saveBtn.disabled = !rows.length;
}

async function loadDealsCoverage(){
  const box = document.getElementById('dealsImportCoverage');
  if (!box || !sb) return;
  const { data, error } = await sb.rpc('market_deals_coverage');
  if (error || !data || !data.length){
    box.innerHTML = '<p class="acc-sub">אין עדיין עסקאות במאגר.</p>';
    return;
  }
  /* הטריות היא מה שהתזכורת הרבעונית נשענת עליו, ולכן היא מוצגת כאן ולא
     רק נספרת: מי שמדביק עיר רואה מיד אילו ערים כבר התיישנו. */
  const now = Date.now();
  box.innerHTML = '<p class="acc-sub"><strong>מה יש במאגר</strong></p>'
    + data.map(r => {
        const months = r.newest ? Math.floor((now - new Date(r.newest).getTime()) / 2592000000) : null;
        const stale = months == null || months >= 3;
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
          <span>${escapeHtml(r.city || '')}</span>
          <span style="color:${stale ? 'var(--danger,#c0392b)' : 'var(--muted)'}">
            ${plural(r.deals, 'עסקה אחת', 'עסקאות')} · עדכני ל-${escapeHtml(r.newest || 'לא ידוע')}${stale ? ' · דורש עדכון' : ''}
          </span></div>`;
      }).join('');
}

document.getElementById('dealsImportPreviewBtn')?.addEventListener('click', ()=>{
  const city = document.getElementById('dealsImportCity').value.trim();
  const text = document.getElementById('dealsImportPaste').value;
  if (!city){ alert('צריך לציין לאיזו עיר שייכות העסקאות'); return; }
  const { rows, errors } = parseGovmapDeals(text, city);
  dealsImportParsed = rows;
  renderDealsImportPreview(rows, errors);
});

document.getElementById('dealsImportSaveBtn')?.addEventListener('click', async (e)=>{
  if (!dealsImportParsed.length) return;
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'מייבא…';
  try{
    const { data, error } = await sb.rpc('market_deals_import', { p_rows: dealsImportParsed });
    if (error) throw error;
    if (data && data.error){ alert('הייבוא נדחה: ' + data.error); return; }
    const parts = [plural(data.inserted, 'נוספה עסקה אחת', 'עסקאות', 'נוספו ' + data.inserted)];
    if (data.skipped) parts.push(`${data.skipped} כבר היו במאגר`);
    if (data.rejected_count) parts.push(plural(data.rejected_count, 'עסקה אחת נדחתה', 'נדחו'));
    alert(parts.join(' · '));
    document.getElementById('dealsImportPaste').value = '';
    document.getElementById('dealsImportPreview').innerHTML = '';
    dealsImportParsed = [];
    await loadDealsCoverage();
  } catch(err){
    alert('הייבוא נכשל: ' + (err.message || err));
  } finally {
    btn.disabled = false; btn.textContent = 'ייבוא';
  }
});

document.getElementById('accDealsImport')?.addEventListener('toggle', function(){
  if (this.open) loadDealsCoverage();
});

/* ==========================================================================
   עסקאות שנסגרו באזור
   --------------------------------------------------------------------------
   ההבדל מדוח ה-CMA הוא מה שנכנס: הדוח מקבל **מזהה נכס** ועונה "כמה שווה
   הנכס הזה", והכלי הזה מקבל **כתובת** - ולכן הוא עונה גם לפני שהנכס
   במערכת, בדיוק ברגע שבו מחליטים אם לקחת אותו.

   ‏`market_deals_lookup` היא העטיפה שגוזרת את מזהה הסוכן/ת מה-JWT.
   **הגייט אינו כאן.** ‏`agent_market_deals_lookup` במסד בודקת `premium`,
   ומי שיקרא ל-RPC ישירות ייחסם באותה מידה; ההודעה למטה היא תצוגה.
   ========================================================================== */

/* הגאוקוד הוא **עפולה בלבד** כרגע, ובמכוון: `geocode-address` אינה מקבלת
   עיר, והשכבה שמאחוריה היא של עיריית עפולה. עיר אחרת נופלת לחיפוש לפי שם
   רחוב - נחות, ומסומן ככזה בתשובה. זה גם התנאי הקשיח היחיד שנשאר כאן,
   והוא יורד ברגע ש-geocode-address תקבל city. */
const DEALS_GEOCODE_CITY = 'עפולה';

async function dealsLookupCoords(city, street, houseNumber){
  if (city !== DEALS_GEOCODE_CITY || !street || !houseNumber) return null;
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(GEOCODE_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY,
                'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify({ street, house_number: houseNumber }),
    });
    const data = await res.json();
    return (res.ok && data.success) ? { lat: data.lat, lng: data.lng } : null;
  } catch(err){
    // כתובת שלא נמצאה ורשת שנפלה מובילות שתיהן לאותה נפילה לאחור, ולכן
    // אין כאן צורך בהבחנה. במסלול שמזין את geocode_attempts ההבחנה קדושה.
    console.warn('deals lookup geocode failed', err);
    return null;
  }
}

function renderDealsLookup(res){
  const box = document.getElementById('mdResults');
  if (!box) return;
  const deals = res.deals || [];
  if (!deals.length){
    box.innerHTML = '<div class="empty-state">לא נמצאה אף עסקה בטווח ובחלון הזמן. נסו רדיוס גדול יותר או יותר חודשים.</div>';
    return;
  }
  /* שורת ההקשר אינה קישוט: אותה רשימה בדיוק נראית אחרת לגמרי אם היא 300
     מטר או קילומטר, ומי שלא יראה את זה ישווה בין שתי הרצות שונות. */
  const head = res.mode === 'street'
    ? `<p class="acc-sub">לא הצלחנו למקם את הכתובת, ולכן החיפוש נעשה <strong>לפי שם הרחוב</strong> ולא לפי מרחק. ${plural(res.total_found, 'עסקה אחת נמצאה', 'עסקאות נמצאו', esc(String(res.total_found)))}.</p>`
    : `<p class="acc-sub"><strong>${esc(String(res.total_found))}</strong> עסקאות ברדיוס ${esc(String(res.radius_meters))} מ' ב-${esc(String(res.months))} החודשים האחרונים. מוצגות ${esc(String(res.returned))}.</p>`;

  const rows = deals.map(d => {
    const addr = d.street ? `${esc(d.street)} ${esc(d.house_number || '')}` : '<span style="color:var(--ink-soft)">ללא כתובת</span>';
    const ppsqm = d.price_per_sqm ? Number(d.price_per_sqm).toLocaleString('he-IL') + ' ₪' : '-';
    const dist = d.distance_meters == null ? '-' : esc(String(d.distance_meters)) + ' מ\'';
    return `<tr>
      <td>${addr}${d.neighborhood ? `<div style="font-size:.72rem;color:var(--ink-soft)">${esc(d.neighborhood)}</div>` : ''}</td>
      <td>${esc(d.sold_at || '')}</td>
      <td>${esc(d.property_type || '-')}</td>
      <td>${esc(String(d.rooms ?? '-'))}</td>
      <td>${esc(String(d.size_sqm ?? '-'))}</td>
      <td><strong>${Number(d.sale_price).toLocaleString('he-IL')} ₪</strong></td>
      <td>${ppsqm}</td>
      <td>${dist}</td>
      <td style="font-size:.72rem;color:var(--ink-soft)">${esc(d.gush || '')}-${esc(d.helka || '')}</td>
    </tr>`;
  }).join('');

  box.innerHTML = head
    + '<div style="overflow-x:auto"><table class="cma-table">'
    + '<thead><tr><th>כתובת</th><th>תאריך</th><th>סוג</th><th>חדרים</th><th>מ״ר</th><th>מחיר</th><th>למ״ר</th><th>מרחק</th><th>גוש חלקה</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`
    + `<p class="acc-sub" style="margin-top:10px">מקור: ${esc(res.source || '')}</p>`;
}

document.getElementById('mdLookupBtn')?.addEventListener('click', async ()=>{
  const city = document.getElementById('mdCity').value.trim();
  /* אותו תיקון כתיב כמו במידע התכנוני, ובלי חסימה: זו בדיקה ולא שמירה. */
  const street = canonicalStreet(document.getElementById('mdStreet').value, city).name;
  document.getElementById('mdStreet').value = street;
  const houseNum = document.getElementById('mdHouseNum').value.trim();
  const feedback = document.getElementById('mdFeedback');
  const btn = document.getElementById('mdLookupBtn');
  const upgrade = document.getElementById('mdUpgradeNotice');
  const box = document.getElementById('mdResults');

  upgrade.style.display = 'none';
  box.innerHTML = '';
  feedback.textContent = '';

  if (!city || !street){
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'נא למלא עיר ורחוב';
    return;
  }

  btn.disabled = true; btn.textContent = 'מחפש…';
  try{
    const coords = await dealsLookupCoords(city, street, houseNum);
    const { data, error } = await sb.rpc('market_deals_lookup', {
      p_city:          city,
      p_lat:           coords?.lat ?? null,
      p_lng:           coords?.lng ?? null,
      p_street:        street,
      p_house_number:  houseNum || null,
      p_radius_m:      Number(document.getElementById('mdRadius').value) || 300,
      p_months:        Number(document.getElementById('mdMonths').value) || 24,
      p_limit:         Number(document.getElementById('mdLimit').value) || 5,
      p_property_type: document.getElementById('mdType').value || null,
    });
    if (error) throw error;

    if (data && data.error === 'tier_required'){ upgrade.style.display = 'block'; return; }
    if (data && data.error){
      feedback.style.color = 'var(--red)';
      feedback.textContent = data.detail || data.error;
      return;
    }
    renderDealsLookup(data || {});
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--red)';
    feedback.textContent = 'שגיאת רשת - נסו שוב';
  } finally {
    btn.disabled = false; btn.textContent = 'חיפוש עסקאות';
  }
});
