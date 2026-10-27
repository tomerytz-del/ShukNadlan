/* ==========================================================================
   NoPhoto - נכס בלי תמונות (v10, סבב 4 חלק 3). רק עם הדגל (‏html.beta-hero);
   בלעדיו כל דף ממשיך לצייר את ממלא־המקום הישן שלו, בייט בבייט.

   אחד לכל המשטחים: כרטיס ההחלקה (‏swipe), אריח (‏card), שורה דחוסה (‏row)
   והתא הראשי בדף הנכס (‏hero). שלוש רמות:
     A - תמונת שער (של המשרד, ואם אין - של הסוכן/ת) מטושטשת, ועליה אווטאר/לוגו
     B - אווטאר או לוגו על רקע כחול
     C - איור קו בזהב (גם מודעה פרטית, וגם כשכל התמונות נכשלו)
   תמונה שנכשלה בטעינה יורדת לבד, והרמה מחושבת מחדש - לעולם לא מסגרת ריקה.

   הסוכנים נטענים מ-agency_members_public: מי שכבר טען אותם מעביר ctx.agent,
   ואחרים - ‏NoPhoto.useClient(sb), ואז השורה משלימה את עצמה (MutationObserver).
   ‏show_photo_in_ads אינו ב-view הציבורי, ולכן אינו נבדק כאן (היום הוא true
   או null אצל כולם). docs/no-photo.md
   ========================================================================== */
