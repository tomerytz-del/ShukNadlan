/* הודעות שגיאה בעברית, ודרך לבקש עזרה — docs/friendly-errors.md
 *
 * למה זה קיים: Supabase, הדפדפן ופונקציות ה-Edge מחזירים שגיאות באנגלית
 * ("Email not confirmed", "Failed to fetch", "duplicate key value violates
 * unique constraint"), והקוד הציג אותן כמו שהן — כ-200 מקומות של
 * `'שגיאה: ' + error.message`. סוכנת שהוזמנה קיבלה "Email not confirmed",
 * לא הבינה שמחכה לה מייל, ונתקעה.
 *
 * הכלל:
 *   1. הודעה שכבר בעברית (מפה של קודים, throw new Error('...') שלנו) עוברת כמו שהיא.
 *   2. שגיאה מוכרת (רשת, חיבור שפג, הרשאה, כפילות, מכסת שליחה…) מתורגמת
 *      להסבר שאומר גם מה לעשות.
 *   3. כל השאר — הודעה כללית בעברית. הטקסט האנגלי המקורי נכתב לקונסול ולא
 *      למסך, וקוד קצר (23505, PGRST116) מצורף כדי שיהיה מה למסור לתמיכה.
 *
 * ‏helpUrl/helpHtml: קישור וואטסאפ למספר של שוק נדל״ן עם הודעה מוכנה. הקישור
 * נושא data-site-contact (CLAUDE.md, "וכל קישור קשר בדף נמדד חייב להיות
 * מסווג"), וההודעה המוכנה מתארת את הדף ואת השגיאה בלבד — בלי פרטים אישיים.
 */
