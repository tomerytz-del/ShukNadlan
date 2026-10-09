/* ============================================================================
   מחירי דירות לפי עיר - הטבלאות של /prices
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן, כמו `assets/markets.js`: הקובץ נטען כ-`<script src>`
   בדף, **ומיובא** ב-`netlify/edge-functions/prices-page.ts` לתופעת הלוואי
   שלו (‏`globalThis.ShukPrices`). כך הטבלה שהשרת מגיש לסורק והטבלה שהדפדפן
   בונה כשהשרת לא הספיק הן אותה טבלה. ולכן אין כאן `export`.

   הנתונים מ-`city_price_table()` (‏20270324090000) - צבירה בלבד, ותא עם
   פחות מ-5 עסקאות כבר מושתק במסד. ‏docs/city-prices.md.
   ========================================================================== */
(function (root) {
  /* ‏עותק משלו ולא escapeHtml: הקובץ רץ גם בשרת, שם אין esc.js. לכן כל
     חמשת התווים (‏scripts/check_escapers.py). */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function roomsLabel(r) {
    if (r <= 2) return 'עד 2.5 חדרים';
    if (r >= 6) return '5.5 חדרים ומעלה';
    return r + ' חדרים';
  }

  /* 2026-08-13 → 13.8.2026 */
  function heDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + '.' + (+m[2]) + '.' + m[1] : '';
  }

  /* עיר אחת לכל קבוצה, לפי סדר השווקים ואז לפי מספר העסקאות - העיר
     שהכי הרבה אנשים מחפשים בה עולה ראשונה בשוק שלה. */
  function groupCities(rows, marketOrder) {
    var byCity = {};
    var list = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.city) return;
      var c = byCity[r.city];
      if (!c) {
        c = byCity[r.city] = { city: r.city, market: r.market_slug, rows: [], deals: 0 };
        list.push(c);
      }
      c.rows.push(r);
      c.deals += Number(r.deals) || 0;
    });
    var order = marketOrder || [];
    function rank(slug) {
      var i = order.indexOf(slug);
      return i < 0 ? order.length : i;
    }
    list.sort(function (a, b) {
      return rank(a.market) - rank(b.market) || b.deals - a.deals || (a.city < b.city ? -1 : 1);
    });
    list.forEach(function (c) {
      c.rows.sort(function (a, b) { return a.rooms - b.rooms; });
    });
    return list;
  }

  function period(rows) {
    var r = (rows || [])[0];
    return r ? { start: r.period_start, end: r.period_end } : null;
  }

  /* ‏HTML של כל הטבלאות. ‏`labelFor(slug)` מחזיר את שם השוק ("חיפה והקריות"). */
  function render(rows, opts) {
    opts = opts || {};
    var labelFor = opts.labelFor || function () { return ''; };
    var cities = groupCities(rows, opts.marketOrder);
    if (!cities.length) return '';
    var out = [];
    var lastMarket = null;
    cities.forEach(function (c) {
      if (c.market !== lastMarket) {
        var label = labelFor(c.market);
        if (label) out.push('<h2 class="prices-market">' + escapeHtml(label) + '</h2>');
        lastMarket = c.market;
      }
      var id = 'city-' + encodeURIComponent(c.city).replace(/%/g, '').toLowerCase();
      out.push(
        '<section class="prices-city" id="' + escapeHtml(id) + '">' +
        '<h3>מחירי דירות ב' + escapeHtml(c.city) + '</h3>' +
        '<div class="prices-scroll"><table class="prices-table">' +
        '<thead><tr><th scope="col">גודל הדירה</th><th scope="col">מחיר חציוני</th>' +
        '<th scope="col">מחיר למ״ר</th><th scope="col">עסקאות</th></tr></thead><tbody>' +
        c.rows.map(function (r) {
          return '<tr><th scope="row">' + escapeHtml(roomsLabel(r.rooms)) + '</th>' +
            '<td>₪' + num(r.median_price) + '</td>' +
            '<td>₪' + num(r.median_ppsqm) + '</td>' +
            '<td>' + num(r.deals) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<p class="prices-note">' + num(c.deals) + ' עסקאות דירה ב' + escapeHtml(c.city) +
        ' בשנה האחרונה במאגר.</p>' +
        '</section>'
      );
    });
    return out.join('\n');
  }

  /* ‏Dataset ב-JSON-LD: מה הטבלה, מאיזה מקור ועל איזו תקופה - כך מנוע
     חיפוש ומנוע תשובות יכולים לצטט אותה עם המקור. */
  function jsonLd(rows, site) {
    var p = period(rows);
    var cities = groupCities(rows, []).map(function (c) { return c.city; });
    var data = {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'מחירי דירות לפי עיר ומספר חדרים',
      description: 'מחיר חציוני לדירה ולמטר רבוע לפי עיר ומספר חדרים, מתוך עסקאות הנדל״ן הרשמיות שדווחו לרשות המסים ב-12 החודשים האחרונים במאגר. תא עם פחות מ-5 עסקאות אינו מוצג.',
      url: site + '/prices',
      inLanguage: 'he',
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'שוק נדל״ן', url: site + '/' },
      isBasedOn: 'עסקאות נדל״ן שדווחו לרשות המסים',
      spatialCoverage: cities.map(function (c) { return { '@type': 'Place', name: c }; }),
      variableMeasured: ['מחיר חציוני לדירה (₪)', 'מחיר חציוני למ״ר (₪)', 'מספר עסקאות']
    };
    if (p && p.start && p.end) data.temporalCoverage = p.start + '/' + p.end;
    return JSON.stringify(data).replace(/</g, '\\u003c');
  }

  root.ShukPrices = {
    render: render,
    jsonLd: jsonLd,
    period: period,
    heDate: heDate,
    groupCities: groupCities,
    roomsLabel: roomsLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
