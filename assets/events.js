/* ==========================================================================
   אירועים מותאמים ל-GA4, דרך dataLayer
   --------------------------------------------------------------------------
   ‏GA4 סופר צפיות דף לבד. מה שהוא לא יודע הוא מה שבאמת קורה במרקטפלייס:
   מי לחץ/ה "וואטסאפ לסוכן", מי שיתף/ה נכס, ומי השאיר/ה פרטים. הקובץ הזה
   דוחף את האירועים האלה ל-`dataLayer`, ו-GTM מאזין להם בטריגר Custom Event
   ומעביר ל-GA4.

   ‏**חשוב:** דחיפה ל-dataLayer לבדה אינה מגיעה ל-GA4. לכל אירוע כאן צריך
   טריגר Custom Event מקביל ב-GTM ותגית GA4 Event שנורית ממנו. הרשימה
   המלאה, והפרמטרים של כל אירוע: `docs/analytics-events.md`.

   שני עקרונות שמנחים את הקובץ:

   ‏1. **מדידה לא שוברת אתר.** כל דחיפה עטופה ב-try/catch. באג כאן, או
      חוסם פרסומות שמנע את טעינת הקובץ, לא יפילו כפתור ולא יעצרו טופס.
   ‏2. **האזנה מואצלת ולא מאזין לכל כפתור.** כפתורי הקשר נבנים דינמית
      ב-innerHTML בעשרות מקומות בקוד, ומתחלפים בכל רינדור. מאזין אחד על
      document תופס את כולם — גם את אלה שייווצרו מחר.
   ========================================================================== */
(function(){
  'use strict';

  window.dataLayer = window.dataLayer || [];

  /* הפרמטרים שמצורפים לכל אירוע, כדי שבדוחות יהיה אפשר לפלח לפי סוג הדף
     ולפי הנכס מבלי להעביר אותם ידנית בכל קריאה. */
  function pageContext(){
    const path = (location.pathname.split('/').pop() || 'index.html');
    const ctx = { page_type: path.replace(/\.html$/, '') || 'index' };
    const id = new URLSearchParams(location.search).get('id');
    if (id) ctx.item_id = id;
    return ctx;
  }

  /* ‏shukTrack(name, params) — הדרך היחידה לדחוף אירוע מקוד האתר.
     ‏מחזירה true/false כדי שקריאה כושלת תהיה גלויה בבדיקה ידנית, אבל
     לעולם לא זורקת. */
  function shukTrack(name, params){
    try{
      if (!name) return false;
      window.dataLayer.push(Object.assign({ event: name }, pageContext(), params || {}));
      return true;
    } catch(e){
      console.warn('shukTrack failed:', e);
      return false;
    }
  }
  window.shukTrack = shukTrack;

  /* ---------- פנייה למתווך ----------
     כל קישור wa.me או tel: בדף, מאיפה שלא הגיע. שלב ה-capture ולא bubble:
     כך האירוע נרשם גם אם מאזין אחר על הכפתור עוצר את ההתפשטות.

     ‏closest() ולא e.target: הלחיצה נוחתת כמעט תמיד על ה-SVG או על הטקסט
     שבתוך הקישור, ולא על ה-<a> עצמו.                                     */
  document.addEventListener('click', function(e){
    try{
      const link = e.target && e.target.closest && e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';

      let method = null;
      if (href.indexOf('https://wa.me/') === 0 || href.indexOf('https://api.whatsapp.com/') === 0) method = 'whatsapp';
      else if (href.indexOf('tel:') === 0) method = 'phone';
      if (!method) return;

      shukTrack('contact_agent', { method: method });
    } catch(err){ /* מדידה לא שוברת אתר */ }
  }, true);
})();
