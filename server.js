// SafeRoute Naija v3 — Express server with built-in SQLite database.
// Run: node server.js   (PORT defaults to 3060)
require('./env');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

const { db, DATA_DIR, secret, randomToken } = require('./db');
const Risk = require('./shared/risk');
const notify = require('./notify');
const Sec = require('./lib/sec')(db, secret);
const Media = require('./lib/media');
const Geo = require('./lib/geo');

const app = express();
const PORT = +process.env.PORT || 3060;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const REQUIRE_STAFF_MFA = process.env.REQUIRE_STAFF_MFA !== 'false';
const H = 3600000, MIN = 60000;
const now = () => Date.now();
let lastBase = '';
const baseUrl = req => (process.env.PUBLIC_URL || (req ? `${req.protocol}://${req.get('host')}` : lastBase)).replace(/\/$/, '');
const VAPID = JSON.parse(secret('vapid', () => JSON.stringify(webpush.generateVAPIDKeys())));
webpush.setVapidDetails('mailto:' + (process.env.ADMIN_EMAIL || 'admin@example.com'), VAPID.publicKey, VAPID.privateKey);
const Jobs = require('./lib/jobs')({ db, webpush, notify, baseUrl: () => baseUrl(null) });

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(Sec.headers(SECURE_COOKIE));
app.use('/api/twilio', express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '400kb' }));
app.use(cookieParser());
app.use((req, res, next) => { if (!lastBase) lastBase = `${req.protocol}://${req.get('host')}`; next(); });
app.use(Sec.csrf(SECURE_COOKIE, ['/api/twilio/', '/api/notif/ack']));
app.use('/api/', Sec.limit('api', 600, MIN));

// ---------- helpers ----------
const fail = (res, code, error, extra) => res.status(code).json({ error, ...(extra || {}) });
const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 500);
const coord = (lat, lng) => { lat = +lat; lng = +lng; return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? [lat, lng] : null; };
const triState = v => v === 'yes' || v === '1' || v === 1 || v === true ? 1 : v === 'no' || v === '0' || v === 0 || v === false ? 0 : null;
const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
function settingsObj() { const o = {}; for (const r of db.prepare(`SELECT key,value FROM settings`).all()) o[r.key] = r.value; return o; }
function typesObj() { const o = {}; for (const t of db.prepare(`SELECT * FROM report_types ORDER BY sort`).all()) o[t.key] = t; return o; }
const setting = (k, d) => { const r = db.prepare(`SELECT value FROM settings WHERE key=?`).get(k); return !r || r.value === '' || !isFinite(+r.value) ? d : +r.value; };
const tzNow = () => new Date(now() + setting('tz_offset_hours', 1) * H);
const hhmm = ms => new Date(ms + setting('tz_offset_hours', 1) * H).toISOString().slice(11, 16);
const agoText = ms => { const m = (now() - ms) / MIN; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' minutes ago' : m < 2880 ? Math.round(m / 60) + ' hours ago' : Math.round(m / 1440) + ' days ago'; };
const first = n => String(n || '').split(' ')[0];

// ---------- roles (effective role is downgraded until two-step verification is done) ----------
const privileged = u => !!u && (u.role === 'admin' || u.role === 'moderator' || (u.role === 'security' && u.security_status === 'verified'));
const isRole = (u, ...roles) => !!u && roles.includes(u.role);
const isSecurity = u => !!u && ((u.role === 'security' && u.security_status === 'verified') || u.role === 'admin');
const isModerator = u => isRole(u, 'moderator', 'admin');
const isStaff = u => isSecurity(u) || isModerator(u);
const isAdmin = u => isRole(u, 'admin');
const need = (check, msg) => (req, res, next) => {
  if (check(req.user)) return next();
  if (req.user && req.user._mfa_needed) return fail(res, 403, 'Set up two-step verification to use staff features', { mfa_setup_required: !req.user.totp_enabled });
  res.status(req.user ? 403 : 401).json({ error: msg || (req.user ? 'Not allowed' : 'Please sign in') });
};
const signedIn = need(u => !!u);
const sid = token => crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);

function publicUser(u) {
  if (!u) return null;
  const org = u.org_id ? db.prepare(`SELECT id,name,type FROM organisations WHERE id=?`).get(u.org_id) : null;
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, real_role: u._real_role || u.role, security_status: u.security_status, agency: u.agency,
    org, org_role: u.org_role, trusted: !!u.trusted, has_pin: !!u.cancel_pin_hash, has_duress: !!u.duress_pin_hash, base: u.base_lat != null ? [u.base_lat, u.base_lng] : null,
    notify_sms: !!u.notify_sms, notify_voice: !!u.notify_voice, totp_enabled: !!u.totp_enabled, mfa_needed: !!u._mfa_needed || (REQUIRE_STAFF_MFA && privileged(u) && !u.totp_enabled), mfa_required: REQUIRE_STAFF_MFA };
}
function newSession(req, res, user, mfa) {
  if (req.cookies.sr_session) db.prepare(`DELETE FROM sessions WHERE token=?`).run(req.cookies.sr_session); // no session fixation
  const token = crypto.randomBytes(32).toString('hex');
  const days = privileged(user) ? 7 : 30;
  db.prepare(`INSERT INTO sessions (token,user_id,expires_at,created_at,last_seen,ip,ua,mfa) VALUES (?,?,?,?,?,?,?,?)`)
    .run(token, user.id, now() + days * 864e5, now(), now(), req.ip, clean(req.get('user-agent'), 200), mfa ? 1 : 0);
  res.cookie('sr_session', token, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: days * 864e5 });
}
app.use((req, res, next) => {
  const t = req.cookies.sr_session;
  if (!t) return next();
  const row = db.prepare(`SELECT u.*, s.mfa AS s_mfa, s.last_seen AS s_last FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).get(t, now());
  if (!row || row.banned) return next();
  if (!row.s_last || now() - row.s_last > 5 * MIN) db.prepare(`UPDATE sessions SET last_seen=?, ip=? WHERE token=?`).run(now(), req.ip, t);
  req.sessionToken = t;
  if (privileged(row) && !(row.totp_enabled ? row.s_mfa : !REQUIRE_STAFF_MFA)) {
    req.user = { ...row, _real_role: row.role, role: 'traveller', security_status: row.security_status === 'verified' ? 'mfa_pending' : row.security_status, _mfa_needed: true };
  } else req.user = row;
  next();
});

// ======================================================================
// Report confidence (see v2 notes): reporter track record, independent similar reports,
// weighted community confirmations, official confirmation. Unverified capped at 0.8.
// ======================================================================
function expireOld() {
  db.prepare(`UPDATE reports SET status='resolved', resolved_reason='expired' WHERE status IN ('unverified','investigating','verified') AND expires_at IS NOT NULL AND expires_at < ?`).run(now());
}
function confirmWeight(c) {
  const prox = c.distance_km == null ? 0.4 : c.distance_km <= 2 ? 1 : c.distance_km <= 10 ? 0.6 : 0.25;
  const age = (now() - c.created_at) / H;
  const rec = age <= 6 ? 1 : age <= 24 ? 0.6 : 0.3;
  const fresh = c.user_created_at && c.created_at - c.user_created_at < 24 * H ? 0.5 : 1;
  return prox * rec * fresh * (0.5 + (c.trust == null ? 0.5 : c.trust));
}
function enrich(rows, pool) {
  if (!rows.length) return rows;
  const S = settingsObj(), T = typesObj();
  const ckm = +S.corroborate_km || 2, ch = (+S.corroborate_hours || 6) * H;
  const ids = rows.map(r => r.id);
  const confs = db.prepare(`SELECT c.*, u.trust, u.created_at AS user_created_at FROM confirmations c JOIN users u ON u.id=c.user_id WHERE c.report_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byReport = {};
  confs.forEach(c => (byReport[c.report_id] = byReport[c.report_id] || []).push(c));
  pool = pool || rows;
  for (const r of rows) {
    const cs = (byReport[r.id] || []).filter(c => c.user_id !== r.user_id);
    let support = 0, against = 0, resolved = 0;
    const counts = { confirm: 0, ongoing: 0, resolved: 0, inaccurate: 0 };
    for (const c of cs) {
      const w = confirmWeight(c);
      counts[c.kind] = (counts[c.kind] || 0) + 1;
      if (c.kind === 'confirm' || c.kind === 'ongoing') support += w; else if (c.kind === 'inaccurate') against += w; else if (c.kind === 'resolved') resolved += w;
    }
    let corr = 0, corrN = 0;
    const grp = (T[r.type] || {}).grp;
    for (const o of pool) {
      if (o.id === r.id || !o.user_id || o.user_id === r.user_id || (T[o.type] || {}).grp !== grp) continue;
      if (Math.abs((o.occurred_at || o.created_at) - (r.occurred_at || r.created_at)) > ch) continue;
      if (Risk.km([r.lat, r.lng], [o.lat, o.lng]) > ckm) continue;
      corrN++; if (corrN <= 3) corr += 0.12 * (0.5 + (o.reporter_trust == null ? 0.5 : o.reporter_trust));
    }
    let conf;
    if (r.status === 'verified') conf = r.official ? 0.95 : 0.85;
    else {
      const trust = r.reporter_trust == null ? 0.4 : r.reporter_trust;
      conf = 0.15 + 0.3 * trust + ({ official: 0.05, witness: 0.03, nearby: -0.03, social: -0.08 }[r.source] || 0) + corr + 0.1 * support - 0.15 * against;
      conf = Math.max(0.05, Math.min(0.8, conf));
    }
    if (against >= 1 && against > support * 0.5) { r.disputed = 1; if (r.status === 'verified') conf *= 0.9; }
    r.confidence = Math.round(conf * 100) / 100; r.confLabel = Risk.confLabel(conf);
    r.counts = counts; r.corroborations = corrN; r._support = support; r._resolved = resolved;
  }
  return rows;
}
const REPORT_COLS = `r.*, u.name AS by_name, u.trust AS reporter_trust, u.trusted AS reporter_trusted, o.name AS org_name`;
const REPORT_FROM = `FROM reports r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN organisations o ON o.id=r.org_id`;
function activeReports() {
  expireOld();
  return enrich(db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.status IN ('unverified','investigating','verified') ORDER BY r.created_at DESC LIMIT 3000`).all());
}
function isPublic(r, T) {
  const grp = (T[r.type] || {}).grp;
  return r.status !== 'unverified' || (grp === 'security' ? r.confidence >= setting('public_min_confidence', 0.45) : r.confidence >= 0.25);
}
function reportsFor(user) {
  const T = typesObj(), staff = isStaff(user), out = [];
  for (const r of activeReports()) {
    const visible = isPublic(r, T), mine = user && r.user_id === user.id;
    if (!visible && !staff && !mine) continue;
    const canMedia = r.photo && (staff || mine || (r.media_public && r.media_type !== 'video'));
    const o = {
      id: r.id, type: r.type, lat: r.lat, lng: r.lng, note: r.note, media: canMedia ? `/media/${r.photo}` : null, media_type: canMedia ? r.media_type : null,
      has_media: !!r.photo, media_public: r.media_public, status: r.status, official: r.official, created_at: r.created_at, occurred_at: r.occurred_at, expires_at: r.expires_at,
      responding_by: r.responding_by ? 1 : 0, ongoing: r.ongoing, injured: r.injured, trapped: r.trapped, affected: r.affected, source: r.source,
      confidence: r.confidence, confLabel: r.confLabel, disputed: r.disputed || 0, counts: r.counts, corroborations: r.corroborations, mine: mine ? 1 : 0, public: visible, state: r.state, lga: r.lga, locality: r.locality
    };
    o.by_name = staff ? (r.by_name || 'Unknown') : r.official ? (r.org_name ? r.org_name : 'Verified security') : r.reporter_trusted ? 'Trusted contributor' : 'Community member';
    if (r.official && r.org_name) o.org_name = r.org_name;
    if (staff) Object.assign(o, { reporter_trust: r.reporter_trust, reporter_trusted: r.reporter_trusted, status_note: r.status_note, assigned_org: r.assigned_org, fleet_id: r.fleet_id });
    out.push(o);
  }
  return out;
}
function history() {
  const tz = setting('tz_offset_hours', 1);
  const rows = db.prepare(`SELECT r.lat, r.lng, r.type, COALESCE(r.occurred_at, r.created_at) AS t FROM reports r JOIN report_types t ON t.key=r.type
    WHERE t.grp='security' AND r.status='resolved' AND (r.verified_by IS NOT NULL OR r.official=1) AND COALESCE(r.occurred_at, r.created_at) > ? ORDER BY t DESC LIMIT 5000`).all(now() - 365 * 24 * H);
  return rows.map(r => ({ lat: Math.round(r.lat * 1e4) / 1e4, lng: Math.round(r.lng * 1e4) / 1e4, type: r.type, t: r.t, h: ((new Date(r.t).getUTCHours() + new Date(r.t).getUTCMinutes() / 60 + tz) % 24 + 24) % 24 }));
}
const placesAll = () => db.prepare(`SELECT id,category,name,lat,lng,phone,operational,last_confirmed_at,hours,address,notes FROM places`).all();
const zonesAll = () => db.prepare(`SELECT * FROM zones`).all();
const adjustTrust = (userId, delta) => { if (userId) db.prepare(`UPDATE users SET trust = MAX(0.05, MIN(0.95, trust + ?)) WHERE id=?`).run(delta, userId); };
// State / LGA / locality for reports, SOS and facilities (rows with lga_id NULL are tagged; 0 = outside Nigeria)
function geoSweep() {
  for (const t of ['reports', 'sos', 'places']) {
    const rows = db.prepare(`SELECT id, lat, lng FROM ${t} WHERE lga_id IS NULL LIMIT 2000`).all();
    if (!rows.length) continue;
    const up = db.prepare(`UPDATE ${t} SET state=?, lga=?, lga_id=?, locality=? WHERE id=?`);
    db.transaction(() => { for (const r of rows) { const g = Geo.locate(r.lat, r.lng); up.run(g ? g.state : null, g ? g.lga : null, g ? g.lga_id : 0, zoneLocality([r.lat, r.lng]), r.id); } })();
  }
}
function zoneLocality(p) {
  const z = zonesAll().filter(z => Risk.km(p, [z.lat, z.lng]) <= z.radius_km).sort((a, b) => a.radius_km - b.radius_km)[0];
  return z ? z.name.replace(/ \(demo\)$/, '') : null;
}
// community / neighbourhood names from OpenStreetMap (one lookup per ~1 km square, at most one per second)
async function localitySweep() {
  for (const t of ['reports', 'sos']) {
    const rows = db.prepare(`SELECT id, lat, lng FROM ${t} WHERE locality IS NULL AND lga_id>0 ORDER BY id DESC LIMIT 15`).all();
    for (const r of rows) {
      let name = '';
      try {
        name = await cached('rev:' + r.lat.toFixed(2) + ',' + r.lng.toFixed(2), 30 * 24 * H, async () => {
          const wait = Math.max(0, lastNominatim + 1100 - now()); if (wait) await new Promise(x => setTimeout(x, wait)); lastNominatim = now();
          const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${r.lat.toFixed(4)}&lon=${r.lng.toFixed(4)}`, { 'User-Agent': `SafeRouteNaija/4.0 (${process.env.ADMIN_EMAIL || 'admin'})`, 'Accept-Language': 'en' });
          const a = j.address || {};
          return a.suburb || a.neighbourhood || a.quarter || a.village || a.hamlet || a.town || a.city_district || a.city || '';
        });
      } catch (e) { return; } // offline or rate-limited: try again next minute
      db.prepare(`UPDATE ${t} SET locality=? WHERE id=?`).run(name || '', r.id);
    }
  }
}
function placeName(p) {
  const zones = zonesAll().filter(z => Risk.km(p, [z.lat, z.lng]) <= z.radius_km).sort((a, b) => a.radius_km - b.radius_km);
  if (zones[0]) return 'near ' + zones[0].name.replace(/ \(demo\)$/, '');
  const n = Risk.nearest(p, placesAll());
  if (n && n.d <= 8) return 'near ' + n.place.name.replace(/ \(demo\)$/, '');
  return `at ${p[0].toFixed(3)}, ${p[1].toFixed(3)}`;
}

