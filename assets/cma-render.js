/* ==========================================================================
   assets/cma-render.js - תצוגת דוח ה-CMA, משותפת ל-CRM ולדף /cma?k=
   --------------------------------------------------------------------------
   הועבר כמו שהוא מ-assets/crm.js (25.10.2026), כדי שהדף שגבריאלה שולחת
   (‏cma.html) יציג **את אותו דוח** ולא עותק שמתפצל. השינוי היחיד: שמות
   המאפיינים (‏cmaFeatureLabel) נקראים בעצלות, כי הקובץ נטען לפני crm.js.

   תלויות שהקורא מספק (ב-CRM - crm.js; בדף - assets/cma-page.js):
   esc, shekel, plural, hebDate. ‏renderCmaReport כותבת ל-#cmaBody ומציגה
   את #cmaOverlay. ה-CSS של הדוח מוטבע בשני הדפים, ו-check_cma_css.py
   בודק שהוא זהה. ‏docs/cma.md, "הקישור לדוח".
   ========================================================================== */

/* אותו איחוד של planning_plans_merged במסד (מיגרציה 20270724090000), לדוח
   ה-CMA ולכלי המידע התכנוני, שמקבלים את השורה הגולמית. מי שמשנה אחד משנה
   את השני: המפורטות קודם, אחריהן ארציות וכוללניות, והודעות 77-78 בסוף. */
function mergedPlanningPlans(info){
  const key = n => String(n || '').replace(/\s+/g, '');
  const extras = g => g ? {
    kind: g.kind || null, stage: g.stage || null, notice: g.notice === true,
    permits: typeof g.permits === 'boolean' ? g.permits : null,
    url: g.url || null, designation: g.designation || null,
  } : {};
  const gov = (Array.isArray(info && info.govmap_plans) ? info.govmap_plans : []).filter(p => p && p.number);
  const local = (Array.isArray(info && info.applicable_plans) ? info.applicable_plans : []).filter(p => p && p.number);
  const byKey = new Map(gov.map(g => [key(g.number), g]));
  const seen = new Set();
  const out = local.map(p => {
    const g = byKey.get(key(p.number));
    seen.add(key(p.number));
    return Object.assign(extras(g), { number: p.number,
      description: p.description || (g && g.name) || null,
      year: String(p.date || (g && g.date) || '').slice(0, 4) || null });
  });
  const rest = gov.filter(g => !seen.has(key(g.number)));
  rest.filter(g => !g.notice).concat(rest.filter(g => g.notice)).forEach(g => {
    out.push(Object.assign(extras(g), { number: g.number, description: g.name || null,
      year: String(g.date || '').slice(0, 4) || null }));
  });
  return out;
}

const PLAN_STAGE_LABEL = { approved:'אושרה', deposited:'הופקדה' };

function planRowHtml(p){
  const url = /^https:\/\/mavat\.iplan\.gov\.il\//.test(p.url || '') ? p.url : null;
  const num = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p.number)}</a>`
    : esc(p.number);
  const bits = [
    p.description,
    p.notice ? null : p.kind,
    p.designation ? 'ייעוד: ' + p.designation : null,
    PLAN_STAGE_LABEL[p.stage] ? PLAN_STAGE_LABEL[p.stage] + (p.year ? ' ' + p.year : '') : p.year,
    p.permits === false && !p.notice ? 'לא ניתן להוציא מכוחה היתרים' : null,
  ].filter(Boolean);
  return `<div class="gm-plan${p.notice ? ' is-notice' : ''}">`
    + (p.notice ? '<span class="gm-plan-flag">הודעה על הכנת תוכנית (סעיף 77-78) - ייתכנו מגבלות על היתרי בנייה</span>' : '')
    + `<span class="gm-plan-n">${num}</span>`
    + (bits.length ? `<span class="gm-plan-d">${esc(bits.join(' · '))}</span>` : '')
    + '</div>';
}

function plansListHtml(plans, title){
  if (!plans.length) return '';
  const fromGovmap = plans.some(p => p.kind || p.url || p.notice);
  return `<div class="gm-plans"><p class="gm-plans-h">${esc(title)} (${plans.length})</p>`
    + plans.map(planRowHtml).join('')
    + (fromGovmap ? '<p class="gm-plans-src">מקור התוכניות הארציות וההודעות: GovMap, המרכז למיפוי ישראל, ומבא"ת. הקישורים פותחים את התוכנית באתר מבא"ת.</p>' : '')
    + '</div>';
}

/* ---------- תצוגת הדוח ----------
   כלל אחד שולט כאן: **הדוח מציג רק מה שהמסד הסכים להחזיר.** ‏agent_cma_report
   מחזירה ממוצע, חציון וממוצע למ״ר אך ורק כש-`data_coverage.status = 'ok'`,
   כלומר כשיש לפחות `cma_min_comparables` עסקאות ברדיוס. בכל מצב אחר השדות
   האלה פשוט אינם ב-jsonb, ולכן אי אפשר להציג אותם גם בטעות.

   זה בא במקום המצב הקודם, שבו "תמונת השוק" הוצגה תמיד: עסקה אחת הופיעה
   כ"מחיר ממוצע", ולצידה המשפט "המחיר המבוקש גבוה ב-17% מממוצע העסקאות
   בסביבה" - שנקרא כמו ממצא ונשען על נקודה אחת.

   ‏basisLabel הוא הצד השני של אותה אמירה: שורה שמקורה במחיר מבוקש מסומנת
   ככזו בכל מקום שבו היא מופיעה, ולא נספרת כמחיר עסקה. */
const CMA_BASIS = {
  asking:   { label:'מחיר מבוקש', cls:'is-asking', title:'המחיר שהיה בפרסום - לא מחיר הסגירה' },
  reported: { label:'דווח',       cls:'',          title:'מחיר הסגירה כפי שדווח על ידי הסוכן/ת' },
  official: { label:'רשמי',       cls:'',          title:'מתוך מאגר עסקאות רשמי' },
};

function cmaBasisHtml(basis){
  const b = CMA_BASIS[basis] || CMA_BASIS.asking;
  return `<span class="cma-basis ${b.cls}" title="${esc(b.title)}">${esc(b.label)}</span>`;
}

/* ההסבר שמחליף את הסטטיסטיקה. הוא אומר שלושה דברים במפורש — כמה נמצא,
   כמה צריך, ומה נבדק — כדי שסוכן/ת שמדפיס/ה את הדוח ללקוח/ה תוכל/יוכל
   להסביר למה אין כאן מספר, במקום להתנצל על דוח ריק. */
function cmaCoverageBlock(cov){
  if (!cov) return '';
  const ageLine = cov.max_deal_age_months
    ? `נבדקו עסקאות מ-${cov.max_deal_age_months} החודשים האחרונים בלבד.` : '';
  const texts = {
    no_location: {
      t: 'לא ניתן להפיק תמונת שוק לנכס הזה',
      d: 'לנכס אין קואורדינטות במערכת, ולכן אי אפשר לאתר עסקאות בסביבתו. '
       + 'גיאוקוד נעשה על כתובת מלאה - עיר, רחוב ומספר בית.',
    },
    none: {
      t: 'אין עסקאות להשוואה בסביבת הנכס',
      d: 'לא נמצאה אף עסקה שנסגרה ברדיוס הנבדק. ' + ageLine,
    },
    insufficient: {
      t: 'אין די עסקאות כדי לחשב תמונת שוק',
      d: `${plural(cov.comparables_found, 'נמצאה עסקה אחת', 'עסקאות נמצאו')} בסביבת הנכס, והמינימום לחישוב ממוצע הוא `
       + `${cov.min_required}. ממוצע ממדגם קטן מזה אינו אמין, ולכן הוא אינו מוצג. ` + ageLine,
    },
  };
  const x = texts[cov.status];
  if (!x) return '';
  /* נכס מסחרי בלי בני השוואה הוא כמעט תמיד זה, ולא היעדר עסקאות: במאגר
     הרשמי חנויות ומשרדים רשומים יחד עם דירות תחת "בנין", ולכן הם אינם
     נספרים (20270226090000). בלי השורה הזו "אין עסקאות בסביבה" נשמע כמו
     שקר לסוכן/ת שמכיר/ה עסקאות ברחוב. */
  const commercial = cov.subject_class === 'commercial'
    && (cov.status === 'none' || cov.status === 'insufficient')
    ? `<div class="d">במאגר העסקאות הרשמי חנויות ומשרדים אינם מסווגים בנפרד - הם רשומים יחד עם דירות תחת "בנין". `
      + `לכן הם אינם נספרים כבני השוואה לנכס מסחרי, ונספרות רק עסקאות שסוגן ידוע.</div>` : '';
  /* בית פרטי מושווה לבתים בלבד (20270226090000), ובמאגר יש מעט מאוד
     עסקאות בתים - בעפולה כמה עשרות מול אלפי דירות. בלי השורה הזו "אין
     עסקאות בסביבה" נקרא כאילו האזור מת, כשבפועל נמכרו בו מאות דירות. */
  const house = cov.subject_kind === 'house'
    && (cov.status === 'none' || cov.status === 'insufficient')
    ? `<div class="d">בית פרטי מושווה לבתים פרטיים בלבד, ולא לדירות - המחיר למ"ר של בית, עם הקרקע שלו, אינו דומה לזה של דירה. `
      + `במאגר העסקאות יש מעט מאוד מכירות של בתים, ולכן גם ברדיוס של 4.5 ק"מ לא נמצאו די בתים להשוואה.</div>` : '';
  return `<div class="cma-gap">
      <div class="t">${esc(x.t)}</div>
      <div class="d">${esc(x.d)}</div>${commercial}${house}
      <ul>
        <li>עסקאות שנמצאו בסביבה: ${esc(cov.comparables_found ?? 0)}</li>
        <li>נדרש לחישוב ממוצע: ${esc(cov.min_required ?? '-')}</li>
        ${cov.oldest_considered ? `<li>העסקה הישנה ביותר שנכללה: מ-${hebDate(cov.oldest_considered)} ואילך</li>` : ''}
      </ul>
    </div>`;
}

