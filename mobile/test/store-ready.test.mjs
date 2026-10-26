import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apple = fs.readFileSync(new URL('../../assets/apple-signin.js', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../../assets/pwa-install.js', import.meta.url), 'utf8');

test('apple sign-in stays off until the owner turns the flag on', () => {
  assert.match(apple, /window\.SHUK_APPLE_SIGNIN\s*=\s*false/);
  assert.doesNotMatch(apple, /window\.SHUK_APPLE_SIGNIN\s*=\s*true/);
  assert.match(apple, /התחברות עם Apple/);
  assert.match(apple, /provider:\s*'apple'/);
  assert.equal(apple.includes('\u2014'), false);
  assert.equal(apple.includes('\u2013'), false);
});

test('the install banner bails out before counting a visit inside the app', () => {
  const guard = pwa.indexOf('ShukNadlanApp');
  const count = pwa.indexOf('countVisit()');
  assert.ok(guard > 0);
  assert.ok(count > guard);
});
