/* ============================================================================
   סימון אזור ורדיוס על המפה
   ----------------------------------------------------------------------------
   עד היום היו לחיפוש שלוש רמות מיקום: עיר, שכונה, ותחום התצוגה של המפה.
   השלישית היא הרחבה מקרית — היא זזה בכל גרירה ואי אפשר לשמור אותה — ולכן מי
   שרצה/תה "ליד בית הספר של הילדים", "בצד הזה של הכביש" או "עשר דקות הליכה
   מהמרפאה" נשאר/ה בלי כלי. הקובץ הזה נותן את שני הכלים שחסרו:

     • **סימון אזור** — מצולע חופשי. לוחצים נקודה־נקודה על המפה, סוגרים,
       וגוררים את הפינות לתיקון. שכונה אינה עיגול (ראו drawHoodShapes
       ב-index.html), וגם "האזור שאני רוצה" לרוב אינו.
     • **רדיוס** — עיגול סביב נקודה. לחיצה אחת מציבה מרכז עם רדיוס ברירת
       מחדל וידית על ההיקף; גוררים את הידית להגדלה ואת המרכז להזזה. זה הכלי
       הנכון כשהעוגן הוא *נקודה* ("קרוב לתחנה") ולא צורה.

   שני עקרונות שמסבירים את רוב הקוד:

   1. **הרכיב לא יודע מה זה נכס.** הוא מצייר צורה ומודיע עליה ב-onChange;
      מי שקורא לו מחליט מה לסנן. אותו כלי משרת את המפה בדף הבית ויכול לשרת
      כל מפה אחרת באתר בלי לגעת בו.
   2. **בלי פלאגין ציור חיצוני.** ‏Leaflet.draw הוא 40KB, האנגלית שלו קבועה,
      וה-RTL שלו שבור. כאן יש שתי צורות בלבד ושתיהן נשענות על מה ש-Leaflet
      כבר יודע: ‎L.polygon‎, ‎L.circle‎ ו-marker שאפשר לגרור.

   ‏**נגישות**: ציור בעכבר אינו נגיש למקלדת, ולכן שורת הרמז מציעה גם ארבעה
   רדיוסים מוכנים (500 מ׳ / 1 / 2 / 5 ק״מ) שמציירים עיגול סביב מרכז המפה.
   זו לא "פשרה לנגישות" אלא לרוב הדרך המהירה יותר גם בעכבר.

   שימוש:

       var draw = MapDraw.attach(map, {
         onChange: function (shape) { … },   // ‏null = הסימון בוטל
         onModeChange: function (mode) { … } // ‏'area' | 'radius' | null
       });

       draw.startArea();  draw.startRadius();  draw.clear();
       draw.contains(lat, lng);   // האם הנקודה בתוך הצורה
       draw.shape();              // ‏{ kind:'area', latlngs:[…] } או
                                  // ‏{ kind:'radius', center:[…], radius:מ׳ }
       draw.bounds();             // ‏L.LatLngBounds או null
       draw.detach();

   ‏JS גולמי בלי תלויות מלבד Leaflet עצמו, בדיוק כמו שאר הקבצים ב-assets.
   ========================================================================== */
