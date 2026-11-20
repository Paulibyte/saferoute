// SQLite database: one file at data/saferoute.db (set DATA_DIR to move it). Back up the data/ folder to back up everything.
// Safe to run on an existing v1 database: missing columns and tables are added and old values converted.
require('./env');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'saferoute.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------- base tables (v1) ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'traveller', security_status TEXT, agency TEXT,
  banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS report_types (key TEXT PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
  weight REAL NOT NULL, radius_km REAL NOT NULL, ttl_hours REAL NOT NULL, advice TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, type TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, note TEXT, photo TEXT, status TEXT NOT NULL DEFAULT 'unverified', official INTEGER NOT NULL DEFAULT 0,
  moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL, moderated_at INTEGER, responding_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(lat, lng);
CREATE TABLE IF NOT EXISTS places (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  phone TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS zones (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, radius_km REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  note TEXT, status TEXT NOT NULL DEFAULT 'open', responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
`);

// ---------------- v2 tables ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS confirmations (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- confirm | ongoing | resolved | inaccurate
  lat REAL, lng REAL, distance_km REAL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, user_id));
CREATE TABLE IF NOT EXISTS circle_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT, email TEXT, relation TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- trip | sos
  sos_id INTEGER, dest_name TEXT, route_json TEXT, active INTEGER NOT NULL DEFAULT 1,
  last_lat REAL, last_lng REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS track_points (share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE, lat REAL NOT NULL, lng REAL NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_track ON track_points(share_id, at);
CREATE TABLE IF NOT EXISTS sos_events (id INTEGER PRIMARY KEY AUTOINCREMENT, sos_id INTEGER NOT NULL REFERENCES sos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, text TEXT NOT NULL, public INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE, keys_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

function cols(table) { return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); }
function addCol(table, col, def) { if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }

const firstV2 = !cols('report_types').includes('grp');
addCol('report_types', 'grp', `TEXT NOT NULL DEFAULT 'security'`);
addCol('report_types', 'half_life_h', 'REAL NOT NULL DEFAULT 24');
addCol('report_types', 'active', 'INTEGER NOT NULL DEFAULT 1');
addCol('report_types', 'staff_only', 'INTEGER NOT NULL DEFAULT 0');
for (const [c, d] of [['ongoing', 'INTEGER'], ['injured', 'INTEGER'], ['trapped', 'INTEGER'], ['affected', 'INTEGER'], ['source', 'TEXT'],
  ['occurred_at', 'INTEGER'], ['media_type', 'TEXT'], ['resolved_reason', 'TEXT'], ['verified_by', 'INTEGER'], ['status_note', 'TEXT']]) addCol('reports', c, d);
for (const [c, d] of [['trust', 'REAL NOT NULL DEFAULT 0.5'], ['trusted', 'INTEGER NOT NULL DEFAULT 0'], ['cancel_pin_hash', 'TEXT'], ['duress_pin_hash', 'TEXT'],
  ['base_lat', 'REAL'], ['base_lng', 'REAL'], ['notify_sms', 'INTEGER NOT NULL DEFAULT 1']]) addCol('users', c, d);
for (const [c, d] of [['operational', `TEXT NOT NULL DEFAULT 'unknown'`], ['last_confirmed_at', 'INTEGER'], ['hours', 'TEXT']]) addCol('places', c, d);
for (const [c, d] of [['ref', 'TEXT'], ['type', 'TEXT'], ['share_id', 'INTEGER'], ['duress', 'INTEGER NOT NULL DEFAULT 0'], ['cancelled_at', 'INTEGER'], ['closed_reason', 'TEXT']]) addCol('sos', c, d);

// ---------------- v3: security, notifications, journeys, alerts, directory, agencies, fleet ----------------
db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id INTEGER, role TEXT, action TEXT NOT NULL,
  target_type TEXT, target_id INTEGER, detail TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE TABLE IF NOT EXISTS mfa_backup (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS notif_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref_id INTEGER, channel TEXT NOT NULL,   -- push | sms | voice
  user_id INTEGER, phone TEXT, title TEXT, body TEXT, url TEXT, tag TEXT, ack_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | delivered | failed
  error TEXT, provider_id TEXT, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON notif_jobs(status, next_at);
CREATE INDEX IF NOT EXISTS idx_jobs_ref ON notif_jobs(kind, ref_id);
CREATE TABLE IF NOT EXISTS user_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, tag TEXT, read_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ualerts ON user_alerts(user_id, created_at);
CREATE TABLE IF NOT EXISTS alert_areas (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, radius_km REAL NOT NULL);
CREATE TABLE IF NOT EXISTS journeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, share_id INTEGER,
  fleet_id INTEGER, vehicle_id INTEGER, origin_name TEXT, dest_name TEXT, dest_lat REAL, dest_lng REAL, route_json TEXT,
  expected_arrival INTEGER, grace_min INTEGER NOT NULL DEFAULT 30, alert_after_min INTEGER NOT NULL DEFAULT 20, checkin_every_min INTEGER,
  notify_arrival INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',   -- active | overdue | escalated | arrived | ended
  started_at INTEGER NOT NULL, ended_at INTEGER, last_lat REAL, last_lng REAL, last_seen_at INTEGER, last_speed REAL,
  last_checkin_at INTEGER, checkin_prompted_at INTEGER, reminder_at INTEGER, escalated_at INTEGER,
  off_route INTEGER NOT NULL DEFAULT 0, off_route_count INTEGER NOT NULL DEFAULT 0, deviation_alert_at INTEGER, detour_ok_until INTEGER,
  stopped_since INTEGER, stop_lat REAL, stop_lng REAL, stop_alerted INTEGER NOT NULL DEFAULT 0, offline_alerted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_journeys_user ON journeys(user_id, status);
CREATE TABLE IF NOT EXISTS journey_events (id INTEGER PRIMARY KEY AUTOINCREMENT, journey_id INTEGER NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS place_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER, user_id INTEGER, data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS organisations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, state TEXT,
  lat REAL, lng REAL, radius_km REAL, phone TEXT, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS staff_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fleets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_id INTEGER NOT NULL, invite_code TEXT NOT NULL UNIQUE,
  deviation_km REAL NOT NULL DEFAULT 2, stop_min INTEGER NOT NULL DEFAULT 15, offline_min INTEGER NOT NULL DEFAULT 20, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fleet_members (fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'driver', created_at INTEGER NOT NULL, PRIMARY KEY (fleet_id, user_id));
CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  plate TEXT NOT NULL, label TEXT, driver_id INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fleet_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
  journey_id INTEGER, vehicle_id INTEGER, driver_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL, lat REAL, lng REAL, at INTEGER NOT NULL, ack_by INTEGER, ack_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_falerts ON fleet_alerts(fleet_id, at);
`);
for (const [c, d] of [['created_at', 'INTEGER'], ['last_seen', 'INTEGER'], ['ip', 'TEXT'], ['ua', 'TEXT'], ['mfa', 'INTEGER NOT NULL DEFAULT 0']]) addCol('sessions', c, d);
for (const [c, d] of [['totp_secret', 'TEXT'], ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'], ['totp_last', 'INTEGER'], ['alert_prefs', 'TEXT'],
  ['last_lat', 'REAL'], ['last_lng', 'REAL'], ['last_loc_at', 'INTEGER'], ['org_id', 'INTEGER'], ['org_role', 'TEXT'], ['notify_voice', 'INTEGER NOT NULL DEFAULT 0'],
  ['password_changed_at', 'INTEGER']]) addCol('users', c, d);
for (const [c, d] of [['media_public', 'INTEGER NOT NULL DEFAULT 0'], ['alert_level', 'INTEGER NOT NULL DEFAULT 0'], ['org_id', 'INTEGER'], ['fleet_id', 'INTEGER'],
  ['assigned_org', 'INTEGER'], ['assigned_user', 'INTEGER']]) addCol('reports', c, d);
for (const [c, d] of [['escalation_level', 'INTEGER NOT NULL DEFAULT 0'], ['assigned_org', 'INTEGER'], ['assigned_user', 'INTEGER'], ['fleet_id', 'INTEGER']]) addCol('sos', c, d);
for (const [c, d] of [['address', 'TEXT'], ['notes', 'TEXT'], ['verified_by', 'INTEGER'], ['org_id', 'INTEGER']]) addCol('places', c, d);

// ---------------- v4: State / LGA / community hierarchy, agency jurisdictions ----------------
for (const t of ['reports', 'sos', 'places']) for (const [c, d] of [['state', 'TEXT'], ['lga', 'TEXT'], ['lga_id', 'INTEGER'], ['locality', 'TEXT']]) addCol(t, c, d);
addCol('organisations', 'jurisdiction', 'TEXT');   // {"states":["Imo"],"lgas":[553]}
db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_state ON reports(state, lga_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_sos_state ON sos(state, lga_id);
CREATE INDEX IF NOT EXISTS idx_places_lga ON places(lga_id);`);

// ---------------- report categories ----------------
// key, label, icon, colour, group, points, warning radius km, lifetime h, half-life h, advice, sort, staff_only
const TYPES = [
  ['kidnap', 'Kidnapping alert', '🚨', '#a855f7', 'security', 45, 3, 24, 24, 'Do not stop. Keep moving, stay in company and avoid the area if you can.', 1, 0],
  ['robbery', 'Armed robbery', '🔫', '#ef4444', 'security', 35, 3, 12, 12, 'Avoid unnecessary stops on this stretch, especially after dark.', 2, 0],
  ['attack', 'Armed attack', '⚠️', '#dc2626', 'security', 40, 3, 12, 12, 'Leave the area if it is safe to do so and follow instructions from security personnel.', 3, 0],
  ['unrest', 'Civil unrest', '👥', '#f97316', 'security', 25, 2, 12, 6, 'Avoid crowds and protests. Use another route if you can.', 4, 0],
  ['secop', 'Security operation', '🚔', '#2563eb', 'security', 10, 2, 12, 6, 'Expect checkpoints or delays. Follow instructions from officers.', 5, 0],
  ['accident', 'Road accident', '💥', '#f59e0b', 'road', 20, 1, 8, 4, 'Slow down. Watch for people and vehicles on the road.', 6, 0],
  ['flood', 'Flooding', '🌊', '#3b82f6', 'road', 25, 1.5, 48, 24, 'Reduce speed. Do not drive through fast-moving water.', 7, 0],
  ['bridge', 'Bridge failure', '🌉', '#f97316', 'road', 35, 1.5, 720, 240, 'Road may be impassable. Look for a diversion.', 8, 0],
  ['blockage', 'Road blockage', '🚧', '#eab308', 'road', 18, 1, 8, 6, 'Lane or road blocked. Slow down; oncoming traffic may be in your lane.', 9, 0],
  ['fuel', 'Fuel-related hazard', '⛽', '#fb923c', 'road', 20, 1, 12, 6, 'Fuel spill or tanker incident. No smoking or open flames; keep your distance.', 10, 0],
  ['fire', 'Fire outbreak', '🔥', '#ea580c', 'road', 20, 1, 6, 3, 'Keep clear and give way to fire service vehicles.', 11, 0],
  ['collapse', 'Building collapse', '🏚️', '#78716c', 'road', 15, 0.8, 72, 24, 'Keep clear of the site; rescue work may block the road.', 12, 0],
  ['roadcond', 'Dangerous road conditions', '🛣️', '#a8a29e', 'road', 10, 1, 2160, 720, 'Bad road surface. Reduce speed.', 13, 0],
  ['medical', 'Medical emergency', '🚑', '#e11d48', 'info', 5, 0.5, 3, 2, 'Give way to responders. Call 112 if someone needs help.', 14, 0],
  ['blackspot', 'Accident blackspot', '📍', '#fbbf24', 'road', 15, 1, 87600, 100000, 'Recurring crash location. Slow down and do not overtake.', 15, 1],
  ['advisory', 'Official security advisory', '🛡️', '#1d4ed8', 'security', 50, 4, 24, 12, 'Follow instructions from security personnel.', 16, 1]
];
const upsertType = db.prepare(`INSERT INTO report_types (key,label,icon,color,grp,weight,radius_km,ttl_hours,half_life_h,advice,sort,staff_only,active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)
  ON CONFLICT(key) DO UPDATE SET label=excluded.label, icon=excluded.icon, color=excluded.color, grp=excluded.grp, weight=excluded.weight,
  radius_km=excluded.radius_km, ttl_hours=excluded.ttl_hours, half_life_h=excluded.half_life_h, advice=excluded.advice, sort=excluded.sort, staff_only=excluded.staff_only, active=1`);
const insType = db.prepare(`INSERT OR IGNORE INTO report_types (key,label,icon,color,grp,weight,radius_km,ttl_hours,half_life_h,advice,sort,staff_only,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`);

db.transaction(() => {
  if (firstV2) {
    // convert v1 data: types, statuses and votes
    TYPES.forEach(t => upsertType.run(...t));
    db.exec(`UPDATE reports SET type='blackspot' WHERE type='accident' AND (expires_at IS NULL OR expires_at - created_at > 30*24*3600000)`);
    db.exec(`UPDATE reports SET type='blockage' WHERE type IN ('tree','truck')`);
    db.exec(`UPDATE reports SET type='roadcond' WHERE type='pothole'`);
    db.exec(`UPDATE reports SET status='verified', verified_by=moderated_by WHERE status='approved'`);
    db.exec(`UPDATE reports SET status='unverified' WHERE status='pending'`);
    db.exec(`UPDATE reports SET status='resolved', resolved_reason='cleared' WHERE status='cleared'`);
    db.exec(`UPDATE reports SET status='resolved', resolved_reason='expired' WHERE status='expired'`);
    db.exec(`UPDATE reports SET occurred_at=created_at WHERE occurred_at IS NULL`);
    db.exec(`UPDATE reports SET expires_at = occurred_at + (SELECT ttl_hours FROM report_types t WHERE t.key=reports.type) * 3600000
      WHERE expires_at IS NULL AND status IN ('unverified','investigating','verified')`);
    db.exec(`DELETE FROM report_types WHERE key IN ('tree','truck','pothole')`);
    const hasVotes = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='votes'`).get();
    if (hasVotes) {
      db.exec(`INSERT OR IGNORE INTO confirmations (report_id,user_id,kind,created_at) SELECT report_id,user_id,CASE vote WHEN 'cleared' THEN 'resolved' ELSE 'ongoing' END,created_at FROM votes`);
      db.exec(`DROP TABLE votes`);
    }
  } else {
    TYPES.forEach(t => insType.run(...t)); // new installs and later additions; keeps admin edits
  }
})();

