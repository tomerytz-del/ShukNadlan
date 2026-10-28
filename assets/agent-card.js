/* ============================================================================
   ‏P1-V (§C.4): כרטיס יועץ הנדל״ן - רכיב אחד לכל מקום שמציג יועץ/ת.
   ----------------------------------------------------------------------------
   עד אישור המיגרציה (‏docs/proposals/agent_card_fields.sql, ד-25) הכרטיס בנוי
   רק מהשדות שכבר ב-agency_members_public: אין gender ציבורי ולכן שורת המשנה
   היא "ייעוץ נדל״ן · <משרד>"; אין license_status ציבורי ולכן אין תג רישיון;
   אין שפות, נקודת מוקד או דלי תגובה. שדה ריק מוסתר - לא "-".
   וואטסאפ: whatsapp_e164 כשיהיה, ועד אז phone_e164.

   AgentCard.html(a, { agency, logo, sponsored, fairNow, contactAttr })
   ‏contactAttr: מאפיין שמסמן את כפתור יצירת הקשר (‏data-agent="<id>" כברירת מחדל).
   ============================================================================ */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(n) {
    return String(n || '').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('');
  }
  function role(a) {
    if (a.gender === 'female') return 'יועצת נדל״ן';
    if (a.gender === 'male') return 'יועץ נדל״ן';
    return 'ייעוץ נדל״ן';
  }
  function waNumber(a) {
    var n = String(a.whatsapp_e164 || a.phone_e164 || '').replace(/\D/g, '');
    return /^9725\d{8}$/.test(n) ? n : '';
  }

  var CSS =
    '.agc{display:flex;flex-direction:column;gap:12px;background:#fff;border:1px solid #e3e8f2;border-radius:16px;padding:16px;text-align:start;height:100%;box-sizing:border-box}' +
    '.agc-spon{margin:0 0 -6px;font-size:12px;color:#6b7280}' +
    '.agc-head{display:flex;align-items:center;gap:12px;min-width:0}' +
    '.agc-ph{flex:0 0 64px;width:64px;height:64px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 2px #c9a227;background:#f6f1e7}' +
    '.agc-ini{display:flex;align-items:center;justify-content:center;background:#0e2a6b;color:#fff;font-size:22px;font-weight:800}' +
    '.agc-name{margin:0;font-size:18px;font-weight:800;color:#1b1f2a;line-height:1.25}' +
    '.agc-sub{margin:2px 0 0;font-size:14px;color:#4a5060;display:flex;align-items:center;gap:4px;flex-wrap:wrap}' +
    '.agc-sub img{width:16px;height:16px;border-radius:3px;object-fit:contain}' +
    '.agc-tags{display:flex;flex-wrap:wrap;gap:6px}' +
    '.agc-tag{white-space:nowrap;font-size:12.5px;font-weight:700;padding:4px 10px;border-radius:999px;background:#eef2fa;color:#0e2a6b}' +
    '.agc-tag.gold{background:#f7eccb;color:#7a5d0c}' +
    '.agc-facts{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin:0}' +
    '.agc-facts div{min-width:0}' +
    '.agc-facts dt{font-size:12px;color:#6b7280}' +
    '.agc-facts dd{margin:0;font-size:14px;font-weight:700;color:#1b1f2a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.agc-acts{display:flex;gap:8px;margin-top:auto}' +
    'html body .agc-cta{flex:1;min-height:46px;border:0;border-radius:12px;background:#0e2a6b;color:#fff;font:800 15px Heebo,system-ui,sans-serif;cursor:pointer}' +
    '.agc-wa{flex:0 0 46px;height:46px;display:flex;align-items:center;justify-content:center;border:2px solid #0e2a6b;border-radius:12px;font-size:20px;text-decoration:none;box-sizing:border-box}' +
    '.agc-more{font-size:14px;font-weight:700;color:#0e2a6b}' +
    '.agc-cta:focus-visible,.agc-wa:focus-visible,.agc-more:focus-visible{outline:3px solid #c9a227;outline-offset:2px}';
  function ensureCss() {
    if (document.getElementById('agcCss')) return;
    var st = document.createElement('style');
    st.id = 'agcCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function html(a, o) {
    o = o || {};
    ensureCss();
    var name = a.display_name || '';
    var photo = a.photo_url
      ? '<img class="agc-ph" src="' + esc(a.photo_url) + '" alt="" loading="lazy" width="64" height="64" style="object-position:' +
        esc(a.photo_focal_x != null && a.photo_focal_y != null ? a.photo_focal_x + '% ' + a.photo_focal_y + '%' : (a.photo_position || '50% 30%')) + '">'
      : '<span class="agc-ph agc-ini" aria-hidden="true">' + esc(initials(name)) + '</span>';
    var sub = '<p class="agc-sub">' + esc(role(a)) + (o.agency ? ' ·' + (o.sponsored && o.logo ? ' <img src="' + esc(o.logo) + '" alt="">' : '') + ' ' + esc(o.agency) : '') + '</p>';
    var tags = [];
    if (a.license_verified) tags.push('<span class="agc-tag">✓ רישיון מאומת</span>');
    if (a.has_ethics_badge) tags.push('<span class="agc-tag">✦ מחויבות לשירות הוגן</span>');
    if (a.response_bucket === 'within_hour') tags.push('<span class="agc-tag">עונה בדרך כלל תוך שעה</span>');
    if (o.fairNow) tags.push('<span class="agc-tag gold">ביריד עכשיו</span>');
    var specs = Array.isArray(a.specialties) ? a.specialties.filter(Boolean) : [];
    var langs = Array.isArray(a.languages) ? a.languages.filter(Boolean) : [];
    var facts = [
      ['אזורים', a.areas && a.areas.length ? a.areas.slice(0, 2).join(', ') + (a.areas.length > 2 ? ' +' + (a.areas.length - 2) : '') : (a.service_area || '')],
      ['ניסיון', Number(a.years_experience) > 0 ? (Number(a.years_experience) === 1 ? 'שנה אחת' : a.years_experience + ' שנים') : ''],
      ['התמחות', specs[0] || ''],
      ['שפות', langs.length > 1 || (langs[0] && langs[0] !== 'he') ? langs.join(', ') : '']
    ].filter(function (f) { return f[1]; });
    var wa = waNumber(a);
    return '<div class="agc">' +
      (o.sponsored ? '<p class="agc-spon">ממומן</p>' : '') +
      '<div class="agc-head">' + photo + '<div><h3 class="agc-name">' + esc(name) + '</h3>' + sub + '</div></div>' +
      (tags.length ? '<div class="agc-tags">' + tags.slice(0, 3).join('') + '</div>' : '') +
      (facts.length ? '<dl class="agc-facts">' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' : '') +
      '<div class="agc-acts"><button type="button" class="agc-cta" ' + (o.contactAttr || 'data-agent="' + esc(a.id) + '"') + '>יצירת קשר עם יועץ הנדל״ן</button>' +
      (wa ? '<a class="agc-wa" href="https://wa.me/' + wa + '" target="_blank" rel="noopener" aria-label="וואטסאפ ל' + esc(name) + '" title="וואטסאפ">💬</a>' : '') +
      '</div>' +
      (a.slug ? '<a class="agc-more" href="/agent?slug=' + encodeURIComponent(a.slug) + '">לפרופיל ←</a>' : '') +
      '</div>';
  }

  global.AgentCard = { html: html, role: role };
})(typeof globalThis !== 'undefined' ? globalThis : window);
