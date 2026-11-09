/* ==========================================================================
   טיוטות תיאור לדפי השכונות - אישור ועריכה (שלב 8 בשדרוג האדמין, חלק ב)
   --------------------------------------------------------------------------
   ‏neighborhood-describe כותבת פעם בשבוע טיוטה ל-10 שכונות. **טיוטה אינה
   מתפרסמת**: היא מחכה כאן (וגם בתיבת המשימות, ‏hood_draft), ומנהל/ת הפלטפורמה
   עורך/ת ומאשר/ת או דוחה. מה שנשמר באישור הוא מה שבתיבות הטקסט, אחרי ניקוי
   במסד (‏admin_hood_draft_decide). ‏docs/neighborhood-pages.md.

   נטען לפני assets/crm.js ומשתמש בגלובלים שלו (sb, esc, heErr, showToast,
   SUPABASE_URL) רק בזמן קריאה.
   ========================================================================== */

let hoodDraftsBusy = false;

async function loadHoodDrafts(){
  const host = document.getElementById('hoodDraftsBox');
  if (!host || hoodDraftsBusy) return;
  hoodDraftsBusy = true;
  const { data, error } = await sb.rpc('admin_hood_drafts');
  hoodDraftsBusy = false;
  if (error){
    // האתר עולה לפני המיגרציה (הסקיל deploy-path)
    host.innerHTML = (error.code === 'PGRST202' || error.code === '42883') ? ''
      : '<div class="empty-state">' + esc('שגיאה בטעינת הטיוטות: ' + heErr(error)) + '</div>';
    return;
  }
  const list = Array.isArray(data) ? data : [];
  host.innerHTML = '<div class="hd-head"><h4>תיאורי שכונות לאישור' + (list.length ? ' (' + list.length + ')' : '') + '</h4>'
    + '<button type="button" class="btn btn-ghost" id="hoodDraftsRun">יצירת טיוטות עכשיו</button></div>'
    + '<p class="acc-sub">טיוטה שנכתבה ב-AI מהנתונים של דף השכונה. היא לא מופיעה באתר עד שמאשרים אותה. אפשר לערוך לפני האישור.</p>'
    + (list.length ? list.map(hoodDraftHtml).join('') : '<div class="empty-state">אין טיוטות שמחכות. טיוטות חדשות נכתבות כל יום שני.</div>');
  host.querySelectorAll('[data-hd-act]').forEach(b => b.addEventListener('click', () => hoodDraftDecide(b)));
  document.getElementById('hoodDraftsRun').addEventListener('click', hoodDraftsRunNow);
}

function hoodDraftHtml(d){
  const faq = Array.isArray(d.faq) ? d.faq : [];
  while (faq.length < 3) faq.push({ q: '', a: '' });
  const url = '/n/' + encodeURIComponent(d.city_slug || '') + '/' + encodeURIComponent(d.slug || '');
  return '<div class="hd-card" data-id="' + esc(d.id) + '">'
    + '<div class="hd-title"><b>' + esc(d.name) + '</b> · ' + esc(d.city || '')
    + (d.replaces ? ' <span class="cst-tag">יחליף את התיאור הקיים</span>' : '')
    + ' <a href="' + esc(url) + '" target="_blank" rel="noopener">לדף ←</a></div>'
    + '<label>פתיחה<textarea data-f="intro" rows="6">' + esc(d.intro || '') + '</textarea></label>'
    + '<label>פתיחה קצרה, מתחת לכותרת (עד 200 תווים)<textarea data-f="hero" rows="2" maxlength="200">' + esc(d.hero_intro || '') + '</textarea></label>'
    + '<label>למי השכונה מתאימה<textarea data-f="fits" rows="3">' + esc(d.fits || '') + '</textarea></label>'
    + faq.slice(0, 3).map((f, i) => '<div class="hd-faq"><input type="text" data-q="' + i + '" value="' + esc(f.q || '') + '" placeholder="שאלה ' + (i + 1) + '" aria-label="שאלה ' + (i + 1) + '">'
      + '<textarea data-a="' + i + '" rows="2" placeholder="תשובה" aria-label="תשובה ' + (i + 1) + '">' + esc(f.a || '') + '</textarea></div>').join('')
    + '<div class="hd-acts"><button type="button" class="btn btn-gold" data-hd-act="approve">אישור ופרסום בדף</button>'
    + '<button type="button" class="btn btn-ghost" data-hd-act="reject">דחייה</button></div>'
    + '</div>';
}