// ---------------- settings ----------------
const SETTINGS = {
  level_cutoffs: '12,30,55',     // scores where Moderate, High and Severe start
  tourist_shift: '5',            // Tourist Mode warns this many points earlier
  time_dusk: '1.15',             // 18:00–21:00 multiplier on threat evidence
  time_night: '1.35',            // 21:00–06:00 multiplier on threat evidence
  history_radius_km: '5',        // radius for incident frequency and time patterns
  history_cap: '20',             // most points past incidents can add
  no_post_pts: '4',              // added when there is threat evidence and no security post within 10 km
  post_confirm_days: '60',       // a post counts as confirmed operational for this many days after confirmation
  rain_heavy_mm3h: '10',         // rainfall in the next 3 hours that counts as heavy
  rain_heavy_pts: '12',
  public_min_confidence: '0.45', // unverified security reports become public only above this confidence
  corroborate_km: '2',           // independent reports of the same kind within this distance…
  corroborate_hours: '6',        // …and this time support each other
  alert_lookahead_s: '45',       // warn about hazards this many seconds of travel ahead
  reports_per_hour: '10',        // per-user limit
  sos_radius_km: '60',           // notify verified security based within this distance (or with no base set)
  tz_offset_hours: '1',          // Nigeria = UTC+1, used for time-of-day patterns
  sos_escalate_min: '3',         // no responder acknowledgement after this → wider alert (+ calls if enabled)
  sos_escalate2_min: '10',       // still none → every verified responder and admin
  deviation_km: '2',             // journey counts as off-route beyond this distance
  arrive_radius_m: '300',        // within this distance of the destination = arrived
  community_alerts_per_hour: '10',
  heatmap_min_count: '3',        // public heatmap hides cells with fewer incidents than this
  community_alerts_enabled: '1', // operational switch: 0 pauses community alerts nationally
  public_reporting_enabled: '1', // operational switch: 0 pauses new reports from the public (staff can still post)
  notice_text: '',               // banner shown at the top of the app (e.g. planned maintenance, major advisory)
  facility_verify_days: '365'    // a facility listing counts as verified for this many days
};
const insSet = db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`);
Object.entries(SETTINGS).forEach(([k, v]) => insSet.run(k, v));
db.prepare(`DELETE FROM settings WHERE key IN ('cutoffs','post_near_km','post_mid_km','post_mid_pts','post_far_pts','settle_urban','settle_peri','settle_rural','settle_forest','advisory_floor')`).run();

// ---------------- web-push keys (kept out of the public settings table) ----------------
function secret(key, make) {
  const row = db.prepare(`SELECT value FROM secrets WHERE key=?`).get(key);
  if (row) return row.value;
  const v = make();
  db.prepare(`INSERT INTO secrets (key,value) VALUES (?,?)`).run(key, v);
  return v;
}

// ---------------- first admin account from environment variables ----------------
function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  const has = db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`).get().n;
  if (has || !email || !pass) return;
  db.prepare(`INSERT INTO users (name,email,password_hash,role,trust,trusted,created_at) VALUES (?,?,?,?,0.9,1,?)`)
    .run(process.env.ADMIN_NAME || 'Administrator', email, bcrypt.hashSync(pass, 10), 'admin', Date.now());
  console.log(`[saferoute] admin account created for ${email}`);
}
ensureAdmin();

const randomToken = n => crypto.randomBytes(n || 16).toString('base64url');

module.exports = { db, DATA_DIR, secret, randomToken };
