/* ============================================================================
   דף שכונה - ‏/n/{עיר}/{שכונה}
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן, כמו `assets/deals-render.js`: הקובץ נטען כ-
   `<script src>` בדף, **ומיובא** ב-`netlify/edge-functions/neighborhood-page.ts`
   לתופעת הלוואי שלו (‏`globalThis.ShukHood`). מה שהשרת מגיש לסורק ומה שהדפדפן
   בונה כשהשרת לא הספיק הם אותו HTML. ולכן אין כאן `export`.

   הנתונים מ-`neighborhood_page()` (‏20270728090000): הנכסים הפעילים, והעסקאות
   **בצבירה בלבד** - חציון של קבוצה מתחת ל-5 עסקאות כבר מושתק במסד. בלי
   רחוב, מספר בית, גוש וחלקה. ‏docs/neighborhood-pages.md.
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
  /* ‏תמונה רק מהאחסון שלנו - כתובת אחרת אינה נכנסת ל-src */
  var IMG_HOST = 'https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/';

  function num(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function money(n) { return n == null ? '-' : '₪' + num(n); }
  function monthYear(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  function roomsLabel(r) {
    if (r <= 3) return 'עד 3 חדרים';
    if (r >= 6) return '5.5 חדרים ומעלה';
    return r + ' חדרים';
  }

  /* ‏"/n/afula/גבעת-המורה" - כל חלק מקודד, כמו שהדפדפן שולח */
  function path(citySlug, slug) {
    return '/n/' + encodeURIComponent(citySlug) + '/' + encodeURIComponent(slug);
  }

  function title(d) {
    return 'שכונת ' + d.name + ', ' + d.city + ' - נכסים למכירה ולהשכרה ומחירי עסקאות';
  }

  function description(d) {
    var parts = [];
    if (d.props_active) parts.push(num(d.props_active) + (d.props_active === 1 ? ' נכס פעיל' : ' נכסים פעילים')
      + ' בשכונת ' + d.name + ' ב' + d.city);
    else parts.push('שכונת ' + d.name + ' ב' + d.city);
    if (d.deals && d.median_price != null) {
      parts.push(num(d.deals) + ' עסקאות שדווחו לרשות המסים בשנתיים האחרונות, מחיר חציוני ₪' + num(d.median_price)
        + (d.median_ppsqm != null ? ' ו-₪' + num(d.median_ppsqm) + ' למ״ר' : ''));
    }
    return parts.join('. ') + '. נכסים, מחירים ושכונות סמוכות.';
  }

  function card(label, value, note) {
    return '<div class="deals-card"><span class="deals-card-label">' + escapeHtml(label) + '</span>'
      + '<strong class="deals-card-value">' + escapeHtml(value) + '</strong>'
      + (note ? '<span class="deals-card-note">' + escapeHtml(note) + '</span>' : '')
      + '</div>';
  }

  function propCard(p) {
    var img = typeof p.image === 'string' && p.image.indexOf(IMG_HOST) === 0 ? p.image : '';
    var meta = [p.property_type, p.rooms ? p.rooms + ' חדרים' : '', p.size_sqm ? num(p.size_sqm) + ' מ״ר' : '']
      .filter(Boolean).join(' · ');
    return '<li><a class="hood-prop" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + (img ? '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.title || '') + '" loading="lazy" width="320" height="200">'
             : '<span class="hood-noimg" aria-hidden="true"></span>')
      + '<span class="hood-prop-body"><strong>' + escapeHtml(p.title || 'נכס') + '</strong>'
      + '<span>' + escapeHtml(meta) + '</span>'
      + '<b>' + escapeHtml(p.price ? money(p.price) + (p.deal_type === 'rent' ? ' לחודש' : '') : 'מחיר לפי פנייה') + '</b>'
      + '</span></a></li>';
  }

  /* התיאור שאושר בתיבת המשימות (‏about, ‏20270729090000). טקסט בלבד, מוברח -
     פסקה לכל שורה ריקה. טיוטה שלא אושרה אינה מגיעה לכאן בכלל. */
  function paras(t) {
    return String(t || '').split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean)
      .map(function (x) { return '<p>' + escapeHtml(x) + '</p>'; }).join('');
  }
  function about(d) {
    var a = d.about;
    if (!a || !a.intro) return '';
    var faq = Array.isArray(a.faq) ? a.faq : [];
    return '<section class="hood-about">' + paras(a.intro)
      + (a.fits ? '<h2>למי השכונה מתאימה</h2>' + paras(a.fits) : '')
      + (faq.length ? '<h2>שאלות נפוצות על ' + escapeHtml(d.name) + '</h2>'
          + faq.map(function (f) { return '<h3>' + escapeHtml(f.q) + '</h3><p>' + escapeHtml(f.a) + '</p>'; }).join('') : '')
      + '</section>';
  }

  /* הגוף: התיאור (כשאושר), מספרים, הנכסים, העסקאות לפי חדרים, ושכונות אחרות בעיר. */
  function render(d) {
    var html = about(d) + '<div class="deals-cards">'
      + card('נכסים פעילים', num(d.props_active),
          [d.props_sale ? num(d.props_sale) + ' למכירה' : '', d.props_rent ? num(d.props_rent) + ' להשכרה' : ''].filter(Boolean).join(' · '))
      + (d.sale_min ? card('טווח מחירים למכירה', money(d.sale_min) + ' - ' + money(d.sale_max)) : '')
      + (d.median_price != null ? card('מחיר עסקה חציוני', money(d.median_price), num(d.deals) + ' עסקאות בשנתיים') : '')
      + (d.median_ppsqm != null ? card('חציון למ״ר', money(d.median_ppsqm)) : '')
      + '</div>';

    var props = Array.isArray(d.props) ? d.props : [];
    if (props.length) {
      html += '<h2>נכסים בשכונה</h2><ul class="hood-props">' + props.map(propCard).join('') + '</ul>';
      if (d.props_active > props.length) {
        html += '<p class="deals-note"><a href="/?q=' + encodeURIComponent(d.name) + '">לכל ' + num(d.props_active)
          + ' הנכסים בשכונה ←</a></p>';
      }
    } else {
      html += '<p class="deals-note">אין כרגע נכסים פעילים בשכונה. <a href="/">לכל הנכסים באזור ←</a></p>';
    }

    var rows = Array.isArray(d.by_rooms) ? d.by_rooms : [];
    if (d.deals) {
      html += '<h2>מחירי עסקאות בשכונה</h2>'
        + '<p class="deals-note">' + escapeHtml(num(d.deals) + ' עסקאות למגורים שדווחו לרשות המסים'
          + (d.period_start && d.period_end ? ', ' + monthYear(d.period_start) + ' עד ' + monthYear(d.period_end) : '')
          + '. קבוצה עם פחות מ-5 עסקאות מוצגת בלי חציון.') + '</p>';
      if (rows.length) {
        html += '<div class="deals-scroll"><table class="deals-table deals-rooms"><thead><tr><th>חדרים</th><th>עסקאות</th>'
          + '<th>מחיר חציוני</th><th>חציון למ״ר</th></tr></thead><tbody>'
          + rows.map(function (r) {
              return '<tr><td>' + escapeHtml(roomsLabel(r.rooms)) + '</td><td>' + num(r.deals) + '</td>'
                + '<td class="deals-price">' + money(r.median_price) + '</td><td>' + money(r.median_ppsqm) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
      }
      if (d.city_slug) html += '<p class="deals-note"><a href="/deals/' + encodeURIComponent(d.city_slug) + '">כל העסקאות ב'
        + escapeHtml(d.city) + ' ←</a></p>';
    }

    var sib = Array.isArray(d.siblings) ? d.siblings : [];
    if (sib.length) {
      html += '<h2>שכונות נוספות ב' + escapeHtml(d.city) + '</h2><ul class="deals-index">'
        + sib.map(function (s) {
            return '<li><a href="' + escapeHtml(path(d.city_slug, s.slug)) + '"><strong>' + escapeHtml(s.name) + '</strong></a></li>';
          }).join('') + '</ul>';
    }
    return html;
  }

  /* ‏Place ו-BreadcrumbList. ‏`<` מוברח כדי ששם עם ‎</script>‎ לא יסגור את התגית. */
  function jsonLd(d, site) {
    var url = site + path(d.city_slug, d.slug);
    var graph = [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'שוק נדל״ן', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: d.city, item: site + '/deals/' + d.city_slug },
        { '@type': 'ListItem', position: 3, name: d.name, item: url }
      ] },
      { '@type': 'Place', name: 'שכונת ' + d.name + ', ' + d.city, url: url,
        containedInPlace: { '@type': 'City', name: d.city } }
    ];
    var faq = d.about && Array.isArray(d.about.faq) ? d.about.faq : [];
    if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map(function (f) {
      return { '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } };
    }) });
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  }

  root.ShukHood = { render: render, title: title, description: description, jsonLd: jsonLd, path: path };
})(typeof window !== 'undefined' ? window : globalThis);
