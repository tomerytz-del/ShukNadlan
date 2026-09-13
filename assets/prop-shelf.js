/* ============================================================================
   מדף הנכסים — מנוע אחד לכל הדפים
   ----------------------------------------------------------------------------
   גריד לפי סדר ההעלאה, עד שני נכסים מקודמים בראש, שורת תגיות שנבנית
   מהמלאי עצמו, בורר מיון וכפתור "עוד נכסים".

   התצוגה הזו נולדה בדף הבית והחליפה שם שלוש קרוסלות שהציגו עשרה־שנים־עשר
   נכסים כל אחת וקצה חתוך. באותה שאלה נתקלו גם דף המשרד ודף הסוכן/ת: שם
   ישבו שלוש רצועות ("פרטי להשכרה", "פרטי למכירה", "מסחרי") שסוג העסקה
   הפך בהן ממאפיין של הנכס למבנה של הדף, ומי שרצה לראות מה יש למשרד נאלץ
   לגלול שלושה מסלולים אופקיים. עכשיו שלושתם מציגים את אותו הדבר באותה
   צורה — מדף פרטי ומדף מסחרי — וזה הקובץ שמצייר אותם.

     PropShelf.create(cfg)  →  { set(list), setVisualized(ids), selectTag(key) }

   מי שקורא מביא את הנכסים; המדף לא יורה שאילתות משלו. ה-CSS יושב
   ב-assets/prop-shelf.css, והאריח עצמו מגיע מ-assets/property-card.js,
   ולכן הוא זהה בשלושת הדפים.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* המדף נפתח על **שורה אחת** של נכסים ותו לא: הוא ויטרינה ולא הקטלוג.
     כמה אריחים יש בשורה נגזר מ-‎--pp-cols‎ של הגריד עצמו (ppCols), ובטלפון
     "שורה אחת" היא הכרטיס המקודם ואחריו PP_MOBILE_ROWS שורות דחוסות.

     ‏PP_PAGE הוא רק מה ש"עוד נכסים" מוסיף בכל לחיצה — לא מה שנפתח בהתחלה
     — כדי שלחיצה אחת תיתן נתח אמיתי ולא עוד ארבעה אריחים. */
  var PP_PAGE = 12;
  var PP_MOBILE_ROWS = 2;
  /* שני המקומות הראשונים שמורים לנכסים מקודמים. */
  var PP_PROMOTED = 2;
  /* כמה תגיות "סוג נכס" מוצגות לכל היותר. מעבר לזה שורת התגיות מתחילה
     להתחרות בנכסים עצמם על גובה המסך. */
  var PP_KIND_TAGS_MAX = 8;

  /* ---------- טלפון: ויטרינה אחת ואחריה שתי שורות ----------
     אריח כיסוי ברוחב מסך מלא הוא כשליש ממסך טלפון, וגריד של עשרה כאלה הוא
     עשר גלילות. אבל אריח אחד כזה בראש הוא בדיוק מה שמושך את העין לתצוגה —
     ולכן הראשון נשאר כרטיס מלא, ואחריו PP_MOBILE_ROWS שורות של propRow().

     ‏matchMedia ולא נקודת שבירה ב-CSS: אלה שני markup-ים שונים ולא אותו
     markup בשני גדלים, ולכן הבחירה נעשית בזמן הציור. ‏PP_MQ מחזיקה את
     אותן נקודות שבירה של ‎--pp-cols‎ ב-CSS, וכל מדף מצויר מחדש בחצייה של
     כל אחת מהן — כדי ששורה אחת תישאר שורה אחת גם אחרי סיבוב מכשיר. */
  var PP_MQ = [
    global.matchMedia('(max-width:520px)'),
    global.matchMedia('(max-width:820px)'),
    global.matchMedia('(max-width:1100px)'),
  ];
  var ppNarrow = PP_MQ[0];

  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';

  var SITE_LOGO = 'assets/logo-shuknadlan.svg';
  var NO_PHOTOS_NOTE = 'תמונות של הנכס יעלו בקרוב';

  function escAttr(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function hasPhoto(p) {
    var img = p && p.images && p.images[0];
    return typeof img === 'string' && img.trim() !== '';
  }

  function thumbStyle(p) {
    return hasPhoto(p)
      ? "background-image:url('" + escAttr(p.images[0]) +
        "');background-size:cover;background-position:center"
      : '';
  }

  /* ממלא־המקום של נכס בלי תמונות. בדף הבית הלוגו הוא של המשרד שהנכס שייך
     אליו (‏agency_logo על השורה), ובדף המשרד ובדף הסוכן/ת הוא של המשרד
     שבכותרת הדף — ולכן הוא נמסר כ-‎cfg.fallback‎ ולא נגזר כאן. */
  function defaultFallback(p) {
    if (hasPhoto(p)) return '';
    var name = (p && p.agency_name) || '';
    var logo = (p && p.agency_logo) || (name ? '' : SITE_LOGO);
    var mark = logo
      ? '<img class="tf-logo" src="' + escAttr(logo) + '" alt="' + escAttr(name) +
        '" loading="lazy" onerror="this.remove()">'
      : '<span class="tf-logo tf-initial" aria-hidden="true">' +
        escAttr(name.trim()[0] || '?') + '</span>';
    return '<div class="thumb-fallback">' + mark +
      (name ? '<span class="tf-agency">' + escAttr(name) + '</span>' : '') +
      '<span class="tf-note">' + NO_PHOTOS_NOTE + '</span></div>';
  }

  function defaultPromoted(p) {
    return !!(p && p.is_promoted) && (!p.promoted_until || new Date(p.promoted_until) > new Date());
  }

  /* הרשימה חוזרת מה-DB ממוינת מקודמים־קודם, ולכן נכס מקודם ישן היה נכנס
     ל"החדשים ביותר" לפני נכס חדש שלא שולם עליו. כאן היא ממוינת לפי
     ‎created_at‎ בלבד; ‏Array.sort יציב ב-JS מודרני, כך שרשומות בלי תאריך
     שומרות על סדר המקור. */
  function newestFirst(list) {
    return list.slice().sort(function (a, b) {
      return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
    });
  }

  /* כמה אריחים נכנסים לשורה אחת. הערך נקרא מהגריד עצמו ולא מרשימת נקודות
     שבירה מקבילה ב-JS: עותק שני נפרד מה-CSS בפעם הראשונה שמישהו משנה שם
     מספר, והתוצאה היא שורה וחצי. */
  function ppCols(grid) {
    var n = grid ? parseInt(getComputedStyle(grid).getPropertyValue('--pp-cols'), 10) : NaN;
    return (isFinite(n) && n > 0) ? n : 4;
  }

  function ppTypeOf(p) { return String((p && p.property_type) || '').trim(); }

  /* 4.0 → "4", 3.5 נשאר 3.5 — אותה נורמליזציה של שורת המאפיינים באריח */
  function ppRoomsKey(p) {
    var n = Number(p && p.rooms);
    if (!isFinite(n) || n <= 0) return '';
    return String(Math.round(n * 10) / 10);
  }

  /* ---------- גלילת שורת התגיות ----------
     שורת התגיות היא שורה אחת שגוללת אופקית (ראו ‎.pp-tags‎ ב-CSS). מה שחסר
     היה לא הגלילה אלא הסימן שהיא קיימת: בדסקטופ אין גלגלת אופקית, ולכן
     התגית שנחתכה בקצה הייתה בלתי-נגישה; בטלפון ההחלקה עובדת, אבל אף אחד
     לא ניחש שיש לאן.

     ‏data-can-start/‎data-can-end על המעטפת הם המקור היחיד לאמת: הם
     מדליקים את הדהייה, את החצים ואת הרמז, וכולם כבים כשכל התגיות נכנסות
     במסך. */
  function bindTagsScroller(box) {
    var wrap = box && box.closest('.pp-tags-wrap');
    if (!wrap) return { refresh: function () {} };

    // ב-RTL הדפדפנים המודרניים מודדים ‎scrollLeft‎ כשלילי ככל שגוללים אל
    // הקצה. ‏sign הופך את שני המקרים למרחק *מההתחלה*, שהוא מה שנמדד כאן.
    var sign = getComputedStyle(box).direction === 'rtl' ? -1 : 1;
    var pos = function () { return box.scrollLeft * sign; };
    var max = function () { return box.scrollWidth - box.clientWidth; };

    function refresh() {
      var overflow = max() > 1;
      wrap.toggleAttribute('data-can-start', overflow && pos() > 1);
      wrap.toggleAttribute('data-can-end', overflow && pos() < max() - 1);
      // ‏hidden ולא רק CSS: כפתור שאין לאן לגלול איתו לא צריך להיות ב-DOM
      // הנגיש. הוא ממילא ‎tabindex="-1"‎ — הגלילה עצמה אינה תחנת מקלדת,
      // והתגיות שאחריה כן.
      wrap.querySelector('.pp-tags-prev').hidden = !wrap.hasAttribute('data-can-start');
      wrap.querySelector('.pp-tags-next').hidden = !wrap.hasAttribute('data-can-end');
    }

    wrap.querySelectorAll('.pp-tags-nav').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // כ-‎70%‎ מהרוחב הנראה: מספיק כדי להתקדם, ומעט מכדי לדלג על תגית
        var step = Math.max(box.clientWidth * 0.7, 120);
        box.scrollBy({ left: sign * step * (btn.dataset.tagsDir === 'end' ? 1 : -1), behavior: 'smooth' });
      });
    });

    box.addEventListener('scroll', refresh, { passive: true });
    global.addEventListener('resize', refresh);

    /* הרמז בטלפון: דחיפה קטנה של השורה וחזרה, פעם אחת, ברגע שהיא נכנסת
       לתצוגה. רק במסך מגע (בדסקטופ יש חצים), רק כשיש באמת לאן לגלול, ורק
       פעם אחת — תזוזה שחוזרת בכל גלילה היא רעש. */
    var coarse = global.matchMedia('(hover:none),(pointer:coarse)');
    var calm = global.matchMedia('(prefers-reduced-motion:reduce)');
    var hinted = false;
    function nudgeTags() {
      if (hinted || !coarse.matches || !wrap.hasAttribute('data-can-end')) return;
      hinted = true;
      wrap.classList.add('is-hinting');
      if (calm.matches) return;             // החץ מוצג, בלי תנועה
      box.scrollBy({ left: sign * 34, behavior: 'smooth' });
      setTimeout(function () { box.scrollTo({ left: 0, behavior: 'smooth' }); }, 460);
    }

    if ('IntersectionObserver' in global) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          refresh();
          nudgeTags();
          if (hinted) io.disconnect();
        });
      }, { threshold: 0.6 });
      io.observe(wrap);
    }

    return { refresh: refresh };
  }

  /* ---------- השלד ----------
     המדף בונה את ה-markup שלו בעצמו ולא מחפש אלמנטים שהעמוד הכין: שלושה
     עמודים שכותבים את אותן ארבעים שורות HTML הם שלושה מקומות שבהם צריך
     לזכור לשנות aria כשמשהו זז. מה שהעמוד מספק הוא המעטפת בלבד — אלמנט
     אחד ריק, שהמדף גם מסתיר כשאין בו נכסים. */
  function buildSkeleton(root, cfg) {
    var tag = cfg.headingTag || 'h2';
    var info = cfg.info
      ? '<button type="button" class="info-dot" aria-label="מידע על התצוגה" data-info="' +
        escAttr(cfg.info) + '">i</button>'
      : '';
    var head = cfg.title
      ? '<div class="pp-head"><div class="head-line"><' + tag + ' id="' + escAttr(cfg.titleId) + '">' +
        escAttr(cfg.title) + info + '</' + tag + '></div>' +
        '<p class="pp-count" data-pp="count" aria-live="polite"></p></div>'
      : '';

    root.innerHTML = head +
      '<div class="pp-controls">' +
        /* התגיות נבנות ב-JS מתוך המלאי (renderTags). המעטפת מחזיקה את שני
           חצי הגלילה ואת מסכות הדהייה בקצוות — ראו bindTagsScroller. */
        '<div class="pp-tags-wrap" data-tags-wrap>' +
          '<button type="button" class="pp-tags-nav pp-tags-prev" data-tags-dir="start" ' +
            'aria-label="גלילת התגיות אחורה" tabindex="-1" hidden>' + CHEVRON + '</button>' +
          '<div class="pp-tags" data-pp="tags" role="group" aria-label="תגיות סינון מהירות"></div>' +
          '<button type="button" class="pp-tags-nav pp-tags-next" data-tags-dir="end" ' +
            'aria-label="גלילת התגיות קדימה" tabindex="-1" hidden>' + CHEVRON + '</button>' +
          '<span class="pp-tags-hint" aria-hidden="true">' + CHEVRON + '</span>' +
        '</div>' +
        '<label class="pp-sort" for="' + escAttr(cfg.sortId) + '"><span>מיון</span>' +
          '<select id="' + escAttr(cfg.sortId) + '" data-pp="sort">' +
            '<option value="new">חדשים ראשונים</option>' +
            '<option value="price-asc">מחיר: מהנמוך לגבוה</option>' +
            '<option value="price-desc">מחיר: מהגבוה לנמוך</option>' +
          '</select></label>' +
      '</div>' +
      '<div class="pp-grid" data-pp="grid"></div>' +
      '<div class="pp-more-wrap"><button type="button" class="pp-more" data-pp="more" hidden></button></div>';

    if (cfg.title && cfg.titleId) root.setAttribute('aria-labelledby', cfg.titleId);
  }

  function createShelf(cfg) {
    var root = typeof cfg.mount === 'string' ? document.getElementById(cfg.mount) : cfg.mount;
    if (!root) return { set: function () {}, setVisualized: function () {}, selectTag: function () { return false; } };

    var fallback = cfg.fallback || defaultFallback;
    var isPromoted = cfg.promoted || defaultPromoted;
    var visualized = new Set();

    buildSkeleton(root, cfg);
    var $ = function (name) { return root.querySelector('[data-pp="' + name + '"]'); };
    var tagsBox = $('tags'), grid = $('grid'), countEl = $('count'), moreBtn = $('more');

    // shown:0 = "מה שנפתח בהתחלה" — שורה אחת, שמחושבת בזמן הציור לפי הרוחב
    // הנוכחי. לחיצה על "עוד נכסים" קובעת מספר מפורש שגדול ממנה.
    var state = { all: [], tags: new Set(), sort: 'new', shown: 0 };
    var tags = [], byKey = new Map();
    var tagsScroller = bindTagsScroller(tagsBox);

    /* ---------- האריח ----------
       המחיר, הכותרת, שתי שורות המיקום, שורת המאפיינים והתגיות שעל התמונה
       מגיעים כולם מ-assets/property-card.js, ולכן האריח כאן זהה בשלושת
       הדפים. מה שנשאר לעמוד הוא ממלא־המקום (‏cfg.fallback) ומה שהוא רוצה
       להוסיף על התמונה (‏cfg.overlay — כפתור המועדפים בדף הסוכן/ת). */
    function propCard(p) {
      var el = document.createElement('div');
      el.className = 'prop-card pc-cover';
      el.innerHTML =
        '<div class="thumb' + (hasPhoto(p) ? '' : ' no-photo') + '" style="' + thumbStyle(p) + '">' +
          fallback(p) +
          PropertyCard.coverVideoHtml(p) +
          (isPromoted(p) ? '<span class="ribbon">מקודם</span>' : '') +
          PropertyCard.badgesHtml(p, { aiViz: visualized.has(p.id), photo: hasPhoto(p) }) +
          PropertyCard.mediaHtml(p) +
          (cfg.overlay ? cfg.overlay(p) : '') +
        '</div>' +
        '<div class="body">' +
          PropertyCard.priceHtml(p) +
          PropertyCard.titleHtml(p) +
          PropertyCard.whereHtml(p, cfg.whereOpts) +
          PropertyCard.factsHtml(p) +
        '</div>';
      /* האריח הוא קישור לכל דבר, ולכן הוא גם תחנת מקלדת: ‏role="link"‎
         עם ‎tabindex‎ ו-Enter/רווח. בשורה הדחוסה (‏propRow) זה מגיע חינם
         מה-‎<a>‎, וכאן הטקסט יושב מעל התמונה ולא בתוך עוגן. */
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
      var open = function () {
        global.location.href = 'property.html?id=' + encodeURIComponent(p.id);
      };
      el.addEventListener('click', function (e) {
        // כפתור שיושב על האריח (מועדפים) אינו ניווט לדף הנכס
        if (e.target.closest('button')) return;
        open();
      });
      el.addEventListener('keydown', function (e) {
        if (e.target !== el) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      if (cfg.bindCard) cfg.bindCard(el, p);
      return el;
    }

    /* ---------- שורת הנכס ----------
       האריח שלמעלה הוא ויטרינה: הוא מוכר נכס אחד בכל פעם, ולכן התמונה בו
       היא הכרטיס. בטלפון, מהשורה השנייה ומטה, צריך כלי סריקה — שלוש שורות
       ותמונונת, בדיוק כמו "הנכסים שלי" ב-CRM.

       השורה כולה היא הקישור ולא כפתור בקצה: שטח נגיעה של 74px על 400px
       גדול פי כמה מכפתור, וה-‎<a>‎ נותן גם פתיחה בלשונית חדשה ותפריט הקשר.
       החץ הוא הסימן שזה קישור. */
    function propRow(p) {
      var el = document.createElement('a');
      el.className = 'prop-row';
      el.href = 'property.html?id=' + encodeURIComponent(p.id);
      // התגית אומרת מכירה או השכרה, ולכן גם הגוון שלה נגזר מזה בלבד. גוון
      // "מסחרי" על תגית שכתוב בה "למכירה" הוא שני מסרים באותו מקום.
      el.setAttribute('data-deal', p.deal_type === 'rent' ? 'rent' : 'sale');

      var hood = p.neighborhood_name || p.city || '';
      var what = [p.property_type, hood].filter(Boolean).join(' · ');

      // אותם מאפיינים ובאותו סדר של האריח, כדי ששתי התצוגות לא יספרו סיפור שונה
      var facts = [];
      if (p.rooms) facts.push((Math.round(Number(p.rooms) * 10) / 10) + ' חד׳');
      if (p.size_sqm) facts.push(Number(p.size_sqm).toLocaleString('he-IL') + ' מ״ר');
      if (p.floor !== null && p.floor !== undefined && p.floor !== '') {
        facts.push(Number(p.floor) === 0 ? 'קומת קרקע' : 'קומה ' + p.floor);
      }
      if (PropertyCard.hasFeature(p, 'parking')) facts.push('חניה');

      var price = Number(p.price);
      var priceText = (isFinite(price) && price > 0)
        ? '₪' + price.toLocaleString('he-IL') +
          (p.deal_type === 'rent' ? '<span class="per"> לחודש</span>' : '')
        : 'לפי בקשה';
      var deal = p.deal_type === 'rent' ? 'להשכרה' : 'למכירה';

      el.innerHTML =
        '<span class="pr-thumb" style="' + thumbStyle(p) + '">' + fallback(p) +
          (isPromoted(p) ? '<span class="pr-promo">מקודם</span>' : '') + '</span>' +
        '<span class="pr-main">' +
          '<span class="pr-line pr-what">' + escAttr(what) + '</span>' +
          '<span class="pr-line pr-facts">' + escAttr(facts.join(' · ')) + '</span>' +
          '<span class="pr-line pr-price">' + priceText + '<span class="pr-deal">' + deal + '</span></span>' +
        '</span>' +
        '<svg class="pr-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
      return el;
    }

    /* ---------- התגיות המובנות ----------
       שתי קבוצות. **עסקה** — מכירה/השכרה, מה שהפרדת הרצועות אמרה קודם בלי
       שאפשר היה לבטל אותה. **סוג נכס** — נבנית מהמלאי עצמו ולא מרשימה
       קשיחה: בתצוגה הפרטית "דירה" מתפצלת לפי מספר חדרים ("דירות 4 חד׳"),
       וכל סוג אחר נכנס בשמו. תגית שאין מאחוריה ולו נכס אחד פשוט לא נבנית,
       ולכן אין כאן לחיצה שמחזירה רשימה ריקה.

       קבוצה שנשארה עם תגית אחת יורדת כולה: תגית שמסמנת את *כל* המלאי לא
       מסננת כלום, והיא רק תופסת שורה ומזמינה לחיצה שלא משנה דבר.

       בתוך קבוצה התגיות מצטברות (מכירה *או* השכרה), ובין הקבוצות הן
       מצטלבות (השכרה *וגם* 3 חדרים).

       ‏הספירה שעל התגית היא מתוך כל מלאי המדף ולא מתוך התוצאה הנוכחית:
       מספר שמשתנה בכל לחיצה מפסיק לענות על השאלה שבגללה מסתכלים עליו. */
    function buildTags() {
      var list = state.all;

      var deals = [
        { key: 'sale', group: 'deal', label: 'מכירה', test: function (p) { return p.deal_type !== 'rent'; } },
        { key: 'rent', group: 'deal', label: 'השכרה', test: function (p) { return p.deal_type === 'rent'; } },
      ].map(function (t) {
        return { key: t.key, group: t.group, label: t.label, test: t.test, count: list.filter(t.test).length };
      }).filter(function (t) { return t.count > 0; });

      var rooms = new Map();   // '4' → כמה דירות 4 חדרים
      var types = new Map();   // 'יחידת דיור' → כמה
      list.forEach(function (p) {
        var type = ppTypeOf(p);
        var key = ppRoomsKey(p);
        if (cfg.roomsType && type === cfg.roomsType && key) {
          rooms.set(key, (rooms.get(key) || 0) + 1);
        } else if (type) {
          types.set(type, (types.get(type) || 0) + 1);
        }
      });

      var roomTags = Array.from(rooms.entries())
        .sort(function (a, b) { return Number(a[0]) - Number(b[0]); })
        .map(function (entry) {
          var key = entry[0];
          return {
            key: 'rooms:' + key, group: 'kind', label: cfg.roomsLabel + ' ' + key + ' חד׳', count: entry[1],
            test: function (p) { return ppTypeOf(p) === cfg.roomsType && ppRoomsKey(p) === key; },
          };
        });

      var typeTags = Array.from(types.entries())
        .sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'he'); })
        .map(function (entry) {
          var type = entry[0];
          return {
            key: 'type:' + type, group: 'kind', label: type, count: entry[1],
            test: function (p) { return ppTypeOf(p) === type; },
          };
        });

      /* החדרים קודם — הם השאלה הראשונה של מי שמחפש דירה — ושאר הסוגים
         ממלאים את מה שנשאר עד התקרה, לפי כמה מהם יש. */
      var kinds = roomTags.concat(typeTags).slice(0, PP_KIND_TAGS_MAX);

      tags = [].concat(deals.length > 1 ? deals : [], kinds.length > 1 ? kinds : []);
      byKey = new Map(tags.map(function (t) { return [t.key, t]; }));
      // תגית שנעלמה מהמלאי (הנכס האחרון שלה ירד) לא נשארת דלוקה בשקט
      state.tags = new Set(Array.from(state.tags).filter(function (k) { return byKey.has(k); }));
    }

    function matches(p) {
      var byGroup = new Map();
      state.tags.forEach(function (key) {
        var tag = byKey.get(key);
        if (!tag) return;
        if (!byGroup.has(tag.group)) byGroup.set(tag.group, []);
        byGroup.get(tag.group).push(tag);
      });
      var groups = Array.from(byGroup.values());
      for (var i = 0; i < groups.length; i++) {
        var hit = groups[i].some(function (t) { return t.test(p); });
        if (!hit) return false;
      }
      return true;
    }

    /* הסדר: סדר ההעלאה (החדשים ראשונים), עדיפות למי שיש לו מה להראות,
       ובראש הכול עד שני נכסים מקודמים.

       ‏sortByMedia הוא מה שמפריד בין "לפי סדר ההעלאה" לבין מדף שמתחיל
       בשלושה ממלאי־מקום: סרטון קודם לתמונות, תמונות קודמות לאין־תמונה.
       הוא מיון *יציב*, ולכן בתוך כל דרגת מדיה סדר ההעלאה נשמר במלואו —
       כלומר זו העדפה בתצוגה ולא דירוג מחדש של המלאי.

       הקידום מוצמד לראש אחרי כן, ולכן הוא גובר גם על תמונה — זה מה שנקנה.

       במיון לפי מחיר אין אף אחת משתי השכבות האחרונות: רשימה שמתחילה במחיר
       הגבוה ביותר כשביקשו "מהנמוך לגבוה" היא רשימה שבורה, וגם נכס בתשלום
       לא שווה את זה. */
    function ordered() {
      var list = state.all.filter(matches);

      if (state.sort === 'price-asc' || state.sort === 'price-desc') {
        var dir = state.sort === 'price-asc' ? 1 : -1;
        var value = function (p) { var n = Number(p.price); return (isFinite(n) && n > 0) ? n : null; };
        // "לפי בקשה" יורד לסוף בשני הכיוונים: הוא לא המחיר הנמוך ביותר, הוא
        // היעדר מחיר.
        return list.slice().sort(function (a, b) {
          var x = value(a), y = value(b);
          if (x === null || y === null) return (x === null) - (y === null);
          return (x - y) * dir;
        });
      }

      var pool = PropertyCard.sortByMedia(newestFirst(list));
      var promoted = pool.filter(isPromoted).slice(0, PP_PROMOTED);
      var promotedIds = new Set(promoted.map(function (p) { return p.id; }));
      return promoted.concat(pool.filter(function (p) { return !promotedIds.has(p.id); }));
    }

    function renderTags() {
      if (!tagsBox) return;
      tagsBox.innerHTML = '';

      /* "ניקוי הכל" בתחילת השורה ולא בסופה: השורה גוללת, וכפתור שמבטל את
         הסינון שיושב אחרי שתים-עשרה תגיות הוא כפתור שצריך לחפש. */
      if (state.tags.size) {
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'pp-clear';
        clear.textContent = '✕ ניקוי הכל';
        tagsBox.appendChild(clear);
      }

      tags.forEach(function (tag) {
        var on = state.tags.has(tag.key);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-tag';
        btn.dataset.ppTag = tag.key;
        btn.setAttribute('aria-pressed', String(on));
        // ה-✕ על תגית דלוקה הוא מה שאומר שאפשר לכבות אותה. הוא אינו כפתור
        // נפרד — כל התגית היא שטח הלחיצה שמסיר את הסינון — ולכן
        // ‎aria-hidden‎: מקריא מסך כבר שומע "לחוץ" מ-‎aria-pressed‎.
        btn.innerHTML = escAttr(tag.label) +
          '<span class="pp-tag-n">' + tag.count.toLocaleString('he-IL') + '</span>' +
          (on ? '<span class="pp-tag-x" aria-hidden="true">✕</span>' : '');
        btn.title = on ? 'הסרת הסינון "' + tag.label + '"' : 'סינון לפי "' + tag.label + '"';
        tagsBox.appendChild(btn);
      });

      // אחרי כל ציור: מספר התגיות והרוחב שלהן השתנו, ואיתם מה שיש לאן לגלול
      tagsScroller.refresh();
    }

    /* מדף בלי נכסים יורד לגמרי: כותרת מעל גריד ריק נראית כמו תקלה, ובעפולה
       יש ימים שאין בהם ולו נכס מסחרי אחד. */
    function renderGrid() {
      root.hidden = !state.all.length;
      if (!state.all.length) return;

      var items = ordered();
      var shown = items.slice(0, limit());

      grid.innerHTML = '';
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'pp-empty';
        empty.textContent = 'אין נכסים שמתאימים לתגיות שנבחרו.';
        grid.appendChild(empty);
      } else {
        var compact = ppNarrow.matches;
        shown.forEach(function (p, i) {
          grid.appendChild((compact && i > 0) ? propRow(p) : propCard(p));
        });
      }

      if (countEl && cfg.countText) {
        countEl.textContent = cfg.countText(items.length, state.all.length);
      }

      if (moreBtn) {
        var rest = items.length - shown.length;
        moreBtn.hidden = rest <= 0;
        // המספר על הכפתור הוא מה שהלחיצה תוסיף, ולא הזנב כולו: כפתור
        // שמבטיח "עוד 62 נכסים" ומוסיף שנים־עשר משקר פעם אחת לכל לחיצה.
        var add = Math.min(rest, PP_PAGE);
        moreBtn.textContent = add === 1 ? 'עוד נכס אחד' : 'עוד ' + add.toLocaleString('he-IL') + ' נכסים';
      }
    }

    /* כמה אריחים לצייר עכשיו. הרצפה היא תמיד שורה אחת מלאה ברוחב הנוכחי,
       ומעליה יושב מה שלחיצות "עוד נכסים" הוסיפו. */
    function firstPage() {
      return ppNarrow.matches ? (1 + PP_MOBILE_ROWS) : ppCols(grid);
    }
    function limit() {
      var first = firstPage();
      return state.shown > first ? state.shown : first;
    }

    /* כל שינוי בסינון או במיון מחזיר לעמוד הראשון: "עוד נכסים" שנלחץ לפני
       הסינון היה משאיר גריד ארוך של תוצאות אחרות. */
    function reset() { state.shown = 0; }

    // המאזינים נקשרים פעם אחת לקונטיינרים שנבנו כאן, ולא לכפתורים שנבנים
    // מחדש בכל ציור.
    if (tagsBox) tagsBox.addEventListener('click', function (e) {
      if (e.target.closest('.pp-clear')) {
        state.tags.clear();
      } else {
        var btn = e.target.closest('.pp-tag');
        if (!btn) return;
        var key = btn.dataset.ppTag;
        if (state.tags.has(key)) state.tags.delete(key);
        else state.tags.add(key);
      }
      reset();
      renderTags();
      renderGrid();
    });

    var sortEl = $('sort');
    if (sortEl) sortEl.addEventListener('change', function (e) {
      state.sort = e.target.value;
      reset();
      renderGrid();
    });

    if (moreBtn) moreBtn.addEventListener('click', function () {
      state.shown = limit() + PP_PAGE;
      renderGrid();
    });

    /* חצייה של נקודת שבירה (סיבוב מכשיר, שינוי גודל חלון) מציירת מחדש: גם
       כדי שלא יישאר גריד של שורות דחוסות ברוחב דסקטופ, וגם כדי שהשורה
       הראשונה תמשיך למלא בדיוק עמודה־עמודה. ‏addListener הוא הנפילה־לאחור
       ל-Safari שלפני 14, שבו ל-MediaQueryList אין addEventListener. */
    PP_MQ.forEach(function (mq) {
      if (mq.addEventListener) mq.addEventListener('change', function () { renderGrid(); });
      else if (mq.addListener) mq.addListener(function () { renderGrid(); });
    });

    return {
      set: function (list) {
        state.all = Array.isArray(list) ? list : [];
        buildTags();
        renderTags();
        renderGrid();
      },
      /* תגית "הדמיית AI" מגיעה בשאילתה שנייה שלא מעכבת את ההצגה הראשונה,
         ולכן היא נמסרת בנפרד ומציירת מחדש רק את מה שכבר על המסך. */
      setVisualized: function (ids) {
        visualized = ids || new Set();
        if (state.all.length) renderGrid();
      },
      /* הדלקת תגית מבחוץ (עוגן הפוטר). מחזירה false כשאין תגית כזו במלאי,
         כדי שהעוגן לא יגלול לתצוגה שלא השתנתה. */
      selectTag: function (key) {
        if (!byKey.has(key)) return false;
        state.tags = new Set([key]);
        reset();
        renderTags();
        renderGrid();
        return true;
      },
      /* המדף הפרטי והמסחרי חולקים את כפתורי "עוד" והתגיות, אבל העמוד
         לפעמים צריך לדעת אם יש בו בכלל מלאי (לשתילת ווידג'ט אחריו). */
      get count() { return state.all.length; },
      el: root,
    };
  }

  /* ---------- מסחרי מול פרטי ----------
     ‏category הוא מה שמפריד בין נדל״ן פרטי למסחרי בכל המרקטפלייס — עמודה
     ‏NOT NULL עם ברירת מחדל 'residential' וערכים 'residential'/'commercial'
     בלבד. "נכסים פרטיים" הוא בדיוק מה שמסחרי איננו, ולכן ההפרדה נעשית
     במקום אחד וכל הדפים קוראים לו. */
  function isCommercial(p) { return p && p.category === 'commercial'; }

  global.PropShelf = {
    create: createShelf,
    isCommercial: isCommercial,
    private: function (list) { return (list || []).filter(function (p) { return !isCommercial(p); }); },
    commercial: function (list) { return (list || []).filter(isCommercial); },
    PAGE: PP_PAGE,
  };
})(window);
