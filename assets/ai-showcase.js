/* ============================================================================
   רצועת ההדמיות של הנכס — "לפני ואחרי" בתוך דף הנכס
   ----------------------------------------------------------------------------
   הרצועה הזאת הייתה עד היום רצועת מרקטפלייס: היא הציגה נכס אקראי שיש לו
   הדמיה, גם בדף הבית וגם בתוך דף של נכס אחר. זה היה מוזר בדיוק במקום שבו
   הוא הכי חשוב — מי שנמצא/ת בדף נכס כבר בחר/ה נכס, ורצועה שמראה לו/ה
   *נכס אחר* אחרי שיפוץ עונה על שאלה שאיש לא שאל.

   מה שנשאר הוא מצב אחד: **הנכס שבעמוד**. הווילון משווה את הצילום האמיתי
   של הנכס להדמיה שלו, והתמונונות שמתחתיו הם שאר הכיוונים העיצוביים שכבר
   הופקו לאותו נכס.

   שלושה כללים:

     1. **בלי הדמיה — בלי וילון, אבל כן כלי.** נכס זכאי שטרם הופקה לו
        הדמיה מקבל את הצד השמאלי בלבד: כותרת, שבבי הסגנונות, שדות הבקשה
        והכפתור. הם לא הבטחה ריקה — הם הכלי שמייצר את מה שחסר. השדות
        עצמם אינם מורכבים כאן: ‎#aiPropAsk‎ הוא חריץ ריק מעל הכפתור,
        והדף הקורא מזיז לתוכו את הטופס החי שלו.
     2. **התנועה היא מצב מנוחה בלבד.** סרגל ההשוואה נע לבד כדי לספר מה
        אפשר לעשות איתו; במגע הראשון — עכבר, מגע או מקלדת — האנימציה נעצרת
        והשליטה עוברת לגולש/ת ולא חוזרת.
     3. **הסרגל הוא ‎<input type=range>‎ אמיתי.** גרירה מותאמת אישית הייתה
        משאירה את הרכיב בלתי נגיש למקלדת; כאן החצים, Home/End ו-PageUp/Down
        עובדים בחינם, וקורא מסך מכריז עליו כמחוון עם ערך.
     4. **הרכיב לא שולח לידים.** תיבת "השאירו פרטים לקבלת פגישה בחינם"
        היא כפתור שקורא ל-‎onLead‎ של הדף, ותו לא. מי שמקבל/ת את הפנייה
        ובאיזו תוכנית היא נפתחת נקבע במסלול של הדף הקורא — בדף הנכס זה
        טופס הפנייה שכבר בעמוד, שמשייך את הליד לסוכן/ת של הנכס ופותח
        אותו לפי התוכנית שלו/ה. רכיב תצוגה שהיה מכיר טבלת לידים היה
        קובע את הניתוב במקום שבו אין לו מושג לאן.

   שימוש:
       <div id="aiShowcase"></div>
       <script defer src="assets/ai-showcase.js"></script>
       ...
       AiShowcase.mountProperty(el, { items, styles, activeStyle, ... });

   ‏opts:
       items          — ההדמיות: { target, style_key, result_url, source_image_url }
       styles         — [{ key, label }] · ריק בנכס מסחרי
       activeStyle    — מפתח הסגנון המוצג · ‏null במסחרי
       commercial     — משנה את תוויות החללים ואת שורות ההסבר
       leadPick       — ‎result_url‎ של התמונון שנבחר עכשיו
       cta / onCta    — הכפתור שמייצר הדמיה חדשה
       lead / onLead  — { intro, emphasis, label } + הפעולה של "השאירו פרטים"
       onSelectStyle  — (styleKey, resultUrl)

   הנתונים מגיעים מבחוץ ולא נשלפים כאן: דף הנכס כבר שלף אותם בשביל הגלריה
   שלו, ושאילתה שנייה לאותן שורות הייתה מייצרת שני מקורות אמת שיכולים
   להיפרד. ‏JS גולמי בלי תלויות.
   ========================================================================== */
