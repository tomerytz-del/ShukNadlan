/* ============================================================================
   כרטיס הנכס — שפה אחת לכל התצוגות
   ----------------------------------------------------------------------------
   אריח נכס מופיע בחמישה מקומות (דף הבית: רצועות מכירה/השכרה/מסחרי, הרשת
   ותוצאות החיפוש; דף המשרד; דף הסוכן/ת), וכל אחד מהם צייר אותו קצת אחרת:
   מחיר בגוון אחר, מאפיינים כקפסולות מפוזרות במקום אחד, ותגיות שונות על
   התמונה. הקובץ הזה מספק את שלושת החלקים שחייבים להיראות זהה בכולם:

     PropertyCard.priceHtml(p)     // המחיר — שחור עמוק ומודגש
     PropertyCard.titleHtml(p)     // הכותרת — שתי שורות מלאות בגובה קבוע
     PropertyCard.whereHtml(p,o)   // שתי שורות מיקום בתבנית קבועה
     PropertyCard.factsHtml(p)     // שורת אייקונים: חדרים · מ״ר · קומה · חניה
     PropertyCard.badgesHtml(p,o)  // התגיות שעל התמונה (כולל שכבת ההגנה)
     PropertyCard.sortByMedia(list)// נכסים עם וידאו/סיור/תמונות קודם

   ה-CSS מוזרק פעם אחת בשימוש הראשון, כדי שדף שלא מציג אריחים לא ישלם עליו.
   הצבעים נגזרים ממשתני הדף (‏--ink-soft, --accent) עם נפילה־לאחור לערכים
   קבועים, כך שאותו קוד עובד גם בדף המשרד שנצבע בערכה של המשרד.

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  var S = function (paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  };

  var ICONS = {
    bed:    S('<path d="M3 18v-11"/><path d="M3 12h18v6"/><path d="M21 18v-4a2 2 0 0 0-2-2"/><path d="M7.5 12V9.5h4a2 2 0 0 1 2 2V12"/>'),
    ruler:  S('<path d="M3.5 14.5 14.5 3.5l6 6-11 11z"/><path d="M7 11l1.8 1.8M10 8l1.8 1.8M13 5l1.8 1.8"/>'),
    stairs: S('<path d="M3 20h4v-4h4v-4h4V8h4V4"/><path d="M3 20h18"/>'),
    car:    S('<path d="M4.5 16.5h15"/><path d="M5 16.5V19H3.5v-2.5"/><path d="M19 16.5V19h1.5v-2.5"/><path d="M4.5 16.5v-4l1.8-4.3A1.5 1.5 0 0 1 7.7 7h8.6a1.5 1.5 0 0 1 1.4 1.2l1.8 4.3v4z"/><path d="M7 14h1.5M15.5 14H17"/>'),
    video:  S('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 11 6-3.2v8.4l-6-3.2z"/>'),
    cube:   S('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  };

  /* ---------- שורת המאפיינים ----------
     ארבעה מאפיינים לכל היותר, תמיד באותו סדר ותמיד באותה צורה: אייקון
     ומספר, בלי מסגרת ובלי רקע. קפסולות פיזרו את תשומת הלב — כל אחת נראתה
     כמו כפתור, והעין נאלצה לקרוא ארבעה "כפתורים" כדי לדעת כמה חדרים יש.

     מאפיין שלא מולא פשוט לא נכנס; אריח דליל לא מקבל מקפים. */
  var FACTS = [
    { icon: 'bed', get: function (p) {
      return p.rooms ? trimNum(p.rooms) + ' חד׳' : null;
    } },
    { icon: 'ruler', get: function (p) {
      return p.size_sqm ? Number(p.size_sqm).toLocaleString('he-IL') + ' מ״ר' : null;
    } },
    { icon: 'stairs', get: function (p) {
      // קומה 0 היא קומת קרקע, לא "אין נתון" — ולכן הבדיקה היא על null/undefined
      if (p.floor === null || p.floor === undefined || p.floor === '') return null;
      return Number(p.floor) === 0 ? 'קומת קרקע' : 'קומה ' + trimNum(p.floor);
    } },
    { icon: 'car', get: function (p) {
      return hasFeature(p, 'parking') ? 'חניה' : null;
    } },
  ];

  function trimNum(value) {
    var n = Number(value);
    if (!isFinite(n)) return String(value);
    // 3.5 נשאר 3.5, אבל 4.0 הופך ל-4
    return String(Math.round(n * 10) / 10);
  }

  function hasFeature(p, key) {
    return Array.isArray(p && p.features) && p.features.indexOf(key) !== -1;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function factsHtml(p) {
    ensureStyles();
    var cells = [];
    FACTS.forEach(function (fact) {
      var text = fact.get(p || {});
      if (!text) return;
      cells.push('<span class="pc-fact">' + ICONS[fact.icon] + escapeHtml(text) + '</span>');
    });
    // המעטפת נכתבת תמיד, גם כשאין ולו מאפיין אחד: היא שומרת את גובה השורה,
    // ובלעדיה אריח של מגרש (בלי חדרים, מ״ר או קומה) יצא נמוך משכניו ברשת.
    // ‏min-height ב-CSS הוא מה שממלא אותה — לא מקפים ולא טקסט ממלא־מקום.
    return '<div class="pc-facts">' + cells.join('') + '</div>';
  }

  /* ---------- המחיר ----------
     שחור עמוק ומודגש, ולא בגוון המותג. המחיר הוא הנתון שהעין קופצת אליו
     ראשונה בכל אריח, וכשהוא נצבע בגוון המשני הוא התחרה בתגיות שנושאות את
     אותו גוון. ‏"/חוד׳" נשאר קטן ואפור: הוא יחידת מידה ולא חלק מהמספר. */
  function priceHtml(p) {
    ensureStyles();
    var price = Number(p && p.price);
    if (!isFinite(price) || price <= 0) {
      return '<div class="pc-price pc-price-none">לפי בקשה</div>';
    }
    var amount = '₪' + price.toLocaleString('he-IL');
    var suffix = (p.deal_type === 'rent') ? '<span class="pc-per">לחודש</span>' : '';
    return '<div class="pc-price">' + amount + suffix + '</div>';
  }

  /* ---------- הכותרת ושורות המיקום ----------
     הכותרת נחתכה עד כה אחרי שורה אחת (ובגריד של דף הבית לא נחתכה בכלל,
     ולכן אריחים שכנים יצאו בגבהים שונים). כאן היא תמיד שתי שורות: נחתכת
     רק אחרי השנייה, ושומרת את גובה שתי השורות גם כשהיא קצרה — כך כל
     האריחים ברצועה נשארים בדיוק באותו גובה בלי תלות באורך הכותרת.

     המיקום מפוצל לתבנית קבועה במקום שרשרת אחת של "‏·‎" שנקטעה באמצע:
       שורה 1 — סוג הנכס והשכונה/העיר. זה מה שמזהה את הנכס במבט אחד.
       שורה 2 — שאר הפרטים: הרחוב, העיר (כששורה 1 כבר תפוסה בשכונה)
                והמשרד המפרסם.
     שתי השורות תמיד קיימות, גם כשהשנייה ריקה, ולכן גובה אזור הטקסט קבוע. */
  /* ---------- הכותרת, בלי מה שכבר כתוב מתחתיה ----------
     הכותרת של רוב המודעות נבנית בתבנית אחת: ‏"<סוג>, <אזור> <רחוב> <מספר>
     — <שטח> מ״ר". כל אחד מהחלקים האלה כבר מופיע באריח בשורה אחרת — הסוג
     והאזור בשורת המיקום הראשונה, הרחוב בשנייה, השטח והחדרים בשורת
     המאפיינים — ולכן האריח קרא את אותו מידע שלוש פעמים, ובגרסת הכיסוי
     הוא גם גזל את המקום מהתמונה עצמה.

     ‏60 המודעות הפעילות בזמן הכתיבה: ‏48 מהן נכתבו בתבנית הזו בדיוק ולא
     הוסיפו בכותרת ולו מילה אחת. השאר כן — "משופצת", "סטודיו", "פינתית
     במיקום מעולה", "שכונת גבעת המורה" — וזה בדיוק מה שנשאר כאן.

     לכן לא מוחקים את הכותרת ולא משאירים אותה כמו שהיא, אלא מקזזים ממנה
     את מה שהאריח כבר אומר. מה שנשאר בלי אותיות של ממש נופל לגמרי.

     ההשוואה לסוג הנכס היא לפי גזע ולא לפי מחרוזת: הכותרת כותבת "דירת"
     ו-"דירות" מול ‎property_type‎ "דירה", ו-"חנות" מול "חנויות/שטח מסחרי". */
  var HEB = /[\u0590-\u05FF]/;

  function stem(word) {
    // הסרת אות שימוש מובילה (בכל"ם והו"ה) ושלוש אותיות ראשונות — מספיק
    // כדי לזהות "משרד" מול "משרדים" בלי לאחד מילים שאינן קרובות
    return word.replace(/["'\u05F4\u05F3]/g, '').replace(/^[\u05D4\u05D5\u05D1\u05DC\u05DE\u05E9\u05DB]/, '').slice(0, 3);
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function numText(v) {
    return (v === null || v === undefined || v === '') ? null : String(Number(v));
  }

  function distinctTitle(p) {
    var prop = p || {};
    var t = String(prop.title || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';

    // 1. השטח והקומה — שורת המאפיינים אומרת את שניהם
    var size = numText(prop.size_sqm);
    if (size) t = t.replace(new RegExp('[\u2014\u2013-]?\\s*' + escapeRe(size) + '\\s*\u05DE["\u05F4\u05F3\']?\\s*\u05E8', 'g'), ' ');
    t = t.replace(/,?\s*\u05E7\u05D5\u05DE\u05D4\s*\d+/g, ' ');

    // 2. מספר החדרים — גם הוא שם
    var rooms = numText(prop.rooms);
    if (rooms) t = t.replace(new RegExp(escapeRe(rooms) + '\\s*(\u05D7\u05D3\u05E8\u05D9\u05DD|\u05D7\u05D3[\'\u05F3]?)', 'g'), ' ');

    // 3. "למכירה"/"להשכרה" — זו התגית שיושבת על התמונה. גבולות המילה
    //    נכתבים כטווח עברי, כי ‎\b‎ ב-JS לא מכיר אותיות עבריות בכלל.
    t = t.replace(/(^|[^\u0590-\u05FF])(\u05DC\u05D4\u05E9\u05DB\u05E8\u05D4|\u05DC\u05DE\u05DB\u05D9\u05E8\u05D4)(?![\u0590-\u05FF])/g, '$1 ');

    // 4. המיקום — שתי שורות המיקום אומרות את כולו. מהארוך לקצר, אחרת
    //    אזור המכירה ("רובע יזרעאל") נחתך מתוך שם הרחוב שמכיל אותו
    //    ("סביוני העמק שדרות רובע יזרעאל") והרחוב כבר לא נמצא.
    [prop.sales_area, prop.neighborhood_name, prop.street, prop.city]
      .filter(Boolean)
      .map(function (v) { return String(v).trim(); })
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (v) { t = t.replace(new RegExp(escapeRe(v), 'g'), ' '); });
    if (prop.house_number) {
      t = t.replace(new RegExp('(^|[^\\d])' + escapeRe(String(prop.house_number)) + '(?!\\d)', 'g'), '$1 ');
    }

    // 5. סוג הנכס — הפריט הראשון בשורת המיקום. רק במקטע הראשון של
    //    הכותרת, ששם התבנית שמה אותו; "משרד/חנות" מאבד את "חנות"
    //    ושומר את "משרד", וזה בדיוק ההבדל שהוא בא לספר.
    var typeStems = {};
    String(prop.property_type || '').split(/[\s/]+/).forEach(function (w) {
      if (HEB.test(w)) typeStems[stem(w)] = true;
    });
    var parts = t.split(',');
    var headWords = parts[0].split(/[\s/]+/).filter(Boolean);
    var kept = headWords.filter(function (w) { return !(HEB.test(w) && typeStems[stem(w)]); });
    if (kept.length !== headWords.length) {
      parts[0] = kept.join(' ');
      t = parts.join(',');
    }

    // 6. ניקוי המפרידים שנשארו תלויים באוויר
    t = t.replace(/[,\u00B7\u2014\u2013-]+/g, ' ').replace(/\s+/g, ' ').trim();
    // פחות משלוש אותיות אינו כותרת אלא שארית
    return t.replace(/[^\u0590-\u05FFa-zA-Z]/g, '').length < 3 ? '' : t;
  }

  /* המעטפת נכתבת תמיד גם כשאין מה לכתוב בה — היא שומרת את גובה השורה,
     ובלעדיה אריח שכותרתו לא הוסיפה כלום יצא נמוך משכניו. */
  function titleHtml(p) {
    ensureStyles();
    var text = distinctTitle(p);
    return '<div class="pc-title">' + escapeHtml(text) + '</div>';
  }

  /* ‏opts.agency — האם להציג את שם המשרד בשורה השנייה. בדף המשרד ובדף
     הסוכן/ת התשובה היא לא: כל האריחים בעמוד שייכים לאותו משרד. */
  function whereHtml(p, opts) {
    ensureStyles();
    var o = opts || {};
    var prop = p || {};
    var hood = prop.neighborhood_name || null;

    var main = [prop.property_type, hood || prop.city].filter(Boolean).join(' · ');
    var sub = [
      prop.street || null,
      hood && prop.city ? prop.city : null,
      o.agency === false ? null : (prop.agency_name || null),
    ].filter(Boolean).join(' · ');

    return '<div class="pc-where">' +
      '<span class="pc-where-main">' + escapeHtml(main) + '</span>' +
      '<span class="pc-where-sub">' + escapeHtml(sub) + '</span>' +
      '</div>';
  }

  /* ---------- התגיות שעל התמונה ----------
     שלוש לכל היותר, בסדר קבוע: סוג העסקה (הלייבל שמכוון קודם), ואחריו מה
     שמבדל את הנכס הזה משאר האריחים באותה רצועה — בלעדיות, הדמיית AI, מסחרי.
     מעבר לשלוש התגיות מתחילות לכסות את התמונה שהן אמורות לקדם.

     ‏opts.aiViz — האם לנכס יש הדמיית בסיס מפורסמת. הדף שמציג את האריחים
     שולף את זה בשאילתה אחת לכל הנכסים (ראו hasVisualizations), ולא פר-אריח.

     יחד עם התגיות נשלחת גם שכבת ההגנה (‏.pc-scrim): שני גרדיאנטים כהים
     ושקופים בראש התמונה ובתחתיתה. בלעדיה תגית "למכירה"/"להשכרה" — שהיא
     חצי-שקופה — נבלעה בתמונות בהירות מאוד (שמיים, קיר לבן, סלון מוצף אור).
     השכבה מוזרקת רק כשיש תמונה אמיתית: מעל ממלא־המקום הבהיר היא רק הייתה
     מלכלכת את לוגו המשרד שיושב שם, והתגיות ממילא קריאות עליו.
     ‏opts.photo מאפשר לדף לכפות את ההחלטה במקום שנגזור אותה מ-p.images. */
  var BADGE_LIMIT = 3;

  // אותו כלל בדיוק שלפיו הדפים מחליטים אם להציג ממלא־מקום (safeImageUrl)
  function hasPhoto(p) {
    var first = p && Array.isArray(p.images) ? p.images[0] : null;
    if (typeof first !== 'string') return false;
    var url = first.trim();
    return /^https?:\/\//i.test(url) || /^(\/(?!\/)|assets\/)/i.test(url);
  }

  function scrimHtml(p, opts) {
    ensureStyles();
    var o = opts || {};
    var show = (o.photo === undefined) ? hasPhoto(p) : !!o.photo;
    return show ? '<span class="pc-scrim" aria-hidden="true"></span>' : '';
  }

  function badgesHtml(p, opts) {
    ensureStyles();
    var o = opts || {};
    var prop = p || {};
    var badges = [];

    badges.push({
      cls: prop.deal_type === 'rent' ? 'is-rent' : 'is-sale',
      text: prop.deal_type === 'rent' ? 'להשכרה' : 'למכירה',
    });
    if (hasFeature(prop, 'exclusive')) badges.push({ cls:'is-excl', text:'בלעדיות' });
    if (o.aiViz) badges.push({ cls:'is-ai', text:'הדמיית AI' });
    if (prop.category === 'commercial') badges.push({ cls:'is-commercial', text:'מסחרי' });

    return scrimHtml(prop, o) +
      '<div class="pc-badges">' + badges.slice(0, BADGE_LIMIT).map(function (b) {
        return '<span class="pc-badge ' + b.cls + '">' + escapeHtml(b.text) + '</span>';
      }).join('') + '</div>';
  }

  /* תגיות המדיה בתחתית התמונה — וידאו וסיור וירטואלי. הן נפרדות מהתגיות
     שלמעלה כי הן אומרות משהו אחר: לא "מה הנכס" אלא "מה יש לראות בו". */
  function mediaHtml(p) {
    ensureStyles();
    var prop = p || {};
    var items = [];
    if (prop.video_url) items.push('<span>' + ICONS.video + 'סרטון</span>');
    if (prop.tour_3d_url) items.push('<span>' + ICONS.cube + 'סיור וירטואלי</span>');
    return items.length ? '<div class="pc-media">' + items.join('') + '</div>' : '';
  }

  /* ---------- הסרטון כתמונת האריח ----------
     אריח עם סרטון מנגן אותו מושתק בלולאה במקום להציג פריים קפוא. זה
     הנתון שמבדיל את המודעה ברצועה, והתגית "סרטון" לבדה לא מכרה אותו.

     שני תנאים ותו לא:
       • קובץ מדיה שלנו. ‏iframe של יוטיוב בתוך אריח ברוחב 250px הוא נגן
         של צד שלישי עם הפקדים והלוגו שלו על כל שטח התמונה, והוא גם בולע
         את הלחיצה שאמורה לפתוח את הנכס.
       • הדפדפן לא ביקש אחרת: ‏reduced-motion, ‏Save-Data או חיבור 2G.

     ומעל הכל — עצלנות. רצועה מחזיקה עשרים אריחים, וסרטון נכס שוקל עד
     50MB: ‏src נכתב רק כשהאריח באמת נכנס למסך, ונמחק כשהוא יוצא. בלי זה
     גלילה אחת בדף הבית הייתה מושכת מאות מגהבייטים לכיס של הגולש/ת.
     ‏preload="none" הוא רשת הביטחון לדפדפן שלא מריץ את ה-observer. */
  var MEDIA_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;
  // כמה סרטונים מנגנים יחד לכל היותר. שלושה הם מה שנראה ברצועה בבת אחת,
  // ומעבר לזה זו רק סוללה שנשרפת על אריחים שממילא מחוץ למסך.
  var MAX_PLAYING = 3;

  function playableVideo(p) {
    var raw = p && p.video_url;
    if (!raw) return null;
    var u;
    try { u = new URL(raw, location.href); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return MEDIA_FILE.test(u.pathname) ? u.href : null;
  }

  function motionAllowed() {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    var conn = navigator.connection;
    if (conn && conn.saveData) return false;
    if (conn && /^(slow-)?2g$/.test(conn.effectiveType || '')) return false;
    return true;
  }

  /* ‏src ריק בכוונה: ‎hydrateVideos‎ ממלא אותו כשהאריח נראה. עד אז זהו
     אלמנט שקוף שדרכו נראית תמונת הרקע של ‎.thumb‎ — כלומר האריח נראה
     בדיוק כמו קודם עד שיש מה לנגן, ואין צורך ב-poster שיוריד את התמונה
     בשנייה. */
  function coverVideoHtml(p) {
    ensureStyles();
    var src = playableVideo(p);
    if (!src || !motionAllowed()) return '';
    // הצופה נרשם מכאן ולא מכל דף בנפרד: הפונקציה הזו נקראת בזמן בניית
    // ה-markup, והאריח נכנס ל-DOM לפני ה-rAF שאחריה. כך אף דף לא צריך
    // לזכור לקרוא ל-hydrateVideos אחרי כל רינדור — וזה בדיוק הסוג של
    // "לזכור" ששוכחים בו את הרצועה הרביעית.
    scheduleHydrate();
    return '<video class="pc-cover-video" muted loop playsinline preload="none" ' +
      'aria-hidden="true" tabindex="-1" data-pc-video="' + escapeHtml(src) + '"></video>';
  }

  var hydrateQueued = false;
  function scheduleHydrate() {
    if (hydrateQueued || typeof requestAnimationFrame === 'undefined') return;
    hydrateQueued = true;
    requestAnimationFrame(function () {
      hydrateQueued = false;
      hydrateVideos();
    });
  }

  var playing = [];

  function startVideo(v) {
    if (!v.src) v.src = v.getAttribute('data-pc-video') || '';
    if (!v.src) return;
    v.muted = true;   // גם אחרי הצבת src — דפדפן חוסם ניגון אוטומטי עם קול
    var res = v.play();
    if (res && res.catch) res.catch(function () {});
    if (playing.indexOf(v) === -1) playing.push(v);
    // מעל התקרה — עוצרים את הוותיק ביותר, זה שהגלילה כבר הרחיקה ממנו
    while (playing.length > MAX_PLAYING) stopVideo(playing[0], false);
  }

  function stopVideo(v, release) {
    var i = playing.indexOf(v);
    if (i !== -1) playing.splice(i, 1);
    v.pause();
    // מחיקת ה-src משחררת את מה שכבר ירד. חוזרים לאריח? הדפדפן מגיש מהמטמון.
    if (release) { v.removeAttribute('src'); v.load(); }
  }

  /* נקראת אחרי שהאריחים נכנסו ל-DOM. אידמפוטנטית: אלמנט שכבר מנוטר
     מסומן, ולכן קריאה חוזרת אחרי הוספת אריחים לא כופלת צופים. */
  function hydrateVideos(root) {
    if (typeof IntersectionObserver === 'undefined') return;
    var scope = root || document;
    var list = scope.querySelectorAll('video.pc-cover-video:not([data-pc-watched])');
    if (!list.length) return;
    if (!hydrateVideos._io) {
      hydrateVideos._io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) startVideo(entry.target);
          else stopVideo(entry.target, true);
        });
      }, { threshold: 0.6 });
    }
    Array.prototype.forEach.call(list, function (v) {
      v.setAttribute('data-pc-watched', '');
      hydrateVideos._io.observe(v);
    });
  }

  /* ---------- עדיפות לנכסים עם מדיה ----------
     תמונה רחבה ומוארת מקפיצה את האטרקטיביות של האריח מיד, וסרטון עוד יותר.
     נכס בלי תמונה בכלל מקבל ממלא־מקום — הוא עדיין מוצג, אבל בסוף הרצועה.

     המיון יציב (‏Array.prototype.sort ב-JS מודרני), ולכן בתוך אותה דרגת
     מדיה הסדר המקורי — לרוב לפי תאריך — נשמר במלואו. זה חשוב: זו העדפה
     לתצוגה, לא דירוג של הנכסים. */
  function mediaRank(p) {
    var prop = p || {};
    var images = Array.isArray(prop.images) ? prop.images.filter(Boolean) : [];
    var rank = 0;
    if (prop.video_url) rank += 8;
    if (prop.tour_3d_url) rank += 4;
    if (images.length >= 3) rank += 2;
    else if (images.length >= 1) rank += 1;
    return rank;
  }

  function sortByMedia(list) {
    return (Array.isArray(list) ? list.slice() : [])
      .sort(function (a, b) { return mediaRank(b) - mediaRank(a); });
  }

  /* ---------- אילו נכסים יש להם הדמיית AI ----------
     שאילתה אחת לכל האריחים שבדף, ולא בדיקה פר-נכס. מחזירה Set של מזהים;
     כישלון מחזיר Set ריק, והתגית פשוט לא מופיעה — היא נחמדה שיהיה, לא
     תנאי להצגת האריח. */
  function visualizedIds(sb, propertyIds) {
    var ids = (propertyIds || []).filter(Boolean);
    if (!sb || !ids.length) return Promise.resolve(new Set());
    return sb.from('property_visualizations_public')
      .select('property_id')
      .in('property_id', ids.slice(0, 200))
      .then(function (res) {
        return new Set((res && res.data ? res.data : []).map(function (r) { return r.property_id; }));
      })
      .catch(function () { return new Set(); });
  }

  /* כל הנכסים שיש להם לפחות הדמיה אחת מפורסמת — בלי רשימת מזהים מראש.
     ‏visualizedIds למעלה עונה על "מי מתוך אלה שכבר על המסך"; זה עונה על
     "מי בכלל", וזו השאלה שמסנן ההדמיות בדף הבית שואל.

     התוצאה נשמרת: הרשימה משמשת גם את הבאנר וגם את המסנן באותו עמוד, ואין
     סיבה לשאול פעמיים. ‏Set ריק הוא תשובה תקפה ("אין נכסים עם הדמיה")
     ולכן הוא נשמר כמו כל תשובה אחרת. */
  var allVizPromise = null;
  function allVisualizedIds(sb) {
    if (allVizPromise) return allVizPromise;
    if (!sb) return Promise.resolve(new Set());
    allVizPromise = sb.from('property_visualizations_public')
      .select('property_id')
      .limit(1000)
      .then(function (res) {
        return new Set((res && res.data ? res.data : []).map(function (r) { return r.property_id; }));
      })
      .catch(function () { return new Set(); });
    return allVizPromise;
  }

  /* ---------- ה-CSS ----------
     מוזרק פעם אחת. הצבעים נגזרים ממשתני הדף עם נפילה־לאחור, כדי שאותו
     קובץ ייראה נכון גם בדף שנצבע בערכה של משרד מסוים. */
  var CSS = [
    '.pc-price{',
    '  font-family:inherit;font-weight:900;letter-spacing:-.4px;line-height:1.15;',
    '  color:var(--pc-price-ink,#0E1116);font-size:1.16rem;',
    '  display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}',
    '.pc-price .pc-per{font-size:.72rem;font-weight:700;letter-spacing:0;',
    '  color:var(--ink-soft,#5A6068)}',
    /* "לפי בקשה" יושב באותו אלמנט ובאותו גודל של מחיר אמיתי, ורק הגוון
       והמשקל מרככים אותו. גודל קטן יותר היה מוריד את גובה השורה ומקצר את
       הכרטיס כולו ביחס לשכניו ברשת. */
    '.pc-price-none{color:var(--ink-soft,#5A6068);font-weight:800}',

    /* ---------- הכותרת ----------
       שתי שורות ולא אחת, ו-min-height בגובה שתי שורות כדי שכותרת קצרה
       תתפוס בדיוק אותו מקום ככותרת ארוכה — זה מה ששומר את כל האריחים
       ברצועה בגובה זהה. ה-em נגזר מגודל הגופן של הכותרת עצמה, ולכן הגובה
       מתכווץ יחד איתה בכל נקודת שבירה שבה הדף מקטין אותה.
       ‏overflow-wrap:anywhere — כתובת ארוכה בלי רווחים לא מרחיבה את האריח. */
    '.pc-title{',
    '  font-size:.85rem;font-weight:700;color:var(--ink,#0d1b3d);line-height:1.35;margin-top:5px;',
    '  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
    '  min-height:2.7em;overflow-wrap:anywhere}',

    /* ---------- שתי שורות המיקום ----------
       תבנית קבועה: השורה הראשונה נושאת את סוג הנכס והשכונה, השנייה את
       שאר הפרטים. כל שורה נחתכת לעצמה, ושתיהן שומרות את גובהן גם כשהן
       ריקות — אריח בלי שם משרד לא מקצר את הכרטיס שלו ביחס לשכניו. */
    '.pc-where{margin-top:3px;display:flex;flex-direction:column}',
    '.pc-where span{',
    '  font-size:.74rem;color:var(--ink-soft,#5A6068);line-height:1.4;min-height:1.4em;',
    '  display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;',
    '  overflow-wrap:anywhere}',
    '.pc-where .pc-where-sub{font-size:.92em;opacity:.88}',

    /* ---------- שכבת ההגנה על התמונה ----------
       שני גרדיאנטים כהים ושקופים — אחד מהראש ואחד מהתחתית — שמבטיחים
       שהתגיות שמעליהם ייקראו על כל תמונה, גם על שמיים לבנים. ‏z-index:1
       מציב אותם מעל התמונה ומתחת לתגיות (2) ולכפתור השמירה (3).

       הרמפות נגמרות בסביבות 45% מכל צד, כלומר יותר ממחצית התמונה — בדיוק
       הנתח שהעין באה לראות — נשארת נקייה לגמרי. שכבה שנמתחה עד האמצע
       הכהתה גם צילומי סלון בהירים שאין עליהם שום תגית. */
    '.pc-scrim{',
    '  position:absolute;inset:0;z-index:1;pointer-events:none;',
    '  background:',
    '    linear-gradient(to bottom,rgba(10,18,30,.46) 0%,rgba(10,18,30,.13) 26%,rgba(10,18,30,0) 46%),',
    '    linear-gradient(to top,rgba(10,18,30,.46) 0%,rgba(10,18,30,.11) 24%,rgba(10,18,30,0) 44%)}',

    /* שורת המאפיינים: אייקון ומספר, מופרדים ברווח ולא במסגרת */
    /* ‏min-height שומר את גובה השורה גם באריח שאין לו אף מאפיין (מגרש,
       למשל), כדי שכל האריחים ברצועה יישארו באותו גובה בדיוק */
    '.pc-facts{display:flex;flex-wrap:wrap;align-items:center;gap:4px 13px;margin-top:8px;',
    '  font-size:.78rem;min-height:1.35em}',
    '.pc-fact{display:inline-flex;align-items:center;gap:4px;',
    '  font-size:.78rem;font-weight:600;color:var(--ink-soft,#5A6068);line-height:1.2;white-space:nowrap}',
    '.pc-fact svg{width:15px;height:15px;flex:none;opacity:.85}',

    /* התגיות שעל התמונה */
    '.pc-badges{position:absolute;top:9px;inset-inline-start:9px;z-index:2;',
    '  display:flex;gap:5px;flex-wrap:wrap;max-width:calc(100% - 18px)}',
    '.pc-badge{font-size:.66rem;font-weight:800;padding:3px 9px;border-radius:0;line-height:1.35;',
    '  color:#fff;border:1px solid rgba(255,255,255,.28);',
    '  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);white-space:nowrap}',
    '.pc-badge.is-sale{background:var(--pc-sale-bg,rgba(18,40,64,.72))}',
    '.pc-badge.is-rent{background:var(--pc-rent-bg,rgba(14,42,107,.78))}',
    '.pc-badge.is-excl{background:var(--pc-excl-bg,rgba(201,162,39,.86))}',
    '.pc-badge.is-ai{background:var(--pc-ai-bg,rgba(13,27,61,.82))}',
    '.pc-badge.is-commercial{background:var(--pc-commercial-bg,rgba(14,42,107,.8))}',

    '.pc-media{position:absolute;bottom:9px;inset-inline-start:9px;z-index:2;display:flex;gap:5px;flex-wrap:wrap}',
    '.pc-media span{display:inline-flex;align-items:center;gap:4px;font-size:.66rem;font-weight:700;',
    '  background:rgba(15,23,42,.58);color:#fff;border:1px solid rgba(255,255,255,.24);',
    '  padding:4px 9px;border-radius:0;',
    '  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}',
    '.pc-media svg{width:12px;height:12px}',

    /* ---------- אריח הכיסוי ----------
       עד כה התמונה הייתה רצועה של 94px בראש האריח, ומתחתיה גוף לבן שתפס
       את רוב הגובה — כלומר הנתון שמוכר נכס קיבל את החלק הקטן, ורצועת
       הנכסים נראתה קטנה לצד קרוסלת המתווכים שבאותו עמוד, שבה התמונה *היא*
       הכרטיס.

       כאן אותו מבנה בדיוק כמו באריח המתווך/ת: התמונה נפרשת על כל הכרטיס,
       והטקסט יורד עליה על scrim כהה בתחתית. ה-markup לא משתנה — ‎.thumb‎
       ו-‎.body‎ נשארים איפה שהם, רק שהראשון נעשה מוחלט והשני מרחף מעליו —
       ולכן שלושת הדפים שמציירים אריח נכס מקבלים את זה מאותו קובץ.

       ‏--pc-cover-h הוא הגובה, ומי שמגדיר ‎--card-h‎ (דף הבית) מקבל בדיוק
       את גובה שאר הקרוסלות שלו. */
    '.prop-card.pc-cover{',
    '  position:relative;display:flex;flex-direction:column;overflow:hidden;',
    '  min-height:var(--pc-cover-h,var(--card-h,215px));background:#0b1420}',
    /* ‏inset:0 עם specificity שגובר על גובה קבוע שדף מסוים נתן לתמונונת */
    '.prop-card.pc-cover > .thumb{',
    '  position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto;z-index:0}',
    /* הריפוד העליון הוא הרמפה של הגרדיאנט ולא מרווח לטקסט, ולכן הוא
       באחוזים מרוחב האריח: ‏38px קבועים על אריח ברוחב 105px הכהו כמעט את
       כולו, ועל אריח ברשת הם היו פס דק מדי מכדי להפריד את הטקסט מהתמונה. */
    '.prop-card.pc-cover > .body{',
    '  position:relative;z-index:2;margin-top:auto;color:#fff;padding:9% 10px 10px;',
    '  background:linear-gradient(to top,rgba(6,20,34,.95) 38%,rgba(6,20,34,.66) 72%,rgba(6,20,34,0))}',
    /* הסרטון יושב מעל תמונת הרקע ומתחת לכל השאר. ‏pointer-events:none —
       לחיצה על האריח פותחת את הנכס, ואסור שהווידאו יבלע אותה. */
    '.pc-cover-video{',
    '  position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;',
    '  z-index:0;pointer-events:none}',
    /* ‏scrim העליון של התגיות מיותר כאן — ה-scrim התחתון של הטקסט חזק
       הרבה יותר, ושניהם יחד הכהו את התמונה כולה. */
    '.prop-card.pc-cover .pc-scrim{',
    '  background:linear-gradient(to bottom,rgba(10,18,30,.5) 0%,rgba(10,18,30,.14) 26%,rgba(10,18,30,0) 48%)}',
    /* הטקסט על התמונה. גדלי הגופן נשארים של הדף — רצועה צרה כבר מקטינה
       אותם אצלה — וכאן משתנים רק הצבע והמרווחים. כל ‎min-height‎ שנועד
       ליישר אריחים בגוף לבן יורד: כאן הוא רק דוחף את הטקסט כלפי מעלה
       וגוזל מהתמונה, והאריחים מיושרים ממילא בגובה משותף.

       שלוש שורות בסך הכול — מחיר, מיקום, מאפיינים — בדיוק כמו באריח
       המתווך/ת שממנו נגזר המבנה. הכותרת מצטרפת רק כשנשאר בה משהו. */
    '.prop-card.pc-cover .pc-price{color:#fff}',
    '.prop-card.pc-cover .pc-price .pc-per{color:rgba(255,255,255,.84)}',
    '.prop-card.pc-cover .pc-price-none{color:rgba(255,255,255,.92)}',
    '.prop-card.pc-cover .pc-title{',
    '  color:#fff;-webkit-line-clamp:1;min-height:0;margin-top:2px;font-weight:600;opacity:.95}',
    '.prop-card.pc-cover .pc-title:empty{display:none}',
    '.prop-card.pc-cover .pc-where{margin-top:2px}',
    '.prop-card.pc-cover .pc-where span{color:rgba(255,255,255,.88);min-height:0;line-height:1.3}',
    '.prop-card.pc-cover .pc-where span:empty{display:none}',
    /* שורת המאפיינים הופכת לשורת טקסט אחת. ‏flex עם ‎flex-wrap‎ פרש ארבעה
       מאפיינים על ארבע שורות באריח ברוחב 125px — כלומר רוב גובה הכיסוי
       הלך על "3 חד׳ / 137 מ״ר / קומה 2 / חניה" בזה אחר זה, והתמונה נדחקה
       למעלה. האייקונים יורדים כאן ומפרידה ביניהם נקודה: בגודל הזה הם
       ממילא היו כתמים, והמילים אומרות את אותו הדבר ברבע מהרוחב. */
    '.prop-card.pc-cover .pc-facts{',
    '  display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
    '  margin-top:6px;min-height:0}',
    '.prop-card.pc-cover .pc-fact{display:inline;color:#fff;opacity:.94}',
    '.prop-card.pc-cover .pc-fact svg{display:none}',
    '.prop-card.pc-cover .pc-fact + .pc-fact::before{content:" · ";opacity:.65}',
    '.prop-card.pc-cover .pc-facts:empty{display:none}',
    /* תגיות המדיה יורדות באריח הכיסוי: הן ישבו בדיוק במקום שהטקסט תופס
       עכשיו, ותגית "סרטון" מיותרת ממילא כשהסרטון מנגן מול העיניים. */
    '.prop-card.pc-cover .pc-media{display:none}',
    /* ממלא־המקום של נכס בלי תמונות היה ממורכז בגובה 94px; עכשיו יש לו
       כרטיס שלם, והוא נדחף מעל ה-scrim כדי שלא ייקרא מבעד לטקסט. */
    '.prop-card.pc-cover .thumb-fallback{justify-content:flex-start;padding-top:16%}',
  ].join('\n');

  var stylesInjected = false;
  function ensureStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-property-card', '');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  global.PropertyCard = {
    ICONS: ICONS,
    priceHtml: priceHtml,
    titleHtml: titleHtml,
    whereHtml: whereHtml,
    factsHtml: factsHtml,
    badgesHtml: badgesHtml,
    scrimHtml: scrimHtml,
    hasPhoto: hasPhoto,
    mediaHtml: mediaHtml,
    distinctTitle: distinctTitle,
    coverVideoHtml: coverVideoHtml,
    hydrateVideos: hydrateVideos,
    mediaRank: mediaRank,
    sortByMedia: sortByMedia,
    visualizedIds: visualizedIds,
    allVisualizedIds: allVisualizedIds,
    hasFeature: hasFeature,
    injectStyles: ensureStyles,
  };
})(window);
