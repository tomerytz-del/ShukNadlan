/* ==========================================================================
   הצוות שלי - דאשבורד מנהל/ת צוות, לידים בצוות והסוכנים בצוות
   --------------------------------------------------------------------------
   שלב 4 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 4;
   docs/team-dashboard.md). שלוש קטגוריות ב-#teamLeadSection, שמוצג רק למי
   שמנהל/ת צוות (my_roles().led_team_id). הוא מחוץ ל-#managerSection: מנהל/ת
   צוות הוא/היא לרוב סוכן/ת (role = 'agent').

   ‏**המספרים:** team_dashboard() במסד מריצה את אותה ליבה של דאשבורד המשרד
   (_office_dashboard_core) על סוכני הצוות בלבד, ולכן המספרים של סוכן/ת זהים
   בשני הדאשבורדים. העזרים כאן מ-assets/crm-office-dashboard.js (odDerive,
   odKpis, odAlertsHtml, odFunnelHtml, odResponseHtml, odSourcesHtml,
   odExpiringHtml, הפורמט והתקופות) - אותו עיצוב (.od).

   ‏**מה מנהל/ת צוות לא רואה ולא עושה** (החלטות 1 ו-3 של תומר):
   • טלפון של ליד או ההודעה החופשית - team_leads() לא מחזירה אותם בכלל.
   • יעדים - נקבעים בדאשבורד המשרד (agent_targets פתוחה למנהל/ת משרד).
   • פעולה על ליד של סוכן/ת אחר/ת - אין העברה ואין ניתוב. הפעולה היחידה
     היא "שיחת 1:1": פגישה ביומן **של מנהל/ת הצוות** (openAgendaForm).

   הקובץ נטען אחרי crm-office-dashboard.js ולפני crm.js, וכל הפונקציות
   כאן נקראות רק אחרי שהעמוד נטען.
   ========================================================================== */

const TD_PERIOD_KEY = 'crmTeamDashPeriod';
const TD_LEAD_STAGES = [
  ['all',          'הכל'],
  ['waiting',      'ממתינים למענה'],
  ['new',          'חדש'],
  ['contacted',    'נוצר קשר'],
  ['meeting',      'פגישה / סיור'],
  ['won',          'נסגר'],
  ['not_relevant', 'לא רלוונטי'],
];
const TD_STAGE_LABEL = Object.fromEntries(TD_LEAD_STAGES);

let myRoles = null;

const tdState = {
  period: 'q_cur',
  data: null,
  loadedFor: null,
  busy: false,
  leads: null,
  leadsFor: null,
  leadsBusy: false,
  leadStage: 'all',
};

try{
  const saved = localStorage.getItem(TD_PERIOD_KEY);
  if (OD_PERIODS.some(p => p.key === saved)) tdState.period = saved;
}catch(e){ /* מצב פרטי - נשארים עם ברירת המחדל */ }

/* ---------- מה אני: קריאה אחת בעלייה ----------
   ‏my_roles (20270525130000). מסד שהמיגרציה עוד לא רצה בו מחזיר שגיאה,
   והאזור פשוט נשאר מוסתר. */
async function loadMyRoles(){
  const { data, error } = await sb.rpc('my_roles');
  myRoles = error ? null : (data || null);
  const section = document.getElementById('teamLeadSection');
  if (!section) return;
  const lead = !!(myRoles && myRoles.led_team_id);
  section.style.display = lead ? 'block' : 'none';
  if (typeof applyNavFilter === 'function') applyNavFilter();
  if (typeof scheduleNavCounts === 'function') scheduleNavCounts();
}

function tdRange(){ return odPeriodRange(tdState.period); }

