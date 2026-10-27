/* ---------------------------------------------------------------------------
 * ‏OwnerWizard - אשף הערכת השווי לבעלי נכסים (3 שלבים), רכיב אחד לשני דפים
 *
 * עד PR 1010 הוא חי כולו בדף הבית (הסימון ב-index.html והקוד ב-home.js). דף
 * "חושבים למכור?" (‏/sell, חלק 7 §B) משתמש בו כמו שהוא, ולכן הסימון והקוד
 * יצאו לכאן: שינוי באשף חל על שני הדפים יחד, ואין אשף שני שנפרד בשקט.
 *
 *   OwnerWizard.mount(root, cfg)   ‏root = ‎#ownerWizard‎ ריק; cfg:
 *     source      מזהה הווידג'ט ביומן הניתוב (‏homepage_owner_wizard / sell_page)
 *     city        העיר שנשלחת כשאין בחירה (ברירת מחדל: עפולה)
 *     cities      רשימת יישובים לבחירה בשלב 1 (‏/sell); בלי - בלי שדה
 *     extras      ‏/sell: "מתי מתכננים למכור?", "מתי נוח לדבר?" ואישור מפורש
 *     agentSlug() יועץ/ת שנבחר/ה מכרטיס בדף (‏sell_page_agent) - הליד אליו/ה
 *     onDone(res) אחרי שליחה מוצלחת
 *
 * השליחה היא fetch() טהור אל owner-lead-intake - בלי תלות ב-SDK, כך שהאשף
 * עובד גם אם סקריפט ה-CDN של supabase-js נכשל בטעינה.
 * ------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var URL_ = 'https://obookujgolazrwycsiyn.supabase.co/functions/v1/owner-lead-intake';
  var KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var DISCLAIMER = '* הערכת השווי ניתנת על ידי יועץ נדל״ן, ואינה מהווה תחליף לשומה של שמאי מקרקעין מוסמך.';
  var CONSENT = 'אני רוצה שיועץ נדל״ן מאומת באזור ייצור איתי קשר בטלפון או ב-WhatsApp בנוגע לנכס.';
  var CONDITION_LABELS = { renovated: 'משופץ', partly_renovated: 'משופץ חלקית', needs_renovation: 'דרוש שיפוץ' };
  var WHEN_SELL = ['מיד', 'בחודשים הקרובים', 'רק בודקים'];
  var esc = function (s) { return global.escapeHtml ? global.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function html(cfg) {
    var D = '<p class="wiz-disclaimer">' + DISCLAIMER + '</p>';
    var cityField = cfg.cities && cfg.cities.length
      ? '<label class="wiz-label" for="wizCity">יישוב</label><select id="wizCity" class="wiz-input wiz-select">' +
        cfg.cities.map(function (c) { return '<option' + (c === cfg.city ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>'
      : '';
    var extras = cfg.extras
      ? '<label class="wiz-label" for="wizTalk">מתי נוח לדבר? <span class="wiz-hint">(לא חובה)</span></label>' +
        '<input type="text" id="wizTalk" class="wiz-input" maxlength="60" placeholder="לדוגמה: בערב, אחרי 18:00">' +
        '<span class="wiz-label">מתי מתכננים למכור?</span><div class="owner-toggle owner-when" role="group" aria-label="מתי מתכננים למכור">' +
        WHEN_SELL.map(function (w) { return '<button type="button" data-owner-when="' + esc(w) + '">' + esc(w) + '</button>'; }).join('') + '</div>' +
        '<p class="wiz-consent"><input type="checkbox" id="wizConsent"><label for="wizConsent">' + esc(CONSENT) + ' <a href="/privacy" target="_blank">מדיניות פרטיות</a></label></p>'
      : '';
    return '<ol class="wiz-steps" id="wizSteps" aria-label="שלבי ההערכה">' +
      '<li class="active" data-step="1"><span class="dot">1</span>עסקה וכתובת</li>' +
      '<li data-step="2"><span class="dot">2</span>על הנכס</li>' +
      '<li data-step="3"><span class="dot">3</span>פרטי קשר</li></ol>' +
      '<form id="ownerWizardForm" novalidate>' +
      '<section class="wiz-panel active" data-panel="1"><p class="wiz-q">מה תרצו לעשות עם הנכס?</p>' +
      '<div class="owner-toggle"><button type="button" class="active" data-owner="sale">רוצה למכור</button><button type="button" data-owner="rent">רוצה להשכיר</button></div>' +
      '<div class="owner-toggle owner-kind" role="group" aria-label="סוג הנכס"><button type="button" class="active" data-owner-kind="residential">מגורים</button><button type="button" data-owner-kind="commercial">מסחרי</button></div>' +
      cityField +
      '<label class="wiz-label" for="wizAddress">כתובת מדויקת</label>' +
      '<input type="text" id="wizAddress" class="wiz-input" placeholder="לדוגמה: הרצל 24, עפולה" data-market-placeholder autocomplete="street-address">' +
      '<p class="wiz-err" id="wizErr1"></p><div class="wiz-nav"><button type="button" class="btn btn-gold" data-next="2">להמשך ←</button></div>' + D + '</section>' +
      '<section class="wiz-panel" data-panel="2"><p class="wiz-q">ספרו לנו על הנכס</p><div class="wiz-pair">' +
      '<div><label class="wiz-label" for="wizCondition">מצב הנכס</label><select id="wizCondition" class="wiz-input wiz-select" data-pick="condition">' +
      '<option value="" selected disabled>בחרו</option><option value="renovated">משופץ</option><option value="partly_renovated">משופץ חלקית</option><option value="needs_renovation">דרוש שיפוץ</option></select></div>' +
      '<div id="wizRoomsBox"><label class="wiz-label" for="wizRooms">מספר חדרים</label><select id="wizRooms" class="wiz-input wiz-select" data-pick="rooms">' +
      '<option value="" selected disabled>בחרו</option>' + ['2', '2.5', '3', '3.5', '4', '4.5', '5'].map(function (r) { return '<option value="' + r + '">' + r + '</option>'; }).join('') + '<option value="6">6+</option></select></div>' +
      '<div id="wizSubtypeBox" hidden><label class="wiz-label" for="wizSubtype">סוג הנכס</label><select id="wizSubtype" class="wiz-input wiz-select" data-pick="subtype">' +
      '<option value="" selected disabled>בחרו</option>' + ['משרד', 'חנות / שטח מסחרי', 'קליניקה', 'מבנה תעשייה', 'מחסן', 'אולם', 'אחר'].map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') + '</select></div></div>' +
      '<div id="wizSizeBox" hidden><label class="wiz-label" for="wizSize">שטח במ״ר (לא חובה)</label><input type="number" id="wizSize" class="wiz-input" inputmode="numeric" min="1" placeholder="לדוגמה: 120"></div>' +
      '<span class="wiz-label">מה יש בנכס?</span><div class="wiz-checks">' +
      '<label data-kind="residential"><input type="checkbox" value="ממ״ד"> ממ״ד</label><label data-kind="residential"><input type="checkbox" value="מרפסת"> מרפסת</label>' +
      '<label><input type="checkbox" value="מעלית"> מעלית</label><label><input type="checkbox" value="עמדת טעינה לרכב חשמלי"> עמדת טעינה לרכב חשמלי</label>' +
      '<label data-kind="commercial" hidden><input type="checkbox" value="חניה"> חניה</label><label data-kind="commercial" hidden><input type="checkbox" value="חזית לרחוב"> חזית לרחוב</label></div>' +
      '<p class="wiz-err" id="wizErr2"></p><div class="wiz-nav"><button type="button" class="btn btn-ghost-light" data-back="1">→ חזרה</button><button type="button" class="btn btn-gold" data-next="3">להמשך ←</button></div>' + D + '</section>' +
      '<section class="wiz-panel" data-panel="3"><p class="wiz-q">לאן נחזור אליכם?</p>' +
      '<label class="wiz-label" for="wizName">שם מלא</label><input type="text" id="wizName" class="wiz-input" autocomplete="name">' +
      '<label class="wiz-label" for="wizPhone">טלפון</label><input type="tel" id="wizPhone" class="wiz-input" placeholder="050-0000000" autocomplete="tel">' +
      extras +
      '<p class="wiz-err" id="wizErr3"></p><div class="wiz-nav"><button type="button" class="btn btn-ghost-light" data-back="2">→ חזרה</button>' +
      '<button type="submit" class="btn btn-gold" id="wizSubmitBtn">קבלת הערכת שווי חינם</button></div>' +
      (cfg.extras ? '<p class="wiz-note">הפרטים עוברים רק ליועץ נדל״ן אחד באזור שלכם.</p>' : '') + D + '</section></form>' +
      '<div class="wiz-done" id="wizDone" hidden><div class="wiz-done-mark" aria-hidden="true">✓</div>' +
      '<h3>' + (cfg.extras ? 'תודה! הפרטים נשלחו' : 'הפרטים נשלחו לבדיקה') + '</h3>' +
      '<p>יועץ נדל״ן מהאזור יחזור אליכם בזמן קצר עם הערכת המחיר לנכס.</p>' +
      '<button type="button" class="btn btn-ghost-light" id="wizRestart">שליחת נכס נוסף</button>' + D + '</div>';
  }

  function mount(root, cfg) {
    cfg = cfg || {};
    if (!root) return null;
    root.innerHTML = html(cfg);
    var $ = function (id) { return root.querySelector('#' + id); };
    var wizForm = $('ownerWizardForm'), wizDone = $('wizDone');
    var ownerHeadline = document.getElementById('ownerHeadline');
    var st = { deal: 'sale', kind: 'residential', address: '', condition: null, rooms: null, subtype: null, size: null, features: [], name: '', phone: '', when: '' };

    function setError(step, message) { $('wizErr' + step).textContent = message || ''; }
    function goToStep(n) {
      wizForm.querySelectorAll('.wiz-panel').forEach(function (p) { p.classList.toggle('active', Number(p.dataset.panel) === n); });
      root.querySelectorAll('#wizSteps li').forEach(function (li) {
        var s = Number(li.dataset.step);
        li.classList.toggle('active', s === n);
        li.classList.toggle('done', s < n);
      });
      if (cfg.onStep) cfg.onStep(n);
    }
    // כל הקלדה מנקה את השגיאה ואת סימון השדה, כדי שלא תישאר אדומה אחרי תיקון
    [['wizAddress', 1], ['wizName', 3], ['wizPhone', 3]].forEach(function (x) {
      $(x[0]).addEventListener('input', function (e) { e.target.classList.remove('invalid'); setError(x[1], ''); });
    });

    /* --- שלב 1: סוג עסקה + כתובת --- */
    root.querySelectorAll('.owner-toggle button[data-owner]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        st.deal = btn.dataset.owner;
        if (ownerHeadline) ownerHeadline.textContent = st.deal === 'sale' ? 'מוכר?' : 'משכיר?';
      });
    });
    /* מגורים או מסחרי. מסחרי מחליף בשלב 2 את החדרים בסוג הנכס ובשטח, ומחליף
       את המאפיינים של דירה (ממ״ד, מרפסת) בשל נכס מסחרי (חניה, חזית לרחוב).
       מה שסומן והוסתר יורד מהבחירה - אחרת חנות הייתה נשלחת עם "מרפסת". */
    function applyKind() {
      var commercial = st.kind === 'commercial';
      $('wizRoomsBox').hidden = commercial;
      $('wizSubtypeBox').hidden = !commercial;
      $('wizSizeBox').hidden = !commercial;
      wizForm.querySelectorAll('.wiz-checks label[data-kind]').forEach(function (l) {
        var off = l.dataset.kind !== st.kind;
        l.hidden = off;
        if (off) l.querySelector('input').checked = false;
      });
      st.features = [].map.call(wizForm.querySelectorAll('.wiz-checks input:checked'), function (i) { return i.value; });
      setError(2, '');
    }
    root.querySelectorAll('.owner-toggle button[data-owner-kind]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        st.kind = btn.dataset.ownerKind;
        applyKind();
      });
    });
    root.querySelectorAll('.owner-toggle button[data-owner-when]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        st.when = btn.dataset.ownerWhen;
      });
    });

    /* --- שלב 2: בחירה יחידה מרשימה (מצב הנכס, חדרים) ---
       ניקוי השגיאה מיד עם הבחירה, ולא רק בניסיון המעבר הבא */
    [['condition', 'condition'], ['rooms', 'rooms'], ['subtype', 'subtype']].forEach(function (x) {
      root.querySelectorAll('select[data-pick="' + x[0] + '"]').forEach(function (sel) {
        sel.addEventListener('change', function () { st[x[1]] = sel.value || null; setError(2, ''); });
      });
    });
    root.querySelectorAll('.wiz-checks input').forEach(function (cb) {
      cb.addEventListener('change', function () {
        st.features = [].map.call(root.querySelectorAll('.wiz-checks input:checked'), function (i) { return i.value; });
      });
    });

    /* --- ניווט בין השלבים, עם ולידציה לפני מעבר קדימה --- */
    wizForm.querySelectorAll('[data-next]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var from = Number(btn.closest('.wiz-panel').dataset.panel);
        if (!validateStep(from)) return;
        goToStep(Number(btn.dataset.next));
      });
    });
    wizForm.querySelectorAll('[data-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setError(Number(btn.closest('.wiz-panel').dataset.panel), '');
        goToStep(Number(btn.dataset.back));
      });
    });

    function validateStep(step) {
      if (step === 1) {
        var el = $('wizAddress');
        st.address = el.value.trim();
        if (st.address.length < 3) {
          setError(1, 'נא להזין כתובת מדויקת - רחוב ומספר');
          el.classList.add('invalid'); el.focus();
          return false;
        }
        el.classList.remove('invalid'); setError(1, '');
        return true;
      }
      if (step === 2) {
        var commercial = st.kind === 'commercial';
        var size = Number($('wizSize').value);
        st.size = commercial && size > 0 ? Math.round(size) : null;
        if (!st.condition) { setError(2, 'נא לבחור את מצב הנכס'); return false; }
        if (commercial && !st.subtype) { setError(2, 'נא לבחור את סוג הנכס'); return false; }
        if (!commercial && !st.rooms) { setError(2, 'נא לבחור מספר חדרים'); return false; }
        setError(2, '');
        return true;
      }
      if (step === 3) {
        var nameEl = $('wizName'), phoneEl = $('wizPhone');
        st.name = nameEl.value.trim();
        st.phone = phoneEl.value.trim();
        var digits = st.phone.replace(/\D/g, '');
        nameEl.classList.toggle('invalid', st.name.length < 2);
        phoneEl.classList.toggle('invalid', digits.length < 9);
        if (st.name.length < 2) { setError(3, 'נא להזין שם מלא'); nameEl.focus(); return false; }
        if (digits.length < 9) { setError(3, 'נא להזין מספר טלפון תקין'); phoneEl.focus(); return false; }
        if (cfg.extras && !$('wizConsent').checked) { setError(3, 'כדי לשלוח צריך לאשר שיועץ נדל״ן יחזור אליכם'); $('wizConsent').focus(); return false; }
        setError(3, '');
        return true;
      }
      return true;
    }

    /* --- שליחה --- */
    wizForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validateStep(3)) return;
      var btn = $('wizSubmitBtn'), label = btn.textContent;
      btn.textContent = 'שולח…';
      btn.disabled = true;
      var agentSlug = cfg.agentSlug ? cfg.agentSlug() : '';
      var talk = cfg.extras ? $('wizTalk').value.trim() : '';
      var body = {
        city: ($('wizCity') && $('wizCity').value) || cfg.city || 'עפולה',
        // ‏'מסחרי' ולא סוג המשנה: זה הערך שסוכנים מסמנים בהעדפות הלידים
        // (‏agent_lead_preferences), והניתוב משווה אליו. סוג המשנה והשטח
        // נכנסים לפרטי הנכס שהסוכן/ת רואה/ה בליד.
        property_type: st.kind === 'commercial' ? 'מסחרי' : 'דירה',
        property_subtype: st.kind === 'commercial' ? st.subtype : null,
        size_sqm: st.kind === 'commercial' ? st.size : null,
        deal_type: st.deal,
        address: st.address,
        rooms: st.kind === 'commercial' ? null : st.rooms,
        condition: CONDITION_LABELS[st.condition] || null,
        features: st.features,
        name: st.name,
        phone: st.phone,
        // מזהה הווידג'ט נשמר ביומן ניתוב הלידים (ראו docs/lead-routing.md)
        source: agentSlug ? cfg.source + '_agent' : cfg.source
      };
      if (agentSlug) body.agent_slug = agentSlug;
      if (cfg.extras) {
        body.note = [st.when ? 'מתי למכור: ' + st.when : '', talk ? 'נוח לדבר: ' + talk : ''].filter(Boolean).join('\n') || null;
        body.consent_contact = true;
        body.consent_text = CONSENT;
        body.consent_version = 'sell-v1';
      }
      fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY }, body: JSON.stringify(body) })
        .then(function (res) { return res.json().then(null, function () { return {}; }).then(function (d) { if (!res.ok) throw new Error(d.error || 'שגיאה'); return d; }); })
        .then(function (d) {
          wizForm.hidden = true;
          $('wizSteps').hidden = true;
          wizDone.hidden = false;
          if (global.shukTrack) global.shukTrack('generate_lead', { form_id: cfg.formId || 'owner_wizard' });
          if (cfg.onDone) cfg.onDone(d, body);
        }, function (err) {
          console.error('owner-lead-intake failed:', err);
          setError(3, 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב');
          btn.textContent = label;
          btn.disabled = false;
        });
    });

    $('wizRestart').addEventListener('click', function () {
      wizForm.reset();
      wizForm.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-checked', 'false'); });
      wizForm.querySelectorAll('.wiz-input').forEach(function (i) { i.classList.remove('invalid'); });
      [1, 2, 3].forEach(function (s) { setError(s, ''); });
      wizForm.querySelectorAll('[data-owner-when]').forEach(function (b) { b.classList.remove('active'); });
      st.address = ''; st.condition = null; st.rooms = null; st.subtype = null; st.size = null; st.features = []; st.name = ''; st.phone = ''; st.when = '';
      var btn = $('wizSubmitBtn');
      btn.textContent = 'קבלת הערכת שווי חינם';
      btn.disabled = false;
      wizDone.hidden = true;
      wizForm.hidden = false;
      $('wizSteps').hidden = false;
      goToStep(1);
    });

    return { goToStep: goToStep, focus: function () { $('wizAddress').focus({ preventScroll: true }); } };
  }

  global.OwnerWizard = { mount: mount, html: html, CONSENT: CONSENT };
})(window);
