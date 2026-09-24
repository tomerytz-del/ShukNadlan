/* ============================================================
   Live Supabase connection — shuknadlan-marketplace project.
   IMPORTANT STRUCTURE NOTE: all core UI wiring (menu, toggles,
   calculator, owner-lead form submit) is set up FIRST, with zero
   dependency on external scripts loading successfully. Supabase/
   Leaflet-dependent code runs after, wrapped in try/catch, so a
   blocked CDN (ad-blocker, corporate proxy, file:// restrictions)
   degrades to fallback content instead of breaking the whole page.
   ============================================================ */
/* גובה הכותרת הדביקה, ל-‎--header-h‎ שממנו נגזר ה-scroll-margin-top של כל
   סקציה (ראו את הכלל שליד header.site ב-CSS). נמדד ולא מקובע: הכותרת היא
   67px בנייד ו-75px מ-1024px ומעלה, ולכן ערך קבוע היה נכון ברוחב אחד
   ושגוי בשני. יושב כאן, בראש החיווט, כי הוא לא תלוי בשום CDN — גם דף
   ש-Supabase ו-Leaflet לא עלו בו עדיין גולל נכון. */
/* נמדדת *שורת* הכותרת ולא הכותרת כולה: תפריט ההמבורגר יושב בתוך
   ‎header.site‎, ולכן מדידה של הכותרת השלמה הייתה גדלה בגובה התפריט ברגע
   שהוא נפתח — ואיתה גם ה-‎scroll-margin-top‎ של כל סקציה (עוגן שנוחת
   מאות פיקסלים מתחת ליעד) וגם ה-‎max-height‎ של התפריט עצמו, שנגזר ממנה
   ומכווץ אותו עד שלא נשאר ממנו דבר. השורה היא מה שבאמת מכסה את היעד
   אחרי שהתפריט נסגר, וגובהה אינו תלוי בו. */
function syncHeaderHeight(){
  const header = document.querySelector('header.site');
  if (!header) return;
  const bar = header.querySelector('.header-inner') || header;
  // ‎+1‎: הגבול התחתון של הכותרת, שאינו חלק מגובה השורה
  document.documentElement.style.setProperty(
    '--header-h', (Math.round(bar.getBoundingClientRect().height) + 1) + 'px');
}
syncHeaderHeight();
/* ‏ResizeObserver ולא אירוע resize: גובה הכותרת משתנה גם בלי שהחלון זז —
   הגדלת הגופן בתפריט הנגישות שוברת את שם האתר לשתי שורות, והלוגו נטען
   אחרי ה-HTML. מדידה שמחוברת לאלמנט עצמו תופסת את כל המקרים האלה מבלי
   שכל אחד מהם יצטרך לזכור לקרוא לה. */
if (window.ResizeObserver){
  const bar = document.querySelector('header.site .header-inner');
  if (bar) new ResizeObserver(syncHeaderHeight).observe(bar);
} else {
  addEventListener('resize', syncHeaderHeight);
  addEventListener('load', syncHeaderHeight);
}

const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
const OWNER_LEAD_FUNCTION_URL = SUPABASE_URL + '/functions/v1/owner-lead-intake';

/* הנכסים שיש להם הדמיית AI מפורסמת — נטענים בשאילתה אחת אחרי שהנכסים
   עצמם עלו, ומזינים את תגית "הדמיית AI" שעל האריח. ‏Set ריק עד אז, ולכן
   האריחים נבנים בלי להמתין לה. */
let visualizedProps = new Set();

const FALLBACK_PROPERTIES = [
  {id:'m1', price:1180000, title:'דירת 4 חדרים, שכונת רמת דוד', rooms:4, property_type:'דירה', deal_type:'sale', category:'residential', lat:32.6078, lng:35.2897, agency_name:'משרד תיווך העמק', is_promoted:true},
  {id:'m2', price:4200, title:'דירת 3 חדרים להשכרה, מרכז העיר', rooms:3, property_type:'דירה', deal_type:'rent', category:'residential', lat:32.6100, lng:35.2950, agency_name:'נדל״ן גלבוע', is_promoted:false},
  {id:'m3', price:2350000, title:'בית פרטי, שכונת גבעת המורה', rooms:6, property_type:'בית פרטי', deal_type:'sale', category:'residential', lat:32.6020, lng:35.2830, agency_name:'בית ונחלה', is_promoted:true},
];
/* מבזקי ברירת המחדל — מה שהרצועה מציגה בשנייה הראשונה, לפני שהתשובה
   מ-Supabase חוזרת, וגם אם היא לא חוזרת בכלל. השדות זהים לאלה שמגיעים
   מ-news_items_public, כדי שהרצועה והמודאל לא יצטרכו להבחין ביניהם.
   בלי published_at בכוונה: אלה לא ידיעות מתוארכות, והמודאל מדלג על חותמת
   הזמן כשאין. */
const FALLBACK_TICKER = [
  {headline:'חם מהשטח: דירת 4 חדרים בעפולה נמכרה ב-1,350,000 ₪', category:'עסקאות ומחירים', is_local:true},
  {headline:'עדכון: ריבית הפריים נותרה יציבה לחודש השני ברציפות', category:'משכנתאות וריבית', is_local:false},
];
/* גרדיאנטים לכיסויי כתבות שאין להן תמונה (הנכסים עברו לממלא מקום ממותג) */
const CARD_GRADIENTS = ['linear-gradient(155deg,#0e2a6b,#0d1b3d)','linear-gradient(155deg,#0d1b3d,#1c3f8e)','linear-gradient(155deg,#08194a,#0e2a6b)','linear-gradient(155deg,#0e2a6b,#3a4f86)','linear-gradient(155deg,#0d1b3d,#0e2a6b)','linear-gradient(155deg,#1c3f8e,#08194a)'];

/* ניקוי ערך שמגיע מה-DB לפני הזרקה ל-innerHTML (גם בתוך מאפיין src/alt).
   מוגדר כאן, למעלה, כי הוא משמש גם את קרוסלת המשרדים, גם את בלון המפה
   וגם את ממלא המקום של נכס בלי תמונות. */
/* ‏escAttr הוא שם מקומי היסטורי ל-escapeHtml שב-assets/esc.js. ההגדרה
   הקודמת כאן טיפלה ב-‎& " <‎ בלבד — בלי גרש בודד ובלי ‎>‎ — ולכן ערך
   בתוך מאפיין בגרש בודד היה יוצא ממנו החוצה. */
function escAttr(s){ return escapeHtml(s); }

/* יש לנכס תמונה ראשית אמיתית? (מערך ריק, null או מחרוזת ריקה — אין) */
function hasPhoto(p){
  const img = p && p.images && p.images[0];
  return typeof img === 'string' && img.trim() !== '';
}

/* לוגו הפלטפורמה משמש כברירת מחדל אחרונה בממלא המקום — כשלנכס אין תמונות
   וגם למשרד שלו אין לוגו או שם. */
const SITE_LOGO = 'assets/logo-shuknadlan.svg';
const NO_PHOTOS_NOTE = 'תמונות של הנכס יעלו בקרוב';

/* ‏כתובת תמונה בתוך url('…') שבתוך מאפיין ‏style="…" — שתי שכבות ציטוט,
   ולכן encodeURI + ‎%27‎ ולא הדבקה ישירה: גרש בודד בשם הקובץ סוגר את ה-url
   ומריץ CSS זר, וגרש כפול בורח מהמאפיין עצמו אל תוך ה-HTML. אותו טיפול
   בדיוק כמו בתמונת הכתבה (ראו renderArticles). */
function cssUrl(u){
  return encodeURI(String(u == null ? '' : u)).replace(/'/g, '%27');
}

/* התמונה הראשית של נכס היא images[0]. נכס בלי תמונות מקבל את
   thumbFallback: לוגו המשרד שהנכס שייך אליו + "תמונות של הנכס יעלו בקרוב",
   במקום הגרדיאנט האדום שנראה כמו תמונה שבורה. */
function thumbStyle(p, i){
  return hasPhoto(p)
    ? `background-image:url('${cssUrl(p.images[0])}');background-size:cover;background-position:center`
    : '';
}

function thumbFallback(p){
  if (hasPhoto(p)) return '';
  const name = (p && p.agency_name) || '';
  const logo = (p && p.agency_logo) || (name ? '' : SITE_LOGO);
  const mark = logo
    ? `<img class="tf-logo" src="${escAttr(logo)}" alt="${escAttr(name)}" loading="lazy" onerror="this.remove()">`
    : `<span class="tf-logo tf-initial" aria-hidden="true">${escAttr(name.trim()[0] || '?')}</span>`;
  return `<div class="thumb-fallback">
      ${mark}
      ${name ? `<span class="tf-agency">${escAttr(name)}</span>` : ''}
      <span class="tf-note">${NO_PHOTOS_NOTE}</span>
    </div>`;
}
/* מחיר מסחרי נמסר כמעט תמיד לפני מע"מ, ולכן "+ מע״מ" מוצג ליד המחיר
   אלא אם הסוכן/ת סימן/ה במפורש שהמחיר כולל (‏price_includes_vat = true).
   אותו כלל ב-property-card.js, property.js, home.js ו-open-house.html. */
function priceLabel(p){
  const vat = p.category === 'commercial' && p.price_includes_vat !== true ? ' + מע״מ' : '';
  return (p.deal_type === 'rent' ? ('₪' + Number(p.price).toLocaleString('he-IL') + '/חוד׳') : ('₪' + Number(p.price).toLocaleString('he-IL'))) + vat;
}

/* ============================================================
   PART 1 — core UI. No external dependency. Always works.
   ============================================================ */

/* ---------- הרקע הזורם של הדף ----------
   השכבות, האנימציות וההיסט לפי הגלילה יושבים כולם ב-assets/page-bg.js, שכבר
   רשם לעצמו מאזיני scroll ו-resize כשהרכיב את הרקע. מה שנשאר כאן הוא נקודת
   הכניסה היחידה שהדף צריך: ‏applyA11y() קורא ל-requestPageBgFlow() כדי
   לעצור או להחזיר את התנועה ב"עצירת אנימציות", והמעטפת מעבירה את זה הלאה. */
function requestPageBgFlow(){
  if (window.PageBg) window.PageBg.refresh();
}


/* ---------- Accessibility panel ----------
   חלק מ-PART 1 בכוונה: ההגדרות חייבות לעבוד גם כשה-CDN של Supabase/Leaflet
   נכשל. ההעדפה נשמרת ב-localStorage ומוחלת מיד בטעינה הבאה.            */
const A11Y_MODES = ['a11y-contrast', 'a11y-links', 'a11y-readable', 'a11y-nomotion'];
const A11Y_KEY = 'shuknadlan_a11y';
const A11Y_FONT_MIN = 90, A11Y_FONT_MAX = 160, A11Y_FONT_STEP = 10;

function readA11y(){
  try{
    const raw = localStorage.getItem(A11Y_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return { fontPct: Number(saved.fontPct) || 100, modes: Array.isArray(saved.modes) ? saved.modes : [] };
  } catch(e){ return { fontPct:100, modes:[] }; }
}

function applyA11y(prefs){
  document.documentElement.style.fontSize = prefs.fontPct === 100 ? '' : prefs.fontPct + '%';
  A11Y_MODES.forEach(m => document.documentElement.classList.toggle(m, prefs.modes.includes(m)));

  const label = document.getElementById('a11yFontReset');
  if (label) label.textContent = prefs.fontPct + '%';
  document.querySelectorAll('.a11y-panel .opt').forEach(btn=>{
    const on = prefs.modes.includes(btn.dataset.a11y);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.state').textContent = on ? 'פועל' : 'כבוי';
  });

  // "עצירת אנימציות" נכנס/יוצא כאן, ולכן זה גם הרגע לעצור או להחזיר את
  // ההיסט של הרקע הזורם (אנימציות ה-CSS שלו נעצרות מהמחלקה עצמה)
  requestPageBgFlow();

  try{ localStorage.setItem(A11Y_KEY, JSON.stringify(prefs)); } catch(e){}
}

let a11yPrefs = readA11y();
applyA11y(a11yPrefs);

const a11yFab = document.getElementById('a11yFab');
const a11yPanel = document.getElementById('a11yPanel');

function setA11yPanel(open){
  a11yPanel.dataset.open = String(open);
  a11yFab.setAttribute('aria-expanded', String(open));
  if (open) a11yPanel.querySelector('button').focus();
}

a11yFab.addEventListener('click', (e)=>{
  e.stopPropagation();
  setA11yPanel(a11yPanel.dataset.open !== 'true');
});
a11yPanel.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', ()=>{ if (a11yPanel.dataset.open === 'true') setA11yPanel(false); });
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && a11yPanel.dataset.open === 'true'){ setA11yPanel(false); a11yFab.focus(); }
});

document.querySelectorAll('.a11y-panel .opt').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const mode = btn.dataset.a11y;
    a11yPrefs.modes = a11yPrefs.modes.includes(mode)
      ? a11yPrefs.modes.filter(m => m !== mode)
      : a11yPrefs.modes.concat(mode);
    applyA11y(a11yPrefs);
  });
});

function stepA11yFont(delta){
  a11yPrefs.fontPct = Math.min(A11Y_FONT_MAX, Math.max(A11Y_FONT_MIN, a11yPrefs.fontPct + delta));
  applyA11y(a11yPrefs);
}
document.getElementById('a11yFontUp').addEventListener('click', ()=> stepA11yFont(A11Y_FONT_STEP));
document.getElementById('a11yFontDown').addEventListener('click', ()=> stepA11yFont(-A11Y_FONT_STEP));
document.getElementById('a11yFontReset').addEventListener('click', ()=>{
  a11yPrefs.fontPct = 100; applyA11y(a11yPrefs);
});
document.getElementById('a11yReset').addEventListener('click', ()=>{
  a11yPrefs = { fontPct:100, modes:[] };
  applyA11y(a11yPrefs);
});

/* ---------- Mobile menu ---------- */
const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
menuToggle.addEventListener('click', () => {
  const open = mobileMenu.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', open);
});
function closeMobileMenu(){
  mobileMenu.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', false);
}

/* ארבע קבוצות היעדים הן לשוניות, ולכן מה שמתחלף הוא הפאנל הגלוי בלבד.
   הבחירה נשמרת כל עוד העמוד פתוח: מי שסגר/ה את התפריט בלשונית מסוימת
   וחזר/ה אליו מוצא/ת אותה במקום שבו השאיר/ה. */
document.querySelectorAll('.menu-tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.menu-tabs button').forEach(b=>{
      const on = b === btn;
      b.setAttribute('aria-selected', String(on));
      document.getElementById(b.getAttribute('aria-controls')).hidden = !on;
    });
  });
});

/* כל לחיצה על פריט בתפריט סוגרת אותו. רוב היעדים הם עוגנים באותו עמוד,
   ועוגן אינו טעינה מחדש — התפריט היה נשאר פתוח מעל היעד שאליו בדיוק
   גללנו, ודוחף אותו בגובהו מחוץ למסך. */
mobileMenu.addEventListener('click', (e)=>{
  if (e.target.closest('a')) closeMobileMenu();
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && mobileMenu.classList.contains('open')) closeMobileMenu();
});

/* ---------- "איך עובד הדירוג?" (מתוך תפריט ההמבורגר) ----------
   שאר הפריטים בתפריט הם עוגנים שסוגרים אותו מעצמם בניווט; זה פותח מודאל
   ולכן צריך לסגור את התפריט במפורש. */
const ratingInfoModal = document.getElementById('ratingInfoModal');
function ratingInfoClose(){ ratingInfoModal.classList.remove('open'); }
document.getElementById('ratingInfoLink').addEventListener('click', (e)=>{
  e.preventDefault();
  closeMobileMenu();
  ratingInfoModal.classList.add('open');
});
document.getElementById('ratingInfoClose').addEventListener('click', ratingInfoClose);
document.getElementById('ratingInfoDone').addEventListener('click', ratingInfoClose);
ratingInfoModal.addEventListener('click', (e)=>{ if (e.target === ratingInfoModal) ratingInfoClose(); });
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && ratingInfoModal.classList.contains('open')) ratingInfoClose();
});

/* ---------- Deal toggle (hero search) ---------- */
document.querySelectorAll('.deal-toggle button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  });
});


/* ---------- Newsflash ticker rotation (starts with fallback text immediately) ----------
   הרצועה מתחילה לרוץ מיד עם מבזקי ברירת המחדל, ו-initTicker() ב-PART 2
   מחליף אותם במה שנאסף מהפידים ברגע שהתשובה מ-Supabase חוזרת. כך אין
   רצועה ריקה בטעינה, ואין תלות ב-DB לתצוגה הראשונה. */
const TICKER_MAX = 10;   // כמה מבזקים נשמרים לרוטציה ולמודאל
let TICKER_ITEMS = FALLBACK_TICKER;
let tickerIndex = 0;
const tickerText = document.getElementById('tickerText');
const newsModal = document.getElementById('newsModal');
const newsModalList = document.getElementById('newsModalList');

function renderTicker(){
  if (!TICKER_ITEMS.length) return;
  const item = TICKER_ITEMS[tickerIndex];
  tickerText.textContent = item.headline || '';
  tickerIndex = (tickerIndex + 1) % TICKER_ITEMS.length;
  // הפעלה מחדש של אנימציית ההחלפה: הסרת המחלקה, קריאה שמאלצת reflow,
  // והחזרתה. בלי הקריאה הזו הדפדפן מאחד את שני השינויים ולא מריץ כלום.
  tickerText.classList.remove('swap');
  void tickerText.offsetWidth;
  tickerText.classList.add('swap');
}

/* מציב רשימת מבזקים חדשה ומתחיל אותה מההתחלה. נקרא גם מ-PART 2. */
function setTickerItems(items){
  if (!items || !items.length) return;
  TICKER_ITEMS = items.slice(0, TICKER_MAX);
  tickerIndex = 0;
  renderTicker();
  renderNewsModal();
}

renderTicker();
// הרוטציה נעצרת בזמן שהמודאל פתוח: הרשימה שם מציגה את אותם מבזקים, ושורה
// שמתחלפת מאחורי החלון רק גונבת תשומת לב.
setInterval(()=>{ if (!newsModal.classList.contains('open')) renderTicker(); }, 5000);

/* ---------- "כל העדכונים" — עשרת המבזקים האחרונים ---------- */

/* חותמת זמן יחסית. מבזק הוא לפי הגדרתו טרי, ולכן "לפני 3 שעות" אומר יותר
   מתאריך מלא; מעל שבוע חוזרים לתאריך, כי "לפני 11 ימים" כבר לא נקרא.
   היחיד והזוגי מנוסחים בנפרד — "לפני 1 שעות" הוא בדיוק סוג הטקסט שמסגיר
   שהמספר הודבק לתבנית. */
function newsTimeLabel(stamp){
  if (!stamp) return '';
  const when = new Date(stamp);
  if (isNaN(when)) return '';
  const minutes = Math.round((Date.now() - when.getTime()) / 60000);
  if (minutes < 1) return 'עכשיו';
  if (minutes === 1) return 'לפני דקה';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'לפני שעה';
  if (hours === 2) return 'לפני שעתיים';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'אתמול';
  if (days === 2) return 'לפני יומיים';
  if (days < 8) return `לפני ${days} ימים`;
  return when.toLocaleDateString('he-IL', { day:'numeric', month:'long' });
}

/* הרשימה נבנית ב-createElement ובלי innerHTML: הכותרות והתקצירים מגיעים
   מפידים חיצוניים, ו-textContent מסלק את שאלת ההזרקה מהשורש. */
function renderNewsModal(){
  newsModalList.textContent = '';
  if (!TICKER_ITEMS.length){
    const empty = document.createElement('p');
    empty.className = 'news-empty';
    empty.textContent = 'אין מבזקים להצגה כרגע.';
    newsModalList.appendChild(empty);
    return;
  }

  TICKER_ITEMS.forEach(item => {
    const href = safeExternalUrl(item.url || '');
    const card = document.createElement(href ? 'a' : 'div');
    card.className = 'news-item';
    if (href){
      card.href = href;
      // מבזק הוא תוכן חיצוני — הוא נפתח בלשונית חדשה כדי לא לגרור את
      // הגולש/ת מחוץ לאתר באמצע גלישה.
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    }

    const top = document.createElement('div');
    top.className = 'news-item-top';
    const badge = document.createElement('span');
    badge.className = 'news-badge' + (item.is_local ? ' local' : '');
    badge.textContent = item.category || (item.is_local ? 'עפולה והעמק' : 'נדל״ן ארצי');
    top.appendChild(badge);
    const stamp = newsTimeLabel(item.published_at);
    if (stamp){
      const time = document.createElement('span');
      time.className = 'news-time';
      time.textContent = stamp;
      top.appendChild(time);
    }
    card.appendChild(top);

    const title = document.createElement('h4');
    title.textContent = item.headline || '';
    card.appendChild(title);

    if (item.summary){
      const body = document.createElement('p');
      body.textContent = item.summary;
      card.appendChild(body);
    }
    if (item.source_name){
      const source = document.createElement('span');
      source.className = 'news-source';
      source.textContent = 'מקור: ' + item.source_name;
      card.appendChild(source);
    }
    newsModalList.appendChild(card);
  });
}

function newsModalOpen(){
  renderNewsModal();
  newsModal.classList.add('open');
  document.getElementById('newsModalClose').focus();
}
function newsModalClose(){ newsModal.classList.remove('open'); }

/* ---------- נקודות המידע ----------
   שורות המשנה של הסקציות הפכו לנקודת "i". בעכבר היא נפתחת בריחוף ובמקלדת
   בפוקוס — שניהם ב-CSS; כאן רק מסך המגע, שבו אין ריחוף: לחיצה פותחת,
   לחיצה נוספת (או בכל מקום אחר בעמוד, או Escape) סוגרת.

   החותמות שבשורת המספרים (‏‎.hero-mark[data-info]‎) נושאות את אותה בועה
   ואת אותה התנהגות, ולכן הן נכנסות לאותו סלקטור ולא לזוג מאזינים שני
   שיתפצל ממנו בעריכה הבאה. זה גם מה שנתן לחותמות הרביעית והחמישית
   (שיתופי פעולה, הדמיות) את ההתנהגות שלהן בלי שורת JS אחת. */
const INFO_TRIGGER_SEL = '.info-dot,.hero-mark[data-info]';
document.addEventListener('click', (e)=>{
  const dot = e.target.closest ? e.target.closest(INFO_TRIGGER_SEL) : null;
  document.querySelectorAll(INFO_TRIGGER_SEL).forEach(d=>{ if (d !== dot) d.classList.remove('is-open'); });
  if (dot) dot.classList.toggle('is-open');
});
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') document.querySelectorAll(INFO_TRIGGER_SEL).forEach(d=> d.classList.remove('is-open'));
});

document.getElementById('tickerMore').addEventListener('click', newsModalOpen);
document.getElementById('tickerText').addEventListener('click', newsModalOpen);
document.getElementById('newsModalClose').addEventListener('click', newsModalClose);
document.getElementById('newsModalDone').addEventListener('click', newsModalClose);
newsModal.addEventListener('click', (e)=>{ if (e.target === newsModal) newsModalClose(); });
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && newsModal.classList.contains('open')) newsModalClose();
});

/* ---------- Mortgage calculator (pure JS, live, amortization formula) ---------- */
/* שני המחשבונים ירדו מזרימת דף הבית ועברו למודאלים שנפתחים מתפריט
   ההמבורגר. ‏"מחשבון משכנתא" בפוטר ובכל עמודי המשנה הוא קישור אל
   ‎#calc‎ (ו-‎#yield‎ לתשואה), ולכן ה-hash הוא מה שפותח את המודאל — אף
   קישור קיים באתר לא נשבר.

   ‏bindCalcModal מחזיר פותח/סוגר, ולא נשען על openModal/closeModal
   שמוגדרות בהמשך הקובץ: כמו המחשבון עצמו, המודאל חייב לעבוד גם כשה-CDN
   של supabase-js/leaflet חסום. */
function bindCalcModal({ id, closeBtn, hash, focusEl, onOpen }){
  const modal = document.getElementById(id);
  if (!modal) return { open(){}, close(){} };

  function close(){
    modal.classList.remove('open');
    // ניקוי ה-hash בסגירה: בלעדיו לחיצה חוזרת על אותו קישור בתפריט לא
    // מייצרת hashchange, והמודאל לא נפתח שוב.
    if (location.hash === hash) history.replaceState(null, '', location.pathname + location.search);
  }
  function open(){
    closeMobileMenu();
    modal.classList.add('open');
    if (onOpen) onOpen();
    const focus = focusEl && document.getElementById(focusEl);
    (focus || document.getElementById(closeBtn))?.focus({ preventScroll:true });
  }

  document.getElementById(closeBtn)?.addEventListener('click', close);
  modal.addEventListener('click', (e)=>{ if (e.target === modal) close(); });
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  function fromHash(){ if (location.hash === hash) open(); }
  window.addEventListener('hashchange', fromHash);
  fromHash();

  return { open, close };
}

const calcModal = bindCalcModal({
  id:'calcModal', closeBtn:'calcModalClose', hash:'#calc',
  // הסליידרים נמדדים רק אחרי הפתיחה — לפניה הם היו במודאל מוסתר, ומילוי
  // המסלול שלהם היה מחושב על רוחב 0
  onOpen(){ ['calcPrice','calcEquity'].forEach(id => paintRange(document.getElementById(id))); },
});

const LTV_THRESHOLDS = { single:0.75, replacement:0.70, investment:0.50 }; // מודול 2 §5.5 — קונפיגורבילי
const nis = n => Math.round(n).toLocaleString('he-IL');

/* מילוי המסלול של סליידר: --p הוא האחוז שהגרדיאנט ב-CSS נעצר בו. */
function paintRange(el){
  const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
  const pct = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', pct.toFixed(2) + '%');
}

function updateCalculator(){
  const priceEl = document.getElementById('calcPrice');
  const equityEl = document.getElementById('calcEquity');
  const price = parseFloat(priceEl.value) || 0;
  const equity = parseFloat(equityEl.value) || 0;
  const annualRate = parseFloat(document.getElementById('calcRate').value) || 0;
  const years = parseFloat(document.getElementById('calcYears').value) || 1;

  [priceEl, equityEl].forEach(paintRange);
  document.getElementById('calcPriceOut').textContent = nis(price);
  document.getElementById('calcEquityOut').textContent = nis(equity);

  const loan = Math.max(price - equity, 0);
  const monthlyRate = (annualRate/100)/12;
  const n = years*12;
  let monthly = 0;
  if (loan > 0 && monthlyRate > 0){
    monthly = loan * (monthlyRate*Math.pow(1+monthlyRate,n)) / (Math.pow(1+monthlyRate,n)-1);
  }
  document.getElementById('calcMonthly').textContent = monthly ? (nis(monthly) + ' ₪') : '-';

  const ltv = price > 0 ? loan/price : 0;
  // ההשוואה על הערך המעוגל — אותו מספר שמוצג. עם ההשוואה על הערך הגולמי,
  // מימון של 75.1% הציג "אחוז המימון הנדרש (75%) חורג מהתקרה (75%)".
  const ltvPct = Math.round(ltv*100);
  document.getElementById('calcLtvPct').textContent = ltvPct + '%';
  document.getElementById('calcLtvFill').style.width = Math.min(ltv*100, 100) + '%';

  const warn = document.getElementById('calcLtvWarning');
  if (ltvPct > LTV_THRESHOLDS.single*100){
    warn.textContent = `אחוז המימון הנדרש (${ltvPct}%) חורג מהתקרה המקובלת לדירה יחידה (75%) - כדאי לבדוק מול יועץ משכנתאות`;
  } else {
    warn.textContent = '';
  }
}
['calcPrice','calcEquity','calcRate','calcYears'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateCalculator);
});
/* כפתורי ‎−/+‎ של הריבית והתקופה. clamp ל-min/max של השדה, ועיגול לפי ה-step
   כדי שלא ייווצרו שאריות float כמו 4.800000000000001. */
document.querySelectorAll('.calc-step-ctl button[data-step]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const input = document.getElementById(btn.dataset.step);
    const step = parseFloat(input.step) || 1;
    const min = parseFloat(input.min), max = parseFloat(input.max);
    const decimals = (String(step).split('.')[1] || '').length;
    let next = (parseFloat(input.value) || 0) + step * Number(btn.dataset.dir);
    next = Math.min(Math.max(next, min), max);
    input.value = next.toFixed(decimals);
    updateCalculator();
  });
});
updateCalculator();

/* ---------- Yield calculator (מחשבון תשואה למשקיעים) ----------
   הרכיב של דף המשרד (agency.html), באותו באנר מתקפל של שאר הכלים כאן.
   כמו מחשבון המשכנתא — חישוב טהור בדפדפן, בלי תלות ב-SDK ובלי שליחה: מה
   שנשלח הוא רק מה שהגולש/ת בוחר/ת לשלוח דרך ה-CTA.

   ההבדל היחיד מגרסת דף המשרד הוא ערכי הפתיחה: שם הם נגזרים מחציון הנכסים
   של אותו משרד, וכאן אין "אותו משרד" — ולכן נשארים ערכי ברירת המחדל. */
const yieldState = { price:1250000, rent:4200, costs:6000, vacancy:0.5 };
const pctText = v => v == null ? '-' : v.toFixed(1).replace(/\.0$/, '') + '%';

function updateYield(){
  const { price, rent, costs, vacancy } = yieldState;

  document.getElementById('yieldPriceOut').textContent = nis(price);
  document.getElementById('yieldRentOut').textContent = nis(rent);

  const gross = price > 0 ? (rent * 12) / price * 100 : null;
  // חודשי אי-אכלוס יורדים מההכנסה לפני ההוצאות — נכס ריק לא מפסיק לעלות כסף
  const netAnnual = rent * Math.max(12 - vacancy, 0) - costs;
  const net = price > 0 ? netAnnual / price * 100 : null;
  // החזר ההשקעה מוגדר רק כשההכנסה חיובית: הוצאות שגבוהות מהשכירות אינן
  // "אינסוף שנים" אלא הפסד, ומספר במקום הזה היה משקר
  const payback = (price > 0 && netAnnual > 0) ? price / netAnnual : null;

  document.getElementById('yieldNet').textContent = pctText(net);
  document.getElementById('yieldGross').textContent = pctText(gross);
  document.getElementById('yieldAnnual').textContent = netAnnual > 0 ? '₪' + nis(netAnnual) : '-';
  document.getElementById('yieldPayback').textContent = payback == null ? '-' : nis(payback);

  document.getElementById('yieldGrossPct').textContent = pctText(gross);
  // הפס נמדד מול 8% — התקרה המעשית של תשואה ברוטו בשוק המקומי, כך שהמילוי
  // אומר משהו במקום להיתקע תמיד ברבע הראשון
  document.getElementById('yieldGrossFill').style.width =
    Math.min(Math.max((gross || 0) / 8 * 100, 0), 100).toFixed(1) + '%';

  document.getElementById('yieldWarn').textContent = netAnnual <= 0
    ? 'ההוצאות והחודשים הריקים גבוהים מההכנסה משכירות - בתנאים האלה אין תשואה.'
    : '';
}

const yieldModal = bindCalcModal({
  id:'yieldModal', closeBtn:'yieldModalClose', hash:'#yield',
  // הסליידרים נמדדים רק אחרי הפתיחה — לפניה הם היו במודאל מוסתר, ומילוי
  // המסלול שלהם היה מחושב על רוחב 0
  onOpen(){ ['yieldPrice','yieldRent'].forEach(id => paintRange(document.getElementById(id))); },
});

[['yieldPrice','price'], ['yieldRent','rent']].forEach(([id, key])=>{
  const el = document.getElementById(id);
  el.addEventListener('input', ()=>{
    yieldState[key] = Number(el.value) || 0;
    paintRange(el);
    updateYield();
  });
  paintRange(el);
});

/* שדות ה-‎−/+‎. ‏clamp ל-min/max של השדה ועיגול לפי ה-step, כדי שלא ייווצרו
   שאריות float כמו 1.5000000000000002 בחודשי אי-האכלוס. */
const YIELD_STEP_KEYS = { yieldCosts:'costs', yieldVacancy:'vacancy' };
document.querySelectorAll('.calc-step-ctl button[data-ystep]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const input = document.getElementById(btn.dataset.ystep);
    const step = parseFloat(input.step) || 1;
    const decimals = (String(step).split('.')[1] || '').length;
    let next = (parseFloat(input.value) || 0) + step * Number(btn.dataset.dir);
    next = Math.min(Math.max(next, parseFloat(input.min)), parseFloat(input.max));
    input.value = next.toFixed(decimals);
    yieldState[YIELD_STEP_KEYS[input.id]] = Number(input.value);
    updateYield();
  });
});
Object.keys(YIELD_STEP_KEYS).forEach(id=>{
  const input = document.getElementById(id);
  input.addEventListener('input', ()=>{
    yieldState[YIELD_STEP_KEYS[id]] = Math.max(Number(input.value) || 0, 0);
    updateYield();
  });
});

// ‏CTA: מי שסיים/ה לחשב תשואה מחפש/ת נכס להשקעה, וזה בדיוק החיפוש השמור
// שבאנר מחפשי הנכס פותח — ולכן אין כאן טופס שני אלא הפניה אליו.
document.getElementById('yieldLeadOpen').addEventListener('click', ()=>{
  // המודאל נסגר לפני שהבאנר נפתח: אחרת הליד נפתח מאחורי שכבה כהה
  yieldModal.close();
  openBuyerSearch();
});

updateYield();

/* ---------- בלון ליד ייעוץ משכנתאות ----------
   נמצא כאן ולא ליד שאר המודאלים בכוונה: כמו המחשבון עצמו, הוא חייב לעבוד גם
   כשה-CDN של supabase-js/leaflet חסום. לכן הוא לא נשען על openModal/closeModal
   שמוגדרות בהמשך הקובץ, ולא על ה-SDK — השליחה היא fetch() טהור אל
   mortgage-lead-intake, בדיוק כמו אשף בעלי הנכסים.

   הליד שנוצר נכנס ל-mortgage_leads ונמכר ליועצ/ת משכנתאות אחד/ת ב-₪50
   דרך מדף הלידים ב-CRM (מיגרציה 20260826120000_mortgage_leads.sql).      */
const MORTGAGE_LEAD_FUNCTION_URL = SUPABASE_URL + '/functions/v1/mortgage-lead-intake';

const mleadModal  = document.getElementById('mleadModal');
const mleadForm   = document.getElementById('mleadForm');
const mleadDone   = document.getElementById('mleadDone');
const mleadErrorEl= document.getElementById('mleadError');

// צילום של מצב המחשבון ברגע פתיחת הבלון. נלכד בפתיחה ולא בשליחה, כדי
// שהסיכום שהמשתמש/ת רואה בטופס יהיה בדיוק מה שיישלח.
let mleadSnapshot = {};

function mleadCaptureSnapshot(){
  const price  = parseFloat(document.getElementById('calcPrice').value) || 0;
  const equity = parseFloat(document.getElementById('calcEquity').value) || 0;
  const loan   = Math.max(price - equity, 0);
  mleadSnapshot = {
    property_price: price,
    equity: equity,
    interest_rate: parseFloat(document.getElementById('calcRate').value) || null,
    years: parseInt(document.getElementById('calcYears').value, 10) || null,
    monthly_payment: mleadMonthlyFromDisplay(),
  };
  const ltv = price > 0 ? Math.round((loan/price)*100) : 0;
  document.getElementById('mleadRecap').textContent =
    `מהמחשבון: נכס ${nis(price)} ₪ · הון עצמי ${nis(equity)} ₪ · ${ltv}% מימון · ` +
    `${mleadSnapshot.years} שנים בריבית ${mleadSnapshot.interest_rate}%`;
}

// ההחזר כבר חושב ומוצג; קריאה חוזרת לנוסחה כאן רק תפתח פתח לסטייה בין
// המספר שעל המסך למספר שנשלח.
function mleadMonthlyFromDisplay(){
  const digits = document.getElementById('calcMonthly').textContent.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function mleadOpen(){
  mleadCaptureSnapshot();
  mleadErrorEl.textContent = '';
  mleadModal.classList.add('open');
  document.getElementById('mleadName').focus();
}
function mleadClose(){ mleadModal.classList.remove('open'); }

document.getElementById('mleadOpenBtn').addEventListener('click', mleadOpen);
document.getElementById('mleadCloseBtn').addEventListener('click', mleadClose);
mleadModal.addEventListener('click', (e)=>{ if (e.target === mleadModal) mleadClose(); });
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && mleadModal.classList.contains('open')) mleadClose();
});

mleadForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const nameEl  = document.getElementById('mleadName');
  const phoneEl = document.getElementById('mleadPhone');
  const emailEl = document.getElementById('mleadEmail');
  const full_name = nameEl.value.trim();
  const phone     = phoneEl.value.trim();
  const email     = emailEl.value.trim();

  // אותן בדיקות רצות שוב ב-Edge Function — כאן הן רק כדי לחסוך למשתמש/ת
  // הלוך-ושוב לשרת.
  const bad = {
    name:  full_name.length < 2,
    phone: phone.replace(/\D/g, '').length < 9,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  };
  nameEl.classList.toggle('invalid', bad.name);
  phoneEl.classList.toggle('invalid', bad.phone);
  emailEl.classList.toggle('invalid', bad.email);
  if (bad.name)  { mleadErrorEl.textContent = 'נא להזין שם מלא'; nameEl.focus(); return; }
  if (bad.phone) { mleadErrorEl.textContent = 'נא להזין מספר טלפון תקין'; phoneEl.focus(); return; }
  if (bad.email) { mleadErrorEl.textContent = 'נא להזין כתובת אימייל תקינה'; emailEl.focus(); return; }
  mleadErrorEl.textContent = '';

  const btn = document.getElementById('mleadSubmitBtn');
  const originalLabel = btn.textContent;
  btn.textContent = 'שולח…';
  btn.disabled = true;
  try{
    const res = await fetch(MORTGAGE_LEAD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({
        full_name, phone, email,
        owns_property: document.getElementById('mleadOwns').checked,
        ...mleadSnapshot,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'שגיאה');
    mleadForm.hidden = true;
    mleadDone.hidden = false;
    if (window.shukTrack) shukTrack('generate_lead', { form_id:'mortgage' });
  } catch(err){
    console.error('mortgage-lead-intake failed:', err);
    mleadErrorEl.textContent = 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב';
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

/* ---------- Owner-lead wizard (3 steps) ----------
   שלב 1 עסקה+כתובת, שלב 2 מאפייני הנכס, שלב 3 פרטי קשר. השליחה בסוף היא
   fetch() טהור אל owner-lead-intake — בלי תלות ב-SDK, כך שהאשף עובד גם אם
   סקריפט ה-CDN של supabase-js נכשל בטעינה.                                */
const CONDITION_LABELS = {
  renovated: 'משופץ',
  partly_renovated: 'משופץ חלקית',
  needs_renovation: 'דרוש שיפוץ',
};

const ownerHeadline = document.getElementById('ownerHeadline');
const wizForm = document.getElementById('ownerWizardForm');
const wizDone = document.getElementById('wizDone');

const wizState = { deal:'sale', address:'', condition:null, rooms:null, features:[], name:'', phone:'' };

// כל הקלדה מנקה את השגיאה ואת סימון השדה, כדי שלא תישאר אדומה אחרי תיקון
[['wizAddress',1], ['wizName',3], ['wizPhone',3]].forEach(([id, step])=>{
  document.getElementById(id).addEventListener('input', (e)=>{
    e.target.classList.remove('invalid');
    setError(step, '');
  });
});

/* פתיחה וסגירה של באנר ליד — משותף לבאנר בעלי הנכסים ולבאנר מחפשי הנכס.
   שניהם נטענים סגורים: שורת ההזמנה לבדה, בכחצי מגובה הבאנר הפתוח. הלחיצה
   היא הסכמה לתת פרטים, ולכן היא גם מה שפורס את האשף — ולא ההפך. */
function bindLeadBanner({ banner, teaser, panel, onOpen }){
  const bannerEl = document.getElementById(banner);
  const teaserEl = document.getElementById(teaser);
  const panelEl  = document.getElementById(panel);
  if (!bannerEl || !teaserEl || !panelEl) return ()=>{};

  function setOpen(open){
    if (panelEl.hidden !== open) return;   // כבר במצב המבוקש
    panelEl.hidden = !open;
    bannerEl.classList.toggle('is-open', open);
    teaserEl.setAttribute('aria-expanded', String(open));
    if (open && onOpen) onOpen();
  }
  teaserEl.addEventListener('click', ()=> setOpen(panelEl.hidden));
  return setOpen;
}

bindLeadBanner({
  banner:'ownerBanner', teaser:'ownerStartBtn', panel:'ownerPanel',
  onOpen(){
    goToStep(1);
    // ‏preventScroll: הפוקוס נועד לחסוך הקלקה, לא לקפוץ מעל שורת ההזמנה
    // שהמשתמש/ת בדיוק לחץ/ה עליה
    document.getElementById('wizAddress').focus({ preventScroll:true });
  },
});

function goToStep(n){
  wizForm.querySelectorAll('.wiz-panel').forEach(p=>{
    p.classList.toggle('active', Number(p.dataset.panel) === n);
  });
  document.querySelectorAll('#wizSteps li').forEach(li=>{
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === n);
    li.classList.toggle('done', step < n);
  });
}

function setError(step, message){
  document.getElementById('wizErr' + step).textContent = message || '';
}

/* --- שלב 1: סוג עסקה + כתובת --- */
document.querySelectorAll('.owner-toggle button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    wizState.deal = btn.dataset.owner;
    ownerHeadline.textContent = wizState.deal === 'sale' ? 'מוכר?' : 'משכיר?';
  });
});

/* --- שלב 2: צ'יפים של בחירה יחידה (מצב הנכס, חדרים) --- */
function bindSingleChoice(attr, onPick){
  document.querySelectorAll(`.chip[data-${attr}]`).forEach(chip=>{
    chip.addEventListener('click', ()=>{
      chip.parentElement.querySelectorAll('.chip').forEach(c=> c.setAttribute('aria-checked','false'));
      chip.setAttribute('aria-checked','true');
      onPick(chip.dataset[attr]);
    });
  });
}
// ניקוי השגיאה מיד עם הבחירה, ולא רק בניסיון המעבר הבא — אחרת ההודעה
// "נא לבחור מספר חדרים" נשארת על המסך אחרי שהמשתמש כבר בחר.
bindSingleChoice('condition', v => { wizState.condition = v; setError(2, ''); });
bindSingleChoice('rooms', v => { wizState.rooms = v; setError(2, ''); });

document.querySelectorAll('.wiz-checks input').forEach(cb=>{
  cb.addEventListener('change', ()=>{
    wizState.features = Array.from(document.querySelectorAll('.wiz-checks input:checked')).map(i=>i.value);
  });
});

/* --- ניווט בין השלבים, עם ולידציה לפני מעבר קדימה --- */
wizForm.querySelectorAll('[data-next]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const from = Number(btn.closest('.wiz-panel').dataset.panel);
    if (!validateStep(from)) return;
    goToStep(Number(btn.dataset.next));
  });
});
wizForm.querySelectorAll('[data-back]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    setError(Number(btn.closest('.wiz-panel').dataset.panel), '');
    goToStep(Number(btn.dataset.back));
  });
});

function validateStep(step){
  if (step === 1){
    const el = document.getElementById('wizAddress');
    wizState.address = el.value.trim();
    if (wizState.address.length < 3){
      setError(1, 'נא להזין כתובת מדויקת - רחוב ומספר');
      el.classList.add('invalid'); el.focus();
      return false;
    }
    el.classList.remove('invalid'); setError(1, '');
    return true;
  }
  if (step === 2){
    if (!wizState.condition){ setError(2, 'נא לבחור את מצב הנכס'); return false; }
    if (!wizState.rooms){ setError(2, 'נא לבחור מספר חדרים'); return false; }
    setError(2, '');
    return true;
  }
  if (step === 3){
    const nameEl = document.getElementById('wizName');
    const phoneEl = document.getElementById('wizPhone');
    wizState.name = nameEl.value.trim();
    wizState.phone = phoneEl.value.trim();
    const digits = wizState.phone.replace(/\D/g, '');
    nameEl.classList.toggle('invalid', wizState.name.length < 2);
    phoneEl.classList.toggle('invalid', digits.length < 9);
    if (wizState.name.length < 2){ setError(3, 'נא להזין שם מלא'); nameEl.focus(); return false; }
    if (digits.length < 9){ setError(3, 'נא להזין מספר טלפון תקין'); phoneEl.focus(); return false; }
    setError(3, '');
    return true;
  }
  return true;
}

/* --- שליחה --- */
wizForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!validateStep(3)) return;
  const submitBtn = document.getElementById('wizSubmitBtn');
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'שולח…';
  submitBtn.disabled = true;
  try{
    const res = await fetch(OWNER_LEAD_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({
        city: 'עפולה',
        property_type: 'דירה', // האשף מיועד לדירות; סוג-נכס מלא נשאר בטופס הסוכן
        deal_type: wizState.deal,
        address: wizState.address,
        rooms: wizState.rooms,
        condition: CONDITION_LABELS[wizState.condition] || null,
        features: wizState.features,
        name: wizState.name,
        phone: wizState.phone,
        // מזהה הווידג'ט נשמר ביומן ניתוב הלידים, כדי שמנהל/ת הפלטפורמה
        // תדע איזה כלי ייצר ליד שאין למי להפנות (ראו docs/lead-routing.md)
        source: 'homepage_owner_wizard',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה');
    wizForm.hidden = true;
    document.getElementById('wizSteps').hidden = true;
    wizDone.hidden = false;
    if (window.shukTrack) shukTrack('generate_lead', { form_id:'owner_wizard' });
  } catch(err){
    console.error('owner-lead-intake failed:', err);
    setError(3, 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב');
    submitBtn.textContent = originalLabel;
    submitBtn.disabled = false;
  }
});

document.getElementById('wizRestart').addEventListener('click', ()=>{
  wizForm.reset();
  wizForm.querySelectorAll('.chip').forEach(c=> c.setAttribute('aria-checked','false'));
  wizForm.querySelectorAll('.wiz-input').forEach(i=> i.classList.remove('invalid'));
  [1,2,3].forEach(s => setError(s, ''));
  Object.assign(wizState, { address:'', condition:null, rooms:null, features:[], name:'', phone:'' });
  const submitBtn = document.getElementById('wizSubmitBtn');
  submitBtn.textContent = 'קבלת הערכת שווי חינם';
  submitBtn.disabled = false;
  wizDone.hidden = true;
  wizForm.hidden = false;
  document.getElementById('wizSteps').hidden = false;
  goToStep(1);
});

/* ============================================================
   PART 2 — Supabase-backed content (map, live listings, live
   ticker). Everything here is wrapped so a failure never
   touches Part 1 above.
   ============================================================ */
let sb = null;
try {
  if (window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.warn('supabase-js לא נטען (CDN חסום/נכשל) - עובד במצב fallback בלבד.');
  }
} catch(e){ console.warn('יצירת Supabase client נכשלה:', e); }

/* קידום נמכר לחלון של 72 שעות. ‏expire_promotions ב-DB מכבה את is_promoted
   כל רבע שעה, והבדיקה מול promoted_until כאן סוגרת גם את הפער הזה, כדי
   שנכס לא יישאר עם סרט "מקודם" אחרי שהחלון נגמר. ‏promoted_until ריק =
   קידום ידני/היסטורי בלי מועד סיום.                                     */
const isPromoted = p => !!p.is_promoted && (!p.promoted_until || new Date(p.promoted_until) > new Date());

/* העמודות שכל תצוגות הנכסים בעמוד הבית נשענות עליהן — המפה, מדפי
   הנכסים ושורות התוצאות. loadProperties ו-runSearch חייבות למשוך בדיוק את
   אותה רשימה, אחרת תוצאות חיפוש יורדות לברירות מחדל (גרדיאנט במקום תמונה,
   "עפולה והעמק" במקום הכתובת) ברגע שהמשתמש חיפש. */
/* created_at נטען אף שהמיון מה-DB כבר עושה בו שימוש: הרשימה חוזרת
   ממוינת מקודמים-קודם, ומדפי הנכסים (‏newestFirst ב-assets/prop-shelf.js)
   צריכים את התאריך עצמו כדי למיין מחדש לפי סדר ההעלאה, בלי הקידום. */
/* ‏floor, features, video_url ו-tour_3d_url נוספו כדי שאריח הנכס יוכל
   להציג את שורת המאפיינים (חדרים · מ״ר · קומה · חניה), את תגיות הבלעדיות
   והמדיה, ולתת עדיפות בתצוגה לנכסים שיש להם וידאו או סיור. כולן עמודות
   ותיקות שדף הסוכן/ת ודף המשרד כבר שולפים. */
const PROPERTY_SELECT =
  'id, price, title, rooms, size_sqm, floor, city, street, address, property_type, deal_type, category, price_includes_vat, ' +
  'created_at, lat, lng, is_promoted, promoted_until, images, features, video_url, tour_3d_url, has_virtual_tour, neighborhood_id, ' +
  /* יריד הבתים הפתוחים: שלוש העמודות נשלפות יחד כי התצוגה בודקת את החלון
     ולא את הדגל לבדו (ראו assets/open-house.js). בלעדיהן הפין על המפה,
     התגית על האריח והבאנר שמעל תיבת הנכסים לא היו יודעים על היריד דבר. */
  'open_house, open_house_start, open_house_end, ' +
  'agencies(name, logo_url), neighborhoods(name)';

const shapeProperty = p => ({
  ...p,
  agency_name: p.agencies?.name || '',
  // הלוגו נטען כדי שנכס בלי תמונות יציג את מיתוג המשרד שלו במקום אריח ריק
  agency_logo: p.agencies?.logo_url || '',
  neighborhood_name: p.neighborhoods?.name || '',
});

/* כל הנכסים הפעילים במאגר, ולא רק 12: המפה בעמוד הבית אמורה להראות את
   התמונה המלאה של השוק לפני שהגולש בכלל חיפש. המקודמים ראשונים, ואחריהם
   הנכסים החדשים — הסדר קובע גם את הקרוסלה וגם את הגריד שלמטה. */
const PROPERTY_LIMIT = 300;

async function loadProperties(){
  if (!sb) return FALLBACK_PROPERTIES;
  try{
    const { data, error } = await sb
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('status', 'active')
      .order('is_promoted', { ascending:false })
      .order('created_at', { ascending:false })
      .limit(PROPERTY_LIMIT);
    if (error || !data || data.length === 0) throw error || new Error('empty');
    return data.map(shapeProperty);
  } catch(e){
    console.warn('נכשל טעינת נכסים מה-DB, משתמש בנתוני fallback:', e);
    return FALLBACK_PROPERTIES;
  }
}

/* המבזקים שהרצועה מציגה, משני מקורות:

   1. ‏news_items_public — מה שמנוע המבזקים אסף אוטומטית מפרסומי עיריית
      עפולה ומאתרי הנדל"ן המובילים (news_scraper.py, רץ ב-GitHub Actions
      כל שעתיים). ראו docs/news-ticker.md.
   2. ‏market_deals — עסקאות שנסגרו בפלטפורמה עצמה. זה המבזק שאף אתר חדשות
      לא יכול לתת, ולכן הוא נשאר גם כשיש שפע ידיעות חיצוניות.

   שני המקורות מתמזגים לרשימה אחת ממוינת לפי זמן, ונחתכים לעשרה — בדיוק
   מה שהרוטציה והמודאל מציגים. ‏limit גבוה מ-TICKER_MAX בכוונה: המיזוג הוא
   שקובע מי נכנס לעשירייה, ולא הסדר שבו חזרו השאילתות.

   שתי השאילתות רצות במקביל, וכישלון של אחת (טבלה שטרם נוצרה בסביבה הזו)
   אינו מפיל את השנייה — ‎allSettled‎ ולא ‎all‎. */
async function loadTicker(){
  if (!sb) return FALLBACK_TICKER;
  try{
    const [newsRes, dealsRes] = await Promise.allSettled([
      sb.from('news_items_public')
        .select('headline, summary, url, category, is_local, source_name, published_at')
        .order('published_at', { ascending:false })
        .limit(TICKER_MAX),
      sb.from('market_deals')
        .select('property_type, rooms, city, sale_price, sold_at, price_basis')
        .order('sold_at', { ascending:false })
        .limit(3),
    ]);

    const news = newsRes.status === 'fulfilled' ? (newsRes.value.data || []) : [];
    const deals = dealsRes.status === 'fulfilled' ? (dealsRes.value.data || []) : [];

    const items = [
      ...news.map(n => ({
        headline: n.headline,
        summary: n.summary || '',
        url: n.url || '',
        category: n.category || '',
        is_local: !!n.is_local,
        source_name: n.source_name || '',
        published_at: n.published_at,
      })),
      /* ‏price_basis: המבזק אומר "נמכרה ב-₪X", וזו הצהרה על מחיר עסקה.
         שורה שנרשמה לפי המחיר המבוקש (`asking`) אינה יכולה לשאת אותה —
         היא פשוט אינה מופיעה ברצועה. */
      ...deals.filter(d => d.rooms && d.city && d.sale_price
                        && (d.price_basis === 'reported' || d.price_basis === 'official')).map(d => ({
        headline: `חם מהשטח: דירת ${d.rooms} חדרים ב${d.city} נמכרה ב-${Number(d.sale_price).toLocaleString('he-IL')} ₪`,
        summary: 'עסקה שנסגרה דרך הפלטפורמה.',
        url: '',
        category: 'עסקה בפלטפורמה',
        is_local: true,
        source_name: '',
        published_at: d.sold_at,
      })),
    ]
      .filter(i => i.headline)
      .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));

    return items.length ? items : FALLBACK_TICKER;
  } catch(e){
    console.warn('נכשל טעינת מבזק מה-DB, משתמש בנתוני fallback:', e);
    return FALLBACK_TICKER;
  }
}

/* ‏loadTicker() הוגדרה מזמן אבל מעולם לא נקראה — הרצועה הציגה תמיד את
   מבזקי ברירת המחדל. הקריאה כאן היא מה שמחבר אותה למנוע האיסוף. */
(async function initTicker(){
  setTickerItems(await loadTicker());
})();
/* ============================================================
   מאתר משרדי התיווך — תחומי התמחות ואזורי פעילות
   ------------------------------------------------------------
   הפלטפורמה לא שואלת משרד "במה אתה מתמחה", ועמודת specialties ריקה כמעט
   אצל כולם. לכן ההתמחות נגזרת מהמלאי הפעיל בפועל: משרד "מתמחה" בתחום אם
   יש לו בו לפחות נכס פעיל אחד — וזה גם מה שהופך את הסינון לשימושי, כי
   הוא מסנן לפי מה שבאמת אפשר למצוא אצל המשרד היום. ההגדרות זהות לאלה
   שב-agencies.html במכוון: אותה גלולה חייבת להחזיר את אותם משרדים בשני
   המסכים.
   ============================================================ */
/* תווית לכל מפתח התמחות, לשורת התגיות בכרטיס ולבורר המהיר.

   ‏**ההגדרה מה נכנס לכל מפתח אינה כאן** — היא ב-‎homepage_agent_cards‎
   ו-‎homepage_agency_cards‎ במסד, שמחזירות את המפתחות מוכנים (ראו
   ‏supabase/migrations/…_homepage_cards_aggregate.sql). קודם היא הייתה
   בשני המקומות: פרדיקט ב-JS שרץ על כל הנכסים, ואותו כלל ב-SQL — ושתי
   הגדרות של אותו דבר נפרדות זו מזו בשקט ברגע שאחת מהן משתנה. */
const AGENCY_SPECS = [
  { key:'all',         label:'הכל' },
  { key:'residential', label:'דירות מגורים' },
  { key:'commercial',  label:'נדל״ן מסחרי' },
  { key:'land',        label:'קרקעות ומשקים' },
  // פרויקט חדש = נכס שנושא סטטוס פרויקט כלשהו (בתכנון/בבנייה/אכלוס)
  { key:'projects',    label:'פרויקטים חדשים' },
];

/* הקרוסלה מציגה את *כל* משרדי התיווך שבפלטפורמה, ולא רק את אלה שכבר יש
   להם שורה ב-agency_rankings. קודם נטענו הדירוגים בלבד, ומכיוון שיש בהם
   שלוש שורות בדיוק — בדיוק מספר הכרטיסים שנראים בבת אחת — למסלול לא היה
   בכלל עודף רוחב והוא לא נגלל, ומשרדים חדשים שטרם דורגו פשוט לא הופיעו.
   כאן הדירוג קובע רק את הסדר: המדורגים ראשונים (השלושה הראשונים נושאים
   תג #1..#3), ואחריהם שאר המשרדים לפי מספר הנכסים הפעילים ואז לפי שם. */
/* מספר טלפון שנכנס ל-href של wa.me: ספרות בלבד, 9-15 — אותה בדיקה של
   ‏hasPhone ב-agency.html. היא גם שער אבטחה, כי הערך מגיע מהמסד. */
const DM_PHONE_RE = /^\d{9,15}$/;

async function loadLeadingAgencies(){
  try{
    if (!sb) return [];
    const [agenciesRes, rankingsRes, ratingsRes, activeRes, membersRes] = await Promise.all([
      // התקרות כאן הן רק גבול בטיחות לגודל התשובה, לא מכסת תצוגה.
      sb.from('agencies').select('id, name, slug, logo_url, cover_url, specialty_areas, ethics_code_accepted_at, ethics_badge_revoked_at').limit(200),
      sb.from('agency_rankings').select('agency_id, composite_score, active_properties_count').limit(200),
      // הדירוג נלקח מה-view ולא מ-agency_rankings.bayesian_rating: הטבלה
      // מתרעננת אחת לשבועיים, וה-view מחושב מהביקורות המפורסמות ברגע הטעינה,
      // כך שביקורת שאושרה הבוקר משפיעה על הכרטיס היום. אותו נימוק בדיוק
      // שבגללו כרטיסי המתווכים סופרים את הביקורות עצמם.
      sb.from('agency_ratings_public').select('agency_id, score, review_count').limit(200),
      // שורה אחת לכל משרד — מספר הנכסים, ההתמחות ואזורי הפעילות — במקום
      // כל הנכסים הפעילים לדפדפן. קודם נשלפה כאן טבלת הנכסים כולה רק כדי
      // שהדפדפן יספור אותה, ו-‎limit(2000)‎ היה הופך בשקט ממגן לחיתוך
      // ברגע שיש יותר נכסים מזה — ואז הספירה בכרטיס פשוט שגויה.
      sb.rpc('homepage_agency_cards'),
      // מי מאויש. ‏agency_members_public מחזיר/ה שורות active בלבד, ולכן
      // משרד שאינו כאן הוא משרד שכל חבריו סגרו חשבון או הושעו — שלט בלי
      // איש מאחוריו, שאין למי לפנות בו.
      // ‏role ו-phone_e164 בשביל כפתור הוואטסאפ שבכרטיס: ל-agencies אין
      // טלפון, והפנייה הולכת למנהל/ת המשרד — בדיוק כמו בדף המשרד
      // (‏renderAgencyContact ב-agency.html).
      sb.from('agency_members_public').select('agency_id, active, role, phone_e164').limit(1000),
    ]);
    const allAgencies = agenciesRes.data;
    if (agenciesRes.error || !allAgencies) throw agenciesRes.error || new Error('empty');

    // הסינון חל רק על רשימה מלאה ותקינה: שליפה שנכשלה או נחתכה בתקרה אינה
    // תמונה מלאה של מי פעיל/ה, ועדיף להציג משרד ריק מלהעלים משרד חי.
    const members = membersRes.data || [];
    const staffed = new Set(members.filter(m => m.active !== false).map(m => m.agency_id));
    const agencies = (!membersRes.error && members.length && members.length < 1000)
      ? allAgencies.filter(a => staffed.has(a.id))
      : allAgencies;

    // מספר הוואטסאפ של כל משרד: מנהל/ת עם מספר תקין, ואם אין — החבר/ה
    // הראשון/ה שיש לו/ה. ‏phone_e164 נכנס ל-href, ולכן הוא עובר את אותה
    // בדיקת ספרות-בלבד של דף המשרד.
    const waByAgency = new Map();
    members.filter(m => m.active !== false && DM_PHONE_RE.test(String(m.phone_e164 || '')))
      .sort((x, y) => (y.role === 'manager') - (x.role === 'manager'))
      .forEach(m => { if (!waByAgency.has(m.agency_id)) waByAgency.set(m.agency_id, m.phone_e164); });

    const rankByAgency = {};
    (rankingsRes.data || []).forEach(r => { rankByAgency[r.agency_id] = r; });

    const ratingByAgency = {};
    (ratingsRes.data || []).forEach(r => { ratingByAgency[r.agency_id] = r; });

    // מספר הנכסים הפעילים מגיע מהספירה במסד ולא מ-active_properties_count
    // שבטבלת הדירוגים: זה שדה מחושב שמתעדכן מדי פעם, ומספיק שמשרד יעלה
    // נכס אחד כדי שהכרטיס יציג מספר ישן. הדירוגים נשארים נפילה־לאחור.
    const cardByAgency = new Map();
    (activeRes.data || []).forEach(c => {
      if (c && c.agency_id) cardByAgency.set(c.agency_id, c);
    });

    return agencies
      .map(a => {
        const ranking = rankByAgency[a.id];
        const rated = ratingByAgency[a.id];
        const card = cardByAgency.get(a.id);
        return {
          ...a,
          score: ranking ? Number(ranking.composite_score) : null,
          // ‏score ב-view הוא null למשרד בלי ביקורות — משרד חדש לא מקבל
          // "0 כוכבים" אלא פשוט לא מוצג עם דירוג, כמו בכרטיסי המתווכים.
          rating: rated?.score != null ? Number(rated.score) : null,
          reviews_count: Number(rated?.review_count) || 0,
          active_properties_count: card?.active_count ?? (ranking?.active_properties_count ?? 0),
          wa_phone: waByAgency.get(a.id) || null,
          // שני השדות האלה משרתים רק את מאתר המשרדים שמתחת לקרוסלה
          specs: card?.specs || [],
          // ‏specialty_areas שהוקלד ב-CRM נשאר הגיבוי למשרד בלי נכסים ממופים
          areas: (card?.areas && card.areas.length)
            ? card.areas
            : (Array.isArray(a.specialty_areas) ? a.specialty_areas.slice(0, 3) : []),
        };
      })
      .sort((x, y)=>{
        if (x.score !== null && y.score === null) return -1;
        if (x.score === null && y.score !== null) return 1;
        if (x.score !== null && y.score !== null && y.score !== x.score) return y.score - x.score;
        if (y.active_properties_count !== x.active_properties_count){
          return y.active_properties_count - x.active_properties_count;
        }
        return String(x.name || '').localeCompare(String(y.name || ''), 'he');
      });
  } catch(e){
    console.warn('טעינת משרדי תיווך נכשלה:', e);
    return [];
  }
}

/* הרשימה נטענת פעם אחת ומשמשת גם את סקציית "האנשים מאחורי העסקאות"
   וגם את מונה המשרדים שב-hero. ‏Promise ולא קריאה כפולה: שתי שאילתות
   לאותם משרדים היו מסתכנות בשתי תשובות שונות באותו עמוד. */
const agenciesReady = loadLeadingAgencies();

/* כמו בקרוסלת משרדי התיווך, הרצועה מציגה את *כל* המתווכים הפעילים
   שבפלטפורמה ולא רק את אלה שכבר יש להם שורה ב-agent_rankings (שלוש שורות
   בלבד היום — בדיוק מספר הכרטיסים שנראים בבת אחת, כך שלמסלול לא היה עודף
   רוחב והוא לא נגלל כלל). הדירוג קובע כאן רק את הסדר: קודם דירוג הביקורות
   הממוצע, ואחריו מספר הנכסים הפעילים.
   הערה: "באזורך" בהנחיה המקורית מרמז על התאמה גיאוגרפית לפי מיקום הגולש —
   עדיין אין זיהוי מיקום בדף הבית, אז מוצגים כאן המובילים בכל האזור
   (עפולה + סביבה), לא מסוננים לפי שכונה ספציפית. */
async function loadLeadingAgents(){
  try{
    if (!sb) return [];
    const [membersRes, rankingsRes, reviewsRes, activeRes] = await Promise.all([
      // התקרות כאן הן רק גבול בטיחות לגודל התשובה, לא מכסת תצוגה.
      sb.from('agency_members_public').select('id, display_name, slug, photo_url, photo_position, cover_url, phone_e164, agency_id, has_ethics_badge').limit(200),
      sb.from('agent_rankings').select('agent_id, composite_score, active_properties_count').limit(200),
      // הממוצע ומספר הביקורות מחושבים ב-view ולא בדפדפן. קודם נשלפו כאן
      // כל הביקורות המפורסמות באתר (‏limit(2000)) רק כדי לחלק סכום במספר —
      // אותו דפוס בדיוק שהיה בספירת הנכסים. זהו גם המקור שכרטיסי המשרדים
      // כבר משתמשים בו (‎agency_ratings_public‎), כך ששני סוגי הכרטיסים
      // נשענים עכשיו על אותה שכבה.
      sb.from('agent_ratings_public').select('agent_id, avg_rating, review_count').limit(200),
      // שורה אחת לכל סוכן/ת — מספר הנכסים והתחומים שהבורר המהיר שבתיבת
      // החיפוש גוזר מהם — במקום כל הנכסים הפעילים לדפדפן. ההגדרה של
      // התחומים יושבת ב-‎homepage_agent_cards‎ ומעתיקה את AGENCY_SPECS
      // אחד לאחד, כך ששני המקומות ממשיכים להסכים.
      sb.rpc('homepage_agent_cards'),
    ]);
    const members = membersRes.data;
    if (membersRes.error || !members) throw membersRes.error || new Error('empty');

    // שם המשרד נטען בשאילתה נפרדת ולא ב-embed: מאז ש-property_shares מחזיקה
    // שני מפתחות זרים ל-agencies, embed מ-agency_members ל-agencies מחזיר
    // PGRST201 (HTTP 300) במקום את השורה.
    const agencyIds = [...new Set(members.map(m => m.agency_id).filter(Boolean))];
    const agencyById = {};
    if (agencyIds.length){
      // ‏cover_url של המשרד — הנפילה של מתווך/ת שלא העלה/תה תמונת נושא,
      // אותה נפילה של agent.html
      const { data: agencies } = await sb.from('agencies').select('id, name, cover_url').in('id', agencyIds);
      (agencies||[]).forEach(a => agencyById[a.id] = a);
    }

    const rankByAgent = {};
    (rankingsRes.data || []).forEach(r => { rankByAgent[r.agent_id] = r; });

    // ‏avg_rating ב-view מחושב מהביקורות המפורסמות עצמן ולא מ-
    // bayesian_rating שבטבלת הדירוגים: זה שדה מחושב שמתעדכן מדי פעם, ובלי
    // הביקורות שמאחוריו הכרטיס היה מציג כוכבים בלי אף ביקורת שתגבה אותם.
    // כך גם הסדר וגם התצוגה נשענים על אותו מקור אחד.
    const reviewAgg = {};
    (reviewsRes.data || []).forEach(r => {
      if (r && r.agent_id) reviewAgg[r.agent_id] = r;
    });

    // אותו נימוק כמו במשרדים: מספר הנכסים הפעילים נספר במסד ולא נלקח
    // מ-active_properties_count, כדי שהכרטיס לא יציג מספר ישן.
    const cardByAgent = {};
    (activeRes.data || []).forEach(c => {
      if (c && c.agent_id) cardByAgent[c.agent_id] = c;
    });

    return members
      .map(m => {
        const agg = reviewAgg[m.id];
        const ranking = rankByAgent[m.id];
        return {
          ...m,
          agency_name: agencyById[m.agency_id]?.name || '',
          agency_cover: agencyById[m.agency_id]?.cover_url || null,
          // ‏avg_rating הוא null למי שאין לו/ה ביקורות — סוכן/ת חדש/ה לא
          // מקבל/ת "0 כוכבים" אלא פשוט לא מוצג/ת עם דירוג, כמו במשרדים.
          rating: agg?.avg_rating != null ? Number(agg.avg_rating) : null,
          reviews_count: Number(agg?.review_count) || 0,
          active_properties_count: cardByAgent[m.id]?.active_count ?? (ranking?.active_properties_count ?? 0),
          specs: cardByAgent[m.id]?.specs || [],
        };
      })
      .sort((x, y)=>{
        if (x.rating !== null && y.rating === null) return -1;
        if (x.rating === null && y.rating !== null) return 1;
        if (x.rating !== null && y.rating !== null && y.rating !== x.rating) return y.rating - x.rating;
        if (y.active_properties_count !== x.active_properties_count){
          return y.active_properties_count - x.active_properties_count;
        }
        return String(x.display_name || '').localeCompare(String(y.display_name || ''), 'he');
      });
  } catch(e){
    console.warn('טעינת מתווכים מובילים נכשלה:', e);
    return [];
  }
}


/* הרשימה נטענת פעם אחת ומשמשת את לשונית "מתווכים" בסקציית האנשים מאחורי
   העסקאות. ‏Promise ולא קריאה כפולה, מאותו נימוק כמו במשרדים. */
const agentsReady = loadLeadingAgents();

/* ---------- נכסים מסחריים ---------- */
/* אותה מדיניות כמו FALLBACK_PROPERTIES: תוכן הדגמה נכנס רק כשה-DB לא זמין
   או מחזיר ריק, כדי שהעמוד לא ייראה שבור בהדגמה/במצב לא מקוון.          */
const FALLBACK_COMMERCIAL = [
  {id:'c1', price:8500, title:'משרד 85 מ״ר במרכז העסקים, עפולה', rooms:3, size_sqm:85, city:'עפולה', property_type:'משרדים', deal_type:'rent', category:'commercial', agency_name:'נדל״ן גלבוע'},
  {id:'c2', price:1750000, title:'חנות ברחוב הראשי, חזית לרחוב', rooms:null, size_sqm:64, city:'עפולה', property_type:'חנויות/שטח מסחרי', deal_type:'sale', category:'commercial', agency_name:'משרד תיווך העמק'},
  {id:'c3', price:12000, title:'מבנה תעשייה באזור התעסוקה', rooms:null, size_sqm:320, city:'עפולה עילית', property_type:'מבני תעשייה', deal_type:'rent', category:'commercial', agency_name:'בית ונחלה'},
  {id:'c4', price:640000, title:'קליניקה מרווחת עם חניה צמודה', rooms:2, size_sqm:52, city:'עפולה', property_type:'קליניקות', deal_type:'sale', category:'commercial', agency_name:'נדל״ן גלבוע'},
];

/* כמה נכסים מסחריים נשלפים לתיבה. הרצועה שקדמה לה הציגה עשרה מתוך
   שלושים, והתיבה מציגה את כולם בעימוד — ולכן הבריכה גדלה למשהו שהוא כל
   המלאי המסחרי בפועל ולא מדגם ממנו. */
const COMMERCIAL_POOL = 120;

async function loadCommercialProperties(){
  if (!sb) return FALLBACK_COMMERCIAL;
  try{
    /* ‏PROPERTY_SELECT ולא רשימת עמודות משלו: מאז שסינון התגיות שבמדף מגיע
       גם למפה (‏ppShelfToMap), נכס מכאן חייב להיות זהה בצורתו לנכס
       מהרשימה הראשית — אחרת הוא מגיע בלי lat/lng ובלי שם שכונה, כלומר
       נספר בתוצאות ולא מקבל פין. */
    const { data, error } = await sb
      .from('properties')
      .select(PROPERTY_SELECT)
      .eq('status', 'active')
      .eq('category', 'commercial')
      // בלי סדר מפורש ה-DB מחזיר שורות בסדר לא מוגדר, ואז גם הבריכה שממנה
      // בוחרים משתנה מטעינה לטעינה. החדשים קודם, כמו בשתי הרצועות האחרות.
      .order('created_at', { ascending: false })
      .limit(COMMERCIAL_POOL);
    if (error || !data || data.length === 0) throw error || new Error('empty');
    // הסידור נעשה במדף עצמו (assets/prop-shelf.js → ordered), כמו בתצוגה
    // הפרטית: מקודמים, עדיפות למדיה וסדר ההעלאה במקום אחד.
    return data.map(shapeProperty);
  } catch(e){
    console.warn('טעינת נכסים מסחריים נכשלה, משתמש בנתוני fallback:', e);
    return FALLBACK_COMMERCIAL;
  }
}

/* המלאי המסחרי הוא החלק היחיד בתיבה ששולף לעצמו: הרשימה הראשית מוגבלת
   ל-300 נכסים פעילים והמסחריים הם מיעוט קטן בתוכה, כך שהם היו נחתכים
   ממנה בדיוק כשיש הרבה מלאי למגורים. ‏FALLBACK_COMMERCIAL הוא גם הסיבה
   השנייה: בלי DB זמין אין ולו נכס מסחרי אחד ברשימה הראשית.

   שלושת קישורי "כל הנכסים…" (‏seeAllByDeal) ירדו יחד עם שלוש הרצועות:
   הם קפצו חזרה לסרגל החיפוש שבראש העמוד והריצו חיפוש, כלומר הוציאו את
   המשתמש מהתצוגה שבה היה. בתיבה הסינון הוא התגיות שמעל הגריד, והעימוד
   מגיע עד סוף המלאי. */
(async function initCommercialProperties(){
  if (!document.getElementById('allProps')) return;
  /* שתי שורות ולא ‎ppSync(await …)‎: ב-JS צד שמאל של הקריאה מוערך *לפני*
     הארגומנט, כלומר השם נקרא עוד לפני ה-await — והוא מוגדר מאות שורות
     מתחת. שם זה נפל ב-TDZ, והמלאי המסחרי נשאר בחוץ. */
  const items = await loadCommercialProperties();
  ppCommercial = items;
  ppSync();
})();

/* ---------- יריד הבתים הפתוחים: הרצועה שמעל תיבת הנכסים ----------
   הספירה היא שאילתת ‎count‎ בלבד (‏head:true — אפס שורות על החוט), ולא
   סינון של הרשימה הראשית: זו מוגבלת ל-300 נכסים פעילים וממוינת
   מקודמים-קודם, כך שנכס ותיק שנכנס ליריד היה נופל ממנה בדיוק ביום שבו יש
   הרבה מלאי — והבאנר היה נעלם בזמן שהיריד פעיל.

   החלון נבדק בשאילתה עצמה ולא רק בדגל, מאותה סיבה שהוא נבדק ב-JS בכל שאר
   המקומות: ‏expire_open_house() רצה כל רבע שעה, ורבע שעה של פיגור היא רבע
   שעה שבה הבאנר מבטיח ללא עמלה על נכס שכבר יצא מהיריד.

   כישלון שאילתה (‏DB לא זמין) משאיר את הרצועה מוסתרת, כמו שהיא נולדה. */
async function loadOpenHouseCount(){
  if (!sb) return 0;
  try{
    const nowIso = new Date().toISOString();
    const { count, error } = await sb
      .from('properties')
      .select('id', { count:'exact', head:true })
      .eq('status', 'active')
      .eq('open_house', true)
      .lte('open_house_start', nowIso)
      .gt('open_house_end', nowIso);
    if (error) throw error;
    return count || 0;
  } catch(e){
    console.warn('ספירת נכסי יריד הבתים הפתוחים נכשלה:', e);
    return 0;
  }
}

/* הבאנר לפי המוקאפ: כהה עם מסגרת זהב, "0%" עם שעון עצר ובניין, והכותרת
   "יריד דירות ללא עמלת תיווך לזמן מוגבל!". בדסקטופ הוא רצועה אחת
   (כותרת · איור · הסבר · כפתור), ובטלפון כרטיס מרובע שבו ההסבר יורד —
   ראו ‎.oh-promo‎ ב-assets/open-house.css.

   ‏count עדיין קובע אם הבאנר קיים בכלל (אפס → hidden), אבל כבר לא נכתב
   בו: המוקאפ לא נושא מספר, והמספר מחכה בעמוד היריד עצמו. האיור הוא
   ‏OpenHouse.zeroArt() — אותו איור בראש דף היריד. */

