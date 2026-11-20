/*
 * SafeRoute risk intelligence engine (v2) — shared by the server (Node) and the browser.
 *
 * It keeps three things apart:
 *   1. SECURITY THREAT  — recent incidents (weighted by distance, recency and confidence), incident
 *                         frequency over 30 / 365 days, historical time-of-day pattern, verified
 *                         security presence and response, and a small isolation context.
 *   2. ROAD CONDITIONS  — floods, bridge failures, blockages, crashes, fire, fuel hazards, weather.
 *   3. CONFIDENCE       — how reliable the information behind the rating is (verified, unverified,
 *                         disputed, or simply too few reports to say).
 * It returns plain-language reasons and a recommended action, never just a number.
 * All weights come from the report_types and settings tables so admins can tune them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SafeRisk = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SECURITY_CATS = ['police', 'frsc', 'military', 'nscdc', 'community'];
  const SETTLE_LABEL = { urban: 'Urban', peri: 'Peri-urban', rural: 'Rural', forest: 'Forest / isolated stretch' };
  const LEVELS = [
    { name: 'Low', long: 'Low reported risk', hex: '#22c55e' },
    { name: 'Moderate', long: 'Moderate risk', hex: '#f59e0b' },
    { name: 'High', long: 'High risk', hex: '#ef4444' },
    { name: 'Severe', long: 'Severe risk', hex: '#a855f7' }
  ];
  const CONF = [
    { name: 'Low confidence', max: 0.45 },
    { name: 'Moderate confidence', max: 0.7 },
    { name: 'High confidence', max: 1.01 }
  ];
  const H = 3600000;

  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
  const confLabel = c => CONF.find(x => c < x.max).name;
  const plural = (n, a, b) => n + ' ' + (n === 1 ? a : (b || a + 's'));

  function km(a, b) {
    const r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  function norm(h) { return ((h % 24) + 24) % 24; }
  function timeLabel(hour) { const h = norm(hour); return h >= 6 && h < 18 ? 'Day' : h >= 18 && h < 21 ? 'Dusk' : 'Night'; }
  function timeMult(hour, s) { const l = timeLabel(hour); return l === 'Day' ? 1 : l === 'Dusk' ? num(s.time_dusk, 1.15) : num(s.time_night, 1.35); }
  function hourDist(a, b) { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 24 - d); }
  function ageText(ms) { const m = ms / 60000; return m < 60 ? Math.max(1, Math.round(m)) + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days'; }

  function zoneAt(p, zones) {
    let best = null;
    for (const z of zones || []) {
      if (km(p, [z.lat, z.lng]) <= z.radius_km && (!best || z.radius_km < best.radius_km)) best = z;
    }
    return best || { name: 'Open road', type: 'rural' };
  }
  function nearest(p, places, cats, filter) {
    let best = null, bd = Infinity;
    for (const pl of places || []) {
      if (cats && !cats.includes(pl.category)) continue;
      if (filter && !filter(pl)) continue;
      const d = km(p, [pl.lat, pl.lng]);
      if (d < bd) { bd = d; best = pl; }
    }
    return best ? { place: best, d: bd } : null;
  }
  // a security post counts as "confirmed" if someone confirmed it operational in the last N days
  function postConfirmed(pl, s, now) {
    return pl.operational === 'confirmed' && pl.last_confirmed_at && now - pl.last_confirmed_at < num(s.post_confirm_days, 60) * 24 * H;
  }

  function isActive(r, now) {
    if (r.public === false) return false; // hidden low-confidence reports never shape a public rating
    return (r.status === 'verified' || r.status === 'investigating' || r.status === 'unverified') && (!r.expires_at || r.expires_at > now);
  }

  /**
   * Assess one point.
   * @param p      [lat, lng]
   * @param hour   local hour of travel (0–24)
   * @param data   { reports, history, places, zones, types, settings }
   *               reports carry .confidence (0–1) computed by the server
   *               history: [{lat,lng,type,t,h}] past verified security incidents (resolved/expired)
   * @param opts   { tourist, now, weather: {mm3h, now_mm, label} }
   */
  function assess(p, hour, data, opts) {
    opts = opts || {};
    const s = data.settings || {}, T = data.types || {}, now = opts.now || Date.now();
    const reasons = [];
    const near = [];
    let threat = 0, threatConfW = 0, threatW = 0, road = 0, roadConfW = 0, roadW = 0, official = false, responding = 0, disputed = 0;
    const byType = {};

    for (const r of data.reports || []) {
      if (!isActive(r, now)) continue;
      const t = T[r.type]; if (!t) continue;
      const d = km(p, [r.lat, r.lng]);
      if (d >= t.radius_km) continue;
      const ageH = Math.max(0, (now - (r.occurred_at || r.created_at)) / H);
      const decay = t.half_life_h >= 50000 ? 1 : Math.pow(0.5, ageH / Math.max(0.5, t.half_life_h));
      const conf = r.status === 'verified' ? Math.max(0.8, num(r.confidence, 0.85)) : num(r.confidence, 0.3);
      const c = t.weight * (1 - d / t.radius_km) * decay * conf;
      near.push({ report: r, d, c });
      if (r.official && r.status === 'verified') official = true;
      if (r.responding_by) responding++;
      if (r.disputed) disputed++;
      if (t.grp === 'security') { threat += c; threatConfW += c * conf; threatW += c; }
      else if (t.grp === 'road') { road += c; roadConfW += c * conf; roadW += c; }
      else { road += c * 0.5; roadConfW += c * 0.5 * conf; roadW += c * 0.5; } // info / medical: small effect
      const k = r.type;
      byType[k] = byType[k] || { n: 0, verified: 0, official: 0, newest: Infinity, maxD: 0 };
      byType[k].n++; if (r.status === 'verified') byType[k].verified++; if (r.official) byType[k].official++;
      byType[k].newest = Math.min(byType[k].newest, now - (r.occurred_at || r.created_at)); byType[k].maxD = Math.max(byType[k].maxD, d);
    }

    // ---- incident frequency and time-of-day pattern from history (verified, already finished incidents) ----
    const R5 = num(s.history_radius_km, 5);
    let n30 = 0, n365 = 0, atHour = 0;
    for (const h of data.history || []) {
      if (km(p, [h.lat, h.lng]) > R5) continue;
      const age = now - h.t;
      if (age > 365 * 24 * H) continue;
      n365++; if (age < 30 * 24 * H) n30++;
      if (hourDist(h.h, hour) <= 2) atHour++;
    }
    const hist = Math.min(num(s.history_cap, 20), 4 * n30 + 1 * (n365 - n30));
    const pattern = n365 >= 3 ? Math.min(12, 12 * (atHour / n365) * (n365 >= 5 ? 1 : 0.6)) : 0;

    // ---- security presence and response ----
    const tm = timeMult(hour, s);
    const post = nearest(p, data.places, SECURITY_CATS, pl => pl.operational !== 'closed');
    const confirmedPost = nearest(p, data.places, SECURITY_CATS, pl => postConfirmed(pl, s, now));
    let presence = 1, noPost = 0;
    if (confirmedPost && confirmedPost.d <= 3) presence = 0.8;
    else if (confirmedPost && confirmedPost.d <= 10) presence = 0.9;
    else if (post && post.d <= 10) presence = 0.95;
    else if (threat + hist > 0) noPost = num(s.no_post_pts, 4);
    if (responding) presence *= 0.85;

    const zone = zoneAt(p, data.zones);
    const isolation = { urban: 0, peri: 1.5, rural: 3, forest: 5 }[zone.type] || 3;
    const context = isolation * (tm > 1 ? 1.6 : 1);

    const secScore = Math.min(100, Math.round((threat + hist + pattern) * tm * presence + context + noPost));

    // ---- road conditions (+ weather) ----
    let weatherPts = 0;
    const w = opts.weather;
    if (w && (num(w.mm3h, 0) >= num(s.rain_heavy_mm3h, 10) || num(w.now_mm, 0) >= 5)) weatherPts = num(s.rain_heavy_pts, 12);
    else if (w && num(w.mm3h, 0) >= 4) weatherPts = 5;
    const roadScore = Math.min(100, Math.round((road + weatherPts) * (tm > 1 ? 1.15 : 1)));

    const cuts = String(s.level_cutoffs || '12,30,55').split(',').map(Number).map(c => c - (opts.tourist ? num(s.tourist_shift, 5) : 0));
    const lvl = x => x >= cuts[2] ? 3 : x >= cuts[1] ? 2 : x >= cuts[0] ? 1 : 0;
    const secLevel = lvl(secScore), roadLevel = lvl(roadScore);
    const level = Math.max(secLevel, roadLevel);

    // ---- confidence ----
    let coverage = 0;
    for (const r of data.reports || []) if (r.public !== false && km(p, [r.lat, r.lng]) <= 10 && now - r.created_at < 90 * 24 * H) coverage++;
    for (const h of data.history || []) if (km(p, [h.lat, h.lng]) <= 10 && now - h.t < 90 * 24 * H) coverage++;
    let secConf;
    if (threatW > 0) {
      secConf = threatConfW / threatW;
      if (official) secConf = Math.max(secConf, 0.85);
      if (disputed) secConf *= 0.85;
      if (hist > 0) secConf = Math.min(0.95, secConf + 0.05);
    } else if (hist > 0) secConf = 0.65;
    else secConf = coverage >= 5 ? 0.65 : coverage >= 1 ? 0.5 : 0.3;
    const roadConf = roadW > 0 ? roadConfW / roadW : weatherPts ? 0.7 : secConf;
    const confidence = secLevel >= roadLevel ? secConf : roadConf;

    // ---- reasons (most important first) ----
    const typeOrder = Object.keys(byType).sort((a, b) => (T[b].weight || 0) - (T[a].weight || 0));
    for (const k of typeOrder) {
      const b = byType[k], t = T[k];
      const src = b.official ? `${b.official} confirmed by verified security` : b.verified ? `${b.verified} verified by moderators` : 'unconfirmed community information';
      reasons.push({ kind: t.grp === 'security' ? 'threat' : 'road', icon: t.icon,
        text: `${plural(b.n, t.label.toLowerCase() + ' report')} within ${Math.max(1, Math.ceil(b.maxD))} km — latest ${ageText(b.newest)} ago (${src})` });
    }
    if (threat > 0 && !responding) reasons.push({ kind: 'threat', icon: '🚔', text: 'No verified security response currently recorded' });
    if (responding) reasons.push({ kind: 'good', icon: '🚔', text: `Security personnel are responding to ${plural(responding, 'incident')} nearby` });
    if (n30) reasons.push({ kind: 'threat', icon: '📈', text: `${plural(n30, 'verified security incident')} within ${R5} km in the last 30 days` });
    else if (n365 >= 3) reasons.push({ kind: 'info', icon: '📅', text: `${n365} verified incidents within ${R5} km in the past year` });
    if (pattern >= 4 && tm > 1) reasons.push({ kind: 'threat', icon: '🌙', text: `${atHour} of ${n365} past incidents near here happened around this time of day` });
    else if (pattern >= 4) reasons.push({ kind: 'info', icon: '🕑', text: `${atHour} of ${n365} past incidents near here happened around this hour` });
    if (weatherPts) reasons.push({ kind: 'road', icon: '🌧️', text: `Heavy rain ${w.mm3h >= num(s.rain_heavy_mm3h, 10) ? 'expected (' + Math.round(w.mm3h) + ' mm in 3 h)' : 'falling now'} — flooding possible on low roads` });
    if (confirmedPost) reasons.push({ kind: confirmedPost.d <= 10 ? 'good' : 'info', icon: '👮', text: `Nearest confirmed security post: ${confirmedPost.place.name}, ${confirmedPost.d < 1 ? Math.round(confirmedPost.d * 1000) + ' m' : confirmedPost.d.toFixed(1) + ' km'}` });
    else if (post) reasons.push({ kind: 'info', icon: '👮', text: `Nearest security post: ${post.place.name}, ${post.d.toFixed(1)} km (operating status not confirmed recently)` });
    else reasons.push({ kind: 'info', icon: '👮', text: 'No security post recorded within reach' });
    if (tm > 1 && (zone.type === 'forest' || zone.type === 'rural') && (threat + hist > 0)) reasons.push({ kind: 'info', icon: '🌲', text: 'Isolated stretch after dark — fewer people around to help' });
    if (disputed) reasons.push({ kind: 'info', icon: '❓', text: `${plural(disputed, 'report')} nearby marked as possibly inaccurate by other users` });
    if (threatW === 0 && hist === 0 && coverage < 5) reasons.push({ kind: 'info', icon: 'ℹ️', text: 'Few reports from this area — no warning is not proof of safety' });

    // ---- recommended action ----
    let action;
    const roadTop = typeOrder.find(k => T[k].grp === 'road');
    if (secLevel === 3) action = 'Avoid this area if you can. If you must travel, go in daylight, in company, and do not stop. Keep your SOS ready.';
    else if (secLevel === 2) action = 'Consider an alternative route and avoid unnecessary stops on this stretch.';
    else if (roadLevel >= 2) action = `Expect delays or danger on the road${roadTop ? ' (' + T[roadTop].label.toLowerCase() + ')' : ''}. Slow down and consider a detour.`;
    else if (secLevel === 1) action = 'Stay alert, keep doors locked and avoid stopping in isolated places.';
    else if (roadLevel === 1) action = 'Drive with care — road hazards reported nearby.';
    else action = 'No significant reported threats. Travel with normal care.';

    return {
      level, levelName: LEVELS[level].name, hex: LEVELS[level].hex,
      security: { score: secScore, level: secLevel, confidence: secConf, confLabel: confLabel(secConf) },
      road: { score: roadScore, level: roadLevel, confidence: roadConf, confLabel: confLabel(roadConf) },
      confidence, confLabel: confLabel(confidence),
      reasons, action, zone, post, confirmedPost, near,
      parts: { incidents: Math.round(threat), history: Math.round(hist), pattern: Math.round(pattern), time: tm, presence, context: Math.round(context), road: Math.round(road), weather: weatherPts },
      R: Math.max(secScore, roadScore)
    };
  }

  /**
   * Assess a whole journey.
   * @param coords      [[lat,lng], ...] route geometry
   * @param departHour  local hour of departure
   * @param durationS   expected travel time in seconds
   * @param data, opts  as for assess(); opts.weatherAt(p) may return weather for a point
   */
  function assessRoute(coords, departHour, durationS, data, opts) {
    opts = opts || {};
    // cumulative distance
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + km(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1] || 0.001;
    const step = Math.max(0.5, Math.min(2, total / 150));
    const samples = [];
    let j = 0;
    for (let x = 0; x <= total + 1e-9; x += step) {
      while (j < cum.length - 2 && cum[j + 1] < x) j++;
      const seg = cum[j + 1] - cum[j] || 1, f = Math.min(1, Math.max(0, (x - cum[j]) / seg));
      const p = [coords[j][0] + (coords[j + 1 < coords.length ? j + 1 : j][0] - coords[j][0]) * f, coords[j][1] + (coords[j + 1 < coords.length ? j + 1 : j][1] - coords[j][1]) * f];
      const hour = departHour + (x / total) * (durationS / 3600);
      const a = assess(p, hour, data, { ...opts, weather: opts.weatherAt ? opts.weatherAt(p) : null });
      samples.push({ km: x, p, hour, a });
    }
    // stretches of Moderate or worse
    const stretches = [];
    let cur = null;
    for (const s of samples) {
      if (s.a.level >= 1) {
        if (!cur) cur = { startKm: s.km, endKm: s.km, level: s.a.level, secLevel: s.a.security.level, roadLevel: s.a.road.level, worst: s, conf: [] };
        cur.endKm = s.km; cur.conf.push(s.a.confidence);
        if (s.a.R > cur.worst.a.R) cur.worst = s;
        cur.level = Math.max(cur.level, s.a.level); cur.secLevel = Math.max(cur.secLevel, s.a.security.level); cur.roadLevel = Math.max(cur.roadLevel, s.a.road.level);
      } else if (cur) { stretches.push(cur); cur = null; }
    }
    if (cur) stretches.push(cur);
    stretches.forEach(st => {
      st.lengthKm = Math.max(step, st.endKm - st.startKm);
      st.confidence = st.conf.reduce((a, b) => a + b, 0) / st.conf.length;
      st.confLabel = confLabel(st.confidence);
      st.reasons = st.worst.a.reasons.filter(r => r.kind === 'threat' || r.kind === 'road').slice(0, 3);
      st.action = st.worst.a.action;
      st.atHour = st.worst.hour;
      delete st.conf;
    });
    const kmAt = lv => samples.filter(s => s.a.level >= lv).length * step;
    const worst = samples.reduce((m, s) => Math.max(m, s.a.level), 0);
    // reports and places near the route
    const nearRoute = (lat, lng, maxKm) => { let best = Infinity, at = 0; for (const s of samples) { const d = km(s.p, [lat, lng]); if (d < best) { best = d; at = s.km; } } return best <= maxKm ? { d: best, at } : null; };
    const now = opts.now || Date.now();
    const incidents = [], hazards = [];
    for (const r of data.reports || []) {
      if (!isActive(r, now)) continue;
      const t = (data.types || {})[r.type]; if (!t) continue;
      const n = nearRoute(r.lat, r.lng, Math.max(1, t.radius_km * 0.6)); if (!n) continue;
      (t.grp === 'security' ? incidents : hazards).push({ report: r, atKm: n.at, offKm: n.d });
    }
    incidents.sort((a, b) => a.atKm - b.atKm); hazards.sort((a, b) => a.atKm - b.atKm);
    const levelAtKm = x => { const s = samples[Math.min(samples.length - 1, Math.round(x / step))]; return s ? s.a.level : 0; };
    const help = [], stops = [];
    for (const pl of data.places || []) {
      const n = nearRoute(pl.lat, pl.lng, 3); if (!n) continue;
      const item = { place: pl, atKm: n.at, offKm: n.d, level: levelAtKm(n.at) };
      if (SECURITY_CATS.includes(pl.category) || pl.category === 'hospital' || pl.category === 'clinic') help.push(item);
      if (item.level === 0 && ['police', 'frsc', 'military', 'nscdc', 'fuel', 'hospital'].includes(pl.category)) stops.push(item);
    }
    help.sort((a, b) => a.atKm - b.atKm); stops.sort((a, b) => a.atKm - b.atKm);
    const confs = samples.map(s => s.a.confidence);
    const confidence = confs.reduce((a, b) => a + b, 0) / (confs.length || 1);
    // single number used only to compare routes (minutes-equivalent)
    const burden = Math.round(kmAt(1) * 0.5 + kmAt(2) * 3 + kmAt(3) * 8);
    return {
      totalKm: total, samples, stretches, worst, worstName: LEVELS[worst].name,
      moderateKm: kmAt(1), highKm: kmAt(2), severeKm: kmAt(3), burden,
      incidents, hazards, help, stops, confidence, confLabel: confLabel(confidence)
    };
  }

  return { assess, assessRoute, km, nearest, zoneAt, timeLabel, timeMult, confLabel, LEVELS, SECURITY_CATS, SETTLE_LABEL, isActive };
});