/* ---------- על מה הסטטיסטיקה נשענה ----------
   ‏`agent_cma_report` מחשבת ממוצע על עסקאות מאותה **מחלקת נכס** ומאותו
   **מספר חדרים**, לפי סולם שמרחיב קודם את הרדיוס (עד
   `cma_similar_radius_meters`) ורק אחר כך מרפה מהתאמת החדרים. השורה
   הזו אומרת איפה הסולם נעצר.

   **למה זו לא הערת שוליים.** עד המיגרציה `20261228090000` הממוצע חושב
   על כל מה שנפל ברדיוס, כלומר דירת 5 חדרים הושוותה גם לדירות 3 חדרים.
   בעפולה מחיר המ"ר כמעט זהה בין קבוצות החדרים (13,043 מול 13,564) והמחיר
   הכולל נבדל פי שניים, ולכן דווקא המספר שנשלח ללקוח/ה הוא זה שנשבר:
   חמש מתוך 20 המודעות הפעילות החליפו סימן, ואחת עברה מ-‎+99%‎ ל-‎+2%‎.

   שני המצבים שבהם אין סינון חדרים הם בדיוק אלה שבהם השתיקה הייתה
   מחזירה את המספר הישן בלי שאיש יֵדע, ולכן הם נאמרים בקול - ובמקרה של
   נכס בלי מספר חדרים רשום, עם הדבר היחיד שסוגר את הפער: להשלים אותו. */
function cmaSampleNote(cov, radiusUsed){
  if (!cov || !cov.has_statistics) return '';
  const n     = Number(cov.comparables_found) || 0;
  const band  = cov.rooms_band;
  const rooms = Number(cov.subject_rooms);
  const rad   = radiusUsed ? ` ברדיוס ${esc(radiusUsed)} מ׳ מהנכס` : '';
  /* ‏4.0 מהמסד צריך להיקרא "4 חדרים" ולא "4.0 חדרים", ו-4.5 להישאר 4.5 */
  const num   = v => String(Number(v));
  const other = Number(cov.excluded_other_rooms) || 0;
  const aside = other > 0
    ? ` ‏${esc(other)} עסקאות נוספות בסביבה הן בגודל אחר, ואינן נספרות בממוצע.` : '';

  /* נכס מגורים מיוחד (20270226090000): דירת גן, דירת גג/פנטהאוז. במאגר
     הרשמי אין תת-סוג - GovMap רושם "דירה" לכולן - ולכן ההתאמה בקירוב:
     דירת קרקע לדירת גן, והקומה העליונה בבניין לפנטהאוז. הדוח אומר שזה
     קירוב, ואומר בקול כשלא נמצאו כאלה והממוצע חזר לדירות רגילות. */
  const KIND_NAME = { garden:'דירות קרקע (קירוב לדירות גן)', roof:'דירות בקומה העליונה בבניין (קירוב לדירות גג)' };
  const kindName = KIND_NAME[cov.subject_kind] || '';
  if (cov.rooms_band_reason === 'kind_rooms' || cov.rooms_band_reason === 'kind_any_rooms'){
    return `<div class="cma-note">ההשוואה נערכה מול ${esc(n)} <strong>${esc(kindName)}</strong>`
         + (cov.rooms_band_reason === 'kind_rooms' && !isNaN(rooms) && cov.subject_rooms != null
             ? ` של ${esc(num(rooms - 1))} עד ${esc(num(rooms + 1))} חדרים` : ' בכל גודל')
         + `${rad}. במאגר העסקאות הרשמי אין סימון של דירת גן או פנטהאוז, ולכן זה קירוב לפי הקומה.`
         + (Number(cov.excluded_other_kind) > 0
             ? ` ‏${esc(cov.excluded_other_kind)} דירות רגילות בסביבה אינן נספרות בממוצע.` : '')
         + '</div>';
  }
  const kindFallback = (cov.subject_kind === 'garden' || cov.subject_kind === 'roof') && !cov.kind_matched
    ? `<div class="cma-note">לא נמצאו די ${esc(kindName)} עד ${esc(cov.max_radius_meters || 2000)} מ׳, ולכן הממוצע נשען על <strong>דירות רגילות</strong>. `
      + `${cov.subject_kind === 'roof' ? 'פנטהאוז' : 'דירת גן'} נמכרת בדרך כלל במחיר שונה מדירה רגילה, ויש לקרוא את הפער בזהירות.</div>` : '';
  if (kindFallback){
    const base = cmaSampleNote({ ...cov, subject_kind: null }, radiusUsed);
    return kindFallback + base;
  }

  if (cov.rooms_band_reason === 'exact'){
    return `<div class="cma-note">ההשוואה נערכה מול ${esc(n)} עסקאות של `
         + `<strong>${esc(num(rooms))} חדרים</strong>${rad}.${aside}</div>`;
  }
  if (cov.rooms_band_reason === 'relaxed'){
    return `<div class="cma-note">לא נמצאו די עסקאות של ${esc(num(rooms))} חדרים בדיוק, ולכן ההשוואה `
         + `נערכה מול ${esc(n)} עסקאות של <strong>${esc(num(rooms - band))} עד ${esc(num(rooms + band))} חדרים</strong>`
         + `${rad}.${aside}</div>`;
  }
  if (cov.rooms_band_reason === 'no_similar_rooms'){
    return `<div class="cma-note">לא נמצאו די עסקאות במספר חדרים דומה לנכס, ולכן ההשוואה${rad} `
         + `<strong>אינה מסוננת לפי מספר חדרים</strong> והממוצע מערבב נכסים בגדלים שונים. `
         + `המחיר למ״ר הוא ההשוואה המהימנה יותר במצב הזה.</div>`;
  }
  if (cov.rooms_band_reason === 'subject_rooms_missing'){
    return `<div class="cma-note">לנכס לא רשום מספר חדרים, ולכן ההשוואה${rad} `
         + `<strong>אינה מסוננת לפי מספר חדרים</strong> והממוצע מערבב נכסים בגדלים שונים. `
         + `השלימו את מספר החדרים בכרטיס הנכס והפיקו את הדוח שוב - זה המספר שמדייק אותו יותר מכל.</div>`;
  }

  /* נכס מסחרי (20270226090000): לחנות ולמשרד אין חדרים, והסולם מסנן לפי
     קבוצת קומה. חנות בקומת קרקע ומשרד בקומה שלישית אינם אותו נכס - בעפולה
     החציון למ"ר הוא כ-16,800 מול כ-12,000. ולכן גם כאן שני המצבים בלי
     סינון נאמרים בקול, ובקשה להשלים מבקשת קומה ולא חדרים. */
  const floorName = ({ ground:'בקומת קרקע', upper:'בקומות עליונות', below:'במרתף' })[cov.subject_floor_group] || '';
  const otherFloor = Number(cov.excluded_other_floor) || 0;
  const floorAside = otherFloor > 0
    ? ` ‏${esc(otherFloor)} עסקאות מסחריות נוספות בסביבה הן בקומה אחרת, ואינן נספרות בממוצע.` : '';
  if (cov.rooms_band_reason === 'floor_exact'){
    return `<div class="cma-note">ההשוואה נערכה מול ${esc(n)} עסקאות מסחריות `
         + `<strong>${esc(floorName)}</strong>${rad}.${floorAside}</div>`;
  }
  if (cov.rooms_band_reason === 'no_similar_floor'){
    return `<div class="cma-note">לא נמצאו די עסקאות מסחריות ${esc(floorName)}, ולכן ההשוואה${rad} `
         + `<strong>אינה מסוננת לפי קומה</strong> ומערבבת קומת קרקע עם קומות עליונות. `
         + `בחנות זה הפער הגדול ביותר במחיר, ולכן יש לקרוא את הממוצע בזהירות.</div>`;
  }
  if (cov.rooms_band_reason === 'subject_floor_missing'){
    return `<div class="cma-note">לנכס לא רשומה קומה, ולכן ההשוואה${rad} `
         + `<strong>אינה מסוננת לפי קומה</strong> ומערבבת קומת קרקע עם קומות עליונות. `
         + `השלימו את הקומה בכרטיס הנכס והפיקו את הדוח שוב - בנכס מסחרי זה הנתון שמדייק אותו יותר מכל.</div>`;
  }
  return rad ? `<div class="cma-note">ההשוואה נערכה${rad}.</div>` : '';
}

