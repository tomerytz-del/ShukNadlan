/* ============================================================================
   הרקע הזורם של האתר — שכבה אחת לכל הדפים
   ----------------------------------------------------------------------------
   עד כה הרקע הזה היה כתוב פעמיים: פעם ב-index.html ופעם ב-agencies.html,
   וכל שאר הדפים — המשרד, הסוכן/ת והנכס — נשארו על רקע נייר שטוח. הקובץ
   הזה מחזיק את אותו רקע בדיוק במקום אחד, כדי שכל דף שיטען אותו ייראה כמו
   דף הבית וכמו ה-CRM.

   מה שהוא מצייר: שקיעה — אור זהוב־כתום גבוה מהצד, תכלת מולו ותכלת עמוקה
   בתחתית — בארבע הילות רכות מעל רשת דקה. כל הילה נודדת במחזור משלה
   (‏46-70 שניות) וגם מוסטת לפי הגלילה במשרעת משלה, וההפרש בין השכבות הוא
   הפרלקסה. ‏"עדין" כאן הוא דרישה ולא טעם: הרקע יושב מתחת לטקסט.

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
    /* ‏הבסיס הוא "שקיעה": אור זהוב־כתום נכנס מלמעלה־מהצד, והנייר מתקרר
       כלפי מטה לתכלת. שלוש שכבות — שתי הילות אור ומדרג אנכי — ולא צבע
       אחיד, כי הן מה שנותן לדף עומק עוד לפני שמשהו זז. */
    '.page-bg{',
    '  position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;',
    '  background:',
    '    radial-gradient(126% 84% at 82% -14%,rgba(232,161,78,.22) 0%,rgba(241,196,132,.09) 38%,rgba(250,250,252,0) 70%),',
    '    radial-gradient(96% 70% at 6% 4%,rgba(96,180,214,.17) 0%,rgba(250,250,252,0) 68%),',
    /* ‏#fdfcf9 ולא גוון חם ממש: כל החום מגיע מהילת הזהב שמעליו, ובסיס חם
       *וגם* הילת תכלת מעליו נותנים ירקרק־עכור ולא תכלת. */
    '    linear-gradient(180deg,#fdfcf9 0%,#f9fbfc 34%,#f0f7fa 68%,#e6f1f6 100%)}',

    /* ---- כל שכבה היא שתי אלמנטים, ולא אחד ----
       ההורה נושא את ההיסט מהגלילה (‏flow() כותב לו transform בשורה), והילד
       נושא את אנימציית הזמן. שניהם כותבים ל-transform, ואנימציית CSS גוברת
       על סגנון inline — כך ששכבה אחת לא יכולה לשאת את שניהם. */
    '.page-bg .bg-layer{position:absolute;will-change:transform}',
    '.page-bg .bg-layer>i{position:absolute;inset:0;display:block}',

    /* ---- ארבע הילות צבע ----
       ‏"שמש" זהובה־כתומה למעלה, גחלת חמה מתחתיה, תכלת מולן ותכלת עמוקה
       בתחתית: אותה שקיעה של הבסיס, מפורקת לגופים שיכולים לזוז זה מול זה.
       המחזורים לא־שווים ולא כפולות זה של זה (46/54/62/70 שניות), ולכן
       הצירוף לעולם לא חוזר על עצמו בדיוק והעין קוראת תנועה בלי לזהות
       לולאה. איטי בכוונה: ברקע, תנועה שאפשר לעקוב אחריה היא הסחה.

       ‏right/left פיזיים ולא ‎inset-inline-*‎: מיקום לוגי היה מתהפך ב-RTL
       בעוד שהגרדיאנטים של הבסיס (‏at 82%‎ / ‏at 6%‎) נשארים במקומם, ואז
       הזהב יושב בשתי הפינות העליונות במקום באחת — מקור אור אחד הופך
       לשניים והתכלת שמתחת לזהב נקראת ירקרקה. כל האתר ‎dir="rtl"‎, ולכן
       הצד הפיזי הוא הצד היחיד שמחזיק את שתי השכבות מיושרות.

       החום כולו על ימין והקור כולו על שמאל — האלכסון הזה הוא מה שקורא
       כשקיעה. הילה חמה שמונחת מעל תכלת נותנת אפור, לא עניין. */
    '.page-bg .bg-halo>i{border-radius:50%}',
    '.page-bg .bg-halo-sun{top:-20%;right:-8%;width:min(76vw,780px);aspect-ratio:1}',
    '.page-bg .bg-halo-sun>i{',
    '  background:radial-gradient(circle,rgba(230,155,68,.20) 0%,rgba(238,183,110,.07) 44%,rgba(238,183,110,0) 70%);',
    '  animation:bgDriftSun 46s ease-in-out infinite alternate}',
    '.page-bg .bg-halo-ember{top:32%;right:-14%;width:min(58vw,580px);aspect-ratio:1}',
    '.page-bg .bg-halo-ember>i{',
    '  background:radial-gradient(circle,rgba(216,126,62,.11) 0%,rgba(216,126,62,.04) 46%,rgba(216,126,62,0) 72%);',
    '  animation:bgDriftEmber 62s ease-in-out infinite alternate}',
    '.page-bg .bg-halo-sky{top:6%;left:-16%;width:min(68vw,680px);aspect-ratio:1}',
    '.page-bg .bg-halo-sky>i{',
    '  background:radial-gradient(circle,rgba(88,178,204,.19) 0%,rgba(88,178,204,.06) 44%,rgba(88,178,204,0) 70%);',
    '  animation:bgDriftSky 54s ease-in-out infinite alternate}',
    '.page-bg .bg-halo-deep{bottom:-28%;left:2%;width:min(92vw,940px);aspect-ratio:1}',
    '.page-bg .bg-halo-deep>i{',
    '  background:radial-gradient(circle,rgba(30,108,136,.16) 0%,rgba(30,108,136,.05) 46%,rgba(30,108,136,0) 72%);',
    '  animation:bgDriftDeep 70s ease-in-out infinite alternate}',
    '@keyframes bgDriftSun{to{transform:translate3d(-5%,4%,0) scale(1.11)}}',
    '@keyframes bgDriftSky{to{transform:translate3d(6%,-5%,0) scale(1.09)}}',
    '@keyframes bgDriftEmber{to{transform:translate3d(8%,-4%,0) scale(1.13)}}',
    '@keyframes bgDriftDeep{to{transform:translate3d(-6%,-6%,0) scale(1.14)}}',

    /* ---- הרשת ----
       רשת 56px שנודדת באלכסון בדיוק מרווח משבצת אחת, ולכן הלולאה בלתי
       נראית. היא מה שנותן לרקע קנה מידה — בלעדיה ההילות מרחפות בחלל ריק,
       ובלי קנה מידה אין פרלקסה: התנועה של ההילות נמדדת ביחס אליה.
       ‏inset שלילי כדי שהנדידה לא תחשוף קצה. */
    '.page-bg .bg-grid{inset:-70px}',
    '.page-bg .bg-grid>i{',
    '  background-image:',
    '    linear-gradient(rgba(26,92,116,.038) 1px,transparent 1px),',
    '    linear-gradient(90deg,rgba(26,92,116,.038) 1px,transparent 1px);',
    '  background-size:56px 56px;',
    '  animation:bgGridPan 40s linear infinite}',
    '@keyframes bgGridPan{to{transform:translate3d(-56px,-56px,0)}}',

    '@media(prefers-reduced-motion:reduce){',
    '  .page-bg .bg-layer>i{animation:none}}',
    'html.a11y-nomotion .page-bg .bg-layer>i{animation:none}',
    /* מצב ניגודיות גבוהה בתפריט הנגישות מכבה את הרקע לגמרי */
    'html.a11y-contrast .page-bg{display:none !important}',
  ].join('\n');

  /* ---------- שכבות הרקע ----------
     ‏data-ky ו-data-kx הם משרעת הנדנוד בפיקסלים ביחס לגלילה — זו הפרלקסה:
     ההילה הקרובה (deep, 44) נעה הכי הרבה, הרחוקה (sun, 9) כמעט לא, והרשת
     נעה מעט בכיוון ההפוך ומספקת את נקודת הייחוס שביחס אליה התנועה נקראת.
     סימנים מנוגדים בין שכבות שכנות: שתי שכבות שנעות יחד נקראות כשכבה אחת,
     והעומק מגיע דווקא מכך שהן נפרדות.

     ‏data-kx כאן הוא משרעת ולא מהירות: היסט אופקי מצטבר עם ווראפ ברוחב
     החלון עבד על גלים ברוחב 300%, אבל על הילה עגולה הוא היה חושף את הקצה
     בכל מחזור. משרעת חסומה שומרת כל הילה במקומה ועדיין מזיזה אותה. */
  function layer(cls, kx, ky) {
    return '<span class="bg-layer ' + cls + '" data-kx="' + kx + '" data-ky="' + ky + '"><i></i></span>';
  }

  var MARKUP =
    layer('bg-halo bg-halo-sun', '7', '9') +
    layer('bg-halo bg-halo-ember', '13', '28') +
    layer('bg-halo bg-halo-sky', '-11', '-20') +
    layer('bg-halo bg-halo-deep', '-15', '44') +
    layer('bg-grid', '0', '-12');

  /* ---------- הזרימה עם הגלילה ----------
     שני הצירים רצים על סינוס, ולכן שכבה לעולם לא בורחת מהמסך גם בדף ארוך
     מאוד — היא עולה ויורדת לאורכו. המכנים שונים (‏620 אנכית, 940 אופקית)
     כדי שהשניים לא יהיו בפאזה: אחרת כל הילה הייתה נעה על קו אלכסוני אחד,
     ובמקום ריחוף היה יוצא שרטוט.

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
    var y = global.pageYOffset || 0;
    layers.forEach(function (el) {
      var kx = parseFloat(el.dataset.kx) || 0;
      var ky = parseFloat(el.dataset.ky) || 0;
      var dx = kx ? Math.sin(y / 940) * kx : 0;
      var dy = ky ? Math.sin(y / 620) * ky : 0;
      el.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
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
