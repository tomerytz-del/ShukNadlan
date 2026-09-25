/* ============================================================================
   ‏"הצג נכסים לידי" - מיקום מהדפדפן → השוק המקומי

   ## בלחיצה, אף פעם לא בטעינה

   בקשת ההרשאה עולה רק אחרי שהגולש/ת לחצ/ה. ‏Chrome מסתיר בקשות שעולות בלי
   מחווה של המשתמש, וסירוב נזכר כמעט לתמיד - מי שסירב/ה בטעינה הראשונה לא
   יראה/תראה את הבקשה שוב. גולש/ת שמבין/ה למה שואלים - מאשר/ת.

   ## מה נשמר

   **השוק בלבד** (`CityContext.choose(m, 'gps')` - ‏localStorage ועוגיית
   `shuk_market`). הקואורדינטות אינן נשמרות, אינן נשלחות לשרת שלנו ואינן
   נשלחות ל-GA4: בחירת השוק נעשית כאן, בדפדפן, מול `assets/markets.js`.
   ‏privacy.html אומר בדיוק את זה.

   ## למה לא GovMap כאן

   ‏`govmap.getGPSLocation` הוא עטיפה ל-`navigator.geolocation` - אותה הרשאה
   ואותה חסימה ב-`_headers`. מה ש-GovMap כן יוסיף, בשלב 4, הוא התרגום של
   הנקודה לשכונה (‏`neighborhoods_area`). בחירת השוק אינה צריכה אותו, ואסור
   שכשל שלו ישאיר גולש/ת בלי שוק.

   ‏`_headers` חייב `geolocation=(self)`: בלעדיו הכפתור נראה תקין ולא עושה
   כלום, בלי שגיאה. ‏docs/regional-pages.md.
   ============================================================================ */
(function () {
  'use strict';

  var btn = document.getElementById('heroNearBtn');
  var msg = document.getElementById('heroNearMsg');
  var M = window.ShukMarkets;
  var C = window.CityContext;
  if (!btn) return;

  /* דפדפן בלי מיקום, או רישום שלא נטען: אין כפתור, במקום כפתור שאינו עובד. */
  if (!('geolocation' in navigator) || !M || !C || typeof C.choose !== 'function') {
    btn.hidden = true;
    return;
  }

  function say(text) { if (msg) msg.textContent = text; }

  function done() { btn.disabled = false; btn.removeAttribute('aria-busy'); }

  function located(pos) {
    var here = C.market();
    var m = M.locate(pos.coords.latitude, pos.coords.longitude, false);

    if (!m) {
      say('עוד לא הגענו לאזור שלך. בינתיים מוצגים כאן הנכסים של ' + (here ? here.label : 'עפולה והעמק') + '.');
      done();
      return;
    }

    C.choose(m, 'gps');

    if (here && here.slug === m.slug) {
      say('המיקום שלך באזור ' + m.label + ' - אלה הנכסים שסביבך.');
      done();
      return;
    }

    say('מעבירים אותך לשוק הנדל״ן של ' + m.label + '...');
    window.location.href = m.path;
  }

  function failed(err) {
    say(err && err.code === 1
      ? 'לא התקבלה הרשאה למיקום. אפשר לאשר אותה בהגדרות הדפדפן ולנסות שוב.'
      : 'לא הצלחנו לאתר את המיקום כרגע. אפשר לנסות שוב בעוד רגע.');
    done();
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    say('מאתרים את המיקום שלך...');
    try {
      /* דיוק נמוך ומיקום מאתמול: לבחירת שוק לא צריך מטרים, ובקשה מהירה
         עדיפה על דיוק שהגולש/ת מחכה לו. */
      navigator.geolocation.getCurrentPosition(located, failed, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 86400000
      });
    } catch (e) {
      failed(null);
    }
  });
})();
