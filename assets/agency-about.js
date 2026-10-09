/* ============================================================================
   "על המשרד" - הטקסט שבראש דף המשרד
   ----------------------------------------------------------------------------
   ‏מקור אחד לשרת ולדפדפן: נטען כ-`<script src>` ב-`agency.html`, **ומיובא**
   ב-`netlify/edge-functions/og-tags.ts`, שכותב את אותן פסקאות כבר בשרת.
   ולכן אין כאן `export`, והתוצאה היא רשימת פסקאות ולא HTML - כל צד בונה
   ממנה לבד (‏textContent בדפדפן, בריחה בשרת).

   ‏**התיאור שהמשרד כתב** (‏agencies.description, נערך ב-CRM תחת "מיתוג
   המשרד") הוא הטקסט. ‏**משרד שעוד לא כתב** מקבל משפט עובדתי מהנתונים
   שהוא עצמו מסר - שם, כתובת ואזורי פעילות - ולא נוסח שיווקי מומצא. בלי
   כתובת ובלי אזורים אין מה לומר, והמקטע אינו מוצג.

   ‏נולד מבדיקת ה-SEO של 9.10.2026: לאף אחד מ-26 המשרדים לא היה תיאור, ודף
   המשרד היה שם ורשימה. ‏docs/social-preview.md.
   ========================================================================== */
(function (root) {
  var DESCRIPTION_MAX = 1200;

  function clean(s) {
    return String(s == null ? '' : s).trim();
  }

  function paragraphs(agency) {
    var a = agency || {};
    var own = clean(a.description).slice(0, DESCRIPTION_MAX);
    if (own) {
      return own.replace(/\r\n/g, '\n').split(/\n{2,}/)
        .map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); })
        .filter(Boolean);
    }

    var name = clean(a.name);
    var address = clean(a.address);
    var areas = (Array.isArray(a.specialty_areas) ? a.specialty_areas : [])
      .map(clean).filter(Boolean).slice(0, 5);
    if (!name || (!address && !areas.length)) return [];

    // ‏נוסח בלי מין דקדוקי: שם המשרד הוא לפעמים שם של אדם ("אביה גולדברג -
    // תיווך נדל"ן"), ו"הוא משרד" היה שגוי בדיוק שם.
    var s = 'משרד התיווך ' + name + (address ? ', ' + address : '') + '.';
    if (areas.length) s += ' אזורי פעילות: ' + joinHe(areas) + '.';
    return [s, 'בדף הזה: הנכסים הפעילים של המשרד, המתווכים שעובדים בו ודרכי יצירת קשר.'];
  }

  /* ‏"א, ב ו-ג" */
  function joinHe(list) {
    if (list.length < 2) return list[0] || '';
    return list.slice(0, -1).join(', ') + ' ו' + list[list.length - 1];
  }

  root.ShukAgencyAbout = { paragraphs: paragraphs, DESCRIPTION_MAX: DESCRIPTION_MAX };
})(typeof window !== 'undefined' ? window : globalThis);
