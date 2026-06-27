// Keycloak (OIDC) authentication middleware for Express.
//
// When `enabled=false`, the exported middleware is a no-op (`next()` always)
// and no auth routes are mounted. This keeps the "no-auth" mode of the app
// working without any Keycloak configuration.
//
// When `enabled=true`, the factory:
//   - Mounts cookie-session for signed session cookies.
//   - Mounts /auth/keycloak/login, /auth/keycloak/callback and
//     /auth/keycloak/logout.
//   - Exposes a `requireAuth` middleware that 302s unauthenticated requests
//     to the login route (preserving the original URL in `returnTo`).
//
// Configuration (all required when enabled=true):
//   issuer         e.g. https://localhost:8443/realms/display4theday
//   clientId       OIDC client id
//   clientSecret   OIDC client secret (confidential client)
//   redirectUri    e.g. https://localhost:3000/auth/keycloak/callback
//   sessionSecret  32+ random bytes for signing the session cookie
//   cookieSecure   boolean, true when serving over HTTPS
//   scopes         optional, default 'openid profile email'
//   maxAge         optional, default 8h. Forces re-login after this many seconds.

import * as oidc from 'openid-client';
import cookieSession from 'cookie-session';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createAuthLimiter } from './limiters.js';

export const AUTH_COOKIE_NAME = 'd4td.sid';

// Only allow same-origin paths to be used as post-login redirect targets.
// Rejects absolute URLs, protocol-relative URLs (`//evil.com`), and empty
// strings. Falls back to `/` when the input is missing or invalid.
const RETURN_TO_RE = /^\/(?!\/)/;
export function validateReturnTo(raw) {
  return typeof raw === 'string' && RETURN_TO_RE.test(raw) ? raw : '/';
}

// ── id_token server-side store (MED-4) ────────────────────────────────────
// The id_token JWT can be several KB; storing it in the cookie pushes the
// cookie close to the 4 KB browser limit. We persist a map of
// sessionId -> id_token in <DATA_DIR>/id-tokens.json (mode 0o600).
function makeIdTokenStore(dataDir) {
  const file = join(dataDir, 'id-tokens.json');
  function read() {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }
  function write(map) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(map, null, 2), { mode: 0o600 });
  }
  return {
    set(sessionId, idToken) {
      const map = read();
      map[sessionId] = idToken;
      write(map);
    },
    get(sessionId) {
      return read()[sessionId] || null;
    },
    clear(sessionId) {
      const map = read();
      delete map[sessionId];
      write(map);
    },
  };
}

export function createAuthMiddleware(opts = {}) {
  // Note: the orchestrator in ./index.js handles the "disabled" case.
  // When this function is called, auth is enabled (keycloak mode).

  const {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    cookieSecure = true,
    scopes = 'openid profile email',
    maxAge = 8 * 60 * 60,
    dataDir = process.env.DATA_DIR || process.cwd(),
  } = opts;

  const missing = ['issuer', 'clientId', 'clientSecret', 'redirectUri', 'sessionSecret'].filter(
    (k) => !opts[k]
  );
  if (missing.length) {
    throw new Error(`AUTH_ENABLED=true but missing config: ${missing.join(', ')}`);
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    throw new Error(
      'AUTH_ENABLED=true but SESSION_SECRET is shorter than 32 bytes. Generate one with: openssl rand -hex 32'
    );
  }

  // LOW-17: retry with backoff so a transient Keycloak outage doesn't cache
  // a rejection forever. The successful config is memoized.
  let configPromise = null;
  const getConfig = () => {
    if (!configPromise) {
      configPromise = (async () => {
        let lastErr;
        for (let i = 0; i < 3; i++) {
          try {
            return await oidc.discovery(new URL(issuer), clientId, clientSecret);
          } catch (err) {
            lastErr = err;
            if (i < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
          }
        }
        throw lastErr;
      })();
    }
    return configPromise;
  };

  const idTokenStore = makeIdTokenStore(dataDir);

  function mountOn(app) {
    // CRIT-7: rate limit the OIDC login and callback (the brute-force
    // surface). Logout and user-info are not protected.
    const loginLimiter = createAuthLimiter();
    app.use('/auth/keycloak/login', loginLimiter);
    app.use('/auth/keycloak/callback', loginLimiter);

    app.use(
      cookieSession({
        name: AUTH_COOKIE_NAME,
        keys: [sessionSecret],
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        httpOnly: true,
        sameSite: 'lax',
        secure: !!cookieSecure,
      })
    );

    app.get('/auth/keycloak/login', async (req, res, next) => {
      try {
        const config = await getConfig();
        const codeVerifier = oidc.randomPKCECodeVerifier();
        const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
        const state = oidc.randomState();
        // MED-11: bind the id_token to this session with a server-issued nonce.
        const nonce = oidc.randomState();
        const returnTo = validateReturnTo(req.query.returnTo);
        req.session.oidc = { codeVerifier, state, nonce, returnTo };

        const authUrl = oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirectUri,
          scope: scopes,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          nonce,
          // MED-12: force re-authentication after `maxAge` seconds.
          max_age: maxAge,
        });
        res.redirect(authUrl.href);
      } catch (err) {
        next(err);
      }
    });

    app.get('/auth/keycloak/callback', async (req, res, next) => {
      try {
        const config = await getConfig();
        const saved = req.session.oidc;
        if (!saved) {
          return res.status(400).send('No OIDC state in session. Restart the login flow.');
        }
        const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
        const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
          pkceCodeVerifier: saved.codeVerifier,
          expectedState: saved.state,
          expectedNonce: saved.nonce,
        });
        const claims = tokens.claims();
        // CRIT-6: invalidate pre-auth session before assigning identity.
        // LOW-15: re-validate returnTo in case the session was tampered with.
        const returnTo = validateReturnTo(saved.returnTo);
        const idToken = tokens.id_token;
        const sessionId = randomBytes(16).toString('hex');
        req.session = null;
        req.session = {
          user: {
            sub: claims.sub,
            email: claims.email || null,
            name: claims.name || claims.preferred_username || claims.sub,
            preferred_username: claims.preferred_username || null,
          },
          // MED-4: only a random id in the cookie; id_token stored server-side.
          sessionId,
        };
        if (idToken) idTokenStore.set(sessionId, idToken);
        res.redirect(returnTo);
      } catch (err) {
        next(err);
      }
    });

    app.get('/auth/keycloak/logout', async (req, res, next) => {
      try {
        const sessionId = req.session?.sessionId;
        const idToken = sessionId ? idTokenStore.get(sessionId) : null;
        if (sessionId) idTokenStore.clear(sessionId);
        req.session = null;
        if (idToken) {
          const config = await getConfig();
          const url = oidc.buildEndSessionUrl(config, {
            id_token_hint: idToken,
            post_logout_redirect_uri: new URL('/', `${req.protocol}://${req.get('host')}`).href,
          });
          return res.redirect(url.href);
        }
        res.redirect('/');
      } catch (err) {
        next(err);
      }
    });

    app.get('/auth/keycloak/user', (req, res) => {
      res.json({ user: req.session?.user || null });
    });
  }

  function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    const returnTo = req.originalUrl || '/';
    res.redirect(`/auth/keycloak/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return { enabled: true, modeLabel: 'keycloak (OIDC)', mountOn, requireAuth };
}
