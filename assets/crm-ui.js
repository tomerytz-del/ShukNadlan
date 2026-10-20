/* ==========================================================================
   ערכת הרכיבים של אזורי העבודה, ההגדרות והניהול ב-CRM (ui-*)
   --------------------------------------------------------------------------
   שלב 1 בעיצוב מחדש (docs/handoff/crm-settings-redesign/HANDOFF.md, סעיף 6).
   המדריך, עם דוגמה לכל רכיב: docs/crm-ui-kit.md. העיצוב ב-crm.html, תחת
   "ערכת הרכיבים".

   מה יש כאן:
     uiChip / uiChipValues / uiSetChips  - צ'יפ בחירה (aria-pressed)
     uiSwitchHtml                        - מתג הפעלה
     uiFoldOpen / uiFoldSet              - חלק מקופל (aria-expanded + hidden)
     uiSaveBar                           - פס שמירה: "יש שינויים", ביטול, "נשמר"
     uiPager                             - רשימה במנות: "מוצגים X מתוך Y", "עוד X"
     uiAnyDirty                          - לשאלה ביציאה (crmUnsavedInput)

   **ההתנהגות מואצלת מ-document** ולא נקשרת לכל אלמנט: המסכים נבנים מחדש
   ב-innerHTML כל הזמן, ומאזין שנקשר לאלמנט נעלם איתו. צ'יפ, מתג, מקופל
   ולשוניות עובדים מעצמם מרגע שיש להם את הסימון - בלי קריאה לאתחול.

   צ'יפ ומתג ששינו מצב שולחים אירוע input שמבעבע, כמו שדה רגיל. כך פס
   השמירה (ושאר הקוד) מקשיב לאירוע אחד לכל סוגי השדות.

   בריחה: escapeHtml הגלובלית מ-assets/esc.js, שנטען בראש הדף.

   הקובץ נטען לפני assets/crm.js ומגדיר פונקציות ומאזינים בלבד.
   ========================================================================== */

const UI_ICON_CHECK = '<svg class="ui-ico-on" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const UI_ICON_PLUS = '<svg class="ui-ico-off" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
const UI_ICON_CHEV = '<svg class="ui-chev" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

/* ---------- צ'יפ ----------
   ‏opts: on, value, count (מונה בתוך הצ'יפ), tone ('warn' / 'hot' למונה),
   icon (false - בלי וי/פלוס, למשל בצ'יפ מסנן), disabled.
   צ'יפים בתוך ‎.ui-chips[data-ui-single]‎ הם בחירה אחת (כמו רדיו). */
function uiChip(label, opts = {}){
  const on = !!opts.on;
  const icon = opts.icon === false ? '' : UI_ICON_CHECK + UI_ICON_PLUS;
  const n = opts.count == null ? ''
    : `<span class="ui-chip-n${opts.tone ? ' is-' + escapeHtml(opts.tone) : ''}">${escapeHtml(opts.count)}</span>`;
  return `<button type="button" class="ui-chip" data-ui-chip aria-pressed="${on}"`
    + (opts.value != null ? ` data-value="${escapeHtml(opts.value)}"` : '')
    + (opts.disabled ? ' disabled' : '')
    + `>${icon}<span>${escapeHtml(label)}</span>${n}</button>`;
}

function uiChipValues(container){
  if (!container) return [];
  return Array.from(container.querySelectorAll('[data-ui-chip][aria-pressed="true"]')).map(b => b.dataset.value);
}

function uiSetChips(container, values){
  if (!container) return;
  const set = new Set((values || []).map(String));
  container.querySelectorAll('[data-ui-chip]').forEach(b => b.setAttribute('aria-pressed', String(set.has(b.dataset.value))));
}

/* ---------- מתג ----------
   ‏label חובה: למתג אין טקסט גלוי משלו, ו-aria-label הוא מה שקורא המסך אומר. */
function uiSwitchHtml(label, on, attrs = ''){
  return `<button type="button" class="ui-switch" data-ui-switch aria-pressed="${!!on}" aria-label="${escapeHtml(label)}" ${attrs}></button>`;
}

/* ---------- מקופל ----------
   הסימון:
     <section class="ui-fold" id="x">
       <div class="ui-fold-head"> ...
         <button class="ui-icon-btn" data-ui-fold aria-expanded="false" aria-controls="xBody" aria-label="...">UI_ICON_CHEV</button>
       </div>
       <div class="ui-fold-body" id="xBody" hidden> ... </div>
     </section>
   ‏data-ui-fold-group="name" על כמה מקופלים: רק אחד פתוח בכל פעם (קבוצות
   ההתראות, אזורי הארץ). אירוע ui-fold (detail.open) נשלח מה-section. */
