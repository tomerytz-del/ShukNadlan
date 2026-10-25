import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from '../www/native-bridge.js';

const { AUTH_CALLBACK, OAUTH_CANCELLED, OAUTH_FAILED, SITE_ORIGIN, authReturnUrl, clickedHref, isAuthCallback, isExternalUrl, rewriteAuthorizeUrl } = bridge;

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
  assert.equal(isExternalUrl('https://api.whatsapp.com/send?phone=972501234567&text=hi'), true);
  assert.equal(isExternalUrl('https://chat.whatsapp.com/AbCd'), true);
  assert.equal(isExternalUrl('whatsapp://send?phone=972501234567&text=hi'), true);
  assert.equal(isExternalUrl('intent://send?phone=972#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end'), true);
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

test('a click keeps the raw intent and whatsapp href', () => {
  const intent = 'intent://send?phone=972532494740&text=hi#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end';
  assert.equal(clickedHref(intent, 'https://shuknadlan.co.il/crm'), intent);
  assert.equal(clickedHref('tel:+972546929991', ''), 'tel:+972546929991');
  assert.equal(clickedHref('https://wa.me/972532494740?text=hi', 'https://wa.me/972532494740?text=hi'),
    'https://wa.me/972532494740?text=hi');
  assert.equal(clickedHref('/crm', 'https://shuknadlan.co.il/crm'), 'https://shuknadlan.co.il/crm');
});

test('google callback is recognized and the button copy has no long dash', () => {
  assert.equal(isAuthCallback('il.co.shuknadlan.app://auth-callback?code=abc'), true);
  assert.equal(isAuthCallback('https://shuknadlan.co.il/crm?code=abc'), false);
  assert.equal(OAUTH_CANCELLED.includes('\u2014'), false);
  assert.equal(OAUTH_FAILED.includes('\u2014'), false);
  assert.match(OAUTH_CANCELLED, /בוטלה/);
  assert.match(OAUTH_FAILED, /נכשלה/);
});

test('callback cannot send the webview to another origin', () => {
  const dest = authReturnUrl(
    'il.co.shuknadlan.app://auth-callback?code=abc',
    'https://evil.example/steal',
  );
  assert.equal(dest.startsWith(SITE_ORIGIN + '/crm?code=abc'), true);
});