async function hoodDraftDecide(btn){
  const card = btn.closest('.hd-card');
  const decision = btn.dataset.hdAct;
  if (decision === 'reject' && !confirm('לדחות את הטיוטה? השכונה תקבל טיוטה חדשה בעוד 30 יום.')) return;
  const faq = [0, 1, 2].map(i => ({
    q: card.querySelector('[data-q="' + i + '"]').value.trim(),
    a: card.querySelector('[data-a="' + i + '"]').value.trim(),
  })).filter(f => f.q && f.a);
  const hero = card.querySelector('[data-f="hero"]').value.trim();
  if (hero.length > 200){
    showToast('הפתיחה הקצרה יכולה להיות עד 200 תווים.');
    return;
  }
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const payload = {
    p_id: card.dataset.id, p_decision: decision,
    p_intro: card.querySelector('[data-f="intro"]').value,
    p_fits: card.querySelector('[data-f="fits"]').value,
    p_faq: faq,
    p_hero_intro: hero,
  };
  let { error } = await sb.rpc('admin_hood_draft_decide', payload);
  // האתר עולה לפני המיגרציה: בלי העמודה החתימה הישנה עדיין שומרת את השאר
  if (error && (error.code === 'PGRST202' || error.code === '42883')){
    delete payload.p_hero_intro;
    ({ error } = await sb.rpc('admin_hood_draft_decide', payload));
  }
  if (error){
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    showToast(/text_length/.test(error.message || '') ? 'הפתיחה צריכה להיות בין 40 ל-2,000 תווים, והפתיחה הקצרה עד 200.' : heErr(error));
    return;
  }
  showToast(decision === 'approve' ? 'התיאור פורסם בדף השכונה' : 'הטיוטה נדחתה');
  loadHoodDrafts();
}

/* הכפתור קורא לאותה פונקציה של הריצה השבועית, עם ה-JWT של מנהל/ת הפלטפורמה */
async function hoodDraftsRunNow(){
  const btn = document.getElementById('hoodDraftsRun');
  if (!confirm('לכתוב עכשיו טיוטות ל-10 שכונות? זו קריאה למודל לכל שכונה (כמה אגורות לכל אחת).')) return;
  btn.disabled = true;
  btn.textContent = 'כותב/ת טיוטות… (עד דקה וחצי)';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + '/functions/v1/neighborhood-describe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') },
      body: '{}',
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || ('http ' + res.status));
    showToast(out.drafted ? 'נכתבו ' + out.drafted + ' טיוטות' : 'אין שכונות שמחכות לטיוטה');
  } catch (e){
    showToast(heErr(e));
  }
  loadHoodDrafts();
}

(function wireHoodDrafts(){
  const acc = document.getElementById('accNeighborhoods');
  if (acc) acc.addEventListener('toggle', () => { if (acc.open) { loadHoodDrafts(); loadHoodCover(); } });
})();

/* תמונת שער וצ'יפים, ליד הטיוטות. הכתיבה ב-admin_hood_cover_set.
   לפני המיגרציה העמודות אינן קיימות, והבלוק נשאר שקט.
   אין כאן limit של 1,000 על כל הטבלה: יש יותר שכונות מזה. בוחרים עיר
   ומחפשים שם ב-ilike, ואם יש עוד תוצאות הן בעמוד הבא. */
let hoodCoverRows = [];
let hoodCoverOffset = 0;
let hoodCoverToken = 0;
let hoodCoverSession = null;
let hoodCoverBusy = false;
const HOOD_COVER_PAGE = 80;

