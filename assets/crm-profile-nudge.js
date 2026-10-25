/* ==========================================================================
   גיליון השלמת פרטים במובייל
   --------------------------------------------------------------------------
   מדריך ההתחלה (assets/crm-onboarding.js, ‏ONB_STEP_DEFS + onbModel) הוא
   המקור היחיד ל"מה חסר". כאן אין חישוב שני: כל פריט נגזר מצעד שכבר
   קיים במדריך, והדגלים (license_done, bio_done, profile_done...) נקראים
   כמו שהכרטיס קורא אותם.

   צעד "תמונה, משפט ואזורים" הוא שלושה שדות באותו תנאי (תמונה, 20 תווים,
   אזורי שירות). הגיליון מראה אחד מהם בכל פעם, לפי סדר ההשפעה, ומעביר
   ישר לשדה. צעד נעול במסלול (גבריאלה, יומן) לא מוצג - ואין בו כפתור
   למסלולים או לתשלום.

   מתי: רוחב מובייל (מתחת ל-1024, כמו הסרגל התחתון) או אפליקציה
   (user agent מכיל ShukNadlanApp). פעם אחת בביקור, ולא ב-24 השעות
   שאחרי "אעדכן אחר כך" או סגירה. לא בשניה הראשונה, לא על מסך אימות
   הוואטסאפ, ולא מעל חלון אחר. כשהמדריך נסגר - מפסיקים.

   ה-CRM אינו טוען את events.js (פניות של סוכן/ת ללקוחות שלו/ה אינן
   פניות של גולשים). כש-shukTrack קיים הוא נקרא; אחרת אותה דחיפה יוצאת
   ל-dataLayer, ו-GTM שומע אותה.
   ========================================================================== */
