import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildApnsJwt,
  buildFcmMessage,
  buildServiceAccountJwt,
  joseToDer,
} from '../scripts/send-push.mjs';

test('firebase service-account jwt is an RS256 assertion', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = buildServiceAccountJwt({
    client_email: 'push@example.iam.gserviceaccount.com',
    private_key: pem,
    project_id: 'shuknadlan',
  }, 1_700_000_000);
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claim = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(header.alg, 'RS256');
  assert.equal(claim.iss, 'push@example.iam.gserviceaccount.com');
  assert.equal(claim.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    publicKey,
    Buffer.from(s, 'base64url'),
  ), true);
});

test('apns jwt is an ES256 token apple can verify', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const jwt = buildApnsJwt({
    keyPem: pem,
    keyId: 'KEYID12345',
    teamId: 'TEAMID1234',
    nowSec: 1_700_000_000,
  });
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, 'KEYID12345');
  const der = joseToDer(Buffer.from(s, 'base64url'));
  assert.equal(crypto.verify('SHA256', Buffer.from(`${h}.${p}`), publicKey, der), true);
});

test('fcm message carries the listing url', () => {
  const msg = buildFcmMessage({
    token: 'tok',
    title: 'נכס חדש',
    body: 'מתאים לחיפוש',
    url: 'https://shuknadlan.co.il/property?id=1',
  });
  assert.equal(msg.message.data.url, 'https://shuknadlan.co.il/property?id=1');
  assert.equal(msg.message.android.priority, 'HIGH');
});
