/* ============================================================================
   דיווח על ליד לא תקין והחזר לארנק (docs/lead-refunds.md)
   ----------------------------------------------------------------------------
   ההחלטות (תומר, 11.11.2026): חלון של 48 שעות מפתיחת הליד; ההחזר אוטומטי
   ולארנק, לפי מה שנגבה בפועל; מכסת החינם חוזרת; הליד נסגר (ארכיון); ומי
   שעובר את תקרת הניצול עובר לבדיקה של מנהל/ת הפלטפורמה.

   **כל הלוגיקה במסד** (report_invalid_lead, lead_report_review). כאן רק
   הצגה: מתי הכפתור מופיע, החלון, והרשימה של המנהל/ת. התנאים בצד הלקוח
   (חלון, סוג, מקור) הם נוחות - המסד בודק שוב.

   נטען לפני assets/crm.js ומגדיר פונקציות בלבד; מה שהוא צריך משם (sb,
   esc, shekel, showToast, heErr, accSetCount, refreshAgentBalance, loadLeads,
   addCardAction) נקרא בזמן ריצה.
   ========================================================================== */

const LEAD_REPORT_WINDOW_HOURS = 48;   // המסד קובע: pricing_config.lead_refund_window_hours
const LEAD_REPORT_NOTE_MAX = 300;
let leadReportOf = new Map();          // lead_id -> {status, refund_amount, quota_returned, decision_note}

const LEAD_REPORT_REASONS = [
  { key:'wrong_number', label:'מספר שגוי או מנותק' },
  { key:'spam',         label:'ספאם או פנייה לא אמיתית' },
  { key:'broker',       label:'הפונה הוא יועץ/ת נדל״ן' },
  { key:'duplicate',    label:'כפילות: אותו/ה פונה כבר פנה/תה אליי' },
];
const LEAD_REPORT_REASON_LABEL = Object.fromEntries(LEAD_REPORT_REASONS.map(r => [r.key, r.label]));

const LEAD_REPORT_ERRORS = {
  forbidden: 'אפשר לדווח רק על ליד שפתחת בעצמך.',
  not_found: 'הליד לא נמצא.',
  not_supported: 'שיחות במספר וירטואלי אינן בהחזר אוטומטי. אפשר לפנות לתמיכה.',
  already_reported: 'כבר דיווחת על הליד הזה.',
  window_closed: 'עברו 48 שעות מפתיחת הליד, ולכן אי אפשר לדווח עליו.',
  nothing_to_refund: 'הליד נפתח במסלול שאינו כולל חיוב או מכסה, ולכן אין מה להחזיר.',
  details_too_long: 'ההערה ארוכה מדי.',
  not_agent: 'צריך להיות מחובר/ת כיועץ/ת נדל״ן.',
};

/* הדיווחים של הסוכן/ת. ה-RLS מחזיר רק את שלו/ה. מסד שהמיגרציה עוד לא רצה בו
   (42P01) הוא "אין דיווחים", לא שגיאה: הכפתור פשוט יחזיר שגיאה בלחיצה. */
async function loadLeadReports(agentId){
  const map = new Map();
  try {
    const { data, error } = await sb.from('lead_invalid_reports')
      .select('lead_id, status, refund_amount, quota_returned, decision_note')
      .eq('agent_id', agentId);
    if (!error) (data || []).forEach(r => map.set(r.lead_id, r));
  } catch(_){ /* הכרטיס נטען גם בלי */ }
  return map;
}

