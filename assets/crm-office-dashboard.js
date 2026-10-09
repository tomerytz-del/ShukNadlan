/* ==========================================================================
   דאשבורד משרד — לוח בקרה למנהל/ת משרד (accOfficeDashboard)
   --------------------------------------------------------------------------
   הפאנל יושב בתוך #managerSection ב-crm.html, ולכן סוכן/ת לא רואה אותו
   בכלל — אין כאן בדיקת תפקיד נוספת. כל מספר בדף נגזר מקריאה אחת:
   ‏office_dashboard(p_from, p_to) במסד (20270404090000_office_dashboard.sql),
   שמחזירה אגרגטים בלבד ומסרבת (42501) למי שאינו/ה מנהל/ת.

   המבנה:
     1. חישובים טהורים — odDerive() ו-buildOfficeAdvice(). מקבלים את ה-JSON
        ומחזירים מספרים, התראות, משפך והמלצות. אין בהם DOM, ולכן אפשר
        לבדוק אותם בנפרד ולהעביר אותם אחר כך גם לדשבורד האישי.
     2. ציור — פונקציה לכל בלוק. הגרפים בנויים ביד (DOM ו-SVG), באותו סגנון
        של admChart ב-crm.js: אין d3 בריפו, ולא נכניס אותו בשביל זה.
     3. חיווט — טעינה עצלה כשהפאנל נפתח, בורר התקופה, מיון, חיפוש, בחירת
        סוכן/ת שמסננת את הגרפים, ועריכת יעד בטבלה.

   הקובץ נטען לפני crm.js ומגדיר פונקציות בלבד; ‏sb, currentAgent, heErr,
   showToast ו-gotoSection נקראים בזמן ריצה. כל טקסט שמגיע מהמסד עובר דרך
   escapeHtml (assets/esc.js). ‏docs/office-dashboard.md
   ========================================================================== */

/* ---------- ספים ----------
   ההתראות וההמלצות נשענות עליהם. הם החלטה ניהולית ולא טכנית, ולכן הם
   כאן בראש הקובץ ולא מפוזרים בקוד. כל שינוי - גם במסמך. */
const OD_TH = {
  fastMin:        15,    // "מענה מהיר" = עד רבע שעה
  slowAvgMin:     30,    // תגובה ממוצעת איטית
  verySlowAvgMin: 60,    // ...ואיטית מאוד (חמור)
  openWarn:       4,     // לידים פתוחים בלי מענה - חמור
  targetWarn:     0.7,   // עמידה ביעד מתחת לזה - התראה
  targetBad:      0.5,   // ...ומתחת לזה - חמור
  exclWarn:       0.4,   // שיעור בלעדיות נמוך (התראה לסוכן/ת)
  exclMinSample:  3,     // לא מתריעים על שיעור מתוך פחות משלושה גיוסים
  officeFastGoal: 0.6,   // המלצת מהירות נדלקת מתחת לזה
  officeExclGoal: 0.6,   // המלצת בלעדיות נדלקת מתחת לזה
  urgentDays:     14,    // בלעדיות שפוקעת - "דחוף"
};

const OD_BUCKETS = [
  { o:1, label:'עד 5 דק\'',  color:'#0f766e' },
  { o:2, label:'5-15 דק\'',  color:'#4fa89b' },
  { o:3, label:'15-60 דק\'', color:'#d6b656' },
  { o:4, label:'1-4 שעות',   color:'#d48a4a' },
  { o:5, label:'מעל 4 שעות', color:'#b3453b' },
  { o:6, label:'ללא מענה מתועד', color:'#cbd5e1' },
];

const OD_PERIODS = [
  { key:'q_cur',  label:'רבעון נוכחי' },
  { key:'q_prev', label:'רבעון קודם' },
  { key:'m_cur',  label:'החודש' },
  { key:'d30',    label:'30 יום' },
  { key:'d90',    label:'90 יום' },
  { key:'y',      label:'שנה' },
];

const OD_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const OD_PERIOD_KEY = 'crmOfficeDashPeriod';

const odState = {
  period: 'q_cur',
  data: null,
  view: null,
  picked: null,        // agent_id שנבחר/ה בטבלה, או null
  sort: { k:'commission', dir:-1 },
  search: '',
  busy: false,
  loadedFor: null,     // מפתח התקופה של הנתונים שבזיכרון
};

try{
  const saved = localStorage.getItem(OD_PERIOD_KEY);
  if (OD_PERIODS.some(p => p.key === saved)) odState.period = saved;
}catch(e){ /* מצב פרטי - נשארים עם ברירת המחדל */ }

/* ==========================================================================
   1. עזרים - תאריכים ומספרים
   ========================================================================== */
function odIso(d){
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* התקופה שנבחרה → טווח תאריכים, וגם איזה יעד אפשר לערוך בה. יעד נערך רק
   בתקופה שהיא חודש או רבעון קלנדרי, כי רק לשם יש שורה אחת ב-agent_targets. */
function odPeriodRange(key){
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
  // ‏fem: שם התקופה בנקבה ("תקופה חזקה", "שנה מאתגרת") - ראו odHero
  let from, to = today, kind = null, start = null, noun = 'תקופה', fem = true;
  if (key === 'q_cur'){
    from = new Date(today.getFullYear(), qStartMonth, 1);
    kind = 'quarter'; start = from; noun = 'רבעון'; fem = false;
  } else if (key === 'q_prev'){
    from = new Date(today.getFullYear(), qStartMonth - 3, 1);
    to = new Date(today.getFullYear(), qStartMonth, 0);
    kind = 'quarter'; start = from; noun = 'רבעון'; fem = false;
  } else if (key === 'm_cur'){
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    kind = 'month'; start = from; noun = 'חודש'; fem = false;
  } else if (key === 'd90'){
    from = new Date(today); from.setDate(from.getDate() - 89);
  } else if (key === 'y'){
    from = new Date(today); from.setDate(from.getDate() - 364); noun = 'שנה';
  } else {
    from = new Date(today); from.setDate(from.getDate() - 29);
  }
  return { from: odIso(from), to: odIso(to), kind, start: start ? odIso(start) : null, noun, fem };
}

function odDateLabel(iso){
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return '';
  return `${d}.${m}.${String(y).slice(2)}`;
}

function odRangeLabel(p){
  if (!p) return '';
  return odDateLabel(p.from) + '-' + odDateLabel(p.to);
}

function odMonthShort(ym){
  const [y, m] = String(ym || '').split('-').map(Number);
  return (OD_MONTHS[m - 1] || '').slice(0, 3) + '׳' + String(y).slice(2);
}

/* האם זמן התגובה עדיין משוער. ‏data_notes.response_time_method הוא
   'proxy' עד 20270405090000, ו-'first_response_at' מאז. הכוכבית ו"משוער"
   נגזרים מכאן, כדי שהממשק לא יבטיח דיוק שהמסד לא מצהיר עליו. */
function odProxy(){
  return ((odState.data && odState.data.data_notes) || {}).response_time_method !== 'first_response_at';
}
function odStar(){ return odProxy() ? '*' : ''; }

function odNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function odInt(v){ return Math.round(odNum(v)).toLocaleString('he-IL'); }
function odIls(v){ return '₪' + Math.round(odNum(v)).toLocaleString('he-IL'); }

/* "996 אלף ₪", "1.2 מיליון ₪" - לכותרות. לא "K": עברית, לא אנגלית. הסימן
   בסוף ולא בהתחלה: "₪996 אלף" בשורה מימין לשמאל נקרא הפוך, כי ₪ נצמד
   למספר והמילה נשארת בצד השני. */
function odIlsWords(v){
  const n = odNum(v);
  if (Math.abs(n) >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('he-IL') + ' מיליון ₪';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e3).toLocaleString('he-IL') + ' אלף ₪';
  return odIls(n);
}

/* בידוד LTR למספר עם סימן: בלי זה "+10%" מוצג "10%+" בשורה עברית */
function odLtr(txt){ return '\u2066' + txt + '\u2069'; }

function odPct(v, digits){
  if (v == null || !Number.isFinite(v)) return '-';
  return (v * 100).toFixed(digits || 0) + '%';
}

/* דקות → "12 דק׳" / "3.5 שעות" / "2 ימים" */
function odDur(min){
  if (min == null || !Number.isFinite(Number(min))) return '-';
  const m = Number(min);
  if (m < 90) return Math.round(m) + ' דק׳';
  if (m < 60 * 36) return (Math.round(m / 6) / 10).toLocaleString('he-IL') + ' שעות';
  return Math.round(m / 1440) + ' ימים';
}

function odChg(cur, prev){
  const c = odNum(cur), p = odNum(prev);
  if (!p) return c ? Infinity : null;
  return (c - p) / p;
}

/* ספירה בעברית: "הסכם אחד", לא "1 הסכמים". ‏plural() של crm.js הוא הניסוח
   היחיד לספירה ב-CRM (docs/agent-dashboard.md); כאן הוא נקרא בזמן ריצה,
   והגיבוי זהה לו למקרה שהקובץ נטען לבד. ‏countText מאפשר מספר מודגש. */
function odCount(n, one, many, countText){
  const v = Math.round(odNum(n));
  if (typeof plural === 'function') return plural(v, one, many, countText === undefined ? odInt(v) : countText);
  return v === 1 ? one : (countText === undefined ? odInt(v) : countText) + ' ' + many;
}

function odSum(rows, f){ return rows.reduce((s, r) => s + odNum(typeof f === 'function' ? f(r) : r[f]), 0); }

function odInitials(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0] ? parts[0][0] : '') + (parts[1] ? parts[1][0] : '');
}

