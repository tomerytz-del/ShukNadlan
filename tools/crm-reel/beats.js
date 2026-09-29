// One still per beat (at beat + OFFSET s) and a contact sheet of all 28.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OFFSET = +(process.env.OFFSET || 0.3);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1440 } });
  page.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exit(1); });
  await page.goto('file://' + path.join(__dirname, 'reel.html'));
  await page.evaluate(() => window.ready);
  const font = await page.evaluate(() => document.fonts.check('600 24px Heebo'));
  if (!font) throw new Error('Heebo did not load');

  // loop check: the page at t=0 and at t→T must be identical
  const a = await page.evaluate(() => { seek(0); return document.getElementById('stage').innerHTML; });
  const b = await page.evaluate(() => { seek(T - 1e-7); return document.getElementById('stage').innerHTML; });
  const rn = x => x.replace(/-?\d+\.\d+/g, m => (+m).toFixed(2)).replace(/-0\.00/g, "0.00"); console.log("loop seam identical (2dp):", rn(a) === rn(b)); if (rn(a) !== rn(b)) { const A = rn(a), B = rn(b); let i = 0; while (A[i] === B[i]) i++; console.log(A.slice(i - 80, i + 60)); console.log(B.slice(i - 80, i + 60)); }

  fs.mkdirSync(path.join(__dirname, 'frames'), { recursive: true });
  for (let i = 0; i < 28; i++) {
    const t = i * 0.5 + OFFSET;
    await page.evaluate(t => seek(t), t);
    await page.screenshot({ path: path.join(__dirname, 'frames', `beat${String(i + 1).padStart(2, '0')}.png`) });
  }
  const tiles = Array.from({ length: 28 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `<figure><img src="frames/beat${n}.png"><figcaption>ביט ${i + 1} · ${(i * 0.5).toFixed(1)}s</figcaption></figure>`;
  }).join('');
  const sheet = `<!doctype html><html dir="rtl"><style>
    @font-face{font-family:Heebo;src:url(fonts/Heebo.ttf)}
    body{margin:0;background:#fff;font-family:Heebo}
    .g{display:grid;grid-template-columns:repeat(4,400px);gap:14px;padding:18px}
    figure{margin:0} img{width:400px;height:400px;display:block;border-radius:6px}
    figcaption{font:500 17px Heebo;padding:5px 2px 0}</style><div class="g">${tiles}</div></html>`;
  fs.writeFileSync(path.join(__dirname, 'sheet.html'), sheet);
  const sp = await browser.newPage({ viewport: { width: 4 * 414 + 22, height: 800 } });
  await sp.goto('file://' + path.join(__dirname, 'sheet.html'));
  await sp.waitForLoadState('load');
  await sp.screenshot({ path: path.join(__dirname, 'beats-sheet.png'), fullPage: true });
  await browser.close();
  console.log('done');
})();