/* ---------- שכבת השוק: מול מי הנכס מתחרה עכשיו ----------
   ‏`market_comparables` הם נכסים **פעילים למכירה** בסביבה, כלומר
   **מחירים מבוקשים ולא מחירי עסקה**. לכן הם חיים בבלוק משלהם ואינם
   נוגעים ב-`stats`: האבחנה הזו היא מה שמיגרציה `20261130090000` נבנתה
   כדי לשמור עליו, אחרי שפער המיקוח נכנס למאגר כאילו היה מחיר סגירה.

   **וזו השכבה היחידה שיכולה לשקלל מאפיינים.** למאגר העסקאות אין ולו
   מאפיין אחד - 1,512 העסקאות הרשמיות נושאות סוג, חדרים, קומה ומ"ר בלבד -
   ואילו למודעות שלנו יש ממ"ד, מרפסת, מעלית וחניה. לכן דמיון המאפיינים
   מדרג כאן, וב-`comparables` הוא לא קיים.

   הסולם זהה באופיו לסולם החדרים: קודם התאמת מאפיינים, ואם אין די כאלה
   נופלים לבנד החדרים לבדו - ואומרים את זה. */
/* שמות המאפיינים. ב-CRM - מהרשימות של טופס הנכס (‏crm.js); בדף /cma אין
   אותן, ושם השמות מגיעים עם הדוח (‏subject.feature_labels, שגבריאלה שומרת
   ביצירת הקישור). פונקציה ולא const: הקובץ נטען לפני crm.js. */
function cmaFeatureLabel(code, s){
  if (typeof cmaFeatureLabel.map === 'undefined'){
    cmaFeatureLabel.map = typeof RESIDENTIAL_PROPERTY_FEATURES === 'undefined' ? {}
      : Object.fromEntries([...RESIDENTIAL_PROPERTY_FEATURES, ...COMMERCIAL_PROPERTY_FEATURES, ...LISTING_FEATURES]);
  }
  return cmaFeatureLabel.map[code] || (s && s.feature_labels && s.feature_labels[code]) || code;
}

function cmaMarketNote(cov){
  if (!cov || !Number(cov.market_comparables_total)) return '';
  const total = Number(cov.market_comparables_total);
  const rad   = cov.market_radius_meters ? ` ברדיוס ${esc(cov.market_radius_meters)} מ׳` : '';
  const head  = `<div class="cma-note">נמצאו ${esc(total)} נכסים פעילים למכירה בסביבה${rad}. `
              + `<strong>אלה מחירים מבוקשים ולא מחירי עסקה</strong>, ולכן הם אינם נכנסים לממוצע שלמעלה.</div>`;

  if (cov.market_band_reason === 'features'){
    return head + `<div class="cma-note">החציון כאן נשען על ${esc(cov.market_feature_matched)} מהם שגם `
      + `<strong>תואמים לנכס במאפיינים</strong> (ממ״ד, מעלית, מרפסת, חניה וכדומה).</div>`;
  }
  if (cov.market_band_reason === 'rooms_only'){
    /* בנכס מסחרי הסולם הוא קומה ולא חדרים (20270226090000) */
    const band = cov.band_dimension === 'floor' ? 'באותה קבוצת קומה' : 'באותו מספר חדרים';
    return head + '<div class="cma-note">לא נמצאו די נכסים שתואמים גם במאפיינים, ולכן החציון כאן נשען על '
      + `כל הנכסים ${band}. ההתאמה במאפיינים מוצגת בטבלה לכל שורה.</div>`;
  }
  if (cov.market_band_reason === 'subject_features_missing'){
    return head + '<div class="cma-note">לנכס לא רשומים מאפיינים, ולכן אי אפשר לדרג את המתחרים לפיהם. '
      + 'סימון ממ״ד, מעלית, מרפסת וחניה בכרטיס הנכס ידייק את ההשוואה הזו.</div>';
  }
  if (cov.market_band_reason === 'too_few'){
    return head + `<div class="cma-note">זה פחות מ-${esc(cov.min_market_required)} נכסים, ולכן אין כאן חציון - `
      + 'רק הנכסים עצמם, כל אחד עם המחיר שלו.</div>';
  }
  return head;
}

/* ---------- שעון (חצי עיגול) ----------
   מדד אחד מול סקאלה, עם שלושה אזורים: זול (כחול), בטווח (אפור ניטרלי),
   יקר (אדום). כחול ואדום הם שני הקטבים של סקאלה מתפצלת, והאמצע אפור -
   "אין כאן כלום" - ולא צבע (dataviz: diverging pair, נבדק ב-validator:
   ‏CVD ‎ΔE 21.6‎). הצבע לעולם אינו נושא לבדו: הערך כתוב במרכז, והמשמעות
   בשורה מתחתיו. הכיוון כיוון הקריאה: זול מימין, יקר משמאל - כמו פס הטווח.
   ‏2px רווח בין האזורים, כמו בין כל שני מילויים סמוכים. */