function odFirstName(name){ return String(name || '').trim().split(/\s+/)[0] || ''; }

/* ==========================================================================
   2. חישובים טהורים
   ========================================================================== */

/* כל מה שהממשק מציג, מחושב פעם אחת מה-JSON. ‏agentId מצמצם את המשפך, את
   המדדים ואת הגרפים לסוכן/ת אחד/ת. */
function odDerive(data, agentId){
  const agents = (data.agents || []).map(a => {
    const buckets = (data.response_buckets || []).filter(b => b.agent_id === a.agent_id);
    const bTotal = odSum(buckets, 'leads');
    return Object.assign({}, a, {
      buckets,
      target_pct:     a.commission_target ? odNum(a.commission) / odNum(a.commission_target) : null,
      fast_share:     a.leads ? odNum(a.fast_15) / odNum(a.leads) : null,
      response_share: a.leads ? odNum(a.responded) / odNum(a.leads) : null,
      exclusive_rate: a.recruited ? odNum(a.exclusives) / odNum(a.recruited) : null,
      conversion:     a.leads ? odNum(a.deals) / odNum(a.leads) : null,
      buckets_total:  bTotal,
    });
  });

  const scope = agentId ? agents.filter(a => a.agent_id === agentId) : agents;
  const s = f => odSum(scope, f);

  // ממוצע תגובה משוקלל לפי מספר הלידים שנענו - לא ממוצע של ממוצעים
  const wAvg = (avgKey, nKey) => {
    const rows = scope.filter(a => a[avgKey] != null && odNum(a[nKey]) > 0);
    const n = odSum(rows, nKey);
    return n ? odSum(rows, r => odNum(r[avgKey]) * odNum(r[nKey])) / n : null;
  };
  const resp = wAvg('avg_response_min', 'responded');
  // לתקופה הקודמת אין ספירת "נענו"; משקללים לפי מספר הלידים שלה
  const respPrev = wAvg('avg_response_min_prev', 'leads_prev');

  const leads = s('leads'), rec = s('recruited'), recPrev = s('recruited_prev');
  const excl = s('exclusives'), exclPrev = s('exclusives_prev');
  const tgtRows = scope.filter(a => a.commission_target);
  const top = agents.slice().sort((a, b) =>
    odNum(b.commission) - odNum(a.commission) || odNum(b.deals) - odNum(a.deals) ||
    odNum(b.agreements) - odNum(a.agreements) || odNum(b.recruited) - odNum(a.recruited))[0];
  const topActive = top && (odNum(top.commission) || odNum(top.deals) || odNum(top.agreements) || odNum(top.recruited));

  const office = {
    commission: s('commission'), commission_prev: s('commission_prev'),
    deals: s('deals'), deals_prev: s('deals_prev'),
    recruited: rec, recruited_prev: recPrev,
    exclusives: excl, exclusives_prev: exclPrev,
    exclusive_rate: rec ? excl / rec : null,
    exclusive_rate_prev: recPrev ? exclPrev / recPrev : null,
    agreements: s('agreements'), agreements_prev: s('agreements_prev'),
    leads, leads_prev: s('leads_prev'), responded: s('responded'),
    fast_share: leads ? s('fast_15') / leads : null,
    avg_response_min: resp == null ? null : Math.round(resp),
    avg_response_prev: respPrev == null ? null : Math.round(respPrev),
    meetings: s('meetings'), open_unanswered: s('open_unanswered'),
    commission_target: tgtRows.length ? odSum(tgtRows, 'commission_target') : null,
    commission_in_target: odSum(tgtRows, 'commission'),
    top: topActive ? top : null,
  };
  office.commission_chg = odChg(office.commission, office.commission_prev);
  office.target_pct = office.commission_target ? office.commission_in_target / office.commission_target : null;

  const funnelSteps = [
    ['לידים נכנסים', s('leads')],
    ['קיבלו מענה', s('responded')],
    ['פגישות וסיורים', s('meetings')],
    ['הסכמי תיווך', s('agreements')],
    ['עסקאות', s('deals')],
  ];
  const funnel = funnelSteps.map(([stage, count], i) => ({
    stage, count, order: i + 1,
    step_rate: i && funnelSteps[i - 1][1] ? count / funnelSteps[i - 1][1] : null,
  }));

  const monthsMap = new Map();
  (data.monthly || []).forEach(r => {
    if (agentId && r.agent_id !== agentId) return;
    const m = monthsMap.get(r.month) || { month: r.month, leads:0, recruited:0, exclusives:0, agreements:0, deals:0, commission:0 };
    ['leads','recruited','exclusives','agreements','deals','commission'].forEach(k => { m[k] += odNum(r[k]); });
    monthsMap.set(r.month, m);
  });
  const monthly = [...monthsMap.values()].sort((a, b) => a.month < b.month ? -1 : 1);

  return { agents, scope, office, funnel, monthly, alerts: odAlerts(agents) };
}

function odAlerts(agents){
  const out = [];
  agents.forEach(a => {
    if (odNum(a.open_unanswered) >= OD_TH.openWarn)
      out.push({ id: a.agent_id + '|open', agent_id: a.agent_id, agent: a.agent, sev: 2,
        issue: 'לידים פתוחים ללא מענה', value: odInt(a.open_unanswered) });
    if (a.avg_response_min != null && odNum(a.avg_response_min) > OD_TH.slowAvgMin)
      out.push({ id: a.agent_id + '|resp', agent_id: a.agent_id, agent: a.agent,
        sev: odNum(a.avg_response_min) > OD_TH.verySlowAvgMin ? 2 : 1,
        issue: 'זמן תגובה ממוצע איטי', value: odDur(a.avg_response_min) });
    // בלי יעד אין פיגור ביעד - ההתראה פשוט לא נוצרת
    if (a.target_pct != null && a.target_pct < OD_TH.targetWarn)
      out.push({ id: a.agent_id + '|target', agent_id: a.agent_id, agent: a.agent,
        sev: a.target_pct < OD_TH.targetBad ? 2 : 1,
        issue: 'פיגור ביעד העמלות', value: odPct(a.target_pct) });
    if (a.exclusive_rate != null && odNum(a.recruited) >= OD_TH.exclMinSample && a.exclusive_rate < OD_TH.exclWarn)
      out.push({ id: a.agent_id + '|excl', agent_id: a.agent_id, agent: a.agent, sev: 1,
        issue: 'שיעור בלעדיות נמוך', value: odPct(a.exclusive_rate) });
  });
  return out.sort((x, y) => y.sev - x.sev);
}

/* ---------- מנוע ההמלצות (שלב 1: כללים קבועים) ----------
   כל המלצה: {id, priority 1-3, icon, area, owner, title, body, steps[], impact}.
   ההמלצות מפנות ליכולות שכבר קיימות בפלטפורמה (CMA, סרטון, מיניסייט,
   החתמה דיגיטלית, גבריאלה, התאמות חכמות). "השפעה" היא תמיד הערכה או מדד
   הצלחה, לא הבטחה. ‏view = התוצאה של odDerive על כל המשרד. */
