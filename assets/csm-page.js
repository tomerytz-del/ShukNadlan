/* ===========================================================================
   אזור ההטמעה (csm.html) - כניסה, זיהוי, והגלובלים של assets/crm-csm.js
   ---------------------------------------------------------------------------
   תפקיד נפרד (docs/csm-adoption.md): אשת צוות ההטמעה אינה סוכנת ואינה מנהלת
   פלטפורמה. היא נכנסת עם Google, ו-csm_claim() מחברת את החשבון להזמנה לפי
   המייל המאומת. מי שלא הוזמן/ה - מסך "אין גישה", בלי לחשוף דבר.

   הזרימה כמו בכניסה ל-CRM (docs/google-login.md): מסך המתנה קודם, ניקוי
   תשובת OAuth מהכתובת, ניתוב אחד גם כש-SIGNED_IN חוזר.

   נטען לפני crm-csm.js, ומגדיר את מה שהוא מצפה לו מהדף: sb, showToast, heErr,
   SUPABASE_URL, SUPABASE_ANON_KEY, ASSISTANT_WA_NUMBER ו-window.CSM_CTX.
   =========================================================================== */
const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
// המספר של גבריאלה - אותו מספר כמו ב-crm.js ו-bot-link.js
const ASSISTANT_WA_NUMBER = '972532494740';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.CSM_CTX = { isStaff:false, isAdmin:false };

const $ = id => document.getElementById(id);

function heErr(e){
  return window.FriendlyError ? FriendlyError.text(e) : 'משהו השתבש. כדאי לנסות שוב.';
}

function showToast(msg, ms = 3600){
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, /נכשל|לא נשמר|לא הצלחנו|השתבש/.test(msg) ? Math.max(ms, 7000) : ms);
}

function show(screen){
  ['csmBoot', 'csmLogin', 'csmNoAccess', 'csmApp'].forEach(id => { $(id).hidden = id !== screen; });
  $('csmLogout').hidden = screen !== 'csmApp' && screen !== 'csmNoAccess';
  $('csmBell').hidden = $('csmSettings').hidden = screen !== 'csmApp';
}

/* ---------- תשובת OAuth בכתובת ---------- */
const oauthError = (() => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const pick = k => h.get(k) || q.get(k) || '';
  const code = pick('error') || pick('error_code');
  const desc = pick('error_description');
  if (!code && !desc) return '';
  return /access_denied|cancel/i.test(code) ? 'ההתחברות עם Google בוטלה. אפשר לנסות שוב.'
    : 'ההתחברות עם Google נכשלה: ' + (desc || code);
})();

function cleanAuthParamsFromUrl(){
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const dropHash = ['access_token', 'refresh_token', 'expires_in', 'token_type', 'type'].some(k => h.has(k));
  let dropped = false;
  ['code', 'error', 'error_code', 'error_description', 'state'].forEach(k => { if (q.has(k)){ q.delete(k); dropped = true; } });
  if (!dropHash && !dropped) return;
  const search = q.toString();
  history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + (dropHash ? '' : location.hash));
}

/* ---------- הניתוב: מי מחובר/ת, והאם בצוות ---------- */
let routed = null;     // ה-user.id שכבר נותב, כדי ש-SIGNED_IN חוזר לא יטען מחדש
async function route(session){
  if (!session || !session.user){ routed = null; show('csmLogin'); if (oauthError) $('csmLoginMsg').textContent = oauthError; return; }
  if (routed === session.user.id) return;
  routed = session.user.id;
  cleanAuthParamsFromUrl();
  const { data, error } = await sb.rpc('csm_claim');
  if (error){
    routed = null;
    show('csmLogin');
    $('csmLoginMsg').textContent = 'לא הצלחנו לבדוק את החשבון: ' + heErr(error);
    return;
  }
  $('csmWho').textContent = (data && data.display_name) || session.user.email || '';
  if (!data || data.inactive){
    $('csmNoAccessText').textContent = data && data.inactive
      ? 'הגישה שלך לאזור ההטמעה הושבתה. לפרטים - לפנות לתומר.'
      : 'החשבון ' + (session.user.email || '') + ' לא הוזמן לצוות ההטמעה. אם הוזמנת, כדאי לבדוק שנכנסת עם אותו מייל שאליו נשלחה ההזמנה.';
    show('csmNoAccess');
    return;
  }
  window.CSM_CTX = { isStaff:true, isAdmin:false, staffId:data.id };
  // ‏crm-csm.js נטען אחרי הקובץ הזה, ותשובה מהירה של supabase עלולה להקדים אותו
  if (typeof loadCsm !== 'function') await new Promise(r => window.addEventListener('DOMContentLoaded', r, { once:true }));
  show('csmApp');
  // ‏?tab=notifications - הכפתור בהתראה בוואטסאפ (csm-notify.ts)
  const qs = new URLSearchParams(location.search);
  if (qs.get('tab')) csmSetTab(qs.get('tab'));
  // החזרה מ-Google אחרי "חיבור ליומן" (google-calendar-callback)
  if (qs.get('gcal')){
    csmGcalReturn(qs.get('gcal'));
    qs.delete('gcal');
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : ''));
  }
  loadCsm();
}

// הפעמון וההגדרות בכותרת - קיצור ללשוניות שלהן
function openCsmTab(tab){
  csmSetTab(tab);
  csmRender();
  $('accCsm').scrollIntoView({ block:'start' });
}
$('csmBell').addEventListener('click', () => openCsmTab('notifications'));
$('csmSettings').addEventListener('click', () => openCsmTab('settings'));

$('csmGoogle').addEventListener('click', async () => {
  const btn = $('csmGoogle');
  $('csmLoginMsg').textContent = '';
  btn.disabled = true;
  btn.querySelector('.gl-label').textContent = 'מעבירים ל-Google…';
  // ‏origin + pathname בלי query: חייב להיות ברשימת ה-Redirect URLs של Supabase
  if (window.AuthReturn) AuthReturn.remember();
  const { error } = await sb.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: location.origin + location.pathname, queryParams:{ prompt:'select_account' } } });
  if (error){
    btn.disabled = false;
    btn.querySelector('.gl-label').textContent = 'התחברות עם Google';
    $('csmLoginMsg').textContent = 'לא הצלחנו לפתוח את החיבור ל-Google: ' + heErr(error);
  }
});

async function signOut(){
  await sb.auth.signOut();
  routed = null;
  window.CSM_CTX = { isStaff:false, isAdmin:false };
  show('csmLogin');
}
$('csmLogout').addEventListener('click', signOut);
$('csmSwitch').addEventListener('click', signOut);

// ‏setTimeout: עבודה מול supabase בתוך ה-callback עלולה לתקוע את הלקוח
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT'){ routed = null; show('csmLogin'); return; }
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(() => route(session), 0);
});

setTimeout(() => { if (!$('csmBoot').hidden) show('csmLogin'); }, 15000);
