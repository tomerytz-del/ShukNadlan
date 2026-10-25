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

  function isAuthCallback(raw) {
    return String(raw || '').indexOf(AUTH_CALLBACK) === 0;
  }

  function failOAuth(win, message) {
    if (!win || !win.document) return;
    var text = message || OAUTH_FAILED;
    var signup = String((win.location && win.location.pathname) || '').indexOf('developer-signup') !== -1;
    var label = signup ? 'הרשמה עם Google' : 'התחברות עם Google';
    var buttons = win.document.querySelectorAll('#googleLoginBtn, #googleBtn, #csmGoogle, .auth-google');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = false;
      var gl = buttons[i].querySelector('.gl-label');
      if (gl && String(gl.textContent || '').indexOf('מעבירים ל-Google') === 0) gl.textContent = label;
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
      var msg = /access_denied|cancel/i.test(code) ? OAUTH_CANCELLED
        : 'ההתחברות עם Google נכשלה: ' + (desc || 'אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.');
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
    };
    win.ShukNative = native;
    stripOauthBuster(win);
    paintOauthError(win);

    patchNavigation(win);
    patchShare(win);
    patchWindowOpen(win);
    patchClicks(win);
    patchSavedSearch(win);
    whenCapacitor(win, function () { wireNative(win); });
  }

  function patchNavigation(win) {
    var loc = win.location;
    if (!loc) return;
    function intercept(url, orig) {
      var rewritten = rewriteAuthorizeUrl(url);
      if (!rewritten) return orig(url);
      rememberReturn(win);
      // הניווט עצמו נתפס בצד הנייטיב: שם נוסף PKCE ונשמר המאמת.
      // פתיחה מכאן הייתה מדלגת על המאמת, והחזרה לא הייתה יכולה להחליף code.
      return orig(rewritten);
    }
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

  function openExternal(win, url) {
    var shell = pluginsOf(win).ShukShell;
    if (shell && shell.openExternal) {
      Promise.resolve(shell.openExternal({ url: url })).catch(function () {});
      return;
    }
    var browser = pluginsOf(win).Browser;
    if (browser && browser.open) {
      Promise.resolve(browser.open({ url: url })).catch(function () {});
      return;
    }
    try { win.open(url, '_blank'); } catch (e) {}
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
      var rewritten = rewriteAuthorizeUrl(url);
      if (rewritten) {
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
      var anchor = node && node.closest ? node.closest('a[href]') : null;
      if (!anchor) return;
      var href = anchor.href;
      if (!isExternalUrl(href)) return;
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
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

  return {
    SITE_ORIGIN: SITE_ORIGIN,
    AUTH_CALLBACK: AUTH_CALLBACK,
    OAUTH_CANCELLED: OAUTH_CANCELLED,
    OAUTH_FAILED: OAUTH_FAILED,
    rewriteAuthorizeUrl: rewriteAuthorizeUrl,
    isOAuthNavigation: isOAuthNavigation,
    isAuthCallback: isAuthCallback,
    isExternalUrl: isExternalUrl,
    authReturnUrl: authReturnUrl,
    install: install,
  };
});
