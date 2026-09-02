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
    /* ‏z-index:-1 מציב את השכבה מתחת לכל תוכן הדף אבל מעל רקע ה-body, ולכן
       צבע הנייר שעל ה-body נשאר רק כרשת ביטחון אם הדפדפן לא צייר אותה. */
    '.page-bg{',
    '  position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;',
    '  background:linear-gradient(180deg,#f7f9ff 0%,#eef3fd 46%,#e7eefb 100%)}',

    /* ---- כל שכבה היא שתי אלמנטים, ולא אחד ----
       ההורה נושא את ההיסט מהגלילה (‏flow() כותב לו transform בשורה), והילד
       נושא את אנימציית הזמן. שניהם כותבים ל-transform, ואנימציית CSS גוברת
       על סגנון inline — כך ששכבה אחת לא יכולה לשאת את שניהם. */
    '.page-bg .bg-layer{position:absolute;will-change:transform}',
    '.page-bg .bg-layer>i{position:absolute;inset:0;display:block}',

    /* ---- שלוש הילות צבע ----
       הרקע הקודם צייר שמש, קו רקיע של עיר וארבעה גלים: איור מלא שהתחרה
       בתוכן שמעליו. במקומו שלוש הילות רכות שנעות זו מול זו במחזורים
       לא־שווים (26/32/38 שניות), כך שהצירוף לעולם לא חוזר על עצמו בדיוק
       והעין קוראת תנועה בלי לזהות לולאה. שתיים בספיר ואחת בזהב. */
    '.page-bg .bg-halo>i{border-radius:50%}',
    '.page-bg .bg-halo-1{top:-18%;inset-inline-end:-6%;width:min(74vw,760px);aspect-ratio:1}',
    '.page-bg .bg-halo-1>i{',
    '  background:radial-gradient(circle,rgba(14,42,107,.16) 0%,rgba(14,42,107,.06) 42%,rgba(14,42,107,0) 70%);',
    '  animation:bgDriftA 26s ease-in-out infinite alternate}',
    '.page-bg .bg-halo-2{top:10%;inset-inline-start:-14%;width:min(66vw,660px);aspect-ratio:1}',
    '.page-bg .bg-halo-2>i{',
    '  background:radial-gradient(circle,rgba(201,162,39,.15) 0%,rgba(201,162,39,.05) 44%,rgba(201,162,39,0) 70%);',
    '  animation:bgDriftB 32s ease-in-out infinite alternate}',
    '.page-bg .bg-halo-3{bottom:-26%;inset-inline-end:16%;width:min(88vw,900px);aspect-ratio:1}',
    '.page-bg .bg-halo-3>i{',
    '  background:radial-gradient(circle,rgba(28,63,142,.14) 0%,rgba(28,63,142,.05) 46%,rgba(28,63,142,0) 72%);',
    '  animation:bgDriftC 38s ease-in-out infinite alternate}',
    '@keyframes bgDriftA{to{transform:translate3d(-6%,4%,0) scale(1.12)}}',
    '@keyframes bgDriftB{to{transform:translate3d(7%,-5%,0) scale(1.09)}}',
    '@keyframes bgDriftC{to{transform:translate3d(-5%,-6%,0) scale(1.14)}}',

    /* ---- הרשת ----
       רשת 56px שנודדת באלכסון בדיוק מרווח משבצת אחת, ולכן הלולאה בלתי
       נראית. היא מה שנותן לרקע קנה מידה — בלעדיה ההילות מרחפות בחלל ריק.
       ‏inset שלילי כדי שהנדידה לא תחשוף קצה. */
    '.page-bg .bg-grid{inset:-70px}',
    '.page-bg .bg-grid>i{',
    '  background-image:',
    '    linear-gradient(rgba(14,42,107,.045) 1px,transparent 1px),',
    '    linear-gradient(90deg,rgba(14,42,107,.045) 1px,transparent 1px);',
    '  background-size:56px 56px;',
    '  animation:bgGridPan 24s linear infinite}',
    '@keyframes bgGridPan{to{transform:translate3d(-56px,-56px,0)}}',

    '@media(prefers-reduced-motion:reduce){',
    '  .page-bg .bg-layer>i{animation:none}}',
    'html.a11y-nomotion .page-bg .bg-layer>i{animation:none}',
    /* מצב ניגודיות גבוהה בתפריט הנגישות מכבה את הרקע לגמרי */
    'html.a11y-contrast .page-bg{display:none !important}',
  ].join('\n');

  /* ---------- שכבות הרקע ----------
     ‏data-ky הוא משרעת הנדנוד האנכי בפיקסלים ביחס לגלילה — זו הפרלקסה:
     ההילה הקרובה (3) נעה הכי הרבה, הרחוקה (1) כמעט לא, והרשת נעה מעט
     בכיוון ההפוך ומספקת את נקודת הייחוס שביחס אליה התנועה נקראת.
     ‏data-kx נשאר 0 בכל השכבות: היסט אופקי עם ווראפ ברוחב החלון עבד על
     גלים ברוחב 300%, אבל על הילה עגולה הוא היה חושף את הקצה בכל מחזור. */
  function layer(cls, ky) {
    return '<span class="bg-layer ' + cls + '" data-kx="0" data-ky="' + ky + '"><i></i></span>';
  }

  var MARKUP =
    layer('bg-halo bg-halo-1', '10') +
    layer('bg-halo bg-halo-2', '-18') +
    layer('bg-halo bg-halo-3', '30') +
    layer('bg-grid', '-8');

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