function leadReportEligible(lead, agentId){
  if (!lead || lead.status !== 'unlocked') return false;
  // ליד חנות נרכש בחנות: הבעלים הוא agent_id ואין unlocked_by. שיחות אינן בהחזר האוטומטי
  const owner = lead.lead_type === 'store' ? lead.agent_id : lead.unlocked_by;
  if (owner !== agentId || lead.lead_type === 'call') return false;
  // מקורות שלא נגבה בהם דבר ולא נספרה מכסה. כל השאר - המסד מחליט (nothing_to_refund)
  if (['subscription_unlimited', 'premium_free', 'launch_free'].includes(lead.quota_source)) return false;
  const t = new Date(lead.unlocked_at).getTime();
  if (!t || Date.now() > t + LEAD_REPORT_WINDOW_HOURS * 3600 * 1000) return false;
  return !leadReportOf.has(lead.id);
}

/* שורת המצב בכרטיס אחרי דיווח */
function leadReportStatusText(r){
  if (!r) return '';
  if (r.status === 'refunded'){
    const amount = Number(r.refund_amount) || 0;
    return '✅ דווח כלא תקין. ' + (amount > 0 ? shekel(amount) + ' חזרו לארנק' : 'לא נגבה כסף')
      + (r.quota_returned ? ', והפנייה חזרה למכסה החינמית' : '') + '.';
  }
  if (r.status === 'pending_review') return '⏳ הדיווח ממתין לבדיקה של צוות הפלטפורמה.';
  if (r.status === 'rejected') return 'הדיווח לא אושר' + (r.decision_note ? ': ' + r.decision_note : '.');
  return '';
}

/* מוסיף לכרטיס הליד את הכפתור "דיווח על ליד לא תקין", או את שורת המצב */
function leadReportMount(container, lead, agentId){
  const existing = leadReportOf.get(lead.id);
  if (existing){
    const note = document.createElement('div');
    note.className = 'lc-report-note';
    note.style.cssText = 'font-size:.8rem;color:var(--ink-soft);margin:6px 0;line-height:1.5';
    note.textContent = leadReportStatusText(existing);
    container.appendChild(note);
    return;
  }
  if (!leadReportEligible(lead, agentId)) return;
  const free = lead.quota_source === 'free_quota';
  addCardAction(container, {
    label:'🚩 דיווח על ליד לא תקין',
    title: 'מספר שגוי, ספאם, יועץ/ת נדל״ן או כפילות. ' + (free ? 'הפנייה חוזרת למכסה החינמית' : 'הסכום שנגבה חוזר לארנק')
      + '. אפשר עד 48 שעות מפתיחת הליד.',
    onClick: () => openLeadReport(lead, agentId),
  });
}

let leadReportModal = null;
let leadReportBusy = false;

