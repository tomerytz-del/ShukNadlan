/* ============================================================
   גלישה בהחלקה (‏/swipe) - רק עם דגל v10 (‏html.beta-hero).
   ‏docs/swipe-mode.md. הסדר בקובץ:
     1. נתונים: הנכסים של השוק, הסוכנים, והכתבות
     2. הסינון לפני ההחלקה (אזור ויישוב, תקציב, חדרים)
     3. החפיסה: SEQ_CONFIG, הכרטיסים, מחוות ומקלדת
     4. גיליון הפרטים: באנר קשר, טופס סגור, פרטי הנכס, CTA דביק
     5. כרטיס הסוף, רשימה ומפה, וההדרכה
   כל אירוע עובר ב-shukTrack, בלי פרטים אישיים.
   ============================================================ */
(function () {
  'use strict';
  var H = document.documentElement;
  if (!H.classList.contains('beta-hero')) return;

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var INQUIRY_URL = SUPABASE_URL + '/functions/v1/property-inquiry-intake';
  var SAVED_SEARCH_URL = SUPABASE_URL + '/functions/v1/saved-search-intake';
  var COLS = 'id, price, price_unit, title, description, marketing_description, rooms, size_sqm, floor, city, street, address, house_number, ' +
    'property_type, deal_type, category, price_includes_vat, created_at, lat, lng, is_promoted, images, features, agent_id, agency_id, ' +
    'neighborhood_id, sales_area, open_house, open_house_start, open_house_end, agencies(name, slug, logo_url), neighborhoods(name)';
  var PIN_SVG = '<img src="/assets/logo-shuknadlan.svg" alt="" width="27" height="32">';

  /* ‏מתג כיבוי לכרטיסים הממומנים (החלטת A2): כבוי - כל משבצת ממומנת הופכת לנכס,
     גם כש-sponsors מלא, ולכן אין "ממומן", אין sponsored_impression/click ואין ליד
     ממומן. מדליקים רק אחרי שיש מפרסם משלם וצינור ליד שנבדק (‏docs/swipe-mode.md). */
  var SPONSORED_ENABLED = false;

  /* ---------- סדר הכרטיסים (‏seq-v1). ‏sponsors ריק = אין כרטיסים ממומנים ---------- */
  var SEQ_CONFIG = {
    version: 'seq-v1',
    slots: [
      { at: 6, kind: 'spon_agency', firstSessionAt: 8 },
      { at: 13, kind: 'engage' },
      { at: 16, kind: 'spon_pro' },
      { at: 22, kind: 'article' },
      { at: 26, kind: 'spon_agency' }
    ],
    cycleEvery: 12,
    cyclePattern: ['spon_agency', 'engage'],
    minGap: 4,
    maxSponsored: 3,
    maxArticles: 1,
    /* ממלאים כאן (תומר). משרד/סוכן/ת עצמאי/ת:
         { id, kind:'agency', name, slug, logo, desc }
       בעל/ת מקצוע עם סרטון:
         { id, kind:'pro', field:'ייעוץ משכנתאות'|'שמאות'|'עריכת דין', name, slug, video, poster, mortgage:true|false }
       לעולם לא שם או רישיון של בעל האתר. */
    sponsors: []
  };

  var REGION_GROUPS = {
    north: ['afula-emek', 'haifa', 'krayot', 'akko-nahariya', 'karmiel-misgav', 'nof-hagalil-migdal', 'kiryat-shmona', 'safed', 'golan', 'tiberias', 'beit-shean', 'yokneam'],
    center: ['hadera', 'netanya', 'kfar-saba-raanana', 'herzliya', 'tel-aviv', 'ramat-gan', 'bnei-brak-elad', 'petah-tikva', 'holon-bat-yam', 'rishon', 'rehovot', 'modiin', 'lod-ramla', 'jerusalem', 'beit-shemesh', 'samaria', 'binyamin', 'gush-etzion'],
    south: ['ashdod', 'ashkelon', 'kiryat-gat', 'sderot-netivot', 'beer-sheva', 'dimona-arad', 'eilat']
  };

  var Q_SALE = [['מתי מתכננים לקנות?', ['מיידי', 'בחצי שנה הקרובה', 'קודם צריך למכור נכס']], ['יש אישור עקרוני למשכנתא?', ['כן', 'עוד לא', 'לא צריך']]];
  var Q_RENT = [['מתי להיכנס?', ['מיידי', 'חודש-חודשיים', 'בחצי שנה הקרובה']]];
  /* TODO-ASK 28: האפשרויות למסחרי - ההצעה מהאבטיפוס, עד שתומר יאשר */
  var Q_COMM = [['לאיזה שימוש?', ['משרד', 'חנות', 'מחסן או תעשייה', 'אחר']], ['גודל נדרש', ['עד 100 מ״ר', '100-300 מ״ר', '300+ מ״ר']]];
  var Q_SPON_INTEREST = ['קנייה', 'מכירה', 'השכרה', 'הערכת שווי', 'להתייעץ עם סוכן'];
  var Q_ENTRY_BUY = ['מיידי', 'בחצי שנה הקרובה', 'קודם צריך למכור נכס'];
  var Q_ENTRY_RENT = ['מיידי', 'חודש-חודשיים', 'בחצי שנה הקרובה'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  /* כינוי מקומי ל-shukTrack של events.js - בשם הזה כדי ש-check_gtm_container.py ימצא את האירועים */
  var shukTrack = function (name, params) { if (window.shukTrack) window.shukTrack(name, params || {}); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var params = new URLSearchParams(location.search);
  var DEBUG = params.get('seqdebug') === '1';
  var isDesktop = function () { return window.matchMedia('(min-width:1024px)').matches; };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. נתונים ---------- */
  var sb = null;
  var all = [];          // כל הנכסים הפעילים בשוק
  var agents = new Map();
  var articles = [];
  var market = (window.CityContext && CityContext.market && CityContext.market()) ||
    (window.ShukMarkets && ShukMarkets.defaultMarket && ShukMarkets.defaultMarket()) || null;
  var marketLabel = (window.CityContext && CityContext.label()) || 'עפולה והעמק';
  // העיר הראשית של השוק - היישוב הראשון ב-places (‏CityContext.name() מחזיר את שם השוק)
  var mainCity = (market && market.places && market.places[0]) || 'עפולה';

  function photos(p) {
    return (Array.isArray(p.images) ? p.images : []).filter(function (u) {
      return typeof u === 'string' && (/^https?:\/\//i.test(u.trim()) || /^(\/(?!\/)|assets\/)/i.test(u.trim()));
    });
  }
  /* תמונה מוקטנת מהאחסון (‏render/image, כמו cardImgUrl ב-home.js): התמונות
     נשמרות בגודל מלא, ובטלפון כל כרטיס היה מוריד כמה MB. כתובת שאינה
     מהאחסון שלנו - כמו שהיא. ‏data-orig מאפשר חזרה למקור אם ההקטנה נכשלה. */
  function sized(u, w) {
    var s = String(u || ''), marker = '/storage/v1/object/public/', at = s.indexOf(marker);
    if (at < 0) return s;
    var path = s.slice(at + marker.length).split(/[?#]/)[0];
    return path ? s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=' + w + '&quality=65' : s;
  }
  function imgSrc(u, w) {
    var small = sized(u, w);
    return 'src="' + esc(small) + '"' + (small !== u ? ' data-orig="' + esc(u) + '"' : '');
  }
  function isComm(p) { return p.category === 'commercial'; }
  function fmtPrice(p) {
    var n = Number(p.price);
    if (!isFinite(n) || n <= 0) return 'לפי בקשה';
    var unit = p.price_unit || (p.deal_type === 'rent' ? 'month' : 'total');
    var s = '₪' + n.toLocaleString('he-IL');
    if (unit === 'sqm') s += p.deal_type === 'rent' ? ' למ״ר לחודש' : ' למ״ר';
    else if (unit === 'month') s += ' לחודש';
    if (isComm(p) && p.price_includes_vat !== true) s += ' + מע״מ';
    return s;
  }
  function maskHouse(t, hn) {
    t = String(t || ''); hn = String(hn == null ? '' : hn).trim();
    if (!t || !hn) return t;
    var re = new RegExp('(^|[^\\d])' + hn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'g');
    return t.replace(re, '$1').replace(/\s+/g, ' ').replace(/^[\s,·-]+|[\s,·-]+$/g, '').trim();
  }
  function street(p) { return maskHouse(p.street || p.address || '', p.house_number).replace(/^רחוב\s+/, ''); }
  function hood(p) { return (p.neighborhoods && p.neighborhoods.name) || p.sales_area || ''; }
  function where(p) { var h = hood(p); return [street(p), h && h !== p.city ? h : '', p.city].filter(Boolean).join(', '); }
  function title(p) { return maskHouse(p.title || '', p.house_number) || p.property_type || 'נכס'; }
  function rooms(p) { var r = Number(p.rooms); return isFinite(r) && r > 0 ? String(Number(r.toFixed(1))) : ''; }
  function initials(name) {
    var w = String(name || '').replace(/["״׳']/g, '').trim().split(/\s+/).filter(Boolean);
    return (w[0] ? w[0][0] : '') + (w[1] ? w[1][0] : '');
  }
  function advertiser(p) {
    var a = p.agent_id ? agents.get(p.agent_id) : null;
    var ag = p.agencies || null;
    if (a) return { type: 'agent', name: a.display_name || 'יועץ נדל״ן', sub: 'תיווך' + (ag && ag.name ? ' · ' + ag.name : ''),
      img: a.photo_url || (ag && ag.logo_url) || '', slug: a.slug || '', href: a.slug ? '/agent?slug=' + encodeURIComponent(a.slug) : '', phone: a.phone_e164 || '' };
    if (ag && ag.name) return { type: 'agency', name: ag.name, sub: 'משרד תיווך', img: ag.logo_url || '', slug: ag.slug || '',
      href: ag.slug ? '/agency?slug=' + encodeURIComponent(ag.slug) : '', phone: '' };
    return { type: 'private', name: 'מודעה פרטית', sub: 'מודעה פרטית · בעלי הנכס', img: '', slug: '', href: '', phone: '' };
  }
  function ctaLabel(adv) {
    return adv.type === 'agent' ? 'יצירת קשר עם התיווך' : adv.type === 'agency' ? 'יצירת קשר עם המשרד' : 'יצירת קשר עם המפרסם';
  }
  function imgFallback(alt) {
    return '<div class="sw-img-fb" role="img" aria-label="' + esc(alt) + '">' + PIN_SVG + '</div>';
  }
  /* תמונה שנכשלה בטעינה מתחלפת בגרדיאנט עם הסיכה - אף פעם לא מסגרת ריקה */
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-fb')) return;
    // קודם המקור בגודל מלא (פעם אחת), ורק אם גם הוא נכשל - הגרדיאנט
    var orig = t.getAttribute('data-orig');
    if (orig) { t.removeAttribute('data-orig'); t.src = orig; return; }
    var box = document.createElement('div');
    box.className = 'sw-img-fb ' + (t.getAttribute('data-fb') || '');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', t.alt || '');
    box.innerHTML = PIN_SVG;
    t.replaceWith(box);
  }, true);
  function avatarHtml(adv, size) {
    if (adv.type === 'private') return '<span class="sw-av sw-av-pin" style="--av:' + size + 'px">' + PIN_SVG + '</span>';
    var ini = '<span class="sw-av sw-av-ini" style="--av:' + size + 'px" aria-hidden="true">' + esc(initials(adv.name)) + '</span>';
    if (!adv.img) return ini;
    return '<span class="sw-av" style="--av:' + size + 'px"><img src="' + esc(adv.img) + '" alt="" loading="lazy" ' +
      'onerror="this.parentNode.classList.add(\'sw-av-ini\');this.parentNode.textContent=' + esc(JSON.stringify(initials(adv.name))) + '"></span>';
  }

  function load() {
    if (!window.supabase) return Promise.resolve([]);
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    var specP = window.MarketScope ? MarketScope.spec(sb) : Promise.resolve(null);
    return specP.then(function (spec) {
      var q = sb.from('properties').select(COLS).eq('status', 'active');
      if (window.MarketScope) q = MarketScope.apply(q, spec);
      return q.order('is_promoted', { ascending: false }).order('created_at', { ascending: false }).limit(300);
    }).then(function (res) {
      var rows = (res && !res.error && res.data) || [];
      var ids = rows.map(function (p) { return p.agent_id; }).filter(Boolean)
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      var agentsP = ids.length
        ? sb.from('agency_members_public').select('id, display_name, slug, phone_e164, photo_url').in('id', ids)
          .then(function (r) { ((r && r.data) || []).forEach(function (a) { agents.set(a.id, a); }); }, function () {})
        : Promise.resolve();
      var artP = sb.from('articles_public').select('id, slug, title, subtitle, category, cover_url, published_at')
        .order('published_at', { ascending: false }).limit(4)
        .then(function (r) { articles = (r && r.data) || []; }, function () {});
      return Promise.all([agentsP, artP]).then(function () { return rows; });
    }).catch(function (e) { console.warn('swipe: טעינת הנכסים נכשלה', e); return []; });
  }

  /* ---------- 2. הסינון ---------- */
  var filter = { deal: 'sale', area: 'all', budget: 0, rooms: 0, near: null };
  var BUDGETS = {
    sale: [0, 1500000, 2500000, 3500000],
    rent: [0, 4000, 6000, 8000],
    commercial: [0, 5000, 15000, 2000000]
  };
  function budgetLabel(v, deal) {
    if (!v) return 'ללא הגבלה';
    if (v >= 1000000) return 'עד ' + (v / 1000000).toLocaleString('he-IL') + ' מיליון ₪';
    return 'עד ₪' + v.toLocaleString('he-IL') + (deal === 'sale' ? '' : '');
  }
  function dealOk(p, deal) {
    if (deal === 'commercial') return isComm(p);
    return !isComm(p) && p.deal_type === deal;
  }
  function areaOk(p, area) {
    if (area === 'all') return true;
    if (area === 'main') return p.city === mainCity;
    if (area === 'around') return p.city && p.city !== mainCity;
    if (area.indexOf('city:') === 0) return p.city === area.slice(5);
    return true;
  }
  function km(a, b, c, d) {
    var R = 6371, t = Math.PI / 180, x = (c - a) * t, y = (d - b) * t;
    var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * t) * Math.cos(c * t) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /* ‏?fair=1 (מגבריאלה): רק נכסים שביריד הבתים הפתוחים עכשיו - אותו תנאי של הבאנר בדף הבית */
  function fairLive(p) {
    var now = Date.now(), s = Date.parse(p.open_house_start), e = Date.parse(p.open_house_end);
    return !!p.open_house && s <= now && e > now;
  }
  function matches(p, f) {
    if (!dealOk(p, f.deal)) return false;
    if (f.fair && !fairLive(p)) return false;
    if (f.near) { if (!p.lat || !p.lng || km(f.near[0], f.near[1], +p.lat, +p.lng) > 12) return false; }
    else if (!areaOk(p, f.area)) return false;
    if (f.budget && Number(p.price) > f.budget) return false;
    if (f.rooms && f.deal !== 'commercial' && !(Number(p.rooms) >= f.rooms)) return false;
    return true;
  }
  function filtered(f) {
    var list = all.filter(function (p) { return matches(p, f || filter); });
    if ((f || filter).near) {
      var n = (f || filter).near;
      list.sort(function (a, b) { return km(n[0], n[1], +a.lat, +a.lng) - km(n[0], n[1], +b.lat, +b.lng); });
    }
    return list;
  }
  function countFor(patch) {
    var f = Object.assign({}, filter, patch);
    return all.filter(function (p) { return matches(p, f); }).length;
  }
  function chip(label, attrs, on, extra) {
    return '<button type="button" class="sw-chip' + (extra ? ' ' + extra : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '" ' + attrs + '>' + label + '</button>';
  }
  function n(v) { return '<span class="sw-chip-n">' + v + '</span>'; }
  var townsOpen = false, otherOpen = false, otherGroup = 'north', otherCounts = null;

  function renderFilter() {
    document.querySelectorAll('#swFDeal [data-deal]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.deal === filter.deal));
    });
    var base = { area: 'all', near: null };
    var aroundN = countFor({ area: 'around', near: null });
    var towns = {};
    all.forEach(function (p) { if (p.city && dealOk(p, filter.deal)) towns[p.city] = (towns[p.city] || 0) + 1; });
    var aroundLabel = mainCity === 'עפולה' ? 'יישובי העמק סביב עפולה' : 'יישובים סביב ' + mainCity;
    var html = chip('<span aria-hidden="true">📍</span> לפי המיקום שלי', 'data-area="near"', !!filter.near) +
      chip('כל ' + esc(marketLabel) + ' · ' + countFor(base), 'data-area="all"', !filter.near && filter.area === 'all') +
      chip(esc(mainCity) + ' · ' + countFor({ area: 'main', near: null }), 'data-area="main"', !filter.near && filter.area === 'main');
    if (aroundN) html += chip(esc(aroundLabel) + ' · ' + aroundN, 'data-area="around"', !filter.near && filter.area === 'around');
    if (Object.keys(towns).length) html += chip('לפי יישוב ' + (townsOpen ? '▴' : '▾'), 'data-toggle="towns" aria-expanded="' + townsOpen + '"', townsOpen || filter.area.indexOf('city:') === 0, 'sw-chip-tg');
    // "אזור אחר" רק כשיש שוק חי נוסף עם נכסים - אף פעם לא אזור ריק
    if (!otherCounts) loadOtherCounts();
    else if (otherGroups().length) html += chip('אזור אחר ' + (otherOpen ? '▴' : '▾'), 'data-toggle="other" aria-expanded="' + otherOpen + '"', otherOpen, 'sw-chip-tg');
    $('swFArea').innerHTML = html;

    var tw = $('swFTowns');
    tw.hidden = !townsOpen;
    tw.innerHTML = Object.keys(towns).sort(function (a, b) { return towns[b] - towns[a]; }).map(function (c) {
      return chip(esc(c) + ' · ' + towns[c], 'data-area="city:' + esc(c) + '"', filter.area === 'city:' + c);
    }).join('');

    $('swFOther').hidden = !otherOpen;
    if (otherOpen) renderOther();

    var budgets = BUDGETS[filter.deal];
    $('swFBudget').innerHTML = budgets.map(function (v) { return chip(esc(budgetLabel(v, filter.deal)), 'data-budget="' + v + '"', filter.budget === v); }).join('');
    var showRooms = filter.deal !== 'commercial';
    $('swFRooms').hidden = $('swFRoomsL').hidden = !showRooms;
    $('swFRooms').innerHTML = [0, 3, 4, 5].map(function (v) { return chip(v ? v + '+' : 'הכול', 'data-rooms="' + v + '"', filter.rooms === v); }).join('');
    var c = filtered().length;
    $('swFCount').textContent = c === 1 ? 'נכס אחד מתאים' : c + ' נכסים מתאימים';
    $('swFGo').disabled = false;
    renderSummary();
  }
  function renderSummary() {
    var deal = { sale: 'למכירה', rent: 'להשכרה', commercial: 'מסחרי' }[filter.deal];
    var area = filter.near ? 'לידי' : filter.area === 'all' ? marketLabel : filter.area === 'main' ? mainCity :
      filter.area === 'around' ? 'יישובי הסביבה' : filter.area.slice(5);
    $('swSumText').textContent = (filter.fair ? 'יריד הבתים הפתוחים · ' : '') + deal + ' · ' + area;
  }
  function marketOfCity(city) {
    var list = (window.ShukMarkets && ShukMarkets.list) || [];
    for (var i = 0; i < list.length; i++) if ((list[i].places || []).indexOf(city) >= 0) return list[i];
    return null;
  }
  function otherIn(group) {
    return ((window.ShukMarkets && ShukMarkets.list) || []).filter(function (m) {
      return m.live && REGION_GROUPS[group].indexOf(m.slug) >= 0 && (!market || m.slug !== market.slug) && otherCounts && otherCounts[m.slug];
    });
  }
  function otherGroups() { return Object.keys(REGION_GROUPS).filter(function (g) { return otherIn(g).length; }); }
  function renderOther() {
    var groups = otherGroups();
    if (groups.length && groups.indexOf(otherGroup) < 0) otherGroup = groups[0];
    document.querySelectorAll('#swFOtherTabs [data-group]').forEach(function (b) {
      b.hidden = groups.indexOf(b.dataset.group) < 0;   // לשונית בלי שווקים עם נכסים - מוסתרת
      b.setAttribute('aria-selected', String(b.dataset.group === otherGroup));
    });
    var box = $('swFOtherList');
    if (!otherCounts) { box.innerHTML = '<p class="sw-fnote">טוען…</p>'; loadOtherCounts(); return; }
    var list = ((window.ShukMarkets && ShukMarkets.list) || []).filter(function (m) {
      return m.live && REGION_GROUPS[otherGroup].indexOf(m.slug) >= 0 && (!market || m.slug !== market.slug) && otherCounts[m.slug];
    });
    // אזורים בלי נכסים אינם מוצגים כלל
    box.innerHTML = list.length ? list.map(function (m) {
      return chip(esc(m.label) + ' · ' + otherCounts[m.slug], 'data-market="' + esc(m.slug) + '"', false);
    }).join('') : '';
    box.hidden = !list.length;
  }
  var otherLoading = false;
  function loadOtherCounts() {
    if (otherLoading || otherCounts) return;
    if (!sb) { otherCounts = {}; return; }
    otherLoading = true;
    var done = function () { otherLoading = false; renderFilter(); };
    sb.from('properties').select('city').eq('status', 'active').limit(1000).then(function (r) {
      otherCounts = {};
      ((r && r.data) || []).forEach(function (row) {
        var m = marketOfCity(row.city);
        if (m) otherCounts[m.slug] = (otherCounts[m.slug] || 0) + 1;
      });
      done();
    }, function () { otherCounts = {}; done(); });
  }

  var filterOpener = null;
  function openFilter(opener) {
    filterOpener = opener || document.activeElement;
    renderFilter();
    openDialog($('swFilter'));
  }
  function closeFilter() { closeDialog($('swFilter'), filterOpener); }

  $('swFilter').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.deal) { filter.deal = b.dataset.deal; filter.budget = 0; if (filter.deal === 'commercial') filter.rooms = 0; renderFilter(); return; }
    if (b.dataset.toggle === 'towns') { townsOpen = !townsOpen; renderFilter(); return; }
    if (b.dataset.toggle === 'other') { otherOpen = !otherOpen; renderFilter(); return; }
    if (b.dataset.group) { otherGroup = b.dataset.group; renderOther(); return; }
    if (b.dataset.market) {
      var m = window.ShukMarkets && ShukMarkets.bySlug(b.dataset.market);
      if (m && window.CityContext) {
        shukTrack('region_select', { region: m.slug, group: otherGroup, via: 'swipe_filter' });
        CityContext.choose(m, 'choice');
        location.reload();
      }
      return;
    }
    if (b.dataset.area === 'near') { askLocation(); return; }
    if (b.dataset.area) {
      filter.area = b.dataset.area; filter.near = null;
      shukTrack('region_select', { region: market ? market.slug : '', group: 'live', via: 'swipe_filter' });
      renderFilter(); return;
    }
    if (b.dataset.budget) { filter.budget = Number(b.dataset.budget); renderFilter(); return; }
    if (b.dataset.rooms) { filter.rooms = Number(b.dataset.rooms); renderFilter(); return; }
  });
  function askLocation() {
    var note = $('swFLocNote');
    if (!navigator.geolocation) { note.textContent = 'הדפדפן לא מאפשר לאתר מיקום.'; return; }
    note.textContent = 'מאתרים את המיקום…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      filter.near = [pos.coords.latitude, pos.coords.longitude];
      note.textContent = '';
      shukTrack('region_select', { region: market ? market.slug : '', group: 'live', via: 'my_location' });
      renderFilter();
    }, function () {
      // סירוב משאיר את הבחירה הקודמת
      note.textContent = 'לא התקבלה הרשאה למיקום. הבחירה הקודמת נשארה.';
    }, { timeout: 10000, maximumAge: 300000 });
  }
  $('swFReset').addEventListener('click', function () {
    filter = { deal: filter.deal, area: 'all', budget: 0, rooms: 0, near: null };
    townsOpen = otherOpen = false; renderFilter();
  });
  $('swFGo').addEventListener('click', function () {
    shukTrack('swipe_start', { deal: filter.deal, region: market ? market.slug : '', via: 'swipe_filter' });
    closeFilter();
    buildDeck();
    maybeTour();
  });
  $('swSum').addEventListener('click', function () { openFilter(this); });
  $('swFilterBtn').addEventListener('click', function () { openFilter(this); });

  /* ---------- דיאלוגים: מלכודת פוקוס, Escape, והחזרת הפוקוס ---------- */
  var openStack = [];
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"]),[role="button"]'),
      function (el) { return el.offsetParent !== null; });
  }
  /* גובה שורת הפעולות: הגיליון נעצר מעליה, וכפתור הנגישות וגבריאלה יושבים מעליה (‏swipe.css) */
  function measureActions() {
    var act = $('swActions');
    var hgt = act && act.getBoundingClientRect().height;
    if (hgt) document.documentElement.style.setProperty('--sw-act-h', Math.ceil(hgt) + 'px');
  }
  measureActions();
  window.addEventListener('resize', measureActions);
  function openDialog(el) {
    el.hidden = false;
    document.body.classList.add('sw-locked');
    openStack.push(el);
    setTimeout(function () { var f = focusables(el)[0]; if (f) f.focus({ preventScroll: true }); }, 30);
  }
  function closeDialog(el, back) {
    if (el.hidden) return;
    el.hidden = true;
    openStack = openStack.filter(function (x) { return x !== el; });
    if (!openStack.length) document.body.classList.remove('sw-locked');
    if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) {
    var top = openStack[openStack.length - 1];
    if (top && e.key === 'Escape') {
      e.preventDefault();
      if (top === $('swSheet')) closeSheet(); else if (top === $('swFilter')) closeFilter(); else if (top === $('swTour')) endTour(false);
      return;
    }
    if (top && e.key === 'Tab') {
      var f = focusables(top);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]');
    if (!c) return;
    if (c.closest('#swSheet')) closeSheet();
    else if (c.closest('#swFilter')) closeFilter();
  });

  /* ---------- 3. החפיסה ---------- */
  var deck = [], idx = 0, history_ = [], likes = loadLikes(), view = 'deck';
  /* ‏shown: כמה ממומנים וכתבות **הוצגו** בביקור (התקרה היא לביקור). ‏counts: כמה
     נכנסו לחפיסה הנוכחית, ומתחיל ממה שכבר הוצג. עד כאן ספרנו כרטיס כשנבנה, ולכן
     החפיסה שנבנית מאחורי חלון הסינון בטעינה - ואיש לא רואה - "ניצלה" את הכתבה
     ואת הממומנים, ואחרי "התחילו להחליק" הם לא הופיעו בכלל */
  var shown = { sponsored: 0, articles: 0 };
  var counts = { sponsored: 0, articles: 0 };
  var firstSession = (function () {
    var key = 'sk_feed_session_counted', n;
    try {
      n = Number(localStorage.getItem('sk_feed_sessions')) || 0;
      if (!sessionStorage.getItem(key)) { n += 1; localStorage.setItem('sk_feed_sessions', String(n)); sessionStorage.setItem(key, '1'); }
    } catch (e) { n = 1; }
    return n <= 1;
  })();
  function loadLikes() { try { return JSON.parse(store('sk_swipe_likes') || '[]') || []; } catch (e) { return []; } }
  function saveLikes() { store('sk_swipe_likes', JSON.stringify(likes.slice(-200))); renderLikes(); }
  function renderLikes() { $('swLikesN').textContent = likes.length; }

  function slotAt(pos) {
    for (var i = 0; i < SEQ_CONFIG.slots.length; i++) {
      var s = SEQ_CONFIG.slots[i];
      var at = firstSession && s.firstSessionAt ? s.firstSessionAt : s.at;
      if (at === pos) return s.kind;
    }
    var last = SEQ_CONFIG.slots[SEQ_CONFIG.slots.length - 1].at;
    if (pos > last && (pos - last) % SEQ_CONFIG.cycleEvery === 0) {
      var k = (pos - last) / SEQ_CONFIG.cycleEvery - 1;
      return SEQ_CONFIG.cyclePattern[k % SEQ_CONFIG.cyclePattern.length];
    }
    return null;
  }
  function fillSlot(kind, used) {
    if (kind === 'spon_agency' || kind === 'spon_pro') {
      if (!SPONSORED_ENABLED) return null;
      if (counts.sponsored >= SEQ_CONFIG.maxSponsored) return null;
      var want = kind === 'spon_agency' ? 'agency' : 'pro';
      var s = SEQ_CONFIG.sponsors.filter(function (x) { return x.kind === want && !used[x.id]; })[0];
      if (!s) return null;
      used[s.id] = 1; counts.sponsored++;
      return { slot: kind, sponsor: s };
    }
    if (kind === 'article') {
      if (counts.articles >= SEQ_CONFIG.maxArticles || !articles.length) return null;
      counts.articles++;
      return { slot: 'article', article: articles[0] };
    }
    if (kind === 'engage') return { slot: 'engage' };
    return null;
  }
  function buildDeck() {
    var props = filtered();
    // "3 ממומנים ו-1 כתבה" הם לביקור: החפיסה מקבלת רק את מה שעוד לא הוצג
    counts = { sponsored: shown.sponsored, articles: shown.articles };
    /* ‏minGap חל בין שני כרטיסים ממומנים (6/8 ← 16 ← 26). בין 13 ל-16 יש רק שני
       נכסים, והמפרט (קריטריון 25) דורש את שניהם - ולכן שאלה וכתבה אינן נספרות */
    var out = [], used = {}, pi = 0, pos = 1, sinceSpon = Infinity;
    while (pi < props.length) {
      var kind = slotAt(pos);
      var spon = kind === 'spon_agency' || kind === 'spon_pro';
      var card = kind && (!spon || sinceSpon >= SEQ_CONFIG.minGap) ? fillSlot(kind, used) : null;
      if (card && spon) sinceSpon = 0;
      if (!card) { card = { slot: 'property', p: props[pi++] }; sinceSpon++; }
      card.pos = pos++;
      out.push(card);
    }
    out.push({ slot: 'end', pos: pos });
    deck = out; idx = 0; history_ = [];
    renderDeck();
    renderList();
    if (mapReady) drawMapMarkers();
  }

  var cur = function () { return deck[idx]; };
  function cardHtml(c, top) {
    var dbg = DEBUG ? '<span class="sw-dbg">' + esc(c.slot) + ' · ' + c.pos + '</span>' : '';
    if (c.slot === 'property') {
      var p = c.p, ph = photos(p), adv = advertiser(p);
      var img = ph.length ? '<img class="sw-cimg" data-fb="sw-cimg" ' + imgSrc(ph[0], 800) + ' alt="' + esc(title(p)) + '"' + (top ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">'
        : imgFallback(title(p)).replace('sw-img-fb', 'sw-img-fb sw-cimg');
      var bars = ph.length > 1 ? '<div class="sw-bars" aria-hidden="true">' + ph.slice(0, 8).map(function (_, i) { return '<span' + (i === 0 ? ' class="on"' : '') + '></span>'; }).join('') + '</div>' : '';
      var facts = [rooms(p) ? rooms(p) + ' חד׳' : '', p.size_sqm ? p.size_sqm + ' מ״ר' : '', p.floor != null && p.floor !== '' ? 'קומה ' + p.floor : ''].filter(Boolean).join(' · ');
      return '<article class="sw-card" data-slot="property" aria-label="' + esc(title(p) + ', ' + fmtPrice(p)) + '">' + img + bars + dbg +
        '<div class="sw-ctop"><span class="sw-tag ' + (p.deal_type === 'rent' ? 'is-rent' : 'is-sale') + '">' + (isComm(p) ? 'מסחרי' : p.deal_type === 'rent' ? 'להשכרה' : 'למכירה') + '</span>' +
        (p.property_type ? '<span class="sw-tag is-type">' + esc(p.property_type) + '</span>' : '') +
        (ph.length > 1 ? '<span class="sw-count" aria-hidden="true">1/' + ph.length + '</span>' : '') + '</div>' +
        '<div class="sw-cbody"><p class="sw-price">' + esc(fmtPrice(p)) + '</p>' +
        '<h2 class="sw-ctitle">' + esc(title(p)) + '</h2>' +
        (facts ? '<p class="sw-facts">' + esc(facts) + '</p>' : '') +
        '<p class="sw-where"><span aria-hidden="true">📍</span> ' + esc(where(p)) + '</p>' +
        '<p class="sw-by">' + esc(adv.type === 'private' ? 'מודעה פרטית' : adv.name) + '</p>' +
        '<button type="button" class="sw-up" data-up>פרטים ויצירת קשר <span aria-hidden="true">↑</span></button></div>' +
        '<span class="sw-stamp is-like" aria-hidden="true">אהבתי</span><span class="sw-stamp is-skip" aria-hidden="true">דילוג</span></article>';
    }
    if (c.slot === 'spon_agency') {
      var s = c.sponsor, sa = { type: 'agency', name: s.name, img: s.logo || '' };
      return '<article class="sw-card sw-spon" data-slot="spon_agency" aria-label="' + esc('ממומן: ' + s.name) + '">' + dbg +
        '<span class="sw-spon-badge">ממומן</span><div class="sw-spon-in">' + avatarHtml(sa, 84) +
        '<h2 class="sw-ctitle">' + esc(s.name) + '</h2><p class="sw-spon-desc">' + esc(s.desc || '') + '</p>' +
        (s.count ? '<p class="sw-spon-n">' + esc(s.count) + ' נכסים פעילים</p>' : '') +
        '<button type="button" class="sw-gold" data-spon-cta>השאירו פרטים</button></div></article>';
    }
    if (c.slot === 'spon_pro') {
      var pro = c.sponsor;
      return '<article class="sw-card sw-spon sw-pro" data-slot="spon_pro" aria-label="' + esc('ממומן: ' + pro.field + ', ' + pro.name) + '">' + dbg +
        (pro.video ? '<video class="sw-cimg" muted playsinline loop preload="none" poster="' + esc(pro.poster || '') + '" src="' + esc(pro.video) + '"></video>' : imgFallback(pro.name).replace('sw-img-fb', 'sw-img-fb sw-cimg')) +
        '<span class="sw-spon-badge">ממומן · בעלי מקצוע</span><div class="sw-cbody"><p class="sw-facts">' + esc(pro.field) + '</p><h2 class="sw-ctitle">' + esc(pro.name) + '</h2>' +
        (pro.mortgage ? '<button type="button" class="sw-gold" data-spon-cta>השאירו פרטים</button>'
          : '<a class="sw-gold" data-spon-link data-professional href="/professional?slug=' + encodeURIComponent(pro.slug || '') + '">לדף בעל המקצוע ←</a>') + '</div></article>';
    }
    if (c.slot === 'article') {
      var a = c.article;
      var url = '/article?slug=' + encodeURIComponent(a.slug || a.id);
      return '<article class="sw-card sw-art" data-slot="article" aria-label="' + esc('כתבה: ' + a.title) + '">' + dbg +
        (a.cover_url ? '<img class="sw-cimg" data-fb="sw-cimg" src="' + esc(a.cover_url) + '" alt="" loading="lazy">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-cimg')) +
        '<div class="sw-cbody"><p class="sw-facts">' + esc(a.category || 'מגזין שוק נדל״ן') + ' · ' + esc(readTime(a)) + '</p>' +
        '<h2 class="sw-ctitle">' + esc(a.title) + '</h2>' + (a.subtitle ? '<p class="sw-where">' + esc(a.subtitle) + '</p>' : '') +
        '<a class="sw-white" data-article href="' + esc(url) + '">לקריאה ←</a></div></article>';
    }
    if (c.slot === 'engage') {
      return '<article class="sw-card sw-engage" data-slot="engage" aria-label="שמירת החיפוש">' + dbg +
        '<div class="sw-end-in"><p class="sw-end-title">רוצים שנעדכן כשנכס כזה ייכנס?</p>' +
        '<p class="sw-end-line">נשמור את החיפוש ונשלח רק נכסים חדשים שמתאימים לו.</p>' + alertBlock('engage') + '</div></article>';
    }
    return endCardHtml(dbg);
  }
  function readTime(a) { var w = String((a.subtitle || '') + ' ' + (a.title || '')).split(/\s+/).length; return Math.max(2, Math.round(w / 6)) + ' דק׳ קריאה'; }

  function endCardHtml(dbg) {
    var share = likes.length ? '<button type="button" class="sw-link sw-link-light" id="swShare">שיתוף הרשימה (' + likes.length + ')</button>' : '';
    return '<article class="sw-card sw-end" data-slot="end" aria-label="ראיתם את כל הנכסים באזור">' + (dbg || '') +
      '<div class="sw-end-in"><span class="sw-end-av"><img src="/assets/gabriela-cutout-400.webp" alt="" width="84" height="84" ' +
      'onerror="this.onerror=null;this.src=\'/assets/logo-shuknadlan.svg\'"></span>' +
      '<h2 class="sw-end-title">ראיתם את כל הנכסים באזור</h2>' +
      '<p class="sw-end-line">לצפייה בנכסים נוספים אפשר להרחיב את החיפוש, או להשאיר פרטים ולהתעדכן ראשונים כשנכס חדש ייכנס לשוק.</p>' +
      '<p class="sw-end-gold">בלי פרסומות, רק נכסים</p>' +
      '<button type="button" class="sw-gold sw-wide" id="swWiden">הרחבת החיפוש</button>' +
      alertBlock('end') + share + '</div></article>';
  }
  function alertBlock(where_) {
    var id = 'swAlert_' + where_;
    return '<div class="sw-alert" data-alert="' + where_ + '">' +
      '<button type="button" class="sw-white sw-wide" data-alert-open aria-expanded="false" aria-controls="' + id + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>' +
      'עדכנו אותי על נכס חדש</button>' +
      '<form class="sw-aform" id="' + id + '" hidden novalidate>' +
      '<label class="sw-field"><span>שם</span><input name="name" autocomplete="name" required></label>' +
      '<label class="sw-field"><span>טלפון או אימייל</span><input name="contact" autocomplete="tel" inputmode="email" required></label>' +
      '<label class="sw-consent"><input type="checkbox" name="consent"> <span>מאשרים לקבל משוק נדל״ן הודעות וואטסאפ או SMS על נכסים חדשים שמתאימים לחיפוש הזה. אפשר להפסיק בכל רגע.</span></label>' +
      '<p class="sw-ferr" role="alert"></p>' +
      '<button type="submit" class="sw-gold sw-wide">שליחה</button></form>' +
      '<p class="sw-done" hidden>✅ נרשמתם. נשלח רק נכסים חדשים שמתאימים לחיפוש הזה.</p></div>';
  }

  function renderDeck() {
    var box = $('swDeck');
    var c = cur();
    if (!c) { box.innerHTML = ''; return; }
    var next = deck[idx + 1];
    box.innerHTML = (next ? '<div class="sw-under">' + cardHtml(next, false) + '</div>' : '') +
      '<div class="sw-top-card" id="swTopCard">' + cardHtml(c, true) + '</div>';
    var top = $('swTopCard');
    top.querySelectorAll('.sw-card').forEach(function (el) { el.setAttribute('tabindex', '0'); });
    bindGestures(top);
    syncActions();
    onCardView(c);
  }
  var impTimer = 0;
  function onCardView(c) {
    clearTimeout(impTimer);
    document.querySelectorAll('#swDeck video').forEach(function (v) { v.pause(); });
    // כרטיס שמאחורי חלון הסינון עוד לא נצפה - ‏swipe_start בונה את החפיסה מחדש
    if (!$('swFilter').hidden) return;
    if (c.slot === 'end') { shukTrack('swipe_end_view', { likes: likes.length }); return; }
    shukTrack('swipe_card_view', { slot: c.slot, position: c.pos });
    if (!c.counted && (c.sponsor || c.slot === 'article')) { c.counted = true; shown[c.sponsor ? 'sponsored' : 'articles']++; }
    if (c.sponsor) {
      impTimer = setTimeout(function () { if (cur() === c) shukTrack('sponsored_impression', { slot: c.slot, sponsor_id: c.sponsor.id, position: c.pos }); }, 1000);
      var v = document.querySelector('#swTopCard video');
      if (v && !reduceMotion) v.play().catch(function () {});
    }
  }
  function syncActions() {
    var c = cur(), p = c && c.p, adv = p ? advertiser(p) : null;
    var end = !c || c.slot === 'end';
    $('swSkip').disabled = $('swLike').disabled = end;
    $('swUndo').disabled = !history_.length;
    var phone = adv && adv.phone ? adv.phone.replace(/[^\d+]/g, '') : '';
    $('swCall').hidden = !phone; $('swWa').hidden = !phone;
    if (phone) {
      $('swCall').href = 'tel:' + phone;
      $('swWa').href = 'https://wa.me/' + phone.replace(/^\+/, '') + '?text=' + encodeURIComponent('היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לפרטים');
    }
    $('swLike').setAttribute('aria-pressed', String(!!(p && likes.indexOf(p.id) >= 0)));
  }

  var deciding = false;   // הכרטיס עוד עף - לחיצה כפולה לא מדלגת על הנכס הבא
  function decide(dir) {
    var c = cur();
    if (deciding || !c || c.slot === 'end') return;
    var top = $('swTopCard');
    var added = false;
    if (dir === 'like' && c.p && likes.indexOf(c.p.id) < 0) { likes.push(c.p.id); saveLikes(); added = true; }
    // שני שמות מפורשים ולא ביטוי: כך check_gtm_container.py מוצא את שניהם
    if (dir === 'like') shukTrack('swipe_like', { slot: c.slot, position: c.pos });
    else shukTrack('swipe_skip', { slot: c.slot, position: c.pos });
    // ‏liked רק כשהלייק נוסף עכשיו - ביטול לא מוחק לייק ותיק
    history_.push({ i: idx, liked: added ? c.p.id : null });
    deciding = true;
    var go = function () { deciding = false; idx = Math.min(idx + 1, deck.length - 1); renderDeck(); tourAdvance(); };
    if (top && !reduceMotion) {
      top.classList.add(dir === 'like' ? 'fly-like' : 'fly-skip');
      setTimeout(go, 220);
    } else go();
  }
  function undo() {
    var h = history_.pop();
    if (!h) return;
    if (h.liked) { likes = likes.filter(function (x) { return x !== h.liked; }); saveLikes(); }
    idx = h.i;
    renderDeck();
  }
  $('swSkip').addEventListener('click', function () { decide('skip'); });
  $('swLike').addEventListener('click', function () { decide('like'); });
  $('swUndo').addEventListener('click', undo);

  function nextPhoto(top, step) {
    var c = cur();
    if (!c || !c.p) return;
    var ph = photos(c.p);
    if (ph.length < 2) return;
    c.photo = ((c.photo || 0) + step + ph.length) % ph.length;
    var img = top.querySelector('.sw-cimg');
    if (img && img.tagName === 'IMG') { img.setAttribute('data-orig', ph[c.photo]); img.src = sized(ph[c.photo], 800); }
    top.querySelectorAll('.sw-bars span').forEach(function (s, i) { s.classList.toggle('on', i === c.photo); });
    var cnt = top.querySelector('.sw-count');
    if (cnt) cnt.textContent = (c.photo + 1) + '/' + ph.length;
  }

  /* מחוות: גרירה לצדדים (שמירה/דילוג), למעלה (פרטים), והקשה על צידי התמונה (תמונה) */
  function bindGestures(top) {
    var card = top.querySelector('.sw-card');
    if (!card) return;
    var sx = 0, sy = 0, dx = 0, dy = 0, drag = false, moved = false;
    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,a,input,label,form,textarea')) return;
      drag = true; moved = false; sx = e.clientX; sy = e.clientY; dx = dy = 0;
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', function (e) {
      if (!drag) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      card.style.transform = 'translate(' + dx + 'px,' + Math.min(0, dy) + 'px) rotate(' + (dx / 22) + 'deg)';
      card.classList.toggle('show-like', dx > 60);
      card.classList.toggle('show-skip', dx < -60);
    });
    function end() {
      if (!drag) return;
      drag = false;
      card.style.transition = '';
      card.classList.remove('show-like', 'show-skip');
      var c = cur();
      if (c && c.slot !== 'end' && dx > 100) { decide('like'); return; }
      if (c && c.slot !== 'end' && dx < -100) { decide('skip'); return; }
      card.style.transform = '';
      if (dy < -90 && Math.abs(dx) < 80) { openSheetFor(c); return; }
      if (!moved && c && c.slot === 'property') {
        var r = card.getBoundingClientRect();
        // RTL: הקשה בצד ימין = התמונה הקודמת, בצד שמאל = הבאה
        nextPhoto(top, (sx - r.left) < r.width / 2 ? 1 : -1);
      }
    }
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    card.addEventListener('click', function (e) {
      var c = cur();
      if (e.target.closest('[data-up]')) { openSheetFor(c); return; }
      if (e.target.closest('[data-spon-cta]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); openSheetFor(c); return; }
      if (e.target.closest('[data-spon-link]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); return; }
      if (e.target.closest('[data-article]')) { shukTrack('article_card_open', { article_id: String(c.article.id) }); return; }
      if (e.target.closest('#swWiden')) { openFilter(e.target); return; }
      if (e.target.closest('#swShare')) { shareLikes(); return; }
      var ao = e.target.closest('[data-alert-open]');
      if (ao) {
        var form = ao.parentNode.querySelector('form');
        form.hidden = false; ao.hidden = true; ao.setAttribute('aria-expanded', 'true');
        form.querySelector('input').focus();
      }
    });
    card.addEventListener('submit', function (e) {
      var f = e.target.closest('.sw-aform');
      if (!f) return;
      e.preventDefault();
      submitAlert(f);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (openStack.length || view !== 'deck') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    // חיצים ורווח בתוך גבריאלה או תפריט הנגישות שייכים להם, לא לחפיסה
    if (e.target.closest && e.target.closest('#gabW,.a11y-panel')) return;
    var c = cur();
    if (e.key === 'ArrowRight') { e.preventDefault(); decide('like'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); decide('skip'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (c && c.slot !== 'end' && c.slot !== 'engage') openSheetFor(c); }
    else if (e.key === 'z' || e.key === 'Z' || e.key === 'ז') { undo(); }
    else if (e.key === ' ' && c && c.slot === 'property' && !(e.target.closest && e.target.closest('button,a,[role=button],[role=tab]'))) { e.preventDefault(); nextPhoto($('swTopCard'), 1); }
  });

  /* ---------- 4. גיליון הפרטים ---------- */
  var sheetCard = null, sheetOpener = null, sheetPushed = false, formOpen = false, sent = false;
  var answers = {};
  function questionsFor(c) {
    if (c.sponsor) return null;
    var p = c.p;
    if (isComm(p)) return Q_COMM;
    return p.deal_type === 'rent' ? Q_RENT : Q_SALE;
  }
  function qHtml(qs) {
    return '<fieldset class="sw-q"><legend>כמה שאלות קצרות</legend>' + qs.map(function (q, qi) {
      return '<p class="sw-qt" id="swQ' + qi + '">' + esc(q[0]) + '</p><div class="sw-chips" role="group" aria-labelledby="swQ' + qi + '">' +
        q[1].map(function (o) { return chip(esc(o), 'data-q="' + qi + '" data-a="' + esc(o) + '"', answers[qi] === o); }).join('') + '</div>';
    }).join('') + '</fieldset>';
  }
  function sponQHtml() {
    var interest = answers.interest || '';
    var entry = interest === 'השכרה' ? Q_ENTRY_RENT : Q_ENTRY_BUY;
    return '<fieldset class="sw-q"><legend>כמה שאלות קצרות</legend>' +
      '<p class="sw-qt" id="swQi">מה מעניין אתכם?</p><div class="sw-chips" role="group" aria-labelledby="swQi">' +
      Q_SPON_INTEREST.map(function (o) { return chip(esc(o), 'data-q="interest" data-a="' + esc(o) + '"', interest === o); }).join('') + '</div>' +
      '<p class="sw-qt" id="swQe">מתי להיכנס?</p><div class="sw-chips" role="group" aria-labelledby="swQe">' +
      entry.map(function (o) { return chip(esc(o), 'data-q="entry" data-a="' + esc(o) + '"', answers.entry === o); }).join('') + '</div></fieldset>';
  }
  function bannerHtml(adv, label) {
    var verified = adv.slug ? '<span class="sw-ver">✓ מאומת ' + PIN_SVG + '</span>' : '';
    var prof = adv.href && adv.type !== 'private' ? '<a class="sw-prof" href="' + esc(adv.href) + '" data-prof>' + (adv.type === 'agency' && sheetCard && sheetCard.sponsor ? 'לדף המפרסם ←' : 'לפרופיל ←') + '</a>' : '';
    return '<div class="sw-banner" role="button" tabindex="0" aria-expanded="false" aria-controls="leadForm" id="swBanner">' +
      avatarHtml(adv, 52) + '<div class="sw-bn-txt"><p class="sw-bn-name" id="swSheetTitle">' + esc(adv.name) + '</p>' +
      '<p class="sw-bn-sub">' + esc(adv.sub) + ' ' + verified + '</p></div>' + prof +
      '<span class="sw-bn-pill">' + esc(label) + ' <span aria-hidden="true" class="sw-bn-caret">▾</span></span></div>';
  }
  function propInfoHtml(p) {
    var ph = photos(p), shown = ph.slice(0, 12);
    var tiles = [['חדרים', rooms(p) || '-'], ['שטח', p.size_sqm ? p.size_sqm + ' מ״ר' : '-'], ['קומה', p.floor != null && p.floor !== '' ? p.floor : '-'], ['סוג', p.property_type || '-']];
    var feats = Array.isArray(p.features) ? p.features : [];
    var FEAT = { elevator: 'מעלית', parking: 'חניה', balcony: 'מרפסת', mamad: 'ממ״ד', storage: 'מחסן', ac: 'מיזוג', furnished: 'מרוהטת', accessible: 'נגישות', ev_charger: 'עמדת טעינה', exclusive: 'בלעדיות', renovated: 'משופצת' };
    var desc = p.marketing_description || p.description || '';
    var gm = p.lat && p.lng ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.lat + ',' + p.lng) : '';
    return '<h3 class="sw-sub-h">פרטי הנכס</h3>' +
      (shown.length ? '<div class="sw-gal">' + shown.map(function (u, i) { return '<img ' + imgSrc(u, 480) + ' alt="' + esc(title(p) + ' - תמונה ' + (i + 1)) + '" loading="lazy" width="220" height="150" data-fb="sw-gimg">'; }).join('') + '</div>' +
        '<p class="sw-gal-n">' + ph.length + ' תמונות בנכס · מוצגות ' + shown.length + '</p>'
        : '<div class="sw-gal">' + imgFallback(title(p)).replace('sw-img-fb', 'sw-img-fb sw-gimg') + '</div>') +
      '<p class="sw-dprice">' + esc(fmtPrice(p)) + '</p><p class="sw-dtitle">' + esc(title(p)) + '</p>' +
      '<p class="sw-daddr"><span aria-hidden="true">📍</span> ' + esc(where(p)) + '</p>' +
      '<div class="sw-tiles">' + tiles.map(function (t) { return '<div><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b></div>'; }).join('') + '</div>' +
      (feats.length ? '<div class="sw-feats">' + feats.filter(function (f) { return FEAT[f]; }).map(function (f) { return '<span>' + esc(FEAT[f]) + '</span>'; }).join('') + '</div>' : '') +
      (desc ? '<h3 class="sw-sub-h">תיאור</h3><p class="sw-desc">' + esc(desc) + '</p>' : '') +
      (p.lat && p.lng ? '<h3 class="sw-sub-h">מיקום</h3><div class="sw-minimap" id="swMiniMap"></div>' +
        '<p class="sw-gm"><a href="' + esc(gm) + '" target="_blank" rel="noopener">פתיחה ב-Google Maps ←</a></p>' : '') +
      '<p class="sw-full"><a href="/property?id=' + encodeURIComponent(p.id) + '">לדף הנכס המלא ←</a></p>';
  }
  function formHtml(c) {
    var p = c.p;
    var msg = p ? 'היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לפרטים' : '';
    return '<form class="sw-lead" id="leadForm" hidden novalidate>' +
      '<label class="sw-field"><span>שם</span><input id="swLName" autocomplete="name" required></label>' +
      '<label class="sw-field"><span>טלפון</span><input id="swLPhone" type="tel" inputmode="tel" autocomplete="tel" required></label>' +
      (p ? '<label class="sw-field"><span>הודעה</span><textarea id="swLMsg" rows="3">' + esc(msg) + '</textarea></label>' : '') +
      (p ? qHtml(questionsFor(c)) : sponQHtml()) +
      '<label class="sw-consent"><input type="checkbox" id="swLConsent"> <span>מאשרים פנייה חוזרת מהמפרסם בנוגע לפנייה הזו, בהתאם ל<a href="/terms" target="_blank">תנאי השימוש</a> ול<a href="/privacy" target="_blank">מדיניות הפרטיות</a>.</span></label>' +
      '<p class="sw-ferr" id="swLErr" role="alert"></p></form>' +
      '<p class="sw-done" id="swLDone" hidden>✅ הפנייה נשלחה. יחזרו אליכם בקרוב.</p>';
  }
  function openSheetFor(c) {
    if (!c || (c.slot !== 'property' && !(c.sponsor && (c.slot === 'spon_agency' || c.sponsor.mortgage)))) return;
    if (!$('swTour').hidden) endTour(false);
    sheetCard = c; sheetOpener = document.activeElement; formOpen = false; sent = false; answers = {};
    var adv = c.p ? advertiser(c.p) : { type: 'agency', name: c.sponsor.name, sub: c.sponsor.kind === 'pro' ? c.sponsor.field : 'משרד תיווך',
      img: c.sponsor.logo || '', slug: c.sponsor.slug || '', href: c.sponsor.slug ? (c.sponsor.kind === 'pro' ? '/professional?slug=' : '/agency?slug=') + encodeURIComponent(c.sponsor.slug) : '' };
    var label = c.p ? ctaLabel(adv) : (c.sponsor.kind === 'agency' ? 'יצירת קשר עם המשרד' : 'יצירת קשר עם המפרסם');
    sheetCard.label = label;
    measureActions();
    $('swSheetBody').innerHTML = bannerHtml(adv, label) + formHtml(c) + (c.p ? propInfoHtml(c.p) : '');
    $('swCtaBar').hidden = false;
    syncCta();
    openDialog($('swSheet'));
    try { history.pushState({ swSheet: 1 }, ''); sheetPushed = true; } catch (e) { sheetPushed = false; }
    shukTrack('swipe_up_open', { slot: c.slot, position: c.pos });
    if (c.p && c.p.lat && c.p.lng) setTimeout(function () { miniMap(c.p); }, 60);
  }
  var ownBack = false;   // ‏history.back() שלנו - ה-popstate שלו לא סוגר גיליון שנפתח בינתיים
  function closeSheet(fromPop) {
    if ($('swSheet').hidden) return;
    closeDialog($('swSheet'), sheetOpener);
    if (sheetPushed && !fromPop) { sheetPushed = false; ownBack = true; history.back(); }
    sheetPushed = false;
  }
  window.addEventListener('popstate', function () {
    if (ownBack) { ownBack = false; return; }
    if (!$('swSheet').hidden) { sheetPushed = false; closeSheet(true); }
  });

  function toggleForm(open) {
    formOpen = open === undefined ? !formOpen : open;
    var f = $('leadForm'), b = $('swBanner');
    if (!f) return;
    f.hidden = !formOpen;
    b.setAttribute('aria-expanded', String(formOpen));
    b.querySelector('.sw-bn-caret').textContent = formOpen ? '▴' : '▾';
    syncCta();
  }
  function validLead() {
    var name = ($('swLName') || {}).value || '', phone = ($('swLPhone') || {}).value || '';
    return { name: name.trim().length >= 2, phone: phone.replace(/\D/g, '').length >= 9, consent: !!($('swLConsent') && $('swLConsent').checked) };
  }
  function syncCta() {
    var v = validLead();
    var ready = formOpen && v.name && v.phone && v.consent;
    $('swCta').textContent = ready ? 'שליחת הפנייה ←' : sheetCard.label;
  }
  $('swSheetBody').addEventListener('click', function (e) {
    if (e.target.closest('[data-prof]')) { e.stopPropagation(); return; }
    if (e.target.closest('#swBanner')) { toggleForm(); if (formOpen) $('swLName').focus(); return; }
    var q = e.target.closest('[data-q]');
    if (q) {
      var k = q.dataset.q, a = q.dataset.a;
      answers[k] = answers[k] === a ? undefined : a;   // כל שאלה רשות, ולחיצה שנייה מבטלת
      var fs = q.closest('fieldset');
      var fresh = document.createElement('div');
      fresh.innerHTML = sheetCard.p ? qHtml(questionsFor(sheetCard)) : sponQHtml();
      fs.replaceWith(fresh.firstChild);
    }
  });
  $('swSheetBody').addEventListener('keydown', function (e) {
    if (e.target.id === 'swBanner' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleForm(); }
  });
  $('swSheetBody').addEventListener('input', syncCta);
  $('swSheetBody').addEventListener('change', syncCta);
  $('swCta').addEventListener('click', function () {
    if (sent) return;
    var v = validLead();
    if (!formOpen) toggleForm(true);
    var miss = !v.name ? 'swLName' : !v.phone ? 'swLPhone' : !v.consent ? 'swLConsent' : null;
    if (miss) {
      var el = $(miss);
      el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
      if (formOpen && document.activeElement === el && (miss !== 'swLName' || $('swLName').value)) {
        $('swLErr').textContent = miss === 'swLPhone' ? 'נא להזין מספר טלפון תקין' : miss === 'swLConsent' ? 'צריך לסמן את האישור כדי לשלוח' : 'נא להזין שם';
      }
      return;
    }
    submitLead();
  });
  function answerLine() {
    var c = sheetCard, qs = questionsFor(c) || [];
    var map = { 'מתי מתכננים לקנות?': 'תזמון', 'יש אישור עקרוני למשכנתא?': 'אישור עקרוני', 'מתי להיכנס?': 'כניסה', 'לאיזה שימוש?': 'שימוש', 'גודל נדרש': 'גודל' };
    return qs.map(function (q, i) { return answers[i] ? (map[q[0]] || q[0]) + ': ' + answers[i] : ''; }).filter(Boolean).join(' · ');
  }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.error) { var er = new Error(d.error || 'error'); er.code = d.error; er.limit = d.limit; throw er; }
        return d;
      }); });
  }
  /* קוד שגיאה מהשרת → הודעה בעברית (אותן הודעות של home.js). בלי קוד - בעיית חיבור */
  function errText(e, fallback) {
    var code = e && e.code;
    var m = {
      too_many_searches: 'הגעתם למקסימום החיפושים השמורים (' + ((e && e.limit) || 5) + '). אפשר להפסיק חיפוש קיים מהקישור שבהתראה.',
      no_criteria: 'הוסיפו לפחות תנאי אחד - אזור, סוג נכס, חדרים או תקציב',
      invalid_phone: 'נא להזין מספר טלפון תקין',
      invalid_email: 'נא להזין כתובת אימייל תקינה',
      invalid_name: 'נא להזין שם מלא'
    };
    return (code && m[code]) || fallback;
  }
  var SOURCE_LINE = 'מקור: גלישה בהחלקה';
  function submitLead() {
    var c = sheetCard, btn = $('swCta');
    btn.disabled = true; btn.textContent = 'שולחים…'; $('swLErr').textContent = '';
    var name = $('swLName').value.trim(), phone = $('swLPhone').value.trim();
    var req;
    if (c.p) {
      var line = answerLine();
      var msg = (($('swLMsg') || {}).value || '').trim();
      // מקור הליד ב-CRM: ‏swipe (‏KNOWN_SOURCES ב-lead-routing.ts). השורה האחרונה בהודעה אומרת לסוכן/ת מאיפה הגיע
      req = post(INQUIRY_URL, { property_id: c.p.id, name: name, phone: phone, message: (msg ? msg + '\n' : '') + (line ? line + '\n' : '') + SOURCE_LINE, source: 'swipe' })
        .then(function () { shukTrack('generate_lead', { form_id: 'swipe_up', item_name: c.p.title || '', value: Number(c.p.price) || 0, currency: 'ILS' }); });
    } else if (c.sponsor.kind === 'pro') {
      // משכנתאות - לצינור הקיים (‏mortgage-lead-intake), כמו הטופס בדף הבית
      req = c.sponsor.mortgage
        ? post(SUPABASE_URL + '/functions/v1/mortgage-lead-intake', { full_name: name, phone: phone, owns_property: false })
            .then(function () { shukTrack('generate_lead', { form_id: 'mortgage' }); })
        : Promise.reject(new Error('no_pipeline'));
    } else {
      var interest = answers.interest || '';
      var body = { full_name: name, phone: phone, agency_slug: c.sponsor.slug, consent_agent_contact: true, lead_only: true,
        free_text: 'עניין: ' + (interest || '-') + ' · כניסה: ' + (answers.entry || '-') + '\n' + SOURCE_LINE, source: 'swipe_sponsored',
        /* ‏saved-search-intake דוחה חיפוש בלי קריטריון - העיר של השוק, בלי חדרים ובלי מחיר */
        cities: [mainCity] };
      if (interest === 'קנייה') body.deal_type = 'sale';
      if (interest === 'השכרה') body.deal_type = 'rent';
      req = post(SAVED_SEARCH_URL, body).then(function () { shukTrack('generate_lead', { form_id: 'swipe_sponsored' }); });
    }
    req.then(function () {
      sent = true;
      $('leadForm').hidden = true; $('swLDone').hidden = false;
      $('swCtaBar').hidden = true;
    }, function (e) {
      $('swLErr').textContent = errText(e, 'השליחה לא הצליחה. בדקו את החיבור ונסו שוב.');
      btn.disabled = false; syncCta();
    }).then(function () { btn.disabled = false; });
  }
  function submitAlert(form) {
    var name = form.name.value.trim(), contact = form.contact.value.trim(), err = form.querySelector('.sw-ferr');
    var isMail = /@/.test(contact);
    if (name.length < 2) { err.textContent = 'נא להזין שם'; form.name.focus(); return; }
    if (isMail ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) : contact.replace(/\D/g, '').length < 9) { err.textContent = 'נא להזין טלפון או אימייל תקינים'; form.contact.focus(); return; }
    if (!form.consent.checked) { err.textContent = 'צריך לסמן את האישור כדי לשלוח'; form.consent.focus(); return; }
    err.textContent = '';
    var f = filter;
    var body = { full_name: name, consent_agent_contact: false, source: 'swipe_end',
      deal_type: f.deal === 'rent' ? 'rent' : 'sale', category: f.deal === 'commercial' ? 'commercial' : 'residential',
      contact_channel: isMail ? 'email' : 'whatsapp' };
    if (isMail) body.email = contact; else body.phone = contact;
    if (f.budget) body.max_price = f.budget;
    if (f.rooms) body.min_rooms = f.rooms;
    body.cities = f.area === 'main' ? [mainCity] : f.area.indexOf('city:') === 0 ? [f.area.slice(5)]
      : (market && market.places ? market.places.slice(0, 10) : [mainCity]);
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    post(SAVED_SEARCH_URL, body).then(function () {
      shukTrack('generate_lead', { form_id: 'swipe_end_alert' });
      form.hidden = true;
      form.parentNode.querySelector('.sw-done').hidden = false;
    }, function (e) { err.textContent = errText(e, 'השליחה לא הצליחה. בדקו את החיבור ונסו שוב.'); btn.disabled = false; });
  }
  function shareLikes() {
    var urls = likes.map(function (id) { return location.origin + '/property?id=' + encodeURIComponent(id); });
    var text = 'הנכסים ששמרתי בשוק הנדל״ן:\n' + urls.join('\n');
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    var a = document.createElement('a');
    a.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('data-share', '');
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('swLikes').addEventListener('click', function () {
    setView('list', true);
  });

  /* ---------- 5. מפה, רשימה וההדרכה ---------- */
  var map = null, mapReady = false, markers = null, lastView = 'deck';
  function tileFallback(box, chipEl) {
    var failed = function () {
      if (box.classList.contains('tiles-off')) return;
      box.classList.add('tiles-off');
      if (chipEl && !chipEl.dataset.closed) chipEl.hidden = false;
    };
    return failed;
  }
  function addTiles(m, failed) {
    if (window.MapTiles) {
      MapTiles.addTo(m).then(function (tl) {
        if (!tl) return;
        if (tl.on) tl.on('tileerror', failed);
        var gl = tl.getMaplibreMap && tl.getMaplibreMap();
        if (gl && gl.on) gl.on('error', failed);
      }, failed);
    } else failed();
  }
  function initMap() {
    if (mapReady || !window.L) return;
    var center = (window.CityContext && CityContext.center()) || [32.6078, 35.2897];
    map = L.map('swMap', { zoomControl: true, scrollWheelZoom: true }).setView(center, 13);
    /* ✕ מעל ה-+ וה-−, באותה עמודה ובאותו סגנון */
    var zoom = map.zoomControl.getContainer();
    var x = L.DomUtil.create('a', 'sw-map-x', zoom);
    x.href = '#'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'סגירת המפה'); x.title = 'סגירת המפה';
    x.innerHTML = '<span aria-hidden="true">✕</span>';
    zoom.insertBefore(x, zoom.firstChild);
    L.DomEvent.on(x, 'click', function (e) { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); setView(lastView === 'map' ? 'list' : lastView); });
    addTiles(map, tileFallback($('swMap'), $('swMapChip')));
    markers = L.layerGroup().addTo(map);
    mapReady = true;
    drawMapMarkers();
  }
  $('swMapChipX').addEventListener('click', function () { $('swMapChip').hidden = true; $('swMapChip').dataset.closed = '1'; });
  function shortPrice(p) {
    var v = Number(p.price);
    if (!v) return 'לפי בקשה';
    return v >= 1000000 ? '₪' + (v / 1000000).toFixed(v % 1000000 ? 2 : 0).replace(/\.?0+$/, '') + 'M' : '₪' + v.toLocaleString('he-IL');
  }
  function drawMapMarkers() {
    if (!mapReady) return;
    markers.clearLayers();
    var props = deck.filter(function (c) { return c.slot === 'property' && c.p.lat && c.p.lng; });
    props.forEach(function (c) {
      var m = L.marker([+c.p.lat, +c.p.lng], { icon: L.divIcon({ className: '', iconSize: null,
        html: '<span class="sw-pin">' + esc(shortPrice(c.p)) + '</span>' }), keyboard: true }).addTo(markers);
      var el = m.getElement();
      if (el) el.setAttribute('aria-label', title(c.p) + ', ' + fmtPrice(c.p));
      m.on('click', function () { openSheetFor(c); });
    });
    /* ‏C10: המפה מתמקדת בתוצאות המסוננות. נקודה מחוץ לישראל, או רחוקה יותר
       מ-25 ק"מ מהחציון (קואורדינטות שגויות במסד), אינה מושכת את המפה לכל הארץ */
    var pts = props.map(function (c) { return [+c.p.lat, +c.p.lng]; })
      .filter(function (q) { return q[0] > 29 && q[0] < 33.6 && q[1] > 34 && q[1] < 36; });
    if (pts.length > 2) {
      var med = function (i) { var v = pts.map(function (q) { return q[i]; }).sort(function (a, b) { return a - b; }); return v[v.length >> 1]; };
      var mLat = med(0), mLng = med(1);
      var near = pts.filter(function (q) { return km(mLat, mLng, q[0], q[1]) <= 25; });
      if (near.length) pts = near;
    }
    if (pts.length) {
      map.invalidateSize();
      try { map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 15 }); } catch (e) {}
    }
  }
  function renderList() {
    var props = deck.filter(function (c) { return c.slot === 'property'; });
    $('swListCount').textContent = props.length === 1 ? 'נכס אחד' : props.length + ' נכסים';
    var likedFirst = view === 'list' && listLikedOnly ? props.filter(function (c) { return likes.indexOf(c.p.id) >= 0; }) : props;
    $('swList').innerHTML = likedFirst.map(function (c) {
      var p = c.p, ph = photos(p);
      return '<button type="button" class="sw-li" data-pos="' + c.pos + '">' +
        (ph.length ? '<img ' + imgSrc(ph[0], 240) + ' alt="" loading="lazy" width="112" height="84" data-fb="sw-liimg">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-liimg')) +
        '<span class="sw-li-txt"><b>' + esc(fmtPrice(p)) + '</b><span>' + esc(title(p)) + '</span><small>' + esc(where(p)) + '</small></span>' +
        (likes.indexOf(p.id) >= 0 ? '<span class="sw-li-heart" aria-label="שמור">♥</span>' : '') + '</button>';
    }).join('') || '<p class="sw-fnote">אין נכסים בסינון הזה.</p>';
  }
  var listLikedOnly = false;
  $('swList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pos]');
    if (!b) return;
    var c = deck.filter(function (x) { return String(x.pos) === b.dataset.pos; })[0];
    openSheetFor(c);
  });
  function setView(v, likedOnly) {
    if (v !== 'map') lastView = v;
    else if (view !== 'map') lastView = view;
    view = v;
    document.body.dataset.view = v;
    listLikedOnly = !!likedOnly && v === 'list';
    document.querySelectorAll('.sw-views [data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === v)); });
    $('swDeckView').hidden = v !== 'deck';
    $('swListView').hidden = v !== 'list';
    $('swMapView').hidden = v !== 'map';
    if (v === 'list') renderList();
    if (v === 'map') { initMap(); if (map) setTimeout(function () { map.invalidateSize(); drawMapMarkers(); }, 30); }
  }
  document.querySelectorAll('.sw-views [data-view]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); });
  });

  var miniMapObj = null;
  function miniMap(p) {
    var box = $('swMiniMap');
    if (!box || !window.L) return;
    if (miniMapObj) { try { miniMapObj.remove(); } catch (e) {} }
    miniMapObj = L.map(box, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, keyboard: false, touchZoom: false })
      .setView([+p.lat, +p.lng], 15);
    addTiles(miniMapObj, tileFallback(box, null));
    L.marker([+p.lat, +p.lng], { icon: L.divIcon({ className: '', iconSize: [27, 32], iconAnchor: [13, 32], html: PIN_SVG }), keyboard: false }).addTo(miniMapObj);
  }

  /* ההדרכה: בשני הביקורים הראשונים בכל סוג מכשיר (‏localStorage בלבד).
     שכבה על הכרטיס העליון ולא חלון: שלושה טיפים כמו באבטיפוס (‏Coach) -
     החלקה לצדדים (יד שזזה, "אהבתי" / "לא מעניין"), הקשה על צדי התמונה (קו
     מקווקו ושתי ידיים מקישות, רק כשיש לכרטיס יותר מתמונה אחת), והחלקה למעלה
     (יד עולה ופאנל "פרטי הנכס" שמציץ). ‏prefers-reduced-motion - בלי תנועה. */
  var HAND = '<svg class="sw-hand" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';
  var UP = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  function tourSteps() {
    var d = isDesktop(), c = cur(), multi = !!(c && c.p && photos(c.p).length > 1);
    var steps = [{
      kind: 'swipe',
      text: 'החליקו ימינה אם אהבתם, שמאלה כדי לדלג',
      sub: d ? 'או במקלדת: → אהבתי · ← לא מעניין · וגם בכפתורים שלמטה' : 'אפשר גם בכפתורים ♥ ו-✕ שבתחתית המסך',
      art: '<span class="sw-co-pill is-like">♥ אהבתי</span><span class="sw-co-pill is-skip">✕ לא מעניין</span>' +
        '<span class="sw-co-hline"></span><span class="sw-co-arrows"><span>‹</span><span>›</span></span>' +
        '<span class="sw-co-hand-x">' + HAND + '</span>'
    }];
    if (multi) steps.push({
      kind: 'tap',
      text: d ? 'לחצו שמאלה לתמונה הבאה, ימינה לקודמת' : 'הקישו שמאלה לתמונה הבאה, ימינה לקודמת',
      sub: d ? 'או מקש רווח לתמונה הבאה. הפסים למעלה מראים באיזו תמונה אתם' : 'הפסים בראש הכרטיס מראים באיזו תמונה אתם',
      art: '<span class="sw-co-vline"></span>' +
        '<span class="sw-co-zone is-left"><span class="sw-co-tapwrap"><span class="sw-co-rip"></span><span class="sw-co-tap">' + HAND + '</span></span><b>התמונה<br>הבאה</b></span>' +
        '<span class="sw-co-zone is-right"><span class="sw-co-tapwrap"><span class="sw-co-rip is-late"></span><span class="sw-co-tap is-late">' + HAND + '</span></span><b>התמונה<br>הקודמת</b></span>'
    });
    steps.push({
      kind: 'up',
      text: (d ? 'גררו למעלה או הקישו ↑ לפרטי הנכס,' : 'החליקו למעלה לפרטי הנכס,') + ' ✦ הדמיה ויצירת קשר',
      sub: d ? 'הפרטים, ההדמיה ויצירת הקשר נפתחים בגיליון על הכרטיס' : 'בגיליון הפרטים: תמונות, מפה, תיאור ויצירת קשר',
      art: '<span class="sw-co-uline"></span><b class="sw-co-uword">לפרטי<br>הנכס</b>' +
        '<span class="sw-co-ups">' + UP + UP + '</span><span class="sw-co-hand-y"><span class="sw-co-rip"></span>' + HAND + '</span>' +
        '<span class="sw-co-peek"><i></i><b>פרטי הנכס</b><span><em>✦ הדמיה</em><em>מפה ותיאור</em><em>יצירת קשר</em></span></span>'
    });
    return steps;
  }
  var tourList = [], tourStep = 0, tourVisit = 0;
  function tourKey() { return 'sk_swipe_tour_seen_' + (isDesktop() ? 'desktop' : 'mobile'); }
  var tourThisVisit = false;   // ביקור = טעינת דף; "התחילו להחליק" שוב באותו ביקור אינו ביקור חדש
  function maybeTour(force) {
    var seen = Number(store(tourKey())) || 0;
    if (!force && (seen >= 2 || tourThisVisit)) return;
    if (!force) tourThisVisit = true;
    if (!$('swTopCard')) return;
    if (!force) { tourVisit = seen + 1; store(tourKey(), String(tourVisit)); }
    var t = $('swTour');
    tourList = tourSteps();
    placeTour();
    tourStep = 0; showTip();
    openDialog(t);
  }
  /* השכבה יושבת מחוץ ל-#swDeck (שנבנה מחדש בכל החלקה) ומונחת בדיוק מעל הכרטיס */
  function placeTour() {
    var r = $('swDeck').getBoundingClientRect(), t = $('swTour');
    t.style.top = r.top + 'px'; t.style.left = r.left + 'px';
    t.style.width = r.width + 'px'; t.style.height = r.height + 'px';
  }
  window.addEventListener('resize', function () { if (!$('swTour').hidden) placeTour(); });
  function showTip() {
    var s = tourList[tourStep], t = $('swTour');
    t.className = 'sw-tour is-' + s.kind;
    $('swTourStep').textContent = 'טיפ ' + (tourStep + 1) + ' מתוך ' + tourList.length;
    $('swTourText').textContent = s.text;
    $('swTourSub').textContent = s.sub;
    $('swTourArt').innerHTML = s.art;
    var card = $('swTopCard') && $('swTopCard').querySelector('.sw-card');
    if (card) {
      card.classList.remove('sw-co-wig', 'sw-co-upc');
      card.classList.add('sw-touring');
      void card.offsetWidth;   // מתחילים את התנועה מחדש בכל טיפ
      if (s.kind === 'swipe') card.classList.add('sw-co-wig');
      if (s.kind === 'up') card.classList.add('sw-co-upc');
    }
  }
  // החלקה בזמן ההדרכה (כמו באבטיפוס): הטיפ הבא, או סיום אחרי האחרון
  function tourAdvance() {
    if ($('swTour').hidden) return;
    if (tourStep < tourList.length - 1) { tourStep++; showTip(); placeTour(); } else endTour(false);
  }
  function endTour(skipped) {
    if (skipped) { store(tourKey(), '2'); shukTrack('swipe_tour_skip', { visit: tourVisit || 1 }); }
    var card = $('swTopCard') && $('swTopCard').querySelector('.sw-card');
    if (card) card.classList.remove('sw-co-wig', 'sw-co-upc', 'sw-touring');
    closeDialog($('swTour'), card);
  }
  $('swTourOk').addEventListener('click', function () { if (tourStep < tourList.length - 1) { tourStep++; showTip(); } else endTour(false); });
  $('swTourSkip').addEventListener('click', function () { endTour(true); });
  $('swHelp').addEventListener('click', function () { maybeTour(true); });

  /* ---------- התחלה ---------- */
  var urlDeal = params.get('deal');
  if (urlDeal === 'rent' || urlDeal === 'sale' || urlDeal === 'commercial') filter.deal = urlDeal;
  if (params.get('fair') === '1') filter.fair = true;
  renderLikes();
  document.body.dataset.view = 'deck';
  $('swDeck').innerHTML = '<div class="sw-loading" role="status">טוענים נכסים…</div>';
  function start() {
    load().then(function (rows) {
      all = rows;
      openFilter($('swSum'));
      buildDeck();
    });
  }
  if (window.supabase) start(); else window.addEventListener('load', start);
})();
