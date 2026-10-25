/**
 * מוציא את טקסט המסמכים (בלי תגיות) משישה הטפסים ומבלוק החתימות.
 * הטקסט הוא מה שהחותם קורא. שינוי סגנון ב-downloadPdf אינו אמור להזיז אותו.
 *
 * הרצה: TZ=UTC node scripts/check_agreement_texts.mjs
 * פלט JSON ל-stdout.
 */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RealDate = Date;

function FixedDate(...args) {
  const d = args.length ? new RealDate(...args) : new RealDate('2026-03-01T12:00:00Z');
  d.toLocaleDateString = function () { return '01.03.2026'; };
  d.toLocaleString = function () { return '01.03.2026, 12:00:00'; };
  return d;
}
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
FixedDate.now = function () { return RealDate.parse('2026-03-01T12:00:00Z'); };

const sandbox = { console, Date: FixedDate };
vm.createContext(sandbox);
for (const rel of ['assets/agreement-templates.js', 'assets/agreement-doc.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const T = sandbox.AgreementTemplates;
const D = sandbox.AgreementDoc;

function textOf(html) {
  const stripped = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  const parts = [];
  const re = /<[^>]+>|[^<]+/g;
  let m;
  while ((m = re.exec(stripped))) {
    if (m[0].charAt(0) === '<') continue;
    parts.push(m[0]
      .replace(/&nbsp;/g, '\u00a0')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"));
  }
  return parts.join('');
}

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out));
  else if (value && typeof value === 'object') {
    Object.keys(value).forEach(k => {
      if (k === 'key' || k === 'src' || k === 'group') return;
      collectStrings(value[k], out);
    });
  }
}

const agent = {
  name: 'יוסי כהן',
  id_number: '000000018',
  license_number: '12345',
  agency_name: 'משרד העמק',
  agency_address: 'העצמאות 1, עפולה',
  phone: '0500000000',
};
const signers = [
  { party: 'client', full_name: 'דנה לוי', id_number: '000000018', phone: '0520000000', email: 'd@example.com', address: 'עפולה' },
];
const prop = {
  fields: {
    property_type: 'דירה', city: 'עפולה', address: 'הרצל', house_number: '12',
    rooms: '4', price: '',
  },
  notes: 'הערה לדוגמה',
};

const documents = {};
T.keys().forEach(key => {
  const tpl = T.get(key);
  const bases = (T.commissionBases[tpl.dealType] || [])[0] || {};
  const html = D.buildHtml({
    template: tpl,
    properties: [prop],
    signers,
    agent,
    commission: { pct: 2, amount: '', basisSuffix: bases.suffix || '' },
    notes: 'הערת הסכם',
    exclusive: { from: '2026-01-15T12:00:00Z', until: '2026-04-14T12:00:00Z' },
    questionnaire: tpl.questionnaire ? tpl.questionnaire.items.map(() => 'כן') : [],
    verifyCode: 'AB12CD34',
    createdAt: new RealDate('2026-03-01T12:00:00Z'),
  });
  documents[key] = textOf(html);
});

documents.signature_block = textOf(D.signatureBlockHtml([
  {
    full_name: 'דנה לוי',
    id_number: '000000018',
    id_kind: 'id_card',
    signature: '',
    signed_at: '2026-03-01T12:00:00Z',
    method: 'remote',
  },
  { full_name: 'יוסי כהן', party: 'agent' },
]));

const templateStrings = [];
collectStrings(T.all, templateStrings);
collectStrings(T.menu, templateStrings);
collectStrings(T.commissionBases, templateStrings);

const payload = {
  documents,
  template_strings: templateStrings,
};
process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
