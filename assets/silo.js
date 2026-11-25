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
    var extras = { total: match ? Number(match[1]) : rows.length, counted: !!match, hoods: null, related: [], agencies: [], stock: [] };
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
    var ids = [];
    if (S.isCommercial && S.isCommercial(page)) {
      rows.forEach(function (r) { if (r.agent_id && ids.indexOf(r.agent_id) < 0 && /^[0-9a-f-]{36}$/i.test(r.agent_id)) ids.push(r.agent_id); });
      if (ids.length) tasks.push(get(SUPABASE_URL + "/rest/v1/agency_members_public?select=id,display_name,phone_e164&id=in.(" + ids.join(",") + ")").then(function (x) {
        if (!Array.isArray(x.data)) return;
        var map = {};
        x.data.forEach(function (row) { if (row.id && row.phone_e164) map[row.id] = { name: row.display_name || "", phone: row.phone_e164 }; });
        extras.contacts = map;
      }).catch(function () {}));
    }
    if (page.dynamicStock && S.stockQuery) {
      tasks.push(get(SUPABASE_URL + "/rest/v1/properties?" + S.stockQuery(page)).then(function (x) {
        if (Array.isArray(x.data)) extras.stock = x.data;
      }).catch(function () {}));
    }
    return Promise.all(tasks).then(function () { return { rows: rows, extras: extras }; });
  }).then(function (packed) {
    var view = S.withStock ? S.withStock(page, packed.rows, packed.extras) : page;
    box.innerHTML = S.render(view, packed.rows, packed.extras);
    box.setAttribute("data-ssr", "0");
    var heroSection = document.getElementById("landHero");
    var compact = !!(S.isCommercial && S.isCommercial(page));
    if (heroSection && compact) heroSection.classList.add("land-hero--compact");
    if (compact) {
      /* ‏בלי הפונקציה אין הזרקה בשרת: טוענים כאן את נכסי הדף המסחרי. הסקריפט מאתחל את עצמו כשהוא עולה. */
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "assets/silo-commercial.css";
      document.head.appendChild(css);
      ["silo-commercial", "visit-attr", "contact-inquiry"].forEach(function (name) {
        var sc = document.createElement("script");
        sc.src = "assets/" + name + ".js";
        document.head.appendChild(sc);
      });
    }
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
      cityCrumb.textContent = view.crumbHere ? (view.crumbName || city.name) : city.name;
      cityCrumb.setAttribute("href", view.crumbHere ? (view.crumbPath || city.home) : city.home);
    }
    if (h1) h1.textContent = view.h1;
    if (benefit) benefit.textContent = view.benefit || view.description;
    if (crumb) crumb.textContent = view.crumbHere || view.h1;
    if (chips) chips.innerHTML = S.chipsHtml(view, packed.rows, packed.extras);
    if (updated) updated.innerHTML = S.updatedHtml(packed.rows);
    if (hero) hero.innerHTML = S.heroHtml(view);
    if (S.heroPreload) {
      var old = document.querySelectorAll('link[rel="preload"][as="image"]');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      document.head.insertAdjacentHTML("beforeend", S.heroPreload(view));
    }
    if (all) {
      all.setAttribute("href", S.allHref(view));
      var n = compact ? 0 : packed.extras.counted ? packed.extras.total : (packed.rows.length < 24 ? packed.rows.length : 0);
      all.setAttribute("data-count", String(n || 0));
    }
    document.title = S.fullTitle(view);
  }).catch(function () {
    box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנכסים. נסו לרענן את הדף.</p>';
  });
})();
