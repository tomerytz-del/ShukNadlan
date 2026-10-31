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
  var BROWSE_RE = /^(swipe|swipe_list|swipe_map|home_list|map|search|home|gabriela|likes|fair|similar|direct)$/;

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
    /* ‏browse (‏P1-M, v10): מאיזו צורת גלישה הגיעו לנכס הזה - נרשם ברגע הלחיצה (‏shukBrowseMark),
       ונצמד לכל אירוע בדף הנכס **של אותו נכס**. ‏src אומר מאיפה הגיעו לאתר; browse - איך הגיעו לנכס.
       לא בכתובת (‏canonical ו-SEO) */
    if (ctx.page_type === 'property' && document.documentElement.classList.contains('beta-hero')){
      let b = null;
      try { if (sessionStorage.getItem('shukBrowseId') === ctx.item_id) b = sessionStorage.getItem('shukBrowse'); } catch(e){ /* אחסון חסום */ }
      ctx.browse = b && BROWSE_RE.test(b) ? b : 'direct';
    }
    return ctx;
  }
  function shukBrowseMark(browse, id){
    try {
      if (!BROWSE_RE.test(browse || '') || !id) return;
      sessionStorage.setItem('shukBrowse', browse);
      sessionStorage.setItem('shukBrowseId', String(id));
    } catch(e){ /* אחסון חסום */ }
  }
  window.shukBrowseMark = shukBrowseMark;
  /* כל קישור לדף נכס: המקור הוא ה-data-browse הקרוב, ובדף נכס עצמו - "נכסים דומים" */
  document.addEventListener('click', function(e){
    try{
      const link = e.target && e.target.closest && e.target.closest('a[href*="/property?id="]');
      if (!link) return;
      const id = new URL(link.getAttribute('href'), location.href).searchParams.get('id');
      const box = link.closest('[data-browse]');
      const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '');
      shukBrowseMark(box ? box.getAttribute('data-browse') : page === 'property' ? 'similar' : page === 'index' || page === '' ? 'home' : 'direct', id);
    } catch(err){ /* מדידה לא שוברת אתר */ }
  }, true);

  /* ‏list_impression (‏P1-M, v10): כרטיס או שורה שנראו ב-50% לפחות במשך שנייה. כל נכס פעם
     אחת בכל טעינה של הרשימה, במנות של עד 10 מזהים. רק מזהי נכסים - בלי טקסט */
  function shukObserveList(container, view, layoutOf){
    if (!container || !('IntersectionObserver' in window) || !document.documentElement.classList.contains('beta-hero')) return;
    const seen = new Set(), queue = [], timers = new Map();
    function idOf(el){
      if (el.dataset.pid) return el.dataset.pid;
      const a = el.matches('a[href*="/property?id="]') ? el : el.querySelector('a[href*="/property?id="]');
      try { return a ? new URL(a.getAttribute('href'), location.href).searchParams.get('id') : null; } catch(e){ return null; }
    }
    function flush(){
      while (queue.length){
        const ids = queue.splice(0, 10);
        const p = { view: view, ids: ids.join(','), count: ids.length };
        if (layoutOf) p.layout = layoutOf();
        shukTrack('list_impression', p);
      }
    }
    let flushT = 0;
    const io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        const id = idOf(en.target);
        if (!id || seen.has(id)) return;
        if (en.isIntersecting && en.intersectionRatio >= 0.5){
          if (!timers.has(id)) timers.set(id, setTimeout(function(){
            timers.delete(id); seen.add(id); queue.push(id);
            if (queue.length >= 10) flush(); else { clearTimeout(flushT); flushT = setTimeout(flush, 2000); }
          }, 1000));
        } else if (timers.has(id)){ clearTimeout(timers.get(id)); timers.delete(id); }
      });
    }, { threshold: [0, 0.5] });
    const ITEM = '[data-pid], a[href*="/property?id="]';
    const watch = function(){ container.querySelectorAll(ITEM).forEach(function(el){ if (!el.__shukIo){ el.__shukIo = 1; io.observe(el); } }); };
    watch();
    new MutationObserver(watch).observe(container, { childList: true, subtree: true });
    window.addEventListener('pagehide', flush);
  }
  window.shukObserveList = shukObserveList;

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

      /* ‏**data-professional** — בעל/ת מקצוע: שמאי/ת, עו"ד, אדריכל/ית,
         יועץ/ת משכנתאות. אותה הפרדה של data-developer, מאותה סיבה: זו
         פנייה להתייעצות ולא למי שמוכר/ת דירה, ועד שסומנה כל לחיצה על
         וואטסאפ, טלפון או מייל בעמוד הפרופיל (‏professional.html) וברשימה
         (‏professionals.html) נספרה כ-contact_agent — כלומר הדף שנועד
         להתייעצות ניפח את המדד של הלידים למתווכים. */
      if (link.hasAttribute('data-professional')){
        shukTrack('contact_professional', { method: method });
        return;
      }

      shukTrack('contact_agent', { method: method });
    } catch(err){ /* מדידה לא שוברת אתר */ }
  }, true);
})();

/* ייחוס ביקור ראשון. נטען מכאן כי events.js כבר יושב בכל דף ציבורי,
   בלי להוסיף תגית לכל דף. דף הרשמה בלי events.js טוען את הקובץ בעצמו. */
if (document.readyState === "loading") {
  document.write('<script src="/assets/visit-attr.js"><\/script>');
} else {
  var visitAttrScript = document.createElement("script");
  visitAttrScript.src = "/assets/visit-attr.js";
  document.head.appendChild(visitAttrScript);
}
