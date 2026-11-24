// Security helpers: headers, CSRF, rate limits, login throttling, password rules, TOTP two-step verification,
// encryption of secrets at rest, and the audit log.
const crypto = require('crypto');

module.exports = function (db, secret) {
  const now = () => Date.now();

  // ---------- encryption key for secrets stored in the database (TOTP seeds) ----------
  const KEY = crypto.createHash('sha256').update(process.env.APP_SECRET || secret('app_key', () => crypto.randomBytes(32).toString('hex'))).digest();
  function encrypt(text) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
  }
  function decrypt(s) {
    const [iv, tag, enc] = s.split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  }

  // ---------- security headers ----------
  function headers(secure) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://server.arcgisonline.com https://*.tile.openstreetmap.org",
      "media-src 'self' blob:",
      "connect-src 'self' https://server.arcgisonline.com https://*.tile.openstreetmap.org",
      "font-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ');
    // The Android app (Capacitor) injects its native bridge as an inline script into our pages,
    // so inline scripts are allowed only for requests from that app's WebView.
    const appCsp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    return (req, res, next) => {
      res.setHeader('Content-Security-Policy', /SafeRouteAndroid\//.test(req.get('user-agent') || '') ? appCsp : csp);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=()');
      if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      next();
    };
  }

  // ---------- CSRF: double-submit cookie + Origin check ----------
  function csrf(secure, exempt) {
    return (req, res, next) => {
      let tok = req.cookies.sr_csrf;
      if (!tok || tok.length < 20) {
        tok = crypto.randomBytes(24).toString('base64url');
        res.cookie('sr_csrf', tok, { sameSite: 'lax', secure, httpOnly: false, maxAge: 365 * 864e5 });
      }
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || exempt.some(p => req.path.startsWith(p))) return next();
      const origin = req.get('origin');
      if (origin) {
        try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Request blocked (cross-site)' }); } catch (e) { return res.status(403).json({ error: 'Request blocked' }); }
      }
      if (req.get('x-csrf-token') !== req.cookies.sr_csrf || !req.cookies.sr_csrf) return res.status(403).json({ error: 'Your session token expired. Refresh the page and try again.' });
      next();
    };
  }

  // ---------- rate limiting (fixed window, in memory) ----------
  const buckets = new Map();
  function hit(key, max, windowMs) {
    const t = now(); let b = buckets.get(key);
    if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
    b.n++;
    return b.n <= max ? 0 : Math.ceil((b.reset - t) / 1000);
  }
  setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60000).unref();
  function limit(name, max, windowMs, keyFn) {
    return (req, res, next) => {
      const wait = hit(name + ':' + (keyFn ? keyFn(req) : req.ip), max, windowMs);
      if (wait) { res.setHeader('Retry-After', wait); return res.status(429).json({ error: `Too many requests. Try again in ${wait > 90 ? Math.ceil(wait / 60) + ' minutes' : wait + ' seconds'}.` }); }
      next();
    };
  }

  // ---------- login throttling ----------
  const fails = new Map();
  function loginBlocked(email, ip) {
    const f = fails.get(email + '|' + ip) || fails.get('ip|' + ip);
    if (!f) return 0;
    const t = now();
    for (const k of [email + '|' + ip, 'ip|' + ip]) {
      const x = fails.get(k);
      if (x && x.until > t) return Math.ceil((x.until - t) / 60000);
    }
    return 0;
  }
  function loginFailed(email, ip) {
    const t = now();
    for (const [k, max, lockMin] of [[email + '|' + ip, 5, 15], ['ip|' + ip, 30, 60]]) {
      let x = fails.get(k);
      if (!x || x.first < t - 15 * 60000) x = { n: 0, first: t, until: 0 };
      x.n++; if (x.n >= max) x.until = t + lockMin * 60000;
      fails.set(k, x);
    }
  }
  function loginOk(email, ip) { fails.delete(email + '|' + ip); }

  // ---------- password rules ----------
  const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'abc12345', 'password123', 'iloveyou1', 'nigeria123', 'admin123', 'welcome1', 'letmein1', 'passw0rd']);
  function passwordProblem(pw, staff) {
    pw = String(pw || '');
    const min = staff ? 10 : 8;
    if (pw.length < min) return `Password must be at least ${min} characters`;
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
    if (COMMON.has(pw.toLowerCase())) return 'That password is too common — choose another';
    return null;
  }

  // ---------- TOTP (RFC 6238), compatible with Google Authenticator, Microsoft Authenticator, Authy ----------
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32encode(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; }
  function b32decode(s) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
  function hotp(key, counter) {
    const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', key).update(buf).digest();
    const o = h[h.length - 1] & 15;
    return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
  }
  const newTotpSecret = () => b32encode(crypto.randomBytes(20));
  // returns the time-step used, or -1
  function totpCheck(secretB32, code, lastUsed) {
    code = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return -1;
    const key = b32decode(secretB32), step = Math.floor(now() / 30000);
    for (const d of [0, -1, 1]) {
      const c = step + d;
      if (lastUsed && c <= lastUsed) continue; // no replay
      if (crypto.timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(code))) return c;
    }
    return -1;
  }

  // ---------- audit log ----------
  function audit(req, action, targetType, targetId, detail) {
    try {
      const u = req && req.user;
      db.prepare(`INSERT INTO audit_log (at,user_id,role,action,target_type,target_id,detail,ip) VALUES (?,?,?,?,?,?,?,?)`)
        .run(now(), u ? u.id : null, u ? (u._real_role || u.role) : null, action, targetType || null, targetId == null ? null : +targetId, detail ? JSON.stringify(detail).slice(0, 2000) : null, req ? req.ip : null);
    } catch (e) { console.error('audit failed', e.message); }
  }

  return { encrypt, decrypt, headers, csrf, limit, hit, loginBlocked, loginFailed, loginOk, passwordProblem, newTotpSecret, totpCheck, b32encode, audit };
};
