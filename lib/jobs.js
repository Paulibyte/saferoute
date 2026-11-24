// Notification engine: every push, SMS and voice call is a job with retries and a delivery status.
// Push → "sent" when the browser's push service accepts it, "delivered" when the phone shows it (the service worker reports back).
// SMS / calls → statuses come back from Twilio (queued, sent, delivered, failed, answered…).
// Every push to a signed-in user is also written to their in-app inbox, so nothing is lost if their device is off.
const crypto = require('crypto');

module.exports = function ({ db, webpush, fcm, notify, baseUrl }) {
  const now = () => Date.now();
  const BACKOFF = [30e3, 120e3, 300e3];

  function inbox(userId, kind, title, body, url, tag) {
    if (!userId) return;
    if (tag) {
      const dupe = db.prepare(`SELECT id FROM user_alerts WHERE user_id=? AND tag=? AND created_at>?`).get(userId, tag, now() - 60000);
      if (dupe) { db.prepare(`UPDATE user_alerts SET title=?, body=?, url=?, read_at=NULL, created_at=? WHERE id=?`).run(title, body, url, now(), dupe.id); return; }
    }
    db.prepare(`INSERT INTO user_alerts (user_id,kind,title,body,url,tag,created_at) VALUES (?,?,?,?,?,?,?)`).run(userId, kind, title, body || '', url || '/', tag || null, now());
  }

  // queue({kind, ref_id, channel, user_id|phone, title, body, url, tag, max_attempts, inbox:true})
  function queue(j) {
    const ack = crypto.randomBytes(9).toString('base64url');
    const info = db.prepare(`INSERT INTO notif_jobs (kind,ref_id,channel,user_id,phone,title,body,url,tag,ack_token,max_attempts,next_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(j.kind, j.ref_id || null, j.channel, j.user_id || null, j.phone || null, j.title || '', j.body || '', j.url || '/',
      j.tag || null, ack, j.max_attempts || 3, now(), now(), now());
    if (j.channel === 'push' && j.user_id && j.inbox !== false) inbox(j.user_id, j.kind, j.title, j.body, j.url, j.tag);
    const id = info.lastInsertRowid;
    setImmediate(() => run(id).catch(e => console.error('job', id, e.message)));
    return id;
  }

  async function run(id) {
    const j = db.prepare(`SELECT * FROM notif_jobs WHERE id=?`).get(id);
    if (!j || j.status !== 'pending') return;
    db.prepare(`UPDATE notif_jobs SET attempts=attempts+1, updated_at=?, next_at=? WHERE id=?`).run(now(), now() + 600e3, id); // lease
    let r;
    try {
      if (j.channel === 'push') r = await sendPush(j);
      else if (j.channel === 'sms') r = await notify.sms(j.phone, j.body, cb(j));
      else if (j.channel === 'voice') r = await notify.call(j.phone, j.body, cb(j));
      else r = { ok: false, error: 'unknown channel', permanent: true };
    } catch (e) { r = { ok: false, error: e.message }; }
    const attempts = j.attempts + 1;
    if (r.ok) db.prepare(`UPDATE notif_jobs SET status='sent', provider_id=?, error=NULL, updated_at=? WHERE id=?`).run(r.id || null, now(), id);
    else if (r.permanent || attempts >= j.max_attempts) db.prepare(`UPDATE notif_jobs SET status='failed', error=?, updated_at=? WHERE id=?`).run(String(r.error).slice(0, 200), now(), id);
    else db.prepare(`UPDATE notif_jobs SET status='pending', error=?, next_at=?, updated_at=? WHERE id=?`).run(String(r.error).slice(0, 200), now() + BACKOFF[Math.min(attempts - 1, 2)], now(), id);
    return r;
  }
  const cb = j => { const b = baseUrl(); return b ? `${b}/api/twilio/status?job=${j.id}&t=${j.ack_token}` : null; };

  async function sendPush(j) {
    const subs = db.prepare(`SELECT * FROM push_subs WHERE user_id=?`).all(j.user_id);
    if (!subs.length) return { ok: false, error: 'no device with notifications on (inbox only)', permanent: true };
    const payload = JSON.stringify({ title: j.title, body: j.body, url: j.url, tag: j.tag, job: j.id, ack: j.ack_token, requireInteraction: ['sos', 'journey', 'fleet'].includes(j.kind) });
    let ok = 0, lastErr = '';
    await Promise.all(subs.map(async s => {
      if (s.endpoint.startsWith('fcm:')) { // Android app via Firebase
        const r = fcm ? await fcm.send(s.endpoint.slice(4), { title: j.title, body: j.body, url: j.url, tag: j.tag, kind: j.kind, job: j.id, ack: j.ack_token }) : { ok: false, error: 'FCM not configured' };
        if (r.ok) ok++; else { lastErr = r.error; if (r.gone) db.prepare(`DELETE FROM push_subs WHERE id=?`).run(s.id); }
        return;
      }
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys_json) }, payload, { TTL: 6 * 3600, urgency: 'high' }); ok++; }
      catch (e) { lastErr = e.statusCode ? 'push service ' + e.statusCode : e.message; if (e.statusCode === 404 || e.statusCode === 410) db.prepare(`DELETE FROM push_subs WHERE id=?`).run(s.id); }
    }));
    return ok ? { ok: true, id: ok + ' device(s)' } : { ok: false, error: lastErr || 'push failed' };
  }

  // the phone's service worker confirms it displayed the notification
  function ack(id, token) {
    const j = db.prepare(`SELECT id, ack_token, status FROM notif_jobs WHERE id=?`).get(+id);
    if (!j || !token || j.ack_token !== token) return false;
    db.prepare(`UPDATE notif_jobs SET status='delivered', updated_at=? WHERE id=?`).run(now(), j.id);
    return true;
  }
  // Twilio status callbacks
  function twilioStatus(id, token, status, errorCode) {
    const j = db.prepare(`SELECT * FROM notif_jobs WHERE id=?`).get(+id);
    if (!j || j.ack_token !== token) return false;
    const map = { delivered: 'delivered', completed: 'delivered', undelivered: 'failed', failed: 'failed', busy: 'failed', 'no-answer': 'failed', canceled: 'failed', sent: 'sent', queued: 'sent', ringing: 'sent', 'in-progress': 'delivered' };
    const st = map[status] || j.status;
    db.prepare(`UPDATE notif_jobs SET status=?, error=?, updated_at=? WHERE id=?`).run(st, st === 'failed' ? `${status}${errorCode ? ' (' + errorCode + ')' : ''}` : null, now(), j.id);
    return true;
  }

  function summary(kind, refId) {
    const rows = db.prepare(`SELECT channel, status, COUNT(*) n FROM notif_jobs WHERE kind=? AND ref_id=? GROUP BY channel, status`).all(kind, refId);
    const out = {};
    for (const r of rows) { out[r.channel] = out[r.channel] || {}; out[r.channel][r.status] = r.n; }
    return out;
  }

  // retry worker
  setInterval(() => {
    for (const j of db.prepare(`SELECT id FROM notif_jobs WHERE status='pending' AND next_at<=? LIMIT 50`).all(now())) run(j.id).catch(() => {});
    db.prepare(`DELETE FROM notif_jobs WHERE created_at<?`).run(now() - 60 * 864e5);
    db.prepare(`DELETE FROM user_alerts WHERE created_at<?`).run(now() - 60 * 864e5);
  }, 10000).unref();

  return { queue, inbox, ack, twilioStatus, summary, run };
};
