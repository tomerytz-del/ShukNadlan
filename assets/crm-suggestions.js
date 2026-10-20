/* ==========================================================================
   הצעות לשיפור - הכפתור עם הזבוב, והרשימה של מנהלי הפלטפורמה
   --------------------------------------------------------------------------
   בקשה של תומר (20.10.2026; docs/improvement-suggestions.md). הכפתור יושב
   ליד "עזרה" בתחתית סרגל הצד, ובנייד בתפריט הפרופיל תחת "עזרה". הוא פותח
   חלון קטן (#sugDialog): מה כדאי לשפר, והמסך שממנו נשלח - נקבע לבד.

   ההצעה נכתבת ל-improvement_suggestions (מיגרציה 20270705090000). המשרד
   והתקרה (10 בשעה) נקבעים בטריגר במסד, וההתראה למנהלי הפלטפורמה נכתבת
   בטריגר אחר - כך שאין כאן שום לוגיקה שהדפדפן יכול לעקוף.

   הקובץ נטען לפני assets/crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

/* המסך הנוכחי בשם שהסוכן/ת מכיר/ה - מהתפריט עצמו, ולא מזהה פנימי */
function sugScreenLabel(){
  if (typeof navActive === 'undefined' || !navActive) return '';
  if (navActive === NAV_HOME) return 'דף הבית';
  for (const g of NAV_GROUPS){
    const it = g.items.find(i => i.acc === navActive || (i.also || []).includes(navActive));
    if (it) return it.label;
  }
  return '';
}

function openSuggestDialog(){
  const dlg = document.getElementById('sugDialog');
  if (!dlg) return;
  const screen = sugScreenLabel();
  dlg.dataset.screen = screen;
  document.getElementById('sugScreen').textContent = screen ? 'נשלח מהמסך: ' + screen : '';
  document.getElementById('sugForm').hidden = false;
  document.getElementById('sugDone').hidden = true;
  document.getElementById('sugErr').textContent = '';
  sugCount();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  document.getElementById('sugBody').focus();
}

