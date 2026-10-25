/* ==========================================================================
   מדריך ההתחלה - שבעה צעדים בשני שלבים, לפי דחיפות
   --------------------------------------------------------------------------
   שלב 7 בשדרוג ה-CRM (docs/handoff/crm-redesign/HANDOFF.md, סעיף 7;
   docs/agent-onboarding.md). העיצוב: design/Onboarding-Desktop.dc.html,
   design/Onboarding-Mobile.dc.html.

     להופיע באתר     1. אימות רישיון   2. תמונה, משפט ואזורים   3. הנכס הראשון
     להתחיל לעבוד    4. גבריאלה   5. הלקוח/ה הראשון/ה   6. יומן Google   7. העדפות לידים
     להתבלט (רשות)   תמונת נושא וניסיון · ביקורת ראשונה · (מנהל/ת) המשרד · הזמנת סוכנים

   קודם להופיע באתר: עד שהרישיון מאושר, דף הסוכן/ת, דף המשרד והמודעות שמורים
   במערכת ולא מוצגים לגולשים (license_hold_at, docs/broker-registry.md).

   **המצב אינו נשמר כאן ואינו צ'קליסט.** ‏agent_onboarding_state() מחשבת אותו
   במסד מהמציאות בכל קריאה (20270602100000), ולכן נכס או לקוח/ה שנפתחו דרך
   גבריאלה סוגרים צעד בדיוק כמו מהטופס. ‏done נקרא מהשורה שהמסד החזיר ולא
   מחושב כאן שוב: תנאי משוכפל בין שרת לדפדפן מתפצל.

   **הצעדים אינם נעולים זה בזה.** הסדר הוא המלצה, ו"הצעד הבא" הוא הראשון
   שפתוח. גבריאלה והיומן מגודרים ל-mid/premium (‏whatsapp_included): במסלול
   אחר הצעד מוצג "במסלול PROFESSIONAL ומעלה" ואינו נספר.

   מנהל/ת שאינו/ה סוכן/ת פעיל/ה (‏agent_steps = false) רואה רק את צעדי המשרד.

   הקובץ נטען לפני assets/crm.js. הפונקציות כאן נקראות רק אחרי שהוא רץ
   (loadDashboard), ולכן הגלובלים שלו (gotoSection, openInlineForm, esc,
   currentAgent...) זמינים בזמן הקריאה.
   ========================================================================== */

/* הצעדים. ‏min - הזמן המשוער בדקות. ‏acc - הקטגוריה שהכפתור פותח, כדי
   לא להציע כפתור לקטגוריה שמוסתרת לקורא/ת (navAccVisible). */
