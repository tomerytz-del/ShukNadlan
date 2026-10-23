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
  var AUTO_KEY = 'gabWidgetAuto';   // הודעת הפתיחה כבר נפתחה בביקור הזה
  var AUTO_DELAY = 8000;
  var AUTO_SCROLL = 0.4;
  var AVATAR = '/assets/gabriela-avatar.webp';
  /* טפסים שהבועה לא יושבת עליהם כשהם בתחתית המסך */
  var AVOID = '#ownerWizardForm, #buyerWizardForm, #inquiryForm, #ownerLeadForm, #mleadForm, #ssaForm, #vizCta';

  /* כפתורי הבחירה המהירה. ההודעה היא מה שגבריאלה מקבלת - כל אחת מהן היא
     דבר שהבוט עושה (search_properties, owner_lead, open_house_signup). */
  var CHOICES = [
    { key: 'buy',   label: 'מחפש/ת לקנות',          text: 'היי גבריאלה, אני מחפש/ת דירה לקנייה' },
    { key: 'rent',  label: 'מחפש/ת להשכיר',          text: 'היי גבריאלה, אני מחפש/ת דירה להשכרה' },
    { key: 'owner', label: 'רוצה למכור',            text: 'היי גבריאלה, אני רוצה למכור או להשכיר נכס' },
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
    '@media(prefers-reduced-motion:reduce){#gabW .gw-bubble,#gabW .gw-panel{transition:none}}'
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

    root.appendChild(panel);
    root.appendChild(bubble);
    document.body.appendChild(root);

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
    function setOpen(on, why) {
      if (on === open) return;
      open = on;
      root.classList.toggle('is-open', on);
      bubble.setAttribute('aria-expanded', on ? 'true' : 'false');
      bubble.setAttribute('aria-label', on ? 'סגירת החלונית של גבריאלה' : 'שיחה עם גבריאלה, העוזרת בוואטסאפ');
      if (on) {
        storageSet(AUTO_KEY, '1');
        // shukTrack ישירות ולא עוטף: check_gtm_container.py מוצא אירועים לפי השם הזה
        if (window.shukTrack) window.shukTrack('gab_widget_open', { trigger: why });
        if (why === 'click') setTimeout(function () { var f = list.querySelector('a'); if (f) f.focus(); }, 60);
      }
      sync();
    }
    bubble.addEventListener('click', function () { setOpen(!open, 'click'); });
    x.addEventListener('click', function () { setOpen(false); bubble.focus(); });
    document.addEventListener('keydown', function (e) {
      if (open && e.key === 'Escape') { setOpen(false); bubble.focus(); }
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
    var heroCta = PAGE === 'home' && document.querySelector('#gabCtaWrap .gab-cta');
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

    /* ---------- הודעת הפתיחה: פעם אחת בביקור ----------
       אחרי 8 שניות או 40% גלילה, מה שקודם. בדף הבית - רק כשכרטיס גבריאלה
       שב-hero כבר לא על המסך, אחרת זה אותו דבר פעמיים. */
    var due = false;
    function maybeAuto() {
      if (!due || open || storageGet(AUTO_KEY) || heroOn || avoidOn || typing) return;
      setOpen(true, 'auto');
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
