// Auth orchestrator. Returns a middleware object that delegates to one
// of three strategies:
//
//   - mode: "keycloak" — full OIDC flow against a Keycloak realm (see
//     ./keycloak.js). Suitable for multi-user, multi-realm setups.
//
//   - mode: "password" — single shared password. The operator sets
//     DASHBOARD_PASSWORD in .env; the user enters it in a tiny login
//     page and gets a signed session cookie. Simpler than Keycloak,
//     suitable for home / single-user deployments.
//
//   - mode: anything else (default) — auth is disabled; the dashboard
//     is open on whatever interface it binds to. Useful for fully
//     trusted LANs.
//
// The exported object always exposes:
//   - enabled:        boolean
//   - modeLabel:      human-readable description
//   - mountOn(app):   install session middleware + login routes
//   - requireAuth:    express middleware, no-op when disabled

import * as oidcAuth from './keycloak.js';
import { createPasswordAuth } from './password.js';

function resolveMode(opts) {
  if (opts.mode === 'keycloak' || opts.mode === 'password') return opts.mode;
  // Legacy: AUTH_ENABLED=true is equivalent to AUTH_MODE=keycloak.
  if (opts.enabled) return 'keycloak';
  return 'disabled';
}

export function createAuthMiddleware(opts = {}) {
  const mode = resolveMode(opts);
  if (mode === 'keycloak') {
    const inner = oidcAuth.createAuthMiddleware(opts);
    return {
      enabled: true,
      modeLabel: 'keycloak (OIDC)',
      mountOn: inner.mountOn,
      requireAuth: inner.requireAuth,
    };
  }
  if (mode === 'password') {
    return createPasswordAuth(opts);
  }
  // disabled
  return {
    enabled: false,
    modeLabel: 'disabled',
    mountOn(_app) {
      // No-op.
    },
    requireAuth(_req, _res, next) {
      next();
    },
  };
}

export { validateReturnTo } from './keycloak.js';
