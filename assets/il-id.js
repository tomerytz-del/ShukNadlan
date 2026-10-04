/* ============================================================================
   ‏IlId — בדיקת תקינות של מספר תעודת זהות (וח״פ) בזמן ההזנה
   ----------------------------------------------------------------------------
   ‏ספרת הביקורת של ת.ז. ישראלית: תשע ספרות (מספר קצר מרופד באפסים משמאל),
   כל ספרה מוכפלת לסירוגין ב-1 וב-2, מכפלה דו-ספרתית מתקפלת לסכום ספרותיה,
   והסכום חייב להתחלק ב-10. ‏ח״פ של חברה ומספר עמותה עוברים את אותו אלגוריתם,
   ולכן אותה בדיקה משרתת את שדות "ת.ז. / ח״פ".

   ‏**למה יש עקיפה:** הבדיקה תופסת טעות הקלדה, לא זהות. יש מספרים אמיתיים
   שהיא אינה מכירה - מספר זר, ח״פ ישן, מספר שהוקלד מתוך מסמך שבו הוא רשום
   אחרת - ולכן מי שבטוח/ה במספר מסמן/ת "המספר נכון" וממשיכ/ה. העקיפה קשורה
   **לערך** שאושר: שינוי של ספרה אחת אחריה מחזיר את הבדיקה.

   ‏שימוש:
     <input data-il-id>               שדה שנבדק (חיווי חי ביציאה מהשדה)
     <input data-il-id="off">         כבוי - למשל כשנבחר דרכון
     input.dataset.ilIdOk = value     ערך שכבר אושר (נשמר במסד / עקיפה קודמת)
     IlId.check(input)                לפני שליחה: ‏true = אפשר להמשיך
     IlId.scan(root)                  הצגת החיווי לכל השדות המלאים ב-root
     IlId.acceptedValue(v, okValue)   אותה החלטה בלי DOM

   ‏בכל סימון/ביטול של העקיפה נשלח אירוע `il-id-override` (בועה) עם
   ‏`detail: { value, checked }`, כדי שטופס שמצייר את עצמו מחדש ישמור אותה.
   ============================================================================ */
(function(){
  'use strict';

  function normalize(v){
    return String(v == null ? '' : v).replace(/[\s\-.\/]/g, '');
  }

  // 'empty' | 'ok' | 'format' | 'checksum'
  function status(v){
    const d = normalize(v);
    if (!d) return 'empty';
    if (!/^\d{5,9}$/.test(d) || /^0+$/.test(d)) return 'format';
    const p = d.padStart(9, '0');
    let sum = 0;
    for (let i = 0; i < 9; i++){
      const n = Number(p[i]) * ((i % 2) + 1);
      sum += n > 9 ? n - 9 : n;
    }
    return sum % 10 === 0 ? 'ok' : 'checksum';
  }

  function isValid(v){ return status(v) === 'ok'; }

  function acceptedValue(v, okValue){
    const s = status(v);
    if (s === 'empty' || s === 'ok') return true;
    return !!okValue && normalize(okValue) === normalize(v);
  }

  function active(input){
    return input && input.hasAttribute('data-il-id') && input.dataset.ilId !== 'off';
  }

  function accepted(input){
    if (!active(input) || input.readOnly) return true;
    return acceptedValue(input.value, input.dataset.ilIdOk);
  }

  const MESSAGES = {
    format:   'המספר אינו נראה כמו מספר זהות: עד 9 ספרות, בלי אותיות.',
    checksum: 'המספר אינו תקין - ספרת הביקורת אינה מתאימה. כדאי לבדוק שוב מול תעודת הזהות.',
  };

  function boxOf(input){
    const next = input.nextElementSibling;
    return next && next.classList.contains('il-id-warn') ? next : null;
  }

  function hide(input){
    const box = boxOf(input);
    if (box) box.remove();
  }

  function show(input){
    const s = status(input.value);
    let box = boxOf(input);
    if (!box){
      box = document.createElement('div');
      box.className = 'il-id-warn';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'margin-top:6px;padding:8px 10px;border-radius:8px;font-size:.78rem;' +
        'line-height:1.5;background:#fdf1ef;border:1px solid #e8b9b0;color:var(--brick, #9b2c1f);text-align:right';
      const msg = document.createElement('div');
      msg.className = 'il-id-msg';
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px;cursor:pointer;' +
        'color:var(--ink, #222);font-weight:600';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.style.cssText = 'width:auto;margin:0';
      cb.addEventListener('change', () => {
        const value = input.value;
        if (cb.checked) input.dataset.ilIdOk = value;
        else delete input.dataset.ilIdOk;
        box.style.background = cb.checked ? '#f4f6f1' : '#fdf1ef';
        input.dispatchEvent(new CustomEvent('il-id-override', {
          bubbles: true, detail: { value, checked: cb.checked } }));
      });
      const txt = document.createElement('span');
      txt.textContent = 'המספר נכון - לאשר בכל זאת';
      label.appendChild(cb);
      label.appendChild(txt);
      box.appendChild(msg);
      box.appendChild(label);
      input.insertAdjacentElement('afterend', box);
    }
    box.querySelector('.il-id-msg').textContent = MESSAGES[s] || MESSAGES.checksum;
    const cb = box.querySelector('input[type=checkbox]');
    cb.checked = acceptedValue(input.value, input.dataset.ilIdOk);
    box.style.background = cb.checked ? '#f4f6f1' : '#fdf1ef';
  }

  // מציג/מסתיר לפי הערך הנוכחי. ערך תקין או ריק - אין מה לומר.
  function refresh(input){
    if (!active(input) || input.readOnly){ hide(input); return; }
    const s = status(input.value);
    if (s === 'empty' || s === 'ok'){ hide(input); return; }
    // ערך שאושר מראש (נשמר במסד) אינו מציק בכל פתיחה, כל עוד לא שונה
    if (acceptedValue(input.value, input.dataset.ilIdOk) && !boxOf(input)) return;
    show(input);
  }

  function check(input){
    if (!input) return true;
    refresh(input);
    if (accepted(input)) return true;
    show(input);
    try { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_){}
    input.focus();
    return false;
  }

  function scan(root){
    (root || document).querySelectorAll('input[data-il-id]').forEach(refresh);
  }

  // ‏מואצל: שדות שנוצרים ב-innerHTML (האשף ב-CRM) מקבלים את החיווי בלי חיווט
  document.addEventListener('focusout', e => {
    if (e.target && e.target.matches && e.target.matches('input[data-il-id]')) refresh(e.target);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('input[data-il-id]')) return;
    // תיקון תוך כדי הקלדה מעלים את האזהרה מיד; הצגה חדשה מחכה ליציאה מהשדה
    if (boxOf(t)){
      const s = status(t.value);
      if (s === 'empty' || s === 'ok') hide(t);
      else show(t);
    }
  });

  window.IlId = { normalize, status, isValid, acceptedValue, accepted, check, scan, refresh };
})();
