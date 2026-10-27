/* ============================================================================
   בורר השוק - "זרם B" של docs/active-city.md

   כפתור ליד שם השוק (‏[data-market-menu]), וגם לחיצה על שם השוק ב-H1,
   פותחים רשימה של השווקים:
   - **שוק חי** - בחירה. נשמרת כבחירה מפורשת (`CityContext.choose(m,
     'choice')`), כלומר גוברת על GPS גם בביקור הבא, ומנווטת לכתובת
     של השוק. בחירה בעפולה מתוך /haifa כותבת עוגייה שבגללה `/` לא
     יפנה שוב לחיפה - בלי זה הבורר היה לולאה.
   - **שוק שעוד לא נפתח** - "בקרוב", וקישור לדף "נפתחים בקרוב" שלו.
     הלחיצה נזכרת (אותה עוגייה). היא לא מפנה את `/` אל הדף הריק: שוק
     שאינו חי נשאר פס בדף הבית, לא יעד של ההפניה.
   - **"אתרו את האזור שלי"** - מיקום מהדפדפן, רק בלחיצה הזו. לא בטעינה.
     סירוב משאיר את הרשימה, בלי לשבור את הדף.

   הכפתור מוסתר כשיש שוק אחד בלבד ברשימה - בורר עם אפשרות אחת הוא רעש.

   נגישות: ‏aria-haspopup / aria-expanded על הכפתור, Escape וקליק בחוץ
   סוגרים, והפוקוס חוזר לכפתור. ‏docs/regional-pages.md.
   ============================================================================ */
