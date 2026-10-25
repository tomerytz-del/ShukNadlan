#!/usr/bin/env node
/* גיליון השלמת הפרטים: הפריטים באים מ-onbModel, וההחלטה מתי להציג
   אינה תלויה בדפדפן.

   הרצה: node scripts/profile_nudge_test.js
*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

global.document = {
  getElementById() { return null; },
  addEventListener() {},
};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/crm-onboarding.js'), 'utf8'), {
  filename: 'assets/crm-onboarding.js',
});
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'assets/crm-profile-nudge.js'), 'utf8'), {
  filename: 'assets/crm-profile-nudge.js',
});

const N = global.ProfileNudge;
assert.ok(N && typeof N.items === 'function', 'ProfileNudge לא נטען');

function state(over) {
  return Object.assign({
    is_manager: false,
    whatsapp_done: false,
    profile_done: false,
    agency_done: false,
    property_done: false,
    client_done: false,
    agreement_done: false,
    lead_done: false,
    just_finished: false,
    about_done: false,
    license_done: false,
    bio_done: false,
    calendar_done: false,
    prefs_done: false,
    cover_done: false,
    review_done: false,
    invite_done: false,
    whatsapp_included: true,
    agent_steps: true,
  }, over);
}

function agent(over) {
  return Object.assign({
    photo_url: '',
    bio: '',
    phone: '',
    license_number: '',
    service_markets: [],
  }, over);
}

const PAY_WORDS = /שדרוג|תשלום|מנוי|מסלול|wallet|checkout|pricing/i;
const FAKE_STAT = /\d+\s*%|יותר פניות|פי \d/;

function assertCopy(list) {
  list.forEach(item => {
    assert.ok(item.title && item.line && item.cta, item.id + ' בלי נוסח');
    assert.ok(!PAY_WORDS.test(item.title + item.line + item.cta), item.id + ' נשמע כמו תשלום: ' + item.cta);
    assert.ok(!FAKE_STAT.test(item.line), item.id + ' עם מספר שלא נמדד: ' + item.line);
    assert.ok(!/[—–]/.test(item.title + item.line + item.cta), item.id + ' עם מקף ארוך');
  });
}

const fresh = N.items(state({ is_manager: true }), agent());
assert.deepStrictEqual(fresh.map(i => i.id), [
  'photo', 'license', 'areas', 'phone', 'property', 'logo', 'bio',
  'whatsapp', 'client', 'calendar', 'prefs', 'about',
]);
assert.equal(N.nextItem(fresh).id, 'photo');
assert.equal(N.progress(fresh).text, '0 מתוך 12 הושלמו');
assertCopy(fresh);
assert.equal(fresh.find(i => i.id === 'license').focus, 'pfLicense');
assert.equal(fresh.find(i => i.id === 'license').kind, 'field');

const withNumber = N.items(state({ is_manager: true }), agent({ license_number: '12345' }));
const lic = withNumber.find(i => i.id === 'license');
assert.equal(lic.kind, 'appeal');
assert.equal(lic.focus, '');
assert.ok(lic.cta.indexOf('אישור') !== -1);

const afterPhoto = N.items(state({ profile_done: true }), agent({
  photo_url: 'https://example.test/a.jpg',
  service_markets: [],
}));
assert.equal(afterPhoto.find(i => i.id === 'photo').done, true);
assert.equal(N.nextItem(afterPhoto).id, 'license');

const areasNext = N.items(state({
  profile_done: true,
  license_done: true,
}), agent({
  photo_url: 'https://example.test/a.jpg',
  license_number: '99',
  bio: 'קצר',
  service_markets: [],
}));
assert.equal(N.nextItem(areasNext).id, 'areas');
assert.equal(areasNext.find(i => i.id === 'areas').focus, 'pfAreas');

const bioNext = N.items(state({
  profile_done: true,
  license_done: true,
}), agent({
  photo_url: 'https://example.test/a.jpg',
  license_number: '99',
  bio: '',
  phone: '0500000000',
  service_markets: ['afula'],
}));
assert.equal(bioNext.find(i => i.id === 'areas').done, true);
assert.equal(bioNext.find(i => i.id === 'phone').done, true);
assert.equal(N.nextItem(bioNext).id, 'property');

const sentence = 'א'.repeat(N.BIO_MIN);
const waNext = N.items(state({
  profile_done: true,
  license_done: true,
  property_done: true,
  bio_done: true,
}), agent({
  photo_url: 'https://example.test/a.jpg',
  license_number: '99',
  bio: sentence,
  phone: '0500000000',
  service_markets: ['afula'],
}));
assert.equal(waNext.find(i => i.id === 'photo').done, true);
assert.equal(waNext.find(i => i.id === 'bio').done, true);
assert.equal(waNext.find(i => i.id === 'areas').done, true);
assert.equal(N.nextItem(waNext).id, 'whatsapp');

const paygo = N.items(state({ whatsapp_included: false, is_manager: false }), agent());
const payIds = paygo.map(i => i.id);
assert.ok(!payIds.includes('phone') && !payIds.includes('whatsapp') && !payIds.includes('calendar'), payIds.join(','));
assert.ok(!payIds.includes('logo') && !payIds.includes('about'), payIds.join(','));
assertCopy(paygo);

const officeOnly = N.items(state({
  agent_steps: false,
  is_manager: true,
  agency_done: false,
  about_done: false,
  invite_done: false,
}), agent());
assert.deepStrictEqual(officeOnly.map(i => i.id), ['logo', 'about', 'invite']);
assert.equal(N.nextItem(officeOnly).id, 'logo');
assert.equal(officeOnly.find(i => i.id === 'logo').focus, 'brLogoInput');

const logoDone = N.items(state({
  agent_steps: false,
  is_manager: true,
  agency_done: true,
  about_done: false,
  invite_done: false,
}), agent());
assert.equal(N.nextItem(logoDone).id, 'about');

assert.deepStrictEqual(N.items(null, agent()), []);
assert.deepStrictEqual(N.items(state({ just_finished: true }), agent()), []);

const unknownMarkets = N.items(state(), agent({ service_markets: undefined }));
assert.ok(!unknownMarkets.some(i => i.id === 'areas'), 'בלי המערך אין לדעת אם האזורים חסרים');

const baseEnv = {
  mobile: true,
  nativeApp: false,
  dashboard: true,
  mfa: false,
  modalOpen: false,
  elapsedMs: 1200,
  seenSession: false,
  snoozeUntil: 0,
  now: 1_000_000,
  pending: true,
};
assert.equal(N.decision(baseEnv).reason, 'ok');
assert.equal(N.decision(Object.assign({}, baseEnv, { mobile: false })).reason, 'desktop');
assert.equal(N.decision(Object.assign({}, baseEnv, { mobile: false, nativeApp: true })).reason, 'ok');
assert.equal(N.decision(Object.assign({}, baseEnv, { seenSession: true })).reason, 'session');
assert.equal(N.decision(Object.assign({}, baseEnv, { snoozeUntil: baseEnv.now + 1 })).reason, 'snooze');
assert.equal(N.decision(Object.assign({}, baseEnv, { snoozeUntil: baseEnv.now })).reason, 'ok');
assert.equal(N.decision(Object.assign({}, baseEnv, { pending: false })).reason, 'complete');
assert.equal(N.decision(Object.assign({}, baseEnv, { elapsedMs: 999 })).reason, 'delay');
assert.equal(N.decision(Object.assign({}, baseEnv, { elapsedMs: 1000 })).reason, 'ok');
assert.equal(N.decision(Object.assign({}, baseEnv, { modalOpen: true })).reason, 'modal');
assert.equal(N.decision(Object.assign({}, baseEnv, { mfa: true })).reason, 'screen');
assert.equal(N.decision(Object.assign({}, baseEnv, { dashboard: false })).reason, 'screen');

const mem = {
  local: new Map(),
  session: new Map(),
};
const store = {
  local: { getItem: k => mem.local.get(k) || null, setItem: (k, v) => mem.local.set(k, v) },
  session: { getItem: k => mem.session.get(k) || null, setItem: (k, v) => mem.session.set(k, v) },
};
N.writeSeen(store);
N.writeSnooze(store, 5000);
const gate = N.readGate(store, 5000);
assert.equal(gate.seenSession, true);
assert.equal(gate.snoozeUntil, 5000 + N.SNOOZE_MS);
assert.equal(N.SNOOZE_MS, 24 * 60 * 60 * 1000);

const src = fs.readFileSync(path.join(ROOT, 'assets/crm-profile-nudge.js'), 'utf8');
['profile_nudge_shown', 'profile_nudge_completed_click', 'profile_nudge_later', 'profile_nudge_dismissed']
  .forEach(name => {
    assert.ok(src.includes("shukTrack('" + name + "'"), 'חסרה קריאת shukTrack ל-' + name);
  });
assert.ok(src.includes('אעדכן אחר כך'));
assert.ok(!src.includes('accSubscriptions') && !src.includes('accWallet') && !src.includes('/checkout'));

const prog = N.progress([
  { done: true }, { done: true }, { done: true },
  { done: false }, { done: false }, { done: false }, { done: false },
]);
assert.equal(prog.text, '3 מתוך 7 הושלמו');

console.log('profile nudge: ' + fresh.length + ' פריטים למנהל/ת חדש/ה, ההחלטה והנוסח עברו');
