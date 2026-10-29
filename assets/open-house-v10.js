/* ---------------------------------------------------------------------------
 * ‏/open-house בגרסת v10 (‏PR 1010, חלק 7 §A, וחלק 5 §4) - רק מאחורי הדגל
 * (‏html.beta-hero, ‏?beta=1 / localStorage.sk_beta_hero).
 *
 * בלי הדגל הקובץ יוצא מיד, והדף הוא בדיוק הדף של היום. עם הדגל הוא בונה מעל
 * אותו HTML ואותם נתונים (‏window.__fairState מ-initFair, או האירוע fair:loaded):
 *   - ראש: "דירות ב<שוק>, בלי עמלת תיווך", פסקה על כלל היריד (מועד הפנייה
 *     קובע), שני כפתורים ושורת גבריאלה עם קישור להחלקה על דירות היריד
 *   - בלי מספרים שמשתנים כל יום: בלי שורת הנתונים, בלי המחשבון, בלי "חוסכים"
 *   - "הדירה הבאה בדרך ליריד" כשיש 1-2 דירות; מפה בכפתור רק מ-4 דירות
 *   - בלוק ליועצי הנדל״ן, וחמש שאלות שה-FAQPage שבראש נבנה מאותו מערך
 *   - טופס ההרשמה v2 (‏assets/fair-signup.js) רק כש-FairSignup.V2 דלוק;
 *     עד אז טופס האימייל הקיים נשאר כמו שהוא
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  var H = document.documentElement;
  if (!H.classList.contains('beta-hero')) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var shukTrack = function (n, p) { if (window.shukTrack) window.shukTrack(n, p || {}); };
  var params = new URLSearchParams(location.search);

  var FAQ = [
    ['למה אין עמלת תיווך?', 'יועץ הנדל״ן שמכניס דירה ליריד מוותר על עמלת התיווך מהקונים, בתמורה לחשיפה מוגברת. את השירות המלא, מהביקור ועד החתימה, ממשיכים לקבל.'],
    ['עד מתי זה בתוקף?', 'לכל דירה ביריד יש תאריך סיום משלה, שמופיע על הכרטיס. מה שקובע הוא מועד הפנייה: פונים על הדירה לפני שהשעון נעצר, ולא משלמים עמלת תיווך, גם אם ההסכם ייחתם מאוחר יותר.'],
    ['איך מתאמים ביקור?', 'לוחצים על "יצירת קשר עם יועץ הנדל״ן" בכרטיס הדירה, ומתאמים ישירות.'],
    ['יש התחייבות כשנרשמים לעדכונים?', 'לא. ההרשמה רק שולחת לכם הודעה כשדירה מתאימה נכנסת ליריד. אפשר להסיר בלחיצה.'],
    ['עובדים כיועצי נדל״ן? איך מצטרפים?', 'בלוח הבקרה, בכרטיס הנכס, בוחרים "הכנסה ליריד" ותאריך סיום. הדירה מופיעה כאן מיד.']
  ];
  var STEPS = [
    ['יועצי נדל״ן מכניסים דירה', 'כל דירה ביריד מגיעה מיועץ נדל״ן מאומת באזור, עם תאריך סיום ברור.'],
    ['אתם מתאמים ביקור', 'יוצרים קשר ישירות מהדף, ומתאמים ביקור כמו בכל דירה אחרת.'],
    ['קונים בלי עמלת תיווך', 'פונים על הדירה לפני שהשעון נעצר, ולא משלמים עמלת תיווך, גם אם ההסכם נחתם מאוחר יותר.']
  ];

  var css = document.createElement('style');
  css.textContent =
    'html.beta-hero #fairStats,html.beta-hero #fairCalc,html.beta-hero #fairNotify,html.beta-hero #fairMapSection:not(.ohv-on){display:none !important}' +
    'html.beta-hero .oh-head h1{font-family:Heebo,system-ui,sans-serif;font-size:22px;font-weight:800;line-height:1.25}' +
    '@media(min-width:760px){html.beta-hero .oh-head h1{font-size:32px}}' +
    'html.beta-hero .oh-head h1>span{display:inline}' +
    '.ohv-lead{margin:0;font-size:15px;line-height:1.6;color:rgba(255,255,255,.92);max-width:62ch}' +
    '.ohv-pill{display:inline-block;align-self:flex-start;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font-size:13px;font-weight:700}' +
    '.ohv-ctas{display:flex;flex-wrap:wrap;gap:10px}' +
    '.ohv-gold,.ohv-out,.ohv-navy{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:12px;font:800 15.5px Heebo,system-ui,sans-serif;text-decoration:none;cursor:pointer}' +
    '.ohv-gold{background:#c9a227;color:#0d1b3d;border:0}.ohv-out{background:transparent;color:#fff;border:1.5px solid #fff}' +
    '.ohv-navy{background:#0e2a6b;color:#fff;border:0}' +
    '.ohv-gold:focus-visible,.ohv-out:focus-visible,.ohv-navy:focus-visible,.ohv-gab a:focus-visible{outline:3px solid #c9a227;outline-offset:2px}' +
    '.ohv-gab{display:flex;align-items:center;gap:10px;margin:14px auto 0;max-width:1100px;padding:10px 14px;border-radius:14px;background:#f6f1e7;color:#0e2a6b;font-size:15px;line-height:1.5}' +
    '.ohv-gab img{width:40px;height:40px;border-radius:50%;border:2px solid #c9a227;object-fit:cover;object-position:top;flex:none}' +
    '.ohv-gab a{color:#0e2a6b;font-weight:800;white-space:nowrap}' +
    '.ohv-steps{list-style:none;margin:0;padding:0;display:grid;gap:12px}@media(min-width:760px){.ohv-steps{grid-template-columns:repeat(3,1fr)}}' +
    '.ohv-steps li{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid #e3e8f2;border-radius:14px;background:#fff}' +
    '.ohv-steps i{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:#0e2a6b;color:#fff;font-style:normal;font-weight:800;flex:none}' +
    '.ohv-steps b{display:block;font-size:16px;color:#0e2a6b}.ohv-steps span{display:block;font-size:14px;line-height:1.55;color:#4a5060;margin-top:2px}' +
    '.ohv-next{margin:14px 0 0;padding:18px;border:2px dashed #c9a227;border-radius:16px;background:#f6f1e7;text-align:center}' +
    '.ohv-next h3{margin:0 0 6px;font:800 18px Heebo,system-ui,sans-serif;color:#0e2a6b}.ohv-next p{margin:0 0 12px;color:#4a5060;line-height:1.55}' +
    'html.beta-hero .ohv-mapbar{display:flex;justify-content:flex-start;margin-bottom:10px}' +
    '.ohv-agents{margin:24px auto;max-width:1100px;padding:22px;border-radius:18px;background:linear-gradient(160deg,#0e2a6b,#0d1b3d);color:#fff}' +
    'html.beta-hero .ohv-agents h2{margin:0 0 8px;font:800 22px Heebo,system-ui,sans-serif;color:#fff}@media(min-width:760px){html.beta-hero .ohv-agents h2{font-size:32px}}' +
    '.ohv-agents p{margin:0 0 10px;line-height:1.6;color:rgba(255,255,255,.92)}' +
    '.ohv-agents ul{margin:0 0 14px;padding:0;list-style:none;display:grid;gap:6px}.ohv-agents li::before{content:"✓ ";color:#e5c76a;font-weight:800}' +
    'html.beta-hero #fairFaqTitle,html.beta-hero #fairEmpty h2{font-family:Heebo,system-ui,sans-serif;font-size:22px;font-weight:800}' +
    '@media(min-width:760px){html.beta-hero #fairFaqTitle,html.beta-hero #fairEmpty h2{font-size:32px}}';
  document.head.appendChild(css);

  /* ‏FAQPage נבנה מאותו מערך של השאלות הגלויות (§A.5) - בלי שני נוסחים שנפרדים */
  var ld = [].filter.call(document.querySelectorAll('script[type="application/ld+json"]'), function (s) { return /FAQPage/.test(s.textContent); })[0];
  if (ld) ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQ.map(function (q) { return { '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1] } }; }) });

  function market() { return (window.CityContext && CityContext.label && CityContext.label()) || 'עפולה והעמק'; }
  function places() {
    var m = (window.CityContext && CityContext.market && CityContext.market()) || (window.ShukMarkets && ShukMarkets.defaultMarket && ShukMarkets.defaultMarket());
    return (m && m.places) || ['עפולה'];
  }
  function swipeHref() { return '/swipe?deal=sale&fair=1' + (params.get('beta') === '1' ? '&beta=1' : ''); }

  /* ---------- הראש, השלבים והבלוקים הקבועים ---------- */
  function head(live) {
    var kick = document.querySelector('.oh-head-kicker');
    if (kick) kick.textContent = 'יריד הבתים הפתוחים';
    var h1 = document.querySelector('.oh-head h1');
    if (h1) h1.innerHTML = 'דירות ב<span data-market-label>' + esc(market()) + '</span>, בלי עמלת תיווך';
    var body = document.querySelector('.oh-head-body');
    if (body && !body.querySelector('.ohv-lead')) {
      body.insertAdjacentHTML('afterbegin',
        '<p class="ohv-lead">יועצי נדל״ן מהאזור מכניסים דירות ליריד לתקופה מוגבלת. פונים על דירה בזמן שהיא ביריד, ולא משלמים עמלת תיווך, גם אם ההסכם נחתם אחר כך. השירות המלא של יועץ הנדל״ן נשאר.</p>' +
        '<span class="ohv-pill">לכל דירה ביריד יש תאריך סיום משלה</span>' +
        '<div class="ohv-ctas"><a class="ohv-gold" id="ohvGo" href="#fairProps"></a><a class="ohv-out" href="#fairSignup" id="ohvNotify">עדכנו אותי</a></div>');
    }
    var go = $('ohvGo');
    if (go) { go.textContent = live ? 'לדירות שביריד' : 'מה זה היריד?'; go.setAttribute('href', live ? '#fairProps' : '#ohvSteps'); }
    var box = document.querySelector('.oh-head');
    if (box && !$('ohvGab')) {
      box.insertAdjacentHTML('beforeend', '<div class="wrap"><p class="ohv-gab" id="ohvGab"><img src="/assets/gabriela-avatar.webp" alt="" width="40" height="40" onerror="this.style.visibility=\'hidden\'">' +
        '<span>גבריאלה: כאן מרוכזות הדירות שיועצי הנדל״ן באזור הכניסו ליריד. אפשר לעבור עליהן, או להשאיר פרטים ואעדכן אתכם כשנכנסת דירה חדשה. ' +
        (live ? '<a href="' + esc(swipeHref()) + '" data-ohv-swipe>להחליק על דירות היריד ←</a>' : '') + '</span></p></div>');
    }
  }
  function steps() {
    var ol = document.querySelector('.oh-steps');
    if (!ol || $('ohvSteps')) return;
    ol.insertAdjacentHTML('afterend', '<ol class="ohv-steps" id="ohvSteps">' + STEPS.map(function (s, i) {
      return '<li><i aria-hidden="true">' + (i + 1) + '</i><div><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div></li>';
    }).join('') + '</ol>');
    ol.hidden = true;
    var t = $('fairHowTitle'); if (t) t.classList.remove('sr-only');
  }
  function faq() {
    var sec = $('fairFaq');
    if (!sec) return;
    sec.querySelector('.oh-faq-list').innerHTML = FAQ.map(function (q, i) {
      return '<details' + (i ? '' : ' open') + '><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>';
    }).join('');
    $('fairFaqTitle').textContent = 'שאלות על היריד';
    sec.hidden = false;
  }
  function agents() {
    var sec = $('fairFaq');
    if (!sec || $('ohvAgents')) return;
    sec.insertAdjacentHTML('beforebegin', '<section class="section wrap" aria-labelledby="ohvAgentsT"><div class="ohv-agents" id="ohvAgents">' +
      '<h2 id="ohvAgentsT">רוצים להכניס דירה ליריד?</h2>' +
      '<p>דירה ביריד מקבלת חשיפה נפרדת בדף הזה, בהחלקה ובעדכונים לנרשמים. אתם בוחרים את הדירה ואת תאריך הסיום.</p>' +
      '<ul><li>תג "ללא עמלת תיווך" בכל מקום שהדירה מופיעה</li><li>פניות ישירות מקונים שנרשמו ליריד</li><li>הצטרפות מתוך לוח הבקרה, בשתי לחיצות</li></ul>' +
      '<div class="ohv-ctas"><a class="ohv-gold" href="/crm?goto=accProperties" data-ohv-agent="add">להכנסת דירה ליריד</a>' +
      '<a class="ohv-out" href="/agency-signup" data-ohv-agent="join">הצטרפות כיועצי נדל״ן</a></div></div></section>');
  }
  /* ‏טופס v2 רק כשהשרת מוכן (‏FairSignup.V2); עד אז טופס האימייל הקיים */
  function signup() {
    if (!window.FairSignup || !FairSignup.V2) return;
    var box = $('fairSignupBox');
    if (!box || box.dataset.v2) return;
    box.dataset.v2 = '1';
    box.innerHTML = FairSignup.html({ where: 'page', places: places(), deal: 'sale', city: places()[0], noTitle: true });
    FairSignup.bind(box, { where: 'page' });
    var t = $('fairSignupTitle'); if (t) t.textContent = 'תדעו ראשונים כשדירה מתאימה נכנסת';
    var opened = false;
    box.addEventListener('focusin', function () { if (!opened) { opened = true; shukTrack('fair_signup_open', { via: 'page' }); } });
  }

  /* ---------- מה שתלוי בנתונים ---------- */
  function withData(list) {
    var n = list.length, live = n > 0;
    head(live);
    shukTrack('fair_view', { state: live ? 'live' : 'empty', n: n });
    if (!live) {
      var e = $('fairEmpty');
      if (e) {
        e.querySelector('h2').textContent = 'כרגע אין דירות ביריד';
        e.querySelector('p').textContent = 'יועצי נדל״ן מהאזור מכניסים דירות ליריד לזמן מוגבל, וכל דירה מקבלת תאריך סיום משלה. השאירו פרטים, ונעדכן אתכם ראשונים כשדירה נכנסת.';
        if (!e.querySelector('.ohv-all')) e.insertAdjacentHTML('beforeend', '<p class="ohv-all"><a href="/#allProps">לכל הדירות ב' + esc(market()) + ' ←</a></p>');
      }
    }
    /* "הדירה הבאה בדרך ליריד": דירה אחת לבד נראית נטושה */
    if (n >= 1 && n <= 2 && !$('ohvNext')) {
      $('fairProps').insertAdjacentHTML('afterend', '<section class="wrap"><div class="ohv-next" id="ohvNext"><h3>הדירה הבאה בדרך ליריד</h3>' +
        '<p>יועצי נדל״ן מהאזור מכניסים דירות כל הזמן. השאירו פרטים, ונשלח לכם הודעה ברגע שדירה חדשה נכנסת.</p>' +
        '<a class="ohv-navy" href="#fairSignup">עדכנו אותי ראשונים</a></div></section>');
    }
    /* מפה רק מ-4 דירות, ובכפתור; עם דירה אחת מפה לא מוסיפה דבר */
    var ms = $('fairMapSection');
    if (ms) {
      // ‏initFair מדליק את המקטע אחרי האירוע - ולכן הסתרה ב-CSS עד הכפתור (‏.ohv-on)
      if (n >= 4 && !$('ohvMapBtn')) {
        $('fairProps').insertAdjacentHTML('beforebegin', '<div class="wrap ohv-mapbar"><button type="button" class="ohv-navy" id="ohvMapBtn" aria-expanded="false" aria-controls="fairMapSection">מפה</button></div>');
        $('ohvMapBtn').addEventListener('click', function () {
          var on = ms.classList.toggle('ohv-on'); this.setAttribute('aria-expanded', String(on));
          if (on) { ms.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.dispatchEvent(new Event('resize')); }
        });
      }
    }
    faq();
  }

  /* ‏A2-5 (תומר 20:03): "רשימה" בהחלקה על היריד מגיעה לכאן עם ‏deal ו-rooms. התגיות של המדף
     נדלקות רק אם הן קיימות במלאי (‏selectTag מחזירה false אחרת) - בלי מדף ריק. המדף מתמלא
     אחרי fair:loaded באותו tick (‏initFair ב-open-house.html), ולכן setTimeout */
  function preselect() {
    var deal = params.get('deal'), rooms = Number(params.get('rooms'));
    if ((deal !== 'sale' && deal !== 'rent') && !rooms) return;
    setTimeout(function () {
      if (typeof fairShelf === 'undefined' || !fairShelf.selectTag) return;
      var on = false;
      if (deal === 'sale' || deal === 'rent') on = fairShelf.selectTag(deal) || on;
      if (rooms >= 1 && rooms <= 9) {
        for (var r = rooms; r <= rooms + 0.5; r += 0.5) if (fairShelf.selectTag('rooms:' + r, on)) { on = true; break; }
      }
    }, 0);
  }

  function start() {
    steps();
    agents();
    signup();
    if (window.__fairState) { withData(window.__fairState.list || []); preselect(); }
    else document.addEventListener('fair:loaded', function (e) { withData((e.detail && e.detail.list) || []); preselect(); }, { once: true });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-ohv-agent]');
    if (a) shukTrack('fair_agent_cta', { cta: a.dataset.ohvAgent });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
