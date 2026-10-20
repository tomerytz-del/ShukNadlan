/* ==========================================================================
   "ההגדרות שלי" ו"התראות והודעות"
   --------------------------------------------------------------------------
   שלב 2 בעיצוב מחדש (docs/handoff/crm-settings-redesign/HANDOFF.md, סעיפים
   3.1 ו-3.6; docs/crm-settings.md). שני המסכים בנויים מערכת הרכיבים
   (assets/crm-ui.js) ואין בהם שום מסד חדש - אותן שלוש טבלאות:

     agent_lead_preferences        - העדפות לידים מבעלי נכסים
     agent_notification_preferences - הפעמון והוואטסאפ לכל סוג התראה
     agent_reminder_preferences    - שעות השקט, הימים השקטים וסיכום התזכורות

   ‏**שעות השקט נערכות בשני מקומות** - בחלק המקופל של "ההגדרות שלי" ובראש
   "התראות והודעות" - ולכן הן עורך אחד (quietEditorHtml) עם שני מופעים. כל
   שמירה מעדכנת את reminderPrefs ומציירת מחדש את המופע השני, אם אין בו שינוי
   שלא נשמר.

   ‏**מה כבר לא כאן:** תיבות הסימון של שני הטפסים הישנים (‏prefsForm,
   ‏notifPrefsForm). הטעינה נשארה ב-crm.js (loadNotifPrefs, loadReminders),
   והיא קוראת ל-renderNotifPrefs ול-renderReminderPrefs שמוגדרות כאן.

   הקובץ נטען לפני assets/crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

const SET_ICONS = {
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
};
function setIcon(name, size = 20){
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SET_ICONS[name] || ''}</svg>`;
}

function setHour(h){ return String(h).padStart(2, '0') + ':00'; }

/* ==========================================================================
   הפרופיל: שבע הבדיקות של "הפרופיל מלא ב-X%" (סעיף 3.4)
   ========================================================================== */
function profileChecks(agent){
  const a = agent || {};
  const markets = Array.isArray(a.service_markets) ? a.service_markets.length > 0 : !!(a.service_area || '').trim();
  return [
    { key:'photo',       label:'תמונת פרופיל', done: !!a.photo_url },
    { key:'license',     label:'רישיון תיווך',  done: !!String(a.license_number || '').trim() },
    { key:'bio',         label:'תיאור מקצועי',  done: !!String(a.bio || '').trim() },
    { key:'markets',     label:'אזור פעילות',   done: markets },
    { key:'specialties', label:'תחומי התמחות',  done: Array.isArray(a.specialties) && a.specialties.length > 0 },
    { key:'gallery',     label:'תמונות בגלריה', done: Array.isArray(a.gallery) && a.gallery.some(g => g && g.url) },
    { key:'gender',      label:'לשון פנייה',    done: !!a.gender },
  ];
}

function renderSettingsProfile(){
  const el = document.getElementById('setProfileCard');
  if (!el || !currentAgent) return;
  const checks = profileChecks(currentAgent);
  const missing = checks.filter(c => !c.done).map(c => c.label);
  const pct = Math.round((checks.length - missing.length) / checks.length * 100);
  const name = currentAgent.display_name || '';
  const img = currentAgent.photo_url
    ? `<img class="set-profile-img" src="${escapeHtml(currentAgent.photo_url)}" alt="" style="object-position:${escapeHtml(photoPositionCss(parsePhotoPosition(currentAgent.photo_position)))}">`
    : `<span class="set-profile-img is-empty" aria-hidden="true">${escapeHtml(name.trim().charAt(0))}</span>`;
  el.innerHTML = img
    + `<span class="set-profile-main">`
    +   `<span class="set-profile-top"><span class="set-profile-name">הפרופיל שלי</span><span class="ui-muted">מה שלקוחות רואים בדף שלך</span></span>`
    +   `<span class="set-bar" role="progressbar" aria-label="מילוי הפרופיל" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>`
    +   `<span class="set-profile-state${missing.length ? ' is-warn' : ''}">`
    +     (missing.length ? `מלא ב-${pct}% · חסר: ${escapeHtml(missing.join(', '))}` : 'הפרופיל מלא')
    +   `</span>`
    + `</span>`
    + `<span class="ui-btn" aria-hidden="true">${missing.length ? 'להשלמת הפרופיל' : 'לפרופיל'}</span>`;
}

/* ==========================================================================
   אריחי המצב: מספרים, יומן Google, ארנק. כל אחד קישור לקטגוריה שלו, ומוצג
   רק כשהקטגוריה גלויה לסוכן/ת הזה/זו (navAccVisible)
   ========================================================================== */
