/* ==========================================================================
   תיבת המשימות של מנהל/ת הפלטפורמה (שלב 3 בשדרוג האדמין, docs/admin-inbox.md)
   --------------------------------------------------------------------------
   ארבעת התורים שמחכים למנהל/ת - לידים ללא יעד, בקשות החזר, ערעורי רישיון
   ו"חסר למנטור" - ברשימה אחת, לפי הדחיפות ביחס לזמן היעד (admin_inbox,
   מיגרציה 20270718090000). צבע לפי ההמתנה: ירוק בזמן, צהוב מעבר לחצי, אדום
   כשחרג.

   **ההחלטה עצמה נשארת במסך של כל תור.** "פתיחה" עוברת לאקורדיון הקיים, עם
   האישורים, המיילים והרישום שכבר יש לו - ובמיוחד ההחזר, שעובר רק דרך ה-Edge
   Function שלו. כך אין כאן עותק שני של לוגיקה של כסף או של רישיון.

   הקובץ נטען לפני assets/crm.js ומשתמש בגלובלים שלו (sb, esc, shekel,
   accSetCount, gotoSection, heErr, showToast) רק בזמן קריאה.
   ========================================================================== */

/* הסוג → איך הוא נקרא, ולאיזה מסך "פתיחה" עוברת */
const ADMIN_INBOX_KINDS = {
  unrouted_lead:  { label:'ליד ללא יעד',    acc:'accUnroutedLeads' },
  license_appeal: { label:'ערעור רישיון',   acc:'accLicenseAppeals' },
  refund:         { label:'בקשת החזר',      acc:'accRefundQueue' },
  coach_gap:      { label:'חסר למנטור',     acc:'accCoachGaps' },
};

let adminInboxKind = null;      // הצ'יפ הנבחר; null = הכל
let adminInboxBusy = false;

function inboxWaitText(min){
  const m = Math.max(0, Number(min) || 0);
  if (m < 60) return m + ' דק׳';
  const h = Math.floor(m / 60);
  if (h < 48) return h + ' שע׳';
  return Math.floor(h / 24) + ' ימים';
}

/* ירוק עד חצי מזמן היעד, צהוב עד הזמן, אדום מעבר לו (HANDOFF סעיף 4.3) */
function inboxWaitClass(row){
  const ratio = (Number(row.waiting_minutes) || 0) / Math.max(1, Number(row.sla_minutes) || 1);
  return ratio >= 1 ? 'is-late' : ratio >= 0.5 ? 'is-warn' : 'is-ok';
}

/* כותרת ושורת משנה לכל סוג. **אין כאן טלפון, מייל או תוכן פנייה** - גם
   ה-RPC אינו מחזיר אותם. מי שצריך/ה אותם פותח/ת את המסך של התור. */
function inboxRowText(row){
  const m = row.meta || {};
  if (row.kind === 'unrouted_lead'){
    const kinds = typeof UNROUTED_KIND_LABELS !== 'undefined' ? UNROUTED_KIND_LABELS : {};
    const reasons = typeof UNROUTED_REASONS !== 'undefined' ? UNROUTED_REASONS : {};
    return { title: kinds[m.lead_kind] || 'ליד', sub: [m.city, reasons[m.reason] || ''].filter(Boolean).join(' · ') };
  }
  if (row.kind === 'refund'){
    return { title: m.agent || 'סוכן/ת', sub: typeof shekel === 'function' ? shekel(m.amount) : String(m.amount || '') };
  }
  if (row.kind === 'license_appeal'){
    return { title: m.name || 'פונה', sub: m.license ? 'רישיון ' + m.license : '' };
  }
  if (row.kind === 'coach_gap'){
    const n = Number(m.asked) || 0;
    return { title: m.topic || 'נושא', sub: n === 1 ? 'שאלה אחת' : n + ' שאלות' };
  }
  return { title: row.kind, sub: '' };
}

async function loadAdminInbox(){
  const list = document.getElementById('adminInboxList');
  if (!list || adminInboxBusy) return;
  adminInboxBusy = true;
  const [inbox, counts] = await Promise.all([
    sb.rpc('admin_inbox', { p_kind: adminInboxKind, p_limit: 100, p_offset: 0 }),
    sb.rpc('admin_inbox_counts'),
  ]);
  adminInboxBusy = false;

  const err = inbox.error || counts.error;
  if (err){
    // ‏PGRST202/42883 - האתר עולה לפני המסד (docs/netlify-usage.md, הסקיל
    // deploy-path): בדקות שבין הדיפלוי למיגרציה הפונקציה עוד לא קיימת
    list.innerHTML = '<div class="empty-state">' + esc(
      (err.code === 'PGRST202' || err.code === '42883')
        ? 'תיבת המשימות עוד לא קיימת במסד - המיגרציה 20270718090000_admin_inbox.sql טרם רצה.'
        : 'שגיאה בטעינת תיבת המשימות: ' + heErr(err)) + '</div>';
    return;
  }

  const c = counts.data || {};
  const total = Number(c.total) || 0;
  const overdue = Number(c.overdue) || 0;
  // המונה בתפריט: כל מה שממתין. אדום רק כשמשהו חרג (navHotNow ב-crm.js)
  if (typeof navHotNow !== 'undefined'){
    if (overdue) navHotNow.add('accAdminInbox'); else navHotNow.delete('accAdminInbox');
  }
  window.adminInboxCounts = c;
  accSetCount('accAdminInbox', total || '');

  renderAdminInboxChips(c);
  renderAdminInboxRows(Array.isArray(inbox.data) ? inbox.data : []);
  renderAdminSla(c.sla || {});
}

