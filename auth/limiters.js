// Shared rate-limit factory used by the auth modules. Each auth strategy
// imports `createAuthLimiter` and applies the returned middleware to its
// own login/callback routes. This keeps the limits localised (only the
// routes that need brute-force protection) and tunable in one place.

import rateLimit from 'express-rate-limit';

export function createAuthLimiter({ windowMs = 60_000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones de autenticación.' },
  });
}
