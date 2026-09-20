/* ============================================================================
   יריד הבתים הפתוחים — הסימן והחלון, במקום אחד
   ----------------------------------------------------------------------------
   הנכס שהמתווך/ת סימן/ה ב-CRM כמשתתף ביריד מוצג בארבעה מקומות שונים: הפין
   במפת דף הבית, האריח במדף, הבאנר בדף הבית והרצועה בדף הנכס. ארבעתם שואלים
   בדיוק את אותן שתי שאלות — "האם החלון פתוח עכשיו?" ו"איך מציירים את
   הסימן?" — ולכן שתיהן נענות כאן ולא בכל דף מחדש.

   שלושה נכסים ומצב אחד: ‏open_house (הסימון), open_house_start ו-
   open_house_end (החלון). **הסימון לבדו אינו הבטחה** — נכס שהחלון שלו טרם
   נפתח או שכבר נסגר אינו ביריד, וההבטחה "ללא עמלת תיווך" נכונה רק בתוכו.
   ‏expire_open_house() ב-DB מכבה את הדגל בתום החלון, אבל הוא רץ כל רבע
   שעה — ולכן ה-**תצוגה** לא נשענת עליו אלא בודקת את התאריכים בעצמה.
   נכס שפג לפני שתים־עשרה דקות לא מוצג כמשתתף.

   הקובץ עצמאי: אין לו תלות ב-Supabase, ב-Leaflet או במשתנים של הדף המארח,
   והוא נטען בשורה אחת בכל עמוד שצריך אותו.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ---------- החלון ----------
     ‏Date לא נשמר בין קריאות: דף הבית פתוח שעות, וחלון שנסגר בזמן הזה
     צריך להיסגר גם בתצוגה בגלילה הבאה. */
  function at(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function startsAt(p) { return at(p && p.open_house_start); }
  function endsAt(p) { return at(p && p.open_house_end); }

  /* האם הנכס ביריד *ברגע זה*. ‏open_house בלי תאריכים אינו יריד: השדות
     האלה הם ההבטחה עצמה, ובלעדיהם אין לגולש/ת מה לדעת. */
  function live(p, now) {
    if (!p || !p.open_house) return false;
    var from = startsAt(p), to = endsAt(p);
    if (!from || !to) return false;
    var t = (now ? new Date(now) : new Date()).getTime();
    return from.getTime() <= t && t < to.getTime();
  }

  /* חלון שטרם נפתח. ה-CRM מציג את זה לסוכן/ת ("נכנס ליריד ב-…"); באתר
     הציבורי נכס כזה אינו מוצג כמשתתף בשום מקום. */
  function upcoming(p, now) {
    if (!p || !p.open_house) return false;
    var from = startsAt(p), to = endsAt(p);
    if (!from || !to) return false;
    var t = (now ? new Date(now) : new Date()).getTime();
    return from.getTime() > t && to.getTime() > t;
  }

  function dayNum(d) { return Math.floor(d.getTime() / 864e5); }

  /* כמה ימים נשארו, בספירת ימי לוח ולא בחילוק שעות: חלון שנסגר מחר ב-9:00
     הוא "עד מחר" גם כשנשארו לו 14 שעות. */
  function daysLeft(p, now) {
    var to = endsAt(p);
    if (!to) return null;
    var from = now ? new Date(now) : new Date();
    return dayNum(to) - dayNum(from);
  }

  function hebDay(d) {
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  }

  /* "עד 14.10" / "עד מחר" / "היום אחרון" — הטקסט שנצמד לתגית ולרצועה.
     היום האחרון נאמר במילים כי זה מה שמזיז מישהו להרים טלפון עכשיו. */
  function endLabel(p, now) {
    var to = endsAt(p);
    if (!to) return '';
    var left = daysLeft(p, now);
    if (left === 0) return 'היום האחרון';
    if (left === 1) return 'עד מחר';
    return 'עד ' + hebDay(to);
  }

  /* טווח מלא, לרצועה בדף הנכס ולכרטיס ב-CRM: "12.10 – 26.10" */
  function rangeLabel(p) {
    var from = startsAt(p), to = endsAt(p);
    if (!from || !to) return '';
    return hebDay(from) + ' - ' + hebDay(to);
  }

  /* ---------- הספירה לאחור ----------
     החלון הוא המוצר, ותאריך סיום הוא הדרך השקטה לומר אותו. ספירה שרצה
     אומרת את אותו דבר בקול: "עוד יומיים ושלוש שעות" הוא מידע שאי אפשר
     לדחות למחר בלי לשים לב.

     ‏remaining מחזירה null כשהחלון נגמר ולא מספרים שליליים: מונה שסופר
     אחורה אל מתחת לאפס הוא בדיוק סוג הבאג שנשאר על המסך שבוע.

     **טיקר אחד לכל העמוד.** כל אלמנט שרוצה ספירה נושא ‎data-oh-end‎ עם
     מועד הסיום, והטיקר מעדכן את כולם יחד — ולא ‎setInterval‎ לכל אריח.
     בעמוד עם עשרים נכסים זה ההבדל בין טיימר אחד לעשרים, ובין דף שנרדם
     ברקע לדף שממשיך לעבוד בכל לשונית פתוחה (‏visibilitychange). */
  function remaining(p, now) {
    var to = endsAt(p);
    if (!to) return null;
    var ms = to.getTime() - (now ? new Date(now).getTime() : Date.now());
    if (ms <= 0) return null;
    var sec = Math.floor(ms / 1000);
    return {
      total: ms,
      days: Math.floor(sec / 86400),
      hours: Math.floor((sec % 86400) / 3600),
      minutes: Math.floor((sec % 3600) / 60),
      seconds: sec % 60,
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* מיום ומעלה: "3 ימים" + "04:12" — השעות והדקות מספיקות, והשניות רק
     מרצדות. מתחת ליום: "04:12:33" — שם השנייה היא כל העניין.

     **שני חלקים ולא מחרוזת אחת**, וזה לא סגנון: "3 ימים 04:12" הוא טקסט
     דו-כיווני (מספר, מילה עברית, שעון), ואלגוריתם ה-bidi מסדר אותו מחדש
     על המסך — המונה הופיע כ-"ימים 3 04:12". החלק העברי נשאר RTL כמו כל
     הדף, והשעון יושב ב-‎<bdi>‎ משלו שמבודד אותו. */
  function countdownParts(p, now) {
    var r = remaining(p, now);
    if (!r) return { done: true, days: '', clock: '' };
    return {
      done: false,
      days: r.days >= 1 ? r.days + (r.days === 1 ? ' יום' : ' ימים') : '',
      clock: r.days >= 1
        ? pad2(r.hours) + ':' + pad2(r.minutes)
        : pad2(r.hours) + ':' + pad2(r.minutes) + ':' + pad2(r.seconds),
    };
  }

  /* מחרוזת אחת, לשימושים שאינם HTML (‏title, מייל, בדיקות) */
  function countdownText(p, now) {
    var c = countdownParts(p, now);
    if (c.done) return 'הסתיים';
    return (c.days ? c.days + ' ' : '') + c.clock;
  }

  var URGENT_MS = 24 * 3600 * 1000;

  /* ‏opts: { label, className }
     ‏label=false מוריד את המילה "נותרו" — במקומות צרים (סרט על אריח)
     המספר לבדו ברור, ושתי מילים לפניו דוחפות אותו לשורה שנייה.
     ‏dir="ltr" על המספר: "3 ימים 04:12" הוא טקסט מעורב, ובלי כיוון מפורש
     הדפדפן מעביר את הנקודתיים לצד הלא נכון. */
  function countdownHtml(p, opts) {
    ensureCountdownTicker();
    var o = opts || {};
    var to = endsAt(p);
    if (!to) return '';
    var r = remaining(p);
    return '<span class="oh-countdown' + (o.className ? ' ' + o.className : '') +
        (r && r.total <= URGENT_MS ? ' is-urgent' : '') + (r ? '' : ' is-done') + '" ' +
        'data-oh-end="' + esc(to.toISOString()) + '" ' +
        'title="' + esc('הנכס ביריד עד ' + hebDay(to)) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12.6" r="8.2"/>' +
        '<path d="M12 8.4v4.4l2.8 1.7"/><path d="M9.2 2.6h5.6"/></svg>' +
      (o.label === false ? '' : '<span class="oh-cd-label">נותרו</span>') +
      '<span class="oh-cd-days">' + esc(countdownParts(p).days) + '</span>' +
      '<bdi class="oh-cd-value">' + esc(countdownParts(p).clock) + '</bdi>' +
      '</span>';
  }

  /* מעדכן כל אלמנט עם ‎data-oh-end‎ שנמצא כרגע ב-DOM. אלמנט שהוסר (מדף
     שצויר מחדש) פשוט לא נמצא בסריקה הבאה — אין כאן רישום שצריך לנקות. */
  function tickCountdowns() {
    var nodes = global.document.querySelectorAll('[data-oh-end]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var fake = { open_house: true, open_house_start: 0, open_house_end: el.getAttribute('data-oh-end') };
      var r = remaining(fake);
      var c = countdownParts(fake);
      var days = el.querySelector('.oh-cd-days');
      var value = el.querySelector('.oh-cd-value');
      if (days) days.textContent = c.days;
      if (value) value.textContent = c.done ? 'הסתיים' : c.clock;
      el.classList.toggle('is-urgent', !!r && r.total <= URGENT_MS);
      el.classList.toggle('is-done', !r);
    }
  }

  var ticker = null;
  var tickerReady = false;
  function ensureCountdownTicker() {
    // ‏tickerReady ולא ‎ticker‎: בלשונית מוסתרת הטיימר כבוי (‏ticker=null),
    // וקריאה נוספת ל-countdownHtml הייתה רושמת מאזין visibilitychange שני
    if (tickerReady || !global.document) return;
    tickerReady = true;
    var start = function () { if (!ticker) ticker = global.setInterval(tickCountdowns, 1000); };
    var stop = function () { if (ticker) { global.clearInterval(ticker); ticker = null; } };
    start();
    // לשונית ברקע לא צריכה לספור; בחזרה אליה הערך מתעדכן מיד ולא בעוד שנייה
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.hidden) stop();
      else { tickCountdowns(); start(); }
    });
  }

  /* ---------- הסימן ----------
     פין־טיפה אדום, בתוכו בית עם דלת פתוחה ותווית "פתוח" נשענת על הגג.
     אותו סימן משמש גם כפין על המפה (34px), גם כאייקון של הסקציה (28px)
     וגם בראש דף היריד (64px) — ולכן הוא SVG ולא קובץ PNG, ולכן הגדלים
     נמסרים כפרמטר ולא נצרבים בו.

     ‏aria-hidden כברירת מחדל: הסימן חוזר תמיד לצד טקסט שאומר את אותו
     דבר ("ללא עמלת תיווך"), ומקריא מסך ששומע אותו פעמיים שומע רעש.
     מי שצריך אותו כתמונה בפני עצמה מוסר ‎title‎.

     האדום כאן הוא ‎--open-house‎ ולא הבורדו של "למכירה": שני אדומים
     שונים בתכלית זה מזה — האחד אומר "זו עסקת מכירה" והשני "אין כאן
     עמלה", והם מופיעים זה לצד זה על אותו אריח. */
  var HOUSE = '#14306b';   /* ספיר האתר — ‎--sapphire‎, כתוב כאן כערך כי
                              ‏SVG שנשלח ל-divIcon של Leaflet מצויר מחוץ
                              לעץ שיורש את המשתנים של הדף */

  /* ‏withLabel — האם לכתוב "פתוח" בתוך התווית. בפין על המפה (38px) הכיתוב
     יוצא בגובה שלושה פיקסלים, כלומר כתם ולא מילה; שם התווית נשארת עם החור
     שלה בלבד, וזה מספיק כדי לזהות את הסימן. */
  function pinBody(withLabel) {
    return (
      /* הטיפה */
      '<path d="M24 1.6c-12.3 0-22.3 10-22.3 22.3 0 15.4 18.2 34.9 20.9 37.7a1.9 1.9 0 0 0 2.8 0' +
        'c2.7-2.8 20.9-22.3 20.9-37.7 0-12.3-10-22.3-22.3-22.3z" fill="currentColor"/>' +
      /* העיגול הלבן שבתוכה */
      '<circle cx="24" cy="23.4" r="15.1" fill="#fff"/>' +
      /* גג */
      '<path d="M13.4 25.6 23 16.2l9.6 9.4" fill="none" stroke="' + HOUSE + '" stroke-width="3.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
      /* גוף הבית */
      '<path d="M16.2 26h13.6v9.8H16.2z" fill="' + HOUSE + '"/>' +
      /* הדלת הפתוחה — פתח לבן שקצהו העליון משופע, כמו דלת שנפתחה פנימה */
      '<path d="M21.4 35.8v-6.6l6.2-2.4v9z" fill="#fff"/>' +
      /* התווית האדומה שנשענת על הגג ויוצאת מהעיגול החוצה, עם החור שלה
         והחריץ בקצה. הקו הלבן סביבה הוא מה שמפריד אותה גם מהטיפה האדומה
         שמתחתיה וגם מאריחי מפה כהים. */
      '<path d="M28.4 14.3 44.9 10 43.2 14.1 46.6 17 30.2 21.3z" fill="currentColor" ' +
        'stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<circle cx="31.4" cy="17.6" r="1.15" fill="#fff"/>' +
      (withLabel
        ? '<text x="38.8" y="17.4" fill="#fff" font-family="Heebo,Arial,sans-serif" ' +
          'font-size="5.4" font-weight="800" text-anchor="middle" ' +
          'transform="rotate(-14.5 38.8 16.6)">פתוח</text>'
        : '')
    );
  }

  /* ‏opts: { size, className, title, color, label }
     ‏color נמסר רק כשהסימן יושב על רקע שאינו לבן (רצועה כהה) — בכל שאר
     המקומות הוא יורש ‎currentColor‎ מהאלמנט שמחזיק אותו, וכך CSS אחד
     צובע את הסימן ואת הטקסט שלצדו יחד.
     ‏label ברירת המחדל נגזרת מהגודל: מ-64px ומעלה "פתוח" קריא בתווית,
     ומתחת לזה הוא כתם באורך ארבע אותיות. */
  var LABEL_MIN = 64;

  /* ה-viewBox רחב מהטיפה ומתחיל ב-‎-6‎, ולא ‎0 0 48 64‎: התווית יוצאת מהעיגול
     ימינה, ו-SVG חותך כברירת מחדל כל מה שחורג מה-viewBox — כך נחתכה המילה
     "פתוח" בדיוק באמצע. שישה יחידות מכל צד שומרות על **מרכז הטיפה במרכז
     האלמנט** (‏24 מתוך 60 אחרי ההזחה = חצי), וזה מה שמאפשר ל-‎.oh-pin‎
     למרכז את הסימן על נקודת הנכס ב-translate(-50%) פשוט. */
  var VIEW_W = 60;
  var VIEW_H = 64;

  function icon(opts) {
    var o = opts || {};
    var size = o.size || 34;
    var w = Math.round(size * VIEW_W / VIEW_H);
    var withLabel = (o.label === undefined) ? size >= LABEL_MIN : !!o.label;
    return '<svg class="oh-mark' + (o.className ? ' ' + o.className : '') + '" ' +
      'width="' + w + '" height="' + size + '" viewBox="-6 0 ' + VIEW_W + ' ' + VIEW_H + '" ' +
      (o.color ? 'style="color:' + o.color + '" ' : '') +
      (o.title
        ? 'role="img" aria-label="' + esc(o.title) + '"'
        : 'aria-hidden="true" focusable="false"') +
      '>' + pinBody(withLabel) + '</svg>';
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
      });
  }

  /* ---------- הפין על המפה ----------
     מוחזר כ-HTML ל-‎L.divIcon‎ של Leaflet (‏iconSize 0×0, ראו ‎.map-pin‎
     ב-index.html): הסימן ממורכז על הנקודה ומעליו תווית המחיר, כדי שנכס
     ביריד יישאר קריא כמחיר וגם ייראה כבית פתוח במבט אחד. */
  function mapPinHtml(p) {
    return '<span class="oh-pin" aria-hidden="true">' + icon({ size: 38 }) + '</span>';
  }

  /* ---------- ההבטחה בטקסט ----------
     מנוסחת במקום אחד כי היא הבטחה מסחרית: "ללא עמלת תיווך" מופיעה על
     האריח, בבאנר, בדף הנכס ובדף היריד — וניסוח שונה בכל מקום הוא ארבע
     הבטחות שונות. */
  var NO_FEE = 'ללא עמלת תיווך';
  var FAIR_NAME = 'יריד הבתים הפתוחים';

  global.OpenHouse = {
    live: live,
    remaining: remaining,
    countdownText: countdownText,
    countdownParts: countdownParts,
    countdownHtml: countdownHtml,
    tickCountdowns: tickCountdowns,
    upcoming: upcoming,
    startsAt: startsAt,
    endsAt: endsAt,
    daysLeft: daysLeft,
    endLabel: endLabel,
    rangeLabel: rangeLabel,
    hebDay: hebDay,
    icon: icon,
    mapPinHtml: mapPinHtml,
    NO_FEE: NO_FEE,
    FAIR_NAME: FAIR_NAME,
  };
})(window);
