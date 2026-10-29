/* סקריפטים של מסך אחד ב-CRM. לא נטענים עם הדף: על קו איטי הם היו
   מתחרים ב-crm.js ובציור מסך הכניסה. crmNeed('property') וחבריו נקראים
   כשהמסך נפתח, ובסדר, כי map-tiles נשען על Leaflet. */
(function (global) {
  'use strict';

  var GROUPS = {
    map: [
      ['/vendor/leaflet@1.9.4/leaflet.js', 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'],
      ['assets/map-tiles.js', ''],
      ['assets/map-gestures.js', ''],
    ],
    property: [
      ['assets/open-house.js', ''],
      ['assets/approx-location.js', ''],
    ],
    agreements: [
      ['assets/agreement-templates.js', ''],
      ['assets/agreement-doc.js', ''],
      ['assets/il-id.js', ''],
    ],
    /* ת.ז. לבד: שמירת פרופיל לא צריכה את תבניות ההסכם. loadOne מזהה
       את אותו src אם קבוצת ההסכמים כבר טענה אותו. */
    ilid: [
      ['assets/il-id.js', ''],
    ],
    specialties: [
      ['assets/specialties.js', ''],
    ],
    govmap: [
      ['assets/govmap.js', ''],
    ],
  };

  var pending = {};

  function loadOne(src, integrity) {
    var found = document.querySelector('script[src="' + src + '"]');
    if (found && found.dataset.ready === '1') return Promise.resolve();
    if (found && found.dataset.failed === '1') { found.remove(); found = null; }
    return new Promise(function (resolve, reject) {
      var s = found || document.createElement('script');
      var done = function () { s.dataset.ready = '1'; resolve(); };
      var fail = function () {
        s.dataset.failed = '1';
        s.remove();
        reject(new Error(src));
      };
      if (!found) {
        s.src = src;
        s.async = false;
        if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
        s.onload = done;
        s.onerror = fail;
        document.head.appendChild(s);
      } else {
        s.addEventListener('load', done);
        s.addEventListener('error', fail);
      }
    });
  }

  function crmNeed(group) {
    if (!pending[group]) {
      var list = GROUPS[group] || [];
      var chain = Promise.resolve();
      for (var i = 0; i < list.length; i++) {
        (function (item) {
          chain = chain.then(function () { return loadOne(item[0], item[1]); });
        })(list[i]);
      }
      pending[group] = chain.catch(function (err) {
        delete pending[group];
        throw err;
      });
    }
    return pending[group];
  }

  global.crmNeed = crmNeed;
})(window);
