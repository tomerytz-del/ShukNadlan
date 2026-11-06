/* ============================================================================
   עלויות רכישת דירה - "כמה מזומן צריך להביא"
   ----------------------------------------------------------------------------
   חישוב אחד לשני המחשבונים: דף הבית (‏#calc, assets/home.js) ודף הנכס
   (‏#calcCard, assets/property.js). עד 7.11.2026 המדרגות ישבו רק בדף הנכס; מחשבון
   שני עם עותק משלו היה נשאר עם מדרגות ישנות באחד הדפים בלי שום סימן, ולכן הן
   כאן ורק כאן (‏scripts/purchase_costs_test.cjs חוסם מדרגה שמופיעה בקובץ אחר).

   ## מדרגות מס הרכישה - לעדכן ב-16 בינואר
   אלה המדרגות של 16.1.2025 לפי רשות המיסים, ש**חוק ההסדרים הקפיא (בלי עדכון
   מדד) עד 15.1.2028** - ולכן הן גם של 2026 ו-2027. ב-16.1.2028 לעדכן את
   ‏TAX_SINGLE ו-TAX_EXTRA ואת TAX_AS_OF (מוצג בשורת ההסתייגות).

   ## מה שאינו מס - שיעורים מקובלים, לא הצעת מחיר
   עו״ד 0.5%, תיווך 2%, שניהם + מע״מ 18%, ופתיחת תיק, שמאי ורישום כ-7,000 ₪ (רק
   כשיש משכנתא). ההסכם קובע בפועל, וההסתייגות בדף אומרת זאת.

   חישוב טהור: בלי DOM ובלי רשת, ולכן הוא עובד גם כשה-CDN חסום ונבדק ב-node.
   ‏docs/mortgage-leads.md.
   ============================================================================ */
(function (global) {
  'use strict';

  var TAX_AS_OF = '2026';
  /* ‏[תקרת המדרגה, שיעור]. דירה יחידה: חמש מדרגות. דירה נוספת: שתיים. */
  var TAX_SINGLE = [[1978745, 0], [2347040, 0.035], [6055070, 0.05], [20183565, 0.08], [Infinity, 0.10]];
  var TAX_EXTRA = [[6055070, 0.08], [Infinity, 0.10]];
  var VAT = 0.18;
  var LAWYER_PCT = 0.005;
  var BROKER_PCT = 0.02;
  var BANK_FIXED = 7000;

  function bracketTax(price, brackets) {
    var tax = 0, prev = 0;
    for (var i = 0; i < brackets.length; i++) {
      if (price <= prev) break;
      tax += (Math.min(price, brackets[i][0]) - prev) * brackets[i][1];
      prev = brackets[i][0];
    }
    return Math.round(tax);
  }

  /* ‏buyer: 'single' (דירה יחידה, ברירת המחדל) או 'extra' (דירה נוספת) */
  function tax(price, buyer) {
    return bracketTax(Number(price) || 0, buyer === 'extra' ? TAX_EXTRA : TAX_SINGLE);
  }

  /* ‏opts: { price, equity, buyer, noBrokerFee }. ‏noBrokerFee - נכס ביריד הבתים
     הפתוחים נמכר בלי עמלת תיווך (assets/open-house.js). ההון העצמי נכנס כמו
     שהוא, והמשכנתא (‏price - equity) קובעת רק אם יש פתיחת תיק. */
  function breakdown(opts) {
    var price = Number(opts && opts.price) || 0;
    var equity = Math.max(Number(opts && opts.equity) || 0, 0);
    var loan = Math.max(price - equity, 0);
    var t = tax(price, opts && opts.buyer);
    var lawyer = Math.round(price * LAWYER_PCT * (1 + VAT));
    var broker = opts && opts.noBrokerFee ? 0 : Math.round(price * BROKER_PCT * (1 + VAT));
    var bank = loan > 0 ? BANK_FIXED : 0;
    return {
      price: price,
      equity: Math.round(equity),
      loan: loan,
      tax: t,
      lawyer: lawyer,
      broker: broker,
      bank: bank,
      total: Math.round(equity) + t + lawyer + broker + bank,
    };
  }

  /* ההון העצמי הנמוך ביותר שהבנק יאשר למחיר נתון, לפי תקרת מימון (‏0.75 = 75%).
     נשאר שבר: העיגול לצעד של הסליידר נעשה במי שמציג. */
  function minEquity(price, ltvCap) {
    var p = Number(price) || 0, cap = Number(ltvCap);
    if (!(p > 0) || !(cap >= 0 && cap <= 1)) return 0;
    return Math.max(p * (1 - cap), 0);
  }

  global.PurchaseCosts = {
    TAX_AS_OF: TAX_AS_OF,
    TAX_SINGLE: TAX_SINGLE,
    TAX_EXTRA: TAX_EXTRA,
    VAT: VAT,
    LAWYER_PCT: LAWYER_PCT,
    BROKER_PCT: BROKER_PCT,
    BANK_FIXED: BANK_FIXED,
    tax: tax,
    breakdown: breakdown,
    minEquity: minEquity,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
