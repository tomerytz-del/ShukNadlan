/* ============================================================================
   בורר השוק - "זרם B" של docs/active-city.md

   כפתור ליד שם השוק (‏[data-market-menu]) פותח רשימה של השווקים:
   - **שוק חי** - בחירה. נשמרת כבחירה מפורשת (`CityContext.choose(m,
     'choice')`), כלומר גוברת על GPS ועל IP גם בביקור הבא, ומנווטת לכתובת
     של השוק. בחירה בעפולה מתוך /haifa-krayot כותבת עוגייה שבגללה `/` לא
     יפנה שוב לחיפה - בלי זה הבורר היה לולאה.
   - **שוק שעוד לא נפתח** - "בקרוב", וקישור לדף "נפתחים בקרוב" שלו. לא
     בחירה: בחירה בו הייתה שולחת גולש/ת שמחפש/ת דירה לדף בלי נכסים.

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

  var current = C.market();
  var live = M.list.filter(function (m) { return m.live; });
  var soon = M.list.filter(function (m) { return !m.live; });

  function buildMenu(id) {
    var menu = el('div', 'mkt-menu');
    menu.id = id;
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    menu.appendChild(el('h3', null, 'בחירת אזור'));
    live.forEach(function (m) {
      var a = el('a', null, m.label);
      a.href = m.path;
      a.setAttribute('role', 'menuitem');
      if (current && current.slug === m.slug) {
        a.setAttribute('aria-current', 'true');
        a.appendChild(el('small', null, 'האזור שלך'));
      }
      a.addEventListener('click', function () { C.choose(m, 'choice'); });
      menu.appendChild(a);
    });

    if (soon.length) {
      menu.appendChild(el('h3', null, 'בקרוב'));
      soon.forEach(function (m) {
        var a = el('a', 'is-soon', m.label);
        a.href = m.path;
        a.setAttribute('role', 'menuitem');
        a.appendChild(el('small', null, 'נפתחים בקרוב'));
        menu.appendChild(a);
      });
    }
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
      place(menu, btn);
      btn.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('a');
      if (first) first.focus();
    });
    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && e.target !== btn) close(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close(true);
    });
    window.addEventListener('resize', function () { close(false); });
  }

  function init() {
    var buttons = document.querySelectorAll('[data-market-menu]');
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
