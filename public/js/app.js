/* SafeRoute Naija v4 — traveller app */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = d => !isFinite(d) ? '—' : d < 1 ? Math.round(d * 100) * 10 + ' m' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
const clock = h => { h = ((h % 24) + 24) % 24; return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60) % 60).padStart(2, '0'); };
const R = window.SafeRisk;
const { km, nearest, LEVELS, SECURITY_CATS, SETTLE_LABEL, timeLabel } = R;

const CAT = {
  police: { label: 'Police', icon: '👮', bg: '#1d4ed8' }, frsc: { label: 'FRSC', icon: '🦺', bg: '#0e7490' },
  military: { label: 'Military', icon: '🪖', bg: '#3f6212' }, nscdc: { label: 'NSCDC', icon: '🛡️', bg: '#1e40af' },
  hospital: { label: 'Hospital', icon: '🏥', bg: '#be123c' }, clinic: { label: 'Clinic', icon: '⚕️', bg: '#e11d48' },
  mechanic: { label: 'Mechanic', icon: '🔧', bg: '#57534e' }, vulcaniser: { label: 'Vulcaniser', icon: '🛞', bg: '#44403c' },
  fuel: { label: 'Fuel', icon: '⛽', bg: '#4d7c0f' }
};
const STATUS = {
  unverified: { label: 'Unverified', cls: 'st-unv', help: 'Submitted by a community member' },
  investigating: { label: 'Under investigation', cls: 'st-inv', help: 'Being reviewed by moderators or responders' },
  verified: { label: 'Verified', cls: 'st-ver', help: 'Confirmed by a trusted source' },
  resolved: { label: 'Resolved / expired', cls: 'st-res', help: 'Incident has ended or is no longer current' },
  rejected: { label: 'Rejected', cls: 'st-rej', help: 'Not accepted by moderators' }
};
const SOURCE = { witness: 'I saw it myself', nearby: 'Someone nearby told me', official: 'Official source', social: 'Social media or news' };
const SOS_TYPES = [['attack', '🔫 Attack / robbery'], ['kidnap', '🚨 Kidnapping'], ['accident', '💥 Accident'], ['medical', '🚑 Medical'], ['fire', '🔥 Fire'], ['other', '🆘 Other']];
const TEST_ROUTE = [[5.4836,7.0333],[5.4700,7.0200],[5.4560,7.0050],[5.4380,6.9900],[5.4200,6.9750],[5.4000,6.9640],[5.3800,6.9550],[5.3550,6.9470],[5.3300,6.9400],[5.3000,6.9300],[5.2700,6.9200],[5.2350,6.9050],[5.2000,6.8900],[5.1650,6.8650],[5.1300,6.8400],[5.0930,6.8130],[5.0600,6.8200],[5.0300,6.8300],[4.9950,6.8450],[4.9600,6.8600],[4.9300,6.8850],[4.9000,6.9100],[4.8800,6.9350],[4.8600,6.9600],[4.8450,6.9800],[4.8400,7.0000],[4.8280,7.0250],[4.8156,7.0498]];

// ---------------- state ----------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('sr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sr_' + k, JSON.stringify(v)); } catch (e) {} }
};
const S = {
  user: null, data: { types: {}, settings: {}, places: [], zones: [], reports: [], history: [] }, tab: 'map',
  pos: null, heading: null, speed: 0, mode: 'none', // none | gps | placed | test
  warn: store.get('warn', true), voice: store.get('voice', true), tourist: store.get('tourist', false), driver: false,
  planHour: null, follow: true, sat: store.get('sat', true), lastLevel: 0, alerted: new Map(), pick: null,
  weather: null, weatherAt: null, circle: [], myShare: null, sos: null, sosList: [], sosSeen: new Set(store.get('sosSeen', [])),
  users: [], stats: null, myReports: [], test: null,
  journey: { from: null, to: null, depart: null, routes: [], sel: 0, busy: false, error: '' }, trip: null, pushOn: false
};
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
const travelHour = () => S.planHour == null ? hourNow() : S.planHour;
const isMod = () => S.user && ['moderator', 'admin'].includes(S.user.role);
const isSecurity = () => S.user && ((S.user.role === 'security' && S.user.security_status === 'verified') || S.user.role === 'admin');
const isAdmin = () => S.user && S.user.role === 'admin';
const active = r => R.isActive(r, Date.now());
const T = k => S.data.types[k] || { label: k, icon: '•', color: '#64748b', grp: 'road', weight: 0, radius_km: 1 };

// ---------------- api ----------------
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (init.method !== 'GET') init.headers['X-CSRF-Token'] = csrfToken();
  if (opts.form) init.body = opts.form;
  else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  let json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((json && json.error) || 'Something went wrong (' + res.status + ')'); err.status = res.status; err.data = json;
    if (json && json.mfa_setup_required && !opts.quiet) setTimeout(() => mfaSetup(true), 0);
    throw err;
  }
  return json;
}
let firstLoad = true;
async function load() {
  try {
    const d = await api('/api/bootstrap');
    const prevUser = S.user && S.user.id;
    S.user = d.user; S.data = d;
    const age = Date.now() - (d.generated_at || Date.now());
    S.stale = !navigator.onLine || age > 5 * 60000 ? d.generated_at : null;
    showOffline();
    mergePacks();
    setUnread(d.unread || 0);
    if (firstLoad && !store.get('view', null)) {
      const pts = d.places.map(p => [p.lat, p.lng]).concat(d.reports.map(r => [r.lat, r.lng]));
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.1));
    }
    if (S.user && S.user.id !== prevUser) { loadCircle(); loadMySos(); loadJourney(); flushQueue(); if (S.user.mfa_needed) setTimeout(() => mfaSetup(true), 600); }
  } catch (e) { S.stale = S.stale || (S.data.generated_at || 1); mergePacks(); showOffline(); }
  if (firstLoad) handleUrl();
  firstLoad = false;
  renderTabs(); drawMap();
  const typing = document.activeElement && $('#panel').contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (!S.pick && !typing && S.tab !== 'journey') renderPanel(); else update();
  if (isSecurity()) loadSos();
}
async function loadCircle() { if (!S.user) return; try { S.circle = await api('/api/circle'); S.myShare = await api('/api/share/mine'); await loadAlertPrefs(); } catch (e) {} if (S.tab === 'circle') renderPanel(); }
async function loadMySos() {
  if (!S.user) return;
  try { S.sos = await api('/api/sos/mine'); } catch (e) { return; }
  $('#sos').classList.toggle('active', !!S.sos);
  if (S.sos && $('#modal').classList.contains('show') && $('#sosLive')) sosLiveView();
}
async function loadSos() {
  try {
    S.sosList = await api('/api/sos');
    const fresh = S.sosList.filter(s => s.status === 'open' && !S.sosSeen.has(s.id));
    if (fresh.length && !firstSosLoad) {
      sound('avoid'); toast(`🆘 New SOS ${fresh[0].ref} — open the Command Centre`, 6000);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') try { new Notification('🆘 SOS ' + fresh[0].ref, { body: fresh[0].type_label + ' — ' + (fresh[0].name || ''), icon: '/icons/icon-192.png' }); } catch (e) {}
    }
    firstSosLoad = false;
    renderTabs(); drawSos();
    if (S.tab === 'security' && !(document.activeElement && $('#panel').contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) renderPanel();
  } catch (e) {}
}
let firstSosLoad = true;
function markSosSeen(id) { S.sosSeen.add(id); store.set('sosSeen', Array.from(S.sosSeen).slice(-200)); }

// ---------------- map ----------------
const map = L.map('map', { zoomControl: false }).setView(store.get('view', [9.07, 7.49]), store.get('zoom', 6));
L.control.zoom({ position: 'bottomleft' }).addTo(map);
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
function setBase() {
  [satLayer, satLabels, streetLayer].forEach(l => map.hasLayer(l) && map.removeLayer(l));
  if (S.sat) { satLayer.addTo(map); satLabels.addTo(map); $('#btnLayer').textContent = '🛰️'; } else { streetLayer.addTo(map); $('#btnLayer').textContent = '🗺️'; }
}
setBase();
map.on('moveend', () => { const c = map.getCenter(); store.set('view', [c.lat, c.lng]); store.set('zoom', map.getZoom()); });
map.on('dragstart', () => { S.follow = false; });
const gZones = L.layerGroup().addTo(map), gRisk = L.layerGroup().addTo(map), gRoutes = L.layerGroup().addTo(map), gReports = L.layerGroup().addTo(map),
  gPlaces = L.layerGroup().addTo(map), gSos = L.layerGroup().addTo(map), gJourney = L.layerGroup().addTo(map);
const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 });
let accCircle = null, pickMarker = null;
const icon = (html, size) => L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

function drawMap() {
  gZones.clearLayers(); gRisk.clearLayers(); gReports.clearLayers(); gPlaces.clearLayers();
  if (isAdmin() && S.tab === 'admin') for (const z of S.data.zones) L.circle([z.lat, z.lng], { radius: z.radius_km * 1000, color: '#94a3b8', weight: 1, dashArray: '4 4', fillOpacity: .04, interactive: false }).addTo(gZones);
  for (const r of S.data.reports) {
    if (!['unverified', 'investigating', 'verified'].includes(r.status)) continue;
    const t = T(r.type);
    const pub = r.public !== false;
    if (pub && active(r)) L.circle([r.lat, r.lng], { radius: t.radius_km * 1000, color: t.color, weight: 1, opacity: .5, fillOpacity: r.status === 'verified' ? .1 : .05, dashArray: r.status === 'verified' ? null : '5 5', interactive: false }).addTo(gRisk);
    const cls = r.status === 'verified' ? '' : r.status === 'investigating' ? ' mk-inv' : ' mk-unv';
    L.marker([r.lat, r.lng], { opacity: pub ? 1 : .6, icon: icon(`<div class="mk${cls}" style="width:32px;height:32px;background:${pub ? t.color : '#334155'}">${t.icon}</div>`, 32) })
      .bindPopup(() => reportPopup(r), { maxWidth: 300 }).addTo(gReports);
  }
  for (const p of S.data.places) {
    const c = CAT[p.category] || CAT.police;
    L.marker([p.lat, p.lng], { icon: icon(`<div class="mk sq${p.operational === 'closed' ? ' mk-closed' : ''}" style="width:26px;height:26px;background:${c.bg}">${c.icon}</div>`, 26) })
      .bindPopup(() => placePopup(p)).addTo(gPlaces);
  }
  drawSos(); drawTestRoute();
}
function placePopup(p) {
  const c = CAT[p.category] || CAT.police;
  const sec = SECURITY_CATS.includes(p.category);
  const st = !sec ? (p.last_confirmed_at ? '<br><span class="small">✅ Verified ' + fmtDate(p.last_confirmed_at) + '</span>' : '') : p.operational === 'confirmed' && p.last_confirmed_at ? `<br><span class="small">✅ Confirmed operating ${ago(p.last_confirmed_at)}</span>` : p.operational === 'closed' ? '<br><span class="small">⛔ Reported closed</span>' : '<br><span class="small">Operating status not confirmed</span>';
  return `<b>${c.icon} ${esc(p.name)}</b><br><span class="small">${c.label}${p.hours ? ' · ' + esc(p.hours) : ''}${p.phone ? ' · <a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a>' : ''}</span>${st}
    <div style="margin-top:8px"><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Directions</a></div>`;
}
function statusPill(r) {
  const s = STATUS[r.status] || STATUS.unverified;
  return `<span class="pill ${s.cls}" title="${s.help}">${r.official && r.status === 'verified' ? 'Official' : s.label}</span>`;
}
function reportFacts(r) {
  const f = [];
  if (r.ongoing === 1) f.push('Ongoing'); else if (r.ongoing === 0) f.push('Over');
  if (r.injured === 1) f.push('People injured'); if (r.trapped === 1) f.push('People trapped');
  if (r.affected) f.push(r.affected + ' affected');
  if (r.source) f.push('Source: ' + (SOURCE[r.source] || r.source));
  return f.join(' · ');
}
function media(r, w) {
  if (!r.media) return r.has_media ? '<div class="small">📎 Evidence attached (visible to moderators)</div>' : '';
  return r.media_type === 'video' ? `<video src="${esc(r.media)}" controls preload="metadata" style="max-width:${w}px;width:100%;border-radius:8px;margin-top:6px"></video>`
    : `<img src="${esc(r.media)}" alt="Evidence photo" style="max-width:${w}px;width:100%;border-radius:8px;margin-top:6px">`;
}
function reportPopup(r) {
  const t = T(r.type), c = r.counts || {};
  return `<div class="pop"><b>${t.icon} ${esc(t.label)}</b> ${statusPill(r)}
    <div class="small" style="margin:3px 0">${esc(r.confLabel || '')}${r.disputed ? ' · <b style="color:#fca5a5">disputed</b>' : ''} · ${ago(r.occurred_at || r.created_at)} · ${esc(r.by_name)}</div>
    ${r.public === false ? '<div class="small" style="color:#fcd34d">Not public yet: single unconfirmed report.</div>' : ''}
    ${r.note ? `<div>${esc(r.note)}</div>` : ''}<div class="small">${esc(reportFacts(r))}</div>
    ${r.responding_by ? '<div class="small" style="color:#fcd34d;font-weight:700">🚔 Security responding</div>' : ''}
    ${media(r, 260)}
    <div class="small" style="margin-top:6px">✔ ${c.confirm || 0} confirmed · ⏳ ${c.ongoing || 0} still happening · ✅ ${c.resolved || 0} resolved · ❓ ${c.inaccurate || 0} inaccurate</div>
    <div class="confirm-grid">
      ${r.mine ? `<button class="btn sm" data-conf="resolved" data-id="${r.id}">✅ It's resolved</button>` : `
      <button class="btn sm" data-conf="confirm" data-id="${r.id}">✔ I can confirm</button>
      <button class="btn sm" data-conf="ongoing" data-id="${r.id}">⏳ Still happening</button>
      <button class="btn sm" data-conf="resolved" data-id="${r.id}">✅ Resolved</button>
      <button class="btn sm" data-conf="inaccurate" data-id="${r.id}">❓ Seems inaccurate</button>`}
    </div></div>`;
}
map.on('popupopen', e => {
  e.popup.getElement().querySelectorAll('[data-conf]').forEach(b => b.onclick = async () => {
    if (!S.user) return authModal('Sign in to confirm reports. Confirmations from people nearby count the most.');
    const body = { kind: b.dataset.conf };
    if (S.pos) { body.lat = S.pos[0]; body.lng = S.pos[1]; }
    try {
      const r = await api(`/api/reports/${b.dataset.id}/confirm`, { method: 'POST', body });
      toast(r.closed ? 'Marked resolved — removed from the map' : r.distance_km != null && r.distance_km <= 2 ? 'Thanks — your nearby confirmation carries extra weight' : 'Thanks — recorded');
      map.closePopup(); load();
    } catch (err) { toast(err.message); }
  });
});
function drawSos() {
  gSos.clearLayers();
  if (!isSecurity()) return;
  for (const s of S.sosList.filter(s => s.status !== 'closed' || s.duress)) {
    if (s.trail && s.trail.length > 1) L.polyline(s.trail.map(p => [p.lat, p.lng]), { color: '#dc2626', weight: 3, dashArray: '4 6' }).addTo(gSos);
    L.marker([s.lat, s.lng], { zIndexOffset: 900, icon: icon(`<div class="mk" style="width:36px;height:36px;background:#dc2626">🆘</div>`, 36) })
      .bindPopup(`<b>SOS ${esc(s.ref || '')} — ${esc(s.name || 'User')}</b>${s.duress ? ' <span class="pill st-rej">DURESS</span>' : ''}<br>${esc(s.type_label)}${s.phone ? '<br><a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' : ''}<br><span class="small">${ago(s.created_at)} · updated ${ago(s.updated_at)} · ${s.status.replace('_', ' ')}</span>`).addTo(gSos);
  }
}

