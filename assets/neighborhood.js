/* ============================================================================
   ‏/n/{עיר}/{שכונה} בדפדפן
   ----------------------------------------------------------------------------
   מילוי רק כשהשרת לא הספיק (אין `data-ssr`): ‏`neighborhood-page.ts` ממלא את
   הדף בשרת. כשלא (‏timeout, מסד איטי) הקובץ הזה קורא לאותה פונקציה ובונה את
   אותו HTML עם אותו קוד (‏`assets/neighborhood-render.js`).
   ‏docs/neighborhood-pages.md.
   ========================================================================== */
(function () {
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';

  /* ‏/n/afula/%D7%92... → ['afula', 'גבעת-המורה'] */
  function partsFromPath() {
    var m = /^\/n\/([^/]+)\/([^/]+)\/?$/.exec(location.pathname);
    if (!m) return null;
    try { return [decodeURIComponent(m[1]).toLowerCase(), decodeURIComponent(m[2])]; } catch (e) { return null; }
  }

  function run() {
    var H = window.ShukHood;
    var box = document.getElementById('dealsBody');
    if (!box || !H || box.dataset.ssr) return;
    var parts = partsFromPath();
    if (!parts) {
      box.innerHTML = '<p class="deals-note">השכונה לא נמצאה. <a href="/">לדף הבית</a>.</p>';
      return;
    }
    fetch(SUPABASE_URL + '/rest/v1/rpc/neighborhood_page', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_city: parts[0], p_slug: parts[1] })
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d) {
        box.innerHTML = '<p class="deals-note">השכונה לא נמצאה. <a href="/">לדף הבית</a>.</p>';
        return;
      }
      box.innerHTML = H.render(d);
      var t = H.title(d);
      document.title = t + ' | שוק נדל״ן';
      var h1 = document.getElementById('dealsH1');
      if (h1) h1.textContent = 'שכונת ' + d.name + ', ' + d.city;
      var lead = document.getElementById('dealsLead');
      if (lead) lead.textContent = H.description(d);
    }).catch(function () {
      box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנתונים כרגע. נסו לרענן את הדף בעוד דקה.</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
