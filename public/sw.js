// SafeRoute service worker: app works offline with the last data it saw, and keeps recently viewed map tiles.
const VERSION = 'sr-v1';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/risk.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const MAX_TILES = 1500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'sr-tiles' && k !== 'sr-data').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open('sr-tiles');
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // map tiles: cache first, refresh in background
  if (/arcgisonline\.com|tile\.openstreetmap\.org/.test(url.host)) {
    e.respondWith(caches.open('sr-tiles').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); } return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // map data: network first, fall back to the last copy
  if (url.pathname === '/api/bootstrap') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open('sr-data').then(c => c.put('/api/bootstrap', copy)); return res; })
      .catch(() => caches.open('sr-data').then(c => c.match('/api/bootstrap')).then(r => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // app files: network first so updates show quickly, cache as fallback
  e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('/'))));
});
