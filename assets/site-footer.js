/* ============================================================================
   ההתנהגות של הפוטר המשותף
   ----------------------------------------------------------------------------
   שני דברים בלבד, ושניהם צריכים לעבוד בכל עמוד באתר — גם בעמודים שאין בהם
   שום קוד אחר (דף הקוד האתי, דף השאלות הנפוצות):

     1. ההרשמה לרשימת התפוצה.
     2. קיפול ענן החיפושים הפופולריים במסכים צרים.

   הקובץ עצמאי לחלוטין: הוא מחזיק את כתובת הפרויקט ואת המפתח הציבורי בעצמו
   ולא נשען על משתנים של הדף המארח, ולכן אפשר להכליל אותו בכל עמוד בשורה
   אחת. שני הערכים האלה מופיעים כבר היום בגלוי בכל דף שמדבר עם Supabase —
   המפתח הציבורי נועד לכך, וההגנה על הנתונים היא ב-RLS ובפונקציות הקצה.

   הסקריפט נטען עם ‎defer‎, כלומר אחרי שה-DOM מוכן. אין צורך ב-
   DOMContentLoaded, ואם הפוטר לא קיים בדף — כל הבדיקות פשוט נופלות לריק.
   ============================================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var NEWSLETTER_URL = SUPABASE_URL + '/functions/v1/newsletter-subscribe';

  /* ---------- ענן החיפושים הפופולריים ----------
     ‏open בברירת המחדל ב-HTML כדי שגם בלי JS (ולסורקים) הכול פרוש; כאן הוא
     נסגר במסכים צרים בלבד, שם חמישה־עשר הצ׳יפים תופסים שמונה שורות. */
  var seo = document.getElementById('footerSeo');
  if (seo && window.matchMedia) {
    var wide = window.matchMedia('(min-width:760px)');
    var sync = function () { seo.open = wide.matches; };
    sync();
    if (wide.addEventListener) wide.addEventListener('change', sync);
    else if (wide.addListener) wide.addListener(sync);
  }

  /* ---------- הרשמה לרשימת התפוצה ---------- */
  var form = document.getElementById('newsletterForm');
  if (!form) return;

  var emailEl = document.getElementById('newsletterEmail');
  var btn = document.getElementById('newsletterBtn');
  var msg = document.getElementById('newsletterMsg');
  var say = function (text, state) {
    msg.textContent = text;
    if (state) msg.dataset.state = state; else msg.removeAttribute('data-state');
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say('כתובת האימייל לא נראית תקינה', 'error');
      emailEl.focus();
      return;
    }
    btn.disabled = true;
    say('רגע…');
    fetch(NEWSLETTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      },
      // ‏data-source על הטופס מאפשר לדעת מאיזה עמוד הגיעה ההרשמה בלי לשכפל
      // את הסקריפט; ערך לא מוכר נדחה בפונקציה עצמה ונרשם כברירת המחדל.
      body: JSON.stringify({ email: email, source: form.dataset.source || 'homepage_footer' }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || !data.success) throw new Error(data.error || 'request failed');
          return data;
        });
      })
      .then(function (data) {
        // הרשמה חוזרת אינה שגיאה: מבחינת הנרשם/ת הוא/היא רשום/ה, וזו האמת
        say(data.duplicate ? 'כבר רשומים אצלנו — נמשיך לעדכן' : 'נרשמתם! העדכון הבא בדרך אליכם', 'ok');
        form.reset();
      })
      .catch(function (err) {
        console.warn('הרשמה לניוזלטר נכשלה:', err);
        say('ההרשמה נכשלה כרגע. אפשר לנסות שוב בעוד רגע', 'error');
      })
      .then(function () { btn.disabled = false; });
  });
})();
