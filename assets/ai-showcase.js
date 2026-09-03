/* ============================================================================
   רצועת ההדמיות — "לפני ואחרי" כנקודת כניסה, לא כהערת שוליים
   ----------------------------------------------------------------------------
   ההדמיות היו עד היום רצועה שקטה בתוך דף הנכס: מי שלא הגיע לנכס מסוים לא ידע
   שהיכולת קיימת. הרצועה הזאת מרימה אותן לדף הבית — הבדל בין תכונה שקוברים
   לבין סיבה להיכנס לאתר.

   הרכיב מושתת על ‎property_visualizations_public‎, שכבר מחזיק את שני הצדדים
   של ההשוואה: ‎source_image_url‎ (הצילום כפי שהוא) ו-‎result_url‎ (ההדמיה).
   אין צורך במיגרציה, אין תוכן ידני, וכל נכס פרימיום חדש נכנס לרצועה מעצמו.

   שלושה כללים:

     1. **אין תוכן — אין רצועה.** בלי תשובה מהשרת, או בלי זוג תמונות אחד
        לפחות, המכולה נשארת ריקה ולא נשאר שלד של באנר שמבטיח ולא מקיים.
     2. **התנועה היא מצב מנוחה בלבד.** סרגל ההשוואה נע לבד כדי לספר מה
        אפשר לעשות איתו; במגע הראשון — עכבר, מגע או מקלדת — האנימציה נעצרת
        והשליטה עוברת לגולש/ת ולא חוזרת.
     3. **הסרגל הוא ‎<input type=range>‎ אמיתי.** גרירה מותאמת אישית הייתה
        משאירה את הרכיב בלתי נגיש למקלדת; כאן החצים, Home/End ו-PageUp/Down
        עובדים בחינם, וקורא מסך מכריז עליו כמחוון עם ערך.

   שימוש:
       <div id="aiShowcase"></div>
       <script defer src="assets/ai-showcase.js" data-mount="#aiShowcase"></script>

   ‏JS גולמי בלי תלויות מלבד supabase-js, שכבר נטען בכל דף שמדבר עם הנתונים.
   ========================================================================== */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';

  var TARGET_LABELS = {
    exterior: 'חזית הבית',
    living_room: 'הסלון',
    kitchen: 'המטבח',
    bedroom: 'חדר השינה',
    business: 'הנכס המסחרי',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* מחיר בפורמט של שאר האתר: ‎₪‎ אחרי המספר, בלי אגורות, ובשכירות עם "/חודש"
     כדי ש-4,200 לא ייקרא כמחיר דירה. */
  function priceLabel(p) {
    var n = Number(p && p.price);
    if (!Number.isFinite(n) || n <= 0) return 'לפי בקשה';
    var s = n.toLocaleString('he-IL') + ' ₪';
    return p.deal_type === 'rent' ? s + ' לחודש' : s;
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
    '.ai-note{margin:14px 0 0;font-size:12px;line-height:1.6;color:#7b88ab;max-width:46ch}',

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
    '.ai-label-before{inset-inline-end:10px}',
    '.ai-label-after{inset-inline-start:10px;background:rgba(201,162,39,.92);color:#0d1b3d}',
    '.ai-compare-caption{margin:9px 0 0;font-size:12px;color:#8b97ba}',

    /* ---- רצועת התמונונות ---- */
    '.ai-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}',
    '.ai-thumb{display:block;text-decoration:none;color:#e6ecf9}',
    '.ai-thumb img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;',
    '  border:1px solid rgba(255,255,255,.12)}',
    '.ai-thumb span{display:block;font-size:12px;font-weight:700;margin-top:5px;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ai-thumb:hover img{border-color:#c9a227}',
    '.ai-strip-title{font-size:11px;font-weight:800;letter-spacing:.1em;color:#8b97ba;margin:18px 0 0}',


    /* ---- מצב מנוחה: הסרגל נע לבד עד המגע הראשון ---- */
    '.ai-compare[data-idle] .ai-after{animation:aiWipe 9s ease-in-out infinite alternate}',
    '.ai-compare[data-idle] .ai-divider{animation:aiSlide 9s ease-in-out infinite alternate}',
    '.ai-compare[data-idle] .ai-label-before{animation:aiLabel 9s ease-in-out infinite alternate}',
    '@keyframes aiWipe{from{clip-path:inset(0 70% 0 0)}to{clip-path:inset(0 22% 0 0)}}',
    '@keyframes aiSlide{from{inset-inline-start:30%}to{inset-inline-start:78%}}',
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

  /* ---------- שליפת הנתונים ----------
     שתי שאילתות: ההדמיות, ואז הנכסים שלהן. אחת לכל טבלה — לא אחת לכל נכס. */
  /* מחזיר { items, total }:
       ‏items — הנכסים שיש להם זוג לפני/אחרי, כלומר מה שאפשר להראות ברצועה.
       ‏total — כל הנכסים הפעילים שיש להם לפחות הדמיה אחת, כולל כאלה שאין
                להם תמונת מקור להשוואה.

     ההפרדה הזאת נחוצה כי הכפתור מבטיח מספר ("לכל N הנכסים עם הדמיה"),
     והוא חייב להיות אותו מספר שהמסנן בתוצאות מחזיר. אם הוא היה נספר לפי
     מה שהרצועה מציגה, הוא היה נמוך מהאמת בכל נכס שיש לו הדמיה בלי תמונת
     מקור — והכפתור היה משקר. */
  function load(client, exclude) {
    var pairs = client
      .from('property_visualizations_public')
      .select('property_id, target, source_image_url, result_url, created_at')
      .not('source_image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    /* אותו מקור בדיוק שממנו מסנן ההדמיות בדף הבית בונה את הרשימה שלו —
       ולכן שני המספרים לא יכולים להיפרד. */
    var allIds = global.PropertyCard
      ? global.PropertyCard.allVisualizedIds(client)
      : Promise.resolve(new Set());

    return Promise.all([pairs, allIds]).then(function (res) {
      var vizRes = res[0], ids = Array.from(res[1] || []);
      if (!ids.length) return null;

      /* הדמיה אחת לכל נכס — החדשה ביותר. בלי זה נכס עם ארבעה סגנונות
         היה תופס את כל הרצועה. */
      var byProperty = new Map();
      ((vizRes && vizRes.data) || []).forEach(function (v) {
        if (!v.property_id || !v.result_url) return;
        if (!byProperty.has(v.property_id)) byProperty.set(v.property_id, v);
      });

      return client
        .from('properties')
        .select('id, title, price, deal_type, city, status')
        .in('id', ids.slice(0, 300))
        .eq('status', 'active')
        .then(function (pRes) {
          var active = (pRes && pRes.data) || [];
          if (pRes.error || !active.length) return null;
          /* ‏exclude הוא הנכס שבעמוד הנוכחי: אין טעם להציג לו את ההדמיה
             של עצמו ברצועת "עוד נכסים עם הדמיה", והיא ממילא מוצגת
             במלואה בסקציה שמעליה.

             הוא יורד מהתצוגה אבל **לא** מהמונה: הכפתור מוביל לתוצאות
             המסוננות, והנכס הזה נמצא שם. מונה שמחסיר אותו היה מבטיח
             מספר אחד ומראה אחר. */
          var items = active
            .filter(function (p) { return p.id !== exclude && byProperty.has(p.id); })
            .map(function (p) { return { property: p, viz: byProperty.get(p.id) }; });
          return { items: items, total: active.length };
        });
    });
  }

  /* ---------- ההשוואה ---------- */
  function compareHtml(item) {
    var v = item.viz;
    var where = TARGET_LABELS[v.target] || 'הנכס';
    return '' +
      '<div class="ai-compare" data-idle data-rtl>' +
        '<img class="ai-before" src="' + esc(v.source_image_url) + '" alt="' + esc(where) + ' כפי שהוא היום" loading="lazy">' +
        '<img class="ai-after" src="' + esc(v.result_url) + '" alt="הדמיה של ' + esc(where) + ' אחרי שיפוץ" loading="lazy">' +
        '<span class="ai-label ai-label-before">לפני</span>' +
        '<span class="ai-label ai-label-after">אחרי · הדמיה</span>' +
        '<input class="ai-range" type="range" min="0" max="100" value="42" step="1" ' +
               'aria-label="חשיפת ההדמיה — הזיזו כדי להשוות בין לפני לאחרי">' +
        '<div class="ai-divider"><span class="ai-handle" aria-hidden="true">↔</span></div>' +
      '</div>' +
      '<p class="ai-compare-caption">' + esc(item.property.title || 'נכס בעפולה') +
        ' · ' + esc(priceLabel(item.property)) + '</p>';
  }

  function thumbHtml(item) {
    return '<a class="ai-thumb" href="property.html?id=' + encodeURIComponent(item.property.id) + '">' +
             '<img src="' + esc(item.viz.result_url) + '" alt="הדמיה של ' + esc(item.property.title || 'נכס') + '" loading="lazy">' +
             '<span>' + esc(priceLabel(item.property)) + '</span>' +
           '</a>';
  }

  function wireCompare(root) {
    var box = root.querySelector('.ai-compare');
    if (!box) return;
    var range = box.querySelector('.ai-range');

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

  function render(container, data) {
    var items = data.items;
    var total = data.total;
    var lead = items[0];
    var strip = items.slice(1, 4);

    container.innerHTML = '' +
      '<section class="ai-band" aria-labelledby="aiBandTitle">' +
        '<div class="ai-band-inner">' +
          '<div>' +
            '<span class="ai-eyebrow">✦ הדמיות AI · בלעדי לשוק הנדל״ן</span>' +
            '<h3 id="aiBandTitle">תראו את הנכס אחרי שיפוץ — לפני שאתם קונים</h3>' +
            '<p>אנחנו מייצרים לנכסים שבפלטפורמה הדמיה של המראה אחרי שיפוץ, מתוך ' +
              'הצילום האמיתי של הנכס. כך אפשר לשקול נכס לפי מה שהוא יכול להיות, ' +
              'ולא רק לפי איך שהוא נראה ביום הצילום.</p>' +
            '<div class="ai-actions">' +
              /* קישור אמיתי ולא כפתור: הכתובת ‎?ai=1‎ ניתנת לשיתוף, לפתיחה
                 בלשונית חדשה ולאינדוקס. ה-JS למטה רק חוסך את הטעינה מחדש
                 כשהחיפוש כבר נמצא באותו עמוד. */
              '<a class="ai-cta" id="aiShowAll" href="index.html?ai=1">' +
                'לכל ' + total + ' הנכסים עם הדמיה ←</a>' +
              '<a class="ai-secondary" href="crm.html">מוכרים ומתווכים: הפיקו הדמיה לנכס שלכם</a>' +
            '</div>' +
            '<p class="ai-note">ההדמיה היא המחשה עיצובית בלבד. היא אינה תוכנית בנייה, ' +
              'אינה מהווה התחייבות של המוכר או של המשרד, ואינה מעידה על היתרים או על ' +
              'זכויות בנייה בנכס.</p>' +
          '</div>' +
          '<div>' +
            compareHtml(lead) +
            (strip.length
              ? '<p class="ai-strip-title">הדמיות נוספות השבוע</p>' +
                '<div class="ai-strip">' + strip.map(thumbHtml).join('') + '</div>'
              : '') +
          '</div>' +
        '</div>' +
      '</section>';

    wireCompare(container);

    /* בדף הבית מנוע החיפוש נמצא כאן, ולכן הקישור מדליק את המסנן במקום
       לטעון את העמוד מחדש. בכל דף אחר (או אם החיפוש עוד לא אותחל) הקישור
       פשוט מנווט — אותה תוצאה, דרך ארוכה יותר. */
    container.querySelector('#aiShowAll').addEventListener('click', function (e) {
      if (!global.ShukSearch || !global.ShukSearch.applyAiFilter) return;
      e.preventDefault();
      global.ShukSearch.applyAiFilter();
    });
  }

  function mount(container, opts) {
    if (!container || !global.supabase || !global.supabase.createClient) return;
    var o = opts || {};
    var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    load(client, o.exclude).then(function (data) {
      /* הרצועה צריכה השוואה אחת להישען עליה — בלי זוג לפני/אחרי אין מה
         להראות, ורצועה שכל תוכנה הוא כפתור היא הבטחה בלי כיסוי. רצועת
         התמונונות שמתחתיה אופציונלית ויורדת מעצמה כשאין מה לשים בה.

         הסף הוא אחד ולא שניים: בדף נכס הנכס הנוכחי מוחרג מהתצוגה, ואם
         נשארה בדיוק השוואה אחת היא עדיין רצועה טובה — ובוודאי כשהכפתור
         שלצדה מצביע על כל הנכסים עם הדמיה. */
      if (!data || !data.items || !data.items.length) return;
      injectCss();
      render(container, data);
    }).catch(function (err) {
      console.warn('רצועת ההדמיות לא נטענה:', err);
    });
  }

  global.AiShowcase = { mount: mount };

  var self = document.currentScript;
  if (self && self.dataset.mount) {
    var target = self.dataset.mount;
    var go = function () { mount(document.querySelector(target)); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(window);
