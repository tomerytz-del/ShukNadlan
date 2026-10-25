/* ===========================================================================
   סביבת ההטמעה (CSM) - "הטמעת סוכנים" בניהול מערכת (docs/csm-adoption.md)
   ---------------------------------------------------------------------------
   לשוניות בתוך קטגוריה אחת, לצוות ההטמעה (is_csm) ולמנהל/ת הפלטפורמה:
     צנרת      - קנבן בשישה שלבים, ציון בריאות, התרעה על 5+ ימים בלי גבריאלה,
                 ופרטי הקשר והשימוש של כל סוכן/ת
     משרדים    - כתובת, מנהלים וטלפונים, וכמה סוכנים בכל משרד משתמשים
     יומן      - הפגישות שלה (csm_agenda), תזכורת לפני כל אחת, וסנכרון ליומן Google - צוות בלבד
     התראות    - הפעמון שלה (csm_notifications) - צוות בלבד
     המנטור    - מנטור ההטמעה (csm-workspace, ‏_shared/coach/csm.ts) - צוות בלבד
     הקלטות    - הקלטת שיחה → תמלול, סיכום והמלצות (csm_calls) - צוות בלבד
     הגדרות    - שם, נייד, ההתראות, שעות שקט וברירות המחדל של היומן - צוות בלבד
     משוב      - בקשות פיתוח, וכמה סוכנים ביקשו כל אחת (csm_feedback_votes)
     הצלחות    - ציטוט, מדד ולפני/אחרי, עם הסכמה לפרסום
     ספרייה    - שלושת מסלולי ההדרכה וקטלוג הפקודות לגבריאלה
     צוות      - מנהל/ת הפלטפורמה בלבד: הזמנת צוות ההטמעה (csm_staff_*)
   ופגישת "הצלחה ראשונה" (#csmSessionModal): אבחון, צ'ק-ליסט, תסריט ומשוב.

   הנתונים: csm_agents_overview() לאותות מהמציאות, והטבלאות csm_* ישירות
   (RLS - מנהל/ת פלטפורמה). המיגרציה: 20270626090000_csm_adoption.sql.

   שני בתים לאותו קובץ: אזור ההטמעה (csm.html, ‏assets/csm-page.js - אשת הצוות)
   ותצוגת מנהל/ת הפלטפורמה ב-crm.html (פיקוח והזמנת הצוות). מה שמבדיל ביניהם
   הוא window.CSM_CTX ({ isStaff, isAdmin }), שהדף קובע. העיצוב ב-
   assets/csm-workspace.css, שנטען כאן בפתיחה הראשונה (ב-CRM - לא בעלייה).

   נטען לפני crm.js ומגדיר פונקציות בלבד; sb, showToast, heErr,
   escapeHtml ו-ASSISTANT_WA_NUMBER נקראים בזמן ריצה.
   =========================================================================== */

const CSM_STAGES = [
  { key:'registered',     label:'נרשם/ה - לא פעיל/ה' },
  { key:'call_scheduled', label:'נקבעה פגישה' },
  { key:'onboarded',      label:'עבר/ה הדרכה וביצע/ה פעולה ראשונה' },
  { key:'active_pilot',   label:'בפיילוט פעיל (30-60 יום)' },
  { key:'champion',       label:'משתמש/ת עצמאי/ת' },
  { key:'at_risk',        label:'נשירה - דורש/ת חיזוק' },
];
const CSM_STAGE_ORDER = Object.fromEntries(CSM_STAGES.map((s, i) => [s.key, i]));

/* ---------- חלק 1: שאלון האבחון ----------
   המפתחות נשמרים ב-csm_sessions.diagnostic. שאלה חדשה = שורה כאן, בלי מיגרציה. */
const CSM_DIAG = [
  { key:'experience', q:'כמה זמן את/ה פעיל/ה בתחום הנדל"ן?', opts:[
    ['lt1', 'פחות משנה'], ['1to3', '1-3 שנים'], ['gt3', 'מעל 3 שנים'] ] },
  { key:'structure', q:'איך את/ה פועל/ת ביומיום?', opts:[
    ['solo', 'סוכן/ת עצמאי/ת לחלוטין'], ['office', 'חלק ממשרד / צוות'] ],
    extra:{ when:'office', key:'office_name', ph:'שם המשרד / המנהל/ת' } },
  { key:'tools', multi:true, q:'איפה את/ה מנהל/ת היום את הלקוחות והנכסים?', opts:[
    ['paper', 'מחברת / דפים / בראש'], ['whatsapp', 'קבוצות וואטסאפ ופתקים בטלפון'],
    ['excel', 'אקסל / Google Sheets'], ['crm', 'תוכנת CRM ייעודית'] ],
    extra:{ when:'crm', key:'crm_name', ph:'איזו תוכנה?' } },
  { key:'listings', q:'כמה נכסים יש לך כרגע בשיווק פעיל?', opts:[
    ['1to3', '1-3'], ['4to10', '4-10'], ['gt10', 'מעל 10'] ] },
  { key:'pain', q:'מה לוקח ממך הכי הרבה זמן או מרגיש תקוע? (הקריטי ביותר להיום)', opts:[
    ['acquisition', 'גיוס נכסים ופגישות - קשה להשיג בלעדיות / מה להגיד בפגישה'],
    ['marketing', 'שיווק וקופירייטינג - שעות על ניסוח פוסטים'],
    ['matching', 'התאמות - יש קונים ואין זמן לבדוק מה מתאים להם'],
    ['organization', 'סדר ותיעוד - דברים נופלים, שוכח/ת לחזור ללקוחות'] ] },
];

const CSM_TRACKS = {
  new:     { label:'סוכן/ת חדש/ה', focus:'מתודולוגיה וגיוס נכסים, וגבריאלה כמנטורית' },
  veteran: { label:'סוכן/ת ותיק/ה', focus:'חיסכון בזמן ואוטומציה: שיווק, התאמות ותזכורות' },
  office:  { label:'סוכן/ת במשרד', focus:'עבודה מול המשרד: שיתוף נכסים, לידים ומה המנהל/ת רואה/ה' },
};

// הניתוב לפי השאלון: מתחת לשנה - חדש/ה; במשרד - משרד; אחרת - ותיק/ה. ניתן לשינוי בפגישה.
function csmSuggestTrack(d){
  if (d.experience === 'lt1') return 'new';
  if (d.structure === 'office') return 'office';
  return d.experience ? 'veteran' : '';
}

/* ---------- חלק 2 ו-3: הצ'ק-ליסט והפקודות ----------
   `signal` הוא מה שאפשר לראות במסד מהשורה של csm_agents_overview - רמז
   למנהלת ההטמעה ("זוהה במערכת"), לא סימון אוטומטי: מה שנספר הוא מה שבוצע
   בפגישה. ‏`pain` מסמן איזו פעולה מומלצת ראשונה לפי נקודת הכאב. */
const CSM_WIN = [
  { key:'connect', label:'חיבור ראשוני: שמירת המספר של גבריאלה ושליחת הודעת שלום',
    cmd:'שלום גבריאלה', signal: r => !!r.last_gabriela_at },
  { key:'property', label:'העלאת נכס ראשון: פרטי דירה אמיתית (טקסט / תמונות)', pain:'acquisition',
    cmd:'גבריאלה, תרשמי נכס חדש: דירת 4 חדרים ברחוב חטיבה תשע, קומה 2 עם מעלית וחניה, משופצת, מבקשים 1,380,000 ש״ח. בעל הנכס: ישראל 050-1234567.',
    signal: r => r.active_listings > 0 },
  { key:'client', label:'הזנת לקוח/ה: דרישות, תקציב ואזור של לקוח/ה אמיתי/ת',
    cmd:'גבריאלה, תוסיפי לקוחה חדשה: משפחת כהן 052-1234567, מחפשים דירת 4 חדרים בעפולה עד 1.4 מיליון.',
    signal: r => r.clients > 0 },
  { key:'match', label:'יצירת התאמה: איתור קונים לנכס שהועלה', pain:'matching',
    cmd:'גבריאלה, תראי לי איזה קונים במערכת מחפשים עכשיו דירות 4 חדרים עד 1.4 מיליון בעפולה.' },
  { key:'post', label:'תוכן שיווקי: פוסט לפייסבוק / וואטסאפ על אחד הנכסים', pain:'marketing',
    cmd:'גבריאלה, תכיני לי פוסט שיווקי מושך לפייסבוק על הדירה בחטיבה תשע, שמתאים למשפחות צעירות.',
    signal: r => !!r.has_post },
  { key:'mentor', label:'התנסות במנטור (לסוכנים חדשים): שאלת הכנה לפגישת גיוס',
    cmd:'גבריאלה, מחר יש לי פגישה עם בעל דירה כדי לגייס בלעדיות. איך כדאי לי להתכונן ומה להגיד?' },
  { key:'reminder', label:'תזכורת: משימת מעקב מול בעל/ת נכס או קונה למחר', pain:'organization',
    cmd:'גבריאלה, תזכירי לי מחר ב-10:00 לחזור לישראל לגבי הדירה בחטיבה תשע.',
    signal: r => r.open_tasks > 0 },
];

const CSM_GOALS = [
  'להעלות עוד 3 נכסים דרך גבריאלה עד יום חמישי',
  'לייצר 2 פוסטים שיווקיים לנכסים קיימים',
  'לנהל מעקב אחרי 3 פניות של קונים',
];

const CSM_FB_CATEGORY = { pilot_blocker:'חוסם פיילוט', daily_efficiency:'יעילות יומיומית', office_management:'ניהול משרד' };
const CSM_FB_SEVERITY = { blocker:'חוסם', usability:'שימושיות', enhancement:'שיפור' };
const CSM_FB_STATUS   = { open:'פתוח', planned:'בתכנון', in_progress:'בפיתוח', done:'בוצע', declined:'לא ייעשה' };

/* ---------- ספרייה: שלושת המסלולים ---------- */
const CSM_LIBRARY = [
  { track:'new', title:'מסלול סוכן/ת חדש/ה', points:[
    'יסודות: איך נראה יום עבודה, ממה מורכבת עמלה ולמה בלעדיות שווה יותר',
    'גיוס נכסים: הכנה לפגישה עם בעלים, ושאלה למנטור לפני כל פגישה',
    'סינון לקוחות: תקציב, אזור, מימון ולוח זמנים - ולהזין את זה לגבריאלה מיד',
    'גבריאלה כמנטורית: "איך עונים לבעלים שאומר/ת שיש לו/ה כבר מתווך/ת?"' ],
    cmds:['mentor', 'property', 'client'] },
  { track:'veteran', title:'מסלול סוכן/ת ותיק/ה', points:[
    'חיסכון בזמן: נכס מהודעה אחת במקום טופס, ולקוח/ה מסיכום שיחה',
    'שיווק בכמויות: פוסט לכל נכס בעשר שניות, ותיאור שיווקי שמתעדכן לבד',
    'התאמות אוטומטיות: סיכום ההתאמות שלוש פעמים ביום, בלי לחפש ידנית',
    'תזכורות: כל "אחזור אליך" הופך למשימה עם מועד' ],
    cmds:['post', 'match', 'reminder'] },
  { track:'office', title:'מסלול מנהל/ת משרד', points:[
    'מה רואים על הסוכנים: דאשבורד המשרד וזמן התגובה ללידים',
    'נכסים ולקוחות של המשרד: רמות שיתוף (פרטי / משרדי / רשת) ומסירה בהפנייה',
    'הזמנת סוכנים לצוות, ותפקיד מנהל/ת',
    'המנטור של המשרד: סיכום יומי ונושאים לישיבת צוות' ],
    cmds:['match', 'post'] },
];

let csmRows = [];
let csmUserId = null;   // auth.uid() - ל-created_by / updated_by

function csmCtx(){
  if (window.CSM_CTX) return window.CSM_CTX;
  const a = typeof currentAgent !== 'undefined' ? currentAgent : null;
  return { isStaff:false, isAdmin: !!(a && a.is_platform_admin) };
}

function csmEnsureCss(){
  if (document.getElementById('csmWorkspaceCss')) return;
  const l = document.createElement('link');
  l.id = 'csmWorkspaceCss';
  l.rel = 'stylesheet';
  l.href = '/assets/csm-workspace.css';
  document.head.appendChild(l);
}
let csmLoaded = false;
let csmTab = 'pipeline';
let csmFilter = '';
let csmStage = '';      // '' = כל השלבים; אחרת שלב אחד בלבד בצנרת
let csmSession = null;   // { agent, draft }

function csmFmtDate(v){
  return v ? new Date(v).toLocaleDateString('he-IL', { day:'numeric', month:'numeric' }) : '';
}
function csmDaysSince(v){
  return v ? Math.floor((Date.now() - new Date(v).getTime()) / 86400000) : null;
}

/* ---------- ציון הבריאות (0-100) ----------
   גבריאלה היא הליבה, ולכן היא שווה 60: מתי לאחרונה (40) וכמה בשבוע (20).
   שאר ה-40: נכסים פעילים, לקוחות, והדירוג מהפגישה. חישוב בדפדפן ולא במסד,
   כי הוא כלי מיון להטמעה ולא מדד שמישהו אחר צורך. */
function csmHealth(r){
  const d = csmDaysSince(r.last_gabriela_at);
  let s = d == null ? 0 : d <= 2 ? 40 : d <= 5 ? 25 : d <= 14 ? 10 : 0;
  s += Math.min(r.gabriela_7d || 0, 10) * 2;
  s += Math.min(r.active_listings || 0, 5) * 3;
  s += Math.min(r.clients || 0, 5) * 3;
  const rates = [r.last_clarity, r.last_time_saving].filter(x => x != null);
  if (rates.length) s += Math.round((rates.reduce((a, b) => a + b, 0) / rates.length - 1) / 4 * 10);
  return Math.max(0, Math.min(100, s));
}
// התרעה: 5 ימים ומעלה בלי הודעה לגבריאלה, למי שנרשם/ה לפני יותר מ-5 ימים
function csmRisk(r){
  const d = csmDaysSince(r.last_gabriela_at);
  if (d != null && d < 5) return '';
  if ((csmDaysSince(r.joined_at) || 0) < 5) return '';
  return d == null ? 'עוד לא כתב/ה לגבריאלה' : d + ' ימים בלי גבריאלה';
}

async function loadCsm(force){
  const host = document.getElementById('csmBody');
  if (!host) return;
  csmEnsureCss();
  if (!csmUserId){
    const { data: { session } } = await sb.auth.getSession();
    csmUserId = session && session.user ? session.user.id : null;
  }
  if (csmLoaded && !force){ csmRender(); return; }
  if (!csmLoaded) host.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data, error } = await sb.rpc('csm_agents_overview');
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  csmRows = data || [];
  csmLoaded = true;
  if (!csmUnreadTimer) csmRefreshUnread();
  const atRisk = csmRows.filter(r => csmRisk(r) && r.stage !== 'champion').length;
  if (typeof accSetCount === 'function') accSetCount('accCsm', atRisk || '');
  csmRender();
}

// רשומים על csm_staff.id (היא), ולכן לא בתצוגת הפיקוח ב-CRM
const CSM_STAFF_TABS = ['mentor', 'calls', 'agenda', 'notifications', 'settings'];

function csmRender(){
  const ctx = csmCtx();
  CSM_STAFF_TABS.forEach(t => document.querySelectorAll(`.csm-tabs [data-csm-tab="${t}"]`).forEach(b => { b.hidden = !ctx.isStaff; }));
  const staffTab = document.querySelector('[data-csm-tab="staff"]');
  if (staffTab) staffTab.hidden = !ctx.isAdmin;
  if (CSM_STAFF_TABS.includes(csmTab) && !ctx.isStaff) csmTab = 'pipeline';
  if (csmTab === 'staff' && !ctx.isAdmin) csmTab = 'pipeline';
  document.querySelectorAll('[data-csm-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.csmTab === csmTab)));
  const host = document.getElementById('csmBody');
  if (!host) return;
  if (csmTab === 'pipeline') host.innerHTML = csmPipelineHtml();
  else if (csmTab === 'offices') host.innerHTML = csmOfficesHtml();
  else if (csmTab === 'mentor') host.innerHTML = csmMentorHtml();
  else if (csmTab === 'staff') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadStaff(); }
  else if (csmTab === 'calls') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadCalls(); }
  else if (csmTab === 'agenda') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadAgenda(); }
  else if (csmTab === 'notifications') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadNotifs(); }
  else if (csmTab === 'settings') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadSettings(); }
  else if (csmTab === 'feedback') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadFeedback(); }
  else if (csmTab === 'stories') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadStories(); }
  else host.innerHTML = csmLibraryHtml();
}

