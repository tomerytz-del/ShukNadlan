/* ---------------------------------------------------------------------------
 * ‏FairSignup - ההרשמה ליריד הבתים הפתוחים (‏PR 1010, חלק 5 §4.3)
 *
 * אותו טופס בדף ‏/open-house ובגיליון שבהחלקה (‏#swBs kind fair_signup), ולכן
 * הוא כאן ולא בכל אחד מהם: שני נוסחים של הסכמה הם שתי הסכמות שונות.
 *
 * ‏V2 כבוי עד שההצעה docs/proposals/fair_signup_and_lead_consent.sql
 * והפונקציות (‏saved-search-intake עם open_house_only) באוויר. כבוי - טופס
 * האימייל הקיים (‏open-house-subscribe), כמו בדף היום.
 *
 * שום דבר לא נשלח בלי לחיצה על הכפתור. בבדיקות - ‏fetch מדומה בלבד.
 * ------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var V2 = false;
  var BASE = 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/';
  var KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var C1 = 'מאשרים לקבל משוק הנדל״ן הודעות וואטסאפ, SMS ואימייל על דירות שנכנסות ליריד הבתים הפתוחים ומתאימות לי. אפשר להפסיק בכל רגע.';
  var C2 = 'מאשרים שיועץ נדל״ן מהאזור יחזור אליי לגבי דירות ביריד.';
  var BUDGET = {
    sale: [['עד ₪1.2 מיליון', null, 1200000], ['₪1.2-1.8 מיליון', 1200000, 1800000], ['₪1.8-2.5 מיליון', 1800000, 2500000], ['מעל ₪2.5 מיליון', 2500000, null], ['עוד לא יודעים', null, null]],
    rent: [['עד ₪4,000', null, 4000], ['₪4,000-6,000', 4000, 6000], ['מעל ₪6,000', 6000, null], ['עוד לא יודעים', null, null]]
  };
  var ROOMS = ['2', '3', '4', '5+'];
  var WHEN = ['מיידי', 'בחצי שנה הקרובה', 'רק בודקים'];
  var seq = 0;

  function esc(s) { return global.escapeHtml ? global.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shukTrack(name, p) { if (global.shukTrack) global.shukTrack(name, p || {}); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function post(fn, body) {
    return fetch(BASE + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(null, function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error((d && d.error) || 'http_' + r.status); e.code = d && d.error; throw e; } return d || {}; }); });
  }
  function chip(label, attrs, on) {
    return '<button type="button" class="fs-chip" aria-pressed="' + (on ? 'true' : 'false') + '" ' + attrs + '>' + esc(label) + '</button>';
  }
  /* טלפון נייד בישראל: 05XXXXXXXX, עם 972 או בלי האפס */
  function mobile(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.indexOf('972') === 0) d = '0' + d.slice(3);
    if (d.length === 9 && d[0] === '5') d = '0' + d;
    return /^05\d{8}$/.test(d) ? d : '';
  }

  /* העיצוב נוסע עם הטופס (שני דפים, תבנית אחת) ומוזרק פעם אחת - בלי בקשת CSS שחוסמת ציור */
  var CSS_TEXT = '.fs{display:flex;flex-direction:column;gap:10px;text-align:start;font-family:Heebo,system-ui,sans-serif;color:#1b1f2a}' +
    '.fs-title{margin:0;font-size:22px;font-weight:800;line-height:1.25;text-wrap:balance}@media(min-width:760px){.fs-title{font-size:32px}}' +
    '.fs-sub{margin:0;font-size:15px;line-height:1.55;color:#4a5060}' +
    '.fs-form{display:flex;flex-direction:column;gap:10px}.fs-form[hidden]{display:none}' +
    '.fs-q{margin:0;padding:0;border:0}.fs-q legend{margin:0 0 6px;padding:0;font-size:15px;font-weight:800}.fs-q small{font-weight:600;color:#4a5060}' +
    '.fs-chips{display:flex;flex-wrap:wrap;gap:8px}' +
    '.fs-chip{min-height:40px;padding:4px 14px;border:1.5px solid #0e2a6b;border-radius:999px;background:#fff;color:#0e2a6b;font:inherit;font-size:14.5px;font-weight:700;cursor:pointer}' +
    '.fs-chip[aria-pressed="true"]{background:#0e2a6b;color:#fff}' +
    '.fs-chip:focus-visible,.fs-go:focus-visible,.fs-back:focus-visible{outline:3px solid #c9a227;outline-offset:2px}' +
    '.fs-sel select{margin-top:8px;min-height:44px;padding:6px 10px;border:1.5px solid #d5dae6;border-radius:12px;font:inherit;font-size:16px;background:#fff;color:#1b1f2a}' +
    '.fs-field{display:flex;flex-direction:column;gap:4px;font-size:13.5px;font-weight:700;color:#4a5060}' +
    '.fs-field input{min-height:46px;padding:10px 12px;border:1.5px solid #d5dae6;border-radius:12px;font:inherit;font-size:16px;color:#1b1f2a;background:#fff}' +
    '.fs-field input:focus{outline:none;border-color:#0e2a6b;box-shadow:0 0 0 3px rgba(14,42,107,.12)}' +
    '.fs-check{display:flex;align-items:flex-start;gap:8px;margin:0;font-size:13.5px;line-height:1.5;color:#4a5060}' +
    '.fs-check input{width:20px;height:20px;margin-top:2px;flex:none;accent-color:#0e2a6b}.fs-check label{cursor:pointer}' +
    '.fs-err{margin:0;color:#b3261e;font-size:13.5px;font-weight:600}.fs-err:empty{display:none}' +
    '.fs-go{min-height:52px;border:0;border-radius:12px;background:#c9a227;color:#0d1b3d;font:inherit;font-size:16.5px;font-weight:800;cursor:pointer}' +
    '.fs-go:disabled{opacity:.6;cursor:default}' +
    '.fs-note{margin:0;font-size:13px;color:#4a5060;text-align:center}.fs-bot{margin:0;text-align:center}' +
    '.fs-done{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;border-radius:14px;background:#f6f1e7;text-align:center}.fs-done[hidden]{display:none}' +
    '.fs-done-t{margin:0;font-size:16px;font-weight:800;color:#0e2a6b}' +
    '.fs-back{min-height:48px;width:100%;border:0;border-radius:12px;background:#0e2a6b;color:#fff;font:inherit;font-size:15.5px;font-weight:800;cursor:pointer}' +
    '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}';
  function css() {
    if (document.getElementById('fsCss')) return;
    var st = document.createElement('style');
    st.id = 'fsCss'; st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  /* ctx: { where:'page'|'swipe', places:[...], deal:'sale'|'rent', city } */
  function html(ctx) {
    css();
    var id = 'fs' + (++seq), deal = ctx.deal === 'rent' ? 'rent' : 'sale';
    var title = '<h2 class="fs-title" id="' + id + 'T">דירה חדשה נכנסה ליריד? תדעו ראשונים.</h2>';
    if (!V2) {
      return '<div class="fs" data-fs="' + id + '" data-v="1">' + (ctx.noTitle ? '' : title) +
        '<p class="fs-sub">השאירו אימייל, ונשלח רק כשדירה חדשה נכנסת ליריד.</p>' +
        '<form class="fs-form" novalidate><label class="fs-field"><span>אימייל</span><input type="email" name="email" inputmode="email" autocomplete="email" required></label>' +
        '<p class="fs-err" data-err="email" role="alert"></p>' +
        '<button type="submit" class="fs-go">עדכנו אותי</button></form>' + doneHtml(ctx) + '</div>';
    }
    var places = (ctx.places || []).slice(), first = places.slice(0, 6), rest = places.slice(6);
    var pre = ctx.city && first.indexOf(ctx.city) >= 0 ? [ctx.city] : [];
    var q = function (k, label, body, req) {
      return '<fieldset class="fs-q" data-q="' + k + '"><legend>' + esc(label) + (req ? '' : ' <small>(לא חובה)</small>') + '</legend>' + body + '</fieldset>';
    };
    return '<div class="fs" data-fs="' + id + '" data-v="2" data-deal="' + deal + '">' + (ctx.noTitle ? '' : title) +
      '<p class="fs-sub">כמה שאלות קצרות, ונשלח רק דירות ביריד שמתאימות לכם.</p>' +
      '<form class="fs-form" novalidate>' +
      q('area', 'איפה מחפשים?', '<div class="fs-chips" data-multi="3">' + first.map(function (c) { return chip(c, 'data-city="' + esc(c) + '"', pre.indexOf(c) >= 0); }).join('') + '</div>' +
        (rest.length ? '<label class="fs-sel"><span class="sr-only">לפי יישוב</span><select data-city-sel><option value="">לפי יישוב ▾</option>' +
          rest.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' : '') +
        '<p class="fs-err" data-err="area" role="alert"></p>', true) +
      q('deal', 'מה מחפשים?', '<div class="fs-chips">' + chip('לקנות', 'data-deal="sale"', deal === 'sale') + chip('לשכור', 'data-deal="rent"', deal === 'rent') + '</div>') +
      q('budget', 'תקציב', '<div class="fs-chips" data-budget-box>' + budgetChips(deal, -1) + '</div>') +
      q('rooms', 'חדרים', '<div class="fs-chips" data-multi="4">' + ROOMS.map(function (r) { return chip(r, 'data-room="' + r + '"', false); }).join('') + '</div>') +
      q('timing', 'מתי?', '<div class="fs-chips">' + WHEN.map(function (w) { return chip(w, 'data-when="' + esc(w) + '"', false); }).join('') + '</div>') +
      '<label class="fs-field"><span>שם מלא</span><input name="name" autocomplete="name" required></label><p class="fs-err" data-err="name" role="alert"></p>' +
      '<label class="fs-field"><span>טלפון</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label><p class="fs-err" data-err="phone" role="alert"></p>' +
      '<label class="fs-field"><span>אימייל (לא חובה)</span><input name="email" type="email" inputmode="email" autocomplete="email"></label><p class="fs-err" data-err="email" role="alert"></p>' +
      '<p class="fs-check"><input type="checkbox" id="' + id + 'C1" name="c1"><label for="' + id + 'C1">' + esc(C1) + '</label></p><p class="fs-err" data-err="c1" role="alert"></p>' +
      '<p class="fs-check"><input type="checkbox" id="' + id + 'C2" name="c2"><label for="' + id + 'C2">' + esc(C2) + '</label></p>' +
      '<p class="fs-err" data-err="send" role="alert"></p>' +
      '<button type="submit" class="fs-go">הירשמו לעדכונים</button>' +
      '<p class="fs-note">בלי ספאם. רק דירות ביריד שמתאימות לחיפוש.</p>' +
      (global.ShukBot && global.ShukBot.anchorHtml ? '<p class="fs-bot">' + global.ShukBot.anchorHtml('הגעתי מהאתר ויש לי שאלה על יריד הבתים הפתוחים', 'יש שאלה? גבריאלה כאן', 'fs-botlink').replace('<a ', '<a data-bot-entry="open_house" ') + '</p>' : '') +
      '</form>' + doneHtml(ctx) + '</div>';
  }
  function budgetChips(deal, on) {
    return BUDGET[deal].map(function (b, i) { return chip(b[0], 'data-budget="' + i + '"', i === on); }).join('');
  }
  function doneHtml(ctx) {
    return '<div class="fs-done" hidden role="status"><span class="fs-done-ic" aria-hidden="true">' +
      (global.OpenHouse ? global.OpenHouse.icon({ size: 30 }) : '🏠') + '</span><p class="fs-done-t"></p>' +
      (ctx.where === 'swipe' ? '<button type="button" class="fs-back" data-fs-back>חזרה להחלקה</button>' : '') + '</div>';
  }

  function bind(root, ctx) {
    var box = root.querySelector('.fs');
    if (!box) return;
    var form = box.querySelector('form'), v2 = box.dataset.v === '2', stepped = {};
    var formId = ctx.where === 'swipe' ? 'swipe_fair' : 'nocommission_fair';
    function err(k, msg) { var e = box.querySelector('[data-err="' + k + '"]'); if (e) e.textContent = msg || ''; }
    function done(dup) {
      form.hidden = true;
      var d = box.querySelector('.fs-done');
      d.hidden = false;
      d.querySelector('.fs-done-t').textContent = dup ? 'אתם כבר ברשימה 🙂' : 'נרשמתם! נעדכן אתכם כשנכנסת דירה מתאימה ליריד.';
      store('sk_fair_signed', '1');
      var b = d.querySelector('button'); if (b) b.focus();
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.fs-chip');
      if (!b) { if (e.target.closest('[data-fs-back]') && ctx.onBack) ctx.onBack(); return; }
      var grp = b.parentNode, q = b.closest('[data-q]');
      if (q && !stepped[q.dataset.q]) { stepped[q.dataset.q] = 1; shukTrack('fair_signup_step', { q: q.dataset.q }); }
      var max = Number(grp.dataset.multi) || 0;
      if (max) {
        var on = b.getAttribute('aria-pressed') === 'true';
        if (!on && grp.querySelectorAll('[aria-pressed="true"]').length >= max) return;
        b.setAttribute('aria-pressed', String(!on));
      } else {
        var was = b.getAttribute('aria-pressed') === 'true';
        grp.querySelectorAll('.fs-chip').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', String(!was || !!b.dataset.deal));
      }
      if (b.dataset.deal) { box.dataset.deal = b.dataset.deal; box.querySelector('[data-budget-box]').innerHTML = budgetChips(b.dataset.deal, -1); }
      if (b.dataset.city) err('area', '');
    });
    var sel = box.querySelector('[data-city-sel]');
    if (sel) sel.addEventListener('change', function () {
      if (!sel.value) return;
      var grp = box.querySelector('[data-q="area"] .fs-chips');
      if (!grp.querySelector('[data-city="' + CSS.escape(sel.value) + '"]')) grp.insertAdjacentHTML('beforeend', chip(sel.value, 'data-city="' + esc(sel.value) + '"', false));
      var b = grp.querySelector('[data-city="' + CSS.escape(sel.value) + '"]');
      if (b.getAttribute('aria-pressed') !== 'true' && grp.querySelectorAll('[aria-pressed="true"]').length < 3) b.setAttribute('aria-pressed', 'true');
      sel.value = ''; err('area', '');
      if (!stepped.area) { stepped.area = 1; shukTrack('fair_signup_step', { q: 'area' }); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('.fs-go');
      ['area', 'name', 'phone', 'email', 'c1', 'send'].forEach(function (k) { err(k, ''); });
      var email = form.email.value.trim();
      if (!v2) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('email', 'נא להזין כתובת אימייל תקינה'); form.email.focus(); return; }
        btn.disabled = true;
        post('open-house-subscribe', { email: email, source: formId }).then(function () {
          shukTrack('generate_lead', { form_id: formId }); done(false);
        }, function () { err('email', 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב'); }).then(function () { btn.disabled = false; });
        return;
      }
      var cities = [].map.call(box.querySelectorAll('[data-q="area"] [aria-pressed="true"]'), function (b) { return b.dataset.city; });
      var name = form.name.value.trim(), phone = mobile(form.phone.value);
      var first = null;
      if (!cities.length) { err('area', 'נא לבחור לפחות יישוב אחד'); first = first || box.querySelector('[data-q="area"] .fs-chip') || sel; }
      if (name.length < 2) { err('name', 'נא להזין שם מלא'); first = first || form.name; }
      if (!phone) { err('phone', 'נא להזין מספר טלפון תקין'); first = first || form.phone; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('email', 'נא להזין כתובת אימייל תקינה'); first = first || form.email; }
      if (!form.c1.checked) { err('c1', 'כדי לשלוח צריך לאשר קבלת עדכונים'); first = first || form.c1; }
      if (first) { first.focus(); return; }
      var deal = box.dataset.deal === 'rent' ? 'rent' : 'sale';
      var bi = box.querySelector('[data-budget][aria-pressed="true"]'), bud = bi ? BUDGET[deal][Number(bi.dataset.budget)] : null;
      var rooms = [].map.call(box.querySelectorAll('[data-room][aria-pressed="true"]'), function (b) { return b.dataset.room; });
      var nums = rooms.map(function (r) { return parseInt(r, 10); });
      var when = box.querySelector('[data-when][aria-pressed="true"]');
      var body = {
        full_name: name, phone: phone, contact_channel: 'whatsapp', deal_type: deal, category: 'residential', cities: cities,
        min_price: bud ? bud[1] : null, max_price: bud ? bud[2] : null,
        min_rooms: nums.length ? Math.min.apply(null, nums) : null,
        max_rooms: nums.length && rooms.indexOf('5+') < 0 ? Math.max.apply(null, nums) : null,
        free_text: (when ? 'תזמון: ' + when.dataset.when + ' · ' : '') + 'מקור: יריד הבתים הפתוחים',
        consent_agent_contact: form.c2.checked, open_house_only: true, marketing_consent: true,
        consent_text: C1, consent_version: 'fair-v1', source: formId
      };
      if (email) body.email = email;
      btn.disabled = true;
      post('saved-search-intake', body).then(function (d) {
        // רשימת האימייל הקיימת ממשיכה לעבוד; כישלון שלה אינו מכשיל את ההרשמה
        if (email) post('open-house-subscribe', { email: email, source: formId }).catch(function () {});
        shukTrack('generate_lead', { form_id: formId });
        done(!!(d && d.duplicate));
      }, function () {
        err('send', 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב');
      }).then(function () { btn.disabled = false; });
    });
  }

  global.FairSignup = { V2: V2, C1: C1, C2: C2, html: html, bind: bind };
})(window);