function renderOpenHouseBanner(count){
  const host = document.getElementById('openHouseBanner');
  if (!host) return;
  if (!count){ host.hidden = true; host.innerHTML = ''; return; }

  host.innerHTML =
    `<a class="oh-promo" href="/open-house">` +
      `<h2 class="oh-promo-title">יריד דירות<br>ללא עמלת תיווך<br>לזמן מוגבל!</h2>` +
      OpenHouse.zeroArt('oh-promo-art') +
      `<span class="oh-promo-body">` +
        `<span class="oh-promo-kicker">אל תחמיצו את ההזדמנות!</span>` +
        // שני משפטים, שורה לכל אחד — ‏nowrap ב-CSS, כדי שמשפט לא יישבר
        // באמצעו בין שתי השורות
        `<span class="oh-promo-text">` +
          `<span>מגוון דירות אטרקטיביות ישירות ממתווכים, ללא דמי תיווך.</span>` +
          `<span>המבצע בתוקף לתקופה קצובה בלבד!</span>` +
        `</span>` +
      `</span>` +
      `<span class="oh-promo-cta">לצפייה בדירות ביריד</span>` +
    `</a>`;
  host.hidden = false;
}

(async function initOpenHouseBanner(){
  if (!document.getElementById('openHouseBanner')) return;
  renderOpenHouseBanner(await loadOpenHouseCount());
})();

/* ---------- תיבת הנכסים ----------
   **תצוגה אחת לכל המלאי** — פרטי ומסחרי, מכירה והשכרה — מיד מתחת
   למבזק: גריד לפי סדר ההעלאה, עד שני נכסים מקודמים בראש, שורת תגיות
   מובנות שנבנית מהמלאי עצמו, בורר מיון וכפתור "עוד נכסים".

   כאן ישבו עד כה **שני** מדפים — "נכסים פרטיים" ומתחתיו "נכסים מסחריים"
   — שהיו זהים בכל דבר חוץ מ-‎category‎ של המלאי שהוזן לכל אחד מהם. זו
   בדיוק הטעות שהם עצמם באו לתקן: הם החליפו שלושה מסלולי גלילה אופקיים
   (‎.featured-scroll‎) שרק ‎deal_type‎ הבדיל בין שניים מהם, וסוג העסקה חזר
   להיות תגית על הנכס במקום מבנה של העמוד — ואז הקטגוריה נשארה מבנה של
   העמוד. היום גם היא תגית (‏categoryTags: פרטי · מסחרי), והמלאי כולו
   בתיבה אחת (‏box) שנפתחת על שתי שורות (‏rows).

   כל ההיגיון יושב ב-assets/prop-shelf.js — ‏PropShelf.create() בונה את
   המדף לתוך המעטפת שנמסרת לו ומחזיר ‎set(list)‎: מי שקורא לה מביא את
   הנכסים. אותו קובץ מצייר גם את הנכסים בדף המשרד ובדף הסוכן/ת, ושם הם
   עדיין שני מדפים — המלאי של משרד אחד קטן, ושניהם נכנסים למסך ממילא. */
const propsShelf = PropShelf.create({
  mount:'allProps', titleId:'allPropsTitle', title:'נכסים בעפולה והעמק',
  info:'פרטי ומסחרי, מכירה והשכרה - כל המלאי מכל משרדי התיווך באזור, לפי סדר ההעלאה, ובראש שני נכסים מקודמים',
  // מסגרת אחת סביב הכול, ושתי שורות נכסים בפתיחה: זה מה שנשאר משתי
  // הסקציות שהתמזגו — תצוגה אחת שנקראת כתצוגה אחת, בלי לוותר על כמות
  // הנכסים שהן הציגו יחד.
  box:true, rows:2,
  categoryTags:true,
  // "דירה" מתפצלת לתגיות לפי מספר חדרים. ‏roomsLabel נכתב במפורש ולא
  // נגזר מ-roomsType — "דירה" + "ות" הוא "דירהות". במסחרי אין פיצול כזה
  // ממילא: "משרד 3 חדרים" הוא לא הנתון שמחפשים בו נכס מסחרי.
  roomsType:'דירה', roomsLabel:'דירות',
  // שני המלאים חולקים היום שורת תגיות אחת, ובתקרה של שמונה סוגי הנכס
  // המסחריים — המיעוט — נדחקו כולם אחרי תגיות החדרים ונחתכו.
  kindTagsMax:14,
  sortId:'ppSort',
  // באנר ההדמיות יושב בין הגריד לכפתור "עוד" — ראו showAiPromo()
  afterGrid:'aiPromo',
  countText: (shown, total) => (shown === total)
    ? `${total.toLocaleString('he-IL')} נכסים בעפולה והעמק - פרטיים ומסחריים`
    : `${shown.toLocaleString('he-IL')} מתוך ${total.toLocaleString('he-IL')} נכסים · מסומנים על המפה שלמעלה`,
  /* תגית שנבחרת כאן היא חיפוש לכל דבר, ולכן היא מגיעה גם למפה ולשורות
     התוצאות שמתחתיה. עד כה היא סיננה את הגריד הזה בלבד: מי שסינן/ה
     ל"דירות 3 חדרים" ראה/תה מעל זה מפה שעדיין מלאה בכל המלאי, ולא היה
     שום מקום שבו הסינון והמפה הסכימו ביניהם. ‏ppShelfToMap עושה את החיבור
     — ראו שם למה שחרור התגיות לא סתם מצייר את הכול מחדש. */
  onFilter: (items, filtered) => ppShelfToMap(items, filtered),
});

/* הסינון שבמדף → המפה ושורות התוצאות שמעליו.

   שחרור התגיות (‏filtered=false) לא מצייר את הרשימה המלאה כ"תוצאות חיפוש":
   הוא מחזיר את המפה למה שהיה לפניה. אם רץ חיפוש אמיתי (סרגל החיפוש או
   המסננים) — הוא מורץ שוב, כי הוא ולא המדף הוא מה שהמפה אמורה להראות.
   אחרת חוזרים לכל המלאי הפעיל, כלומר בדיוק מצב הטעינה של הדף.

   בכוונה בלי גלילה אל המפה: התגיות יושבות בתחתית העמוד, ולחיצה שמושכת את
   המסך למעלה הייתה מרחיקה את שורת התגיות עצמה — כלומר מענישה בדיוק את מי
   שרוצה לסמן תגית שנייה. מה שאומר שהמפה התעדכנה הוא שורת המונה שמעל
   הגריד ("מסומנים על המפה שלמעלה"), והיא כאן ממילא. */
let ppShelfFiltered = false;
async function ppShelfToMap(items, filtered){
  if (filtered){
    ppShelfFiltered = true;
    renderPropertyGrid(items, true);
    return;
  }
  if (!ppShelfFiltered) return;
  ppShelfFiltered = false;
  if (searchHasRun) await runSearch();
  else renderPropertyGrid(allActiveProperties);
}

/* ---------- שני מקורות, תיבה אחת ----------
   הנכסים הפרטיים מגיעים מהרשימה הראשית (אותה רשימה שמזינה את המפה ואת
   שורות התוצאות), והמסחריים משאילתה משלהם — הרשימה הראשית מוגבלת ל-300
   נכסים פעילים, והמסחריים הם מיעוט קטן בתוכה שהיה נחתך ממנה בדיוק כשיש
   הרבה מלאי למגורים.

   שתי הטעינות אינן מסונכרנות, ולכן כל אחת מהן מעדכנת את הצד שלה וקוראת
   ל-ppSync(): מי שמגיע/ה ראשון/ה מצייר/ת את מה שיש, והשני/ה מצטרף/ת.
   ‏null (ולא מערך ריק) הוא "עוד לא נטען" — הוא מבדיל בין מלאי שטרם הגיע
   לבין מלאי שהגיע וריק, ומונע הסתרה של התיבה בין שתי הטעינות. */
let ppPrivate = null, ppCommercial = null;
function ppSync(){
  if (ppPrivate === null && ppCommercial === null) return;
  propsShelf.set((ppPrivate || []).concat(ppCommercial || []));
  /* העוגן מנוסה בכל סנכרון עד שהוא תופס, ולא פעם אחת אחרי הטעינה
     הראשונה: ‏#allProps-commercial שמגיע בזמן שרק המלאי הפרטי נטען מחפש
     תגית שעוד לא נבנתה — ‏selectTag מחזירה אז false, וכשהמסחרי מגיע כבר
     אין מי שינסה שוב. שתי הטעינות אינן מסונכרנות, ולכן זה נפל פעם כן
     ופעם לא, תלוי מי הקדים. */
  if (!ppHashApplied) ppHashApplied = ppApplyHash();
}

function renderHomeProps(properties){
  // המסחריים מגיעים מהשאילתה הייעודית ולא מכאן: שני העותקים היו נכנסים
  // לגריד כשני אריחים של אותו נכס.
  ppPrivate = properties.filter(p => dealKind(p) !== 'commercial');
  ppSync();
}

/* ---------- עוגן עם תגית ----------
   הפוטר בכל דפי האתר מקשר ל"למכירה בעפולה", ל"להשכרה בעפולה"
   ול"נכסים מסחריים", ושלוש הכתובות האלה הובילו לתצוגות שהתאחדו. היום
   כולן מגיעות לאותה תיבה — עם התגית המתאימה כבר דלוקה — ולכן הן עדיין
   קישורים שונים ולא אותו עוגן שלוש פעמים.

   הגלילה נעשית כאן ולא בדפדפן: אין אלמנט שה-id שלו הוא ‎allProps-sale‎.
   העוגנים הישנים (‏#privateProps, ‏#commercialProps ומה שאחריהם) נשארים
   במפה כי הם מפוזרים בסימניות, בקישורים חיצוניים ובכל דף שטרם עודכן —
   עוגן שהפסיק לעבוד אינו קישור. */
const PP_HASH_TAGS = {
  'allProps':              '',
  'allProps-sale':         'sale',
  'allProps-rent':         'rent',
  'allProps-private':      'cat:private',
  'allProps-commercial':   'cat:commercial',
  // עוגנים משתי הסקציות שהתאחדו
  'privateProps':          '',
  'privateProps-sale':     'sale',
  'privateProps-rent':     'rent',
  'commercialProps':       'cat:commercial',
};
let ppHashApplied = false;
/* מחזירה האם העוגן טופל — זה מה שאומר ל-ppSync() אם יש טעם לנסות שוב
   בסנכרון הבא. */
function ppApplyHash(){
  const key = (window.location.hash || '').replace(/^#/, '');
  if (!Object.prototype.hasOwnProperty.call(PP_HASH_TAGS, key)) return false;
  if (!propsShelf.selectTag(PP_HASH_TAGS[key])) return false;
  document.getElementById('allProps')?.scrollIntoView({ behavior:'smooth', block:'start' });
  return true;
}
window.addEventListener('hashchange', ppApplyHash);

/* ---------- כתבות ובלוגים ---------- */
const FALLBACK_ARTICLES = [
  {title:'מדריך: כמה הון עצמי באמת צריך לדירה ראשונה בעפולה', kicker:'מדריכים', excerpt:'הכללים של בנק ישראל, העלויות הנלוות שאף אחד לא מספר עליהן, ואיך מחשבים נכון.'},
  {title:'שכונת גבעת המורה - לאן הולכים המחירים ב-2026', kicker:'ניתוח שוק', excerpt:'שלוש שנים של עסקאות, פרויקטים בבנייה והשפעת הרכבת על הביקוש.'},
  {title:'בלעדיות מול פרסום פתוח: מה באמת משתלם למוכרים', kicker:'בלוג המתווכים', excerpt:'מה אומרים הנתונים על זמן מכירה ועל הפער בין מחיר מבוקש למחיר בפועל.'},
  {title:'חמישה דברים לבדוק לפני שחותמים על חוזה שכירות', kicker:'שוכרים', excerpt:'ערבויות, תיקונים, מדד וצמדות - הסעיפים ששווה לקרוא פעמיים.'},
];

/* כותרות ותקצירים נכתבים בעורך של ה-CRM ונכנסים כאן ל-innerHTML —
   גרשיים בכותרת ("דירת 4 חד׳") הם המקרה השכיח, הזרקה היא המקרה שאסור. */
/* שם מקומי היסטורי ל-escapeHtml שב-assets/esc.js. */
function escapeArticleText(s){ return escapeHtml(s); }

async function loadArticles(){
  if (!sb) return FALLBACK_ARTICLES;

  // 1. המגזין של הפלטפורמה — כתבות שנכתבו ב-CRM. זה המקור המועדף, והוא
  //    היחיד שיש לו עמוד משלו באתר (article.html).
  try{
    const { data, error } = await sb
      .from('articles_public')
      .select('id, slug, title, subtitle, category, cover_url, published_at')
      .order('published_at', { ascending:false })
      .limit(8);
    if (error) throw error;
    if (data && data.length){
      return data.map(a => ({
        title: a.title || 'כתבה',
        kicker: a.category || 'מגזין שוק נדל״ן',
        excerpt: a.subtitle || '',
        url: '/article?slug=' + encodeURIComponent(a.slug || a.id),
        image: a.cover_url || '',
        published_at: a.published_at,
        internal: true,
      }));
    }
  } catch(e){
    // טבלה שטרם נוצרה בסביבה הזו (42P01) היא לא שגיאה שהגולש צריך לראות —
    // ממשיכים למקור הבא.
    console.warn('טעינת כתבות המגזין נכשלה:', e);
  }

  // 2. מבזק החדשות החיצוני, אם קיים בסביבה הזו. אותו מקור שמזין את רצועת
  //    ה"מבזק" — הקריאה עוברת ב-view הציבורי, בלי הכתובת הגולמית ובלי
  //    שדות התחקור של המנוע.
  try{
    const { data, error } = await sb
      .from('news_items_public')
      .select('headline, summary, url, image_url, category, source_name, published_at')
      .order('published_at', { ascending:false })
      .limit(8);
    if (error || !data || data.length === 0) throw error || new Error('empty');
    return data.map(n => ({
      title: n.headline || 'כתבה',
      kicker: n.category || n.source_name || 'חדשות הנדל״ן',
      excerpt: n.summary || '',
      // המבזק נאסף ממקורות חיצוניים, והכתובת נכנסת ישירות ל-href של הכרטיס
      url: safeExternalUrl(n.url || ''),
      image: n.image_url || '',
      published_at: n.published_at,
    }));
  } catch(e){
    console.warn('טעינת כתבות נכשלה, משתמש בנתוני fallback:', e);
    return FALLBACK_ARTICLES;
  }
}

(async function initArticles(){
  const el = document.getElementById('articlesScroll');
  if (!el) return;
  // המעטפת נקשרת לפני הטעינה, והמדידה נעשית אחריה: הכרטיסים מגיעים
  // מהמסד, וברגע הקשירה השורה עדיין ריקה — כלומר "אין לאן לגלול".
  const refreshScroll = bindRowScroller(el);
  const articles = await loadArticles();
  articles.forEach((a, i)=>{
    const card = document.createElement(a.url ? 'a' : 'article');
    card.className = 'article-card';
    if (a.url){
      card.href = a.url;
      // כתבה של המגזין נפתחת באותה לשונית — היא חלק מהאתר. קישור חיצוני
      // (מבזק) ממשיך להיפתח בלשונית חדשה כדי לא לגרור את הגולש החוצה.
      if (!a.internal){ card.target = '_blank'; card.rel = 'noopener'; }
    }
    const cover = a.image
      ? `background-image:url('${encodeURI(a.image).replace(/'/g, '%27')}')`
      : `background:${CARD_GRADIENTS[i % CARD_GRADIENTS.length]}`;
    const stamp = a.published_at
      ? new Date(a.published_at).toLocaleDateString('he-IL', { day:'numeric', month:'long', year:'numeric' })
      : 'מגזין שוק נדל״ן';
    card.innerHTML = `
      <div class="cover" style="${cover}"></div>
      <div class="body">
        <span class="kicker">${escapeArticleText(a.kicker)}</span>
        <h3>${escapeArticleText(a.title)}</h3>
        ${a.excerpt ? `<p>${escapeArticleText(a.excerpt)}</p>` : ''}
        <span class="stamp">${escapeArticleText(stamp)}</span>
      </div>`;
    el.appendChild(card);
  });
  refreshScroll();
})();


/* קישורי תמונה שמגיעים מטופס הרשמה פתוח נכנסים ישירות ל-href/src, ולכן
   מסוננים לפרוטוקול בטוח בלבד: ‎javascript:‎ בשדה הקישור היה הופך לכתובת
   שהכרטיס כולו מפעיל בלחיצה. */
function safeExternalUrl(u){
  if (!u) return '';
  try{
    const url = new URL(String(u), location.href);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch(e){ return ''; }
}
const TYPE_LABELS = {
  mortgage_advisor:'יועץ/ת משכנתאות', appraiser:'שמאי/ת מקרקעין', architect:'אדריכל/ית',
  interior_designer:'מעצב/ת פנים', real_estate_lawyer:'עו״ד מקרקעין', general:'בעל/ת מקצוע',
};

/* ‏professional_cards_public הוא ה-view הציבורי: הוא כבר מסנן לכרטיסיות
   פעילות שבתוך חלון הפרסום (status לבדו לא מספיק — כרטיסייה שתקופתה
   הסתיימה נשארת active בטבלה), והוא לא כולל את כתובת החיוב של המפרסם.
   מוחזרות רק הכרטיסיות החיות: אין כאן נפילה ל"מקומות פנויים", כי לשונית
   של אנשים אמיתיים לא מציגה מצייני מקום כאילו הם נרשמו. */
const professionalsReady = (async function loadProfessionals(){
  try{
    if (!sb) return [];
    const { data, error } = await sb
      .from('professional_cards_public')
      .select('id, slug, advertiser_name, business_name, advertiser_type, target_region, creative_url, cover_url, click_url')
      .limit(50);
    if (error) throw error;
    return data || [];
  } catch(e){
    console.warn('טעינת בעלי מקצוע נכשלה:', e);
    return [];
  }
})();

/* ============================================================
   באנר "בואו להתייעץ עם מומחה אמיתי"
   ------------------------------------------------------------
   בעלי המקצוע יצאו מסקציית האנשים (שם ישבו כלשונית שלישית) לבאנר משלהם,
   באותה שפה של באנר היריד (‏.oh-promo ב-assets/open-house.css), שמוביל
   ל-/professionals — שם מסננים לפי תחום ואזור ופונים ישירות.

   שני כללים, שניהם מאותו מקום של באנר היריד:
     1. אין אף בעל/ת מקצוע פעיל/ה → הבאנר נשאר hidden.
     2. רשימת התחומים נגזרת ממי שקיים/ת בפועל, ולא מרשימה קבועה: "עורכי
        דין" בבאנר כשאין אף אחד היה נשבר בדיוק בדף שאליו הוא שולח.
   כל הטקסט כאן מקבועים בקובץ — שום ערך מהמסד לא נכנס ל-innerHTML.
   ============================================================ */
/* שמות קצרים בכוונה: השורה היא ‎nowrap‎ (משפט לא נשבר), ו"עורכי דין
   למקרקעין" לצד שני תחומים נוספים דחף אותה אל הכפתור. */
const EXPERT_PLURAL = {
  appraiser:'שמאים', real_estate_lawyer:'עורכי דין', architect:'אדריכלים',
  mortgage_advisor:'יועצי משכנתאות', interior_designer:'מעצבי פנים',
};
/* הסדר כאן הוא סדר ההצגה: קודם מה שהכי קרוב לעסקה עצמה */
const EXPERT_ORDER = ['appraiser', 'real_estate_lawyer', 'architect', 'mortgage_advisor', 'interior_designer'];

/* איש/אשה עם בועת שיחה ו-✓ — "מומחה שמדברים איתו", בזהב של באנר היריד.
   ‏SVG מוטבע כמו ‎OpenHouse.zeroArt()‎, עם מזהה גרדיאנט משלו. */
function expertArt(){
  const gold = 'url(#exGold)';
  return `<svg class="oh-promo-art" viewBox="0 0 170 104" aria-hidden="true" focusable="false">` +
    `<defs><linearGradient id="exGold" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#fbe7a1"/><stop offset=".45" stop-color="#e0b54a"/>` +
      `<stop offset=".75" stop-color="#b8862a"/><stop offset="1" stop-color="#f1d27a"/>` +
    `</linearGradient></defs>` +
    // האיש/ה: ראש וכתפיים, ועניבה כהה
    `<circle cx="48" cy="34" r="18" fill="${gold}"/>` +
    `<path d="M14 102c0-22 15-38 34-38s34 16 34 38z" fill="${gold}"/>` +
    `<path d="M48 66l-6 9 6 22 6-22z" fill="#0f1a3d"/>` +
    // בועת השיחה עם ‎✓‎
    `<path d="M96 8h56a12 12 0 0 1 12 12v30a12 12 0 0 1-12 12h-30l-16 14 3-14h-13a12 12 0 0 1-12-12V20a12 12 0 0 1 12-12z" ` +
      `fill="none" stroke="${gold}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="M112 35l9 9 19-19" fill="none" stroke="${gold}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;
}

async function renderExpertBanner(){
  const host = document.getElementById('expertBanner');
  if (!host) return;
  const pros = await professionalsReady;
  if (!pros.length){ host.hidden = true; return; }

  const present = new Set(pros.map(p => p.advertiser_type));
  const fields = EXPERT_ORDER.filter(t => present.has(t)).map(t => EXPERT_PLURAL[t]);
  // "שמאים, עורכי דין ואדריכלים מהאזור - במקום אחד." — ומעל שלושה תחומים
  // "שמאים, עורכי דין, אדריכלים ועוד מהאזור."
  const shown = fields.slice(0, 3);
  let line;
  if (fields.length > 3) line = shown.join(', ') + ' ועוד מהאזור.';
  else {
    const list = shown.length > 1
      ? shown.slice(0, -1).join(', ') + ' ו' + shown[shown.length - 1]
      : (shown[0] || 'בעלי מקצוע');
    line = list + ' מהאזור - במקום אחד.';
  }

  host.innerHTML =
    `<a class="oh-promo is-expert" href="/professionals">` +
      `<h2 class="oh-promo-title">בואו להתייעץ<br>עם מומחה אמיתי</h2>` +
      expertArt() +
      `<span class="oh-promo-body">` +
        `<span class="oh-promo-kicker">לפני שחותמים על עסקה</span>` +
        `<span class="oh-promo-text">` +
          `<span>${line}</span>` +
          `<span>מצאו את המומחה שלכם וצרו קשר להתייעצות אישית.</span>` +
        `</span>` +
      `</span>` +
      `<span class="oh-promo-cta">למציאת מומחה ←</span>` +
    `</a>`;
  host.hidden = false;
}
renderExpertBanner();

/* ============================================================
   האנשים מאחורי העסקאות
   ------------------------------------------------------------
   סקציה אחת שהחליפה את קרוסלת משרדי התיווך ואת באנר "איזה משרד תיווך
   מתאים לכם" שישב מתחתיה: שלוש לשוניות (משרדים, מתווכים, בעלי מקצוע)
   על שורת כרטיסים אחת, ובראשה תיבת חיפוש שמוצמדת לימין ומסננת בתוך
   הלשונית הפעילה.

   שלושת המקורות כבר נטענים בעמוד בשביל רצועות אחרות, והסקציה חיה על
   אותם Promise-ים בדיוק (agenciesReady / agentsReady / professionalsReady)
   ולא על שאילתות משלה: שתי שאילתות לאותם נתונים היו מסתכנות בשתי תשובות
   שונות באותו עמוד. לכן גם המעבר בין הלשוניות והסינון הם מקומיים לגמרי,
   בלי פנייה לשרת בכל הקלדה — בדיוק כפי שהיה במאתר המשרדים שהוחלף.
   ============================================================ */
const DM_TABS = {
  agencies: {
    placeholder:'שם משרד או שכונה…',
    href:'/agencies',
    // "צפייה בכל 14 משרדי התיווך" — המספר הוא כל המשרדים, לא רק מה שבגריד
    seeAll: n => `צפייה בכל ${n} משרדי התיווך ←`,
    cta:'פרופיל משרד ונכסים ←',
    empty:'לא נמצא משרד שמתאים לחיפוש. נסו שם אחר או נקו את התיבה.',
    quick:{ label:'התמחות', all:'כל ההתמחויות',
            empty:'אין משרד עם נכסים פעילים בהתמחות הזו. בחרו התמחות אחרת.' },
  },
  agents: {
    placeholder:'שם מתווך/ת או משרד…',
    href:'/agents',
    seeAll: n => `צפייה בכל ${n} המתווכים ←`,
    cta:'לפרופיל ולנכסים ←',
    empty:'לא נמצא מתווך/ת שמתאים לחיפוש. נסו שם אחר או נקו את התיבה.',
    quick:{ label:'התמחות', all:'כל ההתמחויות',
            empty:'אין מתווך/ת עם נכסים פעילים בהתמחות הזו. בחרו התמחות אחרת.' },
  },
};

/* שלושת סוגי הרשומות נורמלו לאותו כרטיס פרופיל: תמונת נושא, לוגו או
   תמונה צפה, שם, תגיות, צוות, דירוג ושני כפתורים. כך המסלול הוא markup
   אחד ולא שלושה, והלשוניות באמת מחליפות רק נתונים. ‏search הוא הטקסט
   שהחיפוש רץ עליו.

   כל שדה כאן נשען על נתון אמיתי, ובלעדיו החלק פשוט לא מוצג: תג "#1
   בדירוג" לשלושת המובילים בדירוג בלבד (אין לנו סימון "מומלץ" עריכתי),
   שורת צוות רק כשיש מתווכים פעילים, וכפתור וואטסאפ רק כשיש מספר. */
const dmCount = n => n === 1 ? 'נכס פעיל אחד' : `${n} נכסים פעילים`;

function dmFromAgency(a, i, team){
  const name = a.name || 'משרד תיווך';
  const areas = a.areas || [];
  const specs = AGENCY_SPECS.filter(sp => sp.key !== 'all' && (a.specs || []).includes(sp.key)).map(sp => sp.label);
  return {
    name, kind:'agency',
    href: a.slug ? '/agency?slug=' + encodeURIComponent(a.slug) : null,
    cover: a.cover_url,
    photo: a.logo_url, contain: true,
    initial: name.trim()[0] || 'מ',
    tags: areas,
    countNum: a.active_properties_count || 0,
    rating: a.rating, reviews: a.reviews_count,
    // התג הוא סימן דירוג ולא מספר סידורי, ולכן הוא שמור לשלושה המדורגים
    // הראשונים בלבד; לשאר האריחים אין תג
    rank: (i < 3 && a.score !== null) ? i + 1 : 0,
    verified: !!(a.ethics_code_accepted_at && !a.ethics_badge_revoked_at),
    team: team || [],
    wa: a.wa_phone || null,
    waText: `היי, הגעתי אל ${name} דרך שוק הנדל״ן של עפולה והסביבה ואשמח לקבל פרטים.`,
    specs: a.specs || [],
    search: [name, ...areas, ...specs].join(' '),
  };
}

function dmFromAgent(m, i){
  const name = m.display_name || 'מתווך/ת';
  return {
    name, kind:'agent',
    href: (m.slug || m.id) ? '/agent?slug=' + encodeURIComponent(m.slug || m.id) : null,
    // תמונת הנושא של המתווך/ת, ואם אין — של המשרד, כמו בראש agent.html
    cover: m.cover_url || m.agency_cover,
    photo: m.photo_url, contain: false, photoPos: m.photo_position, person: true,
    initial: name.trim()[0] || 'מ',
    tags: m.agency_name ? [m.agency_name] : [],
    countNum: m.active_properties_count || 0,
    rating: m.rating, reviews: m.reviews_count,
    rank: (i < 3 && m.rating !== null) ? i + 1 : 0,
    verified: !!m.has_ethics_badge,
    team: [],
    wa: DM_PHONE_RE.test(String(m.phone_e164 || '')) ? m.phone_e164 : null,
    waText: `היי ${name}, הגעתי אלייך דרך שוק הנדל״ן של עפולה והסביבה ואשמח לקבל פרטים.`,
    specs: m.specs || [],
    search: [name, m.agency_name].join(' '),
  };
}

/* ---------- גלילת שורה אופקית ----------
   אחד לשתי הרצועות של הדף — מסלול האנשים וקרוסלת הכתבות. אותו מנגנון של
   שורת התגיות במדף הנכסים (‏bindTagsScroller ב-assets/prop-shelf.js), על
   אותם ‎data-can-start/‎data-can-end: החצים והדהייה נדלקים רק כשיש באמת
   לאן לגלול.

   ‏refresh מוחזר לקורא כי התוכן מתחלף אחרי האתחול — לשונית, חיפוש ובורר
   בסקציית האנשים, וטעינת הכתבות מהמסד בקרוסלה. מצב הגלילה אחרי החלפה
   אינו מה שהיה לפניה, ובלי הקריאה הזאת החץ של המצב הקודם היה נשאר על
   המסך בתוכן שכולו נכנס בו. */
function bindRowScroller(row){
  const wrap = row.closest('.row-scroller');
  if (!wrap) return ()=>{};

  // ב-RTL הדפדפנים מודדים ‎scrollLeft‎ כשלילי ככל שגוללים אל הקצה.
  // ‏sign הופך את שני המקרים למרחק *מההתחלה*, שהוא מה שנמדד כאן.
  const sign = getComputedStyle(row).direction === 'rtl' ? -1 : 1;
  const pos = ()=> row.scrollLeft * sign;
  const max = ()=> row.scrollWidth - row.clientWidth;

  function refresh(){
    const overflow = max() > 1;
    wrap.toggleAttribute('data-can-start', overflow && pos() > 1);
    wrap.toggleAttribute('data-can-end', overflow && pos() < max() - 1);
    // ‏hidden ולא רק CSS: כפתור שאין לאן לגלול איתו לא צריך להיות ב-DOM
    // הנגיש. הוא ממילא ‎tabindex="-1"‎ — הגלילה אינה תחנת מקלדת, והאריחים
    // עצמם (קישורים) כן.
    wrap.querySelector('.row-prev').hidden = !wrap.hasAttribute('data-can-start');
    wrap.querySelector('.row-next').hidden = !wrap.hasAttribute('data-can-end');
  }

  wrap.querySelectorAll('.row-nav').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      // כ-‎80%‎ מהרוחב הנראה: מספיק כדי להתקדם, ומעט מכדי לדלג על כרטיס.
      // מסלול שמסומן ‎data-page="full"‎ (סקציית האנשים) מדפדף עמוד שלם —
      // רוחב המסך ועוד המרווח — כך שכל לחיצה מביאה ארבעה משרדים חדשים
      // בדיוק ולא שלושה וחצי.
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const step = row.dataset.page === 'full'
        ? row.clientWidth + gap
        : Math.max(row.clientWidth * 0.8, 200);
      row.scrollBy({ left: sign * step * (btn.dataset.rowDir === 'end' ? 1 : -1), behavior:'smooth' });
    });
  });

  row.addEventListener('scroll', refresh, { passive:true });
  window.addEventListener('resize', refresh);
  // רוחב המסלול משתנה גם בלי ‎resize‎ של החלון — גופן שנטען ומזיז את
  // הלשוניות, גלגלת אנכית שמופיעה, מעבר בין שתי העמודות ל-760px
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(row);

  refresh();
  return refresh;
}

(async function initDealmakers(){
  const section = document.getElementById('dealmakers');
  const row = document.getElementById('dmRow');
  if (!section || !row) return;

  // בעלי המקצוע יצאו מכאן לבאנר משלהם (‏renderExpertBanner)
  const [agencies, agents] = await Promise.all([agenciesReady, agentsReady]);
  // הצוות של כל משרד — מאותה רשימת מתווכים שמזינה את לשונית המתווכים,
  // ולא משאילתה נוספת. המדורגים ראשונים, כך שהפנים בשורה הן של המובילים.
  const teamByAgency = new Map();
  agents.forEach(m => {
    if (!m.agency_id) return;
    if (!teamByAgency.has(m.agency_id)) teamByAgency.set(m.agency_id, []);
    teamByAgency.get(m.agency_id).push(m);
  });
  const data = {
    agencies: agencies.map((a, i)=> dmFromAgency(a, i, teamByAgency.get(a.id))),
    agents: agents.map((m, i)=> dmFromAgent(m, i)),
  };

  // אותה רשימה מזינה גם את מונה המשרדים שב-hero
  heroStatsState.agencies = agencies.length;
  renderHeroStats();

  // אין אף אחד להציג בשום לשונית — הסקציה יורדת, בדיוק כמו שהקרוסלה
  // שקדמה לה ירדה כשהרשימה חזרה ריקה
  if (!agencies.length && !agents.length){
    section.style.display = 'none';
    return;
  }

  const refreshScroll = bindRowScroller(row);
  const tabs = [...section.querySelectorAll('.dm-tabs button')];
  const searchEl = document.getElementById('dmSearch');
  const quickEl = document.getElementById('dmQuick');
  const specEl = document.getElementById('dmSpec');
  const state = { tab:'agencies', query:'', spec:'all' };

  // המונה שעל כל לשונית נספר מול כל הרשימה ולא מול החיפוש הפעיל: הוא
  // אומר כמה יש בפלטפורמה, וזה לא משתנה תוך כדי הקלדה
  tabs.forEach(btn=>{
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = data[btn.dataset.tab].length;
    btn.append(' ', n);
    // לשונית ריקה מנוטרלת במקום להוביל למסך ריק
    btn.disabled = data[btn.dataset.tab].length === 0;
  });

  /* ---------- כרטיס הפרופיל ----------
     שמות, שמות משרדים וכתובות תמונה מגיעים מקלט של משרדים, סוכנים
     ומפרסמים — ולכן הטקסט נכנס דרך ‎textContent‎, וכתובות התמונה עוברות
     סינון פרוטוקול (‏safeExternalUrl) לפני שהן נוגעות ב-src. מספר הוואטסאפ
     עבר את DM_PHONE_RE כבר בנרמול. */
  const mk = (tag, cls, text)=>{
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const WA_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.03c-.25.69-1.44 1.32-2 1.36-.51.04-1 .24-3.37-.7-2.84-1.12-4.63-4.03-4.77-4.22-.14-.19-1.14-1.52-1.14-2.9s.72-2.06.98-2.34c.25-.28.55-.35.74-.35l.53.01c.17.01.4-.06.62.48.24.56.8 1.94.87 2.08.07.14.12.3.02.49-.09.19-.14.3-.28.46-.14.16-.29.36-.42.49-.14.14-.28.29-.12.57.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07.16-.19.7-.81.88-1.09.19-.28.37-.23.62-.14.25.09 1.62.76 1.9.9.28.14.46.21.53.33.07.12.07.69-.18 1.38z"/></svg>';

  function card(item){
    const el = mk('article', 'dm-item');

    // תמונת הנושא. היא קישור לפרופיל גם היא (לשם לוחצים), אבל מחוץ לסדר
    // הטאב ולעץ הנגישות — הקישור "האמיתי" הוא השם והכפתור.
    const cover = mk(item.href ? 'a' : 'div', 'dm-cover');
    if (item.href){ cover.href = item.href; cover.tabIndex = -1; cover.setAttribute('aria-hidden', 'true'); }
    const coverUrl = safeExternalUrl(item.cover);
    const logoUrl = safeExternalUrl(item.photo);
    // אין תמונת נושא → הלוגו (או תמונת הפרופיל) עצמו, מטושטש ומוגדל, על
    // גרדיאנט המותג. כך גם מי שלא העלה/תה תמונת נושא מקבל/ת ראש בצבעים
    // שלו/ה ולא רצועה אחידה.
    const bgUrl = coverUrl || logoUrl;
    if (bgUrl){
      const img = mk('img', coverUrl ? '' : 'is-blur');
      img.src = bgUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      img.addEventListener('error', ()=> img.remove());
      cover.appendChild(img);
    }
    if (item.rank) cover.appendChild(mk('span', 'dm-flag is-rank', `★ #${item.rank} בדירוג`));
    if (item.countNum > 0) cover.appendChild(mk('span', 'dm-flag is-count', dmCount(item.countNum)));
    el.appendChild(cover);

    // הלוגו (או תמונת הפרופיל) שצף על קו התפר
    const face = mk('div', 'dm-face' + (item.person ? ' is-person' : ''));
    face.appendChild(mk('span', 'dm-initial', item.initial));
    if (logoUrl){
      const img = mk('img', item.contain ? 'is-logo' : '');
      img.src = logoUrl; img.alt = item.contain ? 'הלוגו של ' + item.name : item.name;
      img.loading = 'lazy'; img.decoding = 'async';
      if (item.photoPos && /^\d{1,3}% \d{1,3}%$/.test(item.photoPos)) img.style.setProperty('--photo-pos', item.photoPos);
      img.addEventListener('error', ()=> img.remove());
      face.appendChild(img);
    }
    el.appendChild(face);

    const info = mk('div', 'dm-info');

    const name = mk('h3', 'dm-name');
    const nameLink = mk(item.href ? 'a' : 'span', '', item.name);
    if (item.href) nameLink.href = item.href;
    name.appendChild(nameLink);
    if (item.verified){
      const v = mk('img', 'dm-verified');
      v.src = 'assets/badge-ethics.png'; v.width = 40; v.height = 40; v.loading = 'lazy';
      v.alt = 'עומד בתקן האתי';
      v.title = 'עומד בתקן האתי של שוק הנדל״ן של עפולה';
      name.appendChild(v);
    }
    info.appendChild(name);

    // אזורי פעילות: שניים הראשונים, והשאר כ"+N"
    if (item.tags.length){
      const tags = mk('div', 'dm-tags');
      item.tags.slice(0, 2).forEach(t => tags.appendChild(mk('span', 'dm-tag', t)));
      if (item.tags.length > 2){
        const more = mk('span', 'dm-tag is-more', '+' + (item.tags.length - 2));
        more.title = item.tags.slice(2).join(' · ');
        tags.appendChild(more);
      }
      info.appendChild(tags);
    }

    // הצוות — "האנשים מאחורי העסקאות" בכרטיס המשרד עצמו
    if (item.team.length){
      const team = mk('div', 'dm-team');
      const faces = mk('span', 'dm-faces');
      faces.setAttribute('aria-hidden', 'true');
      item.team.slice(0, 4).forEach(m => {
        const f = mk('span');
        const url = safeExternalUrl(m.photo_url);
        if (url){
          const img = mk('img');
          img.src = url; img.alt = ''; img.loading = 'lazy';
          img.addEventListener('error', ()=>{ img.remove(); f.textContent = (m.display_name || '?').trim()[0]; });
          f.appendChild(img);
        } else {
          f.textContent = (m.display_name || '?').trim()[0];
        }
        faces.appendChild(f);
      });
      team.appendChild(faces);
      const n = item.team.length;
      team.appendChild(mk('span', '', n === 1 ? 'מתווך/ת אחד/ת בצוות' : `צוות של ${n} מתווכים`));
      info.appendChild(team);
    }

    // דירוג: כוכב, ציון ומספר חוות הדעת. מי שאין לו ביקורות לא מקבל
    // "0 כוכבים" — הוא מקבל "עדיין אין ביקורות", כדי שהכרטיסים יישארו
    // באותו גובה. בעלי מקצוע אינם מדורגים, ואצלם השורה לא נכתבת.
    if (item.rating !== undefined){
      if (item.rating !== null){
        const rate = mk('div', 'dm-rate');
        rate.appendChild(mk('span', 'star', '★'));
        rate.appendChild(mk('b', '', item.rating.toFixed(1).replace(/\.0$/, '')));
        rate.appendChild(mk('span', '', item.reviews === 1 ? '(חוות דעת אחת)' : `(${item.reviews} חוות דעת)`));
        info.appendChild(rate);
      } else {
        info.appendChild(mk('div', 'dm-rate is-new', 'עדיין אין ביקורות'));
      }
    }

    const actions = mk('div', 'dm-actions');
    if (item.href){
      const go = mk('a', 'dm-go', DM_TABS[state.tab].cta);
      go.href = item.href;
      actions.appendChild(go);
    }
    if (item.wa){
      // קישור קשר למתווך/ת או למשרד — ‏contact_agent, בלי סימון (ראו
      // CLAUDE.md, "וכל קישור קשר בדף נמדד חייב להיות מסווג")
      const wa = mk('a', 'dm-wa');
      wa.href = 'https://wa.me/' + item.wa + '?text=' + encodeURIComponent(item.waText);
      wa.target = '_blank'; wa.rel = 'noopener noreferrer';
      wa.setAttribute('aria-label', 'וואטסאפ ל' + item.name);
      wa.innerHTML = WA_ICON;
      actions.appendChild(wa);
    }
    if (actions.childNodes.length) info.appendChild(actions);

    el.appendChild(info);
    return el;
  }

  /* ---------- כמה כרטיסים מוצגים ----------
     כולם, בשורה אחת שמדפדפים בה בחצים (ובטלפון גם בהחלקה). מ-760px
     שלושה במסך ומ-1100px ארבעה — זה ב-CSS; כאן רק שאלת הנקודות, שמוצגות
     בטלפון בלבד. */
  const dmMqGrid = window.matchMedia('(min-width:760px)');
  const dmMqWide = window.matchMedia('(min-width:1100px)');
  const dmLimit = ()=> Infinity;

  /* שתי שורות מ-760px, בעמודים של (טורים × 2) — השורה העליונה מתמלאת
     לפני התחתונה בכל עמוד. בטלפון (שורה אחת) הסגנון המוטבע מנוקה. */
  function dmPlace(){
    const items = [...row.querySelectorAll('.dm-item')];
    if (!dmMqGrid.matches){
      items.forEach(el => { el.style.gridColumn = ''; el.style.gridRow = ''; });
      return;
    }
    const cols = dmMqWide.matches ? 4 : 3;
    const perPage = cols * 2;
    // מעט פריטים (עד טור אחד מלא) — שורה אחת, בלי חורים בשורה התחתונה
    const rows = items.length > cols ? 2 : 1;
    row.classList.toggle('is-one-row', rows === 1);
    items.forEach((el, j) => {
      if (rows === 1){ el.style.gridColumn = String(j + 1); el.style.gridRow = '1'; return; }
      const page = Math.floor(j / perPage), i = j % perPage;
      el.style.gridColumn = String(page * cols + (i % cols) + 1);
      el.style.gridRow = String(Math.floor(i / cols) + 1);
    });
  }

  /* ---------- נקודות הקרוסלה ----------
     נקודה לכל כרטיס, והפעילה נמתחת — עד DM_MAX_DOTS; מעבר לזה (‏19
     מתווכים) הנקודות הן מפה יחסית של המיקום ולא כרטיס-כרטיס, אחרת השורה
     רחבה מהמסך. המיקום נגזר מהגלילה עצמה, ולכן הוא נכון גם אחרי החלקה, חץ
     או מקלדת. ב-RTL ‏scrollLeft שלילי — ‏Math.abs. */
  const DM_MAX_DOTS = 10;
  const dotsEl = document.getElementById('dmDots');
  let dotsCount = 0;
  function paintDots(){
    if (!dotsEl || dmMqGrid.matches || !dotsEl.children.length) return;
    const first = row.querySelector('.dm-item');
    const step = first ? first.getBoundingClientRect().width + 14 : 1;
    const idx = Math.min(dotsCount - 1, Math.round(Math.abs(row.scrollLeft) / step));
    const n = dotsEl.children.length;
    const on = dotsCount > n ? Math.round(idx * (n - 1) / (dotsCount - 1)) : idx;
    [...dotsEl.children].forEach((d, i)=> d.classList.toggle('is-on', i === on));
  }
  function buildDots(count){
    if (!dotsEl) return;
    dotsEl.innerHTML = '';
    dotsCount = count;
    if (dmMqGrid.matches || count < 2) return;
    for (let i = 0; i < Math.min(count, DM_MAX_DOTS); i++) dotsEl.appendChild(document.createElement('span'));
    paintDots();
  }
  row.addEventListener('scroll', ()=> requestAnimationFrame(paintDots), { passive:true });

  /* הבורר המהיר נבנה מהמלאי של הלשונית עצמה: התמחות שאין בה אף אחד לא
     מוצעת מלכתחילה, כדי שבחירה מתוך הרשימה תמיד תחזיר תוצאות. */
  function fillQuick(){
    const conf = DM_TABS[state.tab];
    quickEl.classList.toggle('is-empty', !conf.quick);
    specEl.disabled = !conf.quick;
    specEl.innerHTML = '';
    if (!conf.quick) return;

    document.querySelector('.dm-quick-label').textContent = conf.quick.label;
    specEl.setAttribute('aria-label', 'סינון מהיר לפי ' + conf.quick.label);
    const opts = [{ key:'all', label:conf.quick.all }].concat(
      AGENCY_SPECS
        .filter(sp => sp.key !== 'all' && data[state.tab].some(it => it.specs.includes(sp.key)))
        .map(sp => ({ key:sp.key, label:sp.label })));
    opts.forEach(o=>{
      const opt = document.createElement('option');
      opt.value = o.key;
      opt.textContent = o.label;
      specEl.appendChild(opt);
    });
    specEl.value = state.spec;
  }

  function render(){
    const conf = DM_TABS[state.tab];
    const q = state.query.trim().toLowerCase();
    const list = data[state.tab].filter(it =>
      (!q || it.search.toLowerCase().includes(q)) &&
      (state.spec === 'all' || it.specs.includes(state.spec)));

    row.innerHTML = '';
    // ריק → ההודעה ברוחב מלא ולא בטור אחד של הגריד
    row.classList.toggle('is-empty', !list.length);
    if (!list.length){
      const empty = document.createElement('p');
      empty.className = 'dm-empty';
      // כשמסננים לפי התמחות והחיפוש ריק, ההסבר "נסו שם אחר" מפספס את
      // הסיבה האמיתית שהשורה ריקה
      empty.textContent = (!q && state.spec !== 'all' && conf.quick) ? conf.quick.empty : conf.empty;
      row.appendChild(empty);
    } else {
      list.slice(0, dmLimit()).forEach(it => row.appendChild(card(it)));
      dmPlace();
    }
    buildDots(list.length ? Math.min(list.length, dmLimit()) : 0);

    searchEl.placeholder = conf.placeholder;
    const seeAll = document.getElementById('dmSeeAll');
    seeAll.href = conf.href;
    seeAll.textContent = conf.seeAll(data[state.tab].length);
    row.setAttribute('aria-labelledby', 'dmTab' + state.tab.charAt(0).toUpperCase() + state.tab.slice(1));
    // מעבר לשונית מחזיר את השורה לתחילתה, אחרת הלשונית החדשה נפתחת
    // באמצע הגלילה של הקודמת
    row.scrollLeft = 0;
    // ...ומיד אחריו מצב החצים נמדד מחדש: מספר האריחים השתנה, ולפעמים גם
    // התשובה לשאלה אם יש בכלל לאן לגלול
    refreshScroll();
  }

  /* פריטי הניווט "משרדי תיווך" / "מתווכים" / "בעלי מקצוע" הובילו קודם
     לשלוש סקציות נפרדות; היום הם שלוש לשוניות של אותה סקציה, ולכן כל אחד
     מהם בוחר את הלשונית שלו בדרך אליה. העוגן עצמו נשאר ‎#dealmakers‎ ועושה
     את הגלילה — כאן רק נבחרת הלשונית. */
  document.querySelectorAll('a[href="#dealmakers"][data-dm-tab]').forEach(link=>{
    link.addEventListener('click', ()=>{
      const target = tabs.find(b => b.dataset.tab === link.dataset.dmTab);
      if (target && !target.disabled) target.click();
    });
  });

  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (btn.disabled) return;
      state.tab = btn.dataset.tab;
      // מעבר לשונית מנקה את החיפוש: מילה שסיננה משרדים כמעט תמיד תחזיר
      // אפס מתווכים, והלשונית החדשה הייתה נפתחת ריקה בלי סיבה גלויה
      state.query = '';
      searchEl.value = '';
      // אותו נימוק חל על הבורר: התמחות שנבחרה בלשונית אחת אינה בהכרח
      // קיימת באחרת, והלשונית החדשה הייתה נפתחת מסוננת בלי שנראה במה
      state.spec = 'all';
      tabs.forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      fillQuick();
      render();
    });
  });

  searchEl.addEventListener('input', (e)=>{
    state.query = e.target.value;
    render();
  });

  specEl.addEventListener('change', (e)=>{
    state.spec = e.target.value;
    render();
  });

  // אם אין משרדים בכלל, הלשונית הראשונה שנפתחת היא הראשונה שיש בה תוכן
  const firstFull = tabs.find(b => !b.disabled);
  if (firstFull && firstFull.dataset.tab !== state.tab){
    state.tab = firstFull.dataset.tab;
    tabs.forEach(b => b.setAttribute('aria-selected', String(b === firstFull)));
  }
  fillQuick();
  render();

  // חציית 760px או 1100px משנה כמה כרטיסים מוצגים ואם יש נקודות — ציור
  // מחדש, כמו במדף הנכסים. ‏addListener הוא הנפילה-לאחור ל-Safari ישן.
  [dmMqGrid, dmMqWide].forEach(mq=>{
    if (mq.addEventListener) mq.addEventListener('change', render);
    else if (mq.addListener) mq.addListener(render);
  });
})();