function buildOfficeAdvice(view, data){
  const o = view.office;
  const agents = view.agents;
  const out = [];
  const withLeads = agents.filter(a => odNum(a.leads) >= 3 && a.fast_share != null);
  const fastest = withLeads.slice().sort((a, b) => b.fast_share - a.fast_share)[0];

  // 1. מהירות תגובה
  if (o.leads >= 5 && o.fast_share != null && o.fast_share < OD_TH.officeFastGoal){
    out.push({ id:'speed', priority:1, icon:'⚡', area:'מהירות תגובה', owner:'כל הצוות',
      title:'להגיע ל-80% מהלידים תוך 15 דקות',
      body:`רק ${odPct(o.fast_share)} מהלידים נענים תוך 15 דק׳` +
        (o.avg_response_min != null ? `, וזמן התגובה הממוצע הוא ${odDur(o.avg_response_min)}` : '') +
        '. ליד שמחכה מתקרר, ולרוב כבר דיבר עם משרד אחר.',
      steps:['שני חלונות קבועים ביום שבהם כל סוכן/ת עובר/ת על הלידים הפתוחים',
             'תבנית תשובה ראשונה בוואטסאפ, ממוקדת בשאלה אחת',
             'גבריאלה עונה ראשונה מחוץ לשעות הפעילות'],
      impact: fastest && fastest.fast_share > o.fast_share
        ? `${fastest.agent} עונה ל-${odPct(fastest.fast_share)} תוך 15 דק׳ - זה היעד הריאלי`
        : 'מדד הצלחה: יותר מחצי מהלידים נענים תוך רבע שעה' });
  }

  // 2. חונכות: האיטיים עם המהיר/ה
  const slow = agents.filter(a => a.avg_response_min != null && odNum(a.avg_response_min) > OD_TH.slowAvgMin)
    .sort((a, b) => odNum(b.avg_response_min) - odNum(a.avg_response_min));
  if (slow.length && fastest && !slow.some(a => a.agent_id === fastest.agent_id)){
    const names = slow.map(a => a.agent).join(' ו');
    out.push({ id:'mentor', priority: odNum(slow[0].avg_response_min) > OD_TH.verySlowAvgMin ? 1 : 2,
      icon:'⇄', area:'חונכות', owner: fastest.agent,
      title:`חונכות של שבועיים: ${names} עם ${fastest.agent}`,
      body: slow.map(a => `${a.agent} (${odDur(a.avg_response_min)})`).join(', ') +
        ` עונים הכי לאט במשרד. שבוע של צפייה בשיטת העבודה של ${odFirstName(fastest.agent)}, ושבוע של יעד יומי למענה.`,
      steps:['פגישה קצרה בתחילת כל יום: אילו לידים פתוחים ומי מטפל/ת',
             'משימת follow-up ביומן לכל ליד חדש, עם תזכורת אחרי רבע שעה'],
      impact:'מדד הצלחה: תגובה ממוצעת מתחת ל-20 דק׳ תוך חודש' });
  }

  // 3. בלעדיות
  const exAgents = agents.filter(a => odNum(a.recruited) >= OD_TH.exclMinSample && a.exclusive_rate != null);
  const bestEx = exAgents.slice().sort((a, b) => b.exclusive_rate - a.exclusive_rate)[0];
  if (o.recruited >= 3 && o.exclusive_rate != null && o.exclusive_rate < OD_TH.officeExclGoal){
    const extra = bestEx ? Math.max(0, Math.round(o.recruited * bestEx.exclusive_rate - o.exclusives)) : 0;
    out.push({ id:'exclusive', priority:1, icon:'◆', area:'בלעדיות', owner: bestEx ? bestEx.agent : 'מנהל/ת המשרד',
      title:'להפוך כל גיוס לבלעדיות',
      body:`רק ${odPct(o.exclusive_rate)} מהגיוסים נחתמו בבלעדיות.` +
        (bestEx && bestEx.exclusive_rate > o.exclusive_rate
          ? ` ${bestEx.agent} מגיע/ה ל-${odPct(bestEx.exclusive_rate)} - כדאי לבקש להציג את השיטה בישיבת הצוות.` : ''),
      steps:['להגיע לפגישת גיוס עם דוח CMA ממותג ביד',
             'להציג את חבילת השיווק שבלעדיות פותחת: סרטון שיווקי, הדמיות, מיניסייט ללקוח/ה',
             'להחתים דיגיטלית עוד בפגישה'],
      impact: extra ? `הערכה: עוד ${odCount(extra, 'בלעדיות אחת', 'בלעדיות')} בתקופה, אם כל הצוות יגיע לרמה של ${bestEx.agent}`
                    : 'מדד הצלחה: יותר ממחצית הגיוסים בבלעדיות' });
  }

  // 4. נקודת הנפילה במשפך
  const steps = view.funnel.filter(r => r.step_rate != null && view.funnel[r.order - 2].count >= 5);
  const worst = steps.slice().sort((a, b) => a.step_rate - b.step_rate)[0];
  if (worst){
    const prev = view.funnel[worst.order - 2];
    const lib = {
      'קיבלו מענה':     ['לטפל קודם בלידים הפתוחים - ראו המלצת מהירות התגובה',
                         'לפתוח משימת follow-up ביומן לכל ליד שנכנס'],
      'פגישות וסיורים': ['להציע שני מועדים קונקרטיים כבר בשיחה הראשונה',
                         'לשלוח מיניסייט עם 3 נכסים מתאימים תוך שעה (התאמות חכמות)',
                         'אישור ותזכורת אוטומטיים ללקוח/ה בוואטסאפ מהיומן'],
      'הסכמי תיווך':    ['להחתים על הזמנת שירותי תיווך לפני הסיור, דיגיטלית',
                         'להסביר בקצרה מה הלקוח/ה מקבל/ת מהמשרד'],
      'עסקאות':         ['סקירת צנרת שבועית: כל לקוח/ה עם הסכם חתום וצעד הבא ביומן',
                         'לחזור לכל לקוח/ה שראה/תה נכס ולא התקדם/ה תוך 3 ימים'],
    };
    out.push({ id:'funnel', priority: worst.step_rate < 0.45 ? 1 : 2, icon:'⇣', area:'משפך', owner:'מנהל/ת המשרד',
      title:`לתקן את המעבר ל"${worst.stage}"`,
      body:`זו הנקודה שבה המשרד מאבד הכי הרבה: רק ${odPct(worst.step_rate)} מ"${prev.stage}" מגיעים ל"${worst.stage}".`,
      steps: lib[worst.stage] || [],
      impact:`הערכה: כל 10 נקודות שיפור כאן = בערך ${Math.max(1, Math.round(prev.count * 0.1))} יותר "${worst.stage}" בתקופה` });
  }

  // 5. מקורות לידים - מה מביא פגישות ומה רק נפח
  const srcs = (data.lead_sources || []).map(r => Object.assign({}, r, {
    conv: odNum(r.leads) ? odNum(r.meetings) / odNum(r.leads) : 0,
  })).filter(r => odNum(r.leads) >= 3);
  const best = srcs.slice().sort((a, b) => b.conv - a.conv)[0];
  const weak = srcs.filter(r => odNum(r.leads) >= 8).sort((a, b) => a.conv - b.conv)[0];
  if (best && weak && best.source !== weak.source && best.conv > weak.conv){
    out.push({ id:'sources', priority:2, icon:'◎', area:'מקורות לידים', owner:'מנהל/ת המשרד',
      title:`להשקיע יותר ב"${odChannelLabel(best.source)}"`,
      body:`"${odChannelLabel(best.source)}" מביא פגישה מ-${odPct(best.conv)} מהלידים. "${odChannelLabel(weak.source)}" מביא הרבה לידים (${odInt(weak.leads)}) אבל רק ${odPct(weak.conv)} מהם מגיעים לפגישה.`,
      steps:[`לחזק את "${odChannelLabel(best.source)}": לבקש המלצות אחרי כל עסקה, ולשמור על דף המשרד מעודכן`,
             `ב"${odChannelLabel(weak.source)}": שאלת סינון אחת לפני שמשקיעים זמן`],
      impact:'מדד הצלחה: יותר פגישות לכל 100 לידים, לא יותר לידים' });
  }

  // 6. חידוש בלעדיות
  const exp = data.expiring || [];
  if (exp.length){
    const val = odSum(exp, 'asking_price');
    const weakEx = exp.filter(r => odNum(r.showings) <= 3 || odNum(r.days_on_market) > 100).length;
    out.push({ id:'renew', priority:1, icon:'↻', area:'שימור בלעדיות', owner:'הסוכנים המטפלים',
      title: exp.length === 1 ? 'לחדש בלעדיות אחת לפני שהיא פוקעת' : `לחדש ${exp.length} בלעדיות לפני שהן פוקעות`,
      body:`נכסים בשווי מבוקש של ${odIls(val)} יוצאים מבלעדיות בחודש הקרוב.` +
        (weakEx ? ` ב${weakEx === 1 ? 'אחד' : '-' + weakEx} מהם היו מעט הצגות או זמן ארוך בשוק - שם צריך שיחת מחיר.` : ''),
      steps:['פגישת חידוש שבועיים לפני הסיום, עם דוח פעילות על הנכס',
             'הצעת עדכון מחיר מבוססת דוח CMA ועסקאות אחרונות באזור',
             'חידוש בהחתמה דיגיטלית, בלי לחכות לפגישה נוספת'],
      impact:'כל בלעדיות שאובדת היא נכס שמתווך/ת מתחרה ימכור/תמכור' });
  }

  // 7. יעדים
  const behind = agents.filter(a => a.target_pct != null && a.target_pct < OD_TH.targetWarn);
  if (behind.length){
    out.push({ id:'target', priority:2, icon:'↗', area:'יעדים', owner:'מנהל/ת המשרד',
      title:`שיחת 1:1 עם ${behind.map(a => a.agent).join(' ו')}`,
      body: behind.map(a => `${a.agent} ב-${odPct(a.target_pct)} מהיעד`).join(', ') +
        '. לא כביקורת - כדי להבין מה תקוע ולבנות יחד תוכנית ל-30 יום.',
      steps:['שלושה יעדי פעילות שבועיים (שיחות, פגישות, גיוסים) במקום יעד כספי בלבד',
             'מעקב קצר בכל יום ראשון'],
      impact:'מדד הצלחה: מגמת עלייה בפעילות כבר בחודש הראשון' });
  } else if (!agents.some(a => a.commission_target) && agents.length > 1){
    out.push({ id:'set-targets', priority:3, icon:'↗', area:'יעדים', owner:'מנהל/ת המשרד',
      title:'להגדיר יעד לכל סוכן/ת',
      body:'אין עדיין יעדים במשרד. יעד ברור לרבעון הוא מה שהופך את המספרים כאן מתמונת מצב לתוכנית עבודה.',
      steps:['בטבלת ביצועי הסוכנים, בעמודה "יעד" - בבורר "רבעון נוכחי"',
             'יעד שנקבע יחד עם הסוכן/ת, לא בשבילו/ה'],
      impact:'מדד הצלחה: לכל סוכן/ת יעד עד סוף השבוע' });
  }

  // 8. הוקרה
  if (o.top){
    out.push({ id:'recognition', priority:3, icon:'★', area:'תרבות ומוטיבציה', owner:'מנהל/ת המשרד',
      title:`להוקיר בפומבי את ${o.top.agent}`,
      body: odNum(o.top.commission)
        ? `${o.top.agent} הביא/ה ${odIls(o.top.commission)} בעמלות (הערכה) בתקופה. הכרה פומבית ושיתוף "מה עבד לי" בישיבת הצוות מרימים את כל המשרד.`
        : `${o.top.agent} מוביל/ה את המשרד בתקופה. הכרה פומבית ושיתוף "מה עבד לי" בישיבת הצוות מרימים את כל המשרד.`,
      steps:['5 דקות בישיבת הצוות: העסקה או הגיוס הכי טובים בתקופה, ואיך זה קרה'],
      impact:'מחזק את מה שעובד, בלי עלות' });
  }

  return out.sort((a, b) => a.priority - b.priority).map((r, i) => Object.assign(r, { rank: i + 1 }));
}

