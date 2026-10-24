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
   ========================================================================== */
(function (root) {
  /* עותק משלו ולא escapeHtml: הקובץ רץ גם בשרת, שם אין esc.js. לכן כל
     חמשת התווים (scripts/check_escapers.py). */
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

  /* שכונות עפולה שיש להן דף /n/. הקישור כאן הוא <a href> ב-HTML הראשון,
     לא רשימה שנבנית רק אחרי שהדפדפן רץ. */
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
      h1: "בתים פרטיים למכירה בעפולה",
      description: "בתים פרטיים וקוטג'ים למכירה בעפולה, מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה.",
      intro: "בתים פרטיים וקוטג'ים שמוצעים עכשיו למכירה בעפולה, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס.",
      property_type: "בית פרטי/קוטג'",
      rooms: null,
    },
    {
      slug: "דירות-גן",
      path: "/afula/דירות-גן",
      h1: "דירות גן למכירה בעפולה",
      description: "דירות גן למכירה בעפולה, מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה.",
      intro: "דירות גן שמוצעות עכשיו למכירה בעפולה, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס.",
      property_type: "דירת גן",
      rooms: null,
    },
    {
      slug: "דירות-3-חדרים",
      path: "/afula/דירות-3-חדרים",
      h1: "דירות 3 חדרים למכירה בעפולה",
      description: "דירות 3 חדרים למכירה בעפולה, מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה.",
      intro: "דירות של 3 חדרים שמוצעות עכשיו למכירה בעפולה, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות, עם קישור לדף הנכס.",
      property_type: null,
      rooms: 3,
    },
  ];

  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function money(n) { return n == null || n === "" ? "" : "₪" + num(n); }

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

  /* שאילתת PostgREST. אותה שאילתה בשרת ובדפדפן, כדי שמילוי חירום
     אחרי 503 יצייר את אותה רשימה. */
  function queryOf(page) {
    var parts = [
      "select=id,title,price,rooms,size_sqm,property_type,deal_type,images,city",
      "status=eq.active",
      "deal_type=eq.sale",
      "category=eq.residential",
      "city=eq." + encodeURIComponent("עפולה"),
      "order=is_promoted.desc,created_at.desc",
      "limit=24",
    ];
    if (page.property_type) parts.push("property_type=eq." + encodeURIComponent(page.property_type));
    if (page.rooms != null) parts.push("rooms=eq." + encodeURIComponent(String(page.rooms)));
    return parts.join("&");
  }

  function renderUrl(url, w, h) {
    var marker = "/storage/v1/object/public/";
    var at = url.indexOf(marker);
    if (at < 0) return "";
    var path = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!path) return "";
    return url.slice(0, at) + "/storage/v1/render/image/public/" + path
      + "?width=" + w + "&height=" + h + "&resize=cover&quality=60";
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

  function propCard(p, eager) {
    var img = firstImage(p);
    var meta = [p.property_type, p.rooms ? p.rooms + " חדרים" : "", p.size_sqm ? num(p.size_sqm) + " מ״ר" : ""]
      .filter(Boolean).join(" · ");
    var pic = '<span class="hood-noimg" aria-hidden="true"></span>';
    if (img) {
      var pri = eager ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"';
      var small = renderUrl(img, 400, 250);
      var large = renderUrl(img, 800, 500);
      var alt = escapeHtml(p.title || "");
      if (small && large) {
        pic = '<img src="' + escapeHtml(large) + '" srcset="' + escapeHtml(small) + ' 400w, ' + escapeHtml(large) + ' 800w"'
          + ' sizes="(min-width:900px) 320px, 100vw" alt="' + alt + '"'
          + ' width="320" height="200"' + pri
          + ' data-full="' + escapeHtml(img) + '"'
          + ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')">';
      } else {
        pic = '<img src="' + escapeHtml(img) + '" alt="' + alt + '" width="320" height="200"' + pri + ">";
      }
    }
    var price = money(p.price);
    return '<li><a class="hood-prop" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + pic
      + '<span class="hood-prop-body"><strong>' + escapeHtml(p.title || "נכס") + "</strong>"
      + "<span>" + escapeHtml(meta) + "</span>"
      + "<b>" + escapeHtml(price || "מחיר לפי פנייה") + "</b>"
      + "</span></a></li>";
  }

  function links(page) {
    var html = '<nav class="silo-links" aria-label="עוד בעפולה">'
      + '<a href="/">עפולה והעמק</a>'
      + '<a href="/deals/afula">עסקאות בעפולה</a>'
      + '<a href="/prices">מחירי דירות בעפולה</a>';
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].path === page.path) continue;
      html += '<a href="' + escapeHtml(PAGES[i].path) + '">' + escapeHtml(PAGES[i].h1) + "</a>";
    }
    html += "</nav>";
    html += "<h2>שכונות בעפולה</h2><nav class=\"silo-links\" aria-label=\"שכונות בעפולה\">";
    for (var h = 0; h < HOODS.length; h++) {
      html += '<a href="/n/afula/' + encodeURIComponent(HOODS[h][1]) + '">' + escapeHtml(HOODS[h][0]) + "</a>";
    }
    return html + "</nav>";
  }

  function render(page, rows) {
    var list = Array.isArray(rows) ? rows : [];
    var html = '<p class="silo-intro">' + escapeHtml(page.intro) + "</p>" + links(page);
    if (!list.length) {
      return html + '<p class="deals-note">אין כרגע מודעות פעילות בקטגוריה הזו. <a href="/">לכל הנכסים בעפולה והעמק</a></p>';
    }
    var firstPic = true;
    html += "<h2>מודעות פעילות</h2><ul class=\"hood-props\">";
    for (var i = 0; i < list.length; i++) {
      var own = !!firstImage(list[i]);
      var eager = !!(own && firstPic);
      if (eager) firstPic = false;
      html += propCard(list[i], eager);
    }
    html += "</ul>";
    return html;
  }

  function ld(obj) {
    return JSON.stringify(obj).replace(/</g, "\\u003c");
  }

  function jsonLd(page, rows, site) {
    var url = site + page.path;
    var list = Array.isArray(rows) ? rows : [];
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
    return [web, crumbs, itemList];
  }

  function scripts(page, rows, site) {
    return jsonLd(page, rows, site).map(function (obj) {
      return '<script type="application/ld+json">' + ld(obj) + "</script>";
    }).join("\n");
  }

  root.ShukSilo = {
    pages: PAGES,
    hoods: HOODS,
    pageOf: pageOf,
    queryOf: queryOf,
    render: render,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function (page) { return page.h1 + " | " + SITE_NAME; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
