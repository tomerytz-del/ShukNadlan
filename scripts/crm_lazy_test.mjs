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
import { fixtureFailures, scan } from './crm_lazy_scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'crm.html'), 'utf8');
const lazy = readFileSync(join(root, 'assets', 'crm-lazy.js'), 'utf8');
const crm = readFileSync(join(root, 'assets', 'crm.js'), 'utf8');

/* מסכי הקטגוריה אינם ב-HTML. סקריפט defer אחד שנתקע היה עוצר את
   crm.js, את מסך הכניסה ואת ניתוב ה-goto. הרשימה כאן היא שרשרת
   האתחול בלבד, כולה defer. */
const BOOT_SRC = [
  'assets/esc.js',
  'assets/friendly-error.js',
  'assets/pwa-install.js',
  'assets/auth-return.js',
  'supabase.js',
  'assets/apple-signin.js',
  'assets/page-bg.js',
  'assets/tiers.js',
  'assets/exit-guard.js',
  'assets/crm-lazy.js',
  'assets/deeplink-timing.js',
  'assets/crm.js',
];
const SECTION_SRC = [
  'markets.js', 'agency-markets.js', 'contact-import.js', 'crm-office.js',
  'crm-ui.js', 'crm-settings.js', 'crm-areas.js', 'crm-profile-pages.js',
  'crm-leads.js', 'crm-properties.js', 'crm-matches.js', 'crm-suggestions.js',
  'crm-coach.js', 'crm-office-dashboard.js', 'crm-my-dashboard.js',
  'crm-team-dashboard.js', 'crm-showcase.js', 'crm-teams.js', 'crm-home.js',
  'crm-onboarding.js', 'crm-profile-nudge.js', 'crm-csm.js',
  'crm-admin-inbox.js', 'crm-command-center.js', 'crm-growth.js',
  'crm-budget.js', 'crm-ads-spend.js', 'crm-hood-drafts.js',
  'property-import-core.js', 'cma-render.js', 'air-living.js',
  'leaflet.js', 'map-tiles.js', 'govmap.js', 'agreement-doc.js', 'open-house.js',
];

test('אין סקריפט src שחוסם את הציור, ומסכי הקטגוריה אינם בשרשרת', () => {
  const tags = htmlWithoutComments(html).match(/<script\b[^>]*>/g) || [];
  const src = tags.filter(t => /\ssrc=/.test(t));
  const blocking = src.filter(t => !/\sdefer\b/.test(t) && !/\sasync\b/.test(t));
  assert.equal(blocking.length, 0, blocking.join('\n'));
  const hrefs = src.map(t => (t.match(/src=["']([^"']+)["']/) || [])[1] || '');
  assert.equal(hrefs.length, BOOT_SRC.length, hrefs.join('\n'));
  for (let i = 0; i < BOOT_SRC.length; i++) {
    assert.ok(hrefs[i].endsWith(BOOT_SRC[i]), hrefs[i] + ' != ' + BOOT_SRC[i]);
  }
  const srcNames = hrefs.map(h => h.split('/').pop());
  for (const name of SECTION_SRC) {
    assert.equal(srcNames.includes(name), false, name);
    assert.match(lazy, new RegExp('(?:^|[^a-z-])' + name.replace('.', '\\.')));
  }
});

test('המכולה נדחית אבל נשארת, וה-noscript במקום', () => {
  assert.match(html, /shukLoadTrackers\s*=\s*function/);
  assert.match(html, /shukArmTrackers/);
  assert.match(html, /GTM-NZHD7ZHT/);
  assert.match(html, /gtm\.js\?id=/);
  const body = html.split(/<body\b[^>]*>/i)[1] || '';
  assert.match(body, /^[\s\n]*<!-- Google Tag Manager \(noscript\) -->/);
});