function closeSuggestDialog(){
  const dlg = document.getElementById('sugDialog');
  if (dlg.open && typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

function sugCount(){
  const body = document.getElementById('sugBody');
  document.getElementById('sugCount').textContent = `${body.value.length}/2000`;
  document.getElementById('sugSend').disabled = body.value.trim().length < 3;
}

async function sendSuggestion(e){
  e.preventDefault();
  const body = document.getElementById('sugBody').value.trim();
  if (body.length < 3 || !currentAgent) return;
  const btn = document.getElementById('sugSend');
  const err = document.getElementById('sugErr');
  btn.disabled = true; btn.textContent = 'שולח...'; err.textContent = '';
  const { error } = await sb.from('improvement_suggestions').insert({
    agent_id: currentAgent.id,
    body,
    screen: document.getElementById('sugDialog').dataset.screen || null,
  });
  btn.textContent = 'שליחה';
  if (error){
    btn.disabled = false;
    err.textContent = /too_many_suggestions/.test(error.message || '')
      ? 'נשלחו הרבה הצעות בשעה האחרונה. אפשר לשלוח שוב בעוד קצת.'
      : heErr(error);
    return;
  }
  document.getElementById('sugBody').value = '';
  document.getElementById('sugForm').hidden = true;
  document.getElementById('sugDone').hidden = false;
  document.getElementById('sugDoneBtn').focus();
}

(function wireSuggestDialog(){
  const dlg = document.getElementById('sugDialog');
  if (!dlg) return;
  document.getElementById('sugForm').addEventListener('submit', sendSuggestion);
  document.getElementById('sugBody').addEventListener('input', sugCount);
  document.getElementById('sugCancel').addEventListener('click', closeSuggestDialog);
  document.getElementById('sugDoneBtn').addEventListener('click', closeSuggestDialog);
  // לחיצה על הרקע סוגרת, כמו בשאר החלונות - אבל לא כשיש טקסט שהוקלד
  dlg.addEventListener('click', e => {
    if (e.target === dlg && !document.getElementById('sugBody').value.trim()) closeSuggestDialog();
  });
})();

/* ==========================================================================
   "הצעות לשיפור" - למנהלי הפלטפורמה (accSuggestions)
   ========================================================================== */
let sugRows = [];
let sugView = 'new';
let sugPager = null;

async function loadSuggestionsAdmin(){
  const list = document.getElementById('sugAdminList');
  if (!list) return;
  const { data, error } = await sb.from('improvement_suggestions')
    .select('id, body, screen, status, created_at, handled_at, agency_members(display_name), agencies(name)')
    .order('created_at', { ascending:false })
    .limit(300);
  if (error){
    // 42P01 - המיגרציה עוד לא רצה. אין כאן מה להציג, ושום דבר לא נשבר
    list.innerHTML = '<div class="empty-state">' + (error.code === '42P01'
      ? 'הטבלה עוד לא קיימת - המיגרציה 20270705090000 טרם רצה.'
      : escapeHtml(heErr(error))) + '</div>';
    return;
  }
  sugRows = data || [];
  renderSuggestionsAdmin();
}

function renderSuggestionsAdmin(){
  const list = document.getElementById('sugAdminList');
  if (!list) return;
  const fresh = sugRows.filter(r => r.status === 'new');
  accSetCount('accSuggestions', fresh.length || '');
  document.getElementById('sugTabs').innerHTML =
    uiChip('חדשות', { value:'new', on: sugView === 'new', count: fresh.length, tone: fresh.length ? 'hot' : '', icon:false })
    + uiChip('טופלו', { value:'done', on: sugView === 'done', count: sugRows.length - fresh.length, icon:false });
  const rows = sugRows.filter(r => r.status === sugView);
  const opts = {
    mount: list, step: 10, noun: 'הצעות', countEl: document.getElementById('sugCountLine'),
    empty: `<div class="empty-state">${sugView === 'new' ? 'אין הצעות חדשות.' : 'עוד לא סומנו הצעות כמטופלות.'}</div>`,
    render: r => {
      const who = (r.agency_members && r.agency_members.display_name) || 'סוכן/ת';
      const office = r.agencies && r.agencies.name;
      const when = new Date(r.created_at).toLocaleString('he-IL', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<article class="sug-item" data-id="${escapeHtml(r.id)}">`
        + `<div class="sug-item-head"><strong>${escapeHtml(who)}</strong>`
        + (office ? `<span class="ui-muted">${escapeHtml(office)}</span>` : '')
        + (r.screen ? `<span class="ui-tag ui-tag--accent">${escapeHtml(r.screen)}</span>` : '')
        + `<span class="ui-muted sug-when">${escapeHtml(when)}</span></div>`
        + `<p class="sug-body">${escapeHtml(r.body)}</p>`
        + `<div class="sug-acts"><button type="button" class="ui-btn ui-btn--secondary ui-btn--sm" data-sug-toggle>`
        + (r.status === 'new' ? 'סימון כטופל' : 'החזרה לחדשות') + `</button></div>`
        + `</article>`;
    },
  };
  // ‏uiPager על אותו mount מחליף את המאזין הקודם, ולכן בנייה מחדש בטוחה
  sugPager = uiPager(opts);
  sugPager.setItems(rows);
}

async function toggleSuggestion(id){
  const row = sugRows.find(r => r.id === id);
  if (!row) return;
  const next = row.status === 'new' ? 'done' : 'new';
  // ‏RLS שחוסם מחזיר 0 שורות ולא שגיאה - בודקים שחזרה שורה
  const { data, error } = await sb.from('improvement_suggestions')
    .update({ status: next, handled_at: next === 'done' ? new Date().toISOString() : null })
    .eq('id', id).select('id');
  if (error || !(data || []).length){ showToast(error ? heErr(error) : 'העדכון לא נשמר - נסו לרענן את הדף'); return; }
  row.status = next;
  renderSuggestionsAdmin();
}

(function wireSuggestionsAdmin(){
  const box = document.getElementById('accSuggestions');
  if (!box) return;
  box.addEventListener('input', e => {
    if (!e.target.closest('#sugTabs')) return;
    sugView = uiChipValues(document.getElementById('sugTabs'))[0] || 'new';
    renderSuggestionsAdmin();
  });
  box.addEventListener('click', e => {
    const t = e.target.closest('[data-sug-toggle]');
    if (t) toggleSuggestion(t.closest('[data-id]').dataset.id);
  });
})();
