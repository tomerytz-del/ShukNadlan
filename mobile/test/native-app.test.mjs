import test from 'node:test';
import assert from 'node:assert/strict';
import native from '../../assets/native-app.js';

const { TABS, activeTab, applyCourseShield, isNativeApp, isPurchaseUrl, showTabs, staysInApp } = native;

function fakeDoc(children) {
  const all = [];
  function make(spec, parent) {
    const node = {
      parentNode: parent,
      nodeType: 1,
      id: spec.id || '',
      className: spec.className || '',
      tagName: (spec.tag || 'div').toUpperCase(),
      href: spec.href || '',
      style: {},
      attrs: Object.assign({}, spec.attrs),
      _text: spec.text || '',
      children: [],
      get textContent() {
        return this._text + this.children.map((c) => c.textContent).join('');
      },
      set textContent(value) {
        this._text = value;
        this.children = [];
      },
      getAttribute(name) {
        if (name === 'href') return this.href || null;
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      closest(sel) {
        let current = this;
        while (current) {
          if (matches(current, sel)) return current;
          current = current.parentNode;
        }
        return null;
      },
    };
    (spec.children || []).forEach((child) => node.children.push(make(child, node)));
    all.push(node);
    return node;
  }
  make({ tag: 'body', children: children }, null);
  function query(sel) {
    const parts = sel.split(',').map((part) => part.trim());
    return all.filter((node) => parts.some((part) => matches(node, part)));
  }
  return {
    querySelectorAll: query,
    querySelector(sel) { return query(sel)[0] || null; },
  };
}

function classList(node) {
  return (node.className || '').split(/\s+/).filter(Boolean);
}

function matches(node, sel) {
  if (sel === 'a' || sel === 'button' || sel === 'p' || sel === 'label' || sel === 'span') {
    return node.tagName === sel.toUpperCase();
  }
  if (sel === 'a[href]') return node.tagName === 'A' && !!node.href;
  if (sel.startsWith('.') && !sel.includes(' ')) return classList(node).includes(sel.slice(1));
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel === '[data-gift]') return node.getAttribute('data-gift') != null;
  if (sel === '.lp-final a.lp-cta') {
    return node.tagName === 'A' && classList(node).includes('lp-cta')
      && !!node.closest('.lp-final') && node.closest('.lp-final') !== node;
  }
  if (sel === 'header .back-link') {
    return classList(node).includes('back-link') && !!node.closest('header');
  }
  if (sel === 'header') return node.tagName === 'HEADER';
  return false;
}

function visible(node) {
  return node.getAttribute('data-shuk-native-hidden') !== '1' && node.style.display !== 'none';
}

test('the course tab sits with the other app destinations', () => {
  assert.deepEqual(TABS.map((tab) => tab.label), ['בית', 'לידים', 'משימות', 'משכנתא', 'קורס']);
  assert.equal(TABS.find((tab) => tab.id === 'course').href, '/course');
  assert.equal(TABS.find((tab) => tab.id === 'course').aria, 'קורס הכנה למבחן המתווכים');
  assert.equal(TABS.find((tab) => tab.id === 'mortgage').href, '/#calc');
  assert.equal(TABS.find((tab) => tab.id === 'leads').href, '/crm?goto=accLeads');
  assert.equal(TABS.find((tab) => tab.id === 'tasks').href, '/crm?goto=accAgenda');
});

test('tabs are native-only and do not cover the CRM bar or the course player', () => {
  assert.equal(isNativeApp('Mozilla/5.0 ShukNadlanApp/1.0', {}), true);
  assert.equal(isNativeApp('Mozilla/5.0', { ShukNadlanApp: {} }), true);
  assert.equal(isNativeApp('Mozilla/5.0', {}), false);
  assert.equal(showTabs('/course', false), true);
  assert.equal(showTabs('/', false), true);
  assert.equal(showTabs('/property', false), true);
  assert.equal(showTabs('/crm', false), false);
  assert.equal(showTabs('/learn', false), false);
  assert.equal(showTabs('/', true), false);
});