function htmlWithoutComments(s){
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

function scriptTags(s){
  return s.match(/<script\b[^>]*>/g) || [];
}

test('סקריפטי מסך לא יושבים ב-head', () => {
  for (const src of ['leaflet.js', 'map-tiles.js', 'govmap.js', 'agreement-doc.js', 'open-house.js']) {
    assert.equal(html.includes(src), false, src);
    assert.match(lazy, new RegExp(src.replace('.', '\\.')));
  }
  assert.match(html, /auth-return\.js/);
});

test('crm-lazy.js הוא תגית script אמיתית, לא הערה', () => {
  const commented = '<!-- <script defer src="assets/crm-lazy.js"></script> -->';
  assert.equal(scriptTags(htmlWithoutComments(commented)).some(t => /crm-lazy\.js/.test(t)), false);
  const live = htmlWithoutComments(html);
  const tags = scriptTags(live);
  const tag = tags.find(t => /src=["']assets\/crm-lazy\.js["']/.test(t));
  assert.ok(tag, 'אין <script src="assets/crm-lazy.js">');
  assert.match(tag, /\sdefer\b/);
  const lazyAt = live.indexOf(tag);
  const crmAt = live.indexOf('src="assets/crm.js"');
  assert.ok(lazyAt > 0 && crmAt > lazyAt, 'crm-lazy.js חייב לבוא לפני crm.js');
  assert.match(lazy, /ilid:\s*\[/);
});

test('auth-return נשאר לפני supabase, שניהם defer', () => {
  const a = html.indexOf('assets/auth-return.js');
  const s = html.indexOf('supabase.js');
  assert.ok(a > 0 && s > a);
  const slice = html.slice(a - 40, s + 20);
  assert.match(slice, /defer/);
});

test('מסך הכניסה נמדד תוך 3 שניות, בלי לחסום ציור', () => {
  assert.equal(/armTrackers\(\s*12000\s*\)/.test(crm), false);
  const start = crm.indexOf('function armLoginTrackers');
  assert.ok(start > 0);
  const body = crm.slice(start, start + 900);
  assert.match(body, /requestIdleCallback/);
  assert.match(body, /timeout:\s*3000/);
  assert.match(body, /setTimeout\(fire,\s*3000\)/);
  assert.match(body, /pointerdown/);
  assert.match(body, /keydown/);
  assert.match(body, /armTrackers\(\)/);
  assert.match(crm, /armLoginTrackers\(\)/);
});

/* גלובל עצלן: Name.method (כולל window.Name.method) חייב, באותה פונקציה
   ולפני השימוש, שמירה (window.Name בלי נקודה אחריה) או crmNeed(. */
const LAZY_GLOBALS = ['OpenHouse', 'ApproxLocation', 'IlId', 'Specialties', 'GovmapLookup',
  'AgreementTemplates', 'AgreementDoc', 'MapTiles', 'MapGestures', 'L'];

function maskCode(src){
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      const s = i; i += 2;
      while (i < n && src[i] !== '\n') i++;
      blank(s, i); continue;
    }
    if (c === '/' && c2 === '*') {
      const s = i; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i = Math.min(n, i + 2); blank(s, i); continue;
    }
    if (c === '"' || c === "'") {
      const q = c, s = i; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n' || src[i] === q) { i++; break; }
        i++;
      }
      blank(s, i); continue;
    }
    if (c === '`') {
      const s = i; i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          blank(s, i);
          i += 2;
          let depth = 1;
          while (i < n && depth) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth) i++;
          }
          if (src[i] === '}') i++;
          continue;
        }
        i++;
      }
      blank(s, i); continue;
    }
    i++;
  }
  return out.join('');
}

function functionRanges(code){
  const ranges = [];
  const stack = [];
  let i = 0;
  const isId = ch => /[A-Za-z0-9_$]/.test(ch || '');
  while (i < code.length) {
    if (code.startsWith('function', i) && !isId(code[i - 1]) && !isId(code[i + 8])) {
      let j = i + 8, par = 0, seen = false;
      while (j < code.length) {
        if (code[j] === '(') { par++; seen = true; }
        else if (code[j] === ')') par--;
        else if (code[j] === '{' && par === 0 && seen) break;
        else if (code[j] === ';' && par === 0) break;
        j++;
      }
      if (code[j] === '{') { stack.push({ kind: 'func', start: i, body: j }); i = j + 1; continue; }
    }
    if (code[i] === '=' && code[i + 1] === '>') {
      let j = i + 2;
      while (code[j] === ' ' || code[j] === '\n') j++;
      if (code[j] === '{') { stack.push({ kind: 'func', start: i, body: j }); i = j + 1; continue; }
    }
    if (code[i] === '{') { stack.push({ kind: 'block', start: i, body: i }); i++; continue; }
    if (code[i] === '}') {
      const top = stack.pop();
      if (top && top.kind === 'func') ranges.push({ start: top.start, body: top.body, end: i });
      i++; continue;
    }
    i++;
  }
  return ranges;
}

