/* ============================================================================
   האות שי״ן המסתובבת — לוגו הפלטפורמה בפינה העליונה
   ----------------------------------------------------------------------------
   במקום העיגול השטוח שהיה בכותרת: אות שי״ן מוזהבת שמסתובבת לאט סביב הציר
   האנכי שלה, קדימה ואחורה, עם עומק אמיתי.

   איך זה עשוי — בלי WebGL ובלי ספריית תלת־ממד:
   התמונה assets/logo-shin-3d.png נערמת 24 פעמים על ציר ה-Z בתוך
   ‎transform-style:preserve-3d‎, וכשהערימה מסתובבת השכבות הפנימיות נחשפות
   בצדדים ויוצרות דופן. שתי השכבות החיצוניות בלבד הן התצלום עצמו (הפאה
   הקדמית והאחורית); כל מה שביניהן הוא צללית שטוחה — התמונה משמשת כמסכה
   ‎(mask)‎ על גרדיאנט זהב. זה מהותי: אילו גם הדופן הייתה התצלום, ההבהקים
   האפויים בו היו נמרחים לפסים ובזוויות גדולות האות הייתה נראית מרוחה
   במקום מוצקה.

   למה תנודה ולא סיבוב מלא: אות היא גוף דק. בסיבוב של 360° היא עוברת פעמיים
   במצב "פרופיל", מתכווצת לרסיס ונעלמת כמעט לגמרי — בלוגו קטן בכותרת זה נקרא
   כהבהוב תקול ולא כתלת־ממד. לכן הטווח מוגבל ל-‎±SWING_DEG‎, שבו האות נשארת
   קריאה כל הזמן והעומק עדיין נראה. לסיבוב מלא: SWING_DEG=360, ALTERNATE=false.

   שילוב בדף: לא נוגעים במבנה ה-HTML. התגית ‎<img data-shin3d>‎ נשארת במקומה
   ומחזיקה את הגודל, את הקישור ואת ה-alt לקוראי מסך; הסקריפט רק מניח מעליה
   שכבת תלת־ממד ומעלים את התמונה השטוחה. אם הסקריפט לא רץ — מוצגת שי״ן
   סטטית, שהיא לוגו תקין לכל דבר.

   שימוש: ‎<script defer src="assets/logo-3d.js"></script>‎ ותו לא.
   ========================================================================== */