/* המפה היא שכבה אופציונלית ולא תנאי להצגת הנכסים.
   קודם כל רינדור הנכסים ישב בתוך אותו try של המפה, ולכן ברגע ש-Leaflet
   לא נטען — נעלמו איתו גם גריד הנכסים, הנכסים המקודמים ורצועת המפה,
   והמבקר ראה עמוד בית כמעט ריק. עכשיו כישלון של המפה מוריד רק את המפה. */
let heroMap = null;
/* כלי הסימון (assets/map-draw.js). מוצהר כאן ולא לצד initMapDraw שמאתחל
   אותו, כי applyDealFilter — שרץ בכל רינדור של המפה — קורא ל-inDrawnArea
   שמסתכל עליו, והצהרה מאוחרת יותר בקובץ הייתה משאירה אותו ב-TDZ. */
let mapDraw = null;

/* "הזזת המפה היא חיפוש" — המצב עצמו. מוצהר כאן ולא לצד updateMapViewRows
   מאותה סיבה בדיוק שבגללה mapDraw מוצהר כאן: המאזינים שקוראים אותו נקשרים
   כבר באתחול המפה, כמה מאות שורות מעל ההגדרה, והצהרה מאוחרת הייתה משאירה
   אותו ב-TDZ אם Leaflet יורה moveend תוך כדי האתחול. */
let mapViewOn = false;
let mapViewTimer = null;
let mapNavAt = 0;

/* המספרים שבראש ה-hero. שלושה טוענים שונים ממלאים אותו במועדים שונים,
   ו-renderHeroStats מצייר בכל פעם את מה שכבר יש — ראו שם.

   ‏initLeadingAgencies יושב מוקדם יותר בקובץ מהשורה הזאת, וכותב לכאן —
   אבל רק *אחרי* ה-await שלו, כלומר במיקרו־משימה שרצה כשכל הסקריפט כבר
   הורץ. אין TDZ, וגם לא תלות בסדר הכתיבה בקובץ. */
const heroStatsState = { props:null, agencies:null, ai:null, today:null };

/* שלושת הסגנונות נגזרים כולם מאותם אריחים בעזרת פילטרים ב-CSS (ראו
   ‏body[data-map-style="…"] למעלה), ולכן מעבר בין סגנונות לא עולה ולו בקשת
   רשת אחת, והם עובדים מול כל ספק אריחים.

   הספק עצמו יושב ב-assets/map-tiles.js, יחד עם ארבע המפות האחרות באתר.
   קודם הוא היה כתוב כאן, וכשספק האריחים שינה תנאים באוגוסט 2026 תוקן כאן
   בלבד — ושלוש מפות אחרות נשארו שבורות. */

const MAP_STYLES = ['nature','classic','light'];
const DEFAULT_MAP_STYLE = 'classic';

/* התצוגה ההתחלתית של המפה — מרכז **העיר הפעילה**. מוגדרת פעם אחת ומשמשת
   גם באתחול המפה וגם בכפתור המירכוז שבפינה השמאלית התחתונה, כדי ששניהם
   לא יוכלו להיפרד זה מזה.

   מקור האמת הוא assets/city-context.js, שהחליף שלושה עותקים של הקבוע הזה
   (כאן, ב-agencies.html וב-neighborhood-boundary.html). ההכרעה שם
   סינכרונית לחלוטין, ולכן המפה נפתחת על המרכז הנכון ואינה זזה אחרי הציור.

   **העותק המקומי אינו כפילות אלא רשת ביטחון.** city-context.js הוא
   ‎<script src>‎ רגיל, וקובץ שלא נטען (חוסם, רשת גרועה) היה מפיל כאן את
   כל אתחול המפה ומשאיר את דף הבית בלי מפה בכלל. במקרה כזה נופלים לעפולה
   — בדיוק מה שהיה כאן קודם. */
const CityCtx = window.CityContext || {
  center: function(){ return [32.6078, 35.2897]; },
  zoom:   function(){ return 13; },
  label:  function(){ return 'עפולה והעמק'; },
  name:   function(){ return 'עפולה'; },
  active: function(){ return { slug:'afula' }; },
  isDefault: function(){ return true; },
  hydrate: function(){ return Promise.resolve(false); }
};
const CITY_ZOOM = CityCtx.zoom();
// הרף שממנו הכותרת והחיפוש יורדים לעמודה בצד המפה. חייב להתאים ל-@media
// בגיליון הסגנונות, ומוצהר כאן — לפני אתחול המפה — כי horizontalMapPadding
// נקראת כבר בתצוגה הראשונה, בזמן ריצת הסקריפט עצמו.
const MAP_COLUMN_MIN_WIDTH = 1024;

/* מרכז עפולה, מוזז אל החצי הפנוי של המפה.
   ------------------------------------------------------------
   בדסקטופ העמודה של הכותרת והחיפוש שוכבת על צד אחד של המפה, ומרכז
   הקונטיינר — שבו setView מניח את מרכז העיר — נופל בדיוק מתחתיה, כך שהדף
   נפתח עם עפולה מוסתרת. הפונקציה מחזירה את *מרכז התצוגה* שבו העיר עצמה
   נוחתת במרכז השטח הפנוי (משמאל לעמודה ב-RTL), באותו זום בדיוק ובלי לגעת
   בחיפוש או בפילטרים.

   אותו חישוב חל גם על הציר האנכי, ומאותה סיבה: בטלפון סרגל החיפוש חוסם את
   ראש המפה וסרגל הפקדים את תחתיתה, והעיר צריכה לנחות במרכז מה שנשאר. זו גם
   בדיוק הנוסחה של fitMapToMarkers, כדי שהתצוגה שאיתה הדף נפתח והתצוגה שאחרי
   טעינת הנכסים לא ייפרדו זו מזו. */
function cityViewCenter(zoom){
  const center = CityCtx.center();
  if (!heroMap) return center;
  try{
    const pad = visibleMapPadding();
    const dx = (pad.left - pad.right) / 2;
    const dy = (pad.top - pad.bottom) / 2;
    if (!dx && !dy) return center;
    const pt = heroMap.project(center, zoom).subtract([dx, dy]);
    return heroMap.unproject(pt, zoom);
  } catch(e){ return center; }
}

function applyMapStyle(style){
  if (!MAP_STYLES.includes(style)) style = DEFAULT_MAP_STYLE;
  document.body.dataset.mapStyle = style;
  const select = document.getElementById('mapStyleSelect');
  if (select) select.value = style;
  try { localStorage.setItem('shuk_map_style', style); } catch(e){ /* מצב פרטי/חסום */ }
}

let savedMapStyle = DEFAULT_MAP_STYLE;
try { savedMapStyle = localStorage.getItem('shuk_map_style') || DEFAULT_MAP_STYLE; } catch(e){ /* מצב פרטי/חסום */ }
if (!MAP_STYLES.includes(savedMapStyle)) savedMapStyle = DEFAULT_MAP_STYLE;

try {
  if (!window.L) throw new Error('Leaflet לא נטען (CDN חסום/נכשל)');

  heroMap = L.map('hero-map', { scrollWheelZoom:false, zoomControl:false }).setView(CityCtx.center(), CITY_ZOOM);
  // ההזזה אל השטח הפנוי נמדדת מה-DOM, ולכן היא באה אחרי שהמפה כבר קיימת
  // ויודעת את גודלה — לא כארגומנט ל-setView שלמעלה
  heroMap.setView(cityViewCenter(CITY_ZOOM), CITY_ZOOM, { animate:false });
  MapTiles.addTo(heroMap);
  // כל החלק העליון של המפה מוסתר ע"י סרגל החיפוש הצף, ולכן פקדי הזום יורדים
  // לתחתית: הזום בצד אחד, הקרדיטים בשני, ו-.map-toolbar במרכז ביניהם
  L.control.zoom({ position:'bottomright' }).addTo(heroMap);
  heroMap.attributionControl.setPosition('bottomleft');

  /* מחוות משתפות פעולה, במגע ובגלגלת גם יחד. המפה כאן פותחת את הדף וגובהה
     כמעט מסך שלם, ולכן היא הייתה המלכודת הגדולה מכולן — בשני הכיוונים:
     אצבע שנחתה עליה בדרך למטה הזיזה את המפה במקום להמשיך בדף, ובעכבר
     ‏`on('focus', … scrollWheelZoom.enable())` שהיה כאן הדליק את זום הגלגלת
     בכל *לחיצה* על המפה (כך Leaflet מגדיר focus) — ומאותו רגע גלילה מעל
     המפה קירבה אותה במקום לגלול את הדף, עד לחיצה במקום אחר.

     עכשיו: אצבע אחת ובגלגלת לבדה — הדף גולל; שתי אצבעות או ‏Ctrl/⌘ + גלגלת
     — המפה זזה ומתקרבת. שתיהן ממשיכות לירות moveend/zoomend, ולכן הפאנל
     המפוצל וסינון התחום הנראה לא מושפעים.
     ‏MapGestures לא נטען (קובץ חסר/נכשל) — המפה פשוט נשארת כשהייתה, ובלי
     זום גלגלת כלל (‏scrollWheelZoom:false למעלה). */
  if (window.MapGestures) MapGestures.apply(heroMap);

  const tintPane = heroMap.createPane('tintPane');
  tintPane.classList.add('map-tint');
  const recenterMapTint = ()=> L.DomUtil.setPosition(tintPane, heroMap.containerPointToLayerPoint([0,0]));
  heroMap.on('moveend zoomend viewreset resize', recenterMapTint);
  recenterMapTint();

  // מה שנחתך בזום נמוך מתפרש יפה אחרי התקרבות, ולהפך — הפריסה מחושבת מחדש
  // בכל שינוי תצוגה ולא רק בעת רינדור הפינים
  heroMap.on('zoomend moveend resize', ()=> relayoutMapPins());

  // ליבת התצוגה המפוצלת: גרירה או זום של המפה הם עצמם פעולת חיפוש — הרשימה
  // שלצדה מצטמצמת למה שנמצא בתחום הנראה. moveend/zoomend נורים פעם אחת בסוף
  // המחווה, ולכן אין כאן צורך ב-debounce.
  heroMap.on('moveend zoomend resize', ()=> updateSplitPanel());

  /* אותו רעיון בדיוק, אבל לרשימה שמתחת למפה — וגם בטלפון, שם אין תצוגה
     מפוצלת. ‏markMapUserNav נקשר למחוות ולא ל-moveend: רק גרירה, זום גלגלת,
     צביטה או כפתורי הזום הם "הגולש/ת מחפש/ת על המפה"; תזוזה שהקוד יזם
     (‏fitMapToMarkers אחרי חיפוש, מירכוז, פתיחה מוגדלת) אינה.
     ‏dragstart/zoomstart של Leaflet מכסים גרירה וצביטה; הגלגלת ממומשת
     ב-assets/map-gestures.js ולכן היא נתפסת מה-container, וכפתורי הזום הם
     קישורים ב-.leaflet-control-zoom. ראו updateMapViewRows. */
  heroMap.on('dragstart', markMapUserNav);
  const mapContainer = heroMap.getContainer();
  // גלגלת והקלקה כפולה — זום ביוזמת המשתמש/ת
  mapContainer.addEventListener('wheel', markMapUserNav, { passive:true });
  mapContainer.addEventListener('dblclick', markMapUserNav, { passive:true });
  /* צביטה. שתי אצבעות ולא אחת, בדיוק כמו ההפרדה ב-map-gestures.js: אצבע
     אחת גוללת את הדף ואינה נוגעת במפה, ואילו touchstart גורף היה מסמן
     "חיפוש על המפה" בכל גלילה שעברה מעליה. */
  mapContainer.addEventListener('touchstart', (e)=>{
    if (e.touches && e.touches.length >= 2) markMapUserNav();
  }, { passive:true });
  // כפתורי ה-+/− של Leaflet. לחיצה על פין לא נכללת כאן בכוונה: הבלון שנפתח
  // מזיז את המפה (autoPan), וזו לא מחוות חיפוש.
  mapContainer.addEventListener('click', (e)=>{
    if (e.target.closest && e.target.closest('.leaflet-control-zoom')) markMapUserNav();
  }, { passive:true });
  heroMap.on('moveend zoomend', scheduleMapViewRows);

  /* השטח הפנוי משתנה רק כשהפריסה משתנה — שינוי גודל חלון, פתיחת התצוגה
     המפוצלת, הגדלת המפה — וכל אלה מגיעים ל-Leaflet כאירוע resize (המצבים
     קוראים ל-invalidateSize). ‏moveend/zoomend לא נכללים כאן בכוונה: הם
     נורים בכל גרירה, והפריסה לא זזה איתם. */
  heroMap.on('resize', syncMapFreeArea);
  syncMapFreeArea();
} catch(e){
  console.warn('אתחול המפה נכשל, ממשיכים בלי המפה:', e);
  const hero = document.getElementById('heroSection');
  if (hero) hero.classList.add('map-failed');
  const mapEl = document.getElementById('hero-map');
  if (mapEl) mapEl.innerHTML = '';
  const note = document.getElementById('mapFallbackNote');
  if (note) note.hidden = false;
}

applyMapStyle(savedMapStyle);
const mapStyleSelect = document.getElementById('mapStyleSelect');
if (mapStyleSelect){
  mapStyleSelect.addEventListener('change', ()=> applyMapStyle(mapStyleSelect.value));
}

const mapMarkers = {};
// הנכסים שמהם נבנו הפינים הנוכחיים, בסדר שבו הם התקבלו (מקודמים ואז חדשים).
// מקור האמת של הפאנל המפוצל — ראו renderMap ו-updateSplitPanel.
let mapProperties = [];

/* המקרא שמתחת למפה הוא גם מסנן: כל סוג עסקה שכבוי כאן — הפינים שלו יורדים
   מהמפה. הסינון הזה חי רק בשכבת התצוגה ולא נוגע ברשימת הנכסים עצמה, ולכן
   הוא לא מתנגש עם החיפוש: חיפוש קובע *אילו* נכסים יש, והמקרא קובע אילו מהם
   מצוירים כרגע. mapMarkers מחזיק תמיד את כולם, ו-applyDealFilter מוסיף
   ומוריד מהמפה בהתאם. */
const MAP_DEAL_KINDS = ['sale','rent','commercial'];
const activeDealKinds = new Set(MAP_DEAL_KINDS);
const visibleMarkers = ()=> Object.values(mapMarkers).filter(m => activeDealKinds.has(m.options.dealKind));

// טעינת הנכסים הראשונית היא אסינכרונית, ולכן משתמש שהספיק ללחוץ "חיפוש"
// לפני שהיא חזרה ראה את תוצאות החיפוש נדרסות שנייה אחר כך ע"י הרשימה
// המלאה — נכסים שאין להם קשר למה שביקש, גם על המפה וגם ברשימה
let searchHasRun = false;

// כמה מהמפה באמת פנוי לפינים: החלק העליון חסום ע"י סרגל החיפוש הצף והחלק
// התחתון ע"י סרגל הפקדים. נמדד מה-DOM ולא מקובע במספרים, כי הגובה משתנה בין
// מובייל לדסקטופ, במצב "הגדל מפה" וכשהכותרת נשברת לשתי שורות.
// הריפוד הוא החסימה בפועל — כמה שסרגל החיפוש וסרגל הפקדים מכסים — בלי
// תקרות מלאכותיות. התקרות שהיו כאן קודם (45%/25%) קיצצו אותו, וכתוצאה מכך
// הפין העליון נחת מתחת לסרגל החיפוש. את הריסון של הזום עושה עכשיו
// fitMapToMarkers עצמו, שלא נותן לריפוד לגנוב יותר מרמת זום אחת.
function visibleMapPadding(){
  const fallback = { top:150, bottom:70, left:0, right:0 };
  if (!heroMap) return fallback;
  const hero = document.getElementById('heroSection');
  // ה-shell ולא ה-card: ההילה המטושטשת של ה-shell גולשת מתחת לכרטיס,
  // ומדידה עד תחתית ה-card בלבד הייתה מניחה פינים בתוכה
  const shell = document.querySelector('.search-shell');
  const bar = document.querySelector('.map-toolbar');
  if (!hero || !shell || !bar) return fallback;
  /* במצב המצומצם (טלפון, ‏.map-peek) שום דבר לא יושב על המפה: הסרגל והרצועה
     נערמים מעליה בזרימה, וסרגל הפקדים מוסתר. מדידה של "עד תחתית סרגל
     החיפוש" הייתה מחזירה כאן חסימה גבוהה מהפס עצמו, וכל הפינים היו נדחסים
     לרצועה של פיקסלים בודדים. */
  if (hero.classList.contains('map-peek')) return { top:12, bottom:12, left:0, right:0 };
  const heroRect = hero.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  const height = heroMap.getSize().y || heroRect.height;
  const side = horizontalMapPadding(shellRect);
  /* ספירה כפולה שדחפה את המפה למטה: בדסקטופ העמודה יושבת *בצד* המפה,
     וההזזה האופקית כבר מוציאה את הנכסים מתחתיה — אבל הגובה שלה נספר כאן
     שוב כחסימה עליונה (עד תחתית סרגל החיפוש, מאות פיקסלים), ו-fitMapToMarkers
     הוריד את האשכול בחצי ממנו. התוצאה היא מה שנראה בדף: עפולה והפינים
     נמוכים מדי, חלקם מתחת לסרגל הפקדים.

     כשההזזה האופקית פעילה, מה שבאמת חוסם בשטח הפנוי הוא רק כלי הסימון
     שבפינה העליונה שלו — וגם הם רק כשהם מוצגים (דסקטופ, ולא במפה שנפלה). */
  const tools = document.getElementById('mapTools');
  const toolsRect = tools && !tools.hidden && tools.offsetParent ? tools.getBoundingClientRect() : null;
  const top = (side.left || side.right)
    ? (toolsRect ? toolsRect.bottom - heroRect.top + 16 : 0)
    : shellRect.bottom - heroRect.top + 16;
  const bottom = heroRect.bottom - bar.getBoundingClientRect().top + 16;
  // רשת ביטחון בלבד, למקרה קיצון שבו החסימות גבוהות מהמפה עצמה
  const cap = height * 0.8;
  const total = top + bottom;
  const scale = total > cap && total > 0 ? cap / total : 1;
  return {
    top: Math.max(0, Math.round(top * scale)),
    bottom: Math.max(0, Math.round(bottom * scale)),
    ...side,
  };
}

/* אותו שטח פנוי, הפעם כמשתני CSS על קונטיינר המפה.
   ------------------------------------------------------------
   הבועיות שיושבות *על* המפה — הרמז של המחוות (‏assets/map-gestures.js) ושורת
   ההוראות של סימון האזור (‏assets/map-draw.js) — ממרכזות את עצמן בין
   ‎--map-free-start‎ ל-‎--map-free-end‎ ולא בין קצות הקונטיינר. בלי זה הן נחתו
   במרכז המפה, כלומר מתחת לעמודת הכותרת והחיפוש שמכסה את חציה בדסקטופ,
   ונעלמו מהעין בדיוק ברגע שנועדו להסביר משהו.

   שני המודולים גנריים ואינם יודעים דבר על הפריסה של הדף הזה; מה שהם יודעים
   הוא לקרוא ארבעה משתנים, ומי שמכיר את הפריסה — הדף — כותב אותם. בדף בלי
   חסימות (דף הנכס, ה-CRM) הם פשוט לא מוגדרים והמרכוז נשאר כשהיה. */
function syncMapFreeArea(){
  if (!heroMap) return;
  const el = heroMap.getContainer();
  if (!el) return;
  const pad = visibleMapPadding();
  el.style.setProperty('--map-free-start', pad.left + 'px');
  el.style.setProperty('--map-free-end', pad.right + 'px');
  el.style.setProperty('--map-free-top', pad.top + 'px');
  el.style.setProperty('--map-free-bottom', pad.bottom + 'px');
}

/* החסימה האופקית — בדסקטופ בלבד.
   ------------------------------------------------------------
   מ-1024px ומעלה הכותרת וסרגל החיפוש יושבים בעמודה מעל צד אחד של המפה
   (ימין ב-RTL), ומרכז המפה — כלומר מרכז עפולה — נחת בדיוק מתחתיה. הריפוד
   כאן הוא רוחב העמודה, וממנו נגזרת ההזזה שמביאה את העיר אל החצי הפנוי.

   מתחת ל-1024px זה מוחזר אפס בכוונה: בטלפון ובטאבלט העמודה ממורכזת ברוחב
   מלא, אין "צד פנוי" להזיז אליו, והמפה נשארת בדיוק כפי שהייתה.

   הצד נמדד מה-DOM ולא מכיוון הכתיבה: כך גם ‎html[dir=ltr]‎ וגם המצב המפוצל
   (שבו העמודה ממורכזת מעל מפה מצומצמת, ושני הצדדים יוצאים שווים) נופלים
   נכון מאליהם, בלי רשימת מקרים. */
function horizontalMapPadding(shellRect){
  const none = { left:0, right:0 };
  const mapEl = document.getElementById('hero-map');
  if (!mapEl || !heroMap || !window.matchMedia(`(min-width:${MAP_COLUMN_MIN_WIDTH}px)`).matches) return none;
  const mapRect = mapEl.getBoundingClientRect();
  const width = heroMap.getSize().x || mapRect.width;
  if (!width) return none;
  const freeStart = shellRect.left - mapRect.left;   // פנוי משמאל לעמודה
  const freeEnd = mapRect.right - shellRect.right;   // פנוי מימין לעמודה
  // הפרש קטן בין הצדדים = עמודה ממורכזת, ואין כאן צד מוסתר להתחשב בו.
  // הסף השני מוודא שנשאר שטח אמיתי לעבוד בו אחרי ההזזה.
  const MIN_GAP = 120, MIN_FREE = 260;
  const cap = width * 0.7;
  if (freeStart - freeEnd > MIN_GAP && freeStart > MIN_FREE){
    return { left:0, right: Math.min(cap, Math.round(mapRect.right - shellRect.left)) };
  }
  if (freeEnd - freeStart > MIN_GAP && freeEnd > MIN_FREE){
    return { left: Math.min(cap, Math.round(shellRect.right - mapRect.left)), right:0 };
  }
  return none;
}

