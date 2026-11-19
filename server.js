// SafeRoute Naija — Express server with built-in SQLite database.
// Run: node server.js   (PORT defaults to 3060)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');

require('./env');
const { db, DATA_DIR } = require('./db');
const Risk = require('./shared/risk');

const app = express();
const PORT = +process.env.PORT || 3060;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const SESSION_DAYS = 30;
const now = () => Date.now();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});

// ---------- auth helpers ----------
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, security_status: u.security_status, agency: u.agency };
}
function newSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)`).run(token, userId, now() + SESSION_DAYS * 864e5);
  res.cookie('sr_session', token, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIE, maxAge: SESSION_DAYS * 864e5 });
}
app.use((req, res, next) => {
  const t = req.cookies.sr_session;
  if (t) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).get(t, now());
    if (row && !row.banned) req.user = row;
  }
  next();
});
const isRole = (u, ...roles) => u && roles.includes(u.role);
const isSecurity = u => u && ((u.role === 'security' && u.security_status === 'verified') || u.role === 'admin');
const isModerator = u => isRole(u, 'moderator', 'admin');
function need(check, msg) {
  return (req, res, next) => (check(req.user) ? next() : res.status(req.user ? 403 : 401).json({ error: msg || (req.user ? 'Not allowed' : 'Please sign in') }));
}
const signedIn = need(u => !!u);
const fail = (res, code, error) => res.status(code).json({ error });
const clean = (s, max) => String(s || '').trim().slice(0, max || 500);
const coord = (lat, lng) => {
  lat = +lat; lng = +lng;
  return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
};

// ---------- data helpers ----------
function settingsObj() {
  const o = {};
  for (const r of db.prepare(`SELECT key,value FROM settings`).all()) o[r.key] = r.value;
  return o;
}
function typesObj() {
  const o = {};
  for (const t of db.prepare(`SELECT * FROM report_types ORDER BY sort`).all()) o[t.key] = t;
  return o;
}
function expireOld() {
  db.prepare(`UPDATE reports SET status='expired' WHERE status='approved' AND expires_at IS NOT NULL AND expires_at < ?`).run(now());
}
const REPORT_COLS = `r.id,r.type,r.lat,r.lng,r.note,r.photo,r.status,r.official,r.created_at,r.expires_at,r.responding_by,
  (SELECT COUNT(*) FROM votes v WHERE v.report_id=r.id AND v.vote='still') AS still,
  (SELECT COUNT(*) FROM votes v WHERE v.report_id=r.id AND v.vote='cleared') AS cleared,
  COALESCE(u.name,'Anonymous') AS by_name`;
function reportsFor(user) {
  expireOld();
  const staff = isModerator(user) || isSecurity(user);
  const rows = db.prepare(`SELECT ${REPORT_COLS} FROM reports r LEFT JOIN users u ON u.id=r.user_id
    WHERE r.status='approved' ${staff ? `OR r.status='pending'` : user ? `OR (r.status='pending' AND r.user_id=${+user.id})` : ''}
    ORDER BY r.created_at DESC LIMIT 2000`).all();
  // reporters' names are only shown to staff
  if (!staff) rows.forEach(r => { r.by_name = r.official ? 'Security (verified)' : 'Community report'; });
  return rows;
}

// ---------- auth routes ----------
app.post('/api/auth/register', (req, res) => {
  const name = clean(req.body.name, 80), email = clean(req.body.email, 120).toLowerCase(), phone = clean(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, 'Enter your name and a valid email');
  if (password.length < 6) return fail(res, 400, 'Password must be at least 6 characters');
  if (db.prepare(`SELECT 1 FROM users WHERE email=?`).get(email)) return fail(res, 409, 'That email is already registered');
  const wantsSecurity = !!req.body.security;
  const info = db.prepare(`INSERT INTO users (name,email,phone,password_hash,role,security_status,agency,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, email, phone, bcrypt.hashSync(password, 10), 'traveller', wantsSecurity ? 'pending' : null, wantsSecurity ? clean(req.body.agency, 60) : null, now());
  newSession(res, info.lastInsertRowid);
  res.json({ user: publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(info.lastInsertRowid)) });
});
app.post('/api/auth/login', (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE email=?`).get(clean(req.body.email, 120).toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) return fail(res, 401, 'Wrong email or password');
  if (u.banned) return fail(res, 403, 'This account has been suspended');
  newSession(res, u.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', (req, res) => {
  if (req.cookies.sr_session) db.prepare(`DELETE FROM sessions WHERE token=?`).run(req.cookies.sr_session);
  res.clearCookie('sr_session');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- everything the map needs in one call ----------
app.get('/api/bootstrap', (req, res) => {
  res.json({
    user: publicUser(req.user),
    types: typesObj(),
    settings: settingsObj(),
    places: db.prepare(`SELECT id,category,name,lat,lng,phone FROM places`).all(),
    zones: db.prepare(`SELECT * FROM zones`).all(),
    reports: reportsFor(req.user),
    server_time: now()
  });
});

// risk at a point (handy for a WhatsApp bot or partner API later)
app.get('/api/risk', (req, res) => {
  const p = coord(req.query.lat, req.query.lng);
  if (!p) return fail(res, 400, 'lat and lng are required');
  expireOld();
  const hour = req.query.hour !== undefined ? +req.query.hour : new Date().getHours() + new Date().getMinutes() / 60;
  const data = { types: typesObj(), settings: settingsObj(), places: db.prepare(`SELECT * FROM places`).all(), zones: db.prepare(`SELECT * FROM zones`).all(), reports: db.prepare(`SELECT * FROM reports WHERE status='approved'`).all() };
  const k = Risk.compute(p, hour, data, { tourist: req.query.tourist === '1' });
  res.json({ score: k.R, level: Risk.LEVELS[k.level].name, hazards: k.H, security: k.P, settlement: k.S, time: k.T, zone: k.zone.name,
    nearest_security: k.post ? { name: k.post.place.name, km: +k.post.d.toFixed(2) } : null });
});

// ---------- reports ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + (path.extname(file.originalname).toLowerCase().match(/^\.(jpe?g|png|webp)$/) ? path.extname(file.originalname).toLowerCase() : '.jpg'))
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

app.post('/api/reports', signedIn, upload.single('photo'), (req, res) => {
  const types = typesObj();
  const type = clean(req.body.type, 20);
  const p = coord(req.body.lat, req.body.lng);
  if (!types[type] || !p) return fail(res, 400, 'Choose a report type and location');
  const official = isSecurity(req.user);
  if (type === 'advisory' && !official) return fail(res, 403, 'Only verified security accounts can post advisories');
  const limit = +settingsObj().reports_per_hour || 10;
  const recent = db.prepare(`SELECT COUNT(*) n FROM reports WHERE user_id=? AND created_at>?`).get(req.user.id, now() - 36e5).n;
  if (!official && recent >= limit) return fail(res, 429, 'You have sent many reports in the last hour. Please wait a little.');
  const t = now();
  const status = official ? 'approved' : 'pending';
  const info = db.prepare(`INSERT INTO reports (user_id,type,lat,lng,note,photo,status,official,moderated_by,moderated_at,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, type, p[0], p[1], clean(req.body.note, 400), req.file ? req.file.filename : null, status, official ? 1 : 0,
      official ? req.user.id : null, official ? t : null, t, official ? t + types[type].ttl_hours * 36e5 : null);
  res.json({ id: info.lastInsertRowid, status });
});

