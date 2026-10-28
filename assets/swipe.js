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
  var COLS = 'id, price, price_unit, title, description, marketing_description, rooms, size_sqm, floor, city, city_id, street, address, house_number, ' +
    'property_type, deal_type, category, price_includes_vat, created_at, lat, lng, is_promoted, images, features, agent_id, agency_id, listing_number, ' +
    'neighborhood_id, sales_area, open_house, open_house_start, open_house_end, video_url, video_poster_url, agencies(name, slug, logo_url, cover_url), neighborhoods(name), ' +
    /* ‏R5-5: הסינון המתקדם שמגיע מדף הבית (‏hf=) */
    'condition, project_status, move_in_soon, move_in_date, mamad_location, storage_location, restrooms_location';
  var PIN_SVG = '<img src="/assets/logo-shuknadlan.svg" alt="" width="27" height="32">';

  /* ‏מתג כיבוי לכרטיסים הממומנים (החלטת A2): כבוי - כל משבצת ממומנת הופכת לנכס,
     גם כש-sponsors מלא, ולכן אין "ממומן", אין sponsored_impression/click ואין ליד
     ממומן. מדליקים רק אחרי שיש מפרסם משלם וצינור ליד שנבדק (‏docs/swipe-mode.md). */
  var SPONSORED_ENABLED = false;
  /* יצירת הדמיה מתוך ההחלקה (חלק 2 §5.3): כבוי עד שהמיגרציה של הבלם לגולש/ת
     (‏docs/proposals/visualization_visitor_cap.sql) תוחל. הקריאה, שקופית לפני/אחרי
     והסטודיו עובדים גם כך - במקום הכפתור יש קישור לדף הנכס. */
  var VIZ_SWIPE_GENERATE = false;

  /* ---------- סדר הכרטיסים (‏seq-v2, חלק 5 §7 - מקור האמת היחיד) ----------
     המקומות סופרים כל כרטיס בחפיסה (1-based). כרטיס שאינו נכס שהגיע זמנו
     ונחסם בכלל הרווח (R1) נדחה עד 6 מקומות ואז נשמט - לעולם לא שניים ברצף.
     ‏sponsors ריק או SPONSORED_ENABLED כבוי = אין כרטיסים ממומנים */
  var SEQ_CONFIG = {
    version: 'seq-v2',
    slots: [
      { at: 6, kind: 'spon_agency', firstSessionAt: 8 },
      { at: 9, kind: 'nc_promo' },
      { at: 12, kind: 'article', longAt: 20 },   // ‏longAt: חפיסה עם 30 נכסים עם תמונה ומעלה
      { at: 16, kind: 'spon_pro' },
      { at: 18, kind: 'seller' },
      { at: 26, kind: 'spon_agency' }
    ],
    cycleEvery: 12,
    cyclePattern: ['spon_any'],
    gap: 3,          // R1: לפחות 3 נכסים בין שני כרטיסים שאינם נכס
    sponGap: 4,      // ולפחות 4 בין שני ממומנים
    deferMax: 6,
    maxSponsored: 3,
    fairBoost: { first: 2, every: 5, max: 6 },   // R3
    /* ממלאים כאן (בעל האתר). משרד/סוכן/ת עצמאי/ת:
         { id, kind:'agency', name, slug, logo, desc, aud:'afula-emek|sale,rent' }
       בעל/ת מקצוע עם סרטון:
         { id, kind:'pro', field:'ייעוץ משכנתאות'|'שמאות'|'עריכת דין'|'הובלות', name, slug, video, poster, mortgage:true|false, aud }
       לעולם לא שם או רישיון של בעל האתר. */
    sponsors: []
  };
  /* R2: כששניים בשלים יחד */
  var SEQ_PRIO = ['spon_agency', 'spon_pro', 'spon_any', 'nc_promo', 'seller', 'article'];
  /* R8: התוויות של ‎?seqdebug=1‎ */
  var SLOT_LABEL = { property: 'נכס', property_fair: 'נכס · יריד', spon_agency: 'ממומן · משרד', spon_pro: 'ממומן · בעלי מקצוע',
    nc_promo: 'יריד · הזמנה', seller: 'חושבים למכור', article: 'כתבה', np_bridge: 'גשר · בלי תמונות', end: 'כרטיס סיום' };
  var PROMO = { nc_promo: 1, seller: 1, article: 1 };

  var REGION_GROUPS = {
    north: ['afula-emek', 'haifa', 'krayot', 'akko-nahariya', 'karmiel-misgav', 'nof-hagalil-migdal', 'kiryat-shmona', 'safed', 'golan', 'tiberias', 'beit-shean', 'yokneam'],
    center: ['hadera', 'netanya', 'kfar-saba-raanana', 'herzliya', 'tel-aviv', 'ramat-gan', 'bnei-brak-elad', 'petah-tikva', 'holon-bat-yam', 'rishon', 'rehovot', 'modiin', 'lod-ramla', 'jerusalem', 'beit-shemesh', 'samaria', 'binyamin', 'gush-etzion'],
    south: ['ashdod', 'ashkelon', 'kiryat-gat', 'sderot-netivot', 'beer-sheva', 'dimona-arad', 'eilat']
  };

  var Q_SALE = [['מתי מתכננים לקנות?', ['מיידי', 'בחצי שנה הקרובה', 'קודם צריך למכור נכס']], ['יש אישור עקרוני למשכנתא?', ['כן', 'עוד לא', 'לא צריך']]];
  var Q_RENT = [['מתי להיכנס?', ['מיידי', 'חודש-חודשיים', 'בחצי שנה הקרובה']]];
  /* TODO-ASK 28: האפשרויות למסחרי - ההצעה מהאבטיפוס, עד אישור בעל האתר */
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
    var ok = function (u) { return typeof u === 'string' && (/^https?:\/\//i.test(u.trim()) || /^(\/(?!\/)|assets\/)/i.test(u.trim())); };
    var list = (Array.isArray(p.images) ? p.images : []).filter(ok);
    // נכס בלי תמונות שיש לו סרטון: הפוסטר הוא התמונה (חלק 3 §1)
    return list.length || !ok(p.video_poster_url) ? list : [p.video_poster_url];
  }
  /* ---------- נכס בלי תמונות (סבב 4, חלק 3, ‏assets/no-photo.js) ---------- */
  function hasPhoto(p) { return photos(p).length > 0; }
  function npCtx(p) {
    var a = p.agent_id ? agents.get(p.agent_id) : null;
    return { agent: a || null, agency: p.agencies || null, private: advertiser(p).type === 'private' };
  }
  function npHtml(p, surface) { return window.NoPhoto ? NoPhoto.html(p, npCtx(p), surface) : ''; }
  function npMsg(p) { return window.NoPhoto ? NoPhoto.STR.msg(title(p)) : 'היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לקבל תמונות של הנכס'; }
  /* "רק נכסים עם תמונות": דלוק כברירת מחדל, '0' = כבוי */
  function photosOnlyPref() { return store('sk_swipe_photos_only') !== '0'; }
  function npOrder(list) {
    return list.slice().sort(function (a, b) {
      return (!!b.is_promoted - !!a.is_promoted) || ((Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
    });
  }
  /* תמונה מוקטנת מהאחסון (‏render/image). כתובת שאינה מהאחסון שלנו - כמו שהיא.
     ‏data-orig מאפשר חזרה למקור אם ההקטנה נכשלה.
     **תמיד resize=contain** (חלק 6 §0, §4): ‏width לבדו אינו מקטין אלא חותך רצועה
     מהמרכז (ברירת המחדל של Supabase היא cover), ולכן תמונה של 1600×1200 חזרה
     כ-800×1200 - חצי מהתמונה - ולפני ואחרי של אותו זוג נחתכו כל אחד אחרת.
     רוחב של כרטיס מעוגל ל-200 (מטמון), ולא מעל 1600. */
  function sized(u, w) {
    var s = String(u || ''), marker = '/storage/v1/object/public/', at = s.indexOf(marker);
    if (at < 0) return s;
    var path = s.slice(at + marker.length).split(/[?#]/)[0];
    if (w >= 400) w = Math.min(1600, Math.ceil(w / 200) * 200);
    return path ? s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=' + w + '&resize=contain&quality=70' : s;
  }
  /* הרוחב שכרטיס צריך: cover לתמונה לאורך (גובה × 0.75) או frame לרוחב (רוחב × 1.22), לפי DPR עד 2 */
  function cardW() {
    var d = $('swDeck'), r = d ? d.getBoundingClientRect() : null, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r || !r.width) return 1000;
    return Math.max(r.height * dpr * 0.75, r.width * dpr * 1.22);
  }
  /* התאמה לכל תמונה (חלק 6 §3): לאורך - cover עם 50% 42%; לרוחב או ריבוע - frame (ברוחב
     הכרטיס, ממורכזת לגובה, מעל העתק מטושטש); רזולוציה נמוכה - בלי הגדלה מעבר ל-1.5× */
  function fitMode(nw, nh, cw, ch) {
    if (!nw || !nh || !cw || !ch) return 'cover';
    var r = nw / nh, c = cw / ch, v = Math.min(r, c) / Math.max(r, c);
    if (v >= 0.72) return 'cover';
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    return nw * 1.5 / dpr < cw ? 'low' : 'frame';
  }
  function fitCard(img) {
    var card = img && img.closest('.sw-card');
    if (!card || card.classList.contains('is-ba') || !img.naturalWidth) return;
    var r = card.getBoundingClientRect(), mode = fitMode(img.naturalWidth, img.naturalHeight, r.width, r.height);
    card.setAttribute('data-fit', mode);
    // רזולוציה נמוכה: הרוחב המוצג לא יותר מפי 1.5 מהמקור (חלק 6 §3)
    img.style.width = mode === 'low' ? Math.round(Math.min(r.width * 0.92, img.naturalWidth * 1.5 / Math.min(window.devicePixelRatio || 1, 2))) + 'px' : '';
  }
  document.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('sw-cimg')) fitCard(t);
  }, true);
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
  /* ---------- רילס (סבב 5 §2): ‏video_url של הנכס, שקופית ראשונה, מושתק עם הצעה להפעיל קול ---------- */
  function hasReel(p) { return !!(p && typeof p.video_url === 'string' && /^https:\/\//i.test(p.video_url.trim())); }
  function slides(p) {
    var sp = vizSpecial(p), list = photos(p);
    if (hasReel(p)) list = ['#reel'].concat(list);
    return sp ? list.concat(['#viz:' + sp]) : list;
  }
  function slideKind(s) { return s === '#viz:ba' ? 'ba' : s === '#viz:invite' ? 'invite' : s === '#reel' ? 'reel' : ''; }
  function slideBase(p, s) {
    var k = slideKind(s);
    if (k === 'reel') return (p.video_poster_url && /^https?:\/\//.test(p.video_poster_url) && p.video_poster_url) || photos(p)[0] || '';
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
      im.onload = function () { clearTimeout(t); if (im.naturalWidth > 0) ok(im); else { vizBad.add(u); bad('load_error'); } };
      im.onerror = function () { clearTimeout(t); vizBad.add(u); bad('load_error'); };
      im.src = sized(u, cardW());   // אותו רוחב לשתי השכבות, ואותה כתובת שהכרטיס יבקש (מטמון)
    });
  }
  function vizPrep(p) {
    if (!vizMap.has(p.id) || vizPrepP.has(p.id)) return vizPrepP.get(p.id) || Promise.resolve();
    var list = vizMap.get(p.id).filter(function (v) { return v.before && v.after; }), reason = 'no_pair';
    var pr = (function tryAt(i) {
      if (i >= list.length) return Promise.reject(reason);
      return Promise.all([loadImg(list[i].after), loadImg(list[i].before)]).then(function (ims) {
        // היחס של ה"לפני" קובע את המצב של שתי השכבות (חלק 6 §5)
        list[i].bw = ims[1].naturalWidth; list[i].bh = ims[1].naturalHeight;
        return list[i];
      },
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
    // ‏P1-K1: עזר אחד (‏assets/viz-eligibility.js) - הכלל עצמו רק ב-RPC, לא כאן
    var pr = window.canVisualize ? window.canVisualize(Object.assign({}, p, { images: photos(p) }), sb)
      : !sb || isLand(p) || !photos(p).length ? Promise.resolve(false)
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
    if (a) return { type: 'agent', name: a.display_name || 'יועץ נדל״ן', sub: 'יועץ נדל״ן' + (ag && ag.name ? ' · ' + ag.name : ''),
      img: a.photo_url || (ag && ag.logo_url) || '', slug: a.slug || '', href: a.slug ? '/agent?slug=' + encodeURIComponent(a.slug) : '', phone: a.phone_e164 || '' };
    if (ag && ag.name) return { type: 'agency', name: ag.name, sub: 'משרד תיווך', img: ag.logo_url || '', slug: ag.slug || '',
      href: ag.slug ? '/agency?slug=' + encodeURIComponent(ag.slug) : '', phone: '' };
    return { type: 'private', name: 'מודעה פרטית', sub: 'מודעה פרטית · בעלי הנכס', img: '', slug: '', href: '', phone: '' };
  }
  function ctaLabel(adv) {
    return adv.type === 'agent' ? 'יצירת קשר עם יועץ הנדל״ן' : adv.type === 'agency' ? 'יצירת קשר עם המשרד' : 'יצירת קשר עם המפרסם';
  }
  function imgFallback(alt) {
    return '<div class="sw-img-fb" role="img" aria-label="' + esc(alt) + '">' + PIN_SVG + '</div>';
  }
  /* תמונה שנכשלה בטעינה מתחלפת בגרדיאנט עם הסיכה - אף פעם לא מסגרת ריקה */
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-fb-art')) { t.outerHTML = artBrand(t.getAttribute('data-fb-art')); return; }
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
    var specP = window.MarketScope ? MarketScope.spec(sb) : Promise.resolve(null), mspec = null;
    /* כתבות לכרטיס הכתבה (§6.1): 12 האחרונות עם הגוף (זמן קריאה ותקציר). יוצאות במקביל
       לנכסים ולא מעכבות את הכרטיס הראשון - מה שלא הגיע תוך שנייה וחצי פשוט לא בחפיסה הזו */
    var artP = sb.from('articles_public').select('id, slug, title, subtitle, category, cover_url, body, published_at')
      .order('published_at', { ascending: false }).limit(12)
      .then(function (r) { articles = (r && r.data) || []; }, function () {});
    return specP.then(function (spec) {
      mspec = spec;
      var q = sb.from('properties').select(COLS).eq('status', 'active');
      if (window.MarketScope) q = MarketScope.apply(q, spec);
      return q.order('is_promoted', { ascending: false }).order('created_at', { ascending: false }).limit(300);
    }).then(function (res) {
      var rows = (res && !res.error && res.data) || [];
      // סבב 5 §1: בלי נכסים מעיר של שוק אחר (שדה נחום, נוף הגליל...) - הסינון בשרת עוד לא חל על אנונימיים
      if (window.MarketScope && MarketScope.keepRows) rows = MarketScope.keepRows(rows, mspec);
      var ids = rows.map(function (p) { return p.agent_id; }).filter(Boolean)
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
      var agentsP = ids.length
        ? sb.from('agency_members_public').select('id, display_name, slug, phone_e164, photo_url, photo_position, cover_url').in('id', ids)
          .then(function (r) { ((r && r.data) || []).forEach(function (a) { agents.set(a.id, a); }); }, function () {})
        : Promise.resolve();
      var artWait = Promise.race([artP, new Promise(function (ok) { setTimeout(ok, 1500); })]);
      return Promise.all([agentsP, artWait]).then(function () { return rows; });
    }).catch(function (e) { console.warn('swipe: טעינת הנכסים נכשלה', e); return []; });
  }

  /* ---------- 2. הסינון ---------- */
  var filter = { deal: 'sale', area: 'all', budget: 0, rooms: 0, near: null, type: '', photos: photosOnlyPref() };
  /* ‏P0-3: סוג נכס - בחירה אחת. ‏sort אחד להחלקה, לרשימה ולמפה; "מומלצים" = סדר החפיסה */
  var TYPES = [['apt', 'דירה', /^(דירה|דופלקס|טריפלקס|סטודיו|יחידת דיור|מרתף)/], ['house', 'בית פרטי/קוטג׳', /בית פרטי|קוטג|דו משפחתי|וילה/],
    ['garden', 'דירת גן', /דירת גן/], ['roof', 'גג/פנטהאוז', /גג|פנטהאוז/], ['land', 'מגרש', /מגרש|קרקע|נחלה|משק/], ['comm', 'מסחרי', null],
    /* ‏P1-N1: תת-סוגים מסחריים - מוצגים רק כשהעסקה "מסחרי" (ושם בלי "מסחרי" הכפול) */
    ['c_office', 'משרדים', /משרד/, 1], ['c_shop', 'חנויות ושטח מסחרי', /חנו|שטח מסחרי|קליניק/, 1], ['c_industry', 'מבני תעשייה', /תעשי/, 1],
    ['c_storage', 'מחסנים', /מחס[ןנ]/, 1], ['c_hall', 'אולמות', /אול[םמ]/, 1], ['c_land', 'מגרשים', /מגרש/, 1]];
  function typeOk(p, key) {
    if (!key) return true;
    var t = TYPES.filter(function (x) { return x[0] === key; })[0];
    if (!t) return true;
    if (key === 'comm') return isComm(p);
    if (t[3]) return isComm(p) && t[2].test(p.property_type || '');
    return !isComm(p) && t[2].test(p.property_type || '');
  }
  var SORTS = [['rec', 'מומלצים'], ['new', 'חדשים ביותר'], ['price_asc', 'מחיר: מהנמוך לגבוה'], ['price_desc', 'מחיר: מהגבוה לנמוך'], ['ppsqm', 'מחיר למ״ר'], ['size', 'שטח: מהגדול לקטן']];
  var sortKey = 'rec';
  function sortLabel() { return (SORTS.filter(function (x) { return x[0] === sortKey; })[0] || SORTS[0])[1]; }
  function sortProps(list) {
    if (sortKey === 'rec') return list;
    var pr = function (p) { var n = Number(p.price); return isFinite(n) && n > 0 ? n : null; };
    var key = {
      'new': function (p) { return -(Date.parse(p.created_at || '') || 0); },
      price_asc: function (p) { return pr(p); },
      price_desc: function (p) { var n = pr(p); return n === null ? null : -n; },
      ppsqm: function (p) { var n = pr(p), a = Number(p.size_sqm); return n !== null && a > 0 ? n / a : null; },
      size: function (p) { var a = Number(p.size_sqm); return a > 0 ? -a : null; }
    }[sortKey];
    // בלי ערך (מחיר "לפי בקשה", בלי שטח) - בסוף; בשוויון - נכס עם תמונה קודם (חלק 3 §8)
    return list.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x === null || y === null) return ((x === null) - (y === null)) || (hasPhoto(b) - hasPhoto(a));
      return (x - y) || (hasPhoto(b) - hasPhoto(a));
    });
  }
  function activeFilters() {
    return extItems().length + (filter.deal === 'commercial' && filter.cdeal ? 1 : 0) + (filter.near || filter.area !== 'all' ? 1 : 0) + (filter.budget ? 1 : 0) + (filter.rooms ? 1 : 0) + (filter.type ? 1 : 0) +
      (filter.viz ? 1 : 0) + (filter.fair ? 1 : 0) + (filter.reel ? 1 : 0) + (filter.photos ? 0 : 1);
  }
  /* המצב בכתובת (‏replaceState): ערכי ברירת המחדל לא נכתבים, ו-reload משחזר */
  function writeUrl() {
    try {
      var q = new URLSearchParams(location.search);
      ['deal', 'cdeal', 'area', 'rooms', 'budget', 'type', 'photos', 'fair', 'sort', 'view', 'layout', 'hf'].forEach(function (k) { q.delete(k); });
      if (extQs) q.set('hf', extQs);
      if (view === 'list' && listLayout === 'rows') q.set('layout', 'rows');
      // התצוגה בכתובת (‏P1-L): "אחורה" מדף נכס חוזר לרשימה או למפה, ולא להחלקה
      if (view === 'list' || view === 'map') q.set('view', view);
      if (filter.deal !== 'sale') q.set('deal', filter.deal);
      if (filter.deal === 'commercial' && filter.cdeal) q.set('cdeal', filter.cdeal);
      if (filter.area !== 'all' && !filter.near) q.set('area', filter.area);
      if (filter.rooms) q.set('rooms', String(filter.rooms));
      // תקציב כאינדקס ב-BUDGETS של העסקה - אותה כתובת שדף הבית בונה (חלק 4 §3.4)
      var bi = (BUDGETS[filter.deal] || []).indexOf(filter.budget);
      if (filter.budget && bi > 0) q.set('budget', String(bi));
      if (filter.type) q.set('type', filter.type);
      if (!filter.photos) q.set('photos', '0');
      if (filter.fair) q.set('fair', '1');
      if (sortKey !== 'rec') q.set('sort', sortKey);
      var qs = q.toString();
      history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) { /* בלי History API - המצב רק בזיכרון */ }
  }
  function readUrl() {
    var d = params.get('deal');
    if (d === 'rent' || d === 'sale' || d === 'commercial') filter.deal = d;
    var a = params.get('area');
    if (a && (a === 'main' || a === 'around' || a.indexOf('city:') === 0)) filter.area = a;
    var r = Number(params.get('rooms')); if ([3, 4, 5].indexOf(r) >= 0) filter.rooms = r;
    var b = Number(params.get('budget')), bl = BUDGETS[filter.deal] || [];
    if (b > 0 && b < bl.length) filter.budget = bl[b];
    var t = params.get('type'); if (TYPES.some(function (x) { return x[0] === t; })) filter.type = t;
    var cdl = params.get('cdeal'); if (cdl === 'rent' || cdl === 'sale') filter.cdeal = cdl;
    if (params.get('photos') === '0') filter.photos = false;
    if (params.get('fair') === '1') filter.fair = true;
    var s_ = params.get('sort'); if (SORTS.some(function (x) { return x[0] === s_; })) sortKey = s_;
  }
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
  function dealOk(p, deal, cdeal) {
    // ‏cdeal: במסחרי בלבד - '' (הכול) | 'rent' | 'sale'
    if (deal === 'commercial') return isComm(p) && (!cdeal || p.deal_type === cdeal);
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
    if (window.OpenHouse) return OpenHouse.live(p);
    var now = Date.now(), s = Date.parse(p.open_house_start), e = Date.parse(p.open_house_end);
    return !!p.open_house && s <= now && e > now;
  }
  /* ---------- ‏R5-5: הסינון מדף הבית ----------
     ‏hf=<הכתובת של דף הבית> - המשפט והסינון המתקדם, בדיוק כמו בדף הבית (אותה ליבה,
     ‏SentenceSearch.Core). שני הקבצים נטענים רק כשיש hf. כל מסנן מוצג בגיליון כצ'יפ
     "מדף הבית" עם ✕, כדי שלא יהיה מסנן נסתר. העסקה נשארת של הגיליון (‏deal). */
  var extQs = params.get('hf') || '';
  var ext = null;   // { Core, st, areas, ctx, advQs, adv }
  function loadScript(src) {
    return new Promise(function (ok) { var el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = ok; document.head.appendChild(el); });
  }
  var extReady = extQs
    ? (window.SearchCore ? Promise.resolve() : loadScript('/assets/search-core.js'))
      .then(function () { return window.SentenceSearch ? null : loadScript('/assets/sentence-search.js'); })
    : Promise.resolve();
  var EXT_SENTENCE_KEYS = ['ptype', 'type', 'rooms', 'minPrice', 'maxPrice', 'q', 'hoods', 'city', 'ai', 'deal'];
  function initExt(rows) {
    if (!extQs || !window.SentenceSearch) return;
    var Core = window.SentenceSearch.Core;
    rows.forEach(function (p) { if (!p.neighborhood_name) p.neighborhood_name = (p.neighborhoods && p.neighborhoods.name) || ''; });
    var areas = Core.deriveAreas(rows);
    var qp = new URLSearchParams(extQs);
    var st = Core.resolveArea(Core.fromParams(qp), areas);
    st.deal = null;
    if (st.type === 'commercial') st.type = 'any';   // מסחרי הוא העסקה של הגיליון
    var adv = new URLSearchParams();
    qp.forEach(function (v, k) { if (EXT_SENTENCE_KEYS.indexOf(k) < 0) adv.append(k, v); });
    // ‏ai=1: אותה מפת הדמיות של הגיליון (‏vizMap), שנטענת אחרי הנכסים
    ext = { Core: Core, st: st, areas: areas, ctx: { areaIndex: areas.index, aiIds: { has: function (id) { return vizMap.has(id); } } }, adv: adv };
    ext.test = Core.advancedFromParams(adv).test;
  }
  function extItems() {
    if (!ext) return [];
    var C = ext.Core, st = ext.st, out = [];
    if ((st.types && st.types.length) || (st.type && st.type !== 'any')) out.push({ k: 'type', label: C.typesLabel(st) });
    if (st.hoods && st.hoods.length) out.push({ k: 'area', label: C.hoodsLabel(st.hoods, ext.areas, ext.ctx) });
    else if (st.area && st.area !== 'all') out.push({ k: 'area', label: C.areaLabel(st.area, ext.areas, ext.ctx) });
    if (st.city) out.push({ k: 'city', label: st.city });
    if (st.roomsIn && st.roomsIn.length) out.push({ k: 'rooms', label: C.roomsInLabel(st.roomsIn) });
    else if (st.rooms) out.push({ k: 'rooms', label: C.roomsLabel(st.rooms) });
    if (st.priceMin || st.priceMax) {
      out.push({ k: 'price', label: (st.priceMin ? 'מ-₪' + Number(st.priceMin).toLocaleString('he-IL') + ' ' : '') +
        (st.priceMax ? 'עד ₪' + Number(st.priceMax).toLocaleString('he-IL') : '') });
    }
    if (st.ai) out.push({ k: 'ai', label: 'עם הדמיה' });
    C.advancedFromParams(ext.adv).items.forEach(function (it, i) { out.push({ k: 'adv:' + i, label: it.label, params: it.params }); });
    return out;
  }
  function removeExt(k) {
    if (!ext) return;
    var st = ext.st;
    if (k === 'type') { st.type = 'any'; st.types = null; }
    else if (k === 'area') { st.area = 'all'; st.hoods = null; }
    else if (k === 'city') st.city = null;
    else if (k === 'rooms') { st.rooms = null; st.roomsIn = null; }
    else if (k === 'price') { st.priceMin = null; st.priceMax = null; }
    else if (k === 'ai') st.ai = false;
    else if (k.indexOf('adv:') === 0) {
      var it = extItems().filter(function (x) { return x.k === k; })[0];
      if (it && it.params) Object.keys(it.params).forEach(function (pk) {
        var vals = ext.adv.get(pk);
        if (pk === 'features' || pk === 'listing') {
          var left = String(vals || '').split(',').filter(function (v) { return v && v !== String(it.params[pk]); });
          if (left.length) ext.adv.set(pk, left.join(',')); else ext.adv.delete(pk);
        } else ext.adv.delete(pk);
      });
      ext.test = ext.Core.advancedFromParams(ext.adv).test;
    }
    var qs = [ext.Core.toParams(st, ext.areas, ext.ctx), ext.adv.toString()].filter(Boolean).join('&');
    extQs = qs;
    if (!extItems().length) { ext = null; extQs = ''; }
  }
  function extOk(p) {
    return !ext || (ext.Core.matches(p, ext.st, ext.ctx) && ext.test(p));
  }
  function matches(p, f) {
    if (!dealOk(p, f.deal, f.cdeal)) return false;
    if (!extOk(p)) return false;
    if (f.fair && !fairLive(p)) return false;
    if (f.viz && !vizMap.has(p.id)) return false;
    if (f.photos && !hasPhoto(p)) return false;
    if (f.type && !typeOk(p, f.type)) return false;
    if (f.reel && !hasReel(p)) return false;
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
  /* ‏P0-C: מונה אחד לשורת המיון ולגיליון - כמה נכסים יוצגו בפועל. עם "רק נכסים עם
     תמונות" אלה שבלי תמונות עדיין מגיעים אחרי הגשר (‏deckProps, ‏npRest), ולכן נספרים */
  function shownCount(f) {
    f = f || filter;
    var c = filtered(f).length;
    if (f.photos) c += filtered(Object.assign({}, f, { photos: false })).filter(function (p) { return !hasPhoto(p); }).length;
    return c;
  }
  function countLabel(c) { return c === 1 ? 'נכס אחד' : c + ' נכסים'; }
  function countFor(patch) {
    var f = Object.assign({}, filter, patch);
    return all.filter(function (p) { return matches(p, f); }).length;
  }
  function chip(label, attrs, on, extra) {
    return '<button type="button" class="sw-chip' + (extra ? ' ' + extra : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '" ' + attrs + '>' + label + '</button>';
  }
  function n(v) { return '<span class="sw-chip-n">' + v + '</span>'; }
  var townsOpen = false, otherOpen = false, otherGroup = 'north', otherCounts = null;

  function renderExtChips() {
    var box = $('swFExt');
    if (!box) return;
    var items = extItems();
    box.hidden = !items.length;
    box.innerHTML = items.length ? '<span class="sw-fext-h">מדף הבית:</span>' + items.map(function (it) {
      return '<button type="button" class="sw-chip is-on sw-fext-chip" data-ext="' + esc(it.k) + '" aria-label="הסרת ' + esc(it.label) + '">' +
        esc(it.label) + ' <span aria-hidden="true">✕</span></button>';
    }).join('') : '';
  }
  function renderFilter() {
    renderExtChips();
    document.querySelectorAll('#swFDeal [data-deal]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.deal === filter.deal));
    });
    var cd = $('swFCDeal');
    cd.hidden = filter.deal !== 'commercial';
    if (!cd.hidden) {
      cd.innerHTML = [['', 'הכול'], ['rent', 'להשכרה'], ['sale', 'למכירה']].map(function (x) {
        var n = countFor({ cdeal: x[0] });
        return n || x[0] === (filter.cdeal || '') ? chip(esc(x[1]) + ' · ' + n, 'data-cdeal="' + x[0] + '"', x[0] === (filter.cdeal || '')) : '';
      }).join('');
    }
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
    // סוג בלי אף נכס בסינון אינו מוצג (חוץ מהנבחר) - לעולם לא בחירה שמובילה לאפס
    var commDeal = filter.deal === 'commercial';
    $('swFType').innerHTML = chip('הכול', 'data-type=""', !filter.type) + TYPES.filter(function (t) {
      return commDeal ? !!t[3] : !t[3] && t[0] !== 'comm';
    }).map(function (t) {
      var k = countFor({ type: t[0] });
      return k || filter.type === t[0] ? chip(esc(t[1]) + ' ' + n(k), 'data-type="' + t[0] + '"', filter.type === t[0]) : '';
    }).join('');
    var reelN = countFor({ reel: true });
    $('swFReel').hidden = $('swFReelL').hidden = !reelN && !filter.reel;
    $('swFReel').innerHTML = chip('▶ רק נכסים עם סרטון ' + n(reelN), 'data-reelchip="1"', !!filter.reel);
    // §2: רק כשבשוק ובעסקה הזו יש לפחות דירה אחת ביריד עכשיו - אחרת לא מוצג בכלל (לא מתג כבוי ולא "0")
    var fairN = countFor({ fair: true, area: 'all', near: null, budget: 0, rooms: 0, type: '', viz: false, reel: false });
    $('swFFair').hidden = $('swFFairL').hidden = $('swFFairH').hidden = !fairN && !filter.fair;
    $('swFFair').innerHTML = chip('רק דירות ללא עמלת תיווך', 'data-fairchip="1"', !!filter.fair);
    $('swFPhotos').innerHTML = chip(esc(window.NoPhoto ? NoPhoto.STR.toggle : 'רק נכסים עם תמונות'), 'data-photos="1"', !!filter.photos);
    var c = shownCount();
    $('swFCount').textContent = c === 1 ? 'נכס אחד מתאים' : c + ' נכסים מתאימים';
    // הכפתור אומר מה יקרה בתצוגה שבה נמצאים (P0-3 §4); מ"אהבתי" - בתצוגה שאליה נחזור (‏P0-E)
    var dest = view === 'likes' ? likesReturnView() : view;
    $('swFGo').textContent = dest === 'list' ? (view === 'likes' ? 'הצגת ' + c + ' נכסים ברשימה' : 'הצגת ' + c + ' נכסים') : dest === 'map' ? 'הצגת ' + c + ' נכסים במפה' : 'הצגת ' + c + ' נכסים בהחלקה';
    $('swFLikesNote').hidden = view !== 'likes';
    var nf = activeFilters(), badge = $('swFBadge');
    badge.hidden = !nf; badge.textContent = nf || '';
    var fl = nf ? 'סינון, ' + nf + ' פעילים' : 'סינון';
    $('swFilterBtn').setAttribute('aria-label', fl); $('swFilterBtn').title = fl;
    $('swFGo').disabled = false;
    renderSummary();
  }
  function renderSummary() {
    var deal = { sale: 'למכירה', rent: 'להשכרה', commercial: 'מסחרי' }[filter.deal] +
      (filter.deal === 'commercial' && filter.cdeal ? (filter.cdeal === 'rent' ? ' להשכרה' : ' למכירה') : '');
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
    if (b.dataset.deal) { if (b.dataset.deal !== filter.deal) { filter.type = ''; filter.cdeal = ''; } filter.deal = b.dataset.deal; filter.budget = 0; if (filter.deal === 'commercial') filter.rooms = 0; renderFilter(); return; }
    if (b.hasAttribute('data-cdeal')) { filter.cdeal = b.getAttribute('data-cdeal'); filter.budget = 0; renderFilter(); return; }
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
    if (b.dataset.type !== undefined) { filter.type = b.dataset.type; renderFilter(); return; }
    if (b.dataset.fairchip) { filter.fair = !filter.fair; shukTrack('swipe_filter_nofee', { on: filter.fair ? 1 : 0 }); renderFilter(); return; }
    if (b.dataset.reelchip) { filter.reel = !filter.reel; renderFilter(); return; }
    if (b.dataset.photos) { filter.photos = !filter.photos; store('sk_swipe_photos_only', filter.photos ? null : '0'); renderFilter(); return; }
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
  // ‏R5-5: ✕ על צ'יפ "מדף הבית" מוריד את המסנן הזה בלבד
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ext]');
    if (!b) return;
    removeExt(b.getAttribute('data-ext'));
    renderFilter();
  });
  $('swFReset').addEventListener('click', function () {
    ext = null; extQs = '';   // ‏"ניקוי הכול" - גם מה שהגיע מדף הבית
    // "ניקוי הכול": גם היריד, סוג הנכס והמיון; "רק עם תמונות" חוזר לדלוק
    filter = { deal: filter.deal, area: 'all', budget: 0, rooms: 0, near: null, type: '', photos: true, fair: false, viz: false, reel: false };
    sortKey = 'rec'; syncSortBtn();
    store('sk_swipe_photos_only', null);
    shukTrack('swipe_filter_clear', { view: view });
    townsOpen = otherOpen = false; renderFilter();
  });
  $('swFGo').addEventListener('click', function () {
    var sp = { deal: filter.deal, region: market ? market.slug : '', via: 'swipe_filter' };
    if (filter.viz) sp.viz = 1;
    if (filter.fair) sp.fair = 1;
    shukTrack('swipe_start', sp);
    closeFilter();
    buildDeck();
    /* ‏P0-E: מ"אהבתי" הסינון לא משנה את הרשימה השמורה - עוברים לתצוגה שממנה הגיעו */
    if (view === 'likes') { setView(likesReturnView()); window.scrollTo(0, 0); }
    if (view === 'deck') maybeTour();
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
  /* ‏P1-L: חלון שנפתח עם תוכן מתחיל בראש הגולל. רינדור מחדש בתוך חלון פתוח (שבב בסינון)
     אינו עובר כאן, ולכן שומר את המיקום */
  function resetScroll(el) { if (el) { el.scrollTop = 0; el.scrollLeft = 0; } }
  function resetDialogScroll(el) { el.querySelectorAll('.sw-dscroll, .sw-fbody').forEach(resetScroll); }
  function openDialog(el) {
    resetDialogScroll(el);
    // ושוב אחרי שהתמונות התחילו להיטען - נגד עיגון גלילה
    requestAnimationFrame(function () { resetDialogScroll(el); });
    el.hidden = false;
    document.body.classList.add('sw-locked');
    openStack.push(el);
    setTimeout(reelSync, 0);
    setTimeout(function () { var f = focusables(el)[0]; if (f) f.focus({ preventScroll: true }); }, 30);
  }
  function closeDialog(el, back) {
    if (el.hidden) return;
    el.hidden = true;
    openStack = openStack.filter(function (x) { return x !== el; });
    if (!openStack.length) document.body.classList.remove('sw-locked');
    if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
    setTimeout(reelSync, 0);
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
    // ‏P1-H: נוסח אחד לכל כפתורי הלב באתר (גם בכותרת, ‏P1-E)
    var ll = 'הנכסים שאהבתי (' + likes.length + ')';
    $('swLikes').setAttribute('aria-label', ll); $('swLikes').title = ll;
    if (view === 'likes') renderLikesView();
  }

  /* הכרטיסים שבשלים במקום הזה (לפני הדחייה של R1) */
  function slotsAt(pos, longDeck) {
    var out = [];
    SEQ_CONFIG.slots.forEach(function (s) {
      var at = firstSession && s.firstSessionAt ? s.firstSessionAt : longDeck && s.longAt ? s.longAt : s.at;
      if (at === pos) out.push(s.kind);
    });
    var last = SEQ_CONFIG.slots[SEQ_CONFIG.slots.length - 1].at;
    if (pos > last && (pos - last) % SEQ_CONFIG.cycleEvery === 0) {
      var k = (pos - last) / SEQ_CONFIG.cycleEvery - 1;
      out.push(SEQ_CONFIG.cyclePattern[k % SEQ_CONFIG.cyclePattern.length]);
    }
    return out;
  }
  /* ‏aud של מפרסם: 'שוק|עסקאות' (‏'afula-emek|sale,rent'); ריק - כולם */
  function sponAud(s) {
    if (!s.aud) return true;
    var parts = String(s.aud).split('|'), m = parts[0], deals = (parts[1] || '').split(',').filter(Boolean);
    var dk = filter.deal === 'commercial' ? 'com' : filter.deal;
    return (!m || !market || m === market.slug) && (!deals.length || deals.indexOf(dk) >= 0);
  }
  var sponAlt = 0, fastSkips = 0;
  function fillSlot(kind, used) {
    if (kind === 'spon_any') kind = sponAlt++ % 2 ? 'spon_pro' : 'spon_agency';
    if (kind === 'spon_agency' || kind === 'spon_pro') {
      if (!SPONSORED_ENABLED || fastSkips >= 2) return null;   // R6: שני ממומנים שדולגו מהר - הבא נשמט
      if (counts.sponsored >= SEQ_CONFIG.maxSponsored) return null;
      var want = kind === 'spon_agency' ? 'agency' : 'pro';
      var s = SEQ_CONFIG.sponsors.filter(function (x) { return x.kind === want && !used[x.id] && sponAud(x); })[0];
      if (!s) return null;
      used[s.id] = 1; counts.sponsored++;
      return { slot: kind, sponsor: s };
    }
    if (kind === 'nc_promo') return ncPromoOk() ? { slot: 'nc_promo', variant: all.some(fairLive) ? 'live' : 'wait' } : null;
    if (kind === 'seller') return sellerOk() ? { slot: 'seller' } : null;
    if (kind === 'article') {
      if (shownGet('article')) return null;
      var a = pickArticle();
      return a ? { slot: 'article', article: a } : null;
    }
    return null;
  }
  /* ---------- כרטיסי הזמנה: יריד, חושבים למכור, כתבה (חלק 5 §3, §5, §6) ----------
     פעם בביקור כל אחד (‏sessionStorage, נספר כשהכרטיס נצפה), ודחייה נשמרת במכשיר */
  var DAY = 864e5;
  function shownGet(k) { return sessGet('sk_swipe_shown_' + k); }
  function ago(k) { var t = Number(store(k)) || 0; return t ? Date.now() - t : Infinity; }
  function ncPromoOk() {
    if (filter.fair || shownGet('nc_promo') || store('sk_fair_signed') === '1') return false;
    if (ago('sk_nc_promo_dismiss') < 14 * DAY) return false;
    if (!all.some(fairLive) && ago('sk_nc_promo_wait_seen') < 7 * DAY) return false;   // גרסת ההמתנה: פעם בשבוע
    return true;
  }
  function sellerOk() {
    if (filter.fair || shownGet('seller')) return false;
    return ago('sk_seller_dismiss') >= 30 * DAY && ago('sk_seller_sent') >= 180 * DAY;
  }
  /* "דחייה" = המשך בלי פעולה. שתיים (גם בין ביקורים) - הכרטיס יורד ל-14 / 30 יום */
  function promoDismiss(c, how) {
    if (c.slot === 'nc_promo') {
      shukTrack('nc_promo_dismiss', { how: how });
      var n = (Number(store('sk_nc_promo_dn')) || 0) + 1;
      if (n >= 2) { store('sk_nc_promo_dismiss', String(Date.now())); n = 0; }
      store('sk_nc_promo_dn', String(n));
    } else if (c.slot === 'seller') {
      if (how === 'later') { store('sk_seller_dismiss', String(Date.now())); return; }
      var m = (Number(store('sk_seller_dn')) || 0) + 1;
      if (m >= 2) { store('sk_seller_dismiss', String(Date.now())); m = 0; }
      store('sk_seller_dn', String(m));
    }
  }
  /* §6.1: אין במסד עמודת קהל לכתבה, ולכן היא נגזרת מהכותרת - במקום אחד */
  function articleDeal(a) {
    var t = [a.title, a.subtitle, a.slug].join(' ');
    if (a.category === 'בלוג המתווכים' || /שכונות/.test(t)) return '*';
    if (/שכר[\s-]?(ה)?דירה|שכירות|להשכרה|שוכר/.test(t)) return 'rent';
    if (/מסחרי|משרד(ים)?(\s|$)|השקעה|תשואה/.test(t)) return 'com';
    if (/למוכרים|למכירת|בלעדיות|הערכת שווי/.test(t)) return 'seller';
    return 'sale';
  }
  function artSeen() {
    var m = {};
    try { m = JSON.parse(store('sk_swipe_art_seen') || '{}') || {}; } catch (e) { m = {}; }
    Object.keys(m).forEach(function (k) { if (Date.now() - m[k] > 7 * DAY) delete m[k]; });
    return m;
  }
  function pickArticle() {
    var seen = artSeen(), fresh = articles.filter(function (a) { return !seen[a.id]; });
    var want = filter.deal === 'commercial' ? 'com' : filter.deal;
    var sellerDone = ago('sk_seller_dismiss') < 30 * DAY || ago('sk_seller_sent') < 180 * DAY;
    var ok = function (a) {
      var d = articleDeal(a);
      if (d === 'seller') d = want === 'sale' && sellerDone ? 'sale' : 'x';
      return d === want || (d === '*' && want !== 'com') || (want === 'sale' && d === '*');
    };
    return fresh.filter(ok)[0] || fresh.filter(function (a) { return articleDeal(a) !== 'seller' || sellerDone; })[0] || null;
  }
  /* סדר הנכסים בלי תמונות (חלק 3 §7). "רק עם תמונות" דלוק: כל הנכסים עם תמונה, ואחריהם כרטיס
     גשר אחד ואז אלה שבלי (מקודמים, ואז החדשים). כבוי: אלה שבלי נשזרים רק בזנב - 7 עם ואחד בלי,
     לעולם לא שניים ברצף ולא יותר מאחד בכל 8 כרטיסים; מה שלא נכנס בזנב מופיע ברשימה ובמפה */
  var npRest = [];
  /* רילס בסדר "מומלצים": אחד במקומות 2, 6, 10, 14… של הנכסים (מאלה שמתאימים לסינון, בלי חזרה) */
  function promoteReels(list) {
    if (sortKey !== 'rec') return list;
    var reels = list.filter(hasReel);
    if (!reels.length) return list;
    var used = new Set(), rest = list.slice(), out = [];
    for (var i = 0; rest.length; i++) {
      var slot = i === 1 || (i > 1 && (i - 1) % 4 === 0);
      var r = slot ? reels.filter(function (x) { return !used.has(x); })[0] : null;
      if (r) { used.add(r); rest.splice(rest.indexOf(r), 1); out.push(r); continue; }
      var nxt = rest.shift();
      if (used.has(nxt)) { i--; continue; }
      out.push(nxt);
    }
    return out;
  }
  function deckProps() {
    var props = promoteReels(sortProps(filtered()));
    npRest = [];
    if (filter.photos) {
      var rest = filtered(Object.assign({}, filter, { photos: false })).filter(function (p) { return !hasPhoto(p); });
      npRest = sortKey === 'rec' ? npOrder(rest) : sortProps(rest);
      return props;
    }
    var W = props.filter(hasPhoto), N = props.filter(function (p) { return !hasPhoto(p); });
    if (sortKey === 'rec') N = npOrder(N);
    var k = Math.min(N.length, Math.floor(W.length / 7)), head = W.length - 7 * k, out = W.slice(0, head);
    for (var i = 0; i < k; i++) out = out.concat(W.slice(head + 7 * i, head + 7 * i + 7), [N[i]]);
    return out;
  }
  function buildDeck() {
    var props = deckProps();
    writeUrl();
    counts = { sponsored: shown.sponsored };
    var photoN = props.filter(hasPhoto).length, longDeck = photoN >= 30;
    /* R3: נכסי היריד (עם תמונה) - הראשון במקום 2 ואחריו כל 5, עד 6; השאר בסדר הרגיל */
    var fb = SEQ_CONFIG.fairBoost, fairQ = filter.fair ? [] : props.filter(function (p) { return fairLive(p) && hasPhoto(p); }).slice(0, fb.max);
    var rest = props.filter(function (p) { return fairQ.indexOf(p) < 0; });
    var out = [], used = {}, pos = 1, sinceNon = Infinity, sinceSpon = Infinity, due = [], boostDue = false, lastBoost = false, propN = 0;
    var placed = {};
    while (rest.length || fairQ.length) {
      slotsAt(pos, longDeck).forEach(function (k) { due.push({ kind: k, until: pos + SEQ_CONFIG.deferMax }); });
      due = due.filter(function (d) { return d.until >= pos; });
      if (pos === fb.first || (pos > fb.first && (pos - fb.first) % fb.every === 0)) boostDue = true;
      var card = null;
      if (due.length && sinceNon >= SEQ_CONFIG.gap) {
        due.sort(function (a, b) { return SEQ_PRIO.indexOf(a.kind) - SEQ_PRIO.indexOf(b.kind); });
        for (var i = 0; i < due.length && !card; i++) {
          var spon = /^spon/.test(due[i].kind);
          if (spon && sinceSpon < SEQ_CONFIG.sponGap) continue;
          card = fillSlot(due[i].kind, used);
          if (card) { placed[card.slot] = 1; if (spon) sinceSpon = 0; }
          due.splice(i, 1); i--;   // נשמט אם לא מולא (אין מפרסם, נצפה כבר, נדחה)
        }
      }
      if (card) sinceNon = 0;
      else {
        var p;
        if (boostDue && fairQ.length && !lastBoost) { p = fairQ.shift(); boostDue = false; lastBoost = true; }
        else { p = rest.length ? rest.shift() : fairQ.shift(); lastBoost = false; }
        card = { slot: 'property', p: p };
        sinceNon++; sinceSpon++; propN++;
      }
      card.pos = pos++;
      out.push(card);
    }
    /* R4: "חושבים למכור" שלא הגיע למקומו בחפיסה קצרה, אחרי 10 נכסים לפחות - פעם אחת לפני הגשר/הסיום,
       ורק כשכלל הרווח (R1) מתקיים; אחרת הוא פשוט לא בחפיסה הזו */
    if (!placed.seller && propN >= 10 && sinceNon >= SEQ_CONFIG.gap) {
      var sc = fillSlot('seller', used);
      if (sc) { sc.pos = pos++; out.push(sc); }
    }
    // הגשר: פעם אחת בחפיסה, רק כשנשארו נכסים מתאימים בלי תמונות. אחריו אין כרטיסי הזמנה
    if (npRest.length) {
      out.push({ slot: 'np_bridge', count: npRest.length, pos: pos++ });
      npRest.forEach(function (p) { out.push({ slot: 'property', p: p, pos: pos++ }); });
    }
    out.push({ slot: 'end', pos: pos });
    if (DEBUG) { npAssert(out); seqAssert(out); }
    deck = out; idx = 0; history_ = [];
    $('swSortN').textContent = countLabel(shownCount());
    renderDeck();
    renderList();
    if (mapReady) drawMapMarkers();
  }
  /* R1 ב-DEBUG: לפחות 3 נכסים בין שני כרטיסים שאינם נכס (חוץ מהגשר והסיום) */
  function seqAssert(out) {
    var last = -Infinity;
    out.forEach(function (c, i) {
      if (c.slot === 'property' || c.slot === 'np_bridge' || c.slot === 'end') return;
      console.assert(i - last > SEQ_CONFIG.gap, 'swipe seq-v2 R1: ' + c.slot + ' במקום ' + c.pos + ' קרוב מדי לכרטיס הקודם');
      last = i;
    });
  }

  function syncSortBtn() {
    $('swSortBtn').textContent = 'מיון: ' + sortLabel() + ' ▾';
    $('swSortBtn').classList.toggle('is-on', sortKey !== 'rec');
  }
  $('swSortBtn').addEventListener('click', function () { bsOpen('sort'); });
  function npAssert(out) {
    if (filter.photos) return;
    out.forEach(function (c, i) {
      var win = out.slice(i, i + 8).filter(function (x) { return x.slot === 'property' && !hasPhoto(x.p); }).length;
      if (win > 1) console.error('swipe: יותר מנכס אחד בלי תמונות ב-8 כרטיסים, מקום ' + c.pos);
    });
  }
  var cur = function () { return deck[idx]; };
  function cardHtml(c, top) {
    var dbg = DEBUG ? '<span class="sw-dbg">' + esc(SLOT_LABEL[c.slot === 'property' && fairLive(c.p) ? 'property_fair' : c.slot] || c.slot) + ' · ' + c.pos + '</span>' : '';
    if (c.slot === 'property') {
      var p = c.p, ph = slides(p), adv = advertiser(p), at = (top && c.photo) || 0;
      if (at >= ph.length) at = c.photo = 0;
      var sp = top ? slideKind(ph[at]) : '';
      var np = !ph.length && window.NoPhoto ? npHtml(p, 'swipe') : '';
      var cw = cardW(), base = ph.length ? slideBase(p, ph[at]) : '';
      var img = ph.length ? '<img class="sw-cblur" aria-hidden="true" alt="" src="' + esc(sized(base, 40)) + '">' +
        '<img class="sw-cimg" draggable="false" data-fb="sw-cimg" ' + imgSrc(base, cw) + ' alt="' + esc(title(p)) + '"' + (top ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">'
        : np || imgFallback(title(p)).replace('sw-img-fb', 'sw-img-fb sw-cimg');
      var bars = '<div class="sw-bars" aria-hidden="true">' + barsHtml(ph, at) + '</div>';
      var facts = [rooms(p) ? rooms(p) + ' חד׳' : '', p.size_sqm ? p.size_sqm + ' מ״ר' : '', p.floor != null && p.floor !== '' ? 'קומה ' + p.floor : ''].filter(Boolean).join(' · ');
      // ‏OpenHouse.live נבדק בכל ציור: חלון שנסגר בזמן שהדף פתוח מוריד את התג בכרטיס הבא
      var nofee = fairLive(p);
      return '<article class="sw-card' + (sp ? ' is-' + sp : '') + (np ? ' is-np' : '') + '" data-slot="property"' + (nofee ? ' data-nofee' : '') +
        ' aria-label="' + esc((nofee ? NO_FEE + ', ' : '') + title(p) + ', ' + fmtPrice(p)) + '">' + img +
        '<div class="sw-vlayer">' + (sp ? layerHtml(p, sp) : '') + '</div>' + bars + dbg +
        '<div class="sw-ctop"><span class="sw-tag ' + (p.deal_type === 'rent' ? 'is-rent' : 'is-sale') + '">' + (isComm(p) ? 'מסחרי' : p.deal_type === 'rent' ? 'להשכרה' : 'למכירה') + '</span>' +
        (nofee ? nofeeTag() : '') +
        (p.property_type ? '<span class="sw-tag is-type">' + esc(p.property_type) + '</span>' : '') +
        (hasReel(p) ? '<span class="sw-tag sw-reel-tag"><i aria-hidden="true">▶</i> רילס<b></b></span>' : '') +
        '<span class="sw-count" aria-hidden="true"' + (ph.length > 1 ? '' : ' hidden') + '>' + (at + 1) + '/' + ph.length + '</span></div>' +
        '<button type="button" class="sw-vpill" data-vpill aria-label="איך זה יכול להיראות? מעבר להשוואת לפני ואחרי"' + (top && vizPair.get(p.id) && !sp ? '' : ' hidden') + '>✨ איך זה יכול להיראות?</button>' +
        '<div class="sw-cbody"><p class="sw-price">' + esc(fmtPrice(p)) + '</p>' +
        (nofee ? '<p class="sw-nofee-end">' + esc(FAIR_NAME + ' · ' + OpenHouse.endLabel(p)) + '</p>' : '') +
        '<h2 class="sw-ctitle">' + esc(title(p)) + '</h2>' +
        (facts ? '<p class="sw-facts">' + esc(facts) + '</p>' : '') +
        '<p class="sw-where"><span aria-hidden="true">📍</span> ' + esc(where(p)) + '</p>' +
        '<p class="sw-by">' + esc(adv.type === 'private' ? 'מודעה פרטית' : adv.name) + '</p>' +
        // ‏P0-1: כפתור ראשי לדף הנכס בכל שקופית; "פרטים ויצירת קשר" (הגיליון) משני, ובשקופית לפני/אחרי - ההדמיה במקומו
        '<div class="sw-acts"><a class="sw-open" href="/property?id=' + encodeURIComponent(p.id) + '" data-open>לפרטי הנכס ←</a>' +
        '<button type="button" class="sw-up" data-up' + (sp === 'ba' ? ' hidden' : '') + '>פרטים ויצירת קשר <span aria-hidden="true">↑</span></button>' +
        '<button type="button" class="sw-vcta" data-studio="slide_cta"' + (sp === 'ba' ? '' : ' hidden') + '>רוצים לראות בסגנון אחר? <b>✨ צרו הדמיה</b></button></div></div>' +
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
      return '<article class="sw-card sw-art" data-slot="article" aria-label="' + esc('כתבה: ' + a.title) + '">' + dbg +
        artCover(a, 'sw-cimg') + '<span class="sw-art-shade" aria-hidden="true"></span>' +
        '<div class="sw-art-in"><p class="sw-art-pills"><span class="sw-art-mag">מגזין שוק נדל״ן</span><span class="sw-art-cat">' + esc(catLabel(a.category) + ' · ' + readTime(a)) + '</span></p>' +
        '<h2 class="sw-art-title">' + esc(a.title) + '</h2>' + (a.subtitle ? '<p class="sw-art-sub">' + esc(a.subtitle) + '</p>' : '') +
        '<button type="button" class="sw-outline" data-promo-go>לקריאה ←</button>' +
        '<p class="sw-art-hint">החליקו למעלה לקריאה · הצידה כדי להמשיך</p></div></article>';
    }
    if (c.slot === 'nc_promo') {
      var live = c.variant === 'live';
      return '<article class="sw-card sw-promo sw-nc" data-slot="nc_promo" aria-label="יריד הבתים הפתוחים: דירות ללא עמלת תיווך">' + dbg +
        '<div class="sw-promo-in"><span class="sw-promo-gab"><img src="/assets/gabriela-avatar.webp" alt="" width="40" height="40" onerror="this.parentNode.hidden=true"></span>' +
        (window.OpenHouse ? OpenHouse.zeroArt('sw-nc-art') : '') +
        '<p class="sw-promo-kick">' + esc(FAIR_NAME) + '</p>' +
        '<h2 class="sw-promo-title">דירות ללא עמלת תיווך, לזמן מוגבל</h2>' +
        '<p class="sw-promo-sub">' + (live ? 'יועצי נדל״ן מהאזור מכניסים דירות ליריד, ואתם קונים בלי לשלם עמלת תיווך.' : 'דירות נכנסות ליריד לזמן מוגבל. השאירו פרטים ונעדכן אתכם ראשונים.') + '</p>' +
        '<button type="button" class="sw-gold sw-wide" data-promo-go>' + (live ? 'לדירות ביריד' : 'עדכנו אותי') + '</button>' +
        (live ? '<button type="button" class="sw-promo-link" data-nc-signup>עדכנו אותי כשנכנסת דירה</button>'
          : '<a class="sw-promo-link" href="/open-house" data-nc-page>מה זה היריד? ←</a>') + '</div></article>';
    }
    if (c.slot === 'seller') {
      var rent = filter.deal === 'rent';
      return '<article class="sw-card sw-promo sw-seller" data-slot="seller" aria-label="' + esc('לבעלי נכסים: ' + (rent ? 'חושבים להשכיר?' : 'חושבים למכור?') + ' השאירו פרטים') + '">' + dbg +
        '<div class="sw-promo-in">' + SELLER_ART +
        '<p class="sw-promo-kick">לבעלי נכסים</p>' +
        '<h2 class="sw-promo-title">' + (rent ? 'חושבים להשכיר?' : 'חושבים למכור?') + '</h2>' +
        '<p class="sw-promo-sub">השאירו פרטים, ויועץ נדל״ן מהאזור יחזור אליכם.</p>' +
        '<p class="sw-promo-gold">הערכת שווי ללא עלות · הנכס יכול להתפרסם כאן עם הדמיות AI</p>' +
        '<button type="button" class="sw-gold sw-wide" data-promo-go>השאירו פרטים</button>' +
        '<button type="button" class="sw-promo-link" data-seller-later>לא עכשיו</button></div></article>';
    }
    if (c.slot === 'np_bridge') {
      var bs = window.NoPhoto ? NoPhoto.STR : null;
      return '<article class="sw-card sw-np-bridge" data-slot="np_bridge" aria-label="' + esc(bs ? bs.bridge : '') + '">' + dbg +
        '<span class="sw-npb-brand"><img src="/assets/logo-shuknadlan-dark.svg" alt="" width="20" height="24">שוק הנדל״ן</span>' +
        '<div class="sw-end-in"><span class="sw-end-av"><img src="/assets/gabriela-cutout-400.webp" alt="" width="84" height="84" ' +
        'onerror="this.onerror=null;this.src=\'/assets/logo-shuknadlan.svg\'"></span>' +
        '<h2 class="sw-end-title">' + esc(bs ? bs.bridge : '') + '</h2>' +
        '<p class="sw-npb-sub">' + esc(bs ? bs.bridgeSub(c.count) : '') + '</p></div>' +
        '<button type="button" class="sw-npb-list" data-np-list>' + esc(bs ? bs.bridgeList : '') + '</button></article>';
    }
    return endCardHtml(dbg);
  }
  function barsHtml(ph, at) {
    if (ph.length < 2) return '';
    return ph.slice(0, 10).map(function (u, i) {
      var cl = [i === at ? 'on' : '', slideKind(u) === 'ba' ? 'is-viz' : '', slideKind(u) === 'reel' ? 'is-reel' : ''].filter(Boolean).join(' ');
      return '<span' + (cl ? ' class="' + cl + '"' : '') + '></span>';
    }).join('');
  }
  /* השכבה שמעל התמונה בשקופית המיוחדת: לפני/אחרי (התמונה עצמה היא ה"אחרי"), או ההזמנה */
  var reelSound = false;   // אחרי הפעלת קול פעם אחת - הרילסים הבאים בביקור מתחילים עם קול (אם הדפדפן מרשה)
  function reelLayer(p) {
    var poster = slideBase(p, '#reel');
    return '<div class="sw-reel-wrap"><video class="sw-reel" muted playsinline loop preload="none" draggable="false"' +
      (poster ? ' poster="' + esc(sized(poster, cardW())) + '"' : '') + ' src="' + esc(p.video_url.trim()) + '"></video>' +
      (reduceMotion ? '<button type="button" class="sw-reel-play" data-reel-play aria-label="הפעלת הסרטון">▶</button>' : '') +
      '<button type="button" class="sw-reel-snd" data-reel-snd' + (reelSound ? ' hidden' : '') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>הפעילו קול לשמוע את הקריינות</button>' +
      '<button type="button" class="sw-reel-mute" data-reel-mute aria-label="השתקה" title="השתקה"' + (reelSound ? '' : ' hidden') + '><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6M17 9l6 6"/></svg></button></div>';
  }
  /* רק וידאו אחד מתנגן: של הכרטיס העליון, כשהשקופית שלו היא הרילס, בלי גיליון/הדרכה/תצוגה אחרת */
  function reelSync() {
    var top = $('swTopCard'), v = top && top.querySelector('.sw-card.is-reel video.sw-reel');
    document.querySelectorAll('#swDeck video.sw-reel').forEach(function (x) { if (x !== v && !x.paused) x.pause(); });
    if (!v) return;
    var ok = view === 'deck' && !openStack.length && $('swTour').hidden && !reduceMotion && !v.dataset.err;
    if (!ok) { if (!v.paused) v.pause(); return; }
    if (!v.paused) return;
    v.muted = !reelSound;
    var c = cur();
    var go = v.play();
    if (go && go.then) go.then(function () {
      if (c && c.p && !c.reelPlayed) { c.reelPlayed = true; shukTrack('swipe_reel_play', { property_id: c.p.id }); }
    }, function () {
      // עם קול הדפדפן חוסם לפעמים - משתיקים ומנסים פעם אחת
      if (!v.muted) { v.muted = true; reelSound = false; reelUi(top); v.play().catch(function () {}); }
    });
  }
  /* ‏P0-D: ל-43 מתוך 59 הסרטונים אין ערוץ שמע, ו"הפעילו קול" הבטיח קריינות שלא קיימת.
     הכפתורים מוצגים רק כש-data-audio="yes": ‏Safari ‏audioTracks, ‏Firefox ‏mozHasAudio, ‏Chrome
     ‏webkitAudioDecodedByteCount אחרי חצי שנייה של ניגון (מפוענח גם כשהסרטון מושתק).
     עמודה במסד (‏video_has_audio) - הצעה ב-docs/proposals/video_has_audio.sql, לא בשימוש עד שתרוץ. */
  function detectAudio(v, w) {
    function set(yes) { w.dataset.audio = yes ? 'yes' : 'no'; if (!yes) v.dataset.noAudio = '1'; }
    function check() {
      if (v.audioTracks && typeof v.audioTracks.length === 'number') return set(v.audioTracks.length > 0);
      if (typeof v.mozHasAudio === 'boolean') return set(v.mozHasAudio);
      if (typeof v.webkitAudioDecodedByteCount === 'number') {
        var probe = function () {
          if (v.currentTime < 0.5 && !v.paused) return;
          v.removeEventListener('timeupdate', probe);
          set(v.webkitAudioDecodedByteCount > 0);
        };
        v.addEventListener('timeupdate', probe);
        return;
      }
      set(false);   // דפדפן שאינו מדווח - בלי כפתור, כמו בסרטון בלי קול
    }
    if (v.readyState >= 1) check(); else v.addEventListener('loadedmetadata', check, { once: true });
  }
  function reelUi(top) {
    var snd = top && top.querySelector('[data-reel-snd]'), mute = top && top.querySelector('[data-reel-mute]');
    if (snd) snd.hidden = reelSound;
    if (mute) mute.hidden = !reelSound;
  }
  function bindReel(top, c) {
    var v = top && top.querySelector('video.sw-reel');
    if (!v || v._bound) return;
    v._bound = true;
    // הכפתור "הפעילו קול" יושב מעל בלוק הטקסט של הכרטיס
    var body = top.querySelector('.sw-cbody'), w = top.querySelector('.sw-reel-wrap');
    if (body && w) w.style.setProperty('--cbody-h', body.offsetHeight + 'px');
    if (w) detectAudio(v, w);
    v.addEventListener('error', function () { v.dataset.err = '1'; v.hidden = true; var cd = v.closest('.sw-card'); if (cd) cd.classList.add('reel-err'); });   // התמונה שמתחת (הפוסטר) נשארת
    v.addEventListener('loadedmetadata', function () {
      var d = Math.round(v.duration || 0), tag = top.querySelector('.sw-reel-tag b');
      if (tag && d) tag.textContent = ' · ' + Math.floor(d / 60) + ':' + String(d % 60).padStart(2, '0');
    });
    v.addEventListener('timeupdate', function () {
      var seg = top.querySelector('.sw-bars span:first-child');
      if (seg && v.duration) seg.style.setProperty('--p', (v.currentTime / v.duration * 100).toFixed(1) + '%');
    });
  }
  function layerHtml(p, sp) {
    if (sp === 'reel') return reelLayer(p);
    if (sp === 'ba') { var v = vizPair.get(p.id); return baHtml(v, true, baFit(v)); }
    if (sp !== 'invite') return '';
    var line = isComm(p) ? 'ראו איך הוא יכול להיראות כעסק שלכם'
      : p.deal_type === 'rent' ? 'ראו איך הוא יכול להיראות מרוהט ומעוצב' : 'ראו איך הוא יכול להיראות אחרי שיפוץ';
    return '<div class="sw-inv"><h3 class="sw-inv-t">✨ צרו הדמיה לנכס הזה</h3><p class="sw-inv-s">' + esc(line) + '</p>' +
      '<button type="button" class="sw-gold sw-inv-b" data-studio="invite">✨ צרו הדמיה</button></div>';
  }
  var baHintGone = false;   // "גררו להשוואה" עד הגרירה הראשונה בביקור
  /* תיבה אחת לשתי השכבות (חלק 6 §5): אותו רוחב, אותו מצב ואותו object-position, ולכן הן
     מיושרות. המצב נקבע לפי ה"לפני": לאורך - כל הכרטיס; לרוחב - ברוחב הכרטיס, ממורכז לגובה */
  function baFit(v) {
    var d = $('swDeck'), r = d ? d.getBoundingClientRect() : { width: 0, height: 0 };
    return fitMode(v.bw, v.bh, r.width, r.height) === 'cover' ? 'cover' : 'frame';
  }
  function baHtml(v, withAfter, fit) {
    var w = cardW(), ratio = v.bw && v.bh ? (v.bw / v.bh).toFixed(4) : '0.75';
    return '<div class="sw-ba' + (baHintGone ? ' is-touched' : '') + '" data-fit="' + (fit || 'cover') + '" style="--pos:50%;--r:' + ratio + '">' +
      '<div class="sw-ba-box">' +
      (withAfter ? '<img class="sw-ba-after" draggable="false" data-fb="sw-ba-after" ' + imgSrc(v.after, w) + ' alt="אחרי - הדמיית AI">' : '') +
      '<img class="sw-ba-before" draggable="false" data-fb="sw-ba-before" ' + imgSrc(v.before, w) + ' alt="לפני - הצילום האמיתי"></div>' +
      '<span class="sw-ba-line" aria-hidden="true"></span><span class="sw-ba-knob" aria-hidden="true">‹ ›</span>' +
      '<span class="sw-ba-lbl is-before" aria-hidden="true">לפני</span><span class="sw-ba-lbl is-after" aria-hidden="true">אחרי · ✨ הדמיית AI</span>' +
      '<span class="sw-ba-hint" aria-hidden="true">גררו להשוואה</span>' +
      '<div class="sw-ba-strip" role="slider" tabindex="0" aria-label="ידית השוואה: גררו להשוואה בין לפני לאחרי" aria-valuemin="3" aria-valuemax="97" aria-valuenow="50"></div></div>';
  }
  /* ‏P0-8: כל התמונה היא אזור הווילון. גרירה אופקית בכל נקודה מזיזה את הווילון ולא את הכרטיס;
     גרירה אנכית עוברת לשקופית הבאה/הקודמת, והקשה - כמו בכל תמונה. מדפדפים את הכרטיס
     מבלוק הטקסט שמתחת או מ-♥/✕ (מטפל הכרטיס מדלג על ‎.sw-ba‎ במפורש) */
  function bindBa(el, inCard) {
    if (!el) return;
    var strip = el.querySelector('.sw-ba-strip'), on = false, sx = 0, sy = 0, axis = '';
    function set(pos) {
      pos = Math.max(3, Math.min(97, pos));
      el.style.setProperty('--pos', pos + '%');
      strip.setAttribute('aria-valuenow', String(Math.round(pos)));
    }
    function touched() { baHintGone = true; el.classList.add('is-touched'); }
    function fromX(x) { var r = el.getBoundingClientRect(); if (r.width) set((x - r.left) / r.width * 100); }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,a')) return;
      e.stopPropagation(); e.preventDefault();
      on = true; axis = ''; sx = e.clientX; sy = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
    });
    el.addEventListener('pointermove', function (e) {
      if (!on) return;
      e.stopPropagation();
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') { el.classList.add('is-dragging'); touched(); }
      }
      if (axis === 'x') fromX(e.clientX);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      el.addEventListener(t, function (e) {
        if (!on) return;
        e.stopPropagation(); on = false; el.classList.remove('is-dragging');
        if (!inCard || t === 'pointercancel') return;
        var top = $('swTopCard'), dy = e.clientY - sy;
        if (axis === 'y' && Math.abs(dy) > 50) nextPhoto(top, dy < 0 ? 1 : -1);
        else if (!axis) { var r = el.getBoundingClientRect(); nextPhoto(top, (sx - r.left) < r.width / 2 ? 1 : -1); }
      });
    });
    el.addEventListener('click', function (e) { if (!e.target.closest('button,a')) e.stopPropagation(); });
    strip.addEventListener('keydown', function (e) {
      var k = e.key, v = Number(strip.getAttribute('aria-valuenow')) || 50;
      var d = k === 'ArrowLeft' ? -5 : k === 'ArrowRight' ? 5 : k === 'Home' ? -100 : k === 'End' ? 100 : 0;
      if (!d && k !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      if (d) { set(v + d); touched(); }
    });
    el._set = set;
    if (inCard) placeBa(el);
  }
  /* ‏P0-2: הידית והרמז בחלק העליון של התמונה, מעל בלוק הטקסט (‏--ba-y לפי גובה ‎.sw-cbody‎) */
  function placeBa(el) {
    var card = el.closest('.sw-card'), body = card && card.querySelector('.sw-cbody');
    if (!card || !body) return;
    var h = card.clientHeight, bh = body.offsetHeight;
    el.style.setProperty('--ba-y', Math.max(70, Math.min(h * 0.38, h - bh - 60)) + 'px');
    el.style.setProperty('--cbody-h', bh + 'px');
  }
  /* פעם במכשיר: הידית זזה 50% → 70% וחוזרת, כשהשקופית גלויה ואין גיליון מעליה */
  function baIntro() {
    // ‏P0-8: פעם במכשיר - איך מדפדפים כשכל התמונה היא וילון
    if (!store('sk_ba_hint')) { store('sk_ba_hint', '1'); toast('גררו את הווילון כדי להשוות · לדפדוף, החליקו מהטקסט למטה או השתמשו ב-❤/✕', 6000); }
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
  /* §6.2: לפי גוף הכתבה, 200 מילים לדקה */
  function readTime(a) { var w = String(a.body || '').split(/\s+/).filter(Boolean).length; return Math.max(2, Math.round(w / 200)) + ' דק׳ קריאה'; }
  /* קטגוריה במסד מול התצוגה (סבב 5 §6) */
  function catLabel(c) { return c === 'בלוג המתווכים' ? 'הבלוג של יועצי הנדל״ן' : (c || 'מגזין'); }
  /* תמונת שער, ובלי שער (או כשהיא נכשלת) - כרטיס מותג כחול, לעולם לא תמונה שבורה */
  function artCover(a, cls) {
    return a.cover_url ? '<img class="' + cls + ' sw-art-img" draggable="false" src="' + esc(a.cover_url) + '" alt="" loading="lazy" data-fb-art="' + cls + '">' : artBrand(cls);
  }
  function artBrand(cls) { return '<span class="sw-art-brand ' + cls + '" aria-hidden="true"><img src="/assets/logo-shuknadlan.svg" alt="" width="40" height="47"></span>'; }
  var NO_FEE = 'ללא עמלת תיווך', FAIR_NAME = 'יריד הבתים הפתוחים';
  /* בית עם דלת פתוחה (לא ✦/✨ - אלה ההדמיה באותו כרטיס) */
  var NOFEE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6l4-1v7"/></svg>';
  function nofeeTag() { return '<span class="sw-tag is-nofee">' + NOFEE_SVG + esc(window.OpenHouse ? OpenHouse.NO_FEE : NO_FEE) + '</span>'; }
  var SELLER_ART = '<span class="sw-seller-art" aria-hidden="true"><svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="#c9a227" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 31 32 17l18 14"/><path d="M18 28v19h14"/><path d="M46 28v6"/><circle cx="44" cy="43" r="5"/><path d="M40 47l-6 6M37 50l2 2M35 52l2 2"/></svg></span>';

  function endCardHtml(dbg) {
    /* יריד בלי דירות (כפתור היריד של גבריאלה, וכרגע אין יריד חי): לא חפיסה ריקה אלא הסבר ושתי דרכים */
    if (filter.fair && !deck.some(function (x) { return x.slot === 'property'; })) {
      return '<article class="sw-card sw-end" data-slot="end" aria-label="כרגע אין יריד פעיל">' + (dbg || '') +
        '<div class="sw-end-in"><h2 class="sw-end-title">כרגע אין יריד פעיל</h2>' +
        '<p class="sw-end-line">כשיועצי הנדל״ן באזור יכניסו דירות ליריד הבתים הפתוחים, הן יופיעו כאן.</p>' +
        '<button type="button" class="sw-navy sw-wide" data-fair-off>לכל הנכסים למכירה</button>' +
        '<button type="button" class="sw-gold sw-wide" data-fair-signup>עדכנו אותי</button>' +
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
    if (tc) { bindBa(tc.querySelector('.sw-ba'), true); vizSlideSeen(c, tc.classList.contains('is-ba') ? 'ba' : 'invite'); }
    bindReel(top, c);
    setTimeout(reelSync, 0);
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
    var nofee = c.slot === 'property' && fairLive(c.p);
    shukTrack('swipe_card_view', nofee ? { slot: c.slot, position: c.pos, nofee: 1 } : { slot: c.slot, position: c.pos });
    c.viewAt = Date.now();
    if (nofee && !sessGet('sk_nofee_seen_' + c.p.id)) { sessSet('sk_nofee_seen_' + c.p.id); shukTrack('nofee_badge_view', { property_id: c.p.id, position: c.pos }); }
    if (c.slot === 'property') maybeAlertSheet();
    if (!c.counted && c.sponsor) { c.counted = true; shown.sponsored++; }
    // R7: כרטיס הזמנה נספר (פעם בביקור) כשהוא פעיל שנייה
    if (PROMO[c.slot]) impTimer = setTimeout(function () { if (cur() === c) promoSeen(c); }, 1000);
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
    // ‏P0-7: ‏phone_e164 שמור בלי '+', ו-tel:9725… מחייג בטלפון מספר מקומי שגוי
    var phone = adv && adv.phone ? adv.phone.replace(/\D/g, '') : '';
    $('swCall').hidden = !phone; $('swWa').hidden = !phone;
    if (phone) {
      $('swCall').href = 'tel:+' + phone;
      $('swWa').href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent('היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לפרטים');
    }
    $('swLike').setAttribute('aria-pressed', String(!!(p && likes.indexOf(p.id) >= 0)));
  }

  var deciding = false;   // הכרטיס עוד עף - לחיצה כפולה לא מדלגת על הנכס הבא
  function decide(dir, via) {
    var c = cur();
    if (deciding || !c || c.slot === 'end') return;
    var top = $('swTopCard');
    var added = false;
    /* כרטיסי הזמנה אינם "אהבתי" ואינם "דילוג": ♥ = הפעולה הראשית, וכל השאר ממשיך הלאה */
    if (PROMO[c.slot]) {
      if (dir === 'like' && via === 'btn') { promoGo(c, 'like'); return; }
      promoNext(c, via === 'btn' ? 'x' : via === 'key' ? 'key' : 'swipe', dir);
      return;
    }
    if (c.sponsor && dir === 'skip' && c.viewAt && Date.now() - c.viewAt < 1000) fastSkips++;   // R6
    // הגשר אינו "אהבתי" ואינו "דילוג": כל כיוון פשוט ממשיך לנכסים שבלי תמונות
    if (c.slot === 'np_bridge') {
      shukTrack('swipe_nophoto_bridge', { count: c.count });
      history_.push({ i: idx, liked: null });
      deciding = true;
      var go_ = function () { deciding = false; idx = Math.min(idx + 1, deck.length - 1); renderDeck(); };
      if (top && !reduceMotion) { top.classList.add(dir === 'like' ? 'fly-like' : 'fly-skip'); setTimeout(go_, 220); } else go_();
      return;
    }
    if (dir === 'like' && c.p && likes.indexOf(c.p.id) < 0) { likes.push(c.p.id); saveLikes(); added = true; sessionLikes++; lastLiked = c; }
    // R5: לא מפריעים מיד אחרי לייק - כרטיס הזמנה שבא אחריו מתחלף עם הנכס שאחריו
    var n1 = deck[idx + 1], n2 = deck[idx + 2];
    if (dir === 'like' && n1 && n2 && (PROMO[n1.slot] || n1.sponsor) && n2.slot === 'property') {
      deck[idx + 1] = n2; deck[idx + 2] = n1; var tp = n1.pos; n1.pos = n2.pos; n2.pos = tp;
    }
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
  $('swSkip').addEventListener('click', function () { decide('skip', 'btn'); });
  $('swLike').addEventListener('click', function () { decide('like', 'btn'); });
  /* ---------- כרטיסי ההזמנה: המשך, פעולה ראשית, צפייה ---------- */
  function promoNext(c, how, dir) {
    if (!c.acted) promoDismiss(c, how);
    history_.push({ i: idx, liked: null });
    deciding = true;
    var top = $('swTopCard');
    var go_ = function () { deciding = false; idx = Math.min(idx + 1, deck.length - 1); renderDeck(); };
    if (top && !reduceMotion) { top.classList.add(dir === 'like' ? 'fly-like' : 'fly-skip'); setTimeout(go_, 220); } else go_();
  }
  function promoGo(c, via) {
    c.acted = true;
    if (c.slot === 'nc_promo') {
      if (c.variant === 'live') {
        shukTrack('nc_promo_click', { cta: 'deck' });
        // בתוך הדף: החפיסה נבנית מחדש עם דירות היריד בלבד, הלייקים נשארים
        filter.fair = true; buildDeck(); renderSummary(); renderFilter();
      } else { shukTrack('nc_promo_click', { cta: 'signup' }); openFairSignup('swipe_promo'); }
    } else if (c.slot === 'seller') { shukTrack('seller_card_click', { cta: 'open' }); openSeller(); }
    else if (c.slot === 'article') openArticle(c, via);
  }
  function promoSeen(c) {
    sessSet('sk_swipe_shown_' + c.slot);
    if (c.slot === 'nc_promo') {
      if (c.variant === 'wait') store('sk_nc_promo_wait_seen', String(Date.now()));
      shukTrack('nc_promo_view', { variant: c.variant, position: c.pos });
    } else if (c.slot === 'seller') shukTrack('seller_card_view', { position: c.pos, deal: filter.deal });
    else if (c.slot === 'article') {
      var m = artSeen(); m[c.article.id] = Date.now(); store('sk_swipe_art_seen', JSON.stringify(m));
      shukTrack('article_card_view', { article_id: String(c.article.id), position: c.pos, deal: articleDeal(c.article) });
    }
  }
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
    var img = top.querySelector('.sw-cimg'), blur = top.querySelector('.sw-cblur');
    // בשקופית לפני/אחרי התמונה של הכרטיס מוסתרת, והטשטוש שמאחור הוא של ה"לפני"
    var u = s ? (sp === 'ba' ? vizPair.get(c.p.id).before : slideBase(c.p, s)) : '';
    if (img && img.tagName === 'IMG' && u && img.getAttribute('data-orig') !== u) {
      card.removeAttribute('data-fit'); img.style.width = '';
      img.setAttribute('data-orig', u); img.src = sized(u, cardW());
    }
    if (blur && u) blur.src = sized(u, 40);
    var was = card.classList.contains('is-ba') ? 'ba' : card.classList.contains('is-invite') ? 'invite' : card.classList.contains('is-reel') ? 'reel' : '';
    card.classList.toggle('is-ba', sp === 'ba');
    card.classList.toggle('is-invite', sp === 'invite');
    card.classList.toggle('is-reel', sp === 'reel');
    if (sp === 'ba') card.setAttribute('data-fit', baFit(vizPair.get(c.p.id)));
    else if (was === 'ba' && img && img.complete) fitCard(img);
    var layer = top.querySelector('.sw-vlayer');
    if (layer && was !== sp) { layer.innerHTML = layerHtml(c.p, sp); bindBa(layer.querySelector('.sw-ba'), true); bindReel(top, c); }
    var bars = top.querySelector('.sw-bars');
    if (bars) bars.innerHTML = barsHtml(ph, at);
    var cnt = top.querySelector('.sw-count');
    if (cnt) { cnt.textContent = (at + 1) + '/' + ph.length; cnt.hidden = ph.length < 2; }
    var pill = top.querySelector('.sw-vpill');
    if (pill) pill.hidden = !(vizPair.get(c.p.id) && !sp);
    var up = top.querySelector('.sw-up'), vc = top.querySelector('.sw-vcta');
    if (up) up.hidden = sp === 'ba';
    if (vc) vc.hidden = sp !== 'ba';
    if ((sp === 'ba' || sp === 'invite') && was !== sp) vizSlideSeen(c, sp);
    reelSync();
  }

  /* מחוות: גרירה לצדדים (אהבתי/דילוג), למעלה (פרטים), והקשה על צידי התמונה (תמונה) */
  function bindGestures(top) {
    var card = top.querySelector('.sw-card');
    if (!card) return;
    // במחשב: בלי גרירה מקורית של תמונה (אחרת הכרטיס לא זז והחותמת נשארת ב-0)
    top.addEventListener('dragstart', function (e) { e.preventDefault(); });
    var sx = 0, sy = 0, dx = 0, dy = 0, drag = false, moved = false, tapPromo = false;
    var stampLike = card.querySelector('.sw-stamp.is-like'), stampSkip = card.querySelector('.sw-stamp.is-skip');
    // החותמת מתמלאת עם הגרירה (‏dx/100), ובמאה פיקסלים ההחלטה נופלת
    function stamps(v) {
      if (stampLike) stampLike.style.opacity = String(Math.max(0, Math.min(1, v / 100)));
      if (stampSkip) stampSkip.style.opacity = String(Math.max(0, Math.min(1, -v / 100)));
    }
    card.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button,a,input,label,form,textarea')) return;
      if (e.target.closest('.sw-ba')) return;   // הווילון - לא הכרטיס (P0-8)
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
      if (dy < -90 && Math.abs(dx) < 80) { if (c && PROMO[c.slot]) promoGo(c, 'up'); else openSheetFor(c); return; }
      if (!moved && c && PROMO[c.slot]) { tapPromo = true; return; }
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
      if (c && PROMO[c.slot]) {
        var wasTap = tapPromo; tapPromo = false;
        if (e.target.closest('[data-promo-go]')) { promoGo(c, 'button'); return; }
        if (e.target.closest('[data-nc-signup]')) { c.acted = true; shukTrack('nc_promo_click', { cta: 'signup' }); openFairSignup('swipe_promo'); return; }
        if (e.target.closest('[data-nc-page]')) { c.acted = true; shukTrack('nc_promo_click', { cta: 'page' }); return; }
        if (e.target.closest('[data-seller-later]')) { shukTrack('seller_card_click', { cta: 'later' }); promoDismiss(c, 'later'); c.acted = true; promoNext(c, 'later', 'skip'); return; }
        if (wasTap && !e.target.closest('a,button')) promoGo(c, 'tap');
        return;
      }
      // רילס: קול, השתקה, והפעלה ידנית ב-reduced motion
      var rv = top.querySelector('video.sw-reel');
      if (e.target.closest('[data-reel-snd]') && rv) {
        e.stopPropagation(); reelSound = true; rv.muted = false; reelUi(top);
        rv.play().catch(function () { rv.muted = true; reelSound = false; reelUi(top); });
        shukTrack('swipe_reel_unmute', { property_id: c.p.id }); return;
      }
      if (e.target.closest('[data-reel-mute]') && rv) { e.stopPropagation(); reelSound = false; rv.muted = true; reelUi(top); return; }
      if (e.target.closest('[data-reel-play]') && rv) {
        e.stopPropagation(); rv.muted = !reelSound; rv.play().catch(function () {});
        e.target.closest('[data-reel-play]').hidden = true; return;
      }
      // ‏"לפרטי הנכס ←" - קישור רגיל; רק נמדד, ולא נבלע בגרירה (P0-1)
      if (e.target.closest('[data-open]')) {
        e.stopPropagation();
        var cc = top.querySelector('.sw-card');
        shukTrack('swipe_open_property', { property_id: c.p.id, slide: cc.classList.contains('is-ba') ? 'ba' : cc.classList.contains('is-invite') ? 'invite' : cc.classList.contains('is-np') ? 'no_photo' : 'photo' });
        return;
      }
      var npc = e.target.closest('[data-np-cta]');
      if (npc) { e.stopPropagation(); npRequest(c, npc.dataset.level, 'swipe'); return; }
      if (e.target.closest('[data-np-list]')) {
        e.stopPropagation();
        shukTrack('swipe_nophoto_list', { count: c.count });
        setView('list', false, true); return;
      }
      // ‏✨ איך זה יכול להיראות? - ישר לשקופית לפני/אחרי (האחרונה)
      if (e.target.closest('[data-vpill]')) {
        shukTrack('viz_pill_click', { property_id: c.p.id });
        c.photo = slides(c.p).length - 1; syncSlide(top, c); return;
      }
      var st_ = e.target.closest('[data-studio]');
      if (st_) { openSheetFor(c, { tab: 'viz', from: st_.dataset.studio }); return; }
      if (e.target.closest('[data-spon-cta]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); openSheetFor(c); return; }
      if (e.target.closest('[data-spon-link]')) { shukTrack('sponsored_click', { slot: c.slot, sponsor_id: c.sponsor.id }); return; }
      if (e.target.closest('#swWiden')) { openFilter(e.target); return; }
      if (e.target.closest('[data-fair-signup]')) { openFairSignup('empty_fair'); return; }
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
    if (e.key === 'ArrowRight') { e.preventDefault(); decide('like', 'key'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); decide('skip', 'key'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (c && PROMO[c.slot]) promoGo(c, 'up'); else if (c && c.slot !== 'end') openSheetFor(c); }
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
        : '<div class="sw-gal">' + (window.NoPhoto ? '<div class="sw-gal-np">' + npHtml(p, 'card') + '</div>' : imgFallback(title(p)).replace('sw-img-fb', 'sw-img-fb sw-gimg')) + '</div>') +
      '<p class="sw-dprice">' + esc(fmtPrice(p)) + '</p><p class="sw-dtitle">' + esc(title(p)) + '</p>' +
      '<p class="sw-daddr"><span aria-hidden="true">📍</span> ' + esc(where(p)) + '</p>' +
      '<div class="sw-tiles">' + tiles.map(function (t) { return '<div><span>' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b></div>'; }).join('') + '</div>' +
      (feats.length ? '<div class="sw-feats">' + feats.filter(function (f) { return FEAT[f]; }).map(function (f) { return '<span>' + esc(FEAT[f]) + '</span>'; }).join('') + '</div>' : '') +
      (desc ? '<h3 class="sw-sub-h">תיאור</h3><p class="sw-desc">' + esc(desc) + '</p>' : '') +
      (p.lat && p.lng ? '<h3 class="sw-sub-h">מיקום</h3><div class="sw-minimap" id="swMiniMap"></div>' +
        '<p class="sw-gm"><a href="' + esc(gm) + '" target="_blank" rel="noopener">פתיחה ב-Google Maps ←</a></p>' : '') +
      '<p class="sw-full"><a href="/property?id=' + encodeURIComponent(p.id) + '">לדף הנכס המלא ←</a></p>';
  }
  function formHtml(c, preset, fullMsg) {
    var p = c.p;
    var msg = p ? (fullMsg || (preset ? 'היי, ' + preset + ': ' + title(p) : 'היי, ראיתי את ' + title(p) + ' בשוק הנדל״ן ואשמח לפרטים')) : '';
    return '<form class="sw-lead" id="leadForm" hidden novalidate>' +
      '<label class="sw-field"><span>שם</span><input id="swLName" autocomplete="name" required></label>' +
      '<label class="sw-field"><span>טלפון</span><input id="swLPhone" type="tel" inputmode="tel" autocomplete="tel" required></label>' +
      (p ? '<label class="sw-field"><span>הודעה</span><textarea id="swLMsg" rows="3">' + esc(msg) + '</textarea></label>' : '') +
      (p ? qHtml(questionsFor(c)) : sponQHtml()) +
      '<label class="sw-consent"><input type="checkbox" id="swLConsent"> <span>מאשרים פנייה חוזרת מהמפרסם בנוגע לפנייה הזו, בהתאם ל<a href="/terms" target="_blank">תנאי השימוש</a> ול<a href="/privacy" target="_blank">מדיניות הפרטיות</a>.</span></label>' +
      '<p class="sw-ferr" id="swLErr" role="alert"></p></form>' +
      '<p class="sw-done" id="swLDone" hidden>✅ הפנייה נשלחה. יחזרו אליכם בקרוב.</p>';
  }
  /* "בקשו תמונות מהמפרסם": הגיליון נפתח עם הטופס וההודעה המלאה. שום דבר לא נשלח בלחיצה */
  function npRequest(c, level, surface) {
    if (!c || !c.p) return;
    shukTrack('photo_request', { property_id: c.p.id, level: level || (window.NoPhoto ? NoPhoto.level(c.p, npCtx(c.p)) : 'c'), surface: surface });
    openSheetFor(c, { form: true, fullMsg: npMsg(c.p), source: 'photo_request' });
  }
  /* ‏opts.msg - הודעה מוכנה ("אשמח לתאם ביקור בנכס"), ‏opts.form - הטופס פתוח. אף פעם לא שליחה */
  function openSheetFor(c, opts) {
    opts = opts || {};
    if (!c || (c.slot !== 'property' && !(c.sponsor && (c.slot === 'spon_agency' || c.sponsor.mortgage)))) return;
    if (!$('swTour').hidden) endTour(false);
    sheetCard = c; sheetOpener = document.activeElement; formOpen = false; sent = false; answers = {};
    c.source = opts.source || '';   // ‏photo_request - בקשת תמונות (חלק 3 §5)
    var adv = c.p ? advertiser(c.p) : { type: 'agency', name: c.sponsor.name, sub: c.sponsor.kind === 'pro' ? c.sponsor.field : 'משרד תיווך',
      img: c.sponsor.logo || '', slug: c.sponsor.slug || '', href: c.sponsor.slug ? (c.sponsor.kind === 'pro' ? '/professional?slug=' : '/agency?slug=') + encodeURIComponent(c.sponsor.slug) : '' };
    var label = c.p ? ctaLabel(adv) : (c.sponsor.kind === 'agency' ? 'יצירת קשר עם המשרד' : 'יצירת קשר עם המפרסם');
    sheetCard.label = label;
    measureActions();
    var studio = studioOk(c);
    $('swSheetBody').innerHTML = (studio ? '<div class="sw-tabs" role="tablist" aria-label="פרטי הנכס והדמיה">' +
        '<button type="button" role="tab" id="swTabBtnInfo" data-tab="info" aria-controls="swTabInfo" aria-selected="true">פרטים</button>' +
        '<button type="button" role="tab" id="swTabBtnViz" data-tab="viz" aria-controls="swTabViz" aria-selected="false" tabindex="-1">✨ הדמיה</button></div>' : '') +
      '<div id="swTabInfo"' + (studio ? ' role="tabpanel" aria-labelledby="swTabBtnInfo"' : '') + '>' + bannerHtml(adv, label) + formHtml(c, opts.msg, opts.fullMsg) +
        (c.p && fairLive(c.p) ? '<div class="sw-fairband"><p>' + esc(FAIR_NAME + ' · ' + NO_FEE + ' לקונה ' + OpenHouse.rangeLabel(c.p)) + '</p><a href="/open-house">מה זה היריד? ←</a></div>' : '') +
        (c.p ? propInfoHtml(c.p) : '') +
        // ‏P1-P: מספר המודעה בתחתית הפרטים
        (c.p && c.p.listing_number ? '<p class="sw-listing-no">מודעה #' + esc(String(c.p.listing_number)) + '</p>' : '') + '</div>' +
      (studio ? '<div id="swTabViz" class="sw-studio" role="tabpanel" aria-labelledby="swTabBtnViz" hidden></div>' : '');
    $('swCtaBar').hidden = false;
    st = null;
    syncCta();
    if (opts.form) toggleForm(true);
    openDialog($('swSheet'));
    if (studio && opts.tab === 'viz') setTab('viz', opts.from);
    try { history.pushState({ swSheet: 1 }, ''); sheetPushed = true; } catch (e) { sheetPushed = false; }
    shukTrack('swipe_up_open', { slot: c.slot, position: c.pos });
    // ‏P1-M: הנכס נפתח מהתצוגה הזו - "לפרטי הנכס" בגיליון יורש את המקור
    if (c.p && window.shukBrowseMark) shukBrowseMark(view === 'list' ? 'swipe_list' : view === 'map' ? 'swipe_map' : view === 'likes' ? 'likes' : 'swipe', c.p.id);
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
    /* ‏P1-K1: בלי הדמיה - לא התמונה הראשונה (לפעמים צילום חוץ מתחת ל"חלל העסק"), אלא
       המקור שהצינור היה בוחר לאותה מטרה, כשהוא ידוע מהדמיה אחרת; אחרת בלי תמונת רקע */
    var p = st.p, r = vizFind(p, st.target, st.key);
    var same = (vizMap.get(p.id) || []).filter(function (v) { return v.target === st.target && v.before; })[0];
    var src = (r && r.before) || (same && same.before) || '';
    if (st.busy) {
      var sec = (Date.now() - st.t0) / 1000;
      var step = sec < 12 ? 'מזהים את החדר בתמונה…' : sec < 45 ? 'מעצבים: ' + studioStyleLabel() + '…' : 'מלטשים פרטים אחרונים…';
      var pct = st.total ? Math.min(92, Math.round(((st.total - (st.pending || []).length) / st.total) * 80 + Math.min(12, sec / 10))) : Math.min(92, Math.round(sec / 1.8));
      return '<div class="sw-st-busy">' + (src ? '<img data-fb="sw-st-src" class="sw-st-src" ' + imgSrc(src, 800) + ' alt="" aria-hidden="true">' : '') + '<span class="sw-st-shim" aria-hidden="true"></span>' +
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
    return '<div class="sw-st-empty' + (src ? '' : ' is-blank') + '">' + (src ? '<img data-fb="sw-st-src" class="sw-st-src" ' + imgSrc(src, 800) + ' alt="' + esc(title(p)) + '">' : '') + (over ? '<div class="sw-st-over">' + over + '</div>' : '') + '</div>';
  }
  function studioStyleLabel() {
    if (st.comm) return st.bizLabel || 'העסק';
    var s_ = VIZ_STYLES.filter(function (x) { return x[0] === st.key; })[0];
    return s_ ? s_[1] : '';
  }
  /* ‏P1-K2: לשונית "✨ הדמיה" בנכס מסחרי - שתי ההדמיות האחרונות של אחרים (עסק אחד לכל חלל),
     עדיפות למה שנוצר לפי דרישה, וכפתור זהב לדף הנכס. בלי תאריכים, מונים או מי ביקש.
     שם העסק הוא טקסט חופשי של גולש/ת: נחתך ל-40, ולא מוצג אם יש בו רצף ספרות */
  function bizName(b) { b = String(b || '').trim(); return !b || /\d{5,}/.test(b) ? '' : (b.length > 40 ? b.slice(0, 39) + '…' : b); }
  function commShowcase(p) {
    var seen = {}, list = (vizMap.get(p.id) || []).slice()
      .sort(function (a, b) { return (a.base - b.base) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0); })
      .filter(function (v) { var k = bizKey(v.biz) + '|' + v.target; if (seen[k]) return false; seen[k] = 1; return true; })
      .slice(0, 2);
    var go = '<a class="sw-gold sw-wide sw-st-go" href="/property?id=' + encodeURIComponent(p.id) + '#viz">✨ יצירת הדמיה לעסק שלכם בדף הנכס ←</a>';
    if (!list.length) {
      return '<div class="sw-st-none"><h3 class="sw-sub-h">איך ייראה כאן העסק שלכם?</h3><p>מקלידים סוג עסק ומקבלים הדמיית AI של החלל</p>' + go + '</div>';
    }
    return '<div class="sw-st-recent">' + list.map(function (v) {
      var name = bizName(v.biz);
      return '<figure class="sw-st-item">' + (v.before ? baHtml({ before: v.before, after: v.after }, true, 'contain')
        : '<img class="sw-st-src is-only" ' + imgSrc(v.after, 800) + ' alt="הדמיית AI" loading="lazy">') +
        '<figcaption>' + (name ? '<b>' + esc(name) + '</b> · ' : '') + 'הדמיית AI</figcaption></figure>';
    }).join('') + '</div>' + go;
  }
  function renderStudio() {
    var box = $('swTabViz');
    if (!box || !st) return;
    if (st.comm) {
      box.innerHTML = '<p class="sw-st-head"><b>הדמיות עסקים בנכס</b></p>' + commShowcase(st.p);
      box.querySelectorAll('.sw-ba').forEach(function (b) { bindBa(b); });
      return;
    }
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
  function toast(msg, ms, actLabel, act) {
    var t = $('swToast');
    t.textContent = msg; t.hidden = false;
    if (actLabel) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sw-toast-act'; b.textContent = actLabel;
      b.addEventListener('click', function () { t.hidden = true; act(); });
      t.appendChild(document.createTextNode(' · ')); t.appendChild(b);
    }
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3200);
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
      var src = c.source === 'photo_request' ? 'photo_request' : 'swipe';
      req = post(INQUIRY_URL, { property_id: c.p.id, name: name, phone: phone, message: (msg ? msg + '\n' : '') + (line ? line + '\n' : '') + SOURCE_LINE + (fairLive(c.p) ? ' · ביריד הבתים הפתוחים' : ''), source: src })
        .then(function () { shukTrack('generate_lead', { form_id: src === 'photo_request' ? 'photo_request' : 'swipe_up', item_name: c.p.title || '', value: Number(c.p.price) || 0, currency: 'ILS' }); });
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
  /* הסרה מ"הרשימה שלי" אחרי אישור, עם "ביטול" בהודעה למשך 5 שניות (P0-9) */
  function unlike(id) {
    var at = likes.indexOf(id);
    if (at < 0) return;
    likes.splice(at, 1); saveLikes(); syncActions();
    toast('הנכס הוסר מהרשימה', 5000, 'ביטול', function () {
      if (likes.indexOf(id) < 0) { likes.splice(Math.min(at, likes.length), 0, id); saveLikes(); syncActions(); }
    });
  }
  /* ---------- ההרשמה ליריד (§4.3) ו"חושבים למכור?" (§5) - שתיהן בגיליון התחתון ---------- */
  function openFairSignup(via) {
    if (!window.FairSignup) { location.href = '/open-house#fairSignup'; return; }
    shukTrack('fair_signup_open', { via: via });
    bsOpen('fair_signup');
  }
  var SELLER_URL = SUPABASE_URL + '/functions/v1/owner-lead-intake';
  var SELLER_CONSENT = 'מאשרים שיועץ נדל״ן מטעם שוק הנדל״ן יחזור אליי בטלפון, בוואטסאפ או ב-SMS בעניין הנכס.';
  var SELLER_TYPES = ['דירה', 'בית פרטי / קוטג׳', 'דירת גן', 'פנטהאוז', 'מגרש', 'מסחרי'];
  var SELLER_WHEN = ['מיידי', 'בחצי שנה הקרובה', 'רק בודקים'];
  var sellerSent = false;
  function openSeller() { sellerSent = false; bsOpen('seller'); }
  function sellerHtml() {
    var places = (market && market.places) || [mainCity];
    var city = filter.area.indexOf('city:') === 0 ? filter.area.slice(5) : mainCity;
    var ch = function (q, v, on) { return '<button type="button" class="sw-chip" data-sq="' + q + '" data-v="' + esc(v) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(v) + '</button>'; };
    var rent = filter.deal === 'rent';
    return '<div class="sw-seller-sheet"><p class="sw-seller-gab"><img src="/assets/gabriela-avatar.webp" alt="" width="48" height="48" onerror="this.style.visibility=\'hidden\'">' +
      '<span>גבריאלה: כמה פרטים קצרים, ואעביר אותם ליועץ נדל״ן אחד מהאזור.</span></p>' +
      '<form class="sw-sform" id="swSellerForm" novalidate>' +
      '<fieldset><legend>מה תרצו לעשות?</legend><div class="sw-chips">' + ch('deal', 'למכור', !rent) + ch('deal', 'להשכיר', rent) + '</div></fieldset>' +
      '<fieldset><legend>סוג הנכס</legend><div class="sw-chips">' + SELLER_TYPES.map(function (t, i) { return ch('type', t, i === 0); }).join('') + '</div></fieldset>' +
      '<fieldset><legend>איפה הנכס?</legend><div class="sw-sel2"><label class="sw-field"><span>יישוב</span><select id="swSCity">' +
        places.map(function (c) { return '<option' + (c === city ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
        '<label class="sw-field"><span>שכונה (לא חובה)</span><select id="swSHood"><option value="">בלי שכונה</option></select></label></div><p class="sw-ferr" data-serr="city" role="alert"></p></fieldset>' +
      '<fieldset id="swSRooms"><legend>חדרים</legend><div class="sw-chips">' + ['2', '3', '4', '5', '6+'].map(function (r) { return ch('rooms', r, false); }).join('') + '</div></fieldset>' +
      '<fieldset><legend>מתי?</legend><div class="sw-chips">' + SELLER_WHEN.map(function (w) { return ch('timing', w, false); }).join('') + '</div></fieldset>' +
      '<label class="sw-field"><span>שם מלא</span><input id="swSName" autocomplete="name" required></label><p class="sw-ferr" data-serr="name" role="alert"></p>' +
      '<label class="sw-field"><span>טלפון</span><input id="swSPhone" type="tel" inputmode="tel" autocomplete="tel" required></label><p class="sw-ferr" data-serr="phone" role="alert"></p>' +
      '<p class="sw-consent"><input type="checkbox" id="swSConsent"><label for="swSConsent">' + esc(SELLER_CONSENT) + '</label></p><p class="sw-ferr" data-serr="consent" role="alert"></p>' +
      '<p class="sw-snote">הפרטים עוברים ליועץ נדל״ן אחד מהאזור, ולא מתפרסמים באתר.</p>' +
      '<p class="sw-ferr" data-serr="send" role="alert"></p>' +
      '<div class="sw-sbar"><button type="submit" class="sw-gold sw-wide" id="swSGo">שליחה ליועץ נדל״ן</button></div></form>' +
      '<div class="sw-sdone" hidden role="status"><p>תודה! יועץ נדל״ן מהאזור יחזור אליכם בהקדם.</p><button type="button" class="sw-navy sw-wide" data-sback>חזרה להחלקה</button></div></div>';
  }
  function bindSeller() {
    var box = $('swBsBody'), form = $('swSellerForm'), stepped = {};
    $('swBs').classList.add('is-tall', 'is-form');
    var hoods = function () {
      var sel = $('swSHood'), city = $('swSCity').value;
      sel.innerHTML = '<option value="">בלי שכונה</option>';
      if (!sb) return;
      sb.from('neighborhoods').select('id, name').eq('city', city).order('name').limit(200).then(function (r) {
        if ($('swSCity').value !== city) return;
        sel.innerHTML = '<option value="">בלי שכונה</option>' + ((r && r.data) || []).map(function (n_) { return '<option value="' + esc(n_.id) + '">' + esc(n_.name) + '</option>'; }).join('');
      }, function () {});
    };
    var syncRooms = function () {
      var t = box.querySelector('[data-sq="type"][aria-pressed="true"]');
      $('swSRooms').hidden = !!(t && (t.dataset.v === 'מגרש' || t.dataset.v === 'מסחרי'));
    };
    var step = function (q) { if (!stepped[q]) { stepped[q] = 1; shukTrack('seller_sheet_step', { q: q }); } };
    hoods();
    $('swSCity').addEventListener('change', function () { step('area'); hoods(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sq]');
      if (b) {
        step(b.dataset.sq);
        b.parentNode.querySelectorAll('[data-sq]').forEach(function (x) { if (x !== b) x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', b.dataset.sq === 'deal' || b.dataset.sq === 'type' ? 'true' : String(b.getAttribute('aria-pressed') !== 'true'));
        if (b.dataset.sq === 'type') syncRooms();
        return;
      }
      if (e.target.closest('[data-sback]')) bsClose();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = function (k, m) { box.querySelector('[data-serr="' + k + '"]').textContent = m || ''; };
      ['city', 'name', 'phone', 'consent', 'send'].forEach(function (k) { err(k, ''); });
      var city = $('swSCity').value, name = $('swSName').value.trim(), phone = $('swSPhone').value.replace(/\D/g, '');
      if (phone.indexOf('972') === 0) phone = '0' + phone.slice(3);
      var first = null;
      if (!city) { err('city', 'נא לבחור יישוב'); first = first || $('swSCity'); }
      if (name.length < 2) { err('name', 'נא להזין שם מלא'); first = first || $('swSName'); }
      if (!/^0?5\d{8}$/.test(phone)) { err('phone', 'נא להזין מספר טלפון תקין'); first = first || $('swSPhone'); }
      if (!$('swSConsent').checked) { err('consent', 'כדי לשלוח צריך לאשר שיחזרו אליכם'); first = first || $('swSConsent'); }
      if (first) { first.focus(); return; }
      var pick = function (q) { var x = box.querySelector('[data-sq="' + q + '"][aria-pressed="true"]'); return x ? x.dataset.v : ''; };
      var type = pick('type') || 'דירה', when = pick('timing'), rooms = $('swSRooms').hidden ? '' : pick('rooms');
      var body = { city: city, neighborhood_id: $('swSHood').value || null, property_type: type === 'מסחרי' ? 'מסחרי' : 'דירה', property_subtype: type,
        deal_type: pick('deal') === 'להשכיר' ? 'rent' : 'sale', rooms: rooms || null, name: name, phone: phone,
        note: (when ? 'תזמון: ' + when + ' · ' : '') + 'מקור: גלישה בהחלקה (חושבים למכור)',
        consent_contact: true, consent_text: SELLER_CONSENT, consent_version: 'seller-v1', source: 'swipe_seller' };
      var btn = $('swSGo'); btn.disabled = true;
      post(SELLER_URL, body).then(function () {
        sellerSent = true;
        store('sk_seller_sent', String(Date.now()));
        shukTrack('generate_lead', { form_id: 'swipe_seller' });
        form.hidden = true; box.querySelector('.sw-sdone').hidden = false;
        box.querySelector('[data-sback]').focus();
      }, function () { err('send', 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב'); }).then(function () { btn.disabled = false; });
    });
  }
  /* ---------- גיליון הכתבה (§6.3) - באותה מעטפת של גיליון הנכס ---------- */
  function openArticle(c, via) {
    var a = c.article;
    shukTrack('article_card_open', { article_id: String(a.id), via: via });
    if (!$('swTour').hidden) endTour(false);
    sheetCard = c; sheetOpener = document.activeElement; st = null;
    var out = [], n_ = 0;
    String(a.body || '').split('\n').map(function (t) { return t.trim(); }).filter(Boolean).some(function (t) {
      if (/:$/.test(t)) { out.push('<h3 class="sw-art-h">' + esc(t) + '</h3>'); return false; }
      out.push('<p>' + esc(t) + '</p>');
      return ++n_ >= 5;
    });
    $('swSheetBody').innerHTML = '<div class="sw-artsheet"><p class="sw-art-head" id="swSheetTitle">' + esc('מגזין שוק נדל״ן · ' + catLabel(a.category)) + '</p>' +
      '<div class="sw-art-cover">' + artCover(a, 'sw-art-cimg') + '</div>' +
      '<h2 class="sw-art-stitle">' + esc(a.title) + '</h2>' + (a.subtitle ? '<p class="sw-art-ssub">' + esc(a.subtitle) + '</p>' : '') +
      '<p class="sw-art-meta">' + esc(readTime(a)) + '</p><div class="sw-art-body">' + out.join('') + '</div>' +
      '<p class="sw-art-more"><a href="/article?slug=' + encodeURIComponent(a.slug || a.id) + '" data-art-full>להמשך קריאה ←</a></p>' +
      '<button type="button" class="sw-navy sw-wide" data-art-back>חזרה להחלקה</button></div>';
    $('swCtaBar').hidden = true;
    openDialog($('swSheet'));
    try { history.pushState({ swSheet: 1 }, ''); sheetPushed = true; } catch (e) { sheetPushed = false; }
  }
  $('swSheetBody').addEventListener('click', function (e) {
    if (e.target.closest('[data-art-back]')) { closeSheet(); return; }
    if (e.target.closest('[data-art-full]') && sheetCard && sheetCard.article) shukTrack('article_sheet_full_click', { article_id: String(sheetCard.article.id) });
  });
  var BS = {
    sort: { art: '', title: 'מיון', sub: '', body: function () {
      return '<div class="sw-chips sw-sort-chips" role="radiogroup" aria-label="מיון">' + SORTS.map(function (x) {
        return '<button type="button" class="sw-chip" role="radio" aria-checked="' + (x[0] === sortKey) + '" aria-pressed="' + (x[0] === sortKey) + '" data-sort="' + x[0] + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>';
    }, btns: [] },
    unlike: { art: '', title: 'להסיר את הנכס מהרשימה?', sub: '', btns: [['remove', 'sw-red', 'הסרה'], ['cancel', 'sw-white', 'ביטול']] },
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
    fair_signup: { art: '', title: 'דירה חדשה נכנסה ליריד? תדעו ראשונים.', sub: '', btns: [],
      body: function () {
        return window.FairSignup ? FairSignup.html({ where: 'swipe', places: (market && market.places) || [mainCity], deal: filter.deal === 'rent' ? 'rent' : 'sale',
          city: filter.area.indexOf('city:') === 0 ? filter.area.slice(5) : mainCity, noTitle: true }) : '';
      },
      onOpen: function () { $('swBs').classList.add('is-tall', 'is-form'); FairSignup.bind($('swBsBody'), { where: 'swipe', onBack: function () { bsClose(); } }); } },
    seller: { art: '', title: 'ספרו לנו על הנכס', sub: '', btns: [], body: sellerHtml, onOpen: bindSeller,
      onClose: function () { shukTrack('seller_sheet_close', { sent: sellerSent ? 1 : 0 }); } },
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
    var sub_ = (ctx && ctx.sub) || d.sub || '';
    $('swBsSub').textContent = sub_;
    $('swBsSub').hidden = !sub_;
    $('swBsBody').innerHTML = d.body ? d.body(ctx) : '';
    resetScroll($('swBs'));
    $('swBsBtns').innerHTML = d.btns.map(function (b) {
      return '<button type="button" class="' + b[1] + ' sw-bs-btn" data-bs-cta="' + b[0] + '">' + esc(b[2]) + '</button>';
    }).join('');
    wrap.hidden = false;
    document.body.classList.add('sw-locked');
    openStack.push(wrap);
    if (d.onOpen) d.onOpen(ctx);
    $('swBs').style.transform = '';
    var first = $('swBsBtns').querySelector('button');
    setTimeout(function () { if (first) first.focus({ preventScroll: true }); }, 40);
    shukTrack('swipe_nudge_view', { kind: kind });
    if (kind === 'help') shukTrack('swipe_help_open', {});
    setTimeout(reelSync, 0);
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
    if (BS[kind] && BS[kind].onClose) BS[kind].onClose(how);
    setTimeout(reelSync, 0);
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
      else if (cta === 'remove' && ctx && ctx.id) unlike(ctx.id);
      else if (cta === 'studio' && ctx && ctx.onStudio) ctx.onStudio();
      return;
    }
    var so = e.target.closest('[data-sort]');
    if (so) {
      sortKey = so.dataset.sort; syncSortBtn();
      shukTrack('swipe_sort', { sort: sortKey, view: view });
      bsClose(); buildDeck(); return;
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
        (ph.length ? '<img ' + imgSrc(likedViz(p.id) || ph[0], 240) + ' alt="" loading="lazy" width="112" height="84" data-fb="sw-liimg">' : window.NoPhoto ? '<span class="sw-liimg sw-np-thumb">' + npHtml(p, 'row') + '</span>' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-liimg')) +
        '<span class="sw-li-txt"><b>' + esc(fmtPrice(p)) + '</b><span>' + esc(title(p)) + '</span><small>' + esc(where(p)) + '</small></span></button>' +
        // ‏P0-9: הלב רק מסמן שהנכס שמור; ההסרה - כפתור ✕ אדום, עם אישור וביטול
        '<span class="sw-lv-heart" role="img" aria-label="שמור ברשימה">♥</span>' +
        '<button type="button" class="sw-lv-rm" data-like-remove="' + esc(p.id) + '" aria-label="הסרה מהרשימה שלי"><span aria-hidden="true">✕</span></button></div>';
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
      var rp = likedProps().filter(function (x) { return String(x.id) === rm.dataset.likeRemove; })[0];
      bsOpen('unlike', { id: rm.dataset.likeRemove, sub: rp ? title(rp) : '' });
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
  var map = null, mapReady = false, markers = null, lastView = 'deck', preLikes = 'deck';
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
    [['.leaflet-control-zoom-in', 'הגדלה'], ['.leaflet-control-zoom-out', 'הקטנה']].forEach(function (z) {
      var b = zoom.querySelector(z[0]); if (b) { b.setAttribute('aria-label', z[1]); b.title = z[1]; }
    });
    L.DomEvent.on(x, 'click', function (e) { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); setView(lastView === 'map' ? 'list' : lastView); });
    addTiles(map, tileFallback($('swMap'), $('swMapChip')));
    markers = L.layerGroup().addTo(map);
    map.on('zoomend', clusterDraw);
    var lg = L.DomUtil.create('div', 'sw-map-legend', $('swMap'));
    lg.id = 'swMapLegend'; lg.setAttribute('role', 'group'); lg.setAttribute('aria-label', 'סוגי עסקה במפה');
    L.DomEvent.disableClickPropagation(lg);
    lg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kind]');
      if (!b || b.dataset.kind === filter.deal) return;
      shukTrack('map_legend_toggle', { kind: b.dataset.kind, on: 1, view: 'swipe_map' });
      filter.deal = b.dataset.kind; filter.budget = 0; if (filter.deal === 'commercial') filter.rooms = 0;
      filter.type = '';   // סוג של עסקה אחת (דירה) מול אחרת (מסחרי) היה מוביל לאפס
      buildDeck(); renderFilter();
    });
    mapReady = true;
    drawMapMarkers();
  }
  $('swMapChipX').addEventListener('click', function () { $('swMapChip').hidden = true; $('swMapChip').dataset.closed = '1'; });
  function shortPrice(p) {
    var v = Number(p.price);
    if (!v) return 'לפי בקשה';
    return v >= 1000000 ? '₪' + (v / 1000000).toFixed(v % 1000000 ? 2 : 0).replace(/\.?0+$/, '') + 'M' : '₪' + v.toLocaleString('he-IL');
  }
  /* ‏P1-I: צבע קבוע לכל סוג עסקה (בורדו מכירה, נייבי השכרה, חום מסחרי), סימן שאינו צבע
     (‏"/חוד׳", אייקון חנות, ‏"/מ״ר"), מקרא שהוא מתג, ואשכולות במקום גלולות שנערמות */
  function dealKindOf(p) { return isComm(p) ? 'commercial' : p.deal_type === 'rent' ? 'rent' : 'sale'; }
  var KIND_LABEL = { sale: 'למכירה', rent: 'להשכרה', commercial: 'מסחרי' };
  var SHOP_ICON = '<svg class="sw-pin-ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6"/></svg>';
  function pinLabel(p) {
    var k = dealKindOf(p), v = Number(p.price);
    if (!v) return esc('לפי בקשה');
    if (k === 'rent') return esc('₪' + v.toLocaleString('he-IL') + '/חוד׳');
    if (k === 'commercial') return SHOP_ICON + esc(p.price_unit === 'sqm' ? '₪' + v.toLocaleString('he-IL') + '/מ״ר' : shortPrice(p));
    return esc(shortPrice(p));
  }
  var mapProps = [], mapFitted = false;
  function drawMapMarkers() {
    if (!mapReady) return;
    mapProps = deck.filter(function (c) { return c.slot === 'property' && c.p.lat && c.p.lng; });
    renderLegend();
    clusterDraw();
    /* ‏C10: המפה מתמקדת בתוצאות המסוננות. נקודה מחוץ לישראל, או רחוקה יותר
       מ-25 ק"מ מהחציון (קואורדינטות שגויות במסד), אינה מושכת את המפה לכל הארץ */
    var pts = mapProps.map(function (c) { return [+c.p.lat, +c.p.lng]; })
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
  /* אשכול: כל נקודה מצטרפת לאשכול שמרכזו (בפיקסלים, בזום הנוכחי) קרוב מ-48px, אחרת פותחת
     אשכול חדש. מצויר מחדש בכל zoomend */
  var CLUSTER_PX = 48;
  function clusterDraw() {
    if (!mapReady) return;
    markers.clearLayers();
    var z = map.getZoom(), groups = [];
    mapProps.forEach(function (c) {
      var pt = map.project([+c.p.lat, +c.p.lng], z), hit = null;
      for (var i = 0; i < groups.length && !hit; i++) {
        var g = groups[i];
        // הגלולה רחבה מגובהה (‏"₪990,000" עם אייקון), ולכן הרוחב שנבדק גדול יותר
        if (Math.abs(g.x - pt.x) < CLUSTER_PX * 1.75 && Math.abs(g.y - pt.y) < CLUSTER_PX * 0.75) hit = g;
      }
      if (!hit) { hit = { x: pt.x, y: pt.y, list: [] }; groups.push(hit); }
      hit.list.push(c);
      hit.x += (pt.x - hit.x) / hit.list.length; hit.y += (pt.y - hit.y) / hit.list.length;
    });
    // מרכז שזז כשנקודות מצטרפות יכול לנחות על אשכול שכן - מאחדים עד שאין שניים נוגעים
    for (var merged = true; merged;) {
      merged = false;
      for (var i = 0; i < groups.length && !merged; i++) for (var j = i + 1; j < groups.length && !merged; j++) {
        var a = groups[i], b = groups[j], big = a.list.length > 1 || b.list.length > 1;
        if (big && Math.abs(a.x - b.x) < CLUSTER_PX && Math.abs(a.y - b.y) < CLUSTER_PX) {
          var n = a.list.length + b.list.length;
          a.x = (a.x * a.list.length + b.x * b.list.length) / n; a.y = (a.y * a.list.length + b.y * b.list.length) / n;
          a.list = a.list.concat(b.list); groups.splice(j, 1); merged = true;
        }
      }
    }
    groups.forEach(function (gr) {
      var group = gr.list;
      if (group.length === 1 || z >= 17) { group.forEach(pinMarker); return; }
      var kinds = group.map(function (c) { return dealKindOf(c.p); }).filter(function (k, i, a) { return a.indexOf(k) === i; });
      var lat = 0, lng = 0;
      group.forEach(function (c) { lat += +c.p.lat; lng += +c.p.lng; });
      var cls = 'sw-cluster ' + (kinds.length === 1 ? 'is-' + kinds[0] : 'is-mixed');
      var label = group.length + ' נכסים' + (kinds.length === 1 ? ' ' + KIND_LABEL[kinds[0]] : '') + ', הגדלת המפה';
      var m = L.marker([lat / group.length, lng / group.length], { icon: L.divIcon({ className: '', iconSize: null,
        html: '<span class="' + cls + '">' + group.length + '</span>' }), keyboard: true, title: label }).addTo(markers);
      var el = m.getElement();
      if (el) el.setAttribute('aria-label', label);
      m.on('click', function () {
        shukTrack('map_cluster_click', { count: group.length, zoom: map.getZoom() });
        var b = L.latLngBounds(group.map(function (c) { return [+c.p.lat, +c.p.lng]; }));
        if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), 17);
        else map.fitBounds(b, { padding: [48, 48], maxZoom: 18 });
      });
    });
  }
  function pinMarker(c) {
    var k = dealKindOf(c.p);
    var m = L.marker([+c.p.lat, +c.p.lng], { icon: L.divIcon({ className: '', iconSize: null,
      html: '<span class="sw-pin is-' + k + (fairLive(c.p) ? ' is-nofee' : '') + '">' + pinLabel(c.p) + '</span>' }), keyboard: true }).addTo(markers);
    var el = m.getElement();
    if (el) el.setAttribute('aria-label', KIND_LABEL[k] + ', ' + (fairLive(c.p) ? NO_FEE + ', ' : '') + title(c.p) + ', ' + fmtPrice(c.p));
    m.on('click', function () {
      shukTrack('map_marker_open', { property_id: String(c.p.id), deal: k });
      openSheetFor(c);
    });
  }
  /* המקרא: שלושה מתגים עם מונה. בהחלקה הסינון מחזיק סוג עסקה אחד (‏filter.deal), ולכן
     לחיצה על סוג כבוי מחליפה אליו את הסינון ואת הכתובת, והסוג הדלוק אינו נכבה (ד-29) */
  function renderLegend() {
    var box = $('swMapLegend');
    if (!box) return;
    box.innerHTML = ['sale', 'rent', 'commercial'].map(function (k) {
      var n_ = countFor({ deal: k });
      if (!n_ && filter.deal !== k) return '';
      return '<button type="button" class="sw-lg is-' + k + '" data-kind="' + k + '" aria-pressed="' + (filter.deal === k) + '">' +
        '<i aria-hidden="true"></i>' + esc({ sale: 'מכירה', rent: 'השכרה', commercial: 'מסחרי' }[k]) + ' <b>' + n_ + '</b></button>';
    }).join('');
  }
  function renderList() {
    var props = deck.filter(function (c) { return c.slot === 'property'; });
    $('swListCount').textContent = props.length === 1 ? 'נכס אחד' : props.length + ' נכסים';
    var likedFirst = view === 'list' && listLikedOnly ? props.filter(function (c) { return likes.indexOf(c.p.id) >= 0; }) : props;
    // מכרטיס הגשר: רק הנכסים בלי תמונות
    if (view === 'list' && listNpOnly) likedFirst = likedFirst.filter(function (c) { return !hasPhoto(c.p); });
    $('swListCount').textContent = view === 'list' && listNpOnly ? (likedFirst.length === 1 ? 'נכס אחד' : likedFirst.length + ' נכסים') : $('swListCount').textContent;
    $('swList').innerHTML = likedFirst.map(function (c) {
      var p = c.p, ph = photos(p);
      if (!ph.length && window.NoPhoto) {
        return '<div class="sw-li sw-lv-row sw-li-np" data-pid="' + esc(p.id) + '"><button type="button" class="sw-lv-open" data-pos="' + c.pos + '"><span class="sw-liimg sw-np-thumb">' + npHtml(p, 'row') + '</span>' +
          '<span class="sw-li-txt"><b>' + esc(fmtPrice(p)) + '</b><span>' + esc(title(p)) + '</span><small>' + esc(where(p)) + '</small>' + rowLine(p) + '</span></button>' +
          '<button type="button" class="sw-np-req" data-np-req="' + c.pos + '">' + esc(NoPhoto.STR.ctaSm) + '</button></div>';
      }
      return '<button type="button" class="sw-li" data-pos="' + c.pos + '" data-pid="' + esc(p.id) + '">' +
        (ph.length ? '<img ' + imgSrc(likedViz(p.id) || ph[0], 240) + ' alt="" loading="lazy" width="112" height="84" data-fb="sw-liimg">' : imgFallback('').replace('sw-img-fb', 'sw-img-fb sw-liimg')) +
        '<span class="sw-li-txt"><b>' + esc(fmtPrice(p)) + '</b>' + (fairLive(p) ? '<i class="sw-li-nofee">' + esc(NO_FEE) + '</i>' : '') + '<span>' + esc(title(p)) + '</span><small>' + esc(where(p)) + '</small>' + rowLine(p) + '</span>' +
        (likes.indexOf(p.id) >= 0 ? '<span class="sw-li-heart" aria-label="שמור">♥</span>' : '') + '</button>';
    }).join('') || '<p class="sw-fnote">אין נכסים בסינון הזה.</p>';
  }
  var listLikedOnly = false, listNpOnly = false;
  /* ‏P1-F: בתצוגת שורות - שורה אחת: כותרת · כתובת · מחיר · חדרים · קומה · מ״ר */
  function rowLine(p) {
    var bits = [esc(title(p)), esc(where(p)), '<b>' + esc(fmtPrice(p)) + '</b>',
      rooms(p) ? esc(rooms(p) + ' חד׳') : '', p.floor != null && p.floor !== '' ? esc('קומה ' + p.floor) : '', p.size_sqm ? esc(p.size_sqm + ' מ״ר') : ''];
    return '<span class="sw-li-line">' + bits.filter(Boolean).join(' · ') + '</span>';
  }
  var listLayout = (function () {
    if (params.get('layout') === 'rows') return 'rows';
    try { return localStorage.getItem('sk_swipe_layout') === 'rows' ? 'rows' : 'grid'; } catch (e) { return 'grid'; }
  })();
  function applyLayout() {
    $('swList').classList.toggle('is-rows', listLayout === 'rows');
    document.querySelectorAll('.sw-layout [data-layout]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.layout === listLayout)); });
  }
  applyLayout();
  if (window.shukObserveList) shukObserveList($('swList'), 'swipe_list', function () { return listLayout; });
  document.querySelector('.sw-layout').addEventListener('click', function (e) {
    var b = e.target.closest('[data-layout]');
    if (!b || b.dataset.layout === listLayout) return;
    listLayout = b.dataset.layout;
    try { localStorage.setItem('sk_swipe_layout', listLayout); } catch (err) { /* מצב פרטי */ }
    applyLayout();
    writeUrl();
    shukTrack('swipe_list_layout', { layout: listLayout });
  });
  $('swList').addEventListener('click', function (e) {
    var rq = e.target.closest('[data-np-req]');
    if (rq) {
      var rc = deck.filter(function (x) { return String(x.pos) === rq.dataset.npReq; })[0];
      if (rc) npRequest(rc, window.NoPhoto ? NoPhoto.level(rc.p, npCtx(rc.p)) : 'c', 'row');
      return;
    }
    var b = e.target.closest('[data-pos]');
    if (!b) return;
    var c = deck.filter(function (x) { return String(x.pos) === b.dataset.pos; })[0];
    openSheetFor(c);
  });
  function likesReturnView() { return preLikes === 'map' || preLikes === 'list' ? preLikes : 'deck'; }
  function setView(v, likedOnly, npOnly) {
    if (v === 'likes' && view !== 'likes') preLikes = view;
    // ‏"אהבתי" אינה תצוגה שחוזרים אליה מהמפה (‏P0-E)
    if (v !== 'map' && v !== 'likes') lastView = v;
    else if (v === 'map' && view !== 'map' && view !== 'likes') lastView = view;
    view = v;
    document.body.dataset.view = v;
    listLikedOnly = !!likedOnly && v === 'list';
    listNpOnly = !!npOnly && v === 'list';
    document.querySelectorAll('.sw-views [data-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.view === v)); });
    $('swDeckView').hidden = v !== 'deck';
    $('swListView').hidden = v !== 'list';
    $('swMapView').hidden = v !== 'map';
    $('swLikesView').hidden = v !== 'likes';
    if (v === 'likes') $('swLikes').setAttribute('aria-current', 'page'); else $('swLikes').removeAttribute('aria-current');
    setTimeout(reelSync, 0);
    if (v === 'list') renderList();
    if (v === 'likes') { renderLikesView(); window.scrollTo(0, 0); }
    if (v === 'map') { initMap(); if (map) setTimeout(function () { map.invalidateSize(); drawMapMarkers(); }, 30); }
    if (v !== 'likes') writeUrl();
    /* ‏P1-G: "?" מסביר איך מחליקים - רק בהחלקה. visibility ולא display, כדי שהפס לא יקפוץ */
    var help = $('swHelp'), onDeck = v === 'deck';
    help.style.visibility = onDeck ? '' : 'hidden';
    if (onDeck) { help.removeAttribute('aria-hidden'); help.removeAttribute('tabindex'); }
    else { help.setAttribute('aria-hidden', 'true'); help.setAttribute('tabindex', '-1'); }
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
  $('swHelp').addEventListener('click', function () { if (view === 'deck') bsOpen('help'); });

  /* ‏P1-H: לכל כפתור שהוא אייקון בלבד - title זהה ל-aria-label (מקור אחד), כדי שבמחשב
     יופיע הסבר בריחוף. רק כשאין טקסט גלוי בכפתור; מתעדכן כשה-aria-label משתנה */
  function iconTitles(root) {
    (root || document).querySelectorAll('button[aria-label], a[aria-label], [role=button][aria-label]').forEach(function (b) {
      var l = b.getAttribute('aria-label');
      if (l && !(b.innerText || '').trim() && b.title !== l) b.title = l;
    });
  }
  iconTitles();
  if (window.MutationObserver) {
    var titleQueued = false;
    new MutationObserver(function () {
      if (titleQueued) return;
      titleQueued = true;
      requestAnimationFrame(function () { titleQueued = false; iconTitles(); });
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  }

  /* ---------- התחלה ---------- */
  // ‏P1-S: מי שנכנס/ה להחלקה פעם אחת - בלי נענוע לכפתור בדף הבית
  try { localStorage.setItem('sk_swipe_used', '1'); } catch (e) { /* מצב פרטי */ }
  var urlHasFilter = ['deal', 'area', 'rooms', 'budget', 'type', 'photos', 'fair', 'sort', 'view', 'hf'].some(function (k) { return params.has(k); });
  /* ‏P1-L: חזרה מדף נכס לרשימה - אותו נכס באותו מקום. נשמר ב-pagehide לפי הכתובת, עם עוגן
     (הנכס העליון שנראה) ולא רק פיקסלים, כי תמונות שעוד לא נטענו מזיזות את הגובה */
  var SCROLL_KEY = 'sk_sw_scroll';
  try { history.scrollRestoration = 'manual'; } catch (e) { /* דפדפן ישן */ }
  window.addEventListener('pagehide', function () {
    if (view !== 'list') return;
    var rows = document.querySelectorAll('#swList [data-pid]'), top = null;
    for (var i = 0; i < rows.length; i++) { var r = rows[i].getBoundingClientRect(); if (r.bottom > 80) { top = rows[i]; break; } }
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ key: location.pathname + location.search, y: window.scrollY,
        id: top ? top.dataset.pid : null, off: top ? Math.round(top.getBoundingClientRect().top) : 0 }));
    } catch (e) { /* אחסון חסום */ }
  });
  function restoreListScroll() {
    var m = null;
    try { m = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null'); } catch (e) { m = null; }
    if (!m || m.key !== location.pathname + location.search || view !== 'list') return;
    function go() {
      var el = m.id && document.querySelector('#swList [data-pid="' + (window.CSS && CSS.escape ? CSS.escape(m.id) : m.id) + '"]');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - m.off);
      else window.scrollTo(0, m.y);
    }
    go(); requestAnimationFrame(go); setTimeout(go, 400);
  }
  function cameBack() {
    try { var nav = performance.getEntriesByType('navigation')[0]; return !!nav && nav.type === 'back_forward'; } catch (e) { return false; }
  }
  readUrl();
  syncSortBtn();
  var urlDeal = params.get('deal');
  if (urlDeal === 'rent' || urlDeal === 'sale' || urlDeal === 'commercial') filter.deal = urlDeal;
  if (params.get('fair') === '1') filter.fair = true;
  renderLikes();
  document.body.dataset.view = 'deck';
  $('swDeck').innerHTML = '<div class="sw-loading" role="status">טוענים נכסים…</div>';
  function start() {
    load().then(function (rows) { return extReady.then(function () { initExt(rows); return rows; }); }).then(function (rows) {
      all = rows;
      /* ‏"הסינון לפני ההחלקה" רק בכניסה נקייה: כתובת שכבר נושאת סינון (‏reload, קישור
         מדף הבית) או חזרה ב"אחורה" מדף נכס - בלי גיליון שנפתח מעצמו (‏P0-C, ‏P1-L) */
      if (!urlHasFilter && !cameBack()) openFilter($('swSum'));
      buildDeck();
      var v0 = params.get('view');
      if (v0 === 'list' || v0 === 'map') setView(v0);
      if (cameBack()) restoreListScroll();
      loadViz(rows).then(function () {
        if (ext && ext.st.ai) buildDeck();   // ‏hf עם ai=1 - החפיסה אחרי שההדמיות ידועות
        renderFilter();
        // הכרטיס שעל המסך מקבל את שקופית ההדמיה שלו כשהזוג נטען, בלי לצייר אותו מחדש
        vizPrime();
      });
    });
  }
  if (window.supabase) start(); else window.addEventListener('load', start);
})();
