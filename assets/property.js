const SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
/* לקוח אחד לכל הדף: כל createClient יוצר GoTrueClient משלו, ושמונה כאלה על אותו
   אחסון הפיקו בקונסול "Multiple GoTrueClient instances" (P2) */
let sbShared = null;
function sbClient(){ return sbShared || (sbShared = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)); }
const INQUIRY_FUNCTION_URL = SUPABASE_URL + '/functions/v1/property-inquiry-intake';
const SITE_LOGO = 'assets/logo-shuknadlan.svg';
const NO_PHOTOS_NOTE = 'תמונות של הנכס יעלו בקרוב';
/* אותה כתובת ש-og-tags שם ב-src וב-preload כשאין תמונה ואין פוסטר.
   מחיקת הצומת מחזירה את ה-LCP לטקסט שנכתב אחרי השאילתה. */
const HERO_PLACEHOLDER = '/assets/property-placeholder.jpg';
const LTV_THRESHOLDS = { single:0.75 }; // מודול 2 §5.5

/* ---------- ספריית אייקונים ----------
   אייקוני קו במשקל אחיד (stroke 1.9, 24×24) בסגנון Lucide, מוטמעים כדי לא
   להוסיף עוד בקשת רשת לדף שכבר טוען Supabase, Leaflet ופונטים.            */
