/* הוו של לחיצת היריד בדפדפן: נשלח ברקע, בלי לעצור את הקישור.
   node scripts/fair_contact_client_test.mjs
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROP = 'c0000000-0000-0000-0000-000000000001';

const store = new Map();
const listeners = [];
const sandbox = {
  window: null,
  document: {
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    },
  },
  sessionStorage: {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, v),
  },
  crypto: { getRandomValues: (bytes) => { bytes.fill(7); return bytes; } },
  navigator: {},
  Blob: function Blob(parts, opts) { this.parts = parts; this.type = opts && opts.type; },
  fetch: null,
  encodeURIComponent,
  Uint8Array,
  module: { exports: {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/fair-contact.js'), 'utf8'), sandbox, {
  filename: 'assets/fair-contact.js',
});
const api = sandbox.module.exports;

assert.equal(listeners.length, 2, 'מאזין אחד ל-click ואחד ל-auxclick');
assert.equal(listeners[0].capture, true);
assert.equal(api.install(sandbox), undefined);
assert.equal(listeners.length, 2, 'install שני אינו מוסיף מאזין');

const sid = api.sessionToken();
assert.match(sid, /^[a-f0-9]{32}$/);
assert.equal(api.sessionToken(), sid, 'הסשן יציב באותה לשונית');
assert.equal(sid.includes('050'), false);

const link = {
  getAttribute(name) {
    return {
      'data-fair-contact': 'whatsapp',
      'data-fair-property': PROP.toUpperCase(),
      'data-fair-page': 'property',
    }[name] || null;
  },
};
const child = { closest: (sel) => (sel === '[data-fair-contact]' ? link : null) };
const payload = api.clickPayload(link, sid);
assert.equal(payload.property_id, PROP);
assert.equal(payload.channel, 'whatsapp');
assert.equal(payload.source_page, 'property');
assert.equal(payload.client_session, sid);
assert.deepEqual(Object.keys(payload).sort(), ['channel', 'client_session', 'property_id', 'source_page']);
assert.equal('phone' in payload, false);
assert.equal('name' in payload, false);
assert.equal(api.clickPayload({ getAttribute: () => 'sms' }, sid), null);

const beacons = [];
let fetched = null;
const prevented = [];
function event(type, button) {
  return {
    type,
    button,
    target: child,
    preventDefault() { prevented.push('prevent'); },
    stopPropagation() { prevented.push('stop'); },
  };
}
sandbox.navigator.sendBeacon = (url, blob) => {
  beacons.push({ url, blob });
  return true;
};
api.onClick(event('click', 0));
assert.equal(beacons.length, 1);
assert.equal(prevented.length, 0, 'הלחיצה אינה נעצרת');
assert.match(beacons[0].url, /\/functions\/v1\/fair-contact-log\?apikey=/);
assert.equal(beacons[0].blob.type, 'text/plain;charset=UTF-8');
const sent = JSON.parse(beacons[0].blob.parts[0]);
assert.equal(sent.channel, 'whatsapp');
assert.equal(sent.property_id, PROP);
assert.equal(sent.client_session, sid);
assert.equal('phone' in sent, false);
assert.equal(fetched, null, 'sendBeacon שהצליח אינו קורא ל-fetch');

sandbox.navigator.sendBeacon = () => false;
sandbox.fetch = (url, init) => {
  fetched = { url, init };
  return { catch() {} };
};
const ret = api.send(payload);
assert.equal(ret, true);
assert.equal(typeof ret.then, 'undefined', 'השליחה אינה הבטחה שממתינים לה');
assert.equal(fetched.init.keepalive, true);
assert.equal(fetched.init.method, 'POST');
assert.equal(fetched.init.headers['Content-Type'], 'text/plain;charset=UTF-8');

api.onClick(event('auxclick', 2));
assert.equal(beacons.length, 1, 'קליק ימני אינו נרשם');
api.onClick(event('auxclick', 1));
assert.equal(beacons.length, 1, 'התור מלא, אז אין ביקון נוסף');
assert.match(fetched.url, /fair-contact-log$/);

api.onClick({ type: 'click', button: 0, target: { closest: () => null }, preventDefault() { prevented.push('prevent'); } });
assert.equal(prevented.length, 0);

console.log('fair contact client: ok');
