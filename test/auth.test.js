import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'd4td-auth-test-'));
process.env.DATA_DIR = tmpRoot;

const { createAuthMiddleware, validateReturnTo } = await import('../auth/index.js');

const servers = [];

async function makeApp(opts) {
  const app = express();
  const auth = createAuthMiddleware(opts);
  auth.mountOn(app);
  app.get('/public-hello', (_req, res) => res.json({ ok: true }));
  app.get('/protected', auth.requireAuth, (_req, res) => res.json({ secret: 'data' }));
  app.get('/user-info', (req, res) => res.json({ user: req.session?.user || null }));
  await new Promise((resolve) => {
    const s = app.listen(0, resolve);
    servers.push(s);
  });
  const { port } = servers[servers.length - 1].address();
  return `http://127.0.0.1:${port}`;
}

after(async () => {
  for (const s of servers) {
    await new Promise((resolve) => s.close(resolve));
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function get(url, headers = {}) {
  const r = await fetch(url, { redirect: 'manual', headers });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, location: r.headers.get('location'), setCookie, body: await r.text() };
}

describe('createAuthMiddleware — disabled', () => {
  let baseUrl;
  before(async () => {
    baseUrl = await makeApp({ enabled: false });
  });

  test('mountOn does not install cookie-session', async () => {
    const r = await get(`${baseUrl}/public-hello`);
    assert.equal(r.status, 200);
    assert.equal(r.setCookie, null);
  });

  test('requireAuth is a no-op (passes through)', async () => {
    const r = await get(`${baseUrl}/protected`);
    assert.equal(r.status, 200);
  });
});

describe('createAuthMiddleware — enabled, misconfigured', () => {
  test('throws when required fields are missing', () => {
    assert.throws(
      () =>
        createAuthMiddleware({
          enabled: true,
          issuer: 'https://kc/realms/x',
          clientId: 'cid',
          // clientSecret missing
          redirectUri: 'https://x/cb',
          sessionSecret: 'a'.repeat(32),
        }),
      /missing config: clientSecret/
    );
  });
});

describe('createAuthMiddleware — SESSION_SECRET length', () => {
  test('throws when SESSION_SECRET is shorter than 32 bytes', () => {
    assert.throws(
      () =>
        createAuthMiddleware({
          enabled: true,
          issuer: 'https://kc/realms/x',
          clientId: 'cid',
          clientSecret: 'sec',
          redirectUri: 'https://x/cb',
          sessionSecret: 'short', // 5 bytes
        }),
      /SESSION_SECRET is shorter than 32 bytes/
    );
  });

  test('throws when SESSION_SECRET is exactly 31 bytes', () => {
    assert.throws(
      () =>
        createAuthMiddleware({
          enabled: true,
          issuer: 'https://kc/realms/x',
          clientId: 'cid',
          clientSecret: 'sec',
          redirectUri: 'https://x/cb',
          sessionSecret: 'a'.repeat(31),
        }),
      /SESSION_SECRET is shorter than 32 bytes/
    );
  });

  test('accepts SESSION_SECRET of 32+ bytes', () => {
    const m = createAuthMiddleware({
      enabled: true,
      issuer: 'https://kc/realms/x',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://x/cb',
      sessionSecret: 'a'.repeat(32),
    });
    assert.equal(m.enabled, true);
  });
});

describe('createAuthMiddleware — enabled, configured (no live Keycloak)', () => {
  let baseUrl;
  const kcOpts = {
    enabled: true,
    issuer: 'https://kc.invalid/realms/test',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'https://localhost:9999/auth/keycloak/callback',
    sessionSecret: 'a'.repeat(32),
    cookieSecure: false, // http for tests
  };

  before(async () => {
    baseUrl = await makeApp(kcOpts);
  });

  test('GET /protected without session does not return 200', async () => {
    // The discovery request to kc.invalid will fail; in production the
    // user gets a 500. We don't have a live Keycloak here, so we just
    // verify the response is NOT 200 (i.e. auth gate is in place).
    const r = await get(`${baseUrl}/protected`);
    assert.notEqual(r.status, 200);
  });

  test('user-info route is mounted and returns user:null without login', async () => {
    // cookie-session only sets a cookie when the session is modified,
    // so a read-only route like /user-info doesn't get a Set-Cookie.
    // We just verify the route is mounted (responds 200) and the body
    // contains the expected shape.
    const r = await fetch(`${baseUrl}/user-info`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.user, null);
  });
});

describe('validateReturnTo (open-redirect protection)', () => {
  test('accepts a same-origin absolute path', () => {
    assert.equal(validateReturnTo('/'), '/');
    assert.equal(validateReturnTo('/foo'), '/foo');
    assert.equal(validateReturnTo('/foo/bar?x=1#frag'), '/foo/bar?x=1#frag');
  });

  test('rejects absolute URLs (http / https / other schemes)', () => {
    assert.equal(validateReturnTo('https://evil.com'), '/');
    assert.equal(validateReturnTo('http://evil.com'), '/');
    assert.equal(validateReturnTo('javascript:alert(1)'), '/');
    assert.equal(validateReturnTo('data:text/html,<script>'), '/');
  });

  test('rejects protocol-relative URLs', () => {
    assert.equal(validateReturnTo('//evil.com'), '/');
    assert.equal(validateReturnTo('//evil.com/path'), '/');
  });

  test('rejects empty, missing, or non-string values', () => {
    assert.equal(validateReturnTo(''), '/');
    assert.equal(validateReturnTo(undefined), '/');
    assert.equal(validateReturnTo(null), '/');
    assert.equal(validateReturnTo(123), '/');
    assert.equal(validateReturnTo(['/foo']), '/');
  });

  test('rejects paths that do not start with /', () => {
    assert.equal(validateReturnTo('foo'), '/');
    assert.equal(validateReturnTo('foo/bar'), '/');
  });
});
