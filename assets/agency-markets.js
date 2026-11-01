/* ============================================================================
   ‏AgencyMarkets - בחירת האזורים שבהם המשרד יוצג, בפתיחת משרד

   שני מסלולי הפתיחה (agency-signup, והכרטיס "פתיחת המשרד שלי" ב-CRM) שואלים
   על כתובת מלאה בשדה אחד ועל האזורים להצגה - ולא על עיר המשרד. האזורים הם
   הרשימה הסגורה של השווקים (assets/markets.js), פעילים ושאינם, ונשמרים
   ב-agency_members.service_markets של המנהל/ת - אותו שדה של "אזורי פעילות"
   בפרופיל. המשרד מופיע בכל שוק שאחד/ת מחבריו בחר/ה (assets/market-scope.js).
   עיר המשרד נגזרת בשרת מהכתובת (‏_shared/agency-city.ts).
   docs/regional-pages.md, "כתובת המשרד ואזורי הפעילות".

       AgencyMarkets.mount(containerEl)   // כרטיסים לבחירה
       AgencyMarkets.value(containerEl)   // ['afula-emek', 'haifa']

   העיצוב (אפשרות B, תומר 30.10): השווקים הפעילים - כרטיס בולט לכל אחד
   למעלה. כל השאר בשורה אחת מקופלת "עוד N אזורים בקרוב", שנפתחת לקבוצות לפי
   אזור בארץ (AREAS) ברשת של 2 עמודות. 37 צ'יפים עם "(בקרוב)" על כל אחד
   תפסו כ-1,590px בטלפון. הערכים (input.value = slug) וה-value() לא השתנו,
   ולכן הטופס נשלח בדיוק כמו קודם. שוק חדש שלא ב-AREAS נופל ל"אזורים נוספים".

   הרשימה נבנית ב-DOM (‏textContent), ולא ב-innerHTML - אין מה לברוח.
   ============================================================================ */
(function (g) {
  'use strict';

  var AREAS = [
    { title: 'צפון', slugs: ['haifa', 'krayot', 'akko-nahariya', 'karmiel-misgav', 'nof-hagalil-migdal', 'yokneam', 'tiberias', 'safed', 'kiryat-shmona', 'golan', 'beit-shean'] },
    { title: 'שרון', slugs: ['hadera', 'netanya', 'kfar-saba-raanana', 'herzliya'] },
    { title: 'מרכז', slugs: ['tel-aviv', 'ramat-gan', 'bnei-brak-elad', 'petah-tikva', 'holon-bat-yam', 'rishon'] },
    { title: 'שפלה', slugs: ['rehovot', 'modiin', 'lod-ramla'] },
    { title: 'ירושלים, יהודה ושומרון', slugs: ['jerusalem', 'beit-shemesh', 'samaria', 'binyamin', 'gush-etzion'] },
    { title: 'דרום', slugs: ['ashdod', 'ashkelon', 'kiryat-gat', 'sderot-netivot', 'beer-sheva', 'dimona-arad', 'eilat'] }
  ];
  // הנוסחים אושרו בידי גבריאלה ותומר (30.10)
  var OTHER_TITLE = 'אזורים נוספים';
  var SOON_HINT = 'אפשר לבחור כבר עכשיו. כשהאזור ייפתח, המשרד יופיע בו.';
  function soonTitle(n) { return 'עוד ' + n + ' אזורים בקרוב'; }
  function chosenText(n) { return n === 0 ? '' : n === 1 ? 'אחד נבחר' : n + ' נבחרו'; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function option(m, chosen, cls) {
    var label = el('label', cls);
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.value = m.slug;
    input.checked = chosen.indexOf(m.slug) !== -1;
    label.appendChild(input);
    var check = el('span', 'rp-check');
    check.setAttribute('aria-hidden', 'true');
    label.appendChild(check);
    label.appendChild(el('span', 'rp-name', m.label));
    return label;
  }

  function render(box) {
    var list = (g.ShukMarkets && Array.isArray(g.ShukMarkets.list)) ? g.ShukMarkets.list : [];
    var chosen = value(box);
    box.textContent = '';
    box.classList.add('rp');

    var ok = list.filter(function (m) { return m && m.slug && m.label; });
    var live = ok.filter(function (m) { return m.live; });
    var soon = ok.filter(function (m) { return !m.live; });

    var liveWrap = el('div', 'rp-live');
    live.forEach(function (m) { liveWrap.appendChild(option(m, chosen, 'rp-card')); });
    box.appendChild(liveWrap);
    if (!soon.length) return;

    var bySlug = {};
    soon.forEach(function (m) { bySlug[m.slug] = m; });
    var used = {};
    var groups = AREAS.map(function (a) {
      return {
        title: a.title,
        markets: a.slugs.map(function (s) { used[s] = 1; return bySlug[s]; }).filter(Boolean),
      };
    });
    var rest = soon.filter(function (m) { return !used[m.slug]; });
    if (rest.length) groups.push({ title: OTHER_TITLE, markets: rest });

    var details = el('details', 'rp-soon');
    // שוק עתידי שכבר נבחר (CRM, טופס שנבנה מחדש) - הפאנל נפתח, כדי שהבחירה לא תיעלם
    if (soon.some(function (m) { return chosen.indexOf(m.slug) !== -1; })) details.open = true;
    var sum = el('summary', 'rp-soon-summary');
    sum.appendChild(el('span', 'rp-soon-title', soonTitle(soon.length)));
    var count = el('span', 'rp-count');
    sum.appendChild(count);
    details.appendChild(sum);
    details.appendChild(el('div', 'rp-soon-hint', SOON_HINT));

    groups.forEach(function (gr) {
      if (!gr.markets.length) return;
      var sec = el('div', 'rp-area');
      sec.appendChild(el('div', 'rp-area-title', gr.title));
      var grid = el('div', 'rp-grid');
      gr.markets.forEach(function (m) { grid.appendChild(option(m, chosen, 'rp-chip')); });
      sec.appendChild(grid);
      details.appendChild(sec);
    });
    box.appendChild(details);

    // מונה הנבחרים בשורה המקופלת - כדי שבחירה לא "תיעלם" כשסוגרים
    function refresh() { count.textContent = chosenText(details.querySelectorAll('input:checked').length); }
    box.addEventListener('change', refresh);
    refresh();
  }

  /** ‏markets.js נטען ב-defer בדף ההרשמה, ולכן מחכים לו כשהוא עוד לא כאן. */
  function mount(box) {
    if (!box) return;
    if (g.ShukMarkets && g.ShukMarkets.list) { render(box); return; }
    var later = function () { if (g.ShukMarkets && g.ShukMarkets.list) render(box); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later);
    else later();
  }

  function value(box) {
    if (!box) return [];
    return Array.prototype.map.call(box.querySelectorAll('input:checked'), function (el) { return el.value; });
  }

  g.AgencyMarkets = { mount: mount, value: value, AREAS: AREAS };
})(typeof window !== 'undefined' ? window : globalThis);
