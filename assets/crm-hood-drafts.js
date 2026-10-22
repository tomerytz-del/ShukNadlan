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
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const { error } = await sb.rpc('admin_hood_draft_decide', {
    p_id: card.dataset.id, p_decision: decision,
    p_intro: card.querySelector('[data-f="intro"]').value,
    p_fits: card.querySelector('[data-f="fits"]').value,
    p_faq: faq,
  });
  if (error){
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    showToast(/text_length/.test(error.message || '') ? 'הפתיחה צריכה להיות בין 40 ל-2,000 תווים.' : heErr(error));
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
  if (acc) acc.addEventListener('toggle', () => { if (acc.open) loadHoodDrafts(); });
})();