const ONB_STEP_DEFS = {
  license: {
    title: 'אימות רישיון תיווך', min: 1,
    hint: 'בלי אימות, הדף שלך והמודעות לא מוצגים לגולשים',
    why: 'זה הצעד שמעלה אותך לאוויר. עד שהרישיון מאומת, דף הסוכן/ת והמודעות שלך שמורים במערכת אבל גולשים לא רואים אותם. מספיק צילום של תעודת הרישיון.',
    cta: 'העלאת אישור רישיון', run: () => onbLicenseAppeal(),
    alt: 'תיקון מספר הרישיון', altRun: () => onbLicenseFix(),
    done: s => s.license_done },
  bio: {
    title: 'תמונה, משפט עליך ואזורי שירות', min: 3, acc: 'accProfile',
    hint: 'מה שגולש/ת רואה לפני שמחליט/ה להתקשר',
    why: 'פרופיל עם תמונה ותיאור קצר נראה אמין, ואזורי השירות קובעים באילו ערים ושכונות הדף והמודעות שלך יופיעו.',
    cta: 'השלמת הפרופיל', run: () => gotoSection('accProfile', onbBioFocus()),
    done: s => s.bio_done },
  property: {
    title: 'העלאת הנכס הראשון', min: 4, acc: 'accProperties',
    hint: 'מהטופס, או בהודעה לגבריאלה בוואטסאפ',
    why: 'הנכס הראשון הופך את הדף שלך מכרטיס ביקור למקום שאפשר לפנות ממנו. אפשר גם לשלוח לגבריאלה פרטים ותמונות, והיא תכין טיוטה.',
    cta: 'העלאת נכס', run: () => openInlineForm('accProperties', 'addPropertyForm', 'toggleAddProperty'),
    alt: 'לשלוח לגבריאלה', altWhen: s => s.whatsapp_included,
    altRun: () => onbOpenGabriela('רוצה להעלות נכס חדש'),
    done: s => s.property_done },
  /* גבריאלה היא העוזרת האישית: מעלה נכסים ולקוחות, קובעת פגישות ועונה על
     שאלות (החלטה 6). המספר כבר נשמר בהרשמה, ולכן "בלחיצה". */
  whatsapp: {
    title: 'חיבור גבריאלה, העוזרת האישית בוואטסאפ', min: 10 / 60,
    hint: 'מעלה נכסים ולקוחות מהוואטסאפ, קובעת פגישות ועונה על שאלות',
    why: 'שולחים לגבריאלה הודעה, תמונות או הקלטה, והיא פותחת נכס או לקוח/ה במערכת, מוסיפה פגישה ליומן או עונה על שאלה מהמידע שלך. כך עובדים מהשטח בלי לפתוח את המחשב.',
    cta: 'חיבור בלחיצה', run: () => onbOpenGabriela(ASSISTANT_WA_HELLO),
    locked: s => !s.whatsapp_included,
    lockedHint: 'גבריאלה כלולה במסלול PROFESSIONAL ומעלה',
    done: s => s.whatsapp_done },
  client: {
    title: 'הוספת הלקוח/ה הראשון/ה', min: 2, acc: 'accClients',
    hint: 'קונה, שוכר/ת או בעל/ת נכס - מהטופס או דרך גבריאלה',
    why: 'מרגע שיש לקוח/ה עם דרישות, ההתאמות החכמות מתחילות לעבוד: כל נכס חדש שמתאים, שלך או של שותפים, יגיע אליך כהתאמה.',
    cta: 'הוספת לקוח/ה', run: () => openInlineForm('accClients', 'addClientForm', 'toggleAddClient'),
    alt: 'ייבוא אנשי קשר', altRun: () => openContactImport(),
    done: s => s.client_done },
  /* יומן Google חזר להיות צעד - החלטה 5 של תומר. מי שדילג/ה עדיין מקבל/ת
     את ההצעה אחרי הפגישה הראשונה (offerGcalAfterMeeting). */
  calendar: {
    title: 'חיבור יומן Google', min: 0.5, acc: 'accAgenda',
    hint: 'פגישות וסיורים מהמערכת מופיעים ביומן שלך',
    why: 'כל פגישה, סיור ותזכורת שנקבעים במערכת או דרך גבריאלה נכנסים ליומן שבטלפון, כך ששום פגישה לא נשכחת.',
    cta: 'חיבור היומן', run: btn => startGcalConnect(btn),
    // היומן מגודר כמו גבריאלה (agent_agenda_enabled, docs/google-calendar.md)
    locked: s => !s.whatsapp_included,
    lockedHint: 'היומן כלול במסלול PROFESSIONAL ומעלה',
    done: s => s.calendar_done },
  prefs: {
    title: 'העדפות לידים', min: 2, acc: 'accPrefs',
    hint: 'אזורים וסוגי נכסים, כדי לקבל לידי בעלים שמתאימים לך',
    why: 'לפי ההעדפות המערכת מחליטה אילו לידי בעלים להציע לך. ליד בעלים בלעדי לך 12 שעות, וההתראה עליו מגיעה מיד.',
    cta: 'הגדרת העדפות', run: () => gotoSection('accPrefs'),
    done: s => s.prefs_done },
  cover: {
    title: 'תמונת נושא, ניסיון והתמחויות', min: 3, acc: 'accProfile',
    hint: 'מוסיף אמינות לדף שלך',
    cta: 'הוספה', run: () => gotoSection('accProfile'),
    done: s => s.cover_done },
  review: {
    title: 'חוות דעת ראשונה מלקוח/ה', min: 1, acc: 'accLeads',
    hint: 'מכרטיס הליד: "בקשת חוות דעת" שולח ללקוח/ה קישור בוואטסאפ',
    cta: 'ללידים', run: () => gotoSection('accLeads'),
    done: s => s.review_done },
  office: {
    title: 'לוגו המשרד ו"על המשרד"', min: 4, acc: 'accBranding',
    hint: 'הטקסט שבראש דף המשרד, ומה שגוגל ומנועי AI קוראים עליו',
    why: 'דף המשרד בלי לוגו ובלי תיאור הוא שם ורשימת נכסים. כמה משפטים על הניסיון, האזורים וסוגי הנכסים מוצגים בראש הדף.',
    cta: 'מיתוג המשרד', run: () => gotoSection('accBranding', onbState().agency_done ? 'brDescription' : undefined),
    when: s => s.is_manager,
    done: s => s.agency_done && s.about_done },
  invite: {
    title: 'הזמנת הסוכנים למשרד', min: 2, acc: 'accTeam',
    hint: 'קישור הזמנה במייל או בוואטסאפ',
    why: 'כל סוכן/ת שמצטרף/ת מקבל/ת דף משלו/ה תחת המשרד, והנכסים שלו/ה נכנסים לדאשבורד המשרד.',
    cta: 'הזמנה', run: () => gotoSection('accTeam'),
    when: s => s.is_manager,
    done: s => s.invite_done },
};