(function(){
  'use strict';

  var SUPPORT_PHONE = '054-6929991';
  var SUPPORT_WA = '972546929991';
  var HEBREW = /[֐-׿]/;

  // [בדיקה, הודעה]. בדיקה היא רשימת קודים או regex על הטקסט המקורי.
  var RULES = [
    // רשת — Chrome / Safari / Firefox / supabase-js
    [/failed to fetch|load failed|networkerror|network request failed|fetch failed|err_internet|FunctionsFetchError|failed to send a request/i,
      'אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.'],
    [/timeout|timed out|aborterror|the operation was aborted|57014/i,
      'השרת לא ענה בזמן. כדאי לנסות שוב בעוד רגע.'],

    // התחברות (Supabase Auth)
    [['invalid_credentials', /^invalid login credentials$/i], 'אימייל או סיסמה שגויים.'],
    [['email_not_confirmed', /^email not confirmed$/i],
      'החשבון נוצר, אבל כתובת המייל עוד לא אושרה. יש ללחוץ על הקישור במייל האישור (כדאי לבדוק גם בספאם) ואז להיכנס שוב.'],
    [['user_already_exists', 'email_exists', /already registered|already been registered/i],
      'כבר קיים חשבון עם הכתובת הזו. אפשר להיכנס עם הסיסמה, או עם Google.'],
    [['weak_password', /password should be|password is too weak/i],
      'הסיסמה חלשה מדי. צריך לפחות 8 תווים.'],
    [['same_password'], 'הסיסמה החדשה זהה לישנה.'],
    [['otp_expired', /token has expired|link is invalid or has expired|otp_expired/i],
      'הקישור פג או כבר נוצל. אפשר לבקש קישור חדש.'],
    [['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit', 'rate_limited', /rate.?limit|too many requests|after \d+ seconds|^429$/i],
      'יותר מדי ניסיונות בזמן קצר. כדאי לחכות דקה ולנסות שוב.'],
    [['session_not_found', 'refresh_token_not_found', 'bad_jwt', 'PGRST301', 'PGRST303', /jwt expired|invalid jwt|refresh token|auth session missing/i],
      'החיבור פג. יש לרענן את הדף ולהתחבר מחדש.'],
    [['user_banned'], 'החשבון הזה חסום. לבירור - כתבו לנו.'],
    [['signup_disabled', 'email_provider_disabled'], 'ההרשמה עם אימייל סגורה כרגע. אפשר להיכנס עם Google.'],
    [['provider_disabled', /unsupported provider|provider is not enabled/i], 'ההתחברות הזו אינה זמינה כרגע. אפשר להיכנס עם אימייל וסיסמה.'],

    // מסד הנתונים (PostgREST / Postgres)
    [['42501', /permission denied|row-level security|violates row-level/i],
      'אין הרשאה לפעולה הזו. אם זו טעות - כתבו לנו.'],
    [['23505', /duplicate key|already exists/i], 'הפריט הזה כבר קיים.'],
    [['23503', /foreign key/i], 'אי אפשר להשלים את הפעולה, כי היא קשורה לפריט אחר שנמחק או שעדיין משתמשים בו.'],
    [['23502', /null value in column/i], 'חסר שדה חובה.'],
    [['23514', '22001', '22003', '22007', '22008', '22P02', /check constraint|invalid input syntax|value too long|out of range/i],
      'אחד הערכים אינו תקין. כדאי לבדוק את מה שהוזן ולנסות שוב.'],
    [['PGRST116', /0 rows|no rows/i], 'הפריט לא נמצא - ייתכן שנמחק בינתיים. כדאי לרענן את הדף.'],
    [['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', /does not exist|schema cache|could not find/i],
      'היכולת הזו עוד לא מוכנה במערכת. כתבו לנו ונטפל.'],

    // קודים שפונקציות ה-Edge שלנו מחזירות ב-{ error: '...' } (הנפוצים, לפי
    // ספירה ב-supabase/functions). קוד שאינו כאן מקבל את ההודעה הכללית + הקוד.
    [['unauthorized', 'missing_authorization', 'missing_token', 'not_authenticated', /^401$/],
      'החיבור פג. יש לרענן את הדף ולהתחבר מחדש.'],
    [['forbidden', 'not_platform_admin', 'managers_only', 'not_your_project', 'not_allowed', /^403$/],
      'אין הרשאה לפעולה הזו. אם זו טעות - כתבו לנו.'],
    [['not_found', 'property_not_found', 'member_not_found', /^404$/],
      'הפריט לא נמצא - ייתכן שנמחק בינתיים. כדאי לרענן את הדף.'],
    [['no_matching_agent_profile'], 'לא מצאנו כרטיס סוכן/ת שמחובר לחשבון הזה. כתבו לנו ונחבר אותו.'],
    [['agent_inactive'], 'הכרטיס שלך במשרד אינו פעיל כרגע. אפשר לפנות למנהל/ת המשרד.'],
    [['missing_fields', 'missing_name', 'missing_contact', 'missing_property_id', 'property_required'],
      'חסרים פרטים בטופס. כדאי להשלים את השדות ולנסות שוב.'],
    [['invalid_email'], 'כתובת האימייל לא נראית תקינה.'],
    [['invalid_phone'], 'מספר הטלפון לא נראה תקין.'],
    [['tier_required', 'upgrade_required'], 'היכולת הזו זמינה במסלול גבוה יותר. אפשר לשדרג בעמוד המסלולים.'],
    [['insufficient_balance', 'insufficient_credit', 'insufficient_funds'], 'אין מספיק יתרה בארנק. אפשר לטעון אותו ולנסות שוב.'],
    [['already_member'], 'הסוכן/ת כבר בצוות המשרד.'],
    [['db_error', 'server_error', 'unhandled', 'queue_failed', /^5\d\d$/],
      'הפעולה נכשלה בשרת. כדאי לנסות שוב בעוד רגע.'],
    [['not_configured', 'copy_not_configured', 'meta_not_configured', 'morning_not_configured'],
      'היכולת הזו עוד לא הוגדרה במערכת. כתבו לנו ונטפל.'],

    // קבצים ופונקציות
    [['413', /payload too large|entity too large|file size|exceeded the maximum/i], 'הקובץ גדול מדי.'],
    [['FunctionsHttpError', /non-2xx status code/i], 'הפעולה נכשלה בשרת. כדאי לנסות שוב בעוד רגע.'],
    [['FunctionsRelayError'], 'השרת לא זמין כרגע. כדאי לנסות שוב בעוד רגע.'],
  ];

  var GENERIC = 'משהו השתבש. כדאי לנסות שוב, ואם זה חוזר - כתבו לנו.';

  function parts(err){
    if (err == null) return { msg: '', code: '' };
    if (typeof err === 'string') return { msg: err, code: '' };
    var msg = String(err.message || err.error_description || err.msg || err.error || '');
    var code = String(err.code || err.error_code || err.name || err.status || '');
    return { msg: msg, code: code };
  }

  function matches(test, p){
    if (test instanceof RegExp) return test.test(p.msg) || test.test(p.code);
    for (var i = 0; i < test.length; i++){
      var t = test[i];
      if (t instanceof RegExp ? (t.test(p.msg) || t.test(p.code)) : (t === p.code || t === p.msg)) return true;
    }
    return false;
  }

  /* הטקסט לגולש/ת. fallback — מה להציג כשאין שום מידע (שגיאה ריקה). */
  function text(err, fallback){
    var p = parts(err);
    if (!p.msg && !p.code) return fallback || GENERIC;
    // שלנו, וכבר בעברית — עובר כמו שהוא
    if (HEBREW.test(p.msg)) return p.msg;
    for (var i = 0; i < RULES.length; i++){
      if (matches(RULES[i][0], p)) return RULES[i][1];
    }
    try { console.warn('[friendly-error] untranslated:', p.code, p.msg); } catch(_){}
    // קוד קצר בלבד (23505, PGRST116, rate_limited) — מה שאפשר למסור לתמיכה.
    // לעולם לא הטקסט האנגלי עצמו.
    var shortCode = /^[A-Za-z0-9_]{2,40}$/.test(p.code) ? p.code
                  : /^[a-z0-9_]{2,40}$/.test(p.msg) ? p.msg : '';
    return (fallback || GENERIC) + (shortCode ? ' (קוד: ' + shortCode + ')' : '');
  }

  function helpUrl(context){
    var page = (location.pathname || '/').replace(/\.html$/, '') || '/';
    var lines = ['שלום, אני צריך/ה עזרה באתר שוק נדל״ן.', 'דף: ' + page];
    if (context) lines.push('מה קרה: ' + String(context).slice(0, 300));
    return 'https://wa.me/' + SUPPORT_WA + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function escHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* קישור מוכן להצגה. data-site-contact — זה המספר שלנו, לא של מתווך/ת. */
  function helpHtml(context, label){
    return '<a class="fe-help" href="' + escHtml(helpUrl(context)) + '" target="_blank" rel="noopener" data-site-contact>' +
           escHtml(label || ('לעזרה בוואטסאפ: ' + SUPPORT_PHONE)) + '</a>';
  }

  /* מוסיף מתחת לאלמנט שגיאה קישור עזרה (פעם אחת). context — טקסט השגיאה. */
  function attachHelp(el, context){
    if (!el) return;
    var host = el.nextElementSibling && el.nextElementSibling.classList &&
               el.nextElementSibling.classList.contains('fe-help-row') ? el.nextElementSibling : null;
    if (!host){
      host = document.createElement('div');
      host.className = 'fe-help-row';
      host.style.cssText = 'text-align:center;font-size:.8rem;margin-top:6px';
      el.insertAdjacentElement('afterend', host);
    }
    host.innerHTML = helpHtml(context);
    // צבע הקישורים של האתר (--teal), עם גיבוי לדף שאין בו את המשתנה
    host.firstChild.style.color = 'var(--teal, #1f6f6b)';
    host.style.display = '';
  }

  function hideHelp(el){
    var n = el && el.nextElementSibling;
    if (n && n.classList && n.classList.contains('fe-help-row')) n.style.display = 'none';
  }

  window.FriendlyError = {
    text: text, helpUrl: helpUrl, helpHtml: helpHtml,
    attachHelp: attachHelp, hideHelp: hideHelp,
    SUPPORT_PHONE: SUPPORT_PHONE,
  };
})();