// ממרכזת את המפה על הפינים המוצגים כרגע בתוך החלק הנראה שלה. נקראת גם אחרי
// הגדלה/הקטנה של המפה, כי החלון הנראה משתנה ואיתו הריפוד הנכון.
const MAP_FIT_MAX_ZOOM = 16;
function fitMapToMarkers(){
  if (!heroMap) return;
  const points = visibleMarkers().map(m => m.getLatLng());
  // סימון השכונה הנבחרת נספר כחלק ממה שצריך להיכנס לתצוגה: בלעדיו הוא היה
  // נחתך כשהנכסים מרוכזים בפינה אחת שלו, ובשכונה שהחיפוש לא החזיר בה כלום
  // לא היה למפה בכלל לאן לעוף
  const hoodBounds = hoodShapes.length
    ? hoodShapes.reduce((acc, s)=> acc ? acc.extend(s.getBounds()) : L.latLngBounds(s.getBounds()), null)
    : null;
  if (!points.length && !hoodBounds) return;
  try {
    const pad = visibleMapPadding();
    const bounds = points.length
      ? (hoodBounds ? L.latLngBounds(points).extend(hoodBounds) : L.latLngBounds(points))
      : hoodBounds;

    // fitBounds רגיל היה מרחיק את הזום עד שכל הגבולות נכנסים לחלון הפנוי
    // בין סרגל החיפוש לסרגל הפקדים — ובמפה נמוכה זה אומר שאשכול נכסים של
    // 1.5 ק"מ בעפולה נדחס לכתם אחד שכל תוויות המחיר בו נערמות. הכלל כאן:
    // החסימות מותר להן לעלות רמת זום אחת לכל היותר. גבולות שבאמת רחבים
    // (חיפוש על פני כל העמק) עדיין מתרחקים כרגיל, אבל אשכול צפוף נשאר קריא
    // וגולש קלות אל מתחת לסרגלים במקום להתכווץ.
    const withChrome = heroMap.getBoundsZoom(bounds, false, L.point(48 + pad.left + pad.right, pad.top + pad.bottom));
    const withoutChrome = heroMap.getBoundsZoom(bounds, false, L.point(48, 48));
    const zoom = Math.min(MAP_FIT_MAX_ZOOM, Math.max(withChrome, withoutChrome - 1));

    // מרכוז על מרכז החלון הפנוי ולא על מרכז הקונטיינר, אחרת האשכול יושב
    // גבוה מדי ונחתך ע"י סרגל החיפוש — ובדסקטופ גם נבלע מתחת לעמודת
    // הכותרת והחיפוש שבצד (ראו horizontalMapPadding)
    const center = heroMap.project(bounds.getCenter(), zoom)
      .subtract([(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2]);
    heroMap.setView(heroMap.unproject(center, zoom), zoom, { animate:true });
  } catch(e){ /* גבולות לא תקינים — משאירים את התצוגה הנוכחית */ }
}

/* תוויות מחיר שנחתכות זו בזו יורדות לנקודה קטנה (.is-dot), והמחיר נשאר
   זמין בלחיצה. סדר העדיפויות קובע מי נשאר עם תווית מלאה: קודם נכסים
   מקודמים, ואחריהם המחיר הגבוה — כלומר מה שנשאר קריא הוא גם מה שהכי
   שווה להציג. נקרא מחדש בכל שינוי זום, כי מה שנחתך בזום 14 מתפרש יפה
   בזום 16. */
function relayoutMapPins(){
  if (!heroMap) return;
  const items = Object.values(mapMarkers)
    .map(m => ({ m, pin: m.getElement() && m.getElement().querySelector('.map-pin') }))
    .filter(x => x.pin);
  items.sort((a, b) => b.m.options.pinRank - a.m.options.pinRank);

  const placed = [];
  items.forEach(({ m, pin })=>{
    pin.classList.remove('is-dot');
    const pt = heroMap.latLngToContainerPoint(m.getLatLng());
    // התווית ממורכזת על הנקודה (ראו .map-pin ב-CSS), ולכן חצי רוחב/גובה לכל צד
    const halfW = pin.offsetWidth / 2 + 3;
    const halfH = pin.offsetHeight / 2 + 3;
    const box = { l:pt.x - halfW, r:pt.x + halfW, t:pt.y - halfH, b:pt.y + halfH };
    const collides = placed.some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
    if (collides) pin.classList.add('is-dot');
    else placed.push(box);
  });
}

/* שלוש קטגוריות עסקה = שלושה צבעי פין. מסחרי גובר על deal_type בכוונה:
   "חנות להשכרה" היא קודם כל נכס מסחרי, וזה מה שמבדיל אותה במבט על המפה
   מדירה להשכרה. אותם שלושה צבעים חוזרים במקרא שמתחת למפה, בתגיות שבשורות
   התוצאות ובבורר סוג העסקה בסרגל החיפוש. */
function dealKind(p){
  return p.category === 'commercial' ? 'commercial' : (p.deal_type === 'rent' ? 'rent' : 'sale');
}
const DEAL_COLORS = {
  sale:      'var(--deal-sale)',
  rent:      'var(--deal-rent)',
  commercial:'var(--deal-commercial)',
};
const DEAL_LABELS = { sale:'מכירה', rent:'השכרה', commercial:'מסחרי' };

// כתובת להצגה: מה שהכי ספציפי שקיים על הנכס, ובלית ברירה שם העיר
function locationLabel(p){
  return p.address || p.street || p.neighborhood_name || p.city || 'עפולה והעמק';
}

/* בלון המידע של הפין. הבלון כולו <a> לדף הנכס: קודם הוא היה טקסט מת, ולחיצה
   עליו לא הובילה לשום מקום — הדרך היחידה להגיע לנכס מהמפה הייתה לאתר אותו
   שוב ברשימה שמתחת. התמונה מוצגת רק כשיש כזו, ומידותיה קבועות ב-CSS כדי
   שהיא לא תמתח את הבלון (ראו .map-pop). */
function mapPopupHtml(p, kind){
  const img = p.images && p.images[0];
  const meta = [locationLabel(p), p.agency_name].filter(Boolean).join(' · ');
  // בלי תמונה מוצג לוגו המשרד באותה מסגרת (object-fit:contain כדי שהלוגו לא
  // ייחתך) — כך הבלון שומר על אותו מבנה גם למודעה שהתמונות שלה עוד לא הועלו.
  const logo = !img && p.agency_logo ? p.agency_logo : '';
  return `<a class="map-pop" href="/property?id=${encodeURIComponent(p.id)}">` +
    (img ? `<img class="map-pop-thumb" src="${escAttr(img)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
    (logo ? `<img class="map-pop-thumb is-logo" src="${escAttr(logo)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
    `<span class="map-pop-body">` +
      `<span class="map-pop-title">${escAttr(p.title)}</span>` +
      `<span class="map-pop-price"><i class="map-pop-dot" style="background:${DEAL_COLORS[kind]}"></i>` +
        `${DEAL_LABELS[kind]} · ${priceLabel(p)}</span>` +
      `<span class="map-pop-meta">${escAttr(meta)}</span>` +
      // הסימן על המפה אומר "יש כאן משהו"; הבלון הוא המקום שבו נאמר מה —
      // ההבטחה עצמה ומתי היא נגמרת
      (OpenHouse.live(p)
        // ‏align-self: ‎.map-pop-body‎ הוא עמודת flex, ותגית שנמתחת לכל
        // רוחב הבלון נראית כרצועה ולא כתגית
        ? `<span class="oh-chip" style="margin-top:5px;align-self:flex-start">${OpenHouse.NO_FEE} · ${OpenHouse.endLabel(p)}</span>`
        : '') +
      `<span class="map-pop-cta">לצפייה בנכס ←</span>` +
    `</span></a>`;
}

// המפה תמיד משקפת בדיוק את מה שמוצג ברשימת הנכסים למטה בעמוד — הפונקציה
// הזו נקראת מתוך renderPropertyGrid() עצמה (לא רק מהטעינה הראשונית), כך
// ש-runSearch() מסנכרן אליה אוטומטית בלי צורך לזכור לעדכן את המפה בנפרד
// בכל מקום שמרנדר את הרשימה.
function renderMap(properties){
  Object.values(mapMarkers).forEach(m => heroMap && heroMap.removeLayer(m));
  Object.keys(mapMarkers).forEach(id => delete mapMarkers[id]);
  // הרשימה שמזינה את הפינים היא גם זו שמזינה את הפאנל המפוצל, שמצמצם אותה
  // לתחום הנראה של המפה. נשמרת כאן ולא נטענת מחדש, כדי ששתי התצוגות לא
  // יוכלו להיפרד זו מזו.
  mapProperties = properties.slice();

  if (heroMap){
    properties.forEach((p) => {
      if (!p.lat || !p.lng) return;
      // צבע הפין לפי סוג העסקה — מכירה/השכרה/מסחרי, בדיוק כמו במקרא שמתחת
      // למפה ובבורר סוג העסקה בסרגל החיפוש, כדי לזהות סוג נכס במבט חטוף
      // בלי לפתוח פופאפ
      const kind = dealKind(p);
      /* הילה פועמת סביב פין של נכס מקודם, ורק שלו. פעימה על כל פין הייתה
         הופכת מפה עם ארבעים נכסים לשדה מהבהב שאי אפשר לקרוא בו כלום —
         תנועה מסמנת משהו רק כשהיא נדירה. */
      const promoted = isPromoted(p);
      /* נכס ביריד הבתים הפתוחים מקבל את הסימן שלו *מעל* תווית המחיר, ולא
         במקומה: המחיר הוא עדיין מה שסורקים על המפה, והסימן הוא מה שאומר
         שאין עליו עמלת תיווך. המסגרת האדומה סביב התווית היא מה שמחזיק את
         הקשר בין השניים כשהן נחתכות (‏relayoutMapPins מקטין תוויות
         שמתנגשות לנקודה, והסימן נשאר). */
      const openHouse = OpenHouse.live(p);
      const icon = L.divIcon({
        className:'',
        html:(promoted ? '<span class="map-pin-halo" aria-hidden="true"></span>' : '') +
             (openHouse ? OpenHouse.mapPinHtml(p) : '') +
             `<div class="map-pin${openHouse ? ' is-openhouse' : ''}" style="background:${DEAL_COLORS[kind]}">${priceLabel(p)}</div>`,
        iconSize:[0,0]
      });
      // pinRank מכריע מי שומר על תווית מלאה כשפינים נחתכים (relayoutMapPins):
      // נכס מקודם תמיד גובר, אחריו נכס ביריד (הסימן שלו כבר תופס את המקום
      // שמעל התווית, ותווית שנחתכת לנקודה מתחתיו נראית כתקלה), ובין השאר
      // מנצח המחיר הגבוה
      const m = L.marker([p.lat, p.lng], {
        icon,
        dealKind: kind,
        pinRank: (isPromoted(p) ? 1e12 : 0) + (openHouse ? 5e11 : 0) + (Number(p.price) || 0),
      });
      m.bindPopup(mapPopupHtml(p, kind));
      // לחיצה על פין מדגישה וגוללת אל השורה שלו בפאנל המפוצל — הכיוון השני
      // של הקישור שריחוף על שורה יוצר (ראו hotSplitRow)
      m.on('popupopen', ()=> revealSplitRow(p.id));
      m.on('popupclose', ()=> hotSplitRow(p.id, false));
      mapMarkers[p.id] = m;
    });
  }
  // מצב מבלבל: חיפוש החזיר נכסים, אבל כולם מסוג עסקה שכבוי במקרא — המפה
  // הייתה נראית ריקה כאילו החיפוש נכשל. רשימה חדשה שאין לה ולו פין אחד
  // להציג פותחת מחדש את המסנן.
  if (Object.keys(mapMarkers).length && !visibleMarkers().length) resetDealFilter();
  // ההוספה בפועל למפה נעשית כאן ולא ב-forEach: כך מסנן המקרא נאכף גם על
  // רשימה חדשה, ולא רק על לחיצה על המקרא עצמו
  applyDealFilter({ fit:true });
}

function syncLegendButtons(){
  document.querySelectorAll('.map-legend button').forEach(b =>
    b.setAttribute('aria-pressed', String(activeDealKinds.has(b.dataset.dealKind))));
}

function resetDealFilter(){
  MAP_DEAL_KINDS.forEach(k => activeDealKinds.add(k));
  syncLegendButtons();
}

/* מוסיף ומוריד פינים מהמפה לפי מצב המקרא. fit רק כשהתצוגה באמת השתנתה
   (רשימה חדשה או לחיצה על המקרא) — הפונקציה נקראת גם ממקומות שרק צריכים
   לרענן את המונה. */
function applyDealFilter({ fit = false } = {}){
  if (heroMap){
    Object.values(mapMarkers).forEach(m => {
      // שני מסננים על אותו פין: המקרא (סוג העסקה) והאזור שסומן. שניהם
      // חיים בשכבת התצוגה בלבד ואינם נוגעים ברשימת הנכסים עצמה.
      const at = m.getLatLng();
      const on = activeDealKinds.has(m.options.dealKind) && inDrawnArea({ lat:at.lat, lng:at.lng });
      if (on && !heroMap.hasLayer(m)) m.addTo(heroMap);
      else if (!on && heroMap.hasLayer(m)) heroMap.removeLayer(m);
    });
    if (fit) fitMapToMarkers();
    relayoutMapPins();
  }
  updateLegendCounts();
  // המקרא מסתיר פינים, והפאנל המפוצל מציג רק את מה שמצויר על המפה — ולכן
  // כיבוי "השכרה" חייב להוריד את אותם נכסים גם מהרשימה שלצדה
  updateSplitPanel();
}

/* המונה שבסוגריים לצד כל סוג עסקה במקרא. הוא סופר תמיד את כל הפינים מאותו
   סוג ברשימה הנוכחית — גם כשהסוג כבוי — כי זו בדיוק המשמעות של הכפתור:
   "יש כאן N נכסים כאלה, לחצו כדי להסתיר/להציג אותם". */
function updateLegendCounts(){
  const counts = Object.fromEntries(MAP_DEAL_KINDS.map(k => [k, 0]));
  Object.values(mapMarkers).forEach(m => { counts[m.options.dealKind]++; });
  document.querySelectorAll('[data-legend-count]').forEach(el => {
    el.textContent = `(${counts[el.dataset.legendCount] || 0})`;
  });
}

document.querySelectorAll('.map-legend button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const kind = btn.dataset.dealKind;
    if (activeDealKinds.has(kind)) activeDealKinds.delete(kind);
    else activeDealKinds.add(kind);
    syncLegendButtons();
    applyDealFilter({ fit:true });
  });
});


function dealBadge(p){ return DEAL_LABELS[dealKind(p)]; }

/* מירכוז המפה חזרה לעפולה. פעולה של תצוגה בלבד: היא לא נוגעת ברשימת
   הנכסים, בפילטרים או בשורת החיפוש — מי שחיפש "3 חדרים להשכרה" ולחץ כאן
   מקבל את אותן תוצאות בדיוק, רק ממורכזות מחדש על העיר. */
function recenterHeroMap(){
  if (!heroMap) return;
  heroMap.closePopup();
  // אותה תצוגה בדיוק שאיתה הדף נפתח, כולל ההזזה אל הצד הפנוי בדסקטופ:
  // כפתור שמחזיר את העיר אל מתחת לעמודת הכותרת הוא לא "מירכוז"
  const center = cityViewCenter(CITY_ZOOM);
  if (heroMap.flyTo) heroMap.flyTo(center, CITY_ZOOM, { duration:.7 });
  else heroMap.setView(center, CITY_ZOOM, { animate:true });
}
const mapRecenterBtn = document.getElementById('mapRecenterBtn');
if (mapRecenterBtn) mapRecenterBtn.addEventListener('click', recenterHeroMap);

const mapExpandBtn = document.getElementById('mapExpandBtn');

/* הגדלה/הקטנה של המפה במקום אחד. היא נקראת משלושה מקומות — הכפתור עצמו,
   פתיחת המפה מהמצב המצומצם ("חיפוש במפה"), וכפתור הסגירה — ולכן התווית,
   ה-aria וה-invalidateSize אינם יכולים לשבת בתוך מאזין הכפתור. */
function setMapExpanded(on){
  const hero = document.getElementById('heroSection');
  if (!hero) return;
  const expanded = !!on;
  if (hero.classList.contains('map-expanded') === expanded) return;
  hero.classList.toggle('map-expanded', expanded);
  if (mapExpandBtn){
    // רק התווית מתחלפת — האייקון (חיצי הפינות) נשאר, ולכן אסור להחליף כאן
    // את כל תוכן הכפתור כמו קודם
    const label = mapExpandBtn.querySelector('.map-expand-label');
    if (label) label.textContent = expanded ? 'הקטן' : 'הגדל';
    mapExpandBtn.setAttribute('aria-label', expanded ? 'הקטנת המפה' : 'הגדלת המפה');
    mapExpandBtn.setAttribute('aria-expanded', String(expanded));
  }
  // גובה ה-hero (ואיתו המפה שממלאת אותו) משתנה ע"י מעבר קלאס עם transition;
  // Leaflet לא מזהה שינוי גודל של ה-container לבד, ובלי invalidateSize()
  // האריחים נשארים חתוכים בגודל הישן עד לפעולת משתמש נוספת (כמו גרירה)
  if (heroMap) setTimeout(()=>{ heroMap.invalidateSize({ pan:false }); fitMapToMarkers(); }, 320);
}

if (mapExpandBtn){
  mapExpandBtn.addEventListener('click', ()=>{
    const hero = document.getElementById('heroSection');
    if (hero.classList.contains('map-expanded')){
      /* "הקטן" מחזיר למצב שאיתו הדף נטען, ולא לגובה ביניים. בדסקטופ אלה
         אותם שני דברים — שם מצב הטעינה הוא ה-hero הרגיל. בטלפון מצב
         הטעינה הוא הפס המצומצם (‏.map-peek), ובלי התנאי הזה "הקטן" היה
         עוצר בגובה מסך מלא שאיש לא ביקש, ודורש לחיצה שנייה על "סגירת
         המפה" כדי לחזור למקום שממנו יצאנו. */
      if (hero.classList.contains('can-peek')) setMapPeek(true);
      else setMapExpanded(false);
      return;
    }
    setMapExpanded(true);
  });
}

/* ============================================================
   תצוגה מפוצלת: מפה לצד רשימה (דסקטופ)
   ------------------------------------------------------------
   חצי מסך מפה וחצי רשימת נכסים שמתעדכנת בזמן אמת בגרירה ובזום. הרעיון:
   הזזת המפה היא עצמה פעולת חיפוש — הרשימה עונה תמיד על "מה יש כאן, במקום
   שאני מסתכל עליו עכשיו", ולא על "מה החזירה השאילתה האחרונה".
   הרשימה נגזרת מ-mapProperties (הנכסים שמהם נבנו הפינים) ומצטמצמת לתחום
   הנראה, ולכן היא לא יכולה להיפרד מהמפה שלצדה גם אחרי חיפוש חדש.
   ============================================================ */
const SPLIT_MIN_WIDTH = 1024;   // חייב להתאים ל-@media בגיליון הסגנונות
const SPLIT_MAX_ROWS = 60;      // מעבר לזה הגלילה ארוכה מלהיות שימושית

/* מסך רחב מספיק לשתי עמודות — *ומפה שנטענה*. בלי תנאי המפה, העדפה שנשמרה
   מביקור קודם הייתה פותחת פאנל "נכסים בתחום המפה" ריק לצד מפה שלא עלתה
   (‏Leaflet חסום/נכשל), כי אין תחום נראה לסנן לפיו. */
const splitSupported = ()=> !!heroMap && window.matchMedia(`(min-width:${SPLIT_MIN_WIDTH}px)`).matches;

let splitOn = false;
// האם הגולש/ת כבר הביע/ה העדפה. בלי ההבחנה הזו אי אפשר להבדיל בין "כיבה
// במפורש" לבין "עוד לא נתקל בזה" — ורק במקרה השני מותר לפתוח אוטומטית
// אחרי החיפוש הראשון.
let splitPrefSet = false;
try {
  const stored = localStorage.getItem('shuk_split_view');
  splitPrefSet = stored !== null;
  splitOn = stored === '1';
} catch(e){ /* מצב פרטי/חסום */ }

function setSplitView(on, { remember = true } = {}){
  splitOn = !!on;
  const hero = document.getElementById('heroSection');
  const btn = document.getElementById('splitToggleBtn');
  if (hero) hero.classList.toggle('split-on', splitOn);
  if (btn){
    btn.setAttribute('aria-pressed', String(splitOn));
    btn.setAttribute('aria-label', splitOn ? 'סגירת הרשימה והצגת המפה בלבד' : 'הצגת רשימת הנכסים לצד המפה');
    const label = btn.querySelector('.split-toggle-label');
    if (label) label.textContent = splitOn ? 'מפה בלבד' : 'מפה + רשימה';
  }
  if (remember){
    splitPrefSet = true;
    try { localStorage.setItem('shuk_split_view', splitOn ? '1' : '0'); } catch(e){ /* מצב פרטי/חסום */ }
  }
  // רוחב הקונטיינר של המפה משתנה במעבר, ו-Leaflet לא מזהה שינוי גודל בעצמו:
  // בלי invalidateSize האריחים נשארים חתוכים ברוחב הישן. ההמתנה היא לאורך
  // מעבר הגובה של ה-hero (‎transition:height .3s‎), כמו בכפתור ההגדלה.
  if (heroMap) setTimeout(()=>{ heroMap.invalidateSize({ pan:false }); fitMapToMarkers(); updateSplitPanel(); }, 320);
  else updateSplitPanel();
}

/* הנכסים שנמצאים כרגע בתוך התחום הנראה של המפה, בסדר המקורי של הרשימה
   (מקודמים ואז החדשים). מסנן המקרא נאכף גם כאן: סוג עסקה שכבוי לא מצויר
   על המפה, ולכן אסור לו להופיע ברשימה שלצדה. */
function propertiesInView(){
  if (!heroMap) return [];
  let bounds;
  try { bounds = heroMap.getBounds(); } catch(e){ return []; }
  return mapProperties.filter(p =>
    p.lat && p.lng &&
    activeDealKinds.has(dealKind(p)) &&
    inDrawnArea(p) &&
    bounds.contains([Number(p.lat), Number(p.lng)]));
}

/* הנכסים שבתוך האזור שסומן, בלי קשר לתחום התצוגה. זו הרשימה שהמונה שעל
   המפה מציג ושכפתור "הצגת התוצאות" שולח לרשימה — הסימון הוא חיפוש שנשאר
   נכון גם כשגוררים את המפה הצידה, בשונה מתחום התצוגה שהוא ההפך מזה. */
function propertiesInDrawnArea(){
  if (!mapDraw || !mapDraw.hasShape()) return [];
  return mapProperties.filter(p =>
    p.lat && p.lng && activeDealKinds.has(dealKind(p)) && inDrawnArea(p));
}

function splitRowFor(id){
  const rows = document.getElementById('splitRows');
  if (!rows) return null;
  return Array.from(rows.children).find(el => el.dataset && el.dataset.propId === String(id)) || null;
}

/* הדגשה דו-כיוונית בין שורה לפין — הקישור הזה הוא כל מה שהופך שתי עמודות
   נפרדות לתצוגה אחת. המזהה המודגש נשמר ב-hotSplitId כדי שתמיד יהיה אפשר
   לכבות אותו, גם כשהשורה עצמה כבר לא קיימת. */
let hotSplitId = null;
function hotSplitRow(id, on){
  const marker = mapMarkers[id];
  if (marker){
    const el = marker.getElement();
    const pin = el && el.querySelector('.map-pin');
    if (pin) pin.classList.toggle('is-hot', !!on);
    // הרמה מעל הפינים השכנים כל עוד ההדגשה פעילה; באשכול צפוף הפין המודגש
    // היה מוסתר מתחת לשכניו
    if (marker.setZIndexOffset) marker.setZIndexOffset(on ? 1000 : 0);
  }
  const row = splitRowFor(id);
  if (row) row.classList.toggle('is-hot', !!on);
  if (on) hotSplitId = id;
  else if (hotSplitId === id) hotSplitId = null;
}

