import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'd4td-pw-test-'));
process.env.DATA_DIR = tmpRoot;

const { createPasswordAuth } = await import('../auth/password.js');

const servers = [];
after(async () => {
  for (const s of servers) {
    await new Promise((resolve) => s.close(resolve));
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

async function makeApp(opts) {
  const app = express();
  const auth = createPasswordAuth(opts);
  auth.mountOn(app);
  app.use(express.json());
  app.get('/protected', auth.requireAuth, (_req, res) => res.json({ secret: 'data' }));
  app.get('/user-info', (req, res) => res.json({ user: req.session?.user || null }));
  await new Promise((resolve) => {
    const s = app.listen(0, resolve);
    servers.push(s);
  });
  const { port } = servers[servers.length - 1].address();
  return `http://127.0.0.1:${port}`;
}

async function get(url, headers = {}, opts = {}) {
  const r = await fetch(url, { redirect: opts.redirect || 'manual', headers });
  const setCookie = r.headers.get('set-cookie');
  return {
    status: r.status,
    location: r.headers.get('location'),
    setCookie,
    body: await r.text(),
  };
}

async function post(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const setCookie = r.headers.get('set-cookie');
  return {
    status: r.status,
    location: r.headers.get('location'),
    setCookie,
    body: await r.text(),
  };
}

function extractCookieValue(setCookie, name) {
  if (!setCookie) return null;
  const match = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

// cookie-session uses TWO cookies: one for the value and one for the HMAC
// signature (`<name>` and `<name>.sig`). To replay the session in another
// request, we need both. This helper concatenates all Set-Cookie entries
// for the given base name (including the `.sig` companion) into a string
// suitable for the `Cookie` request header.
function extractSignedCookie(setCookie, name) {
  if (!setCookie) return null;
  const re = new RegExp(`(${name}(?:\\.sig)?=[^;]+)`, 'g');
  const matches = setCookie.match(re);
  return matches ? matches.join('; ') : null;
}

describe('createPasswordAuth — config', () => {
  test('throws when password is missing', () => {
    assert.throws(
      () =>
        createPasswordAuth({
          sessionSecret: 'a'.repeat(32),
        }),
      /DASHBOARD_PASSWORD is not set/
    );
  });

  test('throws when session secret is missing', () => {
    assert.throws(
      () =>
        createPasswordAuth({
          password: 'hunter2',
        }),
      /SESSION_SECRET is not set/
    );
  });

  test('throws when session secret is too short', () => {
    assert.throws(
      () =>
        createPasswordAuth({
          password: 'hunter2',
          sessionSecret: 'short',
        }),
      /SESSION_SECRET is shorter than 32 bytes/
    );
  });

  test('accepts a valid config', () => {
    const m = createPasswordAuth({
      password: 'hunter2',
      sessionSecret: 'a'.repeat(32),
    });
    assert.equal(m.enabled, true);
    assert.equal(m.modeLabel, 'password (shared)');
  });
});

describe('createPasswordAuth — HTTP', () => {
  let baseUrl;
  before(async () => {
    baseUrl = await makeApp({
      password: 'correct-horse-battery-staple',
      sessionSecret: 'a'.repeat(32),
      cookieSecure: false,
    });
  });

  test('GET /auth/login renders an HTML form', async () => {
    const r = await get(`${baseUrl}/auth/login`);
    assert.equal(r.status, 200);
    assert.match(r.body, /<form[^>]*method="post"/);
    assert.match(r.body, /type="password"/);
    assert.match(r.body, /<button[^>]*type="submit"/);
  });

  test('GET /protected without session redirects to /auth/login', async () => {
    const r = await get(`${baseUrl}/protected`);
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/auth\/login\?returnTo=/);
  });

  test('POST /auth/login with wrong password returns 401', async () => {
    const r = await post(`${baseUrl}/auth/login`, { password: 'wrong' });
    assert.equal(r.status, 401);
  });

  test('POST /auth/login with correct password sets a session cookie', async () => {
    const r = await post(`${baseUrl}/auth/login`, { password: 'correct-horse-battery-staple' });
    assert.equal(r.status, 302);
    assert.ok(r.setCookie, 'expected Set-Cookie header');
    const cookieValue = extractCookieValue(r.setCookie, 'd4td.sid');
    assert.ok(cookieValue, 'expected d4td.sid cookie');
  });

  test('GET /protected with session cookie returns 200', async () => {
    const login = await post(`${baseUrl}/auth/login`, { password: 'correct-horse-battery-staple' });
    const cookie = extractSignedCookie(login.setCookie, 'd4td.sid');
    const r = await get(`${baseUrl}/protected`, { cookie });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.secret, 'data');
  });

  test('GET /auth/logout clears the session', async () => {
    const login = await post(`${baseUrl}/auth/login`, { password: 'correct-horse-battery-staple' });
    assert.equal(login.status, 302);
    const cookie = extractSignedCookie(login.setCookie, 'd4td.sid');
    const logout = await get(`${baseUrl}/auth/logout`, { cookie });
    assert.equal(logout.status, 302);
    assert.equal(logout.location, '/');
    // The Set-Cookie should expire the session cookie. Since cookie-session
    // is stateless, the *only* way to "log out" is to send back a cookie
    // with an expiry in the past. Verify the Set-Cookie has expires=Thu,
    // 01 Jan 1970 (the Unix epoch, the canonical "delete" date).
    assert.ok(logout.setCookie, 'logout should send a Set-Cookie');
    assert.match(logout.setCookie, /expires=Thu, 01 Jan 1970/);
  });

  test('GET /auth/user returns the user object when logged in', async () => {
    const login = await post(`${baseUrl}/auth/login`, { password: 'correct-horse-battery-staple' });
    const cookie = extractSignedCookie(login.setCookie, 'd4td.sid');
    const r = await get(`${baseUrl}/user-info`, { cookie });
    const body = JSON.parse(r.body);
    assert.equal(body.user.sub, 'shared');
    assert.equal(body.user.name, 'Dashboard');
  });

  test('GET /auth/user returns null when not logged in', async () => {
    const r = await get(`${baseUrl}/user-info`);
    const body = JSON.parse(r.body);
    assert.equal(body.user, null);
  });

  test('open-redirect protection: invalid returnTo falls back to /', async () => {
    const r = await post(`${baseUrl}/auth/login?returnTo=https://evil.com`, {
      password: 'correct-horse-battery-staple',
    });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/');
  });

  test('open-redirect protection: protocol-relative URL rejected', async () => {
    const r = await post(`${baseUrl}/auth/login?returnTo=//evil.com`, {
      password: 'correct-horse-battery-staple',
    });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/');
  });

  test('valid returnTo is honoured', async () => {
    const r = await post(`${baseUrl}/auth/login?returnTo=/api/todo`, {
      password: 'correct-horse-battery-staple',
    });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/api/todo');
  });
});
