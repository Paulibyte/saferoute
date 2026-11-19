/* SafeRoute Naija — browser app */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = d => !isFinite(d) ? '—' : d < 1 ? Math.round(d * 100) * 10 + ' m' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
const { compute, km, nearest, LEVELS, SECURITY_CATS, SETTLE_LABEL, timeLabel } = window.SafeRisk;

const CAT = {
  police: { label: 'Police', icon: '👮', bg: '#1d4ed8' }, frsc: { label: 'FRSC', icon: '🦺', bg: '#0e7490' },
  military: { label: 'Military', icon: '🪖', bg: '#3f6212' }, nscdc: { label: 'NSCDC', icon: '🛡️', bg: '#1e40af' },
  hospital: { label: 'Hospital', icon: '🏥', bg: '#be123c' }, clinic: { label: 'Clinic', icon: '⚕️', bg: '#e11d48' },
  mechanic: { label: 'Mechanic', icon: '🔧', bg: '#57534e' }, vulcaniser: { label: 'Vulcaniser', icon: '🛞', bg: '#44403c' },
  fuel: { label: 'Fuel', icon: '⛽', bg: '#4d7c0f' }
};
const HELP_GROUPS = [['Security', SECURITY_CATS], ['Hospital / clinic', ['hospital', 'clinic']], ['Mechanic', ['mechanic', 'vulcaniser']], ['Fuel', ['fuel']]];
// Owerri → Port Harcourt line for the built-in test drive (approximate)
const TEST_ROUTE = [[5.4836,7.0333],[5.4700,7.0200],[5.4560,7.0050],[5.4380,6.9900],[5.4200,6.9750],[5.4000,6.9640],[5.3800,6.9550],[5.3550,6.9470],[5.3300,6.9400],[5.3000,6.9300],[5.2700,6.9200],[5.2350,6.9050],[5.2000,6.8900],[5.1650,6.8650],[5.1300,6.8400],[5.0930,6.8130],[5.0600,6.8200],[5.0300,6.8300],[4.9950,6.8450],[4.9600,6.8600],[4.9300,6.8850],[4.9000,6.9100],[4.8800,6.9350],[4.8600,6.9600],[4.8450,6.9800],[4.8400,7.0000],[4.8280,7.0250],[4.8156,7.0498]];

// ---------------- state ----------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('sr_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sr_' + k, JSON.stringify(v)); } catch (e) {} }
};
const S = {
  user: null, data: { types: {}, settings: {}, places: [], zones: [], reports: [] }, tab: 'map',
  pos: null, heading: null, speed: 0, mode: 'none', // none | gps | placed | test
  warn: store.get('warn', true), voice: store.get('voice', true), tourist: store.get('tourist', false), driver: false,
  planHour: null, follow: true, sat: store.get('sat', true), lastLevel: 0, alerted: new Map(), pick: null,
  sosActive: false, sosList: [], users: [], stats: null, test: null
};
const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
const travelHour = () => S.planHour == null ? hourNow() : S.planHour;
const isStaffMod = () => S.user && ['moderator', 'admin'].includes(S.user.role);
const isSecurity = () => S.user && ((S.user.role === 'security' && S.user.security_status === 'verified') || S.user.role === 'admin');
const isAdmin = () => S.user && S.user.role === 'admin';
const liveReports = () => S.data.reports.filter(r => r.status === 'approved' && (!r.expires_at || r.expires_at > Date.now()));

// ---------------- api ----------------
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, init);
  let json = {};
  try { json = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(json.error || 'Something went wrong (' + res.status + ')');
  return json;
}
async function load() {
  try {
    const d = await api('/api/bootstrap');
    S.user = d.user; S.data = d;
    if (!store.get('view', null) && !S.fitted) {
      const pts = d.places.map(p => [p.lat, p.lng]).concat(d.reports.map(r => [r.lat, r.lng]));
      if (pts.length) { map.fitBounds(L.latLngBounds(pts).pad(.1)); S.fitted = true; }
    }
    $('#offline').style.display = navigator.onLine ? 'none' : 'block';
    // keep the server clock honest for freshness calculations
  } catch (e) {
    $('#offline').style.display = 'block';
  }
  renderTabs(); drawMap();
  const typing = document.activeElement && $('#panel').contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (!S.pick && !typing) renderPanel(); else update();
  if (isSecurity()) loadSos();
}
async function loadSos() {
  try { S.sosList = await api('/api/sos'); renderTabs(); if (S.tab === 'security') renderPanel(); } catch (e) {}
}

// ---------------- map ----------------
const map = L.map('map', { zoomControl: false }).setView(store.get('view', [9.07, 7.49]), store.get('zoom', 6));
L.control.zoom({ position: 'bottomleft' }).addTo(map);
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
const satLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
function setBase() {
  [satLayer, satLabels, streetLayer].forEach(l => map.hasLayer(l) && map.removeLayer(l));
  if (S.sat) { satLayer.addTo(map); satLabels.addTo(map); $('#btnLayer').textContent = '🛰️'; }
  else { streetLayer.addTo(map); $('#btnLayer').textContent = '🗺️'; }
}
setBase();
map.on('moveend', () => { const c = map.getCenter(); store.set('view', [c.lat, c.lng]); store.set('zoom', map.getZoom()); });
map.on('dragstart', () => { S.follow = false; });

const gZones = L.layerGroup().addTo(map), gRisk = L.layerGroup().addTo(map), gRoute = L.layerGroup().addTo(map), gReports = L.layerGroup().addTo(map), gPlaces = L.layerGroup().addTo(map), gSos = L.layerGroup().addTo(map);
const meMarker = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 });
let accCircle = null, pickMarker = null;