// ---------------- audio + voice ----------------
let actx = null;
function audio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; } return actx; }
function tone(f, start, dur, type, vol, slide) {
  const c = audio(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
  o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0); if (slide) o.frequency.linearRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .22, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .05);
}
function sound(kind) {
  if (kind === 'chime') { tone(880, 0, .35, 'sine', .2); tone(1320, .12, .4, 'sine', .15); }
  else if (kind === 'hazard') { tone(660, 0, .18, 'square', .12); tone(880, .22, .18, 'square', .12); }
  else if (kind === 'high') { for (let i = 0; i < 3; i++) tone(950, i * .28, .2, 'square', .16); }
  else if (kind === 'avoid') { for (let i = 0; i < 3; i++) tone(600, i * .7, .6, 'sawtooth', .14, 1200); }
}
let voices = [];
try { voices = speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); }; } catch (e) {}
function speak(text) {
  if (!S.voice) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find(v => /en[-_]NG/i.test(v.lang)) || voices.find(v => /en[-_]GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
let capTimer = null;
function announce(text, hex, snd, force) {
  if (!S.warn && !force) return;
  if (snd) sound(snd);
  setTimeout(() => speak(text), snd === 'avoid' ? 1900 : snd ? 700 : 0);
  if (navigator.vibrate) try { navigator.vibrate(snd === 'avoid' ? [300, 100, 300, 100, 300] : [200, 80, 200]); } catch (e) {}
  const c = $('#caption'); $('#captionT').textContent = text; c.style.borderLeftColor = hex || '#f59e0b';
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  clearTimeout(capTimer); capTimer = setTimeout(() => c.classList.remove('show'), 9000);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') try { new Notification('SafeRoute warning', { body: text, icon: '/icons/icon-192.png' }); } catch (e) {}
}

// ---------------- weather ----------------
async function weatherFor(p) {
  try { const w = await api(`/api/weather?lat=${p[0].toFixed(3)}&lng=${p[1].toFixed(3)}`); return w.unavailable ? null : w; } catch (e) { return null; }
}
async function refreshWeather() {
  if (!S.pos) return;
  if (S.weatherAt && km(S.weatherAt.p, S.pos) < 10 && Date.now() - S.weatherAt.t < 20 * 60000) return;
  S.weatherAt = { p: S.pos.slice(), t: Date.now() };
  S.weather = await weatherFor(S.pos);
  update();
}

// ---------------- risk + alerts loop ----------------
function hazardsAhead() {
  if (!S.pos) return [];
  const look = Math.max(.5, S.speed * (+S.data.settings.alert_lookahead_s || 45) / 3600 + .3);
  const out = [];
  for (const r of S.data.reports) {
    if (!active(r) || r.type === 'advisory') continue;
    const d = km(S.pos, [r.lat, r.lng]); if (d > 15) continue;
    let ahead = true;
    if (S.heading != null && S.speed > 5 && d > .15) {
      const toR = Math.PI / 180;
      const y = Math.sin((r.lng - S.pos[1]) * toR) * Math.cos(r.lat * toR);
      const x = Math.cos(S.pos[0] * toR) * Math.sin(r.lat * toR) - Math.sin(S.pos[0] * toR) * Math.cos(r.lat * toR) * Math.cos((r.lng - S.pos[1]) * toR);
      const diff = Math.abs((((Math.atan2(y, x) / toR + 360) % 360) - S.heading + 540) % 360 - 180);
      ahead = diff < 50;
    }
    if (ahead) out.push({ r, d, look });
  }
  return out.sort((a, b) => a.d - b.d);
}
function currentAssessment() {
  if (!S.pos) return null;
  return R.assess(S.pos, travelHour(), S.data, { tourist: S.tourist, weather: S.weather });
}
function update() {
  const hour = travelHour();
  $('#clockT').textContent = clock(hour);
  $('#clockD').textContent = (S.planHour == null ? '' : 'Planned · ') + timeLabel(hour);
  if (!S.pos) {
    $('#pill .dot').style.background = '#64748b'; $('#pillLvl').textContent = 'Location off'; $('#pillWhere').textContent = 'Tap “Start” to begin';
    renderStatus(null, []); return;
  }
  const a = currentAssessment();
  $('#pill .dot').style.background = a.hex;
  $('#pillLvl').textContent = LEVELS[a.level].long;
  $('#pillWhere').textContent = a.confLabel + ' · ' + a.zone.name;
  if (!map.hasLayer(meMarker)) meMarker.addTo(map);
  meMarker.setLatLng(S.pos);
  if (S.follow && S.mode !== 'none' && S.mode !== 'placed') map.panTo(S.pos, { animate: true, duration: .3 });
  const ah = hazardsAhead();
  if (S.mode !== 'none') {
    if (a.level > S.lastLevel && a.level >= 1) {
      const top = a.reasons.find(r => r.kind === 'threat' || r.kind === 'road');
      const lead = ['', 'Caution.', 'Warning.', 'Danger.'][a.level];
      const what = a.security.level >= a.road.level ? 'security risk' : 'road danger';
      announce(`${lead} ${LEVELS[a.level].name} ${what} here, ${a.confLabel.toLowerCase()}. ${top ? top.text.replace(/ —.*$/, '') + '. ' : ''}${a.action}`, a.hex, ['', 'chime', 'high', 'avoid'][a.level]);
    } else if (a.level < S.lastLevel && S.lastLevel >= 2 && a.level <= 1) announce('You are leaving the higher-risk area.', a.hex, 'chime');
    S.lastLevel = a.level;
    for (const h of ah) {
      const last = S.alerted.get(h.r.id);
      if (h.d <= h.look && (!last || Date.now() - last > 20 * 60000)) {
        S.alerted.set(h.r.id, Date.now());
        const t = T(h.r.type);
        const dist = h.d < .15 ? 'right here' : `${Math.round(h.d * 1000 / 50) * 50} metres ahead`;
        const conf = h.r.status === 'verified' ? (h.r.official ? 'confirmed by security' : 'verified') : 'unconfirmed';
        announce(`Caution. ${t.label} reported ${dist}, ${conf}. ${t.advice}`, t.color, 'hazard');
        break;
      }
    }
    tripGuidance();
  }
  if (S.driver) renderDriver(a, ah);
  renderStatus(a, ah);
}
function renderDriver(a, ah) {
  $('#dLvl').textContent = LEVELS[a.level].long.toUpperCase(); $('#dLvl').style.color = a.hex;
  $('#dWhere').textContent = `${a.confLabel} · ${a.zone.name} · ${timeLabel(travelHour())}`;
  const n = ah[0];
  $('#dNext').textContent = S.trip && S.trip.next ? S.trip.next : n ? `${T(n.r.type).icon} ${T(n.r.type).label} in ${fmtKm(n.d)}` : 'No reported hazards ahead';
  $('#dSpeed').textContent = Math.round(S.speed);
  $('#dPost').textContent = a.post ? fmtKm(a.post.d) : '—';
  const hp = nearest(S.pos, S.data.places, ['hospital', 'clinic']); $('#dHosp').textContent = hp ? fmtKm(hp.d) : '—';
}

// ---------------- location ----------------
let watchId = null, wakeLock = null, lastSent = 0;
function startGps(silent) {
  audio();
  if (!('geolocation' in navigator)) { if (!silent) toast('This browser cannot share location'); return; }
  stopTest(); stopGps();
  S.mode = 'gps'; S.follow = true; S.lastLevel = 0;
  if (!silent) toast('Finding your location…');
  watchId = navigator.geolocation.watchPosition(p => {
    const first = !S.pos || S.mode !== 'gps';
    S.mode = 'gps';
    S.pos = [p.coords.latitude, p.coords.longitude];
    S.speed = p.coords.speed != null ? p.coords.speed * 3.6 : S.speed;
    if (p.coords.heading != null && !isNaN(p.coords.heading)) S.heading = p.coords.heading;
    if (accCircle) map.removeLayer(accCircle);
    accCircle = L.circle(S.pos, { radius: p.coords.accuracy, color: '#3b82f6', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    if (first || map.getZoom() < 12) map.setView(S.pos, 14);
    refreshWeather(); sendLocation(); update();
  }, err => {
    if (S.mode === 'gps') S.mode = 'none'; renderPanel();
    toast(err.code === 1 ? 'Location permission was denied. Allow location for this site in your browser settings.' : 'Could not get your location. Move to open sky and try again.', 5000);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  if (!silent && 'Notification' in window && Notification.permission === 'default') try { Notification.requestPermission(); } catch (e) {}
  if (!silent) renderPanel();
}
function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (accCircle) { map.removeLayer(accCircle); accCircle = null; }
  if (S.mode === 'gps') S.mode = 'none';
}
// keeps live-sharing and SOS links updated (every 15 s during SOS, 30 s otherwise)
function sendLocation(force) {
  if (!S.user || !S.pos || S.mode === 'placed') return;
  sendPresence();
  if (!(S.sos || S.myShare || S.journeyActive)) return;
  const every = S.sos ? 15000 : 30000;
  if (!force && Date.now() - lastSent < every) return;
  lastSent = Date.now();
  api('/api/location', { method: 'POST', body: { lat: S.pos[0], lng: S.pos[1], speed: S.speed } }).then(r => {
    if (r.journey && r.journey.arrived) { toast('You have arrived — your Safe Circle has been told', 5000); loadJourney(); }
    else if (r.journey && r.journey.off_route && S.journeyActive && !S.journeyActive.off_route) loadJourney();
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.mode === 'gps' && 'wakeLock' in navigator && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  if (!document.hidden) { load(); loadMySos(); }
});

// ---------------- test drive (along the selected journey, or Owerri → Port Harcourt) ----------------
function densify(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(km(a, b) / .3)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  out.push(pts[pts.length - 1]); return out;
}
function drawTestRoute() {
  gRoutes.clearLayers();
  if (!S.test || S.trip) return;
  L.polyline(S.test.pts, { color: '#000', weight: 9, opacity: .35, interactive: false }).addTo(gRoutes);
  L.polyline(S.test.pts, { color: '#60a5fa', weight: 4, opacity: .9, dashArray: '8 8', interactive: false }).addTo(gRoutes);
}
function startTest() {
  audio(); stopGps();
  if (!S.test || S.test.i >= S.test.pts.length - 1) {
    const src = S.trip ? S.trip.coords : TEST_ROUTE;
    S.test = { pts: densify(src), i: 0, timer: null };
  }
  S.mode = 'test'; S.speed = 80; S.follow = true; S.lastLevel = 0; S.alerted.clear(); if (S.trip) S.trip.alerted = new Set();
  drawTestRoute(); map.setView(S.test.pts[S.test.i], 13);
  clearInterval(S.test.timer);
  S.test.timer = setInterval(() => {
    const prev = S.test.pts[S.test.i];
    S.test.i = Math.min(S.test.pts.length - 1, S.test.i + 1);   // ~0.3 km per tick ≈ 80 km/h at 50x
    if (S.planHour != null) S.planHour = (S.planHour + 0.3 / 80) % 24;
    S.pos = S.test.pts[S.test.i];
    S.heading = (Math.atan2(S.pos[1] - prev[1], S.pos[0] - prev[0]) * 180 / Math.PI + 360) % 360;
    if (S.test.i >= S.test.pts.length - 1) { stopTest(); announce('Test drive complete.', '#22c55e', 'chime'); }
    update();
  }, 270);
  renderPanel();
}
function stopTest() { if (S.test && S.test.timer) { clearInterval(S.test.timer); S.test.timer = null; } if (S.mode === 'test') { S.mode = 'placed'; S.speed = 0; } }

// ---------------- map picking ----------------
function startPick(kind, label) {
  S.pick = kind; const h = $('#hint'); h.textContent = label; h.style.display = 'block'; $('#map').style.cursor = 'crosshair';
  if (window.innerWidth < 860) $('#mapwrap').scrollIntoView({ behavior: 'smooth' });
}
function endPick() { S.pick = null; $('#hint').style.display = 'none'; $('#map').style.cursor = ''; }
map.on('click', e => {
  if (!S.pick) return;
  const p = [e.latlng.lat, e.latlng.lng], kind = S.pick; endPick();
  if (kind === 'place-me') { stopGps(); stopTest(); S.mode = 'placed'; S.pos = p; S.speed = 0; S.lastLevel = 0; S.alerted.clear(); refreshWeather(); update(); renderPanel(); toast('Position set — warnings now use this spot'); }
  else if (kind === 'report') reportForm(p, false);
  else if (kind === 'advisory') reportForm(p, true);
  else if (kind === 'place') placeForm(p);
  else if (kind === 'zone') zoneForm(p);
  else if (kind === 'j-from' || kind === 'j-to') { S.journey[kind === 'j-from' ? 'from' : 'to'] = { p, name: `Pinned point (${p[0].toFixed(3)}, ${p[1].toFixed(3)})` }; S.tab = 'journey'; renderTabs(); renderPanel(); drawJourneyPins(); }
  else if (kind === 'area') areaForm(p);
  else if (kind === 'suggest') { marker(p); placeEditForm({ lat: p[0], lng: p[1] }, 'new'); }
  else if (kind === 'base') api('/api/me/base', { method: 'PUT', body: { lat: p[0], lng: p[1] } }).then(() => { toast('Duty location saved'); load(); }).catch(err => toast(err.message));
});

// ---------------- forms ----------------
function marker(p) { if (pickMarker) map.removeLayer(pickMarker); pickMarker = L.circleMarker(p, { radius: 9, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }).addTo(map); }
function clearMarker() { if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; } }
function reportStart() {
  if (!S.user) return authModal('Sign in to send a report. It takes a few seconds.');
  modal(`<h2>Where is it?</h2><p>Use your current position, or tap the exact spot on the map.</p>
    <div class="grid2" style="margin-top:14px"><button class="btn primary block" id="wHere" ${S.pos ? '' : 'disabled'}>📍 My position</button><button class="btn block" id="wMap">🗺️ Pick on map</button></div>
    ${S.pos ? '' : '<p class="small" style="margin-top:8px">Turn on location first to use your position.</p>'}
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button></div>`);
  $('#wHere').onclick = () => { closeModal(); reportForm(S.pos.slice(), false); };
  $('#wMap').onclick = () => { closeModal(); startPick('report', 'Tap the map where it is'); };
}
const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}<input type="hidden" name="${name}" value="${val}"></div>`;
function bindSegs(root) {
  root.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => {
    s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); s.querySelector('input').value = b.dataset.v;
  }));
}
function reportForm(p, official) {
  marker(p);
  const staff = isSecurity() || isMod();
  const types = Object.values(S.data.types).filter(t => t.active !== 0 && (official ? t.key === 'advisory' : (!t.staff_only || (t.key === 'advisory' ? isSecurity() : staff))));
  modal(`<h2>${official ? 'Post official advisory' : 'Report an incident'}</h2>
    <p class="small">📍 ${p[0].toFixed(5)}, ${p[1].toFixed(5)} · ${staff ? 'As verified staff, your report publishes as Verified.' : 'A moderator checks reports. A single unconfirmed report about crime is not shown publicly until others confirm it.'}</p>
    <form id="rForm">
      <label class="f">Category</label>
      <div class="catgrid">${types.map((t, i) => `<label class="cat"><input type="radio" name="type" value="${t.key}" ${i === 0 && official ? 'checked' : ''}><span><i>${t.icon}</i>${esc(t.label)}</span></label>`).join('')}</div>
      ${official ? '' : `
      <label class="f">Is it still happening?</label>${seg('ongoing', [['yes', 'Yes'], ['no', 'No, it has ended'], ['', 'Not sure']], 'yes')}
      <div class="grid2"><div><label class="f">Anyone injured?</label>${seg('injured', [['yes', 'Yes'], ['no', 'No'], ['', "Don't know"]], '')}</div>
      <div><label class="f">Anyone trapped?</label>${seg('trapped', [['yes', 'Yes'], ['no', 'No'], ['', "Don't know"]], '')}</div></div>
      <div class="grid2"><div><label class="f">People affected (if known)</label><input type="text" name="affected" inputmode="numeric" placeholder="e.g. 3"></div>
      <div><label class="f">When did it happen?</label><select name="occurred_mins_ago"><option value="0">Just now</option><option value="15">About 15 min ago</option><option value="30">About 30 min ago</option><option value="60">About 1 hour ago</option><option value="120">About 2 hours ago</option><option value="360">About 6 hours ago</option><option value="720">Earlier today</option></select></div></div>
      <label class="f">How do you know?</label><select name="source">${Object.entries(SOURCE).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`}
      <label class="f">Description</label><textarea name="note" rows="3" maxlength="600" placeholder="What did you see? Direction of travel, landmarks, vehicles…"></textarea>
      <label class="f">Photo or video evidence (optional, only if it is safe)</label><input type="file" name="media" accept="image/*,video/*">
      <div class="err" id="rErr"></div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="rSend">${official ? 'Publish advisory' : 'Send report'}</button></div>
    </form>`, clearMarker);
  bindSegs($('#rForm'));
  $('#rForm').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    if (!fd.get('type')) { $('#rErr').textContent = 'Choose a category'; return; }
    fd.append('lat', p[0]); fd.append('lng', p[1]);
    const m = fd.get('media'); if (m && !m.size) fd.delete('media');
    if (m && m.size > 25 * 1024 * 1024) { $('#rErr').textContent = 'That file is larger than 25 MB'; return; }
    $('#rSend').disabled = true; $('#rSend').textContent = 'Sending…';
    try {
      let r;
      try { r = await api('/api/reports', { method: 'POST', form: fd }); }
      catch (netErr) {
        if (netErr.status) throw netErr;
        await queueReport(fd); closeModal(); clearMarker();
        toast('No connection — your report is saved and will be sent automatically when you are back online.', 6000); return;
      }
      closeModal(); clearMarker();
      toast(r.status === 'verified' ? 'Published — people nearby will be warned' : 'Sent. It shows as Unverified until checked or confirmed by others.', 4500);
      S.lastLevel = 0; load();
    } catch (e) { $('#rErr').textContent = e.message; $('#rSend').disabled = false; $('#rSend').textContent = 'Send report'; }
  };
}
function placeForm(p) {
  marker(p);
  modal(`<h2>Add a place</h2><p class="small">📍 ${p[0].toFixed(5)}, ${p[1].toFixed(5)}</p><form id="pForm">
    <label class="f">Category</label><select name="category">${Object.entries(CAT).map(([k, c]) => `<option value="${k}">${c.icon} ${c.label}</option>`).join('')}</select>
    <label class="f">Name</label><input type="text" name="name" required maxlength="100" placeholder="e.g. Police Division, Mbaise Road">
    <div class="grid2"><div><label class="f">Phone</label><input type="text" name="phone" maxlength="30"></div><div><label class="f">Hours</label><input type="text" name="hours" maxlength="40" placeholder="e.g. 24 hours"></div></div>
    <label class="f">Operating status (security posts)</label><select name="operational"><option value="unknown">Not confirmed</option><option value="confirmed">Confirmed operating now</option><option value="closed">Closed</option></select>
    <div class="err" id="pErr"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save place</button></div></form>`, clearMarker);
  $('#pForm').onsubmit = async ev => {
    ev.preventDefault();
    try { await api('/api/places', { method: 'POST', body: { ...Object.fromEntries(new FormData(ev.target)), lat: p[0], lng: p[1] } }); closeModal(); clearMarker(); toast('Place saved'); load(); }
    catch (e) { $('#pErr').textContent = e.message; }
  };
}
function zoneForm(p) {
  marker(p);
  modal(`<h2>Add an area type</h2><p>Area types add a small isolation factor (higher after dark). The smallest area containing a point wins; elsewhere counts as rural.</p><form id="zForm">
    <label class="f">Name</label><input type="text" name="name" required maxlength="80" placeholder="e.g. Owerri municipal">
    <label class="f">Type</label><select name="type"><option value="urban">Urban</option><option value="peri">Peri-urban</option><option value="rural">Rural</option><option value="forest">Forest / isolated stretch</option></select>
    <label class="f">Radius (km)</label><input type="text" name="radius_km" value="3" inputmode="decimal">
    <div class="err" id="zErr"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, clearMarker);
  $('#zForm').onsubmit = async ev => {
    ev.preventDefault();
    try { await api('/api/zones', { method: 'POST', body: { ...Object.fromEntries(new FormData(ev.target)), lat: p[0], lng: p[1] } }); closeModal(); clearMarker(); toast('Saved'); load(); }
    catch (e) { $('#zErr').textContent = e.message; }
  };
}
function authModal(reason, startOn) {
  let mode = startOn || 'login';
  const draw = () => {
    modal(`<h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2>${reason ? `<p>${esc(reason)}</p>` : ''}
      <form id="aForm">
        ${mode === 'register' ? '<label class="f">Full name</label><input type="text" name="name" required maxlength="80"><label class="f">Phone</label><input type="text" name="phone" maxlength="30" inputmode="tel" placeholder="0803 000 0000">' : ''}
        <label class="f">Email</label><input type="text" name="email" required inputmode="email" autocomplete="email">
        <label class="f">Password</label><input type="password" name="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
        ${mode === 'register' ? `<div class="toggle" style="margin-top:10px"><div>I am security personnel<small>Police, FRSC, NSCDC, military or vigilance. An admin verifies you before the badge is given.</small></div><label class="sw"><input type="checkbox" name="security" id="aSec"><span></span></label></div>
          <div id="aAgency" style="display:none"><label class="f">Agency and unit</label><input type="text" name="agency" maxlength="80" placeholder="e.g. Nigeria Police, Owerri Division"></div>` : ''}
        <div class="err" id="aErr"></div>
        <button class="btn primary block" style="margin-top:12px">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p class="small" style="margin-top:12px;text-align:center">${mode === 'login' ? 'New here? <button class="linkish" id="aSwap">Create an account</button>' : 'Have an account? <button class="linkish" id="aSwap">Sign in</button>'}</p>`);
    $('#aSwap').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
    const sec = $('#aSec'); if (sec) sec.onchange = () => { $('#aAgency').style.display = sec.checked ? 'block' : 'none'; };
    $('#aForm').onsubmit = async ev => {
      ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); f.security = !!f.security;
      try {
        let r = await api('/api/auth/' + mode, { method: 'POST', body: f });
        if (r.mfa_required) { r = await mfaCode(r.ticket); if (!r) return; }
        S.user = r.user; closeModal();
        toast(mode === 'login' ? 'Welcome back, ' + r.user.name.split(' ')[0] : f.security ? 'Account created. An admin will verify your security status.' : 'Account created. Add your Safe Circle in the Circle tab.', 4500);
        load(); loadCircle(); loadMySos(); loadJourney(); flushQueue();
        if (r.user.mfa_needed) setTimeout(() => mfaSetup(true), 500);
      } catch (e) { $('#aErr').textContent = e.message; }
    };
  };
  draw();
}

// ---------------- panels ----------------
const sw = (id, on) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
const SECTIONS = [['map', '🗺️', 'Safety Map'], ['journey', '🧭', 'Safe Journey'], ['alerts', '🔔', 'Alerts'], ['circle', '👥', 'Safe Circle'],
  ['sos', '🆘', 'Emergency SOS'], ['watch', '📣', 'Community Watch'], ['services', '🏥', 'Emergency Services'], ['account', '👤', 'My Account']];
const LEGACY_TAB = { help: 'services', moderate: 'watch', security: 'sos', admin: 'account' };
function sectionList() {
  const list = SECTIONS.slice();
  if ((S.data.fleets || []).some(f => f.role === 'manager')) list.splice(4, 0, ['fleet', '🚚', 'Fleet']);
  return list;
}
function fleetBadge() { return (S.fleet && S.fleet.alerts || []).filter(a => !a.ack_at && ['sos', 'missed_checkin', 'unscheduled_stop', 'deviation', 'no_signal'].includes(a.kind) && Date.now() - a.at < 6 * 36e5).length; }
function renderTabs() {
  if (LEGACY_TAB[S.tab]) S.tab = LEGACY_TAB[S.tab];
  const list = sectionList();
  if (!list.find(t => t[0] === S.tab)) S.tab = 'map';
  const badge = k => k === 'alerts' ? S.unread : k === 'fleet' ? fleetBadge() : k === 'sos' && S.sos ? '!' : 0;
  $('#tabs').innerHTML = list.map(([k, ic, l]) => { const n = badge(k); return `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}${k === 'sos' ? ' t-sos' : ''}"><i>${ic}</i>${l}${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}</button>`; }).join('');
  const more = !['map', 'journey', 'alerts', 'circle'].includes(S.tab);
  const nb = [['map', '🗺️', 'Map'], ['journey', '🧭', 'Journey'], ['alerts', '🔔', 'Alerts'], ['circle', '👥', 'Circle'], ['more', '☰', 'More']];
  $('#bnav').innerHTML = nb.map(([k, ic, l]) => { const n = k === 'more' ? fleetBadge() : badge(k); return `<button data-tab="${k}" class="${S.tab === k || (k === 'more' && more) ? 'on' : ''}"><i>${ic}</i><span>${l}</span>${n ? `<b class="badge">${n > 9 ? '9+' : n}</b>` : ''}</button>`; }).join('');
  $$('#tabs button, #bnav button').forEach(b => b.onclick = () => b.dataset.tab === 'more' ? moreSheet() : setTab(b.dataset.tab));
  $('#btnAccount').textContent = S.user ? (S.user.name.split(' ')[0] + ' ▾') : 'Sign in';
  const nt = (S.data.settings && S.data.settings.notice_text) || '', nb2 = $('#notice');
  if (nb2) { nb2.textContent = nt; nb2.hidden = !nt; }
}
function moreSheet() {
  const list = sectionList().filter(t => !['map', 'journey', 'alerts', 'circle'].includes(t[0]));
  modal(`<h2>More</h2><div class="morelist">${list.map(([k, ic, l]) => `<button class="btn block" data-more="${k}"><i>${ic}</i> ${l}</button>`).join('')}
    ${isStaffUser() ? '<a class="btn block" href="/admin"><i>🛡️</i> Command Centre</a>' : ''}</div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`);
  $$('[data-more]').forEach(b => b.onclick = () => { closeModal(); setTab(b.dataset.more); });
}
const isStaffUser = () => S.user && (isMod() || isSecurity() || ['security', 'moderator', 'admin'].includes(S.user.real_role || S.user.role));
function setTab(t) {
  if (LEGACY_TAB[t]) t = LEGACY_TAB[t];
  S.tab = t; renderTabs(); drawMap(); renderPanel();
  if (t === 'circle') loadCircle();
  if (t === 'watch') loadMyReports();
  if (t === 'alerts') { loadInbox(); if (S.user && !S.alertPrefs) loadAlertPrefs().then(() => S.tab === 'alerts' && renderPanel()); }
  if (t === 'account') loadAccount();
  if (t === 'journey') drawJourney();
  if (t === 'fleet') loadFleet();
  if (t !== 'fleet') gFleet.clearLayers();
  $('#panel').scrollTop = 0;
  document.body.dataset.tab = t;
}
function assessCard(a) {
  if (!a) return `<div class="lvl" style="color:var(--mute)">Location off</div><p class="small" style="margin:6px 0 0">Press <b>Start</b> below so the app can warn you about unsafe places and road hazards as you move.</p>`;
  const sub = (l, x, extra) => `<div><span>${l}</span><b style="color:${LEVELS[x.level].hex}">${LEVELS[x.level].name}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
  return `<div class="lvlrow"><span class="lvlbadge" style="background:${a.hex}">${LEVELS[a.level].long.toUpperCase()}</span><span class="conf">${a.confLabel}</span></div>
    <div class="subs">${sub('Security', a.security, a.security.confLabel.replace(' confidence', ''))}${sub('Road', a.road)}<div><span>Travel time</span><b>${timeLabel(travelHour())}</b><small>${clock(travelHour())}</small></div></div>
    <ul class="reasons">${a.reasons.slice(0, 6).map(r => `<li class="r-${r.kind}"><i>${r.icon}</i><span>${esc(r.text)}</span></li>`).join('')}</ul>
    <div class="action"><b>Recommended action</b><p>${esc(a.action)}</p></div>
    <details class="how"><summary>How this was worked out</summary>
      <div class="small">Security: incidents ${a.parts.incidents} + past frequency ${a.parts.history} + time pattern ${a.parts.pattern}, × time ${a.parts.time} × security presence ${a.parts.presence.toFixed(2)}, + isolation ${a.parts.context} → ${a.security.score}. Road: hazards ${a.parts.road} + weather ${a.parts.weather} → ${a.road.score}. Area: ${esc(a.zone.name)} (${SETTLE_LABEL[a.zone.type] || ''}).
      Every report is weighted by distance, how recent it is, and how reliable it is.</div></details>`;
}
function renderStatus(a, ah) {
  const el = $('#statcard'); if (!el) return;
  el.innerHTML = (S.pos ? `<div class="admline" id="admLine">${admLine()}</div>` : '') + assessCard(a);
  if (S.weather && $('#wx')) $('#wx').innerHTML = `🌦️ Rain: ${S.weather.now_mm} mm now · ${S.weather.mm3h} mm expected in 3 h`;
  renderHelp();
}
function renderHelp() {
  const hl = $('#helpList'); if (!hl) return;
  if (!S.pos) { hl.innerHTML = '<li class="empty">Turn on location to see the nearest help.</li>'; return; }
  const groups = [['Security', SECURITY_CATS], ['Hospital / clinic', ['hospital', 'clinic']], ['Mechanic', ['mechanic', 'vulcaniser']], ['Fuel', ['fuel']]];
  hl.innerHTML = groups.map(([label, cats]) => {
    const n = nearest(S.pos, S.data.places, cats, p => p.operational !== 'closed'); if (!n) return '';
    const c = CAT[n.place.category];
    const ok = SECURITY_CATS.includes(n.place.category) ? (n.place.operational === 'confirmed' ? ' · ✅ confirmed' : ' · status unconfirmed') : '';
    return `<li><span class="ico" style="background:${c.bg};border-color:${c.bg}">${c.icon}</span><div class="meta"><div>${esc(n.place.name)}</div><small>${label}${ok}${n.place.phone ? ' · <a href="tel:' + esc(n.place.phone) + '">' + esc(n.place.phone) + '</a>' : ''}</small></div><span class="dist">${fmtKm(n.d)}</span><button class="btn sm" data-go="${n.place.lat},${n.place.lng}">Show</button></li>`;
  }).join('') || '<li class="empty">No places recorded near you yet.</li>';
  hl.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.follow = false; map.setView(b.dataset.go.split(',').map(Number), 15); });
}
function mapPanel() {
  const tracking = S.mode === 'gps';
  return `<div class="sec"><h3>Your situation</h3><div class="statcard" id="statcard"></div><div class="small" id="wx" style="margin-top:6px"></div><button class="linkish" id="bBrief" style="font-size:12.5px;margin-top:6px">🔊 Read this aloud</button></div>
  ${S.trip ? `<div class="sec tripsec"><h3>Trip to ${esc(S.trip.dest)}</h3><div id="tripInfo" class="small">${esc(S.trip.next || 'Following your route')}</div><div class="grid2" style="margin-top:8px"><button class="btn block" id="bTripView">Route details</button><button class="btn block" id="bTripEnd">End trip</button></div></div>` : ''}
  ${journeyCard()}
  <div class="sec"><h3>Location</h3>
    <button class="btn block ${tracking ? 'track-on' : 'primary'}" id="bGps" style="padding:12px">${tracking ? '■ Stop tracking' : '▶ Start — use my GPS'}</button>
    <div class="grid2" style="margin-top:8px"><button class="btn block" id="bPlace">📍 Place me on map</button><button class="btn block" id="bReport">📣 Report incident</button></div>
    <label class="f">Time of travel: <b id="hourLbl" style="color:var(--ink)">${S.planHour == null ? 'Now (live)' : clock(S.planHour) + ' · ' + timeLabel(S.planHour)}</b></label>
    <input type="range" id="hour" min="0" max="23.75" step="0.25" value="${S.planHour == null ? hourNow() : S.planHour}">
    ${S.planHour != null ? '<button class="linkish" id="hourNow" style="font-size:12px">↺ Back to live time</button>' : '<div class="small">Slide to see how the picture changes at another time.</div>'}
  </div>
  <div class="sec"><h3>Warnings while you travel</h3>
    <div class="toggle"><div>Danger warning<small>Sound and voice when risk rises or a hazard is ahead</small></div>${sw('tWarn', S.warn)}</div>
    <div class="toggle"><div>Voice prompts<small>Spoken warnings</small></div>${sw('tVoice', S.voice)}</div>
    <div class="toggle"><div>Tourist Mode<small>First visit? Warns you earlier</small></div>${sw('tTour', S.tourist)}</div>
    <div class="toggle"><div>Driver Mode<small>Large hands-free screen while driving</small></div>${sw('tDriver', S.driver)}</div>
    <button class="btn block" id="bTest" style="margin-top:10px">🔊 Test sound and voice</button>
  </div>
  <div class="sec"><h3>Nearest help</h3><ul class="help" id="helpList"></ul></div>
  <div class="sec"><h3>Map key</h3><div class="legend">${LEVELS.map(l => `<span><i style="background:${l.hex}"></i>${l.name}</span>`).join('')}</div>
    <div class="legend" style="margin-top:8px"><span><i style="background:#64748b"></i>Solid ring: verified</span><span><i style="background:#64748b;opacity:.5"></i>Dashed: unverified / under investigation</span></div>
    <div class="legend" style="margin-top:8px">${Object.values(S.data.types).map(t => `<span>${t.icon} ${esc(t.label)}</span>`).join('')}</div></div>
  <div class="sec"><details ${S.test ? 'open' : ''}><summary>Testing tools</summary>
    <p class="small">Simulate driving ${S.trip ? 'your planned route' : 'from Owerri to Port Harcourt'} to hear the warnings without travelling.</p>
    <div class="grid2"><button class="btn block" id="bTestDrive">${S.mode === 'test' ? '⏸ Pause' : '🚗 Test drive'}</button><button class="btn block" id="bTestEnd">✕ End test</button></div>
  </details></div>
  ${packsSection()}
  <div class="sec small">Ratings describe reported information only, never a guarantee of safety. In an emergency call <a href="tel:112">112</a>.</div>`;
}

// ---------------- Journey Planner ----------------
let geoTimer = null;
function journeyPanel() {
  const J = S.journey;
  const ph = (which, label) => {
    const v = J[which];
    return `<label class="f">${label}</label>
    <div class="jfield">${v ? `<div class="jval"><span>${which === 'from' && v.mine ? '📍' : '📌'} ${esc(v.name)}</span><button class="linkish" data-jclear="${which}">Change</button></div>` :
      `<input type="text" id="jq-${which}" placeholder="Search a town, street or place" autocomplete="off">
       <div class="row" style="margin-top:6px;gap:6px">${which === 'from' ? `<button class="btn sm" id="jMine">📍 My location</button>` : ''}<button class="btn sm" data-jpick="${which}">🗺️ Pick on map</button></div>
       <div class="jres" id="jr-${which}"></div>`}</div>`;
  };
  return `<div class="sec"><h3>SafeRoute Journey Planner</h3>
    ${ph('from', 'From')}${ph('to', 'To')}
    <label class="f">Departure: <b id="jDepLbl" style="color:var(--ink)">${J.depart == null ? 'Now' : clock(J.depart)}</b></label>
    <input type="range" id="jDep" min="0" max="23.75" step="0.25" value="${J.depart == null ? hourNow() : J.depart}">
    <button class="btn primary block" id="jGo" style="margin-top:12px;padding:12px" ${J.from && J.to && !J.busy ? '' : 'disabled'}>${J.busy ? 'Checking routes…' : 'Compare routes'}</button>
    ${J.error ? `<div class="err">${esc(J.error)}</div>` : ''}
    ${J.to && !J.routes.length && !J.busy ? '<button class="btn block" id="jNoRoute" style="margin-top:8px">🛡️ Start check-in journey without a route</button>' : ''}
    <p class="small" style="margin:8px 0 0">Compares journey time against reported risks. No route is ever labelled guaranteed safe.</p>
  </div>
  <div id="jResults">${journeyResults()}</div>`;
}
function routeTag(i) {
  const rs = S.journey.routes; if (!rs.length) return '';
  const fastest = rs.reduce((m, r, k) => r.duration < rs[m].duration ? k : m, 0);
  const rec = rs.reduce((m, r, k) => (r.duration / 60 + r.a.burden) < (rs[m].duration / 60 + rs[m].a.burden) ? k : m, 0);
  const lowest = rs.reduce((m, r, k) => r.a.burden < rs[m].a.burden ? k : m, 0);
  const t = [];
  if (i === rec) t.push('Recommended');
  if (i === fastest) t.push('Fastest');
  if (i === lowest && rs.length > 1 && rs[i].a.burden < Math.max(...rs.map(r => r.a.burden))) t.push('Lower reported risk');
  if (!t.length) t.push('Alternative');
  return t.join(' · ');
}
function relRisk(r) {
  const rs = S.journey.routes;
  if (rs.length < 2) return r.a.worst === 0 ? 'Low reported risk' : `${LEVELS[r.a.worst].name} risk on parts of the route`;
  const min = Math.min(...rs.map(x => x.a.burden)), max = Math.max(...rs.map(x => x.a.burden));
  if (max === min) return 'Similar reported risk to the other routes';
  return r.a.burden === min ? 'Relatively lower reported risk' : r.a.burden === max ? 'Relatively higher reported risk' : 'Medium reported risk';
}
function journeyResults() {
  const J = S.journey;
  if (!J.routes.length) return '';
  const L_ = (n) => LEVELS[n];
  const cards = J.routes.map((r, i) => `<button class="routecard ${i === J.sel ? 'on' : ''}" data-route="${i}">
      <div class="row between"><b>Route ${String.fromCharCode(65 + i)}</b><span class="pill">${routeTag(i)}</span></div>
      <div class="rc-main"><span>${fmtDur(r.duration)}</span><span>${fmtKm(r.distance / 1000)}</span><span style="color:${L_(r.a.worst).hex}">● ${L_(r.a.worst).name}</span></div>
      <div class="small">${relRisk(r)} · ${r.a.confLabel.toLowerCase()}${r.a.highKm ? ` · ${Math.round(r.a.highKm)} km high or severe` : ''}</div>
      <div class="small">${r.a.incidents.length} security report${r.a.incidents.length === 1 ? '' : 's'} · ${r.a.hazards.length} road hazard${r.a.hazards.length === 1 ? '' : 's'} near the route</div>
    </button>`).join('');
  const r = J.routes[J.sel], a = r.a;
  const sug = J.suggest;
  const list = (arr, fn, empty) => arr.length ? `<ul class="jlist">${arr.map(fn).join('')}</ul>` : `<div class="empty">${empty}</div>`;
  return `<div class="sec"><h3>Routes · ${esc(J.to.name.split(',')[0])}</h3>${cards}</div>
  ${briefingHTML(r)}
  <div class="sec"><h3>Route ${String.fromCharCode(65 + J.sel)} in detail</h3>
    <div class="factors" style="grid-template-columns:repeat(3,1fr)"><div class="factor"><b>${fmtDur(r.duration)}</b><span>Est. time</span></div><div class="factor"><b>${fmtKm(r.distance / 1000)}</b><span>Distance</span></div><div class="factor"><b style="color:${LEVELS[a.worst].hex}">${LEVELS[a.worst].name}</b><span>Worst stretch</span></div></div>
    <p class="small" style="margin:8px 0 0">${relRisk(r)}, ${a.confLabel.toLowerCase()}. Arrival around ${clock((J.depart == null ? hourNow() : J.depart) + r.duration / 3600)}.</p>
    ${sug ? `<div class="action" style="margin-top:10px"><b>Departure time</b><p>${esc(sug)}</p></div>` : ''}
    ${J.wx ? `<p class="small">🌦️ ${esc(J.wx)}</p>` : ''}
    <div class="grid2" style="margin-top:10px"><button class="btn primary block" id="jStart">▶ Start journey</button><button class="btn block" id="jOffline">⬇️ Save offline</button></div>
    <p class="small" style="margin:6px 0 0">Starting a journey tells your Safe Circle, alerts them if you leave the route or miss your arrival check-in, and gives spoken warnings before risky stretches.</p>
  </div>
  <div class="sec"><h3>Dangerous stretches · ${a.stretches.length}</h3>
    ${list(a.stretches, st => `<li><button class="linkish" data-jzoom="${st.worst.p}"><span class="lvlbadge sm" style="background:${LEVELS[st.level].hex}">${LEVELS[st.level].name}</span> km ${Math.round(st.startKm)}–${Math.round(st.startKm + st.lengthKm)}</button>
      <span class="small"> · ${st.confLabel.toLowerCase()} · around ${clock(st.atHour)}</span>
      <div class="small">${st.reasons.map(x => x.icon + ' ' + esc(x.text)).join('<br>') || ''}</div><div class="small" style="color:var(--ink)">→ ${esc(st.action)}</div></li>`, 'No stretch above Low reported risk at this departure time.')}
  </div>
  <div class="sec"><h3>Recent security incidents near the route</h3>
    ${list(a.incidents, x => `<li><button class="linkish" data-jzoom="${x.report.lat},${x.report.lng}">${T(x.report.type).icon} ${esc(T(x.report.type).label)}</button> ${statusPill(x.report)}<div class="small">km ${Math.round(x.atKm)} · ${ago(x.report.occurred_at || x.report.created_at)} · ${esc(x.report.confLabel || '')}</div></li>`, 'None reported.')}
  </div>
  <div class="sec"><h3>Road conditions on the route</h3>
    ${list(a.hazards, x => `<li><button class="linkish" data-jzoom="${x.report.lat},${x.report.lng}">${T(x.report.type).icon} ${esc(T(x.report.type).label)}</button> ${statusPill(x.report)}<div class="small">km ${Math.round(x.atKm)} · ${ago(x.report.occurred_at || x.report.created_at)}</div></li>`, 'No floods, blockages or crashes reported.')}
  </div>
  <div class="sec"><h3>Safer places to stop</h3>
    ${list(a.stops.slice(0, 8), x => `<li><button class="linkish" data-jzoom="${x.place.lat},${x.place.lng}">${(CAT[x.place.category] || {}).icon} ${esc(x.place.name)}</button><div class="small">km ${Math.round(x.atKm)} · ${fmtKm(x.offKm)} off the road · on a low-risk stretch${SECURITY_CATS.includes(x.place.category) && x.place.operational === 'confirmed' ? ' · ✅ confirmed operating' : ''}</div></li>`, 'No recorded police posts, hospitals or fuel stations on low-risk stretches.')}
  </div>
  <div class="sec"><h3>Hospitals and police along the way</h3>
    ${list(a.help, x => `<li><button class="linkish" data-jzoom="${x.place.lat},${x.place.lng}">${(CAT[x.place.category] || {}).icon} ${esc(x.place.name)}</button><div class="small">km ${Math.round(x.atKm)} · ${fmtKm(x.offKm)} off the road${x.place.phone ? ' · <a href="tel:' + esc(x.place.phone) + '">' + esc(x.place.phone) + '</a>' : ''}</div></li>`, 'None recorded within 3 km of this route yet.')}
  </div>
  <div class="sec small">Based on reports available now. No route is guaranteed safe — check again before you set off.</div>`;
}
async function geoSearch(which, q) {
  const box = $('#jr-' + which); if (!box) return;
  if (q.length < 3) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="small">Searching…</div>';
  try {
    const list = await api('/api/geocode?q=' + encodeURIComponent(q));
    if (!$('#jr-' + which)) return;
    box.innerHTML = list.length ? list.map((x, i) => `<button class="jopt" data-i="${i}">${esc(x.name)}</button>`).join('') : '<div class="small">No match. Try another spelling, or pick on the map.</div>';
    box.querySelectorAll('.jopt').forEach(b => b.onclick = () => { S.journey[which] = { p: [list[b.dataset.i].lat, list[b.dataset.i].lng], name: list[b.dataset.i].name }; S.journey.routes = []; renderPanel(); drawJourneyPins(); });
  } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function drawJourneyPins() {
  gJourney.clearLayers();
  const J = S.journey;
  if (J.from && !J.from.mine) L.marker(J.from.p, { icon: icon('<div class="mk" style="width:28px;height:28px;background:#0f766e">A</div>', 28) }).addTo(gJourney);
  if (J.to) L.marker(J.to.p, { icon: icon('<div class="mk" style="width:28px;height:28px;background:#be123c">B</div>', 28) }).addTo(gJourney);
}
function drawJourney() {
  gJourney.clearLayers(); drawJourneyPins();
  const J = S.journey;
  if (!J.routes.length) return;
  J.routes.forEach((r, i) => { if (i !== J.sel) L.polyline(r.coords, { color: '#94a3b8', weight: 5, opacity: .7 }).on('click', () => { J.sel = i; renderPanel(); drawJourney(); }).addTo(gJourney); });
  const r = J.routes[J.sel];
  L.polyline(r.coords, { color: '#000', weight: 11, opacity: .45, interactive: false }).addTo(gJourney);
  const sm = r.a.samples;
  for (let i = 0; i < sm.length - 1; i++) L.polyline([sm[i].p, sm[i + 1].p], { color: LEVELS[sm[i].a.level].hex, weight: 6, opacity: .95, interactive: false }).addTo(gJourney);
  for (const st of r.a.stretches) if (st.level >= 2) L.marker(st.worst.p, { icon: icon(`<div class="mk" style="width:24px;height:24px;background:${LEVELS[st.level].hex}">!</div>`, 24) }).bindPopup(`<b>${LEVELS[st.level].long}</b> · ${st.confLabel}<br>${st.reasons.map(x => esc(x.text)).join('<br>')}<br><i>${esc(st.action)}</i>`).addTo(gJourney);
}
async function findRoutes() {
  const J = S.journey;
  if (!J.from || !J.to) return;
  J.busy = true; J.error = ''; J.routes = []; J.suggest = ''; renderPanel();
  try {
    const { routes } = await api(`/api/route?from=${J.from.p.join(',')}&to=${J.to.p.join(',')}`);
    const first = routes[0].coords;
    const wpts = [first[0], first[Math.floor(first.length / 2)], first[first.length - 1]];
    const wx = await Promise.all(wpts.map(weatherFor));
    const weatherAt = p => { let best = null, bd = Infinity; wpts.forEach((q, i) => { const d = km(p, q); if (d < bd && wx[i]) { bd = d; best = wx[i]; } }); return best; };
    const dep = J.depart == null ? hourNow() : J.depart;
    const opts = { tourist: S.tourist, weatherAt };
    J.routes = routes.map(r => ({ ...r, a: R.assessRoute(r.coords, dep, r.duration, S.data, opts) }));
    const rec = J.routes.reduce((m, r, k) => (r.duration / 60 + r.a.burden) < (J.routes[m].duration / 60 + J.routes[m].a.burden) ? k : m, 0);
    J.sel = rec;
    const heavy = wx.filter(Boolean).filter(w => w.mm3h >= 10).length;
    J.wx = wx.some(Boolean) ? (heavy ? `Heavy rain expected along the route (${Math.max(...wx.filter(Boolean).map(w => w.mm3h))} mm in 3 h) — flooding possible.` : `Rain in the next 3 h: ${wx.filter(Boolean).map(w => w.mm3h + ' mm').join(' / ')} (start / middle / end).`) : '';
    // departure time suggestion: compare a few departure hours for the recommended route
    const cand = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter(h => h + J.routes[rec].duration / 3600 <= 18.5);
    const base = R.assessRoute(J.routes[rec].coords, dep, J.routes[rec].duration, S.data, { ...opts, weatherAt: null }); // same basis as the candidates
    let best = null;
    for (const h of cand) {
      const x = R.assessRoute(J.routes[rec].coords, h, J.routes[rec].duration, S.data, { ...opts, weatherAt: null });
      if (!best || x.burden < best.a.burden) best = { h, a: x };
    }
    if (best && (best.a.worst < base.worst || best.a.burden < base.burden * 0.7) && Math.abs(best.h - dep) >= 1) {
      J.suggest = `Leaving around ${clock(best.h)} gives relatively lower reported risk on this route (${LEVELS[best.a.worst].name.toLowerCase()} instead of ${LEVELS[base.worst].name.toLowerCase()} at worst), so you travel in daylight.`;
    } else if (timeLabel(dep) !== 'Day' || timeLabel(dep + J.routes[rec].duration / 3600) !== 'Day') {
      J.suggest = 'Part of this journey is after dark. Where you can, travel in daylight and avoid stopping on isolated stretches.';
    }
  } catch (e) { J.error = e.message; }
  J.busy = false; renderPanel(); drawJourney();
  if (J.routes.length) { S.follow = false; map.fitBounds(L.latLngBounds(J.routes.flatMap(r => [r.coords[0], r.coords[r.coords.length - 1]]).concat(J.routes[J.sel].coords)).pad(.1)); }
}
function startTrip() {
  const J = S.journey, r = J.routes[J.sel];
  S.trip = { coords: r.coords, a: r.a, dest: J.to.name.split(',')[0], destP: J.to.p, alerted: new Set(), next: '' };
  S.test = null;
  if (S.mode !== 'gps') startGps(true);
  setTab('map'); toast('Trip started — alerts will warn you before risky stretches', 4000);
  drawJourney();
}
function tripGuidance() {
  const t = S.trip; if (!t || !S.pos) return;
  // where are we along the route?
  let best = 0, bd = Infinity;
  t.a.samples.forEach((s, i) => { const d = km(S.pos, s.p); if (d < bd) { bd = d; best = i; } });
  const here = t.a.samples[best].km;
  const nextSt = t.a.stretches.find(st => st.startKm + st.lengthKm > here && st.level >= 1);
  if (nextSt) {
    const dist = Math.max(0, nextSt.startKm - here);
    t.next = dist > 0.2 ? `${LEVELS[nextSt.level].name} stretch in ${fmtKm(dist)} (about ${Math.round(nextSt.lengthKm)} km long)` : `On a ${LEVELS[nextSt.level].name.toLowerCase()}-risk stretch for ${fmtKm(nextSt.startKm + nextSt.lengthKm - here)}`;
    const key = nextSt.startKm;
    if (dist <= 3 && dist > 0.2 && !t.alerted.has(key) && nextSt.level >= 2) {
      t.alerted.add(key);
      announce(`Heads up. ${LEVELS[nextSt.level].name} risk stretch in about ${dist < 1 ? Math.round(dist * 1000 / 100) * 100 + ' metres' : Math.round(dist) + ' kilometres'}, ${nextSt.confLabel.toLowerCase()}. ${nextSt.action}`, LEVELS[nextSt.level].hex, nextSt.level >= 3 ? 'avoid' : 'high');
    }
  } else t.next = `No risky stretches left · ${fmtKm(Math.max(0, t.a.totalKm - here))} to go`;
  if (bd > 1.5 && S.mode === 'gps') t.next = 'You seem to be off the planned route — ratings shown are for where you are now';
  if (km(S.pos, t.destP) < 0.3 && !t.arrived) { t.arrived = true; announce(`You have arrived at ${t.dest}.`, '#22c55e', 'chime'); if (S.myShare) toast('Arrived — you can stop sharing your trip in the Circle tab', 6000); }
  const ti = $('#tripInfo'); if (ti) ti.textContent = t.next;
}
async function shareTrip(withRoute) {
  if (!S.user) return authModal('Sign in to share your trip with your Safe Circle.');
  const J = S.journey, r = withRoute && J.routes[J.sel];
  try {
    const body = { lat: S.pos ? S.pos[0] : (J.from ? J.from.p[0] : null), lng: S.pos ? S.pos[1] : (J.from ? J.from.p[1] : null), dest_name: r ? J.to.name.split(',')[0] : '', route: r ? r.coords : null, notify_sms: true };
    const s = await api('/api/share/start', { method: 'POST', body });
    S.myShare = { url: s.url, token: s.token, dest_name: body.dest_name };
    if (!S.pos) startGps(true);
    shareLinks(s.url, `I'm sharing my ${body.dest_name ? 'journey to ' + body.dest_name : 'live location'} on SafeRoute. Follow me here:`, s.sms);
    sendLocation(true);
  } catch (e) { toast(e.message); }
}
function phonesCsv() { return S.circle.map(c => c.phone).filter(Boolean).join(','); }
function shareLinks(url, msg, sms) {
  const text = `${msg} ${url}`;
  modal(`<h2>Live location shared</h2>
    <p>${sms && sms.sent ? `Texted ${sms.sent} Safe Circle contact${sms.sent === 1 ? '' : 's'}. ` : ''}Anyone with this link can follow you until you stop sharing (Circle tab).</p>
    <div class="linkbox"><input type="text" readonly value="${esc(url)}" id="shUrl"><button class="btn sm" id="shCopy">Copy</button></div>
    <div class="grid2" style="margin-top:10px">
      <a class="btn block" style="background:#14532d;border-color:#166534" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <a class="btn block" href="sms:${esc(phonesCsv())}?&body=${encodeURIComponent(text)}">SMS from my phone</a></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Done</button></div>`);
  $('#shCopy').onclick = () => { try { navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { $('#shUrl').select(); } };
}

// ---------------- Circle tab ----------------
async function loadMyReports() { if (!S.user) return; try { S.myReports = await api('/api/my/reports'); if (S.tab === 'watch') renderPanel(); } catch (e) {} }
function circlePanel() {
  if (!S.user) return `<div class="sec"><h3>Safe Circle</h3><p>Sign in to choose family, friends and colleagues who are alerted when you press SOS and who can follow your trips.</p><button class="btn primary block" id="cSign">Sign in or create account</button></div>`;
  const u = S.user;
  return `<div class="sec"><h3>Safe Circle · ${S.circle.length}/10</h3>
    <p class="small" style="margin-top:0">These people get your SOS ${S.data.sms_enabled ? 'by SMS' : '(SMS is not switched on for this server yet, so use the “SMS from my phone” button during an SOS)'} with a live location link.</p>
    ${S.circle.map(c => `<div class="card row between"><div><b>${esc(c.name)}</b>${c.relation ? ` <span class="small">· ${esc(c.relation)}</span>` : ''}<div class="small">${esc(c.phone || c.email || '')}</div></div><button class="btn sm" data-cdel="${c.id}">Remove</button></div>`).join('') || '<div class="empty">No one yet. Add at least two people.</div>'}
    ${S.circle.length < 10 ? `<form id="cForm" class="cform"><div class="grid2"><input type="text" name="name" placeholder="Name" required maxlength="60"><input type="text" name="phone" placeholder="Phone (0803…)" inputmode="tel" required maxlength="30"></div>
      <div class="grid2" style="margin-top:6px"><input type="text" name="relation" placeholder="Relation (optional)" maxlength="40"><button class="btn primary">Add</button></div><div class="err" id="cErr"></div></form>` : ''}
  </div>
  <div class="sec"><h3>Share my live location</h3>
    ${S.myShare ? `<p class="small" style="margin-top:0">Sharing now${S.myShare.dest_name ? ' · trip to ' + esc(S.myShare.dest_name) : ''}.</p><div class="grid2"><button class="btn block" id="cShowLink">Show link</button><button class="btn block track-on" id="cStop">Stop sharing</button></div>`
      : `<p class="small" style="margin-top:0">For a journey or a late walk home: your circle can follow you on a map until you stop.</p><button class="btn block" id="cShare">👥 Start sharing</button>`}
  </div>
  <div class="sec"><h3>SOS cancel PIN</h3>
    <p class="small" style="margin-top:0">${u.has_pin ? '✅ Cancel PIN set.' : '⚠️ No PIN yet — your account password is needed to cancel an SOS.'} ${u.has_duress ? '✅ Duress PIN set.' : ''}
    A <b>duress PIN</b> is optional: if someone forces you to cancel, entering it makes the SOS look cancelled on your phone while it stays active and warns responders and your circle.</p>
    <form id="pinForm"><div class="grid2"><input type="password" name="cancel_pin" inputmode="numeric" maxlength="6" placeholder="Cancel PIN (4–6 digits)" required><input type="password" name="duress_pin" inputmode="numeric" maxlength="6" placeholder="Duress PIN (optional)"></div>
      <div class="grid2" style="margin-top:6px"><input type="password" name="password" placeholder="Account password" required><button class="btn">Save PINs</button></div><div class="err" id="pinErr"></div></form>
  </div>
  ${journeySettingsHint()}
  <div class="sec" hidden><h3>Alerts on this device</h3>
    <p class="small" style="margin-top:0">Get notified when someone in your circle sends an SOS${isSecurity() ? ', and when an SOS or urgent report comes in near your duty location' : ''}, even when the app is closed.</p>
    <button class="btn block" id="cPush">${S.pushOn ? '✅ Notifications on — send a test' : '🔔 Turn on notifications'}</button>
  </div>
  ${false ? `<div class="sec"><h3>Responder settings</h3>
    <p class="small" style="margin-top:0">${u.base ? 'Duty location set. You are alerted to SOS within ' + (S.data.settings.sos_radius_km || 60) + ' km of it.' : 'No duty location set, so you are alerted to every SOS.'}</p>
    <div class="grid2"><button class="btn block" id="cBase">📍 Set duty location</button>${u.base ? '<button class="btn block" id="cBaseClear">Clear</button>' : ''}</div>
    <div class="toggle" style="margin-top:8px"><div>Receive SOS by SMS<small>${esc(u.phone || 'Add a phone number below')}</small></div>${sw('cSms', u.notify_sms)}</div>
    <div class="grid2"><input type="text" id="cPhone" value="${esc(u.phone || '')}" placeholder="Phone" inputmode="tel"><button class="btn" id="cPhoneSave">Save phone</button></div>
  </div>` : ''}
  <div class="sec" hidden><h3>My reports</h3>
    ${S.myReports.length ? `<ul class="jlist">${S.myReports.map(r => `<li>${T(r.type).icon} ${esc(T(r.type).label)} ${statusPill(r)}<div class="small">${ago(r.created_at)}${r.resolved_reason ? ' · ' + esc(r.resolved_reason) : ''}</div></li>`).join('')}</ul>` : '<div class="empty">You have not sent any reports yet.</div>'}
  </div>`;
}

// ---------------- Moderate / Security / Admin ----------------
function expiresIn(r) { if (!r.expires_at) return '—'; const h = (r.expires_at - Date.now()) / 36e5; return h > 48 ? Math.round(h / 24) + ' days' : Math.max(1, Math.round(h)) + ' h'; }
const typeOpts = sel => Object.values(S.data.types).filter(t => t.key !== 'advisory').map(t => `<option value="${t.key}" ${t.key === sel ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
function staffCard(r, buttons) {
  const t = T(r.type), c = r.counts || {};
  return `<div class="card"><div class="t">${t.icon} ${esc(t.label)} ${statusPill(r)} <span class="pill">${ago(r.occurred_at || r.created_at)}</span></div>
    <p>${esc(r.note || '—')}</p>
    <div class="small">${esc(reportFacts(r))}</div>
    <div class="small">Confidence: <b style="color:var(--ink)">${Math.round((r.confidence || 0) * 100)}%</b> (${esc(r.confLabel)})${r.public === false ? ' · hidden from public' : ''}${r.disputed ? ' · <b style="color:#fca5a5">disputed</b>' : ''}</div>
    <div class="small">Reporter: ${esc(r.by_name)}${r.reporter_trust != null ? ` · trust ${Math.round(r.reporter_trust * 100)}%` : ''}${r.reporter_trusted ? ' · ⭐ trusted' : ''} · ${r.corroborations || 0} independent similar report${r.corroborations === 1 ? '' : 's'}</div>
    <div class="small">✔ ${c.confirm || 0} · ⏳ ${c.ongoing || 0} · ✅ ${c.resolved || 0} · ❓ ${c.inaccurate || 0}</div>
    ${media(r, 320)}
    <div class="row wrap" style="margin-top:8px">${buttons}${isMod() && r.has_media && r.media_type !== 'video' ? `<button class="btn sm" data-mediapub="${r.media_public ? 0 : 1}" data-id="${r.id}">${r.media_public ? '🙈 Hide photo from public' : '👁️ Publish photo'}</button>` : ''}${r.has_media && r.media_type === 'video' ? '<span class="small">Video: staff only</span>' : ''}</div>${staffNotes('report', r.id)}</div>`;
}
function moderatePanel() {
  const rank = r => (T(r.type).grp === 'security' ? 2 : 0) + (r.injured === 1 || r.trapped === 1 ? 2 : 0) + (r.confidence || 0);
  const queue = S.data.reports.filter(r => r.status === 'unverified' || r.status === 'investigating').sort((a, b) => rank(b) - rank(a));
  const live = S.data.reports.filter(r => r.status === 'verified').sort((a, b) => b.created_at - a.created_at);
  return suggestionsHTML() + `<div class="sec"><h3>To review · ${queue.length}</h3>
    ${queue.map(r => staffCard(r, `<button class="btn sm primary" data-mod="verify" data-id="${r.id}">Verify</button>
      ${r.status !== 'investigating' ? `<button class="btn sm" data-mod="investigate" data-id="${r.id}">Under investigation</button>` : ''}
      <button class="btn sm" data-mod="reject" data-id="${r.id}">Reject</button><button class="btn sm" data-mod="resolve" data-id="${r.id}">Resolved</button>
      <button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button>
      <select data-retype="${r.id}" style="width:auto;padding:4px 6px;font-size:12px">${typeOpts(r.type)}</select>`)).join('') || '<div class="empty">Nothing waiting.</div>'}
  </div>
  <div class="sec"><h3>Verified and live · ${live.length}</h3>
    ${live.map(r => staffCard(r, `<span class="small">Expires in ${expiresIn(r)}</span><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button><button class="btn sm" data-mod="resolve" data-id="${r.id}">Resolved</button>`)).join('') || '<div class="empty">No live reports.</div>'}
  </div>`;
}
function sosCard(s) {
  const open = s.status !== 'closed';
  return `<div class="card ${s.status === 'open' || s.duress ? 'card-alert' : ''}">
    <div class="t">🆘 ${esc(s.ref || 'SOS')} · ${esc(s.name || 'User')} <span class="pill">${s.status.replace('_', ' ')}</span>${s.duress ? ' <span class="pill st-rej">DURESS</span>' : ''}</div>
    <p>${esc(s.type_label)}${s.phone ? ' · <a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + '</a>' : ''} · sent ${ago(s.created_at)} · location updated ${ago(s.updated_at)}</p>
    ${s.escalation_level ? `<div class="small" style="color:#fca5a5;font-weight:700">Escalation level ${s.escalation_level}</div>` : ''}${s.assignee || s.org_name ? `<div class="small">Assigned: ${esc(s.assignee || s.org_name)}</div>` : ''}
    <ul class="timeline">${s.events.slice(-6).map(e => `<li><span>${clock(new Date(e.at).getHours() + new Date(e.at).getMinutes() / 60)}</span>${esc(e.text)}</li>`).join('')}</ul>
    ${deliveryText(s.delivery)}
    <div class="row wrap" style="margin-top:6px"><button class="btn sm" data-zoom="${s.lat},${s.lng}">View</button><button class="btn sm" data-assignme="${s.id}">Assign to me</button>${s.url ? `<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">Live map</a>` : ''}
      ${open || s.duress ? `<button class="btn sm" data-sos="acknowledged" data-id="${s.id}">Acknowledge</button><button class="btn sm primary" data-sos="responding" data-id="${s.id}">Responding</button><button class="btn sm" data-sos="on_scene" data-id="${s.id}">On scene</button>
      <select data-sosclose="${s.id}" style="width:auto;padding:4px 6px;font-size:12px"><option value="">Close as…</option><option value="resolved">Resolved</option><option value="handed_over">Handed to other agency</option><option value="unreachable">Could not reach</option><option value="false_alarm">False alarm</option></select>` : ''}</div>${notesBlock('sos', s.id, s.notes)}</div>`;
}
function securityPanel() {
  const live = S.data.reports.filter(r => r.status === 'verified' && T(r.type).grp === 'security' && r.type !== 'advisory').sort((a, b) => T(b.type).weight - T(a.type).weight);
  const unv = S.data.reports.filter(r => (r.status === 'unverified' || r.status === 'investigating')).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const posts = S.data.places.filter(p => SECURITY_CATS.includes(p.category)).map(p => ({ p, d: S.user.base ? km(S.user.base, [p.lat, p.lng]) : (S.pos ? km(S.pos, [p.lat, p.lng]) : 0) })).sort((a, b) => a.d - b.d).slice(0, 6);
  return officersHTML() + `${!S.pushOn ? `<div class="sec" style="background:#3a2d0b"><b>🔔 Turn on emergency notifications</b><p class="small">So SOS alerts reach this device even when the app is closed.</p><button class="btn primary block" id="sPush">Turn on</button></div>` : ''}
  <div class="sec"><h3>SOS alerts</h3>${S.sosList.map(sosCard).join('') || '<div class="empty">No SOS in the last 24 hours.</div>'}</div>
  <div class="sec"><button class="btn primary block" id="bAdv">🛡️ Post official advisory</button></div>
  <div class="sec"><h3>Verified security incidents</h3>
    ${live.map(r => staffCard(r, `<button class="btn sm ${r.responding_by ? '' : 'primary'}" data-resp="${r.responding_by ? 0 : 1}" data-id="${r.id}">${r.responding_by ? 'Stop responding' : 'Responding'}</button><button class="btn sm" data-clear="${r.id}">Mark resolved</button><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button>`)).join('') || '<div class="empty">None.</div>'}
  </div>
  <div class="sec"><h3>Unverified and under investigation</h3>
    ${unv.map(r => staffCard(r, `<button class="btn sm primary" data-official="${r.id}">Confirm as official</button><button class="btn sm" data-clear="${r.id}">Resolved / not found</button><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button>`)).join('') || '<div class="empty">None.</div>'}
  </div>
  <div class="sec"><h3>Security posts near you</h3><p class="small" style="margin-top:0">Confirming a post is operating tells travellers that help is really there.</p>
    ${posts.map(({ p, d }) => `<div class="card"><div class="t">${(CAT[p.category] || {}).icon} ${esc(p.name)}</div><p>${fmtKm(d)} · ${p.operational === 'confirmed' && p.last_confirmed_at ? 'confirmed ' + ago(p.last_confirmed_at) : p.operational === 'closed' ? 'reported closed' : 'not confirmed'}</p>
      <div class="row"><button class="btn sm primary" data-post="confirmed" data-id="${p.id}">Operating now</button><button class="btn sm" data-post="closed" data-id="${p.id}">Closed</button></div></div>`).join('') || '<div class="empty">No posts recorded yet.</div>'}
  </div>`;
}
async function loadAdmin() {
  try { [S.users, S.stats] = await Promise.all([api('/api/admin/users'), api('/api/admin/stats')]); if (S.tab === 'admin') renderPanel(); } catch (e) { toast(e.message); }
}
function adminPanel() {
  const st = S.stats || {}, s = S.data.settings;
  const req = S.users.filter(u => u.security_status === 'pending');
  const f = (n, l) => `<div class="factor"><b>${n ?? '–'}</b><span>${l}</span></div>`;
  return `<div class="sec"><h3>Overview</h3><div class="factors">${f(st.users, 'Users')}${f(st.unverified, 'Unverified')}${f(st.investigating, 'Investigating')}${f(st.verified, 'Verified')}</div>
    <div class="factors" style="margin-top:6px">${f(st.open_sos, 'Open SOS')}${f(st.push_devices, 'Alert devices')}${f(st.places, 'Places')}${f(st.sms_enabled ? 'On' : 'Off', 'SMS')}</div>
    ${st.sms_enabled ? '' : '<p class="small">SMS is off. Add your Twilio details to <code>.env</code> to text Safe Circle contacts and responders.</p>'}</div>
  <div class="sec"><h3>Security verification · ${req.length}</h3>
    ${req.map(u => `<div class="card"><div class="t">${esc(u.name)}</div><p>${esc(u.agency || 'No agency given')}<br>${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</p>
      <div class="row"><button class="btn sm primary" data-verify="${u.id}">Verify as security</button><button class="btn sm" data-unverify="${u.id}">Decline</button></div></div>`).join('') || '<div class="empty">No requests. Check ID cards or official letters before verifying.</div>'}
  </div>
  <div class="sec"><h3>Users</h3>
    <table class="mini">${S.users.slice(0, 200).map(u => `<tr><td><b>${esc(u.name)}</b>${u.banned ? ' <span class="pill">banned</span>' : ''}<br><span class="small">${esc(u.email)} · trust ${Math.round((u.trust || 0) * 100)}%</span></td>
      <td style="width:112px"><select data-role="${u.id}" style="padding:3px 5px;font-size:12px">${['traveller', 'security', 'moderator', 'admin'].map(r => `<option ${u.role === r ? 'selected' : ''} value="${r}">${r}</option>`).join('')}</select></td>
      <td style="width:118px;text-align:right"><button class="btn sm" data-trusted="${u.id}" data-val="${u.trusted ? 0 : 1}" title="Trusted contributor">${u.trusted ? '⭐' : '☆'}</button> <button class="btn sm" data-ban="${u.id}" data-val="${u.banned ? 0 : 1}">${u.banned ? 'Unban' : 'Ban'}</button></td></tr>`).join('')}</table>
    <p class="small">⭐ marks a trusted contributor: their reports start with higher confidence.</p>
  </div>
  <div class="sec"><h3>Places · ${S.data.places.length}</h3>
    <button class="btn primary block" id="bAddPlace">➕ Add hospital, police post, mechanic…</button>
    <details style="margin-top:10px"><summary>Show all places</summary><table class="mini" style="margin-top:6px">${S.data.places.map(p => `<tr><td>${(CAT[p.category] || {}).icon || ''} ${esc(p.name)}${SECURITY_CATS.includes(p.category) ? `<br><span class="small">${p.operational}</span>` : ''}</td><td style="width:90px;text-align:right"><button class="btn sm" data-zoom="${p.lat},${p.lng}">View</button> <button class="btn sm" data-delplace="${p.id}">✕</button></td></tr>`).join('')}</table></details>
  </div>
  <div class="sec"><h3>Area types · ${S.data.zones.length}</h3>
    <button class="btn block" id="bAddZone">➕ Add area</button>
    <table class="mini" style="margin-top:8px">${S.data.zones.map(z => `<tr><td>${esc(z.name)}<br><span class="small">${SETTLE_LABEL[z.type]} · ${z.radius_km} km</span></td><td style="width:90px;text-align:right"><button class="btn sm" data-zoom="${z.lat},${z.lng}">View</button> <button class="btn sm" data-delzone="${z.id}">✕</button></td></tr>`).join('')}</table>
  </div>
  <div class="sec"><h3>Incident categories</h3><p class="small" style="margin:0 0 8px">Points · warning radius km · lifetime h · half-life h (how fast a report's weight fades)</p>
    <table class="mini">${Object.values(S.data.types).map(t => `<tr><td>${t.icon} ${esc(t.label)}<br><span class="small">${t.grp}</span></td><td style="width:230px;text-align:right"><input data-tw="${t.key}" value="${t.weight}"> <input data-tr="${t.key}" value="${t.radius_km}"> <input data-tt="${t.key}" value="${t.ttl_hours}"> <input data-th="${t.key}" value="${t.half_life_h}"></td></tr>`).join('')}</table>
    <button class="btn block" id="bSaveTypes" style="margin-top:8px">Save categories</button>
  </div>
  <div class="sec"><h3>Scoring rules</h3>
    <table class="mini">${[
      ['level_cutoffs', 'Moderate, High, Severe start at'], ['tourist_shift', 'Tourist Mode warns earlier by'], ['time_dusk', 'Dusk multiplier (18–21h)'], ['time_night', 'Night multiplier (21–06h)'],
      ['history_radius_km', 'Past-incident radius (km)'], ['history_cap', 'Max points from past incidents'], ['no_post_pts', 'Points if no security post within 10 km'],
      ['post_confirm_days', 'Days a post stays “confirmed”'], ['rain_heavy_mm3h', 'Heavy rain (mm in 3 h)'], ['rain_heavy_pts', 'Points for heavy rain'],
      ['public_min_confidence', 'Unverified security report shown publicly from'], ['corroborate_km', 'Similar reports support each other within km'], ['corroborate_hours', '…and within hours'],
      ['alert_lookahead_s', 'Warn this many seconds ahead'], ['reports_per_hour', 'Reports per user per hour'], ['sos_radius_km', 'SOS alert radius for responders (km)'], ['tz_offset_hours', 'Time zone offset (hours)']
    ].map(([k, l]) => `<tr><td>${l}</td><td style="width:90px;text-align:right"><input data-set="${k}" value="${esc(s[k] ?? '')}" style="width:80px"></td></tr>`).join('')}</table>
    <button class="btn block" id="bSaveSet" style="margin-top:8px">Save rules</button>
  </div>${adminV3HTML()}`;
}
function renderPanel() {
  const p = $('#panel');
  const V = { services: helpPanel, fleet: fleetPanel, journey: journeyPanel, circle: circlePanel, alerts: alertsPanel, sos: sosPanel, watch: watchPanel, account: accountPanel };
  p.innerHTML = `<div class="phead"><h2>${(sectionList().find(t => t[0] === S.tab) || SECTIONS[0]).slice(1).join(' ')}</h2></div>` + (V[S.tab] || mapPanel)();
  bindPanel(); bindV4($('#panel')); update();
}
function bindPanel() {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  // map tab
  on('bGps', 'click', () => { if (S.mode === 'gps') { stopGps(); S.mode = 'none'; renderPanel(); } else startGps(); });
  on('bPlace', 'click', () => startPick('place-me', 'Tap the map to put yourself there'));
  on('bReport', 'click', () => { audio(); reportStart(); });
  on('hour', 'input', e => { S.planHour = +e.target.value; $('#hourLbl').textContent = clock(S.planHour) + ' · ' + timeLabel(S.planHour); S.lastLevel = Math.min(S.lastLevel, 0); update(); });
  on('hour', 'change', () => renderPanel());
  on('hourNow', 'click', () => { S.planHour = null; renderPanel(); });
  on('tWarn', 'change', e => { S.warn = e.target.checked; store.set('warn', S.warn); if (!S.warn) try { speechSynthesis.cancel(); } catch (x) {} });
  on('tVoice', 'change', e => { S.voice = e.target.checked; store.set('voice', S.voice); });
  on('tTour', 'change', e => { S.tourist = e.target.checked; store.set('tourist', S.tourist); S.lastLevel = 0; audio(); update(); if (S.tourist) announce('Tourist Mode on. I will warn you earlier about higher-risk places.', '#22c55e', 'chime'); });
  on('tDriver', 'change', e => setDriver(e.target.checked));
  on('bTest', 'click', () => { audio(); announce('Warning. High security risk here, moderate confidence. Two recent robbery reports nearby. Consider an alternative route and avoid unnecessary stops on this stretch.', '#ef4444', 'high', true); });
  on('bTestDrive', 'click', () => { if (S.mode === 'test') { stopTest(); renderPanel(); } else startTest(); });
  on('bTestEnd', 'click', () => { stopTest(); S.test = null; S.mode = 'none'; S.pos = null; map.removeLayer(meMarker); drawTestRoute(); renderPanel(); });
  on('bTripView', 'click', () => setTab('journey'));
  on('bTripEnd', 'click', () => { S.trip = null; gJourney.clearLayers(); renderPanel(); toast('Trip ended'); });
  // journey tab
  ['from', 'to'].forEach(w => {
    const inp = $('#jq-' + w); if (inp) inp.addEventListener('input', () => { clearTimeout(geoTimer); geoTimer = setTimeout(() => geoSearch(w, inp.value.trim()), 500); });
  });
  on('jMine', 'click', () => { if (!S.pos) { startGps(true); toast('Getting your location… press again in a moment'); return; } S.journey.from = { p: S.pos.slice(), name: 'My location', mine: true }; S.journey.routes = []; renderPanel(); });
  $$('#panel [data-jpick]').forEach(b => b.onclick = () => startPick('j-' + b.dataset.jpick, b.dataset.jpick === 'from' ? 'Tap your starting point' : 'Tap your destination'));
  $$('#panel [data-jclear]').forEach(b => b.onclick = () => { S.journey[b.dataset.jclear] = null; S.journey.routes = []; gJourney.clearLayers(); renderPanel(); drawJourneyPins(); });
  on('jDep', 'input', e => { S.journey.depart = +e.target.value; $('#jDepLbl').textContent = clock(S.journey.depart); });
  on('jDep', 'change', () => { if (S.journey.routes.length) findRoutes(); });
  on('jGo', 'click', findRoutes);
  $$('#panel [data-route]').forEach(b => b.onclick = () => { S.journey.sel = +b.dataset.route; S.follow = false; renderPanel(); drawJourney(); map.fitBounds(L.latLngBounds(S.journey.routes[S.journey.sel].coords).pad(.1)); });
  $$('#panel [data-jzoom]').forEach(b => b.onclick = () => { map.setView(b.dataset.jzoom.split(',').map(Number), 14); if (window.innerWidth < 860) $('#mapwrap').scrollIntoView({ behavior: 'smooth' }); });
  on('jStart', 'click', () => journeyModal(true));
  on('jShare', 'click', () => shareTrip(true));
  // circle tab
  on('cSign', 'click', () => authModal());
  on('cForm', 'submit', async e => { e.preventDefault(); try { await api('/api/circle', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); loadCircle(); } catch (x) { $('#cErr').textContent = x.message; } });
  on('pinForm', 'submit', async e => { e.preventDefault(); try { await api('/api/me/emergency', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('PINs saved'); load(); } catch (x) { $('#pinErr').textContent = x.message; } });
  on('cShare', 'click', () => shareTrip(false));
  on('cShowLink', 'click', () => shareLinks(S.myShare.url, 'Follow my live location on SafeRoute:'));
  on('cStop', 'click', async () => { await api('/api/share/stop', { method: 'POST' }).catch(() => {}); S.myShare = null; toast('Stopped sharing'); renderPanel(); });
  on('cPush', 'click', () => S.pushOn ? api('/api/push/test', { method: 'POST' }).catch(() => toast('Notifications are on')) : enablePush());
  on('sPush', 'click', enablePush);
  on('cBase', 'click', () => startPick('base', 'Tap your duty location'));
  on('cBaseClear', 'click', () => api('/api/me/base', { method: 'PUT', body: { clear: true } }).then(load));
  on('cSms', 'change', e => api('/api/me', { method: 'PUT', body: { notify_sms: e.target.checked } }).then(load));
  on('cPhoneSave', 'click', () => api('/api/me', { method: 'PUT', body: { phone: $('#cPhone').value } }).then(() => { toast('Saved'); load(); }));
  // staff
  on('bAdv', 'click', () => startPick('advisory', 'Tap the map where the advisory applies'));
  on('bAddPlace', 'click', () => startPick('place', 'Tap the map where the place is'));
  on('bAddZone', 'click', () => startPick('zone', 'Tap the centre of the area'));
  on('bSaveTypes', 'click', async () => {
    try {
      for (const t of Object.values(S.data.types)) {
        const v = k => $(`[data-${k}="${t.key}"]`).value;
        if (+v('tw') !== t.weight || +v('tr') !== t.radius_km || +v('tt') !== t.ttl_hours || +v('th') !== t.half_life_h)
          await api('/api/types/' + t.key, { method: 'PUT', body: { weight: v('tw'), radius_km: v('tr'), ttl_hours: v('tt'), half_life_h: v('th') } });
      }
      toast('Saved'); load();
    } catch (e) { toast(e.message); }
  });
  on('bSaveSet', 'click', async () => { const body = {}; $$('[data-set]').forEach(i => { body[i.dataset.set] = i.value; }); try { await api('/api/settings', { method: 'PUT', body }); toast('Rules saved'); load(); } catch (e) { toast(e.message); } });
  const P = $('#panel');
  const act = (sel, fn) => P.querySelectorAll(sel).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'click', async () => { try { await fn(el); } catch (e) { toast(e.message); } }));
  act('[data-zoom]', el => { S.follow = false; map.setView(el.dataset.zoom.split(',').map(Number), 15); if (window.innerWidth < 860) $('#mapwrap').scrollIntoView({ behavior: 'smooth' }); });
  act('[data-cdel]', async el => { await api('/api/circle/' + el.dataset.cdel, { method: 'DELETE' }); loadCircle(); });
  act('[data-mod]', async el => { const sel = P.querySelector(`[data-retype="${el.dataset.id}"]`); await api(`/api/reports/${el.dataset.id}/moderate`, { method: 'POST', body: { action: el.dataset.mod, type: sel ? sel.value : undefined } }); toast({ verify: 'Verified — now public with high confidence', investigate: 'Marked under investigation', reject: 'Rejected', resolve: 'Marked resolved' }[el.dataset.mod]); S.lastLevel = 0; load(); });
  act('[data-retype]', async el => { await api(`/api/reports/${el.dataset.retype}/moderate`, { method: 'POST', body: { action: 'retype', type: el.value } }); load(); });
  act('[data-resp]', async el => { await api(`/api/reports/${el.dataset.id}/respond`, { method: 'POST', body: { responding: el.dataset.resp === '1' } }); toast(el.dataset.resp === '1' ? 'Travellers now see “Security responding”' : 'Updated'); load(); });
  act('[data-clear]', async el => { await api(`/api/reports/${el.dataset.clear}/clear`, { method: 'POST' }); toast('Resolved — removed from the map'); load(); });
  act('[data-official]', async el => { await api(`/api/reports/${el.dataset.official}/official`, { method: 'POST' }); toast('Confirmed as official'); S.lastLevel = 0; load(); });
  act('[data-post]', async el => { await api(`/api/places/${el.dataset.id}/status`, { method: 'POST', body: { operational: el.dataset.post } }); toast('Post status updated'); load(); });
  act('[data-sos]', async el => { markSosSeen(+el.dataset.id); await api(`/api/sos/${el.dataset.id}/status`, { method: 'POST', body: { status: el.dataset.sos } }); toast('Status sent — the person and their circle can see it'); loadSos(); });
  act('[data-sosclose]', async el => { if (!el.value) return; markSosSeen(+el.dataset.sosclose); await api(`/api/sos/${el.dataset.sosclose}/status`, { method: 'POST', body: { status: 'closed', reason: el.value } }); toast('SOS closed'); loadSos(); });
  act('[data-verify]', async el => { await api(`/api/admin/users/${el.dataset.verify}`, { method: 'POST', body: { role: 'security', security_status: 'verified' } }); toast('Verified'); loadAdmin(); });
  act('[data-unverify]', async el => { await api(`/api/admin/users/${el.dataset.unverify}`, { method: 'POST', body: { security_status: 'rejected' } }); loadAdmin(); });
  act('[data-role]', async el => { await api(`/api/admin/users/${el.dataset.role}`, { method: 'POST', body: { role: el.value } }); toast('Role updated'); loadAdmin(); });
  act('[data-ban]', async el => { await api(`/api/admin/users/${el.dataset.ban}`, { method: 'POST', body: { banned: el.dataset.val === '1' } }); loadAdmin(); });
  act('[data-trusted]', async el => { await api(`/api/admin/users/${el.dataset.trusted}`, { method: 'POST', body: { trusted: el.dataset.val === '1' } }); loadAdmin(); });
  act('[data-delplace]', async el => { await api('/api/places/' + el.dataset.delplace, { method: 'DELETE' }); toast('Place removed'); load(); });
  act('[data-delzone]', async el => { await api('/api/zones/' + el.dataset.delzone, { method: 'DELETE' }); toast('Removed'); load(); });
  if (S.tab === 'security') S.sosList.filter(s => s.status !== 'open').forEach(s => markSosSeen(s.id));
  bindV3(P);
}

// ---------------- push notifications ----------------
function b64ToU8(b) { const p = '='.repeat((4 - b.length % 4) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); }
async function checkPush() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); S.pushOn = !!sub; if (sub && S.user) api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }).catch(() => {}); } catch (e) { S.pushOn = false; }
}
async function enablePush() {
  if (!S.user) return authModal('Sign in first');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser cannot receive notifications. On iPhone, add the app to your Home Screen first.', 6000);
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications were blocked. Allow them for this site in your browser settings.', 5000);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.data.push_key) });
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    S.pushOn = true; toast('Notifications are on for this device'); renderPanel();
  } catch (e) { toast('Could not turn on notifications: ' + e.message, 5000); }
}

// ---------------- SOS (Emergency Connect) ----------------
function sosSmsText() {
  const p = S.pos ? `https://maps.google.com/?q=${S.pos[0].toFixed(5)},${S.pos[1].toFixed(5)}` : '(location unavailable)';
  return `EMERGENCY: I need help.${S.sos ? ' SafeRoute ref ' + S.sos.ref + '.' : ''} My location: ${p}${S.sos && S.sos.url ? ' Live: ' + S.sos.url : ''}`;
}
function sosSheet() {
  audio();
  if (S.sos) return sosLiveView();
  const post = S.pos ? nearest(S.pos, S.data.places, SECURITY_CATS, p => p.operational !== 'closed') : null;
  modal(`<h2 style="color:#f87171">Emergency</h2>
    <div class="sosopt crit"><div class="row between"><b>🆘 Emergency SOS</b><span class="pill st-rej">Critical</span></div>
      <p class="small">Sends your location${S.circle.length ? ` to your Safe Circle (${S.circle.length})` : ''} and to verified responders near you, gives you a reference number, and keeps updating your location until you cancel.</p>
      ${S.user ? `<div class="chips" id="sosType">${SOS_TYPES.map(([k, l], i) => `<button type="button" data-t="${k}" class="${i === 5 ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="holdbtn" id="sosHold"><span class="fill"></span><span class="lbl">Press and hold to send SOS</span></button>`
      : `<p class="small" style="color:#fcd34d">Sign in so responders know who needs help.</p><button class="btn block" id="sosSign">Sign in</button>`}
    </div>
    <div class="sosopt"><b>👥 Safe Circle</b><p class="small">Not an emergency? Let your circle follow your live location.</p><button class="btn block" id="sosCircle">${S.myShare ? 'Show my sharing link' : 'Share my live location'}</button></div>
    <div class="sosopt"><b>📞 Call emergency services</b><p class="small">112 connects to police, ambulance, fire service, FRSC and NSCDC.</p>
      <div class="grid2"><a class="btn danger block" href="tel:112">Call 112</a>${post && post.place.phone ? `<a class="btn block" href="tel:${esc(post.place.phone)}">Call ${esc(post.place.name.split(',')[0])}</a>` : `<a class="btn block" href="sms:${esc(phonesCsv())}?&body=${encodeURIComponent(sosSmsText())}">Text my location</a>`}</div></div>
    <p class="small">Sending an SOS through SafeRoute does not, by itself, guarantee that emergency personnel have received or accepted it. If you can, also call 112.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>`);
  $$('#sosType button').forEach(b => b.onclick = () => $$('#sosType button').forEach(x => x.classList.toggle('on', x === b)));
  const sign = $('#sosSign'); if (sign) sign.onclick = () => authModal('Sign in to send an SOS. In immediate danger, call 112 now.');
  $('#sosCircle').onclick = () => S.myShare ? shareLinks(S.myShare.url, 'Follow my live location on SafeRoute:') : shareTrip(false);
  const hold = $('#sosHold');
  if (hold) {
    let t = null;
    const startHold = e => { e.preventDefault(); hold.classList.add('holding'); t = setTimeout(() => { hold.classList.remove('holding'); sosCountdown(); }, 1800); };
    const stopHold = () => { hold.classList.remove('holding'); clearTimeout(t); };
    hold.addEventListener('pointerdown', startHold); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => hold.addEventListener(ev, stopHold));
    hold.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sosCountdown(); } });
  }
}
async function sendSos(type) {
  type = type || 'other';
  if (navigator.vibrate) try { navigator.vibrate([400, 100, 400]); } catch (e) {}
  const getPos = () => new Promise(res => {
    if (S.pos && (S.mode === 'gps' || S.mode === 'test' || S.mode === 'placed')) return res(S.pos);
    if (!('geolocation' in navigator)) return res(null);
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]), () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
  modal(`<h2 style="color:#f87171">Sending SOS…</h2><p>Getting your location and alerting your circle and responders.</p>`);
  const p = await getPos();
  if (!p) return sosFallback('Your location could not be found.');
  S.pos = S.pos || p;
  try {
    S.sos = await api('/api/sos', { method: 'POST', body: { lat: p[0], lng: p[1], type } });
    $('#sos').classList.add('active');
    if (S.mode !== 'gps' && S.mode !== 'test') startGps(true);
    sosLiveView();
  } catch (e) { sosFallback(e.message); }
}
function sosFallback(why) {
  modal(`<h2 style="color:#f87171">Could not reach SafeRoute</h2><p>${esc(why)} Use these now — they work through your phone network:</p>
    <div class="grid2" style="margin-top:10px"><a class="btn danger block" href="tel:112">Call 112</a><a class="btn block" href="sms:${esc(phonesCsv())}?&body=${encodeURIComponent(sosSmsText())}">SMS my location</a></div>
    <a class="btn block" style="margin-top:8px" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(sosSmsText())}">Send on WhatsApp</a>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn primary" id="sRetry">Try again</button></div>`);
  $('#sRetry').onclick = sosSheet;
}
function sosLiveView() {
  const s = S.sos; if (!s) return;
  const stLabel = { open: 'Alert sent — waiting for a responder', acknowledged: 'Acknowledged by a responder', responding: 'A responder is on the way', on_scene: 'Responder on the scene' }[s.status] || s.status;
  modal(`<div id="sosLive"><h2 style="color:#f87171">SOS ACTIVE</h2>
    <div class="refbox">Reference <b>${esc(s.ref)}</b></div>
    <p><b>${esc(stLabel)}</b><br><span class="small">Your location is shared every 15 seconds${S.pos ? '' : ' (waiting for GPS)'}.</span></p>
    <ul class="timeline">${(s.events || []).map(e => `<li><span>${clock(new Date(e.at).getHours() + new Date(e.at).getMinutes() / 60)}</span>${esc(e.text)}</li>`).join('')}</ul>
    ${deliveryText(s.delivery)}
    <div class="grid2" style="margin-top:10px"><a class="btn danger block" href="tel:112">Call 112</a><a class="btn block" href="sms:${esc(phonesCsv())}?&body=${encodeURIComponent(sosSmsText())}">SMS from my phone</a></div>
    <div class="grid2" style="margin-top:8px"><a class="btn block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(sosSmsText())}">WhatsApp</a><button class="btn block" id="sCopy">Copy live link</button></div>
    <p class="small">This does not by itself guarantee that emergency personnel have received or accepted your alert. If you can, also call 112.</p>
    <div class="row" style="margin-top:8px;justify-content:space-between"><button class="btn" data-close>Hide</button><button class="btn" id="sCancel">Cancel SOS</button></div></div>`);
  $('#sCopy').onclick = () => { try { navigator.clipboard.writeText(s.url); toast('Link copied'); } catch (e) { toast(s.url, 8000); } };
  $('#sCancel').onclick = () => {
    const hasPin = S.user && S.user.has_pin;
    modal(`<h2>Cancel SOS</h2><p>${hasPin ? 'Enter your cancel PIN.' : 'Enter your account password to cancel.'}</p>
      <form id="cxForm"><input type="password" name="pin" ${hasPin ? 'inputmode="numeric" maxlength="6"' : ''} autocomplete="off" required placeholder="${hasPin ? 'PIN' : 'Password'}" style="font-size:20px;text-align:center">
      <div class="err" id="cxErr"></div><div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" id="cxBack">Keep SOS active</button><button class="btn danger">Cancel SOS</button></div></form>`);
    $('#cxBack').onclick = sosLiveView;
    $('#cxForm').onsubmit = async e => {
      e.preventDefault();
      const v = new FormData(e.target).get('pin');
      try {
        await api('/api/sos/cancel', { method: 'POST', body: hasPin ? { pin: v } : { password: v } });
        S.sos = null; $('#sos').classList.remove('active'); closeModal(); toast('SOS cancelled');
      } catch (x) { $('#cxErr').textContent = x.message; }
    };
  };
}

// ---------------- driver mode, account, controls ----------------
function setDriver(on) { S.driver = on; $('#driver').classList.toggle('show', on); const t = $('#tDriver'); if (t) t.checked = on; if (on && S.mode === 'none') toast('Press Start so Driver Mode can follow your location'); update(); }
$('#dExit').onclick = () => setDriver(false);
$('#dReport').onclick = () => {
  if (!S.user) return authModal('Sign in to send reports');
  if (!S.pos) return toast('Location is off');
  const keys = ['accident', 'flood', 'blockage', 'roadcond', 'robbery', 'secop'].filter(k => S.data.types[k]);
  modal(`<h2>Quick report</h2><p>One tap. Your current position is used.</p><div class="grid2" style="margin-top:12px">${keys.map(k => `<button class="btn block" data-q="${k}" style="padding:14px">${T(k).icon} ${esc(T(k).label)}</button>`).join('')}</div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button></div>`);
  $$('[data-q]').forEach(b => b.onclick = async () => {
    const fd = new FormData(); fd.append('type', b.dataset.q); fd.append('lat', S.pos[0]); fd.append('lng', S.pos[1]); fd.append('note', 'Quick report from a driver'); fd.append('ongoing', 'yes'); fd.append('source', 'witness');
    try { await api('/api/reports', { method: 'POST', form: fd }); closeModal(); toast('Reported — thank you'); load(); } catch (e) { toast(e.message); }
  });
};
$('#sos').onclick = sosSheet;
$('#hint').onclick = () => { endPick(); clearMarker(); toast('Cancelled'); };
$('#btnAccount').onclick = () => S.user ? setTab('account') : authModal();
const _oldAccount = () => {
  if (!S.user) return authModal();
  const u = S.user;
  modal(`<h2>${esc(u.name)}</h2><p>${esc(u.email)}<br>Role: <b>${esc(u.role)}</b>${u.security_status ? ` · Security status: <b>${esc(u.security_status)}</b>` : ''}${u.trusted ? ' · ⭐ Trusted contributor' : ''}</p>
    ${u.security_status === 'pending' ? '<p class="small">An admin will verify your security account. You will then see the Security tab.</p>' : ''}
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn" id="bLogout">Sign out</button></div>`);
  $('#bLogout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.sos = null; S.circle = []; S.myShare = null; S.tab = 'map'; closeModal(); toast('Signed out'); load(); };
};
$('#btnLayer').onclick = () => { S.sat = !S.sat; store.set('sat', S.sat); setBase(); };
$('#btnFollow').onclick = () => { if (!S.pos) return toast('Location is off'); S.follow = true; map.setView(S.pos, 15); };

// ---------------- modal + toast ----------------
let onModalClose = null;
function modal(html, onClose) { $('#modalBox').innerHTML = html; $('#modal').classList.add('show'); onModalClose = onClose || null; $$('#modalBox [data-close]').forEach(b => b.onclick = closeModal); }
function closeModal() { $('#modal').classList.remove('show'); if (onModalClose) { const f = onModalClose; onModalClose = null; f(); } }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#sosHold')) closeModal(); });
let tt = null;
function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => t.style.display = 'none', ms || 2800); }

// links from notifications: /?tab=security&sos=12 or /?report=5
function handleUrl() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab'); if (tab) S.tab = tab;
  const rid = +q.get('report'); if (rid) { const r = S.data.reports.find(x => x.id === rid); if (r) setTimeout(() => map.setView([r.lat, r.lng], 15), 300); }
  const sid = +q.get('sos'); if (sid) setTimeout(() => { const s = S.sosList.find(x => x.id === sid); if (s) map.setView([s.lat, s.lng], 15); }, 1500);
  if (q.toString()) history.replaceState(null, '', '/');
}


// =====================================================================
// v3: security (two-step, sessions), inbox, offline packs + queued reports, journeys with check-in,
//     community alerts, directory, heatmap, safety briefing, agencies, fleet
// =====================================================================
const gFleet = L.layerGroup().addTo(map), gHeat = L.layerGroup().addTo(map);
function csrfToken() { const m = document.cookie.match(/(?:^|;\s*)sr_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
const fmtWhen = ms => { if (!ms || ms < 1e9) return 'earlier'; const d = new Date(ms), t = d.toTimeString().slice(0, 5); return new Date().toDateString() === d.toDateString() ? `${t} today (${ago(ms)})` : `${d.toLocaleDateString()} ${t}`; };
const fmtDate = ms => ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
function showOffline() {
  const el = $('#offline');
  if (!navigator.onLine) { el.style.display = 'block'; el.textContent = `Offline — showing saved data from ${fmtWhen(S.stale || S.data.generated_at)}`; }
  else if (S.stale) { el.style.display = 'block'; el.textContent = `Showing saved data from ${fmtWhen(S.stale)}`; }
  else el.style.display = 'none';
}
function placeNear(p) {
  const zs = (S.data.zones || []).filter(z => km(p, [z.lat, z.lng]) <= z.radius_km).sort((a, b) => a.radius_km - b.radius_km);
  if (zs[0]) return 'near ' + zs[0].name.replace(/ \(demo\)$/, '');
  const n = nearest(p, S.data.places); if (n && n.d <= 8) return 'near ' + n.place.name.replace(/ \(demo\)$/, '');
  return '';
}
Object.assign(CAT, {
  community: { label: 'Community security', icon: '🤝', bg: '#1e3a8a' }, sema: { label: 'Emergency management (SEMA)', icon: '🆘', bg: '#9a3412' },
  fire: { label: 'Fire service', icon: '🚒', bg: '#dc2626' }, ambulance: { label: 'Ambulance', icon: '🚑', bg: '#e11d48' }
});

// ---------- inbox ----------
function setUnread(n) { S.unread = n; const b = $('#bellBadge'); if (b) { b.textContent = n > 9 ? '9+' : n; b.style.display = n ? 'inline-block' : 'none'; } }
async function openInbox() { setTab('alerts'); }
async function openInboxModal() {
  if (!S.user) return authModal('Sign in to see your alerts');
  let d; try { d = await api('/api/inbox'); } catch (e) { return toast(e.message); }
  modal(`<h2>Alerts</h2>${d.items.length ? `<ul class="jlist">${d.items.map((x, i) => `<li class="${x.read_at ? '' : 'unread'}"><button class="linkish" data-inb="${i}" style="text-align:left">${esc(x.title)}</button><div class="small">${esc(x.body)}</div><div class="small">${ago(x.created_at)}</div></li>`).join('')}</ul>` : '<div class="empty">No alerts yet. Community alerts, check-in reminders and SOS updates appear here.</div>'}
    <div class="row" style="margin-top:12px;justify-content:space-between"><button class="btn" id="inbSet">⚙️ Alert settings</button><button class="btn" data-close>Close</button></div>`);
  $$('[data-inb]').forEach(b => b.onclick = () => { closeModal(); openUrl(d.items[+b.dataset.inb].url); });
  $('#inbSet').onclick = () => { closeModal(); setTab('circle'); };
  api('/api/inbox/read', { method: 'POST' }).then(() => setUnread(0)).catch(() => {});
}
function openUrl(url) {
  if (!url || url === '/') return;
  if (url.startsWith('/t/')) { window.open(url, '_blank', 'noopener'); return; }
  const q = new URLSearchParams(url.split('?')[1] || '');
  if (q.get('tab')) setTab(q.get('tab'));
  const rid = +q.get('report'); if (rid) { const r = S.data.reports.find(x => x.id === rid); if (r) { map.setView([r.lat, r.lng], 15); S.follow = false; } }
  if (q.get('journey')) setTab('map');
}

// ---------- two-step verification, password, devices ----------
function mfaCode(ticket) {
  return new Promise(resolve => {
    modal(`<h2>Two-step verification</h2><p>Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
      <form id="mfaF"><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required style="font-size:22px;text-align:center;letter-spacing:.2em">
      <div class="err" id="mfaE"></div><div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" id="mfaX">Cancel</button><button class="btn primary">Verify</button></div></form>`);
    $('#mfaX').onclick = () => { closeModal(); resolve(null); };
    $('#mfaF').onsubmit = async e => {
      e.preventDefault();
      try { resolve(await api('/api/auth/mfa', { method: 'POST', body: { ticket, code: new FormData(e.target).get('code') } })); }
      catch (x) { $('#mfaE').textContent = x.message; }
    };
  });
}
let mfaShown = false;
function mfaSetup(force) {
  if (!S.user || S.user.totp_enabled || (force && mfaShown)) return;
  mfaShown = true;
  modal(`<h2>Set up two-step verification</h2>
    <p>${force ? 'Your account has staff access to sensitive information (locations, reports, SOS). Turn on two-step verification to use staff features.' : 'Adds a code from your phone each time you sign in.'}</p>
    <p class="small">You need an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy.</p>
    <form id="m1"><label class="f">Confirm your password</label><input type="password" name="password" required autocomplete="current-password"><div class="err" id="m1e"></div>
    <div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Later</button><button class="btn primary">Continue</button></div></form>`, () => { mfaShown = false; });
  $('#m1').onsubmit = async e => {
    e.preventDefault();
    let s; try { s = await api('/api/mfa/setup', { method: 'POST', body: { password: new FormData(e.target).get('password') } }); } catch (x) { $('#m1e').textContent = x.message; return; }
    let svg = '';
    try { const qr = qrcode(0, 'M'); qr.addData(s.otpauth); qr.make(); svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (x) {}
    modal(`<h2>Scan this code</h2><p>Open your authenticator app, add an account and scan:</p><div class="qr">${svg}</div>
      <p class="small">Or type this key: <b style="color:var(--ink);letter-spacing:.06em">${esc(s.secret)}</b></p>
      <form id="m2"><label class="f">Enter the 6-digit code it shows</label><input type="text" name="code" inputmode="numeric" maxlength="6" required style="font-size:22px;text-align:center;letter-spacing:.2em">
      <div class="err" id="m2e"></div><div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Turn on</button></div></form>`, () => { mfaShown = false; });
    $('#m2').onsubmit = async e2 => {
      e2.preventDefault();
      try {
        const r = await api('/api/mfa/enable', { method: 'POST', body: { code: new FormData(e2.target).get('code') } });
        modal(`<h2>Two-step verification is on</h2><p>Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
          <div class="codes">${r.backup_codes.map(c => `<code>${c}</code>`).join('')}</div>
          <div class="row" style="margin-top:12px;justify-content:space-between"><button class="btn" id="mcCopy">Copy codes</button><button class="btn primary" data-close>I have saved them</button></div>`, () => { mfaShown = false; load(); });
        $('#mcCopy').onclick = () => { try { navigator.clipboard.writeText(r.backup_codes.join('\n')); toast('Copied'); } catch (x) {} };
      } catch (x) { $('#m2e').textContent = x.message; }
    };
  };
}
async function accountModal() {
  const u = S.user;
  let sessions = []; try { sessions = await api('/api/sessions'); } catch (e) {}
  modal(`<h2>${esc(u.name)}</h2><p>${esc(u.email)}<br>Role: <b>${esc(u.real_role || u.role)}</b>${u.org ? ' · ' + esc(u.org.name) + (u.org_role ? ' (' + u.org_role + ')' : '') : ''}${u.security_status ? ` · Security status: <b>${esc(u.security_status)}</b>` : ''}${u.trusted ? ' · ⭐ Trusted contributor' : ''}</p>
    ${u.security_status === 'pending' ? '<p class="small">An admin or your agency supervisor will verify your security account.</p>' : ''}
    <div class="sosopt"><b>🔐 Two-step verification</b><p class="small">${u.totp_enabled ? '✅ On. A code from your phone is needed each time you sign in.' : u.mfa_needed ? '⚠️ Required for your staff access — not set up yet.' : 'Off. Recommended for everyone, required for staff.'}</p>
      ${u.totp_enabled ? `<form id="mOff" class="grid2"><input type="password" name="password" placeholder="Password" required><input type="text" name="code" placeholder="Code" inputmode="numeric" maxlength="6" required><button class="btn" style="grid-column:span 2">Turn off</button></form><div class="err" id="mOffE"></div>` : '<button class="btn primary block" id="mOn">Set up</button>'}</div>
    <div class="sosopt"><b>🔑 Change password</b><form id="pwF"><div class="grid2" style="margin-top:6px"><input type="password" name="current" placeholder="Current password" required autocomplete="current-password"><input type="password" name="password" placeholder="New password" required autocomplete="new-password"></div>
      <p class="small">At least 8 characters with letters and numbers (10 for staff). Other devices are signed out.</p><button class="btn block">Change password</button><div class="err" id="pwE"></div></form></div>
    <div class="sosopt"><b>📱 Signed-in devices</b><ul class="jlist">${sessions.map(s => `<li><div class="row between"><span>${esc(deviceName(s.ua))}${s.current ? ' <span class="pill st-ver">this device</span>' : ''}${s.mfa ? ' 🔐' : ''}</span>${s.current ? '' : `<button class="btn sm" data-sess="${s.id}">Sign out</button>`}</div><div class="small">Last active ${ago(s.last_seen || s.created_at)} · ${esc(s.ip || '')}</div></li>`).join('')}</ul>
      ${sessions.length > 1 ? '<button class="btn block" id="sessAll">Sign out all other devices</button>' : ''}</div>
    <div class="row" style="margin-top:12px;justify-content:space-between"><button class="btn" id="bLogout">Sign out</button><button class="btn" data-close>Close</button></div>`);
  const on = (id, f) => { const el = $('#' + id); if (el) el.addEventListener(el.tagName === 'FORM' ? 'submit' : 'click', f); };
  on('mOn', () => mfaSetup(false));
  on('mOff', async e => { e.preventDefault(); try { await api('/api/mfa/disable', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Two-step verification turned off'); closeModal(); load(); } catch (x) { $('#mOffE').textContent = x.message; } });
  on('pwF', async e => { e.preventDefault(); try { await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Password changed'); closeModal(); } catch (x) { $('#pwE').textContent = x.message; } });
  $$('[data-sess]').forEach(b => b.onclick = async () => { await api('/api/sessions/' + b.dataset.sess, { method: 'DELETE' }).catch(() => {}); accountModal(); });
  on('sessAll', async () => { await api('/api/sessions/others', { method: 'POST' }).catch(() => {}); toast('Other devices signed out'); accountModal(); });
  on('bLogout', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.sos = null; S.circle = []; S.myShare = null; S.journeyActive = null; S.tab = 'map'; closeModal(); toast('Signed out'); load(); });
}
function deviceName(ua) {
  ua = ua || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

// ---------- offline safety packs ----------
const packIndex = () => store.get('packs', []);
function savePack(name, center, routeCoords) {
  const pts = routeCoords ? (() => { const o = []; for (let i = 0; i < routeCoords.length; i += Math.max(1, Math.floor(routeCoords.length / 300))) o.push(routeCoords[i]); o.push(routeCoords[routeCoords.length - 1]); return o; })() : [center];
  const within = (lat, lng, r) => pts.some(p => km(p, [lat, lng]) <= (routeCoords ? r : 25));
  const d = S.data;
  const places = d.places.filter(p => within(p.lat, p.lng, 10));
  const pack = {
    id: Date.now(), name, created: Date.now(), generated_at: d.generated_at, center: center || pts[0], route: routeCoords ? pts : null,
    reports: d.reports.filter(r => r.public !== false && within(r.lat, r.lng, 6)).map(r => ({ ...r, media: null })),
    places, zones: d.zones.filter(z => within(z.lat, z.lng, 15)), history: d.history.filter(h => within(h.lat, h.lng, 10)),
    types: d.types, settings: d.settings,
    contacts: [{ name: 'National emergency number', phone: '112' }].concat(S.circle.filter(c => c.phone).map(c => ({ name: c.name + ' (Safe Circle)', phone: c.phone })))
      .concat(places.filter(p => p.phone && ['police', 'frsc', 'nscdc', 'fire', 'ambulance', 'hospital', 'sema'].includes(p.category)).map(p => ({ name: p.name, phone: p.phone })))
  };
  try {
    localStorage.setItem('sr_pack_' + pack.id, JSON.stringify(pack));
    const idx = packIndex().filter(p => p.id !== pack.id); idx.unshift({ id: pack.id, name, created: pack.created, reports: pack.reports.length, places: places.length, route: !!routeCoords });
    store.set('packs', idx.slice(0, 8));
    if (idx.length > 8) idx.slice(8).forEach(p => { try { localStorage.removeItem('sr_pack_' + p.id); } catch (e) {} });
    toast(`Saved for offline: ${pack.reports.length} reports, ${places.length} places and emergency contacts. Map images you have viewed are kept too.`, 6000);
  } catch (e) { toast('Not enough storage on this device to save the pack'); }
  if (S.tab === 'map') renderPanel();
}
function loadPack(id) { try { return JSON.parse(localStorage.getItem('sr_pack_' + id)); } catch (e) { return null; } }
function mergePacks() {
  if (!S.stale) return;
  for (const meta of packIndex()) {
    const p = loadPack(meta.id); if (!p) continue;
    if (!Object.keys(S.data.types || {}).length) { S.data.types = p.types; S.data.settings = p.settings; }
    const have = new Set(S.data.reports.map(r => r.id)), haveP = new Set(S.data.places.map(x => x.id)), haveZ = new Set(S.data.zones.map(x => x.id));
    p.reports.forEach(r => { if (!have.has(r.id)) S.data.reports.push({ ...r, _pack: p.created }); });
    p.places.forEach(x => { if (!haveP.has(x.id)) S.data.places.push(x); });
    p.zones.forEach(x => { if (!haveZ.has(x.id)) S.data.zones.push(x); });
    if (!S.data.history || !S.data.history.length) S.data.history = p.history;
    if (!S.data.generated_at || p.generated_at > S.data.generated_at) S.data.generated_at = p.generated_at;
  }
}
function packsSection() {
  const idx = packIndex();
  return `<div class="sec"><h3>Offline safety packs</h3>
    <p class="small" style="margin-top:0">Saves reports, help places and emergency numbers for use without network. Expired reports are hidden automatically; each pack shows when its data was collected.</p>
    ${idx.map(p => `<div class="card row between"><div><b>${esc(p.name)}</b><div class="small">Data from ${fmtWhen(p.created)} · ${p.reports} reports · ${p.places} places${Date.now() - p.created > 24 * 36e5 ? ' · <span style="color:#fcd34d">over a day old — refresh when online</span>' : ''}</div></div>
      <div class="row"><button class="btn sm" data-packview="${p.id}">View</button><button class="btn sm" data-packdel="${p.id}">✕</button></div></div>`).join('')}
    <button class="btn block" id="packArea">⬇️ Save my area (25 km)</button>
    <button class="btn block" id="packContacts" style="margin-top:6px">📞 Emergency contacts (works offline)</button></div>`;
}
function contactsModal() {
  const all = [{ name: 'National emergency number', phone: '112' }];
  for (const m of packIndex()) { const p = loadPack(m.id); if (p) p.contacts.forEach(c => { if (!all.find(x => x.phone === c.phone)) all.push(c); }); }
  S.circle.forEach(c => { if (c.phone && !all.find(x => x.phone === c.phone)) all.push({ name: c.name + ' (Safe Circle)', phone: c.phone }); });
  modal(`<h2>Emergency contacts</h2><p class="small">These calls use your phone network and work without internet.</p>
    <ul class="jlist">${all.map(c => `<li class="row between"><span>${esc(c.name)}</span><a class="btn sm ${c.phone === '112' ? 'danger' : ''}" href="tel:${esc(c.phone)}">${esc(c.phone)}</a></li>`).join('')}</ul>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`);
}
// reports made without network wait in this phone's storage and are sent when the connection returns
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('saferoute', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function queueReport(fd) {
  const entries = []; for (const [k, v] of fd.entries()) entries.push([k, v]);
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').add({ entries, at: Date.now() }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
let flushing = false;
async function flushQueue() {
  if (flushing || !S.user || !navigator.onLine || !('indexedDB' in window)) return;
  flushing = true;
  try {
    const db = await idb();
    const items = await new Promise(res => { const out = []; const tx = db.transaction('queue', 'readonly'); tx.objectStore('queue').openCursor().onsuccess = e => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; });
    let sent = 0;
    for (const it of items) {
      const fd = new FormData();
      for (const [k, v] of it.entries) fd.append(k, k === 'occurred_mins_ago' ? String((+v || 0) + Math.round((Date.now() - it.at) / 60000)) : v);
      try { await api('/api/reports', { method: 'POST', form: fd, quiet: true }); sent++; }
      catch (e) { if (!e.status) break; toast('A saved report could not be sent: ' + e.message, 5000); }
      await new Promise(res => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').delete(it.id); tx.oncomplete = res; tx.onerror = res; });
    }
    if (sent) { toast(`Sent ${sent} report${sent === 1 ? '' : 's'} saved while you were offline`, 4500); load(); }
  } catch (e) {} finally { flushing = false; }
}

// ---------- journeys with check-in ----------
let lastPresence = 0;
function sendPresence() {
  if (S.mode !== 'gps' || !S.pos || !S.user || Date.now() - lastPresence < 5 * 60000) return;
  if (S.alertPrefs && (!S.alertPrefs.enabled || !S.alertPrefs.current)) return;
  lastPresence = Date.now();
  api('/api/presence', { method: 'POST', body: { lat: S.pos[0], lng: S.pos[1] }, quiet: true }).catch(() => {});
}
async function loadJourney() {
  if (!S.user) { S.journeyActive = null; return; }
  let j; try { j = await api('/api/journeys/active'); } catch (e) { return; }
  const prev = S.journeyActive;
  S.journeyActive = j;
  if (j && (j.checkin_due || j.reminder) && !(prev && (prev.checkin_due || prev.reminder))) {
    announce(j.reminder ? 'Have you arrived safely? Please check in, or add more time.' : 'Time to check in. Tap I am OK.', '#f59e0b', 'high', true);
  }
  if (j && j.off_route && !(prev && prev.off_route)) toast('You seem to be off your planned route. If this is a planned detour, tap “Planned detour”.', 7000);
  if (!j && prev && S.trip) { S.trip = null; gJourney.clearLayers(); }
  const sig = x => x ? [x.status, x.checkin_due, x.reminder, x.off_route, x.expected_arrival, x.events.length].join('|') : '';
  if (sig(prev) !== sig(j) && S.tab === 'map') renderPanel();
}
function journeyCard() {
  const j = S.journeyActive; if (!j) return '';
  const chip = j.status === 'escalated' ? ['Circle alerted — check in now', 'st-rej'] : j.reminder ? ['Arrival check-in due', 'st-inv'] : j.checkin_due ? ['Check-in due', 'st-inv'] : j.off_route ? ['Off planned route', 'st-inv'] : ['On the way', 'st-ver'];
  return `<div class="sec jcard ${j.status === 'escalated' || j.reminder || j.checkin_due ? 'jcard-alert' : ''}"><h3>Journey${j.dest_name ? ' to ' + esc(j.dest_name.split(',')[0]) : ''}</h3>
    <div class="row between"><span class="pill ${chip[1]}">${chip[0]}</span><span class="small">Expected ${clock(new Date(j.expected_arrival).getHours() + new Date(j.expected_arrival).getMinutes() / 60)}${j.checkin_every_min ? ' · check-in every ' + j.checkin_every_min + ' min' : ''}</span></div>
    <ul class="timeline">${j.events.slice(-3).map(e => `<li><span>${clock(new Date(e.at).getHours() + new Date(e.at).getMinutes() / 60)}</span>${esc(e.text)}</li>`).join('')}</ul>
    <div class="grid2" style="margin-top:8px"><button class="btn primary block" id="jcOk">✅ I'm OK</button><button class="btn block" id="jcArr">🏁 I've arrived</button></div>
    <div class="row wrap" style="margin-top:6px"><button class="btn sm" id="jcExt">⏱️ +30 min</button>${j.off_route ? '<button class="btn sm" id="jcDet">↪️ Planned detour</button>' : ''}<button class="btn sm" id="jcLink">🔗 Link</button><button class="btn sm" id="jcEnd">⏹ End</button></div></div>`;
}
function journeySettingsHint() {
  return `<div class="sec"><h3>Safe Journey Check-in</h3><p class="small" style="margin-top:0">Plan a trip in the Journey tab and press <b>Start journey</b>. Your circle is told you have set off, alerted if you leave the planned route, and alerted if you do not confirm arrival in time. Lost signal alone is never treated as an emergency.</p>
    <button class="btn block" id="cPlan">🗺️ Plan a journey</button></div>`;
}
function journeyModal(withRoute) {
  if (!S.user) return authModal('Sign in to start a journey with check-in.');
  const J = S.journey, r = withRoute && J.routes[J.sel];
  if (!J.to) return toast('Choose a destination first');
  const dep = J.depart == null ? hourNow() : J.depart;
  const durH = r ? r.duration / 3600 : 1;
  const etaH = (dep + durH + 0.25) % 24;
  const etaStr = String(Math.floor(etaH)).padStart(2, '0') + ':' + String(Math.round((etaH % 1) * 60 / 5) * 5 % 60).padStart(2, '0');
  const fleets = S.data.fleets || [];
  modal(`<h2>Start journey${J.to ? ' to ' + esc(J.to.name.split(',')[0]) : ''}</h2>
    ${S.circle.length ? `<p class="small">Your Safe Circle (${S.circle.length}) will follow this journey.</p>` : '<p class="small" style="color:#fcd34d">You have no Safe Circle contacts yet, so nobody can be alerted. Add them in the Circle tab.</p>'}
    <form id="jmF">
      <div class="grid2"><div><label class="f">Expected arrival</label><input type="time" name="eta" value="${etaStr}" required></div>
      <div><label class="f">Alert my circle if I have not checked in</label><select name="grace"><option value="15">15 min after</option><option value="30" selected>30 min after</option><option value="60">1 hour after</option><option value="120">2 hours after</option></select></div></div>
      <label class="f">Check in during the journey</label><select name="every"><option value="">No — only on arrival</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option><option value="120">Every 2 hours</option></select>
      <div class="toggle"><div>Tell my circle I have set off</div><label class="sw"><input type="checkbox" name="notify_circle" checked><span></span></label></div>
      <div class="toggle"><div>Tell them when I arrive</div><label class="sw"><input type="checkbox" name="notify_arrival" checked><span></span></label></div>
      ${fleets.length ? `<label class="f">Company trip (optional)</label><select name="fleet"><option value="">Personal trip</option>${fleets.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
        <select name="vehicle" style="margin-top:6px"><option value="">Vehicle…</option>${fleets.flatMap(f => f.vehicles.map(v => `<option value="${v.id}" data-fleet="${f.id}">${esc(f.name)}: ${esc(v.plate)}${v.label ? ' · ' + esc(v.label) : ''}</option>`)).join('')}</select>` : ''}
      <p class="small">If you have not confirmed arrival by the deadline, SafeRoute first reminds you. If there is still no reply after 20 minutes, your circle${fleets.length ? ' (and fleet managers for company trips)' : ''} is alerted that you missed a check-in — this is not treated as an SOS.</p>
      <div class="err" id="jmE"></div>
      <div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Start journey</button></div>
    </form>`);
  $('#jmF').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const [hh, mm] = String(f.get('eta')).split(':').map(Number);
    const eta = new Date(); eta.setHours(hh, mm, 0, 0); if (eta.getTime() < Date.now() - 5 * 60000) eta.setDate(eta.getDate() + 1);
    const body = { dest_name: J.to.name, dest_lat: J.to.p[0], dest_lng: J.to.p[1], origin_name: J.from ? J.from.name : '', route: r ? r.coords : null, expected_arrival: eta.getTime(),
      grace_min: +f.get('grace'), checkin_every_min: +f.get('every') || null, notify_circle: !!f.get('notify_circle'), notify_arrival: !!f.get('notify_arrival'),
      fleet_id: +f.get('fleet') || null, vehicle_id: +f.get('vehicle') || null, lat: S.pos ? S.pos[0] : (J.from ? J.from.p[0] : null), lng: S.pos ? S.pos[1] : (J.from ? J.from.p[1] : null) };
    try {
      const res = await api('/api/journeys', { method: 'POST', body });
      S.journeyActive = res.journey; closeModal();
      if (r) startTrip(); else { if (S.mode !== 'gps') startGps(true); setTab('map'); }
      toast(res.told && res.told.contacts ? `Journey started — ${res.told.contacts} circle contact${res.told.contacts === 1 ? '' : 's'} told` : 'Journey started', 4500);
      sendLocation(true);
    } catch (x) { $('#jmE').textContent = x.message; }
  };
}
async function journeyAction(path, body, msg) {
  const j = S.journeyActive; if (!j) return;
  try { await api(`/api/journeys/${j.id}/${path}`, { method: 'POST', body: body || {} }); toast(msg); await loadJourney(); if (path === 'arrived' || path === 'end') { S.trip = null; gJourney.clearLayers(); } renderPanel(); }
  catch (e) { toast(e.message); }
}

// ---------- safety briefing (written from the reports themselves; never invents threats) ----------
function briefingText(r) {
  const J = S.journey, a = r.a, dep = J.depart == null ? hourNow() : J.depart;
  const from = !J.from ? 'your start point' : J.from.mine ? 'your location' : J.from.name.split(',')[0], to = J.to.name.split(',')[0];
  const out = [`You are planning to travel from ${from} to ${to} ${J.depart == null ? 'now' : 'at ' + clock(dep)}, about ${fmtDur(r.duration)} (${fmtKm(r.distance / 1000)}).`];
  const inc = a.incidents, ver = inc.filter(x => x.report.status === 'verified').length, off = inc.filter(x => x.report.official).length;
  if (inc.length) out.push(`There ${inc.length === 1 ? 'is 1 recent reported security incident' : 'are ' + inc.length + ' recent reported security incidents'} along this route${ver ? ` — ${ver} verified${off ? `, ${off} confirmed by security personnel` : ''}` : ' — none verified yet'}.`);
  else out.push('No recent security incidents are reported along this route.');
  const worst = a.stretches.slice().sort((x, y) => y.level - x.level || y.lengthKm - x.lengthKm)[0];
  if (worst && worst.level >= 2) out.push(`The highest reported risk is ${LEVELS[worst.level].name.toLowerCase()}, on km ${Math.round(worst.startKm)}–${Math.round(worst.startKm + worst.lengthKm)}${placeNear(worst.worst.p) ? ' ' + placeNear(worst.worst.p) : ''}, which you would reach around ${clock(worst.atHour)} (${worst.confLabel.toLowerCase()}).`);
  if (a.hazards.length) out.push(`Road conditions: ${a.hazards.slice(0, 3).map(h => T(h.report.type).label.toLowerCase() + ' at km ' + Math.round(h.atKm)).join(', ')}${a.hazards.length > 3 ? ` and ${a.hazards.length - 3} more` : ''}.`);
  if (J.wx && /Heavy/.test(J.wx)) out.push('Heavy rain is forecast along the route.');
  if (timeLabel(dep) !== 'Day' || timeLabel(dep + r.duration / 3600) !== 'Day') out.push('Part of this journey is after dark.');
  const letter = x => String.fromCharCode(65 + J.routes.indexOf(x));
  const better = J.routes.filter(x => x !== r && x.a.burden < a.burden * 0.7).sort((x, y) => x.a.burden - y.a.burden)[0];
  if (better) out.push(`Route ${letter(better)} has relatively lower reported risk (${fmtDur(better.duration)}). Consider it, and check for updated advisories before departure.`);
  else if (a.worst >= 2) out.push('Consider an alternative route or a daylight departure, avoid unnecessary stops, and check for updated advisories before departure.');
  else out.push('Travel with normal care and check for updated advisories before departure.');
  out.push('This summary only repeats what has been reported in SafeRoute; it cannot know about threats nobody has reported.');
  return out.join(' ');
}
function briefingHTML(r) {
  return `<div class="sec"><h3>Safety briefing</h3><p class="brief">${esc(briefingText(r))}</p><button class="btn sm" id="jBrief">🔊 Read aloud</button></div>`;
}
function areaBriefing() {
  const a = currentAssessment(); if (!a) return 'Location is off.';
  return `${LEVELS[a.level].long} here, ${a.confLabel.toLowerCase()}. ${a.reasons.filter(x => x.kind !== 'info').slice(0, 3).map(x => x.text.replace(/ —.*$/, '')).join('. ')}. ${a.action}`;
}

// ---------- community alerts ----------
async function loadAlertPrefs() { if (!S.user) return; try { const d = await api('/api/alerts/prefs'); S.alertPrefs = d.prefs; S.alertAreas = d.areas; } catch (e) {} }
function alertsSection() {
  if (!S.alertPrefs) { loadAlertPrefs().then(() => { if (S.tab === 'alerts') renderPanel(); }); return ''; }
  const p = S.alertPrefs, cats = Object.values(S.data.types).filter(t => t.grp !== 'info' && t.key !== 'blackspot');
  const sel = k => !Array.isArray(p.categories) ? T(k).grp !== 'info' : p.categories.includes(k);
  return `<div class="sec"><h3>Community security alerts</h3>
    <p class="small" style="margin-top:0">Get a notification when an incident is reported near you or near places you care about. Single unconfirmed crime reports never trigger alerts.</p>
    <div class="toggle"><div>Alerts on</div>${sw('alOn', p.enabled)}</div>
    <div class="toggle"><div>Where I am<small>Uses your approximate location while SafeRoute is open (kept for 6 hours)</small></div>${sw('alCur', p.current)}</div>
    <div class="grid2"><div><label class="f">Radius around me</label><select id="alRad">${[2, 5, 10, 20, 50].map(r => `<option ${+p.radius_km === r ? 'selected' : ''} value="${r}">${r} km</option>`).join('')}</select></div>
      <div><label class="f">Which reports</label><select id="alVer"><option value="0" ${p.verified_only ? '' : 'selected'}>Verified + corroborated</option><option value="1" ${p.verified_only ? 'selected' : ''}>Verified only</option></select></div></div>
    <label class="f">Categories</label><div class="chkgrid">${cats.map(t => `<label><input type="checkbox" data-alcat="${t.key}" ${sel(t.key) ? 'checked' : ''}> ${t.icon} ${esc(t.label)}</label>`).join('')}</div>
    <label class="f">My places (home, work, family)</label>
    ${(S.alertAreas || []).map(a => `<div class="card row between"><span>📍 ${esc(a.name)} · ${a.radius_km} km</span><button class="btn sm" data-aldel="${a.id}">✕</button></div>`).join('') || '<div class="empty">None yet.</div>'}
    <div class="grid2"><button class="btn block" id="alAddHere">➕ Add my location</button><button class="btn block" id="alAddMap">🗺️ Add on map</button></div>
    <button class="btn primary block" id="alSave" style="margin-top:8px">Save alert settings</button></div>`;
}
function areaForm(p) {
  marker(p);
  modal(`<h2>Add a place for alerts</h2><form id="arF"><label class="f">Name</label><input type="text" name="name" maxlength="40" required placeholder="e.g. Home, Office, Mum's house">
    <label class="f">Radius</label><select name="radius_km"><option value="2">2 km</option><option value="5" selected>5 km</option><option value="10">10 km</option><option value="20">20 km</option></select>
    <div class="err" id="arE"></div><div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, clearMarker);
  $('#arF').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/alerts/areas', { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), lat: p[0], lng: p[1] } }); closeModal(); clearMarker(); await loadAlertPrefs(); setTab('alerts'); }
    catch (x) { $('#arE').textContent = x.message; }
  };
}

// ---------- fleet membership (drivers) ----------
function fleetMembership() {
  const fl = S.data.fleets || [];
  return `<div class="sec"><h3>Company fleet</h3>
    ${fl.map(f => `<div class="card row between"><div><b>${esc(f.name)}</b><div class="small">${f.role === 'manager' ? 'Manager · invite code <b style="color:var(--ink)">' + esc(f.invite_code) + '</b>' : 'Driver'}</div></div>${f.role === 'manager' ? `<button class="btn sm" data-openfleet="${f.id}">Dashboard</button>` : `<button class="btn sm" data-leavefleet="${f.id}">Leave</button>`}</div>`).join('')}
    <p class="small" style="margin-top:0">${fl.some(f => f.role === 'driver') ? 'Start company trips from the Journey tab: your managers see your location, route deviations, unscheduled stops and arrival.' : 'Drivers join with the invite code from their company. Transport and logistics companies can create a fleet.'}</p>
    <form id="fJoin" class="grid2"><input type="text" name="code" placeholder="Invite code" maxlength="12" required><button class="btn">Join fleet</button></form>
    <details style="margin-top:8px"><summary>Create a company fleet</summary><form id="fNew" class="grid2" style="margin-top:6px"><input type="text" name="name" placeholder="Company name" maxlength="80" required><button class="btn">Create</button></form></details></div>`;
}

// ---------- emergency facilities directory ----------
const HELP_FILTERS = [['all', 'All'], ['security', 'Security'], ['fire', 'Fire'], ['ambulance', 'Ambulance'], ['health', 'Hospitals'], ['sema', 'SEMA'], ['mech', 'Mechanics'], ['fuel', 'Fuel']];
const HELP_CATS = { security: SECURITY_CATS, fire: ['fire'], ambulance: ['ambulance'], health: ['hospital', 'clinic'], sema: ['sema'], mech: ['mechanic', 'vulcaniser'], fuel: ['fuel'] };
S.help = { q: '', f: 'all' };
function helpPanel() {
  const origin = S.pos || [map.getCenter().lat, map.getCenter().lng];
  const q = S.help.q.toLowerCase();
  const list = S.data.places.filter(p => (S.help.f === 'all' || (HELP_CATS[S.help.f] || []).includes(p.category)) && (!q || (p.name + ' ' + (p.address || '')).toLowerCase().includes(q)))
    .map(p => ({ p, d: km(origin, [p.lat, p.lng]) })).sort((a, b) => a.d - b.d).slice(0, 60);
  return `<div class="sec"><div class="emerg"><div><b>Emergency: 112</b><div class="small">Police, ambulance, fire, FRSC, NSCDC</div></div><a class="btn danger" href="tel:112">Call 112</a></div></div>
  <div class="sec"><h3>Emergency facilities ${S.pos ? 'near you' : 'near the map centre'}</h3>
    <input type="text" id="hq" placeholder="Search by name or address" value="${esc(S.help.q)}">
    <div class="chips" style="margin-top:8px">${HELP_FILTERS.map(([k, l]) => `<button type="button" data-hf="${k}" class="${S.help.f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${list.map(({ p, d }) => { const c = CAT[p.category] || CAT.police, sec = SECURITY_CATS.includes(p.category); return `<div class="card">
      <div class="row between"><div class="t">${c.icon} ${esc(p.name)}</div><span class="dist">${fmtKm(d)}</span></div>
      <div class="small">${c.label}${p.address ? ' · ' + esc(p.address) : ''}${p.hours ? ' · 🕑 ' + esc(p.hours) : ''}</div>
      <div class="small">${p.last_confirmed_at ? '✅ Verified ' + fmtDate(p.last_confirmed_at) : 'Not yet verified'}${sec ? (p.operational === 'closed' ? ' · ⛔ reported closed' : p.operational === 'confirmed' ? ' · operating' : '') : ''}</div>
      <div class="row wrap" style="margin-top:6px">${p.phone ? `<a class="btn sm primary" href="tel:${esc(p.phone)}">📞 ${esc(p.phone)}</a>` : ''}<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Directions</a>
        <button class="btn sm" data-zoom="${p.lat},${p.lng}">Map</button><button class="btn sm" data-psug="${p.id}">Suggest correction</button>
        ${isSecurity() || isMod() ? `<button class="btn sm" data-pver="${p.id}">✅ Verify</button>` : ''}${isMod() ? `<button class="btn sm" data-pedit="${p.id}">Edit</button>` : ''}</div></div>`; }).join('') || '<div class="empty">No matching places recorded yet.</div>'}
    <button class="btn block" id="hNew" style="margin-top:8px">➕ Suggest a missing place</button></div>`;
}
function placeEditForm(p, mode) { // mode: suggest | edit | new
  const c = p || {};
  modal(`<h2>${mode === 'edit' ? 'Edit listing' : mode === 'new' ? 'Suggest a new place' : 'Suggest a correction'}</h2>${p && mode !== 'new' ? `<p class="small">${esc(p.name)}</p>` : ''}
    <form id="peF">
      ${mode !== 'suggest' ? `<label class="f">Category</label><select name="category">${Object.entries(CAT).map(([k, x]) => `<option value="${k}" ${c.category === k ? 'selected' : ''}>${x.icon} ${x.label}</option>`).join('')}</select>
      <label class="f">Name</label><input type="text" name="name" maxlength="100" value="${esc(c.name || '')}" required>` : ''}
      <div class="grid2"><div><label class="f">Phone</label><input type="text" name="phone" maxlength="40" value="${esc(c.phone || '')}"></div><div><label class="f">Opening hours</label><input type="text" name="hours" maxlength="60" value="${esc(c.hours || '')}" placeholder="e.g. 24 hours"></div></div>
      <label class="f">Address / landmark</label><input type="text" name="address" maxlength="160" value="${esc(c.address || '')}">
      ${mode === 'suggest' ? '<div class="toggle"><div>This place is closed or no longer here</div><label class="sw"><input type="checkbox" name="closed"><span></span></label></div><label class="f">Anything else</label><input type="text" name="message" maxlength="300">' : ''}
      ${mode === 'edit' ? `<label class="f">Notes</label><input type="text" name="notes" maxlength="300" value="${esc(c.notes || '')}">` : ''}
      <div class="err" id="peE"></div>
      <div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${mode === 'edit' ? 'Save' : 'Send to moderators'}</button></div></form>`, clearMarker);
  $('#peF').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); if (f.closed) f.closed = true;
    try {
      if (mode === 'edit') await api('/api/places/' + p.id, { method: 'PUT', body: f });
      else await api('/api/places/suggest', { method: 'POST', body: mode === 'new' ? { ...f, lat: p.lat, lng: p.lng } : { ...f, place_id: p.id } });
      closeModal(); clearMarker(); toast(mode === 'edit' ? 'Saved' : 'Thanks — a moderator will review it'); load();
    } catch (x) { $('#peE').textContent = x.message; }
  };
}
async function loadSuggestions() { if (!isMod()) return; try { S.suggestions = await api('/api/places/suggestions'); if (S.tab === 'moderate') renderPanel(); } catch (e) {} }
function suggestionsHTML() {
  const s = S.suggestions || []; if (!s.length) return '';
  return `<div class="sec"><h3>Directory suggestions · ${s.length}</h3>${s.map(x => `<div class="card"><div class="t">${x.place_id ? '✏️ ' + esc(x.place_name || 'Listing') : '➕ New: ' + esc(x.data.name || '')}</div>
    <p>${Object.entries(x.data).filter(([k]) => !['lat', 'lng'].includes(k)).map(([k, v]) => `${esc(k)}: <b style="color:var(--ink)">${esc(v === true ? 'yes' : v)}</b>`).join(' · ')}</p><div class="small">From ${esc(x.by_name || 'user')} · ${ago(x.created_at)}</div>
    <div class="row" style="margin-top:6px"><button class="btn sm primary" data-sugg="approve" data-id="${x.id}">Approve</button><button class="btn sm" data-sugg="reject" data-id="${x.id}">Reject</button>${x.data.lat ? `<button class="btn sm" data-zoom="${x.data.lat},${x.data.lng}">View</button>` : ''}</div></div>`).join('')}</div>`;
}

// ---------- heatmap ----------
S.heat = null;
async function loadHeat() {
  gHeat.clearLayers();
  if (!S.heat) { $('#heatbar').style.display = 'none'; $('#btnHeat').classList.remove('on'); return; }
  $('#heatbar').style.display = 'block'; $('#btnHeat').classList.add('on');
  let d; try { d = await api(`/api/heatmap?cat=${S.heat.cat}&days=${S.heat.days}&tod=${S.heat.tod}`); } catch (e) { $('#heatInfo').textContent = e.message; return; }
  const col = f => f < .34 ? '#facc15' : f < .67 ? '#f97316' : '#dc2626';
  for (const c of d.cells) {
    const f = d.max ? c.n / d.max : 0;
    L.rectangle([[c.lat, c.lng], [c.lat + d.cell, c.lng + d.cell]], { color: col(f), weight: 0, fillOpacity: .25 + .45 * f })
      .bindTooltip(`${c.n} verified incident${c.n === 1 ? '' : 's'}`).addTo(gHeat);
  }
  $('#heatInfo').textContent = `${d.total} verified incidents · last ${d.days} days${d.tod !== 'all' ? ' · ' + d.tod + 'time' : ''} · ${d.detailed ? 'detailed staff view' : 'areas with fewer than ' + (S.data.settings.heatmap_min_count || 3) + ' incidents hidden'}`;
  if (!d.cells.length) $('#heatInfo').textContent += ' · nothing to show';
}

// ---------- staff: notes, delivery receipts, agency ----------
function deliveryText(d) {
  if (!d) return '';
  const part = (ch, label) => { const x = d[ch]; if (!x) return ''; const ok = (x.sent || 0) + (x.delivered || 0); return `${label}: ${ok} sent${x.delivered ? ', ' + x.delivered + ' delivered' : ''}${x.failed ? ', ' + x.failed + ' failed' : ''}${x.pending ? ', ' + x.pending + ' retrying' : ''}`; };
  const s = [part('push', 'App alerts'), part('sms', 'SMS'), part('voice', 'Calls')].filter(Boolean).join(' · ');
  return s ? `<div class="small delivery">📨 ${s}</div>` : '';
}
function notesBlock(type, id, notes) {
  return `<details class="notes"><summary>Internal notes (${(notes || []).length})</summary>
    ${(notes || []).map(n => `<div class="small"><b style="color:var(--ink)">${esc(n.name)}</b> · ${ago(n.at)}: ${esc(n.text)}</div>`).join('')}
    <form data-note="${type}:${id}" class="linkbox" style="margin-top:6px"><input type="text" name="text" maxlength="500" placeholder="Note for other responders" required><button class="btn sm">Add</button></form></details>`;
}
function staffNotes(type, id) {
  if (!(isSecurity() || isMod())) return '';
  return `<details class="notes" data-lazynotes="${type}:${id}"><summary>Internal notes</summary><div class="nl small">Loading…</div>
    <form data-note="${type}:${id}" class="linkbox" style="margin-top:6px"><input type="text" name="text" maxlength="500" placeholder="Note for other staff" required><button class="btn sm">Add</button></form></details>`;
}
async function loadOfficers() {
  if (!S.user || !(S.user.org_role === 'supervisor' && isSecurity())) return;
  try { S.officers = await api('/api/org/officers'); if (S.tab === 'security') renderPanel(); } catch (e) {}
}
function officersHTML() {
  if (!S.officers || !S.user.org) return S.user && S.user.org ? `<div class="sec small">Agency: <b style="color:var(--ink)">${esc(S.user.org.name)}</b>${S.user.org_role ? ' · ' + S.user.org_role : ''}</div>` : '';
  const pend = S.officers.filter(o => o.security_status === 'pending');
  return `<div class="sec"><h3>${esc(S.user.org.name)} · officers</h3>
    ${pend.map(o => `<div class="card"><div class="t">${esc(o.name)} <span class="pill st-inv">awaiting verification</span></div><p>${esc(o.email)}${o.phone ? ' · ' + esc(o.phone) : ''}</p>
      <div class="row"><button class="btn sm primary" data-off="verify" data-id="${o.id}">Verify</button><button class="btn sm" data-off="reject" data-id="${o.id}">Decline</button></div></div>`).join('')}
    <details><summary>All officers (${S.officers.length})</summary><table class="mini">${S.officers.filter(o => o.security_status !== 'pending').map(o => `<tr><td>${esc(o.name)}<br><span class="small">${esc(o.security_status || '')} · ${esc(o.org_role || 'officer')}</span></td>
      <td style="width:120px;text-align:right"><button class="btn sm" data-off="${o.org_role === 'supervisor' ? 'officer' : 'supervisor'}" data-id="${o.id}">${o.org_role === 'supervisor' ? 'Make officer' : 'Make supervisor'}</button></td></tr>`).join('')}</table></details></div>`;
}
async function loadAdminV3() {
  if (!isAdmin()) return;
  try { [S.orgsAll, S.audit] = await Promise.all([api('/api/orgs'), api('/api/admin/audit')]); if (S.tab === 'admin') renderPanel(); } catch (e) {}
}
function adminV3HTML() {
  const st = S.stats || {}, orgs = S.orgsAll || [];
  const staff = (S.users || []).filter(u => ['admin', 'moderator', 'security'].includes(u.role) || u.security_status === 'pending');
  return `<div class="sec"><h3>Health</h3><div class="factors">
      <div class="factor"><b style="color:${st.staff_without_mfa ? '#fcd34d' : 'inherit'}">${st.staff_without_mfa ?? '–'}</b><span>Staff without 2-step</span></div>
      <div class="factor"><b style="color:${st.failed_notifications_24h ? '#fca5a5' : 'inherit'}">${st.failed_notifications_24h ?? '–'}</b><span>Failed alerts 24 h</span></div>
      <div class="factor"><b>${st.active_journeys ?? '–'}</b><span>Live journeys</span></div><div class="factor"><b>${st.fleets ?? '–'}</b><span>Fleets</span></div></div>
    <p class="small">SMS ${st.sms_enabled ? 'on' : 'off'} · voice calls ${st.voice_enabled ? 'on' : 'off'}</p></div>
  <div class="sec"><h3>Agencies · ${orgs.length}</h3>
    ${orgs.map(o => `<div class="card row between"><div><b>${esc(o.name)}</b><div class="small">${esc(o.type)}${o.state ? ' · ' + esc(o.state) : ''}${o.radius_km ? ' · area ' + o.radius_km + ' km' : ''}${o.verified ? ' · ✅ listed' : ' · hidden'}</div></div>
      <div class="row"><button class="btn sm" data-orgv="${o.id}" data-val="${o.verified ? 0 : 1}">${o.verified ? 'Hide' : 'List'}</button></div></div>`).join('') || '<div class="empty">No agencies yet. Officers can choose their agency when they register.</div>'}
    <form id="orgF" style="margin-top:8px"><div class="grid2"><input type="text" name="name" placeholder="e.g. FRSC RS Sector Command" required maxlength="100"><select name="type">${['police', 'frsc', 'nscdc', 'military', 'sema', 'fire', 'ambulance', 'community', 'other'].map(t => `<option>${t}</option>`).join('')}</select></div>
      <div class="grid2" style="margin-top:6px"><input type="text" name="state" placeholder="State" maxlength="40"><input type="text" name="radius_km" placeholder="Area radius km (optional)" inputmode="numeric"></div>
      <div class="grid2" style="margin-top:6px"><input type="text" name="phone" placeholder="Control room phone" maxlength="40"><label class="small"><input type="checkbox" name="here"> Centre = map centre</label></div>
      <button class="btn block" style="margin-top:6px">Add agency</button><div class="err" id="orgE"></div></form></div>
  <div class="sec"><h3>Staff accounts</h3><table class="mini">${staff.map(u => `<tr><td><b>${esc(u.name)}</b><br><span class="small">${esc(u.role)}${u.security_status ? ' · ' + esc(u.security_status) : ''} · ${u.totp_enabled ? '🔐 2-step on' : '⚠️ no 2-step'}</span></td>
      <td style="width:150px"><select data-uorg="${u.id}" style="padding:3px 5px;font-size:12px"><option value="">No agency</option>${orgs.map(o => `<option value="${o.id}" ${u.org_id === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
      <select data-uorgrole="${u.id}" style="padding:3px 5px;font-size:12px;margin-top:3px"><option value="">—</option><option value="officer" ${u.org_role === 'officer' ? 'selected' : ''}>officer</option><option value="supervisor" ${u.org_role === 'supervisor' ? 'selected' : ''}>supervisor</option></select></td>
      <td style="width:70px;text-align:right">${u.totp_enabled ? `<button class="btn sm" data-mfareset="${u.id}" title="Use if they lost their phone">Reset 2-step</button>` : ''}</td></tr>`).join('')}</table></div>
  <div class="sec"><h3>Audit log</h3><p class="small" style="margin-top:0">Every official action: verifications, SOS handling, role changes, sign-ins by staff, settings.</p>
    <table class="mini">${(S.audit || []).slice(0, 80).map(a => `<tr><td><span class="small">${fmtWhen(a.at)}</span><br><b>${esc(a.action.replace(/_/g, ' '))}</b> ${a.target_type ? `<span class="small">${esc(a.target_type)} #${a.target_id ?? ''}</span>` : ''}</td><td class="small" style="width:120px">${esc(a.name || '—')}<br>${esc(a.ip || '')}</td></tr>`).join('')}</table></div>`;
}

// ---------- fleet dashboard ----------
async function loadFleet() {
  const mine = (S.data.fleets || []).filter(f => f.role === 'manager');
  if (!mine.length) return;
  if (!S.fleetSel || !mine.find(f => f.id === S.fleetSel)) S.fleetSel = mine[0].id;
  try { S.fleet = await api('/api/fleets/' + S.fleetSel); } catch (e) { return toast(e.message); }
  drawFleet(); renderTabs();
  const typing = document.activeElement && $('#panel').contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (S.tab === 'fleet' && !typing) renderPanel();
}
function tripState(t, f) {
  const quiet = t.last_seen_at ? (Date.now() - t.last_seen_at) / 60000 : 999;
  if (t.status === 'escalated') return ['Missed check-in', '#dc2626'];
  if (t.status === 'overdue') return ['Overdue', '#f97316'];
  if (quiet > f.offline_min) return [`No signal ${Math.round(quiet)} min`, '#64748b'];
  if (t.off_route) return ['Off route', '#f97316'];
  if (t.stopped_min >= f.stop_min) return [`Stopped ${t.stopped_min} min`, '#f59e0b'];
  return [t.speed > 1 ? `Moving ${Math.round(t.speed * 3.6)} km/h` : 'On trip', '#22c55e'];
}
function drawFleet() {
  gFleet.clearLayers();
  if (S.tab !== 'fleet' || !S.fleet) return;
  const f = S.fleet.fleet;
  for (const t of S.fleet.trips) {
    if (t.route) L.polyline(t.route, { color: '#60a5fa', weight: 3, opacity: .5, dashArray: '6 6', interactive: false }).addTo(gFleet);
    if (!t.last) continue;
    const [label, col] = tripState(t, f);
    const lbl = t.plate || first3(t.driver), w = Math.max(30, lbl.length * 8 + 14);
    L.marker(t.last, { zIndexOffset: 800, icon: L.divIcon({ className: '', html: `<div class="mk sq" style="width:${w}px;height:24px;background:${col};font-size:11px;font-weight:800;white-space:nowrap">${esc(lbl)}</div>`, iconSize: [w, 24], iconAnchor: [w / 2, 12] }) })
      .bindPopup(`<b>${esc(t.driver)}${t.plate ? ' · ' + esc(t.plate) : ''}</b><br>${esc(label)}<br><span class="small">To ${esc(t.dest_name || '—')} · updated ${ago(t.last_seen_at)}</span>`).addTo(gFleet);
  }
}
const first3 = n => String(n || '?').slice(0, 3).toUpperCase();
function fleetPanel() {
  if (!S.fleet) { loadFleet(); return '<div class="sec">Loading fleet…</div>'; }
  const d = S.fleet, f = d.fleet, mine = (S.data.fleets || []).filter(x => x.role === 'manager');
  const important = a => ['sos', 'missed_checkin', 'unscheduled_stop', 'deviation', 'no_signal'].includes(a.kind);
  const routeRisk = t => { if (!t.route || t.route.length < 2) return ''; const a = R.assessRoute(t.route, hourNow(), 0, S.data, {}); return `<span style="color:${LEVELS[a.worst].hex}">● Route ${LEVELS[a.worst].name}</span>`; };
  return `<div class="sec"><h3>Fleet</h3>
    ${mine.length > 1 ? `<select id="fSel">${mine.map(x => `<option value="${x.id}" ${x.id === S.fleetSel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<b>${esc(f.name)}</b>`}
    <div class="factors" style="margin-top:8px"><div class="factor"><b>${d.trips.length}</b><span>On trip</span></div><div class="factor"><b>${d.vehicles.length}</b><span>Vehicles</span></div>
      <div class="factor"><b>${d.members.filter(m => m.role === 'driver').length}</b><span>Drivers</span></div><div class="factor"><b style="color:${d.alerts.filter(a => !a.ack_at && important(a)).length ? '#fca5a5' : 'inherit'}">${d.alerts.filter(a => !a.ack_at && important(a)).length}</b><span>Open alerts</span></div></div>
    <p class="small">Driver invite code: <b style="color:var(--ink);letter-spacing:.08em">${esc(f.invite_code)}</b> <button class="linkish" id="fInv">New code</button></p></div>
  ${d.sos.length ? `<div class="sec card-alert"><h3>Driver SOS</h3>${d.sos.map(s => `<div class="small">🆘 ${esc(s.ref)} · ${esc(s.status)} · ${ago(s.created_at)}</div>`).join('')}</div>` : ''}
  <div class="sec"><h3>Active trips</h3>${d.trips.map(t => { const [label, col] = tripState(t, f); return `<div class="card">
      <div class="row between"><div class="t">${esc(t.driver)}${t.plate ? ' · ' + esc(t.plate) : ''}</div><span class="pill" style="color:${col};border-color:${col}">${esc(label)}</span></div>
      <div class="small">To ${esc((t.dest_name || '—').split(',')[0])} · ETA ${t.expected_arrival ? clock(new Date(t.expected_arrival).getHours() + new Date(t.expected_arrival).getMinutes() / 60) : '—'} · updated ${t.last_seen_at ? ago(t.last_seen_at) : 'never'} ${routeRisk(t)}</div>
      <div class="row wrap" style="margin-top:6px">${t.last ? `<button class="btn sm" data-zoom="${t.last}">Map</button>` : ''}${t.driver_phone ? `<a class="btn sm" href="tel:${esc(t.driver_phone)}">Call driver</a>` : ''}${t.url ? `<a class="btn sm" href="${esc(t.url)}" target="_blank" rel="noopener">Live link</a>` : ''}</div></div>`; }).join('') || '<div class="empty">No vehicles on a trip right now. Drivers start company trips from the Journey tab.</div>'}</div>
  <div class="sec"><h3>Alerts</h3>${d.alerts.slice(0, 40).map(a => `<div class="falert ${important(a) && !a.ack_at ? 'imp' : ''}"><span class="small">${fmtWhen(a.at)}</span><div>${esc(a.text)}</div>
      ${important(a) ? (a.ack_at ? `<span class="small">✓ ${esc(a.ack_name || '')}</span>` : `<button class="btn sm" data-fack="${a.id}">Acknowledge</button>`) : ''}${a.lat != null ? ` <button class="btn sm" data-zoom="${a.lat},${a.lng}">Map</button>` : ''}</div>`).join('') || '<div class="empty">No alerts.</div>'}</div>
  <div class="sec"><h3>Vehicles</h3><table class="mini">${d.vehicles.map(v => `<tr><td><b>${esc(v.plate)}</b>${v.label ? '<br><span class="small">' + esc(v.label) + '</span>' : ''}</td>
      <td style="width:150px"><select data-vdrv="${v.id}" style="padding:3px 5px;font-size:12px"><option value="">No driver</option>${d.members.map(m => `<option value="${m.user_id}" ${v.driver_id === m.user_id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></td>
      <td style="width:40px;text-align:right"><button class="btn sm" data-vdel="${v.id}">✕</button></td></tr>`).join('')}</table>
    <form id="vF" class="grid2" style="margin-top:8px"><input type="text" name="plate" placeholder="Plate number" maxlength="20" required><input type="text" name="label" placeholder="e.g. Toyota Hiace, bus 3" maxlength="60"><button class="btn" style="grid-column:span 2">Add vehicle</button></form></div>
  <div class="sec"><h3>People</h3><table class="mini">${d.members.map(m => `<tr><td><b>${esc(m.name)}</b><br><span class="small">${esc(m.phone || m.email || '')}</span></td>
      <td style="width:110px">${m.user_id === f.owner_id ? '<span class="small">owner</span>' : `<select data-mrole="${m.user_id}" style="padding:3px 5px;font-size:12px"><option ${m.role === 'driver' ? 'selected' : ''} value="driver">driver</option><option ${m.role === 'manager' ? 'selected' : ''} value="manager">manager</option></select>`}</td>
      <td style="width:40px;text-align:right">${m.user_id === f.owner_id ? '' : `<button class="btn sm" data-mdel="${m.user_id}">✕</button>`}</td></tr>`).join('')}</table></div>
  <div class="sec"><h3>Alert rules</h3><form id="fsF"><table class="mini"><tr><td>Off-route distance (km)</td><td style="width:80px"><input name="deviation_km" value="${f.deviation_km}"></td></tr>
    <tr><td>Unscheduled stop after (min)</td><td><input name="stop_min" value="${f.stop_min}"></td></tr><tr><td>No signal after (min)</td><td><input name="offline_min" value="${f.offline_min}"></td></tr></table><button class="btn block" style="margin-top:6px">Save rules</button></form></div>
  <div class="sec"><h3>Recent trips</h3><ul class="jlist">${d.recent.map(t => `<li>${esc(t.driver)}${t.plate ? ' · ' + esc(t.plate) : ''} → ${esc((t.dest_name || '—').split(',')[0])}<div class="small">${fmtWhen(t.started_at)} · ${t.status === 'arrived' ? '🏁 arrived ' + (t.ended_at ? ago(t.ended_at) : '') + (t.ended_at && t.expected_arrival && t.ended_at > t.expected_arrival ? ' (late)' : '') : 'ended'}</div></li>`).join('') || '<div class="empty">None yet.</div>'}</ul></div>`;
}

// ---------- bindings for all v3 panels ----------
function bindV3(P) {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  const act = (sel, fn, ev) => P.querySelectorAll(sel).forEach(el => el.addEventListener(ev || (el.tagName === 'SELECT' ? 'change' : el.tagName === 'FORM' ? 'submit' : 'click'), async e => { if (el.tagName === 'FORM') e.preventDefault(); try { await fn(el, e); } catch (x) { toast(x.message); } }));
  on('bBrief', 'click', () => { audio(); speak(areaBriefing()); });
  on('jBrief', 'click', () => { audio(); speak($('.brief').textContent); });
  on('jcOk', 'click', () => journeyAction('checkin', {}, 'Checked in — thank you'));
  on('jcArr', 'click', () => journeyAction('arrived', {}, 'Arrived — your circle has been told'));
  on('jcExt', 'click', () => journeyAction('extend', { minutes: 30, tell: true }, 'Expected arrival moved 30 minutes later'));
  on('jcDet', 'click', () => journeyAction('detour', {}, 'Planned detour noted for the next hour'));
  on('jcEnd', 'click', () => journeyAction('end', {}, 'Journey ended'));
  on('jcLink', 'click', () => shareLinks(S.journeyActive.url, 'Follow my journey on SafeRoute:'));
  on('jNoRoute', 'click', () => journeyModal(false));
  on('jOffline', 'click', () => { const r = S.journey.routes[S.journey.sel]; savePack('Route to ' + S.journey.to.name.split(',')[0], null, r.coords); });
  on('packArea', 'click', () => savePack('Area ' + (placeNear(S.pos || [map.getCenter().lat, map.getCenter().lng]) || 'saved').replace(/^near /, ''), S.pos || [map.getCenter().lat, map.getCenter().lng], null));
  on('packContacts', 'click', contactsModal);
  act('[data-packdel]', el => { try { localStorage.removeItem('sr_pack_' + el.dataset.packdel); } catch (e) {} store.set('packs', packIndex().filter(p => p.id != el.dataset.packdel)); renderPanel(); });
  act('[data-packview]', el => { const p = loadPack(el.dataset.packview); if (!p) return; S.follow = false; if (p.route) map.fitBounds(L.latLngBounds(p.route).pad(.1)); else map.setView(p.center, 11); });
  on('cPlan', 'click', () => setTab('journey'));
  // alerts
  on('alSave', 'click', async () => {
    const cats = $$('[data-alcat]').filter(c => c.checked).map(c => c.dataset.alcat);
    const body = { enabled: $('#alOn').checked, current: $('#alCur').checked, radius_km: +$('#alRad').value, verified_only: $('#alVer').value === '1', categories: cats };
    const d = await api('/api/alerts/prefs', { method: 'PUT', body }); S.alertPrefs = d.prefs; toast('Alert settings saved');
    if (body.enabled && !S.pushOn) toast('Saved. Turn on notifications below so alerts reach you when the app is closed.', 5000);
  });
  on('alAddHere', 'click', () => { if (!S.pos) return toast('Turn on location first, or add on the map'); areaForm(S.pos.slice()); });
  on('alAddMap', 'click', () => startPick('area', 'Tap the place to watch'));
  act('[data-aldel]', async el => { await api('/api/alerts/areas/' + el.dataset.aldel, { method: 'DELETE' }); await loadAlertPrefs(); renderPanel(); });
  // fleet membership
  on('fJoin', 'submit', async e => { e.preventDefault(); try { const r = await api('/api/fleets/join', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Joined ' + r.name); load(); } catch (x) { toast(x.message); } });
  on('fNew', 'submit', async e => { e.preventDefault(); try { await api('/api/fleets', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Fleet created — share the invite code with your drivers'); await load(); setTab('fleet'); } catch (x) { toast(x.message); } });
  act('[data-openfleet]', el => { S.fleetSel = +el.dataset.openfleet; S.fleet = null; setTab('fleet'); });
  act('[data-leavefleet]', async el => { await api(`/api/fleets/${el.dataset.leavefleet}/leave`, { method: 'POST' }); load(); });
  // directory
  const hq = $('#hq'); if (hq) hq.addEventListener('input', () => { S.help.q = hq.value; clearTimeout(hq._t); hq._t = setTimeout(() => { renderPanel(); const n = $('#hq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300); });
  act('[data-hf]', el => { S.help.f = el.dataset.hf; renderPanel(); });
  act('[data-psug]', el => placeEditForm(S.data.places.find(p => p.id == el.dataset.psug), 'suggest'));
  act('[data-pedit]', el => placeEditForm(S.data.places.find(p => p.id == el.dataset.pedit), 'edit'));
  act('[data-pver]', async el => { await api(`/api/places/${el.dataset.pver}/verify`, { method: 'POST' }); toast('Listing verified today'); load(); });
  on('hNew', 'click', () => { if (!S.user) return authModal('Sign in to suggest places'); startPick('suggest', 'Tap where the place is'); });
  act('[data-sugg]', async el => { await api(`/api/places/suggestions/${el.dataset.id}`, { method: 'POST', body: { action: el.dataset.sugg } }); toast(el.dataset.sugg === 'approve' ? 'Directory updated' : 'Rejected'); loadSuggestions(); load(); });
  // staff
  act('[data-mediapub]', async el => { await api(`/api/reports/${el.dataset.id}/media`, { method: 'POST', body: { public: el.dataset.mediapub === '1' } }); toast(el.dataset.mediapub === '1' ? 'Photo is now public' : 'Photo hidden from public'); load(); });
  act('[data-note]', async (el) => { const [type, id] = el.dataset.note.split(':'); await api(`/api/notes/${type}/${id}`, { method: 'POST', body: { text: new FormData(el).get('text') } }); el.reset(); toast('Note added'); if (type === 'sos') loadSos(); else loadNotes(el.closest('details')); });
  P.querySelectorAll('[data-lazynotes]').forEach(d => d.addEventListener('toggle', () => { if (d.open) loadNotes(d); }));
  act('[data-assignme]', async el => { await api(`/api/sos/${el.dataset.assignme}/assign`, { method: 'POST', body: { user_id: S.user.id, org_id: S.user.org && S.user.org.id } }); toast('Assigned to you'); loadSos(); });
  act('[data-off]', async el => { await api(`/api/org/officers/${el.dataset.id}`, { method: 'POST', body: { action: el.dataset.off } }); toast('Updated'); loadOfficers(); });
  // admin
  on('orgF', 'submit', async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.here) { const c = map.getCenter(); f.lat = c.lat; f.lng = c.lng; }
    try { await api('/api/orgs', { method: 'POST', body: f }); toast('Agency added'); loadAdminV3(); } catch (x) { $('#orgE').textContent = x.message; }
  });
  act('[data-orgv]', async el => { await api('/api/orgs/' + el.dataset.orgv, { method: 'PUT', body: { verified: el.dataset.val === '1' } }); loadAdminV3(); });
  act('[data-uorg]', async el => { await api('/api/admin/users/' + el.dataset.uorg, { method: 'POST', body: { org_id: el.value } }); toast('Agency updated'); loadAdmin(); });
  act('[data-uorgrole]', async el => { await api('/api/admin/users/' + el.dataset.uorgrole, { method: 'POST', body: { org_role: el.value } }); toast('Updated'); loadAdmin(); });
  act('[data-mfareset]', async el => { await api('/api/admin/users/' + el.dataset.mfareset, { method: 'POST', body: { reset_mfa: true } }); toast('Two-step reset — they must set it up again at next sign-in'); loadAdmin(); });
  // fleet dashboard
  on('fSel', 'change', e => { S.fleetSel = +e.target.value; S.fleet = null; loadFleet(); });
  on('fInv', 'click', async () => { await api(`/api/fleets/${S.fleetSel}/invite`, { method: 'POST' }); loadFleet(); load(); });
  act('[data-fack]', async el => { await api(`/api/fleets/${S.fleetSel}/alerts/${el.dataset.fack}/ack`, { method: 'POST' }); loadFleet(); });
  on('vF', 'submit', async e => { e.preventDefault(); try { await api(`/api/fleets/${S.fleetSel}/vehicles`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); loadFleet(); load(); } catch (x) { toast(x.message); } });
  act('[data-vdrv]', async el => { await api(`/api/fleets/${S.fleetSel}/vehicles/${el.dataset.vdrv}`, { method: 'PUT', body: { driver_id: el.value } }); loadFleet(); });
  act('[data-vdel]', async el => { await api(`/api/fleets/${S.fleetSel}/vehicles/${el.dataset.vdel}`, { method: 'DELETE' }); loadFleet(); load(); });
  act('[data-mrole]', async el => { await api(`/api/fleets/${S.fleetSel}/members/${el.dataset.mrole}`, { method: 'POST', body: { action: el.value } }); loadFleet(); });
  act('[data-mdel]', async el => { await api(`/api/fleets/${S.fleetSel}/members/${el.dataset.mdel}`, { method: 'POST', body: { action: 'remove' } }); loadFleet(); });
  on('fsF', 'submit', async e => { e.preventDefault(); await api(`/api/fleets/${S.fleetSel}`, { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }).catch(x => toast(x.message)); toast('Rules saved'); loadFleet(); });
}
async function loadNotes(d) {
  if (!d) return;
  const [type, id] = (d.dataset.lazynotes || d.querySelector('[data-note]').dataset.note).split(':');
  try { const n = await api(`/api/notes/${type}/${id}`); const box = d.querySelector('.nl'); if (box) box.innerHTML = n.map(x => `<div><b style="color:var(--ink)">${esc(x.name)}</b> · ${ago(x.at)}: ${esc(x.text)}</div>`).join('') || 'No notes yet.'; } catch (e) {}
}
$('#btnBell').onclick = openInbox;
$('#btnHeat').onclick = () => { S.heat = S.heat ? null : { cat: 'security', days: 90, tod: 'all' }; if (S.heat) { $('#hCat').value = 'security'; $('#hDays').value = '90'; $('#hTod').value = 'all'; } loadHeat(); };
['hCat', 'hDays', 'hTod'].forEach(id => $('#' + id).addEventListener('change', () => { S.heat = { cat: $('#hCat').value, days: +$('#hDays').value, tod: $('#hTod').value }; loadHeat(); }));
$('#hClose').onclick = () => { S.heat = null; loadHeat(); };
setInterval(() => { if (!document.hidden && S.journeyActive) loadJourney(); }, 30000);
setInterval(() => { if (!document.hidden && S.tab === 'fleet') loadFleet(); }, 20000);
setInterval(() => { if (S.user && navigator.onLine) flushQueue(); }, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'push') { setUnread((S.unread || 0) + 1); if (e.data.url && /journey|tab=security|tab=fleet/.test(e.data.url)) { loadJourney(); if (isSecurity()) loadSos(); } } });

// =====================================================================
// v4: sections — Alerts, Emergency SOS, Community Watch, My Account; safeguarded SOS; LGA / state
// =====================================================================
S.inbox = null;
async function loadInbox() {
  if (!S.user) return;
  try { const d = await api('/api/inbox'); S.inbox = d.items; if (S.tab === 'alerts') renderPanel(); if (S.unread) api('/api/inbox/read', { method: 'POST' }).then(() => { setUnread(0); renderTabs(); }).catch(() => {}); } catch (e) {}
}
function originPoint() { return S.pos || [map.getCenter().lat, map.getCenter().lng]; }
function nearbyReports(radius, filter) {
  const o = originPoint();
  return S.data.reports.filter(r => active(r) && r.status !== 'rejected' && (!filter || filter(r)))
    .map(r => ({ r, d: km(o, [r.lat, r.lng]) })).filter(x => x.d <= radius).sort((a, b) => a.d - b.d);
}
function warnRow({ r, d }, extra) {
  const t = T(r.type);
  return `<div class="card"><div class="row between"><div class="t">${t.icon} ${esc(t.label)} ${statusPill(r)}</div><span class="dist">${fmtKm(d)}</span></div>
    <div class="small">${esc(r.confLabel || '')} · ${ago(r.occurred_at || r.created_at)}${r.responding_by ? ' · 🚔 security responding' : ''}${r.public === false ? ' · not public yet' : ''}</div>
    ${r.note ? `<div class="small" style="color:var(--ink)">${esc(r.note)}</div>` : ''}
    <div class="row wrap" style="margin-top:6px"><button class="btn sm" data-zoom="${r.lat},${r.lng}">Show on map</button>${extra || ''}</div></div>`;
}
function alertsPanel() {
  const radius = S.alertPrefs ? +S.alertPrefs.radius_km || 10 : 20;
  const near = nearbyReports(Math.max(radius, 10), r => r.public !== false || r.mine).slice(0, 12);
  return `<div class="sec"><h3>Warnings ${S.pos ? 'near you' : 'near the map centre'} · ${near.length}</h3>
    <p class="small" style="margin-top:0">Active reports within ${Math.max(radius, 10)} km. The label shows how far each one has been checked.</p>
    ${near.map(x => warnRow(x)).join('') || '<div class="empty">No active warnings nearby.</div>'}</div>
  <div class="sec"><h3>Your alerts</h3>
    ${!S.user ? '<p class="small">Sign in to receive community alerts, check-in reminders and SOS updates.</p><button class="btn primary block" id="aSign">Sign in or create account</button>'
      : S.inbox == null ? '<div class="empty">Loading…</div>' : S.inbox.length ? `<ul class="jlist">${S.inbox.slice(0, 40).map((x, i) => `<li class="${x.read_at ? '' : 'unread'}"><button class="linkish" data-inb="${i}" style="text-align:left">${esc(x.title)}</button><div class="small">${esc(x.body)}</div><div class="small">${ago(x.created_at)}</div></li>`).join('')}</ul>`
      : '<div class="empty">No alerts yet. Community alerts, check-in reminders and SOS updates appear here.</div>'}</div>
  ${S.user ? alertsSection() : ''}
  ${S.user ? `<div class="sec"><h3>Notifications on this device</h3><p class="small" style="margin-top:0">So alerts reach you when SafeRoute is closed.</p>
    <button class="btn block" id="cPush">${S.pushOn ? '✅ Notifications on — send a test' : '🔔 Turn on notifications'}</button></div>` : ''}`;
}
function readiness() {
  const u = S.user;
  const items = [
    [!!u, 'Signed in', 'so responders know who needs help'],
    [S.circle.length >= 2, `Safe Circle: ${S.circle.length} ${S.circle.length === 1 ? 'person' : 'people'}`, 'add at least two', 'circle'],
    [!!(u && u.has_pin), 'Cancel PIN set', 'otherwise your password is needed to cancel', 'circle'],
    [S.pushOn, 'Notifications on', 'to receive SOS updates', 'alerts'],
    [S.mode === 'gps' || S.mode === 'test', 'Location on', 'turned on automatically when you send an SOS']
  ];
  return items.map(([ok, l, hint, go]) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✅' : '⚪'}</span><div>${esc(l)}${ok ? '' : `<small>${esc(hint)}</small>`}</div>${!ok && go ? `<button class="btn sm" data-goto="${go}">Fix</button>` : ''}</li>`).join('');
}
function sosPanel() {
  const s = S.sos, o = originPoint();
  const post = nearest(o, S.data.places, SECURITY_CATS, p => p.operational !== 'closed');
  const hosp = nearest(o, S.data.places, ['hospital', 'clinic', 'ambulance'], p => p.operational !== 'closed');
  const svc = (n, l) => n ? `<li><span class="ico" style="background:${CAT[n.place.category].bg};border-color:${CAT[n.place.category].bg}">${CAT[n.place.category].icon}</span><div class="meta"><div>${esc(n.place.name)}</div><small>${l} · ${fmtKm(n.d)}</small></div>${n.place.phone ? `<a class="btn sm primary" href="tel:${esc(n.place.phone)}">Call</a>` : ''}</li>` : '';
  return `${s ? `<div class="sec"><div class="sosactive"><b>SOS ACTIVE · ${esc(s.ref)}</b><div class="small">${esc({ open: 'Alert sent — waiting for a responder', acknowledged: 'Acknowledged by a responder', responding: 'A responder is on the way', on_scene: 'Responder on the scene' }[s.status] || s.status)}</div>
      <button class="btn block" id="sosOpen" style="margin-top:8px">Open SOS status</button></div></div>`
    : `<div class="sec"><button class="sosbig" id="sosBig"><b>SOS</b><span>Emergency — press to start</span></button>
      <p class="small" style="text-align:center;margin:8px 0 0">The red SOS button stays on screen in every section.</p></div>`}
  <div class="sec"><div class="emerg"><div><b>Emergency: 112</b><div class="small">Police, ambulance, fire, FRSC, NSCDC</div></div><a class="btn danger" href="tel:112">Call 112</a></div>
    <ul class="help" style="margin-top:8px">${svc(post, 'Nearest security post')}${svc(hosp, 'Nearest hospital / ambulance')}</ul></div>
  <div class="sec"><h3>Ready for an emergency?</h3><ul class="ready">${readiness()}</ul></div>
  <div class="sec"><h3>Protection against accidental alerts</h3>
    <ol class="small steps"><li>Choose what is happening, then <b>press and hold</b> the button for 2 seconds.</li><li>A <b>5-second countdown</b> starts. Press <b>Cancel</b> if it was a mistake — nothing is sent.</li>
    <li>After it is sent, cancelling needs your <b>cancel PIN</b> (or password). A <b>duress PIN</b> makes it look cancelled while it stays active.</li><li>Your Safe Circle and verified responders get your location and a reference number. Location updates every 15 seconds until you cancel.</li></ol>
    <p class="small">SafeRoute does not by itself guarantee that emergency personnel have received or accepted an alert. If you can, also call 112.</p></div>`;
}
function sosCountdown() {
  const typeBtn = $('#sosType .on'); const type = typeBtn ? typeBtn.dataset.t : 'other';
  const label = (SOS_TYPES.find(x => x[0] === type) || SOS_TYPES[5])[1];
  let n = 5, timer = null;
  modal(`<div class="countdown"><h2 style="color:#f87171">Sending SOS in</h2><div class="cnum" id="cdNum">5</div><p>${esc(label)} · to your Safe Circle and responders nearby</p>
    <button class="btn block cdcancel" id="cdCancel">✕ Cancel — I'm safe</button><button class="btn danger block" id="cdNow" style="margin-top:8px">Send now</button></div>`, () => clearInterval(timer));
  if (navigator.vibrate) try { navigator.vibrate(200); } catch (e) {}
  try { tone(880, 0, .15, 'square', .15); } catch (e) {}
  const go = () => { clearInterval(timer); timer = null; onModalClose = null; sendSos(type); };
  timer = setInterval(() => { n--; const el = $('#cdNum'); if (!el) return clearInterval(timer); el.textContent = n; try { tone(880, 0, .12, 'square', .12); } catch (e) {} if (navigator.vibrate) try { navigator.vibrate(120); } catch (e) {} if (n <= 0) go(); }, 1000);
  $('#cdCancel').onclick = () => { clearInterval(timer); closeModal(); toast('SOS cancelled — nothing was sent'); };
  $('#cdNow').onclick = go;
}
function watchPanel() {
  const verify = nearbyReports(25, r => ['unverified', 'investigating'].includes(r.status) && !r.mine).slice(0, 10);
  return `<div class="sec"><p class="small" style="margin-top:0">See something on the road or in your area? Report it. Moderators and security partners check reports before they count as confirmed.</p>
    <button class="btn primary block" id="bReport" style="padding:12px">📣 Report an incident or hazard</button></div>
  <div class="sec"><h3>Help verify reports near you · ${verify.length}</h3>
    <p class="small" style="margin-top:0">Only answer if you know. Confirmations from people close by count the most; false confirmations lower your trust score.</p>
    ${verify.map(x => warnRow(x, `<button class="btn sm" data-wconf="confirm" data-id="${x.r.id}">✔ I can confirm</button><button class="btn sm" data-wconf="ongoing" data-id="${x.r.id}">⏳ Still happening</button><button class="btn sm" data-wconf="resolved" data-id="${x.r.id}">✅ Resolved</button><button class="btn sm" data-wconf="inaccurate" data-id="${x.r.id}">❓ Inaccurate</button>`)).join('') || '<div class="empty">Nothing waiting for confirmation near you.</div>'}</div>
  <div class="sec"><h3>My reports</h3>
    ${!S.user ? '<div class="empty">Sign in to see your reports.</div>' : S.myReports.length ? `<ul class="jlist">${S.myReports.map(r => `<li>${T(r.type).icon} ${esc(T(r.type).label)} ${statusPill(r)}<div class="small">${ago(r.created_at)}${r.resolved_reason ? ' · ' + esc(r.resolved_reason) : ''}</div></li>`).join('')}</ul>` : '<div class="empty">You have not sent any reports yet.</div>'}
    ${S.user ? `<p class="small">Your contributor trust: <b style="color:var(--ink)">${Math.round((S.user.trust || 0.5) * 100)}%</b>${S.user.trusted ? ' · ⭐ trusted contributor' : ''}</p>` : ''}</div>
  <div class="sec"><h3>What the labels mean</h3><ul class="small steps">${['unverified', 'investigating', 'verified', 'resolved'].map(k => `<li><b style="color:var(--ink)">${STATUS[k].label}</b> — ${STATUS[k].help}</li>`).join('')}</ul></div>`;
}
function accountPanel() {
  const u = S.user;
  if (!u) return `<div class="sec"><p>Sign in to use Safe Circle, SOS, journey check-in, alerts and reporting.</p><button class="btn primary block" id="aSign">Sign in or create account</button></div>
    <div class="sec small">You can still use the Safety Map, Journey Planner and Emergency Services without an account.</div>`;
  const p = S.alertPrefs;
  return `<div class="sec"><h3>Profile</h3><form id="profF"><label class="f">Name</label><input type="text" name="name" maxlength="80" value="${esc(u.name)}" required>
    <label class="f">Phone</label><input type="text" name="phone" maxlength="30" inputmode="tel" value="${esc(u.phone || '')}" placeholder="0803…">
    <label class="f">Email</label><input type="text" value="${esc(u.email)}" disabled>
    <button class="btn block" style="margin-top:8px">Save profile</button></form>
    <p class="small">Account type: <b style="color:var(--ink)">${esc(u.real_role || u.role)}</b>${u.org ? ' · ' + esc(u.org.name) + (u.org_role ? ' (' + esc(u.org_role) + ')' : '') : ''}${u.security_status ? ' · security status: ' + esc(u.security_status) : ''}</p>
    ${u.security_status === 'pending' ? '<p class="small">An admin or your agency supervisor will verify your security account.</p>' : ''}</div>
  ${isStaffUser() ? `<div class="sec"><h3>Staff</h3><p class="small" style="margin-top:0">Moderation, SOS response, intelligence and administration are in the Command Centre.</p><a class="btn primary block" href="/admin">🛡️ Open the Command Centre</a></div>` : ''}
  <div class="sec"><h3>Notifications</h3>
    <button class="btn block" id="cPush">${S.pushOn ? '✅ App notifications on — send a test' : '🔔 Turn on app notifications'}</button>
    <button class="btn block" data-goto="alerts" style="margin-top:6px">Community alert settings</button>
    ${isSecurity() ? `<div class="toggle" style="margin-top:8px"><div>Receive SOS by SMS<small>${esc(u.phone || 'Add a phone number above')}</small></div>${sw('cSms', u.notify_sms)}</div>
      <p class="small">${u.base ? 'Duty location set — you are alerted to SOS within ' + (S.data.settings.sos_radius_km || 60) + ' km of it.' : 'No duty location set, so you are alerted to every SOS.'}</p>
      <div class="grid2"><button class="btn block" id="cBase">📍 Set duty location</button>${u.base ? '<button class="btn block" id="cBaseClear">Clear</button>' : ''}</div>` : ''}</div>
  <div class="sec"><h3>Privacy</h3>
    ${p ? `<div class="toggle"><div>Use my location for “alerts where I am”<small>Approximate location, kept for 6 hours, only while SafeRoute is open</small></div>${sw('prCur', p.current)}</div>` : ''}
    <p class="small">Your live location is shared only when you start an SOS, a journey or location sharing, and stops when you end it. Report photos have location data removed. Under the Nigeria Data Protection Act 2023 you can download or delete your data.</p>
    <div class="grid2"><a class="btn block" href="/api/me/export" download>⬇ Download my data</a><button class="btn block" id="prDel">Delete my account</button></div></div>
  <div class="sec"><h3>Sign-in security</h3><p class="small" style="margin-top:0">Two-step verification: <b style="color:var(--ink)">${u.totp_enabled ? 'on' : 'off'}</b>${u.mfa_needed ? ' — required for your staff access' : ''}.</p>
    <button class="btn block" id="prSec">Two-step verification, password and devices</button></div>
  ${fleetMembership()}
  <div class="sec"><button class="btn block" id="prOut">Sign out</button></div>`;
}
async function loadAccount() { if (S.user && !S.alertPrefs) { await loadAlertPrefs(); if (S.tab === 'account') renderPanel(); } }
function bindV4(P) {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  const act = (sel, fn) => P.querySelectorAll(sel).forEach(el => el.addEventListener('click', async () => { try { await fn(el); } catch (x) { toast(x.message); } }));
  on('aSign', 'click', () => authModal());
  act('[data-inb]', el => openUrl(S.inbox[+el.dataset.inb].url));
  act('[data-goto]', el => setTab(el.dataset.goto));
  on('sosBig', 'click', sosSheet);
  on('sosOpen', 'click', sosLiveView);
  act('[data-wconf]', async el => {
    if (!S.user) return authModal('Sign in to confirm reports. Confirmations from people nearby count the most.');
    const body = { kind: el.dataset.wconf }; if (S.pos) { body.lat = S.pos[0]; body.lng = S.pos[1]; }
    const r = await api(`/api/reports/${el.dataset.id}/confirm`, { method: 'POST', body });
    toast(r.closed ? 'Marked resolved' : r.distance_km != null && r.distance_km <= 2 ? 'Thanks — your nearby confirmation carries extra weight' : 'Thanks — recorded'); load();
  });
  on('profF', 'submit', async e => { e.preventDefault(); try { await api('/api/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Profile saved'); load(); } catch (x) { toast(x.message); } });
  on('prCur', 'change', async e => { try { const d = await api('/api/alerts/prefs', { method: 'PUT', body: { ...S.alertPrefs, current: e.target.checked } }); S.alertPrefs = d.prefs; toast(e.target.checked ? 'On' : 'Off — your last location has been deleted'); } catch (x) { toast(x.message); } });
  on('prSec', 'click', accountModal);
  on('prOut', 'click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.sos = null; S.circle = []; S.myShare = null; S.journeyActive = null; S.alertPrefs = null; S.inbox = null; S.tab = 'map'; toast('Signed out'); load(); });
  on('prDel', 'click', () => {
    modal(`<h2>Delete your account</h2><p>This permanently deletes your account, Safe Circle, journeys, alert settings and devices. Reports you sent stay on the map without your name, because others rely on them.</p>
      <form id="delF"><label class="f">Type your password to confirm</label><input type="password" name="password" required autocomplete="current-password"><div class="err" id="delE"></div>
      <div class="row" style="margin-top:12px;justify-content:space-between"><button type="button" class="btn" data-close>Keep my account</button><button class="btn danger">Delete permanently</button></div></form>`);
    $('#delF').onsubmit = async e => { e.preventDefault(); try { await api('/api/me/delete', { method: 'POST', body: { password: new FormData(e.target).get('password') } }); closeModal(); S.user = null; S.tab = 'map'; toast('Your account has been deleted'); load(); } catch (x) { $('#delE').textContent = x.message; } };
  });
}
// Local government area and state for the status card
S.adm = null; let admAt = null;
async function refreshAdm() {
  if (!S.pos || (admAt && km(admAt, S.pos) < 0.7)) return;
  admAt = S.pos.slice();
  try { S.adm = await api(`/api/geo/locate?lat=${S.pos[0].toFixed(5)}&lng=${S.pos[1].toFixed(5)}`); const el = $('#admLine'); if (el) el.innerHTML = admLine(); } catch (e) {}
}
function admLine() { return S.adm && S.adm.lga ? `📍 ${esc(S.adm.lga)} LGA, ${esc(S.adm.state)}` : ''; }
setInterval(refreshAdm, 5000);

// ---------------- start ----------------
load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
setInterval(() => { if (S.mode !== 'test') update(); sendLocation(); }, 15000);
setInterval(() => { if (!document.hidden && isSecurity()) loadSos(); }, 10000);
setInterval(() => { if (S.sos) loadMySos(); }, 10000);
window.addEventListener('online', () => { load(); flushQueue(); });
window.addEventListener('offline', showOffline);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => checkPush()).catch(() => {});
})();