// לחיצה על פין → גלילה אל השורה שלו בפאנל והדגשתה
function revealSplitRow(id){
  if (!splitOn || !splitSupported()) return;
  if (hotSplitId && hotSplitId !== id) hotSplitRow(hotSplitId, false);
  const row = splitRowFor(id);
  if (!row) return;
  hotSplitRow(id, true);
  // block:'nearest' — גלילה בתוך הפאנל בלבד, בלי לגרור איתה את העמוד
  row.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function updateSplitPanel(){
  const rows = document.getElementById('splitRows');
  const countEl = document.getElementById('splitCount');
  const note = document.getElementById('splitNote');
  if (!rows) return;
  // כשהתצוגה כבויה אין מה לצייר; ההדלקה קוראת לפונקציה הזו בעצמה
  if (!splitOn || !splitSupported()) return;

  const inView = propertiesInView();
  const shown = inView.slice(0, SPLIT_MAX_ROWS);
  // שורה שנמחקת תוך כדי ריחוף לא מפעילה mouseleave, והפין שלה היה נשאר
  // מודגש ומורם לנצח
  if (hotSplitId) hotSplitRow(hotSplitId, false);

  if (countEl){
    countEl.textContent = inView.length
      ? (inView.length === 1 ? 'נכס אחד בתחום התצוגה' : `${inView.length} נכסים בתחום התצוגה`)
      : 'אין נכסים בתחום התצוגה';
  }

  rows.innerHTML = '';
  if (!shown.length){
    rows.innerHTML = '<div class="sr-empty">אין נכסים בתחום התצוגה הנוכחי. הזיזו את המפה או התרחקו כדי לראות עוד.</div>';
  } else {
    shown.forEach((p, i)=>{
      const row = buildSearchRow(p, i);
      row.addEventListener('mouseenter', ()=> hotSplitRow(p.id, true));
      row.addEventListener('mouseleave', ()=> hotSplitRow(p.id, false));
      row.addEventListener('focus', ()=> hotSplitRow(p.id, true));
      row.addEventListener('blur', ()=> hotSplitRow(p.id, false));
      rows.appendChild(row);
    });
  }
  // התוכן התחלף — גלילה שנשארה מהתצוגה הקודמת הייתה נוחתת באמצע רשימה אחרת
  rows.scrollTop = 0;

  if (note){
    const overflow = inView.length - shown.length;
    note.hidden = overflow <= 0;
    if (overflow > 0) note.textContent = `מוצגים ${shown.length} מתוך ${inView.length} - התקרבו במפה כדי לצמצם`;
  }
}

/* ============================================================
   הזזת המפה היא חיפוש — והרשימה שלה יושבת מיד מתחת למפה
   ------------------------------------------------------------
   עד כה "תחום המפה מסנן את הרשימה" היה קיים בתצוגה המפוצלת בלבד, כלומר
   מ-1024px ומעלה ורק למי שהדליק/ה אותה. בטלפון — ששם רוב הגולשים — גלגלת
   או שתי אצבעות הזיזו את הפינים ולא שינו שום רשימה, והרשימה היחידה שהייתה
   על המסך הייתה תיבת הנכסים שישבה אז **אחרי** הבאנרים (המבזק, רצועת
   ההדמיות, באנר היריד). כלומר מי שצמצם/ה את המפה לרחוב אחד לא ראה/תה את
   התוצאה בלי לגלול דרך שלושה באנרים — ובפועל פשוט לא ראה/תה אותה. (היום
   התיבה יושבת מיד מתחת למבזק, אבל היא עדיין הוויטרינה ולא התוצאה.)

   ‏#searchResults היא הסקציה היחידה בדף שיושבת בין ה-hero לבאנרים, ולכן
   זו הסקציה שמתמלאת כאן. הרשימה נגזרת מ-mapProperties — מה שהמפה מציגה
   כרגע — ולכן גרירה *אחרי* חיפוש מצמצמת בתוך תוצאות החיפוש ולא מבטלת אותן.

   הכניסה למצב הזה היא מחווה על המפה בלבד (‏mapViewOn), ולא כל moveend:
   ‏fitMapToMarkers, מירכוז והגדלה מזיזים את המפה בעצמם, וכל אחד מהם היה
   הופך רשימת תוצאות טרייה ל"תחום המפה" מבלי שאיש נגע בה. ‏renderPropertyGrid
   מכבה את המצב מאותה סיבה: רשימה חדשה מתחילה מהרשימה, לא מהמסגרת.
   ============================================================ */
// ‏mapViewOn, mapViewTimer ו-mapNavAt מוצהרים למעלה, לצד heroMap — שם גם
// ההסבר למה.

// המחווה, ולא התזוזה: ‏Leaflet יורה moveend גם על תזוזות שהקוד יזם, ולכן
// נקודת האמת היא האירוע שהגיע מהאצבע/העכבר על גוף המפה.
function markMapUserNav(){ mapNavAt = Date.now(); }

/* כמה זמן אחרי המחווה עוד נחשב ה-moveend שלה. גרירה וצביטה יורות אותו
   כמעט מיד; החלון הרחב מכסה זום עם אנימציה. */
const MAP_NAV_WINDOW = 1500;

/* ‏moveend נורה פעם אחת בסוף גרירה, אבל זום גלגלת יורה סדרה שלמה — ובלי
   ההשהיה הקצרה הזו כל נקישת גלגלת מציירת עשרות שורות מחדש.

   הכניסה למצב דורשת מחווה טרייה; היציאה ממנו היא renderPropertyGrid בלבד.
   מרגע שנכנסנו, כל תזוזה מעדכנת — גם הגדלת המפה וגם מירכוז — כי במצב הזה
   הרשימה *אמורה* לעקוב אחרי המפה. */
function scheduleMapViewRows(){
  if (!mapViewOn){
    if (Date.now() - mapNavAt > MAP_NAV_WINDOW) return;
    mapViewOn = true;
  }
  clearTimeout(mapViewTimer);
  mapViewTimer = setTimeout(updateMapViewRows, 160);
}

function updateMapViewRows(){
  if (!mapViewOn || !heroMap) return;
  renderSearchRows(propertiesInView(), true, { mapView:true });
}

/* יציאה מהמצב בלי לגעת ברשימה — מי שקורא לזה מצייר בעצמו מה שיבוא במקומה.
   ‏mapNavAt מתאפס גם הוא: בלעדיו מחווה שקדמה לחיפוש בשנייה האחרונה הייתה
   מדליקה את המצב מחדש דרך ה-moveend של fitMapToMarkers. */
function exitMapViewRows(){
  mapViewOn = false;
  mapNavAt = 0;
  clearTimeout(mapViewTimer);
}

const splitToggleBtn = document.getElementById('splitToggleBtn');
if (splitToggleBtn) splitToggleBtn.addEventListener('click', ()=> setSplitView(!splitOn));
const splitCloseBtn = document.getElementById('splitCloseBtn');
if (splitCloseBtn) splitCloseBtn.addEventListener('click', ()=> setSplitView(false));
// המצב נזכר בין ביקורים, אבל רק במסך שיש בו מקום לשתי עמודות. remember:false
// כדי שפתיחה במסך צר לא תמחק את ההעדפה שנשמרה בדסקטופ.
setSplitView(splitOn && splitSupported(), { remember:false });

/* ============================================================
   סימון אזור ורדיוס על המפה
   ------------------------------------------------------------
   הכלי עצמו יושב ב-assets/map-draw.js ולא יודע מה זה נכס; כאן מחברים אותו
   לחיפוש: הצורה מסננת את הפינים, את הרשימה שלצד המפה ואת רשימת התוצאות.

   **דסקטופ בלבד, במכוון.** ציור מצולע הוא סדרת לחיצות מדויקות, וגרירת ידית
   היא מחווה של עכבר. במסך מגע אותה אצבע כבר עושה דבר אחר — היא גוללת את
   הדף, וזו הייתה החלטה מפורשת (ראו assets/map-gestures.js: אצבע אחת גוללת,
   שתיים מזיזות את המפה). כלי ציור שם היה או חוטף את הגלילה חזרה או פשוט לא
   עובד. בנייד נשארים סינון השכונות והסינונים המלאים, ששניהם עונים על אותה
   שאלה בלי לדרוש יד יציבה.

   הרף הוא 1024px — אותו רף בדיוק של התצוגה המפוצלת (SPLIT_MIN_WIDTH), כי
   שניהם נשענים על אותה הנחה: יש כאן מסך רחב ומצביע מדויק.
   ============================================================ */

/* הבדיקה נקראת מ-propertiesInView שרץ בכל גרירה של המפה, ולכן היא חייבת
   להיות זולה כשאין סימון — וזה המצב הרגיל. */
function inDrawnArea(p){
  if (!mapDraw || !mapDraw.hasShape()) return true;
  return mapDraw.contains(p.lat, p.lng);
}

const MAP_DRAW_COPY = {
  live: 'פתחו את המפה עם רשימת הנכסים שלצדה',
  // בטלפון אין כלי סימון, ולכן הרצועה מתארת את מה שכן אפשר לעשות שם:
  // גרירת המפה היא עצמה חיפוש (ראו updateSplitPanel)
  touch: 'גררו את המפה - הרשימה שמתחתיה מתעדכנת לפי מה שרואים',
};

/* נקראת בטעינה ושוב בכל מעבר מעל/מתחת לרף הדסקטופ (סיבוב טאבלט, שינוי
   גודל חלון). ההרכבה עצמה קורית פעם אחת — mapDraw שכבר קיים לא נבנה שוב
   ולא מאבד את הצורה שסומנה בו. */
function initMapDraw(){
  const tools = document.getElementById('mapTools');
  const areaBtn = document.getElementById('drawAreaBtn');
  const radiusBtn = document.getElementById('drawRadiusBtn');
  const clearBtn = document.getElementById('drawClearBtn');
  const mapCta = document.getElementById('heroMapCta');
  const ctaText = document.getElementById('heroMapCtaText');
  const ctaGo = mapCta && mapCta.querySelector('.hero-mapcta-go');

  const canDraw = !!heroMap && !!window.MapDraw && splitSupported();

  if (mapCta){
    mapCta.classList.toggle('is-static', !canDraw);
    if (canDraw) mapCta.removeAttribute('aria-disabled');
    else mapCta.setAttribute('aria-disabled', 'true');
    if (ctaText) ctaText.textContent = canDraw ? MAP_DRAW_COPY.live : MAP_DRAW_COPY.touch;
    if (ctaGo) ctaGo.hidden = !canDraw;
  }

  if (!canDraw){
    if (tools) tools.hidden = true;
    return;
  }
  tools.hidden = false;
  // כלי הסימון הם חלק מהחסימות של השטח הפנוי (ראו visibleMapPadding), ולכן
  // הופעתם והיעלמותם מזיזה את הבועיות שיושבות על המפה
  syncMapFreeArea();
  // הכלי כבר מורכב — נשאר רק להחזיר את הסרגל למסך
  if (mapDraw) return;

  mapDraw = MapDraw.attach(heroMap, {
    onChange: onDrawnAreaChange,
    onModeChange: (mode)=>{
      areaBtn.setAttribute('aria-pressed', String(mode === 'area'));
      radiusBtn.setAttribute('aria-pressed', String(mode === 'radius'));
    }
  });

  areaBtn.addEventListener('click', ()=>{
    if (mapDraw.mode() === 'area') mapDraw.cancel();
    else mapDraw.startArea();
  });
  radiusBtn.addEventListener('click', ()=>{
    if (mapDraw.mode() === 'radius') mapDraw.cancel();
    else mapDraw.startRadius();
  });
  clearBtn.addEventListener('click', ()=> mapDraw.clear());

  /* ‏**הרצועה פותחת מפה ורשימה — ולא מתחילה לצייר.**
     קודם היא קראה גם ל-‎mapDraw.startArea()‎, כלומר לחיצה אחת על "חיפוש
     במפה" הכניסה את מי שלחץ/ה ישר למצב סימון מצולע — סרגל שאומר "לחצו על
     המפה כדי לסמן את פינות האזור, לפחות שלוש", עם "ביטול" ו"סיום". מי
     שביקש/ה לראות את המפה קיבל/ה מטלה, ובלי שביקש/ה.

     מה שנשאר הוא שתי הפעולות שהרצועה באמת מבטיחה: התצוגה המפוצלת (מפה
     ורשימה זו לצד זו) והגדלת המפה. כלי הסימון והרדיוס ממשיכים לשבת על המפה
     עצמה (‎.map-tools‎), וכשמישהו/י באמת רוצה לסמן — הם שם, במרחק לחיצה,
     ביוזמתו/ה.

     הסדר אינו מקרי: ‏setSplitView משנה את רוחב הקונטיינר של המפה וקוראת
     ל-invalidateSize, ולכן היא קודמת להגדלה. מי שכבר במצב מפוצל לא מושפע/ת
     — הקריאה מגודרת ב-‎if (!splitOn)‎. */
  mapCta.addEventListener('click', ()=>{
    if (!splitOn) setSplitView(true);
    setMapExpanded(true);
    document.getElementById('heroSection')?.scrollIntoView({ behavior:'smooth', block:'start' });
  });
}

/* התוצאה של הסימון בשלושה מקומות: הפינים שמחוץ לאזור יורדים מהמפה, הרשימה
   שלצדה מצטמצמת, והמונה שבפינה מודיע כמה נשארו. */
function onDrawnAreaChange(shape){
  const clearBtn = document.getElementById('drawClearBtn');
  const result = document.getElementById('areaResult');
  const countEl = document.getElementById('areaResultCount');

  if (clearBtn) clearBtn.hidden = !shape;

  // אותה לוגיקה של המקרא: פין שאינו רלוונטי יורד מהמפה במקום להתעמעם
  Object.values(mapMarkers).forEach(m => {
    const on = activeDealKinds.has(m.options.dealKind) && (!shape || mapDraw.contains(m.getLatLng().lat, m.getLatLng().lng));
    if (on && !heroMap.hasLayer(m)) m.addTo(heroMap);
    else if (!on && heroMap.hasLayer(m)) heroMap.removeLayer(m);
  });
  relayoutMapPins();
  updateSplitPanel();

  if (!shape){
    if (result) result.hidden = true;
    return;
  }

  const found = propertiesInDrawnArea();
  if (countEl){
    countEl.textContent = found.length === 0 ? 'אין נכסים באזור שסימנתם'
      : found.length === 1 ? 'נכס אחד באזור שסימנתם'
      : `${found.length} נכסים באזור שסימנתם`;
  }
  if (result){
    result.hidden = false;
    // אזור ריק הוא תשובה, אבל אין מה להציג ברשימה מתחת
    result.querySelector('.area-result-go').hidden = !found.length;
  }
  // מתקרבים למה שסומן: הצורה עצמה היא עכשיו החיפוש
  const b = mapDraw.bounds();
  if (b) heroMap.fitBounds(b, { padding:[60,60], maxZoom:16 });
}

/* "הצגת התוצאות" — הסימון הוא חיפוש, והמקום שבו קוראים תוצאות הוא רשימת
   התוצאות שמתחת למפה, לא הפינים. */
document.getElementById('areaResult')?.addEventListener('click', ()=>{
  const found = propertiesInDrawnArea();
  if (!found.length) return;
  renderSearchRows(found, true);
  document.getElementById('searchResults')?.scrollIntoView({ behavior:'smooth', block:'start' });
});

initMapDraw();
// סיבוב טאבלט או שינוי גודל חלון חוצה את הרף — הכלים נכנסים ויוצאים איתו,
// והצורה שכבר סומנה שורדת את המעבר
window.matchMedia(`(min-width:${SPLIT_MIN_WIDTH}px)`).addEventListener('change', initMapDraw);

/* ============================================================
   טלפון: המפה נטענת מצומצמת ונפתחת בלחיצה
   ------------------------------------------------------------
   ‏hero בגובה מסך כמעט מלא שמתוכו נראה פס מפה אחד הוא המחיר הכבד ביותר
   שדף הבית שילם בטלפון: כל מה שמתחתיו — ההדמיות, הנכסים, משרדי התיווך —
   התחיל מתחת לקו הקיפול. במצב המצומצם (‏.map-peek) התוכן נערם מעל המפה
   במקום עליה, והמפה היא רצועה של ‎--peek-h‎ בתחתית ה-hero. ראו ה-CSS.

   המפה **נטענת** במצב הזה ולא נדחית: Leaflet כבר אותחל, האריחים והפינים
   שלו על המסך, ולכן הפתיחה היא שינוי גובה ו-invalidateSize ולא אתחול —
   אין המתנה ואין קפיצה.

   דרך אחת פנימה ואחת החוצה: לחיצה על הפס עצמו (הוא לחיץ לכל רוחבו, עם
   גלולה שאומרת מה קורה בלחיצה), ולחיצה על כפתור הסגירה שבסרגל הפקדים בדרך
   חזרה. קודם הייתה כאן דרך שנייה — רצועת ה-CTA שמתחת לסרגל החיפוש — והיא
   ירדה: היא חזרה על מה שכתוב על הפס עצמו, בשורה נפרדת מעל הקיפול. ראו
   ‎.hero.map-peek .hero-mapcta‎ ב-CSS.
   ============================================================ */
const MAP_PEEK_MQ = window.matchMedia('(max-width:759px)');

function heroEl(){ return document.getElementById('heroSection'); }
function mapPeekOn(){ return !!heroEl()?.classList.contains('map-peek'); }

function setMapPeek(on){
  const hero = heroEl();
  // מפה שנפלה היא כבר בלוק תוכן רגיל (‏.map-failed) ואין בה מה לצמצם
  if (!hero || hero.classList.contains('map-failed')) return;
  if (hero.classList.contains('map-peek') === !!on) return;

  hero.classList.toggle('map-peek', !!on);
  // הצמצום מבטל גם את ההגדלה: ‎.map-peek‎ גובר ממילא על ‎.map-expanded‎
  // בגיליון הסגנונות, אבל קלאס שנשאר תלוי על ה-hero היה חוזר לחיים בפתיחה
  // הבאה — ומחזיר גובה שכבר בוטל. גם מעבר רוחב (סיבוב מכשיר) עובר כאן.
  if (on) setMapExpanded(false);
  document.getElementById('mapPeekOpen')?.setAttribute('aria-expanded', String(!on));
  // הרצועה מוסתרת כל עוד המפה מצומצמת (ראו ה-CSS), ולכן אין מה לסנכרן
  // בכניסה למצב; ביציאה ממנו היא חוזרת וצריכה את הנוסח של המפה הפתוחה.
  if (!on) initMapDraw();

  // Leaflet לא מזהה שינוי גובה של ה-container לבד; ההמתנה קצרה כי אין כאן
  // אנימציית גובה (‏height:auto לא עובר transition) — היא רק נותנת לדפדפן
  // לסיים את הפריסה החדשה לפני המדידה.
  if (heroMap) setTimeout(()=>{
    heroMap.invalidateSize({ pan:false });
    fitMapToMarkers();
    updateSplitPanel();
  }, 60);
}

function openMapFromPeek(){
  if (!mapPeekOn()) return false;
  setMapPeek(false);
  /* המפה נפתחת *מוגדלת*, ולא בגובה ה-hero הרגיל. מי שלוחץ/ת "חיפוש במפה"
     ביקש/ה בדיוק דבר אחד — לראות את המפה — ובגובה הרגיל היא נפתחת עם
     סרגל החיפוש, הכותרת והשבבים צפים עליה, כלומר שוב פס מפה עם תוכן מעליו.
     "הקטן" בסרגל שעל המפה מחזיר לגובה הרגיל, ו"סגירת המפה" חוזר בבת אחת
     למצב שאיתו דף הבית נטען. */
  setMapExpanded(true);
  // בלי הגלילה הזו המפה נפתחת מחוץ למסך: הפס שנלחץ יושב בתחתית התצוגה,
  // והגובה החדש נפרס כולו *מעליו*.
  heroEl()?.scrollIntoView({ behavior:'smooth', block:'start' });
  return true;
}

document.getElementById('mapPeekOpen')?.addEventListener('click', openMapFromPeek);
document.getElementById('mapCollapseBtn')?.addEventListener('click', ()=>{
  // ‏setMapPeek(true) מורידה איתה גם את ההגדלה, ולכן "סגירת המפה" מחזירה
  // בלחיצה אחת בדיוק את מצב הטעינה של דף הבית.
  setMapPeek(true);
  heroEl()?.scrollIntoView({ behavior:'smooth', block:'start' });
});

/* ‏.can-peek מסמן שההתנהגות בכלל רלוונטית לרוחב הנוכחי — הוא מה שמדליק את
   כפתור הסגירה כשהמפה פתוחה, בלי שהוא יופיע בדסקטופ. */
function applyMapPeekMode(){
  const hero = heroEl();
  if (!hero) return;
  const narrow = MAP_PEEK_MQ.matches && !hero.classList.contains('map-failed');
  hero.classList.toggle('can-peek', narrow);
  setMapPeek(narrow);
}
applyMapPeekMode();
if (MAP_PEEK_MQ.addEventListener) MAP_PEEK_MQ.addEventListener('change', applyMapPeekMode);
else if (MAP_PEEK_MQ.addListener) MAP_PEEK_MQ.addListener(applyMapPeekMode);

/* ============================================================
   שורת המספרים והתגיות שמעל הכותרת
   ------------------------------------------------------------
   כל מספר כאן נספר מהנתונים שכבר נטענו לעמוד — ולא נכתב בטקסט. תגית
   שמבטיחה "340 נכסים עם הדמיה" מעל מלאי של שלושה היא הדרך המהירה ביותר
   לאבד את מי שהגיע/ה, ולכן כל אלמנט כאן נשאר hidden עד שיש לו מה להראות.
   ‏hidden ולא "0": שורת מספרים שכולה אפסים גרועה מהיעדרה.

   ‏heroStatsState עצמו מוצהר למעלה, לצד heroMap — שם גם ההסבר למה.
   ============================================================ */
function renderHeroStats(){
  const box = document.getElementById('heroStats');
  /* "0 משרדי תיווך" הוא לא נתון אלא הודעת תקלה שמתחזה לנתון — שאילתה
     שנכשלה ומאגר ריק נראים אותו דבר. מספר שהוא אפס מוריד את הפריט שלו,
     ואיתו את הקו המפריד שלפניו. */
  const setNum = (id, v)=>{
    const el = document.getElementById(id);
    if (!el) return;
    const stat = el.closest('.hero-stat');
    if (!v){ if (stat) stat.hidden = true; return; }
    el.textContent = v.toLocaleString('he-IL');
    if (stat) stat.hidden = false;
  };
  setNum('heroStatProps', heroStatsState.props);
  setNum('heroStatAgencies', heroStatsState.agencies);
  if (box && (heroStatsState.props || heroStatsState.agencies)) box.hidden = false;

  const aiBadge = document.getElementById('heroAiBadge');
  const aiCount = document.getElementById('heroAiCount');
  if (aiBadge && aiCount && heroStatsState.ai){
    aiCount.textContent = heroStatsState.ai === 1
      ? 'נכס אחד עם הדמיית AI'
      : `${heroStatsState.ai.toLocaleString('he-IL')} נכסים עם הדמיית AI`;
    aiBadge.hidden = false;
  }

  const todayBadge = document.getElementById('heroTodayBadge');
  const todayCount = document.getElementById('heroTodayCount');
  if (todayBadge && todayCount && heroStatsState.today){
    todayCount.textContent = heroStatsState.today === 1
      ? 'נכס אחד נוסף היום'
      : `${heroStatsState.today} נכסים נוספו היום`;
    todayBadge.hidden = false;
  }
}

/* "נוסף היום" נמדד מול חצות המקומית ולא מול "לפני 24 שעות": מי שקורא/ת
   "נוספו היום" מתכוון/ת ליום קלנדרי. */
function countAddedToday(properties){
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return properties.filter(p => p.created_at && new Date(p.created_at) >= midnight).length;
}

// התגית היא הדרך הקצרה ביותר למסנן ההדמיות, שעד היום הגיעו אליו רק דרך ‎?ai=1‎
document.getElementById('heroAiBadge')?.addEventListener('click', ()=> ShukSearch.applyAiFilter());

/* ---------- שבבי החיפוש המהיר ---------- */
document.getElementById('heroQuick')?.addEventListener('click', (e)=>{
  const chip = e.target.closest('.hero-chip');
  if (!chip) return;
  if (chip.dataset.ai){ ShukSearch.applyAiFilter(); return; }
  const field = document.getElementById('searchFreeText');
  if (!field) return;
  field.value = chip.dataset.q || '';
  document.getElementById('searchSubmitBtn')?.click();
});

/* ============================================================
   באנר ההדמיות — בסוף תיבת הנכסים
   ------------------------------------------------------------
   כאן ישבה רצועת "לפני ואחרי" גדולה, מיד מתחת למבזק: שתי הדמיות, לוח
   סגנונות ו-CTA — מסך שלם שדחף את הנכסים עצמם למטה. מה שנשאר ממנה הוא
   באנר בגובה שורה אחת בתוך התיבה (‏cfg.afterGrid של המדף), עם אותם שני
   פתחים: מסנן ההדמיות ואשף הערכת השווי.

   המספר נכתב רק כשהוא ידוע — מ-visualizedIds, אחרי שהנכסים נטענו — ולכן
   הבאנר נולד hidden ונחשף ב-showAiPromo(). אין אף נכס פעיל עם הדמיה →
   הוא לא נחשף: הבטחה בלי תוצר מאחוריה היא בדיוק מה שהרצועה הכללית שלפניה
   נכשלה בו. התמונון נטען בנפרד ואינו תנאי — באנר בלי תמונון הוא באנר שלם.
   ============================================================ */
function showAiPromo(count){
  const box = document.getElementById('aiPromo');
  if (!box || !count) return;
  const n = count.toLocaleString('he-IL');
  document.getElementById('aiPromoCount').textContent = n;
  /* שני נוסחים לאותו כפתור: בדסקטופ כפתור זהב ("הצגת N הנכסים"), ובטלפון
     קישור קטן שאומר גם מה מסונן ("לכל N הנכסים עם הדמיה") — הכותרת שמעליו
     כבר לא נושאת את משפט ההסבר. ה-CSS מציג אחד מהם. */
  const go = document.getElementById('aiPromoGo');
  go.replaceChildren();
  [['ai-promo-go-long', count === 1 ? 'לצפייה בנכס ←' : `לצפייה ב-${n} הנכסים ←`],
   ['ai-promo-go-short', count === 1 ? 'לנכס עם ההדמיה ←' : `לכל ${n} הנכסים עם הדמיה ←`]]
    .forEach(([cls, text])=>{
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      go.appendChild(span);
    });
  box.hidden = false;
}

async function initAiPromoThumb(){
  const thumb = document.getElementById('aiPromoThumb');
  if (!thumb || !sb) return;
  let rows = [];
  try{
    const { data, error } = await sb.from('property_visualizations_public')
      .select('kind, target, source_image_url, result_url')
      .order('created_at', { ascending:false })
      .limit(30);
    if (error) throw error;
    rows = (data || []).filter(r => r.source_image_url && r.result_url);
  } catch(e){
    console.warn('טעינת ההדמיה לבאנר נכשלה, הבאנר יוצג בלי תמונון:', e);
    return;
  }
  /* הסלון הוא ההדמיה שהכי קל לקרוא במבט אחד, ובתמונון בגודל הזה זה
     ההבדל בין "רואים את השינוי" לבין שני כתמים. */
  const row = rows.find(r => r.target === 'living_room') || rows[0];
  if (!row) return;
  // ‏escAttr על הכתובות — הן מגיעות מהמסד
  thumb.innerHTML =
    `<img src="${escAttr(row.source_image_url)}" alt="" loading="lazy" decoding="async">` +
    `<div class="ai-promo-after"><img src="${escAttr(row.result_url)}" alt="" loading="lazy" decoding="async"></div>` +
    `<div class="ai-promo-handle"></div>`;
  thumb.hidden = false;
}

document.getElementById('aiPromoGo')?.addEventListener('click', ()=> ShukSearch.applyAiFilter());

/* ה-CTA פותח את אשף הערכת השווי שכבר בעמוד במקום טופס שני משלו: שני
   טפסים שמבקשים את אותם פרטים ומנתבים לאותו מקום הם שני מקורות אמת
   לאותו ליד. הכפתור פותח את הבאנר אם הוא סגור, וגולל אליו בכל מקרה. */
document.getElementById('aiPromoCta')?.addEventListener('click', ()=>{
  const start = document.getElementById('ownerStartBtn');
  if (start && start.getAttribute('aria-expanded') !== 'true') start.click();
  document.getElementById('ownerBanner')?.scrollIntoView({ behavior:'smooth', block:'center' });
});

initAiPromoThumb();

/* ============================================================
   שכונות: סינון לפי שכונות וסימון על המפה
   ------------------------------------------------------------
   בעפולה ובעמק המיקום שקובע נקרא ברמת השכונה — "רובע יזרעאל", "גבעת המורה",
   "לב העמק C1" — ולא ברמת העיר; מי שמחפש כאן כבר יודע באיזו עיר. רשימת
   הבחירה נבנית מהנכסים הפעילים עצמם, ולכן מוצגות בה רק שכונות שיש בהן מה
   למצוא, והמונה שליד כל שכונה הוא מספר הנכסים שבאמת ימתינו מעבר לבחירה.

   הבחירה היא *קבוצה*: אפשר לסמן כמה שכונות ולראות את כולן יחד על המפה.
   מי שמתלבט/ת בין שתי שכונות שכנות משווה ביניהן במבט אחד במקום לעבור
   ביניהן ולזכור מה היה בשנייה.
   ============================================================ */
const HOOD_MIN_RADIUS_M = 450;   // רדיוס מינימלי, שלא ייווצר עיגול זעיר סביב נכס בודד
const HOOD_RADIUS_PAD_M = 220;   // שוליים סביב הנכס הרחוק ביותר בשכונה

const hoodState = {
  rows: [],                // כל השכונות מה-DB
  byId: new Map(),
  counts: new Map(),       // מזהה שכונה → מספר נכסים פעילים
  centers: new Map(),      // מזהה שכונה → { center:[lat,lng], radius }
  selected: new Set(),     // מזהי השכונות שנבחרו; ריק = כל השכונות
  draft: new Set(),        // הסימון שבתוך המודאל, לפני "הצגת תוצאות"
};
// הסימונים של השכונות הנבחרות: מצולע כשיש boundary, ואחרת עיגול (ראו drawHoodShapes)
let hoodShapes = [];

/* ‏select('*') בכוונה: העמודות הגאוגרפיות (lat/lng/radius_m) נוספות
   במיגרציה 20260830120000, ובחירה מפורשת בהן הייתה מפילה את הטעינה בכל
   סביבה שהמיגרציה עוד לא רצה בה. הטבלה קטנה ואין בה שדות רגישים. */
async function loadNeighborhoods(){
  if (!sb) return [];
  try{
    const { data, error } = await sb.from('neighborhoods').select('*');
    if (error) throw error;
    return data || [];
  } catch(e){
    console.warn('טעינת השכונות נכשלה, ממשיכים בלי גלולות השכונה:', e);
    return [];
  }
}

/* כל הנכסים הפעילים במאגר, כפי שנטענו לעמוד. מקור המונים והמרכזים של
   השכונות — ולכן נשמר בנפרד מ-mapProperties, שמתחלף עם כל חיפוש. */
let allActiveProperties = [];

/* מרכז ורדיוס לכל שכונה — רק בשביל עיגול ברירת המחדל, לשכונה שאין לה עדיין
   ‏boundary. סימון ידני ב-DB (lat/lng/radius_m) גובר; בהיעדרו הם נגזרים
   מהנכסים עצמם — ממוצע הקואורדינטות, ורדיוס עד הנכס הרחוק ביותר ממנו.
   שני החישובים האלה מתארים את מיקום *המודעות* ולא את גבולות השכונה, ולכן
   הם ברירת מחדל ולא היעד: היעד הוא המצולע (ראו drawHoodShapes).
   נגזר מכל הנכסים הפעילים ולא מהמסוננים: מרכז השכונה אינו תלוי בסוג העסקה
   שנבחר, ויותר נקודות = מרכז מדויק יותר. */
function computeHoodGeometry(properties){
  hoodState.centers = new Map();
  const points = new Map();

  properties.forEach(p=>{
    const id = p.neighborhood_id;
    if (!id || !p.lat || !p.lng) return;
    if (!points.has(id)) points.set(id, []);
    points.get(id).push([Number(p.lat), Number(p.lng)]);
  });

  hoodState.rows.forEach(h=>{
    const list = points.get(h.id) || [];
    const manualLat = Number(h.lat), manualLng = Number(h.lng);
    let center = (h.lat != null && h.lng != null && Number.isFinite(manualLat) && Number.isFinite(manualLng))
      ? [manualLat, manualLng]
      : null;
    if (!center && list.length){
      center = [
        list.reduce((sum, pt)=> sum + pt[0], 0) / list.length,
        list.reduce((sum, pt)=> sum + pt[1], 0) / list.length,
      ];
    }
    if (!center) return;

    let radius = Number(h.radius_m) || 0;
    if (!radius && list.length && window.L){
      const c = L.latLng(center);
      radius = list.reduce((max, pt)=> Math.max(max, c.distanceTo(L.latLng(pt))), 0) + HOOD_RADIUS_PAD_M;
    }
    hoodState.centers.set(h.id, { center, radius: Math.max(HOOD_MIN_RADIUS_M, Math.round(radius)) });
  });
}

/* הסימון של השכונה הנבחרת על המפה.

   שכונה אינה עיגול. גבעת המורה נפרסת על מדרון, רובע יזרעאל הוא מרובע כלוא
   בין שדרות רבין לנחל חרוד, ומרכז העיר צר וארוך — עיגול סביב מרכז המסה שלהן
   או גולש הרחק אל השכונות השכנות או קוטע להן חצי. לכן הצורה הראשית היא
   *מצולע* מ-neighborhoods.boundary, והעיגול נשאר רק כברירת מחדל לשכונה
   שעדיין לא סומנה — שם הוא לפחות אומר "בערך כאן" ולא מתיימר לתחום.

   הקו מקווקו בשני המקרים: זהו סימון של אזור, לא גבול מוניציפלי מדויק.
   שכבת overlayPane יושבת מתחת לפינים ולכן הסימון לא מסתיר אותם.
   הצבע קבוע ולא ‎var(--gold)‎: ‏Leaflet כותב אותו כ-presentation attribute על
   ה-path, ושם ‎var()‎ אינו נתמך. */
const HOOD_SHAPE_STYLE = {
  interactive:false,
  color:'#0e2a6b', weight:2, opacity:.85, dashArray:'6 5',
  fillColor:'#0e2a6b', fillOpacity:.06,
};

/* מצייר סימון לכל אחת מהשכונות הנבחרות. כשנבחרו כמה, כל אחת מקבלת מצולע
   משלה ולא מעטפת אחת סביב כולן: מעטפת משותפת הייתה בולעת את השטח שביניהן
   ומבטיחה נכסים שאינם שם. */
function drawHoodShapes(){
  if (!heroMap) return;
  hoodShapes.forEach(shape => heroMap.removeLayer(shape));
  hoodShapes = [];

  hoodState.selected.forEach(id=>{
    const hood = hoodState.byId.get(id);
    const ring = parseBoundary(hood && hood.boundary);
    if (ring){
      hoodShapes.push(L.polygon(ring, HOOD_SHAPE_STYLE).addTo(heroMap));
      return;
    }
    const geo = hoodState.centers.get(id);
    if (geo) hoodShapes.push(L.circle(geo.center, { radius:geo.radius, ...HOOD_SHAPE_STYLE }).addTo(heroMap));
  });
}

/* ‏boundary הוא מערך של זוגות [lat,lng] ב-jsonb. הוא נערך ידנית ב-DB, ולכן
   נבדק כאן ולא מונח: טבלה עם מצולע פגום צריכה להוריד את הסימון לעיגול
   ברירת המחדל, לא לשבור את המפה. */
function parseBoundary(raw){
  if (!raw) return null;
  let ring = raw;
  if (typeof ring === 'string'){
    try { ring = JSON.parse(ring); } catch(e){ return null; }
  }
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const pts = ring
    .filter(p => Array.isArray(p) && p.length >= 2)
    .map(p => [Number(p[0]), Number(p[1])])
    .filter(([lat, lng]) =>
      Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  return pts.length >= 3 ? pts : null;
}

/* מספר הנכסים בכל שכונה — לפי סוג העסקה שנבחר בסרגל החיפוש, כלומר בדיוק
   מה שהלחיצה על הגלולה תחזיר. ספירה כוללת הייתה מבטיחה "4" ומחזירה רשימה
   ריקה כשארבעת הנכסים האלה מסחריים והבורר עומד על "מכירה". התנאים כאן הם
   בכוונה אותם תנאים שב-runSearch, ולכן הם מתעדכנים איתו. */
function hoodCounts(){
  const isCommercial = searchState.activeTab === 'commercial';
  const category = isCommercial ? 'commercial' : 'residential';
  const dealType = isCommercial ? searchState.c.deal : searchState.activeTab;
  const counts = new Map();
  allActiveProperties.forEach(p=>{
    if (!p.neighborhood_id) return;
    if (p.category !== category) return;
    // dealType ריק = "הכול" במסחרי, ואז המונה סופר את שני סוגי העסקה יחד
    if (dealType && p.deal_type !== dealType) return;
    counts.set(p.neighborhood_id, (counts.get(p.neighborhood_id) || 0) + 1);
  });
  return counts;
}

/* השכונות שמוצעות לבחירה: אלה שיש בהן נכסים מסוג העסקה הנוכחי, מהגדולה
   לקטנה. שכונה שנבחרה נשארת ברשימה גם כשאין בה נכסים מסוג העסקה הנוכחי —
   אחרת הבחירה הפעילה נעלמת מהמסך ואי אפשר לבטל אותה. */
function hoodChoices(){
  // *כל* השכונות, ולא רק אלה שיש בהן נכסים. הרשימה המקוצרת נראתה כמו תקלה:
  // מי שיודע שיש בעפולה ארבע-עשרה שכונות ורואה שתיים מסיק שהסינון שבור, ולא
  // שאין נכסים בשאר. שכונה ריקה מוצגת עם 0 ומעומעמת (ראו renderHoodOptions) —
  // "אין כאן כרגע" היא תשובה, ורשימה חסרה אינה.
  //
  // היוצא מן הכלל היחיד הוא אזור *בתכנון* (is_planned) שאין בו נכסים: שטח
  // שטרם נבנה אינו "אין כאן כרגע" אלא מקום שאי אפשר לחפש בו דירה, והוא רק
  // מאריך רשימה שממילא ארוכה. ברגע שייכנס בו נכס ראשון המונה יעלה והוא
  // יופיע מעצמו, בלי שאיש יגע בהגדרה.
  //
  // הבדיקה מול selected ו-draft גם יחד אינה עודפת: קישור עמוק יכול לשאת
  // מזהה של אזור כזה, והסתרתו הייתה משאירה בחירה פעילה שאי אפשר לבטל.
  return hoodState.rows.slice().filter(h =>
    !h.is_planned ||
    (hoodState.counts.get(h.id) || 0) > 0 ||
    hoodState.selected.has(h.id) ||
    hoodState.draft.has(h.id)
  ).sort((a, b)=>
    ((hoodState.counts.get(b.id) || 0) - (hoodState.counts.get(a.id) || 0)) ||
    String(a.name).localeCompare(String(b.name), 'he'));
}

/* הכפתור שמעל המפה: שם השכונה כשנבחרה אחת, ומונה כשנבחרו כמה. שם מלא ולא
   "1 שכונה" — כשהבחירה יחידה היא גם הכותרת של מה שרואים על המפה. */
function renderHoodFilter(){
  const bar = document.getElementById('hoodBar');
  const btn = document.getElementById('hoodFilterBtn');
  const label = document.getElementById('hoodFilterLabel');
  const badge = document.getElementById('hoodFilterCount');
  if (!bar || !btn || !label || !badge) return;
  hoodState.counts = hoodCounts();

  // הכפתור מוסתר רק כשאין שכונות בכלל (טעינה שנכשלה, או מסד ריק)
  if (!hoodState.rows.length){ bar.hidden = true; return; }
  bar.hidden = false;

  const n = hoodState.selected.size;
  btn.dataset.active = String(n > 0);
  badge.hidden = n < 2;
  badge.textContent = n;

  if (n === 0) label.textContent = 'סינון לפי שכונות';
  else if (n === 1) label.textContent = hoodState.byId.get([...hoodState.selected][0])?.name || 'שכונה אחת';
  else label.textContent = 'שכונות נבחרות';
}

/* רשימת תיבות הסימון שבמודאל. נבנית מחדש בכל פתיחה, כי המונים משתנים עם
   סוג העסקה. הסימון נאסף ל-hoodState.draft ומוחל רק ב"הצגת תוצאות". */
function renderHoodOptions(){
  const wrap = document.getElementById('hoodFilterOptions');
  if (!wrap) return;
  wrap.innerHTML = '';

  hoodChoices().forEach(h=>{
    const n = hoodState.counts.get(h.id) || 0;
    // שכונה בלי נכסים מסוג העסקה הנבחר מוצגת אבל לא נבחרת: הבחירה בה הייתה
    // מחזירה רשימה ריקה ותו לא. אם היא כבר מסומנת היא נשארת פעילה, אחרת אי
    // אפשר היה לבטל בחירה שהמונה שלה ירד ל-0 אחרי החלפת סוג העסקה.
    const empty = n === 0 && !hoodState.draft.has(h.id);

    const row = document.createElement('label');
    row.className = 'hood-option' + (empty ? ' hood-option--empty' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = h.id;
    box.checked = hoodState.draft.has(h.id);
    box.disabled = empty;
    box.addEventListener('change', ()=>{
      if (box.checked) hoodState.draft.add(h.id); else hoodState.draft.delete(h.id);
    });
    row.appendChild(box);

    // textContent ולא innerHTML: שמות שכונות מוזנים ע"י משתמשי הפלטפורמה
    // (‏neighborhoods.is_custom‎), ואסור להם להגיע ל-DOM כ-HTML
    const name = document.createElement('span');
    name.className = 'hood-option-name';
    name.textContent = h.name;
    row.appendChild(name);

    const count = document.createElement('span');
    count.className = 'hood-count';
    count.textContent = n;
    row.appendChild(count);

    wrap.appendChild(row);
  });

  // ההסבר על העמעום מוצג רק כשיש מה להסביר
  const note = document.getElementById('hoodEmptyNote');
  if (note) note.hidden = !wrap.querySelector('.hood-option--empty');
}

/* החלת הבחירה מריצה חיפוש אמיתי מול ה-DB ולא סינון מקומי: כך היא מצטרפת
   לשאר הסינונים (מחיר, חדרים, סוג עסקה) במקום להתחרות בהם, ומחזירה גם
   נכסים שמעבר ל-300 הראשונים שנטענו לעמוד. קבוצה ריקה = כל השכונות. */
function applyHoodSelection(ids){
  hoodState.selected = new Set(ids);
  renderHoodFilter();
  drawHoodShapes();
  runSearch();
}

try {
  (async function initPropertyUI(){
    // שתי הטעינות בלתי תלויות זו בזו — הרשימה מספקת את המונים והמרכזים,
    // והטבלה מספקת את השמות והסימון הידני
    const [properties, hoods] = await Promise.all([loadProperties(), loadNeighborhoods()]);
    hoodState.rows = hoods;
    hoodState.byId = new Map(hoods.map(h => [h.id, h]));
    // תמיד מהרשימה המלאה של הנכסים הפעילים, ולא מתוצאות חיפוש: המונה שעל
    // שברשימת הבחירה הוא "כמה יש בשכונה", ואם הוא היה מצטמצם עם כל חיפוש
    // הוא היה מפסיק לענות על השאלה שבגללה מסתכלים עליו
    allActiveProperties = properties;
    heroStatsState.props = properties.length;
    heroStatsState.today = countAddedToday(properties);
    renderHeroStats();
    computeHoodGeometry(properties);
    renderHoodFilter();
    // אותה רשימת שכונות מזינה גם את הבחירה המרובה בבאנר מחפשי הנכס
    renderBuyerHoods();

    // תיבת הנכסים מוזנת מהרשימה המלאה ולא מתוצאות חיפוש: היא ויטרינה
    // קבועה של המלאי בעמוד הבית, ותוצאות החיפוש מוצגות בשורות שמתחת
    // למפה.
    renderHomeProps(properties);

    if (!searchHasRun) renderPropertyGrid(properties);

    /* תגית "הדמיית AI" מגיעה בשאילתה שנייה. היא לא מעכבת את הצגת האריחים —
       אריח בלי התגית הוא אריח שלם — ולכן היא נטענת אחריהם, ומציירת מחדש
       רק את מה שכבר על המסך. */
    PropertyCard.visualizedIds(sb, properties.map(p => p.id)).then(ids=>{
      if (!ids.size) return;
      visualizedProps = ids;
      // התגית שב-hero סופרת את אותה קבוצה בדיוק — נכסים *פעילים* עם הדמיה
      // מפורסמת — ולא את כל ההדמיות שבמסד, שרובן שייכות למודעות שכבר ירדו
      heroStatsState.ai = ids.size;
      renderHeroStats();
      // התיבה מחזיקה עותק משלה של הקבוצה (היא מציירת את האריח), ולכן
      // היא מקבלת אותה במפורש במקום לקרוא את המשתנה של העמוד
      propsShelf.setVisualized(ids);
      showAiPromo(ids.size);
      if (!searchHasRun) renderPropertyGrid(properties);
    });
  })();
} catch(e){
  console.warn('טעינת הנכסים נכשלה:', e);
}

/* ============================================================
   Advanced search: property types, features, filter modals,
   and the actual Supabase query that powers "חיפוש נכסים".
   ============================================================ */
const RESIDENTIAL_PTYPES = {
  apt: ['דירה','דירת גן','גג/פנטהאוז','דופלקס','מרתף/פרטר','טריפלקס','יחידת דיור','סטודיו/לופט'],
  house: ['בית פרטי/קוטג\'','דו משפחתי','משק חקלאי/נחלה','משק עזר'],
  other: ['מגרש','בניין מגורים','מחסן','חניה','קב\' רכישה/זכות לנכס'],
};
const COMMERCIAL_PTYPES = ['משרדים','חנויות/שטח מסחרי','מבני תעשייה','אולמות','חלל עבודה משותף','בניין משרדים','מגרשים','מחסנים','סטודיו','כללי','מרתף','חניון','בית מלון','קליניקות'];
const LISTING_FEATURES = [
  ['has_photo','עם תמונה'], ['moshav_kibbutz_only','רק מושבים וקיבוצים'],
  ['has_price','עם מחיר'], ['price_dropped','נכסים שמחירם ירד'], ['tour_3d','סיור 3D'],
];
/* שלושה מהמסננים האלה אינם דגלים במערך ‎features‎ אלא עובדה שכבר קיימת
   בעמודה של הנכס. כשהם היו דגלים ידניים בטופס הנכס הם פשוט שיקרו — סוכן/ת
   שהעלה/תה תמונות ולא סימן/ה "עם תמונה" נעלם/ה מהסינון — ולכן הם מתורגמים
   כאן לתנאי על העמודה עצמה. הצ׳קבוקסים בטופס הנכס הוסרו בהתאם.            */
const DERIVED_LISTING_FILTERS = {
  has_photo: q => q.neq('images', '{}').not('images', 'is', null),
  has_price: q => q.not('price', 'is', null),
  /* שני מסלולים לאותה שאלה: קישור לספק חיצוני, או סיור 360° שמתנגן אצלנו
     (‏has_virtual_tour, שנכתב בטריגר על property_virtual_tours). ‏or אחד
     במקום שני מסננים, כי מבחינת מי שמסמן/ת את התיבה זו יכולת אחת.
     ‎ilike.http*‎ ולא ‎not.is.null‎: הוא שולל בבת אחת גם null וגם מחרוזת
     ריקה (שקיימת בנכסים שיובאו), וה-check במסד מחייב ממילא כתובת http. */
  tour_3d:   q => q.or('tour_3d_url.ilike.http*,has_virtual_tour.is.true'),
};
const RESIDENTIAL_PROPERTY_FEATURES = [
  ['parking','חניה'],['elevator','מעלית'],['balcony','מרפסת'],['sun_balcony','מרפסת שמש'],['ac','מיזוג'],['bars','סורגים'],
  ['accessible','גישה לנכים'],['renovated_feature','משופצת'],['furnished','מרוהטת'],['mamad','ממ״ד'],
  ['exclusive','בבלעדיות'],['building_shelter','מקלט בבניין'],['mamak','ממ״ק'],['storage','מחסן'],
];
const COMMERCIAL_PROPERTY_FEATURES = [
  ['parking','נכס עם חניה'],['elevator','מעלית'],['balcony','מרפסת'],['ac','מזגן'],['high_ceiling','תקרה גבוהה'],
  ['cameras','מצלמות'],['kitchenette','מטבחון'],['alarm','אזעקה'],['meeting_room','חדר ישיבות'],
  ['loading_ramp','רמפת העמסה'],['comms','תקשורת'],['cold_room','חדר קירור'],
];
const ROOM_OPTIONS = ['1','1.5','2','2.5','3','3.5','4','4.5','5','5.5','+6'];

const searchState = {
  activeTab: 'sale', // 'sale' | 'rent' | 'commercial'
  freeText: '',
  /* מסנן ההדמיות יושב מחוץ ל-r/c ולא בתוכם: הוא לא תלוי בסוג העסקה — נכס
     מסחרי עם הדמיה ודירה עם הדמיה עונים על אותה שאלה — ולכן מעבר בין
     הטאבים לא מאפס אותו. */
  hasAi: false,
  r: { priceMin:null, priceMax:null, rooms:new Set(), ptypes:new Set(), listingFeatures:new Set(), propertyFeatures:new Set(), condition:'', projectStatus:'', floorMin:null, floorMax:null, sizeMin:null, sizeMax:null, moveInDate:'', moveInSoon:false, freeText:'' },
  // deal:'' = שני סוגי העסקה המסחריים יחד (ראו ההערה ליד הבורר ב-HTML)
  c: { deal:'', priceMin:null, priceMax:null, rooms:new Set(), ptypes:new Set(), listingFeatures:new Set(), propertyFeatures:new Set(), projectStatus:'', floorMin:null, floorMax:null, sizeMin:null, sizeMax:null, restrooms:'', storage:'', mamad:'', moveInDate:'', moveInSoon:false, freeText:'' },
};

function renderPills(container, options, selectedSet, labelFn){
  container.innerHTML = '';
  options.forEach(opt=>{
    const value = Array.isArray(opt) ? opt[0] : opt;
    const label = Array.isArray(opt) ? opt[1] : opt;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = selectedSet.has(value) ? 'active' : '';
    btn.addEventListener('click', ()=>{
      if (selectedSet.has(value)) selectedSet.delete(value); else selectedSet.add(value);
      btn.classList.toggle('active');
    });
    container.appendChild(btn);
  });
}
function renderCheckboxes(container, items, selectedSet){
  container.innerHTML = '';
  items.forEach(([value, label])=>{
    const wrap = document.createElement('label');
    wrap.className = 'checkbox-item';
    wrap.innerHTML = `<input type="checkbox" value="${value}" ${selectedSet.has(value)?'checked':''}> ${label}`;
    wrap.querySelector('input').addEventListener('change', (e)=>{
      if (e.target.checked) selectedSet.add(value); else selectedSet.delete(value);
    });
    container.appendChild(wrap);
  });
}

function syncCommercialDealToggle(){
  document.querySelectorAll('.deal-toggle[aria-label="סוג עסקה מסחרי"] button').forEach(b=>
    b.classList.toggle('active', b.dataset.cdeal === searchState.c.deal));
}

function initFilterModals(){
  renderPills(document.getElementById('rRoomsPills'), ROOM_OPTIONS, searchState.r.rooms);
  Object.entries(RESIDENTIAL_PTYPES).forEach(([cat, list])=>{
    renderPills(document.querySelector(`[data-ptype-cat="${cat}"]`), list, searchState.r.ptypes);
  });
  renderCheckboxes(document.getElementById('rListingFeatures'), LISTING_FEATURES, searchState.r.listingFeatures);
  renderCheckboxes(document.getElementById('rPropertyFeatures'), RESIDENTIAL_PROPERTY_FEATURES, searchState.r.propertyFeatures);

  renderPills(document.getElementById('cPtypePills'), COMMERCIAL_PTYPES, searchState.c.ptypes);
  renderPills(document.getElementById('cRoomsPills'), ROOM_OPTIONS, searchState.c.rooms);
  renderCheckboxes(document.getElementById('cListingFeatures'), LISTING_FEATURES, searchState.c.listingFeatures);
  renderCheckboxes(document.getElementById('cPropertyFeatures'), COMMERCIAL_PROPERTY_FEATURES, searchState.c.propertyFeatures);

  document.querySelectorAll('.tri-toggle').forEach(group=>{
    const key = group.dataset.tri.replace('c','').toLowerCase(); // cRestrooms -> restrooms
    group.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        group.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        searchState.c[key] = btn.dataset.val;
      });
    });
    group.querySelector('button[data-val=""]')?.classList.add('active');
  });

  // הסימון נגזר מהמצב ולא נשאר מה-HTML: "איפוס" מחזיר את searchState.c.deal
  // ל"הכול" וקורא ל-initFilterModals, וכך גם הכפתור המסומן חוזר איתו.
  syncCommercialDealToggle();
  document.querySelectorAll('.deal-toggle[aria-label="סוג עסקה מסחרי"] button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      searchState.c.deal = btn.dataset.cdeal;
      syncCommercialDealToggle();
      // מכירה/השכרה מסחרית משנה את מה שהחיפוש יחזיר, ולכן גם את המונים
      // שברשימת השכונות
      renderHoodFilter();
    });
  });
}

// סוג העסקה נבחר מקונטיינר נפתח בתוך סרגל החיפוש (במקום שלושה טאבים).
// data-mode על ה-select צובע אותו לפי הבחירה, בהתאמה לצבעי הפינים במפה.
const dealTypeSelect = document.getElementById('dealTypeSelect');
if (dealTypeSelect){
  dealTypeSelect.addEventListener('change', ()=>{
    /* "פרויקטים חדשים" אינו סוג עסקה בטבלת properties אלא מודול נפרד עם
       מנוע חיפוש משלו, ולכן הבחירה בו מנווטת לדף הפרויקטים במקום לסנן
       את המפה. הטקסט החופשי שכבר הוקלד נוסע איתו — בלעדיו המשתמש/ת
       היה/הייתה מקליד/ה אותו פעמיים.

       הבורר מוחזר לערך הקודם לפני הניווט, כדי שחזרה אחורה בדפדפן לא
       תמצא את דף הבית עם בורר שמצביע על עמוד אחר. */
    if (dealTypeSelect.value === 'projects'){
      const q = (document.getElementById('searchFreeText').value || '').trim();
      dealTypeSelect.value = searchState.activeTab;
      location.href = '/projects' + (q ? '?q=' + encodeURIComponent(q) : '');
      return;
    }
    searchState.activeTab = dealTypeSelect.value;
    dealTypeSelect.dataset.mode = dealTypeSelect.value;
    // המונים שברשימת השכונות נספרים לפי סוג העסקה הנבחר, ולכן הם חייבים
    // להיספר מחדש כאן — אחרת "אזור התעשייה 4" היה נשאר על המסך אחרי מעבר
    // ל"מכירה" ומחזיר רשימה ריקה
    renderHoodFilter();
    // מריצים חיפוש מיידית עם שינוי הבחירה, כדי שהמפה (וגם הגריד) יסננו
    // מיד לסוג הרלוונטי בלבד, בלי לחכות שהמשתמש ילחץ "חיפוש"
    runSearch();
  });
}

