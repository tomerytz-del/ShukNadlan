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

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('android targets API 36, the Play minimum for new apps', () => {
  const vars = read('../android/variables.gradle');
  assert.match(vars, /compileSdkVersion = 36/);
  assert.match(vars, /targetSdkVersion = 36/);
  assert.match(read('../capacitor.config.js'), /adjustMarginsForEdgeToEdge:\s*'auto'/);
});

test('android does not back up the session to the cloud', () => {
  const manifest = read('../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
});

test('ios hands the APNs token to Capacitor and declares push', () => {
  const delegate = read('../ios/App/App/AppDelegate.swift');
  assert.match(delegate, /didRegisterForRemoteNotificationsWithDeviceToken[\s\S]*capacitorDidRegisterForRemoteNotifications/);
  assert.match(delegate, /didFailToRegisterForRemoteNotificationsWithError[\s\S]*capacitorDidFailToRegisterForRemoteNotifications/);
  assert.match(read('../ios/App/App/App.entitlements'), /<key>aps-environment<\/key>/);
  const plist = read('../ios/App/App/Info.plist');
  assert.match(plist, /<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>/);
});

test('the privacy manifest declares the pixel as tracking', () => {
  const privacy = read('../ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<true\/>/);
  assert.match(privacy, /<string>connect\.facebook\.net<\/string>/);
  assert.match(privacy, /NSPrivacyCollectedDataTypeEmailAddress/);
});