function cmaGaugeSvg(t, cuts){
  const R = 78, CX = 100, CY = 96, W = 12;
  const pt = (u, r) => {
    const a = Math.PI * Math.max(0, Math.min(1, u));
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
  };
  const arc = (u0, u1, cls) => {
    const [x0, y0] = pt(u0, R), [x1, y1] = pt(u1, R);
    return `<path class="${cls}" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 0 ${x1.toFixed(1)} ${y1.toFixed(1)}" `
      + `fill="none" stroke-width="${W}" stroke-linecap="butt"/>`;
  };
  const gap = 0.012;
  const [a, b] = cuts;
  const [nx, ny] = pt(t, R - W - 6);
  return `<svg class="cma-gauge-svg" viewBox="0 0 200 104" aria-hidden="true">
      ${arc(0, a - gap, 'z-low')}${arc(a + gap, b - gap, 'z-mid')}${arc(b + gap, 1, 'z-high')}
      <line class="needle" x1="${CX}" y1="${CY}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke-width="3" stroke-linecap="round"/>
      <circle class="hub" cx="${CX}" cy="${CY}" r="6"/>
    </svg>`;
}

/* כרטיס שעון: כותרת, השעון, הערך והמשמעות. ‏`pct` הוא אחוז פער (‎-40‎ עד
   ‏‎+40‎, מוגבל לקצוות) או אחוזון (0-100). */
function cmaGaugeCard({ title, value, valueText, mode, caption }){
  if (value == null || !Number.isFinite(Number(value))) return '';
  const v = Number(value);
  const t = mode === 'percentile' ? v / 100 : (Math.max(-40, Math.min(40, v)) + 40) / 80;
  const cuts = mode === 'percentile' ? [0.25, 0.75] : [30 / 80, 50 / 80];
  return `<figure class="cma-gauge">
      <figcaption class="cma-gauge-t">${title}</figcaption>
      ${cmaGaugeSvg(t, cuts)}
      <div class="cma-gauge-v">${valueText}</div>
      <div class="cma-gauge-ends"><span>זול</span><span>יקר</span></div>
      <div class="cma-gauge-c">${caption}</div>
    </figure>`;
}

