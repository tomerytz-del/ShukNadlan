/* ==========================================================================
   שלושת מאמני ה-AI - כרטיס אחד, שלושה שמות
   --------------------------------------------------------------------------
   שלב 6 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 6;
   docs/coaches.md). העיצוב: design/CoachCard.dc.html.

     agent   "מנטור סוכני נדל״ן AI"  - בדשבורד שלי, יומי
     team    "מנטור מנהלי צוותים AI" - בדאשבורד הצוות, שבועי
     office  "מנטור AI לבעלי משרדים" - בדאשבורד המשרד, שבועי

   הסיכומים נכתבים ב-supabase/functions/office-coach ונקראים כאן לפי RLS:
   סוכן/ת רואה רק את שלו/ה, מנהל/ת צוות את של הצוות, מנהלי המשרד את של
   המשרד ושל הצוותים בו. מנהל/ת **לא** רואה את הסיכום של סוכן/ת.

   **הכפתורים: רשימה סגורה (COACH_CTA), וכל אחד מפעיל פונקציה שכבר קיימת
   ב-CRM.** זו אותה רשימה כמו CTA_KINDS ב-_shared/coach/payload.ts - סוג
   שהמודל החזיר ואינו כאן לא מקבל כפתור, וגם cleanSummaryV2 כבר זרקה אותו.
   כפתור שהקטגוריה שלו מוסתרת לקורא/ת (navAccVisible) לא מוצג.

   הכרטיס קורא גם את החוזה הישן (v1: כותרת ושלוש נקודות) - הסיכומים
   השבועיים של המשרד שנכתבו לפני השלב הזה.

   הקובץ נטען **לפני** שלושת הדאשבורדים, כי הם רושמים ב-coachRerender את
   הציור שלהם בזמן הטעינה. העזרים של crm-office-dashboard.js (odRangeLabel,
   ‏odIso, ‏odPick) נקראים רק בזמן ציור, כשכבר קיימים.
   ========================================================================== */

const COACH_TITLES = {
  agent:  'מנטור סוכני נדל״ן AI',
  team:   'מנטור מנהלי צוותים AI',
  office: 'מנטור AI לבעלי משרדים',
};

const COACH_TABLES = {
  agent:  { table:'agent_coach_summaries',  date:'day' },
  team:   { table:'team_coach_summaries',   date:'week_start' },
  office: { table:'office_coach_summaries', date:'week_start' },
};

const COACH_PRIORITY = {
  high: 'עדיפות גבוהה',
  mid:  'עדיפות בינונית',
  win:  'הזדמנות',
};

/* undefined = טרם נטען, null = אין סיכום, false = הטעינה נכשלה */
const coachState = { agent: undefined, team: undefined, office: undefined };
/* מי מצייר מחדש אחרי "בוצע" - כל דאשבורד רושם את שלו */
const coachRerender = {};
/* ציור מחדש של כל מקום שמציג את המנטור: הדאשבורד של אותו kind, ושכבת
   "המנטור שלי" מדף הבית כשהיא פתוחה (coachLayerRender למטה). */
function coachRepaint(kind){
  if (coachRerender[kind]) coachRerender[kind]();
  coachLayerRender();
}
function coachRepaintAll(){
  Object.values(coachRerender).forEach(fn => fn && fn());
  coachLayerRender();
}
/* "שאל את המנטור" (coach-ask): השאלה האחרונה והתשובה לכל מאמן, עד רענון הדף */
const coachAsk = { agent: {}, team: {}, office: {} };
/* הטון שהקורא/ת בחר/ה (coach_preferences, 20270615100000): 'warm' | 'direct'.
   null = טרם נטען. אחד לכל המנטורים של אותו אדם. */
let coachTone = null;
const COACH_TONES = [
  { key:'warm',   label:'חבר מקצועי' },
  { key:'direct', label:'מאמן ישיר' },
];
/* כמה זמן הקורא/ת מתווך/ת פעיל/ה - טווח ולא מספר, ופרטי: לא מוצג באתר
   (בניגוד ל-agency_members.years_experience שבדף הסוכן/ת). null = לא נענה. */
let coachExp = null;
const COACH_EXP = [
  { key:'lt1',   label:'פחות משנה' },
  { key:'1to5',  label:'שנה עד 5' },
  { key:'5plus', label:'5 שנים ומעלה' },
];
/* שאלות מקצועיות קבועות לצד השאלות שהסיכום מציע - כדי שיהיה ברור שאפשר לשאול
   גם "איך עושים", ולא רק על המספרים. הידע: _shared/coach/playbook.ts */
const COACH_PRO_Q = {
  agent:  ['מה להכין לפגישת גיוס?', 'איך עונים על "אמכור לבד"?', 'מה בודקים לפני שמשווקים קרקע חקלאית?', 'איך מתמחרים נכס מסחרי מניב?', 'איך מסננים שוכר לנכס בניהול?', 'מה בודקים לפני שמשווקים פרויקט של קבלן?', 'איך משווקים עסק פעיל בלי לחשוף אותו?'],
  team:   ['איך בונים קליטה של 90 יום לסוכן חדש?', 'מה לבדוק בשיחה האישית השבועית?'],
  office: ['איך מחזקים בלעדיות במשרד?', 'איך מצמצמים נשירת סוכנים?'],
};

/* ---------- הכפתורים ----------
   label קבוע (לא טקסט של המודל), acc לבדיקת נראות, ו-run שמפעיל יכולת
   קיימת. ‏a = הצעד מהסיכום (title, cta.ref). */
