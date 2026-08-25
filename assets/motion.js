/* ============================================================================
   שוק נדל״ן — מנוע התנועה המשותף. נטען יחד עם assets/motion.css.

   עקרון מנחה, זהה לזה של PART 1 / PART 2 ב-index.html: הקובץ הזה הוא קישוט.
   הוא לא מרנדר תוכן, לא מביא מידע, ולא מחזיק שום state שהעמוד תלוי בו. כל
   נקודת מגע עם ה-DOM עטופה, ואם משהו כאן נופל — העמוד נשאר עובד ומלא.

   האחריות היחידה שכן קריטית: הקלאס motion-ready על <html>. ה-CSS מסתיר
   [data-reveal] רק כשהוא קיים, ולכן הוא נוסף כאן ורק כאן — אחרי שווידאנו
   ש-IntersectionObserver באמת זמין לחשוף אותם בחזרה.

   נחשף כ-window.ShukMotion עבור עמודים שמרנדרים תוכן דינמית ורוצים לחבר
   אותו לאותה שכבה (ראו observe / stagger / countUp).
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ה-media query נקרא בכל פעם מחדש ולא נשמר: המשתמש יכול לשנות את הגדרת
     מערכת ההפעלה באמצע הביקור, וגם את מתג "עצירת אנימציות" של פאנל הנגישות. */
  function reducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
             root.classList.contains('a11y-nomotion');
    } catch (e) { return false; }
  }

  var supported = 'IntersectionObserver' in window;

  /* ------------------------------------------------------------------
     1. חשיפה בגלילה
     ------------------------------------------------------------------ */
  var revealObserver = null;

  if (supported) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add('is-revealed');
        revealObserver.unobserve(el); // חד-פעמי: אין "אנימציה חוזרת" בגלילה למעלה
        // ניקוי will-change אחרי שהמעבר נגמר, כדי לא להשאיר שכבות compositor
        // מיותרות על עשרות כרטיסים לאורך כל חיי העמוד.
        window.setTimeout(function () { el.classList.add('is-settled'); }, 900);
      });
    }, {
      // הפריט נחשף מעט לפני שהוא באמת נכנס למסך, כדי שהתנועה תסתיים
      // בערך כשהעין מגיעה אליו ולא אחרי.
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.05
    });
  }

  /* חושף אלמנטים חדשים למנגנון. i קובע את מדרגת ההשהיה בתוך הקבוצה. */
  function observe(nodes, startIndex) {
    if (!nodes) return;
    var list = nodes.length !== undefined && !nodes.tagName ? nodes : [nodes];
    var base = startIndex || 0;
    Array.prototype.forEach.call(list, function (el, i) {
      if (!el || !el.setAttribute) return;
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
      // מדרגות רק לשמונת הראשונים: מעבר לזה ההשהיה המצטברת מרגישה כמו איטיות
      el.style.setProperty('--mo-i', String(Math.min(base + i, 7)));
      if (revealObserver && !reducedMotion()) {
        revealObserver.observe(el);
      } else {
        el.classList.add('is-revealed');
      }
    });
  }

  /* קיצור נוח: מרנדרים רשימה, מעבירים את הקונטיינר ומקבלים חשיפה מדורגת. */
  function stagger(container, selector) {
    if (!container) return;
    observe(container.querySelectorAll(selector || ':scope > *'));
  }

  /* ------------------------------------------------------------------
     2. ספירה מונפשת של מספרים
     משמש למחשבון המשכנתא: התוצאה הייתה מתחלפת בקפיצה בכל הקלדה, ולכן
     הנתון החשוב ביותר בכלי היה גם זה שהעין הכי פחות תופסת.
     ------------------------------------------------------------------ */
  var countTimers = new WeakMap();

  function countUp(el, to, format, duration) {
    if (!el) return;
    var fmt = format || function (v) { return String(Math.round(v)); };

    var prev = countTimers.get(el);
    if (prev) { cancelAnimationFrame(prev.raf); }

    var from = (prev && typeof prev.value === 'number') ? prev.value : 0;
    if (reducedMotion() || !window.requestAnimationFrame || from === to) {
      el.textContent = fmt(to);
      countTimers.set(el, { value: to, raf: 0 });
      return;
    }

    var ms = duration || 520;
    var start = performance.now();
    var state = { value: from, raf: 0 };
    countTimers.set(el, state);

    function tick(now) {
      var p = Math.min((now - start) / ms, 1);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic — מהיר ואז נרגע
      state.value = from + (to - from) * eased;
      el.textContent = fmt(state.value);
      if (p < 1) {
        state.raf = requestAnimationFrame(tick);
      } else {
        state.value = to;
        el.textContent = fmt(to);
      }
    }
    state.raf = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------
     3. מצב גלילה של הכותרת
     ------------------------------------------------------------------ */
  function initHeaderState() {
    if (!document.querySelector('header.site')) return;
    var ticking = false;
    function update() {
      root.classList.toggle('is-scrolled', window.scrollY > 12);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------
     4. רצועות גלילה אופקיות
     Math.abs על scrollLeft מנרמל את ההבדל בין דפדפנים ב-RTL (ערכים
     שליליים לפי המפרט המודרני מול ערכים חיוביים בישן) — כך אותה בדיקה
     נכונה לשני הכיוונים בלי לזהות דפדפן.
     ------------------------------------------------------------------ */
  function trackScroller(el) {
    if (!el || el.dataset.moScroller === '1') return;
    el.dataset.moScroller = '1';
    el.classList.add('mo-scroller');

    function update() {
      var max = el.scrollWidth - el.clientWidth;
      if (max <= 2) {
        el.classList.remove('can-scroll-start', 'can-scroll-end');
        return;
      }
      var pos = Math.abs(el.scrollLeft);
      el.classList.toggle('can-scroll-start', pos > 2);
      el.classList.toggle('can-scroll-end', pos < max - 2);
    }

    el.addEventListener('scroll', function () {
      window.requestAnimationFrame(update);
    }, { passive: true });

    if ('ResizeObserver' in window) {
      try { new ResizeObserver(update).observe(el); } catch (e) { /* לא קריטי */ }
    }
    // הכרטיסים מגיעים מ-Supabase אחרי הטעינה, ולכן צריך בדיקה חוזרת
    // כשהתוכן משתנה ולא רק פעם אחת באתחול.
    if ('MutationObserver' in window) {
      try { new MutationObserver(update).observe(el, { childList: true }); } catch (e) { /* לא קריטי */ }
    }
    update();
  }

  function initScrollers() {
    document.querySelectorAll('.featured-scroll, .gallery-strip, .deal-tabs')
      .forEach(trackScroller);
  }

  /* ------------------------------------------------------------------
     5. הפיכת כרטיס לחיץ לנגיש למקלדת
     הכרטיסים הם <div> עם addEventListener('click') — עובדים בעכבר,
     בלתי נגישים לחלוטין ב-Tab ובקורא מסך. במקום לשכתב את כל הרינדור,
     השכבה הזו מוסיפה role/tabindex ומגשרת Enter+Space אל אותו click.
     ------------------------------------------------------------------ */
  function makeCardsAccessible(scope) {
    (scope || document).querySelectorAll('.prop-card, .agency-card, .agent-card').forEach(function (card) {
      if (card.dataset.moKeys === '1') return;
      // אם הכרטיס כבר <a>, הדפדפן מטפל בכל זה לבד
      if (card.tagName === 'A' || card.tagName === 'BUTTON') return;
      // getComputedStyle ולא card.style: ב-index.html ה-cursor נקבע inline
      // בזמן הרינדור, אבל ב-agency.html הוא מגיע מגיליון הסגנונות — בדיקה
      // על ה-inline style בלבד הייתה מפספסת שם כל כרטיס.
      var clickable = card.onclick !== null;
      if (!clickable) {
        try { clickable = getComputedStyle(card).cursor === 'pointer'; } catch (e) { clickable = false; }
      }
      if (!clickable) return;
      card.dataset.moKeys = '1';
      card.setAttribute('role', 'link');
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     6. פס התקדמות הקריאה — רק אם הדפדפן יודע להניע אותו בעצמו
     ------------------------------------------------------------------ */
  function initProgressBar() {
    try {
      if (!CSS.supports || !CSS.supports('animation-timeline', 'scroll()')) return;
      if (document.querySelector('.read-progress')) return;
      var bar = document.createElement('div');
      bar.className = 'read-progress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    } catch (e) { /* קישוט בלבד */ }
  }

  /* ------------------------------------------------------------------
     אתחול
     ------------------------------------------------------------------ */
  function init() {
    try {
      // הדגל שמפעיל את מצב ההתחלה המוסתר ב-CSS. מתווסף רק כשיש במה לחשוף.
      if (supported) root.classList.add('motion-ready');

      observe(document.querySelectorAll('[data-reveal]'));

      /* תור לקריאות שהגיעו לפני שהקובץ הזה נטען. הוא נטען עם defer, ולכן
         שאילתה שחוזרת מהר מאוד (מטמון, או תשובה מקומית) יכולה לרנדר
         כרטיסים עוד לפני ש-window.ShukMotion קיים. בלי התור הקריאה הייתה
         נבלעת בשקט: התוכן נשאר תקין וגלוי, אבל בלי חשיפה ובלי הנגשת
         מקלדת — התנהגות שמשתנה לפי מהירות הרשת. */
      var queued = window.__shukMotionQueue;
      if (Array.isArray(queued)){
        queued.forEach(function (args) {
          try { stagger(args[0], args[1]); makeCardsAccessible(args[0]); } catch (e) {}
        });
      }
      window.__shukMotionQueue = null;

      initHeaderState();
      initScrollers();
      makeCardsAccessible();
      initProgressBar();
    } catch (e) {
      // כשל כאן חייב להשאיר עמוד קריא, לא עמוד ריק
      console.warn('motion layer failed, showing everything unanimated:', e);
      root.classList.remove('motion-ready');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ShukMotion = {
    observe: observe,
    stagger: stagger,
    countUp: countUp,
    trackScroller: trackScroller,
    makeCardsAccessible: makeCardsAccessible,
    reducedMotion: reducedMotion
  };
})();
