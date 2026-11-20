// Loads sample places, zones and reports for the Owerri–Port Harcourt corridor so you can try the app.
// Run once:  npm run seed-demo      Delete the "(demo)" items later from the Admin tab.
// The coordinates are approximate and the incidents are invented.
const { db } = require('../db');
const now = Date.now(), H = 3600000, D = 24 * H;

if (db.prepare(`SELECT COUNT(*) n FROM places WHERE name LIKE '%(demo)%'`).get().n) {
  console.log('Demo data already loaded.');
  process.exit(0);
}
// category, name, lat, lng, operational ('confirmed' | 'unknown')
const places = [
  ['police', 'Police Division, Owerri (demo)', 5.4790, 7.0300, 'confirmed'], ['police', 'Highway checkpoint, Umuagwo (demo)', 5.3330, 6.9420, 'confirmed'],
  ['police', 'Police Station, Elele (demo)', 5.0960, 6.8160, 'unknown'], ['frsc', 'FRSC outpost, Isiokpo (demo)', 4.9620, 6.8580, 'confirmed'],
  ['police', 'Police Division, Port Harcourt (demo)', 4.8220, 7.0400, 'confirmed'],
  ['hospital', 'Federal Medical Centre, Owerri (demo)', 5.4900, 7.0280], ['clinic', 'Roadside clinic (demo)', 5.2720, 6.9230],
  ['hospital', 'General Hospital, Elele (demo)', 5.1000, 6.8200], ['hospital', 'Teaching Hospital, Port Harcourt (demo)', 4.8300, 7.0300],
  ['mechanic', 'Auto workshop, Avu (demo)', 5.4400, 6.9930], ['vulcaniser', 'Mechanic & vulcaniser (demo)', 5.2020, 6.8920],
  ['mechanic', 'Auto workshop, Isiokpo (demo)', 4.9680, 6.8560], ['fuel', 'Filling station (demo)', 5.3570, 6.9480], ['fuel', 'Filling station (demo)', 5.0320, 6.8290]
];
const zones = [
  ['Owerri (demo)', 'urban', 5.48, 7.03, 7], ['Port Harcourt (demo)', 'urban', 4.82, 7.04, 9], ['Elele (demo)', 'peri', 5.093, 6.813, 3.5],
  ['Umuagwo (demo)', 'peri', 5.31, 6.945, 3], ['Isiokpo (demo)', 'peri', 4.96, 6.86, 3], ['Forest stretch (demo)', 'forest', 5.17, 6.872, 7]
];
// type, lat, lng, note, status, hours ago, official
const reports = [
  ['flood', 5.4210, 6.9775, 'Water over the road at the low bridge. One lane passable. (demo)', 'verified', 5, 0],
  ['blackspot', 5.3020, 6.9285, 'Sharp bend with repeated crashes. (demo)', 'verified', 400, 0],
  ['blockage', 5.2180, 6.8990, 'Broken-down trailer blocking the southbound lane. (demo)', 'verified', 1, 0],
  ['robbery', 5.1640, 6.8660, 'Sample report: armed men stopping vehicles at the bend. (demo)', 'verified', 3, 1],
  ['robbery', 5.1700, 6.8700, 'Sample report: two cars robbed near the same bend. (demo)', 'unverified', 2, 0],
  ['blockage', 5.0620, 6.8205, 'Fallen tree across one lane. (demo)', 'verified', 2, 0],
  ['bridge', 4.9310, 6.8840, 'Culvert partly washed away. (demo)', 'verified', 30, 0],
  ['roadcond', 4.8610, 6.9620, 'Deep potholes on both lanes. (demo)', 'verified', 200, 0],
  ['flood', 4.9980, 6.8460, 'Road flooded after heavy rain. (demo)', 'unverified', 0.8, 0],
  ['blockage', 5.3600, 6.9500, 'Tanker parked on the road near the junction. (demo)', 'unverified', 0.2, 0]
];
// past verified incidents (resolved) to show frequency and time-of-day patterns: days ago, local hour
const past = [[5.168, 6.869, 'robbery', 6, 21], [5.160, 6.862, 'robbery', 19, 22], [5.175, 6.875, 'kidnap', 40, 20], [5.165, 6.866, 'robbery', 75, 23],
  [5.171, 6.871, 'attack', 130, 21], [5.158, 6.860, 'robbery', 200, 19], [4.935, 6.884, 'robbery', 90, 14]];
const types = Object.fromEntries(db.prepare(`SELECT key, ttl_hours FROM report_types`).all().map(t => [t.key, t.ttl_hours]));

db.transaction(() => {
  const ip = db.prepare(`INSERT INTO places (category,name,lat,lng,operational,last_confirmed_at,created_at) VALUES (?,?,?,?,?,?,?)`);
  places.forEach(([c, n, la, ln, op]) => ip.run(c, n, la, ln, op || 'unknown', op === 'confirmed' ? now - 5 * D : null, now));
  const iz = db.prepare(`INSERT INTO zones (name,type,lat,lng,radius_km) VALUES (?,?,?,?,?)`);
  zones.forEach(z => iz.run(...z));
  const ir = db.prepare(`INSERT INTO reports (type,lat,lng,note,status,official,source,created_at,occurred_at,expires_at,verified_by,resolved_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  reports.forEach(([type, lat, lng, note, status, ageH, off]) => {
    const t = now - ageH * H;
    ir.run(type, lat, lng, note, status, off, off ? 'official' : 'witness', t, t, t + types[type] * H, status === 'verified' ? 0 : null, null);
  });
  past.forEach(([lat, lng, type, days, hour]) => {
    const d = new Date(now - days * D); d.setUTCHours(hour - 1, 15, 0, 0); // local time = UTC+1
    ir.run(type, lat, lng, 'Past incident (demo)', 'resolved', 0, 'witness', d.getTime(), d.getTime(), d.getTime() + 12 * H, 0, 'expired');
  });
})();
console.log(`Loaded ${places.length} places, ${zones.length} zones, ${reports.length} live reports and ${past.length} past incidents (demo).`);