const COACH_CTA = {
  open_lead:             { label:'פתיחת הליד',        acc:'accLeads',       run: a => { gotoSection('accLeads'); openLeadFromParam(a.cta.ref); } },
  open_leads_unanswered: { label:'לרשימת הלידים',     acc:'accLeads',       run: () => gotoSection('accLeads') },
  open_property:         { label:'פתיחת הנכס',        acc:'accProperties',  run: a => { gotoSection('accProperties'); openPropertyFromParam(a.cta.ref); } },
  promote_property:      { label:'קידום הנכס',        acc:'accProperties',  run: a => { gotoSection('accProperties'); openPropertyFromParam(a.cta.ref); } },
  open_agreement:        { label:'פתיחת ההסכם',       acc:'accAgreements',  run: a => { gotoSection('accAgreements'); openAgreementFromParam(a.cta.ref); } },
  new_agreement:         { label:'החתמת לקוח/ה',      acc:'accAgreements',  run: () => openAgreementWizard() },
  open_agenda:           { label:'ליומן',             acc:'accAgenda',      run: a => a.cta.ref ? agendaFocus(a.cta.ref) : gotoSection('accAgenda') },
  new_agenda_item:       { label:'הוספה ליומן',       acc:'accAgenda',      run: a => openAgendaForm({ kind:'task', title: a.title }) },
  open_prefs:            { label:'להגדרות',           acc:'accPrefs',       run: () => gotoSection('accPrefs') },
  open_profile:          { label:'לפרופיל',           acc:'accProfile',     run: () => gotoSection('accProfile') },
  open_matches:          { label:'להתאמות',           acc:'accAlerts',      run: () => gotoSection('accAlerts') },
  open_team_agent:       { label:'לסוכן/ת',           acc:null,             run: (a, kind) => coachOpenAgent(kind, a.cta.ref) },
  open_expiring:         { label:'לבלעדיות שפוקעות',  acc:'accOfficeDashboard', run: () => coachScrollTo('odExpiring') },
};

function coachCtaFor(kind, action){
  const c = action && action.cta;
  const spec = c && COACH_CTA[c.kind];
  if (!spec) return null;
  if (spec.acc && typeof navAccVisible === 'function' && !navAccVisible(spec.acc)) return null;
  if (c.kind === 'open_team_agent' && !c.ref) return null;
  return spec;
}

function coachScrollTo(id){
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 120);
}

/* "לסוכן/ת": בדאשבורד המשרד - הסינון לסוכן/ת (odPick); בדאשבורד הצוות -
   הכרטיס שלו/ה ב"הסוכנים בצוות". */
