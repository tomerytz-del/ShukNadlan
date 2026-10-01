/* ============================================================================
   פס "נפתחים בקרוב" בדף הבית - למי שנמצא/ת באזור של שוק שעוד לא נפתח

   מתווך/ת מנתניה שנכנס/ה לאתר רואה את עפולה: ההפניה מ-‎/‎ הולכת רק לשוק
   חי (‏lib/markets.ts, כלל 1), ובצדק - מי שחיפש/ה דירה לא צריך/ה לנחות על
   "נפתחים בקרוב" בלי שביקש/ה. אבל בלי הפס הזה אין לו/ה שום סימן שהאזור
   שלו/ה בדרך, ושמשרדים מצטרפים אליו עכשיו.

   ## מאיפה השוק

   1. עוגיית `shuk_soon` - ה-edge כותב אותה (‏search-pages.ts) כשה-IP בתוך
      התיבה של שוק שאינו חי, או כשהבחירה השמורה היא שוק כזה.
   2. עוגיית `shuk_market` - אותה בחירה שמורה, למקרה שה-edge לא רץ.

   **בחירה שמורה בשוק חי גוברת:** מי שלחץ/ה "לשוק של עפולה והעמק" בדף
   "נפתחים בקרוב" כבר ראה/תה את ההזמנה, ועוגיית `shuk_soon` מהביקור הקודם
   לא תחזיר אותה.

   ## מה לא

   - **לא הפניה, ולא חלון קופץ.** פס אחד מעל התוכן, עם סגירה שנזכרת
     (‏localStorage, לפי השוק - שוק אחר שעוד לא נפתח יציג אותו שוב).
   - **בלי innerHTML.** השם מגיע מ-markets.js, וההטבה מ-tiers.js - הכול
     נכנס ב-textContent.
   - **בלי tiers.js בטעינת הדף.** הוא נטען רק כשיש פס להציג, כי רוב
     הגולשים לא יראו אותו. בלעדיו הפס יוצא בלי שורת ההטבה, ועדיין תקין.
   ‏docs/regional-pages.md, "פס נפתחים בקרוב".
   ============================================================================ */
(function () {
  'use strict';

  var strip = document.getElementById('soonStrip');
  var M = window.ShukMarkets;
  if (!strip || !M) return;

  var DISMISS_KEY = 'shuk_soon_dismissed';

  function cookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  function soonMarket() {
    var chosen = cookie('shuk_market');
    var chosenM = chosen ? M.bySlug(chosen.split('|')[0]) : null;
    if (chosenM && chosenM.live) return null;
    if (chosenM) return chosenM;
    var s = cookie('shuk_soon');
    var m = s ? M.bySlug(s) : null;
    return (m && !m.live) ? m : null;
  }

  var market = soonMarket();
  if (!market) return;

  try { if (localStorage.getItem(DISMISS_KEY) === market.slug) return; }
  catch (e) { /* אחסון חסום: הפס מוצג, והסגירה תחזיק עד הטעינה הבאה */ }

  var label = strip.querySelector('[data-soon-label]');
  var link = strip.querySelector('[data-soon-link]');
  var promo = strip.querySelector('[data-soon-promo]');
  var close = strip.querySelector('[data-soon-close]');

  if (label) label.textContent = market.label;
  if (link) link.setAttribute('href', market.path);
  strip.hidden = false;

  if (close) {
    close.addEventListener('click', function () {
      strip.hidden = true;
      try { localStorage.setItem(DISMISS_KEY, market.slug); } catch (e) { /* ראו למעלה */ }
    });
  }

  function showPromo() {
    var T = window.Tiers;
    if (!promo || !T || !T.PROMO || !T.PROMO.active) return;
    promo.textContent = '🎁 ' + T.PROMO.headline + ' לכל סוכן/ת שמצטרף/ת';
    promo.hidden = false;
  }

  if (window.Tiers) { showPromo(); return; }
  var s = document.createElement('script');
  s.src = '/assets/tiers.js';
  s.async = true;
  s.onload = showPromo;
  document.head.appendChild(s);
})();
