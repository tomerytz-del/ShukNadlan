/* ============================================================================
   באנר מחפשי הנכס שבראש הפוטר — ההתנהגות
   ----------------------------------------------------------------------------
   אשף בן שלושה שלבים ששומר חיפוש: מה מחפשים, מאפייני הנכס, ולאן לחזור.
   היעד הוא ‎saved-search-intake‎ של הסוכן החכם (ראו docs/smart-search-agent.md)
   ולא endpoint משלו — מה שנשמר כאן הוא בדיוק חיפוש שמור, וטבלה שנייה לאותו
   דבר הייתה מפצלת גם את ההתראות וגם את מדף הלידים.

   הקובץ עצמאי לחלוטין, בדיוק כמו site-footer.js: הוא מחזיק את כתובת הפרויקט
   ואת המפתח הציבורי בעצמו, קורא את השכונות ב-REST ולא דרך supabase-js (רוב
   העמודים הציבוריים אינם טוענים אותו), ואינו נשען על שום משתנה של הדף
   המארח. שלוש שורות ב-HTML — הבאנר, הקובץ הזה וה-CSS שלו — ודי בכך.

   ‏data-source על הבאנר אומר מאיזה עמוד הגיע החיפוש; ערך לא מוכר נדחה
   בפונקציה עצמה ונרשם כברירת המחדל.

   הסקריפט נטען עם ‎defer‎, כלומר אחרי שה-DOM מוכן. אם הבאנר לא קיים בדף —
   הוא יוצא מיד. העמודים שכבר נושאים אשף משלהם (‏index, agency, agent) אינם
   טוענים אותו, כדי שלא יהיו שני ‎#buyerBanner‎ באותו מסמך.
   ============================================================================ */
