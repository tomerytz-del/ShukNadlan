import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import support from '../www/support-link.js';
import bridge from '../www/native-bridge.js';

const USER = '11111111-1111-4111-8111-111111111111';
const AGENCY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const AUTH_KEY = 'sb-obookujgolazrwycsiyn-auth-token';
const PERSONAL = '972546929991';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function jwt(sub) {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub })}.sig`;
}

function session(userId, withUser) {
  const row = { access_token: jwt(userId), refresh_token: 'r' };
  if (withUser !== false) row.user = { id: userId };
  return JSON.stringify(row);
}

function storage(map) {
  const keys = () => Object.keys(map);
  return {
    get length() { return keys().length; },
    key(i) { return keys()[i] || null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
  };
}

function readConst(rel, pattern) {
  const src = fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  const found = src.match(pattern);
  assert.ok(found, `${rel} is missing ${pattern}`);
  return found[1];
}

test('a signed-in broker is the only audience that is not a visitor', () => {
  assert.equal(bridge.supportAudience(null), 'visitor');
  assert.equal(bridge.supportAudience(storage({})), 'visitor');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: session(USER),
  })), 'visitor');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: session(USER),
    [`crmAgencyId:${USER}`]: AGENCY,
  })), 'broker');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: session(USER),
    [`crmAgencyId:${OTHER}`]: AGENCY,
  })), 'visitor');
  assert.equal(bridge.supportAudience(storage({
    [`crmAgencyId:${USER}`]: AGENCY,
  })), 'visitor');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: session(USER, false),
    [`crmAgencyId:${USER}`]: AGENCY,
  })), 'broker');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: JSON.stringify({ currentSession: { access_token: jwt(USER), user: { id: USER } } }),
    [`crmAgencyId:${USER}`]: AGENCY,
  })), 'broker');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: session(USER),
    [`crmAgencyId:${USER}`]: 'not-an-office',
  })), 'visitor');
  assert.equal(bridge.supportAudience(storage({
    [AUTH_KEY]: '{',
    [`crmAgencyId:${USER}`]: AGENCY,
  })), 'visitor');
});

test('the offline link uses the site numbers and falls back to customers', () => {
  const customer = readConst('assets/bot-link.js', /var NUMBER = '(\d{9,15})'/);
  const broker = readConst('assets/crm.js', /const ASSISTANT_WA_NUMBER = '(\d{9,15})'/);
  assert.equal(support.CUSTOMER_WA, customer);
  assert.equal(support.BROKER_WA, broker);
  assert.notEqual(customer, broker);
  assert.equal(support.href('broker'), `https://wa.me/${broker}`);
  assert.equal(support.href('visitor'), `https://wa.me/${customer}`);
  assert.equal(support.href(null), `https://wa.me/${customer}`);
  assert.equal(support.href('BROKER'), `https://wa.me/${customer}`);
  assert.equal(support.href(''), `https://wa.me/${customer}`);

  const offline = fs.readFileSync(new URL('../www/offline.html', import.meta.url), 'utf8');
  assert.match(offline, new RegExp(`href="https://wa\\.me/${customer}"`));
  assert.match(offline, /ShukSupport\.href\(q\.get\('aud'\)\)/);
  assert.match(offline, /פנייה לתמיכה/);
  assert.doesNotMatch(offline, new RegExp(broker));
  assert.doesNotMatch(offline, new RegExp(PERSONAL));
  assert.doesNotMatch(offline, /054-6929991/);
});

test('the shell remembers broker and leaves everyone else without the flag', () => {
  const java = fs.readFileSync(new URL('../android/app/src/main/java/il/co/shuknadlan/app/ShellUrls.java', import.meta.url), 'utf8');
  const plugin = fs.readFileSync(new URL('../android/app/src/main/java/il/co/shuknadlan/app/ShukShellPlugin.java', import.meta.url), 'utf8');
  const swift = fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');
  assert.match(java, /if \("broker"\.equals\(audience\)\) b\.append\("&aud=broker"\)/);
  assert.match(plugin, /void setSupportAudience/);
  assert.match(plugin, /"broker"\.equals\(call\.getString\("audience"\)\) \? "broker" : "visitor"/);
  assert.match(swift, /audience == "broker"/);
  assert.match(swift, /URLQueryItem\(name: "aud", value: "broker"\)/);
  assert.match(swift, /func setSupportAudience/);
  assert.match(swift, /call\.getString\("audience"\) == "broker" \? "broker" : "visitor"/);
  const guide = fs.readFileSync(new URL('../../docs/native-apps.md', import.meta.url), 'utf8');
  assert.match(guide, /aud=broker/);
  assert.doesNotMatch(guide, new RegExp(PERSONAL));
});

test('the personal number is gone from the app shell', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === 'build' || name === '.gradle') continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(html|js|mjs|java|swift|md|xml|plist)$/.test(name) && name !== 'support-audience.test.mjs') {
        files.push(full);
      }
    }
  }
  walk(root);
  const hits = files.filter((file) => fs.readFileSync(file, 'utf8').includes(PERSONAL));
  assert.deepEqual(hits, []);
});

function shellWindow(hostname, map, calls) {
  const ls = {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i] || null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    clear() { Object.keys(map).forEach((k) => delete map[k]); },
  };
  return {
    map,
    localStorage: ls,
    location: {
      hostname,
      pathname: '/privacy',
      href: `https://${hostname}/privacy`,
      protocol: 'https:',
      search: '',
      hash: '',
      assign() {},
      replace() {},
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      readyState: 'complete',
      documentElement: { style: {} },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      createElement() {
        return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} };
      },
    },
    navigator: {},
    history: { replaceState() {}, state: null, length: 1, back() {} },
    setTimeout() { return 0; },
    setInterval() { return 0; },
    addEventListener() {},
    Capacitor: {
      isNativePlatform() { return true; },
      getPlatform() { return 'android'; },
      Plugins: {
        ShukShell: {
          setSupportAudience(arg) {
            calls.push(arg.audience);
            return Promise.resolve();
          },
        },
      },
    },
  };
}

test('the bridge saves a broker and clears the flag on sign-out', () => {
  const calls = [];
  const map = {
    [AUTH_KEY]: session(USER),
    [`crmAgencyId:${USER}`]: AGENCY,
  };
  const win = shellWindow('shuknadlan.co.il', map, calls);
  bridge.install(win);
  assert.deepEqual(calls, ['broker']);
  win.localStorage.removeItem(AUTH_KEY);
  assert.deepEqual(calls, ['broker', 'visitor']);
});

test('the offline page cannot wipe a broker flag', () => {
  const calls = [];
  const win = shellWindow('localhost', {}, calls);
  bridge.install(win);
  assert.deepEqual(calls, []);
});
