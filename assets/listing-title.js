/* כותרת הלשונית ושאילתת האחים. מקור אחד ל-og-tags ול-property.js.
   אין כאן export: הקובץ נטען גם כ-<script src>. */
(function (root) {
  function clampTitle(s, max) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
  }

  /* עם מבדיל ובלי: אותו חיתוך ל-90, אותו כיווץ רווחים, ו-trimEnd לפני …. */
  function pageTitle(base, suffix) {
    return clampTitle(String(base || "") + (suffix || "") + " | שוק נדל״ן", 90);
  }

  /* ערך בתוך or= של PostgREST. פסיק או סוגריים בלי מירכאות שוברים את הפיצול.
     המירכאות נשארות אחרי פענוח ה-URL. */
  function pgQuoted(value) {
    var escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return encodeURIComponent('"' + escaped + '"');
  }

  var PAGE = 1000;
  var COLS = "id,street,address,house_number,city,rooms,size_sqm,floor,deal_type,price,property_type,title";

  /* streetName הוא השם אחרי streetNameOf. ריק: אין רחוב, ואז עיר+סוג
     ו-street/address ריקים, ואם יש שכונה גם היא. */
  function siblingFilter(p) {
    var city = String((p && p.city) || "").trim();
    var type = String((p && p.property_type) || "").trim();
    var street = String((p && p.streetName) || "").trim();
    var hood = String((p && p.neighborhood) || "").trim();
    if (!city || !type) return "";
    var parts = [
      "status=eq.active",
      "city=eq." + encodeURIComponent(city),
      "property_type=eq." + encodeURIComponent(type),
    ];
    if (street) {
      parts.push("or=(" + [
        "street.eq." + pgQuoted(street),
        "street.eq." + pgQuoted("רחוב " + street),
        "address.ilike." + pgQuoted("*" + street + "*"),
      ].join(",") + ")");
    } else {
      var empty = pgQuoted("");
      parts.push("and=(or(street.is.null,street.eq." + empty + "),or(address.is.null,address.eq." + empty + "))");
      if (hood && hood !== city) parts.push("neighborhoods.name=eq." + pgQuoted(hood));
    }
    parts.push(
      "select=" + encodeURIComponent(COLS),
      "order=id.asc",
      "limit=" + PAGE,
    );
    return parts.join("&");
  }

  root.ShukListingTitle = {
    clampTitle: clampTitle,
    pageTitle: pageTitle,
    pgQuoted: pgQuoted,
    siblingFilter: siblingFilter,
    SIBLING_PAGE: PAGE,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
