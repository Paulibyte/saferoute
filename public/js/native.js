/* SafeRoute Android bridge.
   In the Android app (Capacitor shell, user agent contains "SafeRouteAndroid") this adds:
   - GPS that keeps running with the screen off (a visible "SafeRoute is using your location" notification),
   - location updates sent through native HTTP so Android doesn't throttle them in the background,
   - Firebase push notifications, Android back button, notification taps.
   On the website this file does nothing. */
(function () {
  'use strict';
  const isNative = /SafeRouteAndroid/.test(navigator.userAgent);
  const N = window.SRNative = { isNative, ready: Promise.resolve(false), hasPush: false, version: '' };
  if (!isNative) return;

  N.ready = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/vendor/capacitor/capacitor.js';
    s.onload = async () => {
      try {
        const C = window.capacitorExports;
        const reg = name => C.registerPlugin(name);
        N.Geo = reg('BackgroundGeolocation'); N.Push = reg('PushNotifications'); N.App = reg('App'); N.Http = C.CapacitorHttp;
        try { const info = await N.App.getInfo(); N.version = info.version || ''; N.hasPush = !/-nopush/.test(N.version); } catch (e) {}
        const listen = (pl, ev, fn) => { try { Promise.resolve(pl.addListener(ev, fn)).catch(() => {}); } catch (e) {} };
        N.listen = listen;
        listen(N.App, 'backButton', () => { if (!(N.onBack && N.onBack())) N.App.minimizeApp().catch(() => {}); });
        listen(N.App, 'appStateChange', st => { if (st.isActive && N.onResume) N.onResume(); });
        document.documentElement.classList.add('native-android');
        resolve(true);
      } catch (e) { console.warn('native bridge', e); resolve(false); }
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });

  // ---- location ----
  let watcher = null, notifAsked = false;
  N.startLocation = async (onFix, onError) => {
    if (!(await N.ready)) return false;
    await N.stopLocation();
    // Android 13+: the location notification needs notification permission to be visible
    if (!notifAsked) { notifAsked = true; try { const p = await N.Push.checkPermissions(); if (p.receive === 'prompt') await N.Push.requestPermissions(); } catch (e) {} }
    try {
      watcher = await N.Geo.addWatcher({
        backgroundTitle: 'SafeRoute is watching your route',
        backgroundMessage: 'Location stays on for danger warnings, journeys and SOS. Turn it off in the app.',
        requestPermissions: true, stale: false, distanceFilter: 10
      }, (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') onError({ code: 1 }, () => N.Geo.openSettings());
          else onError({ code: 2 });
          return;
        }
        if (loc) onFix({ latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, speed: loc.speed, heading: loc.bearing });
      });
      return true;
    } catch (e) { onError({ code: 2 }); return false; }
  };
  N.stopLocation = async () => {
    if (watcher == null) return;
    const id = watcher; watcher = null;
    try { await N.Geo.removeWatcher({ id }); } catch (e) {}
  };
  N.openLocationSettings = () => N.ready.then(ok => ok && N.Geo.openSettings());

  // Location updates while the app is in the background use a per-device beacon token and native HTTP
  // (the WebView's own requests are throttled after a few minutes in the background).
  let beacon = null;
  const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)sr_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; };
  async function beaconToken() {
    if (beacon) return beacon;
    try { beacon = sessionStorage.getItem('sr_beacon'); } catch (e) {}
    if (beacon) return beacon;
    const r = await fetch('/api/beacon/token', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf() } });
    if (!r.ok) throw new Error('beacon');
    beacon = (await r.json()).token;
    try { sessionStorage.setItem('sr_beacon', beacon); } catch (e) {}
    return beacon;
  }
  N.prepareBeacon = () => N.ready.then(ok => ok && beaconToken()).catch(() => {});
  N.forgetBeacon = () => { beacon = null; try { sessionStorage.removeItem('sr_beacon'); } catch (e) {} };
  N.sendBeacon = async body => {
    if (!(await N.ready)) throw new Error('no bridge');
    const token = await beaconToken();
    const r = await N.Http.request({ url: location.origin + '/api/beacon', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Beacon': token }, data: body });
    if (r.status === 401) { N.forgetBeacon(); throw new Error('beacon expired'); }
    if (r.status >= 400) throw new Error('beacon ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data || '{}') : r.data;
  };

  // ---- push (Firebase Cloud Messaging) ----
  let pushWired = false;
  N.pushStatus = async () => {
    if (!(await N.ready) || !N.hasPush) return 'unavailable';
    try { const p = await N.Push.checkPermissions(); return p.receive; } catch (e) { return 'unavailable'; }
  };
  N.enablePush = async ({ onToken, onTap, onReceive, ask }) => {
    if (!(await N.ready)) return 'unavailable';
    if (!N.hasPush) return 'unavailable';
    let p; try { p = await N.Push.checkPermissions(); } catch (e) { return 'unavailable'; }
    if (p.receive === 'prompt' && ask) p = await N.Push.requestPermissions();
    if (p.receive !== 'granted') return p.receive;
    if (!pushWired) {
      pushWired = true;
      try {
        await N.Push.createChannel({ id: 'sos', name: 'Emergency alerts', description: 'SOS, missed check-ins and journey alerts', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#DC2626' });
        await N.Push.createChannel({ id: 'alerts', name: 'Safety alerts', description: 'Community warnings and updates', importance: 4, visibility: 1, vibration: true });
      } catch (e) {}
      N.listen(N.Push, 'registration', t => onToken && onToken(t.value));
      N.listen(N.Push, 'registrationError', e => console.warn('push registration', e));
      N.listen(N.Push, 'pushNotificationActionPerformed', a => onTap && onTap((a.notification && a.notification.data) || {}));
      N.listen(N.Push, 'pushNotificationReceived', n => onReceive && onReceive(n));
    }
    try { await N.Push.register(); } catch (e) { return 'unavailable'; }
    return 'granted';
  };
})();