function unguardedLazyUses(src){
  const code = maskCode(src);
  const ranges = functionRanges(code);
  const lineOf = idx => src.slice(0, idx).split('\n').length;
  const fails = [];
  for (const name of LAZY_GLOBALS) {
    const re = new RegExp('\\b' + name + '\\.', 'g');
    let m;
    while ((m = re.exec(code))) {
      const at = m.index;
      let best = null;
      for (const r of ranges) {
        if (at >= r.body && at <= r.end && (!best || (r.end - r.start) < (best.end - best.start))) best = r;
      }
      const before = code.slice(best ? best.body : 0, at);
      const guard = new RegExp('window\\.' + name + '(?![.\\w])');
      if (!guard.test(before) && !/crmNeed\s*\(/.test(before)) {
        fails.push(lineOf(at) + ' ' + name + ' ' + src.slice(at, at + 48).replace(/\s+/g, ' '));
      }
    }
  }
  return fails;
}

test('כל שימוש בגלובל עצלן שמור או אחרי crmNeed באותה פונקציה', () => {
  const fails = unguardedLazyUses(crm);
  assert.deepEqual(fails, []);
});

test('כשל בסקריפט לא נתקע ולא מפיל את הדשבורד', () => {
  assert.match(lazy, /delete pending\[group\]/);
  assert.match(lazy, /s\.remove\(\)/);
  assert.match(crm, /crmNeed\('property'\)\.catch\(\(\) => \{\}\)/);
  assert.match(crm, /crmNeed\('agreements'\)\.catch\(\(\) => \{\}\)/);
  assert.match(crm, /accIsOpen\('accProperties'\)/);
  assert.match(crm, /accIsOpen\('accAgreements'\)/);
});

test('מפת התכנון לא קוראת ל-MapTiles בלי הספרייה', () => {
  const at = crm.indexOf('MapTiles.addTo');
  assert.ok(at > 0);
  assert.match(crm.slice(at - 1600, at), /!window\.MapTiles/);
});

test('כשל בספרייה לא מפיל מנהל/ת ולא לולאה', () => {
  const brand = crm.slice(crm.indexOf('async function loadBranding'), crm.indexOf('async function loadBranding') + 1600);
  assert.match(brand, /try \{ await crmNeed\('specialties'\)/);
  assert.match(brand, /catch \(e\) \{\}/);
  assert.match(crm, /לא הצלחנו לטעון את המפה/);
  assert.match(crm, /function crmNeedOnce/);
  assert.equal((crm.match(/crmNeedOnce\(/g) || []).length, 6);
});

test('מסך הכניסה נמדד אחרי 3 שניות, כמו בקוד', () => {
  const doc = readFileSync(join(root, 'docs', 'analytics-gtm.md'), 'utf8');
  assert.match(doc, /אחרי 3\nשניות/);
  assert.equal(/אחרי 12\nשניות/.test(doc), false);
  assert.match(crm, /timeout:\s*3000/);
});

/* פונקציה שמוגדרת רק בקובץ עצלן ו-crm.js קורא לה בלי typeof ובלי
   crmNeed של הקבוצה שלה, באותה פונקציה ולפני הקריאה. השאילתה חוזרת
   לפני שהקובץ נטען, ו-ReferenceError עוצר את Promise.all כולל ה-goto. */
function lazyCallSites(src){
  const lazySrc = readFileSync(join(root, 'assets', 'crm-lazy.js'), 'utf8');
  const groupOfFile = new Map();
  const block = lazySrc.slice(lazySrc.indexOf('var GROUPS'), lazySrc.indexOf('var PRE'));
  let cur = null;
  for (const line of block.split('\n')) {
    const g = line.match(/^\s{4}([A-Za-z0-9]+):\s*\[/);
    if (g) cur = g[1];
    const f = line.match(/assets\/([A-Za-z0-9._-]+\.js)/);
    if (f && cur) {
      if (!groupOfFile.has(f[1])) groupOfFile.set(f[1], []);
      groupOfFile.get(f[1]).push(cur);
    }
  }
  const declIn = text => {
    const names = new Set();
    for (const m of text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    return names;
  };
  const own = declIn(src);
  const symbols = new Map();
  for (const [file, groups] of groupOfFile) {
    const path = join(root, 'assets', file);
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch (e) { continue; }
    for (const name of declIn(text)) {
      if (!own.has(name) && !symbols.has(name)) symbols.set(name, groups);
    }
  }
  const code = maskCode(src);
  const ranges = functionRanges(code);
  const lineOf = idx => src.slice(0, idx).split('\n').length;
  const fails = [];
  for (const [name, groups] of symbols) {
    const re = new RegExp('(?<![.\\w$])' + name + '\\s*\\(', 'g');
    let m;
    while ((m = re.exec(code))) {
      const at = m.index;
      let best = null;
      for (const r of ranges) {
        if (at >= r.body && at <= r.end && (!best || (r.end - r.start) < (best.end - best.start))) best = r;
      }
      let from = best ? best.body : 0;
      const arrow = src.lastIndexOf('=>', at);
      if (arrow >= from && at - arrow < 160) {
        let j = arrow + 2;
        while (src[j] === ' ' || src[j] === '\n') j++;
        if (src[j] !== '{') from = arrow;
      }
      const before = src.slice(from, at);
      const parent = src.slice(best ? best.body : 0, from);
      const typed = new RegExp('typeof\\s+' + name + '\\b');
      const need = g => new RegExp("crmNeed\\(\\s*['\"]" + g + "['\"]");
      const ok = (chunk) => typed.test(chunk) || groups.some(g => need(g).test(chunk));
      if (ok(before) || ok(parent)) continue;
      fails.push(lineOf(at) + ' ' + name);
    }
  }
  return fails;
}

test('קריאה לקובץ עצלן שמורה ב-typeof או ב-crmNeed של הקבוצה', () => {
  const fails = lazyCallSites(crm);
  assert.deepEqual(fails, []);
  for (const [fn, groups] of [
    ['async function loadProperties', ["crmNeed('properties'", "crmOptional('office')"]],
    ['async function loadLeads', ["crmNeed('leads'", "crmOptional('office')"]],
    ['async function loadClients', ["crmNeed('leads')", "crmOptional('office')"]],
    ['async function loadSharedWithMe', ["crmNeed('properties')"]],
    ['async function loadTeam', ["crmNeed('teams'"]],
  ]) {
    const body = crm.slice(crm.indexOf(fn), crm.indexOf(fn) + 2200);
    for (const needle of groups) assert.ok(body.includes(needle), fn + ' ' + needle);
  }
});

test('סגירת שכבה סינכרונית, וקובץ שנכשל לא מפיל את הדשבורד', () => {
  const at = crm.indexOf('function closeNavLayers()');
  assert.ok(at > 0);
  const body = crm.slice(at, at + 500);
  assert.equal(body.startsWith('function closeNavLayers'), true);
  assert.equal(body.includes('await'), false);
  assert.match(lazy, /var inflight = \{\}/);
  assert.match(lazy, /if \(inflight\[src\]\) return inflight\[src\]/);
  assert.match(lazy, /CALL_MS = 8000/);
  assert.match(lazy, /function boundCaller/);
  assert.match(lazy, /function clearFailed/);
  assert.match(crm, /const crmQuiet = /);
  assert.match(crm, /crmNeed\('contacts'\)\.then\(initContactPick\)/);
  const form = crm.slice(crm.indexOf('function openClientForm()'), crm.indexOf('function openClientForm()') + 400);
  assert.match(form, /initContactPick/);
  assert.match(lazy, /home: \['ui', 'leads'\]/);
  assert.match(lazy, /command: \['ui', 'coach', 'adminInbox'\]/);
  assert.match(lazy, /leads: \['ui'\],/);
  assert.match(crm, /fresh: true/);
});

test('סריקת AST תופסת את מה שהסריקה הישנה פספסה, והקוד נקי', () => {
  assert.deepEqual(fixtureFailures(), []);
  assert.deepEqual(scan(root), []);
});
