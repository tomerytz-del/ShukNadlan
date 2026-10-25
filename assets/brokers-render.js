/* ============================================================================
   מתווכים לפי עיר - /afula/מתווכים, /haifa/מתווכים
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

  /* ‏דף לכל עיר: /{slug}/מתווכים. אותן ערים, אותם cityId ואותו market
     כמו CITIES ב-assets/silo-render.js (‏scripts/brokers_page_test.ts
     מצליב). הקובץ אינו קורא מ-silo-render.js כי brokers.html אינו טוען
     אותו. השורה הראשונה של כל עיר נקראת ב-scripts/check_canonical.py. */
  var CITIES = [
    { slug: "afula", name: "עפולה", market: "afula-emek",
      cityId: "c2a8426f-7bac-4c48-bcb5-53a5ca06f001", home: "/", homeLabel: "עפולה והעמק" },
    { slug: "haifa", name: "חיפה", market: "haifa",
      cityId: "751fcf13-a02b-4370-97a5-fc4ec42ea4fe", home: "/haifa", homeLabel: "חיפה והסביבה" },
  ];
  var BENEFIT = "משרדים ומתווכים עם רישיון בתוקף, והמלאי הפעיל של כל משרד.";
  var IMG_HOST = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/";
  var TYPES = [
    ["בתים-פרטיים", "בתים פרטיים"],
    ["דירות-גן", "דירות גן"],
    ["דירות-3-חדרים", "דירות 3 חדרים"],
  ];

  function pageFor(c) {
    var at = "ב" + c.name;
    var also = [];
    for (var i = 0; i < TYPES.length; i++) {
      also.push(["/" + c.slug + "/" + TYPES[i][0], TYPES[i][1] + " למכירה " + at]);
    }
    return {
      path: "/" + c.slug + "/מתווכים",
      h1: "מתווכים " + at,
      benefit: BENEFIT,
      description: "משרדי תיווך ומתווכים " + at + ", עם המלאי הפעיל של כל משרד וקישור לדף שלו.",
      intro: "משרדי התיווך " + at + " והמתווכים שפועלים בהם. לכל משרד דף עם המלאי, ולכל מתווך/ת דף עם הרישיון והנכסים.",
      city: c.slug,
      cityName: c.name,
      at: at,
      cityId: c.cityId,
      market: c.market,
      home: c.home,
      homeLabel: c.homeLabel,
      also: also,
    };
  }

  var PAGES = [];
  for (var ci = 0; ci < CITIES.length; ci++) PAGES.push(pageFor(CITIES[ci]));

  /* ‏בלי page - עפולה, כמו שהיה לפני שהיו כמה ערים. */
  function pg(page) { return page && page.path ? page : PAGES[0]; }

  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function bdi(inner) { return "<bdi>" + inner + "</bdi>"; }
  function sp() { return '<span class="land-sp"> </span>'; }
  function countPhrase(n, one, many) { return bdi(num(n)) + sp() + (n === 1 ? one : many); }

  function pageOf(pathname) {
    var path = String(pathname || "").replace(/\/+$/, "") || "/";
    try { path = decodeURIComponent(path); } catch (e) { return null; }
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].path === path) return PAGES[i];
    return null;
  }

  function agencyQuery(page) {
    return "select=id,slug,name,address,tagline,logo_url,updated_at&city_id=eq." + pg(page).cityId
      + "&order=name.asc&limit=200";
  }

  function shortDate(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var dd = String(d.getUTCDate()).padStart(2, "0");
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return dd + "." + mm + "." + d.getUTCFullYear();
  }

  function initials(name) {
    var s = String(name || "").replace(/["״״']/g, "").trim();
    if (!s) return "מ";
    var dotted = s.match(/^([A-Za-zא-ת])\s*\.\s*([A-Za-zא-ת])/);
    if (dotted) return dotted[1] + "." + dotted[2];
    var words = s.split(/\s+/).filter(Boolean);
    var first = words[0] || s;
    if (/^[A-Za-z0-9&.]{1,4}$/.test(first)) return first;
    var letters = [];
    for (var i = 0; i < words.length && letters.length < 2; i++) {
      if (words[i].charAt(0)) letters.push(words[i].charAt(0));
    }
    return letters.join("") || first.slice(0, 2);
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
      return '<span class="land-avatar" aria-hidden="true">' + escapeHtml(initials(alt)) + "</span>";
    }
    var src = renderUrl(url) || url;
    return '<img src="' + escapeHtml(src) + '" alt="" width="48" height="48" loading="lazy" decoding="async"'
      + ' data-full="' + escapeHtml(url) + '"'
      + ' onerror="this.onerror=null;this.src=this.getAttribute(\'data-full\')">';
  }

  function officeCard(a, page) {
    var bits = [];
    if (a.address) bits.push(escapeHtml(a.address));
    else bits.push(escapeHtml(pg(page).cityName));
    if (a.active_count) bits.push(bdi(num(a.active_count)) + sp() + "נכסים פעילים");
    if (a.tagline) bits.push(escapeHtml(a.tagline));
    return '<li><a class="land-card land-office" href="/agency?slug=' + encodeURIComponent(a.slug) + '">'
      + logo(a.logo_url, a.name || "")
      + '<span class="land-card-body"><strong>' + escapeHtml(a.name || "משרד תיווך") + "</strong>"
      + "<span>" + bits.join(" · ") + "</span>"
      + "</span></a></li>";
  }

  function updatedHtml(data) {
    var best = 0;
    var agencies = (data && data.agencies) || [];
    for (var i = 0; i < agencies.length; i++) {
      var t = Date.parse(agencies[i].updated_at || "");
      if (isFinite(t) && t > best) best = t;
    }
    if (!best) return "";
    return "עודכן לאחרונה" + sp() + bdi(shortDate(best));
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

  function relatedCards(data, page) {
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
    return '<section class="land-related"><h2>עוד נכסים ' + escapeHtml(pg(page).at) + '</h2><ul class="land-grid">' + html + "</ul></section>";
  }

  function faqs(page) {
    var p = pg(page);
    return [
      ["מי מופיע ברשימה?", "משרדים שמשרתים את " + p.cityName + ", ומתווך או מתווכת עם רישיון בתוקף."],
      ["איך מגיעים לנכסים של משרד?", "לכל משרד יש דף עם המלאי הפעיל, ולכל מתווך או מתווכת דף עם הרישיון."],
      ["האם אלה כל המשרדים בעיר?", "אלה המשרדים " + p.at + " שמפרסמים באתר. לכל המשרדים ולכל המתווכים באתר יש עמודים נפרדים."],
      ["איך מקבלים התראה על נכס חדש?", "כפתור קבלו התראה פותח את החיפוש השמור שכבר באתר."],
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

  function seo(page) {
    var p = pg(page);
    return '<section class="land-seo"><h2>על הרשימה</h2><p>' + escapeHtml(p.intro) + "</p>"
      + "<p>הרשימה היא משרדים שמשרתים את " + escapeHtml(p.cityName) + " ושמתווך/ת בהם עם רישיון בתוקף. לכל משרד ולכל מתווך/ת יש דף משלו, עם המלאי והדירוג. "
      + '<a href="/agencies">כל משרדי התיווך</a> ו-<a href="/agents">כל המתווכים</a> באתר. '
      + '<a href="/deals/' + p.city + '">עסקאות ' + escapeHtml(p.at) + '</a> ו-<a href="/prices">מחירי דירות</a>.</p></section>';
  }

  function also(page) {
    var p = pg(page);
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < p.also.length; i++) {
      html += '<a href="' + escapeHtml(p.also[i][0]) + '">' + escapeHtml(p.also[i][1]) + "</a>";
    }
    html += '<a href="' + escapeHtml(p.home) + '">' + escapeHtml(p.homeLabel) + "</a></nav></section>";
    return html;
  }

  function finalCta() {
    return '<section class="land-final"><h2>רוצים לשמוע כשעולה נכס מתאים?</h2>'
      + "<p>נעדכן אתכם ברגע שיעלה נכס שמתאים.</p>"
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></section>';
  }

  function render(data, page) {
    var p = pg(page);
    var agencies = (data && data.agencies) || [];
    var agents = (data && data.agents) || [];
    var html = "";
    if (!agencies.length && !agents.length) {
      html += '<div class="land-empty"><p>אין כרגע משרדים להצגה.</p>'
        + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></div>';
      html += relatedCards(data, p);
    } else {
      if (agencies.length) {
        html += "<h2>" + countPhrase(agencies.length, "משרד תיווך פעיל " + escapeHtml(p.at), "משרדי תיווך פעילים " + escapeHtml(p.at))
          + "</h2><ul class=\"land-grid\">";
        for (var i = 0; i < agencies.length; i++) html += officeCard(agencies[i], p);
        html += "</ul>";
        html += '<p class="land-more"><a class="land-btn land-btn-primary" data-land-cta data-count="' + agencies.length
          + '" href="/agencies"><span>לכל</span>' + bdi(num(agencies.length)) + "<span>המשרדים</span></a></p>";
      }
      if (agencies.length < 3) html += relatedCards(data, p);
      if (agents.length) {
        var shownAgents = agents.slice(0, 12);
        html += '<h2>מתווכים</h2><ul class="land-grid">';
        for (var j = 0; j < shownAgents.length; j++) {
          var person = shownAgents[j];
          html += '<li><a class="land-card land-office" href="/agent?slug=' + encodeURIComponent(person.slug) + '">'
            + '<span class="land-avatar" aria-hidden="true">' + escapeHtml(initials(person.display_name || "")) + "</span>"
            + '<span class="land-card-body"><strong>' + escapeHtml(person.display_name || "מתווך/ת") + "</strong>"
            + (person.agency_name ? "<span>" + escapeHtml(person.agency_name) + "</span>" : "")
            + "</span></a></li>";
        }
        html += "</ul>";
        if (agents.length > shownAgents.length) {
          html += '<p class="land-more"><a class="land-btn land-btn-primary" href="/agents"><span>לכל</span>'
            + bdi(num(agents.length)) + "<span>המתווכים</span></a></p>";
        }
      }
    }
    html += seo(p);
    html += also(p);
    html += faqHtml(p);
    html += finalCta();
    return html;
  }

  function entry(name, url, locality) {
    return {
      "@type": ["LocalBusiness", "RealEstateAgent"],
      name: name,
      url: url,
      address: { "@type": "PostalAddress", addressLocality: locality, addressCountry: "IL" },
    };
  }

  function jsonLd(data, site, page) {
    var p = pg(page);
    var url = site + p.path;
    var agencies = (data && data.agencies) || [];
    var agents = (data && data.agents) || [];
    var items = [];
    var n = 0;
    for (var i = 0; i < agencies.length; i++) {
      if (!agencies[i].slug) continue;
      n += 1;
      var office = entry(String(agencies[i].name || "משרד תיווך"), site + "/agency?slug=" + encodeURIComponent(agencies[i].slug), p.cityName);
      if (agencies[i].address) office.address.streetAddress = String(agencies[i].address);
      items.push({ "@type": "ListItem", position: n, item: office });
    }
    for (var j = 0; j < agents.length; j++) {
      if (!agents[j].slug) continue;
      n += 1;
      items.push({
        "@type": "ListItem",
        position: n,
        item: entry(String(agents[j].display_name || "מתווך/ת"), site + "/agent?slug=" + encodeURIComponent(agents[j].slug), p.cityName),
      });
    }
    var qa = faqs(p);
    var main = [];
    for (var q = 0; q < qa.length; q++) {
      main.push({ "@type": "Question", name: qa[q][0], acceptedAnswer: { "@type": "Answer", text: qa[q][1] } });
    }
    return [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: p.h1,
        url: url,
        description: p.description,
        inLanguage: "he",
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "דף הבית", item: site + "/" },
          { "@type": "ListItem", position: 2, name: p.cityName, item: site + p.home },
          { "@type": "ListItem", position: 3, name: p.h1, item: url },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: p.h1,
        numberOfItems: items.length,
        itemListElement: items,
      },
      { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: main },
    ];
  }

  function scripts(data, site, page) {
    return jsonLd(data, site, page).map(function (obj) {
      return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, "\\u003c") + "</script>";
    }).join("\n");
  }

  root.ShukBrokers = {
    pages: PAGES,
    cities: CITIES,
    pageOf: pageOf,
    agencyQuery: agencyQuery,
    render: render,
    chipsHtml: chipsHtml,
    updatedHtml: updatedHtml,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function (page) { return pg(page).h1 + " | שוק נדל״ן"; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