// ======================================================================
// Auth, two-step verification, sessions
// ======================================================================
const mfaTickets = new Map();
app.post('/api/auth/register', Sec.limit('register', 10, H), (req, res) => {
  const name = clean(req.body.name, 80), email = clean(req.body.email, 120).toLowerCase(), phone = notify.normalisePhone(clean(req.body.phone, 30));
  const password = String(req.body.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter your name and a valid email');
  const wantsSecurity = !!req.body.security;
  const pw = Sec.passwordProblem(password, wantsSecurity); if (pw) return fail(res, 400, pw);
  if (db.prepare(`SELECT 1 FROM users WHERE email=?`).get(email)) return fail(res, 409, 'That email is already registered');
  const org = wantsSecurity && +req.body.org_id ? db.prepare(`SELECT id,name FROM organisations WHERE id=? AND verified=1`).get(+req.body.org_id) : null;
  const info = db.prepare(`INSERT INTO users (name,email,phone,password_hash,role,security_status,agency,org_id,org_role,created_at,password_changed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(name, email, phone, bcrypt.hashSync(password, 11), 'traveller', wantsSecurity ? 'pending' : null, wantsSecurity ? clean(req.body.agency, 80) || (org && org.name) : null,
      org ? org.id : null, org ? 'officer' : null, now(), now());
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(info.lastInsertRowid);
  newSession(req, res, u, false);
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/login', Sec.limit('login', 30, 15 * MIN), (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const blocked = Sec.loginBlocked(email, req.ip);
  if (blocked) return fail(res, 429, `Too many failed attempts. Try again in ${blocked} minute${blocked === 1 ? '' : 's'}.`);
  const u = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    Sec.loginFailed(email, req.ip);
    if (u && privileged(u)) Sec.audit({ ip: req.ip, user: u }, 'login_failed', 'user', u.id);
    return fail(res, 401, 'Wrong email or password');
  }
  if (u.banned) return fail(res, 403, 'This account has been suspended');
  Sec.loginOk(email, req.ip);
  if (u.totp_enabled) {
    const ticket = crypto.randomBytes(24).toString('base64url');
    mfaTickets.set(ticket, { uid: u.id, exp: now() + 5 * MIN, tries: 0 });
    return res.json({ mfa_required: true, ticket });
  }
  newSession(req, res, u, false);
  if (privileged(u)) Sec.audit({ ip: req.ip, user: u }, 'login', 'user', u.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/mfa', Sec.limit('mfa', 20, 15 * MIN), (req, res) => {
  const t = mfaTickets.get(String(req.body.ticket || ''));
  if (!t || t.exp < now()) return fail(res, 401, 'Sign-in expired. Enter your password again.');
  if (++t.tries > 5) { mfaTickets.delete(req.body.ticket); return fail(res, 429, 'Too many wrong codes. Sign in again.'); }
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(t.uid);
  const code = String(req.body.code || '').replace(/\s/g, '');
  let ok = false;
  const step = Sec.totpCheck(Sec.decrypt(u.totp_secret), code, u.totp_last);
  if (step > 0) { ok = true; db.prepare(`UPDATE users SET totp_last=? WHERE id=?`).run(step, u.id); }
  else if (/^[a-z0-9]{10}$/i.test(code)) {
    for (const b of db.prepare(`SELECT rowid, code_hash FROM mfa_backup WHERE user_id=? AND used_at IS NULL`).all(u.id)) {
      if (bcrypt.compareSync(code.toLowerCase(), b.code_hash)) { db.prepare(`UPDATE mfa_backup SET used_at=? WHERE rowid=?`).run(now(), b.rowid); ok = true; Sec.audit({ ip: req.ip, user: u }, 'mfa_backup_code_used', 'user', u.id); break; }
    }
  }
  if (!ok) return fail(res, 401, 'That code is not correct');
  mfaTickets.delete(req.body.ticket);
  newSession(req, res, u, true);
  Sec.audit({ ip: req.ip, user: u }, 'login', 'user', u.id, { mfa: true });
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', (req, res) => {
  if (req.cookies.sr_session) db.prepare(`DELETE FROM sessions WHERE token=?`).run(req.cookies.sr_session);
  res.clearCookie('sr_session'); res.json({ ok: true });
});
app.post('/api/auth/password', signedIn, Sec.limit('pwchange', 10, H), (req, res) => {
  if (!bcrypt.compareSync(String(req.body.current || ''), req.user.password_hash)) return fail(res, 403, 'Current password is not correct');
  const pw = Sec.passwordProblem(req.body.password, privileged({ ...req.user, role: req.user._real_role || req.user.role })); if (pw) return fail(res, 400, pw);
  db.prepare(`UPDATE users SET password_hash=?, password_changed_at=? WHERE id=?`).run(bcrypt.hashSync(String(req.body.password), 11), now(), req.user.id);
  db.prepare(`DELETE FROM sessions WHERE user_id=? AND token!=?`).run(req.user.id, req.sessionToken);
  Sec.audit(req, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/me', signedIn, (req, res) => {
  const name = req.body.name !== undefined && clean(req.body.name, 80) ? clean(req.body.name, 80) : req.user.name;
  const phone = req.body.phone !== undefined ? notify.normalisePhone(clean(req.body.phone, 30)) : req.user.phone;
  const ns = req.body.notify_sms !== undefined ? (req.body.notify_sms ? 1 : 0) : req.user.notify_sms;
  const nv = req.body.notify_voice !== undefined ? (req.body.notify_voice ? 1 : 0) : req.user.notify_voice;
  db.prepare(`UPDATE users SET name=?, phone=?, notify_sms=?, notify_voice=? WHERE id=?`).run(name, phone, ns, nv, req.user.id);
  res.json({ user: publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id)) });
});
// two-step verification
app.post('/api/mfa/setup', signedIn, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.password || ''), req.user.password_hash)) return fail(res, 403, 'Your password is not correct');
  if (req.user.totp_enabled) return fail(res, 400, 'Two-step verification is already on');
  const s = Sec.newTotpSecret();
  db.prepare(`UPDATE users SET totp_secret=? WHERE id=?`).run(Sec.encrypt(s), req.user.id);
  const label = encodeURIComponent('SafeRoute Naija:' + req.user.email);
  res.json({ secret: s.match(/.{1,4}/g).join(' '), otpauth: `otpauth://totp/${label}?secret=${s}&issuer=SafeRoute%20Naija&algorithm=SHA1&digits=6&period=30` });
});
app.post('/api/mfa/enable', signedIn, (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  if (!u.totp_secret) return fail(res, 400, 'Start the set-up first');
  const step = Sec.totpCheck(Sec.decrypt(u.totp_secret), req.body.code, null);
  if (step < 0) return fail(res, 400, 'That code is not correct. Check the time on your phone is automatic.');
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  db.transaction(() => {
    db.prepare(`UPDATE users SET totp_enabled=1, totp_last=? WHERE id=?`).run(step, u.id);
    db.prepare(`DELETE FROM mfa_backup WHERE user_id=?`).run(u.id);
    const ins = db.prepare(`INSERT INTO mfa_backup (user_id, code_hash) VALUES (?,?)`);
    codes.forEach(c => ins.run(u.id, bcrypt.hashSync(c, 8)));
    db.prepare(`UPDATE sessions SET mfa=1 WHERE token=?`).run(req.sessionToken);
    db.prepare(`DELETE FROM sessions WHERE user_id=? AND token!=?`).run(u.id, req.sessionToken);
  })();
  Sec.audit(req, 'mfa_enabled', 'user', u.id);
  res.json({ ok: true, backup_codes: codes });
});
app.post('/api/mfa/disable', signedIn, (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  if (!u.totp_enabled) return res.json({ ok: true });
  if (!bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) return fail(res, 403, 'Your password is not correct');
  if (Sec.totpCheck(Sec.decrypt(u.totp_secret), req.body.code, null) < 0) return fail(res, 400, 'That code is not correct');
  db.prepare(`UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?`).run(u.id);
  db.prepare(`DELETE FROM mfa_backup WHERE user_id=?`).run(u.id);
  Sec.audit(req, 'mfa_disabled', 'user', u.id);
  res.json({ ok: true });
});
app.get('/api/sessions', signedIn, (req, res) => {
  res.json(db.prepare(`SELECT token, created_at, last_seen, ip, ua, mfa FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_seen DESC`).all(req.user.id, now())
    .map(s => ({ id: sid(s.token), created_at: s.created_at, last_seen: s.last_seen, ip: s.ip, ua: s.ua, mfa: !!s.mfa, current: s.token === req.sessionToken })));
});
app.delete('/api/sessions/:id', signedIn, (req, res) => {
  for (const s of db.prepare(`SELECT token FROM sessions WHERE user_id=?`).all(req.user.id)) if (sid(s.token) === req.params.id && s.token !== req.sessionToken) db.prepare(`DELETE FROM sessions WHERE token=?`).run(s.token);
  res.json({ ok: true });
});
app.post('/api/sessions/others', signedIn, (req, res) => { db.prepare(`DELETE FROM sessions WHERE user_id=? AND token!=?`).run(req.user.id, req.sessionToken); res.json({ ok: true }); });

app.put('/api/me/base', need(isSecurity), (req, res) => {
  const p = req.body.clear ? [null, null] : coord(req.body.lat, req.body.lng);
  if (!p) return fail(res, 400, 'Location needed');
  db.prepare(`UPDATE users SET base_lat=?, base_lng=? WHERE id=?`).run(p[0], p[1], req.user.id);
  res.json({ ok: true });
});
app.put('/api/me/emergency', signedIn, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.password || ''), req.user.password_hash)) return fail(res, 403, 'Your account password is not correct');
  const pin = String(req.body.cancel_pin || ''), duress = String(req.body.duress_pin || '');
  if (!/^\d{4,6}$/.test(pin)) return fail(res, 400, 'Cancel PIN must be 4 to 6 digits');
  if (duress && !/^\d{4,6}$/.test(duress)) return fail(res, 400, 'Duress PIN must be 4 to 6 digits');
  if (duress && duress === pin) return fail(res, 400, 'Duress PIN must be different from the cancel PIN');
  db.prepare(`UPDATE users SET cancel_pin_hash=?, duress_pin_hash=? WHERE id=?`).run(bcrypt.hashSync(pin, 10), duress ? bcrypt.hashSync(duress, 10) : null, req.user.id);
  res.json({ ok: true });
});

// ======================================================================
// Map data, weather, places search, routes
// ======================================================================
function myFleets(user) {
  if (!user) return [];
  return db.prepare(`SELECT f.id, f.name, m.role, CASE WHEN m.role='manager' THEN f.invite_code END AS invite_code FROM fleet_members m JOIN fleets f ON f.id=m.fleet_id WHERE m.user_id=? AND f.active=1`).all(user.id)
    .map(f => ({ ...f, vehicles: db.prepare(`SELECT id, plate, label, driver_id FROM vehicles WHERE fleet_id=?`).all(f.id) }));
}
app.get('/api/bootstrap', (req, res) => {
  const u = req.user;
  res.json({
    user: publicUser(u), types: typesObj(), settings: settingsObj(), places: placesAll(), zones: zonesAll(),
    reports: reportsFor(u), history: history(), push_key: VAPID.publicKey, sms_enabled: notify.smsEnabled(), voice_enabled: notify.voiceEnabled(),
    fleets: myFleets(u), unread: u ? db.prepare(`SELECT COUNT(*) n FROM user_alerts WHERE user_id=? AND read_at IS NULL`).get(u.id).n : 0,
    orgs: db.prepare(`SELECT id,name,type,state FROM organisations WHERE verified=1 ORDER BY name`).all(),
    generated_at: now(), server_time: now()
  });
});
app.get('/api/risk', (req, res) => {
  const p = coord(req.query.lat, req.query.lng);
  if (!p) return fail(res, 400, 'lat and lng are required');
  const hour = req.query.hour !== undefined ? +req.query.hour : (new Date().getUTCHours() + setting('tz_offset_hours', 1)) % 24;
  const a = Risk.assess(p, hour, { types: typesObj(), settings: settingsObj(), places: placesAll(), zones: zonesAll(), reports: reportsFor(null), history: history() }, { tourist: req.query.tourist === '1' });
  res.json({ level: a.levelName, security: { level: Risk.LEVELS[a.security.level].name, confidence: a.security.confLabel },
    road: { level: Risk.LEVELS[a.road.level].name }, confidence: a.confLabel, action: a.action, reasons: a.reasons.map(r => r.text), zone: a.zone.name });
});
const cache = new Map();
function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > now()) return hit.p;
  const p = fn().catch(e => { cache.delete(key); throw e; });
  cache.set(key, { exp: now() + ms, p });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return p;
}
async function getJSON(url, headers, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 12000);
  try { const r = await fetch(url, { headers: headers || {}, signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
app.get('/api/weather', Sec.limit('weather', 60, MIN), async (req, res) => {
  const p = coord(req.query.lat, req.query.lng); if (!p) return fail(res, 400, 'lat and lng are required');
  try {
    const w = await cached('w:' + p[0].toFixed(1) + ',' + p[1].toFixed(1), 30 * MIN, async () => {
      const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p[0].toFixed(2)}&longitude=${p[1].toFixed(2)}&current=precipitation,weather_code&hourly=precipitation&forecast_hours=6&timezone=Africa%2FLagos`);
      const hourly = (j.hourly && j.hourly.precipitation) || [];
      return { now_mm: (j.current && j.current.precipitation) || 0, mm3h: Math.round(hourly.slice(0, 3).reduce((a, b) => a + (b || 0), 0) * 10) / 10, mm6h: Math.round(hourly.reduce((a, b) => a + (b || 0), 0) * 10) / 10, at: now() };
    });
    res.json(w);
  } catch (e) { res.json({ unavailable: true }); }
});
let lastNominatim = 0;
app.get('/api/geocode', Sec.limit('geocode', 30, MIN), async (req, res) => {
  const q = clean(req.query.q, 120); if (q.length < 2) return res.json([]);
  try {
    const list = await cached('g:' + q.toLowerCase(), 24 * H, async () => {
      const wait = Math.max(0, lastNominatim + 1100 - now()); if (wait) await new Promise(r => setTimeout(r, wait)); lastNominatim = now();
      const j = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ng&limit=6&q=${encodeURIComponent(q)}`,
        { 'User-Agent': `SafeRouteNaija/3.0 (${process.env.ADMIN_EMAIL || 'admin'})`, 'Accept-Language': 'en' });
      return j.map(x => ({ name: x.display_name.split(',').slice(0, 3).join(','), full: x.display_name, lat: +x.lat, lng: +x.lon }));
    });
    res.json(list);
  } catch (e) { fail(res, 502, 'Place search is not available right now. Pick the destination on the map instead.'); }
});
const ROUTER = (process.env.ROUTER_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
async function osrm(points, alternatives) {
  const p = points.map(p => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';');
  const j = await getJSON(`${ROUTER}/route/v1/driving/${p}?alternatives=${alternatives ? 3 : 'false'}&overview=full&geometries=geojson&steps=false`, { 'User-Agent': 'SafeRouteNaija/3.0' }, 20000);
  if (j.code !== 'Ok') throw new Error(j.message || j.code);
  return j.routes.map(r => ({ distance: r.distance, duration: r.duration, coords: thin(r.geometry.coordinates.map(c => [c[1], c[0]]), 1500) }));
}
function thin(c, max) { if (c.length <= max) return c; const s = c.length / max, out = []; for (let i = 0; i < c.length; i += s) out.push(c[Math.floor(i)]); out.push(c[c.length - 1]); return out; }
app.get('/api/route', Sec.limit('route', 20, MIN), async (req, res) => {
  const a = coord(...String(req.query.from || '').split(',')), b = coord(...String(req.query.to || '').split(','));
  if (!a || !b) return fail(res, 400, 'Start and destination are required');
  try {
    const routes = await cached('r:' + [a, b].map(p => p.map(x => x.toFixed(3)).join(',')).join(';'), 6 * H, async () => {
      let rs = await osrm([a, b], true);
      if (rs.length < 2) {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dLat = b[0] - a[0], dLng = b[1] - a[1];
        for (const side of [1, -1]) {
          try {
            const [r] = await osrm([a, [mid[0] - dLng * 0.12 * side, mid[1] + dLat * 0.12 * side], b], false);
            if (r && rs.every(x => Math.abs(x.distance - r.distance) / x.distance > 0.03) && r.distance < rs[0].distance * 1.6) rs.push(r);
          } catch (e) {}
        }
      }
      return rs.slice(0, 3);
    });
    res.json({ routes });
  } catch (e) { fail(res, 502, 'The route service is not available right now. Try again in a minute.'); }
});

// ======================================================================
// Reports, protected evidence, community alerts
// ======================================================================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
function saveMedia(file) {
  if (!file) return null;
  const c = Media.clean(file.buffer);
  if (!c) { const e = new Error('That file is not a photo or video we can accept (JPEG, PNG, WebP, MP4, WebM, MOV)'); e.status = 400; throw e; }
  const name = crypto.randomBytes(14).toString('hex') + c.ext;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), c.data, { mode: 0o640 });
  return { name, type: c.type };
}
const responderIds = p => respondersNear(p).map(u => u.id);
function activeFleetJourney(userId) { return db.prepare(`SELECT * FROM journeys WHERE user_id=? AND fleet_id IS NOT NULL AND status IN ('active','overdue','escalated')`).get(userId); }