(function () {
  'use strict';

  var banner = document.getElementById('buyerBanner');
  var form = document.getElementById('buyerWizardForm');
  if (!banner || !form) return;

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var INTAKE_URL = SUPABASE_URL + '/functions/v1/saved-search-intake';
  var HOODS_URL = SUPABASE_URL + '/rest/v1/neighborhoods?select=id,name';

  /* סוגי הנכס — אותן רשימות של דף הבית, כדי שחיפוש שנשמר מכאן ייקרא מול
     אותם ערכים שהנכסים עצמם נושאים. */
  var RESIDENTIAL_PTYPES = [
    'דירה','דירת גן','גג/פנטהאוז','דופלקס','מרתף/פרטר','טריפלקס','יחידת דיור','סטודיו/לופט',
    'בית פרטי/קוטג\'','דו משפחתי','משק חקלאי/נחלה','משק עזר',
    'מגרש','בניין מגורים','מחסן','חניה','קב\' רכישה/זכות לנכס'
  ];
  var COMMERCIAL_PTYPES = [
    'משרדים','חנויות/שטח מסחרי','מבני תעשייה','אולמות','חלל עבודה משותף','בניין משרדים',
    'מגרשים','מחסנים','סטודיו','כללי','מרתף','חניון','בית מלון','קליניקות'
  ];
  var DEAL_LABELS = { sale:'לקנייה', rent:'להשכרה' };

  var hoods = { rows:[], byId:new Map() };
  var state = {
    deal:'sale',            // 'sale' | 'rent'  — מה שנשמר ב-deal_type
    category:'residential', // 'residential' | 'commercial'
    hoods:new Set(),
    rooms:new Set(),
    ptypes:new Set(),
    channel:'whatsapp',
    source: banner.dataset.source || 'footer_buyer_wizard'
  };

  var $ = function (id) { return document.getElementById(id); };
  var doneEl = $('buyDone');
  var nis = function (n) { return Number(n).toLocaleString('he-IL'); };
  var setError = function (step, message) { $('buyErr' + step).textContent = message || ''; };

  /* ---------- פתיחה וסגירה של הבאנר ----------
     הבאנר נטען מקופל — שורת הזמנה אחת — ונפרס בלחיצה. אשף פרוס בכל עמוד
     היה גוזל גובה מסך ממי שבא לקרוא את העמוד עצמו. */
  var teaser = $('buyerStartBtn');
  var panel = $('buyerPanel');
  teaser.addEventListener('click', function () {
    var open = banner.classList.toggle('is-open');
    panel.hidden = !open;
    teaser.setAttribute('aria-expanded', String(open));
    if (open) goToStep(1);
  });

  /* ---------- השלבים ---------- */
  function goToStep(n) {
    form.querySelectorAll('.wiz-panel').forEach(function (p) {
      p.classList.toggle('active', Number(p.dataset.panel) === n);
    });
    document.querySelectorAll('#buySteps li').forEach(function (li) {
      var step = Number(li.dataset.step);
      li.classList.toggle('active', step === n);
      li.classList.toggle('done', step < n);
    });
    if (n === 3) renderRecap();
  }

  /* ---------- שלב 1: אזור ----------
     רשימת השכונות נקראת מאותה טבלה שמזינה את סינון המפה בדף הבית. היא
     מגיעה אחרי שהדף כבר עומד, ולכן הרצועה נבנית מחדש כשהיא מגיעה.
     ‏textContent ולא innerHTML: שמות שכונות מוזנים על ידי משתמשי הפלטפורמה. */
  function renderHoods() {
    var wrap = $('buyHoodChips');
    var fallback = $('buyAreaFallback');
    var label = $('buyHoodLabel');
    if (!wrap) return;
    wrap.textContent = '';

    // בלי רשימת שכונות (מסד לא זמין) נשארת תיבת טקסט חופשי — שלב בלי שום
    // דרך לציין אזור הוא שלב מיותר. השאלה "באילו שכונות?" יורדת איתה, כדי
    // שלא תישאל שאלה שאין מתחתיה מה לענות.
    if (!hoods.rows.length) {
      if (fallback) fallback.hidden = false;
      if (label) label.hidden = true;
      return;
    }
    if (fallback) fallback.hidden = true;
    if (label) label.hidden = false;

    hoods.rows.slice()
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'he'); })
      .forEach(function (h) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.hoodId = h.id;
        chip.setAttribute('aria-pressed', state.hoods.has(h.id) ? 'true' : 'false');
        chip.textContent = h.name;
        chip.addEventListener('click', function () {
          var on = chip.getAttribute('aria-pressed') === 'true';
          chip.setAttribute('aria-pressed', String(!on));
          if (on) state.hoods.delete(h.id); else state.hoods.add(h.id);
          setError(1, '');
        });
        wrap.appendChild(chip);
      });
  }

  fetch(HOODS_URL, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (rows) {
      hoods.rows = Array.isArray(rows) ? rows : [];
      hoods.byId = new Map(hoods.rows.map(function (h) { return [h.id, h]; }));
      renderHoods();
    })
    .catch(function (err) {
      console.warn('טעינת השכונות לבאנר נכשלה:', err);
      renderHoods();   // ‏רשימה ריקה = תיבת הטקסט החופשי, ולא שלב מת
    });

  /* ---------- שלב 2: סוגי הנכס ----------
     תלויים בקטגוריה, ולכן נבנים מחדש בכל החלפה שלה. הבחירה הקודמת נמחקת
     ולא "נשמרת ליתר ביטחון": משרד שנבחר ואז עברו למגורים היה נשלח עם חיפוש
     דירות ומסנן אותו לאפס תוצאות. */
  function renderPtypes() {
    var wrap = $('buyPtypeChips');
    if (!wrap) return;
    var list = state.category === 'commercial' ? COMMERCIAL_PTYPES : RESIDENTIAL_PTYPES;
    wrap.textContent = '';
    list.forEach(function (name) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('aria-pressed', state.ptypes.has(name) ? 'true' : 'false');
      chip.textContent = name;
      chip.addEventListener('click', function () {
        var on = chip.getAttribute('aria-pressed') === 'true';
        chip.setAttribute('aria-pressed', String(!on));
        if (on) state.ptypes.delete(name); else state.ptypes.add(name);
        setError(2, '');
      });
      wrap.appendChild(chip);
    });
  }

  /* מה שמשתנה עם סוג העסקה: הצעות סוג הנכס, החדרים מול הגודל, והתקציב
     שבהשכרה הוא חודשי ובמכירה חד-פעמי. */
  function applyDealChoice() {
    var commercial = state.category === 'commercial';
    $('buyCommercialDeal').hidden = !commercial;
    $('buyRoomsBlock').hidden = commercial;
    $('buySizeBlock').hidden = !commercial;
    $('buyBudgetHint').textContent = state.deal === 'rent' ? '(₪ לחודש)' : '(₪)';
    renderPtypes();
  }

  $('buyDealToggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-buy-deal]');
    if (!btn) return;
    document.querySelectorAll('#buyDealToggle button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    var choice = btn.dataset.buyDeal;
    state.category = choice === 'commercial' ? 'commercial' : 'residential';
    if (choice !== 'commercial') state.deal = choice;
    else {
      var active = document.querySelector('#buyCommercialToggle button.active');
      state.deal = (active && active.dataset.buyCdeal) || 'sale';
    }
    state.ptypes.clear();
    if (state.category === 'commercial') state.rooms.clear();
    applyDealChoice();
    setError(1, '');
  });

  /* ‏saved_searches.deal_type מוגבל ל-sale/rent, ו"מסחרי" הוא קטגוריה ולא
     סוג עסקה — ולכן הבחירה בו פותחת את השאלה המשלימה. */
  $('buyCommercialToggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-buy-cdeal]');
    if (!btn) return;
    document.querySelectorAll('#buyCommercialToggle button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    state.deal = btn.dataset.buyCdeal;
    applyDealChoice();
  });

  /* בחירה מרובה ולא טווח: "3 או 4 חדרים" היא הדרך שבה אנשים מחפשים, והיא
     מתורגמת בשליחה לטווח מינימום–מקסימום שהוא מה ש-saved_searches שומר. */
  $('buyRoomsChips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip[data-buy-rooms]');
    if (!chip) return;
    var on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!on));
    var val = chip.dataset.buyRooms;
    if (on) state.rooms.delete(val); else state.rooms.add(val);
    setError(2, '');
  });

  ['buyPriceMin','buyPriceMax','buySizeMin','buySizeMax'].forEach(function (id) {
    $(id).addEventListener('input', function () { setError(2, ''); });
  });
  [['buyName',3], ['buyPhone',3], ['buyEmail',3], ['buyArea',1]].forEach(function (pair) {
    $(pair[0]).addEventListener('input', function (e) {
      e.target.classList.remove('invalid');
      setError(pair[1], '');
    });
  });

  /* ---------- שלב 3: ערוץ העדכון ---------- */
  $('buyChannels').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-buy-channel]');
    if (!btn) return;
    document.querySelectorAll('#buyChannels button').forEach(function (b) { b.classList.toggle('active', b === btn); });
    state.channel = btn.dataset.buyChannel;
    $('buyPhoneField').hidden = state.channel === 'email';
    $('buyEmailField').hidden = state.channel === 'whatsapp';
    setError(3, '');
  });

  /* ---------- ניווט בין השלבים ---------- */
  form.querySelectorAll('[data-buy-next]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var from = Number(btn.closest('.wiz-panel').dataset.panel);
      if (!validateStep(from)) return;
      goToStep(Number(btn.dataset.buyNext));
    });
  });
  form.querySelectorAll('[data-buy-back]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setError(Number(btn.closest('.wiz-panel').dataset.panel), '');
      goToStep(Number(btn.dataset.buyBack));
    });
  });

  /* ---------- מה שנשמר בפועל ----------
     ‏'+6' פירושו "6 ומעלה", כלומר מינימום בלי מקסימום. */
  var num = function (id) { var v = $(id).value.trim(); return v === '' ? null : Number(v); };

  function criteria() {
    var roomVals = [...state.rooms].map(function (r) { return r === '+6' ? 6 : parseFloat(r); })
      .filter(function (n) { return !isNaN(n); });
    var openEnded = state.rooms.has('+6');
    var commercial = state.category === 'commercial';
    var area = hoods.rows.length ? '' : $('buyArea').value.trim();
    return {
      deal_type: state.deal,
      category: state.category,
      cities: area ? [area] : [],
      neighborhood_ids: [...state.hoods],
      property_types: [...state.ptypes],
      min_rooms: roomVals.length ? Math.min.apply(null, roomVals) : null,
      max_rooms: (roomVals.length && !openEnded) ? Math.max.apply(null, roomVals) : null,
      min_price: num('buyPriceMin'),
      max_price: num('buyPriceMax'),
      min_size_sqm: commercial ? num('buySizeMin') : null,
      max_size_sqm: commercial ? num('buySizeMax') : null
    };
  }
  function hasCriteria(c) {
    return !!(c.cities.length || c.neighborhood_ids.length || c.property_types.length ||
      c.min_rooms !== null || c.max_rooms !== null || c.min_price !== null || c.max_price !== null ||
      c.min_size_sqm !== null || c.max_size_sqm !== null);
  }

  function validateStep(step) {
    // שכונה אינה חובה — "כל האזורים" הוא חיפוש לגיטימי כל עוד יש תנאי אחר,
    // וזה נבדק בשלב הבא שבו התנאים האלה נבחרים
    if (step === 1) { setError(1, ''); return true; }
    if (step === 2) {
      if (!hasCriteria(criteria())) {
        setError(2, 'בחרו לפחות תנאי אחד — שכונה, סוג נכס, חדרים או תקציב');
        return false;
      }
      setError(2, '');
      return true;
    }
    if (step === 3) {
      var nameEl = $('buyName'), phoneEl = $('buyPhone'), emailEl = $('buyEmail');
      var name = nameEl.value.trim();
      var phone = state.channel === 'email' ? '' : phoneEl.value.trim();
      var email = state.channel === 'whatsapp' ? '' : emailEl.value.trim();
      var badName = name.length < 2;
      var badPhone = state.channel !== 'email' && phone.replace(/\D/g, '').length < 9;
      var badEmail = state.channel !== 'whatsapp' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      nameEl.classList.toggle('invalid', badName);
      phoneEl.classList.toggle('invalid', badPhone);
      emailEl.classList.toggle('invalid', badEmail);
      if (badName) { setError(3, 'נא להזין שם מלא'); nameEl.focus(); return false; }
      if (badPhone) { setError(3, 'נא להזין מספר טלפון תקין'); phoneEl.focus(); return false; }
      if (badEmail) { setError(3, 'נא להזין כתובת אימייל תקינה'); emailEl.focus(); return false; }
      setError(3, '');
      return true;
    }
    return true;
  }

  function hoodNames(c) {
    return c.neighborhood_ids.map(function (id) {
      var h = hoods.byId.get(id);
      return h && h.name;
    }).filter(Boolean);
  }
  function roomsText(c) {
    if (c.min_rooms && c.max_rooms && c.min_rooms !== c.max_rooms) return c.min_rooms + '–' + c.max_rooms + ' חדרים';
    if (c.min_rooms) return c.min_rooms + ' חדרים' + (!c.max_rooms ? ' ומעלה' : '');
    if (c.max_rooms) return 'עד ' + c.max_rooms + ' חדרים';
    return null;
  }

  /* הסיכום שמעל שדות הקשר: מה בדיוק יישמר ברגע שנמסר טלפון. */
  function renderRecap() {
    var c = criteria();
    var names = hoodNames(c);
    var budget = c.min_price && c.max_price ? nis(c.min_price) + '–' + nis(c.max_price) + ' ₪'
               : c.max_price ? 'עד ' + nis(c.max_price) + ' ₪'
               : c.min_price ? 'מ-' + nis(c.min_price) + ' ₪' : null;
    var parts = [
      DEAL_LABELS[c.deal_type],
      c.category === 'commercial' ? 'נכס מסחרי' : null,
      names.length ? '📍 ' + names.join(', ') : (c.cities.length ? '📍 ' + c.cities.join(', ') : '📍 כל האזורים'),
      c.property_types.length ? '🏠 ' + c.property_types.join(', ') : null,
      roomsText(c),
      budget ? '💰 ' + budget : null,
      (c.min_size_sqm || c.max_size_sqm)
        ? '📐 ' + (c.min_size_sqm || '') + (c.min_size_sqm && c.max_size_sqm ? '–' : '') + (c.max_size_sqm || '') + ' מ״ר'
        : null
    ].filter(Boolean);
    $('buyRecap').textContent = parts.join(' · ');
  }

  /* כותרת החיפוש, כפי שתופיע בהתראה ובכרטיס הליד — נבנית בעברית מהחלקים. */
  function buildLabel(c) {
    var names = hoodNames(c);
    var place = names.length ? names.join(', ') : (c.cities.length ? c.cities.join(', ') : null);
    return [
      roomsText(c) || c.property_types[0] || (c.category === 'commercial' ? 'נכס מסחרי' : 'נכס'),
      place ? 'ב' + place : null,
      DEAL_LABELS[c.deal_type],
      c.max_price ? 'עד ' + nis(c.max_price) + ' ₪' : null
    ].filter(Boolean).join(' ').slice(0, 200);
  }

  /* ---------- השליחה ---------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateStep(3)) return;
    var c = criteria();
    if (!hasCriteria(c)) {
      setError(3, 'הוסיפו לפחות תנאי אחד — שכונה, סוג נכס, חדרים או תקציב');
      goToStep(2);
      return;
    }

    var btn = $('buySubmitBtn');
    var originalLabel = btn.textContent;
    btn.textContent = 'שולח…';
    btn.disabled = true;

    var payload = Object.assign({}, c, {
      full_name: $('buyName').value.trim(),
      phone: state.channel === 'email' ? '' : $('buyPhone').value.trim(),
      email: state.channel === 'whatsapp' ? '' : $('buyEmail').value.trim(),
      contact_channel: state.channel,
      label: buildLabel(c),
      required_features: [],
      // ההסכמה נפרדת מההרשמה במכוון: אפשר לקבל התראות בלי שהפרטים יעברו
      // לאף אחד. רק מי שמסמן/ת הופך/ת לליד.
      consent_agent_contact: $('buyConsent').checked,
      source: state.source
    });

    fetch(INTAKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok || data.error) {
            var messages = {
              too_many_searches: 'הגעתם למקסימום החיפושים השמורים (' + (data.limit || 5) + '). אפשר להפסיק חיפוש קיים מהקישור שבהתראה.',
              no_criteria: 'הוסיפו לפחות תנאי אחד — שכונה, סוג נכס, חדרים או תקציב',
              invalid_phone: 'נא להזין מספר טלפון תקין',
              invalid_email: 'נא להזין כתובת אימייל תקינה',
              invalid_name: 'נא להזין שם מלא'
            };
            throw new Error(messages[data.error] || 'השמירה נכשלה — נסו שוב');
          }
          return data;
        });
      })
      .then(function (data) {
        // ‏duplicate=true פירושו שהחיפוש הזה כבר שמור. מבחינת המחפש/ת זו הצלחה.
        $('buyDoneText').textContent = data.duplicate
          ? 'החיפוש הזה כבר שמור אצלנו — נעדכן אתכם ברגע שיעלה נכס מתאים.'
          : 'נעדכן אתכם ברגע שיעלה נכס שמתאים למה שביקשתם.';
        form.hidden = true;
        $('buySteps').hidden = true;
        doneEl.hidden = false;
      })
      .catch(function (err) {
        console.warn('saved-search-intake (footer buyer banner) failed:', err);
        setError(3, err.message && err.message !== 'Failed to fetch'
          ? err.message : 'השמירה נכשלה — בדקו חיבור לאינטרנט ונסו שוב');
        btn.textContent = originalLabel;
        btn.disabled = false;
      });
  });

  $('buyRestart').addEventListener('click', function () {
    form.reset();
    state.hoods.clear();
    state.rooms.clear();
    state.ptypes.clear();
    form.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
    form.querySelectorAll('.wiz-input').forEach(function (i) { i.classList.remove('invalid'); });
    [1, 2, 3].forEach(function (s) { setError(s, ''); });
    var btn = $('buySubmitBtn');
    btn.textContent = 'קבלת עדכונים';
    btn.disabled = false;
    doneEl.hidden = true;
    form.hidden = false;
    $('buySteps').hidden = false;
    goToStep(1);
  });

  // מצב פתיחה: סוגי הנכס למגורים, ותיבת האזור החופשית עד שרשימת השכונות מגיעה
  renderPtypes();
  renderHoods();
})();
