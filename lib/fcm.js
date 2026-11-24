// Firebase Cloud Messaging (HTTP v1) for the Android app — no extra npm packages.
// Set FCM_SERVICE_ACCOUNT in .env to the path of the Firebase service-account JSON file
// (Firebase console → Project settings → Service accounts → Generate new private key).
const fs = require('fs');
const crypto = require('crypto');

let account = null, token = null, tokenExp = 0, loadError = null;
function load() {
  const f = process.env.FCM_SERVICE_ACCOUNT;
  if (!f) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j.client_email || !j.private_key || !j.project_id) throw new Error('not a service-account file');
    return j;
  } catch (e) { loadError = e.message; console.error('[saferoute] FCM disabled:', e.message); return null; }
}
account = load();

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function accessToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('FCM auth failed: ' + (j.error_description || j.error || r.status));
  token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return token;
}

// returns { ok } | { ok:false, error, gone } — gone = the app was uninstalled or the token expired
async function send(deviceToken, m) {
  if (!account) return { ok: false, error: 'FCM not configured' };
  const urgent = ['sos', 'journey', 'fleet'].includes(m.kind);
  const data = {}; for (const [k, v] of Object.entries({ url: m.url || '/', job: m.job, ack: m.ack, kind: m.kind, tag: m.tag })) if (v != null) data[k] = String(v);
  const body = { message: { token: deviceToken, data,
    notification: { title: m.title || 'SafeRoute', body: m.body || '' },
    android: { priority: 'HIGH', ttl: '21600s', notification: { channel_id: urgent ? 'sos' : 'alerts', icon: 'ic_stat_saferoute', color: urgent ? '#DC2626' : '#22C55E', tag: m.tag || undefined, default_sound: true, notification_priority: urgent ? 'PRIORITY_MAX' : 'PRIORITY_HIGH' } } } };
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    const code = j.error && (j.error.details || []).map(d => d.errorCode).find(Boolean);
    return { ok: false, error: 'FCM ' + r.status + (code ? ' ' + code : ''), gone: r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { send, get enabled() { return !!account; }, get error() { return loadError; } };