(function (global) {
  'use strict';

  /* רדיוס ההתחלה של עיגול חדש. מספיק גדול כדי שהידית תהיה ברורה ולא תיפול
     מתחת לאצבע שהציבה את המרכז, ומספיק קטן כדי שכמעט תמיד יגררו אותו החוצה
     ולא פנימה — הגדלה היא המחווה הטבעית. */
  var DEFAULT_RADIUS_M = 700;
  var MIN_RADIUS_M = 120;
  var MAX_RADIUS_M = 25000;

  /* הרדיוסים המוכנים בשורת הרמז. הם גם נקודת הכניסה היחידה למקלדת. */
  var RADIUS_PRESETS = [
    { m: 500,   label: '500 מ׳' },
    { m: 1000,  label: '1 ק״מ' },
    { m: 2000,  label: '2 ק״מ' },
    { m: 5000,  label: '5 ק״מ' }
  ];

  var SHAPE_STYLE = {
    color: '#0e2a6b', weight: 2, dashArray: '7 5',
    fillColor: '#3f6eff', fillOpacity: 0.10, interactive: false
  };

  var cssInjected = false;

  /* ---------- ה-CSS ----------
     מוזרק פעם אחת ורק כשבאמת מצרפים כלי למפה, כדי שדף בלי מפה לא ישלם עליו.
     הצבעים כתובים כאן במפורש ולא כטוקנים: הרכיב נטען גם בדפים שנצבעו בערכה
     של משרד מסוים, והידיות של כלי הציור אינן חלק מהמיתוג שלו. */
  var CSS = [
    /* שורת הרמז — יושבת מתחת לסרגל העליון של המפה ומסבירה את המחווה
       הנוכחית. היא גם המקום של "סיום"/"ביטול" ושל הרדיוסים המוכנים, ולכן
       היא pointer-events:auto בעוד המעטפת שקופה למצביע. */
    /* ‏top:58px ולא 12: הקורא של הרכיב מציב את כפתורי "סימון אזור"/"רדיוס"
       בראש המפה, והרמז חייב לשבת מתחתיהם ולא עליהם.

       המרכוז נעשה ב-inset משני הצדדים + margin אוטומטי, ולא
       ב-‏translateX(±50%): ה-transform אינו מאפיין לוגי, ולכן הוא זז לכיוון
       ההפוך ב-RTL ודחף את השורה אל מחוץ למפה.

       ה-inset עצמו הוא *השטח הפנוי* ולא קצות הקונטיינר: בדף הבית חצי מהמפה
       יושב מתחת לעמודת הכותרת והחיפוש, ורמז שממורכז בקונטיינר נעלם מתחתיה
       בדיוק ברגע שצריך אותו — כשמסמנים אזור. הדף כותב את המשתנים על
       הקונטיינר (‏syncMapFreeArea); בלעדיהם ברירת המחדל 0 מחזירה מרכוז רגיל. */
    '.mapdraw-hint{',
    '  position:absolute;z-index:640;margin-inline:auto;width:max-content;',
    '  left:var(--map-free-start,0px);right:var(--map-free-end,0px);',
    '  top:58px;display:none;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;',
    '  max-width:min(560px, calc(100% - var(--map-free-start,0px) - var(--map-free-end,0px) - 24px));',
    '  padding:8px 12px;',
    '  background:rgba(13,27,61,.94);color:#fff;font-size:.78rem;font-weight:500;',
    '  box-shadow:0 12px 28px -16px rgba(13,27,61,.9);pointer-events:auto}',
    '.mapdraw-hint.is-on{display:flex}',
    '.mapdraw-hint-text{opacity:.92}',
    '.mapdraw-hint-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.mapdraw-btn{',
    '  appearance:none;border:1px solid rgba(255,255,255,.35);background:transparent;',
    '  color:#fff;font:inherit;font-size:.75rem;font-weight:600;padding:5px 10px;cursor:pointer;',
    '  border-radius:0;line-height:1.2}',
    '.mapdraw-btn:hover{background:rgba(255,255,255,.12)}',
    '.mapdraw-btn:focus-visible{outline:2px solid #e5c76a;outline-offset:2px}',
    '.mapdraw-btn.is-primary{background:#c9a227;border-color:#c9a227;color:#0d1b3d}',
    '.mapdraw-btn.is-primary:hover{background:#e0bf4f;border-color:#e0bf4f}',
    '.mapdraw-btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.mapdraw-presets{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
    '.mapdraw-presets-label{opacity:.7;font-size:.72rem}',

    /* המפה בזמן ציור: הצלב מודיע שהלחיצה הבאה מציבה נקודה ולא גוררת */
    '.mapdraw-drawing{cursor:crosshair}',
    '.mapdraw-drawing .leaflet-grab{cursor:crosshair}',

    /* הפינות של המצולע והידיות של העיגול — ריבועים לבנים עם מסגרת ספיר,
       בדיוק כמו בעיצוב. ‏touch-action:none כדי שגרירה של ידית לא תיתפס
       כגלילת דף במובייל. */
    '.mapdraw-handle{background:#fff;border:2px solid #0e2a6b;box-sizing:border-box;',
    '  touch-action:none;cursor:move}',
    '.mapdraw-handle.is-round{border-radius:50%;border-color:#c9a227}',
    '.mapdraw-handle.is-first{background:#c9a227;border-color:#0e2a6b;cursor:pointer}',

    /* תווית "האזור שסימנתם" על הפינה העליונה של הצורה */
    '.mapdraw-label{',
    '  background:#0e2a6b;color:#fff;font-size:.68rem;font-weight:600;',
    '  padding:3px 9px;white-space:nowrap;box-shadow:0 6px 16px -10px rgba(13,27,61,.9)}',
    '.mapdraw-label-wrap{background:none;border:none}',

    /* הקו המקווקו זוחל בזמן הציור — הרמז הוויזואלי היחיד שהצורה עדיין
       פתוחה. נעצר לגמרי במצב "עצירת אנימציות" ובהעדפת מערכת מתאימה. */
    '.mapdraw-live{animation:mapdrawMarch 1.1s linear infinite}',
    '@keyframes mapdrawMarch{to{stroke-dashoffset:-24}}',
    '@media(prefers-reduced-motion:reduce){.mapdraw-live{animation:none}}',
    'html.a11y-nomotion .mapdraw-live{animation:none}'
  ].join('\n');

  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-mapdraw', '');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------- האם נקודה בתוך מצולע ----------
     ray casting על lat/lng כמו על מישור. בקנה מידה של עיר ההבדל בין המישור
     לכדור הוא מתחת לרזולוציה של פיקסל אחד, ומצולע שהמשתמש/ת צייר/ה בעצמו/ה
     על המסך ממילא מוגדר בפיקסלים. */
  function pointInRing(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i][0], xi = ring[i][1];
      var yj = ring[j][0], xj = ring[j][1];
      var straddles = (yi > lat) !== (yj > lat);
      if (straddles && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function squareIcon(px, cls) {
    return global.L.divIcon({
      className: '',
      html: '<span class="mapdraw-handle ' + (cls || '') + '" style="display:block;width:' +
            px + 'px;height:' + px + 'px"></span>',
      iconSize: [px, px],
      iconAnchor: [px / 2, px / 2]
    });
  }

  /* ---------- החיבור למפה ---------- */
  function attach(map, opts) {
    if (!map || !global.L) return null;
    opts = opts || {};
    injectCss();

    var L = global.L;
    var container = map.getContainer();

    var mode = null;          // ‏'area' | 'radius' | null — הכלי הפעיל
    var shape = null;         // הצורה הסגורה: ‏{ kind, … }
    var layer = null;         // ‏L.Polygon / L.Circle של הצורה הסגורה
    var labelMarker = null;   // "האזור שסימנתם"
    var handles = [];         // ידיות העריכה
    var draftPts = [];        // נקודות המצולע בזמן הציור
    var draftLine = null;     // הקו שנמתח אחרי הסמן
    var draftDots = [];
    var destroyed = false;

    /* ---------- שורת הרמז ---------- */
    var hint = document.createElement('div');
    hint.className = 'mapdraw-hint';
    hint.setAttribute('role', 'status');
    hint.innerHTML =
      '<span class="mapdraw-hint-text"></span>' +
      '<span class="mapdraw-hint-actions">' +
        '<span class="mapdraw-presets" hidden>' +
          '<span class="mapdraw-presets-label">או מיד:</span>' +
        '</span>' +
        '<button type="button" class="mapdraw-btn is-primary" data-act="done">סיום</button>' +
        '<button type="button" class="mapdraw-btn" data-act="cancel">ביטול</button>' +
      '</span>';
    container.appendChild(hint);
    // ‏Leaflet מפרש לחיצה על אלמנט בתוך הקונטיינר כלחיצה על המפה, וכפתור
    // "סיום" היה מוסיף נקודה נוספת בדיוק ברגע הסגירה
    L.DomEvent.disableClickPropagation(hint);
    L.DomEvent.disableScrollPropagation(hint);

    var hintText = hint.querySelector('.mapdraw-hint-text');
    var hintDone = hint.querySelector('[data-act="done"]');
    var presetsWrap = hint.querySelector('.mapdraw-presets');

    RADIUS_PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mapdraw-btn';
      b.textContent = p.label;
      b.addEventListener('click', function () { setRadiusAt(map.getCenter(), p.m); });
      presetsWrap.appendChild(b);
    });

    hint.querySelector('[data-act="cancel"]').addEventListener('click', function () { cancel(); });
    hintDone.addEventListener('click', function () { closeArea(); });

    function showHint(text, o) {
      o = o || {};
      hintText.textContent = text;
      presetsWrap.hidden = !o.presets;
      hintDone.hidden = !o.done;
      hintDone.disabled = !!o.doneDisabled;
      hint.classList.add('is-on');
    }
    function hideHint() { hint.classList.remove('is-on'); }

    /* ---------- ניקוי ---------- */
    function clearDraft() {
      draftPts = [];
      if (draftLine) { map.removeLayer(draftLine); draftLine = null; }
      draftDots.forEach(function (m) { map.removeLayer(m); });
      draftDots = [];
    }

    function clearShape() {
      if (layer) { map.removeLayer(layer); layer = null; }
      if (labelMarker) { map.removeLayer(labelMarker); labelMarker = null; }
      handles.forEach(function (m) { map.removeLayer(m); });
      handles = [];
      shape = null;
    }

    function emitChange() {
      if (typeof opts.onChange === 'function') opts.onChange(shape ? publicShape() : null);
    }
    function emitMode() {
      if (typeof opts.onModeChange === 'function') opts.onModeChange(mode);
    }

    function publicShape() {
      if (!shape) return null;
      return shape.kind === 'area'
        ? { kind: 'area', latlngs: shape.ring.map(function (p) { return [p[0], p[1]]; }) }
        : { kind: 'radius', center: [shape.center[0], shape.center[1]], radius: shape.radius };
    }

    function setDrawingCursor(on) {
      container.classList.toggle('mapdraw-drawing', !!on);
    }

    /* ---------- התווית שעל הצורה ----------
       על הפינה הצפונית־**מערבית**, כלומר השמאלית העליונה על המסך. הפינה
       הנגדית הייתה הבחירה המתבקשת ב-RTL, אבל בדף שקורא לרכיב הזה עמודת
       הכותרת והחיפוש יושבת דווקא בימין ומעליה סקרים כהה — ותווית שנוחתת
       מתחתיו פשוט לא נקראת. צד המפה הפנוי הוא השמאלי, ולשם היא הולכת.
       מערב/מזרח ולא start/end: זה כיוון גאוגרפי, והוא זהה בשני כיווני
       הכתיבה. */
    function placeLabel() {
      if (!layer) return;
      var b = layer.getBounds();
      var at = [b.getNorth(), b.getWest()];
      if (labelMarker) { labelMarker.setLatLng(at); return; }
      labelMarker = L.marker(at, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'mapdraw-label-wrap',
          html: '<span class="mapdraw-label">האזור שסימנתם</span>',
          iconSize: null,
          iconAnchor: [0, 20]
        })
      }).addTo(map);
    }

    /* ================= סימון אזור (מצולע) ================= */

    function startArea() {
      cancelSilently();
      mode = 'area';
      emitMode();
      setDrawingCursor(true);
      map.on('click', onAreaClick);
      map.on('mousemove', onAreaMove);
      showHint('לחצו על המפה כדי לסמן את פינות האזור — לפחות שלוש', { done: true, doneDisabled: true });
    }

    function onAreaClick(e) {
      var pt = [e.latlng.lat, e.latlng.lng];
      // לחיצה חוזרת על הנקודה הראשונה סוגרת את הצורה — המחווה המוכרת מכל
      // כלי ציור. הסף בפיקסלים ולא במעלות, כי "קרוב" כאן הוא קרוב על המסך.
      if (draftPts.length >= 3) {
        var firstPx = map.latLngToContainerPoint(draftPts[0]);
        if (firstPx.distanceTo(map.latLngToContainerPoint(pt)) < 14) { closeArea(); return; }
      }
      draftPts.push(pt);
      draftDots.push(L.marker(pt, {
        icon: squareIcon(draftPts.length === 1 ? 12 : 9, draftPts.length === 1 ? 'is-first' : ''),
        interactive: false, keyboard: false
      }).addTo(map));
      if (draftPts.length >= 3) {
        hintDone.disabled = false;
        hintText.textContent = 'עוד פינה, לחיצה על הנקודה הזהובה — או "סיום"';
      }
      // ‏null ולא pt: הנקודה כבר בתוך draftPts, וקצה "חי" שמצויר עליה היה
      // מכפיל אותה. במגע אין mousemove וזה כל מה שמצייר את הקו.
      redrawDraft(null);
    }

    function onAreaMove(e) {
      if (!draftPts.length) return;
      redrawDraft([e.latlng.lat, e.latlng.lng]);
    }

    function redrawDraft(cursor) {
      var pts = draftPts.concat(cursor && draftPts.length ? [cursor] : []);
      if (pts.length < 2) return;
      if (!draftLine) {
        draftLine = L.polyline(pts, {
          color: SHAPE_STYLE.color, weight: 2, dashArray: '7 5', className: 'mapdraw-live', interactive: false
        }).addTo(map);
      } else {
        draftLine.setLatLngs(pts);
      }
    }

    function closeArea() {
      if (draftPts.length < 3) return;
      var ring = draftPts.slice();
      clearDraft();
      stopAreaListeners();
      setShapeArea(ring);
    }

    function stopAreaListeners() {
      map.off('click', onAreaClick);
      map.off('mousemove', onAreaMove);
      setDrawingCursor(false);
      hideHint();
      mode = null;
      emitMode();
    }

    function setShapeArea(ring) {
      clearShape();
      shape = { kind: 'area', ring: ring };
      layer = L.polygon(ring, SHAPE_STYLE).addTo(map);
      ring.forEach(function (pt, i) {
        var h = L.marker(pt, { icon: squareIcon(11), draggable: true, keyboard: false, zIndexOffset: 900 }).addTo(map);
        h.on('drag', function () {
          var ll = h.getLatLng();
          shape.ring[i] = [ll.lat, ll.lng];
          layer.setLatLngs(shape.ring);
          placeLabel();
        });
        // ‏dragend ולא drag: סינון של אלף נכסים בכל פריים גרירה מקפיא את המפה
        h.on('dragend', emitChange);
        handles.push(h);
      });
      placeLabel();
      emitChange();
    }

    /* ================= רדיוס (עיגול) ================= */

    function startRadius() {
      cancelSilently();
      mode = 'radius';
      emitMode();
      setDrawingCursor(true);
      map.on('click', onRadiusClick);
      showHint('לחצו על המפה כדי לקבוע את מרכז החיפוש', { presets: true });
    }

    function onRadiusClick(e) {
      setRadiusAt(e.latlng, DEFAULT_RADIUS_M);
    }

    function stopRadiusListeners() {
      map.off('click', onRadiusClick);
      setDrawingCursor(false);
      hideHint();
      mode = null;
      emitMode();
    }

    /* גם נקודת הסיום של הציור בעכבר וגם מה שהרדיוסים המוכנים קוראים לו,
       ולכן שתי הדרכים מגיעות בהכרח לאותה תוצאה. */
    function setRadiusAt(latlng, meters) {
      var center = latlng.lat !== undefined ? [latlng.lat, latlng.lng] : latlng;
      var r = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, meters || DEFAULT_RADIUS_M));
      if (mode === 'radius') stopRadiusListeners();
      clearShape();
      shape = { kind: 'radius', center: center, radius: r };
      layer = L.circle(center, Object.assign({ radius: r }, SHAPE_STYLE)).addTo(map);

      // ידית המרכז מזיזה את העיגול; ידית ההיקף משנה את הרדיוס. שתיהן
      // עגולות ולא מרובעות, כדי שלא יתבלבלו עם פינות המצולע.
      var mid = L.marker(center, { icon: squareIcon(13, 'is-round'), draggable: true, keyboard: false, zIndexOffset: 900 }).addTo(map);
      mid.on('drag', function () {
        var ll = mid.getLatLng();
        shape.center = [ll.lat, ll.lng];
        layer.setLatLng(ll);
        edge.setLatLng(edgePoint());
        placeLabel();
      });
      mid.on('dragend', emitChange);

      var edge = L.marker(edgePoint(), { icon: squareIcon(13, 'is-round'), draggable: true, keyboard: false, zIndexOffset: 900 }).addTo(map);
      edge.on('drag', function () {
        var d = map.distance(L.latLng(shape.center), edge.getLatLng());
        shape.radius = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, d));
        layer.setRadius(shape.radius);
        placeLabel();
      });
      edge.on('dragend', function () {
        // הידית "נצמדת" חזרה להיקף אחרי שהרדיוס נחסם במינימום/מקסימום
        edge.setLatLng(edgePoint());
        emitChange();
      });

      handles.push(mid, edge);
      placeLabel();
      emitChange();

      /* נקודת הידית: **מערבה** מהמרכז, כלומר בצד שמאל של המסך — מאותה סיבה
         שהתווית שם (ראו placeLabel): זהו הצד שאינו מוסתר מתחת לעמודת
         החיפוש. ידית שנוחתת מתחת לכרטיס החיפוש אמנם עדיין נגררת, אבל היא
         לא נראית, ולכן אף אחד לא ינסה.

         המרה של מטרים למעלות אורך תלויה בקו הרוחב; בלעדיה הידית מתרחקת
         מההיקף ככל שמתרחקים מקו המשווה. */
      function edgePoint() {
        var latRad = shape.center[0] * Math.PI / 180;
        var degPerMeter = 1 / (111320 * Math.max(0.2, Math.cos(latRad)));
        return [shape.center[0], shape.center[1] - shape.radius * degPerMeter];
      }
    }

    /* ================= בקרה ================= */

    function cancelSilently() {
      clearDraft();
      if (mode === 'area') stopAreaListeners();
      else if (mode === 'radius') stopRadiusListeners();
      else hideHint();
    }

    /* ביטול באמצע ציור מחזיר את המצב הקודם ולא מוחק צורה קיימת: מי שלחץ/ה
       "רדיוס" בטעות בזמן שיש כבר אזור מסומן לא צריך/ה לאבד אותו. */
    function cancel() {
      cancelSilently();
    }

    function clear() {
      cancelSilently();
      var had = !!shape;
      clearShape();
      if (had) emitChange();
    }

    function contains(lat, lng) {
      if (!shape) return true;   // אין סימון — הכול "בפנים"
      var y = Number(lat), x = Number(lng);
      if (!isFinite(y) || !isFinite(x)) return false;
      if (shape.kind === 'area') return pointInRing(y, x, shape.ring);
      return map.distance(L.latLng(shape.center), L.latLng(y, x)) <= shape.radius;
    }

    function bounds() {
      return layer ? layer.getBounds() : null;
    }

    function onKeyDown(e) {
      if (e.key !== 'Escape' || !mode) return;
      cancel();
    }
    document.addEventListener('keydown', onKeyDown);

    function detach() {
      if (destroyed) return;
      destroyed = true;
      cancelSilently();
      clearShape();
      document.removeEventListener('keydown', onKeyDown);
      if (hint.parentNode) hint.parentNode.removeChild(hint);
    }
    map.on('unload', detach);

    return {
      startArea: startArea,
      startRadius: startRadius,
      setRadius: setRadiusAt,
      cancel: cancel,
      clear: clear,
      contains: contains,
      shape: publicShape,
      bounds: bounds,
      mode: function () { return mode; },
      hasShape: function () { return !!shape; },
      detach: detach
    };
  }

  global.MapDraw = { attach: attach };
})(window);
