/* ============================================================================
   כרטיס הפרויקט החדש — שפה אחת לשלוש התצוגות
   ----------------------------------------------------------------------------
   אריח פרויקט מופיע בשלושה מקומות: גלריית "פרויקטים חדשים" בדף הבית, דף
   הפרויקטים המרכזי, ודף החברה היזמית. הקובץ הזה הוא מה שמונע את מה שקרה
   לאריח הנכס לפני שנכתב property-card.js — שלוש תצוגות שהתפצלו לאט, עד
   שאותו פרויקט נראה אחרת בכל אחת מהן.

     ProjectCard.render(p, opts)   // האריח השלם, כאלמנט <a>
     ProjectCard.priceLabel(p)     // "מ־1,450,000 ₪" / "1.45–2.1 מ׳ ₪"
     ProjectCard.stageLabel(p)     // שלב הפרויקט בעברית
     ProjectCard.sortForGallery(l) // מקודמים ראשונים, ואחריהם החדשים

   ‏JS גולמי בלי תלויות, כמו שאר assets/. ה-CSS מוזרק פעם אחת בשימוש
   הראשון, כדי שדף שאינו מציג אריחים לא ישלם עליו.
   ========================================================================== */
(function (global) {
  'use strict';

  var STAGES = {
    planning:           'בתכנון',
    pre_sale:           'בהרשמה מוקדמת',
    under_construction: 'בבנייה',
    ready:              'מוכן לאכלוס',
    completed:          'אוכלס',
  };

  /* המאפיינים שמופיעים כצ׳יפים. אותם מזהים בדיוק כמו ב-_shared/projects.ts
     ובטופס העריכה — מאפיין שנשמר ואין לו כאן תרגום היה נעלם מהאריח. */
  var FEATURES = {
    elevator:'מעלית', parking:'חניה', mamad:'ממ״ד', balcony:'מרפסת שמש',
    storage:'מחסן', garden:'גינה', pool:'בריכה', gym:'חדר כושר',
    lobby:'לובי מפואר', concierge:'קונסיירז׳', accessible:'נגיש',
    green_building:'בנייה ירוקה', smart_home:'בית חכם', solar:'מערכת סולארית',
    playground:'גן משחקים', synagogue_nearby:'בית כנסת בקרבת מקום',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function safeUrl(u) {
    if (!u) return '';
    try {
      var url = new URL(String(u), location.href);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (e) { return ''; }
  }

  /* מחיר של פרויקט הוא טווח, ולכן הוא לא נקרא כמו מחיר של נכס. מיליונים
     מקוצרים כי "1,450,000 ₪ – 2,100,000 ₪" באריח ברוחב 300px נשבר לשתי
     שורות ולא נקרא ממילא. */
  /* יחידה אחת לכל הטווח. ‏"990,000–1.65 מ׳ ₪" נקרא כמו שתי טעויות דפוס:
     העין משווה שני מספרים שאינם באותו סדר גודל. ברגע שקצה אחד חוצה
     מיליון, שני הקצוות נכתבים במיליונים. */
  function priceIn(n, millions) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '';
    if (!millions) return Math.round(v).toLocaleString('he-IL');
    var m = v / 1000000;
    return (m >= 10 ? Math.round(m) : Math.round(m * 100) / 100).toLocaleString('he-IL');
  }

  function priceLabel(p) {
    var lo = Number(p.min_price) || 0, hi = Number(p.max_price) || 0;
    if (!lo && !hi) return 'מחיר בהתאמה אישית';
    var millions = Math.max(lo, hi) >= 1000000;
    var unit = millions ? ' מ׳ ₪' : ' ₪';
    if (lo && hi && hi > lo) return priceIn(lo, millions) + '–' + priceIn(hi, millions) + unit;
    return 'החל מ־' + priceIn(lo || hi, millions) + unit;
  }

  function roomsLabel(p) {
    var lo = Number(p.min_rooms) || 0, hi = Number(p.max_rooms) || 0;
    if (!lo && !hi) return '';
    var trim = function (n) { return String(Number(n)).replace(/\.0$/, ''); };
    if (lo && hi && hi > lo) return trim(lo) + '–' + trim(hi) + ' חד׳';
    return trim(lo || hi) + ' חד׳';
  }

  function stageLabel(p) { return STAGES[p.project_stage] || ''; }

  /* אכלוס: תאריך מדויק כשיש, וטקסט חופשי ("סוף 2027") כשאין. שדה חופשי
     קיים כי בשלב תכנון אין תאריך אמיתי, ותאריך מומצא גרוע ממשפט. */
  function occupancyLabel(p) {
    if (p.occupancy_date) {
      var d = new Date(p.occupancy_date);
      if (!isNaN(d)) return 'אכלוס ' + d.toLocaleDateString('he-IL', { month:'long', year:'numeric' });
    }
    return p.occupancy_text ? 'אכלוס ' + p.occupancy_text : '';
  }

  function featureLabels(p, max) {
    return (p.features || []).map(function (f) { return FEATURES[f]; })
      .filter(Boolean).slice(0, max || 3);
  }

  /* גלריית דף הבית: שני המקומות הראשונים שמורים לפרויקטים מקודמים — זה
     מה שנמכר ב-50 ₪ לשבוע. השאר לפי סדר פרסום יורד. הקידום כבר חושב מול
     השעון ב-projects_public, ולכן כאן זה דגל ותו לא. */
  function sortForGallery(list) {
    var promoted = [], rest = [];
    (list || []).forEach(function (p) { (p.is_promoted ? promoted : rest).push(p); });
    var byDate = function (a, b) {
      return new Date(b.published_at || 0) - new Date(a.published_at || 0);
    };
    return promoted.sort(byDate).concat(rest.sort(byDate));
  }

  var CSS = [
    '.pj-card{position:relative;display:flex;flex-direction:column;background:var(--surface,#fff);',
      'border:1px solid var(--line,#e3e8f4);overflow:hidden;text-decoration:none;color:inherit;',
      'transition:border-color .15s ease,transform .15s ease,box-shadow .15s ease}',
    '.pj-card:hover{border-color:var(--teal,#0e2a6b);transform:translateY(-3px);',
      'box-shadow:var(--shadow,0 10px 30px -24px rgba(14,42,107,.5))}',
    '.pj-card .pj-cover{position:relative;aspect-ratio:4/3;background:var(--teal-tint,#eaf0fb) center/cover no-repeat}',
    '.pj-card .pj-cover::after{content:"";position:absolute;inset:auto 0 0 0;height:52%;',
      'background:linear-gradient(to top,rgba(13,27,61,.72),transparent)}',
    '.pj-card .pj-logo{position:absolute;inset-inline-end:10px;top:10px;width:44px;height:44px;',
      'background:#fff center/contain no-repeat;border:1px solid var(--line,#e3e8f4);z-index:2}',
    '.pj-card .pj-flags{position:absolute;inset-inline-start:10px;top:10px;display:flex;',
      'flex-direction:column;gap:5px;align-items:flex-start;z-index:2}',
    '.pj-card .pj-flag{font-size:.66rem;font-weight:800;padding:4px 9px;color:#fff;background:var(--teal,#0e2a6b);line-height:1.3}',
    '.pj-card .pj-flag.promoted{background:var(--brass,#c9a227);color:#3b2f05}',
    '.pj-card .pj-flag.promoted::before{content:"◆ ";font-size:.85em}',
    '.pj-card .pj-cover-foot{position:absolute;inset-inline:12px;bottom:10px;z-index:2;color:#fff}',
    '.pj-card .pj-cover-foot b{display:block;font-family:"Frank Ruhl Libre",serif;font-size:1.05rem;',
      'font-weight:700;line-height:1.25;text-shadow:0 1px 6px rgba(13,27,61,.5);',
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.pj-card .pj-cover-foot span{font-size:.76rem;opacity:.92}',
    '.pj-card .pj-body{padding:12px 13px 14px;display:flex;flex-direction:column;gap:8px;flex:1}',
    '.pj-card .pj-price{font-size:1rem;font-weight:800;color:var(--ink,#0d1b3d);letter-spacing:-.01em}',
    '.pj-card .pj-meta{display:flex;flex-wrap:wrap;gap:5px 10px;font-size:.76rem;color:var(--ink-soft,#4a5578)}',
    '.pj-card .pj-chips{display:flex;flex-wrap:wrap;gap:5px}',
    '.pj-card .pj-chip{font-size:.68rem;font-weight:700;color:var(--ink-soft,#4a5578);',
      'background:var(--field,#eef2fb);padding:3px 8px;line-height:1.4}',
    '.pj-card .pj-dev{margin-top:auto;padding-top:9px;border-top:1px solid var(--hair,#eef1f8);',
      'display:flex;align-items:center;gap:7px;font-size:.74rem;color:var(--ink-muted,#6b7796)}',
    '.pj-card .pj-dev img{width:20px;height:20px;object-fit:contain;flex:none}',
    '.pj-card .pj-media{display:flex;gap:6px;align-items:center;color:var(--ink-muted,#6b7796)}',
    '.pj-card .pj-media svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.9}',
  ].join('');

  var injected = false;
  function ensureCss() {
    if (injected) return;
    injected = true;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  var ICON_VIDEO = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 11 6-3.2v8.4l-6-3.2z"/></svg>';
  var ICON_CUBE = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>';

  function render(p, opts) {
    ensureCss();
    opts = opts || {};
    var card = document.createElement('a');
    card.className = 'pj-card';
    card.href = 'project.html?slug=' + encodeURIComponent(p.slug || p.id);

    var cover = safeUrl(p.cover_url);
    var logo = safeUrl(p.logo_url || p.developer_logo_url);
    var where = [p.city, p.address || p.street].filter(Boolean).join(' · ');

    var flags = [];
    if (p.is_promoted) flags.push('<span class="pj-flag promoted">מקודם</span>');
    var stage = stageLabel(p);
    if (stage) flags.push('<span class="pj-flag">' + esc(stage) + '</span>');

    var meta = [roomsLabel(p), occupancyLabel(p)].filter(Boolean);
    if (p.total_units) meta.push(p.total_units + ' יח״ד');

    var mediaIcons = '';
    if (safeUrl(p.video_url)) mediaIcons += ICON_VIDEO;
    if (safeUrl(p.tour_3d_url)) mediaIcons += ICON_CUBE;

    card.innerHTML =
      '<span class="pj-cover"' + (cover ? ' style="background-image:url(\'' + esc(cover) + '\')"' : '') + '>' +
        (flags.length ? '<span class="pj-flags">' + flags.join('') + '</span>' : '') +
        (logo ? '<span class="pj-logo" style="background-image:url(\'' + esc(logo) + '\')"></span>' : '') +
        '<span class="pj-cover-foot">' +
          '<b>' + esc(p.name || '') + '</b>' +
          (where ? '<span>' + esc(where) + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="pj-body">' +
        '<span class="pj-price">' + esc(priceLabel(p)) + '</span>' +
        (meta.length ? '<span class="pj-meta">' + meta.map(function (m) {
          return '<span>' + esc(m) + '</span>';
        }).join('') + '</span>' : '') +
        (featureLabels(p, 3).length
          ? '<span class="pj-chips">' + featureLabels(p, 3).map(function (f) {
              return '<span class="pj-chip">' + esc(f) + '</span>';
            }).join('') + '</span>'
          : '') +
        (opts.hideDeveloper ? '' :
          '<span class="pj-dev">' +
            (safeUrl(p.developer_logo_url) ? '<img src="' + esc(safeUrl(p.developer_logo_url)) + '" alt="" loading="lazy">' : '') +
            '<span>' + esc(p.developer_name || '') + '</span>' +
            (mediaIcons ? '<span class="pj-media" style="margin-inline-start:auto">' + mediaIcons + '</span>' : '') +
          '</span>') +
      '</span>';

    return card;
  }

  global.ProjectCard = {
    render: render,
    priceLabel: priceLabel,
    roomsLabel: roomsLabel,
    stageLabel: stageLabel,
    occupancyLabel: occupancyLabel,
    featureLabels: featureLabels,
    sortForGallery: sortForGallery,
    STAGES: STAGES,
    FEATURES: FEATURES,
    escapeHtml: esc,
    safeUrl: safeUrl,
  };
})(window);
