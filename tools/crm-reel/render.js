// Full render: every screenshot goes straight into ffmpeg (image2pipe), nothing
// is written to disk. 4 sub-frames per output frame, spread over half a frame
// duration, merged with tmix; select keeps the frame where all 4 were merged.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const FFMPEG = process.env.FFMPEG;
const FPS = 60, SUB = 4, WORKERS = +(process.env.WORKERS || 4);
const OUT = path.join(__dirname, 'reel-1440.mp4');

(async () => {
  const browser = await chromium.launch();
  const pages = [];
  for (let i = 0; i < WORKERS; i++) {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1440 } });
    p.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exit(1); });
    await p.goto('file://' + path.join(__dirname, 'reel.html'));
    await p.evaluate(() => window.ready);
    if (!await p.evaluate(() => document.fonts.check('600 24px Heebo'))) throw new Error('Heebo did not load');
    pages.push(p);
  }
  const T = await pages[0].evaluate(() => window.T);
  const frames = Math.round(T * FPS);

  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
    '-vf', `tmix=frames=${SUB},select=eq(mod(n\\,${SUB})\\,${SUB - 1}),setpts=N/(${FPS}*TB)`,
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = buf => new Promise(res => ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res));

  // sample times: centred on the frame, spanning half of its duration
  const times = [];
  for (let n = 0; n < frames; n++)
    for (let k = 0; k < SUB; k++) times.push(n / FPS + (k - (SUB - 1) / 2) * (0.5 / FPS) / SUB);

  const t0 = Date.now();
  // workers render ahead in parallel; frames are written strictly in order
  for (let i = 0; i < times.length; i += WORKERS) {
    const batch = times.slice(i, i + WORKERS);
    const shots = await Promise.all(batch.map((t, j) =>
      pages[j].evaluate(t => seek(t), t).then(() => pages[j].screenshot({ type: 'png' }))));
    for (const s of shots) await write(s);
    if ((i / WORKERS) % 200 === 0) console.log(`${i}/${times.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c))));
  await browser.close();
  console.log('done', OUT, ((Date.now() - t0) / 1000).toFixed(0) + 's');
})();
