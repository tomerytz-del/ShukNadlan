/* ============================================================================
   מחוות במפה — יציאה מ"מלכודת הגלילה"
   ----------------------------------------------------------------------------
   מפה שתופסת חצי מסך בולעת את הגלילה: מחווה שנוחתת עליה מזיזה את המפה במקום
   להמשיך במורד הדף, והגולש/ת נתקע/ת. הפתרון כאן הוא "מחוות משתפות פעולה"
   (cooperative gestures), אותו דפוס שגוגל מפות מפעילה במפות מוטמעות:

     • אצבע אחת — גוללת את הדף כרגיל, כאילו המפה תמונה.
     • שתי אצבעות — מזיזות ומקרבות את המפה עצמה.
     • גלגלת לבדה — גוללת את הדף.
     • ‏Ctrl/⌘ + גלגלת — מקרבת ומרחיקה את המפה.
     • מחווה "שגויה" מציגה בועית עדינה שמסבירה את הכלל, ונעלמת לבד.

   במגע המימוש נשען על התנהגות מובנית ב-Leaflet ולא על שכתוב של מנגנון המגע:
   ‏handler הגרירה מוסיף לקונטיינר ‎.leaflet-touch-drag‎ (‏touch-action:none —
   הדפדפן לא גולל), ו-handler הזום מוסיף ‎.leaflet-touch-zoom‎
   (‏touch-action:pan-x pan-y — הדפדפן כן גולל). כיבוי הגרירה בלבד משאיר בדיוק
   את הצירוף הרצוי: גלילת דף באצבע אחת, ו-touchZoom של Leaflet — שמזיז את
   המפה לפי מרכז שתי האצבעות וגם מקרב — בשתיים.

   בגלגלת אין מקבילה מובנית ולכן היא ממומשת כאן: ‏scrollWheelZoom של Leaflet
   נשאר כבוי, וזום נעשה רק כשמקש Ctrl/⌘ לחוץ. הדפוס הקודם באתר —
   ‏`map.on('focus', … scrollWheelZoom.enable())` — היה בדיוק המלכודת שהמודול
   הזה נועד למנוע: ‏Leaflet יורה focus על *לחיצה* בתוך המפה, ומאותו רגע כל
   גלילה מעל המפה מקרבת אותה במקום לגלול את הדף, עד שלוחצים במקום אחר.

   לכן גם לא נוסף כאן פלאגין חיצוני (‏leaflet-gesture-handling‎): הוא היה עוד
   תלות CDN לדף שכבר תלוי בשלוש, עם טקסט באנגלית.

   שימוש:
     MapGestures.apply(map);                       // בועיות ברירת המחדל
     MapGestures.apply(map, { text:'…' });         // נוסח משלכם למגע

   אפשר לקרוא תמיד: החלק של המגע נדלק רק במסך מגע, החלק של הגלגלת רק כשבאמת
   מגיע אירוע גלגלת. במפה שממילא אין מתחתיה דף לגלול — מסך מלא — אין צורך.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הדפים באתר.
   ========================================================================== */
