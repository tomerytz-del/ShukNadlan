/**
 * מייצר את assets/share-default.png מתוך assets/share-default.html.
 *
 * ה-PNG הוא ה-og:image של כל העמודים הציבוריים, ולכן הוא מוקבע ב-git ולא
 * נבנה בזמן ריצה — סורקי הקישורים של וואטסאפ/פייסבוק מושכים קובץ סטטי.
 * הסקריפט קיים כדי שאפשר יהיה לערוך את התבנית ולייצר מחדש בפקודה אחת,
 * במקום לפתוח עורך גרפי.
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   node scripts/build-share-image.mjs
 *
 * אם כבר יש Chromium במכונה ואין טעם להוריד עוד עותק, אפשר להצביע עליו:
 *   CHROMIUM_PATH=/path/to/chrome node scripts/build-share-image.mjs
 *
 * דורש חיבור לאינטרנט: הגופנים (Frank Ruhl Libre, Heebo) נטענים מ-Google
 * Fonts. הסקריפט מוודא שהם באמת נטענו לפני הצילום ונכשל אחרת — עדיף
 * להיכשל מאשר להוציא תמונת שיתוף בגופן ברירת מחדל.
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets', 'share-default.html');
const output = path.join(root, 'assets', 'share-default.png');

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});

await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

const fontsLoaded = await page.evaluate(() => ({
  serif: document.fonts.check('700 4rem "Frank Ruhl Libre"'),
  sans:  document.fonts.check('400 1.4rem "Heebo"'),
}));

if (!fontsLoaded.serif || !fontsLoaded.sans) {
  await browser.close();
  console.error('הגופנים לא נטענו:', fontsLoaded);
  console.error('התמונה לא נוצרה — בדקו את החיבור ל-fonts.googleapis.com ונסו שוב.');
  process.exit(1);
}

await page.screenshot({ path: output, type: 'png' });
await browser.close();
console.log('נוצר:', path.relative(root, output));
