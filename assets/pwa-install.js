/* ============================================================================
   כפתור "התקנת האפליקציה" — אנדרואיד, אייפון ומק
   ----------------------------------------------------------------------------
   האתר הוא PWA: דפדפן יודע להתקין אותו כאפליקציה עם אייקון במסך הבית,
   בלי חנות אפליקציות ובלי קובץ להוריד. הבעיה היא שהדרך אל ההתקנה מוסתרת
   בתפריט שלוש הנקודות של הדפדפן — "התקנה ויצירת קיצור דרך" — ומי שמקבל/ת
   קישור בוואטסאפ לא יודע/ת שהיא שם. הקובץ הזה מביא את ההתקנה אל הדף.

   ‏**שלוש מציאויות שונות, ולכן שלוש התנהגויות:**

   ‏1. **כרום/אדג'/סמסונג (אנדרואיד ומחשב)** — הדפדפן יורה
      ‎beforeinstallprompt‎ כשהדף עומד בתנאי ההתקנה. אנחנו עוצרים את
      האירוע, שומרים אותו, ומציגים כפתור משלנו. לחיצה עליו מריצה
      ‎prompt()‎ — אותו דיאלוג התקנה של המערכת, בלחיצה אחת מתוך הדף.

   ‏2. **ספארי באייפון ובאייפד** — **אין API כזה.** אפל לא מימשה את
      ‎beforeinstallprompt‎, ואין שום דרך לפתוח את ההתקנה מקוד. הדרך
      היחידה היא כפתור השיתוף של ספארי ← "הוספה למסך הבית", ולכן שם
      הכפתור פותח הסבר מדויק עם האייקונים שרואים במסך. זו אינה עצלות
      אלא הקיר: כל ספרייה שמבטיחה "התקנה בלחיצה" באייפון מציגה בדיוק
      את אותו הסבר.

   ‏3. **ספארי במק (17 ומעלה)** — "הוספה ל-Dock" בתפריט. אין שם באנר
      אוטומטי (במחשב זה רעש), רק הסבר למי שלוחץ/ת על כפתור בדף.

   ‏**מה שהמשתמש/ת רואה:** רצועה בתחתית המסך עם אייקון האפליקציה, משפט
   אחד, כפתור פעולה ו-✕. היא נעלמת לשבועיים בסגירה, ולתמיד אחרי התקנה.
   המשתמש/ת אינו/ה רואה אותה בכלל כשהאפליקציה כבר פתוחה כאפליקציה.

   ‏**הכללה בדף** — שורה אחת, וזה כל מה שצריך:

       <script defer src="assets/pwa-install.js"></script>

   בדף שיש בו אלמנטים קבועים בתחתית המסך (‏ב-CRM: סרגל הניווט וכפתור
   ההחתמה הצף), כדי שהרצועה תשב מעליהם ולא תכסה אותם:

       <script defer src="assets/pwa-install.js" data-bottom="124px"></script>

   דף שהוא תהליך — תשלום, חתימה, בקשת חוות דעת — מקבל ‎data-no-auto‎:
   הרצועה לא עולה שם מעצמה, כי הפרעה באמצע תשלום עולה יותר ממה שהתקנה
   שווה. הכפתור בתפריט (למטה) עדיין עובד.

       <script defer src="assets/pwa-install.js" data-no-auto></script>

   ‏**כפתור קבוע בדף** (תפריט, פוטר) — כל אלמנט עם ‎data-pwa-install‎
   הופך לנקודת כניסה: לחיצה עליו מתקינה, או פותחת את ההסבר באייפון.
   אלמנט כזה מוסתר לגמרי כשהדפדפן לא יודע להתקין, כדי שלא יישאר כפתור
   שלא עושה דבר:

       <button type="button" data-pwa-install hidden>התקנת האפליקציה</button>

   ‏**גישה (‏a11y):** הרצועה היא ‎region‎ ולא דיאלוג — היא לא חוטפת פוקוס
   ולא חוסמת את הדף. חלון ההסבר כן דיאלוג: ‎aria-modal‎, פוקוס נכנס
   אליו, ‎Tab‎ לכוד בתוכו, ‎Esc‎ סוגר, והפוקוס חוזר לכפתור שפתח. כל
   היעדים 44px לפחות, הטקסט ב-rem (מכבד הגדלת גופן במערכת), והתנועה
   מבוטלת ב-‎prefers-reduced-motion‎.

   ‏**מדידה:** דרך ‎shukTrack‎ אם הוא קיים בדף. דפי האזור האישי אינם
   טוענים את ‎events.js‎ במכוון (ראו CLAUDE.md), ושם המדידה פשוט לא
   קורית — הכפתור עובד בדיוק אותו דבר.

   התיעוד המלא: ‎docs/pwa-install.md‎.
   ========================================================================== */
