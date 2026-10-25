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
  var CITY_ID = "c2a8426f-7bac-4c48-bcb5-53a5ca06f001";
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  var HOODS = [
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
  ];

  var PAGES = [
    {
      slug: "בתים-פרטיים",
      path: "/afula/בתים-פרטיים",
      h1: "בית פרטי למכירה בעפולה",
      benefit: "בתים פרטיים, בתי קרקע וקוטג'ים מכל משרדי התיווך בעיר.",
      description: "בית פרטי למכירה בעפולה: בתים פרטיים, בתי קרקע וקוטג'ים מכל משרדי התיווך, כולל עפולה עילית, עם מחיר, גודל ותמונות.",
      intro: "בית פרטי למכירה בעפולה כולל כאן גם בית קרקע וגם קוטג'. אלה בתים למכירה מכל משרדי התיווך בעיר, כולל עפולה עילית וגבעת המורה, עם מחיר, גודל ותמונות.",
      property_type: "בית פרטי/קוטג'",
      rooms: null,
    },
    {
      slug: "דירות-גן",
      path: "/afula/דירות-גן",
      h1: "דירות גן למכירה בעפולה",
      benefit: "דירות עם גינה ממשרדי התיווך בעיר.",
      description: "דירות גן למכירה בעפולה, מכל משרדי התיווך בעיר: דירה עם גינה פרטית, עם מחיר, גודל ותמונות לכל מודעה פעילה.",
      intro: "דירות גן למכירה בעפולה הן דירות עם גינה, בדרך כלל בקומת קרקע, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות.",
      property_type: "דירת גן",
      rooms: null,
    },
    {
      slug: "דירות-3-חדרים",
      path: "/afula/דירות-3-חדרים",
      h1: "דירות 3 חדרים למכירה בעפולה",
      benefit: "דירות 3 חדרים פעילות מכל משרדי התיווך בעיר.",
      description: "דירות 3 חדרים למכירה בעפולה, מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה.",
      intro: "דירות של 3 חדרים שמוצעות עכשיו למכירה בעפולה, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות.",
      property_type: null,
      rooms: 3,
    },
  ];

  var ALSO = [
    ["/afula/בתים-פרטיים", "בתים פרטיים למכירה בעפולה"],
    ["/afula/דירות-גן", "דירות גן למכירה בעפולה"],
    ["/afula/דירות-3-חדרים", "דירות 3 חדרים למכירה בעפולה"],
    ["/afula/מתווכים", "מתווכים בעפולה"],
  ];

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
      "city=eq." + encodeURIComponent("עפולה"),
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

  function qs(params) {
    var parts = [];
    var keys = ["deal", "ptype", "rooms", "maxPrice", "minPrice"];
    for (var i = 0; i < keys.length; i++) {
      var v = params[keys[i]];
      if (v == null || v === "") continue;
      parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
    }
    return "/?" + parts.join("&");
  }

  function searchHref(page, over) {
    var q = { deal: "sale" };
    if (page.property_type) q.ptype = page.property_type;
    if (page.rooms != null) q.rooms = String(page.rooms);
    if (over) {
      for (var k in over) q[k] = over[k];
    }
    return qs(q);
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
      var near = [["מרכז העיר", "מרכז-העיר"], ["רובע יזרעאל", "רובע-יזרעאל"], ["גבעת המורה", "גבעת-המורה"]];
      for (var h = 0; h < near.length; h++) {
        html += chip("/n/afula/" + encodeURIComponent(near[h][1]), "<span>" + escapeHtml(near[h][0]) + "</span>", false);
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

  /* תמונת שער לפי סוג הנכס. המפה אחת, כדי שעיר או סוג חדשים ישתמשו בה.
     סוג לא מוכר נופל לתמונת העמק. לא שמים תמונת מודעה בשער: קולאז' ומסדרון
     חשוך לא ניתנים לזיהוי זול. הרוחב ב-srcset הוא הרוחב האמיתי של הקובץ
     (אצל העמק 640 ו-1920, אצל השאר 800 ו-1600). מקור ורישיון: assets/hero-images.md. */
  var VALLEY_HERO = {
    mobile: "assets/hero-valley-800.webp",
    desktop: "assets/hero-valley.webp",
    mobileW: 640,
    desktopW: 1920,
    width: 640,
    height: 768,
    ogW: 1920,
    ogH: 1072,
  };
  var HEROES = {
    "בתים-פרטיים": {
      mobile: "assets/hero-house-800.webp",
      desktop: "assets/hero-house-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
    },
    "דירות-גן": {
      mobile: "assets/hero-garden-800.webp",
      desktop: "assets/hero-garden-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
    },
    "דירות-3-חדרים": {
      mobile: "assets/hero-apt-800.webp",
      desktop: "assets/hero-apt-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
    },
  };

  function heroOf(page) {
    if (page && HEROES[page.slug]) return HEROES[page.slug];
    return VALLEY_HERO;
  }

  function heroHtml(page) {
    var h = heroOf(page);
    /* בטלפון המקור בלי מתאר w, אחרת צפיפות המסך בוחרת את הקובץ הרחב. */
    return "<picture>"
      + '<source type="image/webp" media="(max-width: 759px)" srcset="' + h.mobile + '">'
      + '<source type="image/webp" srcset="' + h.mobile + " " + h.mobileW + "w, " + h.desktop + " " + h.desktopW + 'w" sizes="100vw">'
      + '<img src="' + h.mobile + '" alt="" width="' + h.width + '" height="' + h.height + '" fetchpriority="high" decoding="async">'
      + "</picture>";
  }

  function heroPreload(page) {
    var h = heroOf(page);
    return '<link rel="preload" as="image" href="' + h.mobile + '" media="(max-width: 759px)" fetchpriority="high">\n'
      + '<link rel="preload" as="image" href="' + h.desktop + '" media="(min-width: 760px)" fetchpriority="high">';
  }

  function heroOg(page) {
    var h = heroOf(page);
    return { src: h.desktop, width: h.ogW, height: h.ogH };
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

  function relatedHtml(rows, extras) {
    if (listOf(rows).length >= 3) return "";
    var rel = relatedRows(rows, extras);
    if (!rel.length) return "";
    var html = '<section class="land-related"><h2>עוד נכסים בעפולה</h2><ul class="land-grid">';
    for (var i = 0; i < rel.length; i++) html += propCard(rel[i]);
    return html + "</ul></section>";
  }

  function hoodRowsFromListings(rows) {
    var counts = {};
    for (var i = 0; i < HOODS.length; i++) counts[HOODS[i][1]] = 0;
    var list = listOf(rows);
    for (var j = 0; j < list.length; j++) {
      var name = hoodName(list[j]);
      for (var h = 0; h < HOODS.length; h++) {
        if (name === HOODS[h][0]) {
          counts[HOODS[h][1]]++;
          break;
        }
      }
    }
    var out = [];
    for (var k = 0; k < HOODS.length; k++) {
      out.push({ path_key: "afula/" + HOODS[k][1], props: counts[HOODS[k][1]] });
    }
    return out;
  }

  function hoodMap(extras) {
    var rows = extras && extras.hoods;
    if (!Array.isArray(rows) || !rows.length) return null;
    if (rows[0] == null || rows[0].path_key == null || rows[0].props == null) return null;
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i].path_key || "");
      if (key.indexOf("afula/") !== 0) continue;
      var n = Number(rows[i].props);
      if (!isFinite(n)) continue;
      map[key.slice("afula/".length)] = n;
    }
    return map;
  }

  function neighborhoods(extras, requireMap) {
    var map = hoodMap(extras);
    if (requireMap && !map) return "";
    var items = [];
    for (var i = 0; i < HOODS.length; i++) {
      var count = map ? map[HOODS[i][1]] : null;
      if (map && typeof count === "number" && count <= 0) continue;
      if (map && count == null) count = null;
      items.push({ name: HOODS[i][0], slug: HOODS[i][1], count: count });
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
    var html = '<h2>שכונות בעפולה</h2><ul class="land-hoods">';
    for (var h = 0; h < items.length; h++) {
      html += '<li><a class="land-hood" href="/n/afula/' + encodeURIComponent(items[h].slug) + '"><span>'
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

  function trust(rows, extras) {
    var offices = agencyList(extras);
    var logos = [];
    for (var i = 0; i < offices.length; i++) {
      var url = offices[i].logo_url;
      if (typeof url === "string" && url.indexOf(IMG_HOST) === 0) logos.push(offices[i]);
    }
    var stat = "";
    if (offices.length > 0) stat = countPhrase(offices.length, "משרד פעיל בעפולה", "משרדים פעילים בעפולה");
    else {
      var active = activeCount(rows, extras);
      if (active > 0) stat = countPhrase(active, "מודעה פעילה בעפולה", "מודעות פעילות בעפולה");
    }
    if (!stat && !offices.length) return "";
    var head = offices.length
      ? countPhrase(offices.length, "משרד תיווך פעיל בעפולה", "משרדי תיווך פעילים בעפולה")
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
      + '<p><a href="/afula/מתווכים">מתווכים בעפולה</a></p></section>';
  }

  function kindPhrase(page, n) {
    if (page.slug === "בתים-פרטיים") {
      return n === 1 ? "בית פרטי למכירה בעפולה" : "בתים פרטיים למכירה בעפולה";
    }
    if (page.slug === "דירות-גן") {
      return n === 1 ? "דירת גן למכירה בעפולה" : "דירות גן למכירה בעפולה";
    }
    if (page.rooms === 3) {
      return n === 1 ? "דירת 3 חדרים למכירה בעפולה" : "דירות 3 חדרים למכירה בעפולה";
    }
    return n === 1 ? "מודעה פעילה" : "מודעות פעילות";
  }

  /* ספירה רק כשיש מספר אמיתי. טווח מחיר של הרשימה המלאה, או של מה שנטען
     בעמוד כשהשאילתה נחתכה. בלי טווח מומצא כשאין מחירים. */
  function marketHtml(page, rows, extras) {
    var n = activeCount(rows, extras);
    var prices = pricesOf(rows);
    if (!(n > 0) && !prices.length) return "";
    var bits = [];
    if (n > 0) bits.push("כרגע יש " + countPhrase(n, kindPhrase(page, 1), kindPhrase(page, n)));
    if (prices.length) {
      var lo = money(prices[0]);
      var hi = money(prices[prices.length - 1]);
      var scope = complete(rows, extras) ? "במודעות הפעילות" : "במודעות שמוצגות כאן";
      var range = lo === hi
        ? bdi(escapeHtml(lo))
        : "מ-" + bdi(escapeHtml(lo)) + " עד " + bdi(escapeHtml(hi));
      bits.push(scope + " המחיר " + (lo === hi ? "הוא " : "נע ") + range);
    }
    return bits.join(". ");
  }

  function focusHoods(page) {
    if (page.slug !== "בתים-פרטיים" && page.slug !== "דירות-גן") return "";
    return "<p>שכונות בעפולה: "
      + '<a href="/n/afula/עפולה-עלית">עפולה עילית</a>, '
      + '<a href="/n/afula/גבעת-המורה">גבעת המורה</a>, '
      + '<a href="/n/afula/מרכז-העיר">מרכז העיר</a>, '
      + '<a href="/n/afula/רובע-יזרעאל">רובע יזרעאל</a>. '
      + 'משרדי התיווך: <a href="/afula/מתווכים">מתווכים בעפולה</a> '
      + 'ו<a href="/agencies">רשימת המשרדים</a>.</p>';
  }

  function seo(page, rows, extras) {
    var market = marketHtml(page, rows, extras);
    return '<section class="land-seo"><h2>על הרשימה</h2>'
      + "<p>" + escapeHtml(page.intro) + "</p>"
      + (market ? "<p>" + market + "</p>" : "")
      + focusHoods(page)
      + "<p>המודעות הן נכסים למכירה בעפולה שמשרדי התיווך מפרסמים באתר. המחיר והמפרט המלא נמצאים בדף של כל נכס. "
      + 'להשוואת עסקאות שדווחו לרשות המסים: <a href="/deals/afula">עסקאות בעפולה</a>, ולמחירי דירות לפי חדרים: '
      + '<a href="/prices">מחירי דירות</a>.</p></section>';
  }

  function faqs(page) {
    var extra = [];
    if (page && page.slug === "בתים-פרטיים") {
      extra = [
        ["מה נכלל בבית פרטי למכירה בעפולה?", "בעמוד הזה מופיעים בתים פרטיים, בתי קרקע וקוטג'ים למכירה בעפולה, כולל בעפולה עילית. המודעות מתפרסמות על ידי משרדי תיווך."],
        ["יש הבדל בין בית פרטי, בית קרקע וקוטג'?", "בית קרקע הוא בית על מגרש. קוטג' הוא סוג של בית פרטי, ולעתים בית דו-משפחתי. בדף הנכס מופיע המפרט שפורסם במודעה."],
        ["אפשר לקנות בית בעפולה בלי תיווך?", "המודעות בעמוד הזה מתפרסמות על ידי משרדי תיווך. מוכר פרטי לא מפרסם כאן בעצמו."],
      ];
    } else if (page && page.slug === "דירות-גן") {
      extra = [
        ["מהי דירת גן למכירה בעפולה?", "דירת גן היא דירה עם גינה פרטית, בדרך כלל בקומת קרקע. בעמוד הזה מופיעות דירות גן פעילות למכירה בעפולה, מכל משרדי התיווך."],
        ["במה דירת גן שונה מבית פרטי?", "דירת גן היא דירה בבניין, עם גינה. בית פרטי הוא בית על מגרש. שטח הגינה מופיע במודעה כשהוא מפורסם."],
        ["המחיר של דירת גן כולל את הגינה?", "המחיר והשטחים הם מה שפורסם במודעה. הפירוט המלא נמצא בדף הנכס."],
      ];
    }
    return extra.concat([
      ["מאיפה המודעות בעמוד הזה?", "אלה נכסים למכירה בעפולה שמשרדי התיווך מפרסמים באתר."],
      ["האם המחיר שמופיע הוא המחיר הסופי?", "המחיר והמפרט המלא נמצאים בדף של כל נכס. אם אין מחיר במודעה, הוא לפי פנייה."],
      ["איפה רואים עסקאות ומחירי דירות?", "עסקאות שדווחו לרשות המסים נמצאות בעמוד העסקאות בעפולה, ומחירי דירות לפי חדרים בעמוד מחירי הדירות."],
      ["מה עושים אם אין כרגע מודעות?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס שמתאים."],
    ]);
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
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < ALSO.length; i++) {
      if (ALSO[i][0] === page.path) continue;
      html += '<a href="' + escapeHtml(ALSO[i][0]) + '">' + escapeHtml(ALSO[i][1]) + "</a>";
    }
    html += '<a href="/">עפולה והעמק</a>';
    return html + "</nav></section>";
  }

  function finalCta() {
    return '<section class="land-final"><h2>רוצים לשמוע כשעולה נכס מתאים?</h2>'
      + "<p>נעדכן אתכם ברגע שיעלה נכס שמתאים.</p>"
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></section>';
  }

  function emptyState() {
    return '<div class="land-empty"><p>אין כרגע מודעות פעילות.</p>'
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></div>';
  }

  function render(page, rows, extras) {
    var list = listOf(rows);
    var html = filters(page);
    html += list.length ? cards(list) : emptyState();
    html += relatedHtml(list, extras);
    html += allButton(page, list, extras);
    html += neighborhoods(extras);
    html += trust(list, extras);
    html += seo(page, rows, extras);
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
        { "@type": "ListItem", position: 2, name: "עפולה", item: site + "/" },
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
    hoods: HOODS,
    countedNeighborhoods: function (rows) { return neighborhoods({ hoods: rows }, true); },
    cityId: CITY_ID,
    pageOf: pageOf,
    queryOf: queryOf,
    hoodCountQuery: hoodCountQuery,
    hoodRowsFromListings: hoodRowsFromListings,
    render: render,
    heroHtml: heroHtml,
    heroPreload: heroPreload,
    heroOg: heroOg,
    chipsHtml: chipsHtml,
    updatedHtml: updatedHtml,
    allHref: allHref,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function (page) { return page.h1 + " | " + SITE_NAME; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
