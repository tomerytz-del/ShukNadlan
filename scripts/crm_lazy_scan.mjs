/* סריקת AST: שימוש מקובץ שרץ עם הדף, או מקובץ עצלן אחר, בסמל
   שחי רק בקובץ עצלן - בלי typeof אמיתי (לא בהערה) ובלי await crmNeed
   של הקבוצה לפני השימוש. crmNeed בלי await לא נספר. await שנבלע
   ב-try/catch לא מכסה את מה שאחרי ה-try: הקובץ לא רץ והקריאה זורקת.
   onclick במחרוזת, תבנית ו-HTML, window.fn / window['fn'] / fn.call,
   ופונקציה שמועברת כמאזין - כולם נספרים. הצהרה לא חייבת להתחיל
   בעמודה 0. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadAcorn() {
  const paths = ['acorn', '/tmp/acorn-ci/node_modules/acorn', '/tmp/acorn-tool/node_modules/acorn'];
  for (const p of paths) {
    try { return require(p); } catch (e) { /* הנתיב הבא */ }
  }
  throw new Error('acorn לא מותקן');
}

const acorn = loadAcorn();
const ROOTS = new Set(['window', 'root', 'g', 'global', 'globalThis', 'self']);

export function parse(src) {
  return acorn.parse(src, {
    ecmaVersion: 2022,
    sourceType: 'script',
    locations: true,
    allowReturnOutsideFunction: true,
  });
}

function walk(node, fn, parent) {
  if (!node || typeof node !== 'object' || !node.type) return;
  fn(node, parent || null);
  for (const k of Object.keys(node)) {
    if (k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(x => walk(x, fn, node));
    else if (v && v.type) walk(v, fn, node);
  }
}

function isFn(node) {
  return node && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression');
}

export function collectFile(src) {
  const ast = parse(src);
  const names = new Set();
  const lexical = new Set();
  const wins = new Set();
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration' && st.id) names.add(st.id.name);
    if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        if (d.id.type === 'Identifier') {
          names.add(d.id.name);
          if (st.kind === 'let' || st.kind === 'const') lexical.add(d.id.name);
        }
      }
    }
  }
  walk(ast, node => {
    if (node.type !== 'AssignmentExpression' || node.left.type !== 'MemberExpression' || node.left.computed) return;
    const obj = node.left.object;
    if (obj.type === 'Identifier' && ROOTS.has(obj.name) && node.left.property.type === 'Identifier') {
      wins.add(node.left.property.name);
    }
  });
  return { names, lexical, wins, ast };
}

export function groupTable(lazySrc) {
  const files = new Map();
  const pre = {};
  const groupsBlock = lazySrc.slice(lazySrc.indexOf('var GROUPS'), lazySrc.indexOf('var PRE'));
  let cur = null;
  for (const line of groupsBlock.split('\n')) {
    const g = line.match(/^\s{4}([A-Za-z0-9]+):\s*\[/);
    if (g) cur = g[1];
    const f = line.match(/assets\/([A-Za-z0-9._-]+\.js)/);
    if (f && cur) {
      if (!files.has(f[1])) files.set(f[1], []);
      files.get(f[1]).push(cur);
    }
  }
  const preBlock = lazySrc.slice(lazySrc.indexOf('var PRE'), lazySrc.indexOf('var GOTO'));
  for (const line of preBlock.split('\n')) {
    const g = line.match(/^\s+([A-Za-z0-9]+):\s*\[([^\]]*)\]/);
    if (!g) continue;
    pre[g[1]] = [...g[2].matchAll(/'([A-Za-z0-9]+)'/g)].map(m => m[1]);
  }
  return { files, pre };
}

function transitive(pre, group, seen) {
  seen = seen || new Set();
  if (seen.has(group)) return seen;
  seen.add(group);
  for (const d of pre[group] || []) transitive(pre, d, seen);
  return seen;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function catchRethrows(handler) {
  if (!handler) return false;
  let thrown = false;
  (function rec(node, top) {
    if (!node || !node.type || thrown) return;
    if (top && isFn(node)) return;
    if (node.type === 'ThrowStatement') { thrown = true; return; }
    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(x => rec(x, true));
      else if (v && v.type) rec(v, true);
    }
  })(handler.body, false);
  return thrown;
}

/* catch שתמיד יוצא (return / throw) לא ממשיך אל הקוד שאחרי ה-try.
   רק catch שנבלע ובולע את הדחייה משאיר את הקריאה שאחריו חשופה. */
