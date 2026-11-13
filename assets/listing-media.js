/* ============================================================================
   תמונות נכס: alt מהשדות של המודעה, וכתובת מוקטנת מ-Supabase
   ----------------------------------------------------------------------------
   מקור אחד לדפדפן ול-edge (globalThis.ListingMedia). אין export: הקובץ
   נטען כ-<script src> ומיובא לתופעת הלוואי שלו.

   alt נבנה רק משדות שקיימים על המודעה (סוג, חדרים, עסקה, שכונה או עיר)
   ומאינדקס התמונה בגלריה. אין תיאור של מה שרואים בתמונה, ואין ספירת מודעות.
   כתובת שאינה /storage/v1/object/public/ חוזרת כמו שהיא.
   render/image מגיש WebP לפי Accept. quality ברירת מחדל 70.
   ========================================================================== */
(function (root) {
  var MARKER = "/storage/v1/object/public/";
  var RENDER = "/storage/v1/render/image/public/";
  var QUALITY = 70;
  var CARD_WIDTHS = [400, 800, 1200];
  var HERO_WIDTHS = [400, 800, 1200, 1600];

  /* עותק מלא: הקובץ רץ גם בשרת, בלי esc.js. חמשת התווים. */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clean(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function renderUrl(url, width, quality) {
    var s = String(url == null ? "" : url);
    if (!s || s.indexOf(RENDER) >= 0) return s;
    var at = s.indexOf(MARKER);
    if (at < 0) return s;
    var path = s.slice(at + MARKER.length).split(/[?#]/)[0];
    if (!path) return s;
    var w = Math.round(Number(width));
    if (!isFinite(w) || w <= 0) return s;
    var q = quality == null ? QUALITY : Math.round(Number(quality));
    if (!isFinite(q) || q <= 0 || q > 100) q = QUALITY;
    return s.slice(0, at) + RENDER + path + "?width=" + w + "&quality=" + q;
  }

  function isRender(url) {
    return String(url || "").indexOf(RENDER) >= 0;
  }

  function srcset(url, widths, quality) {
    var list = widths && widths.length ? widths : CARD_WIDTHS;
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var w = Math.round(Number(list[i]));
      var u = renderUrl(url, w, quality);
      if (isRender(u)) parts.push(u + " " + w + "w");
    }
    return parts.join(", ");
  }

  function roomsText(rooms) {
    if (rooms == null || rooms === "") return "";
    var n = Number(rooms);
    if (!isFinite(n) || n <= 0) return "";
    var label = String(Math.round(n * 10) / 10);
    if (n === 1) return "חדר אחד";
    return label + " חדרים";
  }

  function typeText(type, hasRooms) {
    var t = clean(type);
    if (!t) return "";
    if (hasRooms && t === "דירה") return "דירת";
    return t;
  }

  function dealText(deal) {
    if (deal === "rent" || deal === "להשכרה") return "להשכרה";
    if (deal === "sale" || deal === "למכירה") return "למכירה";
    return "";
  }

  function hoodName(p) {
    var n = p && p.neighborhoods;
    if (Array.isArray(n)) n = n[0];
    if (n && typeof n === "object" && n.name) return clean(n.name);
    if (typeof n === "string") return clean(n);
    return clean(p && (p.neighborhood_name || p.neighborhood || p.sales_area));
  }

  function placeText(p) {
    var hood = hoodName(p);
    var city = clean(p && p.city);
    var place = hood || city;
    if (hood && city && hood !== city && hood.indexOf(city) < 0) place = hood + ", " + city;
    if (!place) return "";
    /* בלי להוריד ה' מהשם: "הרצליה" היא "בהרצליה", לא "ברצליה". */
    return "ב" + place;
  }

  /* index הוא 0-based. בלי index אין "תמונה N" - כרטיס הוא תמונה אחת. */
  function alt(p, opts) {
    p = p || {};
    opts = opts || {};
    var rooms = roomsText(p.rooms);
    var type = typeText(p.property_type, !!rooms);
    var bits = [];
    if (type && rooms) bits.push(type + " " + rooms);
    else if (type) bits.push(type);
    else if (rooms) bits.push(rooms);
    var deal = dealText(p.deal_type);
    if (deal) bits.push(deal);
    var head = bits.join(" ");
    var place = placeText(p);
    if (place) head = head ? head + " " + place : place;
    var total = Number(opts.total);
    if (opts.index != null && opts.index !== "" && isFinite(Number(opts.index)) && isFinite(total) && total > 0) {
      var n = Number(opts.index) + 1;
      if (n >= 1 && n <= total) {
        var tail = "תמונה " + n + " מתוך " + total;
        head = head ? head + ", " + tail : tail;
      }
    }
    return head;
  }

  function imgTag(url, listing, opts) {
    opts = opts || {};
    var raw = String(url == null ? "" : url).trim();
    if (!raw) return "";
    var widths = opts.widths || CARD_WIDTHS;
    var srcW = opts.srcWidth || 800;
    var rendered = renderUrl(raw, srcW, opts.quality);
    var transformed = isRender(rendered);
    var src = transformed ? rendered : raw;
    var set = transformed ? srcset(raw, widths, opts.quality) : "";
    var text = typeof opts.alt === "string"
      ? opts.alt
      : (opts.index != null ? alt(listing, { index: opts.index, total: opts.total }) : alt(listing));
    var attrs = [];
    if (opts.className) attrs.push('class="' + esc(opts.className) + '"');
    if (opts.lcp) attrs.push('data-lcp="1"');
    attrs.push('src="' + esc(src) + '"');
    if (set) {
      attrs.push('srcset="' + esc(set) + '"');
      attrs.push('sizes="' + esc(opts.sizes || "(min-width:900px) 320px, (min-width:520px) 50vw, 100vw") + '"');
      attrs.push('data-full="' + esc(raw) + '"');
    }
    attrs.push('alt="' + esc(text) + '"');
    if (opts.width) attrs.push('width="' + esc(opts.width) + '"');
    if (opts.height) attrs.push('height="' + esc(opts.height) + '"');
    attrs.push('decoding="async"');
    if (opts.eager) attrs.push('fetchpriority="high"');
    else if (opts.lazy !== false) attrs.push('loading="lazy"');
    if (opts.hidden) attrs.push('aria-hidden="true"');
    if (set) {
      attrs.push('onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')"');
    }
    return "<img " + attrs.join(" ") + ">";
  }

  root.ListingMedia = {
    QUALITY: QUALITY,
    CARD_WIDTHS: CARD_WIDTHS,
    HERO_WIDTHS: HERO_WIDTHS,
    renderUrl: renderUrl,
    srcset: srcset,
    alt: alt,
    imgTag: imgTag,
    esc: esc,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
