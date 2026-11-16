/* ==========================================================================
   לחיצת וואטסאפ או חיוג בהחלקה ובדף הנכס - פניית קשר, בלי ליד
   --------------------------------------------------------------------------
   events.js כבר שולח contact_agent על כל wa.me / api.whatsapp / tel:.
   כאן רק השדות שחסרים שם: מזהה הנכס, וייחוס הביקור מ-shukVisitAttr.
   ואם הפיקסל של Meta כבר עלה - אירוע Contact הסטנדרטי, עם אותם שדות.

   אין שם, טלפון או כתובת. אין יצירת ליד ואין התראה.
   כשל כאן לא עוצר את הקישור.
   ========================================================================== */
(function (global) {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ATTR_KEYS = ['attr_source', 'attr_medium', 'attr_campaign', 'attr_content'];

  function inquiryPage() {
    try {
      var path = String((global.location && global.location.pathname) || '');
      path = path.replace(/\.html$/, '');
      if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      if (path === '/swipe') return 'swipe';
      /* ‏הדף המסחרי: wa.me ו-tel: בכרטיסים נושאים data-property-id. */
      try { path = decodeURIComponent(path); } catch (e0) { /* נשאר כמו שהוא */ }
      if (path === '/afula/נדלן-מסחרי') return 'commercial';
      if (path === '/property' || /^\/p\/\d{1,9}$/.test(path)) return 'property';
    } catch (e) { /* אין כתובת - אין ייחוס */ }
    return '';
  }

  function uuid(value) {
    var s = String(value || '').trim().toLowerCase();
    return UUID.test(s) ? s : '';
  }

  function propertyId(link) {
    var fromLink = '';
    try {
      if (link && link.getAttribute) {
        fromLink = uuid(link.getAttribute('data-property-id')) || uuid(link.getAttribute('data-fair-property'));
      }
    } catch (e) { fromLink = ''; }
    if (fromLink) return fromLink;
    try {
      var root = global.document && global.document.documentElement;
      var marked = root && root.getAttribute ? root.getAttribute('data-property-id') : '';
      if (uuid(marked)) return uuid(marked);
    } catch (e2) { /* אין מסמך */ }
    try {
      return uuid(new URLSearchParams(global.location.search || '').get('id'));
    } catch (e3) {
      return '';
    }
  }

  function visitFields() {
    var out = {};
    try {
      var api = global.ShukVisitAttr;
      if (!api || typeof api.payload !== 'function' || !global.localStorage) return out;
      var stored = JSON.parse(global.localStorage.getItem('shukVisitAttr') || 'null');
      var row = api.payload(stored, Date.now());
      if (!row) return out;
      for (var i = 0; i < ATTR_KEYS.length; i++) {
        var key = ATTR_KEYS[i];
        if (row[key]) out[key] = row[key];
      }
    } catch (e) { /* אחסון חסום - הפנייה נספרת בלי ייחוס */ }
    return out;
  }

  /* null מחוץ להחלקה ולדף הנכס, כדי שלא נעשיר פנייה בדף אחר. */
  function fields(link) {
    if (!inquiryPage()) return null;
    var out = visitFields();
    var id = propertyId(link);
    if (id) {
      out.item_id = id;
      out.property_id = id;
    }
    return out;
  }

  /* הפיקסל עולה מ-GTM. אם הוא עוד לא עלה, contact_agent ב-dataLayer נשאר. */
  function pixel(method, extra) {
    try {
      if (typeof global.fbq !== 'function') return false;
      if (method !== 'whatsapp' && method !== 'phone') return false;
      var data = { content_type: 'home_listing', content_category: method };
      var fields_ = extra || {};
      if (fields_.item_id) data.content_ids = [fields_.item_id];
      for (var i = 0; i < ATTR_KEYS.length; i++) {
        var key = ATTR_KEYS[i];
        if (fields_[key]) data[key] = fields_[key];
      }
      global.fbq('track', 'Contact', data);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.ShukContactInquiry = {
    inquiryPage: inquiryPage,
    fields: fields,
    pixel: pixel,
    propertyId: propertyId
  };
})(typeof window !== 'undefined' ? window : globalThis);
