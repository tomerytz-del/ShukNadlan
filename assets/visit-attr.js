/* ==========================================================================
   ייחוס ביקור ראשון - מקומי, בלי שליחה ל-GA4
   --------------------------------------------------------------------------
   /go/<code> מפנה לדף הבית עם utm_*. הדף שומר את החמישייה ב-localStorage
   ל-90 יום. ביקור ראשון מנצח. בטופס ליד או הרשמה השדות נכנסים לגוף
   הבקשה כ-visit_attr, והשרת כותב רק אותם.

   אין כאן שם, טלפון, מייל או כתובת. המפתח אינו נשלח ל-dataLayer.
   ========================================================================== */
(function (global) {
  'use strict';

  var KEY = 'shukVisitAttr';
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  var SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  var INTAKES = [
    '/functions/v1/owner-lead-intake',
    '/functions/v1/property-inquiry-intake',
    '/functions/v1/agent-direct-inquiry-intake',
    '/functions/v1/mortgage-lead-intake',
    '/functions/v1/saved-search-intake',
    '/functions/v1/project-lead-intake',
    '/functions/v1/property-visualize',
    '/functions/v1/agency-signup',
    '/functions/v1/create-own-agency',
    '/functions/v1/developer-signup',
    '/functions/v1/newsletter-subscribe'
  ];

  function slug(value) {
    var s = String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    return SLUG.test(s) ? s : '';
  }

  function fromSearch(search) {
    var q;
    try { q = new URLSearchParams(search || ''); }
    catch (e) { return null; }
    var source = slug(q.get('utm_source'));
    var medium = slug(q.get('utm_medium'));
    var campaign = slug(q.get('utm_campaign'));
    var content = slug(q.get('utm_content'));
    if (!source && !medium && !campaign && !content) return null;
    return {
      attr_source: source || null,
      attr_medium: medium || null,
      attr_campaign: campaign || null,
      attr_content: content || null,
      attr_code: content || null
    };
  }

  function validStored(stored, now) {
    if (!stored || typeof stored !== 'object') return null;
    if (typeof stored.exp !== 'number' || stored.exp <= now) return null;
    var out = fromSearch(
      '?utm_source=' + (stored.attr_source || '') +
      '&utm_medium=' + (stored.attr_medium || '') +
      '&utm_campaign=' + (stored.attr_campaign || '') +
      '&utm_content=' + (stored.attr_content || '')
    );
    if (!out) return null;
    out.exp = stored.exp;
    return out;
  }

  /* ביקור ראשון שעוד לא פג נשאר. אין ביקור - נשמר מה שכתוב בכתובת. */
  function decide(stored, search, now) {
    var fresh = validStored(stored, now);
    if (fresh) return fresh;
    var next = fromSearch(search);
    if (!next) return null;
    next.exp = now + MAX_AGE_MS;
    return next;
  }

  function payload(stored, now) {
    var fresh = validStored(stored, now);
    if (!fresh) return null;
    return {
      attr_source: fresh.attr_source,
      attr_medium: fresh.attr_medium,
      attr_campaign: fresh.attr_campaign,
      attr_content: fresh.attr_content,
      attr_code: fresh.attr_code
    };
  }

  function isIntake(url) {
    var s = String(url || '');
    for (var i = 0; i < INTAKES.length; i++) {
      if (s.indexOf(INTAKES[i]) !== -1) return true;
    }
    return false;
  }

  function decorate(input, init, attr) {
    if (!attr) return init;
    var url = '';
    if (typeof input === 'string') url = input;
    else if (input && input.url) url = input.url;
    if (!isIntake(url)) return init;
    if (!init || typeof init.body !== 'string') return init;
    try {
      var data = JSON.parse(init.body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return init;
      if (data.visit_attr) return init;
      var next = {};
      for (var k in init) {
        if (Object.prototype.hasOwnProperty.call(init, k)) next[k] = init[k];
      }
      data.visit_attr = attr;
      next.body = JSON.stringify(data);
      return next;
    } catch (e) {
      return init;
    }
  }

  function readStored() {
    try { return JSON.parse(global.localStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }

  function writeStored(row) {
    try {
      if (!row) global.localStorage.removeItem(KEY);
      else global.localStorage.setItem(KEY, JSON.stringify(row));
    } catch (e) { /* אחסון חסום - הייחוס יורד, הטופס נשאר */ }
  }

  function currentPayload() {
    return payload(readStored(), Date.now());
  }

  function boot() {
    if (typeof global.location === 'undefined') return;
    var row = decide(readStored(), global.location.search || '', Date.now());
    if (row) writeStored(row);
    else if (readStored()) writeStored(null);

    if (typeof global.fetch !== 'function' || global.fetch.__shukVisitAttr) return;
    var orig = global.fetch;
    function wrapped(input, init) {
      try {
        init = decorate(input, init, currentPayload());
      } catch (e) { /* מדידה לא שוברת שליחה */ }
      return orig.call(this, input, init);
    }
    wrapped.__shukVisitAttr = true;
    global.fetch = wrapped;
  }

  try { boot(); } catch (e) { /* הייחוס אופציונלי */ }

  global.ShukVisitAttr = {
    decide: decide,
    payload: payload,
    decorate: decorate,
    isIntake: isIntake,
    fromSearch: fromSearch
  };
})(typeof window !== 'undefined' ? window : globalThis);