(function () {
  'use strict';

  var SRC = 'assets/logo-shin-3d.png';
  var SLICES = 24;          /* שכבות בערימה — מספיק צפוף כדי שלא יהיו רווחים */
  var DEPTH_RATIO = 0.34;   /* עובי האות ביחס לגובה שלה */
  var TILT_DEG = -7;        /* הטיה קלה מלמעלה; בלעדיה הסיבוב נקרא שטוח */
  var SWING_DEG = 30;       /* עד כמה מסתובבת לכל צד */
  var SWING_SECONDS = 9;    /* משך מעבר לכיוון אחד — איטי בכוונה */
  var ALTERNATE = true;     /* הלוך־ושוב, ולא סיבוב מלא. ראו ההסבר למעלה */

  /* הדופן. גרדיאנט ולא צבע אחיד כדי שגם לצד יהיה הצללה מלמעלה למטה. */
  var WALL = 'linear-gradient(180deg,#e6c169 0%,#c9992f 45%,#8f6216 100%)';
  var WALL_CORE_DIM = 0.55; /* כמה מחשיך מרכז הדופן ביחס לקצוות */
  var BACK_DIM = 0.6;       /* הפאה האחורית מוצללת — היא לא מקבלת את האור */

  var CSS_ID = 'shin3d-css';
  var CSS = [
    /* ה-stage ממוקם ידנית מעל התמונה (ראו sync) ולכן הוא absolute בתוך ההורה
       שלה. pointer-events:none כדי שהקישור שמתחת יישאר לחיץ. */
    '.shin3d-host{position:relative}',
    '.shin3d-stage{position:absolute;pointer-events:none;perspective:900px}',
    '.shin3d-spin{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform;' +
      'animation:shin3d-turn ' + SWING_SECONDS + 's ease-in-out infinite' +
      (ALTERNATE ? ' alternate' : '') + '}',
    '.shin3d-slice{position:absolute;inset:0}',
    '.shin3d-face{background:no-repeat center/contain url("' + SRC + '")}',
    '.shin3d-face-back{filter:brightness(' + BACK_DIM + ')}',
    '.shin3d-wall{background:' + WALL + ';' +
      '-webkit-mask:url("' + SRC + '") no-repeat center/contain;' +
      'mask:url("' + SRC + '") no-repeat center/contain}',
    '@keyframes shin3d-turn{' +
      'from{transform:rotateX(' + TILT_DEG + 'deg) rotateY(' + (ALTERNATE ? -SWING_DEG : 0) + 'deg)}' +
      'to{transform:rotateX(' + TILT_DEG + 'deg) rotateY(' + SWING_DEG + 'deg)}}',
    /* מי שביקש פחות תנועה במערכת ההפעלה מקבל את אותה אות, עומדת בזווית. */
    '@media (prefers-reduced-motion:reduce){.shin3d-spin{animation:none;' +
      'transform:rotateX(' + TILT_DEG + 'deg) rotateY(-18deg)}}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function build(img) {
    if (img.dataset.shin3dReady) return;
    img.dataset.shin3dReady = '1';

    var host = img.parentNode;
    if (!host || host.nodeType !== 1) return;
    host.classList.add('shin3d-host');

    var stage = document.createElement('span');
    stage.className = 'shin3d-stage';
    stage.setAttribute('aria-hidden', 'true');   /* ה-alt של ה-img כבר מכסה את זה */

    var spin = document.createElement('span');
    spin.className = 'shin3d-spin';

    var mid = (SLICES - 1) / 2;
    for (var i = 0; i < SLICES; i++) {
      var slice = document.createElement('i');
      /* ‎--o‎ הוא ההיסט של השכבה במונחי "צעדים", ו-‎--step‎ נקבע ב-sync לפי
         הגודל שבו הלוגו מוצג בפועל — כך אותו רכיב עובד גם ב-46px וגם ב-64px. */
      slice.style.setProperty('--o', String(i - mid));
      slice.style.transform = 'translateZ(calc(var(--o) * var(--step, 0px)))';
      if (i === SLICES - 1) {
        slice.className = 'shin3d-slice shin3d-face';
      } else if (i === 0) {
        slice.className = 'shin3d-slice shin3d-face shin3d-face-back';
      } else {
        slice.className = 'shin3d-slice shin3d-wall';
        /* הדופן מתבהרת ככל שמתקרבים לפאות ומחשיכה בליבה — כך יש לה נפח. */
        var t = Math.abs(i - mid) / mid;
        slice.style.filter =
          'brightness(' + (WALL_CORE_DIM + (1 - WALL_CORE_DIM) * t).toFixed(3) + ')';
      }
      spin.appendChild(slice);
    }
    stage.appendChild(spin);
    host.insertBefore(stage, img.nextSibling);

    function sync() {
      var w = img.offsetWidth;
      var h = img.offsetHeight;
      if (!w || !h) return;
      stage.style.left = img.offsetLeft + 'px';
      stage.style.top = img.offsetTop + 'px';
      stage.style.width = w + 'px';
      stage.style.height = h + 'px';
      stage.style.setProperty('--step', (h * DEPTH_RATIO / (SLICES - 1)).toFixed(3) + 'px');
    }
    sync();

    /* הלוגו מוצג בגדלים שונים לפי רוחב המסך (ולפי מסך ב-CRM), ולכן העמדה
       נגזרת מהתמונה עצמה ולא מקבועים. */
    if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(img);
    else window.addEventListener('resize', sync);

    /* מעלימים את התמונה השטוחה רק אחרי שהקובץ פוענח, אחרת יש רגע שבו הכותרת
       ריקה. היא נשארת ב-DOM (‎opacity‎ ולא ‎display‎) כדי לשמור על הגודל ועל
       ה-alt לקוראי מסך. */
    function hideFlat() {
      img.style.opacity = '0';
      sync();
    }
    if (img.complete && img.naturalWidth) hideFlat();
    else img.addEventListener('load', hideFlat, { once: true });
  }

  function init() {
    var targets = document.querySelectorAll('img[data-shin3d]');
    if (!targets.length) return;
    injectCss();
    for (var i = 0; i < targets.length; i++) build(targets[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* דפים שבונים כותרת אחרי הטעינה (למשל ה-CRM) יכולים לקרוא לזה שוב. */
  window.ShinLogo3D = { refresh: init };
})();
