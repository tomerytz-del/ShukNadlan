/* לחיצה על וואטסאפ או על חיוג בנכס ביריד.
   נשלחת ברקע (sendBeacon, ואם התור מלא - fetch עם keepalive) ואינה
   ממתינה ואינה עוצרת את פתיחת וואטסאפ או החייגן. אין שם ואין טלפון:
   הם אינם ידועים בלחיצה. המפתח שבכתובת הוא מפתח הפרסום שכבר בדף.
   docs/open-house-fair.md */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.install(root);
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  var SUPABASE_URL = 'https://obookujgolazrwycsiyn.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx';
  var ENDPOINT = SUPABASE_URL + '/functions/v1/fair-contact-log';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SESSION_RE = /^[a-f0-9]{32}$/;
  var installed = false;

  function sessionToken() {
    var storage = root && root.sessionStorage;
    if (!storage) return '';
    try {
      var cur = storage.getItem('sk_fair_sid') || '';
      if (SESSION_RE.test(cur)) return cur;
      var crypto = root.crypto;
      if (!crypto || !crypto.getRandomValues) return '';
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var id = '';
      for (var i = 0; i < bytes.length; i++) id += (bytes[i] + 256).toString(16).slice(1);
      if (!SESSION_RE.test(id)) return '';
      storage.setItem('sk_fair_sid', id);
      return id;
    } catch (e) {
      return '';
    }
  }

  function clickPayload(link, session) {
    if (!link || !link.getAttribute) return null;
    var channel = link.getAttribute('data-fair-contact');
    var propertyId = String(link.getAttribute('data-fair-property') || '').trim().toLowerCase();
    var page = link.getAttribute('data-fair-page') || '';
    if (channel !== 'whatsapp' && channel !== 'call') return null;
    if (!UUID_RE.test(propertyId)) return null;
    var body = { property_id: propertyId, channel: channel };
    if (page === 'property' || page === 'swipe' || page === 'open_house') body.source_page = page;
    if (session && SESSION_RE.test(session)) body.client_session = session;
    return body;
  }

  function defaultTransport() {
    var nav = (root && root.navigator) || {};
    return {
      sendBeacon: nav.sendBeacon ? nav.sendBeacon.bind(nav) : null,
      Blob: root && root.Blob,
      fetch: root && root.fetch,
    };
  }

  /* מחזירה מיד. אינה זורקת ואינה מחזירה הבטחה שהקורא צריך להמתין לה. */
  function send(payload, transport) {
    if (!payload || (payload.channel !== 'whatsapp' && payload.channel !== 'call')) return false;
    var body = JSON.stringify({
      property_id: payload.property_id,
      channel: payload.channel,
      source_page: payload.source_page,
      client_session: payload.client_session,
    });
    var t = transport || defaultTransport();
    try {
      if (t.sendBeacon && t.Blob) {
        var blob = new t.Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (t.sendBeacon(ENDPOINT + '?apikey=' + encodeURIComponent(SUPABASE_ANON_KEY), blob)) return true;
      }
    } catch (e) {}
    try {
      if (t.fetch) {
        var pending = t.fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=UTF-8',
            apikey: SUPABASE_ANON_KEY,
            Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
          },
          body: body,
          keepalive: true,
          credentials: 'omit',
        });
        if (pending && pending.catch) pending.catch(function () {});
        return true;
      }
    } catch (e) {}
    return false;
  }

  function onClick(e) {
    if (!e) return;
    if (e.type === 'auxclick' && e.button !== 1) return;
    if (e.type === 'click' && e.button != null && e.button !== 0) return;
    var target = e.target;
    var link = target && target.closest ? target.closest('[data-fair-contact]') : null;
    if (!link) return;
    var payload = clickPayload(link, sessionToken());
    if (!payload) return;
    send(payload);
  }

  function install(win) {
    var w = win || root;
    if (!w || !w.document || installed) return;
    installed = true;
    w.document.addEventListener('click', onClick, true);
    w.document.addEventListener('auxclick', onClick, true);
  }

  return {
    install: install,
    send: send,
    clickPayload: clickPayload,
    sessionToken: sessionToken,
    onClick: onClick,
    ENDPOINT: ENDPOINT,
  };
});
