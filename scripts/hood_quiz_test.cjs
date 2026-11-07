/* ============================================================================
   "איזו שכונה מתאימה לי?" - הדירוג מול נתונים שחושבו ביד
   ----------------------------------------------------------------------------
   ‏`assets/hood-quiz-core.js` מדרג שכונות לפי המודעות הפעילות. הכשל כאן שקט:
   נכס מסחרי או מגרש שנכנס לספירה, "4 חדרים" שמפספס 4.5, או נכס בלי חדרים שעובר
   סינון חדרים - והמסך מציג דירוג "הגיוני". לכן כל כלל נבדק מול נתונים קטנים.

   הרצה:   node scripts/hood_quiz_test.cjs
   ‏יציאה 0 = הכול תקין. התיעוד: docs/home-page-sections.md.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'assets/hood-quiz-core.js'));
const Q = globalThis.HoodQuiz;

let failed = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  קיבלנו ${JSON.stringify(got)}, ציפינו ל-${JSON.stringify(want)}`}`);
}

let n = 0;
const P = (hood, o) => Object.assign({
  id: 'p' + (++n), neighborhood_id: hood, neighborhood_name: { A: 'אלפא', B: 'בטא', C: 'גמא' }[hood],
  deal_type: 'sale', category: 'residential', property_type: 'דירה', price_unit: 'total', price: 1500000, rooms: 4, features: [],
}, o);

// אלפא: 4 דירות 4 חדרים (1.2M, 1.4M, 1.6M, 1.8M), אחת 3 חדרים, אחת 4.5, וגם מסחרי, מגרש, מחיר למ"ר, בלי שכונה, ובלי חדרים
const props = [
  P('A', { price: 1200000 }), P('A', { price: 1400000 }), P('A', { price: 1600000 }), P('A', { price: 1800000 }),
  P('A', { price: 1000000, rooms: 3 }), P('A', { price: 1300000, rooms: 4.5 }),
  P('A', { price: 900000, category: 'commercial', property_type: 'חנות' }),
  P('A', { price: 700000, property_type: 'מגרש', rooms: null }),
  P('A', { price: 12000, price_unit: 'sqm' }),
  P(null, { price: 800000 }),
  P('A', { price: 1100000, rooms: null }),
  // בטא: שתי דירות 4 חדרים, אחת עם מעלית
  P('B', { price: 1500000, features: ['elevator'] }), P('B', { price: 1700000 }),
  // גמא: דירה אחת ב-2.5M ושכירות אחת
  P('C', { price: 2500000 }), P('C', { price: 4500, deal_type: 'rent' }),
];
const hasFeature = (p, code) => (p.features || []).indexOf(code) >= 0;
const rank = (a) => Q.rank(props, Object.assign({ deal: 'sale', budget: 1500000, rooms: 'any', feats: [] }, a), { hasFeature });
const sig = (r) => r.results.map(x => `${x.name}:${x.matches}`).join(',');

/* ---- מי נספר ---- */
eq('נכס מסחרי, מגרש, מחיר למ"ר ובלי שכונה אינם נספרים (נכסים תקפים לקנייה: 10)', rank({}).eligible, 10);
eq('דירוג ברירת מחדל (בתקציב 1.5M): מי שיש בה הכי הרבה התאמות ראשונה', sig(rank({})), 'אלפא:5,בטא:1');
eq('השכרה: רק גמא', sig(rank({ deal: 'rent', budget: 5000 })), 'גמא:1');
eq('נכס מעל התקציב אינו נספר (בתקציב 1.2M רק שלוש באלפא, ובטא נעלמת)', sig(rank({ budget: 1200000 })), 'אלפא:3');
eq('נכס שמחירו בדיוק התקציב נספר (בטא, 1.5M)', rank({}).results.find(r => r.name === 'בטא').max, 1500000);