/* ---------- הצנרת ---------- */
function csmPipelineHtml(){
  if (!csmRows.length) return '<div class="empty-state">אין עדיין סוכנים פעילים במערכת.</div>';
  const q = csmFilter.trim().toLowerCase();
  const rows = csmRows.filter(r => !q || [r.display_name, r.agency_name, r.phone].some(x => String(x || '').toLowerCase().includes(q)));
  const risk = csmRows.filter(r => csmRisk(r) && r.stage !== 'champion').length;
  const head = `
    <div class="csm-toolbar">
      <input type="search" class="csm-search" id="csmSearch" placeholder="חיפוש לפי שם, משרד או טלפון" value="${escapeHtml(csmFilter)}" aria-label="חיפוש סוכן/ת">
      <button type="button" class="btn btn-ghost" data-csm-refresh>רענון</button>
    </div>
    <p class="acc-sub">${csmRows.length} סוכנים · ${risk ? `<strong class="csm-risk-txt">${risk} בלי גבריאלה 5+ ימים</strong>` : 'אין סוכנים בסיכון כרגע'}</p>`;
  /* ‏בלי גלילה לצד: היא לא נראתה במחשב והייתה לא נוחה (18.10.2026). במקומה
     שורת שלבים עם מספר לכל אחד - לחיצה מציגה שלב אחד בלבד, והכרטיסים שלו
     מתפרסים ברשת על כל הרוחב. "כל השלבים" מציג את העמודות בשורות. */
  const sorted = list => list.slice()
    .sort((a, b) => (csmRisk(b) ? 1 : 0) - (csmRisk(a) ? 1 : 0) || csmHealth(a) - csmHealth(b));
  const chips = `<div class="csm-stage-chips" role="tablist" aria-label="סינון לפי שלב">
      <button type="button" role="tab" data-csm-stage-filter="" aria-selected="${!csmStage}">כל השלבים <span>${rows.length}</span></button>
      ${CSM_STAGES.map(st => `<button type="button" role="tab" data-csm-stage-filter="${st.key}" aria-selected="${csmStage === st.key}"${st.key === 'at_risk' ? ' class="is-risk"' : ''}>${escapeHtml(st.label)} <span>${rows.filter(r => r.stage === st.key).length}</span></button>`).join('')}
    </div>`;
  if (csmStage){
    const st = CSM_STAGES.find(x => x.key === csmStage) || CSM_STAGES[0];
    const list = sorted(rows.filter(r => r.stage === st.key));
    return head + chips + `<div class="csm-cards">${list.map(csmCardHtml).join('') || '<div class="csm-col-empty">אין כאן אף אחד/ת</div>'}</div>`;
  }
  const cols = CSM_STAGES.map(st => {
    const list = sorted(rows.filter(r => r.stage === st.key));
    return `
      <section class="csm-col${st.key === 'at_risk' ? ' is-risk' : ''}" aria-label="${escapeHtml(st.label)}">
        <h4>${escapeHtml(st.label)} <span>${list.length}</span></h4>
        ${list.map(csmCardHtml).join('') || '<div class="csm-col-empty">אין כאן אף אחד/ת</div>'}
      </section>`;
  }).join('');
  return head + chips + '<div class="csm-board">' + cols + '</div>';
}