(function () {
  'use strict';

  var M = window.ShukMarkets;
  var C = window.CityContext;
  if (!M || !C || typeof C.choose !== 'function') return;

  var CSS = [
    '.mkt-menu-btn{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;',
    'width:1.05em;height:1.05em;margin-inline-start:.12em;border:0;border-radius:999px;cursor:pointer;',
    'background:rgba(14,42,107,.08);color:inherit;font:inherit;font-size:.62em;line-height:1;pointer-events:auto}',
    '.mkt-menu-btn:hover,.mkt-menu-btn[aria-expanded="true"]{background:rgba(14,42,107,.16)}',
    '.mkt-menu-btn svg{width:.7em;height:.7em}',
    '.mkt-menu{position:absolute;z-index:1000;min-width:230px;max-width:calc(100vw - 32px);',
    'background:#fff;border:1px solid rgba(14,42,107,.14);border-radius:14px;padding:6px;',
    'box-shadow:0 14px 40px rgba(14,42,107,.18);font-size:15px;text-align:start;pointer-events:auto}',
    '.mkt-menu[hidden]{display:none}',
    '.mkt-menu h3{margin:6px 10px 4px;font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.02em}',
    '.mkt-menu-list{max-height:min(70vh, 420px);overflow:auto}',
    '.mkt-locate{display:flex;width:100%;margin:0 0 4px;padding:10px 12px;border:0;border-radius:10px;',
    'background:rgba(14,42,107,.06);color:#0e2a6b;font:inherit;font-weight:700;text-align:start;cursor:pointer}',
    '.mkt-locate:hover,.mkt-locate:focus-visible{background:rgba(14,42,107,.12);outline:none}',
    '.mkt-locate:disabled{opacity:.6;cursor:default}',
    '.mkt-locate-msg{margin:0 10px 6px;font-size:13px;line-height:1.45;color:#4b5563}',
    '.mkt-locate-msg:empty{display:none}',
    '#heroCityName{cursor:pointer}',
    '.mkt-menu a{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;',
    'border-radius:10px;color:#0e2a6b;text-decoration:none;font-weight:600}',
    '.mkt-menu a:hover,.mkt-menu a:focus-visible{background:rgba(14,42,107,.06);outline:none}',
    '.mkt-menu a[aria-current="true"]{background:rgba(14,42,107,.08)}',
    '.mkt-menu a small{font-size:12px;font-weight:600;color:#8a6d10;white-space:nowrap}',
    '.mkt-menu a.is-soon{color:#4b5563;font-weight:500}'
  ].join('');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var V10 = document.documentElement.classList.contains('beta-hero');
  var current = C.market();
  var live = M.list.filter(function (m) { return m.live; });
  var soon = M.list.filter(function (m) { return !m.live; });

  /* ---------- v10 (רק עם html.beta-hero) ----------
     "לפי המיקום שלי", אחריו השווקים החיים באזור הנוכחי עם מספר הנכסים, ושורה
     מתקפלת "אזור אחר" עם צפון / מרכז / דרום - רק שווקים חיים שיש בהם נכסים
     פעילים, בלי "בקרוב" ובלי אזורים ריקים (כמו מסנן האזור ב-/swipe). המונים נספרים פעם אחת, בפתיחה הראשונה
     (‏window.v10MarketCityCounts ב-home.js: עמודת העיר בלבד). הקיבוץ לפי קו
     הרוחב של מרכז השוק - markets.js אינו נוגע. */
  function v10Group(m) {
    var lat = m.center ? m.center[0] : 32;
    return lat >= 32.4 ? 'north' : lat >= 31.6 ? 'center' : 'south';
  }
  var V10_GROUPS = [['north', 'צפון'], ['center', 'מרכז'], ['south', 'דרום']];
  function v10Track(m, group, via) {
    if (window.shukTrack) window.shukTrack('region_select', { region: m.slug, group: group, via: via });
  }
  function v10Row(m, n, group) {
    var a = el('a', null, m.label);
    a.href = m.path;
    a.setAttribute('role', 'menuitem');
    if (current && current.slug === m.slug) a.setAttribute('aria-current', 'true');
    if (n) { var b = el('span', 'mkt-n', String(n)); a.appendChild(b); }
    a.addEventListener('click', function () { v10Track(m, group, 'header'); C.choose(m, 'choice'); });
    return a;
  }
  function v10Fill(list) {
    list.textContent = '';
    var get = window.v10MarketCityCounts;
    var draw = function (byCity) {
      list.textContent = '';
      var count = function (m) {
        if (!byCity) return 0;
        return (m.places || [m.city]).reduce(function (s, c) { return s + (byCity.get(c) || 0); }, 0);
      };
      /* רק שווקים חיים (שוק שאינו חי הוא דף "נפתחים בקרוב", והמפרט אוסר עליו):
         למעלה - אלה שבאזור של השוק הנוכחי; "אזור אחר" - שאר החיים שיש בהם נכסים */
      var home = current ? v10Group(current) : 'north';
      live.filter(function (m) { return v10Group(m) === home; })
        .forEach(function (m) { list.appendChild(v10Row(m, count(m), 'live')); });
      var others = byCity ? live.filter(function (m) { return v10Group(m) !== home && count(m) > 0; }) : [];
      if (!others.length) return;
      var more = el('button', 'mkt-other');
      more.type = 'button';
      more.setAttribute('aria-expanded', 'false');
      more.appendChild(el('span', null, 'אזור אחר'));
      more.appendChild(el('span', null, '▾'));
      var box = el('div');
      box.hidden = true;
      var tabs = el('div', 'mkt-tabs');
      tabs.setAttribute('role', 'tablist');
      var rows = el('div');
      var groups = V10_GROUPS.filter(function (g) { return others.some(function (m) { return v10Group(m) === g[0]; }); });
      var show = function (key) {
        Array.prototype.forEach.call(tabs.children, function (t) { t.setAttribute('aria-selected', String(t.dataset.g === key)); });
        rows.textContent = '';
        others.filter(function (m) { return v10Group(m) === key; })
          .forEach(function (m) { rows.appendChild(v10Row(m, count(m), key)); });
      };
      groups.forEach(function (g) {
        var t = el('button', null, g[1]);
        t.type = 'button';
        t.dataset.g = g[0];
        t.setAttribute('role', 'tab');
        t.addEventListener('click', function (e) { e.stopPropagation(); show(g[0]); });
        tabs.appendChild(t);
      });
      box.appendChild(tabs);
      box.appendChild(rows);
      more.addEventListener('click', function (e) {
        e.stopPropagation();
        box.hidden = !box.hidden;
        more.setAttribute('aria-expanded', String(!box.hidden));
        more.lastChild.textContent = box.hidden ? '▾' : '▴';
        if (!box.hidden && groups.length) show(groups[0][0]);
      });
      list.appendChild(more);
      list.appendChild(box);
    };
    draw(null);
    if (typeof get === 'function') get().then(draw, function () { /* בלי מונים */ });
  }

  function buildMenu(id) {
    var menu = el('div', 'mkt-menu');
    menu.id = id;
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    menu.appendChild(el('h3', null, 'בחירת אזור'));

    /* מיקום רק אחרי לחיצה. בלי Geolocation אין כפתור, והרשימה נשארת. */
    if (window.navigator && 'geolocation' in window.navigator) {
      var loc = el('button', 'mkt-locate', V10 ? 'לפי המיקום שלי' : 'אתרו את האזור שלי');
      loc.type = 'button';
      loc.setAttribute('role', 'menuitem');
      var locMsg = el('p', 'mkt-locate-msg', '');
      locMsg.setAttribute('role', 'status');
      loc.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        loc.disabled = true;
        locMsg.textContent = 'מאתרים את המיקום שלך...';
        try {
          window.navigator.geolocation.getCurrentPosition(function (pos) {
            var m = M.locate(pos.coords.latitude, pos.coords.longitude, false);
            var here = C.market();
            if (!m) {
              locMsg.textContent = 'עוד לא הגענו לאזור שלך. בינתיים מוצג ' +
                (here ? here.label : 'עפולה והעמק') + '. אפשר לבחור מהרשימה.';
              loc.disabled = false;
              return;
            }
            if (V10) v10Track(m, m.live ? 'live' : v10Group(m), 'my_location');
            C.choose(m, 'gps');
            /* פס "נפתחים בקרוב" נקרא בטעינה. אם ה-GPS מצא את האזור
               שכבר על המסך, אין ניווט והפס הישן נשאר עד שמסתירים אותו. */
            if (m.live) {
              var strip = document.getElementById('soonStrip');
              if (strip) strip.hidden = true;
            }
            if (here && here.slug === m.slug) {
              locMsg.textContent = 'המיקום שלך באזור ' + m.label + '.';
              loc.disabled = false;
              return;
            }
            locMsg.textContent = 'מעבירים לאזור ' + m.label + '...';
            window.location.href = m.path;
          }, function (err) {
            locMsg.textContent = (err && err.code === 1)
              ? 'לא התקבלה הרשאה למיקום. אפשר לבחור אזור מהרשימה.'
              : 'לא הצלחנו לאתר את המיקום. אפשר לבחור אזור מהרשימה.';
            loc.disabled = false;
          }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 86400000 });
        } catch (err) {
          locMsg.textContent = 'לא הצלחנו לאתר את המיקום. אפשר לבחור אזור מהרשימה.';
          loc.disabled = false;
        }
      });
      menu.appendChild(loc);
      menu.appendChild(locMsg);
    }

    var list = el('div', 'mkt-menu-list');
    if (V10) {
      menu.appendChild(list);
      menu._v10Fill = function () { v10Fill(list); };
      return menu;
    }
    live.forEach(function (m) {
      var a = el('a', null, m.label);
      a.href = m.path;
      a.setAttribute('role', 'menuitem');
      if (current && current.slug === m.slug) {
        a.setAttribute('aria-current', 'true');
        a.appendChild(el('small', null, 'האזור שלך'));
      }
      a.addEventListener('click', function () { C.choose(m, 'choice'); });
      list.appendChild(a);
    });

    if (soon.length) {
      list.appendChild(el('h3', null, 'בקרוב'));
      soon.forEach(function (m) {
        var a = el('a', 'is-soon', m.label);
        a.href = m.path;
        a.setAttribute('role', 'menuitem');
        a.appendChild(el('small', null, 'נפתחים בקרוב'));
        a.addEventListener('click', function () { C.choose(m, 'choice'); });
        list.appendChild(a);
      });
    }
    menu.appendChild(list);
    return menu;
  }

  function place(menu, btn) {
    var r = btn.getBoundingClientRect();
    var top = window.scrollY + r.bottom + 8;
    menu.style.top = top + 'px';
    menu.hidden = false;
    var w = menu.offsetWidth;
    // ‏RTL: מיישרים את קצה התפריט לקצה הימני של הכפתור, בתוך המסך
    var right = Math.max(16, window.innerWidth - r.right - 8);
    var left = window.innerWidth - right - w;
    if (left < 16) left = 16;
    menu.style.left = (window.scrollX + left) + 'px';
  }

  function wire(btn, n) {
    var menu = buildMenu('mktMenu' + n);
    document.body.appendChild(menu);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', menu.id);

    function close(focusBtn) {
      if (menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (focusBtn) btn.focus();
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!menu.hidden) { close(false); return; }
      if (menu._v10Fill && !menu._v10Filled) { menu._v10Filled = true; menu._v10Fill(); }
      place(menu, btn);
      btn.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('a');
      if (first) first.focus();
    });
    document.addEventListener('click', function (e) {
      if (menu.contains(e.target) || e.target === btn) return;
      // ‏v10: קליק בחוץ סוגר ומחזיר את הפוקוס לכפתור - כשהפוקוס היה בתפריט (לא גונבים פוקוס משדה)
      close(V10 && menu.contains(document.activeElement));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close(true);
    });
    window.addEventListener('resize', function () { close(false); });
  }

  function init() {
    /* ‏.v10-only (הכפתור בהדר) קיים רק עם הדגל - בלעדיו הוא אינו חלק מהבורר */
    var buttons = Array.prototype.filter.call(document.querySelectorAll('[data-market-menu]'), function (b) {
      return V10 || !b.classList.contains('v10-only');
    });
    if (!buttons.length) return;
    if (M.list.length < 2) {
      for (var h = 0; h < buttons.length; h++) buttons[h].hidden = true;
      return;
    }
    var style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].hidden = false;
      wire(buttons[i], i);
    }

    /* שם השוק ב-H1 הוא אותו בורר. בלי tabindex משלו: הכפתור שלידו כבר
       נגיש במקלדת, ושם כפול היה שני עצירות טאב על אותה פעולה. */
    var name = document.getElementById('heroCityName');
    var firstBtn = buttons[0];
    if (name && firstBtn) {
      name.addEventListener('click', function (e) {
        /* בלי זה הלחיצה מבעבעת ומאזין הסגירה סוגר מיד את מה שנפתח. */
        e.preventDefault();
        e.stopPropagation();
        if (firstBtn.getAttribute('aria-expanded') !== 'true') firstBtn.click();
      });
    }

    /* "לא האזור שלי" בפס נפתחים בקרוב פותח את אותו בורר. */
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.getAttribute && t.getAttribute('data-soon-switch') != null) {
          e.preventDefault();
          e.stopPropagation();
          if (firstBtn.getAttribute('aria-expanded') !== 'true') firstBtn.click();
          return;
        }
        t = t.parentNode;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
