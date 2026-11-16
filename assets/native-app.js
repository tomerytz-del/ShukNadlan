/* ============================================================================
   מעטפת האפליקציה מהחנות (WebView של Capacitor).
   ----------------------------------------------------------------------------
   הקובץ נטען רק כשסוכן המשתמש כולל ShukNadlanApp, או כשהגשר הנייטיב כבר
   רץ. בדפדפן אין אף אחד מהם, והקובץ אינו נטען בכלל (pwa-install.js).

   מה שנוסף כאן, ורק באפליקציה:
   * סרגל תחתון: בית, לידים, משימות, משכנתא, קורס. הדשבורד של הסוכן/ת,
     הלידים והיומן כבר חיים ב-CRM; הסרגל של ה-CRM נשאר שם, ובכותרת שלו
     מתווסף קישור לקורס כדי שלא ייערמו שני סרגלים.
   * קורס (/course ו-/learn): בלי מחיר, בלי כפתור רכישה ובלי קישור לקופה.
     מי שכבר רשום/ה נכנס/ת ללמידה. באתר בדפדפן אין את זה.
   * קישור target=_blank לאותו אתר נשאר ב-WebView. וואטסאפ, טלפון ומפות
     יוצאים החוצה כמו קודם.

   אין כאן סכימה ואין כאן מחיר חדש. Apple 3.1.1 ומדיניות התשלומים של Play.
   ========================================================================== */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') api.install(window);
})(function () {
  var SITE = 'https://shuknadlan.co.il';

  var TABS = [
    { id: 'home', label: 'בית', aria: 'בית: נכסים וחיפוש', href: '/', icon: 'home' },
    { id: 'leads', label: 'לידים', aria: 'לידים', href: '/crm?goto=accLeads', icon: 'inbox' },
    { id: 'tasks', label: 'משימות', aria: 'משימות ויומן', href: '/crm?goto=accAgenda', icon: 'check' },
    { id: 'mortgage', label: 'משכנתא', aria: 'מחשבון משכנתא', href: '/#calc', icon: 'calc' },
    { id: 'course', label: 'קורס', aria: 'קורס הכנה למבחן המתווכים', href: '/course', icon: 'book' },
  ];

  var ICONS = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    inbox: '<path d="M3 5h18v14H3z"/><path d="m3 13 4 3h10l4-3"/>',
    check: '<path d="M8 6h11M8 12h11M8 18h11"/><path d="m4 6 1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z"/><path d="M5 4v16"/>',
  };

  /* דפים שבהם סרגל משלנו היה מכסה סרגל קיים או מסך מלא (נגן הקורס,
     החתמה, החלקה). הקורס עצמו (/course) כן מקבל את הסרגל. */
  var SKIP_TABS = {
    '/crm': 1, '/developer-crm': 1, '/professional-crm': 1, '/professional-manage': 1,
    '/csm': 1, '/sign': 1, '/checkout': 1, '/pricing': 1, '/swipe': 1, '/learn': 1,
  };

  var BUY_TEXT = /מתחילים ללמוד|אני רוצה להתחיל|לפתיחת הקורס|לתשלום מאובטח|לרכוש גישה|רכישת הקורס/;
  /* בלוקי המכירה בדף הקורס בלבד. לא סורקים כל ₪: שאלת בחינה, "תקציב (₪)"
     וקישור של נכס ("עד 1.5 מיליון ₪") אינם רכישה. */
  var COURSE_SALE = '.lp-pricebox, .lp-reassure, .lp-stick, #buy, .lp-offer, .lp-final a.lp-cta, [data-gift], .lp-pay';

  function isNativeApp(ua, win) {
    if (/ShukNadlanApp/i.test(String(ua || ''))) return true;
    win = win || {};
    return !!(win.ShukNadlanApp || win.__SHUK_NATIVE_BRIDGE__);
  }

  function pagePath(pathname) {
    var path = String(pathname || '/');
    path = path.replace(/\.html$/i, '').replace(/\/+$/, '');
    return path || '/';
  }

  function endsWith(value, suffix) {
    return value.length >= suffix.length && value.slice(-suffix.length) === suffix;
  }

  function parseUrl(raw, base) {
    try { return new URL(String(raw || ''), base || SITE); } catch (e) { return null; }
  }

  function hostOf(url) {
    var host = url.hostname.toLowerCase();
    return host.indexOf('www.') === 0 ? host.slice(4) : host;
  }

  function isPaymentHost(host) {
    return host === 'greeninvoice.co.il' || endsWith(host, '.greeninvoice.co.il')
      || host === 'morning.co' || endsWith(host, '.morning.co')
      || host === 'morning.dev' || endsWith(host, '.morning.dev');
  }

  function staysInApp(raw) {
    var url = parseUrl(raw);
    if (!url) return false;
    var scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return false;
    var host = hostOf(url);
    return host === 'shuknadlan.co.il' || endsWith(host, '.shuknadlan.co.il') || host === 'localhost';
  }

  function isExternal(raw) {
    var url = parseUrl(raw);
    if (!url) return false;
    var scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme === 'tel' || scheme === 'mailto' || scheme === 'sms' || scheme === 'geo' || scheme === 'whatsapp' || scheme === 'intent') {
      return true;
    }
    if (scheme !== 'http' && scheme !== 'https') return false;
    var host = hostOf(url);
    if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'web.whatsapp.com' || host === 'chat.whatsapp.com') return true;
    if (host === 'waze.com' || host === 'ul.waze.com') return true;
    if (host === 'maps.apple.com' || host === 'maps.google.com' || host === 'maps.app.goo.gl') return true;
    if (host === 'google.com' && url.pathname.indexOf('/maps') === 0) return true;
    if (host === 'goo.gl' && url.pathname.indexOf('/maps') === 0) return true;
    if (host === 'facebook.com' || endsWith(host, '.facebook.com') || host === 'instagram.com' || endsWith(host, '.instagram.com')) return true;
    return false;
  }

  /* אותו חוזה כמו ShellUrls.isPurchase: מסלולים, קופה, ומורנינג. */
  function isPurchaseUrl(raw) {
    var url = parseUrl(raw);
    if (!url) return false;
    var scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return false;
    var host = hostOf(url);
    if (isPaymentHost(host)) return true;
    if (host !== 'shuknadlan.co.il' && !endsWith(host, '.shuknadlan.co.il') && host !== 'localhost') return false;
    return pagePath(url.pathname) === '/pricing' || pagePath(url.pathname) === '/checkout';
  }

  function showTabs(path, hasBottomNav) {
    if (hasBottomNav) return false;
    return !SKIP_TABS[pagePath(path)];
  }

  function activeTab(path, hash, search) {
    path = pagePath(path);
    hash = String(hash || '');
    search = String(search || '');
    if (path === '/course' || path === '/learn') return 'course';
    if ((path === '/' || path === '') && (hash === '#calc' || hash === 'calc')) return 'mortgage';
    if (path === '/crm') {
      if (/[?&]goto=accAgenda(?:&|$)/.test(search)) return 'tasks';
      if (/[?&]goto=acc(?:Leads|Clients)(?:&|$)/.test(search)) return 'leads';
    }
    if (path === '/' || path === '/property' || path === '/agency' || path === '/agent'
      || path === '/project' || path === '/open-house' || path === '/projects'
      || path === '/agencies' || path === '/agents') return 'home';
    return '';
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  function install(win) {
    if (!win || win.__SHUK_NATIVE_APP__) return;
    if (!isNativeApp(win.navigator && win.navigator.userAgent, win)) return;
    win.__SHUK_NATIVE_APP__ = true;
    var doc = win.document;
    if (!doc) return;
    if (doc.documentElement) doc.documentElement.classList.add('shuk-native');
    keepInApp(win);
    function boot() {
      mountTabs(win);
      mountCrmCourse(win);
      shieldCourse(win);
    }
    if (doc.readyState === 'loading' && doc.addEventListener) doc.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  /* target=_blank לאותו אתר לא יוצא לדפדפן. רכישה נעצרת בלי קישור החוצה. */
  function keepInApp(win) {
    var doc = win.document;
    if (!doc || !doc.addEventListener || doc.__shukNativeLinks) return;
    doc.__shukNativeLinks = true;
    doc.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || !node.closest) return;
      var anchor = node.closest('a[href]');
      if (!anchor) return;
      var href = anchor.href || anchor.getAttribute('href') || '';
      if (isPurchaseUrl(href)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var target = String(anchor.getAttribute('target') || '').toLowerCase();
      if (target === '_blank' && staysInApp(href) && !isExternal(href)) {
        event.preventDefault();
        try { win.location.assign(href); } catch (e) {}
      }
    }, true);
    if (!win.open || win.open.__shukNativeOpen) return;
    var orig = win.open.bind(win);
    function wrapped(url, target, features) {
      if (isPurchaseUrl(url)) return null;
      if (url && staysInApp(url) && !isExternal(url)) {
        try { win.location.assign(url); } catch (e) {}
        return null;
      }
      return orig(url, target, features);
    }
    wrapped.__shukNativeOpen = true;
    win.open = wrapped;
  }

  function ensureStyles(doc) {
    if (!doc || doc.getElementById('shukNativeTabsCss')) return;
    var style = doc.createElement('style');
    style.id = 'shukNativeTabsCss';
    style.textContent = [
      'html.shuk-native-tabs{--shuk-tab-h:calc(62px + env(safe-area-inset-bottom,0px))}',
      'html.shuk-native-tabs body{padding-bottom:var(--shuk-tab-h) !important}',
      '#shukAppTabs{position:fixed;inset-inline:0;bottom:0;z-index:180;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));',
      'align-items:end;background:#fff;border-top:1px solid #e3e8f2;padding:4px 2px env(safe-area-inset-bottom,0px);',
      'box-shadow:0 -6px 24px rgba(14,26,51,.06);direction:rtl}',
      '#shukAppTabs a{min-height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
      'padding:4px 1px 6px;color:#5c6b86;font:700 11px/1.15 inherit;text-decoration:none;text-align:center}',
      '#shukAppTabs a span{display:flex;align-items:center;justify-content:center;width:46px;height:28px;border-radius:14px}',
      '#shukAppTabs a[aria-current="page"]{color:#1f5bf0}',
      '#shukAppTabs a[aria-current="page"] span{background:#e8efff}',
      '#shukAppTabs a:focus-visible{outline:2px solid #1f5bf0;outline-offset:-3px;border-radius:12px}',
      'html.shuk-native-tabs .sticky-bar{bottom:var(--shuk-tab-h)}',
      'html.shuk-native-tabs body.has-sticky-bar{padding-bottom:calc(78px + var(--shuk-tab-h)) !important}',
      'html.shuk-native-tabs .ss-dock:not([hidden]){bottom:var(--shuk-tab-h)}',
      'html.shuk-native-tabs .a11y-fab{bottom:calc(var(--shuk-tab-h) + 8px)}',
      'html.shuk-native-tabs .a11y-panel{bottom:calc(var(--shuk-tab-h) + 64px)}',
      'html.shuk-native-tabs #gabW{--gw-bottom:calc(16px + var(--shuk-tab-h))}',
      'html.shuk-native-tabs body.sticky-on #gabW{--gw-bottom:calc(90px + var(--shuk-tab-h))}',
      'a.shuk-crm-course{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 10px;',
      'border-radius:12px;background:#e8efff;color:#1f5bf0;font:700 13px/1 inherit;text-decoration:none;white-space:nowrap}',
      'html.shuk-native .lp-pricebox,html.shuk-native .lp-reassure,html.shuk-native .lp-stick,html.shuk-native #buy,',
      'html.shuk-native .lp-offer,html.shuk-native .lp-final a.lp-cta,html.shuk-native [data-gift],html.shuk-native .lp-pay,',
      'html.shuk-native a[href="/pricing"],html.shuk-native a[href^="/pricing"],html.shuk-native a[href^="/checkout"]{display:none !important}',
    ].join('');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function mountTabs(win) {
    var doc = win.document;
    if (!doc || !doc.body || doc.getElementById('shukAppTabs')) return;
    var path = pagePath(win.location && win.location.pathname);
    if (!showTabs(path, !!doc.getElementById('bottomNav'))) return;
    ensureStyles(doc);
    doc.documentElement.classList.add('shuk-native-tabs');
    var nav = doc.createElement('nav');
    nav.id = 'shukAppTabs';
    nav.setAttribute('aria-label', 'ניווט האפליקציה');
    var current = activeTab(path, win.location.hash, win.location.search);
    for (var i = 0; i < TABS.length; i++) {
      var tab = TABS[i];
      var a = doc.createElement('a');
      a.href = tab.href;
      a.setAttribute('aria-label', tab.aria);
      if (tab.id === current) a.setAttribute('aria-current', 'page');
      a.innerHTML = '<span>' + icon(tab.icon) + '</span>' + tab.label;
      nav.appendChild(a);
    }
    doc.body.appendChild(nav);
  }

  function mountCrmCourse(win) {
    var doc = win.document;
    if (!doc || doc.getElementById('shukCrmCourse')) return;
    if (pagePath(win.location && win.location.pathname) !== '/crm') return;
    var actions = doc.querySelector('header.crm .header-actions');
    if (!actions) return;
    ensureStyles(doc);
    var a = doc.createElement('a');
    a.id = 'shukCrmCourse';
    a.className = 'shuk-crm-course';
    a.href = '/course';
    a.setAttribute('aria-label', 'קורס הכנה למבחן המתווכים');
    a.textContent = 'קורס';
    actions.appendChild(a);
  }

  function hideEl(el) {
    if (!el || el.getAttribute('data-shuk-native-hidden') === '1') return;
    el.setAttribute('data-shuk-native-hidden', '1');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  /* מסתיר רק בלוקי מכירה וכפתורי רכישה. ב-/learn לא נוגעים בטקסט שמכיל ₪:
     שאלות הבחינה כוללות סכומים (150,000 ₪ וכדומה) והן חייבות להישאר. */
  function applyCourseShield(doc, path) {
    if (!doc || !doc.querySelectorAll) return;
    path = pagePath(path);
    var course = path === '/course';
    var learn = path === '/learn';
    if (!course && !learn) return;
    if (course) {
      var blocks = doc.querySelectorAll(COURSE_SALE);
      for (var i = 0; i < blocks.length; i++) hideEl(blocks[i]);
      var back = doc.querySelector && doc.querySelector('header .back-link');
      if (back && /רכש/.test(back.textContent || '')) back.textContent = 'כניסה לקורס';
      var paras = doc.querySelectorAll('p');
      for (var p = 0; p < paras.length; p++) {
        if ((paras[p].textContent || '').indexOf('תוספת תשלום') !== -1 && (paras[p].textContent || '').length < 400) {
          paras[p].textContent = 'הקורס מתעדכן: כל מבחן חדש שהרשם מפרסם נכנס למאגר, וכל שיעור חדש נפתח למי שכבר לומדים בקורס.';
        }
      }
    }
    var anchors = doc.querySelectorAll('a[href]');
    for (var a = 0; a < anchors.length; a++) {
      var href = anchors[a].href || anchors[a].getAttribute('href') || '';
      if (isPurchaseUrl(href)) hideEl(anchors[a]);
    }
    var controls = doc.querySelectorAll('a, button');
    for (var c = 0; c < controls.length; c++) {
      var text = String(controls[c].textContent || '').replace(/\s+/g, ' ').trim();
      if (BUY_TEXT.test(text)) hideEl(controls[c]);
    }
  }

  function shieldCourse(win) {
    var doc = win.document;
    if (!doc || !doc.body) return;
    var path = pagePath(win.location && win.location.pathname);
    if (path !== '/course' && path !== '/learn') return;
    ensureStyles(doc);
    var scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      var raf = win.requestAnimationFrame || function (fn) { return win.setTimeout(fn, 16); };
      raf(function () {
        scheduled = false;
        if (doc.body) applyCourseShield(doc, path);
      });
    }
    if (win.MutationObserver && !doc.__shukShieldObs) {
      var obs = new win.MutationObserver(schedule);
      doc.__shukShieldObs = obs;
      obs.observe(doc.body, { childList: true, subtree: true });
    }
    applyCourseShield(doc, path);
  }

  return {
    TABS: TABS,
    isNativeApp: isNativeApp,
    pagePath: pagePath,
    staysInApp: staysInApp,
    isExternal: isExternal,
    isPurchaseUrl: isPurchaseUrl,
    showTabs: showTabs,
    activeTab: activeTab,
    applyCourseShield: applyCourseShield,
    install: install,
  };
});
