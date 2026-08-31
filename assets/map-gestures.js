/* ============================================================================
   מחוות מגע במפה — יציאה מ"מלכודת הגלילה"
   ----------------------------------------------------------------------------
   מפה שתופסת חצי מסך במובייל בולעת את הגלילה: אצבע שנוחתת עליה מזיזה את המפה
   במקום להמשיך במורד הדף, והגולש/ת נתקע/ת. הפתרון כאן הוא "מחוות משתפות
   פעולה" (cooperative gestures), אותו דפוס שגוגל מפות מפעילה במפות מוטמעות:

     • אצבע אחת — גוללת את הדף כרגיל, כאילו המפה תמונה.
     • שתי אצבעות — מזיזות ומקרבות את המפה עצמה.
     • ניסיון גרירה באצבע אחת מציג בועית עדינה שמסבירה את הכלל, ונעלמת לבד.

   המימוש נשען על התנהגות מובנית ב-Leaflet ולא על שכתוב של מנגנון המגע:
   ‏handler הגרירה מוסיף לקונטיינר ‎.leaflet-touch-drag‎ (‏touch-action:none —
   הדפדפן לא גולל), ו-handler הזום מוסיף ‎.leaflet-touch-zoom‎
   (‏touch-action:pan-x pan-y — הדפדפן כן גולל). כיבוי הגרירה בלבד משאיר בדיוק
   את הצירוף הרצוי: גלילת דף באצבע אחת, ו-touchZoom של Leaflet — שמזיז את
   המפה לפי מרכז שתי האצבעות וגם מקרב — בשתיים.

   לכן גם לא נוסף כאן פלאגין חיצוני (‏leaflet-gesture-handling‎): הוא היה עוד
   תלות CDN לדף שכבר תלוי בשלוש, עם טקסט באנגלית וברירת מחדל שמשנה גם את
   התנהגות הגלגלת בדסקטופ. כאן ההתערבות היא בשורה אחת, והדסקטופ לא נוגע.

   שימוש:
     MapGestures.apply(map);                       // בועית ברירת המחדל
     MapGestures.apply(map, { text:'…' });         // נוסח משלכם

   הפונקציה לא עושה דבר בדסקטופ (מצביע מדויק), ולכן אפשר לקרוא לה תמיד. במפה
   שממילא אין מתחתיה דף לגלול — מסך מלא, כלי הסימון — אין צורך לקרוא לה.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הדפים באתר.
   ========================================================================== */