(function (global) {
  'use strict';

  var TARGET_LABELS = {
    exterior: 'חזית הבית',
    living_room: 'הסלון',
    kitchen: 'המטבח',
    bedroom: 'חדר השינה',
    business: 'הנכס המסחרי',
    /* ‏interior_main הוא היעד של הדמיית עסק — אותו שם שדף הנכס מציג לו,
       כדי שאותה הדמיה לא תיקרא בשני שמות בשתי סקציות באותו עמוד. */
    interior_main: 'חלל העסק',
  };

  /* אותו יעד, שם אחר לפי קטגוריית הנכס. בדף של חנות או משרד הרצועה הציגה
     "חלל העסק" ליד "חזית הבית" — שתי תוויות שמדברות על אותו נכס בשתי
     שפות, ואחת מהן מדברת על בית שאינו קיים. מה שנשאר בחוץ חשוב לא פחות:
     שאר החללים (סלון, מטבח) אינם מופיעים בנכס מסחרי בכלל, ולכן אין להם
     כאן גרסה. */
  var COMMERCIAL_TARGET_LABELS = {
    exterior: 'חזית העסק',
  };

  /* אותו סימן שהכפתור "הדמיית AI לנכס" נושא בדף הנכס — כוכב גדול וניצוץ
     קטן לצדו. תגית שכתוב עליה רק "הדמיה" באותיות זהב נקראה כתווית טכנית;
     הסימן הזה הוא כבר השפה שבה האתר מסמן תוכן שנוצר ב-AI (האריחים, התגית
     שברצועות, הכפתור על התמונה הראשית), והתגית מצטרפת אליה במקום להמציא
     סימון שני לאותו דבר. */
  var SPARKLE_SVG =
    '<svg class="ai-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/>' +
      '<path d="M18 16.5 18.7 18l1.5.7-1.5.7L18 21l-.7-1.6-1.5-.7 1.5-.7Z"/>' +
    '</svg>';

  /* ---- אייקונים ----
     כל אייקון הוא קו בלבד (‏fill:none, ‏currentColor), ולכן הוא לובש את צבע
     ההקשר שהוא יושב בו: זהב בשורות ההסבר, לבן בשבב סגנון פעיל. אין כאן
     קובץ תמונה ואין תלות בספריית אייקונים — רצועה שנטענת בכל דף נכס לא
     צריכה להביא איתה 40KB בשביל ארבעה סמלים. */
  function icon(paths, cls) {
    return '<svg class="' + (cls || 'ai-ico') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }

  /* הסמן שמסמן "לחצו" והמחוונים שמסמנים "החליפו סגנון" — שני האייקונים
     שמובילים את שורות ההסבר. הם לא קישוט: כל שורה מצביעה על פקד אחר
     בתיבה, והסמל הוא מה שקושר בין המשפט לבין הפקד שהוא מדבר עליו. */
  var ICON_TAP = '<path d="m5 4 6 16 2.2-6.6L20 11Z"/><path d="M15.5 15.5 20 20"/>';
  var ICON_SLIDERS =
    '<path d="M4 6h9"/><path d="M17 6h3"/><circle cx="15" cy="6" r="2"/>' +
    '<path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/>' +
    '<path d="M4 18h9"/><path d="M17 18h3"/><circle cx="15" cy="18" r="2"/>';

  /* אייקון לכל סגנון — הקו העיצובי שלו בסמל אחד: קופסאות נקיות למודרני,
     קרשי עץ לסקנדינבי, קשת וצמח לים-תיכוני, יהלום מעל ספה ליוקרה. ‏DEFAULT
     קיים כדי שסגנון חדש שיתווסף בעתיד יקבל סמל ולא חור בכפתור. */
  var STYLE_ICONS = {
    modern_clean:        '<path d="M3 21h18"/><path d="M6 21V10h6v11"/><path d="M6 15h6"/><path d="M15 21v-7h4v7"/>',
    /* שלושה קווי עץ ולא קרשים מלבניים: מלבנים מוערמים קרובים מדי לאייקון
       המחוונים שיושב בשורת ההסבר שמעליהם, ושני סמלים דומים באותה תיבה
       נקראים כאותו פקד. */
    warm_scandi:         '<path d="M3.5 6c4 2.2 13 2.2 17 0"/>' +
                         '<path d="M3.5 12c4 2.2 13 2.2 17 0"/>' +
                         '<path d="M3.5 18c4 2.2 13 2.2 17 0"/>',
    mediterranean_white: '<path d="M5 21V11a7 7 0 0 1 14 0v10"/><path d="M12 21v-5.5"/>' +
                         '<path d="M12 15.5c-2.2 0-3.4-1.3-3.4-3.4 2.2 0 3.4 1.3 3.4 3.4Z"/>',
    modern_luxury:       '<path d="m12 2.5 4 4-4 5-4-5Z"/>' +
                         '<path d="M4 21v-4.5A2.5 2.5 0 0 1 6.5 14h11a2.5 2.5 0 0 1 2.5 2.5V21"/>' +
                         '<path d="M4 18h16"/>',
  };
  var STYLE_ICON_DEFAULT = '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>';

  function styleIcon(key) {
    return icon(STYLE_ICONS[key] || STYLE_ICON_DEFAULT, 'ai-style-ico');
  }

  function targetLabel(opts, target) {
    if (opts && opts.commercial && COMMERCIAL_TARGET_LABELS[target]) {
      return COMMERCIAL_TARGET_LABELS[target];
    }
    return TARGET_LABELS[target] || 'הנכס';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var CSS = [
    /* ---- הרצועה ---- */
    '.ai-band{background:#0d1b3d;color:#e6ecf9;margin-block:26px;overflow:hidden}',
    '.ai-band-inner{max-width:1180px;margin:0 auto;padding:34px 18px;',
    '  display:grid;grid-template-columns:1fr;gap:24px;align-items:center}',
    /* בשתי עמודות ההזמנה לפגישה יורדת לשורה השנייה של העמודה הראשונה —
       מתחת להבטחה — וטור התמונות נפרש על שתי השורות. כך התמונונות גדלות
       לגובה של שני הבלוקים שלצדן במקום להשאיר חלל כהה מתחתיהן. */
    '@media(min-width:900px){',
    '  .ai-band-inner{grid-template-columns:1.15fr 1fr;gap:34px;padding:44px 32px}',
    '  .ai-band-inner > .ai-show{grid-column:2;grid-row:1/span 2}}',

    /* ---- העמודה הימנית: ההבטחה ---- */
    /* הכותרת נושאת שני צבעים: החצי הראשון — ההבטחה עצמה — בזהב, והחצי
       השני בלבן. זהב הוא כבר "ההדמיה" בתיבה הזאת (המסגרת של לוח הסגנונות,
       הידית שעל הווילון, הכפתור), ולכן החצי שמדבר על הפוטנציאל נצבע בו
       ‏והחצי שמדבר על הטכנולוגיה נשאר לבן. שניהם עוברים 8:1 מול ‎#0d1b3d‎.

       ‏em ולא span: ההדגשה כאן סמנטית ולא קישוטית, וקורא מסך אמור לשמוע
       אותה. ‏font-style חוזר לרגיל — נטוי בעברית הוא הטיה מלאכותית של
       הגופן ולא צורת אות. */
    '.ai-band h3{font-family:Heebo,system-ui,sans-serif;font-size:clamp(22px,4.6vw,30px);',
    '  font-weight:800;letter-spacing:-.02em;line-height:1.2;color:#fff;margin:0 0 14px}',
    '.ai-band h3 em{font-style:normal;font-weight:800}',
    '.ai-hl-after{color:#e5c76a}',
    /* ‏.ai-copy > p‎ ולא ‎.ai-band p‎. הכלל הזה נכתב כשהפסקה היחידה בתיבה
       הייתה פסקת ההבטחה; מאז נוספו לה שכנות — כותרת לוח הסגנונות, הכיתוב
       שמתחת לווילון וההצהרה שבתחתית — וכולן ‎<p>‎. ‏0,1,1 מול ‎0,1,0‎ של
       הכללים הייעודיים שלהן פירושו שהן קיבלו את הצבע, הגודל והמרווח
       התחתון של פסקת ההבטחה: הכיתוב יצא תכלת על הלוח הלבן, ומתחתיו נפתחו
       ‏18px של לבן ריק. */
    '.ai-copy > p{font-size:16px;line-height:1.7;color:#aab6d6;margin:0 0 18px;max-width:46ch}',
    /* ---- שורות ההסבר ----
       הפסקה הרצופה שהייתה כאן הפכה לשתי שורות, ולכל אחת אייקון משלה
       בקצה ההתחלה. הסיבה אינה קישוט: כל שורה מדברת על פקד אחר בתיבה —
       האחת על כפתורי הסגנון והשנייה על החלפת הסגנון — והסמל הוא מה שקושר
       בין המשפט לפקד בלי לכתוב "הכפתור שמשמאל".

       ‏ul ולא שתי פסקאות: אלה שתי הוראות שקולות, וזו רשימה. ‏list-style
       יורד כי הסמל *הוא* התבליט. */
    '.ai-points{list-style:none;margin:0 0 18px;padding:0;',
    '  display:flex;flex-direction:column;gap:9px;max-width:46ch}',
    '.ai-points li{display:flex;align-items:flex-start;gap:9px;',
    '  font-size:15px;line-height:1.6;color:#c2cce6}',
    /* ‏flex:none — אייקון בתוך flex מתכווץ כשהטקסט לצדו ארוך, והקו הדק
       שלו הופך לכתם. ‏margin-top מיישר את מרכז הסמל עם השורה הראשונה. */
    '.ai-points .ai-ico{width:20px;height:20px;flex:none;color:#e5c76a;margin-top:2px}',
    /* הכותרת ושורות ההסבר ממורכזות יחד. הן יחידה אחת — ההבטחה — ומרכוז
       חלקי היה מייצר שני קצוות שמאליים שונים באותו טור.

       הכללים חייבים לבוא *אחרי* ‎.ai-band h3‎ ו-‎.ai-points‎: לכולם אותה
       ספציפיות, ולכן המאוחר בקובץ מנצח. ‏margin-inline:auto נדרש בנוסף
       ל-‎text-align‎ כי הרשימה מוגבלת ל-46 תווים, וטקסט ממורכז בתוך תיבה
       שנצמדת לקצה עדיין נראה צמוד לקצה. */
    '.ai-copy > h3,.ai-copy > p{text-align:center}',
    '.ai-copy > p{margin-inline:auto}',
    '.ai-points{margin-inline:auto}',
    '.ai-compare-caption,.ai-styles-title{line-height:1.5}',
    /* הכפתור ממורכז בשורה שלו ולא נצמד לקצה ההתחלה. הוא הפעולה היחידה
       בתיבה, ופעולה יחידה שיושבת בפינה נקראת כהערת שוליים. */
    '.ai-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:14px}',
    /* הכפתור הראשי זהוב עם טקסט כהה: על רצועה בספיר, ספיר על ספיר לא נקרא,
       וזהב שנושא טקסט לבן נופל בניגודיות.

       הרוחב הוא רוחב העמודה, עם תקרה. כפתור בגודל המילים שבו נבלע בין
       שדות שנמתחים לרוחב מלא ופסקה שמעליהם — הוא נראה קטן ממה שהוא, וזה
       בדיוק ההפך ממה שכפתור יחיד אמור לשדר. התקרה קיימת כדי שבמסך רחב
       הוא יישאר כפתור ולא יהפוך לרצועה.

       הצל זהוב ולא שחור: על ספיר כהה צל שחור אינו נראה, וזוהר עדין בצבע
       הכפתור עצמו הוא מה שמרים אותו מהרקע. */
    '.ai-cta{display:flex;align-items:center;justify-content:center;gap:8px;',
    '  width:100%;max-width:460px;text-align:center;',
    '  background:#c9a227;color:#0d1b3d;text-decoration:none;',
    '  font-family:Heebo,system-ui,sans-serif;font-size:16px;font-weight:800;',
    '  letter-spacing:-.01em;line-height:1.2;',
    '  padding:16px 26px;border:none;cursor:pointer;',
    '  box-shadow:0 10px 26px -14px rgba(201,162,39,.9);',
    '  transition:background .15s ease,box-shadow .15s ease,transform .15s ease}',
    '.ai-cta:hover{background:#dcb63c;color:#0d1b3d;',
    '  box-shadow:0 14px 30px -12px rgba(220,182,60,.95);transform:translateY(-1px)}',
    '.ai-cta:active{transform:translateY(0);box-shadow:0 6px 18px -12px rgba(201,162,39,.9)}',
    '.ai-cta:focus-visible{outline:3px solid #fff;outline-offset:3px}',
    '.ai-secondary{color:#c3cde6;font-size:14px;text-decoration:underline;text-underline-offset:3px}',
    '.ai-secondary:hover{color:#fff}',
    /* ‏grid-column:1/-1 — ההצהרה חוצה את שתי העמודות ויושבת מתחת לשתיהן,
       ולכן היא נקראת כהערת שוליים של התיבה כולה ולא של הטור שהיא בו. */
    /* ---- שורת התחתית ----
       ‏grid-column:1/-1 — ההצהרה חוצה את שתי העמודות ויושבת מתחת לשתיהן,
       ולכן היא נקראת כהערת שוליים של התיבה כולה ולא של הטור שהיא בו. */
    '.ai-foot{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}',
    '.ai-note{margin:0;font-size:12px;line-height:1.55;color:#7b88ab;',
    '  display:inline-flex;align-items:center;gap:6px}',
    '.ai-note .ai-spark{width:13px;height:13px;flex:none;color:#c9a227}',

    /* ---- ההשוואה ----
       המסגרת הלבנה אינה קישוט. כל מה שבתוכה הוא הדמיה — תוכן שנוצר במכונה —
       והלוח הלבן הוא מה שמפריד אותו מהרצועה הכהה שמסביב ומסמן אותו כפריט
       מוצג ולא כצילום של הנכס. הכיתוב יורד לתוך הלוח מאותה סיבה: הוא חלק
       ‏מהתצוגה, לא שורה שנשרכת אחריה על הרקע. */
    '.ai-frame{background:#fff;padding:9px;border-radius:16px;',
    '  box-shadow:0 22px 50px -30px rgba(0,0,0,.8)}',
    '.ai-compare{position:relative;aspect-ratio:4/3;background:#16244a;overflow:hidden;',
    '  border-radius:10px}',
    '.ai-compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
    /* שכבת ה"אחרי" נחשפת דרך clip-path — התמונה עצמה לא נמתחת בזמן הגרירה. */
    '.ai-after{clip-path:inset(0 0 0 var(--ai-pos,42%))}',
    '.ai-compare[data-rtl] .ai-after{clip-path:inset(0 var(--ai-pos,42%) 0 0)}',
    '.ai-divider{position:absolute;top:0;bottom:0;width:2px;background:#c9a227;pointer-events:none;',
    '  inset-inline-start:var(--ai-pos,42%);z-index:3}',
    /* ‏left ולא inset-inline-start: הידית ממורכזת על קו ברוחב 2px, וקיזוז
       פיזי הוא היחיד שיוצא זהה בשני כיווני הכתיבה. */
    '.ai-handle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
    '  width:34px;height:34px;border-radius:50%;background:#c9a227;color:#0d1b3d;',
    '  display:grid;place-items:center;font-size:16px;font-weight:800;',
    '  border:2px solid rgba(255,255,255,.85);',
    '  box-shadow:0 4px 14px rgba(0,0,0,.45);z-index:2}',
    /* ---- התווית שעל הווילון ----
       "גרו כדי לראות את ההבדל" הוא מה שהופך את הסרגל מקו זהב על תמונה
       לפקד שמזמין נגיעה. הוא נצמד לידית ונע איתה, ולכן הוא תמיד במקום
       שאליו העין כבר מסתכלת.

       הוא חי רק ב-‎[data-idle]‎ — כלומר עד המגע הראשון. אחרי שגררו פעם
       אחת ההוראה כבר מיותרת, והיא הופכת לכתם שמכסה שליש מהתמונה בדיוק
       בזמן שמשווים. ‏aria-hidden בצד ה-HTML: הטקסט הזה מדבר על עכבר,
       ולמחוון עצמו יש ‎aria-label‎ שמסביר את אותו דבר למקלדת.

       ‏white-space:nowrap כדי שהתווית לא תישבר לשתי שורות מתחת לידית,
       ‏translateX(-50%) כדי שתישאר ממורכזת על הקו בשני כיווני הכתיבה. */
    '.ai-drag-hint{position:absolute;top:calc(50% + 26px);left:50%;',
    '  transform:translateX(-50%);white-space:nowrap;',
    '  background:linear-gradient(180deg,#e0bf50,#c9a227);color:#0d1b3d;',
    '  font-size:11.5px;font-weight:800;letter-spacing:-.01em;',
    '  padding:6px 14px;border-radius:999px;',
    '  border:1px solid rgba(255,255,255,.55);',
    '  box-shadow:0 6px 16px rgba(0,0,0,.4);opacity:0;transition:opacity .25s ease}',
    '.ai-compare[data-idle] .ai-drag-hint{opacity:1}',
    /* המחוון עצמו שקוף ופרוש על כל הרוחב: הוא נותן גרירה, מגע, מקלדת
       והכרזה לקורא מסך, וכל מה שנראה הוא הקו והידית שמעליו. */
    '.ai-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;',
    '  cursor:ew-resize;z-index:4;-webkit-appearance:none;appearance:none;background:none}',
    '.ai-range:focus-visible ~ .ai-divider .ai-handle{outline:3px solid #fff;outline-offset:2px}',
    /* שתי התוויות הן זוג ולכן הן נראות כזוג: אותה צורה, אותו גודל, ורק
       הצבע מבדיל ביניהן — לבן ל"לפני" (הצילום), ספיר ל"אחרי" (ההדמיה).
       הן פינתיות ומעוגלות כדי שלא ייקראו כחלק מהתמונה עצמה. */
    '.ai-label{position:absolute;top:10px;z-index:2;font-size:11.5px;font-weight:800;',
    '  letter-spacing:.04em;padding:5px 12px;border-radius:8px;',
    '  background:rgba(13,27,61,.86);color:#e6ecf9;',
    '  box-shadow:0 4px 12px rgba(0,0,0,.28)}',
    /* איזה חצי כל תווית מסמנת: שכבת ה"אחרי" נחשפת מהקצה שאינו קצה ההתחלה
       של כיוון הכתיבה — כלומר משמאל בעברית — ולכן "אחרי" יושבת שם
       ו"לפני" בצד הנגדי. הן היו הפוכות: כל תווית ישבה מעל החצי של
       השנייה, וקוראים שהאמינו לתווית ראו את הצילום כהדמיה ולהפך. */
    '.ai-label-before{inset-inline-start:10px;background:#fff;color:#0d1b3d}',
    /* התווית של החצי המדומיין נושאת את הניצוץ ולא רק את המילה "After".
       הניצוץ הוא הסימן שבו האתר מסמן תוכן שנוצר ב-AI (הכפתור על התמונה
       הראשית, התגית שעל האריחים), ומי ששומר או משתף את התמונה לוקח אותו
       איתו. בלעדיו נשארת על התמונה רק מילה באנגלית שאינה אומרת דבר על
       כך שמה שמתחתיה לא צולם. */
    '.ai-label-after{inset-inline-end:10px;background:rgba(13,27,61,.92);color:#f0e4bd;',
    '  display:inline-flex;align-items:center;gap:6px}',
    '.ai-label-after .ai-spark{width:13px;height:13px;flex:none;color:#e5c76a}',
    /* תמונה בודדת (בלי "לפני") אינה חצי של השוואה, ולכן היא לא נושאת את
       תווית ה"אחרי" הזהובה אלא את סימון ה-AI של האתר: לוח לבן, כיתוב
       כהה וניצוץ זהב בצד — אותו מראה בדיוק של הכפתור "הדמיית AI לנכס"
       שיושב על התמונה הראשית של אותו עמוד.
       הכלל בא *אחרי* ‎.ai-label-after‎ בכוונה: לשניהם אותה ספציפיות,
       והמאוחר בקובץ הוא שגובר על הרקע ועל צבע הטקסט. */
    '.ai-label-ai{display:inline-flex;align-items:center;gap:6px;letter-spacing:normal;',
    '  background:rgba(255,255,255,.92);color:#0d1b3d}',
    '.ai-label-ai .ai-spark{width:14px;height:14px;flex:none;color:#c9a227}',
    /* הכיתוב יושב בתוך הלוח הלבן, ולכן הוא כהה על לבן ולא בהיר על ספיר. */
    '.ai-compare-caption{margin:8px 4px 1px;font-size:12.5px;font-weight:700;color:#0d1b3d}',
    /* אותו יחס גובה-רוחב של הווילון: הצד הזה של התיבה לא קורס בין סגנון
       שיש לו הדמיה לסגנון שאין לו. */
    '.ai-empty{aspect-ratio:4/3;display:grid;place-items:center;text-align:center;',
    '  padding:20px;background:rgba(255,255,255,.04);color:#8b97ba;font-size:14px;',
    '  border:1px dashed rgba(255,255,255,.18)}',

    /* ---- רצועת התמונונות ----
       מספר העמודות נגזר ממספר התמונות ולא קבוע על שלוש: סגנון שיש לו שני
       חדרים היה משאיר שליש מהשורה ריק, והאריחים לא היו מתיישרים עם קצה
       התמונה הראשית שמעליהם. עם ‎--ai-cols‎ הרצועה תמיד ממלאה את הרוחב
       המלא, ולכל אריח אותו רוחב ואותו גובה. */
    /* ‏10px מעל הרצועה. הכיתוב של הווילון והאריחים שמתחתיו הם אותה יחידה —
       "מה מוצג" ו"מה עוד אפשר להציג" — ורווח שמפריד ביניהם כמו בין סקציות
       הופך שורה אחת לשתיים. */
    /* ---- הטור השמאלי כעמודה שנמתחת ----
       טור התמונות והטור שלצדו נגמרים באותו קו, ומי שגדל כדי לסגור את
       הפער הוא **הרצועה**: הלוח הלבן שמעליה קבוע ביחס 4:3, וכל מה שנשאר
       מעליו הוא בדיוק מה שהתמונונות היו מוותרות עליו כחלל כהה ריק.

       ‏flex ולא ‎height:100%‎ על התמונונות: הגובה הפנוי אינו ידוע מראש —
       הוא ההפרש בין שני הטורים — ורק פריסה שמחלקת שארית יודעת לחשב אותו.

       במסך צר אין שארית (עמודה אחת, הגובה נגזר מהתוכן), והרצועה נשארת
       בדיוק בגודל התוכן שלה. */
    '.ai-show{display:flex;flex-direction:column;min-width:0}',
    /* ‏flex-shrink:0 ולא ‎1‎: הרצועה גדלה כשיש מקום, אבל לעולם לא מתכווצת
       מתחת ליחס 4:3 של האריחים שבה. */
    '.ai-strip{display:grid;grid-template-columns:repeat(var(--ai-cols,3),minmax(0,1fr));',
    '  gap:10px;margin-top:12px;align-items:stretch;flex:1 0 auto}',
    /* האריח נמתח לגובה השורה, והתמונה שבתוכו לוקחת את מה שנשאר אחרי
       התווית. ‏min-height:0 כדי שהיא תוכל גם לרדת מגובה התוכן שלה כשהטור
       צר, במקום לדחוף את התווית החוצה. */
    'button.ai-thumb,a.ai-thumb{display:flex;flex-direction:column}',
    /* ‏min-width:0 ולא רק ‎1fr‎: תווית שלא נשברת ("הסלון · ים-תיכוני לבן")
       מרחיבה את העמודה שלה מעל חלקה, והתמונונות יוצאות בגדלים שונים. */
    '.ai-thumb{display:block;text-decoration:none;color:#e6ecf9;min-width:0;text-align:center}',
    '.ai-thumb img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;border-radius:8px;',
    '  border:1px solid rgba(255,255,255,.18);flex:1 0 auto;min-height:0}',
    /* התווית נשברת לשתי שורות ולא נקטעת בשלוש נקודות: "הסלון · ים-תיכוני
       לבן" בעמודה של שליש מסך טלפון נחתך בדיוק על שם הסגנון — כלומר על
       החלק שבגללו לוחצים. */
    /* שתי שורות שמורות תמיד ולא רק כתקרה: "חזית הבית" נשבר לשתיים בעמודה
       צרה בזמן ש"הסלון" נשאר באחת, והאריחים היו יוצאים בגבהים שונים. */
    '.ai-thumb span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
    '  overflow:hidden;font-size:12px;font-weight:700;margin-top:5px;line-height:1.35;',
    '  min-height:calc(2em * 1.35)}',
    '.ai-thumb:hover img{border-color:#c9a227}',


    /* ---- מצב נכס: שבבי הסגנונות והתמונונות שאפשר ללחוץ עליהן ----
       הרצועה בדף הנכס מציגה את הנכס עצמו, ולכן היא צריכה גם שליטה: איזה
       סגנון מוצג בווילון, ואיזו הדמיה קודמת עולה במקומו. השבבים והתמונונות
       הם כפתורים אמיתיים ולא קישורים — הם לא מנווטים לשום מקום, הם מחליפים
       את מה שכבר על המסך. */
    /* רשת של שתי עמודות ולא שורת flex עוטפת. ארבעת הסגנונות הם קבוצה אחת
       של בחירות שקולות, ו-flex-wrap נתן לכל שבב את רוחב המילים שבו: שורה
       ראשונה של שניים ברוחבים שונים, שנייה של שניים אחרים, וקצוות שלא
       מתיישרים עם שום דבר בתיבה. שתי עמודות שוות מציגות אותן כארבע
       אפשרויות שוות־ערך, וזה מה שהן. */
    /* אותה תקרה ואותו מירכוז של הכפתור שמתחת: השבבים והכפתור הם צעד אחד
       אחרי השני, ובמסך רחב שני בלוקים ברוחב שונה קוראים כשני מקטעים. */
    /* ---- לוח הסגנונות ----
       ארבעת השבבים היו יושבים על הרקע כמו כל שאר האלמנטים בטור, ולכן הם
       נקראו כהמשך של הפסקה שמעליהם. הלוח עוטף אותם וכותרת קטנה מבקשת את
       הפעולה במפורש — "בחרו את הסגנון המועדף עליכם!" — וכך ארבעה כפתורים
       הופכים לשאלה אחת עם ארבע תשובות. */
    '.ai-styles-card{border:1px solid rgba(201,162,39,.42);border-radius:16px;',
    '  background:rgba(255,255,255,.035);padding:15px 15px 22px;',
    '  margin:0 auto 16px;max-width:460px}',
    '.ai-styles-title{margin:0 0 12px;text-align:center;color:#fff;',
    '  font-family:Heebo,system-ui,sans-serif;font-size:15px;font-weight:800}',
    '.ai-styles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
    /* ‏position:relative בשביל הנקודה שמסמנת את הנבחר (‏::after למטה). */
    '.ai-style{position:relative;font-family:Heebo,system-ui,sans-serif;font-size:13px;',
    '  font-weight:700;padding:11px 10px;cursor:pointer;background:transparent;color:#e6ecf9;',
    '  display:flex;flex-direction:column;align-items:center;gap:6px;line-height:1.25;',
    '  text-align:center;border:1px solid rgba(255,255,255,.28);border-radius:12px;',
    '  transition:border-color .15s ease,box-shadow .15s ease,color .15s ease}',
    '.ai-style-ico{width:26px;height:26px;flex:none;color:#e5c76a}',
    '.ai-style:hover{border-color:#c9a227;color:#fff}',
    /* הנבחר מסומן בשלושה סימנים שלא תלויים זה בזה: מסגרת זהב, זוהר רך,
       ונקודת זהב שיושבת על הקצה התחתון. שלושה ולא אחד כי מי שלא מבחין/ה
       בגוני זהב על ספיר עדיין רואה את הנקודה, ומי שמסתכל/ת בזווית עדיין
       רואה את הזוהר. הרקע נשאר כהה — היפוך ללבן היה מנתק את השבב הנבחר
       מהלוח שהוא יושב בו. */
    '.ai-style[aria-pressed="true"]{border-color:#e5c76a;color:#fff;',
    '  background:rgba(201,162,39,.12);box-shadow:0 0 0 1px rgba(229,199,106,.5),',
    '  0 8px 24px -10px rgba(201,162,39,.85)}',
    '.ai-style[aria-pressed="true"]::after{content:"";position:absolute;',
    '  bottom:-9px;left:50%;transform:translateX(-50%);width:16px;height:16px;',
    '  border-radius:50%;background:#e5c76a;border:3px solid #0d1b3d}',
    '.ai-style:focus-visible{outline:3px solid #fff;outline-offset:2px}',

    /* ---- הזמנת הפגישה ----
       התיבה הזאת עונה על השאלה שנשאלת מיד אחרי שרואים מה AI עשה לנכס של
       מישהו אחר: "ומה עם שלי?".

       היא זהובה מלאה ולא מסגרת זהב על ספיר. מסגרת על רקע כהה נקראת
       כהודעה — משהו שכתוב, לא משהו שלוחצים עליו — וזו הפעולה שכל התיבה
       מובילה אליה. הזהב המלא הוא כבר שפת הפעולה של האתר (‏.ai-cta‎ ממש
       באותה תיבה), והצל הזהוב הוא מה שמרים אותה מהספיר: צל שחור על רקע
       כהה אינו נראה.

       ‏button ולא קישור: היא לא מנווטת לשום מקום — היא מקפיצה את טופס
       הפנייה שכבר בעמוד ומעבירה אליו את המיקוד. */
    '.ai-lead{display:block;width:100%;cursor:pointer;',
    '  font-family:Heebo,system-ui,sans-serif;text-align:center;',
    '  border:none;border-radius:14px;padding:13px 18px;',
    '  background:linear-gradient(180deg,#e0bf50,#c9a227);color:#0d1b3d;',
    '  box-shadow:0 12px 28px -14px rgba(201,162,39,.95);',
    '  transition:filter .15s ease,box-shadow .15s ease,transform .15s ease}',
    '.ai-lead:hover{filter:brightness(1.08);',
    '  box-shadow:0 16px 32px -12px rgba(220,182,60,1);transform:translateY(-1px)}',
    '.ai-lead:active{transform:translateY(0);box-shadow:0 8px 20px -14px rgba(201,162,39,.95)}',
    '.ai-lead:focus-visible{outline:3px solid #fff;outline-offset:3px}',
    /* השורה הראשונה כהה-רכה והשנייה כהה-מלאה: על זהב שתיהן קריאות הרבה
       מעל 4.5:1, וההבדל ביניהן הוא מה שאומר מה הכותרת ומה הפעולה. */
    '.ai-lead-intro{display:block;font-size:13.5px;font-weight:700;line-height:1.5;',
    '  color:rgba(13,27,61,.82)}',
    '.ai-lead-intro strong{color:#0d1b3d;font-weight:900}',
    '.ai-lead-main{display:block;margin-top:2px;font-size:16px;font-weight:900;',
    '  color:#0d1b3d;letter-spacing:-.01em}',
    '@media (prefers-reduced-motion: reduce){.ai-lead:hover,.ai-lead:active{transform:none}}',
    /* בזמן "יוצרים…" הכפתור לא מגיב למגע: הרמה וזוהר על כפתור מושבת
       מבטיחים לחיצה שלא תקרה. */
    '.ai-cta[disabled]{opacity:.6;cursor:default}',
    '.ai-cta[disabled]:hover{background:#c9a227;transform:none;',
    '  box-shadow:0 10px 26px -14px rgba(201,162,39,.9)}',

    /* ---- חריץ הבקשה ----
       הרצועה לא מרכיבה את שדות הבקשה בעצמה — היא רק שומרת להם מקום מעל
       הכפתור, והדף מזיז לתוכו את הצומת החי. הסיבה בקובץ הקורא: הרצועה
       מורכבת מחדש מ-innerHTML בכל שינוי, ושדה שהיה חלק מה-HTML הזה היה
       מתאפס באמצע ההקלדה.
       ‏:empty — במסלול שאין בו בקשה (נכס פרטי) החריץ לא תופס שום מקום. */
    '.ai-ask{margin:0 0 16px}',
    '.ai-ask:empty{display:none}',
    'button.ai-thumb{font:inherit;padding:0;border:0;background:none;width:100%;',
    '  text-align:inherit;cursor:pointer}',
    'button.ai-thumb[aria-pressed="true"] img{border-color:#c9a227}',

    /* ---- מצב מנוחה: הסרגל נע לבד עד המגע הראשון ---- */
    '.ai-compare[data-idle] .ai-after{animation:aiWipe 9s ease-in-out infinite alternate}',
    '.ai-compare[data-idle] .ai-divider{animation:aiSlide 9s ease-in-out infinite alternate}',
    '.ai-compare[data-idle] .ai-label-before{animation:aiLabel 9s ease-in-out infinite alternate}',
    /* שני ה-keyframes האלה חייבים לתאר את *אותו* קו. ב-RTL שכבת ה"אחרי"
       נחשפת דרך ‎inset‎ מימין, והמפריד יושב על ‎inset-inline-start‎ שהוא גם
       הוא מרחק מימין — ולכן שני הערכים זהים בכל פריים. הם היו הפוכים
       (‏70%→22% מול 30%→78%), והתוצאה הייתה קו זהב שנוסע לכיוון אחד בזמן
       שהתמונה נחשפת לכיוון השני. */
    '@keyframes aiWipe{from{clip-path:inset(0 70% 0 0)}to{clip-path:inset(0 22% 0 0)}}',
    '@keyframes aiSlide{from{inset-inline-start:70%}to{inset-inline-start:22%}}',
    '@keyframes aiLabel{from{opacity:1}to{opacity:.45}}',
    '@media (prefers-reduced-motion: reduce){',
    '  .ai-compare[data-idle] .ai-after,.ai-compare[data-idle] .ai-divider,',
    '  .ai-compare[data-idle] .ai-label-before{animation:none}',
    /* ההרמה של הכפתור היא קישוט ולא מידע — היא נופלת יחד עם השאר, והצבע
       לבדו נשאר לסמן ריחוף. */
    '  .ai-cta{transition:background .15s ease}',
    '  .ai-cta:hover,.ai-cta:active{transform:none}}',
  ].join('');

  function injectCss() {
    if (document.getElementById('ai-showcase-css')) return;
    var style = document.createElement('style');
    style.id = 'ai-showcase-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function wireCompare(root) {
    var box = root.querySelector('.ai-compare');
    if (!box) return;
    var range = box.querySelector('.ai-range');
    if (!range) return;

    var apply = function () {
      box.style.setProperty('--ai-pos', range.value + '%');
    };
    /* המגע הראשון מפסיק את אנימציית המנוחה לתמיד ומעביר את השליטה לגולש/ת.
       ‏pointerdown ולא click: העצירה צריכה לקרות ברגע התפיסה, לא בשחרור. */
    var takeOver = function () {
      if (!box.hasAttribute('data-idle')) return;
      box.removeAttribute('data-idle');
      apply();
    };
    range.addEventListener('pointerdown', takeOver);
    range.addEventListener('keydown', takeOver);
    range.addEventListener('focus', takeOver);
    range.addEventListener('input', function () { takeOver(); apply(); });
  }

  /* ==========================================================================
     מצב נכס — הרצועה מציגה את הנכס שבעמוד, לא את המרקטפלייס
     --------------------------------------------------------------------------
     מי שנמצא/ת בדף נכס כבר בחר/ה נכס, ולכן השאלה היחידה שהרצועה עונה
     עליה היא **הנכס הזה**: הצילום שלו מול ההדמיה שלו, ומתחתיהם שאר
     הכיוונים העיצוביים שכבר הופקו לו.

     הנתונים לא נשלפים כאן: דף הנכס כבר שלף אותם בשביל הגלריה שלו, ושאילתה
     שנייה לאותן שורות הייתה מייצרת שני מקורות אמת שיכולים להיפרד. הצד הזה
     מקבל אותם כמו שהם ומחזיר תצוגה.

     שלושה כללים נוספים על אלה שלמעלה:

       1. **הסלון קודם.** מי שמסתכל/ת על נכס מודד/ת אותו לפי החלל המרכזי,
          ולכן הווילון נפתח על הסלון אם יש לו הדמיה — ורק אחר כך על המטבח
          או על החזית.
       2. **בלי תמונת מקור אין וילון.** הדמיה ששורתה לא שמרה ‎source_image_url‎
          מוצגת כתמונה בודדת עם תווית "הדמיה". אין כאן נפילה לצילום אחר של
          הנכס: הווילון מבטיח את *אותו מקום* לפני ואחרי, וכל תמונה שאינה
          המקור של ההדמיה הזאת מפרה את ההבטחה הזאת.
       3. **התמונונות הן של הנכס.** הן לא מנווטות לשום מקום — הן מחליפות את
          מה שבווילון, ולכן הן כפתורים ולא קישורים.
     ========================================================================== */

  /* סדר החדרים בווילון: הסלון הוא החלל שמוכר נכס, החזית היא הרושם הראשון,
     והמטבח הוא מה שנשאר. חלל עסק נכנס אחרי הסלון כי בנכס מסחרי הוא *הוא*
     הסלון. */
  var LEAD_TARGET_ORDER = ['living_room', 'interior_main', 'exterior', 'kitchen'];

  function styleLabelOf(opts, key) {
    var list = opts.styles || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label;
    return '';
  }

  /* התווית של תמונון היא שם החדר בלבד. כשכל התמונות בתיבה הן אותו סגנון,
     "· מודרני נקי" חוזר על עצמו בכל אחת מהן ורק דוחק את שם החדר לשורה
     שנייה — הסגנון כבר כתוב בשבב המסומן שמעליהן.

     הכיתוב מתחת לווילון כן נושא את שם הסגנון: הוא אחד, והוא מה שמסביר
     מה בדיוק רואים. */
  function pairCaption(opts, it) {
    return targetLabel(opts, it.target);
  }

  function leadCaption(opts, it) {
    var where = pairCaption(opts, it);
    var style = styleLabelOf(opts, it.style_key);
    return style ? where + ' · ' + style : where;
  }

  /* ‏**התיבה מציגה סגנון אחד בכל רגע.** ‏activeStyle הוא לא העדפת מיון
     אלא מסנן: הווילון והתמונונות שמתחתיו הם אותו כיוון עיצובי, ולחיצה על
     שבב מחליפה את כל התצוגה. ההצגה של ארבעת הסגנונות יחד הפכה את הרצועה
     לתריסר תמונות שאי אפשר להשוות ביניהן — ארבעה מטבחים שונים זה ליד זה
     הם קטלוג, לא הצעה.

     הסדר בתוך הסגנון קבוע (סדר החדרים), ולכן לחיצה על תמונון לא מסדרת
     מחדש את השורה — היא רק מזיזה את הסימון ואת מה שבווילון. */
  function orderPairs(opts) {
    var active = opts.activeStyle || null;
    var items = (opts.items || []).filter(function (i) {
      return i && i.result_url && (!active || i.style_key === active);
    });
    var rank = function (it) {
      var byTarget = LEAD_TARGET_ORDER.indexOf(it.target);
      return byTarget < 0 ? 90 : byTarget;
    };
    return items.slice().sort(function (a, b) { return rank(a) - rank(b); });
  }

  /* איזה פריט נפתח בווילון: ‎leadPick‎ (התמונון שנלחץ ממש עכשיו) גובר על
     הכול; בלעדיו הראשון לפי סדר החדרים — כלומר הסלון. */
  function leadIndexOf(pairs, opts) {
    var pick = opts.leadPick || null;
    if (pick) {
      for (var i = 0; i < pairs.length; i++) if (pairs[i].result_url === pick) return i;
    }
    return 0;
  }

  /* ‏source_image_url הוא הצילום שההדמיה נוצרה ממנו — הצד ה"לפני" האמיתי,
     והיחיד. קודם הייתה כאן נפילה לתמונה הראשית של הנכס, מתוך מחשבה שצילום
     אמיתי של הנכס עדיף על שום צילום. הוא לא: הווילון מבטיח *אותו מקום* לפני
     ואחרי, והתמונה הראשית היא מקום אחר. בנכס מסחרי היא החזית, ולכן "חלל
     העסק" הוצג כחזית הבניין מצד אחד ופנים העסק מצד שני.

     בלי מקור אין וילון — יש תמונה בודדת עם תווית "הדמיה", וזו אמירה נכונה
     ולא חצי הבטחה. */
  function beforeUrl(opts, it) {
    return (it && it.source_image_url) || '';
  }

  function propertyCompareHtml(opts, it) {
    var where = targetLabel(opts, it.target);
    var before = beforeUrl(opts, it);
    var caption = leadCaption(opts, it);

    if (!before) {
      return '' +
        '<div class="ai-frame">' +
          '<div class="ai-compare" data-single>' +
            '<img src="' + esc(it.result_url) + '" alt="הדמיה של ' + esc(where) + '" loading="lazy">' +
            '<span class="ai-label ai-label-after ai-label-ai">' + SPARKLE_SVG + 'הדמיית AI</span>' +
          '</div>' +
          '<p class="ai-compare-caption">' + esc(caption) + '</p>' +
        '</div>';
    }

    return '' +
      '<div class="ai-frame">' +
        '<div class="ai-compare" data-idle data-rtl>' +
          '<img class="ai-before" src="' + esc(before) + '" alt="' + esc(where) + ' כפי שהוא היום" loading="lazy">' +
          '<img class="ai-after" src="' + esc(it.result_url) + '" alt="הדמיה של ' + esc(where) + ' אחרי שיפוץ" loading="lazy">' +
          '<span class="ai-label ai-label-before">Before</span>' +
          '<span class="ai-label ai-label-after">' + SPARKLE_SVG + 'After</span>' +
          '<input class="ai-range" type="range" min="0" max="100" value="42" step="1" ' +
                 'aria-label="חשיפת ההדמיה — הזיזו כדי להשוות בין לפני לאחרי">' +
          '<div class="ai-divider">' +
            '<span class="ai-handle" aria-hidden="true">↔</span>' +
            '<span class="ai-drag-hint" aria-hidden="true">גרו כדי לראות את ההבדל</span>' +
          '</div>' +
        '</div>' +
        '<p class="ai-compare-caption">' + esc(caption) + '</p>' +
      '</div>';
  }

  function propertyThumbHtml(opts, it, index, active) {
    return '<button class="ai-thumb" type="button" data-index="' + index + '" ' +
             'aria-pressed="' + (active ? 'true' : 'false') + '">' +
             '<img src="' + esc(it.result_url) + '" alt="הדמיה של ' + esc(pairCaption(opts, it)) + '" loading="lazy">' +
             '<span>' + esc(pairCaption(opts, it)) + '</span>' +
           '</button>';
  }

  /* בתוך סגנון אחד יש לכל היותר שלושה חדרים (חזית, סלון, מטבח), ולכן
     התקרה כאן היא ביטוח ולא מדיניות. */
  var PROPERTY_STRIP_LIMIT = 4;

  function renderProperty(container, opts) {
    var pairs = orderPairs(opts);
    var leadIndex = leadIndexOf(pairs, opts);
    var activeStyleLabel = styleLabelOf(opts, opts.activeStyle);
    var styles = opts.styles || [];
    var cta = opts.cta || {};

    var lead = opts.lead || {};

    /* לוח הסגנונות: כותרת שמבקשת את הפעולה, ומתחתיה ארבעה שבבים שלכל אחד
       אייקון משלו. האייקון אינו קישוט — ארבע שורות טקסט זהות באורכן נקראות
       כרשימה, וארבעה סמלים שונים נקראים כארבע אפשרויות. */
    var stylesHtml = styles.length
      ? '<div class="ai-styles-card">' +
          '<p class="ai-styles-title">בחרו את הסגנון המועדף עליכם!</p>' +
          '<div class="ai-styles" role="group" aria-label="כיוון עיצובי">' +
            styles.map(function (s) {
              return '<button class="ai-style" type="button" data-style="' + esc(s.key) + '" ' +
                     'aria-pressed="' + (s.key === opts.activeStyle ? 'true' : 'false') + '">' +
                     styleIcon(s.key) + '<span>' + esc(s.label) + '</span></button>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    /* תיבת "השאירו פרטים" מופיעה רק כשיש למי לפנות: הדף הקורא מספק גם את
       הטקסט וגם את הפעולה. בלי ‎onLead‎ אין כאן הבטחה ריקה. */
    var leadHtml = (opts.onLead && lead.label)
      ? '<button class="ai-lead" type="button" id="aiPropLead">' +
          (lead.intro
            ? '<span class="ai-lead-intro">' + esc(lead.intro) +
                (lead.emphasis ? ' <strong>' + esc(lead.emphasis) + '</strong>' : '') +
              '</span>'
            : '') +
          '<span class="ai-lead-main">' + esc(lead.label) + '</span>' +
        '</button>'
      : '';

    /* כפתור בלבד. כשכל ההדמיות בסגנון הנבחר כבר קיימות אין מה להציע —
       לחיצה הייתה מייצרת מחדש את מה שכבר על המסך — והשורה פשוט לא
       מופיעה. השבבים שמעליה הם ממילא הדרך לייצר עוד, ומשפט שמסביר את
       זה היה עוד פסקה בין המבקר/ת לבין התמונה. */
    var actionsHtml = cta.label
      ? '<div class="ai-actions">' +
          '<button class="ai-cta" type="button" id="aiPropCta"' + (cta.busy ? ' disabled' : '') + '>' +
            esc(cta.busy ? 'יוצרים…' : cta.label) +
          '</button>' +
        '</div>'
      : '';

    container.innerHTML = '' +
      '<section class="ai-band" aria-labelledby="aiBandTitle">' +
        '<div class="ai-band-inner">' +
          '<div class="ai-copy">' +
            /* השבירה כתובה ולא מקרית: שני חצאי הכותרת הם שתי אמירות שונות
               — מה מקבלים ("הפוטנציאל של הנכס שלכם") ובאיזה כלי ("AI") —
               ושבירה שנופלת באמצע אחד מהם מפרקת את שניהם. */
            '<h3 id="aiBandTitle"><em class="ai-hl-after">תראו את פוטנציאל הנכס</em><br>' +
              'עם טכנולוגיית AI מהפכנית!</h3>' +
            /* שתי שורות ההסבר משתנות לפי מה שיש על המסך: בנכס מסחרי אין
               שבבי סגנון, ו"לחצו על כפתורי הסגנון" שם מפנה לפקד שאינו
               קיים — מה שנדרש שם הוא סוג העסק. */
            '<ul class="ai-points">' +
              (styles.length
                ? '<li>' + icon(ICON_TAP) + '<span>לחצו על כפתורי הסגנון וצפו בהדמיות מיידיות ' +
                    'של הנכס המשופץ — עוד לפני שאתם קונים.</span></li>' +
                  '<li>' + icon(ICON_SLIDERS) + '<span>שנו סגנון וראו את הפוטנציאל.</span></li>'
                : '<li>' + icon(ICON_TAP) + '<span>ספרו איזה עסק תפתחו כאן וצפו בהדמיה מיידית ' +
                    'של הנכס — עוד לפני שחתמתם.</span></li>' +
                  '<li>' + icon(ICON_SLIDERS) + '<span>ההדמיה נוצרת מהתמונות של הנכס הזה בלבד.</span></li>') +
            '</ul>' +
            stylesHtml +
            /* השדות שהבקשה זקוקה להם יושבים *מעל* הכפתור ולא מתחתיו: הכפתור
               הוא סוף הפעולה, ומה שנדרש כדי ללחוץ עליו בא לפניו. */
            '<div class="ai-ask" id="aiPropAsk"></div>' +
            actionsHtml +
          '</div>' +
          /* סגנון שטרם נוצר מקבל מסגרת ריקה ולא היעלמות: התיבה מציגה סגנון
             אחד בכל רגע, ולחיצה על שבב שאין לו הדמיה הייתה מוחקת את כל
             הצד הזה — מה שנקרא כתקלה ולא כ"עוד לא יצרתם את זה". */
          '<div class="ai-show">' +
            (pairs.length
              ? '<div id="aiPropCompare">' + propertyCompareHtml(opts, pairs[leadIndex]) + '</div>' +
                (pairs.length > 1
                  /* בלי כותרת מעל הרצועה. כל אריח נושא את שם החלל שלו,
                     ושורה שאומרת "עוד חללים בנכס" מעל שורת אריחים שכתוב
                     עליהם "חלל העסק" ו"חזית העסק" רק חוזרת עליהם בקול. */
                  ? '<div class="ai-strip" style="--ai-cols:' +
                      Math.min(pairs.length, PROPERTY_STRIP_LIMIT, 3) + '">' +
                      pairs.slice(0, PROPERTY_STRIP_LIMIT).map(function (it, i) {
                        return propertyThumbHtml(opts, it, i, i === leadIndex);
                      }).join('') +
                    '</div>'
                  : '')
              : '<div class="ai-empty">' +
                  esc(activeStyleLabel
                    ? 'עדיין אין הדמיה בסגנון ' + activeStyleLabel
                    : 'עדיין אין הדמיה לנכס הזה') +
                '</div>') +
          '</div>' +
          /* ההזמנה לפגישה היא פריט גריד בפני עצמו ולא ילד של אחד הטורים,
             וזה מה שמאפשר לה לשבת בשני מקומות שונים בשתי הפריסות: בשתי
             עמודות היא חותמת את טור ההבטחה (שורה שנייה בעמודה הראשונה,
             ‏CSS למטה), ובעמודה אחת היא פשוט באה אחרי התמונות.

             הסדר הזה חשוב במובייל: כילדה של ‎.ai-copy‎ היא הופיעה *לפני*
             הווילון — כלומר ביקשה פרטים לפני שהראתה משהו. */
          leadHtml +
          /* ההצהרה יורדת לתחתית התיבה ומתקצרת לשורה אחת. במקומה הקודם —
             בין הכפתור לבין התמונה — היא הייתה פסקה שעוצרת את מי שבא/ה
             לראות; כאן היא נמצאת, ניתנת לקריאה, ולא בדרך.

             הפירוט שהיה כאן ("לא תוכנית בנייה, לא התחייבות של המוכר או
             המשרד, ולא עדות להיתרים או לזכויות בנייה") ירד מהתיבה. הוא
             לא נמחק מהאתר: תנאי השימוש מפרטים אותו במלואו, וזה המקום שבו
             הצהרה משפטית מחייבת. כאן נשאר המשפט שאומר לגולש/ת את מה
             שהיא/הוא צריך/ה לדעת בזמן ההסתכלות. */
          /* שורה אחת ולא שתיים. לצד ההצהרה הזאת ישבה כאן "תוכן שהופק על ידי
             בינה מלאכותית" — נכונה, אבל אומרת את אותו דבר פעם שלישית: תווית
             ה-After שעל התמונה כבר נושאת את הניצוץ שמסמן תוכן שנוצר במכונה,
             וההצהרה הזאת כבר אומרת שמדובר בהמחשה. */
          '<div class="ai-foot">' +
            '<p class="ai-note">' + SPARKLE_SVG + 'ההדמיות הן להמחשה עיצובית בלבד.</p>' +
          '</div>' +
        '</div>' +
      '</section>';

    wireCompare(container);

    var compareBox = container.querySelector('#aiPropCompare');
    if (compareBox) container.querySelectorAll('.ai-thumb').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.dataset.index);
        var it = pairs[i];
        if (!it) return;
        leadIndex = i;
        compareBox.innerHTML = propertyCompareHtml(opts, it);
        wireCompare(container);
        container.querySelectorAll('.ai-thumb').forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        /* בחירת תמונון היא גם בחירת סגנון: הרשת שבסקציה שמעל מציגה את
           הסגנון הנבחר, והשתיים לא אמורות להראות שני סגנונות שונים. */
        if (it.style_key && it.style_key !== opts.activeStyle && opts.onSelectStyle) {
          opts.onSelectStyle(it.style_key, it.result_url);
        }
      });
    });

    container.querySelectorAll('.ai-style').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (opts.onSelectStyle) opts.onSelectStyle(btn.dataset.style);
      });
    });

    var ctaBtn = container.querySelector('#aiPropCta');
    if (ctaBtn && opts.onCta) ctaBtn.addEventListener('click', function () { opts.onCta(); });

    var leadBtn = container.querySelector('#aiPropLead');
    if (leadBtn && opts.onLead) leadBtn.addEventListener('click', function () { opts.onLead(); });
  }

  /* הרכיב לא מחזיק מצב בין קריאות: כל שינוי בדף הנכס (סגנון אחר, הדמיה
     שהרגע נוצרה) הוא קריאה נוספת עם אותם ‎opts‎ מעודכנים. */
  function mountProperty(container, opts) {
    if (!container || !opts) return;
    injectCss();
    renderProperty(container, opts);
  }

  global.AiShowcase = { mountProperty: mountProperty };

})(window);
