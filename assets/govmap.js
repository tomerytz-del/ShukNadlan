/* ============================================================================
   ‏GovMap — טעינה עצלה ומקום אחד לטוקן

   **הטוקן ציבורי מטבעו.** מפ"י משייכת אותו לדומיין shuknadlan.co.il והוא
   נשלח מהדפדפן בכל קריאה, ולכן אין דרך להסתיר אותו - בדיוק כמו
   ‏sb_publishable_… ב-crm.js. ההגנה היא נעילת הדומיין, לא הסודיות.
   כתוצאה מכך הוא **אינו עובד** מ-localhost או מ-deploy preview.

   קבוע אחד כאן, ולא בכל דף: שני עותקים של ערך הם שני ערכים ביום שמחליפים
   אחד (אותה סיבה כמו escapeHtml ב-esc.js).

   הסקריפט של GovMap נטען **רק בקריאה ל-govmapReady()** ולא בטעינת הדף -
   הוא צד שלישי, וטעינה מוקדמת מוסיפה RTT לכל גולש/ת בשביל פיצ'ר שרובם לא
   יפעילו. אין להוריד אותו ל-assets: מפ"י דורשת לעבוד מול הגרסה החיה.

   הכללים המלאים: .claude/skills/govmap/SKILL.md · הרקע: docs/govmap.md
   ============================================================================ */
(function () {
  // ריק = GovMap כבוי. govmapReady() נדחית, והקוראים נופלים להתנהגות הקיימת.
  // הטוקן נעול לדומיין האתר; החלפה (אם מפ"י תנפיק חדש) היא השורה הזו בלבד.
  var GOVMAP_TOKEN = 'a888579d-2bc4-4768-97d5-bd1642e2633b';
  var SRC = 'https://www.govmap.gov.il/govmap/api/govmap.api.js';
  var pending = null;

  function govmapReady() {
    if (!GOVMAP_TOKEN) return Promise.reject(new Error('govmap: no token'));
    if (window.govmap) return Promise.resolve(window.govmap);
    if (pending) return pending;
    pending = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SRC;
      s.async = true;
      s.onload = function () {
        if (window.govmap) resolve(window.govmap);
        else reject(new Error('govmap: script loaded without govmap global'));
      };
      s.onerror = function () {
        pending = null; // לאפשר ניסיון חוזר אחרי תקלת רשת
        reject(new Error('govmap: script failed to load'));
      };
      document.head.appendChild(s);
    });
    return pending;
  }

  window.GOVMAP_TOKEN = GOVMAP_TOKEN;
  window.govmapReady = govmapReady;
})();