app.post('/api/reports', signedIn, Sec.limit('reports', 30, H, r => r.user ? 'u' + r.user.id : r.ip), upload.single('media'), (req, res) => {
  const T = typesObj(), type = clean(req.body.type, 20), t = T[type], p = coord(req.body.lat, req.body.lng);
  if (!t || !t.active || !p) return fail(res, 400, 'Choose an incident category and location');
  const security = isSecurity(req.user), mod = isModerator(req.user);
  if (type === 'advisory' && !security) return fail(res, 403, 'Only verified security accounts can post advisories');
  if (t.staff_only && !security && !mod) return fail(res, 403, 'Only moderators can add this category');
  if (!security && !mod && setting('public_reporting_enabled', 1) === 0) return fail(res, 503, 'New reports are paused for a short time. In an emergency call 112.');
  if (!security && !mod && db.prepare(`SELECT COUNT(*) n FROM reports WHERE user_id=? AND created_at>?`).get(req.user.id, now() - H).n >= setting('reports_per_hour', 10))
    return fail(res, 429, 'You have sent many reports in the last hour. Please wait a little.');
  const media = saveMedia(req.file);
  const mins = Math.max(0, Math.min(7 * 24 * 60, +req.body.occurred_mins_ago || 0));
  const occurred = now() - mins * 60000, status = security || mod ? 'verified' : 'unverified';
  const affected = req.body.affected === '' || req.body.affected == null ? null : Math.max(0, Math.min(100000, Math.round(+req.body.affected) || 0));
  const source = ['witness', 'nearby', 'official', 'social'].includes(req.body.source) ? req.body.source : (security ? 'official' : 'witness');
  const fj = activeFleetJourney(req.user.id);
  const info = db.prepare(`INSERT INTO reports (user_id,type,lat,lng,note,photo,media_type,status,official,verified_by,moderated_by,moderated_at,created_at,occurred_at,expires_at,ongoing,injured,trapped,affected,source,org_id,fleet_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, type, p[0], p[1], clean(req.body.note, 600), media ? media.name : null, media ? media.type : null, status,
    security ? 1 : 0, status === 'verified' ? req.user.id : null, status === 'verified' ? req.user.id : null, status === 'verified' ? now() : null, now(), occurred, occurred + t.ttl_hours * H,
    triState(req.body.ongoing), triState(req.body.injured), triState(req.body.trapped), affected, source, security ? req.user.org_id : null, fj ? fj.fleet_id : null);
  const id = info.lastInsertRowid;
  geoSweep();
  if (status === 'verified') Sec.audit(req, type === 'advisory' ? 'advisory_published' : 'report_published_verified', 'report', id, { type });
  const urgent = (triState(req.body.injured) === 1 || triState(req.body.trapped) === 1 || ['kidnap', 'attack'].includes(type)) && triState(req.body.ongoing) !== 0;
  if (urgent) responderIds(p).forEach(uid => Jobs.queue({ kind: 'report', ref_id: id, channel: 'push', user_id: uid, title: `${t.icon} Urgent report: ${t.label}`,
    body: `${status === 'verified' ? 'Verified' : 'Unverified'} report ${placeName(p)}${triState(req.body.injured) === 1 ? ' · people injured' : ''}${triState(req.body.trapped) === 1 ? ' · people trapped' : ''}.`, url: `/admin#verify`, tag: 'report-' + id }));
  if (fj) fleetAlert(fj.fleet_id, fj, 'driver_report', `${first(req.user.name)} reported: ${t.label} ${placeName(p)}`, p, true);
  communityAlert(id);
  res.json({ id, status });
});
app.get('/api/my/reports', signedIn, (req, res) => {
  res.json(db.prepare(`SELECT id,type,lat,lng,note,status,resolved_reason,official,created_at FROM reports WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(req.user.id));
});
// evidence is only served to staff, the reporter, or everyone once a moderator has checked and published it (photos only)
app.get('/media/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const r = db.prepare(`SELECT * FROM reports WHERE photo=?`).get(file);
  if (!r) return res.status(404).end();
  const ok = isStaff(req.user) || (req.user && r.user_id === req.user.id) || (r.media_public && r.media_type !== 'video' && ['verified', 'investigating'].includes(r.status));
  if (!ok) return res.status(403).end();
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(path.join(DATA_DIR, 'uploads', file), err => { if (err && !res.headersSent) res.status(404).end(); });
});
app.post('/api/reports/:id/media', need(isModerator), (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id=?`).get(+req.params.id);
  if (!r || !r.photo) return fail(res, 404, 'No evidence on this report');
  if (r.media_type === 'video' && req.body.public) return fail(res, 400, 'Videos stay visible to staff only, because their location data cannot be removed automatically');
  db.prepare(`UPDATE reports SET media_public=? WHERE id=?`).run(req.body.public ? 1 : 0, r.id);
  Sec.audit(req, req.body.public ? 'media_published' : 'media_hidden', 'report', r.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/confirm', signedIn, Sec.limit('confirm', 60, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const kind = ['confirm', 'ongoing', 'resolved', 'inaccurate'].includes(req.body.kind) ? req.body.kind : null;
  if (!kind) return fail(res, 400, 'Choose an option');
  const r = db.prepare(`SELECT * FROM reports WHERE id=? AND status IN ('unverified','investigating','verified')`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found or already closed');
  if (r.user_id === req.user.id && kind !== 'resolved') return fail(res, 400, 'You cannot confirm your own report — but you can mark it resolved');
  const p = coord(req.body.lat, req.body.lng), d = p ? Risk.km(p, [r.lat, r.lng]) : null;
  db.prepare(`INSERT INTO confirmations (report_id,user_id,kind,lat,lng,distance_km,created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(report_id,user_id) DO UPDATE SET kind=excluded.kind, lat=excluded.lat, lng=excluded.lng, distance_km=excluded.distance_km, created_at=excluded.created_at`)
    .run(r.id, req.user.id, kind, p ? p[0] : null, p ? p[1] : null, d, now());
  if (r.user_id === req.user.id && kind === 'resolved' && !r.official) { db.prepare(`UPDATE reports SET status='resolved', resolved_reason='reporter' WHERE id=?`).run(r.id); return res.json({ ok: true, closed: true }); }
  const pool = activeReports();
  const e = pool.find(x => x.id === r.id);
  let closed = false;
  if (e && !r.official && e._resolved >= (r.status === 'verified' ? 3 : 2) && e._resolved > e._support) { db.prepare(`UPDATE reports SET status='resolved', resolved_reason='community' WHERE id=?`).run(r.id); closed = true; }
  else communityAlert(r.id);
  res.json({ ok: true, closed, confidence: e && e.confidence, confLabel: e && e.confLabel, distance_km: d });
});
app.post('/api/reports/:id/moderate', need(isModerator), (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id=?`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found');
  const T = typesObj(), type = T[req.body.type] ? req.body.type : r.type, t = T[type], note = clean(req.body.note, 200) || null, a = req.body.action, at = now();
  if (a === 'investigate') db.prepare(`UPDATE reports SET status='investigating', type=?, moderated_by=?, moderated_at=?, status_note=COALESCE(?,status_note) WHERE id=?`).run(type, req.user.id, at, note, r.id);
  else if (a === 'verify') {
    const exp = Math.max((r.occurred_at || r.created_at) + t.ttl_hours * H, at + Math.min(t.ttl_hours, 12) * H);
    db.prepare(`UPDATE reports SET status='verified', type=?, verified_by=?, moderated_by=?, moderated_at=?, expires_at=?, status_note=COALESCE(?,status_note) WHERE id=?`).run(type, req.user.id, req.user.id, at, exp, note, r.id);
    if (r.status !== 'verified') adjustTrust(r.user_id, 0.05);
  } else if (a === 'reject') {
    db.prepare(`UPDATE reports SET status='rejected', moderated_by=?, moderated_at=?, status_note=COALESCE(?,status_note) WHERE id=?`).run(req.user.id, at, note, r.id);
    if (r.status !== 'rejected') adjustTrust(r.user_id, -0.1);
  } else if (a === 'resolve') db.prepare(`UPDATE reports SET status='resolved', resolved_reason='moderator', moderated_by=?, moderated_at=? WHERE id=?`).run(req.user.id, at, r.id);
  else if (a === 'retype') db.prepare(`UPDATE reports SET type=? WHERE id=?`).run(type, r.id);
  else return fail(res, 400, 'Unknown action');
  Sec.audit(req, 'report_' + a, 'report', r.id, { from: r.status, type, note });
  if (a === 'verify' || a === 'investigate') communityAlert(r.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/respond', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  db.prepare(`UPDATE reports SET responding_by=? WHERE id=? AND status IN ('unverified','investigating','verified')`).run(req.body.responding ? req.user.id : null, +req.params.id);
  Sec.audit(req, req.body.responding ? 'report_responding' : 'report_not_responding', 'report', +req.params.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/official', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id=?`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found');
  const t = typesObj()[r.type];
  db.prepare(`UPDATE reports SET status='verified', official=1, org_id=COALESCE(org_id,?), verified_by=?, moderated_by=?, moderated_at=?, expires_at=MAX(COALESCE(expires_at,0), ?) WHERE id=?`)
    .run(req.user.org_id || null, req.user.id, req.user.id, now(), now() + Math.min(t.ttl_hours, 12) * H, r.id);
  if (r.status !== 'verified') adjustTrust(r.user_id, 0.05);
  Sec.audit(req, 'report_official', 'report', r.id, { from: r.status });
  communityAlert(r.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/clear', need(isStaff), (req, res) => {
  db.prepare(`UPDATE reports SET status='resolved', resolved_reason='security', responding_by=NULL, moderated_by=?, moderated_at=? WHERE id=?`).run(req.user.id, now(), +req.params.id);
  Sec.audit(req, 'report_resolved', 'report', +req.params.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/assign', need(isSecurity), (req, res) => {
  db.prepare(`UPDATE reports SET assigned_org=?, assigned_user=? WHERE id=?`).run(+req.body.org_id || null, +req.body.user_id || null, +req.params.id);
  Sec.audit(req, 'report_assigned', 'report', +req.params.id, { org: req.body.org_id, user: req.body.user_id });
  res.json({ ok: true });
});

// ---- community alerts: people who chose an area/radius/categories get a push when a report becomes public ----
const DEFAULT_PREFS = { enabled: true, current: true, radius_km: 10, verified_only: false, categories: null };
const prefsOf = u => ({ ...DEFAULT_PREFS, ...(J(u.alert_prefs) || {}) });
function communityAlert(reportId) {
  try {
    if (setting('community_alerts_enabled', 1) === 0) return;
    const T = typesObj();
    const [r] = enrich(db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.id=?`).all(reportId), activeReports());
    if (!r || !['unverified', 'investigating', 'verified'].includes(r.status) || !isPublic(r, T)) return;
    const level = r.status === 'verified' ? 2 : 1;
    if (level <= r.alert_level) return;
    db.prepare(`UPDATE reports SET alert_level=? WHERE id=?`).run(level, r.id);
    const t = T[r.type], p = [r.lat, r.lng], where = placeName(p);
    const perHour = setting('community_alerts_per_hour', 10);
    const users = db.prepare(`SELECT id, alert_prefs, last_lat, last_lng, last_loc_at FROM users WHERE banned=0 AND id!=?`).all(r.user_id || 0);
    const areas = db.prepare(`SELECT * FROM alert_areas`).all();
    const areasBy = {}; areas.forEach(a => (areasBy[a.user_id] = areasBy[a.user_id] || []).push(a));
    for (const u of users) {
      const pr = prefsOf(u);
      if (!pr.enabled || (pr.verified_only && level < 2)) continue;
      if (Array.isArray(pr.categories) && !pr.categories.includes(r.type)) continue;
      if (!Array.isArray(pr.categories) && t.grp === 'info') continue;
      let hit = null;
      for (const a of areasBy[u.id] || []) { const d = Risk.km(p, [a.lat, a.lng]); if (d <= a.radius_km && (!hit || d < hit.d)) hit = { d, name: a.name }; }
      if (!hit && pr.current && u.last_loc_at && now() - u.last_loc_at < 6 * H) { const d = Risk.km(p, [u.last_lat, u.last_lng]); if (d <= pr.radius_km) hit = { d, name: 'you' }; }
      if (!hit || Sec.hit('calert:' + u.id, perHour, H)) continue;
      const verb = level === 2 ? (r.official ? 'An official' : 'A verified') : 'An unverified';
      Jobs.queue({ kind: 'alert', ref_id: r.id, channel: 'push', user_id: u.id, tag: 'report-' + r.id, url: `/?report=${r.id}`,
        title: `${t.icon} ${t.grp === 'security' ? 'Security alert' : 'Road alert'}`,
        body: `${verb} report of ${t.label.toLowerCase()} ${where} (${hit.d.toFixed(1)} km from ${hit.name === 'you' ? 'you' : hit.name}). ${t.grp === 'security' ? 'Exercise caution.' : t.advice} Last reported ${agoText(r.occurred_at || r.created_at)}.` });
    }
  } catch (e) { console.error('community alert', e.message); }
}
app.get('/api/alerts/prefs', signedIn, (req, res) => res.json({ prefs: prefsOf(req.user), areas: db.prepare(`SELECT * FROM alert_areas WHERE user_id=?`).all(req.user.id) }));
app.put('/api/alerts/prefs', signedIn, (req, res) => {
  const T = typesObj(), b = req.body || {};
  const prefs = { enabled: !!b.enabled, current: !!b.current, radius_km: Math.max(1, Math.min(100, +b.radius_km || 10)), verified_only: !!b.verified_only,
    categories: Array.isArray(b.categories) ? b.categories.filter(k => T[k]) : null };
  db.prepare(`UPDATE users SET alert_prefs=? WHERE id=?`).run(JSON.stringify(prefs), req.user.id);
  if (!prefs.current) db.prepare(`UPDATE users SET last_lat=NULL, last_lng=NULL, last_loc_at=NULL WHERE id=?`).run(req.user.id);
  res.json({ prefs });
});
app.post('/api/alerts/areas', signedIn, (req, res) => {
  const p = coord(req.body.lat, req.body.lng), name = clean(req.body.name, 40), r = Math.max(1, Math.min(100, +req.body.radius_km || 5));
  if (!p || !name) return fail(res, 400, 'Name and location needed');
  if (db.prepare(`SELECT COUNT(*) n FROM alert_areas WHERE user_id=?`).get(req.user.id).n >= 5) return fail(res, 400, 'Up to 5 areas');
  db.prepare(`INSERT INTO alert_areas (user_id,name,lat,lng,radius_km) VALUES (?,?,?,?,?)`).run(req.user.id, name, p[0], p[1], r);
  res.json({ ok: true });
});
app.delete('/api/alerts/areas/:id', signedIn, (req, res) => { db.prepare(`DELETE FROM alert_areas WHERE id=? AND user_id=?`).run(+req.params.id, req.user.id); res.json({ ok: true }); });
// last known location is kept only if the user turned on "alerts where I am"
app.post('/api/presence', signedIn, Sec.limit('presence', 30, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const p = coord(req.body.lat, req.body.lng); if (!p) return fail(res, 400, 'Location needed');
  if (prefsOf(req.user).current) db.prepare(`UPDATE users SET last_lat=?, last_lng=?, last_loc_at=? WHERE id=?`).run(+p[0].toFixed(3), +p[1].toFixed(3), now(), req.user.id);
  res.json({ ok: true });
});
// inbox
app.get('/api/inbox', signedIn, (req, res) => res.json({
  items: db.prepare(`SELECT id,kind,title,body,url,read_at,created_at FROM user_alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 60`).all(req.user.id),
  unread: db.prepare(`SELECT COUNT(*) n FROM user_alerts WHERE user_id=? AND read_at IS NULL`).get(req.user.id).n
}));
app.post('/api/inbox/read', signedIn, (req, res) => { db.prepare(`UPDATE user_alerts SET read_at=? WHERE user_id=? AND read_at IS NULL`).run(now(), req.user.id); res.json({ ok: true }); });
// delivery receipts
app.post('/api/notif/ack', Sec.limit('ack', 120, MIN), (req, res) => res.json({ ok: Jobs.ack(req.body.job, String(req.body.ack || '')) }));
app.post('/api/twilio/status', (req, res) => {
  if (process.env.PUBLIC_URL && !notify.validTwilioSignature(process.env.PUBLIC_URL.replace(/\/$/, '') + req.originalUrl, req.body, req.get('x-twilio-signature'))) return res.status(403).end();
  Jobs.twilioStatus(req.query.job, String(req.query.t || ''), req.body.MessageStatus || req.body.CallStatus, req.body.ErrorCode);
  res.type('text/xml').send('<Response/>');
});

// ======================================================================
// Safe Circle, sharing, journeys with check-in, SOS
// ======================================================================
app.get('/api/circle', signedIn, (req, res) => res.json(db.prepare(`SELECT id,name,phone,email,relation FROM circle_contacts WHERE user_id=? ORDER BY id`).all(req.user.id)));
app.post('/api/circle', signedIn, (req, res) => {
  const name = clean(req.body.name, 60), phone = notify.normalisePhone(clean(req.body.phone, 30)), email = clean(req.body.email, 120), relation = clean(req.body.relation, 40);
  if (!name || (!phone && !email)) return fail(res, 400, 'Add a name and a phone number');
  if (db.prepare(`SELECT COUNT(*) n FROM circle_contacts WHERE user_id=?`).get(req.user.id).n >= 10) return fail(res, 400, 'Your Safe Circle can hold up to 10 people');
  const info = db.prepare(`INSERT INTO circle_contacts (user_id,name,phone,email,relation,created_at) VALUES (?,?,?,?,?,?)`).run(req.user.id, name, phone, email, relation, now());
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/circle/:id', signedIn, (req, res) => { db.prepare(`DELETE FROM circle_contacts WHERE id=? AND user_id=?`).run(+req.params.id, req.user.id); res.json({ ok: true }); });
// tell the circle: SMS (if configured) + push to circle members who also use the app
function notifyCircle(user, kind, refId, title, body, url, opts) {
  opts = opts || {};
  const contacts = db.prepare(`SELECT * FROM circle_contacts WHERE user_id=?`).all(user.id);
  let sms = 0;
  if (opts.sms !== false && notify.smsEnabled()) contacts.filter(c => c.phone).forEach(c => { Jobs.queue({ kind, ref_id: refId, channel: 'sms', phone: c.phone, body: `SafeRoute: ${body}${url ? ' ' + url : ''}` }); sms++; });
  if (opts.voice && notify.voiceEnabled()) contacts.filter(c => c.phone).forEach(c => Jobs.queue({ kind, ref_id: refId, channel: 'voice', phone: c.phone, body: opts.voice, max_attempts: 2 }));
  const phones = contacts.map(c => c.phone).filter(Boolean);
  const appUsers = phones.length ? db.prepare(`SELECT id FROM users WHERE phone IN (${phones.map(() => '?').join(',')}) AND id!=?`).all(...phones, user.id) : [];
  appUsers.forEach(u => Jobs.queue({ kind, ref_id: refId, channel: 'push', user_id: u.id, title, body, url: url ? url.replace(/^https?:\/\/[^/]+/, '') : '/', tag: kind + '-' + refId }));
  return { contacts: contacts.length, sms, push: appUsers.length };
}

function addPoint(share, p) {
  const last = db.prepare(`SELECT * FROM track_points WHERE share_id=? ORDER BY at DESC LIMIT 1`).get(share.id);
  if (!last || now() - last.at > 10000 || Risk.km([last.lat, last.lng], p) > 0.02) db.prepare(`INSERT INTO track_points (share_id,lat,lng,at) VALUES (?,?,?,?)`).run(share.id, p[0], p[1], now());
  db.prepare(`UPDATE shares SET last_lat=?, last_lng=?, updated_at=? WHERE id=?`).run(p[0], p[1], now(), share.id);
}
function newShare(user, kind, p, extra) {
  const token = randomToken(18);
  const info = db.prepare(`INSERT INTO shares (token,user_id,kind,sos_id,dest_name,route_json,last_lat,last_lng,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(token, user.id, kind, extra.sos_id || null, extra.dest_name || null, extra.route_json || null, p ? p[0] : null, p ? p[1] : null, now(), now());
  const share = db.prepare(`SELECT * FROM shares WHERE id=?`).get(info.lastInsertRowid);
  if (p) addPoint(share, p);
  return share;
}
const routeJson = route => Array.isArray(route) ? JSON.stringify(thin(route.filter(c => Array.isArray(c) && coord(c[0], c[1])).map(c => [+(+c[0]).toFixed(5), +(+c[1]).toFixed(5)]), 500)) : null;
function distToRoute(p, route) {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    // project on segment using a local flat approximation
    const kx = Math.cos(p[0] * Math.PI / 180) * 111.32, ky = 110.57;
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    best = Math.min(best, Math.sqrt(x * x + y * y));
  }
  return best;
}

app.post('/api/location', signedIn, Sec.limit('loc', 240, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const p = coord(req.body.lat, req.body.lng); if (!p) return fail(res, 400, 'Location needed');
  const speed = isFinite(+req.body.speed) ? +req.body.speed : null;
  const shares = db.prepare(`SELECT * FROM shares WHERE user_id=? AND active=1`).all(req.user.id);
  shares.forEach(s => addPoint(s, p));
  const sos = db.prepare(`SELECT id FROM sos WHERE user_id=? AND status!='closed'`).get(req.user.id);
  if (sos) db.prepare(`UPDATE sos SET lat=?, lng=?, updated_at=? WHERE id=?`).run(p[0], p[1], now(), sos.id);
  const jr = db.prepare(`SELECT * FROM journeys WHERE user_id=? AND status IN ('active','overdue','escalated')`).get(req.user.id);
  let journey = null;
  if (jr) journey = journeyLocation(jr, req.user, p, speed);
  res.json({ shares: shares.length, sos: !!sos, journey });
});

// ---- journeys ----
const jEvent = (jid, kind, text) => db.prepare(`INSERT INTO journey_events (journey_id,kind,text,at) VALUES (?,?,?,?)`).run(jid, kind, text, now());
const shareUrl = shareId => { const s = shareId && db.prepare(`SELECT token FROM shares WHERE id=?`).get(shareId); return s ? `${baseUrl(null)}/t/${s.token}` : ''; };
function journeyView(j) {
  if (!j) return null;
  return { id: j.id, dest_name: j.dest_name, origin_name: j.origin_name, dest: j.dest_lat != null ? [j.dest_lat, j.dest_lng] : null, expected_arrival: j.expected_arrival,
    grace_min: j.grace_min, checkin_every_min: j.checkin_every_min, status: j.status, started_at: j.started_at, last_seen_at: j.last_seen_at, off_route: !!j.off_route,
    checkin_due: !!(j.checkin_prompted_at && (!j.last_checkin_at || j.checkin_prompted_at > j.last_checkin_at)), reminder: !!j.reminder_at, fleet_id: j.fleet_id, vehicle_id: j.vehicle_id,
    url: shareUrl(j.share_id), route: J(j.route_json), events: db.prepare(`SELECT kind,text,at FROM journey_events WHERE journey_id=? ORDER BY at`).all(j.id) };
}
app.post('/api/journeys', signedIn, (req, res) => {
  const b = req.body, dest = coord(b.dest_lat, b.dest_lng), p = coord(b.lat, b.lng);
  if (!dest) return fail(res, 400, 'Destination needed');
  const eta = +b.expected_arrival;
  if (!(eta > now() && eta < now() + 48 * H)) return fail(res, 400, 'Expected arrival must be within the next 48 hours');
  let fleet = null, vehicle = null;
  if (+b.fleet_id) {
    fleet = db.prepare(`SELECT f.* FROM fleets f JOIN fleet_members m ON m.fleet_id=f.id WHERE f.id=? AND m.user_id=? AND f.active=1`).get(+b.fleet_id, req.user.id);
    if (!fleet) return fail(res, 403, 'You are not a member of that fleet');
    vehicle = +b.vehicle_id ? db.prepare(`SELECT * FROM vehicles WHERE id=? AND fleet_id=?`).get(+b.vehicle_id, fleet.id) : null;
  }
  db.prepare(`UPDATE journeys SET status='ended', ended_at=? WHERE user_id=? AND status IN ('active','overdue','escalated')`).run(now(), req.user.id);
  db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE user_id=? AND kind='trip' AND active=1`).run(now(), req.user.id);
  const rj = routeJson(b.route);
  const share = newShare(req.user, 'trip', p, { dest_name: clean(b.dest_name, 120), route_json: rj });
  const info = db.prepare(`INSERT INTO journeys (user_id,share_id,fleet_id,vehicle_id,origin_name,dest_name,dest_lat,dest_lng,route_json,expected_arrival,grace_min,alert_after_min,checkin_every_min,notify_arrival,started_at,last_lat,last_lng,last_seen_at,last_checkin_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, share.id, fleet ? fleet.id : null, vehicle ? vehicle.id : null, clean(b.origin_name, 120), clean(b.dest_name, 120),
    dest[0], dest[1], rj, eta, Math.max(5, Math.min(240, +b.grace_min || 30)), Math.max(5, Math.min(240, +b.alert_after_min || 20)),
    +b.checkin_every_min ? Math.max(15, Math.min(480, +b.checkin_every_min)) : null, b.notify_arrival === false ? 0 : 1, now(), p ? p[0] : null, p ? p[1] : null, p ? now() : null, now());
  const jid = info.lastInsertRowid;
  const url = `${baseUrl(req)}/t/${share.token}`;
  jEvent(jid, 'started', `Journey started${b.dest_name ? ' to ' + clean(b.dest_name, 120) : ''} · expected arrival ${hhmm(eta)}`);
  let told = null;
  if (b.notify_circle !== false) told = notifyCircle(req.user, 'journey', jid, `🚗 ${first(req.user.name)} started a journey`, `${req.user.name} started a journey${b.dest_name ? ' to ' + clean(b.dest_name, 80) : ''}. Expected arrival ${hhmm(eta)}. Follow live:`, url);
  if (fleet) fleetAlert(fleet.id, { id: jid, vehicle_id: vehicle && vehicle.id, user_id: req.user.id }, 'trip_started', `${first(req.user.name)}${vehicle ? ' (' + vehicle.plate + ')' : ''} started a trip to ${clean(b.dest_name, 80) || 'destination'} · ETA ${hhmm(eta)}`, p, false);
  res.json({ journey: journeyView(db.prepare(`SELECT * FROM journeys WHERE id=?`).get(jid)), told });
});
app.get('/api/journeys/active', signedIn, (req, res) => res.json(journeyView(db.prepare(`SELECT * FROM journeys WHERE user_id=? AND status IN ('active','overdue','escalated') ORDER BY id DESC LIMIT 1`).get(req.user.id))));
function myJourney(req) { return db.prepare(`SELECT * FROM journeys WHERE id=? AND user_id=?`).get(+req.params.id, req.user.id); }
app.post('/api/journeys/:id/checkin', signedIn, (req, res) => {
  const j = myJourney(req); if (!j) return fail(res, 404, 'Journey not found');
  const wasEsc = j.status === 'escalated';
  db.prepare(`UPDATE journeys SET last_checkin_at=?, checkin_prompted_at=NULL, status=CASE WHEN status IN ('overdue','escalated') AND ? < expected_arrival + grace_min*60000 THEN 'active' ELSE status END WHERE id=?`).run(now(), now(), j.id);
  jEvent(j.id, 'checkin', 'Checked in: “I’m OK”');
  if (wasEsc) notifyCircle(req.user, 'journey', j.id, `✅ ${first(req.user.name)} checked in`, `${req.user.name} has checked in and says they are OK.`, shareUrl(j.share_id));
  if (j.fleet_id && wasEsc) fleetAlert(j.fleet_id, j, 'checkin', `${first(req.user.name)} checked in: OK`, null, false);
  res.json({ journey: journeyView(db.prepare(`SELECT * FROM journeys WHERE id=?`).get(j.id)) });
});
app.post('/api/journeys/:id/extend', signedIn, (req, res) => {
  const j = myJourney(req); if (!j) return fail(res, 404, 'Journey not found');
  const mins = Math.max(10, Math.min(600, +req.body.minutes || 30));
  const eta = Math.max(j.expected_arrival, now()) + mins * MIN;
  db.prepare(`UPDATE journeys SET expected_arrival=?, reminder_at=NULL, escalated_at=NULL, status='active', last_checkin_at=? WHERE id=?`).run(eta, now(), j.id);
  jEvent(j.id, 'delay', `Delayed — new expected arrival ${hhmm(eta)}`);
  if (j.status === 'escalated' || req.body.tell) notifyCircle(req.user, 'journey', j.id, `⏱️ ${first(req.user.name)} is delayed`, `${req.user.name} is delayed and now expects to arrive around ${hhmm(eta)}.`, shareUrl(j.share_id), { sms: j.status === 'escalated' });
  if (j.fleet_id) fleetAlert(j.fleet_id, j, 'delay', `${first(req.user.name)} delayed — new ETA ${hhmm(eta)}`, null, false);
  res.json({ journey: journeyView(db.prepare(`SELECT * FROM journeys WHERE id=?`).get(j.id)) });
});
app.post('/api/journeys/:id/detour', signedIn, (req, res) => {
  const j = myJourney(req); if (!j) return fail(res, 404, 'Journey not found');
  db.prepare(`UPDATE journeys SET detour_ok_until=?, off_route=0, off_route_count=0 WHERE id=?`).run(now() + 60 * MIN, j.id);
  jEvent(j.id, 'detour', 'Planned detour confirmed by the traveller');
  if (j.fleet_id) fleetAlert(j.fleet_id, j, 'detour', `${first(req.user.name)} confirmed a planned detour`, null, false);
  res.json({ ok: true });
});
function finishJourney(j, user, arrived) {
  db.prepare(`UPDATE journeys SET status=?, ended_at=? WHERE id=?`).run(arrived ? 'arrived' : 'ended', now(), j.id);
  db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE id=?`).run(now(), j.share_id);
  jEvent(j.id, arrived ? 'arrived' : 'ended', arrived ? `Arrived${j.dest_name ? ' at ' + j.dest_name : ''}` : 'Journey ended by the traveller');
  if (arrived && j.notify_arrival) notifyCircle(user, 'journey', j.id, `🏁 ${first(user.name)} arrived`, `${user.name} has arrived${j.dest_name ? ' at ' + j.dest_name : ''} safely.`, null);
  else if (!arrived && j.status === 'escalated') notifyCircle(user, 'journey', j.id, `${first(user.name)} ended their journey`, `${user.name} ended their journey sharing and is OK.`, null);
  if (j.fleet_id) fleetAlert(j.fleet_id, j, arrived ? 'arrived' : 'ended', `${first(user.name)} ${arrived ? 'arrived' + (j.dest_name ? ' at ' + j.dest_name : '') : 'ended the trip'}`, null, false);
}
app.post('/api/journeys/:id/arrived', signedIn, (req, res) => { const j = myJourney(req); if (!j) return fail(res, 404, 'Journey not found'); if (['active', 'overdue', 'escalated'].includes(j.status)) finishJourney(j, req.user, true); res.json({ ok: true }); });
app.post('/api/journeys/:id/end', signedIn, (req, res) => { const j = myJourney(req); if (!j) return fail(res, 404, 'Journey not found'); if (['active', 'overdue', 'escalated'].includes(j.status)) finishJourney(j, req.user, false); res.json({ ok: true }); });

function journeyLocation(j, user, p, speed) {
  const fleet = j.fleet_id ? db.prepare(`SELECT * FROM fleets WHERE id=?`).get(j.fleet_id) : null;
  const upd = { last_lat: p[0], last_lng: p[1], last_seen_at: now(), last_speed: speed, offline_alerted: 0 };
  // arrival
  if (j.dest_lat != null && Risk.km(p, [j.dest_lat, j.dest_lng]) * 1000 <= setting('arrive_radius_m', 300)) {
    db.prepare(`UPDATE journeys SET last_lat=?, last_lng=?, last_seen_at=? WHERE id=?`).run(p[0], p[1], now(), j.id);
    finishJourney(j, user, true); return { arrived: true };
  }
  // stop detection (fleet)
  if (j.stop_lat != null && Risk.km(p, [j.stop_lat, j.stop_lng]) < 0.15) { if (!j.stopped_since) upd.stopped_since = now(); }
  else { upd.stopped_since = null; upd.stop_lat = p[0]; upd.stop_lng = p[1]; upd.stop_alerted = 0; }
  if (j.stop_lat == null) { upd.stop_lat = p[0]; upd.stop_lng = p[1]; }
  // deviation from the planned route
  const route = J(j.route_json);
  let off = null;
  if (route && route.length > 1) {
    const d = distToRoute(p, route), limitKm = fleet ? fleet.deviation_km : setting('deviation_km', 2);
    off = d;
    if (d > limitKm && !(j.detour_ok_until > now())) {
      upd.off_route_count = j.off_route_count + 1;
      if (upd.off_route_count >= 2 && !j.off_route) {
        upd.off_route = 1; upd.deviation_alert_at = now();
        const where = placeName(p);
        jEvent(j.id, 'deviation', `Moved about ${d.toFixed(1)} km off the planned route ${where}`);
        Jobs.queue({ kind: 'journey', ref_id: j.id, channel: 'push', user_id: user.id, title: 'Off your planned route?', body: 'You are more than ' + limitKm + ' km from your planned route. If this is a planned detour, tap to confirm.', url: '/?journey=1', tag: 'dev-' + j.id });
        if (!j.deviation_alert_at || now() - j.deviation_alert_at > 30 * MIN)
          notifyCircle(user, 'journey', j.id, `↪️ ${first(user.name)} left the planned route`, `${user.name}'s journey has moved about ${d.toFixed(1)} km off the planned route ${where}. This may be a planned detour. Follow live:`, shareUrl(j.share_id));
        if (fleet) fleetAlert(fleet.id, j, 'deviation', `${first(user.name)} is ${d.toFixed(1)} km off the planned route ${where}`, p, true);
      }
    } else if (d <= limitKm) {
      upd.off_route_count = 0;
      if (j.off_route) { upd.off_route = 0; jEvent(j.id, 'on_route', 'Back on the planned route'); }
    }
  }
  const sets = Object.keys(upd);
  db.prepare(`UPDATE journeys SET ${sets.map(k => k + '=?').join(',')} WHERE id=?`).run(...sets.map(k => upd[k]), j.id);
  return { off_route_km: off, off_route: upd.off_route != null ? !!upd.off_route : !!j.off_route };
}

// journey monitor: reminders, missed check-ins, escalation, unscheduled stops, lost signal
function journeyMonitor() {
  const list = db.prepare(`SELECT j.*, u.name AS uname FROM journeys j JOIN users u ON u.id=j.user_id WHERE j.status IN ('active','overdue','escalated')`).all();
  for (const j of list) {
    try {
      const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(j.user_id);
      const fleet = j.fleet_id ? db.prepare(`SELECT * FROM fleets WHERE id=?`).get(j.fleet_id) : null;
      const t = now();
      if (t - j.started_at > 48 * H) { finishJourney(j, user, false); continue; }
      const lastSeen = j.last_seen_at ? `Last location update ${hhmm(j.last_seen_at)}${j.last_lat != null ? ' ' + placeName([j.last_lat, j.last_lng]) : ''}` : 'No location updates received';
      const signal = j.last_seen_at && t - j.last_seen_at > 20 * MIN ? ' — no updates since then, which can be caused by poor network coverage' : '';
      // lost signal: recorded, never treated as an emergency on its own
      const offMin = fleet ? fleet.offline_min : 30;
      if (j.last_seen_at && t - j.last_seen_at > offMin * MIN && !j.offline_alerted) {
        db.prepare(`UPDATE journeys SET offline_alerted=1 WHERE id=?`).run(j.id);
        jEvent(j.id, 'no_signal', `No location updates for ${offMin} minutes (possibly poor network)`);
        if (fleet) fleetAlert(fleet.id, j, 'no_signal', `${first(j.uname)}: no location updates for ${offMin} min (possibly poor network). ${lastSeen}.`, j.last_lat != null ? [j.last_lat, j.last_lng] : null, true);
      }
      // unscheduled stop (fleet trips)
      if (fleet && j.stopped_since && !j.stop_alerted && t - j.stopped_since > fleet.stop_min * MIN && t - j.last_seen_at < 10 * MIN) {
        const sp = [j.stop_lat, j.stop_lng];
        const known = Risk.nearest(sp, placesAll(), null);
        const nearDest = j.dest_lat != null && Risk.km(sp, [j.dest_lat, j.dest_lng]) < 1;
        db.prepare(`UPDATE journeys SET stop_alerted=1 WHERE id=?`).run(j.id);
        if (!nearDest && !(known && known.d < 0.3)) fleetAlert(fleet.id, j, 'unscheduled_stop', `${first(j.uname)} has been stopped for ${Math.round((t - j.stopped_since) / MIN)} min ${placeName(sp)} (not at a known stop)`, sp, true);
      }
      // periodic check-ins
      if (j.checkin_every_min) {
        const since = j.last_checkin_at || j.started_at;
        if (!j.checkin_prompted_at && t - since > j.checkin_every_min * MIN) {
          db.prepare(`UPDATE journeys SET checkin_prompted_at=? WHERE id=?`).run(t, j.id);
          jEvent(j.id, 'checkin_due', 'Scheduled check-in requested');
          Jobs.queue({ kind: 'journey', ref_id: j.id, channel: 'push', user_id: j.user_id, title: 'Time to check in', body: 'Tap to tell your Safe Circle you are OK.', url: '/?journey=1', tag: 'checkin-' + j.id });
        } else if (j.checkin_prompted_at && t - j.checkin_prompted_at > j.alert_after_min * MIN && j.status !== 'escalated') {
          escalateJourney(j, user, fleet, `has missed a scheduled check-in (due ${hhmm(j.checkin_prompted_at)})`, lastSeen + signal);
          continue;
        }
      }
      // expected arrival passed
      if (j.expected_arrival && t > j.expected_arrival + j.grace_min * MIN) {
        if (!j.reminder_at) {
          db.prepare(`UPDATE journeys SET reminder_at=?, status='overdue' WHERE id=?`).run(t, j.id);
          jEvent(j.id, 'reminder', 'Expected arrival time passed — reminder sent to the traveller');
          Jobs.queue({ kind: 'journey', ref_id: j.id, channel: 'push', user_id: j.user_id, title: 'Have you arrived safely?', body: `Your expected arrival was ${hhmm(j.expected_arrival)}. Tap to confirm arrival or add more time.`, url: '/?journey=1', tag: 'arrive-' + j.id });
          if (user.phone && notify.smsEnabled()) Jobs.queue({ kind: 'journey', ref_id: j.id, channel: 'sms', phone: user.phone, body: `SafeRoute: Have you arrived safely? Open the app to confirm, or your Safe Circle will be alerted in ${j.alert_after_min} minutes.` });
        } else if (j.status === 'overdue' && t - j.reminder_at > j.alert_after_min * MIN) {
          escalateJourney(j, user, fleet, `has not confirmed arrival${j.dest_name ? ' at ' + j.dest_name : ''} (expected ${hhmm(j.expected_arrival)})`, lastSeen + signal);
        }
      }
    } catch (e) { console.error('journey monitor', j.id, e.message); }
  }
}
function escalateJourney(j, user, fleet, what, lastSeen) {
  db.prepare(`UPDATE journeys SET status='escalated', escalated_at=? WHERE id=?`).run(now(), j.id);
  jEvent(j.id, 'missed_checkin', `Missed check-in: Safe Circle alerted. ${lastSeen}.`);
  notifyCircle(user, 'journey', j.id, `⚠️ Missed check-in: ${first(user.name)}`,
    `Missed check-in — ${user.name} ${what}. ${lastSeen}. This is not an SOS: please try calling them. If you cannot reach them and are worried, contact the police (112). Live map:`, shareUrl(j.share_id));
  if (fleet) fleetAlert(fleet.id, j, 'missed_checkin', `Missed check-in: ${first(user.name)} ${what}. ${lastSeen}.`, j.last_lat != null ? [j.last_lat, j.last_lng] : null, true);
}
setInterval(() => { try { journeyMonitor(); sosMonitor(); } catch (e) { console.error(e); } }, 30000).unref();

// ---- trip sharing without a destination ----
app.post('/api/share/start', signedIn, (req, res) => {
  db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE user_id=? AND kind='trip' AND active=1`).run(now(), req.user.id);
  const p = coord(req.body.lat, req.body.lng);
  const share = newShare(req.user, 'trip', p, { dest_name: clean(req.body.dest_name, 120), route_json: routeJson(req.body.route) });
  const url = `${baseUrl(req)}/t/${share.token}`;
  const told = req.body.notify ? notifyCircle(req.user, 'share', share.id, `👥 ${first(req.user.name)} is sharing their location`, `${req.user.name} is sharing their live location with you. Follow:`, url) : null;
  res.json({ token: share.token, url, told });
});
app.post('/api/share/stop', signedIn, (req, res) => { db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE user_id=? AND kind='trip' AND active=1`).run(now(), req.user.id); res.json({ ok: true }); });
app.get('/api/share/mine', signedIn, (req, res) => {
  const s = db.prepare(`SELECT token,dest_name,created_at FROM shares WHERE user_id=? AND kind='trip' AND active=1`).get(req.user.id);
  res.json(s ? { ...s, url: `${baseUrl(req)}/t/${s.token}` } : null);
});

// ---- push subscriptions ----
app.post('/api/push/subscribe', signedIn, (req, res) => {
  const s = req.body.subscription;
  if (!s || !s.endpoint || !s.keys || !/^https:\/\//.test(s.endpoint)) return fail(res, 400, 'Invalid subscription');
  db.prepare(`INSERT INTO push_subs (user_id,endpoint,keys_json,created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys_json=excluded.keys_json`)
    .run(req.user.id, clean(s.endpoint, 1000), JSON.stringify(s.keys), now());
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', signedIn, (req, res) => { db.prepare(`DELETE FROM push_subs WHERE endpoint=? AND user_id=?`).run(clean(req.body.endpoint, 1000), req.user.id); res.json({ ok: true }); });
app.post('/api/push/test', signedIn, Sec.limit('ptest', 5, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  Jobs.queue({ kind: 'test', channel: 'push', user_id: req.user.id, title: 'SafeRoute test', body: 'Notifications work on this device.', url: '/', tag: 'test', max_attempts: 1 });
  res.json({ ok: true });
});

// ---- responders ----
function respondersNear(p, radiusMul) {
  const radius = setting('sos_radius_km', 60) * (radiusMul || 1);
  const orgs = {}; db.prepare(`SELECT * FROM organisations`).all().forEach(o => { orgs[o.id] = o; });
  return db.prepare(`SELECT * FROM users WHERE banned=0 AND ((role='security' AND security_status='verified') OR role='admin')`).all().filter(u => {
    if (radiusMul === Infinity) return true;
    const o = u.org_id && orgs[u.org_id];
    const base = u.base_lat != null ? [u.base_lat, u.base_lng] : o && o.lat != null ? [o.lat, o.lng] : null;
    return !base || Risk.km(p, base) <= Math.max(radius, o && o.radius_km ? o.radius_km * (radiusMul || 1) : 0);
  });
}

// ---- SOS (Emergency Connect) ----
const sosEvent = (sosId, kind, text, pub) => db.prepare(`INSERT INTO sos_events (sos_id,kind,text,public,at) VALUES (?,?,?,?,?)`).run(sosId, kind, text, pub === false ? 0 : 1, now());
const SOS_TYPES = { attack: 'Attack or robbery', kidnap: 'Kidnapping', accident: 'Road accident', medical: 'Medical emergency', fire: 'Fire', other: 'Emergency' };
const sosRef = () => `SR-${tzNow().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`;
function alertResponders(s, user, level, url) {
  const p = [s.lat, s.lng];
  const rs = level === 0 ? respondersNear(p) : level === 1 ? respondersNear(p, 2) : respondersNear(p, Infinity);
  const label = SOS_TYPES[s.type] || 'Emergency';
  const title = `${level ? '‼️ ESCALATED ' : '🆘 '}SOS ${s.ref}`;
  const body = `${label} — ${user.name}${user.phone ? ' · ' + user.phone : ''} ${placeName(p)}.${level ? ' No responder has acknowledged yet.' : ''} Tap to respond.`;
  for (const u of rs) {
    Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'push', user_id: u.id, title, body, url: `/admin#sos`, tag: 'sos-' + s.id });
    if (u.phone && u.notify_sms && notify.smsEnabled() && (u.role === 'security' || level >= 2)) Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'sms', phone: u.phone, body: `SafeRoute ${level ? 'ESCALATED ' : ''}SOS ${s.ref}: ${label} ${placeName(p)} (${p[0].toFixed(5)},${p[1].toFixed(5)}). ${user.name}${user.phone ? ' ' + user.phone : ''}. Track: ${url}` });
    if (level >= 1 && u.phone && u.notify_voice && notify.voiceEnabled()) Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'voice', phone: u.phone, max_attempts: 2, body: `SafeRoute emergency alert. S O S reference ${s.ref.split('').join(' ')}. ${label} ${placeName(p)}. No responder has acknowledged it yet. Please open the SafeRoute app now.` });
  }
  return rs.length;
}
app.post('/api/sos', signedIn, Sec.limit('sos', 20, H, r => 'u' + (r.user && r.user.id)), async (req, res) => {
  const p = coord(req.body.lat, req.body.lng);
  if (!p) return fail(res, 400, 'Location needed. Turn on location, or call 112.');
  const open = db.prepare(`SELECT * FROM sos WHERE user_id=? AND status!='closed' AND duress=0`).get(req.user.id);
  if (open) { db.prepare(`UPDATE sos SET lat=?, lng=?, updated_at=? WHERE id=?`).run(p[0], p[1], now(), open.id); return res.json(sosView(open.id, req)); }
  const type = SOS_TYPES[req.body.type] ? req.body.type : 'other';
  const fj = activeFleetJourney(req.user.id);
  const info = db.prepare(`INSERT INTO sos (user_id,lat,lng,note,status,ref,type,fleet_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, p[0], p[1], clean(req.body.note, 300), 'open', sosRef(), type, fj ? fj.fleet_id : null, now(), now());
  const sosId = info.lastInsertRowid;
  geoSweep();
  const share = newShare(req.user, 'sos', p, { sos_id: sosId });
  db.prepare(`UPDATE sos SET share_id=? WHERE id=?`).run(share.id, sosId);
  const s = db.prepare(`SELECT * FROM sos WHERE id=?`).get(sosId);
  const url = `${baseUrl(req)}/t/${share.token}`;
  sosEvent(sosId, 'created', `SOS ${s.ref} sent: ${SOS_TYPES[type]}`);
  const told = notifyCircle(req.user, 'sos', sosId, `🆘 ${req.user.name} needs help`,
    `EMERGENCY: ${req.user.name} sent an SOS (${SOS_TYPES[type]}) at ${hhmm(now())} ${placeName(p)}. Ref ${s.ref}. If you cannot reach them, call 112. Live location:`, url);
  const n = alertResponders(s, req.user, 0, url);
  sosEvent(sosId, 'notified', `Alert sent to ${n} verified responder account${n === 1 ? '' : 's'}${told.contacts ? ` and ${told.contacts} Safe Circle contact${told.contacts === 1 ? '' : 's'}` : ''}`, false);
  if (!told.contacts) sosEvent(sosId, 'info', 'No Safe Circle contacts set up — add some in the Circle tab', false);
  else if (!notify.smsEnabled()) sosEvent(sosId, 'info', 'SMS is not switched on for this server, so contacts were not texted. Use “SMS from my phone”.', false);
  if (fj) fleetAlert(fj.fleet_id, fj, 'sos', `🆘 Driver SOS ${s.ref}: ${first(req.user.name)} — ${SOS_TYPES[type]} ${placeName(p)}`, p, true);
  Sec.audit({ ip: req.ip, user: req.user }, 'sos_created', 'sos', sosId);
  res.json(sosView(sosId, req));
});
function sosView(id, req) {
  const s = db.prepare(`SELECT s.*, sh.token FROM sos s LEFT JOIN shares sh ON sh.id=s.share_id WHERE s.id=?`).get(id);
  if (!s) return null;
  return { id: s.id, ref: s.ref, type: s.type, status: s.duress ? 'cancelled' : s.status, created_at: s.created_at, updated_at: s.updated_at, escalation_level: s.escalation_level,
    url: s.token ? `${baseUrl(req)}/t/${s.token}` : null, events: s.duress ? [] : db.prepare(`SELECT kind,text,at FROM sos_events WHERE sos_id=? ORDER BY at`).all(id),
    delivery: s.duress ? {} : Jobs.summary('sos', s.id), sms_enabled: notify.smsEnabled() };
}
// escalation when nobody acknowledges
function sosMonitor() {
  const e1 = setting('sos_escalate_min', 3) * MIN, e2 = setting('sos_escalate2_min', 10) * MIN;
  for (const s of db.prepare(`SELECT * FROM sos WHERE (status='open' OR (duress=1 AND status!='closed'))`).all()) {
    const age = now() - s.created_at, user = db.prepare(`SELECT * FROM users WHERE id=?`).get(s.user_id);
    if (!user) continue;
    const url = shareUrl(s.share_id);
    if (s.status === 'open' && s.escalation_level < 1 && age > e1) {
      db.prepare(`UPDATE sos SET escalation_level=1 WHERE id=?`).run(s.id);
      const n = alertResponders(s, user, 1, url);
      sosEvent(s.id, 'escalated', `No acknowledgement after ${Math.round(e1 / MIN)} min — alert widened to ${n} responder account${n === 1 ? '' : 's'}${notify.voiceEnabled() ? ' with phone calls' : ''}`);
      if (notify.voiceEnabled()) notifyCircle(user, 'sos', s.id, `🆘 ${user.name} still needs help`, `${user.name}'s SOS ${s.ref} has not been acknowledged yet. Try calling them, or call 112. Live:`, url,
        { sms: false, voice: `SafeRoute emergency alert. ${user.name} sent an S O S and it has not been answered yet. Please check your text messages for their live location, and call 1 1 2 if you cannot reach them.` });
    } else if (s.status === 'open' && s.escalation_level < 2 && age > e2) {
      db.prepare(`UPDATE sos SET escalation_level=2 WHERE id=?`).run(s.id);
      const n = alertResponders(s, user, 2, url);
      sosEvent(s.id, 'escalated', `Still no acknowledgement after ${Math.round(e2 / MIN)} min — every verified responder and SafeRoute admin alerted (${n})`);
    }
  }
}
app.get('/api/sos/mine', signedIn, (req, res) => {
  const s = db.prepare(`SELECT id, duress FROM sos WHERE user_id=? AND status!='closed' ORDER BY id DESC LIMIT 1`).get(req.user.id);
  res.json(s && !s.duress ? sosView(s.id, req) : null);
});
app.post('/api/sos/cancel', signedIn, Sec.limit('soscancel', 10, 15 * MIN, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const s = db.prepare(`SELECT * FROM sos WHERE user_id=? AND status!='closed' AND duress=0`).get(req.user.id);
  if (!s) return res.json({ ok: true, cancelled: true });
  const pin = String(req.body.pin || ''), u = req.user;
  if (u.duress_pin_hash && pin && bcrypt.compareSync(pin, u.duress_pin_hash)) {
    db.prepare(`UPDATE sos SET duress=1, updated_at=? WHERE id=?`).run(now(), s.id);
    sosEvent(s.id, 'duress', 'Silent duress signal: the person may be under pressure. Treat as active.');
    const url = shareUrl(s.share_id);
    respondersNear([s.lat, s.lng], 2).forEach(r => {
      Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'push', user_id: r.id, title: `⚠️ DURESS ${s.ref}`, body: `${u.name} entered their duress PIN. Treat the SOS as active.`, url: `/admin#sos`, tag: 'sos-' + s.id });
      if (r.phone && r.notify_sms && notify.smsEnabled()) Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'sms', phone: r.phone, body: `SafeRoute DURESS ${s.ref}: ${u.name} may be under pressure. SOS remains active. Track: ${url}` });
    });
    Sec.audit({ ip: req.ip, user: u }, 'sos_duress', 'sos', s.id);
    return res.json({ ok: true, cancelled: true });
  }
  const okPin = u.cancel_pin_hash ? bcrypt.compareSync(pin, u.cancel_pin_hash) : bcrypt.compareSync(String(req.body.password || pin), u.password_hash);
  if (!okPin) return fail(res, 403, u.cancel_pin_hash ? 'Wrong PIN' : 'Wrong password');
  db.prepare(`UPDATE sos SET status='closed', cancelled_at=?, closed_reason='cancelled', updated_at=? WHERE id=?`).run(now(), now(), s.id);
  db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE id=?`).run(now(), s.share_id);
  sosEvent(s.id, 'cancelled', 'Cancelled by the person who sent it');
  respondersNear([s.lat, s.lng], 2).forEach(r => Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'push', user_id: r.id, title: `SOS ${s.ref} cancelled`, body: `${u.name} cancelled the alert.`, url: '/?tab=security', tag: 'sos-' + s.id, inbox: false }));
  notifyCircle(u, 'sos', s.id, `${first(u.name)} cancelled the SOS`, `${u.name} cancelled their SOS ${s.ref}.`, null, { sms: notify.smsEnabled() });
  Sec.audit({ ip: req.ip, user: u }, 'sos_cancelled', 'sos', s.id);
  res.json({ ok: true, cancelled: true });
});
app.get('/api/sos', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  const list = db.prepare(`SELECT s.*, u.name, u.phone, sh.token, o.name AS org_name, au.name AS assignee FROM sos s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN shares sh ON sh.id=s.share_id
    LEFT JOIN organisations o ON o.id=s.assigned_org LEFT JOIN users au ON au.id=s.assigned_user
    WHERE s.status!='closed' OR (s.duress=1 AND s.status!='closed') OR s.updated_at>? ORDER BY s.created_at DESC LIMIT 100`).all(now() - 24 * H);
  res.json(list.map(s => ({ id: s.id, ref: s.ref, type: s.type, type_label: SOS_TYPES[s.type] || 'Emergency', status: s.status, duress: s.duress, lat: s.lat, lng: s.lng,
    name: s.name, phone: s.phone, note: s.note, created_at: s.created_at, updated_at: s.updated_at, url: s.token ? `/t/${s.token}` : null, escalation_level: s.escalation_level,
    assigned_org: s.assigned_org, org_name: s.org_name, assigned_user: s.assigned_user, assignee: s.assignee, fleet_id: s.fleet_id, delivery: Jobs.summary('sos', s.id),
    events: db.prepare(`SELECT kind,text,at FROM sos_events WHERE sos_id=? ORDER BY at`).all(s.id),
    notes: db.prepare(`SELECT n.text, n.at, u.name FROM staff_notes n JOIN users u ON u.id=n.user_id WHERE n.target_type='sos' AND n.target_id=? ORDER BY n.at`).all(s.id),
    trail: s.share_id ? db.prepare(`SELECT lat,lng,at FROM track_points WHERE share_id=? ORDER BY at DESC LIMIT 30`).all(s.share_id).reverse() : [] })));
});
app.post('/api/sos/:id/status', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  const s = db.prepare(`SELECT * FROM sos WHERE id=?`).get(+req.params.id);
  if (!s) return fail(res, 404, 'Not found');
  const status = ['acknowledged', 'responding', 'on_scene', 'closed'].includes(req.body.status) ? req.body.status : null;
  if (!status) return fail(res, 400, 'Unknown status');
  const reason = ['resolved', 'false_alarm', 'unreachable', 'handed_over'].includes(req.body.reason) ? req.body.reason : null;
  const org = req.user.org_id ? db.prepare(`SELECT name FROM organisations WHERE id=?`).get(req.user.org_id) : null;
  const who = `${org ? org.name : req.user.agency ? req.user.agency : req.user.role === 'admin' ? 'SafeRoute team' : 'Security'} (${first(req.user.name)})`;
  db.prepare(`UPDATE sos SET status=?, responder_id=?, updated_at=?, closed_reason=COALESCE(?,closed_reason) WHERE id=?`).run(status, req.user.id, now(), status === 'closed' ? reason || 'resolved' : null, s.id);
  const text = { acknowledged: `Acknowledged by ${who}`, responding: `${who} is responding`, on_scene: `${who} is on the scene`, closed: `Closed by ${who}${reason ? ' (' + reason.replace('_', ' ') + ')' : ''}` }[status];
  sosEvent(s.id, status, text);
  if (status === 'closed') db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE id=?`).run(now(), s.share_id);
  if (status === 'closed' && reason === 'false_alarm') adjustTrust(s.user_id, -0.2);
  if (s.user_id) Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'push', user_id: s.user_id, title: `SOS ${s.ref}`, body: text, url: '/', tag: 'sos-' + s.id });
  const owner = db.prepare(`SELECT * FROM users WHERE id=?`).get(s.user_id);
  if (owner && (status === 'responding' || status === 'closed')) notifyCircle(owner, 'sos', s.id, `SOS ${s.ref} update`, `Update on ${owner.name}'s SOS ${s.ref}: ${text}.`, null, { sms: notify.smsEnabled() && status === 'responding' });
  Sec.audit(req, 'sos_' + status, 'sos', s.id, { reason });
  res.json({ ok: true });
});
app.post('/api/sos/:id/assign', need(isSecurity), (req, res) => {
  const s = db.prepare(`SELECT * FROM sos WHERE id=?`).get(+req.params.id); if (!s) return fail(res, 404, 'Not found');
  const org = +req.body.org_id ? db.prepare(`SELECT * FROM organisations WHERE id=?`).get(+req.body.org_id) : null;
  const officer = +req.body.user_id ? db.prepare(`SELECT * FROM users WHERE id=?`).get(+req.body.user_id) : null;
  db.prepare(`UPDATE sos SET assigned_org=?, assigned_user=? WHERE id=?`).run(org ? org.id : null, officer ? officer.id : null, s.id);
  sosEvent(s.id, 'assigned', `Assigned to ${officer ? officer.name : org ? org.name : 'nobody'}`, false);
  if (officer) Jobs.queue({ kind: 'sos', ref_id: s.id, channel: 'push', user_id: officer.id, title: `Assigned: SOS ${s.ref}`, body: `${first(req.user.name)} assigned this SOS to you.`, url: `/admin#sos`, tag: 'sos-' + s.id });
  Sec.audit(req, 'sos_assigned', 'sos', s.id, { org: org && org.id, user: officer && officer.id });
  res.json({ ok: true });
});
// internal coordination notes (staff only)
app.get('/api/notes/:type/:id', need(isStaff), (req, res) => res.json(db.prepare(`SELECT n.text, n.at, u.name FROM staff_notes n JOIN users u ON u.id=n.user_id WHERE n.target_type=? AND n.target_id=? ORDER BY n.at`).all(clean(req.params.type, 20), +req.params.id)));
app.post('/api/notes/:type/:id', need(isStaff), (req, res) => {
  const type = ['sos', 'report'].includes(req.params.type) ? req.params.type : null, text = clean(req.body.text, 500);
  if (!type || !text) return fail(res, 400, 'Write a note');
  db.prepare(`INSERT INTO staff_notes (target_type,target_id,user_id,text,at) VALUES (?,?,?,?,?)`).run(type, +req.params.id, req.user.id, text, now());
  Sec.audit(req, 'note_added', type, +req.params.id);
  res.json({ ok: true });
});