function leadReportEnsureModal(){
  if (leadReportModal) return leadReportModal;
  const el = document.createElement('div');
  el.className = 'pm-overlay';
  el.id = 'leadReportModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lrTitle');
  el.style.display = 'none';
  el.innerHTML = `
    <div class="pm-card">
      <div class="pm-title" id="lrTitle">דיווח על ליד לא תקין</div>
      <p class="exp-note" id="lrWhat" style="font-weight:600;margin-top:0"></p>
      <fieldset style="border:0;padding:0;margin:10px 0 0">
        <legend class="exp-note" style="margin:0 0 6px">מה הבעיה?</legend>
        ${LEAD_REPORT_REASONS.map((r, i) => `
          <label style="display:flex;gap:8px;align-items:center;min-height:36px;cursor:pointer">
            <input type="radio" name="lrReason" value="${r.key}"${i === 0 ? ' checked' : ''}> <span>${r.label}</span>
          </label>`).join('')}
      </fieldset>
      <div class="field">
        <label for="lrDetails">הערה (לא חובה)</label>
        <textarea id="lrDetails" rows="2" maxlength="${LEAD_REPORT_NOTE_MAX}"></textarea>
      </div>
      <p class="exp-note" id="lrNote"></p>
      <div class="pm-actions">
        <button type="button" class="btn btn-ghost" id="lrCancel">ביטול</button>
        <button type="button" class="btn btn-gold" id="lrSend">שליחת הדיווח</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const close = () => { if (!leadReportBusy) el.style.display = 'none'; };
  el.querySelector('#lrCancel').addEventListener('click', close);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  leadReportModal = el;
  return el;
}

function openLeadReport(lead, agentId){
  const el = leadReportEnsureModal();
  const free = lead.quota_source === 'free_quota';
  el.querySelector('#lrWhat').textContent = [lead.display_name, lead.city].filter(Boolean).join(' · ');
  el.querySelector('#lrDetails').value = '';
  el.querySelector('input[name=lrReason]').checked = true;
  el.querySelector('#lrNote').textContent =
    (free ? 'הפנייה תחזור למכסה החינמית של החודש. ' : 'הסכום שנגבה על הליד יחזור לארנק. ')
    + 'הליד יעבור לארכיון ולא יחזור. מי שמדווח/ת על הרבה לידים בחודש עובר/ת לבדיקה של צוות הפלטפורמה.';
  const send = el.querySelector('#lrSend');
  const fresh = send.cloneNode(true);       // בלי הצטברות מאזינים מפתיחה קודמת
  send.replaceWith(fresh);
  fresh.disabled = false;
  fresh.textContent = 'שליחת הדיווח';
  fresh.addEventListener('click', async () => {
    if (leadReportBusy) return;
    leadReportBusy = true;
    fresh.disabled = true;
    fresh.textContent = 'שולח…';
    const reason = el.querySelector('input[name=lrReason]:checked').value;
    const details = el.querySelector('#lrDetails').value.trim();
    const { data, error } = await sb.rpc('report_invalid_lead',
      { p_lead: lead.id, p_reason: reason, p_details: details || null });
    leadReportBusy = false;
    fresh.disabled = false;
    fresh.textContent = 'שליחת הדיווח';
    if (error || !data || data.error){
      showToast('הדיווח נכשל: ' + (LEAD_REPORT_ERRORS[data && data.error] || heErr(error || (data && data.error))), 6500);
      return;
    }
    el.style.display = 'none';
    if (data.status === 'pending_review'){
      showToast('הדיווח התקבל וממתין לבדיקה של צוות הפלטפורמה.', 6000);
    } else {
      const amount = Number(data.refund_amount) || 0;
      showToast(amount > 0 ? shekel(amount) + ' חזרו לארנק והליד עבר לארכיון.'
        : 'הפנייה חזרה למכסה והליד עבר לארכיון.', 6000);
      if (typeof refreshAgentBalance === 'function') refreshAgentBalance();
    }
    loadLeads(agentId);
  });
  el.style.display = 'flex';
  el.querySelector('input[name=lrReason]').focus();
}

/* ---------------------------------------------------------------------------
   מנהל/ת הפלטפורמה: "דיווחי לידים" (accLeadReports)
   ממתינים ראשונים (הישן קודם), אחריהם מה שהוחלט לאחרונה. בלי טלפון, שם
   הפונה או הודעה: הסימנים של המערכת והסיבה מספיקים להחלטה, ומי שצריך/ה עוד
   פותח/ת את הליד.
   --------------------------------------------------------------------------- */
function leadReportEvidenceChips(ev){
  ev = ev || {};
  const chips = [];
  if (ev.phone_invalid) chips.push('המספר אינו בפורמט תקין');
  if (ev.duplicate) chips.push('אותו מספר כבר נפתח אצל הסוכן/ת');
  if (ev.broker_phone) chips.push('המספר רשום אצלנו כסוכן/ת');
  if (ev.reports_30d) chips.push(ev.reports_30d + ' דיווחים מתוך ' + (ev.opened_30d || 0) + ' לידים ב-30 יום');
  return chips;
}

async function loadLeadReportsAdmin(){
  const listEl = document.getElementById('leadReportsList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="empty-state">טוען…</div>';
  const { data, error } = await sb.rpc('lead_reports_admin', { p_status: null, p_limit: 100 });
  if (error){
    listEl.innerHTML = '<div class="empty-state">שגיאה: ' + esc(heErr(error)) + '</div>';
    return;
  }
  const rows = data || [];
  const pending = rows.filter(r => r.status === 'pending_review');
  accSetCount('accLeadReports', pending.length ? (pending.length === 1 ? 'ממתין אחד' : pending.length + ' ממתינים') : '');
  if (!rows.length){
    listEl.innerHTML = '<div class="empty-state">אין דיווחים על לידים. 🎯</div>';
    return;
  }
  listEl.innerHTML = '';
  rows.forEach(r => {
    const isPending = r.status === 'pending_review';
    const item = document.createElement('div');
    item.className = 'card';
    item.style.cssText = 'padding:12px 14px;margin-bottom:8px';
    const statusText = isPending ? '⏳ ממתין לבדיקה'
      : r.status === 'refunded' ? '✅ הוחזר' + (r.auto ? ' אוטומטית' : ' באישור ידני')
      : 'נדחה';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <b>${esc(r.agent_name)}</b>
        <span class="exp-note" style="margin:0">${esc(statusText)} · ${esc(hebDate(r.created_at))}</span>
      </div>
      <div style="margin-top:4px">${esc(LEAD_REPORT_REASON_LABEL[r.reason] || r.reason)}
        <span class="exp-note" style="margin:0"> · ${esc([r.lead_type, r.city].filter(Boolean).join(' · '))}
        ${r.refund_amount > 0 ? ' · ' + esc(shekel(r.refund_amount)) : ''}${r.quota_returned ? ' · חזרה פנייה למכסה' : ''}</span></div>
      ${r.details ? `<div class="exp-note" style="margin-top:4px">״${esc(r.details)}״</div>` : ''}
      ${r.decision_note ? `<div class="exp-note" style="margin-top:4px">הערת ההחלטה: ${esc(r.decision_note)}</div>` : ''}
      <div class="exp-note" style="margin-top:6px">${leadReportEvidenceChips(r.evidence).map(esc).join(' · ')}</div>
      ${isPending ? `<div class="pm-actions" style="margin-top:10px">
        <button type="button" class="btn btn-gold" data-act="approve">אישור והחזר</button>
        <button type="button" class="btn btn-ghost" data-act="reject">דחייה</button>
      </div>` : ''}`;
    if (isPending){
      item.querySelector('[data-act=approve]').addEventListener('click', e => leadReportDecide(r, true, e.currentTarget));
      item.querySelector('[data-act=reject]').addEventListener('click', e => leadReportDecide(r, false, e.currentTarget));
    }
    listEl.appendChild(item);
  });
}

