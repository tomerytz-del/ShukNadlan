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
  function titleHtml(p) {
    ensureStyles();
    var prop = p || {};
    var text = prop.title || prop.property_type || '';
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
    mediaRank: mediaRank,
    sortByMedia: sortByMedia,
    visualizedIds: visualizedIds,
    allVisualizedIds: allVisualizedIds,
    hasFeature: hasFeature,
    injectStyles: ensureStyles,
  };
})(window);