function hoodCoverUuidOk(id){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}
function hoodCoverUuid(){
  if (crypto.randomUUID){
    const id = String(crypto.randomUUID()).toLowerCase();
    if (hoodCoverUuidOk(id)) return id;
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function hoodCoverPathOk(folder, path){
  return new RegExp('^' + folder + '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|jpeg|png|webp)$', 'i').test(path);
}

async function loadHoodCover(){
  const drafts = document.getElementById('hoodDraftsBox');
  if (!drafts || !drafts.parentNode) return;
  let host = document.getElementById('hoodCoverBox');
  if (!host){
    host = document.createElement('div');
    host.id = 'hoodCoverBox';
    drafts.parentNode.insertBefore(host, drafts.nextSibling);
  }
  const probe = await sb.from('neighborhoods').select('cover_path').limit(1);
  if (probe.error){
    host.innerHTML = (probe.error.code === '42703' || probe.error.code === 'PGRST204')
      ? ''
      : '<div class="empty-state">' + esc('שגיאה בטעינת השכונות: ' + heErr(probe.error)) + '</div>';
    return;
  }
  const cities = [];
  for (let from = 0; from < 5000; from += 1000){
    const { data, error } = await sb.from('cities').select('id,name').order('name').range(from, from + 999);
    if (error || !data || !data.length) break;
    data.forEach(r => { if (r.id && r.name) cities.push(r); });
    if (data.length < 1000) break;
  }
  host.innerHTML = '<div class="hd-head"><h4>תמונת שער לשכונה</h4></div>'
    + '<p class="acc-sub">מוצגת בראש דף השכונה. בלי תמונה הדף נשאר עם רקע כהה והכותרת. בחרו עיר, או חפשו לפי שם.</p>'
    + '<div class="hd-acts">'
    + '<select id="hoodCoverCity" aria-label="עיר"><option value="">כל הערים</option>'
    + cities.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('')
    + '</select>'
    + '<input type="search" id="hoodCoverQ" placeholder="שם שכונה" aria-label="שם שכונה">'
    + '<button type="button" class="btn btn-ghost" id="hoodCoverFind">חיפוש</button>'
    + '</div>'
    + '<p class="acc-sub" id="hoodCoverStatus"></p>'
    + '<label class="hd-card" style="display:block">שכונה'
    + '<select id="hoodCoverPick" aria-label="שכונה לתמונת שער"></select></label>'
    + '<div id="hoodCoverForm"></div>';
  document.getElementById('hoodCoverFind').addEventListener('click', () => hoodCoverSearch(true));
  document.getElementById('hoodCoverCity').addEventListener('change', () => hoodCoverSearch(true));
  document.getElementById('hoodCoverQ').addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); hoodCoverSearch(true); }
  });
  document.getElementById('hoodCoverPick').addEventListener('change', hoodCoverForm);
}