(function (global) {
  'use strict';

  var STR = {
    title: 'עוד אין תמונות לנכס הזה',
    sub: 'המפרסם עדיין לא העלה תמונות. רוצים לראות? בקשו תמונות ישירות מהמפרסם',
    cta: 'בקשו תמונות מהמפרסם',
    ctaSm: 'בקשו תמונות',
    badge: 'אין תמונות',
    brand: 'שוק הנדל״ן',
    by: 'המפרסם של הנכס',
    toggle: 'רק נכסים עם תמונות',
    bridge: 'המשיכו לראות נכסים מתאימים בלי תמונות',
    bridgeSub: function (n) { return 'יש עוד ' + n + ' נכסים שעוד מחכים לתמונות, אולי אחד מהם בדיוק בשבילכם. המשיכו להחליק…'; },
    bridgeList: 'הצגה ברשימה',
    msg: function (t) { return 'היי, ראיתי את ' + t + ' בשוק הנדל״ן ואשמח לקבל תמונות של הנכס'; }
  };

  function on() { return document.documentElement.classList.contains('beta-hero'); }
  function esc(s) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function validUrl(u) {
    return typeof u === 'string' && (/^https?:\/\//i.test(u.trim()) || /^(\/(?!\/)|assets\/)/i.test(u.trim()));
  }
  function images(p) { return (p && Array.isArray(p.images) ? p.images : []).filter(validUrl); }
  function poster(p) { return p && validUrl(p.video_poster_url) ? p.video_poster_url : ''; }
  /* "יש תמונה" = תמונה תקינה ב-images, או פוסטר של סרטון (שהוא אז התמונה) */
  function hasPhoto(p) { return images(p).length > 0 || !!poster(p); }

  /* תמונה מוקטנת מהאחסון (‏render/image), כמו sized() ב-swipe.js ו-cardImgUrl ב-home.js */
  function sized(u, w) {
    var s = String(u || ''), marker = '/storage/v1/object/public/', at = s.indexOf(marker);
    if (at < 0) return s;
    var path = s.slice(at + marker.length).split(/[?#]/)[0];
    // תמיד resize=contain: ‏width לבדו חותך רצועה מהמרכז (חלק 6 §0)
    return path ? s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=' + w + '&resize=contain&quality=70' : s;
  }

  var agentCache = {};   // agent_id → שורה מ-agency_members_public (או null אם לא נמצא)
  function ctxOf(p, ctx) {
    ctx = ctx || {};
    var ag = ctx.agency || (p && p.agencies) || null;
    if (!ag && p && (p.agency_name || p.agency_logo)) ag = { name: p.agency_name, logo_url: p.agency_logo, cover_url: p.agency_cover || '' };
    var a = ctx.agent || (p && p.agent_id ? agentCache[p.agent_id] : null) || null;
    var priv = !!ctx.private || (!a && !(ag && ag.name) && !(p && p.agent_id));
    return { agent: a, agency: ag, private: priv };
  }
  function pick(c) {
    var ag = c.agency || {}, a = c.agent || {};
    return {
      cover: !c.private && (validUrl(ag.cover_url) ? ag.cover_url : validUrl(a.cover_url) ? a.cover_url : ''),
      photo: !c.private && validUrl(a.photo_url) ? a.photo_url : '',
      pos: a.photo_position || '50% 30%',
      logo: !c.private && validUrl(ag.logo_url) ? ag.logo_url : ''
    };
  }
  function level(p, ctx) {
    var c = ctxOf(p, ctx), k = pick(c);
    if (c.private) return 'c';
    if (k.cover && (k.logo || k.photo)) return 'a';
    if (k.logo || k.photo) return 'b';
    return 'c';
  }
  function whoLine(c) {
    if (c.private) return 'מודעה פרטית';
    var a = c.agent && c.agent.display_name, ag = c.agency && c.agency.name;
    return [a, ag].filter(Boolean).join(' · ');
  }

  var HOUSE = '<svg class="np-svg" viewBox="0 0 120 80" fill="none" stroke="#e5c76a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M8 74h104" opacity=".5"/><path d="M18 74V38l22-16 22 16v36" opacity=".5"/><path d="M33 74V54h14v20" opacity=".35"/>' +
    '<path d="M68 74V22h34v52" opacity=".35"/><path d="M76 32h6M88 32h6M76 44h6M88 44h6M76 56h6M88 56h6" opacity=".3"/><path d="M12 42l28-21 28 21" opacity=".45"/></svg>';
  var BRAND = '<span class="np-brand"><img src="/assets/logo-shuknadlan-dark.svg" alt="" width="20" height="24">' + esc(STR.brand) + '</span>';

  function avatar(k, size) {
    return '<span class="np-av" style="--np-av:' + size + 'px">' +
      (k.photo ? '<img class="np-photo" data-np="photo" src="' + esc(sized(k.photo, size * 2)) + '" alt="" style="object-position:' + esc(k.pos) + '">' : '') +
      (k.logo ? '<img class="np-logo" data-np="logo" src="' + esc(sized(k.logo, 96)) + '" alt="">' : '') +
      HOUSE + '</span>';
  }
  function bg(k, w) {
    return '<span class="np-bg" aria-hidden="true">' +
      (k.cover ? '<img class="np-cover" data-np="cover" src="' + esc(sized(k.cover, w)) + '" alt="">' : '') + '</span>';
  }
  function cls(lv, k, extra) {
    return 'np np-' + lv + (!k.photo && k.logo ? ' np-logo-solo' : '') + (extra ? ' ' + extra : '');
  }

  /* opts: { title, price, facts, where, href (לכרטיס/שורה: לאן "בקשו תמונות") } */
  function html(p, ctx, surface, opts) {
    opts = opts || {};
    var pst = poster(p);
    if (!images(p).length && pst) {
      return '<img class="np-poster" src="' + esc(sized(pst, surface === 'row' ? 240 : 800)) + '" alt="' + esc(opts.title || '') + '" loading="lazy">';
    }
    var c = ctxOf(p, ctx), k = pick(c), lv = level(p, ctx);
    var agentAttr = !c.private && p && p.agent_id && !c.agent ? ' data-np-agent="' + esc(p.agent_id) + '"' : '';
    var data = ' data-np-level="' + lv + '" data-np-surface="' + surface + '"' + agentAttr;
    var who = whoLine(c);
    var href = opts.href || ('/property?id=' + encodeURIComponent((p && p.id) || '') + '#contact&ask=photos');
    if (surface === 'row') {
      return '<div class="' + cls(lv, k, 'np-row') + '"' + data + '>' + bg(k, 240) + avatar(k, 44) +
        '<span class="np-badge">' + esc(STR.badge) + '</span></div>';
    }
    if (surface === 'card') {
      return '<div class="' + cls(lv, k, 'np-card') + '"' + data + '>' + bg(k, 600) + BRAND +
        '<div class="np-card-in">' + avatar(k, 56) + '<div class="np-txt"><p class="np-t">' + esc(STR.title) + '</p>' +
        '<p class="np-s">' + esc(STR.sub) + '</p>' +
        '<a class="np-link" data-np-cta data-surface="card" data-level="' + lv + '" data-pid="' + esc((p && p.id) || '') + '" href="' + esc(href) + '">' + esc(STR.cta) + ' ←</a></div></div></div>';
    }
    if (surface === 'hero') {
      return '<div class="' + cls(lv, k, 'np-hero') + '"' + data + '>' + bg(k, 1200) + BRAND +
        '<div class="np-hero-in"><div class="np-msg"><h2 class="np-t">' + esc(STR.title) + '</h2><p class="np-s">' + esc(STR.sub) + '</p>' +
        '<div class="np-btns"><button type="button" class="np-gold" data-np-cta data-surface="hero" data-level="' + lv + '">' + esc(STR.cta) + '</button>' +
        '<button type="button" class="np-under" data-np-contact>יצירת קשר עם המפרסם</button></div></div>' +
        '<div class="np-agent">' + avatar(k, 112) + '<p class="np-name">' + esc(c.private ? 'מודעה פרטית' : (c.agent && c.agent.display_name) || (c.agency && c.agency.name) || '') + '</p>' +
        (!c.private && c.agent && c.agency && c.agency.name ? '<p class="np-ag">' + esc(c.agency.name) + '</p>' : '') +
        '<p class="np-by">' + esc(STR.by) + '</p></div></div>' +
        (opts.facts || opts.where ? '<div class="np-facts">' + (opts.facts ? '<span>' + esc(opts.facts) + '</span>' : '') + (opts.where ? '<span>📍 ' + esc(opts.where) + '</span>' : '') + '</div>' : '') +
        '</div>';
    }
    // swipe: אווטאר, ושכבת זכוכית עם הכותרת והכפתור. החלק התחתון (מחיר, כותרת, פרטים) נשאר של הכרטיס
    return '<div class="' + cls(lv, k, 'np-swipe') + '"' + data + '>' + bg(k, 800) + BRAND +
      '<div class="np-swipe-in">' + avatar(k, 92) + (who ? '<p class="np-who">' + esc(who) + '</p>' : '') +
      '<div class="np-glass"><p class="np-t">' + esc(STR.title) + '</p><p class="np-s">' + esc(STR.sub) + '</p>' +
      '<button type="button" class="np-gold np-wide" data-np-cta data-surface="swipe" data-level="' + lv + '">' + esc(STR.cta) + '</button></div></div></div>';
  }

  /* תמונה שנכשלה: רק היא יורדת, והרמה מחושבת מחדש (A בלי שער = B, ובלי אווטאר ולוגו = C) */
  function relevel(box) {
    var cover = box.querySelector('[data-np=cover]'), photo = box.querySelector('[data-np=photo]'), logo = box.querySelector('[data-np=logo]');
    var lv = (cover && (photo || logo)) ? 'a' : (photo || logo) ? 'b' : 'c';
    box.classList.remove('np-a', 'np-b', 'np-c');
    box.classList.add('np-' + lv);
    box.classList.toggle('np-logo-solo', !photo && !!logo);
    box.setAttribute('data-np-level', lv);
    box.querySelectorAll('[data-np-cta]').forEach(function (b) { b.setAttribute('data-level', lv); });
  }
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-np')) return;
    var box = t.closest('.np');
    t.remove();
    if (box) relevel(box);
  }, true);

  /* "בקשו תמונות" באריח הוא קישור לדף הנכס (‏#contact&ask=photos). הלחיצה נעצרת כאן,
     ב-capture, כדי שהאריח עצמו (שמנווט לדף הנכס בלי ה-hash) לא יקדים אותו */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-np-cta]');
    if (!a) return;
    e.stopPropagation();
    if (global.shukTrack) global.shukTrack('photo_request', { property_id: a.getAttribute('data-pid') || '', level: a.getAttribute('data-level') || 'c', surface: a.getAttribute('data-surface') || 'card' });
  }, true);

  /* שורות שנוצרו בלי פרטי הסוכן/ת: נשלפים פעם אחת לכל מזהה, והשורה משלימה את עצמה */
  var client = null, pending = {}, flushT = 0;
  function hydrateBox(box) {
    var id = box.getAttribute('data-np-agent'), a = agentCache[id];
    box.removeAttribute('data-np-agent');
    if (!a) return;
    var av = box.querySelector('.np-av'), size = av ? parseInt(av.style.getPropertyValue('--np-av'), 10) || 56 : 56;
    if (av && validUrl(a.photo_url) && !av.querySelector('[data-np=photo]')) {
      av.insertAdjacentHTML('afterbegin', '<img class="np-photo" data-np="photo" src="' + esc(sized(a.photo_url, size * 2)) + '" alt="" style="object-position:' + esc(a.photo_position || '50% 30%') + '">');
    }
    var bgEl = box.querySelector('.np-bg');
    if (bgEl && !bgEl.querySelector('[data-np=cover]') && validUrl(a.cover_url)) {
      bgEl.innerHTML = '<img class="np-cover" data-np="cover" src="' + esc(sized(a.cover_url, 800)) + '" alt="">';
    }
    var who = box.querySelector('.np-who, .np-name');
    if (who && a.display_name && !who.textContent) who.textContent = a.display_name;
    relevel(box);
  }
  function hydrate(root) {
    if (!client || !on()) return;
    var boxes = (root || document).querySelectorAll('.np[data-np-agent]'), ask = [];
    boxes.forEach(function (b) {
      var id = b.getAttribute('data-np-agent');
      if (id in agentCache) hydrateBox(b);
      else if (!pending[id]) { pending[id] = 1; ask.push(id); }
    });
    if (!ask.length) return;
    client.from('agency_members_public').select('id, display_name, photo_url, photo_position, cover_url').in('id', ask)
      .then(function (r) {
        ask.forEach(function (id) { agentCache[id] = null; delete pending[id]; });
        ((r && r.data) || []).forEach(function (a) { agentCache[a.id] = a; });
        document.querySelectorAll('.np[data-np-agent]').forEach(function (b) { if (b.getAttribute('data-np-agent') in agentCache) hydrateBox(b); });
      }, function () { ask.forEach(function (id) { delete pending[id]; }); });
  }
  function useClient(sb) {
    if (!sb || client) return;
    client = sb;
    hydrate(document);
    if (global.MutationObserver) {
      new MutationObserver(function () { clearTimeout(flushT); flushT = setTimeout(function () { hydrate(document); }, 60); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }
  function setAgents(list) { (list || []).forEach(function (a) { if (a && a.id) agentCache[a.id] = a; }); }

  /* הסגנונות נטענים רק עם הדגל, ולכן אינם חוסמים ציור בדפים שבלעדיו */
  if (on() && !document.querySelector('link[data-np-css]')) {
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/assets/no-photo.css'; l.setAttribute('data-np-css', '');
    document.head.appendChild(l);
  }

  global.NoPhoto = { on: on, hasPhoto: hasPhoto, poster: poster, level: level, html: html, hydrate: hydrate, useClient: useClient, setAgents: setAgents, STR: STR };
})(window);
