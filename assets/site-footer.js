/* ============================================================================
   ההתנהגות של הפוטר המשותף
   ----------------------------------------------------------------------------
   שני דברים בלבד, ושניהם צריכים לעבוד בכל עמוד באתר — גם בעמודים שאין בהם
   שום קוד אחר (דף הקוד האתי, דף השאלות הנפוצות):

     1. ההרשמה לרשימת התפוצה.
     2. קיפול קבוצות הניווט וענן החיפושים הפופולריים במסכים צרים.

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

  /* ---------- הקיפול במסכים צרים ----------
     שני בלוקים בפוטר מקופלים בטלפון ופרושים במסך רחב: ארבע קבוצות הניווט
     (‏עשרים קישורים, שני שלישים מגובה הפוטר בטלפון) וענן החיפושים
     הפופולריים (‏חמישה־עשר צ׳יפים, שמונה שורות). כל אחד מהם הוא ‎<details>‎
     שנפתח ב-‎open‎ ב-HTML — כך שבלי JS, ולסורקים, הכול פרוש — ונסגר כאן
     בלבד, מתחת לסף שלו. הסְפים שונים כי הרוחב שכל בלוק צריך שונה: הרשת
     נפתחת לארבע עמודות ב-560px, והצ׳יפים מפסיקים לגלוש ב-760px.

     הקישורים נשארים ב-DOM בכל מצב, ולכן מנוע החיפוש והחיפוש בדפדפן
     מוצאים אותם גם כשהבלוק סגור. */
  var fold = function (nodes, query) {
    if (!nodes.length || !window.matchMedia) return;
    var wide = window.matchMedia(query);
    var sync = function () {
      for (var i = 0; i < nodes.length; i++) nodes[i].open = wide.matches;
    };
    sync();
    if (wide.addEventListener) wide.addEventListener('change', sync);
    else if (wide.addListener) wide.addListener(sync);

    /* מעל הסף ה-summary הוא כותרת ולא כפתור — ‎cursor:default‎ אומר את זה
       ב-CSS, אבל ‎<details>‎ עדיין מתקפל בלחיצה, ואז עמודה שלמה נעלמת
       במסך שבו אין בכלל קיפול ונשארת כך עד שינוי הרוחב הבא (‏sync רץ רק
       על ‎change‎). ‏preventDefault חוסם גם מקלדת: ‏Enter ו-Space על
       ‎summary‎ מייצרים click. */
    for (var j = 0; j < nodes.length; j++) {
      var summary = nodes[j].querySelector(':scope > summary');
      if (summary) summary.addEventListener('click', function (e) {
        if (wide.matches) e.preventDefault();
      });
    }
  };

  fold(document.querySelectorAll('details.footer-col'), '(min-width:560px)');
  var seo = document.getElementById('footerSeo');
  fold(seo ? [seo] : [], '(min-width:760px)');

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
