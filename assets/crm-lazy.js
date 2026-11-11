/* סקריפטים של מסך אחד ב-CRM. לא נטענים עם הדף: על קו איטי הם היו
   מתחרים ב-crm.js ובציור מסך הכניסה, וסקריפט defer אחד שנתקע (502 אחרי
   40 שניות) עיכב את כל השרשרת כולל מסך הכניסה ואת ניתוב ה-goto.
   crmNeed('leads') וחבריו נקראים כשהמסך או יעד הקישור נפתחים.
   crmArmSections אחרי שהמסך כבר מצויר טוען את השאר כשהדפדפן פנוי.
   הסדר בתוך קבוצה נשמר כי הסקריפט הבא נכנס רק אחרי onload של הקודם.
   async=true בכוונה: async=false על סקריפט שמוזרק דינמית מכניס אותו
   לתור ביצוע אחד, וסקריפט תקוע שם עוצר גם קבוצה אחרת. */
(function (global) {
  'use strict';

  var GROUPS = {
    map: [
      ['/vendor/leaflet@1.9.4/leaflet.js', 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'],
      ['assets/map-tiles.js', ''],
      ['assets/map-gestures.js', ''],
    ],
    property: [
      ['assets/open-house.js', ''],
      ['assets/approx-location.js', ''],
    ],
    agreements: [
      ['assets/agreement-templates.js', ''],
      ['assets/agreement-doc.js', ''],
      ['assets/il-id.js', ''],
    ],
    /* ת.ז. לבד: שמירת פרופיל לא צריכה את תבניות ההסכם. loadOne מזהה
       את אותו src אם קבוצת ההסכמים כבר טענה אותו. */
    ilid: [
      ['assets/il-id.js', ''],
    ],
    specialties: [
      ['assets/specialties.js', ''],
    ],
    govmap: [
      ['assets/govmap.js', ''],
    ],
    ui: [['assets/crm-ui.js', '']],
    markets: [
      ['assets/markets.js', ''],
      ['assets/agency-markets.js', ''],
    ],
    contacts: [['assets/contact-import.js', '']],
    office: [['assets/crm-office.js', '']],
    settings: [['assets/crm-settings.js', '']],
    areas: [['assets/crm-areas.js', '']],
    profilePages: [['assets/crm-profile-pages.js', '']],
    leads: [['assets/crm-leads.js', ''], ['assets/crm-lead-reports.js', '']],
    properties: [['assets/crm-properties.js', ''], ['assets/crm-owner-report.js', '']],
    matches: [['assets/crm-matches.js', '']],
    suggestions: [['assets/crm-suggestions.js', '']],
    coach: [['assets/crm-coach.js', '']],
    officeDash: [['assets/crm-office-dashboard.js', '']],
    myDash: [['assets/crm-my-dashboard.js', '']],
    teamDash: [['assets/crm-team-dashboard.js', '']],
    showcase: [['assets/crm-showcase.js', '']],
    teams: [['assets/crm-teams.js', '']],
    home: [['assets/crm-home.js', '']],
    onboarding: [
      ['assets/crm-onboarding.js', ''],
      ['assets/crm-profile-nudge.js', ''],
    ],
    csm: [['assets/crm-csm.js', '']],
    adminInbox: [['assets/crm-admin-inbox.js', '']],
    command: [['assets/crm-command-center.js', '']],
    growth: [['assets/crm-growth.js', '']],
    budget: [['assets/crm-budget.js', '']],
    adsSpend: [['assets/crm-ads-spend.js', '']],
    hoodDrafts: [['assets/crm-hood-drafts.js', '']],
    import: [['assets/property-import-core.js', '']],
    cma: [['assets/cma-render.js', '']],
    air: [['assets/air-living.js', '']],
  };

  /* קבוצה שנשענת על אחרת מחכה לה, ולא נטענת לפניה. בלי זה ערכת הרכיבים
     או עזרי הדאשבורד חסרים ברגע שהקובץ רץ. */
  var PRE = {
    settings: ['ui', 'onboarding'],
    /* ההגדרות והמדריך נפתחים מהכפתור, לא בשביל לצייר את הרשימה.
       כישלון שלהם לא אמור להחביא את הלידים. */
    leads: ['ui'],
    properties: ['ui'],
    matches: ['ui'],
    suggestions: ['ui'],
    home: ['ui', 'leads'],
    onboarding: ['ui'],
    profilePages: ['ui', 'settings'],
    areas: ['markets', 'ui'],
    office: ['ui'],
    /* המאמן נטען לפני הדאשבורדים: הם רושמים ציור ב-coachRerender
       בזמן טעינת הקובץ. */
    coach: ['ui'],
    officeDash: ['ui', 'coach'],
    myDash: ['ui', 'coach', 'officeDash'],
    teamDash: ['ui', 'coach', 'officeDash'],
    showcase: ['ui'],
    teams: ['ui'],
    csm: ['ui'],
    adminInbox: ['ui'],
    command: ['ui', 'coach', 'adminInbox'],
    growth: ['ui'],
    budget: ['ui'],
    hoodDrafts: ['ui'],
    contacts: ['ui'],
  };

  /* איזה קבצים יעד קישור צריך לפני שהוא נפתח. מה שאין כאן לא מעכב את
     הניתוב. ייבוא הנכסים, למשל, אינו חלק מקישור ללידים. */
  var GOTO = {
    accLeads: ['leads'],
    accClients: ['showcase', 'leads'],
    accProperties: ['properties', 'air'],
    accSharedWithMe: ['properties'],
    accPlanning: ['cma', 'property', 'map', 'govmap'],
    accAgreements: ['agreements'],
    sign: ['agreements'],
    accPrefs: ['settings', 'areas'],
    accNotifPrefs: ['settings'],
    accProfile: ['profilePages', 'areas', 'ilid', 'specialties', 'air'],
    accBranding: ['profilePages', 'specialties'],
    accMyDashboard: ['myDash'],
    accOfficeDashboard: ['officeDash'],
    accTeamDashboard: ['teamDash'],
    accTeamAgents: ['teamDash'],
    accTeamLeads: ['teamDash'],
    accCsm: ['csm'],
    accAlerts: ['matches'],
    accAgenda: ['home'],
    cma: ['cma', 'properties'],
    cmaAddress: ['cma'],
    promote: ['properties'],
    waShare: ['properties'],
    mentor: ['coach'],
    adminHome: ['command', 'coach'],
    accGrowth: ['growth'],
    accNeighborhoods: ['hoodDrafts', 'areas'],
    accSuggestions: ['suggestions'],
    accCoachGaps: ['coach'],
    accAdminInbox: ['adminInbox'],
    accPlatformNews: ['command'],
    accTeams: ['teams'],
    accBudget: ['budget'],
  };

  var pending = {};
  var inflight = {};
  var settled = {};
  var failedAt = {};
  /* קבוצה שקורא אחד כבר פקע עליה, וההורדה עוד רצה. קורא הבא באותה
     עלייה לא משלם עוד 8 שניות: crmAfter יצייר כשהקובץ יגיע. */
  var stalled = {};
  var groupPri = {};
  var CALL_MS = 8000;
  /* תור הורדה. קריאה מהמסך (עדיפות 1) קופצת לפני הטעינה ברקע.
     ברקע רצות לכל היותר שתי הורדות, כדי ש-ui / לידים / נכסים
     לא ייתקעו מאחורי כל שאר הקבצים על קו איטי. */
  var q = [];
  var active = 0;
  var MAX_TOTAL = 4;
  var MAX_LOW = 2;
  var generation = {};
  var bustFor = {};
  var gaveUp = {};
  var giveUpFns = {};
  var attemptSeq = 0;

  function findTag(src) {
    var all = document.querySelectorAll('script[data-crm-src]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-crm-src') === src) return all[i];
    }
    return document.querySelector('script[src="' + src + '"]');
  }

  function loadOne(src, integrity, priority) {
    var found = findTag(src);
    if (found && found.dataset.ready === '1') return Promise.resolve();
    if (found && found.dataset.evalfail === '1') return Promise.reject(new Error(src));
    var existing = inflight[src];
    if (existing) {
      if ((priority || 0) > existing.priority && !existing.started) {
        existing.priority = priority;
        pump();
      }
      return existing.promise;
    }
    if (found && found.dataset.failed === '1' && found.dataset.evalfail !== '1') {
      found.remove();
    }
    var entry = {
      src: src,
      integrity: integrity || '',
      priority: priority || 0,
      started: false,
      abandoned: false,
      slotDone: false,
      bust: bustFor[src] || 0,
      token: ++attemptSeq,
    };
    if (bustFor[src]) delete bustFor[src];
    entry.promise = new Promise(function (resolve, reject) {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    inflight[src] = entry;
    q.push(entry);
    pump();
    return entry.promise;
  }

  /* ניסיון חוזר נוטש הורדה תקועה. הגוף הישן לא רץ: ה-fetch מבוטל
     לפני הזרקת הסקריפט, וטוקן מונע מגוף שמגיע באיחור לרוץ. */
  function abandonEntry(entry) {
    if (!entry || entry.abandoned) return;
    entry.abandoned = true;
    if (entry.abort) { try { entry.abort(); } catch (e) {} }
    if (inflight[entry.src] === entry) delete inflight[entry.src];
    for (var i = q.length - 1; i >= 0; i--) if (q[i] === entry) q.splice(i, 1);
    if (entry.el && entry.el.dataset.ready !== '1' && entry.el.dataset.evalfail !== '1') {
      entry.el.remove();
    }
    if (entry.started && !entry.slotDone) {
      entry.slotDone = true;
      active--;
      if (entry.priority > 0) activeHigh--;
    }
    try { entry.reject(new Error('abandoned')); } catch (e2) {}
  }

  function abandonGroup(group) {
    var seen = closureOf(group, {});
    for (var g in seen) {
      if (settled[g] === 'ok') continue;
      generation[g] = (generation[g] || 0) + 1;
      delete pending[g];
      delete stalled[g];
      delete failedAt[g];
      delete gaveUp[g];
      if (settled[g] && settled[g] !== 'ok') delete settled[g];
      var list = GROUPS[g] || [];
      for (var i = 0; i < list.length; i++) {
        var src = list[i][0];
        var tag = findTag(src);
        if (tag && tag.dataset.ready === '1') continue;
        abandonEntry(inflight[src]);
        bustFor[src] = (bustFor[src] || 0) + 1;
      }
    }
    pump();
  }

  function pump() {
    q.sort(function (a, b) { return b.priority - a.priority; });
    while (active < MAX_TOTAL && q.length) {
      var high = -1;
      for (var i = 0; i < q.length; i++) if (q[i].priority > 0) { high = i; break; }
      /* ברקע לא מתחיל כל עוד קובץ שהמסך ביקש עוד יורד. */
      if (high < 0 && (activeHigh > 0 || active >= MAX_LOW)) break;
      var idx = high >= 0 ? high : 0;
      begin(q.splice(idx, 1)[0]);
    }
  }

  var activeHigh = 0;

  function begin(entry) {
    entry.started = true;
    active++;
    if (entry.priority > 0) activeHigh++;
    /* ה-fetch מתחיל בתור הבא, לא באותו תור שבו נקבע הטיימר של הקורא. */
    setTimeout(function () { fetchScript(entry); }, 0);
  }

  function releaseSlot(entry) {
    if (entry.slotDone) return;
    entry.slotDone = true;
    active--;
    if (entry.priority > 0) activeHigh--;
    if (inflight[entry.src] === entry) delete inflight[entry.src];
    pump();
  }

  function fetchScript(entry) {
    if (entry.abandoned) { releaseSlot(entry); return; }
    /* תגית ריקה בזמן ההורדה, כדי שאפשר לספור אותה. היא לא רצה.
       הגוף נכנס לתגית אחרת רק אם הניסיון הזה עדיין בתוקף. */
    var placeholder = document.createElement('script');
    placeholder.type = 'text/plain';
    placeholder.setAttribute('data-crm-src', entry.src);
    document.head.appendChild(placeholder);
    entry.el = placeholder;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    entry.abort = function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } };
    var url = entry.src;
    if (entry.bust) url += (url.indexOf('?') < 0 ? '?' : '&') + 'retry=' + entry.token;
    var opt = { credentials: 'same-origin' };
    if (ctrl) opt.signal = ctrl.signal;
    if (entry.integrity) opt.integrity = entry.integrity;
    fetch(url, opt).then(function (res) {
      if (!res.ok) throw new Error(entry.src);
      return res.text();
    }).then(function (code) {
      if (entry.abandoned) return;
      if (entry.el && entry.el.parentNode) entry.el.remove();
      var s = document.createElement('script');
      s.setAttribute('data-crm-src', entry.src);
      entry.el = s;
      s.text = code;
      var evalFailed = false;
      function onErr() { evalFailed = true; }
      global.addEventListener('error', onErr);
      document.head.appendChild(s);
      global.removeEventListener('error', onErr);
      releaseSlot(entry);
      if (entry.abandoned) return;
      if (evalFailed) {
        /* הריצה כבר יצרה const/let. לא מזריקים עותק שני. */
        s.dataset.evalfail = '1';
        s.dataset.failed = '1';
        entry.reject(new Error(entry.src));
      } else {
        s.dataset.ready = '1';
        entry.resolve();
      }
    }).catch(function (err) {
      if (entry.abandoned || (err && err.name === 'AbortError')) {
        releaseSlot(entry);
        return;
      }
      if (entry.el && entry.el.dataset.ready !== '1' && entry.el.dataset.evalfail !== '1' && entry.el.parentNode) {
        entry.el.remove();
      }
      releaseSlot(entry);
      entry.reject(err || new Error(entry.src));
    });
  }

  function needShared(group, priority) {
    if (!GROUPS[group]) return Promise.resolve();
    var pri = priority || 0;
    if (pri > (groupPri[group] || 0)) groupPri[group] = pri;
    if (settled[group] === 'ok') return Promise.resolve();
    /* חלון קצר אחרי כישלון אמיתי (502), כדי שסדרה של קריאות לא
       תפתח הורדה חדשה לכל אחת. אחרי החלון הקריאה הבאה ממתינה
       להורדה שהתחילה מחדש, ולא נדחית מיד. */
    if (failedAt[group] && Date.now() - failedAt[group] < 4000 && !pending[group]) {
      return Promise.reject(settled[group] || new Error(group));
    }
    if (!pending[group]) {
      if (failedAt[group]) clearFailed(group);
      var gen = generation[group] || 0;
      var run = function () { return loadGroup(group); };
      var mine = function () { return (generation[group] || 0) === gen; };
      pending[group] = run().then(function (v) {
        if (!mine()) return Promise.reject(new Error('abandoned'));
        settled[group] = 'ok';
        delete failedAt[group];
        delete stalled[group];
        delete gaveUp[group];
        return v;
      }).catch(function () {
        if (!mine()) return Promise.reject(new Error('abandoned'));
        clearFailed(group);
        return run().then(function (v) {
          if (!mine()) return Promise.reject(new Error('abandoned'));
          settled[group] = 'ok';
          delete failedAt[group];
          delete stalled[group];
          delete gaveUp[group];
          return v;
        });
      }).catch(function (err) {
        if (!mine()) return Promise.reject(err || new Error('abandoned'));
        delete pending[group];
        failedAt[group] = Date.now();
        settled[group] = err || new Error(group);
        throw settled[group];
      });
    }
    return pending[group];
  }

  function closureOf(group, seen) {
    if (seen[group]) return seen;
    seen[group] = true;
    var deps = PRE[group] || [];
    for (var i = 0; i < deps.length; i++) closureOf(deps[i], seen);
    return seen;
  }

  function clearFailed(group) {
    var seen = closureOf(group, {});
    for (var g in seen) {
      delete failedAt[g];
      delete stalled[g];
      if (settled[g] && settled[g] !== 'ok') delete settled[g];
    }
  }

  function loadGroup(group) {
    var deps = PRE[group] || [];
    var chain = Promise.resolve();
    for (var d = 0; d < deps.length; d++) {
      (function (dep) {
        chain = chain.then(function () { return needShared(dep, groupPri[group] || 0); });
      })(deps[d]);
    }
    var list = GROUPS[group];
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        chain = chain.then(function () { return loadOne(item[0], item[1], groupPri[group] || 0); });
      })(list[i]);
    }
    return chain;
  }

  function boost(group, seen) {
    if (!group || seen[group] || !GROUPS[group]) return;
    seen[group] = true;
    groupPri[group] = 1;
    var list = GROUPS[group];
    for (var i = 0; i < list.length; i++) {
      var entry = inflight[list[i][0]];
      if (entry && !entry.started && entry.priority < 1) entry.priority = 1;
    }
    var deps = PRE[group] || [];
    for (var d = 0; d < deps.length; d++) boost(deps[d], seen);
  }

  /* קבוצה שכבר פקעה ועדיין יורדת, או תלות שלה במצב הזה.
     הקורא הבא נדחה מיד. השעון המלא נשאר לקבוצה שעוד לא פקעה. */
  function markStalled(group, seen) {
    if (!group || seen[group] || !GROUPS[group]) return;
    seen[group] = true;
    if (pending[group] && settled[group] !== 'ok') stalled[group] = true;
    var deps = PRE[group] || [];
    for (var i = 0; i < deps.length; i++) markStalled(deps[i], seen);
  }

  function isStalled(group, seen) {
    if (!group || seen[group] || !GROUPS[group]) return false;
    seen[group] = true;
    if (stalled[group] && pending[group] && settled[group] !== 'ok') return true;
    var deps = PRE[group] || [];
    for (var i = 0; i < deps.length; i++) {
      if (isStalled(deps[i], seen)) return true;
    }
    return false;
  }

  /* המתנה של הקורא הזה בלבד. מתחילה כשהוא מבקש, ולא כשהקבוצה
     נגעה לראשונה. פקיעה דוחה רק אותו: ההבטחה המשותפת נשארת,
     וכשהקובץ מגיע crmAfter מריץ את מה שנכשל. */
  function boundCaller(group, p) {
    if (settled[group] === 'ok') return Promise.resolve();
    if (isStalled(group, {})) {
      markStalled(group, {});
      return Promise.reject(new Error(group));
    }
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = 0;
      function finish(err, value) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      }
      p.then(function (v) { finish(null, v); }, function (e) { finish(e || new Error(group)); });
      timer = setTimeout(function () {
        markStalled(group, {});
        finish(new Error(group));
      }, CALL_MS);
    });
  }

  /* ההורדה עוד רצה. כמה שניות אחרי הפקיעה הרשימה עדיין על "טוען…".
     רק אחר כך, אם הבקשה באמת תקועה, מופיע "לא נטענה". */
  function crmInflight(group, seen) {
    if (!group || !GROUPS[group]) return false;
    seen = seen || {};
    if (seen[group]) return false;
    seen[group] = true;
    if (settled[group] === 'ok') return false;
    if (failedAt[group] && !pending[group]) return false;
    if (pending[group]) return true;
    var deps = PRE[group] || [];
    for (var i = 0; i < deps.length; i++) {
      if (crmInflight(deps[i], seen)) return true;
    }
    return false;
  }

  function crmEvalFailed(group, seen) {
    if (!group || !GROUPS[group]) return false;
    seen = seen || {};
    if (seen[group]) return false;
    seen[group] = true;
    var list = GROUPS[group];
    for (var i = 0; i < list.length; i++) {
      var el = findTag(list[i][0]);
      if (el && el.dataset.evalfail === '1') return true;
    }
    var deps = PRE[group] || [];
    for (var d = 0; d < deps.length; d++) {
      if (crmEvalFailed(deps[d], seen)) return true;
    }
    return false;
  }

  function removeEvalFail(group) {
    var seen = closureOf(group, {});
    for (var g in seen) {
      var list = GROUPS[g] || [];
      for (var i = 0; i < list.length; i++) {
        var el = findTag(list[i][0]);
        if (el && el.dataset.evalfail === '1') el.remove();
      }
    }
  }

  function crmNeed(group, opts) {
    if (!GROUPS[group]) return Promise.resolve();
    if (opts && opts.fresh) {
      clearFailed(group);
      abandonGroup(group);
      removeEvalFail(group);
    }
    groupPri[group] = 1;
    var p = needShared(group, 1);
    boost(group, {});
    pump();
    return boundCaller(group, p);
  }

  /* אחרי שהקובץ באמת רץ. גם כישלון אמיתי (502) נרשם: אחרי חלון
     הארבע שניות יש עוד ניסיון, כדי שהעדפות והתראות לא יישארו
     ריקות לכל הסשן. */
  var afterFns = {};
  var afterWatch = {};
  function flushAfter(group) {
    var list = afterFns[group] || [];
    afterFns[group] = [];
    afterWatch[group] = false;
    for (var i = 0; i < list.length; i++) {
      try {
        var ret = list[i]();
        if (ret && typeof ret.then === 'function') ret.catch(function () {});
      } catch (e) {}
    }
  }
  function watchAfter(group, again) {
    needShared(group, 1).then(function () {
      flushAfter(group);
    }).catch(function () {
      if (again) {
        afterWatch[group] = false;
        gaveUp[group] = true;
        var hooks = giveUpFns[group] || [];
        giveUpFns[group] = [];
        for (var i = 0; i < hooks.length; i++) {
          try { hooks[i](); } catch (e) {}
        }
        return;
      }
      setTimeout(function () {
        if (settled[group] === 'ok') { flushAfter(group); return; }
        watchAfter(group, true);
      }, 4500);
    });
  }
  function crmAfter(group, fn) {
    if (!GROUPS[group] || typeof fn !== 'function') return;
    if (settled[group] === 'ok') {
      Promise.resolve().then(function () {
        try {
          var ret = fn();
          if (ret && typeof ret.then === 'function') ret.catch(function () {});
        } catch (e) {}
      });
      return;
    }
    if (!afterFns[group]) afterFns[group] = [];
    afterFns[group].push(fn);
    if (afterWatch[group]) return;
    afterWatch[group] = true;
    watchAfter(group, false);
  }

  function crmGroupsFor(raw) {
    var list = GOTO[raw];
    return list ? list.slice() : [];
  }

  /* אחרי שהמסך הראשון מצויר. לא crmNeed: טעינת הרקע לא פותחת
     שעון המתנה לאף קורא. עדיפות 0, ו-ui / לידים / נכסים קודמים
     בתור כדי שלא ייתקעו מאחורי שאר הקבצים. */
  var PREFETCH_FIRST = ['ui', 'leads', 'properties', 'settings', 'office'];
  /* מסכי מנהל/ת הפלטפורמה: סוכן/ת רגיל/ה אינו פותח אותם לעולם, ולכן אינם נטענים
     ברקע (11.11.2026). מי שהוא מנהל/ת פלטפורמה מקבל/ת אותם דרך crmArmAdminSections
     אחרי שהדשבורד נטען, ופתיחה ישירה (crmNeed, ‏?goto=) לא הושפעה. */
  var ADMIN_ONLY = ['csm', 'adminInbox', 'command', 'growth', 'budget', 'adsSpend', 'hoodDrafts'];
  function crmArmSections() {
    if (crmArmSections.armed) return;
    crmArmSections.armed = true;
    var start = function () {
      var names = Object.keys(GROUPS);
      var ordered = [];
      for (var i = 0; i < PREFETCH_FIRST.length; i++) {
        if (GROUPS[PREFETCH_FIRST[i]]) ordered.push(PREFETCH_FIRST[i]);
      }
      for (var n = 0; n < names.length; n++) {
        if (ordered.indexOf(names[n]) < 0 && ADMIN_ONLY.indexOf(names[n]) < 0) ordered.push(names[n]);
      }
      ordered.forEach(function (g) {
        needShared(g, 0).catch(function () {});
      });
    };
    var idle = global.requestIdleCallback || function (fn) { global.setTimeout(fn, 400); };
    global.requestAnimationFrame(function () {
      idle(start, { timeout: 1500 });
    });
  }

  function crmArmAdminSections() {
    if (crmArmAdminSections.armed) return;
    crmArmAdminSections.armed = true;
    var idle = global.requestIdleCallback || function (fn) { global.setTimeout(fn, 400); };
    idle(function () {
      ADMIN_ONLY.forEach(function (g) {
        if (GROUPS[g]) needShared(g, 0).catch(function () {});
      });
    }, { timeout: 3000 });
  }

  global.crmNeed = crmNeed;
  global.crmArmAdminSections = crmArmAdminSections;
  global.crmAfter = crmAfter;
  global.crmInflight = crmInflight;
  global.crmEvalFailed = crmEvalFailed;
  global.crmGaveUp = function (group) { return !!gaveUp[group]; };
  global.crmOnGiveUp = function (group, fn) {
    if (!GROUPS[group] || typeof fn !== 'function') return;
    if (gaveUp[group]) { try { fn(); } catch (e) {} return; }
    if (!giveUpFns[group]) giveUpFns[group] = [];
    giveUpFns[group].push(fn);
  };
  global.crmGroupsFor = crmGroupsFor;
  global.crmArmSections = crmArmSections;
})(window);
