/* ==========================================================================
   הדשבורד שלי — הדשבורד האישי של הסוכן/ת (accMyDashboard)
   --------------------------------------------------------------------------
   לכל סוכן/ת, כולל מנהלים (שרואים כאן את המספרים האישיים שלהם). הנתונים
   מקריאה אחת: my_dashboard(p_from, p_to) במסד
   (20270406090000_my_dashboard.sql), שעובדת רק על current_agent_id() -
   אין לה פרמטר של סוכן/ת. המספרים האישיים מאותה פונקציית עזר כמו בדאשבורד
   המשרד, ולכן שני הדאשבורדים לא יכולים להראות מספרים שונים.

   **פרטיות:** העצות, ההישגים ומשפט היום - רק כאן. מנהל/ת המשרד רואה את
   המספרים בדאשבורד המשרד, לא את הדף הזה. ההשוואה היא לממוצע המשרד בלבד,
   בלי שמות ובלי דירוג, ורק משלושה סוכנים ומעלה; במשרד קטן יותר ההשוואה
   היא לתקופה הקודמת שלי.

   הקובץ נטען אחרי assets/crm-office-dashboard.js ומשתמש בעזרים שלו
   (odNum, odIls, odPct, odDur, odCount, odSparkSvg, odRecruitHtml,
   odPeriodRange, OD_BUCKETS ועוד) - אותו עיצוב (.od) ואותו פורמט מספרים.
   ‏docs/my-dashboard.md
   ========================================================================== */

const MD_PERIOD_KEY = 'crmMyDashPeriod';
const MD_PERIODS = [
  { key:'q_cur', label:'רבעון נוכחי' },
  { key:'m_cur', label:'החודש' },
  { key:'d90',   label:'90 יום' },
  { key:'y',     label:'שנה' },
];

/* משפט היום. אחד ליום, יציב לכל היום (לפי התאריך בישראל, לא לפי הרענון).
   מקוריים, קצרים ומעשיים, בלי קלישאות מתורגמות. ניסוח ניטרלי או עם לוכסן. */
const MD_QUOTES = [
  'הלקוח/ה זוכר/ת מי ענה ראשון.',
  'בלעדיות אחת שווה יותר מעשרה לידים קרים.',
  'כל שיחה היום היא עסקה שאולי תיסגר בעוד שלושה חודשים.',
  'עקביות מנצחת כישרון. עוד שיחה אחת לפני סוף היום.',
  'אנשים לא קונים דירה, הם קונים ביטחון. ואת הביטחון נותנים בהקשבה.',
  'הנכס הבא שתגייס/י כבר מחכה במעגל המכרים שלך.',
  'לא צריך יום מושלם. צריך יום אחד טוב, ועוד אחד אחריו.',
  'מי שמתקשר/ת שוב אחרי "לא עכשיו" סוגר/ת את העסקאות של הרבעון הבא.',
  'הכי מהר להצליח זה להיות הכי קל לעבוד איתך.',
  'שיא חדש מתחיל בשבירת שיא קטן. של אתמול.',
  'מחיר נכון מוכר מהר יותר משיווק מבריק.',
  'הודעת "קיבלתי, חוזר/ת אליך עד חמש" שווה יותר מתשובה מושלמת מחר.',
  'בעל/ת נכס לא בוחר/ת את המתווך/ת הכי זול/ה, אלא את מי שהכי מוכן/ה.',
  'דוח CMA על השולחן עושה חצי מהשכנוע לבד.',
  'פגישה שנקבעה היום היא הסכם שייחתם השבוע.',
  'כל "לא" מקרב אותך ל"כן" הבא. תרשום/תרשמי למה, ותמשיך/י.',
  'הסוד של מתווכים טובים: יומן מלא בצעדים הבאים, לא בתקוות.',
  'תשאל/י עוד שאלה אחת. התשובה שלה היא הנכס שהלקוח/ה באמת מחפש/ת.',
  'הלקוחות של מחר הם השכנים של הלקוחות של היום.',
  'נכס בלי תמונות טובות הוא נכס שמחכה. עשר דקות של צילום חוסכות חודש.',
  'כשהשוק איטי, מי שמתקשר/ת ראשון/ה מנצח/ת. כשהוא מהיר, גם.',
  'בלעדיות היא לא חתימה. היא הבטחה שעובדים בשבילה כל שבוע.',
  'עדכון שבועי לבעל/ת הנכס הופך בלעדיות אחת לשלוש המלצות.',
  'מה שנמדד משתפר. מה שנכתב ביומן קורה.',
  'הסיור הכי טוב מתחיל בשאלה מה חשוב לך, לא במטבח.',
  'עסקה נסגרת כשהלקוח/ה מרגיש/ה שמישהו/י עובד/ת בשבילו/ה.',
  'ליד שנענה תוך חמש דקות שווה פי כמה מליד שנענה אחרי שעה.',
  'שלוש שיחות יזומות ביום הן שישים בחודש. מספיק כדי לשנות רבעון.',
  'הרבעון הטוב שלך נבנה בימים הרגילים שלו.',
  'תחגוג/י כל הסכם חתום. הוא לא מובן מאליו.',
];

const MD_LEAD_TYPES = {
  owner_inbound:    'בעל/ת נכס',
  property_inquiry: 'פנייה על נכס',
  visualization:    'הדמיה',
};
const MD_AGR_KINDS = {
  buy:'קנייה', sell:'מכירה', tenant:'שכירות', landlord:'השכרה',
  exclusive_sell:'בלעדיות מכירה', exclusive_landlord:'בלעדיות השכרה',
};

