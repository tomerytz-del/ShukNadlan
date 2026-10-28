/* ============================================================================
   /n/{עיר}/{שכונה} בדפדפן
   ----------------------------------------------------------------------------
   כשהשרת מילא (data-ssr) לא קוראים שוב למסד. הסינון והמיון רצים על הרשימה
   שב-#hoodData, בזיכרון בלבד: בלי פרמטרים בכתובת, כי ה-CDN והעותק השמור
   מפתחים לפי ה-URL המלא. המיון הוא SR_SORTS מ-assets/home.js, והסוגים הם
   KIND_CHIPS דרך SearchCore.PROPERTY_TYPES. docs/neighborhood-pages.md.
   ========================================================================== */
(function () {
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  /* אותם ערכים כמו SR_SORTS ב-assets/home.js. לא טוענים את home.js. */
  var SORTS = ['default', 'new', 'price-asc', 'price-desc'];
  var state = { deal: '', kind: '', rooms: 0, min: 0, max: 0, sort: 'default', shown: 12 };
  var rows = null;
  var wired = false;

  function partsFromPath() {
    var m = /^\/n\/([^/]+)\/([^/]+)\/?$/.exec(location.pathname);
    if (!m) return null;
    try { return [decodeURIComponent(m[1]).toLowerCase(), decodeURIComponent(m[2])]; }
    catch (e) { return null; }
  }

  function readList() {
    if (rows) return rows;
    var el = document.getElementById('hoodData');
    rows = [];
    if (!el) return rows;
    try {
      var data = JSON.parse(el.value);
      if (data && Array.isArray(data.listings)) rows = data.listings;
    } catch (e) { rows = []; }
    return rows;
  }

  function priceOf(p) {
    if (window.SearchCore && SearchCore.comparablePrice) {
      var n = SearchCore.comparablePrice(p);
      if (n !== null && isFinite(n) && n > 0) return n;
    }
    var raw = Number(p && p.price);
    return isFinite(raw) && raw > 0 ? raw : null;
  }

  function kindTypes(kind) {
    var SC = window.SearchCore;
    if (!kind || !SC || !SC.PROPERTY_TYPES) return null;
    var PT = SC.PROPERTY_TYPES;
    if (kind === 'flats') return (PT.apt || []).concat(PT.garden || [], PT.penthouse || []);
    if (kind === 'house') return (PT.house || []).slice();
    if (kind === 'land') return (PT.land || []).slice();
    if (kind === 'commercial') {
      return (PT.shop || []).concat(PT.office || [], PT.industry || [], PT.warehouse || [], PT.comm_land || [],
        ['אולמות', 'חלל עבודה משותף', 'בניין משרדים', 'קליניקות', 'בית מלון', 'חניון', 'סטודיו']);
    }
    return null;
  }

  function filtered() {
    var types = kindTypes(state.kind);
    return readList().filter(function (p) {
      if (state.deal && p.deal_type !== state.deal) return false;
      if (types && types.indexOf(p.property_type) < 0) return false;
      if (state.rooms && !(Number(p.rooms) >= state.rooms)) return false;
      var price = priceOf(p);
      if (state.min && (price === null || price < state.min)) return false;
      if (state.max && (price === null || price > state.max)) return false;
      return true;
    });
  }

  function sorted(list) {
    var s = list.slice();
    if (state.sort === 'new') {
      s.sort(function (a, b) {
        var ta = Date.parse(a.created_at) || Date.parse(a.updated_at) || 0;
        var tb = Date.parse(b.created_at) || Date.parse(b.updated_at) || 0;
        return tb - ta;
      });
    } else if (state.sort === 'price-asc' || state.sort === 'price-desc') {
      var dir = state.sort === 'price-asc' ? 1 : -1;
      s.sort(function (a, b) {
        var x = priceOf(a), y = priceOf(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x - y) * dir;
      });
    }
    return s;
  }

  function paint() {
    var box = document.getElementById('hoodResults');
    var H = window.ShukHood;
    if (!box || !H || !H.resultsHtml) return;
    box.innerHTML = '<h2>נכסים בשכונה</h2>' + H.resultsHtml(sorted(filtered()), state.shown, false);
  }

  function syncPressed() {
    var bar = document.getElementById('hoodFilters');
    if (!bar) return;
    bar.querySelectorAll('[data-hood="deal"]').forEach(function (b) {
      b.setAttribute('aria-pressed', (b.getAttribute('data-v') || '') === state.deal ? 'true' : 'false');
    });
  }

  function digits(v) {
    var s = String(v || '').replace(/[^\d]/g, '');
    return s ? Number(s) : 0;
  }

  function onClick(e) {
    var t = e.target.closest('[data-hood]');
    if (!t) return;
    var kind = t.getAttribute('data-hood');
    if (kind === 'deal') {
      state.deal = t.getAttribute('data-v') || '';
      state.shown = 12;
      syncPressed();
      paint();
    } else if (kind === 'clear') {
      state.deal = '';
      state.kind = '';
      state.rooms = 0;
      state.min = 0;
      state.max = 0;
      state.sort = 'default';
      state.shown = 12;
      var bar = document.getElementById('hoodFilters');
      if (bar) {
        bar.querySelectorAll('select').forEach(function (s) { s.value = s.getAttribute('data-hood') === 'rooms' ? '0' : (s.getAttribute('data-hood') === 'sort' ? 'default' : ''); });
        bar.querySelectorAll('input').forEach(function (s) { s.value = ''; });
      }
      syncPressed();
      paint();
    } else if (kind === 'more') {
      state.shown += 12;
      paint();
    }
  }

  function onChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var kind = t.getAttribute('data-hood');
    if (kind === 'kind') { state.kind = t.value || ''; state.shown = 12; paint(); }
    else if (kind === 'rooms') { state.rooms = Number(t.value) || 0; state.shown = 12; paint(); }
    else if (kind === 'sort') { state.sort = SORTS.indexOf(t.value) >= 0 ? t.value : 'default'; paint(); }
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var kind = t.getAttribute('data-hood');
    if (kind !== 'min' && kind !== 'max') return;
    state[kind] = digits(t.value);
    state.shown = 12;
    paint();
  }

  function armBot() {
    var slot = document.getElementById('hoodBotSlot');
    if (slot && window.ShukBot && ShukBot.anchorHtml && !slot.firstChild) {
      slot.innerHTML = ShukBot.anchorHtml(slot.getAttribute('data-hello') || '', 'שיחה עם גבריאלה', 'hood-btn hood-btn-ghost');
    }
    var alertBtn = document.getElementById('hoodAlert');
    if (alertBtn && !alertBtn.dataset.wired) {
      alertBtn.dataset.wired = '1';
      alertBtn.addEventListener('click', function () {
        var open = document.getElementById('buyerStartBtn');
        if (!open) return;
        open.click();
        var banner = document.getElementById('buyerBanner');
        if (banner && banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }

  function drawMap(el) {
    if (!window.L) return;
    var lat = Number(el.getAttribute('data-lat'));
    var lng = Number(el.getAttribute('data-lng'));
    if (!isFinite(lat) || !isFinite(lng)) return;
    var ph = el.querySelector('.hood-map-ph');
    if (ph) ph.remove();
    var map = window.L.map(el, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    var radius = Number(el.getAttribute('data-radius'));
    if (isFinite(radius) && radius > 0) {
      var ring = window.L.circle([lat, lng], { radius: radius, color: '#0e2a6b', weight: 2, dashArray: '6 4', fillOpacity: 0.12 });
      ring.addTo(map);
      map.fitBounds(ring.getBounds(), { padding: [12, 12] });
    } else {
      map.setView([lat, lng], 14);
    }
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    window.L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#c9a227', fillOpacity: 1 }).addTo(map);
    setTimeout(function () { map.invalidateSize(); }, 60);
  }

  function armMap() {
    var el = document.getElementById('hoodMap');
    if (!el || !el.getAttribute('data-lat')) return;
    var mq = window.matchMedia('(min-width: 960px)');
    var reduce = navigator.connection && navigator.connection.saveData;
    if (reduce) return;
    function go() {
      if (!mq.matches || el.dataset.armed) return;
      var io = new IntersectionObserver(function (ents) {
        if (!ents.some(function (x) { return x.isIntersecting; })) return;
        io.disconnect();
        el.dataset.armed = '1';
        if (window.L) { drawMap(el); return; }
        var css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
        s.onload = function () { drawMap(el); };
        document.body.appendChild(s);
      }, { rootMargin: '200px' });
      io.observe(el);
    }
    go();
    if (mq.addEventListener) mq.addEventListener('change', go);
  }

  function wire() {
    if (wired) return;
    var root = document.getElementById('dealsBody');
    if (!root || !root.querySelector('.hood-page')) return;
    wired = true;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    armBot();
    armMap();
  }

  function show(d) {
    var H = window.ShukHood;
    var box = document.getElementById('dealsBody');
    if (!box || !H) return;
    var shell = document.querySelector('section.page-head');
    if (shell) shell.remove();
    box.innerHTML = H.render(d);
    box.dataset.ssr = '1';
    document.title = H.title(d) + ' | שוק נדל״ן';
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', H.description(d));
    rows = null;
    wire();
  }

  function run() {
    var box = document.getElementById('dealsBody');
    if (!box || !window.ShukHood) return;
    if (box.dataset.ssr) { wire(); return; }
    var parts = partsFromPath();
    if (!parts) {
      box.innerHTML = '<p class="deals-note">השכונה לא נמצאה. <a href="/">לדף הבית</a>.</p>';
      return;
    }
    fetch(SUPABASE_URL + '/rest/v1/rpc/neighborhood_page', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_city: parts[0], p_slug: parts[1] }),
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d) {
        box.innerHTML = '<p class="deals-note">השכונה לא נמצאה. <a href="/">לדף הבית</a>.</p>';
        return;
      }
      show(d);
    }).catch(function () {
      box.innerHTML = '<p class="deals-note">לא הצלחנו לטעון את הנתונים כרגע. נסו לרענן את הדף בעוד דקה.</p>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
