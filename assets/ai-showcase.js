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

   שימוש:
       <div id="aiShowcase"></div>
       <script defer src="assets/ai-showcase.js"></script>
       ...
       AiShowcase.mountProperty(el, { items, styles, activeStyle, ... });

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
    '@media(min-width:900px){.ai-band-inner{grid-template-columns:1.15fr 1fr;gap:34px;padding:44px 32px}}',

    /* ---- העמודה הימנית: ההבטחה ---- */
    '.ai-eyebrow{display:inline-flex;align-items:center;gap:7px;',
    '  border:1px solid rgba(201,162,39,.55);color:#e5c76a;',
    '  font-size:11px;font-weight:800;letter-spacing:.1em;padding:5px 10px;margin-bottom:14px}',
    '.ai-band h3{font-family:Heebo,system-ui,sans-serif;font-size:clamp(22px,4.6vw,30px);',
    '  font-weight:800;letter-spacing:-.02em;line-height:1.15;color:#fff;margin:0 0 10px}',
    '.ai-band p{font-size:16px;line-height:1.7;color:#aab6d6;margin:0 0 18px;max-width:46ch}',
    '.ai-actions{display:flex;flex-wrap:wrap;align-items:center;gap:14px}',
    /* הכפתור הראשי זהוב עם טקסט כהה: על רצועה בספיר, ספיר על ספיר לא נקרא,
       וזהב שנושא טקסט לבן נופל בניגודיות. */
    '.ai-cta{display:inline-flex;align-items:center;gap:8px;background:#c9a227;color:#0d1b3d;',
    '  text-decoration:none;',
    '  font-family:Heebo,system-ui,sans-serif;font-size:15px;font-weight:800;',
    '  padding:13px 22px;border:none;cursor:pointer;text-decoration:none}',
    '.ai-cta:hover{background:#dcb63c;color:#0d1b3d}',
    '.ai-secondary{color:#c3cde6;font-size:14px;text-decoration:underline;text-underline-offset:3px}',
    '.ai-secondary:hover{color:#fff}',
    /* ‏grid-column:1/-1 — ההצהרה חוצה את שתי העמודות ויושבת מתחת לשתיהן,
       ולכן היא נקראת כהערת שוליים של התיבה כולה ולא של הטור שהיא בו. */
    '.ai-note{grid-column:1/-1;margin:2px 0 0;font-size:12px;line-height:1.6;color:#7b88ab}',

    /* ---- ההשוואה ---- */
    '.ai-compare{position:relative;aspect-ratio:4/3;background:#16244a;overflow:hidden;',
    '  box-shadow:0 22px 50px -30px rgba(0,0,0,.8)}',
    '.ai-compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
    /* שכבת ה"אחרי" נחשפת דרך clip-path — התמונה עצמה לא נמתחת בזמן הגרירה. */
    '.ai-after{clip-path:inset(0 0 0 var(--ai-pos,42%))}',
    '.ai-compare[data-rtl] .ai-after{clip-path:inset(0 var(--ai-pos,42%) 0 0)}',
    '.ai-divider{position:absolute;top:0;bottom:0;width:2px;background:#c9a227;pointer-events:none;',
    '  inset-inline-start:var(--ai-pos,42%);z-index:3}',
    /* ‏left ולא inset-inline-start: הידית ממורכזת על קו ברוחב 2px, וקיזוז
       פיזי הוא היחיד שיוצא זהה בשני כיווני הכתיבה. */
    '.ai-handle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
    '  width:32px;height:32px;border-radius:50%;background:#c9a227;color:#0d1b3d;',
    '  display:grid;place-items:center;font-size:15px;font-weight:800;',
    '  box-shadow:0 4px 14px rgba(0,0,0,.45)}',
    /* המחוון עצמו שקוף ופרוש על כל הרוחב: הוא נותן גרירה, מגע, מקלדת
       והכרזה לקורא מסך, וכל מה שנראה הוא הקו והידית שמעליו. */
    '.ai-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;',
    '  cursor:ew-resize;z-index:4;-webkit-appearance:none;appearance:none;background:none}',
    '.ai-range:focus-visible ~ .ai-divider .ai-handle{outline:3px solid #fff;outline-offset:2px}',
    '.ai-label{position:absolute;top:10px;z-index:2;font-size:11px;font-weight:800;',
    '  letter-spacing:.08em;padding:4px 9px;background:rgba(13,27,61,.82);color:#e6ecf9}',
    /* איזה חצי כל תווית מסמנת: שכבת ה"אחרי" נחשפת מהקצה שאינו קצה ההתחלה
       של כיוון הכתיבה — כלומר משמאל בעברית — ולכן "אחרי" יושבת שם
       ו"לפני" בצד הנגדי. הן היו הפוכות: כל תווית ישבה מעל החצי של
       השנייה, וקוראים שהאמינו לתווית ראו את הצילום כהדמיה ולהפך. */
    '.ai-label-before{inset-inline-start:10px}',
    '.ai-label-after{inset-inline-end:10px;background:rgba(201,162,39,.92);color:#0d1b3d}',
    '.ai-compare-caption{margin:9px 0 0;font-size:12px;color:#8b97ba}',
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
    '.ai-strip{display:grid;grid-template-columns:repeat(var(--ai-cols,3),minmax(0,1fr));',
    '  gap:8px;margin-top:14px;align-items:start}',
    /* ‏min-width:0 ולא רק ‎1fr‎: תווית שלא נשברת ("הסלון · ים-תיכוני לבן")
       מרחיבה את העמודה שלה מעל חלקה, והתמונונות יוצאות בגדלים שונים. */
    '.ai-thumb{display:block;text-decoration:none;color:#e6ecf9;min-width:0}',
    '.ai-thumb img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;',
    '  border:1px solid rgba(255,255,255,.12)}',
    /* התווית נשברת לשתי שורות ולא נקטעת בשלוש נקודות: "הסלון · ים-תיכוני
       לבן" בעמודה של שליש מסך טלפון נחתך בדיוק על שם הסגנון — כלומר על
       החלק שבגללו לוחצים. */
    /* שתי שורות שמורות תמיד ולא רק כתקרה: "חזית הבית" נשבר לשתיים בעמודה
       צרה בזמן ש"הסלון" נשאר באחת, והאריחים היו יוצאים בגבהים שונים. */
    '.ai-thumb span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
    '  overflow:hidden;font-size:12px;font-weight:700;margin-top:5px;line-height:1.35;',
    '  min-height:calc(2em * 1.35)}',
    '.ai-thumb:hover img{border-color:#c9a227}',
    '.ai-strip-title{font-size:11px;font-weight:800;letter-spacing:.1em;color:#8b97ba;margin:18px 0 0}',


    /* ---- מצב נכס: שבבי הסגנונות והתמונונות שאפשר ללחוץ עליהן ----
       הרצועה בדף הנכס מציגה את הנכס עצמו, ולכן היא צריכה גם שליטה: איזה
       סגנון מוצג בווילון, ואיזו הדמיה קודמת עולה במקומו. השבבים והתמונונות
       הם כפתורים אמיתיים ולא קישורים — הם לא מנווטים לשום מקום, הם מחליפים
       את מה שכבר על המסך. */
    '.ai-styles{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}',
    '.ai-style{font-family:Heebo,system-ui,sans-serif;font-size:13px;font-weight:700;',
    '  padding:8px 14px;cursor:pointer;background:transparent;color:#e6ecf9;',
    '  border:1px solid rgba(255,255,255,.28)}',
    '.ai-style:hover{border-color:#c9a227;color:#fff}',
    '.ai-style[aria-pressed="true"]{background:#fff;color:#0d1b3d;border-color:#fff}',
    '.ai-cta[disabled]{opacity:.6;cursor:default}',

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
    '  .ai-compare[data-idle] .ai-label-before{animation:none}}',
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
    return TARGET_LABELS[it.target] || 'הנכס';
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
    var where = TARGET_LABELS[it.target] || 'הנכס';
    var before = beforeUrl(opts, it);
    var caption = leadCaption(opts, it);

    if (!before) {
      return '' +
        '<div class="ai-compare" data-single>' +
          '<img src="' + esc(it.result_url) + '" alt="הדמיה של ' + esc(where) + '" loading="lazy">' +
          '<span class="ai-label ai-label-after">הדמיה</span>' +
        '</div>' +
        '<p class="ai-compare-caption">' + esc(caption) + '</p>';
    }

    return '' +
      '<div class="ai-compare" data-idle data-rtl>' +
        '<img class="ai-before" src="' + esc(before) + '" alt="' + esc(where) + ' כפי שהוא היום" loading="lazy">' +
        '<img class="ai-after" src="' + esc(it.result_url) + '" alt="הדמיה של ' + esc(where) + ' אחרי שיפוץ" loading="lazy">' +
        '<span class="ai-label ai-label-before">לפני</span>' +
        '<span class="ai-label ai-label-after">אחרי · הדמיה</span>' +
        '<input class="ai-range" type="range" min="0" max="100" value="42" step="1" ' +
               'aria-label="חשיפת ההדמיה — הזיזו כדי להשוות בין לפני לאחרי">' +
        '<div class="ai-divider"><span class="ai-handle" aria-hidden="true">↔</span></div>' +
      '</div>' +
      '<p class="ai-compare-caption">' + esc(caption) + '</p>';
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

    var stylesHtml = styles.length
      ? '<div class="ai-styles" role="group" aria-label="כיוון עיצובי">' +
          styles.map(function (s) {
            return '<button class="ai-style" type="button" data-style="' + esc(s.key) + '" ' +
                   'aria-pressed="' + (s.key === opts.activeStyle ? 'true' : 'false') + '">' +
                   esc(s.label) + '</button>';
          }).join('') +
        '</div>'
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
          '<div>' +
            '<span class="ai-eyebrow">✦ הדמיות AI · בלעדי לשוק הנדל״ן</span>' +
            '<h3 id="aiBandTitle">תראו את הנכס אחרי שיפוץ — לפני שאתם קונים</h3>' +
            '<p>ההדמיה נוצרת מהתמונות של הנכס הזה. החליפו בין כיוונים עיצוביים ' +
              'וראו את הפוטנציאל.</p>' +
            stylesHtml +
            /* השדות שהבקשה זקוקה להם יושבים *מעל* הכפתור ולא מתחתיו: הכפתור
               הוא סוף הפעולה, ומה שנדרש כדי ללחוץ עליו בא לפניו. */
            '<div class="ai-ask" id="aiPropAsk"></div>' +
            actionsHtml +
          '</div>' +
          /* סגנון שטרם נוצר מקבל מסגרת ריקה ולא היעלמות: התיבה מציגה סגנון
             אחד בכל רגע, ולחיצה על שבב שאין לו הדמיה הייתה מוחקת את כל
             הצד הזה — מה שנקרא כתקלה ולא כ"עוד לא יצרתם את זה". */
          '<div>' +
            (pairs.length
              ? '<div id="aiPropCompare">' + propertyCompareHtml(opts, pairs[leadIndex]) + '</div>' +
                (pairs.length > 1
                  /* בנכס מסחרי אין סגנונות — יש חללים של אותו עסק, ו"בסגנון
                     הזה" שם מצביע על משהו שלא קיים על המסך. */
                  ? '<p class="ai-strip-title">' +
                      (opts.activeStyle ? 'עוד חדרים בסגנון הזה' : 'עוד חללים בנכס') +
                    '</p>' +
                    '<div class="ai-strip" style="--ai-cols:' +
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
          /* ההצהרה יורדת לתחתית התיבה ומתקצרת לשורה אחת. במקומה הקודם —
             בין הכפתור לבין התמונה — היא הייתה פסקה שעוצרת את מי שבא/ה
             לראות; כאן היא נמצאת, ניתנת לקריאה, ולא בדרך. */
          '<p class="ai-note">ההדמיות הן המחשה עיצובית בלבד — לא תוכנית בנייה, ' +
            'לא התחייבות של המוכר או המשרד, ולא עדות להיתרים או לזכויות בנייה.</p>' +
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
