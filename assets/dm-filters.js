/* ============================================================================
   ‏P1-U1 / R8: סינון משרדים ויועצי נדל״ן לפי התמחות ואזור - רכיב אחד לשלושה דפים
   (דף הבית, ‏/agents, ‏/agencies). ‏docs/advisor-search.md.
   ----------------------------------------------------------------------------
   הכלל: פריט עובר אם יש לו לפחות נכס פעיל אחד שמתאים **גם** להתמחות **וגם** לאזור
   (חיתוך על אותו נכס). בתוך קבוצה - "או", בין קבוצות - "וגם". פריט בלי נכסים נופל
   להצהרה (‏specialties), רק כשלא נבחר אזור, ומוצג אחרי אלה עם הנכסים.

   בחירה מרובה (כמו הסינון של הנכסים): צ'יפים עם מונה של **פריטים** (לא נכסים), וכל צ'יפ
   סופר את הקבוצה שלו כאילו רק הוא נבחר בה, עם הבחירה של הקבוצה השנייה ועם שאר הסינונים
   של הדף. צ'יפ שאין לו אף פריט בלשונית לא מוצג; 0 תחת הבחירה הנוכחית - מנוטרל.
   האזור: "כל <העיר>" לפי city_id (גם נכס שיש לו שכונה), שכונות, ויישובים נוספים.

   מחשב (760 ומעלה): שורות בתוך הסרגל. טלפון: כפתור "סינון לפי התמחות ואזור" עם מונה,
   הבחירות כצ'יפים עם ✕, וגיליון תחתון עם טיוטה שמוחלת ב"הצגת N".
   הכתובת: ‏?dm_spec=commercial,rent&dm_area=hood:<id>,city:<id> (ערך יחיד ישן עדיין נקרא).
   רק ב-?beta=1 (‏החלטה ד-21). בלי הדגל mount מחזיר null והדף כמו שהיה.
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
  var AREA_INLINE = 6;   // במחשב: "כל <העיר>" ועוד 6 שכונות בשורה, השאר מאחורי "עוד"

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

  /* העיצוב (‏assets/filter-ui.css) נטען מכאן ולא ב-<link> בדף: הרכיב רק ב-beta, ורחוק
     מהמסך הראשון - בלי בקשה שחוסמת ציור (‏CLAUDE.md, "ה-CSS נשאר מוטבע") */
  if (on() && typeof document !== 'undefined' && !document.getElementById('filterUiCss')) {
    var l = document.createElement('link');
    l.id = 'filterUiCss'; l.rel = 'stylesheet'; l.href = '/assets/filter-ui.css';
    document.head.appendChild(l);
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

  /* כתובת: רשימה בפסיקים, וערך יחיד ישן */
  function readList(v, ok) {
    return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && ok(x) && a.indexOf(x) === i; });
  }
  var AREA_RE = /^(hood|city):[\w-]+$/;

  /* opts: { host, tabs: { <tab>: { items:[{id, declared}], idKey } } | items + idKey + tab,
            tab, props, surface, mainCity, onChange, countLine (דף הבית), sheetRows:[el] (/agents),
            placeholderEl + placeholders {long, short} } */
  function mount(opts) {
    if (!on() || !opts || !opts.host) return null;
    var tabs = opts.tabs || {};
    if (!opts.tabs) tabs[opts.tab] = { items: opts.items || [], idKey: opts.idKey };
    var tab = opts.tab || Object.keys(tabs)[0];
    var mainCity = opts.mainCity || 'עפולה';
    var mq = global.matchMedia ? global.matchMedia('(max-width:759px)') : { matches: false };

    /* ---------- האינדקס: לכל פריט - הנכסים שלו (התמחויות ואזורים) ---------- */
    var idx = {}, areas = new Map(), mainKey = null;
    function build(props) {
      idx = {}; areas = new Map(); mainKey = null;
      Object.keys(tabs).forEach(function (t) { idx[t] = new Map(); });
      (props || []).forEach(function (p) {
        var hoodName = p.neighborhood_name || (p.neighborhoods && p.neighborhoods.name) || '';
        var keys = [];
        if (p.city_id) {
          var ck = 'city:' + p.city_id;
          keys.push(ck);
          if (!areas.has(ck)) areas.set(ck, { label: p.city || '', kind: 'town' });
          if (!mainKey && p.city && p.city === mainCity) mainKey = ck;
        }
        if (p.neighborhood_id) {
          var hk = 'hood:' + p.neighborhood_id;
          keys.push(hk);
          if (!areas.has(hk)) areas.set(hk, { label: hoodName || p.city || '', kind: 'hood' });
        }
        var rec = { specs: propSpecs(p), areas: keys };
        Object.keys(tabs).forEach(function (t) {
          var id = p[tabs[t].idKey];
          if (!id) return;
          if (!idx[t].has(id)) idx[t].set(id, []);
          idx[t].get(id).push(rec);
        });
      });
      // העיר הראשית: לפי השם, ואם שם השוק אינו שם עיר ("עפולה והעמק") - העיר עם הכי הרבה נכסים
      if (!mainKey) {
        var cnt = {};
        (props || []).forEach(function (p) { if (p.city_id) cnt['city:' + p.city_id] = (cnt['city:' + p.city_id] || 0) + 1; });
        Object.keys(cnt).forEach(function (k) { if (!mainKey || cnt[k] > cnt[mainKey]) mainKey = k; });
      }
      if (mainKey) areas.get(mainKey).kind = 'main';
      Object.keys(tabs).forEach(function (t) {
        tabs[t].decl = new Map();
        tabs[t].items.forEach(function (it) { tabs[t].decl.set(it.id, declaredKeys(it.declared)); });
      });
    }
    build(opts.props);

    var params = new URLSearchParams(location.search);
    var st = {
      spec: readList(params.get('dm_spec'), function (k) { return !!BY_KEY[k]; }),
      area: readList(params.get('dm_area'), function (k) { return AREA_RE.test(k); })
    };
    var pool = null;   // הפריטים אחרי שאר הסינונים של הדף (מ-apply האחרון)

    /* ‏null = לא עובר; ‏{n} עם נכסים; ‏{n:0, decl:true} לפי הצהרה בלבד */
    function matchIn(t, id, spec, area) {
      var rows = idx[t].get(id) || [], n = 0;
      rows.forEach(function (r) {
        if (spec.length && !spec.some(function (k) { return r.specs.indexOf(k) >= 0; })) return;
        if (area.length && !area.some(function (k) { return r.areas.indexOf(k) >= 0; })) return;
        n++;
      });
      if (n > 0) return { n: n };
      if (!spec.length && !area.length) return { n: 0 };
      if (!area.length && spec.length && !rows.length) {
        var d = tabs[t].decl.get(id) || [];
        if (spec.some(function (k) { return d.indexOf(k) >= 0; })) return { n: 0, decl: true };
      }
      return null;
    }
    function items() { return tabs[tab].items; }
    function countFor(list, spec, area) {
      return list.filter(function (it) { return matchIn(tab, it.id, spec, area); }).length;
    }
    function active() { return st.spec.length > 0 || st.area.length > 0; }

    /* ---------- האפשרויות בלשונית ---------- */
    function specOpts() {
      return SPECS.filter(function (s) { return st.spec.indexOf(s.key) >= 0 || countFor(items(), [s.key], []) > 0; });
    }
    function areaOpts() {
      var n = new Map();
      items().forEach(function (it) {
        var seen = {};
        (idx[tab].get(it.id) || []).forEach(function (r) { r.areas.forEach(function (k) { seen[k] = 1; }); });
        Object.keys(seen).forEach(function (k) { n.set(k, (n.get(k) || 0) + 1); });
      });
      var all = Array.from(areas.keys()).filter(function (k) { return n.get(k) || st.area.indexOf(k) >= 0; })
        .sort(function (a, b) { return (n.get(b) || 0) - (n.get(a) || 0); });
      return {
        main: all.filter(function (k) { return areas.get(k).kind === 'main'; }),
        hoods: all.filter(function (k) { return areas.get(k).kind === 'hood'; }),
        towns: all.filter(function (k) { return areas.get(k).kind === 'town'; })
      };
    }
    function areaLabel(k) {
      var a = areas.get(k);
      if (!a) return '';
      return a.kind === 'main' ? 'כל ' + a.label : a.label;
    }

    /* ---------- הצ'יפים (אותו מראה כמו הסינון של הנכסים) ---------- */
    function chip(group, key, label, sel, n) {
      var on_ = sel.indexOf(key) >= 0;
      return '<button type="button" class="dmf-chip" data-g="' + group + '" data-v="' + esc(key) + '" aria-pressed="' + on_ + '"' +
        (n === 0 && !on_ ? ' disabled' : '') + '>' + esc(label) + (n != null ? ' <span class="dmf-n">' + n + '</span>' : '') + '</button>';
    }
    // מונה: הקבוצה כאילו רק הצ'יפ הזה נבחר בה, עם הקבוצה השנייה ועם שאר הסינונים של הדף
    function nSpec(k, s) { return countFor(pool || items(), [k], s.area); }
    function nArea(k, s) { return countFor(pool || items(), s.spec, [k]); }
    function specChips(s) {
      return specOpts().map(function (x) { return chip('spec', x.key, x.label, s.spec, nSpec(x.key, s)); }).join('');
    }
    function areaChipsDesktop(s) {
      var o = areaOpts(), head = o.main.concat(o.hoods.slice(0, AREA_INLINE)), rest = o.hoods.slice(AREA_INLINE).concat(o.towns);
      // נבחר/ה מתוך "עוד" נשאר/ת גלוי/ה
      rest.filter(function (k) { return s.area.indexOf(k) >= 0; }).forEach(function (k) { head.push(k); });
      rest = rest.filter(function (k) { return head.indexOf(k) < 0; });
      return head.map(function (k) { return chip('area', k, areaLabel(k), s.area, nArea(k, s)); }).join('') +
        (rest.length ? '<button type="button" class="dmf-more-btn" aria-expanded="' + moreOpen + '">עוד שכונות ויישובים ' + rest.length + ' <span aria-hidden="true">▾</span></button>' +
          '<div class="dmf-more"' + (moreOpen ? '' : ' hidden') + '>' + rest.map(function (k) { return chip('area', k, areaLabel(k), s.area, nArea(k, s)); }).join('') + '</div>' : '');
    }
    function areaChipsSheet(s) {
      var o = areaOpts(), out = '';
      if (o.main.length || o.hoods.length) {
        out += '<p class="dmf-sub">שכונות ב' + esc(mainKey && areas.get(mainKey) ? areas.get(mainKey).label : mainCity) + '</p><div class="dmf-chips">' +
          o.main.concat(o.hoods).map(function (k) { return chip('area', k, areaLabel(k), s.area, nArea(k, s)); }).join('') + '</div>';
      }
      if (o.towns.length) {
        out += '<p class="dmf-sub">יישובים נוספים</p><div class="dmf-chips">' +
          o.towns.map(function (k) { return chip('area', k, areaLabel(k), s.area, nArea(k, s)); }).join('') + '</div>';
      }
      return out;
    }

    /* ---------- המחשב: שורות בתוך הסרגל ---------- */
    var moreOpen = false;
    var box = document.createElement('div');
    box.className = 'dmf';
    opts.host.appendChild(box);
    var noun = function (t) { return t === 'agents' ? 'יועצי נדל״ן' : 'משרדי תיווך'; };
    function renderDesktop() {
      var so = specChips(st);
      box.innerHTML =
        '<div class="dmf-d">' +
        (so ? '<div class="dmf-row"><span class="dmf-lbl" id="dmfSpecL">התמחות</span><div class="dmf-chips" role="group" aria-labelledby="dmfSpecL">' + so + '</div></div>' : '') +
        '<div class="dmf-row"><span class="dmf-lbl" id="dmfAreaL">אזור</span><div class="dmf-chips" role="group" aria-labelledby="dmfAreaL">' + areaChipsDesktop(st) + '</div></div>' +
        (opts.countLine ? '<p class="dmf-count" aria-live="polite"></p>' : '') +
        '</div>' +
        '<div class="dmf-m">' +
        '<button type="button" class="dmf-open" aria-haspopup="dialog">סינון לפי התמחות ואזור' +
        (active() ? ' <b class="dmf-badge">' + (st.spec.length + st.area.length) + '</b>' : '') + '</button>' +
        (active() ? '<div class="dmf-picked">' + st.spec.map(function (k) { return pick('spec', k, BY_KEY[k].label); }).join('') +
          st.area.map(function (k) { return pick('area', k, areaLabel(k)); }).join('') + '</div>' : '') +
        (opts.countLine ? '<p class="dmf-count" aria-live="polite"></p>' : '') +
        '</div>';
      syncCount();
    }
    function pick(g, k, label) {
      return '<button type="button" class="dmf-pick" data-unpick="' + g + '" data-v="' + esc(k) + '" aria-label="' + esc('הסרת ' + label) + '">' + esc(label) + ' <span aria-hidden="true">✕</span></button>';
    }
    var lastN = 0;
    function syncCount() {
      if (!opts.countLine) return;
      var txt = '';
      if (active()) {
        var one = tab === 'agents' ? 'יועץ נדל״ן אחד מתאים' : 'משרד תיווך אחד מתאים';
        txt = (lastN === 1 ? one : lastN + ' ' + noun(tab) + ' מתאימים');
      }
      box.querySelectorAll('.dmf-count').forEach(function (el) {
        el.innerHTML = txt ? esc(txt) + ' <button type="button" class="dmf-link" data-dm-clear="all">ניקוי הסינון</button>' : '';
      });
    }
    function toggle(s, g, k) {
      var list = s[g], at = list.indexOf(k);
      if (at >= 0) list.splice(at, 1); else list.push(k);
    }
    // ‏dm_filter: ‏value - המפתח (התמחות) או סוג האזור, לעולם לא מזהה
    function trackFilter(g, k) {
      if (global.shukTrack) global.shukTrack('dm_filter', { tab: tab, filter: g, value: g === 'spec' ? k : k.split(':')[0],
        selected_n: st[g].length, results: lastN, surface: opts.surface });
    }
    function changed(focus) {
      renderDesktop(); writeUrl(); opts.onChange();
      // הצ'יפים נבנים מחדש - הפוקוס חוזר לאותו צ'יפ (מקלדת)
      if (focus) {
        var again = box.querySelector('.dmf-d [data-g="' + focus.g + '"][data-v="' + focus.v + '"]');
        if (again && again.focus) again.focus({ preventScroll: true });
        else { var ob = box.querySelector('.dmf-open'); if (ob && mq.matches) ob.focus({ preventScroll: true }); }
      }
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('dmf-chip')) { toggle(st, b.dataset.g, b.dataset.v); changed({ g: b.dataset.g, v: b.dataset.v }); trackFilter(b.dataset.g, b.dataset.v); return; }
      if (b.dataset.unpick) { toggle(st, b.dataset.unpick, b.dataset.v); changed({ g: '-', v: '-' }); trackFilter(b.dataset.unpick, b.dataset.v); return; }
      if (b.classList.contains('dmf-more-btn')) { moreOpen = !moreOpen; renderDesktop(); return; }
      if (b.classList.contains('dmf-open')) { openSheet(b); return; }
      if (b.dataset.dmClear) { api.clear(b.dataset.dmClear); return; }
    });

    /* ---------- הטלפון: גיליון תחתון עם טיוטה ---------- */
    var sheet = null, draft = null, opener = null, rowHomes = [];
    function sheetTitle() { return tab === 'agents' ? 'סינון יועצי נדל״ן' : 'סינון משרדי תיווך'; }
    function goLabel(n) {
      if (!n) return 'אין התאמה, כדאי להרחיב';
      if (n === 1) return tab === 'agents' ? 'הצגת יועץ נדל״ן אחד' : 'הצגת משרד תיווך אחד';
      return 'הצגת ' + n + ' ' + noun(tab);
    }
    function renderSheet() {
      if (!sheet) return;
      var n = countFor(pool || items(), draft.spec, draft.area);
      var so = specChips(draft);
      sheet.querySelector('.dmf-sbody-dm').innerHTML =
        (so ? '<h3 class="dmf-h">התמחות <span>(אפשר לבחור כמה)</span></h3><div class="dmf-chips">' + so + '</div>' : '') +
        '<h3 class="dmf-h">אזור <span>(אפשר לבחור כמה)</span></h3>' + areaChipsSheet(draft);
      var go = sheet.querySelector('.dmf-go');
      go.textContent = goLabel(n);
      go.disabled = !n;
    }
    function openSheet(from) {
      opener = from;
      draft = { spec: st.spec.slice(), area: st.area.slice() };
      sheet = document.createElement('div');
      sheet.className = 'dmf-sheet-wrap';
      sheet.innerHTML = '<div class="dmf-scrim" data-dmf-close></div>' +
        '<div class="dmf-sheet" role="dialog" aria-modal="true" aria-labelledby="dmfSheetT">' +
        '<span class="dmf-grip" aria-hidden="true"></span>' +
        '<div class="dmf-shead"><h2 id="dmfSheetT">' + esc(sheetTitle()) + '</h2>' +
        '<button type="button" class="dmf-x" data-dmf-close aria-label="סגירה">✕</button></div>' +
        '<div class="dmf-sbody"><div class="dmf-sbody-dm"></div><div class="dmf-sbody-x"></div></div>' +
        '<div class="dmf-sfoot"><button type="button" class="dmf-ghost" data-dmf-reset>ניקוי</button>' +
        '<button type="button" class="dmf-go"></button></div></div>';
      document.body.appendChild(sheet);
      document.documentElement.classList.add('dmf-lock');
      // ‏/agents: "משרד" ו"דירוג" עוברים לגיליון (ומיד חלים על הרשימה מאחוריו)
      var xs = sheet.querySelector('.dmf-sbody-x');
      rowHomes = (opts.sheetRows || []).filter(Boolean).map(function (el) {
        var mark = document.createComment('dmf-row');
        el.parentNode.insertBefore(mark, el);
        xs.appendChild(el);
        return { el: el, mark: mark };
      });
      renderSheet();
      sheet.addEventListener('click', function (e) {
        var b = e.target.closest('button, [data-dmf-close]');
        if (!b) return;
        if (b.hasAttribute('data-dmf-close')) { closeSheet(); return; }
        if (b.classList.contains('dmf-chip')) { toggle(draft, b.dataset.g, b.dataset.v); renderSheet(); return; }
        if (b.hasAttribute('data-dmf-reset')) { draft = { spec: [], area: [] }; renderSheet(); return; }
        if (b.classList.contains('dmf-go')) {
          st = { spec: draft.spec.slice(), area: draft.area.slice() };
          closeSheet();
          changed();
          if (global.shukTrack) global.shukTrack('dm_filter_sheet_apply', { tab: tab, spec_n: st.spec.length, area_n: st.area.length, results: lastN, surface: opts.surface });
        }
      });
      sheet.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } });
      if (global.shukTrack) global.shukTrack('dm_filter_sheet_open', { tab: tab, surface: opts.surface });
      var first = sheet.querySelector('.dmf-x');
      if (first) first.focus();
    }
    function closeSheet() {
      if (!sheet) return;
      rowHomes.forEach(function (r) { r.mark.parentNode.insertBefore(r.el, r.mark); r.mark.remove(); });
      rowHomes = [];
      sheet.remove(); sheet = null; draft = null;
      document.documentElement.classList.remove('dmf-lock');
      var back = box.querySelector('.dmf-open') || opener;
      if (back && back.focus) back.focus({ preventScroll: true });
    }
    if (mq.addEventListener) mq.addEventListener('change', function () { if (!mq.matches) closeSheet(); });

    /* ---------- כתובת ---------- */
    function query() {
      var q = {};
      if (st.spec.length) q.dm_spec = st.spec.join(',');
      if (st.area.length) q.dm_area = st.area.join(',');
      return q;
    }
    function writeUrl() {
      try {
        var u = new URL(location.href);
        ['dm_spec', 'dm_area', 'dm_tab'].forEach(function (k) { u.searchParams.delete(k); });
        var q = query();
        Object.keys(q).forEach(function (k) { u.searchParams.set(k, q[k]); });
        if (active() && opts.tabParam && tab === 'agents') u.searchParams.set('dm_tab', 'agents');
        history.replaceState(history.state, '', u);
      } catch (e) { /* דפדפן שחוסם היסטוריה */ }
    }

    /* ---------- הטקסט בכרטיס ובכותרת ---------- */
    function oneSpec() { return st.spec.length === 1 ? BY_KEY[st.spec[0]] : null; }
    function oneArea() { return st.area.length === 1 && areas.get(st.area[0]) ? areas.get(st.area[0]).label : ''; }
    function phrase(n) {
      var sp = oneSpec(), al = oneArea();
      return [n === 1 ? 'נכס' : n + ' נכסים', sp ? sp.phrase.replace(/^- /, '') : 'פעילים', al ? 'ב' + al : ''].filter(Boolean).join(' ');
    }

    var lastEmpty = '';
    renderDesktop();
    var api = {
      active: active,
      state: function () { return { spec: st.spec.slice(), area: st.area.slice() }; },
      query: query,
      /* החלפת לשונית (דף הבית): אותה בחירה, האפשרויות והמונים של הלשונית החדשה */
      setTab: function (t) { if (tabs[t]) { tab = t; pool = null; renderDesktop(); } },
      setProps: function (props) { build(props); renderDesktop(); },
      /* הרשימה אחרי שאר הסינונים של הדף: מסננת, ממיינת לפי מספר הנכסים שבסינון, ומסמנת */
      apply: function (list, byName) {
        pool = list;
        if (sheet) renderSheet();
        if (!active()) return list;
        byName = byName || function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'he'); };
        var withN = [], declOnly = [];
        list.forEach(function (it) {
          var m = matchIn(tab, it.id, st.spec, st.area);
          if (!m) return;
          var copy = Object.assign({}, it, { rankBadge: null, dmN: m.n,
            dmText: m.decl ? 'מתמחה ב' + st.spec.map(function (k) { return BY_KEY[k].label; }).join(', ') : phrase(m.n) });
          (m.decl ? declOnly : withN).push(copy);
        });
        withN.sort(function (a, b) { return b.dmN - a.dmN || (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating) || byName(a, b); });
        declOnly.sort(byName);
        return withN.concat(declOnly);
      },
      after: function (list) {
        lastN = list.length;
        // המונים בצ'יפים תלויים בשאר הסינונים של הדף - מתעדכנים אחרי כל ציור (בלי לאבד פוקוס)
        var f = document.activeElement && box.contains(document.activeElement) && document.activeElement.dataset;
        renderDesktop();
        if (f && f.g) { var again = box.querySelector('.dmf-d [data-g="' + f.g + '"][data-v="' + f.v + '"]'); if (again) again.focus({ preventScroll: true }); }
        var key = tab + '|' + st.spec.join(',') + '|' + st.area.join(',');
        if (active() && !list.length && key !== lastEmpty) {
          lastEmpty = key;
          if (global.shukTrack) global.shukTrack('dm_filter_empty', { tab: tab, spec: st.spec.join(',') || 'all', area: st.area.map(function (k) { return k.split(':')[0]; }).join(',') || 'all' });
        }
      },
      title: function () {
        if (!active()) return '';
        var sp = oneSpec(), al = oneArea();
        return [noun(tab), sp ? sp.phrase.replace(/^- /, '· ') : '', al ? 'ב' + al : ''].filter(Boolean).join(' ');
      },
      emptyHead: function () { return tab === 'agents' ? 'לא מצאנו יועצי נדל״ן שמתאימים לסינון הזה.' : 'לא מצאנו משרד תיווך שמתאים לסינון הזה.'; },
      emptyActionsHtml: function () { return api.emptyHtml().replace(/^<p>[^<]*<\/p>/, ''); },
      emptyHtml: function () {
        var head = api.emptyHead();
        var more = '';
        if (st.area.length && st.spec.length) {
          var n = countFor(pool || items(), st.spec, []);
          if (n > 0) more = '<p class="dmf-elsewhere">' + esc('יש ' + n + ' ' + noun(tab) + ' ב' + st.spec.map(function (k) { return BY_KEY[k].label; }).join(' או ') + ' באזורים אחרים.') + '</p>';
        }
        return '<p>' + esc(head) + '</p>' +
          '<p class="dmf-empty-acts">' + (st.area.length ? '<button type="button" class="dmf-act" data-dm-clear="area">להציג את כל האזורים</button> ' : '') +
          '<button type="button" class="dmf-act" data-dm-clear="all">לנקות את הסינון</button></p>' + more;
      },
      clear: function (what) {
        st.area = [];
        if (what === 'all') st.spec = [];
        changed();
        if (global.shukTrack) global.shukTrack('dm_filter_clear', { tab: tab });
      },
      /* מילים לחיפוש החופשי: מילות ההתמחות ושמות האזורים של הנכסים */
      words: function (id, t) {
        var sp = {}, ar = {};
        (idx[t || tab].get(id) || []).forEach(function (r) {
          r.specs.forEach(function (k) { sp[k] = 1; });
          r.areas.forEach(function (k) { if (areas.get(k)) ar[areas.get(k).label] = 1; });
        });
        return Object.keys(sp).map(function (k) { return BY_KEY[k].words; }).concat(Object.keys(ar)).join(' ');
      }
    };
    return api;
  }

  global.DmFilters = { on: on, SPECS: SPECS, propSpecs: propSpecs, declaredKeys: declaredKeys, mount: mount };
})(typeof globalThis !== 'undefined' ? globalThis : window);
