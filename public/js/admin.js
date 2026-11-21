/* SafeRoute Command Centre — operations and intelligence dashboard for administrators and authorised security partners */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => n == null ? '—' : Number(n).toLocaleString();
const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const when = ms => ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const dur = min => min == null ? '—' : min < 60 ? Math.round(min) + ' min' : (min / 60).toFixed(1) + ' h';
const LAYERS = { community: { label: 'Community reports', short: 'Community', color: '#94a3b8', note: 'unverified — not confirmed' }, verified: { label: 'Verified incidents', short: 'Verified', color: '#f59e0b', note: 'verified by SafeRoute moderators' }, official: { label: 'Official agency records', short: 'Official', color: '#3b82f6', note: 'recorded by verified security agencies' } };
const STATUS = { unverified: 'Unverified', investigating: 'Under investigation', verified: 'Verified', resolved: 'Resolved / expired', rejected: 'Rejected' };
const CATS = { police: '👮 Police', frsc: '🦺 FRSC', military: '🪖 Military', nscdc: '🛡️ NSCDC', community: '🤝 Community security', sema: '🆘 SEMA', fire: '🚒 Fire service', ambulance: '🚑 Ambulance', hospital: '🏥 Hospital', clinic: '⚕️ Clinic', mechanic: '🔧 Mechanic', vulcaniser: '🛞 Vulcaniser', fuel: '⛽ Fuel' };
const ZONE_T = { urban: 'Urban', peri: 'Peri-urban', rural: 'Rural', forest: 'Forest / isolated stretch' };
const SOS_TYPES = { attack: 'Attack or robbery', kidnap: 'Kidnapping', accident: 'Road accident', medical: 'Medical emergency', fire: 'Fire', other: 'Emergency' };

const D = { me: null, types: {}, settings: {}, state: '', lga: 0, lgaName: '', days: 30, mod: 'overview', map: null, timers: [], cache: {}, sound: false, seenSos: new Set() };
const MODULES = [
  ['overview', '🇳🇬', 'National Overview', () => true],
  ['live', '🗺️', 'Live Incident Map', () => true],
  ['sos', '🆘', 'SOS Command Centre', () => D.me.user.security || D.me.user.admin],
  ['intel', '🧠', 'Security Intelligence', () => true],
  ['verify', '✅', 'Report Verification', () => true],
  ['agencies', '🏛️', 'Agency Management', () => D.me.user.admin],
  ['facilities', '🏥', 'Emergency Facilities', () => true],
  ['users', '👥', 'User Management', () => D.me.user.admin],
  ['analytics', '📊', 'Analytics', () => true],
  ['config', '⚙️', 'System Configuration', () => D.me.user.admin]
];

// ---------------- api ----------------
const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)sr_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (init.method !== 'GET') init.headers['X-CSRF-Token'] = csrf();
  if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, init);
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed (' + r.status + ')'); e.status = r.status; e.data = j; throw e; }
  return j;
}
const qs = extra => { const p = new URLSearchParams({ days: D.days }); if (D.state) p.set('state', D.state); if (D.lga) p.set('lga', D.lga); for (const [k, v] of Object.entries(extra || {})) if (v !== '' && v != null) p.set(k, v); return p.toString(); };
let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').hidden = false; $$('#modalBox [data-close]').forEach(b => b.onclick = closeModal); }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function drawer(html) { const d = $('#drawer'); d.innerHTML = `<button class="btn sm close" id="dClose">✕ Close</button>` + html; d.hidden = false; $('#dClose').onclick = () => d.hidden = true; d.scrollTop = 0; }

// ---------------- sign-in gate ----------------
async function boot() {
  try { D.me = await api('/api/dash/me'); }
  catch (e) { return gate(e); }
  const bs = await api('/api/bootstrap'); D.types = bs.types; D.settings = bs.settings;
  $('#gate').hidden = true; $('#shell').hidden = false;
  if (D.me.scope) { D.scopeStates = D.me.scope.states; }
  $('#who').innerHTML = `<b>${esc(D.me.user.name)}</b><br>${D.me.user.admin ? 'Administrator' : D.me.user.moderator ? 'Moderator' : 'Security partner'}${D.me.user.org ? ' · ' + esc(D.me.user.org.name) : ''}${D.me.scope ? '<br>Jurisdiction: ' + esc([...(D.me.scope.states || [])].join(', ') || 'selected LGAs') : ''}`;
  $('#layersNote').innerHTML = Object.entries(LAYERS).map(([k, l]) => `<span class="lg"><i style="background:${l.color}"></i><b style="color:var(--ink)">${l.short}</b>&nbsp;= ${l.note}</span>`).join('') + '<span class="lg">Community reports are never counted as confirmed incidents.</span>';
  const h = location.hash.slice(1); if (MODULES.find(m => m[0] === h && m[3]())) D.mod = h;
  renderNav(); renderCrumbs(); render();
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);
  setInterval(pollSos, 15000); pollSos();
}
function gate(e) {
  $('#shell').hidden = true; const g = $('#gate'); g.hidden = false;
  if (e && e.status === 403 && e.data && e.data.mfa_setup_required !== undefined) {
    g.innerHTML = `<div class="card"><h1>Two-step verification needed</h1><p class="sub">The Command Centre holds sensitive information. Open the SafeRoute app, go to <b>My Account → Two-step verification</b>, set it up, then sign in again.</p><a class="btn primary" href="/">Open SafeRoute</a></div>`; return;
  }
  if (e && e.status === 403) { g.innerHTML = `<div class="card"><h1>Not authorised</h1><p class="sub">The Command Centre is for SafeRoute administrators, moderators and verified security partners.</p><a class="btn" href="/">Back to the app</a> <button class="btn" id="gOut">Sign out</button></div>`; $('#gOut').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.reload(); }; return; }
  g.innerHTML = `<div class="card"><div class="brand" style="padding:0 0 10px"><img src="/icons/icon-192.png" width="34" height="34" alt=""><div><b>SafeRoute</b><span>Command Centre</span></div></div>
    <form id="gF"><label>Email</label><input type="email" name="email" required autocomplete="username"><label>Password</label><input type="password" name="password" required autocomplete="current-password">
    <div id="gCode" hidden><label>Two-step code</label><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></div>
    <div class="err" id="gErr"></div><button class="btn primary" style="width:100%;justify-content:center;margin-top:10px">Sign in</button></form>
    <p class="small">Authorised staff only. All actions are recorded in the audit log.</p></div>`;
  let ticket = null;
  $('#gF').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    try {
      if (ticket) await api('/api/auth/mfa', { method: 'POST', body: { ticket, code: f.code } });
      else { const r = await api('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.password } }); if (r.mfa_required) { ticket = r.ticket; $('#gCode').hidden = false; $('#gErr').textContent = 'Enter the code from your authenticator app.'; return; } }
      boot();
    } catch (x) { $('#gErr').textContent = x.message; }
  };
}