async function hoodCoverSearch(reset){
  const status = document.getElementById('hoodCoverStatus');
  if (!reset && (hoodCoverBusy || !hoodCoverSession)) return;
  if (reset){
    const cityId = (document.getElementById('hoodCoverCity').value || '').trim();
    const q = (document.getElementById('hoodCoverQ').value || '').trim().replace(/[%_*,]/g, '');
    if (!cityId && q.length < 2){
      if (status) status.textContent = 'בחרו עיר, או הקלידו לפחות שתי אותיות מהשם.';
      return;
    }
    hoodCoverOffset = 0;
    hoodCoverToken += 1;
    hoodCoverSession = { cityId: cityId, q: q, token: hoodCoverToken };
  }
  const session = hoodCoverSession;
  const token = session.token;
  const from = hoodCoverOffset;
  hoodCoverBusy = true;
  let query = sb.from('neighborhoods').select('id,name,city,city_id,cover_path,cover_alt,cover_credit,poi');
  if (session.cityId) query = query.eq('city_id', session.cityId);
  if (session.q) query = query.ilike('name', '%' + session.q + '%');
  const { data, error } = await query.order('name').order('id').range(from, from + HOOD_COVER_PAGE - 1);
  if (token !== hoodCoverToken) return;
  hoodCoverBusy = false;
  if (error){
    if (status) status.textContent = (error.code === '42703' || error.code === 'PGRST204')
      ? '' : 'שגיאה בטעינת השכונות: ' + heErr(error);
    return;
  }
  const page = Array.isArray(data) ? data : [];
  hoodCoverRows = reset ? page : hoodCoverRows.concat(page);
  hoodCoverOffset += page.length;
  const pick = document.getElementById('hoodCoverPick');
  const prev = pick.value;
  pick.innerHTML = hoodCoverRows.map(r => '<option value="' + esc(r.id) + '">' + esc((r.city || '') + ' · ' + (r.name || '')) + '</option>').join('');
  if (hoodCoverRows.some(r => r.id === prev)) pick.value = prev;
  const more = page.length === HOOD_COVER_PAGE
    ? ' <button type="button" class="btn btn-ghost" id="hoodCoverMore">עוד שכונות</button>' : '';
  if (status) status.innerHTML = (hoodCoverRows.length ? 'מוצגות ' + hoodCoverRows.length + ' שכונות.' : 'אין שכונה שמתאימה.') + more;
  const moreBtn = document.getElementById('hoodCoverMore');
  if (moreBtn) moreBtn.addEventListener('click', () => hoodCoverSearch(false));
  hoodCoverForm();
}

