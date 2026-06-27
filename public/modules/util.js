// Shared client-side utilities.

// Escape a string for safe inclusion in an HTML body or double-quoted
// attribute. Mirrors the same function used by the server-side `escHtml`
// helpers scattered across the public modules. Centralised here so it can
// be unit-tested directly.
export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Restrict a URL to http(s) schemes. Anything else (javascript:, data:,
// malformed, missing) is rejected.
export function safeHref(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw, location.origin);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch {
    // ignore
  }
  return '';
}