// אנטר בתיבת החיפוש = לחיצה על כפתור החיפוש; במסכים צרים הכפתור מוצג
// כאייקון בלבד, ובלי זה לא היה ברור איך מריצים חיפוש מהמקלדת
document.getElementById('searchFreeText').addEventListener('keydown', (e)=>{
  if (e.key === 'Enter'){ e.preventDefault(); runSearch(); }
});

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close-modal]').forEach(el=>{
  el.addEventListener('click', ()=> closeModal(el.dataset.closeModal));
});
document.querySelectorAll('.filter-modal-overlay').forEach(overlay=>{
  overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.classList.remove('open'); });
});
/* ‏Escape סוגר את מודאל הסינון הפתוח, כמו בכל שאר המודאלים בעמוד (תפריט
   הנגישות, המבזקים, הסוכן החכם). שלושת מודאלי החיפוש היו היחידים שלא
   נסגרו כך — ובמקלדת זו הדרך שמנסים ראשונה. הסגירה בלבד ובלי חיפוש:
   ‏Escape הוא "התחרטתי", וזה בדיוק ההבדל בינו לבין "הצגת תוצאות". */
document.addEventListener('keydown', (e)=>{
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.filter-modal-overlay.open');
  if (open) open.classList.remove('open');
});

document.getElementById('openFiltersBtn').addEventListener('click', ()=>{
  openModal(searchState.activeTab === 'commercial' ? 'commercialFilterModal' : 'residentialFilterModal');
});

/* "הצגת תוצאות" בשני מודאלי הסינון = הרצת חיפוש.
   עד כאן הכפתור היה ‎data-close-modal‎ בלבד: הוא סגר את המודאל ותו לא, והמצב
   שנבחר בו (חדרים, סוג נכס, מחיר) נכנס לתוקף רק בלחיצה *נוספת* על כפתור
   החיפוש שבסרגל. מי שסימן/ה "3 חדרים · גג/פנטהאוז" ולחץ/ה "הצגת תוצאות"
   ראה/תה את המודאל נסגר ואת אותה תצוגה בדיוק — כלומר "כלום לא קרה" —
   ולמד/ה לחפש פעמיים. ‏runSearch() סוגרת בעצמה כל מודאל סינון פתוח, ולכן
   הלחיצה הזו עושה את שתי הפעולות. */
document.getElementById('rApplyFilters')?.addEventListener('click', runSearch);
document.getElementById('cApplyFilters')?.addEventListener('click', runSearch);

// המודאל נפתח תמיד מהבחירה שכבר פעילה: מי שסגר/ה בטעות וחזר/ה מוצא/ת את
// הסימון כפי שהיה, ולא דף ריק.
document.getElementById('hoodFilterBtn').addEventListener('click', ()=>{
  hoodState.draft = new Set(hoodState.selected);
  renderHoodOptions();
  openModal('hoodFilterModal');
});
// "כל השכונות" מנקה ומחיל מיד — זו הדרך לבטל סינון, ולא עוד שלב לפני
// "הצגת תוצאות"
document.getElementById('hoodClearBtn').addEventListener('click', ()=>{
  hoodState.draft = new Set();
  renderHoodOptions();
  applyHoodSelection([]);
  closeModal('hoodFilterModal');
});
document.getElementById('hoodApplyBtn').addEventListener('click', ()=>{
  applyHoodSelection(hoodState.draft);
  closeModal('hoodFilterModal');
});

document.getElementById('rClearFilters').addEventListener('click', ()=>{
  searchState.r = { priceMin:null, priceMax:null, rooms:new Set(), ptypes:new Set(), listingFeatures:new Set(), propertyFeatures:new Set(), condition:'', projectStatus:'', floorMin:null, floorMax:null, sizeMin:null, sizeMax:null, moveInDate:'', moveInSoon:false, freeText:'' };
  ['rPriceMin','rPriceMax','rFloorMin','rFloorMax','rSizeMin','rSizeMax','rMoveInDate','rFreeText'].forEach(id=> document.getElementById(id).value='');
  document.getElementById('rCondition').value=''; document.getElementById('rProjectStatus').value='';
  document.getElementById('rMoveInSoon').checked=false; document.getElementById('rBuiltSizeToggle').checked=false;
  initFilterModals();
});
document.getElementById('cClearFilters').addEventListener('click', ()=>{
  searchState.c = { deal:'', priceMin:null, priceMax:null, rooms:new Set(), ptypes:new Set(), listingFeatures:new Set(), propertyFeatures:new Set(), projectStatus:'', floorMin:null, floorMax:null, sizeMin:null, sizeMax:null, restrooms:'', storage:'', mamad:'', moveInDate:'', moveInSoon:false, freeText:'' };
  ['cPriceMin','cPriceMax','cFloorMin','cFloorMax','cSizeMin','cSizeMax','cMoveInDate','cFreeText'].forEach(id=> document.getElementById(id).value='');
  document.getElementById('cProjectStatus').value='';
  document.getElementById('cMoveInSoon').checked=false;
  initFilterModals();
});

function collectFormValues(){
  searchState.r.priceMin = document.getElementById('rPriceMin').value || null;
  searchState.r.priceMax = document.getElementById('rPriceMax').value || null;
  searchState.r.condition = document.getElementById('rCondition').value;
  searchState.r.projectStatus = document.getElementById('rProjectStatus').value;
  searchState.r.floorMin = document.getElementById('rFloorMin').value || null;
  searchState.r.floorMax = document.getElementById('rFloorMax').value || null;
  searchState.r.sizeMin = document.getElementById('rSizeMin').value || null;
  searchState.r.sizeMax = document.getElementById('rSizeMax').value || null;
  searchState.r.moveInDate = document.getElementById('rMoveInDate').value;
  searchState.r.moveInSoon = document.getElementById('rMoveInSoon').checked;
  searchState.r.freeText = document.getElementById('rFreeText').value;

  searchState.c.priceMin = document.getElementById('cPriceMin').value || null;
  searchState.c.priceMax = document.getElementById('cPriceMax').value || null;
  searchState.c.projectStatus = document.getElementById('cProjectStatus').value;
  searchState.c.floorMin = document.getElementById('cFloorMin').value || null;
  searchState.c.floorMax = document.getElementById('cFloorMax').value || null;
  searchState.c.sizeMin = document.getElementById('cSizeMin').value || null;
  searchState.c.sizeMax = document.getElementById('cSizeMax').value || null;
  searchState.c.moveInDate = document.getElementById('cMoveInDate').value;
  searchState.c.moveInSoon = document.getElementById('cMoveInSoon').checked;
  searchState.c.freeText = document.getElementById('cFreeText').value;
}

function countActiveFilters(){
  const s = searchState.activeTab === 'commercial' ? searchState.c : searchState.r;
  let n = 0;
  if (searchState.hasAi) n++;
  if (s.priceMin || s.priceMax) n++;
  if (s.rooms.size) n++;
  if (s.ptypes.size) n++;
  if (s.listingFeatures.size) n++;
  if (s.propertyFeatures.size) n++;
  if (s.floorMin || s.floorMax) n++;
  if (s.sizeMin || s.sizeMax) n++;
  if (s.moveInDate || s.moveInSoon) n++;
  if ('condition' in s && s.condition) n++;
  if (s.projectStatus) n++;
  if (s.freeText) n++;
  // במסחרי "מכירה"/"השכרה" הוא סינון לכל דבר מאז ש"הכול" הוא ברירת המחדל
  if (s.deal) n++;
  return n;
}

/* שמות שכונות יושבים בטבלה נפרדת (properties.neighborhood_id → neighborhoods),
   ולכן "גבעת המורה" לא ניתן לפתרון בשאילתה אחת על properties בלבד: קודם
   מתרגמים את הטקסט לרשימת מזהי שכונות, ואז מצרפים אותה לאותו or של המיקום.
   כישלון כאן לא מפיל את החיפוש — פשוט מוותרים על התאמת השכונה. */
async function matchingNeighborhoodIds(text){
  if (!sb) return [];
  try{
    const { data, error } = await sb.from('neighborhoods').select('id').ilike('name', `%${text}%`).limit(20);
    if (error) throw error;
    return (data || []).map(n => n.id);
  } catch(e){
    console.warn('התאמת שכונה לחיפוש נכשלה:', e);
    return [];
  }
}

/* תיבת החיפוש הראשית מבקשת "עיר, שכונה או רחוב", אבל השאילתה חיפשה את
   הטקסט ב-title בלבד. התוצאה: נכס שכתובתו היא בדיוק מה שהוקלד לא נמצא,
   בעוד נכס שבמקרה יש את המילה בכותרתו — ואין לו קשר למקום — כן הוצג,
   על המפה ובתוצאות. כאן הטקסט נפרש על שדות המיקום האמיתיים (עיר, רחוב,
   כתובת, שכונה) לצד הכותרת והתיאור.
   הניקוי חובה: הפסיק, הסוגריים והמרכאות הם תחביר של or/ilike ב-PostgREST,
   וטקסט חופשי שמכיל אותם היה שובר את השאילתה כולה (ואז "שגיאה בחיפוש"). */
async function locationOrFilter(rawText){
  const safe = rawText.replace(/[,()"'\\*%.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return '';
  const like = `*${safe}*`;
  const ors = [
    `title.ilike.${like}`,
    `description.ilike.${like}`,
    `city.ilike.${like}`,
    `street.ilike.${like}`,
    `address.ilike.${like}`,
  ];
  const hoodIds = await matchingNeighborhoodIds(safe);
  if (hoodIds.length) ors.push(`neighborhood_id.in.(${hoodIds.join(',')})`);
  return ors.join(',');
}

/* חיפוש שכבר רץ. שתי לחיצות רצופות (או "הצגת תוצאות" ומיד אנטר בשדה) שלחו
   שתי שאילתות במקביל, ומי שחזרה שנייה — לא בהכרח האחרונה שנשלחה — היא זו
   שציירה את המפה. הדגל חוסם את השנייה במקום לנצח בה. */
let searchRunning = false;

/* סימון חזותי לכך שהחיפוש בדרך. בלעדיו הלחיצה על כפתור החיפוש (או על
   "הצגת תוצאות") היא פעולה בלי שום משוב עד שהתוצאות חוזרות — וברשת איטית
   זה נקרא "כלום לא קרה". */
function setSearchBusy(on){
  document.querySelectorAll('#searchSubmitBtn, #rApplyFilters, #cApplyFilters').forEach(btn=>{
    btn.classList.toggle('is-busy', !!on);
    btn.setAttribute('aria-busy', String(!!on));
    btn.disabled = !!on;
  });
}

async function runSearch(){
  if (searchRunning) return;
  searchRunning = true;
  setSearchBusy(true);
  try { await runSearchInner(); }
  finally { searchRunning = false; setSearchBusy(false); }
}

async function runSearchInner(){
  searchHasRun = true;
  collectFormValues();
  const badge = document.getElementById('filterCountBadge');
  const count = countActiveFilters();
  badge.style.display = count ? 'inline-flex' : 'none';
  badge.textContent = count;

  document.querySelectorAll('.filter-modal-overlay').forEach(m=>m.classList.remove('open'));

  const freeTextMain = document.getElementById('searchFreeText').value.trim();
  const isCommercial = searchState.activeTab === 'commercial';
  const s = isCommercial ? searchState.c : searchState.r;
  const dealType = isCommercial ? s.deal : searchState.activeTab;

  try{
    if (!sb) throw new Error('no supabase client');
    // אותן עמודות כמו loadProperties: תוצאות חיפוש מרונדרות באותם כרטיסים
    // (שורות + קרוסלה + מפה), וכשחסרו כאן images/size_sqm/city הן ירדו
    // לגרדיאנט ולטקסט ברירת המחדל ברגע שהמשתמש חיפש
    let query = sb.from('properties').select(PROPERTY_SELECT)
      .eq('status', 'active')
      .eq('category', isCommercial ? 'commercial' : 'residential');
    // במסחרי מותר ש-dealType יהיה ריק ("הכול"), ואז לא מסננים לפי סוג
    // העסקה כלל. בלי התנאי הזה הבחירה ב"מסחרי" הייתה תמיד מוסיפה
    // deal_type='sale' ומחזירה רק את נכסי המכירה מתוך המלאי המסחרי.
    if (dealType) query = query.eq('deal_type', dealType);

    // סינון השכונות הוא סינון מלא לכל דבר, ולא קיצור דרך לחיפוש חופשי:
    // "מרכז העיר" מזוהה כאן לפי מזהה ולא לפי טקסט, ולכן הוא לא סוחף איתו
    // נכסים שהמילים האלה מופיעות בכותרת שלהם. כמה שכונות = ‏in ולא eq.
    if (hoodState.selected.size) query = query.in('neighborhood_id', [...hoodState.selected]);
    if (s.priceMin) query = query.gte('price', s.priceMin);
    if (s.priceMax) query = query.lte('price', s.priceMax);
    if (s.rooms.size) query = query.in('rooms', Array.from(s.rooms).map(r=>r === '+6' ? 6 : parseFloat(r)));
    if (s.ptypes.size) query = query.in('property_type', Array.from(s.ptypes));
    if (s.floorMin) query = query.gte('floor', s.floorMin);
    if (s.floorMax) query = query.lte('floor', s.floorMax);
    if (s.sizeMin) query = query.gte('size_sqm', s.sizeMin);
    if (s.sizeMax) query = query.lte('size_sqm', s.sizeMax);
    if (!isCommercial && s.condition) query = query.eq('condition', s.condition);
    if (s.projectStatus) query = query.eq('project_status', s.projectStatus);
    if (s.moveInSoon) query = query.eq('move_in_soon', true);
    if (s.moveInDate) query = query.gte('move_in_date', s.moveInDate);
    if (isCommercial){
      if (s.restrooms) query = query.eq('restrooms_location', s.restrooms);
      if (s.storage) query = query.eq('storage_location', s.storage);
      if (s.mamad) query = query.eq('mamad_location', s.mamad);
    }
    // המסננים הנגזרים הופכים לתנאי על העמודה; מה שנשאר הוא דגל אמיתי
    // במערך ‎features‎ ונבדק ב-contains אחד, כמו קודם.
    [...s.listingFeatures].forEach(code=>{
      const apply = DERIVED_LISTING_FILTERS[code];
      if (apply) query = apply(query);
    });
    const allFeatures = [
      ...[...s.listingFeatures].filter(code => !DERIVED_LISTING_FILTERS[code]),
      ...s.propertyFeatures,
    ];
    if (allFeatures.length) query = query.contains('features', allFeatures);
    const freeText = (s.freeText || freeTextMain).trim();
    if (freeText){
      const orFilter = await locationOrFilter(freeText);
      if (orFilter) query = query.or(orFilter);
    }

    /* מסנן ההדמיות הוא היחיד שלא יושב על עמודה ב-properties: ההדמיות הן
       טבלה נפרדת, ולכן הוא מתורגם לרשימת מזהים ומצורף כ-in. הרשימה קטנה
       מטבעה (הדמיות נוצרות לנכסי Premium בלבד) והיא נשלפת פעם אחת לעמוד.
       ‏in על מערך ריק היה מחזיר שגיאה, ולכן אפס נכסים עם הדמיה נענה כאן
       ברשימה ריקה — שהיא התשובה הנכונה, ולא שגיאת חיפוש. */
    let aiIds = null;
    if (searchState.hasAi){
      aiIds = [...await PropertyCard.allVisualizedIds(sb)];
      if (!aiIds.length){ renderPropertyGrid([], true); revealSearchResults(); return; }
      query = query.in('id', aiIds);
    }

    const { data, error } = await query
      .order('is_promoted', { ascending:false })
      .order('created_at', { ascending:false })
      .limit(PROPERTY_LIMIT);
    if (error) throw error;
    const results = (data || []).map(shapeProperty);
    renderPropertyGrid(results, true);
    /* חיפוש מהסרגל גובר על תגיות המדף ומכבה אותן. מאז שגם הן מסננות את
       המפה יש שני מסננים שמתחרים על אותם פינים, ותגית שנשארה דלוקה הייתה
       אומרת "מסומנים על המפה שלמעלה" מעל מפה שמציגה משהו אחר לגמרי.
       הכיבוי מגיע בחזרה לכאן דרך ppShelfToMap, ושם הוא נעצר ב-searchRunning
       — החיפוש הזה עדיין רץ, ואין מה להריץ שוב. */
    ppShelfFiltered = false;
    propsShelf.selectTag('');
    /* אחרי שהתוצאות חזרו ולא ברגע הלחיצה: חיפוש שהחזיר אפס הוא הממצא
       המעניין כאן — הוא מראה מה מחפשים אצלנו ולא מוצאים. */
    if (window.shukTrack) shukTrack('search', {
      search_term: freeTextMain,
      deal_type: dealType || 'all',
      category: isCommercial ? 'commercial' : 'residential',
      filter_count: count,
      result_count: results.length,
    });
    // רגע הכניסה הטבעי לתצוגה המפוצלת: מהחיפוש הראשון ואילך יש תוצאות
    // להשוות מול המפה. נפתחת פעם אחת בלבד ורק למי שעוד לא בחר/ה בעצמו/ה —
    // מי שסגר/ה את הפאנל לא ימצא אותו פתוח שוב.
    if (!splitPrefSet && splitSupported()) setSplitView(true);
    revealSearchResults();
  } catch(e){
    console.warn('חיפוש נכשל:', e);
    showSearchError();
  }
}

// גלילה לתוצאות רק כשהן באמת מתחת לקפל — במסך רגיל השורות מציצות מתחת
// למפה מיד, וגלילה אוטומטית הייתה דוחפת את המפה עצמה אל מחוץ למסך
function revealSearchResults(){
  const section = document.getElementById('searchResults');
  if (!section || section.hidden) return;
  // בתצוגה המפוצלת התוצאות כבר מול העיניים, בפאנל שלצד המפה — גלילה אל
  // העותק שמתחת הייתה דוחפת את שתיהן אל מחוץ למסך בדיוק ברגע החיפוש
  if (splitOn && splitSupported()) return;
  requestAnimationFrame(()=>{
    if (section.getBoundingClientRect().top > window.innerHeight * 0.9){
      section.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });
}

function showSearchError(){
  // בלי איפוס התצוגות, הודעת השגיאה מופיעה מעל המפה והשורות של החיפוש
  // הקודם — כלומר מעל נכסים שאין להם קשר למה שהמשתמש ביקש עכשיו
  renderMap([]);
  const section = document.getElementById('searchResults');
  const rows = document.getElementById('searchResultsRows');
  const countEl = document.getElementById('searchResultsCount');
  const titleEl = document.getElementById('searchResultsTitle');
  if (section && rows){
    section.hidden = false;
    // הכותרת חוזרת מ"הנכסים שבתחום המפה" אם החיפוש נכשל בזמן שהמצב ההוא פעיל
    if (titleEl) titleEl.textContent = 'תוצאות החיפוש';
    if (countEl) countEl.textContent = '';
    rows.innerHTML = '<div class="sr-empty">שגיאה בחיפוש - נסו שוב</div>';
  }
}

/* שורת נכס אחת. משותפת לשתי הרשימות שמציגות תוצאות — השורות שמתחת למפה
   והפאנל המפוצל שלצדה — כדי ששתיהן יציגו בדיוק את אותו מידע ויגיבו באותה
   דרך. data-prop-id הוא מה שמקשר שורה לפין שלה (ראו hotSplitRow). */
function buildSearchRow(p, i){
  const row = document.createElement('article');
  row.className = 'sr-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'link');
  row.dataset.propId = p.id;
  row.innerHTML = `
    <div class="sr-thumb" style="${thumbStyle(p, i)}">${thumbFallback(p)}${isPromoted(p) ? '<span class="ribbon">מקודם</span>' : ''}</div>
    <div class="sr-body">
      <div class="sr-title">${escAttr(p.title)}</div>
      <div class="sr-meta"><span>${escAttr(locationLabel(p))}</span>${p.property_type ? `<span>${escAttr(p.property_type)}</span>` : ''}${p.agency_name ? `<span>${escAttr(p.agency_name)}</span>` : ''}</div>
      ${PropertyCard.factsHtml(p)}
    </div>
    <div class="sr-side">
      <span class="sr-deal" data-deal="${dealKind(p)}">${dealBadge(p)}</span>
      <span class="sr-price">${priceLabel(p)}</span>
    </div>`;
  const open = ()=> window.location.href = '/property?id=' + p.id;
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
  return row;
}

/* שורות התוצאות שמיד מתחת למפה. אותה רשימה שמזינה את הפינים, ולכן כל שורה
   כאן היא פין על המפה שמעליה — כולל אותה תגית צבע לסוג העסקה.

   שני מצבים לאותה סקציה, ובכוונה אותה סקציה: היא היחידה בדף שיושבת בין
   ה-hero לבין המבזק ותיבת הנכסים, ולכן היא המקום
   היחיד שבו "מיד מתחת למפה" נכון.
     ‏1. תוצאות חיפוש — מה שהשאילתה החזירה.
     ‏2. תחום המפה (‏mapView) — מה שנמצא כרגע בתוך המסגרת הנראית, אחרי
        שהגולש/ת הזיז/ה או הגדיל/ה את המפה. ראו updateMapViewRows. */
const MAP_VIEW_MAX_ROWS = 60;   // מעבר לזה הגלילה ארוכה מלהיות שימושית

/* ‏הכתובת שבה נטען הדף. ‏14 עמודי התוצאות מוגשים מ-index.html לפי
   הפרמטרים, ולכן הכותרת שמוזרקת להם תקפה רק כל עוד הפרמטרים לא השתנו:
   מי שהגיע/ה ל-"דירות 4 חדרים למכירה" ואז שינה/תה את המסננים מקבל/ת שוב
   "תוצאות החיפוש", ולא כותרת שמתארת חיפוש אחר. */
/* ‏var ולא const, מאותה סיבה שכתובה ב-CLAUDE.md על כינויי הבריחה: ‎const‎
   אינו מורם, וקריאה שתקדים את השורה הזו הייתה **זורקת** ומפילה את רשימת
   התוצאות. עם ‎var‎ היא מקבלת ‎undefined‎, והכותרת נופלת ל"תוצאות החיפוש". */
var LANDING_SEARCH = location.search;

/* ‏הכותרת של עמוד התוצאות, כפי ש-netlify/edge-functions/search-pages.ts
   הזריקה אותה. **הדף אינו מחזיק עותק של הרשימה** — הוא קורא את מה שנכתב
   לו. שתי רשימות שצריכות להסכים הן רשימה אחת שמתיישנת. */
function searchLandingHeading(){
  if (location.search !== LANDING_SEARCH) return '';
  const el = document.querySelector('meta[name="shuk-search-heading"]');
  return el ? (el.content || '').trim().slice(0, 80) : '';
}

function renderSearchRows(properties, isSearchResult, { mapView = false } = {}){
  const section = document.getElementById('searchResults');
  const rows = document.getElementById('searchResultsRows');
  const countEl = document.getElementById('searchResultsCount');
  const titleEl = document.getElementById('searchResultsTitle');
  if (!section || !rows) return;

  if (!isSearchResult){
    section.hidden = true;
    rows.innerHTML = '';
    return;
  }

  section.hidden = false;
  // הכותרת אומרת מאיפה הרשימה הגיעה. "תוצאות החיפוש" מעל רשימה שנוצרה
  // מגרירה של המפה — ובלי שאיש חיפש דבר — היא כותרת שמשקרת.
  if (titleEl) titleEl.textContent = mapView ? 'הנכסים שבתחום המפה'
                                             : (searchLandingHeading() || 'תוצאות החיפוש');

  // בתחום המפה מוצג רק מה שנכנס לרשימה שימושית; השאר נשאר על המפה, וההודעה
  // אומרת איך לצמצם אותו (להתקרב) במקום להעמיס מאות שורות על הטלפון.
  const shown = mapView ? properties.slice(0, MAP_VIEW_MAX_ROWS) : properties;

  if (countEl){
    if (mapView){
      const overflow = properties.length - shown.length;
      countEl.textContent = !properties.length
        ? ''
        : overflow > 0
          ? `${shown.length} מתוך ${properties.length} נכסים בתחום המפה - התקרבו כדי לצמצם`
          : properties.length === 1
            ? 'נכס אחד בתחום המפה'
            : `${properties.length} נכסים בתחום המפה`;
    } else {
      // נכס בלי קואורדינטות לא יכול לקבל פין, ולכן ההבטחה "מסומנים על המפה"
      // נכונה רק כשלכולם יש מיקום. אחרת נאמר במפורש כמה מהם על המפה, אחרת
      // המספר כאן מבטיח יותר פינים ממה שבאמת מצויר.
      const pinned = properties.filter(p => p.lat && p.lng).length;
      countEl.textContent = !properties.length ? ''
        : pinned === properties.length
          ? `${properties.length} נכסים תואמים · מסומנים על המפה שמעל`
          : `${properties.length} נכסים תואמים · ${pinned} מהם מסומנים על המפה`;
    }
  }
  rows.innerHTML = '';
  if (!shown.length){
    /* בתחום המפה "אין כאן כלום" הוא הוראה ולא מבוי סתום — מספיק להתרחק.
       בחיפוש זה ההפך: אפס תוצאות הוא רגע הכוונה הגבוה ביותר בכל המסך, כי מי
       שחיפש/ה בדיוק את זה ולא מצא/ה הוא/היא מי שכדאי לעדכן כשזה יעלה. */
    if (mapView){
      rows.innerHTML = '<div class="sr-empty">אין נכסים בתחום המפה הנוכחי. הזיזו את המפה או התרחקו כדי לראות עוד.</div>';
      return;
    }
    rows.innerHTML =
      '<div class="sr-empty">לא נמצאו נכסים התואמים את החיפוש. נסו להרחיב את הסינון או לחפש שכונה אחרת.' +
      '<div class="ssa-empty"><button type="button" class="ssa-cta" id="ssaEmptyBtn">' +
      '🔔 עדכנו אותי כשיעלה נכס כזה</button>' +
      '<div class="bot-alt" id="botEmptyWrap"></div></div></div>';
    document.getElementById('ssaEmptyBtn').addEventListener('click', ssaOpen);
    renderEmptyBotLink();
    return;
  }

  shown.forEach((p, i)=>{
    rows.appendChild(buildSearchRow(p, i));
    // אותה פרסומת in-feed שקיימת בגריד — התוצאות עברו לכאן, וגם היא איתן
    if (i === 1 && shown.length > 2){
      const ad = document.createElement('div');
      ad.className = 'infeed-ad';
      ad.textContent = 'פרסומת - באנר רוחבי בין תוצאות החיפוש';
      rows.appendChild(ad);
    }
  });
}

/* ============================================================================
   הסוכן החכם — שמירת חיפוש והתראה על נכס מתאים

   הקריטריונים נלכדים מ-searchState בדיוק כפי ש-runSearch() קורא אותו, כדי
   שמה שנשמר יהיה מה שחיפשו. שני הבדלים מכוונים מול החיפוש החד-פעמי:

     ‏1. גלולות החדרים והמחיר הופכות לטווח שאפשר לערוך. "4 חדרים" הוא בחירה
        לרגע אחד; חיפוש שחי חודשיים כמעט תמיד מתכוון "4 עד 5".
     ‏2. מסנני המודעה (עם תמונה, מחיר שירד, סיור 3D) לא נשמרים. הם דרך לסנן
        מלאי קיים, לא דרישה מנכס שעוד לא פורסם — ונכס חדש בלי תמונה עדיין
        הנכס שחיכו לו.

   ‏הטקסט החופשי מתורגם כאן למזהי שכונות ולעיר, ולא נשמר כטקסט לחיפוש:
   ההתאמה בשרת היא על שדות מובנים בלבד. ראו docs/smart-search-agent.md.
   ========================================================================== */
const SAVED_SEARCH_FUNCTION_URL = SUPABASE_URL + '/functions/v1/saved-search-intake';

const ssaModal = document.getElementById('ssaModal');
const ssaForm  = document.getElementById('ssaForm');
const ssaDone  = document.getElementById('ssaDone');
const ssaErrorEl = document.getElementById('ssaError');

// צילום הקריטריונים ברגע פתיחת הבלון — לא בשליחה. מה שמסוכם על המסך הוא
// מה שיישמר, גם אם המשתמש/ת ישנה את הסינון מאחורי הבלון.
let ssaSnapshot = null;
let ssaChannel = 'whatsapp';

const SSA_DEAL_LABELS = { sale:'למכירה', rent:'להשכרה' };

/* רשימת הערים מגיעה מטבלת השכונות שכבר נטענה, ולכן אין כאן קריאה נוספת.
   טקסט חופשי שהוא שם עיר נשמר כעיר; טקסט שהוא שם שכונה תורגם כבר למזהה. */
function ssaCityFromText(text){
  if (!text) return null;
  const needle = text.trim();
  const cities = [...new Set(hoodState.rows.map(h => h.city).filter(Boolean))];
  return cities.find(c => c === needle || c.includes(needle) || needle.includes(c)) || null;
}

async function ssaCapture(){
  collectFormValues();
  const isCommercial = searchState.activeTab === 'commercial';
  const s = isCommercial ? searchState.c : searchState.r;
  const dealType = isCommercial ? s.deal : searchState.activeTab;
  const freeText = (s.freeText || document.getElementById('searchFreeText').value || '').trim();

  // סינון השכונות מנצח את הטקסט: זו בחירה מפורשת לפי מזהה, ולא ניחוש.
  let hoodIds = [];
  if (hoodState.selected.size) hoodIds = [...hoodState.selected];
  else if (freeText) hoodIds = await matchingNeighborhoodIds(freeText);

  // עיר נשמרת רק כשלא זוהתה שכונה — אחרת החיפוש היה מתרחב מ"רובע יזרעאל"
  // ל"כל עפולה" בלי שמישהו ביקש.
  const city = hoodIds.length ? null : ssaCityFromText(freeText);

  // '+6' פירושו "6 ומעלה", כלומר מינימום בלי מקסימום
  const roomVals = [...s.rooms].map(r => r === '+6' ? 6 : parseFloat(r)).filter(n => !isNaN(n));
  const openEnded = s.rooms.has('+6');

  ssaSnapshot = {
    // ‏saved_searches.deal_type מוגבל ב-check ל-'sale'/'rent' ומנוע ההתאמה
    // משווה אותו לנכס בשוויון פשוט, כלומר חיפוש שמור לא יכול לעקוב אחרי
    // שני סוגי העסקה יחד. חיפוש מסחרי במצב "הכול" נשמר לכן כ-'sale' —
    // אותה ברירת מחדל שה-RPC מחיל ממילא — והסיכום בבלון מציג אותה
    // במפורש ("למכירה"), כדי שמה שנשמר יהיה מה שרואים לפני השמירה.
    deal_type: dealType || 'sale',
    category: isCommercial ? 'commercial' : 'residential',
    cities: city ? [city] : [],
    neighborhood_ids: hoodIds,
    property_types: [...s.ptypes],
    // רק מאפייני הנכס עצמו. מסנני המודעה נשארים בחיפוש החד-פעמי.
    required_features: [...s.propertyFeatures],
    min_size_sqm: s.sizeMin ? Number(s.sizeMin) : null,
    max_size_sqm: s.sizeMax ? Number(s.sizeMax) : null,
    min_floor: s.floorMin !== null && s.floorMin !== '' ? Number(s.floorMin) : null,
    max_floor: s.floorMax !== null && s.floorMax !== '' ? Number(s.floorMax) : null,
    condition: (!isCommercial && s.condition) ? s.condition : null,
    free_text: freeText || null,
    _hoodNames: hoodIds.map(id => hoodState.byId.get(id)?.name).filter(Boolean),
    _roomsMin: roomVals.length ? Math.min(...roomVals) : null,
    _roomsMax: (roomVals.length && !openEnded) ? Math.max(...roomVals) : null,
  };

  // הטווחים הניתנים לעריכה מוזנים מהסינון, ומכאן והלאה הם של המשתמש/ת
  document.getElementById('ssaRoomsMin').value = ssaSnapshot._roomsMin ?? '';
  document.getElementById('ssaRoomsMax').value = ssaSnapshot._roomsMax ?? '';
  document.getElementById('ssaPriceMin').value = s.priceMin || '';
  document.getElementById('ssaPriceMax').value = s.priceMax || '';

  ssaRenderRecap();
}

/* הסיכום מציג את מה שאי אפשר לערוך בבלון. החדרים והמחיר לא מופיעים כאן
   בכוונה — הם יושבים בשדות שמעליו, ושכפול שלהם היה מייצר שני מקורות אמת
   שנפרדים ברגע שמישהו עורך אחד מהם. */
function ssaRenderRecap(){
  const s = ssaSnapshot;
  const parts = [
    SSA_DEAL_LABELS[s.deal_type] || '',
    s.category === 'commercial' ? 'נכס מסחרי' : null,
    s._hoodNames.length ? '📍 ' + s._hoodNames.join(', ') : (s.cities.length ? '📍 ' + s.cities.join(', ') : '📍 כל האזורים'),
    s.property_types.length ? '🏠 ' + s.property_types.join(', ') : null,
    s.min_size_sqm || s.max_size_sqm
      ? `📐 ${s.min_size_sqm || ''}${s.min_size_sqm && s.max_size_sqm ? '-' : ''}${s.max_size_sqm || ''} מ״ר` : null,
    s.required_features.length ? '✓ ' + s.required_features.length + ' מאפיינים' : null,
  ].filter(Boolean);
  document.getElementById('ssaRecap').textContent = parts.join(' · ');
}

/* כותרת החיפוש, כפי שתופיע בהתראה עצמה ובכרטיס הליד. נבנית בעברית מהחלקים
   ולא מהטקסט החופשי — היא צריכה להיקרא כמשפט גם למי שהקליד/ה שלוש מילים. */
function ssaBuildLabel(roomsMin, roomsMax, priceMax){
  const s = ssaSnapshot;
  const rooms = roomsMin && roomsMax && roomsMin !== roomsMax ? `${roomsMin}-${roomsMax} חדרים`
              : roomsMin ? `${roomsMin} חדרים${!roomsMax ? ' ומעלה' : ''}`
              : roomsMax ? `עד ${roomsMax} חדרים` : null;
  const place = s._hoodNames.length ? s._hoodNames.join(', ')
              : s.cities.length ? s.cities.join(', ') : null;
  return [
    rooms || (s.property_types[0] || (s.category === 'commercial' ? 'נכס מסחרי' : 'נכס')),
    place ? 'ב' + place : null,
    SSA_DEAL_LABELS[s.deal_type],
    priceMax ? 'עד ' + nis(priceMax) + ' ₪' : null,
  ].filter(Boolean).join(' ').slice(0, 200);
}

/* ---------- הכפתור המשני לעוזר בוואטסאפ, במסך אפס התוצאות ----------
   הטופס נשאר הראשי. זה כאן בשביל מי שמעדיף/ה לשאול במילים במקום למלא —
   ולמי שהחיפוש שלו/ה דורש ניואנס שהסינון לא יודע לבטא.

   **מה שהופך את זה לשונה מקישור רגיל:** הודעת הפתיחה נושאת את החיפוש
   שהרגע נכשל. הפונה נוחת/ת בצ'אט כשכתוב שם כבר "חיפשתי 4 חדרים בעפולה עד
   1.4 מיליון ולא מצאתי", והעוזר עונה על זה מיד במקום לשאול מה מחפשים.
   זה גם מה שהופך את whatsapp_messages למקור ייחוס: גוף ההודעה מספר מאיזו
   נקודה באתר הגיע הפונה, בלי תלות ב-GA4.

   הקישור נבנה **בשני שלבים** בכוונה: קודם גרסה גנרית שעובדת מיד, ואז —
   כש-ssaCapture מסיימת (היא מריצה שאילתת התאמת שכונות למסד) — גרסה שנושאת
   את החיפוש עצמו. מי שילחץ בשנייה הראשונה מקבל קישור עובד ולא כפתור מת.

   ‏ssaBuildLabel ולא ניסוח משלנו: הוא כבר מנסח את החיפוש כמשפט עברי עבור
   כותרת ההתראה. שני מנסחים היו נפרדים זה מזה ברגע שאחד מהם ישתנה.        */
async function renderEmptyBotLink(){
  const wrap = document.getElementById('botEmptyWrap');
  // ‏ShukBot נטען מ-assets ולכן עלול להיחסם; העוזר עצמו כבוי עד שהסוד
  // בשרת נדלק. בשני המקרים פשוט אין כפתור, והטופס ממשיך לעבוד.
  if (!wrap || !window.ShukBot || !ShukBot.enabled()) return;

  const LABEL = '💬 או דברו איתי בוואטסאפ';
  const draw = (hello) => {
    wrap.innerHTML = ShukBot.anchorHtml(hello, LABEL, 'ssa-cta bot-cta');
    const a = wrap.querySelector('a');
    if (a) a.setAttribute('data-bot-entry', 'search_empty');
  };

  draw('שלום, חיפשתי באתר ולא מצאתי נכס שמתאים. אפשר עזרה?');

  try{
    await ssaCapture();
    const what = ssaBuildLabel(
      ssaSnapshot._roomsMin,
      ssaSnapshot._roomsMax,
      Number(document.getElementById('ssaPriceMax').value) || null,
    );
    // ‏wrap עדיין בדף? חיפוש חדש שרץ בינתיים החליף את ה-DOM, ואז אין למי
    // לכתוב — ומה שהיה נכתב היה מתאר את החיפוש הקודם.
    if (what && document.getElementById('botEmptyWrap') === wrap){
      draw('שלום, חיפשתי באתר ' + what + ' ולא מצאתי. אפשר עזרה?');
    }
  } catch(e){
    // הגרסה הגנרית כבר מצוירת — אין מה לתקן, ואין מה להפיל
    console.warn('bot link enrich failed:', e);
  }
}

async function ssaOpen(){
  ssaErrorEl.textContent = '';
  ssaForm.hidden = false;
  ssaDone.hidden = true;
  const btn = document.getElementById('ssaSubmitBtn');
  btn.disabled = false;
  btn.textContent = 'שמירת החיפוש';
  await ssaCapture();
  ssaModal.classList.add('open');
  document.getElementById('ssaName').focus();
}
function ssaClose(){ ssaModal.classList.remove('open'); }

document.getElementById('ssaOpenBtn').addEventListener('click', ssaOpen);
document.getElementById('ssaCloseBtn').addEventListener('click', ssaClose);
ssaModal.addEventListener('click', (e)=>{ if (e.target === ssaModal) ssaClose(); });
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && ssaModal.classList.contains('open')) ssaClose();
});

