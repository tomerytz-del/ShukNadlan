/* ===========================================================================
   סביבת ההטמעה (CSM) - "הטמעת סוכנים" בניהול מערכת (docs/csm-adoption.md)
   ---------------------------------------------------------------------------
   לשוניות בתוך קטגוריה אחת, לצוות ההטמעה (is_csm) ולמנהל/ת הפלטפורמה:
     צנרת      - קנבן בשישה שלבים, ציון בריאות, התרעה על 5+ ימים בלי גבריאלה,
                 ופרטי הקשר והשימוש של כל סוכן/ת
     משרדים    - כתובת, מנהלים וטלפונים, וכמה סוכנים בכל משרד משתמשים
     המנטור    - מנטור ההטמעה (csm-workspace, ‏_shared/coach/csm.ts) - צוות בלבד
     הקלטות    - הקלטת שיחה → תמלול, סיכום והמלצות (csm_calls) - צוות בלבד
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
  const atRisk = csmRows.filter(r => csmRisk(r) && r.stage !== 'champion').length;
  if (typeof accSetCount === 'function') accSetCount('accCsm', atRisk || '');
  csmRender();
}

function csmRender(){
  const ctx = csmCtx();
  document.querySelectorAll('[data-csm-tab="mentor"],[data-csm-tab="calls"]').forEach(b => { b.hidden = !ctx.isStaff; });
  const staffTab = document.querySelector('[data-csm-tab="staff"]');
  if (staffTab) staffTab.hidden = !ctx.isAdmin;
  if ((csmTab === 'mentor' || csmTab === 'calls') && !ctx.isStaff) csmTab = 'pipeline';
  if (csmTab === 'staff' && !ctx.isAdmin) csmTab = 'pipeline';
  document.querySelectorAll('[data-csm-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.csmTab === csmTab)));
  const host = document.getElementById('csmBody');
  if (!host) return;
  if (csmTab === 'pipeline') host.innerHTML = csmPipelineHtml();
  else if (csmTab === 'offices') host.innerHTML = csmOfficesHtml();
  else if (csmTab === 'mentor') host.innerHTML = csmMentorHtml();
  else if (csmTab === 'staff') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadStaff(); }
  else if (csmTab === 'calls') { host.innerHTML = '<div class="empty-state">טוען…</div>'; csmLoadCalls(); }
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
        <span class="csm-phone" dir="ltr">${escapeHtml(r.phone)}</span>
      </div>` : '<div class="csm-card-meta">אין טלפון בכרטיס</div>'}
      <div class="csm-card-actions">
        <button type="button" class="btn btn-gold" data-csm-session="${escapeHtml(r.agent_id)}">${r.sessions ? 'פגישה נוספת' : 'פגישת הצלחה ראשונה'}</button>
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
    .select('id,title,agent_id,source,status,error,analysis,transcript,audio_path,created_at')
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
        · ${c.source === 'whatsapp' ? 'מוואטסאפ' : 'הועלתה כאן'} · ${c.agent_id ? escapeHtml(names[c.agent_id] || 'סוכן/ת') : 'לא משויכת'}</div>
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
  phone_taken:'הנייד הזה כבר רשום לאיש/אשת צוות אחר/ת.',
};

async function csmLoadStaff(){
  const host = document.getElementById('csmBody');
  const { data, error } = await sb.rpc('csm_staff_list');
  if (csmTab !== 'staff') return;
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  const rows = data || [];
  host.innerHTML = `
    <p class="acc-sub">מנהלת ההדרכות וההטמעה היא תפקיד נפרד: אזור משלה ב-<a href="/csm" target="_blank" rel="noopener">shuknadlan.co.il/csm</a>, בלי ניהול הפלטפורמה, בלי משרד ובלי נכסים.
      מזמינים כאן במייל שאיתו היא נכנסת ל-Google, ובנייד שממנו היא כותבת לגבריאלה.</p>
    <form class="csm-form" id="csmStaffForm">
      <div class="csm-fb-row">
        <div class="field"><label for="csmStName">שם</label><input type="text" id="csmStName" maxlength="120"></div>
        <div class="field"><label for="csmStEmail">מייל (Google)</label><input type="email" id="csmStEmail" required dir="ltr"></div>
        <div class="field"><label for="csmStPhone">נייד (לגבריאלה)</label><input type="tel" id="csmStPhone" dir="ltr"></div>
      </div>
      <button type="submit" class="btn btn-gold">הזמנה / עדכון</button>
    </form>
    ${rows.map(r => `<div class="csm-staff-row">
      <div><strong>${escapeHtml(r.display_name || r.email)}</strong>
        <div class="csm-card-meta" dir="auto">${escapeHtml([r.email, r.phone].filter(Boolean).join(' · '))} · ${r.joined ? 'נכנסה לאזור' : 'עוד לא נכנסה'}${r.active ? '' : ' · מושבתת'}</div></div>
      <button type="button" class="btn ${r.active ? 'btn-ghost' : 'btn-gold'}" data-csm-staff="${escapeHtml(r.id)}" data-on="${r.active ? '0' : '1'}">${r.active ? 'השבתה' : 'הפעלה'}</button>
    </div>`).join('') || '<div class="empty-state">עוד אין צוות הטמעה.</div>'}`;
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
      if (e.target.id === 'csmCallForm'){
        if (btn) btn.textContent = 'מעלה…';
        await csmUploadCall();
        csmLoadCalls();
        return;
      }
      if (e.target.id === 'csmStaffForm'){
        const { data, error } = await sb.rpc('csm_staff_save', {
          p_email: document.getElementById('csmStEmail').value,
          p_name: document.getElementById('csmStName').value,
          p_phone: document.getElementById('csmStPhone').value,
        });
        if (error) throw error;
        if (data && data.error){ showToast(CSM_STAFF_ERR[data.error] || 'לא נשמר.'); return; }
        showToast('נשמר. עכשיו היא נכנסת ל-shuknadlan.co.il/csm עם Google באותו מייל.');
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
