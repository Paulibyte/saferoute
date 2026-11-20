// Nigeria administrative hierarchy: 37 states (incl. FCT) and 774 Local Government Areas.
// Boundaries: geoBoundaries / GRID3 Nigeria LGA boundaries 2022, CC BY 4.0 (simplified to about 250 m).
const path = require('path');
const data = require(path.join(__dirname, '..', 'shared', 'ng-admin.json'));

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(x, y, poly) { // poly = [outer, hole, hole...]
  if (!inRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false;
  return true;
}
function inGeom(x, y, g) {
  if (g.type === 'Polygon') return inPolygon(x, y, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => inPolygon(x, y, p));
  return false;
}
const km = (a, b) => { const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };

const LGAS = data.lgas, STATES = data.states.map(s => s.name).sort();
const byId = new Map(LGAS.map(l => [l.id, l]));
const cache = new Map();

// → { lga_id, lga, state } or null when outside Nigeria (more than 5 km from any LGA)
function locate(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (cache.has(key)) return cache.get(key);
  let hit = null;
  for (const l of LGAS) {
    const b = l.bbox;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inGeom(lng, lat, l.geom)) { hit = l; break; }
  }
  if (!hit) { // on a simplified edge or just offshore: nearest LGA centre within 5 km of its box
    let best = null, bd = Infinity;
    for (const l of LGAS) { const b = l.bbox; if (lng < b[0] - 0.05 || lng > b[2] + 0.05 || lat < b[1] - 0.05 || lat > b[3] + 0.05) continue; const d = km([lat, lng], l.c); if (d < bd) { bd = d; best = l; } }
    hit = best;
  }
  const out = hit ? { lga_id: hit.id, lga: hit.name, state: hit.state } : null;
  if (cache.size > 20000) cache.clear();
  cache.set(key, out);
  return out;
}
const lgaById = id => byId.get(+id) || null;
const lgasOf = state => LGAS.filter(l => l.state === state);
const statesGeo = () => ({ type: 'FeatureCollection', source: data.source, features: data.states.map(s => ({ type: 'Feature', properties: { name: s.name, c: s.c }, geometry: s.geom })) });
const lgasGeo = state => ({ type: 'FeatureCollection', source: data.source, features: lgasOf(state).map(l => ({ type: 'Feature', properties: { id: l.id, name: l.name, state: l.state, c: l.c }, geometry: l.geom })) });

module.exports = { locate, lgaById, lgasOf, statesGeo, lgasGeo, STATES, LGAS, source: data.source };