function csmCardHtml(r){
  const h = csmHealth(r);
  const tone = h >= 60 ? 'good' : h >= 30 ? 'mid' : 'low';
  const risk = csmRisk(r);
  const follow = r.next_followup_at ? csmDaysSince(r.next_followup_at) : null;
  const opts = CSM_STAGES.map(s => `<option value="${s.key}"${s.key === r.stage ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
  return `
    <article class="csm-card">
      <div class="csm-card-head">
        <strong>${escapeHtml(r.display_name || 'ללא שם')}</strong>
        <span class="csm-health ${tone}" title="ציון בריאות">${h}</span>
      </div>
      <div class="csm-card-meta">${escapeHtml(r.agency_name || '')}${r.tier ? ' · ' + escapeHtml(r.tier) : ''} · הצטרף/ה ${escapeHtml(csmFmtDate(r.joined_at))}</div>
      ${risk ? `<div class="csm-badge risk">⚠ ${escapeHtml(risk)}</div>` : ''}
      ${follow != null && follow >= 0 ? `<div class="csm-badge due">📅 קשר הבא ${follow === 0 ? 'היום' : 'עבר לפני ' + follow + ' ימים'}</div>` : ''}
      <div class="csm-stats">
        <span title="הודעות לגבריאלה בשבוע האחרון">💬 ${r.gabriela_7d || 0}</span>
        <span title="נכסים פעילים">🏠 ${r.active_listings || 0}</span>
        <span title="לקוחות">👥 ${r.clients || 0}</span>
        <span title="משימות פתוחות">✅ ${r.open_tasks || 0}</span>
        ${r.last_clarity ? `<span title="דירוג בהדרכה">⭐ ${r.last_clarity}</span>` : ''}
      </div>
      ${r.last_weekly_goal ? `<div class="csm-card-goal">🎯 ${escapeHtml(r.last_weekly_goal)}</div>` : ''}
      ${csmContactHtml(r)}
      <label class="csm-stage-sel"><span class="sr-only">שלב</span>
        <select data-csm-stage="${escapeHtml(r.agent_id)}">${opts}</select>
      </label>
      ${r.phone ? `<div class="csm-contact">
        <a class="btn btn-call" href="tel:${escapeHtml(r.phone)}" aria-label="התקשרות ל${escapeHtml(r.display_name || 'סוכן/ת')}">📞 התקשרות</a>
        <a class="btn btn-ghost" href="https://wa.me/${escapeHtml(csmWaDigits(r.phone))}" target="_blank" rel="noopener noreferrer" aria-label="וואטסאפ ל${escapeHtml(r.display_name || 'סוכן/ת')} (נפתח בלשונית חדשה)">וואטסאפ</a>
        <a class="btn btn-ghost" href="${escapeHtml(csmPricingWa(r))}" target="_blank" rel="noopener noreferrer" aria-label="שליחת דף המסלולים ל${escapeHtml(r.display_name || 'סוכן/ת')} בוואטסאפ (נפתח בלשונית חדשה)">💬 המסלולים</a>
        <span class="csm-phone" dir="ltr">${escapeHtml(r.phone)}</span>
      </div>` : '<div class="csm-card-meta">אין טלפון בכרטיס</div>'}
      <div class="csm-card-actions">
        <button type="button" class="btn btn-gold" data-csm-session="${escapeHtml(r.agent_id)}">${r.sessions ? 'פגישה נוספת' : 'פגישת הצלחה ראשונה'}</button>
        ${csmCtx().isStaff ? `<button type="button" class="btn btn-ghost" data-csm-ev-new="${escapeHtml(r.agent_id)}">📅 קביעת פגישה</button>` : ''}
      </div>
    </article>`;
}

/* פרטי הקשר ורמת השימוש - מקופלים, כדי שהקנבן יישאר קריא */
function csmContactHtml(r){
  const days = v => { const d = csmDaysSince(v); return d == null ? 'אף פעם' : d === 0 ? 'היום' : 'לפני ' + d + ' ימים'; };
  const addr = [r.agency_address, r.agency_city].filter(Boolean).join(', ');
  return `<details class="csm-more"><summary>פרטים ושימוש</summary>
    <dl>
      ${r.phone ? `<dt>טלפון</dt><dd><a href="tel:${escapeHtml(r.phone)}" dir="ltr">${escapeHtml(r.phone)}</a></dd>` : ''}
      ${r.email ? `<dt>מייל</dt><dd><a href="mailto:${escapeHtml(r.email)}" dir="ltr">${escapeHtml(r.email)}</a></dd>` : ''}
      ${addr ? `<dt>המשרד</dt><dd>${escapeHtml(addr)}</dd>` : ''}
      <dt>תפקיד</dt><dd>${r.role === 'manager' ? 'מנהל/ת משרד' : 'סוכן/ת'}${r.license_ok ? '' : ' · רישיון לא מאושר'}</dd>
      <dt>כניסה ל-CRM</dt><dd>${escapeHtml(days(r.last_login_at))}</dd>
      <dt>גבריאלה</dt><dd>${escapeHtml(days(r.last_gabriela_at))} · ${r.gabriela_30d || 0} הודעות ב-30 יום</dd>
      <dt>נכסים</dt><dd>${r.active_listings || 0} פעילים מתוך ${r.listings_total || 0}${r.has_post ? ' · יש פוסט שיווקי' : ''}</dd>
      <dt>המנטור</dt><dd>${r.mentor_30d || 0} שאלות ב-30 יום</dd>
      ${r.stage_notes ? `<dt>הערה</dt><dd>${escapeHtml(r.stage_notes)}</dd>` : ''}
    </dl></details>`;
}

/* ---------- משרדים ----------
   מקובץ מאותן שורות של הצנרת, בלי שאילתה נוספת. הסדר לפי כללי התעדוף של
   מנטור ההטמעה (CSM_PRIORITY ב-playbook.ts): מנהל/ת שמשתמש/ת, ואז גודל. */
function csmOffices(){
  const by = new Map();
  csmRows.forEach(r => {
    const k = r.agency_id || 'none';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  });
  return [...by.values()].map(list => {
    const managers = list.filter(r => r.role === 'manager');
    return {
      name: list[0].agency_name || 'ללא משרד',
      address: [list[0].agency_address, list[0].agency_city].filter(Boolean).join(', '),
      agents: list, managers,
      managerActive: managers.some(r => { const d = csmDaysSince(r.last_gabriela_at); return d != null && d < 7; }),
      active7: list.filter(r => (r.gabriela_7d || 0) > 0).length,
      listings: list.reduce((s, r) => s + (r.active_listings || 0), 0),
      risk: list.filter(r => csmRisk(r) && r.stage !== 'champion').length,
      health: Math.round(list.reduce((s, r) => s + csmHealth(r), 0) / list.length),
    };
  }).sort((a, b) => (b.managerActive - a.managerActive) || (b.agents.length - a.agents.length));
}

function csmOfficesHtml(){
  if (!csmRows.length) return '<div class="empty-state">אין עדיין משרדים.</div>';
  const q = csmFilter.trim().toLowerCase();
  const list = csmOffices().filter(o => !q || o.name.toLowerCase().includes(q) || o.address.toLowerCase().includes(q));
  return `<div class="csm-toolbar">
      <input type="search" class="csm-search" id="csmSearch" placeholder="חיפוש משרד או עיר" value="${escapeHtml(csmFilter)}" aria-label="חיפוש משרד">
      <button type="button" class="btn btn-ghost" data-csm-refresh>רענון</button>
    </div>
    <p class="acc-sub">ממוין לפי מנהל/ת שמשתמש/ת בגבריאלה ואז לפי גודל. ללשונית "המנטור" אפשר לשאול עם מי כדאי להתחיל.</p>
    ${list.map(o => `<article class="csm-office">
      <div class="csm-fb-head"><strong>${escapeHtml(o.name)}</strong><span class="csm-health ${o.health >= 60 ? 'good' : o.health >= 30 ? 'mid' : 'low'}" title="ציון בריאות ממוצע">${o.health}</span></div>
      <div class="csm-card-meta">${o.address ? escapeHtml(o.address) + ' · ' : ''}${o.agents.length} סוכנים · ${o.active7} פעילים בגבריאלה השבוע · ${o.listings} נכסים פעילים${o.risk ? ` · <strong class="csm-risk-txt">${o.risk} בסיכון</strong>` : ''}</div>
      ${o.managers.length ? `<div class="csm-office-mgr">מנהל/ת: ${o.managers.map(m => `${escapeHtml(m.display_name || '')}${m.phone ? ` <a class="btn btn-call btn-sm" href="tel:${escapeHtml(m.phone)}" aria-label="התקשרות ל${escapeHtml(m.display_name || 'מנהל/ת')}">📞 <span dir="ltr">${escapeHtml(m.phone)}</span></a>` : ''}`).join(' · ')}${o.managerActive ? ' <span class="csm-tag seen">משתמש/ת בגבריאלה</span>' : ''}</div>` : ''}
      <details class="csm-more"><summary>הסוכנים במשרד</summary>
        <ul class="csm-office-agents">${o.agents.map(r => `<li>
          <span>${escapeHtml(r.display_name || 'ללא שם')}</span>
          <span class="csm-card-meta">${escapeHtml((CSM_STAGES.find(s => s.key === r.stage) || {}).label || '')} · 💬 ${r.gabriela_7d || 0} · 🏠 ${r.active_listings || 0}</span>
          ${r.phone ? `<a class="btn btn-call btn-sm" href="tel:${escapeHtml(r.phone)}" aria-label="התקשרות ל${escapeHtml(r.display_name || 'סוכן/ת')}">📞 <span dir="ltr">${escapeHtml(r.phone)}</span></a>` : ''}
        </li>`).join('')}</ul>
      </details>
    </article>`).join('') || '<div class="empty-state">לא נמצא משרד.</div>'}`;
}

/* ---------- המנטור ----------
   מנטור ההטמעה דרך csm-workspace (‏action = ask_mentor). תשובה בלבד; השאלה והתשובה
   נשמרות עד רענון הדף, כמו בכרטיסים של שלושת המנטורים. */
const CSM_MENTOR_Q = [
  'עם איזה 3 משרדים כדאי לי להתחיל השבוע, ולמה?',
  'מי בסיכון עכשיו, ומה לכתוב לכל אחד/ת?',
  'איך לגשת למנהל/ת משרד שעוד לא התחיל/ה להשתמש?',
  'סוכן אומר "אין לי זמן ללמוד מערכת". מה עונים?',
  'איך בונים פיילוט של 30 יום במשרד?',
];
const csmMentor = { q:'', a:'', err:'', busy:false, remaining:null };

function csmMentorHtml(){
  const st = csmMentor;
  return `<div class="csm-mentor">
    <p class="acc-sub">מנטור ההטמעה רואה את כל התיק - השלבים, המשרדים, מי בסיכון ובקשות הפיתוח - ועונה מתוך השיטה של שוק נדל״ן. אפשר לשאול גם את גבריאלה בוואטסאפ ("שאלה למנטור: ...").</p>
    <div class="csm-mentor-sugg">${CSM_MENTOR_Q.map(q => `<button type="button" class="csm-chip" data-csm-mq="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
    <form class="csm-mentor-form" id="csmMentorForm">
      <label for="csmMentorQ" class="sr-only">השאלה למנטור</label>
      <textarea id="csmMentorQ" rows="2" maxlength="300" placeholder="מה תרצי לשאול?">${escapeHtml(st.busy ? st.q : '')}</textarea>
      <button type="submit" class="btn btn-gold"${st.busy ? ' disabled' : ''}>${st.busy ? 'המנטור חושב…' : 'שאלה'}</button>
    </form>
    ${st.q && !st.busy ? `<div class="csm-mentor-q">${escapeHtml(st.q)}</div>` : ''}
    ${st.err ? `<div class="empty-state">${escapeHtml(st.err)}</div>` : ''}
    ${st.a ? `<div class="csm-mentor-a">${escapeHtml(st.a)}</div>` : ''}
    ${st.remaining != null ? `<p class="csm-hint">נשארו ${st.remaining} שאלות ב-24 השעות האחרונות.</p>` : ''}
  </div>`;
}

async function csmAskMentor(question){
  const q = String(question || '').trim();
  if (!q || csmMentor.busy) return;
  if (q.length < 3){ showToast('צריך לכתוב שאלה של כמה מילים לפחות.'); return; }
  Object.assign(csmMentor, { q, a:'', err:'', busy:true });
  if (csmTab === 'mentor') csmRender();
  try {
    const data = await csmApi({ action:'ask_mentor', question:q });
    if (data.error){
      if (data.remaining != null) csmMentor.remaining = data.remaining;
      throw { code: data.error, message: data.error };
    }
    csmMentor.a = data.answer || '';
    csmMentor.remaining = data.remaining;
  } catch (err){
    csmMentor.err = heErr(err);
  }
  csmMentor.busy = false;
  if (csmTab === 'mentor') csmRender();
}

/* ---------- קריאה ל-csm-workspace ----------
   הטוקן נשלף בכל קריאה: supabase-js מרענן אותו ברקע. */
async function csmApi(body){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error:'session_not_found' };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/csm-workspace', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.error) data.error = String(res.status);
    return data;
  } catch (e){
    return { error: (e && e.message) || 'network' };
  }
}

/* ---------- הקלטות שיחה ----------
   ההקלטה עולה לדלי csm-calls, נוצרת שורה pending, ו-csm-workspace מתמללת
   ומנתחת ברקע. הדף קורא את השורה כל 4 שניות עד done/failed. */
const CSM_MOOD = { positive:'חיובי/ת ומעורב/ת', neutral:'ניטרלי/ת', hesitant:'מהסס/ת', negative:'מתנגד/ת או מתוסכל/ת' };
const CSM_CALL_STATUS = { pending:'ממתינה', processing:'מתמללת ומסכמת…', done:'מוכנה', failed:'נכשלה' };
let csmCalls = [];
let csmCallOpen = null;
let csmCallPoll = null;

async function csmLoadCalls(){
  const { data, error } = await sb.from('csm_calls')
    .select('id,title,agent_id,source,status,error,analysis,transcript,audio_path,created_at,from_number,voicemail')
    .order('created_at', { ascending:false }).limit(100);
  if (csmTab !== 'calls') return;
  const host = document.getElementById('csmBody');
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  csmCalls = data || [];
  host.innerHTML = csmCallsHtml();
  clearTimeout(csmCallPoll);
  if (csmCalls.some(c => c.status === 'pending' || c.status === 'processing')){
    csmCallPoll = setTimeout(() => { if (csmTab === 'calls') csmLoadCalls(); }, 4000);
  }
}

function csmCallsHtml(){
  const names = Object.fromEntries(csmRows.map(r => [r.agent_id, r.display_name]));
  const list = csmCalls.map(c => {
    const a = c.analysis || {};
    const open = csmCallOpen === c.id;
    return `<article class="csm-call${open ? ' is-open' : ''}">
      <div class="csm-fb-head">
        <button type="button" class="csm-call-title" data-csm-call="${escapeHtml(c.id)}" aria-expanded="${open}">
          <strong>${escapeHtml(c.title || 'שיחה')}</strong>
        </button>
        <span class="csm-tag ${c.status === 'done' ? 'seen' : c.status === 'failed' ? 'rec' : ''}">${escapeHtml(CSM_CALL_STATUS[c.status] || c.status)}</span>
      </div>
      <div class="csm-card-meta">${escapeHtml(new Date(c.created_at).toLocaleString('he-IL', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' }))}
        · ${c.source === 'whatsapp' ? 'מוואטסאפ' : c.source === 'phone' ? (c.voicemail ? 'הודעה קולית למספר שלך' : 'שיחה למספר שלך') + (c.from_number ? ' מ-<span dir="ltr">' + escapeHtml(csmLocalPhone(c.from_number)) + '</span>' : '') : 'הועלתה כאן'} · ${c.agent_id ? escapeHtml(names[c.agent_id] || 'סוכן/ת') : 'לא משויכת'}</div>
      ${c.status === 'failed' ? `<p class="csm-hint">${escapeHtml(c.error || '')} <button type="button" class="btn btn-ghost" data-csm-call-retry="${escapeHtml(c.id)}">לנסות שוב</button></p>` : ''}
      ${a.summary && !open ? `<p class="csm-fb-desc">${escapeHtml(a.summary)}</p>` : ''}
      ${open ? csmCallDetailHtml(c) : ''}
    </article>`;
  }).join('');
  return `<form class="csm-form" id="csmCallForm">
      <div class="field"><label for="csmCallFile">הקלטת שיחה (m4a, mp3, aac, ogg, wav - עד 25MB)</label>
        <input type="file" id="csmCallFile" accept="audio/*,.m4a,.mp3,.aac,.ogg,.opus,.wav,.3gp,.webm" required></div>
      <div class="csm-fb-row">
        <div class="field"><label for="csmCallTitle">כותרת</label><input type="text" id="csmCallTitle" maxlength="200" placeholder="למשל: שיחת היכרות עם מנהל המשרד"></div>
        <div class="field"><label for="csmCallAgent">עם מי (לא חובה)</label><select id="csmCallAgent"><option value="">לא משויכת</option>${csmAgentOptions()}</select></div>
      </div>
      <button type="submit" class="btn btn-gold">העלאה לתמלול וסיכום</button>
      <p class="csm-hint">אפשר גם לשלוח את ההקלטה לגבריאלה בוואטסאפ. ההקלטה עוברת ל-OpenAI לתמלול ולמודל לסיכום, ונשמרת באזור ההטמעה בלבד.</p>
    </form>
    ${list || '<div class="empty-state">עוד אין הקלטות.</div>'}`;
}

function csmCallDetailHtml(c){
  const a = c.analysis || {};
  const sec = (t, items) => items && items.length ? `<h5>${escapeHtml(t)}</h5><ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  const stageLabel = k => (CSM_STAGES.find(s => s.key === k) || {}).label || '';
  const agent = c.agent_id ? csmRows.find(r => r.agent_id === c.agent_id) : null;
  return `<div class="csm-call-detail">
    <div class="csm-fb-row">
      <select data-csm-call-agent="${escapeHtml(c.id)}" aria-label="שיוך לסוכן/ת"><option value="">לא משויכת</option>${csmAgentOptions().replace(`value="${escapeHtml(c.agent_id || '')}"`, `value="${escapeHtml(c.agent_id || '')}" selected`)}</select>
      <button type="button" class="btn btn-ghost" data-csm-call-del="${escapeHtml(c.id)}">מחיקה</button>
    </div>
    ${a.summary ? `<p class="csm-fb-desc">${escapeHtml(a.summary)}</p>` : ''}
    ${a.mood ? `<p class="csm-hint">הטון: ${escapeHtml(CSM_MOOD[a.mood] || a.mood)}</p>` : ''}
    ${sec('נקודות כאב', a.pains)}${sec('התנגדויות', a.objections)}${sec('התחייבויות', a.commitments)}
    ${sec('המלצות', a.recommendations)}
    ${sec('הצעדים הבאים', (a.next_steps || []).map(x => x.action + (x.when ? ' (' + x.when + ')' : '')))}
    <div class="csm-call-actions">
      ${a.suggested_stage || a.followup_date ? `<button type="button" class="btn btn-gold" data-csm-call-apply="${escapeHtml(c.id)}"${c.agent_id ? '' : ' disabled title="קודם לשייך לסוכן/ת"'}>
        עדכון ${a.suggested_stage ? 'השלב ל"' + escapeHtml(stageLabel(a.suggested_stage)) + '"' : ''}${a.suggested_stage && a.followup_date ? ' ו' : ''}${a.followup_date ? 'מועד הקשר ל-' + escapeHtml(a.followup_date) : ''}</button>` : ''}
    </div>
    ${(a.feedback_items || []).length ? `<h5>לפיתוח</h5><ul>${a.feedback_items.map((f, i) => `<li>${escapeHtml(f.title)} <button type="button" class="btn btn-ghost" data-csm-call-fb="${escapeHtml(c.id)}" data-i="${i}">להוסיף למשוב</button></li>`).join('')}</ul>` : ''}
    ${a.message_draft ? `<h5>הודעה מוצעת לסוכן/ת</h5><div class="csm-cmd"><code>${escapeHtml(a.message_draft)}</code>
      <div class="csm-cmd-actions"><button type="button" class="btn btn-ghost" data-csm-copy="${escapeHtml(a.message_draft)}">העתקה</button>
      ${agent && agent.phone ? `<a class="btn btn-ghost" href="https://wa.me/${escapeHtml(csmWaDigits(agent.phone))}?text=${encodeURIComponent(a.message_draft)}" target="_blank" rel="noopener noreferrer" aria-label="שליחה לסוכן/ת בוואטסאפ (נפתח בלשונית חדשה)">שליחה בוואטסאפ</a>` : ''}</div></div>` : ''}
    ${c.transcript ? `<details class="csm-more"><summary>התמלול המלא</summary><div class="csm-transcript">${escapeHtml(c.transcript)}</div></details>` : ''}
  </div>`;
}

async function csmUploadCall(){
  const fileEl = document.getElementById('csmCallFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024){ showToast('ההקלטה גדולה מ-25MB. אפשר לשלוח חלק ממנה או לייצא באיכות נמוכה יותר.'); return; }
  const ext = ((file.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'mp3').toLowerCase();
  const path = 'web/' + (csmUserId || 'x') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const { error: upErr } = await sb.storage.from('csm-calls').upload(path, file, { contentType: file.type || 'audio/mpeg' });
  if (upErr) throw upErr;
  const { data, error } = await sb.from('csm_calls').insert({
    title: (document.getElementById('csmCallTitle').value || '').trim() || file.name.slice(0, 200),
    agent_id: document.getElementById('csmCallAgent').value || null,
    source: 'upload', audio_path: path,
  }).select('id').single();
  if (error) throw error;
  const r = await csmApi({ action:'analyze_call', call_id: data.id });
  if (r.error) throw { code: r.error, message: r.error };
  csmCallOpen = data.id;
  showToast('ההקלטה עלתה. התמלול והסיכום לוקחים דקה-שתיים.');
}

/* ---------- צוות ההטמעה (מנהל/ת הפלטפורמה בלבד) ----------
   תפקיד נפרד: לא סוכנת ולא מנהלת פלטפורמה. מזמינים לפי מייל (ונייד, בשביל
   גבריאלה), והיא נכנסת ל-/csm עם Google באותו מייל - csm_claim מחברת. */
const CSM_STAFF_ERR = {
  invalid_email:'כתובת המייל אינה תקינה.',
  phone_is_agent:'הנייד הזה רשום לסוכן/ת במערכת. גבריאלה מזהה סוכנים קודם, ולכן צריך נייד אחר.',
  phone_taken:'הנייד הזה כבר רשום לאשת צוות שכבר נכנסה לאזור.',
  already_joined:'היא כבר נכנסה לאזור, ולכן המייל נשאר כמו שהוא. אפשר לעדכן שם ונייד.',
  duplicate:'המייל או הנייד כבר רשומים בהזמנה אחרת ברשימה.',
  not_found:'ההזמנה לא נמצאה. כדאי לרענן.',
};
let csmStaffRows = [];
let csmStaffEditId = null;   // עריכה של הזמנה קיימת (csm_staff_update), או null להזמנה חדשה

async function csmLoadStaff(){
  const host = document.getElementById('csmBody');
  const [{ data, error }, { data: lines }, { data: cands }] = await Promise.all([
    sb.rpc('csm_staff_list'),
    sb.from('csm_phone_lines').select('id,staff_id,twilio_number,forward_to,twilio_sid,moved_from_line,active').eq('active', true),
    sb.rpc('csm_phone_line_candidates'),
  ]);
  if (csmTab !== 'staff') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  const rows = csmStaffRows = data || [];
  const lineOf = Object.fromEntries((lines || []).map(l => [l.staff_id, l]));
  const ed = csmStaffEditId ? rows.find(r => r.id === csmStaffEditId) : null;
  if (!ed) csmStaffEditId = null;
  host.innerHTML = `
    <p class="acc-sub">מנהלת ההדרכות וההטמעה היא תפקיד נפרד: אזור משלה ב-<a href="/csm" target="_blank" rel="noopener">shuknadlan.co.il/csm</a>, בלי ניהול הפלטפורמה, בלי משרד ובלי נכסים.
      מזמינים כאן במייל שאיתו היא נכנסת ל-Google, ובנייד שממנו היא כותבת לגבריאלה.</p>
    <form class="csm-form" id="csmStaffForm">
      <div class="csm-fb-row">
        <div class="field"><label for="csmStName">שם</label><input type="text" id="csmStName" maxlength="120" value="${escapeHtml(ed ? ed.display_name || '' : '')}"></div>
        <div class="field"><label for="csmStEmail">מייל (Google)</label><input type="email" id="csmStEmail" required dir="ltr" value="${escapeHtml(ed ? ed.email : '')}"${ed && ed.joined ? ' readonly title="היא כבר נכנסה - המייל נשאר"' : ''}></div>
        <div class="field"><label for="csmStPhone">נייד (לגבריאלה)</label><input type="tel" id="csmStPhone" dir="ltr" value="${escapeHtml(ed ? ed.phone || '' : '')}"></div>
      </div>
      <button type="submit" class="btn btn-gold">${ed ? 'שמירת השינויים' : 'הזמנה'}</button>
      ${ed ? '<button type="button" class="btn btn-ghost" data-csm-staff-cancel>ביטול העריכה</button>' : ''}
      ${ed && !ed.joined ? '<p class="csm-hint">היא עוד לא נכנסה, ולכן אפשר לתקן את המייל. אחרי השמירה היא נכנסת עם Google במייל המתוקן.</p>' : ''}
    </form>
    ${rows.map(r => `<div class="csm-staff-row">
      <div><strong>${escapeHtml(r.display_name || r.email)}</strong>
        <div class="csm-card-meta" dir="auto">${escapeHtml([r.email, r.phone].filter(Boolean).join(' · '))} · ${r.joined ? 'נכנסה לאזור' : 'עוד לא נכנסה'}${r.active ? '' : ' · מושבתת'}</div></div>
      <div class="csm-staff-btns">
        <button type="button" class="btn btn-ghost" data-csm-staff-edit="${escapeHtml(r.id)}">עריכה</button>
        <button type="button" class="btn ${r.active ? 'btn-ghost' : 'btn-gold'}" data-csm-staff="${escapeHtml(r.id)}" data-on="${r.active ? '0' : '1'}">${r.active ? 'השבתה' : 'הפעלה'}</button>
      </div>
      ${r.active ? csmStaffLineHtml(r, lineOf[r.id], cands || []) : ''}
    </div>`).join('') || '<div class="empty-state">עוד אין צוות הטמעה.</div>'}`;
}

/* ---------- המספר הווירטואלי של אשת הצוות (csm_phone_lines) ----------
   שיחה למספר מגיעה לנייד שלה, מוקלטת, ומנותחת כמו "הקלטות" - והסיכום וההקלטה
   מגיעים אליה בוואטסאפ (twilio-voice, ‏csmIncoming). של הפלטפורמה: בלי מסלול,
   ארנק או תקרת דקות. שתי דרכים: קנייה ב-Twilio (twilio-voice?task=csm-line-order),
   או העברת מספר קיים של הפלטפורמה, כמו הפיילוט (csm_phone_line_assign). */
function csmLocalPhone(e164){
  const d = String(e164 || '').replace(/\D/g, '');
  return d.startsWith('972') ? '0' + d.slice(3) : String(e164 || '');
}

function csmStaffLineHtml(r, line, cands){
  if (line) return `<div class="csm-staff-line">📞 מספר וירטואלי: <strong dir="ltr">${escapeHtml(csmLocalPhone(line.twilio_number))}</strong>
      → ${line.forward_to ? '<span dir="ltr">' + escapeHtml(csmLocalPhone(line.forward_to)) + '</span>' : 'הנייד שלה'}
      <button type="button" class="btn btn-ghost btn-sm" data-csm-line-off="${escapeHtml(line.id)}" data-bought="${line.twilio_sid ? '1' : '0'}">${line.twilio_sid ? 'שחרור המספר' : line.moved_from_line ? 'החזרה לסוכנים' : 'ניתוק'}</button></div>`;
  if (!r.phone) return '<div class="csm-staff-line csm-hint">כדי לחבר מספר וירטואלי צריך קודם נייד בהזמנה.</div>';
  return `<div class="csm-staff-line">
      <span class="csm-hint">מספר וירטואלי: שיחות אליו יגיעו לנייד שלה, יוקלטו, והסיכום וההקלטה יגיעו אליה בוואטסאפ.</span>
      <select data-csm-line-area="${escapeHtml(r.id)}" aria-label="קידומת"><option value="4">04</option><option value="2">02</option><option value="3">03</option><option value="8">08</option><option value="9">09</option><option value="72">072</option><option value="77">077</option></select>
      <button type="button" class="btn btn-gold btn-sm" data-csm-line-buy="${escapeHtml(r.id)}">קניית מספר</button>
      ${cands.length ? `<select data-csm-line-move="${escapeHtml(r.id)}" aria-label="מספר קיים של הפלטפורמה"><option value="">או העברת מספר קיים…</option>${cands.map(c => `<option value="${escapeHtml(c.twilio_number)}">${escapeHtml(csmLocalPhone(c.twilio_number))}${c.label ? ' - ' + escapeHtml(c.label) : ''}${c.agent_name ? ' (אצל ' + escapeHtml(c.agent_name) + ')' : ''}</option>`).join('')}</select>` : ''}
    </div>`;
}

const CSM_LINE_ERR = {
  bad_number:'המספר אינו מספר ישראלי תקין.', number_in_use:'המספר הזה שייך לסוכן/ת שמשלם/ת עליו, ולא אפשר להעביר אותו.',
  staff_not_found:'אשת הצוות לא נמצאה או מושבתת.', no_phone:'אין נייד בהזמנה - אין לאן לנתב.',
  no_number_available:'אין כרגע מספר פנוי בקידומת הזו ב-Twilio. אפשר לנסות קידומת אחרת.',
  purchase_failed:'הקנייה ב-Twilio נכשלה. לא חויב דבר.', not_configured:'Twilio עוד לא מוגדר במערכת.',
  twilio_release_failed:'השחרור ב-Twilio נכשל. אפשר לנסות שוב.',
};

async function csmTwilio(task, body){
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error:'session_not_found' };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/twilio-voice?task=' + encodeURIComponent(task), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + session.access_token },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.error) data.error = String(res.status);
    return data;
  } catch (e){
    return { error: (e && e.message) || 'network' };
  }
}

/* "המסלולים" בכרטיס: הוואטסאפ שלה נפתח עם הודעה מוכנה וקישור לדף המסלולים.
   נשלח מהטלפון שלה, כמו כפתור "וואטסאפ" שלידו. דרך גבריאלה - csm_send_to_agent. */
function csmPricingWa(r){
  const first = String(r.display_name || '').trim().split(/\s+/)[0];
  const text = (first ? 'היי ' + first + ', ' : 'היי, ') + 'כאן המסלולים של שוק נדל״ן ומה כלול בכל אחד: https://shuknadlan.co.il/pricing';
  return 'https://wa.me/' + csmWaDigits(r.phone) + '?text=' + encodeURIComponent(text);
}

function csmWaDigits(phone){
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('0') ? '972' + d.slice(1) : d;
}

async function csmSetStage(agentId, stage, extra){
  const row = csmRows.find(r => r.agent_id === agentId);
  const before = row && row.stage;
  if (row) row.stage = stage;
  const payload = Object.assign({ agent_id: agentId, stage, updated_at: new Date().toISOString(),
    updated_by: csmUserId }, extra || {});
  const { error } = await sb.from('csm_agent_stage').upsert(payload, { onConflict:'agent_id' });
  if (error){
    if (row) row.stage = before;
    showToast('השלב לא נשמר: ' + heErr(error));
  }
  if (csmTab === 'pipeline') csmRender();
  return !error;
}

/* ---------- פגישת "הצלחה ראשונה" ---------- */
function csmOpenSession(agentId){
  const agent = csmRows.find(r => r.agent_id === agentId);
  if (!agent) return;
  const due = new Date(Date.now() + 5 * 86400000);
  csmSession = { agent, draft: { diagnostic:{}, track:'', first_win:{}, clarity:null, time_saving:null,
    weekly_goal:'', followup_at: due.toISOString().slice(0, 10), dev_notes:'', notes:'',
    fb_title:'', fb_category:'pilot_blocker', fb_severity:'usability' } };
  document.getElementById('csmSessionTitle').textContent = 'פגישת הצלחה ראשונה - ' + (agent.display_name || '');
  csmPaintSession();
  csmFillFeedbackTitles();
  const modal = document.getElementById('csmSessionModal');
  modal.style.display = 'flex';
  modal.scrollTop = 0;
}

function csmCloseSession(){
  document.getElementById('csmSessionModal').style.display = 'none';
  csmSession = null;
}

function csmRadio(name, value, label, checked, type){
  return `<label class="csm-opt"><input type="${type || 'radio'}" name="${name}" value="${escapeHtml(value)}"${checked ? ' checked' : ''}> <span>${escapeHtml(label)}</span></label>`;
}

function csmPaintSession(){
  const { agent, draft } = csmSession;
  const d = draft.diagnostic;
  const suggested = csmSuggestTrack(d);
  const track = draft.track || suggested;
  const pain = d.pain;

  const diag = CSM_DIAG.map(q => {
    const multi = !!q.multi;
    const cur = multi ? (d[q.key] || []) : d[q.key];
    const opts = q.opts.map(([v, l]) => csmRadio('csmd_' + q.key, v, l, multi ? cur.includes(v) : cur === v, multi ? 'checkbox' : 'radio')).join('');
    const showExtra = q.extra && (multi ? cur.includes(q.extra.when) : cur === q.extra.when);
    return `<fieldset class="csm-q"><legend>${escapeHtml(q.q)}</legend>${opts}
      ${showExtra ? `<input type="text" class="csm-text" data-csm-extra="${q.extra.key}" placeholder="${escapeHtml(q.extra.ph)}" value="${escapeHtml(d[q.extra.key] || '')}">` : ''}</fieldset>`;
  }).join('');

  const trackSel = `<div class="csm-track">
    <label for="csmTrack">מסלול</label>
    <select id="csmTrack"><option value="">-</option>${Object.entries(CSM_TRACKS).map(([k, t]) =>
      `<option value="${k}"${k === track ? ' selected' : ''}>${escapeHtml(t.label)}${k === suggested ? ' (לפי השאלון)' : ''}</option>`).join('')}</select>
    ${track ? `<p class="csm-hint">פוקוס: ${escapeHtml(CSM_TRACKS[track].focus)}</p>` : ''}</div>`;

  const win = CSM_WIN.map(w => {
    const seen = w.signal && w.signal(agent);
    const rec = pain && w.pain === pain;
    return `<div class="csm-win${rec ? ' is-rec' : ''}">
      <label class="csm-opt"><input type="checkbox" data-csm-win="${w.key}"${draft.first_win[w.key] ? ' checked' : ''}>
        <span>${escapeHtml(w.label)}</span></label>
      <div class="csm-win-tags">${rec ? '<span class="csm-tag rec">מומלץ לפי נקודת הכאב</span>' : ''}${seen ? '<span class="csm-tag seen">זוהה במערכת</span>' : ''}</div>
      <div class="csm-cmd"><code>${escapeHtml(w.cmd)}</code>
        <div class="csm-cmd-actions">
          <button type="button" class="btn btn-ghost" data-csm-copy="${escapeHtml(w.cmd)}">העתקה</button>
          ${agent.phone ? `<a class="btn btn-ghost" href="https://wa.me/${escapeHtml(csmWaDigits(agent.phone))}?text=${encodeURIComponent(w.cmd)}" target="_blank" rel="noopener noreferrer" aria-label="שליחת הפקודה לסוכן/ת בוואטסאפ (נפתח בלשונית חדשה)">לשלוח לסוכן/ת</a>` : ''}
        </div></div>
    </div>`;
  }).join('');

  const rate = (key, label) => `<fieldset class="csm-q csm-rate"><legend>${escapeHtml(label)}</legend>${
    [1, 2, 3, 4, 5].map(n => csmRadio('csmr_' + key, String(n), String(n), draft[key] === n)).join('')}</fieldset>`;

  const goalIsCustom = draft.weekly_goal && !CSM_GOALS.includes(draft.weekly_goal);
  const goals = CSM_GOALS.map(g => csmRadio('csm_goal', g, g, draft.weekly_goal === g)).join('')
    + csmRadio('csm_goal', '__other', 'יעד אחר', goalIsCustom || draft.weekly_goal === '__other')
    + ((goalIsCustom || draft.weekly_goal === '__other') ? `<input type="text" class="csm-text" id="csmGoalOther" placeholder="היעד לשבוע" value="${escapeHtml(goalIsCustom ? draft.weekly_goal : '')}">` : '');

  document.getElementById('csmSessionBody').innerHTML = `
    <section class="csm-part"><h3>חלק 1 · שאלון אבחון <small>5-7 דקות</small></h3>
      <p class="csm-hint">המטרה: לשייך למסלול ולמצוא את צוואר הבקבוק הדחוף להיום.</p>
      ${diag}${trackSel}</section>
    <section class="csm-part"><h3>חלק 2-3 · הצלחה ראשונה בוואטסאפ <small>15-20 דקות</small></h3>
      <p class="csm-hint"><strong>כלל ברזל:</strong> לא מסבירים בתיאוריה. הסוכן/ת פותח/ת את הוואטסאפ, כותב/ת לגבריאלה,
      ומסמנים לפחות פעולה אחת שבוצעה בהצלחה מלאה. אחרי כל פעולה - "רענון" כדי לראות שהיא נקלטה.</p>
      <button type="button" class="btn btn-ghost csm-refresh-signals" data-csm-signals>רענון: מה נקלט במערכת</button>
      ${win}</section>
    <section class="csm-part"><h3>חלק 4 · סיכום ומשוב <small>3-5 דקות</small></h3>
      ${rate('clarity', 'האם המערכת ברורה ואינטואיטיבית? (1-5)')}
      ${rate('time_saving', 'האם הוא/היא רואה איך זה חוסך זמן שבועי? (1-5)')}
      <fieldset class="csm-q"><legend>יעד שבועי ראשון</legend>${goals}</fieldset>
      <div class="field"><label for="csmFollow">נקודת המגע הבאה (שיחה קצרה לבדיקת שימוש)</label>
        <input type="date" id="csmFollow" value="${escapeHtml(draft.followup_at || '')}"></div>
      <div class="field"><label for="csmDevNotes">הערות פיתוח ובאגים - ניסוח שגבריאלה לא הבינה, שדה חסר בנכס</label>
        <textarea id="csmDevNotes" rows="3">${escapeHtml(draft.dev_notes)}</textarea></div>
      <div class="csm-fb-quick">
        <div class="field"><label for="csmFbTitle">בקשת פיתוח לתעדוף (לא חובה)</label>
          <input type="text" id="csmFbTitle" maxlength="160" placeholder="למשל: שדה מחסן בטופס הנכס" value="${escapeHtml(draft.fb_title)}" list="csmFbTitles"></div>
        <div class="csm-fb-row">
          <select id="csmFbCategory" aria-label="סוג הבקשה">${Object.entries(CSM_FB_CATEGORY).map(([k, l]) => `<option value="${k}"${k === draft.fb_category ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
          <select id="csmFbSeverity" aria-label="חומרה">${Object.entries(CSM_FB_SEVERITY).map(([k, l]) => `<option value="${k}"${k === draft.fb_severity ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
        </div>
        <p class="csm-hint">בקשה שכבר קיימת ברשימה מקבלת את הסוכן/ת כקול נוסף, ולא שורה כפולה.</p>
      </div>
      <div class="field"><label for="csmNotes">הערות לפגישה</label>
        <textarea id="csmNotes" rows="2">${escapeHtml(draft.notes)}</textarea></div>
    </section>`;
}

async function csmFillFeedbackTitles(){
  const list = document.getElementById('csmFbTitles');
  if (!list) return;
  const { data } = await sb.from('csm_feedback').select('title').in('status', ['open','planned','in_progress']).limit(300);
  list.innerHTML = (data || []).map(f => `<option value="${escapeHtml(f.title)}"></option>`).join('');
}

// קורא את הטופס לטיוטה, כדי שציור מחדש (שינוי שאלה שמשנה מסלול) לא ימחק הקלדה
function csmReadSession(){
  if (!csmSession) return;
  const draft = csmSession.draft;
  const body = document.getElementById('csmSessionBody');
  CSM_DIAG.forEach(q => {
    const checked = [...body.querySelectorAll(`[name="csmd_${q.key}"]:checked`)].map(i => i.value);
    draft.diagnostic[q.key] = q.multi ? checked : (checked[0] || undefined);
  });
  body.querySelectorAll('[data-csm-extra]').forEach(i => { draft.diagnostic[i.dataset.csmExtra] = i.value.trim(); });
  const track = document.getElementById('csmTrack');
  if (track) draft.track = track.value;
  body.querySelectorAll('[data-csm-win]').forEach(i => { draft.first_win[i.dataset.csmWin] = i.checked; });
  ['clarity', 'time_saving'].forEach(k => {
    const c = body.querySelector(`[name="csmr_${k}"]:checked`);
    draft[k] = c ? Number(c.value) : null;
  });
  const goal = body.querySelector('[name="csm_goal"]:checked');
  const other = document.getElementById('csmGoalOther');
  draft.weekly_goal = goal ? (goal.value === '__other' ? (other && other.value.trim() ? other.value.trim() : '__other') : goal.value) : '';
  draft.followup_at = (document.getElementById('csmFollow') || {}).value || '';
  draft.dev_notes = (document.getElementById('csmDevNotes') || {}).value || '';
  draft.notes = (document.getElementById('csmNotes') || {}).value || '';
  draft.fb_title = ((document.getElementById('csmFbTitle') || {}).value || '').trim();
  draft.fb_category = (document.getElementById('csmFbCategory') || {}).value || 'pilot_blocker';
  draft.fb_severity = (document.getElementById('csmFbSeverity') || {}).value || 'usability';
}

async function csmRefreshSignals(btn){
  if (!csmSession) return;
  csmReadSession();
  btn.disabled = true;
  await loadCsm(true);
  const fresh = csmRows.find(r => r.agent_id === csmSession.agent.agent_id);
  if (fresh) csmSession.agent = fresh;
  csmPaintSession();
  showToast('עודכן מהמערכת');
}

// בקשה עם אותה כותרת (בלי רווחים ורישיות) מקבלת קול; אחרת נפתחת שורה חדשה
async function csmAddFeedbackVote(title, category, severity, agentId, sessionId, note){
  const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const { data: existing, error: e1 } = await sb.from('csm_feedback').select('id,title').limit(1000);
  if (e1) throw e1;
  let fb = (existing || []).find(f => norm(f.title) === norm(title));
  if (!fb){
    const { data, error } = await sb.from('csm_feedback')
      .insert({ title: title.trim(), category, severity, created_by: csmUserId })
      .select('id').single();
    if (error) throw error;
    fb = data;
  }
  if (agentId){
    const { error } = await sb.from('csm_feedback_votes')
      .upsert({ feedback_id: fb.id, agent_id: agentId, session_id: sessionId || null, note: note || null },
              { onConflict:'feedback_id,agent_id', ignoreDuplicates:true });
    if (error) throw error;
  }
  return fb.id;
}

async function csmSaveSession(){
  if (!csmSession) return;
  csmReadSession();
  const { agent, draft } = csmSession;
  const btn = document.getElementById('csmSessionSave');
  const wins = Object.keys(draft.first_win).filter(k => draft.first_win[k]);
  const goal = draft.weekly_goal === '__other' ? '' : draft.weekly_goal;
  btn.disabled = true;
  const followIso = draft.followup_at ? new Date(draft.followup_at + 'T10:00:00').toISOString() : null;
  const { data, error } = await sb.from('csm_sessions').insert({
    agent_id: agent.agent_id,
    kind: agent.sessions ? 'followup' : 'first_win',
    diagnostic: draft.diagnostic,
    track: draft.track || csmSuggestTrack(draft.diagnostic) || null,
    first_win: draft.first_win,
    clarity: draft.clarity, time_saving: draft.time_saving,
    weekly_goal: goal || null,
    followup_at: followIso,
    dev_notes: draft.dev_notes.trim() || null,
    notes: draft.notes.trim() || null,
    created_by: csmUserId,
  }).select('id').single();
  if (error){ btn.disabled = false; showToast('הפגישה לא נשמרה: ' + heErr(error)); return; }

  if (draft.fb_title){
    try {
      await csmAddFeedbackVote(draft.fb_title, draft.fb_category, draft.fb_severity, agent.agent_id, data.id, draft.dev_notes.trim());
    } catch (e){ showToast('הפגישה נשמרה, בקשת הפיתוח לא: ' + heErr(e)); }
  }

  // הצלחה ראשונה מקדמת ל"עבר/ה הדרכה" - רק קדימה, ולא מוציאה מ"פיילוט" או "עצמאי/ת"
  const stage = wins.length && CSM_STAGE_ORDER[agent.stage] < CSM_STAGE_ORDER.onboarded ? 'onboarded'
    : agent.stage === 'at_risk' && wins.length ? 'active_pilot' : agent.stage;
  await csmSetStage(agent.agent_id, stage, { next_followup_at: followIso });
  btn.disabled = false;
  csmCloseSession();
  showToast(wins.length ? `נשמר. ${wins.length} פעולות בוצעו בפגישה` : 'נשמר. לא סומנה אף פעולה - כדאי לקבוע פגישה נוספת');
  loadCsm(true);
}

/* ---------- משוב ותעדוף ---------- */
async function csmLoadFeedback(){
  const host = document.getElementById('csmBody');
  const { data, error } = await sb.from('csm_feedback')
    .select('id,title,description,category,severity,status,created_at,csm_feedback_votes(agent_id,note,created_at)')
    .order('created_at', { ascending:false }).limit(500);
  if (csmTab !== 'feedback') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  const names = Object.fromEntries(csmRows.map(r => [r.agent_id, r.display_name]));
  const items = (data || []).map(f => Object.assign(f, { votes: (f.csm_feedback_votes || []).length }));
  // הסדר: פתוחות לפני סגורות, חוסם לפני שיפור, ואז מספר המבקשים
  const sevRank = { blocker:0, usability:1, enhancement:2 };
  const closed = s => s === 'done' || s === 'declined';
  items.sort((a, b) => closed(a.status) - closed(b.status) || b.votes - a.votes || sevRank[a.severity] - sevRank[b.severity]);
  const agentOpts = csmAgentOptions();
  host.innerHTML = `
    <form class="csm-form" id="csmFbForm">
      <div class="field"><label for="csmFbNewTitle">בקשה או חיכוך חדש</label>
        <input type="text" id="csmFbNewTitle" maxlength="160" required placeholder="מה ביקשו, במשפט אחד"></div>
      <div class="field"><label for="csmFbNewDesc">פירוט</label><textarea id="csmFbNewDesc" rows="2"></textarea></div>
      <div class="csm-fb-row">
        <select id="csmFbNewAgent" aria-label="מי ביקש/ה"><option value="">מי ביקש/ה?</option>${agentOpts}</select>
        <select id="csmFbNewCategory" aria-label="סוג">${Object.entries(CSM_FB_CATEGORY).map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</select>
        <select id="csmFbNewSeverity" aria-label="חומרה">${Object.entries(CSM_FB_SEVERITY).map(([k, l]) => `<option value="${k}"${k === 'usability' ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
        <button type="submit" class="btn btn-gold">הוספה</button>
      </div>
    </form>
    ${items.length ? items.map(f => `
      <article class="csm-fb${closed(f.status) ? ' is-closed' : ''}">
        <div class="csm-fb-head">
          <strong>${escapeHtml(f.title)}</strong>
          <span class="csm-votes${f.votes >= 3 ? ' hot' : ''}">ביקשו ${f.votes}</span>
        </div>
        <div class="csm-card-meta">${escapeHtml(CSM_FB_CATEGORY[f.category] || '')} · ${escapeHtml(CSM_FB_SEVERITY[f.severity] || '')} · ${escapeHtml(csmFmtDate(f.created_at))}</div>
        ${f.description ? `<p class="csm-fb-desc">${escapeHtml(f.description)}</p>` : ''}
        ${f.votes ? `<div class="csm-fb-who">${(f.csm_feedback_votes || []).map(v => escapeHtml(names[v.agent_id] || 'סוכן/ת')).join(' · ')}</div>` : ''}
        <div class="csm-fb-row">
          <select data-csm-fb-status="${escapeHtml(f.id)}" aria-label="סטטוס">${Object.entries(CSM_FB_STATUS).map(([k, l]) => `<option value="${k}"${k === f.status ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
          <select data-csm-fb-vote="${escapeHtml(f.id)}" aria-label="הוספת סוכן/ת שביקש/ה"><option value="">+ סוכן/ת שביקש/ה</option>${agentOpts}</select>
        </div>
      </article>`).join('') : '<div class="empty-state">אין עדיין בקשות. בקשה מפגישה נכנסת לכאן מעצמה.</div>'}`;
}

function csmAgentOptions(){
  return csmRows.slice().sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), 'he'))
    .map(r => `<option value="${escapeHtml(r.agent_id)}">${escapeHtml(r.display_name || 'ללא שם')}${r.agency_name ? ' - ' + escapeHtml(r.agency_name) : ''}</option>`).join('');
}

/* ---------- סיפורי הצלחה ---------- */
async function csmLoadStories(){
  const host = document.getElementById('csmBody');
  const { data, error } = await sb.from('csm_success_stories').select('*').order('created_at', { ascending:false }).limit(200);
  if (csmTab !== 'stories') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  const by = Object.fromEntries(csmRows.map(r => [r.agent_id, r]));
  host.innerHTML = `
    <form class="csm-form" id="csmStoryForm">
      <div class="field"><label for="csmStAgent">סוכן/ת</label>
        <select id="csmStAgent" required><option value="">בחירה</option>${csmAgentOptions()}</select></div>
      <div class="field"><label for="csmStQuote">ציטוט</label><textarea id="csmStQuote" rows="2" maxlength="1000"></textarea></div>
      <div class="field"><label for="csmStMetrics">מדד</label><input type="text" id="csmStMetrics" maxlength="300" placeholder="למשל: חוסך/ת 4 שעות בשבוע"></div>
      <div class="csm-fb-row">
        <div class="field"><label for="csmStBefore">לפני</label><textarea id="csmStBefore" rows="2" maxlength="1000"></textarea></div>
        <div class="field"><label for="csmStAfter">אחרי</label><textarea id="csmStAfter" rows="2" maxlength="1000"></textarea></div>
      </div>
      <label class="csm-opt"><input type="checkbox" id="csmStShare"> <span>יש הסכמה לפרסם בשם</span></label>
      <button type="submit" class="btn btn-gold">שמירה</button>
    </form>
    ${(data || []).map(s => {
      const a = by[s.agent_id] || {};
      return `<article class="csm-story">
        <div class="csm-fb-head"><strong>${escapeHtml(a.display_name || 'סוכן/ת')}${a.agency_name ? ' · ' + escapeHtml(a.agency_name) : ''}</strong>
          <span class="csm-tag ${s.permission_to_share ? 'seen' : ''}">${s.permission_to_share ? 'מותר לפרסם' : 'פנימי בלבד'}</span></div>
        ${s.quote ? `<blockquote>"${escapeHtml(s.quote)}"</blockquote>` : ''}
        ${s.metrics ? `<div class="csm-card-goal">📈 ${escapeHtml(s.metrics)}</div>` : ''}
        ${s.before_text || s.after_text ? `<div class="csm-ba"><div><b>לפני</b> ${escapeHtml(s.before_text || '-')}</div><div><b>אחרי</b> ${escapeHtml(s.after_text || '-')}</div></div>` : ''}
      </article>`;
    }).join('') || '<div class="empty-state">אין עדיין סיפורי הצלחה.</div>'}`;
}

/* ---------- ספרייה ---------- */
function csmLibraryHtml(){
  const byKey = Object.fromEntries(CSM_WIN.map(w => [w.key, w]));
  const tracks = CSM_LIBRARY.map(t => `
    <article class="csm-lib">
      <h4>${escapeHtml(t.title)}</h4>
      <ul>${t.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      <div class="csm-hint">פקודות לתרגול: ${t.cmds.map(k => escapeHtml(byKey[k].label.split(':')[0])).join(' · ')}</div>
    </article>`).join('');
  const cmds = CSM_WIN.map(w => {
    const gab = typeof ASSISTANT_WA_NUMBER !== 'undefined' ? ASSISTANT_WA_NUMBER : '';
    return `<div class="csm-cmd" data-csm-cmd-text="${escapeHtml((w.label + ' ' + w.cmd).toLowerCase())}">
      <div class="csm-cmd-label">${escapeHtml(w.label.split(':')[0])}</div>
      <code>${escapeHtml(w.cmd)}</code>
      <div class="csm-cmd-actions">
        <button type="button" class="btn btn-ghost" data-csm-copy="${escapeHtml(w.cmd)}">העתקה</button>
        ${gab ? `<a class="btn btn-ghost" href="https://wa.me/${gab}?text=${encodeURIComponent(w.cmd)}" target="_blank" rel="noopener noreferrer" aria-label="פתיחה בוואטסאפ מול גבריאלה (נפתח בלשונית חדשה)">פתיחה מול גבריאלה</a>` : ''}
      </div></div>`;
  }).join('');
  return `<div class="csm-lib-grid">${tracks}</div>
    <h4 class="csm-sub">קטלוג פקודות לגבריאלה</h4>
    <input type="search" class="csm-search" id="csmCmdSearch" placeholder="חיפוש פקודה" aria-label="חיפוש פקודה">
    <div id="csmCmdList">${cmds}</div>`;
}

/* ---------- שעון ישראל ----------
   כל מועד ביומן נשמר ב-UTC ומוצג בשעון ישראל, גם כשהמחשב שלה בחו"ל. אותו חישוב
   של ilLocalToIso ב-csm-tools.ts (שני סבבים, בגלל המעבר לשעון קיץ/חורף). */
const CSM_TZ = 'Asia/Jerusalem';
function csmIlDate(ms){
  return new Intl.DateTimeFormat('en-CA', { timeZone:CSM_TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(ms));
}
function csmIlTime(ms){
  return new Intl.DateTimeFormat('en-GB', { timeZone:CSM_TZ, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(ms));
}
function csmIlOffset(ms){
  const p = new Intl.DateTimeFormat('en-US', { timeZone:CSM_TZ, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit' }).formatToParts(new Date(ms));
  const g = t => Number((p.find(x => x.type === t) || {}).value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms) / 60000);
}
function csmIlToIso(date, time){
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!dm || !tm) return null;
  const naive = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  let utc = naive - csmIlOffset(naive) * 60000;
  utc = naive - csmIlOffset(utc) * 60000;
  return new Date(utc).toISOString();
}
function csmIlDayLabel(date){
  const ms = Date.parse(date + 'T12:00:00Z');
  const today = csmIlDate(Date.now()), tomorrow = csmIlDate(Date.now() + 86400000);
  const name = new Date(ms).toLocaleDateString('he-IL', { timeZone:'UTC', weekday:'long', day:'numeric', month:'numeric' });
  return date === today ? 'היום · ' + name : date === tomorrow ? 'מחר · ' + name : name;
}

/* ---------- הפרופיל ----------
   נטען פעם אחת (csm_profile_get) - ברירות המחדל של היומן והלשונית "הגדרות". */
let csmProfile = null;
async function csmLoadProfile(force){
  if (!csmCtx().isStaff) return null;
  if (csmProfile && !force) return csmProfile;
  const { data, error } = await sb.rpc('csm_profile_get');
  if (!error) csmProfile = data;
  return csmProfile;
}

/* ---------- יומן Google ----------
   החיבור (csm_calendar_connections, שלה בלבד). מחובר - הפגישות עוברות לבד
   (google-calendar-sync?scope=csm), ובמקום כפתור התבנית מוצג מצב הסנכרון.
   החיבור והניתוק דרך csm-workspace (gcal_start / gcal_disconnect). */
let csmGcal = null;
async function csmLoadGcal(){
  if (!csmCtx().isStaff) return null;
  const { data } = await sb.from('csm_calendar_connections')
    .select('status,google_email,scopes,last_error,last_sync_at').eq('staff_id', csmCtx().staffId).maybeSingle();
  csmGcal = data || null;
  return csmGcal;
}
function csmGcalOn(){ return !!(csmGcal && csmGcal.status === 'active'); }

// התשובה מ-Google (google-calendar-callback → /csm?tab=settings&gcal=...)
const CSM_GCAL_RESULT = {
  connected:'יומן Google חובר. הפגישות שלך יופיעו שם ביומן "שוק נדל״ן".',
  connected_no_freebusy:'יומן Google חובר, בלי הרשאת "פנוי/תפוס" - גבריאלה לא תדע מתי היומן האישי שלך תפוס.',
  denied:'החיבור ליומן Google בוטל.', scope_missing:'בלי ההרשאה לנהל את יומן "שוק נדל״ן" אין מה לחבר. אפשר לנסות שוב ולסמן אותה.',
  expired:'עבר יותר מדי זמן מהלחיצה. אפשר לנסות שוב.', not_configured:'החיבור ליומן Google עוד לא הוגדר במערכת.',
  error:'החיבור ליומן Google נכשל. אפשר לנסות שוב.',
};
function csmGcalReturn(code){
  if (code) showToast(CSM_GCAL_RESULT[code] || CSM_GCAL_RESULT.error, 7000);
}

async function csmGcalConnect(btn){
  btn.disabled = true;
  const r = await csmApi({ action:'gcal_start' });
  if (r.error || !r.url){ btn.disabled = false; showToast(r.detail || ('לא הצלחנו לפתוח את החיבור: ' + heErr({ code:r.error, message:r.error }))); return; }
  location.href = r.url;
}
async function csmGcalDisconnect(btn){
  if (!confirm('לנתק את יומן Google? יומן "שוק נדל״ן" יימחק מהחשבון שלך ב-Google, והפגישות כאן יישארו.')) return;
  btn.disabled = true;
  const r = await csmApi({ action:'gcal_disconnect' });
  if (r.error){ btn.disabled = false; showToast('הניתוק נכשל: ' + heErr({ code:r.error, message:r.error })); return; }
  showToast('יומן Google נותק');
  csmLoadSettings();
}

function csmGcalHtml(){
  const g = csmGcal;
  const on = csmGcalOn();
  const fb = on && (g.scopes || []).some(s => /calendar\.freebusy/.test(s));
  return `<h4 class="csm-sub">יומן Google</h4>
    <div class="csm-gcal${on ? ' is-on' : ''}">
      ${on ? `<p><strong>מחובר${g.google_email ? ': <span dir="ltr">' + escapeHtml(g.google_email) + '</span>' : ''}</strong></p>
        <p class="csm-hint">כל פגישה שתקבעי כאן או דרך גבריאלה מופיעה ביומן "שוק נדל״ן" בחשבון שלך, וגם הזזה וביטול עוברים לשם.${fb ? ' גבריאלה רואה מתי היומן האישי שלך תפוס (פנוי/תפוס בלבד, בלי פרטים) ותגיד כשפגישה חדשה נופלת על זמן תפוס.' : ''}${g.last_sync_at ? ' סנכרון אחרון: ' + escapeHtml(new Date(g.last_sync_at).toLocaleString('he-IL', { timeZone:CSM_TZ, day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' })) + '.' : ''}</p>
        <button type="button" class="btn btn-ghost" data-csm-gcal-off>ניתוק</button>`
      : `${g && g.status === 'error' ? `<p class="csm-hint csm-risk-txt">${escapeHtml(g.last_error || 'החיבור נפל. צריך לחבר מחדש.')}</p>` : ''}
        <p class="csm-hint">גבריאלה מסדרת לך את הפגישות ביומן: כל פגישה עוברת לבד ליומן Google, עם הזזה וביטול, ולפני כל פגישה חדשה היא בודקת שהשעה פנויה אצלך.</p>
        <button type="button" class="btn btn-gold" data-csm-gcal-on>📅 חיבור מאובטח ל-Google Calendar</button>
        <p class="csm-hint">הסנכרון מתבצע רק עבור הפגישות שנוצרות באזור ההטמעה. מהיומן האישי רואים רק פנוי/תפוס - בלי כותרות ובלי משתתפים.</p>`}
    </div>`;
}

/* ---------- היומן ----------
   הפגישות שלה (csm_agenda, ‏staff_id = היא), שבועיים מ-csmAgendaFrom, ולצדן מי
   שמועד הקשר שלו/ה בצנרת נופל בטווח ואין לו/ה פגישה. פגישה עם מי שעוד "נרשם/ה"
   מעבירה ל"נקבעה פגישה" (טריגר במסד). התזכורת יוצאת מ-csm_notify_run. */
const CSM_AG_KIND = { first_win:'פגישת הצלחה ראשונה', followup:'פגישת מעקב', call:'שיחה',
  office_visit:'ביקור במשרד', training:'הדרכה', other:'פגישה' };
const CSM_AG_STATUS = { scheduled:'מתוכננת', done:'התקיימה', cancelled:'בוטלה', no_show:'לא הגיע/ה' };
const CSM_AG_DAYS = 14;
let csmAgenda = [];
let csmAgendaFrom = null;      // YYYY-MM-DD בשעון ישראל
let csmAgendaEdit = null;      // null | 'new' | id
let csmAgendaPreset = null;    // agent_id לטופס חדש (מהכרטיס בצנרת)

/* "הוספה ליומן Google": קישור תבנית - בלי OAuth ובלי גישה ליומן שלה. אותו
   מבנה של gcalTemplateUrl ב-csm-tools.ts. */
function csmGcalUrl(e, agent){
  const fmt = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(e.starts_at).getTime();
  const details = [agent ? 'עם ' + (agent.display_name || '') + (agent.agency_name ? ' (' + agent.agency_name + ')' : '') : '',
    agent && agent.phone ? 'טלפון: ' + agent.phone : '', e.meeting_url || '', e.notes || ''].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action:'TEMPLATE', text: e.title || CSM_AG_KIND[e.kind] || 'פגישה',
    dates: fmt(start) + '/' + fmt(start + (e.duration_minutes || 45) * 60000), ctz:CSM_TZ });
  if (details) q.set('details', details.slice(0, 1200));
  if (e.location || e.meeting_url) q.set('location', e.location || e.meeting_url);
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}

async function csmLoadAgenda(){
  const host = document.getElementById('csmBody');
  if (!csmAgendaFrom) csmAgendaFrom = csmIlDate(Date.now());
  const fromIso = csmIlToIso(csmAgendaFrom, '00:00');
  const toIso = new Date(new Date(fromIso).getTime() + CSM_AG_DAYS * 86400000).toISOString();
  const staffId = csmCtx().staffId;
  const [{ data, error }] = await Promise.all([
    sb.from('csm_agenda').select('*').eq('staff_id', staffId)
      .gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at').limit(300),
    csmLoadProfile(),
    csmLoadGcal(),
  ]);
  if (csmTab !== 'agenda') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  csmAgenda = data || [];
  host.innerHTML = csmAgendaHtml(toIso);
  if (csmAgendaEdit){ const f = document.getElementById('csmAgendaForm'); if (f) f.scrollIntoView({ block:'start' }); }
}

function csmAgendaHtml(toIso){
  const byAgent = Object.fromEntries(csmRows.map(r => [r.agent_id, r]));
  const days = new Map();
  csmAgenda.forEach(e => {
    const d = csmIlDate(new Date(e.starts_at).getTime());
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(e);
  });
  const booked = new Set(csmAgenda.filter(e => e.status === 'scheduled' && e.agent_id).map(e => e.agent_id));
  const due = csmRows.filter(r => r.next_followup_at && r.stage !== 'champion' && !booked.has(r.agent_id)
    && new Date(r.next_followup_at).getTime() < new Date(toIso).getTime())
    .sort((a, b) => new Date(a.next_followup_at) - new Date(b.next_followup_at)).slice(0, 30);
  const today = csmIlDate(Date.now());
  const ev = e => {
    const a = e.agent_id ? byAgent[e.agent_id] : null;
    const ms = new Date(e.starts_at).getTime();
    const live = e.status === 'scheduled';
    return `<article class="csm-ev${live ? '' : ' is-closed'}">
      <div class="csm-ev-time">${escapeHtml(csmIlTime(ms))}<small>${e.duration_minutes || 45} דק'</small></div>
      <div class="csm-ev-main">
        <div class="csm-fb-head"><strong>${escapeHtml(e.title || CSM_AG_KIND[e.kind] || 'פגישה')}</strong>
          <span class="csm-tag ${e.status === 'done' ? 'seen' : live ? '' : 'rec'}">${escapeHtml(CSM_AG_STATUS[e.status] || e.status)}</span></div>
        <div class="csm-card-meta">${escapeHtml(CSM_AG_KIND[e.kind] || '')}${a ? ' · ' + escapeHtml(a.display_name || '') + (a.agency_name ? ' · ' + escapeHtml(a.agency_name) : '') : ''}${e.location ? ' · ' + escapeHtml(e.location) : ''}</div>
        ${e.notes ? `<p class="csm-fb-desc">${escapeHtml(e.notes)}</p>` : ''}
        <div class="csm-card-actions">
          ${e.meeting_url && live ? `<a class="btn btn-gold" href="${escapeHtml(e.meeting_url)}" target="_blank" rel="noopener noreferrer" aria-label="כניסה לפגישה (נפתח בלשונית חדשה)">כניסה לפגישה</a>` : ''}
          ${a && a.phone && live ? `<a class="btn btn-call" href="tel:${escapeHtml(a.phone)}" aria-label="התקשרות ל${escapeHtml(a.display_name || 'סוכן/ת')}">📞</a>
            <a class="btn btn-ghost" href="https://wa.me/${escapeHtml(csmWaDigits(a.phone))}" target="_blank" rel="noopener noreferrer" aria-label="וואטסאפ ל${escapeHtml(a.display_name || 'סוכן/ת')} (נפתח בלשונית חדשה)">וואטסאפ</a>` : ''}
          ${live && !csmGcalOn() ? `<a class="btn btn-ghost" href="${escapeHtml(csmGcalUrl(e, a))}" target="_blank" rel="noopener noreferrer" aria-label="הוספה ליומן Google (נפתח בלשונית חדשה)">📅 ליומן Google</a>` : ''}
          ${csmGcalOn() && e.google_sync_state === 'error' ? `<span class="csm-tag rec" title="${escapeHtml(e.google_sync_error || '')}">לא עבר ל-Google</span>` : ''}
          ${csmGcalOn() && e.google_sync_state === 'synced' && live ? '<span class="csm-tag seen">ביומן Google</span>' : ''}
          ${live ? `<button type="button" class="btn btn-ghost" data-csm-ev-status="${escapeHtml(e.id)}" data-status="done">התקיימה</button>
            <button type="button" class="btn btn-ghost" data-csm-ev-status="${escapeHtml(e.id)}" data-status="no_show">לא הגיע/ה</button>
            <button type="button" class="btn btn-ghost" data-csm-ev-status="${escapeHtml(e.id)}" data-status="cancelled">ביטול</button>`
            : `<button type="button" class="btn btn-ghost" data-csm-ev-status="${escapeHtml(e.id)}" data-status="scheduled">החזרה ליומן</button>`}
          ${e.status === 'done' && a ? `<button type="button" class="btn btn-gold" data-csm-session="${escapeHtml(a.agent_id)}">רישום הפגישה</button>` : ''}
          <button type="button" class="btn btn-ghost" data-csm-ev-edit="${escapeHtml(e.id)}">עריכה</button>
        </div>
      </div>
    </article>`;
  };
  const list = [...days.entries()].map(([d, evs]) => `<section class="csm-day${d === today ? ' is-today' : ''}">
      <h4>${escapeHtml(csmIlDayLabel(d))} <span>${evs.filter(e => e.status === 'scheduled').length}</span></h4>${evs.map(ev).join('')}</section>`).join('');
  return `<div class="csm-toolbar csm-ag-nav">
      <button type="button" class="btn btn-ghost" data-csm-ag-move="-7" aria-label="שבוע קודם">→</button>
      <button type="button" class="btn btn-ghost" data-csm-ag-move="0">היום</button>
      <button type="button" class="btn btn-ghost" data-csm-ag-move="7" aria-label="שבוע הבא">←</button>
      <span class="csm-hint">${escapeHtml(csmIlDayLabel(csmAgendaFrom))} ועד שבועיים</span>
      <button type="button" class="btn btn-gold" data-csm-ev-new="">+ פגישה חדשה</button>
    </div>
    ${csmAgendaEdit ? csmAgendaFormHtml() : ''}
    ${list || '<div class="empty-state">אין פגישות בטווח הזה.</div>'}
    ${due.length ? `<h4 class="csm-sub">מועד קשר בלי פגישה (${due.length})</h4>
      ${due.map(r => `<div class="csm-staff-row"><div><strong>${escapeHtml(r.display_name || 'ללא שם')}</strong>
        <div class="csm-card-meta">${escapeHtml(r.agency_name || '')} · ${escapeHtml(csmIlDayLabel(csmIlDate(new Date(r.next_followup_at).getTime())))}${new Date(r.next_followup_at) < Date.now() ? ' · <strong class="csm-risk-txt">עבר</strong>' : ''}</div></div>
        <div class="csm-staff-btns">${r.phone ? `<a class="btn btn-call" href="tel:${escapeHtml(r.phone)}" aria-label="התקשרות ל${escapeHtml(r.display_name || 'סוכן/ת')}">📞</a>` : ''}
          <button type="button" class="btn btn-ghost" data-csm-ev-new="${escapeHtml(r.agent_id)}">קביעת פגישה</button></div></div>`).join('')}` : ''}
    <p class="csm-hint">התזכורת לפני כל פגישה יוצאת בפעמון ובוואטסאפ (כמה דקות לפני - בהגדרות). אפשר גם לבקש מגבריאלה: "תקבעי לי פגישה עם יוסי ביום שלישי ב-10:00".
      ${csmGcalOn() ? 'הפגישות עוברות לבד ליומן Google שלך.' : '<button type="button" class="btn btn-ghost btn-sm" data-csm-tab="settings">חיבור ליומן Google</button>'}</p>`;
}

function csmAgendaFormHtml(){
  const e = csmAgendaEdit === 'new' ? null : csmAgenda.find(x => x.id === csmAgendaEdit);
  const p = csmProfile || {};
  const ms = e ? new Date(e.starts_at).getTime() : null;
  const agentId = e ? e.agent_id : csmAgendaPreset;
  const kind = e ? e.kind : (agentId ? ((csmRows.find(r => r.agent_id === agentId) || {}).sessions ? 'followup' : 'first_win') : 'followup');
  const rem = e && e.reminder_minutes != null ? String(e.reminder_minutes) : '';
  const remOpts = [['', 'ברירת המחדל שלי (' + (p.reminder_minutes != null ? p.reminder_minutes + ' דק\')' : '30 דק\')')],
    ['0', 'בלי תזכורת'], ['10', '10 דקות לפני'], ['30', '30 דקות לפני'], ['60', 'שעה לפני'], ['120', 'שעתיים לפני'], ['1440', 'יום לפני']];
  return `<form class="csm-form" id="csmAgendaForm">
    <h4 class="csm-sub" style="margin-top:0">${e ? 'עריכת פגישה' : 'פגישה חדשה'}</h4>
    <div class="csm-fb-row">
      <div class="field"><label for="csmAgAgent">עם מי</label><select id="csmAgAgent"><option value="">בלי סוכן/ת (הדרכה, משרד חדש)</option>${csmAgentOptions().replace(`value="${escapeHtml(agentId || '')}"`, `value="${escapeHtml(agentId || '')}" selected`)}</select></div>
      <div class="field"><label for="csmAgKind">סוג</label><select id="csmAgKind">${Object.entries(CSM_AG_KIND).map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>
    </div>
    <div class="csm-fb-row">
      <div class="field"><label for="csmAgDate">תאריך</label><input type="date" id="csmAgDate" required value="${escapeHtml(ms ? csmIlDate(ms) : csmIlDate(Date.now() + 86400000))}"></div>
      <div class="field"><label for="csmAgTime">שעה</label><input type="time" id="csmAgTime" required value="${escapeHtml(ms ? csmIlTime(ms) : '10:00')}"></div>
      <div class="field"><label for="csmAgDur">אורך (דקות)</label><input type="number" id="csmAgDur" min="5" max="600" step="5" value="${escapeHtml(String(e ? e.duration_minutes : (p.meeting_minutes || 45)))}"></div>
    </div>
    <div class="field"><label for="csmAgTitle">כותרת (לא חובה)</label><input type="text" id="csmAgTitle" maxlength="200" value="${escapeHtml(e ? e.title || '' : '')}" placeholder="ריק = לפי הסוג והשם"></div>
    <div class="csm-fb-row">
      <div class="field"><label for="csmAgLoc">איפה</label><input type="text" id="csmAgLoc" maxlength="300" value="${escapeHtml(e ? e.location || '' : '')}" placeholder="כתובת המשרד, טלפון, זום"></div>
      <div class="field"><label for="csmAgUrl">קישור לפגישה</label><input type="url" id="csmAgUrl" dir="ltr" maxlength="500" value="${escapeHtml(e ? e.meeting_url || '' : (p.meeting_link || ''))}" placeholder="https://"></div>
    </div>
    <div class="field"><label for="csmAgRem">תזכורת</label><select id="csmAgRem">${remOpts.map(([v, l]) => `<option value="${v}"${v === rem ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></div>
    <div class="field"><label for="csmAgNotes">הערות</label><textarea id="csmAgNotes" rows="2" maxlength="4000">${escapeHtml(e ? e.notes || '' : '')}</textarea></div>
    <div class="csm-card-actions">
      <button type="submit" class="btn btn-gold">${e ? 'שמירת השינויים' : 'קביעת הפגישה'}</button>
      <button type="button" class="btn btn-ghost" data-csm-ev-cancel>ביטול</button>
      ${e ? `<button type="button" class="btn btn-ghost" data-csm-ev-del="${escapeHtml(e.id)}">מחיקה</button>` : ''}
    </div>
  </form>`;
}

async function csmSaveAgenda(){
  const v = id => (document.getElementById(id).value || '').trim();
  const iso = csmIlToIso(v('csmAgDate'), v('csmAgTime'));
  if (!iso) throw { message:'צריך תאריך ושעה.' };
  const editing = csmAgendaEdit !== 'new' ? csmAgenda.find(x => x.id === csmAgendaEdit) : null;
  if (!editing && new Date(iso).getTime() < Date.now() - 5 * 60000) throw { message:'המועד כבר עבר. כדאי לבחור יום ושעה בעתיד.' };
  const url = v('csmAgUrl');
  if (url && !/^https?:\/\//i.test(url)) throw { message:'הקישור לפגישה צריך להתחיל ב-https://' };
  const agentId = v('csmAgAgent') || null;
  const kind = v('csmAgKind');
  const agent = agentId ? csmRows.find(r => r.agent_id === agentId) : null;
  const row = {
    agent_id: agentId, kind,
    title: v('csmAgTitle') || (CSM_AG_KIND[kind] + (agent && agent.display_name ? ' - ' + agent.display_name : '')),
    starts_at: iso,
    duration_minutes: Math.min(600, Math.max(5, Number(v('csmAgDur')) || 45)),
    location: v('csmAgLoc') || null, meeting_url: url || null,
    reminder_minutes: v('csmAgRem') === '' ? null : Number(v('csmAgRem')),
    notes: v('csmAgNotes') || null,
  };
  const { error } = editing
    ? await sb.from('csm_agenda').update(row).eq('id', editing.id)
    : await sb.from('csm_agenda').insert(Object.assign({ staff_id: csmCtx().staffId }, row));
  if (error) throw error;
  csmAgendaEdit = null;
  csmAgendaPreset = null;
  // פגישה מחוץ לטווח המוצג - הטווח זז אליה, כדי שתראה מה נשמר
  const day = csmIlDate(new Date(iso).getTime());
  const end = csmIlDate(new Date(csmIlToIso(csmAgendaFrom, '00:00')).getTime() + CSM_AG_DAYS * 86400000);
  if (day < csmAgendaFrom || day >= end) csmAgendaFrom = day;
  showToast(editing ? 'הפגישה עודכנה' : 'הפגישה נקבעה. התזכורת תגיע לפניה.');
}

/* ---------- ההתראות ----------
   הפעמון שלה (csm_notifications, נקראת רק שלה ב-RLS). נכתבות במסד בלבד -
   csm_notify_run ו-csm_calls_notify - ונשלחות לוואטסאפ לפי ההגדרות. */
const CSM_NOTIF_KIND = { new_agent:'סוכן/ת חדש/ה', at_risk:'5 ימים בלי גבריאלה', meeting_reminder:'תזכורת לפגישה',
  call_ready:'שיחות והקלטות', daily_digest:'סיכום הבוקר' };
const CSM_NOTIF_ICON = { new_agent:'🆕', at_risk:'⚠', meeting_reminder:'⏰', call_ready:'🎙', daily_digest:'☀' };
let csmNotifs = [];
let csmUnread = 0;
let csmUnreadTimer = null;

function csmPaintUnread(){
  const b = document.getElementById('csmBellCount');
  if (b){ b.textContent = csmUnread > 99 ? '99+' : String(csmUnread); b.hidden = !csmUnread; }
  const t = document.querySelector('[data-csm-tab="notifications"]');
  if (t) t.textContent = 'התראות' + (csmUnread ? ' (' + csmUnread + ')' : '');
}

async function csmRefreshUnread(){
  if (!csmCtx().isStaff) return;
  const { count, error } = await sb.from('csm_notifications').select('id', { count:'exact', head:true })
    .eq('staff_id', csmCtx().staffId).is('read_at', null);
  if (!error){ csmUnread = count || 0; csmPaintUnread(); }
  clearTimeout(csmUnreadTimer);
  csmUnreadTimer = setTimeout(csmRefreshUnread, 60000);
}

async function csmLoadNotifs(){
  const host = document.getElementById('csmBody');
  const { data, error } = await sb.from('csm_notifications')
    .select('id,kind,title,body,agent_id,call_id,event_id,read_at,wa_state,wa_error,created_at')
    .eq('staff_id', csmCtx().staffId).order('created_at', { ascending:false }).limit(80);
  if (csmTab !== 'notifications') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  csmNotifs = data || [];
  csmUnread = csmNotifs.filter(n => !n.read_at).length;
  csmPaintUnread();
  const wa = n => n.wa_state === 'sent' ? 'נשלחה בוואטסאפ' : n.wa_state === 'failed' ? 'לא נשלחה בוואטסאפ' : n.wa_state === 'pending' ? 'ממתינה לוואטסאפ (שעות שקט)' : '';
  host.innerHTML = `<div class="csm-toolbar">
      <span class="csm-hint" style="flex:1">${csmUnread ? csmUnread + ' שלא נקראו' : 'הכול נקרא'}</span>
      ${csmUnread ? '<button type="button" class="btn btn-ghost" data-csm-notif-all>סימון הכול כנקרא</button>' : ''}
      <button type="button" class="btn btn-ghost" data-csm-tab="settings">מה מקבלים ואיך</button>
    </div>
    ${csmNotifs.map(n => `<article class="csm-notif${n.read_at ? '' : ' is-unread'}">
      <div class="csm-fb-head"><strong>${CSM_NOTIF_ICON[n.kind] || '•'} ${escapeHtml(n.title)}</strong>
        <span class="csm-card-meta">${escapeHtml(new Date(n.created_at).toLocaleString('he-IL', { timeZone:CSM_TZ, day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' }))}</span></div>
      ${n.body ? `<p class="csm-fb-desc">${escapeHtml(n.body)}</p>` : ''}
      <div class="csm-card-actions">
        ${n.event_id ? `<button type="button" class="btn btn-ghost" data-csm-notif-go="agenda" data-id="${escapeHtml(n.id)}">ליומן</button>` : ''}
        ${n.call_id ? `<button type="button" class="btn btn-ghost" data-csm-notif-go="calls" data-call="${escapeHtml(n.call_id)}" data-id="${escapeHtml(n.id)}">להקלטה</button>` : ''}
        ${n.agent_id && !n.event_id ? `<button type="button" class="btn btn-ghost" data-csm-notif-go="pipeline" data-agent="${escapeHtml(n.agent_id)}" data-id="${escapeHtml(n.id)}">לכרטיס</button>
          <button type="button" class="btn btn-ghost" data-csm-ev-new="${escapeHtml(n.agent_id)}" data-id="${escapeHtml(n.id)}">קביעת פגישה</button>` : ''}
        ${!n.read_at ? `<button type="button" class="btn btn-ghost" data-csm-notif-read="${escapeHtml(n.id)}">נקרא</button>` : ''}
        ${wa(n) ? `<span class="csm-card-meta">${escapeHtml(wa(n))}</span>` : ''}
      </div>
    </article>`).join('') || '<div class="empty-state">עוד אין התראות. כאן יופיעו תזכורות לפגישות, סוכנים חדשים, מי שעבר/ה 5 ימים בלי גבריאלה וסיכום הבוקר.</div>'}`;
}

async function csmMarkRead(ids){
  const { error } = await sb.rpc('csm_notifications_read', { p_ids: ids || null });
  if (error){ showToast('לא נשמר: ' + heErr(error)); return; }
  csmNotifs.forEach(n => { if (!ids || ids.includes(n.id)) n.read_at = n.read_at || new Date().toISOString(); });
  csmUnread = csmNotifs.filter(n => !n.read_at).length;
  csmPaintUnread();
}

/* ---------- ההגדרות ----------
   csm_profile_save: שם, נייד (לגבריאלה - נדחה אם הוא של סוכן/ת), ההתראות, סיכום
   הבוקר, ימי עבודה, שעות שקט, ברירות המחדל של היומן וקישור קבוע לפגישות. המייל
   נעול: הוא מפתח ההזמנה. */
const CSM_PROFILE_ERR = {
  bad_name:'צריך שם.', bad_phone:'הנייד אינו תקין.',
  phone_is_agent:'הנייד הזה רשום לסוכן/ת במערכת. גבריאלה מזהה סוכנים קודם, ולכן צריך נייד אחר.',
  phone_taken:'הנייד הזה כבר רשום לאשת צוות אחרת.', bad_time:'שעה צריכה להיות בפורמט 08:30.',
  bad_minutes:'מספר הדקות מחוץ לטווח.', bad_link:'הקישור הקבוע צריך להתחיל ב-https://', bad_days:'ימי העבודה אינם תקינים.',
};
const CSM_DOW = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\''];

async function csmLoadSettings(){
  const host = document.getElementById('csmBody');
  const [p, , lineRes] = await Promise.all([csmLoadProfile(true), csmLoadGcal(),
    sb.from('csm_phone_lines').select('twilio_number,forward_to').eq('staff_id', csmCtx().staffId).eq('active', true).maybeSingle()]);
  if (csmTab !== 'settings') return;
  const line = lineRes && lineRes.data;
  if (!p){ host.innerHTML = '<div class="empty-state">לא הצלחנו לטעון את ההגדרות. כדאי לרענן.</div>'; return; }
  const off = new Set(p.notify_off || []);
  const days = new Set((p.work_days || []).map(Number));
  host.innerHTML = `<form class="csm-form" id="csmSettingsForm">
    <h4 class="csm-sub" style="margin-top:0">הפרופיל</h4>
    <div class="csm-fb-row">
      <div class="field"><label for="csmPfName">שם</label><input type="text" id="csmPfName" maxlength="120" required value="${escapeHtml(p.display_name || '')}"></div>
      <div class="field"><label for="csmPfPhone">נייד (לגבריאלה)</label><input type="tel" id="csmPfPhone" dir="ltr" required value="${escapeHtml(p.phone || '')}"></div>
      <div class="field"><label for="csmPfEmail">מייל (הכניסה עם Google)</label><input type="email" id="csmPfEmail" dir="ltr" readonly value="${escapeHtml(p.email || '')}" title="המייל הוא מפתח ההזמנה. לשינוי - לפנות לתומר"></div>
    </div>
    <p class="csm-hint">גבריאלה מזהה אותך לפי הנייד. אחרי שינוי - לכתוב לה מהנייד החדש.</p>
    ${line ? `<p class="csm-staff-line">📞 המספר הווירטואלי שלך: <strong dir="ltr">${escapeHtml(csmLocalPhone(line.twilio_number))}</strong>.
      שיחות אליו מגיעות ל${line.forward_to ? '<span dir="ltr">' + escapeHtml(csmLocalPhone(line.forward_to)) + '</span>' : 'נייד שלך'} ומוקלטות, והסיכום וההקלטה מגיעים אלייך בוואטסאפ ובלשונית "הקלטות". כדאי לתת אותו לסוכנים במקום הנייד.</p>`
      : '<p class="csm-hint">אין לך עדיין מספר וירטואלי. עם מספר כזה כל שיחה מסוכן/ת מוקלטת, ואת מקבלת סיכום והקלטה בוואטסאפ - לבקש מתומר.</p>'}

    <h4 class="csm-sub">התראות</h4>
    <label class="csm-opt"><input type="checkbox" id="csmPfWa"${p.notify_whatsapp ? ' checked' : ''}> <span>לשלוח לי גם בוואטסאפ (מגבריאלה). בלי הסימון - בפעמון כאן בלבד</span></label>
    <fieldset class="csm-q"><legend>מה לקבל</legend>
      ${Object.entries(CSM_NOTIF_KIND).map(([k, l]) => `<label class="csm-opt"><input type="checkbox" data-csm-pf-kind="${k}"${off.has(k) ? '' : ' checked'}> <span>${CSM_NOTIF_ICON[k]} ${escapeHtml(l)}${k === 'daily_digest' ? ' - פגישות היום, למי לחזור, כמה בסיכון ומי נרשם/ה' : k === 'at_risk' ? ' - ביום שבו הסוכן/ת עובר/ת את הסף' : k === 'call_ready' ? ' - סיכום והקלטה של כל שיחה למספר הווירטואלי, שיחה שלא נענתה, והקלטה שהעלית' : ''}</span></label>`).join('')}
    </fieldset>
    <div class="csm-fb-row">
      <div class="field"><label for="csmPfDigest">שעת סיכום הבוקר</label><input type="time" id="csmPfDigest" value="${escapeHtml(p.digest_time || '08:30')}"></div>
      <div class="field"><label for="csmPfQf">בלי וואטסאפ מ-</label><input type="time" id="csmPfQf" value="${escapeHtml(p.quiet_from || '21:00')}"></div>
      <div class="field"><label for="csmPfQt">עד</label><input type="time" id="csmPfQt" value="${escapeHtml(p.quiet_to || '08:00')}"></div>
    </div>
    <fieldset class="csm-q csm-rate"><legend>ימי עבודה (סיכום הבוקר יוצא רק בהם)</legend>
      ${CSM_DOW.map((l, i) => `<label class="csm-opt"><input type="checkbox" data-csm-pf-day="${i}"${days.has(i) ? ' checked' : ''}> <span>${l}</span></label>`).join('')}
    </fieldset>
    <p class="csm-hint">בשעות השקט ההתראות מחכות ויוצאות בבוקר. תזכורת לפגישה שלך יוצאת גם בהן.
      ${p.whatsapp_window_open ? '' : ` גבריאלה יכולה לכתוב לך חופשי רק 24 שעות אחרי ההודעה האחרונה שלך, ואחר כך - בהודעת תבנית קצרה. <a href="https://wa.me/${escapeHtml(ASSISTANT_WA_NUMBER)}?text=${encodeURIComponent('שלום גבריאלה')}" target="_blank" rel="noopener noreferrer" data-bot>לכתוב לגבריאלה עכשיו</a>`}</p>

    <h4 class="csm-sub">היומן</h4>
    <div class="csm-fb-row">
      <div class="field"><label for="csmPfDur">אורך פגישה (דקות)</label><input type="number" id="csmPfDur" min="10" max="240" step="5" value="${escapeHtml(String(p.meeting_minutes || 45))}"></div>
      <div class="field"><label for="csmPfRem">תזכורת (דקות לפני, 0 = בלי)</label><input type="number" id="csmPfRem" min="0" max="1440" step="5" value="${escapeHtml(String(p.reminder_minutes != null ? p.reminder_minutes : 30))}"></div>
    </div>
    <div class="field"><label for="csmPfLink">קישור קבוע לפגישות וידאו (Zoom / Meet)</label><input type="url" id="csmPfLink" dir="ltr" maxlength="500" value="${escapeHtml(p.meeting_link || '')}" placeholder="https://"></div>
    <button type="submit" class="btn btn-gold">שמירה</button>
  </form>
  <div class="csm-form">${csmGcalHtml()}</div>
  <p class="csm-hint">הכול אפשר גם דרך גבריאלה: "תכבי לי את סיכום הבוקר", "תזכורת שעה לפני כל פגישה", "מה ההגדרות שלי?".</p>`;
}

async function csmSaveSettings(){
  const v = id => (document.getElementById(id).value || '').trim();
  const body = document.getElementById('csmBody');
  const p = {
    display_name: v('csmPfName'), phone: v('csmPfPhone'),
    notify_whatsapp: document.getElementById('csmPfWa').checked,
    notify_off: [...body.querySelectorAll('[data-csm-pf-kind]')].filter(i => !i.checked).map(i => i.dataset.csmPfKind),
    digest_time: v('csmPfDigest'), quiet_from: v('csmPfQf'), quiet_to: v('csmPfQt'),
    work_days: [...body.querySelectorAll('[data-csm-pf-day]')].filter(i => i.checked).map(i => Number(i.dataset.csmPfDay)),
    meeting_minutes: Number(v('csmPfDur')), reminder_minutes: Number(v('csmPfRem')), meeting_link: v('csmPfLink'),
  };
  if (csmProfile && p.phone === (csmProfile.phone || '')) delete p.phone;
  const { data, error } = await sb.rpc('csm_profile_save', { p });
  if (error) throw error;
  if (data && data.error){ showToast(CSM_PROFILE_ERR[data.error] || 'לא נשמר.'); return; }
  csmProfile = data.profile;
  const who = document.getElementById('csmWho');
  if (who && csmProfile && csmProfile.display_name) who.textContent = csmProfile.display_name;
  showToast('ההגדרות נשמרו');
}

// ?tab= מהקישור בהתראה בוואטסאפ (csm-page.js)
function csmSetTab(tab){
  if (['pipeline','offices','mentor','calls','agenda','notifications','settings','feedback','stories','library','staff'].includes(tab)) csmTab = tab;
}

/* ---------- חיבורים ---------- */
(function wireCsm(){
  const acc = document.getElementById('accCsm');
  if (!acc) return;
  acc.addEventListener('toggle', e => { if (e.target.open) loadCsm(); });

  acc.addEventListener('click', e => {
    const tab = e.target.closest('[data-csm-tab]');
    if (tab){ csmTab = tab.dataset.csmTab; csmRender(); return; }
    if (e.target.closest('[data-csm-refresh]')){ loadCsm(true); return; }
    const sf = e.target.closest('[data-csm-stage-filter]');
    if (sf){ csmStage = sf.dataset.csmStageFilter; csmRender(); return; }
    const ses = e.target.closest('[data-csm-session]');
    if (ses){ csmOpenSession(ses.dataset.csmSession); return; }
    const mq = e.target.closest('[data-csm-mq]');
    if (mq){ csmAskMentor(mq.dataset.csmMq); return; }
    const staff = e.target.closest('[data-csm-staff]');
    if (staff){
      staff.disabled = true;
      sb.rpc('csm_staff_set_active', { p_id: staff.dataset.csmStaff, p_active: staff.dataset.on === '1' }).then(({ error }) => {
        if (error){ staff.disabled = false; showToast('לא נשמר: ' + heErr(error)); return; }
        csmLoadStaff();
      });
      return;
    }
    const stEdit = e.target.closest('[data-csm-staff-edit]');
    if (stEdit){
      csmStaffEditId = stEdit.dataset.csmStaffEdit;
      csmLoadStaff().then(() => { const f = document.getElementById('csmStaffForm'); if (f) f.scrollIntoView({ block:'center' }); });
      return;
    }
    if (e.target.closest('[data-csm-staff-cancel]')){ csmStaffEditId = null; csmLoadStaff(); return; }
    const lineBuy = e.target.closest('[data-csm-line-buy]');
    if (lineBuy){
      const staffId = lineBuy.dataset.csmLineBuy;
      const area = (document.querySelector(`[data-csm-line-area="${CSS.escape(staffId)}"]`) || {}).value || '4';
      if (!confirm('לקנות מספר וירטואלי חדש ב-Twilio (קידומת 0' + area + ')? המספר הוא עלות של הפלטפורמה, כ-5.5$ לחודש ועוד הדקות.')) return;
      lineBuy.disabled = true;
      csmTwilio('csm-line-order', { staff_id: staffId, area }).then(r => {
        if (r.error){ lineBuy.disabled = false; showToast(CSM_LINE_ERR[r.error] || 'לא נשמר: ' + heErr({ code:r.error, message:r.error })); return; }
        showToast('נקנה ' + csmLocalPhone(r.number) + '. שיחות אליו מגיעות עכשיו לנייד שלה.');
        csmLoadStaff();
      });
      return;
    }
    const lineOff = e.target.closest('[data-csm-line-off]');
    if (lineOff){
      const bought = lineOff.dataset.bought === '1';
      if (!confirm(bought ? 'לשחרר את המספר ב-Twilio? הוא לא יחזור.' : 'לנתק את המספר ממנה? אם הוא הועבר מהסוכנים - הוא חוזר לשם.')) return;
      lineOff.disabled = true;
      csmTwilio('csm-line-release', { line_id: lineOff.dataset.csmLineOff }).then(r => {
        if (r.error){ lineOff.disabled = false; showToast(CSM_LINE_ERR[r.error] || 'לא נשמר: ' + heErr({ code:r.error, message:r.error })); return; }
        showToast(r.returned_to_agent_line ? 'המספר נותק ממנה וחזר לסוכנים.' : 'המספר שוחרר.');
        csmLoadStaff();
      });
      return;
    }
    // היומן
    const evNew = e.target.closest('[data-csm-ev-new]');
    if (evNew){
      if (evNew.dataset.id) csmMarkRead([evNew.dataset.id]);
      csmAgendaEdit = 'new';
      csmAgendaPreset = evNew.dataset.csmEvNew || null;
      csmTab = 'agenda';
      csmRender();
      return;
    }
    const evEdit = e.target.closest('[data-csm-ev-edit]');
    if (evEdit){ csmAgendaEdit = evEdit.dataset.csmEvEdit; csmLoadAgenda(); return; }
    if (e.target.closest('[data-csm-ev-cancel]')){ csmAgendaEdit = null; csmAgendaPreset = null; csmLoadAgenda(); return; }
    const mv = e.target.closest('[data-csm-ag-move]');
    if (mv){
      const n = Number(mv.dataset.csmAgMove);
      csmAgendaFrom = n ? csmIlDate(new Date(csmIlToIso(csmAgendaFrom || csmIlDate(Date.now()), '12:00')).getTime() + n * 86400000) : csmIlDate(Date.now());
      csmLoadAgenda();
      return;
    }
    const evSt = e.target.closest('[data-csm-ev-status]');
    if (evSt){
      evSt.disabled = true;
      const ev = csmAgenda.find(x => x.id === evSt.dataset.csmEvStatus);
      sb.from('csm_agenda').update({ status: evSt.dataset.status }).eq('id', evSt.dataset.csmEvStatus).then(({ error }) => {
        if (error){ evSt.disabled = false; showToast('לא נשמר: ' + heErr(error)); return; }
        // פגישה שהתקיימה עם סוכן/ת - ישר לרישום מה בוצע, כמו בכרטיס בצנרת
        if (evSt.dataset.status === 'done' && ev && ev.agent_id && (ev.kind === 'first_win' || ev.kind === 'followup')
            && csmRows.some(r => r.agent_id === ev.agent_id)) csmOpenSession(ev.agent_id);
        csmLoadAgenda();
      });
      return;
    }
    const evDel = e.target.closest('[data-csm-ev-del]');
    if (evDel){
      if (!confirm('למחוק את הפגישה מהיומן?')) return;
      sb.from('csm_agenda').delete().eq('id', evDel.dataset.csmEvDel).then(({ error }) => {
        if (error){ showToast('לא נמחק: ' + heErr(error)); return; }
        csmAgendaEdit = null;
        csmLoadAgenda();
      });
      return;
    }
    const gOn = e.target.closest('[data-csm-gcal-on]');
    if (gOn){ csmGcalConnect(gOn); return; }
    const gOff = e.target.closest('[data-csm-gcal-off]');
    if (gOff){ csmGcalDisconnect(gOff); return; }
    // ההתראות
    if (e.target.closest('[data-csm-notif-all]')){ csmMarkRead(null).then(() => csmLoadNotifs()); return; }
    const nr = e.target.closest('[data-csm-notif-read]');
    if (nr){ csmMarkRead([nr.dataset.csmNotifRead]).then(() => csmLoadNotifs()); return; }
    const ng = e.target.closest('[data-csm-notif-go]');
    if (ng){
      csmMarkRead([ng.dataset.id]);
      const go = ng.dataset.csmNotifGo;
      if (go === 'calls') csmCallOpen = ng.dataset.call || null;
      if (go === 'pipeline'){
        const r = csmRows.find(x => x.agent_id === ng.dataset.agent);
        csmFilter = r ? r.display_name || '' : '';
        csmStage = '';
      }
      csmTab = go;
      csmRender();
      return;
    }
    const callBtn = e.target.closest('[data-csm-call]');
    if (callBtn){ csmCallOpen = csmCallOpen === callBtn.dataset.csmCall ? null : callBtn.dataset.csmCall; document.getElementById('csmBody').innerHTML = csmCallsHtml(); return; }
    const retry = e.target.closest('[data-csm-call-retry]');
    if (retry){
      retry.disabled = true;
      csmApi({ action:'analyze_call', call_id: retry.dataset.csmCallRetry }).then(r => {
        if (r.error) showToast('לא הצלחנו להתחיל: ' + heErr({ code:r.error, message:r.error }));
        csmLoadCalls();
      });
      return;
    }
    const del = e.target.closest('[data-csm-call-del]');
    if (del){
      const c = csmCalls.find(x => x.id === del.dataset.csmCallDel);
      if (!c || !confirm('למחוק את ההקלטה, התמלול והסיכום?')) return;
      (async () => {
        if (c.audio_path) await sb.storage.from('csm-calls').remove([c.audio_path]);
        const { error } = await sb.from('csm_calls').delete().eq('id', c.id);
        if (error) showToast('לא נמחק: ' + heErr(error)); else { csmCallOpen = null; csmLoadCalls(); }
      })();
      return;
    }
    const apply = e.target.closest('[data-csm-call-apply]');
    if (apply){
      const c = csmCalls.find(x => x.id === apply.dataset.csmCallApply);
      const a = (c && c.analysis) || {};
      if (!c || !c.agent_id) return;
      const row = csmRows.find(r => r.agent_id === c.agent_id);
      apply.disabled = true;
      csmSetStage(c.agent_id, a.suggested_stage || (row && row.stage) || 'registered',
        a.followup_date ? { next_followup_at: new Date(a.followup_date + 'T10:00:00').toISOString() } : {})
        .then(ok => { if (ok) showToast('עודכן בצנרת'); });
      return;
    }
    const fbBtn = e.target.closest('[data-csm-call-fb]');
    if (fbBtn){
      const c = csmCalls.find(x => x.id === fbBtn.dataset.csmCallFb);
      const f = c && c.analysis && (c.analysis.feedback_items || [])[Number(fbBtn.dataset.i)];
      if (!f) return;
      fbBtn.disabled = true;
      csmAddFeedbackVote(f.title, 'daily_efficiency', f.severity || 'usability', c.agent_id || null, null, null)
        .then(() => showToast('נוסף למשוב ותעדוף'))
        .catch(err => { fbBtn.disabled = false; showToast('לא נשמר: ' + heErr(err)); });
      return;
    }
  });

  acc.addEventListener('change', async e => {
    const st = e.target.closest('[data-csm-stage]');
    if (st){ csmSetStage(st.dataset.csmStage, st.value); return; }
    const mv = e.target.closest('[data-csm-line-move]');
    if (mv && mv.value){
      if (!confirm('להעביר את ' + csmLocalPhone(mv.value) + ' אליה? שיחות אליו יפסיקו להגיע לסוכנים ויגיעו לנייד שלה.')){ mv.value = ''; return; }
      const { data, error } = await sb.rpc('csm_phone_line_assign', { p_staff_id: mv.dataset.csmLineMove, p_number: mv.value, p_forward_to: null });
      if (error || (data && data.error)){ showToast(CSM_LINE_ERR[data && data.error] || 'לא נשמר: ' + heErr(error)); mv.value = ''; return; }
      showToast('המספר הועבר. שיחות אליו מגיעות עכשיו לנייד שלה.');
      csmLoadStaff();
      return;
    }
    const fs = e.target.closest('[data-csm-fb-status]');
    if (fs){
      const { error } = await sb.from('csm_feedback').update({ status: fs.value, updated_at: new Date().toISOString() }).eq('id', fs.dataset.csmFbStatus);
      if (error) showToast('הסטטוס לא נשמר: ' + heErr(error)); else csmLoadFeedback();
      return;
    }
    const ca = e.target.closest('[data-csm-call-agent]');
    if (ca){
      const { error } = await sb.from('csm_calls').update({ agent_id: ca.value || null }).eq('id', ca.dataset.csmCallAgent);
      if (error) showToast('השיוך לא נשמר: ' + heErr(error)); else { const c = csmCalls.find(x => x.id === ca.dataset.csmCallAgent); if (c) c.agent_id = ca.value || null; document.getElementById('csmBody').innerHTML = csmCallsHtml(); }
      return;
    }
    const fv = e.target.closest('[data-csm-fb-vote]');
    if (fv && fv.value){
      const { error } = await sb.from('csm_feedback_votes')
        .upsert({ feedback_id: fv.dataset.csmFbVote, agent_id: fv.value }, { onConflict:'feedback_id,agent_id', ignoreDuplicates:true });
      if (error) showToast('לא נשמר: ' + heErr(error)); else csmLoadFeedback();
    }
  });

  acc.addEventListener('input', e => {
    if (e.target.id === 'csmSearch'){
      csmFilter = e.target.value;
      const pos = e.target.selectionStart;
      csmRender();
      const again = document.getElementById('csmSearch');
      if (again){ again.focus(); again.setSelectionRange(pos, pos); }
    } else if (e.target.id === 'csmCmdSearch'){
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#csmCmdList [data-csm-cmd-text]').forEach(el => { el.hidden = !!q && !el.dataset.csmCmdText.includes(q); });
    }
  });

  acc.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    if (btn) btn.disabled = true;
    try {
      if (e.target.id === 'csmMentorForm'){
        csmAskMentor(document.getElementById('csmMentorQ').value);
        return;
      }
      if (e.target.id === 'csmAgendaForm'){
        await csmSaveAgenda();
        // הטריגר עדכן את השלב ומועד הקשר בצנרת - הסקירה נקראת שוב, והיומן איתה
        loadCsm(true);
        return;
      }
      if (e.target.id === 'csmSettingsForm'){
        await csmSaveSettings();
        return;
      }
      if (e.target.id === 'csmCallForm'){
        if (btn) btn.textContent = 'מעלה…';
        await csmUploadCall();
        csmLoadCalls();
        return;
      }
      if (e.target.id === 'csmStaffForm'){
        const fields = {
          p_email: document.getElementById('csmStEmail').value,
          p_name: document.getElementById('csmStName').value,
          p_phone: document.getElementById('csmStPhone').value,
        };
        const { data, error } = csmStaffEditId
          ? await sb.rpc('csm_staff_update', Object.assign({ p_id: csmStaffEditId }, fields))
          : await sb.rpc('csm_staff_save', fields);
        if (error) throw error;
        if (data && data.error){ showToast(CSM_STAFF_ERR[data.error] || 'לא נשמר.'); return; }
        showToast(data && data.replaced_email
          ? 'המייל בהזמנה תוקן (במקום ' + data.replaced_email + '). עכשיו היא נכנסת ל-shuknadlan.co.il/csm עם Google במייל החדש.'
          : 'נשמר. היא נכנסת ל-shuknadlan.co.il/csm עם Google במייל שבהזמנה.');
        csmStaffEditId = null;
        csmLoadStaff();
        return;
      }
      if (e.target.id === 'csmFbForm'){
        const title = document.getElementById('csmFbNewTitle').value.trim();
        if (!title) return;
        const id = await csmAddFeedbackVote(title, document.getElementById('csmFbNewCategory').value,
          document.getElementById('csmFbNewSeverity').value, document.getElementById('csmFbNewAgent').value || null);
        const desc = document.getElementById('csmFbNewDesc').value.trim();
        if (desc) await sb.from('csm_feedback').update({ description: desc }).eq('id', id).is('description', null);
        showToast('נשמר');
        csmLoadFeedback();
      } else if (e.target.id === 'csmStoryForm'){
        const v = id => document.getElementById(id).value.trim() || null;
        const { error } = await sb.from('csm_success_stories').insert({
          agent_id: document.getElementById('csmStAgent').value,
          quote: v('csmStQuote'), metrics: v('csmStMetrics'), before_text: v('csmStBefore'), after_text: v('csmStAfter'),
          permission_to_share: document.getElementById('csmStShare').checked,
          created_by: csmUserId,
        });
        if (error) throw error;
        showToast('נשמר');
        csmLoadStories();
      }
    } catch (err){
      showToast('לא נשמר: ' + heErr(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // העתקה - גם מתוך חלון הפגישה, שיושב מחוץ לקטגוריה
  document.addEventListener('click', async e => {
    const copy = e.target.closest('[data-csm-copy]');
    if (!copy) return;
    try { await navigator.clipboard.writeText(copy.dataset.csmCopy); showToast('הועתק'); }
    catch (_){ showToast('ההעתקה נחסמה בדפדפן. אפשר לסמן את הטקסט ולהעתיק ידנית'); }
  });

  const modal = document.getElementById('csmSessionModal');
  if (modal){
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('#csmSessionCancel')){ csmCloseSession(); return; }
      if (e.target.closest('#csmSessionSave')){ csmSaveSession(); return; }
      const sig = e.target.closest('[data-csm-signals]');
      if (sig){ csmRefreshSignals(sig); }
    });
    // שינוי באבחון משנה את המסלול המומלץ ואת הפעולה המומלצת - ציור מחדש
    modal.addEventListener('change', e => {
      if (e.target.name && (e.target.name.startsWith('csmd_') || e.target.name === 'csm_goal') || e.target.id === 'csmTrack'){
        csmReadSession();
        const y = modal.scrollTop;
        csmPaintSession();
        modal.scrollTop = y;
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && csmSession) csmCloseSession(); });
  }
})();
