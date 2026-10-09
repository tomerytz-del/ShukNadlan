/* ==========================================================================
   הקישור לעוזר הציבורי בוואטסאפ — מקור אמת יחיד
   --------------------------------------------------------------------------
   העוזר עונה בוואטסאפ למי שאינו סוכן/ת רשום/ה: מחפש נכסים במאגר, ממליץ על
   משרדים לפי התמחות, מחשב משכנתא ופותח ליד. ‏docs/whatsapp-public-bot.md.

   **למה קובץ ולא מספר מודבק בדף.** ‏docs/whatsapp-setup.md מבטיח שהחלפת
   המספר ב-Meta היא שורה אחת בקוד. ברגע שהמספר יושב גם בדף הבית, גם בדף
   הנכס וגם במייל — ההבטחה הזו נשברת בשקט, ומישהו מגלה חודש אחרי שכפתור
   אחד עדיין מפנה למספר שכבר לא קיים.

   **הודעת הפתיחה אינה קישוט.** שתי סיבות, אותן שתיים שמתועדות אצל העוזר
   של הסוכנים ב-crm.html:
     1. היא חוסכת את "מה כותבים לבוט" — הרגע שבו רוב האנשים סוגרים את החלון.
     2. היא פותחת את חלון 24 השעות של Meta, וזה מה שמאפשר לענות בטקסט חופשי
        במקום בתבנית מאושרת.
   ולכן ההודעה נבנית מהקשר אמיתי ("חיפשתי 4 חדרים בעפולה ולא מצאתי") ולא
   מברכה גנרית: היא גם הופכת את התשובה הראשונה לרלוונטית, וגם מספרת לנו
   מאיזו נקודה באתר הגיע הפונה — ‏whatsapp_messages מתעדת את גוף ההודעה.

   ‏JS גולמי בלי תלויות, כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* המספר העסקי של העוזר (Meta WhatsApp Cloud API). מזהה ציבורי ולא סוד —
     הוא מודפס על כל הודעה שהעוזר שולח. אם המספר מוחלף ב-Meta, זו השורה
     שמתעדכנת, ולצדה crm.html ו-docs/whatsapp-setup.md. */
  var NUMBER = '972532494740';

  /* ------------------------------------------------------------------
     המתג — כבוי בכוונה
     ------------------------------------------------------------------
     בצד השרת העוזר הציבורי נעול מאחורי הסוד WHATSAPP_PUBLIC_BOT, וכל עוד
     הוא כבוי, מספר שאינו מזוהה כסוכן/ת מקבל "סליחה, איני מזהה את מספר
     הטלפון שלך כמורשה במערכת".

     כפתור באתר שעולה לפני שהסוד נדלק שולח אנשים בדיוק לשם — חוויה ראשונה
     גרועה שאי אפשר לקחת בחזרה. לכן הכפתורים נולדים כבויים, וההדלקה היא
     שורה אחת כאן **אחרי** שהעוזר נבדק בפועל מהטלפון.

     הסדר: פריסת הפונקציה → WHATSAPP_PUBLIC_BOT=on → בדיקה ידנית → כאן.

     ‏**נדלק ב-3.10.2026**, אחרי שהעוזרת קיבלה שם (גבריאלה) ושהסוד בשרת
     הוכח דלוק ביומן: ארבע שיחות ציבוריות בשבועיים, ואף תשובת "איני מזהה"
     לפונה לא-רשום מאז 16.9. מי שמכבה את הסוד מכבה גם כאן, באותו יום.  */
  var ENABLED = true;

  var FALLBACK_HELLO = 'שלום, הגעתי מהאתר ואשמח לעזרה';

  function enabled() { return ENABLED; }

  /* ------------------------------------------------------------------
     מאיזו מודעה הגיע/ה הגולש/ת
     ------------------------------------------------------------------
     מודעה בגוגל או במטא נוחתת עם utm_source / utm_campaign / utm_content.
     הקוד נשמר ל-sessionStorage בנחיתה (הגולש/ת עובר/ת דף לפני שכותב/ת),
     ונוסף להודעת הפתיחה כ-"(מודעה google:commercial)". ‏siteEntryOf ב-
     whatsapp-webhook חותם אותו ב-whatsapp_messages.public_entry_ref, וכך
     בדיקת A/B נמדדת בשיחות ובלידים ולא רק בלחיצות. רק אותיות לטיניות,
     ספרות ו-._- - שם קמפיין, לא פרט אישי.
     ‏docs/whatsapp-public-bot.md, "מאיזו מודעה". */
  var AD_REF_KEY = 'shukAdRef';
  function cleanRef(v) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
  }
  function adRef() {
    try {
      var q = new URLSearchParams(global.location.search);
      var src = cleanRef(q.get('utm_source'));
      var camp = cleanRef(q.get('utm_campaign'));
      if (src && camp) {
        var ref = src + ':' + camp + (cleanRef(q.get('utm_content')) ? ':' + cleanRef(q.get('utm_content')) : '');
        global.sessionStorage.setItem(AD_REF_KEY, ref);
        return ref;
      }
      return global.sessionStorage.getItem(AD_REF_KEY) || '';
    } catch (e) {
      return '';
    }
  }
  var AD_REF = adRef();

  /* מחזירה כתובת wa.me עם הודעת פתיחה. ‏null כשהעוזר כבוי — כדי שהקורא
     יידע לא לצייר כפתור, במקום לצייר כפתור שמוביל לתשובה "איני מזהה". */
  function link(hello) {
    if (!ENABLED) return null;
    var text = String(hello || '').trim() || FALLBACK_HELLO;
    if (AD_REF) text += ' (מודעה ' + AD_REF + ')';
    return 'https://wa.me/' + NUMBER + '?text=' + encodeURIComponent(text);
  }

  /* הכפתור עצמו. ‏data-bot הוא מה שמבדיל אותו במדידה מכפתור "וואטסאפ
     לסוכן" — assets/events.js סופר כל קישור wa.me, ובלי ההבחנה הזו
     פניות לעוזר היו מזהמות את contact_agent, המדד העסקי המרכזי. */
  function anchorHtml(hello, label, className) {
    var href = link(hello);
    if (!href) return '';
    return '<a class="' + (className || 'bot-cta') + '" data-bot="1" ' +
      'href="' + href + '" target="_blank" rel="noopener">' + label + '</a>';
  }

  global.ShukBot = {
    NUMBER: NUMBER,
    enabled: enabled,
    link: link,
    anchorHtml: anchorHtml,
  };
})(window);