(function (global) {
  'use strict';

  var HINT_TEXT = 'מזיזים את המפה בשתי אצבעות';
  var HINT_MS = 1800;        // כמה זמן הבועית נשארת אחרי שהוצגה
  var DRAG_TOLERANCE = 10;   // ‏px — מתחת לזה זו נגיעה ולא ניסיון גרירה
  var WHEEL_STEP = 40;       // כמה delta נצבר לפני רמת זום אחת
  var cssInjected = false;

  /* ‏⌘ במק, ‏Ctrl בכל השאר — הכתיבה חייבת להתאים למקש שבאמת עובד, אחרת
     הבועית מלמדת מחווה שלא קורית. */
  function wheelHintText() {
    var mac = false;
    try {
      mac = /Mac|iPad|iPhone/.test((global.navigator && (navigator.platform || navigator.userAgent)) || '');
    } catch (e) { /* סביבה בלי navigator */ }
    return (mac ? '⌘' : 'Ctrl') + ' + גלילה כדי לקרב את המפה';
  }

  /* ה-CSS מוזרק פעם אחת ובלחיצה הראשונה על apply, כדי שדף בלי מפה (או
     דסקטופ) לא ישלם עליו דבר. ‏z-index:900 מציב את הבועית מעל כל ה-panes של
     Leaflet ומעל הפקדים (800).

     המרכוז הוא במרכז ה*שטח הפנוי* ולא במרכז הקונטיינר. בדף הבית חצי מהמפה
     יושב מתחת לעמודת הכותרת והחיפוש, ובועית שממורכזת בקונטיינר נעלמה
     מתחתיה — הסבר שלא נקרא הוא הסבר שאינו קיים. ארבעת המשתנים נכתבים על
     הקונטיינר ע"י הדף שמכיר את הפריסה שלו (‏syncMapFreeArea בדף הבית);
     בדף בלי חסימות הם פשוט לא מוגדרים, וברירת המחדל 0 מחזירה מרכוז רגיל. */
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var free = 'var(--map-free-start,0px)', freeEnd = 'var(--map-free-end,0px)';
    var style = document.createElement('style');
    style.textContent =
      '.map-gesture-hint{' +
        'position:absolute;z-index:900;' +
        'top:calc(50% + (var(--map-free-top,0px) - var(--map-free-bottom,0px)) / 2);' +
        'left:calc(50% + (' + free + ' - ' + freeEnd + ') / 2);' +
        'transform:translate(-50%,-50%) scale(.96);' +
        'max-width:calc(100% - ' + free + ' - ' + freeEnd + ' - 24px);padding:9px 18px;' +
        'background:rgba(18,40,64,.92);color:#fff;' +
        "font-family:'Heebo',sans-serif;font-size:.84rem;font-weight:700;line-height:1.35;" +
        // בלי nowrap: הבועית מוגבלת לרוחב השטח הפנוי, ומשפט ארוך מדי צריך
        // לרדת שורה בתוכה במקום לגלוש ממנה החוצה
        'text-align:center;' +
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
    if (!map || !map.dragging) return false;

    var container = map.getContainer();
    if (!container || container.dataset.gestureHandling === 'on') return false;
    container.dataset.gestureHandling = 'on';

    injectCss();

    var hint = document.createElement('div');
    hint.className = 'map-gesture-hint';
    // עיטור לגולש/ת הרואה/ה: מי שמנווט/ת בקורא מסך לא גורר/ת את המפה בכלל
    hint.setAttribute('aria-hidden', 'true');
    container.appendChild(hint);

    var hideTimer = null;

    function show(text) {
      hint.textContent = text;
      hint.classList.add('is-on');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HINT_MS);
    }
    function hide() {
      clearTimeout(hideTimer);
      hint.classList.remove('is-on');
    }

    /* ====== גלגלת ======
       ‏passive:false כי כשהמקש לחוץ אנחנו כן עוצרים את ברירת המחדל (שהיא זום
       של הדפדפן עצמו). בלי המקש הפונקציה לא נוגעת באירוע, והדף גולל כרגיל. */
    var wheelAcc = 0, wheelHint = wheelHintText();

    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) { show(wheelHint); return; }
      e.preventDefault();
      hide();
      // deltaMode: 0=פיקסלים, 1=שורות, 2=עמודים. בלי הנרמול, גלגלת שמדווחת
      // בשורות הייתה מזיזה רמת זום על כל נקישה זעירה
      var delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaMode === 2 ? e.deltaY * 60 : e.deltaY;
      wheelAcc += delta;
      if (Math.abs(wheelAcc) < WHEEL_STEP) return;
      var dir = wheelAcc > 0 ? -1 : 1;
      wheelAcc = 0;
      try {
        // סביב הסמן ולא סביב מרכז המפה: זו ההתנהגות שכל מפה בדפדפן עושה,
        // ובלעדיה נקודת העניין בורחת מתחת לעכבר בכל נקישה
        map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + dir);
      } catch (err) { /* אירוע מחוץ למפה — מתעלמים */ }
    }

    container.addEventListener('wheel', onWheel, { passive: false });
    // ‏scrollWheelZoom של Leaflet וההנדלר כאן היו מזיזים את הזום פעמיים על
    // אותה נקישה; זה של Leaflet גם לא יודע לבדוק את המקש
    if (map.scrollWheelZoom) map.scrollWheelZoom.disable();

    /* ====== מגע ======
       מכאן והלאה רק במסך מגע: בדסקטופ אין מלכודת גרירה, ואסור לכבות שם את
       גרירת המפה בעכבר. */
    if (!coarsePointer()) {
      map.on('unload', teardown);
      return true;
    }

    // הלב של הכל: בלי הגרירה, הקונטיינר נשאר עם touch-action של הזום בלבד
    map.dragging.disable();
    if (map.touchZoom) map.touchZoom.enable();

    var touchHint = (opts && opts.text) || HINT_TEXT;
    var tracking = false, startX = 0, startY = 0;

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
      show(touchHint);
    }
    function onTouchEnd() { tracking = false; }

    /* מחשב נייד עם מסך מגע שדיווח על עצמו כ-coarse: ברגע שנעשה שימוש בעכבר
       ברור שיש כאן עכבר לגרור בו וגלגלת לגלול בה, והגרירה חוזרת. שכבת
       הגלגלת נשארת — היא הרלוונטית מכאן והלאה. */
    function onPointerDown(e) {
      if (e.pointerType !== 'mouse') return;
      releaseTouch();
      map.dragging.enable();
    }

    function releaseTouch() {
      hide();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('pointerdown', onPointerDown);
    }

    /* מפה שנבנית מחדש על אותו div (‏planMap ב-CRM: ‏map.remove() ואז יצירה
       מחדש) הייתה משאירה כאן בועית יתומה ומאזינים שמצביעים על מופע מת —
       ובעיקר dataset שחוסם את ההפעלה על המופע החדש, כלומר חזרה של המלכודת
       בחיפוש השני. Leaflet יורה unload ב-remove, וזו נקודת הניקוי. */
    function teardown() {
      releaseTouch();
      container.dataset.gestureHandling = 'off';
      container.removeEventListener('wheel', onWheel);
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
