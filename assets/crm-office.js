/* ==========================================================================
   כלי המשרד ב-CRM: הפניות, ייצוא קובץ הלקוחות וייבוא לקוחות מאקסל

   שלושה דברים שחולקים שאלה אחת - "מה של המשרד ומה של הסוכן/ת":

   1. **הפנייה** - מנהל/ת משרד מוסר/ת לקוח/ה, נכס או ליד פתוח לסוכן/ת
      מהצוות. השורה מסומנת `referred_by`, ומאותו רגע היא משותפת לשניהם:
      הסוכן/ת מטפל/ת, והמנהל/ת ממשיך/ה לראות ולעדכן. ההעברה עצמה רק דרך
      ‏`refer_to_agent()` במסד (מיגרציה 20270128090000) - שם נבדק שהקורא/ת
      מנהל/ת ושהיעד בצוות. כאן רק הממשק.
   2. **ייצוא קובץ הלקוחות** - למנהל/ת משרד בלבד, כמו ייצוא הנכסים.
   3. **ייבוא לקוחות מאקסל/CSV** - לכולם. עמודות הקובץ זהות לעמודות
      הייצוא, ולכן קובץ שירד נקרא בחזרה בלי מיפוי ידני.

   הקובץ נטען **לפני** `crm.js` ומגדיר פונקציות בלבד: כל מה שהוא צריך משם
   (‏`sb`, `currentAgent`, `clientRows`, `loadImportLib`...) נקרא בזמן
   ריצה, אחרי ששני הקבצים כבר נטענו. ‏docs/office-referrals.md
   ========================================================================== */

/* ---------- עזרים ---------- */

function officeIsManager(){
  return !!(typeof currentAgent !== 'undefined' && currentAgent && currentAgent.role === 'manager');
}

// השם של חבר/ת צוות. ‏agencyColleagues אינו כולל את המשתמש/ת עצמו/ה.
function officeMemberName(id){
  if (!id) return '';
  if (currentAgent && id === currentAgent.id) return currentAgent.display_name || 'אני';
  const hit = (typeof agencyColleagues !== 'undefined' && agencyColleagues || []).find(m => m.id === id);
  return hit ? (hit.display_name || '') : '';
}

/* טוען את שמות הצוות רק אם יש בכלל שורה בהפנייה - השמות נדרשים לשורת
   "הגיע/ה בהפנייה מ..." ולא לשום דבר אחר ברשימה. */
async function officePreloadNames(rows){
  if ((rows || []).some(r => r && r.referred_by) && typeof ensureColleaguesLoaded === 'function'){
    try { await ensureColleaguesLoaded(); } catch (e) { /* השמות הם נוחות */ }
  }
}

/* שורת ההסבר על הפנייה, בניסוח של מי שקורא/ת אותה:
   המנהל/ת רואה למי מסר/ה, והסוכן/ת רואה ממי קיבל/ה. */
function referralNote(row){
  if (!row || !row.referred_by || !currentAgent) return '';
  const when = row.referred_at ? ' · ' + new Date(row.referred_at).toLocaleDateString('he-IL') : '';
  if (row.referred_by === currentAgent.id){
    const who = officeMemberName(row.agent_id);
    return '🤝 בהפנייה ממך' + (who ? ' · בטיפול ' + who : '') + when;
  }
  const from = officeMemberName(row.referred_by);
  return '🤝 הגיע בהפנייה' + (from ? ' מ' + from : ' מהמשרד') + when;
}

function referralNoteHtml(row){
  const t = referralNote(row);
  return t ? `<div class="lead-meta referral-note">${escapeHtml(t)}</div>` : '';
}

/* מי רשאי/ת למסור את השורה: מנהל/ת, על מה שבידיו/ה או על מה שכבר מסר/ה.
   נכס - גם כל נכס של המשרד, שהמנהל/ת ממילא רואה/ה. הבדיקה האמיתית
   במסד; כאן רק ההחלטה אם להציג כפתור. */
function canReferRow(kind, row){
  if (!officeIsManager() || !row) return false;
  if (kind === 'lead' && row.status !== 'unlocked') return false;
  if (row.agent_id === currentAgent.id || row.referred_by === currentAgent.id) return true;
  return kind === 'property' && row.agency_id && row.agency_id === currentAgent.agency_id;
}

/* ---------- חלון המסירה ---------- */

const REFER_KIND_TEXT = {
  client:   { title:'מסירת לקוח/ה לסוכן/ת', noun:'הלקוח/ה' },
  property: { title:'מסירת נכס לסוכן/ת',    noun:'הנכס' },
  lead:     { title:'מסירת ליד לסוכן/ת',     noun:'הליד' },
};

let referState = null;

