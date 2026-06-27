import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Sandbox the data files to a temp dir before importing server.js
const tmpRoot = mkdtempSync(join(tmpdir(), 'd4td-test-'));
process.env.DATA_DIR = tmpRoot;

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

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${baseUrl}${path}`, opts);
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}

function clearTodos() {
  const f = join(tmpRoot, 'todos.json');
  if (existsSync(f)) rmSync(f);
}

function writeTodos(items) {
  writeFileSync(join(tmpRoot, 'todos.json'), JSON.stringify(items));
}

// Helper: install a fetch stub that only intercepts calls to a given URL
// pattern, leaving other calls (including the test's own req() calls to
// the local server) untouched.
function stubFetch(predicate, responder) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, opts) => {
    const u = typeof url === 'string' ? url : url.url;
    if (predicate(u)) return responder(u, opts);
    return original(url, opts);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function makeResponse(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

describe('HTTP API (serial)', { concurrency: false }, () => {
  beforeEach(() => clearTodos());

  // ── Todo GET ───────────────────────────────────────────────────────────
  test('GET /api/todo returns [] when no file', async () => {
    const r = await req('GET', '/api/todo');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, []);
  });

  test('GET /api/todo returns existing items', async () => {
    writeTodos([{ id: 1, text: 'hi', done: false }]);
    const r = await req('GET', '/api/todo');
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 1);
    assert.equal(r.json[0].text, 'hi');
  });

  // ── Todo POST ──────────────────────────────────────────────────────────
  test('POST /api/todo creates an item', async () => {
    const r = await req('POST', '/api/todo', { text: 'comprar pan' });
    assert.equal(r.status, 201);
    assert.equal(r.json.text, 'comprar pan');
    assert.equal(r.json.done, false);
    assert.ok(typeof r.json.id === 'number');
  });

  test('POST /api/todo rejects empty text', async () => {
    const r = await req('POST', '/api/todo', { text: '   ' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'text requerido');
  });

  // ── Todo PATCH ─────────────────────────────────────────────────────────
  test('PATCH /api/todo/:id marks done', async () => {
    writeTodos([{ id: 1, text: 'a', done: false }]);
    const r = await req('PATCH', '/api/todo/1', { done: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.done, true);
  });

  test('PATCH /api/todo/:id returns 404 for unknown id', async () => {
    writeTodos([{ id: 1, text: 'a', done: false }]);
    const r = await req('PATCH', '/api/todo/999', { done: true });
    assert.equal(r.status, 404);
  });

  // ── Todo DELETE ────────────────────────────────────────────────────────
  test('DELETE /api/todo/:id removes the item', async () => {
    writeTodos([
      { id: 1, text: 'a', done: false },
      { id: 2, text: 'b', done: false },
    ]);
    const r = await req('DELETE', '/api/todo/1');
    assert.equal(r.status, 204);
    const after = await req('GET', '/api/todo');
    assert.equal(after.json.length, 1);
    assert.equal(after.json[0].id, 2);
  });

  test('DELETE /api/todo/:id returns 404 for unknown id', async () => {
    writeTodos([{ id: 1, text: 'a', done: false }]);
    const r = await req('DELETE', '/api/todo/999');
    assert.equal(r.status, 404);
  });

  // ── Geocoding proxy ───────────────────────────────────────────────────
  test('GET /api/geocode rejects missing params', async () => {
    const r = await req('GET', '/api/geocode');
    assert.equal(r.status, 400);
  });

  test('GET /api/geocode returns city from Nominatim', async () => {
    const restore = stubFetch(
      (u) => u.includes('nominatim.openstreetmap.org'),
      (url, opts) => {
        assert.match(opts.headers['User-Agent'], /display4theday/);
        return makeResponse({
          address: { city: 'Zamora', town: 'Zamora', village: '', county: '' },
        });
      }
    );
    try {
      const r = await req('GET', '/api/geocode?lat=41.5&lon=-5.7');
      assert.equal(r.status, 200);
      assert.equal(r.json.name, 'Zamora');
    } finally {
      restore();
    }
  });

  test('GET /api/geocode returns empty name on upstream error', async () => {
    const restore = stubFetch(
      (u) => u.includes('nominatim.openstreetmap.org'),
      () => Promise.reject(new Error('network down'))
    );
    try {
      const r = await req('GET', '/api/geocode?lat=41.5&lon=-5.7');
      assert.equal(r.status, 503);
      assert.equal(r.json.name, '');
    } finally {
      restore();
    }
  });

  test('GET /api/geocode rejects out-of-range lat', async () => {
    const r = await req('GET', '/api/geocode?lat=200&lon=0');
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'lat fuera de rango');
  });

  test('GET /api/geocode rejects out-of-range lon', async () => {
    const r = await req('GET', '/api/geocode?lat=0&lon=-999');
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'lon fuera de rango');
  });

  test('GET /api/geocode rejects non-numeric lat', async () => {
    const r = await req('GET', '/api/geocode?lat=NaN&lon=0');
    assert.equal(r.status, 400);
  });

  // ── Security headers ───────────────────────────────────────────────────
  test('responses include helmet security headers', async () => {
    const r = await fetch(`${baseUrl}/`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('x-content-type-options'));
    assert.ok(r.headers.get('x-frame-options') || r.headers.get('content-security-policy'));
    // CSP should not allow unsafe-inline in script-src
    const csp = r.headers.get('content-security-policy') || '';
    assert.ok(csp.length > 0);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  });

  // ── CRIT-4: error messages are sanitised (YouTube path) ─────────────
  test('GET /api/youtube/search with bad API key returns generic error', async () => {
    process.env.YOUTUBE_API_KEY = 'definitely-not-a-real-key';
    try {
      const r = await req('GET', '/api/youtube/search?q=test');
      // Google's response will be 400 with their error. We should NOT
      // propagate the raw Google error message.
      assert.notEqual(r.status, 200);
      if (r.json) {
        const dump = JSON.stringify(r.json);
        assert.match(dump, /youtube/);
        // Ensure no upstream URL leaked
        assert.doesNotMatch(dump, /googleapis\.com/);
      }
    } finally {
      delete process.env.YOUTUBE_API_KEY;
    }
  });

  // ── CRIT-7: rate limiting is exercised in test/auth-rate-limit.test.js ─
  // (a separate test file because the rate limit needs a real /auth/login
  // handler to hit, which requires enabling auth — too invasive for this
  // file's "no auth" baseline).

  // ── CRIT-3: data files are written with mode 0o600 ────────────────────
  test('todos.json is written with restrictive permissions', async () => {
    await req('POST', '/api/todo', { text: 'perm test' });
    const f = join(tmpRoot, 'todos.json');
    assert.ok(existsSync(f), 'todos.json should exist');
    const mode = statSync(f).mode & 0o777;
    assert.equal(mode, 0o600, `expected mode 0o600, got 0o${mode.toString(8)}`);
  });

  // ── Calendar iframe: validated and exposed ───────────────────────────
  test('GET /api/calendar-embed-url returns empty when not configured', async () => {
    const prev = process.env.GOOGLE_CALENDAR_EMBED_URL;
    delete process.env.GOOGLE_CALENDAR_EMBED_URL;
    try {
      const r = await req('GET', '/api/calendar-embed-url');
      assert.equal(r.status, 200);
      assert.equal(r.json.url, '');
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CALENDAR_EMBED_URL = prev;
    }
  });

  // ── Media URL ─────────────────────────────────────────────────────────
  test('GET /api/media-url returns configured values', async () => {
    const r = await req('GET', '/api/media-url');
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.url, 'string');
    assert.equal(typeof r.json.youtubeKey, 'boolean');
  });

  // ── YouTube search ────────────────────────────────────────────────────
  test('GET /api/youtube/search returns 503 when YOUTUBE_API_KEY not set', async () => {
    const prev = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      const r = await req('GET', '/api/youtube/search?q=test');
      assert.equal(r.status, 503);
    } finally {
      if (prev !== undefined) process.env.YOUTUBE_API_KEY = prev;
    }
  });

  test('GET /api/youtube/search returns 400 for empty query', async () => {
    process.env.YOUTUBE_API_KEY = 'fake-key-for-test';
    try {
      const r = await req('GET', '/api/youtube/search?q=');
      assert.equal(r.status, 400);
    } finally {
      delete process.env.YOUTUBE_API_KEY;
    }
  });

  // ── Static frontend ───────────────────────────────────────────────────
  test('GET / serves index.html', async () => {
    const r = await fetch(`${baseUrl}/`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<title>display4theday<\/title>/);
  });
});
