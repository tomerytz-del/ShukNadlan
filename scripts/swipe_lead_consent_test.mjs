/* תיבת האישור בהחלקה: אחת לכל נכס, ולא מסומנת כשעוברים לנכס הבא.
   אין קריאה לפרודקשן: supabase מזויף, וכל POST לפונקציות נעצר בדפדפן.

       node scripts/swipe_lead_consent_test.mjs
*/
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const playwrightMod = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import('playwright');
const { chromium } = playwrightMod.chromium ? playwrightMod : playwrightMod.default;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const IMG = 'https://obookujgolazrwycsiyn.supabase.co/storage/v1/object/public/property-images/';
const APT = '11111111-1111-4111-8111-111111111111';
const HOUSE = '22222222-2222-4222-8222-222222222222';

function prop(id, extra) {
  return Object.assign({
    id: id,
    price: 1590000,
    price_unit: 'total',
    title: 'דירה בעפולה',
    description: '',
    marketing_description: '',
    rooms: 4,
    size_sqm: 110,
    floor: 3,
    city: 'עפולה',
    city_id: '33333333-3333-4333-8333-333333333333',
    street: 'הנשיא',
    address: '',
    house_number: '',
    property_type: 'דירה',
    deal_type: 'sale',
    category: 'residential',
    created_at: '2026-11-10T00:00:00Z',
    lat: 32.61,
    lng: 35.29,
    is_promoted: false,
    images: [IMG + id + '.jpg'],
    features: [],
    agent_id: 'agent-1',
    agency_id: null,
    listing_number: 4201,
    neighborhoods: { name: 'מרכז' },
    agencies: null,
    video_url: null,
    video_poster_url: null,
    open_house: false
  }, extra);
}

const PROPS = [
  prop(APT, { title: 'דירת 4 חדרים', created_at: '2026-11-12T00:00:00Z' }),
  prop(HOUSE, { title: 'בית פרטי', property_type: 'בית פרטי', price: 2400000, created_at: '2026-11-08T00:00:00Z', listing_number: 4203 })
];
const AGENTS = [{ id: 'agent-1', display_name: 'דנה כהן', slug: 'dana', phone_e164: '972501112233', photo_url: '' }];

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/swipe' || urlPath === '/swipe/') urlPath = '/swipe.html';
      const file = normalize(join(root, urlPath));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = readFileSync(file);
        res.writeHead(200);
        res.end(body);
      } catch (e) {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const html = readFileSync(join(root, 'swipe.html'), 'utf8');
const visitAt = html.indexOf('src="assets/visit-attr.js"');
const eventsAt = html.indexOf('src="assets/events.js"');
const swipeAt = html.indexOf('src="assets/swipe.js"');
assert.ok(html.includes('<script defer src="assets/visit-attr.js"></script>'), 'visit-attr נטען ב-defer');
assert.ok(visitAt > 0 && visitAt < eventsAt && eventsAt < swipeAt, 'visit-attr לפני events.js ולפני swipe.js');

const server = await serve();
const base = 'http://127.0.0.1:' + server.address().port;
const leads = [];
const browser = await chromium.launch({ args: ['--no-proxy-server'] });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL'
  });
  await context.addInitScript({ content: `(() => {
    const PROPS = ${JSON.stringify(PROPS)};
    const AGENTS = ${JSON.stringify(AGENTS)};
    function qb(table) {
      const self = {
        select() { return self; }, eq() { return self; }, order() { return self; },
        limit() { return self; }, range() { return self; }, in() { return self; }, or() { return self; },
        then(ok, err) {
          const data = table === 'properties' ? PROPS : table === 'agency_members_public' ? AGENTS : [];
          return Promise.resolve({ data: data, error: null }).then(ok, err);
        }
      };
      return self;
    }
    const mock = { createClient() { return { from: qb }; } };
    Object.defineProperty(window, 'supabase', { configurable: true, get() { return mock; }, set() {} });
    try {
      localStorage.setItem('sk_swipe_tour_seen_mobile', '2');
      localStorage.setItem('sk_swipe_tour_seen_desktop', '2');
    } catch (e) {}
  })();` });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/supabase\.co\/functions\/v1\//.test(url)) {
      leads.push(url);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (/\/storage\/v1\/(render\/image|object)\/public\//.test(url)) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return;
    }
    if (/googletagmanager|google-analytics|fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr\.net/.test(url)) {
      const type = /fonts\.googleapis/.test(url) ? 'text/css' : 'application/javascript';
      await route.fulfill({ status: 200, contentType: type, body: '' });
      return;
    }
    await route.continue();
  });
  await page.goto(base + '/swipe?utm_medium=paid&utm_source=facebook', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#swTopCard .sw-card', { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.ShukPaidSocial()), true);

  await page.locator('#swTopCard .sw-cmain').click();
  await page.waitForSelector('#swCtaBar .sw-consent input');
  await page.locator('#swCtaBar .sw-consent input').check();
  assert.equal(await page.locator('#swLConsent').isChecked(), true);
  await page.locator('#swSheet .sw-x').click();
  await page.waitForSelector('#swSheet', { state: 'hidden' });

  const box = await page.locator('#swTopCard .sw-card').boundingBox();
  const y = box.y + box.height * 0.45;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 - 170, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const title = await page.locator('#swTopCard .sw-ctitle').evaluate((el) => el.textContent.trim());
  assert.equal(title, 'בית פרטי');

  await page.locator('#swTopCard .sw-cmain').click();
  await page.waitForSelector('#swCtaBar .sw-consent input');
  const state = await page.evaluate(() => {
    const all = Array.prototype.slice.call(document.querySelectorAll('#swLConsent'));
    const shown = document.querySelector('#swCtaBar .sw-consent input');
    return { n: all.length, checked: shown && shown.checked, same: shown === document.getElementById('swLConsent') };
  });
  assert.deepEqual(state, { n: 1, checked: false, same: true });

  await page.locator('#swLName').fill('דנה');
  await page.locator('#swLPhone').fill('0501112233');
  await page.locator('#swCta').click();
  await page.waitForTimeout(200);
  assert.match(await page.locator('#swLErr').innerText(), /לסמן את האישור/);
  assert.equal(leads.length, 0);
  await page.locator('#swSheet .sw-x').click();
  await page.waitForSelector('#swSheet', { state: 'hidden' });

  await page.locator('#swRailAdv').click();
  await page.waitForSelector('#swBsBody [data-contact="wa"]');
  const tracked = await page.evaluate((id) => {
    const wa = document.querySelector('#swBsBody [data-contact="wa"]');
    const call = document.querySelector('#swBsBody [data-contact="call"]');
    const lead = document.querySelector('#swBsBody [data-bs-lead]');
    return {
      first: lead && lead.textContent.trim(),
      waId: wa && wa.getAttribute('data-property-id'),
      callId: call && call.getAttribute('data-property-id'),
      waHref: wa && wa.getAttribute('href'),
      callHref: call && call.getAttribute('href')
    };
  }, HOUSE);
  assert.equal(tracked.first, 'השארת פרטים');
  assert.equal(tracked.waId, HOUSE);
  assert.equal(tracked.callId, HOUSE);
  assert.match(tracked.waHref, /^https:\/\/wa\.me\//);
  assert.match(tracked.callHref, /^tel:\+972/);
  assert.equal(leads.length, 0);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('ok swipe lead consent');
} finally {
  await browser.close();
  server.close();
}
