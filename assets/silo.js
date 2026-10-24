/* מילוי רק כשהשרת לא הספיק (אין data-ssr). silo-page.ts ממלא את הדף
   לפני שהתשובה יוצאת; כאן רק 503 או דף שנפתח בלי הפונקציה. */
(function () {
  var SUPABASE_URL = "https://obookujgolazrwycsiyn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx";
  var box = document.getElementById("siloBody");
  if (!box || box.getAttribute("data-ssr") === "1" || !window.ShukSilo) return;
  var page = window.ShukSilo.pageOf(location.pathname);
  if (!page) return;

  fetch(SUPABASE_URL + "/rest/v1/properties?" + window.ShukSilo.queryOf(page), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      Accept: "application/json",
    },
  }).then(function (res) {
    if (!res.ok) throw new Error("status");
    return res.json();
  }).then(function (rows) {
    if (!Array.isArray(rows)) throw new Error("shape");
    box.innerHTML = window.ShukSilo.render(page, rows);
    box.setAttribute("data-ssr", "0");
    var h1 = document.getElementById("siloH1");
    var lead = document.getElementById("siloLead");
    if (h1) h1.textContent = page.h1;
    if (lead) lead.textContent = page.description;
    document.title = window.ShukSilo.fullTitle(page);
  }).catch(function () {
    box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנכסים. נסו לרענן את הדף.</p>';
  });
})();