function icon(html, size, extra) { return L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2], ...(extra || {}) }); }
function drawMap() {
  gZones.clearLayers(); gRisk.clearLayers(); gReports.clearLayers(); gPlaces.clearLayers();
  const T = S.data.types;
  if (isAdmin() && S.tab === 'admin') {
    for (const z of S.data.zones) L.circle([z.lat, z.lng], { radius: z.radius_km * 1000, color: '#94a3b8', weight: 1, dashArray: '4 4', fillOpacity: .04, interactive: false }).addTo(gZones);
  }
  for (const r of liveReports()) {
    const t = T[r.type]; if (!t) continue;
    L.circle([r.lat, r.lng], { radius: t.radius_km * 1000, color: t.color, weight: 1, opacity: .6, fillOpacity: .1, interactive: false }).addTo(gRisk);
    L.marker([r.lat, r.lng], { icon: icon(`<div class="mk" style="width:32px;height:32px;background:${t.color}">${t.icon}</div>`, 32) })
      .bindPopup(() => reportPopup(r)).addTo(gReports);
  }
  for (const r of S.data.reports.filter(r => r.status === 'pending')) {
    const t = T[r.type]; if (!t) continue;
    L.marker([r.lat, r.lng], { opacity: .8, icon: icon(`<div class="mk" style="width:28px;height:28px;background:#334155;border-style:dashed">${t.icon}</div>`, 28) })
      .bindPopup(`<b>Pending: ${esc(t.label)}</b><br>${esc(r.note || '')}<br><span class="small">Awaiting moderator check · ${ago(r.created_at)}</span>`).addTo(gReports);
  }
  for (const p of S.data.places) {
    const c = CAT[p.category] || CAT.police;
    L.marker([p.lat, p.lng], { icon: icon(`<div class="mk sq" style="width:26px;height:26px;background:${c.bg}">${c.icon}</div>`, 26) })
      .bindPopup(`<b>${c.icon} ${esc(p.name)}</b><br><span class="small">${c.label}${p.phone ? ' · <a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + '</a>' : ''}</span>
        <div style="margin-top:8px"><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Directions</a></div>`).addTo(gPlaces);
  }
  gSos.clearLayers();
  if (isSecurity()) for (const s of S.sosList.filter(s => s.status !== 'closed')) {
    L.marker([s.lat, s.lng], { zIndexOffset: 900, icon: icon(`<div class="mk" style="width:34px;height:34px;background:#dc2626">🆘</div>`, 34) })
      .bindPopup(`<b>SOS — ${esc(s.name || 'User')}</b><br>${s.phone ? esc(s.phone) + '<br>' : ''}<span class="small">${ago(s.created_at)} · ${s.status}</span>`).addTo(gSos);
  }
  drawTestRoute();
}
function reportPopup(r) {
  const t = S.data.types[r.type];
  return `<b>${t.icon} ${esc(t.label)}</b>${r.official ? ' <span class="pill off">Official</span>' : ''}<br>${esc(r.note || '')}
    ${r.photo ? `<br><img src="/uploads/${esc(r.photo)}" alt="Report photo" style="max-width:220px;border-radius:8px;margin-top:6px">` : ''}
    <br><span class="small">${esc(r.by_name)} · ${ago(r.created_at)}${r.responding_by ? ' · <b style="color:#fcd34d">Security responding</b>' : ''}</span>
    <div style="margin-top:8px;display:flex;gap:6px"><button class="btn sm" data-vote="still" data-id="${r.id}">Still there (${r.still})</button><button class="btn sm" data-vote="cleared" data-id="${r.id}">Cleared (${r.cleared})</button></div>`;
}
map.on('popupopen', e => {
  e.popup.getElement().querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
    if (!S.user) return authModal('Sign in to confirm reports');
    try { const c = await api(`/api/reports/${b.dataset.id}/vote`, { method: 'POST', body: { vote: b.dataset.vote } });
      const r = S.data.reports.find(x => x.id == b.dataset.id); if (r) { r.still = c.still; r.cleared = c.cleared; e.popup.setContent(reportPopup(r)); }
      toast('Thanks — confirmations keep the map accurate'); load();
    } catch (err) { toast(err.message); }
  });
});

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
function announce(text, hex, snd) {
  if (!S.warn) return;
  if (snd) sound(snd);
  setTimeout(() => speak(text), snd === 'avoid' ? 1900 : snd ? 700 : 0);
  if (navigator.vibrate) try { navigator.vibrate(snd === 'avoid' ? [300, 100, 300, 100, 300] : [200, 80, 200]); } catch (e) {}
  const c = $('#caption'); $('#captionT').textContent = text; c.style.borderLeftColor = hex || '#f59e0b';
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  clearTimeout(capTimer); capTimer = setTimeout(() => c.classList.remove('show'), 8000);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('SafeRoute warning', { body: text, icon: '/icons/icon-192.png' }); } catch (e) {}
  }
}

// ---------------- risk + alerts loop ----------------
function hazardsAhead() {
  if (!S.pos) return [];
  const look = Math.max(.5, S.speed * (+S.data.settings.alert_lookahead_s || 45) / 3600 + .3);
  const out = [];
  for (const r of liveReports()) {
    if (r.type === 'advisory') continue;
    const d = km(S.pos, [r.lat, r.lng]);
    if (d > 15) continue;
    let ahead = true;
    if (S.heading != null && S.speed > 5 && d > .15) {
      const y = Math.sin((r.lng - S.pos[1]) * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180);
      const x = Math.cos(S.pos[0] * Math.PI / 180) * Math.sin(r.lat * Math.PI / 180) - Math.sin(S.pos[0] * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180) * Math.cos((r.lng - S.pos[1]) * Math.PI / 180);
      const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      const diff = Math.abs(((bearing - S.heading) + 540) % 360 - 180);
      ahead = diff < 50;
    }
    if (ahead) out.push({ r, d, look });
  }
  return out.sort((a, b) => a.d - b.d);
}
function update() {
  const hour = travelHour();
  const hh = Math.floor(((hour % 24) + 24) % 24), mm = Math.floor((hour % 1) * 60);
  $('#clockT').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  $('#clockD').textContent = (S.planHour == null ? '' : 'Planned · ') + timeLabel(hour);
  if (!S.pos) { $('#pill .dot').style.background = '#64748b'; $('#pillLvl').textContent = 'Location off'; $('#pillWhere').textContent = 'Tap “Start” to begin'; renderStatus(null, []); return; }
  const k = compute(S.pos, hour, S.data, { tourist: S.tourist });
  const L0 = LEVELS[k.level];
  $('#pill .dot').style.background = L0.hex;
  $('#pillLvl').textContent = L0.name + ' · ' + k.R;
  $('#pillWhere').textContent = k.zone.name + ' · ' + (SETTLE_LABEL[k.zone.type] || '');
  if (!map.hasLayer(meMarker)) meMarker.addTo(map);
  meMarker.setLatLng(S.pos);
  if (S.follow && S.mode !== 'none') map.panTo(S.pos, { animate: true, duration: .3 });

  if (S.mode !== 'none') {
    if (k.level > S.lastLevel && k.level >= 1) {
      const post = k.post ? `${k.post.place.name}, ${fmtKm(k.post.d)} away` : 'none recorded nearby';
      const night = k.T > 1 ? ' Travelling at this hour raises the risk here.' : '';
      const txt = k.level === 1 ? `Caution. You are entering an area with elevated risk.${night} Stay alert.`
        : k.level === 2 ? `Warning. High-risk area. Nearest security post: ${post}. Avoid stopping.${night}`
        : `Danger. This area is marked avoid. Consider turning back or waiting for daylight. Nearest security post: ${post}. Press S O S if you need help.`;
      announce(txt, L0.hex, ['', 'chime', 'high', 'avoid'][k.level]);
    } else if (k.level < S.lastLevel && S.lastLevel >= 2 && k.level <= 1) {
      announce('You are leaving the high-risk area.', L0.hex, 'chime');
    }
    S.lastLevel = k.level;
    const ah = hazardsAhead();
    for (const h of ah) {
      const last = S.alerted.get(h.r.id);
      if (h.d <= h.look && (!last || Date.now() - last > 20 * 60000)) {
        S.alerted.set(h.r.id, Date.now());
        const t = S.data.types[h.r.type];
        const dist = h.d < .15 ? 'right here' : `${Math.round(h.d * 1000 / 50) * 50} metres ahead`;
        announce(`Caution. ${t.label} reported ${dist}. ${t.advice}`, t.color, 'hazard');
        break;
      }
    }
    if (S.driver) renderDriver(k, ah);
    renderStatus(k, ah);
  } else renderStatus(k, hazardsAhead());
}
function renderDriver(k, ah) {
  const L0 = LEVELS[k.level];
  $('#dLvl').textContent = L0.name.toUpperCase(); $('#dLvl').style.color = L0.hex;
  $('#dWhere').textContent = `${k.zone.name} · score ${k.R} · ${timeLabel(travelHour())}`;
  const n = ah[0];
  $('#dNext').textContent = n ? `${S.data.types[n.r.type].icon} ${S.data.types[n.r.type].label} in ${fmtKm(n.d)}` : 'No reported hazards ahead';
  $('#dSpeed').textContent = Math.round(S.speed);
  $('#dPost').textContent = k.post ? fmtKm(k.post.d) : '—';
  const hp = nearest(S.pos, S.data.places, ['hospital', 'clinic']); $('#dHosp').textContent = hp ? fmtKm(hp.d) : '—';
}

