/* ============================================================================
   הרקע הזורם של האתר — שכבה אחת לכל הדפים
   ----------------------------------------------------------------------------
   עד כה הרקע הזה (שמש חמה, קו רקיע של העיר וארבע שכבות גלים) היה כתוב
   פעמיים: פעם ב-index.html ופעם ב-agencies.html, וכל שאר הדפים — המשרד,
   הסוכן/ת והנכס — נשארו על רקע נייר שטוח. הקובץ הזה מחזיק את אותו רקע
   בדיוק במקום אחד, כדי שכל דף שיטען אותו ייראה כמו דף הבית וכמו ה-CRM.

     PageBg.mount()    // מזריק את ה-CSS, את השכבות ואת מאזיני הגלילה
     PageBg.unmount()  // מסיר את השכבות (משרד שביקש רקע חלק)
     PageBg.isMounted()
     PageBg.refresh()  // חישוב ההיסט מחדש — למשל אחרי שינוי בתפריט הנגישות

   טעינה עם ‎data-auto‎ על תגית ה-<script> מרכיבה את הרקע מיד:

       <script src="assets/page-bg.js" data-auto></script>

   דף שההרכבה בו תלויה בנתון שנטען מהשרת (דף המשרד, שיכול לבחור רקע חלק)
   טוען בלי ‎data-auto‎ וקורא ל-PageBg.mount() בעצמו.

   הכל דקורטיבי בלבד: aria-hidden + pointer-events:none, ובמצב
   prefers-reduced-motion (או "עצירת אנימציות" בתפריט הנגישות, שמסומן
   ב-html.a11y-nomotion) התנועה נכבית לגמרי ונשאר רקע סטטי.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- ה-CSS ----------
     ‏z-index:-1 מציב את השכבה מתחת לכל תוכן הדף אבל מעל רקע ה-body, ולכן
     צבע הנייר שעל ה-body נשאר רק כרשת ביטחון אם הדפדפן לא צייר את השכבה. */
  var CSS = [
    '.page-bg{',
    '  position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;',
    '  background:',
    '    radial-gradient(120% 78% at 74% -12%, rgba(250,201,124,.62) 0%, rgba(252,222,175,.34) 34%, rgba(248,250,252,0) 70%),',
    '    radial-gradient(100% 66% at 8% 2%, rgba(214,232,248,.90), rgba(248,250,252,0) 74%),',
    '    linear-gradient(180deg,#fdf8ef 0%,#f7fbfe 38%,#e4eefa 100%)}',

    /* גרעין השמש — הילה חמה שנושמת לאט */
    '.page-bg .bg-sun{',
    '  position:absolute;top:-110px;inset-inline-end:12%;width:min(58vw,480px);aspect-ratio:1;',
    '  border-radius:50%;',
    '  background:radial-gradient(circle,rgba(249,182,84,.52) 0%,rgba(251,208,136,.28) 40%,rgba(252,228,186,0) 70%);',
    '  animation:bgSun 16s ease-in-out infinite}',
    '@keyframes bgSun{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.09);opacity:1}}',

    /* קו הרקיע: מגדלים ובתים בגוון כחול־אפור דהוי, יושב על "קו המים" של הגלים */
    '.page-bg .bg-skyline{position:absolute;left:0;right:0;bottom:18%;height:min(30vh,240px);',
    '  opacity:.16;will-change:transform}',
    '.page-bg .bg-skyline svg{display:block;width:100%;height:100%}',

    /* שכבת גל אחת: רוחב 300% = שלושה מחזורים, כדי שגם ההיסט מהגלילה וגם
       האנימציה יוכלו להזיז אותה בלי לחשוף קצה */
    '.page-bg .bg-wave{position:absolute;left:0;width:300%;will-change:transform}',
    '.page-bg .bg-wave svg{display:block;width:100%;height:100%}',
    /* -33.333% = בדיוק מחזור גל אחד, ולכן הלולאה חלקה ובלי קפיצה */
    '@keyframes bgDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-33.3333%,0,0)}}',
    '.page-bg .bg-wave>svg{animation:bgDrift linear infinite}',
    /* השקיפויות נמוכות מאלה שבדשבורד: שם כל התוכן יושב בתוך כרטיסים, ואילו
       בדפי התוכן כותרות הסקציות יושבות ישירות על הרקע — וכותרת בכחול כהה
       מעל גל כחול כהה פשוט נעלמת. */
    '.page-bg .bg-wave-1{top:5%;height:min(30vh,250px);opacity:.55}',
    '.page-bg .bg-wave-1>svg{animation-duration:74s}',
    '.page-bg .bg-wave-2{top:30%;height:min(34vh,280px);opacity:.34}',
    '.page-bg .bg-wave-2>svg{animation-duration:52s;animation-direction:reverse}',
    '.page-bg .bg-wave-3{top:52%;height:min(36vh,300px);opacity:.24}',
    '.page-bg .bg-wave-3>svg{animation-duration:38s}',
    '.page-bg .bg-wave-4{bottom:-22%;height:min(46vh,380px);opacity:.14}',
    '.page-bg .bg-wave-4>svg{animation-duration:28s;animation-direction:reverse}',

    '@media(prefers-reduced-motion:reduce){',
    '  .page-bg .bg-sun,.page-bg .bg-wave>svg{animation:none}}',
    /* מצב ניגודיות גבוהה בתפריט הנגישות מכבה את הרקע לגמרי */
    'html.a11y-contrast .page-bg{display:none !important}',
  ].join('\n');

  /* ---------- שכבות הרקע ----------
     ‏data-kx הוא קצב ההיסט האופקי ביחס לגלילה, ו-data-ky משרעת הנדנוד
     האנכי בפיקסלים. שני ה-id של הגרדיאנטים בתוך ה-SVG מקבלים תחילית
     ‎pgbg-‎ כדי שלא יתנגשו ב-defs אחרים שכבר יש בדף. */
  var WAVE_D_UP   = 'M0,160 C120,205 240,205 360,160 C480,115 600,115 720,160 C840,205 960,205 1080,160 ' +
                    'C1200,115 1320,115 1440,160 C1560,205 1680,205 1800,160 C1920,115 2040,115 2160,160 L2160,320 L0,320 Z';
  var WAVE_D_DOWN = 'M0,160 C120,80 240,80 360,160 C480,240 600,240 720,160 C840,80 960,80 1080,160 ' +
                    'C1200,240 1320,240 1440,160 C1560,80 1680,80 1800,160 C1920,240 2040,240 2160,160 L2160,320 L0,320 Z';

  function wave(n, kx, ky, d, stops, x2, y2) {
    return '<div class="bg-wave bg-wave-' + n + '" data-kx="' + kx + '" data-ky="' + ky + '">' +
      '<svg viewBox="0 0 2160 320" preserveAspectRatio="none">' +
      '<defs><linearGradient id="pgbgWave' + n + '" x1="0" y1="0" x2="' + x2 + '" y2="' + y2 + '">' +
      stops + '</linearGradient></defs>' +
      '<path fill="url(#pgbgWave' + n + ')" d="' + d + '"/></svg></div>';
  }

  var MARKUP =
    '<span class="bg-sun"></span>' +

    /* קו הרקיע: מגדלים ובתים צמודים לתחתית האלמנט, ובסיסם מכוסה בגל
       התחתון. slice ולא meet — במסך צר עדיף להתקרב לכמה בניינים גדולים
       ורכים מאשר לרסק עיר שלמה לרצועת פסים זעירה. */
    '<div class="bg-skyline" data-kx="0" data-ky="22">' +
      '<svg viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">' +
        '<defs><linearGradient id="pgbgSky" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#7ea6cd"/><stop offset="100%" stop-color="#1C3A5E"/>' +
        '</linearGradient></defs>' +
        '<g fill="url(#pgbgSky)">' +
          '<rect x="40"   y="120" width="64" height="100" rx="4"/>' +
          '<rect x="112"  y="86"  width="52" height="134" rx="4"/>' +
          '<rect x="172"  y="140" width="70" height="80"  rx="4"/>' +
          '<rect x="340"  y="100" width="58" height="120" rx="4"/>' +
          '<rect x="406"  y="58"  width="74" height="162" rx="5"/>' +
          '<rect x="440"  y="26"  width="5"  height="34"/>' +
          '<rect x="488"  y="132" width="62" height="88"  rx="4"/>' +
          '<rect x="640"  y="110" width="66" height="110" rx="4"/>' +
          '<rect x="714"  y="74"  width="58" height="146" rx="4"/>' +
          '<rect x="780"  y="146" width="74" height="74"  rx="4"/>' +
          '<rect x="956"  y="118" width="60" height="102" rx="4"/>' +
          '<rect x="1024" y="84"  width="70" height="136" rx="4"/>' +
          '<rect x="1102" y="150" width="66" height="70"  rx="4"/>' +
          '<rect x="1266" y="112" width="62" height="108" rx="4"/>' +
          '<rect x="1336" y="142" width="64" height="78"  rx="4"/>' +
          '<path d="M250 220v-56l40-32 40 32v56z"/>' +
          '<path d="M558 220v-50l36-30 36 30v50z"/>' +
          '<path d="M866 220v-58l42-34 42 34v58z"/>' +
          '<path d="M1180 220v-52l38-30 38 30v52z"/>' +
        '</g>' +
      '</svg>' +
    '</div>' +

    wave(1, '0.10', '18', WAVE_D_UP,
      '<stop offset="0%" stop-color="#eef5fc"/>' +
      '<stop offset="55%" stop-color="#d7e7f7" stop-opacity=".6"/>' +
      '<stop offset="100%" stop-color="#cfe2f4" stop-opacity="0"/>', '.3', '1') +

    wave(2, '0.17', '-24', WAVE_D_DOWN,
      '<stop offset="0%" stop-color="#d5e7f7"/>' +
      '<stop offset="55%" stop-color="#a9cbe8" stop-opacity=".6"/>' +
      '<stop offset="100%" stop-color="#9dc4e6" stop-opacity="0"/>', '.35', '1') +

    wave(3, '0.26', '30', WAVE_D_UP,
      '<stop offset="0%" stop-color="#8fbadf"/>' +
      '<stop offset="55%" stop-color="#5b90c0" stop-opacity=".6"/>' +
      '<stop offset="100%" stop-color="#3c74a8" stop-opacity="0"/>', '.35', '1') +

    wave(4, '0.38', '-40', WAVE_D_DOWN,
      '<stop offset="0%" stop-color="#2c5a8c"/><stop offset="100%" stop-color="#1C3A5E"/>', '1', '1');

  /* ---------- הזרימה עם הגלילה ----------
     האופקי מקבל ווראפ ברוחב החלון: שם בדיוק נגמר מחזור גל אחד ב-SVG, ולכן
     הקפיצה בלתי נראית והזרימה נמשכת גם בדף ארוך מאוד. האנכי רץ על סינוס
     מאותה סיבה — הוא עולה ויורד לאורך הדף במקום לברוח מהמסך.

     העדכון עצמו יושב ב-requestAnimationFrame אחד לפריים, כדי שאירועי
     הגלילה לא ייצרו עבודה מיותרת. */
  var host = null;
  var layers = [];
  var ticking = false;
  var reduceMQ = null;
  var stylesInjected = false;

  function still() {
    if (!reduceMQ) reduceMQ = global.matchMedia('(prefers-reduced-motion: reduce)');
    return reduceMQ.matches || document.documentElement.classList.contains('a11y-nomotion');
  }

  function flow() {
    ticking = false;
    if (!layers.length) return;
    if (still()) {
      layers.forEach(function (el) { el.style.transform = ''; });
      return;
    }
    var w = global.innerWidth || 1;
    var y = global.pageYOffset || 0;
    layers.forEach(function (el) {
      var kx = parseFloat(el.dataset.kx) || 0;
      var ky = parseFloat(el.dataset.ky) || 0;
      var x = kx ? -((((y * kx) % w) + w) % w) : 0;
      var dy = ky ? Math.sin(y / 620) * ky : 0;
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
    });
  }

  function refresh() {
    if (ticking || !layers.length) return;
    ticking = true;
    requestAnimationFrame(flow);
  }

  function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-page-bg', '');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function mount() {
    if (typeof document === 'undefined') return null;
    // דף שכבר מצייר את הרקע בעצמו (index.html, agencies.html) לא מקבל שני
    // עותקים — הקיים מנצח, והמאזינים שלו כבר עובדים.
    var existing = document.querySelector('.page-bg');
    if (existing) { host = existing; return host; }

    ensureStyles();
    host = document.createElement('div');
    host.className = 'page-bg';
    host.id = 'pageBg';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML = MARKUP;
    document.body.insertBefore(host, document.body.firstChild);

    layers = [].slice.call(host.querySelectorAll('[data-kx]'));
    global.addEventListener('scroll', refresh, { passive: true });
    global.addEventListener('resize', refresh);
    flow();
    return host;
  }

  function unmount() {
    if (!host) return;
    global.removeEventListener('scroll', refresh);
    global.removeEventListener('resize', refresh);
    if (host.parentNode) host.parentNode.removeChild(host);
    host = null;
    layers = [];
  }

  function isMounted() { return !!host; }

  global.PageBg = {
    mount: mount,
    unmount: unmount,
    isMounted: isMounted,
    refresh: refresh,
  };

  /* ‏data-auto על תגית ה-<script> — הרכבה מיידית, בלי שורת קוד בדף */
  var tag = document.currentScript;
  if (tag && tag.hasAttribute('data-auto')) {
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})(window);