const S = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  ruler:   S('<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>'),
  bed:     S('<path d="M2 20v-8h20v8M2 12V6M22 12v-2a2 2 0 0 0-2-2h-6v4M2 20h20"/><circle cx="7" cy="10" r="2"/>'),
  stairs:  S('<path d="M3 20h4v-4h4v-4h4V8h4V4"/><path d="M3 20V4"/>'),
  shekel:  S('<path d="M6 5v9a4 4 0 0 0 4 4h1"/><path d="M18 19v-9a4 4 0 0 0-4-4h-1"/><path d="M6 5h12"/>'),
  pin:     S('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  building:S('<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20"/><path d="M8 7h2M8 11h2M8 15h2"/>'),
  area:    S('<path d="M3 3h18v18H3z"/><path d="M9 3v18M3 9h18"/>'),
  check:   S('<path d="M20 6 9 17l-5-5"/>'),
  car:     S('<path d="M5 17h14M6.5 17v2M17.5 17v2"/><path d="M4 17v-4l2-5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 8l2 5v4"/><path d="M6.5 13.5h.01M17.5 13.5h.01"/>'),
  elevator:S('<rect x="4" y="3" width="16" height="18" rx="0"/><path d="M12 3v18M8 9l1.5-2L11 9M13 15l1.5 2 1.5-2"/>'),
  sun:     S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  balcony: S('<path d="M4 21V10h16v11M2 21h20M8 10v11M12 10v11M16 10v11"/><path d="M12 3v4M8 6l4-3 4 3"/>'),
  snow:    S('<path d="M12 2v20M4.2 7l15.6 10M19.8 7 4.2 17"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>'),
  shield:  S('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>'),
  truck:   S('<path d="M2 17V6h11v11M13 9h4l4 4v4h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  sofa:    S('<path d="M4 12V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M2 14a2 2 0 0 1 4 0v3h12v-3a2 2 0 0 1 4 0v5H2Z"/>'),
  sparkle: S('<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M18 16.5 18.7 18l1.5.7-1.5.7L18 21l-.7-1.6-1.5-.7 1.5-.7Z"/>'),
  box:     S('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  camera:  S('<path d="M3 8h3l2-3h8l2 3h3v11H3Z"/><circle cx="12" cy="13" r="3.5"/>'),
  bell:    S('<path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7"/><path d="M10.5 20a2 2 0 0 0 3 0"/>'),
  users:   S('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>'),
  wifi:    S('<path d="M2 8.8a16 16 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16.2a6 6 0 0 1 7 0"/><path d="M12 20h.01"/>'),
  thermo:  S('<path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0Z"/>'),
  plug:    S('<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0Z"/><path d="M12 17v5"/>'),
  access:  S('<circle cx="12" cy="4.5" r="1.8"/><path d="M6 8.5h12M12 8.5V15M12 15l-3 5M12 15l3 5"/>'),
  arrowUp: S('<path d="M12 20V4M6 10l6-6 6 6"/>'),
  utensils:S('<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10"/><path d="M17 3c-1.5 1.5-2 3-2 5s.7 3 2 3v10"/>'),
  star:    S('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
  cube:    S('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5M12 13v8"/><path d="M7.5 5.5 16.5 10.7"/>'),
  play:    S('<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5v7l6-3.5Z"/>'),
  // כדור ולא קובייה: ‎cube‎ שייך לסיור החיצוני, וזה סיור שמסתובבים בתוכו
  pano:    S('<circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4.2" ry="9.5"/><path d="M2.5 12h19"/>'),
  soundOff:S('<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>'),
  soundOn: S('<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.6 5.7a9 9 0 0 1 0 12.6"/>'),
  key:     S('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8-8M17 6l2 2M14.5 8.5l2 2"/>'),
  window:  S('<rect x="3" y="3" width="18" height="18" rx="0"/><path d="M12 3v18M3 12h18"/>'),
  image:   S('<rect x="3" y="3" width="18" height="18" rx="0"/><circle cx="8.5" cy="9" r="1.8"/><path d="m21 15-5-5L5 21"/>'),
  trend:   S('<path d="M22 7 13.5 15.5l-4-4L2 19"/><path d="M16 7h6v6"/>'),
  call:    S('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"/>'),
};

/* תוויות המאפיינים — עותק של הרשימות ב-crm.html וב-index.html. שלושת הקבצים
   סטטיים ובלי מודול משותף, ולכן הסנכרון ידני (כמו שכבר מתועד שם).          */
/* ‏has_photo ו-tour_3d הוסרו מהאוצר: הראשון מעולם לא הוצג כאן (תמונות רואים
   בגלריה), והשני היה הצהרה שהכתובת ב-‎tour_3d_url‎ כבר אומרת טוב ממנה. קוד
   בלי תווית פשוט לא מצטרף לרשימת היתרונות, ולכן נכסים ישנים שהדגל עוד יושב
   עליהם לא יציגו שורה מיותרת.                                              */
const FEATURE_LABELS = {
  moshav_kibbutz_only:'במושב/קיבוץ', price_dropped:'המחיר ירד לאחרונה',
  parking:'חניה', elevator:'מעלית', balcony:'מרפסת', sun_balcony:'מרפסת שמש', ac:'מיזוג', bars:'סורגים',
  accessible:'גישה לנכים', renovated_feature:'משופצת', furnished:'מרוהטת', mamad:'ממ״ד', exclusive:'בבלעדיות',
  building_shelter:'מקלט בבניין', mamak:'ממ״ק', storage:'מחסן', high_ceiling:'תקרה גבוהה', cameras:'מצלמות',
  kitchenette:'מטבחון', alarm:'אזעקה', meeting_room:'חדר ישיבות', loading_ramp:'רמפת העמסה',
  comms:'תקשורת', cold_room:'חדר קירור', ev_charger:'עמדת טעינה לרכב חשמלי',
};
/* אייקון לכל מאפיין — מה שאין לו אייקון ייעודי מקבל וי, כדי שרשימת היתרונות
   תישאר קו אחד ולא תערבב אייקונים לחלק מהשורות ונקודות לשאר. */
const FEATURE_ICONS = {
  parking:'car', elevator:'elevator', balcony:'balcony', sun_balcony:'sun', ac:'snow', bars:'window',
  accessible:'access', renovated_feature:'sparkle', furnished:'sofa', mamad:'shield', mamak:'shield',
  building_shelter:'shield', storage:'box', high_ceiling:'arrowUp', cameras:'camera', kitchenette:'utensils',
  alarm:'bell', meeting_room:'users', loading_ramp:'truck', comms:'wifi', cold_room:'thermo', ev_charger:'plug',
  exclusive:'star', price_dropped:'trend', moshav_kibbutz_only:'pin',
};
const CONDITION_LABELS = {
  new_from_contractor:'חדש מקבלן', new:'חדש', renovated:'משופץ',
  maintained:'שמור', needs_renovation:'דרוש שיפוץ',
};
// אותם ערכים של בורר "סטטוס הפרויקט" בטופס הנכס ב-crm.html
const PROJECT_STATUS_LABELS = {
  planning:'תכנון ראשוני', permit_requested:'הוגשה בקשה להיתר',
  permit_issued:'ניתן היתר בנייה', construction_complete:'הבנייה הסתיימה',
};
/* מצב הנכס מוצג גם כיתרון מאויר — "חדש מקבלן" הוא טיעון מכירה, לא שורה
   בטבלה. רק המצבים החיוביים; "דרוש שיפוץ" נשאר בטבלת הפרטים בלבד. */
const CONDITION_HIGHLIGHTS = {
  new_from_contractor:{ icon:'key',     label:'חדש מקבלן' },
  new:                {  icon:'sparkle', label:'נכס חדש' },
  renovated:          {  icon:'sparkle', label:'משופץ' },
  maintained:         {  icon:'check',   label:'במצב שמור' },
};

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> t.style.display='none', 3500);
}

/* מחיר מסחרי נמסר כמעט תמיד לפני מע"מ, ולכן "+ מע״מ" מוצג ליד המחיר
   אלא אם הסוכן/ת סימן/ה במפורש שהמחיר כולל (‏price_includes_vat = true).
   אותו כלל ב-property-card.js, property.js, home.js ו-open-house.html. */
function vatSuffix(p){
  return p.category === 'commercial' && p.price_includes_vat !== true ? ' + מע״מ' : '';
}
/* יחידת המחיר (‏price_unit, docs/price-unit.md): 'sqm' הוא מחיר למ״ר - בהשכרה
   למ״ר לחודש. ריק = לפי סוג העסקה, כמו שהיה: השכרה לחודש, מכירה סה״כ.
   אותו כלל ב-property-card.js, property.js, home.js, crm.js, open-house.html,
   instagram.html, showcase.js, og-tags.ts ו-marketing-copy.ts. */
function priceUnitOf(p){
  return p.price_unit || (p.deal_type === 'rent' ? 'month' : 'total');
}
function priceLabel(p){
  const unit = priceUnitOf(p);
  const per = unit === 'sqm' ? (p.deal_type === 'rent' ? ' למ״ר לחודש' : ' למ״ר') : unit === 'month' ? '/חוד׳' : '';
  return '₪' + Number(p.price).toLocaleString('he-IL') + per + vatSuffix(p);
}
/* המחיר בתצוגה הגדולה: מספר גדול + סיומת קטנה, כדי שהעין תתפוס קודם את
   הסכום ורק אחריו את "לחודש". */
function priceParts(p){
  const num = Number(p.price).toLocaleString('he-IL') + ' ₪';
  const unit = priceUnitOf(p);
  const per = unit === 'sqm' ? (p.deal_type === 'rent' ? ' למ״ר / חודש' : ' למ״ר') : unit === 'month' ? ' / חודש' : '';
  return { num, suffix: per + vatSuffix(p) };
}
function priceFlat(p){
  const parts = priceParts(p);
  return parts.num + parts.suffix;
}

/* ‏כתובת תמונה בתוך url('…') שבתוך מאפיין ‏style="…" — שתי שכבות ציטוט,
   ולכן encodeURI + ‎%27‎ ולא הדבקה ישירה: גרש בודד בשם הקובץ סוגר את ה-url
   ומריץ CSS זר, וגרש כפול בורח מהמאפיין עצמו אל תוך ה-HTML. */
function cssUrl(u){
  return encodeURI(String(u == null ? '' : u)).replace(/'/g, '%27');
}

/* התמונה הראשית של נכס היא images[0]; נכס בלי תמונות מקבל ממלא מקום עם לוגו
   המשרד שהנכס שייך אליו והבטחה שהתמונות בדרך — בדיוק כמו ב-index.html. */
/* תמונת כרטיס מוקטנת (‏docs/image-sizes.md). התמונות נשמרות בגודל מלא (עד
   כמה MB), ובטלפון דף התוצאות הוריד כ-25MB. ‏render/image של Supabase מקטין
   לרוחב הכרטיס ומגיש WebP לדפדפן שמקבל אותו - אותה נקודה שתמונת השער בדף
   הנכס כבר עוברת בה (‏heroRenderUrl, למטה). כתובת שאינה מהאחסון שלנו - כמו שהיא. */
function cardImgUrl(url, w){
  const s = String(url || '');
  const marker = '/storage/v1/object/public/';
  const at = s.indexOf(marker);
  if (at < 0) return s;
  const path = s.slice(at + marker.length).split(/[?#]/)[0];
  if (!path) return s;
  return s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=' + (w || 640) + '&quality=60';
}
function thumbStyle(p, i){
  const img = p.images && p.images[0];
  return img
    ? `background-image:url('${cssUrl(cardImgUrl(img))}');background-size:cover;background-position:center`
    : '';
}

// שם המשרד והלוגו שלו מגיעים ב-embed‏ agencies(...) על הנכס
function agencyLogoOf(p){ return (p && (p.agency_logo || (p.agencies && p.agencies.logo_url))) || ''; }
function agencyNameOf(p){ return (p && (p.agency_name || (p.agencies && p.agencies.name))) || ''; }

function thumbFallback(p){
  if (p && p.images && p.images[0]) return '';
  // v10 (סבב 4 חלק 3): אווטאר, הסבר וקישור "בקשו תמונות מהמפרסם" - assets/no-photo.js
  if (window.NoPhoto && NoPhoto.on()) return NoPhoto.html(p, {}, 'card');
  const name = agencyNameOf(p);
  const logo = agencyLogoOf(p) || (name ? '' : SITE_LOGO);
  const mark = logo
    ? `<img class="tf-logo" src="${escapeAttr(logo)}" alt="${escapeAttr(name)}" loading="lazy" onerror="this.remove()">`
    : `<span class="tf-logo tf-initial" aria-hidden="true">${escapeHtml(name.trim()[0] || '?')}</span>`;
  return `<div class="thumb-fallback">
      ${mark}
      ${name ? `<span class="tf-agency">${escapeHtml(name)}</span>` : ''}
      <span class="tf-note">${NO_PHOTOS_NOTE}</span>
    </div>`;
}
// הקידום נמכר לחלון של 72 שעות (כמו renderProperty למטה) — אותה בדיקה
// כאן כדי שסרט "מקודם" לא יישאר על כרטיס בקרוסלה אחרי שהחלון נגמר.
const isPromoted = p => !!p.is_promoted && (!p.promoted_until || new Date(p.promoted_until) > new Date());

function getPropertyIdFromUrl(){
  // ‏ה-UUID הראשון בערך: קישור שנדבק אליו טקסט (‏‎<uuid>שוק‎) עדיין נפתח.
  // ה-edge (‏og-tags.ts) כבר מפנה 301 לכתובת הנקייה; זה הגיבוי בדפדפן.
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id') || '';
  const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) return null;
  const id = m[0].toLowerCase();
  if (id !== raw && window.history && history.replaceState){
    params.set('id', id);
    history.replaceState(history.state, '', location.pathname + '?' + params.toString() + location.hash);
  }
  return id;
}

/* ---------- Lightweight view logging (module 4 §2.5) — fire and forget, never blocks rendering ---------- */
function logPropertyView(propertyId){
  try{
    if (!window.supabase) return;
    let sessionId = sessionStorage.getItem('shuknadlan_session_id');
    if (!sessionId){
      sessionId = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('shuknadlan_session_id', sessionId);
    }
    const sb = sbClient();
    sb.from('property_views').insert({ property_id: propertyId, visitor_session_id: sessionId })
      .then(({ error }) => { if (error) console.warn('view logging failed:', error); });
  } catch(e){ console.warn('view logging failed:', e); }
}

let currentProperty = null;

/* ‏הבלוק אינו ב-HTML של הצלחה, כדי שלא יהיו שני H1. נוצר רק כשצריך,
   ופסקה ולא כותרת: ה-H1 היחיד נשאר #propTitle. אם ה-edge כבר שתל אותו
   (‏404), משתמשים בו. */
function showNotFound(){
  document.getElementById('loadingState').style.display = 'none';
  let box = document.getElementById('notFoundState');
  if (!box){
    box = document.createElement('div');
    box.id = 'notFoundState';
    box.className = 'wrap';
    box.innerHTML =
      '<p class="prop-missing" style="font-size:1.3rem;font-weight:700">הנכס לא נמצא</p>' +
      '<p style="color:var(--ink-soft)">ייתכן שהמודעה הוסרה או שהקישור שגוי.</p>' +
      '<a href="/" class="btn btn-gold" style="margin-top:16px">חזרה לדף הבית</a>';
    document.getElementById('loadingState').insertAdjacentElement('afterend', box);
  }
  box.style.display = 'block';
}

async function loadProperty(){
  const id = getPropertyIdFromUrl();
  if (!id){
    showNotFound();
    return;
  }
  try{
    if (!window.supabase) throw new Error('supabase-js לא נטען');
    const sb = sbClient();
    const { data, error } = await sb
      .from('properties')
      .select('*, agencies(name, slug, logo_url, colors, cover_url), neighborhoods(name)')
      .eq('id', id)
      .eq('status', 'active')
      .single();
    if (error || !data) throw error || new Error('not found');

    // agent_id -> agency_members_public בשאילתה נפרדת, מאותה סיבה שכבר תועדה
    // ב-index.html: embed חוצה-שם (properties -> agency_members_public) לא מובטח.
    // ‏photo_url ו-license_number מזינים את כרטיס ההמרה: פנים ורישיון הופכים
    // טופס אנונימי לפנייה לאדם ספציפי.
    if (data.agent_id){
      const { data: agentRow } = await sb.from('agency_members_public')
        .select('id, display_name, slug, phone_e164, photo_url, photo_position, cover_url, license_number, has_ethics_badge, years_experience, specialties, service_area').eq('id', data.agent_id).maybeSingle();
      data.agency_members = agentRow || null;
    }

    currentProperty = data;
    initSave(data.id);
    if (window.NoPhoto && NoPhoto.on()) NoPhoto.useClient(sb);
    renderProperty(data);
    // ‏#contact&ask=photos - "בקשו תמונות" מאריח של נכס בלי תמונות (v10): הטופס, עם ההודעה המלאה
    if (window.NoPhoto && NoPhoto.on() && /ask=photos/.test(location.hash)) openInquiry(true);
    logPropertyView(id);
    /* ‏property_views במסד סופר צפיות לצורך הדוחות של המשרד; זה אותו רגע,
       ל-GA4, עם הפילוח שהמסד לא נותן — מאיזה קמפיין או חיפוש הגיעה הצפייה. */
    if (window.shukTrack) shukTrack('view_item', {
      item_name: data.title || '',
      item_category: data.property_type || '',
      deal_type: data.deal_type || '',
      city: data.city || '',
      value: Number(data.price) || 0,
      currency: 'ILS',
    });
    // לא חוסם את רינדור הנכס: הקרוסלה נטענת ומתמלאת ברקע, ותופיע ברגע
    // שהיא מוכנה.
    loadSimilarProperties(data).then(renderSimilarProperties);
    // גם ההדמיות נטענות ברקע: הן דורשות קריאת RPC נוספת ואין סיבה שהן
    // יעכבו את רינדור הנכס עצמו.
    //
    // קרקע לא מקבלת הדמיה. מידע תכנוני עולה לכל נכס (מ-22.10.2026 גם לדירות:
    // התוכניות החלות והודעות 77-78 נוגעות לקונה דירה בדיוק כמו לקונה מגרש,
    // docs/land-planning.md), והסקציה נעלמת מעצמה כשאין מה להציג.
    loadPlanningInfo(data);
    if (!isLandProperty(data)) loadVisualizations(data);
    // הסיור 360° נטען ברקע גם הוא, ורק לנכס שהדגל שלו דולק — כך שרוב
    // הנכסים אינם משלמים אפילו על השאילתה
    if (data.has_virtual_tour) loadVirtualTour(data);
  } catch(e){
    console.warn('טעינת נכס נכשלה:', e);
    showNotFound();
  }
}

/* ---------- גלריית Bento + לייטבוקס ----------
   מוצגות עד שלוש תמונות: ראשית ושתי משנה. יש יותר — התמונה השלישית מקבלת
   שכבת "+N" ופותחת את הלייטבוקס בתמונה הרביעית. רוב המודעות במערכת הן בעלות
   תמונה אחת או שתיים, ולכן ה-data-count קובע את פריסת הרשת: תמונה בודדת
   פורשת לרוחב מלא במקום להשאיר עמודה ריקה.                                 */
let galleryImages = [];
// הווידאו שתפס את תמונת השער, כשיש כזה. גם ‎renderVideoPanel‎ מסתכל עליו,
// כדי ששני הנגנים של אותו סרטון לא ישמיעו קול בו-זמנית.
let heroVideoEl = null;

/* ---------- מתי הסרטון תופס את תמונת השער ----------
   רק קובץ מדיה שלנו. ‏iframe של יוטיוב בתא הראשי היה גורר לשם נגן של צד
   שלישי — עם הפקדים, הלוגו והמלצות ההמשך שלו — בדיוק למקום שבו יושבים
   המחיר והתגיות, ובלי דרך להשתיק או לעצור אותו משם.

   ושלושה מצבים שבהם הוא מוותר על המקום וחוזר להיות תמונה. סרטון הנכס שוקל
   עד 50MB, ואת החשבון על ההורדה הזו משלם מי שגולל לעמוד ולא מי שבנה אותו:

     • ‏prefers-reduced-motion — בקשה מפורשת של המשתמש/ת לוותר על תנועה.
     • ‏Save-Data — הצהרה מפורשת "אני על חבילה מדודה".
     • חיבור 2G — שם הסרטון לא באמת יתחיל לנגן, הוא רק יחנוק את שאר העמוד.

   בכל שלושת המקרים לא נעלם כלום: התמונה הראשית חוזרת למקומה, והסרטון
   נשאר בנגן המלא שבהמשך העמוד עם הכפתור שמוביל אליו.

   כשהסרטון כן תופס את השער, התמונה (הפוסטר) היא מה שנצבע ראשון. הכתובת
   של הקובץ לא נכנסת ל-src לפני לחיצה או לפני שהדף סיים להיטען והדפדפן
   פנוי, ו-preload=none כדי שהקובץ (עד 50MB) לא יתחרה בתמונה. ניגון רק
   בלחיצה, לא בזמן הציור.                                                    */
function heroVideoSource(p){
  const embed = videoEmbed(p.video_url);
  if (!embed || embed.type !== 'video') return null;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const conn = navigator.connection;
  if (conn && conn.saveData) return null;
  if (conn && /^(slow-)?2g$/.test(conn.effectiveType || '')) return null;
  return embed.src;
}

/* ילד לפי מחלקה. בלי querySelector של מחלקה, כי בדיקת הסרטון מחקה
   DOM שמכיר רק img[data-lcp]. */
function elWithClass(parent, cls){
  const kids = parent && parent.children || [];
  for (let i = 0; i < kids.length; i++){
    if (kids[i].classList && kids[i].classList.contains(cls)) return kids[i];
  }
  return null;
}

/* אותה נוסחה כמו heroRenderUrl ב-og-tags.ts. src של השער ו-preload
   הם 800. סטייה מוחקת את צומת ה-SSR והדפדפן מוריד את הקובץ פעמיים. */
function heroRenderUrl(url, w, h){
  var marker = '/storage/v1/object/public/';
  var s = String(url || '');
  var at = s.indexOf(marker);
  if (at < 0) return '';
  var path = s.slice(at + marker.length).split(/[?#]/)[0];
  if (!path) return '';
  return s.slice(0, at) + '/storage/v1/render/image/public/' + path
    + '?width=' + w + '&height=' + h + '&resize=cover&quality=60';
}
function posterForHero(url){
  return heroRenderUrl(url, 800, 500) || url || '';
}
function isPlaceholderHero(img){
  if (!img || !img.getAttribute) return false;
  const src = img.getAttribute('src') || '';
  return src === HERO_PLACEHOLDER;
}
/* tagName הוא ה-DOM בדפדפן ("VIDEO"). nodeName אותו דבר.
   tag קיים רק ב-mock של הבדיקה, שאין לו tagName, ו-querySelector
   שם מזהה רק img[data-lcp]. */
function hasChildTag(parent, tag){
  const kids = parent && parent.children || [];
  const want = String(tag || '').toUpperCase();
  for (let i = 0; i < kids.length; i++){
    const el = kids[i];
    const name = (el && (el.tagName || el.nodeName || el.tag)) || '';
    if (String(name).toUpperCase() === want) return true;
  }
  return false;
}
function heroSrcset(url){
  var small = heroRenderUrl(url, 800, 500);
  var big = heroRenderUrl(url, 1200, 800);
  if (!small || !big) return '';
  return small + ' 800w, ' + big + ' 1200w';
}
function heroImgExtra(original){
  var set = heroSrcset(original);
  if (!set) return '';
  return ' srcset="' + escapeAttr(set) + '" sizes="(min-width:640px) 640px, 100vw"'
    + ' data-full="' + escapeAttr(original) + '"'
    + ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=this.getAttribute(\'data-full\')"';
}
function paintHeroImg(img, original){
  img.src = posterForHero(original);
  var set = heroSrcset(original);
  if (!set) return;
  img.setAttribute('srcset', set);
  img.setAttribute('sizes', '(min-width:640px) 640px, 100vw');
  img.setAttribute('data-full', original);
  img.setAttribute('onerror', "this.onerror=null;this.removeAttribute('srcset');this.src=this.getAttribute('data-full')");
}

/* הווידאו בלי src. תמונת data-lcp שכבר ב-HTML נשארת אותו צומת, כדי
   שה-LCP לא יתחיל מחדש אחרי שה-JS בונה את הגלריה. */
function attachHeroVideo(main, videoSrc, poster){
  main.classList.add('bento-video');
  const v = document.createElement('video');
  v.dataset.pendingSrc = videoSrc;
  v.preload = 'none';
  v.autoplay = false;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute('aria-label', 'סרטון הנכס');
  v.style.visibility = 'hidden';
  let img = main.querySelector && main.querySelector('img[data-lcp]');
  if (!img){
    const kids = main.children || [];
    for (let i = 0; i < kids.length; i++){
      if (kids[i].dataset && kids[i].dataset.lcp){ img = kids[i]; break; }
    }
  }
  if (!img && poster){
    img = document.createElement('img');
    img.className = 'bento-video-bg';
    img.dataset.lcp = '1';
    paintHeroImg(img, poster);
    img.alt = '';
    img.style.filter = 'none';
    img.style.transform = 'none';
    img.setAttribute('fetchpriority', 'high');
    img.setAttribute('aria-hidden', 'true');
    main.appendChild(img);
  }
  main.appendChild(v);
  const portrait = ()=>{
    if (main.classList.contains('is-portrait')) return;
    main.classList.add('is-portrait');
  };
  if (isReelVideo(videoSrc)) portrait();
  v.addEventListener('loadedmetadata', ()=>{ if (v.videoHeight > v.videoWidth) portrait(); });
  v.addEventListener('playing', ()=>{
    /* פריים אמיתי: הווידאו מכסה את הפלייסהולדר. ה-img נשאר ב-DOM.
       הסרה שלו לפני הפריים מוסרת את מועמד ה-LCP, והפסקה
       #planningSummary (שנכתבת אחר כך) תופסת את מקומו. */
    v.style.visibility = '';
    const shot = (main.querySelector && main.querySelector('img[data-lcp]')) || img;
    if (shot && main.classList.contains('is-portrait')){
      shot.style.filter = '';
      shot.style.transform = '';
    }
  });
  heroVideoEl = v;
}

function renderGallery(p){
  const grid = document.getElementById('bentoGrid');
  heroVideoEl = null;
  galleryImages = Array.isArray(p.images) ? p.images.filter(Boolean) : [];

  // כשהסרטון תופס את התא הראשי, התמונות המשניות מתחילות לרוץ מהראשונה ולא
  // מהשנייה — אחרת תמונת השער הייתה נעלמת מהרשת בלי סיבה.
  const videoSrc = heroVideoSource(p);
  const thumbStart = videoSrc ? 0 : 1;
  const thumbEnd = Math.max(thumbStart, Math.min(galleryImages.length, thumbStart + 2));
  const count = String(1 + thumbEnd - thumbStart);
  const poster = videoSrc ? (p.video_poster_url || galleryImages[0] || '') : (galleryImages[0] || '');
  const heroSrc = posterForHero(poster);
  const kept = grid.querySelector && grid.querySelector('img[data-lcp]');
  /* data-count של סרטון ושל גלריה בלי סרטון מתלכד כשיש לפחות שתי תמונות.
     reduced-motion / Save-Data / 2G מכבים את הסרטון רק בדפדפן, והשרת
     לא יודע את זה. בלי בדיקת המחלקה היינו משאירים את פריסת הסרטון.
     ההשוואה היא לכתובת ה-render, אותה כתובת שה-edge שם ב-src. */
  const mainNow = elWithClass(grid, 'bento-main');
  const paintedVideo = !!(mainNow && mainNow.classList && mainNow.classList.contains('bento-video'));
  const ssr = !!(kept && heroSrc && kept.getAttribute('src') === heroSrc
    && grid.getAttribute('data-count') === count
    && !!videoSrc === paintedVideo);
  /* בלי תמונה ובלי פוסטר ה-edge כבר שם img של הפלייסהולדר. מחיקת
     הרשת הייתה מבקשת את הקובץ רק אחרי שאילתת הנכס. שומרים את הצומת
     רק כשפריסת הסרטון תואמת את מה שהדפדפן ינגן: סרטון בלי פוסטר
     שהשרת צייר כ-bento-video, ו-reduced-motion / Save-Data / 2G
     מכבים אותו, נבנה מחדש כ-bento-empty (לוגו והודעה). HTML ישן
     של bento-empty שאחריו נוסף סרטון גם הוא לא נשמר, אחרת
     attachHeroVideo מוסיף את המחלקה והלוגו נשאר מתחת לסרטון. */
  const keepPlaceholder = !!(kept && isPlaceholderHero(kept) && !heroSrc && !galleryImages.length
    && !!videoSrc === paintedVideo);
  if (keepPlaceholder){
    grid.setAttribute('data-count', count);
    const main = elWithClass(grid, 'bento-main');
    if (videoSrc && main && !hasChildTag(main, 'video')) attachHeroVideo(main, videoSrc, '');
  } else if (!ssr){
    grid.innerHTML = '';
    // נכס בלי תמונות מקבל תא ראשי ברוחב מלא (data-count=1) עם גרדיאנט המותג,
    // כדי שהתגיות המרחפות יישארו במקומן ולא ייפלו על רשת ריקה
    grid.setAttribute('data-count', count);

    // כל תא הוא ‎div‎ עם כפתור פרוש בתוכו ולא ‎button‎ בעצמו, כדי שיוכל לשאת
    // תגיות מרחפות — כפתור בתוך כפתור אינו HTML חוקי.
    const makeCell = (cls, index, opensAt, hero)=>{
      const cell = document.createElement('div');
      cell.className = 'bento-cell ' + cls;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'cell-open';
      open.setAttribute('aria-label', `תמונה ${index+1} מתוך ${galleryImages.length} - פתיחה בגלריה`);
      const raw = galleryImages[index];
      open.innerHTML = hero
        ? `<img data-lcp="1" src="${escapeAttr(posterForHero(raw))}" alt="" fetchpriority="high"${heroImgExtra(raw)}>`
        // התאים הקטנים בגלריה - מוקטנים; הגלריה המלאה (‏lbOpen) נשארת בגודל מלא
        : `<img src="${escapeAttr(cardImgUrl(raw, 800))}" alt="" ${index ? 'loading="lazy"' : ''} data-full="${escapeAttr(raw)}" onerror="this.onerror=null;this.src=this.getAttribute('data-full')">`;
      open.addEventListener('click', ()=> lbOpen(opensAt));
      cell.appendChild(open);
      return cell;
    };

    const main = document.createElement('div');
    main.className = 'bento-cell bento-main';
    if (videoSrc){
      // ה-src נשמר בצד. הוא נכנס לאלמנט רק בלחיצה או אחרי הטעינה, ב-setupHeroSound.
      // הפוסטר הוא <img> ולא poster של הווידאו, כדי שהתמונה תהיה מועמדת ה-LCP.
      attachHeroVideo(main, videoSrc, poster);
      grid.appendChild(main);
    } else if (!galleryImages.length && window.NoPhoto && NoPhoto.on()){
      // v10 (סבב 4 חלק 3): התא הראשי מסביר שאין תמונות ומציע לבקש אותן מהמפרסם
      main.classList.add('bento-empty', 'np-host');
      const facts = [p.rooms ? p.rooms + ' חד׳' : '', p.size_sqm ? p.size_sqm + ' מ״ר' : '', p.floor != null && p.floor !== '' ? 'קומה ' + p.floor : ''].filter(Boolean).join(' · ');
      const where = [p.neighborhoods?.name || p.sales_area || '', p.city || ''].filter(Boolean).join(', ');
      main.innerHTML = NoPhoto.html(p, { agent: p.agency_members || null, agency: p.agencies || null, private: !p.agent_id && !agencyNameOf(p) }, 'hero', { facts, where, title: p.title || '' });
      main.addEventListener('click', (e)=>{
        const ask = e.target.closest('[data-np-cta]');
        if (!ask) return;
        if (window.shukTrack) shukTrack('photo_request', { property_id: p.id, level: ask.dataset.level || 'c', surface: 'hero' });
        openInquiry(true);
      });
      grid.appendChild(main);
    } else if (!galleryImages.length){
      main.classList.add('bento-empty');
      // לוגו המשרד שהנכס שייך אליו + הודעה שהתמונות בדרך, במקום מלבן צבעוני
      // ריק שנקרא כמו תמונה שבורה
      const name = agencyNameOf(p);
      const logo = agencyLogoOf(p) || (name ? '' : SITE_LOGO);
      main.innerHTML = `<div class="empty-inner">
          ${logo
            ? `<img class="empty-logo" src="${escapeAttr(logo)}" alt="${escapeAttr(name)}" onerror="this.remove()">`
            : `<span class="empty-logo empty-initial" aria-hidden="true">${escapeHtml(name.trim()[0] || '?')}</span>`}
          ${name ? `<div class="empty-agency">${escapeHtml(name)}</div>` : ''}
          <div class="empty-note">${NO_PHOTOS_NOTE}</div>
        </div>`;
      grid.appendChild(main);
    } else {
      grid.appendChild(makeCell('bento-main', 0, 0, true));
    }

    const restBuilt = galleryImages.length - thumbEnd;
    for (let i = thumbStart; i < thumbEnd; i++){
      // התמונה האחרונה שמוצגת נושאת את שאר התמונות: לחיצה עליה פותחת את
      // הלייטבוקס בתמונה הראשונה שלא נראית ברשת.
      const isLast = i === thumbEnd - 1;
      const cell = makeCell('bento-thumb', i, (isLast && restBuilt > 0) ? thumbEnd : i);
      if (isLast) cell.classList.add('carries-count');
      grid.appendChild(cell);
    }
  } else if (videoSrc){
    const main = elWithClass(grid, 'bento-main');
    if (main) attachHeroVideo(main, videoSrc, poster);
    let n = 0;
    const kids = grid.children || [];
    const restBuilt = galleryImages.length - thumbEnd;
    for (let i = 0; i < kids.length; i++){
      if (!kids[i].classList || !kids[i].classList.contains('bento-thumb')) continue;
      const index = thumbStart + n;
      const isLast = index === thumbEnd - 1;
      const opensAt = (isLast && restBuilt > 0) ? thumbEnd : index;
      kids[i].addEventListener('click', ()=> lbOpen(opensAt));
      n++;
    }
  } else {
    const main = elWithClass(grid, 'bento-main');
    if (main) main.addEventListener('click', ()=> lbOpen(0));
    let n = 0;
    const kids = grid.children || [];
    const restBuilt = galleryImages.length - thumbEnd;
    for (let i = 0; i < kids.length; i++){
      if (!kids[i].classList || !kids[i].classList.contains('bento-thumb')) continue;
      const index = thumbStart + n;
      const isLast = index === thumbEnd - 1;
      const opensAt = (isLast && restBuilt > 0) ? thumbEnd : index;
      kids[i].addEventListener('click', ()=> lbOpen(opensAt));
      n++;
    }
  }

  // התגיות המרחפות עוברות לתוך התא הראשי — כך הן תמיד על התמונה הגדולה
  const mainCell = grid.firstElementChild;
  ['heroBadges','heroTools','heroPrice','heroActions'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) mainCell.appendChild(el);
  });

  const rest = galleryImages.length - thumbEnd;
  // מונה התמונות יורד אל התמונה המשנית האחרונה במקום לשבת על הראשית: שם הוא
  // מפנה מקום לתמונה עצמה, והוא ממילא מדבר על כל הגלריה ולא על תמונת השער.
  const countHost = grid.querySelector('.bento-thumb.carries-count');
  const btn = document.getElementById('photoCountBtn');
  if (galleryImages.length > 1 && countHost){
    btn.innerHTML = `${ICON.image}<span>כל התמונות (${galleryImages.length})</span>`;
    btn.addEventListener('click', ()=> lbOpen(rest > 0 ? thumbEnd : 0));
    btn.hidden = false;
    countHost.appendChild(btn);
  } else {
    btn.hidden = true;
  }

  setupHeroSound();
}

/* ---------- מתג הקול של תמונת השער ----------
   הלחיצה הראשונה על התמונה מנגנת מושתק. אחר כך הלחיצה היא מתג הקול, כמו
   קודם. הכפתור מצייר את עצמו מ-‎volumechange‎ ולא מהלחיצה, כדי שגם השתקה
   שנעשתה במקום אחר (התחלת הנגן שבהמשך העמוד) תשתקף בו.

   ה-src לא נקבע כאן בזמן הרינדור. אחרי שהחלון נטען: requestIdleCallback
   (תקרה של 4 שניות), ובלי זה setTimeout של 2 שניות. זה רק מכניס את הכתובת.
   preload=none נשאר, והקובץ יורד כשמנגנים.                              */
function setupHeroSound(){
  const btn = document.getElementById('heroSoundBtn');
  if (!btn) return;
  if (!heroVideoEl){ btn.hidden = true; return; }
  const video = heroVideoEl;
  const pending = video.dataset.pendingSrc || '';
  let started = false;

  const ensureSrc = ()=>{
    if (pending && !video.getAttribute('src')) video.src = pending;
  };
  const paint = ()=>{
    if (!started){
      btn.innerHTML = ICON.play;
      btn.setAttribute('aria-label', 'ניגון הסרטון');
      btn.setAttribute('aria-pressed', 'false');
      btn.title = 'ניגון';
      return;
    }
    btn.innerHTML = video.muted ? ICON.soundOff : ICON.soundOn;
    btn.setAttribute('aria-label', video.muted ? 'השמעת הקול של הסרטון' : 'השתקת הסרטון');
    btn.setAttribute('aria-pressed', String(!video.muted));
    btn.title = video.muted ? 'השמעת הקול' : 'השתקה';
  };
  const begin = ()=>{
    if (started) return;
    ensureSrc();
    started = true;
    video.muted = true;
    video.setAttribute('aria-label', 'סרטון הנכס - מנגן מושתק');
    paint();
    const played = video.play();
    if (played && played.catch) played.catch(()=>{ video.controls = true; video.style.visibility = ''; });
  };

  const toggle = ()=>{
    ensureSrc();
    started = true;
    video.muted = !video.muted;
    // ביטול השתקה על סרטון שנעצר הוא בקשה לנגן אותו, לא רק להוסיף לו קול
    if (!video.muted){
      if (panelVideoEl) panelVideoEl.pause();
      video.play().catch(()=>{});
    }
    paint();
  };
  // לחיצה ראשונה (כפתור, תמונה או סרטון): ניגון מושתק. אחר כך מתג הקול.
  // הכפתור נשאר כי הקשה על ‎<video>‎ אינה נגישה למקלדת ולקורא מסך.
  const onSurface = ()=>{ if (!started) begin(); else toggle(); };
  btn.addEventListener('click', onSurface);
  video.addEventListener('click', onSurface);
  const shot = video.parentElement && video.parentElement.querySelector('img[data-lcp]');
  if (shot) shot.addEventListener('click', onSurface);
  video.addEventListener('volumechange', paint);
  paint();
  btn.hidden = false;

  const arm = ()=> ensureSrc();
  const schedule = ()=>{
    if (window.requestIdleCallback) window.requestIdleCallback(arm, { timeout: 4000 });
    else setTimeout(arm, 2000);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

  /* סרטון שממשיך לרוץ אחרי שגללו ממנו הוא סוללה וגלישה שנשרפות על משהו
     שאיש לא רואה. רק אחרי שהניגון התחיל, ורק כשהוא מושתק. בלי זה הגלריה
     הייתה מנגנת מעצמה ברגע שהשער נראה. */
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver((entries)=>{
    for (const entry of entries){
      if (!started || !video.muted) continue;
      if (entry.isIntersecting) video.play().catch(()=>{});
      else video.pause();
    }
  }, { threshold: 0.15 }).observe(video);
}

/* ---------- סיור וירטואלי וסרטון ----------
   ‏tour_3d_url נשארת כפתור שנפתח בלשונית חדשה: לכל ספק סיור יש נגן משלו,
   ואין דרך אחת להטמיע את כולם.

   ‏video_url לעומתה מגיעה משני מקורות — קובץ שהועלה מה-CRM לדלי
   ‎property-videos‎, או קישור חיצוני שהודבק. את שניהם אפשר לנגן בעמוד עצמו:
   קובץ מדיה מקבל ‎<video>‎, ויוטיוב/וימאו מקבלים iframe אל דומיין הנגן שלהם.
   כתובת שאינה אחד מאלה נשארת כפתור חיצוני — ‏iframe לכתובת שרירותית הוא
   בקשה לצרות. אין כתובת = אין כפתור: כפתור נגן שלא מנגן כלום גרוע מהיעדרו. */
function videoEmbed(raw){
  if (!raw) return null;
  let u;
  try{ u = new URL(raw); } catch(e){ return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'youtu.be'){
    const id = u.pathname.slice(1);
    return id ? { type:'iframe', src:'https://www.youtube.com/embed/' + encodeURIComponent(id) } : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com'){
    const id = u.searchParams.get('v') || u.pathname.match(/\/(?:embed|shorts|v)\/([^/?#]+)/)?.[1];
    return id ? { type:'iframe', src:'https://www.youtube.com/embed/' + encodeURIComponent(id) } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com'){
    const id = u.pathname.match(/(\d+)/)?.[1];
    return id ? { type:'iframe', src:'https://player.vimeo.com/video/' + encodeURIComponent(id) } : null;
  }
  // ‏mov נכלל כי זה מה שאייפון מוסר, ו-CRM מעלה אותו כמו שהוא
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(u.pathname)) return { type:'video', src:u.href };
  return null;
}

// הנגן המלא שבהמשך העמוד, כשהוא קובץ מדיה. נשמר כדי לתאם בינו לבין תמונת
// השער: אותו סרטון בשני מקומות בעמוד אחד, ואם שניהם משמיעים קול הצופה שומע
// את אותו סיור פעמיים בהפרש של כמה שניות.
let panelVideoEl = null;

// רילס בתבנית D (1080x1920) - הקבצים שהמערכת שומרת בשם ‎marketing-reel-…‎.
function isReelVideo(src){
  return /\/marketing-reel-[^/?#]*\.mp4(?:[?#]|$)/i.test(String(src || ''));
}

function renderVideoPanel(embed, poster){
  const frame = document.getElementById('videoFrame');
  frame.innerHTML = embed.type === 'iframe'
    ? `<iframe src="${escapeAttr(embed.src)}" title="סרטון הנכס" loading="lazy" ` +
      `allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
    : `<video src="${escapeAttr(embed.src)}" controls preload="metadata" playsinline` +
      `${poster ? ` poster="${escapeAttr(poster)}"` : ''}></video>`;
  panelVideoEl = frame.querySelector('video');
  frame.classList.toggle('is-portrait', embed.type === 'video' && isReelVideo(embed.src));
  if (panelVideoEl) panelVideoEl.addEventListener('loadedmetadata', ()=>{
    if (panelVideoEl.videoHeight > panelVideoEl.videoWidth) frame.classList.add('is-portrait');
  });
  // מי שלחץ/ה נגן כאן ביקש/ה לצפות כאן. תמונת השער חוזרת להיות מושתקת,
  // וה-‏IntersectionObserver שלה ממילא יעצור אותה ברגע שיגללו לכאן.
  if (panelVideoEl) panelVideoEl.addEventListener('play', ()=>{
    if (heroVideoEl) heroVideoEl.muted = true;
  });
  document.getElementById('videoSection').hidden = false;
}

function renderMediaButtons(p){
  const link = (id, url, icon, label)=>{
    if (!url) return;
    const el = document.getElementById(id);
    el.href = url;
    el.innerHTML = `${icon}<span>${label}</span>`;
    el.hidden = false;
  };
  link('tourBtn', p.tour_3d_url, ICON.cube, 'סיור וירטואלי');

  const embed = videoEmbed(p.video_url);
  if (!embed){ link('videoBtn', p.video_url, ICON.play, 'סרטון הנכס'); return; }

  /* הסרטון יושב בתמונה הראשית (גם לפני שלחצו לנגן) — נגן שני של אותו קובץ
     בהמשך העמוד היה מוריד אותו פעמיים, וכפתור שמוביל אליו הוא קיצור דרך
     למקום שהצופה כבר נמצא בו. שניהם יורדים.

     הסקציה נשארת בקוד ולא נמחקה, כי היא עדיין המסלול היחיד בכל מקרה
     שבו השער ויתר על הסרטון: יוטיוב ווימאו (שלא נכנסים לשער כ-iframe),
     ‏reduced-motion, ‏Save-Data וחיבור 2G. */
  if (heroVideoEl) return;

  // כשהסרטון מנוגן בעמוד, הכפתור בהירו הוא קיצור דרך אליו ולא יציאה מהעמוד
  renderVideoPanel(embed, p.video_poster_url || null);
  const btn = document.getElementById('videoBtn');
  btn.href = '#videoSection';
  btn.removeAttribute('target');
  btn.removeAttribute('rel');
  btn.innerHTML = `${ICON.play}<span>סרטון הנכס</span>`;
  btn.hidden = false;
  btn.addEventListener('click', (e)=>{
    e.preventDefault();
    document.getElementById('videoSection').scrollIntoView({ behavior:'smooth', block:'start' });
  });
}

/* ---------- הסיור 360° של הנכס ----------
   הסיור העצמאי (‏property_virtual_tours): פנורמות שהסוכן/ת העלה/תה ב-CRM,
   ונקודות מעבר שמחברות ביניהן. הוא מתנגן כאן בעמוד, בניגוד ל-‎tour_3d_url‎
   שנשאר כפתור אל אתר הספק.

   שלוש החלטות:

   **טעינה בלחיצה ולא אוטומטית** (‏autoLoad:false). פנורמה אחת שוקלת 1-3MB,
   ורוב הגולשים לא יגיעו לסקציה הזו בכלל. ‏Pannellum מציגה במקומה תמונת
   רקע (‏preview — התמונה הראשית של הנכס) וכפתור הפעלה, והבייטים יורדים רק
   ממי שביקש/ה. זה גם מה שמונע מהנגן לחטוף את מחוות הגלילה בטלפון לפני
   שהחליטו להיכנס אליו.

   **מה שמגיע מהמסד עובר סינון לפני שהוא מגיע לנגן.** ‏scenes הוא JSON
   שנכתב מהדפדפן של הסוכן/ת, ולכן הוא נתון ולא קוד: כל כתובת פנורמה חייבת
   להיות קובץ בדלי ‎property-tours‎ שלנו (כתובת שרירותית כאן הייתה מטעינה
   תמונה מאתר זר לתוך העמוד), כל מספר חייב להיות בטווח, וכל ‎sceneId‎ של
   נקודת מעבר חייב להצביע על חלל שקיים — אחרת הנגן זורק שגיאה והסיור כולו
   נעצר על מעבר אחד שבור.

   **‏Pannellum נטענת רק כשיש סיור.** הבדיקה הזולה היא ‎has_virtual_tour‎
   שכבר הגיעה עם הנכס; רק אם היא דולקת נשלחת השאילתה, ורק אם חזר ממנה
   חלל תקין אחד נטענת הספרייה מה-CDN.                                      */
const TOUR_PUBLIC_PREFIX = SUPABASE_URL + '/storage/v1/object/public/property-tours/';
const PANNELLUM_CSS_URLS = [
  'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css',
  'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.min.css',
];
const PANNELLUM_JS_URLS = [
  'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pannellum/2.5.6/pannellum.min.js',
];

let pannellumPromise = null;
function loadPannellum(){
  if (window.pannellum) return Promise.resolve(window.pannellum);
  if (pannellumPromise) return pannellumPromise;
  pannellumPromise = new Promise((resolve, reject)=>{
    // ה-CSS אינו חוסם: בלעדיו הנגן עדיין מנגן, רק הפקדים שלו עירומים
    (function cssNext(i){
      if (i >= PANNELLUM_CSS_URLS.length) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PANNELLUM_CSS_URLS[i];
      link.onerror = ()=>{ link.remove(); cssNext(i + 1); };
      document.head.appendChild(link);
    })(0);

    (function jsNext(i){
      if (i >= PANNELLUM_JS_URLS.length){
        pannellumPromise = null;
        reject(new Error('pannellum load failed'));
        return;
      }
      const s = document.createElement('script');
      s.src = PANNELLUM_JS_URLS[i];
      s.onload = ()=> window.pannellum ? resolve(window.pannellum) : jsNext(i + 1);
      s.onerror = ()=>{ s.remove(); jsNext(i + 1); };
      document.head.appendChild(s);
    })(0);
  });
  return pannellumPromise;
}

function tourSafeText(raw, max){
  return String(raw == null ? '' : raw).replace(/[<>]/g, '').trim().slice(0, max);
}
function tourSafeNum(value, min, max, fallback){
  const n = Number(value);
  return (Number.isFinite(n) && n >= min && n <= max) ? n : fallback;
}

/* מחזירה מערך חללים מסודר ונקי, או מערך ריק כשאין מה להציג. ‎order‎ הוא
   שומר הסדר — ‏jsonb ממיין מפתחות מחדש, ולכן סדר החדרים אינו סדר המפתחות. */
function sanitizeTourScenes(raw){
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const scenes = Object.keys(raw)
    .filter(id => /^[\w-]{1,64}$/.test(id))
    .map((id, i)=>{
      const s = raw[id] || {};
      return {
        id,
        order: Number.isFinite(s.order) ? s.order : i,
        title: tourSafeText(s.title, 60) || 'חלל',
        panorama: String(s.panorama || ''),
        pitch: tourSafeNum(s.pitch, -90, 90, 0),
        yaw:   tourSafeNum(s.yaw, -360, 360, 0),
        hfov:  tourSafeNum(s.hfov, 50, 120, 110),
        hotSpots: Array.isArray(s.hotSpots) ? s.hotSpots.slice(0, 20) : [],
      };
    })
    // הגבול היחיד שאינו טכני: פנורמה היא קובץ שהועלה אלינו, ולא כתובת כלשהי
    .filter(s => s.panorama.startsWith(TOUR_PUBLIC_PREFIX))
    .sort((a, b) => a.order - b.order)
    .slice(0, 20);

  const known = new Set(scenes.map(s => s.id));
  scenes.forEach(s=>{
    s.hotSpots = s.hotSpots.map(h => ({
      pitch: tourSafeNum(h && h.pitch, -90, 90, null),
      yaw:   tourSafeNum(h && h.yaw, -360, 360, null),
      targetYaw: tourSafeNum(h && h.targetYaw, -360, 360, null),
      text:  tourSafeText(h && h.text, 60) || 'מעבר',
      sceneId: String((h && h.sceneId) || ''),
    })).filter(h => h.pitch !== null && h.yaw !== null && h.sceneId !== s.id && known.has(h.sceneId));
  });
  return scenes;
}

async function loadVirtualTour(p){
  if (!window.supabase) return;
  try{
    const sb = sbClient();
    const { data, error } = await sb
      .from('property_virtual_tours')
      .select('initial_scene, scenes')
      .eq('property_id', p.id)
      .maybeSingle();
    if (error || !data) return;

    const scenes = sanitizeTourScenes(data.scenes);
    if (!scenes.length) return;

    await loadPannellum();

    const firstScene = scenes.some(s => s.id === data.initial_scene) ? data.initial_scene : scenes[0].id;
    const preview = (Array.isArray(p.images) ? p.images.filter(Boolean)[0] : null) || null;

    const cfg = {
      default: {
        firstScene,
        autoLoad: false,
        showControls: true,
        sceneFadeDuration: 400,
        // ברירת המחדל של הספרייה אנגלית, והעמוד הזה עברי
        strings: {
          loadButtonLabel: 'לחצו להתחלת הסיור',
          loadingLabel: 'טוען…',
          bylineLabel: '',
          noPanoramaError: 'לא נמצאה תמונת פנורמה',
          fileAccessError: 'לא ניתן לטעון את התמונה',
          malformedURLError: 'כתובת התמונה שגויה',
          genericWebGLError: 'הדפדפן הזה לא תומך בהצגת סיור 360°',
          textureSizeError: 'התמונה גדולה מדי למכשיר הזה',
          unknownError: 'שגיאה בטעינת הסיור',
        },
      },
      scenes: {},
    };

    scenes.forEach(s=>{
      cfg.scenes[s.id] = {
        title: s.title,
        type: 'equirectangular',
        panorama: s.panorama,
        pitch: s.pitch, yaw: s.yaw, hfov: s.hfov,
        hotSpots: s.hotSpots.map(h=>{
          const hs = { pitch:h.pitch, yaw:h.yaw, type:'scene', text:h.text, sceneId:h.sceneId };
          if (h.targetYaw !== null) hs.targetYaw = h.targetYaw;
          return hs;
        }),
      };
      // תמונת הרקע שמאחורי כפתור ההפעלה. רק בחלל הפתיחה: זה החלל היחיד
      // שנראה לפני שהסיור התחיל, ובשאר החללים היא הייתה תמונה של חדר אחר.
      if (s.id === firstScene && preview) cfg.scenes[s.id].preview = preview;
    });

    document.getElementById('tourNote').textContent = scenes.length > 1
      ? `${scenes.length} חללים · גוררים כדי להסתכל מסביב, ולוחצים על החצים כדי לעבור ביניהם`
      : 'גוררים כדי להסתכל מסביב · אפשר להגדיל למסך מלא';
    // הסקציה נפתחת **לפני** יצירת הנגן: ‏Pannellum מודדת את המיכל שלה
    // ברגע האתחול, ומיכל שיושב בתוך ‎display:none‎ נמדד 0×0 ולא מתאושש
    // מזה כשהוא נחשף אחר כך.
    document.getElementById('tourSection').hidden = false;
    pannellum.viewer('tourViewer', cfg);
    revealTourJumpButton();
  } catch(e){
    console.warn('טעינת הסיור נכשלה:', e);
  }
}

// אותו דפוס של כפתור ההדמיות: הוא רק מוביל לסקציה שכבר קיימת בעמוד
function revealTourJumpButton(){
  const btn = document.getElementById('tour360Btn');
  if (!btn || !btn.hidden) return;
  btn.innerHTML = `${ICON.pano}<span>סיור 360°</span>`;
  btn.addEventListener('click', ()=>{
    const section = document.getElementById('tourSection');
    if (!section || section.hidden) return;
    section.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  btn.hidden = false;
}

/* ---------- קיצור הדרך להדמיות ----------
   שלט על התמונה הראשית ולא הכלי עצמו: כלי שצף על תמונת הנכס מכסה את מה
   שבאו לראות. הכפתור רק מוביל לסקציה, בלחיצה אחת ובלי לחפש אותה.
   נדלק רק אחרי ש-loadVisualizations אישרה שיש מה להראות.

   **הוא אומר מה יקרה, ולא איך קוראים לכלי.** "הדמיית AI לנכס" היה שם של
   פיצ'ר; מי שלא ידע/ה מה זה לא הבין/ה שהלחיצה מראה את *הבית הזה* אחרי
   שיפוץ, ולכן הגיע/ה לווילון רק אם גלל/ה עד אליו. עכשיו הכותרת היא
   ההבטחה, והשורה שמתחתיה אומרת שזו הדמיה, לא צילום.

   ‏**ושתי תמונונות - לפני ואחרי - כשיש.** הן מסבירות בשנייה מה שהטקסט
   מסביר בשורה, והן לקוחות מהנכס עצמו: מקור ותוצאה של אותה הדמיה, באותו
   סגנון שהווילון ייפתח עליו. נכס שעוד אין לו הדמיה מקבל את השלט בלי
   תמונונות - אין תמונה אמיתית להראות, ותמונה של נכס אחר הייתה מטעה. */
/* שתי השורות נקראות כמשפט אחד: "לחצו וראו איך הבית יכול להיראות / בהדמיית
   עיצוב AI לפני ואחרי". "עיצוב" ולא "שיפוץ" גם במכירה - הוא נכון גם להשכרה,
   שבה ההדמיה היא הלבשת בית ולא שיפוץ, ולכן נוסח אחד לשתיהן. */
function vizJumpCopy(){
  // במסחרי ובהשכרה שורה אחת בלבד: המחיר שם ארוך ("/ חודש"), הכרטיס יורד
  // לשורה משלו, וכל מילה נוספת כיסתה עוד רצועה מהתמונה של החנות. הווילון
  // שליד הטקסט כבר מראה מה זה.
  if (!vizState.isPrivate || vizState.staging) return { title:'הדמיית לפני ואחרי', sub:'' };
  return { title:'לחצו וראו איך הבית יכול להיראות', sub:'בהדמיית עיצוב AI לפני ואחרי' };
}

/* זוג לפני/אחרי לתמונונות: מהסגנון שהווילון פתוח עליו, ובו החזית קודם -
   היא מה שרואים בתמונה הראשית, ולכן ההשוואה נקראת בלי הסבר. */
function vizJumpPair(){
  const pools = [vizState.byStyle.get(vizState.current) || []];
  vizState.byStyle.forEach(list=> pools.push(list || []));
  const rank = t => (t === 'exterior' ? 0 : 1);
  for (const list of pools){
    const ok = list.filter(it=> it && it.source_image_url && it.result_url);
    if (ok.length) return ok.slice().sort((a, b)=> rank(a.target) - rank(b.target))[0];
  }
  return null;
}

/* במובייל הכרטיס צר והטקסט נשבר. הזנב שמועבר כאן נשאר בשורה אחת: בכותרת
   המילה האחרונה, ובשורת המשנה "לפני ואחרי" - "לפני" בסוף שורה ו"ואחרי"
   בתחילת הבאה קוראים כשתי מילים נפרדות ולא כצמד. */
function vjKeepTail(text, after, n = 1){
  const words = String(text).split(' ');
  const tail = words.splice(-n).join(' ');
  // ‏"AI" נצמד למילה שלפניו (רווח לא-שביר): שורה שמתחילה ב-"AI" לבד נקראת כשבר
  const head = words.length ? escapeHtml(words.join(' ').replace(/ AI$/, '\u00a0AI')) + ' ' : '';
  return `${head}<span class="vj-nw">${escapeHtml(tail)}${after}</span>`;
}

function renderVizJumpButton(){
  const btn = document.getElementById('vizJumpBtn');
  if (!btn || btn.hidden) return;
  const { title, sub } = vizJumpCopy();
  const pair = vizJumpPair();
  const key = pair ? pair.source_image_url + '|' + pair.result_url : '';
  if (btn.dataset.rendered === title + '|' + key) return;
  btn.dataset.rendered = title + '|' + key;
  /* וילון ולא שתי תמונונות זו לצד זו: אותה מסגרת, הצילום מתחת וההדמיה
     מעליו, וידית זהב שעוברת ביניהם הלוך ושוב. זו אותה מחווה כמו הווילון
     שבתיבה עצמה, ולכן הכרטיס מראה בקטן בדיוק את מה שהלחיצה פותחת. */
  /* ‏viz-speed: התמונונות מוקטנות (‏render/image, רוחב 240) - קודם ירדו כאן שני
     קובצי ה-JPEG המלאים (כ-640KB כל אחד) בכל טעינה של נכס עם הדמיה. */
  const thumbs = pair
    ? `<span class="vj-thumbs vj-curtain" aria-hidden="true">
         <img class="vj-before" src="${escapeAttr(cardImgUrl(pair.source_image_url, 240))}" data-full="${escapeAttr(pair.source_image_url)}" onerror="this.onerror=null;this.src=this.getAttribute('data-full')" alt="" loading="lazy" decoding="async">
         <img class="vj-after" src="${escapeAttr(cardImgUrl(pair.result_url, 240))}" data-full="${escapeAttr(pair.result_url)}" onerror="this.onerror=null;this.src=this.getAttribute('data-full')" alt="" loading="lazy" decoding="async">
         <span class="vj-handle"><span class="vj-knob"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6-6 6 6 6M15 6l6 6-6 6"/></svg></span></span>
       </span>`
    : '';
  btn.classList.toggle('has-thumbs', !!pair);
  btn.classList.toggle('vj-one-line', !sub);
  btn.setAttribute('aria-label', sub ? `${title} - ${sub}` : title);
  btn.innerHTML = `
    <span class="vj-text">
      <span class="vj-title">${ICON.sparkle} ${sub ? vjKeepTail(title, '') : `<span class="vj-nw">${escapeHtml(title)}</span>`}</span>
      ${sub ? `<span class="vj-sub">${vjKeepTail(sub, '', 2)}</span>` : ''}
    </span>${thumbs}`;
}

/* רוחב תגית המחיר, אל ‎--price-w‎ על התא הראשי. במובייל הכרטיס יושב לצדה
   באותה שורה ומקבל את שאר הרוחב, ורוחב המחיר תלוי בסכום ובשורת המ"ר. */
/* ‏**וכשהמחיר ארוך מדי - הכרטיס עובר לשורה משלו.** מחיר של שכירות מסחרית
   ("2,966 ₪ / חודש + מע"מ") השאיר לכרטיס פחות מ-120px בטלפון, והכותרת נשברה
   לחמש שורות. כשהמקום שנשאר קטן מהווילון ועוד עמודת טקסט מינימלית, הכרטיס
   מקבל את כל הרוחב (‏.vj-stack), והמחיר עולה מעליו בגובה הכרטיס שנמדד
   (‏--vj-h). עמודת הטקסט המינימלית שונה בין טלפון למחשב, כי הגופן שונה:
   ‏80px הם כותרת בשלוש שורות בטלפון, ו-180px בשתיים במחשב. */
// בשורה אחת (‏.vj-one-line) הכותרת לא נשברת בכלל, ולכן העמודה צריכה את כל רוחבה
const vjTextMin = (btn)=> btn.classList.contains('vj-one-line')
  ? (window.innerWidth >= 640 ? 180 : 130)
  : (window.innerWidth >= 640 ? 180 : 80);
function watchHeroPriceWidth(){
  const price = document.getElementById('heroPrice');
  const btn = document.getElementById('vizJumpBtn');
  const cell = price && price.parentElement;
  if (!cell || !btn || !window.ResizeObserver || price.dataset.watched) return;
  price.dataset.watched = '1';
  const sync = ()=>{
    const pw = price.hidden ? 0 : price.offsetWidth;
    cell.style.setProperty('--price-w', pw + 'px');
    const curtain = btn.querySelector('.vj-curtain');
    const need = (curtain ? curtain.offsetWidth : 0) + vjTextMin(btn) + 30;
    cell.classList.toggle('vj-stack', !!pw && cell.clientWidth - pw - 40 < need);
    cell.style.setProperty('--vj-h', btn.offsetHeight + 'px');
  };
  const ro = new ResizeObserver(sync);
  ro.observe(price); ro.observe(cell); ro.observe(btn);
  sync();
}

function revealVizJumpButton(){
  const btn = document.getElementById('vizJumpBtn');
  if (!btn || !btn.hidden) return;
  btn.addEventListener('click', ()=>{
    // ישר לווילון עצמו, לא לראש הסקציה
    const target = document.getElementById('aiShowcase') || document.getElementById('vizSection');
    const section = document.getElementById('vizSection');
    if (!target || !section || section.hidden) return;
    /* ‏preview עונה על השאלה שבשבילה נוספו התמונונות: האם הן מגדילות את
       הלחיצות. ‏item_id מגיע ממילא מ-pageContext() ב-events.js. */
    if (window.shukTrack) shukTrack('viz_jump_click', {
      preview: btn.classList.contains('has-thumbs') ? 'thumbs' : 'text',
      viz_mode: !vizState.isPrivate ? 'commercial' : (vizState.staging ? 'staging' : 'renovation'),
    });
    target.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  btn.hidden = false;
  watchHeroPriceWidth();
  renderVizJumpButton();
}

const lb = document.getElementById('lightbox');
let lbIndex = 0;

function lbRender(){
  document.getElementById('lbImage').src = galleryImages[lbIndex] || '';
  document.getElementById('lbCount').textContent = `${lbIndex+1} / ${galleryImages.length}`;
  const strip = document.getElementById('lbStrip');
  strip.querySelectorAll('button').forEach((b, i)=> b.classList.toggle('active', i === lbIndex));
  const active = strip.children[lbIndex];
  if (active) active.scrollIntoView({ block:'nearest', inline:'center', behavior:'smooth' });
}
function lbOpen(index){
  if (!galleryImages.length) return;
  lbIndex = Math.min(Math.max(index, 0), galleryImages.length - 1);
  const strip = document.getElementById('lbStrip');
  if (strip.children.length !== galleryImages.length){
    strip.innerHTML = '';
    galleryImages.forEach((url, i)=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `מעבר לתמונה ${i+1}`);
      b.innerHTML = `<img src="${escapeAttr(url)}" alt="" loading="lazy">`;
      b.addEventListener('click', ()=>{ lbIndex = i; lbRender(); });
      strip.appendChild(b);
    });
  }
  const single = galleryImages.length < 2;
  document.getElementById('lbPrev').hidden = single;
  document.getElementById('lbNext').hidden = single;
  strip.hidden = single;
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
  lbRender();
  document.getElementById('lbClose').focus();
}
function lbClose(){ lb.classList.remove('open'); document.body.style.overflow = ''; }
function lbStep(delta){
  if (!galleryImages.length) return;
  lbIndex = (lbIndex + delta + galleryImages.length) % galleryImages.length;
  lbRender();
}
document.getElementById('lbClose').addEventListener('click', lbClose);
document.getElementById('lbPrev').addEventListener('click', ()=> lbStep(-1));
document.getElementById('lbNext').addEventListener('click', ()=> lbStep(1));
lb.addEventListener('click', (e)=>{ if (e.target === lb || e.target.classList.contains('lb-stage')) lbClose(); });
document.addEventListener('keydown', (e)=>{
  if (!lb.classList.contains('open')) return;
  if (e.key === 'Escape') lbClose();
  // ב-RTL החץ הימני הוא "הקודם" מבחינת סדר הקריאה
  if (e.key === 'ArrowRight') lbStep(-1);
  if (e.key === 'ArrowLeft') lbStep(1);
});

/* ---------- מפת הנכס ----------
   סקציית "מיקום וסביבה" היא יכולת של מסלול בתשלום, ולא כל נכס מקבל אותה:

   ‏1. ‏מסלול — Mid ופרימיום בלבד.
   ‏2. ‏כתובת מדויקת — נכס שנרשם עם עיר בלבד מקבל מהגאוקודינג את מרכז העיר,
      ופין על מרכז עפולה במודעה שכתובתה "עפולה" הוא מידע שנראה מדויק ואינו
      כזה.

   שני התנאים נבדקים ב-property_map_enabled ב-DB ולא כאן, כדי שיהיה מקור אמת
   יחיד לכללי המסלולים — בדיוק כמו ההדמיות. הצד הזה רק שואל, ואם התשובה
   שלילית (או שהמפה לא עלתה) הסקציה פשוט לא מוצגת: אין תווית "שדרגו כדי
   לראות", כי חסם כזה מוצג לגולש/ת שלא אשמ/ה בו.

   שני מופעי Leaflet נפרדים: המוטמע נוצר עם טעינת הנכס, ומופע המסך המלא נוצר
   בפתיחה הראשונה בלבד. אי אפשר להזיז קונטיינר של מפה בין שני מקומות ב-DOM
   בלי לאתחל אותה מחדש, ושכפול פשוט יותר מלנהל העברה.                     */

/* ספק האריחים יושב ב-assets/map-tiles.js, משותף לכל המפות באתר. */
const PROP_MAP_ZOOM = 16;
const PROP_MAP_FULL_ZOOM = 17;
// עיגול של עד ק"מ צריך להיכנס כולו למסגרת של 230px
const PROP_MAP_APPROX_ZOOM = 14;

let propMapReady = false;      // המפה המוטמעת עלתה — כלומר הנכס זכאי
let propMapFull = null;        // מופע המסך המלא, נוצר בפתיחה הראשונה

/* מיקום משוער (אזור תעשייה, חלקה גדולה): עיגול על האזור ולא נקודה - פין
   על נקודה אקראית נראה מדויק ואינו. docs/property-map.md, "מיקום משוער". */
function propMapApprox(p){
  return !!(window.ApproxLocation && ApproxLocation.isApprox(p));
}
function propMapMarker(p){
  if (propMapApprox(p)){
    return L.circle([p.lat, p.lng], {
      radius: ApproxLocation.radius(p),
      color: '#b8902f', weight: 2, dashArray: '6 6',
      fillColor: '#b8902f', fillOpacity: .15,
      interactive: false,
    });
  }
  return L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className:'', html:'<div class="map-marker"></div>', iconSize:[0,0] }),
    keyboard: false,
  });
}
function propMapTiles(map){
  MapTiles.addTo(map);
}

async function propertyMapEnabled(id){
  try{
    const sb = sbClient();
    const { data, error } = await sb.rpc('property_map_enabled', { p_property_id: id });
    if (error) throw error;
    return data === true;
  } catch(e){
    // ה-RPC עדיין לא הותקן, או שהקריאה נכשלה — נופלים לצד הבטוח ולא מציגים
    console.warn('בדיקת הזכאות למפת הנכס נכשלה:', e);
    return false;
  }
}

async function initPropertyMap(p, addressText){
  const section = document.getElementById('mapSection');
  // ‏Leaflet חסום/נכשל, או שאין קואורדינטות — אין מה להציג
  if (!window.L || !window.supabase || !p.lat || !p.lng) return;
  if (!await propertyMapEnabled(p.id)) return;

  // חשיפת הסקציה לפני יצירת המפה: Leaflet מודד את גודל הקונטיינר ברגע
  // היצירה, ובתוך section[hidden] הוא היה מקבל 0×0 ומצייר אריחים אפורים
  section.hidden = false;
  try{
    const approx = propMapApprox(p);
    const map = L.map('propMap', { scrollWheelZoom:false, zoomControl:false })
      .setView([p.lat, p.lng], approx ? PROP_MAP_APPROX_ZOOM : PROP_MAP_ZOOM);
    propMapTiles(map);
    propMapMarker(p).addTo(map);
    /* מחוות משתפות פעולה בשתי דרכי הקלט. המפה יושבת באמצע דף ארוך, ובלעדיהן
       אצבע שנחתה עליה בדרך לפרטי הנכס הזיזה את המפה במקום להמשיך לגלול.
       ‏MapGestures משאיר את הגלילה לדף — אצבע אחת וגלגלת לבדה — ומחזיר את
       המפה בשתי אצבעות או ב-Ctrl/⌘ + גלגלת. במסך המלא (propMapFull) לא
       קוראים לזה בכוונה: שם אין דף מתחת לגלול, והמפה היא כל המסך. */
    if (window.MapGestures) MapGestures.apply(map);

    document.getElementById('mapFullTitle').textContent = addressText || p.title || '';
    const note = document.getElementById('mapNote');
    if (approx){
      /* בלי קישורי ניווט: Waze לנקודה אקראית שולח גולש/ת למקום שאין בו
         כלום. במקומם - הבועית שאומרת שהמיקום מוערך. */
      const actions = document.querySelector('.map-full-actions');
      if (actions) actions.hidden = true;
      note.innerHTML = (addressText ? escapeHtml(addressText) + ' ' : '') + ApproxLocation.badgeHtml(p);
    } else {
      const google = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
      const waze = `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;
      const dir = document.getElementById('mapDirections');
      dir.href = google;
      dir.hidden = false;
      document.getElementById('mapFullGoogle').href = google;
      document.getElementById('mapFullWaze').href = waze;
      note.textContent = addressText || '';
    }
    propMapReady = true;
  } catch(e){
    console.warn('מפת הנכס לא נטענה:', e);
    section.hidden = true;
  }
}

function mapFullOpen(){
  const p = currentProperty;
  if (!propMapReady || !p) return;
  const overlay = document.getElementById('mapFull');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (!propMapFull){
    propMapFull = L.map('propMapFull').setView([p.lat, p.lng], propMapApprox(p) ? PROP_MAP_APPROX_ZOOM : PROP_MAP_FULL_ZOOM);
    propMapTiles(propMapFull);
    propMapMarker(p).addTo(propMapFull);
  }
  // הקונטיינר היה display:none עד לפני רגע, ולכן המידות שנמדדו בו (בפתיחה
  // הראשונה) או שנשמרו מפתיחה קודמת אינן נכונות
  propMapFull.invalidateSize();
  propMapFull.setView([p.lat, p.lng], propMapApprox(p) ? PROP_MAP_APPROX_ZOOM : PROP_MAP_FULL_ZOOM);
  document.getElementById('mapFullClose').focus();
}
function mapFullClose(){
  document.getElementById('mapFull').classList.remove('open');
  document.body.style.overflow = '';
  const btn = document.getElementById('mapExpandBtn');
  if (btn) btn.focus();
}
document.getElementById('mapExpandBtn').addEventListener('click', mapFullOpen);
document.getElementById('mapFullClose').addEventListener('click', mapFullClose);
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' && document.getElementById('mapFull').classList.contains('open')) mapFullClose();
});

/* ---------- מידע תכנוני (לכל נכס), וקרקע: בלי הדמיה ----------
   סוג הנכס גובר על ה-category, בדיוק כמו בגזירת תחומי ההתמחות
   (assets/specialties.js): מגרש שסומן "מסחרי" הוא עדיין קרקע, ומגרש שסומן
   "מגורים" הוא עדיין לא דירה. הביטוי כאן הוא עותק של TYPE_RULES שם, וכמו
   שאר האוצרות בשלושת הקבצים הסטטיים — הסנכרון ידני.

   מה שהסקציה מציגה מגיע כולו מ-property_planning_public, ‏RPC שכבר מסנן
   בעצמו גוש, חלקה, שטח חלקה וקואורדינטות. הצד הזה לא מחזיק רשימת שדות
   אסורים משלו, כי שתי רשימות כאלה נפרדות תמיד מתפצלות בסוף.               */
const LAND_TYPE_RE = /מגרש|קרקע|נחל|משק|חקלא/;

function isLandProperty(p){
  return LAND_TYPE_RE.test(p?.property_type || '');
}

async function loadPlanningInfo(p){
  if (!window.supabase) return;
  try{
    const sb = sbClient();
    const { data, error } = await sb.rpc('property_planning_public', { p_property_id: p.id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row) renderPlanningInfo(row, isLandProperty(p));
  } catch(e){
    console.warn('טעינת מידע תכנוני נכשלה:', e);
  }
}

function renderPlanningInfo(row, isLandRow){
  const num = v => Number(v).toLocaleString('he-IL');
  // שטח המגרש עצמו לא חוזר כאן — הוא כבר קפסולה בסרגל הנתונים שמעל.
  const facts = [
    row.land_zoning         ? { icon:'area',     v:row.land_zoning,                 k:'ייעוד קרקע' } : null,
    row.building_rights_pct ? { icon:'building', v:num(row.building_rights_pct) + '%',
                                k:'אחוזי בנייה', accent:true } : null,
    row.max_units           ? { icon:'bed',      v:num(row.max_units) + ' יח״ד',    k:'יחידות דיור מותרות' } : null,
    row.max_floors          ? { icon:'stairs',   v:num(row.max_floors) + ' קומות',  k:'קומות מותרות' } : null,
    row.parcel_status       ? { icon:'check',    v:row.parcel_status,               k:'סטטוס רישום' } : null,
    row.planning_notes      ? { icon:'sparkle',  v:row.planning_notes, k:'הערה תכנונית', wide:true } : null,
  ].filter(Boolean);

  const plans = Array.isArray(row.plans) ? row.plans.filter(pl => pl && pl.number) : [];

  // סקציה עם כותרת ובלי תוכן גרועה מסקציה שלא עלתה: היא מבטיחה מידע תכנוני
  // ומראה מסגרת ריקה.
  if (!facts.length && !plans.length) return;

  document.getElementById('planningFacts').innerHTML = facts.map(f => `
    <div class="spec-pill${f.accent ? ' accent' : ''}${f.wide ? ' wide' : ''}">
      <span class="ic" aria-hidden="true">${ICON[f.icon]}</span>
      <span class="txt"><span class="v">${escapeHtml(String(f.v))}</span><span class="k">${escapeHtml(f.k)}</span></span>
    </div>`).join('');

  const plansEl = document.getElementById('planningPlans');
  if (plans.length){
    plansEl.innerHTML =
      `<p class="plan-list-title">תוכניות תכנון החלות על ${isLandRow ? 'הקרקע' : 'המקום'} (${plans.length})</p>` +
      plans.map(pl => {
        // ‏kind / notice / url / designation מגיעים משכבות 203/14 של GovMap
        // (planning_plans_merged, מיגרציה 20270724090000); לתוכנית של העירייה
        // אין אותם, והשורה נשארת כמו שהייתה
        const detail = [pl.description, pl.notice ? null : pl.kind,
          pl.designation ? 'ייעוד: ' + pl.designation : null, pl.year].filter(Boolean).join(' · ');
        const url = /^https:\/\/mavat\.iplan\.gov\.il\//.test(pl.url || '') ? pl.url : null;
        const num = url
          ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(pl.number)}</a>`
          : escapeHtml(pl.number);
        return `<div class="plan-row${pl.notice ? ' is-notice' : ''}">` +
               (pl.notice ? '<span class="flag">הודעה על הכנת תוכנית (סעיף 77-78) - ייתכנו מגבלות על היתרי בנייה</span>' : '') +
               `<span class="num">${num}</span>` +
               (detail ? `<span class="desc">${escapeHtml(detail)}</span>` : '') + `</div>`;
      }).join('') +
      (plans.some(pl => pl.kind || pl.url)
        ? '<p class="plan-src">מקור התוכניות הארציות וההודעות: GovMap, המרכז למיפוי ישראל, ומבא"ת.</p>' : '');
    plansEl.hidden = false;
  }

  // מקופל בכל נכס, גם בקרקע (ההערה ב-property.html). שורת הסיכום אומרת
  // מה מחכה מאחורי הכפתור, והודעת 77-78 נקראת בשמה כי היא מגבלה ולא רקע.
  const notices = plans.filter(pl => pl.notice).length;
  // בלי תוכניות הסיכום הוא שמות הנתונים, כדי שהסקציה המקופלת לא תהיה כותרת ריקה
  const where = isLandRow ? 'הקרקע' : 'המקום';
  document.getElementById('planningSummary').textContent = [
    plans.length === 1 ? `תוכנית אחת החלה על ${where}`
      : plans.length ? `${plans.length} תוכניות החלות על ${where}`
      : facts.map(f => f.k).slice(0, 3).join(', '),
    notices ? (notices === 1 ? 'הודעה אחת על הכנת תוכנית (77-78)' : `${notices} הודעות על הכנת תוכנית (77-78)`) : null,
  ].filter(Boolean).join(' · ');

  const body = document.getElementById('planningBody');
  const toggle = document.getElementById('planningToggle');
  const setOpen = open => {
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'הסתרת המידע התכנוני' : 'הצגת המידע התכנוני');
  };
  setOpen(false);
  if (!toggle.dataset.wired){
    toggle.dataset.wired = '1';
    // המאזין על כל הכותרת; לחיצה על הכפתור עצמו מבעבעת לכאן, ולכן אין לו מאזין משלו
    document.getElementById('planningHead').addEventListener('click', ()=> setOpen(body.hidden));
  }

  document.getElementById('planningSection').hidden = false;
}

/* ---------- הדמיות AI ----------
   נכסי קרקע לא מגיעים לכאן בכלל — ראו loadProperty ו-isLandProperty למעלה.

   הסקציה עובדת בשני מצבים לפי category:

   ‏residential — ארבעה סגנונות קבועים. סגנון אחד (סט הבסיס) כבר קיים ומוצג
   לכל מבקר/ת; שאר הסגנונות נוצרים לפי דרישה תמורת שם וטלפון, וכל בקשה כזו
   היא ליד לסוכן/ת.

   ‏commercial — אין סגנונות: מדמים עסק, ולכן הקלט הוא סוג העסק בטקסט חופשי.
   אין סט בסיס, כי "משרד" ו"חנות בגדים" באותו נכס נראים אחרת לגמרי.

   כל הדמיה שנוצרה — סט בסיס או לפי דרישה, פרטית או מסחרית — נשמרת על הנכס
   ומוצגת גם למבקרים הבאים (‏property_visualizations_recent). במסחרי כל עסק
   שהודמה מקבל שבב משלו; ראו bizKey. */
const VIZ_FUNCTION_URL = SUPABASE_URL + '/functions/v1/property-visualize';

const VIZ_STYLES = [
  { key:'modern_clean',        label:'מודרני נקי',   tag:'לבן, אפור בהיר ואלון' },
  { key:'mediterranean_white', label:'ים תיכוני לבן', tag:'טיח, אבן טבעית וצמחייה' },
  { key:'warm_scandi',         label:'סקנדינבי חמים', tag:'עץ אלון, בז\' רך ו-Japandi' },
  { key:'modern_luxury',       label:'יוקרה מודרנית', tag:'שיש, פליז ותאורה דרמטית' },
];

const VIZ_TARGET_LABELS = {
  exterior:'חזית הבית והחצר', living_room:'הסלון', kitchen:'המטבח',
  bedroom:'חדר השינה', interior_main:'חלל העסק',
};

/* בנכס להשכרה ההדמיה של החוץ נגזרת מתמונת החצר ולא מהחזית (החזית אינה
   משתנה שם בכלל), ולכן היא נקראת בשמה. ‏חדר השינה הוא יחידת ההורים כשיש
   תמונה שלה, ולכן התווית נשארת "חדר השינה" ולא מבטיחה איזה חדר בדיוק. */
const VIZ_TARGET_LABELS_STAGING = { exterior:'החצר והגינה' };

/* בנכס מסחרי אין בית ואין חצר — יש עסק. שורת ההמתנה ("יוצרים את…") ורצועת
   ההדמיות חייבות להגיד את אותו שם על אותה תמונה, ולכן שתיהן נגזרות
   מקטגוריית הנכס ולא ממפה קבועה אחת. */
const VIZ_TARGET_LABELS_COMMERCIAL = { exterior:'חזית העסק' };

function vizTargetLabel(target){
  if (!vizState.isPrivate && VIZ_TARGET_LABELS_COMMERCIAL[target]){
    return VIZ_TARGET_LABELS_COMMERCIAL[target];
  }
  if (vizState.staging && VIZ_TARGET_LABELS_STAGING[target]){
    return VIZ_TARGET_LABELS_STAGING[target];
  }
  return VIZ_TARGET_LABELS[target] || target;
}

const vizState = {
  propertyId:null, isPrivate:true, byStyle:new Map(), current:null, busy:false,
  /* נכס פרטי להשכרה מקבל הלבשת בית ולא הדמיית שיפוץ — הפרומפט נקבע בצד
     השרת לפי ‎deal_type‎ (ראו RenderMode ב-_shared/visualization.ts), והדגל
     הזה רק דואג שהטקסט על המסך יגיד את אותו דבר. שוכר/ת לא קונה ולא
     משפץ/ת, ו"הנכס המשופץ / לפני שאתם קונים" הוא בדיוק ההבטחה שאסור לתת
     לו/ה. */
  staging:false,
  /* ‏result_url של ההדמיה שנבחרה ידנית ברצועה. בלעדיו לחיצה על תמונון של
     סגנון אחר הייתה מחליפה סגנון ואז פותחת את הסלון שלו — כלומר מראה
     תמונה אחרת מזו שנלחצה. */
  leadPick:null,
  /* הודעת השגיאה האחרונה. היא יושבת כאן ולא בטקסט של ‎#vizError‎ מפני
     שהפסקה עצמה נודדת אל תוך הרצועה, ו-‎role="alert"‎ מכריז על *שינוי
     טקסט* באזור חי: טקסט שנכתב ומיד אחריו הצומת שלו נעקר ונשתל מחדש עלול
     לא להישמע כלל. הסדר כאן הפוך — קודם הצומת מגיע למקומו, ורק אז נכתב
     לתוכו. */
  error:'',
  /* נכס מסחרי: מפתח העסק (bizKey) ← השם כפי שנכתב, מהחדש לישן. העסקים
     הם ה"סגנונות" של הנכס המסחרי — כל אחד שבב, וכל שבב מציג את ההדמיות
     שלו. עד כאן כל ההדמיות המסחריות ישבו תחת מפתח אחד ודוללו לפי מטרה,
     ולכן רק העסק האחרון שמישהו ביקש נראה בדף: מי שחזר/ה לבית הקפה שלו/ה
     מצא/ה משרד, וביקש/ה את בית הקפה שוב. */
  bizLabels:new Map(),
};

/* סוג עסק הוא טקסט חופשי, ו"בית קפה" ו"בית  קפה." הם אותו עסק. זהה ל-
   businessKey() ב-property-visualize, שלפיו השרת מחזיר הדמיה קיימת במקום
   לייצר אותה מחדש. */
function bizKey(s){
  const k = String(s == null ? '' : s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["'`\u05F3\u05F4.,!?()\-\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return k ? 'biz:' + k : '_';
}

/* השבבים של נכס מסחרי: שישה העסקים האחרונים שיש להם הדמיה, ועוד העסק
   שמתבקש ברגע זה אם הוא חדש. ‏'_' הוא הדמיה בלי סוג עסק (שורה ישנה). */
const VIZ_BIZ_CHIPS = 6;
function vizBusinessChips(){
  const out = [];
  vizState.bizLabels.forEach((label, key)=>{
    const has = (vizState.byStyle.get(key) || []).length;
    if (!has && key !== vizState.current) return;
    if (out.length >= VIZ_BIZ_CHIPS && key !== vizState.current) return;
    out.push({ key, label: label.length > 40 ? label.slice(0, 39) + '…' : label });
  });
  return out;
}

async function loadVisualizations(p){
  if (!window.supabase) return;
  /* נכס בלי תמונות אין ממה לדמות: המנוע הוא img2img, והפונקציה מחזירה
     ‏no_images לכל בקשה. תיבה שמציעה "יצירת הדמיה" כאן היא כפתור שתמיד
     נכשל, ולכן היא לא עולה בכלל — וגם לא קיצור הדרך אליה. */
  if (!(Array.isArray(p.images) && p.images.some(Boolean))) return;
  const section = document.getElementById('vizSection');
  try{
    const sb = sbClient();

    // הזכאות נשאלת מה-DB ולא נגזרת בצד הלקוח, כדי שתהיה הגדרה אחת בלבד
    // ל"מי זכאי" — אותה פונקציה שה-Edge Function נשען עליה.
    // ‏P1-K1: אותו עזר של ההחלקה (‏assets/viz-eligibility.js) - והכלל עצמו רק ב-RPC
    const enabled = window.canVisualize ? await window.canVisualize(p, sb)
      : (await sb.rpc('property_visualizations_enabled', { p_property_id: p.id })).data;
    if (!enabled) return;

    vizState.propertyId = p.id;
    vizState.isPrivate = p.category === 'residential';
    vizState.staging = vizState.isPrivate && p.deal_type === 'rent';

    /* ‏property_visualizations_recent ולא ‎_public‎: השני מסנן ‎is_base = true‎,
       כלומר רק סט הבסיס שנוצר אוטומטית עם פרסום הנכס. כל הדמיה שהופקה לפי
       דרישה נעלמה ממנו — ולכן הרשת כאן הייתה ריקה בנכסים שכבר היו להם
       הדמיות מוכנות, והגולש/ת ראה/תה טופס בלי שום ראיה שהכלי עובד.
       ‏recent מחזיר את שתיהן, מסונן לנכס הזה בלבד. */
    /* ‏business_type נוסף ל-view במיגרציה ‎20270111090000‎. עד שהיא רצה
       השאילתה עם העמודה נכשלת, ואז נופלים לשאילתה בלעדיה — הדף מציג את
       מה שהציג קודם, ולא תיבה ריקה. */
    const COLS = 'target, style_key, source_image_url, result_url, created_at';
    const fetchRecent = cols => sb
      .from('property_visualizations_recent')
      .select(cols)
      .eq('property_id', p.id)
      .order('created_at', { ascending:false });
    let { data: base, error: baseErr } = await fetchRecent(COLS + ', business_type');
    if (baseErr) ({ data: base } = await fetchRecent(COLS));

    /* דילול לפי סגנון+מטרה, החדש ביותר מנצח. אותו נכס יכול לצבור כמה
       הדמיות של אותו מטבח באותו סגנון — כל גולש/ת שביקש/ה מוסיף/ה אחת —
       והרשת שמעל אמורה להראות "המטבח בסגנון הזה", לא ארבע גרסאות שלו.
       השאילתה ממוינת מהחדש לישן, ולכן הראשון שנתקלים בו הוא הנכון.
       זהו גם הכלל של mergeVizRows() כשמגיעה תוצאה חדשה בזמן אמת. */
    const seenViz = new Set();
    (base || []).forEach(r=>{
      const key = vizState.isPrivate ? (r.style_key || '_') : bizKey(r.business_type);
      if (!vizState.isPrivate && !vizState.bizLabels.has(key)){
        vizState.bizLabels.set(key, key === '_' ? 'הדמיה' : String(r.business_type).trim());
      }
      const dedupeKey = key + '|' + r.target;
      if (seenViz.has(dedupeKey)) return;
      seenViz.add(dedupeKey);
      if (!vizState.byStyle.has(key)) vizState.byStyle.set(key, []);
      vizState.byStyle.get(key).push({
        target:r.target, result_url:r.result_url, source_image_url:r.source_image_url || null,
      });
    });

    // נכס בלי הדמיה קיימת עדיין שווה הצגה: התיבה היא הכלי שמייצר אותה,
    // ובנכס מסחרי שם ההצעה עצמה ("איך ייראה כאן העסק שלך") היא המוצר.
    section.hidden = false;
    revealVizJumpButton();
    // ‏#viz: התגית "הדמיית AI" בדף הבית (v10) - ישר לבלוק ההדמיה
    if (location.hash === '#viz') setTimeout(() => (document.getElementById('aiShowcase') || section).scrollIntoView({ block:'start' }), 300);

    if (vizState.isPrivate){
      // פותחים על הסגנון שכבר קיים כדי שהמבקר/ת יראה תמונה מיד; אם אין סט
      // בסיס בכלל, נופלים לסגנון הראשון וכל הארבעה זמינים לפי דרישה.
      const first = vizState.byStyle.keys().next();
      vizState.current = first.done ? VIZ_STYLES[0].key : first.value;
      /* ‏?viz_style=<key> (מההזמנה ב-/swipe): נפתחים על הסגנון שביקשו, גם בלי הדמיה בו -
         ואז "עדיין אין הדמיה בסגנון X" והכפתור ברצועה. בלי יצירה אוטומטית. מפתח לא מוכר - מתעלמים.
         הפרמטר יורד מהכתובת, כדי שקישור משותף יישאר נקי */
      const want = new URLSearchParams(location.search).get('viz_style');
      if (want && VIZ_STYLES.some(s => s.key === want)){
        vizState.current = want;
        if (window.shukTrack) shukTrack('viz_deeplink_land', { style: want, source: 'swipe' });
      }
      if (want){
        try { const u = new URL(location.href); u.searchParams.delete('viz_style'); history.replaceState(history.state, '', u); } catch(e){}
      }
    } else {
      // במסחרי ה"סגנונות" הם העסקים שכבר הודמו בנכס, והתיבה נפתחת על
      // האחרון שבהם. הבלוק נפתח מיד ולא אחרי לחיצה: בלעדיו הכפתור שברצועה
      // לא יודע מה ליצור.
      const first = vizState.bizLabels.keys().next();
      vizState.current = first.done ? '_' : first.value;
      document.getElementById('vizCta').hidden = false;
      applyVizContactFields();
    }

    renderPropertyShowcase();
  } catch(e){
    console.warn('טעינת הדמיות נכשלה:', e);
  }
}

/* ---------- רצועת ההדמיות של הנכס ----------
   הרצועה שבתחתית העמוד הציגה עד היום נכס *אחר* שיש לו הדמיה — כלומר
   ענתה על שאלה שאיש לא שאל בדף של נכס מסוים. עכשיו היא מציגה את הנכס
   שבעמוד: וילון שמשווה את הצילום האמיתי שלו להדמיה שלו, ומתחתיו כל שאר
   הכיוונים העיצוביים שכבר הופקו לו.

   הנתונים לא נשלפים שוב — הם כבר יושבים ב-vizState, וזו הסיבה שהרצועה
   מתעדכנת מיד אחרי כל הדמיה חדשה בלי לרענן את הדף.

   מה שלא מוצג כאן חשוב כמו מה שכן: אין מונה, אין תאריכים ואין סימון של
   "מי ביקש". זו היסטוריה תפעולית שלנו, לא מידע על הנכס. */
function vizItemsFlat(){
  const out = [];
  vizState.byStyle.forEach((list, key)=>{
    (list || []).forEach(it=>{
      /* במסחרי המפתח הוא העסק, והוא נשמר גם כשהוא '_': הרכיב מסנן את
         התמונות לפי ‎activeStyle‎, ו-null לא היה תואם לשום שבב. */
      if (it && it.result_url){
        out.push({ ...it, style_key: (key === '_' && vizState.isPrivate) ? null : key });
      }
    });
  });
  return out;
}

/* הכפתור משנה משמעות לפי מה שכבר קיים לסגנון הנבחר:

     סגנון שטרם נוצר — הזמנה ליצור אותו, וזו הלחיצה שמפעילה את ה-API.
     סגנון שכבר קיים — אין כפתור בכלל. כל החדרים שלו כבר על המסך, ולחיצה
       שהייתה מייצרת אותם מחדש היא הבטחה ריקה. השבבים הם הדרך לייצר עוד,
       והם כבר שם.

   בנכס מסחרי אין סגנונות והשאלה היא איזה עסק — הכפתור שם תמיד פעיל. */
function vizBandCta(){
  const has = (vizState.byStyle.get(vizState.current) || []).length;
  if (!vizState.isPrivate){
    return { label:'יצירת הדמיה לעסק שלכם', busy:vizState.busy,
             since:vizState.busySince, before: vizState.busy ? vizBusyBefore() : '' };
  }
  if (has && !vizState.busy) return { label:null };
  const styleLabel = (VIZ_STYLES.find(x => x.key === vizState.current) || {}).label || '';
  return {
    label: styleLabel ? `יצירת הדמיה בסגנון ${styleLabel}` : 'יצירת הדמיה לנכס',
    busy: vizState.busy,
    since: vizState.busySince,
    before: vizState.busy ? vizBusyBefore() : '',
  };
}

/* ‏viz-speed: הצילום שמתחת למסך ההמתנה - המקור של חדר מוביל (סלון, ואם אין
   אז חזית, מטבח...) מהדמיה קיימת בסגנון אחר, כי הצינור בוחר אותו צילום לכל
   סגנון. נכס בלי אף הדמיה - בלי צילום, כמו קודם. */
const VIZ_BEFORE_ORDER = ['living_room', 'interior_main', 'exterior', 'kitchen', 'bedroom'];
function vizBusyBefore(){
  let best = '', rank = 99;
  vizState.byStyle.forEach(list=>{
    (list || []).forEach(it=>{
      const r = VIZ_BEFORE_ORDER.indexOf(it && it.target);
      if (it && it.source_image_url && r >= 0 && r < rank){ rank = r; best = it.source_image_url; }
    });
  });
  return best;
}

function onVizBandCta(){
  /* נכס פרטי: לחיצה אחת מייצרת. סגנון שכבר קיים לא נוצר מחדש — הצד השרת
     מחזיר אותו מיד — ולכן אין כאן שני מסלולים.

     נכס מסחרי: הבקשה זקוקה לסוג העסק. השדה יושב עכשיו ישירות מעל הכפתור,
     ולכן לחיצה על כפתור ריק רק מחזירה אליו את המיקוד — ‏scrollIntoView
     שהיה כאן גלל את העמוד למקום שכבר על המסך. */
  if (vizState.isPrivate){ requestVisualization(); return; }
  const business = document.getElementById('vizBusiness');
  if (business && !business.value.trim()){
    business.focus();
    return;
  }
  requestVisualization();
}

/* ‏ai-showcase.js נטען עם defer, ו-loadVisualizations יכול לסיים לפניו
   כשהתשובות מגיעות מהקאש. אז ‎window.AiShowcase‎ עדיין לא קיים, והרצועה
   הייתה נשארת ריקה בלי שום סימן לתקלה. סקריפט defer רץ *לפני*
   ‏DOMContentLoaded, ולכן ההמתנה לאירוע הזה היא ההמתנה הנכונה. */
let showcasePending = false;
function renderPropertyShowcase(){
  const el = document.getElementById('aiShowcase');
  if (!el || !vizState.propertyId) return;
  // השלט שעל התמונה הראשית מתעדכן יחד עם הווילון: הדמיה ראשונה שנוצרה
  // עכשיו מוסיפה לו את התמונונות, ושינוי סגנון מחליף אותן.
  renderVizJumpButton();
  if (!window.AiShowcase){
    if (!showcasePending && document.readyState === 'loading'){
      showcasePending = true;
      document.addEventListener('DOMContentLoaded', ()=>{
        showcasePending = false;
        renderPropertyShowcase();
      }, { once:true });
    }
    return;
  }

  /* גם רשימה ריקה נכנסת: התיבה היא כלי ההדמיה של הנכס, ובנכס זכאי שטרם
     הופקה לו הדמיה היא מציגה כותרת, שבבים וכפתור בלי וילון. */
  withAskPreserved(el, ()=>{
    window.AiShowcase.mountProperty(el, {
      items: vizItemsFlat(),
      /* ארבעת הסגנונות. בנכס מסחרי אין סגנונות — מדמים עסק, לא עיצוב. */
      /* ארבעת הסגנונות בנכס פרטי; בנכס מסחרי — העסקים שכבר הודמו בו. */
      styles: vizState.isPrivate
        ? VIZ_STYLES.map(x=>({ key:x.key, label:x.label }))
        : vizBusinessChips(),
      activeStyle: vizState.isPrivate || vizState.bizLabels.size ? vizState.current : null,
      /* הרצועה מכנה את החזית "חזית הבית" בנכס פרטי ו"חזית העסק" במסחרי.
         הדגל נשלח מכאן ולא נגזר שם מ-‎styles.length‎: היעדר סגנונות הוא
         *תוצאה* של היות הנכס מסחרי, לא ההגדרה שלו. */
      commercial: !vizState.isPrivate,
      /* נכס להשכרה: הרצועה מדברת על ריהוט ועיצוב ולא על שיפוץ, בדיוק כמו
         הפרומפט שבצד השרת. שני הצדדים נגזרים מ-‎deal_type‎ ולא זה מזה, כי
         הרכיב מציג ואינו יודע מה נשלח ל-Gemini. */
      staging: vizState.staging,
      leadPick: vizState.leadPick,
      cta: vizBandCta(),
      onCta: onVizBandCta,
      /* ההזמנה לפגישה. הטקסט יושב כאן ולא ברכיב כי הרכיב לא יודע למי
         הליד הולך — הדף כן. */
      lead: {
        lines: ['חושבים למכור/להשכיר', 'ורוצים לראות את הנכס שלכם גם בהדמיות?'],
        label: 'השאירו פרטים לתאום פגישה',
      },
      onLead: onVizLeadCta,
      onSelectStyle: (key, resultUrl)=>{ vizState.leadPick = resultUrl || null; selectVizStyle(key); },
    });
  });
}

const INQUIRY_AUTO_PREFIX = 'שלום, ראיתי בשוק הנדל״ן את מודעה מספר ';

/* ============================================================================
   "חושבים למכור/להשכיר?" — הפנייה של בעל/ת נכס
   ----------------------------------------------------------------------------
   מי שראה/תה מה AI עושה לנכס של מישהו אחר שואל/ת מיד מה זה היה עושה לשלו/ה,
   וזו הפנייה שהכפתור שבתיבה קולט.

   **זו לא פניית "תיאום ביקור".** הטופס שבעמודת הצד שואל על *הנכס שבעמוד*
   בשם מי שרוצה לקנות אותו (‏lead_type='property_inquiry'); כאן מדובר על
   *נכס אחר לגמרי* בשם מי שרוצה למכור או להשכיר אותו (‏'owner_inbound').
   שתי פניות הפוכות בכיוונן, ושתי תיבות שונות ב-CRM — ולכן שני מסלולים.

   המסלול הזה אינו חדש: זו בדיוק ‎owner-lead-intake‎, אותה Edge Function
   שקולטת את אשף בעלי הנכסים בדף הסוכן/ת ובדף המשרד. מה שהיא עושה עם
   ‎agent_slug‎ הוא כל העניין — הליד **עוקף את הרוטציה של הפלטפורמה** ומשויך
   ישירות לסוכן/ת שהנכס שלו/ה, בלי תור ובלי מכסה. ‏agency_slug נשלח לצדו
   כרשת ביטחון: סוכן/ת בלי slug עדיין שייך/ת למשרד, ועדיף שהפנייה תגיע
   למנהל/ת המשרד מאשר שתיפול לרוטציה.

   ‏fetch טהור ולא דרך ה-SDK, כמו בשאר הכלים באתר: הקליטה חייבת לעבוד גם
   כשה-CDN של supabase-js נכשל בטעינה.
   ========================================================================== */
const OWNER_LEAD_FUNCTION_URL = SUPABASE_URL + '/functions/v1/owner-lead-intake';
let ownerLeadDeal = 'sale';
let ownerLeadKind = 'residential';   // 'residential' | 'commercial'

function onVizLeadCta(){
  const panel = document.getElementById('ownerLeadPanel');
  if (!panel) return;
  panel.hidden = false;

  // מי שכבר מסר/ה שם וטלפון באתר לא מקליד/ה אותם שוב
  const saved = savedContact();
  if (saved){
    const nameEl = document.getElementById('olName');
    const phoneEl = document.getElementById('olPhone');
    if (nameEl && !nameEl.value.trim()) nameEl.value = saved.name;
    if (phoneEl && !phoneEl.value.trim()) phoneEl.value = saved.phone;
  }

  panel.scrollIntoView({ behavior:'smooth', block:'center' });
  // אחרי הגלילה ולא לפניה: מיקוד קופץ לשדה בעצמו, ושתי קפיצות באותו רגע
  // נראות כמו תקלה. ‏preventScroll כדי שהמיקוד לא יבטל את הגלילה החלקה.
  setTimeout(()=>{
    const el = document.getElementById('olAddress');
    if (el) el.focus({ preventScroll:true });
  }, 420);
}

/* שם הסוכן/ת נכנס לכותרות הטופס ברגע שהנכס נטען. הפנייה הזאת הולכת
   לאדם ספציפי, ו"נחזור אליכם" בגוף רבים סתמי מסתיר בדיוק את מי שעומד
   מאחוריה. */
function applyOwnerLeadAgent(p){
  const who = p?.agency_members?.display_name;
  if (!who) return;
  const sub = document.getElementById('olSub');
  const done = document.getElementById('olDoneNote');
  if (sub) sub.textContent =
    `השאירו פרטים. הם יועברו ל־${who} להמשך טיפול - כולל הדמיות AI לנכס שלכם.`;
  if (done) done.textContent = `הפרטים הועברו ל־${who} להמשך טיפול.`;
}

/* הסגירה מחזירה את המיקוד לכפתור שפתח את הפאנל, ולא משאירה אותו על צומת
   שנעלם — מי שניווט/ה במקלדת היה נופל/ת לתחילת העמוד. הכפתור נשלף מחדש
   בכל פעם ולא נשמר: הרצועה מורכבת מ-innerHTML בכל רינדור, והצומת שהיה
   כאן קודם כבר לא בעץ.

   ‏Escape סוגר גם הוא: הפאנל נפתח מעל תוכן שהגולש/ת קרא/ה, וכל דבר
   שנפתח כך צריך דרך יציאה שאינה דורשת לחפש כפתור. */
function closeOwnerLead(){
  const panel = document.getElementById('ownerLeadPanel');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const opener = document.getElementById('aiPropLead');
  if (opener) opener.focus({ preventScroll:true });
}

function initOwnerLeadForm(){
  const form = document.getElementById('ownerLeadForm');
  if (!form) return;

  const closeBtn = document.getElementById('olClose');
  if (closeBtn) closeBtn.addEventListener('click', closeOwnerLead);
  document.addEventListener('keydown', (ev)=>{
    if (ev.key !== 'Escape') return;
    const panel = document.getElementById('ownerLeadPanel');
    if (panel && !panel.hidden) closeOwnerLead();
  });

  form.querySelectorAll('.owner-lead-toggle button[data-kind]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      ownerLeadKind = btn.dataset.kind;
      form.querySelectorAll('.owner-lead-toggle button[data-kind]').forEach(b=>{
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });

  form.querySelectorAll('.owner-lead-toggle button[data-deal]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      ownerLeadDeal = btn.dataset.deal;
      form.querySelectorAll('.owner-lead-toggle button[data-deal]').forEach(b=>{
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      const title = document.getElementById('olTitle');
      if (title) title.textContent = ownerLeadDeal === 'rent' ? 'חושבים להשכיר?' : 'חושבים למכור?';
    });
  });

  form.addEventListener('submit', submitOwnerLead);
}

async function submitOwnerLead(ev){
  ev.preventDefault();
  const err  = document.getElementById('olError');
  const btn  = document.getElementById('olSubmit');
  const name  = document.getElementById('olName').value.trim();
  const phone = document.getElementById('olPhone').value.trim();
  const address = document.getElementById('olAddress').value.trim();
  err.textContent = '';
  if (!name || !phone){ err.textContent = 'יש למלא שם וטלפון'; return; }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שולח…';
  try{
    const p = currentProperty || {};
    const res = await fetch(OWNER_LEAD_FUNCTION_URL, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization':'Bearer ' + SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        agent_slug:  p.agency_members?.slug || null,
        agency_slug: p.agencies?.slug || null,
        // עירו של הנכס שבעמוד היא ההערכה הטובה ביותר שיש כאן לעיר של
        // הפונה: מי שמתעניין/ת בנכס בעפולה מוכר/ת בעפולה. השדה חובה
        // בפונקציה, והכתובת המדויקת ממילא נשלחת לצדו.
        city: p.city || 'עפולה',
        // מגורים או מסחרי, כמו באשף שבדף הסוכן/ת. הטופס הזה לא שואל על
        // סוג המשנה (דירה, בית, משרד), והסוכן/ת מברר/ת בשיחה. ‏'מסחרי' הוא
        // הערך שבהעדפות הלידים של הסוכנים, והניתוב משווה אליו.
        property_type: ownerLeadKind === 'commercial' ? 'מסחרי' : 'דירה',
        deal_type: ownerLeadDeal,
        address: address || null,
        name, phone,
        // נכנס ל-property_details, כלומר נראה לסוכן/ת כבר בליד המוסתר —
        // וזה כל הערך שלו: בלי ההקשר אי אפשר לדעת על מה לחזור.
        note: 'פנייה מתיבת ההדמיות בדף הנכס',
        source: 'property_page_owner_wizard',
      }),
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || data.error) throw new Error(data.error || 'שגיאה');

    rememberContact(name, phone, p.id || vizState.propertyId);
    document.getElementById('ownerLeadForm').hidden = true;
    document.getElementById('olDone').hidden = false;
  } catch(e){
    console.error('owner-lead-intake נכשל:', e);
    err.textContent = 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב';
    btn.textContent = original;
    btn.disabled = false;
  }
}

/* טופס הבקשה מוצג *בתוך* הרצועה, מעל הכפתור — אבל הרצועה מוחקת ובונה את
   עצמה מחדש מ-innerHTML בכל רינדור, וכל מה שבתוכה נהרס איתה. לכן הטופס
   נשלף החוצה לפני הבנייה וחוזר לחריץ ‎#aiPropAsk‎ אחריה.

   ‏appendChild *מזיז* צומת קיים ולא משכפל אותו, ולכן מה שהוקלד בשדות
   והמאזינים שעליהם שורדים את המסע. שתי ההזזות והבנייה שביניהן סינכרוניות
   ברצף אחד — הדפדפן לא מצייר באמצע — ולכן אין הבהוב.

   מה שההזזה כן שוברת הוא המיקוד: דפדפן מוציא מיקוד מצומת שנעקר מהעץ.
   רינדור בזמן שהמיקוד בשדה הוא נדיר (תוצאה שנכנסת באמצע הקלדה), אבל
   כשהוא קורה הוא מפיל את הסמן באמצע מילה — ולכן הוא נלכד ומוחזר.

   ‏**שורת השגיאה נוסעת יחד עם הטופס.** היא ישבה ב-‎#vizSection‎ מתחת
   לרצועה — כלומר מתחת לרשת ההדמיות *ומתחת* להזמנה לפגישה שאחריה. הכפתור
   היחיד שמייצר הדמיה יושב בתוך הרצועה, ולכן במובייל התשובה על הלחיצה
   נחתה בערך מסך שלם מתחת למקום שבו לחצו: מי שלחץ/ה "יצירת הדמיה לעסק
   שלכם" וקיבל/ה 400 ראה/תה בדיוק שום דבר קורה, ודיווח/ה שההדמיה "לא
   עובדת" — כשהסיבה הייתה כתובה למטה. עכשיו היא נכנסת ל-‎#aiPropAsk‎ ממש
   מעל הכפתור, ורק כשיש בה מה להגיד: פסקה ריקה בחריץ הייתה מוסיפה לו
   שוליים בכל ביקור רגיל. */
function withAskPreserved(bandEl, render){
  const ask  = document.getElementById('vizCta');
  const err  = document.getElementById('vizError');
  const home = document.getElementById('vizSection');

  const focused = ask && ask.contains(document.activeElement) ? document.activeElement : null;
  const start = focused ? focused.selectionStart : null;
  const end   = focused ? focused.selectionEnd   : null;

  // חילוץ לפני המחיקה. ‎#vizSection‎ הוא הבית שממנו הטופס יצא, והוא שורד
  // את הרינדור — הרצועה היא רק ילד שלו.
  [ask, err].forEach(node=>{
    if (node && home && bandEl.contains(node)) home.appendChild(node);
  });

  render();

  const slot = bandEl.querySelector('#aiPropAsk');
  if (slot){
    if (ask && !ask.hidden) slot.appendChild(ask);
    if (err && vizState.error) slot.appendChild(err);
  }

  // הכתיבה אחרי ההשתלה — ראו vizState.error.
  applyVizError();

  if (focused && focused.isConnected){
    focused.focus();
    try{ if (start !== null) focused.setSelectionRange(start, end); }catch(_){}
  }
}

/* כותב את ההודעה לפסקה, ורק אם היא באמת השתנתה: כתיבה חוזרת של אותו טקסט
   ל-‎role="alert"‎ מכריזה אותו שוב באוזני מי שמקשיב/ה. */
function applyVizError(){
  const el = document.getElementById('vizError');
  if (el && el.textContent !== vizState.error) el.textContent = vizState.error;
}

/* נקודת הכניסה היחידה לשגיאה: מעדכנת את המצב, מרנדרת (ושם הפסקה מוצאת את
   מקומה מעל הכפתור), ומוודאת שהטקסט נכתב גם כשהרצועה עצמה לא נבנתה. */
function setVizError(msg){
  vizState.error = msg || '';
  renderPropertyShowcase();
  applyVizError();
}

function selectVizStyle(styleKey){
  vizState.current = styleKey;
  setVizError('');
}

/* ---------- מה עובד ברקע ----------
   הרשת של "יוצרים את המטבח…" ירדה יחד עם הרשת עצמה; מה שנשאר הוא שורת
   מצב אחת מתחת לתיבה. שני החדרים של אותה בקשה מסתיימים בפער של שניות,
   ורשת שמראה אריח ממתין לכל אחד מהם הייתה רעש ולא מידע. */
function renderVizPending(targets){
  const el = document.getElementById('vizPending');
  if (!el) return;
  const list = targets || [];
  if (!list.length){ el.hidden = true; el.textContent = ''; return; }
  /* כשהתיבה עצמה מציגה את מסך "יוצרים לך את ההדמיה" — כלומר בסגנון שאין
     לו עדיין אף הדמיה — השורה הזאת היא הודעה שנייה על אותו דבר, בשני
     ניסוחים ובשני אומדני זמן. במצב הזה היא יורדת, והמסגרת עצמה מדברת.
     כשכבר יש הדמיה בסגנון הנבחר הווילון תופס את המסגרת, אין שם מסך
     המתנה, והשורה היא הסימן היחיד שמשהו רץ ברקע. */
  if (!(vizState.byStyle.get(vizState.current) || []).length){
    el.hidden = true; el.textContent = ''; return;
  }
  const names = list.map(vizTargetLabel).join(', ');
  el.textContent = `יוצרים את ${names}… זה יכול לקחת עד דקה.`;
  el.hidden = false;
}

/* ---------- זיכרון הפרטים של המבקר/ת ----------
   שתי בקשות מאותו אדם על אותו נכס הן אותה פנייה, וטופס שנשאל פעמיים
   מרגיש כמו מחסום ולא כמו שירות. מה שנשמר הוא המינימום: שם, טלפון, ורשימת
   הנכסים שכבר נמסרו להם פרטים.

   הכול ב-localStorage של הדפדפן ולא בשרת: זו נוחות של המבקר/ת, לא זהות.
   מי שמנקה את הדפדפן פשוט יישאל שוב, וזו התנהגות נכונה — אין לנו דרך
   לדעת שזה אותו אדם, ואין סיבה שתהיה. */
const VIZ_CONTACT_KEY   = 'shuknadlan_visitor_contact';
const VIZ_CONTACTED_KEY = 'shuknadlan_contacted_properties';

function readStored(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch(e){ return fallback; }
}
function writeStored(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); } catch(e){ /* מצב פרטי */ }
}

function savedContact(){
  const c = readStored(VIZ_CONTACT_KEY, null);
  return c && c.name && c.phone ? c : null;
}
function contactedProperty(id){
  return !!id && (readStored(VIZ_CONTACTED_KEY, []) || []).indexOf(id) !== -1;
}
/* נקרא גם מטופס "תיאום ביקור": מי שכבר השאיר/ה פרטים לנכס הזה בטופס אחד
   לא יידרש/תידרש להם שוב בטופס השני. */
function rememberContact(name, phone, propertyId){
  if (name && phone) writeStored(VIZ_CONTACT_KEY, { name, phone });
  const list = readStored(VIZ_CONTACTED_KEY, []) || [];
  if (propertyId && list.indexOf(propertyId) === -1){
    list.push(propertyId);
    // ‏50 הנכסים האחרונים: הרשימה היא נוחות, לא ארכיון
    writeStored(VIZ_CONTACTED_KEY, list.slice(-50));
  }
}

/* מי בכלל נדרש/ת לפרטים:
     נכס פרטי  — אף אחד. ההדמיה היא המוצר, ומסך שדורש שם וטלפון לפני
                 שרואים אותה הוא מחסום לפני הערך ולא אחריו.
     נכס מסחרי — כן, פעם אחת. מי שמדמה עסק בנכס מסחרי הוא לקוח בפועל,
                 וזו הפנייה שהסוכן/ת מקבל/ת. */
function vizNeedsContact(){
  if (vizState.isPrivate) return false;
  return !(savedContact() && contactedProperty(vizState.propertyId));
}

function applyVizContactFields(){
  const box = document.getElementById('vizContact');
  if (box) box.hidden = !vizNeedsContact();
}

/* ---------- הבקשה עצמה ----------
   נקודת כניסה אחת לשני המסלולים: הכפתור בסקציה, הכפתור ברצועה, ושליחת
   הטופס — כולם מגיעים לכאן, ולכן הכללים (מה נדרש, מה נשמר, מה קורה
   בזמן העבודה) נכתבים פעם אחת. */
async function requestVisualization(){
  if (vizState.busy) return;

  const business = document.getElementById('vizBusiness');
  // ניקוי בלי רינדור: כל מסלול מכאן והלאה מרנדר בעצמו — הכישלונות דרך
  // setVizError, וההצלחה דרך הרינדור של vizState.busy שמתחתיהם.
  vizState.error = '';

  let name = '', phone = '';
  if (!vizState.isPrivate){
    if (!(business && business.value.trim())){
      setVizError('יש לציין איזה עסק תפתחו בנכס'); return;
    }
    if (vizNeedsContact()){
      name  = document.getElementById('vizName').value.trim();
      phone = document.getElementById('vizPhone').value.trim();
      if (!name || !phone){ setVizError('יש למלא שם וטלפון'); return; }
    } else {
      const saved = savedContact();
      name = saved.name; phone = saved.phone;
    }
  }

  /* במסחרי העסק המבוקש הוא השבב הפעיל, עוד לפני שהבקשה יוצאת: אם הוא
     כבר הודמה, ההדמיה שלו על המסך מיד; אם לא, המסגרת שלו מציגה את מסך
     ההמתנה ומשם תוצאה חדשה נכנסת תחתיו (mergeVizResults). */
  const prevCurrent = vizState.current;
  /* עסק שכבר הודמה בנכס הזה: ההדמיה שלו עולה על המסך מיד, והבקשה עדיין
     יוצאת — היא הפנייה שהסוכן/ת מקבל/ת, והשרת מחזיר את הקיימת בלי לשלם על
     קריאה חדשה. מה שמשתנה הוא ההודעה: "ההדמיה מוכנה" הייתה אומרת שנוצרה
     עכשיו הדמיה חדשה, כשעל המסך אותה תמונה שכבר הייתה שם. */
  let alreadyDone = false;
  if (!vizState.isPrivate){
    const key = bizKey(business.value);
    alreadyDone = (vizState.byStyle.get(key) || []).length > 0;
    if (!vizState.bizLabels.has(key)){
      // חדש נכנס בראש הרשימה — הוא העסק האחרון שהודמה
      vizState.bizLabels = new Map([[key, business.value.trim()], ...vizState.bizLabels]);
    }
    vizState.current = key;
  }

  vizState.busy = true;
  vizState.busySince = Date.now();
  // הכפתור היחיד נמצא ברצועה, בתוך innerHTML שמורכב מחדש, ולכן מצב
  // ה"יוצרים…" שלו עובר דרך vizState.busy ולא דרך נגיעה ישירה באלמנט.
  renderPropertyShowcase();

  try{
    const payload = { property_id: vizState.propertyId };
    if (name && phone){ payload.name = name; payload.phone = phone; }
    if (vizState.isPrivate) payload.style = vizState.current;
    else payload.business_type = business.value.trim();

    const res = await fetch(VIZ_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(()=>({}));
    /* ‏out.error הוא קוד מכונה (gemini_not_configured, db_error) ולא טקסט
       לגולש/ת. הפונקציה מצרפת message בעברית בכל מקרה שהגולש/ת יכול/ה
       לעשות איתו משהו — "יש למלא שם וטלפון", "הגעתם למכסה היומית" — וכל
       מה שאין לו message הוא תקלה שלנו, שאין לה שום ניסוח מועיל בצד הזה.
       הקוד עצמו נשמר ל-console כדי שלא ילך לאיבוד באבחון. */
    if (!res.ok || out.error){
      if (out.error) console.error('property-visualize נכשל:', out.error, out.detail || '');
      throw new Error(out.message || 'לא הצלחנו ליצור את ההדמיה כרגע. נסו שוב מאוחר יותר.');
    }

    if (name && phone) rememberContact(name, phone, vizState.propertyId);
    // הפרטים כבר נמסרו — הבלוק סוגר את עצמו, וההדמיה הבאה לאותו נכס
    // תיווצר בלחיצה אחת.
    if (!vizState.isPrivate) applyVizContactFields();

    mergeVizResults(out.ready || []);

    /* ‏already_exists מגיע מהשרת גם כשהדף לא ידע — מבקר/ת אחר/ת יצר/ה את
       ההדמיה אחרי שהדף נטען. ההודעה יושבת בפסקה שמעל הכפתור ולא בטוסט
       שנעלם: היא תשובה ללחיצה, וצריך שתישאר עד שקוראים אותה. */
    if (!vizState.isPrivate && (alreadyDone || out.already_exists) && !out.job_id){
      vizState.error = `כבר בוצעה הדמיה ל"${business.value.trim()}" בנכס הזה - היא מוצגת כאן.`;
      return;
    }

    if (out.job_id) await pollVisualizationJob(out.job_id, out.pending_targets || []);

    showToast(vizState.isPrivate
      ? 'ההדמיה מוכנה'
      : 'ההדמיה מוכנה. יועץ הנדל״ן יחזור אליכם בקרוב');
  } catch(e){
    // המצב בלבד — ‎finally‎ שמתחת מרנדר, ושם הפסקה נשתלת מעל הכפתור ונכתבת.
    vizState.error = e.message || 'שגיאה ביצירת ההדמיה';
    // עסק שלא נוצרה לו אף הדמיה לא נשאר כשבב ריק: חוזרים למה שהוצג
    if (!vizState.isPrivate && !(vizState.byStyle.get(vizState.current) || []).length){
      vizState.bizLabels.delete(vizState.current);
      vizState.current = prevCurrent;
    }
  } finally{
    vizState.busy = false;
    renderVizPending([]);
    renderPropertyShowcase();
    applyVizError();
  }
}

/* ‏Enter בתוך הטופס שולח אותו. עם שדה טקסט אחד גלוי (מבקר/ת חוזר/ת שכבר
   מסר/ה פרטים) זו שליחה משתמעת של הדפדפן; עם שלושה שדות הדפדפן מוותר עליה,
   ולכן היא נכתבת כאן במפורש. שני המסלולים מגיעים ל-requestVisualization,
   ושמירת ה-busy שבראשה מונעת בקשה כפולה אם שניהם ייורו יחד. */
function initVisualizationForm(){
  const form = document.getElementById('vizCta');
  if (!form) return;
  form.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    requestVisualization();
  });
  form.addEventListener('keydown', (ev)=>{
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    requestVisualization();
  });
}

/* ‏source_image_url נכנס כאן בדיוק כמו ב-loadVisualizations. הוא נשמט מהמסלול
   הזה, ולכן כל הדמיה שנוצרה *בזמן הצפייה* הגיעה לרצועה בלי תמונת המקור שלה:
   הווילון נפל ל-fallback, וב"חלל העסק" של נכס מסחרי הצד ה"לפני" הראה את
   חזית הבניין מול פנים העסק בצד ה"אחרי" — שני מקומות שונים שמוצגים כאותו
   מקום לפני ואחרי. הדמיה שנטענה מהשרת לא סבלה מזה, וזו הסיבה שהתקלה נראתה
   רק אחרי לחיצה על הכפתור. */
function mergeVizResults(rows){
  /* מרנדרים רק כשמשהו השתנה. עם בדיקה כל שנייה, רינדור מחדש בכל אחת מהן
     היה מחליף את מסך ההמתנה פעם בשנייה, ומאפס את הווילון באמצע גרירה
     (הבדיקה מחזירה שוב ושוב גם את החדרים שכבר נגמרו). */
  const key = vizState.current || '_';
  const list = vizState.byStyle.get(key) || [];
  let changed = false;
  (rows || []).forEach(r=>{
    if (!r || !r.result_url) return;
    const source = r.source_image_url || null;
    const existing = list.find(x=>x.target === r.target);
    if (existing){
      if (existing.result_url === r.result_url && (!source || existing.source_image_url === source)) return;
      changed = true;
      existing.result_url = r.result_url;
      if (source) existing.source_image_url = source;
    } else {
      changed = true;
      list.push({ target:r.target, result_url:r.result_url, source_image_url:source });
    }
  });
  if (!changed) return;
  vizState.byStyle.set(key, list);
  // הדמיה שהרגע נוצרה נכנסת לרצועה בלי לרענן את הדף
  renderPropertyShowcase();
}

/* ההדמיה רצה ברקע ב-Edge Function ולכן המעקב הוא polling על ה-RPC.
   ה-job_id הוא כרטיס הכניסה לתוצאה — הוא נמסר רק למי שביקש/ה. */
async function pollVisualizationJob(jobId, pendingTargets){
  const sb = sbClient();
  const DEADLINE = Date.now() + 180000;
  let remaining = pendingTargets.slice();

  renderVizPending(remaining);

  /* ‏viz-speed (1.11.2026): כל שנייה ב-20 השניות הראשונות - שם נגמרות כמעט כל
     ההדמיות (p50 בשרת כ-11 שניות) - ואז כל 3 שניות. קודם 4 שניות קבוע, כלומר
     עד 4 שניות של המתנה אחרי שהתמונה כבר הייתה מוכנה. */
  const started = Date.now();
  while (Date.now() < DEADLINE){
    await new Promise(r=>setTimeout(r, Date.now() - started < 20000 ? 1000 : 3000));
    const { data } = await sb.rpc('visualization_job_status', { p_job_id: jobId });
    const rows = data || [];

    mergeVizResults(rows.filter(r=>r.item_status === 'done'));
    remaining = remaining.filter(t=>!rows.some(r=>r.target === t && r.item_status !== 'pending' && r.item_status !== 'processing'));
    renderVizPending(remaining);

    const jobStatus = rows[0] && rows[0].job_status;
    if (jobStatus === 'done' || jobStatus === 'failed') break;
  }

  renderVizPending([]);
}

/* ---------- נכסים דומים ----------
   שני תנאים קשיחים, וכל השאר ניקוד:

   * **אותה עסקה** — מכירה לא מציעה השכרה, ולהפך. דירה ב-4,400 ₪ לחודש
     בדף של בית ב-4 מיליון היא בדיוק ה"לא קשור" שהסקציה הזו נועדה למנוע.
   * **אותה משפחת סוג** — בית מול בית, דירה מול דירה, מסחרי מול מסחרי.
     סוג שאיננו מכירים אינו נפסל, רק אינו מקבל ניקוד על סוג.

   בתוך זה המועמדים מדורגים: סוג זהה, שכונה, טווח מחיר, חדרים ושטח.
   מחיר ושכונה הם ניקוד ולא סינון בכוונה — כשההיצע דל הם פשוט לא
   מתקיימים, והנכסים הבאים בתור עדיין מוצגים. נכסים מעיר אחרת (מאותו סוג
   בדיוק) נכנסים רק כשבעיר אין מספיק, ותמיד אחרי כל מי שבעיר.

   אין תוצאות בכלל — הסקציה כולה מוסתרת, בדיוק כמו "משרדי תיווך מובילים"
   ריק בדף הבית. */
const SIMILAR_MAX = 8;
const SIMILAR_MIN_SAME_CITY = 4;   // מתחת לזה משלימים מערים אחרות
const TYPE_FAMILIES = {
  'בית פרטי/קוטג\'':'house', 'קוטג\'':'house', 'וילה':'house', 'דו משפחתי':'house',
  'דירה':'apartment', 'דירות':'apartment', 'דירת גן':'apartment', 'גג/פנטהאוז':'apartment',
  'פנטהאוז':'apartment', 'דופלקס':'apartment', 'טריפלקס':'apartment',
  'יחידת דיור':'apartment', 'סטודיו':'apartment', 'דירת סטודיו':'apartment',
  'חנויות/שטח מסחרי':'commercial', 'משרדים':'commercial', 'מבני תעשייה':'commercial',
  'בנין':'commercial', 'בניין':'commercial', 'מחסן':'commercial', 'חנות':'commercial',
  'משרד':'commercial', 'מבנה מסחרי':'commercial', 'אולם':'commercial',
  'מגרש':'land', 'מגרשים':'land', 'קרקע':'land', 'קרקעות':'land', 'נחלה':'land', 'משק':'land'
};
function typeFamily(t){ return TYPE_FAMILIES[String(t || '').trim()] || null; }

// קרבה יחסית בין שני מספרים: 1 כשהם זהים, 0 כשהפער גדול מ-tolerance
function closeness(a, b, tolerance){
  a = Number(a); b = Number(b);
  if (!(a > 0) || !(b > 0)) return 0;
  const gap = Math.abs(a - b) / Math.max(a, b);
  return gap >= tolerance ? 0 : 1 - gap / tolerance;
}

function similarityScore(p, c){
  let s = 0;
  if (p.property_type && c.property_type === p.property_type) s += 40;
  else if (typeFamily(p.property_type) && typeFamily(c.property_type) === typeFamily(p.property_type)) s += 20;
  const sameHood = (p.neighborhood_id && c.neighborhood_id === p.neighborhood_id)
    || (p.neighborhood_name && c.neighborhood_name === p.neighborhood_name);
  if (sameHood) s += 20;
  s += 20 * closeness(p.price, c.price, 0.5);
  if (p.rooms && c.rooms){
    const d = Math.abs(Number(p.rooms) - Number(c.rooms));
    s += d <= 0.5 ? 15 : d <= 1.5 ? 7 : 0;
  }
  s += 5 * closeness(p.size_sqm, c.size_sqm, 0.4);
  if (isPromoted(c)) s += 2;   // שובר שוויון, לא יותר
  return s;
}

async function loadSimilarProperties(p){
  if (!window.supabase) return [];
  try{
    const sb = sbClient();
    // הלוגו של המשרד נטען יחד עם הנכס כדי שאריח בלי תמונות יציג את מיתוגו
    const base = () => {
      let q = sb.from('properties').select('*, agencies(name, logo_url)').eq('status', 'active').neq('id', p.id);
      if (p.deal_type) q = q.eq('deal_type', p.deal_type);
      return q;
    };

    // שתי השאילתות במקביל: המאגר העירוני, ורשת ביטחון מאותו סוג בדיוק
    // לערים קטנות. השנייה זולה, והמתנה לראשונה כדי להחליט עליה עולה RTT.
    const [cityRes, typeRes] = await Promise.all([
      p.city ? base().eq('city', p.city).order('created_at', { ascending:false }).limit(60)
             : Promise.resolve({ data: [] }),
      p.property_type ? base().eq('property_type', p.property_type).neq('city', p.city || '')
                          .order('created_at', { ascending:false }).limit(20)
                      : Promise.resolve({ data: [] })
    ]);
    if (cityRes.error) throw cityRes.error;

    const family = typeFamily(p.property_type);
    const compatible = c => !family || !typeFamily(c.property_type) || typeFamily(c.property_type) === family;
    const rank = list => (list || []).filter(compatible)
      .map(c => ({ c, s: similarityScore(p, c) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.c);

    const results = rank(cityRes.data).slice(0, SIMILAR_MAX);
    if (results.length < SIMILAR_MIN_SAME_CITY){
      results.push(...rank(typeRes.data).slice(0, SIMILAR_MAX - results.length));
    }
    return results;
  } catch(e){
    console.warn('טעינת נכסים דומים נכשלה:', e);
    return [];
  }
}

function similarLinkText(p){
  const title = String(p.title || p.property_type || 'נכס').replace(/\s+/g, ' ').trim() || 'נכס';
  const n = Number(p.price);
  const price = Number.isFinite(n) && n > 0
    ? '₪' + n.toLocaleString('he-IL') + (p.deal_type === 'rent' ? ' לחודש' : '')
    : '';
  return price ? title + ' · ' + price : title;
}
function renderSimilarProperties(list){
  const section = document.getElementById('similarSection');
  const scroll = document.getElementById('similarScroll');
  if (!list.length){ section.hidden = true; return; }

  scroll.innerHTML = '';
  // הסדר הוא סדר הדמיון מ-loadSimilarProperties, ולא ממוין מחדש לפי מדיה:
  // את האריח הראשון ברצועה רואים גם מי שלא גולל/ת אותה, ולכן הוא צריך
  // להיות הנכס הדומה ביותר ולא זה שיש לו וידאו.
  list.forEach((sp, i)=>{
    const card = document.createElement('div');
    card.className = 'prop-card';
    // ‏A-SEO-2: קישור אמיתי שנמתח על האריח (‏.pc-link, ‏assets/prop-shelf.css) - לא ניווט ב-JS
    card.innerHTML = `
      <a class="pc-link" href="/property?id=${encodeURIComponent(sp.id)}"><span class="pc-link-text">${escapeHtml(similarLinkText(sp))}</span></a>
      <div class="thumb" style="${thumbStyle(sp, i)}">
        ${thumbFallback(sp)}
        ${isPromoted(sp) ? '<span class="ribbon">מקודם</span>' : ''}
        ${PropertyCard.badgesHtml(sp, { photo: !!(sp.images && sp.images[0]) })}
      </div>
      <div class="body">
        ${PropertyCard.priceHtml(sp)}
        ${PropertyCard.titleHtml(sp)}
        ${PropertyCard.whereHtml(sp)}
        ${PropertyCard.factsHtml(sp)}
      </div>`;
    scroll.appendChild(card);
  });
  section.hidden = false;
}

/* ---------- סרגל הנתונים המהיר ----------
   ארבע קפסולות לכל היותר, לפי סדר החשיבות שגולש/ת בודק/ת קודם: שטח, חדרים,
   קומה, מחיר למ״ר, מיקום. שדה שלא מולא פשוט לא תופס מקום — מודעה דלילה
   מציגה שתי קפסולות, לא ארבע עם מקפים.                                     */
function floorText(p){
  if (p.floor === null || p.floor === undefined) return '';
  const base = p.floor === 0 ? 'קומת קרקע' : 'קומה ' + p.floor;
  return p.total_floors ? base + ' מ־' + p.total_floors : base;
}

function renderSpecPills(p){
  const isRent = p.deal_type === 'rent';
  const moveIn = p.move_in_date
    ? new Date(p.move_in_date).toLocaleDateString('he-IL')
    : (p.move_in_soon ? 'כניסה מיידית' : '');
  // איזור אחד לכל נתוני הנכס. עיר וסוג נכס לא חוזרים כאן — הם כבר בתגיות
  // שמעל הכותרת ובשורת הכתובת, ומקומם שמור לנתונים שאין להם מקום אחר.
  const candidates = [
    p.size_sqm       ? { icon:'ruler',  v:Number(p.size_sqm).toLocaleString('he-IL') + ' מ״ר', k:'שטח הנכס' } : null,
    p.rooms          ? { icon:'bed',    v:Number(p.rooms).toLocaleString('he-IL') + ' חדרים',  k:'חדרים' } : null,
    floorText(p)     ? { icon:'stairs', v:floorText(p), k: p.floor === 0 ? 'גישה ישירה' : 'קומה' } : null,
    p.price_per_sqm  ? { icon:'shekel', v:Number(p.price_per_sqm).toLocaleString('he-IL') + ' ₪',
                         k:isRent ? 'למ״ר לחודש' : 'מחיר למ״ר', accent:true } : null,
    p.built_size_sqm ? { icon:'area',   v:Number(p.built_size_sqm).toLocaleString('he-IL') + ' מ״ר', k:'שטח בנוי' } : null,
    p.garden_sqm     ? { icon:'balcony',v:Number(p.garden_sqm).toLocaleString('he-IL') + ' מ״ר', k:'גינה' } : null,
    (window.ShukAirLiving && ShukAirLiving.customerLivingLine(p.living_room_sqm))
      ? { icon:'balcony', v:ShukAirLiving.customerLivingLine(p.living_room_sqm), k:'' } : null,
    (window.ShukAirLiving && ShukAirLiving.customerAirLine(p.air_directions))
      ? { icon:'window', v:ShukAirLiving.customerAirLine(p.air_directions), k:'' } : null,
    CONDITION_LABELS[p.condition] ? { icon:'sparkle', v:CONDITION_LABELS[p.condition], k:'מצב הנכס' } : null,
    moveIn           ? { icon:'key',    v:moveIn, k:'תאריך כניסה', accent:true } : null,
    PROJECT_STATUS_LABELS[p.project_status] ? { icon:'key', v:PROJECT_STATUS_LABELS[p.project_status], k:'סטטוס הפרויקט' } : null,
    p.furniture_details ? { icon:'sofa', v:p.furniture_details, k:'ריהוט', wide:true } : null,
    // עלויות שוטפות. הארנונה נשמרת כפי שהיא בשובר, ותקופת החיוב נגזרת
    // מהקטגוריה: לחודשיים במגורים, לחודש במסחרי. docs/property-form.md
    p.maintenance_fee ? { icon:'shekel', v:Number(p.maintenance_fee).toLocaleString('he-IL') + ' ₪ לחודש', k:'ועד בית / דמי ניהול' } : null,
    p.arnona          ? { icon:'shekel', v:Number(p.arnona).toLocaleString('he-IL') + (p.category === 'commercial' ? ' ₪ לחודש' : ' ₪ לחודשיים'), k:'ארנונה' } : null,
  ].filter(Boolean);

  document.getElementById('specPills').innerHTML = candidates.map(c => `
    <div class="spec-pill${c.accent ? ' accent' : ''}${c.wide ? ' wide' : ''}">
      <span class="ic" aria-hidden="true">${ICON[c.icon]}</span>
      <span class="txt"><span class="v">${escapeHtml(String(c.v))}</span><span class="k">${escapeHtml(c.k)}</span></span>
    </div>`).join('');
}

/* ---------- יתרונות הנכס ----------
   המאפיינים שהוזנו במודעה, כרשימה מאוירת ולא כענן צ׳יפים: כל שורה היא טיעון
   מכירה אחד. מצב הנכס ("חדש מקבלן") וכניסה מיידית מצטרפים לרשימה כי הם
   נקראים בדיוק כמו מאפיין.                                                 */
/* מרחב מוגן ראשון: זו השאלה הראשונה שקונים ושוכרים שואלים היום, ולכן היא
   פותחת את הרשימה כשהיא קיימת - לפני מצב הנכס ולפני כל מאפיין אחר.
   במגורים זה מאפיין (mamad/mamak/building_shelter), ובמסחרי הטופס שומר
   *מיקום* (‏mamad_location: בנכס/בבניין) ולא מאפיין - ולכן שניהם נקראים כאן.
   אותו דבר למחסן ולשירותים במסחרי, שעד היום לא הוצגו בדף בכלל. */
const PROTECTION_FEATURES = ['mamad', 'mamak', 'building_shelter'];
const LOCATION_WORD = { unit:'בנכס', building:'בבניין' };

function renderHighlights(p){
  const items = [];
  const features = p.features || [];
  const locationItem = (loc, icon, noun) =>
    LOCATION_WORD[loc] ? { icon, label: noun + ' ' + LOCATION_WORD[loc] } : null;

  // 1. מרחב מוגן
  const mamadLoc = locationItem(p.mamad_location, 'shield', 'ממ״ד');
  if (mamadLoc) items.push(mamadLoc);
  PROTECTION_FEATURES.forEach(code=>{
    if (code === 'mamad' && mamadLoc) return;   // "ממ״ד בנכס" אומר יותר מ"ממ״ד"
    if (features.includes(code)) items.push({ icon:FEATURE_ICONS[code], label:FEATURE_LABELS[code] });
  });

  // 2. מצב וכניסה
  const cond = CONDITION_HIGHLIGHTS[p.condition];
  if (cond) items.push(cond);
  if (p.move_in_soon) items.push({ icon:'key', label:'כניסה מיידית' });

  // 3. מיקומים במסחרי
  const storageLoc = locationItem(p.storage_location, 'box', 'מחסן');
  if (storageLoc) items.push(storageLoc);
  const restroomsLoc = locationItem(p.restrooms_location, 'check', 'שירותים');
  if (restroomsLoc) items.push(restroomsLoc);

  // 4. שאר המאפיינים
  features.forEach(code=>{
    if (PROTECTION_FEATURES.includes(code)) return;
    if (code === 'storage' && storageLoc) return;
    const label = FEATURE_LABELS[code];
    if (label) items.push({ icon:FEATURE_ICONS[code] || 'check', label });
  });

  const section = document.getElementById('highlightsSection');
  if (!items.length){ section.hidden = true; return; }
  document.getElementById('highlightsList').innerHTML = items.map(it => `
    <div class="highlight">
      <span class="ic" aria-hidden="true">${ICON[it.icon] || ICON.check}</span>
      <span>${escapeHtml(it.label)}</span>
    </div>`).join('');
  section.hidden = false;
}

/* ---------- התיאור ומספר המודעה ----------
   הפאנל "פרטי הנכס" ירד: תוכנו התמזג לקפסולות שמעליו, ושתי טבלאות נתונים
   באותו עמוד רק פיצלו את תשומת הלב. מה שנשאר כאן הוא הטקסט החופשי — ומספר
   המודעה, שיורד לשורה מוצנעת בתחתית.                                       */
function renderDescription(p){
  // ‏marketing_description קודם: זה הנוסח שהסוכן/ת מרענן/ת ושומר/ת מה-CRM
  // ("התיאור השיווקי נשמר ומוצג בדף הנכס"). בסדר ההפוך כל נכס שיש לו גם
  // תיאור מודעה הציג את הישן לנצח, והרענון נשמר במסד ולא נראה בשום מקום.
  //
  // חוץ מנוסח **מתיישן**: הנתונים (מחיר, שטח, תיאור המודעה עצמו) השתנו אחרי
  // שנכתב, ולכן הוא עלול לצטט מחיר של אתמול. אז תיאור המודעה עדיף - ובמיוחד
  // כשהסוכן/ת בדיוק ערך/ה אותו, שאחרת לא היה נראה בדף. ‏docs/marketing-description.md
  const marketing = p.marketing_description_stale && p.description ? '' : p.marketing_description;
  const description = marketing || p.description || '';
  const block = document.getElementById('descSection');
  const textEl = document.getElementById('propDescription');
  textEl.textContent = description;
  block.hidden = !description;

  if (description){
    // כפתור ההרחבה מוצג רק כשהטקסט באמת נחתך — אחרת הוא מבטיח המשך שאין
    requestAnimationFrame(()=>{
      const toggle = document.getElementById('descToggle');
      const clipped = textEl.scrollHeight > textEl.clientHeight + 2;
      toggle.hidden = !clipped;
      if (clipped && !toggle.dataset.wired){
        toggle.dataset.wired = '1';
        toggle.addEventListener('click', ()=>{
          const open = block.classList.toggle('open');
          toggle.textContent = open ? 'הצגה מקוצרת' : 'המשך קריאה';
        });
      }
    });
  }

}

/* הלוגו של המשרד ברצועה שמתחת למפה. כשאין לוגו נשארת האות הראשונה של השם,
   ולוגו שנכשל בטעינה חוזר אליה — ריבוע ריק גרוע משתיהן. */
function renderAgencyAvatar(agency){
  const el = document.getElementById('agencyAvatar');
  const name = (agency && agency.name) || '';
  const initial = (name || '?')[0];
  const raw = (agency && typeof agency.logo_url === 'string') ? agency.logo_url.trim() : '';
  const logo = /^(https?:\/\/|\/|assets\/)/i.test(raw) ? raw : '';
  el.classList.remove('has-logo');
  el.textContent = initial;
  if (!logo) return;
  const img = document.createElement('img');
  img.src = logo;
  img.alt = name;
  img.loading = 'lazy';
  img.addEventListener('error', ()=>{
    el.classList.remove('has-logo');
    el.textContent = initial;
  });
  el.classList.add('has-logo');
  el.textContent = '';
  el.appendChild(img);
}

/* מספר המודעה הוא מה שהסוכן/ת מחפש/ת כדי לזהות על איזה נכס מדובר. במקום שורה
   מוצנעת בתחתית העמוד, שאיש לא מעתיק ממנה, הוא נכנס מראש לתיבת ההודעה בטופס
   הפנייה — הודעה מוכנה לשליחה שכבר נושאת את המספר. */
/* חלונית גבריאלה (assets/gabriela-widget.js): "פרטים על הנכס הזה" נושא את הנכס
   ואת המזהה שלו, ו-public-agent.ts טוען אותו לפי המזהה. הכותרת כאן ממוסכת:
   הדף עצמו מציג מספר בית, וההודעה שנפתחת בוואטסאפ לא. */
function setGabWidgetContext(p){
  const hood = p.neighborhoods?.name || p.sales_area || '';
  window.gabWidgetContext = { property: {
    id: p.id,
    title: maskedListingTitle(p),
    hood,
    rooms: p.rooms ? Number(p.rooms).toLocaleString('he-IL') : '',
    price: p.price ? priceLabel(p) : '',
  } };
  window.dispatchEvent(new Event('gabwidget:context'));
}

/* "בקשו תמונות מהמפרסם" (v10, סבב 4 חלק 3): הטופס הקיים, עם ההודעה המלאה והמקור
   photo_request. שום דבר לא נשלח בלחיצה - שם, טלפון ושליחה נשארים לגולש/ת */
let inquirySource = '';
function openInquiry(askPhotos){
  const form = document.getElementById('inquiryForm');
  if (!form) return;
  if (askPhotos && window.NoPhoto && currentProperty){
    document.getElementById('inqMessage').value = NoPhoto.STR.msg(currentProperty.title || 'הנכס');
    inquirySource = 'photo_request';
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(()=>document.getElementById('inqName').focus({ preventScroll: true }), 350);
}
function prefillInquiryMessage(p){
  if (!p.listing_number) return;
  const box = document.getElementById('inqMessage');
  if (box.value.trim()) return;
  box.value = INQUIRY_AUTO_PREFIX + p.listing_number + ' ורציתי לקבל עוד פרטים';
}

/* מי שכבר מסר/ה שם וטלפון באתר לא מקליד/ה אותם שוב. השדות מלאים מראש
   ולא נעולים: זו נוחות, ומי שרוצה לשלוח בשם מישהו אחר פשוט מוחק/ת. */
function prefillInquiryContact(){
  const saved = savedContact();
  if (!saved) return;
  const nameEl = document.getElementById('inqName');
  const phoneEl = document.getElementById('inqPhone');
  if (nameEl && !nameEl.value.trim()) nameEl.value = saved.name;
  if (phoneEl && !phoneEl.value.trim()) phoneEl.value = saved.phone;
}

// ‏escapeHtml עצמה מגיעה מ-assets/esc.js — הגדרה אחת לכל האתר.
// כתובות תמונה נכנסות לתוך src="…" — גרשיים בכתובת היו שוברות את התגית
function escapeAttr(s){ return escapeHtml(s); }

/* ---------- צבעי המשרד בכרטיס המשרד ----------
   דף הנכס שייך לפלטפורמה ולא למשרד, ולכן הצבעים שמנהל/ת המשרד בחר/ה לא
   נוגעים בטוקנים הגלובליים — הם נכנסים כמשתני CSS על רצועת המשרד בלבד.
   כך נכס נושא סימן ויזואלי של המשרד שמפרסם אותו, בלי שהמרקטפלייס יתחלף
   בצבעים בין מודעה למודעה. */
const AGENCY_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function agencyHex(value){
  return typeof value === 'string' && AGENCY_HEX_RE.test(value.trim()) ? value.trim() : null;
}
// טקסט לבן על גוון בהיר אינו קריא — אותה בדיקה שדף המשרד עושה
function agencyReadableOn(hex){
  const full = hex.length === 4 ? '#' + hex.slice(1).split('').map(c=>c+c).join('') : hex;
  const lum = [1,3,5].map(i=>{
    const ch = parseInt(full.slice(i, i+2), 16) / 255;
    return ch <= 0.03928 ? ch/12.92 : Math.pow((ch+0.055)/1.055, 2.4);
  }).reduce((acc, ch, i)=> acc + [0.2126,0.7152,0.0722][i] * ch, 0);
  return (1.05 / (lum + 0.05)) >= 3.2 ? '#fff' : '#0d1b3d';
}
function applyAgencyAccent(agency){
  const brand = agencyHex(agency && agency.colors && agency.colors.primary);
  if (!brand) return;
  const strip = document.getElementById('agencyStrip');
  strip.style.setProperty('--ag-brand', brand);
  strip.style.setProperty('--ag-brand-dark', agencyHex(agency.colors.primary_dark) || brand);
  strip.style.setProperty('--ag-accent', agencyHex(agency.colors.accent) || brand);
  strip.style.setProperty('--ag-on-brand', agencyReadableOn(brand));
}

/* ---------- תגיות הסטטוס שמעל התמונה ---------- */
function renderTags(p){
  const promotionActive = p.is_promoted && (!p.promoted_until || new Date(p.promoted_until) > new Date());
  const features = p.features || [];

  /* הכל יושב על התמונה הראשית ולא בשורה מתחתיה. שני סוגי תגיות באותה רצועה,
     ומה שמפריד ביניהן הוא צבע: קטגוריה (עסקה, סוג נכס, אזור) בזכוכית ניטרלית,
     סטטוס (מקודם, בבלעדיות) בצבע. סוג העסקה ראשון כי הוא הלייבל שמכוון קודם
     כל — "להשכרה" או "למכירה" קובע אם המודעה בכלל רלוונטית לקורא/ת. */
  const badges = [
    { cls:'badge-deal', icon:'', text: p.deal_type === 'rent' ? 'להשכרה' : 'למכירה' },
  ];
  if (promotionActive) badges.push({ cls:'badge-promo', icon:ICON.sparkle, text:'מקודם' });
  // היריד בא לפני הבלעדיות ואחרי הקידום: מתוך כל התגיות כאן זו היחידה
  // שמשנה את הסכום שהקונה ישלם בפועל.
  if (OpenHouse.live(p)) badges.push({ cls:'badge-openhouse', icon:'', text:OpenHouse.NO_FEE });
  if (features.includes('exclusive')) badges.push({ cls:'badge-exclusive', icon:ICON.star, text:'בבלעדיות' });
  if (p.property_type) badges.push({ cls:'', icon:'', text:p.property_type });
  if (p.sales_area) badges.push({ cls:'', icon:ICON.pin, text:p.sales_area });
  // הסיור מיוצג בכפתור שעל התמונה, שמוביל אליו בפועל. התגית שהוצגה כאן על
  // הדגל היבש ‎tour_3d‎ הבטיחה סיור בלי לתת דרך להגיע אליו, והדגל עצמו כבר
  // לא קיים בטופס הנכס.
  if (features.includes('price_dropped')) badges.push({ cls:'', icon:ICON.trend, text:'המחיר ירד' });

  document.getElementById('heroBadges').innerHTML = badges.map(b =>
    `<span class="badge ${b.cls}">${b.icon}${escapeHtml(b.text)}</span>`).join('');
}

/* ---------- כותרת וכתובת ציבוריות ----------
   הכותרת בדף הנכס היא "<סוג> <חדרים> חד׳ ב<רחוב> <מספר>, <עיר>" כשיש
   סוג ורחוב. מספר הבית נכתב פעם אחת, אחרי שם הרחוב. חסר אחד מהשניים,
   והכותרת חוזרת לכותרת שנשמרה במסד אחרי מיסוך המספר, כדי לא להמציא כתובת.

   שורת הכתובת ושורת המפה מציגות רחוב ומספר, שכונה ועיר. גוש, חלקה
   וקואורדינטות לא נכתבים ל-HTML. אריחי הרשימה (property-card.js) נשארים
   בלי מספר בית. גבריאלה בוואטסאפ עדיין ממסכת את המספר כשהיא עונה מהמסד
   (public-agent.ts). חלון הוואטסאפ מהדף שולח את הכותרת הממוסכת, לא את
   הכותרת עם המספר, כדי שהשיחה לא תיפתח עם מספר הדלת.

   maskHouseNumber מוחקת מספר ולא מילה: גבול ספרה משני הצדדים, כדי
   ש-"52" לא ייחתך מתוך "152" ולא מתוך "128 מ״ר". העתק ב-og-tags.ts. */
function maskHouseNumber(text, houseNumber){
  const t = String(text || '');
  const hn = String(houseNumber ?? '').trim();
  if (!t || !hn) return t;
  const re = new RegExp('(^|[^\\d])' + hn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'g');
  return t.replace(re, '$1')
          .replace(/\s+/g, ' ')
          .replace(/\s+([,\u00B7])/g, '$1')
          .replace(/^[\s,\u00B7\u2014\u2013-]+|[\s,\u00B7\u2014\u2013-]+$/g, '')
          .trim();
}

/* השכונה מגיעה מטבלת ה-neighborhoods; ‏sales_area הוא הגיבוי כשלנכס לא
   שויכה שכונה. שכונה ששמה כשם העיר לא נכתבת פעמיים. */
function roomsShort(n){
  if (n === null || n === undefined || String(n).trim() === '') return '';
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '';
  return String(Number(v.toFixed(1)));
}

function streetNameOf(p){
  const raw = String((p && (p.street || p.address)) || '').trim();
  return maskHouseNumber(raw, p && p.house_number)
    .replace(/^רחוב\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicStreetLine(p){
  const street = streetNameOf(p);
  const hn = String((p && p.house_number) ?? '').trim();
  if (!street) return '';
  return hn ? street + ' ' + hn : street;
}

/* כותרת הדף. בלי סוג או בלי רחוב אין דפוס, ונשארת הכותרת הממוסכת. */
function publicHeadline(p){
  const type = String((p && p.property_type) || '').trim();
  const street = streetNameOf(p);
  const city = String((p && p.city) || '').trim();
  const hn = String((p && p.house_number) ?? '').trim();
  const rooms = roomsShort(p && p.rooms);
  const fallback = maskHouseNumber((p && p.title) || '', p && p.house_number) || String((p && p.title) || '');
  if (!type || !street) return fallback;
  let head = type;
  if (rooms) head += ' ' + rooms + ' חד׳';
  head += ' ב' + street;
  if (hn) head += ' ' + hn;
  if (city) head += ', ' + city;
  return head;
}

function publicAddressText(p){
  const hood = p.neighborhoods?.name || p.sales_area || '';
  const line = publicStreetLine(p);
  return [line, hood && hood !== p.city ? hood : '', p.city]
    .filter(Boolean).join(', ');
}

/* קישור לדף השכונה (‏/n/{עיר}/{שכונה}, docs/neighborhood-pages.md) - רק לשכונה
   שיש לה דף שנכנס לאינדקס. קריאה נפרדת ולא חלק מהשליפה של הנכס: היא נשענת על
   מיגרציה (20270728090000), והאתר עולה לפני המסד; כשל בה פשוט משאיר את
   הכתובת בלי קישור. */
function linkNeighborhoodPage(p, addressEl){
  const name = p.neighborhoods && p.neighborhoods.name;
  if (!name || !addressEl) return;
  // ‏GET עם סינון על תוצאת הפונקציה - שורה אחת ולא כל השכונות
  const q = 'name=eq.' + encodeURIComponent(name) + (p.city ? '&city=eq.' + encodeURIComponent(p.city) : '')
    + '&select=city_slug,slug&limit=1';
  fetch(SUPABASE_URL + '/rest/v1/rpc/neighborhood_pages_public?' + q, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
  }).then(r => r.ok ? r.json() : null).then(rows => {
    const hit = Array.isArray(rows) && rows[0];
    if (!hit) return;
    const a = document.createElement('a');
    a.className = 'prop-hood-link';
    a.href = '/n/' + encodeURIComponent(hit.city_slug) + '/' + encodeURIComponent(hit.slug);
    a.textContent = 'על השכונה ←';
    addressEl.appendChild(a);
  }).catch(() => {});
}

function publicTitle(p){
  return publicHeadline(p) || maskHouseNumber(p.title || '', p.house_number) || (p.title || '');
}

/* מבדיל את <title> רק כשיש עוד מודעה פעילה עם אותה כותרת. כותרת יחידה
   נשארת publicTitle כמו שהייתה. אותו סדר כמו titleSuffix ב-og-tags.ts:
   שטח, קומה, מכירה/השכרה, מחיר. ה-H1 (#propTitle) לא משתנה. */
function bitSqm(p){
  const n = roomsShort(p && p.size_sqm);
  return n ? n + ' מ״ר' : '';
}
function bitFloor(p){
  if (!p || p.floor === null || p.floor === undefined || String(p.floor).trim() === '') return '';
  const floor = Number(p.floor);
  if (!isFinite(floor)) return '';
  return floor === 0 ? 'קומת קרקע' : 'קומה ' + String(floor);
}
function bitDeal(p){
  if (!p) return '';
  if (p.deal_type === 'rent') return 'להשכרה';
  if (p.deal_type === 'sale') return 'למכירה';
  return '';
}
/* מחיר חסר או 0 אינו מבדיל. אותו תנאי כמו bitPrice ב-og-tags.ts. */
function bitPrice(p){
  const v = Number(p && p.price);
  return isFinite(v) && v > 0 ? '₪' + v.toLocaleString('he-IL') : '';
}
function distinctTitleSuffix(self, rows){
  const base = publicHeadline(self);
  const group = (rows || []).filter(function(row){ return publicHeadline(row) === base; });
  const selfId = String((self && self.id) || '');
  if (!group.some(function(row){ return String((row && row.id) || '') === selfId; })) group.push(self);
  if (group.length < 2) return '';
  const picks = [bitSqm, bitFloor, bitDeal, bitPrice];
  const parts = [];
  let left = group;
  for (let i = 0; i < picks.length; i++){
    const mine = picks[i](self);
    if (!mine) continue;
    const same = left.filter(function(row){ return picks[i](row) === mine; });
    if (same.length < left.length){
      parts.push(mine);
      left = same;
      if (left.length < 2) break;
    }
  }
  return parts.length ? ' · ' + parts.join(' · ') : '';
}
/* אותו siblingFilter ו-pageTitle כמו ב-og-tags, מ-assets/listing-title.js.
   neighborhood נשאר באובייקט ולא נכנס לשאילתה: publicHeadline לא כולל שכונה. */
function listingHoodName(p){
  var n = p && p.neighborhoods;
  var row = Array.isArray(n) ? n[0] : n;
  var name = row && row.name ? String(row.name).trim() : '';
  var city = String((p && p.city) || '').trim();
  return name && name !== city ? name : '';
}
function siblingQuery(p){
  return ShukListingTitle.siblingFilter({
    city: p && p.city,
    property_type: p && p.property_type,
    streetName: streetNameOf(p),
    neighborhood: listingHoodName(p),
  });
}
function loadSiblings(p){
  var filter = siblingQuery(p);
  if (!filter) return Promise.resolve(null);
  var headers = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, Accept: 'application/json' };
  var pageSize = ShukListingTitle.SIBLING_PAGE;
  var all = [];
  function page(offset){
    return fetch(SUPABASE_URL + '/rest/v1/properties?' + filter + '&offset=' + offset, { headers: headers })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(rows){
        if (!Array.isArray(rows)) return null;
        all = all.concat(rows);
        if (rows.length < pageSize) return all;
        if (offset >= pageSize * 5) return null;
        return page(offset + pageSize);
      });
  }
  return page(0).catch(function(){ return null; });
}
/* כשהשאילתה מצליחה, אותה כותרת כמו בשרת. כשל לא דורס את כותרת השרת. */
function applyDistinctTitle(p){
  var base = publicTitle(p);
  if (!siblingQuery(p)){
    document.title = ShukListingTitle.pageTitle(base, '');
    return;
  }
  loadSiblings(p).then(function(rows){
    if (!Array.isArray(rows)) return;
    document.title = ShukListingTitle.pageTitle(base, distinctTitleSuffix(p, rows));
  });
}

function maskedListingTitle(p){
  return maskHouseNumber(p.title || '', p.house_number) || (p.title || '');
}

/* ---------- יריד הבתים הפתוחים ----------
   הרצועה נבנית רק כשהחלון פתוח *עכשיו*: ‏open_house לבדו נכבה ב-cron כל
   רבע שעה, והבטחה של "ללא עמלת תיווך" שממשיכה להופיע רבע שעה אחרי שהחלון
   נסגר היא בדיוק סוג הטעות שיריד לא יכול להרשות לעצמו. אותה בדיקה בדיוק
   מפעילה את התגית שעל התמונה, את הסימן על המפה בדף הבית ואת האריח במדף —
   כולן דרך ‎OpenHouse.live()‎ ב-assets/open-house.js. */
function renderOpenHouseBand(p){
  const host = document.getElementById('openHouseBand');
  if (!host) return;
  if (!OpenHouse.live(p)){ host.hidden = true; host.innerHTML = ''; return; }

  host.innerHTML =
    '<div class="oh-band">' +
      '<span class="oh-tile">' + OpenHouse.icon({ size:42 }) + '</span>' +
      '<div class="oh-band-body">' +
        '<b>' + OpenHouse.NO_FEE + ' - הנכס ביריד הבתים הפתוחים</b>' +
        '<span>הנכס מוצע לקונים ללא עמלת תיווך בתקופה ' +
          escapeHtml(OpenHouse.rangeLabel(p)) + '</span>' +
      '</div>' +
      // הספירה לאחור ולא רק התאריך: "נותרו 2 ימים 04:11" הוא אותו מידע
      // בדיוק, אבל הוא זה שגורם להרים טלפון היום ולא בשבוע הבא
      OpenHouse.countdownHtml(p) +
      '<a href="/open-house">לכל נכסי היריד ←</a>' +
    '</div>';
  host.hidden = false;
}

function renderProperty(p){
  applyDistinctTitle(p);
  renderGallery(p);
  renderMediaButtons(p);
  // הקידום נמכר לחלון של 72 שעות. ‏expire_promotions ב-DB מכבה את is_promoted
  // כל רבע שעה, ובדיקת promoted_until כאן סוגרת גם את הפער הזה.
  // ‏promoted_until ריק = קידום ידני/היסטורי בלי מועד סיום.
  renderTags(p);

  const price = priceParts(p);
  document.getElementById('heroPriceNum').innerHTML =
    escapeHtml(price.num) + (price.suffix ? `<span class="suffix">${escapeHtml(price.suffix)}</span>` : '');
  // ‏price_per_sqm מתעלמת מ-price_unit (ב-13 מסחריים יצא 0-2 ₪): כשהמחיר כבר למ״ר - הוא עצמו (P1-N, ד-9)
  const ppsqm = p.price_unit === 'sqm' ? Number(p.price) : Number(p.price_per_sqm);
  document.getElementById('heroPriceSub').textContent =
    ppsqm ? ppsqm.toLocaleString('he-IL') + ' ₪ למ״ר' : (p.deal_type === 'rent' ? 'להשכרה' : 'למכירה');
  document.getElementById('heroPrice').hidden = false;

  document.getElementById('propTitle').textContent = publicTitle(p);
  if (p.listing_number){
    document.getElementById('listingNoN').textContent = p.listing_number;
    document.getElementById('listingNo').hidden = false;
    document.getElementById('listingCopy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(String(p.listing_number)); e.target.textContent = 'הועתק'; }
      catch(_){ e.target.textContent = String(p.listing_number); }
      setTimeout(() => { e.target.textContent = 'העתקה'; }, 2000);
    };
  }
  const addressText = publicAddressText(p);
  const addressEl = document.getElementById('propAddress');
  addressEl.innerHTML = addressText ? ICON.pin + `<span>${escapeHtml(addressText)}</span>` : '';
  linkNeighborhoodPage(p, addressEl);
  renderOpenHouseBand(p);

  renderSpecPills(p);
  renderHighlights(p);
  renderDescription(p);

  // המחיר חוזר בכרטיס ההמרה ובסרגל התחתון — שם הוא צמוד לכפתור הפעולה
  const perSqm = priceUnitOf(p) === 'sqm';
  const priceLabelText = perSqm ? (p.deal_type === 'rent' ? 'שכירות למ״ר לחודש' : 'מחיר למ״ר')
    : p.deal_type === 'rent' ? 'שכר דירה חודשי' : 'מחיר מבוקש';
  document.getElementById('agentPriceLabel').textContent = priceLabelText;
  document.getElementById('agentPriceValue').textContent = priceFlat(p);
  document.getElementById('sbPriceLabel').textContent = perSqm ? 'למ״ר' : p.deal_type === 'rent' ? 'לחודש' : 'מחיר';
  document.getElementById('sbPriceValue').textContent = priceFlat(p);

  document.getElementById('agencyName').textContent = p.agencies?.name || 'משרד תיווך';
  renderAgencyAvatar(p.agencies);
  applyAgencyAccent(p.agencies);
  // שם הסוכן/ת המטפל/ת לא חוזר כאן: הרצועה היא הקישור למשרד, והכרטיס שמתחתיה
  // כבר נושא את השם, התמונה, הרישיון וכפתורי הפנייה. שתי הופעות של אותו שם
  // בשתי שורות סמוכות רק גזלו מקום מהזהות של המשרד.
  // הטלפון של סוכן/ת 2 לא מוצג באתר, בדיוק כמו של סוכן/ת 1 — הפנייה עוברת
  // בטופס או בכפתורי הוואטסאפ של הסוכן/ת הראשי/ת
  const agentLine = p.agent2_name ? 'בשיתוף: ' + p.agent2_name : '';
  const agentLineEl = document.getElementById('agentName');
  agentLineEl.textContent = agentLine;
  agentLineEl.hidden = !agentLine;
  renderAgentCard(p);
  renderContactButtons(p);
  prefillInquiryMessage(p);
  setGabWidgetContext(p);
  applyOwnerLeadAgent(p);
  prefillInquiryContact();
  document.getElementById('agencyStrip').addEventListener('click', ()=>{
    if (p.agencies?.slug) window.location.href = '/agency?slug=' + p.agencies.slug;
  });

  // המפה נטענת ברקע: היא דורשת בדיקת זכאות נוספת מול ה-DB, ואין סיבה שהיא
  // תעכב את רינדור הנכס עצמו.
  initPropertyMap(p, addressText);

  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('propertyContent').style.display = 'block';

  // מחשבון משכנתא על מודעת השכרה הוא שטות: אין מחיר רכישה ואין מימון.
  // הכרטיס כולו יורד, ואיתו כפתור הליד — אין טעם לייצר ליד משכנתא משוכר/ת.
  const isRent = p.deal_type === 'rent';
  document.querySelector('.calc-card').style.display = isRent ? 'none' : 'flex';
  if (!isRent){
    syncEquityRangeToProperty();
    updateCalculator();
  }
}

/* ---------- כרטיס הסוכן/ת ----------
   תמונה אמיתית כשיש אחת, אחרת ראשי תיבות. תג "מתווך/ת מורשה/ית" מוצג רק
   כשיש מספר רישיון במסד — תג אמון בלי כיסוי גרוע מהיעדר תג.               */
function renderAgentCard(p){
  const agent = p.agency_members;
  /* ‏P1-V (v10): הכרטיס המשותף (‏assets/agent-card.js) במקום ראש הכרטיס, בלי כפתור ובלי
     וואטסאפ משלו - הטופס ודרכי הקשר שמתחתיו נשארים (§C.4a, בלי כפילות) */
  if (agent && window.AgentCard && document.documentElement.classList.contains('beta-hero')){
    const top = document.querySelector('.agent-top');
    const box = document.createElement('div');
    box.className = 'agent-agc';
    // ‏N1: בלי "✓ רישיון מאומת" - אין עדיין אימות (שער הרישיון, ד-1); המספר מוצג כעובדה, כמו קודם
    box.innerHTML = AgentCard.html(agent, { agency: p.agencies?.name || '', actions: false, showLicense: true });
    top.hidden = true;
    top.after(box);
  }
  const name = agent?.display_name || p.agencies?.name || 'צוות שוק נדל״ן';
  document.getElementById('agentCardName').textContent = name;
  document.getElementById('agentCardAgency').textContent = p.agencies?.name || '';

  const photoEl = document.getElementById('agentPhoto');
  // אותה תמונה משרתת את כרטיס ההמרה ואת הסרגל התחתון: זה אותו אדם בשני
  // רגעים שונים בגלילה, ולא שני אנשי קשר
  const avatarEl = document.getElementById('sbAvatar');
  if (agent?.photo_url){
    const focus = /^\d{1,3}% \d{1,3}%$/.test(agent.photo_position || '') ? agent.photo_position : '';
    const img = `<img src="${escapeAttr(agent.photo_url)}" alt="${escapeAttr(name)}"${focus ? ` style="--photo-pos:${focus}"` : ''}>`;
    photoEl.innerHTML = img;
    avatarEl.innerHTML = img;
  } else {
    photoEl.textContent = (name || '?')[0];
    avatarEl.textContent = (name || '?')[0];
  }

  if (agent?.license_number){
    const licenseEl = document.getElementById('agentCredLicense');
    licenseEl.textContent = 'רישיון: ' + agent.license_number;
    licenseEl.hidden = false;
    document.getElementById('agentCred').hidden = false;
  }

  // ראש הכרטיס מוביל לעמוד הסוכן/ת. ‏slug ובהיעדרו ה-id הגולמי — בדיוק
  // המפתח ש-agent.html יודע לקבל, ואותו קישור שכבר קיים ב-agents.html
  // וב-agency.html. אין שורת סוכן/ת במסד = אין קישור: ראש הכרטיס נושא אז
  // את שם המשרד בלבד, ואין עמוד להוביל אליו.
  const agentKey = agent && (agent.slug || p.agent_id);
  if (agentKey){
    const topEl = document.querySelector('.agent-top');
    topEl.classList.add('is-link');
    topEl.setAttribute('role', 'link');
    topEl.tabIndex = 0;
    topEl.setAttribute('aria-label', 'לעמוד של ' + name);
    const openAgent = ()=>{ window.location.href = '/agent?slug=' + encodeURIComponent(agentKey); };
    topEl.addEventListener('click', openAgent);
    // ‏role=link בלי מקלדת הוא תג ריק: אנטר ורווח חייבים לעשות את מה
    // שהעכבר עושה, כי הראש הוא ‎div‎ ולא ‎a‎.
    topEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openAgent(); }
    });
  }

  // תו האיכות של הסוכן/ת המטפל/ת, לצד התמונה שלו/ה בראש כרטיס ההמרה: זה
  // הרגע שבו הגולש/ת מחליט/ה אם להשאיר פרטים, ולכן זה המקום שבו התו עובד.
  if (agent?.has_ethics_badge && window.QualityBadge){
    QualityBadge.mount('agentBadge', { size:'md', tone:'dark', subject:name });
  }
}

/* ---------- כפתורי יצירת קשר ----------
   ‏phone_e164 מגיע מהמסד כספרות בלבד בפורמט 972521112222 — בדיוק מה שגם
   wa.me וגם tel: מצפים לו, ולכן אין כאן נרמול בצד הלקוח. אין טלפון (או שאין
   סוכן/ת משויך/ת) = אין כפתורים: קישור וואטסאפ לשום מקום גרוע מהיעדר כפתור,
   ואז הסרגל התחתון מציג כפתור שגולל לטופס.
   ההודעה נפתחת מוכנה עם שם הנכס, המחיר וקישור לעמוד, כדי שהסוכן/ת יידע/תדע
   על איזה נכס מדובר עוד לפני שהגולש/ת מקליד/ה מילה.                        */
/* ---------- מתי הסרגל התחתון נדלק ----------
   כשכרטיס ההמרה יוצא מהמסך, ולא מרגע הטעינה. ‏IntersectionObserver ולא
   מאזין scroll — הדפדפן כבר יודע לענות על השאלה הזו בלי לחשב מיקומים
   בכל פריים. */
function watchStickyBar(){
  const card = document.querySelector('.agent-card');
  if (!('IntersectionObserver' in window) || !card){
    // בלי Observer עדיף סרגל שנוכח תמיד מאשר סרגל שלא נדלק לעולם
    document.body.classList.add('sticky-on');
    return;
  }
  new IntersectionObserver(([entry])=>{
    document.body.classList.toggle('sticky-on', !entry.isIntersecting);
  }, { rootMargin: '-60px 0px 0px 0px' }).observe(card);
}

let stickyWatched = false;
let fairEndTimer = 0;
function renderContactButtons(p){
  document.body.classList.add('has-sticky-bar');
  if (!stickyWatched){ watchStickyBar(); stickyWatched = true; }
  /* נכס ביריד: הטופס, וגם וואטסאפ וחיוג. הלחיצה נרשמת ברקע
     (assets/fair-contact.js) בלי לעכב את הפתיחה. דף שנשאר פתוח אחרי
     סוף היריד מוריד את הסימון, ולכן הפונקציה רצה שוב ברגע הסיום. */
  const fair = OpenHouse.live(p);
  const lineEl = document.getElementById('fairFormLine');
  const line = fair ? OpenHouse.formLine(p) : '';
  if (lineEl){ lineEl.textContent = line; lineEl.hidden = !line; }
  if (fair && !fairEndTimer){
    const ms = OpenHouse.endsAt(p) - Date.now();
    if (ms > 0 && ms < 2 ** 31 - 1) fairEndTimer = setTimeout(()=> renderContactButtons(p), ms + 1000);
  }
  const phone = p.agency_members?.phone_e164;
  const fairAttr = (channel) => fair && p.id
    ? ` data-fair-contact="${channel}" data-fair-property="${escapeAttr(p.id)}" data-fair-page="property"`
    : '';
  const markFair = (el, channel) => {
    if (!el) return;
    if (fair && p.id){
      el.setAttribute('data-fair-contact', channel);
      el.setAttribute('data-fair-property', p.id);
      el.setAttribute('data-fair-page', 'property');
    } else {
      el.removeAttribute('data-fair-contact');
      el.removeAttribute('data-fair-property');
      el.removeAttribute('data-fair-page');
    }
  };
  const agentName = p.agency_members?.display_name || '';
  const formBtn = document.getElementById('sbFormBtn');
  formBtn.onclick = ()=>{
    document.querySelector('.agent-card').scrollIntoView({ behavior:'smooth', block:'center' });
    setTimeout(()=> document.getElementById('inqName').focus(), 420);
  };

  if (!phone){
    // בלי טלפון נשארת רק דרך אחת ליצור קשר: הטופס
    formBtn.hidden = false;
    return;
  }
  formBtn.hidden = true;

  // הקישור בשורה נפרדת בסוף: הקצר (‏/p/{מספר מודעה}, ‏short-link.ts), ובלי מספר - הכתובת
  const link = p.listing_number ? 'https://shuknadlan.co.il/p/' + p.listing_number : window.location.href;
  const text = [
    'היי' + (agentName ? ' ' + agentName : '') + ',',
    `ראיתי בשוק נדל״ן את הנכס "${p.title}" (${priceLabel(p)}) ואשמח לקבל פרטים נוספים.`,
    link,
  ].join('\n');
  const waHref = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  const telHref = 'tel:+' + phone;
  const waAria = agentName ? 'שליחת הודעת וואטסאפ ל' + agentName : 'שליחת הודעת וואטסאפ לסוכן המטפל';

  // בועה צפה (דסקטופ)
  const bubble = document.getElementById('waBubble');
  bubble.href = waHref;
  bubble.setAttribute('aria-label', waAria);
  document.getElementById('waBubbleLabel').textContent = agentName ? 'וואטסאפ · ' + agentName : 'וואטסאפ לסוכן';
  bubble.hidden = false;
  markFair(bubble, 'whatsapp');

  // סרגל תחתון (מובייל)
  const sbWa = document.getElementById('sbWaBtn');
  sbWa.href = waHref;
  sbWa.setAttribute('aria-label', waAria);
  sbWa.hidden = false;
  markFair(sbWa, 'whatsapp');
  const sbCall = document.getElementById('sbCallBtn');
  sbCall.href = telHref;
  sbCall.hidden = false;
  markFair(sbCall, 'call');

  // כפתורים בכרטיס ההמרה
  document.getElementById('agentActions').innerHTML = `
    <a class="btn-wa" href="${escapeAttr(waHref)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(waAria)}"${fairAttr('whatsapp')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.2.1-1.9-.1a13 13 0 0 1-5.6-4.6c-.6-.9-1-1.9-1-2.8 0-1 .5-1.7 1-2 .2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.5.9 1.1 1.6 2 2.2.3.2.5.2.7 0l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.4.4.1.2.1.7-.1 1.4Z"></path></svg>
      וואטסאפ מהיר
    </a>
    <a class="btn-call" href="${escapeAttr(telHref)}" aria-label="חיוג לסוכן"${fairAttr('call')}>
      ${ICON.call}<span>חייגו</span>
    </a>`;
}

/* ---------- שמירה (§6, v10 בלבד) ----------
   אותה רשימה של "המועדפים" בהחלקה ובבועה: ‏sk_swipe_likes, מזהים, החדש בסוף,
   200 אחרונים. לשונית אחרת מתעדכנת מאירוע storage; הבועה באותה לשונית -
   דרך LikesBubble.sync(). */
function loadLikes(){
  if (window.ShukLikes) return ShukLikes.list();
  try { return (JSON.parse(localStorage.getItem('sk_swipe_likes') || '[]') || []).filter(Boolean); }
  catch(e){ return []; }
}
function initSave(id){
  if (!document.documentElement.classList.contains('beta-hero')) return;
  const btns = [document.getElementById('saveBtn'), document.getElementById('sbSaveBtn')].filter(Boolean);
  const paint = ()=>{
    const saved = loadLikes().indexOf(id) >= 0;
    btns.forEach(b => {
      b.setAttribute('aria-pressed', String(saved));
      b.setAttribute('aria-label', saved ? 'שמירה, נשמר במועדפים' : 'שמירה');
    });
  };
  btns.forEach(b => { b.onclick = ()=>{
    let saved;
    if (window.ShukLikes) saved = ShukLikes.toggle(id);   // קריאה טרייה, תקרת 200, ומשדר shuk-likes
    else {
      const list = loadLikes().filter(x => x !== id);
      saved = list.length === loadLikes().length;
      if (saved) list.push(id);
      try { localStorage.setItem('sk_swipe_likes', JSON.stringify(list.slice(-200))); } catch(e){}
    }
    paint();
    if (window.LikesBubble) LikesBubble.sync();
    showToast(saved ? 'נשמר במועדפים' : 'הוסר מהמועדפים');
    if (window.shukTrack) shukTrack('property_save_toggle', { property_id: id, saved });
  }; });
  window.addEventListener('storage', e => { if (e.key === 'sk_swipe_likes') paint(); });
  // אותה לשונית: הסרה בפאנל שבכותרת (‏likes-bubble.js) משנה את הכפתור מיד
  window.addEventListener('shuk-likes', paint);
  paint();
}

/* ---------- שיתוף ----------
   ‏navigator.share קיים בכל דפדפני המובייל ומוביל ישירות לוואטסאפ של
   הגולש/ת; בדסקטופ נופלים להעתקת הקישור. */
document.getElementById('shareBtn').addEventListener('click', async ()=>{
  const url = window.location.href;
  const title = currentProperty?.title || 'נכס בשוק נדל״ן';
  try{
    if (navigator.share){
      await navigator.share({ title, url });
      /* אחרי ה-await ולא לפניו: תפריט שיתוף שנסגר בלי לשתף זורק AbortError
         ומטופל למטה, ולכן ביטול לא נספר כשיתוף. */
      if (window.shukTrack) shukTrack('share', { method:'web_share', item_name: title });
      return;
    }
    await navigator.clipboard.writeText(url);
    if (window.shukTrack) shukTrack('share', { method:'copy_link', item_name: title });
    showToast('הקישור לנכס הועתק');
  } catch(e){
    if (e && e.name === 'AbortError') return; // הגולש/ת ביטל/ה את תפריט השיתוף
    showToast('לא הצלחנו לשתף - אפשר להעתיק את הכתובת מהדפדפן');
  }
});

/* ---------- Mortgage calculator, price pre-filled from this property ----------
   בניגוד למחשבון בדף הבית, כאן מחיר הנכס אינו נתון לבחירה — הוא המחיר של
   הנכס שבעמוד. לכן הסליידר היחיד הוא ההון העצמי, והטווח שלו נגזר מהמחיר
   ברגע שהנכס נטען.                                                        */
const nis = n => Math.round(n).toLocaleString('he-IL');

function paintRange(el){
  const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
  const pct = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--p', pct.toFixed(2) + '%');
}

// טווח ההון העצמי נקבע לפי הנכס: אין טעם לאפשר 3 מיליון הון עצמי על דירה
// ב-900 אלף. ברירת המחדל היא 25% מהמחיר — הון עצמי מינימלי לדירה יחידה.
function syncEquityRangeToProperty(){
  const price = Number(currentProperty?.price) || 0;
  const equityEl = document.getElementById('calcEquity');
  if (price <= 0) return;
  equityEl.max = Math.round(price);
  equityEl.step = Math.max(1000, Math.round(price / 200 / 1000) * 1000);
  equityEl.value = Math.round(price * 0.25);
}

function updateCalculator(){
  if (!currentProperty) return;
  const price = Number(currentProperty.price) || 0;
  const equityEl = document.getElementById('calcEquity');
  const equity = parseFloat(equityEl.value) || 0;
  const annualRate = parseFloat(document.getElementById('calcRate').value) || 0;
  const years = parseFloat(document.getElementById('calcYears').value) || 1;

  paintRange(equityEl);
  document.getElementById('calcPriceLabel').textContent = nis(price) + ' ₪';
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

  const warn = document.getElementById('ltvWarn');
  warn.textContent = (ltvPct > LTV_THRESHOLDS.single*100)
    ? `אחוז המימון הנדרש (${ltvPct}%) חורג מהתקרה המקובלת לדירה יחידה (75%)`
    : '';
}
['calcEquity','calcRate','calcYears'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateCalculator);
});
/* כפתורי ‎−/+‎. clamp ל-min/max ועיגול לפי ה-step כדי שלא ייווצרו שאריות
   float כמו 4.800000000000001. */
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

