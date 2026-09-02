/* ============================================================================
   תפריט הנגישות — הגרסה המשותפת (ראו assets/a11y-widget.css)
   ----------------------------------------------------------------------------
   שלוש התנהגויות:
     1. הזרקת קישור הדילוג לתוכן, הכפתור הצף והפאנל — רק אם הם עוד לא בדף.
        דף הבית מחזיק מימוש מוטבע משלו, והבדיקה הזו מונעת שני תפריטים ושתי
        קבוצות מאזינים על אותו עמוד.
     2. החלת ההעדפות ושמירתן ב-localStorage תחת אותו מפתח שדף הבית משתמש בו,
        כך שהבחירה נשמרת במעבר בין עמודים.
     3. החלת ההעדפות מוקדם ככל האפשר — הקובץ נטען עם defer, ולכן הן מוחלות
        לפני הציור הראשון של רוב הדפדפנים ואין הבהוב של טקסט בגודל הרגיל.

   הכתיבה ל-localStorage עטופה ב-try: בגלישה פרטית בחלק מהדפדפנים היא זורקת,
   וזו לא סיבה להפיל את התפריט כולו.
   ============================================================================ */
(function () {
  'use strict';

  var KEY = 'shuknadlan_a11y';
  var MODES = ['a11y-contrast', 'a11y-links', 'a11y-readable', 'a11y-nomotion'];
  var FONT_MIN = 90, FONT_MAX = 160, FONT_STEP = 10;

  var LABELS = [
    ['a11y-contrast', 'ניגודיות גבוהה'],
    ['a11y-links', 'הדגשת קישורים'],
    ['a11y-readable', 'גופן קריא'],
    ['a11y-nomotion', 'עצירת אנימציות'],
  ];

  function read() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        fontPct: Number(saved.fontPct) || 100,
        modes: Array.isArray(saved.modes) ? saved.modes.filter(function (m) { return MODES.indexOf(m) > -1; }) : [],
      };
    } catch (e) { return { fontPct: 100, modes: [] }; }
  }

  var prefs = read();

  function apply() {
    document.documentElement.style.fontSize = prefs.fontPct === 100 ? '' : prefs.fontPct + '%';
    MODES.forEach(function (m) {
      document.documentElement.classList.toggle(m, prefs.modes.indexOf(m) > -1);
    });
    var reset = document.getElementById('a11yFontReset');
    if (reset) reset.textContent = prefs.fontPct + '%';
    document.querySelectorAll('.a11y-panel .opt').forEach(function (btn) {
      var on = prefs.modes.indexOf(btn.dataset.a11y) > -1;
      btn.setAttribute('aria-pressed', String(on));
      var state = btn.querySelector('.state');
      if (state) state.textContent = on ? 'פועל' : 'כבוי';
    });
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // דף הבית מזריק את התפריט בעצמו — שם רק מחילים ולא בונים מחדש
  if (document.getElementById('a11yFab')) { apply(); return; }

  // ---- קישור הדילוג ----------------------------------------------------
  // כשיש ‎<main>‎ הוא היעד. כשאין — ארבעה עמודים באתר (משרד, סוכן/ת, נכס,
  // בעל/ת מקצוע) בנויים מסקציות בלי עטיפת main — מוזרקת נקודת עגינה ריקה
  // מיד אחרי הכותרת. לכוון את הקישור אל הסקציה הראשונה *שקיימת בטעינה* לא
  // היה עובד שם: הסקציה הראשונה בעמודים האלה היא מסך הטעינה, שנעלם ברגע
  // שהנתונים מגיעים — וקישור הדילוג היה מוביל לאלמנט מוסתר.
  var main = document.querySelector('main, [role="main"]');
  if (main) {
    if (!main.id) main.id = 'main';
  } else {
    var header = document.querySelector('header');
    main = document.createElement('div');
    main.id = 'a11yMainStart';
    if (header && header.parentNode) header.parentNode.insertBefore(main, header.nextSibling);
    else document.body.insertBefore(main, document.body.firstChild);
  }

  var skip = document.createElement('a');
  skip.className = 'a11y-skip';
  skip.href = '#' + main.id;
  skip.textContent = 'דלג לתוכן הראשי';
  document.body.insertBefore(skip, document.body.firstChild);
  // הקישור מזיז את המיקום אבל לא את המיקוד, ולכן ה-Tab הבא היה ממשיך
  // מהכותרת. ‏tabindex זמני מעביר את המיקוד באמת אל התוכן.
  skip.addEventListener('click', function () {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  });

  // ---- הכפתור והפאנל ---------------------------------------------------
  var fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'a11y-fab';
  fab.id = 'a11yFab';
  fab.setAttribute('aria-label', 'פתיחת תפריט נגישות');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'a11yPanel');
  fab.title = 'נגישות';
  fab.textContent = '♿';

  var panel = document.createElement('div');
  panel.className = 'a11y-panel';
  panel.id = 'a11yPanel';
  panel.dataset.open = 'false';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תפריט נגישות');
  panel.innerHTML =
    '<h3>נגישות</h3>' +
    '<div class="a11y-font-row">' +
      '<button type="button" id="a11yFontDown" aria-label="הקטנת גודל הטקסט">א−</button>' +
      '<button type="button" id="a11yFontReset" aria-label="גודל טקסט רגיל">100%</button>' +
      '<button type="button" id="a11yFontUp" aria-label="הגדלת גודל הטקסט">א+</button>' +
    '</div>' +
    LABELS.map(function (m) {
      return '<button type="button" class="opt" data-a11y="' + m[0] + '" aria-pressed="false">' +
             m[1] + ' <span class="state">כבוי</span></button>';
    }).join('') +
    '<button type="button" class="reset" id="a11yReset">איפוס הגדרות</button>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  function setOpen(open) {
    panel.dataset.open = String(open);
    fab.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('button').focus();
  }

  fab.addEventListener('click', function (e) {
    e.stopPropagation();
    setOpen(panel.dataset.open !== 'true');
  });
  panel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function () {
    if (panel.dataset.open === 'true') setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.dataset.open === 'true') { setOpen(false); fab.focus(); }
  });

  panel.querySelectorAll('.opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.dataset.a11y;
      prefs.modes = prefs.modes.indexOf(mode) > -1
        ? prefs.modes.filter(function (m) { return m !== mode; })
        : prefs.modes.concat(mode);
      apply();
    });
  });

  function stepFont(delta) {
    prefs.fontPct = Math.min(FONT_MAX, Math.max(FONT_MIN, prefs.fontPct + delta));
    apply();
  }
  document.getElementById('a11yFontUp').addEventListener('click', function () { stepFont(FONT_STEP); });
  document.getElementById('a11yFontDown').addEventListener('click', function () { stepFont(-FONT_STEP); });
  document.getElementById('a11yFontReset').addEventListener('click', function () {
    prefs.fontPct = 100; apply();
  });
  document.getElementById('a11yReset').addEventListener('click', function () {
    prefs = { fontPct: 100, modes: [] }; apply();
  });

  apply();
})();