// public tracking page (shared link)
app.get('/api/track/:token', Sec.limit('track', 120, MIN), (req, res) => {
  const sh = db.prepare(`SELECT sh.*, u.name FROM shares sh JOIN users u ON u.id=sh.user_id WHERE sh.token=?`).get(clean(req.params.token, 60));
  if (!sh) return fail(res, 404, 'This link is not valid');
  if (!sh.active && sh.ended_at && now() - sh.ended_at > 24 * H) return fail(res, 410, 'This shared location has ended');
  const points = db.prepare(`SELECT lat,lng,at FROM track_points WHERE share_id=? ORDER BY at DESC LIMIT 300`).all(sh.id).reverse();
  let sos = null, journey = null;
  if (sh.kind === 'sos' && sh.sos_id) {
    const s = db.prepare(`SELECT * FROM sos WHERE id=?`).get(sh.sos_id);
    sos = { ref: s.ref, type: SOS_TYPES[s.type] || 'Emergency', status: s.status, duress: !!s.duress, created_at: s.created_at, events: db.prepare(`SELECT kind,text,at FROM sos_events WHERE sos_id=? AND public=1 ORDER BY at`).all(s.id) };
  }
  const j = db.prepare(`SELECT * FROM journeys WHERE share_id=?`).get(sh.id);
  if (j) journey = { dest_name: j.dest_name, expected_arrival: j.expected_arrival, status: j.status, off_route: !!j.off_route, events: db.prepare(`SELECT kind,text,at FROM journey_events WHERE journey_id=? ORDER BY at`).all(j.id) };
  res.json({ kind: sh.kind, name: first(sh.name), active: !!sh.active || !!(sos && sos.duress && sos.status !== 'closed'), dest_name: sh.dest_name,
    route: J(sh.route_json), last: sh.last_lat != null ? { lat: sh.last_lat, lng: sh.last_lng, at: sh.updated_at } : null, points, sos, journey, server_time: now() });
});

