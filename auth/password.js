// Shared-password authentication.
//
// Operator sets DASHBOARD_PASSWORD in .env and SESSION_SECRET (32+ bytes).
// User visits the dashboard, gets redirected to a tiny login form, enters
// the password, and gets a signed cookie session. requireAuth validates
// the cookie.
//
// The password is compared with `crypto.timingSafeEqual` to prevent
// timing-based brute-force. A constant-time string comparison is
// approximated by hashing both sides with SHA-256 and comparing the
// digests (constant-length, constant-time).

import cookieSession from 'cookie-session';
import express from 'express';
import { createHash, scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { createAuthLimiter } from './limiters.js';

export const PASSWORD_COOKIE_NAME = 'd4td.sid';

const SCRYPT_N = 16384; // 2^14 — ~50 ms en Pi 4, adecuado para uso personal
const SCRYPT_KEY_LEN = 32;

// Genera un hash almacenable. Uso: node scripts/hash-password.mjs <password>
export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N });
  return `$scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (stored.startsWith('$scrypt$')) {
    const parts = stored.slice(8).split('$');
    if (parts.length !== 2) return false;
    try {
      const salt = Buffer.from(parts[0], 'hex');
      const expected = Buffer.from(parts[1], 'hex');
      if (expected.length !== SCRYPT_KEY_LEN) return false;
      const candidate = scryptSync(plain, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N });
      return timingSafeEqual(candidate, expected);
    } catch {
      return false;
    }
  }
  // Fallback para passwords en texto plano (versiones anteriores).
  // Upgrade: node scripts/hash-password.mjs <password> → pegar en DASHBOARD_PASSWORD.
  const ha = createHash('sha256').update(String(plain)).digest();
  const hb = createHash('sha256').update(String(stored)).digest();
  return timingSafeEqual(ha, hb);
}

function loginPageHtml(error) {
  // Minimal, no JS, no external assets. Compatible with the strict CSP.
  const err = error ? `<p style="color:#f88">${error}</p>` : '';
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>display4theday — login</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0d1b2a; color: #fff;
         display: flex; align-items: center; justify-content: center;
         height: 100vh; margin: 0; }
  form { background: #1b2a3f; padding: 2rem 2.5rem; border-radius: 12px;
         min-width: 280px; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
  h1 { margin: 0 0 1rem; font-size: 1.2rem; font-weight: 500; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .7rem;
          background: #0d1b2a; color: #fff; border: 1px solid #2a3a55;
          border-radius: 6px; font-size: 1rem; margin-bottom: .8rem; }
  button { width: 100%; padding: .6rem; background: #1d72e8; color: #fff;
           border: 0; border-radius: 6px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #2680f0; }
  .err { color: #f88; margin: 0 0 1rem; font-size: .9rem; }
</style>
</head><body>
<form method="post" action="/auth/login">
  <h1>display4theday</h1>
  ${err}
  <input type="password" name="password" placeholder="Contraseña" required autofocus />
  <button type="submit">Entrar</button>
</form>
</body></html>`;
}

export function createPasswordAuth(opts = {}) {
  const password = opts.password;
  const sessionSecret = opts.sessionSecret;
  const cookieSecure = !!opts.cookieSecure;
  const dataDir = opts.dataDir || process.env.DATA_DIR || process.cwd();
  // dataDir is reserved for future use (e.g. session-id server-side store).
  // The current implementation is stateless, so we don't need it now.
  void dataDir;

  if (!password) {
    throw new Error('AUTH_MODE=password but DASHBOARD_PASSWORD is not set');
  }
  if (!password.startsWith('$scrypt$')) {
    console.warn(
      '[auth] DASHBOARD_PASSWORD es texto plano. Genera un hash seguro con:\n' +
        '  node scripts/hash-password.mjs <password>\n' +
        'y actualiza DASHBOARD_PASSWORD en .env'
    );
  }
  if (!sessionSecret) {
    throw new Error('AUTH_MODE=password but SESSION_SECRET is not set');
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    throw new Error(
      'AUTH_MODE=password but SESSION_SECRET is shorter than 32 bytes. Generate one with: openssl rand -hex 32'
    );
  }

  function mountOn(app) {
    // Parse JSON and urlencoded bodies on the auth routes so the login
    // handler can read `req.body.password` whether the client posts a
    // JSON fetch (XHR) or a classic <form method="post">.
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    // CRIT-7: rate limit just the login endpoint (brute-force vector).
    // Logout and user-info are not protected — they don't accept secrets.
    const loginLimiter = createAuthLimiter();
    app.use('/auth/login', loginLimiter);

    app.use(
      cookieSession({
        name: PASSWORD_COOKIE_NAME,
        keys: [sessionSecret],
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
      })
    );

    // POST /auth/login — accepts JSON or form-encoded
    app.post('/auth/login', (req, res) => {
      const submitted = (req.body?.password ?? '').toString();
      if (!submitted || !verifyPassword(submitted, password)) {
        // Render the login page again with an error. We respond as HTML
        // when the request looks like a form submit (Content-Type
        // application/x-www-form-urlencoded or no Accept for JSON).
        const accept = req.headers.accept || '';
        if (accept.includes('application/json')) {
          return res.status(401).json({ error: 'invalid_password' });
        }
        return res.status(401).type('html').send(loginPageHtml('Contraseña incorrecta'));
      }
      req.session = null;
      req.session = { user: { sub: 'shared', name: 'Dashboard' } };
      const returnTo = validateSafePath(req.query?.returnTo);
      res.redirect(returnTo);
    });

    // GET /auth/login — render the login form
    app.get('/auth/login', (req, res) => {
      res.type('html').send(loginPageHtml(null));
    });

    // GET /auth/logout — clear the cookie
    app.get('/auth/logout', (req, res) => {
      req.session = null;
      res.redirect('/');
    });

    // GET /auth/user — diagnostic (returns current user)
    app.get('/auth/user', (req, res) => {
      res.json({ user: req.session?.user || null });
    });
  }

  function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    const returnTo = req.originalUrl || '/';
    res.redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return {
    enabled: true,
    modeLabel: 'password (shared)',
    mountOn,
    requireAuth,
  };
}

// Only allow same-origin absolute paths.
const RETURN_TO_RE = /^\/(?!\/)/;
function validateSafePath(raw) {
  return typeof raw === 'string' && RETURN_TO_RE.test(raw) ? raw : '/';
}