/* ---- חדרים ---- */
eq('4 חדרים כולל 4.5, בלי 3 ובלי נכס בלי חדרים', sig(rank({ rooms: '4' })), 'אלפא:3,בטא:1');
eq('3 חדרים: רק האחת באלפא', sig(rank({ rooms: '3' })), 'אלפא:1');
eq('5 חדרים ומעלה: אין התאמה (אף נכס עם 5)', sig(rank({ rooms: '5' })), '');
eq('חדרים "לא משנה" כולל גם נכס בלי חדרים', rank({ rooms: 'any' }).results.find(r => r.name === 'אלפא').matches, 5);

/* ---- מאפיינים ---- */
eq('מעלית: רק בטא', sig(rank({ feats: ['elevator'] })), 'בטא:1');
eq('קוד מאפיין לא מוכר נזרק (לא מסנן)', sig(rank({ feats: ['nope'] })), 'אלפא:5,בטא:1');

/* ---- סטטיסטיקה לשכונה ---- */
const a = rank({ rooms: '4' }).results[0];
eq('אלפא, 4 חדרים בתקציב 1.5M: מחירים 1.2M, 1.3M, 1.4M', [a.matches, a.min, a.max, a.median], [3, 1200000, 1400000, 1300000]);
eq('מחיר טיפוסי (חציון כל המודעות לחדרים האלה, גם מעל התקציב): 5 מודעות', [a.poolCount, a.typical], [5, 1400000]);
const b = rank({ rooms: '4' }).results[1];
eq('בטא עם שתי מודעות: אין מחיר טיפוסי (מתחת ל-3)', [b.poolCount, b.typical], [2, null]);

/* ---- בלי התאמה: הכי קרוב ---- */
const none = rank({ budget: 800000 });
eq('בלי התאמה בתקציב: results ריק', none.results.length, 0);
eq('הכי קרוב: אלפא (1.0M, 25% מעל), בטא (1.5M), גמא (2.5M)', none.nearest.map(x => `${x.name}:${x.cheapest}:${x.overPct}`), ['אלפא:1000000:25', 'בטא:1500000:88', 'גמא:2500000:213']);
eq('כשיש התאמות אין "הכי קרוב"', rank({}).nearest.length, 0);

/* ---- תקציב ---- */
eq('תקציב פתיחה: חציון המחירים של הקנייה, מעוגל לצעד', Q.defaultBudget(props, 'sale'), Q.clampBudget('sale', 1450000));
eq('תקציב פתיחה בלי נכסים: ברירת המחדל', Q.defaultBudget([], 'rent'), 4500);
eq('תקציב נחתך לטווח (מעל המקסימום)', Q.clampBudget('sale', 99000000), 5000000);
eq('תקציב נחתך לטווח (מתחת למינימום)', Q.clampBudget('rent', 100), 1500);
eq('תקציב מעוגל לצעד של 250 בשכירות', Q.clampBudget('rent', 4620), 4500);

/* ---- "העלאת התקציב": הצעד הקרוב מעל המחיר, ובלי הצעה מעבר לתקרה ---- */
eq('העלאת תקציב: עיגול למעלה לצעד של 50,000', Q.raiseTo('sale', 1230000), 1250000);
eq('העלאת תקציב: מחיר על הצעד נשאר', Q.raiseTo('sale', 1200000), 1200000);
eq('העלאת תקציב: מעל תקרת הסליידר - אין הצעה', Q.raiseTo('sale', 7200000), null);
eq('העלאת תקציב בשכירות: צעד 250', Q.raiseTo('rent', 4620), 4750);
eq('העלאת תקציב בשכירות: מעל 12,000 - אין הצעה', Q.raiseTo('rent', 13000), null);

/* ---- בלי hasFeature מוזרק: ליבת החיפוש כשנטענה, אחרת קריאת features ---- */
eq('בלי hasFeature מוזרק, נופל לקריאת features', Q.rank(props, { deal: 'sale', budget: 1500000, rooms: 'any', feats: ['elevator'] }).results.map(r => r.name), ['בטא']);

/* ---- הדף טוען את הקובץ לפני הקוד שקורא לו ---- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const core = html.indexOf('<script src="assets/hood-quiz-core.js"></script>');
const home = html.indexOf('<script src="assets/home.js"></script>');
eq('index.html: hood-quiz-core.js נטען לפני home.js', core > 0 && home > core, true);

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log('\nהכול תקין');
