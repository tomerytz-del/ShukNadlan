import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from '../www/native-bridge.js';

const { AUTH_CALLBACK, SITE_ORIGIN, authReturnUrl, isExternalUrl, rewriteAuthorizeUrl } = bridge;

test('oauth authorize url is rewritten to the app callback', () => {
  const raw = 'https://obookujgolazrwycsiyn.supabase.co/auth/v1/authorize?provider=google&redirect_to='
    + encodeURIComponent('https://shuknadlan.co.il/crm')
    + '&code_challenge=abc';
  const out = new URL(rewriteAuthorizeUrl(raw));
  assert.equal(out.searchParams.get('redirect_to'), AUTH_CALLBACK);
  assert.equal(out.searchParams.get('provider'), 'google');
  assert.equal(out.searchParams.get('code_challenge'), 'abc');
});

test('ordinary site navigation is not treated as oauth', () => {
  assert.equal(rewriteAuthorizeUrl('https://shuknadlan.co.il/property?id=1'), null);
  assert.equal(rewriteAuthorizeUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'), 
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x');
});

test('whatsapp, phone and maps leave the webview', () => {
  assert.equal(isExternalUrl('https://wa.me/972501234567?text=hi'), true);
  assert.equal(isExternalUrl('tel:0546929991'), true);
  assert.equal(isExternalUrl('mailto:shuknadlan@gmail.com'), true);
  assert.equal(isExternalUrl('https://www.google.com/maps?q=afula'), true);
  assert.equal(isExternalUrl('https://waze.com/ul?ll=32,35'), true);
  assert.equal(isExternalUrl('https://shuknadlan.co.il/property?id=9'), false);
  assert.equal(isExternalUrl('https://obookujgolazrwycsiyn.supabase.co/rest/v1/properties'), false);
});

test('auth callback returns to the page that started login', () => {
  const dest = authReturnUrl(
    'il.co.shuknadlan.app://auth-callback?code=abc',
    'https://shuknadlan.co.il/crm',
  );
  assert.equal(dest, 'https://shuknadlan.co.il/crm?code=abc');
});

test('implicit hash and https deep links are preserved', () => {
  const hashed = authReturnUrl(
    'il.co.shuknadlan.app://auth-callback#access_token=tok',
    'https://shuknadlan.co.il/developer-crm',
  );
  assert.equal(hashed, 'https://shuknadlan.co.il/developer-crm#access_token=tok');
  assert.equal(
    authReturnUrl('https://shuknadlan.co.il/property?id=15', null),
    'https://shuknadlan.co.il/property?id=15',
  );
});

test('callback cannot send the webview to another origin', () => {
  const dest = authReturnUrl(
    'il.co.shuknadlan.app://auth-callback?code=abc',
    'https://evil.example/steal',
  );
  assert.equal(dest.startsWith(SITE_ORIGIN + '/crm?code=abc'), true);
});
