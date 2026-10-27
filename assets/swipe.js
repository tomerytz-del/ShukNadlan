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
  /* יצירת הדמיה מתוך ההחלקה (חלק 2 §5.3): כבוי עד שהמיגרציה של הבלם לגולש/ת
     (‏docs/proposals/visualization_visitor_cap.sql) תוחל. הקריאה, שקופית לפני/אחרי
     והסטודיו עובדים גם כך - במקום הכפתור יש קישור לדף הנכס. */
  var VIZ_SWIPE_GENERATE = false;

  /* ---------- סדר הכרטיסים (‏seq-v1). ‏sponsors ריק = אין כרטיסים ממומנים ---------- */
  var SEQ_CONFIG = {
    version: 'seq-v1',
    slots: [
      { at: 6, kind: 'spon_agency', firstSessionAt: 8 },
      { at: 16, kind: 'spon_pro' },
      { at: 22, kind: 'article' },
      { at: 26, kind: 'spon_agency' }
    ],
    cycleEvery: 12,
    cyclePattern: ['spon_agency'],
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
  /* ---------- הדמיות AI בהחלקה (סבב 4, חלק 2) ----------
     ‏property_visualizations_recent ולא ‎_public‎: השני הוא סט הבסיס בלבד, ו-recent
     כולל גם הדמיות לפי דרישה - מה שדף הנכס מציג. נטען אחרי הנכסים ובלי לעכב את
     הכרטיס הראשון. ‏vizMap: מזהה נכס → כל השורות, ממוינות כמו pickViz (בסיס קודם,
     אחר כך סלון → חלל העסק → מטבח → חזית, אחר כך החדש).
     **תמונה אמיתית לעולם אינה מסומנת כהדמיה:** ההדמיה היא שקופית אחת בסוף הקרוסלה,
     לפני/אחרי, ורק אחרי ששתי התמונות שלה נטענו (‏vizPrep). אם אף זוג לא נטען -
     שקופית הזמנה ("✨ צרו הדמיה לנכס הזה") במקומה. */
  var vizMap = new Map(), vizBase = new Set(), vizReady = false;
  var vizPair = new Map(), vizPrepP = new Map(), vizBad = new Set(), vizElig = new Map(), vizEligP = new Map();
  var VIZ_ORDER = ['living_room', 'interior_main', 'kitchen', 'exterior'];
  var LAND_RE = /מגרש|קרקע|נחל|משק|חקלא/;   // זהה ל-isLandType ב-_shared/visualization.ts
  function isLand(p) { return LAND_RE.test((p && p.property_type) || ''); }
  function vizOf(p) { return (p && vizMap.get(p.id)) || null; }
  /* השקופית המיוחדת של הנכס: ‏'ba' (לפני/אחרי), ‏'invite' (הזמנה) או '' */
  function vizSpecial(p) {
    if (!p || !photos(p).length) return '';
    if (vizPair.get(p.id)) return 'ba';
    if (!vizReady || isLand(p) || vizElig.get(p.id) !== true) return '';
    if (vizMap.has(p.id) && vizPair.get(p.id) !== null) return '';   // הזוג עוד נטען
    return 'invite';
  }
  function slides(p) {
    var sp = vizSpecial(p);
    return sp ? photos(p).concat(['#viz:' + sp]) : photos(p);
  }
  function slideKind(s) { return s === '#viz:ba' ? 'ba' : s === '#viz:invite' ? 'invite' : ''; }
  function slideBase(p, s) {
    var k = slideKind(s);
    if (k === 'ba') return vizPair.get(p.id).after;
    if (k === 'invite') return photos(p)[0];
    return s;
  }
  function loadViz(rows) {
    var ids = rows.map(function (p) { return p.id; });
    if (!ids.length || !sb) return Promise.resolve();
    var COLS = 'property_id, target, style_key, source_image_url, result_url, is_base, created_at';
    var chunks = [];
    for (var i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
    function q(part, cols) {
      return sb.from('property_visualizations_recent').select(cols).in('property_id', part).order('created_at', { ascending: false });
    }
    return Promise.all(chunks.map(function (part) {
      // ‏business_type נוסף ל-view מאוחר יותר; בלעדיו - אותה שאילתה בלי העמודה (כמו property.js)
      return q(part, COLS + ', business_type').then(function (r) {
        if (r && !r.error) return r.data || [];
        return q(part, COLS).then(function (r2) { return (r2 && !r2.error && r2.data) || []; });
      }).then(null, function () { return []; });
    })).then(function (parts) {
      var by = {};
      parts.forEach(function (list) {
        list.forEach(function (v) {
          if (!v || !v.result_url) return;
          (by[v.property_id] = by[v.property_id] || []).push({ target: v.target || '', style: v.style_key || '', biz: v.business_type || '',
            after: v.result_url, before: v.source_image_url || '', base: !!v.is_base, at: v.created_at || '' });
          if (v.is_base) vizBase.add(v.property_id);
        });
      });
      Object.keys(by).forEach(function (id) {
        var rank = function (t) { var i = VIZ_ORDER.indexOf(t); return i < 0 ? 9 : i; };
        vizMap.set(id, by[id].sort(function (a, b) {
          return (b.base - a.base) || (rank(a.target) - rank(b.target)) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
        }));
      });
      vizReady = true;
      /* מספרי הכותרת נשארים על סט הבסיס (‏_public, חלק 2 §5.1) - זה מה ש-recent
         מסמן ‏is_base. אותו נתון לגבריאלה: "לרוב הנכסים יש הדמיה" רק כשזה נכון */
      var n = rows.filter(function (p) { return vizBase.has(p.id); }).length;
      window.ShukViz = { n: n, total: rows.length, coverage: rows.length ? n / rows.length : 0 };
    });
  }
  /* תמונה שנטענה באמת (או נכשלה / 8 שניות) - לפני שמציירים זוג לפני/אחרי */
  function loadImg(u) {
    return new Promise(function (ok, bad) {
      if (!u || vizBad.has(u)) { bad('load_error'); return; }
      var im = new Image(), t = setTimeout(function () { vizBad.add(u); bad('timeout'); }, 8000);
      im.onload = function () { clearTimeout(t); if (im.naturalWidth > 0) ok(); else { vizBad.add(u); bad('load_error'); } };
      im.onerror = function () { clearTimeout(t); vizBad.add(u); bad('load_error'); };
      im.src = sized(u, 800);
    });
  }
  function vizPrep(p) {
    if (!vizMap.has(p.id) || vizPrepP.has(p.id)) return vizPrepP.get(p.id) || Promise.resolve();
    var list = vizMap.get(p.id).filter(function (v) { return v.before && v.after; }), reason = 'no_pair';
    var pr = (function tryAt(i) {
      if (i >= list.length) return Promise.reject(reason);
      return Promise.all([loadImg(list[i].after), loadImg(list[i].before)]).then(function () { return list[i]; },
        function (r) { reason = r || 'load_error'; return tryAt(i + 1); });
    })(0).then(function (v) { vizPair.set(p.id, v); }, function (r) {
      vizPair.set(p.id, null);
      shukTrack('viz_ba_fallback', { property_id: p.id, reason: String(r || 'load_error') });
      return vizEligible(p);   // אין זוג שנטען - שקופית הזמנה במקומו, אם הנכס זכאי
    });
    vizPrepP.set(p.id, pr);
    return pr;
  }
  /* הזכאות נשאלת מהמסד (‏property_visualizations_enabled), כמו בדף הנכס */
  function vizEligible(p) {
    if (vizEligP.has(p.id)) return vizEligP.get(p.id);
    var pr = !sb || isLand(p) || !photos(p).length ? Promise.resolve(false)
      : sb.rpc('property_visualizations_enabled', { p_property_id: p.id }).then(function (r) { return !!(r && !r.error && r.data); }, function () { return false; });
    pr = pr.then(function (ok) { vizElig.set(p.id, ok); });
    vizEligP.set(p.id, pr);
    return pr;
  }
  /* הכרטיס שעל המסך ושניים אחריו: הזוג נטען מראש, והשקופית מצטרפת כשהוא מוכן */
  function vizPrime() {
    if (!vizReady) return;
    for (var i = idx; i < Math.min(deck.length, idx + 3); i++) {
      (function (c) {
        if (!c || c.slot !== 'property' || !photos(c.p).length) return;
        var pr = vizMap.has(c.p.id) ? vizPrep(c.p) : vizEligible(c.p);
        pr.then(function () { if (cur() === c && $('swTopCard')) syncSlide($('swTopCard'), c); });
      })(deck[i]);
    }
  }
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
    if (f.viz && !vizMap.has(p.id)) return false;
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
    // ‏V3: "✨ רק נכסים עם הדמיה" - רק אחרי שההדמיות נטענו, ורק כשיש כאלה בסינון
    var vizN = vizReady ? countFor({ viz: true }) : 0;
    $('swFViz').hidden = $('swFVizL').hidden = !vizReady || (!vizN && !filter.viz);
    $('swFViz').innerHTML = chip('✨ רק נכסים עם הדמיה ' + n(vizN), 'data-viz="1"', !!filter.viz);
    var c = filtered().length;
    $('swFCount').textContent = c === 1 ? 'נכס אחד מתאים' : c + ' נכסים מתאימים';
    $('swFGo').disabled = false;
    renderSummary();
  }
  function renderSummary() {
    var deal = { sale: 'למכירה', rent: 'להשכרה', commercial: 'מסחרי' }[filter.deal];
    var area = filter.near ? 'לידי' : filter.area === 'all' ? marketLabel : filter.area === 'main' ? mainCity :
      filter.area === 'around' ? 'יישובי הסביבה' : filter.area.slice(5);
    $('swSumText').textContent = (filter.fair ? 'יריד הבתים הפתוחים · ' : '') + deal + ' · ' + area + (filter.viz ? ' · ✨ הדמיה' : '');
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
    if (b.dataset.viz) { filter.viz = !filter.viz; renderFilter(); return; }
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
    var sp = { deal: filter.deal, region: market ? market.slug : '', via: 'swipe_filter' };
    if (filter.viz) sp.viz = 1;
    shukTrack('swipe_start', sp);
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
    // גיליון תחתון שחיכה בתור עולה 600ms אחרי שהדיאלוג נסגר
    setTimeout(bsDrain, 600);
  }
  document.addEventListener('keydown', function (e) {
    var top = openStack[openStack.length - 1];
    if (top && e.key === 'Escape') {
      e.preventDefault();
      if (top === $('swSheet')) closeSheet(); else if (top === $('swFilter')) closeFilter(); else if (top === $('swTour')) endTour(false);
      else if (top === $('swBsWrap')) bsClose('esc');
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
  /* אחרי הלייק הראשון הלב שבראש המסך הופך לגלולה "♥ N · הרשימה שלי" */
  function renderLikes() {
    $('swLikesN').textContent = likes.length;
    $('swLikesL').hidden = !likes.length;
    $('swLikes').classList.toggle('is-pill', likes.length > 0);
    $('swLikes').setAttribute('aria-label', likes.length ? 'הרשימה שלי, ' + likes.length + ' נכסים שאהבתי' : 'נכסים שאהבתי');
    if (view === 'likes') renderLikesView();
  }

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
      var p = c.p, ph = slides(p), adv = advertiser(p), at = (top && c.photo) || 0;
      if (at >= ph.length) at = c.photo = 0;
      var sp = top ? slideKind(ph[at]) : '';
      var img = ph.length ? '<img class="sw-cimg" draggable="false" data-fb="sw-cimg" ' + imgSrc(slideBase(p, ph[at]), 800) + ' alt="' + esc(title(p)) + '"' + (top ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">'
        : imgFallback(title(p)).replace('sw-img-fb', 'sw-img-fb sw-cimg');
      var bars = '<div class="sw-bars" aria-hidden="true">' + barsHtml(ph, at) + '</div>';
      var facts = [rooms(p) ? rooms(p) + ' חד׳' : '', p.size_sqm ? p.size_sqm + ' מ״ר' : '', p.floor != null && p.floor !== '' ? 'קומה ' + p.floor : ''].filter(Boolean).join(' · ');
      return '<article class="sw-card' + (sp ? ' is-' + sp : '') + '" data-slot="property" aria-label="' + esc(title(p) + ', ' + fmtPrice(p)) + '">' + img +
        '<div class="sw-vlayer">' + (sp ? layerHtml(p, sp) : '') + '</div>' + bars + dbg +
        '<div class="sw-ctop"><span class="sw-tag ' + (p.deal_type === 'rent' ? 'is-rent' : 'is-sale') + '">' + (isComm(p) ? 'מסחרי' : p.deal_type === 'rent' ? 'להשכרה' : 'למכירה') + '</span>' +
        (p.property_type ? '<span class="sw-tag is-type">' + esc(p.property_type) + '</span>' : '') +
        '<span class="sw-count" aria-hidden="true"' + (ph.length > 1 ? '' : ' hidden') + '>' + (at + 1) + '/' + ph.length + '</span></div>' +
        '<button type="button" class="sw-vpill" data-vpill aria-label="איך זה יכול להיראות? מעבר להשוואת לפני ואחרי"' + (top && vizPair.get(p.id) && !sp ? '' : ' hidden') + '>✨ איך זה יכול להיראות?</button>' +
        '<div class="sw-cbody"><p class="sw-price">' + esc(fmtPrice(p)) + '</p>' +
        '<h2 class="sw-ctitle">' + esc(title(p)) + '</h2>' +
        (facts ? '<p class="sw-facts">' + esc(facts) + '</p>' : '') +
        '<p class="sw-where"><span aria-hidden="true">📍</span> ' + esc(where(p)) + '</p>' +
        '<p class="sw-by">' + esc(adv.type === 'private' ? 'מודעה פרטית' : adv.name) + '</p>' +
        '<button type="button" class="sw-up" data-up' + (sp === 'ba' ? ' hidden' : '') + '>פרטים ויצירת קשר <span aria-hidden="true">↑</span></button>' +
        '<button type="button" class="sw-vcta" data-studio="slide_cta"' + (sp === 'ba' ? '' : ' hidden') + '>רוצים לראות בסגנון אחר? <b>✨ צרו הדמיה</b></button></div>' +
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
        (a.cover_url ? '<img class="sw-cimg" draggable="false" data-fb="sw-cimg" src="' + esc(a.cover_url) + '" alt="" loading="lazy">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-cimg')) +
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
  function barsHtml(ph, at) {
    if (ph.length < 2) return '';
    return ph.slice(0, 10).map(function (u, i) {
      var cl = [i === at ? 'on' : '', slideKind(u) === 'ba' ? 'is-viz' : ''].filter(Boolean).join(' ');
      return '<span' + (cl ? ' class="' + cl + '"' : '') + '></span>';
    }).join('');
  }
  /* השכבה שמעל התמונה בשקופית המיוחדת: לפני/אחרי (התמונה עצמה היא ה"אחרי"), או ההזמנה */
  function layerHtml(p, sp) {
    if (sp === 'ba') return baHtml(vizPair.get(p.id), false);
    if (sp !== 'invite') return '';
    var line = isComm(p) ? 'ראו איך הוא יכול להיראות כעסק שלכם'
      : p.deal_type === 'rent' ? 'ראו איך הוא יכול להיראות מרוהט ומעוצב' : 'ראו איך הוא יכול להיראות אחרי שיפוץ';
    return '<div class="sw-inv"><h3 class="sw-inv-t">✨ צרו הדמיה לנכס הזה</h3><p class="sw-inv-s">' + esc(line) + '</p>' +
      '<button type="button" class="sw-gold sw-inv-b" data-studio="invite">✨ צרו הדמיה</button></div>';
  }
  var baHintGone = false;   // "גררו להשוואה" עד הגרירה הראשונה בביקור
  function baHtml(v, withAfter) {
    return '<div class="sw-ba' + (baHintGone ? ' is-touched' : '') + '" style="--pos:50%">' +
      (withAfter ? '<img class="sw-ba-after" draggable="false" data-fb="sw-ba-after" ' + imgSrc(v.after, 800) + ' alt="אחרי - הדמיית AI">' : '') +
      '<img class="sw-ba-before" draggable="false" data-fb="sw-ba-before" ' + imgSrc(v.before, 800) + ' alt="לפני - הצילום האמיתי">' +
      '<span class="sw-ba-line" aria-hidden="true"></span><span class="sw-ba-knob" aria-hidden="true">‹ ›</span>' +
      '<span class="sw-ba-lbl is-before" aria-hidden="true">לפני</span><span class="sw-ba-lbl is-after" aria-hidden="true">אחרי · ✨ הדמיית AI</span>' +
      '<span class="sw-ba-hint" aria-hidden="true">גררו להשוואה</span>' +
      '<div class="sw-ba-strip" role="slider" tabindex="0" aria-label="ידית השוואה: גררו להשוואה בין לפני לאחרי" aria-valuemin="3" aria-valuemax="97" aria-valuenow="50"></div></div>';
  }
  /* רק רצועה של 56px סביב הקו היא הידית: שם הגרירה לא מגיעה לכרטיס. מחוץ לה - החלקה רגילה */
  function bindBa(el) {
    if (!el) return;
    var strip = el.querySelector('.sw-ba-strip'), on = false;
    function set(pos) {
      pos = Math.max(3, Math.min(97, pos));
      el.style.setProperty('--pos', pos + '%');
      strip.setAttribute('aria-valuenow', String(Math.round(pos)));
    }
    function touched() { baHintGone = true; el.classList.add('is-touched'); }
    function fromX(x) { var r = el.getBoundingClientRect(); if (r.width) set((x - r.left) / r.width * 100); }
    strip.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      on = true; el.classList.add('is-dragging'); touched();
      try { strip.setPointerCapture(e.pointerId); } catch (er) {}
      fromX(e.clientX);
    });
    strip.addEventListener('pointermove', function (e) { if (!on) return; e.stopPropagation(); fromX(e.clientX); });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      strip.addEventListener(t, function (e) { if (!on) return; e.stopPropagation(); on = false; el.classList.remove('is-dragging'); });
    });
    strip.addEventListener('click', function (e) { e.stopPropagation(); });
    strip.addEventListener('keydown', function (e) {
      var k = e.key, v = Number(strip.getAttribute('aria-valuenow')) || 50;
      var d = k === 'ArrowLeft' ? -5 : k === 'ArrowRight' ? 5 : k === 'Home' ? -100 : k === 'End' ? 100 : 0;
      if (!d && k !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      if (d) { set(v + d); touched(); }
    });
    el._set = set;
  }
  /* פעם במכשיר: הידית זזה 50% → 70% וחוזרת, כשהשקופית גלויה ואין גיליון מעליה */
  function baIntro() {
    if (store('sk_viz_ba_intro') || reduceMotion) return;
    setTimeout(function () {
      var c = cur(), top = $('swTopCard'), el = top && top.querySelector('.sw-card.is-ba .sw-ba');
      if (!el || !el._set || openStack.length || bsKind || store('sk_viz_ba_intro')) return;
      store('sk_viz_ba_intro', '1');
      var legs = [[50, 70], [70, 50]], t0 = 0, leg = 0, D = 850;
      var ease = function (t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
      function frame(ts) {
        if (!t0) t0 = ts;
        var k = Math.min(1, (ts - t0) / D), a = legs[leg];
        if (el.classList.contains('is-dragging') || cur() !== c) return;
        el._set(a[0] + (a[1] - a[0]) * ease(k));
        if (k < 1) requestAnimationFrame(frame);
        else if (++leg < legs.length) { t0 = 0; requestAnimationFrame(frame); }
      }
      requestAnimationFrame(frame);
    }, 450);
  }
  function vizSlideSeen(c, sp) {
    c.vizSeen = c.vizSeen || {};
    if (!c.vizSeen[sp]) { c.vizSeen[sp] = true; shukTrack('viz_slide_view', { property_id: c.p.id, kind: sp }); }
    if (sp !== 'ba') return;
    if (!store('sk_viz_intro_sheet')) {
      store('sk_viz_intro_sheet', '1');
      bsOpen('viz', { onStudio: function () { openSheetFor(c, { tab: 'viz', from: 'nudge' }); } });
    } else baIntro();
  }
  function readTime(a) { var w = String((a.subtitle || '') + ' ' + (a.title || '')).split(/\s+/).length; return Math.max(2, Math.round(w / 6)) + ' דק׳ קריאה'; }

  function endCardHtml(dbg) {
    /* יריד בלי דירות (כפתור היריד של גבריאלה, וכרגע אין יריד חי): לא חפיסה ריקה אלא הסבר ושתי דרכים */
    if (filter.fair && !deck.some(function (x) { return x.slot === 'property'; })) {
      return '<article class="sw-card sw-end" data-slot="end" aria-label="כרגע אין יריד פעיל">' + (dbg || '') +
        '<div class="sw-end-in"><h2 class="sw-end-title">כרגע אין יריד פעיל</h2>' +
        '<p class="sw-end-line">כשיועצי הנדל״ן באזור יכניסו דירות ליריד הבתים הפתוחים, הן יופיעו כאן.</p>' +
        '<button type="button" class="sw-navy sw-wide" data-fair-off>לכל הנכסים למכירה</button>' +
        alertBlock('fair').replace('class="sw-white sw-wide" data-alert-open', 'class="sw-gold sw-wide" data-alert-open').replace(/<\/svg>עדכנו אותי על נכס חדש/, '</svg>עדכנו אותי') +
        '</div></article>';
    }
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
    var tc = top.querySelector('.sw-card.is-ba,.sw-card.is-invite');
    if (tc) { bindBa(tc.querySelector('.sw-ba')); vizSlideSeen(c, tc.classList.contains('is-ba') ? 'ba' : 'invite'); }
    syncActions();
    onCardView(c);
    vizPrime();
    if (tourPending && view === 'deck' && !openStack.length) maybeTour();
  }
  var impTimer = 0;
  function onCardView(c) {
    clearTimeout(impTimer);
    document.querySelectorAll('#swDeck video').forEach(function (v) { v.pause(); });
    // כרטיס שמאחורי חלון הסינון עוד לא נצפה - ‏swipe_start בונה את החפיסה מחדש
    if (!$('swFilter').hidden) return;
    if (c.slot === 'end') { shukTrack('swipe_end_view', { likes: likes.length }); return; }
    shukTrack('swipe_card_view', { slot: c.slot, position: c.pos });
    if (c.slot === 'property') maybeAlertSheet();
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
    if (dir === 'like' && c.p && likes.indexOf(c.p.id) < 0) { likes.push(c.p.id); saveLikes(); added = true; sessionLikes++; lastLiked = c; }
    // שני שמות מפורשים ולא ביטוי: כך check_gtm_container.py מוצא את שניהם
    if (dir === 'like') shukTrack('swipe_like', { slot: c.slot, position: c.pos });
    else shukTrack('swipe_skip', { slot: c.slot, position: c.pos });
    // ‏liked רק כשהלייק נוסף עכשיו - ביטול לא מוחק לייק ותיק
    history_.push({ i: idx, liked: added ? c.p.id : null });
    deciding = true;
    var go = function () { deciding = false; idx = Math.min(idx + 1, deck.length - 1); renderDeck(); tourAdvance(); if (added) maybeNudge(); };
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
    var ph = slides(c.p);
    if (ph.length < 2) return;
    c.photo = ((c.photo || 0) + step + ph.length) % ph.length;
    syncSlide(top, c);
  }
  /* השקופית הנוכחית: התמונה, השכבה (לפני/אחרי או הזמנה), הפסים, המונה, הגלולה והכפתור שבתחתית.
     נקרא גם כשהזוג או הזכאות מגיעים אחרי שהכרטיס כבר על המסך */
  function syncSlide(top, c) {
    var card = top && top.querySelector('.sw-card');
    if (!card || !c || !c.p) return;
    var ph = slides(c.p);
    if ((c.photo || 0) >= ph.length) c.photo = 0;
    var at = c.photo || 0, s = ph[at], sp = slideKind(s);
    var img = top.querySelector('.sw-cimg');
    if (img && img.tagName === 'IMG' && s) {
      var u = slideBase(c.p, s);
      if (img.getAttribute('data-orig') !== u) { img.setAttribute('data-orig', u); img.src = sized(u, 800); }
    }
    var was = card.classList.contains('is-ba') ? 'ba' : card.classList.contains('is-invite') ? 'invite' : '';
    card.classList.toggle('is-ba', sp === 'ba');
    card.classList.toggle('is-invite', sp === 'invite');
    var layer = top.querySelector('.sw-vlayer');
    if (layer && was !== sp) { layer.innerHTML = layerHtml(c.p, sp); bindBa(layer.querySelector('.sw-ba')); }
    var bars = top.querySelector('.sw-bars');
    if (bars) bars.innerHTML = barsHtml(ph, at);
    var cnt = top.querySelector('.sw-count');
    if (cnt) { cnt.textContent = (at + 1) + '/' + ph.length; cnt.hidden = ph.length < 2; }
    var pill = top.querySelector('.sw-vpill');
    if (pill) pill.hidden = !(vizPair.get(c.p.id) && !sp);
    var up = top.querySelector('.sw-up'), vc = top.querySelector('.sw-vcta');
    if (up) up.hidden = sp === 'ba';
    if (vc) vc.hidden = sp !== 'ba';
    if (sp && was !== sp) vizSlideSeen(c, sp);
  }

  /* מחוות: גרירה לצדדים (אהבתי/דילוג), למעלה (פרטים), והקשה על צידי התמונה (תמונה) */
  function bindGestures(top) {
    var card = top.querySelector('.sw-card');
    if (!card) return;
    // במחשב: בלי גרירה מקורית של תמונה (אחרת הכרטיס לא זז והחותמת נשארת ב-0)
    top.addEventListener('dragstart', function (e) { e.preventDefault(); });
    var sx = 0, sy = 0, dx = 0, dy = 0, drag = false, moved = false;
    var stampLike = card.querySelector('.sw-stamp.is-like'), stampSkip = card.querySelector('.sw-stamp.is-skip');
    // החותמת מתמלאת עם הגרירה (‏dx/100), ובמאה פיקסלים ההחלטה נופלת
    function stamps(v) {
      if (stampLike) stampLike.style.opacity = String(Math.max(0, Math.min(1, v / 100)));
      if (stampSkip) stampSkip.style.opacity = String(Math.max(0, Math.min(1, -v / 100)));
    }
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
      stamps(dx);
    });
    function end() {
      if (!drag) return;
      drag = false;
      card.style.transition = '';
      stamps(0);
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
      // ‏✨ איך זה יכול להיראות? - ישר לשקופית לפני/אחרי (האחרונה)
      if (e.target.closest('[data-vpill]')) {
        shukTrack('viz_pill_click', { property_id: c.p.id });
        c.photo = slides(c.p).length - 1; syncSlide(top, c); return;
      }
      var st_ = e.target.closest('[data-studio]');
      if (st_) { openSheetFor(c, { tab: 'viz', from: st_.dataset.studio }); return; }
      if (e.target.closest('[data-spon-cta]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); openSheetFor(c); return; }
      if (e.target.closest('[data-spon-link]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); return; }
      if (e.target.closest('[data-article]')) { shukTrack('article_card_open', { article_id: String(c.article.id) }); return; }
      if (e.target.closest('#swWiden')) { openFilter(e.target); return; }
      if (e.target.closest('[data-fair-off]')) { filter.fair = false; deck = []; buildDeck(); renderSummary(); return; }
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
  function formHtml(c, preset) {
    var p = c.p;
    var msg = p ? (preset ? 'היי, ' + preset + ': ' + title(p) : 'היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לפרטים') : '';
    return '<form class="sw-lead" id="leadForm" hidden novalidate>' +
      '<label class="sw-field"><span>שם</span><input id="swLName" autocomplete="name" required></label>' +
      '<label class="sw-field"><span>טלפון</span><input id="swLPhone" type="tel" inputmode="tel" autocomplete="tel" required></label>' +
      (p ? '<label class="sw-field"><span>הודעה</span><textarea id="swLMsg" rows="3">' + esc(msg) + '</textarea></label>' : '') +
      (p ? qHtml(questionsFor(c)) : sponQHtml()) +
      '<label class="sw-consent"><input type="checkbox" id="swLConsent"> <span>מאשרים פנייה חוזרת מהמפרסם בנוגע לפנייה הזו, בהתאם ל<a href="/terms" target="_blank">תנאי השימוש</a> ול<a href="/privacy" target="_blank">מדיניות הפרטיות</a>.</span></label>' +
      '<p class="sw-ferr" id="swLErr" role="alert"></p></form>' +
      '<p class="sw-done" id="swLDone" hidden>✅ הפנייה נשלחה. יחזרו אליכם בקרוב.</p>';
  }
  /* ‏opts.msg - הודעה מוכנה ("אשמח לתאם ביקור בנכס"), ‏opts.form - הטופס פתוח. אף פעם לא שליחה */
  function openSheetFor(c, opts) {
    opts = opts || {};
    if (!c || (c.slot !== 'property' && !(c.sponsor && (c.slot === 'spon_agency' || c.sponsor.mortgage)))) return;
    if (!$('swTour').hidden) endTour(false);
    sheetCard = c; sheetOpener = document.activeElement; formOpen = false; sent = false; answers = {};
    var adv = c.p ? advertiser(c.p) : { type: 'agency', name: c.sponsor.name, sub: c.sponsor.kind === 'pro' ? c.sponsor.field : 'משרד תיווך',
      img: c.sponsor.logo || '', slug: c.sponsor.slug || '', href: c.sponsor.slug ? (c.sponsor.kind === 'pro' ? '/professional?slug=' : '/agency?slug=') + encodeURIComponent(c.sponsor.slug) : '' };
    var label = c.p ? ctaLabel(adv) : (c.sponsor.kind === 'agency' ? 'יצירת קשר עם המשרד' : 'יצירת קשר עם המפרסם');
    sheetCard.label = label;
    measureActions();
    var studio = studioOk(c);
    $('swSheetBody').innerHTML = (studio ? '<div class="sw-tabs" role="tablist" aria-label="פרטי הנכס והדמיה">' +
        '<button type="button" role="tab" id="swTabBtnInfo" data-tab="info" aria-controls="swTabInfo" aria-selected="true">פרטים</button>' +
        '<button type="button" role="tab" id="swTabBtnViz" data-tab="viz" aria-controls="swTabViz" aria-selected="false" tabindex="-1">✨ הדמיה</button></div>' : '') +
      '<div id="swTabInfo"' + (studio ? ' role="tabpanel" aria-labelledby="swTabBtnInfo"' : '') + '>' + bannerHtml(adv, label) + formHtml(c, opts.msg) + (c.p ? propInfoHtml(c.p) : '') + '</div>' +
      (studio ? '<div id="swTabViz" class="sw-studio" role="tabpanel" aria-labelledby="swTabBtnViz" hidden></div>' : '');
    $('swCtaBar').hidden = false;
    st = null;
    syncCta();
    if (opts.form) toggleForm(true);
    openDialog($('swSheet'));
    if (studio && opts.tab === 'viz') setTab('viz', opts.from);
    try { history.pushState({ swSheet: 1 }, ''); sheetPushed = true; } catch (e) { sheetPushed = false; }
    shukTrack('swipe_up_open', { slot: c.slot, position: c.pos });
    if (c.p && c.p.lat && c.p.lng) setTimeout(function () { miniMap(c.p); }, 60);
  }
  /* ---------- 4א. הסטודיו: לשונית "✨ הדמיה" בגיליון (חלק 2 §4) ----------
     נפתחת מהגלולה, מהכפתור שמתחת לשקופית ומההזמנה; כל דרך אחרת פותחת "פרטים".
     התוצאות נשמרות על הנכס ומוצגות לכל מבקר/ת (כמו בדף הנכס) - ההערה אומרת זאת. */
  var VIZ_STYLES = [['modern_clean', 'מודרני נקי'], ['mediterranean_white', 'ים-תיכוני לבן'], ['warm_scandi', 'סקנדינבי חמים'], ['modern_luxury', 'יוקרה מודרנית']];
  var VIZ_ICON = { living_room: '🛋️', kitchen: '🍳', bedroom: '🛏️', exterior: '🏡', interior_main: '🏪' };
  var VIZ_DAILY = 10, VIZ_URL = SUPABASE_URL + '/functions/v1/property-visualize';
  var VIZ_FAIL = 'לא הצלחנו ליצור את ההדמיה כרגע. נסו שוב מאוחר יותר.';
  var VIZ_LIMIT = 'הגעתם למכסה היומית של ההדמיות. נשמח לראותכם מחר ✨';
  var st = null, vizToken = 0;
  function studioOk(c) {
    var p = c && c.p;
    return !!(p && photos(p).length && !isLand(p) && (vizMap.has(p.id) || vizElig.get(p.id) === true));
  }
  function vizTargets(p) {
    return isComm(p) ? ['interior_main', 'exterior'] : p.deal_type === 'rent' ? ['living_room', 'bedroom', 'exterior'] : ['living_room', 'kitchen', 'exterior'];
  }
  function vizRoom(p, t) {
    if (t === 'exterior') return isComm(p) ? 'חזית העסק' : p.deal_type === 'rent' ? 'החצר' : 'החזית';
    return { living_room: 'הסלון', kitchen: 'המטבח', bedroom: 'חדר השינה', interior_main: 'חלל העסק' }[t] || t;
  }
  /* זהה ל-bizKey ב-assets/property.js ול-businessKey ב-property-visualize */
  function bizKey(x) {
    var k = String(x == null ? '' : x).normalize('NFKC').toLowerCase().replace(/["'`\u05F3\u05F4.,!?()\-\u2013\u2014]/g, ' ').replace(/\s+/g, ' ').trim();
    return k ? 'biz:' + k : '_';
  }
  function vizKeyOf(p, v) { return isComm(p) ? bizKey(v.biz) : (v.style || '_'); }
  function vizFind(p, target, key) {
    var hit = null;
    (vizMap.get(p.id) || []).forEach(function (v) {
      if (v.target === target && vizKeyOf(p, v) === key && (!hit || v.at > hit.at)) hit = v;
    });
    return hit;
  }
  function vizDay() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function vizUsed() { return Number(store('sk_viz_gen_' + vizDay())) || 0; }
  function vizLeft() { return Math.max(0, VIZ_DAILY - vizUsed()); }
  function deviceId() {
    var id = store('sk_device_id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      store('sk_device_id', id);
    }
    return id;
  }
  function setTab(t, from) {
    var info = $('swTabInfo'), viz = $('swTabViz');
    if (!viz) return;
    info.hidden = t !== 'info'; viz.hidden = t !== 'viz';
    ['Info', 'Viz'].forEach(function (k) {
      var b = $('swTabBtn' + k), on = k.toLowerCase() === t;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    $('swCtaBar').hidden = t === 'viz';
    if (t === 'viz') {
      if (!st) studioInit(sheetCard.p);
      renderStudio();
      shukTrack('viz_studio_open', { property_id: sheetCard.p.id, from: from || 'tab' });
    }
    $('swSheetBody').scrollTop = 0;
  }
  function studioInit(p) {
    var first = vizPair.get(p.id) || (vizMap.get(p.id) || [])[0] || null;
    st = { p: p, comm: isComm(p), target: first ? first.target : vizTargets(p)[0], key: '', bizLabel: '', other: false,
      busy: false, t0: 0, pending: null, total: 0, msg: '', limit: false, saved: false };
    if (vizTargets(p).indexOf(st.target) < 0) st.target = vizTargets(p)[0];
    if (first) { st.key = vizKeyOf(p, first); st.bizLabel = first.biz || ''; }
    else if (!st.comm) st.key = VIZ_STYLES[0][0];
    if (st.comm && !st.key) st.other = true;
  }
  function bizChips(p) {
    var seen = {}, out = [];
    (vizMap.get(p.id) || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; }).forEach(function (v) {
      var k = bizKey(v.biz);
      if (k === '_' || seen[k] || out.length >= 6) return;
      seen[k] = 1; out.push([k, v.biz.trim()]);
    });
    return out;
  }
  function studioStage() {
    var p = st.p, r = vizFind(p, st.target, st.key), src = (r && r.before) || photos(p)[0];
    if (st.busy) {
      var sec = (Date.now() - st.t0) / 1000;
      var step = sec < 12 ? 'מזהים את החדר בתמונה…' : sec < 45 ? 'מעצבים: ' + studioStyleLabel() + '…' : 'מלטשים פרטים אחרונים…';
      var pct = st.total ? Math.min(92, Math.round(((st.total - (st.pending || []).length) / st.total) * 80 + Math.min(12, sec / 10))) : Math.min(92, Math.round(sec / 1.8));
      return '<div class="sw-st-busy"><img data-fb="sw-st-src" class="sw-st-src" ' + imgSrc(src, 800) + ' alt="" aria-hidden="true"><span class="sw-st-shim" aria-hidden="true"></span>' +
        '<div class="sw-st-prog" role="status" aria-live="polite"><p>' + esc(step) + '</p>' +
        (st.total > 1 ? '<p class="sw-st-k">מוכנות ' + (st.total - (st.pending || []).length) + ' מתוך ' + st.total + '</p>' : '') +
        '<span class="sw-st-bar"><i style="width:' + pct + '%"></i></span><b>' + pct + '%</b></div></div>';
    }
    if (r && r.before) return baHtml({ before: r.before, after: r.after }, true);
    if (r) return '<img data-fb="sw-st-src" class="sw-st-src is-only" ' + imgSrc(r.after, 800) + ' alt="' + esc('הדמיית AI - ' + vizRoom(p, st.target)) + '">';
    var over = '';
    if (st.msg) over = '<div class="sw-st-err" role="alert"><p>' + esc(st.msg) + '</p>' + (st.limit ? '' : '<button type="button" class="sw-white" data-gen-retry>נסו שוב</button>') + '</div>';
    else if (!VIZ_SWIPE_GENERATE) over = '<a class="sw-st-link" href="/property?id=' + encodeURIComponent(p.id) + '#viz">ליצירת הדמיה בסגנון הזה - בדף הנכס ←</a>';
    else if (!st.comm) over = '<button type="button" class="sw-gold sw-st-gen" data-gen' + (vizLeft() ? '' : ' disabled') + '>' + (vizLeft() ? '✨ צור הדמיה' : 'הגעתם למכסה היומית') + '</button>';
    return '<div class="sw-st-empty"><img data-fb="sw-st-src" class="sw-st-src" ' + imgSrc(src, 800) + ' alt="' + esc(title(p)) + '">' + (over ? '<div class="sw-st-over">' + over + '</div>' : '') + '</div>';
  }
  function studioStyleLabel() {
    if (st.comm) return st.bizLabel || 'העסק';
    var s_ = VIZ_STYLES.filter(function (x) { return x[0] === st.key; })[0];
    return s_ ? s_[1] : '';
  }
  function renderStudio() {
    var box = $('swTabViz');
    if (!box || !st) return;
    var p = st.p, r = vizFind(p, st.target, st.key);
    var kind = st.comm ? 'הדמיית עסק' : p.deal_type === 'rent' ? 'הדמיית הום סטיילינג' : 'הדמיית שיפוץ';
    var head = [kind, vizRoom(p, st.target), studioStyleLabel()].filter(Boolean).join(' · ');
    var rooms_ = vizTargets(p).map(function (t) {
      var has = (vizMap.get(p.id) || []).some(function (v) { return v.target === t; });
      return '<button type="button" class="sw-st-chip" data-room="' + t + '" aria-pressed="' + (t === st.target) + '"' + (st.busy ? ' disabled' : '') + '>' +
        '<span aria-hidden="true">' + (VIZ_ICON[t] || '') + '</span> ' + esc(vizRoom(p, t)) + (has ? '<i class="sw-st-dot" aria-label="יש הדמיה"></i>' : '') + '</button>';
    }).join('');
    var styles_;
    if (!st.comm) {
      styles_ = '<div class="sw-st-styles">' + VIZ_STYLES.map(function (x) {
        var v = vizFind(p, st.target, x[0]);
        return '<button type="button" class="sw-st-style" data-style="' + x[0] + '" aria-pressed="' + (x[0] === st.key) + '"' + (st.busy ? ' disabled' : '') + '>' +
          (v ? '<img ' + imgSrc(v.after, 240) + ' alt="" loading="lazy" data-fb="sw-st-th">' : '<span class="sw-st-th" aria-hidden="true">✨</span>') +
          '<span>' + esc(x[1]) + (v ? ' <b aria-label="יש הדמיה">✦</b>' : '') + '</span></button>';
      }).join('') + '</div>';
    } else {
      var chips = bizChips(p);
      styles_ = '<div class="sw-st-row">' + chips.map(function (b) {
        return '<button type="button" class="sw-st-chip" data-biz="' + esc(b[0]) + '" data-biz-label="' + esc(b[1]) + '" aria-pressed="' + (!st.other && b[0] === st.key) + '"' + (st.busy ? ' disabled' : '') + '>' + esc(b[1].length > 40 ? b[1].slice(0, 39) + '…' : b[1]) + ' <b aria-hidden="true">✦</b></button>';
      }).join('') + '<button type="button" class="sw-st-chip" data-biz-other aria-pressed="' + st.other + '"' + (st.busy ? ' disabled' : '') + '>עסק אחר…</button></div>' +
        (st.other ? '<label class="sw-field"><span>איזה עסק?</span><input id="swStBiz" maxlength="80" placeholder="למשל: בית קפה, קליניקה, חנות בגדים" value="' + esc(st.bizLabel) + '"></label>' : '');
    }
    var contact = st.comm && VIZ_SWIPE_GENERATE && !r ? '<form class="sw-st-form" id="swStForm" novalidate>' +
      '<label class="sw-field"><span>שם</span><input id="swStName" autocomplete="name" required></label>' +
      '<label class="sw-field"><span>טלפון</span><input id="swStPhone" type="tel" inputmode="tel" autocomplete="tel" required></label>' +
      '<label class="sw-consent"><input type="checkbox" id="swStConsent"> <span>מאשרים פנייה חוזרת מהמשרד המפרסם בנוגע להדמיה, בהתאם ל<a href="/terms" target="_blank">תנאי השימוש</a> ול<a href="/privacy" target="_blank">מדיניות הפרטיות</a>.</span></label>' +
      '<p class="sw-ferr" id="swStErr" role="alert"></p>' +
      '<button type="submit" class="sw-gold sw-wide"' + (st.busy || !vizLeft() ? ' disabled' : '') + '>צור הדמיה ושליחת פרטים</button></form>' : '';
    var quota = VIZ_SWIPE_GENERATE && !r ? (vizLeft() ? '<p class="sw-st-q">נותרו ' + vizLeft() + ' מתוך ' + VIZ_DAILY + ' הדמיות היום</p>'
      : '<p class="sw-st-q is-soft">' + esc(VIZ_LIMIT) + '</p>') : '';
    box.innerHTML = '<p class="sw-st-head"><b>' + esc(head) + '</b>' + (r ? ' <span class="sw-st-real">הדמיה אמיתית</span>' : '') + '</p>' +
      '<div class="sw-st-stage">' + studioStage() + '</div>' + (st.busy ? '' : quota) +
      (r && !st.busy ? '<button type="button" class="sw-navy sw-wide sw-st-save" data-viz-save' + (st.saved ? ' disabled' : '') + '>' + (st.saved ? '✓ נשמר ברשימה שלי' : '♡ שמירה לרשימה שלי') + '</button>' : '') +
      '<h3 class="sw-sub-h"><span class="sw-st-n">1</span> ' + (st.comm ? 'איזה חלל?' : 'איזה חדר?') + '</h3><div class="sw-st-row">' + rooms_ + '</div>' +
      '<h3 class="sw-sub-h"><span class="sw-st-n">2</span> ' + (st.comm ? 'איזה עסק תפתחו כאן?' : 'איזה סגנון?') + '</h3>' + styles_ + contact +
      '<p class="sw-st-note">' + (st.comm ? 'בנכס מסחרי נבקש שם וטלפון, והמשרד המפרסם יחזור אליכם.' : 'ההדמיה נשמרת בדף הנכס ותוצג גם למבקרים אחרים. זו המחשה ממוחשבת ולא התחייבות לשיפוץ.') + '</p>';
    bindBa(box.querySelector('.sw-ba'));
  }
  function vizGenerate(contact) {
    if (!VIZ_SWIPE_GENERATE || !st || st.busy) return;
    if (!vizLeft()) { st.msg = VIZ_LIMIT; st.limit = true; renderStudio(); return; }
    var p = st.p, body = { property_id: p.id };
    if (st.comm) { body.business_type = st.bizLabel; body.name = contact.name; body.phone = contact.phone; body.source = 'swipe'; }
    else body.style = st.key;
    var token = ++vizToken, key = st.key, target = st.target, space = target;
    var styleP = st.comm ? ('biz:' + bizKey(st.bizLabel).slice(4)).slice(0, 40) : key;
    st.busy = true; st.msg = ''; st.limit = false; st.t0 = Date.now(); st.pending = null; st.total = 0;
    renderStudio();
    var stage = $('swTabViz').querySelector('.sw-st-stage');
    if (stage) stage.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    var tick = setInterval(function () { if (token !== vizToken || !st || !st.busy) clearInterval(tick); else renderStudioStage(); }, 1500);
    function done(result, msg) {
      clearInterval(tick);
      shukTrack('viz_generate', { property_id: p.id, space: space, style: styleP, result: result, source: 'swipe' });
      if (token !== vizToken || !st) return;
      st.busy = false;
      if (msg) { st.msg = msg; st.limit = result === 'visitor_rate_limited' || result === 'rate_limited'; }
      renderStudio();
    }
    function merge(rows) {
      var list = vizMap.get(p.id) || [];
      (rows || []).forEach(function (r) {
        if (!r || !r.result_url) return;
        list.push({ target: r.target || '', style: st.comm ? '' : key, biz: st.comm ? st.bizLabel : '', after: r.result_url, before: r.source_image_url || '', base: false, at: new Date().toISOString() });
      });
      vizMap.set(p.id, list);
    }
    fetch(VIZ_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'x-sk-device': deviceId() }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(null, function () { return {}; }).then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (x) {
        var d = x.d;
        if (!x.ok || d.error) {
          var code = d.error || 'error';
          var res = { visitor_rate_limited: 'visitor_rate_limited', rate_limited: 'rate_limited', busy: 'busy', not_available: 'not_available', land_not_supported: 'land' }[code] || 'error';
          done(res, d.message || (res === 'visitor_rate_limited' ? VIZ_LIMIT : VIZ_FAIL));
          return;
        }
        merge(d.ready);
        if (!d.job_id) { done('cached'); return; }
        store('sk_viz_gen_' + vizDay(), String(vizUsed() + 1));   // רק בקשה שיצרה עבודה נספרת
        st.pending = (d.pending_targets || []).slice(); st.total = st.pending.length;
        var deadline = Date.now() + 180000;
        (function poll() {
          setTimeout(function () {
            if (token !== vizToken) { clearInterval(tick); return; }   // הגיליון נסגר: העבודה ממשיכה בשרת
            sb.rpc('visualization_job_status', { p_job_id: d.job_id }).then(function (rs) {
              var rows = (rs && rs.data) || [];
              merge(rows.filter(function (r) { return r.item_status === 'done' && !vizFind(p, r.target, key); }));
              st.pending = st.pending.filter(function (t) { return !rows.some(function (r) { return r.target === t && r.item_status !== 'pending' && r.item_status !== 'processing'; }); });
              var js = rows[0] && rows[0].job_status;
              if (js === 'done') { if (vizFind(p, target, key)) done('done'); else done('error', VIZ_FAIL); }
              else if (js === 'failed') done('error', VIZ_FAIL);
              else if (Date.now() > deadline) done('timeout', VIZ_FAIL);
              else poll();
            }, function () { if (Date.now() > deadline) done('timeout', VIZ_FAIL); else poll(); });
          }, 4000);
        })();
      }, function () { done('error', VIZ_FAIL); });
  }
  function renderStudioStage() {
    var el = $('swTabViz') && $('swTabViz').querySelector('.sw-st-stage');
    if (el && st) el.innerHTML = studioStage();
  }
  function studioSave() {
    var p = st.p, r = vizFind(p, st.target, st.key);
    if (!r) return;
    if (likes.indexOf(p.id) < 0) { likes.push(p.id); saveLikes(); syncActions(); }
    var map = {};
    try { map = JSON.parse(store('sk_swipe_likes_viz') || '{}') || {}; } catch (e) { map = {}; }
    map[p.id] = { style: st.comm ? bizKey(st.bizLabel) : st.key, result_url: r.after };
    store('sk_swipe_likes_viz', JSON.stringify(map));
    st.saved = true;
    shukTrack('viz_save', { property_id: p.id, style: st.comm ? ('biz:' + bizKey(st.bizLabel).slice(4)).slice(0, 40) : st.key });
    renderStudio();
    toast('נשמר ברשימה שלי, יחד עם ההדמיה');
  }
  function likedViz(id) {
    try { var m = JSON.parse(store('sk_swipe_likes_viz') || '{}') || {}; return m[id] && m[id].result_url; } catch (e) { return ''; }
  }
  var toastT = 0;
  function toast(msg) {
    var t = $('swToast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200);
  }
  $('swSheetBody').addEventListener('click', function (e) {
    var tb = e.target.closest('[data-tab]');
    if (tb) { setTab(tb.dataset.tab, 'tab'); return; }
    if (!st || !e.target.closest('#swTabViz')) return;
    var b;
    if ((b = e.target.closest('[data-room]'))) { st.target = b.dataset.room; st.msg = ''; st.saved = false; renderStudio(); return; }
    if ((b = e.target.closest('[data-style]'))) { st.key = b.dataset.style; st.msg = ''; st.saved = false; renderStudio(); return; }
    if ((b = e.target.closest('[data-biz]'))) { st.key = b.dataset.biz; st.bizLabel = b.dataset.bizLabel; st.other = false; st.msg = ''; st.saved = false; renderStudio(); return; }
    if (e.target.closest('[data-biz-other]')) { st.other = true; st.key = bizKey(st.bizLabel); renderStudio(); var bi = $('swStBiz'); if (bi) bi.focus(); return; }
    if (e.target.closest('[data-gen]') || e.target.closest('[data-gen-retry]')) {
      st.msg = '';
      if (st.comm) { renderStudio(); var n_ = $('swStName'); if (n_) n_.focus(); return; }
      vizGenerate(); return;
    }
    if (e.target.closest('[data-viz-save]')) studioSave();
  });
  $('swSheetBody').addEventListener('keydown', function (e) {
    if (e.target.getAttribute('role') !== 'tab' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    var next = e.target.dataset.tab === 'info' ? 'viz' : 'info';
    setTab(next, 'tab'); $(next === 'viz' ? 'swTabBtnViz' : 'swTabBtnInfo').focus();
  });
  $('swSheetBody').addEventListener('input', function (e) {
    if (e.target.id === 'swStBiz' && st) { st.bizLabel = e.target.value; st.key = bizKey(e.target.value); }
  });
  $('swSheetBody').addEventListener('submit', function (e) {
    if (e.target.id !== 'swStForm') return;
    e.preventDefault();
    var name = $('swStName').value.trim(), phone = $('swStPhone').value.trim(), err = $('swStErr');
    var miss = !st.bizLabel.trim() ? 'יש לציין איזה עסק תפתחו בנכס' : name.length < 2 ? 'נא להזין שם' : phone.replace(/\D/g, '').length < 9 ? 'נא להזין מספר טלפון תקין'
      : !$('swStConsent').checked ? 'צריך לסמן את האישור כדי לשלוח' : '';
    if (miss) { err.textContent = miss; return; }
    vizGenerate({ name: name, phone: phone });
  });

  var ownBack = false;   // ‏history.back() שלנו - ה-popstate שלו לא סוגר גיליון שנפתח בינתיים
  function closeSheet(fromPop) {
    if ($('swSheet').hidden) return;
    vizToken++;   // הפסקת ה-polling; העבודה עצמה ממשיכה בשרת
    st = null;
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
      store('sk_swipe_alert_sent', '1');
      form.hidden = true;
      form.parentNode.querySelector('.sw-done').hidden = false;
    }, function (e) { err.textContent = errText(e, 'השליחה לא הצליחה. בדקו את החיבור ונסו שוב.'); btn.disabled = false; });
  }
  function shareLikes() {
    var urls = likes.map(function (id) { return location.origin + '/property?id=' + encodeURIComponent(id); });
    var text = 'הנכסים ששמרתי בשוק הנדל״ן:\n' + urls.join('\n');
    shukTrack('swipe_share', { method: navigator.share ? 'native' : 'whatsapp', count: likes.length });
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    var a = document.createElement('a');
    a.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('data-share', '');
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('swLikes').addEventListener('click', function () {
    setView('likes');
  });

  /* ---------- הגיליון התחתון (סבב 4, PART 1 §9 + PART 2 §6) ----------
     רכיב אחד לכל ההכוונה בהחלקה, כמו באפליקציות היכרויות: עולה מלמטה, לא
     מסתיר את התמונה ואת המחיר, **אחד בכל פעם** (תור), ונסגר ב-×, בלחיצה על
     הרקע, ב-Escape או בהחלקה למטה. לא נפתח כשההדרכה, גיליון הפרטים או הסינון
     פתוחים - נכנס לתור ועולה 600ms אחרי שהם נסגרים. אף כפתור לא שולח דבר
     בעצמו. אירועים: swipe_nudge_view / swipe_nudge_click / swipe_nudge_dismiss. */
  var sessionLikes = 0, lastLiked = null;
  function sessGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessSet(k) { try { sessionStorage.setItem(k, '1'); } catch (e) {} }
  var GAB_ART = '<img class="sw-bs-av" src="/assets/gabriela-avatar.webp" alt="" width="64" height="64" onerror="this.style.visibility=\'hidden\'">';
  var BELL_ART = '<svg class="sw-bs-svg" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#0e2a6b"/><path d="M22 38c2-2 3-5 3-10a7 7 0 0 1 14 0c0 5 1 8 3 10z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M29 42a3 3 0 0 0 6 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="41" cy="22" r="4" fill="#c9a227"/></svg>';
  var HAND_ART = '<svg class="sw-bs-svg" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="#0e2a6b"/><g transform="translate(16 14) scale(1.35)" fill="none" stroke="#e5c76a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11v-1a2 2 0 0 0-4 0"/><path d="M14 10V9a2 2 0 0 0-4 0v1"/><path d="M10 9.5V4a2 2 0 0 0-4 0v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g></svg>';
  /* ‏viz: איור טהור (בלי <img>) - אף פעם לא אייקון של תמונה שבורה */
  var VIZ_ART = '<svg class="sw-bs-viz" viewBox="0 0 168 96" aria-hidden="true"><rect width="168" height="96" rx="14" fill="#e9edf5"/>' +
    '<rect x="0" y="0" width="84" height="96" rx="14" fill="#f3e7d3"/><rect x="70" y="0" width="14" height="96" fill="#f3e7d3"/>' +
    '<rect x="14" y="54" width="46" height="18" rx="5" fill="#c08a5b"/><rect x="18" y="44" width="16" height="12" rx="4" fill="#e5c76a"/><rect x="40" y="44" width="16" height="12" rx="4" fill="#e5c76a"/>' +
    '<rect x="20" y="16" width="22" height="18" rx="2" fill="#fff" stroke="#c08a5b" stroke-width="2"/><circle cx="62" cy="24" r="6" fill="#7aa36b"/>' +
    '<rect x="100" y="20" width="26" height="22" rx="2" fill="#fff" stroke="#b9c1d1" stroke-width="2"/><line x1="84" y1="78" x2="168" y2="78" stroke="#c9cfdb" stroke-width="2"/>' +
    '<rect x="83" y="0" width="3" height="96" fill="#fff"/><circle cx="84.5" cy="48" r="13" fill="#fff" stroke="#0e2a6b" stroke-width="1.5"/>' +
    '<text x="84.5" y="53" text-anchor="middle" font-size="13" font-weight="800" fill="#0e2a6b" font-family="Heebo,sans-serif">‹ ›</text></svg>';
  function helpBody() {
    var c = cur(), multi = !!(c && c.p && slides(c.p).length > 1);
    var rows = [['→', 'ימינה', 'אהבתי ושמירה לרשימה'], ['←', 'שמאלה', 'דילוג לנכס הבא'], ['↑', 'למעלה', 'פרטים, ✨ הדמיה ויצירת קשר']];
    if (multi) rows.push(['👆', 'הקשה בצדי התמונה', 'מעבר בין התמונות']);
    return '<ul class="sw-bs-help">' + rows.map(function (r) {
      return '<li><span class="sw-bs-ic" aria-hidden="true">' + r[0] + '</span><span><b>' + esc(r[1]) + '</b> · ' + esc(r[2]) + '</span></li>';
    }).join('') + '</ul>' + (isDesktop() ? '<p class="sw-bs-keys">במקלדת: → אהבתי · ← דילוג · ↑ פרטים · רווח תמונה</p>' : '');
  }
  var BS = {
    like1: { art: GAB_ART + '<span class="sw-bs-heart" aria-hidden="true">♥</span>', title: '♥ נשמר לרשימה שלכם', sub: 'כל הנכסים שתאהבו מחכים ברשימה, לצפייה ולשיתוף',
      btns: [['list', 'sw-navy', 'לרשימה שלי'], ['share', 'sw-white', 'שיתוף']] },
    like3: { art: GAB_ART, title: 'שמרתם 3 נכסים 👏', sub: 'רוצים לתאם ביקור או לשתף את הרשימה?',
      btns: [['visit', 'sw-navy', 'תיאום ביקור'], ['share', 'sw-white', 'שיתוף הרשימה']] },
    like6: { art: GAB_ART, title: 'כבר 6 נכסים ברשימה 🎯', sub: 'אפשר לשלוח אותם לגבריאלה לתיאום',
      btns: [['gab_list', 'sw-navy', 'שליחת הרשימה לגבריאלה'], ['later', 'sw-link', 'אחר כך']] },
    alert: { art: BELL_ART, title: 'רוצים שנעדכן כשנכס כזה ייכנס?', sub: 'נשמור את החיפוש ונשלח רק נכסים חדשים שמתאימים לו.',
      body: function () { return alertBlock('bs'); }, btns: [['later', 'sw-link', 'לא עכשיו']] },
    tour_end: { art: HAND_ART, title: 'מוכנים? בואו נתחיל', sub: 'ימינה שומרים, שמאלה מדלגים, ולמעלה כל הפרטים. ✨ בנכסים עם הדמיה, התמונה האחרונה מראה איך הנכס יכול להיראות.',
      btns: [['start', 'sw-navy', 'התחלת החלקה'], ['gabriela', 'sw-link', 'שאלו את גבריאלה']] },
    help: { art: '', title: 'איך מחליקים', sub: '', body: helpBody,
      btns: [['tour', 'sw-navy', 'הצגת ההדרכה מחדש'], ['gabriela', 'sw-link', 'שאלו את גבריאלה']] },
    viz: { art: VIZ_ART, title: 'ככה זה יכול להיראות', sub: 'גררו את הידית שבאמצע כדי להשוות בין הצילום האמיתי להדמיית AI של הנכס.',
      btns: [['viz_ok', 'sw-navy', 'הבנתי, בואו נשווה'], ['studio', 'sw-white', '✨ צרו הדמיה בסגנון אחר']] }
  };
  var bsQueue = [], bsKind = '', bsOpener = null, bsT = 0, bsCtx = null;
  function bsBlocked() { return !$('swTour').hidden || !$('swSheet').hidden || !$('swFilter').hidden; }
  function bsOpen(kind, ctx) {
    if (bsKind === kind || bsQueue.some(function (q) { return q.kind === kind; })) return;
    if (bsKind || bsBlocked()) { bsQueue.push({ kind: kind, ctx: ctx }); return; }
    var d = BS[kind], wrap = $('swBsWrap');
    if (!d) return;
    bsKind = kind; bsCtx = ctx || null;
    bsOpener = document.activeElement;
    $('swBs').className = 'sw-bs is-' + kind;
    $('swBsArt').innerHTML = d.art || '';
    $('swBsArt').hidden = !d.art;
    $('swBsTitle').textContent = d.title;
    $('swBsSub').textContent = d.sub || '';
    $('swBsSub').hidden = !d.sub;
    $('swBsBody').innerHTML = d.body ? d.body() : '';
    $('swBsBtns').innerHTML = d.btns.map(function (b) {
      return '<button type="button" class="' + b[1] + ' sw-bs-btn" data-bs-cta="' + b[0] + '">' + esc(b[2]) + '</button>';
    }).join('');
    wrap.hidden = false;
    document.body.classList.add('sw-locked');
    openStack.push(wrap);
    $('swBs').style.transform = '';
    var first = $('swBsBtns').querySelector('button');
    setTimeout(function () { if (first) first.focus({ preventScroll: true }); }, 40);
    shukTrack('swipe_nudge_view', { kind: kind });
    if (kind === 'help') shukTrack('swipe_help_open', {});
    clearTimeout(bsT);
  }
  function bsClose(how) {
    var wrap = $('swBsWrap');
    if (wrap.hidden) return;
    var kind = bsKind;
    clearTimeout(bsT);
    wrap.hidden = true;
    bsKind = ''; bsCtx = null;
    openStack = openStack.filter(function (x) { return x !== wrap; });
    if (!openStack.length) document.body.classList.remove('sw-locked');
    if (how) shukTrack('swipe_nudge_dismiss', { kind: kind, how: how });
    if (kind === 'viz') setTimeout(baIntro, 0);   // "הבנתי, בואו נשווה" (או סגירה) - ואז הידית זזה
    var back = bsOpener && document.contains(bsOpener) && bsOpener.offsetParent !== null ? bsOpener : (document.querySelector('#swTopCard .sw-card'));
    if (back && back.focus) back.focus({ preventScroll: true });
    setTimeout(bsDrain, 600);
  }
  function bsDrain() {
    if (bsKind || !bsQueue.length || bsBlocked()) return;
    var n_ = bsQueue.shift();
    bsOpen(n_.kind, n_.ctx);
  }
  $('swBsWrap').addEventListener('click', function (e) {
    var x = e.target.closest('[data-bs-close]');
    if (x) { bsClose(x.dataset.bsClose); return; }
    var b = e.target.closest('[data-bs-cta]');
    if (b) {
      var kind = bsKind, cta = b.dataset.bsCta, ctx = bsCtx;
      shukTrack('swipe_nudge_click', { kind: kind, cta: cta });
      if (kind === 'help' && (cta === 'tour' || cta === 'gabriela')) shukTrack('swipe_help_click', { cta: cta });
      bsClose();
      if (cta === 'list') setView('likes');
      else if (cta === 'share') shareLikes();
      else if (cta === 'visit' && lastLiked) openSheetFor(lastLiked, { msg: 'אשמח לתאם ביקור בנכס', form: true });
      else if (cta === 'gab_list') { var g = gabListHref(); if (g) { var a = document.createElement('a'); a.href = g; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('data-bot', ''); a.setAttribute('data-bot-entry', 'swipe_likes'); document.body.appendChild(a); a.click(); a.remove(); } }
      else if (cta === 'tour') maybeTour(true);
      else if (cta === 'start') { var tc = document.querySelector('#swTopCard .sw-card'); if (tc) tc.focus({ preventScroll: true }); }
      else if (cta === 'gabriela') { if (window.GabWidget) window.GabWidget.open('swipe_' + kind); }
      else if (cta === 'viz_ok' && ctx && ctx.onOk) ctx.onOk();
      else if (cta === 'studio' && ctx && ctx.onStudio) ctx.onStudio();
      return;
    }
    // טופס ההתראה בתוך הגיליון ("עדכנו אותי על נכס חדש" פותח את הטופס; שליחה רק בכפתור)
    var open_ = e.target.closest('[data-alert-open]');
    if (open_) {
      var f = $('swBs').querySelector('.sw-aform');
      f.hidden = !f.hidden; open_.setAttribute('aria-expanded', String(!f.hidden));
      $('swBs').classList.toggle('is-tall', !f.hidden);
      if (!f.hidden) f.querySelector('input').focus({ preventScroll: true });
    }
  });
  $('swBs').addEventListener('submit', function (e) {
    var f = e.target.closest('.sw-aform');
    if (!f) return;
    e.preventDefault();
    submitAlert(f);
  });
  /* החלקה למטה על הגיליון: יותר מ-70px (או מהיר) סוגר, פחות - חוזר למקום */
  (function () {
    var bs = $('swBs'), y0 = 0, dy = 0, t0 = 0, on = false;
    bs.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,a,input,textarea,select,label')) return;
      on = true; y0 = e.clientY; dy = 0; t0 = Date.now(); bs.style.transition = 'none';
    });
    window.addEventListener('pointermove', function (e) {
      if (!on) return;
      dy = Math.max(0, e.clientY - y0);
      bs.style.transform = 'translateY(' + dy + 'px)';
    });
    window.addEventListener('pointerup', function () {
      if (!on) return;
      on = false; bs.style.transition = '';
      var v = dy / Math.max(1, Date.now() - t0);
      if (dy > 70 || v > 0.5) bsClose('swipe'); else bs.style.transform = '';
    });
  })();

  function maybeNudge() {
    if (sessionLikes >= 6 && !sessGet('sk_swipe_nudge6')) { sessSet('sk_swipe_nudge6'); bsOpen('like6'); return; }
    if (sessionLikes >= 3 && !sessGet('sk_swipe_nudge3')) { sessSet('sk_swipe_nudge3'); bsOpen('like3'); return; }
    if (!store('sk_swipe_nudge1')) { store('sk_swipe_nudge1', '1'); bsOpen('like1'); }
  }
  /* ‏alert: אחרי הכרטיס ה-12 שנצפה בביקור, פעם בביקור, ולא למי שכבר נרשם/ה */
  var seenThisSession = 0;
  function maybeAlertSheet() {
    seenThisSession++;
    if (seenThisSession < 12 || sessGet('sk_swipe_alert_bs') || store('sk_swipe_alert_sent')) return;
    sessSet('sk_swipe_alert_bs');
    bsOpen('alert');
  }

  /* ---------- "אהבתי (N)" ----------
     כל הלייקים, מכל סינון: מה שלא נמצא בנכסים שנטענו נשלף לפי מזהה. ♥ מסיר מהרשימה,
     שורה פותחת את הגיליון, ובתחתית שיתוף ושליחה לגבריאלה (לתיאום ביקורים). */
  var likedExtra = {};
  function likedProps() {
    var byId = {};
    all.forEach(function (p) { byId[p.id] = p; });
    return likes.slice().reverse().map(function (id) { return byId[id] || likedExtra[id]; }).filter(Boolean);
  }
  function fetchMissingLikes() {
    var have = {};
    all.forEach(function (p) { have[p.id] = 1; });
    var missing = likes.filter(function (id) { return !have[id] && !likedExtra[id]; });
    if (!missing.length || !sb) return;
    // רק נכסים פעילים (כמו בחפיסה). מזהה שלא חזר - נמכר או ירד - נמחק מהרשימה בשקט
    var ask = missing.slice(0, 100);
    sb.from('properties').select(COLS).eq('status', 'active').in('id', ask).then(function (r) {
      if (!r || r.error) return;
      var got = {};
      (r.data || []).forEach(function (p) { likedExtra[p.id] = p; got[p.id] = 1; });
      var gone = ask.filter(function (id) { return !got[id]; });
      if (gone.length) { likes = likes.filter(function (id) { return gone.indexOf(id) < 0; }); saveLikes(); }
      else if (view === 'likes') renderLikesView();
    }, function () {});
  }
  function renderLikesView() {
    var list = likedProps();
    // ‏N = השורות שעל המסך (פעילים בלבד) - מזהים שעוד בבדיקה לא נספרים
    $('swLvN').textContent = list.length;
    $('swLvShare').textContent = 'שיתוף הרשימה (' + list.length + ')';
    $('swLvEmpty').hidden = likes.length > 0;
    $('swLvBar').hidden = !likes.length;
    $('swLvList').innerHTML = list.map(function (p) {
      var ph = photos(p);
      return '<div class="sw-li sw-lv-row"><button type="button" class="sw-lv-open" data-like-open="' + esc(p.id) + '">' +
        (ph.length ? '<img ' + imgSrc(likedViz(p.id) || ph[0], 240) + ' alt="" loading="lazy" width="112" height="84" data-fb="sw-liimg">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-liimg')) +
        '<span class="sw-li-txt"><b>' + esc(fmtPrice(p)) + '</b><span>' + esc(title(p)) + '</span><small>' + esc(where(p)) + '</small></span></button>' +
        '<button type="button" class="sw-lv-heart" data-like-remove="' + esc(p.id) + '" aria-pressed="true" aria-label="' + esc('הסרה מהרשימה: ' + title(p)) + '">♥</button></div>';
    }).join('');
    var gab = $('swLvGab'), gh = gabListHref();
    gab.hidden = !gh;
    if (gh) gab.href = gh;
    fetchMissingLikes();
  }
  /* "שליחת הרשימה לגבריאלה": עד 10 קישורים, ואם יש יותר - "ועוד X נכסים ברשימה שלי" */
  function gabListHref() {
    if (!window.GabWidget || !window.GabWidget.link || !likes.length) return '';
    var ids = likes.slice().reverse(), shown_ = ids.slice(0, 10);
    var msg = 'היי גבריאלה, אהבתי את הנכסים האלה ואשמח לתאם ביקורים:\n' +
      shown_.map(function (id) { return location.origin + '/property?id=' + encodeURIComponent(id); }).join('\n') +
      (ids.length > 10 ? '\nועוד ' + (ids.length - 10) + ' נכסים ברשימה שלי' : '');
    return window.GabWidget.link(msg);
  }
  $('swLvList').addEventListener('click', function (e) {
    var rm = e.target.closest('[data-like-remove]');
    if (rm) {
      likes = likes.filter(function (x) { return x !== rm.dataset.likeRemove; });
      saveLikes();
      return;
    }
    var o = e.target.closest('[data-like-open]');
    if (!o) return;
    var p = likedProps().filter(function (x) { return String(x.id) === o.dataset.likeOpen; })[0];
    if (p) openSheetFor({ slot: 'property', p: p, pos: 'likes' });
  });
  $('swLvShare').addEventListener('click', function () { shareLikes(); });
  $('swLvBack').addEventListener('click', function () { setView('deck'); });
  $('swLvStart').addEventListener('click', function () { setView('deck'); });

  /* גבריאלה (‏gabriela-widget.js) בדף הזה: הכפתור הכחול מחיל את הסינון במקום ולא טוען מחדש */
  window.SwipeApp = {
    apply: function (o) {
      o = o || {};
      if (o.deal === 'sale' || o.deal === 'rent' || o.deal === 'commercial') filter.deal = o.deal;
      filter.fair = !!o.fair;
      if (!$('swFilter').hidden) closeFilter();
      buildDeck();
      renderSummary();
      setView('deck');
    }
  };

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
        (ph.length ? '<img ' + imgSrc(likedViz(p.id) || ph[0], 240) + ' alt="" loading="lazy" width="112" height="84" data-fb="sw-liimg">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-liimg')) +
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
    $('swLikesView').hidden = v !== 'likes';
    if (v === 'likes') $('swLikes').setAttribute('aria-current', 'page'); else $('swLikes').removeAttribute('aria-current');
    if (v === 'list') renderList();
    if (v === 'likes') { renderLikesView(); window.scrollTo(0, 0); }
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

  /* ההדרכה: **בביקור הראשון בלבד** בכל סוג מכשיר (‏localStorage), ואחר כך רק דרך "?".
     עד שלושה טיפים קצרים; כל טיפ מתקדם לבד 5 שניות אחרי שהתנועה שלו נגמרת,
     והחלקה אמיתית מתקדמת מיד. בטיפ ההחלקה אותן חותמות "אהבתי"/"דילוג" של
     הגרירה עצמה (לא תגיות נפרדות), והיד ממשיכה בלולאה עד שנוגעים בכרטיס.
     ההדרכה נגמרת בגיליון התחתון "מוכנים? בואו נתחיל" (‏tour_end).
     שכבה על הכרטיס העליון ולא חלון: שלושה טיפים כמו באבטיפוס (‏Coach) -
     החלקה לצדדים (יד שזזה, "אהבתי" / "דילוג"), הקשה על צדי התמונה (קו
     מקווקו ושתי ידיים מקישות, רק כשיש לכרטיס יותר מתמונה אחת), והחלקה למעלה
     (יד עולה ופאנל "פרטי הנכס" שמציץ). ‏prefers-reduced-motion - בלי תנועה. */
  var HAND = '<svg class="sw-hand" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';
  var UP = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  function tourSteps() {
    var d = isDesktop(), c = cur(), multi = !!(c && c.p && slides(c.p).length > 1);
    var steps = [{
      kind: 'swipe',
      text: 'החליקו ימינה אם אהבתם, שמאלה לדילוג',
      sub: d ? 'או במקלדת: → אהבתי · ← דילוג · וגם בכפתורים שלמטה' : 'אפשר גם בכפתורים ♥ ו-✕ שבתחתית המסך',
      // החותמות הן של הכרטיס עצמו (‏.sw-stamp) - אותה מילה, צבע ומקום כמו בגרירה
      art: '<span class="sw-co-hline"></span><span class="sw-co-arrows"><span>‹</span><span>›</span></span>' +
        '<span class="sw-co-hand-x">' + HAND + '</span>'
    }];
    if (multi) steps.push({
      kind: 'tap',
      text: d ? 'לחצו שמאלה לתמונה הבאה, ימינה לקודמת' : 'הקישו שמאלה לתמונה הבאה, ימינה לקודמת',
      // ‏V5: ההבטחה על ההדמיה נאמרת רק במקום שבו היא באמת מופיעה - בתמונה האחרונה של הכרטיס
      sub: (d ? 'או מקש רווח לתמונה הבאה. ' : '') + 'בנכסים עם ✨ הדמיה, התמונה האחרונה מראה איך הנכס יכול להיראות',
      art: '<span class="sw-co-vline"></span>' +
        '<span class="sw-co-zone is-left"><span class="sw-co-tapwrap"><span class="sw-co-rip"></span><span class="sw-co-tap">' + HAND + '</span></span><b>התמונה<br>הבאה</b></span>' +
        '<span class="sw-co-zone is-right"><span class="sw-co-tapwrap"><span class="sw-co-rip is-late"></span><span class="sw-co-tap is-late">' + HAND + '</span></span><b>התמונה<br>הקודמת</b></span>'
    });
    steps.push({
      kind: 'up',
      text: d ? 'גררו למעלה או הקישו ↑ לפרטי הנכס ויצירת קשר' : 'החליקו למעלה לפרטי הנכס ויצירת קשר',
      sub: d ? 'הפרטים ויצירת הקשר נפתחים בגיליון על הכרטיס' : 'בגיליון הפרטים: תמונות, מפה, תיאור ויצירת קשר',
      art: '<span class="sw-co-uline"></span><b class="sw-co-uword">לפרטי<br>הנכס</b>' +
        '<span class="sw-co-ups">' + UP + UP + '</span><span class="sw-co-hand-y"><span class="sw-co-rip"></span>' + HAND + '</span>' +
        '<span class="sw-co-peek"><i></i><b>פרטי הנכס</b><span><em>תמונות</em><em>מפה ותיאור</em><em>יצירת קשר</em></span></span>'
    });
    return steps;
  }
  var tourList = [], tourStep = 0, tourVisit = 0;
  function tourKey() { return 'sk_swipe_tour_seen_' + (isDesktop() ? 'desktop' : 'mobile'); }
  var tourThisVisit = false;   // ביקור = טעינת דף; "התחילו להחליק" שוב באותו ביקור אינו ביקור חדש
  var tourWait = 0, tourT = 0;
  function maybeTour(force) {
    var seen = Number(store(tourKey())) || 0;
    if (!force && (seen >= 1 || tourThisVisit)) return;
    if (!$('swTopCard')) return;
    if (bsKind) bsClose();
    /* רק על כרטיס שהתמונה האמיתית שלו נטענה - לא על ממלא־המקום. עד 3 שניות, ואחרת בכרטיס הבא */
    var img = $('swTopCard').querySelector('img.sw-cimg');
    if (!force && (!img || !(img.complete && img.naturalWidth > 0))) {
      if (img && !img.complete && tourWait < 30) { tourWait++; setTimeout(function () { maybeTour(force); }, 100); }
      else { tourWait = 0; tourPending = true; }
      return;
    }
    tourWait = 0; tourPending = false;
    if (!force) { tourThisVisit = true; tourVisit = seen + 1; store(tourKey(), String(tourVisit)); }
    var t = $('swTour');
    tourList = tourSteps();
    placeTour();
    tourStep = 0; showTip();
    openDialog(t);
    setTimeout(function () { $('swTourOk').focus({ preventScroll: true }); }, 40);
  }
  var tourPending = false;
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
    $('swTourStep').innerHTML = esc('טיפ ' + (tourStep + 1) + ' מתוך ' + tourList.length) +
      '<span class="sw-tour-dots" aria-hidden="true">' + tourList.map(function (_, i) { return '<i' + (i === tourStep ? ' class="on"' : '') + '></i>'; }).join('') + '</span>';
    $('swTourText').textContent = s.text;
    $('swTourSub').textContent = s.sub;
    $('swTourArt').innerHTML = s.art;
    var card = $('swTopCard') && $('swTopCard').querySelector('.sw-card');
    if (card) {
      card.classList.remove('sw-co-wig', 'sw-co-upc', 'sw-touring-up', 'sw-co-still');
      card.classList.add('sw-touring');
      void card.offsetWidth;   // מתחילים את התנועה מחדש בכל טיפ
      if (s.kind === 'swipe') card.classList.add('sw-co-wig');
      // רק בטיפ ההחלקה למעלה פרטי הכרטיס מוסתרים (הפאנל שמציץ צריך את המקום); בשאר - מעומעמים
      if (s.kind === 'up') card.classList.add('sw-co-upc', 'sw-touring-up');
      card.addEventListener('pointerdown', stillHand, { once: true });
    }
    $('swTour').classList.remove('is-still');
    // מתקדם לבד: התנועה נמשכת כ-3 שניות, ועוד 5 שניות בלי מגע
    clearTimeout(tourT);
    tourT = setTimeout(tourAdvance, 8000);
  }
  function stillHand() {
    $('swTour').classList.add('is-still');
    var card = $('swTopCard') && $('swTopCard').querySelector('.sw-card');
    if (card) card.classList.add('sw-co-still');
  }
  // החלקה בזמן ההדרכה (כמו באבטיפוס): הטיפ הבא, או סיום אחרי האחרון
  function tourAdvance() {
    if ($('swTour').hidden) return;
    if (tourStep < tourList.length - 1) { tourStep++; showTip(); placeTour(); } else endTour(false);
  }
  function endTour(skipped) {
    clearTimeout(tourT);
    if (skipped) { store(tourKey(), '2'); shukTrack('swipe_tour_skip', { visit: tourVisit || 1 }); }
    var card = $('swTopCard') && $('swTopCard').querySelector('.sw-card');
    if (card) card.classList.remove('sw-co-wig', 'sw-co-upc', 'sw-touring', 'sw-touring-up', 'sw-co-still');
    closeDialog($('swTour'), card);
    // סוף ההדרכה (לא דילוג): גיליון "מוכנים? בואו נתחיל"
    if (!skipped) bsOpen('tour_end');
  }
  $('swTourOk').addEventListener('click', function () { if (tourStep < tourList.length - 1) { tourStep++; showTip(); } else endTour(false); });
  $('swTourSkip').addEventListener('click', function () { endTour(true); });
  // "?" בכל רוחב: גיליון "איך מחליקים", ומשם אפשר להריץ את ההדרכה מחדש
  $('swHelp').addEventListener('click', function () { bsOpen('help'); });

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
      loadViz(rows).then(function () {
        renderFilter();
        // הכרטיס שעל המסך מקבל את שקופית ההדמיה שלו כשהזוג נטען, בלי לצייר אותו מחדש
        vizPrime();
      });
    });
  }
  if (window.supabase) start(); else window.addEventListener('load', start);
})();
