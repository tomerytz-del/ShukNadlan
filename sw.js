/* ============================================================================
   ‏Service Worker — מינימלי בכוונה, ובלי מטמון
   ----------------------------------------------------------------------------
   הקובץ הזה קיים מסיבה אחת: **בלעדיו אין כפתור התקנה.** כרום יורה את
   ‎beforeinstallprompt‎ רק לדף שיש לו מניפסט תקין *וגם* ‏Service Worker
   רשום עם מאזין ‎fetch‎. בלי שניהם אין אירוע, ובלי האירוע אין מה לחבר
   לכפתור — נשאר רק התפריט של שלוש הנקודות.

   ‏**למה אין כאן מטמון, וזו לא השמטה.** כל האתר הוא קובצי HTML סטטיים
   ש-Netlify מפרסם תוך שניות מהמיזוג ל-main, ושמות הקבצים אינם נושאים
   חתימת תוכן (‏app.a1b2c3.js). ראו את ההסבר על המטמון ב-‎_headers‎: מטמון
   ארוך היה מגיש גרסה ישנה אחרי מיזוג. ‏Service Worker שמגיש מהמטמון הוא
   בדיוק אותו כשל, רק חמור יותר — הוא חי בדפדפן של המשתמש/ת גם אחרי
   שהשרת כבר מגיש את הגרסה החדשה, והוא לא נעלם ברענון. סוכן/ת שרואה לוח
   מחוונים ישן לא מדווח/ת על באג; הוא/היא פשוט מפסיק/ה לסמוך על המספרים.

   התוצאה: הדפדפן עובד בדיוק כמו בלי ה-Worker (אותן בקשות רשת, אותו
   ‏ETag, אותו 304), והרווח היחיד הוא ההתקנה. אפליקציה מותקנת בלי רשת
   תציג את שגיאת הרשת הרגילה של הדפדפן — זה מחיר מודע, והחלופה (מסך
   "אין חיבור" משלנו) דורשת מטמון של דף, כלומר בדיוק מה שנפסל למעלה.

   ‏**איך מסירים Worker שכבר נרשם** (אם אי פעם נרצה): לא מוחקים את הקובץ —
   קובץ חסר מחזיר 404, והדפדפן משאיר את הגרסה הישנה רשומה. מפרסמים כאן
   ‏Worker שמבטל את עצמו:

       self.addEventListener('install', () => self.skipWaiting());
       self.addEventListener('activate', (e) => e.waitUntil(
         self.registration.unregister().then(() => self.clients.matchAll())
           .then(cs => cs.forEach(c => c.navigate(c.url)))
       ));

   ‏**גרסה** — VERSION למטה אינו משמש לכלום בקוד; הוא קיים כדי ששינוי
   בקובץ הזה יהיה שינוי בייט, כלומר כדי שהדפדפן יזהה Worker חדש.
   ========================================================================== */
'use strict';

var VERSION = '2026-09-30';

/* ‏Worker חדש נכנס לתוקף מיד ולא ממתין לסגירת כל הלשוניות. אין כאן מצב
   שמור ואין מטמון, ולכן אין מה לשמר בין הגרסאות. */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/* ‏**שיתוף איש קשר אל האפליקציה המותקנת** (‏share_target ב-
   ‎app-crm.webmanifest‎). אנדרואיד שולח את הכרטיס כקובץ ‎.vcf‎ ב-POST, ולאתר
   סטטי אין מי שיקבל POST — ולכן ה-Worker תופס אותו כאן, שם את התוכן בצד,
   ומפנה ל-‎/crm?share=contacts‎. הדף קורא ומוחק (‏ContactImport.takeShared
   ב-‎assets/contact-import.js‎).

   ‏**זה אינו מטמון של דפים**, והכלל שלמעלה בעינו: ‏Cache Storage משמש כאן
   תיבת דואר לכרטיס אחד, שנמחקת בקריאה הראשונה. שום בקשת רשת אינה מוגשת
   ממנה. ‏docs/crm-contacts-import.md. */
var SHARE_PATH = '/crm-share';
var SHARE_CACHE = 'shared-contacts-v1';
var SHARE_KEY = '/__shared-contacts';
/* כרטיס אמיתי הוא קילובייטים בודדים (עם תמונה - עשרות). מה שמעבר לזה אינו
   ספר טלפונים שכדאי לפענח בטלפון, ובטח לא לשמור. */
var SHARE_MAX_BYTES = 2 * 1024 * 1024;

function handleShare(request) {
  return request.formData().then(function (form) {
    var parts = [];
    var files = form.getAll('contacts');
    var reads = files.map(function (f) {
      if (!f || typeof f.text !== 'function' || f.size > SHARE_MAX_BYTES) return Promise.resolve();
      return f.text().then(function (t) { parts.push(t); });
    });
    return Promise.all(reads).then(function () {
      var text = form.get('text');
      if (text && /BEGIN:VCARD/i.test(String(text))) parts.push(String(text));
      if (!parts.length) return Response.redirect('/crm?share=empty', 303);
      return caches.open(SHARE_CACHE).then(function (cache) {
        return cache.put(SHARE_KEY, new Response(parts.join('\n'), {
          headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
        }));
      }).then(function () { return Response.redirect('/crm?share=contacts', 303); });
    });
  })['catch'](function () { return Response.redirect('/crm?share=error', 303); });
}

/* המאזין שבגללו הקובץ קיים. ‏respondWith אינו נקרא בכוונה בשום בקשה אחרת:
   בקשה שלא מטופלת ממשיכה לרשת כרגיל, וזו בדיוק ההתנהגות הרצויה. */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method === 'POST' && new URL(req.url).pathname === SHARE_PATH) {
    event.respondWith(handleShare(req));
  }
  /* כל השאר: מעבר לרשת — ברירת המחדל של הדפדפן */
});
