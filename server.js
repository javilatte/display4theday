import 'dotenv/config';
import express from 'express';
import RSSParser from 'rss-parser';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getAIBackend } from './ai/backend.js';
import { createAuthMiddleware } from './auth/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const rss = new RSSParser();
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TODOS_FILE = join(DATA_DIR, 'todos.json');

// CRIT-3 / LOW-1: write todos.json with restrictive mode. Re-applies
// chmod on existing files (e.g. files written by an older version of
// the app with default umask).
function writeDataFile(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort: filesystem may not support chmod (e.g. some FUSE mounts)
  }
}

// ── Optional auth (Keycloak OIDC OR shared password) ──────────────────────
// AUTH_MODE selects the strategy:
//   - "keycloak" — OIDC flow against a Keycloak realm
//   - "password" — single shared password (DASHBOARD_PASSWORD), cookie
//     session signed with SESSION_SECRET. Simpler, suitable for home /
//     single-user deployments behind a reverse proxy or LAN.
//   - anything else (default) — auth disabled, dashboard is open on
//     whatever interface it binds to. Useful for fully trusted LAN.
const auth = createAuthMiddleware({
  mode: process.env.AUTH_MODE,
  enabled: process.env.AUTH_ENABLED === 'true', // legacy alias
  // keycloak
  issuer: process.env.KEYCLOAK_ISSUER,
  clientId: process.env.KEYCLOAK_CLIENT_ID,
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  redirectUri: process.env.KEYCLOAK_REDIRECT_URI,
  // password
  password: process.env.DASHBOARD_PASSWORD,
  // shared
  sessionSecret: process.env.SESSION_SECRET,
  cookieSecure: process.env.SESSION_COOKIE_SECURE === 'true',
  dataDir: DATA_DIR,
});
auth.mountOn(app);

// ── Todo helpers ───────────────────────────────────────────────────────────
function loadTodos() {
  if (!existsSync(TODOS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TODOS_FILE, 'utf8'));
  } catch (err) {
    // LOW-8: don't silently swallow. Log so the operator notices before the
    // next save overwrites the (potentially recoverable) file.
    console.warn('todos.json corrupto, devolviendo []:', err.message);
    return [];
  }
}
function saveTodos(todos) {
  writeDataFile(TODOS_FILE, JSON.stringify(todos, null, 2));
}

// ── Security headers (CSP, X-Frame-Options, HSTS, …) ──────────────────────
// No inline scripts are emitted from the server. Inline event handlers
// in the HTML have been moved to ui.js. The static frontend is CSP-clean.
// MED-10: explicit `worker-src`, `form-action`, `script-src-attr` and
// `manifest-src` so the policy does not silently rely on helmet's
// defaults (defaults can change between helmet versions).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        // LOW-13: a few <ul style="display:none"> and inline styles remain
        // in static HTML and the OAuth callback template. Allow inline
        // style attributes; not style elements. Move to CSS classes
        // when convenient.
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://i.ytimg.com', 'https://yt3.ggpht.com'],
        frameSrc: [
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://open.spotify.com',
          'https://calendar.google.com',
        ],
        connectSrc: ["'self'", 'https://nominatim.openstreetmap.org', 'https://api.open-meteo.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'none'"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: null, // dev runs over http; do not force https in dev
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ── Rate limiters ──────────────────────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento.' },
});
const youtubeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas búsquedas. Reduce la frecuencia.' },
});
// MED-1
const todoWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones en la lista.' },
});
// CRIT-7: per-route auth rate limiters. Applied inside the auth modules
// (password.js, keycloak.js) so that the limits only cover the routes
// that need brute-force protection (login, callback), not the harmless
// endpoints (logout, user-info, static).
// Kept here as a factory so all auth strategies share the same tuning.

// ── Static files ───────────────────────────────────────────────────────────
// MED-14: explicit 16 KB body limit. AI chat messages, todos, etc. all fit
// comfortably; large bodies are rejected before they hit the handlers.
app.use(express.json({ limit: '16kb' }));
// requireAuth must run before static and the API routes so that
// unauthenticated requests never reach them.
app.use(auth.requireAuth);

// LOW-22: serve the operator-tunable defaults the frontend reads from
// window.__D4TD_CONFIG__. None of these are secrets.
app.get('/api/config', (_req, res) => {
  res.json({
    weatherDefaultLat: Number(process.env.WEATHER_DEFAULT_LAT) || 0,
    weatherDefaultLon: Number(process.env.WEATHER_DEFAULT_LON) || 0,
    weatherDefaultCity: process.env.WEATHER_DEFAULT_CITY || 'Sin ubicación',
    calendarEmbedUrl: process.env.GOOGLE_CALENDAR_EMBED_URL || '',
  });
});
// Expose the same object on the global `window` so the static frontend
// can read it without an extra round-trip.
app.get('/d4td-config.js', (_req, res) => {
  res.type('application/javascript').send(
    `window.__D4TD_CONFIG__ = ${JSON.stringify({
      weatherDefaultLat: Number(process.env.WEATHER_DEFAULT_LAT) || 0,
      weatherDefaultLon: Number(process.env.WEATHER_DEFAULT_LON) || 0,
      weatherDefaultCity: process.env.WEATHER_DEFAULT_CITY || 'Sin ubicación',
      calendarEmbedUrl: process.env.GOOGLE_CALENDAR_EMBED_URL || '',
    })};`
  );
});