// בחירת הערוץ מחליפה את השדות המוצגים — אין טעם לבקש אימייל ממי שביקש/ה
// וואטסאפ, וכל שדה מיותר בטופס הוא נטישה.
document.getElementById('ssaChannels').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-channel]');
  if (!btn) return;
  ssaChannel = btn.dataset.channel;
  document.querySelectorAll('#ssaChannels button').forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('ssaPhoneField').hidden = ssaChannel === 'email';
  document.getElementById('ssaEmailField').hidden = ssaChannel === 'whatsapp';
});

ssaForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!ssaSnapshot) return;

  const nameEl  = document.getElementById('ssaName');
  const phoneEl = document.getElementById('ssaPhone');
  const emailEl = document.getElementById('ssaEmail');
  const full_name = nameEl.value.trim();
  const phone = ssaChannel === 'email' ? '' : phoneEl.value.trim();
  const email = ssaChannel === 'whatsapp' ? '' : emailEl.value.trim();

  // אותן בדיקות רצות שוב ב-Edge Function — כאן הן רק כדי לחסוך הלוך-ושוב
  const badName  = full_name.length < 2;
  const badPhone = ssaChannel !== 'email' && phone.replace(/\D/g, '').length < 9;
  const badEmail = ssaChannel !== 'whatsapp' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  nameEl.classList.toggle('invalid', badName);
  phoneEl.classList.toggle('invalid', badPhone);
  emailEl.classList.toggle('invalid', badEmail);
  if (badName)  { ssaErrorEl.textContent = 'נא להזין שם מלא'; nameEl.focus(); return; }
  if (badPhone) { ssaErrorEl.textContent = 'נא להזין מספר טלפון תקין'; phoneEl.focus(); return; }
  if (badEmail) { ssaErrorEl.textContent = 'נא להזין כתובת אימייל תקינה'; emailEl.focus(); return; }

  const numOrNull = (id)=>{ const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
  const roomsMin = numOrNull('ssaRoomsMin'), roomsMax = numOrNull('ssaRoomsMax');
  const priceMin = numOrNull('ssaPriceMin'), priceMax = numOrNull('ssaPriceMax');

  // חיפוש בלי שום קריטריון הוא מנוי לכל נכס באתר. השרת דוחה אותו ממילא;
  // כאן ההודעה נאמרת בשפה שאפשר לפעול לפיה.
  const s = ssaSnapshot;
  const hasCriteria = roomsMin !== null || roomsMax !== null || priceMin !== null || priceMax !== null ||
    s.cities.length || s.neighborhood_ids.length || s.property_types.length ||
    s.required_features.length || s.min_size_sqm !== null || s.max_size_sqm !== null ||
    s.min_floor !== null || s.max_floor !== null;
  if (!hasCriteria){
    ssaErrorEl.textContent = 'הוסיפו לפחות תנאי אחד - אזור, תקציב או מספר חדרים';
    return;
  }
  ssaErrorEl.textContent = '';

  const btn = document.getElementById('ssaSubmitBtn');
  const originalLabel = btn.textContent;
  btn.textContent = 'שומר…';
  btn.disabled = true;

  const payload = {
    full_name, phone, email,
    contact_channel: ssaChannel,
    label: ssaBuildLabel(roomsMin, roomsMax, priceMax),
    deal_type: s.deal_type,
    category: s.category,
    cities: s.cities,
    neighborhood_ids: s.neighborhood_ids,
    property_types: s.property_types,
    required_features: s.required_features,
    min_rooms: roomsMin, max_rooms: roomsMax,
    min_price: priceMin, max_price: priceMax,
    min_size_sqm: s.min_size_sqm, max_size_sqm: s.max_size_sqm,
    min_floor: s.min_floor, max_floor: s.max_floor,
    condition: s.condition,
    free_text: s.free_text,
    consent_agent_contact: document.getElementById('ssaConsent').checked,
    source: 'homepage_search_agent',
  };

  try{
    const res = await fetch(SAVED_SEARCH_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const messages = {
        too_many_searches: `הגעתם למקסימום החיפושים השמורים (${data.limit || 5}). אפשר להפסיק חיפוש קיים מהקישור שבהתראה.`,
        no_criteria: 'הוסיפו לפחות תנאי אחד - אזור, תקציב או מספר חדרים',
        invalid_phone: 'נא להזין מספר טלפון תקין',
        invalid_email: 'נא להזין כתובת אימייל תקינה',
        invalid_name: 'נא להזין שם מלא',
      };
      throw new Error(messages[data.error] || 'השמירה נכשלה - נסו שוב');
    }
    // ‏duplicate=true פירושו שהחיפוש הזה כבר שמור. מבחינת המחפש/ת זו הצלחה,
    // ולכן אותו מסך — רק הטקסט מדויק יותר.
    document.getElementById('ssaDoneText').textContent = data.duplicate
      ? 'החיפוש הזה כבר שמור אצלנו - נעדכן אתכם ברגע שיעלה נכס מתאים.'
      : 'נעדכן אתכם ברגע שיעלה נכס שמתאים לחיפוש.';
    ssaForm.hidden = true;
    ssaDone.hidden = false;
    if (window.shukTrack) shukTrack('generate_lead', {
      form_id: 'search_agent',
      is_duplicate: !!data.duplicate,
    });
  } catch(err){
    console.warn('saved-search-intake failed:', err);
    ssaErrorEl.textContent = err.message && err.message !== 'Failed to fetch'
      ? err.message : 'השמירה נכשלה - בדקו חיבור לאינטרנט ונסו שוב';
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

/* ==========================================================================
   באנר מחפשי הנכס — אשף שלושת השלבים שבתחתית רצועות הנכסים הפרטיים
   --------------------------------------------------------------------------
   אותו יעד של הסוכן החכם (‏saved-search-intake), במסלול כניסה שני: שם
   ההרשמה יוצאת *מתוך חיפוש שכבר רץ*, וכאן היא נבנית מאפס בשלושה שלבים —
   מה מחפשים ואיפה, פרטי הנכס, ולאן לחזור. מי שגלל/ה את רצועות הנכסים בלי
   למצוא הוא/היא בדיוק מי שכדאי להציע לו/ה שהנכס הבא יגיע אליו/ה.

   שני הבדלים מהותיים מהבלון של הסוכן החכם:
     ‏1. השכונות נבחרות כאן ישירות מרשימת השכונות (בחירה מרובה) ולא נגזרות
        מסינון המפה — הבאנר חי בתחתית העמוד, הרחק מהמפה, ואי אפשר להניח
        שרץ שם חיפוש בכלל.
     ‏2. "מסחרי" הוא בחירה בשורה הראשונה. ‏saved_searches מפריד קטגוריה
        (‎residential/commercial‎) מסוג עסקה (‎sale/rent‎), ולכן הבחירה בו
        פותחת שאלה משלימה במקום לנחש.
   ========================================================================== */
const buyState = {
  deal:'sale',            // 'sale' | 'rent'  — מה שנשמר ב-deal_type
  category:'residential', // 'residential' | 'commercial'
  hoods:new Set(),
  rooms:new Set(),
  ptypes:new Set(),
  channel:'whatsapp',
  source:'homepage_buyer_wizard',   // מתחלף כשהבאנר נפתח ממחשבון התשואה
};

const buyerForm = document.getElementById('buyerWizardForm');
const buyDoneEl = document.getElementById('buyDone');

const openBuyerPanel = bindLeadBanner({
  banner:'buyerBanner', teaser:'buyerStartBtn', panel:'buyerPanel',
  onOpen(){ buyGoToStep(1); },
});

/* פתיחת הבאנר מבחוץ — ה-CTA של מחשבון התשואה מפנה לכאן: ליד של מחפש/ת
   נכס להשקעה הוא אותו חיפוש שמור בדיוק, ולכן אין טופס נוסף. הבאנר יושב
   הרבה מעל המחשבון בעמוד, ולכן הפתיחה מלווה בגלילה אליו — אחרת שום דבר
   לא נראה קורה בלחיצה. */
function openBuyerSearch(){
  buyState.source = 'homepage_yield_calc';
  openBuyerPanel(true);
  document.getElementById('buyerBanner').scrollIntoView({ behavior:'smooth', block:'start' });
}

function buyGoToStep(n){
  buyerForm.querySelectorAll('.wiz-panel').forEach(p=>{
    p.classList.toggle('active', Number(p.dataset.panel) === n);
  });
  document.querySelectorAll('#buySteps li').forEach(li=>{
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === n);
    li.classList.toggle('done', step < n);
  });
  if (n === 3) buyRenderRecap();
}
function buySetError(step, message){
  document.getElementById('buyErr' + step).textContent = message || '';
}

/* --- שלב 1: סוג החיפוש --- */
/* רשימת השכונות נבנית מאותה טבלה שמזינה את סינון המפה, ולכן היא נבנית
   מחדש כשהיא מגיעה (‏initPropertyUI קורא לכאן). ‏textContent ולא innerHTML:
   שמות שכונות מוזנים על ידי משתמשי הפלטפורמה. */
function renderBuyerHoods(){
  const wrap = document.getElementById('buyHoodChips');
  const fallback = document.getElementById('buyAreaFallback');
  const label = document.getElementById('buyHoodLabel');
  if (!wrap) return;
  wrap.innerHTML = '';

  // בלי רשימת שכונות (מסד לא זמין) נשארת תיבת טקסט חופשי — שלב בלי שום
  // דרך לציין אזור הוא שלב מיותר. השאלה "באילו שכונות?" יורדת איתה, כדי
  // שלא תישאל שאלה שאין מתחתיה מה לענות.
  if (!hoodState.rows.length){
    if (fallback) fallback.hidden = false;
    if (label) label.hidden = true;
    return;
  }
  if (fallback) fallback.hidden = true;
  if (label) label.hidden = false;

  // אותו כלל כמו ב-hoodChoices: אזור בתכנון שאין בו נכסים אינו מוצג. כאן
  // הנימוק חזק אפילו יותר — "B1 אזור בתכנון" הוא קוד תכנוני פנימי, וגולש/ת
  // שמסמן/ת אילו שכונות הוא/היא מחפש/ת אינו/ה יכול/ה לרצות אותו.
  hoodState.rows.slice()
    .filter(h => !h.is_planned
      || (hoodState.counts.get(h.id) || 0) > 0
      || buyState.hoods.has(h.id))
    .sort((a,b)=> String(a.name).localeCompare(String(b.name), 'he'))
    .forEach(h=>{
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.hoodId = h.id;
      chip.setAttribute('aria-pressed', buyState.hoods.has(h.id) ? 'true' : 'false');
      chip.textContent = h.name;
      chip.addEventListener('click', ()=>{
        const on = chip.getAttribute('aria-pressed') === 'true';
        chip.setAttribute('aria-pressed', String(!on));
        if (on) buyState.hoods.delete(h.id); else buyState.hoods.add(h.id);
        buySetError(1, '');
      });
      wrap.appendChild(chip);
    });
}

/* סוגי הנכס תלויים בקטגוריה, ולכן נבנים מחדש בכל החלפה שלה. הבחירה
   הקודמת נמחקת ולא "נשמרת ליתר ביטחון": משרד שנבחר ואז עברו למגורים היה
   נשלח עם חיפוש דירות ומסנן אותו לאפס תוצאות. */
function renderBuyPtypes(){
  const wrap = document.getElementById('buyPtypeChips');
  if (!wrap) return;
  const list = buyState.category === 'commercial'
    ? COMMERCIAL_PTYPES
    : [...RESIDENTIAL_PTYPES.apt, ...RESIDENTIAL_PTYPES.house, ...RESIDENTIAL_PTYPES.other];
  wrap.innerHTML = '';
  list.forEach(name=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', buyState.ptypes.has(name) ? 'true' : 'false');
    chip.textContent = name;
    chip.addEventListener('click', ()=>{
      const on = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', String(!on));
      if (on) buyState.ptypes.delete(name); else buyState.ptypes.add(name);
      buySetError(2, '');
    });
    wrap.appendChild(chip);
  });
}

/* מה שמשתנה עם סוג העסקה: הצעות סוג הנכס, החדרים מול הגודל, והתקציב
   שבהשכרה הוא חודשי ובמכירה חד-פעמי. */
function buyApplyDealChoice(){
  const commercial = buyState.category === 'commercial';
  document.getElementById('buyCommercialDeal').hidden = !commercial;
  document.getElementById('buyRoomsBlock').hidden = commercial;
  document.getElementById('buySizeBlock').hidden = !commercial;
  document.getElementById('buyBudgetHint').textContent =
    buyState.deal === 'rent' ? '(₪ לחודש)' : '(₪)';
  renderBuyPtypes();
}

document.getElementById('buyDealToggle').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-buy-deal]');
  if (!btn) return;
  document.querySelectorAll('#buyDealToggle button').forEach(b=> b.classList.toggle('active', b === btn));
  const choice = btn.dataset.buyDeal;
  buyState.category = choice === 'commercial' ? 'commercial' : 'residential';
  if (choice !== 'commercial') buyState.deal = choice;
  else buyState.deal = document.querySelector('#buyCommercialToggle button.active')?.dataset.buyCdeal || 'sale';
  buyState.ptypes.clear();
  if (buyState.category === 'commercial') buyState.rooms.clear();
  buyApplyDealChoice();
  buySetError(1, '');
});

document.getElementById('buyCommercialToggle').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-buy-cdeal]');
  if (!btn) return;
  document.querySelectorAll('#buyCommercialToggle button').forEach(b=> b.classList.toggle('active', b === btn));
  buyState.deal = btn.dataset.buyCdeal;
  buyApplyDealChoice();
});

/* --- שלב 2: חדרים (בחירה מרובה) --- */
/* בחירה מרובה ולא טווח: "3 או 4 חדרים" היא הדרך שבה אנשים מחפשים, והיא
   מתורגמת בשליחה לטווח מינימום–מקסימום שהוא מה ש-saved_searches שומר. */
document.getElementById('buyRoomsChips').addEventListener('click', (e)=>{
  const chip = e.target.closest('.chip[data-buy-rooms]');
  if (!chip) return;
  const on = chip.getAttribute('aria-pressed') === 'true';
  chip.setAttribute('aria-pressed', String(!on));
  const val = chip.dataset.buyRooms;
  if (on) buyState.rooms.delete(val); else buyState.rooms.add(val);
  buySetError(2, '');
});

['buyPriceMin','buyPriceMax','buySizeMin','buySizeMax'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=> buySetError(2, ''));
});
[['buyName',3], ['buyPhone',3], ['buyEmail',3], ['buyArea',1]].forEach(([id, step])=>{
  document.getElementById(id).addEventListener('input', (e)=>{
    e.target.classList.remove('invalid');
    buySetError(step, '');
  });
});

/* --- שלב 3: ערוץ העדכון --- */
document.getElementById('buyChannels').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-buy-channel]');
  if (!btn) return;
  document.querySelectorAll('#buyChannels button').forEach(b=> b.classList.toggle('active', b === btn));
  buyState.channel = btn.dataset.buyChannel;
  document.getElementById('buyPhoneField').hidden = buyState.channel === 'email';
  document.getElementById('buyEmailField').hidden = buyState.channel === 'whatsapp';
  buySetError(3, '');
});

/* --- ניווט בין השלבים --- */
buyerForm.querySelectorAll('[data-buy-next]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const from = Number(btn.closest('.wiz-panel').dataset.panel);
    if (!buyValidateStep(from)) return;
    buyGoToStep(Number(btn.dataset.buyNext));
  });
});
buyerForm.querySelectorAll('[data-buy-back]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    buySetError(Number(btn.closest('.wiz-panel').dataset.panel), '');
    buyGoToStep(Number(btn.dataset.buyBack));
  });
});

const buyNum = (id)=>{ const v = document.getElementById(id).value.trim(); return v === '' ? null : Number(v); };
function buyAreaText(){ return document.getElementById('buyArea').value.trim(); }

/* מה שנשמר בפועל. ‏'+6' פירושו "6 ומעלה", כלומר מינימום בלי מקסימום. */
function buyCriteria(){
  const roomVals = [...buyState.rooms].map(r => r === '+6' ? 6 : parseFloat(r)).filter(n => !isNaN(n));
  const openEnded = buyState.rooms.has('+6');
  const commercial = buyState.category === 'commercial';
  const area = hoodState.rows.length ? '' : buyAreaText();
  return {
    deal_type: buyState.deal,
    category: buyState.category,
    cities: area ? [area] : [],
    neighborhood_ids: [...buyState.hoods],
    property_types: [...buyState.ptypes],
    min_rooms: roomVals.length ? Math.min(...roomVals) : null,
    max_rooms: (roomVals.length && !openEnded) ? Math.max(...roomVals) : null,
    min_price: buyNum('buyPriceMin'),
    max_price: buyNum('buyPriceMax'),
    min_size_sqm: commercial ? buyNum('buySizeMin') : null,
    max_size_sqm: commercial ? buyNum('buySizeMax') : null,
  };
}
function buyHasCriteria(c){
  return !!(c.cities.length || c.neighborhood_ids.length || c.property_types.length ||
    c.min_rooms !== null || c.max_rooms !== null || c.min_price !== null || c.max_price !== null ||
    c.min_size_sqm !== null || c.max_size_sqm !== null);
}

function buyValidateStep(step){
  if (step === 1){
    // שכונה אינה חובה — "כל האזורים" הוא חיפוש לגיטימי כל עוד יש תנאי אחר,
    // וזה נבדק בשלב הבא שבו התנאים האלה נבחרים
    buySetError(1, '');
    return true;
  }
  if (step === 2){
    if (!buyHasCriteria(buyCriteria())){
      buySetError(2, 'בחרו לפחות תנאי אחד - שכונה, סוג נכס, חדרים או תקציב');
      return false;
    }
    buySetError(2, '');
    return true;
  }
  if (step === 3){
    const nameEl  = document.getElementById('buyName');
    const phoneEl = document.getElementById('buyPhone');
    const emailEl = document.getElementById('buyEmail');
    const name  = nameEl.value.trim();
    const phone = buyState.channel === 'email' ? '' : phoneEl.value.trim();
    const email = buyState.channel === 'whatsapp' ? '' : emailEl.value.trim();
    const badName  = name.length < 2;
    const badPhone = buyState.channel !== 'email' && phone.replace(/\D/g, '').length < 9;
    const badEmail = buyState.channel !== 'whatsapp' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    nameEl.classList.toggle('invalid', badName);
    phoneEl.classList.toggle('invalid', badPhone);
    emailEl.classList.toggle('invalid', badEmail);
    if (badName)  { buySetError(3, 'נא להזין שם מלא'); nameEl.focus(); return false; }
    if (badPhone) { buySetError(3, 'נא להזין מספר טלפון תקין'); phoneEl.focus(); return false; }
    if (badEmail) { buySetError(3, 'נא להזין כתובת אימייל תקינה'); emailEl.focus(); return false; }
    buySetError(3, '');
    return true;
  }
  return true;
}

const BUY_DEAL_LABELS = { sale:'לקנייה', rent:'להשכרה' };

/* הסיכום שמעל שדות הקשר: מה בדיוק יישמר ברגע שנמסר טלפון. */
function buyRenderRecap(){
  const c = buyCriteria();
  const hoodNames = c.neighborhood_ids.map(id => hoodState.byId.get(id)?.name).filter(Boolean);
  const rooms = c.min_rooms && c.max_rooms && c.min_rooms !== c.max_rooms ? `${c.min_rooms}-${c.max_rooms} חדרים`
              : c.min_rooms ? `${c.min_rooms} חדרים${!c.max_rooms ? ' ומעלה' : ''}`
              : c.max_rooms ? `עד ${c.max_rooms} חדרים` : null;
  const budget = c.min_price && c.max_price ? `${nis(c.min_price)}-${nis(c.max_price)} ₪`
               : c.max_price ? `עד ${nis(c.max_price)} ₪`
               : c.min_price ? `מ-${nis(c.min_price)} ₪` : null;
  const parts = [
    BUY_DEAL_LABELS[c.deal_type],
    c.category === 'commercial' ? 'נכס מסחרי' : null,
    hoodNames.length ? '📍 ' + hoodNames.join(', ') : (c.cities.length ? '📍 ' + c.cities.join(', ') : '📍 כל האזורים'),
    c.property_types.length ? '🏠 ' + c.property_types.join(', ') : null,
    rooms,
    budget ? '💰 ' + budget : null,
    c.min_size_sqm || c.max_size_sqm
      ? `📐 ${c.min_size_sqm || ''}${c.min_size_sqm && c.max_size_sqm ? '-' : ''}${c.max_size_sqm || ''} מ״ר` : null,
  ].filter(Boolean);
  document.getElementById('buyRecap').textContent = parts.join(' · ');
}

/* כותרת החיפוש, כפי שתופיע בהתראה ובכרטיס הליד — נבנית בעברית מהחלקים,
   בדיוק כמו ssaBuildLabel של הבלון. */
function buyBuildLabel(c){
  const hoodNames = c.neighborhood_ids.map(id => hoodState.byId.get(id)?.name).filter(Boolean);
  const rooms = c.min_rooms && c.max_rooms && c.min_rooms !== c.max_rooms ? `${c.min_rooms}-${c.max_rooms} חדרים`
              : c.min_rooms ? `${c.min_rooms} חדרים${!c.max_rooms ? ' ומעלה' : ''}`
              : c.max_rooms ? `עד ${c.max_rooms} חדרים` : null;
  const place = hoodNames.length ? hoodNames.join(', ') : (c.cities.length ? c.cities.join(', ') : null);
  return [
    rooms || c.property_types[0] || (c.category === 'commercial' ? 'נכס מסחרי' : 'נכס'),
    place ? 'ב' + place : null,
    BUY_DEAL_LABELS[c.deal_type],
    c.max_price ? 'עד ' + nis(c.max_price) + ' ₪' : null,
  ].filter(Boolean).join(' ').slice(0, 200);
}

buyerForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!buyValidateStep(3)) return;
  const c = buyCriteria();
  if (!buyHasCriteria(c)){
    buySetError(3, 'הוסיפו לפחות תנאי אחד - שכונה, סוג נכס, חדרים או תקציב');
    buyGoToStep(2);
    return;
  }

  const btn = document.getElementById('buySubmitBtn');
  const originalLabel = btn.textContent;
  btn.textContent = 'שולח…';
  btn.disabled = true;

  const payload = {
    ...c,
    full_name: document.getElementById('buyName').value.trim(),
    phone: buyState.channel === 'email' ? '' : document.getElementById('buyPhone').value.trim(),
    email: buyState.channel === 'whatsapp' ? '' : document.getElementById('buyEmail').value.trim(),
    contact_channel: buyState.channel,
    label: buyBuildLabel(c),
    required_features: [],
    consent_agent_contact: document.getElementById('buyConsent').checked,
    // מי שהגיע/ה לכאן ממחשבון התשואה מחפש/ת נכס להשקעה, וזה מה שיירשם
    // ביומן הניתוב — אותו טופס, שני מקורות שונים
    source: buyState.source,
  };

  try{
    const res = await fetch(SAVED_SEARCH_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error){
      const messages = {
        too_many_searches: `הגעתם למקסימום החיפושים השמורים (${data.limit || 5}). אפשר להפסיק חיפוש קיים מהקישור שבהתראה.`,
        no_criteria: 'הוסיפו לפחות תנאי אחד - שכונה, סוג נכס, חדרים או תקציב',
        invalid_phone: 'נא להזין מספר טלפון תקין',
        invalid_email: 'נא להזין כתובת אימייל תקינה',
        invalid_name: 'נא להזין שם מלא',
      };
      throw new Error(messages[data.error] || 'השמירה נכשלה - נסו שוב');
    }
    // ‏duplicate=true פירושו שהחיפוש הזה כבר שמור. מבחינת המחפש/ת זו הצלחה.
    document.getElementById('buyDoneText').textContent = data.duplicate
      ? 'החיפוש הזה כבר שמור אצלנו - נעדכן אתכם ברגע שיעלה נכס מתאים.'
      : 'נעדכן אתכם ברגע שיעלה נכס שמתאים למה שביקשתם.';
    buyerForm.hidden = true;
    document.getElementById('buySteps').hidden = true;
    buyDoneEl.hidden = false;
    if (window.shukTrack) shukTrack('generate_lead', {
      form_id: 'buyer_banner',
      is_duplicate: !!data.duplicate,
    });
  } catch(err){
    console.warn('saved-search-intake (buyer banner) failed:', err);
    buySetError(3, err.message && err.message !== 'Failed to fetch'
      ? err.message : 'השמירה נכשלה - בדקו חיבור לאינטרנט ונסו שוב');
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

document.getElementById('buyRestart').addEventListener('click', ()=>{
  buyerForm.reset();
  buyState.source = 'homepage_buyer_wizard';
  buyState.hoods.clear();
  buyState.rooms.clear();
  buyState.ptypes.clear();
  buyerForm.querySelectorAll('.chip').forEach(c=> c.setAttribute('aria-pressed','false'));
  buyerForm.querySelectorAll('.wiz-input').forEach(i=> i.classList.remove('invalid'));
  [1,2,3].forEach(s => buySetError(s, ''));
  const btn = document.getElementById('buySubmitBtn');
  btn.textContent = 'קבלת עדכונים';
  btn.disabled = false;
  buyDoneEl.hidden = true;
  buyerForm.hidden = false;
  document.getElementById('buySteps').hidden = false;
  buyGoToStep(1);
});

// מצב פתיחה: סוגי הנכס למגורים, ותיבת האזור החופשית עד שרשימת השכונות
// מגיעה מהמסד (‏initPropertyUI קורא ל-renderBuyerHoods שוב אחרי הטעינה)
renderBuyPtypes();
renderBuyerHoods();

/* נקודת הסנכרון היחידה בין המפה לשורות התוצאות: כל קריאה — טעינה
   ראשונית או runSearch() — מעדכנת את שתיהן לאותם נכסים בדיוק.

   עד כה ישבה כאן גם רשימת "כל הנכסים הפעילים" שבתחתית העמוד, והיא ירדה:
   אותו מלאי כבר מוצג פעמיים באותו עמוד — על המפה ובשני מדפי הנכסים, שם
   הוא ממוין, מסונן בתגיות ונפתח ב"עוד נכסים" — ורשימה שלישית שגוללת
   לאורך מסכים שלמים רק דחפה את סוף העמוד רחוק יותר. */
function renderPropertyGrid(properties, isSearchResult){
  /* רשימה חדשה מתחילה מהרשימה ולא מהמסגרת: החיפוש (או שחרור התגיות, או
     הטעינה הראשונית) הוא שקובע מה מוצג, ו-fitMapToMarkers שבא אחריו מזיז
     את המפה — כלומר יורה moveend. בלי הכיבוי כאן אותו moveend היה מחליף
     מיד את "40 נכסים תואמים" ב"40 נכסים בתחום המפה", בלי שאיש נגע במפה.
     מחווה הבאה על המפה מדליקה את המצב מחדש. */
  exitMapViewRows();
  renderMap(properties);
  renderSearchRows(properties, isSearchResult);
}

/* ‏newestFirst, אריח הנכס (‏propCard) והשורה הדחוסה (‏propRow) עברו
   ל-assets/prop-shelf.js: שלוש התצוגות שהשתמשו בהם — תיבת הנכסים כאן,
   הנכסים בדף המשרד והנכסים בדף הסוכן/ת — מצוירות היום מאותו מנוע.
   ‏thumbStyle/thumbFallback נשארו כאן, כי שורות התוצאות ובלוני המפה
   עדיין משתמשים בהם. */

/* חזרה מתוצאות החיפוש אל כל הנכסים שבמאגר. בלי כפתור כזה אין דרך לבטל
   חיפוש חוץ מרענון העמוד: חיפוש ריק הוא עדיין חיפוש (הוא מסונן לפי סוג
   העסקה שנבחר) ולא מחזיר את התצוגה המלאה. */
/* ============================================================
   מסנן ההדמיות
   ------------------------------------------------------------
   נקודות הכניסה: התגית ב-hero, באנר ההדמיות שבסוף תיבת הנכסים, והכתובת
   עצמה — ‎?ai=1‎ מדליק את המסנן דרך applyDeepLinkFilters. ‏window.ShukSearch
   נשאר חשוף כדי שרכיב חיצוני יוכל להדליק אותו בלי לגעת במנוע החיפוש.

   הכתובת מתעדכנת ולא רק המצב הפנימי: תוצאות צריכות להיות ניתנות לשיתוף
   ולאינדוקס, וזו הסיבה שגם applyDeepLinkFilters יודע לקרוא אותו.
   ============================================================ */
function setAiFilter(on){
  searchState.hasAi = !!on;
  const chip = document.getElementById('aiFilterChip');
  if (chip) chip.hidden = !on;
}

/* מדליק את המסנן, מריץ חיפוש, וגולל לתוצאות. נקרא מהקישור העמוק
   ומ-window.ShukSearch, ולכן הוא זה שמחזיק את ההתנהגות במקום אחד.

   שלושת ה-replaceState בקטע הזה מעבירים את history.state הקיים ולא null:
   הרשומה שהם כותבים עליה היא הזקיף של assets/exit-guard.js, וסימון שנמחק
   ממנה היה מבלבל את השאלה שלפני היציאה מהאתר. */
async function applyAiFilter(){
  setAiFilter(true);
  try{
    const url = new URL(location.href);
    url.searchParams.set('ai', '1');
    history.replaceState(history.state, '', url);
  } catch(e){ /* דפדפן שחוסם היסטוריה — המסנן עדיין עובד */ }
  await runSearch();
  document.getElementById('searchResults')
    ?.scrollIntoView({ behavior:'smooth', block:'start' });
}

window.ShukSearch = { applyAiFilter };

/* כיבוי מהצ׳יפ: מוריד את המסנן ואת הפרמטר מהכתובת, ומריץ מחדש את אותו
   חיפוש בלי לגעת בשאר הסינון — בשונה מ"ניקוי החיפוש" שמאפס הכול. */
document.getElementById('aiFilterChip')?.addEventListener('click', async ()=>{
  setAiFilter(false);
  try{
    const url = new URL(location.href);
    url.searchParams.delete('ai');
    history.replaceState(history.state, '', url);
  } catch(e){ /* כנ"ל */ }
  await runSearch();
});

async function clearSearch(){
  document.getElementById('searchFreeText').value = '';
  setAiFilter(false);
  hoodState.selected = new Set();
  hoodState.draft = new Set();
  drawHoodShapes();
  document.getElementById(searchState.activeTab === 'commercial' ? 'cClearFilters' : 'rClearFilters').click();
  // אחרי איפוס הסינונים ולא לפניו: הוא מחזיר גם את סוג העסקה המסחרי
  // ל"מכירה", ואיתו משתנים המונים ודירוג השכונות
  renderHoodFilter();
  const badge = document.getElementById('filterCountBadge');
  badge.style.display = 'none';
  badge.textContent = '0';

  try{
    const url = new URL(location.href);
    url.searchParams.delete('ai');
    history.replaceState(history.state, '', url);
  } catch(e){ /* דפדפן שחוסם היסטוריה */ }

  /* גם התגיות שבמדף יורדות: מאז שהן מסננות את המפה, "ניקוי החיפוש" שמשאיר
     אותן דלוקות מחזיר מפה מלאה מעל מדף שעדיין מסונן — שני מספרים סותרים
     באותו מסך. ‏ppShelfFiltered מתאפס *לפני* selectTag כדי ש-ppShelfToMap
     לא תצייר את המפה מחדש בדרך: השורה שאחריה עושה זאת ממילא. */
  ppShelfFiltered = false;
  propsShelf.selectTag('');

  /* "ניקוי החיפוש" הוא גם היציאה ממצב "תחום המפה": הסקציה חוזרת להיות
     מוסתרת, והדף חוזר בדיוק לסדר שאיתו נטען — מפה, מבזק, הדמיות, יריד,
     תיבת הנכסים. ‏renderPropertyGrid בשורה שאחריה מכבה את המצב ממילא;
     הכיבוי המפורש כאן הוא כדי ש-moveend של ה-fit לא ידליק אותו בחזרה. */
  exitMapViewRows();

  searchHasRun = false;
  renderPropertyGrid(await loadProperties());
  document.getElementById('heroSection').scrollIntoView({ behavior:'smooth', block:'start' });
}

initFilterModals();
document.getElementById('searchSubmitBtn').addEventListener('click', runSearch);
document.getElementById('clearSearchBtn').addEventListener('click', clearSearch);

/* ============================================================
   גלריית הפרויקטים החדשים
   ------------------------------------------------------------
   שני האריחים הראשונים שמורים לפרויקטים מקודמים — זה מה שהיזם קונה
   ב-50 ₪ לשבוע, וזו הסיבה ששורת ההסבר מתחת לגלריה אומרת זאת במפורש
   ומשתנה לפי מה שבאמת מוצג: כשאין אף מקודם היא לא מבטיחה מקודמים.

   הקידום כבר חושב מול השעון ב-projects_public (‏is_promoted שם הוא
   ביטוי ולא עמודה), ולכן כאן זה דגל ותו לא — ואין סיכון להציג פרויקט
   שחלון הקידום שלו נסגר אתמול.

   כישלון בטעינה משאיר את הסקציה מוסתרת ולא מציג הודעת שגיאה: מודול
   שנפל אינו סיבה לקלקל את דף הבית.
   ============================================================ */
(async function renderNewProjects(){
  const section = document.getElementById('newProjects');
  const gallery = document.getElementById('projectsGallery');
  if (!section || !gallery || !window.ProjectCard || !sb) return;

  try{
    const { data, error } = await sb.from('projects_public')
      .select('*').order('published_at', { ascending:false }).limit(24);
    if (error) throw error;
    const list = ProjectCard.sortForGallery(data || []);
    if (!list.length) return;

    const PROMOTED_SLOTS = 2;
    const shown = list.slice(0, 8);
    shown.forEach((p, i)=>{
      const card = ProjectCard.render(p);
      // ‏.lead רק כשהאריח באמת מקודם. פרויקט רגיל שנחת במקום הראשון
      // בגלל שאין מקודמים לא צריך לקבל את הבמה שנמכרת בכסף.
      if (i < PROMOTED_SLOTS && p.is_promoted) card.classList.add('lead');
      gallery.appendChild(card);
    });

    const promotedShown = shown.slice(0, PROMOTED_SLOTS).filter(p => p.is_promoted).length;
    document.getElementById('projectsNote').textContent = promotedShown
      ? (promotedShown === 1
          ? 'הפרויקט הראשון בגלריה הוא תוכן שיווקי בתשלום של היזם. השאר לפי מועד פרסום.'
          : 'שני הפרויקטים הראשונים בגלריה הם תוכן שיווקי בתשלום של היזמים. השאר לפי מועד פרסום.')
      : 'הפרויקטים מסודרים לפי מועד פרסום - החדשים ביותר בראש.';

    section.hidden = false;
  } catch(e){
    console.warn('טעינת הפרויקטים החדשים נכשלה:', e);
  }
})();

/* ============================================================
   קישורי חיפוש עמוקים (‎?deal=…&rooms=…‎)
   ------------------------------------------------------------
   "דירות 3 חדרים למכירה בעפולה" בפוטר, וכל קישור חיצוני שמפנה לחיפוש
   מסוים, נוחתים על דף הבית עם פרמטרים ב-URL. בלי זה הם היו מגיעים לדף
   הבית הכללי, והמבקר/ת היה/תה צריך/ה להרכיב את הסינון שוב ידנית.

   הפרמטרים מסוננים מול אותן רשימות שמזינות את הטופס (‎ROOM_OPTIONS‎,
   ‎RESIDENTIAL_PTYPES‎, ‎COMMERCIAL_PTYPES‎), ולכן ערך מומצא ב-URL לא נכנס
   ל-searchState ולא מגיע לשאילתה — הוא פשוט מתעלם.
   ============================================================ */
function applyDeepLinkFilters(){
  const params = new URLSearchParams(location.search);
  if (![...params.keys()].length) return;

  const deal = params.get('deal');
  const isCommercial = deal === 'commercial';
  if (deal === 'sale' || deal === 'rent' || deal === 'commercial'){
    searchState.activeTab = deal;
    const select = document.getElementById('dealTypeSelect');
    if (select){ select.value = deal; select.dataset.mode = deal; }
  }
  const s = isCommercial ? searchState.c : searchState.r;

  const rooms = (params.get('rooms') || '').split(',').map(v=>v.trim()).filter(Boolean);
  rooms.forEach(r=>{ if (ROOM_OPTIONS.includes(r)) s.rooms.add(r); });

  const allPtypes = isCommercial
    ? COMMERCIAL_PTYPES
    : [...RESIDENTIAL_PTYPES.apt, ...RESIDENTIAL_PTYPES.house, ...RESIDENTIAL_PTYPES.other];
  const ptype = params.get('ptype');
  if (ptype && allPtypes.includes(ptype)) s.ptypes.add(ptype);

  // המחירים נכתבים גם לשדות המודאל ולא רק ל-searchState: ‏collectFormValues()
  // קורא מהשדות בכל חיפוש, וערך שהיה רק ב-state היה נמחק בחיפוש הבא
  const priceField = (key, id)=>{
    const raw = params.get(key);
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return;
    const el = document.getElementById(id);
    if (el) el.value = String(Math.round(n));
  };
  priceField('minPrice', isCommercial ? 'cPriceMin' : 'rPriceMin');
  priceField('maxPrice', isCommercial ? 'cPriceMax' : 'rPriceMax');

  const q = (params.get('q') || '').trim();
  if (q) document.getElementById('searchFreeText').value = q.slice(0, 80);

  // ‏?ai=1 — נכסים שיש להם לפחות הדמיה אחת. זה מה שנשלח כששולחים את
  // התוצאות לחבר/ה, וזו נקודת הכניסה היחידה למסנן מאז שהרצועה ירדה.
  setAiFilter(params.get('ai') === '1');

  // הטופס נבנה מחדש כדי שהצ׳יפים של החדרים וסוגי הנכס ייראו מסומנים כשמי
  // שהגיע/ה מהקישור יפתח/תפתח את המסננים
  initFilterModals();
  renderHoodFilter();
  runSearch();
}
applyDeepLinkFilters();