/* ---------- בלון ליד ייעוץ משכנתאות ----------
   זהה לבלון שבדף הבית, עם הבדל אחד מהותי: הליד נושא איתו את property_id
   ו-source='property_page'. ליד שנולד מול נכס ספציפי הוא ליד אחר מבחינת
   היועצ/ת, וזה מה שהיא רואה במדף לפני שהיא משלמת.                       */
const MORTGAGE_LEAD_FUNCTION_URL = SUPABASE_URL + '/functions/v1/mortgage-lead-intake';

const mleadModal   = document.getElementById('mleadModal');
const mleadForm    = document.getElementById('mleadForm');
const mleadDone    = document.getElementById('mleadDone');
const mleadErrorEl = document.getElementById('mleadError');
let mleadSnapshot = {};

// המספר שעל המסך הוא המספר שנשלח — קריאה חוזרת לנוסחה רק תפתח פתח לסטייה
function mleadMonthlyFromDisplay(){
  const digits = document.getElementById('calcMonthly').textContent.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function mleadOpen(){
  const price  = Number(currentProperty?.price) || 0;
  const equity = parseFloat(document.getElementById('calcEquity').value) || 0;
  const loan   = Math.max(price - equity, 0);
  mleadSnapshot = {
    property_price: price,
    equity: equity,
    interest_rate: parseFloat(document.getElementById('calcRate').value) || null,
    years: parseInt(document.getElementById('calcYears').value, 10) || null,
    monthly_payment: mleadMonthlyFromDisplay(),
    property_id: currentProperty?.id || null,
    source: 'property_page',
  };
  const ltv = price > 0 ? Math.round((loan/price)*100) : 0;
  document.getElementById('mleadRecap').textContent =
    `${currentProperty?.title || 'הנכס'} · ${nis(price)} ₪ · הון עצמי ${nis(equity)} ₪ · ` +
    `${ltv}% מימון · ${mleadSnapshot.years} שנים בריבית ${mleadSnapshot.interest_rate}%`;
  mleadErrorEl.textContent = '';
  mleadModal.classList.add('open');
  document.getElementById('mleadName').focus();
}
function mleadClose(){ mleadModal.classList.remove('open'); }

document.getElementById('mleadOpenBtn').addEventListener('click', ()=>{
  if (!currentProperty){ showToast('הנכס עדיין נטען, נסו שוב בעוד רגע'); return; }
  mleadOpen();
});
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

  // אותן בדיקות רצות שוב ב-Edge Function — כאן רק כדי לחסוך הלוך-ושוב לשרת
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
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + SUPABASE_ANON_KEY },
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
  } catch(err){
    console.error('mortgage-lead-intake failed:', err);
    mleadErrorEl.textContent = 'השליחה נכשלה - בדקו חיבור לאינטרנט ונסו שוב';
    btn.textContent = originalLabel;
    btn.disabled = false;
  }
});