function hoodCoverLines(v){
  return String(v || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
}

function hoodCoverForm(){
  const form = document.getElementById('hoodCoverForm');
  const pick = document.getElementById('hoodCoverPick');
  if (!form || !pick) return;
  const row = hoodCoverRows.find(r => r.id === pick.value) || {};
  const poi = row.poi && typeof row.poi === 'object' ? row.poi : {};
  const lines = k => (Array.isArray(poi[k]) ? poi[k] : []).join('\n');
  const credit = row.cover_credit && typeof row.cover_credit === 'object' ? row.cover_credit : {};
  const preview = row.cover_path
    ? '<img class="hd-cover-prev" alt="" src="' + esc('https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/neighborhood-covers/' + row.cover_path) + '">'
    : '<p class="acc-sub">אין תמונת שער.</p>';
  form.innerHTML = preview
    + '<label>קובץ תמונה<input type="file" id="hoodCoverFile" accept="image/jpeg,image/png,image/webp"></label>'
    + '<label>טקסט חלופי<input type="text" id="hoodCoverAlt" maxlength="180" value="' + esc(row.cover_alt || '') + '"></label>'
    + '<label>צלם/ת, לא חובה<input type="text" id="hoodCoverCredit" maxlength="80" value="' + esc(credit.author || '') + '"></label>'
    + '<label>רישיון, לא חובה<input type="text" id="hoodCoverLicense" maxlength="80" value="' + esc(credit.license || '') + '"></label>'
    + '<label>קישור לרישיון, לא חובה<input type="url" id="hoodCoverUrl" maxlength="300" dir="ltr" value="' + esc(credit.url || '') + '" placeholder="https://"></label>'
    + '<label>פארקים, שורה לכל מקום<textarea id="hoodCoverParks" rows="2">' + esc(lines('parks')) + '</textarea></label>'
    + '<label>תחבורה, שורה לכל מקום<textarea id="hoodCoverTransport" rows="2">' + esc(lines('transport')) + '</textarea></label>'
    + '<label>חינוך, שורה לכל מקום<textarea id="hoodCoverEducation" rows="2">' + esc(lines('education')) + '</textarea></label>'
    + '<label>פנאי, שורה לכל מקום<textarea id="hoodCoverLeisure" rows="2">' + esc(lines('leisure')) + '</textarea></label>'
    + '<div class="hd-acts"><button type="button" class="btn btn-gold" id="hoodCoverSave">שמירת שער</button>'
    + '<button type="button" class="btn btn-ghost" id="hoodCoverClear">הסרת התמונה</button></div>';
  document.getElementById('hoodCoverSave').addEventListener('click', () => hoodCoverSave(false));
  document.getElementById('hoodCoverClear').addEventListener('click', () => hoodCoverSave(true));
}

/* remove() בלי SELECT על הדלי מחזיר הצלחה ריקה והקובץ נשאר. כשל לא מבטל שמירה. */
async function hoodCoverRemove(path){
  if (!path) return true;
  try {
    const res = await sb.storage.from('neighborhood-covers').remove([path]);
    if (!res || res.error || !res.data || !res.data.length){
      console.error('hood cover remove failed', path, res && res.error);
      return false;
    }
    return true;
  } catch (err){
    console.error('hood cover remove failed', path, err);
    return false;
  }
}

async function hoodCoverSave(clear){
  const pick = document.getElementById('hoodCoverPick');
  const row = hoodCoverRows.find(r => r.id === pick.value);
  if (!row) return;
  const fileEl = document.getElementById('hoodCoverFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  const saveBtn = document.getElementById('hoodCoverSave');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const live = await sb.from('neighborhoods').select('cover_path').eq('id', row.id).maybeSingle();
    if (live.error) throw live.error;
    const currentPath = live.data ? (live.data.cover_path || null) : null;
    let path = clear ? null : currentPath;
    if (!clear && file){
      const type = file.type === 'image/png' ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
      if (!/^image\/(jpeg|png|webp)$/.test(file.type || '')) throw new Error('סוג הקובץ צריך להיות JPG, PNG או WebP.');
      if (file.size > 8 * 1024 * 1024) throw new Error('הקובץ גדול מ-8MB.');
      const folder = String(row.id || '').toLowerCase();
      const fileId = hoodCoverUuid();
      path = folder + '/' + fileId + '.' + type;
      if (!hoodCoverUuidOk(folder) || !hoodCoverUuidOk(fileId) || !hoodCoverPathOk(folder, path)){
        throw new Error('bad_cover_path');
      }
      const up = await sb.storage.from('neighborhood-covers').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
    }
    const { error } = await sb.rpc('admin_hood_cover_set', {
      p_id: row.id,
      p_path: path,
      p_alt: document.getElementById('hoodCoverAlt').value,
      p_credit: document.getElementById('hoodCoverCredit').value,
      p_license: document.getElementById('hoodCoverLicense').value,
      p_credit_url: document.getElementById('hoodCoverUrl').value,
      p_poi: {
        parks: hoodCoverLines(document.getElementById('hoodCoverParks').value),
        transport: hoodCoverLines(document.getElementById('hoodCoverTransport').value),
        education: hoodCoverLines(document.getElementById('hoodCoverEducation').value),
        leisure: hoodCoverLines(document.getElementById('hoodCoverLeisure').value),
      },
    });
    if (error){
      if (path && path !== currentPath) {
        const rolled = await hoodCoverRemove(path);
        if (!rolled) console.error('hood cover rollback left', path);
      }
      throw error;
    }
    const previous = currentPath;
    let stale = false;
    if (previous && previous !== path) stale = !(await hoodCoverRemove(previous));
    showToast(stale
      ? 'השער נשמר. הקובץ הקודם לא נמחק מהאחסון.'
      : (clear ? 'תמונת השער הוסרה' : 'תמונת השער נשמרה'));
    const fresh = await sb.from('neighborhoods').select('id,name,city,cover_path,cover_alt,cover_credit,poi').eq('id', row.id).maybeSingle();
    if (fresh.data){
      const at = hoodCoverRows.findIndex(r => r.id === row.id);
      if (at >= 0) hoodCoverRows[at] = fresh.data;
    }
    hoodCoverForm();
  } catch (e){
    const msg = String(e && e.message || '');
    showToast(/bad_cover_path/.test(msg) ? 'הקובץ לא נשמר. נסו תמונה אחרת.' : (/not_platform_admin/.test(msg) ? 'רק מנהל/ת פלטפורמה שומר/ת תמונת שער.' : heErr(e)));
    if (saveBtn) saveBtn.disabled = false;
  }
}
