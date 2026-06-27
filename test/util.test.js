import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('client util.escHtml', () => {
  let escHtml;
  test('imports cleanly', async () => {
    const mod = await import('../public/modules/util.js');
    escHtml = mod.escHtml;
    assert.equal(typeof escHtml, 'function');
  });

  test('escapes HTML special chars', () => {
    assert.equal(escHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes ampersand first to avoid double-escape', () => {
    // The order matters: & must be replaced first so that subsequent
    // &lt; insertions don't get re-escaped.
    assert.equal(escHtml('&lt;'), '&amp;lt;');
    assert.equal(escHtml('&'), '&amp;');
  });

  test('escapes quotes for attribute contexts', () => {
    assert.equal(escHtml('"hi"'), '&quot;hi&quot;');
    assert.equal(escHtml("it's"), 'it&#39;s');
  });

  test('handles non-string input', () => {
    assert.equal(escHtml(null), 'null');
    assert.equal(escHtml(undefined), 'undefined');
    assert.equal(escHtml(123), '123');
  });

  test('passes through safe text unchanged', () => {
    assert.equal(escHtml('hello world'), 'hello world');
    assert.equal(escHtml(''), '');
  });
});

describe('client util.safeHref', () => {
  let safeHref;
  test('imports cleanly', async () => {
    const mod = await import('../public/modules/util.js');
    safeHref = mod.safeHref;
    assert.equal(typeof safeHref, 'function');
  });

  test('accepts http and https URLs', () => {
    // The function uses `location.origin` as base, which in Node is undefined.
    // We mock it.
    globalThis.location = { origin: 'http://localhost' };
    try {
      assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
      assert.equal(safeHref('http://example.com/x'), 'http://example.com/x');
      assert.equal(safeHref('//example.com/x'), 'http://example.com/x');
    } finally {
      delete globalThis.location;
    }
  });

  test('rejects javascript: and data: schemes', () => {
    globalThis.location = { origin: 'http://localhost' };
    try {
      assert.equal(safeHref('javascript:alert(1)'), '');
      assert.equal(safeHref('data:text/html,<script>'), '');
    } finally {
      delete globalThis.location;
    }
  });

  test('rejects empty / null / non-string', () => {
    globalThis.location = { origin: 'http://localhost' };
    try {
      assert.equal(safeHref(''), '');
      assert.equal(safeHref(null), '');
      assert.equal(safeHref(undefined), '');
    } finally {
      delete globalThis.location;
    }
  });
});
