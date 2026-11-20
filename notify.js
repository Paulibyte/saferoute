// SMS and voice calls through Twilio. Set in .env:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM (a Twilio number) or TWILIO_MESSAGING_SERVICE_SID
//   TWILIO_VOICE=true to allow automated voice calls for SOS escalation (needs TWILIO_FROM to be voice-capable)
// Without them the app still works: alerts go to devices (push) and the in-app inbox, and users can text from their own phone.

function smsEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));
}
function voiceEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM && process.env.TWILIO_VOICE === 'true');
}

// 0803 123 4567 → +2348031234567
function normalisePhone(p) {
  if (!p) return '';
  let d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return '+' + d.slice(1).replace(/\D/g, '');
  if (d.startsWith('00')) return '+' + d.slice(2);
  if (d.startsWith('234')) return '+' + d;
  if (d.startsWith('0') && d.length === 11) return '+234' + d.slice(1);
  return d;
}

async function twilio(path, form) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
      method: 'POST', signal: ctl.signal, body: form,
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.message || 'HTTP ' + r.status };
    return { ok: true, id: j.sid, status: j.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally { clearTimeout(t); }
}

async function sms(to, body, statusCallback) {
  if (!smsEnabled()) return { ok: false, error: 'SMS not configured', permanent: true };
  const num = normalisePhone(to);
  if (!/^\+\d{8,15}$/.test(num)) return { ok: false, error: 'invalid number', permanent: true };
  const form = new URLSearchParams({ To: num, Body: body.slice(0, 1500) });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', process.env.TWILIO_FROM);
  if (statusCallback) form.set('StatusCallback', statusCallback);
  return twilio('Messages.json', form);
}

const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
async function call(to, text, statusCallback) {
  if (!voiceEnabled()) return { ok: false, error: 'Voice calls not configured', permanent: true };
  const num = normalisePhone(to);
  if (!/^\+\d{8,15}$/.test(num)) return { ok: false, error: 'invalid number', permanent: true };
  const say = `<Say voice="alice" language="en-GB">${xml(text)}</Say><Pause length="1"/>`;
  const form = new URLSearchParams({ To: num, From: process.env.TWILIO_FROM, Twiml: `<Response>${say}${say}</Response>` });
  if (statusCallback) { form.set('StatusCallback', statusCallback); form.append('StatusCallbackEvent', 'completed'); }
  return twilio('Calls.json', form);
}

// Twilio signs its webhooks: HMAC-SHA1 of the full URL followed by the sorted POST parameters
function validTwilioSignature(url, params, signature) {
  if (!process.env.TWILIO_AUTH_TOKEN || !signature) return false;
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = require('crypto').createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

module.exports = { sms, call, smsEnabled, voiceEnabled, normalisePhone, validTwilioSignature };