function uiFoldSet(btn, open){
  if (!btn) return;
  const body = document.getElementById(btn.getAttribute('aria-controls'));
  const fold = btn.closest('.ui-fold');
  btn.setAttribute('aria-expanded', String(open));
  if (body) body.hidden = !open;
  if (fold){
    fold.classList.toggle('is-open', open);
    fold.dispatchEvent(new CustomEvent('ui-fold', { bubbles:true, detail:{ open } }));
  }
}

function uiFoldOpen(foldOrId, open = true){
  const fold = typeof foldOrId === 'string' ? document.getElementById(foldOrId) : foldOrId;
  uiFoldSet(fold && fold.querySelector('[data-ui-fold]'), open);
}

/* ---------- פס שמירה ----------
   ‏uiSaveBar(root, { read, apply, save, labels })
     root   - האזור שהשדות שלו נשמרים, ובתוכו ‎.ui-savebar‎ עם
              ‎.ui-savebar-text‎, ‏[data-ui-save] ו-[data-ui-reset]
     read   - מחזירה את המצב הנוכחי כאובייקט שאפשר להפוך ל-JSON
     apply  - מחילה מצב (לביטול שינויים)
     save   - async; מקבלת את המצב. זריקה = נכשל, והפס נשאר "יש שינויים"
   מחזיר { refresh, reset, setBaseline, isDirty }. ‏setBaseline() אחרי
   טעינה מהמסד, כדי שהמצב שנטען ייחשב "שמור". */
const UI_SAVEBARS = new Set();

function uiSaveBar(root, { read, apply, save, labels = {} }){
  const bar = root.querySelector('.ui-savebar');
  const text = bar && bar.querySelector('.ui-savebar-text');
  const saveBtn = bar && bar.querySelector('[data-ui-save]');
  const resetBtn = bar && bar.querySelector('[data-ui-reset]');
  const L = Object.assign({ dirty:'יש שינויים שלא נשמרו', clean:'כל השינויים שמורים', saved:'נשמר', saving:'שומר...' }, labels);
  let baseline = JSON.stringify(read());
  let saved = false, busy = false;

  const isDirty = () => JSON.stringify(read()) !== baseline;
  function paint(){
    if (!bar) return;
    const dirty = isDirty();
    if (dirty) saved = false;
    bar.classList.toggle('is-dirty', dirty);
    bar.classList.toggle('is-saved', !dirty && saved);
    if (text) text.textContent = busy ? L.saving : dirty ? L.dirty : saved ? L.saved : L.clean;
    if (saveBtn) saveBtn.disabled = busy || !dirty;
  }
  const api = {
    isDirty,
    refresh: paint,
    setBaseline(){ baseline = JSON.stringify(read()); saved = false; paint(); },
    reset(){ apply(JSON.parse(baseline)); saved = false; paint(); },
    root,
  };
  root.addEventListener('input', paint);
  root.addEventListener('change', paint);
  if (resetBtn) resetBtn.addEventListener('click', () => api.reset());
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    if (busy || !isDirty()) return;
    busy = true; paint();
    const state = read();
    try {
      await save(state);
      baseline = JSON.stringify(state);
      saved = true;
    } catch (e){
      if (typeof showToast === 'function') showToast(typeof heErr === 'function' ? heErr(e) : 'השמירה נכשלה');
    } finally {
      busy = false; paint();
    }
  });
  UI_SAVEBARS.add(api);
  paint();
  return api;
}

/* לשאלה ביציאה: פס שמירה שהאזור שלו עדיין בדף ויש בו שינוי */
function uiAnyDirty(){
  for (const api of UI_SAVEBARS){
    if (!api.root.isConnected){ UI_SAVEBARS.delete(api); continue; }
    if (api.isDirty()) return true;
  }
  return false;
}

/* ---------- רשימה במנות ----------
   ‏uiPager({ mount, items, render, step, noun, countEl, resetLabel })
     mount     - האלמנט שהרשימה נכתבת לתוכו
     render    - (item, index) => HTML. אחראית לבריחה בעצמה
     step      - גודל מנה (3 לידים, 10 נכסים, 5 עסקאות)
     noun      - "נכסים", "לידים" - לכפתור "עוד 10 נכסים"
     countEl   - אופציונלי: מקבל "מוצגים X מתוך Y"
     resetLabel- אופציונלי: כפתור חזרה למנה הראשונה ("הצגת 3 בלבד")
     empty     - HTML כשאין פריטים
   מחזיר { setItems, shown }. */
