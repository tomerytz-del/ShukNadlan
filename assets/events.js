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

  /* ‏`?src=` — מאיפה הגיע המבקר/ת, כשמי ששלח אותו/ה טרח לומר.
     --------------------------------------------------------------------
     נולד עם העוזר הציבורי בוואטסאפ: הבוט מפנה לדף הנכס במקום לתת קישור
     ‏wa.me ישיר, בדיוק כדי שהקליק ייספר וש-GTM יספיק להיטען (הפניית שרת
     עוזבת את האתר לפני כן — ראו ההערה על `/bot` ב-`_redirects`).

     **בלי הפרמטר הזה המהלך חצי עובד:** הקליק על "וואטסאפ לסוכן" בדף נספר
     כמו כל קליק אחר, ואי אפשר לדעת שהוא הגיע מהבוט — כלומר אי אפשר לענות
     על השאלה היחידה שבגללה ההפניה נעשתה, האם המעבר דרך האתר משתלם.

     **נשמר ל-sessionStorage** כי הוא חי רק בכתובת הנחיתה: מי שינווט מדף
     הנכס לדף המשרד ויפנה משם היה מאבד את הייחוס באמצע הדרך.

     **מסונן לתבנית קצרה** ולא מועבר כלשונו — זהו ערך מכתובת, כלומר קלט
     מבחוץ, והוא נוחת כמימד מותאם ב-GA4. */
  var SRC_RE = /^[a-z0-9_]{1,24}$/i;

  function entrySource(){
    try{
      const fromUrl = new URLSearchParams(location.search).get('src');
      if (fromUrl && SRC_RE.test(fromUrl)){
        try{ sessionStorage.setItem('shukSrc', fromUrl); } catch(e){ /* מצב פרטי */ }
        return fromUrl;
      }
      const remembered = sessionStorage.getItem('shukSrc');
      return remembered && SRC_RE.test(remembered) ? remembered : null;
    } catch(e){
      return null;   /* אחסון חסום — הייחוס יורד, המדידה ממשיכה */
    }
  }

  /* הפרמטרים שמצורפים לכל אירוע, כדי שבדוחות יהיה אפשר לפלח לפי סוג הדף
     ולפי הנכס מבלי להעביר אותם ידנית בכל קריאה. */
  function pageContext(){
    /* ‏'index' ולא כתובת: זהו **שם** סוג הדף בדוח, לא קישור. דף הבית
       מגיע כ-/ , והמקטע האחרון שלו ריק. הסיומת יורדת כאן כדי שכתובת
       ישנה שנשמרה בסימנייה (‏/about.html) תיספר יחד עם /about. */
    const path = (location.pathname.split('/').pop() || 'index');
    const ctx = { page_type: path.replace(/\.html$/, '') || 'index' };
    const id = new URLSearchParams(location.search).get('id');
    if (id) ctx.item_id = id;
    const src = entrySource();
    if (src) ctx.src = src;
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
     שבתוך הקישור, ולא על ה-<a> עצמו.

     ‏**‏data-bot מפצל את האירוע לשניים.** מאז שיש עוזר ציבורי בוואטסאפ
     ‏(docs/whatsapp-public-bot.md), חלק מקישורי ה-wa.me בדף מובילים אליו
     ולא לסוכן/ת. בלי ההבחנה הזו הם היו נספרים כ-contact_agent — כלומר
     תנועה לעוזר הייתה מנפחת בשקט את המדד העסקי המרכזי, ואי אפשר היה לדעת
     אם מספר הפניות למתווכים עלה או שרק הבוט עובד. שני אירועים נפרדים,
     שני דוחות.                                                          */
  document.addEventListener('click', function(e){
    try{
      const link = e.target && e.target.closest && e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';

      let method = null;
      if (href.indexOf('https://wa.me/') === 0 || href.indexOf('https://api.whatsapp.com/') === 0) method = 'whatsapp';
      else if (href.indexOf('tel:') === 0) method = 'phone';
      /* ‏מייל נוסף אחרי שהתברר ב-Tag Assistant שלחיצה על כתובת המייל בפוטר
         אינה מפיקה כלום: היא נפלה ב-return הזה, ולכן הערוץ הזה לא נמדד
         מהיום הראשון. הוא ערוץ צדדי לעומת וואטסאפ וטלפון, אבל "צדדי" אינו
         "אפס", ו-0 בדוח לא נבדל מ"לא נמדד". */
      else if (href.indexOf('mailto:') === 0) method = 'email';
      if (!method) return;

      if (link.hasAttribute('data-bot')){
        // ‏entry הוא נקודת הכניסה שממנה נלחץ הכפתור ("search_empty"), ולא
        // הדף — page_type כבר מגיע מ-pageContext ואין טעם לשכפל אותו.
        shukTrack('contact_bot', { entry: link.getAttribute('data-bot-entry') || 'unknown' });
        return;
      }

      /* ‏**שני סוגי קישורים נוספים שאינם פנייה לסוכן/ת**, ושניהם זוהמו את
         ‏contact_agent עד שסומנו. אותה צורה בדיוק של data-bot למעלה, ומאותה
         סיבה: המאזין תופס כל wa.me וכל tel: בדף, ולא כל אחד מהם הוא ליד.

         ‏**data-share** — כפתור "שתפו בוואטסאפ" הוא ‎wa.me/?text=…‎ בלי מספר
         כלל, כלומר הוא פותח את וואטסאפ כדי שהגולש/ת יבחר/תבחר למי לשלוח.
         זה שיתוף, ההיפך מפנייה: הוא מפיץ את המודעה החוצה ולא יוצר ליד.
         ‏project.html ו-article.html בונים כפתור כזה.

         ‏**data-site-contact** — המספר של שוק נדל״ן עצמו, שיושב בבלוק הקשר
         בתחתית כל דף. מי שמתקשר אלינו אינו פנייה למתווך/ת, ובלי הסימון
         **כל** לחיצה על מספר הפלטפורמה נספרה כליד למתווך בכל 11 הדפים
         הנמדדים. הוא כן נמדד, בשם משלו, כי זה מספר שכדאי לדעת. */
      if (link.hasAttribute('data-share')){
        shukTrack('share', { method: method });
        return;
      }
      if (link.hasAttribute('data-site-contact')){
        shukTrack('contact_site', { method: method });
        return;
      }

      /* ‏**data-developer** — חברה יזמית, ומשרד המכירות של פרויקט שלה.
         זה אינו תיקון של קישור שנספר בטעות אלא **הפרדה של שני משפכים**:
         מי שמתקשר/ת למשרד המכירות של פרויקט קונה מהיזם ישירות, בלי
         מתווך/ת, בלי עמלה ובלי בלעדיות. ‏contact_agent הוא "כמה גולשים
         פנו למתווך/ת", וחברה יזמית אינה מתווכת - עירוב השניים מייצר מדד
         שאי אפשר לפרק למפרע, כי ברמת האירוע לא נשאר סימן מי היה מי.

         ‏**וכל קישורי הקשר של פרויקט הם של היזם**, ולא רק אלה שבדף
         החברה: `projects.developer_id` הוא `not null`, ו-`contact_*` שם
         הוא "משרד המכירות של פרויקט מסוים" (המיגרציה
         ‏`20260921090000_new_projects.sql`). כלומר גם "חיוג למשרד
         המכירות" ו"וואטסאפ" ב-project.html אינם פנייה למתווך/ת. */
      if (link.hasAttribute('data-developer')){
        shukTrack('contact_developer', { method: method });
        return;
      }

      shukTrack('contact_agent', { method: method });
    } catch(err){ /* מדידה לא שוברת אתר */ }
  }, true);
})();
