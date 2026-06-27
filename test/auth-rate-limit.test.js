// Verifies the CRIT-7 rate limit on /auth/login. Lives in its own file
// because enabling auth (needed for /auth/login to exist) would
// otherwise break the rest of test/server.test.js, which assumes the
// dashboard is open by default.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'd4td-ratelimit-test-'));
process.env.DATA_DIR = tmpRoot;
process.env.AUTH_MODE = 'password';
process.env.DASHBOARD_PASSWORD = 'test-password';
process.env.SESSION_SECRET = 'a'.repeat(32);
process.env.SESSION_COOKIE_SECURE = 'false';

const { createApp } = await import('../server.js');
const app = createApp();

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(tmpRoot, { recursive: true, force: true });
});

test('rate limit on /auth/login returns 429 after threshold', async () => {
  // The limiter is 20/min. Hit it 25 times with POSTs. The first 20
  // requests get either 302 (correct password) or 401 (wrong); the next
  // 5 should be 429.
  const responses = [];
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'irrelevant' }),
    });
    responses.push(r.status);
  }
  const rateLimited = responses.filter((s) => s === 429).length;
  assert.ok(
    rateLimited > 0,
    `expected at least one 429 after 25 requests, got: ${responses.join(',')}`
  );
});
