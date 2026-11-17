/**
 * לאן "פנייה לתמיכה" במסך שאין בו רשת.
 *
 * המסך ארוז באפליקציה ונפתח כשהמסמך הראשי נכשל, אז אי אפשר לטעון את
 * קובצי האתר. המספרים כאן הם עותק של שני מקורות האמת, והבדיקה
 * mobile/test/support-audience.test.mjs נכשלת אם הם מתפצלים:
 *   גולש/ת, אורח/ת, או תפקיד לא ידוע - NUMBER ב-assets/bot-link.js
 *   מתווך/ת מחובר/ת - ASSISTANT_WA_NUMBER ב-assets/crm.js
 * הטקסט על הכפתור לא נקבע כאן.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShukSupport = api;
})(typeof window !== 'undefined' ? window : null, function () {
  var CUSTOMER_WA = '972533242100';
  var BROKER_WA = '972532494740';

  function href(audience) {
    return 'https://wa.me/' + (audience === 'broker' ? BROKER_WA : CUSTOMER_WA);
  }

  return {
    CUSTOMER_WA: CUSTOMER_WA,
    BROKER_WA: BROKER_WA,
    href: href,
  };
});
