/**
 * גשר שמוזרק ל-WebView בלבד (לא נטען באתר בדפדפן).
 * שומר על האתר עצמו בלי שינוי: שיתוף, קישורים חיצוניים, התראות ו-OAuth.
 * הלוגיקה הטהורה מיוצאת לבדיקות; install() רץ רק כשיש window.
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') api.install(window);
})(function () {
  var SITE_ORIGIN = 'https://shuknadlan.co.il';
  var AUTH_CALLBACK = 'il.co.shuknadlan.app://auth-callback';
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var OAUTH_CANCELLED = 'ההתחברות עם Google בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';
  var OAUTH_FAILED = 'ההתחברות עם Google נכשלה: אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';
  var APPLE_CANCELLED = 'ההתחברות עם Apple בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';
  var APPLE_FAILED = 'ההתחברות עם Apple נכשלה: אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';
  var PAY_NOTE = 'ניהול המנוי מתבצע באתר';

  function rewriteAuthorizeUrl(raw) {
    var url;
    try { url = new URL(String(raw)); } catch (e) { return null; }
    var host = url.hostname;
    var authorize = host.endsWith('.supabase.co') && url.pathname.indexOf('/auth/v1/authorize') !== -1;
    var google = host === 'accounts.google.com';
    if (!authorize && !google) return null;
    if (authorize) url.searchParams.set('redirect_to', AUTH_CALLBACK);
    return url.toString();
  }

  function isOAuthNavigation(raw) {
    return rewriteAuthorizeUrl(raw) !== null;
  }

  function isExternalUrl(raw) {
    var url;
    try { url = new URL(String(raw), SITE_ORIGIN); } catch (e) { return false; }
    var scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme === 'tel' || scheme === 'mailto' || scheme === 'sms' || scheme === 'geo' || scheme === 'whatsapp' || scheme === 'intent') {
      return true;
    }
    if (scheme !== 'http' && scheme !== 'https') return false;
    var host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'web.whatsapp.com' || host === 'chat.whatsapp.com') return true;
    if (host === 'waze.com' || host === 'ul.waze.com') return true;
    if (host === 'maps.apple.com' || host === 'maps.google.com' || host === 'maps.app.goo.gl') return true;
    if (host === 'google.com' && url.pathname.indexOf('/maps') === 0) return true;
    if (host === 'goo.gl' && url.pathname.indexOf('/maps') === 0) return true;
    return false;
  }

  function endsWith(value, suffix) {
    return value.length >= suffix.length && value.slice(-suffix.length) === suffix;
  }

  /** דף מסלולים, קופה, או עמוד הסליקה של מורנינג. בתוך האפליקציה אין רכישה. */
  function isPurchaseUrl(raw) {
    var url;
    try { url = new URL(String(raw), SITE_ORIGIN); } catch (e) { return false; }
    var scheme = url.protocol.replace(':', '').toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return false;
    var host = url.hostname.toLowerCase();
    if (host.indexOf('www.') === 0) host = host.slice(4);
    if (host === 'greeninvoice.co.il' || endsWith(host, '.greeninvoice.co.il')
      || host === 'morning.co' || endsWith(host, '.morning.co')
      || host === 'morning.dev' || endsWith(host, '.morning.dev')) {
      return true;
    }
    var site = host === 'shuknadlan.co.il' || endsWith(host, '.shuknadlan.co.il') || host === 'localhost';
    if (!site) return false;
    var path = url.pathname.replace(/\.html$/i, '').replace(/\/+$/, '') || '/';
    return path === '/pricing' || path === '/checkout';
  }

  function isFreePriceText(text) {
    return /ללא תשלום|ללא עלות/.test(String(text || ''));
  }

  function isAuthCallback(raw) {
    return String(raw || '').indexOf(AUTH_CALLBACK) === 0;
  }

  function oauthProvider(win) {
    try { return win.sessionStorage.getItem('shuk_oauth_provider') || ''; } catch (e) { return ''; }
  }

  function noteOauthProvider(win, raw) {
    try {
      var provider = new URL(String(raw), SITE_ORIGIN).searchParams.get('provider') || '';
      if (provider === 'apple' || provider === 'google') {
        win.sessionStorage.setItem('shuk_oauth_provider', provider);
      }
    } catch (e) {}
  }

  function failOAuth(win, message) {
    if (!win || !win.document) return;
    var provider = oauthProvider(win);
    var text = message || OAUTH_FAILED;
    if (provider === 'apple') {
      text = /בוטלה|access_denied|cancel/i.test(String(message || '')) ? APPLE_CANCELLED : APPLE_FAILED;
    }
    var signup = String((win.location && win.location.pathname) || '').indexOf('developer-signup') !== -1;
    var label = signup ? 'הרשמה עם Google' : 'התחברות עם Google';
    var buttons = win.document.querySelectorAll('#googleLoginBtn, #googleBtn, #csmGoogle, .auth-google');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = false;
      var gl = buttons[i].querySelector('.gl-label');
      if (gl && String(gl.textContent || '').indexOf('מעבירים ל-Google') === 0) gl.textContent = label;
    }
    var appleLabel = signup ? 'הרשמה עם Apple' : 'התחברות עם Apple';
    var apples = win.document.querySelectorAll('.auth-apple');
    for (var a = 0; a < apples.length; a++) {
      apples[a].disabled = false;
      var al = apples[a].querySelector('.al-label');
      if (al && String(al.textContent || '').indexOf('מעבירים ל-Apple') === 0) al.textContent = appleLabel;
    }
    var ids = ['loginError', 'lgMsg', 'csmLoginMsg', 'feedback'];
    for (var j = 0; j < ids.length; j++) {
      var el = win.document.getElementById(ids[j]);
      if (!el) continue;
      el.textContent = text;
      if (ids[j] === 'feedback') el.style.color = 'var(--red)';
      if (ids[j] === 'loginError' && win.FriendlyError && win.FriendlyError.attachHelp) {
        win.FriendlyError.attachHelp(el, text);
      }
    }
  }

  function stripOauthBuster(win) {
    try {
      var u = new URL(win.location.href);
      if (!u.searchParams.has('shuk_oauth')) return;
      u.searchParams.delete('shuk_oauth');
      var next = u.pathname + u.search + u.hash;
      if (win.history && win.history.replaceState) win.history.replaceState(win.history.state, '', next);
    } catch (e) {}
  }

  function paintOauthError(win) {
    function run() {
      var q;
      try { q = new URL(win.location.href).searchParams; } catch (e) { return; }
      var code = q.get('error') || q.get('error_code') || '';
      var desc = q.get('error_description') || '';
      if (!code && !desc) return;
      var apple = oauthProvider(win) === 'apple';
      try { if (apple) win.sessionStorage.removeItem('shuk_oauth_provider'); } catch (e2) {}
      var msg = apple
        ? (/access_denied|cancel/i.test(code) ? APPLE_CANCELLED : APPLE_FAILED)
        : (/access_denied|cancel/i.test(code) ? OAUTH_CANCELLED
          : 'ההתחברות עם Google נכשלה: ' + (desc || 'אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.'));
      failOAuth(win, msg);
    }
    if (!win.document) return;
    if (win.document.readyState === 'loading' && win.document.addEventListener) {
      win.document.addEventListener('DOMContentLoaded', run);
    } else run();
  }

  function authReturnUrl(callbackUrl, returnTo) {
    var cb;
    try { cb = new URL(String(callbackUrl)); } catch (e) { return null; }
    if (cb.protocol === 'https:' && cb.origin === SITE_ORIGIN) return cb.toString();
    if (cb.protocol !== 'il.co.shuknadlan.app:') return null;
    var dest;
    try { dest = new URL(returnTo || (SITE_ORIGIN + '/crm')); } catch (e2) { dest = new URL(SITE_ORIGIN + '/crm'); }
    if (dest.origin !== SITE_ORIGIN) dest = new URL(SITE_ORIGIN + '/crm');
    cb.searchParams.forEach(function (value, key) { dest.searchParams.set(key, value); });
    if (cb.hash) dest.hash = cb.hash;
    return dest.toString();
  }

  function pluginsOf(win) {
    try {
      return (win.Capacitor && win.Capacitor.Plugins) || {};
    } catch (e) {
      return {};
    }
  }

  function install(win) {
    if (!win || win.__SHUK_NATIVE_BRIDGE__) return;
    win.__SHUK_NATIVE_BRIDGE__ = true;
    var native = {
      SITE_ORIGIN: SITE_ORIGIN,
      AUTH_CALLBACK: AUTH_CALLBACK,
      rewriteAuthorizeUrl: rewriteAuthorizeUrl,
      isExternalUrl: isExternalUrl,
      authReturnUrl: authReturnUrl,
      isAuthCallback: isAuthCallback,
      failOAuth: function (message) { failOAuth(win, message); },
      launchDestination: function () { return launchDestination(win); },
      showPlanSheet: function () { showPlanSheet(win); },
      showLocationPrompt: function () { showLocationPrompt(win, true); },
    };
    win.ShukNative = native;
    installTracking(win);
    stripOauthBuster(win);
    paintOauthError(win);
    blockPurchaseDocument(win);

    patchNavigation(win);
    patchShare(win);
    patchWindowOpen(win);
    patchClicks(win);
    patchSavedSearch(win);
    schedulePurchaseShield(win);
    scheduleLocationPrompt(win);
    whenCapacitor(win, function () { wireNative(win); });
  }

  function installTracking(win) {
    var app = win.ShukNadlanApp || {};
    if (typeof app.trackingAllowed === 'undefined') app.trackingAllowed = undefined;
    app.setTrackingAllowed = function (value) { publishTracking(win, value); };
    win.ShukNadlanApp = app;
  }

  function publishTracking(win, value) {
    var allowed = value === true || value === 'true' ? true : (value === false || value === 'false' ? false : null);
    if (allowed === null) return;
    var app = win.ShukNadlanApp || {};
    var now = Date.now ? Date.now() : 0;
    var same = win.__shukTrackingValue === allowed && now - (win.__shukTrackingAt || 0) < 2000;
    app.trackingAllowed = allowed;
    app.setTrackingAllowed = function (next) { publishTracking(win, next); };
    win.ShukNadlanApp = app;
    if (same) return;
    win.__shukTrackingValue = allowed;
    win.__shukTrackingAt = now;
    try {
      win.dispatchEvent(new win.CustomEvent('shuknadlan:tracking', { detail: { trackingAllowed: allowed } }));
    } catch (e) {}
    try {
      win.dataLayer = win.dataLayer || [];
      win.dataLayer.push({ event: 'app_tracking_status', tracking_allowed: allowed });
    } catch (e2) {}
  }

  function patchNavigation(win) {
    var loc = win.location;
    if (!loc) return;
    function intercept(url, orig) {
      if (isPurchaseUrl(url)) {
        showPayOverlay(win);
        return;
      }
      var rewritten = rewriteAuthorizeUrl(url);
      if (!rewritten) return orig(url);
      noteOauthProvider(win, url);
      rememberReturn(win);
      // הניווט עצמו נתפס בצד הנייטיב: שם נוסף PKCE ונשמר המאמת.
      // פתיחה מכאן הייתה מדלגת על המאמת, והחזרה לא הייתה יכולה להחליף code.
      return orig(rewritten);
    }
    try {
      var proto = win.Location && win.Location.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'href');
      if (desc && desc.set && desc.configurable && !proto.__shukHref) {
        Object.defineProperty(proto, 'href', {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (value) {
            if (isPurchaseUrl(value)) {
              showPayOverlay(win);
              return;
            }
            var rewritten = rewriteAuthorizeUrl(value);
            if (rewritten) {
              noteOauthProvider(win, value);
              rememberReturn(win);
              return desc.set.call(this, rewritten);
            }
            return desc.set.call(this, value);
          },
        });
        proto.__shukHref = true;
      }
    } catch (e) { /* ב-WebView ישן ה-setter נעול; shouldOverride תופס את הניווט */ }
    try {
      var assign = loc.assign && loc.assign.bind(loc);
      var replace = loc.replace && loc.replace.bind(loc);
      if (assign) loc.assign = function (url) { return intercept(url, assign); };
      if (replace) loc.replace = function (url) { return intercept(url, replace); };
    } catch (e) { /* location עשוי להיות נעול; השכבה הנייטיב תופסת את הניווט */ }
  }

  function rememberReturn(win) {
    try {
      var current = String(win.location.href || '').split('#')[0];
      if (current.indexOf(SITE_ORIGIN) === 0) {
        win.sessionStorage.setItem('shuk_oauth_return', current);
        win.localStorage.setItem('shuk_oauth_return', current);
      }
    } catch (e) {}
  }

  function openOAuth(win, url) {
    var browser = pluginsOf(win).Browser;
    if (browser && browser.open) {
      Promise.resolve(browser.open({ url: url })).catch(function () {});
      return;
    }
    var shell = pluginsOf(win).ShukShell;
    if (shell && shell.openExternal) {
      Promise.resolve(shell.openExternal({ url: url })).catch(function () {});
      return;
    }
    try { win.open(url, '_blank'); } catch (e) {}
  }

  function clickedHref(attribute, resolved) {
    var raw = String(attribute || '');
    if (/^(https?:|tel:|mailto:|sms:|geo:|whatsapp:|intent:)/i.test(raw)) return raw;
    return resolved || raw;
  }

  function openExternal(win, url) {
    function handOff() {
      // ניווט רגיל נתפס ב-shouldOverrideUrlLoading. window.open של _blank לא.
      try {
        if (win.location && win.location.assign) win.location.assign(url);
      } catch (e) {}
    }
    var shell = pluginsOf(win).ShukShell;
    if (shell && shell.openExternal) {
      Promise.resolve(shell.openExternal({ url: url })).catch(handOff);
      return;
    }
    handOff();
  }

  function patchShare(win) {
    var nav = win.navigator;
    if (!nav) return;
    var original = nav.share && nav.share.bind(nav);
    function nativeShare(data) {
      data = data || {};
      var share = pluginsOf(win).Share;
      if (!share || !share.share) {
        if (original) return original(data);
        return Promise.reject(new Error('share_unavailable'));
      }
      return share.share({
        title: data.title || '',
        text: data.text || '',
        url: data.url || '',
        dialogTitle: 'שיתוף',
      }).catch(function (err) {
        var msg = err && err.message ? String(err.message) : '';
        if (/cancel/i.test(msg)) return;
        if (original) return original(data);
        throw err;
      });
    }
    try {
      Object.defineProperty(nav, 'share', { configurable: true, writable: true, value: nativeShare });
    } catch (e) {
      try { nav.share = nativeShare; } catch (e2) {}
    }
  }

  function patchWindowOpen(win) {
    if (!win.open) return;
    var orig = win.open.bind(win);
    win.open = function (url, target, features) {
      if (isPurchaseUrl(url)) {
        showPayOverlay(win);
        return null;
      }
      var rewritten = rewriteAuthorizeUrl(url);
      if (rewritten) {
        noteOauthProvider(win, url);
        rememberReturn(win);
        try { win.location.assign(rewritten); } catch (e) { openOAuth(win, rewritten); }
        return null;
      }
      if (isExternalUrl(url)) {
        openExternal(win, url);
        return null;
      }
      return orig(url, target, features);
    };
  }

  function patchClicks(win) {
    if (!win.document || !win.document.addEventListener) return;
    win.document.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || !node.closest) return;
      if (isPlanControl(node)) {
        event.preventDefault();
        event.stopPropagation();
        showPlanSheet(win);
        return;
      }
      var control = node.closest('a[href], button');
      if (control && (anchorIsPurchase(control) || isPurchaseButton(control))) {
        event.preventDefault();
        event.stopPropagation();
        showPayOverlay(win);
        return;
      }
      var anchor = node.closest('a[href]');
      if (!anchor) return;
      var href = clickedHref(anchor.getAttribute('href'), anchor.href);
      if (!isExternalUrl(href)) return;
      event.preventDefault();
      openExternal(win, href);
    }, true);
  }

  function patchSavedSearch(win) {
    if (!win.fetch || win.fetch.__shukPatched) return;
    var orig = win.fetch.bind(win);
    function wrapped(input, init) {
      return orig(input, init).then(function (res) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (String(url).indexOf('saved-search-intake') !== -1) {
            res.clone().json().then(function (data) {
              if (data && data.search_id) {
                try { win.localStorage.setItem('shuk_saved_search_id', String(data.search_id)); } catch (e) {}
                registerPushToken(win, currentPushToken(win), String(data.search_id));
              }
            }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    }
    wrapped.__shukPatched = true;
    win.fetch = wrapped;
  }

  function whenCapacitor(win, cb) {
    var tries = 0;
    function tick() {
      tries += 1;
      var cap = win.Capacitor;
      if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
        cb();
        return;
      }
      if (tries < 40) win.setTimeout(tick, 100);
    }
    tick();
  }

  function wireNative(win) {
    var app = pluginsOf(win).App;
    if (app && app.addListener) {
      app.addListener('appUrlOpen', function (event) {
        onOpenUrl(win, event && event.url);
      });
      app.addListener('backButton', function (event) {
        if (event && event.canGoBack) win.history.back();
        else if (app.minimizeApp) app.minimizeApp();
        else if (app.exitApp) app.exitApp();
      });
    }
    var bar = pluginsOf(win).StatusBar;
    if (bar) {
      if (bar.setBackgroundColor) bar.setBackgroundColor({ color: '#0e2a6b' }).catch(function () {});
      if (bar.setStyle) bar.setStyle({ style: 'LIGHT' }).catch(function () {});
    }
    var splash = pluginsOf(win).SplashScreen;
    if (splash && splash.hide) splash.hide().catch(function () {});
    startPush(win);
  }

  function onOpenUrl(win, url) {
    if (!url) return;
    var browser = pluginsOf(win).Browser;
    if (browser && browser.close) Promise.resolve(browser.close()).catch(function () {});
    // החזרת Google מטופלת בצד הנייטיב, אחרי החלפת ה-code. ניווט כאן היה
    // טוען את דף הכניסה בלי session ומשאיר את הכפתור באמצע.
    if (isAuthCallback(url)) return;
    var stored = '';
    try { stored = win.sessionStorage.getItem('shuk_oauth_return') || win.localStorage.getItem('shuk_oauth_return') || ''; } catch (e) {}
    var shell = pluginsOf(win).ShukShell;
    var apply = function (returnTo) {
      var dest = authReturnUrl(url, returnTo || stored || (SITE_ORIGIN + '/crm'));
      if (dest && win.location && String(win.location.href) !== dest) win.location.replace(dest);
    };
    if (shell && shell.consumeOAuthReturn && String(url).indexOf('il.co.shuknadlan.app:') === 0) {
      Promise.resolve(shell.consumeOAuthReturn()).then(function (res) {
        apply((res && res.url) || stored);
      }).catch(function () { apply(stored); });
      return;
    }
    apply(stored);
  }

  function launchDestination(win) {
    var cap = win.Capacitor;
    var app = cap && cap.Plugins && cap.Plugins.App;
    if (!app || !app.getLaunchUrl) return Promise.resolve(null);
    return Promise.resolve(app.getLaunchUrl()).then(function (launch) {
      if (!launch || !launch.url) return null;
      if (isAuthCallback(launch.url)) return 'wait';
      return authReturnUrl(launch.url, SITE_ORIGIN + '/crm');
    }).catch(function () { return null; });
  }

  function currentPushToken(win) {
    try { return win.sessionStorage.getItem('shuk_push_token') || ''; } catch (e) { return ''; }
  }

  function startPush(win) {
    var push = pluginsOf(win).PushNotifications;
    if (!push || !push.requestPermissions) return;
    Promise.resolve(push.checkPermissions ? push.checkPermissions() : { receive: 'prompt' }).then(function (perm) {
      if (!perm || perm.receive === 'denied') return null;
      if (perm.receive === 'granted') return perm;
      return push.requestPermissions();
    }).then(function (perm) {
      if (!perm || perm.receive !== 'granted') return;
      push.addListener('registration', function (token) {
        var value = token && token.value;
        if (!value) return;
        try { win.sessionStorage.setItem('shuk_push_token', value); } catch (e) {}
        registerPushToken(win, value, savedSearchId(win));
      });
      push.addListener('registrationError', function () {});
      push.addListener('pushNotificationActionPerformed', function (action) {
        var data = action && action.notification && action.notification.data;
        var url = data && (data.url || data.link);
        if (url && String(url).indexOf(SITE_ORIGIN) === 0) win.location.assign(url);
      });
      return push.register();
    }).catch(function () {});
  }

  function savedSearchId(win) {
    try {
      var id = win.localStorage.getItem('shuk_saved_search_id') || '';
      return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
    } catch (e) { return null; }
  }

  function deviceKey(win) {
    var key = 'shuk_device_key';
    try {
      var existing = win.localStorage.getItem(key);
      if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
      var fresh = (win.crypto && win.crypto.randomUUID) ? win.crypto.randomUUID() : fallbackUuid();
      win.localStorage.setItem(key, fresh);
      return fresh;
    } catch (e) {
      return fallbackUuid();
    }
  }

  function fallbackUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function accessToken(win) {
    try {
      for (var i = 0; i < win.localStorage.length; i++) {
        var key = win.localStorage.key(i) || '';
        if (key.indexOf('sb-') !== 0 || key.indexOf('auth-token') === -1) continue;
        var parsed = JSON.parse(win.localStorage.getItem(key) || 'null');
        if (parsed && parsed.access_token) return parsed.access_token;
        if (parsed && parsed.currentSession && parsed.currentSession.access_token) return parsed.currentSession.access_token;
      }
    } catch (e) {}
    return '';
  }

  function hadSession(win) {
    try { return win.localStorage.getItem('shuk_had_session') === '1'; } catch (e) { return false; }
  }

  function registerPushToken(win, token, searchId) {
    if (!token || !win.fetch) return;
    var userJwt = accessToken(win);
    var clearUser = hadSession(win) && !userJwt;
    try { win.localStorage.setItem('shuk_had_session', userJwt ? '1' : ''); } catch (e) {}
    var platform = 'android';
    try {
      if (win.Capacitor && win.Capacitor.getPlatform) platform = win.Capacitor.getPlatform();
    } catch (e2) {}
    if (platform !== 'ios' && platform !== 'android') platform = 'android';
    var body = {
      p_token: token,
      p_platform: platform,
      p_device_key: deviceKey(win),
      p_clear_user: clearUser,
    };
    if (searchId) body.p_saved_search_id = searchId;
    win.fetch(SUPABASE_URL + '/rest/v1/rpc/register_app_push_device', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + (userJwt || SUPABASE_ANON_KEY),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).catch(function () {});
  }

  function payNoteEl(doc) {
    var p = doc.createElement('p');
    p.setAttribute('data-shuk-pay-note', '1');
    p.textContent = PAY_NOTE;
    p.style.cssText = 'margin:8px 0;font-size:.9rem;line-height:1.55;color:#5c6b86';
    return p;
  }

  function ensurePayNote(el) {
    if (!el || (el.querySelector && el.querySelector('[data-shuk-pay-note]'))) return;
    el.appendChild(payNoteEl(el.ownerDocument));
  }

  function hidePurchaseEl(el) {
    if (!el || el.getAttribute('data-shuk-pay-hidden') === '1') return;
    el.setAttribute('data-shuk-pay-hidden', '1');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  function anchorIsPurchase(el) {
    if (!el || !el.getAttribute || String(el.tagName || '').toUpperCase() !== 'A') return false;
    var href = el.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return false;
    return isPurchaseUrl(el.href || href);
  }

  function isPurchaseButton(el) {
    if (!el || !el.tagName) return false;
    var tag = String(el.tagName).toUpperCase();
    if (tag !== 'BUTTON' && tag !== 'A') return false;
    if (el.id === 'topupBtn' || el.id === 'pmWalletTopup') return true;
    if (el.classList && (el.classList.contains('wl-pay') || el.classList.contains('pm-wallet-link'))) return true;
    var act = el.getAttribute('data-act') || '';
    if (act === 'promote' || act === 'activate' || act === 'renew') return true;
    if (el.hasAttribute('data-buy') || el.hasAttribute('data-amount')) return true;
    if (el.classList && (el.classList.contains('pc-tile') || el.classList.contains('pc-chip'))) {
      var badge = el.querySelector && el.querySelector('.pc-badge');
      if (badge && !(el.querySelector('.pc-badge-free'))) return true;
    }
    var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^רכישה/.test(text) || /^טעינ/.test(text)) return true;
    if (/^בחירה ב-/.test(text) && el.closest && el.closest('#tgPlans, #tierGateScreen')) return true;
    return false;
  }

  function isPlanControl(node) {
    if (!node || !node.closest) return false;
    if (node.closest('#shukPlanSheet')) return false;
    return !!node.closest('#tierBadge, #promoStrip, #promoPopLink, #tgCompare, .tier-badge, .promo-gift, [data-shuk-plan="1"]');
  }

  function planFeatureLines(features) {
    var out = [];
    var list = features || [];
    for (var i = 0; i < list.length; i++) {
      var item = cleanPlanFeature(list[i]);
      if (item) out.push(item.all);
    }
    return out;
  }

  function cleanPlanFeature(feature) {
    feature = feature || {};
    if (feature.on === false) return null;
    var all = String((feature.bold || '') + (feature.text || '')).replace(/\s+/g, ' ').trim();
    if (!all || all.indexOf('₪') !== -1) return null;
    var bold = String(feature.bold || '').replace(/\s+/g, ' ').trim();
    if (bold && all.indexOf(bold) !== 0) bold = '';
    return { bold: bold, text: all.slice(bold.length), all: all };
  }

  function offerPlain(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text || text.indexOf('₪') !== -1 || text.indexOf('@') !== -1) return '';
    return text;
  }

  function isCarryoverLine(text) {
    return /^כל מה שכלול|^כל הבסיס|^כל מה שב-/.test(text);
  }

  function samePlanLines(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].all !== b[i].all) return false;
    }
    return true;
  }

  /* כרטיסי הגיליון מאותו קטלוג של דף המסלולים. בלי מחיר, בלי מכסה ובלי
     כפתור בחירה. במסלול שאחרי הראשון השורות הקצרות הן מה שנוסף. */
  function planSheetCards(list, opts) {
    opts = opts || {};
    var promo = opts.promo || {};
    var headline = offerPlain(opts.headline != null ? opts.headline : promo.headline);
    var sub = offerPlain(opts.sub != null ? opts.sub : promo.sub);
    var recommended = promo.active === true && promo.tier ? promo.tier : '';
    var cards = [];
    var rows = list || [];
    for (var i = 0; i < rows.length; i++) {
      var tier = rows[i] || {};
      var full = [];
      var features = tier.features || [];
      for (var f = 0; f < features.length; f++) {
        var fullItem = cleanPlanFeature(features[f]);
        if (fullItem) full.push(fullItem);
      }
      var shortSource = tier.cardFeatures && tier.cardFeatures.length ? tier.cardFeatures : tier.features;
      var shortAll = [];
      var source = shortSource || [];
      for (var s = 0; s < source.length; s++) {
        var shortItem = cleanPlanFeature(source[s]);
        if (shortItem) shortAll.push(shortItem);
      }
      var heading = 'מה כלול';
      var preview = shortAll.slice(0, 6);
      if (i > 0) {
        var prevName = rows[i - 1] && rows[i - 1].name ? rows[i - 1].name : 'המסלול הקודם';
        heading = 'מה נוסף לעומת ' + prevName;
        preview = [];
        for (var p = 0; p < shortAll.length && preview.length < 6; p++) {
          if (isCarryoverLine(shortAll[p].all)) continue;
          preview.push(shortAll[p]);
        }
        if (!preview.length) {
          for (var k = 0; k < full.length && preview.length < 6; k++) {
            if (isCarryoverLine(full[k].all)) continue;
            preview.push(full[k]);
          }
        }
      }
      cards.push({
        id: tier.id || '',
        name: tier.name || '',
        tagline: tier.tagline || '',
        color: tier.color || '',
        current: tier.id === opts.current,
        recommended: tier.id === recommended,
        heading: heading,
        preview: preview,
        full: full,
        expandable: full.length > 0 && !samePlanLines(preview, full),
      });
    }
    return {
      offer: headline ? { headline: headline, sub: sub } : null,
      cards: cards,
    };
  }

  function safeSiteRetry(raw) {
    try {
      var url = new URL(String(raw));
      if (url.protocol !== 'https:') return '';
      var host = url.hostname.toLowerCase();
      if (host.indexOf('www.') === 0) host = host.slice(4);
      if (host !== 'shuknadlan.co.il' && !endsWith(host, '.shuknadlan.co.il')) return '';
      if (url.pathname.indexOf('offline.html') !== -1 || url.pathname.indexOf('purchase-note') !== -1) return '';
      return url.toString();
    } catch (e) { return ''; }
  }

  function disarmPlanAnchor(anchor) {
    if (!anchor || anchor.getAttribute('data-shuk-plan') === '1') return;
    var id = anchor.id || '';
    var plan = id === 'tierBadge' || id === 'promoStrip' || id === 'promoPopLink' || id === 'tgCompare'
      || (anchor.classList && (anchor.classList.contains('tier-badge') || anchor.classList.contains('promo-gift')));
    if (!plan) return;
    anchor.setAttribute('data-shuk-plan', '1');
    anchor.setAttribute('data-shuk-pay-done', '1');
    anchor.removeAttribute('href');
    anchor.removeAttribute('target');
    anchor.setAttribute('role', 'button');
  }

  function neutralizeAnchor(anchor) {
    disarmPlanAnchor(anchor);
    if (!anchorIsPurchase(anchor) || anchor.getAttribute('data-shuk-pay-done') === '1') return;
    var doc = anchor.ownerDocument;
    var parent = anchor.parentNode;
    if (parent && parent.querySelector && parent.querySelector('[data-shuk-pay-note]')) {
      if (anchor.remove) anchor.remove();
      return;
    }
    var note = payNoteEl(doc);
    if (anchor.replaceWith) anchor.replaceWith(note);
  }

  function lockPaid(el) {
    if (!el || el.getAttribute('data-shuk-pay-locked') === '1') return;
    el.setAttribute('data-shuk-pay-locked', '1');
    el.setAttribute('data-shuk-pay-display', el.style.display || '');
    el.style.display = 'none';
  }

  function unlockPaid(el) {
    if (!el || el.getAttribute('data-shuk-pay-locked') !== '1') return;
    el.style.display = el.getAttribute('data-shuk-pay-display') || '';
    el.removeAttribute('data-shuk-pay-locked');
  }

  function shieldPurchaseModal(doc) {
    var modal = doc.getElementById('purchaseModal');
    if (!modal) return;
    var price = doc.getElementById('pmPrice');
    var open = modal.style.display && modal.style.display !== 'none';
    var paid = !!(open && price && !price.classList.contains('free') && !isFreePriceText(price.textContent));
    var confirm = doc.getElementById('pmConfirm');
    var ack = doc.getElementById('pmAckWrap');
    var wallet = doc.getElementById('pmWallet');
    var terms = doc.getElementById('pmAckTerms');
    if (!paid) {
      unlockPaid(confirm);
      unlockPaid(ack);
      unlockPaid(wallet);
      unlockPaid(terms);
      var stale = modal.querySelector('[data-shuk-pay-note]');
      if (stale && stale.remove) stale.remove();
      return;
    }
    lockPaid(confirm);
    lockPaid(ack);
    lockPaid(wallet);
    lockPaid(terms);
    ensurePayNote(modal.querySelector('.pm-card') || modal);
  }

  function scanPurchases(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var anchors = doc.querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) neutralizeAnchor(anchors[i]);
    var buttons = doc.querySelectorAll('button, a.pc-tile, a.pc-chip');
    for (var j = 0; j < buttons.length; j++) {
      var button = buttons[j];
      if (!isPurchaseButton(button)) continue;
      hidePurchaseEl(button);
      var host = button.closest && button.closest('#accWallet, #tierGateScreen, #topupSheet, #purchaseModal, .pricing');
      if (host) ensurePayNote(host);
    }
    var ids = ['wlAmounts', 'wlAfter', 'topupModeNote', 'topupChips', 'pricingGrid'];
    for (var k = 0; k < ids.length; k++) {
      var box = doc.getElementById(ids[k]);
      if (!box) continue;
      hidePurchaseEl(box);
      ensurePayNote((box.closest && box.closest('#accWallet, #topupSheet')) || box.parentNode);
    }
    var secure = doc.querySelectorAll('.wl-secure');
    for (var s = 0; s < secure.length; s++) {
      hidePurchaseEl(secure[s]);
      ensurePayNote((secure[s].closest && secure[s].closest('#accWallet')) || secure[s].parentNode);
    }
    var prices = doc.querySelectorAll('.tg-price');
    for (var p = 0; p < prices.length; p++) {
      if (isFreePriceText(prices[p].textContent)) continue;
      hidePurchaseEl(prices[p]);
    }
    var signupPrices = doc.querySelectorAll('.pricing');
    for (var q = 0; q < signupPrices.length; q++) {
      if (!signupPrices[q].querySelector('#pricePage, #pricePromote')) continue;
      hidePurchaseEl(signupPrices[q]);
      ensurePayNote(signupPrices[q].parentNode);
    }
    var gate = doc.getElementById('tierGateScreen');
    if (gate && gate.querySelector('[data-shuk-pay-hidden]')) ensurePayNote(gate);
    shieldPurchaseModal(doc);
    hidePlanSteering(doc);
    ensureAppStyles(doc);
    placeWalletNote(doc);
  }

  function hidePlanSteering(doc) {
    var link = doc.getElementById('promoPopLink');
    if (link) {
      link.hidden = true;
      link.textContent = '';
      disarmPlanAnchor(link);
    }
    var compare = doc.getElementById('tgCompare');
    if (compare) hidePurchaseEl(compare);
  }

  function ensureAppStyles(doc) {
    if (!doc || doc.getElementById('shukAppStyles')) return;
    var style = doc.createElement('style');
    style.id = 'shukAppStyles';
    style.textContent = [
      '#dashboard .tier-chip{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}',
      '#dashboard .tier-badge,#dashboard #tierBadge{flex:0 0 auto !important;max-width:none !important;overflow:visible !important;text-overflow:clip !important}',
      'header.crm [data-shuk-pay-note]{display:none !important}',
      '#accWallet .acc-body>[data-shuk-pay-note]{color:#5c6b86;font-size:.82rem;margin:0 0 10px}',
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function placeWalletNote(doc) {
    var headerNotes = doc.querySelectorAll('header.crm [data-shuk-pay-note]');
    for (var i = 0; i < headerNotes.length; i++) {
      if (headerNotes[i].remove) headerNotes[i].remove();
    }
    var wallet = doc.getElementById('accWallet');
    if (!wallet) return;
    var body = wallet.querySelector('.acc-body') || wallet;
    var notes = wallet.querySelectorAll('[data-shuk-pay-note]');
    var note = null;
    for (var n = 0; n < notes.length; n++) {
      if (!note) note = notes[n];
      else if (notes[n].remove) notes[n].remove();
    }
    if (!note) note = payNoteEl(doc);
    note.style.color = '#5c6b86';
    if (note.parentNode !== body || body.firstChild !== note) body.insertBefore(note, body.firstChild);
  }

  function currentPlanId(doc) {
    var badge = doc.getElementById('tierBadge') || doc.querySelector('.tier-badge');
    if (!badge || !badge.classList) return '';
    if (badge.classList.contains('tier-premium')) return 'premium';
    if (badge.classList.contains('tier-mid')) return 'mid';
    if (badge.classList.contains('tier-free')) return 'free';
    return '';
  }

  function planSheetStyle() {
    return [
      '#shukPlanSheet{color-scheme:only light;forced-color-adjust:none}',
      '#shukPlanSheet .panel{background:#f4f7fe;color:#12224f;width:100%;max-height:min(92dvh,760px);display:flex;flex-direction:column;border-radius:18px 18px 0 0;box-sizing:border-box;padding-bottom:env(safe-area-inset-bottom);font-family:Heebo,Arial,sans-serif}',
      '#shukPlanSheet .head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px 0}',
      '#shukPlanSheet h2{margin:0;font-size:1.25rem;font-weight:800;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important}',
      '#shukPlanSheet .close{min-width:44px;min-height:44px;padding:0 14px;border:0;background:transparent;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important;font:inherit;font-weight:800;font-size:1rem}',
      '#shukPlanSheet .offer{margin:8px 16px 0;background:#0e2a6b;border:2px solid #e2c35a;border-radius:14px;padding:12px 14px}',
      '#shukPlanSheet .offer strong{display:block;color:#f1d98a !important;-webkit-text-fill-color:#f1d98a !important;font-size:1.05rem;line-height:1.35}',
      '#shukPlanSheet .offer span{display:block;margin-top:4px;color:#d5def5 !important;-webkit-text-fill-color:#d5def5 !important;font-size:.9rem;line-height:1.45}',
      '#shukPlanSheet .track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:16px 8% 8px;scroll-padding-inline:8%;scrollbar-width:none}',
      '#shukPlanSheet .track::-webkit-scrollbar{display:none}',
      '#shukPlanSheet .card{flex:0 0 82%;scroll-snap-align:center;box-sizing:border-box;position:relative;background:#fff;color:#12224f;border:1px solid #e3e8f4;border-radius:22px;padding:46px 16px 12px;min-width:0;box-shadow:0 18px 40px -28px rgba(13,27,61,.45)}',
      '#shukPlanSheet .card.pro{border:1.5px solid #0e2a6b}',
      '#shukPlanSheet .card.is-rec{box-shadow:0 0 0 2px #d4af37,0 18px 40px -28px rgba(13,27,61,.45)}',
      '#shukPlanSheet .card.elite{background:linear-gradient(170deg,#1b3a85 0%,#0d1b3d 55%);border:0;box-shadow:0 0 0 2px #d4af37}',
      '#shukPlanSheet .flag{position:absolute;top:12px;inset-inline-start:12px;background:#e2c35a;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important;font-weight:900;font-size:.82rem;line-height:1;padding:7px 12px;border-radius:999px}',
      '#shukPlanSheet .ribbon{position:absolute;top:12px;inset-inline-end:12px;background:#0e2a6b;color:#fff !important;-webkit-text-fill-color:#fff !important;font-weight:800;font-size:.75rem;line-height:1;padding:7px 10px;border-radius:6px}',
      '#shukPlanSheet .card.elite .ribbon{background:#f1d98a;color:#0d1b3d !important;-webkit-text-fill-color:#0d1b3d !important}',
      '#shukPlanSheet .name{margin:0;font-size:1.45rem;font-weight:800;line-height:1.15;color:#0d1b3d !important;-webkit-text-fill-color:#0d1b3d !important}',
      '#shukPlanSheet .card.elite .name{color:#f1d98a !important;-webkit-text-fill-color:#f1d98a !important;font-size:1.7rem}',
      '#shukPlanSheet .tagline{margin:6px 0 0;font-size:.92rem;line-height:1.45;color:#4a5578 !important;-webkit-text-fill-color:#4a5578 !important}',
      '#shukPlanSheet .card.elite .tagline,#shukPlanSheet .card.elite .list li{color:#e3e9f7 !important;-webkit-text-fill-color:#e3e9f7 !important}',
      '#shukPlanSheet .inc{margin:12px 0 0;font-size:.82rem;font-weight:800;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important}',
      '#shukPlanSheet .card.elite .inc,#shukPlanSheet .card.elite .mk,#shukPlanSheet .card.elite .more{color:#f1d98a !important;-webkit-text-fill-color:#f1d98a !important}',
      '#shukPlanSheet .list{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}',
      '#shukPlanSheet .list li{display:flex;gap:8px;align-items:flex-start;font-size:.92rem;line-height:1.45;color:#12224f !important;-webkit-text-fill-color:#12224f !important}',
      '#shukPlanSheet .mk{flex:none;font-weight:900;color:#1c8546 !important;-webkit-text-fill-color:#1c8546 !important}',
      '#shukPlanSheet .more{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin-top:8px;border:0;background:transparent;font:inherit;font-weight:800;font-size:.95rem;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important}',
      '#shukPlanSheet .dots{display:flex;justify-content:center;gap:2px;padding:2px 12px 10px}',
      '#shukPlanSheet .dots button{min-width:44px;min-height:44px;border:0;background:transparent;padding:0}',
      '#shukPlanSheet .dot{display:block;width:8px;height:8px;border-radius:50%;background:#c9d3ea;margin:0 auto}',
      '#shukPlanSheet .dots button[aria-current="true"] .dot{background:#0e2a6b;width:18px;border-radius:99px}',
    ].join('\n');
  }

  function showPlanSheet(win) {
    var doc = win && win.document;
    if (!doc || !doc.body) return;
    var existing = doc.getElementById('shukPlanSheet');
    if (existing && existing.remove) existing.remove();
    var Tiers = win.Tiers;
    var list = Tiers && typeof Tiers.list === 'function' ? Tiers.list() : [];
    var promo = Tiers && Tiers.PROMO ? Tiers.PROMO : {};
    var promoTitle = doc.getElementById('promoPopTitle');
    var promoSub = doc.getElementById('promoPopSub');
    var liveHead = promoTitle && promoTitle.textContent ? promoTitle.textContent.trim() : '';
    var liveSub = promoSub && promoSub.textContent ? promoSub.textContent.trim() : '';
    var sheetOpts = { current: currentPlanId(doc), promo: promo };
    if (liveHead) {
      sheetOpts.headline = liveHead;
      sheetOpts.sub = liveSub;
    }
    var model = planSheetCards(list, sheetOpts);

    var wrap = doc.createElement('div');
    wrap.id = 'shukPlanSheet';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'shukPlanTitle');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483002;background:rgba(14,26,51,.55);display:flex;align-items:flex-end;justify-content:center;direction:rtl;font-family:Heebo,Arial,sans-serif';
    var style = doc.createElement('style');
    style.textContent = planSheetStyle();
    wrap.appendChild(style);
    var panel = doc.createElement('div');
    panel.className = 'panel';
    var head = doc.createElement('div');
    head.className = 'head';
    var title = doc.createElement('h2');
    title.id = 'shukPlanTitle';
    title.textContent = 'המסלולים';
    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = 'סגירה';
    function dismiss() { if (wrap.remove) wrap.remove(); }
    close.addEventListener('click', dismiss);
    head.appendChild(title);
    head.appendChild(close);
    panel.appendChild(head);
    if (model.offer) {
      var offer = doc.createElement('div');
      offer.className = 'offer';
      var strong = doc.createElement('strong');
      strong.textContent = model.offer.headline;
      offer.appendChild(strong);
      if (model.offer.sub) {
        var note = doc.createElement('span');
        note.textContent = model.offer.sub;
        offer.appendChild(note);
      }
      panel.appendChild(offer);
    }
    var track = doc.createElement('div');
    track.className = 'track';
    var cards = [];
    var start = 0;
    function fillLines(ul, items) {
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      for (var n = 0; n < items.length; n++) {
        var item = items[n];
        var li = doc.createElement('li');
        var mark = doc.createElement('span');
        mark.className = 'mk';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = '✓';
        var span = doc.createElement('span');
        if (item.bold) {
          var bold = doc.createElement('b');
          bold.textContent = item.bold;
          span.appendChild(bold);
        }
        if (item.text) span.appendChild(doc.createTextNode(item.text));
        li.appendChild(mark);
        li.appendChild(span);
        ul.appendChild(li);
      }
    }
    for (var i = 0; i < model.cards.length; i++) {
      var spec = model.cards[i];
      if (spec.recommended) start = i;
      else if (spec.current && start === 0 && !model.cards[0].recommended) start = i;
      var card = doc.createElement('article');
      card.className = 'card' + (spec.color ? ' ' + spec.color : '') + (spec.recommended ? ' is-rec' : '');
      if (spec.recommended) {
        var flag = doc.createElement('span');
        flag.className = 'flag';
        flag.textContent = 'מומלץ';
        card.appendChild(flag);
      }
      if (spec.current) {
        var ribbon = doc.createElement('span');
        ribbon.className = 'ribbon';
        ribbon.textContent = 'המסלול שלך';
        card.appendChild(ribbon);
      }
      var name = doc.createElement('h3');
      name.className = 'name';
      name.textContent = spec.name;
      var tagline = doc.createElement('p');
      tagline.className = 'tagline';
      tagline.textContent = spec.tagline;
      var inc = doc.createElement('h4');
      inc.className = 'inc';
      inc.textContent = spec.heading;
      var ul = doc.createElement('ul');
      ul.className = 'list';
      fillLines(ul, spec.preview);
      card.appendChild(name);
      card.appendChild(tagline);
      card.appendChild(inc);
      card.appendChild(ul);
      if (spec.expandable) {
        var more = doc.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = 'הצג הכול';
        (function (button, listEl, cardSpec) {
          button.addEventListener('click', function () {
            var open = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', open ? 'false' : 'true');
            button.textContent = open ? 'הצג הכול' : 'הצג פחות';
            fillLines(listEl, open ? cardSpec.preview : cardSpec.full);
          });
        })(more, ul, spec);
        card.appendChild(more);
      }
      track.appendChild(card);
      cards.push(card);
    }
    panel.appendChild(track);
    var dots = doc.createElement('div');
    dots.className = 'dots';
    var dotBtns = [];
    function paintDots(index) {
      for (var d = 0; d < dotBtns.length; d++) {
        dotBtns[d].setAttribute('aria-current', d === index ? 'true' : 'false');
      }
    }
    function cardIndex() {
      if (!track.getBoundingClientRect) return 0;
      var box = track.getBoundingClientRect();
      var mid = box.left + box.width / 2;
      var best = 0;
      var bestDist = Infinity;
      for (var c = 0; c < cards.length; c++) {
        if (!cards[c].getBoundingClientRect) continue;
        var rect = cards[c].getBoundingClientRect();
        var center = rect.left + rect.width / 2;
        var dist = Math.abs(center - mid);
        if (dist < bestDist) { bestDist = dist; best = c; }
      }
      return best;
    }
    for (var b = 0; b < cards.length; b++) {
      var dot = doc.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', model.cards[b].name || 'מסלול');
      var pip = doc.createElement('span');
      pip.className = 'dot';
      dot.appendChild(pip);
      (function (index) {
        dot.addEventListener('click', function () {
          var target = cards[index];
          if (target && target.scrollIntoView) {
            try { target.scrollIntoView({ inline: 'center', block: 'nearest' }); }
            catch (e) { target.scrollIntoView(); }
          }
          paintDots(index);
        });
      })(b);
      dots.appendChild(dot);
      dotBtns.push(dot);
    }
    if (dotBtns.length) panel.appendChild(dots);
    wrap.addEventListener('click', function (event) { if (event.target === wrap) dismiss(); });
    wrap.appendChild(panel);
    doc.body.appendChild(wrap);
    paintDots(start);
    if (cards[start] && cards[start].scrollIntoView) {
      try { cards[start].scrollIntoView({ inline: 'center', block: 'nearest' }); }
      catch (e2) {}
    }
    if (track.addEventListener) {
      track.addEventListener('scroll', function () { paintDots(cardIndex()); });
    }
    try { close.focus(); } catch (e3) {}
  }

  function showPayOverlay(win) {
    var doc = win && win.document;
    if (!doc || !doc.body) return;
    var existing = doc.getElementById('shukPayNote');
    if (existing) {
      existing.hidden = false;
      return;
    }
    var wrap = doc.createElement('div');
    wrap.id = 'shukPayNote';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(14,42,107,.94);color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:Heebo,Arial,sans-serif';
    var box = doc.createElement('div');
    var line = doc.createElement('p');
    line.textContent = PAY_NOTE;
    line.style.cssText = 'font-size:1.15rem;line-height:1.6;margin:0 0 16px';
    var close = doc.createElement('button');
    close.type = 'button';
    close.textContent = 'סגירה';
    close.style.cssText = 'background:#fff;color:#0e2a6b;border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:700';
    close.addEventListener('click', function () { if (wrap.remove) wrap.remove(); });
    box.appendChild(line);
    box.appendChild(close);
    wrap.appendChild(box);
    doc.body.appendChild(wrap);
  }

  function blockPurchaseDocument(win) {
    var href = '';
    try { href = win.location.href; } catch (e) { return; }
    if (!isPurchaseUrl(href)) return;
    var root = win.document && win.document.documentElement;
    if (root) root.style.visibility = 'hidden';
    function paint() {
      var doc = win.document;
      if (!doc || !doc.body) return;
      doc.title = 'שוק נדל״ן';
      doc.body.textContent = '';
      doc.body.style.cssText = 'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e2a6b;color:#fff;text-align:center;padding:24px;font-family:Heebo,Arial,sans-serif';
      var box = doc.createElement('div');
      var line = doc.createElement('p');
      line.textContent = PAY_NOTE;
      line.style.cssText = 'font-size:1.15rem;line-height:1.6;margin:0 0 16px';
      var back = doc.createElement('button');
      back.type = 'button';
      back.textContent = 'חזרה';
      back.style.cssText = 'background:#fff;color:#0e2a6b;border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:700';
      back.addEventListener('click', function () {
        if (win.history && win.history.length > 1) win.history.back();
        else win.location.replace(SITE_ORIGIN + '/');
      });
      box.appendChild(line);
      box.appendChild(back);
      doc.body.appendChild(box);
      if (root) root.style.visibility = '';
    }
    if (win.document.readyState === 'loading' && win.document.addEventListener) {
      win.document.addEventListener('DOMContentLoaded', paint);
    } else paint();
  }

  function schedulePurchaseShield(win) {
    if (!win.document) return;
    function boot() {
      try { scanPurchases(win.document); } catch (e) {}
      if (!win.MutationObserver || !win.document.documentElement) return;
      var pending = false;
      function relevant(records) {
        for (var i = 0; i < records.length; i++) {
          var rec = records[i];
          if (rec.type === 'childList' && rec.addedNodes && rec.addedNodes.length) return true;
          var id = rec.target && rec.target.id;
          if (id === 'purchaseModal' || id === 'pmPrice' || id === 'pmConfirm' || id === 'tgPlans') return true;
          if (rec.attributeName === 'href') return true;
        }
        return false;
      }
      var observer = new win.MutationObserver(function (records) {
        if (!relevant(records) || pending) return;
        pending = true;
        win.setTimeout(function () {
          pending = false;
          try { scanPurchases(win.document); } catch (e2) {}
        }, 80);
      });
      observer.observe(win.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'href', 'hidden'],
      });
    }
    if (win.document.readyState === 'loading' && win.document.addEventListener) {
      win.document.addEventListener('DOMContentLoaded', boot);
    } else boot();
  }

  /* מסך מיקום לפני בקשת ההרשאה. רק באפליקציה (הגשר לא נטען בדפדפן).
     פעם אחת, ואחרי תשובה או דילוג לא שוב. "אתרו את האזור שלי" פותח אותו
     מחדש. ההרשאה נבקשת רק מ"הפעלה", ומיקום משוער בלבד. */
  var LOC_STORAGE_KEY = 'shuk_loc_onboard';
  var LOC_GEO = { enableHighAccuracy: false, timeout: 8000, maximumAge: 86400000 };
  var LOC_COPY = {
    title: 'באיזה אזור אתם מחפשים?',
    body: 'נשתמש במיקום משוער רק כדי להציג את השוק המקומי ונכסים קרובים. המיקום לא נשמר בשרתים שלנו, ואפשר לשנות את האזור בכל רגע.',
    allow: 'הפעלה',
    skip: 'אולי אחר כך',
    more: 'איך אתם משתמשים במיקום שלי?',
    moreBody: 'המיקום המשוער נשאר במכשיר ומשמש רק כדי לבחור את האזור שמוצג ולהציג נכסים קרובים. הנקודה לא נשמרת בשרתים שלנו ולא נשלחת אלינו.',
    privacy: 'מדיניות הפרטיות',
    privacyHref: 'https://shuknadlan.co.il/privacy',
    seeking: 'מאתרים את האזור...',
    denied: 'לא התקבלה הרשאה למיקום. האזור נשאר כמו שהוא, ואפשר לנסות שוב מבורר האזור.',
    failed: 'לא הצלחנו לאתר את המיקום. האזור נשאר כמו שהוא.',
    outside: 'עוד לא הגענו לאזור שלך. בינתיים מוצג עפולה והעמק.',
    cont: 'המשך',
  };

  function shouldAutoShowLocation(opts) {
    opts = opts || {};
    if (!opts.site) return false;
    if (opts.seen) return false;
    if (opts.path === '/privacy') return false;
    return true;
  }

  /* אותה locate של האתר, רק שווקים חיים. מחוץ לשוק חי - null, והקורא
     נשאר על עפולה והעמק בלי עוגיית "בקרוב". */
  function pickLiveMarket(markets, lat, lng) {
    if (!markets || typeof markets.locate !== 'function') return null;
    var m;
    try { m = markets.locate(lat, lng, true); } catch (e) { return null; }
    if (!m || m.live !== true) return null;
    return m;
  }

  /* ניווט רק כשהדף עצמו הוא דף שוק אחר. דף נכס נשאר, והעוגייה תפתח את
     דף הבית על האזור בביקור הבא. */
  function marketPathToOpen(markets, pathname, chosen) {
    if (!chosen || chosen.live !== true || !chosen.path) return null;
    if (!markets || typeof markets.byPath !== 'function') return null;
    var here;
    try { here = markets.byPath(pathname); } catch (e) { return null; }
    if (!here || here.slug === chosen.slug) return null;
    return chosen.path;
  }

  function isLocateControl(node) {
    var el = node;
    while (el) {
      if (el.nodeType === 1 && el.classList && el.classList.contains('mkt-locate')) return true;
      el = el.parentNode;
    }
    return false;
  }

  function siteHost(win) {
    try {
      var host = String(win.location.hostname || '').toLowerCase();
      if (host.indexOf('www.') === 0) host = host.slice(4);
      return host === 'shuknadlan.co.il' || endsWith(host, '.shuknadlan.co.il');
    } catch (e) { return false; }
  }

  function docPath(win) {
    try {
      var path = String(win.location.pathname || '/').replace(/\.html$/i, '').replace(/\/+$/, '');
      return path || '/';
    } catch (e) { return '/'; }
  }

  function locationPromptSeen(win) {
    try { return !!win.localStorage.getItem(LOC_STORAGE_KEY); }
    catch (e) { return true; }
  }

  function markLocationPrompt(win) {
    try { win.localStorage.setItem(LOC_STORAGE_KEY, '1'); } catch (e) {}
  }

  function whenBody(win, fn) {
    var doc = win.document;
    if (!doc) return;
    if (doc.body) { fn(); return; }
    if (doc.addEventListener) doc.addEventListener('DOMContentLoaded', fn);
  }

  function ensureLocStyles(doc) {
    if (!doc || doc.getElementById('shukLocStyles')) return;
    var style = doc.createElement('style');
    style.id = 'shukLocStyles';
    style.textContent = [
      '#shukLocPrompt{color-scheme:only light;forced-color-adjust:none}',
      '#shukLocPrompt h1{color:#fff !important;-webkit-text-fill-color:#fff !important}',
      '#shukLocPrompt p,#shukLocPrompt button{color:#d5def5 !important;-webkit-text-fill-color:#d5def5 !important}',
      '#shukLocPrompt .shuk-loc-allow{background:#c9a227 !important;color:#0e2a6b !important;-webkit-text-fill-color:#0e2a6b !important}',
      '#shukLocPrompt a{color:#c9a227 !important;-webkit-text-fill-color:#c9a227 !important}',
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function showLocationPrompt(win, reopen) {
    var doc = win.document;
    if (!doc || !doc.body || doc.getElementById('shukLocPrompt')) return;
    if (!reopen && locationPromptSeen(win)) return;

    var wrap = doc.createElement('div');
    wrap.id = 'shukLocPrompt';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'shukLocTitle');
    wrap.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483001', 'background:#0e2a6b', 'color:#fff',
      'display:flex', 'flex-direction:column', 'direction:rtl', 'text-align:center',
      'padding:calc(28px + env(safe-area-inset-top)) 24px calc(18px + env(safe-area-inset-bottom))',
      'font-family:Heebo,Arial,sans-serif', 'box-sizing:border-box',
    ].join(';');

    var title = doc.createElement('h1');
    title.id = 'shukLocTitle';
    ensureLocStyles(doc);
    title.textContent = LOC_COPY.title;
    title.style.cssText = 'margin:8px 0 12px;font-size:1.65rem;font-weight:800;line-height:1.3;color:#fff;-webkit-text-fill-color:#fff';

    var body = doc.createElement('p');
    body.textContent = LOC_COPY.body;
    body.style.cssText = 'margin:0 auto;max-width:26rem;font-size:1.02rem;line-height:1.55;color:#d5def5';

    var pin = doc.createElement('div');
    pin.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;min-height:140px';
    var bubble = doc.createElement('div');
    bubble.style.cssText = 'width:148px;height:148px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center';
    var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('width', '78');
    svg.setAttribute('height', '78');
    svg.setAttribute('aria-hidden', 'true');
    var path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', '#c9a227');
    path.setAttribute('d', 'M32 6c-9.1 0-16.5 7.2-16.5 16.2 0 12.2 16.5 29.8 16.5 29.8s16.5-17.6 16.5-29.8C48.5 13.2 41.1 6 32 6zm0 22.2a6 6 0 1 1 0-12 6 6 0 0 1 0 12z');
    svg.appendChild(path);
    bubble.appendChild(svg);
    pin.appendChild(bubble);

    var actions = doc.createElement('div');
    actions.style.cssText = 'width:100%;max-width:22rem;margin:0 auto';

    var allow = doc.createElement('button');
    allow.type = 'button';
    allow.className = 'shuk-loc-allow';
    allow.textContent = LOC_COPY.allow;
    allow.style.cssText = 'display:block;width:100%;border:0;border-radius:999px;background:#c9a227;color:#0e2a6b;font:inherit;font-size:1.15rem;font-weight:800;padding:15px 18px;cursor:pointer';

    var skip = doc.createElement('button');
    skip.type = 'button';
    skip.textContent = LOC_COPY.skip;
    skip.style.cssText = 'display:block;width:100%;margin-top:12px;border:0;background:transparent;color:#fff;font:inherit;font-size:1.02rem;font-weight:700;padding:10px;cursor:pointer;text-decoration:underline';

    var more = doc.createElement('button');
    more.type = 'button';
    more.textContent = LOC_COPY.more;
    more.setAttribute('aria-expanded', 'false');
    more.style.cssText = 'display:block;width:100%;margin-top:8px;border:0;background:transparent;color:#d5def5;font:inherit;font-size:.95rem;font-weight:700;padding:8px;cursor:pointer';

    var panel = doc.createElement('div');
    panel.hidden = true;
    panel.style.cssText = 'margin-top:4px;font-size:.92rem;line-height:1.5;color:#d5def5';
    var moreText = doc.createElement('p');
    moreText.textContent = LOC_COPY.moreBody;
    moreText.style.cssText = 'margin:0 0 8px';
    var privacy = doc.createElement('a');
    privacy.href = LOC_COPY.privacyHref;
    privacy.textContent = LOC_COPY.privacy;
    privacy.style.cssText = 'color:#c9a227;font-weight:700';
    panel.appendChild(moreText);
    panel.appendChild(privacy);

    function closePrompt() {
      if (wrap.remove) wrap.remove();
      else if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    function finish(message) {
      markLocationPrompt(win);
      if (!message) { closePrompt(); return; }
      body.textContent = message;
      allow.disabled = false;
      allow.textContent = LOC_COPY.cont;
      allow.onclick = closePrompt;
      skip.hidden = true;
    }

    skip.addEventListener('click', function () {
      markLocationPrompt(win);
      closePrompt();
    });

    more.addEventListener('click', function () {
      var open = more.getAttribute('aria-expanded') === 'true';
      more.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
    });

    allow.addEventListener('click', function () {
      if (allow.textContent === LOC_COPY.cont) { closePrompt(); return; }
      markLocationPrompt(win);
      allow.disabled = true;
      skip.disabled = true;
      body.textContent = LOC_COPY.seeking;
      var geo = win.navigator && win.navigator.geolocation;
      if (!geo || !geo.getCurrentPosition) { finish(LOC_COPY.failed); return; }
      try {
        geo.getCurrentPosition(function (pos) {
          var lat = pos && pos.coords ? pos.coords.latitude : NaN;
          var lng = pos && pos.coords ? pos.coords.longitude : NaN;
          function applyFix(left) {
            var M = win.ShukMarkets;
            var C = win.CityContext;
            if ((!M || !C) && left > 0) {
              win.setTimeout(function () { applyFix(left - 1); }, 100);
              return;
            }
            if (!M || !C || typeof C.choose !== 'function') { finish(LOC_COPY.failed); return; }
            var market = pickLiveMarket(M, lat, lng);
            if (!market) { finish(LOC_COPY.outside); return; }
            try { C.choose(market, 'gps'); } catch (e) { finish(LOC_COPY.failed); return; }
            var strip = doc.getElementById('soonStrip');
            if (strip) strip.hidden = true;
            var next = marketPathToOpen(M, docPath(win), market);
            if (next) {
              try { win.location.href = next; } catch (e2) { closePrompt(); }
              return;
            }
            closePrompt();
          }
          applyFix(20);
        }, function (err) {
          finish(err && err.code === 1 ? LOC_COPY.denied : LOC_COPY.failed);
        }, LOC_GEO);
      } catch (e) { finish(LOC_COPY.failed); }
    });

    actions.appendChild(allow);
    actions.appendChild(skip);
    actions.appendChild(more);
    actions.appendChild(panel);
    wrap.appendChild(title);
    wrap.appendChild(body);
    wrap.appendChild(pin);
    wrap.appendChild(actions);
    doc.body.appendChild(wrap);
    try { allow.focus(); } catch (e) {}
  }

  function scheduleLocationPrompt(win) {
    if (!siteHost(win) || !win.document) return;
    var app = win.ShukNadlanApp || {};
    app.openLocationPrompt = function () { showLocationPrompt(win, true); };
    win.ShukNadlanApp = app;
    if (!win.__shukLocHook && win.document.addEventListener) {
      win.__shukLocHook = true;
      win.document.addEventListener('click', function (event) {
        if (!isLocateControl(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        showLocationPrompt(win, true);
      }, true);
    }
    if (!shouldAutoShowLocation({ site: true, seen: locationPromptSeen(win), path: docPath(win) })) return;
    whenBody(win, function () { showLocationPrompt(win, false); });
  }

  return {
    SITE_ORIGIN: SITE_ORIGIN,
    AUTH_CALLBACK: AUTH_CALLBACK,
    OAUTH_CANCELLED: OAUTH_CANCELLED,
    OAUTH_FAILED: OAUTH_FAILED,
    APPLE_CANCELLED: APPLE_CANCELLED,
    APPLE_FAILED: APPLE_FAILED,
    PAY_NOTE: PAY_NOTE,
    rewriteAuthorizeUrl: rewriteAuthorizeUrl,
    isOAuthNavigation: isOAuthNavigation,
    isAuthCallback: isAuthCallback,
    isExternalUrl: isExternalUrl,
    isPurchaseUrl: isPurchaseUrl,
    LOC_STORAGE_KEY: LOC_STORAGE_KEY,
    LOC_GEO: LOC_GEO,
    LOC_COPY: LOC_COPY,
    shouldAutoShowLocation: shouldAutoShowLocation,
    pickLiveMarket: pickLiveMarket,
    marketPathToOpen: marketPathToOpen,
    isLocateControl: isLocateControl,
    planFeatureLines: planFeatureLines,
    planSheetCards: planSheetCards,
    safeSiteRetry: safeSiteRetry,
    clickedHref: clickedHref,
    authReturnUrl: authReturnUrl,
    install: install,
  };
});