const mdState = { period: 'q_cur', data: null, busy: false, loadedFor: null };
try{
  const saved = localStorage.getItem(MD_PERIOD_KEY);
  if (MD_PERIODS.some(p => p.key === saved)) mdState.period = saved;
}catch(e){ /* מצב פרטי - ברירת המחדל */ }

/* ==========================================================================
   1. חישובים טהורים
   ========================================================================== */
function mdIsraelDayIndex(){
  // מספר הימים מאז 1970 לפי השעון בישראל: המשפט מתחלף בחצות שלנו, לא ב-UTC
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit' })
    .format(new Date()).split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 864e5);
}

function mdQuote(){ return MD_QUOTES[mdIsraelDayIndex() % MD_QUOTES.length]; }

function mdGreeting(name){
  const now = new Date();
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour:'numeric', hourCycle:'h23', timeZone:'Asia/Jerusalem' }).format(now));
  const wd = new Intl.DateTimeFormat('en-US', { weekday:'short', timeZone:'Asia/Jerusalem' }).format(now);
  let g = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  if ((wd === 'Fri' && h >= 12) || (wd === 'Sat' && h < 19)) g = 'שבת שלום';
  else if (wd === 'Sat') g = 'שבוע טוב';
  else if (wd === 'Sun' && h < 12) g = 'שבוע חדש, הזדמנות חדשה';
  return name ? g + ', ' + name : g;
}

/* מי קובע/ת את היעד. מנהל/ת משרד קובע/ת אותו בעצמו/ה, בדאשבורד המשרד;
   "לקבוע עם מנהל/ת המשרד" היה שולח אותו/ה לדבר עם עצמו/ה. */
function mdTargetHint(){
  const mgr = typeof currentAgent !== 'undefined' && currentAgent && currentAgent.role === 'manager';
  return mgr ? 'את היעד קובעים בדאשבורד המשרד, בטבלת הסוכנים.' : 'יעד נקבע עם מנהל/ת המשרד, לחודש או לרבעון.';
}

/* יחס בטוח: null כשאין מכנה, ולא 0 - "אין נתונים" אינו "אפס אחוז" */
function mdRatio(a, b){ const d = odNum(b); return d ? odNum(a) / d : null; }

function mdDerive(data){
  const me = data.me || {};
  const avg = data.office_avg || null;
  const hasAvg = !!(avg && odNum(avg.agents) >= 3);
  const target_pct = me.commission_target ? odNum(me.commission) / odNum(me.commission_target) : null;
  const gap = me.commission_target ? Math.max(0, odNum(me.commission_target) - odNum(me.commission)) : null;
  const avg_deal = odNum(me.deals) ? odNum(me.commission) / odNum(me.deals) : null;

  // ההשוואה: ממוצע המשרד כשיש, אחרת התקופה הקודמת שלי
  const base = hasAvg ? avg : {
    leads: me.leads_prev, responded: me.responded_prev, fast_15: me.fast_15_prev, meetings: me.meetings_prev,
    agreements: me.agreements_prev, recruited: me.recruited_prev, exclusives: me.exclusives_prev,
    deals: me.deals_prev, avg_response_min: me.avg_response_min_prev,
  };
  const benchmarks = [
    { id:'fast',  label:'מענה תוך 15 דק׳', hint:'מהירות',             me: mdRatio(me.fast_15, me.leads),           base: mdRatio(base.fast_15, base.leads) },
    { id:'meet',  label:'ליד לפגישה',       hint:'פגישות חלקי לידים',  me: mdRatio(me.meetings, me.leads),          base: mdRatio(base.meetings, base.leads) },
    { id:'agree', label:'פגישה להסכם',      hint:'הסכמים חלקי פגישות', me: mdRatio(me.agreements, me.meetings),     base: mdRatio(base.agreements, base.meetings) },
    { id:'excl',  label:'גיוס לבלעדיות',    hint:'שיעור בלעדיות',      me: mdRatio(me.exclusives, me.recruited),    base: mdRatio(base.exclusives, base.recruited) },
    { id:'conv',  label:'ליד לעסקה',        hint:'המרה',               me: mdRatio(me.deals, me.leads),             base: mdRatio(base.deals, base.leads) },
  ].map(b => Object.assign(b, {
    me:   b.me   == null ? null : Math.min(1, b.me),
    base: b.base == null ? null : Math.min(1, b.base),
  }));

  const steps = ['leads','responded','meetings','agreements','deals'];
  const names = ['לידים','קיבלו מענה','פגישות וסיורים','הסכמי תיווך','עסקאות'];
  const funnel = steps.map((k, i) => ({
    stage: names[i], order: i + 1, count: odNum(me[k]),
    step_rate: i ? mdRatio(me[k], me[steps[i - 1]]) : null,
    base_rate: i ? mdRatio(base[k], base[steps[i - 1]]) : null,
  }));

  return { me, avg, hasAvg, base, target_pct, gap, avg_deal, benchmarks, funnel,
           commission_chg: odChg(me.commission, me.commission_prev),
           todo: mdTodo(data) };
}

/* "מה יקדם אותך היום": משימות אמיתיות, ממוינות לפי דחיפות. ‏urgency 2 = עכשיו,
   1 = היום, 0 = כשאפשר. כל משימה נושאת את מה שצריך כדי לפתוח את הפריט. */
