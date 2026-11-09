/* ============================================================================
   מסלולי המנוי — קטלוג משותף
   ----------------------------------------------------------------------------
   שלושה מסלולים, שלושה שמות מסחריים, ומקום אחד שמחזיק אותם: דף המסלולים
   (‏pricing.html), מסך בחירת המסלול ב-CRM, תגית המסלול בכותרת ורשימת הצוות.
   בלי הקובץ הזה אותם שמות ומחירים היו נכתבים ארבע פעמים, והראשון שהיה משתנה
   היה מייצר אתר שאומר ₪750 במקום אחד ו-₪690 באחר.

   **המזהים במסד נשארים free / mid / premium.** רק התצוגה השתנתה. כל ה-RLS,
   ה-views, הטריגרים והגייטינג של היכולות בתשלום (‏cma_report, ‏property_video_tier,
   הדמיות, מידע תכנוני) משווים למחרוזות האלה — החלפתן הייתה מיגרציה שנוגעת
   בעשרות מקומות, ואינה קונה דבר מלבד שם יפה יותר בעמודה.

     free    → Pay&GO
     mid     → PROFESSIONAL
     premium → Elite

   שימוש:
     Tiers.list()                 // שלושת המסלולים לפי סדר התצוגה
     Tiers.byId('mid')            // { id, name, priceMonthly, features, ... }
     Tiers.label('premium')       // 'Elite'
     Tiers.priceText('mid')       // '₪199 / חודש'
     Tiers.promo()                // הגדרת הטבת ההשקה
     Tiers.promoState(member)     // מצב ההטבה של סוכן/ת מסוים/ת
     Tiers.switchOpen()           // האם מעבר בין מסלולים פתוח בכלל

   ‏JS גולמי בלי תלויות, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------- הטבת ההשקה ----------
     כל מי שמצטרף/ת עכשיו מקבל/ת Elite חינם לחודשיים (עד 8.11.2026: חצי שנה), ובשלב הבחירה אין לו/ה
     בכלל אפשרות לבחור מסלול נמוך יותר. זו החלטה שיווקית של תקופת ההשקה,
     ולכן היא דגל אחד שאפשר לכבות — ולא התנהגות שמפוזרת בקוד.

     **המקור האמיתי הוא השרת.** הענקת ההטבה נעשית ב-‎grant_launch_promo‎ במסד
     (‏supabase/migrations/…_launch_promo_tiers.sql), וסיומה ב-‎promo-lifecycle‎.
     הערכים כאן נועדו לתצוגה בלבד, וכיבוי הדגל הזה לבדו אינו מפסיק להעניק
     את ההטבה — הוא רק מפסיק לפרסם אותה. */
  var PROMO = {
    active: true,
    tier: 'premium',
    months: 2,
    /* שתי ההתראות לפני הסיום, בימים לפני תום התקופה. חודש לפני ושבועיים
       אחר כך — אותם מספרים בדיוק רשומים ב-promo-lifecycle. */
    noticeDaysBefore: [30, 14],
    /* ועוד שתי תזכורות בוואטסאפ בלבד: שבוע ויום לפני (PROMO_WHATSAPP_DAYS). */
    whatsappDaysBefore: [7, 1],
    headline: 'חודשיים Elite במתנה',
    sub: 'לכל סוכן/ת שמצטרף/ת עכשיו - המסלול המלא, בלי תשלום ובלי כרטיס אשראי. בתום התקופה בוחרים מסלול, ומי שלא בוחר/ת ממשיך/ה ב-Pay&GO.',
  };

  /* ---------- מעבר בין מסלולים: סגור בשלב הזה ----------
     ‏`set_tier` החילה ירידה ל-Pay&GO **מיד**, בלי שאלה ובלי אישור, ומדף
     המסלולים היא הייתה לחיצה אחת: ‏`crm.html?tier=free` נצרך בטעינת הדשבורד
     וקורא ל-`chooseTier` מעצמו. כך ירד חשבון מ-Elite ל-Pay&GO בטעות —
     והירידה גוררת גם מחיקה חד-כיוונית של מספרי טלפון מהתיאורים ומהביו
     (`paygo_text_rules_apply`), כלומר נזק שחזרה למסלול אינה מתקנת.

     כל עוד `open` כבוי, אף מסלול אינו משתנה מהדפדפן: הירידה ל-Pay&GO
     נדחית בשרת, ומסלול בתשלום ממילא רק רושם בקשה שההנהלה מאשרת במסך ניהול
     המנויים (`admin_apply_tier_change`) — שם יש גם מי שמאשר/ת וגם שורת
     יומן. זו גם הדרך לתקן מסלול שהשתנה בטעות, ולכן היא נשארת פתוחה.

     **הנעילה האמיתית בשרת** (‏`join-agency/set_tier`), והערך כאן הוא
     התצוגה: כפתור שנראה לחיץ ונדחה אחר כך גרוע משניהם. */
  var SWITCH = {
    open: false,
    note: 'מעבר ל-Pay&GO סגור כרגע ונעשה מולנו. לפרטים: shuknadlan@gmail.com',
  };

  /* ‏priceMonthly הוא לפני מע"מ, כי כך מחירי B2B מוצגים בישראל וכך נכתב
     בכל מקום שמדבר על המחיר. ‏vat:true מוסיף את הכיתוב "+ מע"מ" לצידו.

     ‏**שתי רשימות, ובכוונה.** ‏features היא הרשימה המלאה, ומסך בחירת המסלול
     ב-CRM קורא ממנה (שלוש השורות הראשונות, וה-strong בהשוואת שדרוג).
     ‏cardFeatures היא שש השורות הקצרות שבכרטיסים של pricing.html, והיא
     של הדף הזה בלבד: ‏{ text, on, bold? } - ‏bold הוא הרישא המודגשת, ו-text
     ממשיך אותה. ‏quotaLine היא שורת המכסה בתחתית הכרטיס, מעל הכפתור. ‏tagline ו-badge
     מוצגים רק ב-pricing.html (נבדק ב-19.10.2026). */
  var CATALOG = [
    {
      id: 'free',
      name: 'Pay&GO',
      tagline: 'מערכת מלאה בלי דמי מנוי. משלמים רק על פנייה מעבר ל-10 בחודש.',
      pitch: 'משלמים רק כשיש פנייה',
      priceMonthly: 0,
      vat: false,
      priceNote: 'ללא דמי מנוי · ₪25 לפנייה מעבר למכסה',
      color: 'paygo',
      cta: 'התחלה עם Pay&GO',
      features: [
        { text: 'מערכת CRM מלאה - נכסים, לידים, לקוחות ועמלות', on: true },
        { text: 'פרסום אוטומטי ברשתות החברתיות - פייסבוק ואינסטגרם', on: true },
        { text: 'פרסום נכסים והחתמת מסמכי תיווך - ללא הגבלה', on: true },
        { text: 'שיתוף פעולה ומציאת התאמות עם כל יועצי הנדל״ן באזור', on: true },
        /* מכסה אחת לכל המקורות, ולא מכסה לכל באנר. ‏claim_lead במסד סופרת
           את כל הפניות שנפתחות באותו מונה חודשי — free_quota_used — ולכן
           נוסח שמבטיח "10 לידי קונה/שוכר" בלבד היה מתאר מכסה שאינה קיימת. */
        { text: '10 פניות בחינם בחודש - באנרים, מחשבונים ולידי קונה/שוכר יחד', on: true },
        { text: 'מעבר למכסה: ₪25 לפנייה מדף הנכס, המשרד או הסוכן/ת שלך', on: true },
        { text: 'דף סוכן/ת אישי עם איסוף פניות', on: true },
        { text: 'מספר טלפון וירטואלי - ניתוב, הקלטה, תמלול וסיכום כל שיחה בוואטסאפ - ₪89 לחודש + מע״מ', on: true },
        /* פתוח לכל המסלולים (office-coach לשלושת המאמנים, office_dashboard), ולכן הוא כאן
           ולא בכרטיס בתשלום - שני האחרים יורשים אותו ב"כל מה שכלול". */
        { text: 'מנטור AI - יומי לכל סוכן/ת, ושבועי עם דאשבורד ניהולי למנהל/ת המשרד ולמנהלי הצוותים', on: true },
        /* ליד בעלים של הפלטפורמה פתוח גם כאן מ-9.11.2026, במחיר גבוה יותר ורק
           כשאין סוכן/ת בתשלום שמתאים/ה (claim_lead, owner-lead-intake). הנוסח
           "ליד ב-₪N" נבדק ב-check_pricing.py מול ppl_price_owner_free. */
        { text: 'ליד בעל-נכס מהפלטפורמה - ליד ב-₪69, אחרי סוכני המנוי', on: true },
        { text: 'כלי ה-AI: תיאור שיווקי, CMA, סרטונים, הדמיות וסיורי 360°', on: false },
        { text: 'מידע תכנוני ומפת מיקום מדויקת בדף הנכס', on: false },
      ],
      quotaLine: '10 פניות בחודש כלולות · מעבר לכך ₪25 לפנייה',
      cardFeatures: [
        { bold: 'מערכת CRM מלאה', text: ' - נכסים, לידים, לקוחות ועמלות', on: true },
        { bold: 'שיתופי פעולה', text: ' עם כל יועצי הנדל״ן באזור', on: true },
        { bold: 'החתמה דיגיטלית', text: ' ופרסום נכסים ללא הגבלה', on: true },
        { text: 'פרסום אוטומטי לפייסבוק ואינסטגרם', on: true },
        { text: 'דף סוכן/ת אישי ומנטור AI יומי', on: true },
        { text: 'גבריאלה וכלי ה-AI', on: false },
      ],
    },
    {
      id: 'mid',
      name: 'PROFESSIONAL',
      tagline: 'גבריאלה בוואטסאפ ולידי קונים ללא הגבלה, למי שעובד/ת בעיקר עם קונים ושוכרים.',
      pitch: 'הלידים מפסיקים להיות שיקול',
      priceMonthly: 199,
      vat: true,
      priceNote: 'לחודש, לפני מע״מ · ללא התחייבות',
      color: 'pro',
      cta: 'בחירה ב-PROFESSIONAL',
      /* ‏strong: true מסמן את השורה שהיא הסיבה לשדרג. הכרטיס מדגיש אותה,
         ומסך בחירת המסלול ב-CRM מדגיש את אותה שורה בדיוק — כי מי שקורא/ת
         רשימה של שמונה שורות זהות בעיצובן אינו/ה רואה בה שום היררכיה. */
      features: [
        { text: 'כל מה שכלול ב-Pay&GO', on: true },
        /* "שימוש הוגן" - המילה בלבד. הסף עצמו הוא הגדרה פנימית ב-pricing_config
           (gabriela_fair_use_monthly) ואינו מתפרסם; ב-Elite אין תקרה. */
        { text: 'גבריאלה, עוזרת אישית בוואטסאפ (שימוש הוגן) - כלי שובר שוק שסוגר לך עסקאות מהנייד',
          on: true, strong: true },
        { text: 'פרסום אוטומטי ברשתות החברתיות - פייסבוק ואינסטגרם', on: true },
        { text: 'יומן פגישות ומשימות עם תזכורות בוואטסאפ, וחיבור ליומן Google', on: true },
        { text: 'מעבירים מייל לגבריאלה - והיא מטפלת ועונה לך בוואטסאפ', on: true },
        { text: 'לידי קונה/שוכר ללא הגבלה - בלי מכסה ובלי תשלום לפנייה', on: true },
        { text: 'תיאור שיווקי אוטומטי ב-AI לכל נכס', on: true },
        { text: 'דוח CMA, מידע תכנוני ומפת מיקום מדויקת', on: true },
        { text: 'סרטון שיווקי מהתמונות - ₪25 להפקה', on: true },
        { text: 'לידי בעל-נכס - ₪50 לליד', on: true },
        { text: 'מספר טלפון וירטואלי - ניתוב, הקלטה, תמלול וסיכום כל שיחה בוואטסאפ - ₪89 לחודש + מע״מ', on: true },
        { text: 'הדמיות AI והפקת סיורי 360°', on: false },
      ],
      quotaLine: 'פניות קונים ושוכרים ללא הגבלה',
      /* המחירים כאן בנוסח שהתבניות ב-check_pricing.py מכירות (‏"₪N לליד",
         ‏"₪N להפקה"), כדי שמחיר שמשתנה במסד יתפוס גם את הכרטיס. */
      cardFeatures: [
        { bold: 'כל הבסיס של Pay&GO', text: '', on: true },
        { bold: 'גבריאלה', text: ' - עוזרת אישית בוואטסאפ, שימוש הוגן', on: true },
        { text: 'יומן פגישות, תזכורות וחיבור ל-Google', on: true },
        { text: 'תיאור שיווקי AI, דוח CMA ומידע תכנוני', on: true },
        { text: 'לידי בעל-נכס ₪50 לליד · סרטון ₪25 להפקה', on: true },
        { text: 'הדמיות AI וסיורי 360°', on: false },
      ],
    },
    {
      id: 'premium',
      name: 'Elite',
      tagline: 'יותר נכסים לתיק, פחות עבודה על כל נכס.',
      sub: '8 סרטונים בחודש, הדמיות, סיורי 360° ודוח CMA לכל כתובת. מחיר אחד, בלי לשלם על כל סרטון.',
      pitch: 'הכול כלול, בלי מחשבון',
      priceMonthly: 399,
      vat: true,
      priceNote: 'לחודש, לפני מע״מ · ללא התחייבות',
      color: 'elite',
      badge: 'הכי משתלם',
      cta: 'הצטרפות ל-Elite',
      features: [
        { text: 'כל מה שכלול ב-PROFESSIONAL', on: true },
        { text: 'גבריאלה, עוזרת אישית בוואטסאפ, בלי תקרת שימוש - כלי שובר שוק שסוגר לך עסקאות מהנייד',
          on: true, strong: true },
        { text: 'פרסום אוטומטי ברשתות החברתיות - פייסבוק ואינסטגרם', on: true },
        { text: 'חבילת ה-AI שמשדרגת את הנכס - סרטונים, הדמיות וסיורי 360°',
          on: true, strong: true },
        { text: 'הדמיות AI לנכס פרטי ב-4 סגנונות עיצוב', on: true },
        { text: 'הדמיות AI לנכסים מסחריים', on: true },
        { text: '8 סרטונים שיווקיים בחודש, ללא חיוב', on: true },
        { text: 'הפקת סיורי 360° לדף הנכס - בלי הגבלה ובלי מנוי לספק', on: true },
        { text: 'לידי בעל-נכס - ₪50 לליד, לפני סוכני Pay&GO', on: true },
        { text: 'דוח CMA לכל כתובת, גם לנכס שאינו במערכת', on: true },
        /* מ-9.11.2026 המספר אינו כלול באף מסלול (docs/call-tracking.md). */
        { text: 'מספר טלפון וירטואלי - ניתוב, הקלטה, תמלול וסיכום כל שיחה בוואטסאפ - ₪89 לחודש + מע״מ', on: true },
      ],
      quotaLine: '',
      cardFeatures: [
        { bold: '8 סרטונים שיווקיים בחודש', text: ', ללא חיוב: קריינות, מוזיקה והפרטים שלך, בלי לצלם', on: true },
        { bold: 'גבריאלה בלי תקרת שימוש', text: ': מעלה נכס, מתאמת ביקור ומפיקה סרטון לפי הודעה', on: true },
        { bold: 'הדמיות AI ב-4 סגנונות', text: ' וסיורי 360° בדף הנכס', on: true },
        { bold: 'דוח CMA לכל כתובת', text: ' וכמה נמכר ברחוב, לפני פגישת גיוס', on: true },
        { text: 'לידי בעל-נכס ₪50 לליד · מספר וירטואלי ₪89 לחודש + מע״מ', on: true },
        { text: 'כל הבסיס של Pay&GO ושל PROFESSIONAL', on: true },
      ],
    },
  ];

  var BY_ID = {};
  CATALOG.forEach(function (t) { BY_ID[t.id] = t; });

  var ORDER = CATALOG.map(function (t) { return t.id; });

  function byId(id) { return BY_ID[id] || null; }

  function label(id) {
    var t = byId(id);
    return t ? t.name : String(id || '');
  }

  /** "חודשיים" ולא "2 חודשים": הנוסח העברי של מספר חודשי ההטבה, במקום אחד
   *  לדף המסלולים, ל-CRM ולכל מי שמציג את ההטבה. */
  function promoMonthsText() {
    var m = PROMO.months;
    if (m === 1) return 'חודש';
    if (m === 2) return 'חודשיים';
    return m + ' חודשים';
  }

  /** ‏0 אינו "₪0" אלא "ללא דמי מנוי" — מחיר אפס שנכתב כמספר נקרא כמו טעות. */
  function priceText(id) {
    var t = byId(id);
    if (!t) return '';
    if (!t.priceMonthly) return 'ללא דמי מנוי';
    return '₪' + t.priceMonthly.toLocaleString('he-IL') + ' / חודש';
  }

  /** האם ‎a‎ יקר מ-‎b‎ (לפי סדר הקטלוג, לא לפי המחיר — הסדר הוא מה שקובע). */
  function isUpgrade(from, to) {
    return ORDER.indexOf(to) > ORDER.indexOf(from);
  }

  /* ---------- מצב ההטבה של סוכן/ת ----------
     מקבל את שורת ה-agency_members כמו שהיא חוזרת מהמסד ומחזיר תמונה אחת
     שכל הממשקים קוראים ממנה, כדי שהחישוב "כמה ימים נשארו" לא ייכתב שלוש
     פעמים עם שלוש טעויות עיגול שונות. */
  function promoState(member) {
    var out = { active: false, ended: false, endsAt: null, daysLeft: null, tier: null };
    if (!member || !member.promo_ends_at) return out;
    var ends = new Date(member.promo_ends_at);
    if (isNaN(ends.getTime())) return out;
    out.endsAt = ends;
    out.tier = member.promo_tier || PROMO.tier;
    var ms = ends.getTime() - Date.now();
    if (ms > 0 && !member.promo_ended_at) {
      out.active = true;
      // תמיד כלפי מעלה: "נשאר יום" ביום האחרון עדיף על "נשארו 0 ימים"
      out.daysLeft = Math.ceil(ms / 86400000);
    } else {
      out.ended = true;
      out.daysLeft = 0;
    }
    return out;
  }

  /** תאריך בעברית קצרה — 12 במרץ 2027. */
  function formatDate(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  global.Tiers = {
    CATALOG: CATALOG,
    ORDER: ORDER,
    PROMO: PROMO,
    SWITCH: SWITCH,
    switchOpen: function () { return SWITCH.open === true; },
    list: function () { return CATALOG.slice(); },
    byId: byId,
    label: label,
    priceText: priceText,
    isUpgrade: isUpgrade,
    promo: function () { return PROMO; },
    promoMonthsText: promoMonthsText,
    promoState: promoState,
    formatDate: formatDate,
  };
})(window);
