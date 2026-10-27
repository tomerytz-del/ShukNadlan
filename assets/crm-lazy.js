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
    return new Promise(function (resolve, reject) {
      var s = found || document.createElement('script');
      var done = function () { s.dataset.ready = '1'; resolve(); };
      if (!found) {
        s.src = src;
        s.async = false;
        if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
        s.onload = done;
        s.onerror = function () { reject(new Error(src)); };
        document.head.appendChild(s);
      } else if (s.dataset.ready === '1') {
        resolve();
      } else {
        s.addEventListener('load', done);
        s.addEventListener('error', function () { reject(new Error(src)); });
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
      pending[group] = chain;
    }
    return pending[group];
  }

  global.crmNeed = crmNeed;
})(window);
