/*
 * SafeRoute risk engine — shared by the server (Node) and the browser.
 *
 *   R = min(100, (H + P + S) x T)
 *   H = hazard load: sum of weight x (1 - distance/radius) x freshness for approved reports nearby
 *   P = security cover: points added by distance to the nearest police/FRSC/military post
 *   S = settlement base risk of the zone you are in
 *   T = time-of-travel multiplier (day / dusk / night)
 * All numbers come from the report_types and settings tables, so admins can tune them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafeRisk = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SECURITY_CATS = ['police', 'frsc', 'military', 'nscdc'];
  const SETTLE_LABEL = { urban: 'Urban', peri: 'Peri-urban', rural: 'Rural', forest: 'Forest / isolated stretch' };

  function km(a, b) {
    const r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  const num = (v, d) => (v === undefined || v === null || isNaN(+v) ? d : +v);

  function timeMult(hour, s) {
    const h = ((hour % 24) + 24) % 24;
    if (h >= 6 && h < 18) return 1;
    if (h >= 18 && h < 21) return num(s.time_dusk, 1.2);
    return num(s.time_night, 1.5);
  }
  function timeLabel(hour) {
    const h = ((hour % 24) + 24) % 24;
    return h >= 6 && h < 18 ? 'Day' : h >= 18 && h < 21 ? 'Dusk' : 'Night';
  }

  function zoneAt(p, zones) {
    let best = null;
    for (const z of zones || []) {
      const d = km(p, [z.lat, z.lng]);
      if (d <= z.radius_km && (!best || z.radius_km < best.radius_km)) best = z; // smallest containing zone wins
    }
    return best || { name: 'Open road', type: 'rural' };
  }

  function nearest(p, places, cats) {
    let best = null, bd = Infinity;
    for (const pl of places || []) {
      if (cats && !cats.includes(pl.category)) continue;
      const d = km(p, [pl.lat, pl.lng]);
      if (d < bd) { bd = d; best = pl; }
    }
    return best ? { place: best, d: bd } : null;
  }

  function freshness(r, type, now) {
    const ageH = (now - r.created_at) / 3600000;
    const ttl = Math.max(1, type.ttl_hours);
    return Math.max(0.3, 1 - 0.7 * (ageH / ttl));
  }

  /**
   * @param {[number,number]} p   [lat, lng]
   * @param {number} hour         0–24 local hour of travel
   * @param {object} data         { reports, places, zones, types: {key: type}, settings: {key: value} }
   * @param {object} opts         { tourist: bool, now: ms }
   */
  function compute(p, hour, data, opts) {
    opts = opts || {};
    const s = data.settings || {};
    const now = opts.now || Date.now();
    let H = 0, forced = 0;
    const near = [];
    for (const r of data.reports || []) {
      if (r.status !== 'approved') continue;
      if (r.expires_at && r.expires_at < now) continue;
      const t = data.types[r.type];
      if (!t) continue;
      const d = km(p, [r.lat, r.lng]);
      if (d < t.radius_km) {
        const c = t.weight * (1 - d / t.radius_km) * freshness(r, t, now);
        H += c;
        near.push({ report: r, d, c });
        if (r.type === 'advisory') forced = Math.max(forced, num(s.advisory_floor, 75));
      }
    }
    const post = nearest(p, data.places, SECURITY_CATS);
    const pd = post ? post.d : Infinity;
    const P = pd < num(s.post_near_km, 2) ? 0 : pd < num(s.post_mid_km, 10) ? num(s.post_mid_pts, 10) : num(s.post_far_pts, 20);
    const zone = zoneAt(p, data.zones);
    const S = num(s['settle_' + zone.type], { urban: 5, peri: 10, rural: 15, forest: 25 }[zone.type] || 15);
    const T = timeMult(hour, s);
    let R = Math.min(100, Math.round((H + P + S) * T));
    R = Math.max(R, forced);
    const shift = opts.tourist ? num(s.tourist_shift, 10) : 0;
    const cuts = String(s.cutoffs || '25,50,75').split(',').map(Number).map(c => c - shift);
    const level = R >= cuts[2] ? 3 : R >= cuts[1] ? 2 : R >= cuts[0] ? 1 : 0;
    return { R, level, H: Math.round(H), P, S, T, zone, post, near };
  }

  const LEVELS = [
    { name: 'Low risk', hex: '#22c55e' },
    { name: 'Caution', hex: '#f59e0b' },
    { name: 'High risk', hex: '#ef4444' },
    { name: 'Avoid', hex: '#a855f7' }
  ];

  return { compute, km, nearest, zoneAt, timeMult, timeLabel, LEVELS, SECURITY_CATS, SETTLE_LABEL };
});
