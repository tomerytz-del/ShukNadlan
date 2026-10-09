/* ============================================================================
   עסקאות נדל"ן לפי יישוב - ‏/deals ו-/deals/{slug}
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן, כמו `assets/prices-render.js`: הקובץ נטען כ-
   `<script src>` בדף, **ומיובא** ב-`netlify/edge-functions/deals-page.ts`
   לתופעת הלוואי שלו (‏`globalThis.ShukDeals`). כך מה שהשרת מגיש לסורק ומה
   שהדפדפן בונה כשהשרת לא הספיק הם אותו HTML. ולכן אין כאן `export`.

   הנתונים מ-`deal_settlement_page()` ומ-`deal_settlements_public()`
   (‏20270329090000). חציון של קבוצה מתחת ל-5 עסקאות כבר מושתק במסד, ובעסקה
   אין מספר בית, גוש וחלקה. ‏docs/settlement-deals.md.
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

  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי',
                'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  function num(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function money(n) {
    return n == null ? '-' : '₪' + num(n);
  }

  /* 2026-08-13 → 13.8.2026 */
  function heDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? (+m[3]) + '.' + (+m[2]) + '.' + m[1] : '';
  }

  /* 2026-10-09T12:00:00Z → אוקטובר 2026 */
  function monthYear(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }

  function roomsLabel(r) {
    if (r <= 3) return 'עד 3 חדרים';
    if (r >= 6) return '5.5 חדרים ומעלה';
    return r + ' חדרים';
  }

  function title(d) {
    var when = monthYear(d && d.updated_at);
    return 'עסקאות נדל״ן ב' + d.name + (when ? ' - ' + when : '');
  }

  function description(d) {
    if (!d.deals) return 'עסקאות הנדל״ן שדווחו לרשות המסים ב' + d.name + ', לפי GovMap.';
    return d.deals.toLocaleString('en-US') + ' עסקאות נדל״ן למגורים ב' + d.name
      + ' ב-12 החודשים האחרונים במאגר'
      + (d.median_price != null ? ', מחיר חציוני ₪' + num(d.median_price) : '')
      + (d.median_ppsqm != null ? ' ו-₪' + num(d.median_ppsqm) + ' למ״ר' : '')
      + '. לפי מספר חדרים, ועסקאות אחרונות - מתוך דיווחי רשות המסים.';
  }

  function card(label, value, note) {
    return '<div class="deals-card"><span class="deals-card-label">' + escapeHtml(label) + '</span>'
      + '<strong class="deals-card-value">' + escapeHtml(value) + '</strong>'
      + (note ? '<span class="deals-card-note">' + escapeHtml(note) + '</span>' : '')
      + '</div>';
  }

  /* מיון העסקאות. המפתחות הם גם ערכי ה-select וגם data-sort בכותרות. */
  var SORTS = {
    date_desc:  function (a, b) { return a.sold_at < b.sold_at ? 1 : a.sold_at > b.sold_at ? -1 : 0; },
    date_asc:   function (a, b) { return a.sold_at < b.sold_at ? -1 : a.sold_at > b.sold_at ? 1 : 0; },
    price_desc: function (a, b) { return (b.sale_price || 0) - (a.sale_price || 0); },
    price_asc:  function (a, b) { return (a.sale_price || 0) - (b.sale_price || 0); },
    ppsqm_desc: function (a, b) { return (b.ppsqm || 0) - (a.ppsqm || 0); },
    ppsqm_asc:  function (a, b) { return (a.ppsqm || 0) - (b.ppsqm || 0); },
    rooms_desc: function (a, b) { return (b.rooms || 0) - (a.rooms || 0); },
    rooms_asc:  function (a, b) { return (a.rooms || 0) - (b.rooms || 0); },
    area_desc:  function (a, b) { return (b.size_sqm || 0) - (a.size_sqm || 0); },
    area_asc:   function (a, b) { return (a.size_sqm || 0) - (b.size_sqm || 0); }
  };

  function sortRows(rows, key) {
    return (rows || []).slice().sort(SORTS[key] || SORTS.date_desc);
  }

  /* ‏רחוב ושכונה בלבד - בלי מספר בית (‏docs/property-address-privacy.md). */
  function place(r) {
    var parts = [];
    if (r.street) parts.push(r.street);
    if (r.neighborhood) parts.push(r.neighborhood);
    return parts.length ? parts.join(', ') : 'לא צוין';
  }

  function recentRows(rows) {
    return rows.map(function (r) {
      return '<tr>'
        + '<td data-label="תאריך">' + escapeHtml(heDate(r.sold_at)) + '</td>'
        + '<td data-label="רחוב">' + escapeHtml(place(r)) + '</td>'
        + '<td data-label="סוג">' + escapeHtml(r.property_type || 'דירה') + '</td>'
        + '<td data-label="חדרים">' + escapeHtml(r.rooms != null ? r.rooms : '-') + '</td>'
        + '<td data-label="קומה">' + escapeHtml(r.floor || '-') + '</td>'
        + '<td data-label="מ״ר">' + escapeHtml(r.size_sqm != null ? num(r.size_sqm) : '-') + '</td>'
        + '<td data-label="מחיר" class="deals-price">' + escapeHtml(money(r.sale_price)) + '</td>'
        + '<td data-label="למ״ר">' + escapeHtml(money(r.ppsqm)) + '</td>'
        + '</tr>';
    }).join('');
  }

  function th(label, key) {
    return '<th scope="col"><button type="button" class="deals-sort" data-sort="' + key + '">'
      + escapeHtml(label) + '</button></th>';
  }

  /* ‏HTML של דף יישוב: כרטיסים, חציון לפי חדרים, עסקאות אחרונות ומקור. */
  function renderSettlement(d) {
    if (!d || !d.name) return '';
    var out = [];
    var period = d.period_start && d.period_end
      ? heDate(d.period_start) + ' - ' + heDate(d.period_end) : '';

    out.push('<div class="deals-cards">'
      + card('עסקאות ב-12 חודשים', num(d.deals), period)
      + card('מחיר חציוני', money(d.median_price), d.median_price == null ? 'פחות מ-5 עסקאות' : '')
      + card('מחיר חציוני למ״ר', money(d.median_ppsqm), '')
      + '</div>');

    var rooms = d.by_rooms || [];
    if (rooms.length) {
      out.push('<h2>מחיר חציוני לפי מספר חדרים</h2>'
        + '<div class="deals-scroll"><table class="deals-table deals-rooms">'
        + '<thead><tr><th scope="col">גודל</th><th scope="col">עסקאות</th>'
        + '<th scope="col">מחיר חציוני</th><th scope="col">מחיר למ״ר</th></tr></thead><tbody>'
        + rooms.map(function (r) {
            return '<tr><th scope="row">' + escapeHtml(roomsLabel(r.rooms)) + '</th>'
              + '<td>' + num(r.deals) + '</td>'
              + '<td>' + escapeHtml(r.median_price == null ? 'מעט מדי עסקאות' : money(r.median_price)) + '</td>'
              + '<td>' + escapeHtml(r.median_ppsqm == null ? '-' : money(r.median_ppsqm)) + '</td></tr>';
          }).join('')
        + '</tbody></table></div>');
    }

    var recent = sortRows(d.recent, 'date_desc');
    if (recent.length) {
      out.push('<h2>עסקאות אחרונות</h2>'
        + '<div class="deals-toolbar"><label for="dealsSort">מיון:</label> '
        + '<select id="dealsSort">'
        + '<option value="date_desc">החדשות קודם</option>'
        + '<option value="price_desc">המחיר הגבוה קודם</option>'
        + '<option value="price_asc">המחיר הנמוך קודם</option>'
        + '<option value="ppsqm_desc">מחיר למ״ר - גבוה קודם</option>'
        + '<option value="ppsqm_asc">מחיר למ״ר - נמוך קודם</option>'
        + '<option value="area_desc">השטח הגדול קודם</option>'
        + '</select></div>'
        + '<div class="deals-scroll"><table class="deals-table deals-recent" id="dealsRecent">'
        + '<thead><tr>' + th('תאריך', 'date') + '<th scope="col">רחוב</th><th scope="col">סוג</th>'
        + th('חדרים', 'rooms') + '<th scope="col">קומה</th>' + th('מ״ר', 'area')
        + th('מחיר', 'price') + th('למ״ר', 'ppsqm') + '</tr></thead>'
        + '<tbody>' + recentRows(recent) + '</tbody></table></div>'
        + '<p class="deals-note">' + num(recent.length) + ' העסקאות האחרונות למגורים. הכתובת מוצגת ברמת רחוב, בלי מספר בית.</p>');
    } else {
      out.push('<p class="deals-note">אין עדיין עסקאות למגורים ביישוב הזה במאגר.</p>');
    }

    out.push('<p class="deals-source">מקור: רשות המסים, דרך GovMap.</p>');
    return out.join('\n');
  }

  /* ‏HTML של האינדקס /deals. */
  function renderIndex(list) {
    var rows = (list || []).filter(function (s) { return s && s.slug && s.name; });
    if (!rows.length) return '';
    return '<ul class="deals-index">' + rows.map(function (s) {
      return '<li><a href="/deals/' + encodeURIComponent(s.slug) + '">'
        + '<strong>' + escapeHtml(s.name) + '</strong>'
        + '<span>' + (s.deals ? num(s.deals) + ' עסקאות במאגר' : 'אין עדיין עסקאות')
        + (s.newest ? ' · עד ' + escapeHtml(heDate(s.newest)) : '') + '</span>'
        + '</a></li>';
    }).join('') + '</ul>';
  }

  function crumbs(site, d) {
    var items = [
      { '@type': 'ListItem', position: 1, name: 'שוק נדל״ן', item: site + '/' },
      { '@type': 'ListItem', position: 2, name: 'עסקאות נדל״ן', item: site + '/deals' }
    ];
    if (d) items.push({ '@type': 'ListItem', position: 3, name: d.name, item: site + '/deals/' + d.slug });
    return { '@type': 'BreadcrumbList', itemListElement: items };
  }

  /* ‏Dataset ו-BreadcrumbList. ‏`<` מוברח כדי ששם יישוב עם ‎</script>‎ לא
     יסגור את התגית. */
  function jsonLd(d, site) {
    var graph = [crumbs(site, d)];
    if (d) {
      var data = {
        '@type': 'Dataset',
        name: 'עסקאות נדל״ן ב' + d.name,
        description: description(d),
        url: site + '/deals/' + d.slug,
        inLanguage: 'he',
        isAccessibleForFree: true,
        creator: { '@type': 'Organization', name: 'שוק נדל״ן', url: site + '/' },
        isBasedOn: 'עסקאות נדל״ן שדווחו לרשות המסים, דרך GovMap',
        spatialCoverage: { '@type': 'Place', name: d.name },
        variableMeasured: ['מחיר עסקה (₪)', 'מחיר למ״ר (₪)', 'מספר חדרים', 'שטח (מ״ר)']
      };
      if (d.period_start && d.period_end) data.temporalCoverage = d.period_start + '/' + d.period_end;
      if (d.updated_at) data.dateModified = String(d.updated_at).slice(0, 10);
      graph.push(data);
    }
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  }

  root.ShukDeals = {
    renderSettlement: renderSettlement,
    renderIndex: renderIndex,
    recentRows: recentRows,
    sortRows: sortRows,
    title: title,
    description: description,
    jsonLd: jsonLd,
    heDate: heDate,
    monthYear: monthYear
  };
})(typeof window !== 'undefined' ? window : globalThis);
