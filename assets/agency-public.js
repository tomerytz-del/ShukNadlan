/* ============================================================================
   גוף דף המשרד שגוגל והדפדפן רואים באותו סדר ובאותן מחלקות
   ----------------------------------------------------------------------------
   ‏og-tags.ts מייבאת את הקובץ, ו-agency.html טוען אותו לפני agency.js.
   הפלט הוא HTML מוברח. הדפדפן לא מחליף צומת שכבר נושא את אותם קישורים
   (‏data-ssr): הוא רק משלים מה שחסר. בלי זה הציור הראשון זז.

   כרטיס היועץ הוא div. הקישור היחיד לדף היועץ הוא השם. תו האיכות
   וכפתורי הוואטסאפ והחיוג אחים שלו, לא בתוך קישור. טלפון המשרד הוא
   כפתור "להתקשר למשרד". הכתובת נפתחת במפות.
   ========================================================================== */
(function (root) {
  'use strict';

  var PHONE_RE = /^\d{9,15}$/;
  var LISTING_LIMIT = 12;
  var EXPERTISE_LABELS = {
    residential_sale: 'מומחי דירות ובתים למכירה',
    residential_rent: 'מומחי שוק השכירות',
    commercial: 'מומחי נכסים מסחריים',
    income: 'מומחי נכסים מניבים והשקעות',
    land: 'מומחי קרקעות, מגרשים ונחלות',
    urban_renewal: 'ליווי פינוי בינוי ותמ״א',
    new_projects: 'שיווק פרויקטים מקבלן',
    luxury: 'מומחי נכסי יוקרה',
    industrial: 'מומחי תעשייה ולוגיסטיקה',
    property_management: 'ניהול נכסים עבור בעלים',
  };
  var COMPLEX = { commercial: 1, land: 1, urban_renewal: 1, industrial: 1, income: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function phoneOk(phone) {
    return PHONE_RE.test(String(phone || ''));
  }

  function sortTeam(members) {
    return (members || []).slice().sort(function (a, b) {
      return (b.role === 'manager') - (a.role === 'manager');
    });
  }

  function pickContact(members) {
    var list = members || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].role === 'manager' && phoneOk(list[i].phone_e164)) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (phoneOk(list[i].phone_e164)) return list[i];
    }
    return null;
  }

  function agentHref(member) {
    var key = clean(member && (member.slug || member.id));
    return key ? ('/agent?slug=' + encodeURIComponent(key)) : '';
  }

  function safeImg(url) {
    if (typeof url !== 'string') return '';
    var s = url.trim();
    if (!s || s.indexOf('//') === 0) return '';
    if (s.charAt(0) === '/' || s.indexOf('assets/') === 0) return s;
    if (/^https?:\/\//i.test(s)) return s;
    return '';
  }

  function thumbUrl(url) {
    var s = safeImg(url);
    if (!s) return '';
    var mark = '/storage/v1/object/public/';
    var at = s.indexOf(mark);
    if (at < 0) return s;
    var path = s.slice(at + mark.length).split(/[?#]/)[0];
    if (!path) return s;
    return s.slice(0, at) + '/storage/v1/render/image/public/' + path + '?width=148&height=120&resize=cover&quality=60';
  }

  function roleLabel(member) {
    if (member && member.role === 'manager') return 'ניהול משרד';
    if (member && member.role === 'agent') return 'יועץ נדל״ן';
    return clean(member && member.role) || 'יועץ נדל״ן';
  }

  var WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm5.6 14.2c-.2.7-1.2 1.3-1.9 1.4-.5.1-1.2.1-1.9-.1a13 13 0 0 1-5.6-4.6c-.6-.9-1-1.9-1-2.8 0-1 .5-1.7 1-2 .2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.5.9 1.1 1.6 2 2.2.3.2.5.2.7 0l.7-.8c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.4.4.1.2.1.7-.1 1.4Z"></path></svg>';
  var PHONE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"/></svg>';
  var STAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  var HANDLES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5 5 9.6a2 2 0 0 1 0-2.9l2.4-2.3a2 2 0 0 1 2.6-.1L12 5.7l2-1.4a2 2 0 0 1 2.6.1L19 6.7a2 2 0 0 1 0 2.9l-3 2.9"/><path d="m9.5 14 2 2M12 11.5l2.5 2.5M14.5 9.5 17 12"/><path d="M4.5 13.5 8 17l3 3a2 2 0 0 0 2.8 0l5.7-5.6"/></svg>';
  var TREND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.5 9.5 11l4 4L21 7"/><path d="M15.5 7H21v5.5"/></svg>';

  function waTeamHref(phone, agencyName, agentName, pageUrl) {
    var text = [
      'היי,',
      'הגעתי לדף של ' + (agencyName || 'המשרד') + ' בשוק הנדל״ן של עפולה והסביבה ואשמח לדבר עם ' + agentName + '.',
      pageUrl || '',
    ].join('\n');
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }

  function teamContactHtml(member, officeContact, opts) {
    var o = opts || {};
    var direct = phoneOk(member && member.phone_e164);
    var target = direct ? member : officeContact;
    if (!target || !phoneOk(target.phone_e164)) return '';
    var name = (member && member.display_name) || 'יועץ הנדל״ן';
    var href = waTeamHref(target.phone_e164, o.agencyName, name, o.pageUrl);
    var waLabel = direct ? ('שליחת הודעת וואטסאפ ל' + name) : ('שליחת הודעת וואטסאפ למשרד בנוגע ל' + name);
    var telLabel = direct ? ('חיוג ל' + name) : ('חיוג למשרד בנוגע ל' + name);
    return '<div class="team-contact">' +
      '<div class="team-actions">' +
        '<a class="ta-wa" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(waLabel) + '" title="' + esc(waLabel) + '">' + WA_SVG + ' וואטסאפ</a>' +
        '<a class="ta-tel" href="tel:+' + target.phone_e164 + '" aria-label="' + esc(telLabel) + '" title="' + esc(telLabel) + '">' + PHONE_SVG + ' חיוג</a>' +
      '</div>' +
      (direct ? '' : '<p class="team-via">הפנייה מגיעה למשרד</p>') +
      '</div>';
  }

  /* אותו כפתור ש-QualityBadge.create בונה בגודל sm, כדי שה-HTML של השרת
     והדפדפן יהיה אחד. המאזין נתלה אחר כך בלי להחליף את הצומת. */
  function ethicsBadgeHtml(px) {
    return '<button type="button" class="qb-badge" data-tone="light" aria-label="' +
      esc('תו האמון והאיכות - לחצו לפרטים') + '" title="' +
      esc('עומד בתקן האתי · לחצו לפרטים') + '"><img src="assets/badge-ethics.png" alt="' +
      esc('תו האמון והאיכות - עומד בתקן האתי של שוק נדל״ן של עפולה') +
      '" width="' + px + '" height="' + px + '" style="width:' + px + 'px;height:' + px + 'px" loading="lazy"></button>';
  }

  function teamHtml(members, opts) {
    var o = opts || {};
    var sorted = sortTeam(members);
    var office = pickContact(sorted);
    return sorted.map(function (member) {
      var href = agentHref(member);
      if (!href) return '';
      var name = member.display_name || '?';
      var manager = member.role === 'manager';
      var photo = safeImg(member.photo_url);
      var focus = /^\d{1,3}% \d{1,3}%$/.test(member.photo_position || '') ? member.photo_position : '';
      var avatar = photo
        ? '<img src="' + esc(encodeURI(photo)) + '" alt="' + esc(name) + '" width="88" height="88" loading="lazy"' +
          (focus ? ' style="--photo-pos:' + focus + '"' : '') + '>'
        : esc((String(name).trim()[0]) || '?');
      var license = member.license_number;
      var role = roleLabel(member);
      return '<div class="team-card' + (manager ? ' is-manager' : '') + '">' +
        (manager ? '<span class="team-flag">' + STAR_SVG + 'ניהול המשרד</span>' : '') +
        '<div class="team-avatar">' + avatar + '</div>' +
        '<a class="team-name" href="' + esc(href) + '">' + esc(name) + '</a>' +
        '<div class="team-role">' + esc(role) + '</div>' +
        (license ? '<span class="team-lic">' + CHECK_SVG + 'רישיון ' + esc(license) + '</span>' : '') +
        (member.has_ethics_badge ? '<div class="team-badge">' + ethicsBadgeHtml(28) + '</div>' : '') +
        teamContactHtml(member, office, o) +
        '</div>';
    }).join('');
  }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return '';
    return '₪' + v.toLocaleString('he-IL');
  }

  function listingsHtml(props, limit) {
    var cap = limit == null ? LISTING_LIMIT : limit;
    return (props || []).slice(0, cap).map(function (p) {
      if (!p || !p.id) return '';
      var deal = p.deal_type === 'rent' ? 'rent' : 'sale';
      var dealLabel = deal === 'rent' ? 'להשכרה' : 'למכירה';
      var what = [clean(p.property_type), clean(p.street), clean(p.city)].filter(Boolean).join(' · ') || clean(p.title) || 'נכס';
      var q = [p.title, p.street, p.city, p.property_type].map(clean).filter(Boolean).join(' ');
      var facts = [];
      if (p.rooms) facts.push((Math.round(Number(p.rooms) * 10) / 10) + ' חד׳');
      if (p.size_sqm) facts.push(Number(p.size_sqm).toLocaleString('he-IL') + ' מ״ר');
      if (p.floor !== null && p.floor !== undefined && p.floor !== '') {
        facts.push(Number(p.floor) === 0 ? 'קומת קרקע' : ('קומה ' + p.floor));
      }
      var price = money(p.price);
      var img = thumbUrl(p.images && p.images[0]);
      var thumb = img
        ? '<img src="' + esc(img) + '" alt="" width="74" height="60">'
        : '';
      var priceHtml = price
        ? '<span class="pr-amt"><span class="pr-num">' + esc(price) + '</span>' +
          (deal === 'rent' ? '<span class="per"> לחודש</span>' : '') + '</span>'
        : '<span class="pr-amt">לפי בקשה</span>';
      return '<a class="prop-row" data-deal="' + deal + '" data-q="' + esc(q) + '" href="/property?id=' + encodeURIComponent(p.id) + '">' +
        '<span class="pr-thumb">' + thumb + '</span>' +
        '<span class="pr-main">' +
          '<span class="pr-line pr-what">' + esc(what) + '</span>' +
          '<span class="pr-line pr-facts">' + esc(facts.join(' · ')) + '</span>' +
          '<span class="pr-line pr-price">' + priceHtml + '<span class="pr-deal">' + dealLabel + '</span></span>' +
        '</span>' +
        '</a>';
    }).join('');
  }

  function bannerCtaHtml(phone, waHref, name) {
    if (!phoneOk(phone)) return '';
    var who = clean(name) || 'המשרד';
    return '<a class="cta-primary" href="' + esc(waHref) + '" target="_blank" rel="noopener noreferrer"' +
      ' aria-label="' + esc('שליחת הודעת וואטסאפ ל' + who) + '">' + WA_SVG + ' וואטסאפ למשרד</a>' +
      '<a class="cta-secondary" href="tel:+' + phone + '" aria-label="' + esc('חיוג ל' + who) + '">' +
      PHONE_SVG + ' שיחה עם המשרד</a>';
  }

  function contactHtml(address, phone) {
    var addr = clean(address);
    var bits = [];
    if (addr) {
      var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
      bits.push('<a class="contact-address" href="' + esc(maps) + '" target="_blank" rel="noopener noreferrer" aria-label="' +
        esc('כתובת המשרד: ' + addr + ' - פתיחה במפות') + '"><span>' + esc(addr) + '</span></a>');
    }
    if (phoneOk(phone)) {
      bits.push('<a class="ag-call" href="tel:+' + phone + '">להתקשר למשרד</a>');
    }
    if (!bits.length) return '';
    bits.push('<p class="note">מוזמנים לפנות בכל שאלה - על נכס מסוים, על הערכת שווי או על מכירה והשכרה בעפולה והעמק.</p>');
    return '<div class="contact-who">' + bits.join('') + '</div>';
  }

  /* קישורים לסורק בלבד. המקטע נשאר מוסתר עד שהמדפים בדפדפן מחליפים אותם. */
  function listingLinksHtml(props) {
    return (props || []).map(function (p) {
      if (!p || !p.id) return '';
      var name = clean(p.title) || clean(p.property_type) || 'נכס';
      return '<a tabindex="-1" href="/property?id=' + encodeURIComponent(p.id) + '">' + esc(name) + '</a>';
    }).join('');
  }

  function expertiseLabels(ids, declared) {
    var list = (declared ? ids : (ids || []).slice(0, 3)).filter(function (id) { return EXPERTISE_LABELS[id]; });
    var labels = list.map(function (id) { return EXPERTISE_LABELS[id]; });
    if (list.some(function (id) { return COMPLEX[id]; })) labels.push('ליווי עסקאות מורכבות');
    return labels;
  }

  function expertiseChips(ids, declared) {
    var specs = root.Specialties;
    var list = (declared ? ids : (ids || []).slice(0, 3)).filter(function (id) { return EXPERTISE_LABELS[id]; });
    var html = list.map(function (id) {
      var icon = specs && specs.iconFor ? specs.iconFor(id) : '';
      return '<span class="trust-chip is-spec"><span class="ic" aria-hidden="true">' + icon +
        '</span><span class="tx">' + esc(EXPERTISE_LABELS[id]) + '</span></span>';
    }).join('');
    if (list.some(function (id) { return COMPLEX[id]; })) {
      html += '<span class="trust-chip is-spec"><span class="ic" aria-hidden="true">' + HANDLES_SVG +
        '</span><span class="tx">ליווי עסקאות מורכבות</span></span>';
    }
    return html;
  }

  function statGridHtml(count, ethics) {
    var cells = '';
    var n = Number(count);
    if (count != null && isFinite(n) && n > 0) {
      cells += '<div class="stat-cell"><div class="n">' + n + '</div><div class="l">' +
        (n === 1 ? 'נכס פעיל' : 'נכסים פעילים') + '</div></div>';
    }
    if (ethics) {
      cells += '<div class="stat-cell is-badge" id="ethicsCell"><div class="n" id="ethicsBadgeSlot"></div>' +
        '<div class="l">✦ מחויבות לשירות הוגן</div></div>';
    }
    return cells;
  }

  function trendChipHtml() {
    return '<span class="trust-chip"><span class="ic" aria-hidden="true">' + TREND_SVG +
      '</span><span class="tx">ניסיון מוכח בסגירת עסקאות</span></span>';
  }

  function listingIds(html) {
    var out = [];
    var re = /href="\/property\?id=([^"]+)"/g;
    var m;
    while ((m = re.exec(html))) out.push(decodeURIComponent(m[1]));
    return out;
  }

  function teamHrefs(html) {
    var out = [];
    var re = /class="team-name" href="([^"]+)"/g;
    var m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  }

  root.ShukAgencyPublic = {
    LISTING_LIMIT: LISTING_LIMIT,
    esc: esc,
    phoneOk: phoneOk,
    sortTeam: sortTeam,
    pickContact: pickContact,
    agentHref: agentHref,
    teamHtml: teamHtml,
    teamContactHtml: teamContactHtml,
    statGridHtml: statGridHtml,
    trendChipHtml: trendChipHtml,
    listingsHtml: listingsHtml,
    listingLinksHtml: listingLinksHtml,
    contactHtml: contactHtml,
    bannerCtaHtml: bannerCtaHtml,
    expertiseLabels: expertiseLabels,
    expertiseChips: expertiseChips,
    listingIds: listingIds,
    teamHrefs: teamHrefs,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
