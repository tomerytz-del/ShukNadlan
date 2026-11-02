/* ============================================================================
   כפתור "שיתוף הדף" - דף המשרד (agency.html) ודף יועץ/ת הנדל״ן (agent.html)
   ----------------------------------------------------------------------------
   הכפתור עצמו כתוב ב-HTML של הדף (‏<button data-share data-page-share hidden>),
   כדי ש-check_events.py יראה אותו מסומן. הקובץ הזה מוסיף את הסגנון, חושף את
   הכפתור ומחבר את הלחיצה - כך שבלי JS אין כפתור מת על המסך.

   ‏data-share: שיתוף הוא ההיפך מפנייה. ‏events.js סופר רק קישורים, ולכן הכפתור
   נספר כאן ידנית כ-share (כמו ב-professional.html), ולא כ-contact_agent.

   הכתובת היא ה-canonical של הדף (‏og-tags.ts מזריקה אותה לפי המשרד או הסוכן/ת)
   ולא location.href, כדי שלא יישלחו הלאה פרמטרים של utm או של מקור הכניסה.
   ============================================================================ */
(function(){
  var CSS = [
    '.page-share{position:absolute;top:14px;inset-inline-end:14px;z-index:3;',
    'width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.7);',
    'background:rgba(255,255,255,.92);color:#122840;display:grid;place-items:center;',
    'cursor:pointer;box-shadow:0 4px 14px rgba(18,40,64,.22);padding:0;',
    '-webkit-tap-highlight-color:transparent;transition:transform .15s,background .15s}',
    '.page-share:hover,.page-share:focus-visible{background:#fff;color:#122840;transform:scale(1.06)}',
    '.page-share:focus-visible{outline:2px solid #122840;outline-offset:2px}',
    '.page-share svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;',
    'stroke-linecap:round;stroke-linejoin:round}',
    '.page-share[hidden]{display:none}',
    '.page-share-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:9999;',
    'background:#122840;color:#fff;padding:10px 18px;border-radius:999px;font-size:.92rem;',
    'box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:calc(100vw - 32px);text-align:center}'
  ].join('');

  function shareUrl(){
    var c = document.querySelector('link[rel="canonical"]');
    var href = c && c.href;
    // ‏canonical בלי פרמטר שייך לדף הכללי (/agency), לא לפריט; אז הכתובת עצמה
    if (href && /[?]/.test(href)) return href;
    try{
      var u = new URL(location.href);
      ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','ref','src']
        .forEach(function(k){ u.searchParams.delete(k); });
      u.hash = '';
      return u.href;
    } catch(e){ return location.href; }
  }

  function toast(text){
    var t = document.createElement('div');
    t.className = 'page-share-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2600);
  }

  // ‏share נדחף רק אחרי שהשיתוף קרה (docs/analytics-events.md): פתיחה של
  // חלון השיתוף וסגירתו אינן שיתוף. ‏content_type מ-data-share-type בכפתור.
  function track(btn, method){
    if (!window.shukTrack) return;
    var params = { method: method };
    var type = btn.getAttribute('data-share-type');
    if (type) params.content_type = type;
    window.shukTrack('share', params);
  }

  function copy(btn, url){
    if (navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(url).then(
        function(){ track(btn, 'copy_link'); toast('הקישור הועתק'); },
        function(){ toast('לא הצלחנו להעתיק. אפשר להעתיק את הכתובת מהדפדפן.'); });
    }
    toast('אפשר להעתיק את הכתובת מהדפדפן.');
  }

  function onClick(e){
    var btn = e.currentTarget;
    var url = shareUrl();
    if (navigator.share){
      navigator.share({ title: document.title, url: url }).then(
        function(){ track(btn, 'web_share'); },
        // ביטול בחלון השיתוף זורק AbortError - זה לא כשל, ואין מה להציג
        function(err){ if (!err || err.name !== 'AbortError') copy(btn, url); });
      return;
    }
    copy(btn, url);
  }

  function init(){
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    var btns = document.querySelectorAll('[data-page-share]');
    for (var i = 0; i < btns.length; i++){
      btns[i].addEventListener('click', onClick);
      btns[i].hidden = false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
