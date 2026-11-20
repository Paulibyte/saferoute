(function () {
  const token = location.pathname.split('/').pop();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = ms => { const m = (Date.now() - ms) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : Math.round(m / 60) + ' h ago'; };
  const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const map = L.map('map').setView([9.07, 7.49], 6);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
  const me = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
  const trail = L.polyline([], { color: '#ef4444', weight: 4 }).addTo(map);
  let routeDrawn = false, first = true;
  async function tick() {
    let d;
    try { const r = await fetch('/api/track/' + encodeURIComponent(token)); d = await r.json(); if (!r.ok) throw new Error(d.error || 'Not available'); }
    catch (e) { document.getElementById('hdr').innerHTML = `<h1>Shared location</h1><div class="banner b-end">${esc(e.message)}</div>`; return; }
    const s = d.sos;
    let banner;
    if (s && s.duress && s.status !== 'closed') banner = `<div class="banner b-duress">⚠️ Silent duress alert: ${esc(d.name)} may be under pressure. Treat this as an active emergency and contact the authorities (112).</div>`;
    else if (s && s.status !== 'closed') banner = `<div class="banner b-sos">🆘 ${esc(d.name)} sent an SOS: ${esc(s.type)} · Ref ${esc(s.ref)}</div>`;
    else if (s) banner = `<div class="banner b-end">This SOS has been closed.</div>`;
    else if (d.journey && d.journey.status === 'escalated') banner = `<div class="banner b-duress">⚠️ Missed check-in: ${esc(d.name)} has not confirmed arrival${d.journey.dest_name ? ' at ' + esc(d.journey.dest_name.split(',')[0]) : ''}. This is not an SOS — try calling them first. If you cannot reach them and are worried, call 112.</div>`;
    else if (d.journey && d.journey.status === 'arrived') banner = `<div class="banner b-ok">🏁 ${esc(d.name)} has arrived${d.journey.dest_name ? ' at ' + esc(d.journey.dest_name.split(',')[0]) : ''}.</div>`;
    else if (d.journey && d.active) banner = `<div class="banner b-ok">🚗 ${esc(d.name)} is travelling${d.journey.dest_name ? ' to ' + esc(d.journey.dest_name.split(',')[0]) : ''} · expected ${hhmm(d.journey.expected_arrival)}${d.journey.off_route ? ' · currently off the planned route' : ''}</div>`;
    else if (d.active) banner = `<div class="banner b-ok">👥 ${esc(d.name)} is sharing their journey${d.dest_name ? ' to ' + esc(d.dest_name) : ''} with you.</div>`;
    else banner = `<div class="banner b-end">${esc(d.name)} has stopped sharing.</div>`;
    const evs = s ? s.events : d.journey ? d.journey.events.slice(-6) : [];
    const events = evs.length ? `<ul>${evs.map(e => `<li><span>${hhmm(e.at)}</span>${esc(e.text)}</li>`).join('')}</ul>` : '';
    document.getElementById('hdr').innerHTML = `<h1>${s ? 'Emergency alert' : 'Live location'}</h1>${banner}
      <div class="sub">${d.last ? 'Last updated ' + ago(d.last.at) : 'Waiting for location…'}</div>${events}
      <div class="row">${s && s.status !== 'closed' ? '<a class="btn red" href="tel:112">Call 112</a>' : ''}${d.last ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${d.last.lat},${d.last.lng}">Directions</a>` : ''}</div>
      ${s ? '<div class="sub" style="margin-top:8px">If you cannot reach them, call 112 and give the reference number above.</div>' : ''}`;
    if (d.route && !routeDrawn) { L.polyline(d.route, { color: '#60a5fa', weight: 4, dashArray: '6 8' }).addTo(map); routeDrawn = true; }
    trail.setLatLngs(d.points.map(p => [p.lat, p.lng]));
    if (d.last) { me.setLatLng([d.last.lat, d.last.lng]).addTo(map); if (first) { map.setView([d.last.lat, d.last.lng], 15); first = false; } }
  }
  tick(); setInterval(tick, 10000);
})();
