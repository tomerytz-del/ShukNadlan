/* ============================================================================
   דפי נחיתה עיר → סוג נכס - /afula/בתים-פרטיים וחבריו
   ----------------------------------------------------------------------------
   מקור אחד לשרת ולדפדפן, כמו assets/neighborhood-render.js: הקובץ נטען
   כ-<script src> בדף, ומיובא ב-netlify/edge-functions/silo-page.ts לתופעת
   הלוואי שלו (globalThis.ShukSilo). מה שהשרת מגיש לסורק ומה שהדפדפן בונה
   כשהשרת לא הספיק הם אותו HTML. אין כאן export.

   שלושת הדפים האלה מחליפים כתובות סינון שגוגל כבר דירגה
   (?deal=sale&ptype=… ו-?deal=sale&rooms=3). search-pages.ts מפנה את
   ה-canonical שלהן לכאן. docs/search-landing-pages.md.

   אין כפתור שמירה: באתר אין שמירת נכס ציבורית, ולכן לא מוסיפים לב.
   ========================================================================== */
(function (root) {
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var IMG_HOST = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/";
  var SITE_NAME = "שוק נדל״ן";
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  /* ‏עיר לכל קידומת (‏/afula, ‏/haifa). ‏slug הוא cities.slug ו-/deals/{slug};
     ‏name הוא properties.city שהשאילתה מסננת עליו (מחרוזת, לא city_id);
     ‏market הוא ה-slug ב-assets/markets.js - דף של שוק שאינו live נשאר
     noindex ומחוץ ל-sitemap (‏lib/indexability.ts, ‏landingIndexable).
     ‏hoods הם [שם להצגה, slug] של neighborhoods, בסדר הא"ב; ‏near הם
     הצ'יפים שבמקום צ'יפ החדרים בדף 3 חדרים. השורה הראשונה של כל עיר
     נקראת ב-scripts/check_canonical.py, ולכן היא נשארת בשורה אחת.
     עיר חדשה: docs/search-landing-pages.md, "עיר נוספת". */
  var CITIES = [
    { slug: "afula", name: "עפולה", market: "afula-emek",
      cityId: "c2a8426f-7bac-4c48-bcb5-53a5ca06f001",
      home: "/",
      homeLabel: "עפולה והעמק",
      hoods: [
        ["אזור התעשייה", "אזור-התעשייה"],
        ["גבעת המורה", "גבעת-המורה"],
        ["דרום העיר", "דרום-העיר"],
        ["השכונה הצפון מערבית", "השכונה-הצפון-מערבית"],
        ["לב העמק C1", "לב-העמק-c1"],
        ["מזרח העיר", "מזרח-העיר"],
        ["מערב העיר (שיכון גאולים)", "מערב-העיר-שיכון-גאולים"],
        ["מרכז העיר", "מרכז-העיר"],
        ["עפולה הירוקה", "עפולה-הירוקה"],
        ["עפולה עלית", "עפולה-עלית"],
        ["רובע יזרעאל", "רובע-יזרעאל"],
      ],
      near: [["מרכז העיר", "מרכז-העיר"], ["רובע יזרעאל", "רובע-יזרעאל"], ["גבעת המורה", "גבעת-המורה"]],
    },
    /* ‏12 השכונות עם הכי הרבה עסקאות ב-market_deals_official (‏25.10.2026). */
    { slug: "haifa", name: "חיפה", market: "haifa",
      cityId: "751fcf13-a02b-4370-97a5-fc4ec42ea4fe",
      home: "/haifa",
      homeLabel: "חיפה והסביבה",
      hoods: [
        ["אחוזה", "אחוזה"],
        ["בת גלים", "בת-גלים"],
        ["גבעת זמר", "גבעת-זמר"],
        ["הדר מרכז", "הדר-מרכז"],
        ["הדר עליון", "הדר-עליון"],
        ["יזרעאליה", "יזרעאליה"],
        ["כרמל מערבי", "כרמל-מערבי"],
        ["מרכז הכרמל", "מרכז-הכרמל"],
        ["נווה שאנן", "נווה-שאנן"],
        ["קריית אליעזר", "קריית-אליעזר"],
        ["קריית חיים מזרחית", "קריית-חיים-מזרחית"],
        ["רמת הדר", "רמת-הדר"],
      ],
      near: [["נווה שאנן", "נווה-שאנן"], ["רמת הדר", "רמת-הדר"], ["הדר עליון", "הדר-עליון"]],
    },
  ];

  /* ‏סוגי הדפים. הטקסט נבנה מהעיר (‏at = "בעפולה"), ולכן עמוד חדש לעיר
     הוא שורה ב-CITIES בלבד. ה-slug נקרא ב-scripts/check_canonical.py. */
  var TYPES = [
    {
      slug: "בתים-פרטיים",
      what: "בתים פרטיים",
      benefit: "בתים וקוטג'ים פעילים מכל משרדי התיווך בעיר.",
      description: function (c) { return "בתים פרטיים וקוטג'ים למכירה " + c.at + ", מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה."; },
      intro: function (c) { return "בתים פרטיים וקוטג'ים שמוצעים עכשיו למכירה " + c.at + ", מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס."; },
      property_type: "בית פרטי/קוטג'",
      rooms: null,
    },
    {
      slug: "דירות-גן",
      what: "דירות גן",
      benefit: "דירות גן פעילות מכל משרדי התיווך בעיר.",
      description: function (c) { return "דירות גן למכירה " + c.at + ", מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה."; },
      intro: function (c) { return "דירות גן שמוצעות עכשיו למכירה " + c.at + ", מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס."; },
      property_type: "דירת גן",
      rooms: null,
    },
    {
      slug: "דירות-3-חדרים",
      what: "דירות 3 חדרים",
      benefit: "דירות 3 חדרים פעילות מכל משרדי התיווך בעיר.",
      description: function (c) { return "דירות 3 חדרים למכירה " + c.at + ", מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה."; },
      intro: function (c) { return "דירות של 3 חדרים שמוצעות עכשיו למכירה " + c.at + ", מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס."; },
      property_type: null,
      rooms: 3,
    },
  ];

  for (var ci = 0; ci < CITIES.length; ci++) CITIES[ci].at = "ב" + CITIES[ci].name;

  function brokersPath(c) { return "/" + c.slug + "/מתווכים"; }

  var PAGES = [];
  for (var cj = 0; cj < CITIES.length; cj++) {
    for (var tj = 0; tj < TYPES.length; tj++) {
      var c0 = CITIES[cj];
      var t0 = TYPES[tj];
      PAGES.push({
        slug: t0.slug,
        path: "/" + c0.slug + "/" + t0.slug,
        h1: t0.what + " למכירה " + c0.at,
        benefit: t0.benefit,
        description: t0.description(c0),
        intro: t0.intro(c0),
        property_type: t0.property_type,
        rooms: t0.rooms,
        city: c0.slug,
        cityName: c0.name,
        cityId: c0.cityId,
        market: c0.market,
      });
    }
  }

  function cityOf(page) {
    var slug = page && page.city ? page.city : "afula";
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].slug === slug) return CITIES[i];
    return CITIES[0];
  }

  function alsoOf(c) {
    var out = [];
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].city === c.slug) out.push([PAGES[i].path, PAGES[i].h1]);
    }
    out.push([brokersPath(c), "מתווכים " + c.at]);
    return out;
  }

  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function money(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return "";
    return "₪" + num(v);
  }
  function bdi(inner) { return "<bdi>" + inner + "</bdi>"; }
  /* רווח שנשאר בין מספר למילה גם כש-bdi מבודד את הכיוון. */
  function sp() { return '<span class="land-sp"> </span>'; }
  function countPhrase(n, one, many) {
    return bdi(num(n)) + sp() + (n === 1 ? one : many);
  }

  function decodePath(pathname) {
    var path = String(pathname || "").replace(/\/+$/, "") || "/";
    try { path = decodeURIComponent(path); } catch (e) { return ""; }
    return path;
  }

  function pageOf(pathname) {
    var path = decodePath(pathname);
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].path === path) return PAGES[i];
    return null;
  }

  function queryParts(page, select, limit) {
    var parts = [
      "select=" + select,
      "status=eq.active",
      "deal_type=eq.sale",
      "category=eq.residential",
      "city=eq." + encodeURIComponent(cityOf(page).name),
      "order=is_promoted.desc,created_at.desc",
      "limit=" + limit,
    ];
    if (page.property_type) parts.push("property_type=eq." + encodeURIComponent(page.property_type));
    if (page.rooms != null) parts.push("rooms=eq." + encodeURIComponent(String(page.rooms)));
    return parts.join("&");
  }

  function queryOf(page) {
    return queryParts(page, "id,title,price,rooms,size_sqm,property_type,deal_type,images,city,created_at,updated_at,features,sales_area,neighborhoods(name)", 24);
  }

  /* ספירת שכונות לאותו סוג בדיוק, לא לכל העיר. */
  function hoodCountQuery(page) {
    return queryParts(page, "sales_area,neighborhoods(name)", 1000);
  }

  function renderUrl(url, w, h, resize) {
    var marker = "/storage/v1/object/public/";
    var at = url.indexOf(marker);
    if (at < 0) return "";
    var path = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!path) return "";
    return url.slice(0, at) + "/storage/v1/render/image/public/" + path
      + "?width=" + w + "&height=" + h + "&resize=" + (resize || "cover") + "&quality=60";
  }

  function firstImage(p) {
    var imgs = p && p.images;
    if (typeof imgs === "string" && imgs.indexOf(IMG_HOST) === 0) return imgs;
    if (!Array.isArray(imgs)) return "";
    for (var i = 0; i < imgs.length; i++) {
      if (typeof imgs[i] === "string" && imgs[i].indexOf(IMG_HOST) === 0) return imgs[i];
    }
    return "";
  }

  function listOf(rows) { return Array.isArray(rows) ? rows : []; }

  function activeCount(rows, extras) {
    var list = listOf(rows);
    if (extras && extras.counted) return Number(extras.total) > 0 ? Number(extras.total) : 0;
    if (list.length > 0 && list.length < 24) return list.length;
    return 0;
  }

  function complete(rows, extras) {
    var list = listOf(rows);
    if (!list.length) return false;
    if (extras && extras.counted) return list.length === Number(extras.total);
    return list.length < 24;
  }

  function pricesOf(rows) {
    var out = [];
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var v = Number(list[i] && list[i].price);
      if (isFinite(v) && v > 0) out.push(v);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function median(rows) {
    var a = pricesOf(rows);
    if (!a.length) return 0;
    var mid = Math.floor(a.length / 2);
    if (a.length % 2) return a[mid];
    return Math.round((a[mid - 1] + a[mid]) / 2);
  }

  function featureList(p) {
    var f = p && p.features;
    if (Array.isArray(f)) return f;
    return [];
  }

  function isNew(p) {
    var t = Date.parse(p && p.created_at || "");
    if (!isFinite(t)) return false;
    var age = Date.now() - t;
    return age >= 0 && age < WEEK_MS;
  }

  function newCount(rows) {
    var n = 0;
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) if (isNew(list[i])) n++;
    return n;
  }

  function rowTime(p) {
    var u = Date.parse(p && p.updated_at || "");
    var c = Date.parse(p && p.created_at || "");
    if (!isFinite(u)) u = 0;
    if (!isFinite(c)) c = 0;
    return Math.max(u, c);
  }

  function shortDate(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var dd = String(d.getUTCDate()).padStart(2, "0");
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return dd + "." + mm + "." + d.getUTCFullYear();
  }

  function latestMs(rows) {
    var best = 0;
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var t = rowTime(list[i]);
      if (t > best) best = t;
    }
    return best;
  }

  function hoodName(p) {
    var n = p && p.neighborhoods;
    if (n && typeof n === "object" && n.name) return String(n.name);
    if (p && p.sales_area) return String(p.sales_area);
    return "";
  }

  /* ‏החיפוש של העיר: "/?…" בעפולה (שוק ברירת המחדל), "/haifa?…" בחיפה. */
  function qs(params, home) {
    var parts = [];
    var keys = ["deal", "ptype", "rooms", "maxPrice", "minPrice"];
    for (var i = 0; i < keys.length; i++) {
      var v = params[keys[i]];
      if (v == null || v === "") continue;
      parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
    }
    return (home || "/") + "?" + parts.join("&");
  }

  function searchHref(page, over) {
    var q = { deal: "sale" };
    if (page.property_type) q.ptype = page.property_type;
    if (page.rooms != null) q.rooms = String(page.rooms);
    if (over) {
      for (var k in over) q[k] = over[k];
    }
    return qs(q, cityOf(page).home);
  }

  function allHref(page) { return searchHref(page, null); }

  function chip(href, label, current) {
    return '<a href="' + escapeHtml(href) + '"' + (current ? ' aria-current="page"' : "") + ">" + label + "</a>";
  }

  function filters(page) {
    var html = '<nav class="land-filters" aria-label="סינון מהיר">';
    html += chip(searchHref(page, { deal: "sale" }), "<span>לקנייה</span>", true);
    html += chip(searchHref(page, { deal: "rent" }), "<span>להשכרה</span>", false);
    html += chip(searchHref(page, { maxPrice: "1000000" }), "<span>עד</span>" + bdi("1") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { maxPrice: "1500000" }), "<span>עד</span>" + bdi("1.5") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { maxPrice: "2500000" }), "<span>עד</span>" + bdi("2.5") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { minPrice: "2500000" }), "<span>מ-</span>" + bdi("2.5") + "<span>מיליון</span>", false);
    /* בדף 3 חדרים אין צ'יפ שמסמן את העמוד עצמו. במקומו שכונות. */
    var rooms = page.rooms === 3 ? [4, 5] : [3, 4, 5];
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      html += chip(searchHref(page, { rooms: String(r) }), bdi(String(r)) + "<span>חדרים</span>", false);
    }
    if (page.rooms === 3) {
      var c = cityOf(page);
      var near = c.near || [];
      for (var h = 0; h < near.length; h++) {
        html += chip("/n/" + c.slug + "/" + encodeURIComponent(near[h][1]), "<span>" + escapeHtml(near[h][0]) + "</span>", false);
      }
    }
    return html + "</nav>";
  }

  function chipsHtml(page, rows, extras) {
    var bits = [];
    var active = activeCount(rows, extras);
    if (active > 0) bits.push("<li>" + countPhrase(active, "מודעה פעילה", "מודעות פעילות") + "</li>");
    if (complete(rows, extras)) {
      var mid = median(rows);
      if (mid > 0) bits.push("<li>מחיר חציוני" + sp() + bdi(escapeHtml(money(mid))) + "</li>");
      var fresh = newCount(rows);
      if (fresh > 0) bits.push("<li>" + countPhrase(fresh, "חדש השבוע", "חדשים השבוע") + "</li>");
      else {
        var prices = pricesOf(rows);
        if (prices.length) {
          var lo = money(prices[0]);
          var hi = money(prices[prices.length - 1]);
          var range = lo === hi ? bdi(escapeHtml(lo)) : bdi(escapeHtml(lo)) + sp() + "-" + sp() + bdi(escapeHtml(hi));
          bits.push("<li>" + range + "</li>");
        }
      }
    }
    if (!bits.length) return "";
    return '<ul class="land-chips">' + bits.join("") + "</ul>";
  }

  function updatedHtml(rows) {
    var ms = latestMs(rows);
    var label = shortDate(ms);
    if (!label) return "";
    return "עודכן לאחרונה" + sp() + bdi(label);
  }

  /* תמונת השער היא תמונת העמק, לא תמונת המודעה החדשה.
     קולאז' ומסדרון חשוך לא ניתנים לזיהוי זול: הקבצים הם JPEG פרוגרסיבי,
     ובהירות ממוצעת של התמונות הבעייתיות היא רגילה (לא כהה). בלי זיהוי
     כזה לא שמים תמונת מודעה בשער. הרוחב ב-srcset הוא הרוחב האמיתי של
     הקבצים שכבר בריפו (640 ו-1920), בלי קובץ חדש. */
  function heroHtml() {
    /* בטלפון המקור בלי מתאר w, אחרת צפיפות המסך בוחרת את קובץ ה-1920 (כ-260KB)
       וה-LCP נפגע. ממסך רחב srcset עם הרוחב האמיתי ו-sizes=100vw. */
    return "<picture>"
      + '<source type="image/webp" media="(max-width: 759px)" srcset="assets/hero-valley-800.webp">'
      + '<source type="image/webp" srcset="assets/hero-valley-800.webp 640w, assets/hero-valley.webp 1920w" sizes="100vw">'
      + '<img src="assets/hero-valley-800.webp" alt="" width="640" height="768" fetchpriority="high" decoding="async">'
      + "</picture>";
  }

  function badge(p) {
    if (featureList(p).indexOf("price_dropped") >= 0) return '<span class="land-badge">ירד מחיר</span>';
    if (isNew(p)) return '<span class="land-badge">חדש</span>';
    return "";
  }

  function metaLine(p) {
    var bits = [];
    if (p.rooms) bits.push(bdi(escapeHtml(String(p.rooms))) + sp() + "חדרים");
    if (p.size_sqm && Number(p.size_sqm) > 0) bits.push(bdi(num(p.size_sqm)) + sp() + "מ״ר");
    var hood = hoodName(p);
    if (hood) bits.push(escapeHtml(hood));
    return bits.join(" · ");
  }

  var HOUSE_ICON = '<span class="land-ph" aria-hidden="true"><svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 22 24 8l18 14"/><path d="M12 20v18h24V20"/><path d="M20 38V28h8v10"/></svg></span>';

  function propCard(p) {
    var img = firstImage(p);
    var pic = HOUSE_ICON;
    if (img) {
      var small = renderUrl(img, 400, 250);
      var large = renderUrl(img, 800, 500);
      var alt = escapeHtml(p.title || "");
      if (small && large) {
        pic = '<img src="' + escapeHtml(large) + '" srcset="' + escapeHtml(small) + ' 400w, ' + escapeHtml(large) + ' 800w"'
          + ' sizes="(min-width:900px) 360px, (min-width:520px) 50vw, 100vw" alt="' + alt + '"'
          + ' width="320" height="200" loading="lazy" decoding="async"'
          + ' data-full="' + escapeHtml(img) + '"'
          + ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')">';
      } else {
        pic = '<img src="' + escapeHtml(img) + '" alt="' + alt + '" width="320" height="200" loading="lazy" decoding="async">';
      }
    }
    var meta = metaLine(p);
    return '<li><a class="land-card" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + '<span class="land-media">' + pic + badge(p) + "</span>"
      + '<span class="land-card-body">' + priceHtml(p)
      + (meta ? '<span class="land-meta">' + meta + "</span>" : "")
      + "<strong>" + escapeHtml(p.title || "נכס") + "</strong>"
      + "</span></a></li>";
  }

  function priceHtml(p) {
    var price = money(p.price);
    if (!price) return '<b class="land-price">מחיר לפי פנייה</b>';
    return '<b class="land-price">' + bdi(escapeHtml(price)) + "</b>";
  }

  function cards(rows) {
    var list = listOf(rows).slice(0, 9);
    if (!list.length) return "";
    var html = '<h2>מודעות פעילות</h2><ul class="land-grid">';
    for (var i = 0; i < list.length; i++) html += propCard(list[i]);
    return html + "</ul>";
  }

  function allButton(page, rows, extras) {
    var n = activeCount(rows, extras);
    if (!(n > 0)) return "";
    var label = n === 1 ? "<span>לנכס אחד</span>" : "<span>לכל</span>" + bdi(num(n)) + "<span>הנכסים</span>";
    return '<p class="land-more"><a class="land-btn land-btn-primary" data-land-cta data-count="' + n + '" href="'
      + escapeHtml(allHref(page)) + '">' + label + "</a></p>";
  }

  function relatedRows(rows, extras) {
    var seen = {};
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) seen[list[i].id] = 1;
    var src = (extras && extras.related) || [];
    var out = [];
    for (var j = 0; j < src.length && out.length < 9; j++) {
      var row = src[j];
      if (!row || !row.id || seen[row.id]) continue;
      if (row.deal_type == null && row.price == null && row.images == null && row.title == null) continue;
      seen[row.id] = 1;
      out.push(row);
    }
    return out;
  }

  function relatedHtml(page, rows, extras) {
    if (listOf(rows).length >= 3) return "";
    var rel = relatedRows(rows, extras);
    if (!rel.length) return "";
    var html = '<section class="land-related"><h2>עוד נכסים ' + escapeHtml(cityOf(page).at) + '</h2><ul class="land-grid">';
    for (var i = 0; i < rel.length; i++) html += propCard(rel[i]);
    return html + "</ul></section>";
  }

  function hoodRowsFromListings(rows, page) {
    var c = cityOf(page);
    var hoods = c.hoods;
    var counts = {};
    for (var i = 0; i < hoods.length; i++) counts[hoods[i][1]] = 0;
    var list = listOf(rows);
    for (var j = 0; j < list.length; j++) {
      var name = hoodName(list[j]);
      for (var h = 0; h < hoods.length; h++) {
        if (name === hoods[h][0]) {
          counts[hoods[h][1]]++;
          break;
        }
      }
    }
    var out = [];
    for (var k = 0; k < hoods.length; k++) {
      out.push({ path_key: c.slug + "/" + hoods[k][1], props: counts[hoods[k][1]] });
    }
    return out;
  }

  function hoodMap(extras, c) {
    var rows = extras && extras.hoods;
    if (!Array.isArray(rows) || !rows.length) return null;
    if (rows[0] == null || rows[0].path_key == null || rows[0].props == null) return null;
    var prefix = c.slug + "/";
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i].path_key || "");
      if (key.indexOf(prefix) !== 0) continue;
      var n = Number(rows[i].props);
      if (!isFinite(n)) continue;
      map[key.slice(prefix.length)] = n;
    }
    return map;
  }

  function neighborhoods(page, extras, requireMap) {
    var c = cityOf(page);
    var hoods = c.hoods;
    var map = hoodMap(extras, c);
    if (requireMap && !map) return "";
    var items = [];
    for (var i = 0; i < hoods.length; i++) {
      var count = map ? map[hoods[i][1]] : null;
      if (map && typeof count === "number" && count <= 0) continue;
      if (map && count == null) count = null;
      items.push({ name: hoods[i][0], slug: hoods[i][1], count: count });
    }
    if (map) {
      items.sort(function (a, b) {
        var ac = typeof a.count === "number" ? a.count : -1;
        var bc = typeof b.count === "number" ? b.count : -1;
        if (ac !== bc) return bc - ac;
        return a.name.localeCompare(b.name, "he");
      });
    }
    if (!items.length) return "";
    var html = "<h2>שכונות " + escapeHtml(c.at) + '</h2><ul class="land-hoods">';
    for (var h = 0; h < items.length; h++) {
      html += '<li><a class="land-hood" href="/n/' + c.slug + "/" + encodeURIComponent(items[h].slug) + '"><span>'
        + escapeHtml(items[h].name) + "</span>";
      if (typeof items[h].count === "number" && items[h].count > 0) html += bdi(num(items[h].count));
      html += "</a></li>";
    }
    return html + "</ul>";
  }

  function agencyList(extras) {
    var list = extras && extras.agencies;
    if (!Array.isArray(list) || !list.length) return [];
    if (list[0] == null || list[0].slug == null || list[0].name == null) return [];
    return list;
  }

  function trust(page, rows, extras) {
    var c = cityOf(page);
    var offices = agencyList(extras);
    var logos = [];
    for (var i = 0; i < offices.length; i++) {
      var url = offices[i].logo_url;
      if (typeof url === "string" && url.indexOf(IMG_HOST) === 0) logos.push(offices[i]);
    }
    var stat = "";
    var at = escapeHtml(c.at);
    if (offices.length > 0) stat = countPhrase(offices.length, "משרד פעיל " + at, "משרדים פעילים " + at);
    else {
      var active = activeCount(rows, extras);
      if (active > 0) stat = countPhrase(active, "מודעה פעילה " + at, "מודעות פעילות " + at);
    }
    if (!stat && !offices.length) return "";
    var head = offices.length
      ? countPhrase(offices.length, "משרד תיווך פעיל " + at, "משרדי תיווך פעילים " + at)
      : stat;
    if (!head) return "";
    var strip = "";
    if (logos.length >= 4) {
      strip = '<ul class="land-logos">';
      for (var j = 0; j < logos.length && j < 12; j++) {
        var src = renderUrl(logos[j].logo_url, 144, 144, "contain") || logos[j].logo_url;
        strip += '<li><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(logos[j].name || "משרד תיווך")
          + '" width="72" height="72" loading="lazy" decoding="async"></li>';
      }
      strip += "</ul>";
    }
    return '<section class="land-trust"><h2>' + head + "</h2>" + strip
      + '<p><a href="' + escapeHtml(brokersPath(c)) + '">מתווכים ' + at + "</a></p></section>";
  }

  function seo(page) {
    var c = cityOf(page);
    var at = escapeHtml(c.at);
    return '<section class="land-seo"><h2>על הרשימה</h2>'
      + "<p>" + escapeHtml(page.intro) + "</p>"
      + "<p>המודעות הן נכסים פעילים " + at + " שמשרדי התיווך מפרסמים באתר. המחיר והמפרט המלא נמצאים בדף של כל נכס. "
      + 'להשוואת עסקאות שדווחו לרשות המסים: <a href="/deals/' + c.slug + '">עסקאות ' + at + "</a>, ולמחירי דירות לפי חדרים: "
      + '<a href="/prices">מחירי דירות</a>.</p></section>';
  }

  function faqs(page) {
    var at = cityOf(page).at;
    return [
      ["מאיפה המודעות בעמוד הזה?", "אלה נכסים פעילים " + at + " שמשרדי התיווך מפרסמים באתר. הרשימה כוללת את המשרדים בעיר."],
      ["האם המחיר שמופיע הוא המחיר הסופי?", "המחיר והמפרט המלא נמצאים בדף של כל נכס. אם אין מחיר במודעה, הוא לפי פנייה."],
      ["איפה רואים עסקאות ומחירי דירות?", "עסקאות שדווחו לרשות המסים נמצאות בעמוד העסקאות " + at + ", ומחירי דירות לפי חדרים בעמוד מחירי הדירות."],
      ["מה עושים כשאין מודעות בקטגוריה?", "אפשר להשאיר התראה דרך החיפוש השמור שכבר באתר, ולקבל עדכון כשעולה נכס שמתאים."],
    ];
  }

  function faqHtml(page) {
    var rows = faqs(page);
    var html = '<section class="land-faq"><h2>שאלות נפוצות</h2>';
    for (var i = 0; i < rows.length; i++) {
      html += "<details><summary>" + escapeHtml(rows[i][0]) + "</summary><p>" + escapeHtml(rows[i][1]) + "</p></details>";
    }
    return html + "</section>";
  }

  function also(page) {
    var c = cityOf(page);
    var list = alsoOf(c);
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < list.length; i++) {
      if (list[i][0] === page.path) continue;
      html += '<a href="' + escapeHtml(list[i][0]) + '">' + escapeHtml(list[i][1]) + "</a>";
    }
    html += '<a href="' + escapeHtml(c.home) + '">' + escapeHtml(c.homeLabel) + "</a>";
    return html + "</nav></section>";
  }

  function finalCta() {
    return '<section class="land-final"><h2>רוצים לשמוע כשעולה נכס מתאים?</h2>'
      + "<p>נעדכן אתכם ברגע שיעלה נכס שמתאים.</p>"
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></section>';
  }

  function emptyState() {
    return '<div class="land-empty"><p>אין כרגע מודעות פעילות בקטגוריה הזו.</p>'
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></div>';
  }

  function render(page, rows, extras) {
    var list = listOf(rows);
    var html = filters(page);
    html += list.length ? cards(list) : emptyState();
    html += relatedHtml(page, list, extras);
    html += allButton(page, list, extras);
    html += neighborhoods(page, extras);
    html += trust(page, list, extras);
    html += seo(page);
    html += also(page);
    html += faqHtml(page);
    html += finalCta();
    return html;
  }

  function ld(obj) {
    return JSON.stringify(obj).replace(/</g, "\\u003c");
  }

  function jsonLd(page, rows, site) {
    var url = site + page.path;
    var list = listOf(rows);
    var web = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.h1,
      url: url,
      description: page.description,
      inLanguage: "he",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: site + "/" },
    };
    var crumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "דף הבית", item: site + "/" },
        { "@type": "ListItem", position: 2, name: cityOf(page).name, item: site + cityOf(page).home },
        { "@type": "ListItem", position: 3, name: page.h1, item: url },
      ],
    };
    var items = [];
    for (var i = 0; i < list.length; i++) {
      items.push({
        "@type": "ListItem",
        position: i + 1,
        name: String(list[i].title || "נכס"),
        url: site + "/property?id=" + encodeURIComponent(list[i].id),
      });
    }
    var itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: page.h1,
      numberOfItems: items.length,
      itemListElement: items,
    };
    var qa = faqs(page);
    var main = [];
    for (var q = 0; q < qa.length; q++) {
      main.push({
        "@type": "Question",
        name: qa[q][0],
        acceptedAnswer: { "@type": "Answer", text: qa[q][1] },
      });
    }
    var faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: main };
    return [web, crumbs, itemList, faq];
  }

  function scripts(page, rows, site) {
    return jsonLd(page, rows, site).map(function (obj) {
      return '<script type="application/ld+json">' + ld(obj) + "</script>";
    }).join("\n");
  }

  root.ShukSilo = {
    pages: PAGES,
    cities: CITIES,
    cityOf: cityOf,
    brokersPath: brokersPath,
    countedNeighborhoods: function (rows, page) { return neighborhoods(page, { hoods: rows }, true); },
    pageOf: pageOf,
    queryOf: queryOf,
    hoodCountQuery: hoodCountQuery,
    hoodRowsFromListings: hoodRowsFromListings,
    render: render,
    heroHtml: heroHtml,
    chipsHtml: chipsHtml,
    updatedHtml: updatedHtml,
    allHref: allHref,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function (page) { return page.h1 + " | " + SITE_NAME; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
