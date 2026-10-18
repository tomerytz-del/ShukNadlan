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
  if (coachRerender[kind]) coachRerender[kind]();
}

/* ---------- הטון והוותק ---------- */
async function coachToneLoad(){
  coachTone = 'warm';
  const { data } = await sb.from('coach_preferences').select('tone, experience').maybeSingle();
  if (!data) return;
  coachTone = data.tone === 'direct' ? 'direct' : 'warm';
  coachExp = COACH_EXP.some(x => x.key === data.experience) ? data.experience : null;
  Object.values(coachRerender).forEach(fn => fn && fn());
}

/* אופטימי, כמו "בוצע": הכרטיס מתעדכן מיד, ושגיאה מחזירה אותו. ‏upsert של
   עמודה אחת משאיר את השנייה כמו שהיא. */
async function coachPrefSave(field, value){
  const cur = field === 'tone' ? coachTone : coachExp;
  if (!currentAgent || value === cur) return;
  const set = v => { if (field === 'tone') coachTone = v; else coachExp = v; };
  set(value);
  Object.values(coachRerender).forEach(fn => fn && fn());
  const { error } = await sb.from('coach_preferences')
    .upsert({ agent_id: currentAgent.id, [field]: value, updated_at: new Date().toISOString() }, { onConflict: 'agent_id' });
  if (error){
    set(cur);
    Object.values(coachRerender).forEach(fn => fn && fn());
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
  // מאמן הסוכן/ת לא מציג "יגיע מחר": הוא נדלק בהדרגה (AGENT_COACH_ENABLED),
  // והבטחה שלא מתקיימת גרועה מכרטיס שלא קיים. ראו coachCardHtml.
  team:   'הסיכום הראשון יגיע ביום ראשון בבוקר: מה עבד בצוות בשבוע שעבר, מה תקוע, שלושה צעדים לשבוע וסדר יום לישיבת הצוות.',
  office: 'הסיכום הראשון יגיע ביום ראשון בבוקר: מה עבד במשרד בשבוע שעבר, מה תקוע, ועד שלוש החלטות לשבוע הזה.',
};

const COACH_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
const COACH_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

function coachHead(kind, sub){
  return `<div class="coach-head"><span class="coach-ico">${COACH_ICON}</span>
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
      ${coachHead(kind, kind === 'team' ? 'סיכום שבועי לצוות' : 'סיכום שבועי למשרד')}
      <p class="coach-empty">${escapeHtml(COACH_EMPTY[kind])}</p></section>`;
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
      <input id="${id}" type="text" maxlength="300" autocomplete="off" placeholder="שאלה למנטור..."
        value="${escapeHtml(st.draft || '')}"${st.busy ? ' disabled' : ''}>
      <button type="submit" aria-label="שליחת השאלה"${st.busy ? ' disabled' : ''}>←</button>
    </form>
    ${sugg.length && !st.q ? `<div class="coach-ask-sugg">${sugg.map(q =>
      `<button type="button" data-coach-q="${kind}" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>` : ''}
    ${st.q ? `<div class="coach-ask-out" aria-live="polite">
      <p class="coach-ask-q">${escapeHtml(st.q)}</p>
      ${st.busy ? '<p class="coach-ask-a is-busy">המנטור חושב…</p>'
        : st.err ? `<p class="coach-ask-a is-err">${escapeHtml(st.err)}</p>`
        : `<p class="coach-ask-a">${escapeHtml(st.a || '')}</p>`}
      ${st.remaining != null && !st.busy ? `<p class="coach-ask-left">${st.remaining
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
    ${kind === 'agent' ? '<p class="coach-ask-left">אפשר לשאול את המנטור גם בוואטסאפ, דרך גבריאלה</p>' : ''}
  </div>`;
}

async function coachAskSend(kind, question){
  const q = String(question || '').trim();
  const st = coachAsk[kind];
  if (!q || st.busy) return;
  if (q.length < 3){ showToast('צריך לכתוב שאלה של כמה מילים לפחות.'); return; }
  Object.assign(st, { q, a: '', err: '', busy: true, draft: '' });
  if (coachRerender[kind]) coachRerender[kind]();
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
  if (coachRerender[kind]) coachRerender[kind]();
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
  if (coachRerender[kind]) coachRerender[kind]();
  const { data, error } = await sb.rpc('coach_action_done', { p_kind: kind, p_summary_id: row.id, p_index: i, p_done: on });
  if (error){
    row.actions_done = before;
    showToast('לא נשמר: ' + heErr(error));
  } else {
    row.actions_done = data || [];
  }
  if (coachRerender[kind]) coachRerender[kind]();
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
    coachAskSend(form.dataset.coachAsk, form.querySelector('input').value);
  });
  /* מה שהוקלד נשמר כשהדאשבורד מצויר מחדש (למשל אחרי "בוצע") */
  document.addEventListener('input', e => {
    const form = e.target.closest && e.target.closest('[data-coach-ask]');
    if (form) coachAsk[form.dataset.coachAsk].draft = e.target.value;
  });
})();
