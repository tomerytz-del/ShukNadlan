/**
 * קישור עמוק טוען רק את המסך שלו.
 * client_match_top יושב בתוך טעינת הלקוחות, ולכן מפתח clients אסור
 * להופיע בקישור ללידים, לנכס או לביקוש פתוח.
 *
 *     node scripts/crm_goto_load_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const src = readFileSync(join(root, 'crm.js'), 'utf8');
const leadsJs = readFileSync(join(root, 'crm-leads.js'), 'utf8');
const block = src.match(/function gotoLoadKeys\(raw, tab\)\{[\s\S]*?\n\}/);
if (!block) throw new Error('gotoLoadKeys לא נמצא ב-crm.js');
const gotoLoadKeys = new Function(block[0] + '\nreturn gotoLoadKeys;')();

test('ביקוש פתוח לא מחכה ללידים ולא ללקוחות', () => {
  const keys = gotoLoadKeys('accLeads', 'demand');
  assert.deepEqual(keys, ['demand']);
  assert.equal(keys.includes('clients'), false);
  assert.equal(keys.includes('leads'), false);
});

test('ליד לא מחכה ל-client_match_top', () => {
  const keys = gotoLoadKeys('accLeads', '');
  assert.deepEqual(keys, ['props', 'leads']);
  assert.equal(keys.includes('clients'), false);
});

test('נכס לא מחכה ללקוחות', () => {
  assert.deepEqual(gotoLoadKeys('accProperties', ''), ['props']);
  assert.deepEqual(gotoLoadKeys('cma', ''), ['props']);
});

test('לקוח/ה כן טוען את שרשרת הלקוחות', () => {
  assert.deepEqual(gotoLoadKeys('accClients', ''), ['props', 'clients']);
});

test('בלי יעד אין טעינה מוקדמת', () => {
  assert.deepEqual(gotoLoadKeys('', ''), []);
  assert.deepEqual(gotoLoadKeys('accPlanning', ''), []);
  assert.deepEqual(gotoLoadKeys('mentor', ''), []);
});

test('הפעמון טוען רק את ההתראות', () => {
  assert.deepEqual(gotoLoadKeys('bell', ''), ['notifications']);
});

test('יעד ניהול טוען רק את הטעינה שלו, באותו מפתח של adminLoadsP', () => {
  assert.deepEqual(gotoLoadKeys('accRefundQueue', ''), ['adm:refundQueue']);
  assert.deepEqual(gotoLoadKeys('accDealsImport', ''), []);
  const fns = src.match(/const ADMIN_LOAD_FNS = \{([\s\S]*?)\n\};/);
  assert.ok(fns, 'ADMIN_LOAD_FNS לא נמצא');
  const map = src.match(/const ADMIN_GOTO_LOADS = \{([\s\S]*?)\n  \};/);
  assert.ok(map, 'ADMIN_GOTO_LOADS לא נמצא');
  for (const k of map[1].match(/'adm:[A-Za-z]+'/g)) assert.ok(fns[1].includes(k), k + ' חסר ב-ADMIN_LOAD_FNS');
  assert.match(src, /Object\.keys\(ADMIN_LOAD_FNS\)\.map\(k => start\(k, ADMIN_LOAD_FNS\[k\]\)\)/);
});

test('ליד, CMA וקידום מחכים למחיר שכבר התחיל', () => {
  const start = src.indexOf('if (gotoRaw && gotoOpensEarly');
  const block = src.slice(start, start + 1100);
  assert.match(block, /const waitPrice = gotoRaw === 'cma'/);
  assert.ok(block.indexOf('pricingP()') < block.indexOf('revealGotoTarget'));
  assert.match(block, /if \(waitPrice\) await pricingP\(\)/);
  const leads = src.indexOf("key === 'leads'");
  const leadBranch = src.slice(leads, leads + 320);
  assert.ok(leadBranch.includes('pricingP()') && leadBranch.indexOf('pricingP()') < leadBranch.indexOf('loadLeads'));
});

test('קריאה רגילה לא בולעת שגיאה של טעינה שקטה', () => {
  assert.match(leadsJs, /if \(!silent\) openDemandQuiet = false/);
  assert.match(leadsJs, /if \(!openDemandQuiet\) showToast/);
});