// ======================================================================
// Emergency facilities directory
// ======================================================================
const PLACE_CATS = ['police', 'frsc', 'military', 'nscdc', 'community', 'sema', 'fire', 'ambulance', 'hospital', 'clinic', 'mechanic', 'vulcaniser', 'fuel'];
const SECURITY_PLACE = ['police', 'frsc', 'military', 'nscdc', 'community'];
function placeFields(b, current) {
  const o = {};
  if (b.category !== undefined) { if (!PLACE_CATS.includes(b.category)) throw Object.assign(new Error('Unknown category'), { status: 400 }); o.category = b.category; }
  for (const [k, max] of [['name', 100], ['phone', 40], ['hours', 60], ['address', 160], ['notes', 300]]) if (b[k] !== undefined) o[k] = clean(b[k], max);
  if (b.lat !== undefined || b.lng !== undefined) { const p = coord(b.lat, b.lng); if (!p) throw Object.assign(new Error('Location needed'), { status: 400 }); o.lat = p[0]; o.lng = p[1]; }
  if (o.name === '' && !current) throw Object.assign(new Error('Name needed'), { status: 400 });
  return o;
}
app.post('/api/places', need(isModerator), (req, res) => {
  const f = placeFields(req.body);
  if (!f.name || !f.category || f.lat == null) return fail(res, 400, 'Name, category and location are required');
  const op = ['confirmed', 'unknown', 'closed'].includes(req.body.operational) ? req.body.operational : 'unknown';
  const verified = req.body.verified ? now() : (op === 'confirmed' ? now() : null);
  const info = db.prepare(`INSERT INTO places (category,name,lat,lng,phone,hours,address,notes,operational,last_confirmed_at,verified_by,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(f.category, f.name, f.lat, f.lng, f.phone || '', f.hours || '', f.address || '', f.notes || '', op, verified, verified ? req.user.id : null, req.user.id, now());
  geoSweep();
  Sec.audit(req, 'place_added', 'place', info.lastInsertRowid, f);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/places/:id', need(isModerator), (req, res) => {
  const pl = db.prepare(`SELECT * FROM places WHERE id=?`).get(+req.params.id); if (!pl) return fail(res, 404, 'Not found');
  const f = placeFields(req.body, pl); const k = Object.keys(f); if (!k.length) return res.json({ ok: true });
  db.prepare(`UPDATE places SET ${k.map(x => x + '=?').join(',')}${f.lat != null ? ', lga_id=NULL' : ''} WHERE id=?`).run(...k.map(x => f[x]), pl.id);
  geoSweep();
  Sec.audit(req, 'place_edited', 'place', pl.id, f);
  res.json({ ok: true });
});
// verify a listing: sets the verification date; for security posts also "operating now"
app.post('/api/places/:id/verify', need(isStaff), (req, res) => {
  const pl = db.prepare(`SELECT * FROM places WHERE id=?`).get(+req.params.id); if (!pl) return fail(res, 404, 'Not found');
  const op = ['confirmed', 'unknown', 'closed'].includes(req.body.operational) ? req.body.operational : (SECURITY_PLACE.includes(pl.category) ? 'confirmed' : pl.operational);
  db.prepare(`UPDATE places SET operational=?, last_confirmed_at=?, verified_by=? WHERE id=?`).run(op, op === 'closed' ? pl.last_confirmed_at : now(), req.user.id, pl.id);
  Sec.audit(req, 'place_verified', 'place', pl.id, { operational: op });
  res.json({ ok: true });
});
app.post('/api/places/:id/status', need(isStaff), (req, res) => {
  const op = ['confirmed', 'unknown', 'closed'].includes(req.body.operational) ? req.body.operational : null;
  if (!op) return fail(res, 400, 'Unknown status');
  db.prepare(`UPDATE places SET operational=?, last_confirmed_at=CASE WHEN ?='confirmed' THEN ? ELSE last_confirmed_at END, verified_by=? WHERE id=?`).run(op, op, now(), req.user.id, +req.params.id);
  Sec.audit(req, 'place_status', 'place', +req.params.id, { operational: op });
  res.json({ ok: true });
});
app.delete('/api/places/:id', need(isModerator), (req, res) => { db.prepare(`DELETE FROM places WHERE id=?`).run(+req.params.id); Sec.audit(req, 'place_deleted', 'place', +req.params.id); res.json({ ok: true }); });
// anyone signed in can suggest a new listing or a correction; moderators approve
app.post('/api/places/suggest', signedIn, Sec.limit('suggest', 20, 24 * H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const placeId = +req.body.place_id || null;
  if (placeId && !db.prepare(`SELECT 1 FROM places WHERE id=?`).get(placeId)) return fail(res, 404, 'Listing not found');
  const f = placeFields(req.body, placeId ? {} : null);
  if (!placeId && (!f.name || !f.category || f.lat == null)) return fail(res, 400, 'Name, category and location are required');
  if (req.body.closed) f.closed = true;
  if (req.body.message) f.message = clean(req.body.message, 300);
  db.prepare(`INSERT INTO place_suggestions (place_id,user_id,data,created_at) VALUES (?,?,?,?)`).run(placeId, req.user.id, JSON.stringify(f), now());
  res.json({ ok: true });
});
app.get('/api/places/suggestions', need(isModerator), (req, res) => {
  res.json(db.prepare(`SELECT s.*, u.name AS by_name, p.name AS place_name FROM place_suggestions s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN places p ON p.id=s.place_id WHERE s.status='pending' ORDER BY s.created_at LIMIT 100`).all()
    .map(s => ({ ...s, data: J(s.data) })));
});
app.post('/api/places/suggestions/:id', need(isModerator), (req, res) => {
  const s = db.prepare(`SELECT * FROM place_suggestions WHERE id=? AND status='pending'`).get(+req.params.id); if (!s) return fail(res, 404, 'Not found');
  const approve = req.body.action === 'approve', d = J(s.data) || {};
  if (approve) {
    const f = placeFields(d, s.place_id ? {} : null);
    if (s.place_id) {
      if (d.closed) f.operational = 'closed';
      const k = Object.keys(f);
      if (k.length) db.prepare(`UPDATE places SET ${k.map(x => x + '=?').join(',')}, last_confirmed_at=?, verified_by=? WHERE id=?`).run(...k.map(x => f[x]), now(), req.user.id, s.place_id);
    } else {
      db.prepare(`INSERT INTO places (category,name,lat,lng,phone,hours,address,notes,operational,last_confirmed_at,verified_by,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(f.category, f.name, f.lat, f.lng, f.phone || '', f.hours || '', f.address || '', f.notes || '', 'unknown', now(), req.user.id, s.user_id, now());
    }
  }
  geoSweep();
  db.prepare(`UPDATE place_suggestions SET status=?, decided_by=?, decided_at=? WHERE id=?`).run(approve ? 'approved' : 'rejected', req.user.id, now(), s.id);
  Sec.audit(req, approve ? 'place_suggestion_approved' : 'place_suggestion_rejected', 'place', s.place_id, d);
  res.json({ ok: true });
});