function odChannelLabel(key){
  const map = (typeof LX_CHANNELS !== 'undefined') ? LX_CHANNELS : {};
  return map[key] || key || 'אחר';
}

/* ==========================================================================
   3. טעינה
   ========================================================================== */
async function loadOfficeDashboard(force){
  const host = document.getElementById('officeDash');
  if (!host) return;
  const key = odState.period;
  if (!force && odState.data && odState.loadedFor === key){ renderOfficeDashboard(); return; }
  if (odState.busy) return;
  odState.busy = true;
  if (!odState.data) host.innerHTML = odSkeleton();
  else host.classList.add('od-refreshing');
  const range = odPeriodRange(key);
  const { data, error } = await sb.rpc('office_dashboard', { p_from: range.from, p_to: range.to });
  odState.busy = false;
  host.classList.remove('od-refreshing');
  if (error){
    const missing = error.code === 'PGRST202' || /office_dashboard/.test(error.message || '') && /not find|does not exist/.test(error.message || '');
    host.innerHTML = '<div class="od-error">' + escapeHtml(missing
      ? 'הדאשבורד עדיין לא קיים במסד. הוא נוצר אוטומטית עם המיזוג של המיגרציה 20270404090000_office_dashboard.sql.'
      : (error.code === '42501' ? 'הדאשבורד פתוח למנהל/ת משרד בלבד.' : 'טעינת הדאשבורד נכשלה: ' + heErr(error))) +
      '</div>';
    return;
  }
  odState.data = data || {};
  odState.loadedFor = key;
  if (odState.picked && !(odState.data.agents || []).some(a => a.agent_id === odState.picked)) odState.picked = null;
  renderOfficeDashboard();
}

function odSkeleton(){
  return '<div class="od" aria-busy="true"><div class="od-sk od-sk-hero"></div>' +
    '<div class="od-kpis">' + '<div class="od-sk od-sk-kpi"></div>'.repeat(6) + '</div>' +
    '<div class="od-sk od-sk-block"></div></div>';
}

/* ==========================================================================
   4. ציור
   ========================================================================== */
function renderOfficeDashboard(){
  const host = document.getElementById('officeDash');
  if (!host || !odState.data) return;
  const data = odState.data;
  const full = odDerive(data, null);
  const view = odState.picked ? odDerive(data, odState.picked) : full;
  odState.view = full;
  const picked = odState.picked ? full.agents.find(a => a.agent_id === odState.picked) : null;
  const range = odPeriodRange(odState.period);
  const advice = buildOfficeAdvice(full, data);

  // שורת הסיכום בכותרת הפאנל הסגור: המספר שהכי חשוב לדעת בלי לפתוח
  const o = full.office;
  if (typeof accSetSummary === 'function'){
    accSetSummary('accOfficeDashboard', [
      odCount(o.agreements, 'הסכם אחד', 'הסכמים'),
      odCount(o.recruited, 'גיוס אחד', 'גיוסים'),
      o.avg_response_min != null ? 'תגובה ' + odDur(o.avg_response_min) : null,
    ].filter(Boolean).join(' · '));
  }
  if (typeof accSetCount === 'function'){
    const sev = full.alerts.filter(a => a.sev === 2).length;
    accSetCount('accOfficeDashboard', sev || '', sev);
  }

  if (!full.agents.length){
    host.innerHTML = '<div class="od-empty">אין עדיין חברי צוות פעילים במשרד.</div>';
    return;
  }

  host.innerHTML = `
  <div class="od${odState.firstPaintDone ? '' : ' od-first'}" dir="rtl">
    ${odBrandBar(data, range, picked)}
    ${odHero(full, view, data, range, picked)}
    ${odKpis(view, range)}
    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>דורש תשומת לב עכשיו</h3>
          <p>סוכנים שחורגים מהסטנדרט של המשרד: תגובה מעל ${OD_TH.slowAvgMin} דק׳, ${OD_TH.openWarn}+ לידים ללא מענה, בלעדיות מתחת ל-${OD_TH.exclWarn * 100}%, או פחות מ-${OD_TH.targetWarn * 100}% מהיעד.</p></div>
        ${odAlertsHtml(full.alerts)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>${picked ? 'המשפך של ' + escapeHtml(picked.agent) : 'משפך המשרד: מליד לעסקה'}</h3>
          <p>האחוז מתחת לכל שלב הוא כמה עברו לשלב הבא; הנפילה הגדולה מסומנת באדום.</p></div>
        ${odFunnelHtml(view.funnel)}
      </div>
    </section>
    <section class="od-sec">
      <div class="od-sec-h"><h2>המלצות לשיפור הפריון</h2>
        <p>נגזרות מהנתונים של התקופה · לכל המלצה מי מוביל/ה ומה ההשפעה הצפויה</p></div>
      ${odAdviceHtml(advice)}
    </section>
    <section class="od-sec">
      <div class="od-sec-h"><h2>ביצועי סוכנים</h2>
        <input class="od-search" id="odSearch" type="search" placeholder="חיפוש סוכן/ת" aria-label="חיפוש סוכן/ת" value="${escapeHtml(odState.search)}"></div>
      <div class="od-card">
        <div class="od-card-h"><p>לחיצה על שורה מסננת את הגרפים לסוכן/ת; לחיצה על כותרת ממיינת.${range.kind ? ' את היעד אפשר לערוך ישירות בטבלה.' : ' עריכת יעד - בבורר "רבעון נוכחי", "רבעון קודם" או "החודש".'}</p></div>
        <div class="od-tablewrap">${odTableHtml(full.agents, range)}</div>
      </div>
    </section>
    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>מהירות תגובה ללידים, לפי סוכן/ת</h3>
          <p>חלוקת הלידים של כל סוכן/ת לפי הזמן עד המענה הראשון${odProxy() ? ' (משוער)' : ''}. ממוין מהמהיר לאיטי.</p></div>
        ${odLegend(OD_BUCKETS.map(b => [b.color, b.label]))}
        ${odResponseHtml(full.agents)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>${picked ? 'גיוסים ובלעדיות של ' + escapeHtml(picked.agent) : 'גיוסים ובלעדיות, 12 חודשים'}</h3>
          <p>כל עמודה היא הנכסים שגויסו בחודש; החלק הכהה הוא נכסים בבלעדיות.</p></div>
        ${odLegend([['var(--od-sap)', 'בבלעדיות'], ['var(--od-sap-soft)', 'בלי בלעדיות']])}
        ${odRecruitHtml(view.monthly)}
      </div>
    </section>
    <section class="od-sec">
      <div class="od-sec-h"><h2>הכנסות לפי סוכן/ת, חודש אחר חודש</h2>
        <p>עמלות (הערכה) · אותו סולם לכל הסוכנים · שלושת החודשים האחרונים מודגשים</p></div>
      ${odMinisHtml(full.agents, data.monthly || [])}
    </section>
    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>מאיפה מגיעים הלידים</h3>
          <p>לידים לפי ערוץ, כמה קיבלו מענה וכמה הגיעו לפגישה או סיור. כל המשרד, בלי קשר לסינון.</p></div>
        <div class="od-tablewrap">${odSourcesHtml(data.lead_sources || [])}</div>
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>בלעדיות שפוקעות בקרוב</h3>
          <p>בלעדיות שמסתיימות ב-30 הימים הקרובים. כדאי לחדש או לעדכן מחיר לפני שהנכס עובר למתחרה.</p></div>
        <div class="od-tablewrap">${odExpiringHtml(data.expiring || [], full.agents)}</div>
      </div>
    </section>
    ${odDefsHtml(data)}
  </div>`;
  odState.firstPaintDone = true;
}