(function (global) {
  'use strict';

  var HINT_TEXT = 'מזיזים את המפה בשתי אצבעות';
  var HINT_MS = 1800;        // כמה זמן הבועית נשארת אחרי שהוצגה
  var DRAG_TOLERANCE = 10;   // ‏px — מתחת לזה זו נגיעה ולא ניסיון גרירה
  var cssInjected = false;

  /* ה-CSS מוזרק פעם אחת ובלחיצה הראשונה על apply, כדי שדף בלי מפה (או
     דסקטופ) לא ישלם עליו דבר. ‏z-index:900 מציב את הבועית מעל כל ה-panes של
     Leaflet ומעל הפקדים (800). */
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '.map-gesture-hint{' +
        'position:absolute;top:50%;left:50%;z-index:900;' +
        'transform:translate(-50%,-50%) scale(.96);' +
        'max-width:calc(100% - 36px);padding:9px 18px;border-radius:999px;' +
        'background:rgba(18,40,64,.92);color:#fff;' +
        "font-family:'Heebo',sans-serif;font-size:.84rem;font-weight:700;line-height:1.35;" +
        'text-align:center;white-space:nowrap;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.28);' +
        'opacity:0;pointer-events:none;' +
        'transition:opacity .18s ease,transform .18s ease}' +
      '.map-gesture-hint.is-on{opacity:1;transform:translate(-50%,-50%) scale(1)}' +
      '@media (prefers-reduced-motion:reduce){.map-gesture-hint{transition:none}}';
    document.head.appendChild(style);
  }

  /* מסך מגע ולא "רוחב מסך קטן": חלון דפדפן צר בדסקטופ נגלל בגלגלת, ואין בו
     מלכודת. ‏pointer:coarse מדווח על מכשיר ההצבעה *הראשי*, ולכן מחשב נייד עם
     מסך מגע ועכבר לא ייכנס לכאן — ומי שכן נכנס בטעות משתחרר ברגע שנוגע בעכבר
     (ראו releaseOnMouse). */
  function coarsePointer() {
    try {
      return global.matchMedia('(pointer:coarse)').matches ||
             global.matchMedia('(hover:none)').matches;
    } catch (e) {
      return 'ontouchstart' in global;
    }
  }

  /* גרירה שמתחילה על פקד, על בלון או על פין היא לא ניסיון להזיז את המפה, ולא
     צריכה להקפיץ הסבר על שתי אצבעות. */
  function onMapChrome(target) {
    return !!(target && target.closest &&
      target.closest('.leaflet-control, .leaflet-popup, .leaflet-marker-icon'));
  }

  function apply(map, opts) {
    if (!map || !map.dragging || !coarsePointer()) return false;

    var container = map.getContainer();
    if (!container || container.dataset.gestureHandling === 'on') return false;
    container.dataset.gestureHandling = 'on';

    injectCss();

    // הלב של הכל: בלי הגרירה, הקונטיינר נשאר עם touch-action של הזום בלבד
    map.dragging.disable();
    if (map.touchZoom) map.touchZoom.enable();

    var hint = document.createElement('div');
    hint.className = 'map-gesture-hint';
    // עיטור לגולש/ת הרואה/ה: מי שמנווט/ת בקורא מסך לא גורר/ת את המפה בכלל
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = (opts && opts.text) || HINT_TEXT;
    container.appendChild(hint);

    var hideTimer = null, tracking = false, startX = 0, startY = 0;

    function show() {
      hint.classList.add('is-on');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HINT_MS);
    }
    function hide() {
      clearTimeout(hideTimer);
      hint.classList.remove('is-on');
    }

    function onTouchStart(e) {
      if (e.touches.length > 1) { tracking = false; hide(); return; }
      if (onMapChrome(e.target)) { tracking = false; return; }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
    function onTouchMove(e) {
      if (!tracking || e.touches.length > 1) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (dx * dx + dy * dy < DRAG_TOLERANCE * DRAG_TOLERANCE) return;
      tracking = false;   // בועית אחת לכל מחווה, לא אחת לכל touchmove
      show();
    }
    function onTouchEnd() { tracking = false; }

    /* מחשב נייד עם מסך מגע שדיווח על עצמו כ-coarse: ברגע שנעשה שימוש בעכבר
       ברור שיש כאן גלגלת לגלול בה, והמפה חוזרת להתנהגות מלאה. */
    function onPointerDown(e) {
      if (e.pointerType !== 'mouse') return;
      teardown();
      map.dragging.enable();
    }

    /* מפה שנבנית מחדש על אותו div (‏planMap ב-CRM: ‏map.remove() ואז יצירה
       מחדש) הייתה משאירה כאן בועית יתומה ומאזינים שמצביעים על מופע מת —
       ובעיקר dataset שחוסם את ההפעלה על המופע החדש, כלומר חזרה של המלכודת
       בחיפוש השני. Leaflet יורה unload ב-remove, וזו נקודת הניקוי. */
    function teardown() {
      hide();
      container.dataset.gestureHandling = 'off';
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('pointerdown', onPointerDown);
      if (hint.parentNode) hint.parentNode.removeChild(hint);
    }

    // כל המאזינים passive: הם רק מסתכלים. הגלילה עצמה היא של הדפדפן, ואסור
    // שהקוד כאן ייחשד בכוונה לעצור אותה
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    if (global.PointerEvent) container.addEventListener('pointerdown', onPointerDown);
    map.on('unload', teardown);

    return true;
  }

  global.MapGestures = { apply: apply };
})(window);
