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
   לפני המיגרציה העמודות אינן קיימות, והבלוק נשאר שקט. */
let hoodCoverRows = [];

async function loadHoodCover(){
  const drafts = document.getElementById('hoodDraftsBox');
  if (!drafts || !drafts.parentNode) return;
  let host = document.getElementById('hoodCoverBox');
  if (!host){
    host = document.createElement('div');
    host.id = 'hoodCoverBox';
    drafts.parentNode.insertBefore(host, drafts.nextSibling);
  }
  const { data, error } = await sb.from('neighborhoods')
    .select('id,name,city,cover_path,cover_alt,cover_credit,poi')
    .order('city', { ascending: true })
    .order('name', { ascending: true })
    .limit(1000);
  if (error){
    host.innerHTML = (error.code === '42703' || error.code === 'PGRST204')
      ? ''
      : '<div class="empty-state">' + esc('שגיאה בטעינת תמונות השער: ' + heErr(error)) + '</div>';
    return;
  }
  hoodCoverRows = Array.isArray(data) ? data : [];
  host.innerHTML = '<div class="hd-head"><h4>תמונת שער לשכונה</h4></div>'
    + '<p class="acc-sub">מוצגת בראש דף השכונה. בלי תמונה הדף נשאר עם רקע כהה והכותרת.</p>'
    + '<label class="hd-card" style="display:block">שכונה'
    + '<select id="hoodCoverPick" aria-label="שכונה לתמונת שער">'
    + hoodCoverRows.map(r => '<option value="' + esc(r.id) + '">' + esc((r.city || '') + ' · ' + (r.name || '')) + '</option>').join('')
    + '</select></label>'
    + '<div id="hoodCoverForm"></div>';
  const pick = document.getElementById('hoodCoverPick');
  if (pick){
    pick.addEventListener('change', hoodCoverForm);
    hoodCoverForm();
  }
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
  const preview = row.cover_path
    ? '<img class="hd-cover-prev" alt="" src="' + esc('https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/neighborhood-covers/' + row.cover_path) + '">'
    : '<p class="acc-sub">אין תמונת שער.</p>';
  form.innerHTML = preview
    + '<label>קובץ תמונה<input type="file" id="hoodCoverFile" accept="image/jpeg,image/png,image/webp"></label>'
    + '<label>טקסט חלופי<input type="text" id="hoodCoverAlt" maxlength="180" value="' + esc(row.cover_alt || '') + '"></label>'
    + '<label>קרדיט, גלוי מתחת לתמונה<input type="text" id="hoodCoverCredit" maxlength="160" value="' + esc(row.cover_credit || '') + '" placeholder="צילום: שם"></label>'
    + '<label>פארקים, שורה לכל מקום<textarea id="hoodCoverParks" rows="2">' + esc(lines('parks')) + '</textarea></label>'
    + '<label>תחבורה, שורה לכל מקום<textarea id="hoodCoverTransport" rows="2">' + esc(lines('transport')) + '</textarea></label>'
    + '<label>חינוך, שורה לכל מקום<textarea id="hoodCoverEducation" rows="2">' + esc(lines('education')) + '</textarea></label>'
    + '<div class="hd-acts"><button type="button" class="btn btn-gold" id="hoodCoverSave">שמירת שער</button>'
    + '<button type="button" class="btn btn-ghost" id="hoodCoverClear">הסרת התמונה</button></div>';
  document.getElementById('hoodCoverSave').addEventListener('click', () => hoodCoverSave(false));
  document.getElementById('hoodCoverClear').addEventListener('click', () => hoodCoverSave(true));
}

async function hoodCoverSave(clear){
  const pick = document.getElementById('hoodCoverPick');
  const row = hoodCoverRows.find(r => r.id === pick.value);
  if (!row) return;
  const fileEl = document.getElementById('hoodCoverFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  let path = clear ? null : (row.cover_path || null);
  const saveBtn = document.getElementById('hoodCoverSave');
  if (saveBtn) saveBtn.disabled = true;
  try {
    if (!clear && file){
      const type = file.type === 'image/png' ? 'png' : (file.type === 'image/webp' ? 'webp' : 'jpg');
      if (!/^image\/(jpeg|png|webp)$/.test(file.type || '')) throw new Error('סוג הקובץ צריך להיות JPG, PNG או WebP.');
      if (file.size > 8 * 1024 * 1024) throw new Error('הקובץ גדול מ-8MB.');
      path = row.id + '/' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + '.' + type;
      const up = await sb.storage.from('neighborhood-covers').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
    }
    const { error } = await sb.rpc('admin_hood_cover_set', {
      p_id: row.id,
      p_path: path,
      p_alt: document.getElementById('hoodCoverAlt').value,
      p_credit: document.getElementById('hoodCoverCredit').value,
      p_poi: {
        parks: hoodCoverLines(document.getElementById('hoodCoverParks').value),
        transport: hoodCoverLines(document.getElementById('hoodCoverTransport').value),
        education: hoodCoverLines(document.getElementById('hoodCoverEducation').value),
      },
    });
    if (error){
      if (path && path !== row.cover_path) sb.storage.from('neighborhood-covers').remove([path]).catch(() => {});
      throw error;
    }
    if (clear && row.cover_path) sb.storage.from('neighborhood-covers').remove([row.cover_path]).catch(() => {});
    showToast(clear ? 'תמונת השער הוסרה' : 'תמונת השער נשמרה');
    loadHoodCover();
  } catch (e){
    const msg = String(e && e.message || '');
    showToast(/bad_cover_path/.test(msg) ? 'הקובץ לא נשמר. נסו תמונה אחרת.' : (/not_platform_admin/.test(msg) ? 'רק מנהל/ת פלטפורמה שומר/ת תמונת שער.' : heErr(e)));
    if (saveBtn) saveBtn.disabled = false;
  }
}
