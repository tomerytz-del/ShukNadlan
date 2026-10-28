/* ============================================================================
   ‏P1-U1: סינון משרדים ויועצי נדל״ן לפי התמחות ואזור, נגזר מהנכסים הפעילים.
   ----------------------------------------------------------------------------
   משותף ל-/agencies ול-/agents. דף הבית מחזיק את אותה גזירה ב-home.js
   (‏DM_FSPECS, ‏dmPropSpecs) - שינוי כלל כאן משנה גם שם, אחרת "צפייה בכל…"
   יפתח רשימה אחרת מזו שבדף הבית.

   פריט עובר אם יש לו לפחות נכס פעיל אחד שמתאים **גם** להתמחות **וגם** לאזור
   (חיתוך על אותו נכס). פריט בלי נכסים נופל להצהרה (‏specialties), רק כשלא
   נבחר אזור, ומוצג אחרי אלה עם הנכסים, בלי מונה.

   רק ב-?beta=1 (‏החלטה ד-21). בלי הדגל mount מחזיר null והדף כמו שהיה.
   הכתובת: ‏?dm_spec=rent&dm_area=hood:<id>|city:<id> - אותם פרמטרים כמו בדף הבית.
   ============================================================================ */
(function (global) {
  'use strict';

  var SPECS = [
    { key: 'sale',       label: 'מכירה',          phrase: 'למכירה',           words: 'מכירה למכירה קנייה' },
    { key: 'rent',       label: 'השכרה',          phrase: 'להשכרה',           words: 'השכרה שכירות להשכרה' },
    { key: 'commercial', label: 'מסחרי',          phrase: 'מסחריים',          words: 'מסחרי חנות קליניקה מחסן' },
    { key: 'projects',   label: 'פרויקטים חדשים', phrase: 'בפרויקטים חדשים',   words: 'פרויקט קבלן חדש מקבלן' },
    { key: 'houses',     label: 'בתים פרטיים',    phrase: '- בתים פרטיים',    words: 'בית פרטי וילה קוטג׳ קוטג\' דו משפחתי' },
    { key: 'land',       label: 'קרקעות',         phrase: '- קרקעות ומגרשים', words: 'קרקע מגרש משק נחלה' }
  ];
  var BY_KEY = {};
  SPECS.forEach(function (s) { BY_KEY[s.key] = s; });

  /* ההצהרה: agencies.specialties (קודים) ו-agency_members.specialties (תוויות עבריות) */
  var DECLARED = {
    residential_sale: 'sale', residential_rent: 'rent', commercial: 'commercial', industrial: 'commercial',
    new_projects: 'projects', land: 'land',
    'מגורים': 'sale', 'שכירות': 'rent', 'מסחרי': 'commercial', 'יזמות ופרויקטים': 'projects',
    'מגרשים וקרקעות': 'land', 'משקי בית ונחלות': 'land'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function on() {
    try {
      var q = new URLSearchParams(location.search).get('beta');
      if (q === '1') { try { localStorage.setItem('sk_beta_hero', '1'); } catch (e) {} return true; }
      if (q === '0') { try { localStorage.removeItem('sk_beta_hero'); } catch (e) {} return false; }
      return localStorage.getItem('sk_beta_hero') === '1';
    } catch (e) { return false; }
  }

  function propSpecs(p) {
    var out = [], t = String(p.property_type || '');
    if (p.deal_type === 'sale') out.push('sale');
    if (p.deal_type === 'rent') out.push('rent');
    if (p.category === 'commercial') out.push('commercial');
    if (String(p.project_status || '').trim()) out.push('projects');
    if (/^(בית פרטי\/קוטג'|דו משפחתי)$/.test(t)) out.push('houses');
    if (/מגרש|קרקע|משק|נחלה/.test(t)) out.push('land');
    return out;
  }

  function declaredKeys(list) {
    var s = {};
    (Array.isArray(list) ? list : []).forEach(function (v) { var k = DECLARED[String(v || '').trim()]; if (k) s[k] = 1; });
    return Object.keys(s);
  }

  /* opts: { host, items:[{id, declared?}], props, idKey, tab:'agencies'|'agents', surface,
            mainCity, onChange } */
  function mount(opts) {
    if (!on() || !opts || !opts.host) return null;
    var tab = opts.tab, byId = new Map(), areas = new Map();
    (opts.props || []).forEach(function (p) {
      var id = p[opts.idKey];
      if (!id) return;
      var hood = p.neighborhood_id, area = hood ? 'hood:' + hood : p.city_id ? 'city:' + p.city_id : null;
      if (area && !areas.has(area)) {
        areas.set(area, { label: hood ? ((p.neighborhoods && p.neighborhoods.name) || p.city || '') : (p.city || ''), hood: !!hood });
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ specs: propSpecs(p), area: area });
    });
    var decl = new Map();
    (opts.items || []).forEach(function (it) { decl.set(it.id, declaredKeys(it.declared)); });

    var params = new URLSearchParams(location.search);
    var st = {
      spec: BY_KEY[params.get('dm_spec')] ? params.get('dm_spec') : 'all',
      area: /^(hood|city):[\w-]+$/.test(params.get('dm_area') || '') ? params.get('dm_area') : 'all'
    };

    function count(id, spec, area) {
      return (byId.get(id) || []).filter(function (r) {
        return (spec === 'all' || r.specs.indexOf(spec) >= 0) && (area === 'all' || r.area === area);
      }).length;
    }
    /* ‏null = לא עובר; ‏{n} עם נכסים; ‏{n:0, decl:true} לפי הצהרה בלבד */
    function match(id) {
      var n = count(id, st.spec, st.area);
      if (n > 0) return { n: n };
      if (st.area === 'all' && st.spec !== 'all' && !(byId.get(id) || []).length &&
          (decl.get(id) || []).indexOf(st.spec) >= 0) return { n: 0, decl: true };
      return null;
    }

    var mainCity = opts.mainCity || 'עפולה';
    var box = document.createElement('div');
    box.className = 'dmf';
    box.innerHTML =
      '<div class="dmf-row"><span class="tool-label" id="dmfSpecLabel">התמחות</span>' +
      '<div class="pill-group dmf-chips" role="group" aria-labelledby="dmfSpecLabel"></div></div>' +
      '<div class="dmf-row"><span class="tool-label"><label for="dmfArea">אזור</label></span>' +
      '<select id="dmfArea" class="dmf-area"></select></div>' +
      '<p class="dmf-count" aria-live="polite"></p>';
    opts.host.appendChild(box);
    var chips = box.querySelector('.dmf-chips'), sel = box.querySelector('.dmf-area'), countEl = box.querySelector('.dmf-count');

    function fill() {
      var ids = (opts.items || []).map(function (it) { return it.id; });
      var has = function (k) { return ids.some(function (id) { return count(id, k, 'all') > 0; }); };
      chips.innerHTML = [{ key: 'all', label: 'הכל' }].concat(SPECS.filter(function (x) { return has(x.key) || st.spec === x.key; }))
        .map(function (x) {
          return '<button type="button" class="pill" data-fspec="' + x.key + '" aria-pressed="' + (st.spec === x.key) + '">' + esc(x.label) + '</button>';
        }).join('');
      var n = new Map();
      ids.forEach(function (id) { (byId.get(id) || []).forEach(function (r) { if (r.area) n.set(r.area, (n.get(r.area) || 0) + 1); }); });
      var sorted = Array.from(n.entries()).sort(function (a, b) { return b[1] - a[1]; });
      var opt = function (e) {
        return '<option value="' + esc(e[0]) + '">' + esc(areas.get(e[0]).label + ' · ' + e[1]) + '</option>';
      };
      var hoods = sorted.filter(function (e) { return areas.get(e[0]).hood; });
      var towns = sorted.filter(function (e) { return !areas.get(e[0]).hood; });
      sel.innerHTML = '<option value="all">כל האזורים</option>' +
        (hoods.length ? '<optgroup label="שכונות ב' + esc(mainCity) + '">' + hoods.map(opt).join('') + '</optgroup>' : '') +
        (towns.length ? '<optgroup label="יישובים נוספים">' + towns.map(opt).join('') + '</optgroup>' : '');
      if (st.area !== 'all' && !n.has(st.area)) st.area = 'all';
      sel.value = st.area;
    }
    function writeUrl() {
      try {
        var u = new URL(location.href);
        u.searchParams.delete('dm_spec'); u.searchParams.delete('dm_area'); u.searchParams.delete('dm_tab');
        if (st.spec !== 'all') u.searchParams.set('dm_spec', st.spec);
        if (st.area !== 'all') u.searchParams.set('dm_area', st.area);
        history.replaceState(history.state, '', u);
      } catch (e) { /* דפדפן שחוסם היסטוריה */ }
    }
    var lastN = 0, lastEmpty = '';
    function changed(filter, value) {
      fill(); writeUrl(); opts.onChange();
      if (global.shukTrack) global.shukTrack('dm_filter', { tab: tab, filter: filter, value: value, results: lastN, surface: opts.surface });
    }
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fspec]');
      if (!b || b.dataset.fspec === st.spec) return;
      st.spec = b.dataset.fspec; changed('spec', st.spec);
    });
    sel.addEventListener('change', function () {
      st.area = sel.value; changed('area', st.area === 'all' ? 'all' : st.area.split(':')[0]);
    });

    function active() { return st.spec !== 'all' || st.area !== 'all'; }
    function phrase(n) {
      var sp = BY_KEY[st.spec], al = st.area !== 'all' && areas.get(st.area) ? 'ב' + areas.get(st.area).label : '';
      return [n === 1 ? 'נכס' : 'נכסים', sp ? sp.phrase.replace(/^- /, '') : 'פעילים', al].filter(Boolean).join(' ');
    }
    var noun = tab === 'agents' ? 'יועצי נדל״ן' : 'משרדי תיווך';
    var one = tab === 'agents' ? 'יועץ נדל״ן אחד' : 'משרד תיווך אחד';

    fill();
    return {
      active: active,
      /* הרשימה אחרי שאר הסינונים של הדף: מסננת, ממיינת לפי מספר הנכסים שבסינון, ומסמנת */
      apply: function (list, byName) {
        if (!active()) return list;
        var withN = [], declOnly = [];
        list.forEach(function (it) {
          var m = match(it.id);
          if (!m) return;
          var copy = Object.assign({}, it, { rankBadge: null, dmN: m.n,
            dmText: m.decl ? 'מתמחה ב' + BY_KEY[st.spec].label : phrase(m.n) });
          (m.decl ? declOnly : withN).push(copy);
        });
        withN.sort(function (a, b) { return b.dmN - a.dmN || (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating) || byName(a, b); });
        declOnly.sort(byName);
        return withN.concat(declOnly);
      },
      after: function (list) {
        lastN = list.length;
        countEl.textContent = active() ? (list.length === 1 ? one : list.length + ' ' + noun) : '';
        var key = st.spec + '|' + st.area;
        if (active() && !list.length && key !== lastEmpty) {
          lastEmpty = key;
          if (global.shukTrack) global.shukTrack('dm_filter_empty', { tab: tab, spec: st.spec, area: st.area === 'all' ? 'all' : st.area.split(':')[0] });
        }
      },
      emptyHtml: function () {
        var sp = BY_KEY[st.spec], al = st.area !== 'all' && areas.get(st.area) ? ' ב' + areas.get(st.area).label : '';
        var what = 'עם נכסים פעילים' + (sp ? ' ' + sp.phrase.replace(/^- /, '') : '') + al;
        return '<p>' + esc((tab === 'agents' ? 'לא מצאנו יועצי נדל״ן ' : 'לא מצאנו משרד תיווך ') + what + '.') + '</p>' +
          '<p class="dmf-empty-acts">' + (st.area !== 'all' ? '<button type="button" class="pill" data-dm-clear="area">להציג את כל האזורים</button> ' : '') +
          '<button type="button" class="pill" data-dm-clear="all">לנקות את הסינון</button></p>';
      },
      clear: function (what) {
        st.area = 'all';
        if (what === 'all') st.spec = 'all';
        fill(); writeUrl(); opts.onChange();
        if (global.shukTrack) global.shukTrack('dm_filter_clear', { tab: tab });
      },
      /* מילים לחיפוש החופשי: מילות ההתמחות ושמות האזורים של הנכסים */
      words: function (id) {
        var sp = {}, ar = {};
        (byId.get(id) || []).forEach(function (r) {
          r.specs.forEach(function (k) { sp[k] = 1; });
          if (r.area && areas.get(r.area)) ar[areas.get(r.area).label] = 1;
        });
        return Object.keys(sp).map(function (k) { return BY_KEY[k].words; }).concat(Object.keys(ar)).join(' ');
      }
    };
  }

  global.DmFilters = { on: on, SPECS: SPECS, propSpecs: propSpecs, declaredKeys: declaredKeys, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : window);