/* ---------- דאשבורד הצוות ---------- */
async function loadTeamDashboard(force){
  const host = document.getElementById('teamDash');
  if (!host) return;
  const key = tdState.period;
  if (!force && tdState.data && tdState.loadedFor === key){ renderTeamDashboard(); return; }
  if (tdState.busy) return;
  tdState.busy = true;
  if (!tdState.data) host.innerHTML = odSkeleton();
  else host.classList.add('od-refreshing');
  const range = tdRange();
  const { data, error } = await sb.rpc('team_dashboard', { p_from: range.from, p_to: range.to });
  tdState.busy = false;
  host.classList.remove('od-refreshing');
  if (error){
    host.innerHTML = '<div class="od-error">' + escapeHtml(error.code === '42501'
      ? 'הדאשבורד פתוח למנהל/ת צוות בלבד.'
      : 'טעינת דאשבורד הצוות נכשלה: ' + heErr(error)) + '</div>';
    return;
  }
  tdState.data = data || {};
  tdState.loadedFor = key;
  renderTeamDashboard();
  renderTeamAgents();
}

function tdHeader(data, range){
  const team = data.team || {};
  return `<div class="td-head">
    <div class="td-title">
      <h2>${escapeHtml(team.name || 'הצוות שלי')}</h2>
      <p>${escapeHtml(odRangeLabel(data.period || range))}${team.lead ? ' · מנהל/ת הצוות: ' + escapeHtml(team.lead) : ''}</p>
    </div>
    <div class="od-periods td-periods" role="group" aria-label="תקופה">
      ${OD_PERIODS.map(p => `<button type="button" data-td-period="${p.key}" aria-pressed="${p.key === tdState.period}">${p.label}</button>`).join('')}
      <button type="button" class="od-refresh" data-td-refresh aria-label="רענון הנתונים" title="רענון">↻</button>
    </div>
  </div>`;
}

/* התקדמות ליעד מול שאר הצוותים: שם ואחוז בלבד - בלי סכומים ובלי שמות
   סוכנים מצוותים אחרים. צוות בלי יעדים מוצג בלי אחוז. */
function tdProgressHtml(rows){
  if (!rows || rows.length < 2) return '';
  const max = Math.max(1, ...rows.map(r => odNum(r.target_pct)));
  return `<section class="od-card td-progress">
    <div class="od-card-h"><h3>התקדמות ליעד מול שאר הצוותים</h3>
      <p>עמלות הסוכנים שהוגדר להם יעד, חלקי סכום היעדים. בלי סכומים ובלי שמות מצוותים אחרים.</p></div>
    ${rows.map(r => `<div class="td-prog-row${r.is_mine ? ' is-mine' : ''}">
      <span class="td-prog-name">${escapeHtml(r.name)}${r.is_mine ? ' (שלי)' : ''}</span>
      <span class="td-prog-bar"><span style="width:${r.target_pct == null ? 0 : Math.min(100, odNum(r.target_pct) / max * 100).toFixed(1)}%"></span></span>
      <span class="td-prog-v">${r.target_pct == null ? 'אין יעד' : odPct(r.target_pct)}</span>
    </div>`).join('')}
  </section>`;
}

const TD_COLS = [
  ['agent', 'סוכן/ת'], ['leads', 'לידים'], ['response_share', 'קיבלו מענה'], ['avg_response_min', 'תגובה ממוצעת'],
  ['open_unanswered', 'ממתינים'], ['meetings', 'פגישות'], ['agreements', 'הסכמים'], ['deals', 'עסקאות'],
  ['commission', 'עמלות'], ['target_pct', 'מהיעד'],
];

