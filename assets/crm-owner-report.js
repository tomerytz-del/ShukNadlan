/* ============================================================================
   דוח שבועי לבעל הנכס - החלון ב-CRM
   ----------------------------------------------------------------------------
   אריח "דוח לבעלים" בכרטיס הנכס פותח חלון: הערה אישית (לא חובה) ← הפקה
   (owner_report_create במסד) ← קישור ל-/owner-report?k= עם שליחה בוואטסאפ,
   במייל או בהעתקה.

   **היועץ/ת שולח/ת, לא המערכת.** אין כאן שליחה אוטומטית ואין cron: בעל נכס
   לא הסכים לקבל הודעות מהפלטפורמה, והדוח יוצא בשם היועץ/ת ובערוץ שלו/ה.
   הכפתורים רק פותחים את וואטסאפ או את תיבת המייל של היועץ/ת עם נוסח מוכן.

   נטען לפני crm.js ומגדיר פונקציות בלבד; מה שהוא צריך משם (sb, showToast,
   heErr, waLink, localPhone, escapeHtml) נקרא בזמן ריצה. ‏docs/owner-report.md.
   ========================================================================== */

const OWNER_REPORT_NOTE_MAX = 600;
let ownerReportModal = null;

function ownerReportUrl(id){
  return location.origin + '/owner-report?k=' + encodeURIComponent(id);
}

function ownerReportEnsureModal(){
  if (ownerReportModal) return ownerReportModal;
  const el = document.createElement('div');
  el.className = 'pm-overlay';
  el.id = 'ownerReportModal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'orTitle');
  el.style.display = 'none';
  el.innerHTML = `
    <div class="pm-card">
      <div class="pm-title" id="orTitle">דוח שבועי לבעל הנכס</div>
      <p class="exp-note" id="orWhat" style="font-weight:600;margin-top:0"></p>
      <div id="orStepMake">
        <p class="exp-note" style="margin-top:6px">הדוח הוא תמונת מצב של 7 הימים האחרונים: מבקרים, צפיות, פניות והשוואה לנכסים דומים בעיר.
          הוא <b>נשלח על ידך</b>, בערוץ שלך. המערכת לא פונה לבעלים בעצמה.</p>
        <div class="field">
          <label for="orNote">הערה אישית לבעלים (לא חובה)</label>
          <textarea id="orNote" rows="3" maxlength="${OWNER_REPORT_NOTE_MAX}" placeholder="למשל: ההתעניינות עלתה אחרי הסרטון החדש. כדאי לדבר על המחיר."></textarea>
        </div>
        <div class="pm-actions">
          <button type="button" class="btn btn-ghost" id="orCancel">ביטול</button>
          <button type="button" class="btn btn-gold" id="orMake">הפקת הדוח</button>
        </div>
      </div>
      <div id="orStepShare" style="display:none">
        <div class="field">
          <label for="orLink">הקישור לדוח (בתוקף 30 יום)</label>
          <input type="text" id="orLink" readonly dir="ltr">
        </div>
        <div class="pm-actions" style="flex-wrap:wrap">
          <button type="button" class="btn btn-gold" id="orWa">שליחה בוואטסאפ</button>
          <button type="button" class="btn btn-ghost" id="orMail">שליחה במייל</button>
        </div>
        <div class="pm-actions">
          <button type="button" class="btn btn-ghost" id="orCopy">העתקת הקישור</button>
          <a class="btn btn-ghost" id="orOpen" target="_blank" rel="noopener noreferrer" style="text-align:center">צפייה בדוח</a>
        </div>
        <p class="exp-note" id="orShareNote"></p>
        <div class="pm-actions"><button type="button" class="btn btn-ghost" id="orClose">סגירה</button></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const close = () => { el.style.display = 'none'; };
  el.querySelector('#orCancel').addEventListener('click', close);
  el.querySelector('#orClose').addEventListener('click', close);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  ownerReportModal = el;
  return el;
}

const OWNER_REPORT_ERRORS = {
  forbidden: 'רק היועץ/ת של הנכס או מנהל/ת המשרד יכולים להפיק לו דוח.',
  not_found: 'הנכס לא נמצא.',
  daily_limit: 'הופקו היום 40 דוחות, וזו התקרה היומית. אפשר להמשיך מחר.',
  note_too_long: 'ההערה ארוכה מדי.',
  not_agent: 'צריך להיות מחובר/ת כיועץ/ת נדל״ן.',
};

async function openOwnerReport(p){
  if (!p || !p.id) return;
  const el = ownerReportEnsureModal();
  const ownerRow = Array.isArray(p.property_owners) ? p.property_owners[0] : p.property_owners;
  const ownerName = (ownerRow?.owner_name || '').trim();
  const ownerWa = waLink(ownerRow?.owner_phone);
  const ownerMail = (ownerRow?.owner_email || '').trim();

  el.querySelector('#orWhat').textContent = p.title || '';
  el.querySelector('#orNote').value = '';
  el.querySelector('#orStepMake').style.display = '';
  el.querySelector('#orStepShare').style.display = 'none';
  const make = el.querySelector('#orMake');
  make.disabled = false;
  make.textContent = 'הפקת הדוח';
  el.style.display = 'flex';
  el.querySelector('#orNote').focus();

  // מחליפים את הכפתור בשכפול שלו, כדי שלא יצטברו מאזינים מפתיחה קודמת
  const fresh = make.cloneNode(true);
  make.replaceWith(fresh);
  fresh.addEventListener('click', async () => {
    fresh.disabled = true;
    fresh.textContent = 'מפיק…';
    const note = el.querySelector('#orNote').value.trim();
    const { data, error } = await sb.rpc('owner_report_create', { p_property: p.id, p_note: note || null });
    fresh.disabled = false;
    fresh.textContent = 'הפקת הדוח';
    if (error || !data || data.error){
      const code = data && data.error;
      showToast('הפקת הדוח נכשלה: ' + (OWNER_REPORT_ERRORS[code] || heErr(error || code)), 6000);
      return;
    }
    const url = ownerReportUrl(data.id);
    const greeting = ownerName ? 'שלום ' + ownerName + ',' : 'שלום,';
    const text = greeting + '\nהדוח השבועי על הנכס "' + (p.title || '') + '":\n' + url;
    el.querySelector('#orLink').value = url;
    el.querySelector('#orOpen').href = url;
    const wa = el.querySelector('#orWa');
    wa.onclick = () => window.open((ownerWa || 'https://wa.me/') + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
    const mail = el.querySelector('#orMail');
    mail.onclick = () => { location.href = 'mailto:' + encodeURIComponent(ownerMail) + '?subject='
      + encodeURIComponent('הדוח השבועי על הנכס') + '&body=' + encodeURIComponent(text); };
    el.querySelector('#orCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); showToast('הקישור הועתק'); }
      catch(_){ el.querySelector('#orLink').select(); showToast('סמנו והעתיקו מהשדה'); }
    };
    el.querySelector('#orShareNote').textContent = ownerWa
      ? 'הוואטסאפ ייפתח עם המספר של הבעלים שרשום בנכס.'
      : 'אין מספר בעלים רשום בנכס, ולכן הוואטסאפ ייפתח בלי נמען ותבחרו למי לשלוח.';
    el.querySelector('#orStepMake').style.display = 'none';
    el.querySelector('#orStepShare').style.display = '';
  });
}
