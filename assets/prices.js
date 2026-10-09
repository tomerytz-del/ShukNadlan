/* ============================================================================
   ‏/prices בדפדפן - רק כשהשרת לא מילא את הטבלאות
   ----------------------------------------------------------------------------
   ‏`netlify/edge-functions/prices-page.ts` ממלא את הדף בשרת ומסמן
   `data-ssr`. כשהוא לא הספיק (‏timeout, מסד איטי), הקובץ הזה קורא לאותה
   פונקציה (‏`city_price_table()`) ובונה את אותן טבלאות עם אותו קוד
   (‏`assets/prices-render.js`). ‏docs/city-prices.md.
   ========================================================================== */
(function () {
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';

  function run() {
    var box = document.getElementById('pricesTables');
    if (!box || box.dataset.ssr || !window.ShukPrices) return;
    fetch(SUPABASE_URL + '/rest/v1/rpc/city_price_table', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        var reg = window.ShukMarkets;
        var list = (reg && reg.list) || [];
        var html = window.ShukPrices.render(rows, {
          labelFor: function (slug) {
            for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i].label;
            return '';
          },
          marketOrder: list.map(function (m) { return m.slug; })
        });
        if (!html) throw new Error('empty');
        box.innerHTML = html;
        var p = window.ShukPrices.period(rows);
        var span = document.getElementById('pricesPeriod');
        if (p && span) span.textContent = window.ShukPrices.heDate(p.start) + ' - ' + window.ShukPrices.heDate(p.end);
      })
      .catch(function () {
        box.innerHTML = '<p class="prices-note">לא הצלחנו לטעון את הנתונים כרגע. נסו לרענן את הדף בעוד דקה.</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