(function () {
  'use strict';

  var SW_URL = '/sw.js';
  var ICON_URL = '/assets/icon-192.png';

  /* כמה זמן שקט אחרי ✕. שבועיים: מספיק כדי לא להציק למי שאמר/ה לא,
     וקצר מספיק כדי לתפוס את מי שבינתיים הפך/ה למשתמש/ת קבוע/ה. */
  var SNOOZE_DAYS = 14;

  /* הרצועה עולה אחרי שהדף כבר עומד. באנר שקופץ תוך כדי טעינה נסגר
     ברפלקס, והמשתמש/ת אפילו לא קרא/ה מה היה כתוב בו. */
  var SHOW_DELAY_MS = 2600;

  var K_SNOOZE = 'shukPwaSnoozedAt';
  var K_INSTALLED = 'shukPwaInstalled';

  // ------------------------------------------------------------------
  // אחסון — עטוף תמיד. בגלישה פרטית באייפון עצם הגישה ל-localStorage
  // זורקת, וכישלון שם לא יכול להפיל את הכפתור.
  // ------------------------------------------------------------------
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* אחסון חסום */ }
  }

  function track(name, params) {
    try {
      if (typeof window.shukTrack === 'function') window.shukTrack(name, params || {});
    } catch (e) { /* מדידה לא שוברת אתר */ }
  }

  // ------------------------------------------------------------------
  // זיהוי הסביבה
  // ------------------------------------------------------------------
  var ua = navigator.userAgent || '';

  /* אייפד מודרני מדווח על עצמו כ-Macintosh, ולכן ‎maxTouchPoints‎ הוא מה
     שמבדיל בינו לבין מק. בלי הבדיקה הזו כל בעלי האייפדים היו מקבלים את
     ההסבר של המק, כלומר הסבר שאין לו שום קשר למסך שלפניהם. */
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
              (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  var isMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) <= 1;

  /* דפדפן אחר בתוך אייפון (‏CriOS = כרום, FxiOS = פיירפוקס, EdgiOS =
     אדג'). כולם מנוע ספארי, וברובם יש "הוספה למסך הבית" בתפריט השיתוף
     שלהם — אבל לא באותו מקום, ולכן ההסבר שונה. */
  var iosOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome/i.test(ua);

  /* דפדפן פנימי של אפליקציה (‏פייסבוק, אינסטגרם, לינקדאין, טיקטוק).
     שם אין הוספה למסך הבית בכלל, ולכן ההסבר היחיד שעוזר הוא "לפתוח
     בדפדפן". זה המקרה הכי שכיח בקישור שמגיע מרשת חברתית. */
  var isInAppBrowser = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|TikTok|MicroMessenger/i.test(ua);

  function isStandalone() {
    try {
      if (window.navigator.standalone === true) return true;           // אייפון
      if (!window.matchMedia) return false;
      return ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay']
        .some(function (mode) {
          return window.matchMedia('(display-mode: ' + mode + ')').matches;
        });
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------
  // רישום ה-Service Worker
  //
  // בלעדיו כרום לא יורה beforeinstallprompt, כלומר אין כפתור. הוא לא
  // שומר מטמון (ראו ההסבר ב-sw.js), ולכן רישום כושל אינו משנה דבר
  // מלבד היעדר ההתקנה — ואת זה אין טעם להציג למשתמש/ת.
  // ------------------------------------------------------------------
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    try {
      navigator.serviceWorker.register(SW_URL, { scope: '/' })['catch'](function (err) {
        console.warn('‏רישום Service Worker נכשל:', err);
      });
    } catch (e) { /* דפדפן שחוסם — האתר ממשיך לעבוד בלי התקנה */ }
  }

  // ------------------------------------------------------------------
  // מצב הפעולה
  // ------------------------------------------------------------------
  var deferredPrompt = null;      // האירוע של כרום, כשהגיע
  var bar = null;                 // הרצועה בתחתית המסך
  var dialog = null;              // חלון ההסבר
  var lastFocused = null;         // למי להחזיר את הפוקוס בסגירת החלון
  var barShown = false;

  /* 'prompt'     — יש API להתקנה (כרום/אדג'/סמסונג)
     'ios'        — ספארי באייפון/אייפד: הסבר
     'ios-other'  — דפדפן אחר באייפון: הסבר משלו
     'in-app'     — דפדפן פנימי של אפליקציה: צריך לצאת לדפדפן
     'mac-safari' — מק: הסבר, בלי באנר אוטומטי
     null         — אין מה להציע */
  function mode() {
    if (deferredPrompt) return 'prompt';
    if (isIOS) {
      if (isInAppBrowser) return 'in-app';
      return iosOtherBrowser ? 'ios-other' : 'ios';
    }
    if (isMac && /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
    return null;
  }

  /* האם יש בכלל מה להציע כאן ועכשיו. זה המבחן של כל נקודת כניסה קבועה
     בדף (כפתור בתפריט, פריט בפוטר) — להבדיל מהרצועה האוטומטית, שיש לה
     גם תקופת שקט. */
  function canOffer() {
    return !!mode() && !isStandalone() && readStore(K_INSTALLED) !== '1';
  }

  function canAutoShow(m) {
    if (!m || m === 'mac-safari') return false;          // במחשב — רק בלחיצה יזומה
    if (readStore(K_INSTALLED) === '1') return false;
    var snoozed = parseInt(readStore(K_SNOOZE) || '0', 10);
    if (snoozed && (Date.now() - snoozed) < SNOOZE_DAYS * 864e5) return false;
    return true;
  }

  // ------------------------------------------------------------------
  // סגנון — מוזרק מהקובץ ולא נשען על CSS של הדף
  //
  // שני דפים באתר (‏crm, neighborhood-boundary) אינם טוענים את
  // design-system.css, ורצועה שנשענת עליו הייתה נראית שם שבורה. הערכים
  // כאן הם הטוקנים של המערכת כלשונם: ספיר #0e2a6b, זהב #c9a227.
  // ------------------------------------------------------------------
  var CSS = [
    /* ---- הרצועה ----
       שתי שורות בטלפון צר ושורה אחת מ-430px ומעלה. בפריסה של שורה אחת
       בלבד נשארו לטקסט בעברית כ-120px באייפון, והכותרת נשברה לשתי שורות
       והמשפט לארבע — רצועה בגובה חצי מסך. הכפתור יורד לשורה משלו, ואז
       גם היעד שלו רחב לכל הרוחב. */
    '.shuk-pwa{position:fixed;z-index:2147483000;inset-inline:12px;',
    '  bottom:calc(var(--shuk-pwa-bottom,0px) + env(safe-area-inset-bottom,0px) + 12px);',
    '  display:grid;gap:10px 12px;align-items:center;max-width:520px;margin:0 auto;',
    '  grid-template-columns:auto 1fr auto;',
    '  grid-template-areas:"icon text x" "cta cta cta";',
    '  padding:12px 14px;border-radius:16px;direction:rtl;',
    '  background:linear-gradient(140deg,#13306f 0%,#0e2a6b 55%,#0d1b3d 100%);',
    '  color:#fff;font-family:Heebo,system-ui,-apple-system,sans-serif;',
    '  box-shadow:0 12px 34px rgba(13,27,61,.34);border:1px solid rgba(255,255,255,.14);',
    '  transform:translateY(130%);transition:transform .32s cubic-bezier(.2,.8,.3,1)}',
    '.shuk-pwa.is-open{transform:translateY(0)}',
    '.shuk-pwa__icon{grid-area:icon;width:46px;height:46px;border-radius:12px;',
    '  box-shadow:0 2px 8px rgba(0,0,0,.28)}',
    '.shuk-pwa__text{grid-area:text;min-width:0;line-height:1.35}',
    '.shuk-pwa__title{display:block;font-size:.95rem;font-weight:700}',
    '.shuk-pwa__sub{display:block;font-size:.78rem;color:#dbe4f7}',
    '.shuk-pwa__cta{grid-area:cta;min-height:44px;padding:0 18px;border:0;border-radius:11px;',
    '  background:#c9a227;color:#12203f;font-family:inherit;font-size:.92rem;font-weight:800;',
    '  cursor:pointer}',
    '.shuk-pwa__cta:hover{background:#e5c76a}',
    '.shuk-pwa__x{grid-area:x;width:34px;height:34px;min-height:34px;border:0;border-radius:50%;',
    '  background:rgba(255,255,255,.12);color:#fff;font-size:1rem;line-height:1;cursor:pointer;',
    '  font-family:inherit}',
    '.shuk-pwa__x:hover{background:rgba(255,255,255,.24)}',
    '@media(min-width:430px){.shuk-pwa{grid-template-columns:auto 1fr auto auto;',
    '  grid-template-areas:"icon text cta x"}}',
    '.shuk-pwa :focus-visible,.shuk-pwa-help :focus-visible{outline:3px solid #ffd76a;outline-offset:2px}',
    /* ---- חלון ההסבר ---- */
    '.shuk-pwa-help{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:flex-end;',
    '  justify-content:center;background:rgba(13,27,61,.55);direction:rtl;',
    '  font-family:Heebo,system-ui,-apple-system,sans-serif}',
    '.shuk-pwa-help__box{width:100%;max-width:460px;background:#fff;color:#0d1b3d;',
    '  border-radius:20px 20px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px));',
    '  max-height:88vh;overflow:auto;box-shadow:0 -10px 40px rgba(13,27,61,.3)}',
    '@media(min-width:560px){.shuk-pwa-help{align-items:center}',
    '  .shuk-pwa-help__box{border-radius:20px;margin:16px}}',
    '.shuk-pwa-help__head{display:flex;align-items:center;gap:12px;margin-bottom:6px}',
    /* גבול דק: האייקון בהיר (פין ספיר על נייר), וחלון ההסבר לבן — בלעדיו
       הפינות שלו נעלמות ברקע והוא נראה כמו פין מרחף */
    '.shuk-pwa-help__icon{width:44px;height:44px;border-radius:11px;flex:0 0 auto;',
    '  border:1px solid rgba(13,27,61,.12)}',
    '.shuk-pwa-help__title{margin:0;font-size:1.12rem;font-weight:800;color:#0e2a6b}',
    '.shuk-pwa-help__lead{margin:0 0 14px;font-size:.88rem;color:#4a5578;line-height:1.5}',
    '.shuk-pwa-help__steps{margin:0 0 16px;padding:0;list-style:none;counter-reset:s}',
    '.shuk-pwa-help__steps li{counter-increment:s;position:relative;',
    '  padding-inline-start:40px;margin-bottom:14px;font-size:.92rem;line-height:1.55}',
    '.shuk-pwa-help__steps li::before{content:counter(s);position:absolute;inset-inline-start:0;top:0;',
    '  width:28px;height:28px;border-radius:50%;background:#0e2a6b;color:#fff;',
    '  font-size:.85rem;font-weight:700;display:flex;align-items:center;justify-content:center}',
    '.shuk-pwa-help__steps b{color:#0e2a6b}',
    '.shuk-pwa-ico{display:inline-block;vertical-align:-5px;margin:0 2px;width:20px;height:20px;',
    '  fill:none;stroke:#0e2a6b;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    '.shuk-pwa-help__done{width:100%;min-height:48px;border:0;border-radius:12px;background:#0e2a6b;',
    '  color:#fff;font-family:inherit;font-size:1rem;font-weight:700;cursor:pointer}',
    '.shuk-pwa-help__done:hover{background:#08194a}',
    '.shuk-pwa-help__copy{width:100%;min-height:44px;margin-bottom:10px;border:1.5px solid #0e2a6b;',
    '  border-radius:12px;background:#fff;color:#0e2a6b;font-family:inherit;font-size:.92rem;',
    '  font-weight:700;cursor:pointer}',
    /* מי שביקש/ה פחות תנועה מקבל/ת את אותה רצועה בלי ההחלקה */
    '@media(prefers-reduced-motion:reduce){.shuk-pwa{transition:none}}',
    /* מצב ניגודיות כפויה (‏Windows): הגרדיאנט נעלם, וצריך גבול כדי
       שהרצועה לא תיראה כטקסט צף על הדף */
    '@media(forced-colors:active){.shuk-pwa,.shuk-pwa-help__box{border:2px solid CanvasText}',
    '  .shuk-pwa__cta,.shuk-pwa-help__done{border:2px solid CanvasText}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('shuk-pwa-style')) return;
    var style = document.createElement('style');
    style.id = 'shuk-pwa-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // עוזרי DOM
  //
  // הכול נבנה ב-createElement ו-textContent, בלי innerHTML אחד. אין כאן
  // ערך שמגיע מהמסד או מהמשתמש/ת, אבל מודול שמרכיב DOM בלי innerHTML
  // גם לא יכול להיות הווקטור הבא — וזו הסיבה שאין בקובץ הזה בריחה משלו
  // (ראו CLAUDE.md, "בריחת HTML").
  // ------------------------------------------------------------------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* אייקון קווי קטן בתוך משפט. ‏aria-hidden: ההסבר עומד בזכות הטקסט,
     והציור הוא עזר ויזואלי בלבד — קורא/ת מסך לא צריך/ה לשמוע אותו. */
  function icon(paths, viewBox) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox || '0 0 24 24');
    svg.setAttribute('class', 'shuk-pwa-ico');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    paths.forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // כפתור השיתוף של אפל: ריבוע עם חץ שיוצא כלפי מעלה
  function shareIcon() {
    return icon(['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7']);
  }
  // "הוספה למסך הבית": ריבוע עם פלוס
  function plusBoxIcon() {
    return icon(['M4 4h16v16H4z', 'M12 8v8', 'M8 12h8']);
  }

  /* משפט שמורכב מטקסט ואייקונים לסירוגין. מחרוזת נכנסת כטקסט, אלמנט
     נכנס כמו שהוא. */
  function line(parts) {
    var li = document.createElement('li');
    parts.forEach(function (part) {
      if (typeof part === 'string') li.appendChild(document.createTextNode(part));
      else li.appendChild(part);
    });
    return li;
  }

  function strong(text) { return el('b', null, text); }

  // ------------------------------------------------------------------
  // הרצועה
  // ------------------------------------------------------------------
  /* הטקסט קצר בכוונה. הרצועה יושבת מעל התוכן, והמשפט נקרא בעברית בטלפון
     צר — כל מילה מיותרת בו הופכת לשורה נוספת שמכסה את הדף. */
  var COPY = {
    'prompt':     { cta: 'התקנה',        sub: 'בלחיצה אחת, בלי חנות אפליקציות' },
    'ios':        { cta: 'איך מוסיפים?', sub: 'שתי לחיצות בספארי, ויש לכם אפליקציה' },
    'ios-other':  { cta: 'איך מוסיפים?', sub: 'אפשר להוסיף את האתר כאפליקציה' },
    'in-app':     { cta: 'איך מוסיפים?', sub: 'אפשר להוסיף את האתר כאפליקציה' },
    'mac-safari': { cta: 'איך מוסיפים?', sub: 'אפשר להוסיף את האתר ל-Dock' }
  };

  function buildBar(m) {
    var copy = COPY[m] || COPY['prompt'];

    var wrap = el('div', 'shuk-pwa');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'התקנת האפליקציה של שוק נדל״ן');

    var img = document.createElement('img');
    img.className = 'shuk-pwa__icon';
    img.src = ICON_URL;
    img.width = 46;
    img.height = 46;
    img.alt = '';                       // דקורטיבי: הכיתוב שלצידו אומר הכול
    img.setAttribute('aria-hidden', 'true');
    wrap.appendChild(img);

    var text = el('span', 'shuk-pwa__text');
    text.appendChild(el('strong', 'shuk-pwa__title', 'שוק נדל״ן במסך הבית'));
    text.appendChild(el('span', 'shuk-pwa__sub', copy.sub));
    wrap.appendChild(text);

    var cta = el('button', 'shuk-pwa__cta', copy.cta);
    cta.type = 'button';
    cta.addEventListener('click', function () { activate(m, cta); });
    wrap.appendChild(cta);

    /* ✕ הוא טקסט לעין ותווית מפורשת לקורא/ת מסך. ‏"לא עכשיו" ולא
       "סגירה": זו המשמעות בפועל — הרצועה תחזור בעוד שבועיים. */
    var close = el('button', 'shuk-pwa__x', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'לא עכשיו — הסתרת ההצעה להתקנה');
    close.addEventListener('click', function () {
      writeStore(K_SNOOZE, String(Date.now()));
      track('pwa_banner_dismiss', { mode: m });
      hideBar();
    });
    wrap.appendChild(close);

    return wrap;
  }

  function showBar(m) {
    if (barShown || isStandalone()) return;
    if (!document.body) return;
    barShown = true;
    injectStyle();

    bar = buildBar(m);
    if (BOTTOM_OFFSET) bar.style.setProperty('--shuk-pwa-bottom', BOTTOM_OFFSET);
    document.body.appendChild(bar);

    /* פריים אחד לפני הוספת המחלקה, אחרת הדפדפן מחשב את שני המצבים יחד
       ואין מעבר — הרצועה פשוט מופיעה. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (bar) bar.classList.add('is-open'); });
    });

    track('pwa_banner_shown', { mode: m });
  }

  function hideBar() {
    if (!bar) return;
    var node = bar;
    bar = null;
    node.classList.remove('is-open');
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 340);
  }

  // ------------------------------------------------------------------
  // הפעולה עצמה
  // ------------------------------------------------------------------
  function activate(m, source) {
    track('pwa_install_click', { mode: m });

    if (m === 'prompt' && deferredPrompt) {
      var evt = deferredPrompt;
      deferredPrompt = null;            // אירוע כזה ניתן לצריכה פעם אחת בלבד
      hideBar();
      try {
        evt.prompt();
        var choice = evt.userChoice;
        if (choice && typeof choice.then === 'function') {
          choice.then(function (res) {
            var outcome = (res && res.outcome) || 'unknown';
            track('pwa_install_result', { outcome: outcome });
            /* "לא עכשיו" בדיאלוג של המערכת הוא אותה תשובה כמו ✕ שלנו,
               ומגיעה לה אותה תקופת שקט. אחרת הרצועה הייתה חוזרת מיד
               בדף הבא — בדיוק אחרי שנאמר לא. */
            if (outcome !== 'accepted') writeStore(K_SNOOZE, String(Date.now()));
          });
        }
      } catch (e) {
        console.warn('‏בקשת ההתקנה נכשלה:', e);
      }
      return;
    }

    openHelp(m, source || null);
  }

  // ------------------------------------------------------------------
  // חלון ההסבר — אייפון, אייפד, מק, ודפדפן פנימי של אפליקציה
  // ------------------------------------------------------------------
  function helpContent(m) {
    var frag = document.createDocumentFragment();

    var lead = el('p', 'shuk-pwa-help__lead');
    var steps = el('ol', 'shuk-pwa-help__steps');

    if (m === 'in-app') {
      lead.textContent =
        'הדף פתוח כרגע בתוך אפליקציה אחרת, ומשם אי אפשר להוסיף למסך הבית. ' +
        'צריך לפתוח אותו קודם בדפדפן עצמו:';
      steps.appendChild(line([
        'לחצו על ', strong('שלוש הנקודות'), ' בפינת המסך ובחרו ',
        strong('"פתח בדפדפן"'), ' (או "פתח בספארי").'
      ]));
      steps.appendChild(line([
        'בדפדפן שנפתח, לחצו על כפתור השיתוף ', shareIcon()
      ]));
      steps.appendChild(line([
        'בחרו ', strong('"הוספה למסך הבית"'), ' ', plusBoxIcon(), ' ואשרו.'
      ]));
    } else if (m === 'mac-safari') {
      lead.textContent = 'בספארי במק האתר נוסף ל-Dock ונפתח בחלון משלו, כמו אפליקציה:';
      steps.appendChild(line([
        'בשורת התפריטים למעלה, פתחו את התפריט ', strong('"קובץ"'), ' (File).'
      ]));
      steps.appendChild(line([
        'בחרו ', strong('"הוספה ל-Dock"'), ' (Add to Dock). בגרסאות ישנות יותר של ספארי ',
        'האפשרות נמצאת תחת כפתור השיתוף ', shareIcon()
      ]));
      steps.appendChild(line(['אשרו ב', strong('"הוספה"'), '. האייקון יופיע ב-Dock.']));
    } else if (m === 'ios-other') {
      lead.textContent =
        'באייפון ההוספה למסך הבית נעשית מתפריט השיתוף של הדפדפן. הדרך הבטוחה ' +
        'ביותר היא דרך ספארי:';
      steps.appendChild(line([
        'לחצו על כפתור ', strong('השיתוף'), ' ', shareIcon(),
        ' בסרגל הדפדפן (בכרום — שלוש הנקודות ואז "שיתוף").'
      ]));
      steps.appendChild(line([
        'גללו ובחרו ', strong('"הוספה למסך הבית"'), ' ', plusBoxIcon()
      ]));
      steps.appendChild(line([
        'לא מוצאים את האפשרות? פתחו את הכתובת ב', strong('ספארי'),
        ' ובצעו שם את שני השלבים — שם היא תמיד קיימת.'
      ]));
    } else {
      /* ‏'ios' — ספארי באייפון/אייפד, המסלול המרכזי */
      lead.textContent =
        'באייפון ובאייפד ההתקנה נעשית מתוך ספארי, בשתי לחיצות. אחריהן האתר ' +
        'יושב במסך הבית עם אייקון משלו ונפתח במסך מלא, בלי סרגלי הדפדפן:';
      steps.appendChild(line([
        'לחצו על כפתור ', strong('השיתוף'), ' ', shareIcon(),
        ' — באייפון הוא באמצע הסרגל התחתון, באייפד בפינה העליונה.'
      ]));
      steps.appendChild(line([
        'גללו ברשימה ובחרו ', strong('"הוספה למסך הבית"'), ' ', plusBoxIcon()
      ]));
      steps.appendChild(line([
        'לחצו ', strong('"הוספה"'), ' בפינה. האייקון של שוק נדל״ן יופיע במסך הבית.'
      ]));
    }

    frag.appendChild(lead);
    frag.appendChild(steps);
    return frag;
  }

  function focusables(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')
    ).filter(function (node) {
      /* ‏offsetParent אינו מדד טוב כאן — אלמנט בתוך משטח ‎position:fixed‎
         מחזיר ערכים לא צפויים בין דפדפנים. מה שנמדד הוא מה שבאמת תופס
         מקום במסך. */
      return !node.hidden && node.getClientRects().length > 0;
    });
  }

  function openHelp(m, source) {
    if (dialog) return;
    injectStyle();
    lastFocused = source || document.activeElement;

    var overlay = el('div', 'shuk-pwa-help');
    var box = el('div', 'shuk-pwa-help__box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'shukPwaHelpTitle');

    var head = el('div', 'shuk-pwa-help__head');
    var img = document.createElement('img');
    img.className = 'shuk-pwa-help__icon';
    img.src = ICON_URL;
    img.width = 44;
    img.height = 44;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    head.appendChild(img);

    var title = el('h2', 'shuk-pwa-help__title',
      m === 'mac-safari' ? 'הוספת האתר ל-Dock' : 'הוספה למסך הבית');
    title.id = 'shukPwaHelpTitle';
    head.appendChild(title);
    box.appendChild(head);

    box.appendChild(helpContent(m));

    /* העתקת הקישור — למי שצריך/ה לעבור לדפדפן אחר כדי להשלים את
       ההוספה. בלי זה השלב "פתחו בספארי" דורש להקליד כתובת מהזיכרון. */
    if (m === 'in-app' || m === 'ios-other') {
      var copy = el('button', 'shuk-pwa-help__copy', 'העתקת הקישור לדף');
      copy.type = 'button';
      copy.addEventListener('click', function () {
        var done = function () { copy.textContent = '✓ הקישור הועתק'; };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(location.href).then(done, function () {
              copy.textContent = location.href;
            });
          } else {
            copy.textContent = location.href;   // אין הרשאה — לפחות שיהיה לסימון ידני
          }
        } catch (e) {
          copy.textContent = location.href;
        }
      });
      box.appendChild(copy);
    }

    var done = el('button', 'shuk-pwa-help__done', 'הבנתי');
    done.type = 'button';
    done.addEventListener('click', closeHelp);
    box.appendChild(done);

    overlay.appendChild(box);

    /* לחיצה על הרקע סוגרת; לחיצה בתוך החלון לא. */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeHelp();
    });

    document.body.appendChild(overlay);
    dialog = overlay;

    document.addEventListener('keydown', onHelpKeydown, true);
    done.focus();

    track('pwa_help_open', { mode: m });
  }

  /* ‏Esc סוגר, ו-Tab לכוד בתוך החלון. בלי הלכידה הפוקוס ממשיך אל הדף
     שמאחור — שנראה מוסתר, אבל קורא/ת מסך ומקלדת עדיין מגיעים אליו. */
  function onHelpKeydown(e) {
    if (!dialog) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      closeHelp();
      return;
    }
    if (e.key !== 'Tab') return;

    var items = focusables(dialog);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }

  function closeHelp() {
    if (!dialog) return;
    document.removeEventListener('keydown', onHelpKeydown, true);
    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    dialog = null;
    try { if (lastFocused && lastFocused.focus) lastFocused.focus(); } catch (e) { /* הכפתור כבר לא בדף */ }
    lastFocused = null;
  }

  // ------------------------------------------------------------------
  // נקודות כניסה קבועות בדף: כל [data-pwa-install]
  // ------------------------------------------------------------------
  function syncTriggers() {
    var usable = canOffer();
    var nodes = document.querySelectorAll('[data-pwa-install]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      node.hidden = !usable;
      if (usable && !node.dataset.pwaBound) {
        node.dataset.pwaBound = '1';
        (function (button) {
          button.addEventListener('click', function (e) {
            e.preventDefault();
            activate(mode(), button);
          });
        })(node);
      }
    }
  }

  // ------------------------------------------------------------------
  // הזרם הראשי
  // ------------------------------------------------------------------
  var script = document.currentScript ||
               document.querySelector('script[src*="pwa-install.js"]');
  var BOTTOM_OFFSET = (script && script.getAttribute('data-bottom')) || '';
  var AUTO = !(script && script.hasAttribute('data-no-auto'));

  registerServiceWorker();

  /* כבר מותקן ופתוח כאפליקציה: אין מה להציע, ומסמנים כדי שגם הפעם הבאה
     בדפדפן הרגיל לא תציג את הרצועה. */
  if (isStandalone()) {
    writeStore(K_INSTALLED, '1');
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();                 // בלי זה כרום מציג באנר משלו
    deferredPrompt = e;
    syncTriggers();
    if (AUTO && canAutoShow('prompt')) {
      setTimeout(function () { showBar('prompt'); }, SHOW_DELAY_MS);
    }
  });

  window.addEventListener('appinstalled', function () {
    writeStore(K_INSTALLED, '1');
    deferredPrompt = null;
    hideBar();
    syncTriggers();
    track('pwa_installed', {});
  });

  function start() {
    syncTriggers();

    /* אייפון, אייפד ודפדפן פנימי — אין אירוע שיגיע, ולכן הרצועה עולה
       מהטיימר. כרום מטופל למעלה: שם ממתינים לאירוע, כי רק הוא מעיד
       שהדף באמת ניתן להתקנה כרגע. */
    var m = mode();
    if (!AUTO || m === 'prompt' || !canAutoShow(m)) return;
    setTimeout(function () { showBar(m); }, SHOW_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* ‏API לדף: כפתור בתפריט, פריט בפוטר, או בדיקה אם יש בכלל מה להציע. */
  window.ShukPWA = {
    mode: mode,
    canInstall: canOffer,
    install: function (source) { activate(mode(), source || null); },
    showHelp: function (source) { openHelp(mode() || 'ios', source || null); },
    refreshTriggers: syncTriggers
  };
})();