function noFallthrough(node) {
  if (!node || !node.type) return false;
  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement'
      || node.type === 'BreakStatement' || node.type === 'ContinueStatement') return true;
  if (node.type === 'BlockStatement') {
    return node.body.length > 0 && noFallthrough(node.body[node.body.length - 1]);
  }
  if (node.type === 'IfStatement') {
    return !!(noFallthrough(node.consequent) && node.alternate && noFallthrough(node.alternate));
  }
  return false;
}

function catchSwallows(handler) {
  if (!handler) return false;
  if (catchRethrows(handler)) return false;
  if (noFallthrough(handler.body)) return false;
  return true;
}

function onclickHits(text, symbols, at) {
  const hits = [];
  const re = /on[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1] != null ? m[1] : m[2];
    const call = /([A-Za-z_$][\w$]*)\s*\(/g;
    let c;
    while ((c = call.exec(body))) {
      if (symbols.has(c[1])) hits.push({ name: c[1], at: at + m.index });
    }
  }
  return hits;
}

/* symbols: Map name -> { groups:Set, lexical:boolean, win:boolean }
   provided: קבוצות שכבר נטענות עם הקובץ (PRE). ריק בקובץ אתחול. */
export function unguarded(src, symbols, pre, provided, label) {
  const ast = parse(src);
  const fails = [];
  const note = (idx, name, why) => fails.push(label + ':' + lineOf(src, idx) + ' ' + name + ' ' + why);
  const relevant = name => {
    const info = symbols.get(name);
    if (!info) return false;
    for (const g of info.groups) if (provided.has(g)) return false;
    return true;
  };

  const guards = new Map();
  function bucket(fn) {
    if (!guards.has(fn)) guards.set(fn, []);
    return guards.get(fn);
  }

  function rec(node, fnStack, tryStack) {
    if (!node || !node.type) return;
    if (isFn(node)) {
      for (const k of Object.keys(node)) {
        if (k === 'start' || k === 'end' || k === 'loc' || k === 'id') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(x => rec(x, fnStack.concat(node), []));
        else if (v && v.type) rec(v, fnStack.concat(node), []);
      }
      return;
    }
    const fn = fnStack.length ? fnStack[fnStack.length - 1] : null;
    const tries = node.type === 'TryStatement' ? tryStack.concat(node) : tryStack;

    if (node.type === 'UnaryExpression' && node.operator === 'typeof'
        && node.argument.type === 'Identifier' && relevant(node.argument.name)) {
      bucket(fn).push({ name: node.argument.name, pos: node.start, end: Infinity });
    }
    if (node.type === 'AwaitExpression') {
      const c = node.argument;
      if (c && c.type === 'CallExpression' && c.callee.type === 'Identifier' && c.callee.name === 'crmNeed'
          && c.arguments[0] && c.arguments[0].type === 'Literal') {
        const groups = transitive(pre, c.arguments[0].value);
        let end = Infinity;
        const swallow = [...tries].reverse().find(t => t.handler && catchSwallows(t.handler));
        if (swallow) end = swallow.end;
        bucket(fn).push({ groups, pos: node.start, end });
      }
    }
    if (node.type === 'MemberExpression') {
      const obj = node.object;
      if (obj.type === 'Identifier' && ROOTS.has(obj.name)) {
        const name = !node.computed && node.property.type === 'Identifier' ? node.property.name
          : (node.computed && node.property.type === 'Literal' ? node.property.value : '');
        if (typeof name === 'string' && relevant(name)) {
          bucket(fn).push({ name, pos: node.start, end: Infinity });
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(x => rec(x, fnStack, tries));
      else if (v && v.type) rec(v, fnStack, tries);
    }
  }
  rec(ast, [], []);

  function covered(fnStack, name, at) {
    const info = symbols.get(name);
    for (let i = fnStack.length - 1; i >= 0; i--) {
      const fn = fnStack[i];
      const list = guards.get(fn) || [];
      const limit = i === fnStack.length - 1 ? at : fnStack[i + 1].start;
      for (const g of list) {
        if (g.pos >= limit || limit >= g.end) continue;
        if (g.name === name) return true;
        if (g.groups && info && [...info.groups].some(x => g.groups.has(x))) return true;
      }
    }
    const list = guards.get(null) || [];
    const limit = fnStack.length ? fnStack[0].start : at;
    for (const g of list) {
      if (g.pos >= limit || limit >= g.end) continue;
      if (g.name === name) return true;
      if (g.groups && info && [...info.groups].some(x => g.groups.has(x))) return true;
    }
    return false;
  }

  function recUse(node, fnStack, parent) {
    if (!node || !node.type) return;
    if (isFn(node)) {
      const next = fnStack.concat(node);
      for (const k of Object.keys(node)) {
        if (k === 'start' || k === 'end' || k === 'loc' || k === 'id') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(x => recUse(x, next, node));
        else if (v && v.type) recUse(v, next, node);
      }
      return;
    }
    if (node.type === 'Identifier' && relevant(node.name) && !symbols.get(node.name).win) {
      const skip = (parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof' && parent.argument === node)
        || (parent && isFn(parent) && parent.id === node)
        || (parent && parent.type === 'VariableDeclarator' && parent.id === node)
        || (parent && parent.type === 'MemberExpression' && !parent.computed && parent.property === node)
        || (parent && parent.type === 'Property' && parent.key === node && !parent.shorthand)
        || (parent && parent.type === 'LabeledStatement' && parent.label === node);
      if (!skip && !covered(fnStack, node.name, node.start)) note(node.start, node.name, 'use');
    }
    if (node.type === 'MemberExpression') {
      const obj = node.object;
      if (obj.type === 'Identifier' && ROOTS.has(obj.name)) {
        const name = !node.computed && node.property.type === 'Identifier' ? node.property.name
          : (node.computed && node.property.type === 'Literal' ? node.property.value : '');
        if (typeof name === 'string' && relevant(name) && parent) {
          const call = parent.type === 'CallExpression' && parent.callee === node && !parent.optional;
          const deeper = parent.type === 'MemberExpression' && parent.object === node && !parent.optional;
          const viaCall = parent.type === 'MemberExpression' && !parent.computed
            && (parent.property.name === 'call' || parent.property.name === 'apply') && parent.object === node;
          if ((call || deeper || viaCall) && !covered(fnStack, name, node.start)) note(node.start, name, 'window');
        }
      }
      if (!node.computed && node.property.type === 'Identifier'
          && (node.property.name === 'call' || node.property.name === 'apply')
          && node.object.type === 'Identifier' && relevant(node.object.name)
          && !covered(fnStack, node.object.name, node.object.start)) {
        note(node.object.start, node.object.name, 'call/apply');
      }
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      for (const h of onclickHits(node.value, symbols, node.start)) {
        if (relevant(h.name) && !covered(fnStack, h.name, h.at)) note(h.at, h.name, 'onclick-string');
      }
    }
    if (node.type === 'TemplateLiteral') {
      for (const el of node.quasis) {
        const text = el.value.cooked || '';
        for (const h of onclickHits(text, symbols, el.start)) {
          if (relevant(h.name) && !covered(fnStack, h.name, h.at)) note(h.at, h.name, 'onclick-template');
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(x => recUse(x, fnStack, node));
      else if (v && v.type) recUse(v, fnStack, node);
    }
  }
  recUse(ast, [], null);
  return fails;
}

function addSymbol(symbols, name, groups, extra) {
  if (!symbols.has(name)) symbols.set(name, { groups: new Set(), lexical: false, win: false });
  const info = symbols.get(name);
  for (const g of groups) info.groups.add(g);
  if (extra.lexical) info.lexical = true;
  if (extra.win) info.win = true;
}

export function scan(repo) {
  const base = repo || root;
  const lazySrc = readFileSync(join(base, 'assets/crm-lazy.js'), 'utf8');
  const html = readFileSync(join(base, 'crm.html'), 'utf8');
  const { files, pre } = groupTable(lazySrc);
  const symbols = new Map();
  const byFile = new Map();
  for (const [file, groups] of files) {
    const src = readFileSync(join(base, 'assets', file), 'utf8');
    let col;
    try { col = collectFile(src); }
    catch (e) { return [file + ' לא מתפרסר: ' + e.message]; }
    byFile.set(file, col);
    for (const name of col.names) addSymbol(symbols, name, groups, { lexical: col.lexical.has(name) });
    for (const name of col.wins) addSymbol(symbols, name, groups, { win: true });
  }
  const eager = [];
  const tagRe = /<script\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const srcAttr = m[1];
    const baseName = srcAttr.split('/').pop();
    if (files.has(baseName)) continue;
    if (!srcAttr.includes('assets/')) continue;
    eager.push(srcAttr.replace(/^\//, ''));
  }
  const eagerNames = new Set();
  for (const rel of eager) {
    const src = readFileSync(join(base, rel), 'utf8');
    try {
      for (const name of collectFile(src).names) eagerNames.add(name);
    } catch (e) { /* קובץ אתחול שלא מתפרסר נעצר בבדיקה אחרת */ }
  }
  for (const name of eagerNames) symbols.delete(name);

  const fails = [];
  for (const rel of eager) {
    const src = readFileSync(join(base, rel), 'utf8');
    try { fails.push(...unguarded(src, symbols, pre, new Set(), rel)); }
    catch (e) { fails.push(rel + ' לא מתפרסר: ' + e.message); }
  }
  const attr = /on[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = attr.exec(html))) {
    const body = m[1] != null ? m[1] : m[2];
    const call = /([A-Za-z_$][\w$]*)\s*\(/g;
    let c;
    while ((c = call.exec(body))) {
      if (!symbols.has(c[1])) continue;
      fails.push('crm.html:' + lineOf(html, m.index) + ' ' + c[1] + ' onclick');
    }
  }
  for (const [file, groups] of files) {
    const src = readFileSync(join(base, 'assets', file), 'utf8');
    const own = byFile.get(file);
    const local = new Map(symbols);
    for (const name of own.names) local.delete(name);
    for (const name of own.wins) {
      const info = local.get(name);
      if (!info) continue;
      const left = [...info.groups].filter(g => !groups.includes(g));
      if (!left.length) local.delete(name);
    }
    const provided = new Set();
    for (const g of groups) for (const x of transitive(pre, g)) provided.add(x);
    try { fails.push(...unguarded(src, local, pre, provided, file)); }
    catch (e) { fails.push(file + ' לא מתפרסר: ' + e.message); }
  }
  return fails;
}

/* דוגמאות שהסריקה הישנה פספסה. כל אחת חייבת להיכשל, וכל אחת מהשמורות חייבת לעבור. */
export function fixtureFailures() {
  const pre = { leads: ['ui'], office: ['ui'] };
  const symbols = new Map([
    ['lazyFn', { groups: new Set(['leads']), lexical: false, win: false }],
    ['lazyLet', { groups: new Set(['leads']), lexical: true, win: false }],
    ['ContactImport', { groups: new Set(['contacts']), lexical: false, win: true }],
  ]);
  const cases = [
    ['onclick בתבנית', 'function f(){ return `<button onclick="lazyFn()">x</button>`; }', true],
    ['onclick במחרוזת', 'function f(){ el.innerHTML = \'<button onclick="lazyFn()">x</button>\'; }', true],
    ['window.fn', 'function f(){ window.lazyFn(); }', true],
    ['window[name]', 'function f(){ window["lazyFn"](); }', true],
    ['fn.call', 'function f(){ lazyFn.call(null); }', true],
    ['מאזין', 'function f(){ el.addEventListener("click", lazyFn); }', true],
    ['typeof בהערה', 'function f(){ /* typeof lazyFn */ lazyFn(); }', true],
    ['crmNeed בלי await', 'function f(){ crmNeed("leads"); lazyFn(); }', true],
    ['let', 'function f(){ return lazyLet; }', true],
    ['await שנבלע', 'async function f(){ try { await crmNeed("leads"); } catch (e) {} lazyFn(); }', true],
    ['catch שיוצא', 'async function f(){ try { await crmNeed("leads"); } catch (e) { return; } lazyFn(); }', false],
    ['await ואז קריאה', 'async function f(){ await crmNeed("leads"); lazyFn(); }', false],
    ['typeof אמיתי', 'function f(){ if (typeof lazyFn === "function") lazyFn(); }', false],
    ['חלון בלי שמירה', 'function f(){ window.ContactImport.pick(); }', true],
    ['חלון עם שמירה', 'function f(){ if (window.ContactImport) window.ContactImport.pick(); }', false],
    ['הצהרה מוזחת', 'function f(){ if (typeof lazyFn === "function") lazyFn(); }', false],
  ];
  const out = [];
  for (const [name, src, shouldFail] of cases) {
    let fails = [];
    try { fails = unguarded(src, symbols, pre, new Set(), name); }
    catch (e) { fails = [String(e)]; }
    const failed = fails.length > 0;
    if (failed !== shouldFail) out.push(name + (shouldFail ? ' לא נתפס' : ' נתפס בטעות') + ' ' + fails.join('; '));
  }
  const indented = '  function lazyFn(){}\n';
  const col = collectFile(indented);
  if (!col.names.has('lazyFn')) out.push('הצהרה שלא בעמודה 0 לא נאספה');
  const preFail = unguarded('function f(){ lazyFn(); }', symbols, pre, new Set(['ui']), 'pre');
  if (!preFail.length) out.push('בלי PRE הקריאה עברה');
  const preOk = unguarded('function f(){ lazyFn(); }', symbols, pre, transitive(pre, 'leads'), 'pre-ok');
  if (preOk.length) out.push('PRE כיסה ולא עבר');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('crm_lazy_scan.mjs')) {
  const fix = fixtureFailures();
  if (fix.length) {
    console.error(fix.join('\n'));
    process.exit(1);
  }
  const fails = scan();
  if (fails.length) {
    console.error(fails.slice(0, 120).join('\n'));
    console.error('סה"כ', fails.length);
    process.exit(1);
  }
  console.log('סריקת AST נקייה');
}
