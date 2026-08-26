/**
 * בדיקות ל-share-meta.ts.
 *
 *   node --experimental-strip-types netlify/edge-functions/share-meta.test.mjs
 *
 * מריץ את הפונקציה האמיתית תחת הסרת הטיפוסים של Node, עם Deno ו-fetch
 * מדומים. Node לא יכול להריץ את סביבת ה-edge של Netlify, אבל הלוגיקה של
 * הכתיבה מחדש היא JS תקני לגמרי — וזה המקום שבו באגים יסתתרו.
 *
 * שתי הבדיקות שחייבות להישאר ירוקות מעל כולן:
 *   · בריחת תווים — כותרת נכס עם גרש או < לא יכולה לשבור את ה-HTML
 *   · נפילת Supabase — כל כשל מחזיר את העמוד בדיוק כמו שהיה
 */
import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

globalThis.Deno = { env: { get: () => undefined } };

const HTML = fs.readFileSync(path.join(root, 'property.html'), 'utf8');

let nextRows = [];      // what the stubbed Supabase returns
let lastUrl = null;
let failMode = null;    // 'throw' | 'status' | null

globalThis.fetch = async (url) => {
  lastUrl = String(url);
  if (failMode === 'throw') throw new Error('network down');
  if (failMode === 'status') return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => nextRows };
};

const { default: handler } = await import(path.join(here, 'share-meta.ts'));

const makeCtx = (body = HTML, type = 'text/html; charset=utf-8') => ({
  next: async () => new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(body.length) } }),
});

const grab = (html, key) => {
  const attr = key.startsWith('og:') ? 'property' : 'name';
  const m = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`));
  return m ? m[1] : null;
};
const title = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

console.log('\nshare-meta edge function');

await test('property with photo: price-first title, real photo as og:image', async () => {
  failMode = null;
  nextRows = [{ title: 'דירת 4 חדרים, רמת דוד', price: 1480000, deal_type: 'sale',
                rooms: 4, property_type: 'דירה', city: 'עפולה',
                images: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p1'), makeCtx());
  const html = await res.text();
  assert.match(title(html), /₪1,480,000/, 'price missing from <title>');
  assert.match(grab(html, 'og:title'), /₪1,480,000 · דירת 4 חדרים/);
  assert.equal(grab(html, 'og:image'), 'https://cdn.example.com/a.jpg');
  assert.equal(grab(html, 'twitter:image'), 'https://cdn.example.com/a.jpg');
  assert.match(grab(html, 'og:description'), /4 חדרים · דירה · עפולה/);
  assert.equal(grab(html, 'og:url'), 'https://shuknadlan.co.il/property.html?id=p1');
  // wrong dimensions cause bad cropping, so they must be gone for a real photo
  assert.equal(grab(html, 'og:image:width'), null, 'og:image:width should be dropped');
  assert.equal(grab(html, 'og:image:height'), null, 'og:image:height should be dropped');
  assert.equal(grab(html, 'og:image:type'), null, 'og:image:type should be dropped');
});

await test('rent listing gets the /חוד׳ suffix', async () => {
  nextRows = [{ title: 'דירת 3 חדרים', price: 4200, deal_type: 'rent', rooms: 3,
                property_type: 'דירה', city: 'עפולה', images: [] }];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p2'), makeCtx());
  const html = await res.text();
  assert.match(grab(html, 'og:title'), /₪4,200\/חוד׳/);
});

await test('property with no photos keeps the branded default card', async () => {
  nextRows = [{ title: 'מגרש למכירה', price: 900000, deal_type: 'sale', rooms: null,
                property_type: 'מגרש', city: 'עפולה', images: [] }];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p3'), makeCtx());
  const html = await res.text();
  assert.match(grab(html, 'og:image'), /share-default\.png$/);
  assert.equal(grab(html, 'og:image:width'), '1200', 'default card keeps its dimensions');
});

await test('quotes and angle brackets in a title cannot break out of the attribute', async () => {
  nextRows = [{ title: `דירת 3 חד' "משופצת" <script>alert(1)</script>`, price: 1000000,
                deal_type: 'sale', rooms: 3, property_type: 'דירה', city: 'עפולה', images: [] }];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p4'), makeCtx());
  const html = await res.text();
  const og = grab(html, 'og:title');
  assert.ok(og.includes('&quot;'), 'double quote not escaped');
  assert.ok(og.includes('&#39;'), 'single quote not escaped');
  assert.ok(og.includes('&lt;script&gt;'), 'angle brackets not escaped');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag reached the document');
  // the tag itself must still be well formed
  assert.match(html, /<meta property="og:title" content="[^"]*">/);
});

await test('supabase throwing leaves the page byte-identical', async () => {
  failMode = 'throw';
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p5'), makeCtx());
  assert.equal(await res.text(), HTML);
});

await test('supabase 500 leaves the page byte-identical', async () => {
  failMode = 'status';
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p6'), makeCtx());
  assert.equal(await res.text(), HTML);
});

await test('unknown id leaves the page byte-identical', async () => {
  failMode = null; nextRows = [];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=nope'), makeCtx());
  assert.equal(await res.text(), HTML);
});

await test('no id param: no lookup, page untouched', async () => {
  lastUrl = null;
  const res = await handler(new Request('https://shuknadlan.co.il/property.html'), makeCtx());
  assert.equal(await res.text(), HTML);
  assert.equal(lastUrl, null, 'should not have queried supabase');
});

await test('non-HTML responses pass straight through', async () => {
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p1'),
                            makeCtx('{"a":1}', 'application/json'));
  assert.equal(await res.text(), '{"a":1}');
});

await test('agent with a uuid slug is looked up by id, not slug', async () => {
  nextRows = [{ display_name: 'דנה לוי', bio: '', photo_url: null }];
  await handler(new Request('https://shuknadlan.co.il/agent.html?slug=3f2504e0-4f89-11d3-9a0c-0305e82c3301'), makeCtx());
  assert.match(lastUrl, /id=eq\./, `expected id lookup, got ${lastUrl}`);
  await handler(new Request('https://shuknadlan.co.il/agent.html?slug=dana-levi'), makeCtx());
  assert.match(lastUrl, /slug=eq\./, `expected slug lookup, got ${lastUrl}`);
});

await test('agency uses cover, falling back to logo', async () => {
  nextRows = [{ name: 'נדל״ן גלבוע', cover_url: null, logo_url: 'https://cdn.example.com/logo.png' }];
  const res = await handler(new Request('https://shuknadlan.co.il/agency.html?slug=gilboa'), makeCtx());
  const html = await res.text();
  assert.equal(grab(html, 'og:image'), 'https://cdn.example.com/logo.png');
  assert.match(grab(html, 'og:title'), /נדל״ן גלבוע/);
});

await test('cache headers split on the query string', async () => {
  nextRows = [{ title: 'x', price: 1, deal_type: 'sale', rooms: 1, property_type: 'דירה', city: 'עפולה', images: [] }];
  const res = await handler(new Request('https://shuknadlan.co.il/property.html?id=p9'), makeCtx());
  assert.match(res.headers.get('Netlify-CDN-Cache-Control'), /s-maxage=300/);
  assert.equal(res.headers.get('content-length'), null, 'stale content-length must be dropped');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
