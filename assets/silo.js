/* מילוי רק כשהשרת לא הספיק (אין data-ssr). silo-page.ts ממלא את הדף
   לפני שהתשובה יוצאת; כאן רק 503 או דף שנפתח בלי הפונקציה. */
(function () {
  var SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
  var box = document.getElementById("siloBody");
  if (!box || box.getAttribute("data-ssr") === "1" || !window.ShukSilo) return;
  var page = window.ShukSilo.pageOf(location.pathname);
  if (!page) return;
  var S = window.ShukSilo;

  function get(url, prefer) {
    var headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      Accept: "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    return fetch(url, { headers: headers }).then(function (res) {
      if (!res.ok) throw new Error("status");
      return res.json().then(function (data) { return { res: res, data: data }; });
    });
  }

  get(SUPABASE_URL + "/rest/v1/properties?" + S.queryOf(page), "count=exact").then(function (got) {
    if (!Array.isArray(got.data)) throw new Error("shape");
    var rows = got.data;
    var range = got.res.headers.get("content-range") || "";
    var match = /\/(\d+)\s*$/.exec(range);
    var extras = { total: match ? Number(match[1]) : rows.length, counted: !!match, hoods: null, related: [], agencies: [] };
    var tasks = [
      get(SUPABASE_URL + "/rest/v1/properties?" + S.hoodCountQuery(page), "count=exact").then(function (x) {
        if (!Array.isArray(x.data)) return;
        var range = x.res.headers.get("content-range") || "";
        var m = /\/(\d+)\s*$/.exec(range);
        if (m && x.data.length !== Number(m[1])) return;
        extras.hoods = S.hoodRowsFromListings(x.data, page);
      }).catch(function () {}),
      get(SUPABASE_URL + "/rest/v1/agencies?select=id,slug,name,logo_url&city_id=eq." + page.cityId + "&order=name.asc&limit=48").then(function (x) {
        if (Array.isArray(x.data)) extras.agencies = x.data;
      }).catch(function () {}),
    ];
    return Promise.all(tasks).then(function () { return { rows: rows, extras: extras }; });
  }).then(function (packed) {
    box.innerHTML = S.render(page, packed.rows, packed.extras);
    box.setAttribute("data-ssr", "0");
    var h1 = document.getElementById("siloH1");
    var benefit = document.getElementById("siloBenefit");
    var crumb = document.getElementById("siloCrumb");
    var chips = document.getElementById("landChips");
    var updated = document.getElementById("landUpdated");
    var hero = document.getElementById("landHeroBg");
    var all = document.getElementById("landAll");
    var cityCrumb = document.getElementById("landCityCrumb");
    if (cityCrumb) {
      var city = S.cityOf(page);
      cityCrumb.textContent = city.name;
      cityCrumb.setAttribute("href", city.home);
    }
    if (h1) h1.textContent = page.h1;
    if (benefit) benefit.textContent = page.benefit || page.description;
    if (crumb) crumb.textContent = page.h1;
    if (chips) chips.innerHTML = S.chipsHtml(page, packed.rows, packed.extras);
    if (updated) updated.innerHTML = S.updatedHtml(packed.rows);
    if (hero) hero.innerHTML = S.heroHtml(packed.rows);
    if (all) {
      all.setAttribute("href", S.allHref(page));
      var n = packed.extras.counted ? packed.extras.total : (packed.rows.length < 24 ? packed.rows.length : 0);
      all.setAttribute("data-count", String(n || 0));
    }
    document.title = S.fullTitle(page);
  }).catch(function () {
    box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנכסים. נסו לרענן את הדף.</p>';
  });
})();