// ======================================================================
// Incident heatmap (aggregated; finer and unsuppressed for staff and fleet managers)
// ======================================================================
app.get('/api/heatmap', Sec.limit('heat', 30, MIN), (req, res) => {
  const T = typesObj();
  const staff = isStaff(req.user) || (req.user && db.prepare(`SELECT 1 FROM fleet_members WHERE user_id=? AND role='manager'`).get(req.user.id));
  const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 90;
  const tod = ['day', 'night', 'all'].includes(req.query.tod) ? req.query.tod : 'all';
  const sel = String(req.query.cat || 'security');
  const keys = sel === 'security' || sel === 'road' ? Object.values(T).filter(t => t.grp === sel).map(t => t.key) : T[sel] ? [sel] : Object.keys(T);
  const cell = staff ? 0.02 : 0.05, minN = staff ? 1 : setting('heatmap_min_count', 3), tz = setting('tz_offset_hours', 1);
  const rows = db.prepare(`SELECT lat, lng, COALESCE(occurred_at, created_at) AS t FROM reports WHERE type IN (${keys.map(() => '?').join(',')})
    AND (verified_by IS NOT NULL OR official=1) AND status IN ('verified','resolved') AND COALESCE(occurred_at, created_at) > ?`).all(...keys, now() - days * 24 * H);
  const grid = new Map(); let total = 0;
  for (const r of rows) {
    const h = (new Date(r.t).getUTCHours() + tz + 24) % 24, day = h >= 6 && h < 18;
    if ((tod === 'day' && !day) || (tod === 'night' && day)) continue;
    const k = Math.floor(r.lat / cell) + ':' + Math.floor(r.lng / cell);
    grid.set(k, (grid.get(k) || 0) + 1); total++;
  }
  const cells = []; let suppressed = 0;
  for (const [k, n] of grid) { if (n < minN) { suppressed += n; continue; } const [a, b] = k.split(':').map(Number); cells.push({ lat: a * cell, lng: b * cell, n }); }
  res.json({ cell, cells, max: Math.max(0, ...cells.map(c => c.n)), total, suppressed, detailed: !!staff, days, tod, cat: sel });
});

