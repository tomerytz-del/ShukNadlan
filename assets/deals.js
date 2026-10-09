/* ============================================================================
   ‏/deals ו-/deals/{slug} בדפדפן
   ----------------------------------------------------------------------------
   שני תפקידים:

     ‏· מילוי, רק כשהשרת לא הספיק (אין `data-ssr`): ‏`deals-page.ts` ממלא את
       הדף בשרת. כשלא (‏timeout, מסד איטי) הקובץ הזה קורא לאותה פונקציה
       ובונה את אותו HTML עם אותו קוד (‏`assets/deals-render.js`).
     ‏· מיון העסקאות האחרונות - בכותרות העמודות ובתיבת הבחירה (בטלפון
       הטבלה הופכת לכרטיסים ואין כותרות). הנתונים לא נשלפים שוב: השרת
       מטמיע אותם ב-`#dealsData`.

   ‏docs/settlement-deals.md.
   ========================================================================== */
(function () {
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';

  var recent = [];
  var sortKey = 'date_desc';

  function slugFromPath() {
    var m = /^\/deals\/([a-z0-9-]+)\/?$/.exec(location.pathname);
    return m ? m[1] : '';
  }

  function rpc(name, body) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function applySort(key) {
    var D = window.ShukDeals;
    var body = document.querySelector('#dealsRecent tbody');
    if (!D || !body || !recent.length) return;
    sortKey = key;
    body.innerHTML = D.recentRows(D.sortRows(recent, key));
    var sel = document.getElementById('dealsSort');
    if (sel && sel.value !== key) {
      /* ‏מיון שאין לו שורה בתיבה (‏rooms_asc) - התיבה נשארת כמו שהיא. */
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === key) sel.value = key;
    }
    var col = key.replace(/_(asc|desc)$/, '');
    document.querySelectorAll('#dealsRecent .deals-sort').forEach(function (b) {
      if (b.dataset.sort === col) b.setAttribute('aria-sort', /_asc$/.test(key) ? 'ascending' : 'descending');
      else b.removeAttribute('aria-sort');
    });
  }

  function wireSort() {
    var sel = document.getElementById('dealsSort');
    if (sel) sel.addEventListener('change', function () { applySort(sel.value); });
    var table = document.getElementById('dealsRecent');
    if (table) table.addEventListener('click', function (e) {
      var b = e.target.closest('.deals-sort');
      if (!b) return;
      var col = b.dataset.sort;
      /* לחיצה ראשונה - מהגבוה/החדש; שנייה על אותה עמודה - הפוך. */
      var next = sortKey === col + '_desc' ? col + '_asc' : col + '_desc';
      applySort(next);
    });
    applySort(sortKey);
  }

  function readEmbedded() {
    var el = document.getElementById('dealsData');
    if (!el) return null;
    try { return JSON.parse(el.textContent || 'null'); } catch (e) { return null; }
  }

  function fail(box) {
    box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנתונים כרגע. נסו לרענן את הדף בעוד דקה.</p>';
  }

  function run() {
    var D = window.ShukDeals;
    var box = document.getElementById('dealsBody');
    if (!box || !D) return;
    var slug = slugFromPath();

    if (box.dataset.ssr) {
      var d = readEmbedded();
      recent = (d && d.recent) || [];
      wireSort();
      return;
    }

    if (!slug) {
      rpc('deal_settlements_public')
        .then(function (list) {
          var html = D.renderIndex(list);
          if (!html) throw new Error('empty');
          box.innerHTML = html;
        })
        .catch(function () { fail(box); });
      return;
    }

    rpc('deal_settlement_page', { p_slug: slug })
      .then(function (data) {
        if (!data) {
          box.innerHTML = '<p class="deals-note">היישוב לא נמצא. <a href="/deals">לכל היישובים</a>.</p>';
          return;
        }
        box.innerHTML = D.renderSettlement(data);
        var t = D.title(data);
        document.title = t + ' | שוק נדל״ן';
        var h1 = document.getElementById('dealsH1');
        if (h1) h1.textContent = t;
        var lead = document.getElementById('dealsLead');
        if (lead) lead.textContent = D.description(data);
        recent = data.recent || [];
        wireSort();
      })
      .catch(function () { fail(box); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