function renderSettingsTiles(){
  const el = document.getElementById('setTiles');
  if (!el || !currentAgent) return;
  const tiles = [];

  if (navAccVisible('accLines')){
    const lines = (typeof lineRows !== 'undefined' ? lineRows : []).filter(l => l.active);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const calls = (typeof callRows !== 'undefined' ? callRows : []).filter(c => new Date(c.created_at) >= monthStart).length;
    tiles.push({ acc:'accLines', icon:'phone', tone:'accent', label:'מספרים וירטואליים',
      value: lines.length
        ? `${plural(lines.length, 'מספר אחד', 'מספרים')} · ${plural(calls, 'שיחה אחת', 'שיחות')} החודש`
        : 'עוד אין מספר' });
  }

  if (navAccVisible('accGcal')){
    const c = typeof agendaGcal !== 'undefined' ? agendaGcal : null;
    const on = c && c.status === 'active';
    const synced = on && c.last_sync_at ? ' · סונכרן ' + new Date(c.last_sync_at).toLocaleString('he-IL', { day:'numeric', month:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    tiles.push({ acc:'accGcal', icon:'calendar', tone: on ? 'ok' : c && c.status === 'error' ? 'warn' : 'accent', label:'יומן Google',
      value: on ? 'מחובר' + synced : c && c.status === 'error' ? 'החיבור נותק' : 'לא מחובר' });
  }

  if (navAccVisible('accWallet')){
    const balance = Number(currentAgent.credit_balance) || 0;
    // צהוב כשהיתרה לא מכסה חודש של מספר וירטואלי - השירות שיורד מהארנק כל חודש
    const low = balance < priceOf('phone_line_monthly_price', 89);
    tiles.push({ acc:'accWallet', icon:'wallet', tone: low ? 'warn' : 'accent', label:'הארנק שלי',
      value: shekelShort(balance) + (low ? ' · כדאי לטעון' : '') });
  }

  el.innerHTML = tiles.map(t =>
    `<button type="button" class="set-tile" data-goto="${t.acc}">`
    + `<span class="set-tile-ico is-${t.tone}">${setIcon(t.icon)}</span>`
    + `<span class="set-tile-text"><span class="set-tile-label">${escapeHtml(t.label)}</span>`
    + `<span class="set-tile-value${t.tone === 'accent' ? '' : ' is-' + t.tone}">${escapeHtml(t.value)}</span></span>`
    + `</button>`).join('');
  el.hidden = !tiles.length;
}

/* ניהול המשרד - שורות קישור עם מצב. "חסר תיאור" נלקח מטופס המיתוג, שכבר
   נטען למנהל/ת (brandingState) */
function renderSettingsManage(){
  const box = document.getElementById('setManage');
  const rowsEl = document.getElementById('setManageRows');
  if (!box || !rowsEl) return;
  const isManager = !!(currentAgent && currentAgent.role === 'manager');
  const desc = document.getElementById('brDescription');
  const noAbout = typeof brandingState !== 'undefined' && brandingState && desc && !desc.value.trim();
  const rows = [
    { acc:'accBranding', title:'דף המשרד', sub: noAbout ? 'חסר תיאור "על המשרד"' : 'לוגו, תיאור, צבעים וגלריה', warn: noAbout },
    { acc:'accTeam', title:'צוותים וסוכנים', sub:'הסוכנים במשרד, צוותים ותפקידים' },
    { acc:'accOfficeCalls', title:'שיחות המשרד', sub:'השיחות במספרים של כל הסוכנים' },
    { acc:'accSharePartners', title:'משרדי שיתוף פעולה', sub:'עם אילו משרדים הנכסים שלכם משותפים' },
  ].filter(r => navAccVisible(r.acc));
  box.hidden = !isManager || !rows.length;
  rowsEl.innerHTML = rows.map(r =>
    `<button type="button" class="ui-row-link" data-goto="${r.acc}">`
    + `<span><span class="ui-row-title">${escapeHtml(r.title)}</span><span class="ui-row-sub${r.warn ? ' is-warn' : ''}">${escapeHtml(r.sub)}</span></span>`
    + `<span class="ui-muted">${setIcon('back', 18)}</span></button>`).join('');
}

/* כל "ההגדרות שלי" - בפתיחת הקטגוריה, כי הנתונים של האריחים (שיחות, יומן,
   ארנק) נטענים במקומות אחרים ובזמנים אחרים, ומה שמוצג צריך להיות העדכני */
function renderSettingsHub(){
  ensureSettingsMounted();
  renderSettingsProfile();
  renderSettingsTiles();
  renderSettingsManage();
  syncQuietSummaries();
  syncNotifScreen();
}
document.getElementById('accPrefs').addEventListener('toggle', e => {
  if (e.target.open) renderSettingsHub();
});

/* ==========================================================================
   העדפות לידים מבעלי נכסים (agent_lead_preferences)
   ========================================================================== */
const LEAD_PREF_TYPES = [['דירה', 'דירה'], ['בית פרטי', 'בית פרטי'], ['דירת גן', 'דירת גן'], ['מגרש', 'מגרש']];
const LEAD_PREF_DEALS = [['sale', 'מכירה'], ['rent', 'השכרה']];
/* שלוש הקבוצות לפי שני הדגלים שכבר במסד (neighborhoods.is_industrial,
   ‏is_planned). שכונה שהיא גם וגם - בתעשייה, כי זה מה שמבדיל אותה ללקוח/ה */
const LEAD_HOOD_GROUPS = [
  { key:'res',  title:'שכונות מגורים' },
  { key:'ind',  title:'אזורי תעשייה ומסחר' },
  { key:'plan', title:'שכונות בתכנון' },
];
function leadHoodGroup(n){ return n.is_industrial ? 'ind' : n.is_planned ? 'plan' : 'res'; }

let leadPrefsRow = null;        // השורה במסד, או null כשעוד לא הוגדרו העדפות
let leadPrefsBar = null;
let leadPrefsAutoOpened = false;

async function loadPreferences(agentId){
  await loadAllNeighborhoods();
  const { data, error } = await sb
    .from('agent_lead_preferences')
    .select('preferred_neighborhoods, preferred_property_types, preferred_deal_types, active')
    .eq('agent_id', agentId)
    .maybeSingle();
  leadPrefsRow = error ? null : (data || null);
  renderLeadPrefs();
}

function leadPrefsState(){
  return {
    hoods: uiChipValues(document.getElementById('setHoodGroups')).sort(),
    types: uiChipValues(document.getElementById('setTypes')).sort(),
    deals: uiChipValues(document.getElementById('setDeals')).sort(),
  };
}

function renderLeadPrefs(){
  ensureSettingsMounted();
  const groupsEl = document.getElementById('setHoodGroups');
  if (!groupsEl) return;
  const row = leadPrefsRow;
  const sel = new Set(row ? row.preferred_neighborhoods || [] : []);

  /* השכונות בשוק של הסוכן/ת, ושכונה שכבר נבחרה ואינה בשוק (בחירה ישנה)
     נשארת - כדי ששמירה לא תמחק אותה בשקט. בשוק של כמה ערים השם נושא את
     העיר, כי "מרכז העיר" קיים בכמה מהן. */
  const list = marketNeighborhoods();
  const extra = allNeighborhoods.filter(n => sel.has(n.id) && !list.includes(n));
  const all = [...list, ...extra];
  const multiCity = new Set(all.map(n => n.city || '')).size > 1;
  groupsEl.innerHTML = LEAD_HOOD_GROUPS.map(g => {
    const items = all.filter(n => leadHoodGroup(n) === g.key);
    if (!items.length) return '';
    return `<div class="set-hood-group" data-hood-group="${g.key}">`
      + `<div class="set-group-head"><span class="set-group-title" id="setHoodG-${g.key}">${escapeHtml(g.title)}</span>`
      + `<span class="set-group-n" data-hood-n></span><span class="set-group-line" aria-hidden="true"></span>`
      + `<button type="button" class="ui-link" data-hood-all></button></div>`
      + `<div class="ui-chips" role="group" aria-labelledby="setHoodG-${g.key}">`
      + items.map(n => uiChip(multiCity && n.city ? `${n.name} · ${n.city}` : n.name, { value:n.id, on: sel.has(n.id) })).join('')
      + `</div></div>`;
  }).join('') || '<p class="ui-hint"><span>עוד אין שכונות באזור שלך. כתבו לנו דרך "עזרה" ונוסיף.</span></p>';

  const types = new Set(row ? row.preferred_property_types || [] : []);
  document.getElementById('setTypes').innerHTML = LEAD_PREF_TYPES.map(([v, l]) => uiChip(l, { value:v, on: types.has(v) })).join('');
  const deals = new Set(row ? row.preferred_deal_types || [] : []);
  document.getElementById('setDeals').innerHTML = LEAD_PREF_DEALS.map(([v, l]) => uiChip(l, { value:v, on: deals.has(v) })).join('');

  // בלי שורה הלידים לא מגיעים בכלל, ולכן המתג מוצג דלוק - זה מה שיישמר
  document.getElementById('setOwnerSwitch').setAttribute('aria-pressed', String(row ? row.active : true));
  const hours = priceOf('owner_lead_exclusivity_hours', 12);
  document.getElementById('setLeadInfoText').innerHTML =
    `כשבעלי נכס שמוכרים או משכירים משאירים פרטים באזור ובסוג שסימנת, מגיעה התראה ויש לך <strong>${escapeHtml(hours)} שעות בלעדיות</strong> ליצור איתם קשר. `
    + 'לידים מאזורים וסוגים שלא סומנו לא יגיעו אליך.';

  if (!leadPrefsBar){
    leadPrefsBar = uiSaveBar(document.getElementById('setLeadPrefsBody'), {
      read: leadPrefsState,
      apply: s => {
        uiSetChips(document.getElementById('setHoodGroups'), s.hoods);
        uiSetChips(document.getElementById('setTypes'), s.types);
        uiSetChips(document.getElementById('setDeals'), s.deals);
        syncLeadPrefsUi();
      },
      save: saveLeadPrefs,
      labels: { clean:'כל ההעדפות שמורות' },
    });
  }
  leadPrefsBar.setBaseline();
  syncLeadPrefsUi();

  // מי שעוד לא הגדיר/ה העדפות - החלק נפתח מעצמו, פעם אחת
  if (!row && !leadPrefsAutoOpened){
    leadPrefsAutoOpened = true;
    uiFoldOpen('setLeadPrefs');
  }
}

/* המונים, "בחירת הכל / ניקוי", שורת הסיכום, התגית והבאנר - מהמצב שעל המסך */
function syncLeadPrefsUi(){
  const groupsEl = document.getElementById('setHoodGroups');
  if (!groupsEl) return;
  groupsEl.querySelectorAll('[data-hood-group]').forEach(g => {
    const chips = g.querySelectorAll('[data-ui-chip]');
    const on = g.querySelectorAll('[data-ui-chip][aria-pressed="true"]').length;
    g.querySelector('[data-hood-n]').textContent = `${on}/${chips.length}`;
    g.querySelector('[data-hood-all]').textContent = on === chips.length ? 'ניקוי' : 'בחירת הכל';
  });
  const s = leadPrefsState();
  const hoodTotal = groupsEl.querySelectorAll('[data-ui-chip]').length;
  document.getElementById('setHoodCount').innerHTML = `נבחרו <strong>${s.hoods.length}</strong> מתוך ${hoodTotal}`;
  document.getElementById('setTypesCount').textContent = `${s.types.length} מתוך ${LEAD_PREF_TYPES.length}`;
  document.getElementById('setDealsCount').textContent = `${s.deals.length} מתוך ${LEAD_PREF_DEALS.length}`;
  document.getElementById('setLeadSummary').textContent = leadPrefsSummary(s);

  const active = document.getElementById('setOwnerSwitch').getAttribute('aria-pressed') === 'true';
  const tag = document.getElementById('setOwnerTag');
  const unset = !leadPrefsRow;
  tag.className = 'ui-tag ' + (unset ? 'ui-tag--warn' : active ? 'ui-tag--ok' : '');
  tag.textContent = unset ? 'לא הוגדר' : active ? 'פעיל' : 'כבוי';
  document.getElementById('setLeadPaused').hidden = active;
  document.getElementById('setLeadInfo').hidden = !active;
  accSetCount('accPrefs', unset ? 'להגדרה' : '');
  syncLeadPrefsLink();
}

function leadPrefsSummary(s){
  const deal = s.deals.length === 2 ? 'מכירה והשכרה'
    : s.deals.length === 1 ? (s.deals[0] === 'sale' ? 'מכירה בלבד' : 'השכרה בלבד') : 'בלי סוג עסקה';
  return `${plural(s.hoods.length, 'שכונה אחת', 'שכונות')} · ${plural(s.types.length, 'סוג נכס אחד', 'סוגי נכס')} · ${deal}`;
}

async function saveLeadPrefs(s){
  if (!currentAgent) throw new Error('not_ready');
  const active = document.getElementById('setOwnerSwitch').getAttribute('aria-pressed') === 'true';
  const { error } = await sb.from('agent_lead_preferences').upsert({
    agent_id: currentAgent.id,
    preferred_neighborhoods: s.hoods,
    preferred_property_types: s.types,
    preferred_deal_types: s.deals,
    active,
    updated_at: new Date().toISOString(),
  }, { onConflict:'agent_id' });
  if (error) throw error;
  leadPrefsRow = { preferred_neighborhoods: s.hoods, preferred_property_types: s.types, preferred_deal_types: s.deals, active };
  syncLeadPrefsUi();
  // צעד "העדפות לידים" במדריך ההתחלה נסגר בשמירה הזו
  refreshOnboarding();
}

/* המתג בכותרת נשמר מיד ועובד גם כשהחלק סגור. מי שעוד אין לו/ה שורה -
   המתג רק משנה את מה שיישמר בפס השמירה, כי שורה בלי אזורים אינה העדפה */
async function setOwnerLeadsActive(sw){
  syncLeadPrefsUi();
  if (!leadPrefsRow || !currentAgent) return;
  const on = sw.getAttribute('aria-pressed') === 'true';
  sw.disabled = true;
  const { error } = await sb.from('agent_lead_preferences')
    .update({ active: on, updated_at: new Date().toISOString() })
    .eq('agent_id', currentAgent.id)
    .select('agent_id');
  sw.disabled = false;
  if (error){
    sw.setAttribute('aria-pressed', String(!on));
    syncLeadPrefsUi();
    showToast(heErr(error));
    return;
  }
  leadPrefsRow.active = on;
  syncLeadPrefsUi();
  showToast(on ? 'לידים מבעלי נכסים הופעלו' : 'קבלת לידים מבעלי נכסים הושהתה');
}

(function wireLeadPrefs(){
  const body = document.getElementById('setLeadPrefsBody');
  body.addEventListener('input', syncLeadPrefsUi);
  body.addEventListener('click', e => {
    const all = e.target.closest('[data-hood-all]');
    if (!all) return;
    const group = all.closest('[data-hood-group]');
    const chips = group.querySelectorAll('[data-ui-chip]');
    const allOn = group.querySelectorAll('[data-ui-chip][aria-pressed="true"]').length === chips.length;
    chips.forEach(c => c.setAttribute('aria-pressed', String(!allOn)));
    all.dispatchEvent(new Event('input', { bubbles:true }));
  });
  // ‏input ולא click: הסימון עצמו כבר נעשה במאזין המואצל של crm-ui.js
  document.getElementById('setOwnerSwitch').addEventListener('input', e => setOwnerLeadsActive(e.currentTarget));
})();

/* קיצור דרך מ"הלידים שלי" (החלטה של תומר, 20.10.2026): ההגדרות עצמן נשארות
   ב"ההגדרות שלי", והקיצור פותח אותן שם */
function openLeadPrefs(){
  uiFoldOpen('setLeadPrefs');
  gotoSection('accPrefs', null, { scrollTo:'#setLeadPrefs' });
}

function syncLeadPrefsLink(){
  const sub = document.getElementById('leadPrefsLinkSub');
  if (!sub) return;
  // "הגדרות לידים" שבתחתית "הלידים שלי" (assets/crm-leads.js)
  if (typeof syncLeadsSettings === 'function') syncLeadsSettings();
  const row = leadPrefsRow;
  if (!row){
    sub.textContent = 'עוד לא הוגדרו, ולכן לידים מבעלי נכסים לא מגיעים אליך';
    sub.classList.add('is-warn');
    return;
  }
  sub.classList.toggle('is-warn', !row.active);
  sub.textContent = row.active
    ? 'פעיל · ' + leadPrefsSummary({
        hoods: row.preferred_neighborhoods || [], types: row.preferred_property_types || [], deals: row.preferred_deal_types || [] })
    : 'מושהה. ההגדרות נשמרות.';
}


/* ==========================================================================
   שעות השקט והימים השקטים - עורך אחד, שני מופעים ('set' ו-'np')
   ========================================================================== */
const QUIET_PREFIXES = ['set', 'np'];
const quietBars = {};

function quietEditorHtml(p){
  const opts = Array.from({ length:24 }, (_, h) => `<option value="${h}">${setHour(h)}</option>`).join('');
  const days = REMINDER_WEEKDAYS.map((name, d) =>
    `<button type="button" class="set-day" data-ui-chip data-value="${d}" aria-pressed="false" aria-label="יום ${escapeHtml(name)}">${escapeHtml(REMINDER_WEEKDAY_SHORT[d].replace('׳', ''))}</button>`).join('');
  return `<div class="set-quiet" id="${p}Quiet">`
    + `<div class="set-quiet-row">`
    +   `<div class="set-field"><label for="${p}QFrom">משעה</label><select class="set-select" id="${p}QFrom">${opts}</select></div>`
    +   `<div class="set-field"><label for="${p}QTo">עד שעה</label><select class="set-select" id="${p}QTo">${opts}</select></div>`
    +   `<div class="set-quiet-viz" aria-hidden="true">`
    +     `<div class="set-quiet-bar" dir="ltr" id="${p}QBar"></div>`
    +     `<div class="set-quiet-scale" dir="ltr"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>`
    +     `<div class="set-quiet-legend"><span><i class="is-quiet"></i><span id="${p}QLen"></span></span><span><i></i>התראות פעילות</span></div>`
    +   `</div>`
    + `</div>`
    + `<div class="set-field"><span class="set-field-label" id="${p}QDaysLabel">ימי שקט</span>`
    +   `<div class="set-days" id="${p}QDays" role="group" aria-labelledby="${p}QDaysLabel">${days}</div></div>`
    + `<p class="ui-hint"><span>בימים המסומנים לא נשלחות הודעות כל היום. בשאר הימים - רק בשעות השקט.</span>`
    + `<span>הפעמון בדשבורד ותזכורות לפגישות מהיומן לא מושפעים.</span></p>`
    + `</div>`;
}

function quietRead(p){
  const from = document.getElementById(p + 'QFrom');
  if (!from) return null;
  return {
    from: Number(from.value),
    to: Number(document.getElementById(p + 'QTo').value),
    days: uiChipValues(document.getElementById(p + 'QDays')).map(Number).sort((a, b) => a - b),
  };
}

function quietApply(p, q){
  const from = document.getElementById(p + 'QFrom');
  if (!from) return;
  from.value = String(q.from);
  document.getElementById(p + 'QTo').value = String(q.to);
  uiSetChips(document.getElementById(p + 'QDays'), q.days);
  quietPaint(p);
}

/* הפס של 24 השעות: חלון השקט בנייבי, וחלון שחוצה חצות הוא שני קטעים */
function quietPaint(p){
  const q = quietRead(p);
  const bar = document.getElementById(p + 'QBar');
  if (!q || !bar) return;
  const seg = (a, b) => `<span style="left:${a / 24 * 100}%;width:${(b - a) / 24 * 100}%"></span>`;
  bar.innerHTML = q.from === q.to ? ''
    : q.from < q.to ? seg(q.from, q.to) : seg(0, q.to) + seg(q.from, 24);
  const len = (q.to - q.from + 24) % 24;
  document.getElementById(p + 'QLen').textContent = len ? `שקט - ${len} שעות` : 'בלי שעות שקט';
}

function quietPrefs(){
  return { from: reminderPrefs.quiet_from_hour, to: reminderPrefs.quiet_to_hour, days: reminderPrefs.quiet_days.slice().sort((a, b) => a - b) };
}

function quietSummary(q){
  const hours = q.from === q.to ? 'בלי שעות שקט' : `שעות שקט ${setHour(q.from)}-${setHour(q.to)}`;
  const days = q.days.length ? 'ימי שקט: ' + q.days.map(d => REMINDER_WEEKDAY_SHORT[d]).join(', ') : 'בלי ימי שקט';
  return hours + ' · ' + days;
}

function syncQuietSummaries(){
  const el = document.getElementById('setQuietSummary');
  if (el) el.textContent = quietSummary(quietPrefs());
}

/* מצייר מחדש את המופעים מ-reminderPrefs. מופע עם שינוי שלא נשמר לא נדרס */
function renderQuietEditors(except){
  ensureSettingsMounted();
  QUIET_PREFIXES.forEach(p => {
    if (p === except) return;
    const bar = quietBars[p];
    if (bar && bar.isDirty()) return;
    quietApply(p, quietPrefs());
    if (bar) bar.setBaseline();
  });
  syncQuietSummaries();
}

let remindersReady = false;
function remindersNotReady(){
  return new Error('ההגדרות עוד נטענות. נסו שוב בעוד רגע.');
}

/* ההרכבה של שני העורכים ושל המאזינים - בפעם הראשונה שצריך אותם ולא בטעינת
   הקובץ: הם נשענים על REMINDER_WEEKDAYS ו-reminderPrefs, שמוגדרים ב-crm.js
   שנטען אחרי הקובץ הזה */
let settingsMounted = false;
function ensureSettingsMounted(){
  if (settingsMounted) return;
  settingsMounted = true;
  mountHubQuiet();
  wireNotifScreen();
}
document.addEventListener('DOMContentLoaded', ensureSettingsMounted);

function mountHubQuiet(){
  const host = document.getElementById('setQuietEditor');
  host.innerHTML = quietEditorHtml('set');
  host.addEventListener('input', () => quietPaint('set'));
  host.addEventListener('change', () => quietPaint('set'));
  quietApply('set', quietPrefs());
  // רק שלושת שדות השקט: שאר השורה (ערוצים, תדירות) נשמרת ב"התראות והודעות"
  quietBars.set = uiSaveBar(document.getElementById('setQuietBody'), {
    read: () => quietRead('set'),
    apply: q => quietApply('set', q),
    save: async q => {
      if (!remindersReady || !currentAgent) throw remindersNotReady();
      const { error } = await sb.from('agent_reminder_preferences').upsert({
        agent_id: currentAgent.id,
        quiet_from_hour: q.from, quiet_to_hour: q.to, quiet_days: q.days,
        updated_at: new Date().toISOString(),
      }, { onConflict:'agent_id' });
      if (error) throw error;
      Object.assign(reminderPrefs, { quiet_from_hour: q.from, quiet_to_hour: q.to, quiet_days: q.days });
      renderQuietEditors('set');
    },
    labels: { clean:'כל ההגדרות שמורות' },
  });
}

/* ==========================================================================
   התראות והודעות (סעיף 3.6)
   ========================================================================== */

/* חמש הקבוצות, והסדר בתוך כל אחת. סוג התראה חדש ב-NOTIF_TYPES שאינו רשום
   כאן נכנס לקבוצת העסקאות (או לניהול הפלטפורמה, אם הוא view:'admin') - כך
   הוא לא נעלם מהמסך גם אם שכחו להוסיף אותו */
const NOTIF_GROUPS = [
  { key:'leads',   title:'לידים ולקוחות', types:['new_lead', 'showcase_meeting', 'showcase_activity', 'match_digest', 'retention_warning', 'client_match'] },
  { key:'agenda',  title:'יומן והמנטור', types:['agenda_reminder', 'coach_daily', '__reminders', 'onboarding_property', 'onboarding_client', 'onboarding_agreement', 'onboarding_lead'] },
  { key:'deals',   title:'עסקאות, הסכמים ונכסים', types:['agreement_signed', 'deal_closed', 'marketing_copy', 'system', 'listing_match', 'call_deleted_by_manager'] },
  { key:'reviews', title:'ביקורות', types:['review_new', 'review_request'] },
  { key:'admin',   title:'ניהול הפלטפורמה', admin:true, types:['review_alert', 'lead_unrouted', 'platform_signup', 'deal_data_gap', 'deal_sync_summary', 'access_review', 'security_alert', 'platform_upgrade', 'improvement_suggestion'] },
];
/* "רק דחוף" בוואטסאפ: אדם מחכה בצד השני, או שהשעה נקבעה מראש */
const NOTIF_URGENT = new Set(['new_lead', 'showcase_meeting', 'agenda_reminder', 'agreement_signed', 'lead_unrouted', 'security_alert']);
const NOTIF_FREQ = { match_digest:'3 פעמים ביום', coach_daily:'כל בוקר' };
const REMINDER_CADENCES = [['weekly', 'פעם בשבוע'], ['daily', 'עד פעם ביום'], ['off', 'כבוי']];

let notifPrefsReady = false;
let notifBar = null;
let notifOpenGroup = 'leads';

function notifGroupsVisible(){
  const types = notifVisibleTypes();
  const placed = new Set();
  const groups = NOTIF_GROUPS.map(g => {
    const rows = [];
    g.types.forEach(type => {
      if (type === '__reminders'){ rows.push({ reminders:true }); return; }
      const t = types.find(x => x.type === type);
      if (t){ rows.push(t); placed.add(type); }
    });
    return { ...g, rows };
  });
  types.filter(t => !placed.has(t.type)).forEach(t => {
    groups.find(g => g.key === (t.view === 'admin' ? 'admin' : 'deals')).rows.push(t);
  });
  return groups.filter(g => g.rows.some(r => !r.reminders) || g.rows.some(r => r.reminders));
}

function notifRowHtml(t){
  const muted = notifMutedTypes.includes(t.type);
  const tierOk = assistantTierOk();
  const tag = NOTIF_URGENT.has(t.type) ? '<span class="ui-tag ui-tag--urgent">דחוף</span>'
    : NOTIF_FREQ[t.type] ? `<span class="ui-tag">${escapeHtml(NOTIF_FREQ[t.type])}</span>` : '';
  return `<div class="np2-row" data-type="${escapeHtml(t.type)}">`
    + `<div class="np2-text"><div class="np2-title">${escapeHtml(t.title)}${tag}</div><div class="np2-sub">${escapeHtml(t.sub)}</div></div>`
    + `<div class="np2-ch">`
    +   `<button type="button" class="np2-ch-btn is-bell" data-np-bell aria-pressed="${!muted}" aria-label="${escapeHtml(t.title)} - בפעמון">${setIcon('bell')}</button>`
    +   `<button type="button" class="np2-ch-btn is-wa" data-np-wa aria-pressed="${!muted && notifWaOn(t)}" aria-label="${escapeHtml(t.title)} - בוואטסאפ"${muted || !tierOk ? ' disabled' : ''}>${setIcon('chat')}</button>`
    + `</div></div>`;
}

function reminderRowHtml(){
  const rp = reminderPrefs;
  const kinds = REMINDER_KINDS.map(k =>
    `<div class="np2-kind"><div class="np2-text"><div class="np2-title" id="npKind-${escapeHtml(k.kind)}">${escapeHtml(k.title)}</div><div class="np2-sub">${escapeHtml(k.sub)}</div></div>`
    + `<button type="button" class="ui-switch" data-ui-switch data-kind="${escapeHtml(k.kind)}" aria-pressed="${!rp.muted_kinds.includes(k.kind)}" aria-labelledby="npKind-${escapeHtml(k.kind)}"></button></div>`).join('');
  const cadence = ['daily', 'weekly', 'off'].includes(rp.cadence) ? rp.cadence : 'weekly';
  return `<div class="np2-row np2-row--rem">`
    + `<div class="np2-text"><div class="np2-title">סיכום תזכורות<span class="ui-tag" id="npRemFreq"></span></div>`
    + `<div class="np2-sub">כל מה שכדאי לטפל בו במודעות שלך, בהודעה אחת. בוואטסאפ או במייל, לא בפעמון.</div></div>`
    + `<button type="button" class="ui-link" data-np-rem aria-expanded="false" aria-controls="npRemBody">הגדרות הסיכום</button>`
    + `</div>`
    + `<div class="np2-rem" id="npRemBody" hidden>`
    +   `<div class="set-field"><span class="set-field-label" id="npRemChLabel">לאן לשלוח</span>`
    +     `<div class="ui-chips" id="npRemCh" role="group" aria-labelledby="npRemChLabel">`
    +       uiChip('וואטסאפ', { value:'whatsapp', on: rp.channels.includes('whatsapp') })
    +       uiChip('מייל', { value:'email', on: rp.channels.includes('email') })
    +     `</div><p class="ui-hint" id="npRemChNote"></p></div>`
    +   `<div class="set-field"><span class="set-field-label" id="npRemCadLabel">תדירות</span>`
    +     `<div class="ui-chips" data-ui-single id="npRemCadence" role="group" aria-labelledby="npRemCadLabel">`
    +       REMINDER_CADENCES.map(([v, l]) => uiChip(l, { value:v, on: v === cadence, icon:false })).join('')
    +     `</div></div>`
    +   `<div class="set-field"><label for="npRemCap">מקסימום הודעות ב-30 יום</label>`
    +     `<input type="number" class="set-select set-num" id="npRemCap" min="0" max="60" step="1" inputmode="numeric" value="${escapeHtml(rp.max_per_30_days)}"></div>`
    +   `<div class="set-field"><span class="set-field-label">אילו תזכורות יישלחו</span><div class="np2-kinds">${kinds}</div>`
    +     `<p class="ui-hint"><span>כיבוי מכבה את ההודעה בלבד.</span><span>הממצא ממשיך להופיע ב"תזכורות וטיפים".</span></p></div>`
    +   `<p class="ui-hint" id="rmLastSent"></p>`
    + `</div>`;
}

function renderNotifScreen(){
  ensureSettingsMounted();
  const groupsEl = document.getElementById('npGroups');
  if (!groupsEl) return;
  quietApply('np', quietPrefs());

  // השורה "ההודעה האחרונה נשלחה" נטענת פעם אחת (loadReminderLastSent ב-crm.js)
  // ונשמרת בין ציורים, בלי בקשה נוספת בכל ציור
  const lastSent = document.getElementById('rmLastSent');
  const lastSentText = lastSent ? lastSent.textContent : '';
  const groups = notifGroupsVisible();
  if (!groups.some(g => g.key === notifOpenGroup)) notifOpenGroup = groups.length ? groups[0].key : null;
  groupsEl.innerHTML = groups.map(g => {
    const open = g.key === notifOpenGroup;
    return `<section class="ui-fold np2-group${open ? ' is-open' : ''}" id="npG-${g.key}" data-ui-fold-group="np" data-group="${g.key}">`
      + `<div class="ui-fold-head"><div class="ui-fold-title"><div><h4 class="ui-h3">${escapeHtml(g.title)}</h4><div class="ui-fold-summary" data-np-sum></div></div></div>`
      + `<div class="ui-fold-tools">${g.admin ? '<span class="ui-tag ui-tag--navy">אדמין</span>' : ''}`
      + `<button type="button" class="ui-icon-btn" data-ui-fold aria-expanded="${open}" aria-controls="npG-${g.key}-body" aria-label="פתיחה וסגירה: ${escapeHtml(g.title)}">${UI_ICON_CHEV}</button></div></div>`
      + `<div class="ui-fold-body" id="npG-${g.key}-body"${open ? '' : ' hidden'}>`
      + g.rows.map(r => r.reminders ? reminderRowHtml() : notifRowHtml(r)).join('')
      + `</div></section>`;
  }).join('');

  if (!notifBar){
    notifBar = uiSaveBar(document.getElementById('npScreen'), {
      read: notifScreenState,
      apply: notifScreenApply,
      save: async s => {
        const [notif, rem] = await Promise.all([saveNotifPrefsRows(s), saveReminderPrefs(s)]);
        if (notif.error || rem.error) throw (notif.error || rem.error);
        renderQuietEditors('np');
      },
      labels: { clean:'כל ההגדרות שמורות' },
    });
  }
  notifBar.setBaseline();
  syncNotifScreen();
  const ls = document.getElementById('rmLastSent');
  if (ls) ls.textContent = lastSentText;
}

/* המצב של כל המסך, כאובייקט אחד - לפס השמירה ולשמירה עצמה */
function notifScreenState(){
  const rows = Array.from(document.querySelectorAll('#npGroups .np2-row[data-type]'));
  const pressed = (row, sel) => row.querySelector(sel).getAttribute('aria-pressed') === 'true';
  const capEl = document.getElementById('npRemCap');
  const kindsOff = Array.from(document.querySelectorAll('#npGroups [data-kind]'))
    .filter(b => b.getAttribute('aria-pressed') !== 'true').map(b => b.dataset.kind).sort();
  return {
    bellOff: rows.filter(r => !pressed(r, '[data-np-bell]')).map(r => r.dataset.type).sort(),
    waOff: rows.filter(r => !pressed(r, '[data-np-wa]')).map(r => r.dataset.type).sort(),
    quiet: quietRead('np'),
    rem: capEl ? {
      channels: uiChipValues(document.getElementById('npRemCh')).sort(),
      cadence: uiChipValues(document.getElementById('npRemCadence'))[0] || 'weekly',
      // ‏clamp כבר בקריאה: 200 בשדה היה חוזר כשגיאת constraint באנגלית
      cap: Math.min(60, Math.max(0, Math.round(Number(capEl.value) || 0))),
      mutedKinds: kindsOff,
    } : null,
  };
}

function notifScreenApply(s){
  const tierOk = assistantTierOk();
  document.querySelectorAll('#npGroups .np2-row[data-type]').forEach(row => {
    const t = row.dataset.type;
    const bellOn = !s.bellOff.includes(t);
    row.querySelector('[data-np-bell]').setAttribute('aria-pressed', String(bellOn));
    const wa = row.querySelector('[data-np-wa]');
    wa.setAttribute('aria-pressed', String(bellOn && !s.waOff.includes(t)));
    wa.disabled = !bellOn || !tierOk;
  });
  if (s.quiet) quietApply('np', s.quiet);
  if (s.rem){
    uiSetChips(document.getElementById('npRemCh'), s.rem.channels);
    uiSetChips(document.getElementById('npRemCadence'), [s.rem.cadence]);
    document.getElementById('npRemCap').value = s.rem.cap;
    document.querySelectorAll('#npGroups [data-kind]').forEach(b =>
      b.setAttribute('aria-pressed', String(!s.rem.mutedKinds.includes(b.dataset.kind))));
  }
  syncNotifScreen();
}

/* כל מה שנגזר מהמצב שעל המסך: הבחירה של "מה נשלח לוואטסאפ", המונים, הסיכום
   של כל קבוצה וההערות. נקרא בכל שינוי */
function syncNotifScreen(){
  const rows = Array.from(document.querySelectorAll('#npGroups .np2-row[data-type]'));
  const on = (row, sel) => row.querySelector(sel).getAttribute('aria-pressed') === 'true';
  const total = rows.length;
  const bellN = rows.filter(r => on(r, '[data-np-bell]')).length;
  const waTypes = rows.filter(r => on(r, '[data-np-bell]') && on(r, '[data-np-wa]')).map(r => r.dataset.type);
  const tierOk = assistantTierOk();

  // הבחירה נגזרת מהשורות ואינה נשמרת: "רק דחוף" הוא בדיוק רשימת הדחופים
  const urgent = rows.map(r => r.dataset.type).filter(t => NOTIF_URGENT.has(t));
  const preset = waTypes.length === total ? 'all'
    : waTypes.length === urgent.length && urgent.every(t => waTypes.includes(t)) ? 'urgent' : 'custom';
  document.querySelectorAll('#npWaPresets [data-preset]').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.preset === preset));
    b.disabled = !tierOk;
  });

  const count = document.getElementById('npWaCount');
  if (count) count.textContent = tierOk ? `${waTypes.length} מתוך ${total} סוגים בוואטסאפ` : '';
  const note = document.getElementById('npWaNote');
  if (note){
    if (!tierOk){
      note.innerHTML = '<span>שליחת ההתראות בוואטסאפ היא חלק מגבריאלה, שזמינה במסלולים PROFESSIONAL ו-Elite.</span>'
        + '<span>ההתראות בפעמון עובדות בכל מסלול. <a href="/pricing" target="_blank" rel="noopener">לפרטים ולשדרוג</a></span>';
    } else if (currentAgent && currentAgent.phone){
      note.innerHTML = `<span>נשלח לוואטסאפ ${escapeHtml(currentAgent.phone)}. <button type="button" class="ui-link" data-goto="accWhatsapp">שינוי</button></span>`;
    } else {
      note.innerHTML = '<span class="is-warn">כדי שההתראות יגיעו בוואטסאפ צריך מספר שמור ב"גבריאלה בוואטסאפ". <button type="button" class="ui-link" data-goto="accWhatsapp">להוספת המספר</button></span>';
    }
  }

  document.querySelectorAll('#npGroups [data-group]').forEach(g => {
    const gr = Array.from(g.querySelectorAll('.np2-row[data-type]'));
    const b = gr.filter(r => on(r, '[data-np-bell]')).length;
    const w = gr.filter(r => on(r, '[data-np-bell]') && on(r, '[data-np-wa]')).length;
    const sum = g.querySelector('[data-np-sum]');
    if (sum) sum.textContent = `${plural(gr.length, 'סוג אחד', 'סוגים')} · ${b} בפעמון · ${w} בוואטסאפ`;
  });

  const st = document.getElementById('npRemCh') ? notifScreenState().rem : null;
  if (st){
    const freq = document.getElementById('npRemFreq');
    freq.textContent = st.cadence === 'off' || !st.channels.length || !st.cap ? 'כבוי' : st.cadence === 'daily' ? 'יומי' : 'שבועי';
    const parts = [];
    if (!st.channels.length) parts.push('בלי ערוץ מסומן לא תישלח שום הודעה.');
    if (st.channels.includes('whatsapp') && !(currentAgent && currentAgent.phone))
      parts.push(st.channels.includes('email')
        ? 'לוואטסאפ צריך מספר שמור ב"גבריאלה בוואטסאפ".'
        : 'לוואטסאפ צריך מספר שמור ב"גבריאלה בוואטסאפ". עד שיישמר, התזכורות יישלחו במייל.');
    if (st.channels.includes('email') && !(currentAgent && currentAgent.email)) parts.push('לא נמצאה כתובת מייל בפרטי הסוכן/ת.');
    document.getElementById('npRemChNote').innerHTML = parts.map(p => `<span>${escapeHtml(p)}</span>`).join('');
  }

  // המונה על הקטגוריה, והשורה בתחתית "התראות והודעות" שב"ההגדרות שלי"
  if (total) accSetCount('accNotifPrefs', bellN === total ? 'הכול' : bellN + '/' + total);
  const hub = document.getElementById('setNotifSummary');
  if (hub && total){
    hub.textContent = `${total} סוגי התראות · `
      + (bellN === total ? 'כולם בפעמון' : `${bellN} בפעמון`)
      + (tierOk ? (waTypes.length === total ? ' ובוואטסאפ' : ` · ${waTypes.length} בוואטסאפ`) : '');
  }
}

