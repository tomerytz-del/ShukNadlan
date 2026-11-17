/* ============================================================================
   דפי נחיתה עיר → סוג נכס - /afula/בתים-פרטיים וחבריו
   ----------------------------------------------------------------------------
   מקור אחד לשרת ולדפדפן, כמו assets/neighborhood-render.js: הקובץ נטען
   כ-<script src> בדף, ומיובא ב-netlify/edge-functions/silo-page.ts לתופעת
   הלוואי שלו (globalThis.ShukSilo). מה שהשרת מגיש לסורק ומה שהדפדפן בונה
   כשהשרת לא הספיק הם אותו HTML. אין כאן export.

   שלושת הדפים האלה מחליפים כתובות סינון שגוגל כבר דירגה
   (?deal=sale&ptype=… ו-?deal=sale&rooms=3). search-pages.ts מפנה את
   ה-canonical שלהן לכאן. docs/search-landing-pages.md.

   אין כפתור שמירה: באתר אין שמירת נכס ציבורית, ולכן לא מוסיפים לב.
   ========================================================================== */
(function (root) {
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var IMG_HOST = "https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/";
  var SITE_NAME = "שוק נדל״ן";
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  /* ‏עיר לכל קידומת (‏/afula, ‏/haifa). ‏slug הוא cities.slug ו-/deals/{slug};
     ‏name הוא properties.city שהשאילתה מסננת עליו (מחרוזת, לא city_id);
     ‏market הוא ה-slug ב-assets/markets.js - דף של שוק שאינו live נשאר
     noindex ומחוץ ל-sitemap (‏lib/indexability.ts, ‏landingIndexable).
     ‏hoods הם [שם להצגה, slug] של neighborhoods, בסדר הא"ב; ‏near הם
     הצ'יפים שבמקום צ'יפ החדרים בדף 3 חדרים. השורה הראשונה של כל עיר
     נקראת ב-scripts/check_canonical.py, ולכן היא נשארת בשורה אחת.
     עיר חדשה: docs/search-landing-pages.md, "עיר נוספת". */
  var CITIES = [
    { slug: "afula", name: "עפולה", market: "afula-emek",
      cityId: "c2a8426f-7bac-4c48-bcb5-53a5ca06f001",
      home: "/",
      homeLabel: "עפולה והעמק",
      hoods: [
        ["אזור התעשייה", "אזור-התעשייה"],
        ["גבעת המורה", "גבעת-המורה"],
        ["דרום העיר", "דרום-העיר"],
        ["השכונה הצפון מערבית", "השכונה-הצפון-מערבית"],
        ["לב העמק C1", "לב-העמק-c1"],
        ["מזרח העיר", "מזרח-העיר"],
        ["מערב העיר (שיכון גאולים)", "מערב-העיר-שיכון-גאולים"],
        ["מרכז העיר", "מרכז-העיר"],
        ["עפולה הירוקה", "עפולה-הירוקה"],
        ["עפולה עלית", "עפולה-עלית"],
        ["רובע יזרעאל", "רובע-יזרעאל"],
      ],
      near: [["מרכז העיר", "מרכז-העיר"], ["רובע יזרעאל", "רובע-יזרעאל"], ["גבעת המורה", "גבעת-המורה"]],
      focus: [["עפולה עילית", "עפולה-עלית"], ["גבעת המורה", "גבעת-המורה"], ["מרכז העיר", "מרכז-העיר"], ["רובע יזרעאל", "רובע-יזרעאל"]],
      /* ‏"כולל בעפולה עילית" - אזור בתוך העיר שהחיפוש מזכיר בנפרד. */
      alsoIn: "עפולה עילית",
      /* ‏נוסח של עפולה שנכתב לעפולה (‏#968), גובר על התבנית שב-TYPES. */
      copy: {
        "בתים-פרטיים": {
          description: "בית פרטי למכירה בעפולה: בתים פרטיים, בתי קרקע וקוטג'ים מכל משרדי התיווך, כולל עפולה עילית, עם מחיר, גודל ותמונות.",
          intro: "בית פרטי למכירה בעפולה כולל כאן גם בית קרקע וגם קוטג'. אלה בתים למכירה מכל משרדי התיווך בעיר, כולל עפולה עילית וגבעת המורה, עם מחיר, גודל ותמונות.",
        },
      },
      /* דירות למכירה - לא במקום שלושת הסוגים. flats כמו ?deal=sale (בלי בית ומגרש). */
      extra: [
        /* הסוגים וסוג העסקה נבנים ב-withStock מהמלאי הפעיל, לא מהטקסט הזה. */
        {
          slug: "נדלן-מסחרי",
          what: "נדל״ן מסחרי",
          h1: "נדל״ן מסחרי בעפולה",
          label: "נדל״ן מסחרי בעפולה",
          benefit: "משרדים, חנויות, מחסנים וקליניקות · השכרה ומכירה",
          description: "משרדים, חנויות, מחסנים ושטחי מסחר למכירה ולהשכרה בעפולה. מחפשים משרד או חנות להשכרה? כל המודעות הפעילות במקום אחד.",
          intro: "מודעות נדל״ן מסחרי בעפולה ממשרדי התיווך באזור: משרדים, חנויות ושטחי מסחר, ולפי המלאי גם מחסנים ומגרשים. בכל מודעה מופיעים המחיר, הגודל והתמונות.",
          property_type: null,
          category: "commercial",
          anyDeal: true,
          dynamicStock: true,
          collection: true,
          crumbName: "עפולה",
          crumbPath: "/afula/דירות-למכירה",
          /* ‏בלי מספרים ובלי הבטחת מלאי. שלוש הראשונות היו כאן קודם; הראשונה
             נכתבת מחדש ב-withStock לפי הסוגים שבמלאי. */
          faqs: [
            ["אילו נכסים כלולים בעמוד?", "העמוד מציג את מודעות הנדל״ן המסחרי הפעילות בעפולה."],
            ["מי מפרסם את הנכסים?", "משרדי תיווך שמפרסמים באתר. בדף של כל נכס מופיעים שם המשרד ופרטי הקשר שלו."],
            ["מה עושים אם אין כרגע מודעות?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס שמתאים."],
            ["איפה מוצאים משרד להשכרה בעפולה?", "בעמוד הזה, ברשימת המודעות. בוחרים השכרה ואז משרד, ומצמצמים לפי שטח, מחיר ושכונה. אזור התעשייה ומרכז העיר הם בין האזורים שבהם מפורסמים משרדים."],
            ["יש חנויות או שטח מסחרי להשכרה?", "חנויות ושטחי מסחר מופיעים בעמוד כשמשרדי התיווך מפרסמים אותם, להשכרה ולמכירה. בוחרים חנות בשורת הסוגים. אם אין כרגע מה שמתאים, אפשר להשאיר התראה."],
            ["מה לגבי מחסן או מבנה תעשייה?", "מחסנים ומבני תעשייה מופיעים לפי המודעות הפעילות באותו יום, ואין התחייבות למלאי. אפשר להשאיר התראה ולקבל עדכון כשעולה נכס כזה."],
            ["אפשר גם לקנות?", "העמוד מציג גם נכסים מסחריים למכירה כשמפורסמות מודעות כאלה. מעבירים את המתג מהשכרה למכירה."],
            ["מחפשים ביקנעם, במגדל העמק או בעמק?", "העמוד הזה מתמקד בעפולה. אפשר להשאיר התראה ולציין את האזור שמעניין, ונעדכן כשעולה נכס מתאים. אין התחייבות למלאי ביישובים אחרים."],
          ],
          rooms: null,
        },
        {
          slug: "דירות-למכירה",
          what: "דירות",
          hero: "דירות-3-חדרים",
          h1: "דירות למכירה בעפולה",
          benefit: "דירות למכירה בעפולה מיועצי הנדל״ן והמשרדים בעיר.",
          description: "דירות למכירה בעפולה מיועצי הנדל״ן והמשרדים בעיר: מחיר, גודל ותמונות לכל מודעה פעילה, ופנייה מהירה דרך האתר.",
          intro: "דירות למכירה בעפולה מיועצי הנדל״ן והמשרדים בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות.",
          /* התשובה הראשונה רק כאן. השאר זהות ל-faqs() המשותף, כי הוא אומר
             "משרדי התיווך" ומשמש את שאר דפי הנחיתה. */
          faqs: [
            ["מאיפה המודעות בעמוד הזה?", "אלה נכסים למכירה בעפולה שיועצי נדל״ן ומשרדים מפרסמים באתר."],
            ["איפה רואים את המחיר ואת כל הפרטים?", "בדף של כל נכס מופיעים המחיר שפורסם והמפרט המלא. אם אין מחיר במודעה, אפשר לפנות דרך האתר ולשאול."],
            ["איפה רואים עסקאות ומחירי דירות?", "עסקאות שדווחו לרשות המסים נמצאות בעמוד העסקאות בעפולה, ומחירי דירות לפי חדרים בעמוד מחירי הדירות."],
            ["מה עושים אם אין כרגע מודעות?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס שמתאים."],
          ],
          property_type: null,
          property_types: ["דירה", "דופלקס", "טריפלקס", "סטודיו/לופט", "יחידת דיור", "מרתף/פרטר", "דירת גן", "גג/פנטהאוז"],
          rooms: null,
        },
      ],
    },
    /* ‏12 השכונות עם הכי הרבה עסקאות ב-market_deals_official (‏25.10.2026). */
    { slug: "haifa", name: "חיפה", market: "haifa",
      cityId: "751fcf13-a02b-4370-97a5-fc4ec42ea4fe",
      home: "/haifa",
      homeLabel: "חיפה והסביבה",
      hoods: [
        ["אחוזה", "אחוזה"],
        ["בת גלים", "בת-גלים"],
        ["גבעת זמר", "גבעת-זמר"],
        ["הדר מרכז", "הדר-מרכז"],
        ["הדר עליון", "הדר-עליון"],
        ["יזרעאליה", "יזרעאליה"],
        ["כרמל מערבי", "כרמל-מערבי"],
        ["מרכז הכרמל", "מרכז-הכרמל"],
        ["נווה שאנן", "נווה-שאנן"],
        ["קריית אליעזר", "קריית-אליעזר"],
        ["קריית חיים מזרחית", "קריית-חיים-מזרחית"],
        ["רמת הדר", "רמת-הדר"],
      ],
      near: [["נווה שאנן", "נווה-שאנן"], ["רמת הדר", "רמת-הדר"], ["הדר עליון", "הדר-עליון"]],
      focus: [["נווה שאנן", "נווה-שאנן"], ["רמת הדר", "רמת-הדר"], ["אחוזה", "אחוזה"], ["כרמל מערבי", "כרמל-מערבי"]],
    },
    /* ‏הקריות: ארבע ערים בשוק krayot, דף לכל עיר. השכונות - המגורים, לפי
       מספר העסקאות ב-market_deals_official (‏25.10.2026); בביאליק רק לשלוש
       יש עסקאות משויכות, ולכן כל שכונות המגורים. */
    { slug: "kiryat-ata", name: "קריית אתא", market: "krayot",
      cityId: "223f550b-0314-4887-9bd7-d2fd89bce754",
      home: "/krayot",
      homeLabel: "הקריות והסביבה",
      hoods: [
        ["אברמסקי", "אברמסקי"],
        ["גבעה א", "גבעה-א"],
        ["גבעת אלונים", "גבעת-אלונים"],
        ["גבעת הרקפות", "גבעת-הרקפות"],
        ["גבעת טל", "גבעת-טל"],
        ["גבעת רם", "גבעת-רם"],
        ["מרכז העיר", "מרכז-העיר"],
        ["נווה אברהם", "נווה-אברהם"],
        ["נווה חן", "נווה-חן"],
        ["קריית בנימין", "קריית-בנימין"],
        ["קריית פרוסטיג", "קריית-פרוסטיג"],
        ["קריית שטנר", "קריית-שטנר"],
      ],
      near: [["מרכז העיר", "מרכז-העיר"], ["גבעת אלונים", "גבעת-אלונים"], ["אברמסקי", "אברמסקי"]],
      focus: [["מרכז העיר", "מרכז-העיר"], ["גבעת אלונים", "גבעת-אלונים"], ["אברמסקי", "אברמסקי"], ["גבעה א", "גבעה-א"]],
    },
    { slug: "kiryat-bialik", name: "קריית ביאליק", market: "krayot",
      cityId: "234dcb60-1ef3-4960-89e9-8974cc0ca00e",
      home: "/krayot",
      homeLabel: "הקריות והסביבה",
      hoods: [
        ["אפק", "אפק"],
        ["ביאליק דרום", "ביאליק-דרום"],
        ["ביאליק הוותיקה", "ביאליק-הוותיקה"],
        ["גבעת הרקפות", "גבעת-הרקפות"],
        ["לב העיר", "לב-העיר"],
        ["נאות אפק", "נאות-אפק"],
        ["סביניה", "סביניה"],
        ["צור שלום", "צור-שלום"],
        ["קריון פרפר", "קריון-פרפר"],
        ["קריית שמריהו", "קריית-שמריהו"],
        ["שירת העיר", "שירת-העיר"],
      ],
      near: [["צור שלום", "צור-שלום"], ["גבעת הרקפות", "גבעת-הרקפות"], ["אפק", "אפק"]],
      focus: [["צור שלום", "צור-שלום"], ["גבעת הרקפות", "גבעת-הרקפות"], ["אפק", "אפק"], ["ביאליק דרום", "ביאליק-דרום"]],
    },
    { slug: "kiryat-motzkin", name: "קריית מוצקין", market: "krayot",
      cityId: "4d70f4b0-91ea-444d-b2f9-373e52b0ef35",
      home: "/krayot",
      homeLabel: "הקריות והסביבה",
      hoods: [
        ["לב העיר", "לב-העיר"],
        ["מוצקין הוותיקה", "מוצקין-הוותיקה"],
        ["מוצקין הצעירה ונווה גנים", "מוצקין-הצעירה-ונווה-גנים"],
        ["משכנות אומנים", "משכנות-אומנים"],
      ],
      near: [["מוצקין הוותיקה", "מוצקין-הוותיקה"], ["לב העיר", "לב-העיר"], ["משכנות אומנים", "משכנות-אומנים"]],
      focus: [["מוצקין הוותיקה", "מוצקין-הוותיקה"], ["לב העיר", "לב-העיר"], ["משכנות אומנים", "משכנות-אומנים"], ["מוצקין הצעירה ונווה גנים", "מוצקין-הצעירה-ונווה-גנים"]],
    },
    { slug: "kiryat-yam", name: "קריית ים", market: "krayot",
      cityId: "696b830c-a923-4e9a-a83e-e5447c4b3f04",
      home: "/krayot",
      homeLabel: "הקריות והסביבה",
      hoods: [
        ["אלמוגים", "אלמוגים"],
        ["בנה ביתך", "בנה-ביתך"],
        ["סביוני ים", "סביוני-ים"],
        ["קריית ים א'", "קריית-ים-א"],
        ["קריית ים ב'", "קריית-ים-ב"],
        ["קריית ים ג'", "קריית-ים-ג"],
        ["קריית ים ד'", "קריית-ים-ד"],
      ],
      near: [["קריית ים ב'", "קריית-ים-ב"], ["קריית ים ד'", "קריית-ים-ד"], ["קריית ים ג'", "קריית-ים-ג"]],
      focus: [["קריית ים ב'", "קריית-ים-ב"], ["קריית ים ד'", "קריית-ים-ד"], ["קריית ים ג'", "קריית-ים-ג"], ["קריית ים א'", "קריית-ים-א"]],
    },
    /* ‏נוף הגליל ומגדל העמק: שוק nof-hagalil-migdal אינו חי. הדף מלא
       לגולש/ת, עם noindex, ובלי שורה ב-sitemap עד ההדלקה. סוג אחד,
       דירות, לפי המלאי (דירה ודירת גן), לא שלושת הסוגים של עפולה. */
    { slug: "nof-hagalil", name: "נוף הגליל", market: "nof-hagalil-migdal",
      cityId: "5d1d3382-1094-423f-8e76-9d3e153675dc",
      home: "/nof-hagalil-migdal",
      homeLabel: "נוף הגליל ומגדל העמק",
      hoods: [], near: [], focus: [],
      ld: "collection",
      types: [{
        slug: "דירות-למכירה",
        what: "דירות",
        hero: "דירות-3-חדרים",
        h1: "דירות למכירה בנוף הגליל",
        benefit: "דירות ודירות גן למכירה בנוף הגליל, ממשרדי התיווך שמפרסמים באתר.",
        description: "דירות ודירות גן למכירה בנוף הגליל, מכל משרדי התיווך באתר, עם מחיר, גודל ותמונות לכל מודעה פעילה. ב-12 החודשים האחרונים דווחו 1,020 עסקאות בעיר.",
        intro: "בעמוד הזה מרוכזות דירות למכירה בנוף הגליל, כולל דירות גן, מכל משרדי התיווך שמפרסמים באתר. בכל מודעה מופיעים המחיר, הגודל והתמונות כפי שפורסמו. ב-12 החודשים האחרונים דווחו 1,020 עסקאות בעיר.",
        property_type: null,
        property_types: ["דירה", "דירת גן"],
        rooms: null,
        faqs: [
          ["אילו נכסים כלולים בעמוד?", "דירות ודירות גן למכירה בנוף הגליל. בתים פרטיים ומגרשים אינם בעמוד הזה."],
          ["מי מפרסם את הנכסים?", "משרדי תיווך שמפרסמים באתר. בדף של כל נכס מופיעים שם המשרד ופרטי הקשר שלו."],
          ["כמה עסקאות דווחו בעיר?", "ב-12 החודשים האחרונים דווחו 1,020 עסקאות בנוף הגליל, מתוך דיווחי רשות המסים."],
          ["איפה רואים מחירי עסקאות?", "בעמוד העסקאות של נוף הגליל, מתוך דיווחי רשות המסים. ביישוב עם פחות מ-5 עסקאות בשנה האחרונה האתר אינו מציג מחיר חציוני."],
          ["מה עושים אם אין כרגע דירה שמתאימה?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס מתאים בנוף הגליל."],
        ],
      }],
    },
    { slug: "migdal-haemek", name: "מגדל העמק", market: "nof-hagalil-migdal",
      cityId: "fa3283cc-37bd-4042-9185-8a45059f133a",
      home: "/nof-hagalil-migdal",
      homeLabel: "נוף הגליל ומגדל העמק",
      hoods: [], near: [], focus: [],
      ld: "collection",
      types: [{
        slug: "דירות-למכירה",
        what: "דירות",
        hero: "דירות-3-חדרים",
        h1: "דירות למכירה במגדל העמק",
        benefit: "דירות למכירה במגדל העמק, ממשרדי התיווך שמפרסמים באתר.",
        description: "דירות למכירה במגדל העמק, מכל משרדי התיווך באתר, עם מחיר, גודל ותמונות לכל מודעה פעילה. ב-12 החודשים האחרונים דווחו 562 עסקאות בעיר.",
        intro: "בעמוד הזה מרוכזות דירות למכירה במגדל העמק, מכל משרדי התיווך שמפרסמים באתר. בכל מודעה מופיעים המחיר, הגודל והתמונות כפי שפורסמו. ב-12 החודשים האחרונים דווחו 562 עסקאות בעיר.",
        property_type: null,
        property_types: ["דירה", "דירת גן"],
        rooms: null,
        faqs: [
          ["אילו נכסים כלולים בעמוד?", "דירות ודירות גן למכירה במגדל העמק. בתים פרטיים ומגרשים אינם בעמוד הזה."],
          ["מי מפרסם את הנכסים?", "משרדי תיווך שמפרסמים באתר. בדף של כל נכס מופיעים שם המשרד ופרטי הקשר שלו."],
          ["כמה עסקאות דווחו בעיר?", "ב-12 החודשים האחרונים דווחו 562 עסקאות במגדל העמק, מתוך דיווחי רשות המסים."],
          ["איפה רואים מחירי עסקאות?", "בעמוד העסקאות של מגדל העמק, מתוך דיווחי רשות המסים. ביישוב עם פחות מ-5 עסקאות בשנה האחרונה האתר אינו מציג מחיר חציוני."],
          ["מה עושים אם אין כרגע דירה שמתאימה?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס מתאים במגדל העמק."],
        ],
      }],
    },
    /* ‏עמוד עמק: כל יישובי afula-emek חוץ מעפולה. שדה נחום ב-beit-shean
       ואינו כאן. names מחליף את name בשאילתה. אין דף מתווכים. */
    { slug: "emek-yizrael", name: "עמק יזרעאל", market: "afula-emek",
      names: ["אביטל", "אדירים", "אומן", "אחוזת ברק", "בית השיטה", "בלפוריה", "ברק", "גבע", "גבת", "גדיש", "גדעונה", "גזית", "גיניגר", "גן נר", "דבורה", "דברת", "היוגב", "חבר", "יזרעאל", "יעל", "יפעת", "כפר ברוך", "כפר גדעון", "כפר יחזקאל", "כפר תבור", "מבואות הגלבוע", "מגן שאול", "מולדת", "מזרע", "מיטב", "מיטל", "מלאה", "מרחביה (מושב)", "מרחביה (קיבוץ)", "נהלל", "נורית", "ניר יפה", "עין דור", "עין חרוד (איחוד)", "עין חרוד (מאוחד)", "פרזון", "רם-און", "רמת דוד", "רמת צבי", "שריד", "תל יוסף", "תל עדשים"],
      cityId: null,
      home: "/",
      homeLabel: "עפולה והעמק",
      noBrokers: true,
      dealsPath: "/deals",
      dealsLabel: "עסקאות לפי יישוב",
      trustTitle: "משרדי תיווך מעפולה והעמק",
      trustNote: "המודעות מתפרסמות על ידי משרדי תיווך שפועלים בעפולה ובעמק.",
      hoods: [], near: [], focus: [],
      ld: "collection",
      also: [
        ["/afula/בתים-פרטיים", "בתים פרטיים למכירה בעפולה"],
        ["/afula/דירות-גן", "דירות גן למכירה בעפולה"],
        ["/afula/דירות-למכירה", "דירות למכירה בעפולה"],
        ["/afula/דירות-3-חדרים", "דירות 3 חדרים למכירה בעפולה"],
        ["/afula/נדלן-מסחרי", "נדל״ן מסחרי בעפולה"],
        ["/afula/מתווכים", "מתווכים בעפולה"],
      ],
      types: [{
        slug: "בתים-ומגרשים",
        what: "בתים ומגרשים",
        hero: "בתים-פרטיים",
        h1: "בתים ומגרשים למכירה ביישובי עמק יזרעאל",
        benefit: "בתים ומגרשים במושבים וביישובים שסביב עפולה, ממשרדי התיווך באזור.",
        description: "בתים פרטיים ומגרשים למכירה במושבים וביישובים שסביב עפולה, מכל משרדי התיווך באתר, עם מחיר, גודל ותמונות לכל מודעה פעילה.",
        intro: "בעמוד הזה מרוכזים בתים פרטיים ומגרשים למכירה ביישובים שסביב עפולה, ביניהם היוגב, אומן וחבר. המודעות מתפרסמות על ידי משרדי תיווך שפועלים בעפולה ובעמק, ובכל אחת מופיעים המחיר, הגודל והתמונות כפי שפורסמו. דירות בעפולה עצמה מופיעות בדפים של העיר: בתים פרטיים, דירות גן ודירות 3 חדרים.",
        property_type: null,
        property_types: ["בית פרטי/קוטג'", "מגרש"],
        rooms: null,
        faqs: [
          ["אילו יישובים כלולים בעמוד?", "היישובים שסביב עפולה שהאתר משייך לאזור עפולה והעמק, ביניהם היוגב, אומן, חבר, גן נר, כפר תבור, תל עדשים, בלפוריה, מרחביה, כפר גדעון, מגן שאול, נורית, גדיש, אביטל ואחוזת ברק. נכסים בעפולה עצמה מופיעים בדפים של העיר."],
          ["מי מפרסם את הנכסים?", "משרדי תיווך שמפרסמים באתר. בדף של כל נכס מופיעים שם המשרד ופרטי הקשר שלו."],
          ["מה כדאי לבדוק לפני קניית מגרש או בית במושב?", "את ייעוד הקרקע וזכויות הבנייה, מול הוועדה המקומית לתכנון ובנייה, ואת תנאי הקבלה ליישוב, שבחלק מהיישובים כוללים הליך קבלה. הפרטים שפורסמו במודעה מופיעים בדף הנכס."],
          ["איפה רואים מחירי עסקאות ביישובים?", "בעמוד עסקאות הנדל״ן לפי יישוב, מתוך דיווחי רשות המסים. ביישוב עם פחות מ-5 עסקאות בשנה האחרונה האתר אינו מציג מחיר חציוני."],
          ["מה עושים אם אין כרגע נכס שמתאים לי?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס מתאים באחד מיישובי העמק."],
        ],
      }],
    },
  ];

  /* ‏סוגי הדפים. הטקסט נבנה מהעיר (‏at = "בעפולה"), ולכן עמוד חדש לעיר
     הוא שורה ב-CITIES בלבד. ה-slug נקרא ב-scripts/check_canonical.py. */
  var TYPES = [
    {
      slug: "בתים-פרטיים",
      what: "בתים פרטיים",
      h1: function (c) { return "בית פרטי למכירה " + c.at; },
      benefit: "בתים פרטיים, בתי קרקע וקוטג'ים מכל משרדי התיווך בעיר.",
      description: function (c) { return "בית פרטי למכירה " + c.at + ": בתים פרטיים, בתי קרקע וקוטג'ים מכל משרדי התיווך, עם מחיר, גודל ותמונות."; },
      intro: function (c) { return "בית פרטי למכירה " + c.at + " כולל כאן גם בית קרקע וגם קוטג'. אלה בתים למכירה מכל משרדי התיווך בעיר, עם מחיר, גודל ותמונות."; },
      property_type: "בית פרטי/קוטג'",
      rooms: null,
    },
    {
      slug: "דירות-גן",
      what: "דירות גן",
      benefit: "דירות עם גינה ממשרדי התיווך בעיר.",
      description: function (c) { return "דירות גן למכירה " + c.at + ", מכל משרדי התיווך בעיר: דירה עם גינה פרטית, עם מחיר, גודל ותמונות לכל מודעה פעילה."; },
      intro: function (c) { return "דירות גן למכירה " + c.at + " הן דירות עם גינה, בדרך כלל בקומת קרקע, מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות."; },
      property_type: "דירת גן",
      rooms: null,
    },
    {
      slug: "דירות-3-חדרים",
      what: "דירות 3 חדרים",
      benefit: "דירות 3 חדרים פעילות מכל משרדי התיווך בעיר.",
      description: function (c) { return "דירות 3 חדרים למכירה " + c.at + ", מכל משרדי התיווך בעיר, עם מחיר, גודל, תמונות ופרטי קשר ישירים לכל מודעה פעילה."; },
      intro: function (c) { return "דירות של 3 חדרים שמוצעות עכשיו למכירה " + c.at + ", מכל משרדי התיווך בעיר. בכל מודעה מופיעים המחיר, הגודל והתמונות."; },
      property_type: null,
      rooms: 3,
    },
  ];

  for (var ci = 0; ci < CITIES.length; ci++) CITIES[ci].at = "ב" + CITIES[ci].name;

  function brokersPath(c) { return "/" + c.slug + "/מתווכים"; }

  function customPage(c, t) {
    return {
      slug: t.slug,
      path: "/" + c.slug + "/" + t.slug,
      h1: t.h1,
      label: t.label || (t.what + " למכירה " + c.at),
      benefit: t.benefit,
      description: t.description,
      intro: t.intro,
      property_type: t.property_type || null,
      property_types: t.property_types || null,
      rooms: t.rooms == null ? null : t.rooms,
      city: c.slug,
      cityName: c.name,
      names: c.names || null,
      cityId: c.cityId,
      market: c.market,
      faqs: t.faqs || null,
      collection: c.ld === "collection" || t.collection === true,
      hero: t.hero || null,
      placeName: c.name,
      category: t.category || null,
      anyDeal: t.anyDeal === true,
      dynamicStock: t.dynamicStock === true,
      crumbName: t.crumbName || null,
      crumbPath: t.crumbPath || null,
    };
  }

  var PAGES = [];
  for (var cj = 0; cj < CITIES.length; cj++) {
    var cCity = CITIES[cj];
    if (cCity.types && cCity.types.length) {
      for (var tk = 0; tk < cCity.types.length; tk++) PAGES.push(customPage(cCity, cCity.types[tk]));
      continue;
    }
    for (var tj = 0; tj < TYPES.length; tj++) {
      var c0 = CITIES[cj];
      var t0 = TYPES[tj];
      var own = (c0.copy && c0.copy[t0.slug]) || {};
      PAGES.push({
        slug: t0.slug,
        path: "/" + c0.slug + "/" + t0.slug,
        h1: own.h1 || (t0.h1 ? t0.h1(c0) : t0.what + " למכירה " + c0.at),
        /* ‏בקישורים בין הדפים ("גם מעניין") - הרבים, גם כשה-H1 ביחיד. */
        label: t0.what + " למכירה " + c0.at,
        benefit: own.benefit || t0.benefit,
        description: own.description || t0.description(c0),
        intro: own.intro || t0.intro(c0),
        property_type: t0.property_type,
        rooms: t0.rooms,
        city: c0.slug,
        cityName: c0.name,
        cityId: c0.cityId,
        market: c0.market,
      });
    }
    if (cCity.extra && cCity.extra.length) {
      for (var ek = 0; ek < cCity.extra.length; ek++) PAGES.push(customPage(cCity, cCity.extra[ek]));
    }
  }

  function cityOf(page) {
    var slug = page && page.city ? page.city : "afula";
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].slug === slug) return CITIES[i];
    return CITIES[0];
  }

  function alsoOf(c) {
    if (c.also) return c.also;
    var out = [];
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].city === c.slug) out.push([PAGES[i].path, PAGES[i].label]);
    }
    if (!c.noBrokers) out.push([brokersPath(c), "מתווכים " + c.at]);
    return out;
  }

  function num(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
  function money(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return "";
    return "₪" + num(v);
  }
  function bdi(inner) { return "<bdi>" + inner + "</bdi>"; }
  /* רווח שנשאר בין מספר למילה גם כש-bdi מבודד את הכיוון. */
  function sp() { return '<span class="land-sp"> </span>'; }
  function countPhrase(n, one, many) {
    return bdi(num(n)) + sp() + (n === 1 ? one : many);
  }

  function decodePath(pathname) {
    var path = String(pathname || "").replace(/\/+$/, "") || "/";
    try { path = decodeURIComponent(path); } catch (e) { return ""; }
    return path;
  }

  function pageOf(pathname) {
    var path = decodePath(pathname);
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].path === path) return PAGES[i];
    return null;
  }

  /* ‏ערך בתוך in.(...) עם גרשיים, כדי שסוגריים בשם יישוב לא ישברו את המסנן. */
  function pgIn(values) {
    var parts = [];
    for (var i = 0; i < values.length; i++) {
      parts.push('"' + encodeURIComponent(values[i]).replace(/'/g, "%27") + '"');
    }
    return "(" + parts.join(",") + ")";
  }

  function queryParts(page, select, limit) {
    var names = page.names;
    var cityFilter = names && names.length
      ? "city=in." + pgIn(names)
      : "city=eq." + encodeURIComponent(cityOf(page).name);
    var parts = [
      "select=" + select,
      "status=eq.active",
      "category=eq." + encodeURIComponent(page.category || "residential"),
      cityFilter,
      "order=is_promoted.desc,created_at.desc",
      "limit=" + limit,
    ];
    /* דף מסחרי לא נועל מכירה: גם השכרה פעילה נספרת. שאר הדפים נשארים מכירה. */
    if (!page.anyDeal) parts.push("deal_type=eq.sale");
    if (page.property_types && page.property_types.length) {
      parts.push("property_type=in." + pgIn(page.property_types));
    } else if (page.property_type) parts.push("property_type=eq." + encodeURIComponent(page.property_type));
    if (page.rooms != null) parts.push("rooms=eq." + encodeURIComponent(String(page.rooms)));
    return parts.join("&");
  }

  function isCm(page) { return !!page && page.category === "commercial"; }

  function queryOf(page) {
    /* ‏דף מסחרי מציג את כל המלאי (המסנן בדפדפן), ולכן גם רחוב, קומה והמפרסם. */
    if (isCm(page)) {
      return queryParts(page, "id,title,price,price_per_sqm,size_sqm,floor,street,property_type,deal_type,images,city,created_at,updated_at,features,sales_area,agent_id,neighborhoods(name,is_planned)", 200);
    }
    return queryParts(page, "id,title,price,rooms,size_sqm,property_type,deal_type,images,city,created_at,updated_at,features,sales_area,neighborhoods(name,is_planned)", 24);
  }

  /* מלאי מלא לסוגים ולסוג העסקה. 24 הכרטיסים אינם המלאי: סוג שנדחק
     מהרשימה הגלויה עדיין קיים, ואסור להשמיט אותו מהתיאור. */
  function stockQuery(page) {
    return queryParts(page, "property_type,deal_type", 1000);
  }

  /* ספירת שכונות לאותו סוג בדיוק, לא לכל העיר. */
  function hoodCountQuery(page) {
    return queryParts(page, "sales_area,neighborhoods(name,is_planned)", 1000);
  }

  function renderUrl(url, w, h, resize) {
    var marker = "/storage/v1/object/public/";
    var at = url.indexOf(marker);
    if (at < 0) return "";
    var path = url.slice(at + marker.length).split(/[?#]/)[0];
    if (!path) return "";
    return url.slice(0, at) + "/storage/v1/render/image/public/" + path
      + "?width=" + w + "&height=" + h + "&resize=" + (resize || "cover") + "&quality=60";
  }

  function firstImage(p) {
    var imgs = p && p.images;
    if (typeof imgs === "string" && imgs.indexOf(IMG_HOST) === 0) return imgs;
    if (!Array.isArray(imgs)) return "";
    for (var i = 0; i < imgs.length; i++) {
      if (typeof imgs[i] === "string" && imgs[i].indexOf(IMG_HOST) === 0) return imgs[i];
    }
    return "";
  }

  function listOf(rows) { return Array.isArray(rows) ? rows : []; }

  function activeCount(rows, extras) {
    var list = listOf(rows);
    if (extras && extras.counted) return Number(extras.total) > 0 ? Number(extras.total) : 0;
    if (list.length > 0 && list.length < 24) return list.length;
    return 0;
  }

  function complete(rows, extras) {
    var list = listOf(rows);
    if (!list.length) return false;
    if (extras && extras.counted) return list.length === Number(extras.total);
    return list.length < 24;
  }

  function pricesOf(rows) {
    var out = [];
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var v = Number(list[i] && list[i].price);
      if (isFinite(v) && v > 0) out.push(v);
    }
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function median(rows) {
    var a = pricesOf(rows);
    if (!a.length) return 0;
    var mid = Math.floor(a.length / 2);
    if (a.length % 2) return a[mid];
    return Math.round((a[mid - 1] + a[mid]) / 2);
  }

  function featureList(p) {
    var f = p && p.features;
    if (Array.isArray(f)) return f;
    return [];
  }

  function isNew(p) {
    var t = Date.parse(p && p.created_at || "");
    if (!isFinite(t)) return false;
    var age = Date.now() - t;
    return age >= 0 && age < WEEK_MS;
  }

  function newCount(rows) {
    var n = 0;
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) if (isNew(list[i])) n++;
    return n;
  }

  function rowTime(p) {
    var u = Date.parse(p && p.updated_at || "");
    var c = Date.parse(p && p.created_at || "");
    if (!isFinite(u)) u = 0;
    if (!isFinite(c)) c = 0;
    return Math.max(u, c);
  }

  function shortDate(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var dd = String(d.getUTCDate()).padStart(2, "0");
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return dd + "." + mm + "." + d.getUTCFullYear();
  }

  function latestMs(rows) {
    var best = 0;
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var t = rowTime(list[i]);
      if (t > best) best = t;
    }
    return best;
  }

  function hoodName(p) {
    var n = p && p.neighborhoods;
    if (n && typeof n === "object" && n.name) return String(n.name);
    if (p && p.sales_area) return String(p.sales_area);
    return "";
  }

  /* ‏החיפוש של העיר: "/?…" בעפולה (שוק ברירת המחדל), "/haifa?…" בחיפה. */
  function qs(params, home) {
    var parts = [];
    var keys = ["deal", "ptype", "rooms", "maxPrice", "minPrice", "cdeal"];
    for (var i = 0; i < keys.length; i++) {
      var v = params[keys[i]];
      if (v == null || v === "") continue;
      parts.push(encodeURIComponent(keys[i]) + "=" + encodeURIComponent(String(v)));
    }
    return (home || "/") + "?" + parts.join("&");
  }

  function searchHref(page, over) {
    var q = { deal: page.category === "commercial" ? "commercial" : "sale" };
    if (page.property_type) q.ptype = page.property_type;
    if (page.rooms != null) q.rooms = String(page.rooms);
    if (over) {
      for (var k in over) q[k] = over[k];
    }
    return qs(q, cityOf(page).home);
  }

  function allHref(page) { return searchHref(page, null); }

  function chip(href, label, current) {
    return '<a href="' + escapeHtml(href) + '"' + (current ? ' aria-current="page"' : "") + ">" + label + "</a>";
  }

  function filters(page) {
    var html = '<nav class="land-filters" aria-label="סינון מהיר">';
    /* מסחרי: רק סוג עסקה שקיים במלאי. בלי חדרים ובלי "לקנייה" כברירת מחדל. */
    if (page.category === "commercial") {
      var home = cityOf(page).home;
      var live = page.liveDeals || [];
      if (live.indexOf("sale") >= 0) html += chip(qs({ deal: "commercial", cdeal: "sale" }, home), "<span>לקנייה</span>", false);
      if (live.indexOf("rent") >= 0) html += chip(qs({ deal: "commercial", cdeal: "rent" }, home), "<span>להשכרה</span>", false);
      return html + "</nav>";
    }
    html += chip(searchHref(page, { deal: "sale" }), "<span>לקנייה</span>", true);
    html += chip(searchHref(page, { deal: "rent" }), "<span>להשכרה</span>", false);
    html += chip(searchHref(page, { maxPrice: "1000000" }), "<span>עד</span>" + bdi("1") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { maxPrice: "1500000" }), "<span>עד</span>" + bdi("1.5") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { maxPrice: "2500000" }), "<span>עד</span>" + bdi("2.5") + "<span>מיליון</span>", false);
    html += chip(searchHref(page, { minPrice: "2500000" }), "<span>מ-</span>" + bdi("2.5") + "<span>מיליון</span>", false);
    /* בדף 3 חדרים אין צ'יפ שמסמן את העמוד עצמו. במקומו שכונות. */
    var rooms = page.rooms === 3 ? [4, 5] : [3, 4, 5];
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      html += chip(searchHref(page, { rooms: String(r) }), bdi(String(r)) + "<span>חדרים</span>", false);
    }
    if (page.rooms === 3) {
      var c = cityOf(page);
      var near = c.near || [];
      for (var h = 0; h < near.length; h++) {
        html += chip("/n/" + c.slug + "/" + encodeURIComponent(near[h][1]), "<span>" + escapeHtml(near[h][0]) + "</span>", false);
      }
    }
    return html + "</nav>";
  }

  function chipsHtml(page, rows, extras) {
    /* ‏במסחרי אין מספר מודעות, חציון או טווח מחירים בכותרת. */
    if (isCm(page)) return "";
    var bits = [];
    var active = activeCount(rows, extras);
    if (active > 0) bits.push("<li>" + countPhrase(active, "מודעה פעילה", "מודעות פעילות") + "</li>");
    if (complete(rows, extras)) {
      var mid = median(rows);
      if (mid > 0) bits.push("<li>מחיר חציוני" + sp() + bdi(escapeHtml(money(mid))) + "</li>");
      var fresh = newCount(rows);
      if (fresh > 0) bits.push("<li>" + countPhrase(fresh, "חדש השבוע", "חדשים השבוע") + "</li>");
      else {
        var prices = pricesOf(rows);
        if (prices.length) {
          var lo = money(prices[0]);
          var hi = money(prices[prices.length - 1]);
          var range = lo === hi ? bdi(escapeHtml(lo)) : bdi(escapeHtml(lo)) + sp() + "-" + sp() + bdi(escapeHtml(hi));
          bits.push("<li>" + range + "</li>");
        }
      }
    }
    if (!bits.length) return "";
    return '<ul class="land-chips">' + bits.join("") + "</ul>";
  }

  function updatedHtml(rows) {
    var ms = latestMs(rows);
    var label = shortDate(ms);
    if (!label) return "";
    return "עודכן לאחרונה" + sp() + bdi(label);
  }

  /* תמונת שער לפי סוג הנכס. המפה אחת, כדי שעיר או סוג חדשים ישתמשו בה.
     סוג לא מוכר נופל לתמונת העמק. לא שמים תמונת מודעה בשער: קולאז' ומסדרון
     חשוך לא ניתנים לזיהוי זול. הרוחב ב-srcset הוא הרוחב האמיתי של הקובץ
     (אצל העמק 640 ו-1920, אצל השאר 800 ו-1600). מקור ורישיון: assets/hero-images.md. */
  var VALLEY_HERO = {
    mobile: "assets/hero-valley-800.webp",
    desktop: "assets/hero-valley.webp",
    mobileW: 640,
    desktopW: 1920,
    width: 640,
    height: 768,
    ogW: 1920,
    ogH: 1072,
  };
  var HEROES = {
    "בתים-פרטיים": {
      mobile: "assets/hero-house-800.webp",
      desktop: "assets/hero-house-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
      alt: "בית פרטי מודרני בסגנון ישראלי",
    },
    "דירות-גן": {
      mobile: "assets/hero-garden-800.webp",
      desktop: "assets/hero-garden-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
      alt: "דירת גן מודרנית בסגנון ישראלי",
    },
    "דירות-3-חדרים": {
      mobile: "assets/hero-apt-800.webp",
      desktop: "assets/hero-apt-1600.webp",
      mobileW: 800, desktopW: 1600, width: 800, height: 500, ogW: 1600, ogH: 1000,
      alt: "בניין מגורים מודרני עם מרפסות",
    },
  };

  function heroOf(page) {
    if (page && page.hero && HEROES[page.hero]) return HEROES[page.hero];
    if (page && HEROES[page.slug]) return HEROES[page.slug];
    return VALLEY_HERO;
  }

  function heroHtml(page) {
    if (isCm(page)) return "";
    var h = heroOf(page);
    /* בטלפון המקור בלי מתאר w, אחרת צפיפות המסך בוחרת את הקובץ הרחב. */
    return "<picture>"
      + '<source type="image/webp" media="(max-width: 759px)" srcset="' + h.mobile + '">'
      + '<source type="image/webp" srcset="' + h.mobile + " " + h.mobileW + "w, " + h.desktop + " " + h.desktopW + 'w" sizes="100vw">'
      + '<img src="' + h.mobile + '" alt="' + (h.alt || "") + '" width="' + h.width + '" height="' + h.height + '" fetchpriority="high" decoding="async">'
      + "</picture>";
  }

  function heroPreload(page) {
    if (isCm(page)) return "";
    var h = heroOf(page);
    return '<link rel="preload" as="image" href="' + h.mobile + '" media="(max-width: 759px)" fetchpriority="high">\n'
      + '<link rel="preload" as="image" href="' + h.desktop + '" media="(min-width: 760px)" fetchpriority="high">';
  }

  function heroOg(page) {
    var h = heroOf(page);
    return { src: h.desktop, width: h.ogW, height: h.ogH };
  }

  function badge(p) {
    if (featureList(p).indexOf("price_dropped") >= 0) return '<span class="land-badge">ירד מחיר</span>';
    if (isNew(p)) return '<span class="land-badge">חדש</span>';
    return "";
  }

  function metaLine(p) {
    var bits = [];
    if (p.rooms) bits.push(bdi(escapeHtml(String(p.rooms))) + sp() + "חדרים");
    if (p.size_sqm && Number(p.size_sqm) > 0) bits.push(bdi(num(p.size_sqm)) + sp() + "מ״ר");
    var hood = hoodName(p);
    if (hood) bits.push(escapeHtml(hood));
    return bits.join(" · ");
  }

  var HOUSE_ICON = '<span class="land-ph" aria-hidden="true"><svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M6 22 24 8l18 14"/><path d="M12 20v18h24V20"/><path d="M20 38V28h8v10"/></svg></span>';

  function propCard(p) {
    var img = firstImage(p);
    var pic = HOUSE_ICON;
    if (img) {
      var LM = root.ListingMedia;
      var small = LM ? LM.renderUrl(img, 400) : "";
      var mid = LM ? LM.renderUrl(img, 800) : "";
      var big = LM ? LM.renderUrl(img, 1200) : "";
      var transformed = small.indexOf("/storage/v1/render/image/") >= 0
        && mid.indexOf("/storage/v1/render/image/") >= 0
        && big.indexOf("/storage/v1/render/image/") >= 0;
      var alt = escapeHtml(LM ? LM.alt(p) : "");
      if (transformed) {
        pic = '<img src="' + escapeHtml(mid) + '" srcset="' + escapeHtml(small) + ' 400w, ' + escapeHtml(mid) + ' 800w, ' + escapeHtml(big) + ' 1200w"'
          + ' sizes="(min-width:900px) 360px, (min-width:520px) 50vw, 100vw" alt="' + alt + '"'
          + ' width="320" height="200" loading="lazy" decoding="async"'
          + ' data-full="' + escapeHtml(img) + '"'
          + ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')">';
      } else {
        pic = '<img src="' + escapeHtml(img) + '" alt="' + alt + '" width="320" height="200" loading="lazy" decoding="async">';
      }
    }
    var meta = metaLine(p);
    return '<li><a class="land-card" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + '<span class="land-media">' + pic + badge(p) + "</span>"
      + '<span class="land-card-body">' + priceHtml(p)
      + (meta ? '<span class="land-meta">' + meta + "</span>" : "")
      + "<strong>" + escapeHtml(p.title || "נכס") + "</strong>"
      + "</span></a></li>";
  }

  function priceHtml(p) {
    var price = money(p.price);
    if (!price) return '<b class="land-price">מחיר לפי פנייה</b>';
    return '<b class="land-price">' + bdi(escapeHtml(price)) + "</b>";
  }

  function cards(rows) {
    var list = listOf(rows).slice(0, 9);
    if (!list.length) return "";
    var html = '<h2>מודעות פעילות</h2><ul class="land-grid">';
    for (var i = 0; i < list.length; i++) html += propCard(list[i]);
    return html + "</ul>";
  }

  function allButton(page, rows, extras) {
    var n = activeCount(rows, extras);
    if (!(n > 0)) return "";
    var label = n === 1 ? "<span>לנכס אחד</span>" : "<span>לכל</span>" + bdi(num(n)) + "<span>הנכסים</span>";
    return '<p class="land-more"><a class="land-btn land-btn-primary" data-land-cta data-count="' + n + '" href="'
      + escapeHtml(allHref(page)) + '">' + label + "</a></p>";
  }

  function relatedRows(rows, extras) {
    var seen = {};
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) seen[list[i].id] = 1;
    var src = (extras && extras.related) || [];
    var out = [];
    for (var j = 0; j < src.length && out.length < 9; j++) {
      var row = src[j];
      if (!row || !row.id || seen[row.id]) continue;
      if (row.deal_type == null && row.price == null && row.images == null && row.title == null) continue;
      seen[row.id] = 1;
      out.push(row);
    }
    return out;
  }

  function relatedHtml(page, rows, extras) {
    if (page.category === "commercial") return "";
    if (listOf(rows).length >= 3) return "";
    var rel = relatedRows(rows, extras);
    if (!rel.length) return "";
    var html = '<section class="land-related"><h2>עוד נכסים ' + escapeHtml(cityOf(page).at) + '</h2><ul class="land-grid">';
    for (var i = 0; i < rel.length; i++) html += propCard(rel[i]);
    return html + "</ul></section>";
  }

  function hoodRowsFromListings(rows, page) {
    var c = cityOf(page);
    var hoods = c.hoods;
    var counts = {};
    for (var i = 0; i < hoods.length; i++) counts[hoods[i][1]] = 0;
    var list = listOf(rows);
    for (var j = 0; j < list.length; j++) {
      var name = hoodName(list[j]);
      for (var h = 0; h < hoods.length; h++) {
        if (name === hoods[h][0]) {
          counts[hoods[h][1]]++;
          break;
        }
      }
    }
    var out = [];
    for (var k = 0; k < hoods.length; k++) {
      out.push({ path_key: c.slug + "/" + hoods[k][1], props: counts[hoods[k][1]] });
    }
    return out;
  }

  function hoodMap(extras, c) {
    var rows = extras && extras.hoods;
    if (!Array.isArray(rows) || !rows.length) return null;
    if (rows[0] == null || rows[0].path_key == null || rows[0].props == null) return null;
    var prefix = c.slug + "/";
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var key = String(rows[i].path_key || "");
      if (key.indexOf(prefix) !== 0) continue;
      var n = Number(rows[i].props);
      if (!isFinite(n)) continue;
      map[key.slice(prefix.length)] = n;
    }
    return map;
  }

  function neighborhoods(page, extras, requireMap) {
    var c = cityOf(page);
    var hoods = c.hoods;
    var map = hoodMap(extras, c);
    if (requireMap && !map) return "";
    var items = [];
    for (var i = 0; i < hoods.length; i++) {
      var count = map ? map[hoods[i][1]] : null;
      if (map && typeof count === "number" && count <= 0) continue;
      if (map && count == null) count = null;
      items.push({ name: hoods[i][0], slug: hoods[i][1], count: count });
    }
    if (map) {
      items.sort(function (a, b) {
        var ac = typeof a.count === "number" ? a.count : -1;
        var bc = typeof b.count === "number" ? b.count : -1;
        if (ac !== bc) return bc - ac;
        return a.name.localeCompare(b.name, "he");
      });
    }
    if (!items.length) return "";
    var html = "<h2>שכונות " + escapeHtml(c.at) + '</h2><ul class="land-hoods">';
    for (var h = 0; h < items.length; h++) {
      html += '<li><a class="land-hood" href="/n/' + c.slug + "/" + encodeURIComponent(items[h].slug) + '"><span>'
        + escapeHtml(items[h].name) + "</span>";
      if (typeof items[h].count === "number" && items[h].count > 0) html += bdi(num(items[h].count));
      html += "</a></li>";
    }
    return html + "</ul>";
  }

  function agencyList(extras) {
    var list = extras && extras.agencies;
    if (!Array.isArray(list) || !list.length) return [];
    if (list[0] == null || list[0].slug == null || list[0].name == null) return [];
    return list;
  }

  function trust(page, rows, extras) {
    var c = cityOf(page);
    if (c.trustNote) {
      return '<section class="land-trust"><h2>' + escapeHtml(c.trustTitle || c.trustNote) + "</h2>"
        + "<p>" + escapeHtml(c.trustNote) + "</p></section>";
    }
    var offices = agencyList(extras);
    var logos = [];
    for (var i = 0; i < offices.length; i++) {
      var url = offices[i].logo_url;
      if (typeof url === "string" && url.indexOf(IMG_HOST) === 0) logos.push(offices[i]);
    }
    var stat = "";
    var at = escapeHtml(c.at);
    if (offices.length > 0) stat = countPhrase(offices.length, "משרד פעיל " + at, "משרדים פעילים " + at);
    else {
      var active = activeCount(rows, extras);
      if (active > 0) stat = countPhrase(active, "מודעה פעילה " + at, "מודעות פעילות " + at);
    }
    if (!stat && !offices.length) return "";
    var head = offices.length
      ? countPhrase(offices.length, "משרד תיווך פעיל " + at, "משרדי תיווך פעילים " + at)
      : stat;
    if (!head) return "";
    var strip = "";
    if (logos.length >= 4) {
      strip = '<ul class="land-logos">';
      for (var j = 0; j < logos.length && j < 12; j++) {
        var src = renderUrl(logos[j].logo_url, 144, 144, "contain") || logos[j].logo_url;
        var img = '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(logos[j].name || "משרד תיווך")
          + '" width="72" height="72" loading="lazy" decoding="async">';
        var slug = logos[j].slug;
        strip += '<li>' + (slug
          ? '<a href="/agency?slug=' + encodeURIComponent(slug) + '">' + img + '</a>'
          : img) + '</li>';
      }
      strip += "</ul>";
    }
    return '<section class="land-trust"><h2>' + head + "</h2>" + strip
      + '<p><a href="' + escapeHtml(brokersPath(c)) + '">מתווכים ' + at + "</a></p></section>";
  }

  function kindPhrase(page, n) {
    var at = escapeHtml(cityOf(page).at);
    if (page.slug === "בתים-פרטיים") {
      return n === 1 ? "בית פרטי למכירה " + at : "בתים פרטיים למכירה " + at;
    }
    if (page.slug === "דירות-גן") {
      return n === 1 ? "דירת גן למכירה " + at : "דירות גן למכירה " + at;
    }
    if (page.rooms === 3) {
      return n === 1 ? "דירת 3 חדרים למכירה " + at : "דירות 3 חדרים למכירה " + at;
    }
    if (page.slug === "דירות-למכירה") {
      return n === 1 ? "דירה למכירה " + at : "דירות למכירה " + at;
    }
    return n === 1 ? "מודעה פעילה" : "מודעות פעילות";
  }

  /* ספירה רק כשיש מספר אמיתי. טווח מחיר של הרשימה המלאה, או של מה שנטען
     בעמוד כשהשאילתה נחתכה. בלי טווח מומצא כשאין מחירים. */
  function marketHtml(page, rows, extras) {
    var n = activeCount(rows, extras);
    var prices = pricesOf(rows);
    if (!(n > 0) && !prices.length) return "";
    var bits = [];
    if (n > 0) bits.push("כרגע יש " + countPhrase(n, kindPhrase(page, 1), kindPhrase(page, n)));
    if (prices.length) {
      var lo = money(prices[0]);
      var hi = money(prices[prices.length - 1]);
      var scope = complete(rows, extras) ? "במודעות הפעילות" : "במודעות שמוצגות כאן";
      var range = lo === hi
        ? bdi(escapeHtml(lo))
        : "מ-" + bdi(escapeHtml(lo)) + " עד " + bdi(escapeHtml(hi));
      bits.push(scope + " המחיר " + (lo === hi ? "הוא " : "נע ") + range);
    }
    return bits.join(". ");
  }

  function focusHoods(page) {
    if (page.slug !== "בתים-פרטיים" && page.slug !== "דירות-גן") return "";
    var c = cityOf(page);
    var focus = c.focus || [];
    if (!focus.length) return "";
    var links = [];
    for (var i = 0; i < focus.length; i++) {
      links.push('<a href="/n/' + c.slug + "/" + escapeHtml(focus[i][1]) + '">' + escapeHtml(focus[i][0]) + "</a>");
    }
    var at = escapeHtml(c.at);
    return "<p>שכונות " + at + ": " + links.join(", ") + ". "
      + 'משרדי התיווך: <a href="' + escapeHtml(brokersPath(c)) + '">מתווכים ' + at + "</a> "
      + 'ו<a href="/agencies">רשימת המשרדים</a>.</p>';
  }

  function seo(page, rows, extras) {
    var c = cityOf(page);
    var at = escapeHtml(c.at);
    var market = marketHtml(page, rows, extras);
    if (page.category === "commercial") {
      return '<section class="land-seo"><h2>על הרשימה</h2>'
        + "<p>" + escapeHtml(page.intro) + "</p>"
        + (market ? "<p>" + market + "</p>" : "")
        + "<p>המודעות מתפרסמות על ידי משרדי תיווך. המחיר והמפרט המלא נמצאים בדף של כל נכס. "
        + "להשוואת עסקאות שדווחו לרשות המסים: " + dealsLink(c, at) + ".</p></section>";
    }
    return '<section class="land-seo"><h2>על הרשימה</h2>'
      + "<p>" + escapeHtml(page.intro) + "</p>"
      + (market ? "<p>" + market + "</p>" : "")
      + focusHoods(page)
      + "<p>המודעות הן נכסים למכירה " + at + " שיועצי נדל״ן ומשרדים מפרסמים באתר. המחיר והמפרט המלא נמצאים בדף של כל נכס. "
      + "להשוואת עסקאות שדווחו לרשות המסים: " + dealsLink(c, at) + ", ולמחירי דירות לפי חדרים: "
      + '<a href="/prices">מחירי דירות</a>.</p></section>';
  }

  function dealsLink(c, at) {
    if (c.dealsPath) {
      return '<a href="' + escapeHtml(c.dealsPath) + '">' + escapeHtml(c.dealsLabel || "עסקאות לפי יישוב") + "</a>";
    }
    return '<a href="/deals/' + c.slug + '">עסקאות ' + at + "</a>";
  }

  function faqs(page) {
    if (page && page.faqs) return page.faqs;
    var c = cityOf(page);
    var at = c.at;
    var extra = [];
    if (page && page.slug === "בתים-פרטיים") {
      extra = [
        ["מה נכלל בבית פרטי למכירה " + at + "?", "בעמוד הזה מופיעים בתים פרטיים, בתי קרקע וקוטג'ים למכירה " + at + (c.alsoIn ? ", כולל ב" + c.alsoIn : "") + ". המודעות מתפרסמות על ידי יועצי נדל״ן ומשרדים."],
        ["יש הבדל בין בית פרטי, בית קרקע וקוטג'?", "בית קרקע הוא בית על מגרש. קוטג' הוא סוג של בית פרטי, ולעתים בית דו-משפחתי. בדף הנכס מופיע המפרט שפורסם במודעה."],
      ];
    } else if (page && page.slug === "דירות-גן") {
      extra = [
        ["מהי דירת גן למכירה " + at + "?", "דירת גן היא דירה עם גינה פרטית, בדרך כלל בקומת קרקע. בעמוד הזה מופיעות דירות גן פעילות למכירה " + at + ", מיועצי נדל״ן ומשרדים."],
        ["במה דירת גן שונה מבית פרטי?", "דירת גן היא דירה בבניין, עם גינה. בית פרטי הוא בית על מגרש. שטח הגינה מופיע במודעה כשהוא מפורסם."],
        ["המחיר של דירת גן כולל את הגינה?", "המחיר והשטחים הם מה שפורסם במודעה. הפירוט המלא נמצא בדף הנכס."],
      ];
    }
    return extra.concat([
      ["מאיפה המודעות בעמוד הזה?", "אלה נכסים למכירה " + at + " שיועצי נדל״ן ומשרדים מפרסמים באתר."],
      ["איפה רואים את המחיר ואת כל הפרטים?", "בדף של כל נכס מופיעים המחיר שפורסם והמפרט המלא. אם אין מחיר במודעה, אפשר לפנות דרך האתר ולשאול."],
      ["איפה רואים עסקאות ומחירי דירות?", "עסקאות שדווחו לרשות המסים נמצאות בעמוד העסקאות " + at + ", ומחירי דירות לפי חדרים בעמוד מחירי הדירות."],
      ["מה עושים אם אין כרגע מודעות?", "אפשר להשאיר התראה ולקבל עדכון כשעולה נכס שמתאים."],
    ]);
  }

  function faqHtml(page) {
    var rows = faqs(page);
    var html = '<section class="land-faq"><h2>שאלות נפוצות</h2>';
    for (var i = 0; i < rows.length; i++) {
      html += "<details><summary>" + escapeHtml(rows[i][0]) + "</summary><p>" + escapeHtml(rows[i][1]) + "</p></details>";
    }
    return html + "</section>";
  }

  function also(page) {
    var c = cityOf(page);
    var list = alsoOf(c);
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < list.length; i++) {
      if (list[i][0] === page.path) continue;
      html += '<a href="' + escapeHtml(list[i][0]) + '">' + escapeHtml(list[i][1]) + "</a>";
    }
    html += '<a href="' + escapeHtml(c.home) + '">' + escapeHtml(c.homeLabel) + "</a>";
    return html + "</nav></section>";
  }

  function finalCta() {
    return '<section class="land-final"><h2>רוצים לשמוע כשעולה נכס מתאים?</h2>'
      + "<p>נעדכן אתכם ברגע שיעלה נכס שמתאים.</p>"
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></section>';
  }

  function emptyState() {
    return '<div class="land-empty"><p>אין כרגע מודעות פעילות.</p>'
      + '<button type="button" class="land-btn land-btn-primary" data-land-alert>קבלו התראה</button></div>';
  }

  /* תווית תצוגה לסוג מהמסד. סוג שאינו במפה נשאר כמו שהוא.
     הרשימה עצמה באה מהשורות, לא מהמפה: מפתח שלא חזר מהמסד לא נכתב. */
  var STOCK_LABEL = {
    "משרדים": "משרדים",
    "חנויות/שטח מסחרי": "חנויות ושטחי מסחר",
    "מבני תעשייה": "מבני תעשייה",
    "מגרשים": "מגרשים",
  };

  function stockSource(rows, extras) {
    if (extras && Array.isArray(extras.stock) && extras.stock.length) return extras.stock;
    return listOf(rows);
  }

  function stockFacts(rows) {
    var counts = {};
    var deals = {};
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var t = String((list[i] && list[i].property_type) || "").trim();
      var d = String((list[i] && list[i].deal_type) || "").trim();
      if (t) counts[t] = (counts[t] || 0) + 1;
      if (d === "sale" || d === "rent") deals[d] = true;
    }
    var types = Object.keys(counts).sort(function (a, b) {
      if (counts[a] !== counts[b]) return counts[b] - counts[a];
      return a.localeCompare(b, "he");
    });
    return { types: types, deals: deals };
  }

  function heJoin(list) {
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    return list.slice(0, -1).join(", ") + " ו" + list[list.length - 1];
  }

  function copyPage(page) {
    var copy = {};
    for (var k in page) copy[k] = page[k];
    return copy;
  }

  /* התיאור, ה-H1 וה-FAQ של דף המסחרי. בלי מלאי נשאר הנוסח הגנרי,
     בלי שם סוג ובלי "למכירה"/"להשכרה". */
  function withStock(page, rows, extras) {
    if (!page || !page.dynamicStock) return page;
    var facts = stockFacts(stockSource(rows, extras));
    var copy = copyPage(page);
    copy.liveDeals = [];
    if (facts.deals.sale) copy.liveDeals.push("sale");
    if (facts.deals.rent) copy.liveDeals.push("rent");
    if (!facts.types.length) return copy;
    var words = heJoin(facts.types.map(function (t) { return STOCK_LABEL[t] || t; }));
    var how = facts.deals.sale && facts.deals.rent ? "למכירה ולהשכרה"
      : facts.deals.sale ? "למכירה"
      : facts.deals.rent ? "להשכרה"
      : "";
    var name = "נדל״ן מסחרי בעפולה - " + words;
    copy.h1 = name;
    /* ‏ה-<title> נשאר קצר: עם רשימת הסוגים הוא הגיע ל-79 תווים ונחתך
       בתוצאה (ביקורת 5.11.2026). ה-H1 שומר את הרשימה. */
    copy.title = page.h1;
    /* ‏description, benefit ו-intro של המסחרי קבועים (בלי רשימת סוגים ובלי מספרים). */
    copy.label = name;
    var faqs = (page.faqs || []).map(function (row) { return [row[0], row[1]]; });
    if (faqs.length) faqs[0][1] = "בעמוד הזה: " + words + (how ? " " + how : "") + " בעפולה.";
    copy.faqs = faqs;
    return copy;
  }

  /* ==========================================================================
     הדף המסחרי (/afula/נדלן-מסחרי). הכל מוצג ב-HTML הראשון, והמסנן רץ
     בדפדפן (assets/silo-commercial.js) על data-* של הכרטיסים. בלי מספרים:
     לא מספר מודעות, לא חציון ולא טווח מחירים (החלטה 16.11.2026).
     ========================================================================== */
  var CM_GROUPS = [
    { key: "offices", chip: "משרד", list: "משרדים", none: "משרד", types: ["משרדים", "בניין משרדים", "חלל עבודה משותף"] },
    { key: "shops", chip: "חנות", list: "חנויות ושטחי מסחר", none: "חנות", types: ["חנויות/שטח מסחרי"] },
    { key: "warehouse", chip: "מחסן/תעשייה", list: "מחסנים ומבני תעשייה", none: "מחסן או מבנה תעשייה", types: ["מבני תעשייה", "מחסנים", "מרלו״ג/מרכז לוגיסטי", "אולמות"] },
    { key: "clinic", chip: "קליניקה", list: "קליניקות", none: "קליניקה", types: ["קליניקות"] },
    { key: "land", chip: "מגרש", list: "מגרשים", none: "מגרש", types: ["מגרשים"] },
  ];
  var CM_ONE = {
    "משרדים": "משרד", "בניין משרדים": "בניין משרדים", "חלל עבודה משותף": "חלל עבודה משותף",
    "חנויות/שטח מסחרי": "חנות או שטח מסחרי", "מבני תעשייה": "מבנה תעשייה", "מחסנים": "מחסן",
    "מרלו״ג/מרכז לוגיסטי": "מרכז לוגיסטי", "אולמות": "אולם", "קליניקות": "קליניקה", "מגרשים": "מגרש",
  };
  var CM_SQM = [["0-50", "עד 50"], ["50-150", "50 עד 150"], ["150-500", "150 עד 500"], ["500-", "500+"]];
  /* ‏התוויות נכתבות עם <bdi> סביב כל סכום, כדי ששני סכומים באותה תווית לא יתהפכו. */
  function cmMoney(n) { return "<bdi>₪" + num(n) + "</bdi>"; }
  var CM_PRICE = {
    rent: [["0-3000", "עד " + cmMoney(3000)], ["3000-8000", cmMoney(3000) + " עד " + cmMoney(8000)], ["8000-20000", cmMoney(8000) + " עד " + cmMoney(20000)], ["20000-", "מעל " + cmMoney(20000)]],
    sale: [["0-500000", "עד " + cmMoney(500000)], ["500000-1000000", cmMoney(500000) + " עד " + cmMoney(1000000)], ["1000000-2000000", cmMoney(1000000) + " עד " + cmMoney(2000000)], ["2000000-", "מעל " + cmMoney(2000000)]],
  };
  var CM_CONSENT = "מאשרים שיועץ/ת נדל״ן מהאזור ייצור איתי קשר בנוגע לנכס מסחרי שמתאים, ולקבל משוק נדל״ן הודעות וואטסאפ או SMS על נכסים חדשים. אפשר להפסיק בכל רגע.";

  function cmGroupOf(type) {
    for (var i = 0; i < CM_GROUPS.length; i++) if (CM_GROUPS[i].types.indexOf(type) >= 0) return CM_GROUPS[i].key;
    return "";
  }

  /* ‏שכונה לתצוגה. "B1 אזור בתכנון" אינו שם שהגולש מכיר, ולכן במקומו הרחוב. */
  function cmHood(p) {
    var n = p && p.neighborhoods;
    var name = n && typeof n === "object" && n.name ? String(n.name) : "";
    var planned = !!(n && n.is_planned) || /בתכנון/.test(name);
    if (name && !planned) return name;
    if (!n && p && p.sales_area && !/בתכנון/.test(String(p.sales_area))) return String(p.sales_area);
    return "";
  }

  function cmPlace(p) {
    var hood = cmHood(p);
    if (hood) return hood;
    var street = String((p && p.street) || "").trim();
    return street || "עפולה";
  }

  /* ‏בשכירות, מחיר מתחת ל-500 הוא מחיר למ"ר לחודש (כך מפרסמים מזינים אותו). */
  function cmPrice(p) {
    var v = Number(p && p.price);
    if (!isFinite(v) || v <= 0) return { text: "מחיר לפי פנייה", total: 0, perSqm: false };
    if (p.deal_type === "rent") {
      /* ‏בלי שטח אי אפשר לדעת אם זה מחיר למ״ר, ולכן מתחת ל-500 הוא למ״ר רק כשיש שטח. */
      if (v < 500 && Number(p.size_sqm) > 0) return { text: money(v) + " למ״ר לחודש", total: 0, perSqm: true };
      return { text: money(v) + " לחודש", total: v, perSqm: false };
    }
    return { text: money(v), total: v, perSqm: false };
  }

  function cmSqmPrice(p, price) {
    var given = Number(p && p.price_per_sqm);
    if (isFinite(given) && given > 0) return Math.round(given);
    var size = Number(p && p.size_sqm);
    var v = Number(p && p.price);
    if (price.perSqm) return Math.round(v);
    if (isFinite(size) && size > 0 && isFinite(v) && v > 0) return Math.round(v / size);
    return 0;
  }

  function cmContact(p, extras) {
    var map = extras && extras.contacts;
    var c = map && p && p.agent_id ? map[p.agent_id] : null;
    var phone = c && String(c.phone || "").replace(/\D/g, "");
    return phone && phone.length >= 9 ? { phone: phone, name: c.name || "" } : null;
  }

  var WA_PATH = '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.2.1-1.9-.1a13 13 0 0 1-5.6-4.6c-.6-.9-1-1.9-1-2.8 0-1 .5-1.7 1-2 .2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.5.9 1.1 1.6 2 2.2.3.2.5.2.7 0l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.4.4.1.2.1.7-.1 1.4Z"/>';
  var CALL_PATH = '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  /* ‏האייקונים פעם אחת בדף, ולא בכל כרטיס (עד 200 כרטיסים) */
  var CM_SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="cm-wa" viewBox="0 0 24 24" fill="currentColor">' + WA_PATH + '</symbol><symbol id="cm-call" viewBox="0 0 24 24">' + CALL_PATH + '</symbol></svg>';
  var WA_ICON = '<svg width="18" height="18" aria-hidden="true"><use href="#cm-wa"/></svg>';
  var CALL_ICON = '<svg width="18" height="18" aria-hidden="true"><use href="#cm-call"/></svg>';

  function cmCard(p, extras, first) {
    var price = cmPrice(p);
    var one = CM_ONE[p.property_type] || "נכס מסחרי";
    var place = cmPlace(p);
    var rent = p.deal_type === "rent";
    var img = firstImage(p);
    var pic = HOUSE_ICON;
    if (img) {
      var LM = root.ListingMedia;
      var small = LM ? LM.renderUrl(img, 400) : "";
      var mid = LM ? LM.renderUrl(img, 800) : "";
      var big = LM ? LM.renderUrl(img, 1200) : "";
      var ok = small.indexOf("/storage/v1/render/image/") >= 0 && mid.indexOf("/storage/v1/render/image/") >= 0 && big.indexOf("/storage/v1/render/image/") >= 0;
      var alt = escapeHtml(LM ? LM.alt(p) : "");
      var load = first ? 'fetchpriority="high"' : 'loading="lazy"';
      pic = ok
        ? '<img src="' + escapeHtml(mid) + '" srcset="' + escapeHtml(small) + " 400w, " + escapeHtml(mid) + " 800w, " + escapeHtml(big) + ' 1200w"'
          + ' sizes="(min-width:900px) 360px, (min-width:520px) 50vw, 100vw" alt="' + alt + '" width="320" height="240" ' + load + ' decoding="async"'
          + ' data-full="' + escapeHtml(img) + '" onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')">'
        : '<img src="' + escapeHtml(img) + '" alt="' + alt + '" width="320" height="240" ' + load + ' decoding="async">';
    }
    var size = Number(p.size_sqm);
    var facts = [];
    if (isFinite(size) && size > 0) facts.push(bdi(num(size)) + sp() + "מ״ר");
    var per = price.perSqm ? 0 : cmSqmPrice(p, price);
    if (per > 0) facts.push(bdi(escapeHtml(money(per))) + sp() + "למ״ר");
    var fl = p.floor;
    if (fl != null && fl !== "" && isFinite(Number(fl))) facts.push(Number(fl) === 0 ? "קומת קרקע" : "קומה" + sp() + bdi(String(Number(fl))));
    var parking = featureList(p).indexOf("parking") >= 0;
    if (parking) facts.push("חניה");
    var total = price.total || (price.perSqm && size > 0 ? Math.round(Number(p.price) * size) : 0);
    var contact = cmContact(p, extras);
    var pid = ' data-property-id="' + escapeHtml(p.id) + '"';
    var actions = "";
    if (contact) {
      var text = "היי, ראיתי בשוק נדל״ן את הנכס הזה ואשמח לקבל פרטים נוספים.\nhttps://shuknadlan.co.il/property?id=" + encodeURIComponent(p.id);
      actions = '<div class="cm-actions">'
        + '<a class="cm-act cm-act-wa" href="https://wa.me/' + contact.phone + "?text=" + encodeURIComponent(text) + '" target="_blank" rel="noopener noreferrer"' + pid
        + ' aria-label="וואטסאפ למשרד המפרסם, נפתח בחלון חדש">' + WA_ICON + "<span>וואטסאפ</span></a>"
        + '<a class="cm-act cm-act-call" href="tel:+' + contact.phone + '"' + pid + ' aria-label="חיוג למשרד המפרסם">' + CALL_ICON + "<span>חיוג</span></a></div>";
    }
    return '<li class="cm-item" data-deal="' + (rent ? "rent" : "sale") + '" data-group="' + cmGroupOf(p.property_type) + '"'
      + ' data-sqm="' + (isFinite(size) && size > 0 ? Math.round(size) : 0) + '" data-total="' + total + '"'
      + ' data-area="' + escapeHtml(cmHood(p)) + '" data-parking="' + (parking ? 1 : 0) + '">'
      + '<article class="cm-card"><span class="cm-media">' + pic + '<span class="cm-tag cm-tag-' + (rent ? "rent" : "sale") + '">' + (rent ? "להשכרה" : "למכירה") + "</span></span>"
      + '<div class="cm-body"><p class="cm-kind"><a class="cm-link" href="/property?id=' + encodeURIComponent(p.id) + '">'
      + escapeHtml(one) + "</a> · " + escapeHtml(place) + "</p>"
      + '<p class="cm-price">' + bdi(escapeHtml(price.text)) + "</p>"
      + (facts.length ? '<p class="cm-facts">' + facts.join(" · ") + "</p>" : "")
      + "</div>" + actions + "</article></li>";
  }

  function cmAreas(rows) {
    var seen = {};
    var out = [];
    var list = listOf(rows);
    for (var i = 0; i < list.length; i++) {
      var h = cmHood(list[i]);
      if (h && !seen[h]) { seen[h] = 1; out.push(h); }
    }
    return out.sort(function (a, b) { return a.localeCompare(b, "he"); });
  }

  function cmButtons(attr, rows) {
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      html += '<button type="button" class="cm-pill" ' + attr + '="' + rows[i][0] + '" aria-pressed="false">' + rows[i][1] + "</button>";
    }
    return html;
  }

  function cmControls() {
    var chips = '<button type="button" class="cm-chip" data-cm-type="" aria-pressed="true">הכל</button>';
    for (var i = 0; i < CM_GROUPS.length; i++) {
      chips += '<button type="button" class="cm-chip" data-cm-type="' + CM_GROUPS[i].key + '" aria-pressed="false">' + escapeHtml(CM_GROUPS[i].chip) + "</button>";
    }
    return '<div class="cm-controls">'
      + '<div class="cm-toggle" role="group" aria-label="סוג עסקה">'
      + '<button type="button" class="cm-seg" data-cm-deal="rent" aria-pressed="true">השכרה</button>'
      + '<button type="button" class="cm-seg" data-cm-deal="sale" aria-pressed="false">מכירה</button></div>'
      + '<div class="cm-chips" role="group" aria-label="סוג נכס">' + chips + "</div>"
      + '<div class="cm-bar"><button type="button" class="cm-filter-btn" data-cm-open="drawer" aria-haspopup="dialog">שטח ומחיר</button>'
      + '<ul class="cm-active" id="cmActive" aria-label="מסננים פעילים"></ul></div></div>';
  }

  function cmDrawer(areas) {
    var opts = '<option value="">כל השכונות</option>';
    for (var i = 0; i < areas.length; i++) opts += '<option value="' + escapeHtml(areas[i]) + '">' + escapeHtml(areas[i]) + "</option>";
    return '<div class="cm-sheet" id="cmDrawer" role="dialog" aria-modal="true" aria-labelledby="cmDrawerT" hidden>'
      + '<div class="cm-sheet-card"><div class="cm-sheet-head"><h3 id="cmDrawerT">שטח ומחיר</h3>'
      + '<button type="button" class="cm-x" data-cm-close aria-label="סגירה">✕</button></div>'
      + '<fieldset class="cm-fs"><legend>שטח במ״ר</legend><div class="cm-pills" id="cmSqm">' + cmButtons("data-cm-sqm", CM_SQM) + "</div></fieldset>"
      + '<fieldset class="cm-fs"><legend>מחיר</legend>'
      + '<div class="cm-pills" data-cm-price-for="rent">' + cmButtons("data-cm-price", CM_PRICE.rent) + "</div>"
      + '<div class="cm-pills" data-cm-price-for="sale" hidden>' + cmButtons("data-cm-price", CM_PRICE.sale) + "</div></fieldset>"
      + '<label class="cm-fs cm-field"><span>שכונה</span><select id="cmArea">' + opts + "</select></label>"
      + '<label class="cm-check"><input type="checkbox" id="cmParking"><span>חניה</span></label>'
      + '<div class="cm-sheet-foot"><button type="button" class="cm-ghost" data-cm-clear>ניקוי הכל</button>'
      + '<button type="button" class="cm-gold" data-cm-close>הצגת הנכסים</button></div></div></div>';
  }

  function cmLeadSheet() {
    var types = '<option value="">לא משנה</option>';
    for (var i = 0; i < CM_GROUPS.length; i++) types += '<option value="' + CM_GROUPS[i].key + '">' + escapeHtml(CM_GROUPS[i].chip) + "</option>";
    var sizes = '<option value="">לא משנה</option>';
    for (var j = 0; j < CM_SQM.length; j++) sizes += '<option value="' + CM_SQM[j][0] + '">' + escapeHtml(CM_SQM[j][1]) + " מ״ר</option>";
    return '<div class="cm-sheet" id="cmLead" role="dialog" aria-modal="true" aria-labelledby="cmLeadT" hidden>'
      + '<form class="cm-sheet-card" id="cmLeadForm" novalidate data-consent-text="' + escapeHtml(CM_CONSENT) + '">'
      + '<div class="cm-sheet-head"><h3 id="cmLeadT">מחפשים נכס מסחרי? נמצא לכם</h3>'
      + '<button type="button" class="cm-x" data-cm-close aria-label="סגירה">✕</button></div>'
      + '<div class="cm-lead-fields">'
      + '<label class="cm-field"><span>שם</span><input type="text" name="name" autocomplete="name" required></label>'
      + '<label class="cm-field"><span>טלפון</span><input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="050-0000000" required></label>'
      + '<label class="cm-field"><span>סוג נכס</span><select name="type">' + types + "</select></label>"
      + '<label class="cm-field"><span>שטח משוער</span><select name="sqm">' + sizes + "</select></label></div>"
      + '<label class="cm-check cm-consent"><input type="checkbox" name="consent" required><span>' + escapeHtml(CM_CONSENT)
      + ' <a href="/terms" target="_blank" rel="noopener">תנאי השימוש</a> · <a href="/privacy" target="_blank" rel="noopener">מדיניות הפרטיות</a></span></label>'
      + '<p class="cm-err" id="cmLeadErr" role="alert"></p>'
      + '<button type="submit" class="cm-gold cm-send">שליחה</button>'
      + '<div class="cm-done" id="cmLeadDone" hidden><p><strong>קיבלנו, תודה.</strong></p><p>נעדכן אתכם כשיעלה נכס מסחרי שמתאים.</p>'
      + '<button type="button" class="cm-ghost" data-cm-close>סגירה</button></div></form></div>';
  }

  function cmHasGroup(rows, extras, keys) {
    var list = stockSource(rows, extras);
    for (var i = 0; i < list.length; i++) if (keys.indexOf(cmGroupOf(list[i] && list[i].property_type)) >= 0) return true;
    return false;
  }

  function cmSections(page, rows, extras) {
    var c = cityOf(page);
    var html = '<section class="land-seo" id="offices-section"><h2 id="offices">משרדים למכירה ולהשכרה</h2>'
      + "<p>משרדים בעפולה מפורסמים בכמה אזורים בעיר, בהם אזור התעשייה ומרכז העיר. בוחרים משרד בשורת הסוגים שבראש הרשימה, ומצמצמים לפי שטח, מחיר ושכונה.</p></section>";
    html += '<section class="land-seo"><h2>חנויות ושטחי מסחר</h2>'
      + "<p>חנויות ושטחי מסחר מופיעים ברשימה כשמשרדי התיווך מפרסמים אותם, להשכרה ולמכירה. בכל כרטיס מופיעים סוג הנכס, המקום, המחיר והשטח.</p></section>";
    if (cmHasGroup(rows, extras, ["warehouse", "land"])) {
      html += '<section class="land-seo"><h2>מחסנים, מבני תעשייה ומגרשים</h2>'
        + "<p>מחסנים, מבני תעשייה ומגרשים מופיעים לפי המודעות הפעילות באותו יום. אפשר לבחור מחסן/תעשייה או מגרש בשורת הסוגים.</p></section>";
    }
    html += cmHoods(page, extras);
    html += '<section class="land-seo"><h2>על הרשימה</h2><p>' + escapeHtml(page.intro) + "</p>"
      + "<p>המודעות מתפרסמות על ידי משרדי תיווך. המחיר והמפרט המלא נמצאים בדף של כל נכס. "
      + "להשוואת עסקאות שדווחו לרשות המסים: " + dealsLink(c, escapeHtml(c.at)) + ".</p></section>";
    return html;
  }

  /* ‏שכונות בלי ספירה, ואזור התעשייה ראשון ומודגש. */
  function cmHoods(page, extras) {
    var c = cityOf(page);
    var items = c.hoods || [];
    if (!items.length) return "";
    var ordered = items.slice().sort(function (a, b) {
      var ai = a[1] === "אזור-התעשייה" ? 0 : 1;
      var bi = b[1] === "אזור-התעשייה" ? 0 : 1;
      return ai - bi;
    });
    var html = '<section class="land-hoods-wrap"><h2>שכונות</h2>'
      + '<p>אזור התעשייה הוא האזור המסחרי והתעשייתי של עפולה, ובו מפורסמים משרדים, חנויות ומבני תעשייה. '
      + '<a href="/n/' + c.slug + '/' + encodeURIComponent("אזור-התעשייה") + '">לדף אזור התעשייה</a>.</p><ul class="land-hoods">';
    for (var i = 0; i < ordered.length; i++) {
      html += '<li><a class="land-hood" href="/n/' + c.slug + "/" + encodeURIComponent(ordered[i][1]) + '"><span>' + escapeHtml(ordered[i][0]) + "</span></a></li>";
    }
    return html + "</ul></section>";
  }

  function cmAlso(page) {
    var c = cityOf(page);
    var list = [
      ["/n/" + c.slug + "/" + encodeURIComponent("אזור-התעשייה"), "אזור התעשייה בעפולה"],
      ["/deals/" + c.slug, "עסקאות בעפולה"],
      ["/afula/דירות-למכירה", "דירות למכירה בעפולה"],
      ["/emek-yizrael/בתים-ומגרשים", "בתים ומגרשים בעמק יזרעאל"],
      [brokersPath(c), "מתווכים בעפולה"],
      [c.home, c.homeLabel],
    ];
    var html = '<section class="land-also"><h2>גם מעניין</h2><nav class="land-filters" aria-label="גם מעניין">';
    for (var i = 0; i < list.length; i++) html += '<a href="' + escapeHtml(list[i][0]) + '">' + escapeHtml(list[i][1]) + "</a>";
    return html + "</nav></section>";
  }

  function cmRender(page, rows, extras) {
    var list = listOf(rows);
    var cardsHtml = "";
    /* ‏הכרטיס הראשון שגלוי בברירת המחדל (השכרה) הוא ה-LCP, לא בהכרח שורה 0 */
    var firstAt = 0;
    for (var f = 0; f < list.length; f++) if (list[f].deal_type === "rent") { firstAt = f; break; }
    for (var i = 0; i < list.length; i++) cardsHtml += cmCard(list[i], extras, i === firstAt);
    var html = CM_SPRITE + '<div class="cm" id="cmRoot" data-deal="rent" data-cm>' + cmControls()
      + '<h2 class="cm-list-title" id="cmListTitle">מודעות פעילות</h2>'
      + '<ul class="cm-grid" id="cmGrid">' + cardsHtml + "</ul>"
      + '<div class="cm-empty" id="cmEmpty" hidden></div></div>';
    html += cmSections(page, rows, extras);
    html += faqHtml(page);
    html += cmAlso(page);
    html += '<section class="land-final"><h2>התראה</h2><p>נעדכן אתכם ברגע שיעלה נכס מסחרי שמתאים.</p>'
      + '<button type="button" class="land-btn land-btn-primary" data-cm-alert>לקבלת התראה</button></section>';
    html += cmDrawer(cmAreas(list)) + cmLeadSheet();
    html += '<div class="cm-sticky" id="cmSticky"><button type="button" class="cm-sticky-btn" data-cm-lead>מחפשים נכס מסחרי? נמצא לכם</button></div>';
    return html;
  }

  function render(page, rows, extras) {
    if (isCm(page)) return cmRender(page, rows, extras);
    var list = listOf(rows);
    var html = filters(page);
    html += list.length ? cards(list) : emptyState();
    html += relatedHtml(page, list, extras);
    html += allButton(page, list, extras);
    html += neighborhoods(page, extras);
    html += trust(page, list, extras);
    html += seo(page, rows, extras);
    html += also(page);
    html += faqHtml(page);
    html += finalCta();
    return html;
  }

  function ld(obj) {
    return JSON.stringify(obj).replace(/</g, "\\u003c");
  }

  function publicUrl(site, path) {
    return site + String(path || "").split("/").map(function (seg, i) {
      return i === 0 ? seg : encodeURIComponent(seg);
    }).join("/");
  }

  function collectionJson(page, rows, site) {
    var c = cityOf(page);
    var url = publicUrl(site, page.path);
    var list = listOf(rows);
    var qa = faqs(page);
    var main = [];
    for (var q = 0; q < qa.length; q++) {
      main.push({
        "@type": "Question",
        name: qa[q][0],
        acceptedAnswer: { "@type": "Answer", text: qa[q][1] },
      });
    }
    var graph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          "@id": url + "#page",
          url: url,
          name: page.h1,
          description: page.description,
          inLanguage: "he",
          isPartOf: { "@id": site + "/#website" },
          about: { "@type": "Place", name: page.placeName || c.name },
          breadcrumb: { "@id": url + "#breadcrumb" },
        },
        {
          "@type": "BreadcrumbList",
          "@id": url + "#breadcrumb",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "דף הבית", item: site + "/" },
            { "@type": "ListItem", position: 2, name: page.crumbName || c.homeLabel || c.name, item: site + (page.crumbPath || c.home) },
            { "@type": "ListItem", position: 3, name: page.h1, item: url },
          ],
        },
        { "@type": "FAQPage", mainEntity: main },
      ],
    };
    var items = [];
    for (var i = 0; i < list.length; i++) {
      items.push({
        "@type": "ListItem",
        position: i + 1,
        name: String(list[i].title || "נכס"),
        url: site + "/property?id=" + encodeURIComponent(list[i].id),
      });
    }
    var itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: page.h1,
      numberOfItems: items.length,
      itemListElement: items,
    };
    /* ‏במסחרי אין מספר נכסים בשום מקום, גם לא כאן. */
    if (isCm(page)) delete itemList.numberOfItems;
    if (page.dynamicStock) itemList.itemListOrder = "https://schema.org/ItemListOrderDescending";
    return [graph, itemList];
  }

  function jsonLd(page, rows, site) {
    if (page && page.collection) return collectionJson(page, rows, site);
    var url = site + page.path;
    var list = listOf(rows);
    var web = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.h1,
      url: url,
      description: page.description,
      inLanguage: "he",
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: site + "/" },
    };
    var crumbs = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "דף הבית", item: site + "/" },
        { "@type": "ListItem", position: 2, name: page.crumbName || cityOf(page).name, item: site + (page.crumbPath || cityOf(page).home) },
        { "@type": "ListItem", position: 3, name: page.h1, item: url },
      ],
    };
    var items = [];
    for (var i = 0; i < list.length; i++) {
      items.push({
        "@type": "ListItem",
        position: i + 1,
        name: String(list[i].title || "נכס"),
        url: site + "/property?id=" + encodeURIComponent(list[i].id),
      });
    }
    var itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: page.h1,
      numberOfItems: items.length,
      itemListElement: items,
    };
    var qa = faqs(page);
    var main = [];
    for (var q = 0; q < qa.length; q++) {
      main.push({
        "@type": "Question",
        name: qa[q][0],
        acceptedAnswer: { "@type": "Answer", text: qa[q][1] },
      });
    }
    var faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: main };
    return [web, crumbs, itemList, faq];
  }

  function scripts(page, rows, site) {
    return jsonLd(page, rows, site).map(function (obj) {
      return '<script type="application/ld+json">' + ld(obj) + "</script>";
    }).join("\n");
  }

  root.ShukSilo = {
    pages: PAGES,
    cities: CITIES,
    cityOf: cityOf,
    brokersPath: brokersPath,
    isCommercial: isCm,
    cmGroups: CM_GROUPS,
    countedNeighborhoods: function (rows, page) { return neighborhoods(page, { hoods: rows }, true); },
    pageOf: pageOf,
    queryOf: queryOf,
    stockQuery: stockQuery,
    withStock: withStock,
    hoodCountQuery: hoodCountQuery,
    hoodRowsFromListings: hoodRowsFromListings,
    render: render,
    heroHtml: heroHtml,
    heroPreload: heroPreload,
    heroOg: heroOg,
    chipsHtml: chipsHtml,
    updatedHtml: updatedHtml,
    allHref: allHref,
    jsonLd: jsonLd,
    scripts: scripts,
    fullTitle: function (page) { return (page.title || page.h1) + " | " + SITE_NAME; },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
