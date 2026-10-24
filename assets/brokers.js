/* מילוי רק כשאין data-ssr. brokers-page.ts ממלא לפני שהתשובה יוצאת. */
(function () {
  var SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
  var box = document.getElementById("brokersBody");
  var B = window.ShukBrokers;
  if (!box || box.getAttribute("data-ssr") === "1" || !B || !B.pageOf(location.pathname)) return;

  function get(path, opts) {
    return fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: (opts && opts.method) || "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + SUPABASE_ANON_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: opts && opts.body ? opts.body : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error("status");
      return res.json();
    });
  }

  get("agencies?" + B.agencyQuery()).then(function (agencies) {
    if (!Array.isArray(agencies)) throw new Error("shape");
    return Promise.all([
      Promise.resolve(agencies),
      get("agency_members_public?select=slug,display_name,agency_id&is_active_agent=eq.true&order=display_name.asc&limit=1000").catch(function () { return []; }),
      get("rpc/homepage_agency_cards", { method: "POST", body: "{}" }).catch(function () { return []; }),
    ]);
  }).then(function (parts) {
    var agencies = parts[0];
    var ids = {};
    var counts = {};
    (parts[2] || []).forEach(function (row) {
      if (row && row.agency_id) counts[row.agency_id] = row.active_count;
    });
    agencies.forEach(function (a) {
      ids[a.id] = a.name;
      a.active_count = counts[a.id] || 0;
    });
    var agents = (parts[1] || []).filter(function (m) { return m && m.slug && ids[m.agency_id]; })
      .map(function (m) { return { slug: m.slug, display_name: m.display_name, agency_name: ids[m.agency_id] }; });
    box.innerHTML = B.render({ agencies: agencies, agents: agents });
    box.setAttribute("data-ssr", "0");
  }).catch(function () {
    box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את המשרדים. נסו לרענן את הדף.</p>';
  });
})();
