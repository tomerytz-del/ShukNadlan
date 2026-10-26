/**
 * שולח את תור ההתראות (app_push_outbox) ל-FCM ולאפליקציית אפל.
 * בלי הסודות הסקריפט יוצא בהצלחה ולא נוגע בכלום - כדי ש-CI יוכל
 * להידלק לפני שיש חשבונות מפתחים.
 *
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FCM_SERVICE_ACCOUNT_JSON     אובייקט JSON של חשבון שירות (Android)
 *   APNS_KEY_P8                  מפתח .p8 (iOS)
 *   APNS_KEY_ID
 *   APNS_TEAM_ID
 *   APNS_BUNDLE_ID               ברירת מחדל il.co.shuknadlan.app
 *   APNS_PRODUCTION              "1" לשליחה ל-api.push.apple.com
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { pathToFileURL } from 'node:url';

const BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'il.co.shuknadlan.app';

export function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64url');
}

export function derToJose(der, size = 32) {
  const buf = Buffer.isBuffer(der) ? der : Buffer.from(der);
  if (buf[0] !== 0x30) throw new Error('not a der signature');
  let offset = 2;
  if (buf[1] & 0x80) offset = 2 + (buf[1] & 0x7f);
  if (buf[offset] !== 0x02) throw new Error('missing r');
  const rLen = buf[offset + 1];
  let r = buf.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (buf[offset] !== 0x02) throw new Error('missing s');
  const sLen = buf[offset + 1];
  let s = buf.subarray(offset + 2, offset + 2 + sLen);
  return Buffer.concat([fitInt(r, size), fitInt(s, size)]);
}

function fitInt(buf, size) {
  if (buf.length > size) buf = buf.subarray(buf.length - size);
  if (buf.length < size) buf = Buffer.concat([Buffer.alloc(size - buf.length), buf]);
  return buf;
}

export function joseToDer(raw) {
  const size = raw.length / 2;
  const r = derInt(raw.subarray(0, size));
  const s = derInt(raw.subarray(size));
  const body = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function derInt(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i += 1;
  let out = buf.subarray(i);
  if (out[0] & 0x80) out = Buffer.concat([Buffer.from([0x00]), out]);
  return Buffer.concat([Buffer.from([0x02, out.length]), out]);
}

export function buildServiceAccountJwt(serviceAccount, nowSec) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const data = `${header}.${claim}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(data), serviceAccount.private_key);
  return `${data}.${sig.toString('base64url')}`;
}

export function buildApnsJwt({ keyPem, keyId, teamId, nowSec }) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claim = b64url(JSON.stringify({ iss: teamId, iat: nowSec }));
  const data = `${header}.${claim}`;
  const der = crypto.sign('SHA256', Buffer.from(data), { key: keyPem, dsaEncoding: 'der' });
  return `${data}.${derToJose(der).toString('base64url')}`;
}

export function buildFcmMessage({ token, title, body, url }) {
  return {
    message: {
      token,
      notification: { title, body },
      data: { url: url || '' },
      android: { priority: 'HIGH' },
    },
  };
}

function projectId(serviceAccount) {
  return process.env.FCM_PROJECT_ID || serviceAccount.project_id;
}

async function fcmAccessToken(serviceAccount) {
  const assertion = buildServiceAccountJwt(serviceAccount, Math.floor(Date.now() / 1000));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'fcm_auth_failed');
  return json.access_token;
}

async function sendFcm(accessToken, serviceAccount, row) {
  const project = projectId(serviceAccount);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildFcmMessage(row)),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

function sendApns(jwt, row) {
  const host = process.env.APNS_PRODUCTION === '1' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const payload = JSON.stringify({
    aps: { alert: { title: row.title, body: row.body }, sound: 'default' },
    url: row.url || '',
  });
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${row.token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => { status = Number(headers[':status'] || 0); });
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      client.close();
      resolve({ ok: status === 200, status, body });
    });
    req.on('error', (err) => {
      client.close();
      reject(err);
    });
    req.end(payload);
  });
}

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function rpc(name, body) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function shouldDisable(result) {
  const blob = `${result.status} ${result.body || ''}`;
  return result.status === 404 || /UNREGISTERED|BadDeviceToken|Unregistered/i.test(blob);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('send-push: אין SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY - אין מה לשלוח');
    return;
  }
  let fcmAccount = null;
  if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
    fcmAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
  }
  const apnsReady = process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID;
  if (!fcmAccount && !apnsReady) {
    console.log('send-push: אין מפתח FCM ואין מפתח APNs - התור נשאר ממתין');
    return;
  }
  const rows = await rpc('app_push_claim_pending', { p_limit: 40 });
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('send-push: התור ריק');
    return;
  }
  const fcmToken = fcmAccount ? await fcmAccessToken(fcmAccount) : null;
  const apnsJwt = apnsReady
    ? buildApnsJwt({
      keyPem: process.env.APNS_KEY_P8,
      keyId: process.env.APNS_KEY_ID,
      teamId: process.env.APNS_TEAM_ID,
      nowSec: Math.floor(Date.now() / 1000),
    })
    : null;
  let sent = 0;
  for (const row of rows) {
    try {
      let result;
      if (row.platform === 'ios') {
        if (!apnsJwt) {
          await rpc('app_push_mark', { p_id: row.id, p_status: 'pending', p_error: 'apns_not_configured', p_disable_device: false });
          continue;
        }
        result = await sendApns(apnsJwt, row);
      } else {
        if (!fcmToken) {
          await rpc('app_push_mark', { p_id: row.id, p_status: 'pending', p_error: 'fcm_not_configured', p_disable_device: false });
          continue;
        }
        result = await sendFcm(fcmToken, fcmAccount, row);
      }
      if (result.ok) {
        sent += 1;
        await rpc('app_push_mark', { p_id: row.id, p_status: 'sent', p_error: null, p_disable_device: false });
      } else {
        await rpc('app_push_mark', {
          p_id: row.id,
          p_status: 'failed',
          p_error: String(result.body || result.status).slice(0, 300),
          p_disable_device: shouldDisable(result),
        });
      }
    } catch (err) {
      await rpc('app_push_mark', {
        p_id: row.id,
        p_status: 'failed',
        p_error: String(err && err.message || err).slice(0, 300),
        p_disable_device: false,
      });
    }
  }
  console.log(`send-push: נשלחו ${sent} מתוך ${rows.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
