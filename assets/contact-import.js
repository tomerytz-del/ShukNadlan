/* ============================================================================
   ‏contact-import.js — אנשי קשר מהטלפון ומגוגל אל קובץ הלקוחות
   ----------------------------------------------------------------------------
   **למה הקובץ קיים:** דפדפן אינו רואה את אנשי הקשר ואת יומן השיחות של
   הטלפון — לא באנדרואיד ולא באייפון, גם כשהאתר מותקן כאפליקציה. מה שכן
   קיים הוא ארבעה פתחים צרים, וכל אחד מהם מחזיר את אותו מבנה כאן:

     ‏pick()         — חלון הבחירה של המערכת (‏Contact Picker, כרום באנדרואיד).
                      הסוכן/ת בוחר/ת; הדף רואה רק את מי שנבחר.
     ‏parseFile()    — קובץ ‎.vcf‎ (ייצוא מהאייפון או מאנדרואיד) או ‎.csv‎
                      (ייצוא מ-Google Contacts או מאאוטלוק).
     ‏takeShared()   — כרטיס ששותף אל האפליקציה המותקנת מתפריט "שתף"
                      (‏share_target ב-app-crm.webmanifest, ‏sw.js שם אותו בצד).
     ‏fetchGoogle()  — ‏Google People API בהרשאת קריאה בלבד, בטוקן שחי בדף
                      ולא נשמר בשום מקום.

   המבנה המשותף: ‏{ name, phone, phones[], email }. הכתיבה למסד, בדיקת
   הכפילות מול הקובץ וכל ה-HTML — ב-crm.js. כאן אין HTML בכלל, ולכן גם אין
   כאן בריחה.

   **אף פתח אינו מעלה את ספר הטלפונים כולו.** בכל אחד הסוכן/ת בוחר/ת מי
   נכנס, ורק הם נשמרים. ‏docs/crm-contacts-import.md.
   ========================================================================== */
