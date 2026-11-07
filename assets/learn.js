/* ============================================================================
   אזור הלמידה של קורס ההכנה למבחן המתווכים (learn.html)
   ----------------------------------------------------------------------------
   הנגן מצייר כל מסך לתוך #app, לפי הקנבס של קלוד דיזיין ("חפיסת קלפים",
   docs/exam-course-design-brief.md): פס ספיר עליון עם מד זהב, מפת הקורס
   כמסלול, קלפים (רעיון / סיפור מקרה / בדיקה מהירה / כרטיס זיכרון), סיום
   שיעור, סימולציה עם שעון, תוצאה, ותשלום.

   כל המידע מגיע מהמסד:
     course_me()              מצב הלומד/ת: גישה, התקדמות, סימולציות
     course_catalog()         פרקים ושיעורים (שמות וספירות, לכולם)
     course_lessons           גוף השיעור והצעדים, דרך RLS
     course_lesson_open()     רישום פתיחה
     course_attempt_start()   שאלות בלי תשובות (עם slug למיפוי צעדי check)
     course_answer()          בדיקה במסד, והסבר בחזרה (לא בסימולציה)
     course_attempt_finish()  ציון, סקירה, וסימון השיעור כהושלם

   **התשובות הנכונות לעולם אינן בדפדפן לפני המענה.** גוף השיעור (body_html)
   נכתב בידינו ונכנס ל-innerHTML כמו שהוא; כל טקסט אחר מהמסד עובר escapeHtml.
   התיעוד: docs/exam-course.md.
   ============================================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var PURCHASE_URL = SUPABASE_URL + '/functions/v1/course-purchase';
  var MENTOR = '/assets/mentor-avatar.webp';
  var LOGO = '/assets/logo-shuknadlan.svg';
  var LETTERS = ['א', 'ב', 'ג', 'ד'];
  var EXAM_SECONDS = 2 * 60 * 60;   // שעתיים, כמו בבחינה

  var PRAISE = ['בדיוק.', 'נכון.', 'יפה.', 'מצוין.'];
  var PRAISE_SUB = ['ככה חושבים על זה.', 'שמתם לב למילה שהכריעה?', 'זו שאלה שהרבה נופלים בה.', 'הסעיף הזה יחזור בבחינה.'];
  var CONSOLE_T = ['כמעט', 'לא הפעם', 'קרוב'];
  var CONSOLE_SUB = [
    'זו המלכודת הקלאסית של השאלה הזו. עכשיו כבר לא תיפלו בה.',
    'דווקא הטעויות האלה הן מה שנזכור בבחינה.',
    'שימו לב למה החלופה שבחרתם נשמעה הגיונית, ולמה היא בכל זאת שגויה.'
  ];
  var MAP_TIPS = [
    'בכל שאלה: קודם איזה חוק, אחר כך איזה כלל, ורק אז החלופות.',
    'חלופה עם "אך ורק" או "בכל מקרה" היא לרוב המלכודת.',
    'הבחינה עם חומר פתוח. מי שיודע איפה הסעיף יושב, מנצח את הזמן.',
    'אין ניקוד שלילי. תמיד מסמנים תשובה.'
  ];

  /* ---- אייקונים (stroke SVG, בלי אמוג'י) ---- */
  var I = {
    x: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    out: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>',
    check: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    check18: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    x16: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    play: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5.5v13a1 1 0 0 1-1.5.86L4.1 12.86a1 1 0 0 1 0-1.72l10.4-6.5A1 1 0 0 1 16 5.5z"/></svg>',
    lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
    clock15: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    scale: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z"/></svg>',
    flip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    doc: '<svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#e5c76a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h2"/></svg>',
    flag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>',
    prev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    lockS: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    arrowL: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    bubble: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>'
  };

  function $(id) { return document.getElementById(id); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function on(id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function errText(err) {
    var e = err && err.message ? err : { message: String(err && err.error || err || '') };
    return window.FriendlyError ? FriendlyError.text(e) : (e.message || 'משהו השתבש.');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' : '') + (h ? ('0' + m).slice(-2) : m) + ':' + ('0' + sec).slice(-2);
  }
  function render(html) { $('app').innerHTML = html; window.scrollTo(0, 0); }

  if (!window.supabase) {
    render('<div class="band"><div class="band-in"><div class="bar-row"><img class="logo" src="' + LOGO + '" alt=""><span class="brand">קורס ההכנה</span></div></div></div>' +
      '<div class="center"><div class="card"><p>לא הצלחנו לטעון את הקורס. כדאי לרענן את הדף.</p></div></div>');
    return;
  }
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* החיבור שפג באמצע שיעור. טלפון שהדף שכב בו ברקע לא מרענן את הטוקן בזמן,
     ובחזרה הבקשה הראשונה יוצאת עם טוקן שפג (PGRST303 / 401) או בלי טוקן בכלל
     (הפונקציות מחזירות unauthorized). מרעננים ומנסים פעם אחת שוב. */
  function authFailed(r) {
    if (!r) return false;
    var e = r.error;
    if (e) return r.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt|auth session/i.test(e.message || '');
    return !!(r.data && r.data.error === 'unauthorized');
  }
  // 'ok' | 'lost' (שרת האימות דחה את החיבור: אין דרך בלי כניסה מחדש) |
  // 'later' (רשת או 429 - הטלפון רק התעורר; החיבור עצמו אולי תקין, ולכן לא
  // זורקים למסך הכניסה). קריאות שנכשלו יחד (Promise.all) חולקות רענון אחד.
  var refreshing = null, authLost = false;
  function refreshAuth() {
    if (!refreshing) refreshing = (async function () {
      var res = await sb.auth.refreshSession();
      var final = function (x) { return x.error && x.error.status >= 400 && x.error.status < 500 && x.error.status !== 429; };
      if (res.error && !final(res)) {
        await new Promise(function (ok) { setTimeout(ok, 1500); });
        res = await sb.auth.refreshSession();
      }
      if (!res.error && res.data && res.data.session) return 'ok';
      return final(res) ? 'lost' : 'later';
    })().finally(function () { refreshing = null; });
    return refreshing;
  }
  // כשהחיבור באמת נגמר עוברים למסך הכניסה, וההבטחה נשארת תלויה בכוונה, כדי
  // שהקוד שחיכה לה לא יצייר מעל מסך הכניסה הודעה או מפה. ‏authLost מבטיח שזה
  // קורה פעם אחת, גם כשכמה קריאות נכשלו יחד. כשהרענון נכשל ברשת מחזירים את
  // הכישלון המקורי, והמסך שקרא מציג את "לנסות שוב" שלו.
  async function withAuth(call) {
    if (authLost || mfaGate) return new Promise(function () {});
    var r = await call();
    if (!authFailed(r)) return r;
    // הבקשה הגיעה למסד עם טוקן תקין, והפונקציה ענתה unauthorized: זה סימן
    // לחשבון שחייב אימות כניסה (מנהל/ת משרד, מנהל/ת פלטפורמה, מי שהפעיל/ה
    // אימות) ב-session שעוד לא אומת. ‏mfa_pre_request מאפס/ת אז את ה-claims
    // ו-auth.uid() הוא null, ורענון טוקן לא ישנה את זה (docs/mfa.md).
    if (!r.error && await mfaGateIfPending()) return new Promise(function () {});
    var how = await refreshAuth();
    // הטוקן הישן פג והחדש לא הגיע בגלל הרשת: ההודעה הנכונה היא
    // "אין חיבור", לא "להתחבר מחדש"
    if (how === 'later') return { data: null, error: { message: 'Failed to fetch' } };
    if (how === 'ok') {
      r = await call();
      if (!authFailed(r)) return r;
      // הבקשה הראשונה יצאה אולי בלי טוקן (טלפון שהתעורר), ולכן גם mfa_status
      // ענתה כאורח/ת. עם הטוקן החדש שואלים שוב.
      if (!r.error && await mfaGateIfPending(true)) return new Promise(function () {});
    }
    if (mfaGate) return new Promise(function () {});
    if (!authLost) {
      authLost = true;
      clearInterval(state.pollTimer); clearInterval(state.timerId);
      state.steps = null; state.sim = null; routed = false;
      renderLogin('החיבור לחשבון פג, וצריך להיכנס שוב. השיעורים שכבר הושלמו שמורים.');
    }
    return new Promise(function () {});
  }
  function rpc(name, args) { return withAuth(function () { return sb.rpc(name, args); }); }

  /* ------------------------------------------------------- אימות כניסה
     אותה זרימה כמו ב-CRM (assets/crm.js, showMfaChallenge): הודעה אחת
     לגבריאלה בוואטסאפ, או קוד מאפליקציית אימות. האימות הוא ל-session, ולכן
     מי שאימת/ה ב-CRM באותו דפדפן ובאותה כניסה לא יראה את המסך הזה. */
  var ASSISTANT_WA_NUMBER = '972532494740';
  var MFA_POLL_MS = 3000, MFA_POLL_MAX_MS = 10 * 60 * 1000;
  var mfaGate = null, mfaPoll = null, mfaProbe = null;
  async function mfaStatus() {
    var r = await sb.rpc('mfa_status');
    if (r.error) throw r.error;
    return r.data || {};
  }
  // בדיקה אחת משותפת לכל הקריאות שנכשלו יחד (Promise.all), כמו refreshing.
  // ‏fresh: אחרי רענון טוקן לא משתמשים בתשובה של בדיקה שיצאה עם הטוקן הישן.
  async function mfaGateIfPending(fresh) {
    if (mfaGate) return true;
    if (!mfaProbe || fresh) {
      mfaProbe = mfaStatus().then(function (st) { return st; }, function () { return null; });
      var mine = mfaProbe;
      mine.then(function () { setTimeout(function () { if (mfaProbe === mine) mfaProbe = null; }, 0); });
    }
    var st = await mfaProbe;
    if (mfaGate) return true;
    if (!st || !st.pending) return false;
    mfaGate = {};
    clearInterval(state.pollTimer); clearInterval(state.timerId);
    state.steps = null; state.sim = null;
    renderMfa(st);
    return true;
  }
  function mfaStopPolling() { if (mfaPoll) { clearInterval(mfaPoll.timer); mfaPoll = null; } }
  // רצה מרגע שהמסך עולה ולא רק אחרי הלחיצה: אם ה-pending נבע מתקלה רגעית
  // בבדיקת ההיקף במסד (mfa_pre_request נכשל/ת סגור), המסך משתחרר לבד.
  function mfaStartPolling(onTimeout) {
    mfaStopPolling();
    var started = Date.now();
    var poll = {};
    var tick = async function () {
      if (mfaPoll !== poll) return;
      if (Date.now() - started > MFA_POLL_MAX_MS) { mfaStopPolling(); onTimeout(); return; }
      var st;
      try { st = await mfaStatus(); } catch (e) { return; }
      if (mfaPoll !== poll || !mfaGate) return;   // נעצר בינתיים (יציאה, אימות מקביל)
      if (!st.pending) mfaVerified();
    };
    poll.timer = setInterval(tick, MFA_POLL_MS);
    poll.tick = tick;
    mfaPoll = poll;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && mfaPoll) mfaPoll.tick();
  });
  async function mfaVerified() {
    if (!mfaGate) return;            // כבר נותב
    mfaStopPolling();
    mfaGate = null; routed = false;
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) route(s.data.session); else renderLogin();
  }
  var MFA_START_ERRORS = {
    no_phone: 'אין מספר נייד בחשבון, ולכן אין לאן לאמת בוואטסאפ. לעזרה: 054-6929991.',
    rate_limited: 'יותר מדי ניסיונות בזמן קצר. כדאי לחכות כמה דקות ולנסות שוב.'
  };
  async function renderMfa(st) {
    render(band({ title: 'קורס ההכנה', exit: 'logout', cls: 'tall' }) +
      '<div class="center"><div class="card">' +
      '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>החשבון הזה מוגן באימות כניסה, כמו ב-CRM. מאמתים פעם אחת בכניסה הזו, וממשיכים ללמוד.</div></div>' +
      '<h2>אימות כניסה</h2>' +
      ((st.admin || st.manager) && !st.enabled && !st.totp ? '<p style="font-weight:600">בתפקיד הזה אימות כניסה הוא חובה, גם אם עוד לא הפעלתם אותו. זה לוקח הודעה אחת.</p>' : '') +
      '<p>שולחים לגבריאלה בוואטסאפ את ההודעה המוכנה<span id="mfaTail"></span>, וחוזרים לכאן. הדף ייפתח לבד.</p>' +
      '<a class="btn-p" id="mfaWa" href="#" aria-disabled="true" target="_blank" rel="noopener" data-bot>אימות בוואטסאפ</a>' +
      '<p class="err" id="mfaStatus" style="color:#4a5578">מכינים את ההודעה...</p>' +
      '<button type="button" class="btn-s hidden" id="mfaRetry">לנסות שוב</button>' +
      (st.totp ? '<div class="hr"></div><form id="mfaTotp" novalidate><label class="field">או קוד מאפליקציית האימות<input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr"></label>' +
        '<button type="submit" class="btn-s" id="mfaTotpBtn" style="margin-top:12px">כניסה עם הקוד</button><p class="err" id="mfaTotpErr"></p></form>' : '') +
      '</div></div>');
    bindBand();
    var link = $('mfaWa'), stEl = $('mfaStatus'), retry = $('mfaRetry');
    var onTimeout = function () {
      stEl.style.color = '';
      stEl.textContent = 'לא הגיעה הודעה, והקוד פג. "לנסות שוב" מכין קוד חדש.';
      link.setAttribute('aria-disabled', 'true');
      retry.classList.remove('hidden');
    };
    link.addEventListener('click', function (e) {
      if (link.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      stEl.style.color = '#4a5578';
      stEl.textContent = 'מחכים להודעה בוואטסאפ...';
      mfaStartPolling(onTimeout);   // מאפס את עשר הדקות מרגע השליחה
    });
    retry.addEventListener('click', function () { retry.classList.add('hidden'); prepareWa(); });
    mfaStartPolling(onTimeout);
    on('mfaCode', 'input', function () { var i = $('mfaCode'); i.value = i.value.replace(/\D/g, '').slice(0, 6); });
    on('mfaTotp', 'submit', async function (e) {
      e.preventDefault();
      var code = $('mfaCode').value.trim(), btn = $('mfaTotpBtn'), fb = $('mfaTotpErr');
      fb.textContent = '';
      if (!/^\d{6}$/.test(code)) { fb.textContent = 'הקוד הוא 6 ספרות.'; return; }
      btn.disabled = true; btn.textContent = 'בודקים...';
      try {
        // listFactors ולא ה-session: אפליקציה שנוספה ממכשיר אחר אינה ב-session המקומי
        var f = await sb.auth.mfa.listFactors();
        if (f.error) throw f.error;
        var factor = ((f.data && f.data.totp) || []).filter(function (x) { return x.status === 'verified'; })[0];
        if (!factor) throw new Error('לא נמצאה אפליקציית אימות פעילה בחשבון. אפשר לאמת בוואטסאפ.');
        var v = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code });
        if (v.error) throw v.error;
        mfaVerified();
      } catch (err) {
        fb.textContent = errText(err);
        btn.disabled = false; btn.textContent = 'כניסה עם הקוד';
      }
    });
    // הקוד נוצר כשהמסך עולה, כדי שהכפתור יהיה קישור אמיתי ולא חלון שנפתח
    // אחרי await (דפדפנים חוסמים אותו כחלון קופץ). קוד שפג מתחדש ב"לנסות שוב".
    async function prepareWa() {
      stEl.style.color = '#4a5578'; stEl.textContent = 'מכינים את ההודעה...';
      try {
        var r = await sb.rpc('wa_login_start', { p_enable: false });
        if (r.error) throw r.error;
        if (r.data && r.data.error) throw new Error(MFA_START_ERRORS[r.data.error] || errText({ message: r.data.error }));
        if (!mfaGate) return;
        link.href = 'https://wa.me/' + ASSISTANT_WA_NUMBER + '?text=' + encodeURIComponent('אימות כניסה ' + r.data.nonce);
        link.removeAttribute('aria-disabled');
        if (r.data.phone_tail && $('mfaTail')) $('mfaTail').textContent = ' מהנייד שמסתיים ב-' + r.data.phone_tail;
        stEl.textContent = '';
        mfaStartPolling(onTimeout);
      } catch (err) {
        if (!mfaGate) return;
        stEl.style.color = '';
        stEl.textContent = errText(err);
        retry.classList.remove('hidden');
      }
    }
    prepareWa();
  }

  var state = {
    user: null, me: null, catalog: null, lessons: {},
    steps: null,       // שיעור פתוח במצב קלפים
    sim: null,         // סימולציה / חזרה פתוחה
    pollTimer: null, timerId: null
  };

  /* ------------------------------------------------------------ הפס העליון */
  function userInitial() {
    var name = (state.user && (state.user.user_metadata && state.user.user_metadata.full_name || state.user.email)) || '';
    return (name || '?').trim().charAt(0).toUpperCase();
  }
  function avatar() {
    var pic = state.user && state.user.user_metadata && state.user.user_metadata.avatar_url;
    return '<div class="av" aria-label="החשבון שלי">' + (pic ? '<img src="' + escapeHtml(pic) + '" alt="" referrerpolicy="no-referrer">' : escapeHtml(userInitial())) + '</div>';
  }
  // opts: {progress: 0-1, frac, ctx, exit: 'map'|'logout'|null, title, extra, cls}
  function band(o) {
    o = o || {};
    var mid = '';
    if (o.progress != null) {
      mid = (o.ctx ? '<span class="ctx">' + escapeHtml(o.ctx) + '</span>' : '') +
        '<div class="track" role="progressbar" aria-label="התקדמות"><i style="width:' + Math.round(100 * o.progress) + '%"></i></div>' +
        (o.frac ? '<span class="frac">' + escapeHtml(o.frac) + '</span>' : '');
    } else {
      mid = '<span class="brand">' + escapeHtml(o.title || 'שוק נדל״ן') + '</span>';
    }
    var exit = '';
    if (o.exit === 'map') exit = '<button type="button" class="ib" id="exitBtn" aria-label="יציאה למפת הקורס">' + I.x + '</button>';
    else if (o.exit === 'logout') exit = '<button type="button" class="ib" id="logoutBtn" aria-label="יציאה מהחשבון">' + I.out + '</button>';
    return '<div class="band ' + (o.cls || '') + '"><div class="band-in">' +
      '<div class="bar-row"><img class="logo" src="' + LOGO + '" alt="" width="26" height="31">' + mid +
      (o.timer ? '<span class="timer" id="simTimer">' + I.clock15 + ' ' + escapeHtml(o.timer) + '</span>' : '') +
      (state.user ? avatar() : '') + exit + '</div>' +
      (o.extra || '') + '</div></div>';
  }
  function bindBand() {
    on('exitBtn', 'click', function () { clearInterval(state.timerId); if (state.sim && state.sim.kind === 'exam' && !window.confirm('לצאת מהסימולציה? מה שנענה יישמר, והניסיון ייחשב כלא הושלם.')) { startTimer(); return; } state.steps = null; state.sim = null; renderMap(); });
    on('logoutBtn', 'click', async function () { await sb.auth.signOut(); window.location.href = '/course'; });
  }

  /* ---------------------------------------------------------------- כניסה */
  function cleanAuthParams() {
    var url = new URL(window.location.href);
    var changed = false;
    ['access_token', 'refresh_token', 'expires_in', 'token_type', 'type', 'code', 'error', 'error_code', 'error_description', 'provider_token', 'provider_refresh_token'].forEach(function (k) {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
    });
    if (changed || window.location.hash) history.replaceState(null, '', url.pathname + (url.search || ''));
  }
  function googleError() {
    var q = new URLSearchParams(window.location.search);
    var h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var code = q.get('error') || h.get('error');
    var desc = q.get('error_description') || h.get('error_description');
    if (!code && !desc) return '';
    if (code === 'access_denied') return 'ההתחברות בוטלה. אפשר לנסות שוב.';
    return 'לא הצלחנו להשלים את ההתחברות עם Google. אפשר לנסות שוב.';
  }
  function renderLogin(err) {
    render(band({ title: 'קורס ההכנה למבחן המתווכים', cls: 'tall' }) +
      '<div class="center"><div class="card">' +
      '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>נכנסים עם חשבון Google, וממשיכים מאיפה שעצרתם, מכל מכשיר.</div></div>' +
      '<h2>כניסה לקורס ההכנה</h2>' +
      '<p>השיעור הראשון פתוח בחינם. אחרי הכניסה אפשר לרכוש גישה מלאה לשישה חודשים ב-199 ₪ כולל מע״מ.</p>' +
      '<button type="button" class="gbtn" id="googleBtn">' + I.google + '<span class="gl-label">כניסה עם Google</span></button>' +
      '<div class="err" id="loginErr">' + escapeHtml(err || '') + '</div>' +
      '<p style="font-size:13.5px"><a href="/course">חזרה לדף הקורס</a></p>' +
      '</div></div>');
    on('googleBtn', 'click', async function () {
      var btn = $('googleBtn');
      btn.disabled = true;
      btn.querySelector('.gl-label').textContent = 'מעבירים ל-Google...';
      if (window.AuthReturn) AuthReturn.remember('/learn');
      var res = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/learn', queryParams: { prompt: 'select_account' } }
      });
      if (res.error) {
        btn.disabled = false;
        btn.querySelector('.gl-label').textContent = 'כניסה עם Google';
        $('loginErr').textContent = 'לא הצלחנו לפתוח את החיבור ל-Google: ' + errText(res.error);
      }
    });
  }
  function renderBoot(msg) {
    render(band({ title: 'קורס ההכנה', cls: 'tall' }) + '<div class="center"><div class="card" style="text-align:center"><div class="spin"></div><p>' + escapeHtml(msg || 'טוענים את הקורס...') + '</p></div></div>');
  }

  /* --------------------------------------------------------------- טעינה */
  async function loadAll() {
    var r = await Promise.all([rpc('course_me'), rpc('course_catalog')]);
    if (r[0].error) throw r[0].error;
    if (r[1].error) throw r[1].error;
    state.me = r[0].data || {};
    state.catalog = r[1].data || { chapters: [] };
    state.lessons = {};
    (state.catalog.chapters || []).forEach(function (ch, ci) {
      (ch.lessons || []).forEach(function (l) { state.lessons[l.id] = { chapter: ch, chapterIndex: ci, lesson: l }; });
    });
  }
  async function refreshMe() {
    var r = await rpc('course_me');
    if (!r.error && r.data) state.me = r.data;
  }
  function progressOf(lessonId) {
    var p = (state.me && state.me.progress) || [];
    for (var i = 0; i < p.length; i++) if (p[i].lesson_id === lessonId) return p[i];
    return null;
  }
  function enrolled() { return !!(state.me && state.me.enrolled); }
  function lessonAvailable(l) { return l.is_free || enrolled(); }
  function flatLessons() {
    var out = [];
    (state.catalog.chapters || []).forEach(function (ch) { (ch.lessons || []).forEach(function (l) { out.push(l); }); });
    return out;
  }
  function nextOpenLesson() {
    var flat = flatLessons(), fallback = null;
    for (var i = 0; i < flat.length; i++) {
      if (!lessonAvailable(flat[i])) continue;
      if (!fallback) fallback = flat[i].id;
      var p = progressOf(flat[i].id);
      if (!p || !p.completed_at) return flat[i].id;
    }
    return fallback;
  }
  function nextLessonId(id) {
    var flat = flatLessons();
    for (var i = 0; i < flat.length; i++) if (flat[i].id === id) {
      for (var j = i + 1; j < flat.length; j++) if (lessonAvailable(flat[j])) return flat[j].id;
      return null;
    }
    return null;
  }
  /* -------------------------------------------------------------- הרכישה */
  async function authHeaders() {
    var s = await sb.auth.getSession();
    var token = s.data && s.data.session && s.data.session.access_token;
    return { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token };
  }
  async function renderPay(opts) {
    opts = opts || {};
    var expired = state.me && state.me.expired;
    var name = (state.user && state.user.user_metadata && state.user.user_metadata.full_name) || '';
    render(band({ title: 'שוק נדל״ן', exit: 'logout', cls: 'tall', extra: '<h1 style="padding:6px 6px 0;font-size:22px">קורס הכנה למבחן המתווכים</h1>' }) +
      '<div class="center" style="max-width:560px"><form class="card" id="payForm" novalidate>' +
      (expired ? '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>טוב לראות אתכם שוב. תקופת הגישה נגמרה ב-' + escapeHtml(fmtDate(state.me.expires_at)) + ', וההתקדמות שלכם נשמרה.</div></div>' : '') +
      '<div id="payVerify" class="hidden" style="text-align:center"><div class="spin"></div><p>מאמתים את התשלום מול חברת הסליקה...</p></div>' +
      '<div id="payBody">' +
      '<div class="price-row"><div class="amt"><span id="payAmount">199</span> ₪<small>כולל מע״מ</small></div><span class="pill cream" style="font-size:13px"><span id="payMonths">6</span> חודשים</span></div>' +
      '<ul class="feat">' + ['כל השיעורים והחידונים', 'כל מבחני העבר עם ההסברים', 'סימולציות ללא הגבלה', 'חזרה על טעויות', 'מד התקדמות אישי', 'תכנים חדשים שנוספים בתקופה'].map(function (t) { return '<li><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1f9d55" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' + t + '</li>'; }).join('') + '</ul>' +
      '<div class="hr"></div><b style="font-size:14px">פרטים לחשבונית</b>' +
      '<label class="field">שם מלא<input id="payName" type="text" autocomplete="name" maxlength="100" value="' + escapeHtml(name) + '"></label>' +
      '<label class="field">טלפון<input id="payPhone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" dir="ltr" style="text-align:right"></label>' +
      '<label class="chk"><input type="checkbox" id="payTerms"><span>קראתי ואישרתי את <a href="/terms" target="_blank" rel="noopener"><b>תנאי השימוש והתקנון</b></a>. המחיר כולל מע״מ. ביטול לפי תנאי השימוש.</span></label>' +
      '<button type="submit" class="btn-p" id="payBtn">' + I.lockS + ' לתשלום מאובטח</button>' +
      '<button type="button" class="btn-s" id="freeLessonBtn">לשיעור החינמי קודם</button>' +
      '<button type="button" class="btn-s hidden" id="testEnrollBtn">פתיחת גישה לבדיקה (צוות הניהול)</button>' +
      '<div class="err" id="payErr"></div>' +
      '</div></form></div>');
    bindBand();
    on('freeLessonBtn', 'click', function () { renderMap(); });
    on('payForm', 'submit', submitPay);
    on('testEnrollBtn', 'click', async function () {
      try {
        var res = await fetch(PURCHASE_URL, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ test_mode: true }) });
        var data = await res.json();
        if (!res.ok) throw data;
        toast('נפתחה גישה לבדיקה');
        await loadAll();
        renderMap();
      } catch (e) { $('payErr').textContent = errText(e); }
    });
    try {
      var res = await fetch(PURCHASE_URL, { headers: await authHeaders() });
      var info = await res.json();
      if (res.ok && $('payAmount')) {
        $('payAmount').textContent = info.amount;
        $('payMonths').textContent = info.months;
        $('testEnrollBtn').classList.toggle('hidden', !info.can_test);
        if (!info.configured) $('payErr').textContent = 'הסליקה אינה זמינה כרגע. אפשר להתחיל מהשיעור החינמי ולנסות שוב מאוחר יותר.';
      }
    } catch (e) { /* המחיר שבדף הוא ברירת המחדל */ }
    if (opts.verify) verifyOrder();
    if (opts.failure) $('payErr').textContent = 'התשלום לא הושלם. לא בוצע חיוב, ואפשר לנסות שוב.';
  }
  async function submitPay(ev) {
    ev.preventDefault();
    $('payErr').textContent = '';
    if (!$('payTerms').checked) { $('payErr').textContent = 'כדי להמשיך צריך לאשר את התקנון.'; return; }
    var name = $('payName').value.trim();
    if (name.length < 2) { $('payErr').textContent = 'איך לרשום את השם בחשבונית?'; $('payName').focus(); return; }
    var btn = $('payBtn');
    btn.disabled = true; btn.textContent = 'פותחים את עמוד התשלום...';
    try {
      var res = await fetch(PURCHASE_URL, {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ client_name: name, client_phone: $('payPhone').value.trim(), client_country: 'IL' })
      });
      var data = await res.json();
      if (!res.ok || !data.redirect_url) throw data;
      window.location.href = data.redirect_url;
      return;
    } catch (e) { $('payErr').textContent = errText(e); }
    btn.disabled = false; btn.innerHTML = I.lockS + ' לתשלום מאובטח';
  }
  /* אחרי חזרה ממורנינג: ה-webhook עשוי להגיע כמה שניות אחרי הגולש/ת. */
  function verifyOrder() {
    $('payVerify').classList.remove('hidden');
    $('payBody').classList.add('hidden');
    var tries = 0;
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async function () {
      tries++;
      var r = await rpc('course_me');
      if (r.error || !r.data) return;
      state.me = r.data;
      if (state.me.enrolled) {
        clearInterval(state.pollTimer);
        toast('התשלום אושר. ברוכים הבאים לקורס!');
        renderMap();
        return;
      }
      if (!state.me.pending_order || tries > 40) {
        clearInterval(state.pollTimer);
        if (!$('payVerify')) return;
        $('payVerify').classList.add('hidden');
        $('payBody').classList.remove('hidden');
        $('payErr').textContent = state.me.pending_order
          ? 'התשלום עדיין באימות. אם חויבתם, הגישה תיפתח אוטומטית בדקות הקרובות; אפשר לרענן את הדף.'
          : 'התשלום לא הושלם. אפשר לנסות שוב.';
      }
    }, 3000);
  }

  /* ------------------------------------------------------------ מפת הקורס */
  function renderMap() {
    clearInterval(state.timerId);
    state.steps = null; state.sim = null;
    var me = state.me || {};
    var total = me.lessons_total || 0, done = me.lessons_done || 0;
    var exams = me.exams || [];
    var last = exams.length && exams[0].total ? Math.round(100 * exams[0].correct / exams[0].total) : null;
    var nextId = nextOpenLesson();
    var extra = '<div class="map-head">' +
      '<div class="title-row"><h1>המסלול שלך</h1><span class="count">' + done + ' מתוך ' + total + ' שיעורים</span></div>' +
      '<div class="map-track" role="progressbar" aria-label="התקדמות בקורס" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + total + '"><i style="width:' + (total ? Math.round(100 * done / total) : 0) + '%"></i></div>' +
      '<div class="mline"><img src="' + MENTOR + '" alt="המנטור"><p>' + escapeHtml(pick(MAP_TIPS)) + '</p></div></div>';

    var chapters = (state.catalog.chapters || []);
    var mapHtml = chapters.map(function (ch, ci) {
      var ls = ch.lessons || [];
      var d = ls.filter(function (l) { var p = progressOf(l.id); return p && p.completed_at; }).length;
      return '<div class="chap-t"><span>פרק ' + (ci + 1) + ' · ' + escapeHtml(ch.title) + '</span><span>' + d + ' מתוך ' + ls.length + '</span></div>' +
        '<div class="path">' + ls.map(function (l) {
          var p = progressOf(l.id);
          var isDone = !!(p && p.completed_at);
          var avail = lessonAvailable(l);
          var isNext = l.id === nextId;
          var cls = 'node' + (isDone ? ' done' : (avail ? (isNext ? ' open next' : ' open') : ' locked'));
          var icon = isDone ? I.check : (avail ? I.play : I.lock);
          var lbl = isNext
            ? '<span class="lbl"><small>' + (isDone ? 'לחזור על השיעור' : 'השיעור הבא') + (l.questions ? ' · ' + l.questions + ' בדיקות' : '') + '</small><span>' + escapeHtml(l.title) + '</span></span>'
            : '<span class="lbl">' + escapeHtml(l.title) + '</span>';
          return '<button type="button" class="' + cls + '" data-lesson="' + escapeHtml(l.id) + '"><span class="dot">' + icon + '</span>' + lbl + '</button>';
        }).join('') + '</div>';
    }).join('');

    var practice = '<button type="button" class="pc p" id="examBtn"><span class="r"><b>סימולציה</b>' + (last != null ? '<span class="badge gold">ציון אחרון ' + last + '</span>' : '') + '</span><small>' + (me.exam_questions || 25) + ' שאלות, שעתיים, בדיוק כמו בבחינה</small></button>' +
      '<button type="button" class="pc s" id="reviewBtn"><span class="r"><b>חזרה על טעויות</b></span><small>כל שאלה שטעיתם בה חוזרת עד שהיא יושבת</small></button>';

    render(band({ title: 'שוק נדל״ן', exit: 'logout', cls: 'map-band', extra: extra }) +
      '<div class="map-cols"><div class="map">' + mapHtml + '</div><div class="practice">' + practice + '</div></div>' +
      '<nav class="map-nav" aria-label="תרגול">' +
      '<button type="button" class="btn-p" id="examBtnM">' + I.clock + ' סימולציה' + (last != null ? ' <span class="badge gold">' + last + '</span>' : '') + '</button>' +
      '<button type="button" class="btn-s" id="reviewBtnM">חזרה על טעויות</button></nav>');
    bindBand();
    qa('.node').forEach(function (b) { b.addEventListener('click', function () { openLesson(b.getAttribute('data-lesson')); }); });
    ['examBtn', 'examBtnM'].forEach(function (id) { on(id, 'click', function () { startSim('exam'); }); });
    ['reviewBtn', 'reviewBtnM'].forEach(function (id) { on(id, 'click', function () { startSim('review'); }); });
  }

  /* ---------------------------------------------------------------- שיעור */
  async function openLesson(id, fullText) {
    var entry = state.lessons[id];
    if (!entry) return;
    if (!lessonAvailable(entry.lesson)) { renderLocked(entry); return; }
    renderBoot('פותחים את השיעור...');
    var r = await Promise.all([
      // select('*') ולא רשימת עמודות: האתר עולה לפני המיגרציה (הסקיל deploy-path)
      withAuth(function () { return sb.from('course_lessons').select('*').eq('id', id).maybeSingle(); }),
      rpc('course_lesson_open', { p_lesson_id: id })
    ]);
    var lesson = r[0].data;
    if (r[0].error || !lesson) { toast(r[0].error ? errText(r[0].error) : 'השיעור אינו זמין.'); renderMap(); return; }
    if (Array.isArray(lesson.steps) && lesson.steps.length && !fullText) { startSteps(lesson, entry); return; }
    renderFullText(lesson, entry);
  }

  function renderLocked(entry) {
    render(band({ title: 'שוק נדל״ן', exit: 'map', cls: 'tall' }) +
      '<div class="center"><div class="card">' +
      '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>השיעור הזה נפתח עם הגישה המלאה. תשלום אחד לשישה חודשים, וכל מה שכבר למדתם נשמר.</div></div>' +
      '<h2>' + escapeHtml(entry.lesson.title) + '</h2>' +
      '<p>גישה מלאה לקורס: כל השיעורים, מבחני העבר, הסימולציות וחזרה על טעויות.</p>' +
      '<button type="button" class="btn-p" id="goPay">לפתיחת הקורס המלא</button>' +
      '<button type="button" class="btn-s" id="backMap">למפת הקורס</button></div></div>');
    bindBand();
    on('goPay', 'click', function () { renderPay(); });
    on('backMap', 'click', renderMap);
  }

  /* הטקסט המלא: שיעור בלי צעדים (מבחני העבר), או הקישור "הטקסט המלא" */
  function renderFullText(lesson, entry) {
    var kp = Array.isArray(lesson.key_points) ? lesson.key_points : [];
    var qn = entry.lesson.questions || 0;
    var p = progressOf(lesson.id);
    var video = '';
    if (lesson.video_url) {
      var u = String(lesson.video_url);
      if (/youtube\.com|youtu\.be/.test(u)) {
        var m = u.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
        if (m) video = '<div style="border-radius:20px;overflow:hidden;aspect-ratio:16/9;background:#000;margin:14px 0"><iframe style="width:100%;height:100%;border:0" src="https://www.youtube-nocookie.com/embed/' + escapeHtml(m[1]) + '" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" title="סרטון השיעור"></iframe></div>';
      } else if (/^https:\/\//.test(u)) {
        video = '<div style="border-radius:20px;overflow:hidden;aspect-ratio:16/9;background:#000;margin:14px 0"><video style="width:100%;height:100%" controls preload="metadata" src="' + escapeHtml(u) + '"></video></div>';
      }
    }
    render(band({ progress: p && p.completed_at ? 1 : 0.1, ctx: entry.chapter.title, exit: 'map', cls: 'tall' }) +
      '<div class="cols"><div class="main"><div class="card" style="gap:10px">' +
      '<h2 style="font-size:24px">' + escapeHtml(lesson.title) + '</h2>' +
      (lesson.source_ref ? '<span class="pill cream" style="align-self:flex-start">' + escapeHtml(lesson.source_ref) + '</span>' : '') +
      (lesson.intro ? '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble">' + escapeHtml(lesson.intro) + '</div></div>' : '') +
      video +
      '<div class="body" style="font-size:16.5px;line-height:1.8;color:#4a5578">' + (lesson.body_html || '') + '</div>' +
      (kp.length ? '<div style="background:#fbf4dc;border-radius:16px;padding:14px 16px"><b style="font-size:13px;color:#8a6d10;letter-spacing:.06em">נקודות המפתח</b><ul style="margin:8px 0 0;padding-inline-start:18px;font-size:15px;line-height:1.6">' + kp.map(function (k) { return '<li>' + escapeHtml(k) + '</li>'; }).join('') + '</ul></div>' : '') +
      '</div></div><div class="aside"><div class="box"><h3>בשיעור הזה</h3><p style="margin:0;font-size:14px;color:#4a5578">' + (qn ? qn + ' שאלות' : 'אין שאלות') + (p && p.best_score != null ? ' · הציון הטוב ביותר ' + p.best_score : '') + '</p></div></div></div>' +
      '<div class="foot">' +
      (Array.isArray(lesson.steps) && lesson.steps.length ? '<button type="button" class="btn-s" id="toSteps">לגרסת הקלפים</button>' : '') +
      (qn ? '<button type="button" class="btn-p" id="startQuiz">' + (p && p.completed_at ? 'לחידון שוב' : 'לחידון') + ' (' + qn + ')</button>' : '<button type="button" class="btn-p" id="nextLesson">לשיעור הבא</button>') +
      '</div>');
    bindBand();
    on('toSteps', 'click', function () { startSteps(lesson, entry); });
    on('startQuiz', 'click', function () { startSim('quiz', lesson.id, lesson.title); });
    on('nextLesson', 'click', function () { var n = nextLessonId(lesson.id); if (n) openLesson(n); else renderMap(); });
  }

  /* ------------------------------------------------------------- הקלפים */
  function startSteps(lesson, entry) {
    var kp = Array.isArray(lesson.key_points) ? lesson.key_points : [];
    var steps = lesson.steps.slice()
      .concat(kp.map(function (k) { return { type: 'flash', text: k, law: lesson.source_ref || '' }; }));
    state.sim = null;
    state.steps = { lesson: lesson, entry: entry, steps: steps, idx: 0, attempt: null, qmap: {}, answers: {}, unknown: 0, lawOpen: false, flipped: false };
    renderStep();
  }

  function stepLabel(st) {
    return st.type === 'concept' ? 'רעיון' : st.type === 'example' ? 'סיפור מקרה' : st.type === 'check' ? 'בדיקה מהירה' : 'כרטיס זיכרון';
  }
  function stepsAside(S) {
    var items = S.steps.map(function (st, i) {
      var cls = i < S.idx ? 'done' : (i === S.idx ? 'cur' : '');
      var txt = st.type === 'check' ? 'בדיקה מהירה' : (st.title || (st.type === 'flash' ? 'כרטיס זיכרון' : stepLabel(st)));
      return '<li class="' + cls + '"><span class="k">' + (i < S.idx ? I.check18 : (i + 1)) + '</span><span>' + escapeHtml(txt) + '</span></li>';
    }).join('');
    return '<div class="aside"><div class="box"><h3>בשיעור הזה</h3><ol class="steplist">' + items + '</ol>' +
      (S.lesson.intro ? '<div class="hr"></div><div class="mrow"><img src="' + MENTOR + '" alt=""><p style="margin:0;font-size:14px;line-height:1.5">' + escapeHtml(S.lesson.intro) + '</p></div>' : '') +
      (S.lesson.body_html ? '<button type="button" class="link" id="fullText" style="align-self:flex-start;padding:0">הטקסט המלא של השיעור</button>' : '') +
      '</div></div>';
  }

  function renderStep() {
    var S = state.steps;
    if (!S) return;
    var st = S.steps[S.idx];
    var total = S.steps.length;
    var frac = (S.idx + 1) + '/' + total;
    var sub = '<div class="sub-row"><span class="n">קלף ' + (S.idx + 1) + ' מתוך ' + total + '</span><span class="t">' + escapeHtml(S.lesson.title) + '</span></div>';
    var bandOpts = { progress: S.idx / Math.max(1, total - 1), frac: frac, ctx: S.lesson.title, exit: 'map', extra: sub, cls: 'tall' };
    var introM = (S.idx === 0 && S.lesson.intro) ? '<div class="intro-m"><img src="' + MENTOR + '" alt="המנטור"><p>' + escapeHtml(S.lesson.intro) + '</p></div>' : '';
    var html = '', foot = '';

    if (st.type === 'concept') {
      html = '<div class="deck-wrap">' + introM + '<div class="deck"><article class="kard">' +
        '<div class="top"><span class="pill navy">רעיון</span><div class="tile">' + (st.icon ? escapeHtml(st.icon) : I.bubble) + '</div></div>' +
        '<div class="body"><h2>' + escapeHtml(st.title) + '</h2><p>' + escapeHtml(st.text) + '</p>' +
        (S.lesson.source_ref ? '<span class="ref">' + escapeHtml(S.lesson.source_ref) + '</span>' : '') + '</div></article></div></div>';
      foot = '<div class="foot"><div class="hint">' + I.arrowL + ' החליקו את הקלף, או</div>' + navBtns(true, 'הבא') + '</div>';
    } else if (st.type === 'example') {
      html = '<div class="case-wrap">' + introM + '<div class="tab"><span>' + I.folder + ' תיק · סיפור מקרה</span></div>' +
        '<article class="case"><div class="who"><span class="ini">' + I.folder + '</span><div><b>' + escapeHtml(st.title) + '</b><small>מקרה מתוך הבחינה</small></div></div>' +
        '<p>' + escapeHtml(st.text) + '</p><p class="q">האם פעל כדין?</p></article>' +
        (S.lawOpen ? lawHtml(st) : '') + '</div>';
      foot = '<div class="foot">' + (S.lawOpen ? '' : '<button type="button" class="btn-o" id="lawBtn">' + I.scale + ' מה אומר החוק?</button>') + navBtns(true, 'הבא') + '</div>';
    } else if (st.type === 'check') {
      var q = S.qmap[st.question];
      if (!q && (S.attempt || S.noQuestions)) {
        // הניסיון כבר נפתח והשאלה אינה בו (למשל שאלה שהוסרה מהפרסום): מדלגים
        // על הקלף במקום לפתוח ניסיון שוב ושוב
        setTimeout(function () { if (state.steps !== S) return; if (S.idx < total - 1) { S.idx++; renderStep(); } else finishSteps(); }, 0);
        return;
      }
      if (!q && S.startError) {
        // הבדיקה לא נטענה: כרטיס עם דרך להמשיך, ולא ספינר שמסתובב לנצח
        html = '<div class="center"><div class="card">' +
          '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>שאלת הבדיקה לא נטענה. מה שכבר עשיתם בשיעור נשמר.</div></div>' +
          '<p class="err" style="margin:0">' + escapeHtml(S.startError) + '</p>' +
          '<button type="button" class="btn-p" id="startRetry">לנסות שוב</button>' +
          '<button type="button" class="btn-s" id="stepPrev"' + (S.idx === 0 ? ' disabled' : '') + '>לקלף הקודם</button>' +
          '<button type="button" class="link" id="startSkip">לדלג על הבדיקה</button>' +
          '</div></div>';
      } else if (!q) {
        html = '<div class="center"><div class="card" style="text-align:center"><div class="spin"></div></div></div>';
        // מציירים שוב רק כשיש תוצאה (ניסיון או שגיאה); ensureAttempt שכבר רצה
        // מחזירה false מיד, וציור חוזר אז היה לולאה
        ensureAttempt().then(function () { if (state.steps === S && (S.attempt || S.noQuestions || S.startError)) renderStep(); });
      } else {
        var ans = S.answers[q.id];
        bandOpts.extra = sub + '<div class="q-band"><span class="pill gold" style="align-self:flex-start">בדיקה מהירה · קלף ' + (S.idx + 1) + '</span><h1>' + escapeHtml(q.question) + '</h1></div>';
        bandOpts.cls = 'mid';
        html = '<div class="cols" style="margin-top:0"><div class="main"><div class="opts" role="radiogroup" aria-label="חלופות">' + optionsHtml(q, ans, false) + '</div></div>' +
          (ans ? '<div class="aside">' + feedbackHtml(ans, true) + '</div>' : '') + '</div>' +
          (ans ? '<div class="sheet-m">' + feedbackHtml(ans, false) + '</div>' : '');
        foot = ans ? '' : '<div class="foot"><button type="button" class="btn-s" id="stepPrev"' + (S.idx === 0 ? ' disabled' : '') + '>הקודם</button></div>';
      }
    } else if (st.type === 'flash') {
      html = '<div class="deck-wrap"><div class="deck">' + flashHtml(st, S.flipped) + '</div></div>';
      foot = '<div class="foot two"><button type="button" class="btn-no" id="noBtn">' + I.x16 + ' לא ידעתי</button><button type="button" class="btn-yes" id="yesBtn">' + I.check18 + ' ידעתי</button></div>';
    }

    var withAside = (st.type === 'concept' || st.type === 'example' || st.type === 'flash');
    render(band(bandOpts) + (withAside ? '<div class="cols"><div class="main">' + html + foot + '</div>' + stepsAside(S) + '</div>' : html + foot));
    bindBand();
    on('fullText', 'click', function () { renderFullText(S.lesson, S.entry); });
    on('stepPrev', 'click', function () { if (S.idx > 0) { S.idx--; S.lawOpen = false; S.flipped = false; S.startError = ''; renderStep(); } });
    on('startRetry', 'click', function () { S.startError = ''; renderStep(); });
    // דילוג: הקלף הבא שהוא בדיקה ינסה שוב לפתוח ניסיון
    on('startSkip', 'click', function () { S.startError = ''; advance(); });
    on('stepNext', 'click', function () { advance(); });
    // הפיכת כרטיס ופתיחת "מה אומר החוק" נוגעות רק באלמנט שלהן: ציור מחדש של
    // כל המסך היה מגלגל לראש הדף ומריץ שוב את אנימציית הכניסה.
    on('lawBtn', 'click', function () {
      S.lawOpen = true;
      var btn = $('lawBtn'), wrap = document.querySelector('.case-wrap');
      if (wrap) wrap.insertAdjacentHTML('beforeend', lawHtml(st));
      if (btn) btn.remove();
    });
    bindFlash();
    function bindFlash() {
      on('flash', 'click', function () {
        S.flipped = !S.flipped;
        var deck = document.querySelector('.deck');
        if (!deck) return;
        deck.innerHTML = flashHtml(st, S.flipped);
        bindFlash();
      });
    }
    on('noBtn', 'click', function () { S.unknown++; advance(); });
    on('yesBtn', 'click', function () { advance(); });
    if (st.type === 'check' && S.qmap[st.question]) {
      var q2 = S.qmap[st.question];
      qa('.opt').forEach(function (b) { b.addEventListener('click', function () { answerStep(q2, Number(b.getAttribute('data-i'))); }); });
      on('fbNext', 'click', advance);
      on('fbNext2', 'click', advance);
    }
    if (st.type === 'concept') bindSwipe();
    function advance() {
      S.lawOpen = false; S.flipped = false;
      if (S.idx < total - 1) { S.idx++; renderStep(); } else finishSteps();
    }
  }
  function lawHtml(st) {
    return '<section class="law" aria-label="מה אומר החוק"><small>' + I.scale + ' מה אומר החוק</small><p>' + escapeHtml(st.law || '') + '</p></section>';
  }
  function flashHtml(st, flipped) {
    var front = flashFront(st.text);
    return flipped
      ? '<button type="button" class="flash back" id="flash" aria-label="חזרה לשאלה"><span class="pill navy">התשובה</span><span class="q">' + escapeHtml(front) + '</span><span class="big">' + escapeHtml(st.text) + '</span>' + (st.law ? '<span class="pill cream" style="font-size:15px">' + escapeHtml(st.law) + '</span>' : '') + '</button>'
      : '<button type="button" class="flash front" id="flash" aria-label="הפכו את הכרטיס"><span class="pill gold">כרטיס זיכרון</span>' + I.doc + '<span class="big">' + escapeHtml(front) + '</span><span class="hint2">' + I.flip + ' הקישו כדי להפוך</span></button>';
  }
  function navBtns(prevOk, nextLabel) {
    var S = state.steps;
    return '<button type="button" class="btn-s" id="stepPrev"' + (prevOk && S.idx > 0 ? '' : ' disabled') + '>הקודם</button><button type="button" class="btn-p" id="stepNext">' + escapeHtml(nextLabel) + '</button>';
  }
  /* הצד הקדמי של כרטיס הזיכרון: הרמז בלבד. נקודת המפתח נחתכת בסימן הפיסוק
     הראשון, ואם אין כזה לפני הסוף - חמש המילים הראשונות ושלוש נקודות. */
  function flashFront(text) {
    text = String(text || '').trim();
    var m = text.match(/^([^,.:;]{8,})[,.:;]/);
    if (m && m[1].length <= text.length * 0.7) return m[1].trim();
    var words = text.replace(/[.]+$/, '').split(/\s+/);
    return words.length > 6 ? words.slice(0, 5).join(' ') + '...' : text;
  }
  function bindSwipe() {
    var el = document.querySelector('.kard');
    if (!el) return;
    var x0 = null;
    el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      // ב-RTL הקלף הבא יושב משמאל, והחץ ברמז מצביע שמאלה: החלקה שמאלה = קדימה
      if (dx < -60) { var n = $('stepNext'); if (n) n.click(); }
      else if (dx > 60) { var p = $('stepPrev'); if (p && !p.disabled) p.click(); }
    }, { passive: true });
  }
  function optionsHtml(q, ans, examMode) {
    return (q.options || []).map(function (o, i) {
      var cls = 'opt';
      if (ans) {
        if (examMode) { if (ans.choice === i) cls += ' chosen'; }
        else if (ans.ok && ans.choice === i) cls += ' right';
        else if (!ans.ok && ans.choice === i) cls += ' wrong';
        else if (ans.correct === i || (ans.accepted || []).indexOf(i) >= 0) cls += ' right';
      }
      var tile = (cls.indexOf('right') >= 0) ? I.check18 : (cls.indexOf('wrong') >= 0 ? I.x16 : LETTERS[i]);
      return '<button type="button" role="radio" aria-checked="' + (ans && ans.choice === i ? 'true' : 'false') + '" class="' + cls + '" data-i="' + i + '"' + (ans && !examMode ? ' disabled' : '') + '><span class="l">' + tile + '</span><span style="flex:1">' + escapeHtml(o) + '</span></button>';
    }).join('');
  }
  function feedbackHtml(ans, asideMode) {
    var t = ans.ok ? pick(PRAISE) : pick(CONSOLE_T);
    var lead = ans.ok ? pick(PRAISE_SUB) : pick(CONSOLE_SUB);
    return '<section class="sheet' + (ans.ok ? '' : ' bad') + '" aria-label="משוב מהמנטור">' +
      (asideMode ? '<div class="head"><img src="' + MENTOR + '" alt="המנטור"><b class="t">' + escapeHtml(t) + '</b></div>' : '<img src="' + MENTOR + '" alt="המנטור"><b class="t">' + escapeHtml(t) + '</b>') +
      '<p class="lead">' + escapeHtml(lead) + '</p>' +
      '<p class="ex">' + (ans.ok ? '' : 'התשובה הנכונה: ' + LETTERS[ans.correct] + '. ') + escapeHtml(ans.explanation || '') + (ans.law_ref ? ' <strong>' + escapeHtml(ans.law_ref) + '</strong>' : '') + '</p>' +
      '<button type="button" class="btn-p" id="' + (asideMode ? 'fbNext' : 'fbNext2') + '">הבא</button></section>';
  }

  async function ensureAttempt() {
    var S = state.steps;
    if (!S) return false;
    if (S.attempt) return true;
    if (S.loading) return false;
    S.loading = true;
    var r = await rpc('course_attempt_start', { p_kind: 'quiz', p_lesson_id: S.lesson.id });
    S.loading = false;
    if (r.error || !r.data || r.data.error) {
      var code = r.error ? errText(r.error) : (r.data && r.data.error);
      if (code === 'course_not_enrolled') { renderPay(); return false; }
      S.startError = errText(r.error || { message: code });
      return false;
    }
    S.startError = '';
    S.attempt = r.data.attempt_id;
    S.noQuestions = !r.data.attempt_id;   // שיעור בלי שאלות מפורסמות: אין ניסיון, ומסיימים בלי ציון
    (r.data.questions || []).forEach(function (q) { S.qmap[q.slug] = q; });
    return true;
  }
  async function answerStep(q, choice) {
    var S = state.steps;
    if (!S || S.answers[q.id]) return;
    qa('.opt').forEach(function (b) { b.disabled = true; });
    var r = await rpc('course_answer', { p_attempt_id: S.attempt, p_question_id: q.id, p_choice: choice });
    if (r.error || !r.data || r.data.error) {
      toast(errText(r.error || { message: r.data && r.data.error }));
      qa('.opt').forEach(function (b) { b.disabled = false; });
      return;
    }
    S.answers[q.id] = { choice: choice, ok: r.data.ok, correct: r.data.correct, accepted: r.data.accepted || [], explanation: r.data.explanation, law_ref: r.data.law_ref };
    renderStep();
  }
  async function finishSteps() {
    var S = state.steps;
    if (!S) return;
    if (!S.attempt) {
      await refreshMe();
      renderDone({ total: 0, correct: 0, pct: 100, passed: true, pass_pct: 60, review: [] }, S.lesson, S.unknown);
      return;
    }
    renderBoot('רושמים את הציון...');
    var r = await rpc('course_attempt_finish', { p_attempt_id: S.attempt });
    if (r.error || !r.data || r.data.error) {
      // התשובות כבר במסד; מה שנכשל הוא הסיכום. לא זורקים את השיעור.
      renderSubmitError(errText(r.error || { message: r.data && r.data.error }), finishSteps, renderStep);
      return;
    }
    var lesson = S.lesson, unknown = S.unknown;
    state.steps = null;
    await refreshMe();
    renderDone(r.data, lesson, unknown);
  }

  /* ההגשה נכשלה (רשת, תקלה רגעית): הניסיון נשאר פתוח ואפשר להגיש שוב.
     back חוזר למסך שממנו הגיעו, ואין אותו כשהשעון כבר נגמר. */
  function renderSubmitError(msg, retry, back) {
    render(band({ title: 'שוק נדל״ן', exit: 'map', cls: 'tall' }) +
      '<div class="center"><div class="card">' +
      '<div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>התשובות שלכם נשמרו, רק הסיכום לא הגיע. ננסה שוב.</div></div>' +
      '<p class="err" style="margin:0">' + escapeHtml(msg) + '</p>' +
      '<button type="button" class="btn-p" id="retrySubmit">להגיש שוב</button>' +
      (back ? '<button type="button" class="btn-s" id="backSubmit">חזרה לשאלות</button>' : '') +
      '</div></div>');
    bindBand();
    on('retrySubmit', 'click', retry);
    on('backSubmit', 'click', back);
  }

  /* -------------------------------------------------------- סיום שיעור */
  function gaugeHtml(value, max, label, light) {
    var r = 72, c = 2 * Math.PI * r, pct = max ? Math.min(1, value / max) : 0;
    return '<div class="gauge" role="img" aria-label="' + escapeHtml(label) + '"><svg viewBox="0 0 168 168"><circle cx="84" cy="84" r="' + r + '" fill="none" stroke="' + (light ? 'rgba(13,27,61,.55)' : '#eef1f8') + '" stroke-width="16"/><circle cx="84" cy="84" r="' + r + '" fill="none" stroke="' + (light ? '#e5c76a' : '#c9a227') + '" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + (c * pct).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><div class="v"><b>' + value + '</b><small>' + escapeHtml(label) + '</small></div></div>';
  }
  function renderDone(res, lesson, unknown) {
    var pass = res.passed;
    var wrong = Math.max(0, (res.total || 0) - (res.correct || 0));
    var msg = pass
      ? (wrong || unknown ? 'רוב השיעור כבר אצלכם. ' + (wrong ? 'מה שטעיתם בו נכנס לחזרה על טעויות. ' : '') + (unknown ? unknown + ' כרטיסי זיכרון סימנתם "לא ידעתי", שווה לחזור עליהם.' : '') : 'נקי לגמרי. ממשיכים לשיעור הבא, לפני שהחומר מתקרר.')
      : 'זה בסדר גמור. רוב מי שעובר את הבחינה נפל בסיבוב הראשון. עוברים על ההסברים, ומנסים שוב.';
    var n = nextLessonId(lesson.id);
    render(band({ progress: 1, frac: 'הושלם', ctx: lesson.title, exit: 'map', cls: 'tall', extra: '<div class="done-head"><h1>' + (pass ? 'השיעור הושלם' : 'כמעט, עוד ניסיון') + '</h1><p>' + escapeHtml(lesson.title) + '</p></div>' }) +
      '<div class="done-main"><section class="score">' +
      (res.total ? gaugeHtml(res.pct, 100, pass ? 'עובר מ-' + res.pass_pct : 'נדרש ' + res.pass_pct) : '<p style="margin:0">שיעור בלי בדיקות. הקלפים נקראו עד הסוף.</p>') +
      (res.total ? '<div class="stats"><div class="ok"><b>' + res.correct + '</b><span>נכונות</span></div><div class="no"><b>' + wrong + '</b><span>לחזרה</span></div></div>' : '') +
      '</section><div class="mrow"><img src="' + MENTOR + '" alt="המנטור"><p style="margin:0;flex:1;font-size:15px;line-height:1.5;font-weight:500">' + escapeHtml(msg) + '</p></div>' +
      (wrong ? '<ul class="review" id="reviewList">' + reviewItems(res.review || []) + '</ul>' : '') +
      '</div><div class="foot">' +
      (pass ? '<button type="button" class="btn-p" id="nextLesson">' + (n ? 'לשיעור הבא' : 'למפת הקורס') + '</button>' : '<button type="button" class="btn-p" id="retry">לנסות שוב</button>') +
      (wrong ? '<button type="button" class="btn-s" id="toReview">חזרה על מה שטעיתי (' + wrong + ')</button>' : (pass ? '' : '<button type="button" class="btn-s" id="nextLesson">לשיעור הבא בכל זאת</button>')) +
      (lesson.body_html ? '<button type="button" class="link" id="fullText">לקרוא את הטקסט המלא של השיעור</button>' : '') +
      '</div>');
    bindBand();
    bindReview();
    on('fullText', 'click', function () { openLesson(lesson.id, true); });
    on('nextLesson', 'click', function () { if (n) openLesson(n); else renderMap(); });
    on('retry', 'click', function () { openLesson(lesson.id); });
    on('toReview', 'click', function () { startSim('review'); });
  }
  function reviewItems(review) {
    return review.map(function (q, i) {
      var title = String(q.question || '').replace(/\s+/g, ' ').slice(0, 70) + (String(q.question || '').length > 70 ? '...' : '');
      return '<li class="' + (q.ok ? 'ok' : 'bad') + '"><button type="button" class="row" data-rv="' + i + '"><span class="ic">' + (q.ok ? I.check18 : I.x16) + '</span><span style="flex:1"><strong>' + (i + 1) + '.</strong> ' + escapeHtml(title) + '</span><span class="more">' + (q.ok ? 'להסבר' : 'להסבר') + '</span></button>' +
        '<div class="det"><p style="margin:0 0 6px;color:#0d1b3d;white-space:pre-line">' + escapeHtml(q.question) + '</p><div class="opts">' + (q.options || []).map(function (o, j) {
          var cls = 'opt';
          var isRight = j === q.correct || (q.accepted || []).indexOf(j) >= 0;
          if (isRight) cls += ' right'; else if (q.choice === j) cls += ' wrong';
          return '<div class="' + cls + '"><span class="l">' + LETTERS[j] + '</span><span style="flex:1">' + escapeHtml(o) + '</span></div>';
        }).join('') + '</div><p style="margin:10px 0 0">' + escapeHtml(q.explanation || '') + (q.law_ref ? ' <strong style="color:#0e2a6b">' + escapeHtml(q.law_ref) + '</strong>' : '') + (q.source ? '<br><span class="src">' + escapeHtml(q.source) + '</span>' : '') + '</p></div></li>';
    }).join('');
  }
  function bindReview() {
    qa('.review .row').forEach(function (b) { b.addEventListener('click', function () { b.parentNode.classList.toggle('open'); }); });
  }

  /* ------------------------------------------------- סימולציה / חזרה / חידון */
  async function startSim(kind, lessonId, title) {
    if (kind !== 'quiz' && !enrolled()) { renderPay(); return; }
    renderBoot(kind === 'exam' ? 'מגרילים ' + ((state.me && state.me.exam_questions) || 25) + ' שאלות...' : 'אוספים את השאלות...');
    var r = await rpc('course_attempt_start', { p_kind: kind, p_lesson_id: lessonId || null });
    if (r.error || !r.data || r.data.error) {
      var code = r.error ? errText(r.error) : (r.data && r.data.error);
      if (code === 'course_not_enrolled') { renderPay(); return; }
      toast(errText(r.error || { message: code })); renderMap(); return;
    }
    var qs = r.data.questions || [];
    if (!qs.length) {
      render(band({ title: 'שוק נדל״ן', exit: 'map', cls: 'tall' }) + '<div class="center"><div class="card"><div class="mrow"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b><br>' +
        (kind === 'review' ? 'אין שאלות לחזרה: כל מה שטעיתם בו כבר תוקן. זה הזמן לסימולציה.' : 'אין עדיין שאלות כאן.') + '</div></div><button type="button" class="btn-p" id="backMap">למפת הקורס</button></div></div>');
      bindBand(); on('backMap', 'click', renderMap);
      return;
    }
    state.steps = null;
    state.sim = { id: r.data.attempt_id, kind: kind, questions: qs, idx: 0, answers: {}, flags: {}, lessonId: lessonId, title: title, startedAt: Date.now(), deadline: Date.now() + EXAM_SECONDS * 1000 };
    renderSim();
    if (kind === 'exam') startTimer();
  }
  function startTimer() {
    clearInterval(state.timerId);
    state.timerId = setInterval(function () {
      var el = $('simTimer');
      if (!el || !state.sim) { clearInterval(state.timerId); return; }
      var left = (state.sim.deadline - Date.now()) / 1000;
      el.innerHTML = I.clock15 + ' ' + fmtTime(left);
      el.classList.toggle('low', left < 5 * 60);
      if (left <= 0) { clearInterval(state.timerId); toast('הזמן נגמר. מגישים.'); finishSim(true); }
    }, 1000);
  }
  function renderSim() {
    var A = state.sim;
    if (!A) return;
    var q = A.questions[A.idx];
    var ans = A.answers[q.id];
    var n = A.questions.length, answered = Object.keys(A.answers).length;
    var isExam = A.kind === 'exam';
    var title = isExam ? 'סימולציה' : (A.kind === 'review' ? 'חזרה על טעויות' : 'חידון · ' + (A.title || ''));
    var seg = '<div class="seg" aria-label="התקדמות">' + A.questions.map(function (qq, i) { return '<i class="' + (A.answers[qq.id] ? 'a' : '') + (i === A.idx ? ' cur' : '') + (A.flags[qq.id] ? ' f' : '') + '"></i>'; }).join('') + '</div>';
    var head = '<div class="sub-row" style="padding-bottom:8px"><span class="n">שאלה ' + (A.idx + 1) + ' מתוך ' + n + '</span><span class="t">' + (isExam ? 'בלי משוב עד הסוף' : 'משוב אחרי כל תשובה') + '</span></div>' + seg;
    var left = (A.deadline - Date.now()) / 1000;
    var grid = '<div class="aside"><div class="box"><h3>השאלות</h3><div class="qgrid">' + A.questions.map(function (qq, i) {
      return '<button type="button" data-go="' + i + '" class="' + (A.answers[qq.id] ? 'a' : '') + (i === A.idx ? ' cur' : '') + (A.flags[qq.id] ? ' f' : '') + '" aria-current="' + (i === A.idx ? 'true' : 'false') + '">' + (i + 1) + '</button>';
    }).join('') + '</div><div style="display:flex;gap:10px"><button type="button" class="btn-s" id="prevD"' + (A.idx === 0 ? ' disabled' : '') + '>הקודמת</button><button type="button" class="btn-p" id="nextD" style="flex:1.4">' + (A.idx < n - 1 ? 'הבאה' : 'סיום') + '</button></div><button type="button" class="link" id="submitD">סיום והגשה</button></div></div>';
    render(band({ title: title, exit: 'map', timer: isExam ? fmtTime(left) : null, cls: 'mid', extra: head }) +
      '<div class="cols" style="margin-top:0"><div class="main">' +
      '<div class="sim-q">' + (q.source ? '<span class="src">' + escapeHtml(q.source) + '</span>' : '') + escapeHtml(q.question) + '</div>' +
      '<div class="opts" role="radiogroup" aria-label="חלופות">' + optionsHtml(q, ans, isExam || !ans) + '</div>' +
      (!isExam && ans ? '<div class="sheet-wrap">' + feedbackHtml(ans, true).replace('id="fbNext"', 'id="fbNextSim"') + '</div>' : '') +
      '</div>' + grid + '</div>' +
      '<div class="sim-foot">' +
      (isExam ? '<button type="button" class="sq' + (A.flags[q.id] ? ' on' : '') + '" id="flagBtn" aria-label="סימון לבדיקה חוזרת">' + I.flag + '</button>' : '') +
      '<button type="button" class="sq" id="prevM" aria-label="השאלה הקודמת"' + (A.idx === 0 ? ' disabled' : '') + '>' + I.prev + '</button>' +
      '<button type="button" class="btn-p" id="nextM">' + (A.idx < n - 1 ? 'לשאלה הבאה' : 'סיום והגשה') + '</button></div>');
    bindBand();
    qa('.opt').forEach(function (b) { b.addEventListener('click', function () { answerSim(q, Number(b.getAttribute('data-i'))); }); });
    qa('[data-go]').forEach(function (b) { b.addEventListener('click', function () { A.idx = Number(b.getAttribute('data-go')); renderSim(); }); });
    ['prevM', 'prevD'].forEach(function (id) { on(id, 'click', function () { if (A.idx > 0) { A.idx--; renderSim(); } }); });
    ['nextM', 'nextD', 'fbNextSim'].forEach(function (id) { on(id, 'click', function () { if (A.idx < n - 1) { A.idx++; renderSim(); } else finishSim(false); }); });
    on('submitD', 'click', function () { finishSim(false); });
    on('flagBtn', 'click', function () { A.flags[q.id] = !A.flags[q.id]; renderSim(); });
    if (isExam) startTimer();
  }
  async function answerSim(q, choice) {
    var A = state.sim;
    if (!A || A.answers[q.id]) return;
    qa('.opt').forEach(function (b) { b.disabled = true; });
    var r = await rpc('course_answer', { p_attempt_id: A.id, p_question_id: q.id, p_choice: choice });
    if (r.error || !r.data || r.data.error) {
      toast(errText(r.error || { message: r.data && r.data.error }));
      qa('.opt').forEach(function (b) { b.disabled = false; });
      return;
    }
    A.answers[q.id] = { choice: choice, ok: r.data.ok, correct: r.data.correct, accepted: r.data.accepted || [], explanation: r.data.explanation, law_ref: r.data.law_ref };
    if (A.kind === 'exam' && A.idx < A.questions.length - 1) {
      setTimeout(function () { if (state.sim === A && A.idx < A.questions.length - 1) { A.idx++; renderSim(); } }, 300);
    } else renderSim();
  }
  async function finishSim(forced) {
    var A = state.sim;
    if (!A) return;
    var left = A.questions.length - Object.keys(A.answers).length;
    if (!forced && left > 0 && !window.confirm('נשארו ' + left + ' שאלות בלי תשובה. הן ייספרו כשגויות. לסיים בכל זאת?')) return;
    clearInterval(state.timerId);
    renderBoot('בודקים...');
    var r = await rpc('course_attempt_finish', { p_attempt_id: A.id });
    if (r.error || !r.data || r.data.error) {
      // סימולציה של שעתיים לא נזרקת בגלל בקשה אחת שנפלה: הניסיון עדיין פתוח במסד.
      // כשהשעון נגמר אין "חזרה לשאלות", רק הגשה חוזרת.
      renderSubmitError(errText(r.error || { message: r.data && r.data.error }),
        function () { finishSim(forced); }, forced ? null : renderSim);
      return;
    }
    var mins = Math.round((Date.now() - A.startedAt) / 60000);
    state.sim = null;
    await refreshMe();
    if (A.kind === 'quiz') { var entry = state.lessons[A.lessonId]; renderDone(r.data, { id: A.lessonId, title: (entry && entry.lesson.title) || A.title || '' }, 0); return; }
    renderResult(r.data, A.kind, mins);
  }
  function renderResult(res, kind, mins) {
    var pass = res.passed, pts = res.correct * 4;
    var wrong = (res.review || []).filter(function (q) { return !q.ok; }).length;
    var isExam = kind === 'exam';
    var extra = '<div class="res-head">' + gaugeHtml(isExam ? pts : res.pct, isExam ? res.total * 4 : 100, isExam ? 'נקודות' : 'אחוז', true) +
      '<div class="txt"><span class="pill gold" style="align-self:flex-start">' + (pass ? 'עובר' : 'לא עובר') + ' · נדרש ' + res.pass_pct + '</span><span class="big">' + res.correct + ' מתוך ' + res.total + ' נכונות</span><span class="sm">' + (isExam ? '4 נקודות לשאלה · ' : '') + mins + ' דקות</span></div></div>';
    render(band({ title: isExam ? 'סימולציה הסתיימה' : 'סיימתם את החזרה', exit: 'map', cls: 'mid', extra: extra }) +
      '<div class="rv-head"><h2>סקירה</h2><span>' + (wrong ? wrong + ' טעויות נכנסו לחזרה' : 'בלי טעויות') + '</span></div>' +
      '<div class="rv-list"><div class="mrow" style="margin-bottom:10px"><img src="' + MENTOR + '" alt="המנטור"><div class="bubble">' + escapeHtml(pass
        ? (isExam ? 'ככה זה נראה ביום הבחינה. עוד שתיים-שלוש כאלה, ובמיוחד על הנושאים שעוד מתנדנדים.' : 'יפה. מה שנשאר אדום חוזר בפעם הבאה.')
        : (wrong + ' שאלות נכנסו לחזרה. נעבור עליהן לפני הסימולציה הבאה.')) + '</div></div>' +
      '<ul class="review">' + reviewItems(res.review || []) + '</ul></div>' +
      '<div class="foot">' + (wrong ? '<button type="button" class="btn-p" id="toReview">לתרגל את ' + wrong + ' הטעויות</button>' : '<button type="button" class="btn-p" id="again">סימולציה נוספת</button>') +
      '<button type="button" class="btn-s" id="backMap">למפת הקורס</button></div>');
    bindBand();
    bindReview();
    on('toReview', 'click', function () { startSim('review'); });
    on('again', 'click', function () { startSim('exam'); });
    on('backMap', 'click', renderMap);
  }

  /* ---------------------------------------------------------------- boot */
  var routed = false;
  async function route(session) {
    if (routed) return;
    routed = true;
    authLost = false; mfaGate = null; mfaStopPolling();
    state.user = session.user;
    var params = new URLSearchParams(window.location.search);
    var order = params.get('order');
    cleanAuthParams();
    if (order) {
      var u = new URL(window.location.href);
      u.searchParams.delete('order'); u.searchParams.delete('order_id');
      history.replaceState(null, '', u.pathname + (u.search || ''));
    }
    try { await loadAll(); } catch (e) { renderBoot(errText(e)); return; }
    if (order === 'success' && !state.me.enrolled) { renderPay({ verify: true }); return; }
    if (order === 'failure') { renderPay({ failure: true }); return; }
    renderMap();
  }
  (async function boot() {
    renderBoot();
    var gerr = googleError();
    if (gerr) { cleanAuthParams(); renderLogin(gerr); return; }
    sb.auth.onAuthStateChange(function (event, session) {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(function () { route(session); }, 0);
      if (event === 'SIGNED_OUT') { routed = false; mfaGate = null; mfaStopPolling(); renderLogin(); }
    });
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) { route(s.data.session); return; }
    if (window.AuthReturn && AuthReturn.hasAuthResponse()) {
      setTimeout(function () { if (!routed) renderLogin(); }, 4000);
      return;
    }
    renderLogin();
  })();
})();
