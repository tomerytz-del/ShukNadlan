/* ==========================================================================
   הפרופיל שלי ודף המשרד - מה שנוסף מעל הטפסים הקיימים
   --------------------------------------------------------------------------
   שלב 3ב בעיצוב מחדש (סעיפים 3.4 ו-3.5; docs/crm-profile-pages.md). הטפסים
   עצמם - העלאת התמונות, נקודת המיקוד, בדיקת הרישיון והשמירה - נשארו ב-
   assets/crm.js בלי שינוי. כאן רק מה שהעיצוב הוסיף:

     · הבאנר "חסרה לשון פנייה" / "חסר תיאור 'על המשרד'", והמסגרת הזהובה
     · "הפרופיל מלא ב-X%" - שבע הבדיקות של profileChecks (crm-settings.js),
       מהערכים שעל המסך ולא מהשמור, כדי שהאחוז יעלה בזמן ההקלדה
     · "יוצג כ: 15+ שנות ניסיון", ו"2 מתוך 24" בגלריה
     · פס השמירה הצמוד: "יש שינויים שלא נשמרו", "ביטול שינויים", "נשמר"

   ‏crm.js קורא ל-pgProfileSync בסוף renderProfilePreview, ל-pgBrandingSync בסוף
   renderBrandPreview, ול-pgMarkClean אחרי שמירה שהצליחה.

   הקובץ נטען לפני assets/crm.js; הפונקציות נקראות רק אחרי שהוא רץ.
   ========================================================================== */

const PG_GALLERY_MAX = 24;

/* "לבחירה" / "לכתיבת התיאור" - קפיצה לשדה ופוקוס */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-pg-focus]');
  if (!btn) return;
  const el = document.getElementById(btn.dataset.pgFocus);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
  const target = el.matches('button, input, select, textarea') ? el : el.querySelector('button, input, select, textarea');
  if (target) setTimeout(() => target.focus({ preventScroll:true }), 300);
});

/* ---------- פס השמירה: מצב "יש שינויים" ----------
   הטפסים כאן נשמרים בקוד הקיים (submit / brSaveBtn), ולכן אין read/apply
   כמו ב-uiSaveBar: "יש שינויים" נדלק מכל נגיעה, ונכבה אחרי שמירה שהצליחה
   או "ביטול שינויים", שטוען מחדש מהמסד. */
const PG_BARS = {
  pf: { page:'pfPage', bar:'pfSavebar', text:'pfFeedback', reset:'pfResetBtn' },
  br: { page:'brPage', bar:'brSavebar', text:'brFeedback', reset:'brResetBtn' },
};
const pgDirty = { pf:false, br:false };

function pgMarkDirty(key){
  const c = PG_BARS[key];
  if (pgDirty[key]) return;
  pgDirty[key] = true;
  document.getElementById(c.bar).classList.add('is-dirty');
  document.getElementById(c.bar).classList.remove('is-saved');
  const t = document.getElementById(c.text);
  t.style.color = '';
  t.textContent = 'יש שינויים שלא נשמרו';
  document.getElementById(c.reset).hidden = false;
}

/* אחרי שמירה שהצליחה (saved = true) או "ביטול שינויים". הטקסט של השמירה
   עצמה (למשל "הפרטים נשמרו" או הערת הרישיון) נשאר כמו שהקוד הקיים כתב */
function pgMarkClean(key, saved){
  const c = PG_BARS[key];
  pgDirty[key] = false;
  const bar = document.getElementById(c.bar);
  if (!bar) return;
  bar.classList.remove('is-dirty');
  bar.classList.toggle('is-saved', !!saved);
  document.getElementById(c.reset).hidden = true;
  if (!saved) document.getElementById(c.text).textContent = '';
}

/* לשאלה ביציאה (crmUnsavedInput): דף המשרד אינו form, ולכן הבדיקה הישנה לא
   רואה אותו */
function pgAnyDirty(){ return pgDirty.br; }

