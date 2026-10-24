/* ============================================================================
   מתווכים בעפולה - /afula/מתווכים
   ----------------------------------------------------------------------------
   מקור אחד לשרת ולדפדפן, כמו assets/neighborhood-render.js. הקובץ נטען
   כ-<script src> ומיובא ב-brokers-page.ts (globalThis.ShukBrokers).
   docs/afula-brokers.md.
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
  var DESCRIPTION = "משרדי תיווך ומתווכים בעפולה, עם המלאי הפעיל של כל משרד וקישור לדף שלו.";
  var INTRO = "משרדי התיווך בעפולה והמתווכים שפועלים בהם. לכל משרד דף עם המלאי, ולכל מתווך/ת דף עם הרישיון והנכסים.";
  /* עפולה ב-cities. הטבלה עצמה אינה קריאה לאנונימי, ולכן המזהה כאן. */
  var CITY_ID = "c2a8426f-7bac-4c48-bcb5-53a5ca06f001";
  var IMG_HOST = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/";

  function pageOf(pathname) {
    var path = String(pathname || "").replace(/\/+$/, "") || "/";
    try { path = decodeURIComponent(path); } catch (e) { return null; }
    return path === PATH ? { path: PATH, h1: H1, description: DESCRIPTION, intro: INTRO } : null;
  }

  function agencyQuery() {
    return "select=id,slug,name,address,tagline,logo_url&city_id=eq." + CITY_ID
      + "&order=name.asc&limit=200";
  }

  function renderUrl(url) {
    var marker = "/storage/v1/object/public/";
    var at = url.indexOf(marker);
    if (at < 0) return "";
    var path = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!path) return "";
    return url.slice(0, at) + "/storage/v1/render/image/public/" + path
      + "?width=144&height=144&resize=contain&quality=60";
  }

  function logo(url, alt, eager) {
    if (typeof url !== "string" || url.indexOf(IMG_HOST) !== 0) {
      return '<span class="hood-noimg" aria-hidden="true"></span>';
    }
    var src = renderUrl(url) || url;
    var pri = eager ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"';
    return '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" width="72" height="72"' + pri
      + ' data-full="' + escapeHtml(url) + '"'
      + ' onerror="this.onerror=null;this.src=this.getAttribute(\'data-full\')">';
  }

  function officeCard(a, eager) {
    var bits = [];
    if (a.address) bits.push(a.address);
    else bits.push("עפולה");
    if (a.active_count) bits.push(a.active_count + " נכסים פעילים");
    if (a.tagline) bits.push(a.tagline);
    return '<li><a class="hood-prop" href="/agency?slug=' + encodeURIComponent(a.slug) + '">'
      + logo(a.logo_url, a.name || "", eager)
      + '<span class="hood-prop-body"><strong>' + escapeHtml(a.name || "משרד תיווך") + "</strong>"
      + "<span>" + escapeHtml(bits.join(" · ")) + "</span>"
      + "</span></a></li>";
  }

  function agentCard(m) {
    return '<li><a class="hood-prop" href="/agent?slug=' + encodeURIComponent(m.slug) + '">'
      + '<span class="hood-prop-body"><strong>' + escapeHtml(m.display_name || "מתווך/ת") + "</strong>"
      + "<span>" + escapeHtml(m.agency_name || "עפולה") + "</span>"
      + "</span></a></li>";
  }

  function render(data) {
    var agencies = (data && data.agencies) || [];
    var agents = (data && data.agents) || [];
    var html = '<p class="silo-intro">' + escapeHtml(INTRO) + "</p>"
      + '<nav class="silo-links" aria-label="עוד בעפולה">'
      + '<a href="/">עפולה והעמק</a>'
      + '<a href="/agencies">כל משרדי התיווך</a>'
      + '<a href="/agents">כל המתווכים</a>'
      + '<a href="/deals/afula">עסקאות בעפולה</a>'
      + '<a href="/prices">מחירי דירות בעפולה</a>'
      + "</nav>";
    if (!agencies.length && !agents.length) {
      return html + '<p class="deals-note">אין כרגע משרדים להצגה. <a href="/agencies">לכל המשרדים</a></p>';
    }
    if (agencies.length) {
      var first = true;
      html += "<h2>משרדי תיווך</h2><ul class=\"hood-props\">";
      for (var i = 0; i < agencies.length; i++) {
        var eager = first && typeof agencies[i].logo_url === "string";
        if (eager) first = false;
        html += officeCard(agencies[i], eager);
      }
      html += "</ul>";
    }
    if (agents.length) {
      html += "<h2>מתווכים</h2><ul class=\"hood-props\">";
      for (var j = 0; j < agents.length; j++) html += agentCard(agents[j]);
      html += "</ul>";
    }
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
    description: DESCRIPTION,
    cityId: CITY_ID,
    pageOf: pageOf,
    agencyQuery: agencyQuery,
    render: render,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function () { return H1 + " | שוק נדל״ן"; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
