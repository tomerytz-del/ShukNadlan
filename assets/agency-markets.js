/* ============================================================================
   ‏AgencyMarkets - בחירת האזורים שבהם המשרד יוצג, בפתיחת משרד

   שני מסלולי הפתיחה (agency-signup, והכרטיס "פתיחת המשרד שלי" ב-CRM) שואלים
   על כתובת מלאה בשדה אחד ועל האזורים להצגה - ולא על עיר המשרד. האזורים הם
   הרשימה הסגורה של השווקים (assets/markets.js), פעילים ושאינם, ונשמרים
   ב-agency_members.service_markets של המנהל/ת - אותו שדה של "אזורי פעילות"
   בפרופיל. המשרד מופיע בכל שוק שאחד/ת מחבריו בחר/ה (assets/market-scope.js).
   עיר המשרד נגזרת בשרת מהכתובת (‏_shared/agency-city.ts).
   docs/regional-pages.md, "כתובת המשרד ואזורי הפעילות".

       AgencyMarkets.mount(containerEl)   // צ'יפים לבחירה
       AgencyMarkets.value(containerEl)   // ['afula-emek', 'haifa']

   הרשימה נבנית ב-DOM (‏textContent), ולא ב-innerHTML - אין מה לברוח.
   ============================================================================ */
(function (g) {
  'use strict';

  function render(box) {
    var list = (g.ShukMarkets && Array.isArray(g.ShukMarkets.list)) ? g.ShukMarkets.list : [];
    var chosen = value(box);
    box.textContent = '';
    list.forEach(function (m) {
      if (!m || !m.slug || !m.label) return;
      var label = document.createElement('label');
      label.className = 'market-chip';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.value = m.slug;
      input.checked = chosen.indexOf(m.slug) !== -1;
      label.appendChild(input);
      label.appendChild(document.createTextNode(m.label));
      if (!m.live) {
        var soon = document.createElement('span');
        soon.className = 'market-chip-soon';
        soon.textContent = '(בקרוב)';
        label.appendChild(soon);
      }
      box.appendChild(label);
    });
  }

  /** ‏markets.js נטען ב-defer בדף ההרשמה, ולכן מחכים לו כשהוא עוד לא כאן. */
  function mount(box) {
    if (!box) return;
    if (g.ShukMarkets && g.ShukMarkets.list) { render(box); return; }
    document.addEventListener('DOMContentLoaded', function () { render(box); });
  }

  function value(box) {
    if (!box) return [];
    return Array.prototype.map.call(box.querySelectorAll('input:checked'), function (el) { return el.value; });
  }

  g.AgencyMarkets = { mount: mount, value: value };
})(typeof window !== 'undefined' ? window : globalThis);
