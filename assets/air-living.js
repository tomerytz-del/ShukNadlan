/* כיווני אוויר ושטח סלון. מקור אחד לדף הנכס ול-og-tags.
   הערכים: צפון, דרום, מזרח, מערב, תמיד בסדר הזה. ספירה נגזרת.
   "סלון גדול" אינו מוצג ללקוחות. */
(function (root) {
  var ORDER = ["צפון", "דרום", "מזרח", "מערב"];
  var WORDS = {
    "צפון": "צפון", "צ": "צפון", "n": "צפון", "north": "צפון",
    "דרום": "דרום", "ד": "דרום", "s": "דרום", "south": "דרום",
    "מזרח": "מזרח", "מז": "מזרח", "e": "מזרח", "east": "מזרח",
    "מערב": "מערב", "מע": "מערב", "w": "מערב", "west": "מערב"
  };
  var LARGE = 30;

  function parse(value) {
    var raw = Array.isArray(value) ? value.join(" ") : String(value == null ? "" : value);
    var parts = raw.split(/[\s,/|+]+/).map(function (p) { return p.trim(); }).filter(Boolean);
    var found = {};
    parts.forEach(function (part) {
      var dir = WORDS[part] || WORDS[part.toLowerCase()];
      if (dir) found[dir] = true;
    });
    return ORDER.filter(function (d) { return found[d]; });
  }

  function sqm(value) {
    if (value === null || value === undefined || value === "") return "";
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return "";
    var rounded = Math.round(n * 10) / 10;
    return rounded === Math.floor(rounded) ? String(rounded) : String(rounded);
  }

  function countPhrase(n) {
    return n === 1 ? "כיוון אוויר אחד" : (n + " כיווני אוויר");
  }

  function customerAirLine(value) {
    var dirs = parse(value);
    return dirs.length ? ("כיווני אוויר: " + dirs.join(", ")) : "";
  }

  function customerLivingLine(value) {
    var n = sqm(value);
    return n ? ("גודל הסלון: כ־" + n + " מ״ר") : "";
  }

  function metaClause(dirs, living) {
    var list = parse(dirs);
    var n = sqm(living);
    var parts = [];
    if (list.length) parts.push(countPhrase(list.length));
    if (n) parts.push("סלון של " + n + " מ״ר");
    return parts.join(", ");
  }

  function jsonLd(dirs, living) {
    var list = parse(dirs);
    var out = [];
    if (list.length) {
      out.push({ "@type": "PropertyValue", name: "כיווני אוויר", value: list.join(", ") });
      out.push({ "@type": "PropertyValue", name: "מספר כיווני אוויר", value: list.length });
    }
    var n = Number(living);
    if (isFinite(n) && n > 0) out.push({ "@type": "PropertyValue", name: "גודל סלון", value: n, unitCode: "MTK" });
    return out;
  }

  function customerSeekAir(value) {
    var dirs = parse(value);
    return dirs.length ? ("מחפשים כיווני אוויר: " + dirs.join(", ")) : "";
  }

  function customerSeekLiving(value) {
    var n = sqm(value);
    return n ? ("גודל סלון מינימלי: " + n + " מ״ר") : "";
  }

  function matchLines(wantDirs, haveDirs, minSqm, haveSqm) {
    var want = parse(wantDirs);
    var have = parse(haveDirs);
    var lines = [];
    if (want.length && have.length && want.every(function (d) { return have.indexOf(d) !== -1; })) {
      lines.push(customerAirLine(have));
    }
    var min = Number(minSqm);
    var got = Number(haveSqm);
    if (isFinite(min) && min > 0 && isFinite(got) && got >= min) {
      var line = customerLivingLine(got);
      if (line) lines.push(line);
    }
    return lines;
  }

  function crmSpec(p) {
    var dirs = parse(p && p.air_directions);
    var n = sqm(p && p.living_room_sqm);
    var bits = [];
    if (n) bits.push("סלון " + n + " מ״ר");
    if (dirs.length) bits.push(countPhrase(dirs.length) + " (" + dirs.join(", ") + ")");
    return bits.join(" · ");
  }

  root.ShukAirLiving = {
    ORDER: ORDER,
    LARGE: LARGE,
    parse: parse,
    sqm: sqm,
    countPhrase: countPhrase,
    customerAirLine: customerAirLine,
    customerLivingLine: customerLivingLine,
    metaClause: metaClause,
    jsonLd: jsonLd,
    customerSeekAir: customerSeekAir,
    customerSeekLiving: customerSeekLiving,
    matchLines: matchLines,
    crmSpec: crmSpec
  };
})(typeof window !== "undefined" ? window : globalThis);
