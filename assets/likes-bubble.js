/* ---------------------------------------------------------------------------
 * ‏"הרשימה שלי" מחוץ להחלקה (בקשת תומר 27.10, P1-10 בסבב התיקונים) - v10 בלבד.
 *
 * מי ששמר/ה נכס בהחלקה (‏localStorage.sk_swipe_likes) מקבל/ת בדפים הציבוריים
 * בועה עגולה בסגנון בועת גבריאלה: לב זהב (ד-15), טבעת זהב ומונה כחול. היא נכנסת
 * ל-#gabW ולכן נערמת מעל גבריאלה באותו צד (12px), עולה איתה מעל פס הקשר
 * הדביק בדף הנכס (‏--gw-bottom), ואינה פותחת פינה חדשה. בלי נכסים שמורים -
 * אין בועה, וב-/swipe היא לא נטענת (הגלולה "הרשימה שלי" כבר בראש המסך).
 *
 * נטען מ-assets/gabriela-widget.js. לחיצה פותחת את הרשימה (גיליון מלמטה
 * בטלפון, פאנל צד במחשב): פתיחת נכס, הסרה עם אישור ו"ביטול" ל-5 שניות,
 * ו"המשך גלישה בהחלקה". שום דבר לא נשלח - קריאה בלבד של הנכסים לפי מזהה.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  if (window.LikesBubble) return;
  var root = document.getElementById('gabW');
  if (!root) return;

  var URL_ = 'https://obookujgolazrwycsiyn.supabase.co/rest/v1/properties';
  var KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var esc = function (s) { return window.escapeHtml ? window.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var shukTrack = function (n, p) { if (window.shukTrack) window.shukTrack(n, p || {}); };
  function likes() { try { return (JSON.parse(localStorage.getItem('sk_swipe_likes') || '[]') || []).filter(Boolean); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem('sk_swipe_likes', JSON.stringify(list)); } catch (e) {} }

  var css = document.createElement('style');
  css.textContent =
    '#gabW .gw-likes{position:fixed;z-index:204;left:var(--gw-left);bottom:calc(var(--gw-bottom) + 68px);display:flex;align-items:center;gap:8px;' +
    '  height:56px;min-width:56px;padding:0;border:0;border-radius:999px;background:#fff;color:#a8841a;cursor:pointer;' +
    '  box-shadow:0 0 0 2.5px #c9a227,0 6px 16px rgba(14,42,107,.25);font-family:Heebo,system-ui,sans-serif;justify-content:center;transition:padding .25s ease}' +
    '#gabW .gw-likes .lk-h{font-size:24px;line-height:1}' +
    '#gabW .gw-likes .lk-n{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#0e2a6b;color:#fff;' +
    '  font-size:12px;font-weight:800;line-height:20px;text-align:center;box-sizing:border-box}' +
    '#gabW .gw-likes .lk-t{display:none;color:#0e2a6b;font-size:14.5px;font-weight:800;white-space:nowrap}' +
    '#gabW .gw-likes.is-pill{padding:0 16px}#gabW .gw-likes.is-pill .lk-t{display:inline}#gabW .gw-likes.is-pill .lk-n{display:none}' +
    '#gabW .gw-likes:focus-visible{outline:3px solid #c9a227;outline-offset:3px}' +
    '#gabW.is-min .gw-likes{bottom:calc(var(--gw-bottom) + 56px)}' +
    '@media(min-width:1024px){#gabW.is-v10:not(.is-min) .gw-likes{bottom:calc(var(--gw-bottom) + 76px)}}' +
    '#gabW.is-open .gw-likes{display:none}' +
    '.lk-wrap{position:fixed;inset:0;z-index:2000;font-family:Heebo,system-ui,sans-serif;direction:rtl}.lk-wrap[hidden]{display:none}' +
    '.lk-dim{position:absolute;inset:0;background:rgba(13,27,61,.3)}' +
    '.lk-panel{position:absolute;left:0;right:0;bottom:0;max-height:min(80dvh,640px);display:flex;flex-direction:column;background:#fff;color:#1b1f2a;' +
    '  border-radius:22px 22px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.18)}' +
    '@media(min-width:1024px){.lk-panel{left:auto;top:0;bottom:0;width:400px;max-height:none;border-radius:0}}' +
    '.lk-head{display:flex;align-items:center;gap:10px;padding:16px 18px 10px}' +
    '.lk-head h2{margin:0;font-size:22px;font-weight:800;color:#0e2a6b;flex:1}' +
    '.lk-x{width:44px;height:44px;border:1px solid #e3e8f2;border-radius:50%;background:#fff;color:#1b1f2a;font-size:16px;cursor:pointer}' +
    '.lk-list{flex:1;overflow:auto;overflow-anchor:none;padding:0 14px 8px;display:flex;flex-direction:column;gap:8px}' +
    '.lk-row{position:relative;display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #e3e8f2;border-radius:14px}' +
    '.lk-row a{display:flex;align-items:center;gap:10px;flex:1;min-width:0;color:inherit;text-decoration:none}' +
    '.lk-row img,.lk-ph{width:84px;height:64px;border-radius:10px;object-fit:cover;flex:none;background:#eef1f7}' +
    '.lk-row b{display:block;color:#0e2a6b;font-size:15px}.lk-row span{display:block;font-size:13.5px;color:#4a5060;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.lk-rm{position:relative;flex:none;width:32px;height:32px;border:0;border-radius:50%;background:#C62828;color:#fff;font-size:14px;cursor:pointer}' +
    '.lk-rm::before{content:"";position:absolute;inset:-6px}.lk-rm span{color:#fff !important;font-weight:800}' +
    '.lk-foot{padding:10px 14px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid #eef0f5}' +
    '.lk-go{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:12px;background:#0e2a6b;color:#fff;font-weight:800;font-size:16px;text-decoration:none}' +
    '.lk-confirm{position:absolute;inset:auto 0 0;padding:16px 18px calc(18px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid #e3e8f2;' +
    '  border-radius:18px 18px 0 0;box-shadow:0 -8px 24px rgba(0,0,0,.12);text-align:center}.lk-confirm[hidden]{display:none}' +
    '.lk-confirm h3{margin:0 0 4px;font-size:18px;font-weight:800}.lk-confirm p{margin:0 0 12px;color:#4a5060}' +
    '.lk-confirm div{display:flex;gap:10px}.lk-confirm button{flex:1;min-height:48px;border-radius:12px;font:800 15.5px Heebo,system-ui,sans-serif;cursor:pointer}' +
    '.lk-yes{border:0;background:#C62828;color:#fff}.lk-no{border:1.5px solid #0e2a6b;background:#fff;color:#0e2a6b}' +
    '.lk-toast{position:absolute;left:50%;bottom:90px;transform:translateX(-50%);display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:999px;' +
    '  background:#0d1b3d;color:#fff;font-size:14px;white-space:nowrap}.lk-toast[hidden]{display:none}' +
    '.lk-toast button{border:0;background:none;color:#e5c76a;font:800 14px Heebo,system-ui,sans-serif;text-decoration:underline;cursor:pointer;min-height:36px}' +
    '.lk-x:focus-visible,.lk-rm:focus-visible,.lk-go:focus-visible,.lk-confirm button:focus-visible,.lk-row a:focus-visible{outline:3px solid #c9a227;outline-offset:2px}';
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gw-likes';
  btn.innerHTML = '<span class="lk-h" aria-hidden="true">♥</span><span class="lk-n" aria-hidden="true"></span><span class="lk-t" aria-hidden="true"></span>';
  root.appendChild(btn);

  var wrap = document.createElement('div');
  wrap.className = 'lk-wrap';
  wrap.setAttribute('data-browse', 'likes');   // ‏P1-M: מקור החשיפה לנכס שנפתח מכאן
  wrap.hidden = true;
  wrap.innerHTML = '<div class="lk-dim" data-lk-close></div><div class="lk-panel" role="dialog" aria-modal="true" aria-labelledby="lkTitle">' +
    '<div class="lk-head"><h2 id="lkTitle">הרשימה שלי</h2><button type="button" class="lk-x" data-lk-close aria-label="סגירה"><span aria-hidden="true">✕</span></button></div>' +
    '<div class="lk-list" id="lkList"></div><div class="lk-foot"><a class="lk-go" href="/swipe">המשך גלישה בהחלקה</a></div>' +
    '<div class="lk-confirm" id="lkConfirm" hidden><h3>להסיר את הנכס מהרשימה?</h3><p id="lkConfirmT"></p>' +
    '<div><button type="button" class="lk-yes" id="lkYes">הסרה</button><button type="button" class="lk-no" id="lkNo">ביטול</button></div></div>' +
    '<p class="lk-toast" id="lkToast" role="status" hidden><span>הנכס הוסר מהרשימה</span><button type="button" id="lkUndo">ביטול</button></p></div>';
  document.body.appendChild(wrap);

  var props = {}, opener = null, pending = null, toastT = 0;
  function sync() {
    var n = likes().length;
    btn.hidden = !n;
    btn.querySelector('.lk-n').textContent = n;
    btn.querySelector('.lk-t').textContent = '♥ ' + n + ' · הרשימה שלי';
    // ‏P1-H: נוסח אחד לכל כפתורי הלב באתר
    btn.setAttribute('aria-label', 'הנכסים שאהבתי (' + n + ')'); btn.title = 'הנכסים שאהבתי (' + n + ')';
  }
  function price(p) {
    var v = Number(p.price);
    if (!v) return 'מחיר לפי בקשה';
    return '₪' + v.toLocaleString('he-IL') + (p.deal_type === 'rent' ? ' לחודש' : '');
  }
  function photo(p) {
    var u = Array.isArray(p.images) ? p.images.filter(function (x) { return typeof x === 'string' && /^(https?:\/\/|\/)/.test(x); })[0] : '';
    return u || '';
  }
  function render() {
    var ids = likes().slice().reverse();
    var rows = ids.map(function (id) { return props[id]; }).filter(Boolean);
    $('lkList').innerHTML = rows.length ? rows.map(function (p) {
      var ph = photo(p);
      return '<div class="lk-row"><a href="/property?id=' + encodeURIComponent(p.id) + '">' +
        (ph ? '<img src="' + esc(ph) + '" alt="" loading="lazy" width="84" height="64">' : '<span class="lk-ph" aria-hidden="true"></span>') +
        '<span><b>' + esc(price(p)) + '</b><span>' + esc(p.title || p.property_type || 'נכס') + '</span><span>' + esc([p.street, p.city].filter(Boolean).join(', ')) + '</span></span></a>' +
        '<button type="button" class="lk-rm" data-lk-rm="' + esc(p.id) + '" aria-label="הסרה מהרשימה שלי"><span aria-hidden="true">✕</span></button></div>';
    }).join('') : '<p>טוענים את הנכסים…</p>';
  }
  function $(id) { return document.getElementById(id); }
  function load() {
    var ids = likes().filter(function (id) { return /^[A-Za-z0-9-]{1,40}$/.test(id) && !props[id]; }).slice(0, 100);
    if (!ids.length) { render(); return; }
    fetch(URL_ + '?select=id,title,price,deal_type,property_type,city,street,images&status=eq.active&id=in.(' + ids.join(',') + ')',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        (rows || []).forEach(function (p) { props[p.id] = p; });
        // נכס שירד מהאתר יוצא מהרשימה בשקט (כמו בהחלקה)
        var gone = ids.filter(function (id) { return !props[id]; });
        if (gone.length && rows) { save(likes().filter(function (id) { return gone.indexOf(id) < 0; })); sync(); }
        render();
      }, function () { render(); });
  }
  function open() {
    opener = document.activeElement;
    wrap.hidden = false;
    shukTrack('likes_bubble_open', { count: likes().length });
    render(); load();
    // ‏P1-L: הפאנל נפתח בראש הרשימה; הסרה וביטול בתוכו (‏render) שומרים את המיקום
    $('lkList').scrollTop = 0;
    setTimeout(function () { var x = wrap.querySelector('.lk-x'); if (x) x.focus(); }, 30);
  }
  function close() {
    wrap.hidden = true; $('lkConfirm').hidden = true;
    if (opener && opener.focus) opener.focus();
    if (!likes().length) sync();
  }
  btn.addEventListener('click', open);
  wrap.addEventListener('click', function (e) {
    if (e.target.closest('[data-lk-close]')) { close(); return; }
    var rm = e.target.closest('[data-lk-rm]');
    if (rm) {
      pending = rm.dataset.lkRm;
      $('lkConfirmT').textContent = (props[pending] && (props[pending].title || props[pending].property_type)) || '';
      $('lkConfirm').hidden = false; $('lkNo').focus();
      return;
    }
    if (e.target.id === 'lkNo') { $('lkConfirm').hidden = true; pending = null; return; }
    if (e.target.id === 'lkYes' && pending) {
      var list = likes(), at = list.indexOf(pending), id = pending;
      if (at >= 0) { list.splice(at, 1); save(list); }
      pending = null; $('lkConfirm').hidden = true; sync(); render();
      var t = $('lkToast'); t.hidden = false; clearTimeout(toastT);
      toastT = setTimeout(function () { t.hidden = true; }, 5000);
      $('lkUndo').onclick = function () {
        var l2 = likes(); if (l2.indexOf(id) < 0) { l2.splice(Math.min(at, l2.length), 0, id); save(l2); }
        t.hidden = true; sync(); render();
      };
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !wrap.hidden) close(); });
  window.addEventListener('storage', function (e) { if (e.key === 'sk_swipe_likes') sync(); });

  sync();
  /* בפעם הראשונה בביקור: גלולה "♥ N · הרשימה שלי" לרגע, ואז עיגול */
  var seen = false;
  try { seen = sessionStorage.getItem('sk_likes_bubble_seen') === '1'; sessionStorage.setItem('sk_likes_bubble_seen', '1'); } catch (e) { seen = true; }
  if (!seen && likes().length && !window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
    btn.classList.add('is-pill');
    setTimeout(function () { btn.classList.remove('is-pill'); }, 2600);
  }
  window.LikesBubble = { sync: sync, open: open };
})();