function mdTodo(data){
  const t = data.todo || {};
  const out = [];
  const now = Date.now();
  (t.leads || []).forEach(l => {
    const mins = (now - new Date(l.created_at).getTime()) / 60000;
    out.push({ kind:'lead', ref:l.ref_id, urgency: mins > 15 ? 2 : 1,
      title: 'ליד מחכה ' + (mins < 60 ? Math.max(1, Math.round(mins)) + ' דק׳' : odDur(mins)),
      detail: [MD_LEAD_TYPES[l.lead_type] || 'ליד', l.property, l.city].filter(Boolean).join(' · '),
      due: 'עכשיו', cta: 'לליד' });
  });
  (t.exclusivity || []).forEach(x => {
    const days = Math.round((new Date(x.ends_on + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
    out.push({ kind:'property', ref:x.ref_id, urgency: days <= 14 ? 2 : 1,
      title: days <= 0 ? 'בלעדיות פוקעת היום' : 'בלעדיות פוקעת בעוד ' + odCount(days, 'יום אחד', 'ימים'),
      detail: [x.property, x.city, odCount(x.showings, 'הצגה אחת', 'הצגות') + ' ב-' + odCount(x.days_on_market, 'יום אחד', 'ימים')].filter(Boolean).join(' · '),
      due: days <= 14 ? 'השבוע' : 'החודש', cta: 'לנכס' });
  });
  (t.agreements || []).forEach(g => {
    const days = Math.floor((now - new Date(g.sent_at).getTime()) / 864e5);
    out.push({ kind:'agreement', ref:g.ref_id, urgency: days >= 3 ? 1 : 0,
      title: 'הסכם ' + (MD_AGR_KINDS[g.agreement_kind] || 'תיווך') + ' נשלח ולא נחתם',
      detail: [g.property, days ? 'נשלח לפני ' + odCount(days, 'יום אחד', 'ימים') : 'נשלח היום', g.viewed ? 'נצפה' : 'עוד לא נפתח'].filter(Boolean).join(' · '),
      due: 'היום', cta: 'להסכם' });
  });
  (t.agenda || []).forEach(a => {
    const late = new Date(a.due_at).getTime() < now;
    out.push({ kind:'agenda', ref:a.ref_id, urgency: late ? 2 : 1,
      title: a.title || 'משימה ביומן',
      detail: (late ? 'באיחור · ' : '') + new Date(a.due_at).toLocaleString('he-IL', { weekday:'short', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jerusalem' }),
      due: late ? 'באיחור' : 'היום', cta: 'ליומן' });
  });
  // ההתאמות החכמות כבר נספרות ב-CRM (accAlerts); לא סופרים אותן פעם שנייה במסד
  const matches = (typeof accCountOf === 'function') ? accCountOf('accAlerts') : 0;
  if (matches > 0){
    out.push({ kind:'matches', ref:null, urgency:1,
      title: odCount(matches, 'התאמה חכמה אחת', 'התאמות חכמות'),
      detail: 'לקוחות מהקובץ שלך שמתאימים לנכסים שעלו', due:'היום', cta:'להתאמות' });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

/* כותרת המוטיבציה ותגיות ההישג. בלי מין דקדוקי במסד, ולכן ניסוח עם לוכסן.
   מתחת ל-70% הניסוח מעודד ולא מאשים. */
function mdMotivation(v){
  const me = v.me;
  let headline, sub;
  if (v.target_pct != null && v.target_pct >= 1){
    headline = 'עברת את היעד! ' + odPct(v.target_pct) + ' ממנו';
    const best = odNum(me.best_quarter_commission);
    sub = odIls(me.commission) + ' בתקופה. ' + (odNum(me.commission) >= best && best > 0
      ? 'זה הרבעון הכי טוב שלך עד היום.'
      : best > 0 ? 'השיא הרבעוני שלך הוא ' + odIls(best) + '.' : '');
  } else if (v.target_pct != null && v.target_pct >= 0.7){
    const deals = v.avg_deal ? Math.max(1, Math.ceil(v.gap / v.avg_deal)) : null;
    headline = 'את/ה ב-' + odPct(v.target_pct) + ' מהיעד. הסוף בהישג יד';
    sub = 'חסרים ' + odIls(v.gap) + (deals ? ' - בערך ' + odCount(deals, 'עסקה אחת', 'עסקאות') + ' בגודל הממוצע שלך.' : '.');
  } else if (v.target_pct != null){
    headline = 'כל רבעון מתחיל בצעד אחד. בוא/י נעשה אותו היום';
    sub = 'את/ה ב-' + odPct(v.target_pct) + ' מהיעד. המשימות למטה הן הדרך הכי קצרה לשם.';
  } else if (odNum(me.deals) || odNum(me.agreements) || odNum(me.recruited)){
    headline = odNum(me.commission) ? odIlsWords(me.commission) + ' בעמלות בתקופה' : 'התקופה שלך במספרים';
    sub = [odNum(me.deals) ? odCount(me.deals, 'עסקה אחת', 'עסקאות') : null,
           odNum(me.agreements) ? odCount(me.agreements, 'הסכם אחד', 'הסכמים') : null,
           odNum(me.recruited) ? odCount(me.recruited, 'גיוס אחד', 'גיוסים') : null].filter(Boolean).join(', ') +
          '. עוד אין יעד לתקופה. ' + mdTargetHint();
  } else {
    headline = 'כל רבעון מתחיל בצעד אחד. בוא/י נעשה אותו היום';
    sub = 'המשימות למטה הן נקודת הפתיחה הכי טובה.';
  }
  const chips = [];
  if (odNum(me.fast_streak_days) >= 3) chips.push({ gold:true, text: odCount(me.fast_streak_days, 'יום אחד', 'ימים') + ' ברצף עם מענה תוך 15 דק׳' });
  if (v.commission_chg != null && v.commission_chg !== Infinity && v.commission_chg > 0)
    chips.push({ gold:true, text: 'עמלות ' + odSignedPct(v.commission_chg) + ' מהתקופה הקודמת' });
  if (v.hasAvg && me.avg_response_min != null && v.avg.avg_response_min != null && odNum(me.avg_response_min) < odNum(v.avg.avg_response_min))
    chips.push({ gold:false, text:'עונה מהר יותר מממוצע המשרד' });
  if (v.hasAvg && odNum(me.deals) > odNum(v.avg.deals))
    chips.push({ gold:false, text: odCount(me.deals, 'עסקה אחת', 'עסקאות') + ', מעל ממוצע המשרד' });
  return { headline, sub, chips };
}

/* עצות אישיות: היחס החלש ביותר מול הבסיס (ממוצע המשרד או התקופה הקודמת),
   הדחוף של היום, החוזקה הבולטת, לידים פתוחים, והרגל שבועי. */
function buildAgentTips(v){
  const me = v.me;
  const out = [];
  const baseName = v.hasAvg ? 'ממוצע המשרד' : 'התקופה הקודמת שלך';
  const rated = v.benchmarks.filter(b => b.me != null && b.base != null);
  const gaps = rated.map(b => Object.assign({}, b, { gap: b.me - b.base })).sort((x, y) => x.gap - y.gap);
  const weak = gaps[0], strong = gaps[gaps.length - 1];
  const lib = {
    fast:  { icon:'⚡', title:'לענות מהר יותר מכולם', steps:['להפעיל התראות לידים בטלפון', 'תבנית תשובה ראשונה בוואטסאפ', 'שני חלונות קבועים ביום לטיפול בלידים'] },
    meet:  { icon:'☎', title:'להפוך יותר שיחות לפגישות', steps:['להציע שני מועדים כבר בשיחה הראשונה', 'לשלוח מיניסייט עם 3 נכסים מתאימים תוך שעה', 'אישור ותזכורת אוטומטיים ללקוח/ה מהיומן'] },
    agree: { icon:'✎', title:'להחתים לפני הסיור', steps:['לשלוח הזמנת שירותי תיווך דיגיטלית יחד עם אישור הפגישה', 'להסביר במשפט אחד מה הלקוח/ה מקבל/ת'] },
    excl:  { icon:'◆', title:'להגיע לפגישת גיוס עם הצעה שקשה לסרב לה', steps:['דוח CMA ממותג על הנכס', 'להראות סרטון שיווקי והדמיות שבלעדיות פותחת', 'להחתים דיגיטלית עוד בפגישה'] },
    conv:  { icon:'↗', title:'לסגור יותר מהצנרת שכבר יש לך', steps:['רשימה שבועית של כל לקוח/ה עם הסכם חתום וצעד הבא ביומן', 'לחזור תוך 3 ימים לכל מי שראה/תה נכס'] },
  };
  if (weak && weak.gap < -0.02){
    const L = lib[weak.id];
    const unit = weak.id === 'excl' ? odNum(me.recruited) : weak.id === 'agree' ? odNum(me.meetings) : odNum(me.leads);
    const more = Math.round((weak.base - weak.me) * unit);
    out.push({ priority:1, icon:L.icon, area:'ההזדמנות הכי גדולה שלך', owner: weak.label, title: L.title,
      body:`ב"${weak.label}" את/ה ב-${odPct(weak.me)}, ו${baseName} ${odPct(weak.base)}. זה המקום שבו שיפור קטן יזיז לך הכי הרבה.`,
      steps: L.steps,
      impact: more >= 1 ? `הערכה: סגירת הפער = בערך ${more} ${weak.id === 'excl' ? 'בלעדיות' : weak.id === 'agree' ? 'הסכמים' : weak.id === 'meet' ? 'פגישות' : weak.id === 'fast' ? 'לידים שנענים מהר' : 'עסקאות'} נוספות בתקופה כזו` : 'מדד הצלחה: לסגור את הפער עד סוף התקופה' });
  }
  const urgent = v.todo.filter(t => t.urgency === 2).length;
  if (urgent){
    out.push({ priority:1, icon:'!', area:'להיום', owner: odCount(urgent, 'משימה דחופה אחת', 'משימות דחופות'),
      title:'להתחיל את היום מהדחוף',
      body: (urgent === 1 ? 'יש דבר אחד' : `יש ${urgent} דברים`) + ' שמחכים לך ושעלולים לברוח: ליד שלא נענה, בלעדיות שעומדת לפקוע או משימה באיחור.',
      steps:['קודם הלידים, אחר כך שיחת החידוש', 'לקבוע ביומן מועד לפגישת חידוש עם דוח פעילות'],
      impact:'עשר דקות עכשיו חוסכות עסקה אבודה' });
  }
  if (strong && strong.gap > 0.02){
    out.push({ priority:3, icon:'★', area:'החוזקה שלך', owner: strong.label,
      title:`את/ה מעל ${v.hasAvg ? 'המשרד' : 'התקופה הקודמת'} ב"${strong.label}"`,
      body:`${odPct(strong.me)} מול ${odPct(strong.base)}. זה עובד - כדאי לשמר את ההרגל${v.hasAvg ? ', ואולי לשתף אותו בישיבת הצוות' : ''}.`,
      steps:[], impact:'חוזקה שמשתפים הופכת למוניטין' });
  }
  if (odNum(me.open_unanswered) > 0){
    out.push({ priority:2, icon:'⏱', area:'לידים פתוחים', owner: odCount(me.open_unanswered, 'ליד אחד', 'לידים') + ' ללא מענה',
      title:'לסגור את הלידים הפתוחים',
      body:'יש לידים מהחודש האחרון שעוד לא קיבלו מענה. גם תשובה קצרה של "קיבלתי, אחזור אליך עד 17:00" שומרת אותם חמים.',
      steps:['לעבור על הרשימה ב"הלידים שלי", וללחוץ "חיוג" או "וואטסאפ" מהכרטיס'],
      impact:'הלחיצה מהכרטיס היא גם מה שנרשם כזמן התגובה שלך' });
  }
  out.push({ priority:2, icon:'↻', area:'הרגל שבועי', owner:'יום ראשון בבוקר',
    title:'15 דקות של תכנון שבועי',
    body:'שלוש שאלות בכל יום ראשון: אילו בלעדיות פוקעות החודש, מי מהלקוחות לא שמע/ה ממני שבועיים, ואיזה נכס צריך עדכון מחיר.',
    steps:[], impact:'עקביות מנצחת כישרון' });
  return out.sort((a, b) => a.priority - b.priority);
}

/* הישגים: מחושבים מהנתונים בכל טעינה, לא נשמרים. ‏progress בין 0 ל-1. */
function mdAchievements(v, monthly){
  const me = v.me;
  const last = monthly[monthly.length - 1] || {};
  const lastFast = mdRatio(last.fast_15, last.leads);
  const list = [
    { title:'ברק', desc:'80% מהלידים נענו תוך 15 דק׳ החודש', p: lastFast == null ? 0 : lastFast / 0.8 },
    { title:'מלך/ת הבלעדיות', desc:'5 בלעדיות בתקופה', p: odNum(me.exclusives) / 5 },
    me.commission_target ? { title:'מעל היעד', desc:'עברת את יעד העמלות', p: v.target_pct || 0 } : null,
    { title:'שמונה עסקאות', desc:'8 עסקאות בתקופה', p: odNum(me.deals) / 8 },
    { title:'רצף של שבוע', desc:'7 ימים ברצף עם מענה תוך 15 דק׳', p: odNum(me.fast_streak_days) / 7 },
    { title:'חותמת', desc:'10 הסכמי תיווך בתקופה', p: odNum(me.agreements) / 10 },
  ].filter(Boolean);
  return list.map(a => Object.assign(a, { p: Math.max(0, Math.min(1, a.p)), earned: a.p >= 1 }));
}

/* ==========================================================================
   2. טעינה
   ========================================================================== */
async function loadMyDashboard(force){
  const host = document.getElementById('myDash');
  if (!host) return;
  const key = mdState.period;
  if (!force && mdState.data && mdState.loadedFor === key){ renderMyDashboard(); return; }
  if (mdState.busy) return;
  mdState.busy = true;
  if (!mdState.data) host.innerHTML = odSkeleton();
  else host.classList.add('od-refreshing');
  const range = odPeriodRange(key);
  const { data, error } = await sb.rpc('my_dashboard', { p_from: range.from, p_to: range.to });
  mdState.busy = false;
  host.classList.remove('od-refreshing');
  if (error){
    const missing = error.code === 'PGRST202' || /my_dashboard/.test(error.message || '') && /not find|does not exist/.test(error.message || '');
    host.innerHTML = '<div class="od-error">' + escapeHtml(missing
      ? 'הדשבורד עדיין לא קיים במסד. הוא נוצר אוטומטית עם המיזוג של המיגרציה 20270406090000_my_dashboard.sql.'
      : 'טעינת הדשבורד נכשלה: ' + heErr(error)) + '</div>';
    return;
  }
  mdState.data = data || {};
  mdState.loadedFor = key;
  renderMyDashboard();
}

/* ==========================================================================
   3. ציור
   ========================================================================== */
function renderMyDashboard(){
  const host = document.getElementById('myDash');
  if (!host || !mdState.data) return;
  const data = mdState.data;
  const v = mdDerive(data);
  const me = v.me;
  const monthly = data.my_monthly || [];
  const range = odPeriodRange(mdState.period);
  const mot = mdMotivation(v);
  const tips = buildAgentTips(v);
  const badges = mdAchievements(v, monthly);

  if (typeof accSetSummary === 'function'){
    const urgent = v.todo.filter(t => t.urgency === 2).length;
    accSetSummary('accMyDashboard', [
      urgent ? odCount(urgent, 'משימה דחופה', 'משימות דחופות') : null,
      v.target_pct != null ? odPct(v.target_pct) + ' מהיעד' : null,
      odNum(me.commission) ? odIlsWords(me.commission) + ' בעמלות' : null,
    ].filter(Boolean).join(' · '));
  }

  const C = 2 * Math.PI * 48;
  const ring = v.target_pct == null ? 0 : Math.min(1, v.target_pct);
  const best = monthly.reduce((b, m) => odNum(m.commission) > odNum(b.commission || 0) ? m : b, {});
  const vsLabel = v.hasAvg ? 'ממוצע המשרד' : 'התקופה הקודמת';

  host.innerHTML = `
  <div class="od md${mdState.firstPaintDone ? '' : ' od-first'}" dir="rtl">
    <div class="od-brand">
      <div class="od-logo"><img src="/assets/logo-shuknadlan.svg" alt="">
        <div><b>הדשבורד שלי</b><small>פרטי - רק את/ה רואה אותו</small></div></div>
      <div class="od-chips">
        <span class="od-chip">${escapeHtml(odRangeLabel(data.period))} · מול ${escapeHtml(odRangeLabel({ from: (data.period || {}).prev_from, to: (data.period || {}).prev_to }))}</span>
        <div class="od-periods" role="group" aria-label="בחירת תקופה">
          ${MD_PERIODS.map(p => `<button type="button" data-md-period="${p.key}" aria-pressed="${p.key === mdState.period}">${p.label}</button>`).join('')}
        </div>
        <button type="button" class="od-refresh" data-md-refresh aria-label="רענון הנתונים" title="רענון">↻</button>
      </div>
    </div>

    <header class="od-hero">
      <div class="od-hero-main">
        <p class="od-hello">${escapeHtml(mdGreeting(me.first_name || ''))}</p>
        <h2 class="od-title">${escapeHtml(mot.headline)}</h2>
        <p class="od-take">${escapeHtml(mot.sub)}</p>
        ${mot.chips.length ? `<div class="md-chips">${mot.chips.map(c => `<span class="md-chip${c.gold ? ' gold' : ''}">${escapeHtml(c.text)}</span>`).join('')}</div>` : ''}
        <p class="md-quote">${escapeHtml(mdQuote())}<small>משפט היום</small></p>
      </div>
      <div class="od-side">
        <div class="md-goal">
          <div class="ring"><svg viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="48" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="10"/>${v.target_pct != null
            ? `<circle cx="56" cy="56" r="48" fill="none" stroke="#c9a227" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(ring * C).toFixed(1)} ${C.toFixed(1)}"/>` : ''}</svg>
            <span>${v.target_pct != null ? odPct(v.target_pct) + '<small>מהיעד</small>' : '<small>אין יעד<br>לתקופה</small>'}</span></div>
          <div>
            <div class="t">✦ העמלות שלך בתקופה</div>
            <div class="v">${odIls(me.commission)}</div>
            <div class="s">${v.target_pct == null ? escapeHtml(mdTargetHint())
              : v.gap > 0 ? `חסרים <b>${odIls(v.gap)}</b> ליעד של ${odIls(me.commission_target)}`
              : `<b>${odIls(odNum(me.commission) - odNum(me.commission_target))}</b> מעל היעד`}</div>
          </div>
        </div>
        <div class="od-spark">
          <div class="od-spark-h"><span>העמלות שלך · 12 חודשים</span><span>${odNum(best.commission) ? 'החודש הכי טוב: ' + escapeHtml(odMonthShort(best.month)) : 'הערכה'}</span></div>
          <div class="od-spark-c">${odSparkSvg(monthly.map(m => odNum(m.commission)))}</div>
        </div>
      </div>
    </header>

    <section class="od-sec">
      <div class="od-sec-h"><h2>מה יקדם אותך היום</h2><p>ממוין לפי דחיפות · כל משימה פותחת את הפריט עצמו</p></div>
      ${mdTodoHtml(v.todo)}
    </section>

    ${mdKpisHtml(v, vsLabel)}

    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>איפה את/ה חזק/ה ואיפה יש מקום לצמוח</h3>
          <p>${v.hasAvg ? 'היחסים שלך מול ממוצע המשרד - בלי שמות ובלי דירוג. רק את/ה רואה את ההשוואה הזו.'
            : 'במשרד יש פחות משלושה סוכנים, ולכן ההשוואה היא לתקופה הקודמת שלך ולא לממוצע.'}</p></div>
        ${odLegend([['var(--od-sap)', 'את/ה'], ['var(--od-brass)', vsLabel]])}
        ${mdBenchHtml(v.benchmarks)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>מהירות התגובה שלך, חודש אחר חודש</h3>
          <p>זמן ממוצע עד הפנייה הראשונה לליד. הקו המקווקו הוא היעד: 15 דקות.</p></div>
        ${mdSpeedHtml(monthly)}
      </div>
    </section>

    <section class="od-sec">
      <div class="od-sec-h"><h2>עצות אישיות לצמיחה</h2><p>נגזרות מהנתונים שלך · מתעדכנות עם התקופה</p></div>
      ${odAdviceHtml(tips, mdState.allTips)}
    </section>

    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>המשפך שלך: מליד לעסקה</h3>
          <p>מתחת לכל שלב: כמה מהשלב הקודם עברו, ובסוגריים ${vsLabel}.</p></div>
        ${mdFunnelHtml(v.funnel)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>הגיוסים שלך, 12 חודשים</h3><p>כל עמודה היא נכסים שגייסת בחודש; החלק הכהה בבלעדיות.</p></div>
        ${odLegend([['var(--od-sap)', 'בבלעדיות'], ['var(--od-sap-soft)', 'בלי בלעדיות']])}
        ${odRecruitHtml(monthly)}
      </div>
    </section>

    <section class="od-sec">
      <div class="od-sec-h"><h2>הישגים</h2><p>מה כבר השגת ומה ממש קרוב</p></div>
      <div class="md-badges">${badges.map(b => `
        <div class="md-badge${b.earned ? ' on' : ''}">
          <span class="md-medal" aria-hidden="true">${b.earned ? '★' : Math.round(b.p * 100) + '%'}</span>
          <h4>${escapeHtml(b.title)}</h4><p>${escapeHtml(b.desc)}</p>
          <span class="md-prog" role="img" aria-label="${Math.round(b.p * 100)}%"><i style="width:${Math.round(b.p * 100)}%"></i></span>
        </div>`).join('')}</div>
    </section>

    <footer class="od-foot">
      <div><strong>פרטיות</strong> - הדשבורד הזה אישי. מנהל/ת המשרד רואה את המספרים שלך בדאשבורד המשרד, אבל לא את העצות, ההישגים או המשפטים כאן.</div>
      <div><strong>${escapeHtml(vsLabel)}</strong> - ${v.hasAvg ? 'ממוצע כל הסוכנים הפעילים במשרד באותה תקופה. בלי שמות ובלי דירוג.' : 'המספרים שלך בתקופה באותו אורך, מיד לפני התקופה שנבחרה.'}</div>
      <div><strong>זמן תגובה</strong> - מכניסת הליד ועד הפנייה הראשונה שלך: פתיחת הליד, חיוג או וואטסאפ מהכרטיס, שיחה מהליד שענית לה או שחזרת אליה, או השלמת ה-follow-up ביומן.</div>
      <div><strong>עמלות (הערכה)</strong> - לפי הסכם התיווך החתום על הנכס, ובלעדיו 2% ממחיר המכירה או חודש שכירות.</div>
    </footer>
  </div>`;
  mdState.firstPaintDone = true;
}

function mdTodoHtml(todo){
  if (!todo.length) return '<p class="od-ok">✓ אין כרגע משימות פתוחות. זה הזמן לשיחה יזומה ללקוח/ה שלא שמע/ה ממך זמן מה.</p>';
  const icons = { lead:'⚑', property:'◆', agreement:'✎', agenda:'◷', matches:'◎' };
  return `<div class="md-todo">${todo.slice(0, 9).map(t => `
    <div class="md-task u${t.urgency}">
      <span class="ic" aria-hidden="true">${icons[t.kind] || '•'}</span>
      <h4>${escapeHtml(t.title)}</h4>
      <p>${escapeHtml(t.detail)}</p>
      <div class="row"><span class="due">${escapeHtml(t.due)}</span>
        <button type="button" data-md-open="${t.kind}" data-md-ref="${escapeHtml(t.ref || '')}">${escapeHtml(t.cta)}</button></div>
    </div>`).join('')}</div>`;
}

function mdKpisHtml(v, vsLabel){
  const me = v.me, a = v.hasAvg ? v.avg : null;
  const tile = (label, value, chg, better, accent, avgVal, note) => {
    let cls = '', txt = '-';
    if (chg === Infinity){ txt = 'חדש'; cls = better === 'up' ? 'good' : ''; }
    else if (chg != null){ txt = odSignedPct(chg); if (chg !== 0) cls = ((chg > 0) === (better === 'up')) ? 'good' : 'bad'; }
    return `<div class="od-kpi" style="--kpi-accent:${accent}">
      <span class="od-kpi-label">${label}${note ? ' <em>' + note + '</em>' : ''}</span>
      <span class="od-kpi-value">${value}</span>
      <span class="od-kpi-delta"><span class="${cls}">${txt}</span><span class="vs">מול התקופה הקודמת</span></span>
      ${avgVal != null ? `<span class="md-avg">ממוצע המשרד: <b>${avgVal}</b></span>` : ''}
    </div>`;
  };
  const dec = n => (Math.round(odNum(n) * 10) / 10).toLocaleString('he-IL');
  return `<section class="od-kpis" aria-label="המדדים שלי">
    ${tile('עסקאות', odInt(me.deals), odChg(me.deals, me.deals_prev), 'up', 'var(--od-brass)', a && dec(a.deals))}
    ${tile('נכסים שגייסת', odInt(me.recruited), odChg(me.recruited, me.recruited_prev), 'up', 'var(--od-sand)', a && dec(a.recruited))}
    ${tile('בלעדיות', odInt(me.exclusives), odChg(me.exclusives, me.exclusives_prev), 'up', 'var(--od-mint)', a && dec(a.exclusives))}
    ${tile('הסכמי תיווך', odInt(me.agreements), odChg(me.agreements, me.agreements_prev), 'up', 'var(--od-sap)', a && dec(a.agreements))}
    ${tile('לידים', odInt(me.leads), odChg(me.leads, me.leads_prev), 'up', 'var(--od-mint)', a && dec(a.leads))}
    ${tile('זמן תגובה ממוצע', me.avg_response_min == null ? '-' : odDur(me.avg_response_min),
        me.avg_response_min == null ? null : odChg(me.avg_response_min, me.avg_response_min_prev), 'down', 'var(--od-mint)',
        a && a.avg_response_min != null ? odDur(a.avg_response_min) : null)}
  </section>`;
}

function mdBenchHtml(rows){
  const shown = rows.filter(r => r.me != null || r.base != null);
  if (!shown.length) return '<p class="od-muted">עוד אין מספיק נתונים להשוואה בתקופה הזו.</p>';
  return `<div class="md-bench">${shown.map(r => {
    const ahead = r.me != null && r.base != null && r.me >= r.base;
    return `<div class="md-b-row">
      <span class="md-b-label">${escapeHtml(r.label)}<small>${escapeHtml(r.hint)}</small></span>
      <span class="md-b-track" data-od-tip="${escapeHtml(r.label + ': ' + odPct(r.me) + ' מול ' + odPct(r.base))}">
        <span class="md-b-fill${ahead ? ' ahead' : ''}" style="width:${Math.round((r.me || 0) * 100)}%"></span>
        ${r.base != null ? `<span class="md-b-mark" style="right:${Math.round(r.base * 100)}%"></span>` : ''}
      </span>
      <span class="md-b-val">${odPct(r.me)}<small>${r.base != null ? 'מול ' + odPct(r.base) : ''}</small></span>
    </div>`;
  }).join('')}</div>`;
}

/* עמודה לכל חודש, ציר זמן משמאל לימין, קו מקווקו ב-15 דק׳. עמודה מתחת
   לקו ירוקה, מעליו כהה - הצבע אומר "עמדת ביעד" ולא רק "כמה". */
function mdSpeedHtml(monthly){
  const vals = monthly.map(m => m.avg_response_min == null ? null : odNum(m.avg_response_min));
  if (!vals.some(x => x != null)) return '<p class="od-muted">עוד אין לידים עם זמן תגובה מתועד.</p>';
  const max = Math.max(30, ...vals.filter(x => x != null)) * 1.1;
  const goal = 15 / max * 100;
  return `<div class="md-speed"><span class="md-goal-line" style="bottom:${goal.toFixed(1)}%"><em>15 דק׳</em></span>
    <div class="od-cols" dir="ltr">${monthly.map((m, i) => {
      const v = vals[i];
      return `<div class="od-col" data-od-tip="${escapeHtml(odMonthShort(m.month) + ': ' + (v == null ? 'אין לידים' : odDur(v)))}">
        <span class="v">${v == null ? '' : Math.round(v) <= 99 ? Math.round(v) : ''}</span>
        <span class="stack" style="height:${v == null ? 0 : Math.max(2, v / max * 100).toFixed(1)}%"><i class="${v != null && v <= 15 ? 'fast' : 'ex'}" style="flex:1"></i></span>
        <span class="m${i >= monthly.length - 3 ? ' is-recent' : ''}">${odMonthShort(m.month)}</span></div>`;
    }).join('')}</div></div>`;
}

function mdFunnelHtml(funnel){
  if (!funnel[0].count) return '<p class="od-muted">אין לידים בתקופה - המשפך יתמלא כשיגיעו לידים.</p>';
  const max = Math.max(1, funnel[0].count);
  return `<div class="od-funnel">${funnel.map((r, i) => {
    const below = r.step_rate != null && r.base_rate != null && r.step_rate < r.base_rate;
    return `${i ? `<div class="od-fn-step${below ? ' bad' : ''}">↓ ${odPct(r.step_rate)} עברו${r.base_rate != null ? ' (' + odPct(r.base_rate) + ')' : ''}</div>` : ''}
    <div class="od-fn-row"><span class="od-fn-label">${r.stage}</span>
      <span class="od-fn-track"><span class="od-fn-bar" style="width:${Math.max(2, Math.round(r.count / max * 100))}%;background:${['#0e2a6b','#1e4396','#3a62b5','#6a8bd0','#c9a227'][i]}"></span></span>
      <span class="od-fn-val">${odInt(r.count)}</span></div>`;
  }).join('')}</div>`;
}

/* ==========================================================================
   4. חיווט
   ========================================================================== */
function mdOpen(kind, ref){
  if (typeof gotoSection !== 'function') return;
  if (kind === 'lead'){ gotoSection('accLeads'); if (ref && typeof openLeadFromParam === 'function') openLeadFromParam(ref); return; }
  if (kind === 'property'){ gotoSection('accProperties'); if (ref && typeof openPropertyFromParam === 'function') openPropertyFromParam(ref); return; }
  if (kind === 'agreement'){ gotoSection('accAgreements'); if (ref && typeof openAgreementFromParam === 'function') openAgreementFromParam(ref); return; }
  if (kind === 'agenda'){ gotoSection('accAgenda'); if (ref && typeof agendaFocus === 'function') agendaFocus(ref); return; }
  if (kind === 'matches') gotoSection('accAlerts');
}

(function wireMyDashboard(){
  const acc = document.getElementById('accMyDashboard');
  const host = document.getElementById('myDash');
  if (!acc || !host) return;
  acc.addEventListener('toggle', () => { if (acc.open) loadMyDashboard(); });
  host.addEventListener('click', e => {
    const per = e.target.closest('[data-md-period]');
    if (per){
      mdState.period = per.dataset.mdPeriod;
      try{ localStorage.setItem(MD_PERIOD_KEY, mdState.period); }catch(err){}
      loadMyDashboard(true);
      return;
    }
    if (e.target.closest('[data-md-refresh]')){ loadMyDashboard(true); return; }
    if (e.target.closest('[data-od-more]')){ mdState.allTips = true; renderMyDashboard(); return; }
    const open = e.target.closest('[data-md-open]');
    if (open) mdOpen(open.dataset.mdOpen, open.dataset.mdRef);
  });
  // אותו טולטיפ כמו בדאשבורד המשרד
  let tip = null;
  host.addEventListener('mousemove', e => {
    const el = e.target.closest('[data-od-tip]');
    if (!el){ if (tip) tip.classList.remove('on'); return; }
    if (!tip){ tip = document.createElement('div'); tip.className = 'od-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = el.dataset.odTip;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, e.clientX - r.width / 2)) + 'px';
    tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px';
  });
  host.addEventListener('mouseleave', () => { if (tip) tip.classList.remove('on'); });
})();
