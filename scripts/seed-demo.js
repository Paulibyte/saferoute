// Loads sample places, zones and reports for the Owerri–Port Harcourt corridor so you can try the app.
// Run once:  npm run seed-demo      Remove later from the admin screen, or delete data/saferoute.db to start clean.
// All names end in "(demo)" and the coordinates are approximate.
const { db } = require('../db');
const now = Date.now();

if (db.prepare(`SELECT COUNT(*) n FROM places WHERE name LIKE '%(demo)%'`).get().n) {
  console.log('Demo data already loaded.');
  process.exit(0);
}

const places = [
  ['police', 'Police Division, Owerri (demo)', 5.4790, 7.0300], ['police', 'Highway checkpoint, Umuagwo (demo)', 5.3330, 6.9420],
  ['police', 'Police Station, Elele (demo)', 5.0960, 6.8160], ['frsc', 'FRSC outpost, Isiokpo (demo)', 4.9620, 6.8580],
  ['police', 'Police Division, Port Harcourt (demo)', 4.8220, 7.0400],
  ['hospital', 'Federal Medical Centre, Owerri (demo)', 5.4900, 7.0280], ['clinic', 'Roadside clinic (demo)', 5.2720, 6.9230],
  ['hospital', 'General Hospital, Elele (demo)', 5.1000, 6.8200], ['hospital', 'Teaching Hospital, Port Harcourt (demo)', 4.8300, 7.0300],
  ['mechanic', 'Auto workshop, Avu (demo)', 5.4400, 6.9930], ['vulcaniser', 'Mechanic & vulcaniser (demo)', 5.2020, 6.8920],
  ['mechanic', 'Auto workshop, Isiokpo (demo)', 4.9680, 6.8560], ['fuel', 'Filling station (demo)', 5.3570, 6.9480], ['fuel', 'Filling station (demo)', 5.0320, 6.8290]
];
const zones = [
  ['Owerri (demo)', 'urban', 5.48, 7.03, 7], ['Port Harcourt (demo)', 'urban', 4.82, 7.04, 9], ['Elele (demo)', 'peri', 5.093, 6.813, 3.5],
  ['Umuagwo (demo)', 'peri', 5.31, 6.945, 3], ['Isiokpo (demo)', 'peri', 4.96, 6.86, 3], ['Forest stretch (demo)', 'forest', 5.17, 6.872, 7]
];
const reports = [
  ['flood', 5.4210, 6.9775, 'Water over the road at the low bridge. One lane passable. (demo)', 'approved', 5],
  ['accident', 5.3020, 6.9285, 'Sharp bend with repeated crashes. (demo)', 'approved', 400],
  ['truck', 5.2180, 6.8990, 'Broken-down trailer blocking the southbound lane. (demo)', 'approved', 1],
  ['robbery', 5.1640, 6.8660, 'Sample report: robbery on this stretch after dark. (demo)', 'approved', 3],
  ['tree', 5.0620, 6.8205, 'Fallen tree across one lane. (demo)', 'approved', 2],
  ['bridge', 4.9310, 6.8840, 'Culvert partly washed away. (demo)', 'approved', 30],
  ['pothole', 4.8610, 6.9620, 'Deep potholes on both lanes. (demo)', 'approved', 200],
  ['flood', 4.9980, 6.8460, 'Road flooded after heavy rain. (demo)', 'pending', 0.8],
  ['truck', 5.3600, 6.9500, 'Tanker parked on the road near the junction. (demo)', 'pending', 0.2]
];
const types = Object.fromEntries(db.prepare(`SELECT key, ttl_hours FROM report_types`).all().map(t => [t.key, t.ttl_hours]));

db.transaction(() => {
  const ip = db.prepare(`INSERT INTO places (category,name,lat,lng,created_at) VALUES (?,?,?,?,?)`);
  places.forEach(p => ip.run(...p, now));
  const iz = db.prepare(`INSERT INTO zones (name,type,lat,lng,radius_km) VALUES (?,?,?,?,?)`);
  zones.forEach(z => iz.run(...z));
  const ir = db.prepare(`INSERT INTO reports (type,lat,lng,note,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`);
  reports.forEach(([type, lat, lng, note, status, ageH]) => {
    const created = now - ageH * 36e5;
    ir.run(type, lat, lng, note, status, created, status === 'approved' ? created + types[type] * 36e5 : null);
  });
})();
console.log(`Loaded ${places.length} places, ${zones.length} zones and ${reports.length} reports (demo).`);
