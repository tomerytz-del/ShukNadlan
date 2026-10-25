/* ============================================================================
   דף דוח ה-CMA - cma.html?k=<קישור>
   ----------------------------------------------------------------------------
   גבריאלה שולחת כפתור "📊 דוח CMA" עם הקישור הזה, כמו את דף הבדיקה
   התכנונית. הדף מציג **את אותו דוח ממותג שב-CRM** - renderCmaReport מ-
   assets/cma-render.js - בלי כניסה, ולכן אפשר להעביר אותו ללקוח/ה.

     1. cma-link - הדוח (נשמר כמו שהוא ברגע ההפקה) והמיתוג של היום
     2. renderCmaReport כותבת ל-#cmaBody
     3. הדפסה / PDF, שיתוף בוואטסאפ, שיתוף של הטלפון והעתקת הקישור

   ‏docs/cma.md, "הקישור לדוח".
   ========================================================================== */

/* העוזרים ש-cma-render.js מצפה להם כגלובלים. ב-CRM הם מגיעים מ-crm.js
   (אותם כללים בדיוק); כאן - העותק הקטן הזה. ‏esc הוא כינוי ל-escapeHtml של
   assets/esc.js, כמו בכל דף (CLAUDE.md, "בריחת HTML"). */
function esc(s){ return escapeHtml(s); }
const shekel = n => (n === null || n === undefined) ? '-' : '₪' + Number(n).toLocaleString('he-IL');
const hebDate = d => d ? new Date(d).toLocaleDateString('he-IL') : '-';
function plural(n, one, many, countText){
  return n === 1 ? one : (countText === undefined ? n : countText) + ' ' + many;
}

(function(){
  'use strict';

  const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  const FN_URL = SUPABASE_URL + '/functions/v1/cma-link';
  const K = (new URLSearchParams(location.search).get('k') || '').trim();
  const state = document.getElementById('cmaState');

  function showError(title, text, retry){
    state.hidden = false;
    state.innerHTML = '<h1>' + esc(title) + '</h1><p class="sub">' + esc(text) + '</p>'
      + (retry ? '<button class="cp-btn" id="retry" type="button">לנסות שוב</button>' : '');
    if (retry) document.getElementById('retry').addEventListener('click', run);
  }

  /* השיתוף: הקישור לדף עצמו - בניגוד לבדיקה התכנונית, את הדוח הזה שולחים
     ללקוח/ה. בלי מספרים בטקסט: הם בדף, עם ההסבר שלידם. */
  function wireActions(r){
    const s = r.subject || {};
    const what = [s.title, [s.address, s.city].filter(Boolean).join(', ')].filter(Boolean)[0] || 'הנכס';
    const text = 'דוח השוואת שוק (CMA) ל' + what + ':\n' + location.href;
    const msg = document.getElementById('cpMsg');
    const say = t => { msg.textContent = t; };

    document.getElementById('cpPrint').addEventListener('click', () => window.print());
    const wa = document.getElementById('cpWa');
    // ‏data-share: שיתוף ולא פנייה למתווך/ת (CLAUDE.md, "מדידת אירועים")
    wa.setAttribute('data-share', '');
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    const share = document.getElementById('cpShare');
    if (navigator.share){
      share.hidden = false;
      share.addEventListener('click', () => {
        navigator.share({ title: 'דוח השוואת שוק', text: text.split('\n')[0], url: location.href }).catch(() => {});
      });
    }
    document.getElementById('cpCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); say('הקישור הועתק'); }
      catch(_){ say('לא הצלחנו להעתיק - אפשר להעתיק מהכתובת למעלה'); }
    });
  }

  async function run(){
    if (!/^[0-9a-f]{32}$/.test(K)){
      showError('הקישור אינו תקין', 'אפשר לבקש מגבריאלה דוח חדש.', false);
      return;
    }
    state.hidden = false;
    state.innerHTML = '<div class="spin"></div><p>טוענת את הדוח…</p>';
    let data;
    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ k: K }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok || data.error){
        const gone = res.status === 404;
        showError(gone ? 'הקישור לדוח פג תוקף' : 'לא הצלחנו לטעון את הדוח',
          data.message || (gone ? 'אפשר לבקש מגבריאלה דוח חדש.' : 'נסו שוב בעוד רגע.'), !gone);
        return;
      }
    } catch(_){
      showError('לא הצלחנו לטעון את הדוח', 'בדקו את החיבור לאינטרנט ונסו שוב.', true);
      return;
    }
    try {
      renderCmaReport(data.report || {}, data.brand || null);
    } catch(err){
      console.error(err);
      showError('לא הצלחנו להציג את הדוח', 'נסו לרענן את הדף.', true);
      return;
    }
    state.hidden = true;
    document.getElementById('cpActions').hidden = false;
    const s = (data.report && data.report.subject) || {};
    document.title = 'דוח השוואת שוק' + (s.address ? ' - ' + s.address : '') + ' | שוק נדל״ן';
    wireActions(data.report || {});
  }

  run();
})();