// ---------------- location ----------------
let watchId = null, wakeLock = null;
function startGps() {
  audio();
  if (!('geolocation' in navigator)) return toast('This browser cannot share location');
  stopTest(); stopGps();
  S.mode = 'gps'; S.follow = true; S.lastLevel = 0;
  toast('Finding your location…');
  watchId = navigator.geolocation.watchPosition(p => {
    const first = !S.pos || S.mode !== 'gps';
    S.pos = [p.coords.latitude, p.coords.longitude];
    S.speed = p.coords.speed != null ? p.coords.speed * 3.6 : S.speed;
    if (p.coords.heading != null && !isNaN(p.coords.heading)) S.heading = p.coords.heading;
    if (accCircle) map.removeLayer(accCircle);
    accCircle = L.circle(S.pos, { radius: p.coords.accuracy, color: '#3b82f6', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    if (first || map.getZoom() < 12) map.setView(S.pos, 14);
    update();
  }, err => {
    S.mode = 'none'; renderPanel();
    toast(err.code === 1 ? 'Location permission was denied. Allow location for this site in your browser settings.' : 'Could not get your location. Move to open sky and try again.', 5000);
  }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
  if ('Notification' in window && Notification.permission === 'default') try { Notification.requestPermission(); } catch (e) {}
  renderPanel();
}
function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (accCircle) { map.removeLayer(accCircle); accCircle = null; }
  if (S.mode === 'gps') S.mode = 'none';
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.mode === 'gps' && 'wakeLock' in navigator && !wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => {});
});

