/* ============================================================================
   שאלה לפני יציאה — "אחורה" שלא מוציא מהאתר בטעות
   ----------------------------------------------------------------------------
   בטלפון "אחורה" הוא מחווה ולא כפתור: הוא נלחץ תוך כדי גלילה, מהקצה של המסך,
   ולעיתים קרובות במקום "סגור". מדף הבית ומה-CRM המחיר של לחיצה מיותרת הוא
   יציאה מהאתר — ובטופס פתוח גם אובדן של כל מה שהוקלד בו. הקובץ הזה מכניס
   שאלה אחת באמצע.

   איך זה עובד: בטעינת הדף נדחף לתוך ההיסטוריה "זקיף" — רשומה נוספת עם אותה
   כתובת בדיוק, שנושאת סימון משלה ב-state. הלחיצה על "אחורה" מגיעה קודם כל
   אל הזקיף, ואז אפשר לשאול. אישור מריץ history.back() אמיתי וממשיך לאן
   שהמשתמש/ת ביקש/ה; ביטול דוחף זקיף חדש ומשאיר את הדף במקומו.

   מתי בכלל שואלים:
     • כשה"אחורה" באמת יוצא מהאתר — כלומר הדף נפתח מבחוץ (גוגל, קישור
       בוואטסאפ, סימנייה, כתובת שהוקלדה) ואין מאחוריו דף פנימי לחזור אליו.
       מעבר פנימי בין דפי האתר אינו יציאה, ושאלה עליו היא רעש.
     • כשהדף עצמו מוסר סיבה נוספת — ב-CRM, טופס שהוקלד ולא נשמר. אז שואלים
       גם אם היעד הוא דף פנימי, כי מה שיאבד הוא התוכן ולא המיקום.

   הזיהוי של "נפתח מבחוץ" נשען על document.referrer: מקור זהה פירושו שיש
   מאחורינו דף של האתר. זו הערכה ולא ידיעה — הדפדפן לא חושף את ההיסטוריה —
   והיא נוטה לצד הזהיר: referrer ריק נחשב כניסה מבחוץ.

       <script src="assets/exit-guard.js" data-auto></script>   // דף רגיל
       ExitGuard.mount({ unsaved: fn })                          // דף עם טפסים

   ‏mount מקבל:
     message  — נוסח השאלה ביציאה מהאתר (ברירת מחדל: "לצאת מהאתר?")
     unsaved  — פונקציה שמחזירה הודעה (או true) כשיש בדף תוכן שיאבד, ואחרת
                ערך כוזב. היא נקראת רק ברגע הלחיצה על "אחורה", ולכן היא
                יכולה לבדוק את מצב הדף בזמן אמת.

   דף שאין לו לא האחת ולא השנייה — כלומר נכנסו אליו מתוך האתר והוא לא מסר
   בדיקת unsaved — לא נוגע בהיסטוריה בכלל.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* הסימון שמבדיל את הזקיף מהרשומה האמיתית של הדף. הוא נבדק דרך
     history.state ולא דרך דגל ב-JS, כי חלון שדוחף רשומה משלו (מדבקת ה-QR
     ב-CRM) מחזיר אותנו אל הזקיף — ואת החזרה הזו אסור לפרש כיציאה. */
  var STATE_KEY = 'shukExitGuard';

  var mounted  = false;
  var armed    = false;   // האם הזקיף עומד כרגע בראש ההיסטוריה
  var leaves   = false;   // האם "אחורה" מהדף הזה מוציא מהאתר
  var leaveMsg = 'לצאת מהאתר?';
  var unsaved  = null;

  function sentinelState(){
    var state = {};
    state[STATE_KEY] = true;
    return state;
  }

  function onSentinel(){
    var state = global.history.state;
    return !!(state && state[STATE_KEY]);
  }

  function arm(){
    try { global.history.pushState(sentinelState(), ''); armed = true; }
    catch (e) { armed = false; }   // דפדפן שחוסם היסטוריה — הדף עובד בלי השמירה
  }

  /* היסטוריה באורך 1 היא ודאות ולא הערכה: אין לאן לחזור, ו"אחורה" סוגר את
     הלשונית. השאר נשען על ה-referrer. */
  function backLeavesSite(){
    if (global.history.length <= 1) return true;
    var ref = document.referrer;
    if (!ref) return true;
    try { return new URL(ref).origin !== location.origin; }
    catch (e) { return true; }
  }

  function reasonToAsk(){
    if (leaves) return leaveMsg;
    if (unsaved){
      var msg = unsaved();
      if (msg) return typeof msg === 'string' ? msg : leaveMsg;
    }
    return null;
  }

  function onPopState(){
    if (!armed) return;
    // הגענו אל הזקיף ולא דרכו — למשל חלון שדחף רשומה משלו ונסגר עכשיו
    if (onSentinel()) return;
    armed = false;
    var reason = reasonToAsk();
    // אין מה לשאול: הלחיצה הייתה אמיתית, וכל מה שהיא בזבזה הוא את הזקיף
    if (!reason){ global.history.back(); return; }
    if (global.confirm(reason)) global.history.back();
    else arm();
  }

  function mount(opts){
    if (mounted) return;
    if (!global.history || !global.history.pushState) return;
    opts = opts || {};
    if (opts.message) leaveMsg = opts.message;
    unsaved = typeof opts.unsaved === 'function' ? opts.unsaved : null;
    leaves = backLeavesSite();
    if (!leaves && !unsaved) return;
    mounted = true;
    global.addEventListener('popstate', onPopState);
    arm();
  }

  global.ExitGuard = {
    mount: mount,
    isMounted: function(){ return mounted; },
    leavesSite: function(){ return leaves; },
  };

  var tag = document.currentScript;
  if (tag && tag.hasAttribute('data-auto')) mount();
})(window);
