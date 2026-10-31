/* ---------------------------------------------------------------------------
 * ‏ShukLikes - רשימת המועדפים האחת של האתר (‏localStorage.sk_swipe_likes)
 *
 * מערך של מזהי נכסים כמחרוזות, הישן ראשון, עד 200 (כמו בהחלקה). הלב בדף
 * היועץ (‏agent.html), ההחלקה, הלב בכותרת והפאנל - כולם על אותה רשימה. כל
 * כתיבה קוראת את הרשימה מחדש רגע לפני (קריאה, שינוי, כתיבה), כדי לא לדרוס
 * שמירה מלשונית אחרת. בלי DOM ובלי UI. כשל באחסון (גלישה פרטית) אינו שובר
 * את הדף - הרשימה פשוט ריקה.
 *
 * ‏migrate(): הלב בדף היועץ שמר עד 31.10.2026 ברשימה נפרדת (‏shuk_favorites).
 * בטעינה הראשונה היא מתמזגת לסוף הרשימה הראשית, בלי כפילויות ובלי תקרת 200,
 * והמפתח הישן נמחק רק אחרי שהכתיבה נקראה חזרה. מפתח פגום נשאר כמו שהוא.
 *
 * כל שינוי משדר באותה לשונית את האירוע shuk-likes (לשונית אחרת שומעת storage).
 * ‏docs/swipe-mode.md, ‏docs/agent-page.md.
 * ------------------------------------------------------------------------- */
(function (g) {
  'use strict';
  if (g.ShukLikes) return;
  var KEY = 'sk_swipe_likes', OLD = 'shuk_favorites', CAP = 200;

  function read(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { g.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function parse(raw) {
    try { var a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(Boolean).map(String) : []; } catch (e) { return []; }
  }
  function list() { return parse(read(KEY)); }
  function changed() {
    try { g.dispatchEvent(new CustomEvent('shuk-likes')); } catch (e) {}
  }
  function store(arr) {
    var ok = write(KEY, JSON.stringify(arr));
    changed();
    return ok;
  }
  function has(id) { return list().indexOf(String(id)) >= 0; }
  function add(id) {
    id = String(id);
    var l = list();
    if (l.indexOf(id) < 0) { l.push(id); store(l.slice(-CAP)); }
  }
  function remove(id) {
    id = String(id);
    var l = list(), next = l.filter(function (x) { return x !== id; });
    if (next.length !== l.length) store(next);
  }
  function toggle(id) {
    if (has(id)) { remove(id); return false; }
    add(id); return true;
  }

  function migrate() {
    var raw = read(OLD);
    if (raw == null) return;
    var old;
    try { old = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(old)) return;
    var merged = list();
    old.forEach(function (id) {
      if (id == null || id === '') return;
      id = String(id);
      if (merged.indexOf(id) < 0) merged.push(id);
    });
    // בלי תקרה: המעבר לא מוריד אף נכס
    if (!write(KEY, JSON.stringify(merged))) return;
    var back = list();
    var all = old.every(function (id) { return id == null || id === '' || back.indexOf(String(id)) >= 0; });
    if (all) { try { g.localStorage.removeItem(OLD); } catch (e) {} }
    changed();
  }

  g.ShukLikes = { KEY: KEY, list: list, has: has, add: add, remove: remove, toggle: toggle, migrate: migrate };
  migrate();
})(typeof window !== 'undefined' ? window : globalThis);