// built-in test drive along the Owerri → Port Harcourt line (for demos and checking alerts)
function densify(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(km(a, b) / .4)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  out.push(pts[pts.length - 1]); return out;
}
const TR = densify(TEST_ROUTE), TRC = [0]; for (let i = 1; i < TR.length; i++) TRC.push(TRC[i - 1] + km(TR[i - 1], TR[i]));
function trPos(s) { let i = 1; while (i < TR.length - 1 && TRC[i] < s) i++; const t = Math.min(1, Math.max(0, (s - TRC[i - 1]) / (TRC[i] - TRC[i - 1] || 1))); return [TR[i - 1][0] + (TR[i][0] - TR[i - 1][0]) * t, TR[i - 1][1] + (TR[i][1] - TR[i - 1][1]) * t]; }
function drawTestRoute() {
  gRoute.clearLayers();
  if (!S.test) return;
  L.polyline(TR, { color: '#000', weight: 10, opacity: .4, interactive: false }).addTo(gRoute);
  for (let i = 0; i < TR.length - 2; i += 2) {
    const lv = compute(TR[i + 1], travelHour(), S.data, { tourist: S.tourist }).level;
    L.polyline([TR[i], TR[i + 1], TR[i + 2]], { color: LEVELS[lv].hex, weight: 5, opacity: .95, interactive: false }).addTo(gRoute);
  }
}
function startTest() {
  audio(); stopGps();
  if (!S.test || S.test.s >= TRC[TRC.length - 1]) S.test = { s: 0, timer: null };
  S.mode = 'test'; S.speed = 80; S.follow = true; S.lastLevel = 0; S.alerted.clear();
  drawTestRoute(); map.setView(trPos(S.test.s), 13);
  clearInterval(S.test.timer);
  S.test.timer = setInterval(() => {
    const prev = trPos(S.test.s);
    S.test.s += 80 * (.25 * 60 / 3600); // 60x real time
    if (S.planHour != null) S.planHour = (S.planHour + .25 * 60 / 3600) % 24;
    S.pos = trPos(S.test.s);
    const y = S.pos[1] - prev[1], x = S.pos[0] - prev[0]; S.heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    if (S.test.s >= TRC[TRC.length - 1]) { stopTest(); announce('Test drive complete.', '#22c55e', 'chime'); }
    update();
  }, 250);
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
  if (kind === 'place-me') { stopGps(); stopTest(); S.mode = 'placed'; S.pos = p; S.speed = 0; S.lastLevel = 0; S.alerted.clear(); update(); renderPanel(); toast('Position set — warnings now use this spot'); }
  else if (kind === 'report') reportForm(p, false);
  else if (kind === 'advisory') reportForm(p, true);
  else if (kind === 'place') placeForm(p);
  else if (kind === 'zone') zoneForm(p);
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
function reportForm(p, official) {
  marker(p);
  const types = Object.values(S.data.types).filter(t => official || t.key !== 'advisory');
  modal(`<h2>${official ? 'Post official advisory' : 'Report a situation'}</h2>
    <p>${official ? 'Advisories from verified security accounts publish immediately.' : isSecurity() ? 'As verified security, your report publishes immediately as Official.' : 'A moderator checks your report before it appears on the map.'}</p>
    <p class="small">📍 ${p[0].toFixed(5)}, ${p[1].toFixed(5)}</p>
    <form id="rForm">
      <label class="f">What is happening?</label><select name="type">${types.map(t => `<option value="${t.key}" ${official && t.key === 'advisory' ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}</select>
      <label class="f">Details</label><textarea name="note" rows="3" maxlength="400" placeholder="e.g. Water over the road, one lane passable"></textarea>
      <label class="f">Photo (optional)</label><input type="file" name="photo" accept="image/*" capture="environment">
      <div class="err" id="rErr"></div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" id="rSend">${official ? 'Publish advisory' : 'Send report'}</button></div>
    </form>`, clearMarker);
  $('#rForm').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target); fd.append('lat', p[0]); fd.append('lng', p[1]);
    if (fd.get('photo') && !fd.get('photo').size) fd.delete('photo');
    $('#rSend').disabled = true;
    try {
      const r = await api('/api/reports', { method: 'POST', form: fd });
      closeModal(); clearMarker();
      toast(r.status === 'approved' ? 'Published — everyone nearby will be warned' : 'Sent. A moderator will check it shortly.', 4000);
      S.lastLevel = 0; load();
    } catch (e) { $('#rErr').textContent = e.message; $('#rSend').disabled = false; }
  };
}
function placeForm(p) {
  marker(p);
  modal(`<h2>Add a place</h2><p class="small">📍 ${p[0].toFixed(5)}, ${p[1].toFixed(5)}</p><form id="pForm">
    <label class="f">Category</label><select name="category">${Object.entries(CAT).map(([k, c]) => `<option value="${k}">${c.icon} ${c.label}</option>`).join('')}</select>
    <label class="f">Name</label><input type="text" name="name" required maxlength="100" placeholder="e.g. Police Division, Mbaise Road">
    <label class="f">Phone (optional)</label><input type="text" name="phone" maxlength="30">
    <div class="err" id="pErr"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save place</button></div></form>`, clearMarker);
  $('#pForm').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    try { await api('/api/places', { method: 'POST', body: { ...f, lat: p[0], lng: p[1] } }); closeModal(); clearMarker(); toast('Place saved'); load(); }
    catch (e) { $('#pErr').textContent = e.message; }
  };
}
function zoneForm(p) {
  marker(p);
  modal(`<h2>Add a settlement zone</h2><p>Zones set the base risk of an area. The smallest zone that contains a point wins; anything outside every zone counts as rural.</p><form id="zForm">
    <label class="f">Name</label><input type="text" name="name" required maxlength="80" placeholder="e.g. Owerri municipal">
    <label class="f">Settlement type</label><select name="type"><option value="urban">Urban</option><option value="peri">Peri-urban</option><option value="rural">Rural</option><option value="forest">Forest / isolated stretch</option></select>
    <label class="f">Radius (km)</label><input type="text" name="radius_km" value="3" inputmode="decimal">
    <div class="err" id="zErr"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save zone</button></div></form>`, clearMarker);
  $('#zForm').onsubmit = async ev => {
    ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target));
    try { await api('/api/zones', { method: 'POST', body: { ...f, lat: p[0], lng: p[1] } }); closeModal(); clearMarker(); toast('Zone saved'); load(); }
    catch (e) { $('#zErr').textContent = e.message; }
  };
}
function authModal(reason, startOn) {
  let mode = startOn || 'login';
  const draw = () => {
    modal(`<h2>${mode === 'login' ? 'Sign in' : 'Create account'}</h2>${reason ? `<p>${esc(reason)}</p>` : ''}
      <form id="aForm">
        ${mode === 'register' ? '<label class="f">Full name</label><input type="text" name="name" required maxlength="80"><label class="f">Phone</label><input type="text" name="phone" maxlength="30" inputmode="tel">' : ''}
        <label class="f">Email</label><input type="text" name="email" required inputmode="email" autocomplete="email">
        <label class="f">Password</label><input type="password" name="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" style="width:100%;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px">
        ${mode === 'register' ? `<div class="toggle" style="margin-top:10px"><div>I am security personnel<small>Police, FRSC, NSCDC, military or vigilance. An admin verifies you before the badge is given.</small></div><label class="sw"><input type="checkbox" name="security" id="aSec"><span></span></label></div>
          <div id="aAgency" style="display:none"><label class="f">Agency and unit</label><input type="text" name="agency" maxlength="60" placeholder="e.g. Nigeria Police, Owerri Division"></div>` : ''}
        <div class="err" id="aErr"></div>
        <button class="btn primary block" style="margin-top:12px">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p class="small" style="margin-top:12px;text-align:center">${mode === 'login' ? 'New here? <button class="linkish" id="aSwap">Create an account</button>' : 'Have an account? <button class="linkish" id="aSwap">Sign in</button>'}</p>`);
    $('#aSwap').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; draw(); };
    const sec = $('#aSec'); if (sec) sec.onchange = () => { $('#aAgency').style.display = sec.checked ? 'block' : 'none'; };
    $('#aForm').onsubmit = async ev => {
      ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); f.security = !!f.security;
      try {
        const r = await api('/api/auth/' + mode, { method: 'POST', body: f });
        S.user = r.user; closeModal();
        toast(mode === 'login' ? 'Welcome back, ' + r.user.name.split(' ')[0] : f.security ? 'Account created. An admin will verify your security status.' : 'Account created');
        load();
      } catch (e) { $('#aErr').textContent = e.message; }
    };
  };
  draw();
}

// ---------------- panels ----------------
function sw(id, on) { return `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`; }
function renderTabs() {
  const tabs = [['map', 'Map']];
  const pend = S.data.reports.filter(r => r.status === 'pending').length;
  if (isStaffMod()) tabs.push(['moderate', 'Moderate', pend]);
  if (isSecurity()) tabs.push(['security', 'Security', S.sosList.filter(s => s.status === 'open').length]);
  if (isAdmin()) tabs.push(['admin', 'Admin']);
  if (!tabs.find(t => t[0] === S.tab)) S.tab = 'map';
  $('#tabs').style.display = tabs.length > 1 ? '' : 'none';
  $('#tabs').innerHTML = tabs.map(([k, l, n]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
  $$('#tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderTabs(); drawMap(); renderPanel(); if (S.tab === 'admin') loadAdmin(); });
  $('#btnAccount').textContent = S.user ? (S.user.name.split(' ')[0] + ' ▾') : 'Sign in';
}
function statusCard() { return `<div class="sec"><h3>Your situation</h3><div class="statcard" id="statcard"></div></div>`; }
function renderStatus(k, ah) {
  const el = $('#statcard'); if (!el) return;
  if (!k) { el.innerHTML = `<div class="lvl" style="color:var(--mute)">Location off</div><p class="small" style="margin:6px 0 0">Press <b>Start</b> below so the app can warn you about unsafe places and hazards as you move.</p>`; renderHelp(); return; }
  const L0 = LEVELS[k.level];
  el.innerHTML = `<div class="row between"><div class="lvl" style="color:${L0.hex}">${L0.name}</div><div class="score">Score <b style="color:var(--ink);font-size:16px">${k.R}</b>/100</div></div>
    <div class="bar"><i style="width:${k.R}%;background:${L0.hex}"></i></div>
    <div class="where">📍 <b>${esc(k.zone.name)}</b> · ${SETTLE_LABEL[k.zone.type] || ''} · ${timeLabel(travelHour())}${S.tourist ? ' · Tourist Mode' : ''}</div>
    <div class="factors"><div class="factor"><b>${k.H}</b><span>Hazards</span></div><div class="factor"><b>+${k.P}</b><span>Security gap</span></div><div class="factor"><b>+${k.S}</b><span>Settlement</span></div><div class="factor"><b>×${k.T}</b><span>Time</span></div></div>
    ${ah && ah[0] ? `<div class="where" style="margin-top:10px">Nearest hazard ahead: <b>${S.data.types[ah[0].r.type].icon} ${esc(S.data.types[ah[0].r.type].label)}</b> · ${fmtKm(ah[0].d)}</div>` : ''}`;
  renderHelp();
}
function renderHelp() {
  const hl = $('#helpList'); if (!hl) return;
  if (!S.pos) { hl.innerHTML = '<li class="empty">Turn on location to see the nearest help.</li>'; return; }
  hl.innerHTML = HELP_GROUPS.map(([label, cats]) => {
    const n = nearest(S.pos, S.data.places, cats); if (!n) return '';
    const c = CAT[n.place.category];
    return `<li><span class="ico" style="background:${c.bg};border-color:${c.bg}">${c.icon}</span><div class="meta"><div>${esc(n.place.name)}</div><small>${label}${n.place.phone ? ' · ' + esc(n.place.phone) : ''}</small></div><span class="dist">${fmtKm(n.d)}</span><button class="btn sm" data-go="${n.place.lat},${n.place.lng}">Show</button></li>`;
  }).join('') || '<li class="empty">No places recorded near you yet.</li>';
  hl.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.follow = false; map.setView(b.dataset.go.split(',').map(Number), 15); });
}
function mapPanel() {
  const tracking = S.mode === 'gps';
  return statusCard() + `
  <div class="sec"><h3>Location</h3>
    <button class="btn block ${tracking ? 'track-on' : 'primary'}" id="bGps" style="padding:12px">${tracking ? '■ Stop tracking' : '▶ Start — use my GPS'}</button>
    <div class="grid2" style="margin-top:8px"><button class="btn block" id="bPlace">📍 Place me on map</button><button class="btn block" id="bReport">📣 Report</button></div>
    <label class="f">Time of travel: <b id="hourLbl" style="color:var(--ink)">${S.planHour == null ? 'Now (live)' : fmtHour(S.planHour)}</b></label>
    <input type="range" id="hour" min="0" max="23.75" step="0.25" value="${S.planHour == null ? hourNow() : S.planHour}">
    ${S.planHour != null ? '<button class="linkish" id="hourNow" style="font-size:12px">↺ Back to live time</button>' : '<div class="small">Slide to check how safe a place is at another time.</div>'}
  </div>
  <div class="sec"><h3>Alerts</h3>
    <div class="toggle"><div>Danger warning<small>Sound and voice when risk rises or a hazard is ahead</small></div>${sw('tWarn', S.warn)}</div>
    <div class="toggle"><div>Voice prompts<small>Spoken warnings</small></div>${sw('tVoice', S.voice)}</div>
    <div class="toggle"><div>Tourist Mode<small>First visit? Warns you earlier</small></div>${sw('tTour', S.tourist)}</div>
    <div class="toggle"><div>Driver Mode<small>Large hands-free screen while driving</small></div>${sw('tDriver', S.driver)}</div>
    <button class="btn block" id="bTest" style="margin-top:10px">🔊 Test sound and voice</button>
  </div>
  <div class="sec"><h3>Nearest help</h3><ul class="help" id="helpList"></ul></div>
  <div class="sec"><h3>Map key</h3><div class="legend">${LEVELS.map(l => `<span><i style="background:${l.hex}"></i>${l.name}</span>`).join('')}</div>
    <div class="legend" style="margin-top:8px">${Object.values(CAT).map(c => `<span>${c.icon} ${c.label}</span>`).join('')}</div>
    <div class="legend" style="margin-top:8px">${Object.values(S.data.types).map(t => `<span>${t.icon} ${esc(t.label)}</span>`).join('')}</div></div>
  <div class="sec"><details ${S.test ? 'open' : ''}><summary>Testing tools</summary>
    <p class="small">Simulate a drive from Owerri to Port Harcourt at 80 km/h (60× faster) to hear the warnings without travelling.</p>
    <div class="grid2"><button class="btn block" id="bTestDrive">${S.mode === 'test' ? '⏸ Pause test drive' : '🚗 Test drive'}</button><button class="btn block" id="bTestEnd">✕ End test</button></div>
  </details></div>
  <div class="sec small">Warnings are advisory. Always follow instructions from security personnel. Emergency: 112.</div>`;
}
function fmtHour(h) { h = ((h % 24) + 24) % 24; return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0') + ' · ' + timeLabel(h); }
const typeOpts = sel => Object.values(S.data.types).filter(t => t.key !== 'advisory').map(t => `<option value="${t.key}" ${t.key === sel ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
function expiresIn(r) { if (!r.expires_at) return '—'; const h = (r.expires_at - Date.now()) / 36e5; return h > 48 ? Math.round(h / 24) + ' days' : Math.max(1, Math.round(h)) + ' h'; }
function moderatePanel() {
  const pend = S.data.reports.filter(r => r.status === 'pending').sort((a, b) => a.created_at - b.created_at);
  const live = liveReports().sort((a, b) => b.created_at - a.created_at);
  const T = S.data.types;
  return `<div class="sec"><h3>Waiting for review · ${pend.length}</h3>
    ${pend.map(r => `<div class="card"><div class="t">${T[r.type].icon} ${esc(T[r.type].label)} <span class="pill">${ago(r.created_at)}</span></div>
      <p>${esc(r.note || '—')}<br>By ${esc(r.by_name)} · ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</p>
      ${r.photo ? `<img src="/uploads/${esc(r.photo)}" alt="Report photo">` : ''}
      <div class="row"><button class="btn sm primary" data-mod="approve" data-id="${r.id}">Approve</button><button class="btn sm" data-mod="reject" data-id="${r.id}">Reject</button><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button></div>
      <div class="row" style="margin-top:8px"><span class="small" style="white-space:nowrap">Correct type</span><select data-retype="${r.id}" style="padding:4px 6px;font-size:12px">${typeOpts(r.type)}</select></div></div>`).join('') || '<div class="empty">Nothing waiting. New reports appear here before anyone else sees them.</div>'}
  </div>
  <div class="sec"><h3>Live on the map · ${live.length}</h3>
    ${live.map(r => `<div class="card"><div class="t">${T[r.type].icon} ${esc(T[r.type].label)} ${r.official ? '<span class="pill off">Official</span>' : ''}</div>
      <p>${esc(r.note || '—')}<br>Expires in ${expiresIn(r)} · ${r.still} still there / ${r.cleared} cleared</p>
      <div class="row"><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button><button class="btn sm" data-mod="expire" data-id="${r.id}">Remove now</button></div></div>`).join('') || '<div class="empty">No live reports.</div>'}
  </div>`;
}
function securityPanel() {
  const T = S.data.types;
  const live = liveReports().filter(r => r.type !== 'advisory').sort((a, b) => T[b.type].weight - T[a.type].weight);
  const pend = S.data.reports.filter(r => r.status === 'pending');
  const sos = S.sosList;
  return `<div class="sec"><h3>SOS alerts · ${sos.filter(s => s.status !== 'closed').length} active</h3>
    ${sos.map(s => `<div class="card" style="${s.status === 'open' ? 'border-color:#991b1b' : ''}"><div class="t">🆘 ${esc(s.name || 'User')} <span class="pill ${s.status === 'responding' ? 'resp' : ''}">${s.status}</span></div>
      <p>${s.phone ? esc(s.phone) + ' · ' : ''}${ago(s.created_at)} · updated ${ago(s.updated_at)}</p>
      <div class="row"><button class="btn sm" data-zoom="${s.lat},${s.lng}">View</button>${s.status !== 'closed' ? `<button class="btn sm primary" data-sos="responding" data-id="${s.id}">Responding</button><button class="btn sm" data-sos="closed" data-id="${s.id}">Close</button>` : ''}</div></div>`).join('') || '<div class="empty">No SOS alerts in the last 24 hours.</div>'}
  </div>
  <div class="sec"><button class="btn primary block" id="bAdv">🛡️ Post official advisory</button></div>
  <div class="sec"><h3>Verified incidents</h3>
    ${live.map(r => `<div class="card"><div class="t">${T[r.type].icon} ${esc(T[r.type].label)} ${r.responding_by ? '<span class="pill resp">Responding</span>' : ''}</div>
      <p>${esc(r.note || '—')}<br>${ago(r.created_at)} · ${r.still} confirmations</p>
      <div class="row"><button class="btn sm ${r.responding_by ? '' : 'primary'}" data-resp="${r.responding_by ? 0 : 1}" data-id="${r.id}">${r.responding_by ? 'Stop responding' : 'Responding'}</button><button class="btn sm" data-clear="${r.id}">Mark cleared</button><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button></div></div>`).join('') || '<div class="empty">No verified incidents.</div>'}
  </div>
  <div class="sec"><h3>Unverified reports · ${pend.length}</h3>
    ${pend.map(r => `<div class="card"><div class="t">${T[r.type].icon} ${esc(T[r.type].label)} <span class="pill">${ago(r.created_at)}</span></div><p>${esc(r.note || '—')}</p>
      <div class="row"><button class="btn sm" data-confirm="${r.id}">Confirm as official</button><button class="btn sm" data-zoom="${r.lat},${r.lng}">View</button></div></div>`).join('') || '<div class="empty">None.</div>'}
  </div>`;
}
async function loadAdmin() {
  try { [S.users, S.stats] = await Promise.all([api('/api/admin/users'), api('/api/admin/stats')]); if (S.tab === 'admin') renderPanel(); } catch (e) { toast(e.message); }
}
function adminPanel() {
  const st = S.stats || {};
  const s = S.data.settings;
  const req = S.users.filter(u => u.security_status === 'pending');
  return `<div class="sec"><h3>Overview</h3><div class="factors">
      <div class="factor"><b>${st.users ?? '–'}</b><span>Users</span></div><div class="factor"><b>${st.pending ?? '–'}</b><span>Pending</span></div>
      <div class="factor"><b>${st.live ?? '–'}</b><span>Live</span></div><div class="factor"><b>${st.places ?? '–'}</b><span>Places</span></div></div></div>
  <div class="sec"><h3>Security verification · ${req.length}</h3>
    ${req.map(u => `<div class="card"><div class="t">${esc(u.name)}</div><p>${esc(u.agency || 'No agency given')}<br>${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</p>
      <div class="row"><button class="btn sm primary" data-verify="${u.id}">Verify as security</button><button class="btn sm" data-unverify="${u.id}">Decline</button></div></div>`).join('') || '<div class="empty">No requests. Check ID cards or official letters before verifying.</div>'}
  </div>
  <div class="sec"><h3>Users</h3>
    <table class="mini">${S.users.slice(0, 200).map(u => `<tr><td><b>${esc(u.name)}</b>${u.banned ? ' <span class="pill">banned</span>' : ''}<br><span class="small">${esc(u.email)}</span></td>
      <td style="width:118px"><select data-role="${u.id}" style="padding:3px 5px;font-size:12px">${['traveller', 'security', 'moderator', 'admin'].map(r => `<option ${u.role === r ? 'selected' : ''} value="${r}">${r}</option>`).join('')}</select></td>
      <td style="width:54px"><button class="btn sm" data-ban="${u.id}" data-val="${u.banned ? 0 : 1}">${u.banned ? 'Unban' : 'Ban'}</button></td></tr>`).join('')}</table>
  </div>
  <div class="sec"><h3>Places · ${S.data.places.length}</h3>
    <button class="btn primary block" id="bAddPlace">➕ Add hospital, police post, mechanic…</button>
    <details style="margin-top:10px"><summary>Show all places</summary><table class="mini" style="margin-top:6px">${S.data.places.map(p => `<tr><td>${(CAT[p.category] || {}).icon || ''} ${esc(p.name)}</td><td style="width:90px;text-align:right"><button class="btn sm" data-zoom="${p.lat},${p.lng}">View</button> <button class="btn sm" data-delplace="${p.id}">✕</button></td></tr>`).join('')}</table></details>
  </div>
  <div class="sec"><h3>Settlement zones · ${S.data.zones.length}</h3>
    <button class="btn block" id="bAddZone">➕ Add zone</button>
    <table class="mini" style="margin-top:8px">${S.data.zones.map(z => `<tr><td>${esc(z.name)}<br><span class="small">${SETTLE_LABEL[z.type]} · ${z.radius_km} km</span></td><td style="width:90px;text-align:right"><button class="btn sm" data-zoom="${z.lat},${z.lng}">View</button> <button class="btn sm" data-delzone="${z.id}">✕</button></td></tr>`).join('')}</table>
  </div>
  <div class="sec"><h3>Risk weights</h3><p class="small" style="margin:0 0 8px">Points · warning radius (km) · how long a report stays (hours)</p>
    <table class="mini">${Object.values(S.data.types).map(t => `<tr><td>${t.icon} ${esc(t.label)}</td><td style="width:200px;text-align:right"><input data-tw="${t.key}" value="${t.weight}"> <input data-tr="${t.key}" value="${t.radius_km}"> <input data-tt="${t.key}" value="${t.ttl_hours}"></td></tr>`).join('')}</table>
    <button class="btn block" id="bSaveTypes" style="margin-top:8px">Save weights</button>
  </div>
  <div class="sec"><h3>Scoring rules</h3>
    <table class="mini">${[
      ['cutoffs', 'Caution, High, Avoid start at'], ['tourist_shift', 'Tourist Mode warns earlier by'], ['post_near_km', 'Security post “near” within km'], ['post_mid_km', 'Security post “mid” within km'],
      ['post_mid_pts', 'Points if post is mid-distance'], ['post_far_pts', 'Points if post is far'], ['settle_urban', 'Urban base'], ['settle_peri', 'Peri-urban base'], ['settle_rural', 'Rural base'],
      ['settle_forest', 'Forest base'], ['time_dusk', 'Dusk multiplier (18–21h)'], ['time_night', 'Night multiplier (21–06h)'], ['advisory_floor', 'Advisory minimum score'],
      ['alert_lookahead_s', 'Warn this many seconds ahead'], ['reports_per_hour', 'Reports per user per hour']
    ].map(([k, l]) => `<tr><td>${l}</td><td style="width:90px;text-align:right"><input data-set="${k}" value="${esc(s[k] ?? '')}" style="width:80px"></td></tr>`).join('')}</table>
    <button class="btn block" id="bSaveSet" style="margin-top:8px">Save rules</button>
  </div>`;
}
function renderPanel() {
  const p = $('#panel');
  p.innerHTML = S.tab === 'moderate' ? moderatePanel() : S.tab === 'security' ? securityPanel() : S.tab === 'admin' ? adminPanel() : mapPanel();
  bindPanel(); update();
}
function bindPanel() {
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
  on('bGps', 'click', () => { if (S.mode === 'gps') { stopGps(); S.mode = 'none'; renderPanel(); } else startGps(); });
  on('bPlace', 'click', () => startPick('place-me', 'Tap the map to put yourself there'));
  on('bReport', 'click', () => { audio(); reportStart(); });
  on('hour', 'input', e => { S.planHour = +e.target.value; $('#hourLbl').textContent = fmtHour(S.planHour); S.lastLevel = Math.min(S.lastLevel, 0); drawTestRoute(); update(); });
  on('hour', 'change', () => renderPanel());
  on('hourNow', 'click', () => { S.planHour = null; drawTestRoute(); renderPanel(); });
  on('tWarn', 'change', e => { S.warn = e.target.checked; store.set('warn', S.warn); if (!S.warn) try { speechSynthesis.cancel(); } catch (x) {} });
  on('tVoice', 'change', e => { S.voice = e.target.checked; store.set('voice', S.voice); });
  on('tTour', 'change', e => { S.tourist = e.target.checked; store.set('tourist', S.tourist); S.lastLevel = 0; audio(); drawTestRoute(); update(); if (S.tourist) announce('Tourist Mode on. I will warn you earlier about unsafe places.', '#22c55e', 'chime'); });
  on('tDriver', 'change', e => setDriver(e.target.checked));
  on('bTest', 'click', () => { audio(); const w = S.warn; S.warn = true; announce('Warning. High-risk area. Nearest security post is 4 kilometres ahead. Avoid stopping.', '#ef4444', 'high'); S.warn = w; });
  on('bTestDrive', 'click', () => { if (S.mode === 'test') { stopTest(); renderPanel(); } else startTest(); });
  on('bTestEnd', 'click', () => { stopTest(); S.test = null; S.mode = 'none'; S.pos = null; map.removeLayer(meMarker); drawTestRoute(); renderPanel(); });
  on('bAdv', 'click', () => startPick('advisory', 'Tap the map where the advisory applies'));
  on('bAddPlace', 'click', () => startPick('place', 'Tap the map where the place is'));
  on('bAddZone', 'click', () => startPick('zone', 'Tap the centre of the zone'));
  on('bSaveTypes', 'click', async () => {
    try {
      for (const t of Object.values(S.data.types)) {
        const w = $(`[data-tw="${t.key}"]`).value, r = $(`[data-tr="${t.key}"]`).value, ttl = $(`[data-tt="${t.key}"]`).value;
        if (+w !== t.weight || +r !== t.radius_km || +ttl !== t.ttl_hours) await api('/api/types/' + t.key, { method: 'PUT', body: { weight: w, radius_km: r, ttl_hours: ttl } });
      }
      toast('Weights saved'); load();
    } catch (e) { toast(e.message); }
  });
  on('bSaveSet', 'click', async () => {
    const body = {}; $$('[data-set]').forEach(i => { body[i.dataset.set] = i.value; });
    try { await api('/api/settings', { method: 'PUT', body }); toast('Rules saved'); load(); } catch (e) { toast(e.message); }
  });
  const P = $('#panel');
  const act = (sel, fn) => P.querySelectorAll(sel).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'click', async () => { try { await fn(el); } catch (e) { toast(e.message); } }));
  act('[data-zoom]', el => { S.follow = false; map.setView(el.dataset.zoom.split(',').map(Number), 15); if (window.innerWidth < 860) $('#mapwrap').scrollIntoView({ behavior: 'smooth' }); });
  act('[data-mod]', async el => { const sel = P.querySelector(`[data-retype="${el.dataset.id}"]`); await api(`/api/reports/${el.dataset.id}/moderate`, { method: 'POST', body: { action: el.dataset.mod, type: sel ? sel.value : undefined } }); toast({ approve: 'Approved — now live for everyone', reject: 'Rejected', expire: 'Removed from the map' }[el.dataset.mod]); S.lastLevel = 0; load(); });
  act('[data-retype]', async el => { await api(`/api/reports/${el.dataset.retype}/moderate`, { method: 'POST', body: { action: 'retype', type: el.value } }); load(); });
  act('[data-resp]', async el => { await api(`/api/reports/${el.dataset.id}/respond`, { method: 'POST', body: { responding: el.dataset.resp === '1' } }); toast(el.dataset.resp === '1' ? 'Travellers now see “Security responding”' : 'Updated'); load(); });
  act('[data-clear]', async el => { await api(`/api/reports/${el.dataset.clear}/clear`, { method: 'POST' }); toast('Cleared — removed from everyone’s map'); load(); });
  act('[data-confirm]', async el => { await api(`/api/reports/${el.dataset.confirm}/confirm`, { method: 'POST' }); toast('Confirmed and published as Official'); S.lastLevel = 0; load(); });
  act('[data-sos]', async el => { await api(`/api/sos/${el.dataset.id}`, { method: 'POST', body: { status: el.dataset.sos } }); loadSos(); });
  act('[data-verify]', async el => { await api(`/api/admin/users/${el.dataset.verify}`, { method: 'POST', body: { role: 'security', security_status: 'verified' } }); toast('Verified'); loadAdmin(); });
  act('[data-unverify]', async el => { await api(`/api/admin/users/${el.dataset.unverify}`, { method: 'POST', body: { security_status: 'rejected' } }); loadAdmin(); });
  act('[data-role]', async el => { await api(`/api/admin/users/${el.dataset.role}`, { method: 'POST', body: { role: el.value } }); toast('Role updated'); loadAdmin(); });
  act('[data-ban]', async el => { await api(`/api/admin/users/${el.dataset.ban}`, { method: 'POST', body: { banned: el.dataset.val === '1' } }); loadAdmin(); });
  act('[data-delplace]', async el => { await api('/api/places/' + el.dataset.delplace, { method: 'DELETE' }); toast('Place removed'); load(); });
  act('[data-delzone]', async el => { await api('/api/zones/' + el.dataset.delzone, { method: 'DELETE' }); toast('Zone removed'); load(); });
}

// ---------------- driver mode, SOS, account ----------------
function setDriver(on) { S.driver = on; $('#driver').classList.toggle('show', on); const t = $('#tDriver'); if (t) t.checked = on; if (on && S.mode === 'none') toast('Press Start so Driver Mode can follow your location'); update(); }
$('#dExit').onclick = () => setDriver(false);
$('#dReport').onclick = () => {
  if (!S.user) return authModal('Sign in to send reports');
  if (!S.pos) return toast('Location is off');
  const keys = ['flood', 'tree', 'truck', 'accident', 'pothole', 'robbery'].filter(k => S.data.types[k]);
  modal(`<h2>Quick report</h2><p>One tap. Your current position is used.</p><div class="grid2" style="margin-top:12px">${keys.map(k => `<button class="btn block" data-q="${k}" style="padding:14px">${S.data.types[k].icon} ${esc(S.data.types[k].label)}</button>`).join('')}</div><div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button></div>`);
  $$('[data-q]').forEach(b => b.onclick = async () => {
    const fd = new FormData(); fd.append('type', b.dataset.q); fd.append('lat', S.pos[0]); fd.append('lng', S.pos[1]); fd.append('note', 'Quick report from a driver');
    try { await api('/api/reports', { method: 'POST', form: fd }); closeModal(); toast('Reported — thank you'); load(); } catch (e) { toast(e.message); }
  });
};
let sosTimer = null;
$('#sos').onclick = () => {
  audio();
  if (S.sosActive) {
    return modal(`<h2 style="color:#f87171">SOS is active</h2><p>Your location is being shared with verified security near you every 30 seconds.</p>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Keep active</button><button class="btn danger" id="sCancel">Cancel SOS</button></div>`),
      $('#sCancel').onclick = async () => { try { await api('/api/sos/cancel', { method: 'POST' }); } catch (e) {} S.sosActive = false; clearInterval(sosTimer); $('#sos').classList.remove('active'); closeModal(); toast('SOS cancelled'); };
  }
  const k = S.pos ? compute(S.pos, travelHour(), S.data) : null;
  modal(`<h2 style="color:#f87171">Send SOS?</h2>
    <p>This shares your live location with verified security accounts near you until you cancel it.</p>
    ${k && k.post ? `<div class="card"><div class="t">👮 ${esc(k.post.place.name)}</div><p>${fmtKm(k.post.d)} away${k.post.place.phone ? ' · ' + esc(k.post.place.phone) : ''}</p></div>` : ''}
    <div class="card"><div class="t">📞 Call for help</div><p>112 — national emergency number</p></div>
    <div class="err" id="sErr"></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn danger" id="sSend">Send SOS now</button></div>`);
  $('#sSend').onclick = async () => {
    if (!S.user) { closeModal(); return authModal('Sign in so security knows who needs help. In immediate danger, call 112.'); }
    if (!S.pos) { $('#sErr').textContent = 'Location is off. Press Start first, or call 112.'; return; }
    try {
      await api('/api/sos', { method: 'POST', body: { lat: S.pos[0], lng: S.pos[1] } });
      S.sosActive = true; $('#sos').classList.add('active'); closeModal(); toast('SOS sent. Keep the app open.', 5000);
      clearInterval(sosTimer); sosTimer = setInterval(() => { if (S.pos) api('/api/sos', { method: 'POST', body: { lat: S.pos[0], lng: S.pos[1] } }).catch(() => {}); }, 30000);
    } catch (e) { $('#sErr').textContent = e.message; }
  };
};
$('#btnAccount').onclick = () => {
  if (!S.user) return authModal();
  const u = S.user;
  modal(`<h2>${esc(u.name)}</h2><p>${esc(u.email)}<br>Role: <b>${esc(u.role)}</b>${u.security_status ? ` · Security status: <b>${esc(u.security_status)}</b>` : ''}</p>
    ${u.security_status === 'pending' ? '<p class="small">An admin will verify your security account. You will then see the Security tab.</p>' : ''}
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-close>Close</button><button class="btn" id="bLogout">Sign out</button></div>`);
  $('#bLogout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); S.user = null; S.tab = 'map'; closeModal(); toast('Signed out'); load(); };
};
$('#btnLayer').onclick = () => { S.sat = !S.sat; store.set('sat', S.sat); setBase(); };
$('#btnFollow').onclick = () => { if (!S.pos) return toast('Location is off'); S.follow = true; map.setView(S.pos, 15); };

// ---------------- modal + toast ----------------
let onModalClose = null;
function modal(html, onClose) { $('#modalBox').innerHTML = html; $('#modal').classList.add('show'); onModalClose = onClose || null; $$('#modalBox [data-close]').forEach(b => b.onclick = closeModal); }
function closeModal() { $('#modal').classList.remove('show'); if (onModalClose) { const f = onModalClose; onModalClose = null; f(); } }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
let tt = null;
function toast(m, ms) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => t.style.display = 'none', ms || 2800); }

// ---------------- start ----------------
load();
setInterval(() => { if (!document.hidden) load(); }, 30000);
setInterval(() => { if (S.mode !== 'test') update(); }, 60000); // live clock moves into dusk / night
setInterval(() => { if (!document.hidden && isSecurity()) loadSos(); }, 15000);
window.addEventListener('online', load);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
