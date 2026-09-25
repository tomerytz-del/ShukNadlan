/* ============================================================================
   שם השוק בטקסט הקבוע של הדף - לוגו, פוטר, תוויות

   לאתר אין תבנית משותפת, ולכן "עפולה והעמק" כתוב בכל אחד מ-~20 הדפים: בשורת
   הלוגו, ב-alt וב-aria-label שלו, בפוטר, ובבלוק "חיפושים פופולריים". הקובץ
   הזה מחליף אותם בשם של השוק הפעיל - **רק כשהשוק אינו ברירת המחדל.**

   ## ‏ה-HTML נשאר עפולה, וזו ההחלטה

   הטקסט הקבוע נשאר "עפולה והעמק", והסימון `data-market-*` אומר מה מותר
   להחליף. כך דף בשוק ברירת המחדל - כלומר כל האתר היום - יוצא **בדיוק**
   כמו שיצא, גם לגוגל וגם לגולש/ת שהקובץ לא נטען אצלו/ה. ההחלפה קורית רק
   למי שנמצא/ת בשוק אחר (‏/haifa-krayot, או בחירה שמורה בשוק חי).

   | סימון | מה נכנס |
   | --- | --- |
   | `data-market-label` | התווית - "חיפה והקריות" |
   | `data-market-city` | העיר המרכזית - "חיפה" ("למכירה בחיפה") |
   | `data-market-aria="alt"` (או כמה, ברווח) | התווית, בתוך המאפיינים |
   | `data-market-city-attrs="title aria-label"` | "עפולה" ← העיר, בתוך המאפיינים |
   | `data-market-placeholder` | "עפולה" ← העיר, בתוך ה-placeholder |
   | `data-market-default-only` | מוסתר: תוכן שנכון רק לשוק ברירת המחדל |

   הבלוק "חיפושים פופולריים" הוא `data-market-default-only`: 14 עמודי
   התוצאות הם של עפולה (‏search-pages.ts), ועד שיהיו כאלה לכל שוק אסור
   שדף חיפה יקשר ל"דירות 4 חדרים בעפולה".

   ‏docs/regional-pages.md. ‏scripts/convert_market_text.py מסמן את הדפים.
   ============================================================================ */
(function () {
  'use strict';

  var OLD_LABELS = /עפולה והסביבה|עפולה והעמק/g;

  function apply() {
    var ctx = window.CityContext;
    var m = ctx && typeof ctx.market === 'function' ? ctx.market() : null;
    if (!m || m.isDefault) return;
    var city = m.city || m.label;

    var i, nodes;
    nodes = document.querySelectorAll('[data-market-label]');
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = m.label;

    nodes = document.querySelectorAll('[data-market-city]');
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = city;

    /* ‏data-market-aria="title aria-label" - רשימת מאפיינים מופרדת ברווח */
    function eachAttr(sel, dataAttr, fn) {
      var list = document.querySelectorAll(sel);
      for (var n = 0; n < list.length; n++) {
        var names = (list[n].getAttribute(dataAttr) || '').split(/\s+/);
        for (var k = 0; k < names.length; k++) {
          var v = names[k] && list[n].getAttribute(names[k]);
          if (v) list[n].setAttribute(names[k], fn(v));
        }
      }
    }
    eachAttr('[data-market-aria]', 'data-market-aria', function (v) { return v.replace(OLD_LABELS, m.label); });
    eachAttr('[data-market-city-attrs]', 'data-market-city-attrs', function (v) { return v.replace(/עפולה/g, city); });

    nodes = document.querySelectorAll('[data-market-placeholder]');
    for (i = 0; i < nodes.length; i++) {
      var ph = nodes[i].getAttribute('placeholder');
      if (ph) nodes[i].setAttribute('placeholder', ph.replace(/עפולה/g, city));
    }

    nodes = document.querySelectorAll('[data-market-default-only]');
    for (i = 0; i < nodes.length; i++) nodes[i].hidden = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