/* נקראות מ-loadNotifPrefs ומ-loadReminders ב-crm.js, ומהשמירה של מספר
   הוואטסאפ (syncNotifWaNote) */
function renderNotifPrefs(){ notifPrefsReady = true; renderNotifScreen(); }
function renderReminderPrefs(){ remindersReady = true; renderNotifScreen(); renderQuietEditors(); }
function syncNotifWaNote(){ syncNotifScreen(); }

/* שמירת חצי ההתראות (‏agent_notification_preferences). נשמרות רשימות
   ה**כבויים**: סוג שאינו גלוי לתפקיד הזה שומר על מצבו הקודם, וסוג שכובה
   בפעמון נכבה גם בוואטסאפ - הוא לא ייווצר במסד, ואין ממה לשלוח */
async function saveNotifPrefsRows(s){
  if (!notifPrefsReady || !currentAgent) return { error: remindersNotReady() };
  const shown = notifVisibleTypes().map(t => t.type);
  const muted = notifMutedTypes.filter(t => !shown.includes(t)).concat(s.bellOff);
  const whatsappOff = notifWhatsappOffTypes.filter(t => !shown.includes(t))
    .concat(shown.filter(t => s.waOff.includes(t) || s.bellOff.includes(t)));
  const { error } = await sb.from('agent_notification_preferences').upsert({
    agent_id: currentAgent.id,
    muted_types: muted,
    whatsapp_off_types: whatsappOff,
    updated_at: new Date().toISOString(),
  }, { onConflict:'agent_id' });
  if (error) return { error };
  notifMutedTypes = muted;
  notifWhatsappOffTypes = whatsappOff;
  return {};
}

