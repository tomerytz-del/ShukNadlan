/* ============================================================================
   אזור הלמידה של קורס ההכנה למבחן המתווכים (learn.html)
   ----------------------------------------------------------------------------
   מכונת מצבים אחת: boot -> login -> pay -> player. כל המידע מגיע מהמסד:

     course_me()              מצב הלומד/ת: גישה, התקדמות, סימולציות
     course_catalog()         פרקים ושיעורים (שמות וספירות, לכולם)
     course_lessons           גוף השיעור, דרך RLS (חינמי לכולם, השאר לרשומים)
     course_lesson_open()     רישום פתיחה
     course_attempt_start()   שאלות בלי תשובות - חידון, סימולציה או חזרה
     course_answer()          בדיקה במסד, והסבר בחזרה (לא בסימולציה)
     course_attempt_finish()  ציון, סקירה, וסימון השיעור כהושלם

   **התשובות הנכונות לעולם אינן בדפדפן לפני המענה.** הבדיקה היא במסד, ולכן
   הציון שנרשם הוא אמיתי. גוף השיעור (body_html) נכתב בידינו ונכנס
   ל-innerHTML כמו שהוא; כל טקסט אחר מהמסד עובר escapeHtml (assets/esc.js).

   התיעוד: docs/exam-course.md.
   ============================================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var PURCHASE_URL = SUPABASE_URL + '/functions/v1/course-purchase';
  var MENTOR = '/assets/mentor-avatar.webp';
  var LETTERS = ['א', 'ב', 'ג', 'ד'];

  var PRAISE = [
    'בדיוק. ככה חושבים על זה.',
    'נכון. שמתם לב למילה שהכריעה?',
    'יפה. זו שאלה שהרבה נופלים בה.',
    'נכון מאוד. הסעיף הזה יחזור בבחינה.',
    'מצוין. ממשיכים.'
  ];
  var CONSOLE = [
    'לא נורא. דווקא הטעויות האלה הן מה שנזכור בבחינה.',
    'קרוב, אבל לא. קראו את ההסבר, הוא קצר.',
    'זו המלכודת הקלאסית של השאלה הזו. עכשיו כבר לא תיפלו בה.',
    'לא הפעם. שימו לב למה החלופה שבחרתם נשמעה הגיונית, ולמה היא בכל זאת שגויה.'
  ];

  function $(id) { return document.getElementById(id); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function show(id) {
    ['screenBoot', 'screenLogin', 'screenPay', 'screenPlayer'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
    window.scrollTo(0, 0);
  }
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
    var d = new Date(iso);
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  if (!window.supabase) {
    $('bootMsg').textContent = 'לא הצלחנו לטעון את הקורס. כדאי לרענן את הדף.';
    return;
  }
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var state = {
    user: null,
    me: null,
    catalog: null,
    lessons: {},        // id -> {chapter, lesson}
    currentLesson: null,
    attempt: null,      // {id, kind, questions, idx, answers:{qid:{choice, ok}}, lessonId, startedAt}
    pollTimer: null
  };

  /* ---------------------------------------------------------------- כניסה */
  function cleanAuthParams() {
    var url = new URL(window.location.href);
    var changed = false;
    ['access_token', 'refresh_token', 'expires_in', 'token_type', 'type', 'code', 'error', 'error_code', 'error_description', 'provider_token', 'provider_refresh_token'].forEach(function (k) {
      if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
    });
    if (changed || window.location.hash) {
      history.replaceState(null, '', url.pathname + (url.search || '') );
    }
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

  $('googleBtn').addEventListener('click', async function () {
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

  $('logoutBtn').addEventListener('click', async function () {
    await sb.auth.signOut();
    window.location.href = '/course';
  });

  /* --------------------------------------------------------------- טעינה */
  async function loadAll() {
    var r = await Promise.all([sb.rpc('course_me'), sb.rpc('course_catalog')]);
    if (r[0].error) throw r[0].error;
    if (r[1].error) throw r[1].error;
    state.me = r[0].data || {};
    state.catalog = r[1].data || { chapters: [] };
    state.lessons = {};
    (state.catalog.chapters || []).forEach(function (ch) {
      (ch.lessons || []).forEach(function (l) { state.lessons[l.id] = { chapter: ch, lesson: l }; });
    });
  }

  async function refreshMe() {
    var r = await sb.rpc('course_me');
    if (!r.error && r.data) { state.me = r.data; renderTop(); renderSidebar(); }
  }

  function progressOf(lessonId) {
    var p = (state.me && state.me.progress) || [];
    for (var i = 0; i < p.length; i++) if (p[i].lesson_id === lessonId) return p[i];
    return null;
  }

  function renderTop() {
    var me = state.me || {};
    $('courseProg').classList.remove('hidden');
    var total = me.lessons_total || 0, done = me.lessons_done || 0;
    $('courseBar').style.width = (total ? Math.round(100 * done / total) : 0) + '%';
    $('courseTxt').textContent = done + '/' + total + ' שיעורים';
    $('userChip').classList.remove('hidden');
    var av = $('userAv');
    var pic = state.user && state.user.user_metadata && state.user.user_metadata.avatar_url;
    var name = (state.user && (state.user.user_metadata && state.user.user_metadata.full_name || state.user.email)) || '';
    if (pic) av.innerHTML = '<img src="' + escapeHtml(pic) + '" alt="" referrerpolicy="no-referrer">';
    else av.textContent = (name || '?').trim().charAt(0).toUpperCase();
    av.title = name;
  }

  /* -------------------------------------------------------------- הרכישה */
  async function showPay(opts) {
    opts = opts || {};
    show('screenPay');
    $('payErr').textContent = '';
    $('payVerify').classList.add('hidden');
    $('payForm').classList.remove('hidden');
    if (state.me && state.me.expired) {
      $('payTitle').textContent = 'הגישה לקורס הסתיימה';
      $('payLead').textContent = 'תקופת הגישה נגמרה ב-' + fmtDate(state.me.expires_at) + '. רכישה נוספת פותחת שישה חודשים חדשים, וההתקדמות שלכם נשמרה.';
      $('payBubble').innerHTML = '<b>המנטור</b>טוב לראות אתכם שוב. ההתקדמות שלכם כאן, ממשיכים מאיפה שעצרנו.';
    }
    var name = state.user && state.user.user_metadata && state.user.user_metadata.full_name;
    if (name && !$('payName').value) $('payName').value = name;
    try {
      var res = await fetch(PURCHASE_URL, { headers: await authHeaders() });
      var info = await res.json();
      if (res.ok) {
        $('payAmount').textContent = info.amount;
        $('payMonths').textContent = info.months;
        $('testEnrollBtn').classList.toggle('hidden', !info.can_test);
        if (!info.configured) $('payErr').textContent = 'הסליקה אינה זמינה כרגע. אפשר להתחיל מהשיעור החינמי ולנסות שוב מאוחר יותר.';
      }
    } catch (e) { /* המחיר שבדף הוא ברירת המחדל */ }
    if (opts.verify) verifyOrder();
  }

  async function authHeaders() {
    var s = await sb.auth.getSession();
    var token = s.data && s.data.session && s.data.session.access_token;
    return { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token };
  }

  $('payForm').addEventListener('submit', async function (ev) {
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
    } catch (e) {
      $('payErr').textContent = errText(e);
    }
    btn.disabled = false; btn.textContent = 'לתשלום מאובטח';
  });

  $('testEnrollBtn').addEventListener('click', async function () {
    try {
      var res = await fetch(PURCHASE_URL, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ test_mode: true }) });
      var data = await res.json();
      if (!res.ok) throw data;
      toast('נפתחה גישה לבדיקה');
      await loadAll();
      enterPlayer();
    } catch (e) { $('payErr').textContent = errText(e); }
  });

  $('freeLessonBtn').addEventListener('click', function () {
    enterPlayer();
  });

  /* אחרי חזרה ממורנינג: ה-webhook עשוי להגיע כמה שניות אחרי הגולש/ת.
     שואלים את המסד כל 3 שניות, עד דקתיים. */
  function verifyOrder() {
    $('payVerify').classList.remove('hidden');
    $('payForm').classList.add('hidden');
    var tries = 0;
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async function () {
      tries++;
      var r = await sb.rpc('course_me');
      if (!r.error && r.data) {
        state.me = r.data;
        if (state.me.enrolled) {
          clearInterval(state.pollTimer);
          toast('התשלום אושר. ברוכים הבאים לקורס!');
          enterPlayer();
          return;
        }
        if (!state.me.pending_order || tries > 40) {
          clearInterval(state.pollTimer);
          $('payVerify').classList.add('hidden');
          $('payForm').classList.remove('hidden');
          $('payErr').textContent = state.me.pending_order
            ? 'התשלום עדיין באימות. אם חויבתם, הגישה תיפתח אוטומטית בדקות הקרובות; אפשר לרענן את הדף.'
            : 'התשלום לא הושלם. אפשר לנסות שוב.';
        }
      }
    }, 3000);
  }

  /* --------------------------------------------------------------- הנגן */
  function enterPlayer() {
    show('screenPlayer');
    $('menuBtn').classList.remove('hidden');
    renderTop();
    renderSidebar();
    var open = firstOpenLesson();
    if (open) openLesson(open); else renderWelcome();
  }

  function enrolled() { return !!(state.me && state.me.enrolled); }
  function lessonAvailable(l) { return l.is_free || enrolled(); }

  function firstOpenLesson() {
    var chapters = state.catalog.chapters || [];
    var fallback = null;
    for (var i = 0; i < chapters.length; i++) {
      var ls = chapters[i].lessons || [];
      for (var j = 0; j < ls.length; j++) {
        if (!lessonAvailable(ls[j])) continue;
        if (!fallback) fallback = ls[j].id;
        var p = progressOf(ls[j].id);
        if (!p || !p.completed_at) return ls[j].id;
      }
    }
    return fallback;
  }

  function renderSidebar() {
    var box = $('chapters');
    var chapters = state.catalog.chapters || [];
    box.innerHTML = chapters.map(function (ch, i) {
      var ls = ch.lessons || [];
      var done = ls.filter(function (l) { var p = progressOf(l.id); return p && p.completed_at; }).length;
      var hasCurrent = ls.some(function (l) { return l.id === state.currentLesson; });
      return '<div class="chap' + (hasCurrent || i === 0 ? '' : ' closed') + '" data-ch="' + escapeHtml(ch.slug) + '">' +
        '<div class="chap-h"><span class="n">' + (i + 1) + '</span><span>' + escapeHtml(ch.title) + '</span><span class="cnt">' + done + '/' + ls.length + '</span></div>' +
        ls.map(function (l) {
          var p = progressOf(l.id);
          var cls = 'lsn' + (p && p.completed_at ? ' done' : '') + (lessonAvailable(l) ? '' : ' locked') + (l.id === state.currentLesson ? ' active' : '');
          var st = p && p.completed_at ? '✓' : (lessonAvailable(l) ? '' : '🔒');
          return '<button type="button" class="' + cls + '" data-lesson="' + escapeHtml(l.id) + '"><span class="st">' + st + '</span><span>' + escapeHtml(l.title) + '</span></button>';
        }).join('') + '</div>';
    }).join('');
    box.querySelectorAll('.chap-h').forEach(function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('closed'); });
    });
    box.querySelectorAll('.lsn').forEach(function (b) {
      b.addEventListener('click', function () { openLesson(b.getAttribute('data-lesson')); closeMenu(); });
    });
    var exams = (state.me && state.me.exams) || [];
    $('examSub').textContent = exams.length
      ? 'הציון האחרון: ' + Math.round(100 * exams[0].correct / exams[0].total) + ' · ' + exams.length + ' סימולציות'
      : (state.me && state.me.exam_questions || 25) + ' שאלות, כמו בבחינה';
  }

  function renderWelcome() {
    $('stage').innerHTML = '<div class="lesson"><div class="mentor-row"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>בחרו שיעור מהרשימה ונתחיל.</div></div></div>';
  }

  function lockedView(entry) {
    $('stage').innerHTML = '<div class="lesson"><h1>' + escapeHtml(entry.lesson.title) + '</h1>' +
      '<div class="mentor-row"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>השיעור הזה נפתח עם הגישה המלאה. הרכישה היא תשלום אחד לשישה חודשים, וכל מה שכבר למדתם נשמר.</div></div>' +
      '<div class="locknote">גישה מלאה לקורס: כל השיעורים, מבחני העבר, הסימולציות וחזרה על טעויות.</div>' +
      '<div class="quiz-cta"><button type="button" class="btn-primary" id="goPay">לפתיחת הקורס המלא</button></div></div>';
    $('goPay').addEventListener('click', function () { showPay(); });
  }

  async function openLesson(id) {
    var entry = state.lessons[id];
    if (!entry) return;
    if (state.currentLesson !== id) openLesson._fullText = false;
    state.currentLesson = id;
    state.attempt = null;
    state.steps = null;
    renderSidebar();
    if (!lessonAvailable(entry.lesson)) { lockedView(entry); return; }

    $('stage').innerHTML = '<div class="lesson"><div class="spinner"></div></div>';
    var r = await Promise.all([
      // ‏select('*') ולא רשימת עמודות: האתר עולה לפני המיגרציה (הסקיל deploy-path),
      // ובדקות שבהן העמודה steps עוד לא קיימת השיעור נפתח במצב הטקסט במקום להיכשל.
      sb.from('course_lessons').select('*').eq('id', id).maybeSingle(),
      sb.rpc('course_lesson_open', { p_lesson_id: id })
    ]);
    var lesson = r[0].data;
    if (r[0].error || !lesson) {
      $('stage').innerHTML = '<div class="lesson"><p>' + escapeHtml(r[0].error ? errText(r[0].error) : 'השיעור אינו זמין.') + '</p></div>';
      return;
    }
    var qn = (r[1].data && r[1].data.questions) || entry.lesson.questions || 0;
    var p = progressOf(id);
    // שיעור עם צעדים: מסך אחד לכל רעיון (docs/exam-course.md, "צעדים").
    // ‏?full=1 או הקישור "הטקסט המלא" מציגים את הגרסה הטקסטואלית.
    if (Array.isArray(lesson.steps) && lesson.steps.length && !openLesson._fullText) {
      renderSteps(lesson, entry, p);
      return;
    }
    openLesson._fullText = false;
    var pct = lessonPct(p, false, qn);

    var video = '';
    if (lesson.video_url) {
      var u = String(lesson.video_url);
      if (/youtube\.com|youtu\.be/.test(u)) {
        var m = u.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
        if (m) video = '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + escapeHtml(m[1]) + '" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" title="סרטון השיעור"></iframe></div>';
      } else if (/^https:\/\//.test(u)) {
        video = '<div class="video"><video controls preload="metadata" src="' + escapeHtml(u) + '"></video></div>';
      }
    }
    var kp = Array.isArray(lesson.key_points) ? lesson.key_points : [];

    $('stage').innerHTML = '<div class="lesson">' +
      '<div class="lprog"><span>התקדמות בשיעור</span><div class="bar"><i id="lessonBar" style="width:' + pct + '%"></i></div><b id="lessonPct">' + pct + '%</b></div>' +
      '<h1>' + escapeHtml(lesson.title) + '</h1>' +
      (lesson.source_ref ? '<span class="chip">' + escapeHtml(lesson.source_ref) + '</span>' : '') +
      (lesson.intro ? '<div class="mentor-row"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>' + escapeHtml(lesson.intro) + '</div></div>' : '') +
      video +
      '<div class="body">' + (lesson.body_html || '') + '</div>' +
      (kp.length ? '<div class="keypts" id="keypts"><h3>נקודות המפתח</h3><ul>' + kp.map(function (k) { return '<li>' + escapeHtml(k) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="quiz-cta" id="quizCta">' +
        (qn ? '<button type="button" class="btn-primary" id="startQuiz">' + (p && p.completed_at ? 'לחידון שוב' : 'לחידון השיעור') + ' (' + qn + ' שאלות)</button>' : '') +
        '<button type="button" class="btn-secondary" id="nextLesson">לשיעור הבא</button>' +
        (p && p.best_score != null ? '<span style="font-size:13px;color:var(--ink-muted)">הציון הטוב ביותר: ' + p.best_score + '</span>' : '') +
      '</div></div>';

    // קריאה עד הסוף מעלה את המד - נמדד לפי נקודות המפתח שנכנסות למסך
    var target = $('keypts') || $('quizCta');
    if (target && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting) { io.disconnect(); setLessonPct(lessonPct(progressOf(id), true, qn)); }
      }, { threshold: 0.3 });
      io.observe(target);
    }
    var sq = $('startQuiz');
    if (sq) sq.addEventListener('click', function () { startAttempt('quiz', id); });
    $('nextLesson').addEventListener('click', function () { var n = nextLessonId(id); if (n) openLesson(n); else toast('זה היה השיעור האחרון. כל הכבוד!'); });
  }

  /* ------------------------------------------------------------- צעדים */
  // שיעור כרצף: concept / example / check מהתוכן, ואחריהם כרטיסי זיכרון
  // מנקודות המפתח וסיום. בדיקה מהירה פותחת ניסיון quiz בפעם הראשונה,
  // עונה דרך course_answer, ובסיום course_attempt_finish מסמן את השיעור.
  var STEP_PRAISE = ['יפה.', 'בדיוק.', 'נכון.', 'מצוין.'];

  function renderSteps(lesson, entry, p) {
    var authored = lesson.steps.slice();
    var kp = Array.isArray(lesson.key_points) ? lesson.key_points : [];
    var steps = [{ type: 'intro' }].concat(authored)
      .concat(kp.map(function (k) { return { type: 'flash', text: k }; }))
      .concat([{ type: 'done' }]);
    state.steps = { lesson: lesson, entry: entry, steps: steps, idx: 0, attempt: null, qmap: {}, answers: {}, flipped: false, lawOpen: false };
    renderStep();
  }

  function stepsNav(prevOk, nextLabel, nextId) {
    return '<div class="snav">' +
      '<button type="button" class="btn-secondary" id="stepPrev"' + (prevOk ? '' : ' disabled') + '>הקודם</button>' +
      '<button type="button" class="btn-primary" id="' + (nextId || 'stepNext') + '">' + escapeHtml(nextLabel || 'הבא') + '</button></div>';
  }

  function renderStep() {
    var S = state.steps;
    if (!S) return;
    var st = S.steps[S.idx];
    var total = S.steps.length;
    var pct = Math.round(100 * S.idx / (total - 1));
    var head = '<div class="lprog"><span>' + escapeHtml(S.lesson.title) + '</span><div class="bar"><i style="width:' + pct + '%"></i></div><b>' + (S.idx + 1) + '/' + total + '</b></div>';
    var html = '';
    S.flipped = false; S.lawOpen = false;

    if (st.type === 'intro') {
      html = '<div class="scard intro"><div class="mentor-row"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>' + escapeHtml(S.lesson.intro || 'מתחילים.') + '</div></div>' +
        '<h1>' + escapeHtml(S.lesson.title) + '</h1>' +
        (S.lesson.source_ref ? '<span class="chip">' + escapeHtml(S.lesson.source_ref) + '</span>' : '') +
        '<p class="smeta">' + (total - 2) + ' צעדים קצרים, ובדיקה מהירה אחרי כל רעיון.</p>' +
        stepsNav(false, 'מתחילים') +
        '<button type="button" class="link-btn" id="fullText" style="margin-top:14px">לטקסט המלא של השיעור</button></div>';
    } else if (st.type === 'concept') {
      html = '<div class="scard"><div class="sicon">' + escapeHtml(st.icon || '💡') + '</div><h2>' + escapeHtml(st.title) + '</h2><p>' + escapeHtml(st.text) + '</p>' + stepsNav(true) + '</div>';
    } else if (st.type === 'example') {
      html = '<div class="scard example"><div class="stag">סיפור מקרה</div><h2>' + escapeHtml(st.title) + '</h2><p class="case">' + escapeHtml(st.text) + '</p>' +
        '<button type="button" class="law-toggle" id="lawToggle">מה אומר החוק? ▾</button><div class="law hidden" id="lawBox">' + escapeHtml(st.law || '') + '</div>' +
        stepsNav(true) + '</div>';
    } else if (st.type === 'check') {
      var q = S.qmap[st.question];
      if (!q) { html = '<div class="scard"><div class="spinner"></div></div>'; ensureAttempt().then(function (ok) { if (ok) renderStep(); }); }
      else {
        var ans = S.answers[q.id];
        html = '<div class="scard check"><div class="stag">בדיקה מהירה</div><p class="qtext">' + escapeHtml(q.question) + '</p><div class="opts">' +
          (q.options || []).map(function (o, i) {
            var cls = 'opt';
            if (ans) {
              if (ans.ok && ans.choice === i) cls += ' right';
              else if (!ans.ok && ans.choice === i) cls += ' wrong';
              else if (ans.correct === i || (ans.accepted || []).indexOf(i) >= 0) cls += ' right';
            }
            return '<button type="button" class="' + cls + '" data-i="' + i + '"' + (ans ? ' disabled' : '') + '><span class="l">' + LETTERS[i] + '</span><span>' + escapeHtml(o) + '</span></button>';
          }).join('') + '</div><div id="fb"></div>' +
          (ans ? stepsNav(true) : '<div class="snav"><button type="button" class="btn-secondary" id="stepPrev">הקודם</button></div>') + '</div>';
      }
    } else if (st.type === 'flash') {
      html = '<div class="scard"><div class="stag">כרטיס זיכרון</div><div class="flash" id="flash"><div class="face front"><span>לזכור:</span><b>' + escapeHtml(st.text.split(/[.:]/)[0]) + '</b><small>לחיצה הופכת את הכרטיס</small></div><div class="face back"><p>' + escapeHtml(st.text) + '</p></div></div>' + stepsNav(true) + '</div>';
    } else if (st.type === 'done') {
      var n = Object.keys(S.answers).length;
      var ok = Object.keys(S.answers).filter(function (k) { return S.answers[k].ok; }).length;
      html = '<div class="scard"><div class="sicon">🏁</div><h2>סיימתם את הצעדים</h2><p>' + (n ? ok + ' מתוך ' + n + ' בדיקות מהירות נכונות. ' : '') + 'לחיצה על "סיום השיעור" רושמת את הציון ומסמנת את השיעור.</p>' +
        '<div class="snav"><button type="button" class="btn-secondary" id="stepPrev">הקודם</button><button type="button" class="btn-primary" id="stepFinish">סיום השיעור</button></div></div>';
    }

    $('stage').innerHTML = '<div class="lesson steps">' + head + html + '</div>';

    var prev = $('stepPrev'); if (prev) prev.addEventListener('click', function () { if (S.idx > 0) { S.idx--; renderStep(); } });
    var next = $('stepNext'); if (next) next.addEventListener('click', function () { if (S.idx < total - 1) { S.idx++; renderStep(); } });
    var ft = $('fullText'); if (ft) ft.addEventListener('click', function () { openLesson._fullText = true; openLesson(S.lesson.id); });
    var lt = $('lawToggle'); if (lt) lt.addEventListener('click', function () { $('lawBox').classList.toggle('hidden'); lt.textContent = $('lawBox').classList.contains('hidden') ? 'מה אומר החוק? ▾' : 'מה אומר החוק? ▴'; });
    var fl = $('flash'); if (fl) fl.addEventListener('click', function () { fl.classList.toggle('flipped'); });
    var fin = $('stepFinish'); if (fin) fin.addEventListener('click', finishSteps);
    if (st.type === 'check' && S.qmap[st.question]) {
      var q2 = S.qmap[st.question];
      $('stage').querySelectorAll('.opt').forEach(function (b) {
        b.addEventListener('click', function () { answerStep(q2, Number(b.getAttribute('data-i'))); });
      });
      if (S.answers[q2.id]) showFeedback(S.answers[q2.id]);
    }
    window.scrollTo(0, 0);
  }

  async function ensureAttempt() {
    var S = state.steps;
    if (!S) return false;
    if (S.attempt) return true;
    if (S.loading) return false;
    S.loading = true;
    var r = await sb.rpc('course_attempt_start', { p_kind: 'quiz', p_lesson_id: S.lesson.id });
    S.loading = false;
    if (r.error || !r.data || r.data.error) {
      var code = r.error ? errText(r.error) : (r.data && r.data.error);
      if (code === 'course_not_enrolled') { showPay(); return false; }
      toast(errText(r.error || { message: code }));
      return false;
    }
    S.attempt = r.data.attempt_id;
    (r.data.questions || []).forEach(function (q) { S.qmap[q.slug] = q; });
    return true;
  }

  async function answerStep(q, choice) {
    var S = state.steps;
    if (!S || S.answers[q.id]) return;
    $('stage').querySelectorAll('.opt').forEach(function (b) { b.disabled = true; });
    var r = await sb.rpc('course_answer', { p_attempt_id: S.attempt, p_question_id: q.id, p_choice: choice });
    if (r.error || !r.data || r.data.error) {
      toast(errText(r.error || { message: r.data && r.data.error }));
      $('stage').querySelectorAll('.opt').forEach(function (b) { b.disabled = false; });
      return;
    }
    S.answers[q.id] = { choice: choice, ok: r.data.ok, correct: r.data.correct, accepted: r.data.accepted || [], explanation: r.data.explanation, law_ref: r.data.law_ref };
    renderStep();
  }

  async function finishSteps() {
    var S = state.steps;
    if (!S) return;
    if (!S.attempt) {
      // שיעור בלי בדיקות: הפתיחה כבר סימנה אותו. רק מרעננים.
      await refreshMe();
      toast('השיעור הושלם');
      var n0 = nextLessonId(S.lesson.id);
      if (n0) openLesson(n0); else openLesson(S.lesson.id);
      return;
    }
    $('stage').innerHTML = '<div class="lesson"><div class="spinner"></div></div>';
    var r = await sb.rpc('course_attempt_finish', { p_attempt_id: S.attempt });
    if (r.error || !r.data || r.data.error) {
      $('stage').innerHTML = '<div class="lesson"><p>' + escapeHtml(errText(r.error || { message: r.data && r.data.error })) + '</p></div>';
      return;
    }
    var pseudo = { kind: 'quiz', lessonId: S.lesson.id, startedAt: Date.now() };
    state.steps = null;
    await refreshMe();
    renderResult(r.data, pseudo);
  }

  function lessonPct(p, read, qn) {
    var v = 0;
    if (p) v += 20;
    if (read) v += (qn ? 30 : 80);
    if (p && p.completed_at) v = 100;
    return Math.min(100, v);
  }
  function setLessonPct(v) {
    var b = $('lessonBar'), t = $('lessonPct');
    if (b) b.style.width = v + '%';
    if (t) t.textContent = v + '%';
  }
  function nextLessonId(id) {
    var flat = [];
    (state.catalog.chapters || []).forEach(function (ch) { (ch.lessons || []).forEach(function (l) { flat.push(l); }); });
    for (var i = 0; i < flat.length; i++) if (flat[i].id === id) {
      for (var j = i + 1; j < flat.length; j++) if (lessonAvailable(flat[j])) return flat[j].id;
      return null;
    }
    return null;
  }

  /* ------------------------------------------------------------- ניסיונות */
  async function startAttempt(kind, lessonId) {
    if (kind !== 'quiz' && !enrolled()) { showPay(); return; }
    $('stage').innerHTML = '<div class="lesson"><div class="spinner"></div></div>';
    var r = await sb.rpc('course_attempt_start', { p_kind: kind, p_lesson_id: lessonId || null });
    if (r.error || !r.data || r.data.error) {
      var code = r.error ? errText(r.error) : (r.data && r.data.error);
      if (code === 'course_not_enrolled') { showPay(); return; }
      $('stage').innerHTML = '<div class="lesson"><p>' + escapeHtml(errText(r.error || { message: code })) + '</p></div>';
      return;
    }
    var qs = r.data.questions || [];
    if (!qs.length) {
      if (kind === 'review') {
        $('stage').innerHTML = '<div class="lesson"><div class="mentor-row"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>אין שאלות לחזרה: כל מה שטעיתם בו כבר תוקן. זה הזמן לסימולציה.</div></div></div>';
      } else {
        $('stage').innerHTML = '<div class="lesson"><p>אין עדיין שאלות כאן.</p></div>';
      }
      return;
    }
    state.currentLesson = kind === 'quiz' ? lessonId : null;
    state.attempt = { id: r.data.attempt_id, kind: kind, questions: qs, idx: 0, answers: {}, lessonId: lessonId, startedAt: Date.now() };
    renderSidebar();
    renderQuestion();
    if (kind === 'exam') startTimer();
  }

  function startTimer() {
    clearInterval(startTimer._t);
    startTimer._t = setInterval(function () {
      var el = $('timer');
      if (!el || !state.attempt) { clearInterval(startTimer._t); return; }
      var s = Math.floor((Date.now() - state.attempt.startedAt) / 1000);
      el.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    }, 1000);
  }

  function renderQuestion() {
    var a = state.attempt;
    var q = a.questions[a.idx];
    var ans = a.answers[q.id];
    var title = a.kind === 'exam' ? 'מבחן סימולציה' : (a.kind === 'review' ? 'חזרה על טעויות' : 'חידון השיעור');
    var answered = Object.keys(a.answers).length;
    if (a.kind === 'quiz') setLessonPct(Math.min(99, 50 + Math.round(49 * answered / a.questions.length)));

    var html = '<div class="qhead"><span>' + title + ' · שאלה ' + (a.idx + 1) + ' מתוך ' + a.questions.length + '</span>' +
      (a.kind === 'exam' ? '<span class="timer" id="timer">0:00</span>' : '<span>' + answered + ' נענו</span>') + '</div>' +
      '<div class="qcard">' +
      (q.source ? '<div class="qsrc">' + escapeHtml(q.source) + '</div>' : '') +
      '<p class="qtext">' + escapeHtml(q.question) + '</p>' +
      '<div class="opts">' + (q.options || []).map(function (o, i) {
        var cls = 'opt';
        if (ans) {
          if (a.kind === 'exam') { if (ans.choice === i) cls += ' chosen'; }
          else {
            if (ans.ok && ans.choice === i) cls += ' right';
            else if (!ans.ok && ans.choice === i) cls += ' wrong';
            else if (ans.correct === i || (ans.accepted || []).indexOf(i) >= 0) cls += ' right';
          }
        }
        return '<button type="button" class="' + cls + '" data-i="' + i + '"' + (ans ? ' disabled' : '') + '><span class="l">' + LETTERS[i] + '</span><span>' + escapeHtml(o) + '</span></button>';
      }).join('') + '</div>' +
      '<div id="fb"></div>' +
      '</div>' +
      '<div class="dots">' + a.questions.map(function (qq, i) { return '<i class="' + (a.answers[qq.id] ? 'a' : '') + (i === a.idx ? ' cur' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="qnav">' +
        '<button type="button" class="btn-secondary" id="prevQ"' + (a.idx === 0 ? ' disabled' : '') + '>הקודמת</button>' +
        (a.idx < a.questions.length - 1
          ? '<button type="button" class="btn-primary" id="nextQ">' + (ans ? 'הבאה' : 'דלג') + '</button>'
          : '<button type="button" class="btn-primary" id="finishQ">סיום ' + (a.kind === 'exam' ? 'המבחן' : 'החידון') + '</button>') +
      '</div>';
    $('stage').innerHTML = html;
    if (ans && a.kind !== 'exam') showFeedback(ans);

    $('stage').querySelectorAll('.opt').forEach(function (b) {
      b.addEventListener('click', function () { answer(q, Number(b.getAttribute('data-i'))); });
    });
    $('prevQ').addEventListener('click', function () { a.idx--; renderQuestion(); });
    var nq = $('nextQ');
    if (nq) nq.addEventListener('click', function () { a.idx++; renderQuestion(); });
    var fq = $('finishQ');
    if (fq) fq.addEventListener('click', finishAttempt);
    if (a.kind === 'exam') startTimer();
  }

  async function answer(q, choice) {
    var a = state.attempt;
    if (a.answers[q.id]) return;
    $('stage').querySelectorAll('.opt').forEach(function (b) { b.disabled = true; });
    var r = await sb.rpc('course_answer', { p_attempt_id: a.id, p_question_id: q.id, p_choice: choice });
    if (r.error || !r.data || r.data.error) {
      toast(errText(r.error || { message: r.data && r.data.error }));
      $('stage').querySelectorAll('.opt').forEach(function (b) { b.disabled = false; });
      return;
    }
    a.answers[q.id] = { choice: choice, ok: r.data.ok, correct: r.data.correct, accepted: r.data.accepted || [], explanation: r.data.explanation, law_ref: r.data.law_ref };
    renderQuestion();
    if (a.kind === 'exam' && a.idx < a.questions.length - 1) {
      setTimeout(function () { if (state.attempt === a && a.idx < a.questions.length - 1) { a.idx++; renderQuestion(); } }, 350);
    }
  }

  function showFeedback(ans) {
    var fb = $('fb');
    if (!fb) return;
    fb.innerHTML = '<div class="feedback ' + (ans.ok ? 'ok' : 'bad') + '"><img src="' + MENTOR + '" alt=""><div class="fb"><b>' +
      escapeHtml(ans.ok ? pick(PRAISE) : pick(CONSOLE)) + '</b>' +
      (ans.ok ? '' : '<span>התשובה הנכונה: ' + LETTERS[ans.correct] + '.</span> ') +
      escapeHtml(ans.explanation || '') +
      (ans.law_ref ? '<span class="ref">📖 ' + escapeHtml(ans.law_ref) + '</span>' : '') +
      '</div></div>';
    fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function finishAttempt() {
    var a = state.attempt;
    if (!a) return;
    var left = a.questions.length - Object.keys(a.answers).length;
    if (left > 0 && !window.confirm('נשארו ' + left + ' שאלות בלי תשובה. הן ייספרו כשגויות. לסיים בכל זאת?')) return;
    clearInterval(startTimer._t);
    $('stage').innerHTML = '<div class="lesson"><div class="spinner"></div></div>';
    var r = await sb.rpc('course_attempt_finish', { p_attempt_id: a.id });
    if (r.error || !r.data || r.data.error) {
      $('stage').innerHTML = '<div class="lesson"><p>' + escapeHtml(errText(r.error || { message: r.data && r.data.error })) + '</p></div>';
      return;
    }
    var res = r.data;
    state.attempt = null;
    await refreshMe();
    renderResult(res, a);
  }

  function renderResult(res, a) {
    var pass = res.passed;
    var kindTitle = a.kind === 'exam' ? 'תוצאת הסימולציה' : (a.kind === 'review' ? 'סיימתם את החזרה' : 'תוצאת החידון');
    var msg;
    if (a.kind === 'exam') {
      msg = pass ? 'עברתם! ' + res.correct + ' מתוך ' + res.total + ' נכונות. בבחינה האמיתית זה ציון ' + (res.correct * 4) + '.'
                 : res.correct + ' מתוך ' + res.total + ' נכונות. צריך ' + Math.ceil(res.total * res.pass_pct / 100) + ' כדי לעבור. עברו על ההסברים למטה, ואז "חזרה על טעויות".';
    } else {
      msg = pass ? 'השיעור הושלם. ' + res.correct + ' מתוך ' + res.total + ' נכונות.'
                 : res.correct + ' מתוך ' + res.total + ' נכונות. השיעור יסומן כהושלם כשתעברו את החידון בציון ' + res.pass_pct + '. אפשר לנסות שוב מיד.';
    }
    var mins = Math.round((Date.now() - a.startedAt) / 60000);
    var review = (res.review || []).map(function (q, i) {
      return '<div class="qcard"><div class="qsrc">' + (i + 1) + (q.source ? ' · ' + escapeHtml(q.source) : '') + '</div><p class="qtext">' + escapeHtml(q.question) + '</p>' +
        '<div class="opts">' + (q.options || []).map(function (o, j) {
          var cls = 'opt';
          var isRight = j === q.correct || (q.accepted || []).indexOf(j) >= 0;
          if (isRight) cls += ' right';
          else if (q.choice === j) cls += ' wrong';
          return '<div class="' + cls + '"><span class="l">' + LETTERS[j] + '</span><span>' + escapeHtml(o) + '</span></div>';
        }).join('') + '</div>' +
        '<details' + (q.ok ? '' : ' open') + '><summary>' + (q.ok ? 'נכון. ההסבר' : (q.choice == null ? 'לא נענתה. ההסבר' : 'שגוי. ההסבר')) + '</summary>' +
        escapeHtml(q.explanation || '') + (q.law_ref ? '<span class="ref" style="display:block;font-size:12.5px;color:var(--ink-muted);margin-top:6px">📖 ' + escapeHtml(q.law_ref) + '</span>' : '') + '</details></div>';
    }).join('');

    $('stage').innerHTML = '<div class="result' + (pass ? ' pass' : '') + '">' +
      '<div class="gauge" style="--p:' + res.pct + '%"><b>' + res.pct + '<small>%</small></b></div>' +
      '<h2>' + kindTitle + '</h2><p>' + escapeHtml(msg) + (a.kind === 'exam' ? ' זמן: ' + mins + ' דקות.' : '') + '</p>' +
      '<div class="mentor-row" style="text-align:start"><img src="' + MENTOR + '" alt=""><div class="bubble"><b>המנטור</b>' +
        escapeHtml(pass ? (a.kind === 'exam' ? 'ככה זה נראה ביום הבחינה. תעשו עוד שתיים-שלוש כאלה, ובמיוחד על הנושאים שעוד מתנדנדים.' : 'יפה. ממשיכים לשיעור הבא, לפני שהחומר מתקרר.')
                        : 'זה בסדר גמור. רוב מי שעובר את הבחינה נפל בסימולציה הראשונה. ההסברים למטה הם החלק החשוב.') + '</div></div>' +
      '<div class="quiz-cta" style="justify-content:center">' +
        (a.kind === 'quiz' ? '<button type="button" class="btn-primary" id="rNext">' + (pass ? 'לשיעור הבא' : 'לנסות שוב') + '</button>' : '') +
        (a.kind === 'exam' ? '<button type="button" class="btn-primary" id="rExam">סימולציה נוספת</button>' : '') +
        '<button type="button" class="btn-secondary" id="rReview">חזרה על טעויות</button>' +
        (a.kind !== 'quiz' ? '<button type="button" class="btn-secondary" id="rLessons">לשיעורים</button>' : '') +
      '</div>' +
      '<div class="review">' + review + '</div></div>';

    var rn = $('rNext');
    if (rn) rn.addEventListener('click', function () {
      if (pass) { var n = nextLessonId(a.lessonId); if (n) openLesson(n); else openLesson(a.lessonId); }
      else startAttempt('quiz', a.lessonId);
    });
    var re = $('rExam');
    if (re) re.addEventListener('click', function () { startAttempt('exam'); });
    $('rReview').addEventListener('click', function () { startAttempt('review'); });
    var rl = $('rLessons');
    if (rl) rl.addEventListener('click', function () { var f = firstOpenLesson(); if (f) openLesson(f); });
  }

  $('examBtn').addEventListener('click', function () { closeMenu(); startAttempt('exam'); });
  $('reviewBtn').addEventListener('click', function () { closeMenu(); startAttempt('review'); });

  /* ---- תפריט בטלפון ---- */
  function closeMenu() { $('side').classList.remove('open'); $('backdrop').classList.add('hidden'); }
  $('menuBtn').addEventListener('click', function () {
    var open = $('side').classList.toggle('open');
    $('backdrop').classList.toggle('hidden', !open);
  });
  $('backdrop').addEventListener('click', closeMenu);

  /* ---------------------------------------------------------------- boot */
  var routed = false;
  async function route(session) {
    if (routed) return;
    routed = true;
    state.user = session.user;
    var params = new URLSearchParams(window.location.search);
    var order = params.get('order');
    cleanAuthParams();
    if (order) {
      var u = new URL(window.location.href);
      u.searchParams.delete('order'); u.searchParams.delete('order_id');
      history.replaceState(null, '', u.pathname + (u.search || ''));
    }
    try {
      await loadAll();
    } catch (e) {
      $('bootMsg').textContent = errText(e);
      return;
    }
    renderTop();
    if (order === 'success' && !state.me.enrolled) { showPay({ verify: true }); return; }
    if (order === 'failure') { showPay(); $('payErr').textContent = 'התשלום לא הושלם. לא בוצע חיוב, ואפשר לנסות שוב.'; return; }
    if (state.me.enrolled) { enterPlayer(); return; }
    showPay();
  }

  (async function boot() {
    var gerr = googleError();
    if (gerr) { cleanAuthParams(); $('loginErr').textContent = gerr; show('screenLogin'); return; }
    sb.auth.onAuthStateChange(function (event, session) {
      if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(function () { route(session); }, 0);
      if (event === 'SIGNED_OUT') { routed = false; show('screenLogin'); }
    });
    var s = await sb.auth.getSession();
    if (s.data && s.data.session) { route(s.data.session); return; }
    // חזרה מ-Google עם code: הלקוח מחליף אותו ברגע האתחול, ו-SIGNED_IN יגיע
    if (window.AuthReturn && AuthReturn.hasAuthResponse()) {
      setTimeout(function () { if (!routed) show('screenLogin'); }, 4000);
      return;
    }
    show('screenLogin');
  })();
})();
