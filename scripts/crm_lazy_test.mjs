/**
 * סקריפטי ה-CRM לא חוסמים את הציור, והכבדים נטענים עם המסך.
 *
 *     node scripts/crm_lazy_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'crm.html'), 'utf8');
const lazy = readFileSync(join(root, 'assets', 'crm-lazy.js'), 'utf8');

test('אין סקריפט src שחוסם את הציור', () => {
  const tags = html.match(/<script\b[^>]*>/g) || [];
  const src = tags.filter(t => /\ssrc=/.test(t));
  const blocking = src.filter(t => !/\sdefer\b/.test(t) && !/\sasync\b/.test(t));
  assert.equal(blocking.length, 0, blocking.join('\n'));
  assert.ok(src.length >= 30);
});

test('המכולה נדחית אבל נשארת, וה-noscript במקום', () => {
  assert.match(html, /shukLoadTrackers\s*=\s*function/);
  assert.match(html, /shukArmTrackers/);
  assert.match(html, /GTM-NZHD7ZHT/);
  assert.match(html, /gtm\.js\?id=/);
  const body = html.split(/<body\b[^>]*>/i)[1] || '';
  assert.match(body, /^[\s\n]*<!-- Google Tag Manager \(noscript\) -->/);
});

test('סקריפטי מסך לא יושבים ב-head', () => {
  for (const src of ['leaflet.js', 'map-tiles.js', 'govmap.js', 'agreement-doc.js', 'open-house.js']) {
    assert.equal(html.includes(src), false, src);
    assert.match(lazy, new RegExp(src.replace('.', '\\.')));
  }
  assert.match(html, /auth-return\.js/);
  assert.match(html, /crm-lazy\.js/);
});

test('auth-return נשאר לפני supabase, שניהם defer', () => {
  const a = html.indexOf('assets/auth-return.js');
  const s = html.indexOf('supabase.js');
  assert.ok(a > 0 && s > a);
  const slice = html.slice(a - 40, s + 20);
  assert.match(slice, /defer/);
});