app.use(express.static(join(__dirname, 'public')));

// ── Calendar embed (replaces OAuth + Google Calendar API) ────────────────
// Returns the configured public embed URL for Google Calendar, or empty
// if not configured. The frontend embeds this directly as an iframe.
// Defense in depth: only allow the official embed path prefix.
app.get('/api/calendar-embed-url', (_req, res) => {
  const url = (process.env.GOOGLE_CALENDAR_EMBED_URL || '').trim();
  if (!url) return res.json({ url: '' });
  try {
    const u = new URL(url);
    if (!u.href.startsWith('https://calendar.google.com/calendar/embed')) {
      console.warn('GOOGLE_CALENDAR_EMBED_URL rejected:', u.href);
      return res.json({ url: '' });
    }
    res.json({ url: u.href });
  } catch {
    res.json({ url: '' });
  }
});

// ── Todo CRUD ──────────────────────────────────────────────────────────────
app.get('/api/todo', (_req, res) => res.json(loadTodos()));

app.post('/api/todo', todoWriteLimiter, (req, res) => {
  const text = req.body?.text?.trim();
  if (!text) return res.status(400).json({ error: 'text requerido' });
  // LOW-6: cap text length server-side
  if (text.length > 200) return res.status(400).json({ error: 'texto demasiado largo' });
  const todos = loadTodos();
  // LOW-6: cap list size
  if (todos.length >= 500) return res.status(409).json({ error: 'lista llena' });
  const item = { id: Date.now(), text, done: false };
  todos.push(item);
  saveTodos(todos);
  res.status(201).json(item);
});

app.patch('/api/todo/:id', todoWriteLimiter, (req, res) => {
  const id = Number(req.params.id);
  const todos = loadTodos();
  const item = todos.find((t) => t.id === id);
  if (!item) return res.status(404).json({ error: 'no encontrado' });
  if (typeof req.body?.done === 'boolean') item.done = req.body.done;
  if (req.body?.text?.trim()) {
    const text = req.body.text.trim();
    if (text.length > 200) return res.status(400).json({ error: 'texto demasiado largo' });
    item.text = text;
  }
  saveTodos(todos);
  res.json(item);
});

app.delete('/api/todo/:id', todoWriteLimiter, (req, res) => {
  const id = Number(req.params.id);
  const todos = loadTodos();
  const next = todos.filter((t) => t.id !== id);
  if (next.length === todos.length) return res.status(404).json({ error: 'no encontrado' });
  saveTodos(next);
  res.status(204).end();
});

// ── RTVE RSS proxy ─────────────────────────────────────────────────────────
const RTVE_FEEDS = [
  'https://www.rtve.es/rss/portada.xml',
  'https://www.rtve.es/rss/noticias.xml',
  'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada',
];

let newsCache = { items: [], ts: 0 };

app.get('/api/news', async (_req, res) => {
  if (Date.now() - newsCache.ts < 5 * 60_000 && newsCache.items.length) {
    return res.json(newsCache.items);
  }
  for (const url of RTVE_FEEDS) {
    try {
      const feed = await rss.parseURL(url);
      const items = feed.items.slice(0, 20).map((i) => ({
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
        summary: i.contentSnippet || '',
      }));
      newsCache = { items, ts: Date.now() };
      return res.json(items);
    } catch {
      continue;
    }
  }
  res.status(503).json({ error: 'No se pudo obtener el feed de noticias' });
});