async function openReferModal(kind, row, label, onDone){
  if (!canReferRow(kind, row)) return;
  const modal = document.getElementById('referModal');
  const select = document.getElementById('referAgent');
  const text = REFER_KIND_TEXT[kind];
  referState = { kind, row, onDone };

  document.getElementById('referTitle').textContent = text.title;
  document.getElementById('referWhat').textContent = label || '';
  select.innerHTML = '<option value="">טוען את הצוות…</option>';
  select.disabled = true;
  document.getElementById('referRun').disabled = true;
  modal.style.display = 'flex';

  // ‏expLoadTeam ולא agencyColleagues: היא כוללת גם את מצב ה-active, וסוכן/ת
  // מושעה/ת אינו/ה יעד למסירה
  const team = (await expLoadTeam()).filter(m => m.active && m.id !== currentAgent.id);
  const back = row.referred_by === currentAgent.id
    ? `<option value="${escapeHtml(currentAgent.id)}">החזרה אליי (ביטול ההפנייה)</option>` : '';
  select.innerHTML = team.length || back
    ? '<option value="">בחירת סוכן/ת</option>' + team.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === row.agent_id ? ' disabled' : ''}>${
          escapeHtml(m.display_name || 'ללא שם')}${m.id === row.agent_id ? ' (מטפל/ת עכשיו)' : ''}</option>`
      ).join('') + back
    : '<option value="">אין סוכנים פעילים בצוות</option>';
  select.disabled = !(team.length || back);
  document.getElementById('referNote').textContent =
    `${text.noun} יסומן כ"הפנייה" ויהיה משותף לך ולסוכן/ת המטפל/ת: שניכם תראו אותו ותוכלו לעדכן אותו. ` +
    'הסוכן/ת יקבל/תקבל התראה בפעמון.';
}

function closeReferModal(){
  document.getElementById('referModal').style.display = 'none';
  referState = null;
}

async function runRefer(){
  if (!referState) return;
  const agentId = document.getElementById('referAgent').value;
  if (!agentId) return;
  const btn = document.getElementById('referRun');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'מוסר…';
  const { kind, row, onDone } = referState;
  const { data, error } = await sb.rpc('refer_to_agent', { p_kind: kind, p_id: row.id, p_agent_id: agentId });
  btn.textContent = original;
  btn.disabled = false;
  if (error || !data || data.ok === false){
    showToast('המסירה נכשלה: ' + heErr((data && data.error) || error), 6000);
    return;
  }
  closeReferModal();
  showToast(data.returned ? 'ההפנייה בוטלה והשורה חזרה אליך' : 'נמסר ל' + (data.agent_name || 'סוכן/ת') + ' בהפנייה');
  if (typeof onDone === 'function') onDone();
}

document.getElementById('referAgent').addEventListener('change', e => {
  document.getElementById('referRun').disabled = !e.target.value;
});
document.getElementById('referRun').addEventListener('click', runRefer);
document.getElementById('referCancel').addEventListener('click', closeReferModal);
document.getElementById('referModal').addEventListener('click', e => {
  if (e.target.id === 'referModal') closeReferModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('referModal').style.display !== 'none') closeReferModal();
});

/* ==========================================================================
   קובץ הלקוחות באקסל - עמודות משותפות לייצוא ולייבוא
   ========================================================================== */

/* סדר העמודות כאן הוא סדר הקובץ. ‏syn - שמות נוספים שהייבוא מזהה, כדי
   שקובץ ממערכת אחרת ("שם", "נייד", "תקציב") ייקרא בלי מיפוי ידני. */
const CLIENT_IO_FIELDS = [
  { key:'full_name',         label:'שם מלא',          syn:['שם','שם הלקוח','שם לקוח','לקוח','שם פרטי ומשפחה','name','full name'] },
  { key:'phone',             label:'טלפון',           syn:['נייד','טלפון נייד','מספר טלפון','פלאפון','סלולרי','phone','mobile'] },
  { key:'email',             label:'אימייל',          syn:['מייל','דואל','דואר אלקטרוני','email','e mail'] },
  { key:'id_number',         label:'ת.ז.',            syn:['תז','תעודת זהות','מספר זהות','id'] },
  { key:'address',           label:'כתובת',           syn:['כתובת מגורים','address'] },
  { key:'status',            label:'סטטוס',           syn:['מצב','status'] },
  // מחפש/ת מול בעל/ת נכס (client_kind) - בעל/ת נכס אינו/ה נכנס/ת להתאמות
  { key:'client_kind',       label:'סוג לקוח/ה',      syn:['סוג לקוח','מחפש או בעלים','בעל נכס','kind'] },
  { key:'deal_type',         label:'סוג עסקה',        syn:['עסקה','קנייה או שכירות','deal'] },
  { key:'category',          label:'קטגוריה',         syn:['מגורים או מסחרי','category'] },
  { key:'cities',            label:'ערים מבוקשות',    syn:['עיר','ערים','עיר מבוקשת','אזור','city','cities'] },
  { key:'property_types',    label:'סוגי נכס',        syn:['סוג נכס','סוג הנכס','property type'] },
  { key:'min_price',         label:'תקציב מינימלי',   syn:['מחיר מינימלי','תקציב מ','מתקציב'] },
  { key:'max_price',         label:'תקציב מקסימלי',   syn:['תקציב','מחיר מקסימלי','תקציב עד','עד תקציב','budget'] },
  { key:'min_rooms',         label:'חדרים מינימום',   syn:['חדרים','מספר חדרים','מחדרים','rooms'] },
  { key:'max_rooms',         label:'חדרים מקסימום',   syn:['עד חדרים'] },
  { key:'min_size_sqm',      label:'מ"ר מינימלי',     syn:['גודל','מר','שטח','גודל מינימלי'] },
  { key:'max_size_sqm',      label:'מ"ר מקסימלי',     syn:['עד מר','שטח מקסימלי','גודל מקסימלי'] },
  { key:'max_floor',         label:'קומה מקסימלית',   syn:['עד קומה'] },
  { key:'required_features', label:'מאפיינים נדרשים', syn:['מאפיינים','דרישות'] },
  { key:'financing_status',  label:'בשלות מימון',     syn:['מימון','אישור עקרוני'] },
  { key:'lead_source',       label:'מקור הגעה',       syn:['מקור','מקור הליד','source'] },
  { key:'notes',             label:'הערות',           syn:['הערה','notes'] },
];
const CLIENT_IO_NUMERIC = new Set(['min_price','max_price','min_rooms','max_rooms','min_size_sqm','max_size_sqm','max_floor']);
const CLIENT_IO_LISTS = new Set(['cities','property_types','required_features']);

// קוד → מילה בקובץ, ומילה בקובץ → קוד. המילה הראשונה לכל קוד היא זו שנכתבת.
const CLIENT_IO_WORDS = {
  status:    [['מחפש/ת','active'],['פעיל','active'],['מחפש','active'],['active','active'],
              ['בהמתנה','paused'],['מושהה','paused'],['paused','paused'],
              ['סגר/ה עסקה','closed'],['סגר עסקה','closed'],['סגור','closed'],['closed','closed']],
  client_kind: [['מחפש/ת','seeker'],['מחפש','seeker'],['קונה','seeker'],['שוכר','seeker'],['seeker','seeker'],
                ['בעל/ת נכס','owner'],['בעל נכס','owner'],['בעלים','owner'],['מוכר','owner'],['משכיר','owner'],['owner','owner']],
  deal_type: [['קנייה','sale'],['קניה','sale'],['רכישה','sale'],['מכירה','sale'],['sale','sale'],['buy','sale'],
              ['שכירות','rent'],['השכרה','rent'],['rent','rent']],
  category:  [['מגורים','residential'],['residential','residential'],['מסחרי','commercial'],['commercial','commercial']],
};
function clientIoWordMaps(){
  const out = {};
  const add = (field, pairs) => {
    const toWord = Object.create(null), toCode = Object.create(null);
    pairs.forEach(([word, code]) => {
      if (!(code in toWord) && /[֐-׿]/.test(word)) toWord[code] = word;
      toCode[impNorm(word)] = code;
      toCode[impNorm(code)] = code;
    });
    out[field] = { toWord, toCode };
  };
  Object.entries(CLIENT_IO_WORDS).forEach(([f, pairs]) => add(f, pairs));
  add('financing_status', Object.entries(CLIENT_FINANCING_LABELS).map(([c, w]) => [w, c]));
  add('lead_source',      Object.entries(CLIENT_SOURCE_LABELS).map(([c, w]) => [w, c]));
  return out;
}

function clientIoCell(c, key, maps){
  if (CLIENT_IO_NUMERIC.has(key)) return expNumber(c[key]);
  if (key === 'required_features') return (c.required_features || []).map(featureLabel).join(', ');
  if (CLIENT_IO_LISTS.has(key)) return (c[key] || []).join(', ');
  if (maps[key]) return maps[key].toWord[c[key]] || c[key] || '';
  return c[key] ?? '';
}

/* ---------- ייצוא: למנהל/ת משרד בלבד ----------
   מה שיורד הוא מה שהמנהל/ת רואה/ה בקובץ הלקוחות: הלקוחות שלו/ה, ואלה
   שמסר/ה בהפנייה. לקוחות שסוכן/ת הכניס/ה בעצמו/ה אינם נגישים למנהל/ת
   ב-RLS (‏agent_clients), ולכן גם אינם בקובץ - זה הגבול במסד, לא בדפדפן. */

async function exportClientsFile(scope){
  if (!officeIsManager()){ showToast('ייצוא קובץ הלקוחות זמין למנהל/ת המשרד בלבד'); return; }
  let rows = clientRows.slice();
  if (scope === 'own')      rows = rows.filter(c => c.agent_id === currentAgent.id && !c.referred_by);
  if (scope === 'referred') rows = rows.filter(c => c.referred_by === currentAgent.id);
  if (!rows.length){ showToast('אין לקוחות לייצוא בבחירה הזו'); return; }

  let XLSX;
  try { XLSX = await loadImportLib(); }
  catch (err){ showToast(heErr(err)); return; }

  const team = await expLoadTeam();
  const names = Object.fromEntries(team.map(m => [m.id, m.display_name || '']));
  const maps = clientIoWordMaps();
  const headers = [
    ...CLIENT_IO_FIELDS.map(f => f.label),
    'סוכן/ת מטפל/ת', 'הפנייה', 'נמסר על ידי', 'תאריך הפנייה', 'תאריך הוספה', 'עודכן לאחרונה',
  ];
  const data = rows.map(c => [
    ...CLIENT_IO_FIELDS.map(f => clientIoCell(c, f.key, maps)),
    names[c.agent_id] || '',
    expYesNo(!!c.referred_by),
    c.referred_by ? (names[c.referred_by] || '') : '',
    expDate(c.referred_at),
    expDate(c.created_at),
    expDate(c.updated_at),
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  sheet['!cols'] = headers.map(h => ({ wch: h === 'הערות' || h === 'מאפיינים נדרשים' ? 42 : 16 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'לקוחות');
  XLSX.writeFile(book, expFileName(scope === 'referred' ? 'לקוחות בהפנייה' : 'קובץ הלקוחות'));
  showToast(`${plural(rows.length, 'לקוח/ה אחד/ת ירד/ה', 'לקוחות ירדו')} לקובץ`);
}

function openClientExport(){
  if (!officeIsManager()){ showToast('ייצוא קובץ הלקוחות זמין למנהל/ת המשרד בלבד'); return; }
  const referred = clientRows.filter(c => c.referred_by === currentAgent.id).length;
  const own = clientRows.filter(c => c.agent_id === currentAgent.id && !c.referred_by).length;
  const modal = document.getElementById('ciModal');
  modal.style.display = 'flex';
  document.getElementById('ciTitle').textContent = 'ייצוא קובץ הלקוחות לאקסל';
  document.getElementById('ciBody').innerHTML =
    '<div class="field"><label for="cxScope">אילו לקוחות לייצא</label>' +
    '<select id="cxScope">' +
      `<option value="all">כל מה שבקובץ שלי (${clientRows.length})</option>` +
      `<option value="own">רק הלקוחות שלי (${own})</option>` +
      `<option value="referred">רק לקוחות שמסרתי בהפנייה (${referred})</option>` +
    '</select></div>' +
    '<p class="imp-note">הקובץ בנוי במבנה של ייבוא הלקוחות, ואפשר להעלות אותו בחזרה. ' +
    'הוא כולל פרטים אישיים של לקוחות (טלפון, מייל, ת.ז.) - שמרו אותו בהתאם.</p>';
  document.getElementById('ciFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-cx="close">ביטול</button>' +
    '<button type="button" class="btn btn-gold" data-cx="export">הורדת הקובץ</button>';
}

/* ---------- ייבוא: לכל סוכן/ת ----------
   ‏Excel או CSV, עד 500 שורות. עמודות מזוהות לפי שם (CLIENT_IO_FIELDS),
   ומי שכבר בקובץ לפי תשע ספרות אחרונות של הטלפון - אותה השוואה של
   ייבוא אנשי הקשר - לא נכנס/ת פעמיים.

   סטטוס בלי עמודה: "מחפש/ת" כשיש בשורה דרישה כלשהי, אחרת "בהמתנה".
   לקוח/ה בלי דרישות מתאים/ה לכל נכס (שדה ריק = לא משנה), ומאה כאלה
   היו מציפים את ההתאמות - אותו כלל כמו בייבוא אנשי הקשר. */

const CLIENT_IMPORT_MAX = 500;
let clientImportState = null;

async function clientReadMatrix(file){
  const XLSX = await loadImportLib();
  const buffer = await file.arrayBuffer();
  let book;
  if (/\.csv$/i.test(file.name)){
    // ‏CSV שנשמר מאקסל בעברית יוצא ב-Windows-1255 - כמו באשף ייבוא הנכסים
    let text;
    try { text = new TextDecoder('utf-8', { fatal:true }).decode(buffer); }
    catch (e){ text = new TextDecoder('windows-1255').decode(buffer); }
    book = XLSX.read(text.replace(/^﻿/, ''), { type:'string', raw:false });
  } else {
    book = XLSX.read(buffer, { type:'array', cellDates:true });
  }
  const sheetName = book.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header:1, blankrows:false, defval:'' });
}

function clientMapHeaders(headers){
  const byName = Object.create(null);
  CLIENT_IO_FIELDS.forEach(f => {
    [f.label, ...(f.syn || [])].forEach(n => { const k = impNorm(n); if (!(k in byName)) byName[k] = f.key; });
  });
  const mapping = {};   // key → אינדקס עמודה
  headers.forEach((h, i) => {
    const key = byName[impNorm(h)];
    if (key && !(key in mapping)) mapping[key] = i;
  });
  return mapping;
}

function clientSplitList(v){
  return impText(v).split(/\s*[,;|\n]\s*|\s+\/\s+/).map(s => s.trim()).filter(Boolean);
}

function clientRowToPayload(r, mapping, maps){
  const get = key => (key in mapping ? r[mapping[key]] : '');
  const p = {};
  const warn = [];
  const txt = key => impText(get(key)) || null;

  p.full_name = txt('full_name');
  const phoneRaw = txt('phone');
  p.phone = phoneRaw ? (window.ContactImport ? window.ContactImport.normPhone(phoneRaw) : phoneRaw) : null;
  p.email = txt('email');
  p.id_number = txt('id_number');
  p.address = txt('address');
  p.notes = txt('notes');
  if (!p.full_name && !p.phone) return null;
  if (!p.full_name) p.full_name = p.phone;

  ['client_kind', 'deal_type', 'category', 'status', 'financing_status', 'lead_source'].forEach(key => {
    const raw = impText(get(key));
    if (!raw) return;
    const code = maps[key].toCode[impNorm(raw)];
    if (code) p[key] = code; else warn.push(`"${raw}" לא זוהה בעמודה ${CLIENT_IO_FIELDS.find(f => f.key === key).label}`);
  });

  CLIENT_IO_NUMERIC.forEach(key => {
    const n = impNumber(get(key));
    if (n != null && n >= 0) p[key] = n;
  });
  // תקציב במיליונים ("1.8") - מתורגם לשקלים, אחרת כל נכס היה מעליו
  ['min_price', 'max_price'].forEach(key => { if (p[key] && p[key] < 100) p[key] = Math.round(p[key] * 1e6); });
  ['min_rooms', 'max_rooms', 'min_size_sqm', 'max_size_sqm'].forEach(key => { if (p[key] === 0) delete p[key]; });
  if (p.min_price != null && p.max_price != null && p.min_price > p.max_price){
    [p.min_price, p.max_price] = [p.max_price, p.min_price];
  }
  if (p.min_rooms != null && p.max_rooms != null && p.min_rooms > p.max_rooms){
    [p.min_rooms, p.max_rooms] = [p.max_rooms, p.min_rooms];
  }
  if (p.min_size_sqm != null && p.max_size_sqm != null && p.min_size_sqm > p.max_size_sqm){
    [p.min_size_sqm, p.max_size_sqm] = [p.max_size_sqm, p.min_size_sqm];
  }
  if (p.max_floor != null) p.max_floor = Math.round(p.max_floor);

  p.cities = clientSplitList(get('cities'));
  p.property_types = clientSplitList(get('property_types'));
  const fmap = impFeatureMap();
  p.required_features = [];
  clientSplitList(get('required_features')).forEach(label => {
    const code = fmap[impNorm(label)];
    if (code){ if (!p.required_features.includes(code)) p.required_features.push(code); }
    else warn.push(`המאפיין "${label}" לא זוהה`);
  });

  if (!p.status){
    const hasNeeds = p.cities.length || p.property_types.length || p.min_price != null || p.max_price != null
      || p.min_rooms != null || p.min_size_sqm != null || p.max_size_sqm != null;
    p.status = hasNeeds ? 'active' : 'paused';
  }
  Object.keys(p).forEach(k => { if (p[k] === null) delete p[k]; });
  return { payload: p, warn };
}

function clientFindExisting(p, seen){
  const CI = window.ContactImport;
  const key = p.phone && CI ? CI.phoneKey(p.phone) : '';
  if (key.length === 9){
    if (seen.has('p:' + key)) return 'file';
    seen.add('p:' + key);
    return clientRows.some(c => CI.phoneKey(c.phone) === key) ? 'crm' : '';
  }
  const n = String(p.full_name || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (seen.has('n:' + n)) return 'file';
  seen.add('n:' + n);
  return clientRows.some(c => String(c.full_name || '').replace(/\s+/g, ' ').trim().toLowerCase() === n) ? 'crm' : '';
}

function openClientImport(){
  const modal = document.getElementById('ciModal');
  modal.style.display = 'flex';
  document.getElementById('ciTitle').textContent = 'ייבוא לקוחות מאקסל';
  document.getElementById('ciBody').innerHTML =
    '<p class="imp-note" style="margin:0 0 12px">קובץ Excel ‏(xlsx/xls) או CSV, עד ' + CLIENT_IMPORT_MAX + ' שורות. ' +
    'השורה הראשונה היא כותרות העמודות. חובה: שם או טלפון. כל השאר - עיר, תקציב, חדרים, סוג נכס - רשות, ' +
    'ומה שיוזן יתחיל מיד לעבוד במנוע ההתאמות.</p>' +
    '<div class="ci-src">' +
      '<button type="button" class="btn btn-gold" data-cx="pick">📄 בחירת קובץ</button>' +
      '<button type="button" class="btn btn-ghost" data-cx="template">📥 הורדת תבנית ריקה</button>' +
    '</div>' +
    '<p class="imp-note" style="margin:12px 0 0">העמודות שמזוהות: ' +
      escapeHtml(CLIENT_IO_FIELDS.map(f => f.label).join(' · ')) +
      '. גם שמות מקובלים אחרים ("שם", "נייד", "תקציב", "עיר") מזוהים. מי שכבר בקובץ לפי הטלפון לא ייכנס פעמיים.</p>' +
    '<p class="imp-note" id="cxStatus" style="margin:10px 0 0"></p>';
  document.getElementById('ciFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-cx="close">סגירה</button>';
}

async function downloadClientTemplate(){
  let XLSX;
  try { XLSX = await loadImportLib(); }
  catch (err){ showToast(heErr(err)); return; }
  const example = {
    full_name:'ישראל ישראלי', phone:'050-1234567', status:'מחפש/ת', deal_type:'קנייה', category:'מגורים',
    cities:'עפולה, נצרת עילית', property_types:'דירה', max_price:1800000, min_rooms:4,
    financing_status: CLIENT_FINANCING_LABELS.approved, notes:'שורה לדוגמה - למחוק לפני הייבוא',
  };
  const sheet = XLSX.utils.aoa_to_sheet([
    CLIENT_IO_FIELDS.map(f => f.label),
    CLIENT_IO_FIELDS.map(f => example[f.key] ?? ''),
  ]);
  sheet['!cols'] = CLIENT_IO_FIELDS.map(() => ({ wch: 16 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'לקוחות');
  XLSX.writeFile(book, 'תבנית ייבוא לקוחות.xlsx');
}

async function readClientImportFile(file){
  const status = document.getElementById('cxStatus');
  const fail = msg => { if (status){ status.style.color = 'var(--brick)'; status.textContent = msg; } };
  if (file.size > 5 * 1024 * 1024) return fail('הקובץ גדול מ-5MB. פצלו אותו לקבצים קטנים יותר.');
  if (status){ status.style.color = ''; status.textContent = 'קורא את הקובץ…'; }

  let matrix;
  try { matrix = await clientReadMatrix(file); }
  catch (err){ return fail('לא הצלחנו לקרוא את הקובץ: ' + (err && heErr(err) || 'פורמט לא נתמך')); }
  if (!matrix.length) return fail('הגיליון ריק');

  const headers = (matrix[0] || []).map(h => impText(h));
  const mapping = clientMapHeaders(headers);
  if (!('full_name' in mapping) && !('phone' in mapping)){
    return fail('לא נמצאה עמודת שם או טלפון בשורה הראשונה. הורידו את התבנית ובדקו את שמות העמודות.');
  }
  const dataRows = matrix.slice(1).filter(r => r.some(cell => impText(cell) !== ''));
  if (!dataRows.length) return fail('לא נמצאו שורות מתחת לשורת הכותרות');
  if (dataRows.length > CLIENT_IMPORT_MAX){
    return fail(`בקובץ ${dataRows.length} שורות - המקסימום הוא ${CLIENT_IMPORT_MAX}. פצלו אותו לכמה קבצים.`);
  }

  const maps = clientIoWordMaps();
  const seen = new Set();
  const fresh = [], dupCrm = [], dupFile = [], warnings = [];
  let empty = 0;
  dataRows.forEach((r, i) => {
    const parsed = clientRowToPayload(r, mapping, maps);
    if (!parsed){ empty++; return; }
    const dup = clientFindExisting(parsed.payload, seen);
    if (dup === 'crm') dupCrm.push(parsed.payload);
    else if (dup === 'file') dupFile.push(parsed.payload);
    else fresh.push(parsed.payload);
    parsed.warn.forEach(w => warnings.push(`שורה ${i + 2}: ${w}`));
  });

  clientImportState = { fresh, fileName: file.name };
  const recognized = CLIENT_IO_FIELDS.filter(f => f.key in mapping).map(f => `${f.label} ← "${headers[mapping[f.key]]}"`);
  const ignored = headers.filter((h, i) => h && !Object.values(mapping).includes(i));
  const paused = fresh.filter(p => p.status === 'paused').length;

  document.getElementById('ciTitle').textContent = 'בדיקה לפני הייבוא';
  document.getElementById('ciBody').innerHTML =
    `<p style="margin:0 0 8px"><b>${escapeHtml(file.name)}</b></p>` +
    '<ul class="imp-note" style="margin:0 0 10px;padding-inline-start:18px">' +
      `<li><b>${fresh.length}</b> לקוחות חדשים ייכנסו לקובץ${paused ? ` (${paused} מהם בסטטוס "בהמתנה" - בלי דרישות חיפוש)` : ''}</li>` +
      (dupCrm.length ? `<li>${dupCrm.length} כבר בקובץ הלקוחות - ידולגו</li>` : '') +
      (dupFile.length ? `<li>${dupFile.length} מופיעים בקובץ פעמיים - ייכנסו פעם אחת</li>` : '') +
      (empty ? `<li>${empty} שורות בלי שם וטלפון - ידולגו</li>` : '') +
    '</ul>' +
    '<p class="imp-note" style="margin:0 0 6px"><b>עמודות שזוהו:</b> ' + escapeHtml(recognized.join(' · ')) + '</p>' +
    (ignored.length ? '<p class="imp-note" style="margin:0 0 6px"><b>לא ייובאו:</b> ' + escapeHtml(ignored.join(' · ')) + '</p>' : '') +
    (warnings.length
      ? '<details class="imp-note" style="margin-top:8px"><summary>' + warnings.length + ' ערכים שלא זוהו (השורה תיכנס בלעדיהם)</summary>' +
        '<div style="max-height:160px;overflow:auto">' + warnings.slice(0, 200).map(w => escapeHtml(w)).join('<br>') + '</div></details>'
      : '');
  document.getElementById('ciFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-cx="restart">קובץ אחר</button>' +
    `<button type="button" class="btn btn-gold" data-cx="save"${fresh.length ? '' : ' disabled'}>ייבוא ${fresh.length} לקוחות</button>`;
}

async function saveClientImport(btn){
  const rows = clientImportState && clientImportState.fresh || [];
  if (!rows.length || !currentAgent) return;
  if (btn){ btn.disabled = true; btn.textContent = 'מייבא…'; }
  let added = 0, failed = '';
  for (let i = 0; i < rows.length; i += 200){
    const chunk = rows.slice(i, i + 200).map(p => ({ ...p, agent_id: currentAgent.id, agency_id: currentAgent.agency_id }));
    const { error } = await sb.from('agent_clients').insert(chunk);
    if (error){ failed = heErr(error); break; }
    added += chunk.length;
  }
  document.getElementById('ciModal').style.display = 'none';
  clientImportState = null;
  showToast(failed ? `נוספו ${added}. שגיאה בהמשך: ${failed}` : `${plural(added, 'לקוח/ה אחד/ת נוסף/ה', 'לקוחות נוספו')} לקובץ`, failed ? 6000 : 3200);
  await loadClients();
}

// ‏ciModal משותף עם ייבוא אנשי הקשר; הפעולות כאן מסומנות data-cx ולכן
// אינן מתנגשות במאזין של crm.js, שמטפל רק ב-data-ci
document.getElementById('ciModal').addEventListener('click', async e => {
  const btn = e.target.closest('[data-cx]');
  if (!btn) return;
  const act = btn.dataset.cx;
  if (act === 'close'){ document.getElementById('ciModal').style.display = 'none'; clientImportState = null; return; }
  if (act === 'pick' || act === 'restart'){
    if (act === 'restart') openClientImport();
    document.getElementById('cxFile').click();
    return;
  }
  if (act === 'template') return downloadClientTemplate();
  if (act === 'save') return saveClientImport(btn);
  if (act === 'export'){
    const scope = document.getElementById('cxScope').value;
    document.getElementById('ciModal').style.display = 'none';
    return exportClientsFile(scope);
  }
});
document.getElementById('cxFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await readClientImportFile(file);
});
document.getElementById('openClientImport').addEventListener('click', openClientImport);
document.getElementById('openClientExport').addEventListener('click', openClientExport);

/* ==========================================================================
   מסירה מרובה - כמה לקוחות או כמה נכסים בבת אחת. מנהל/ת משרד בלבד.

   חלון אחד לשני הסוגים: רשימה עם תיבות סימון, חיפוש, סינון ובחירת
   סוכן/ת. מה שמשתנה בין הסוגים - מאיפה השורות, איך הן נראות, ואיזו
   פונקציה במסד מעבירה אותן - יושב ב-BULK_REFER_KINDS.

   ‏refer_clients_to_agent() (‏20270130090000) ו-refer_properties_to_agent()
   (‏20270131090000) בודקות כל שורה בעצמן ושולחות לסוכן/ת התראה אחת.

   נכסים: כל נכסי המשרד ולא רק "הנכסים שלי" - מנהל/ת רואה/ה ממילא את
   כולם (ה-RLS על properties), וזה בדיוק המצב שבו מחלקים מלאי מחדש, למשל
   כשסוכן/ת עוזב/ת. הם נשלפים כאן בדפים, בעמודות שהחלון צריך בלבד.
   ========================================================================== */

const BULK_REFER_LIST_MAX = 300;
let bulkRefer = null;   // { kind, rows, checked:Set, query, scope }

const BULK_PROPERTY_COLUMNS =
  'id, listing_number, title, city, street, house_number, property_type, deal_type, status, price, agent_id, referred_by, license_hold_at';

async function bulkFetchAgencyProperties(){
  const rows = [];
  for (let page = 0; page < 20; page++){
    const { data, error } = await sb.from('properties')
      .select(BULK_PROPERTY_COLUMNS)
      .eq('agency_id', currentAgent.agency_id)
      .order('created_at', { ascending:false })
      .order('id', { ascending:true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const BULK_REFER_KINDS = {
  client: {
    title: 'מסירת לקוחות לסוכן/ת',
    searchPh: 'חיפוש לפי שם, טלפון, עיר או סוג נכס',
    scopes: [['own','שלי, שעוד לא נמסרו'],['referred','שכבר מסרתי'],['all','הכול']],
    note: 'כל לקוח/ה שנמסר/ה מסומן/ת "הפנייה" ומשותף/ת לך ולסוכן/ת. הסוכן/ת מקבל/ת התראה אחת על כולם.',
    empty: 'אין בקובץ שלך לקוחות למסירה',
    none: 'אין לקוחות שמתאימים לחיפוש.',
    count: n => n === 1 ? 'מסירת לקוח/ה אחד/ת' : `מסירת ${n} לקוחות`,
    pick: 'סמנו לקוחות למסירה',
    rpc: 'refer_clients_to_agent',
    moved: ['לקוח/ה אחד/ת נמסר/ה', 'לקוחות נמסרו'],
    back: ['לקוח/ה אחד/ת חזר/ה', 'לקוחות חזרו'],
    load: async () => clientRows.filter(c => c.agent_id === currentAgent.id || c.referred_by === currentAgent.id),
    reload: () => loadClients(),
    name: c => c.full_name || c.phone || '-',
    meta: c => [c.phone, clientTabSub(c)],
    blob: c => clientSearchBlob(c) + ' ' + String(c.phone || '').replace(/\D/g, ''),
    isOwn: c => c.agent_id === currentAgent.id && !c.referred_by,
  },
  property: {
    title: 'מסירת נכסים לסוכן/ת',
    searchPh: 'חיפוש לפי כתובת, עיר, מספר מודעה או סוכן/ת',
    scopes: [['own','הנכסים שלי'],['referred','שכבר מסרתי'],['all','כל נכסי המשרד']],
    note: 'כל נכס שנמסר מסומן "הפנייה" ומשותף לך ולסוכן/ת המטפל/ת. הסוכן/ת מקבל/ת התראה אחת על כולם.',
    empty: 'אין במשרד נכסים למסירה',
    none: 'אין נכסים שמתאימים לחיפוש.',
    count: n => n === 1 ? 'מסירת נכס אחד' : `מסירת ${n} נכסים`,
    pick: 'סמנו נכסים למסירה',
    rpc: 'refer_properties_to_agent',
    moved: ['נכס אחד נמסר', 'נכסים נמסרו'],
    back: ['נכס אחד חזר', 'נכסים חזרו'],
    load: async () => {
      const rows = await bulkFetchAgencyProperties();
      // שמות כל הצוות, לא רק מי שבהפנייה - בנכסים המטפל/ת הוא/היא חלק מהשורה
      if (typeof ensureColleaguesLoaded === 'function'){ try { await ensureColleaguesLoaded(); } catch (e) { /* */ } }
      return rows;
    },
    reload: () => loadProperties(currentAgent.id),
    name: p => [p.property_type || 'נכס', [p.street, p.house_number].filter(Boolean).join(' '), p.city]
      .filter(Boolean).join(', ') || p.title || '-',
    meta: p => [
      p.listing_number != null ? 'מודעה #' + p.listing_number : '',
      // ‏propertyStatusLabel מ-crm.js: "ממתין לאישור רישיון" לנכס שמחכה לרישיון
      (typeof propertyStatusLabel === 'function' ? propertyStatusLabel(p)
        : (typeof PROPERTY_STATUS_LABELS !== 'undefined' && PROPERTY_STATUS_LABELS[p.status]) || p.status),
      p.agent_id !== currentAgent.id ? 'אצל ' + (officeMemberName(p.agent_id) || 'סוכן/ת') : '',
    ],
    blob: p => [p.title, p.city, p.street, p.house_number, p.property_type, p.listing_number,
      officeMemberName(p.agent_id)].filter(v => v != null).join(' ').toLowerCase(),
    isOwn: p => p.agent_id === currentAgent.id && !p.referred_by,
  },
};

function bulkReferVisible(){
  const cfg = BULK_REFER_KINDS[bulkRefer.kind];
  const q = String(bulkRefer.query || '').trim().toLowerCase();
  return bulkRefer.rows.filter(r => {
    if (bulkRefer.scope === 'own' && !cfg.isOwn(r)) return false;
    if (bulkRefer.scope === 'referred' && r.referred_by !== currentAgent.id) return false;
    return !q || cfg.blob(r).includes(q);
  });
}

async function openBulkRefer(kind){
  const cfg = BULK_REFER_KINDS[kind];
  if (!officeIsManager()){ showToast('מסירה בהפנייה זמינה למנהל/ת המשרד בלבד'); return; }

  const modal = document.getElementById('ciModal');
  modal.style.display = 'flex';
  document.getElementById('ciTitle').textContent = cfg.title;
  document.getElementById('ciBody').innerHTML = '<div class="empty-state">טוען…</div>';
  document.getElementById('ciFoot').innerHTML = '';

  let rows;
  try { rows = await cfg.load(); }
  catch (err){ modal.style.display = 'none'; showToast('הטעינה נכשלה: ' + heErr(err), 6000); return; }
  if (!rows.length){ modal.style.display = 'none'; showToast(cfg.empty); return; }
  await officePreloadNames(rows);
  bulkRefer = { kind, rows, checked: new Set(), query: '', scope: 'own' };
  // אין בכלל שורות "שלי" (נכסים אצל מנהל/ת שלא מפרסם/ת בעצמו/ה) - פותחים על הכול
  if (!rows.some(cfg.isOwn)) bulkRefer.scope = 'all';

  document.getElementById('ciBody').innerHTML =
    '<div class="field"><label for="brAgent">למי למסור</label><select id="brAgent" disabled>' +
      '<option value="">טוען את הצוות…</option></select></div>' +
    '<div class="ci-tools">' +
      `<input type="search" id="brSearch" class="filter-input" placeholder="${escapeHtml(cfg.searchPh)}" autocomplete="off">` +
      '<select id="brScope" class="filter-input" style="flex:0 0 auto;width:auto">' +
        cfg.scopes.map(([v, t]) => `<option value="${v}"${v === bulkRefer.scope ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('') +
      '</select>' +
    '</div>' +
    '<div class="ci-tools" style="margin-top:6px">' +
      '<button type="button" class="btn btn-ghost" data-br="all" style="padding:6px 12px">סימון המוצגים</button>' +
      '<button type="button" class="btn btn-ghost" data-br="none" style="padding:6px 12px">ניקוי הסימון</button>' +
    '</div>' +
    '<div class="ci-list" id="brList"></div>' +
    `<p class="imp-note" style="margin:10px 0 0">${escapeHtml(cfg.note)}</p>`;
  bulkReferRender();

  document.getElementById('brSearch').addEventListener('input', e => { bulkRefer.query = e.target.value; bulkReferRender(); });
  document.getElementById('brScope').addEventListener('change', e => { bulkRefer.scope = e.target.value; bulkReferRender(); });
  document.getElementById('brAgent').addEventListener('change', bulkReferFoot);

  const team = (await expLoadTeam()).filter(m => m.active && m.id !== currentAgent.id);
  const sel = document.getElementById('brAgent');
  if (!sel || !bulkRefer) return;   // החלון נסגר בזמן הטעינה
  sel.innerHTML = '<option value="">בחירת סוכן/ת</option>' +
    team.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name || 'ללא שם')}</option>`).join('') +
    `<option value="${escapeHtml(currentAgent.id)}">${kind === 'property' ? 'אליי (לקחת לטיפולי)' : 'החזרה אליי (ביטול ההפנייה)'}</option>`;
  sel.disabled = false;
  bulkReferFoot();
}

function bulkReferRender(){
  const list = document.getElementById('brList');
  if (!list || !bulkRefer) return;
  const cfg = BULK_REFER_KINDS[bulkRefer.kind];
  const shown = bulkReferVisible();
  list.innerHTML = shown.slice(0, BULK_REFER_LIST_MAX).map(r => {
    const i = bulkRefer.rows.indexOf(r);
    const handler = r.referred_by && bulkRefer.kind === 'client' ? officeMemberName(r.agent_id) : '';
    const meta = [...cfg.meta(r), r.referred_by ? '🤝 הפנייה' + (handler ? ' · בטיפול ' + handler : '') : '']
      .filter(Boolean).join(' · ');
    return '<label class="ci-row">' +
      `<input type="checkbox" data-bulk-i="${i}"${bulkRefer.checked.has(r.id) ? ' checked' : ''}>` +
      '<span style="flex:1;min-width:0">' +
        `<span class="ci-name">${escapeHtml(cfg.name(r))}</span>` +
        (meta ? `<div class="ci-meta">${escapeHtml(meta)}</div>` : '') +
      '</span></label>';
  }).join('') || `<div class="empty-state">${escapeHtml(cfg.none)}</div>`;
  if (shown.length > BULK_REFER_LIST_MAX){
    list.insertAdjacentHTML('beforeend',
      `<div class="empty-state">מוצגים ${BULK_REFER_LIST_MAX} מתוך ${shown.length} - חפשו כדי לצמצם</div>`);
  }
  bulkReferFoot();
}

function bulkReferFoot(){
  if (!bulkRefer) return;
  const cfg = BULK_REFER_KINDS[bulkRefer.kind];
  const n = bulkRefer.checked.size;
  const agent = document.getElementById('brAgent');
  const ready = n && agent && agent.value;
  document.getElementById('ciFoot').innerHTML =
    '<button type="button" class="btn btn-ghost" data-br="close">ביטול</button>' +
    `<button type="button" class="btn btn-gold" data-br="run"${ready ? '' : ' disabled'}>` +
      escapeHtml(n ? cfg.count(n) : cfg.pick) + '</button>';
}

async function runBulkRefer(btn){
  const cfg = BULK_REFER_KINDS[bulkRefer.kind];
  const agentId = document.getElementById('brAgent').value;
  const ids = [...bulkRefer.checked];
  if (!agentId || !ids.length) return;
  btn.disabled = true;
  btn.textContent = 'מוסר…';
  const { data, error } = await sb.rpc(cfg.rpc, { p_ids: ids, p_agent_id: agentId });
  if (error || !data || data.ok === false){
    btn.disabled = false;
    bulkReferFoot();
    showToast('המסירה נכשלה: ' + heErr((data && data.error) || error), 6000);
    return;
  }
  document.getElementById('ciModal').style.display = 'none';
  bulkRefer = null;
  const skipped = data.skipped ? ` (${data.skipped} כבר היו אצלו/ה או אינם שלך)` : '';
  showToast(data.returned
    ? `${plural(data.moved, cfg.back[0], cfg.back[1])} אליך${skipped}`
    : `${plural(data.moved, cfg.moved[0], cfg.moved[1])} ל${data.agent_name || 'סוכן/ת'}${skipped}`, 5000);
  await cfg.reload();
}

document.getElementById('ciModal').addEventListener('change', e => {
  const i = e.target.dataset && e.target.dataset.bulkI;
  if (i == null || !bulkRefer) return;
  const r = bulkRefer.rows[Number(i)];
  if (e.target.checked) bulkRefer.checked.add(r.id); else bulkRefer.checked.delete(r.id);
  bulkReferFoot();
});
document.getElementById('ciModal').addEventListener('click', e => {
  const btn = e.target.closest('[data-br]');
  if (!btn || !bulkRefer) return;
  const act = btn.dataset.br;
  if (act === 'close'){ document.getElementById('ciModal').style.display = 'none'; bulkRefer = null; return; }
  if (act === 'all'){ bulkReferVisible().slice(0, BULK_REFER_LIST_MAX).forEach(r => bulkRefer.checked.add(r.id)); return bulkReferRender(); }
  if (act === 'none'){ bulkRefer.checked.clear(); return bulkReferRender(); }
  if (act === 'run') return runBulkRefer(btn);
});
document.getElementById('openBulkRefer').addEventListener('click', () => openBulkRefer('client'));
document.getElementById('openBulkReferProperties').addEventListener('click', () => openBulkRefer('property'));

/* כפתורי הייצוא מוצגים למנהל/ת משרד בלבד. ‏style.display ולא hidden: אין
   בדף כלל ‎[hidden]{display:none !important}‎, ו-.btn מגדיר display משלו.
   נקרא מ-loadDashboard בכל טעינה, כדי שהחלפת תפקיד תסתיר גם אותם. */
function syncOfficeExportButtons(){
  const show = officeIsManager();
  // ‏propMoreMenu - תפריט "⋯ עוד" שבראש "הנכסים שלי", שמחזיק רק את שתי
  // הפעולות האלה; לסוכן/ת הוא היה נפתח ריק
  ['openExportProperties', 'openClientExport', 'openBulkRefer', 'openBulkReferProperties', 'propMoreMenu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
}
