/* ============================================================================
   ‏חזרה מ-Google שנחתה בדף הבית — רשת ביטחון לכניסת המתווכים
   ----------------------------------------------------------------------------
   התלונה: לוחצים "כניסת מתווכים", מזדהים מול Google, ונוחתים בדף הבית.
   לחיצה שנייה על אותו כפתור כבר נכנסת למערכת בלי לשאול כלום.

   ‏**למה זה קורה.** ‏signInWithOAuth שולח ל-Supabase את הכתובת שאליה לחזור
   (‏redirectTo). ‏Supabase משווה אותה לרשימת ה-Redirect URLs שבהגדרות
   הפרויקט, וכתובת שאינה ברשימה אינה נדחית בשגיאה — היא **מוחלפת בשקט
   ב-Site URL**, כלומר בדף הבית. זה מה שנרשם ביומני ה-auth של הפרויקט:
   הבקשה יצאה עם ‎redirect_to=…/crm‎, ו-GoTrue רשם לעצמו
   ‎referer: https://shuknadlan.co.il‎.

   ‏**ולמה זה נראה כאילו ההתחברות נכשלה, כשהיא הצליחה.** דף הבית טוען
   ‏supabase-js ויוצר לקוח (‏assets/home.js). ברירת המחדל של הלקוח היא
   ‏detectSessionInUrl — הוא קורא את התשובה מהכתובת, שומר את ה-session
   ומנקה את הכתובת. בלי מסך, בלי הודעה, בלי שום סימן. הכניסה הושלמה
   במלואה, רק במקום הלא נכון — ולכן הלחיצה הבאה "פשוט עובדת".

   ‏**התיקון האמיתי הוא ברשימה** (‏Supabase → Authentication → URL
   Configuration), והוא מתועד ב-docs/google-login.md. הקובץ הזה הוא מה
   שנשאר נכון גם כשהרשימה לא מעודכנת — ובמקרה אחד היא לעולם לא תהיה:
   לכל deploy preview של Netlify יש כתובת חדשה משלו, ואף אחד לא מוסיף
   אותה מראש. שם הנחיתה בדף הבית היא ודאות ולא תקלה נדירה.

   מה שהוא עושה הוא להעביר את התשובה הלאה, לפני שמישהו נוגע בה:

       remember()        — נקרא לפני signInWithOAuth, וזוכר מאיפה יצאנו
       catchLanding()    — בדף הנחיתה: יש תשובה בכתובת? מעבירים אותה ליעד

   ‏**הסדר הוא כל העניין.** הקובץ נטען כ-‎<script src>‎ רגיל לפני התג של
   ‏supabase-js, והעברה מתבצעת ב-location.replace סינכרוני — כלומר לפני
   שנוצר לקוח שיכול לצרוך את הקוד החד-פעמי. לקוח שכבר צרך אותו משאיר
   ביד קוד מבוזבז, והעברה שלו ל-CRM הייתה מחליפה נחיתה שקטה בשגיאה
   רועשת. ‏replace ולא assign: הנחיתה השגויה לא צריכה להיות תחנה בהיסטוריה.

       <script src="assets/auth-return.js" data-catch></script>   // דף נחיתה
       AuthReturn.remember()                                      // דף כניסה

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ‏sessionStorage ולא משתנה: המסע עובר דרך accounts.google.com ודרך
     ‏supabase.co, כלומר הדף נטען מחדש מאפס. הוא שורד את הסיבוב כי הוא
     נשמר ללשונית, והנחיתה היא באותה לשונית. */
  var STORE_KEY = 'shuknadlan.auth_return';

  /* היעד כשאין מה לזכור. הוא נכון גם כשהוא ניחוש: הנחיתה שלא נשמרה היא
     נחיתה ממקור אחר (‏deploy preview), וכניסת המתווכים היא כמעט כל מה
     שמשתמש כאן ב-Google. */
  var DEFAULT_PATH = '/crm';

  /* ‏access_token הוא התשובה ב-flow מסוג implicit ו-code הוא התשובה
     ב-PKCE; ‏error מכסה את שניהם בכישלון ובביטול. שלושתם יכולים להגיע
     ב-hash או ב-query, ולכן שתי הרשימות נבדקות בשני המקומות. */
  var KEYS = ['access_token', 'code', 'error', 'error_code', 'error_description'];

  function parse(str){
    try { return new global.URLSearchParams(str); }
    catch (e) { return null; }   // דפדפן ישן — הרשת הזו פשוט לא נפרסת
  }

  function hasAuthResponse(){
    var hash  = parse(global.location.hash.replace(/^#/, ''));
    var query = parse(global.location.search);
    for (var i = 0; i < KEYS.length; i++){
      if (hash && hash.has(KEYS[i])) return true;
      if (query && query.has(KEYS[i])) return true;
    }
    return false;
  }

  /* המפתחות ש-handleGotoParam ב-crm.js קורא מהכתובת. רק הם נשמרים:
     query שלם היה סוחב איתו גם code ו-access_token של סבב קודם, והיה
     נכנס ל-location.replace. status נשמר גם הוא — קישור נכס לפי סטטוס
     (פעיל / נמכר / הושכר) משתמש בו, גם אם המסך עוד לא קורא אותו. */
  var GOTO_KEYS = [
    'goto', 'client', 'property', 'lead', 'focus', 'agenda', 'agreement',
    'review', 'filter', 'status', 'import', 'tab',
    'plan_city', 'plan_street', 'plan_num', 'plan_gush', 'plan_helka',
    // מדידת הלחיצה (deeplink-timing): בלי wc ו-wt חזרה מ-Google נשארת
    // login_wall גם כשהיעד נפתח, כי הסקריפט רץ רק כשהם בכתובת
    'wc', 'wt'
  ];

  /* מפתח נפרד מהנתיב: הנתיב נכנס ל-location.replace כמות שהוא, ו-query
     שמודבק עליו היה יוצר ?goto=…?code=… כש-catchLanding מוסיף את תשובת
     Google. הערכים נשמרים כאן ומוחזרים לכתובת רק אחרי שחוזרים ליעד. */
  var QUERY_KEY = 'shuknadlan.auth_return_query';

  function allowlistedQuery(search){
    var params = parse(String(search || '').replace(/^\?/, ''));
    if (!params) return '';
    var out = new global.URLSearchParams();
    for (var i = 0; i < GOTO_KEYS.length; i++){
      var key = GOTO_KEYS[i];
      if (!params.has(key)) continue;
      var value = params.get(key) || '';
      if (!value) continue;
      if (value.length > 200) value = value.slice(0, 200);
      // ערך אינו כתובת: // ו-javascript: לא אמורים להופיע בפרמטר של מסך
      if (/[\u0000-\u001f\u007f\\]/.test(value)) continue;
      if (/^\s*javascript:/i.test(value)) continue;
      if (value.indexOf('//') === 0) continue;
      out.append(key, value);
    }
    return out.toString();
  }

  function remember(path){
    var value = String(path || global.location.pathname).split('?')[0].split('#')[0];
    try {
      global.sessionStorage.setItem(STORE_KEY, value);
      // כניסה בלי יעד מוחקת יעד ישן, כדי שסבב Google הבא לא יקפוץ אליו
      var query = allowlistedQuery(global.location.search);
      if (query) global.sessionStorage.setItem(QUERY_KEY, query);
      else global.sessionStorage.removeItem(QUERY_KEY);
    }
    catch (e) { /* גלישה פרטית חוסמת אחסון; נשארים עם ברירת המחדל */ }
  }

  function storedQuery(){
    var value = '';
    try { value = global.sessionStorage.getItem(QUERY_KEY) || ''; }
    catch (e) { value = ''; }
    return allowlistedQuery(value);
  }

  /* current גובר: תשובת Google (code / error) שנמצאת כבר בכתובת לא נדרסת
     ביעד שנשמר, ולהפך — יעד לא נמחק בגלל שהתשובה הגיעה. */
  function mergeSearch(stored, current){
    var out = new global.URLSearchParams(stored || '');
    var cur = parse(current || '') || new global.URLSearchParams();
    cur.forEach(function(v, k){ out.set(k, v); });
    return out.toString();
  }

  /* מחזיר את יעד הקישור לכתובת של הדף שכבר נטען (חזרה ישר ל-CRM, בלי
     סיבוב דרך דף הבית). לא נוגע ב-hash: שם יושבת תשובת implicit. */
  function restoreQuery(){
    var extra = storedQuery();
    if (!extra) return false;
    if (!samePage(global.location.pathname, storedPath())) return false;
    var cur = parse(global.location.search) || new global.URLSearchParams();
    var add = new global.URLSearchParams(extra);
    var changed = false;
    add.forEach(function(v, k){
      if (!cur.has(k)){ cur.set(k, v); changed = true; }
    });
    if (!global.history || !global.history.replaceState) return false;
    try {
      var search = cur.toString();
      global.history.replaceState(global.history.state, '',
        global.location.pathname + (search ? '?' + search : '') + global.location.hash);
      global.sessionStorage.removeItem(QUERY_KEY);
    } catch (e) { return false; }
    return changed;
  }

  /* היעד חייב להיות נתיב באתר הזה ולא כתובת מלאה: מה שנקרא מהאחסון חוזר
     לתוך location.replace, ו-'//evil.example' או 'javascript:' היו יוצאים
     מכאן החוצה. נתיב שאינו מתחיל בלוכסן יחיד נפסל. */
  function storedPath(){
    var value = '';
    try { value = global.sessionStorage.getItem(STORE_KEY) || ''; }
    catch (e) { value = ''; }
    value = String(value).split('?')[0].split('#')[0];
    return /^\/[^/\\]/.test(value) ? value : DEFAULT_PATH;
  }

  /* ‏Netlify מגיש כל דף בשתי צורות — ‎/crm‎ ו-‎/crm.html‎ — ולצורך ההשוואה
     למטה אלה אותו דף. בלי זה, נחיתה שכן הגיעה ליעד הייתה מועברת אליו שוב. */
  function samePage(a, b){
    return a.replace(/\.html$/, '') === b.replace(/\.html$/, '');
  }

  /* מחזירה האם הועברנו — כדי שדף שקורא לה ידנית יוכל לדעת שאין טעם
     להמשיך לצייר. */
  function catchLanding(){
    if (!hasAuthResponse()) return false;
    var target = storedPath();
    // היעד הוא הדף הזה עצמו: התשובה הגיעה לאן שהתכוונה, ואין מה להעביר —
    // וניסיון להעביר בכל זאת היה לולאה. היעד שנשמר (goto וחבריו) כן חוזר
    // לכתובת, כי redirectTo של Google הוא הנתיב בלי ה-query.
    if (samePage(global.location.pathname, target)){
      restoreQuery();
      return false;
    }
    var search = mergeSearch(storedQuery(), global.location.search);
    try { global.location.replace(target + (search ? '?' + search : '') + global.location.hash); }
    catch (e) { return false; }
    return true;
  }

  global.AuthReturn = {
    remember: remember,
    hasAuthResponse: hasAuthResponse,
    catchLanding: catchLanding,
    restoreQuery: restoreQuery,
  };

  var tag = document.currentScript;
  if (tag && tag.hasAttribute('data-catch')){
    if (!catchLanding()) restoreQuery();
  } else {
    restoreQuery();
  }
})(window);
