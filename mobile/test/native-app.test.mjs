import test from 'node:test';
import assert from 'node:assert/strict';
import native from '../../assets/native-app.js';

const { TABS, activeTab, isNativeApp, isPurchaseUrl, showTabs, staysInApp } = native;

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