function tdTableHtml(agents){
  if (!agents.length) return '<p class="od-muted">אין עדיין סוכנים בצוות. השיוך נעשה ב"צוותים וסוכנים" אצל מנהל/ת המשרד.</p>';
  const cell = (a, k) => {
    if (k === 'agent') return `<td>${escapeHtml(a.agent)}</td>`;
    const v = a[k];
    const txt = k === 'response_share' || k === 'target_pct' ? odPct(v)
      : k === 'avg_response_min' ? (v == null ? '-' : odDur(v))
      : k === 'commission' ? odIls(v) : odInt(v);
    const warn = (k === 'open_unanswered' && odNum(v) >= OD_TH.openWarn)
      || (k === 'avg_response_min' && v != null && odNum(v) > OD_TH.slowAvgMin);
    return `<td class="n${warn ? ' td-warn' : ''}">${txt}</td>`;
  };
  return `<table class="od-table td-table"><thead><tr>${TD_COLS.map(([k, l]) => `<th class="${k === 'agent' ? '' : 'n'}">${l}</th>`).join('')}</tr></thead>
    <tbody>${agents.slice().sort((a, b) => odNum(b.commission) - odNum(a.commission) || odNum(b.leads) - odNum(a.leads))
      .map(a => `<tr>${TD_COLS.map(([k]) => cell(a, k)).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderTeamDashboard(){
  const host = document.getElementById('teamDash');
  if (!host || !tdState.data) return;
  const data = tdState.data;
  const view = odDerive(data, null);
  const range = tdRange();
  if (typeof accSetSummary === 'function'){
    const o = view.office;
    accSetSummary('accTeamDashboard', [
      odCount(view.agents.length, 'סוכן/ת אחד/ת', 'סוכנים'),
      odCount(o.agreements, 'הסכם אחד', 'הסכמים'),
      o.avg_response_min != null ? 'תגובה ' + odDur(o.avg_response_min) : null,
    ].filter(Boolean).join(' · '));
  }
  if (typeof accSetCount === 'function'){
    const sev = view.alerts.filter(a => a.sev === 2).length;
    accSetCount('accTeamDashboard', sev || '', sev);
  }
  host.innerHTML = `<div class="od td" dir="rtl">
    ${tdHeader(data, range)}
    ${odKpis(view, range)}
    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>דורש תשומת לב</h3>
          <p>סוכני הצוות שחורגים מהסטנדרט: תגובה מעל ${OD_TH.slowAvgMin} דק׳, ${OD_TH.openWarn}+ לידים ללא מענה, בלעדיות נמוכה או פיגור ביעד.</p></div>
        ${odAlertsHtml(view.alerts)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>משפך הצוות: מליד לעסקה</h3>
          <p>האחוז מתחת לכל שלב הוא כמה עברו לשלב הבא.</p></div>
        ${odFunnelHtml(view.funnel)}
      </div>
    </section>
    ${tdProgressHtml(data.teams_progress)}
    <section class="od-sec">
      <div class="od-sec-h"><h2>ביצועי הסוכנים בצוות</h2></div>
      <div class="od-card"><div class="od-tablewrap">${tdTableHtml(view.agents)}</div></div>
    </section>
    <section class="od-grid">
      <div class="od-card">
        <div class="od-card-h"><h3>מהירות תגובה ללידים</h3><p>חלוקת הלידים לפי הזמן עד המענה הראשון.</p></div>
        ${odLegend(OD_BUCKETS.map(b => [b.color, b.label]))}
        ${odResponseHtml(view.agents)}
      </div>
      <div class="od-card">
        <div class="od-card-h"><h3>מאיפה מגיעים הלידים של הצוות</h3></div>
        <div class="od-tablewrap">${odSourcesHtml(data.lead_sources || [])}</div>
      </div>
    </section>
    <section class="od-card">
      <div class="od-card-h"><h3>בלעדיות שפוקעות בקרוב</h3><p>של סוכני הצוות, ב-30 הימים הקרובים.</p></div>
      <div class="od-tablewrap">${odExpiringHtml(data.expiring || [], view.agents)}</div>
    </section>
  </div>`;
}

/* ---------- הסוכנים בצוות ----------
   כרטיס לכל סוכן/ת מאותם נתונים של הדאשבורד, ו"שיחת 1:1" - פגישה ביומן
   של מנהל/ת הצוות. אין כאן פעולה על הלידים או על הנכסים של הסוכן/ת. */
function renderTeamAgents(){
  const host = document.getElementById('teamAgents');
  if (!host) return;
  if (!tdState.data){ host.innerHTML = odSkeleton(); return; }
  const agents = odDerive(tdState.data, null).agents;
  accSetCount('accTeamAgents', agents.length);
  if (!agents.length){
    host.innerHTML = '<p class="od-muted">אין עדיין סוכנים בצוות.</p>';
    return;
  }
  const canMeet = navAccVisible('accAgenda');
  host.innerHTML = '<div class="td-agents">' + agents.map(a => `
    <article class="td-agent">
      <div class="td-agent-top">${odAvatar(a)}<div><b>${escapeHtml(a.agent)}</b>
        <span>${odCount(a.active_listings, 'נכס פעיל אחד', 'נכסים פעילים')}${a.target_pct != null ? ' · ' + odPct(a.target_pct) + ' מהיעד' : ''}</span></div></div>
      <div class="td-agent-stats">
        <span><b>${odInt(a.leads)}</b> לידים</span>
        <span class="${odNum(a.open_unanswered) >= OD_TH.openWarn ? 'td-warn' : ''}"><b>${odInt(a.open_unanswered)}</b> ממתינים</span>
        <span><b>${a.avg_response_min == null ? '-' : odDur(a.avg_response_min)}</b> תגובה</span>
        <span><b>${odInt(a.deals)}</b> עסקאות</span>
      </div>
      ${canMeet ? `<button type="button" class="hb-btn td-meet" data-td-meet="${escapeHtml(a.agent_id)}">שיחת 1:1 ביומן שלי</button>` : ''}
    </article>`).join('') + '</div>';
}

/* ---------- לידים בצוות ----------
   ‏team_leads(): שם הלקוח/ה (ממוסך בליד נעול) ופרטי הליד, בלי טלפון ובלי
   ההודעה החופשית. קריאה בלבד - אין כאן כפתור שפונה ללקוח/ה או מעביר ליד. */
async function loadTeamLeads(force){
  const host = document.getElementById('teamLeads');
  if (!host) return;
  const key = tdState.period;
  if (!force && tdState.leads && tdState.leadsFor === key){ renderTeamLeads(); return; }
  if (tdState.leadsBusy) return;
  tdState.leadsBusy = true;
  if (!tdState.leads) host.innerHTML = '<div class="empty-state">טוען…</div>';
  const range = tdRange();
  const { data, error } = await sb.rpc('team_leads', { p_from: range.from, p_to: range.to });
  tdState.leadsBusy = false;
  if (error){
    host.innerHTML = '<div class="empty-state">' + escapeHtml(error.code === '42501'
      ? 'הרשימה פתוחה למנהל/ת צוות בלבד.' : 'טעינת הלידים בצוות נכשלה: ' + heErr(error)) + '</div>';
    return;
  }
  tdState.leads = data || [];
  tdState.leadsFor = key;
  renderTeamLeads();
}

function tdLeadWaiting(l){ return !l.archived && l.first_response_at == null; }

function renderTeamLeads(){
  const host = document.getElementById('teamLeads');
  if (!host || !tdState.leads) return;
  const all = tdState.leads;
  const waiting = all.filter(tdLeadWaiting).length;
  accSetCount('accTeamLeads', waiting || '', waiting);
  accSetSummary('accTeamLeads', all.length ? odCount(all.length, 'ליד אחד', 'לידים') + ' · ' + odRangeLabel(tdRange()) : '');
  const stage = tdState.leadStage;
  const rows = all.filter(l => stage === 'all' ? true
    : stage === 'waiting' ? tdLeadWaiting(l) : l.stage === stage);
  const kind = l => typeof leadKind === 'function' ? leadKind(l).label.split(' · ')[0] : (l.lead_type || '');
  const wait = l => l.first_response_at
    ? 'נענה ' + odDur(Math.max(0, (new Date(l.first_response_at) - new Date(l.created_at)) / 60000))
    : (l.minutes_waiting != null ? 'ממתין ' + odDur(l.minutes_waiting) : '');
  host.innerHTML = `
    <div class="td-leads-head">
      <div class="od-periods td-periods" role="group" aria-label="תקופה">
        ${OD_PERIODS.map(p => `<button type="button" data-td-period="${p.key}" aria-pressed="${p.key === tdState.period}">${p.label}</button>`).join('')}
      </div>
      <div class="srch-chips td-stage-chips" role="group" aria-label="סינון לפי שלב">
        ${TD_LEAD_STAGES.map(([k, l]) => `<button type="button" class="srch-chip${k === stage ? ' is-on' : ''}" aria-pressed="${k === stage}" data-td-stage="${k}">${l}${k === 'waiting' && waiting ? ' · ' + waiting : ''}</button>`).join('')}
      </div>
      <p class="td-note">שם הלקוח/ה ופרטי הליד בלבד. הטלפון וההודעה נשארים אצל הסוכן/ת המטפל/ת.</p>
    </div>
    ${rows.length ? `<div class="td-leads">${rows.map(l => `
      <article class="td-lead${tdLeadWaiting(l) ? ' is-waiting' : ''}">
        <div class="td-lead-main">
          <b>${l.locked ? '🔒 ' : ''}${escapeHtml(l.client_name || 'פונה')}</b>
          <span>${escapeHtml([kind(l), INV_VALUE_LABELS[l.deal_type] || '', l.property_title || l.property_type || '', l.city || ''].filter(Boolean).join(' · '))}</span>
          ${l.property_details ? `<span class="td-lead-det">${escapeHtml(l.property_details)}</span>` : ''}
        </div>
        <div class="td-lead-side">
          <span class="td-lead-agent">${escapeHtml(l.agent_name || '')}</span>
          <span class="td-stage td-st-${escapeHtml(l.stage || 'new')}">${escapeHtml(TD_STAGE_LABEL[l.stage] || 'חדש')}${l.archived ? ' · בארכיון' : ''}</span>
          <span class="td-lead-when">${escapeHtml(odDateLabel(String(l.created_at).slice(0, 10)))}${wait(l) ? ' · ' + escapeHtml(wait(l)) : ''}</span>
        </div>
      </article>`).join('')}</div>`
      : '<p class="od-muted">אין לידים בסינון הזה.</p>'}`;
}

/* ---------- חיווט ---------- */
(function wireTeamSection(){
  const section = document.getElementById('teamLeadSection');
  if (!section) return;
  const on = (id, fn) => {
    const acc = document.getElementById(id);
    if (acc) acc.addEventListener('toggle', () => { if (acc.open) fn(); });
  };
  on('accTeamDashboard', () => loadTeamDashboard());
  on('accTeamAgents', () => { renderTeamAgents(); loadTeamDashboard(); });
  on('accTeamLeads', () => loadTeamLeads());

  section.addEventListener('click', e => {
    const per = e.target.closest('[data-td-period]');
    if (per){
      tdState.period = per.dataset.tdPeriod;
      try{ localStorage.setItem(TD_PERIOD_KEY, tdState.period); }catch(err){}
      if (document.getElementById('accTeamDashboard').open || document.getElementById('accTeamAgents').open) loadTeamDashboard(true);
      if (document.getElementById('accTeamLeads').open) loadTeamLeads(true);
      return;
    }
    if (e.target.closest('[data-td-refresh]')){ loadTeamDashboard(true); return; }
    const st = e.target.closest('[data-td-stage]');
    if (st){ tdState.leadStage = st.dataset.tdStage; renderTeamLeads(); return; }
    const prop = e.target.closest('[data-od-property]');
    if (prop){ odOpenProperty(prop.dataset.odProperty); return; }
    const meet = e.target.closest('[data-td-meet]');
    if (meet){
      const a = odDerive(tdState.data || {}, null).agents.find(x => x.agent_id === meet.dataset.tdMeet);
      openAgendaForm({ kind:'meeting', title:'שיחת 1:1 עם ' + (a ? a.agent : 'סוכן/ת בצוות') });
    }
  });
})();