function odBrandBar(data, range, picked){
  const office = data.office || {};
  const period = data.period || {};
  return `<div class="od-brand">
    <div class="od-logo">
      ${office.logo_url ? `<img src="${escapeHtml(office.logo_url)}" alt="">` : '<img src="/assets/logo-shuknadlan.svg" alt="">'}
      <div><b>${escapeHtml(office.name || 'המשרד')}</b><small>ניהול משרד</small></div>
    </div>
    <div class="od-chips">
      <span class="od-chip">${escapeHtml(odRangeLabel(period))} · מול ${escapeHtml(odRangeLabel({ from: period.prev_from, to: period.prev_to }))}</span>
      ${picked ? `<button type="button" class="od-picked" data-od-unpick>מסונן: ${escapeHtml(picked.agent)} ×</button>` : ''}
      <div class="od-periods" role="group" aria-label="בחירת תקופה">
        ${OD_PERIODS.map(p => `<button type="button" data-od-period="${p.key}" aria-pressed="${p.key === odState.period}">${p.label}</button>`).join('')}
      </div>
      <button type="button" class="od-refresh" data-od-refresh aria-label="רענון הנתונים" title="רענון">↻</button>
    </div>
  </div>`;
}

function odGreeting(){
  const now = new Date(), h = now.getHours(), day = now.getDay();
  if (day === 6 || (day === 5 && h >= 14)) return 'שבת שלום';
  if (day === 0 && h < 12) return 'שבוע טוב';
  if (h < 5) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  return 'ערב טוב';
}

function odHero(full, view, data, range, picked){
  const o = view.office;
  const chg = o.commission_chg;
  const mood = chg == null ? '' : chg > 0.1 ? ' שיא'
    : chg > 0 ? (range.fem ? ' חזקה' : ' חזק') : (range.fem ? ' מאתגרת' : ' מאתגר');
  const noun = range.noun;
  const me = (typeof currentAgent !== 'undefined' && currentAgent) ? odFirstName(currentAgent.display_name) : '';
  const chgWords = chg == null ? 'אין עדיין נתונים להשוואה'
    : chg === Infinity ? 'לראשונה, מול תקופה קודמת בלי עמלות'
    : (chg >= 0 ? 'עלו ב-' : 'ירדו ב-') + odPct(Math.abs(chg)) + ' לעומת התקופה הקודמת';
  const focus = full.alerts[0];
  const top = full.office.top;
  const topRing = top && top.target_pct != null ? Math.min(1, top.target_pct) : null;
  const C = 2 * Math.PI * 31;
  const spark = odSparkSvg(full.monthly.map(m => m.commission));
  const targetPct = full.office.target_pct;
  const deltaCls = (v, better) => v == null || v === Infinity || v === 0 ? '' :
    ((v > 0) === (better === 'up') ? 'up' : 'down');
  return `<header class="od-hero">
    <div class="od-hero-main">
      <p class="od-hello">${odGreeting()}${me ? ', ' + escapeHtml(me) : ''}</p>
      <h2 class="od-title">${picked ? escapeHtml(picked.agent) : noun + mood} - <span class="hl">${odIlsWords(o.commission)}</span> בעמלות</h2>
      <p class="od-take">${picked ? escapeHtml(odFirstName(picked.agent)) + ' סגר/ה' : 'המשרד סגר'} ${odCount(o.deals, '<b>עסקה אחת</b>', 'עסקאות', '<b>' + odInt(o.deals) + '</b>')}, ${picked ? 'גייס/ה' : 'גייס'} ${odCount(o.recruited, '<b>נכס אחד</b>', 'נכסים', '<b>' + odInt(o.recruited) + '</b>')}
        ו${picked ? 'החתים/ה' : 'החתים'} על ${odCount(o.agreements, '<b>הסכם תיווך אחד</b>', 'הסכמי תיווך', '<b>' + odInt(o.agreements) + '</b>')}. העמלות (הערכה) <b>${chgWords}</b>.</p>
      <div class="od-hero-stats">
        <div class="od-hs"><small>עמלות מול התקופה הקודמת</small><strong class="${deltaCls(chg, 'up')}">${odSignedPct(chg)}</strong></div>
        <div class="od-hs"><small>זמן תגובה ממוצע${odStar()}</small><strong>${odDur(o.avg_response_min)}</strong></div>
        <div class="od-hs"><small>נענו תוך 15 דק׳${odStar()}</small><strong>${odPct(o.fast_share)}</strong></div>
        <div class="od-hs"><small>שיעור בלעדיות</small><strong>${odPct(o.exclusive_rate)}</strong></div>
      </div>
      ${focus ? `<div class="od-focus"><span class="lbl">הפוקוס להיום:</span>
        <button type="button" data-od-pick="${escapeHtml(focus.agent_id)}">${escapeHtml(focus.agent)}</button>
        <span>·</span><span>${escapeHtml(focus.issue)} (${escapeHtml(focus.value)})</span></div>`
        : '<div class="od-focus"><span class="lbl">הפוקוס להיום:</span><span>אין חריגות - המשרד עומד בכל הסטנדרטים.</span></div>'}
    </div>
    <div class="od-side">
      ${top ? `<div class="od-star">
        <div class="ring"><svg viewBox="0 0 74 74" aria-hidden="true"><circle cx="37" cy="37" r="31" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="7"/>${topRing != null
          ? `<circle cx="37" cy="37" r="31" fill="none" stroke="#c9a227" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(topRing * C).toFixed(1)} ${C.toFixed(1)}"/>` : ''}</svg>
          ${top.photo_url ? `<img src="${escapeHtml(top.photo_url)}" alt="" loading="lazy">` : `<span>${escapeHtml(odInitials(top.agent))}</span>`}</div>
        <span class="tag">✦ מצטיין/ת ה${escapeHtml(noun)}</span>
        <span class="nm">${escapeHtml(top.agent)}</span>
        <span class="sub">${odNum(top.commission) ? `<b>${odIls(top.commission)}</b> בעמלות` : `${odCount(top.agreements, 'הסכם אחד', 'הסכמים', '<b>' + odInt(top.agreements) + '</b>')} · ${odCount(top.recruited, 'גיוס אחד', 'גיוסים', '<b>' + odInt(top.recruited) + '</b>')}`}${top.target_pct != null ? ` · <b>${odPct(top.target_pct)}</b> מהיעד` : ''}</span>
      </div>` : ''}
      <div class="od-spark">
        <div class="od-spark-h"><span>הכנסות המשרד · 12 חודשים</span><span>הערכה</span></div>
        <div class="od-spark-c">${spark}</div>
        <div class="od-office-target"><span>יעד משרדי</span>${targetPct != null
          ? `<div class="bar"><i style="width:${Math.min(100, Math.round(targetPct * 100))}%"></i></div><b>${odPct(targetPct)}</b>`
          : `<span class="od-muted-l">${range.kind ? 'לא הוגדרו יעדים - אפשר להגדיר בטבלה' : 'יעדים מוצגים בתקופה של חודש או רבעון'}</span>`}</div>
      </div>
    </div>
  </header>`;
}

function odSignedPct(v){
  if (v == null) return '-';
  if (v === Infinity) return 'חדש';
  return odLtr((v > 0 ? '+' : v < 0 ? '−' : '') + odPct(Math.abs(v)));
}

