/* ============================================================================
   תחומי ההתמחות של המשרד — קטלוג משותף
   ----------------------------------------------------------------------------
   אותם עשרה תחומים מופיעים בשלושה מקומות: בטופס פתיחת המשרד, בעריכת המיתוג
   ב-CRM ובראש דף המשרד הציבורי. שלושתם קוראים מכאן, כדי שתחום שנוסף ייכנס
   בבת אחת ולא ישכח באחד מהם. הרשימה חייבת להישאר זהה ל-
   ‏agencies_specialties_check במסד (supabase/migrations/…_agency_specialties.sql).

   שימוש:
     Specialties.list()                    // הקטלוג לפי סדר התצוגה
     Specialties.byId('land')              // { id, label, short, icon, ... }
     Specialties.resolve(agency.specialties)  // מסנן מזהים שאינם בקטלוג
     Specialties.derive(properties)        // גזירה אוטומטית מהנכסים בפועל
     Specialties.chipsHtml(ids)            // תגיות מוכנות לדף

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  var S = function (paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };

  var ICONS = {
    home:    S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6"/><path d="M9.5 21v-6h5v6"/>'),
    key:     S('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8-8M17 6l2 2M14.5 8.5l2 2"/>'),
    store:   S('<path d="M4 9h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M3 9l1.6-5.2A1 1 0 0 1 5.6 3h12.8a1 1 0 0 1 1 .8L21 9"/><path d="M9 21v-6h6v6"/>'),
    coins:   S('<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>'),
    land:    S('<path d="M3 18h18"/><path d="M5.5 18V9.5l6.5-4 6.5 4V18"/><path d="M3 21h18"/><path d="M9.5 18v-4h5v4"/>'),
    renewal: S('<path d="M4 21V8.5L10 5v16"/><path d="M10 21V9l6.5 3.5V21"/><path d="M2 21h20"/><path d="M17.5 3.5a3.5 3.5 0 0 1 3.4 4.4M20.9 7.9l-1.6-1.2M20.9 7.9l.6-1.9"/>'),
    crane:   S('<path d="M3 21h18"/><path d="M6 21V4h13"/><path d="M6 4 19 9"/><path d="M14 4v4"/><path d="M12 8v4"/><path d="M9.5 12h5v4h-5z"/>'),
    diamond: S('<path d="m3 9 3-5h12l3 5-9 11Z"/><path d="M3 9h18M8.5 9 12 20M15.5 9 12 20M6 4l2.5 5M18 4l-2.5 5"/>'),
    factory: S('<path d="M3 21V10l5.5 3.5V10L14 13.5V6h4.5v15Z"/><path d="M2 21h20"/><path d="M17 10h1.5M17 14h1.5"/>'),
    clipboard: S('<path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5A1.5 1.5 0 0 1 19 7v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V7a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="M8.5 11.5h7M8.5 15.5h4.5"/>'),
  };

  /* ‏label הוא הניסוח המלא (טופס ההרשמה וה-CRM, שם יש מקום להסביר);
     ‏short הוא מה שנכנס לתגית בדף המשרד, שם כל תו נחשב.
     ‏hint מוצג מתחת לתווית בממשקי הבחירה בלבד. */
  var CATALOG = [
    { id:'residential_sale', label:'קנייה ומכירה של נכסים פרטיים', short:'דירות ובתים למכירה',
      icon:'home', hint:'דירות, בתים פרטיים, דירות גן ופנטהאוזים' },
    { id:'residential_rent', label:'השכרת דירות ובתים', short:'השכרה למגורים',
      icon:'key', hint:'שוק השכירות למגורים' },
    { id:'commercial', label:'נכסים מסחריים', short:'מסחרי',
      icon:'store', hint:'חנויות, שטחי מסחר, משרדים וקליניקות' },
    { id:'income', label:'נכסים מניבים ולהשקעה', short:'נכסים מניבים',
      icon:'coins', hint:'נכסים שנרכשים לפי תשואה — למשקיעים' },
    { id:'land', label:'קרקעות ומגרשים', short:'קרקעות ומגרשים',
      icon:'land', hint:'מגרשים, קרקעות חקלאיות ונחלות' },
    { id:'urban_renewal', label:'פינוי בינוי והתחדשות עירונית', short:'פינוי בינוי',
      icon:'renewal', hint:'תמ״א 38, פינוי בינוי וליווי דיירים' },
    { id:'new_projects', label:'פרויקטים חדשים מקבלן', short:'פרויקטים מקבלן',
      icon:'crane', hint:'שיווק פרויקטים ודירות על הנייר' },
    { id:'luxury', label:'נכסי יוקרה ווילות', short:'נכסי יוקרה',
      icon:'diamond', hint:'וילות, בתי יוקרה ונכסים ייחודיים' },
    { id:'industrial', label:'מבני תעשייה ולוגיסטיקה', short:'תעשייה ולוגיסטיקה',
      icon:'factory', hint:'מבני תעשייה, מחסנים ומגרשי אחסנה' },
    { id:'property_management', label:'ניהול נכסים', short:'ניהול נכסים',
      icon:'clipboard', hint:'ניהול שוטף של נכסים עבור בעליהם' },
  ];

  var MAX_SELECTED = 6; // זהה לתקרה שב-agencies_specialties_check

  var BY_ID = {};
  CATALOG.forEach(function (item) { BY_ID[item.id] = item; });

  function byId(id) { return BY_ID[id] || null; }

  /* מזהה שלא מוכר כאן פשוט נופל. הרשימה במסד סגורה בבדיקה, אבל דף שרץ
     בדפדפן של לקוח אחרי שהקטלוג התעדכן עלול לפגוש ערך שהוא לא מכיר — עדיף
     שייעלם מהשורה מאשר שיצייר תגית ריקה. */
  function resolve(ids) {
    if (!Array.isArray(ids)) return [];
    var seen = {};
    return ids.filter(function (id) {
      if (typeof id !== 'string' || !BY_ID[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  /* ---------- גזירה אוטומטית מהנכסים ----------
     נפילה־לאחור למשרד שעדיין לא סימן תחומים: הנכסים שכבר עלו מספרים בעצמם
     במה המשרד עוסק. נגזרים רק תחומים שאפשר באמת לראות במודעה —
     ‏category, deal_type וסוג הנכס. פינוי בינוי, פרויקטים מקבלן, יוקרה
     וניהול נכסים אינם ניתנים לגזירה ממודעה בודדת ולכן נשארים הצהרה בלבד.

     הסדר הוא לפי מספר הנכסים בפועל: התחום שהמשרד הכי פעיל בו נכנס ראשון,
     והתקרה מונעת שורת תגיות שאומרת "אנחנו עושים הכל". */
  var TYPE_RULES = [
    { id:'land',       re:/מגרש|קרקע|נחל|משק|חקלא/ },
    { id:'industrial', re:/תעשי|מחסן|מחסנים|לוגיסט|אחסנ/ },
  ];

  var AUTO_LIMIT = 4;

  function deriveIds(properties) {
    if (!Array.isArray(properties) || properties.length === 0) return [];
    var counts = {};
    var bump = function (id) { counts[id] = (counts[id] || 0) + 1; };

    properties.forEach(function (p) {
      if (!p) return;
      var type = typeof p.property_type === 'string' ? p.property_type : '';
      var commercial = p.category === 'commercial';
      var rent = p.deal_type === 'rent';

      // סוג הנכס גובר על ה-category: מגרש שסומן מסחרי הוא עדיין קרקע
      var byType = TYPE_RULES.find(function (rule) { return rule.re.test(type); });
      if (byType) { bump(byType.id); return; }

      if (commercial) {
        bump('commercial');
        // מסחרי להשכרה הוא בהגדרה נכס מניב — זה מה שקונים בו
        if (rent) bump('income');
        return;
      }
      bump(rent ? 'residential_rent' : 'residential_sale');
    });

    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, AUTO_LIMIT);
  }

  /* מחזיר גם את המזהים וגם את מקורם, כי הדף מציג הערה שונה לכל מקור:
     תחומים שהמשרד הצהיר עליהם מול תחומים שנגזרו מהנכסים. */
  function derive(properties) {
    return { source:'auto', ids: deriveIds(properties) };
  }

  function forAgency(agency, properties) {
    var declared = resolve(agency && agency.specialties);
    if (declared.length) return { source:'declared', ids: declared };
    return derive(properties);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  /* התגיות של דף המשרד. ‎className‎ נשלט מבחוץ כדי שהדף יעצב אותן בשפה
     שלו — הקובץ הזה מספק תוכן, לא ערכת צבעים. */
  function chipsHtml(ids, options) {
    var opts = options || {};
    var cls = opts.className || 'spec-chip';
    var useShort = opts.short !== false;
    return resolve(ids).map(function (id) {
      var item = BY_ID[id];
      var text = useShort ? item.short : item.label;
      var icon = opts.icons === false ? '' : (ICONS[item.icon] || '');
      return '<span class="' + cls + '">' + icon + escapeHtml(text) + '</span>';
    }).join('');
  }

  global.Specialties = {
    CATALOG: CATALOG,
    ICONS: ICONS,
    MAX_SELECTED: MAX_SELECTED,
    list: function () { return CATALOG.slice(); },
    byId: byId,
    resolve: resolve,
    derive: derive,
    forAgency: forAgency,
    chipsHtml: chipsHtml,
    iconFor: function (id) { var item = byId(id); return item ? (ICONS[item.icon] || '') : ''; },
  };
})(window);