/* ---------- Inquiry form ---------- */
document.getElementById('inquiryForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!currentProperty){ showToast('הנכס עדיין נטען, נסו שוב בעוד רגע'); return; }
  const btn = document.getElementById('inquirySubmit');
  const feedback = document.getElementById('inquiryFeedback');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'שולח…'; feedback.textContent = '';
  try{
    const res = await fetch(INQUIRY_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({
        property_id: currentProperty.id,
        name: document.getElementById('inqName').value,
        phone: document.getElementById('inqPhone').value,
        message: document.getElementById('inqMessage').value || null,
        ...(inquirySource ? { source: inquirySource } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'שגיאה');
    feedback.style.color = 'var(--teal)';
    feedback.textContent = 'הפנייה נשלחה! יועץ הנדל״ן יחזור אליכם בקרוב';
    /* רק אחרי שהשרת אישר. ליד שנכשל בשליחה אינו ליד. */
    if (window.shukTrack) shukTrack('generate_lead', {
      form_id: inquirySource === 'photo_request' ? 'photo_request' : 'property_inquiry',
      item_name: currentProperty.title || '',
      value: Number(currentProperty.price) || 0,
      currency: 'ILS',
    });
    /* אותם פרטים לא נשאלים שוב באותו נכס — גם לא בטופס ההדמיה */
    rememberContact(
      document.getElementById('inqName').value.trim(),
      document.getElementById('inqPhone').value.trim(),
      currentProperty.id
    );
    document.getElementById('inquiryForm').reset();
    inquirySource = '';
    // reset מחזיר את השדות לערך שב-HTML (ריק) — ההודעה המוכנה והפרטים
    // השמורים נכתבים שוב
    prefillInquiryMessage(currentProperty);
    prefillInquiryContact();
  } catch(err){
    console.error(err);
    feedback.style.color = 'var(--brick)';
    feedback.textContent = 'שגיאה בשליחה - נסו שוב';
  } finally {
    setTimeout(()=>{ btn.disabled = false; btn.textContent = original; }, 400);
  }
});

initVisualizationForm();
initOwnerLeadForm();
loadProperty();
