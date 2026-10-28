/* ============================================================================
   דף שכונה - /n/{עיר}/{שכונה}
   ----------------------------------------------------------------------------
   מקור אחד לשרת ולדפדפן, כמו assets/deals-render.js: הקובץ נטען כ-
   <script src> בדף, ומיובא ב-netlify/edge-functions/neighborhood-page.ts
   לתופעת הלוואי שלו (globalThis.ShukHood). אין כאן export.

   12 הכרטיסים הראשונים נכתבים ל-HTML. שאר הסינון רץ בדפדפן על הרשימה
   שב-textarea, בלי פרמטרים בכתובת. docs/neighborhood-pages.md.
   ========================================================================== */
(function (root) {
  /* עותק משלו ולא escapeHtml: הקובץ רץ גם בשרת, שם אין esc.js. לכן כל
     חמשת התווים (scripts/check_escapers.py). */
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
  var IMG_HOST = 'https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/';
  var ORIGIN = 'https://obookujgolazrwycsiyn.supabase.co';
  var COVER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

  function num(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function money(n) { return n == null || n === '' ? '' : '₪' + num(n); }
  function monthYear(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  function roomsLabel(r) {
    if (r <= 3) return 'עד 3 חדרים';
    if (r >= 6) return '5.5 חדרים ומעלה';
    return r + ' חדרים';
  }
  function path(citySlug, slug) {
    return '/n/' + encodeURIComponent(citySlug) + '/' + encodeURIComponent(slug);
  }

  /* "השכונה הצפון מערבית" כבר אומרת שכונה. "שכונת השכונה" הוא הכפילות. */
  function hoodLabel(name) {
    var n = String(name || '').trim();
    if (!n) return 'שכונה';
    if (/^(השכונה|שכונת|שכונה)(\s|$)/.test(n)) return n;
    return 'שכונת ' + n;
  }
  /* "הגעתי מהאתר" חייב להישאר במחרוזת הזו: check_bot_entry.py קורא
     משתנה שמסתיים ב-HELLO. hoodHello מרכיב ממנה את ההודעה שרצה. */
  var SITE_HELLO = 'שלום, הגעתי מהאתר, מדף ';
  /* העיר נשמטת רק כמילה שלמה: "יהוד" אינו בתוך "יהודה".
     גבול הוא התחלה, סוף, רווח, מקף, מקף עברי, גרש או גרשיים.
     קידומת בת אות אחת (ב או ה) עדיין נחשבת: "העפולה" ו"בעפולה". */
  function cityInLabel(label, city) {
    var c = String(city || '').trim();
    if (!c) return false;
    var esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var edge = '(?:^|[\\s\\-־׳״\'"])';
    var tail = '(?:$|[\\s\\-־׳״\'"])';
    return new RegExp(edge + '(?:[בה])?' + esc + tail).test(label);
  }
  /* "ב{עיר}" תמיד, אלא אם שם השכונה כבר מכיל את העיר כמילה, או שאין עיר. */
  function hoodPlace(name, city) {
    var label = hoodLabel(name);
    var c = String(city || '').trim();
    if (!c || cityInLabel(label, c)) return label;
    return label + ' ב' + c;
  }
  function hoodHello(name, city) {
    return SITE_HELLO + hoodPlace(name, city) + ', ואשמח לעזרה במציאת נכס';
  }
  function heading(d) { return hoodLabel(d.name) + (d.city ? ', ' + d.city : ''); }
  function inHood(name) {
    var n = String(name || '').trim();
    if (/^השכונה(\s|$)/.test(n)) return 'ב' + n.slice(1);
    if (/^(שכונת|שכונה)(\s|$)/.test(n)) return 'ב' + n;
    return 'בשכונת ' + n;
  }

  function title(d) {
    return heading(d) + ' - נכסים למכירה ולהשכרה ומחירי עסקאות';
  }
  function heroIntro(d) {
    var t = d.about && d.about.hero_intro != null ? String(d.about.hero_intro).replace(/\s+/g, ' ').trim() : '';
    return t;
  }
  /* מטא עד 180 תווים, על גבול מילה, בלי שלוש נקודות. */
  function clipMeta(s) {
    var t = String(s || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 180) return t;
    var cut = t.slice(0, 180);
    var sp = cut.lastIndexOf(' ');
    if (sp > 40) cut = cut.slice(0, sp);
    return cut.trim();
  }
  /* בלי מספרים שמשתנים: לא מלאי, לא מחיר ולא ספירת עסקאות. */
  function description(d) {
    var lead = heroIntro(d);
    if (lead) return clipMeta(lead);
    return clipMeta(hoodPlace(d.name, d.city) + ': נכסים למכירה ולהשכרה, מחירי עסקאות ומשרדים שפעילים בשכונה.');
  }
  function heroLead(d) {
    var lead = heroIntro(d);
    if (lead) return lead;
    var intro = d.about && d.about.intro ? String(d.about.intro).replace(/\s+/g, ' ').trim() : '';
    if (!intro) return description(d);
    return clipMeta(intro);
  }
  /* אחרי כ-120 מילים, בסוף משפט. השאר נשאר ב-HTML ומוסתר ב-CSS. */
  function splitIntro(text) {
    var src = String(text || '').trim();
    var re = /\S+/g;
    var count = 0;
    var cut = -1;
    var m;
    while ((m = re.exec(src))) {
      count++;
      if (count >= 120 && /[.!?]["'"״']?$/.test(m[0])) {
        cut = m.index + m[0].length;
        break;
      }
    }
    if (count <= 120) return { head: src, rest: '' };
    if (cut < 0) {
      var n = 0;
      re.lastIndex = 0;
      while ((m = re.exec(src))) {
        n++;
        if (n === 120) { cut = m.index + m[0].length; break; }
      }
    }
    if (cut < 0 || cut >= src.length) return { head: src, rest: '' };
    return { head: src.slice(0, cut).trim(), rest: src.slice(cut).trim() };
  }

  function renderUrl(url, w, h) {
    var marker = '/storage/v1/object/public/';
    var at = url.indexOf(marker);
    if (at < 0) return '';
    var p = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!p) return '';
    return url.slice(0, at) + '/storage/v1/render/image/public/' + p
      + '?width=' + w + '&height=' + h + '&resize=cover&quality=60';
  }

  function coverModel(d) {
    var p = String(d && d.cover_path || '').trim();
    if (!COVER_RE.test(p)) return null;
    var base = ORIGIN + '/storage/v1/render/image/public/neighborhood-covers/' + p;
    function u(w, h, fmt) {
      return base + '?width=' + w + '&height=' + h + '&resize=cover&quality=60' + (fmt ? '&format=' + fmt : '');
    }
    var src = u(800, 347, 'webp');
    return {
      src: src,
      srcset: src + ' 800w, ' + u(1200, 520, 'webp') + ' 1200w',
      jpg: u(800, 347, ''),
      full: ORIGIN + '/storage/v1/object/public/neighborhood-covers/' + p,
      og: u(1200, 630, ''),
      alt: String(d.cover_alt || '').trim(),
      credit: d.cover_credit || '',
    };
  }
  /* מחרוזת ישנה ("צילום: שם") או אובייקט {author, license, url}. */
  function creditHtml(raw) {
    if (typeof raw === 'string') {
      var t = raw.trim();
      return t ? 'צילום: ' + escapeHtml(t) : '';
    }
    if (!raw || typeof raw !== 'object') return '';
    var author = String(raw.author || '').trim();
    var license = String(raw.license || '').trim();
    var url = String(raw.url || '').trim();
    if (!/^https:\/\//i.test(url)) url = '';
    var bits = [];
    if (author) bits.push(escapeHtml(author));
    if (license) bits.push(escapeHtml(license));
    if (url) bits.push('<a href="' + escapeHtml(url) + '" rel="noopener noreferrer">קישור</a>');
    return bits.join(' · ');
  }
  function lcpHref(d) {
    var c = coverModel(d);
    if (c) return c.src;
    var props = Array.isArray(d.props) ? d.props : [];
    for (var i = 0; i < props.length; i++) {
      var img = props[i] && typeof props[i].image === 'string' && props[i].image.indexOf(IMG_HOST) === 0
        ? props[i].image : '';
      if (!img) continue;
      return renderUrl(img, 800, 500) || img;
    }
    return '';
  }
  /* בלי שער ה-LCP הוא הכותרת, לא כרטיס. preload של 800w מול srcset של 400w
     היה מוריד את התמונה הגדולה בלי שהיא ה-LCP. */
  function lcpPreload(d) {
    var c = coverModel(d);
    if (!c) return '';
    return '<link rel="preload" as="image" href="' + escapeHtml(c.src) + '" imagesrcset="'
      + escapeHtml(c.srcset) + '" imagesizes="100vw" fetchpriority="high">\n';
  }
  function ogImage(d) {
    var c = coverModel(d);
    return c ? c.og : '';
  }

  function propCard(p, eager) {
    var img = typeof p.image === 'string' && p.image.indexOf(IMG_HOST) === 0 ? p.image : '';
    var meta = [p.property_type, p.rooms ? p.rooms + ' חדרים' : '', p.size_sqm ? num(p.size_sqm) + ' מ״ר' : '']
      .filter(Boolean).join(' · ');
    var price = p.price ? money(p.price) + (p.deal_type === 'rent' ? ' לחודש' : '') : 'מחיר לפי פנייה';
    var pic = '<span class="hood-noimg"><img src="/assets/property-placeholder.jpg" alt="" width="320" height="200">'
      + '<span class="hood-nophoto"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
      + '<path fill="currentColor" d="M12 4 3 11h2v8h6v-5h2v5h6v-8h2L12 4z"></path></svg>תמונת הנכס</span></span>';
    if (img) {
      var pri = eager ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"';
      var small = renderUrl(img, 400, 250);
      var large = renderUrl(img, 800, 500);
      if (small && large) {
        pic = '<img src="' + escapeHtml(large) + '" srcset="' + escapeHtml(small) + ' 400w, ' + escapeHtml(large) + ' 800w"'
          + ' sizes="(min-width:900px) 320px, 50vw" alt="' + escapeHtml(p.title || '') + '"'
          + ' width="320" height="200"' + pri
          + ' data-full="' + escapeHtml(img) + '"'
          + ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')">';
      } else {
        pic = '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.title || '') + '" width="320" height="200"' + pri + '>';
      }
    }
    return '<li><a class="hood-prop" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + pic
      + '<span class="hood-prop-body"><strong>' + escapeHtml(p.title || 'נכס') + '</strong>'
      + '<span>' + escapeHtml(meta) + '</span>'
      + '<b>' + escapeHtml(price) + '</b>'
      + '</span></a></li>';
  }

  /* eagerFirst רק ב-SSR ובלי תמונת שער: אז הכרטיס הראשון הוא ה-LCP. */
  function resultsHtml(list, shown, eagerFirst, total) {
    var rows = Array.isArray(list) ? list : [];
    var n = Math.min(shown || rows.length, rows.length);
    var denom = rows.length;
    var extra = Number(total);
    if (isFinite(extra) && extra > denom) denom = Math.round(extra);
    var html = '<p class="hood-count">מציג ' + num(n) + ' מתוך ' + num(denom) + ' נכסים</p>';
    if (!rows.length) {
      return html + '<p class="hood-empty">אין נכסים שמתאימים לסינון. <button type="button" data-hood="clear">ניקוי הסינון</button></p>';
    }
    var firstPic = true;
    html += '<ul class="hood-props">' + rows.slice(0, n).map(function (p) {
      var own = p && typeof p.image === 'string' && p.image.indexOf(IMG_HOST) === 0;
      var eager = !!(eagerFirst && own && firstPic);
      if (eager) firstPic = false;
      return propCard(p, eager);
    }).join('') + '</ul>';
    if (n < rows.length) {
      html += '<p class="hood-more-wrap"><button type="button" class="hood-btn hood-btn-line" data-hood="more">עוד נכסים</button></p>';
    }
    return html;
  }

  function paras(t) {
    return String(t || '').split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean)
      .map(function (x) { return '<p>' + escapeHtml(x) + '</p>'; }).join('');
  }
  function aboutBlock(d) {
    var a = d.about;
    if (!a || !a.intro) return '';
    var parts = splitIntro(a.intro);
    var html = '<section class="hood-about"><h2>על השכונה</h2>'
      + '<div class="hood-about-clip" id="hoodAboutClip">' + paras(parts.head) + '</div>';
    if (parts.rest) {
      html += '<input type="checkbox" id="hoodAboutOpen" class="hood-about-toggle">'
        + '<div class="hood-about-rest">' + paras(parts.rest) + '</div>'
        + '<label class="hood-about-more" for="hoodAboutOpen"><span class="hood-read">להמשך קריאה ←</span><span class="hood-less">פחות</span></label>';
    }
    return html + poiHtml(d) + '</section>';
  }

  function poiHtml(d) {
    var poi = d.poi;
    if (!poi || typeof poi !== 'object') return '';
    var groups = [['parks', 'פארקים'], ['transport', 'תחבורה'], ['education', 'חינוך'], ['leisure', 'פנאי']];
    var html = '';
    groups.forEach(function (g) {
      var items = Array.isArray(poi[g[0]]) ? poi[g[0]] : [];
      var clean = [];
      items.forEach(function (x) {
        var t = String(x || '').trim();
        if (t && clean.length < 8) clean.push(t);
      });
      if (!clean.length) return;
      html += '<div class="hood-poi"><span class="hood-poi-k">' + g[1] + '</span>'
        + clean.map(function (x) { return '<span class="hood-chip">' + escapeHtml(x) + '</span>'; }).join('')
        + '</div>';
    });
    return html ? '<div class="hood-pois">' + html + '</div>' : '';
  }

  function fitsBlock(d) {
    var text = d.about && d.about.fits ? String(d.about.fits).trim() : '';
    if (!text) return '';
    var lines = text.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    var bullets = lines.length && lines.every(function (line) { return line.charAt(0) === '•'; });
    var inner = bullets
      ? '<ul class="hood-fits-list">' + lines.map(function (line) {
          return '<li>' + escapeHtml(line.replace(/^•\s*/, '')) + '</li>';
        }).join('') + '</ul>'
      : '<div class="hood-fit-prose">' + paras(text) + '</div>';
    return '<section class="hood-fits"><h2>למי השכונה מתאימה</h2>' + inner + '</section>';
  }

  function faqBlock(d) {
    var faq = d.about && Array.isArray(d.about.faq) ? d.about.faq : [];
    var rows = faq.filter(function (f) { return f && f.q && f.a; }).slice(0, 3);
    if (!rows.length) return '';
    return '<section class="hood-faq"><h2>שאלות נפוצות על ' + escapeHtml(hoodLabel(d.name)) + '</h2>'
      + '<div class="hood-faq-list">' + rows.map(function (f) {
        return '<details class="hood-faq-item"><summary><span class="hood-faq-plus" aria-hidden="true">+</span><span class="hood-faq-minus" aria-hidden="true">-</span><h3>' + escapeHtml(f.q) + '</h3></summary><p>'
          + escapeHtml(f.a) + '</p></details>';
      }).join('') + '</div></section>';
  }

  function withMoney(s) {
    return escapeHtml(s).replace(/₪[\d,]+/g, function (m) { return '<bdi dir="ltr">' + m + '</bdi>'; });
  }
  function kpi(label, value, note) {
    return '<div class="hood-kpi"><span class="hood-kpi-l">' + escapeHtml(label) + '</span>'
      + '<strong class="hood-kpi-v">' + (value ? withMoney(value) : 'אין נתון') + '</strong>'
      + (note ? '<span class="hood-kpi-n">' + withMoney(note) + '</span>' : '')
      + '</div>';
  }
  /* deals, median_price ו-median_ppsqm הם אותו חלון: 24 חודשים אחורה
     מהעסקה האחרונה (neighborhood_deal_stats_refresh, interval '24 months').
     "נכסים פעילים" הוא המלאי עכשיו, בלי חלון. אין לכתוב כאן "12 חודשים". */
  function kpis(d) {
    var saleNote = [d.props_sale ? num(d.props_sale) + ' למכירה' : '', d.props_rent ? num(d.props_rent) + ' להשכרה' : '']
      .filter(Boolean).join(' · ');
    return '<div class="hood-kpis">'
      + kpi('נכסים פעילים', num(d.props_active || 0), saleNote)
      + kpi('מחיר חציוני', d.median_price != null ? money(d.median_price) : '', '')
      + kpi('עסקאות · שנתיים', d.deals ? num(d.deals) : '', '')
      + kpi('חציון למ״ר', d.median_ppsqm != null ? money(d.median_ppsqm) : '', '')
      + '</div><p class="hood-kpi-src">מקור העסקאות: רשות המסים</p>';
  }

  /* vis בוליאני אומר שהעמודה כבר במסד. בלי זה המתג לא מסנן כלום. */
  function visAvailable(rows) {
    var list = Array.isArray(rows) ? rows : [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i] && list[i].vis;
      if (v === true || v === false) return true;
    }
    return false;
  }
  function filters(d) {
    var visBtn = visAvailable(catalog(d))
      ? '<button type="button" class="hood-switch" role="switch" data-hood="vis" aria-checked="false"><span class="hood-switch-ui" aria-hidden="true"></span>רק עם הדמיה</button>'
      : '';
    return '<div class="hood-filters" id="hoodFilters">'
      + '<div class="hood-seg" role="group" aria-label="סוג עסקה בשכונה">'
      + '<button type="button" data-hood="deal" data-v="" aria-pressed="true">הכל</button>'
      + '<button type="button" data-hood="deal" data-v="sale" aria-pressed="false">קנייה <span>' + num(d.props_sale || 0) + '</span></button>'
      + '<button type="button" data-hood="deal" data-v="rent" aria-pressed="false">שכירות <span>' + num(d.props_rent || 0) + '</span></button>'
      + '</div>'
      + '<div class="hood-tools">'
      + '<button type="button" data-hood="panel" data-v="filter" aria-expanded="false">סינון</button>'
      + '<button type="button" data-hood="panel" data-v="sort" aria-expanded="false">מיון: <span id="hoodSortLabel">מומלצים</span></button>'
      + '<button type="button" class="hood-view" data-hood="view" aria-pressed="false" aria-label="תצוגת רשת או רשימה">▦</button>'
      + '</div>'
      + '<div class="hood-panel" id="hoodFilterPanel" hidden>'
      + '<select data-hood="kind" aria-label="סוג נכס">'
      + '<option value="">כל הסוגים</option><option value="flats">דירות</option>'
      + '<option value="house">בתים</option><option value="land">מגרשים</option>'
      + '<option value="commercial">מסחרי</option></select>'
      + '<select data-hood="rooms" aria-label="חדרים">'
      + '<option value="0">חדרים</option><option value="2">2+</option><option value="3">3+</option>'
      + '<option value="4">4+</option><option value="5">5+</option></select>'
      + '<input data-hood="min" inputmode="numeric" placeholder="מ-" aria-label="ממחיר">'
      + '<input data-hood="max" inputmode="numeric" placeholder="עד" aria-label="עד מחיר">'
      + visBtn
      + '<button type="button" data-hood="clear">ניקוי</button>'
      + '</div>'
      + '<div class="hood-panel" id="hoodSortPanel" hidden>'
      + '<button type="button" data-hood="sort" data-v="default" aria-pressed="true">מומלצים</button>'
      + '<button type="button" data-hood="sort" data-v="new" aria-pressed="false">חדשים</button>'
      + '<button type="button" data-hood="sort" data-v="price-asc" aria-pressed="false">מחיר עולה</button>'
      + '<button type="button" data-hood="sort" data-v="price-desc" aria-pressed="false">מחיר יורד</button>'
      + '</div></div>';
  }

  function cta(d) {
    return '<section class="hood-cta" id="hoodCta">'
      + '<p class="hood-cta-k">גבריאלה · עוזרת החיפוש של שוק נדל״ן</p>'
      + '<h2>מחפשים ' + escapeHtml(inHood(d.name)) + '? גבריאלה תעזור למצוא</h2>'
      + '<span id="hoodBotSlot" data-hood-name="' + escapeHtml(d.name || '') + '" data-hood-city="' + escapeHtml(d.city || '') + '"></span>'
      + '</section>';
  }

  function dealsBlock(d) {
    var rows = Array.isArray(d.by_rooms) ? d.by_rooms : [];
    if (!d.deals) return '';
    var html = '<section class="hood-deals"><h2>מחירי עסקאות לפי חדרים</h2>'
      + '<p class="hood-note">' + escapeHtml(num(d.deals) + ' עסקאות למגורים שדווחו לרשות המסים'
        + (d.period_start && d.period_end ? ', ' + monthYear(d.period_start) + ' עד ' + monthYear(d.period_end) : '')
        + '. קבוצה עם פחות מ-5 עסקאות מוצגת בלי חציון.') + '</p>';
    if (rows.length) {
      html += '<div class="deals-scroll"><table class="deals-table deals-rooms"><thead><tr>'
        + '<th>חדרים</th><th>עסקאות</th><th><span class="hood-th-long">מחיר חציוני</span><span class="hood-th-short">מחיר</span></th>'
        + '<th><span class="hood-th-long">חציון למ״ר</span><span class="hood-th-short">למ״ר</span></th>'
        + '</tr></thead><tbody>'
        + rows.map(function (r) {
          return '<tr><td>' + escapeHtml(roomsLabel(r.rooms)) + '</td><td>' + num(r.deals) + '</td>'
            + '<td class="deals-price">' + escapeHtml(r.median_price == null ? '-' : money(r.median_price)) + '</td><td>'
            + escapeHtml(r.median_ppsqm == null ? '-' : money(r.median_ppsqm)) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (d.city_slug) html += '<p class="hood-note"><a href="/deals/' + encodeURIComponent(d.city_slug) + '">לכל העסקאות ב'
      + escapeHtml(d.city) + '</a></p>';
    return html + '</section>';
  }

  function officeName(s) {
    return String(s || '')
      .replace(/(\+?972|0)[\d\-\s]{7,}/g, '')
      .replace(/\S+@\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  /* אותיות בלבד. "r.b נכסים" הוא R ו-B, לא התו הראשון של כל מילה. */
  function initials(name) {
    var s = officeName(name);
    var letters = [];
    var words = s.split(/\s+/).filter(Boolean);
    for (var i = 0; i < words.length && letters.length < 2; i++) {
      var bits = words[i].split(/[^A-Za-z\u0590-\u05FF]+/).filter(Boolean);
      for (var j = 0; j < bits.length && letters.length < 2; j++) {
        var ch = bits[j].charAt(0);
        if (/[A-Za-z]/.test(ch)) ch = ch.toUpperCase();
        letters.push(ch);
      }
    }
    return letters.join('') || 'מ';
  }
  function agenciesBlock(d) {
    var list = Array.isArray(d.agencies) ? d.agencies : [];
    var cards = [];
    list.forEach(function (a) {
      if (!a || cards.length >= 8) return;
      var name = officeName(a.name);
      if (!name) return;
      var n = Number(a.n) || 0;
      var logo = typeof a.logo === 'string' && a.logo.indexOf(IMG_HOST) === 0 ? a.logo : '';
      var mark = logo
        ? '<img src="' + escapeHtml(logo) + '" alt="' + escapeHtml('לוגו ' + name) + '" width="56" height="56" loading="lazy" decoding="async" onerror="this.remove()">'
        : '';
      var count = n === 1 ? 'נכס אחד בשכונה' : num(n) + ' נכסים בשכונה';
      var inner = '<span class="hood-logo">' + mark + escapeHtml(initials(name)) + '</span>'
        + '<span class="hood-office-name">' + escapeHtml(name) + '</span>'
        + '<span class="hood-office-n">' + escapeHtml(count) + '</span>';
      var slug = String(a.slug || '').trim();
      cards.push(slug
        ? '<a class="hood-office" href="/agency?slug=' + encodeURIComponent(slug) + '">' + inner + '</a>'
        : '<div class="hood-office">' + inner + '</div>');
    });
    if (!cards.length) return '';
    return '<section class="hood-agencies"><h2>יועצי נדל״ן ומשרדים שפעילים בשכונה</h2>'
      + '<div class="hood-agencies-row">' + cards.join('') + '</div>'
      + '<p class="hood-note"><a href="/agencies">כל המשרדים</a></p></section>';
  }

  function nearby(d) {
    var sib = Array.isArray(d.siblings) ? d.siblings : [];
    if (!sib.length) return '';
    return '<section class="hood-nearby"><h2>שכונות סמוכות ב' + escapeHtml(d.city || '') + '</h2>'
      + '<div class="hood-near">' + sib.map(function (s) {
        var n = s.props != null ? ' <span>· ' + num(s.props) + '</span>' : '';
        return '<a href="' + escapeHtml(path(d.city_slug, s.slug)) + '">' + escapeHtml(s.name) + n + '</a>';
      }).join('') + '</div></section>';
  }

  function mapBlock(d) {
    var lat = Number(d.lat);
    var lng = Number(d.lng);
    var radius = Number(d.radius_m);
    var attrs = '';
    if (isFinite(lat) && isFinite(lng)) {
      attrs = ' data-lat="' + lat + '" data-lng="' + lng + '"'
        + (isFinite(radius) && radius > 0 ? ' data-radius="' + Math.round(radius) + '"' : '');
    }
    return '<div class="hood-map" id="hoodMap"' + attrs + '>'
      + '<div class="hood-map-ph" aria-hidden="true"><svg viewBox="0 0 400 220" width="400" height="220" preserveAspectRatio="xMidYMid slice">'
      + '<rect width="400" height="220" fill="#e7ebf3"></rect>'
      + '<path d="M120 48 L286 38 L312 148 L198 184 L104 150 Z" fill="rgba(14,42,107,.12)" stroke="#0e2a6b" stroke-width="2" stroke-dasharray="6 4"></path>'
      + '<circle cx="205" cy="110" r="7" fill="#c9a227" stroke="#fff" stroke-width="2"></circle>'
      + '</svg></div>'
      + '<span class="hood-map-cap">מפת השכונה · נטענת כשנכנסת למסך</span></div>';
  }

  function hero(d) {
    var c = coverModel(d);
    var h = '<h1 id="dealsH1">' + escapeHtml(heading(d)) + '</h1>'
      + '<p id="dealsLead">' + escapeHtml(heroLead(d)) + '</p>';
    var media = '';
    var caption = '';
    if (c) {
      var alt = c.alt || heading(d);
      media = '<img src="' + escapeHtml(c.src) + '" srcset="' + escapeHtml(c.srcset) + '" sizes="100vw"'
        + ' width="1200" height="520" alt="' + escapeHtml(alt) + '" fetchpriority="high" decoding="async"'
        + ' data-jpg="' + escapeHtml(c.jpg) + '" data-full="' + escapeHtml(c.full) + '"'
        + ' onerror="this.onerror=null;if(this.getAttribute(\'data-tried\')){this.remove();return;}this.setAttribute(\'data-tried\',\'1\');this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-jpg\')">';
      var credit = creditHtml(c.credit);
      if (credit) caption = '<figcaption class="hood-credit">' + credit + '</figcaption>';
      else if (c.alt) caption = '<figcaption class="hood-credit">' + escapeHtml(c.alt) + '</figcaption>';
    }
    return '<figure class="hood-figure">'
      + '<div class="hood-hero' + (c ? '' : ' hood-hero-empty') + '">' + media
      + '<div class="hood-hero-shade" aria-hidden="true"></div>'
      + '<div class="hood-hero-copy">' + h + '</div></div>'
      + caption + '</figure>';
  }

  function crumbs(d) {
    var cityHref = '/deals/' + encodeURIComponent(d.city_slug || '');
    return '<nav class="hood-crumbs" aria-label="פירורי לחם">'
      + '<a href="/">בית</a><span aria-hidden="true"> › </span>'
      + '<a href="' + escapeHtml(cityHref) + '">' + escapeHtml(d.city || '') + '</a>'
      + '<span aria-hidden="true"> › </span><span class="hood-crumbs-here">' + escapeHtml(hoodLabel(d.name)) + '</span>'
      + '</nav>';
  }

  function catalog(d) {
    if (Array.isArray(d.listings) && d.listings.length) return d.listings;
    return Array.isArray(d.props) ? d.props : [];
  }
  function publicListing(p) {
    var row = {
      id: p.id, title: p.title || '', property_type: p.property_type || '', deal_type: p.deal_type || '',
      price: p.price == null ? null : p.price, price_unit: p.price_unit || null,
      rooms: p.rooms == null ? null : p.rooms, size_sqm: p.size_sqm == null ? null : p.size_sqm,
      built_size_sqm: p.built_size_sqm == null ? null : p.built_size_sqm,
      image: typeof p.image === 'string' && p.image.indexOf(IMG_HOST) === 0 ? p.image : null,
      updated_at: p.updated_at || null, created_at: p.created_at || null,
    };
    if (p.vis === true || p.vis === false) row.vis = p.vis;
    return row;
  }
  function dataBlob(d, rows) {
    var json = JSON.stringify({
      listings: rows.map(publicListing),
      total: Number(d.props_active) || rows.length,
      id: d.id || null,
      city: d.city || '',
      slug: d.slug || '',
    }).replace(/&/g, '\\u0026').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return '<textarea id="hoodData" hidden readonly>' + json + '</textarea>';
  }

  function render(d) {
    var all = catalog(d);
    var cover = coverModel(d);
    var html = '<div class="hood-page">'
      + crumbs(d)
      + hero(d)
      + kpis(d)
      + '<div class="hood-layout"><div class="hood-main">'
      + filters(d)
      + '<div id="hoodResults"><h2>נכסים בשכונה</h2>' + resultsHtml(all, 12, !cover, d.props_active) + '</div>'
      + aboutBlock(d)
      + fitsBlock(d)
      + dealsBlock(d)
      + faqBlock(d)
      + '</div><aside class="hood-side">'
      + mapBlock(d)
      + cta(d)
      + agenciesBlock(d)
      + '</aside></div>'
      + nearby(d)
      + dataBlob(d, all)
      + '</div>';
    return html;
  }

  function jsonLd(d, site) {
    var url = site + path(d.city_slug, d.slug);
    var cityUrl = site + '/deals/' + encodeURIComponent(d.city_slug || '');
    var graph = [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'בית', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: d.city, item: cityUrl },
        { '@type': 'ListItem', position: 3, name: hoodLabel(d.name), item: url },
      ] },
      { '@type': 'Place', name: heading(d), url: url,
        containedInPlace: { '@type': 'City', name: d.city } },
    ];
    var c = coverModel(d);
    if (c) graph[1].image = c.full;
    var faq = d.about && Array.isArray(d.about.faq) ? d.about.faq.filter(function (f) { return f && f.q && f.a; }).slice(0, 3) : [];
    if (faq.length) graph.push({ '@type': 'FAQPage', mainEntity: faq.map(function (f) {
      return { '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } };
    }) });
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  }

  root.ShukHood = {
    render: render, title: title, description: description, jsonLd: jsonLd, path: path,
    lcpHref: lcpHref, lcpPreload: lcpPreload, ogImage: ogImage, heading: heading,
    hoodLabel: hoodLabel, hoodPlace: hoodPlace, hoodHello: hoodHello, visAvailable: visAvailable,
    resultsHtml: resultsHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
