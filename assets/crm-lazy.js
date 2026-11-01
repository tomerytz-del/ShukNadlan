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
    leads: [['assets/crm-leads.js', '']],
    properties: [['assets/crm-properties.js', '']],
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
  var deadlines = {};
  var CALL_MS = 8000;
  var clockJobs = [];
  /* השעון נדלק כאן, לפני כל סקריפט עצלן, ונשאר. טיימר שנקבע
     באותו תור של תגית תקועה לא נורה, והדשבורד היה נשאר על "טוען". */
  setInterval(function () {
    var now = Date.now();
    for (var i = clockJobs.length - 1; i >= 0; i--) {
      if (now >= clockJobs[i].due) {
        var job = clockJobs.splice(i, 1)[0];
        job.fn();
      }
    }
  }, 250);

  function loadOne(src, integrity) {
    var found = document.querySelector('script[src="' + src + '"]');
    if (found && found.dataset.ready === '1') return Promise.resolve();
    if (inflight[src]) return inflight[src];
    if (found && found.dataset.failed === '1') { found.remove(); found = null; }
    var promise = new Promise(function (resolve, reject) {
      var s = found || document.createElement('script');
      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        if (inflight[src] === promise) delete inflight[src];
        if (ok) { s.dataset.ready = '1'; resolve(); }
        else {
          s.dataset.failed = '1';
          s.remove();
          reject(new Error(src));
        }
      };
      if (!found) {
        s.async = true;
        if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
        s.onload = function () { finish(true); };
        s.onerror = function () { finish(false); };
        s.src = src;
        document.head.appendChild(s);
      } else {
        s.addEventListener('load', function () { finish(true); });
        s.addEventListener('error', function () { finish(false); });
      }
    });
    inflight[src] = promise;
    return promise;
  }

  function needShared(group) {
    if (!GROUPS[group]) return Promise.resolve();
    if (failedAt[group] && Date.now() - failedAt[group] < 4000) {
      return Promise.reject(new Error(group));
    }
    if (!pending[group]) {
      pending[group] = loadGroup(group).then(function (v) {
        settled[group] = 'ok';
        delete deadlines[group];
        return v;
      }).catch(function () {
        clearFailed(group);
        return loadGroup(group).then(function (v) {
          settled[group] = 'ok';
          delete deadlines[group];
          return v;
        });
      }).catch(function (err) {
        delete pending[group];
        delete deadlines[group];
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
      delete deadlines[g];
      if (settled[g] && settled[g] !== 'ok') delete settled[g];
    }
  }

  function loadGroup(group) {
    var deps = PRE[group] || [];
    var chain = Promise.resolve();
    for (var d = 0; d < deps.length; d++) {
      (function (dep) {
        chain = chain.then(function () { return needShared(dep); });
      })(deps[d]);
    }
    var list = GROUPS[group];
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        chain = chain.then(function () { return loadOne(item[0], item[1]); });
      })(list[i]);
    }
    return chain;
  }

  function dueOf(group, seen) {
    if (seen[group]) return deadlines[group] || (Date.now() + CALL_MS);
    seen[group] = true;
    if (!deadlines[group]) deadlines[group] = Date.now() + CALL_MS;
    var due = deadlines[group];
    var deps = PRE[group] || [];
    for (var i = 0; i < deps.length; i++) {
      var dep = deps[i];
      if (settled[dep] === 'ok' || !pending[dep]) continue;
      var d = dueOf(dep, seen);
      if (d < due) due = d;
    }
    return due;
  }

  function boundCaller(group, p) {
    if (settled[group] === 'ok') return Promise.resolve();
    if (settled[group] && settled[group] !== 'ok') return Promise.reject(settled[group]);
    var left = dueOf(group, {}) - Date.now();
    if (left <= 0) return Promise.reject(new Error(group));
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(v) {
        if (done) return;
        done = true;
        delete deadlines[group];
        resolve(v);
      }
      function bad(e) {
        if (done) return;
        done = true;
        reject(e);
      }
      p.then(ok, bad);
      clockJobs.push({ due: Date.now() + left, fn: function () { bad(new Error(group)); } });
    });
  }

  function crmNeed(group, opts) {
    if (!GROUPS[group]) return Promise.resolve();
    if (opts && opts.fresh) clearFailed(group);
    return boundCaller(group, needShared(group));
  }

  function crmGroupsFor(raw) {
    var list = GOTO[raw];
    return list ? list.slice() : [];
  }

  /* אחרי שהמסך הראשון מצויר. לא לפני: הורדה ופענוח של עשרות קבצים על
     קו איטי היו דוחים את מסך הכניסה. קבוצה שנכשלת לא עוצרת את השאר. */
  function crmArmSections() {
    if (crmArmSections.armed) return;
    crmArmSections.armed = true;
    var start = function () {
      Object.keys(GROUPS).forEach(function (g) {
        crmNeed(g).catch(function () {});
      });
    };
    var idle = global.requestIdleCallback || function (fn) { global.setTimeout(fn, 400); };
    global.requestAnimationFrame(function () {
      idle(start, { timeout: 1500 });
    });
  }

  global.crmNeed = crmNeed;
  global.crmGroupsFor = crmGroupsFor;
  global.crmArmSections = crmArmSections;
})(window);