/* שמירת חצי התזכורות (‏agent_reminder_preferences), כולל שעות השקט.
   ‏**לא לפני שהמסך צויר מהמסד** - אחרת ברירות המחדל היו דורסות הגדרה קיימת */
async function saveReminderPrefs(s){
  if (!remindersReady || !currentAgent || !s.rem || !s.quiet) return { error: remindersNotReady() };
  const shown = REMINDER_KINDS.map(k => k.kind);
  const muted = reminderPrefs.muted_kinds.filter(k => !shown.includes(k)).concat(s.rem.mutedKinds);
  const payload = {
    agent_id: currentAgent.id,
    channels: s.rem.channels,
    muted_kinds: muted,
    cadence: s.rem.cadence,
    max_per_30_days: s.rem.cap,
    quiet_from_hour: s.quiet.from,
    quiet_to_hour: s.quiet.to,
    quiet_days: s.quiet.days,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('agent_reminder_preferences').upsert(payload, { onConflict:'agent_id' });
  if (error) return { error };
  reminderPrefs = {
    channels: s.rem.channels, muted_kinds: muted, cadence: s.rem.cadence, max_per_30_days: s.rem.cap,
    quiet_from_hour: s.quiet.from, quiet_to_hour: s.quiet.to, quiet_days: s.quiet.days,
  };
  document.getElementById('npRemCap').value = s.rem.cap;
  // ההשתקה משנה את השורות ב"תזכורות וטיפים" (‏is-muted)
  renderReminders();
  return {};
}

function wireNotifScreen(){
  const screen = document.getElementById('npScreen');
  document.getElementById('npQuietEditor').innerHTML = quietEditorHtml('np');
  quietApply('np', quietPrefs());
  quietBars.np = { isDirty: () => !!(notifBar && notifBar.isDirty()), setBaseline: () => notifBar && notifBar.setBaseline() };

  screen.addEventListener('input', e => {
    if (e.target.closest('#npQuietEditor')) quietPaint('np');
    syncNotifScreen();
  });
  screen.addEventListener('change', e => {
    if (e.target.closest('#npQuietEditor')) quietPaint('np');
  });

  screen.addEventListener('click', e => {
    // פעמון: כיבוי מכבה גם את הוואטסאפ, והדלקה מחזירה אותו לברירת המחדל - דלוק
    const bell = e.target.closest('[data-np-bell]');
    if (bell){
      const on = bell.getAttribute('aria-pressed') !== 'true';
      bell.setAttribute('aria-pressed', String(on));
      const wa = bell.closest('.np2-row').querySelector('[data-np-wa]');
      wa.disabled = !on || !assistantTierOk();
      wa.setAttribute('aria-pressed', String(on && assistantTierOk()));
      bell.dispatchEvent(new Event('input', { bubbles:true }));
      return;
    }
    const wa = e.target.closest('[data-np-wa]');
    if (wa && !wa.disabled){
      wa.setAttribute('aria-pressed', String(wa.getAttribute('aria-pressed') !== 'true'));
      wa.dispatchEvent(new Event('input', { bubbles:true }));
      return;
    }
    const preset = e.target.closest('[data-preset]');
    if (preset && !preset.disabled){
      const rows = document.querySelectorAll('#npGroups .np2-row[data-type]');
      if (preset.dataset.preset === 'custom'){
        const first = document.querySelector('#npGroups [data-group]');
        if (first) uiFoldOpen(first);
        return;
      }
      rows.forEach(row => {
        const t = row.dataset.type;
        const b = row.querySelector('[data-np-bell]');
        const w = row.querySelector('[data-np-wa]');
        const want = preset.dataset.preset === 'all' || NOTIF_URGENT.has(t);
        // "הכל" מדליק גם את הפעמון (וואטסאפ בלי פעמון אינו אפשרי); "רק דחוף"
        // מדליק פעמון רק לדחופים, ובשאר נוגע בוואטסאפ בלבד
        if (want) b.setAttribute('aria-pressed', 'true');
        const bellOn = b.getAttribute('aria-pressed') === 'true';
        w.disabled = !bellOn;
        w.setAttribute('aria-pressed', String(want && bellOn));
      });
      preset.dispatchEvent(new Event('input', { bubbles:true }));
      return;
    }
    const rem = e.target.closest('[data-np-rem]');
    if (rem){
      const open = rem.getAttribute('aria-expanded') !== 'true';
      rem.setAttribute('aria-expanded', String(open));
      document.getElementById('npRemBody').hidden = !open;
    }
  });

  // הקבוצה הפתוחה נשמרת בין ציורים (טעינה חוזרת של ההעדפות)
  screen.addEventListener('ui-fold', e => {
    const g = e.target.closest('[data-group]');
    if (g && e.detail.open) notifOpenGroup = g.dataset.group;
  });
}