async function leadReportDecide(row, approve, btn){
  let note = null;
  if (approve){
    if (!window.confirm('לאשר ולהחזיר לארנק של ' + row.agent_name + '? הליד יעבור לארכיון שלו/ה.')) return;
  } else {
    note = window.prompt('סיבת הדחייה (נשלחת לסוכן/ת בהתראה):', 'לאחר בדיקה, הליד נשאר אצלך ולא הוחזר חיוב.');
    if (note === null) return;
  }
  btn.disabled = true;
  const { data, error } = await sb.rpc('lead_report_review',
    { p_report: row.id, p_approve: approve, p_note: (note || '').trim() || null });
  btn.disabled = false;
  if (error || !data || data.error){
    showToast('הפעולה נכשלה: ' + ((data && LEAD_REPORT_ERRORS[data.error]) || heErr(error || (data && data.error))), 6000);
    return;
  }
  showToast(approve ? 'הוחזר לארנק' : 'הדיווח נדחה');
  loadLeadReportsAdmin();
}

/* ליד שהוחזר עליו חיוב נשאר בארכיון: המסד חוסם את המחיקה מ-lead_archives, והכפתור
   "החזרה מהארכיון" אינו מוצג */
function leadReportBlocksUnarchive(lead){
  const r = leadReportOf.get(lead.id);
  return !!r && r.status === 'refunded';
}