const ONB_STAGES = [
  { key:'live',  title:'להופיע באתר',  tag:'דחוף',  steps:['license', 'bio', 'property'] },
  { key:'work',  title:'להתחיל לעבוד', tag:'השבוע', steps:['whatsapp', 'client', 'calendar', 'prefs'] },
  { key:'extra', title:'להתבלט',       tag:'רשות',  optional:true, steps:['cover', 'review', 'office', 'invite'] },
];
/* מנהל/ת שאינו/ה סוכן/ת פעיל/ה: רק המשרד */
const ONB_STAGES_OFFICE = [
  { key:'office', title:'המשרד שלך', tag:'דחוף', steps:['office', 'invite'] },
];

const ONB_COMPACT_KEY = 'shuknadlan.onb_compact';

/* השורה שהמסד החזיר, או null כשאין מדריך. ‏onboardingLive משמש גם את
   NOTIF_TYPES: תיבת הסימון של התראת הדרבון מוצגת רק כל עוד המדריך חי. */
let onboardState = null;
let onboardLastLoad = 0;
function onbState(){ return onboardState || {}; }
function onboardingLive(){ return !!onboardState; }

async function loadOnboarding(){
  const box = document.getElementById('onbGuide');
  if (!box) return;
  onboardLastLoad = Date.now();
  try{
    const { data, error } = await sb.rpc('agent_onboarding_state');
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) || null;
    // ‏Netlify מפרסם את ה-HTML תוך שניות, והמיגרציה רצה ב-Actions. בחלון של
    // הדקות שבינתיים השורה היא עוד של המדריך הקודם (בלי license_done), והמדריך
    // פשוט לא מוצג - עדיף מכרטיס עם צעדים שאי אפשר לסגור.
    onboardState = row && row.license_done !== undefined ? row : null;
    renderOnboarding();
    /* גיליון אחד במובייל על הפריט החסר הבא. אותו מצב, בלי חישוב שני. */
    if (typeof profileNudgeSchedule === 'function') profileNudgeSchedule();
  } catch(err){
    console.warn('מדריך ההתחלה אינו זמין:', err);
    onboardState = null;
    box.hidden = true;
  }
}

