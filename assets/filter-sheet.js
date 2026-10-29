/* ---------------------------------------------------------------------------
 * ‏FilterSheet - תיבת הסינון האחידה (‏A3-2 / A3-3, PR 1010, תומר 28.10 20:15-20:16,
 * הנוסח של גבריאלה 20:30). רכיב אחד לדף הבית ול-/swipe (‏C2: רק שניהם ב-1010).
 *
 * הרכיב לא יודע מה מסננים: העמוד מוסר סעיפים (‏sections) לפי הסדר המשותף 1-13, טיוטה
 * (‏draft) ופונקציות count/onApply. כל שינוי נשאר בטיוטה עד "הצגת N תוצאות"; Esc,
 * הרקע ו-✕ סוגרים בלי להחיל. ‏docs/filter-sheet.md.
 *
 *   FilterSheet.open({
 *     title, surface, trigger,               // הכותרת, לאיזה עמוד, ולאן הפוקוס חוזר
 *     draft,                                  // אובייקט רגיל - הרכיב לא משכפל אותו
 *     sections: [{ key, title, kind, more, wide, hidden(d), options(d), get(d), set(d, v), multi,
 *                  min/max/placeholders (range), placeholder (text) }],
 *     count(d) → N,  applyLabel(N) → טקסט (לא חובה),  onApply(d),  onReset(d)
 *   })
 *
 * ‏kind: 'seg' (בחירה אחת, תמיד יש ערך), 'chips' (‏multi או אחת; צ'יפ בלי נכסים יורד אלא אם
 * נבחר), 'range' (שני שדות מספר), 'text'. ‏more: נכנס תחת "עוד אפשרויות" בטלפון (במחשב גלוי).
 * מ-1024px חלון ממורכז של 880px בשני טורים; מתחת - גיליון תחתון 92dvh. אותו DOM, רק CSS.
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  var doc = root.document;
  var esc = function (s) { return root.escapeHtml ? root.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var cssLoaded = false;
  function loadCss() {
    if (cssLoaded || doc.querySelector('link[href$="/assets/filter-sheet.css"]')) { cssLoaded = true; return; }
    cssLoaded = true;
    var l = doc.createElement('link');
    l.rel = 'stylesheet'; l.href = '/assets/filter-sheet.css';
    doc.head.appendChild(l);
  }

  var open_ = null;   // החלון הפתוח: { o, wrap, ... }

  function srLine(n) {
    return n === 0 ? 'אין נכסים שמתאימים לסינון' : n === 1 ? 'מוצג נכס אחד' : 'מוצגים ' + n.toLocaleString('he-IL') + ' נכסים';
  }
  function defaultApply(n) {
    return n === 0 ? 'אין תוצאות. אפשר לשנות את הסינון' : n === 1 ? 'הצגת תוצאה אחת' : 'הצגת ' + n.toLocaleString('he-IL') + ' תוצאות';
  }
  function isActive(sec, d) {
    var v = sec.get(d);
    if (sec.kind === 'seg') return false;
    if (sec.kind === 'range') return !!(v && (v[0] != null || v[1] != null));
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  }

  function txt(x, d) { return typeof x === 'function' ? x(d) : x; }
  function sectionHtml(sec, d) {
    var id = 'fsS_' + sec.key, v = sec.get(d), h = '', title = txt(sec.title, d);
    if (sec.kind === 'seg' || sec.kind === 'chips') {
      var opts = (sec.options(d) || []).filter(function (o) {
        var on = Array.isArray(v) ? v.indexOf(o.value) >= 0 : v === o.value;
        return sec.kind === 'seg' || on || o.count == null || o.count > 0;
      });
      if (!opts.length) return '';
      h = '<div class="fs-chips' + (sec.kind === 'seg' ? ' is-seg' : '') + '" role="group" aria-labelledby="' + id + '">' + opts.map(function (o) {
        var on = Array.isArray(v) ? v.indexOf(o.value) >= 0 : v === o.value;
        return '<button type="button" class="fs-chip" data-k="' + esc(sec.key) + '" data-v="' + esc(o.value) + '" aria-pressed="' + on + '">' +
          esc(o.label) + (o.count != null && sec.kind !== 'seg' ? '<span class="fs-n">' + o.count.toLocaleString('he-IL') + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    } else if (sec.kind === 'range') {
      var r = v || [null, null], ph = sec.placeholders || ['מ-', 'עד'];
      h = '<div class="fs-range">' +
        '<input type="number" inputmode="numeric" class="fs-in" data-k="' + esc(sec.key) + '" data-i="0" value="' + esc(r[0] == null ? '' : r[0]) + '" placeholder="' + esc(ph[0]) + '" aria-label="' + esc(title + ' ' + ph[0]) + '">' +
        '<span aria-hidden="true">-</span>' +
        '<input type="number" inputmode="numeric" class="fs-in" data-k="' + esc(sec.key) + '" data-i="1" value="' + esc(r[1] == null ? '' : r[1]) + '" placeholder="' + esc(ph[1]) + '" aria-label="' + esc(title + ' ' + ph[1]) + '"></div>';
    } else if (sec.kind === 'text') {
      h = '<input type="text" class="fs-in fs-text" data-k="' + esc(sec.key) + '" value="' + esc(v || '') + '" placeholder="' + esc(sec.placeholder || '') + '" aria-labelledby="' + id + '">';
    }
    return '<h3 class="fs-h" id="' + id + '">' + esc(title) + '</h3>' + h;
  }

  function render(skipKey) {
    var s = open_, o = s.o, d = o.draft;
    var moreActive = 0;
    s.titleEl.textContent = txt(o.title, d);
    o.sections.forEach(function (sec) {
      var box = s.boxes[sec.key];
      var hide = sec.hidden && sec.hidden(d);
      if (sec.more && !hide && isActive(sec, d)) moreActive++;
      if (sec.key === skipKey) { box.hidden = !!hide; return; }
      var html = hide ? '' : sectionHtml(sec, d);
      box.hidden = !html;
      // הפוקוס נשאר על אותו צ'יפ אחרי הציור
      var f = doc.activeElement, fk = f && box.contains(f) ? f.getAttribute('data-k') + '|' + f.getAttribute('data-v') : null;
      box.innerHTML = html;
      if (fk) { var b = box.querySelector('[data-k="' + fk.split('|')[0] + '"][data-v="' + fk.split('|').slice(1).join('|') + '"]'); if (b) b.focus({ preventScroll: true }); }
    });
    var hasMore = o.sections.some(function (sec) { return sec.more && !s.boxes[sec.key].hidden; });
    s.moreBtn.hidden = !hasMore;
    s.moreBtn.textContent = s.moreOpen ? 'פחות אפשרויות' : 'עוד אפשרויות' + (moreActive ? ' (' + moreActive + ')' : '');
    s.moreBtn.setAttribute('aria-expanded', String(!!s.moreOpen));
    s.moreBox.classList.toggle('is-open', !!s.moreOpen);
    recount();
  }

  function recount() {
    var s = open_;
    clearTimeout(s.tCount);
    s.tCount = setTimeout(function () {
      if (open_ !== s) return;
      var n = 0;
      try { n = s.o.count(s.o.draft) || 0; } catch (e) { n = 0; }
      s.n = n;
      s.go.textContent = (s.o.applyLabel || defaultApply)(n);
      s.go.disabled = n === 0;
      s.go.setAttribute('aria-disabled', String(n === 0));
      clearTimeout(s.tLive);
      s.tLive = setTimeout(function () { if (open_ === s) s.live.textContent = srLine(n); }, 700);
    }, 150);
  }

  function close(apply) {
    var s = open_;
    if (!s) return;
    open_ = null;
    clearTimeout(s.tCount); clearTimeout(s.tLive);
    doc.removeEventListener('keydown', s.onKey, true);
    s.wrap.remove();
    doc.documentElement.classList.remove('fs-locked');
    if (apply) s.o.onApply(s.o.draft);
    else if (s.o.onCancel) s.o.onCancel();
    if (s.o.trigger && s.o.trigger.focus && doc.contains(s.o.trigger)) s.o.trigger.focus({ preventScroll: true });
  }

  function open(o) {
    if (open_) close(false);
    loadCss();
    var wrap = doc.createElement('div');
    wrap.className = 'fs-wrap';
    wrap.innerHTML = '<div class="fs-scrim" data-fs-close></div>' +
      '<div class="fs-dlg" role="dialog" aria-modal="true" aria-labelledby="fsTitle">' +
        '<span class="fs-grip" aria-hidden="true"></span>' +
        '<div class="fs-head"><h2 id="fsTitle" tabindex="-1"></h2>' +
          '<button type="button" class="fs-x" data-fs-close aria-label="סגירת הסינון"><span aria-hidden="true">✕</span></button></div>' +
        '<div class="fs-body"><div class="fs-grid"></div>' +
          '<button type="button" class="fs-more-btn" aria-expanded="false" hidden></button>' +
          '<div class="fs-more fs-grid"></div></div>' +
        '<div class="fs-foot"><button type="button" class="fs-reset" aria-label="ניקוי כל הסינונים">ניקוי הכול</button>' +
          '<button type="button" class="fs-go"></button>' +
          '<p class="fs-sr" aria-live="polite" aria-atomic="true"></p></div>' +
      '</div>';
    var s = { o: o, wrap: wrap, boxes: {}, moreOpen: false, n: null };
    s.go = wrap.querySelector('.fs-go');
    s.titleEl = wrap.querySelector('#fsTitle');
    s.live = wrap.querySelector('.fs-sr');
    s.moreBtn = wrap.querySelector('.fs-more-btn');
    s.moreBox = wrap.querySelector('.fs-more');
    var main = wrap.querySelector('.fs-grid');
    o.sections.forEach(function (sec) {
      var box = doc.createElement('section');
      box.className = 'fs-sec' + (sec.wide ? ' is-wide' : '');
      box.dataset.sec = sec.key;
      (sec.more ? s.moreBox : main).appendChild(box);
      s.boxes[sec.key] = box;
    });
    // "עוד אפשרויות" נפתח מעצמו כשיש בו סינון פעיל
    s.moreOpen = o.sections.some(function (sec) { return sec.more && isActive(sec, o.draft); });
    open_ = s;

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-fs-close]')) { close(false); return; }
      if (e.target.closest('.fs-go')) { if (!s.go.disabled) close(true); return; }
      if (e.target.closest('.fs-reset')) {
        if (o.onReset) o.onReset(o.draft);
        // שדות מספר וטקסט מצוירים מחדש רק כאן (בהקלדה הם לא נוגעים בעצמם)
        render(); return;
      }
      if (e.target.closest('.fs-more-btn')) { s.moreOpen = !s.moreOpen; render(); return; }
      var b = e.target.closest('.fs-chip');
      if (!b) return;
      var sec = o.sections.filter(function (x) { return x.key === b.dataset.k; })[0];
      if (!sec) return;
      // הערך מהאפשרות עצמה (לא רק המחרוזת) - מספרים נשארים מספרים
      var opt = (sec.options(o.draft) || []).filter(function (x) { return String(x.value) === b.dataset.v; })[0];
      var val = opt ? opt.value : b.dataset.v;
      var cur = sec.get(o.draft);
      if (sec.kind === 'seg') sec.set(o.draft, val);
      else if (sec.multi) {
        var arr = (cur || []).slice(), i = arr.indexOf(val);
        if (i >= 0) arr.splice(i, 1); else arr.push(val);
        sec.set(o.draft, arr);
      } else sec.set(o.draft, cur === val ? null : val);
      render();
    });
    wrap.addEventListener('input', function (e) {
      var inp = e.target.closest('.fs-in');
      if (!inp) return;
      var sec = o.sections.filter(function (x) { return x.key === inp.dataset.k; })[0];
      if (!sec) return;
      if (sec.kind === 'range') {
        var r = (sec.get(o.draft) || [null, null]).slice(), v = inp.value.trim();
        r[Number(inp.dataset.i)] = v === '' || !isFinite(Number(v)) ? null : Number(v);
        sec.set(o.draft, r);
      } else sec.set(o.draft, inp.value);
      render(sec.key);
    });
    s.onKey = function (e) {
      if (open_ !== s) return;
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key !== 'Tab') return;
      // מלכודת פוקוס בתוך החלון
      var f = [].slice.call(wrap.querySelectorAll('button:not([disabled]):not([hidden]),input,[tabindex="-1"]')).filter(function (x) { return x.getClientRects().length; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    doc.addEventListener('keydown', s.onKey, true);
    doc.body.appendChild(wrap);
    doc.documentElement.classList.add('fs-locked');
    render();
    // הפוקוס על הכותרת (בלי טבעת) - קורא מסך מקריא אותה, ושום כפתור לא נראה "נבחר"
    setTimeout(function () { var h = wrap.querySelector('#fsTitle'); if (h) h.focus({ preventScroll: true }); }, 30);
  }

  root.FilterSheet = { open: open, close: function () { close(false); }, isOpen: function () { return !!open_; }, refresh: function () { if (open_) render(); } };
})(window);
