/* ============================================================================
   הלוגו — סמל וקטורי במקום ה-PNG
   ----------------------------------------------------------------------------
   הסמל הוא סילואטה של סימון מפה, ובתוכו גג ואות ש זהובה: הכתובת שבה מוצאים
   נכס, והאות של "שוק". אותה סילואטה בדיוק היא גם הפין שמסמן מחיר על המפה,
   כך שהסמל אינו קישוט אלא חלק מהמוצר.

   למה קובץ ולא תגית <img>: ה-PNG שהיה כאן נשמר עם מסגרת לבנה ורעש בקצוות,
   ולכן הוא נראה מטושטש ב-46px ופסול לגמרי על הרקע הכהה של הפוטר. וקטור
   נקרא חד בכל גודל, מקבל את צבעיו מהדף, ולא עולה בקשת רשת.

   הסקריפט מחליף כל ‎<img>‎ שמצביע על ‎logo-shuknadlan.png‎ ב-SVG, שומר את
   ה-class ואת ה-alt המקוריים, ובוחר גרסה בהירה או כהה לפי ההקשר: בתוך
   ‎<footer>‎ או תחת ‎[data-tone="dark"]‎ הפין לבן, בכל שאר המקומות הוא ספיר.

   נטען עם ‎defer‎, ומאזין גם ל-DOM שנבנה מאוחר (הפוטר של דף המשרד נטען אחרי
   קריאה לשרת), כדי שלוגו שהוזרק בדיעבד יומר גם הוא.

   לאותו סמל יש תאום סטטי — ‎assets/logo-shuknadlan.svg‎ — המשמש כאייקון
   הלשונית של כל הדפים. אייקון לשונית נטען לפני שיש דף להריץ בו JS, ולכן
   הוא חייב להיות קובץ. כל שינוי בגאומטריה כאן צריך להיעשות גם שם.

   ‏JS גולמי בלי תלויות, כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function () {
  'use strict';

  var PIN = 'M26 60 C26 60 48 38 48 24 C48 11.8 38.2 2 26 2 C13.8 2 4 11.8 4 24 C4 38 26 60 26 60 Z';
  var ROOF = 'M13 26 L26 14 L39 26';
  var SAPPHIRE = '#0e2a6b';
  var BRASS = '#c9a227';

  function markup(dark, label) {
    var pin  = dark ? '#ffffff' : SAPPHIRE;
    var roof = dark ? SAPPHIRE : '#ffffff';
    /* ‏role/aria נגזרים מה-alt של התמונה שהוחלפה: לוגו שיושב בתוך קישור
       שכבר נושא aria-label מקבל alt ריק, ואז ה-SVG צריך להיות מוסתר לגמרי
       מקורא המסך ולא לשכפל את שם הקישור. */
    var a11y = label
      ? ' role="img" aria-label="' + label.replace(/"/g, '&quot;') + '"'
      : ' aria-hidden="true" focusable="false"';
    return '<svg viewBox="0 0 52 62" xmlns="http://www.w3.org/2000/svg"' + a11y + '>' +
             '<path d="' + PIN + '" fill="' + pin + '"/>' +
             '<path d="' + ROOF + '" fill="none" stroke="' + roof + '" ' +
                   'stroke-width="5" stroke-linejoin="miter" stroke-linecap="butt"/>' +
             '<text x="26" y="41" text-anchor="middle" fill="' + BRASS + '" ' +
                   'font-family="Heebo, system-ui, sans-serif" font-weight="800" ' +
                   'font-size="18">ש</text>' +
           '</svg>';
  }

  function isDark(el) {
    return !!el.closest('footer, [data-tone="dark"], .footer-brand');
  }

  function convert(img) {
    if (img.dataset.brandLogo === 'done') return;
    var span = document.createElement('span');
    span.className = img.className;
    span.dataset.brandLogo = 'done';
    /* ה-CSS הקיים נותן גובה ל-‎.logo-img‎ ורוחב ל-‎.footer-logo img‎; המעטפת
       מעבירה את שניהם ל-SVG שבתוכה במקום להעתיק את הכללים לכאן. */
    span.style.display = 'inline-flex';
    span.style.flex = '0 0 auto';
    span.style.aspectRatio = '52 / 62';
    if (!img.className) span.style.height = '46px';
    span.innerHTML = markup(isDark(img), (img.getAttribute('alt') || '').trim());
    var svg = span.firstChild;
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    img.replaceWith(span);
  }

  function sweep(root) {
    var imgs = (root || document).querySelectorAll('img[src$="logo-shuknadlan.png"]');
    for (var i = 0; i < imgs.length; i++) convert(imgs[i]);
  }

  sweep(document);

  /* הפוטר, כרטיסי המשרד וכרטיסי הסוכן/ת נבנים אחרי קריאה לשרת. במקום
     שכל דף יזכור לקרוא לכאן שוב, המשקיף עושה את זה בעצמו. */
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('img[src$="logo-shuknadlan.png"]')) convert(node);
          else if (node.querySelectorAll) sweep(node);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