// ---------------- navigation, scope bar ----------------
function renderNav() {
  $('#nav').innerHTML = MODULES.filter(m => m[3]()).map(([k, ic, l]) => `<button data-mod="${k}" class="${D.mod === k ? 'on' : ''}"><i>${ic}</i>${l}${k === 'sos' && D.openSos ? `<span class="badge">${D.openSos}</span>` : ''}</button>`).join('');
  $$('#nav button').forEach(b => b.onclick = () => { D.mod = b.dataset.mod; location.hash = D.mod; renderNav(); render(); });
}
async function renderCrumbs() {
  const states = D.me.scope && D.me.scope.states.length ? D.me.scope.states : D.me.states;
  let lgas = [];
  if (D.state) { D.cache['lgas:' + D.state] = D.cache['lgas:' + D.state] || await api('/api/dash/lgas?state=' + encodeURIComponent(D.state)); lgas = D.cache['lgas:' + D.state]; }
  $('#crumbs').innerHTML = `<button class="crumb" data-go="nation">${D.me.scope ? 'My jurisdiction' : 'Nigeria'}</button><span class="sep">›</span>
    <select id="cState"><option value="">All states</option>${states.map(s => `<option ${s === D.state ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    ${D.state ? `<span class="sep">›</span><select id="cLga"><option value="">All LGAs</option>${lgas.map(l => `<option value="${l.id}" ${+l.id === +D.lga ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}`;
  $('[data-go=nation]').onclick = () => setScope('', 0);
  $('#cState').onchange = e => setScope(e.target.value, 0);
  if ($('#cLga')) $('#cLga').onchange = e => setScope(D.state, +e.target.value);
}
function setScope(state, lga) { D.state = state; D.lga = lga || 0; renderCrumbs(); render(); }
$('#period').onchange = e => { D.days = +e.target.value; render(); };
$('#refresh').onclick = () => render();

// ---------------- charts (plain SVG) ----------------
function stackedDays(trend, days) {
  const byDay = {}; trend.forEach(t => { (byDay[t.day] = byDay[t.day] || { community: 0, verified: 0, official: 0 })[t.layer] = t.n; });
  const list = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5 + 3600e3).toISOString().slice(0, 10); list.push({ d, ...(byDay[d] || { community: 0, verified: 0, official: 0 }) }); }
  const W = 720, Hh = 160, pad = 24, bw = (W - pad) / list.length;
  const max = Math.max(1, ...list.map(x => x.community + x.verified + x.official));
  let bars = '';
  list.forEach((x, i) => {
    let y = Hh - 18;
    for (const k of ['official', 'verified', 'community']) { const h = (x[k] / max) * (Hh - 30); if (h > 0) { y -= h; bars += `<rect x="${pad + i * bw + 1}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${LAYERS[k].color}"><title>${x.d}: ${x[k]} ${LAYERS[k].short.toLowerCase()}</title></rect>`; } }
  });
  const ticks = [0, Math.floor(list.length / 2), list.length - 1].map(i => `<text x="${pad + i * bw + bw / 2}" y="${Hh - 4}" text-anchor="middle">${list[i].d.slice(5)}</text>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Reports per day by layer"><line x1="${pad}" x2="${W}" y1="${Hh - 18}" y2="${Hh - 18}" stroke="#24332d"/><text x="2" y="12">${max}</text>${bars}${ticks}</svg></div>`;
}
function columns(values, labels, color, title) {
  const W = 480, Hh = 140, n = values.length, bw = (W - 10) / n, max = Math.max(1, ...values);
  return `<div class="chart"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(title)}">${values.map((v, i) => { const h = v / max * (Hh - 30); return `<rect x="${5 + i * bw + 1}" y="${Hh - 18 - h}" width="${bw - 2}" height="${h}" fill="${color}" rx="2"><title>${labels[i]}: ${v}</title></rect>`; }).join('')}
    ${labels.map((l, i) => (n <= 8 || i % 3 === 0) ? `<text x="${5 + i * bw + bw / 2}" y="${Hh - 4}" text-anchor="middle">${l}</text>` : '').join('')}<text x="4" y="12">${max}</text></svg></div>`;
}
function layerBar(r) {
  const t = r.community + r.verified + r.official || 1;
  return `<div class="bar" title="community ${r.community} · verified ${r.verified} · official ${r.official}" style="display:flex">${['official', 'verified', 'community'].map(k => `<i style="width:${r[k] / t * 100}%;background:${LAYERS[k].color}"></i>`).join('')}</div>`;
}
const layerPill = l => `<span class="pill p-${l}">${LAYERS[l].short}</span>`;
const statusPill = s => `<span class="pill p-${s}">${STATUS[s] || s}</span>`;
const typeLabel = k => D.types[k] ? D.types[k].icon + ' ' + D.types[k].label : k;

// ---------------- maps ----------------
function newMap(el, opts) {
  if (D.map) { try { D.map.remove(); } catch (e) {} D.map = null; }
  const m = L.map(el, { zoomControl: true, zoomAnimation: false, ...(opts || {}) }).setView([9.08, 8.68], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap · boundaries: GRID3/geoBoundaries CC BY 4.0' }).addTo(m);
  D.map = m; return m;
}
async function geoStates() { return D.cache.states = D.cache.states || await api('/api/geo/states'); }
async function geoLgas(st) { return D.cache['g:' + st] = D.cache['g:' + st] || await api('/api/geo/lgas?state=' + encodeURIComponent(st)); }
function shade(v, max) { if (!v) return '#1c2a24'; const f = Math.min(1, v / (max || 1)); return f < .25 ? '#fde68a' : f < .5 ? '#fbbf24' : f < .75 ? '#f97316' : '#dc2626'; }

// ---------------- 1. National overview (with State → LGA → community drill-down) ----------------
async function vOverview(v) {
  const d = await api('/api/dash/overview?' + qs({ grp: D.ovGrp || '' }));
  const title = D.lga ? `${esc(d.lga ? d.lga.name : '')} LGA, ${esc(D.state)}` : D.state ? `${esc(D.state)} State` : D.me.scope ? 'My jurisdiction' : 'Nigeria';
  const areaLabel = d.level === 'state' ? 'State' : d.level === 'lga' ? 'LGA' : 'Community / neighbourhood';
  v.innerHTML = `<div class="row between"><div><h1>${title}</h1><p class="sub">Security and road incidents, last ${d.days} days. ${d.level === 'locality' ? 'Individual incidents, communities and facilities in this LGA.' : 'Click an area to drill down.'}</p></div>
    <select id="ovGrp"><option value="">All categories</option><option value="security" ${D.ovGrp === 'security' ? 'selected' : ''}>Security incidents</option><option value="road" ${D.ovGrp === 'road' ? 'selected' : ''}>Road conditions</option>${Object.values(D.types).map(t => `<option value="${t.key}" ${D.ovGrp === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}</select></div>
  <div class="grid g6">
    ${['community', 'verified', 'official'].map(k => `<div class="card kpi l-${k}"><span>${LAYERS[k].label}</span><b>${num(d.totals[k])}</b><small>${LAYERS[k].note}</small></div>`).join('')}
    <div class="card kpi l-sos"><span>Open SOS</span><b>${num(d.sos.open)}</b><small>${num(d.sos.period)} in period · median acknowledgement ${dur(d.sos.median_ack_min)}</small></div>
    <div class="card kpi"><span>Awaiting verification</span><b>${num(d.pending)}</b><small>unverified or under investigation</small></div>
    <div class="card kpi"><span>Verified facilities</span><b>${num(d.facilities_verified)}</b><small>of ${num(d.facilities_total)} listed</small></div>
  </div>
  <div class="grid g-map" style="margin-top:14px">
    <div class="card"><h2>Map</h2><div id="ovMap" class="map"></div><div class="small" style="margin-top:6px">${d.level === 'locality' ? 'Markers: incidents (colour = layer) and facilities.' : 'Shading = verified + official incidents. Community reports are shown in the table, not on the shading.'}</div></div>
    <div class="card"><h2>By ${areaLabel.toLowerCase()}</h2><div class="tablewrap"><table><thead><tr><th>${areaLabel}</th><th class="n">Community</th><th class="n">Verified</th><th class="n">Official</th><th class="n">SOS</th><th></th></tr></thead>
      <tbody>${d.areas.map(a => `<tr class="${d.level !== 'locality' ? 'click' : ''}" data-area="${esc(a.key)}" data-name="${esc(a.name)}"><td>${esc(a.name || '—')}</td><td class="n">${a.community}</td><td class="n">${a.verified}</td><td class="n">${a.official}</td><td class="n">${a.sos}</td><td style="width:70px">${layerBar(a)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No incidents in this period.</td></tr>'}</tbody></table></div></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Reports per day</h2>${stackedDays(d.trend, Math.min(d.days, 90))}</div>
    <div class="card"><h2>By category</h2><div class="tablewrap" style="max-height:240px"><table><thead><tr><th>Category</th><th class="n">Community</th><th class="n">Verified</th><th class="n">Official</th></tr></thead><tbody>${byTypeRows(d.byType)}</tbody></table></div></div>
  </div>
  ${d.incidents ? `<div class="grid g2" style="margin-top:14px"><div class="card"><h2>Incidents in this LGA</h2><div class="tablewrap"><table><thead><tr><th>When</th><th>Category</th><th>Layer</th><th>Community</th></tr></thead><tbody>
      ${d.incidents.map(r => `<tr class="click" data-report="${r.id}"><td>${when(r.created_at)}</td><td>${typeLabel(r.type)}</td><td>${layerPill(r.official ? 'official' : r.verified ? 'verified' : 'community')}</td><td>${esc(r.locality || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Facilities in this LGA</h2><div class="tablewrap"><table><thead><tr><th>Facility</th><th>Phone</th><th>Verified</th></tr></thead><tbody>
      ${d.facilities.map(p => `<tr><td>${CATS[p.category] ? CATS[p.category].split(' ')[0] : ''} ${esc(p.name)}</td><td>${esc(p.phone || '—')}</td><td>${p.last_confirmed_at ? new Date(p.last_confirmed_at).toLocaleDateString() : '<span class="pill p-warn">no</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No facilities recorded — see Emergency Facilities to add them.</td></tr>'}</tbody></table></div></div></div>` : ''}`;
  $('#ovGrp').onchange = e => { D.ovGrp = e.target.value; render(); };
  $$('[data-area]').forEach(tr => tr.onclick = () => { if (d.level === 'state') setScope(tr.dataset.area, 0); else if (d.level === 'lga') setScope(D.state, +tr.dataset.area); });
  $$('[data-report]').forEach(tr => tr.onclick = () => reportDrawer(+tr.dataset.report));
  const m = newMap('ovMap');
  const val = Object.fromEntries(d.areas.map(a => [String(a.key), a.verified + a.official]));
  const max = Math.max(1, ...Object.values(val));
  if (d.level === 'state') {
    const g = await geoStates(); if (D.map !== m) return;
    const layer = L.geoJSON(g, { style: f => ({ color: '#3d5247', weight: 1, fillColor: shade(val[f.properties.name], max), fillOpacity: .75 }),
      onEachFeature: (f, l) => { const a = d.areas.find(x => x.key === f.properties.name); l.bindTooltip(`<b>${esc(f.properties.name)}</b><br>verified ${a ? a.verified : 0} · official ${a ? a.official : 0} · community ${a ? a.community : 0}`); l.on('click', () => setScope(f.properties.name, 0)); } }).addTo(m);
    if (D.me.scope && D.me.scope.states.length) m.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: g.features.filter(f => D.me.scope.states.includes(f.properties.name)) }).getBounds()); else m.fitBounds(layer.getBounds());
  } else {
    const g = await geoLgas(D.state); if (D.map !== m) return;
    const layer = L.geoJSON(g, { style: f => ({ color: +f.properties.id === +D.lga ? '#22c55e' : '#3d5247', weight: +f.properties.id === +D.lga ? 3 : 1, fillColor: d.level === 'lga' ? shade(val[String(f.properties.id)], max) : '#1c2a24', fillOpacity: d.level === 'lga' ? .75 : .25 }),
      onEachFeature: (f, l) => { const a = d.areas.find(x => +x.key === +f.properties.id); l.bindTooltip(`<b>${esc(f.properties.name)}</b>${a ? `<br>verified ${a.verified} · official ${a.official} · community ${a.community}` : ''}`); l.on('click', () => setScope(D.state, +f.properties.id)); } }).addTo(m);
    if (D.lga) { const f = g.features.find(x => +x.properties.id === +D.lga); if (f) m.fitBounds(L.geoJSON(f).getBounds()); } else m.fitBounds(layer.getBounds());
    if (d.incidents) {
      d.incidents.forEach(r => { const k = r.official ? 'official' : r.verified ? 'verified' : 'community'; L.circleMarker([r.lat, r.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: LAYERS[k].color, fillOpacity: .95 }).bindTooltip(`${typeLabel(r.type)} · ${LAYERS[k].short}<br>${when(r.created_at)}`).on('click', () => reportDrawer(r.id)).addTo(m); });
      d.facilities.forEach(p => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div style="font-size:16px">${(CATS[p.category] || '📍').split(' ')[0]}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).bindTooltip(esc(p.name)).addTo(m));
    }
  }
}
function byTypeRows(rows) {
  const m = {}; rows.forEach(r => { (m[r.type] = m[r.type] || { community: 0, verified: 0, official: 0 })[r.layer] = r.n; });
  return Object.entries(m).sort((a, b) => (b[1].verified + b[1].official) - (a[1].verified + a[1].official)).map(([k, x]) => `<tr><td>${typeLabel(k)}</td><td class="n">${x.community}</td><td class="n">${x.verified}</td><td class="n">${x.official}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No reports.</td></tr>';
}

// ---------------- 2. Live incident map ----------------
async function vLive(v) {
  D.live = D.live || { community: true, verified: true, official: true, sos: true, hidden: true, type: '' };
  v.innerHTML = `<div class="row between"><div><h1>Live Incident Map</h1><p class="sub">Every active report and emergency, refreshed every 15 seconds.</p></div>
    <div class="filters">${['community', 'verified', 'official'].map(k => `<label class="row"><input type="checkbox" data-lv="${k}" ${D.live[k] ? 'checked' : ''}><span class="pill p-${k}">${LAYERS[k].short}</span></label>`).join('')}
      <label class="row"><input type="checkbox" data-lv="sos" ${D.live.sos ? 'checked' : ''}><span class="pill p-open">SOS</span></label>
      <label class="row small"><input type="checkbox" data-lv="hidden" ${D.live.hidden ? 'checked' : ''}> include not-yet-public</label>
      <select id="lvType"><option value="">All categories</option>${Object.values(D.types).map(t => `<option value="${t.key}" ${D.live.type === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}</select></div></div>
  <div class="grid g-map"><div><div id="lvMap" class="map tall"></div></div><div class="card"><h2>Latest</h2><div id="lvList" class="tablewrap" style="max-height:calc(100vh - 230px)"></div></div></div>`;
  $$('[data-lv]').forEach(c => c.onchange = () => { D.live[c.dataset.lv] = c.checked; drawLive(); });
  $('#lvType').onchange = e => { D.live.type = e.target.value; drawLive(); };
  const m = newMap('lvMap'); D.liveLayer = L.layerGroup().addTo(m); D.liveFitted = false;
  await loadLive();
  D.timers.push(setInterval(loadLive, 15000));
}
async function loadLive() { try { D.liveData = await api('/api/dash/live?' + qs()); drawLive(); } catch (e) {} }
function drawLive() {
  if (!D.liveData || !D.liveLayer) return;
  const f = D.live, g = D.liveLayer; g.clearLayers();
  const reps = D.liveData.reports.filter(r => f[r.layer] && (f.hidden || r.public) && (!f.type || r.type === f.type) && (!D.lga || true));
  const pts = [];
  reps.forEach(r => { pts.push([r.lat, r.lng]); L.circleMarker([r.lat, r.lng], { radius: r.injured === 1 || r.trapped === 1 ? 10 : 8, color: r.public ? '#fff' : '#94a3b8', dashArray: r.public ? null : '3 3', weight: 2, fillColor: LAYERS[r.layer].color, fillOpacity: .9 })
    .bindTooltip(`${typeLabel(r.type)} · ${LAYERS[r.layer].short}${r.public ? '' : ' (not public)'}<br>${esc(r.lga || '')}${r.state ? ', ' + esc(r.state) : ''} · ${ago(r.created_at)}`).on('click', () => reportDrawer(r.id)).addTo(g); });
  if (f.sos) D.liveData.sos.forEach(s => { pts.push([s.lat, s.lng]); L.marker([s.lat, s.lng], { zIndexOffset: 1000, icon: L.divIcon({ className: '', html: `<div style="background:#dc2626;border:2px solid #fff;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;box-shadow:0 0 0 6px rgba(220,38,38,.3)">🆘</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) })
    .bindTooltip(`SOS ${esc(s.ref)} · ${esc(s.status)}<br>${esc(s.name || '')} · ${ago(s.created_at)}`).on('click', () => { D.mod = 'sos'; location.hash = 'sos'; renderNav(); render(); }).addTo(g); });
  if (!D.liveFitted && pts.length) { D.map.fitBounds(L.latLngBounds(pts).pad(.2)); D.liveFitted = true; }
  const list = [...(f.sos ? D.liveData.sos.map(s => ({ sos: s, t: s.created_at })) : []), ...reps.map(r => ({ r, t: r.created_at }))].sort((a, b) => b.t - a.t).slice(0, 80);
  $('#lvList').innerHTML = `<table><tbody>${list.map(x => x.sos ? `<tr><td><span class="pill p-open">SOS</span> ${esc(x.sos.ref)}<div class="small">${esc(x.sos.lga || '')} · ${ago(x.sos.created_at)}</div></td></tr>`
    : `<tr class="click" data-rep="${x.r.id}"><td>${typeLabel(x.r.type)} ${layerPill(x.r.layer)}${x.r.public ? '' : ' <span class="pill">not public</span>'}<div class="small">${esc(x.r.locality ? x.r.locality + ', ' : '')}${esc(x.r.lga || '')}${x.r.state ? ', ' + esc(x.r.state) : ''} · ${ago(x.r.created_at)} · ${esc(x.r.confLabel)}</div></td></tr>`).join('') || '<tr><td class="empty">Nothing active.</td></tr>'}</tbody></table>`;
  $$('[data-rep]').forEach(tr => tr.onclick = () => reportDrawer(+tr.dataset.rep));
}

// ---------------- 3. SOS command centre ----------------
async function pollSos() {
  if (!(D.me && (D.me.user.security || D.me.user.admin))) return;
  try {
    const list = await api('/api/dash/sos?' + qs({ days: '' }));
    const open = list.filter(s => s.status !== 'closed' || (s.duress && s.status !== 'closed'));
    const fresh = open.filter(s => s.status === 'open' && !D.seenSos.has(s.id));
    if (fresh.length && D.sosLoaded && D.sound) alarm();
    if (fresh.length && D.sosLoaded) toast(`🆘 New SOS ${fresh[0].ref}`);
    fresh.forEach(s => D.seenSos.add(s.id)); D.sosLoaded = true;
    D.sosList = list; D.openSos = open.length; renderNav();
    if (D.mod === 'sos') drawSos();
  } catch (e) {}
}
let actx;
function alarm() { try { actx = actx || new AudioContext(); for (let i = 0; i < 3; i++) { const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * .5; o.type = 'square'; o.frequency.setValueAtTime(880, t); o.frequency.linearRampToValueAtTime(1320, t + .35); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .4); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .45); } } catch (e) {} }
async function vSos(v) {
  if (!D.responders) try { D.responders = await api('/api/dash/responders'); } catch (e) { D.responders = []; }
  if (D.me.user.admin && !D.orgs) try { D.orgs = await api('/api/dash/orgs'); } catch (e) { D.orgs = []; }
  v.innerHTML = `<div class="row between"><div><h1>SOS Command Centre</h1><p class="sub">Active emergencies, responder status and delivery of alerts. Updates every 15 seconds.</p></div>
    <label class="row"><input type="checkbox" id="sSound" ${D.sound ? 'checked' : ''}> 🔊 Alarm for new SOS</label></div>
    <div class="grid g-map"><div id="sosList"></div><div><div id="sosMap" class="map tall"></div></div></div>`;
  $('#sSound').onchange = e => { D.sound = e.target.checked; if (D.sound) alarm(); };
  newMap('sosMap'); D.sosLayer = L.layerGroup().addTo(D.map); D.sosFitted = false;
  await pollSos(); drawSos();
  D.timers.push(setInterval(() => $$('[data-since]').forEach(el => { const s = Math.floor((Date.now() - +el.dataset.since) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }), 1000));
}
function deliveryText(d) {
  const p = (ch, l) => { const x = d && d[ch]; if (!x) return ''; return `${l} ${(x.sent || 0) + (x.delivered || 0)} sent${x.delivered ? ' / ' + x.delivered + ' delivered' : ''}${x.failed ? ' / ' + x.failed + ' failed' : ''}`; };
  return [p('push', 'App'), p('sms', 'SMS'), p('voice', 'Calls')].filter(Boolean).join(' · ') || 'no deliveries recorded';
}
function drawSos() {
  const el = $('#sosList'); if (!el || !D.sosList) return;
  const list = D.sosList;
  const active = list.filter(s => s.status !== 'closed'), closed = list.filter(s => s.status === 'closed');
  const card = s => `<div class="sos-card ${s.status === 'open' ? 'open' : ''} ${s.escalation_level && s.status === 'open' ? 'esc' : ''}">
    <div class="row between"><b>🆘 ${esc(s.ref)} · ${esc(SOS_TYPES[s.type] || 'Emergency')}</b><span class="pill ${s.status === 'open' ? 'p-open' : s.status === 'closed' ? 'p-resolved' : 'p-warn'}">${esc(s.status.replace('_', ' '))}</span></div>
    <div class="small" style="margin-top:4px">${esc(s.name || 'User')}${s.phone ? ` · <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''} · ${esc([s.locality, s.lga, s.state].filter(Boolean).join(', ') || '—')}</div>
    <div class="row" style="margin-top:6px">${s.status !== 'closed' ? `<span>Open for <span class="timer" data-since="${s.created_at}"></span></span>` : `<span class="small">Closed · ${esc(s.closed_reason || '')}</span>`}
      <span class="small">Acknowledged: ${s.ack_min != null ? dur(s.ack_min) : '<b style="color:#fca5a5">not yet</b>'}</span>${s.escalation_level ? `<span class="pill p-open">Escalation ${s.escalation_level}</span>` : ''}${s.duress ? '<span class="pill p-open">DURESS</span>' : ''}</div>
    <div class="small" style="margin-top:4px">📨 ${esc(deliveryText(s.delivery))}</div>
    ${s.assignee || s.org_name ? `<div class="small">Assigned: <b style="color:var(--ink)">${esc(s.assignee || s.org_name)}</b></div>` : ''}
    <ul class="timeline">${s.events.slice(-5).map(e => `<li><span>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>${esc(e.text)}</li>`).join('')}</ul>
    ${s.notes.length ? `<div class="small">${s.notes.map(n => `📝 <b style="color:var(--ink)">${esc(n.name)}</b>: ${esc(n.text)}`).join('<br>')}</div>` : ''}
    <div class="row" style="margin-top:8px"><button class="btn sm" data-szoom="${s.id}">Map</button>${s.url ? `<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">Live link</a>` : ''}
      ${s.status !== 'closed' ? `<button class="btn sm" data-st="acknowledged" data-id="${s.id}">Acknowledge</button><button class="btn sm primary" data-st="responding" data-id="${s.id}">Responding</button><button class="btn sm" data-st="on_scene" data-id="${s.id}">On scene</button>
      <select data-close="${s.id}"><option value="">Close as…</option><option value="resolved">Resolved</option><option value="handed_over">Handed over</option><option value="unreachable">Could not reach</option><option value="false_alarm">False alarm</option></select>
      <select data-assign="${s.id}"><option value="">Assign to…</option>${(D.responders || []).map(r => `<option value="u${r.id}">${esc(r.name)}${r.org_name ? ' · ' + esc(r.org_name) : ''}</option>`).join('')}${(D.orgs || []).map(o => `<option value="o${o.id}">🏛️ ${esc(o.name)}</option>`).join('')}</select>` : ''}
      <button class="btn sm" data-note="${s.id}">Note</button></div></div>`;
  el.innerHTML = `<div class="card"><h2>Active · ${active.length}</h2>${active.map(card).join('') || '<div class="empty">No active emergencies.</div>'}</div>
    <div class="card" style="margin-top:14px"><h2>Closed in the last 24 hours · ${closed.length}</h2>${closed.map(card).join('') || '<div class="empty">None.</div>'}</div>`;
  const g = D.sosLayer; if (g) { g.clearLayers(); const pts = []; active.forEach(s => { pts.push([s.lat, s.lng]); if (s.trail.length > 1) L.polyline(s.trail.map(p => [p.lat, p.lng]), { color: '#dc2626', weight: 3, dashArray: '4 6' }).addTo(g); L.circleMarker([s.lat, s.lng], { radius: 11, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).bindTooltip(`${esc(s.ref)} · ${esc(s.name || '')}`).addTo(g); }); if (!D.sosFitted && pts.length) { D.map.fitBounds(L.latLngBounds(pts).pad(.3), { maxZoom: 13 }); D.sosFitted = true; } }
  const act = (sel, fn, ev) => $$(sel).forEach(b => b.addEventListener(ev || 'click', async () => { try { await fn(b); } catch (e) { toast(e.message); } }));
  act('[data-szoom]', b => { const s = list.find(x => x.id === +b.dataset.szoom); D.map.setView([s.lat, s.lng], 15); });
  act('[data-st]', async b => { await api(`/api/sos/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.st } }); toast('Status sent to the person and their Safe Circle'); pollSos(); });
  act('[data-close]', async b => { if (!b.value) return; await api(`/api/sos/${b.dataset.close}/status`, { method: 'POST', body: { status: 'closed', reason: b.value } }); toast('SOS closed'); pollSos(); }, 'change');
  act('[data-assign]', async b => { if (!b.value) return; const body = b.value[0] === 'u' ? { user_id: +b.value.slice(1), org_id: ((D.responders || []).find(r => r.id === +b.value.slice(1)) || {}).org_id } : { org_id: +b.value.slice(1) }; await api(`/api/sos/${b.dataset.assign}/assign`, { method: 'POST', body }); toast('Assigned'); pollSos(); }, 'change');
  act('[data-note]', b => noteModal('sos', +b.dataset.note, pollSos));
}
function noteModal(type, id, after) {
  modal(`<h2>Internal note</h2><p class="small">Visible to SafeRoute staff and responders only.</p><form id="nF"><textarea name="text" rows="4" maxlength="500" style="width:100%" required></textarea>
    <div class="row between" style="margin-top:10px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Add note</button></div></form>`);
  $('#nF').onsubmit = async e => { e.preventDefault(); try { await api(`/api/notes/${type}/${id}`, { method: 'POST', body: { text: new FormData(e.target).get('text') } }); closeModal(); toast('Note added'); after && after(); } catch (x) { toast(x.message); } };
}

// ---------------- 4. Security intelligence ----------------
async function vIntel(v) {
  D.intelGrp = D.intelGrp || 'security';
  const d = await api('/api/dash/intel?' + qs({ grp: D.intelGrp }));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const areaRows = (rows, cols) => rows.length ? `<table><thead><tr><th>LGA</th><th>State</th>${cols.map(c => `<th class="n">${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(a => `<tr class="click" data-lgaid="${a.id}" data-st="${esc(a.state)}"><td>${esc(a.name)}</td><td>${esc(a.state)}</td>${cols.map(c => `<td class="n">${typeof c[2] === 'function' ? c[2](a) : a[c[0]]}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing to show for this period.</div>';
  v.innerHTML = `<div class="row between"><div><h1>Security Intelligence</h1><p class="sub">Patterns from <b>verified and official</b> incidents, last ${d.days} days compared with the ${d.days} days before. ${d.confirmed_total} confirmed incidents in view.</p></div>
    <select id="inGrp"><option value="security">All security incidents</option><option value="road">Road conditions</option>${Object.values(D.types).map(t => `<option value="${t.key}" ${D.intelGrp === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}</select></div>
  <div class="grid g2">
    <div class="card"><h2>Hotspots (verified + official)</h2><div class="tablewrap">${areaRows(d.hotspots, [['cur', 'This period'], ['prev', 'Before'], ['official_cur', 'Official']])}</div></div>
    <div class="card"><h2>Increasing (verified + official)</h2><p class="small" style="margin-top:0">At least 2 confirmed incidents and 50% more than the previous period.</p><div class="tablewrap">${areaRows(d.rising, [['prev', 'Before'], ['cur', 'Now'], ['change', 'Change', a => a.change == null ? 'new' : '+' + a.change + '%']])}</div></div>
  </div>
  <div class="grid g3" style="margin-top:14px">
    <div class="card"><h2>Time of day (confirmed)</h2>${columns(d.hours, d.hours.map((_, i) => String(i).padStart(2, '0')), '#f97316', 'Incidents by hour')}</div>
    <div class="card"><h2>Day of week (confirmed)</h2>${columns(d.week, days, '#f59e0b', 'Incidents by day of week')}</div>
    <div class="card"><h2>Communities with most incidents</h2><table><tbody>${d.localities.map(l => `<tr><td>${esc(l.name)}</td><td class="n">${l.n}</td></tr>`).join('') || '<tr><td class="empty">No named communities yet.</td></tr>'}</tbody></table></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Community signals needing verification</h2><div class="warnbox">These are <b>unverified community reports</b>. They show where to send a moderator or patrol, not confirmed crime levels.</div><div class="tablewrap">${areaRows(d.needsVerification, [['community_cur', 'Community reports'], ['cur', 'Confirmed']])}</div></div>
    <div class="card"><h2>Concentration map (verified)</h2><div id="inMap" class="map" style="height:340px"></div></div>
  </div>`;
  $('#inGrp').value = D.intelGrp; $('#inGrp').onchange = e => { D.intelGrp = e.target.value; render(); };
  $$('[data-lgaid]').forEach(tr => tr.onclick = () => { D.mod = 'overview'; location.hash = 'overview'; D.state = tr.dataset.st; D.lga = +tr.dataset.lgaid; renderNav(); renderCrumbs(); render(); });
  const m = newMap('inMap');
  try {
    const h = await api(`/api/heatmap?cat=${D.intelGrp}&days=${[30, 90, 365].includes(D.days) ? D.days : 90}&tod=all`); if (D.map !== m) return;
    const pts = [];
    h.cells.forEach(c => { pts.push([c.lat, c.lng]); const f = c.n / (h.max || 1); L.rectangle([[c.lat, c.lng], [c.lat + h.cell, c.lng + h.cell]], { weight: 0, fillColor: f < .34 ? '#facc15' : f < .67 ? '#f97316' : '#dc2626', fillOpacity: .3 + .5 * f }).bindTooltip(`${c.n} verified`).addTo(m); });
    if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(.5), { maxZoom: 10 });
  } catch (e) {}
}

// ---------------- 5. Report verification ----------------
async function vVerify(v) {
  D.vf = D.vf || { status: 'queue', type: '', q: '' };
  v.innerHTML = `<h1>Report Verification</h1><p class="sub">Investigate community reports. Verifying makes a report count as a confirmed incident; rejecting lowers the reporter's trust.</p>
    <div class="filters"><select id="vfS">${[['queue', 'To review (unverified + investigating)'], ['unverified', 'Unverified'], ['investigating', 'Under investigation'], ['verified', 'Verified'], ['resolved', 'Resolved / expired'], ['rejected', 'Rejected'], ['', 'All']].map(([k, l]) => `<option value="${k}" ${D.vf.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select id="vfT"><option value="">All categories</option><option value="security" ${D.vf.type === 'security' ? 'selected' : ''}>Security</option><option value="road" ${D.vf.type === 'road' ? 'selected' : ''}>Road</option>${Object.values(D.types).map(t => `<option value="${t.key}" ${D.vf.type === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}</select>
    <input type="text" id="vfQ" placeholder="Search note, community, LGA, reporter" value="${esc(D.vf.q)}"><button class="btn" id="vfGo">Search</button></div>
    <div class="card"><div class="tablewrap" style="max-height:calc(100vh - 290px)" id="vList">Loading…</div></div>`;
  $('#vfS').onchange = e => { D.vf.status = e.target.value; loadVerify(); };
  $('#vfT').onchange = e => { D.vf.type = e.target.value; loadVerify(); };
  $('#vfGo').onclick = () => { D.vf.q = $('#vfQ').value; loadVerify(); };
  $('#vfQ').onkeydown = e => { if (e.key === 'Enter') $('#vfGo').click(); };
  loadVerify();
}
async function loadVerify() {
  const rows = await api('/api/dash/reports?' + qs({ status: D.vf.status, grp: D.vf.type, q: D.vf.q }));
  const rank = r => (D.types[r.type] && D.types[r.type].grp === 'security' ? 2 : 0) + (r.injured === 1 || r.trapped === 1 ? 2 : 0) + (r.confidence || 0);
  if (D.vf.status === 'queue') rows.sort((a, b) => rank(b) - rank(a));
  $('#vList').innerHTML = `<table><thead><tr><th>Reported</th><th>Category</th><th>Where</th><th>Status</th><th>Layer</th><th class="n">Confidence</th><th class="n">✔ / ❓</th><th>Reporter</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-rep="${r.id}"><td>${when(r.created_at)}</td><td>${typeLabel(r.type)}${r.injured === 1 || r.trapped === 1 ? ' <span class="pill p-open">people hurt/trapped</span>' : ''}${r.has_media ? ' 📎' : ''}</td>
      <td>${esc([r.locality, r.lga, r.state].filter(Boolean).join(', ') || '—')}</td><td>${statusPill(r.status)}</td><td>${layerPill(r.layer)}</td><td class="n">${Math.round((r.confidence || 0) * 100)}%${r.disputed ? ' ⚠️' : ''}</td>
      <td class="n">${(r.counts.confirm || 0) + (r.counts.ongoing || 0)} / ${r.counts.inaccurate || 0}</td><td>${esc(r.by_name || '—')}<div class="small">trust ${r.reporter_trust != null ? Math.round(r.reporter_trust * 100) + '%' : '—'}</div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing here.</td></tr>'}</tbody></table>`;
  $$('[data-rep]').forEach(tr => tr.onclick = () => reportDrawer(+tr.dataset.rep));
}
async function reportDrawer(id) {
  let d; try { d = await api('/api/dash/reports/' + id); } catch (e) { return toast(e.message); }
  const r = d.report, t = D.types[r.type] || {};
  const yn = v => v === 1 ? 'Yes' : v === 0 ? 'No' : 'Unknown';
  const open = ['unverified', 'investigating', 'verified'].includes(r.status);
  drawer(`<h1>${typeLabel(r.type)}</h1><div class="row">${statusPill(r.status)} ${layerPill(r.layer)} <span class="pill">${esc(r.confLabel)} · ${Math.round(r.confidence * 100)}%</span>${r.disputed ? '<span class="pill p-warn">disputed</span>' : ''}${r.responding ? '<span class="pill p-good">security responding</span>' : ''}</div>
    <div class="facts"><div><span>Where</span>${esc([r.locality, r.lga && r.lga + ' LGA', r.state].filter(Boolean).join(', ') || '—')}</div><div><span>Coordinates</span>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</div>
      <div><span>Happened</span>${when(r.occurred_at || r.created_at)}</div><div><span>Reported</span>${when(r.created_at)}</div><div><span>Ongoing</span>${yn(r.ongoing)}</div><div><span>Injured / trapped</span>${yn(r.injured)} / ${yn(r.trapped)}</div>
      <div><span>People affected</span>${r.affected ?? '—'}</div><div><span>Source</span>${esc(r.source || '—')}</div></div>
    ${r.note ? `<p>${esc(r.note)}</p>` : ''}${r.org_name ? `<p class="small">Official record: ${esc(r.org_name)}</p>` : ''}
    ${r.media ? (r.media_type === 'video' ? `<video class="ev" src="${esc(r.media)}" controls></video><div class="small">Video: staff only (location data cannot be removed automatically).</div>` : `<img class="ev" src="${esc(r.media)}" alt="Evidence"><div class="row"><span class="small">${r.media_public ? 'Visible to the public' : 'Staff and reporter only'}</span>${D.me.user.moderator ? `<button class="btn sm" id="dMedia">${r.media_public ? 'Hide from public' : 'Publish photo'}</button>` : ''}</div>`) : ''}
    <div id="dMap" class="map" style="height:200px;margin-top:10px"></div>
    <h2 style="margin-top:16px">Actions</h2>
    <div class="row">${D.me.user.moderator && open ? `<button class="btn primary" data-act="verify">Verify</button>${r.status !== 'investigating' ? '<button class="btn" data-act="investigate">Under investigation</button>' : ''}<button class="btn" data-act="reject">Reject</button><button class="btn" data-act="resolve">Resolved</button>` : ''}
      ${D.me.user.security && open && !r.official ? '<button class="btn primary" id="dOfficial">Confirm as official</button>' : ''}${D.me.user.security && open ? `<button class="btn" id="dResp">${r.responding ? 'Stop responding' : 'Responding'}</button>` : ''}
      <button class="btn" id="dNote">Add note</button></div>
    ${D.me.user.moderator && open ? `<div class="row" style="margin-top:8px"><span class="small">Correct the category:</span><select id="dType">${Object.values(D.types).map(x => `<option value="${x.key}" ${x.key === r.type ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select><input type="text" id="dNoteTxt" placeholder="Reason / note (optional)" style="flex:1"></div>` : ''}
    <h2 style="margin-top:16px">Community confirmations · ${d.confirmations.length}</h2>
    ${d.confirmations.length ? `<table><thead><tr><th>Who</th><th>Said</th><th class="n">Distance</th><th>When</th></tr></thead><tbody>${d.confirmations.map(c => `<tr><td>${esc(c.name)}<div class="small">trust ${Math.round((c.trust || 0) * 100)}%${Date.now() - c.user_since < 864e5 ? ' · new account' : ''}</div></td><td>${{ confirm: '✔ confirms', ongoing: '⏳ still happening', resolved: '✅ resolved', inaccurate: '❓ inaccurate' }[c.kind]}</td><td class="n">${c.distance_km == null ? 'unknown' : c.distance_km.toFixed(1) + ' km'}</td><td>${ago(c.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">None yet.</div>'}
    <h2 style="margin-top:16px">Nearby reports (3 km, ±24 h) · ${d.nearby.length}</h2>
    ${d.nearby.length ? `<table><tbody>${d.nearby.map(n => `<tr class="click" data-near="${n.id}"><td>${typeLabel(n.type)}${n.same_reporter ? ' <span class="pill p-warn">same reporter</span>' : ''}</td><td>${statusPill(n.status)}</td><td>${when(n.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No other reports nearby — this report is not independently corroborated.</div>'}
    <h2 style="margin-top:16px">Reporter</h2>
    ${d.reporter ? `<p>${esc(d.reporter.name)}${d.reporter.trusted ? ' ⭐ trusted' : ''} · trust ${Math.round(d.reporter.trust * 100)}% · ${d.reporter.total} reports (${d.reporter.verified} confirmed, ${d.reporter.rejected} rejected) · member since ${new Date(d.reporter.created_at).toLocaleDateString()}</p>` : '<p class="small">Unknown or deleted account.</p>'}
    <h2 style="margin-top:16px">Notes</h2>${d.notes.map(n => `<div class="small">📝 <b style="color:var(--ink)">${esc(n.name)}</b> · ${ago(n.at)}: ${esc(n.text)}</div>`).join('') || '<div class="empty">None.</div>'}
    <h2 style="margin-top:16px">History</h2><ul class="timeline">${d.history.map(h => `<li><span>${when(h.at)}</span>${esc(h.action.replace(/_/g, ' '))} — ${esc(h.name || 'system')}</li>`).join('') || '<li class="small">No staff actions yet.</li>'}</ul>`);
  setTimeout(() => { const m = L.map('dMap', { zoomControl: false, attributionControl: false }).setView([r.lat, r.lng], 13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m); L.circleMarker([r.lat, r.lng], { radius: 9, color: '#fff', weight: 2, fillColor: LAYERS[r.layer].color, fillOpacity: 1 }).addTo(m); d.nearby.forEach(n => L.circleMarker([n.lat, n.lng], { radius: 6, color: '#fff', weight: 1, fillColor: '#64748b', fillOpacity: .9 }).addTo(m)); }, 50);
  const refresh = () => { reportDrawer(id); if (D.mod === 'verify') loadVerify(); if (D.mod === 'live') loadLive(); };
  $$('#drawer [data-act]').forEach(b => b.onclick = async () => { try { await api(`/api/reports/${id}/moderate`, { method: 'POST', body: { action: b.dataset.act, type: $('#dType') ? $('#dType').value : undefined, note: $('#dNoteTxt') ? $('#dNoteTxt').value : undefined } }); toast({ verify: 'Verified', investigate: 'Marked under investigation', reject: 'Rejected', resolve: 'Resolved' }[b.dataset.act]); refresh(); } catch (e) { toast(e.message); } });
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = async () => { try { await fn(); } catch (e) { toast(e.message); } }; };
  on('#dOfficial', async () => { await api(`/api/reports/${id}/official`, { method: 'POST' }); toast('Confirmed as an official record'); refresh(); });
  on('#dResp', async () => { await api(`/api/reports/${id}/respond`, { method: 'POST', body: { responding: !r.responding } }); refresh(); });
  on('#dMedia', async () => { await api(`/api/reports/${id}/media`, { method: 'POST', body: { public: !r.media_public } }); refresh(); });
  on('#dNote', () => noteModal('report', id, refresh));
  $$('#drawer [data-near]').forEach(tr => tr.onclick = () => reportDrawer(+tr.dataset.near));
}

// ---------------- 6. Agency management ----------------
async function vAgencies(v) {
  const orgs = D.orgs = await api('/api/dash/orgs');
  v.innerHTML = `<div class="row between"><div><h1>Agency Management</h1><p class="sub">Participating security organisations, their jurisdictions and officers. Officers choose their agency when registering; supervisors can verify their own officers.</p></div><button class="btn primary" id="aNew">➕ Add agency</button></div>
    <div class="card"><table><thead><tr><th>Agency</th><th>Type</th><th>Jurisdiction</th><th class="n">Officers</th><th class="n">Awaiting</th><th>Listed</th><th></th></tr></thead><tbody>
    ${orgs.map(o => `<tr><td><b>${esc(o.name)}</b><div class="small">${esc(o.phone || '')}</div></td><td>${esc(o.type)}</td><td>${o.jurisdiction.states.length || o.jurisdiction.lgas.length ? esc(o.jurisdiction.states.join(', ')) + (o.jurisdiction.lgas.length ? ` + ${o.jurisdiction.lgas.length} LGA(s)` : '') : '<span class="small">Nationwide view</span>'}</td>
      <td class="n">${o.officers}</td><td class="n">${o.pending ? `<span class="pill p-warn">${o.pending}</span>` : 0}</td><td>${o.verified ? '✅' : '—'}</td><td><button class="btn sm" data-edit="${o.id}">Edit</button> <button class="btn sm" data-off="${o.id}">Officers</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No agencies yet.</td></tr>'}</tbody></table></div><div id="aDetail" style="margin-top:14px"></div>`;
  $('#aNew').onclick = () => orgForm(null);
  $$('[data-edit]').forEach(b => b.onclick = () => orgForm(orgs.find(o => o.id === +b.dataset.edit)));
  $$('[data-off]').forEach(b => b.onclick = () => officers(orgs.find(o => o.id === +b.dataset.off)));
}
async function orgForm(o) {
  const types = ['police', 'frsc', 'nscdc', 'military', 'sema', 'fire', 'ambulance', 'community', 'other'];
  const j = o ? o.jurisdiction : { states: [], lgas: [] };
  const box = $('#aDetail');
  box.innerHTML = `<div class="card"><h2>${o ? 'Edit ' + esc(o.name) : 'New agency'}</h2><form id="oF">
    <div class="grid g3"><label>Name<br><input type="text" name="name" required maxlength="100" value="${esc(o ? o.name : '')}" style="width:100%"></label>
      <label>Type<br><select name="type" style="width:100%">${types.map(t => `<option ${o && o.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Control room phone<br><input type="text" name="phone" maxlength="40" value="${esc(o ? o.phone || '' : '')}" style="width:100%"></label>
      <label>Head-office state<br><select name="state" style="width:100%"><option value="">—</option>${D.me.states.map(s => `<option ${o && o.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Alert radius from base (km)<br><input type="number" name="radius_km" value="${o && o.radius_km ? o.radius_km : ''}" style="width:100%"></label>
      <label>Base location<br><span class="small">${o && o.lat ? o.lat.toFixed(4) + ', ' + o.lng.toFixed(4) : 'not set'} — click the map below to set</span></label></div>
    <div id="oMap" class="map" style="height:240px;margin-top:10px"></div>
    <h2 style="margin-top:14px">Jurisdiction</h2><p class="small">Security partners in this agency see only these states/LGAs in the Command Centre. Leave empty for a nationwide view.</p>
    <div class="chk">${D.me.states.map(s => `<label><input type="checkbox" data-js="${esc(s)}" ${j.states.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>
    <div class="row" style="margin-top:8px"><span class="small">Or specific LGAs in</span><select id="oLgaState"><option value="">choose state…</option>${D.me.states.map(s => `<option>${s}</option>`).join('')}</select></div><div id="oLgas" class="chk" style="margin-top:6px" hidden></div>
    <label class="row" style="margin-top:10px"><input type="checkbox" name="verified" ${!o || o.verified ? 'checked' : ''}> Listed (officers can choose it when registering)</label>
    <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button type="button" class="btn" id="oCancel">Cancel</button></div></form></div>`;
  let pos = o && o.lat ? [o.lat, o.lng] : null, lgas = new Set(j.lgas);
  const m = newMap('oMap'); let mk = pos ? L.marker(pos).addTo(m) : null; if (pos) m.setView(pos, 9);
  m.on('click', e => { pos = [e.latlng.lat, e.latlng.lng]; if (mk) m.removeLayer(mk); mk = L.marker(pos).addTo(m); });
  $('#oLgaState').onchange = async e => { const st = e.target.value, el = $('#oLgas'); if (!st) { el.hidden = true; return; } const list = await api('/api/dash/lgas?state=' + encodeURIComponent(st)); el.hidden = false; el.innerHTML = list.map(l => `<label><input type="checkbox" data-jl="${l.id}" ${lgas.has(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join(''); $$('[data-jl]').forEach(c => c.onchange = () => c.checked ? lgas.add(+c.dataset.jl) : lgas.delete(+c.dataset.jl)); };
  $('#oCancel').onclick = () => { box.innerHTML = ''; };
  $('#oF').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.verified = !!f.verified; if (pos) { f.lat = pos[0]; f.lng = pos[1]; }
    try {
      let id = o && o.id;
      if (o) await api('/api/orgs/' + o.id, { method: 'PUT', body: f }); else id = (await api('/api/orgs', { method: 'POST', body: f })).id;
      await api(`/api/dash/orgs/${id}/jurisdiction`, { method: 'PUT', body: { states: $$('[data-js]').filter(c => c.checked).map(c => c.dataset.js), lgas: [...lgas] } });
      toast('Agency saved'); render();
    } catch (x) { toast(x.message); }
  };
}
async function officers(o) {
  const list = await api('/api/org/officers?org=' + o.id);
  $('#aDetail').innerHTML = `<div class="card"><h2>${esc(o.name)} · officers</h2><table><thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Role</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${esc(u.name)}</td><td class="small">${esc(u.email)}<br>${esc(u.phone || '')}</td><td>${u.security_status === 'pending' ? '<span class="pill p-warn">awaiting</span>' : esc(u.security_status || '—')}</td><td>${esc(u.org_role || 'officer')}</td>
      <td>${u.security_status === 'pending' ? `<button class="btn sm primary" data-o="verify" data-id="${u.id}">Verify</button> <button class="btn sm" data-o="reject" data-id="${u.id}">Decline</button>` : `<button class="btn sm" data-o="${u.org_role === 'supervisor' ? 'officer' : 'supervisor'}" data-id="${u.id}">${u.org_role === 'supervisor' ? 'Make officer' : 'Make supervisor'}</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No officers have registered under this agency yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-o]').forEach(b => b.onclick = async () => { try { await api(`/api/org/officers/${b.dataset.id}`, { method: 'POST', body: { action: b.dataset.o } }); toast('Updated'); officers(o); } catch (e) { toast(e.message); } });
}

// ---------------- 7. Emergency facilities ----------------
async function vFacilities(v) {
  D.ff = D.ff || { cat: '', q: '', unverified: false };
  v.innerHTML = `<div class="row between"><div><h1>Emergency Facilities</h1><p class="sub">Police divisions, FRSC, NSCDC, fire, ambulance, SEMA, hospitals and road services. A listing counts as verified for ${esc(D.settings.facility_verify_days || 365)} days.</p></div>${D.me.user.moderator ? '<button class="btn primary" id="fNew">➕ Add facility</button>' : ''}</div>
    <div class="grid g2"><div class="card"><h2>Coverage gaps ${D.state ? 'in ' + esc(D.state) : 'by state'}</h2><p class="small" style="margin-top:0">Areas with no <b>verified</b> security post, health facility, fire service or ambulance.</p><div class="tablewrap" id="fCov" style="max-height:330px">Loading…</div></div>
      <div class="card"><h2>Suggestions from the public</h2><div id="fSug" class="tablewrap" style="max-height:330px">${D.me.user.moderator ? 'Loading…' : '<span class="small">Moderators review suggestions.</span>'}</div></div></div>
    <div class="card" style="margin-top:14px"><div class="filters"><select id="ffC"><option value="">All types</option>${[['security', 'Security'], ['health', 'Health'], ['fire', 'Fire'], ['ambulance', 'Ambulance'], ['sema', 'SEMA'], ['road', 'Road services']].map(([k, l]) => `<option value="${k}" ${D.ff.cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="text" id="ffQ" placeholder="Search" value="${esc(D.ff.q)}"><label class="row small"><input type="checkbox" id="ffU" ${D.ff.unverified ? 'checked' : ''}> needs verification</label></div><div class="tablewrap" id="fList" style="max-height:520px">Loading…</div></div>`;
  $('#ffC').onchange = e => { D.ff.cat = e.target.value; loadFac(); };
  $('#ffQ').onchange = e => { D.ff.q = e.target.value; loadFac(); };
  $('#ffU').onchange = e => { D.ff.unverified = e.target.checked; loadFac(); };
  if ($('#fNew')) $('#fNew').onclick = () => facForm(null);
  loadFac();
  const cov = await api('/api/dash/coverage?' + qs());
  $('#fCov').innerHTML = `<table><thead><tr><th>${D.state ? 'LGA' : 'State'}</th><th class="n">Security</th><th class="n">Health</th><th class="n">Fire</th><th class="n">Ambulance</th><th>Gaps</th></tr></thead><tbody>${cov.map(c => `<tr class="${D.state ? '' : 'click'}" data-cst="${esc(c.key)}"><td>${esc(c.name)}</td>${['security', 'health', 'fire', 'ambulance'].map(g => `<td class="n">${c[g]}<span class="small">/${c[g + '_all']}</span></td>`).join('')}<td>${c.gaps.length ? c.gaps.map(g => `<span class="pill p-warn">${g}</span>`).join(' ') : '<span class="pill p-good">covered</span>'}</td></tr>`).join('')}</tbody></table><div class="small">verified / listed</div>`;
  $$('[data-cst]').forEach(tr => { if (!D.state) tr.onclick = () => setScope(tr.dataset.cst, 0); });
  if (D.me.user.moderator) {
    const sug = await api('/api/places/suggestions');
    $('#fSug').innerHTML = sug.length ? `<table><tbody>${sug.map(s => `<tr><td>${s.place_id ? '✏️ ' + esc(s.place_name || '') : '➕ ' + esc(s.data.name || '')}<div class="small">${Object.entries(s.data).filter(([k]) => !['lat', 'lng'].includes(k)).map(([k, v]) => esc(k) + ': ' + esc(v === true ? 'yes' : v)).join(' · ')}</div><div class="small">${esc(s.by_name || '')} · ${ago(s.created_at)}</div></td>
      <td style="width:150px"><button class="btn sm primary" data-sg="approve" data-id="${s.id}">Approve</button> <button class="btn sm" data-sg="reject" data-id="${s.id}">Reject</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No suggestions waiting.</div>';
    $$('[data-sg]').forEach(b => b.onclick = async () => { await api(`/api/places/suggestions/${b.dataset.id}`, { method: 'POST', body: { action: b.dataset.sg } }); toast('Done'); render(); });
  }
}
async function loadFac() {
  const list = D.facList = await api('/api/dash/facilities?' + qs({ cat: D.ff.cat, q: D.ff.q, unverified: D.ff.unverified ? 1 : '' }));
  const fresh = Date.now() - (+D.settings.facility_verify_days || 365) * 864e5;
  $('#fList').innerHTML = `<table><thead><tr><th>Facility</th><th>Type</th><th>LGA / State</th><th>Phone</th><th>Hours</th><th>Verified</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td><b>${esc(p.name)}</b><div class="small">${esc(p.address || '')}</div></td><td>${esc(CATS[p.category] || p.category)}</td><td>${esc(p.lga || '—')}<div class="small">${esc(p.state || '')}</div></td><td>${esc(p.phone || '—')}</td><td>${esc(p.hours || '—')}</td>
      <td>${p.last_confirmed_at ? `<span class="pill ${p.last_confirmed_at > fresh ? 'p-good' : 'p-warn'}">${new Date(p.last_confirmed_at).toLocaleDateString()}</span>` : '<span class="pill p-warn">never</span>'}${p.operational === 'closed' ? ' <span class="pill p-rejected">closed</span>' : ''}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-fv="${p.id}">Verify today</button>${D.me.user.moderator ? ` <button class="btn sm" data-fe="${p.id}">Edit</button> <button class="btn sm" data-fd="${p.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No facilities match.</td></tr>'}</tbody></table>`;
  const act = (sel, fn) => $$(sel).forEach(b => b.onclick = async () => { try { await fn(b); } catch (e) { toast(e.message); } });
  act('[data-fv]', async b => { await api(`/api/places/${b.dataset.fv}/verify`, { method: 'POST' }); toast('Verified today'); loadFac(); });
  act('[data-fe]', b => facForm(list.find(p => p.id === +b.dataset.fe)));
  act('[data-fd]', async b => { if (!confirmBox()) return; await api('/api/places/' + b.dataset.fd, { method: 'DELETE' }); toast('Deleted'); loadFac(); });
}
function confirmBox() { return true; } // destructive actions are recorded in the audit log
function facForm(p) {
  modal(`<h2>${p ? 'Edit facility' : 'Add facility'}</h2><form id="fF"><div class="grid g2">
    <label>Type<br><select name="category" style="width:100%">${Object.entries(CATS).map(([k, l]) => `<option value="${k}" ${p && p.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Name<br><input type="text" name="name" required maxlength="100" value="${esc(p ? p.name : '')}" style="width:100%"></label>
    <label>Phone<br><input type="text" name="phone" maxlength="40" value="${esc(p ? p.phone || '' : '')}" style="width:100%"></label>
    <label>Opening hours<br><input type="text" name="hours" maxlength="60" value="${esc(p ? p.hours || '' : '')}" style="width:100%"></label></div>
    <label>Address / landmark<br><input type="text" name="address" maxlength="160" value="${esc(p ? p.address || '' : '')}" style="width:100%"></label>
    <div id="fMap" class="map" style="height:220px;margin-top:10px"></div><div class="small">Click the map to place it.</div>
    <label class="row" style="margin-top:8px"><input type="checkbox" name="verified"> Verified today (I have confirmed the details)</label>
    <div class="row between" style="margin-top:12px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
  let pos = p ? [p.lat, p.lng] : null;
  setTimeout(() => {
    const m = L.map('fMap').setView(pos || (D.map ? [D.map.getCenter().lat, D.map.getCenter().lng] : [9.08, 8.68]), pos ? 14 : 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(m);
    let mk = pos ? L.marker(pos).addTo(m) : null;
    m.on('click', e => { pos = [e.latlng.lat, e.latlng.lng]; if (mk) m.removeLayer(mk); mk = L.marker(pos).addTo(m); });
  }, 30);
  $('#fF').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (!pos) return toast('Click the map to set the location');
    f.lat = pos[0]; f.lng = pos[1]; const verify = !!f.verified; delete f.verified;
    try {
      let id = p && p.id;
      if (p) await api('/api/places/' + p.id, { method: 'PUT', body: f }); else id = (await api('/api/places', { method: 'POST', body: { ...f, verified: verify } })).id;
      if (p && verify) await api(`/api/places/${id}/verify`, { method: 'POST' });
      closeModal(); toast('Saved'); loadFac();
    } catch (x) { toast(x.message); }
  };
}

// ---------------- 8. User management ----------------
async function vUsers(v) {
  D.uf = D.uf || { q: '', role: '' };
  if (!D.orgs) D.orgs = await api('/api/dash/orgs');
  v.innerHTML = `<h1>User Management</h1><p class="sub">Accounts, roles and permissions. Role changes sign the person out so new permissions apply immediately.</p>
    <div class="filters"><input type="text" id="uQ" placeholder="Name, email or phone" value="${esc(D.uf.q)}"><select id="uR">${[['', 'All roles'], ['pending', 'Security awaiting verification'], ['traveller', 'Travellers'], ['security', 'Security'], ['moderator', 'Moderators'], ['admin', 'Admins']].map(([k, l]) => `<option value="${k}" ${D.uf.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn" id="uGo">Search</button></div>
    <div class="card"><div class="tablewrap" style="max-height:calc(100vh - 280px)" id="uList">Loading…</div></div>`;
  $('#uGo').onclick = () => { D.uf.q = $('#uQ').value; loadUsers(); };
  $('#uQ').onkeydown = e => { if (e.key === 'Enter') $('#uGo').click(); };
  $('#uR').onchange = e => { D.uf.role = e.target.value; loadUsers(); };
  loadUsers();
}
async function loadUsers() {
  const list = await api('/api/dash/users?q=' + encodeURIComponent(D.uf.q) + '&role=' + D.uf.role);
  $('#uList').innerHTML = `<table><thead><tr><th>Person</th><th>Role</th><th>Agency</th><th>Security</th><th>2-step</th><th class="n">Trust</th><th>Last active</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td><b>${esc(u.name)}</b>${u.banned ? ' <span class="pill p-rejected">suspended</span>' : ''}<div class="small">${esc(u.email)} · ${esc(u.phone || '')} · ${u.reports} reports</div></td>
      <td><select data-role="${u.id}">${['traveller', 'security', 'moderator', 'admin'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td><select data-org="${u.id}"><option value="">—</option>${D.orgs.map(o => `<option value="${o.id}" ${u.org_id === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select><br><select data-orgrole="${u.id}" style="margin-top:3px"><option value="">—</option><option ${u.org_role === 'officer' ? 'selected' : ''}>officer</option><option ${u.org_role === 'supervisor' ? 'selected' : ''}>supervisor</option></select></td>
      <td>${u.security_status === 'pending' ? `<span class="pill p-warn">awaiting</span><div class="small">${esc(u.agency || '')}</div><button class="btn sm primary" data-ver="${u.id}">Verify</button> <button class="btn sm" data-dec="${u.id}">Decline</button>` : esc(u.security_status || '—')}</td>
      <td>${u.totp_enabled ? '🔐 on' : ['admin', 'moderator', 'security'].includes(u.role) ? '<span class="pill p-warn">off</span>' : 'off'}</td><td class="n">${Math.round(u.trust * 100)}%${u.trusted ? ' ⭐' : ''}</td><td>${u.last_seen ? ago(u.last_seen) : '—'}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-trust="${u.id}" data-val="${u.trusted ? 0 : 1}">${u.trusted ? 'Untrust' : '⭐ Trust'}</button> ${u.totp_enabled ? `<button class="btn sm" data-mfa="${u.id}">Reset 2-step</button> ` : ''}<button class="btn sm ${u.banned ? '' : 'danger'}" data-ban="${u.id}" data-val="${u.banned ? 0 : 1}">${u.banned ? 'Restore' : 'Suspend'}</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No users found.</td></tr>'}</tbody></table>`;
  const upd = async (id, body, msg) => { try { await api('/api/admin/users/' + id, { method: 'POST', body }); toast(msg || 'Updated'); loadUsers(); } catch (e) { toast(e.message); } };
  $$('[data-role]').forEach(s => s.onchange = () => upd(s.dataset.role, { role: s.value }, 'Role changed'));
  $$('[data-org]').forEach(s => s.onchange = () => upd(s.dataset.org, { org_id: s.value }));
  $$('[data-orgrole]').forEach(s => s.onchange = () => upd(s.dataset.orgrole, { org_role: s.value }));
  $$('[data-ver]').forEach(b => b.onclick = () => upd(b.dataset.ver, { role: 'security', security_status: 'verified' }, 'Verified as security'));
  $$('[data-dec]').forEach(b => b.onclick = () => upd(b.dataset.dec, { security_status: 'rejected' }, 'Declined'));
  $$('[data-trust]').forEach(b => b.onclick = () => upd(b.dataset.trust, { trusted: b.dataset.val === '1' }));
  $$('[data-mfa]').forEach(b => b.onclick = () => upd(b.dataset.mfa, { reset_mfa: true }, 'Two-step reset'));
  $$('[data-ban]').forEach(b => b.onclick = () => upd(b.dataset.ban, { banned: b.dataset.val === '1' }, b.dataset.val === '1' ? 'Suspended' : 'Restored'));
}

// ---------------- 9. Analytics ----------------
async function vAnalytics(v) {
  const a = await api('/api/dash/analytics?' + qs());
  const areaL = a.level === 'state' ? 'State' : 'LGA';
  const csv = t => `<a class="btn sm" href="/api/dash/analytics?${qs({ format: 'csv', table: t })}">⬇ CSV</a>`;
  const layerTable = (rows, empty) => rows.length ? `<table><thead><tr><th>${areaL}</th><th class="n">Community reports<br><span class="small">not confirmed</span></th><th class="n">Verified</th><th class="n">Official</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.area)}</td><td class="n">${r.community}</td><td class="n">${r.verified}</td><td class="n">${r.official}</td><td style="width:90px">${layerBar(r)}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${empty}</div>`;
  const n = a.notifications, rate = ch => { const x = n[ch] || {}; const tot = (x.sent || 0) + (x.delivered || 0) + (x.failed || 0) + (x.pending || 0); return tot ? `${tot} sent · ${x.delivered || 0} confirmed delivered · ${x.failed || 0} failed (${Math.round((x.failed || 0) / tot * 100)}%)` : 'none'; };
  v.innerHTML = `<h1>Analytics</h1><p class="sub">${D.state ? esc(D.state) + ' State, by LGA' : D.me.scope ? 'My jurisdiction, by state' : 'Nigeria, by state'} · last ${a.days} days. Community reports are counted separately and are never presented as confirmed crime statistics.</p>
  <div class="grid g4">
    <div class="card kpi"><span>SOS — median time to acknowledge</span><b>${dur(a.response.median_ack_min)}</b><small>90% within ${dur(a.response.p90_ack_min)} · ${a.response.acknowledged}/${a.response.sos} acknowledged</small></div>
    <div class="card kpi"><span>SOS — median time to scene</span><b>${dur(a.response.median_scene_min)}</b><small>90% within ${dur(a.response.p90_scene_min)}</small></div>
    <div class="card kpi"><span>Verification turnaround</span><b>${a.verification.median_hours == null ? '—' : a.verification.median_hours + ' h'}</b><small>${a.verification.verified} verified · ${a.verification.rejected} rejected · ${a.verification.pending} pending of ${a.verification.reports}</small></div>
    <div class="card kpi"><span>Journeys</span><b>${num(a.journeys.n)}</b><small>${a.journeys.arrived || 0} arrived · ${a.journeys.missed || 0} with a missed check-in</small></div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><div class="row between"><h2>Security incidents by ${areaL.toLowerCase()}</h2>${csv('security')}</div><div class="tablewrap">${layerTable(a.by_area, 'No security incidents in this period.')}</div></div>
    <div class="card"><div class="row between"><h2>Kidnapping</h2>${csv('kidnap')}</div><div class="tablewrap">${layerTable(a.kidnap, 'No kidnapping reports in this period.')}</div></div>
    <div class="card"><div class="row between"><h2>Armed robbery and attacks</h2>${csv('robbery')}</div><div class="tablewrap">${layerTable(a.robbery, 'None in this period.')}</div></div>
    <div class="card"><div class="row between"><h2>Flood-affected communities</h2>${csv('floods')}</div><div class="tablewrap">${a.floods.length ? `<table><thead><tr><th>Community</th><th>LGA</th><th class="n">Community reports</th><th class="n">Verified</th><th class="n">Official</th></tr></thead><tbody>${a.floods.map(f => `<tr><td>${esc(f.place)}</td><td>${esc(f.lga)}<div class="small">${esc(f.state)}</div></td><td class="n">${f.community_reports}</td><td class="n">${f.verified}</td><td class="n">${f.official}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No flood reports in this period.</div>'}</div></div>
    <div class="card"><div class="row between"><h2>Emergency response by ${areaL.toLowerCase()}</h2>${csv('response')}</div><div class="tablewrap">${a.response.by_area.length ? `<table><thead><tr><th>${areaL}</th><th class="n">SOS</th><th class="n">Never acknowledged</th><th class="n">Median ack</th><th class="n">Median to scene</th><th class="n">False alarms</th></tr></thead><tbody>${a.response.by_area.map(r => `<tr><td>${esc(r.area)}</td><td class="n">${r.sos}</td><td class="n">${r.unacknowledged}</td><td class="n">${dur(r.median_ack_min)}</td><td class="n">${dur(r.median_scene_min)}</td><td class="n">${r.false_alarms}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No SOS in this period.</div>'}</div></div>
    <div class="card"><h2>Alert delivery</h2><p><b>App notifications:</b> ${rate('push')}</p><p><b>SMS:</b> ${rate('sms')}</p><p><b>Voice calls:</b> ${rate('voice')}</p><p class="small">"Confirmed delivered" means the phone reported showing it, or the SMS/call provider confirmed delivery.</p></div>
  </div>`;
}

// ---------------- 10. System configuration ----------------
async function vConfig(v) {
  const bs = await api('/api/bootstrap'); D.types = bs.types; D.settings = bs.settings;
  const s = D.settings;
  const field = (k, l, hint) => `<tr><td>${l}${hint ? `<div class="small">${hint}</div>` : ''}</td><td style="width:140px"><input type="text" data-set="${k}" value="${esc(s[k] ?? '')}" style="width:130px"></td></tr>`;
  v.innerHTML = `<h1>System Configuration</h1><p class="sub">Risk rules, notification settings and operational controls. Every change is recorded in the audit log.</p>
  <div class="grid g2">
    <div class="card"><h2>Operational controls</h2>
      <div class="switch"><div><b>Community alerts</b><small>Location-based push alerts to the public</small></div><input type="checkbox" data-sw="community_alerts_enabled" ${s.community_alerts_enabled !== '0' ? 'checked' : ''}></div>
      <div class="switch"><div><b>Public reporting</b><small>New reports from the public (staff can always post)</small></div><input type="checkbox" data-sw="public_reporting_enabled" ${s.public_reporting_enabled !== '0' ? 'checked' : ''}></div>
      <label class="small" style="display:block;margin-top:10px">Notice shown at the top of the app (leave empty for none)</label><textarea id="notice" rows="2" maxlength="300" style="width:100%">${esc(s.notice_text || '')}</textarea>
      <button class="btn primary" id="saveOps" style="margin-top:8px">Save controls</button></div>
    <div class="card"><h2>SOS and notifications</h2><table>${field('sos_escalate_min', 'Widen alert after (min) without acknowledgement')}${field('sos_escalate2_min', 'Alert all responders after (min)')}${field('sos_radius_km', 'Responder alert radius (km)')}
      ${field('community_alerts_per_hour', 'Community alerts per person per hour')}${field('deviation_km', 'Journey off-route distance (km)')}${field('arrive_radius_m', 'Arrival radius (m)')}${field('reports_per_hour', 'Reports per person per hour')}</table></div>
    <div class="card"><h2>Risk scoring rules</h2><table>${field('level_cutoffs', 'Moderate, High, Severe start at')}${field('tourist_shift', 'Tourist Mode warns earlier by')}${field('time_dusk', 'Dusk multiplier (18–21h)')}${field('time_night', 'Night multiplier (21–06h)')}
      ${field('history_radius_km', 'Past-incident radius (km)')}${field('history_cap', 'Max points from past incidents')}${field('no_post_pts', 'Points if no security post within 10 km')}${field('post_confirm_days', 'Days a post stays confirmed')}
      ${field('rain_heavy_mm3h', 'Heavy rain (mm in 3 h)')}${field('rain_heavy_pts', 'Points for heavy rain')}${field('public_min_confidence', 'Unverified security report public from (0–1)', 'Below this, a single community report stays hidden')}
      ${field('corroborate_km', 'Similar reports corroborate within (km)')}${field('corroborate_hours', '…and within (hours)')}${field('heatmap_min_count', 'Public heatmap hides areas with fewer than')}${field('facility_verify_days', 'Facility listing stays verified (days)')}</table>
      <button class="btn primary" id="saveSet" style="margin-top:8px">Save settings</button></div>
    <div class="card"><h2>Incident categories</h2><p class="small" style="margin-top:0">Points · warning radius (km) · lifetime (h) · half-life (h)</p><div class="tablewrap" style="max-height:420px"><table>${Object.values(D.types).map(t => `<tr><td>${t.icon} ${esc(t.label)}<div class="small">${t.grp}</div></td>
      <td style="white-space:nowrap"><input type="text" data-tw="${t.key}" value="${t.weight}" style="width:50px"> <input type="text" data-tr="${t.key}" value="${t.radius_km}" style="width:46px"> <input type="text" data-tt="${t.key}" value="${t.ttl_hours}" style="width:58px"> <input type="text" data-th="${t.key}" value="${t.half_life_h}" style="width:58px"></td></tr>`).join('')}</table></div>
      <button class="btn primary" id="saveTypes" style="margin-top:8px">Save categories</button></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="row between"><div><h2>Area types (settlement)</h2><p class="small" style="margin:0">Urban, peri-urban, rural or forest / isolated stretch. Adds an isolation factor that rises after dark. The smallest area containing a point wins; anywhere not covered counts as rural.</p></div></div>
    <div class="grid g-map" style="margin-top:10px"><div><div id="zMap" class="map" style="height:360px"></div><div class="small">Click the map to add an area.</div></div>
    <div class="tablewrap" style="max-height:380px"><table><thead><tr><th>Area</th><th>Type</th><th class="n">Radius</th><th></th></tr></thead><tbody>${(bs.zones || []).map(z => `<tr><td>${esc(z.name)}</td><td>${esc(ZONE_T[z.type] || z.type)}</td><td class="n">${z.radius_km} km</td><td><button class="btn sm" data-zdel="${z.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No areas yet.</td></tr>'}</tbody></table></div></div></div>
  <div class="card" style="margin-top:14px"><div class="row between"><h2>Audit log</h2><div class="row"><input type="text" id="auQ" placeholder="Filter by action or person"><button class="btn" id="auGo">Filter</button></div></div><div class="tablewrap" id="auList" style="max-height:420px">Loading…</div></div>`;
  const save = async (body, msg) => { try { await api('/api/settings', { method: 'PUT', body }); toast(msg); const bs2 = await api('/api/bootstrap'); D.settings = bs2.settings; } catch (e) { toast(e.message); } };
  $('#saveOps').onclick = () => save({ community_alerts_enabled: $('[data-sw=community_alerts_enabled]').checked ? '1' : '0', public_reporting_enabled: $('[data-sw=public_reporting_enabled]').checked ? '1' : '0', notice_text: $('#notice').value }, 'Controls saved');
  $('#saveSet').onclick = () => { const b = {}; $$('[data-set]').forEach(i => { b[i.dataset.set] = i.value; }); save(b, 'Settings saved'); };
  $('#saveTypes').onclick = async () => {
    try { for (const t of Object.values(D.types)) { const g = k => $(`[data-${k}="${t.key}"]`).value; if (+g('tw') !== t.weight || +g('tr') !== t.radius_km || +g('tt') !== t.ttl_hours || +g('th') !== t.half_life_h) await api('/api/types/' + t.key, { method: 'PUT', body: { weight: g('tw'), radius_km: g('tr'), ttl_hours: g('tt'), half_life_h: g('th') } }); } toast('Categories saved'); }
    catch (e) { toast(e.message); }
  };
  const loadAudit = async () => { const list = await api('/api/dash/audit?q=' + encodeURIComponent($('#auQ').value)); $('#auList').innerHTML = `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${list.map(a => `<tr><td>${when(a.at)}</td><td>${esc(a.name || '—')}<div class="small">${esc(a.role || '')} · ${esc(a.ip || '')}</div></td><td>${esc(a.action.replace(/_/g, ' '))}</td><td>${esc(a.target_type || '')} ${a.target_id ?? ''}</td><td class="small" style="max-width:360px;overflow-wrap:anywhere">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table>`; };
  $('#auGo').onclick = loadAudit; loadAudit();
  const zm = newMap('zMap'); const zc = { urban: '#3b82f6', peri: '#22c55e', rural: '#f59e0b', forest: '#a855f7' }; const zpts = [];
  (bs.zones || []).forEach(z => { zpts.push([z.lat, z.lng]); L.circle([z.lat, z.lng], { radius: z.radius_km * 1000, color: zc[z.type], weight: 1.5, fillOpacity: .15 }).bindTooltip(`${esc(z.name)} · ${ZONE_T[z.type]}`).addTo(zm); });
  if (zpts.length) zm.fitBounds(L.latLngBounds(zpts).pad(.3), { maxZoom: 11 });
  zm.on('click', e => {
    const p = [e.latlng.lat, e.latlng.lng];
    modal(`<h2>Add an area type</h2><p class="small">Centre ${p[0].toFixed(4)}, ${p[1].toFixed(4)}</p><form id="zF"><label>Name<br><input type="text" name="name" required maxlength="80" style="width:100%" placeholder="e.g. Owerri municipal"></label>
      <label>Type<br><select name="type" style="width:100%">${Object.entries(ZONE_T).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Radius (km, up to 50)<br><input type="text" name="radius_km" value="3" style="width:100%"></label>
      <div class="row between" style="margin-top:12px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`);
    $('#zF').onsubmit = async ev => { ev.preventDefault(); try { await api('/api/zones', { method: 'POST', body: { ...Object.fromEntries(new FormData(ev.target)), lat: p[0], lng: p[1] } }); closeModal(); toast('Area saved'); render(); } catch (x) { toast(x.message); } };
  });
  $$('[data-zdel]').forEach(b => b.onclick = async () => { try { await api('/api/zones/' + b.dataset.zdel, { method: 'DELETE' }); toast('Area deleted'); render(); } catch (x) { toast(x.message); } });
}

// ---------------- render ----------------
const VIEWS = { overview: vOverview, live: vLive, sos: vSos, intel: vIntel, verify: vVerify, agencies: vAgencies, facilities: vFacilities, users: vUsers, analytics: vAnalytics, config: vConfig };
async function render() {
  D.timers.forEach(clearInterval); D.timers = []; D.liveLayer = null; D.sosLayer = null;
  $('#drawer').hidden = true;
  const v = $('#view'); v.innerHTML = '<div class="empty">Loading…</div>';
  try { await VIEWS[D.mod](v); } catch (e) { if (e.status === 401 || e.status === 403) return boot(); v.innerHTML = `<div class="card"><b>Could not load this module.</b><p class="small">${esc(e.message)}</p></div>`; }
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h !== D.mod && VIEWS[h]) { D.mod = h; renderNav(); render(); } });
boot();
})();