(function (root) {
  'use strict';

  var SNOOZE_MS = 24 * 60 * 60 * 1000;
  var DELAY_MS = 1000;
  var LOCAL_KEY = 'shuknadlan.profileNudge.until';
  var SESSION_KEY = 'shuknadlan.profileNudge.seen';
  /* אותו סף של onbBioFocus ושל agent_onboarding_state (20 תווים). */
  var BIO_MIN = 20;
  var MOBILE_MQ = '(max-width: 1023px)';

  /* סדר ההשפעה. הפריטים עצמם באים מהצעדים; מי שאינו חל על הסוכן/ת פשוט לא נכנס. */
  var ORDER = ['photo', 'license', 'areas', 'phone', 'property', 'logo', 'bio', 'whatsapp', 'client', 'calendar', 'prefs', 'about', 'invite'];

  var COPY = {
    photo: {
      title: 'הוסיפו תמונת פרופיל',
      line: 'לקוחות רואים את הפנים לפני שהם מחליטים להתקשר.',
      cta: 'הוספת תמונה',
    },
    licenseNumber: {
      title: 'הוסיפו מספר רישיון',
      line: 'בלי מספר רישיון הדף והמודעות לא מוצגים לגולשים.',
      cta: 'למספר הרישיון',
    },
    license: {
      title: 'אמתו את רישיון התיווך',
      line: 'עד שהרישיון מאומת, הדף והמודעות שמורים במערכת וגולשים לא רואים אותם.',
      cta: 'העלאת אישור רישיון',
    },
    areas: {
      title: 'בחרו אזורי שירות',
      line: 'האזורים קובעים באילו ערים הדף והמודעות שלכם יופיעו.',
      cta: 'לבחירת האזורים',
    },
    phone: {
      title: 'הוסיפו את המספר לוואטסאפ',
      line: 'גבריאלה מזהה אתכם לפי המספר, וזה גם המספר שמופיע ללקוחות.',
      cta: 'להוספת המספר',
    },
    property: {
      title: 'העלו את הנכס הראשון',
      line: 'הנכס הראשון הופך את הדף מכרטיס ביקור למקום שאפשר לפנות ממנו.',
      cta: 'העלאת נכס',
    },
    logo: {
      title: 'הוסיפו לוגו למשרד',
      line: 'דף המשרד בלי לוגו הוא שם בלי סימן שאפשר לזכור.',
      cta: 'העלאת לוגו',
    },
    bio: {
      title: 'כתבו משפט עליכם',
      line: 'משפט קצר על הוותק ועל ההתמחות מוצג בדף שלכם.',
      cta: 'לכתיבת המשפט',
    },
    whatsapp: {
      title: 'חברו את גבריאלה',
      line: 'הודעה אחת פותחת נכס, לקוח או פגישה ישר מהוואטסאפ.',
      cta: 'חיבור בלחיצה',
    },
    client: {
      title: 'הוסיפו את הלקוח הראשון',
      line: 'מרגע שיש דרישות, התאמות לנכסים מתחילות להגיע.',
      cta: 'הוספת לקוח',
    },
    calendar: {
      title: 'חברו את יומן Google',
      line: 'פגישות וסיורים מהמערכת נכנסים ליומן בטלפון.',
      cta: 'חיבור היומן',
    },
    prefs: {
      title: 'הגדירו העדפות לידים',
      line: 'לפי ההעדפות המערכת יודעת אילו לידי בעלים להציע.',
      cta: 'להעדפות',
    },
    about: {
      title: 'כתבו כמה משפטים על המשרד',
      line: 'התיאור מוצג בראש דף המשרד, וגוגל קורא אותו.',
      cta: 'לכתיבת התיאור',
    },
    invite: {
      title: 'הזמינו את הסוכנים למשרד',
      line: 'כל סוכן שמצטרף מקבל דף משלו, והנכסים נכנסים לדשבורד.',
      cta: 'להזמנה',
    },
  };

  function stepOf(model, key) {
    var stages = model && model.stages || [];
    for (var i = 0; i < stages.length; i++) {
      var steps = stages[i].steps || [];
      for (var j = 0; j < steps.length; j++) {
        if (steps[j].key === key) return steps[j];
      }
    }
    return null;
  }

  function usable(step) {
    return !!(step && !step.isLocked && step.canRun !== false);
  }

  function textOf(agent, key) {
    return String(agent && agent[key] || '').trim();
  }

  function pushItem(bag, id, done, extra) {
    var copy = COPY[id];
    if (!copy) return;
    var item = {
      id: id,
      done: !!done,
      title: copy.title,
      line: copy.line,
      cta: copy.cta,
      kind: extra.kind || 'field',
      acc: extra.acc || '',
      focus: extra.focus || '',
    };
    bag[id] = item;
  }

  /**
   * הפריטים שחלים על הסוכן/ת, בסדר ההשפעה, כולל מי שכבר הושלם
   * (כדי ש"3 מתוך 7" ייספר מאותה רשימה). ריק כשאין מדריך.
   */
  function items(state, agent) {
    if (!state || state.just_finished) return [];
    if (typeof onbModel !== 'function') return [];
    var model = onbModel(state);
    var a = agent || {};
    var bag = {};

    var bioStep = stepOf(model, 'bio');
    if (usable(bioStep)) {
      var bioClosed = !!bioStep.isDone;
      var photoDone = bioClosed || state.profile_done === true || !!textOf(a, 'photo_url');
      var textDone = bioClosed || textOf(a, 'bio').length >= BIO_MIN;
      var areasDone = bioClosed;
      var areasKnown = true;
      if (!bioClosed && Array.isArray(a.service_markets)) areasDone = a.service_markets.length > 0;
      else if (!bioClosed) {
        if (photoDone && textDone) areasDone = false;
        else areasKnown = false;
      }
      pushItem(bag, 'photo', photoDone, { kind: 'field', acc: 'accProfile', focus: 'pfPhotoInput' });
      if (areasKnown) pushItem(bag, 'areas', areasDone, { kind: 'field', acc: 'accProfile', focus: 'pfAreas' });
      pushItem(bag, 'bio', textDone, { kind: 'field', acc: 'accProfile', focus: 'pfBio' });
    }

    var license = stepOf(model, 'license');
    if (usable(license)) {
      var hasNumber = !!textOf(a, 'license_number');
      var spec = hasNumber ? COPY.license : COPY.licenseNumber;
      bag.license = {
        id: 'license',
        done: !!license.isDone,
        title: spec.title,
        line: spec.line,
        cta: spec.cta,
        kind: hasNumber ? 'appeal' : 'field',
        acc: hasNumber ? '' : 'accProfile',
        focus: hasNumber ? '' : 'pfLicense',
      };
    }

    var wa = stepOf(model, 'whatsapp');
    if (usable(wa)) {
      var phoneDone = !!wa.isDone || !!textOf(a, 'phone');
      pushItem(bag, 'phone', phoneDone, { kind: 'field', acc: 'accWhatsapp', focus: 'waPhone' });
      pushItem(bag, 'whatsapp', !!wa.isDone, { kind: 'gabriela', acc: '', focus: '' });
    }

    var property = stepOf(model, 'property');
    if (usable(property)) pushItem(bag, 'property', !!property.isDone, { kind: 'property' });

    var office = stepOf(model, 'office');
    if (usable(office)) {
      pushItem(bag, 'logo', state.agency_done === true, { kind: 'field', acc: 'accBranding', focus: 'brLogoInput' });
      pushItem(bag, 'about', state.about_done === true, { kind: 'field', acc: 'accBranding', focus: 'brDescription' });
    }

    var client = stepOf(model, 'client');
    if (usable(client)) pushItem(bag, 'client', !!client.isDone, { kind: 'client' });

    var calendar = stepOf(model, 'calendar');
    if (usable(calendar)) pushItem(bag, 'calendar', !!calendar.isDone, { kind: 'calendar' });

    var prefs = stepOf(model, 'prefs');
    if (usable(prefs)) pushItem(bag, 'prefs', !!prefs.isDone, { kind: 'field', acc: 'accPrefs', focus: '' });

    /* הזמנת סוכנים היא חובה רק למנהל/ת שאינו/ה סוכן/ת פעיל/ה. אצל השאר היא רשות. */
    var invite = stepOf(model, 'invite');
    if (state.agent_steps === false && usable(invite)) {
      pushItem(bag, 'invite', !!invite.isDone, { kind: 'field', acc: 'accTeam', focus: '' });
    }

    var out = [];
    for (var i = 0; i < ORDER.length; i++) {
      if (bag[ORDER[i]]) out.push(bag[ORDER[i]]);
    }
    return out;
  }

  function progress(list) {
    var total = list ? list.length : 0;
    var done = 0;
    for (var i = 0; i < total; i++) if (list[i].done) done++;
    return {
      done: done,
      total: total,
      text: total ? (done + ' מתוך ' + total + ' הושלמו') : '',
    };
  }

  function nextItem(list) {
    for (var i = 0; i < list.length; i++) if (!list[i].done) return list[i];
    return null;
  }

  /**
   * ההחלטה אם להציג עכשיו. בלי DOM, כדי שהבדיקה תכסה אותה.
   * env: mobile, nativeApp, dashboard, mfa, modalOpen, elapsedMs,
   *      seenSession, snoozeUntil, now, pending.
   */
  function decision(env) {
    env = env || {};
    if (!env.dashboard || env.mfa) return { show: false, reason: 'screen' };
    if (!(env.mobile || env.nativeApp)) return { show: false, reason: 'desktop' };
    if (env.seenSession) return { show: false, reason: 'session' };
    if (env.snoozeUntil && env.now < env.snoozeUntil) return { show: false, reason: 'snooze' };
    if (!env.pending) return { show: false, reason: 'complete' };
    if ((env.elapsedMs || 0) < DELAY_MS) return { show: false, reason: 'delay' };
    if (env.modalOpen) return { show: false, reason: 'modal' };
    return { show: true, reason: 'ok' };
  }

  function readGate(store, now) {
    var until = 0;
    var seen = false;
    try { until = Number(store.local.getItem(LOCAL_KEY)) || 0; } catch (e) { until = 0; }
    try { seen = store.session.getItem(SESSION_KEY) === '1'; } catch (e2) { seen = false; }
    return { snoozeUntil: until, seenSession: seen, now: now };
  }

  function writeSeen(store) {
    try { store.session.setItem(SESSION_KEY, '1'); } catch (e) { /* גלישה פרטית */ }
  }

  function writeSnooze(store, now) {
    try { store.local.setItem(LOCAL_KEY, String(now + SNOOZE_MS)); } catch (e) { /* בלי אחסון אין תזכורת, והביקור הזה כבר נספר */ }
  }

  root.ProfileNudge = {
    items: items,
    progress: progress,
    nextItem: nextItem,
    decision: decision,
    readGate: readGate,
    writeSeen: writeSeen,
    writeSnooze: writeSnooze,
    SNOOZE_MS: SNOOZE_MS,
    DELAY_MS: DELAY_MS,
    LOCAL_KEY: LOCAL_KEY,
    SESSION_KEY: SESSION_KEY,
    BIO_MIN: BIO_MIN,
    ORDER: ORDER,
  };

  if (typeof document === 'undefined') return;

  /* ---------- ציור ---------- */

  var ICONS = {
    photo: '<circle cx="36" cy="34" r="7" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M16 54l11-12 7 7 8-10 12 15" fill="none" stroke="#0e2a6b" stroke-width="2.2" stroke-linejoin="round"/>',
    license: '<rect x="18" y="22" width="36" height="28" rx="4" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M24 32h24M24 40h16" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    areas: '<path d="M36 18c-8 0-14 6-14 14 0 10 14 22 14 22s14-12 14-22c0-8-6-14-14-14z" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><circle cx="36" cy="32" r="4" fill="#c9a227"/>',
    phone: '<rect x="24" y="16" width="24" height="40" rx="5" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M32 48h8" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    property: '<path d="M14 32l22-16 22 16v22H14z" fill="none" stroke="#0e2a6b" stroke-width="2.2" stroke-linejoin="round"/><path d="M30 54V40h12v14" fill="none" stroke="#c9a227" stroke-width="2.2"/>',
    logo: '<circle cx="36" cy="36" r="16" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M28 40l8-14 8 14" fill="none" stroke="#c9a227" stroke-width="2.2" stroke-linejoin="round"/>',
    bio: '<path d="M20 20h32v32H20z" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M26 30h20M26 38h14" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    whatsapp: '<path d="M20 36c0-9 8-16 16-16s16 7 16 16-8 16-16 16c-2 0-4 0-6-1l-10 3 3-9c-2-2-3-5-3-9z" fill="none" stroke="#0e2a6b" stroke-width="2.2" stroke-linejoin="round"/>',
    client: '<circle cx="36" cy="26" r="8" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M18 52c2-10 10-14 18-14s16 4 18 14" fill="none" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    calendar: '<rect x="16" y="20" width="40" height="32" rx="4" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><path d="M16 30h40M26 16v8M46 16v8" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    prefs: '<path d="M18 24h36M18 36h36M18 48h36" stroke="#0e2a6b" stroke-width="2.2" stroke-linecap="round"/><circle cx="28" cy="24" r="3" fill="#c9a227"/><circle cx="40" cy="36" r="3" fill="#c9a227"/><circle cx="32" cy="48" r="3" fill="#c9a227"/>',
    about: '<path d="M22 18h28l8 8v28H22z" fill="none" stroke="#0e2a6b" stroke-width="2.2" stroke-linejoin="round"/><path d="M28 36h16M28 44h12" stroke="#c9a227" stroke-width="2.2" stroke-linecap="round"/>',
    invite: '<circle cx="26" cy="28" r="7" fill="none" stroke="#0e2a6b" stroke-width="2.2"/><circle cx="46" cy="30" r="6" fill="none" stroke="#c9a227" stroke-width="2.2"/><path d="M12 50c1-8 7-12 14-12s13 4 14 12M40 48c1-6 4-8 8-8 4 0 7 2 8 8" fill="none" stroke="#0e2a6b" stroke-width="2.2" stroke-linecap="round"/>',
  };

  function art(id) {
    var icon = ICONS[id] || ICONS.photo;
    return '<svg class="pn-svg" viewBox="0 0 168 112" width="168" height="112" aria-hidden="true" focusable="false">'
      + '<rect x="22" y="18" width="62" height="78" rx="14" fill="#0e2a6b" transform="rotate(-8 53 57)"/>'
      + '<rect x="74" y="12" width="70" height="86" rx="14" fill="#fff" stroke="#c9a227" stroke-width="3"/>'
      + '<g transform="translate(78 16)">' + icon + '</g>'
      + '</svg>';
  }

  function bars(prog) {
    var html = '';
    for (var i = 0; i < prog.total; i++) html += '<i' + (i < prog.done ? ' class="is-done"' : '') + '></i>';
    return html;
  }

  function esc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s);
    return String(s == null ? '' : s);
  }

  function sheetHtml(item, prog) {
    return '<div class="pn-backdrop" data-pn="dismiss"></div>'
      + '<div class="pn-sheet" role="dialog" aria-modal="true" aria-labelledby="profileNudgeTitle" aria-describedby="profileNudgeLine" tabindex="-1">'
      + '<button type="button" class="pn-x" data-pn="dismiss" aria-label="סגירה">'
      + '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
      + '</button>'
      + '<div class="pn-art">' + art(item.id) + '</div>'
      + '<h2 id="profileNudgeTitle">' + esc(item.title) + '</h2>'
      + '<p id="profileNudgeLine">' + esc(item.line) + '</p>'
      + '<p class="pn-progress">' + esc(prog.text) + '</p>'
      + '<div class="pn-bars" aria-hidden="true">' + bars(prog) + '</div>'
      + '<button type="button" class="pn-go" data-pn="go">' + esc(item.cta) + '</button>'
      + '<button type="button" class="pn-later" data-pn="later">אעדכן אחר כך</button>'
      + '</div>';
  }

  /* ---------- מדידה ---------- */

  function track(kind, itemId) {
    var params = { nudge_item: String(itemId || '') };
    try {
      if (typeof root.shukTrack === 'function') {
        if (kind === 'shown') root.shukTrack('profile_nudge_shown', params);
        else if (kind === 'completed_click') root.shukTrack('profile_nudge_completed_click', params);
        else if (kind === 'later') root.shukTrack('profile_nudge_later', params);
        else if (kind === 'dismissed') root.shukTrack('profile_nudge_dismissed', params);
        return;
      }
      root.dataLayer = root.dataLayer || [];
      var name = kind === 'shown' ? 'profile_nudge_shown'
        : kind === 'completed_click' ? 'profile_nudge_completed_click'
        : kind === 'later' ? 'profile_nudge_later'
        : kind === 'dismissed' ? 'profile_nudge_dismissed' : '';
      if (!name) return;
      var path = ((root.location && root.location.pathname || '').split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
      root.dataLayer.push({ event: name, page_type: path, nudge_item: params.nudge_item });
    } catch (e) { /* מדידה לא שוברת את הגיליון */ }
  }

  /* ---------- מתי לא ---------- */

  function isNative() {
    return /ShukNadlanApp/i.test((navigator.userAgent || ''));
  }

  function isMobileWidth() {
    return !!(root.matchMedia && root.matchMedia(MOBILE_MQ).matches);
  }

  function screenState() {
    var dash = document.getElementById('dashboard');
    var mfa = document.getElementById('mfaChallengeScreen');
    var dashboard = !!(dash && document.body.classList.contains('dash-active') && dash.style.display !== 'none');
    var mfaOn = false;
    if (mfa) {
      var shown = mfa.style.display && mfa.style.display !== 'none';
      mfaOn = shown && !dashboard;
    }
    return { dashboard: dashboard, mfa: mfaOn };
  }

  function modalOpen() {
    if (typeof navLayer !== 'undefined' && navLayer) return true;
    if (document.body.classList.contains('nav-layer-open')) return true;
    if (document.documentElement.classList.contains('pf-sheet-open')) return true;
    var nodes = document.querySelectorAll('[role="dialog"][aria-modal="true"], .welcome-modal, .pm-overlay, .imp-overlay');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest && el.closest('#profileNudge')) continue;
      if (el.closest && el.closest('[hidden]')) continue;
      if (el.hidden) continue;
      var cs = root.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!el.getClientRects().length) continue;
      return true;
    }
    return false;
  }

  function storage() {
    return { local: root.localStorage, session: root.sessionStorage };
  }

  /* ---------- חלון ---------- */

  var openRoot = null;
  var restoreEl = null;
  var onKey = null;
  var armedAt = 0;
  var timer = 0;
  var attempts = 0;

  function focusables(sheet) {
    var list = sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.disabled) continue;
      if (el.tabIndex < 0 && el !== sheet) continue;
      out.push(el);
    }
    return out;
  }

  function closeSheet() {
    if (onKey) {
      document.removeEventListener('keydown', onKey, true);
      onKey = null;
    }
    document.documentElement.classList.remove('pn-open');
    var node = openRoot;
    openRoot = null;
    if (!node) return;
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.classList.remove('is-open');
    var drop = function () { if (node.parentNode) node.parentNode.removeChild(node); };
    if (reduce) drop();
    else root.setTimeout(drop, 280);
    if (restoreEl && restoreEl.focus) {
      try { restoreEl.focus(); } catch (e) { /* היעד כבר לא במסמך */ }
    }
    restoreEl = null;
  }

  function go(item, btn) {
    if (item.kind === 'calendar' && typeof startGcalConnect === 'function') {
      startGcalConnect(btn);
      return;
    }
    closeSheet();
    if (item.kind === 'appeal' && typeof onbLicenseAppeal === 'function') {
      onbLicenseAppeal();
      return;
    }
    if (item.kind === 'property' && typeof openInlineForm === 'function') {
      openInlineForm('accProperties', 'addPropertyForm', 'toggleAddProperty');
      return;
    }
    if (item.kind === 'client' && typeof openInlineForm === 'function') {
      openInlineForm('accClients', 'addClientForm', 'toggleAddClient');
      return;
    }
    if (item.kind === 'gabriela' && typeof onbOpenGabriela === 'function') {
      var hello = typeof ASSISTANT_WA_HELLO === 'string' ? ASSISTANT_WA_HELLO : '';
      onbOpenGabriela(hello);
      return;
    }
    if (item.acc && typeof gotoSection === 'function') {
      gotoSection(item.acc, item.focus || undefined);
      var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.setTimeout(function () {
        var el = item.focus && document.getElementById(item.focus);
        if (!el) return;
        var target = el;
        if (el.id === 'pfAreas') {
          var inner = el.querySelector('button, input, [tabindex]');
          if (inner) target = inner;
        }
        try {
          target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
          target.focus({ preventScroll: true });
        } catch (e) { /* שדה שעוד לא ב-DOM */ }
      }, reduce ? 0 : 480);
    }
  }

  function open(item, prog) {
    if (openRoot || !item) return;
    restoreEl = document.activeElement;
    var rootEl = document.createElement('div');
    rootEl.id = 'profileNudge';
    rootEl.className = 'pn-root';
    rootEl.innerHTML = sheetHtml(item, prog);
    document.body.appendChild(rootEl);
    openRoot = rootEl;
    document.documentElement.classList.add('pn-open');
    writeSeen(storage());
    track('shown', item.id);

    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) rootEl.classList.add('is-open');
    else root.requestAnimationFrame(function () {
      root.requestAnimationFrame(function () { if (openRoot === rootEl) rootEl.classList.add('is-open'); });
    });

    var sheet = rootEl.querySelector('.pn-sheet');
    var closeBtn = rootEl.querySelector('.pn-x');
    if (closeBtn) {
      try { closeBtn.focus(); } catch (e) { /* */ }
    } else if (sheet) {
      try { sheet.focus(); } catch (e2) { /* */ }
    }

    onKey = function (ev) {
      if (!openRoot) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        track('dismissed', item.id);
        writeSnooze(storage(), Date.now());
        closeSheet();
        return;
      }
      if (ev.key !== 'Tab' || !sheet) return;
      var nodes = focusables(sheet);
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    rootEl.addEventListener('click', function (ev) {
      var hit = ev.target && ev.target.closest && ev.target.closest('[data-pn]');
      if (!hit) return;
      var act = hit.getAttribute('data-pn');
      if (act === 'go') {
        track('completed_click', item.id);
        go(item, hit);
        return;
      }
      if (act === 'later') {
        track('later', item.id);
        writeSnooze(storage(), Date.now());
        closeSheet();
        return;
      }
      if (act === 'dismiss') {
        track('dismissed', item.id);
        writeSnooze(storage(), Date.now());
        closeSheet();
      }
    });
  }

  function marketsStillLoading(state, agent) {
    if (!state || state.just_finished || state.bio_done === true || state.agent_steps === false) return false;
    if (!agent || Array.isArray(agent.service_markets)) return false;
    return true;
  }

  function tick() {
    timer = 0;
    attempts++;
    var state = typeof onbState === 'function' ? onbState() : null;
    var agent = typeof currentAgent !== 'undefined' ? currentAgent : null;
    /* אזורי השירות נטענים בשאילתה נפרדת. בלי המערך אי אפשר לדעת אם הם חסרים,
       והגיליון עלול לבקש משפט לפני אזורים. כמה נסיונות, ואז ממשיכים עם מה שיש. */
    if (marketsStillLoading(state, agent) && attempts < 8) {
      timer = root.setTimeout(tick, 400);
      return;
    }
    var screen = screenState();
    var list = items(state, agent);
    var pending = nextItem(list);
    var gate = readGate(storage(), Date.now());
    var choice = decision({
      mobile: isMobileWidth(),
      nativeApp: isNative(),
      dashboard: screen.dashboard,
      mfa: screen.mfa,
      modalOpen: modalOpen(),
      elapsedMs: Date.now() - armedAt,
      seenSession: gate.seenSession,
      snoozeUntil: gate.snoozeUntil,
      now: gate.now,
      pending: !!pending,
    });
    if (choice.show && pending) {
      open(pending, progress(list));
      return;
    }
    /* חלון פתוח או שעוד לא עברה שניה: ננסה שוב. השאר (דסקטופ, ביקור, 24 שעות, הושלם, מסך כניסה) נעצרים. */
    if ((choice.reason === 'delay' || choice.reason === 'modal') && attempts < 180) {
      timer = root.setTimeout(tick, choice.reason === 'delay' ? 400 : 800);
    }
  }

  function schedule() {
    if (armedAt || openRoot) return;
    if (!document.getElementById('dashboard')) return;
    armedAt = Date.now();
    attempts = 0;
    /* ‏100 מעל השניה, כי setTimeout יכול להקדים במעט */
    timer = root.setTimeout(tick, DELAY_MS + 100);
  }

  root.profileNudgeSchedule = schedule;
  root.ProfileNudge.sheetHtml = sheetHtml;
  root.ProfileNudge.openForPreview = function (item, prog) { open(item, prog); };
})(typeof window !== 'undefined' ? window : globalThis);