function coachOpenAgent(kind, id){
  if (kind === 'office' && typeof odPick === 'function'){
    odPick(id);
    coachScrollTo('officeDash');
    return;
  }
  gotoSection('accTeamAgents');
  if (typeof renderTeamAgents === 'function') renderTeamAgents();
  setTimeout(() => {
    const el = document.querySelector(`[data-td-agent="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add('is-focus');
    el.scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(() => el.classList.remove('is-focus'), 2600);
  }, 450);
}

/* ---------- טעינה ----------
   השורה האחרונה בלבד. ‏team: הצוות שהקורא/ת מנהל/ת (מנהלי המשרד רואים
   ב-RLS את כל הצוותים, ולכן מסננים). כשל - הכרטיס לא מוצג. */
async function coachLoad(kind, teamId){
  coachState[kind] = null;
  if (coachTone === null) coachToneLoad();
  const t = COACH_TABLES[kind];
  let q = sb.from(t.table).select('*').order(t.date, { ascending:false }).limit(1);
  if (kind === 'team'){
    if (!teamId){ coachState[kind] = false; return; }
    q = q.eq('team_id', teamId);
  }
  const { data, error } = await q;
  coachState[kind] = error ? false : ((data && data[0]) || null);
  coachRepaint(kind);
  // כפתור "המנטור" בסרגל ובתפריט מופיע לפי מה שנטען (coachLayerKinds)
  if (typeof scheduleNavCounts === 'function') scheduleNavCounts();
}

/* ---------- הטון והוותק ---------- */
async function coachToneLoad(){
  coachTone = 'warm';
  const { data } = await sb.from('coach_preferences').select('tone, experience').maybeSingle();
  if (!data) return;
  coachTone = data.tone === 'direct' ? 'direct' : 'warm';
  coachExp = COACH_EXP.some(x => x.key === data.experience) ? data.experience : null;
  coachRepaintAll();
}

/* אופטימי, כמו "בוצע": הכרטיס מתעדכן מיד, ושגיאה מחזירה אותו. ‏upsert של
   עמודה אחת משאיר את השנייה כמו שהיא. */
async function coachPrefSave(field, value){
  const cur = field === 'tone' ? coachTone : coachExp;
  if (!currentAgent || value === cur) return;
  const set = v => { if (field === 'tone') coachTone = v; else coachExp = v; };
  set(value);
  coachRepaintAll();
  const { error } = await sb.from('coach_preferences')
    .upsert({ agent_id: currentAgent.id, [field]: value, updated_at: new Date().toISOString() }, { onConflict: 'agent_id' });
  if (error){
    set(cur);
    coachRepaintAll();
    showToast('לא נשמר: ' + heErr(error));
  }
}

/* ---------- הכרטיס ---------- */
function coachDateLabel(iso){
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return 'הבוקר';
  if (days === 1) return 'אתמול';
  return d.toLocaleDateString('he-IL', { day:'numeric', month:'numeric' });
}

function coachWeekLabel(weekStart){
  const end = new Date(weekStart + 'T00:00:00');
  end.setDate(end.getDate() - 1);
  const from = new Date(end); from.setDate(from.getDate() - 6);
  return odRangeLabel({ from: odIso(from), to: odIso(end) });
}

function coachSub(kind, row){
  if (kind === 'agent') return 'עודכן ' + coachDateLabel(row.day) + ' · מבוסס על 30 הימים האחרונים שלך';
  return 'סיכום שבועי · ' + coachWeekLabel(row.week_start);
}

const COACH_EMPTY = {
  // מאמן הסוכן/ת לא מבטיח "יגיע מחר": הוא נדלק בהדרגה (AGENT_COACH_ENABLED),
  // ונכתב רק למי שהייתה לו/ה תנועה ב-14 יום (agent_coach_due). אבל השאלה
  // החופשית עובדת גם בלי סיכום (coach-ask), ולכן הכרטיס קיים ומציע אותה -
  // תומר, 18.10.2026: המנטור צריך מקום בשימוש היומיומי.
  agent:  'עוד אין סיכום יומי בחשבון שלך. כשיהיה, הוא יופיע כאן בבוקר עם עד שלושה צעדים להיום. בינתיים אפשר לשאול את המנטור כל שאלה מקצועית.',
  team:   'הסיכום הראשון יגיע ביום ראשון בבוקר: מה עבד בצוות בשבוע שעבר, מה תקוע, שלושה צעדים לשבוע וסדר יום לישיבת הצוות.',
  office: 'הסיכום הראשון יגיע ביום ראשון בבוקר: מה עבד במשרד בשבוע שעבר, מה תקוע, ועד שלוש החלטות לשבוע הזה.',
};

/* הדמות של המנטור: אווטאר עגול (assets/mentor-avatar.webp, נחתך מתמונה
   שנוצרה ב-AI). השם נשאר "המנטור" - בלי שם פרטי ובלי ביוגרפיה, כדי שלא
   ייראה כמו איש מקצוע אמיתי שכותב. ‏alt ריק: השם כתוב ממילא בכותרת שלידה. */
const COACH_FACE = '<img class="coach-ava" src="/assets/mentor-avatar.webp" width="48" height="48" alt="" decoding="async">';
const COACH_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

function coachHead(kind, sub){
  return `<div class="coach-head"><span class="coach-ico">${COACH_FACE}</span>
    <div><h2>${escapeHtml(COACH_TITLES[kind])}</h2><span class="coach-sub">${escapeHtml(sub)}</span></div></div>`;
}

/* ‏opts.compact: שני צעדים (דף הבית בנייד, HANDOFF 6.8) */
function coachCardHtml(kind, opts){
  const o = opts || {};
  const row = coachState[kind];
  if (row === false || row === undefined) return '';
  if (!row || !row.summary){
    if (!COACH_EMPTY[kind]) return '';
    return `<section class="coach" aria-label="${escapeHtml(COACH_TITLES[kind])}">
      ${coachHead(kind, kind === 'agent' ? 'סיכום יומי אישי' : kind === 'team' ? 'סיכום שבועי לצוות' : 'סיכום שבועי למשרד')}
      <p class="coach-empty">${escapeHtml(COACH_EMPTY[kind])}</p>
      ${o.compact ? '' : coachAskHtml(kind, [])}</section>`;
  }
  const s = row.summary;
  const disclaimer = '<p class="coach-note">נכתב אוטומטית מהמספרים. כדאי לבדוק לפני שפועלים.</p>';

  // v1 (המשרד, לפני השלב הזה): כותרת ושלוש נקודות, בלי כפתורים ובלי "בוצע"
  if (s.v !== 2){
    const points = Array.isArray(s.points) ? s.points.slice(0, o.compact ? 2 : 3) : [];
    return `<section class="coach" aria-label="${escapeHtml(COACH_TITLES[kind])}">
      ${coachHead(kind, coachSub(kind, row))}
      <p class="coach-sum">${escapeHtml(s.headline || '')}</p>
      <div class="coach-acts">${points.map(p => `<article class="coach-act">
        <div class="coach-act-body">
          <div class="coach-act-top"><b>${escapeHtml(p.title || '')}</b></div>
          <p>${escapeHtml(p.body || '')}</p>
          ${p.owner ? `<span class="coach-impact">מוביל/ה: ${escapeHtml(p.owner)}</span>` : ''}
        </div></article>`).join('')}</div>
      ${o.compact ? '' : coachAskHtml(kind, [])}
      ${disclaimer}</section>`;
  }

  const done = new Set((row.actions_done || []).map(Number));
  const actions = (s.actions || []).slice(0, o.compact ? 2 : 3);
  const actsTitle = kind === 'agent' ? 'צעדים להיום' : kind === 'team' ? 'מה לעשות השבוע' : 'החלטות לשבוע הזה';
  return `<section class="coach${o.compact ? ' is-compact' : ''}" aria-label="${escapeHtml(COACH_TITLES[kind])}">
    ${coachHead(kind, coachSub(kind, row))}
    ${s.headline ? `<p class="coach-hl">${escapeHtml(s.headline)}</p>` : ''}
    ${s.summary ? `<p class="coach-sum">${escapeHtml(s.summary)}</p>` : ''}
    ${s.strength || s.focus ? `<div class="coach-chips">
      ${s.strength ? `<span class="coach-chip is-strength">${escapeHtml(s.strength)}</span>` : ''}
      ${s.focus ? `<span class="coach-chip is-focus">${escapeHtml(s.focus)}</span>` : ''}</div>` : ''}
    ${actions.length ? `<div class="coach-acts-h">${escapeHtml(actsTitle)}</div>
    <div class="coach-acts">${actions.map((a, i) => {
      const isDone = done.has(i);
      const cta = coachCtaFor(kind, a);
      return `<article class="coach-act${isDone ? ' is-done' : ''}">
        <button type="button" class="coach-check" data-coach-done="${kind}" data-coach-i="${i}"
          aria-pressed="${isDone}" aria-label="${isDone ? 'בוצע. לחיצה מבטלת' : 'סמן כבוצע'}">${COACH_CHECK}</button>
        <div class="coach-act-body">
          <div class="coach-act-top">
            <span class="coach-prio is-${isDone ? 'done' : escapeHtml(a.priority || 'mid')}">${isDone ? 'בוצע' : escapeHtml(COACH_PRIORITY[a.priority] || COACH_PRIORITY.mid)}</span>
            <b>${escapeHtml(a.title || '')}</b>
          </div>
          <p>${escapeHtml(a.why || '')}</p>
          <div class="coach-act-foot">
            ${a.impact ? `<span class="coach-impact">השפעה צפויה: ${escapeHtml(a.impact)}</span>` : '<span></span>'}
            ${cta ? `<button type="button" class="coach-cta" data-coach-cta="${kind}" data-coach-i="${i}">${escapeHtml(cta.label)}</button>` : ''}
          </div>
        </div></article>`;
    }).join('')}</div>` : ''}
    ${kind === 'team' && !o.compact && Array.isArray(s.agenda) && s.agenda.length ? `
    <div class="coach-agenda">
      <div class="coach-acts-h">ישיבת הצוות הבאה: סדר יום מוצע</div>
      <ol>${s.agenda.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>
      ${typeof navAccVisible !== 'function' || navAccVisible('accAgenda')
        ? '<button type="button" class="coach-cta is-ghost" data-coach-meeting="team">קביעת ישיבת צוות ביומן</button>' : ''}
    </div>` : ''}
    ${o.compact ? '' : coachAskHtml(kind, Array.isArray(s.questions) ? s.questions : [])}
    ${disclaimer}
  </section>`;
}

/* המנטור בראש הדאשבורד, ולצדו הבלוק של "מה דורש טיפול" (design/
   Desktop-TeamLead, ‏Desktop-Office, ‏Desktop-Performance). עד 18.10.2026 הוא
   ישב מתחת לפתיח ולשורת המדדים - בדאשבורד המשרד 900px ויותר מראש הדאשבורד,
   כלומר מתחת למסך. בלי סיכום (הכרטיס ריק) מחזיר null, והדאשבורד מצייר את
   הבלוק במקומו הרגיל. ‏side ריק - המנטור לבד, ברוחב מלא. */
function coachLeadHtml(kind, side){
  const card = coachCardHtml(kind);
  if (!card) return null;
  if (!side) return `<div class="coach-lead is-solo">${card}</div>`;
  return `<div class="coach-lead">${card}<div class="coach-lead-side">${side}</div></div>`;
}

/* ---------- "שאל את המנטור" ----------
   שאלה חופשית מול הסיכום והמספרים של אותו מאמן (supabase/functions/coach-ask,
   שלב 8). תשובה בלבד - המאמן לא מבצע פעולות. מכסה יומית לחשבון; הקוד
   coach_ask_quota מתורגם ב-friendly-error.js. השאלות המוצעות - מהסיכום. */
function coachAskHtml(kind, questions){
  const st = coachAsk[kind] || {};
  const id = 'coachAskQ-' + kind;
  // עד שתיים מהסיכום, ואחריהן שתיים מהמקצועיות - מתחלפות לפי היום, כדי שהכרטיס
  // לא יתמלא בכפתורים ושכל הנושאים יופיעו בתורם
  const pro = COACH_PRO_Q[kind] || [];
  const day = Math.floor(Date.now() / 86400000);
  const proToday = pro.length <= 2 ? pro : [pro[day % pro.length], pro[(day + 1) % pro.length]];
  const sugg = [...new Set([...questions.slice(0, 2), ...proToday])];
  const tone = coachTone || 'warm';
  const toneNote = kind === 'agent' ? 'חל על הסיכום היומי ועל התשובות' : 'חל על התשובות לשאלות';
  return `<div class="coach-ask">
    <form class="coach-ask-form" data-coach-ask="${kind}">
      <label class="sr-only" for="${id}">שאלה למנטור</label>
      <textarea id="${id}" maxlength="300" autocomplete="off" placeholder="שאלה למנטור..." enterkeyhint="send"
        rows="${String(st.draft || '').length > 40 ? 3 : 1}"${st.busy ? ' disabled' : ''}>${escapeHtml(st.draft || '')}</textarea>
      <button type="submit" aria-label="שליחת השאלה"${st.busy ? ' disabled' : ''}>←</button>
    </form>
    ${sugg.length && !st.q ? `<div class="coach-ask-sugg">${sugg.map(q =>
      `<button type="button" data-coach-q="${kind}" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>` : ''}
    ${st.q ? `<div class="coach-ask-out${st.folded ? ' is-folded' : ''}" aria-live="polite">
      <div class="coach-ask-head"><p class="coach-ask-q">${escapeHtml(st.q)}</p>${coachFoldBtn(kind, st)}</div>
      ${st.folded ? '' : st.busy ? '<p class="coach-ask-a is-busy">המנטור חושב…</p>'
        : st.err ? `<p class="coach-ask-a is-err">${escapeHtml(st.err)}</p>`
        : `<p class="coach-ask-a">${escapeHtml(st.a || '')}</p>`}
      ${st.remaining != null && !st.busy && !st.folded ? `<p class="coach-ask-left">${st.remaining
        ? 'נשארו ' + escapeHtml(String(st.remaining)) + ' שאלות להיום' : 'זו הייתה השאלה האחרונה להיום'}</p>` : ''}
    </div>` : ''}
    <div class="coach-tone" role="group" aria-label="סגנון המנטור" title="${escapeHtml(toneNote)}">
      <span>סגנון המנטור:</span>
      ${COACH_TONES.map(t => `<button type="button" data-coach-tone="${t.key}" aria-pressed="${t.key === tone}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
    ${kind === 'agent' ? `<div class="coach-tone" role="group" aria-label="ותק בתיווך" title="לא מוצג לאף אחד - רק כדי שהמנטור יתאים את התשובות">
      <span>כמה זמן את/ה מתווך/ת פעיל/ה?</span>
      ${COACH_EXP.map(t => `<button type="button" data-coach-exp="${t.key}" aria-pressed="${t.key === coachExp}">${escapeHtml(t.label)}</button>`).join('')}
    </div>` : ''}
    ${kind === 'agent' && typeof assistantTierOk === 'function' && assistantTierOk()
      ? '<p class="coach-ask-left">אפשר לשאול את המנטור גם בוואטסאפ, דרך גבריאלה</p>' : ''}
  </div>`;
}

/* תשובה ארוכה תפסה את כל המסך בדף הבית בטלפון, ולא הייתה דרך להקטין אותה
   (19.10.2026). הכפתור מקפל אותה לשורת השאלה ופותח שוב; שאלה חדשה נפתחת
   תמיד. בזמן שהמנטור חושב אין מה לקפל. */
function coachFoldBtn(kind, st){
  if (st.busy) return '';
  return `<button type="button" class="coach-ask-fold" data-coach-fold="${kind}" aria-expanded="${!st.folded}">`
    + (st.folded ? 'הצגת התשובה' : 'צמצום') + '</button>';
}

async function coachAskSend(kind, question){
  const q = String(question || '').trim();
  const st = coachAsk[kind];
  if (!q || st.busy) return;
  if (q.length < 3){ showToast('צריך לכתוב שאלה של כמה מילים לפחות.'); return; }
  Object.assign(st, { q, a: '', err: '', busy: true, draft: '', folded: false });
  coachRepaint(kind);
  try{
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw { code: 'session_not_found', message: 'session_not_found' };
    const res = await fetch(SUPABASE_URL + '/functions/v1/coach-ask', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ kind, question: q }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error){
      if (data.remaining != null) st.remaining = data.remaining;
      throw { code: data.error || String(res.status), message: data.error || ('HTTP ' + res.status) };
    }
    st.a = data.answer || '';
    st.remaining = data.remaining;
  } catch(err){
    st.err = heErr(err);
  }
  st.busy = false;
  coachRepaint(kind);
}

/* ---------- "סמן כבוצע" ----------
   ‏coach_action_done (20270601160000) בודקת שהשורה של הקורא/ת. אופטימי:
   הכרטיס מתעדכן מיד, ושגיאה מחזירה אותו. */
async function coachToggleDone(kind, i){
  const row = coachState[kind];
  if (!row || !row.id) return;
  const before = (row.actions_done || []).slice();
  const on = !before.map(Number).includes(i);
  row.actions_done = on ? before.concat(i) : before.filter(x => Number(x) !== i);
  coachRepaint(kind);
  const { data, error } = await sb.rpc('coach_action_done', { p_kind: kind, p_summary_id: row.id, p_index: i, p_done: on });
  if (error){
    row.actions_done = before;
    showToast('לא נשמר: ' + heErr(error));
  } else {
    row.actions_done = data || [];
  }
  coachRepaint(kind);
}

/* ---------- נושאים שחסרים למנטור (מנהל/ת פלטפורמה) ----------
   ‏coach_knowledge_gaps (20270616100000): שאלות מקצועיות שהמנטור אמר שאין לו
   עליהן ידע, מקובצות לפי נושא. "הוספתי לידע" אחרי שהנושא נכנס ל-playbook.ts. */
async function loadCoachGaps(){
  const host = document.getElementById('coachGapsList');
  if (!host) return;
  const { data, error } = await sb.rpc('coach_knowledge_gaps');
  if (error){ host.innerHTML = '<div class="empty-state">' + escapeHtml(heErr(error)) + '</div>'; return; }
  const rows = data || [];
  if (typeof accSetCount === 'function') accSetCount('accCoachGaps', rows.length || '');
  if (!rows.length){ host.innerHTML = '<div class="empty-state">אין נושאים חסרים. כל השאלות המקצועיות נענו מהידע.</div>'; return; }
  const KIND = { agent:'סוכן/ת', team:'צוות', office:'משרד' };
  host.innerHTML = rows.map(r => `
    <div class="coach-gap">
      <div class="coach-gap-head">
        <strong>${escapeHtml(r.topic)}</strong>
        <span>${escapeHtml(String(r.asked))} ${r.asked === 1 ? 'פעם' : 'פעמים'} · ${escapeHtml(new Date(r.last_asked).toLocaleDateString('he-IL'))} · ${escapeHtml((r.kinds || []).map(k => KIND[k] || k).join(', '))}</span>
      </div>
      <ul>${(r.samples || []).map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
      <button type="button" class="btn btn-ghost" data-coach-gap="${escapeHtml(r.topic)}">הוספתי לידע</button>
    </div>`).join('');
}

(function wireCoachGaps(){
  const acc = document.getElementById('accCoachGaps');
  if (acc) acc.addEventListener('toggle', e => { if (e.target.open) loadCoachGaps(); });
})();

(function wireCoach(){
  document.addEventListener('click', e => {
    const done = e.target.closest('[data-coach-done]');
    if (done){ coachToggleDone(done.dataset.coachDone, Number(done.dataset.coachI)); return; }
    const btn = e.target.closest('[data-coach-cta]');
    if (btn){
      const kind = btn.dataset.coachCta;
      const row = coachState[kind];
      const a = row && row.summary && (row.summary.actions || [])[Number(btn.dataset.coachI)];
      const spec = a && coachCtaFor(kind, a);
      if (spec) spec.run(a, kind);
      return;
    }
    const gapBtn = e.target.closest('[data-coach-gap]');
    if (gapBtn){
      gapBtn.disabled = true;
      sb.rpc('coach_gap_resolve', { p_topic: gapBtn.dataset.coachGap }).then(({ error }) => {
        if (error){ gapBtn.disabled = false; showToast('לא נשמר: ' + heErr(error)); return; }
        showToast('סומן. שאלה חדשה באותו נושא תחזור לרשימה רק אם עדיין חסר ידע.');
        loadCoachGaps();
      });
      return;
    }
    const toneBtn = e.target.closest('[data-coach-tone]');
    if (toneBtn){ coachPrefSave('tone', toneBtn.dataset.coachTone); return; }
    const expBtn = e.target.closest('[data-coach-exp]');
    if (expBtn){ coachPrefSave('experience', expBtn.dataset.coachExp); return; }
    const sugg = e.target.closest('[data-coach-q]');
    if (sugg){ coachAskSend(sugg.dataset.coachQ, sugg.dataset.q); return; }
    const fold = e.target.closest('[data-coach-fold]');
    if (fold){
      const st = coachAsk[fold.dataset.coachFold];
      if (st){ st.folded = !st.folded; coachRepaint(fold.dataset.coachFold); }
      return;
    }
    const meet = e.target.closest('[data-coach-meeting]');
    if (meet){
      const row = coachState.team;
      const agenda = (row && row.summary && row.summary.agenda) || [];
      openAgendaForm({ kind:'meeting', title:'ישיבת צוות' });
      const notes = document.getElementById('agNotes');
      if (notes) notes.value = agenda.map((x, n) => (n + 1) + '. ' + x).join('\n');
    }
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-coach-ask]');
    if (!form) return;
    e.preventDefault();
    coachAskSend(form.dataset.coachAsk, form.querySelector('textarea').value);
  });
  /* השדה הוא textarea (שאלה מוכנה מכרטיס הליד ארוכה משורה), ולכן Enter שולח
     ו-Shift+Enter יורד שורה - כמו בשדה של שורה אחת */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const form = e.target.closest && e.target.closest('[data-coach-ask]');
    if (!form || e.target.tagName !== 'TEXTAREA') return;
    e.preventDefault();
    coachAskSend(form.dataset.coachAsk, e.target.value);
  });
  /* מה שהוקלד נשמר כשהדאשבורד מצויר מחדש (למשל אחרי "בוצע") */
  document.addEventListener('input', e => {
    const form = e.target.closest && e.target.closest('[data-coach-ask]');
    if (form) coachAsk[form.dataset.coachAsk].draft = e.target.value;
  });
})();

/* ---------- "המנטור שלי": השכבה מדף הבית (HANDOFF 6.8) ----------
   design/Mobile-Coach.dc.html: "הצעדים של היום" בשורת המנטור בדף הבית
   (#homeCoachRow, למטה) פותח שכבה עם הכרטיס המקוצר (שני צעדים), ולמנהלים מתג בין המנטורים:
   "אני כסוכן/ת" / "הצוות שלי" / "המשרד שלי". הכרטיס המלא, עם "שאל את
   המנטור", נשאר בדאשבורד של אותו kind, ולכן בתחתית יש קישור אליו.

   **הכפתור מוצג רק כשיש מה לפתוח.** מנטור הסוכן/ת נדלק בהדרגה
   (AGENT_COACH_ENABLED), וסוכן/ת בלי סיכום לא רואה כפתור שמוביל להבטחה.
   למנהלים יש תמיד מה להציג: הסיכום, או "הסיכום הראשון יגיע ביום ראשון".
   מנהל/ת שאינו/ה סוכן/ת פעיל/ה (my_roles().is_active_agent) לא מקבל/ת את
   הלשונית האישית. */
const COACH_LAYER_TABS = { agent:'אני כסוכן/ת', team:'הצוות שלי', office:'המשרד שלי' };
const COACH_LAYER_DASH = { agent:'accMyDashboard', team:'accTeamDashboard', office:'accOfficeDashboard' };
let coachLayerKind = null;
const coachLayerBusy = {};

function coachRoles(){
  return typeof myRoles !== 'undefined' ? myRoles : null;
}

function coachLayerKinds(){
  if (typeof dashView !== 'undefined' && dashView !== 'agent') return [];
  if (!currentAgent) return [];
  const roles = coachRoles();
  const kinds = [];
  const a = coachState.agent;
  // המנטור האישי: לכל סוכן/ת פעיל/ה, גם בלי סיכום - השאלה עובדת בלעדיו.
  // ‏undefined = טרם נטען, false = הטבלה לא נקראה (מסד בלי המיגרציה)
  if (!(roles && roles.is_active_agent === false) && a !== undefined && a !== false) kinds.push('agent');
  if (roles && roles.led_team_id && navAccVisible('accTeamDashboard')) kinds.push('team');
  if (currentAgent.role === 'manager' && navAccVisible('accOfficeDashboard')) kinds.push('office');
  return kinds;
}

/* ---------- "שאל את המנטור" בחזית דף הבית (#homeCoachRow) ----------
   השאלה הייתה רחוקה שלושה קליקים וגלילה (תומר, 18.10.2026): השדה ישב רק
   בכרטיס המלא בדאשבורד. כאן היא שורה אחת מתחת לברכה, והתשובה מוצגת מתחתיה.
   אותו coachAskSend ואותו מצב (coachAsk) של הכרטיס - ולכן אותה מכסה, ושאלה
   ששאלת כאן מופיעה גם בכרטיס בדאשבורד.

   המנטור שנשאל: הראשון ב-coachLayerKinds (האישי, ואם אין - הצוות או המשרד).
   ‏**המבנה נבנה פעם אחת ב-HTML**: homeCoachSync רץ עם כל ציור של דף הבית
   (refreshNavCounts), וציור מחדש של השדה היה מוחק את מה שמוקלד ואת המיקוד.
   כאן מתעדכנים רק התשובה והנראות.

   **שורה אחת:** אווטאר (פותח את השכבה - הצעדים והשיחה), שדה ושליחה. השאלות
   המוצעות מוקלדות בתוך השדה ומתחלפות (homeAskTyper), במקום שורת כפתורים
   ו"עוד מהמנטור" מתחתיו - תומר, 19.10.2026: "לצמצם את השורה הנוספת ולגוון
   את השאלות". שליחה בשדה ריק שולחת את השאלה שמוצגת בו. */
/* שאלות של יום עבודה, לצד המקצועיות של COACH_PRO_Q - כדי שיהיה ברור שהמנטור
   עונה גם על "מה עושים עכשיו" ולא רק על נושאים */
const COACH_DAILY_Q = {
  agent:  ['מה לכתוב בהודעה ראשונה לליד חדש?', 'איך חוזרים לליד שלא ענה?', 'איך מבקשים בלעדיות בלי להישמע לחוץ?',
           'מה עונים ל"העמלה גבוהה מדי"?', 'איך מתמחרים דירה כשהבעלים רוצה יותר מהשוק?', 'מה לבדוק לפני סיור עם קונה?'],
  team:   ['איך מעלים את זמן התגובה של הצוות?', 'מה לעשות עם סוכן שלא מגייס בלעדיות?'],
  office: ['איך מגייסים סוכן טוב למשרד?', 'איך מודדים אם המשרד בכיוון הנכון?'],
};

function homeAskKind(){
  return coachLayerKinds()[0] || null;
}

/* השאלות שמוקלדות בשדה: עד שתיים מהסיכום של היום, ואחריהן היומיומיות
   והמקצועיות, בסדר שמתחלף לפי היום - כדי שכל ביקור יתחיל משאלה אחרת. */
function homeAskPhrases(){
  const kind = homeAskKind();
  if (!kind) return [];
  const row = coachState[kind];
  const fromSum = row && row.summary && Array.isArray(row.summary.questions) ? row.summary.questions.slice(0, 2) : [];
  const pool = [...(COACH_DAILY_Q[kind] || []), ...(COACH_PRO_Q[kind] || [])];
  const day = Math.floor(Date.now() / 86400000);
  const turned = pool.length ? pool.map((_, n) => pool[(n + day) % pool.length]) : [];
  return [...new Set([...fromSum, ...turned])].filter(Boolean);
}

function homeCoachSync(){
  const row = document.getElementById('homeCoachRow');
  if (!row) return;
  const kind = homeAskKind();
  row.hidden = !kind;
  if (!kind) return;
  row.dataset.kind = kind;
  const st = coachAsk[kind] || {};
  homeAskTyper.start();

  const send = row.querySelector('.home-ask-send');
  const input = document.getElementById('homeAskInput');
  if (send) send.disabled = !!st.busy;
  if (input) input.disabled = !!st.busy;

  const out = document.getElementById('homeAskOut');
  if (out){
    out.hidden = !st.q;
    if (st.q){
      out.classList.toggle('is-folded', !!st.folded);
      out.innerHTML = `<div class="head"><p class="q">${escapeHtml(st.q)}</p>${coachFoldBtn(kind, st)}</div>`
        + (st.folded ? '' : st.busy ? '<p class="a is-busy">המנטור חושב…</p>'
          : st.err ? `<p class="a is-err">${escapeHtml(st.err)}</p>`
          : `<p class="a">${escapeHtml(st.a || '')}</p>`)
        + (st.remaining != null && !st.busy && !st.folded ? `<p class="left">${st.remaining
            ? 'נשארו ' + escapeHtml(String(st.remaining)) + ' שאלות להיום' : 'זו הייתה השאלה האחרונה להיום'}</p>` : '');
    }
  }
}

/* ---------- השאלות המתחלפות בשדה ----------
   אותה מכונה כמו בחיפוש בדף הבית של האתר (assets/sentence-search.js, typer):
   אות אחר אות עם עצירה בין מילים, החזקה, מחיקה ומעבר לבאה. השכבה יושבת מעל
   שדה ריק ולא בתוך ה-placeholder, כדי שקורא מסך ישמע את התווית פעם אחת.
   נעצרת בפוקוס, כשיש טקסט, בלשונית מוסתרת, כשהשורה מחוץ למסך או מוסתרת.
   ‏prefers-reduced-motion: השאלה השלמה מתחלפת כל 3.5 שניות, בלי הקלדה. */
const homeAskTyper = (function(){
  const CHAR_MS = 45, WORD_PAUSE = 140, HOLD_MS = 2200, DEL_MS = 18, GAP_MS = 380, SWAP_MS = 3500;
  let i = Math.floor(Date.now() / 86400000), timer = 0, running = false, visible = true, wired = false, shown = '';
  const el = () => ({
    row: document.getElementById('homeCoachRow'),
    input: document.getElementById('homeAskInput'),
    out: document.querySelector('#homeCoachRow .home-ask-text'),
    field: document.querySelector('#homeCoachRow .home-ask-field'),
  });
  const noMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function blocked(){
    const e = el();
    return !e.out || !e.row || e.row.hidden || document.hidden || !visible
      || document.activeElement === e.input || e.input.value !== '' || e.input.disabled || !homeAskPhrases().length;
  }
  function sync(){
    const e = el();
    if (!e.field) return;
    e.field.classList.toggle('has-value', !!e.input && e.input.value !== '');
    e.field.classList.toggle('is-typing', running);
  }
  function stop(){ running = false; shown = ''; clearTimeout(timer); sync(); }
  function phrase(){ const l = homeAskPhrases(); return l[i % l.length]; }
  function type(n){
    if (blocked()) return stop();
    const p = phrase();
    el().out.textContent = p.slice(0, n);
    if (n >= p.length){ shown = p; timer = setTimeout(() => erase(p.length), HOLD_MS); return; }
    timer = setTimeout(() => type(n + 1), CHAR_MS + (p.charAt(n) === ' ' ? WORD_PAUSE : 0));
  }
  function erase(n){
    if (blocked()) return stop();
    shown = '';
    const out = el().out;
    out.textContent = out.textContent.slice(0, n);
    if (n <= 0){ i++; timer = setTimeout(() => type(0), GAP_MS); return; }
    timer = setTimeout(() => erase(n - 1), DEL_MS);
  }
  function swap(){
    if (blocked()) return stop();
    shown = phrase();
    el().out.textContent = shown;
    i++;
    timer = setTimeout(swap, SWAP_MS);
  }
  function wire(){
    const e = el();
    if (wired || !e.input || !e.field) return;
    wired = true;
    e.input.addEventListener('focus', stop);
    e.input.addEventListener('input', () => { if (e.input.value !== '') stop(); sync(); });
    e.input.addEventListener('blur', () => { sync(); setTimeout(start, 600); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    if ('IntersectionObserver' in window){
      new IntersectionObserver(en => { visible = en[0].isIntersecting; if (visible) start(); else stop(); }).observe(e.field);
    }
  }
  function start(){
    wire();
    if (running || blocked()) return;
    running = true; sync();
    if (noMotion()) swap(); else type(0);
  }
  return { start, stop, current: () => shown };
})();

function homeAskSubmit(question){
  const kind = homeAskKind();
  if (!kind) return;
  const input = document.getElementById('homeAskInput');
  // שדה ריק: השאלה שמוצגת בו עכשיו (מוקלדת עד הסוף) - לחיצה על השליחה
  // היא "כן, את זה"
  const q = String(question || '').trim() || homeAskTyper.current();
  if (!q){ if (input) input.focus(); return; }
  if (input && q.length >= 3) input.value = '';
  homeAskTyper.stop();
  coachAskSend(kind, q);
}

async function coachLayerEnsure(kind){
  if (coachState[kind] !== undefined || coachLayerBusy[kind]) return;
  coachLayerBusy[kind] = true;
  coachLayerRender();
  const roles = coachRoles();
  try { await coachLoad(kind, kind === 'team' ? roles && roles.led_team_id : undefined); }
  catch(e){ coachState[kind] = false; }
  coachLayerBusy[kind] = false;
  coachLayerRender();
}

function openCoachLayer(){
  if (navLayer === 'coach') return;
  const kinds = coachLayerKinds();
  if (!kinds.length) return;
  closeMenuPanel();
  if (!kinds.includes(coachLayerKind)) coachLayerKind = kinds[0];
  const el = navLayerShow('coachSheet', 'coach');
  if (!el) return;
  coachLayerRender();
  coachLayerEnsure(coachLayerKind);
  const first = el.querySelector('.cl-tab[aria-selected="true"], .nl-close');
  if (first) first.focus({ preventScroll:true });
}

function closeCoachLayer(){
  navLayerHide('coachSheet', 'coach');
}

function coachLayerRender(){
  homeCoachSync();
  const sheet = document.getElementById('coachSheet');
  const host = document.getElementById('coachSheetBody');
  if (!sheet || !host || sheet.hidden) return;
  const kinds = coachLayerKinds();
  if (!kinds.includes(coachLayerKind)) coachLayerKind = kinds[0] || null;
  const kind = coachLayerKind;
  if (!kind){ closeCoachLayer(); return; }

  const tabs = kinds.length > 1 ? `<div class="cl-tabs" role="tablist" aria-label="איזה מנטור">
    ${kinds.map(k => `<button type="button" role="tab" class="cl-tab" data-cl-kind="${k}"
      aria-selected="${k === kind}">${escapeHtml(COACH_LAYER_TABS[k])}</button>`).join('')}</div>` : '';

  const row = coachState[kind];
  let body;
  if (row === undefined || coachLayerBusy[kind]) body = '<p class="cl-wait">טוען את המנטור…</p>';
  else if (row === false) body = '<p class="cl-wait">לא הצלחנו לטעון את המנטור כרגע. אפשר לנסות שוב בעוד רגע.</p>';
  else body = coachCardHtml(kind, { compact:true });

  // השכבה היא הבית של המנטור: הצעדים, ומתחתם השאלה החופשית (הכרטיס המקוצר
  // לא נושא אותה)
  const s = row && row.summary;
  const ask = row !== undefined && row !== false && !coachLayerBusy[kind]
    ? `<div class="cl-ask">${coachAskHtml(kind, s && Array.isArray(s.questions) ? s.questions : [])}</div>` : '';
  host.innerHTML = tabs + `<div role="tabpanel">${body}${ask}</div>`
    + (navAccVisible(COACH_LAYER_DASH[kind])
        ? `<button type="button" class="cl-more" data-cl-dash="${kind}">לדאשבורד המלא ←</button>` : '');
}

(function wireCoachLayer(){
  document.addEventListener('submit', e => {
    if (e.target.id !== 'homeAskForm') return;
    e.preventDefault();
    homeAskSubmit(document.getElementById('homeAskInput').value);
  });
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-home-coach-open]');
    if (open){ e.stopPropagation(); openNavLayer('coach'); return; }
    if (!e.target.closest('#coachSheet')) return;
    const tab = e.target.closest('[data-cl-kind]');
    if (tab){
      coachLayerKind = tab.dataset.clKind;
      coachLayerRender();
      coachLayerEnsure(coachLayerKind);
      const on = document.querySelector('#coachSheet .cl-tab[aria-selected="true"]');
      if (on) on.focus({ preventScroll:true });
      return;
    }
    const dash = e.target.closest('[data-cl-dash]');
    if (dash){ closeCoachLayer(); gotoSection(COACH_LAYER_DASH[dash.dataset.clDash]); return; }
    /* כפתור פעולה מהכרטיס עובר למסך אחר - השכבה נסגרת לפניו */
    if (e.target.closest('[data-coach-cta]')) closeCoachLayer();
  }, true);
})();

/* ---------- "שאל את המנטור על הליד הזה" (כרטיס הליד) ----------
   השאלה עולה כשהליד מול העיניים, ולכן הכפתור יושב בכרטיס הליד: הוא פותח את
   שכבת "המנטור שלי" על המנטור האישי, עם שאלה מוכנה **בשדה** - לא נשלחת לבד.
   הסוכן/ת עורך/ת ושולח/ת, והמכסה נספרת רק אז.

   **בשאלה רק מה שמתאר את הצורך, בלי מה שמזהה את הפונה:** סוג הליד, סוג
   העסקה והנכס, כמה זמן עבר והשלב. לא שם, לא טלפון, לא ההודעה (שיכולה להכיל
   טלפון), ולא עיר או כתובת - אותה רשימה סגורה של מה שהמנטור מקבל
   (docs/coaches.md, "מה נשלח"). המיסוך של ליד נעול נשמר ממילא: אין כאן אף
   שדה שהוא ממסך. */
function coachLeadQuestion(lead){
  const rent = lead.deal_type === 'rent';
  const who = lead.lead_type === 'owner_inbound' ? (rent ? 'בעל/ת נכס שרוצה להשכיר' : 'בעל/ת נכס שרוצה למכור')
    : lead.lead_type === 'agent_direct_inquiry' ? 'פנייה ישירה על נכס שלי'
    : lead.lead_type === 'visualization' ? 'מתעניין/ת שביקש/ה הדמיה'
    : (rent ? 'מחפש/ת דירה לשכירות' : 'מחפש/ת נכס לקנייה');
  const type = lead.property_type ? ', ' + lead.property_type : '';
  const ago = typeof leadAgeMinutes === 'function' ? ', נכנס ' + opsAgo(leadAgeMinutes(lead)) : '';
  if (lead.status !== 'unlocked'){
    return 'יש לי ליד נעול: ' + who + type + ago + '. איך להחליט אם לפתוח אותו, ומה להגיד בשיחה הראשונה?';
  }
  const w = typeof leadWork !== 'undefined' && leadWork.get(lead.id);
  const stage = (w && w.stage) || 'new';
  const where = stage === 'contacted' ? 'כבר דיברנו פעם אחת'
    : stage === 'meeting' ? 'קבענו פגישה או סיור'
    : 'עוד לא דיברנו';
  return 'יש לי ליד: ' + who + type + ago + '. ' + where + '. מה הצעד הנכון עכשיו, ומה להגיד לו/ה?';
}

function coachAskAboutLead(lead){
  if (!coachLayerKinds().includes('agent')) return;
  coachAsk.agent.draft = coachLeadQuestion(lead);
  coachLayerKind = 'agent';
  openNavLayer('coach');
  setTimeout(() => {
    const input = document.getElementById('coachAskQ-agent');
    if (!input) return;
    input.focus({ preventScroll:true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView({ block:'nearest' });
  }, 60);
}