// ======================================================================
// Agencies (organisations), officers, supervisors
// ======================================================================
const ORG_TYPES = ['police', 'frsc', 'nscdc', 'military', 'sema', 'fire', 'ambulance', 'community', 'other'];
app.get('/api/orgs', (req, res) => res.json(db.prepare(`SELECT id,name,type,state,phone,verified,lat,lng,radius_km FROM organisations ${isAdmin(req.user) ? '' : 'WHERE verified=1'} ORDER BY name`).all()));
app.post('/api/orgs', need(isAdmin), (req, res) => {
  const name = clean(req.body.name, 100), type = ORG_TYPES.includes(req.body.type) ? req.body.type : null, p = coord(req.body.lat, req.body.lng);
  if (!name || !type) return fail(res, 400, 'Name and type are required');
  const info = db.prepare(`INSERT INTO organisations (name,type,state,lat,lng,radius_km,phone,verified,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(name, type, clean(req.body.state, 40), p ? p[0] : null, p ? p[1] : null, +req.body.radius_km || null, clean(req.body.phone, 40), req.body.verified === false ? 0 : 1, now());
  Sec.audit(req, 'org_created', 'org', info.lastInsertRowid, { name, type });
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/orgs/:id', need(isAdmin), (req, res) => {
  const o = db.prepare(`SELECT * FROM organisations WHERE id=?`).get(+req.params.id); if (!o) return fail(res, 404, 'Not found');
  const p = req.body.lat !== undefined ? coord(req.body.lat, req.body.lng) : [o.lat, o.lng];
  db.prepare(`UPDATE organisations SET name=?, type=?, state=?, lat=?, lng=?, radius_km=?, phone=?, verified=? WHERE id=?`).run(clean(req.body.name ?? o.name, 100), ORG_TYPES.includes(req.body.type) ? req.body.type : o.type,
    clean(req.body.state ?? o.state, 40), p ? p[0] : null, p ? p[1] : null, req.body.radius_km !== undefined ? +req.body.radius_km || null : o.radius_km, clean(req.body.phone ?? o.phone, 40), req.body.verified !== undefined ? (req.body.verified ? 1 : 0) : o.verified, o.id);
  Sec.audit(req, 'org_updated', 'org', o.id);
  res.json({ ok: true });
});
// supervisors verify officers who registered under their agency
const isSupervisor = u => isSecurity(u) && u.org_role === 'supervisor' && u.org_id;
app.get('/api/org/officers', need(u => isSupervisor(u) || isAdmin(u)), (req, res) => {
  const org = isAdmin(req.user) && +req.query.org ? +req.query.org : req.user.org_id;
  res.json(db.prepare(`SELECT id,name,email,phone,security_status,org_role,agency,created_at FROM users WHERE org_id=? ORDER BY (security_status='pending') DESC, name`).all(org));
});
app.post('/api/org/officers/:id', need(u => isSupervisor(u) || isAdmin(u)), (req, res) => {
  const o = db.prepare(`SELECT * FROM users WHERE id=?`).get(+req.params.id);
  if (!o || (!isAdmin(req.user) && o.org_id !== req.user.org_id)) return fail(res, 404, 'Officer not found in your agency');
  if (o.role === 'admin') return fail(res, 400, 'Not allowed');
  const a = req.body.action;
  if (a === 'verify') db.prepare(`UPDATE users SET role='security', security_status='verified' WHERE id=?`).run(o.id);
  else if (a === 'reject') db.prepare(`UPDATE users SET security_status='rejected', role=CASE WHEN role='security' THEN 'traveller' ELSE role END WHERE id=?`).run(o.id);
  else if (a === 'supervisor' || a === 'officer') db.prepare(`UPDATE users SET org_role=? WHERE id=?`).run(a, o.id);
  else return fail(res, 400, 'Unknown action');
  if (a === 'reject') db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(o.id);
  Sec.audit(req, 'officer_' + a, 'user', o.id, { org: o.org_id });
  res.json({ ok: true });
});

// ======================================================================
// Fleet safety
// ======================================================================
const fleetRole = (user, fleetId) => user ? (db.prepare(`SELECT role FROM fleet_members WHERE fleet_id=? AND user_id=?`).get(fleetId, user.id) || {}).role : null;
const needManager = (req, res, next) => fleetRole(req.user, +req.params.id) === 'manager' || isAdmin(req.user) ? next() : fail(res, 403, 'Fleet managers only');
function fleetAlert(fleetId, j, kind, text, p, push) {
  const info = db.prepare(`INSERT INTO fleet_alerts (fleet_id,journey_id,vehicle_id,driver_id,kind,text,lat,lng,at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(fleetId, j && j.id || null, j && j.vehicle_id || null, j && j.user_id || null, kind, text, p ? p[0] : null, p ? p[1] : null, now());
  if (push) db.prepare(`SELECT user_id FROM fleet_members WHERE fleet_id=? AND role='manager'`).all(fleetId)
    .forEach(m => Jobs.queue({ kind: 'fleet', ref_id: info.lastInsertRowid, channel: 'push', user_id: m.user_id, title: `🚚 Fleet alert`, body: text, url: '/?tab=fleet', tag: 'fleet-' + kind + '-' + (j && j.id) }));
  return info.lastInsertRowid;
}
const inviteCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();
app.get('/api/fleets/mine', signedIn, (req, res) => res.json(myFleets(req.user)));
app.post('/api/fleets', signedIn, Sec.limit('fleetcreate', 5, 24 * H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const name = clean(req.body.name, 80); if (!name) return fail(res, 400, 'Company name needed');
  const info = db.prepare(`INSERT INTO fleets (name,owner_id,invite_code,created_at) VALUES (?,?,?,?)`).run(name, req.user.id, inviteCode(), now());
  db.prepare(`INSERT INTO fleet_members (fleet_id,user_id,role,created_at) VALUES (?,?,?,?)`).run(info.lastInsertRowid, req.user.id, 'manager', now());
  Sec.audit(req, 'fleet_created', 'fleet', info.lastInsertRowid, { name });
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/fleets/join', signedIn, Sec.limit('fleetjoin', 10, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const f = db.prepare(`SELECT * FROM fleets WHERE invite_code=? AND active=1`).get(clean(req.body.code, 20).toUpperCase());
  if (!f) return fail(res, 404, 'That invite code is not valid');
  db.prepare(`INSERT OR IGNORE INTO fleet_members (fleet_id,user_id,role,created_at) VALUES (?,?,?,?)`).run(f.id, req.user.id, 'driver', now());
  fleetAlert(f.id, null, 'member_joined', `${req.user.name} joined as a driver`, null, false);
  res.json({ id: f.id, name: f.name });
});
app.get('/api/fleets/:id', signedIn, needManager, (req, res) => {
  const f = db.prepare(`SELECT * FROM fleets WHERE id=?`).get(+req.params.id); if (!f) return fail(res, 404, 'Not found');
  const trips = db.prepare(`SELECT j.*, u.name AS driver, u.phone AS driver_phone, v.plate FROM journeys j JOIN users u ON u.id=j.user_id LEFT JOIN vehicles v ON v.id=j.vehicle_id
    WHERE j.fleet_id=? AND j.status IN ('active','overdue','escalated') ORDER BY j.started_at DESC`).all(f.id);
  res.json({
    fleet: f, members: db.prepare(`SELECT m.user_id, m.role, u.name, u.phone, u.email FROM fleet_members m JOIN users u ON u.id=m.user_id WHERE m.fleet_id=? ORDER BY m.role, u.name`).all(f.id),
    vehicles: db.prepare(`SELECT v.*, u.name AS driver FROM vehicles v LEFT JOIN users u ON u.id=v.driver_id WHERE v.fleet_id=? ORDER BY v.plate`).all(f.id),
    trips: trips.map(j => ({ id: j.id, driver: j.driver, driver_phone: j.driver_phone, plate: j.plate, dest_name: j.dest_name, status: j.status, started_at: j.started_at, expected_arrival: j.expected_arrival,
      last: j.last_lat != null ? [j.last_lat, j.last_lng] : null, last_seen_at: j.last_seen_at, speed: j.last_speed, off_route: !!j.off_route,
      stopped_min: j.stopped_since ? Math.round((now() - j.stopped_since) / MIN) : 0, route: J(j.route_json), url: shareUrl(j.share_id) })),
    alerts: db.prepare(`SELECT a.*, u.name AS ack_name FROM fleet_alerts a LEFT JOIN users u ON u.id=a.ack_by WHERE a.fleet_id=? ORDER BY a.at DESC LIMIT 100`).all(f.id),
    recent: db.prepare(`SELECT j.id, u.name AS driver, v.plate, j.dest_name, j.status, j.started_at, j.ended_at, j.expected_arrival FROM journeys j JOIN users u ON u.id=j.user_id LEFT JOIN vehicles v ON v.id=j.vehicle_id
      WHERE j.fleet_id=? AND j.status IN ('arrived','ended') ORDER BY j.started_at DESC LIMIT 30`).all(f.id),
    sos: db.prepare(`SELECT id, ref, status, created_at FROM sos WHERE fleet_id=? AND (status!='closed' OR created_at>?) ORDER BY created_at DESC`).all(f.id, now() - 24 * H)
  });
});
app.put('/api/fleets/:id', signedIn, needManager, (req, res) => {
  const f = db.prepare(`SELECT * FROM fleets WHERE id=?`).get(+req.params.id);
  db.prepare(`UPDATE fleets SET name=?, deviation_km=?, stop_min=?, offline_min=? WHERE id=?`).run(clean(req.body.name ?? f.name, 80) || f.name,
    Math.max(0.5, Math.min(20, +req.body.deviation_km || f.deviation_km)), Math.max(5, Math.min(240, +req.body.stop_min || f.stop_min)), Math.max(5, Math.min(240, +req.body.offline_min || f.offline_min)), f.id);
  res.json({ ok: true });
});
app.post('/api/fleets/:id/invite', signedIn, needManager, (req, res) => { const c = inviteCode(); db.prepare(`UPDATE fleets SET invite_code=? WHERE id=?`).run(c, +req.params.id); res.json({ invite_code: c }); });
app.post('/api/fleets/:id/vehicles', signedIn, needManager, (req, res) => {
  const plate = clean(req.body.plate, 20).toUpperCase(); if (!plate) return fail(res, 400, 'Plate number needed');
  const driver = +req.body.driver_id && db.prepare(`SELECT user_id FROM fleet_members WHERE fleet_id=? AND user_id=?`).get(+req.params.id, +req.body.driver_id);
  db.prepare(`INSERT INTO vehicles (fleet_id,plate,label,driver_id,created_at) VALUES (?,?,?,?,?)`).run(+req.params.id, plate, clean(req.body.label, 60), driver ? driver.user_id : null, now());
  res.json({ ok: true });
});
app.put('/api/fleets/:id/vehicles/:vid', signedIn, needManager, (req, res) => {
  const driver = +req.body.driver_id && db.prepare(`SELECT user_id FROM fleet_members WHERE fleet_id=? AND user_id=?`).get(+req.params.id, +req.body.driver_id);
  db.prepare(`UPDATE vehicles SET driver_id=? WHERE id=? AND fleet_id=?`).run(driver ? driver.user_id : null, +req.params.vid, +req.params.id);
  res.json({ ok: true });
});
app.delete('/api/fleets/:id/vehicles/:vid', signedIn, needManager, (req, res) => { db.prepare(`DELETE FROM vehicles WHERE id=? AND fleet_id=?`).run(+req.params.vid, +req.params.id); res.json({ ok: true }); });
app.post('/api/fleets/:id/members/:uid', signedIn, needManager, (req, res) => {
  const f = db.prepare(`SELECT * FROM fleets WHERE id=?`).get(+req.params.id), uid = +req.params.uid;
  if (uid === f.owner_id) return fail(res, 400, 'The owner cannot be changed');
  if (req.body.action === 'remove') db.prepare(`DELETE FROM fleet_members WHERE fleet_id=? AND user_id=?`).run(f.id, uid);
  else if (['manager', 'driver'].includes(req.body.action)) db.prepare(`UPDATE fleet_members SET role=? WHERE fleet_id=? AND user_id=?`).run(req.body.action, f.id, uid);
  Sec.audit(req, 'fleet_member_' + req.body.action, 'fleet', f.id, { user: uid });
  res.json({ ok: true });
});
app.post('/api/fleets/:id/alerts/:aid/ack', signedIn, needManager, (req, res) => {
  db.prepare(`UPDATE fleet_alerts SET ack_by=?, ack_at=? WHERE id=? AND fleet_id=?`).run(req.user.id, now(), +req.params.aid, +req.params.id); res.json({ ok: true });
});
app.post('/api/fleets/:id/leave', signedIn, (req, res) => {
  const f = db.prepare(`SELECT * FROM fleets WHERE id=?`).get(+req.params.id);
  if (f && f.owner_id === req.user.id) return fail(res, 400, 'The owner cannot leave their own fleet');
  db.prepare(`DELETE FROM fleet_members WHERE fleet_id=? AND user_id=?`).run(+req.params.id, req.user.id); res.json({ ok: true });
});

// ======================================================================
// Zones, categories, settings, users, audit (admin)
// ======================================================================
app.post('/api/zones', need(isAdmin), (req, res) => {
  const p = coord(req.body.lat, req.body.lng), type = req.body.type, name = clean(req.body.name, 80), r = +req.body.radius_km;
  if (!p || !['urban', 'peri', 'rural', 'forest'].includes(type) || !name || !(r > 0 && r <= 50)) return fail(res, 400, 'Name, area type, centre and a radius of 0–50 km are required');
  const info = db.prepare(`INSERT INTO zones (name,type,lat,lng,radius_km) VALUES (?,?,?,?,?)`).run(name, type, p[0], p[1], r);
  Sec.audit(req, 'zone_added', 'zone', info.lastInsertRowid, { name, type, r });
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/zones/:id', need(isAdmin), (req, res) => { db.prepare(`DELETE FROM zones WHERE id=?`).run(+req.params.id); Sec.audit(req, 'zone_deleted', 'zone', +req.params.id); res.json({ ok: true }); });
app.put('/api/types/:key', need(isAdmin), (req, res) => {
  const t = db.prepare(`SELECT * FROM report_types WHERE key=?`).get(req.params.key);
  if (!t) return fail(res, 404, 'Unknown category');
  const w = +req.body.weight, r = +req.body.radius_km, ttl = +req.body.ttl_hours, hl = req.body.half_life_h !== undefined ? +req.body.half_life_h : t.half_life_h;
  if (!(w >= 0 && w <= 100 && r > 0 && r <= 20 && ttl > 0 && hl > 0)) return fail(res, 400, 'Check the numbers');
  db.prepare(`UPDATE report_types SET weight=?, radius_km=?, ttl_hours=?, half_life_h=? WHERE key=?`).run(w, r, ttl, hl, t.key);
  Sec.audit(req, 'category_changed', 'type', null, { key: t.key, w, r, ttl, hl });
  res.json({ ok: true });
});
app.put('/api/settings', need(isAdmin), (req, res) => {
  const up = db.prepare(`UPDATE settings SET value=? WHERE key=?`);
  for (const [k, v] of Object.entries(req.body || {})) up.run(clean(v, k === 'notice_text' ? 300 : 40), k);
  Sec.audit(req, 'settings_changed', 'settings', null, req.body);
  res.json({ settings: settingsObj() });
});
app.get('/api/admin/users', need(isAdmin), (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.security_status,u.agency,u.banned,u.trust,u.trusted,u.totp_enabled,u.org_id,u.org_role,u.created_at,o.name AS org_name
    FROM users u LEFT JOIN organisations o ON o.id=u.org_id ORDER BY (u.security_status='pending') DESC, u.created_at DESC LIMIT 500`).all());
});
app.post('/api/admin/users/:id', need(isAdmin), (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(+req.params.id);
  if (!u) return fail(res, 404, 'User not found');
  const role = ['traveller', 'security', 'moderator', 'admin'].includes(req.body.role) ? req.body.role : u.role;
  let sec = u.security_status;
  if (req.body.security_status !== undefined) sec = ['verified', 'rejected', 'pending', null].includes(req.body.security_status) ? req.body.security_status : sec;
  if (role === 'security' && sec !== 'verified' && req.body.security_status === undefined) sec = 'verified';
  const banned = req.body.banned !== undefined ? (req.body.banned ? 1 : 0) : u.banned;
  const trusted = req.body.trusted !== undefined ? (req.body.trusted ? 1 : 0) : u.trusted;
  const trust = req.body.trusted !== undefined ? (trusted ? Math.max(u.trust, 0.8) : Math.min(u.trust, 0.6)) : u.trust;
  const orgId = req.body.org_id !== undefined ? (+req.body.org_id || null) : u.org_id;
  const orgRole = req.body.org_role !== undefined ? (['officer', 'supervisor'].includes(req.body.org_role) ? req.body.org_role : null) : u.org_role;
  if (u.id === req.user.id && (role !== 'admin' || banned)) return fail(res, 400, 'You cannot remove your own admin access');
  db.prepare(`UPDATE users SET role=?, security_status=?, banned=?, trusted=?, trust=?, org_id=?, org_role=? WHERE id=?`).run(role, sec, banned, trusted, trust, orgId, orgRole, u.id);
  if (banned || role !== u.role) db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(u.id);
  if (req.body.reset_mfa) { db.prepare(`UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=?`).run(u.id); db.prepare(`DELETE FROM mfa_backup WHERE user_id=?`).run(u.id); }
  Sec.audit(req, 'user_updated', 'user', u.id, { role, sec, banned, trusted, orgId, orgRole, reset_mfa: !!req.body.reset_mfa });
  res.json({ ok: true });
});
app.get('/api/admin/stats', need(isModerator), (req, res) => {
  const q = s => db.prepare(s).get().n;
  res.json({
    users: q(`SELECT COUNT(*) n FROM users`), unverified: q(`SELECT COUNT(*) n FROM reports WHERE status='unverified'`), investigating: q(`SELECT COUNT(*) n FROM reports WHERE status='investigating'`),
    verified: q(`SELECT COUNT(*) n FROM reports WHERE status='verified'`), places: q(`SELECT COUNT(*) n FROM places`), security_requests: q(`SELECT COUNT(*) n FROM users WHERE security_status='pending'`),
    open_sos: q(`SELECT COUNT(*) n FROM sos WHERE status!='closed'`), push_devices: q(`SELECT COUNT(*) n FROM push_subs`), active_journeys: q(`SELECT COUNT(*) n FROM journeys WHERE status IN ('active','overdue','escalated')`),
    fleets: q(`SELECT COUNT(*) n FROM fleets`), suggestions: q(`SELECT COUNT(*) n FROM place_suggestions WHERE status='pending'`), staff_without_mfa: q(`SELECT COUNT(*) n FROM users WHERE totp_enabled=0 AND (role IN ('admin','moderator') OR (role='security' AND security_status='verified'))`),
    failed_notifications_24h: q(`SELECT COUNT(*) n FROM notif_jobs WHERE status='failed' AND created_at>${now() - 24 * H} AND error NOT LIKE 'no device%'`),
    sms_enabled: notify.smsEnabled(), voice_enabled: notify.voiceEnabled()
  });
});
app.get('/api/admin/audit', need(isAdmin), (req, res) => {
  const action = clean(req.query.action, 40);
  res.json(db.prepare(`SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ${action ? 'WHERE a.action LIKE ?' : ''} ORDER BY a.at DESC LIMIT 300`).all(...(action ? ['%' + action + '%'] : [])));
});

// ======================================================================
// Geography and personal data rights
// ======================================================================
app.get('/api/geo/locate', Sec.limit('geoloc', 120, MIN), (req, res) => { const p = coord(req.query.lat, req.query.lng); res.json(p ? Geo.locate(p[0], p[1]) : null); });
app.get('/api/geo/states', (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.json(Geo.statesGeo()); });
app.get('/api/geo/lgas', (req, res) => { const st = clean(req.query.state, 40); if (!Geo.STATES.includes(st)) return fail(res, 400, 'Unknown state'); res.setHeader('Cache-Control', 'public, max-age=86400'); res.json(Geo.lgasGeo(st)); });
// download everything SafeRoute holds about you (Nigeria Data Protection Act: right of access / portability)
app.get('/api/me/export', signedIn, Sec.limit('export', 5, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  const id = req.user.id, q = (sql) => db.prepare(sql).all(id);
  const me = db.prepare(`SELECT id,name,email,phone,role,security_status,agency,org_id,org_role,created_at,alert_prefs,last_lat,last_lng,last_loc_at FROM users WHERE id=?`).get(id);
  res.setHeader('Content-Disposition', `attachment; filename="saferoute-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exported_at: new Date().toISOString(), profile: me, safe_circle: q(`SELECT name,phone,email,relation,created_at FROM circle_contacts WHERE user_id=?`),
    alert_places: q(`SELECT name,lat,lng,radius_km FROM alert_areas WHERE user_id=?`), reports: q(`SELECT id,type,lat,lng,note,status,created_at FROM reports WHERE user_id=?`),
    confirmations: q(`SELECT report_id,kind,created_at FROM confirmations WHERE user_id=?`), journeys: q(`SELECT id,origin_name,dest_name,status,started_at,ended_at,expected_arrival FROM journeys WHERE user_id=?`),
    sos: q(`SELECT ref,type,status,lat,lng,created_at FROM sos WHERE user_id=?`), shared_locations: db.prepare(`SELECT s.kind, s.created_at, s.ended_at, COUNT(t.at) AS points FROM shares s LEFT JOIN track_points t ON t.share_id=s.id WHERE s.user_id=? GROUP BY s.id`).all(id),
    alerts: q(`SELECT title,body,created_at FROM user_alerts WHERE user_id=?`), fleets: q(`SELECT fleet_id, role FROM fleet_members WHERE user_id=?`) });
});
// delete my account: personal data is erased; incident reports stay (without your name) because others rely on them
app.post('/api/me/delete', signedIn, Sec.limit('delacct', 5, H, r => 'u' + (r.user && r.user.id)), (req, res) => {
  if (!bcrypt.compareSync(String(req.body.password || ''), req.user.password_hash)) return fail(res, 403, 'Your password is not correct');
  if (req.user._real_role === 'admin' || req.user.role === 'admin') { if (db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`).get().n <= 1) return fail(res, 400, 'You are the only admin. Make someone else admin first.'); }
  const id = req.user.id;
  db.transaction(() => {
    for (const f of db.prepare(`SELECT id FROM fleets WHERE owner_id=?`).all(id)) db.prepare(`DELETE FROM fleets WHERE id=?`).run(f.id);
    db.prepare(`DELETE FROM track_points WHERE share_id IN (SELECT id FROM shares WHERE user_id=?)`).run(id);
    db.prepare(`UPDATE sos SET note=NULL WHERE user_id=?`).run(id);
    db.prepare(`UPDATE reports SET user_id=NULL WHERE user_id=?`).run(id);
    db.prepare(`DELETE FROM users WHERE id=?`).run(id);
  })();
  Sec.audit({ ip: req.ip, user: null }, 'account_deleted', 'user', id);
  res.clearCookie('sr_session');
  res.json({ ok: true });
});

// ---------- command dashboard (separate module) ----------
require('./routes/dash')(app, { db, Sec, Risk, Geo, Jobs, need, fail, clean, coord, setting, settingsObj, typesObj, enrich, isPublic, activeReports, isStaff, isAdmin, isModerator, isSecurity, REPORT_COLS, REPORT_FROM, H, MIN, now, geoSweep });

// ---------- static files ----------
app.get('/js/risk.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'risk.js')));
app.get('/sw.js', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.get('/t/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));
app.use('/api', (req, res) => fail(res, 404, 'Not found'));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (25 MB maximum)' : err.message);
  if (err.status && err.status < 500) return fail(res, err.status, err.message);
  console.error(err); fail(res, 500, 'Server error');
});

setInterval(() => {
  db.prepare(`DELETE FROM sessions WHERE expires_at<?`).run(now());
  db.prepare(`DELETE FROM track_points WHERE at<?`).run(now() - 30 * 24 * H);
  db.prepare(`UPDATE shares SET active=0, ended_at=? WHERE kind='trip' AND active=1 AND updated_at<? AND id NOT IN (SELECT share_id FROM journeys WHERE status IN ('active','overdue','escalated') AND share_id IS NOT NULL)`).run(now(), now() - 12 * H);
  db.prepare(`DELETE FROM audit_log WHERE at<?`).run(now() - 730 * 24 * H);
}, H).unref();
setInterval(() => { for (const [t, v] of mfaTickets) if (v.exp < now()) mfaTickets.delete(t); }, 5 * MIN).unref();

geoSweep();
setInterval(() => { try { geoSweep(); localitySweep().catch(() => {}); } catch (e) { console.error('geo', e.message); } }, MIN).unref();
app.listen(PORT, () => console.log(`[saferoute] v4 running on http://localhost:${PORT}${notify.smsEnabled() ? ' · SMS on' : ' · SMS off'}${notify.voiceEnabled() ? ' · calls on' : ''}${REQUIRE_STAFF_MFA ? ' · staff 2-step required' : ''}`));
