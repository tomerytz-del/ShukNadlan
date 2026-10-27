/* ==========================================================================
   חלונית גבריאלה הצפה — "צ'אט" באתר שממשיך בוואטסאפ
   --------------------------------------------------------------------------
   אין כאן צ'אט: כל כפתור הוא קישור wa.me לבוט הציבורי הקיים (whatsapp-webhook
   / public-agent.ts) עם הודעה מוקלדת מראש. החוויה של חלון שיחה באתר, והקשר
   נשאר בוואטסאפ — שם גבריאלה יכולה לחזור לגולש/ת עם התאמות.

   נטען כך (‏defer, בסוף ה-body):
     <script defer src="/assets/gabriela-widget.js" data-page="home"></script>
   ‏data-page הוא תג המקור שנכנס להודעה ("[site:home]"). הערכים חייבים להופיע
   ב-SITE_TAGS ב-whatsapp-webhook/index.ts — ‏scripts/check_bot_entry.py מצליב.

   מה נשבר בשקט, ולכן כתוב כאן:
   * **המספר והקישור רק דרך ShukBot** (‏bot-link.js) — המתג ENABLED וקוד
     המודעה ("(מודעה google:x)") עוברים משם. כשהעוזרת כבויה אין חלונית.
   * **כל קישור נושא data-bot**, אחרת events.js סופר אותו כ-contact_agent.
     ‏data-bot-entry = ‏widget_<בחירה> — כך contact_bot אומר איזה כפתור נלחץ.
   * **בדף נכס ההודעה נושאת "(מזהה: <uuid>)"**, ו-public-agent.ts טוען את הנכס
     לפי המזהה לפני שהמודל עונה (‏askedPropertyOf).
   * **החלונית נפתחת רק בלחיצה.** בעבר היא נפתחה לבד, והסתירה בדפי נכס
     ותוצאות את מה שהגולש/ת קרא/ה. במקומה עולה בועית קטנה ליד הכפתור ל-4
     שניות (‏showTip), פעם אחת בביקור. **ולעולם לא מעל כרטיס הקשר**
     (‏CONTACT): חלונית פתוחה שכרטיס הקשר נכנס מתחתיה נסגרת, ובועית שהייתה
     נוחתת עליו לא עולה.
   * **הבועה זזה מפני מה שכבר יושב בפינה** — כפתור הנגישות בדף הבית, בועת
     הסוכן/ת והסרגל התחתון בדפי נכס/סוכן/משרד — **ונעלמת מעל טופס** בתחתית
     המסך (‏AVOID) ובזמן הקלדה בשדה בדף, כדי לא להסתיר את מה שהגולש/ת ממלא/ת.
   ‏docs/gabriela-widget.md.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__gabWidget) return;
  window.__gabWidget = true;

  var script = document.currentScript;
  var PAGE = (script && script.getAttribute('data-page')) || 'page';
  var AUTO_KEY = 'gabWidgetAuto';   // הבועית כבר הוצגה (או החלונית נפתחה) בביקור הזה
  var AUTO_DELAY = 8000;
  var AUTO_SCROLL = 0.4;
  var TIP_MS = 4000;
  var TIP_TEXT = 'היי, אני גבריאלה 👋 צריכים עזרה?';
  var AVATAR = '/assets/gabriela-avatar.webp';
  /* טפסים שהבועה לא יושבת עליהם כשהם בתחתית המסך */
  var AVOID = '#ownerWizardForm, #buyerWizardForm, #inquiryForm, #ownerLeadForm, #mleadForm, #ssaForm, #vizCta';
  /* כרטיסי הקשר עם הסוכן/ת או המשרד - החלונית והבועית לא יושבות עליהם */
  var CONTACT = '.agent-card, #contactCard, #stickyBar, #waBubble';

  /* כפתורי הבחירה המהירה. ההודעה היא מה שגבריאלה מקבלת - כל אחת מהן היא
     דבר שהבוט עושה (search_properties, owner_lead, open_house_signup). */
  var CHOICES = [
    // התוויות ניטרליות (משימה 1 בבריף); ה-text שנשלח לבוט וה-entry לא השתנו
    { key: 'buy',   label: 'לקנות נכס',             text: 'היי גבריאלה, אני מחפש/ת דירה לקנייה' },
    { key: 'rent',  label: 'לשכור נכס',             text: 'היי גבריאלה, אני מחפש/ת דירה להשכרה' },
    { key: 'owner', label: 'למכור נכס',             text: 'היי גבריאלה, אני רוצה למכור או להשכיר נכס' },
    { key: 'fair',  label: 'יריד הבתים הפתוחים',     text: 'היי גבריאלה, אשמח לשמוע על יריד הבתים הפתוחים ללא עמלת תיווך' }
  ];
  var FREE_DEFAULT = 'היי גבריאלה, אשמח לעזרה';

  var ctx = window.gabWidgetContext || null;   // ‏{ property: {...} } מ-property.js

  function storageGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* בלי אחסון - רק לדף הזה */ } }

  /* תג המקור בסוף ההודעה. ‏siteEntryOf ב-index.ts קורא אותו ומוריד אותו לפני
     שגבריאלה רואה את הטקסט. */
  function taggedHello(text) {
    return String(text || FREE_DEFAULT).trim() + ' [site:' + PAGE + ']';
  }

  function propertyLine(p) {
    var parts = [];
    if (p.title) parts.push(p.title);
    if (p.hood && (!p.title || p.title.indexOf(p.hood) < 0)) parts.push(p.hood);
    if (p.rooms && (!p.title || p.title.indexOf('חדר') < 0)) parts.push(p.rooms + ' חדרים');
    if (p.price) parts.push(p.price);
    return 'היי גבריאלה, אשמח לפרטים על הנכס: ' + parts.join(', ') + ' (מזהה: ' + p.id + ')';
  }

  function waHref(text) {
    return window.ShukBot.link(taggedHello(text));
  }

  /* ---------- סגנון ----------
     מוזרק לסוף ה-head, אחרי design-system.css, וכל כלל נושא #gabW — כדי
     שכללי הכפתורים והפינות של design-system לא יגברו עליו. */
  var CSS = [
    '#gabW{--gw-navy:#0e2a6b;--gw-ink:#1d2a44;--gw-muted:#4a5872;--gw-wa:#157a3c;--gw-wa-h:#106231;--gw-line:#e3e8f2;',
    '  --gw-bottom:calc(16px + env(safe-area-inset-bottom,0px));--gw-left:16px;font-family:inherit;direction:rtl}',
    'body:has(.a11y-fab) #gabW{--gw-bottom:calc(78px + env(safe-area-inset-bottom,0px));--gw-left:18px}',
    '@media(min-width:760px){body:has(#waBubble:not([hidden])) #gabW{--gw-bottom:calc(88px + env(safe-area-inset-bottom,0px))}}',
    'body.sticky-on #gabW{--gw-bottom:calc(90px + env(safe-area-inset-bottom,0px))}',
    '@media(max-width:600px){body:has(.a11y-fab) #gabW{--gw-bottom:calc(66px + env(safe-area-inset-bottom,0px));--gw-left:12px}',
    '  #gabW{--gw-left:12px}}',
    'body.map-is-open #gabW,body:has(#ssDock:not([hidden])) #gabW,body:has(.shuk-pwa.is-open) #gabW{display:none}',

    '#gabW .gw-bubble{position:fixed;left:var(--gw-left);bottom:var(--gw-bottom);z-index:205;width:60px;height:60px;padding:0;',
    '  border-radius:50%;border:3px solid #fff;background:#fff1c9;cursor:pointer;box-shadow:0 10px 26px rgba(14,42,107,.35);',
    '  transition:transform .2s ease,opacity .2s ease,visibility .2s}',
    '#gabW .gw-bubble img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}',
    '#gabW .gw-bubble:hover{transform:translateY(-2px)}',
    '#gabW .gw-bubble:focus-visible,#gabW .gw-panel :focus-visible{outline:3px solid #f2b705;outline-offset:2px}',
    '#gabW .gw-dot{position:absolute;bottom:1px;right:1px;width:15px;height:15px;border-radius:50%;background:#25d366;border:2px solid #fff}',
    '#gabW.is-away .gw-bubble,#gabW.is-hidden .gw-bubble{opacity:0;visibility:hidden;transform:translateY(12px)}',
    '#gabW.is-open .gw-bubble{opacity:1;visibility:visible;transform:none}',

    '#gabW .gw-tip{position:fixed;left:calc(var(--gw-left) + 70px);bottom:calc(var(--gw-bottom) + 10px);z-index:205;',
    '  max-width:calc(100vw - var(--gw-left) - 90px);padding:9px 14px;border:0;border-radius:14px 14px 14px 4px;background:#fff;',
    '  color:var(--gw-ink);font:inherit;font-size:14.5px;font-weight:700;line-height:1.35;text-align:right;cursor:pointer;',
    '  box-shadow:0 8px 22px rgba(14,42,107,.25);opacity:0;visibility:hidden;transform:translateX(-8px);',
    '  transition:opacity .25s ease,transform .25s ease,visibility .25s}',
    '#gabW.is-tip .gw-tip{opacity:1;visibility:visible;transform:none}',
    '#gabW.is-open .gw-tip,#gabW.is-away .gw-tip,#gabW.is-hidden .gw-tip{opacity:0;visibility:hidden}',

    '#gabW .gw-panel{position:fixed;left:var(--gw-left);bottom:calc(var(--gw-bottom) + 72px);z-index:206;width:340px;',
    '  max-width:calc(100vw - 24px);max-height:calc(100vh - var(--gw-bottom) - 96px);overflow:auto;background:#fff;color:var(--gw-ink);',
    '  border-radius:18px;border:1px solid var(--gw-line);box-shadow:0 24px 50px -16px rgba(14,42,107,.5),0 4px 14px rgba(14,42,107,.12);',
    '  text-align:right;opacity:0;visibility:hidden;transform:translateY(14px);transition:opacity .25s ease,transform .25s ease,visibility .25s}',
    '#gabW.is-open .gw-panel{opacity:1;visibility:visible;transform:none}',
    '@media(max-width:600px){#gabW .gw-panel{left:12px;right:12px;width:auto;max-width:none}}',
    '#gabW .gw-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--gw-navy);color:#fff;border-radius:17px 17px 0 0}',
    '#gabW .gw-head img{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#fff1c9;flex:none}',
    '#gabW .gw-head b{display:block;font-size:16px;line-height:1.2}',
    '#gabW .gw-status{display:flex;align-items:center;gap:6px;font-size:13px;color:#d9e2f5}',
    '#gabW .gw-status i{width:8px;height:8px;border-radius:50%;background:#25d366;display:inline-block}',
    '#gabW .gw-x{margin-inline-start:auto;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:#fff;',
    '  font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}',
    '#gabW .gw-x:hover{background:rgba(255,255,255,.14)}',
    '#gabW .gw-body{padding:14px}',
    '#gabW .gw-msg{background:#f1f4f9;border-radius:4px 14px 14px 14px;padding:10px 12px;font-size:15px;line-height:1.5;margin:0 0 12px}',
    '#gabW .gw-choices{display:grid;gap:8px;margin:0 0 12px;padding:0;list-style:none}',
    '#gabW a.gw-choice{display:block;padding:10px 12px;border:1.5px solid var(--gw-navy);border-radius:999px;color:var(--gw-navy);',
    '  background:#fff;font-weight:700;font-size:15px;text-decoration:none;text-align:center;line-height:1.3}',
    '#gabW a.gw-choice:hover{background:var(--gw-navy);color:#fff}',
    '#gabW a.gw-choice.is-prop{background:var(--gw-navy);color:#fff}',
    '#gabW .gw-free{display:flex;flex-direction:column;gap:8px}',
    '#gabW .gw-free input{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border:1.5px solid #c9d2e3;border-radius:10px;',
    '  font:inherit;font-size:16px;color:var(--gw-ink);background:#fff}',
    '#gabW a.gw-go{display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;border-radius:999px;background:var(--gw-wa);',
    '  color:#fff;font-weight:700;font-size:16px;text-decoration:none}',
    '#gabW a.gw-go:hover{background:var(--gw-wa-h);color:#fff}',
    '#gabW a.gw-go svg{width:20px;height:20px;flex:none}',
    '#gabW .gw-note{margin:10px 0 0;font-size:12.5px;color:var(--gw-muted);text-align:center}',
    '@media(prefers-reduced-motion:reduce){#gabW .gw-bubble,#gabW .gw-panel,#gabW .gw-tip{transition:none}}',
    /* v10 (html.beta-hero בלבד) */
    'html.beta-hero body:has(.a11y-fab) #gabW{--gw-bottom:calc(16px + env(safe-area-inset-bottom,0px));--gw-left:16px}',
    '@media(max-width:600px){html.beta-hero body:has(.a11y-fab) #gabW{--gw-bottom:calc(12px + env(safe-area-inset-bottom,0px));--gw-left:12px}}',
    'html.beta-hero body.sticky-on #gabW{--gw-bottom:calc(90px + env(safe-area-inset-bottom,0px))}',
    '#gabW .gw-pill,#gabW .gw-min{display:none}',
    '@media(min-width:1024px){',
    '  #gabW.is-v10:not(.is-min) .gw-bubble{width:auto;height:64px;padding:0 18px 0 6px;border-radius:999px;border:2.5px solid #1a8a4a;',
    '    background:#fff;display:flex;align-items:center;gap:10px;flex-direction:row-reverse}',
    '  #gabW.is-v10:not(.is-min) .gw-bubble img{width:52px;height:52px;flex:none;background:#fff1c9}',
    '  #gabW.is-v10:not(.is-min) .gw-dot{right:auto;left:42px;bottom:6px}',
    '  #gabW.is-v10:not(.is-min) .gw-pill{display:flex;flex-direction:column;align-items:flex-start;text-align:right;line-height:1.25}',
    '  #gabW.is-v10 .gw-pill b{font-size:16px;color:#0d1b3d}',
    '  #gabW.is-v10 .gw-pill small{font-size:12.5px;color:#4a5060}',
    '  #gabW.is-v10:not(.is-min):not(.is-hidden):not(.is-away):not(.is-open) .gw-min{display:flex;position:fixed;z-index:207;',
    '    left:calc(var(--gw-left) - 6px);bottom:calc(var(--gw-bottom) + 46px);width:22px;height:22px;padding:0;border:1px solid #e3e8f2;',
    '    border-radius:50%;background:#fff;color:#0e2a6b;font-size:15px;line-height:1;align-items:center;justify-content:center;cursor:pointer;',
    '    box-shadow:0 2px 6px rgba(13,27,61,.2)}',
    '  #gabW.is-v10 .gw-min::before{content:"";position:absolute;inset:-11px}',
    '  #gabW.is-v10 .gw-min:focus-visible{outline:3px solid #c9a227;outline-offset:2px}',
    '  #gabW.is-v10 .gw-tip{left:calc(var(--gw-left) + 230px)}',
    '}',
    '#gabW.is-v10.is-min .gw-bubble{width:44px;height:44px;border:0;box-shadow:0 0 0 2.5px #c9a227,0 6px 16px rgba(14,42,107,.3)}',
    '#gabW.is-v10.is-min .gw-dot{width:11px;height:11px}',
    '#gabW.is-v10.is-min .gw-panel{bottom:calc(var(--gw-bottom) + 56px)}',
    '#gabW.is-v10.is-min .gw-tip{opacity:0;visibility:hidden}'
  ].join('\n');

  var WA_ICON = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.7-.3-1.4-.7-2-1.3-.5-.5-1-1.1-1.3-1.7-.1-.2 0-.4.1-.5l.4-.5.3-.5v-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.6.6-.9 1.4-.9 2.2.1.9.4 1.8 1 2.6 1.1 1.6 2.5 2.9 4.2 3.7.5.2.9.4 1.4.5.5.2 1 .2 1.5.1.6-.1 1.1-.5 1.4-1 .2-.3.2-.7.1-1-.1-.1-.3-.2-.5-.3z"/></svg>';

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }

  function waLink(cls, entry, text, label) {
    var a = el('a', { 'class': cls, href: waHref(text), target: '_blank', rel: 'noopener', 'data-bot': '1', 'data-bot-entry': entry }, label);
    return a;
  }

  function build() {
    var style = el('style', { id: 'gabWStyle' });
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = el('div', { id: 'gabW', 'class': 'is-hidden' });

    var panel = el('div', { 'class': 'gw-panel', id: 'gabWPanel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'gabWTitle' });
    var head = el('div', { 'class': 'gw-head' });
    head.appendChild(el('img', { src: AVATAR, width: '40', height: '40', alt: '' }));
    var who = el('div');
    who.appendChild(el('b', { id: 'gabWTitle' }, 'גבריאלה'));
    var status = el('span', { 'class': 'gw-status' });
    status.appendChild(el('i', { 'aria-hidden': 'true' }));
    status.appendChild(document.createTextNode('זמינה עכשיו בוואטסאפ'));
    who.appendChild(status);
    head.appendChild(who);
    var x = el('button', { type: 'button', 'class': 'gw-x', 'aria-label': 'סגירת החלונית' }, '×');
    head.appendChild(x);
    panel.appendChild(head);

    var body = el('div', { 'class': 'gw-body' });
    body.appendChild(el('p', { 'class': 'gw-msg' },
      'היי, אני גבריאלה, העוזרת החכמה של שוק הנדל״ן. אעזור לך למצוא את הנכס הנכון. מה מחפשים?'));
    var list = el('ul', { 'class': 'gw-choices', 'aria-label': 'בחירה מהירה' });
    body.appendChild(list);

    var free = el('form', { 'class': 'gw-free', novalidate: '' });
    var input = el('input', { type: 'text', id: 'gabWText', maxlength: '300', autocomplete: 'off', enterkeyhint: 'send',
      placeholder: 'או כתבו לגבריאלה מה מחפשים', 'aria-label': 'הודעה לגבריאלה' });
    var go = waLink('gw-go', 'widget_free', FREE_DEFAULT, '');
    go.innerHTML = WA_ICON + '<span>המשך בוואטסאפ</span>';
    free.appendChild(input);
    free.appendChild(go);
    body.appendChild(free);
    body.appendChild(el('p', { 'class': 'gw-note' }, 'השיחה ממשיכה בוואטסאפ, וגבריאלה עונה מיד'));
    panel.appendChild(body);

    var bubble = el('button', { type: 'button', 'class': 'gw-bubble', 'aria-expanded': 'false', 'aria-controls': 'gabWPanel',
      'aria-label': 'שיחה עם גבריאלה, העוזרת בוואטסאפ' });
    bubble.appendChild(el('img', { src: AVATAR, width: '60', height: '60', alt: '' }));
    bubble.appendChild(el('span', { 'class': 'gw-dot', 'aria-hidden': 'true' }));

    var tip = el('button', { type: 'button', 'class': 'gw-tip', tabindex: '-1', 'aria-hidden': 'true' }, TIP_TEXT);

    root.appendChild(panel);
    root.appendChild(tip);
    root.appendChild(bubble);
    document.body.appendChild(root);

    /* ---------- v10 (רק עם html.beta-hero): גלולה במחשב, מזעור, והתקפלות ליד הפוטר ----------
       ‏✕ מקפל לאווטאר של 44px באותה פינה (לחיצה עליו פותחת כרגיל), נשמר
       לסשן (‏sk_gabi_min). כשהפוטר על המסך - אווטאר, בלי בועית, כדי שהשורה
       המשפטית תישאר קריאה. לעולם לא נעלמת לגמרי. */
    var v10 = document.documentElement.classList.contains('beta-hero');
    var manualMin = false, footerMin = false;
    function syncMin() { root.classList.toggle('is-min', manualMin || footerMin); if (manualMin || footerMin) hideTip(); }
    if (v10) {
      root.classList.add('is-v10');
      var pill = el('span', { 'class': 'gw-pill', 'aria-hidden': 'true' });
      pill.appendChild(el('b', null, 'גבריאלה'));
      pill.appendChild(el('small', null, 'עוזרת הנדל״ן החכמה'));
      bubble.appendChild(pill);
      var minBtn = el('button', { type: 'button', 'class': 'gw-min', 'aria-label': 'מזעור גבריאלה' }, '×');
      root.appendChild(minBtn);
      minBtn.addEventListener('click', function () {
        manualMin = true;
        storageSet('sk_gabi_min', '1');
        syncMin();
        bubble.focus();
      });
      manualMin = storageGet('sk_gabi_min') === '1';
      var feet = document.querySelectorAll('footer');
      var foot = document.querySelector('footer.site') || feet[feet.length - 1];
      if (foot && 'IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { footerMin = en[0].isIntersecting; syncMin(); }, { threshold: 0 }).observe(foot);
      }
      // תמונה שנכשלה: הגזירה על רקע קרם, אף פעם לא תמונה שבורה
      Array.prototype.forEach.call(root.querySelectorAll('img'), function (im) {
        im.addEventListener('error', function once() {
          im.removeEventListener('error', once);
          im.src = '/assets/gabriela-cutout-400.webp';
          im.style.background = '#f6f1e7';
        });
      });
      syncMin();
    }

    function fillChoices() {
      list.innerHTML = '';
      var p = ctx && ctx.property;
      if (p && p.id) {
        var li = el('li');
        li.appendChild(waLink('gw-choice is-prop', 'widget_property', propertyLine(p), 'פרטים על הנכס הזה'));
        list.appendChild(li);
      }
      CHOICES.forEach(function (c) {
        var li = el('li');
        li.appendChild(waLink('gw-choice', 'widget_' + c.key, c.text, c.label));
        list.appendChild(li);
      });
      syncFree();
    }
    /* הקישור של "המשך בוואטסאפ" מתעדכן בכל הקלדה, כדי שהלחיצה תהיה לחיצה
       רגילה על <a> - נספרת ב-events.js ונפתחת כקישור ולא כ-window.open
       (שחוסם חלונות קופצים חוסם). בדף נכס הנכס מצורף גם להודעה החופשית. */
    function syncFree() {
      var t = input.value.trim();
      var p = ctx && ctx.property;
      var msg = t ? 'היי גבריאלה, ' + t : FREE_DEFAULT;
      if (p && p.id) msg += ' (לגבי הנכס: ' + (p.title || '') + ', מזהה: ' + p.id + ')';
      go.href = waHref(msg);
    }
    fillChoices();
    input.addEventListener('input', syncFree);
    free.addEventListener('submit', function (e) { e.preventDefault(); syncFree(); go.click(); });

    /* ---------- פתיחה וסגירה ---------- */
    var open = false;
    var returnFocus = null;
    function setOpen(on, why, source) {
      if (on === open) return;
      open = on;
      if (on) hideTip();
      root.classList.toggle('is-open', on);
      bubble.setAttribute('aria-expanded', on ? 'true' : 'false');
      bubble.setAttribute('aria-label', on ? 'סגירת החלונית של גבריאלה' : 'שיחה עם גבריאלה, העוזרת בוואטסאפ');
      if (on) {
        storageSet(AUTO_KEY, '1');
        // shukTrack ישירות ולא עוטף: check_gtm_container.py מוצא אירועים לפי השם הזה.
        // ‏source רק מהפתיחה החיצונית (‏GabWidget.open, ה-hero של v10) - בלעדיה האירוע כמו קודם
        var params = { trigger: why };
        if (source) params.source = source;
        if (window.shukTrack) window.shukTrack('gab_widget_open', params);
        if (why === 'click') setTimeout(function () { var f = list.querySelector('a'); if (f) f.focus(); }, 60);
      }
      sync();
    }
    /* פתיחה מבחוץ: כרטיס גבריאלה ב-hero של v10 (‏assets/home.js). Escape וה-✕
       מחזירים את הפוקוס למי שפתח. מחזיר false כשאין חלונית (העוזרת כבויה). */
    window.GabWidget = {
      open: function (source) {
        returnFocus = document.activeElement;
        setOpen(true, 'click', source || 'external');
        return true;
      }
    };
    function closeAndFocus() {
      setOpen(false);
      var back = returnFocus;
      returnFocus = null;
      if (back && back.focus && document.contains(back) && back.offsetParent !== null) back.focus();
      else bubble.focus();
    }
    bubble.addEventListener('click', function () { returnFocus = null; setOpen(!open, 'click'); });
    tip.addEventListener('click', function () { returnFocus = null; setOpen(true, 'tip'); });
    x.addEventListener('click', closeAndFocus);
    document.addEventListener('keydown', function (e) {
      if (open && e.key === 'Escape') closeAndFocus();
    });
    // מעבר לוואטסאפ סוגר את החלונית - בחזרה לדף היא לא מחכה פתוחה
    root.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a[data-bot]')) setTimeout(function () { setOpen(false); }, 300);
    });

    /* ---------- מתי הבועה בצד ----------
       ‏heroOn: בדף הבית, כרטיס גבריאלה שב-hero כבר על המסך - הבועה מיותרת.
       ‏avoidOn: טופס יושב בתחתית המסך, שם הבועה הייתה מסתירה אותו.
       ‏typing: הקלדה בשדה בדף (בנייד המקלדת דוחפת הכול למטה). */
    var heroOn = false, avoidOn = false, typing = false;
    var avoiding = new Set();
    function sync() {
      root.classList.toggle('is-hidden', heroOn && !open);
      root.classList.toggle('is-away', !open && (avoidOn || typing));
    }
    // ‏v10 (‏html.beta-hero): הכרטיס הישן מוסתר, ו-[data-gab-hero] הוא מה שעל המסך
    var heroCta = PAGE === 'home' && (document.documentElement.classList.contains('beta-hero')
      ? document.querySelector('[data-gab-hero]')
      : document.querySelector('#gabCtaWrap .gab-cta'));
    if ('IntersectionObserver' in window) {
      if (heroCta) {
        heroOn = true;
        new IntersectionObserver(function (en) { heroOn = en[0].isIntersecting; sync(); maybeAuto(); }).observe(heroCta);
      }
      // רק רצועת 150 הפיקסלים התחתונה של המסך: שם יושבת הבועה
      var band = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) avoiding.add(x.target); else avoiding.delete(x.target); });
        avoidOn = avoiding.size > 0;
        sync();
      }, { rootMargin: '-' + Math.max(0, window.innerHeight - 150) + 'px 0px 0px 0px' });
      Array.prototype.forEach.call(document.querySelectorAll(AVOID), function (f) { band.observe(f); });
    }
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      typing = !root.contains(t) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && window.innerWidth <= 760;
      sync();
    });
    document.addEventListener('focusout', function () { typing = false; setTimeout(sync, 0); });

    /* ---------- כרטיס הקשר ----------
       ‏overlapsContact: האם המלבן נוגע בכרטיס קשר שעל המסך. חלונית פתוחה
       שכרטיס כזה נכנס מתחתיה (גלילה, סרגל תחתון שעלה) נסגרת. */
    function overlapsContact(node) {
      var r = node.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var cards = document.querySelectorAll(CONTACT);
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c.hidden || root.contains(c)) continue;
        var q = c.getBoundingClientRect();
        if (!q.width || !q.height) continue;
        if (q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) return true;
      }
      return false;
    }
    var guardQueued = false;
    function guardContact() {
      if (guardQueued) return;
      guardQueued = true;
      requestAnimationFrame(function () {
        guardQueued = false;
        if (open && overlapsContact(panel)) setOpen(false);
        if (tipOn && overlapsContact(tip)) hideTip();
      });
    }
    window.addEventListener('scroll', guardContact, { passive: true });
    window.addEventListener('resize', guardContact);

    /* ---------- הבועית: פעם אחת בביקור, ל-4 שניות ----------
       אחרי 8 שניות או 40% גלילה, מה שקודם. בדף הבית - רק כשכרטיס גבריאלה
       שב-hero כבר לא על המסך, אחרת זה אותו דבר פעמיים. החלונית עצמה לא
       נפתחת לבד - רק לחיצה על הבועה או על הבועית. */
    var due = false, tipOn = false, tipTimer = 0;
    function hideTip() {
      tipOn = false;
      clearTimeout(tipTimer);
      root.classList.remove('is-tip');
    }
    function showTip() {
      storageSet(AUTO_KEY, '1');
      root.classList.add('is-tip');
      tipOn = true;
      if (overlapsContact(tip)) { hideTip(); return; }
      tipTimer = setTimeout(hideTip, TIP_MS);
    }
    function maybeAuto() {
      if (!due || open || tipOn || storageGet(AUTO_KEY) || heroOn || avoidOn || typing) return;
      showTip();
    }
    setTimeout(function () { due = true; maybeAuto(); }, AUTO_DELAY);
    window.addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (!due && h > 0 && window.scrollY / h >= AUTO_SCROLL) { due = true; }
      maybeAuto();
    }, { passive: true });

    /* דף נכס: property.js מודיע כשהנכס נטען */
    window.addEventListener('gabwidget:context', function () {
      ctx = window.gabWidgetContext || null;
      fillChoices();
    });

    sync();
  }

  function start() {
    if (!window.ShukBot || !window.ShukBot.enabled || !window.ShukBot.enabled()) return;
    build();
  }

  /* ‏bot-link.js נטען רק בחלק מהדפים. כשהוא חסר - טוענים אותו, ולא מעתיקים
     את המספר לכאן (מקור אמת יחיד). */
  function boot() {
    if (window.ShukBot) return start();
    var s = document.createElement('script');
    s.src = '/assets/bot-link.js';
    s.onload = start;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