(function () {
  'use strict';

  /* ‏מזהה ה-OAuth של Google Cloud (‏"Web application", מקור מורשה
     ‎https://shuknadlan.co.il‎). ציבורי מטבעו — הוא יושב בכל דף שמשתמש
     בכניסה של גוגל — ולכן הוא בקוד ולא בסוד. ריק = כפתור הייבוא מגוגל
     אינו מוצג. ההקמה: docs/crm-contacts-import.md. */
  var GOOGLE_CLIENT_ID = '';
  var GOOGLE_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
  /* חמישה עמודים של 1,000 — יותר מזה הוא ספר טלפונים של מוקד ולא של
     מתווך/ת, והרשימה במסך הבחירה כבר אינה שמישה. */
  var GOOGLE_MAX_PAGES = 5;

  var SHARE_CACHE = 'shared-contacts-v1';
  var SHARE_KEY = '/__shared-contacts';

  /* ---------------------------------------------------------------------
     טלפונים
     --------------------------------------------------------------------- */

  /* ‏+972 52-123-4567 / 972521234567 → 0521234567. מספר זר נשאר עם הפלוס. */
  function normPhone(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var digits = s.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.indexOf('972') === 0 && digits.length >= 11) return '0' + digits.slice(3);
    if (s.charAt(0) === '+') return '+' + digits;
    return digits;
  }

  /* המפתח להשוואה: תשע הספרות האחרונות. אותו כלל כמו בדיקת הכפילות
     ב-create_client של העוזר בוואטסאפ, כדי שהשניים לא יחלקו. */
  function phoneKey(raw) {
    return String(raw == null ? '' : raw).replace(/\D/g, '').slice(-9);
  }

  /* נייד לפני קווי: מספר שמתחיל ב-05 הוא מה שאפשר לשלוח אליו וואטסאפ. */
  function bestPhone(list) {
    for (var i = 0; i < list.length; i++) if (/^05/.test(list[i])) return list[i];
    return list[0] || '';
  }

  function makeContact(name, phones, emails) {
    var seen = {};
    var ph = [];
    (phones || []).forEach(function (p) {
      var n = normPhone(p);
      if (n && !seen[phoneKey(n)]) { seen[phoneKey(n)] = 1; ph.push(n); }
    });
    var em = (emails || []).map(function (e) { return String(e || '').trim(); })
      .filter(Boolean);
    return {
      name: String(name || '').replace(/\s+/g, ' ').trim(),
      phone: bestPhone(ph),
      phones: ph,
      email: em[0] || '',
    };
  }

  function usable(c) { return !!(c && (c.name || c.phone)); }

  /* ---------------------------------------------------------------------
     חלון הבחירה של המערכת (‏Contact Picker API)
     --------------------------------------------------------------------- */

  function pickerSupported() {
    return !!(navigator.contacts && typeof navigator.contacts.select === 'function' &&
      'ContactsManager' in window);
  }

  function pick(multiple) {
    if (!pickerSupported()) return Promise.resolve([]);
    return navigator.contacts.select(['name', 'tel', 'email'], { multiple: !!multiple })
      .then(function (rows) {
        return (rows || []).map(function (r) {
          return makeContact((r.name || [])[0], r.tel || [], r.email || []);
        }).filter(usable);
      })
      /* ביטול בחלון של המערכת נזרק כשגיאה. בשביל הדף זו פשוט בחירה ריקה. */
      ['catch'](function () { return []; });
  }

  /* ---------------------------------------------------------------------
     ‏vCard
     --------------------------------------------------------------------- */

  /* ‏QUOTED-PRINTABLE — ייצוא של אנדרואיד ישן כותב כך כל שם בעברית
     (‎=D7=93=D7=A0=D7=99‎). פענוח תו-תו היה מחזיר ג'יבריש; הבתים
     מפוענחים יחד כ-UTF-8. */
  function decodeQP(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
        bytes.push(parseInt(s.substr(i + 1, 2), 16));
        i += 2;
      } else {
        var code = s.charCodeAt(i);
        if (code < 128) bytes.push(code);
        else {
          var enc = unescape(encodeURIComponent(ch));
          for (var j = 0; j < enc.length; j++) bytes.push(enc.charCodeAt(j));
        }
      }
    }
    try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); }
    catch (e) { return s; }
  }

  function unescapeValue(s) {
    return String(s).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
  }

  function parseVcf(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n');
    /* קיפול שורות: שורה שמתחילה ברווח או בטאב ממשיכה את הקודמת (RFC 6350),
       ושורת QP שמסתיימת ב-= ממשיכה את הבאה. */
    var lines = [];
    raw.split('\n').forEach(function (line) {
      var prev = lines.length ? lines[lines.length - 1] : null;
      if (prev != null && /^[ \t]/.test(line)) lines[lines.length - 1] = prev + line.slice(1);
      else if (prev != null && /QUOTED-PRINTABLE/i.test(prev) && /=$/.test(prev)) {
        lines[lines.length - 1] = prev.slice(0, -1) + line;
      } else lines.push(line);
    });

    var out = [];
    var cur = null;
    lines.forEach(function (line) {
      if (/^BEGIN:VCARD/i.test(line)) { cur = { fn: '', n: '', tel: [], email: [] }; return; }
      if (/^END:VCARD/i.test(line)) {
        if (cur) {
          var name = cur.fn || cur.n;
          var c = makeContact(name, cur.tel, cur.email);
          if (usable(c)) out.push(c);
        }
        cur = null;
        return;
      }
      if (!cur) return;
      var colon = line.indexOf(':');
      if (colon < 0) return;
      var head = line.slice(0, colon);
      var value = line.slice(colon + 1);
      /* ‏item1.TEL — קידומת קבוצה של אפל */
      var prop = head.split(';')[0].replace(/^[^.]*\./, '').toUpperCase();
      if (/ENCODING=QUOTED-PRINTABLE/i.test(head)) value = decodeQP(value);
      value = unescapeValue(value).trim();
      if (!value) return;

      if (prop === 'FN') cur.fn = value;
      else if (prop === 'N') {
        /* ‏N:משפחה;פרטי;אמצעי;תואר;סיומת */
        var parts = value.split(';');
        cur.n = [parts[1], parts[2], parts[0]].filter(function (x) { return x && x.trim(); })
          .join(' ');
      } else if (prop === 'TEL') cur.tel.push(value.replace(/^tel:/i, ''));
      else if (prop === 'EMAIL') cur.email.push(value);
    });
    return out;
  }

  /* ---------------------------------------------------------------------
     ‏CSV — ייצוא של Google Contacts ("Google CSV" / "Outlook CSV")
     --------------------------------------------------------------------- */

  function csvRows(text) {
    var s = String(text || '').replace(/^﻿/, '');
    var rows = [];
    var row = [];
    var field = '';
    var q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') { field += '"'; i++; }
          else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s.charAt(i + 1) === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }

  function parseCsv(text) {
    var rows = csvRows(text);
    if (rows.length < 2) return [];
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    function col(re) {
      for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i;
      return -1;
    }
    function cols(re) {
      var r = [];
      head.forEach(function (h, i) { if (re.test(h)) r.push(i); });
      return r;
    }
    var full = col(/^(name|full name|display name|שם|שם מלא)$/);
    var first = col(/^(first name|given name|שם פרטי)$/);
    var middle = col(/^(middle name|additional name)$/);
    var last = col(/^(last name|family name|שם משפחה)$/);
    /* ‏Google: "Phone 1 - Value". אאוטלוק: "Mobile Phone", "Home Phone". */
    var phoneCols = cols(/(phone.*value|^phone$|mobile|^.*phone$|טלפון|נייד)/);
    var emailCols = cols(/(e-?mail.*value|^e-?mail( address)?$|דוא"?ל|אימייל)/);

    var out = [];
    rows.slice(1).forEach(function (r) {
      function at(i) { return i >= 0 ? String(r[i] || '').trim() : ''; }
      var name = at(full) ||
        [at(first), at(middle), at(last)].filter(Boolean).join(' ');
      var phones = [];
      /* ‏Google מצרפת כמה מספרים לתא אחד עם " ::: " */
      phoneCols.forEach(function (i) {
        at(i).split(/\s*:::\s*/).forEach(function (p) { if (p) phones.push(p); });
      });
      var emails = [];
      emailCols.forEach(function (i) {
        at(i).split(/\s*:::\s*/).forEach(function (e) { if (e) emails.push(e); });
      });
      var c = makeContact(name, phones, emails);
      if (usable(c)) out.push(c);
    });
    return out;
  }

  function parseText(text, filename) {
    var t = String(text || '');
    if (/BEGIN:VCARD/i.test(t)) return parseVcf(t);
    if (/\.csv$/i.test(filename || '') || /,/.test(t.split(/\r?\n/)[0] || '')) return parseCsv(t);
    return [];
  }

  function parseFile(file) {
    if (!file) return Promise.resolve([]);
    return file.text().then(function (t) { return parseText(t, file.name); });
  }

  /* ---------------------------------------------------------------------
     שיתוף אל האפליקציה המותקנת
     --------------------------------------------------------------------- */

  /* מה ש-sw.js שם בצד כשהגיע שיתוף. נקרא פעם אחת ונמחק מיד: כרטיס שנשאר
     היה נפתח שוב בכל כניסה ל-CRM. */
  function takeShared() {
    if (!('caches' in window)) return Promise.resolve([]);
    return caches.open(SHARE_CACHE).then(function (cache) {
      return cache.match(SHARE_KEY).then(function (res) {
        if (!res) return [];
        return res.text().then(function (t) {
          return cache['delete'](SHARE_KEY).then(function () { return parseText(t, ''); });
        });
      });
    })['catch'](function () { return []; });
  }

  /* ---------------------------------------------------------------------
     ‏Google Contacts
     --------------------------------------------------------------------- */

  function googleConfigured() { return !!GOOGLE_CLIENT_ID; }

  var gisPromise = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (gisPromise) return gisPromise;
    gisPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { gisPromise = null; reject(new Error('gis_load_failed')); };
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  /* טוקן חד-פעמי בזיכרון הדף. אין refresh token, אין שמירה במסד ואין
     סנכרון ברקע — זה ייבוא בלחיצה, לא חיבור קבוע. */
  function googleToken() {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPE,
          callback: function (resp) {
            if (resp && resp.access_token) resolve(resp.access_token);
            else reject(new Error((resp && resp.error) || 'google_denied'));
          },
          error_callback: function (err) {
            reject(new Error((err && err.type) || 'google_popup_closed'));
          },
        });
        client.requestAccessToken({ prompt: '' });
      });
    });
  }

  function fetchGoogle() {
    return googleToken().then(function (token) {
      var out = [];
      function page(pageToken, n) {
        var url = 'https://people.googleapis.com/v1/people/me/connections' +
          '?personFields=names,phoneNumbers,emailAddresses&pageSize=1000' +
          '&sortOrder=LAST_MODIFIED_DESCENDING' +
          (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        return fetch(url, { headers: { Authorization: 'Bearer ' + token } })
          .then(function (res) {
            if (!res.ok) throw new Error('google_http_' + res.status);
            return res.json();
          })
          .then(function (data) {
            (data.connections || []).forEach(function (p) {
              var name = ((p.names || [])[0] || {}).displayName || '';
              var phones = (p.phoneNumbers || []).map(function (x) {
                return x.canonicalForm || x.value;
              });
              var emails = (p.emailAddresses || []).map(function (x) { return x.value; });
              var c = makeContact(name, phones, emails);
              if (usable(c)) out.push(c);
            });
            if (data.nextPageToken && n + 1 < GOOGLE_MAX_PAGES) {
              return page(data.nextPageToken, n + 1);
            }
            return out;
          });
      }
      return page('', 0).then(function (list) {
        /* הטוקן מבוטל מיד. הוא היה פג בעצמו תוך שעה, אבל אין סיבה להשאיר
           הרשאה פתוחה אחרי שהייבוא נגמר. */
        try { window.google.accounts.oauth2.revoke(token, function () {}); } catch (e) { /* */ }
        return list;
      });
    });
  }

  window.ContactImport = {
    normPhone: normPhone,
    phoneKey: phoneKey,
    pickerSupported: pickerSupported,
    pick: pick,
    parseVcf: parseVcf,
    parseCsv: parseCsv,
    parseFile: parseFile,
    takeShared: takeShared,
    googleConfigured: googleConfigured,
    fetchGoogle: fetchGoogle,
  };
})();