/* קו זהב של 12 חודשים. ‏SVG ב-LTR: ציר הזמן משמאל לימין, כמו admChart. */
function odSparkSvg(values){
  if (!values.length) return '';
  const W = 300, H = 90, pad = 6;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (W - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - pad} L${pts[0][0].toFixed(1)} ${H - pad} Z`;
  const last3 = pts.slice(-3);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="הכנסות המשרד ב-12 החודשים האחרונים">
    <defs><linearGradient id="odSparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c9a227" stop-opacity=".35"/><stop offset="1" stop-color="#c9a227" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#odSparkFill)"/>
    <path d="${line}" fill="none" stroke="#e5c76a" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${last3.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#e5c76a"/>`).join('')}
  </svg>`;
}

function odKpis(view, range){
  const o = view.office;
  const vs = 'מול התקופה הקודמת';
  const tile = (label, value, unit, chg, better, accent, note) => {
    let cls = '', txt = '-';
    if (chg === Infinity){ txt = 'חדש'; cls = better === 'up' ? 'good' : ''; }
    else if (chg != null){
      txt = odSignedPct(chg);
      if (chg !== 0) cls = ((chg > 0) === (better === 'up')) ? 'good' : 'bad';
    }
    return `<div class="od-kpi" style="--kpi-accent:${accent}">
      <span class="od-kpi-label">${label}${note ? ' <em>' + note + '</em>' : ''}</span>
      <span class="od-kpi-value">${value}${unit ? '<span class="od-kpi-unit">' + unit + '</span>' : ''}</span>
      <span class="od-kpi-delta"><span class="${cls}">${txt}</span><span class="vs">${vs}</span></span>
    </div>`;
  };
  const exPts = o.exclusive_rate != null && o.exclusive_rate_prev != null ? (o.exclusive_rate - o.exclusive_rate_prev) : null;
  const exTxt = exPts == null ? null : exPts;
  return `<section class="od-kpis" aria-label="מדדים מרכזיים">
    ${tile('עמלות', odIlsWords(o.commission), '', o.commission_chg, 'up', 'var(--od-brass)', 'הערכה')}
    ${tile('עסקאות שנסגרו', odInt(o.deals), '', odChg(o.deals, o.deals_prev), 'up', 'var(--od-sap)')}
    ${tile('נכסים שגויסו', odInt(o.recruited), '', odChg(o.recruited, o.recruited_prev), 'up', 'var(--od-sand)')}
    <div class="od-kpi" style="--kpi-accent:var(--od-mint)">
      <span class="od-kpi-label">שיעור בלעדיות בגיוסים</span>
      <span class="od-kpi-value">${odPct(o.exclusive_rate)}</span>
      <span class="od-kpi-delta"><span class="${exTxt == null || exTxt === 0 ? '' : exTxt > 0 ? 'good' : 'bad'}">${exTxt == null ? '-' : odLtr((exTxt > 0 ? '+' : exTxt < 0 ? '−' : '') + Math.round(Math.abs(exTxt) * 100)) + ' נק׳'}</span><span class="vs">${vs}</span></span>
    </div>
    ${tile('הסכמי תיווך שנחתמו', odInt(o.agreements), '', odChg(o.agreements, o.agreements_prev), 'up', 'var(--od-sap)')}
    ${tile('זמן תגובה ממוצע לליד', o.avg_response_min == null ? '-' : odDur(o.avg_response_min), '', o.avg_response_min == null ? null : odChg(o.avg_response_min, o.avg_response_prev), 'down', 'var(--od-mint)', odProxy() ? 'משוער' : '')}
  </section>`;
}

function odAlertsHtml(alerts){
  if (!alerts.length) return '<p class="od-ok">✓ אין חריגות. כל הסוכנים בתוך הסטנדרט של המשרד.</p>';
  return `<ul class="od-alerts">${alerts.map(a => `
    <li class="sev-${a.sev}">
      <span class="sev" aria-label="${a.sev === 2 ? 'חמור' : 'לתשומת לב'}"><i></i></span>
      <button type="button" class="who" data-od-pick="${escapeHtml(a.agent_id)}">${escapeHtml(a.agent)}</button>
      <span class="what">${escapeHtml(a.issue)}</span>
      <span class="val">${escapeHtml(a.value)}</span>
    </li>`).join('')}</ul>`;
}

function odFunnelHtml(funnel){
  const max = Math.max(1, funnel[0].count);
  if (!funnel[0].count) return '<p class="od-muted">אין לידים בתקופה - המשפך יתמלא כשיגיעו לידים.</p>';
  const rated = funnel.filter(r => r.step_rate != null);
  const worst = rated.length ? rated.reduce((w, r) => r.step_rate < w.step_rate ? r : w) : null;
  return `<div class="od-funnel">${funnel.map((r, i) => `
    ${i ? `<div class="od-fn-step${worst && worst.order === r.order ? ' bad' : ''}">↓ ${odPct(r.step_rate)} עברו לשלב הבא${worst && worst.order === r.order ? ' · הנפילה הגדולה' : ''}</div>` : ''}
    <div class="od-fn-row">
      <span class="od-fn-label">${r.stage}</span>
      <span class="od-fn-track"><span class="od-fn-bar" style="width:${Math.max(2, Math.round(r.count / max * 100))}%;background:${['#0e2a6b','#1e4396','#3a62b5','#6a8bd0','#c9a227'][i]}"></span></span>
      <span class="od-fn-val">${odInt(r.count)}</span>
    </div>`).join('')}</div>`;
}

/* ‏showAll: הדשבורד האישי מחזיק דגל משלו (mdState.allTips), כדי שפתיחת
   "עוד המלצות" באחד לא תפתח אותן גם בשני */
function odAdviceHtml(advice, showAll){
  if (!advice.length) return '<p class="od-muted">אין המלצות כרגע - צריך עוד קצת נתונים בתקופה.</p>';
  const prio = { 1:'עדיפות גבוהה', 2:'עדיפות בינונית', 3:'כדאי' };
  // ארבע ראשונות גלויות, השאר מאחורי כפתור: שמונה כרטיסים בטלפון הם גלילה
  // ארוכה, והעדיפות הגבוהה ממילא בראש
  const all = showAll === undefined ? odState.allAdvice : showAll;
  const shown = all ? advice : advice.slice(0, 4);
  const more = advice.length - shown.length;
  return `<div class="od-advice">${shown.map(r => `
    <article class="od-tipcard p${r.priority}">
      <div class="top"><span class="ic" aria-hidden="true">${r.icon}</span>
        <div><div class="area">${escapeHtml(r.area)}</div><div class="owner">מוביל/ה: ${escapeHtml(r.owner)}</div></div>
        <span class="prio">${prio[r.priority]}</span></div>
      <h4>${escapeHtml(r.title)}</h4>
      <p>${escapeHtml(r.body)}</p>
      ${r.steps && r.steps.length ? `<ul>${r.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
      <div class="impact"><b>השפעה צפויה</b><span>${escapeHtml(r.impact)}</span></div>
    </article>`).join('')}</div>${more > 0
      ? `<button type="button" class="od-more" data-od-more>עוד ${more === 1 ? 'המלצה אחת' : more + ' המלצות'}</button>` : ''}`;
}

const OD_COLS = [
  { k:'agent',            label:'סוכן/ת' },
  { k:'commission',       label:'עמלות (הערכה)', n:true },
  { k:'commission_target',label:'יעד', n:true },
  { k:'target_pct',       label:'עמידה ביעד', n:true },
  { k:'deals',            label:'עסקאות', n:true },
  { k:'leads',            label:'לידים', n:true },
  { k:'avg_response_min', label:'תגובה ממוצעת', n:true, star:true },
  { k:'fast_share',       label:'נענו תוך 15 דק׳', n:true, star:true },
  { k:'recruited',        label:'גיוסים', n:true },
  { k:'exclusives',       label:'בלעדיות', n:true },
  { k:'exclusive_rate',   label:'% בלעדיות', n:true },
  { k:'agreements',       label:'הסכמי תיווך', n:true },
  { k:'meetings',         label:'פגישות וסיורים', n:true },
  { k:'conversion',       label:'המרה ליד→עסקה', n:true },
  { k:'open_unanswered',  label:'לידים ללא מענה', n:true },
  { k:'calls_missed',     label:'שיחות שלא נענו', n:true },
];

function odTableHtml(agents, range){
  const q = odState.search.trim();
  const rows = agents.filter(a => !q || String(a.agent).includes(q));
  const { k, dir } = odState.sort;
  rows.sort((a, b) => {
    const x = a[k], y = b[k];
    if (k === 'agent') return dir * String(x).localeCompare(String(y), 'he');
    // ריק תמיד בסוף, בשני כיווני המיון
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return dir * (odNum(x) - odNum(y));
  });
  const maxC = Math.max(1, ...agents.map(a => odNum(a.commission)));
  // ‏invert: ערך נמוך הוא טוב (זמן תגובה)
  const pillHtml = (v, txt, good, warn, invert) => {
    const ok = invert ? v <= good : v >= good;
    const mid = invert ? v <= warn : v >= warn;
    return `<span class="od-pill ${ok ? 'good' : mid ? 'warn' : 'bad'}">${txt}</span>`;
  };
  const head = OD_COLS.map(c => {
    const sorted = c.k === k ? (dir > 0 ? 'ascending' : 'descending') : null;
    return `<th class="${c.n ? 'n' : ''}"${sorted ? ` aria-sort="${sorted}"` : ''}><button type="button" data-od-sort="${c.k}">${c.label}${c.star ? odStar() : ''}</button></th>`;
  }).join('');
  const body = rows.map(a => {
    const isPicked = odState.picked === a.agent_id;
    const dim = odState.picked && !isPicked;
    const tgt = range.kind
      ? `<input class="od-target" type="number" min="0" step="1000" inputmode="numeric" value="${a.commission_target != null ? Math.round(odNum(a.commission_target)) : ''}" placeholder="הגדרת יעד" aria-label="יעד עמלות ל${escapeHtml(a.agent)}" data-od-target="${escapeHtml(a.agent_id)}">`
      : (a.commission_target != null ? odIls(a.commission_target) : '<span class="od-muted">-</span>');
    return `<tr data-od-row="${escapeHtml(a.agent_id)}" class="${isPicked ? 'is-picked' : ''}${dim ? ' is-dim' : ''}" tabindex="0">
      <td><div class="od-agent">${odAvatar(a)}<div><b>${escapeHtml(a.agent)}</b><small>${a.role === 'manager' ? 'מנהל/ת' : 'סוכן/ת'} · ${odCount(a.active_listings, 'נכס פעיל אחד', 'נכסים פעילים')}</small></div></div></td>
      <td class="n"><div class="od-cbar"><span>${odIls(a.commission)}</span><span class="track"><span class="fill" style="width:${Math.round(odNum(a.commission) / maxC * 100)}%"></span></span></div></td>
      <td class="n od-tcell">${tgt}</td>
      <td class="n">${a.target_pct == null ? '<span class="od-muted">' + (range.kind ? 'הגדרת יעד' : '-') + '</span>' : pillHtml(a.target_pct, odPct(a.target_pct), 1, OD_TH.targetWarn)}</td>
      <td class="n">${odInt(a.deals)}</td>
      <td class="n">${odInt(a.leads)}</td>
      <td class="n">${a.avg_response_min == null ? '<span class="od-muted">-</span>' : pillHtml(odNum(a.avg_response_min), odDur(a.avg_response_min), OD_TH.fastMin, OD_TH.slowAvgMin, true)}</td>
      <td class="n">${odPct(a.fast_share)}</td>
      <td class="n">${odInt(a.recruited)}</td>
      <td class="n">${odInt(a.exclusives)}</td>
      <td class="n">${a.exclusive_rate == null ? '<span class="od-muted">-</span>' : pillHtml(a.exclusive_rate, odPct(a.exclusive_rate), OD_TH.officeExclGoal, OD_TH.exclWarn)}</td>
      <td class="n">${odInt(a.agreements)}<small class="od-sub"> ${odInt(a.agreements_sell)} מוכר/ת · ${odInt(a.agreements_buy)} קונה</small></td>
      <td class="n">${odInt(a.meetings)}</td>
      <td class="n">${odPct(a.conversion, 1)}</td>
      <td class="n">${odNum(a.open_unanswered) >= OD_TH.openWarn ? `<span class="od-pill bad">${odInt(a.open_unanswered)}</span>` : odInt(a.open_unanswered)}</td>
      <td class="n">${odInt(a.calls_missed)}</td>
    </tr>`;
  }).join('');
  return `<table class="od-table od-lead"><thead><tr>${head}</tr></thead><tbody>${body ||
    `<tr><td colspan="${OD_COLS.length}" class="od-muted">אין סוכן/ת בשם הזה</td></tr>`}</tbody></table>`;
}

/* צבע אווטאר קבוע לכל סוכן/ת - לפי המזהה ולא לפי המיקום, כדי שמיון לא
   יצבע מחדש. גוונים כהים בלבד: האות הלבנה עליהם צריכה ניגודיות. */
const OD_AV_COLORS = ['#0e2a6b', '#0f766e', '#8a6b12', '#8B2332', '#4b3b8f', '#1d5f8a', '#5b6b1c', '#7a3e6f'];
function odAvatar(a){
  if (a.photo_url) return `<span class="od-av"><img src="${escapeHtml(a.photo_url)}" alt="" loading="lazy"></span>`;
  let h = 0; String(a.agent_id).split('').forEach(ch => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  return `<span class="od-av" style="background:${OD_AV_COLORS[h % OD_AV_COLORS.length]}">${escapeHtml(odInitials(a.agent))}</span>`;
}

function odLegend(items){
  return `<div class="od-legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${escapeHtml(l)}</span>`).join('')}</div>`;
}

function odResponseHtml(agents){
  const rows = agents.filter(a => a.buckets_total > 0)
    .sort((a, b) => (b.fast_share || 0) - (a.fast_share || 0));
  if (!rows.length) return '<p class="od-muted">אין לידים בתקופה.</p>';
  return `<div class="od-resp">${rows.map(a => {
    const isPicked = odState.picked === a.agent_id;
    const segs = OD_BUCKETS.map(b => {
      const n = odNum((a.buckets.find(x => Number(x.bucket_order) === b.o) || {}).leads);
      if (!n) return '';
      const w = n / a.buckets_total * 100;
      return `<span class="seg" style="width:${w.toFixed(2)}%;background:${b.color}" data-od-tip="${escapeHtml(a.agent + ' · ' + b.label + ': ' + odCount(n, 'ליד אחד', 'לידים') + ' (' + Math.round(w) + '%)')}"></span>`;
    }).join('');
    return `<div class="od-resp-row${odState.picked && !isPicked ? ' is-dim' : ''}${isPicked ? ' is-picked' : ''}">
      <button type="button" class="nm" data-od-pick="${escapeHtml(a.agent_id)}">${escapeHtml(a.agent)}</button>
      <span class="bar" role="img" aria-label="${escapeHtml(a.agent)}: ${odPct(a.fast_share)} נענו תוך 15 דקות">${segs}</span>
      <span class="v">${odPct(a.fast_share)}</span>
    </div>`;
  }).join('')}</div>`;
}

function odRecruitHtml(monthly){
  if (!monthly.length) return '<p class="od-muted">אין נתונים.</p>';
  const max = Math.max(1, ...monthly.map(m => odNum(m.recruited)));
  const total = odSum(monthly, 'recruited');
  if (!total) return '<p class="od-muted">לא גויסו נכסים ב-12 החודשים האחרונים.</p>';
  return `<div class="od-cols" dir="ltr">${monthly.map((m, i) => {
    const rec = odNum(m.recruited), ex = Math.min(rec, odNum(m.exclusives));
    const h = rec / max * 100;
    return `<div class="od-col" data-od-tip="${escapeHtml(odMonthShort(m.month) + ': ' + odCount(rec, 'גיוס אחד', 'גיוסים') + ', ' + ex + ' בבלעדיות')}">
      <span class="v">${rec || ''}</span>
      <span class="stack" style="height:${h.toFixed(1)}%">
        ${rec - ex > 0 ? `<i class="plain" style="flex:${rec - ex}"></i>` : ''}${ex > 0 ? `<i class="ex" style="flex:${ex}"></i>` : ''}
      </span>
      <span class="m${i >= monthly.length - 3 ? ' is-recent' : ''}">${odMonthShort(m.month)}</span>
    </div>`;
  }).join('')}</div>`;
}

function odMinisHtml(agents, monthly){
  const byAgent = new Map();
  monthly.forEach(r => {
    if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, []);
    byAgent.get(r.agent_id).push(r);
  });
  const max = Math.max(1, ...monthly.map(r => odNum(r.commission)));
  if (!monthly.some(r => odNum(r.commission))) return '<p class="od-muted">עדיין אין עסקאות סגורות ב-12 החודשים האחרונים.</p>';
  return `<div class="od-minis">${agents.map(a => {
    const rows = (byAgent.get(a.agent_id) || []).sort((x, y) => x.month < y.month ? -1 : 1);
    const sum = odSum(rows, 'commission');
    const isPicked = odState.picked === a.agent_id;
    return `<button type="button" class="od-mini${isPicked ? ' is-picked' : ''}${odState.picked && !isPicked ? ' is-dim' : ''}" data-od-pick="${escapeHtml(a.agent_id)}">
      <h4><span>${escapeHtml(a.agent)}</span><b>${odIlsWords(sum)}</b></h4>
      <span class="od-mini-cols" dir="ltr">${rows.map((r, i) => `<i class="${i >= rows.length - 3 ? 'is-recent' : ''}" style="height:${Math.max(odNum(r.commission) ? 4 : 1, odNum(r.commission) / max * 100).toFixed(1)}%" data-od-tip="${escapeHtml(a.agent + ' · ' + odMonthShort(r.month) + ': ' + odIls(r.commission))}"></i>`).join('')}</span>
    </button>`;
  }).join('')}</div>`;
}

function odSourcesHtml(rows){
  if (!rows.length) return '<p class="od-muted">אין לידים בתקופה.</p>';
  return `<table class="od-table"><thead><tr><th>ערוץ</th><th class="n">לידים</th><th class="n">קיבלו מענה${odStar()}</th><th class="n">פגישה או סיור</th><th class="n">ליד→פגישה</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td>${escapeHtml(odChannelLabel(r.source))}</td><td class="n">${odInt(r.leads)}</td>
    <td class="n">${odInt(r.responded)}</td><td class="n">${odInt(r.meetings)}</td>
    <td class="n">${odPct(odNum(r.leads) ? odNum(r.meetings) / odNum(r.leads) : null)}</td></tr>`).join('')}</tbody></table>`;
}

function odExpiringHtml(rows, agents){
  if (!rows.length) return '<p class="od-ok">✓ אין בלעדיות שפוקעת ב-30 הימים הקרובים.</p>';
  const name = id => (agents.find(a => a.agent_id === id) || {}).agent || '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return `<table class="od-table"><thead><tr><th>נכס</th><th>סוכן/ת</th><th>פוקע</th><th class="n">מחיר מבוקש</th><th class="n">ימים בשוק</th><th class="n">הצגות</th></tr></thead>
  <tbody>${rows.map(r => {
    const end = new Date(r.exclusivity_end + 'T00:00:00');
    const days = Math.round((end - today) / 86400000);
    const badge = days <= OD_TH.urgentDays ? '<span class="od-badge bad">דחוף</span>' : '<span class="od-badge warn">בקרוב</span>';
    return `<tr><td><button type="button" class="od-link" data-od-property="${escapeHtml(r.property_id)}">${escapeHtml(r.property || 'נכס')}</button>${r.city ? `<small class="od-sub"> ${escapeHtml(r.city)}</small>` : ''}</td>
      <td>${escapeHtml(name(r.agent_id))}</td>
      <td>${odDateLabel(r.exclusivity_end)} ${badge}</td>
      <td class="n">${r.asking_price ? odIls(r.asking_price) : '-'}</td>
      <td class="n">${odInt(r.days_on_market)}</td>
      <td class="n">${odInt(r.showings)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function odDefsHtml(data){
  const notes = data.data_notes || {};
  const rate = notes.commission_sale_rate ? Math.round(notes.commission_sale_rate * 1000) / 10 : 2;
  return `<footer class="od-foot">
    <div><strong>${odProxy() ? '* זמן תגובה (משוער)' : 'זמן תגובה'}</strong> - ${!odProxy()
      ? 'הזמן מכניסת הליד ועד הפנייה הראשונה של הסוכן/ת: פתיחת הליד, חיוג או וואטסאפ מכרטיס הליד, שיחה מהליד שנענתה או הוחזרה, או השלמת משימת ה-follow-up. ליד בלי אף אחד מאלה נספר "ללא מענה מתועד".'
      : 'הזמן מכניסת הליד ועד שהסוכן/ת פתח/ה אותו או סגר/ה את משימת ה-follow-up שלו ביומן. ליד שנכנס פתוח מראש ולא טופל ביומן נספר "ללא מענה מתועד". מדידה מדויקת יותר בדרך.'}
      ממוצע המשרד משוקלל לפי מספר הלידים.</div>
    <div><strong>גיוס ובלעדיות</strong> - נכס שנוסף למערכת בתקופה הוא גיוס. בלעדיות נספרת מתחילת הסכם הבלעדיות החתום. שיעור הבלעדיות = בלעדיות חלקי גיוסים.</div>
    <div><strong>עסקאות ועמלות (הערכה)</strong> - נכס שסומן נמכר או הושכר בתקופה. העמלה לפי הסכם התיווך החתום על הנכס, ובלעדיו ${rate}% ממחיר המכירה או חודש שכירות.</div>
    <div><strong>הסכמי תיווך</strong> - הזמנות שירותי תיווך שנחתמו (מוכרים/משכירים וקונים/שוכרים). <strong>עמידה ביעד</strong> - עמלות התקופה חלקי היעד. <strong>המרה</strong> - עסקאות חלקי לידים באותה תקופה.</div>
  </footer>`;
}

/* ==========================================================================
   5. חיווט
   ========================================================================== */
function odPick(id){
  odState.picked = (!id || odState.picked === id) ? null : id;
  renderOfficeDashboard();
}

async function odSaveTarget(input){
  const agentId = input.dataset.odTarget;
  const range = odPeriodRange(odState.period);
  const agent = (odState.data.agents || []).find(a => a.agent_id === agentId);
  if (!range.kind || !agent || !currentAgent) return;
  const raw = input.value.trim();
  const value = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
  const prev = agent.commission_target == null ? null : Math.round(odNum(agent.commission_target));
  if (value === prev || (raw !== '' && !Number.isFinite(value))) return;
  input.disabled = true;
  let error;
  if (value == null){
    ({ error } = await sb.from('agent_targets').update({ commission_target: null })
      .eq('agent_id', agentId).eq('period_kind', range.kind).eq('period_start', range.start));
  } else {
    ({ error } = await sb.from('agent_targets').upsert({
      agency_id: currentAgent.agency_id, agent_id: agentId,
      period_kind: range.kind, period_start: range.start, commission_target: value,
    }, { onConflict: 'agent_id,period_kind,period_start' }));
  }
  input.disabled = false;
  if (error){ showToast('שמירת היעד נכשלה: ' + heErr(error)); return; }
  showToast(value == null ? 'היעד הוסר' : 'היעד נשמר');
  loadOfficeDashboard(true);
}

function odOpenProperty(id){
  const mine = (typeof myPropertyRows !== 'undefined') && myPropertyRows.some(p => p.id === id);
  if (mine && typeof gotoSection === 'function' && typeof openPropertyFromParam === 'function'){
    gotoSection('accProperties');
    openPropertyFromParam(id);
    return;
  }
  // נכס של סוכן/ת אחר/ת במשרד: אין לו כרטיס ב"הנכסים שלי", ולכן דף הנכס
  window.open('/property?id=' + encodeURIComponent(id), '_blank', 'noopener');
}

(function wireOfficeDashboard(){
  const acc = document.getElementById('accOfficeDashboard');
  const host = document.getElementById('officeDash');
  if (!acc || !host) return;
  acc.addEventListener('toggle', () => { if (acc.open) loadOfficeDashboard(); });

  host.addEventListener('click', e => {
    const per = e.target.closest('[data-od-period]');
    if (per){
      odState.period = per.dataset.odPeriod;
      try{ localStorage.setItem(OD_PERIOD_KEY, odState.period); }catch(err){}
      loadOfficeDashboard(true);
      return;
    }
    if (e.target.closest('[data-od-refresh]')){ loadOfficeDashboard(true); return; }
    if (e.target.closest('[data-od-more]')){ odState.allAdvice = true; renderOfficeDashboard(); return; }
    if (e.target.closest('[data-od-unpick]')){ odPick(null); return; }
    const sort = e.target.closest('[data-od-sort]');
    if (sort){
      const k = sort.dataset.odSort;
      odState.sort = { k, dir: odState.sort.k === k ? -odState.sort.dir : (k === 'agent' || k === 'avg_response_min' ? 1 : -1) };
      renderOfficeDashboard();
      return;
    }
    const prop = e.target.closest('[data-od-property]');
    if (prop){ odOpenProperty(prop.dataset.odProperty); return; }
    if (e.target.closest('input')) return;
    const pick = e.target.closest('[data-od-pick]');
    if (pick){ odPick(pick.dataset.odPick); return; }
    const row = e.target.closest('[data-od-row]');
    if (row) odPick(row.dataset.odRow);
  });

  host.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('[data-od-row]');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); odPick(row.dataset.odRow); }
    if (e.target.matches && e.target.matches('.od-target') && e.key === 'Enter') e.target.blur();
  });

  host.addEventListener('input', e => {
    if (e.target.id !== 'odSearch') return;
    odState.search = e.target.value;
    const wrap = e.target.closest('.od-sec').querySelector('.od-tablewrap');
    if (wrap && odState.view) wrap.innerHTML = odTableHtml(odState.view.agents, odPeriodRange(odState.period));
  });

  host.addEventListener('focusout', e => {
    if (e.target.matches && e.target.matches('.od-target')) odSaveTarget(e.target);
  });

  // טולטיפ אחד לכל הגרפים: ‏data-od-tip על כל סימן
  let tip = null;
  const showTip = (el, x, y) => {
    if (!tip){ tip = document.createElement('div'); tip.className = 'od-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = el.dataset.odTip;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  host.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-od-tip]');
    if (el) showTip(el, e.clientX, e.clientY);
    else if (tip) tip.classList.remove('on');
  });
  host.addEventListener('mouseleave', () => { if (tip) tip.classList.remove('on'); });
})();
