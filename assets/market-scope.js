/* ============================================================================
   ‏MarketScope - "מה שייך לשוק שהדף מציג", פעם אחת לכל האתר

   דף הבית, `/agencies`, `/agents` ו-`/projects` מסננים לפי אותו כלל, ושתי
   גרסאות שלו היו נפרדות בדיוק כשמוסיפים שוק שלישי. docs/regional-pages.md.

   ## שני כללים, והאסימטריה מכוונת

   - **שוק רגיל** (‏/haifa): רק הערים שלו. ‏`include`.
   - **שוק ברירת המחדל** (‏/): כל מה ש**אינו** שייך לשוק אחר - כולל שורה בלי
     עיר מזוהה ושורה בעיר שאין לה שוק. יישובי העמק שעוד לא נכנסו לרישום
     הופיעו באתר עד היום, והסינון אסור שיעלים אותם בשקט. ‏`exclude`.

   ## ‏המיפוי

   ‏`market_cities_public` - מזהה עיר ו-slug של שוק, בלי שמות. נטען פעם אחת
   לדף. **בכשל:** שוק ברירת המחדל אינו מסנן (ההתנהגות שהייתה), ושוק אחר
   **אינו מציג כלום** - עדיף דף ריק לרגע מדף חיפה עם נכסי עפולה.

   ## ‏שורה בלי city_id

   נכס, משרד ושכונה נושאים `city_id`. פרויקט נושא רק `city` טקסטואלי -
   ‏`MarketScope.cityIdOf` אינו מנחש מטקסט, ולכן פרויקט נספר לפי השדה
   `city_id` אם יש, ואחרת כ"בלי עיר" (כלומר בשוק ברירת המחדל בלבד).

   ## ‏אזורי הפעילות - סוכן/ת ומשרד בכמה שווקים

   עיר המשרד קובעת את שוק הבית. בנוסף, כל סוכן/ת בוחר/ת בפרופיל אזורי
   פעילות מהרשימה הסגורה (‏agency_members.service_markets), ומופיע/ה גם
   בהם; משרד מופיע בכל שוק שאחד/ת מחבריו בחר/ה. ‏`inMarket(spec, cityId,
   slugs)` מקבל את הרשימה, ו-`memberMarkets(sb)` טוען אותה פעם אחת לדף.
   **בכשל** (‏view שעוד לא עודכן) - רשימות ריקות, כלומר רק עיר המשרד,
   כמו שהיה. נכסים אינם מושפעים: הם בשוק של העיר שלהם בלבד.
   ============================================================================ */