// ── Geocoding proxy (Nominatim requiere User-Agent) ────────────────────────
app.get('/api/geocode', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat y lon requeridos' });
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
    return res.status(400).json({ error: 'lat fuera de rango' });
  }
  if (!Number.isFinite(lonN) || lonN < -180 || lonN > 180) {
    return res.status(400).json({ error: 'lon fuera de rango' });
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latN}&lon=${lonN}&format=json&accept-language=es`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'display4theday/1.0 (raspberry-pi-dashboard)' },
      // LOW-5: 5s timeout for geocoding
      signal: AbortSignal.timeout(5000),
    });
    const d = await r.json();
    const name =
      d.address?.city || d.address?.town || d.address?.village || d.address?.county || '';
    res.json({ name });
  } catch {
    res.status(503).json({ name: '' });
  }
});

// `ai` is created at import time. It picks the backend from AI_BACKEND
// (ollama | lmstudio | none). Dynamic, so tests can mutate env before import.
const ai = await getAIBackend();

// ── AI — modelos disponibles ──────────────────────────────────────────────
app.get('/api/ai/models', async (_req, res) => {
  if (ai.name === 'none') return res.status(503).json({ error: 'AI backend not configured' });
  try {
    res.json(await ai.listModels());
  } catch (err) {
    console.error(`${ai.name} list:`, err);
    res.status(503).json({ error: 'ai_models_unavailable' });
  }
});

// ── AI — chat ──────────────────────────────────────────────────────────────
app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  if (ai.name === 'none') {
    return res.status(503).json({ error: 'AI backend not configured' });
  }
  const { messages = [], model, weather } = req.body;

  const now = new Date();
  const ownerName = process.env.OWNER_NAME || '';
  const ownerLang = process.env.OWNER_LANGUAGE || 'español';
  const ownerSuffix = ownerName ? ` de ${ownerName}` : '';
  const systemPrompt = `Eres el asistente personal del panel doméstico${ownerSuffix}. Respondes en ${ownerLang}, de forma natural y muy concisa (máximo 2-3 frases). Sin markdown, sin listas, sin emojis.

Contexto actual:
- ${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
${weather ? `- Tiempo: ${weather}` : ''}

Al saludar, comenta lo más relevante del tiempo. Sugiere ropa si el tiempo lo amerita.`;

  const chatMessages =
    messages.length === 0
      ? [{ role: 'user', content: 'Salúdame y dame un resumen breve de mi día.' }]
      : messages;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Strip <think>…</think> blocks from any backend that emits them
  // (Ollama's reasoning models, LM Studio with reasoning enabled).
  function stripThink(text) {
    if (!text) return text;
    if (text.includes('<think>')) inThink = true;
    if (inThink) {
      if (text.includes('</think>')) {
        inThink = false;
        return text.split('</think>').slice(1).join('');
      }
      return '';
    }
    return text;
  }
  let inThink = false;

  try {
    for await (const { content } of ai.chat({
      system: systemPrompt,
      messages: chatMessages,
      model,
      // LOW-19: abort the backend fetch when the client disconnects so
      // we don't keep generating tokens after the SSE consumer is gone.
      signal: req.signal,
    })) {
      const cleaned = stripThink(content);
      if (cleaned) res.write(`data: ${JSON.stringify({ content: cleaned })}\n\n`);
    }
  } catch (err) {
    console.error(`${ai.name} error:`, err);
    res.write(`data: ${JSON.stringify({ error: 'ai_backend_error' })}\n\n`);
  }
  res.end();
});

// ── Media iframe URL ───────────────────────────────────────────────────────
app.get('/api/media-url', (_req, res) => {
  res.json({
    url: process.env.MEDIA_IFRAME_URL || '',
    youtubeKey: !!process.env.YOUTUBE_API_KEY,
  });
});

// ── YouTube search proxy ───────────────────────────────────────────────────
app.get('/api/youtube/search', youtubeLimiter, async (req, res) => {
  const { YOUTUBE_API_KEY } = process.env;
  if (!YOUTUBE_API_KEY) return res.status(503).json({ error: 'YOUTUBE_API_KEY no configurado' });
  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: 'q requerido' });
  try {
    const url =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet&type=video&maxResults=8` +
      `&q=${encodeURIComponent(q)}&key=${YOUTUBE_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.error) {
      console.error('YouTube API error:', d.error);
      return res.status(400).json({ error: 'youtube_api_error' });
    }
    const items = (d.items || []).map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
    }));
    res.json(items);
  } catch (err) {
    console.error('YouTube search failed:', err);
    res.status(503).json({ error: 'youtube_unavailable' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
export function createApp() {
  return app;
}

const PORT = process.env.PORT || 3000;
// MED-6: bind to localhost by default for safe local dev. Set
// `HOST=0.0.0.0` (or your LAN IP) to expose on the network.
const HOST = process.env.HOST || '127.0.0.1';
// MED-5: respect `X-Forwarded-For` from a reverse proxy. Default to off
// (don't trust forwarded headers from arbitrary clients). Set
// `TRUST_PROXY=1` (or N for the number of hops) when fronted by Nginx.
if (process.env.TRUST_PROXY) {
  const n = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(n) ? n : process.env.TRUST_PROXY);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`\ndisplay4theday corriendo en http://${HOST}:${PORT}`);
    console.log(`auth: ${auth.modeLabel}`);
  });
  // LOW-3: graceful shutdown on SIGTERM/SIGINT. `server.close()` waits
  // for in-flight requests to finish (or the 10s timeout below).
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`\nReceived ${sig}, shutting down…`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
  // LOW-4: log and exit on uncaught errors. systemd Restart=on-failure
  // brings the service back up; we prefer a clean restart over a
  // half-broken process serving requests.
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);
  });
}
