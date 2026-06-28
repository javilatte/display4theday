import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'd4td-calendar-test-'));
process.env.DATA_DIR = tmpRoot;
process.env.AUTH_MODE = '';
process.env.AUTH_ENABLED = 'false';

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

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

describe('GET /api/calendar-embed-url', () => {
  test('returns empty when GOOGLE_CALENDAR_EMBED_URL is unset', async () => {
    const prev = process.env.GOOGLE_CALENDAR_EMBED_URL;
    delete process.env.GOOGLE_CALENDAR_EMBED_URL;
    try {
      const r = await get('/api/calendar-embed-url');
      assert.equal(r.status, 200);
      const d = await r.json();
      assert.equal(d.url, '');
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CALENDAR_EMBED_URL = prev;
    }
  });

  test('returns the URL when set to a valid Google Calendar embed', async () => {
    const prev = process.env.GOOGLE_CALENDAR_EMBED_URL;
    process.env.GOOGLE_CALENDAR_EMBED_URL =
      'https://calendar.google.com/calendar/embed?src=abc123&ctz=Europe/Madrid';
    try {
      const r = await get('/api/calendar-embed-url');
      const d = await r.json();
      assert.equal(
        d.url,
        'https://calendar.google.com/calendar/embed?src=abc123&ctz=Europe/Madrid'
      );
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CALENDAR_EMBED_URL = prev;
      else delete process.env.GOOGLE_CALENDAR_EMBED_URL;
    }
  });

  test('rejects non-Google-Calendar URLs (defense in depth)', async () => {
    const prev = process.env.GOOGLE_CALENDAR_EMBED_URL;
    process.env.GOOGLE_CALENDAR_EMBED_URL = 'https://evil.com/embed';
    try {
      const r = await get('/api/calendar-embed-url');
      const d = await r.json();
      assert.equal(d.url, '');
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CALENDAR_EMBED_URL = prev;
      else delete process.env.GOOGLE_CALENDAR_EMBED_URL;
    }
  });

  test('rejects http:// (must be https)', async () => {
    const prev = process.env.GOOGLE_CALENDAR_EMBED_URL;
    process.env.GOOGLE_CALENDAR_EMBED_URL = 'http://calendar.google.com/embed?src=abc';
    try {
      const r = await get('/api/calendar-embed-url');
      const d = await r.json();
      assert.equal(d.url, '');
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CALENDAR_EMBED_URL = prev;
      else delete process.env.GOOGLE_CALENDAR_EMBED_URL;
    }
  });
});