/* מה שנקרא אחרי שמירה שעשויה לסגור צעד: המצב, והפעמון - הדרבון על הצעד
   הבא נולד בטריגר במסד באותה שמירה. שתיהן רק בזמן המדריך. */
function refreshOnboarding(){
  if (!onboardingLive()) return;
  loadOnboarding();
  if (currentAgent) loadNotifications(currentAgent.id);
}

/* ---------- עזרי הכפתורים ---------- */
function onbOpenGabriela(text){
  if (currentAgent && String(currentAgent.phone || '').trim()){
    // אנדרואיד - וואטסאפ ביזנס ישירות (assistantWaUrl), אחרת wa.me בלשונית חדשה
    if (IS_ANDROID) location.href = assistantWaUrl(text);
    else window.open(assistantWaUrl(text), '_blank', 'noopener');
  } else {
    gotoSection('accWhatsapp', 'waPhone');
  }
}

/* הרישיון: אותה זרימה של כרטיס הרישיון שבראש הדשבורד (‏openLicenseAppeal) */
function onbLicenseAppeal(){
  openLicenseAppeal({
    license: (typeof licenseState !== 'undefined' && licenseState && licenseState.license_number)
      || (currentAgent && currentAgent.license_number) || '',
    name:   (currentAgent && currentAgent.display_name) || '',
    email:  (currentAgent && currentAgent.email) || '',
    source: 'crm',
  });
}
function onbLicenseFix(){
  const card = document.getElementById('licenseHoldCard');
  const fix = document.getElementById('lhFixBtn');
  if (!card || card.hidden || !fix){ onbLicenseAppeal(); return; }
  card.classList.remove('is-compact');
  const row = document.getElementById('lhFixRow');
  if (row && row.hidden) fix.click();
  card.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* בפרופיל: לשדה הראשון שחסר */
function onbBioFocus(){
  const a = currentAgent || {};
  if (!String(a.photo_url || '').trim()) return undefined;
  if (String(a.bio || '').trim().length < 20) return 'pfBio';
  return 'pfMarkets';
}

/* ---------- החישוב ---------- */
function onbModel(s){
  const stages = (s.agent_steps === false ? ONB_STAGES_OFFICE : ONB_STAGES).map(st => {
    const steps = st.steps
      .map(key => Object.assign({ key }, ONB_STEP_DEFS[key]))
      .filter(d => !d.when || d.when(s))
      .map(d => Object.assign(d, {
        isDone: !!d.done(s),
        isLocked: !!(d.locked && d.locked(s)),
        canRun: !d.acc || typeof navAccVisible !== 'function' || navAccVisible(d.acc),
      }));
    return Object.assign({}, st, { steps, allDone: steps.every(x => x.isDone || x.isLocked) });
  }).filter(st => st.steps.length);
  // הצעדים שנספרים: לא רשות ולא נעולים במסלול
  const required = stages.filter(st => !st.optional).flatMap(st => st.steps).filter(x => !x.isLocked);
  const done = required.filter(x => x.isDone).length;
  const next = required.find(x => !x.isDone)
    || stages.filter(st => st.optional).flatMap(st => st.steps).find(x => !x.isDone && !x.isLocked) || null;
  const minutes = required.filter(x => !x.isDone).reduce((t, x) => t + (x.min || 0), 0);
  const nextStage = next ? stages.find(st => st.steps.includes(next)) : null;
  return { stages, required, done, total: required.length, next, nextStage, minutes };
}

function onbTime(min){
  if (!min) return '';
  return min < 1 ? Math.round(min * 60) + ' שנ׳' : Math.round(min) + ' דק׳';
}

/* ---------- הציור ---------- */
function onbRing(done, total){
  const C = 2 * Math.PI * 30;
  const p = total ? done / total : 0;
  return `<div class="onb2-ring" aria-hidden="true"><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="7"/>
    <circle cx="36" cy="36" r="30" fill="none" stroke="#6E9BFF" stroke-width="7" stroke-linecap="round" transform="rotate(-90 36 36)"
      stroke-dasharray="${(p * C).toFixed(1)} ${C.toFixed(1)}"/></svg>
    <span><b>${done}/${total}</b><small>צעדים</small></span></div>`;
}

function onbHeroText(m, s){
  if (s.agent_steps === false){
    return { title: m.done >= m.total ? 'המשרד מוכן' : 'בוא/י נכין את המשרד',
             sub: 'מנהל/ת שאינו/ה סוכן/ת פעיל/ה: רק מה שהמשרד צריך כדי להופיע ולגדול.' };
  }
  const live = m.stages.find(st => st.key === 'live');
  if (m.done >= m.total) return { title:'מוכנים! את/ה באוויר והמערכת עובדת בשבילך', sub:'מכאן אפשר להתבלט עם הצעדים שבסוף הרשימה.' };
  if (live && live.allDone) return { title:'את/ה באתר. עכשיו נכין את המערכת לעבודה',
    sub:'עוד כמה צעדים קצרים: גבריאלה, הלקוח/ה הראשון/ה, היומן והעדפות הלידים.' };
  return { title:'בוא/י נעלה אותך לאוויר',
    sub:'שלושה צעדים כדי שגולשים יראו אותך ואת הנכסים שלך, ועוד ארבעה כדי שהמערכת תעבוד בשבילך.' };
}

function onbStepButtons(step, main){
  const wrap = document.createElement('div');
  wrap.className = 'onb2-acts';
  if (step.isLocked){
    if (typeof navAccVisible !== 'function' || navAccVisible('accSubscriptions')){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = main ? 'onb2-go' : 'onb2-link';
      b.textContent = 'למסלולים';
      b.addEventListener('click', () => gotoSection('accSubscriptions'));
      wrap.appendChild(b);
    }
    return wrap;
  }
  if (!step.canRun) return wrap;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = main ? 'onb2-go' : 'onb2-link';
  b.textContent = main ? step.cta : step.cta + ' ←';
  b.addEventListener('click', () => step.run(b));
  wrap.appendChild(b);
  if (main && step.alt && (!step.altWhen || step.altWhen(onbState()))){
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'onb2-alt';
    a.textContent = step.alt;
    a.addEventListener('click', () => step.altRun());
    wrap.appendChild(a);
  }
  return wrap;
}

/* "כך רואים אותך באתר": רק מה שכבר בזיכרון (currentAgent, myPropertyRows),
   בלי שאילתה. כל חלק חסר במסגרת מקווקוות. */
function onbPreviewHtml(s){
  const a = currentAgent || {};
  const props = (typeof myPropertyRows !== 'undefined' ? myPropertyRows : []).filter(p => p.agent_id === a.id);
  const first = props.find(p => p.status === 'active') || props[0];
  const photo = String(a.photo_url || '').trim();
  const bio = String(a.bio || '').trim();
  const initials = String(a.display_name || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2);
  return `<div class="onb2-prev">
    <div class="onb2-prev-h"><b>כך רואים אותך באתר</b>${s.license_done && typeof miniSiteUrl === 'function'
      ? `<a href="${escapeHtml(miniSiteUrl())}" target="_blank" rel="noopener">לדף המלא ↗</a>` : ''}</div>
    <div class="onb2-prev-card">
      <div class="onb2-prev-cover${String(a.cover_url || '').trim() ? '' : ' is-missing'}">${String(a.cover_url || '').trim()
        ? `<img src="${escapeHtml(a.cover_url)}" alt="">` : 'תמונת נושא (רשות)'}</div>
      <div class="onb2-prev-who">
        <span class="onb2-prev-photo${photo ? '' : ' is-missing'}">${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(initials || 'תמונה')}</span>
        <div><b>${escapeHtml(a.display_name || 'השם שלך')}</b>
          <span class="${s.license_done ? 'is-ok' : 'is-wait'}">${s.license_done ? 'רישיון תיווך מאומת' : 'ממתין לאימות רישיון'}</span></div>
      </div>
      <p class="onb2-prev-bio${bio.length >= 20 ? '' : ' is-missing'}">${bio ? escapeHtml(bio.length > 120 ? bio.slice(0, 118) + '…' : bio) : 'משפט קצר עליך'}</p>
      <div class="onb2-prev-prop${first ? '' : ' is-missing'}">${first
        ? escapeHtml(first.title || first.address || 'הנכס הראשון') + (props.length > 1 ? ` <small>ועוד ${props.length - 1}</small>` : '')
        : 'הנכס הראשון שלך'}</div>
    </div>
    <p class="onb2-prev-note">מסגרת מקווקוות = חסר. כל צעד ממלא חלק מהדף.</p>
  </div>`;
}

function renderOnboarding(){
  const box = document.getElementById('onbGuide');
  if (!box) return;
  const s = onboardState;
  if (!s){ box.hidden = true; return; }
  box.hidden = false;

  // ‏just_finished מגיע רק מהקריאה שסגרה את המדריך - בקריאה הבאה הפונקציה כבר
  // מחזירה אפס שורות. זה בדיוק אורך החיים הנכון של "סיימת".
  if (s.just_finished){
    box.innerHTML = `<div class="onb2-hero is-done"><div class="onb2-hero-main">
      <h2 id="onbTitle">סיימת את מדריך ההתחלה</h2>
      <p>${s.agent_steps === false ? 'המשרד ממותג והסוכנים הוזמנו.' : 'את/ה באוויר, והמערכת מוכנה לעבוד בשבילך.'} מכאן זה המסך הרגיל שלך - והמדריך לא יחזור.</p>
    </div></div>`;
    return;
  }

  const m = onbModel(s);
  const hero = onbHeroText(m, s);
  let compact = false;
  try { compact = sessionStorage.getItem(ONB_COMPACT_KEY) === '1'; } catch(_){ }
  box.classList.toggle('is-compact', compact);

  const chip = s.agent_steps === false ? '' : `<span class="onb2-live${s.license_done ? ' is-on' : ''}"><i></i>${
    s.license_done ? 'הדף שלך מוצג לגולשים' : 'הדף שלך עוד לא מוצג לגולשים'}</span>`;
  box.innerHTML = `
    <div class="onb2-hero">
      ${onbRing(m.done, m.total)}
      <div class="onb2-hero-main">
        <h2 id="onbTitle">${escapeHtml(hero.title)}</h2>
        <p class="onb2-sub">${escapeHtml(hero.sub)}</p>
        <div class="onb2-meta">${chip}${m.minutes ? `<span>כ-${Math.max(1, Math.round(m.minutes))} דקות בסך הכל</span>` : ''}</div>
      </div>
      <div class="onb2-hero-acts">
        <button type="button" class="onb2-later" data-onb-compact="${compact ? '0' : '1'}">${compact ? 'פתיחת המדריך' : 'אחר כך'}</button>
        <button type="button" class="onb2-x" id="onbDismiss" aria-label="הסתרת מדריך ההתחלה" title="הסתרת המדריך">✕</button>
      </div>
      <div class="onb2-bars" aria-hidden="true">${m.required.map(x => `<i class="${x.isDone ? 'is-done' : ''}"></i>`).join('')}</div>
    </div>
    ${compact ? '' : `<div class="onb2-grid">
      <div class="onb2-next" id="onbNext"></div>
      ${s.agent_steps === false ? '' : onbPreviewHtml(s)}
    </div>
    <div class="onb2-stages" id="onbStages"></div>`}`;

  if (compact) return;

  // הצעד הבא: כרטיס גדול עם כפתור ראשי ומשני
  const nextBox = box.querySelector('#onbNext');
  if (m.next){
    nextBox.innerHTML = `<div class="onb2-next-top"><span>הצעד הבא · ${escapeHtml(m.nextStage ? m.nextStage.title : '')}</span>
        ${m.next.min ? `<span class="onb2-time">${escapeHtml(onbTime(m.next.min))}</span>` : ''}</div>
      <h3>${escapeHtml(m.next.title)}</h3>
      <p>${escapeHtml(m.next.why || m.next.hint || '')}</p>`;
    nextBox.appendChild(onbStepButtons(m.next, true));
  } else {
    nextBox.innerHTML = '<div class="onb2-next-top"><span>הכל מוכן</span></div><h3>סיימת את כל הצעדים</h3><p>המדריך ייסגר בטעינה הבאה.</p>';
  }

  // כל הצעדים, לפי שלבים
  const list = box.querySelector('#onbStages');
  m.stages.forEach(st => {
    const sec = document.createElement('section');
    sec.className = 'onb2-stage' + (st.optional ? ' is-optional' : '');
    const tag = st.allDone && !st.optional ? 'הושלם' : st.tag;
    sec.innerHTML = `<div class="onb2-stage-h"><h3>${escapeHtml(st.title)}</h3>
      <span class="onb2-tag is-${st.allDone && !st.optional ? 'done' : st.key}">${escapeHtml(tag)}</span></div>`;
    const ol = document.createElement('ol');
    st.steps.forEach(step => {
      const isNext = step === m.next;
      const li = document.createElement('li');
      li.className = 'onb2-step' + (step.isDone ? ' is-done' : '') + (isNext ? ' is-now' : '') + (step.isLocked ? ' is-locked' : '');
      const n = st.optional ? '+' : String(m.required.indexOf(step) + 1 || '•');
      li.innerHTML = `<span class="onb2-mark" aria-hidden="true">${step.isDone ? '✓' : escapeHtml(n)}</span>
        <div class="onb2-step-body"><b>${escapeHtml(step.title)}</b>
          <span>${escapeHtml(step.isLocked ? step.lockedHint : step.hint)}</span></div>
        ${step.isDone || step.isLocked || !step.min ? '' : `<span class="onb2-time">${escapeHtml(onbTime(step.min))}</span>`}`;
      if (!step.isDone && !isNext) li.appendChild(onbStepButtons(step, false));
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    list.appendChild(sec);
  });
}

/* ---------- אירועים ---------- */
(function wireOnboarding(){
  const box = document.getElementById('onbGuide');
  if (!box) return;
  box.addEventListener('click', async e => {
    const c = e.target.closest('[data-onb-compact]');
    if (c){
      try {
        if (c.dataset.onbCompact === '1') sessionStorage.setItem(ONB_COMPACT_KEY, '1');
        else sessionStorage.removeItem(ONB_COMPACT_KEY);
      } catch(_){ }
      renderOnboarding();
      return;
    }
    /* הסתרה היא בקשה להפסיק, ולא רק להעלים כרטיס: אותה חותמת במסד סוגרת
       גם את התראת הדרבון. לכן היא נאמרת במפורש בשאלה. */
    if (e.target.closest('#onbDismiss')){
      if (!confirm('להסתיר את מדריך ההתחלה? גם ההתראות שמזכירות את הצעדים הבאים ייפסקו.')) return;
      try{
        const { error } = await sb.rpc('agent_onboarding_dismiss');
        if (error) throw error;
      } catch(err){
        console.warn('הסתרת מדריך ההתחלה נכשלה:', err);
      }
      onboardState = null;
      box.hidden = true;
    }
  });

  /* גבריאלה, היומן והרישיון נסגרים **מחוץ לדף הזה** (בוואטסאפ, אצל Google,
     אצל מי שבודק/ת את הרישיון), ולכן החזרה ללשונית היא הרגע לשאול שוב.
     החניקה ל-15 שניות - שמעבר בין לשוניות לא יהפוך לקריאה בכל החלפה. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!onboardingLive() || !currentAgent) return;
    if (Date.now() - onboardLastLoad < 15000) return;
    loadOnboarding();
  });
})();