test('the highlighted tab follows the page', () => {
  assert.equal(activeTab('/course', '', ''), 'course');
  assert.equal(activeTab('/learn', '', ''), 'course');
  assert.equal(activeTab('/', '#calc', ''), 'mortgage');
  assert.equal(activeTab('/', '', '?deal=sale&rooms=4'), 'home');
  assert.equal(activeTab('/property', '', '?id=9'), 'home');
  assert.equal(activeTab('/crm', '', '?goto=accLeads'), 'leads');
  assert.equal(activeTab('/crm', '', '?goto=accAgenda'), 'tasks');
});

test('course and learn stay in the webview, checkout does not', () => {
  assert.equal(staysInApp('https://shuknadlan.co.il/course'), true);
  assert.equal(staysInApp('/learn'), true);
  assert.equal(staysInApp('https://shuknadlan.co.il/terms'), true);
  assert.equal(isPurchaseUrl('https://shuknadlan.co.il/course'), false);
  assert.equal(isPurchaseUrl('https://shuknadlan.co.il/learn'), false);
  assert.equal(isPurchaseUrl('/pricing'), true);
  assert.equal(isPurchaseUrl('https://shuknadlan.co.il/checkout'), true);
  assert.equal(isPurchaseUrl('https://app.greeninvoice.co.il/pay/abc'), true);
  assert.equal(staysInApp('https://wa.me/972501234567'), false);
});

test('signed-out learn pitches are hidden and exam wording stays', () => {
  const doc = fakeDoc([
    { tag: 'p', text: 'השיעורים הראשונים פתוחים בחינם.' },
    { tag: 'p', text: 'גישה מלאה לקורס: כל השיעורים, מבחני העבר, הסימולציות וחזרה על טעויות.' },
    { tag: 'button', text: 'לתת את הייעוץ בחינם ללקוחות תיווך, כי אסור לגבות עליו בנפרד.' },
    { tag: 'p', text: 'הדירה נמכרה ב-200,000 ₪.' },
  ]);
  applyCourseShield(doc, '/learn');
  const ps = doc.querySelectorAll('p');
  assert.equal(visible(ps[0]), false);
  assert.equal(visible(ps[1]), false);
  assert.equal(visible(doc.querySelectorAll('button')[0]), true);
  assert.match(doc.querySelectorAll('button')[0].textContent, /בחינם/);
  assert.equal(visible(ps[2]), true);
  assert.match(ps[2].textContent, /200,000 ₪/);
});

test('a learn question that mentions shekels stays visible', () => {
  const doc = fakeDoc([
    { tag: 'p', text: 'הדירה נמכרה ב-200,000 ₪.' },
    { tag: 'button', text: '200,000 ₪' },
    { tag: 'button', text: 'לפתיחת הקורס המלא לארבעה חודשים ב-450 ₪ כולל מע״מ' },
  ]);
  applyCourseShield(doc, '/learn');
  const question = doc.querySelectorAll('p')[0];
  const option = doc.querySelectorAll('button')[0];
  const buy = doc.querySelectorAll('button')[1];
  assert.equal(visible(question), true);
  assert.match(question.textContent, /200,000 ₪/);
  assert.equal(visible(option), true);
  assert.match(option.textContent, /200,000 ₪/);
  assert.equal(visible(buy), false);
});

test('course shield hides the payment FAQ and keeps other shekel text', () => {
  const doc = fakeDoc([
    { tag: 'details', className: 'lp-pay', text: 'עד 3 תשלומים שווים של 150 ₪' },
    { tag: 'label', text: 'תקציב (₪)' },
    { tag: 'a', href: '/?deal=sale&maxPrice=1500000', text: 'נכסים בעפולה עד 1.5 מיליון ₪' },
    { tag: 'p', className: 'lp-native-off', text: 'התחילו בשיעור הראשון בחינם, והמשיכו כשאתם מוכנים.' },
  ]);
  applyCourseShield(doc, '/course');
  assert.equal(visible(doc.querySelectorAll('.lp-pay')[0]), false);
  assert.equal(visible(doc.querySelectorAll('.lp-native-off')[0]), false);
  assert.equal(visible(doc.querySelectorAll('label')[0]), true);
  assert.match(doc.querySelectorAll('label')[0].textContent, /תקציב \(₪\)/);
  assert.equal(visible(doc.querySelectorAll('a')[0]), true);
  assert.match(doc.querySelectorAll('a')[0].textContent, /1\.5 מיליון ₪/);
});
