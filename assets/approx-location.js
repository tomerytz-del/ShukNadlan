/* מיקום משוער - רכיב אחד לכל המפות.

   נכס באזור תעשייה בלי כתובת מדויקת מקבל במסד נקודה אקראית בתוך האזור
   (location_precision = 'zone'), ונכס על חלקה גדולה - את מרכז החלקה
   ('parcel'). הפין הזה **אינו** המיקום, ולכן כל מפה שמציגה אותו אומרת זאת:
   פין בעיצוב שונה, ובועית "המיקום של הנכס הזה מוערך". הנוסח יושב כאן ורק
   כאן, כדי שדף הבית, דף הנכס וה-CRM לא יתפצלו.

   docs/property-map.md, "מיקום משוער". */
(function () {
  'use strict';

  // עותק בריחה משלו בכוונה: סדר הטעינה בין קבצי assets אינו מובטח
  // (CLAUDE.md, "בריחת HTML") - ולכן כל חמשת התווים.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isApprox(p) {
    return !!p && (p.location_precision === 'zone' || p.location_precision === 'parcel');
  }

  function zoneName(p) {
    if (!p) return '';
    return p.neighborhood_name || (p.neighborhoods && p.neighborhoods.name) || '';
  }

  /* הטקסט המלא - לבועית בדף הנכס */
  function text(p) {
    var where = p && p.location_precision === 'zone'
      ? 'הנכס נמצא ב' + (zoneName(p) || 'אזור התעשייה') + ', והנקודה על המפה מסמנת את האזור ולא את הכתובת המדויקת.'
      : 'הנקודה על המפה מסמנת את אזור החלקה ולא את הכתובת המדויקת.';
    return 'המיקום של הנכס הזה מוערך. ' + where + ' לפרטים מדויקים, פנו ליועץ הנדל״ן של הנכס.';
  }

  /* התווית הקצרה - לתגית, לבלון במפה ולכרטיס ב-CRM */
  function label(p) {
    var z = p && p.location_precision === 'zone' ? zoneName(p) : '';
    return 'מיקום משוער' + (z ? ' - ' + z : '');
  }

  /* הרדיוס שבו הנכס נמצא, לעיגול בדף הנכס. ברירת מחדל כשחסר: 500 מ' */
  function radius(p) {
    var r = Number(p && p.location_radius_m);
    if (!r || r < 0) r = 500;
    return Math.min(1000, Math.max(100, r));
  }

  /* תגית עם בועית: ⓘ + התווית, והטקסט המלא בריחוף, במיקוד ובלחיצה (טלפון) */
  function badgeHtml(p) {
    return '<span class="approx-loc" tabindex="0" role="note" data-info-id="approx_location" aria-label="' + esc(text(p)) + '">' +
      '<span class="approx-loc-i" aria-hidden="true">i</span>' + esc(label(p)) +
      '<span class="approx-loc-tip" aria-hidden="true">' + esc(text(p)) + '</span></span>';
  }

  /* הסגנון מוזרק פעם אחת ונטען אחרון - ולכן גובר גם על design-system.css,
     שנטען בדף הבית אחרי ה-<style> (הסקיל home-page). */
  function injectStyle() {
    if (document.getElementById('approx-loc-style')) return;
    var css =
      '.approx-loc{position:relative;display:inline-flex;align-items:center;gap:5px;' +
        'font:600 12px/1.4 Heebo,sans-serif;color:#5b4a1f;background:#fdf3d8;' +
        'border:1px solid #e6cf8f;border-radius:12px;padding:2px 9px 2px 7px;cursor:help;max-width:100%}' +
      '.approx-loc-i{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;' +
        'border-radius:50%;background:#b8902f;color:#fff;font:700 10px/1 Georgia,serif;font-style:italic}' +
      '.approx-loc-tip{position:absolute;z-index:1200;bottom:calc(100% + 6px);right:0;width:max-content;max-width:260px;' +
        'white-space:normal;background:#1f2a2e;color:#fff;font:500 12px/1.5 Heebo,sans-serif;' +
        'padding:8px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);' +
        'opacity:0;visibility:hidden;transition:opacity .15s}' +
      '.approx-loc:hover .approx-loc-tip,.approx-loc:focus .approx-loc-tip,.approx-loc.is-open .approx-loc-tip{opacity:1;visibility:visible}' +
      /* הפין המשוער במפת דף הבית: אותה תווית מחיר, עם מסגרת מקווקוות */
      '.map-pin.is-approx{outline:2px dashed rgba(255,255,255,.95);outline-offset:-4px}' +
      '.map-pin.is-approx.is-dot{outline-offset:-2px}';
    var el = document.createElement('style');
    el.id = 'approx-loc-style';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  // בטלפון אין ריחוף: לחיצה פותחת וסוגרת את הבועית
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.approx-loc') : null;
    document.querySelectorAll('.approx-loc.is-open').forEach(function (b) { if (b !== t) b.classList.remove('is-open'); });
    if (t) { t.classList.toggle('is-open'); e.preventDefault(); e.stopPropagation(); }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyle);
  else injectStyle();

  window.ApproxLocation = {
    isApprox: isApprox,
    text: text,
    label: label,
    radius: radius,
    badgeHtml: badgeHtml,
  };
})();
