/**
 * מסך הביניים אומר לאן הקישור הולך.
 *
 *     node scripts/crm_boot_message_test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'crm.js'),
  'utf8',
);
const block = src.match(/function bootMessageFor\(raw, tab\)\{[\s\S]*?\n\}/);
if (!block) throw new Error('bootMessageFor לא נמצא');
const bootMessageFor = new Function(block[0] + '\nreturn bootMessageFor;')();

test('ביקוש פתוח', () => {
  assert.equal(bootMessageFor('accLeads', 'demand'), 'פותחים את הביקושים הפתוחים…');
});

test('לידים בלי הלשונית', () => {
  assert.equal(bootMessageFor('accLeads', ''), 'פותחים את הלידים…');
});

test('בלי יעד נשאר המשפט הכללי', () => {
  assert.equal(bootMessageFor('', ''), 'טוענים את איזור הסוכנים…');
  assert.equal(bootMessageFor('accNope', ''), 'פותחים את המסך…');
});

test('בלי מקף ארוך', () => {
  for (const raw of ['accProperties', 'accClients', 'cma', 'accAgenda', 'sign']) {
    assert.equal(/[—–]/.test(bootMessageFor(raw, '')), false, raw);
  }
});

test('יעד מוסתר נשאר במשפט הכללי', () => {
  const hidden = new Function('navAccVisible', 'accAliasTarget', block[0] + '\nreturn bootMessageFor;')(
    (id) => id !== 'accTeam',
    (id) => id,
  );
  assert.equal(hidden('accTeam', ''), 'טוענים את איזור הסוכנים…');
  assert.equal(hidden('accLeads', 'demand'), 'פותחים את הביקושים הפתוחים…');
  assert.equal(hidden('cma', ''), 'פותחים את דוח ה-CMA…');
});