function uiPager({ mount, items = [], render, step = 10, noun = '', countEl = null, resetLabel = '', empty = '' }){
  let list = items, shown = 0;
  function draw(){
    const total = list.length;
    shown = Math.min(Math.max(shown, Math.min(step, total)), total);
    if (!total){
      mount.innerHTML = empty;
      if (countEl) countEl.textContent = '';
      return;
    }
    const left = total - shown;
    const next = Math.min(step, left);
    const more = left > 0
      ? `<button type="button" class="ui-more" data-ui-more>עוד ${next}${noun ? ' ' + escapeHtml(noun) : ''}${left > next ? ` (נשארו ${left})` : ''}</button>`
      : '';
    const back = resetLabel && shown > step
      ? `<button type="button" class="ui-link" data-ui-less>${escapeHtml(resetLabel)}</button>` : '';
    mount.innerHTML = list.slice(0, shown).map(render).join('')
      + (more || back ? `<div class="ui-more-row">${more}${back}</div>` : '');
    if (countEl) countEl.textContent = `מוצגים ${shown} מתוך ${total}`;
  }
  // מסך שבונה pager מחדש על אותו mount לא צובר מאזינים
  if (mount._uiPagerClick) mount.removeEventListener('click', mount._uiPagerClick);
  mount._uiPagerClick = e => {
    if (e.target.closest('[data-ui-more]')){ shown += step; draw(); }
    else if (e.target.closest('[data-ui-less]')){ shown = step; draw(); }
  };
  mount.addEventListener('click', mount._uiPagerClick);
  const api = {
    setItems(next){ list = next || []; shown = 0; draw(); },
    get shown(){ return shown; },
  };
  draw();
  return api;
}

/* ---------- מאזינים מואצלים ---------- */
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-ui-chip]');
  if (chip && !chip.disabled){
    const group = chip.closest('.ui-chips');
    const on = chip.getAttribute('aria-pressed') !== 'true';
    if (group && group.hasAttribute('data-ui-single')){
      if (!on) return;                       // בבחירה אחת אין "אף אחד"
      group.querySelectorAll('[data-ui-chip]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
    } else {
      chip.setAttribute('aria-pressed', String(on));
    }
    chip.dispatchEvent(new Event('input', { bubbles:true }));
    return;
  }
  const sw = e.target.closest('[data-ui-switch]');
  if (sw && !sw.disabled){
    sw.setAttribute('aria-pressed', String(sw.getAttribute('aria-pressed') !== 'true'));
    sw.dispatchEvent(new Event('input', { bubbles:true }));
    return;
  }
  const fold = e.target.closest('[data-ui-fold]');
  if (fold){
    const open = fold.getAttribute('aria-expanded') !== 'true';
    const section = fold.closest('.ui-fold');
    const groupName = section && section.dataset.uiFoldGroup;
    if (open && groupName){
      document.querySelectorAll(`.ui-fold[data-ui-fold-group="${CSS.escape(groupName)}"]`).forEach(f => {
        if (f !== section) uiFoldSet(f.querySelector('[data-ui-fold]'), false);
      });
    }
    uiFoldSet(fold, open);
  }
});

/* לשוניות: חצים, Home ו-End עוברים בין הלשוניות (ARIA tabs). הבחירה עצמה
   - aria-selected והתוכן - בידי המסך, דרך ה-click שהמעבר מפעיל. */
document.addEventListener('keydown', e => {
  const tab = e.target.closest && e.target.closest('.ui-tabs [role="tab"]');
  if (!tab) return;
  const tabs = Array.from(tab.closest('.ui-tabs').querySelectorAll('[role="tab"]:not([disabled])'));
  const i = tabs.indexOf(tab);
  const rtl = getComputedStyle(tab).direction === 'rtl';
  let j = -1;
  if (e.key === 'ArrowLeft') j = rtl ? i + 1 : i - 1;
  else if (e.key === 'ArrowRight') j = rtl ? i - 1 : i + 1;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = tabs.length - 1;
  else return;
  e.preventDefault();
  const to = tabs[(j + tabs.length) % tabs.length];
  to.focus();
  to.click();
});