(function (global) {
  'use strict';

  var NO_CITY = '00000000-0000-0000-0000-000000000000';
  var promise = null;
  var membersPromise = null;

  function activeMarket() {
    var ctx = global.CityContext;
    return (ctx && typeof ctx.market === 'function') ? ctx.market() : null;
  }

  /** ‏{mode:'include'|'exclude', ids:[…]} או null (אין סינון). Promise, ונטען פעם אחת. */
  function spec(sb) {
    if (promise) return promise;
    var market = activeMarket();
    if (!market || !sb) { promise = Promise.resolve(null); return promise; }
    /* ‏PostgREST חותך ב-1,000 שורות בשקט, וב-view יש 1,163 - רשימת ה-exclude הייתה חסרה
       כ-115 ערים של שווקים אחרים (סבב 5 §1). קוראים בעמודים עד עמוד חלקי */
    var PAGE = 1000;
    function page(from, acc) {
      return sb.from('market_cities_public').select('city_id, market_slug').range(from, from + PAGE - 1)
        .then(function (res) {
          if (res.error || !Array.isArray(res.data)) throw res.error || new Error('no data');
          acc = acc.concat(res.data);
          // תקרה של 20 עמודים: שרת שמתעלם מהטווח לא יוביל ללולאה אינסופית
          return res.data.length < PAGE || from >= PAGE * 19 ? { data: acc } : page(from + PAGE, acc);
        });
    }
    promise = page(0, [])
      .then(function (res) {
        if (market.isDefault) {
          var others = res.data.filter(function (r) { return r.market_slug !== market.slug; })
            .map(function (r) { return r.city_id; });
          return others.length ? { mode: 'exclude', ids: others, slug: market.slug } : null;
        }
        var mine = res.data.filter(function (r) { return r.market_slug === market.slug; })
          .map(function (r) { return r.city_id; });
        return { mode: 'include', ids: mine.length ? mine : [NO_CITY], slug: market.slug };
      })
      .catch(function (e) {
        if (global.console) console.warn('מיפוי השווקים לא נטען:', e);
        return market.isDefault ? null : { mode: 'include', ids: [NO_CITY], slug: market.slug };
      });
    return promise;
  }

  /** שורה שכבר נטענה - שייכת לשוק? ‏`slugs` - אזורי הפעילות (רשות). */
  function inMarket(s, cityId, slugs) {
    if (!s) return true;
    if (s.slug && slugs && typeof slugs.indexOf === 'function' && slugs.indexOf(s.slug) !== -1) return true;
    if (s.mode === 'include') return s.ids.indexOf(cityId) !== -1;
    return !cityId || s.ids.indexOf(cityId) === -1;
  }

  /** אזורי הפעילות של הסוכנים: ‏{byAgent: Map(id→[slug]), byAgency: Map(id→[slug])}.
   *  שאילתה נפרדת ולא עמודה בשאילתות הקיימות - עמודה שעוד לא קיימת ב-view
   *  הייתה מפילה את כל הרשימה, וכאן היא מפילה רק את התוספת. */
  function memberMarkets(sb) {
    if (membersPromise) return membersPromise;
    var empty = { byAgent: new Map(), byAgency: new Map() };
    if (!sb || !activeMarket()) { membersPromise = Promise.resolve(empty); return membersPromise; }
    membersPromise = sb.from('agency_members_public').select('id, agency_id, service_markets').limit(2000)
      .then(function (res) {
        if (res.error || !Array.isArray(res.data)) throw res.error || new Error('no data');
        var out = { byAgent: new Map(), byAgency: new Map() };
        res.data.forEach(function (m) {
          var slugs = Array.isArray(m.service_markets) ? m.service_markets.filter(Boolean) : [];
          if (!slugs.length) return;
          out.byAgent.set(m.id, slugs);
          if (!m.agency_id) return;
          var cur = out.byAgency.get(m.agency_id) || [];
          slugs.forEach(function (x) { if (cur.indexOf(x) === -1) cur.push(x); });
          out.byAgency.set(m.agency_id, cur);
        });
        return out;
      })
      .catch(function (e) {
        if (global.console) console.warn('אזורי הפעילות לא נטענו - רק עיר המשרד:', e);
        return empty;
      });
    return membersPromise;
  }

  /** ‏"exclude" כמחרוזת `or`, כדי שקורא שיש לו `or` משלו יאחד אותם לעץ אחד.
   *  לפי העמודה המחושבת `market_slug(properties)` ולא לפי רשימת הערים של
   *  השווקים האחרים: הרשימה ישבה בכתובת, גדלה עם כל שוק, וב-617 ערים (כ-23KB)
   *  השרת ענה 400 ודף הבית נפל לנכסי הדמו (18.10.2026,
   *  ‏20270529100000_properties_market_slug.sql). לכן - לשאילתות properties בלבד. */
  function orFilter(s) {
    if (!s || s.mode !== 'exclude') return null;
    return 'market_slug.is.null,market_slug.eq.' + s.slug;
  }

  /** מחיל על שאילתת properties של supabase-js שאין בה `or` אחר. */
  function apply(query, s) {
    if (!s) return query;
    if (s.mode === 'include') return query.in('city_id', s.ids);
    return query.or(orFilter(s));
  }

  /** שורות properties שכבר נטענו - בלי אלה שבעיר של שוק אחר (‏exclude). שורה בלי
   *  city_id, או בעיר שאין לה שוק, נשארת בשוק ברירת המחדל - כמו הכלל של המודול.
   *  ‏market_slug(properties) במסד מחזירה null לגולש/ת אנונימי/ת (RLS על cities), ולכן
   *  ה-or של apply() מעביר הכול; זו רשת הביטחון בצד הלקוח, גם אחרי שהמיגרציה תוחל. */
  function keepRows(rows, s) {
    if (!s || s.mode !== 'exclude' || !Array.isArray(rows)) return rows;
    var bad = new Set(s.ids);
    return rows.filter(function (r) { return !r || !r.city_id || !bad.has(r.city_id); });
  }

  global.MarketScope = { spec: spec, inMarket: inMarket, memberMarkets: memberMarkets, orFilter: orFilter, apply: apply, keepRows: keepRows, NO_CITY: NO_CITY };
})(typeof globalThis !== 'undefined' ? globalThis : window);
