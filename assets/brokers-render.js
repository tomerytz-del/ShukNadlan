/* ============================================================================
   מתווכים בעפולה - /afula/מתווכים
   ----------------------------------------------------------------------------
   מקור אחד לשרת ולדפדפן, כמו assets/neighborhood-render.js. הקובץ נטען
   כ-<script src> ומיובא ב-brokers-page.ts (globalThis.ShukBrokers).
   docs/afula-brokers.md.
   אין כפתור שמירה: באתר אין שמירת נכס ציבורית.
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

  var PATH = "/afula/מתווכים";
  var H1 = "מתווכים בעפולה";
  var BENEFIT = "משרדים ומתווכים עם רישיון בתוקף, והמלאי הפעיל של כל משרד.";
  var DESCRIPTION = "משרדי תיווך ומתווכים בעפולה, עם המלאי הפעיל של כל משרד וקישור לדף שלו.";
  var INTRO = "משרדי התיווך בעפולה והמתווכים שפועלים בהם. לכל משרד דף עם המלאי, ולכל מתווך/ת דף עם הרישיון והנכסים.";
  var CITY_ID = "c2a8426f-7bac-4c48-bcb5-53a5ca06f001";
  var IMG_HOST = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/";
  var ALSO = [
    ["/afula/בתים-פרטיים", "בתים פרטיים למכירה בעפולה"],
    ["/afula/דירות-גן", "דירות גן למכירה בעפולה"],
    ["/afula/דירות-3-חדרים", "דירות 3 חדרים למכירה בעפולה"],
  ];

  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function bdi(inner) { return "<bdi>" + inner + "</bdi>"; }
  function countPhrase(n, one, many) { return bdi(num(n)) + " " + (n === 1 ? one : many); }

  function pageOf(pathname) {
    var path = String(pathname || "").replace(/\/+$/, "") || "/";
    try { path = decodeURIComponent(path); } catch (e) { return null; }
    return path === PATH ? { path: PATH, h1: H1, benefit: BENEFIT, description: DESCRIPTION, intro: INTRO } : null;
  }

  function agencyQuery() {
    return "select=id,slug,name,address,tagline,logo_url&city_id=eq." + CITY_ID
      + "&order=name.asc&limit=200";
  }

  function renderUrl(url, resize) {
    var marker = "/storage/v1/object/public/";
    var at = url.indexOf(marker);
    if (at < 0) return "";
    var path = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!path) return "";
    return url.slice(0, at) + "/storage/v1/render/image/public/" + path
      + "?width=144&height=144&resize=" + (resize || "contain") + "&quality=60";
  }

  function logo(url, alt) {
    if (typeof url !== "string" || url.indexOf(IMG_HOST) !== 0) {
      return '<span class="land-logo-ph" aria-hidden="true"></span>';
    }
    var src = renderUrl(url) || url;
    return '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" width="72" height="72" loading="lazy" decoding="async"'
      + ' data-full="' + escapeHtml(url) + '"'
      + ' onerror="this.onerror=null;this.src=this.getAttribute(\'data-full\')">';
  }

  function officeCard(a) {
    var bits = [];
    if (a.address) bits.push(escapeHtml(a.address));
    else bits.push("עפולה");
    if (a.active_count) bits.push(bdi(num(a.active_count)) + " נכסים פעילים");
    if (a.tagline) bits.push(escapeHtml(a.tagline));
    return '<li><a class="land-card land-office" href="/agency?slug=' + encodeURIComponent(a.slug) + '">'
      + logo(a.logo_url, a.name || "")
      + '<span class="land-card-body"><strong>' + escapeHtml(a.name || "משרד תיווך") + "</strong>"
      + "<span>" + bits.join(" · ") + "</span>"
      + "</span></a></li>";
  }

  function chip(href, label) {
    return '<a href="' + escapeHtml(href) + '">' + label + "</a>";
  }

  function filters() {
    return '<nav class="land-filters" aria-label="סינון מהיר">'
      + chip("/?deal=sale", "לקנייה")
      + chip("/?deal=rent", "להשכרה")
      + chip("/?deal=sale&maxPrice=1500000", "עד 1.5 מיליון")
      + chip("/?deal=sale&maxPrice=2500000", "עד 2.5 מיליון")
      + chip("/?deal=sale&minPrice=2500000", "מ-2.5 מיליון")
      + chip("/?deal=sale&rooms=3", bdi("3") + " חדרים")
      + chip("/?deal=sale&rooms=4", bdi("4") + " חדרים")
      + chip("/?deal=sale&rooms=5", bdi("5") + " חדרים")
      + "</nav>";
  }

  function listingSum(agencies) {
    var n = 0;
    for (var i = 0; i < agencies.length; i++) n += Number(agencies[i].active_count) || 0;
    return n;
  }

  function chipsHtml(data) {
    var agencies = (data && data.agencies) || [];
    var bits = [];
    var listings = listingSum(agencies);
    if (listings > 0) bits.push("<li>" + countPhrase(listings, "מודעה פעילה", "מודעות פעילות") + "</li>");
    if (agencies.length > 0) bits.push("<li>" + countPhrase(agencies.length, "משרד פעיל", "משרדים פעילים") + "</li>");
    if (!bits.length) return "";
    return '<ul class="land-chips">' + bits.join("") + "</ul>";
  }

  function neighborhoods(data) {
    var S = root.ShukSilo;
    if (!S || typeof S.countedNeighborhoods !== "function") return "";
    return S.countedNeighborhoods((data && data.hoods) || null);
  }

  function trust(agencies) {
    if (!agencies.length) return "";
    var logos = [];
    for (var i = 0; i < agencies.length; i++) {
      if (typeof agencies[i].logo_url === "string" && agencies[i].logo_url.indexOf(IMG_HOST) === 0) logos.push(agencies[i]);
    }
    var stat = '<p class="land-stat">' + countPhrase(agencies.length, "משרד פעיל בעפולה", "משרדים פעילים בעפולה") + "</p>";
    if (logos.length < 4) return '<section class="land-trust"><h2>בעפולה</h2>' + stat + "</section>";
    var strip = '<ul class="land-logos">';
    for (var j = 0; j < logos.length && j < 12; j++) {
      var src = renderUrl(logos[j].logo_url) || logos[j].logo_url;
      strip += '<li><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(logos[j].name || "משרד תיווך")
        + '" width="72" height="72" loading="lazy" decoding="async"></li>';
    }
    return '<section class="land-trust"><h2>בעפולה</h2>' + strip + stat + "</section>";
  }

  function relatedCards(data) {
    var rows = (data && data.related) || [];
    var html = "";
    var n = 0;
    for (var i = 0; i < rows.length && n < 9; i++) {
      var p = rows[i];
      if (!p || !p.id || p.deal_type == null) continue;
      n++;
      var price = Number(p.price);
      var priceHtml = isFinite(price) && price > 0
        ? '<b class="land-price"><bdi>₪' + num(price) + "</bdi></b>"
        : '<b class="land-price">מחיר לפי פנייה</b>';
      html += '<li><a class="land-card" href="/property?id=' + encodeURIComponent(p.id) + '">'
        + '<span class="land-card-body">' + priceHtml
        + "<strong>" + escapeHtml(p.title || "נכס") + "</strong></span></a></li>";
    }
    if (!n) return "";
    return '<section class="land-related"><h2>עוד נכסים בעפולה</h2><ul class="land-grid">' + html + "</ul></section>";
  }

  function faqs() {
    return [
      ["מי מופיע ברשימה?", "משרדים שמשרתים את עפולה, ומתווך או מתווכת עם רישיון בתוקף."],
      ["איך מגיעים לנכסים של משרד?", "לכל משרד יש דף עם המלאי הפעיל, ולכל מתווך או מתווכת דף עם הרישיון."],
      ["האם אלה כל המשרדים בעיר?", "אלה המשרדים בעפולה שמפרסמים באתר. לכל המשרדים ולכל המתווכים באתר יש עמודים נפרדים."],
      ["איך מקבלים התראה על נכס חדש?", "כפתור קבלו התראה פותח את החיפוש השמור שכבר באתר."],
      ["איפה רואים עסקאות ומחירים?", "עסקאות בעפולה ומחירי דירות לפי חדרים נמצאים בעמודים שלהם, עם קישור בגוף העמוד."],
    ];
  }

  function faqHtml() {
    var rows = faqs();
    var html = '<section class="land-faq"><h2>שאלות נפוצות</h2>';
    for (var i = 0; i < rows.length; i++) {
      html += "<details><summary>" + escapeHtml(rows[i][0]) + "</summary><p>" + escapeHtml(rows[i][1]) + "</p></details>";
    }
    return html + "</section>";
  }

  function seo() {
    return '<section class="land-seo"><h2>על הרשימה</h2><p>' + escapeHtml(INTRO) + "</p>"
      + "<p>הרשימה היא משרדים שמשרתים את עפולה ושמתווך/ת בהם עם רישיון בתוקף. לכל משרד ולכל מתווך/ת יש דף משלו, עם המלאי והדירוג. "
      + '<a href="/agencies">כל משרדי התיווך</a> ו-<a href="/agents">כל המתווכים</a> באתר. '
      + '<a href="/deals/afula">עסקאות בעפולה</a> ו-<a href="/prices">מחירי דירות</a>.</p></section>';
  }

  function also() {
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < ALSO.length; i++) {
      html += '<a href="' + escapeHtml(ALSO[i][0]) + '">' + escapeHtml(ALSO[i][1]) + "</a>";
    }
    html += '<a href="/">עפולה והעמק</a></nav></section>';
    return html;
  }

  function finalCta() {
    return '<section class="land-final"><h2>רוצים לשמוע כשעולה נכס מתאים?</h2>'
      + "<p>נעדכן אתכם ברגע שיעלה נכס שמתאים. זו ההתראה שכבר קיימת באתר.</p>"
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></section>';
  }

  function render(data) {
    var agencies = (data && data.agencies) || [];
    var agents = (data && data.agents) || [];
    var html = filters();
    if (!agencies.length && !agents.length) {
      html += '<div class="land-empty"><p>אין כרגע משרדים להצגה.</p>'
        + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></div>';
      html += relatedCards(data);
    } else {
      if (agencies.length) {
        var shown = agencies.slice(0, 9);
        html += "<h2>משרדי תיווך</h2><ul class=\"land-grid\">";
        for (var i = 0; i < shown.length; i++) html += officeCard(shown[i]);
        html += "</ul>";
        if (agencies.length > shown.length) {
          html += '<nav class="land-filters" aria-label="עוד משרדים">';
          for (var r = shown.length; r < agencies.length; r++) {
            html += '<a href="/agency?slug=' + encodeURIComponent(agencies[r].slug) + '">'
              + escapeHtml(agencies[r].name || "משרד") + "</a>";
          }
          html += "</nav>";
        }
        html += '<p class="land-more"><a class="land-btn land-btn-primary" data-land-cta data-count="' + agencies.length
          + '" href="/agencies">לכל ' + bdi(num(agencies.length)) + " המשרדים</a></p>";
      }
      if (agencies.length < 3) html += relatedCards(data);
      if (agents.length) {
        html += '<h2>מתווכים</h2><nav class="land-filters" aria-label="מתווכים">';
        for (var j = 0; j < agents.length; j++) {
          html += '<a href="/agent?slug=' + encodeURIComponent(agents[j].slug) + '">'
            + escapeHtml(agents[j].display_name || "מתווך/ת") + "</a>";
        }
        html += "</nav>";
      }
    }
    html += neighborhoods(data);
    html += trust(agencies);
    html += seo();
    html += also();
    html += faqHtml();
    html += finalCta();
    return html;
  }

  function entry(name, url) {
    return {
      "@type": ["LocalBusiness", "RealEstateAgent"],
      name: name,
      url: url,
      address: { "@type": "PostalAddress", addressLocality: "עפולה", addressCountry: "IL" },
    };
  }

  function jsonLd(data, site) {
    var url = site + PATH;
    var agencies = (data && data.agencies) || [];
    var agents = (data && data.agents) || [];
    var items = [];
    var n = 0;
    for (var i = 0; i < agencies.length; i++) {
      if (!agencies[i].slug) continue;
      n += 1;
      var office = entry(String(agencies[i].name || "משרד תיווך"), site + "/agency?slug=" + encodeURIComponent(agencies[i].slug));
      if (agencies[i].address) office.address.streetAddress = String(agencies[i].address);
      items.push({ "@type": "ListItem", position: n, item: office });
    }
    for (var j = 0; j < agents.length; j++) {
      if (!agents[j].slug) continue;
      n += 1;
      items.push({
        "@type": "ListItem",
        position: n,
        item: entry(String(agents[j].display_name || "מתווך/ת"), site + "/agent?slug=" + encodeURIComponent(agents[j].slug)),
      });
    }
    var qa = faqs();
    var main = [];
    for (var q = 0; q < qa.length; q++) {
      main.push({ "@type": "Question", name: qa[q][0], acceptedAnswer: { "@type": "Answer", text: qa[q][1] } });
    }
    return [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: H1,
        url: url,
        description: DESCRIPTION,
        inLanguage: "he",
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "דף הבית", item: site + "/" },
          { "@type": "ListItem", position: 2, name: H1, item: url },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: H1,
        numberOfItems: items.length,
        itemListElement: items,
      },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: main },
    ];
  }

  function scripts(data, site) {
    return jsonLd(data, site).map(function (obj) {
      return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, "\\u003c") + "</script>";
    }).join("\n");
  }

  root.ShukBrokers = {
    path: PATH,
    h1: H1,
    benefit: BENEFIT,
    description: DESCRIPTION,
    cityId: CITY_ID,
    pageOf: pageOf,
    agencyQuery: agencyQuery,
    render: render,
    chipsHtml: chipsHtml,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function () { return H1 + " | שוק נדל״ן"; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
