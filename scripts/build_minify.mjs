// ‏הקטנת קובצי האתר בזמן הפריסה ב-Netlify - בעותק שנפרס, לא בריפו.
//
//   node scripts/build_minify.mjs <נתיב ל-esbuild> [תיקיית אתר]
//
// ‏למה: אין לאתר שלב בנייה, ולכן כל הערה בקוד יצאה לכל גולש/ת. ב-2.11.2026
// ‏`assets/crm.js` היה 573KB דחוסים, ומהם כ-40% הערות; ‏`crm.html` היה 220KB,
// ‏ומהם 146KB הערות CSS ו-109KB הערות HTML (לפני דחיסה). ההערות הן התיעוד של
// ‏המפתחים, ונשארות בריפו כמו שהן - רק העותק שנפרס מוקטן. ‏docs/netlify-usage.md,
// ‏"הקטנה בפריסה".
//
// ‏שלושה כללים, וכל אחד נכנס בגלל מה שהיה נשבר בלעדיו:
//
// ‏1. **‏JS - רווחים והערות בלבד** (‏minifyWhitespace). בלי שינוי שמות ובלי שכתוב
//    ‏תחביר: אותם טוקנים, באותו סדר. נמדד שזה נותן כמעט את כל הרווח (‏crm.js
//    ‏573→348KB, מול 343KB בהקטנה מלאה) בלי הסיכון של שינוי התנהגות.
// ‏2. **הערות HTML שהן סמנים - נשארות.** ‏Edge Functions מוצאות לפיהן איפה להזריק
//    ‏את התוכן מהשרת (‏`<!--/deals-->`, ‏`<!--area-links-->`, ‏`<!--/hero-->`).
//    ‏הערה שכולה מילה אחת בלי רווח היא סמן ונשארת; מחיקה שלה הייתה משאירה את
//    ‏הדף בלי התוכן מהשרת - בשקט. ‏`<script>` ו-`<style>` אינם נוגעים בהערות HTML.
// ‏3. **‏כשל = הקובץ המקורי, לא בנייה שנכשלה.** קובץ שלא נקרא נשאר כמו שהוא, ואם
//    ‏esbuild לא הותקן בכלל - שום דבר לא מוקטן והאתר נפרס כמו היום. בנייה שנופלת
//    ‏הייתה עוצרת גם תיקון דחוף.
//
// ‏ומה לא נוגעים בו: ‏`vendor/` (‏integrity), קובץ ב-`assets/` שפונקציה ב-`netlify/`
// ‏מייבאת (היא נארזת מהקובץ, ושינוי בו אינו חלק מהשאלה), וקובץ ש-HTML טוען עם
// ‏`integrity`.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const esbuildPath = process.argv[2];
const root = resolve(process.argv[3] || '.');
let esbuild;
try {
  esbuild = createRequire(import.meta.url)(esbuildPath);
} catch (e) {
  console.log(`[minify] esbuild לא זמין (${e.message}) - האתר נפרס בלי הקטנה`);
  process.exit(0);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// ‏מה ש-netlify/ מייבא מ-assets/ - נשאר כמו שהוא
const skip = new Set();
for (const f of walk(join(root, 'netlify')).filter(f => /\.(m?[jt]s)$/.test(f))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:import|from)\s*\(?\s*["']([^"']+)["']/g)) {
    if (m[1].startsWith('.')) skip.add(resolve(dirname(f), m[1]));
  }
}
// ‏וקובץ שנטען עם integrity מתוך HTML
const htmlFiles = readdirSync(root).filter(n => n.endsWith('.html')).map(n => join(root, n));
for (const f of htmlFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (!/\bintegrity=/.test(m[0])) continue;
    const u = (m[0].match(/\b(?:src|href)="\/?([^"?#]+)"/) || [])[1];
    if (u && !/^https?:/.test(u)) skip.add(resolve(root, u));
  }
}

let before = 0, after = 0, done = 0, kept = 0;
const kb = n => (n / 1024).toFixed(0) + 'KB';

// ‏1. JS
for (const f of walk(join(root, 'assets')).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'))) {
  if (skip.has(f)) { kept++; continue; }
  const src = readFileSync(f, 'utf8');
  try {
    const r = esbuild.transformSync(src, { minifyWhitespace: true, charset: 'utf8', legalComments: 'none', logLevel: 'silent' });
    if (!r.code || r.code.length > src.length) { kept++; continue; }
    writeFileSync(f, r.code);
    before += src.length; after += r.code.length; done++;
  } catch (e) {
    kept++;
    console.log(`[minify] נשאר כמו שהוא: ${relative(root, f)} - ${String(e.message).split('\n')[0]}`);
  }
}

// ‏2. HTML: הערות CSS בתוך <style>, והערות HTML שאינן סמנים
function stripCssComments(css) {
  let out = '', i = 0, q = null;
  while (i < css.length) {
    const c = css[i];
    if (q) { out += c; if (c === '\\') { out += css[i + 1] || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) return null;            // הערה שלא נסגרה - לא נוגעים בבלוק
      out += ' '; i = end + 2; continue;   // רווח ולא כלום: הערה מפרידה בין טוקנים
    }
    out += c; i++;
  }
  return out;
}
const MARKER = /^<!--\/?[\w-]+-->$/;
for (const f of htmlFiles) {
  const src = readFileSync(f, 'utf8');
  const parts = src.split(/(<script\b[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<textarea\b[\s\S]*?<\/textarea>|<pre\b[\s\S]*?<\/pre>)/i);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i % 2 === 1) {
      const m = p.match(/^(<style\b[^>]*>)([\s\S]*?)(<\/style>)$/i);
      if (m) { const css = stripCssComments(m[2]); if (css !== null) parts[i] = m[1] + css + m[3]; }
      continue;
    }
    parts[i] = p.replace(/<!--[\s\S]*?-->/g, c => MARKER.test(c) ? c : '');
  }
  const out = parts.join('');
  // ‏רשת ביטחון: אותם סמנים באותו סדר, אחרת הדף נשאר כמו שהוא
  const marks = s => (s.match(/<!--\/?[\w-]+-->/g) || []).join('|');
  if (marks(out) !== marks(src)) { kept++; console.log(`[minify] נשאר כמו שהוא (סמנים): ${relative(root, f)}`); continue; }
  if (out.length < src.length) { writeFileSync(f, out); before += src.length; after += out.length; done++; }
}

console.log(`[minify] ${done} קבצים הוקטנו (${kb(before)} → ${kb(after)} לפני דחיסה), ${kept} נשארו כמו שהם`);
