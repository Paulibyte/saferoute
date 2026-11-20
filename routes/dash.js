// Command dashboard API (/api/dash/*). Staff only: admins and moderators see the whole country;
// security partners see their agency's jurisdiction (states / LGAs) when one is set.
// Counts always keep three layers apart and never present community reports as confirmed incidents:
//   community = reports from the public not (yet) verified · verified = independently verified by SafeRoute moderators
//   official  = recorded or confirmed by a verified security agency account
module.exports = function (app, ctx) {
  const { db, Geo, need, fail, clean, setting, typesObj, enrich, activeReports, isStaff, isAdmin, isModerator, isSecurity, REPORT_COLS, REPORT_FROM, H, now } = ctx;
  const D = 24 * H;
  const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const staff = need(isStaff, 'Staff accounts only');
  const admin = need(isAdmin, 'Admins only');
  const tz = () => setting('tz_offset_hours', 1) * 3600;
  const LAYER = `CASE WHEN r.official=1 THEN 'official' WHEN r.verified_by IS NOT NULL THEN 'verified' ELSE 'community' END`;
  const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const round1 = x => x == null ? null : Math.round(x * 10) / 10;

  // ---------- jurisdiction scope ----------
  function scopeOf(user) {
    if (isAdmin(user) || isModerator(user)) return null;
    const org = user.org_id && db.prepare(`SELECT jurisdiction FROM organisations WHERE id=?`).get(user.org_id);
    const j = org && J(org.jurisdiction);
    if (!j || (!(j.states || []).length && !(j.lgas || []).length)) return null;
    return { states: j.states || [], lgas: (j.lgas || []).map(Number) };
  }
  // WHERE fragment for a table alias honouring scope + optional state / lga filters
  function where(alias, req, extra) {
    const parts = [], args = [];
    const sc = scopeOf(req.user);
    if (sc) {
      const ors = [];
      if (sc.states.length) { ors.push(`${alias}.state IN (${sc.states.map(() => '?').join(',')})`); args.push(...sc.states); }
      if (sc.lgas.length) { ors.push(`${alias}.lga_id IN (${sc.lgas.map(() => '?').join(',')})`); args.push(...sc.lgas); }
      parts.push('(' + ors.join(' OR ') + ')');
    }
    const st = clean(req.query.state, 40), lga = +req.query.lga;
    if (st) { parts.push(`${alias}.state=?`); args.push(st); }
    if (lga) { parts.push(`${alias}.lga_id=?`); args.push(lga); }
    if (extra) parts.push(extra);
    return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', args };
  }
  const inScope = (req, row) => { const sc = scopeOf(req.user); return !sc || sc.states.includes(row.state) || sc.lgas.includes(+row.lga_id); };
  const daysOf = req => [7, 30, 90, 180, 365].includes(+req.query.days) ? +req.query.days : 30;
  function typeFilter(req) {
    const T = typesObj(), g = clean(req.query.grp || req.query.type, 20);
    if (!g || g === 'all') return { sql: '', args: [] };
    const keys = g === 'security' || g === 'road' || g === 'info' ? Object.values(T).filter(t => t.grp === g).map(t => t.key) : T[g] ? [g] : [];
    return keys.length ? { sql: ` AND r.type IN (${keys.map(() => '?').join(',')})`, args: keys } : { sql: '', args: [] };
  }

  app.get('/api/dash/me', staff, (req, res) => {
    const u = req.user, org = u.org_id ? db.prepare(`SELECT id,name,type FROM organisations WHERE id=?`).get(u.org_id) : null;
    res.json({ user: { id: u.id, name: u.name, role: u.role, security: isSecurity(u), moderator: isModerator(u), admin: isAdmin(u), org, org_role: u.org_role },
      scope: scopeOf(u), states: Geo.STATES, source: Geo.source });
  });
  app.get('/api/dash/lgas', staff, (req, res) => res.json(Geo.lgasOf(clean(req.query.state, 40)).map(l => ({ id: l.id, name: l.name, c: l.c }))));

  // ---------- national / state / LGA overview ----------
  app.get('/api/dash/overview', staff, (req, res) => {
    const days = daysOf(req), since = now() - days * D, w = where('r', req), tf = typeFilter(req);
    const base = `FROM reports r WHERE r.status!='rejected' AND r.created_at>?${w.sql}${tf.sql}`, args = [since, ...w.args, ...tf.args];
    const totals = { community: 0, verified: 0, official: 0 };
    db.prepare(`SELECT ${LAYER} AS layer, COUNT(*) n ${base} GROUP BY layer`).all(...args).forEach(r => { totals[r.layer] = r.n; });
    const byType = db.prepare(`SELECT r.type, ${LAYER} AS layer, COUNT(*) n ${base} GROUP BY r.type, layer`).all(...args);
    const trend = db.prepare(`SELECT date((r.created_at/1000)+${tz()}, 'unixepoch') AS day, ${LAYER} AS layer, COUNT(*) n ${base} GROUP BY day, layer ORDER BY day`).all(...args);
    // geographic breakdown one level below the current one
    const level = +req.query.lga ? 'locality' : clean(req.query.state, 40) ? 'lga' : 'state';
    const key = level === 'state' ? 'r.state' : level === 'lga' ? 'r.lga_id' : "COALESCE(r.locality,'Other locations')";
    const label = level === 'state' ? 'r.state' : level === 'lga' ? 'r.lga' : "COALESCE(r.locality,'Other locations')";
    const areas = {};
    db.prepare(`SELECT ${key} AS k, ${label} AS name, ${LAYER} AS layer, COUNT(*) n ${base} AND ${key} IS NOT NULL AND (r.lga_id IS NULL OR r.lga_id>0) GROUP BY k, layer`).all(...args).forEach(r => {
      const a = areas[r.k] = areas[r.k] || { key: r.k, name: r.name, community: 0, verified: 0, official: 0, sos: 0 }; a[r.layer] = r.n; });
    const ws = where('s', req);
    const sosKey = level === 'state' ? 's.state' : level === 'lga' ? 's.lga_id' : "COALESCE(s.locality,'Other locations')";
    db.prepare(`SELECT ${sosKey} AS k, ${level === 'state' ? 's.state' : level === 'lga' ? 's.lga' : "COALESCE(s.locality,'Other locations')"} AS name, COUNT(*) n FROM sos s WHERE s.created_at>?${ws.sql} AND ${sosKey} IS NOT NULL GROUP BY k`).all(since, ...ws.args)
      .forEach(r => { const a = areas[r.k] = areas[r.k] || { key: r.k, name: r.name, community: 0, verified: 0, official: 0, sos: 0 }; a.sos = r.n; });
    const sos = { open: db.prepare(`SELECT COUNT(*) n FROM sos s WHERE (s.status!='closed' OR s.duress=1 AND s.status!='closed')${ws.sql}`).get(...ws.args).n,
      period: db.prepare(`SELECT COUNT(*) n FROM sos s WHERE s.created_at>?${ws.sql}`).get(since, ...ws.args).n };
    const acks = sosResponse(since, req).map(x => x.ack_min).filter(x => x != null);
    sos.median_ack_min = round1(median(acks));
    const pending = db.prepare(`SELECT COUNT(*) n FROM reports r WHERE r.status IN ('unverified','investigating')${w.sql}`).get(...w.args).n;
    const wp = where('p', req);
    const fac = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN p.last_confirmed_at>? THEN 1 ELSE 0 END) v FROM places p WHERE 1=1${wp.sql}`).get(now() - setting('facility_verify_days', 365) * D, ...wp.args);
    let incidents = null, facilities = null;
    if (+req.query.lga) {
      incidents = db.prepare(`SELECT r.id, r.type, r.status, r.official, r.verified_by IS NOT NULL AS verified, r.locality, r.lat, r.lng, r.created_at, r.note FROM reports r WHERE r.status!='rejected' AND r.created_at>?${w.sql}${tf.sql} ORDER BY r.created_at DESC LIMIT 200`).all(since, ...w.args, ...tf.args);
      facilities = db.prepare(`SELECT p.id, p.category, p.name, p.lat, p.lng, p.phone, p.last_confirmed_at, p.locality FROM places p WHERE 1=1${wp.sql}`).all(...wp.args);
    }
    res.json({ days, level, totals, byType, trend, areas: Object.values(areas).sort((a, b) => (b.verified + b.official) - (a.verified + a.official) || b.community - a.community),
      sos, pending, facilities_total: fac.n, facilities_verified: fac.v || 0, incidents, facilities, lga: +req.query.lga ? Geo.lgaById(+req.query.lga) && { id: +req.query.lga, name: Geo.lgaById(+req.query.lga).name, c: Geo.lgaById(+req.query.lga).c } : null });
  });

  // ---------- live incident map ----------
  app.get('/api/dash/live', staff, (req, res) => {
    const T = typesObj();
    const reports = activeReports().filter(r => inScope(req, r) && (!req.query.state || r.state === req.query.state)).map(r => ({
      id: r.id, type: r.type, lat: r.lat, lng: r.lng, status: r.status, official: r.official, layer: r.official ? 'official' : r.verified_by != null ? 'verified' : 'community',
      confidence: r.confidence, confLabel: r.confLabel, public: r.status !== 'unverified' || (T[r.type] && T[r.type].grp === 'security' ? r.confidence >= setting('public_min_confidence', 0.45) : r.confidence >= 0.25),
      note: r.note, created_at: r.created_at, state: r.state, lga: r.lga, locality: r.locality, responding: !!r.responding_by, injured: r.injured, trapped: r.trapped }));
    const ws = where('s', req);
    const sos = db.prepare(`SELECT s.id, s.ref, s.type, s.status, s.duress, s.lat, s.lng, s.state, s.lga, s.created_at, s.updated_at, s.escalation_level, u.name FROM sos s LEFT JOIN users u ON u.id=s.user_id
      WHERE s.status!='closed'${ws.sql}`).all(...ws.args);
    res.json({ reports, sos, at: now() });
  });

  // ---------- SOS command centre ----------
  function sosResponse(since, req) {
    const ws = where('s', req);
    const rows = db.prepare(`SELECT s.id, s.created_at, s.state, s.lga, s.lga_id, s.status, s.closed_reason FROM sos s WHERE s.created_at>?${ws.sql}`).all(since, ...ws.args);
    const ev = db.prepare(`SELECT kind, at FROM sos_events WHERE sos_id=? AND kind IN ('acknowledged','responding','on_scene','closed') ORDER BY at`);
    return rows.map(s => {
      const e = ev.all(s.id);
      const ack = e.find(x => x.kind !== 'closed'), scene = e.find(x => x.kind === 'on_scene');
      return { ...s, ack_min: ack ? (ack.at - s.created_at) / 60000 : null, scene_min: scene ? (scene.at - s.created_at) / 60000 : null };
    });
  }
  app.get('/api/dash/sos', staff, (req, res) => {
    const ws = where('s', req);
    const list = db.prepare(`SELECT s.*, u.name, u.phone, sh.token, o.name AS org_name, au.name AS assignee FROM sos s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN shares sh ON sh.id=s.share_id
      LEFT JOIN organisations o ON o.id=s.assigned_org LEFT JOIN users au ON au.id=s.assigned_user
      WHERE (s.status!='closed' OR s.updated_at>?)${ws.sql} ORDER BY (s.status='closed'), s.escalation_level DESC, s.created_at DESC LIMIT 150`).all(now() - D, ...ws.args);
    const ev = db.prepare(`SELECT kind,text,at FROM sos_events WHERE sos_id=? ORDER BY at`);
    const notes = db.prepare(`SELECT n.text, n.at, u.name FROM staff_notes n JOIN users u ON u.id=n.user_id WHERE n.target_type='sos' AND n.target_id=? ORDER BY n.at`);
    const jobs = db.prepare(`SELECT channel, status, COUNT(*) n FROM notif_jobs WHERE kind='sos' AND ref_id=? GROUP BY channel, status`);
    const trail = db.prepare(`SELECT lat,lng,at FROM track_points WHERE share_id=? ORDER BY at DESC LIMIT 40`);
    res.json(list.map(s => {
      const e = ev.all(s.id), ack = e.find(x => ['acknowledged', 'responding', 'on_scene'].includes(x.kind));
      const d = {}; jobs.all(s.id).forEach(j => { d[j.channel] = d[j.channel] || {}; d[j.channel][j.status] = j.n; });
      return { id: s.id, ref: s.ref, type: s.type, status: s.status, duress: s.duress, lat: s.lat, lng: s.lng, state: s.state, lga: s.lga, locality: s.locality, name: s.name, phone: s.phone,
        created_at: s.created_at, updated_at: s.updated_at, escalation_level: s.escalation_level, closed_reason: s.closed_reason, fleet_id: s.fleet_id,
        assigned_org: s.assigned_org, org_name: s.org_name, assigned_user: s.assigned_user, assignee: s.assignee, url: s.token ? `/t/${s.token}` : null,
        ack_min: ack ? Math.round((ack.at - s.created_at) / 6000) / 10 : null, events: e, notes: notes.all(s.id), delivery: d, trail: s.share_id ? trail.all(s.share_id).reverse() : [] };
    }));
  });
  app.get('/api/dash/responders', staff, (req, res) => {
    res.json(db.prepare(`SELECT u.id, u.name, u.phone, u.org_id, o.name AS org_name, u.base_lat, u.base_lng FROM users u LEFT JOIN organisations o ON o.id=u.org_id
      WHERE u.banned=0 AND u.role='security' AND u.security_status='verified' ORDER BY o.name, u.name`).all());
  });

  // ---------- security intelligence ----------
  app.get('/api/dash/intel', staff, (req, res) => {
    const days = daysOf(req), t1 = now() - days * D, t0 = now() - 2 * days * D;
    const w = where('r', req), tf = typeFilter(req);
    const lvl = clean(req.query.state, 40) ? 'lga' : 'lga';
    const rows = db.prepare(`SELECT r.lga_id AS id, r.lga AS name, r.state, ${LAYER} AS layer, CASE WHEN r.created_at>? THEN 'cur' ELSE 'prev' END AS period, COUNT(*) n
      FROM reports r WHERE r.status!='rejected' AND r.created_at>? AND r.lga_id>0${w.sql}${tf.sql} GROUP BY r.lga_id, layer, period`).all(t1, t0, ...w.args, ...tf.args);
    const areas = {};
    for (const r of rows) {
      const a = areas[r.id] = areas[r.id] || { id: r.id, name: r.name, state: r.state, cur: 0, prev: 0, community_cur: 0, community_prev: 0, official_cur: 0 };
      if (r.layer === 'community') a['community_' + r.period] += r.n; else { a[r.period] += r.n; if (r.layer === 'official' && r.period === 'cur') a.official_cur += r.n; }
    }
    const list = Object.values(areas);
    list.forEach(a => { a.change = a.prev ? Math.round((a.cur - a.prev) / a.prev * 100) : a.cur ? null : 0; });
    const hotspots = list.filter(a => a.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, 25);
    const rising = list.filter(a => a.cur >= 2 && a.cur >= a.prev * 1.5 && a.cur > a.prev).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev)).slice(0, 20);
    const needsVerification = list.filter(a => a.community_cur >= 3 && a.community_cur > a.cur).sort((a, b) => b.community_cur - a.community_cur).slice(0, 20);
    const confirmed = db.prepare(`SELECT r.created_at, r.locality, r.lga, r.state FROM reports r WHERE r.status!='rejected' AND (r.official=1 OR r.verified_by IS NOT NULL) AND r.created_at>?${w.sql}${tf.sql}`).all(t1, ...w.args, ...tf.args);
    const hours = Array(24).fill(0), week = Array(7).fill(0), loc = {};
    for (const r of confirmed) {
      const d = new Date(r.created_at + tz() * 1000);
      hours[d.getUTCHours()]++; week[d.getUTCDay()]++;
      if (r.locality) { const k = `${r.locality} · ${r.lga || ''}`; loc[k] = (loc[k] || 0) + 1; }
    }
    res.json({ days, hotspots, rising, needsVerification, hours, week, localities: Object.entries(loc).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 15), confirmed_total: confirmed.length });
  });

  // ---------- report verification ----------
  app.get('/api/dash/reports', staff, (req, res) => {
    const w = where('r', req), tf = typeFilter(req), status = clean(req.query.status, 20), q = clean(req.query.q, 60);
    const extra = [], args = [];
    if (status === 'queue') extra.push(`r.status IN ('unverified','investigating')`);
    else if (status) { extra.push('r.status=?'); args.push(status); }
    if (q) { extra.push(`(r.note LIKE ? OR r.locality LIKE ? OR r.lga LIKE ? OR u.name LIKE ?)`); args.push(...Array(4).fill('%' + q + '%')); }
    const rows = db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.created_at>?${w.sql}${tf.sql}${extra.length ? ' AND ' + extra.join(' AND ') : ''} ORDER BY r.created_at DESC LIMIT 300`)
      .all(now() - daysOf(req) * D, ...w.args, ...tf.args, ...args);
    enrich(rows, activeReports());
    res.json(rows.map(r => ({ id: r.id, type: r.type, status: r.status, official: r.official, layer: r.official ? 'official' : r.verified_by != null ? 'verified' : 'community', lat: r.lat, lng: r.lng,
      note: r.note, created_at: r.created_at, occurred_at: r.occurred_at, state: r.state, lga: r.lga, locality: r.locality, confidence: r.confidence, confLabel: r.confLabel, disputed: r.disputed || 0,
      counts: r.counts, corroborations: r.corroborations, by_name: r.by_name, reporter_trust: r.reporter_trust, has_media: !!r.photo, injured: r.injured, trapped: r.trapped, ongoing: r.ongoing })));
  });
  app.get('/api/dash/reports/:id', staff, (req, res) => {
    const r = db.prepare(`SELECT ${REPORT_COLS} ${REPORT_FROM} WHERE r.id=?`).get(+req.params.id);
    if (!r || !inScope(req, r)) return fail(res, 404, 'Report not found');
    enrich([r], activeReports());
    const confirmations = db.prepare(`SELECT c.kind, c.distance_km, c.created_at, u.name, u.trust, u.created_at AS user_since FROM confirmations c JOIN users u ON u.id=c.user_id WHERE c.report_id=? ORDER BY c.created_at`).all(r.id);
    const nearby = db.prepare(`SELECT r.id, r.type, r.status, r.official, r.verified_by IS NOT NULL AS verified, r.lat, r.lng, r.created_at, r.user_id FROM reports r
      WHERE r.id!=? AND r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ? AND r.created_at BETWEEN ? AND ?`).all(r.id, r.lat - 0.03, r.lat + 0.03, r.lng - 0.03, r.lng + 0.03, r.created_at - D, r.created_at + D)
      .map(x => ({ ...x, same_reporter: x.user_id === r.user_id, user_id: undefined }));
    const reporter = r.user_id ? db.prepare(`SELECT u.name, u.trust, u.trusted, u.created_at, (SELECT COUNT(*) FROM reports WHERE user_id=u.id) total,
      (SELECT COUNT(*) FROM reports WHERE user_id=u.id AND (verified_by IS NOT NULL OR official=1)) verified, (SELECT COUNT(*) FROM reports WHERE user_id=u.id AND status='rejected') rejected FROM users u WHERE u.id=?`).get(r.user_id) : null;
    const notes = db.prepare(`SELECT n.text, n.at, u.name FROM staff_notes n JOIN users u ON u.id=n.user_id WHERE n.target_type='report' AND n.target_id=? ORDER BY n.at`).all(r.id);
    const history = db.prepare(`SELECT a.action, a.at, u.name, a.detail FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.target_type='report' AND a.target_id=? ORDER BY a.at`).all(r.id);
    res.json({ report: { id: r.id, type: r.type, status: r.status, official: r.official, layer: r.official ? 'official' : r.verified_by != null ? 'verified' : 'community', lat: r.lat, lng: r.lng, note: r.note,
      created_at: r.created_at, occurred_at: r.occurred_at, expires_at: r.expires_at, state: r.state, lga: r.lga, locality: r.locality, source: r.source, ongoing: r.ongoing, injured: r.injured, trapped: r.trapped,
      affected: r.affected, confidence: r.confidence, confLabel: r.confLabel, disputed: r.disputed || 0, counts: r.counts, corroborations: r.corroborations, media: r.photo ? '/media/' + r.photo : null,
      media_type: r.media_type, media_public: r.media_public, status_note: r.status_note, responding: !!r.responding_by, org_name: r.org_name },
      confirmations, nearby, reporter, notes, history });
  });

  // ---------- agencies ----------
  app.get('/api/dash/orgs', admin, (req, res) => {
    res.json(db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.org_id=o.id AND u.security_status='verified') officers,
      (SELECT COUNT(*) FROM users u WHERE u.org_id=o.id AND u.security_status='pending') pending FROM organisations o ORDER BY o.name`).all().map(o => ({ ...o, jurisdiction: J(o.jurisdiction) || { states: [], lgas: [] } })));
  });
  app.put('/api/dash/orgs/:id/jurisdiction', admin, (req, res) => {
    const states = (req.body.states || []).filter(s => Geo.STATES.includes(s)), lgas = (req.body.lgas || []).map(Number).filter(id => Geo.lgaById(id));
    db.prepare(`UPDATE organisations SET jurisdiction=? WHERE id=?`).run(JSON.stringify({ states, lgas }), +req.params.id);
    ctx.Sec.audit(req, 'org_jurisdiction', 'org', +req.params.id, { states, lgas });
    res.json({ ok: true });
  });

  // ---------- emergency facilities ----------
  const FAC_GROUPS = { security: ['police', 'frsc', 'military', 'nscdc', 'community'], health: ['hospital', 'clinic'], fire: ['fire'], ambulance: ['ambulance'], sema: ['sema'], road: ['mechanic', 'vulcaniser', 'fuel'] };
  app.get('/api/dash/facilities', staff, (req, res) => {
    const w = where('p', req), cat = clean(req.query.cat, 20), q = clean(req.query.q, 60), extra = [], args = [];
    if (cat && FAC_GROUPS[cat]) { extra.push(`p.category IN (${FAC_GROUPS[cat].map(() => '?').join(',')})`); args.push(...FAC_GROUPS[cat]); }
    else if (cat) { extra.push('p.category=?'); args.push(cat); }
    if (q) { extra.push('(p.name LIKE ? OR p.address LIKE ? OR p.lga LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
    if (req.query.unverified === '1') { extra.push('(p.last_confirmed_at IS NULL OR p.last_confirmed_at<?)'); args.push(now() - setting('facility_verify_days', 365) * D); }
    res.json(db.prepare(`SELECT p.* FROM places p WHERE 1=1${w.sql}${extra.length ? ' AND ' + extra.join(' AND ') : ''} ORDER BY p.state, p.lga, p.name LIMIT 1000`).all(...w.args, ...args));
  });
  // areas with too few verified facilities
  app.get('/api/dash/coverage', staff, (req, res) => {
    const st = clean(req.query.state, 40), fresh = now() - setting('facility_verify_days', 365) * D;
    const areas = st ? Geo.lgasOf(st).map(l => ({ key: l.id, name: l.name, state: l.state })) : Geo.STATES.map(s => ({ key: s, name: s }));
    const col = st ? 'lga_id' : 'state';
    const rows = db.prepare(`SELECT ${col} AS k, category, COUNT(*) n, SUM(CASE WHEN last_confirmed_at>? THEN 1 ELSE 0 END) v FROM places WHERE ${st ? 'state=?' : '1=1'} GROUP BY k, category`).all(...(st ? [fresh, st] : [fresh]));
    const sc = scopeOf(req.user);
    const out = areas.filter(a => !sc || (st ? (sc.states.includes(st) || sc.lgas.includes(a.key)) : sc.states.includes(a.key) || sc.lgas.some(id => (Geo.lgaById(id) || {}).state === a.key))).map(a => {
      const o = { ...a, total: 0 }; for (const g of Object.keys(FAC_GROUPS)) { o[g] = 0; o[g + '_all'] = 0; }
      rows.filter(r => r.k === a.key).forEach(r => { o.total += r.n; for (const [g, cats] of Object.entries(FAC_GROUPS)) if (cats.includes(r.category)) { o[g] += r.v; o[g + '_all'] += r.n; } });
      o.gaps = ['security', 'health', 'fire', 'ambulance'].filter(g => !o[g]);
      return o;
    });
    res.json(out.sort((a, b) => b.gaps.length - a.gaps.length || a.name.localeCompare(b.name)));
  });

  // ---------- users ----------
  app.get('/api/dash/users', admin, (req, res) => {
    const q = clean(req.query.q, 60), role = clean(req.query.role, 20), extra = [], args = [];
    if (q) { extra.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); args.push(...Array(3).fill('%' + q + '%')); }
    if (role === 'pending') extra.push(`u.security_status='pending'`); else if (role) { extra.push('u.role=?'); args.push(role); }
    res.json(db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.security_status,u.agency,u.banned,u.trust,u.trusted,u.totp_enabled,u.org_id,u.org_role,u.created_at,o.name AS org_name,
      (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id=u.id) AS last_seen, (SELECT COUNT(*) FROM reports WHERE user_id=u.id) AS reports
      FROM users u LEFT JOIN organisations o ON o.id=u.org_id ${extra.length ? 'WHERE ' + extra.join(' AND ') : ''} ORDER BY (u.security_status='pending') DESC, u.created_at DESC LIMIT 500`).all(...args));
  });

  // ---------- analytics ----------
  function analytics(req) {
    const days = daysOf(req), since = now() - days * D, st = clean(req.query.state, 40);
    const w = where('r', req);
    const areaKey = st ? 'r.lga' : 'r.state';
    const T = typesObj(), sec = Object.values(T).filter(t => t.grp === 'security').map(t => t.key);
    const by = (extraSql, extraArgs) => {
      const m = {};
      db.prepare(`SELECT ${areaKey} AS area, ${LAYER} AS layer, COUNT(*) n FROM reports r WHERE r.status!='rejected' AND r.created_at>? AND ${areaKey} IS NOT NULL${w.sql}${extraSql} GROUP BY area, layer`).all(since, ...w.args, ...extraArgs)
        .forEach(r => { const a = m[r.area] = m[r.area] || { area: r.area, community: 0, verified: 0, official: 0 }; a[r.layer] = r.n; });
      return Object.values(m).sort((a, b) => (b.verified + b.official) - (a.verified + a.official) || b.community - a.community);
    };
    const by_area = by(` AND r.type IN (${sec.map(() => '?').join(',')})`, sec);
    const kidnap = by(` AND r.type='kidnap'`, []);
    const robbery = by(` AND r.type IN ('robbery','attack')`, []);
    const floods = (() => {
      const m = {};
      db.prepare(`SELECT r.lga AS lga, r.state, COALESCE(r.locality,'') AS locality, ${LAYER} AS layer, COUNT(*) n FROM reports r WHERE r.type='flood' AND r.status!='rejected' AND r.created_at>? AND r.lga IS NOT NULL${w.sql} GROUP BY r.lga, r.locality, layer`).all(since, ...w.args)
        .forEach(r => { const k = r.lga + '|' + r.locality; const a = m[k] = m[k] || { lga: r.lga, state: r.state, place: r.locality || '(unnamed)', community_reports: 0, verified: 0, official: 0 }; if (r.layer === 'community') a.community_reports += r.n; else a[r.layer] += r.n; });
      return Object.values(m).sort((a, b) => (b.verified + b.official) - (a.verified + a.official) || b.community_reports - a.community_reports);
    })();
    const resp = sosResponse(since, req);
    const ackAll = resp.map(x => x.ack_min).filter(x => x != null), sceneAll = resp.map(x => x.scene_min).filter(x => x != null);
    const respBy = {};
    resp.forEach(x => { const k = (st ? x.lga : x.state) || 'Unknown'; const a = respBy[k] = respBy[k] || { area: k, sos: 0, ack: [], scene: [], unacked: 0, false_alarm: 0 }; a.sos++; if (x.ack_min != null) a.ack.push(x.ack_min); else if (x.status !== 'closed') a.unacked++; if (x.scene_min != null) a.scene.push(x.scene_min); if (x.closed_reason === 'false_alarm') a.false_alarm++; });
    const response = { sos: resp.length, acknowledged: ackAll.length, median_ack_min: round1(median(ackAll)), p90_ack_min: round1(pct(ackAll, 0.9)), median_scene_min: round1(median(sceneAll)), p90_scene_min: round1(pct(sceneAll, 0.9)),
      by_area: Object.values(respBy).map(a => ({ area: a.area, sos: a.sos, unacknowledged: a.unacked, false_alarms: a.false_alarm, median_ack_min: round1(median(a.ack)), median_scene_min: round1(median(a.scene)) })).sort((a, b) => b.sos - a.sos) };
    const ver = db.prepare(`SELECT r.created_at, r.moderated_at, r.status, r.official, r.verified_by FROM reports r WHERE r.created_at>? AND r.user_id IS NOT NULL AND r.user_id != COALESCE(r.verified_by,-1)${w.sql}`).all(since, ...w.args);
    const vt = ver.filter(r => r.verified_by != null && r.moderated_at).map(r => (r.moderated_at - r.created_at) / H);
    const verification = { reports: ver.length, verified: ver.filter(r => r.verified_by != null || r.official).length, rejected: ver.filter(r => r.status === 'rejected').length,
      pending: ver.filter(r => r.status === 'unverified' || r.status === 'investigating').length, median_hours: round1(median(vt)), p90_hours: round1(pct(vt, 0.9)) };
    const notif = {};
    db.prepare(`SELECT channel, status, COUNT(*) n FROM notif_jobs WHERE created_at>? AND (error IS NULL OR error NOT LIKE 'no device%') GROUP BY channel, status`).all(since).forEach(r => { notif[r.channel] = notif[r.channel] || {}; notif[r.channel][r.status] = r.n; });
    const journeys = db.prepare(`SELECT COUNT(*) n, SUM(status='arrived') arrived, SUM(id IN (SELECT journey_id FROM journey_events WHERE kind='missed_checkin')) missed FROM journeys WHERE started_at>?`).get(since);
    return { days, level: st ? 'lga' : 'state', by_area, kidnap, robbery, floods, response, verification, notifications: notif, journeys };
  }
  app.get('/api/dash/analytics', staff, (req, res) => {
    const a = analytics(req);
    if (req.query.format !== 'csv') return res.json(a);
    const table = clean(req.query.table, 20);
    const rows = table === 'kidnap' ? a.kidnap : table === 'robbery' ? a.robbery : table === 'floods' ? a.floods : table === 'response' ? a.response.by_area : a.by_area;
    const cols = rows.length ? Object.keys(rows[0]) : ['area', 'community', 'verified', 'official'];
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = table === 'response' ? '' : '# community = unverified public reports (not confirmed); verified = verified by SafeRoute moderators; official = recorded by verified security agencies\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saferoute-${table || 'security'}-${a.level}-${a.days}d-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(head + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
  });

  // ---------- audit log (admins) ----------
  app.get('/api/dash/audit', admin, (req, res) => {
    const q = clean(req.query.q, 60), args = [];
    let sql = `SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id`;
    if (q) { sql += ` WHERE a.action LIKE ? OR u.name LIKE ? OR a.target_type LIKE ?`; args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
    res.json(db.prepare(sql + ` ORDER BY a.at DESC LIMIT 500`).all(...args));
  });
};
