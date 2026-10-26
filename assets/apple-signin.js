/* התחברות עם Apple דרך Supabase Auth.
   הכפתור לא נוסף כל עוד הדגל false, כדי שדף הכניסה לא יישבר לפני שיש
   Services ID ומפתח בחשבון המפתחים. אחרי ההגדרה (docs/native-apps.md)
   משנים את השורה הבאה ל-true. */
window.SHUK_APPLE_SIGNIN = false;

(function () {
  if (window.SHUK_APPLE_SIGNIN !== true) return;

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var CANCELLED = 'ההתחברות עם Apple בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';
  var FAILED = 'ההתחברות עם Apple נכשלה: אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה.';

  function client() {
    if (!window.supabase || !window.supabase.createClient) return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  function redirectTo() {
    if (location.pathname.indexOf('developer-signup') !== -1) return location.origin + '/developer-crm';
    return location.origin + location.pathname;
  }

  function remember() {
    if (!window.AuthReturn || !window.AuthReturn.remember) return;
    if (location.pathname.indexOf('developer-signup') !== -1) window.AuthReturn.remember('/developer-crm');
    else window.AuthReturn.remember();
  }

  function showError(text) {
    var ids = ['loginError', 'lgMsg', 'csmLoginMsg', 'feedback'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (!el) continue;
      el.textContent = text;
      if (ids[i] === 'feedback') el.style.color = 'var(--red)';
    }
  }

  function resetButton(btn, idle) {
    btn.disabled = false;
    var label = btn.querySelector('.al-label');
    if (label) label.textContent = idle;
  }

  function paintReturn() {
    var provider = '';
    try { provider = sessionStorage.getItem('shuk_oauth_provider') || ''; } catch (e) {}
    if (provider !== 'apple') return;
    try { sessionStorage.removeItem('shuk_oauth_provider'); } catch (e2) {}
    var code = '';
    var desc = '';
    try {
      var q = new URLSearchParams(location.search);
      code = q.get('error') || q.get('error_code') || '';
      desc = q.get('error_description') || '';
    } catch (e3) { return; }
    if (!code && !desc) return;
    showError(/access_denied|cancel/i.test(code) ? CANCELLED : FAILED);
    var buttons = document.querySelectorAll('.auth-apple');
    for (var i = 0; i < buttons.length; i++) {
      var label = buttons[i].querySelector('.al-label');
      var idle = (label && label.getAttribute('data-idle')) || 'התחברות עם Apple';
      resetButton(buttons[i], idle);
    }
  }

  function mountOne(google) {
    if (!google || google.getAttribute('data-apple-mounted') === '1') return;
    google.setAttribute('data-apple-mounted', '1');
    var idle = 'התחברות עם Apple';
    var gl = google.querySelector('.gl-label');
    if (gl && String(gl.textContent || '').indexOf('הרשמה') === 0) idle = 'הרשמה עם Apple';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-block auth-apple';
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:8px 0 0;background:#000;color:#fff;border:1.5px solid #000;border-radius:12px;padding:14px 20px;font:inherit;font-weight:700;cursor:pointer';
    var span = document.createElement('span');
    span.className = 'al-label';
    span.setAttribute('data-idle', idle);
    span.textContent = idle;
    btn.appendChild(span);
    btn.addEventListener('click', function () {
      var sb = client();
      if (!sb) {
        showError(FAILED);
        return;
      }
      btn.disabled = true;
      span.textContent = 'מעבירים ל-Apple…';
      try { sessionStorage.setItem('shuk_oauth_provider', 'apple'); } catch (e) {}
      remember();
      sb.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: redirectTo() },
      }).then(function (result) {
        if (result && result.error) {
          resetButton(btn, idle);
          showError(FAILED);
        }
      }).catch(function () {
        resetButton(btn, idle);
        showError(FAILED);
      });
    });
    if (google.insertAdjacentElement) google.insertAdjacentElement('afterend', btn);
  }

  function mount() {
    var ids = ['googleLoginBtn', 'googleBtn', 'csmGoogle'];
    for (var i = 0; i < ids.length; i++) mountOne(document.getElementById(ids[i]));
    paintReturn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
