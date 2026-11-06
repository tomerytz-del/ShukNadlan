/* ============================================================================
   עלויות רכישה: מדרגות מס הרכישה במקום אחד, והחישוב נכון
   ----------------------------------------------------------------------------
   ‏`assets/purchase-costs.js` מחזיק את המדרגות לשני המחשבונים (דף הבית ודף הנכס).
   הכשל כאן שקט: מחשבון שני עם עותק משלו ממשיך להציג מספר "תקין" עם מדרגות שהיו
   נכונות פעם, ומי שמעדכן ב-16.1.2028 מעדכן רק אחד. לכן שלושה דברים נבדקים:

     1. החישוב מול ערכים שחושבו ביד מהמדרגות של רשות המיסים.
     2. המדרגות (המספרים) אינן מופיעות באף קובץ אחר.
     3. שני הדפים טוענים את הקובץ לפני הקוד שקורא לו.

   הרצה:   node scripts/purchase_costs_test.cjs
   ‏יציאה 0 = הכול תקין. התיעוד: docs/mortgage-leads.md.
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'assets/purchase-costs.js'));
const PC = globalThis.PurchaseCosts;

let failed = 0;
function eq(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  קיבלנו ${got}, ציפינו ל-${want}`}`);
}

/* ---- 1. החישוב. ערכים שחושבו ביד: ‏(מחיר - תקרת המדרגה הקודמת) * שיעור, מעוגל בסוף ---- */
eq('דירה יחידה 1,000,000 - פטור', PC.tax(1000000, 'single'), 0);
eq('דירה יחידה בדיוק על התקרה הראשונה - פטור', PC.tax(1978745, 'single'), 0);
eq('דירה יחידה 2,000,000 - 3.5% על 21,255', PC.tax(2000000, 'single'), 744);
eq('דירה יחידה 2,500,000 - שתי מדרגות', PC.tax(2500000, 'single'), 20538);
eq('דירה יחידה 7,000,000 - ארבע מדרגות', PC.tax(7000000, 'single'), 273886);
eq('דירה נוספת 1,500,000 - 8% מהשקל הראשון', PC.tax(1500000, 'extra'), 120000);
eq('דירה נוספת 2,500,000', PC.tax(2500000, 'extra'), 200000);
eq('דירה נוספת 7,000,000 - עד המדרגה 8%, ומעליה 10%', PC.tax(7000000, 'extra'), 578899);
eq('ברירת מחדל = דירה יחידה', PC.tax(2500000), 20538);
eq('מחיר לא מספרי - אפס', PC.tax('x', 'single'), 0);

const b = PC.breakdown({ price: 1700000, equity: 423000, buyer: 'single' });
eq('פירוק: עו״ד 0.5% + מע״מ', b.lawyer, 10030);
eq('פירוק: תיווך 2% + מע״מ', b.broker, 40120);
eq('פירוק: מס רכישה', b.tax, 0);
eq('פירוק: פתיחת תיק כשיש משכנתא', b.bank, 7000);
eq('פירוק: סך המזומן', b.total, 480150);
eq('פירוק: דירה נוספת', PC.breakdown({ price: 1700000, equity: 423000, buyer: 'extra' }).total, 616150);
eq('בלי עמלת תיווך (יריד הבתים הפתוחים)', PC.breakdown({ price: 1700000, equity: 423000, noBrokerFee: true }).broker, 0);
eq('בלי משכנתא - בלי פתיחת תיק', PC.breakdown({ price: 1000000, equity: 1000000 }).bank, 0);
eq('הון עצמי שלילי נחתך לאפס', PC.breakdown({ price: 1000000, equity: -5 }).equity, 0);
const over = PC.breakdown({ price: 300000, equity: 350000 });
eq('הון עצמי מעל המחיר נחתך למחיר', over.equity, 300000);
eq('הון עצמי מעל המחיר: בלי משכנתא ובלי פתיחת תיק', over.bank, 0);
eq('הון עצמי מעל המחיר: סך המזומן אינו עולה על מחיר + עלויות', over.total, 300000 + over.tax + over.lawyer + over.broker);

eq('הון עצמי מינימלי ל-75% מימון', PC.minEquity(1000000, 0.75), 250000);
eq('הון עצמי מינימלי ל-50% מימון', PC.minEquity(1000000, 0.5), 500000);
eq('הון עצמי מינימלי - תקרה לא תקינה', PC.minEquity(1000000, 2), 0);
eq('הון עצמי מינימלי - בלי מחיר', PC.minEquity(0, 0.75), 0);

/* המס אינו קופץ בגבול מדרגה ואינו יורד כשהמחיר עולה: טעות בהקלדת מדרגה נראית כאן */
let jumps = 0, drops = 0;
for (const buyer of ['single', 'extra']) {
  for (let p = 500000; p < 8000000; p += 997) {
    const d = PC.tax(p + 1, buyer) - PC.tax(p, buyer);
    if (d < 0) drops++;
    if (d > 1) jumps++;
  }
  for (const [cap] of (buyer === 'single' ? PC.TAX_SINGLE : PC.TAX_EXTRA)) {
    if (!isFinite(cap)) continue;
    const d = PC.tax(cap + 1, buyer) - PC.tax(cap, buyer);
    if (d < 0 || d > 1) jumps++;
  }
}
eq('המס אינו יורד כשהמחיר עולה', drops, 0);
eq('המס אינו קופץ בגבול מדרגה', jumps, 0);

/* ---- 2. המדרגות במקום אחד ---- */
const LITERALS = ['1978745', '2347040', '6055070', '20183565'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'docs', 'verify', 'marketing', 'course-content']);
const EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.html', '.py', '.sql']);
const OWNER = path.join('assets', 'purchase-costs.js');
const OK_FILES = new Set([OWNER, path.join('scripts', 'purchase_costs_test.cjs')]);
const stray = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full);
    const st = fs.statSync(full);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue; }
    if (!EXT.has(path.extname(name)) || OK_FILES.has(rel)) continue;
    // supabase/migrations: טקסט היסטורי של מיגרציות, לא חישוב
    if (rel.startsWith(path.join('supabase', 'migrations'))) continue;
    const text = fs.readFileSync(full, 'utf8').replace(/[,_]/g, '');
    for (const lit of LITERALS) if (text.includes(lit)) stray.push(`${rel} (${lit})`);
  }
})(ROOT);
eq('מדרגות מס הרכישה מופיעות רק ב-assets/purchase-costs.js' + (stray.length ? `: ${stray.join(', ')}` : ''), stray.length, 0);

/* ---- 3. שני הדפים טוענים את הקובץ לפני הקוד שקורא לו ---- */
for (const [page, script] of [['index.html', 'assets/home.js'], ['property.html', 'assets/property.js']]) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const a = html.indexOf('<script src="assets/purchase-costs.js"></script>');
  const c = html.indexOf(`<script src="${script}"></script>`);
  eq(`${page}: purchase-costs.js נטען לפני ${script}`, a > 0 && c > a, true);
}

if (failed) {
  console.error(`\n${failed} בדיקות נכשלו`);
  process.exit(1);
}
console.log('\nהכול תקין');
