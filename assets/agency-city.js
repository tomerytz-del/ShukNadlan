/* ============================================================================
   ‏AgencyCity - בחירת עיר המשרד בפתיחת משרד

   שני מסלולי הפתיחה (agency-signup, והכרטיס "פתיחת המשרד שלי" ב-CRM) יצרו
   עד היום משרד בלי עיר, ומשרד כזה אינו נספר באף שוק מקומי - ובאתר הפומבי
   הוא מופיע בשוק ברירת המחדל גם אם הוא בנתניה. ‏20270115101000,
   docs/regional-pages.md ("משרד בלי עיר").

   רשימה סגורה של ערי השווקים (‏market_city_names), מקובצת לפי שוק ושמות
   השווקים מ-assets/markets.js, ובתחתית "עיר אחרת…" לטקסט חופשי - בדיוק כמו
   בחירת העיר בטופס הנכס ב-CRM. השרת מפענח את הטקסט (‏city_id_for_name),
   ואם לא הכיר אותו המשרד נפתח בכל זאת, ומקבל עיר מהנכס הראשון שלו.

       AgencyCity.mount(selectEl, otherInputEl, { url, key })
       AgencyCity.value(selectEl, otherInputEl)  // {city_id} | {city_name} | null

   הרשימה נבנית ב-DOM (‏textContent), ולא ב-innerHTML - אין מה לברוח.
   ============================================================================ */
(function (g) {
  'use strict';

  var OTHER = '__other__';

  function labelOf(slug) {
    var M = g.ShukMarkets;
    var m = M && typeof M.bySlug === 'function' ? M.bySlug(slug) : null;
    return m ? m.label : slug;
  }

  function orderOf(slug) {
    var list = (g.ShukMarkets && g.ShukMarkets.list) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return i;
    return list.length;
  }

  function option(value, text) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  function syncOther(sel, other) {
    if (!other) return;
    var on = sel.value === OTHER;
    other.style.display = on ? '' : 'none';
    other.required = on;
    if (!on) other.value = '';
  }

  function render(sel, other, rows) {
    var groups = {};
    rows.forEach(function (r) {
      if (!r || !r.id || !r.name || !r.market_slug) return;
      (groups[r.market_slug] = groups[r.market_slug] || []).push(r);
    });
    sel.textContent = '';
    sel.appendChild(option('', 'בחרו את עיר המשרד'));
    Object.keys(groups)
      .sort(function (a, b) { return orderOf(a) - orderOf(b); })
      .forEach(function (slug) {
        var og = document.createElement('optgroup');
        og.label = labelOf(slug);
        groups[slug]
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'he'); })
          .forEach(function (r) { og.appendChild(option(r.id, r.name)); });
        sel.appendChild(og);
      });
    sel.appendChild(option(OTHER, 'עיר אחרת…'));
    syncOther(sel, other);
  }

  /** ממלא את הרשימה. בכשל ברשת - רק "עיר אחרת…", כדי שאפשר יהיה להירשם. */
  function mount(sel, other, conf) {
    if (!sel) return Promise.resolve();
    sel.addEventListener('change', function () { syncOther(sel, other); });
    render(sel, other, []);
    if (!conf || !conf.url || !conf.key || typeof fetch !== 'function') return Promise.resolve();
    var endpoint = conf.url + '/rest/v1/market_city_names?select=id,name,market_slug&order=name';
    return fetch(endpoint, { headers: { apikey: conf.key, Authorization: 'Bearer ' + conf.key } })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) { render(sel, other, Array.isArray(rows) ? rows : []); })
      .catch(function (e) { if (g.console) console.warn('רשימת הערים לא נטענה:', e); });
  }

  /** מה לשלוח לשרת: ‏{city_id} מהרשימה, ‏{city_name} מ"עיר אחרת…", או null. */
  function value(sel, other) {
    if (!sel || !sel.value) return null;
    if (sel.value === OTHER) {
      var name = other ? String(other.value || '').trim() : '';
      return name ? { city_name: name } : null;
    }
    return { city_id: sel.value };
  }

  g.AgencyCity = { mount: mount, value: value, OTHER: OTHER };
})(typeof window !== 'undefined' ? window : globalThis);
