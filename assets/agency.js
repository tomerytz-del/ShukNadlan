const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';

/* ---------- ספריית אייקונים ----------
   אותם אייקוני קו במשקל אחיד כמו בדף הנכס, מוטמעים כדי לא להוסיף בקשת רשת. */
const S = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  star:    S('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
  pin:     S('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  check:   S('<path d="M20 6 9 17l-5-5"/>'),
  chevron: S('<path d="m14 6-6 6 6 6"/>'),
  chevronR:S('<path d="m10 6 6 6-6 6"/>'),
  search:  S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  phone:   S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"/>'),
  // תגיות האמון והכלים
  trend:   S('<path d="M3 17.5 9.5 11l4 4L21 7"/><path d="M15.5 7H21v5.5"/>'),
  shield:  S('<path d="M12 22s7.5-3.4 7.5-9.4V5.6L12 2.5 4.5 5.6v7c0 6 7.5 9.4 7.5 9.4Z"/><path d="m8.9 12.2 2.2 2.2 4-4.3"/>'),
  handles: S('<path d="M8 12.5 5 9.6a2 2 0 0 1 0-2.9l2.4-2.3a2 2 0 0 1 2.6-.1L12 5.7l2-1.4a2 2 0 0 1 2.6.1L19 6.7a2 2 0 0 1 0 2.9l-3 2.9"/><path d="m9.5 14 2 2M12 11.5l2.5 2.5M14.5 9.5 17 12"/><path d="M4.5 13.5 8 17l3 3a2 2 0 0 0 2.8 0l5.7-5.6"/>'),
  calc:    S('<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 6.5h8"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>'),
  chat:    S('<path d="M21 12a8 8 0 0 1-8 8H4.5l1.4-3.1A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>'),
  gauge:   S('<path d="M3.5 18a9 9 0 1 1 17 0"/><path d="m12 14 3.5-3.8"/><circle cx="12" cy="15.5" r="1.6"/>'),
};
// לוגו וואטסאפ הוא צורה מלאה ולא קו, ולכן הוא לא עובר דרך S()
const WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.2.1-1.9-.1a13 13 0 0 1-5.6-4.6c-.6-.9-1-1.9-1-2.8 0-1 .5-1.7 1-2 .2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.5.9 1.1 1.6 2 2.2.3.2.5.2.7 0l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.4.4.1.2.1.7-.1 1.4Z"></path></svg>';

/* ‏escapeHtml מגיעה מ-assets/esc.js — הגדרה אחת לכל האתר. */

/* התמונה הראשית של הנכס; בלי תמונות מוצג ממלא מקום עם לוגו המשרד */
/* תמונת כרטיס מוקטנת - אותה נוסחה כמו cardImgUrl ב-assets/home.js
   (‏docs/image-sizes.md). כתובת שאינה מהאחסון שלנו - כמו שהיא. */
function cardImgUrl(url, w){
  const s = String(url || '');
  const marker = '/storage/v1/object/public/';
  const at = s.indexOf(marker);
  if (at < 0) return s;
  const path = s.slice(at + marker.length).split(/[?#]/)[0];
  if (!path) return s;
  return s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=' + (w || 640) + '&quality=60';
}
function thumbStyle(p){
  const img = safeImageUrl(p.images && p.images[0]);
  return img ? ` style="background-image:url('${encodeURI(cardImgUrl(img))}')"` : '';
}

const NO_PHOTOS_NOTE = 'תמונות של הנכס יעלו בקרוב';
const SITE_LOGO = 'assets/logo-shuknadlan.svg';

/* המשרד שהעמוד מוקדש לו — נשמר כדי שאריח נכס בלי תמונות יוכל להציג את
   הלוגו והשם שלו. */
let currentAgency = null;

function thumbFallback(p){
  if (safeImageUrl(p.images && p.images[0])) return '';
  const name = (currentAgency && currentAgency.name) || '';
  const logo = (currentAgency && safeImageUrl(currentAgency.logo_url)) || (name ? '' : SITE_LOGO);
  const mark = logo
    ? `<img class="tf-logo" src="${escapeHtml(encodeURI(logo))}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.remove()">`
    : `<span class="tf-logo tf-initial" aria-hidden="true">${escapeHtml(name.trim()[0] || '?')}</span>`;
  return `<div class="thumb-fallback">
      ${mark}
      ${name ? `<span class="tf-agency">${escapeHtml(name)}</span>` : ''}
      <span class="tf-note">${NO_PHOTOS_NOTE}</span>
    </div>`;
}

/* ---------- שורות המידע של המקטעים ----------
   המספרים של המשרד (כמה נכסים, כמה סוכנים, איזה דירוג) כבר לא יושבים
   בקפסולות נפרדות אלא לצד כותרת המקטע שאליו הם שייכים. טוען שאין לו מה
   לדווח פשוט לא כותב כלום — שורת מידע ריקה גרועה משורה שאינה. */
function setSectionNote(id, text){
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

/* ---------- תגיות האמון ----------
   קודם עמדה כאן שורת "תחומי התמחות" גנרית: אותן קפסולות שמופיעות בכל משרד
   ואומרות רק באיזו קטגוריה הוא עובד. תגית אמון היא משהו אחר — היא אומרת
   *במה המשרד הזה טוב*, ולכן היא מנוסחת כהצהרת מומחיות ("מומחי נכסים
   מסחריים", "ליווי פינוי בינוי ותמ״א") ולא כשם קטגוריה ("מסחרי").

   לצד ההצהרות עומדות תגיות שנשענות על נתון ולא על ניסוח: ליווי עסקאות
   מורכבות (מי שסוגר/ת מסחרי, קרקעות או התחדשות עירונית בפועל), ותק
   בשטח לפי מספר העסקאות שנסגרו, וחתימה על הקוד האתי. תגית שאין מאחוריה
   נתון פשוט לא נוצרת.

   המקור לתחומים נשאר Specialties: מה שהמשרד סימן ב-CRM גובר, ומשרד שלא
   סימן מקבל גזירה מהנכסים שלו בפועל. */

/* הניסוח המקצועי לכל תחום. הוא מכוון לשאלה "למה דווקא אתם" ולא לשאלה
   "מה אתם מוכרים" — ולכן הוא ארוך מעט מה-short של הקטלוג. */
const EXPERTISE_LABELS = {
  residential_sale:    'מומחי דירות ובתים למכירה',
  residential_rent:    'מומחי שוק השכירות',
  commercial:          'מומחי נכסים מסחריים',
  income:              'מומחי נכסים מניבים והשקעות',
  land:                'מומחי קרקעות, מגרשים ונחלות',
  urban_renewal:       'ליווי פינוי בינוי ותמ״א',
  new_projects:        'שיווק פרויקטים מקבלן',
  luxury:              'מומחי נכסי יוקרה',
  industrial:          'מומחי תעשייה ולוגיסטיקה',
  property_management: 'ניהול נכסים עבור בעלים',
};

/* התחומים שעסקה בהם היא עסקה מורכבת בפועל: משא ומתן מול יותר מצד אחד,
   בדיקות תכנוניות, או ליווי לאורך חודשים. משרד שמצהיר על אחד מהם מקבל את
   התגית — היא נגזרת מההצהרה ולא ניתנת להקלדה חופשית. */
const COMPLEX_SPECIALTIES = ['commercial', 'land', 'urban_renewal', 'industrial', 'income'];

/* ---------- כמה תגיות מומחיות מוצגות ----------
   תחום ש**המשרד סימן בעצמו** ב-CRM מוצג תמיד. קודם הייתה כאן תקרה, ומנהל
   שסימן שישה תחומים ראה ארבעה בדף שלו — בלי שדבר יסביר לו לאן נעלמו
   השניים. התקרה במסד (‏6, ‎agencies_specialties_check‎) היא כבר הגבול, והיא
   נבחרה בדיוק כדי שהשורה לא תתפוצץ.

   תגיות **שנגזרו** מהנכסים — למשרד שעדיין לא סימן דבר — כן נחתכות בשלוש:
   הן ניחוש, ולא הצהרה, ואין סיבה שניחוש ימלא את הרצועה. */
const DERIVED_EXPERTISE_SHOWN = 3;

/* מספר חוות הדעת המינימלי שמצדיק מקטע ביקורות — ודירוג מוצג. מתחתיו הדף
   שותק לגמרי בנושא (ראו ההסבר ב-loadReviews). */
const MIN_REVIEWS_SHOWN = 2;

/* כל מה שהדף למד על המשרד תוך כדי טעינה. הסרגל והתגיות נבנים מחדש בכל
   פעם שנתון חדש נכנס, כי הם נטענים בשאילתות נפרדות שחוזרות לא לפי סדר. */
const agencyStats = {
  specialtyIds: [],
  specialtyDeclared: false,
  activeProperties: null,
  deals: null,
  dealsRecent: null,
  teamSize: null,
  rating: null,
  ratingCount: null,
  ethics: false,
};

function trustChipsHtml(){
  const chips = [];
  const add = (icon, text, cls) =>
    chips.push(`<span class="trust-chip${cls ? ' ' + cls : ''}">` +
      `<span class="ic" aria-hidden="true">${icon}</span>` +
      `<span class="tx">${escapeHtml(text)}</span></span>`);

  const specs = agencyStats.specialtyDeclared
    ? agencyStats.specialtyIds
    : agencyStats.specialtyIds.slice(0, DERIVED_EXPERTISE_SHOWN);
  specs.forEach(id=>{
    const label = EXPERTISE_LABELS[id];
    if (label) add(window.Specialties ? Specialties.iconFor(id) : ICON.check, label, 'is-spec');
  });

  if (specs.some(id => COMPLEX_SPECIALTIES.includes(id))){
    add(ICON.handles, 'ליווי עסקאות מורכבות', 'is-spec');
  }
  /* מספרים — כמה עסקאות, כמה סוכנים, איזה דירוג — לא נכנסים לכאן: הם
     יושבים בתאים שמעל, וחזרה עליהם בקפסולה היא בדיוק אותה כפילות שהדף
     הזה בא לנקות. הרצועה נשארת אמירות בלבד. */
  if (agencyStats.deals >= 10){
    add(ICON.trend, 'ניסיון מוכח בסגירת עסקאות');
  }
  /* "חתום על הקוד האתי" ירד מכאן: התו עצמו עלה לסרגל המדדים, והכיתוב
     שמתחתיו אומר בדיוק את זה. תגית שחוזרת על התו שלצדה היא כפילות. */
  return chips.join('');
}

function statCellsHtml(){
  const cells = [];
  const add = (value, label) => cells.push(`<div class="stat-cell"><div class="n">${value}</div><div class="l">${escapeHtml(label)}</div></div>`);

  if (agencyStats.activeProperties > 0){
    add(String(agencyStats.activeProperties), agencyStats.activeProperties === 1 ? 'נכס פעיל' : 'נכסים פעילים');
  }
  /* מספר העסקאות שנסגרו אינו תא: הסרגל מחזיק שני תאים קבועים — הנכסים
     הפעילים ותו האיכות — ותא שלישי שמופיע רק לחלק מהמשרדים היה שובר את
     הרשת לשורה שנייה עם חצי תא ריק. מה שיש למספר הזה לומר נאמר ברצועה
     שמתחת ("ניסיון מוכח בסגירת עסקאות"), ובמקטע סיפורי ההצלחה עצמו. */
  /* מספר המתווכים אינו תא בסרגל: הוא כתוב ממילא בכותרת "נבחרת המתווכים"
     שמיד מתחת, ובמקומו יושב כאן תו האיכות — מדד אמון ולא מספר. התו עצמו
     נשתל אחרי ה-innerHTML (‏mountBadgeCell), כי הוא כפתור עם מאזין. */
  if (agencyStats.ethics){
    cells.push('<div class="stat-cell is-badge" id="ethicsCell">' +
      '<div class="n" id="ethicsBadgeSlot"></div>' +
      '<div class="l">✦ מחויבות לשירות הוגן</div></div>');   // השם מ-27.10 (חלק 7, החלטה 8)
  }
  /* הדירוג אינו תא בסרגל: הוא כבר מופיע בבאנר עצמו (‏heroRating, עם
     הכוכבים ומספר הביקורות מאחוריו) ושוב בכותרת מקטע הביקורות. תא שלישי
     שחוזר על אותו מספר הוא בדיוק הכפילות שהסרגל הזה בא לנקות. */
  return cells.join('');
}

/* התו נשתל בכל ציור מחדש של הסרגל — ‏innerHTML מוחק את הכפתור הקודם יחד
   עם המאזין שלו, ולכן אין כאן דליפה אלא החלפה. */
function mountBadgeCell(){
  const slot = document.getElementById('ethicsBadgeSlot');
  if (!slot || !window.QualityBadge) return;
  QualityBadge.mount(slot, {
    size:'md',
    subject: (currentAgency && currentAgency.name) || 'המשרד',
  });
}

function renderTrustBar(){
  const bar = document.getElementById('statBar');
  const cells = statCellsHtml();
  const chips = trustChipsHtml();
  if (!cells && !chips){ bar.hidden = true; return; }
  const grid = document.getElementById('statGrid');
  const strip = document.getElementById('trustStrip');
  if (grid && grid.innerHTML !== cells) grid.innerHTML = cells;
  if (strip && strip.innerHTML !== chips) strip.innerHTML = chips;
  mountBadgeCell();
  bar.hidden = false;
}

function renderSpecialties(agency, properties){
  if (!window.Specialties) return;
  const picked = Specialties.forAgency(agency, properties);
  agencyStats.specialtyIds = picked.ids;
  agencyStats.specialtyDeclared = picked.source === 'declared';
  renderTrustBar();
}

/* חמישה כוכבים מלאים שהעמומים שבהם מסמנים את מה שחסר — חצי כוכב היה מדייק
   ולא מוסיף, וכאן הציון המספרי ממילא כתוב לצדם. */
function starsHtml(rating){
  const rounded = Math.round(rating);
  return `<span class="hr-stars">${[1,2,3,4,5]
    .map(i => `<span class="${i <= rounded ? '' : 'off'}">${ICON.star}</span>`).join('')}</span>`;
}

/* ---------- מיתוג המשרד ----------
   מנהל המשרד קובע ב-CRM צבעים, לוגו ותמונת נושא; כאן רק מיישמים. כל שדה
   אופציונלי - משרד שלא הגדיר דבר מקבל את עיצוב ברירת המחדל של הפלטפורמה. */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// הצבעים מגיעים מ-DB שמנהל המשרד כותב אליו, ונכנסים ל-CSS - בלי הסינון הזה
// ערך כמו "red;background:url(...)" היה מוזרק כפשוטו אל תוך גיליון הסגנון.
function safeHex(value, fallback){
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

// בהירות יחסית (WCAG) - הבסיס לכל בדיקות הניגודיות בדף
function relLuminance(hex){
  const full = hex.length === 4 ? '#' + hex.slice(1).split('').map(c=>c+c).join('') : hex;
  return [1,3,5].map(i=>{
    const ch = parseInt(full.slice(i, i+2), 16) / 255;
    return ch <= 0.03928 ? ch/12.92 : Math.pow((ch+0.055)/1.055, 2.4);
  }).reduce((acc, ch, i)=> acc + [0.2126,0.7152,0.0722][i] * ch, 0);
}
function contrastBetween(a, b){
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// יחס הניגודיות בין צבע לבין לבן - קובע אם טקסט לבן עליו יהיה קריא
function contrastWithWhite(hex){
  return contrastBetween(hex, '#ffffff');
}

/* ‏--on-brand ו---on-accent: צבע הטקסט שרץ *על* גוון המשרד - בכפתורי ה-CTA
   של באנרי הלידים, בכותרות הבאנרים ובתגיות. עד כה נבחר לבן בכל פעם שהוא
   עבר 3.2:1, אבל 3.2 הוא הסף של WCAG לטקסט גדול בלבד - ו-CTA ב-‎.82rem‎
   מודגש ("לבדיקה ←") הוא טקסט רגיל, שדורש 4.5:1. משרד עם אקסנט בינוני
   קיבל בדיוק את המצב הזה: לבן שנראה בסדר ולא עבר את התקן.

   הבחירה כאן היא בין שני המועמדים היחידים - לבן ודיו כהה - ומעדיפה את זה
   שעובר 4.5:1. כשגם וגם, הלבן מנצח (זו שפת האתר); כשאף אחד לא עובר -
   גוון בינוני שאין עליו טקסט קריא באמת - נבחר הגבוה מבין השניים, שהוא
   הטוב ביותר שאפשר בלי לשנות את הגוון שהמשרד בחר. */
const ON_COLOR_INK = '#0d1b3d';

/* הבחירה נמדדת מול *שני* הגוונים שהמשטח באמת צבוע בהם, ולא מול אחד מהם.
   כמעט כל משטח מלא באתר הוא מדרג - ‎linear-gradient(--brand-dark → --brand)‎
   בלוח התוצאה, ‎--accent-dark → --accent‎ ב-CTA - ומדידה מול הקצה הבהיר
   בלבד החזירה דיו כהה שנעלם בקצה הכהה של אותו מדרג בדיוק. הגרוע מבין
   השניים הוא מה שקובע. */
function readableOnPair(a, b){
  const onWhite = Math.min(contrastWithWhite(a), contrastWithWhite(b));
  const onInk   = Math.min(contrastBetween(a, ON_COLOR_INK), contrastBetween(b, ON_COLOR_INK));
  if (onWhite >= 4.5) return '#fff';
  if (onInk >= 4.5) return ON_COLOR_INK;
  return onWhite >= onInk ? '#fff' : ON_COLOR_INK;
}

/* כתובת תמונה שמותר להכניס ל-src או ל-url() של CSS.
   מותרים שלושה סוגים: כתובת http(s) מלאה (כך נשמרות תמונות שהועלו דרך
   ה-CRM אל ה-Storage), ונתיב יחסי לאתר עצמו - ‎/…‎ או ‎assets/…‎ - שכך
   נשמרות תמונות שיושבות בריפו. עד כה התקבלו רק כתובות https, וסוכן/ת
   שהתמונה שלו/ה היא ‎assets/agents/…‎ הופיע/ה בדף שלו/ה עם תמונה ובדף
   המשרד בלי - אותו נתון, שני כללים. הכלל כאן זהה לזה שב-agent.html, פרט
   לכך שנתיב שמתחיל ב-‎//‎ נחסם: הוא נראה יחסי אבל טוען מדומיין אחר. */
function safeImageUrl(url){
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  const allowed = /^https?:\/\//i.test(trimmed) || /^(\/(?!\/)|assets\/)/i.test(trimmed);
  return allowed ? trimmed : null;
}

/* אותה נוסחה כמו heroRenderUrl ב-og-tags (1400x800, cover, איכות 60). */
function coverRenderUrl(url){
  const mark = '/storage/v1/object/public/';
  const at = url.indexOf(mark);
  if (at < 0) return url;
  const path = url.slice(at + mark.length).split(/[?#]/)[0];
  if (!path) return url;
  return url.slice(0, at) + '/storage/v1/render/image/public/' + path
    + '?width=1400&height=800&resize=cover&quality=60';
}

function applyBranding(agency){
  const c = agency.colors || {};
  const root = document.documentElement.style;
  applyPageBackground(c);
  const brand = safeHex(c.primary, null);
  const accent = safeHex(c.accent, null);
  if (brand){
    const brandDark = safeHex(c.primary_dark, brand);
    root.setProperty('--brand', brand);
    root.setProperty('--brand-dark', brandDark);
    root.setProperty('--on-brand', readableOnPair(brand, brandDark));
    /* ‏--on-brand-fill הוא אותו חישוב בדיוק, בשם שנשאר תקף גם בתוך רצועה
       כהה: שם ‎--on-brand‎ נדרס ללבן (הרצועה כבר אינה בגוון המשרד), ואילו
       כפתור מלא שבתוכה - ‎.btn-gold‎, שרקעו ‎--teal‎ - עדיין כן. */
    root.setProperty('--on-brand-fill', readableOnPair(brand, brandDark));
  }
  if (accent){
    const accentDark = safeHex(c.accent_dark, accent);
    root.setProperty('--accent', accent);
    root.setProperty('--accent-dark', accentDark);
    root.setProperty('--on-accent', readableOnPair(accent, accentDark));
    /* המקבילה לצבע המשני: טקסט על שבב ‎--gold‎ (שהוא ‎--accent‎) בתוך רצועה. */
    root.setProperty('--on-accent-fill', readableOnPair(accent, accentDark));
    /* ‏--lead-mark: הגוון שנושא "נבחר" בתוך באנרי הלידים. הרצועה עצמה
       צבועה ב---brand, והסימון שבתוכה ב---accent - ואצל משרד ששני הגוונים
       שלו קרובים (ברירת המחדל היא ששניהם זהים) השבב הנבחר נצבע בדיוק
       בצבע הרקע שמאחוריו. מ-2:1 ומעלה האקסנט נבדל מספיק כדי לשאת את
       הסימון בעצמו; מתחת לזה נשאר ערך ברירת המחדל שב-CSS - הגוון המשני
       המבהיר, שנקרא על כל רצועה כהה. */
    if (!brand || contrastBetween(accent, brand) >= 2){
      root.setProperty('--lead-mark', accent);
      root.setProperty('--lead-mark-ink', readableOnPair(accent, accentDark));
    }
    /* ‏--accent-ink נושא טקסט ואייקונים קטנים (מחיר, כוכבים, אייקוני הקפסולות) על רקע
       הכרטיסים. אקסנט בהיר - צהוב, חול, ובוודאי לבן - נכשל שם בניגודיות,
       ולכן נבחר כאן הגוון הראשון שעובר 4.5:1: קודם המשני הכהה, אחריו המשני
       עצמו, ורק אם שניהם בהירים מדי נסוגים לצבע הראשי. */
    const surface = safeHex(c.paper_raised, '#FFFFFF');
    const brandDark = safeHex(c.primary_dark, safeHex(c.primary, '#0d1b3d'));
    const ink = [accentDark, accent, brandDark].find(hex => contrastBetween(hex, surface) >= 4.5) || '#0d1b3d';
    root.setProperty('--accent-ink', ink);
  }
  if (safeHex(c.paper, null)) root.setProperty('--paper', c.paper.trim());
  // ‏paper_raised הוא צבע המשטחים שהמשרד בחר - הוא גובר גם על ‎--surface‎ של
  // השכבה החדשה, אחרת ערכה כהה שנבחרה בכוונה הייתה מקבלת כרטיסים לבנים.
  if (safeHex(c.paper_raised, null)){
    root.setProperty('--paper-raised', c.paper_raised.trim());
    root.setProperty('--surface', c.paper_raised.trim());
  }
  if (safeHex(c.line, null)){
    root.setProperty('--line', c.line.trim());
    root.setProperty('--hair', c.line.trim());
  }

  // תמונת הנושא היא <img> ולא רקע CSS: רקע מתגלה רק אחרי ה-CSS והנתונים,
  // והוא היה ה-LCP. אותה כתובת כמו ה-preload ש-og-tags מזריק (1400x800) -
  // כתובת אחרת מורידה את הקובץ פעמיים.
  const cover = safeImageUrl(agency.cover_url);
  if (cover){
    document.getElementById('banner').classList.add('has-image');
    const src = coverRenderUrl(cover);
    const media = document.getElementById('bannerMedia');
    let img = media.querySelector('img.banner-lcp');
    if (!img){
      img = document.createElement('img');
      img.className = 'banner-lcp';
      img.alt = '';
      img.width = 1400;
      img.height = 800;
      img.decoding = 'async';
      img.setAttribute('fetchpriority', 'high');
      media.appendChild(img);
    }
    if (img.getAttribute('src') !== src) img.src = src;
  }

  const logo = safeImageUrl(agency.logo_url);
  const logoEl = document.getElementById('brandLogo');
  if (!logoEl) return;
  if (logo){
    const img = logoEl.querySelector('img');
    if (img && img.getAttribute('src') === logo) return;
    const next = document.createElement('img');
    next.src = logo;
    next.alt = '';
    next.width = 96;
    next.height = 96;
    logoEl.textContent = '';
    logoEl.appendChild(next);
  } else if (!logoEl.textContent) {
    logoEl.textContent = (agency.name || '?')[0];
  }
}

/* ---------- יצירת קשר עם המשרד ----------
   ל-agencies אין עמודת טלפון - המספר הפומבי היחיד שיש הוא של חברי הצוות
   (‏agency_members_public.phone_e164‎). לכן הפנייה מנותבת למנהל/ת המשרד, ואם
   אין להם מספר - לסוכן/ת הראשון/ה שיש לו. בלי מספר אמיתי הבלוק לא נוצר:
   כפתור שלא מוביל לאיש גרוע מהיעדר כפתור.
   ‏phone_e164 שמור כספרות בלבד (972521112222) - בדיוק מה ש-wa.me ו-tel:
   מצפים לו. הבדיקה כאן היא גם שער אבטחה: המספר נכנס ל-href. */
const PHONE_RE = /^\d{9,15}$/;
const hasPhone = m => PHONE_RE.test(String(m && m.phone_e164 || ''));

/* קישור וואטסאפ עם פתיח שכבר מספר מאיפה הפנייה הגיעה */
function waLink(phone, opener){
  const name = (currentAgency && currentAgency.name) || 'המשרד';
  const text = [
    'היי,',
    opener || `הגעתי לדף של ${name} בשוק הנדל״ן של עפולה והסביבה ואשמח לקבל פרטים.`,
    window.location.href,
  ].join('\n');
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
}

const ROLE_LABELS = { manager:'ניהול משרד', agent:'יועץ נדל״ן' };
const roleLabel = a => ROLE_LABELS[a && a.role] || (a && a.role) || 'יועץ נדל״ן';

/* תמונת הסוכן/ת, ובהיעדרה האות הראשונה של השם. ‏--photo-pos = נקודת המיקוד
   שסומנה ב-CRM; בלעדיה חיתוך למרכז היה קוטע פנים בתמונות פורטרט. */
function agentAvatarHtml(a, cls){
  const name = a.display_name || '?';
  const photo = safeImageUrl(a.photo_url);
  const focus = /^\d{1,3}% \d{1,3}%$/.test(a.photo_position || '') ? a.photo_position : '';
  const inner = photo
    ? `<img src="${encodeURI(photo)}" alt="${escapeHtml(name)}" loading="lazy"${focus ? ` style="--photo-pos:${focus}"` : ''}>`
    : escapeHtml(name.trim()[0] || '?');
  return `<div class="${cls}">${inner}</div>`;
}

function renderAgencyContact(members){
  const reachable = (members || []).filter(hasPhone);
  if (!reachable.length) return;
  const contact = reachable.find(m => m.role === 'manager') || reachable[0];
  const phone = contact.phone_e164;
  const name = (currentAgency && currentAgency.name) || 'המשרד';
  const href = waLink(phone);

  const box = document.getElementById('brandCta');
  const tel = box && box.querySelector('a[href^="tel:"]');
  if (tel && tel.getAttribute('href') === 'tel:+' + phone) {
    const wa = box.querySelector('a.cta-primary');
    if (wa) wa.href = href;
  } else if (box) {
    const pub = window.ShukAgencyPublic;
    box.innerHTML = pub
      ? pub.bannerCtaHtml(phone, href, name)
      : '';
  }

  renderStickyBar(contact, href);
}

/* ---------- הסרגל התחתון ----------
   אותן שתי פעולות של הבאנר, עם הפנים של איש/אשת הקשר לצדן. הוא נדלק רק
   כשהבאנר יצא מהמסך: כל עוד הכפתורים המקוריים נראים, סרגל שני מעליהם הוא
   רק רעש. ‏IntersectionObserver ולא מאזין scroll — הדפדפן כבר יודע לענות
   על השאלה הזו בלי לחשב מיקומים בכל פריים. */
function renderStickyBar(contact, waHref){
  const bar = document.getElementById('stickyBar');
  const name = contact.display_name || 'המשרד';
  const agencyName = (currentAgency && currentAgency.name) || 'המשרד';

  // ‏P1-D: פעולות בלבד - תמונה, שם ותואר של המנהל כבר בצוות ובבאנר
  void agencyName;
  document.getElementById('stickyInner').innerHTML = `
    <div class="sb-actions">
      <a class="sb-wa" href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer"
         aria-label="${escapeHtml('שליחת הודעת וואטסאפ ל' + name)}">${WA_SVG}<span>וואטסאפ</span></a>
      <a class="sb-tel" href="tel:+${contact.phone_e164}"
         aria-label="${escapeHtml('חיוג ל' + name)}">${ICON.phone}</a>
    </div>`;

  bar.hidden = false;
  document.body.classList.add('has-sticky-bar');

  const banner = document.getElementById('banner');
  if (!('IntersectionObserver' in window) || !banner){
    // בלי Observer עדיף סרגל שנוכח תמיד מאשר סרגל שלא נדלק לעולם
    document.body.classList.add('sticky-on');
    return;
  }
  new IntersectionObserver(([entry])=>{
    document.body.classList.toggle('sticky-on', !entry.isIntersecting);
  }, { rootMargin: '-60px 0px 0px 0px' }).observe(banner);
}

/* ---------- כתובת המשרד ----------
   "אזורי פעילות" בבאנר עונים על "איפה אתם עובדים"; הכתובת עונה על "לאן אני
   בא/ה", וזו שאלה של מי שכבר החליט/ה לפנות — ולכן מקומה במקטע יצירת הקשר
   ולא בראש הדף. היא מקושרת ל-Google Maps ולא למפה מוטמעת: מי שלוחץ/ת על
   כתובת רוצה ניווט, וזה כבר קיים בטלפון שלו/ה.

   משרד שלא הזין כתובת פשוט לא מקבל את השורה — שורת "כתובת: —" גרועה
   מהיעדרה. */
function agencyAddressHtml(){
  const address = ((currentAgency && currentAgency.address) || '').trim();
  if (!address) return '';
  return `<p class="contact-address">${escapeHtml(address)}</p>`;
}

/* ---------- חותם הדף: פנייה למנהל/ת המשרד ----------
   כאן, בשונה מהכפתורים שבראש הדף, הפנייה נושאת פנים ושם. אם למנהל/ת אין
   מספר, המקטע נופל לסוכן/ת הראשון/ה שיש לו — עדיף איש קשר אמיתי בשם אחר
   מאשר מקטע שנפתח ולא מוביל לאיש. בלי מספר בכלל המקטע לא מוצג. */
function renderManagerContact(members){
  const pub = window.ShukAgencyPublic;
  const contact = pub ? pub.pickContact(members) : null;
  const phone = contact ? contact.phone_e164 : '';
  const address = ((currentAgency && currentAgency.address) || '').trim();
  const html = pub ? pub.contactHtml(address, phone) : '';
  const card = document.getElementById('contactCard');
  const sec = document.getElementById('contactSec');
  if (!card || !sec || !html) return;
  if (card.getAttribute('data-ssr') === '1') {
    const tel = card.querySelector('a.ag-call');
    const addr = card.querySelector('.contact-address');
    const telOk = phone ? (tel && tel.getAttribute('href') === 'tel:+' + phone) : !tel;
    const addrOk = address ? (addr && addr.textContent.trim() === address) : !addr;
    if (telOk && addrOk) {
      sec.classList.add('is-on');
      sec.style.display = 'block';
      return;
    }
  }
  card.innerHTML = html;
  sec.classList.add('is-on');
  sec.style.display = 'block';
}

/* ---------- סיפורי הצלחה ועסקאות שנסגרו ----------
   המקטע הזה החליף את גלריית התמונות. הגלריה הראתה תמונות; הוא מראה הוכחות.

   שני מקורות נכנסים לאותה רצועה:
     1. ‏market_deals — כל עסקה שנסגרה במשרד. הכרטיס נושא שלט "נמכר"/"הושכר",
        את סוג הנכס, המחיר, החודש, וקישור לנכס עצמו כשהוא עדיין בפלטפורמה.
        כשלנכס יש תמונה — היא תמונת הכרטיס; אחרת מצויר שלט עם לוגו המשרד.
     2. ‏agencies.gallery — התמונות שהמשרד העלה (לחיצת יד במשרד, מסירת
        מפתחות, אירועים). הן נשארות, אבל אחרי העסקאות: עסקה משכנעת יותר
        מתמונה, ולכן היא זו שנראית ראשונה.

   התמונות עדיין נפתחות בלייטבוקס; כרטיס עסקה עם קישור מנווט לנכס. */
let galleryItems = [];
let storyItems = [];

/* ‏market_deals מחזיקה מכירות בלבד: handle_property_sold כותב אליה רק נכס
   שנמכר ו-deal_type שלו 'sale' (‏דוח ה-CMA סומך על זה), ואין בה עמודת
   deal_type. לכן כל כרטיס כאן הוא "נמכר" - נבדק 26.10.2026. הענף "הושכר"
   נשאר למקרה שעסקאות השכרה ייכנסו אליה יום אחד, עם עמודה משלהן. */
function dealStamp(deal){
  return deal && deal.deal_type === 'rent' ? 'הושכר' : 'נמכר';
}

function storySignHtml(){
  const name = (currentAgency && currentAgency.name) || '';
  const logo = (currentAgency && safeImageUrl(currentAgency.logo_url)) || '';
  const mark = logo
    ? `<img src="${escapeHtml(encodeURI(logo))}" alt="" loading="lazy" onerror="this.remove()">`
    : `<span class="sign-initial" aria-hidden="true">${escapeHtml((name.trim()[0]) || '?')}</span>`;
  return `<div class="story-sign" aria-hidden="true">
      <div class="sign-board">
        ${mark}
        ${name ? `<span class="sign-name">${escapeHtml(name)}</span>` : ''}
      </div>
    </div>`;
}

function dealCardHtml(deal){
  const photo = safeImageUrl(deal.image);
  const line = [deal.property_type || 'נכס', deal.rooms ? deal.rooms + ' חדרים' : '', deal.city || '']
    .filter(Boolean).join(' · ');
  const when = deal.sold_at
    ? new Date(deal.sold_at).toLocaleDateString('he-IL', { year:'numeric', month:'long' })
    : '';
  const price = Number(deal.sale_price);
  /* המחיר מוצג רק כשהוא באמת מחיר עסקה. ‏`price_basis='asking'` פירושו
     שהמספר במאגר הוא המחיר ש**התפרסם** ולא מה שנסגר בפועל — כך נרשמו כל
     השורות עד שהסימון "נמכר" התחיל לשאול. שלט "נמכר" הוא עובדה ונשאר;
     המספר שמתחתיו היה הופך אותו להצהרה על מחיר עסקה, וזה לא מה שיש לנו.
     סביבה שאין בה את העמודה (נפילה ל-DEAL_COLUMNS_MIN) מסתירה גם היא —
     ברירת מחדל זהירה, ולא "כנראה זה בסדר". */
  const priceIsSale = deal.price_basis === 'reported' || deal.price_basis === 'official';
  return `
    <div class="story-thumb"${photo ? ` style="background-image:url('${encodeURI(photo)}')"` : ''}>
      ${photo ? '' : storySignHtml()}
      <span class="story-stamp">${dealStamp(deal)}</span>
    </div>
    <div class="story-body">
      <div class="story-title">${escapeHtml(line)}</div>
      ${priceIsSale && Number.isFinite(price) && price > 0 ? `<div class="story-price">₪${price.toLocaleString('he-IL')}</div>` : ''}
      ${when ? `<div class="story-when">${escapeHtml(when)}</div>` : ''}
      ${deal.property_id ? '<div class="story-link">לנכס שנסגר ←</div>' : ''}
    </div>`;
}

function photoCardHtml(item, index){
  return `
    <div class="story-thumb">
      <img src="${escapeHtml(encodeURI(item.url))}" alt="${escapeHtml(item.caption || 'תמונה מהמשרד')}" loading="${index ? 'lazy' : 'eager'}">
    </div>
    <div class="story-body">
      <div class="story-caption">${escapeHtml(item.caption || 'מהנעשה במשרד')}</div>
      <div class="story-link">להגדלה ←</div>
    </div>`;
}

function renderStories(){
  const rail = document.getElementById('storiesRail');
  if (!storyItems.length) return;
  rail.textContent = '';

  storyItems.forEach(item=>{
    const card = document.createElement('div');
    card.className = 'story-card is-link';
    card.tabIndex = 0;
    card.setAttribute('role', 'link');

    let open = null;
    if (item.kind === 'deal'){
      card.innerHTML = dealCardHtml(item.deal);
      card.setAttribute('aria-label',
        `${dealStamp(item.deal)} - ${[item.deal.property_type, item.deal.city].filter(Boolean).join(' ')}`);
      if (item.deal.property_id){
        open = ()=> window.location.href = '/property?id=' + item.deal.property_id;
      } else {
        card.classList.remove('is-link');
        card.removeAttribute('role');
        card.removeAttribute('tabindex');
      }
    } else {
      card.innerHTML = photoCardHtml(item.photo, item.photoIndex);
      card.setAttribute('aria-label', item.photo.caption || 'תמונה מהמשרד');
      open = ()=> openLightbox(item.photoIndex);
    }

    if (open){
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e)=>{
        if ((e.key === 'Enter' || e.key === ' ') && e.target === card){ e.preventDefault(); open(); }
      });
    }
    rail.appendChild(card);
  });

  const deals = storyItems.filter(i => i.kind === 'deal').length;
  const photos = storyItems.length - deals;
  setSectionNote('storiesCount', [
    deals ? (deals === 1 ? 'עסקה אחת' : deals + ' עסקאות') : '',
    photos ? (photos === 1 ? 'תמונה אחת' : photos + ' תמונות') : '',
  ].filter(Boolean).join(' · '));

  document.getElementById('storiesSec').style.display = 'block';
  initCarousel(rail, document.getElementById('storiesPrev'),
               document.getElementById('storiesNext'), document.getElementById('storiesDots'));
}

/* ---------- טעינת העסקאות ----------
   ‏market_deals נבנתה בשלבים ולא בכל סביבה יש בה את אותן עמודות. ‏PostgREST
   מפיל את השאילתה כולה על עמודה חסרה, ולכן היא נורית קודם בגרסה המלאה
   וחוזרת לגרסה המינימלית אם נכשלה — עדיף כרטיס עסקה בלי תמונה וקישור
   מאשר מקטע שלא נטען. */
/* ‏**העמודות של הפרודקשן, לא של התוכנית.** עד אוקטובר 2026 הגרסה המלאה
   ביקשה deal_type ו-property_id - שתי עמודות שלא קיימות ב-market_deals
   (הקישור לנכס הוא related_property_id) - ולכן כל טעינה של דף משרד נכשלה
   ב-400 לפני שהגרסה המינימלית רצה, והכרטיסים יצאו בלי תמונה וקישור.
   ‏deal_type עדיין אינו בטבלה, ו-dealStamp קורא אותו בזהירות. */
const DEAL_COLUMNS_FULL = 'sale_price, sold_at, rooms, property_type, city, related_property_id, price_basis';
const DEAL_COLUMNS_MIN  = 'sale_price, sold_at, rooms, property_type, city';
const STORY_DEALS_MAX = 12;

async function fetchAgencyDeals(sb, agencyId){
  const query = cols => sb.from('market_deals').select(cols)
    .eq('agency_id', agencyId).order('sold_at', { ascending:false }).limit(STORY_DEALS_MAX);
  let { data, error } = await query(DEAL_COLUMNS_FULL);
  if (error){
    ({ data } = await query(DEAL_COLUMNS_MIN));
  }
  // ‏property_id הוא השם שהרצועה (‏attachDealPhotos, הקישור בכרטיס) קוראת
  return (data || []).map(d => Object.assign({ property_id: d.related_property_id || null }, d));
}

/* התמונה של הנכס שנסגר. הנכס עצמו כבר לא פעיל, ולכן הוא נשלף בנפרד ולא
   מתוך הנכסים שנטענו למקטע הנכסים. כישלון כאן אינו מפיל דבר — הכרטיס
   פשוט נופל לשלט המצויר. */
async function attachDealPhotos(sb, deals){
  const ids = [...new Set(deals.map(d => d.property_id).filter(Boolean))];
  if (!ids.length) return;
  try{
    const { data } = await sb.from('properties').select('id, images').in('id', ids);
    const byId = new Map((data || []).map(p => [p.id, p]));
    deals.forEach(d=>{
      const prop = d.property_id && byId.get(d.property_id);
      const img = prop && safeImageUrl(prop.images && prop.images[0]);
      if (img) d.image = img;
      // נכס שכבר אינו נגיש לציבור — הקישור אליו היה מוביל ל"הנכס לא נמצא"
      if (d.property_id && !prop) d.property_id = null;
    });
  } catch(e){
    console.warn('טעינת תמונות העסקאות נכשלה:', e);
  }
}

async function loadSuccessStories(sb, agencyId, gallery){
  galleryItems = (Array.isArray(gallery) ? gallery : [])
    .map(item => ({ url: safeImageUrl(item && item.url), caption: (item && item.caption) || '' }))
    .filter(item => item.url);

  let deals = [];
  let total = 0;
  try{
    // הספירה נפרדת מהשליפה: הרצועה מציגה את האחרונות בלבד, אבל הסרגל
    // צריך לדעת כמה עסקאות יש באמת. ‏head:true לא מחזיר שורות, ולכן אין כאן
    // תלות בעמודה כלשהי.
    const [dealsResult, countResult] = await Promise.all([
      fetchAgencyDeals(sb, agencyId),
      sb.from('market_deals').select('*', { count:'exact', head:true }).eq('agency_id', agencyId),
    ]);
    deals = dealsResult;
    total = countResult.count || deals.length;
    if (deals.length) await attachDealPhotos(sb, deals);
  } catch(e){
    console.warn('טעינת עסקאות המשרד נכשלה:', e);
  }

  // מספר העסקאות נכנס לסרגל המדדים ולתגיות האמון גם כשאין מה להציג ברצועה
  agencyStats.deals = total;
  renderTrustBar();

  storyItems = [
    ...deals.map(deal => ({ kind:'deal', deal })),
    ...galleryItems.map((photo, photoIndex) => ({ kind:'photo', photo, photoIndex })),
  ];
  renderStories();
}

let lightboxIndex = 0;
const lightboxEl = document.getElementById('lightbox');

function openLightbox(i){
  lightboxIndex = Math.min(Math.max(i, 0), galleryItems.length - 1);
  showLightboxImage();
  lightboxEl.classList.add('open');
  document.body.style.overflow = 'hidden'; // שלא ייגלל הדף מתחת לתמונה
}
function showLightboxImage(){
  const item = galleryItems[lightboxIndex];
  if (!item) return;
  document.getElementById('lbImage').src = item.url;
  document.getElementById('lbImage').alt = item.caption || '';
  document.getElementById('lbCaption').textContent = item.caption || '';
}
function stepLightbox(delta){
  if (galleryItems.length === 0) return;
  lightboxIndex = (lightboxIndex + delta + galleryItems.length) % galleryItems.length;
  showLightboxImage();
}
function closeLightbox(){
  lightboxEl.classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('lbClose').addEventListener('click', closeLightbox);
document.getElementById('lbPrev').addEventListener('click', ()=> stepLightbox(-1));
document.getElementById('lbNext').addEventListener('click', ()=> stepLightbox(1));
lightboxEl.addEventListener('click', (e)=>{ if (e.target === lightboxEl) closeLightbox(); });
document.addEventListener('keydown', (e)=>{
  if (!lightboxEl.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  // ה-RTL הופך את משמעות החצים: "קדימה" בגלריה עברית הוא שמאלה
  if (e.key === 'ArrowLeft') stepLightbox(1);
  if (e.key === 'ArrowRight') stepLightbox(-1);
});

/* ---------- תו האיכות של המשרד ----------
   מנהל/ת המשרד מאשר/ת את הקוד האתי בשם המשרד ב-CRM. שני התאריכים נשמרים
   בשורת ה-agency, והתו מוצג רק כשיש אישור ואין הסרה — אותו תנאי בדיוק
   שה-view של הסוכנים מחשב בעצמו ב-has_ethics_badge. */
function agencyHasEthicsBadge(agency){
  return !!(agency && agency.ethics_code_accepted_at && !agency.ethics_badge_revoked_at);
}

/* התו עצמו נשתל בסרגל המדדים (‏mountBadgeCell), ולכן כאן נותרה רק ההכרזה
   שיש תו — הסרגל נבנה מחדש ומייצר את התא. */
function renderQualityBadge(agency){
  if (!agencyHasEthicsBadge(agency)) return;
  agencyStats.ethics = true;
  renderTrustBar();
}

/* ---------- הרקע הזורם של הדף ----------
   ברירת המחדל של דף המשרד היא הרקע של האתר — אותה שמש, אותו קו רקיע ואותם
   גלים שיש בדף הבית וב-CRM — כדי שמעבר מדף הבית לדף משרד לא ירגיש כמו
   מעבר לאתר אחר. מנהל/ת המשרד יכול/ה להחליף אותו לרקע חלק דרך ה-CRM
   (מיתוג ועיצוב דף המשרד → רקע הדף), ולהחזיר את ברירת המחדל באותו מקום.

   ההעדפה יושבת ב-agencies.colors.page_bg — 'plain' כדי לכבות, וכל ערך אחר
   (כולל היעדר ערך, שזה מצבם של כל המשרדים הקיימים) הוא ברירת המחדל.

   הרקע מורכב מיד עם טעינת הדף ולא רק אחרי שהמיתוג חוזר מהשרת: ברירת המחדל
   היא "מוצג", ולכן עדיף להראות אותו מיד ולכבות אצל המיעוט שבחר אחרת מאשר
   להשאיר את כל השאר עם הבזק של רקע ריק. */
const PAGE_BG_OFF = 'plain';

function applyPageBackground(colors){
  if (!window.PageBg) return;
  if (((colors || {}).page_bg || '') === PAGE_BG_OFF) PageBg.unmount();
  else PageBg.mount();
}

if (window.PageBg) PageBg.mount();

// האם הדף כבר הוצג בפועל — ראו ה-catch של loadAgency
let agencyShown = false;

/* ‏"על המשרד" - אותן פסקאות שהשרת כתב (‏assets/agency-about.js) */
function renderAbout(agency){
  const box = document.getElementById('aboutText');
  const paras = window.ShukAgencyAbout ? window.ShukAgencyAbout.paragraphs(agency) : [];
  box.textContent = '';
  paras.forEach(t => {
    const p = document.createElement('p');
    p.textContent = t;
    box.appendChild(p);
  });
  document.getElementById('aboutSec').hidden = !paras.length;
}

/* ‏אותה כותרת ש-og-tags.ts כותב. markets.js הוא defer. אם ה-fetch של המשרד
   חוזר לפני שהוא רץ, כתיבה עכשיו מורידה את העיר. לא דורסים את כותרת השרת
   עד שהרשימה קיימת, ואז הכותרת זהה לזו שב-HTML. */
function applyAgencyTitle(agency){
  const write = () => {
    const place = window.ShukAgencyPlace;
    if (!place || !window.ShukMarkets) return false;
    const next = place.title(agency.name, place.officeCity(agency));
    document.title = next;
    const og = document.querySelector('meta[property="og:title"]');
    const tw = document.querySelector('meta[name="twitter:title"]');
    if (og) og.setAttribute('content', next);
    if (tw) tw.setAttribute('content', next);
    return true;
  };
  if (write()) return;
  document.addEventListener('DOMContentLoaded', write, { once: true });
  window.addEventListener('load', write, { once: true });
  setTimeout(write, 0);
}

/* תיאור ה-meta נכתב רק אחרי שהנכסים נטענו, כדי לא לדרוס ספירה שהשרת כבר שם. */
function showAgencyMissing(){
  const missing = document.getElementById('notFoundState');
  if (!missing) return;
  const label = missing.querySelector('.nf-title');
  if (label && !label.textContent.trim()) label.textContent = 'המשרד לא נמצא';
  missing.style.display = 'block';
}

let propertiesLoaded = false;
function syncAgencyDescription(){
  const place = window.ShukAgencyPlace;
  if (!place || !place.description || !window.ShukMarkets || !currentAgency || !propertiesLoaded) return;
  const tagline = (currentAgency.tagline || '').trim();
  const about = window.ShukAgencyAbout ? (window.ShukAgencyAbout.paragraphs(currentAgency)[0] || '') : '';
  const sale = agencyProperties.filter(p => p.deal_type !== 'rent').length;
  const rent = agencyProperties.filter(p => p.deal_type === 'rent').length;
  const text = place.description({
    name: currentAgency.name,
    city: place.officeCity(currentAgency),
    address: currentAgency.address || '',
    total: agencyProperties.length,
    sale: sale,
    rent: rent,
    tagline: tagline,
    aboutFirst: tagline ? '' : about,
    hasPhone: !!document.querySelector('#brandCta a[href^="tel:"], #contactCard a[href^="tel:"]'),
    hasAgents: !!(document.getElementById('teamRail') && document.getElementById('teamRail').querySelector('a.team-card')),
  });
  ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el && text) el.setAttribute('content', text);
  });
}

async function loadAgency(){
  const slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug || !window.supabase){
    document.getElementById('loadingState').style.display = 'none';
    showAgencyMissing();
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  try{
    const { data: agency, error } = await sb.from('agencies').select('*').eq('slug', slug).single();
    if (error || !agency) throw error || new Error('not found');

    currentAgency = agency;
    applyAgencyTitle(agency);
    document.getElementById('brandName').textContent = agency.name;
    const tagline = (agency.tagline || '').trim();
    const taglineEl = document.getElementById('brandTagline');
    if (taglineEl.textContent.trim() !== tagline) taglineEl.textContent = tagline;
    taglineEl.hidden = !tagline;
    // אזורי הפעילות ירדו משורת תגיות נפרדת לשורת ההקשר שמעל השם: הם עונים
    // על "איפה", וזו שאלה שנקראת יחד עם השם ולא כמקטע בפני עצמו.
    // ‏"משרד תיווך" ירד מכאן: הדף כולו אומר את זה, והשורה נשארת עם מה שרק
    // היא יכולה לומר — איפה המשרד פועל. בלי אזורים אין שורה בכלל.
    const areas = (agency.specialty_areas || []).filter(a => String(a || '').trim());
    const eyebrowEl = document.getElementById('brandEyebrow');
    const eyebrowText = areas.slice(0, 3).join(' · ');
    if (eyebrowEl && eyebrowEl.textContent.replace(/\s+/g, ' ').trim() !== eyebrowText) {
      eyebrowEl.innerHTML = areas.length ? ICON.pin + escapeHtml(eyebrowText) : '';
    }
    if (eyebrowEl) eyebrowEl.hidden = !areas.length;
    // התמחויות מוצהרות נכנסות מיד; משרד בלי הצהרה מקבל תגיות נגזרות אחרי
    // שהנכסים נטענים (loadActiveProperties קורא שוב עם הנכסים בידו)
    renderSpecialties(agency, null);
    renderAbout(agency);
    applyBranding(agency);
    renderQualityBadge(agency);

    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('agencyContent').style.display = 'block';
    agencyShown = true;

    // ההקשר שכל ליד מהדף הזה נושא: המשרד עצמו, והעיר שבה הוא פועל
    leadContext.slug = agency.slug || null;
    leadContext.city = areas[0] || 'עפולה';
    initOwnerWizard(agency);
    initBuyerWizard(agency, sb);

    loadTeam(sb, agency.id);
    // כישלון בטעינת הנכסים לא לוקח איתו את הווידג'טים — הם אינם תלויים בהם
    loadActiveProperties(sb, agency.id).catch(err=>{
      console.warn('טעינת הנכסים נכשלה:', err);
      showLeftoverWidgets();
    });
    loadSuccessStories(sb, agency.id, agency.gallery);
    loadReviews(sb, agency.id);
  } catch(e){
    console.warn('טעינת משרד נכשלה:', e);
    document.getElementById('loadingState').style.display = 'none';
    // ‏"המשרד לא נמצא" נאמר רק כשבאמת אין מה להציג. שגיאה שנזרקת אחרי
    // שהדף כבר עומד — באתחול אחד הווידג'טים, למשל — לא מוחקת משרד קיים
    // מהמסך: היא נרשמת ב-console, והדף נשאר על מכונו.
    if (!agencyShown) showAgencyMissing();
  }
}

let agencyProperties = [];

async function loadActiveProperties(sb, agencyId){
  const { data: props } = await sb.from('properties')
    // ‏created_at, floor, features, is_promoted ו-promoted_until נוספו בשביל
    // המדף: הוא ממיין לפי סדר ההעלאה, מציג קומה וחניה בשורת המאפיינים,
    // ומצמיד עד שני נכסים מקודמים לראש — בדיוק כמו בדף הבית.
    .select('id, title, price, price_unit, price_total, deal_type, category, price_includes_vat, mamad_location, rooms, property_type, size_sqm, floor, features, city, street, images, tour_3d_url, has_virtual_tour, video_url, created_at, is_promoted, promoted_until')
    .eq('agency_id', agencyId).eq('status', 'active').order('created_at', { ascending:false });
  // משרד בלי נכסים פעילים לא מקבל מקטע עם הכיתוב "אין כרגע נכסים" — מקטע
  // כזה אומר לגולש/ת רק שאין כאן מה לחפש. המקטע פשוט לא נפתח. הווידג'טים
  // כן נפתחים: הערכת שווי והתאמת נכס אינן תלויות במלאי של המשרד.
  if (!props || props.length === 0){ showLeftoverWidgets(); return; }

  agencyProperties = props;
  propertiesLoaded = true;
  agencyStats.activeProperties = props.length;
  // התגיות הנגזרות מחכות לרגע הזה — עכשיו יש נכסים שאפשר לקרוא מהם
  renderSpecialties(currentAgency, props);
  setSectionNote('propsCount', props.length === 1 ? 'נכס פעיל אחד' : props.length + ' נכסים פעילים');
  renderPropertyCards(props);
  syncAgencyDescription();
  // תגית "הדמיית AI" מגיעה בשאילתה שנייה ומצירה את האריחים מחדש. היא לא
  // מעכבת את ההצגה הראשונה: אריח בלי התגית עדיין אריח שלם.
  PropertyCard.visualizedIds(sb, props.map(p => p.id)).then(ids=>{
    if (!ids.size) return;
    // המדפים מחזיקים עותק משלהם של הקבוצה (הם מציירים את האריח), והם
    // מציירים מחדש רק את מה שכבר על המסך — כלומר סינון שהגולש/ת הקליד/ה
    // בזמן שהשאילתה רצה נשאר על מכונו.
    privateShelf?.setVisualized(ids);
    commercialShelf?.setVisualized(ids);
  });
  const propsSec = document.getElementById('propsSec');
  if (propsSec) {
    propsSec.classList.add('is-on');
    propsSec.style.display = 'block';
    const heading = document.getElementById('propsHeading');
    if (heading && !heading.textContent.trim()) heading.textContent = 'הנכסים של המשרד';
  }
  // סרגל החיפוש מופיע רק כשיש בו טעם: בארבעה נכסים העין מהירה ממנו
  if (props.length >= 5) initPropertySearch();
}

/* ---------- שני מדפי הנכסים ----------
   כאן ישבו שלוש רצועות נגללות — "נכסים פרטיים להשכרה", "נכסים פרטיים
   למכירה" ו"נכסים מסחריים". סוג העסקה היה בהן מבנה של הדף ולא מאפיין של
   הנכס: מי שבא לראות מה יש למשרד גלל שלושה מסלולים אופקיים, כל אחד עם
   קצה חתוך ועם "לכל הנכסים" שפותח רצועה אחת בלבד לרשת.

   היום זו התצוגה של דף הבית, על אותו מנוע בדיוק (‏assets/prop-shelf.js):
   מדף "נכסים פרטיים" שמחזיק מכירה והשכרה יחד ומדף "נכסים מסחריים", כל
   אחד עם שורת התגיות שנבנית מהמלאי של המשרד עצמו (מכירה · השכרה · דירות
   לפי מספר חדרים · שאר סוגי הנכס), בורר מיון וכפתור "עוד נכסים". מדף
   בלי נכסים מסתיר את עצמו. ראו docs/home-property-shelves.md.

   המדפים נבנים **פעם אחת**, והחיפוש המקומי רק מזין אותם מחדש
   (‏shelf.set). קודם ה-‎innerHTML=''‎ של הרצועות הרס בכל הקלדה את
   הווידג'טים שישבו ביניהן, ולכן היה צריך להחזיר אותם קודם ל"בית" שלהם;
   עכשיו הם נשתלים פעם אחת ואף אחד לא נוגע בהם. */
let privateShelf = null, commercialShelf = null;

const SHELF_COUNT = (shown, total) => (shown === total)
  ? (total === 1 ? 'נכס אחד' : `${total.toLocaleString('he-IL')} נכסים`)
  : `${shown.toLocaleString('he-IL')} מתוך ${total.toLocaleString('he-IL')} נכסים`;

function buildShelves(){
  const el = document.getElementById('activeProps');
  const priv = document.createElement('section');
  priv.className = 'prop-shelf';
  const comm = document.createElement('section');
  comm.className = 'prop-shelf';
  el.append(priv, comm);

  const common = {
    // ממלא־המקום נושא את לוגו המשרד שבכותרת הדף ולא את זה של הנכס: בדף
    // הזה כל הנכסים שייכים לאותו משרד ממילא.
    fallback: thumbFallback,
    whereOpts: { agency:false },
    countText: SHELF_COUNT,
    headingTag: 'h3',
  };

  privateShelf = PropShelf.create({
    ...common, mount: priv, titleId:'shelfPrivateTitle', title:'נכסים פרטיים', sortId:'shelfPrivateSort',
    // רק במדף הפרטי: "דירה" מתפצלת לתגיות לפי מספר חדרים. ‏roomsLabel
    // נכתב במפורש ולא נגזר מ-roomsType — "דירה" + "ות" הוא "דירהות".
    roomsType:'דירה', roomsLabel:'דירות',
  });
  commercialShelf = PropShelf.create({
    ...common, mount: comm, titleId:'shelfCommercialTitle', title:'נכסים מסחריים', sortId:'shelfCommercialSort',
    // אין כאן פיצול לפי חדרים: "משרד 3 חדרים" הוא לא הנתון שמחפשים בו נכס
    // מסחרי — שם השאלה היא מ״ר וסוג הנכס.
    roomsType:'', roomsLabel:'',
  });

  mountWidgets(priv, comm);
}

/* ---------- שתילת הווידג'טים בין המדפים ----------
   כל ווידג'ט נושא ‎data-slot‎ עם המקום שבו הוא יושב: הערכת השווי אחרי
   הנכסים הפרטיים (היא מדברת אל מי שמחזיק/ה דירה), ובאנר מחפשי הנכס —
   ‏end — אחרי כל המלאי, כשמי שגלל/ה עד הסוף לא מצא/ה את מה שחיפש/ה.

   ‏‎place('commercial', comm)‎ נשאר גם אחרי שמחשבון התשואה ירד מהדף אף
   שאין לו יותר ווידג'ט: הוא זה שמזיז את הקורסור למדף המסחרי, ובלעדיו
   באנר מחפשי הנכס היה נשתל אחרי הנכסים הפרטיים ולא אחרי כולם.

   הקורסור נע קדימה עם כל שתילה, כי ‎after()‎ על אותו עוגן פעמיים היה מציב
   את השני *לפני* הראשון והופך את הסדר.

   השתילה נעשית פעם אחת, מיד אחרי בניית המדפים, ולא בכל ציור מחדש: הזזת
   צומת שומרת מאזינים, אבל ציור מחדש שמוחק את ההורה לא. */
function mountWidgets(priv, comm){
  let cursor = priv;
  const place = (slot, anchor)=>{
    if (anchor) cursor = anchor;
    // חיפוש בכל הדף ולא רק ב-‎#widgetHome‎: אחרי השתילה הראשונה הווידג'טים
    // כבר אינם שם אלא בתוך ‎#activeProps‎.
    document.querySelectorAll(`.lead-banner[data-slot="${slot}"]`)
      .forEach(w=>{ cursor.after(w); cursor = w; });
  };
  place('private', priv);
  place('commercial', comm);
  place('end');
  showLeftoverWidgets();
}

/* מה שנשאר בבית מוצג שם — באנר מחפשי הנכס תמיד, ובמשרד בלי נכסים כלל גם
   הערכת השווי, ברצף. */
function showLeftoverWidgets(){
  const home = document.getElementById('widgetHome');
  if (home) home.hidden = !home.querySelector('.lead-banner');
}

/* מזין את שני המדפים מאותה רשימה. ‏category הוא מה שמפריד בין נדל״ן פרטי
   למסחרי בכל המרקטפלייס — עמודה ‎NOT NULL‎ עם ברירת מחדל 'residential' —
   ולכן ההפרדה יושבת ב-PropShelf וכל הדפים קוראים לה. */
function renderPropertyCards(list){
  const el = document.getElementById('activeProps');
  const pub = window.ShukAgencyPublic;
  if (!el || !pub) return;
  const have = pub.listingIds(el.innerHTML);
  const want = list.map(p => String(p.id));
  const samePrefix = have.length > 0 && have.every((id, i) => want[i] === id);
  if (el.getAttribute('data-ssr') === '1' && samePrefix) {
    if (want.length > have.length) el.insertAdjacentHTML('beforeend', pub.listingsHtml(list.slice(have.length), want.length));
  } else if (have.join('\n') !== want.join('\n')) {
    el.innerHTML = pub.listingsHtml(list, list.length || 1);
  }
  el.setAttribute('data-ssr', '1');
  const empty = document.getElementById('propsEmpty');
  if (empty) {
    empty.hidden = list.length > 0;
    if (!empty.hidden && !empty.textContent.trim()) empty.textContent = 'לא נמצאו נכסים שתואמים לחיפוש.';
  }
  showLeftoverWidgets();
}

/* ---------- חיפוש בנכסי המשרד ----------
   סינון מקומי על מה שכבר בזיכרון. השדות שנסרקים הם מה שגולש/ת באמת מקליד/ה:
   רחוב, עיר, סוג נכס וכותרת. מספרים (מחיר, שטח) לא נסרקים — "230" היה מחזיר
   גם נכס ב-230 מ״ר וגם נכס ב-230,000 ₪ ומבלבל יותר משהוא עוזר. */
function initPropertySearch(){
  const bar = document.getElementById('propSearchBar');
  const input = document.getElementById('propSearch');
  const clear = document.getElementById('propSearchClear');
  const count = document.getElementById('propSearchCount');
  bar.querySelector('.ic').innerHTML = ICON.search;
  bar.hidden = false;

  const apply = ()=>{
    const q = input.value.trim().toLowerCase();
    clear.hidden = !q;
    const terms = q ? q.split(/\s+/) : [];
    const rows = document.querySelectorAll('#activeProps a.prop-row');
    let shown = 0;
    rows.forEach(row => {
      const hay = ((row.getAttribute('data-q') || '') + ' ' + row.textContent).toLowerCase();
      const ok = !terms.length || terms.every(t => hay.includes(t));
      row.hidden = !ok;
      if (ok) shown++;
    });
    const empty = document.getElementById('propsEmpty');
    if (empty) {
      empty.hidden = shown > 0;
      if (!empty.hidden && !empty.textContent.trim()) empty.textContent = 'לא נמצאו נכסים שתואמים לחיפוש.';
    }
    if (!q) { count.hidden = true; return; }
    count.textContent = shown === 1
      ? 'נכס אחד תואם'
      : `${shown} נכסים תואמים מתוך ${agencyProperties.length}`;
    count.hidden = false;
  };

  input.addEventListener('input', apply);
  clear.addEventListener('click', ()=>{ input.value = ''; apply(); input.focus(); });
}

/* ---------- כפתורי יצירת הקשר בכרטיס הצוות ----------
   כל כרטיס ברצועה נושא את אותם שני כפתורים שיש למנהל/ת המשרד — וואטסאפ
   וחיוג — ולא רק מי שהזין/ה מספר ישיר: כרטיס בלי דרך ליצור קשר הוא מבוי
   סתום, וגולש/ת שמתעניין/ת בסוכן/ת מסוים/ת לא אמור/ה לחפש למי לפנות.

   כשאין לסוכן/ת מספר ישיר הפנייה מנותבת למספר המשרד. ההודעה בוואטסאפ
   כבר נושאת את שם הסוכן/ת, ושורת ההערה מתחת לכפתורים אומרת במפורש לאן
   הפנייה מגיעה — כפתור שמחייג למספר אחר ממה שהובטח גרוע מכפתור שאיננו. */
function teamContactHtml(member, officeContact){
  const direct = hasPhone(member);
  const target = direct ? member : officeContact;
  // אין במשרד ולו מספר אחד אמיתי — אין למי לנתב, ולכן אין כפתורים
  if (!target) return '';

  const name = member.display_name || 'יועץ הנדל״ן';
  const agencyName = (currentAgency && currentAgency.name) || 'המשרד';
  const href = waLink(target.phone_e164,
    `הגעתי לדף של ${agencyName} בשוק הנדל״ן של עפולה והסביבה ואשמח לדבר עם ${name}.`);
  const waLabel = direct ? 'שליחת הודעת וואטסאפ ל' + name
                         : 'שליחת הודעת וואטסאפ למשרד בנוגע ל' + name;
  const telLabel = direct ? 'חיוג ל' + name
                          : 'חיוג למשרד בנוגע ל' + name;

  return `<div class="team-contact">
      <div class="team-actions">
        <a class="ta-wa" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"
           aria-label="${escapeHtml(waLabel)}" title="${escapeHtml(waLabel)}">${WA_SVG} וואטסאפ</a>
        <a class="ta-tel" href="tel:+${target.phone_e164}"
           aria-label="${escapeHtml(telLabel)}" title="${escapeHtml(telLabel)}">${ICON.phone} חיוג</a>
      </div>
      ${direct ? '' : '<p class="team-via">הפנייה מגיעה למשרד</p>'}
    </div>`;
}

/* ---------- נבחרת המתווכים ----------
   הקרוסלה הפותחת של הדף. מנהל/ת המשרד תמיד הכרטיס הראשון והבולט: כרטיס
   רחב יותר, טבעת בצבע המשני ותגית תפקיד מעליו. */
async function loadTeam(sb, agencyId){
  const rail = document.getElementById('teamRail');
  const { data: agents, error: teamErr } = await sb.from('agency_members_public')
    .select('id, slug, display_name, role, photo_url, photo_position, license_number, has_ethics_badge, phone_e164')
    .eq('agency_id', agencyId);

  // כפתורי יצירת הקשר — בראש הדף ובחותם שלו — ניזונים מאותה שליפה
  renderAgencyContact(agents);
  renderManagerContact(agents);
  // ---------- משרד בלי אף סוכן/ת פעיל/ה ----------
  // ‏agency_members_public מציג/ה רק שורות active, ולכן רשימה ריקה כאן
  // פירושה שאין במשרד אף אחד — כולם סגרו חשבון, הושעו או לא חיברו כרטיס.
  // דף כזה הוא שלט של משרד שאין מאחוריו איש: אין למי להתקשר, ומודעות אין
  // (מודעותיו של מי שסגר/ה חשבון אורכבו). הוא יורד לגמרי ולא מוצג ריק —
  // זו המשמעות של "למחוק את הדף" עבור מי שהיה/הייתה לבד במשרד שלו/ה.
  //
  // ‏teamErr נבדק בנפרד ובכוונה: שאילתה שנכשלה מחזירה data ריק בדיוק כמו
  // משרד ריק, והורדת דף חי בגלל תקלת רשת חמורה בהרבה ממקטע "נבחרת" חסר.
  if (teamErr){ if (rail) rail.textContent = ''; return; }
  if (!agents || agents.length === 0){
    document.getElementById('agencyContent').style.display = 'none';
    document.getElementById('loadingState').style.display = 'none';
    showAgencyMissing();
    return;
  }

  const pub = window.ShukAgencyPublic;
  const team = pub ? pub.sortTeam(agents) : agents.slice().sort((a, b) => (b.role === 'manager') - (a.role === 'manager'));

  agencyStats.teamSize = team.length;
  renderTrustBar();
  setSectionNote('teamCount', team.length === 1 ? 'יועץ נדל״ן אחד במשרד' : team.length + ' יועצי נדל״ן במשרד');

  if (rail && pub) {
    const html = pub.teamHtml(team);
    const have = pub.teamHrefs(rail.innerHTML).join('\n');
    const want = pub.teamHrefs(html).join('\n');
    if (have !== want) rail.innerHTML = html;
    rail.setAttribute('data-ssr', '1');
  }

  const teamSec = document.getElementById('teamSec');
  if (teamSec) {
    teamSec.classList.add('is-on');
    teamSec.style.display = 'block';
  }
  if (rail) {
    initCarousel(rail, document.getElementById('teamPrev'),
                 document.getElementById('teamNext'), document.getElementById('teamDots'));
  }
  syncAgencyDescription();
}

/* ---------- קרוסלה ----------
   חיצים, נקודות וגלילה בקפיצות של כרטיס - לרצועת יועצי הנדל״ן ולשלוש רצועות
   הנכסים כאחד. ב-RTL ציר הגלילה הפיזי הפוך - ‏scrollLeft יורד לשלילי ככל
   שמתקדמים - ולכן כיוון הצעד נגזר מכיוון הכתיבה בפועל ולא מקובע. */
window.addEventListener('resize', ()=>{
  document.querySelectorAll('.rail').forEach(rail => rail._railSync && rail._railSync());
});

function initCarousel(rail, prev, next, dots){
  const cards = Array.from(rail.children);
  if (!cards.length) return;

  prev.innerHTML = ICON.chevronR;
  next.innerHTML = ICON.chevron;

  const rtl = getComputedStyle(rail).direction === 'rtl';
  // ‏scrollBy/scrollTo מקבלים היסט פיזי; ב-RTL ההתקדמות היא לכיוון השלילי
  const toAxis = value => rtl ? -value : value;

  const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
  const step = dir =>{
    const width = cards[0].getBoundingClientRect().width + gap;
    rail.scrollBy({ left: toAxis(dir * width), behavior:'smooth' });
  };
  prev.addEventListener('click', ()=> step(-1));
  next.addEventListener('click', ()=> step(1));

  /* הנקודות מסמנות עמודי גלילה ולא כרטיסים: במסך רחב נראים ארבעה כרטיסים
     בבת אחת, ונקודה לכל כרטיס הייתה מציגה ארבע "מיקומים" שאי אפשר להגיע
     אליהם. מספר העמודים תלוי ברוחב, ולכן הן נבנות מחדש כשהוא משתנה. */
  let pageCount = 0;
  function buildDots(count){
    pageCount = count;
    dots.textContent = '';
    for (let i = 0; i < count; i++){
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `מעבר לעמוד ${i + 1} מתוך ${count}`);
      // מיקום יחסי לאורך הגלילה כולה - כך שהנקודה האחרונה באמת מגיעה לסוף
      // הרצועה גם כשהעודף לגלילה קטן מרוחב עמוד שלם
      dot.addEventListener('click', ()=>{
        const scrollable = rail.scrollWidth - rail.clientWidth;
        rail.scrollTo({ left: toAxis(scrollable * i / (count - 1)), behavior:'smooth' });
      });
      dots.appendChild(dot);
    }
  }

  function sync(){
    if (rail.dataset.expanded === '1') return;   // רשת פתוחה - אין קרוסלה לסנכרן
    rail.classList.remove('no-scroll');
    const scrollable = rail.scrollWidth - rail.clientWidth;
    const overflowing = scrollable > 8;
    prev.hidden = next.hidden = !overflowing;
    dots.hidden = !overflowing;
    if (!overflowing){ rail.classList.add('no-scroll'); return; }

    const pos = Math.abs(rail.scrollLeft);
    prev.disabled = pos <= 2;
    next.disabled = pos >= scrollable - 2;

    const count = Math.max(2, Math.ceil(rail.scrollWidth / rail.clientWidth));
    if (count !== pageCount) buildDots(count);
    const active = Math.round(pos / scrollable * (count - 1));
    Array.from(dots.children).forEach((d, i)=> d.classList.toggle('on', i === active));
  }

  rail.addEventListener('scroll', ()=>{
    if (rail._syncing) return;
    rail._syncing = requestAnimationFrame(()=>{ rail._syncing = null; sync(); });
  });
  // הרצועות של הנכסים נבנות מחדש בכל הקלדה בחיפוש. מאזין resize על window לכל
  // רצועה היה משאיר מאחוריו מאזין מת בכל בנייה - לכן ה-sync נתלה על הרצועה
  // עצמה, ומאזין יחיד וגלובלי מריץ את מה שבאמת נמצא בדף.
  rail._railSync = sync;
  sync();
}

/* מרכיבה את שורת ההסבר שמתחת לציון. הציון של המשרד אינו ממוצע הביקורות שלו,
   ולכן חייב להיות ברור ממה הוא כן מורכב - אחרת לקוח/ה שסופר/ת את הכוכבים
   בביקורות שמתחת יגיע/תגיע למספר אחר ויחשוב/תחשוב שהמערכת משקרת. */
function ratingBreakdown(stats, reviewsCount){
  const parts = [];
  const agents = Number(stats?.rated_agent_count) || 0;
  if (agents > 0){
    parts.push(agents === 1 ? 'יועץ נדל״ן אחד מדורג' : `${agents} יועצי נדל״ן מדורגים`);
  }
  const direct = Number(stats?.direct_review_count) || 0;
  if (direct > 0){
    parts.push(direct === 1 ? 'דירוג ישיר אחד למשרד' : `${direct} דירוגים ישירים למשרד`);
  }
  if (!parts.length){
    return reviewsCount === 1 ? 'ביקורת אחת' : `${reviewsCount} ביקורות`;
  }
  return parts.join(' · ');
}

async function loadReviews(sb, agencyId){
  const el = document.getElementById('reviewsList');
  // הציון מגיע מ-agency_ratings_public ולא מחושב כאן: הוא מערבב דירוג צוות
  // (ממוצע של ממוצעי יועצי הנדל״ן, ולא ממוצע מאוחד של הביקורות) עם הדירוג הישיר
  // של המשרד, ואת הנוסחה הזו אין טעם לשכפל בדפדפן. הביקורות עצמן עדיין
  // נטענות בנפרד - ה-view לא מחזיר טקסטים.
  const [{ data: reviews }, { data: stats }] = await Promise.all([
    sb.from('reviews').select('rating, agency_rating, text, reviewer_display_name')
      .eq('agency_id', agencyId).eq('status', 'published'),
    sb.from('agency_ratings_public').select('score, review_count, rated_agent_count, direct_review_count')
      .eq('agency_id', agencyId).maybeSingle(),
  ]);
  /* ---------- הסף שמתחתיו אין מקטע בכלל ----------
     "אין עדיין ביקורות למשרד זה" הוא המשפט היקר ביותר בדף: הוא לא ניטרלי,
     הוא נקרא כאזהרה. גם ביקורת בודדת אינה עדות - היא יכולה להיות של חבר.
     לכן המקטע כולו (וגם הדירוג בבאנר ובסרגל) נפתח רק משתי חוות דעת ומעלה,
     ועד אז הדף פשוט לא מדבר על ביקורות. */
  if (!reviews || reviews.length < MIN_REVIEWS_SHOWN) return;

  const reviewsLabel = reviews.length === 1 ? 'ביקורת אחת' : `${reviews.length} ביקורות`;
  // נפילה לאחור לממוצע הגולמי אם ה-view לא נטען (מיגרציה שטרם רצה, שגיאת
  // רשת): עדיף דירוג פחות מדויק מאשר ראש דף בלי דירוג בכלל.
  const avg = stats?.score != null
    ? Number(stats.score)
    : reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length;
  const score = avg.toFixed(1).replace(/\.0$/, '');
  // ‏P1-D: הדירוג פעם אחת - בבאנר (‏heroRating)

  // אותו דירוג בשלושה מקומות: בבאנר כמדד אמון, בסרגל המדדים כמספר,
  // ובכותרת המקטע עצמו
  const ratingEl = document.getElementById('heroRating');
  ratingEl.innerHTML = `${starsHtml(avg)}<span class="hr-score">${score}</span>`
    + `<span class="hr-count">${escapeHtml(ratingBreakdown(stats, reviews.length))} ←</span>`;
  ratingEl.hidden = false;
  agencyStats.rating = score;
  agencyStats.ratingCount = reviews.length;
  renderTrustBar();

  document.getElementById('reviewsSec').style.display = 'block';
  el.innerHTML = '';
  reviews.forEach(r=>{
    const rating = Math.max(0, Math.min(5, Number(r.rating) || 0));
    const card = document.createElement('div');
    card.className = 'panel review-card';
    // הדירוג הישיר מוצג רק כשניתן. השאלה אופציונלית, ושורה ריקה "המשרד: ☆☆☆☆☆"
    // הייתה נקראת כדירוג אפס במקום כתשובה שלא נמסרה.
    const agencyRating = Number(r.agency_rating);
    const agencyLine = (agencyRating >= 1 && agencyRating <= 5)
      ? `<div class="review-agency">המשרד עצמו: ${'★'.repeat(agencyRating)}${'☆'.repeat(5 - agencyRating)}</div>`
      : '';
    card.innerHTML = `
      <div class="review-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
      ${agencyLine}
      <div class="review-text">${escapeHtml(r.text || '')}</div>
      <div class="review-by">${escapeHtml(r.reviewer_display_name || 'לקוח מאומת')}</div>`;
    el.appendChild(card);
  });
}

/* ============================================================================
   הכלים של דף המשרד
   ----------------------------------------------------------------------------
   שני כלים, ולידים משניהם הולכים לאותו מקום: הפונקציה owner-lead-intake, עם
   ה-slug של המשרד שבדף. זה ההבדל היחיד מהאשף שבדף הבית — וזה כל ההבדל:
   ליד שנושא agency_slug אינו נכנס לרוטציה של הפלטפורמה אלא משויך ישירות
   למנהל/ת המשרד ונפתח מיד, בלי תור, בלי מכסה ובלי חיוב. מה שהדף של המשרד
   מייצר שייך למשרד.

   השליחה היא fetch() טהור ולא דרך ה-SDK, בדיוק כמו בדף הבית: הכלים חייבים
   לעבוד גם כשה-CDN של supabase-js נכשל בטעינה.
   ========================================================================== */
const OWNER_LEAD_FUNCTION_URL = SUPABASE_URL + '/functions/v1/owner-lead-intake';

// ה-slug של המשרד שבדף, והעיר שבה הוא פועל — שניהם נכנסים לכל ליד
const leadContext = { slug:null, city:'עפולה' };

async function sendAgencyLead(payload){
  const res = await fetch(OWNER_LEAD_FUNCTION_URL, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'apikey':SUPABASE_ANON_KEY,
      'Authorization':'Bearer ' + SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      agency_slug: leadContext.slug,
      city: leadContext.city,
      property_type: 'דירה', // ברירת מחדל; אשף בעלי הנכסים שולח 'מסחרי' לנכס מסחרי
      ...payload,
    }),
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok || data.error) throw new Error(data.error || 'שגיאה');
  return data;
}

/* ============================================================================
   אשף הערכת השווי — הרכיב של דף הבית
   ----------------------------------------------------------------------------
   שלושה שלבים: עסקה וכתובת, מאפייני הנכס, פרטי קשר. הקוד כאן הוא אותו קוד
   שמפעיל את הבאנר בדף הבית, כדי ששינוי בהתנהגות של אחד לא ייווצר בשקט
   בשני. מה שנוסף הוא ההקשר של המשרד: הכותרת, שורת ההסבר ומסך הסיום
   מדברים בשמו, והליד נושא את ה-slug שלו.
   ========================================================================== */
const CONDITION_LABELS = {
  renovated: 'משופץ',
  partly_renovated: 'משופץ חלקית',
  needs_renovation: 'דרוש שיפוץ',
};

const ownerHeadline = document.getElementById('ownerHeadline');
const wizForm = document.getElementById('ownerWizardForm');
const wizDone = document.getElementById('wizDone');

const wizState = { deal:'sale', kind:'residential', address:'', condition:null, rooms:null, subtype:null, size:null, features:[], name:'', phone:'' };

/* מגורים או מסחרי - כמו באשף שבדף הבית. מסחרי מחליף בשלב 2 את החדרים
   בסוג הנכס ובשטח, ואת המאפיינים של דירה (ממ״ד, מרפסת) בשל נכס מסחרי.
   מה שסומן והוסתר יורד מהבחירה - אחרת חנות הייתה נשלחת עם "מרפסת". */
function applyOwnerKind(){
  const commercial = wizState.kind === 'commercial';
  document.getElementById('wizRoomsBox').hidden = commercial;
  document.getElementById('wizSubtypeBox').hidden = !commercial;
  document.getElementById('wizSizeBox').hidden = !commercial;
  wizForm.querySelectorAll('.wiz-checks label[data-kind]').forEach(l=>{
    const off = l.dataset.kind !== wizState.kind;
    l.hidden = off;
    if (off) l.querySelector('input').checked = false;
  });
  wizState.features = Array.from(wizForm.querySelectorAll('.wiz-checks input:checked')).map(i=>i.value);
  setError(2, '');
}

function setError(step, message){
  document.getElementById('wizErr' + step).textContent = message || '';
}

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

/* בחירה יחידה מתוך רשימה (מצב הנכס, חדרים) - ‏<select data-pick>. היו כאן
   רצועות צ'יפים, ושמונה כפתורי חדרים תפסו חצי מסך טלפון. */
function bindSingleChoice(attr, onPick){
  document.querySelectorAll(`select[data-pick="${attr}"]`).forEach(sel=>{
    sel.addEventListener('change', ()=> onPick(sel.value || null));
  });
}

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
    const commercial = wizState.kind === 'commercial';
    const size = Number(document.getElementById('wizSize').value);
    wizState.size = commercial && size > 0 ? Math.round(size) : null;
    if (!wizState.condition){ setError(2, 'נא לבחור את מצב הנכס'); return false; }
    if (commercial && !wizState.subtype){ setError(2, 'נא לבחור את סוג הנכס'); return false; }
    if (!commercial && !wizState.rooms){ setError(2, 'נא לבחור מספר חדרים'); return false; }
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

/* ---------- שורת ההזמנה של באנר ליד ----------
   אותו רכיב של דף הבית: שורה סגורה שכולה כפתור, ומתחתיה פאנל שנפתח בלחיצה
   ונסגר בלחיצה נוספת. מחזירה פונקציה שפותחת/סוגרת מבחוץ. */
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

function initOwnerWizard(agency){
  // הבאנר מדבר בשם המשרד ולא בשם הפלטפורמה — זו הסיבה שהגולש/ת ישאיר/תשאיר
  // כאן פרטים ולא בדף הבית
  document.getElementById('ownerTeaserSub').textContent =
    `הערכת שווי חינם מיועצי הנדל״ן של ${agency.name}`;
  document.getElementById('ownerLead').textContent =
    `קבלו הערכת שווי מקצועית לנכס שלכם ב-3 קליקים, מיועצי הנדל״ן של ${agency.name}.`;
  document.getElementById('wizDoneNote').textContent =
    `יועצי הנדל״ן של ${agency.name} יחזרו אליכם בזמן קצר עם הערכת המחיר לנכס.`;

  // כל הקלדה מנקה את השגיאה ואת סימון השדה, כדי שלא תישאר אדומה אחרי תיקון
  [['wizAddress',1], ['wizName',3], ['wizPhone',3]].forEach(([id, step])=>{
    document.getElementById(id).addEventListener('input', (e)=>{
      e.target.classList.remove('invalid');
      setError(step, '');
    });
  });

  bindLeadBanner({
    banner:'ownerBanner', teaser:'ownerStartBtn', panel:'ownerPanel',
    onOpen(){
      goToStep(1);
      // ‏preventScroll: הפוקוס נועד לחסוך הקלקה, לא לקפוץ מעל שורת ההזמנה
      // שהמשתמש/ת בדיוק לחץ/ה עליה
      document.getElementById('wizAddress').focus({ preventScroll:true });
    },
  });

  /* --- שלב 1: סוג עסקה + כתובת --- */
  document.querySelectorAll('.owner-toggle button[data-owner]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      wizState.deal = btn.dataset.owner;
      ownerHeadline.textContent = wizState.deal === 'sale' ? 'מוכר?' : 'משכיר?';
    });
  });
  document.querySelectorAll('.owner-toggle button[data-owner-kind]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      wizState.kind = btn.dataset.ownerKind;
      applyOwnerKind();
    });
  });

  /* --- שלב 2: בחירה יחידה מרשימה ---
     ניקוי השגיאה מיד עם הבחירה, ולא רק בניסיון המעבר הבא — אחרת ההודעה
     "נא לבחור מספר חדרים" נשארת על המסך אחרי שהמשתמש כבר בחר. */
  bindSingleChoice('condition', v => { wizState.condition = v; setError(2, ''); });
  bindSingleChoice('rooms', v => { wizState.rooms = v; setError(2, ''); });
  bindSingleChoice('subtype', v => { wizState.subtype = v; setError(2, ''); });

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

  wizForm.addEventListener('submit', submitOwnerWizard);

  document.getElementById('wizRestart').addEventListener('click', ()=>{
    wizForm.reset();
    wizForm.querySelectorAll('.chip').forEach(c=> c.setAttribute('aria-checked','false'));
    wizForm.querySelectorAll('.wiz-input').forEach(i=> i.classList.remove('invalid'));
    [1,2,3].forEach(s => setError(s, ''));
    Object.assign(wizState, { address:'', condition:null, rooms:null, subtype:null, size:null, features:[], name:'', phone:'' });
    const submitBtn = document.getElementById('wizSubmitBtn');
    submitBtn.textContent = 'קבלת הערכת שווי חינם';
    submitBtn.disabled = false;
    wizDone.hidden = true;
    wizForm.hidden = false;
    document.getElementById('wizSteps').hidden = false;
    goToStep(1);
  });
}

