/* ============================================================================
   תו האמון והאיכות — רכיב משותף
   ----------------------------------------------------------------------------
   התו מופיע בארבעה הקשרים שונים (דף הסוכן/ת, כרטיסי נבחרת הסוכנים בדף המשרד,
   ראש דף המשרד וכרטיס ההמרה בדף הנכס), ובכל אחד מהם הוא נלחץ ופותח את אותו
   פופ־אפ. לכן הוא יושב בקובץ אחד ולא משוכפל בארבעה דפים — טקסט שיווקי שמתעדכן
   במקום אחד מתעדכן בכולם.

   שימוש:
     QualityBadge.mount(container, { size:'md', label:true, tone:'light',
                                     subject:'ישראל ישראלי' });

   ה-CSS והפופ־אפ מוזרקים פעם אחת בלבד, בלחיצה הראשונה על ‎mount‎, כדי שדף
   שלא מציג תו בכלל לא ישלם עליהם דבר.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הדפים באתר.
   ========================================================================== */
(function (global) {
  'use strict';

  var BADGE_SRC = 'assets/badge-ethics.png';
  var CODE_URL = 'ethics-code.html';
  var BADGE_ALT = 'תו האמון והאיכות — עומד בתקן האתי של שוק הנדל״ן של עפולה';

  /* ‏xl הוא התו כפריט ראשי ולא כנספח: כך הוא מופיע בכרטיס הפרופיל בדף
     הסוכן/ת, שם הוא עומד לבדו בלי כיתוב לצדו. */
  var SIZES = { sm: 28, md: 46, lg: 72, xl: 104 };

  /* הנקודות בפופ־אפ. הכותרת המודגשת והמשך המשפט מופרדים כדי שהעין תתפוס את
     חמש ההבטחות בסריקה מהירה, בלי לקרוא את כל הפסקה. */
  var HIGHLIGHTS = [
    ['רישוי מלא כחוק',
     'עבודה מול אנשי מקצוע מורשים בלבד, בעלי רישיון תיווך בתוקף מטעם משרד המשפטים.'],
    ['שקיפות ויושרה מעל הכל',
     'הצגת תמונת מצב אובייקטיבית, ללא אותיות קטנות, ללא מודעות פיקטיביות ובנאמנות מוחלטת לטובתכם.'],
    ['חדשנות וכלי AI מתקדמים',
     'שיווק חכם, ניתוחי שוק מבוססי דאטה, הדמיות מדויקות ותמחור ריאלי שחוסכים לכם זמן יקר וממקסמים תוצאות.'],
    ['עוצמת שיתופי הפעולה',
     'נכסים בבלעדיות נחשפים לכלל משרדי התיווך והסוכנים באזור, כדי להבטיח למוכרים קונים מהירים ולרוכשים את ההזדמנויות הטובות ביותר בשוק.'],
    ['גישה מגשרת ומקצועית',
     'ניהול משא ומתן סבלני, הוגן וממוקד מטרה, שנועד לייצר עסקאות בטוחות ורווחיות לכל הצדדים.'],
  ];

  var CSS = [
    '.qb-badge{display:inline-flex;align-items:center;gap:7px;padding:0;background:none;border:none;',
    '  cursor:pointer;font:inherit;color:inherit;vertical-align:middle;line-height:1;border-radius:999px}',
    '.qb-badge:focus-visible{outline:2px solid #C9A227;outline-offset:3px}',
    '.qb-badge img{display:block;flex:0 0 auto;border-radius:50%;',
    '  filter:drop-shadow(0 2px 6px rgba(18,41,74,.28));transition:transform .16s ease}',
    '.qb-badge:hover img{transform:scale(1.06)}',
    '.qb-badge .qb-label{font-size:.72rem;font-weight:800;letter-spacing:-.01em;white-space:nowrap;',
    '  color:#12294A}',
    '.qb-badge[data-tone="dark"] .qb-label{color:#fff}',
    '.qb-badge .qb-label small{display:block;font-size:.66em;font-weight:600;opacity:.72}',

    /* הפופ־אפ */
    '.qb-overlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;',
    '  padding:18px;background:rgba(10,20,34,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}',
    '.qb-overlay.qb-open{display:flex}',
    '.qb-modal{position:relative;width:min(560px,100%);max-height:88vh;overflow-y:auto;background:#FBFAF9;',
    '  border-radius:22px;box-shadow:0 24px 60px rgba(8,18,32,.4);',
    '  font-family:Heebo,system-ui,sans-serif;color:#1B1F26;direction:rtl;text-align:right;',
    '  animation:qb-rise .2s ease}',
    '@keyframes qb-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.qb-modal{animation:none}.qb-badge img{transition:none}}',
    '.qb-modal .qb-close{position:absolute;inset-inline-end:12px;top:12px;width:34px;height:34px;',
    '  border-radius:50%;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:1.1rem;',
    '  cursor:pointer;line-height:1;display:grid;place-items:center}',
    '.qb-modal .qb-close:hover{background:rgba(255,255,255,.3)}',
    '.qb-head{background:linear-gradient(150deg,#0E2340,#1C3A5E 62%,#2A4E77);color:#fff;',
    '  padding:22px 22px 20px;border-radius:22px 22px 0 0;display:flex;align-items:center;gap:15px}',
    '.qb-head img{width:74px;height:74px;flex:0 0 auto;border-radius:50%;',
    '  filter:drop-shadow(0 4px 12px rgba(0,0,0,.35))}',
    '.qb-head h2{margin:0;font-family:"Frank Ruhl Libre",serif;font-weight:700;font-size:1.16rem;',
    '  line-height:1.3;color:#fff}',
    '.qb-head p{margin:5px 0 0;font-size:.78rem;color:#D8C58A;font-weight:700}',
    '.qb-body{padding:18px 22px 22px}',
    '.qb-intro{margin:0 0 14px;font-size:.88rem;line-height:1.6;color:#3E454D}',
    '.qb-subject{font-weight:800;color:#12294A}',
    '.qb-list{list-style:none;margin:0;padding:0;display:grid;gap:9px}',
    '.qb-list li{position:relative;padding:10px 40px 10px 12px;background:#fff;border:1px solid #E6E3DD;',
    '  border-radius:13px;font-size:.82rem;line-height:1.5;color:#565C63}',
    '.qb-list li::before{content:"";position:absolute;inset-inline-end:13px;top:13px;',
    '  width:18px;height:18px;border-radius:50%;',
    '  background:#12294A var(--qb-check) center/11px no-repeat}',
    '.qb-list b{display:block;color:#12294A;font-size:.86rem;font-weight:800;margin-bottom:1px}',
    '.qb-actions{display:grid;gap:9px;margin-top:16px}',
    '@media(min-width:460px){.qb-actions{grid-template-columns:1fr auto}}',
    '.qb-cta{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:12px 18px;',
    '  border-radius:13px;font-weight:800;font-size:.88rem;text-decoration:none;border:none;cursor:pointer}',
    '.qb-cta-primary{background:linear-gradient(120deg,#12294A,#1C3A5E 70%);color:#fff;',
    '  box-shadow:0 6px 16px rgba(18,41,74,.24)}',
    '.qb-cta-ghost{background:#EDEAE4;color:#1B1F26}',
    '.qb-foot{margin:14px 0 0;font-size:.72rem;line-height:1.5;color:#7A8087}',
  ].join('');

  /* ה-checkmark של סימני הווי ברשימה — data URI כדי לא לתלות את הרכיב בקובץ נוסף */
  var CHECK_URI = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\")";

  var overlayEl = null;
  var lastFocused = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectStyles() {
    if (document.getElementById('qb-styles')) return;
    var style = document.createElement('style');
    style.id = 'qb-styles';
    style.textContent = ':root{--qb-check:' + CHECK_URI + '}' + CSS;
    document.head.appendChild(style);
  }

  function buildOverlay() {
    if (overlayEl) return overlayEl;
    injectStyles();

    overlayEl = document.createElement('div');
    overlayEl.className = 'qb-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-labelledby', 'qbTitle');

    var items = HIGHLIGHTS.map(function (h) {
      return '<li><b>' + escapeHtml(h[0]) + '</b>' + escapeHtml(h[1]) + '</li>';
    }).join('');

    overlayEl.innerHTML =
      '<div class="qb-modal">' +
        '<button type="button" class="qb-close" aria-label="סגירה">✕</button>' +
        '<div class="qb-head">' +
          '<img src="' + BADGE_SRC + '" alt="' + escapeHtml(BADGE_ALT) + '" width="384" height="384">' +
          '<div>' +
            '<h2 id="qbTitle">תו האמון והאיכות</h2>' +
            '<p>הסטנדרט החדש בעולם הנדל״ן</p>' +
          '</div>' +
        '</div>' +
        '<div class="qb-body">' +
          '<p class="qb-intro" id="qbIntro"></p>' +
          '<ul class="qb-list">' + items + '</ul>' +
          '<div class="qb-actions">' +
            '<a class="qb-cta qb-cta-primary" href="' + CODE_URL + '">קריאת הקוד האתי המלא ←</a>' +
            '<button type="button" class="qb-cta qb-cta-ghost" data-qb-dismiss>סגירה</button>' +
          '</div>' +
          '<p class="qb-foot">מחפשים לקנות או למכור נכס בראש שקט? חפשו את תו האיכות בפרופיל המתווך ובמודעות הנכסים. ' +
            'התו מוסר מיידית במקרה של הפרת התקנון.</p>' +
        '</div>' +
      '</div>';

    overlayEl.addEventListener('click', function (e) {
      // לחיצה על הרקע או על אחד מכפתורי הסגירה — הפופ־אפ נסגר; לחיצה על תוכן לא
      if (e.target === overlayEl || e.target.closest('.qb-close, [data-qb-dismiss]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlayEl.classList.contains('qb-open')) close();
    });

    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  var INTRO_TAIL = 'תו האמון והאיכות של הפלטפורמה אינו עוד חותמת סמלית — הוא הבטחה לסטנדרט ' +
    'מקצועי חסר פשרות. כל מתווך ויועץ נדל״ן הנושא את התו עבר בדיקת התאמה קפדנית ומחויב לקוד אתי מחייב:';

  /* הפסקה הפותחת מותאמת למי שעליו לחצו: בדף של סוכן/ת או של משרד ספציפי/ת עדיף
     לפתוח בשם ("ישראל ישראלי נושא/ת את התו") מאשר במשפט כללי על הפלטפורמה.
     השם נשתל כ-textContent ולא כ-HTML — הוא מגיע ממסד הנתונים. */
  function renderIntro(intro, subject) {
    var who = (subject || '').trim();
    intro.textContent = '';
    if (who) {
      var strong = document.createElement('span');
      strong.className = 'qb-subject';
      strong.textContent = who;
      intro.appendChild(strong);
      intro.appendChild(document.createTextNode(' נושא/ת את התו. '));
    }
    intro.appendChild(document.createTextNode(INTRO_TAIL));
  }

  function open(subject) {
    var el = buildOverlay();
    lastFocused = document.activeElement;
    renderIntro(el.querySelector('#qbIntro'), subject);
    el.classList.add('qb-open');
    document.body.style.overflow = 'hidden';
    var closeBtn = el.querySelector('.qb-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('qb-open');
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
    lastFocused = null;
  }

  /* ‏create מחזיר את הכפתור בלי לשתול אותו, כדי שאפשר יהיה להכניס אותו לתוך
     מבנה קיים (למשל שורת השם בדף הסוכן/ת) ולא רק כאלמנט עצמאי. */
  function create(opts) {
    opts = opts || {};
    injectStyles();
    var px = SIZES[opts.size] || SIZES.md;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qb-badge';
    btn.dataset.tone = opts.tone === 'dark' ? 'dark' : 'light';
    btn.setAttribute('aria-label', 'תו האמון והאיכות — לחצו לפרטים');
    btn.title = 'עומד בתקן האתי · לחצו לפרטים';

    var img = document.createElement('img');
    img.src = BADGE_SRC;
    img.alt = BADGE_ALT;
    img.width = px; img.height = px;
    img.style.width = px + 'px';
    img.style.height = px + 'px';
    img.loading = 'lazy';
    btn.appendChild(img);

    if (opts.label) {
      var label = document.createElement('span');
      label.className = 'qb-label';
      label.innerHTML = 'עומד בתקן האתי<small>מוסמך ומורשה</small>';
      btn.appendChild(label);
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();   // כרטיסי סוכן/נכס עוטפים לינק — הלחיצה על התו לא מנווטת
      open(opts.subject);
    });
    return btn;
  }

  function mount(container, opts) {
    var el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return null;
    var btn = create(opts);
    el.appendChild(btn);
    return btn;
  }

  global.QualityBadge = {
    BADGE_SRC: BADGE_SRC,
    CODE_URL: CODE_URL,
    HIGHLIGHTS: HIGHLIGHTS,
    create: create,
    mount: mount,
    open: open,
    close: close,
  };
})(window);