(function wirePgBars(){
  const pf = document.getElementById('pfPage');
  if (pf){
    const dirty = e => { if (!e.target.closest('#pfSavebar')) pgMarkDirty('pf'); };
    // לשון הפנייה, הרישיון והוותק אינם מציירים את התצוגה המקדימה - לכן גם כאן
    pf.addEventListener('input', () => pgProfileSync());
    pf.addEventListener('change', () => pgProfileSync());
    pf.addEventListener('input', dirty);
    pf.addEventListener('change', dirty);
    document.getElementById('pfResetBtn').addEventListener('click', () => {
      if (typeof loadProfileSettings === 'function' && currentAgent) loadProfileSettings(currentAgent);
      document.getElementById('profileForm').dataset.touched = '';
      pgMarkClean('pf');
    });
  }
  const br = document.getElementById('brPage');
  if (br){
    br.addEventListener('input', e => { if (!e.target.closest('#brSavebar')) pgMarkDirty('br'); });
    br.addEventListener('change', e => { if (!e.target.closest('#brSavebar')) pgMarkDirty('br'); });
    // ערכת הצבעים, הרקע, תחומי ההתמחות והסרת תמונות הם כפתורים ולא שדות
    br.addEventListener('click', e => {
      if (e.target.closest('#brSavebar, #brandPreview, [data-pg-focus], a, .ui-fold-head, [data-area-fold]')) return;
      if (e.target.closest('button, [role="radio"], [role="button"]')) pgMarkDirty('br');
    });
    document.getElementById('brResetBtn').addEventListener('click', () => {
      if (typeof loadBranding === 'function' && currentAgent) loadBranding(currentAgent.agency_id);
      pgMarkClean('br');
    });
  }
})();

/* ---------- הפרופיל ---------- */
const PG_CHECK_FOCUS = {
  photo:'pfPhotoInput', license:'pfLicense', bio:'pfBio', markets:'pfAreas',
  specialties:'pfSpecialties', gallery:'pfGalleryInput', gender:'pfGender',
};

/* הפרופיל כפי שהוא על המסך עכשיו, באותה צורה ש-profileChecks מצפה לה */
function pgProfileDraft(){
  const val = id => (document.getElementById(id) || {}).value || '';
  const own = typeof selectedMarkets === 'function' ? selectedMarkets() : [];
  const office = typeof agencyAreaDefaults !== 'undefined' ? agencyAreaDefaults.markets : [];
  return {
    photo_url: profileState && profileState.photo ? (profileState.photo.url || profileState.photo.previewUrl) : '',
    license_number: val('pfLicense'),
    bio: val('pfBio'),
    service_markets: own.concat(office),
    specialties: typeof selectedSpecialties === 'function' ? selectedSpecialties() : [],
    gallery: profileState ? profileState.gallery : [],
    gender: val('pfGender'),
  };
}

function pgProfileSync(){
  const genderEl = document.getElementById('pfGender');
  if (!genderEl) return;
  const noGender = !genderEl.value;
  document.getElementById('pfGenderBanner').hidden = !noGender;
  document.getElementById('pfGenderTag').hidden = !noGender;
  genderEl.classList.toggle('ui-missing', noGender);

  const years = parseInt(document.getElementById('pfYears').value, 10);
  document.getElementById('pfYearsShow').textContent =
    Number.isFinite(years) && years > 0 ? `יוצג כ: ${years}+ שנות ניסיון` : '';

  const n = profileState ? profileState.gallery.length : 0;
  document.getElementById('pfGalleryCount').textContent = n ? `${n} מתוך ${PG_GALLERY_MAX}` : '';

  if (typeof profileChecks !== 'function') return;
  const checks = profileChecks(pgProfileDraft());
  const done = checks.filter(c => c.done).length;
  const pct = Math.round(done / checks.length * 100);
  document.getElementById('pfComplete').innerHTML =
    `<div class="pg-complete-head"><span class="ui-h3">הפרופיל מלא ב-${pct}%</span><span class="ui-muted">${done} מתוך ${checks.length}</span></div>`
    + `<span class="set-bar" role="progressbar" aria-label="מילוי הפרופיל" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span>`
    + `<ul class="pg-checks">` + checks.map(c => c.done
        ? `<li class="is-done"><span class="pg-check" aria-hidden="true">✓</span>${escapeHtml(c.label)}</li>`
        : `<li><button type="button" class="pg-check-btn" data-pg-focus="${PG_CHECK_FOCUS[c.key]}"><span class="pg-check" aria-hidden="true"></span>${escapeHtml(c.label)}<span class="sr-only"> - חסר, להשלמה</span></button></li>`).join('')
    + `</ul>`;
}

/* ---------- דף המשרד ---------- */
function pgBrandingSync(){
  const desc = document.getElementById('brDescription');
  if (!desc) return;
  const missing = !desc.value.trim();
  document.getElementById('brAboutBanner').hidden = !missing;
  document.getElementById('brAboutTag').hidden = !missing;
  desc.classList.toggle('ui-missing', missing);
  const preview = document.getElementById('brandPreview');
  if (preview) preview.classList.toggle('is-missing-about', missing);
}
document.getElementById('brDescription').addEventListener('input', pgBrandingSync);
