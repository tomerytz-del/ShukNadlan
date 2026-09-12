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

   ולא כל "אחורה" הוא יציאה מהדף: קישור עוגן פנימי (‎#listings‎ בדף הבית)
   מוסיף רשומה משלו, ו"אחורה" ממנה רק מבטל את הקפיצה. לכן גם רשומת הדף
   עצמה מסומנת, והשאלה עולה רק כשנוחתים עליה.

   מתי שואלים — שלוש סיבות, והספציפית מנצחת:
     • תוכן שיאבד: הדף מוסר בדיקת unsaved (ב-CRM — טופס שהוקלד ולא נשמר).
       זו הסיבה החזקה מכולן, כי מה שנמחק הוא התוכן ולא רק המיקום.
     • יציאה אמיתית מהאתר: הדף נפתח מבחוץ (גוגל, קישור בוואטסאפ, סימנייה,
       כתובת שהוקלדה) ואין מאחוריו דף פנימי לחזור אליו.
     • ‏always: הדף מבקש שכל "אחורה" ייעצר, גם כשהיעד הוא דף פנימי באתר.
       ה-CRM מבקש את זה: יציאה ממנו לדף הבית היא עזיבה של סביבת העבודה, גם
       אם טכנית נשארים באתר. דף תוכן רגיל לא מבקש, ושאלה על מעבר פנימי בו
       הייתה רעש.

   הזיהוי של "נפתח מבחוץ" נשען על document.referrer: מקור זהה פירושו שיש
   מאחורינו דף של האתר. זו הערכה ולא ידיעה — הדפדפן לא חושף את ההיסטוריה —
   והיא נוטה לצד הזהיר: referrer ריק נחשב כניסה מבחוץ.

       <script src="assets/exit-guard.js" data-auto></script>   // דף רגיל
       ExitGuard.mount({ always:true, unsaved:fn })              // סביבת עבודה

   ‏mount מקבל:
     message      — נוסח השאלה ביציאה מהאתר (ברירת מחדל: "לצאת מהאתר?")
     always       — לשאול בכל "אחורה", גם כשנשארים באתר
     stayMessage  — נוסח השאלה במקרה הזה (ברירת מחדל: כמו message)
     unsaved      — פונקציה שמחזירה הודעה (או true) כשיש בדף תוכן שיאבד,
                    ואחרת ערך כוזב. היא נקראת רק ברגע הלחיצה על "אחורה",
                    ולכן היא יכולה לבדוק את מצב הדף בזמן אמת.

   דף שאין לו אף אחת מהשלוש — נכנסו אליו מתוך האתר, בלי always ובלי בדיקת
   unsaved — לא נוגע בהיסטוריה בכלל.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* שני סימונים ב-history.state, ולא דגל ב-JS: ההיסטוריה אינה קריאה, וכל מה
     שיש לנו כדי לדעת על איזו רשומה נחתנו הוא מה שכתבנו עליה בעצמנו.

     ‏STATE_KEY על הזקיף — חלון שדוחף רשומה משלו (מדבקת ה-QR ב-CRM) מחזיר
     אותנו אליו כשהוא נסגר, ואת החזרה הזו אסור לפרש כיציאה.

     ‏PAGE_KEY על הרשומה האמיתית של הדף — היא היעד היחיד שבו שואלים. בלעדיו
     כל חזרה מקישור עוגן פנימי (‎#listings‎ בדף הבית) הייתה נקראת יציאה
     מהאתר: רשומת עוגן נוצרת בדפדפן עם state ריק, ו"לא הזקיף" אינו מספיק
     כדי להבדיל בינה לבין הדף עצמו. */
  var STATE_KEY = 'shukExitGuard';
  var PAGE_KEY  = 'shukExitGuardPage';

  var mounted   = false;
  var armed     = false;   // האם הזקיף עומד כרגע בראש ההיסטוריה
  var pageTagged = false;  // האם הצלחנו לסמן את רשומת הדף
  var leaves    = false;   // האם "אחורה" מהדף הזה מוציא מהאתר
  var always    = false;   // לשאול גם כשהיעד הוא דף פנימי
  var leaveMsg  = 'לצאת מהאתר?';
  var stayMsg   = '';      // ריק = משתמשים ב-leaveMsg
  var unsaved   = null;

  function stateWith(key){
    var base = global.history.state;
    var state = (base && typeof base === 'object') ? base : {};
    state[key] = true;
    return state;
  }

  /* הרשומה שעליה הדף נטען היא זו שאליה נחזור כשהזקיף ייפול, ולכן היא נושאת
     את הסימון. ‏replaceState ולא pushState: אנחנו עומדים עליה ממש עכשיו. */
  function tagPage(){
    try {
      global.history.replaceState(stateWith(PAGE_KEY), '');
      var state = global.history.state;
      pageTagged = !!(state && state[PAGE_KEY]);
    } catch (e) { pageTagged = false; }
  }

  /* הזקיף מקבל state נקי משלו ולא העתק של רשומת הדף: הוא רשומה שאנחנו
     יצרנו, ואין בה מצב של הדף שצריך לשרוד. */
  function arm(){
    var state = {};
    state[STATE_KEY] = true;
    try { global.history.pushState(state, ''); armed = true; }
    catch (e) { armed = false; }   // דפדפן שחוסם היסטוריה — הדף עובד בלי השמירה
  }

  /* על איזו רשומה נחתנו: הזקיף עצמו, רשומת הדף, או רשומה שאינה שלנו (עוגן,
     או חלון שדחף רשומה משלו). דפדפן שלא שמר את הסימון על רשומת הדף מקבל את
     הכלל הישן — כל מה שאינו הזקיף נחשב לרשומת הדף — כדי שכישלון בסימון יעלה
     שאלה מיותרת ולא יבטל את השמירה כולה. */
  function landedOn(){
    var state = global.history.state;
    if (state && state[STATE_KEY]) return 'sentinel';
    if (!pageTagged) return 'page';
    return (state && state[PAGE_KEY]) ? 'page' : 'other';
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

  /* הספציפי לפני הכללי: "יש פרטים שלא נשמרו" אומר למשתמש/ת מה בדיוק עומד
     להימחק, ו"לצאת מהאתר?" אומר רק לאן. כשהשתיים נכונות יחד, השאלה הראשונה
     היא זו שמצדיקה עצירה. */
  function reasonToAsk(){
    if (unsaved){
      var msg = unsaved();
      if (msg) return typeof msg === 'string' ? msg : genericMsg();
    }
    if (leaves) return leaveMsg;
    if (always) return genericMsg();
    return null;
  }

  function genericMsg(){
    return leaves ? leaveMsg : (stayMsg || leaveMsg);
  }

  /* ‏'sentinel' — הגענו אל הזקיף ולא דרכו (חלון שדחף רשומה משלו ונסגר עכשיו).
     ‏'other'    — רשומת עוגן בתוך הדף; "אחורה" ממנה הוא ניווט פנימי, והזקיף
                   נשאר עומד למקרה שימשיכו אחורה עד לדף עצמו.
     ‏'page'     — הזקיף נפל, וזו הלחיצה שעומדת לעזוב את הדף. */
  function onPopState(){
    if (!armed || landedOn() !== 'page') return;
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
    if (opts.stayMessage) stayMsg = opts.stayMessage;
    always = !!opts.always;
    unsaved = typeof opts.unsaved === 'function' ? opts.unsaved : null;
    leaves = backLeavesSite();
    if (!leaves && !always && !unsaved) return;
    mounted = true;
    global.addEventListener('popstate', onPopState);
    tagPage();
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