app.post('/api/reports/:id/vote', signedIn, (req, res) => {
  const vote = req.body.vote === 'cleared' ? 'cleared' : 'still';
  const r = db.prepare(`SELECT * FROM reports WHERE id=? AND status='approved'`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found');
  db.prepare(`INSERT INTO votes (report_id,user_id,vote,created_at) VALUES (?,?,?,?) ON CONFLICT(report_id,user_id) DO UPDATE SET vote=excluded.vote, created_at=excluded.created_at`)
    .run(r.id, req.user.id, vote, now());
  const c = db.prepare(`SELECT SUM(vote='still') still, SUM(vote='cleared') cleared FROM votes WHERE report_id=?`).get(r.id);
  // community clearing: at least 3 "cleared" votes outnumbering "still there"
  if (!r.official && c.cleared >= 3 && c.cleared > c.still) db.prepare(`UPDATE reports SET status='cleared' WHERE id=?`).run(r.id);
  // "still there" votes extend the life of short-lived reports
  if (vote === 'still' && r.expires_at) {
    const ttl = typesObj()[r.type].ttl_hours * 36e5;
    db.prepare(`UPDATE reports SET expires_at=MAX(expires_at, ?) WHERE id=?`).run(Math.min(now() + ttl, r.expires_at + ttl / 2), r.id);
  }
  res.json({ still: c.still || 0, cleared: c.cleared || 0 });
});

app.post('/api/reports/:id/moderate', need(isModerator), (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id=?`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found');
  const types = typesObj();
  const type = types[req.body.type] ? req.body.type : r.type;
  const action = req.body.action;
  const t = now();
  if (action === 'approve') {
    db.prepare(`UPDATE reports SET status='approved', type=?, moderated_by=?, moderated_at=?, expires_at=? WHERE id=?`)
      .run(type, req.user.id, t, t + types[type].ttl_hours * 36e5, r.id);
  } else if (action === 'reject') {
    db.prepare(`UPDATE reports SET status='rejected', moderated_by=?, moderated_at=? WHERE id=?`).run(req.user.id, t, r.id);
  } else if (action === 'expire') {
    db.prepare(`UPDATE reports SET status='expired', moderated_by=?, moderated_at=? WHERE id=?`).run(req.user.id, t, r.id);
  } else if (action === 'retype') {
    db.prepare(`UPDATE reports SET type=? WHERE id=?`).run(type, r.id);
  } else return fail(res, 400, 'Unknown action');
  res.json({ ok: true });
});

app.post('/api/reports/:id/respond', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  db.prepare(`UPDATE reports SET responding_by=? WHERE id=? AND status='approved'`).run(req.body.responding ? req.user.id : null, +req.params.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/clear', need(u => isSecurity(u) || isModerator(u)), (req, res) => {
  db.prepare(`UPDATE reports SET status='cleared', responding_by=NULL, moderated_by=?, moderated_at=? WHERE id=?`).run(req.user.id, now(), +req.params.id);
  res.json({ ok: true });
});
app.post('/api/reports/:id/confirm', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  const r = db.prepare(`SELECT * FROM reports WHERE id=?`).get(+req.params.id);
  if (!r) return fail(res, 404, 'Report not found');
  const t = now();
  db.prepare(`UPDATE reports SET status='approved', official=1, moderated_by=?, moderated_at=?, expires_at=? WHERE id=?`)
    .run(req.user.id, t, t + typesObj()[r.type].ttl_hours * 36e5, r.id);
  res.json({ ok: true });
});

// ---------- SOS ----------
app.post('/api/sos', signedIn, (req, res) => {
  const p = coord(req.body.lat, req.body.lng);
  if (!p) return fail(res, 400, 'Location needed');
  const open = db.prepare(`SELECT id FROM sos WHERE user_id=? AND status!='closed'`).get(req.user.id);
  if (open) {
    db.prepare(`UPDATE sos SET lat=?, lng=?, updated_at=? WHERE id=?`).run(p[0], p[1], now(), open.id); // live location update
    return res.json({ id: open.id });
  }
  const info = db.prepare(`INSERT INTO sos (user_id,lat,lng,note,created_at,updated_at) VALUES (?,?,?,?,?,?)`).run(req.user.id, p[0], p[1], clean(req.body.note, 200), now(), now());
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/sos/cancel', signedIn, (req, res) => {
  db.prepare(`UPDATE sos SET status='closed', updated_at=? WHERE user_id=? AND status!='closed'`).run(now(), req.user.id);
  res.json({ ok: true });
});
app.get('/api/sos', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  res.json(db.prepare(`SELECT s.*, u.name, u.phone FROM sos s LEFT JOIN users u ON u.id=s.user_id WHERE s.status!='closed' OR s.updated_at>? ORDER BY s.created_at DESC LIMIT 100`).all(now() - 864e5));
});
app.post('/api/sos/:id', need(isSecurity, 'Verified security accounts only'), (req, res) => {
  const status = ['responding', 'closed'].includes(req.body.status) ? req.body.status : 'responding';
  db.prepare(`UPDATE sos SET status=?, responder_id=?, updated_at=? WHERE id=?`).run(status, req.user.id, now(), +req.params.id);
  res.json({ ok: true });
});

// ---------- places, zones, settings (staff) ----------
const PLACE_CATS = ['police', 'frsc', 'military', 'nscdc', 'hospital', 'clinic', 'mechanic', 'fuel', 'vulcaniser'];
app.post('/api/places', need(isModerator), (req, res) => {
  const p = coord(req.body.lat, req.body.lng), cat = req.body.category, name = clean(req.body.name, 100);
  if (!p || !PLACE_CATS.includes(cat) || !name) return fail(res, 400, 'Name, category and location are required');
  const info = db.prepare(`INSERT INTO places (category,name,lat,lng,phone,created_by,created_at) VALUES (?,?,?,?,?,?,?)`).run(cat, name, p[0], p[1], clean(req.body.phone, 30), req.user.id, now());
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/places/:id', need(isModerator), (req, res) => { db.prepare(`DELETE FROM places WHERE id=?`).run(+req.params.id); res.json({ ok: true }); });

app.post('/api/zones', need(u => isRole(u, 'admin')), (req, res) => {
  const p = coord(req.body.lat, req.body.lng), type = req.body.type, name = clean(req.body.name, 80), r = +req.body.radius_km;
  if (!p || !['urban', 'peri', 'rural', 'forest'].includes(type) || !name || !(r > 0 && r <= 50)) return fail(res, 400, 'Name, settlement type, centre and a radius of 0–50 km are required');
  const info = db.prepare(`INSERT INTO zones (name,type,lat,lng,radius_km) VALUES (?,?,?,?,?)`).run(name, type, p[0], p[1], r);
  res.json({ id: info.lastInsertRowid });
});
app.delete('/api/zones/:id', need(u => isRole(u, 'admin')), (req, res) => { db.prepare(`DELETE FROM zones WHERE id=?`).run(+req.params.id); res.json({ ok: true }); });

app.put('/api/types/:key', need(u => isRole(u, 'admin')), (req, res) => {
  const t = db.prepare(`SELECT * FROM report_types WHERE key=?`).get(req.params.key);
  if (!t) return fail(res, 404, 'Unknown type');
  const w = +req.body.weight, r = +req.body.radius_km, ttl = +req.body.ttl_hours;
  if (!(w >= 0 && w <= 100 && r > 0 && r <= 20 && ttl > 0)) return fail(res, 400, 'Check the numbers');
  db.prepare(`UPDATE report_types SET weight=?, radius_km=?, ttl_hours=? WHERE key=?`).run(w, r, ttl, t.key);
  res.json({ ok: true });
});
app.put('/api/settings', need(u => isRole(u, 'admin')), (req, res) => {
  const up = db.prepare(`UPDATE settings SET value=? WHERE key=?`);
  for (const [k, v] of Object.entries(req.body || {})) up.run(clean(v, 40), k);
  res.json({ settings: settingsObj() });
});

// ---------- users (admin) ----------
app.get('/api/admin/users', need(u => isRole(u, 'admin')), (req, res) => {
  res.json(db.prepare(`SELECT id,name,email,phone,role,security_status,agency,banned,created_at FROM users ORDER BY (security_status='pending') DESC, created_at DESC LIMIT 500`).all());
});
app.post('/api/admin/users/:id', need(u => isRole(u, 'admin')), (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(+req.params.id);
  if (!u) return fail(res, 404, 'User not found');
  const role = ['traveller', 'security', 'moderator', 'admin'].includes(req.body.role) ? req.body.role : u.role;
  let sec = u.security_status;
  if (req.body.security_status !== undefined) sec = ['verified', 'rejected', 'pending', null].includes(req.body.security_status) ? req.body.security_status : sec;
  if (role === 'security' && sec !== 'verified' && req.body.security_status === undefined) sec = 'verified';
  const banned = req.body.banned !== undefined ? (req.body.banned ? 1 : 0) : u.banned;
  if (u.id === req.user.id && (role !== 'admin' || banned)) return fail(res, 400, 'You cannot remove your own admin access');
  db.prepare(`UPDATE users SET role=?, security_status=?, banned=? WHERE id=?`).run(role, sec, banned, u.id);
  if (banned) db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(u.id);
  res.json({ ok: true });
});
app.get('/api/admin/stats', need(isModerator), (req, res) => {
  const q = s => db.prepare(s).get().n;
  res.json({
    users: q(`SELECT COUNT(*) n FROM users`), pending: q(`SELECT COUNT(*) n FROM reports WHERE status='pending'`),
    live: q(`SELECT COUNT(*) n FROM reports WHERE status='approved'`), places: q(`SELECT COUNT(*) n FROM places`),
    security_requests: q(`SELECT COUNT(*) n FROM users WHERE security_status='pending'`)
  });
});

// ---------- static files ----------
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d' }));
app.get('/js/risk.js', (req, res) => res.sendFile(path.join(__dirname, 'shared', 'risk.js')));
app.get('/sw.js', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'sw.js')); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/api', (req, res) => fail(res, 404, 'Not found'));
app.use((err, req, res, next) => { console.error(err); fail(res, err.status || 500, err.message && err.status ? err.message : 'Server error'); });

// tidy expired sessions daily
setInterval(() => db.prepare(`DELETE FROM sessions WHERE expires_at<?`).run(now()), 864e5).unref();

app.listen(PORT, () => console.log(`[saferoute] running on http://localhost:${PORT}`));