function renderCmaReport(r, brand){
  const s   = r.subject || {};
  const st  = r.stats || {};
  const cov = r.data_coverage || {};
  const comps = r.comparables || [];
  const cityComps = r.city_comparables || [];
  const sources = r.sources || [];
  const hasStats = !!cov.has_statistics;

  /* סוג הבעלות בטאבו (20270115091000). ‏`r.ownership` הוא null כל עוד המאגר
     לא נטען, ואז העמודה והשורות פשוט לא מופיעות - עמודה שכולה "-" נראית כמו
     "אף עסקה אינה רשומה", וזה שקר. עסקה בלי `ownership` מוצגת "-": היעדר
     אינו "פרטית". */
  const own = r.ownership || null;
  const LAND_OWN = { P:'פרטית', S:'מדינה', L:'רשות מקומית', M:'מעורבת', O:'אחר' };
  const ownCell = c => own ? `<td>${c.ownership ? esc(LAND_OWN[c.ownership] || '') : '-'}</td>` : '';
  const ownTh = own ? '<th>בעלות</th>' : '';
  const ownSubj = own && own.subject && LAND_OWN[own.subject.ownership];
  const ownCounts = (own && own.counts) || {};
  const ownSplit = own && own.split;

  /* הפער מול השוק מוצג רק כשיש שוק להשוות אליו. זה היה המשפט המטעה
     ביותר בדוח: הוא נוסח כממצא גם כשה"ממוצע" היה עסקה אחת.

     ומעכשיו הוא **שני מספרים ולא אחד**, וזו לא הרחבה קוסמטית. הפער
     במחיר הכולל והפער למ״ר אינם אותו מספר, והם יכולים להצביע לכיוונים
     שונים לגמרי. נכס אמיתי בעפולה: 1,320,000 ₪ על 80 מ״ר, מול ממוצע
     של 1,282,937 ₪ על 113 מ״ר ב-222 עסקאות בסביבה.

       במחיר הכולל   +3%   ← נשמע כמו "המחיר בשוק"
       במחיר למ״ר   +43%   ← 16,500 מול 11,556

     שני המספרים נכונים, והם מתארים את אותו נכס. ההבדל ביניהם הוא כולו
     השטח: נכס קטן מהממוצע ייראה זול בהשוואה הכוללת גם כשהוא יקר מאוד
     לכל מטר. מי שראה רק את ה-3% קרא שהמחיר סביר, והוא לא היה.

     לכן שניהם ולא בחירה ביניהם: המחיר למ״ר הוא ההשוואה המדויקת כששטחים
     שונים, והמחיר הכולל הוא מה שהקונה באמת משלם. וכששניהם רחוקים זה
     מזה, הדוח אומר **למה** - אחרת זה נקרא כסתירה. */
  /* ‏`ask == null` לפני `Number()`, וזו לא הגנה עודפת אלא באג שנתפס.
     ‏**`Number(null)` הוא 0 ולא NaN**, ולכן נכס בלי שטח - `price_per_sqm`
     חוזר `null` מ-`agent_cma_report` כש-`size_sqm` ריק - היה מקבל
     "המחיר המבוקש למ״ר: נמוך ב-100% מהממוצע". מספר מומצא שנקרא כממצא,
     על שתיים מ-31 המודעות הפעילות למכירה.

     ‏`Number.isFinite` לבדו אינו תופס את זה כי 0 הוא סופי לגמרי, ו-
     ‏`jsonb_build_object` מחזיר את המפתח **עם `null`** ולא משמיט אותו -
     כלומר `undefined` (שהיה נותן NaN) אינו מגיע לכאן לעולם.

     ‏`a > 0` מכסה גם מחיר 0, שאינו השוואה בעלת משמעות. */
  const cmaGapPct = (ask, avg) => {
    if (ask == null || avg == null) return null;
    const a = Number(ask), v = Number(avg);
    return (Number.isFinite(a) && Number.isFinite(v) && a > 0 && v > 0)
      ? Math.round(((a - v) / v) * 100) : null;
  };
  /* למה אין השוואה למ״ר. בדוח לכתובת המחיר המבוקש אינו חובה, ושם החסר הוא
     בדרך כלל המחיר ולא השטח - "אין שטח רשום" היה שקר על נכס עם 80 מ״ר. */
  function cmaNoSqmNote(s){
    if (!s.size_sqm) return 'אין שטח רשום לנכס, ולכן אי אפשר להשוות את המחיר למ״ר.';
    if (!s.price) return 'לא הוזן מחיר מבוקש, ולכן הדוח מציג את השוק בלי פער מול הנכס.';
    return 'אי אפשר להשוות את המחיר למ״ר.';
  }
  const priceGap = hasStats ? cmaGapPct(s.price, st.avg_price) : null;
  const sqmGap   = hasStats ? cmaGapPct(s.price_per_sqm, st.avg_price_per_sqm) : null;

  function cmaGapLine(pct, what, n){
    if (pct === null) return '';
    const count = Number(n) > 0 ? ` (${esc(n)} עסקאות)` : '';
    return pct === 0
      ? `<div class="cma-note">${what}: <strong>תואם את הממוצע</strong>${count}.</div>`
      : `<div class="cma-note">${what}: <strong>${pct > 0 ? 'גבוה' : 'נמוך'} ב-${Math.abs(pct)}%</strong> `
        + `מהממוצע${count}.</div>`;
  }

  /* סף ההסבר: 10 נקודות אחוז. מתחת לזה שני המספרים מספרים אותו סיפור
     ומשפט נוסף הוא רעש; מעל לזה הם נראים כמו סתירה, ואז ההסבר הוא
     החלק החשוב יותר של הדוח. */
  const gapDiverges = priceGap !== null && sqmGap !== null
                      && Math.abs(priceGap - sqmGap) >= 10;

  const gapNote = (priceGap === null && sqmGap === null) ? '' :
      cmaGapLine(priceGap, 'המחיר המבוקש הכולל', st.comparables_count)
    + cmaGapLine(sqmGap,   'המחיר המבוקש למ״ר',  st.sqm_sample_size ?? st.comparables_count)
    + (gapDiverges
        ? '<div class="cma-note">שני המספרים רחוקים זה מזה מפני ששטח הנכס שונה מהשטח הממוצע '
          + 'בעסקאות ההשוואה. המחיר למ״ר הוא ההשוואה המדויקת יותר; המחיר הכולל הוא מה שהקונה משלם בפועל.</div>'
        : '')
    + (sqmGap === null && st.avg_price_per_sqm && !s.price_per_sqm
        ? '<div class="cma-note">' + cmaNoSqmNote(s) + '</div>'
        : '');

  /* שתי סיבות שונות לכך שעסקה מופיעה בטבלה ואינה נספרת בממוצע, ולכל
     אחת סימון משלה: מחלקת נכס אחרת, או מספר חדרים אחר. ‏`in_stats` מגיע
     מה-RPC ואינו מחושב כאן - תצוגה שמחליטה בעצמה מי נספר היא תצוגה
     שתיפרד מהחישוב ברגע שהסולם ישתנה. */
  /* ---------- העסקאות הדומות ביותר ----------
     ‏`comparables` מגיע מ-`agent_cma_report_full` כבר מצומצם ומדורג
     (20270227090000): הדומות ביותר לנכס בשטח, במרחק ובתאריך, מתוך מה
     שנספר בממוצע. הממוצע עצמו חושב על **כולן** - והכיתוב אומר זאת, כי
     טבלה של 8 שורות מתחת לממוצע של 180 נקראת אחרת כצירוף מקרים. */
  const compRows = comps.map(c => `<tr>
      <td class="cma-c-rank">${esc(c.similarity_rank ?? '')}</td>
      <td>${esc(c.property_type)}${c.same_type === false ? ' <span class="cma-basis">סוג אחר</span>' : ''}${c.rooms != null ? ' · ' + esc(String(Number(c.rooms))) + ' חד׳' : ''}${c.same_building
        ? ' <span class="cma-basis is-same" title="אותו גוש וחלקה כמו הנכס - אותו בניין, ולכן אותו גיל ורמת בנייה">באותו בניין</span>' : ''}</td>
      <td>${c.size_sqm ? esc(c.size_sqm) + ' מ״ר' : '-'}</td>
      <td>${shekel(c.sale_price)} ${cmaBasisHtml(c.price_basis)}</td>
      <td>${c.price_per_sqm ? shekel(c.price_per_sqm) : '-'}</td>
      <td>${esc(c.distance_meters)} מ׳</td>
      <td>${hebDate(c.sold_at)}</td>
      ${ownCell(c)}
    </tr>`).join('');
  const listedOf = Number(cov.comparables_listed_of) || comps.length;
  const compsCaption = !comps.length ? '' : hasStats
    ? `${plural(comps.length, 'העסקה הדומה ביותר', 'העסקאות הדומות ביותר')} לנכס, מתוך ${esc(st.comparables_count)} שהממוצע נשען עליהן`
      + `${r.radius_meters_used ? ` ברדיוס ${esc(r.radius_meters_used)} מ׳` : ''}. הבחירה לפי קרבה בשטח, במרחק ובמועד העסקה.`
    : `אין די עסקאות דומות לחישוב ממוצע, ולכן מוצגות ${plural(comps.length, 'העסקה הקרובה ביותר', 'העסקאות הקרובות ביותר')}`
      + `${listedOf > comps.length ? ` מתוך ${esc(listedOf)} בסביבה` : ''}.`;

  /* שכבת השוק. ‏`feature_match` הוא `null` כשלאחד הצדדים אין מאפיינים
     רשומים, ו-`null` אינו 0: "לא נרשם" אינו "אין ממ״ד". ‏`in_market_stats`
     מגיע מה-RPC. מוצגות עד 6 שורות - הן כבר מדורגות לפי התאמה. */
  const CMA_ROWS = 6;
  const marketComps = (r.market_comparables || []).slice(0, CMA_ROWS);
  const mst = r.market_stats || {};
  const featPct = v => v == null ? '<span class="cma-basis" title="למודעה אין מאפיינים רשומים">לא רשום</span>'
                                 : Math.round(Number(v) * 100) + '%';
  /* ‏`cma-c-title` על תא הכותרת: זו העמודה היחידה בטבלאות שנושאת טקסט
     חופשי, ולכן היא זו שקובעת את הרוחב המינימלי של הטבלה. ראו ה-CSS. */
  const marketRows = marketComps.map(c => `<tr>
      <td class="cma-c-title">${esc(c.title)}${c.is_own ? ' <span class="cma-basis" title="מודעה שלך">שלי</span>' : ''}</td>
      <td>${c.rooms ?? '-'}</td>
      <td>${c.size_sqm ? esc(c.size_sqm) + ' מ״ר' : '-'}</td>
      <td>${shekel(c.price)} <span class="cma-basis is-asking" title="מחיר מבוקש - הנכס עדיין לא נמכר">מבוקש</span></td>
      <td>${c.price_per_sqm ? shekel(c.price_per_sqm) : '-'}</td>
      <td>${featPct(c.feature_match)}${c.in_market_stats === false && c.feature_match != null
        ? ' <span class="cma-basis" title="לא נספר בחציון - התאמת המאפיינים נמוכה מהסף">לא נספר</span>' : ''}</td>
      <td>${esc(c.distance_meters)} מ׳</td>
    </tr>`).join('');

  const marketGap    = cmaGapPct(s.price, mst.median_price);
  const marketSqmGap = cmaGapPct(s.price_per_sqm, mst.median_price_per_sqm);

  /* שכבת השכונה: עסקאות רשמיות בלי פין, באותה שכונה כמו הנכס. החציון
     שלהן נפרד מתמונת השוק ואינו נכנס לממוצע שלה. */
  const hoodComps = (r.neighborhood_comparables || []).slice(0, CMA_ROWS);
  const hst = r.neighborhood_stats || {};
  const hoodGap    = cmaGapPct(s.price, hst.median_price);
  const hoodSqmGap = cmaGapPct(s.price_per_sqm, hst.median_price_per_sqm);
  const hoodRows = hoodComps.map(c => `<tr>
      <td>${esc(c.property_type)}${c.same_type === false ? ' <span class="cma-basis">סוג אחר</span>' : ''}${c.shared_neighborhood
        ? ' <span class="cma-basis" title="במאגר העסקה רשומה בשם שמכסה כמה שכונות, ונספרת בכל אחת מהן">משותפת</span>' : ''}</td>
      <td>${c.rooms ?? '-'}${c.same_type !== false && c.in_stats === false
        ? ' <span class="cma-basis" title="מספר חדרים שונה מהנכס - אינה נספרת בחציון">לא נספר</span>' : ''}</td>
      <td>${c.size_sqm ? esc(c.size_sqm) + ' מ״ר' : '-'}</td>
      <td>${shekel(c.sale_price)} ${cmaBasisHtml(c.price_basis)}</td>
      <td>${c.price_per_sqm ? shekel(c.price_per_sqm) : '-'}</td>
      <td>${hebDate(c.sold_at)}</td>
      ${ownCell(c)}
    </tr>`).join('');

  /* על מה הממוצע נשען, לפי בעלות. הפיצול מגיע מהמסד רק כששתי הקבוצות
     מעל הסף, והוא **אינו** מתקן את הממוצע: זו החלטה של השמאי/ת. */
  const ownNote = (!own || !hasStats || !Number(ownCounts.in_stats)) ? '' :
      `<div class="cma-note">מתוך ${esc(ownCounts.in_stats)} העסקאות בממוצע: `
    + `${esc(ownCounts.private || 0)} על קרקע פרטית, ${esc(ownCounts.state || 0)} על קרקע מדינה`
    + (Number(ownCounts.local) ? `, ${esc(ownCounts.local)} על קרקע של רשות מקומית` : '')
    + (Number(ownCounts.unknown) ? `, ${esc(ownCounts.unknown)} שסוג הבעלות שלהן לא ידוע` : '')
    + '.</div>'
    + (ownSplit
        ? `<div class="cma-note">חציון למ״ר לפי סוג הבעלות: קרקע פרטית ${shekel(ownSplit.private_median_price_per_sqm)} `
          + `(${esc(ownSplit.private_sample)}) · קרקע מדינה ${shekel(ownSplit.state_median_price_per_sqm)} (${esc(ownSplit.state_sample)}).</div>`
        : '');

  // התוכניות של העירייה / retzefMigrashim יחד עם 203/14 (ארציות, כוללניות, 77-78)
  const plans = r.planning ? mergedPlanningPlans(r.planning) : [];

  /* שורת המקורות נבנית ממה שבאמת נכנס לדוח (`sources` מה-RPC) ולא מטקסט
     קבוע. כך מקור חדש שייכנס למאגר יופיע כאן מעצמו, ודוח בלי נתונים לא
     יטען שהוא נשען על מאגר. */
  const sourcesLine = sources.length
    ? 'מקורות הנתונים בדוח זה: ' + sources.map(x => `${esc(x.label)} (${esc(x.deals)})`).join(' · ') + '.'
    : 'לא נכללו בדוח זה עסקאות כלשהן.';

  const askingNote = cov.asking_basis_count > 0
    ? `<div class="cma-note">${esc(cov.asking_basis_count)} מהעסקאות בדוח רשומות לפי <strong>המחיר המבוקש</strong> `
      + 'שהיה בפרסום ולא לפי מחיר הסגירה, ומסומנות ככאלה בטבלאות. פער המיקוח אינו משוקלל בהן.</div>'
    : '';

  /* ---------- הקרקע ----------
     סוג הבעלות הוא שאלה שחוזרת אצל כל קונה ("זה טאבו או מינהל?"), ולכן
     הוא כרטיס משלו ולא שורה בטבלה. ההסבר לכל סוג זהיר בכוונה - "עשויה",
     "בדרך כלל" - כי המקור עצמו אומר שאינו קובע זכות משפטית, וכל כרטיס
     מפנה לנסח. היעדר מידע אינו "פרטית": כשאין התאמה במאגר נאמר "לא נמצא". */
  const LAND_OWN_MEANING = {
    P: 'הקרקע רשומה בבעלות פרטית.',
    S: 'הקרקע בבעלות המדינה ומנוהלת בידי רשות מקרקעי ישראל (רמ״י). זכויות הרוכשים הן בדרך כלל חכירה ולא בעלות, '
     + 'והעברתן עשויה לדרוש אישור רמ״י ולפעמים גם תשלום - וזה יכול להשפיע על תהליך המשכנתא.',
    L: 'הקרקע רשומה בבעלות רשות מקומית. את סוג הזכויות של היחידה יש לבדוק בנסח.',
    M: 'בחלקה רשום יותר מסוג בעלות אחד. את הזכויות של היחידה עצמה יש לבדוק בנסח.',
    O: 'סוג הבעלות הרשום אינו פרטי, מדינה או רשות מקומית. את הזכויות יש לבדוק בנסח.',
  };
  const ownCode = own && own.subject && own.subject.ownership;
  const plan = r.planning || null;
  const landFacts = [
    plan && (plan.gush || plan.helka) ? ['גוש / חלקה', `${esc(plan.gush || '-')} / ${esc(plan.helka || '-')}`] : null,
    plan && plan.parcel_area_sqm ? ['שטח החלקה', `${esc(plan.parcel_area_sqm)} מ״ר`] : null,
    plan && plan.land_use_designation ? ['ייעוד קרקע', esc(plan.land_use_designation)] : null,
  ].filter(Boolean);
  const plansHtml = plansListHtml(plans, 'תוכניות החלות על הקרקע');
  const landBlock = (!ownCode && !landFacts.length && !plans.length && !(own && plan)) ? '' : `
    <section class="cma-sec cma-land">
      <h3 class="cma-h">הקרקע</h3>
      <div class="cma-land-grid">
        <div class="cma-own ${ownCode ? 'is-' + esc(ownCode.toLowerCase()) : 'is-none'}">
          <div class="cma-own-k">סוג הבעלות בטאבו</div>
          <div class="cma-own-v">${ownCode ? esc(LAND_OWN[ownCode] || ownCode) : 'לא נמצא במאגר'}</div>
          <div class="cma-own-d">${ownCode
            ? esc(LAND_OWN_MEANING[ownCode] || '') + (own.subject.mixed_units ? ' בחלקה יש גם תת-חלקות בסוג בעלות אחר.' : '')
            : own ? 'לחלקה של הנכס לא נמצא רישום במאגר הבעלות. זה אינו אומר שהקרקע פרטית - הדרך לדעת היא נסח טאבו.'
                  : 'מאגר הבעלות עוד לא זמין בדוח הזה.'}</div>
        </div>
        ${landFacts.length ? `<dl class="cma-facts">${landFacts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
      </div>
      ${plansHtml}
      ${ownNote}
    </section>`;

  /* ---------- איפה הנכס יושב בתוך השוק ----------
     פס אחד במקום עוד מספר: הטווח שבין הרבעון התחתון לעליון של המחיר
     למ״ר (מחצית העסקאות האמצעיות), החציון, והנכס. הרבעונים מגיעים מהמסד
     רק מעל הסף (20270227090000), ולכן הפס מופיע רק כשיש לו על מה לעמוד.
     הכיוון הוא כיוון הקריאה: זול מימין, יקר משמאל. */
  const rangeOk = hasStats && st.p25_price_per_sqm != null && st.p75_price_per_sqm != null;
  const subjPsm = s.price_per_sqm == null ? null : Number(s.price_per_sqm);
  let rangeBlock = '';
  if (rangeOk){
    const vals = [st.min_price_per_sqm, st.max_price_per_sqm, subjPsm].filter(v => v != null).map(Number);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || 1;
    const at = v => Math.max(0, Math.min(100, ((Number(v) - lo) / span) * 100));
    const p25 = Number(st.p25_price_per_sqm), p75 = Number(st.p75_price_per_sqm);
    const where = subjPsm == null ? '' : subjPsm < p25
      ? 'המחיר המבוקש למ״ר <strong>נמוך מרוב העסקאות הדומות</strong>.'
      : subjPsm > p75
        ? 'המחיר המבוקש למ״ר <strong>גבוה מרוב העסקאות הדומות</strong>.'
        : 'המחיר המבוקש למ״ר <strong>בתוך הטווח של מחצית העסקאות האמצעיות</strong>.';
    rangeBlock = `
      <div class="cma-range" role="img" aria-label="טווח המחיר למ״ר בעסקאות הדומות ומיקום הנכס בתוכו">
        <div class="cma-range-track">
          <div class="cma-range-band" style="inset-inline-start:${at(p25).toFixed(1)}%;width:${(at(p75) - at(p25)).toFixed(1)}%"></div>
          <div class="cma-range-mid" style="inset-inline-start:${at(st.median_price_per_sqm).toFixed(1)}%"></div>
          ${subjPsm != null ? `<div class="cma-range-pin${at(subjPsm) < 12 ? ' is-start' : at(subjPsm) > 88 ? ' is-end' : ''}" style="inset-inline-start:${at(subjPsm).toFixed(1)}%"><span>הנכס · ${shekel(Math.round(subjPsm))}</span></div>` : ''}
        </div>
        <div class="cma-range-ends"><span>${shekel(lo)}</span><span>${shekel(hi)}</span></div>
        <div class="cma-range-legend">
          <span><i class="k-band"></i>מחצית העסקאות האמצעיות: ${shekel(p25)} - ${shekel(p75)} למ״ר</span>
          <span><i class="k-mid"></i>חציון: ${shekel(st.median_price_per_sqm)}</span>
        </div>
        ${where ? `<p class="cma-range-where">${where}</p>` : ''}
      </div>`;
  }

  /* ---------- לוח המדדים ----------
   מספר גיבור **אחד** (dataviz: hero figure, אחד לכל תצוגה) - הפער למ״ר,
   שהוא ההשוואה ההוגנת כששטחים שונים; ואם אין שטח, הפער הכולל. מתחתיו עד
   שלושה שעונים, כל אחד מספר אחר ולא חזרה על הגיבור במחסה אחר: איפה הנכס
   בתוך העסקאות (אחוזון), מול הממוצע למ״ר, ומול מה שמבוקש היום. */
  const heroPct = sqmGap ?? priceGap;
  /* ‏gapNote נשאר מקור האמת לשורות הפער (וכך גם הבדיקה שלו), אבל בלוח
     המדדים המספרים כבר בגיבור ובשעונים - ולכן כאן רק שתי שורות ההסבר. */
  const gapExplain = (gapDiverges
      ? '<div class="cma-note">שני הפערים רחוקים זה מזה מפני ששטח הנכס שונה מהשטח הממוצע '
        + 'בעסקאות ההשוואה. המחיר למ״ר הוא ההשוואה המדויקת יותר; המחיר הכולל הוא מה שהקונה משלם בפועל.</div>'
      : '')
    + (sqmGap === null && st.avg_price_per_sqm && !s.price_per_sqm
      ? '<div class="cma-note">' + cmaNoSqmNote(s) + '</div>'
      : '');
  const heroBlock = heroPct === null ? '' : `
      <div class="cma-hero-fig">
        <div class="cma-hero-n">${heroPct > 0 ? '+' : ''}${esc(heroPct)}%</div>
        <div class="cma-hero-l">${sqmGap !== null
          ? `המחיר המבוקש למ״ר (${shekel(s.price_per_sqm)}) מול ממוצע ${shekel(st.avg_price_per_sqm)} ב-${esc(st.sqm_sample_size ?? st.comparables_count)} עסקאות דומות`
          : `המחיר המבוקש (${shekel(s.price)}) מול ממוצע ${shekel(st.avg_price)} ב-${esc(st.comparables_count)} עסקאות דומות`}</div>
      </div>`;
  const pctile = st.subject_percentile;
  const gauges = [
    cmaGaugeCard({
      title: 'המיקום בין העסקאות הדומות', mode: 'percentile', value: pctile,
      valueText: pctile == null ? '' : `${esc(pctile)}%`,
      caption: pctile == null ? '' : `יקר למ״ר מ-${esc(pctile)}% מהעסקאות`,
    }),
    sqmGap !== null && priceGap !== null ? cmaGaugeCard({
      title: 'המחיר הכולל מול הממוצע', mode: 'gap', value: priceGap,
      valueText: `${priceGap > 0 ? '+' : ''}${esc(priceGap)}%`,
      caption: `מול ${shekel(st.avg_price)}`,
    }) : '',
    marketSqmGap !== null ? cmaGaugeCard({
      title: 'מול המבוקש בשוק עכשיו', mode: 'gap', value: marketSqmGap,
      valueText: `${marketSqmGap > 0 ? '+' : ''}${esc(marketSqmGap)}%`,
      caption: `למ״ר, מול חציון ${shekel(mst.median_price_per_sqm)} ב-${esc(mst.sqm_sample_size ?? mst.count)} מודעות`,
    }) : '',
  ].filter(Boolean).join('');

  /* ---------- המיתוג ----------
     הדוח נשלח ללקוח/ה בשם המשרד, ולכן הוא נושא את הלוגו, את הצבעים ואת
     פרטי הסוכן/ת - ולא את שלנו. הצבעים עוברים normalizeHex (רק hex תקין
     נכנס ל-style), והתמונות רק ב-https. שוק נדל״ן נשאר בשורה אחת בתחתית,
     כמקור המערכת. */
  const b = brand || {};
  const brandStyle = `--cma-brand:${b.primary || '#1c3a5e'};--cma-brand-dark:${b.primaryDark || '#122840'};`
    + `--cma-on-brand:${b.onPrimary || '#ffffff'};--cma-accent:${b.accent || '#c0912f'}`;
  const agentLine = [
    b.license ? `רישיון תיווך ${esc(b.license)}` : '',
    b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : '',
    b.email ? `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : '',
  ].filter(Boolean).join(' · ');

  const facts = [
    ['סוג', esc(s.property_type || '-')],
    s.rooms ? ['חדרים', esc(String(Number(s.rooms)))] : null,
    cov.band_dimension === 'floor' && cov.subject_floor_group
      ? ['קומה', ({ ground:'קרקע', upper:'עליונה', below:'מרתף' })[cov.subject_floor_group] || '-'] : null,
    s.size_sqm ? ['שטח', `${esc(s.size_sqm)} מ״ר`] : null,
    /* בדוח לכתובת (cma_report_address) המחיר המבוקש אינו חובה */
    s.price || s.source !== 'address' ? ['מחיר מבוקש', shekel(s.price)] : null,
    s.price_per_sqm ? ['למ״ר', shekel(s.price_per_sqm)] : null,
  ].filter(Boolean);

  /* דוח לכתובת: הרדיוס נמדד מהמיקום, והמיקום לא תמיד מהבניין עצמו
     (cma_locate_address, 20270819090000). ברחוב ארוך מספר בית אחר הוא
     מאות מטרים - הדוח אומר את זה ולא מציג אותו כמדויק. */
  const LOC_NOTE = {
    street_nearest: `המרחקים נמדדו ממספר ${esc(s.nearest_house_number || '')} באותו רחוב, הכתובת עצמה לא מוקמה בדיוק.`,
    street: 'לא צוין מספר בית, ולכן המרחקים נמדדו ממרכז הרחוב.',
  };
  const locNote = s.source === 'address' ? (LOC_NOTE[s.location_precision] || '') : '';

  document.getElementById('cmaBody').innerHTML = `
   <div class="cma-doc" style="${brandStyle}">
    <header class="cma-brandbar">
      <div class="cma-brand-id">
        ${b.logo ? `<span class="cma-logo"><img src="${esc(b.logo)}" alt="${esc(b.agencyName || '')}"></span>` : ''}
        <span class="cma-agency">${esc(b.agencyName || '')}</span>
      </div>
      <div class="cma-doc-title">
        <span class="cma-kicker">דוח השוואת שוק</span>
        <span class="cma-date">${new Date(r.generated_at).toLocaleDateString('he-IL')}</span>
      </div>
    </header>

    ${b.agentName ? `
    <div class="cma-agent">
      ${b.agentPhoto ? `<img class="cma-agent-photo" src="${esc(b.agentPhoto)}" alt="">` : `<span class="cma-agent-photo is-initial">${esc((b.agentName || '').trim().charAt(0))}</span>`}
      <div class="cma-agent-txt">
        <div class="cma-agent-name">הוכן עבורך על ידי ${esc(b.agentName)}</div>
        ${agentLine ? `<div class="cma-agent-meta">${agentLine}</div>` : ''}
      </div>
    </div>` : ''}

    <section class="cma-hero">
      <h2>${esc(s.title)}</h2>
      <div class="cma-addr">${esc([s.address, s.city].filter(Boolean).join(', '))}</div>
      ${locNote ? `<div class="cma-note" style="margin-bottom:10px">${locNote}</div>` : ''}
      <dl class="cma-chips">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    </section>

    <section class="cma-sec">
      <h3 class="cma-h">לוח המדדים</h3>
      ${hasStats ? `
        ${heroBlock}
        ${gauges ? `<div class="cma-gauges">${gauges}</div>` : ''}
        <div class="cma-stats">
          <div class="cma-stat"><div class="l">מחיר ממוצע</div><div class="n">${shekel(st.avg_price)}</div></div>
          <div class="cma-stat"><div class="l">מחיר חציוני</div><div class="n">${shekel(st.median_price)}</div></div>
          <div class="cma-stat"><div class="l">ממוצע למ״ר</div><div class="n">${st.avg_price_per_sqm ? shekel(st.avg_price_per_sqm) : '-'}</div></div>
          <div class="cma-stat"><div class="l">שטח ממוצע</div><div class="n">${st.avg_size_sqm ? esc(st.avg_size_sqm) + ' מ״ר' : '-'}</div></div>
        </div>
        ${rangeBlock}
        ${gapExplain}
        ${cmaSampleNote(cov, r.radius_meters_used)}
        ${!st.avg_price_per_sqm
          ? '<div class="cma-note">לא נמצאו נתוני שטח לעסקאות ההשוואה, ולכן אין ממוצע מחיר למ״ר.</div>' : ''}
      ` : cmaCoverageBlock(cov)}
    </section>

    ${landBlock}

    ${comps.length ? `
    <section class="cma-sec">
      <h3 class="cma-h">${hasStats ? 'העסקאות הדומות ביותר' : 'עסקאות בסביבת הנכס'}</h3>
      <p class="cma-cap">${compsCaption}</p>
      <div class="cma-tablewrap"><table class="cma-table">
        <thead><tr><th></th><th>נכס</th><th>שטח</th><th>מחיר</th><th>למ״ר</th><th>מרחק</th><th>תאריך</th>${ownTh}</tr></thead>
        <tbody>${compRows}</tbody>
      </table></div>
    </section>` : ''}

    ${marketComps.length ? `
    <section class="cma-sec">
      <h3 class="cma-h">מתחרים בשוק עכשיו</h3>
      ${Array.isArray(s.features) && s.features.length
        ? `<div class="cma-note">המאפיינים של הנכס: ${esc(s.features.map(f => cmaFeatureLabel(f, s)).join(' · '))}</div>`
        : ''}
      ${cmaMarketNote(cov)}
      ${mst.median_price ? `
        <div class="cma-stats">
          <div class="cma-stat"><div class="n">${shekel(mst.median_price)}</div><div class="l">מבוקש חציוני</div></div>
          <div class="cma-stat"><div class="n">${mst.median_price_per_sqm ? shekel(mst.median_price_per_sqm) : '-'}</div><div class="l">מבוקש חציוני למ״ר</div></div>
          <div class="cma-stat"><div class="n">${esc(mst.count)}</div><div class="l">נכסים בהשוואה</div></div>
          <div class="cma-stat"><div class="n">${esc(cov.market_comparables_total)}</div><div class="l">סה״כ בסביבה</div></div>
        </div>
        ${cmaGapLine(marketGap,    'המחיר המבוקש שלנו מול המבוקש בשוק',      mst.count)}
        ${cmaGapLine(marketSqmGap, 'המחיר המבוקש שלנו למ״ר מול המבוקש בשוק', mst.sqm_sample_size ?? mst.count)}` : ''}
      <div class="cma-tablewrap"><table class="cma-table">
        <thead><tr><th>נכס</th><th>חדרים</th><th>שטח</th><th>מחיר</th><th>למ״ר</th><th>התאמת מאפיינים</th><th>מרחק</th></tr></thead>
        <tbody>${marketRows}</tbody>
      </table></div>
      ${Number(cov.market_comparables_total) > marketComps.length
        ? `<p class="cma-cap">מוצגים ${esc(marketComps.length)} מתוך ${esc(cov.market_comparables_total)}, לפי סדר ההתאמה.</p>` : ''}
    </section>` : ''}

    ${hoodComps.length ? `
    <section class="cma-sec">
      <h3 class="cma-h">בשכונת ${esc(cov.neighborhood_name || '')}</h3>
      <p class="cma-cap">עסקאות רשמיות באותה שכונה שאין להן כתובת מדויקת, ולכן הן השוואה נפרדת ואינן בחישוב שלמעלה.
        ${Number(cov.neighborhood_shared_count) > 0
          ? `${esc(cov.neighborhood_shared_count)} מהן רשומות בשם שמכסה כמה שכונות סמוכות ("משותפת").` : ''}</p>
      ${hst.median_price ? `
        <div class="cma-stats">
          <div class="cma-stat"><div class="n">${shekel(hst.median_price)}</div><div class="l">מחיר חציוני</div></div>
          <div class="cma-stat"><div class="n">${hst.median_price_per_sqm ? shekel(hst.median_price_per_sqm) : '-'}</div><div class="l">חציון למ״ר</div></div>
          <div class="cma-stat"><div class="n">${esc(hst.count)}</div><div class="l">עסקאות בחציון</div></div>
          <div class="cma-stat"><div class="n">${esc(cov.neighborhood_comparables_total)}</div><div class="l">סה״כ בשכונה</div></div>
        </div>
        ${cmaGapLine(hoodGap,    'המחיר המבוקש מול החציון בשכונה',      hst.count)}
        ${cmaGapLine(hoodSqmGap, 'המחיר המבוקש למ״ר מול החציון בשכונה', hst.sqm_sample_size ?? hst.count)}`
      : `<div class="cma-note">${esc(cov.neighborhood_comparables_counted)} מהן תואמות לנכס בסוג ובגודל - פחות מ-${esc(cov.min_required)}, ולכן אין כאן חציון.</div>`}
      <div class="cma-tablewrap"><table class="cma-table">
        <thead><tr><th>סוג</th><th>חדרים</th><th>שטח</th><th>מחיר</th><th>למ״ר</th><th>תאריך</th>${ownTh}</tr></thead>
        <tbody>${hoodRows}</tbody>
      </table></div>
      ${Number(cov.neighborhood_comparables_total) > hoodComps.length
        ? `<p class="cma-cap">מוצגות ${esc(hoodComps.length)} האחרונות מתוך ${esc(cov.neighborhood_comparables_total)}.</p>` : ''}
    </section>` : ''}

    ${(Number(cov.excluded_other_type) > 0 || askingNote || Number(cov.city_comparables_total) > 0) ? `
    <section class="cma-sec cma-method">
      <h3 class="cma-h">על מה הדוח נשען</h3>
      ${Number(cov.excluded_other_type) > 0
        ? `<div class="cma-note">${esc(cov.excluded_other_type)} עסקאות בסביבה הן בסוג נכס אחר, ואינן נספרות בממוצע.</div>` : ''}
      ${askingNote}
      ${Number(cov.city_comparables_total) > 0
        ? `<div class="cma-note">עוד ${esc(cov.city_comparables_total)} עסקאות ב${esc(s.city)} אינן נכללות בחישוב, כי אין להן מיקום מדויק ואי אפשר למדוד את המרחק שלהן מהנכס.</div>` : ''}
    </section>` : ''}

    <footer class="cma-foot">
      ${b.agentName ? `<div class="cma-foot-agent"><strong>${esc(b.agentName)}</strong>${b.agencyName ? ' · ' + esc(b.agencyName) : ''}${agentLine ? ' · ' + agentLine : ''}</div>` : ''}
      <p>${sourcesLine}
      המאגר אינו כולל עסקאות שלא נסגרו דרך הפלטפורמה, ולכן אינו תמונה מלאה של השוק באזור.
      ${r.planning ? 'המידע התכנוני מבוסס על שכבות ה-GIS של עיריית עפולה. ' : ''}
      ${own ? 'סוג הבעלות מפנקסי המקרקעין (משרד המשפטים)' + (own.as_of ? ', נכון ל-' + new Date(own.as_of).toLocaleDateString('he-IL') : '')
        + ', ואינו קובע זכות משפטית - לבדיקת הזכויות יש להזמין נסח טאבו. ' : ''}
      הנתונים נכונים למועד ההפקה, מוצגים לצורך התרשמות כללית בלבד, ואינם מהווים שומת
      מקרקעין, ייעוץ מקצועי או תחליף לבדיקה פרטנית.</p>
      <div class="cma-made"><img src="assets/logo-shuknadlan.svg" alt="" width="14" height="17"> הופק במערכת שוק נדל״ן</div>
    </footer>
   </div>`;

  document.getElementById('cmaOverlay').style.display = 'block';
}