async function submitOwnerWizard(e){
  e.preventDefault();
  if (!validateStep(3)) return;
  const submitBtn = document.getElementById('wizSubmitBtn');
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'שולח…';
  submitBtn.disabled = true;
  try{
    await sendAgencyLead({
      // ‏'מסחרי' ולא סוג המשנה: זה הערך שבהעדפות הלידים של הסוכנים
      property_type: wizState.kind === 'commercial' ? 'מסחרי' : 'דירה',
      property_subtype: wizState.kind === 'commercial' ? wizState.subtype : null,
      size_sqm: wizState.kind === 'commercial' ? wizState.size : null,
      deal_type: wizState.deal,
      address: wizState.address,
      rooms: wizState.kind === 'commercial' ? null : wizState.rooms,
      condition: CONDITION_LABELS[wizState.condition] || null,
      features: wizState.features,
      name: wizState.name,
      phone: wizState.phone,
    });
    wizForm.hidden = true;
    document.getElementById('wizSteps').hidden = true;
    wizDone.hidden = false;
  } catch(err){
    console.error('owner-lead-intake failed:', err);
    setError(3, 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב');
    submitBtn.textContent = originalLabel;
    submitBtn.disabled = false;
  }
}

/* עיצוב מספרים בעברית. נשאר אחרי שמחשבון התשואה ירד מהדף: כרטיסי
   הלקוחות והחיפושים השמורים מציגים דרכו תקציבים. */
const nis = n => Math.round(n).toLocaleString('he-IL');

/* ============================================================================
   באנר מחפשי הנכס — האשף של דף הבית, בדף המשרד
   ----------------------------------------------------------------------------
   אותו יעד בדיוק: ‏saved-search-intake של הסוכן החכם (ראו
   docs/smart-search-agent.md). מה שנשמר הוא חיפוש שמור — קריטריונים, ערוץ
   התראה והסכמה ליצירת קשר — ולכן אין כאן endpoint משלו: טבלה שנייה לאותו
   דבר הייתה מפצלת גם את ההתראות וגם את מדף הלידים.

   ההבדל היחיד מדף הבית הוא ה-source, שנרשם ביומן הניתוב, ואזור ברירת
   המחדל: העיר שבה המשרד פועל. ההסכמה עצמה מנוסחת "מתווך/ת מהאזור" ולא
   "מהמשרד הזה", כי מדף הלידים של החיפושים השמורים הוא של הפלטפורמה.
   ========================================================================== */
const SAVED_SEARCH_FUNCTION_URL = SUPABASE_URL + '/functions/v1/saved-search-intake';

/* סוגי הנכס — אותן רשימות של דף הבית, כדי שחיפוש שנשמר מכאן ייקרא מול
   אותם ערכים שהנכסים עצמם נושאים. */
const BUY_RESIDENTIAL_PTYPES = [
  'דירה','דירת גן','גג/פנטהאוז','דופלקס','מרתף/פרטר','טריפלקס','יחידת דיור','סטודיו/לופט',
  'בית פרטי/קוטג\'','דו משפחתי','משק חקלאי/נחלה','משק עזר',
  'מגרש','בניין מגורים','מחסן','חניה','קב\' רכישה/זכות לנכס',
];
const BUY_COMMERCIAL_PTYPES = [
  'משרדים','חנויות/שטח מסחרי','מבני תעשייה','אולמות','חלל עבודה משותף','בניין משרדים',
  'מגרשים','מחסנים','סטודיו','כללי','מרתף','חניון','בית מלון','קליניקות',
];

const buyHoods = { rows:[], byId:new Map() };

const buyState = {
  deal:'sale',            // 'sale' | 'rent'  — מה שנשמר ב-deal_type
  category:'residential', // 'residential' | 'commercial'
  city:'',                // העיר שהשכונות שלה מוצגות - ראו renderBuyerHoods
  hoods:new Set(),
  rooms:new Set(),
  ptypes:new Set(),
  channel:'whatsapp',
  source:'agency_page_buyer_wizard',
};

/* אשף המחפשים ירד לפוטר, כלומר למקום שבקובץ נמצא *אחרי* הסקריפט הזה.
   שתי ההפניות נלקחו כאן, בזמן ריצת הסקריפט, ולכן חזרו null — והקריאה
   הראשונה אליהן ב-initBuyerWizard זרקה שגיאה שנפלה ל-catch של loadAgency
   והדליקה את "המשרד לא נמצא" מעל דף שכבר היה טעון ומוצג. ההפניות נלקחות
   עכשיו ב-initBuyerWizard, שרץ ממילא רק אחרי שהדף כולו נבנה. */
let buyerForm = null;
let buyDoneEl = null;

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

/* השכונות נטענות מאותה טבלה שמזינה את סינון המפה בדף הבית. הן מגיעות
   בשאילתה נפרדת ואחרי שהדף כבר עומד, ולכן הרצועה נבנית מחדש כשהן מגיעות.
   ‏textContent ולא innerHTML: שמות שכונות מוזנים על ידי משתמשי הפלטפורמה. */
/* **עיר קודם, ואז השכונות שלה.** עד כאן נפתחו כאן השכונות של כל הערים
   בפלטפורמה, ממוינות לפי א״ב - "רמת טבעון א'" של חיפה ליד "אבוקדו" של
   עפולה, בלי שום דרך לדעת מה שייך לאיפה. בורר העיר יושב מעל, נפתח על
   העיר של הדף, ומציג רק את השכונות שלה. הוא נבנה בקוד ולא ב-HTML, כמו
   ב-assets/buyer-banner.js.

   ‏**ומה נשמר:** החיפוש מתאים נכס לפי עיר **או** שכונה
   ‏(saved_search_matches), ולכן העיר נשלחת רק כשלא נבחרה שכונה - אחרת
   היא הייתה מרחיבה את החיפוש לכל העיר. ראו buyCriteria. */
function buyHoodCities(){
  return [...new Set(buyHoods.rows.map(h => h.city).filter(Boolean))]
    .sort((a,b)=> a.localeCompare(b, 'he'));
}
function buyCitySelect(){
  let sel = document.getElementById('buyCity');
  if (sel) return sel;
  const label = document.getElementById('buyHoodLabel');
  if (!label) return null;
  const lbl = document.createElement('label');
  lbl.className = 'wiz-label';
  lbl.id = 'buyCityLabel';
  lbl.htmlFor = 'buyCity';
  lbl.textContent = 'באיזו עיר?';
  sel = document.createElement('select');
  sel.id = 'buyCity';
  sel.className = 'wiz-input buy-city';
  sel.addEventListener('change', ()=>{
    buyState.city = sel.value;
    buyState.hoods.clear();   // שכונה מעיר אחרת אינה חלק מהחיפוש בעיר הזו
    renderBuyerHoods();
    buySetError(1, '');
  });
  label.before(lbl, sel);
  return sel;
}

function renderBuyerHoods(){
  const wrap = document.getElementById('buyHoodChips');
  const fallback = document.getElementById('buyAreaFallback');
  const label = document.getElementById('buyHoodLabel');
  if (!wrap) return;
  wrap.textContent = '';
  const sel = buyCitySelect();
  const cities = buyHoodCities();

  // בלי רשימת שכונות (מסד לא זמין) נשארת תיבת טקסט חופשי — שלב בלי שום
  // דרך לציין אזור הוא שלב מיותר. השאלה "באילו שכונות?" יורדת איתה, כדי
  // שלא תישאל שאלה שאין מתחתיה מה לענות.
  if (!cities.length){
    if (fallback) fallback.hidden = false;
    if (label) label.hidden = true;
    if (sel){ sel.hidden = true; document.getElementById('buyCityLabel').hidden = true; }
    return;
  }
  if (fallback) fallback.hidden = true;
  if (sel){ sel.hidden = false; document.getElementById('buyCityLabel').hidden = false; }

  if (!cities.includes(buyState.city)){
    const want = leadContext.city;
    buyState.city = cities.includes(want) ? want : cities[0];
  }
  if (sel){
    sel.textContent = '';
    cities.forEach(c=>{
      const o = document.createElement('option');
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    });
    sel.value = buyState.city;
  }

  const list = buyHoods.rows.filter(h => h.city === buyState.city);
  if (label) label.hidden = !list.length;
  list.slice()
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
  const list = buyState.category === 'commercial' ? BUY_COMMERCIAL_PTYPES : BUY_RESIDENTIAL_PTYPES;
  wrap.textContent = '';
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

const buyNum = (id)=>{ const v = document.getElementById(id).value.trim(); return v === '' ? null : Number(v); };

/* מה שנשמר בפועל. ‏'+6' פירושו "6 ומעלה", כלומר מינימום בלי מקסימום. */
function buyCriteria(){
  const roomVals = [...buyState.rooms].map(r => r === '+6' ? 6 : parseFloat(r)).filter(n => !isNaN(n));
  const openEnded = buyState.rooms.has('+6');
  const commercial = buyState.category === 'commercial';
  // בלי רשימת שכונות נשארת תיבת הטקסט, ובה העיר שהמשרד פועל בה כברירת מחדל
  // עיר רק כשלא נבחרה שכונה: ההתאמה היא עיר **או** שכונה, ועיר לצד
  // שכונות הייתה מרחיבה את החיפוש לכל העיר
  const area = buyHoods.rows.length
    ? (buyState.hoods.size ? '' : buyState.city)
    : document.getElementById('buyArea').value.trim();
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

function buyRoomsText(c){
  return c.min_rooms && c.max_rooms && c.min_rooms !== c.max_rooms ? `${c.min_rooms}-${c.max_rooms} חדרים`
       : c.min_rooms ? `${c.min_rooms} חדרים${!c.max_rooms ? ' ומעלה' : ''}`
       : c.max_rooms ? `עד ${c.max_rooms} חדרים` : null;
}
function buyHoodNames(c){
  return c.neighborhood_ids.map(id => buyHoods.byId.get(id)?.name).filter(Boolean);
}

/* הסיכום שמעל שדות הקשר: מה בדיוק יישמר ברגע שנמסר טלפון. */
function buyRenderRecap(){
  const c = buyCriteria();
  const hoodNames = buyHoodNames(c);
  const budget = c.min_price && c.max_price ? `${nis(c.min_price)}-${nis(c.max_price)} ₪`
               : c.max_price ? `עד ${nis(c.max_price)} ₪`
               : c.min_price ? `מ-${nis(c.min_price)} ₪` : null;
  const parts = [
    BUY_DEAL_LABELS[c.deal_type],
    c.category === 'commercial' ? 'נכס מסחרי' : null,
    hoodNames.length ? '📍 ' + hoodNames.join(', ') : (c.cities.length ? '📍 ' + c.cities.join(', ') : '📍 כל האזורים'),
    c.property_types.length ? '🏠 ' + c.property_types.join(', ') : null,
    buyRoomsText(c),
    budget ? '💰 ' + budget : null,
    c.min_size_sqm || c.max_size_sqm
      ? `📐 ${c.min_size_sqm || ''}${c.min_size_sqm && c.max_size_sqm ? '-' : ''}${c.max_size_sqm || ''} מ״ר` : null,
  ].filter(Boolean);
  document.getElementById('buyRecap').textContent = parts.join(' · ');
}

/* כותרת החיפוש, כפי שתופיע בהתראה ובכרטיס הליד */
function buyBuildLabel(c){
  const hoodNames = buyHoodNames(c);
  const place = hoodNames.length ? hoodNames.join(', ') : (c.cities.length ? c.cities.join(', ') : null);
  return [
    buyRoomsText(c) || c.property_types[0] || (c.category === 'commercial' ? 'נכס מסחרי' : 'נכס'),
    place ? 'ב' + place : null,
    BUY_DEAL_LABELS[c.deal_type],
    c.max_price ? 'עד ' + nis(c.max_price) + ' ₪' : null,
  ].filter(Boolean).join(' ').slice(0, 200);
}

async function submitBuyerWizard(e){
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
    // ה-slug הוא מה שהופך את החיפוש הזה לליד של המשרד: הוא לא נכנס למדף
    // של הפלטפורמה אלא משויך למנהל/ת המשרד, בדיוק כמו הערכת השווי
    // שלצידו. ההתראות למחפש/ת עובדות בשני המקרים אותו דבר.
    agency_slug: leadContext.slug,
    source: buyState.source,
  };

  try{
    const res = await fetch(SAVED_SEARCH_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey':SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + SUPABASE_ANON_KEY },
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
    /* ‏duplicate=true פירושו שהחיפוש הזה כבר שמור. מבחינת המחפש/ת זו הצלחה.
       ‏assigned_to_agency מגיע מהשרת ולא מנוחש כאן: רק הוא יודע אם הפרטים
       באמת הגיעו למשרד (הסכמה שניתנה, ‏slug מוכר, מיגרציה שרצה), ומסך סיום
       שמבטיח משהו שלא קרה גרוע ממסך סיום סתמי. */
    const office = (currentAgency && currentAgency.name) || 'המשרד';
    document.getElementById('buyDoneText').textContent = data.duplicate
      ? 'החיפוש הזה כבר שמור אצלנו - נעדכן אתכם ברגע שיעלה נכס מתאים.'
      : data.assigned_to_agency
        ? `נעדכן אתכם ברגע שיעלה נכס שמתאים, ויועצי הנדל״ן של ${office} יחזרו אליכם עם נכסים מתאימים.`
        : 'נעדכן אתכם ברגע שיעלה נכס שמתאים למה שביקשתם.';
    buyerForm.hidden = true;
    document.getElementById('buySteps').hidden = true;
    buyDoneEl.hidden = false;
  } catch(err){
    console.warn('saved-search-intake (buyer banner) failed:', err);
    buySetError(3, /[\u0590-\u05FF]/.test(err.message || '')
      ? err.message : 'השמירה נכשלה - בדקו חיבור לאינטרנט ונסו שוב. לעזרה בוואטסאפ: 054-6929991');
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
}

function initBuyerWizard(agency, sb){
  // ה-DOM של האשף יושב היום מעל הסקריפט הזה (מתחת לנכסים, ולא בפוטר),
  // ולכן הוא כבר מנותח כשמגיעים לכאן. הבדיקה נשארת כרשת ביטחון: כשהאשף
  // עוד לא שם — כי מישהו הזיז אותו — מאתחלים כשהוא כן.
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=> initBuyerWizard(agency, sb), { once:true });
    return;
  }
  buyerForm = document.getElementById('buyerWizardForm');
  buyDoneEl = document.getElementById('buyDone');
  if (!buyerForm || !buyDoneEl) return;

  document.getElementById('buyerLead').textContent =
    `ספרו לנו מה אתם מחפשים - ונעדכן אתכם בוואטסאפ או במייל ברגע שיעלה נכס שמתאים, לפני שכולם רואים אותו.`;
  // ההסכמה נוקבת בשם המשרד ולא ב"מתווך/ת מהאזור": הפרטים מגיעים לכאן,
  // למשרד שבדף, ולא לרוטציה של הפלטפורמה
  document.getElementById('buyConsentText').textContent =
    `אשמח שיועצי הנדל״ן של ${agency.name} יפנו אליי עם נכסים מתאימים`;
  // תיבת האזור נפתחת עם העיר שבה המשרד פועל — זה האזור שהמחפש/ת בא/ה בשבילו
  document.getElementById('buyArea').value = leadContext.city || '';

  bindLeadBanner({
    banner:'buyerBanner', teaser:'buyerStartBtn', panel:'buyerPanel',
    onOpen(){ buyGoToStep(1); },
  });

  /* --- שלב 1: סוג החיפוש --- */
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

  /* --- שלב 2: חדרים (בחירה מרובה) ---
     בחירה מרובה ולא טווח: "3 או 4 חדרים" היא הדרך שבה אנשים מחפשים, והיא
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

  buyerForm.addEventListener('submit', submitBuyerWizard);

  document.getElementById('buyRestart').addEventListener('click', ()=>{
    buyerForm.reset();
    buyState.hoods.clear();
    buyState.rooms.clear();
    buyState.ptypes.clear();
    buyState.city = '';
    renderBuyerHoods();
    buyerForm.querySelectorAll('.chip').forEach(c=> c.setAttribute('aria-pressed','false'));
    buyerForm.querySelectorAll('.wiz-input').forEach(i=> i.classList.remove('invalid'));
    [1,2,3].forEach(s => buySetError(s, ''));
    const btn = document.getElementById('buySubmitBtn');
    btn.textContent = 'קבלת עדכונים';
    btn.disabled = false;
    buyDoneEl.hidden = true;
    buyerForm.hidden = false;
    document.getElementById('buySteps').hidden = false;
    document.getElementById('buyArea').value = leadContext.city || '';
    buyGoToStep(1);
  });

  // מצב פתיחה: סוגי הנכס למגורים, ותיבת האזור החופשית עד שהשכונות מגיעות
  renderBuyPtypes();
  renderBuyerHoods();

  /* השכונות נטענות אחרי שהדף כבר עומד. כישלון אינו שובר דבר: נשארת תיבת
     הטקסט החופשי עם עיר המשרד. */
  if (!sb) return;
  sb.from('neighborhoods').select('id, city, name').then(({ data, error })=>{
    if (error || !data || !data.length) return;
    buyHoods.rows = data;
    buyHoods.byId = new Map(data.map(h => [h.id, h]));
    renderBuyerHoods();
  }, (err)=> console.warn('טעינת השכונות נכשלה, נשארת תיבת האזור החופשי:', err));
}

loadAgency();
