// SQLite database: one file at data/saferoute.db (set DATA_DIR to move it). Back up that file to back up everything.
require('./env');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'saferoute.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'traveller',          -- traveller | security | moderator | admin
  security_status TEXT,                            -- NULL | pending | verified | rejected
  agency TEXT,                                     -- e.g. Police, FRSC, NSCDC, Vigilante
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS report_types (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  weight REAL NOT NULL,
  radius_km REAL NOT NULL,
  ttl_hours REAL NOT NULL,
  advice TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL REFERENCES report_types(key),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  note TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected | expired | cleared
  official INTEGER NOT NULL DEFAULT 0,
  moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderated_at INTEGER,
  responding_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_geo ON reports(lat, lng);
CREATE TABLE IF NOT EXISTS votes (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote TEXT NOT NULL,                              -- still | cleared
  created_at INTEGER NOT NULL,
  PRIMARY KEY (report_id, user_id)
);
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                          -- police | frsc | military | nscdc | hospital | clinic | mechanic | fuel | vulcaniser
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  phone TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                              -- urban | peri | rural | forest
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_km REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',             -- open | responding | closed
  responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

// ---- default risk configuration (only inserted if missing; edit later from the admin screen) ----
const TYPES = [
  ['kidnap', 'Kidnapping / bandits', '🚨', '#a855f7', 40, 3, 12, 'Do not stop. Keep moving and stay in convoy if possible.', 1],
  ['robbery', 'Armed robbery', '⚠️', '#ef4444', 35, 3, 12, 'Avoid stopping on this stretch, especially after dark.', 2],
  ['bridge', 'Collapsed bridge or culvert', '🌉', '#f97316', 35, 1.5, 720, 'Road may be impassable. Look for a diversion.', 3],
  ['flood', 'Flooded road', '🌊', '#3b82f6', 25, 1.5, 48, 'Reduce speed. Do not drive through fast-moving water.', 4],
  ['accident', 'Accident blackspot', '💥', '#f59e0b', 20, 1.5, 8760, 'Slow down and do not overtake.', 5],
  ['tree', 'Fallen tree', '🌳', '#16a34a', 15, 1.5, 24, 'Lane blocked. Slow down.', 6],
  ['truck', 'Truck blocking lane', '🚛', '#eab308', 15, 1.5, 6, 'Oncoming traffic may be in your lane. Slow down.', 7],
  ['pothole', 'Bad road / potholes', '🕳️', '#78716c', 8, 1.5, 2160, 'Reduce speed.', 8],
  ['advisory', 'Official security advisory', '🛡️', '#2563eb', 50, 4, 24, 'Follow instructions from security personnel.', 9]
];
const insType = db.prepare(`INSERT OR IGNORE INTO report_types (key,label,icon,color,weight,radius_km,ttl_hours,advice,sort) VALUES (?,?,?,?,?,?,?,?,?)`);
TYPES.forEach(t => insType.run(...t));

const SETTINGS = {
  cutoffs: '25,50,75',        // score where Caution, High risk and Avoid start
  tourist_shift: '10',        // Tourist Mode lowers every cut-off by this much
  post_near_km: '2',          // within this distance of a security post adds 0
  post_mid_km: '10',          // up to this distance adds post_mid_pts, beyond adds post_far_pts
  post_mid_pts: '10',
  post_far_pts: '20',
  settle_urban: '5',
  settle_peri: '10',
  settle_rural: '15',
  settle_forest: '25',
  time_dusk: '1.2',           // 18:00–21:00
  time_night: '1.5',          // 21:00–06:00
  advisory_floor: '75',       // official advisories force at least this score
  alert_lookahead_s: '45',    // warn about hazards this many seconds of travel ahead
  reports_per_hour: '10'      // per-user limit
};
const insSet = db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`);
Object.entries(SETTINGS).forEach(([k, v]) => insSet.run(k, v));

// ---- first admin account from environment variables ----
function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  const has = db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`).get().n;
  if (has || !email || !pass) return;
  db.prepare(`INSERT INTO users (name,email,password_hash,role,created_at) VALUES (?,?,?,?,?)`)
    .run(process.env.ADMIN_NAME || 'Administrator', email, bcrypt.hashSync(pass, 10), 'admin', Date.now());
  console.log(`[saferoute] admin account created for ${email}`);
}
ensureAdmin();

module.exports = { db, DATA_DIR };
