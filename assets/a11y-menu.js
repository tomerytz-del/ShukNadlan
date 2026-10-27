/* ==========================================================================
   כפתור הנגישות לדף שאין בו את הגרסה המוטבעת של דף הבית (כרגע: ‏/swipe)
   --------------------------------------------------------------------------
   כפתור נגישות הוא חובה בכל דף (תקנות הנגישות). בדף הבית הוא מוטבע
   (‏index.html + ‏assets/home.js); כאן אותו תפריט, אותן ארבע הגדרות ואותו
   מפתח שמירה (‏shuknadlan_a11y), כך שמה שנבחר בדף אחד חל גם בשני.
   הסגנון של v10: ימין, כחול, אייקון SVG, וחץ/פריט בתפריט שמקפלים אותו
   ללשונית צרה בקצה המסך (‏sk_a11y_min, לסשן). המיקום נקבע במשתנים
   (‏--a11y-bottom), כדי שהדף יוכל להרים אותו מעל מה שיושב בתחתית.
   נטען: <script src="assets/a11y-menu.js" defer></script>
   ========================================================================== */
(function () {
  'use strict';
  if (document.getElementById('a11yFab')) return;

  var MODES = ['a11y-contrast', 'a11y-links', 'a11y-readable', 'a11y-nomotion'];
  var KEY = 'shuknadlan_a11y';
  var FONT_MIN = 90, FONT_MAX = 160, FONT_STEP = 10;
  var h = document.documentElement;

  var CSS = [
    ':root{--a11y-size:44px;--a11y-gap:12px;--a11y-bottom:calc(12px + env(safe-area-inset-bottom,0px))}',
    '@media(min-width:1024px){:root{--a11y-size:40px;--a11y-gap:16px}}',
    '.a11y-fab{position:fixed;z-index:150;right:var(--a11y-gap);bottom:var(--a11y-bottom);width:var(--a11y-size);height:var(--a11y-size);',
    '  border-radius:50%;border:0;padding:0;background:#0e2a6b;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;',
    '  box-shadow:0 6px 16px rgba(13,27,61,.3)}',
    '.a11y-fab svg{width:22px;height:22px}',
    '.a11y-fab:focus-visible,.a11y-panel button:focus-visible{outline:3px solid #c9a227;outline-offset:3px}',
    '.a11y-panel{position:fixed;z-index:151;right:var(--a11y-gap);bottom:calc(var(--a11y-bottom) + var(--a11y-size) + 10px);',
    '  width:min(266px,calc(100vw - var(--a11y-gap) * 2));max-height:calc(100dvh - var(--a11y-bottom) - var(--a11y-size) - 30px);overflow-y:auto;',
    '  background:#fff;color:#1b1f2a;border:1px solid #d5dae6;border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:14px;display:none;text-align:right}',
    '.a11y-panel[data-open="true"]{display:block}',
    'html body .a11y-panel h3{margin:0 0 10px;font-size:15px;font-weight:800;color:#1b1f2a}',
    '.a11y-panel button.opt{display:flex;align-items:center;justify-content:space-between;width:100%;text-align:right;border:1.5px solid #d5dae6;',
    '  border-radius:10px;background:#fff;padding:9px 11px;margin-bottom:7px;font:inherit;font-size:13.5px;font-weight:600;color:#1b1f2a;cursor:pointer}',
    '.a11y-panel button.opt[aria-pressed="true"]{border-color:#0e2a6b;background:rgba(14,42,107,.08);color:#0e2a6b}',
    '.a11y-panel .state{font-size:12px;color:#4a5060}',
    '.a11y-font-row{display:flex;gap:7px;margin-bottom:7px}',
    '.a11y-font-row button{flex:1;border:1.5px solid #d5dae6;border-radius:10px;background:#fff;padding:9px;font:inherit;font-weight:700;font-size:14px;color:#1b1f2a;cursor:pointer}',
    '.a11y-panel .reset{width:100%;border:0;background:#c9a227;color:#0d1b3d;border-radius:10px;padding:9px;font:inherit;font-weight:800;font-size:13px;margin-top:4px;cursor:pointer}',
    '.a11y-hide-opt{width:100%;margin-top:6px;min-height:40px;border:1px solid #d5dae6;border-radius:10px;background:#fff;color:#0e2a6b;font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
    '.a11y-hide{position:fixed;z-index:151;right:calc(var(--a11y-gap) + var(--a11y-size) - 12px);bottom:calc(var(--a11y-bottom) + var(--a11y-size) - 10px);',
    '  display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:1px solid #e3e8f2;border-radius:50%;',
    '  background:#fff;color:#0e2a6b;box-shadow:0 2px 6px rgba(13,27,61,.2);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s}',
    '.a11y-hide svg{width:11px;height:11px}',
    '.a11y-hide::before{content:"";position:absolute;inset:-8px}',
    '.a11y-fab:hover + .a11y-hide,.a11y-fab:focus-visible + .a11y-hide,.a11y-hide:hover,.a11y-hide:focus-visible{opacity:1;pointer-events:auto}',
    'html.a11y-min .a11y-fab{right:0;width:18px;height:44px;border-radius:10px 0 0 10px;box-shadow:-2px 2px 8px rgba(13,27,61,.25)}',
    'html.a11y-min .a11y-fab svg{width:14px;height:14px}',
    'html.a11y-min .a11y-hide{display:none}',
    'html.a11y-links a{text-decoration:underline !important;font-weight:700 !important}',
    'html.a11y-readable,html.a11y-readable *{font-family:Arial,Helvetica,sans-serif !important}',
    'html.a11y-nomotion *{animation:none !important;transition:none !important;scroll-behavior:auto !important}',
    'html.a11y-contrast body{background:#000 !important;color:#fff !important}',
    'html.a11y-contrast .a11y-panel,html.a11y-contrast .sw-sheet,html.a11y-contrast .sw-li,html.a11y-contrast .sw-views,html.a11y-contrast .sw-act,',
    'html.a11y-contrast .sw-sum,html.a11y-contrast .sw-ic,html.a11y-contrast .sw-chip,html.a11y-contrast .sw-tabs{background:#000 !important;border-color:#fff !important;color:#fff !important}',
    'html.a11y-contrast h1,html.a11y-contrast h2,html.a11y-contrast h3,html.a11y-contrast p,html.a11y-contrast span,html.a11y-contrast label,html.a11y-contrast b{color:#fff !important}',
    'html.a11y-contrast button,html.a11y-contrast a,html.a11y-contrast .sw-gold{color:#FFD84D !important}',
    'html.a11y-contrast .a11y-panel button,html.a11y-contrast .sw-gold,html.a11y-contrast .sw-white{background:#000 !important;border:1.5px solid #FFD84D !important}',
    '@media(prefers-reduced-motion:reduce){.a11y-hide{transition:none}}'
  ].join('\n');

  var ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.2" r="2.2"/><path d="M10.2 7.6h3.4l-.4 4.6h4.3l2.6 5.6-1.9.9-2-4.4h-5.1a1.6 1.6 0 0 1-1.6-1.8z"/><path d="M8.1 10.3l.3 2.1a4.6 4.6 0 1 0 6.1 5.3l1.8.9a6.6 6.6 0 1 1-8.2-8.3z"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  var OPTS = [['a11y-contrast', 'ניגודיות גבוהה'], ['a11y-links', 'הדגשת קישורים'], ['a11y-readable', 'גופן קריא'], ['a11y-nomotion', 'עצירת אנימציות']];

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var s = raw ? JSON.parse(raw) : {};
      return { fontPct: Number(s.fontPct) || 100, modes: Array.isArray(s.modes) ? s.modes : [] };
    } catch (e) { return { fontPct: 100, modes: [] }; }
  }
  var prefs = read();
  var fab, panel;

  function apply() {
    h.style.fontSize = prefs.fontPct === 100 ? '' : prefs.fontPct + '%';
    MODES.forEach(function (m) { h.classList.toggle(m, prefs.modes.indexOf(m) >= 0); });
    if (panel) {
      panel.querySelector('#a11yFontReset').textContent = prefs.fontPct + '%';
      Array.prototype.forEach.call(panel.querySelectorAll('.opt'), function (b) {
        var on = prefs.modes.indexOf(b.getAttribute('data-a11y')) >= 0;
        b.setAttribute('aria-pressed', String(on));
        b.querySelector('.state').textContent = on ? 'פועל' : 'כבוי';
      });
    }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // ההעדפות חלות מיד, עוד לפני שהכפתור נבנה
  apply();

  function build() {
    var style = document.createElement('style');
    style.id = 'a11yMenuStyle';
    style.textContent = CSS;
    document.head.appendChild(style);

    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'a11y-fab';
    fab.id = 'a11yFab';
    fab.setAttribute('aria-label', 'תפריט נגישות');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', 'a11yPanel');
    fab.title = 'נגישות';
    fab.innerHTML = ICON;

    var hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'a11y-hide';
    hide.setAttribute('aria-label', 'הסתרת כפתור הנגישות');
    hide.innerHTML = CHEV;

    panel = document.createElement('div');
    panel.className = 'a11y-panel';
    panel.id = 'a11yPanel';
    panel.setAttribute('data-open', 'false');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'תפריט נגישות');
    panel.innerHTML = '<h3>נגישות</h3><div class="a11y-font-row">' +
      '<button type="button" id="a11yFontDown" aria-label="הקטנת גודל הטקסט">א−</button>' +
      '<button type="button" id="a11yFontReset" aria-label="גודל טקסט רגיל">100%</button>' +
      '<button type="button" id="a11yFontUp" aria-label="הגדלת גודל הטקסט">א+</button></div>' +
      OPTS.map(function (o) {
        return '<button type="button" class="opt" data-a11y="' + o[0] + '" aria-pressed="false">' + o[1] + ' <span class="state">כבוי</span></button>';
      }).join('') +
      '<button type="button" class="reset" id="a11yReset">איפוס הגדרות</button>' +
      '<button type="button" class="a11y-hide-opt">הסתרת הכפתור</button>';

    document.body.appendChild(fab);
    document.body.appendChild(hide);
    document.body.appendChild(panel);
    apply();

    function setOpen(open) {
      panel.setAttribute('data-open', String(open));
      fab.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('button').focus();
    }
    /* ‏/swipe בטלפון (סבב 5 §3): מתחיל כלשונית, כדי לא לשבת על הכרטיס. ‏'0' = הוחזר בביקור */
    var swipeMobile = !!document.querySelector('body.sw-body') && !window.matchMedia('(min-width:1024px)').matches;
    var manual = false;
    try { var st0 = sessionStorage.getItem('sk_a11y_min'); manual = st0 === '1' || (swipeMobile && st0 !== '0'); } catch (e) { manual = swipeMobile; }
    function sync() { h.classList.toggle('a11y-min', manual); }
    function minimize() {
      manual = true;
      try { sessionStorage.setItem('sk_a11y_min', '1'); } catch (e) {}
      setOpen(false);
      sync();
      fab.focus();
    }
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      // בקיפול הלחיצה על הלשונית מחזירה את הכפתור
      if (manual) {
        manual = false;
        try { sessionStorage.setItem('sk_a11y_min', '0'); } catch (err) {}
        sync();
        return;
      }
      setOpen(panel.getAttribute('data-open') !== 'true');
    });
    hide.addEventListener('click', function (e) { e.stopPropagation(); minimize(); });
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('a11y-hide-opt')) { minimize(); return; }
      if (b.classList.contains('opt')) {
        var m = b.getAttribute('data-a11y');
        prefs.modes = prefs.modes.indexOf(m) >= 0 ? prefs.modes.filter(function (x) { return x !== m; }) : prefs.modes.concat(m);
      } else if (b.id === 'a11yFontUp' || b.id === 'a11yFontDown') {
        prefs.fontPct = Math.min(FONT_MAX, Math.max(FONT_MIN, prefs.fontPct + (b.id === 'a11yFontUp' ? FONT_STEP : -FONT_STEP)));
      } else if (b.id === 'a11yFontReset') {
        prefs.fontPct = 100;
      } else if (b.id === 'a11yReset') {
        prefs = { fontPct: 100, modes: [] };
      }
      apply();
    });
    document.addEventListener('click', function () { if (panel.getAttribute('data-open') === 'true') setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.getAttribute('data-open') === 'true') { setOpen(false); fab.focus(); }
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