function renderAdminInboxChips(c){
  const host = document.getElementById('adminInboxChips');
  if (!host) return;
  const kinds = c.kinds || {};
  host.innerHTML = '';
  [[null, 'הכל', Number(c.total) || 0, Number(c.overdue) || 0]]
    .concat(Object.keys(ADMIN_INBOX_KINDS).map(k => [k, ADMIN_INBOX_KINDS[k].label,
      Number((kinds[k] || {}).total) || 0, Number((kinds[k] || {}).overdue) || 0]))
    .forEach(([key, label, n, late]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inbx-chip';
      b.setAttribute('aria-pressed', String(adminInboxKind === key));
      b.innerHTML = esc(label) + (n ? ' · <span class="n' + (late ? ' is-late' : '') + '">' + esc(String(n)) + '</span>' : '');
      if (late) b.title = late + ' חרגו מזמן היעד';
      b.addEventListener('click', () => {
        if (adminInboxKind === key) return;
        adminInboxKind = key;
        loadAdminInbox();
      });
      host.appendChild(b);
    });
}

function renderAdminInboxRows(rows){
  const list = document.getElementById('adminInboxList');
  if (!list) return;
  if (!rows.length){
    list.innerHTML = '<div class="empty-state">' + (adminInboxKind
      ? 'אין כרגע פריטים מהסוג הזה.' : 'אין כרגע שום דבר שמחכה לך. 🎯') + '</div>';
    return;
  }
  list.innerHTML = '';
  rows.forEach(row => {
    const def = ADMIN_INBOX_KINDS[row.kind] || { label: row.kind, acc: null };
    const t = inboxRowText(row);
    const el = document.createElement('div');
    el.className = 'inbx-row';
    const slaH = Math.round((Number(row.sla_minutes) || 0) / 60);
    el.innerHTML =
      '<div class="inbx-main">'
      + '<div class="inbx-kind">' + esc(def.label) + '</div>'
      + '<div class="inbx-title">' + esc(t.title) + '</div>'
      + (t.sub ? '<div class="inbx-sub">' + esc(t.sub) + '</div>' : '')
      + '</div>'
      + '<span class="inbx-wait ' + inboxWaitClass(row) + '" title="' + esc('זמן היעד: ' + slaH + ' שעות') + '">'
      +   esc((row.overdue ? 'חרג · ' : '') + inboxWaitText(row.waiting_minutes)) + '</span>';
    if (def.acc){
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'inbx-open';
      open.textContent = 'פתיחה';
      open.setAttribute('aria-label', 'פתיחת ' + def.label + ': ' + t.title);
      open.addEventListener('click', () => gotoSection(def.acc));
      el.appendChild(open);
    }
    list.appendChild(el);
  });
}

/* "כללי זמן תגובה" - בשעות, לארבעת הסוגים שיש להם תור. admin_sla_set בודקת
   הרשאה וטווח (15 דקות עד 30 יום) בעצמה. */
function renderAdminSla(sla){
  const host = document.getElementById('adminSlaList');
  if (!host) return;
  host.innerHTML = '';
  Object.keys(ADMIN_INBOX_KINDS).forEach(kind => {
    if (sla[kind] == null) return;
    const row = document.createElement('div');
    row.className = 'inbx-sla-row';
    const id = 'adminSla-' + kind;
    row.innerHTML = '<label for="' + esc(id) + '">' + esc(ADMIN_INBOX_KINDS[kind].label) + ' (שעות)</label>'
      + '<input type="number" min="1" max="720" step="1" id="' + esc(id) + '" value="'
      + esc(String(Math.round(Number(sla[kind]) / 60 * 10) / 10)) + '">';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-ghost';
    save.textContent = 'שמירה';
    save.addEventListener('click', async () => {
      const hours = Number(row.querySelector('input').value);
      if (!(hours > 0)){ showToast('צריך מספר שעות חיובי'); return; }
      save.disabled = true;
      const { error } = await sb.rpc('admin_sla_set', { p_kind: kind, p_minutes: Math.round(hours * 60) });
      save.disabled = false;
      if (error){ showToast('שגיאה: ' + heErr(error)); return; }
      showToast('זמן היעד עודכן');
      loadAdminInbox();
    });
    row.appendChild(save);
    host.appendChild(row);
  });
}

/* פתיחת התיבה טוענת אותה מחדש: החלטה שהתקבלה במסך של תור אחר (החזר שסומן
   "בוצע", ערעור שאושר) מוציאה את הפריט מהתיבה, ובלי זה הוא היה נשאר בה עד
   הטעינה הבאה של הדף. */
(function wireAdminInbox(){
  const acc = document.getElementById('accAdminInbox');
  if (acc) acc.addEventListener('toggle', () => { if (acc.open) loadAdminInbox(); });
})();
