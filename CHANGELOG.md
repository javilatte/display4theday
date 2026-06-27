# Changelog

All notable changes to display4theday are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional Keycloak (OIDC) authentication via `openid-client`. Gated by
  `AUTH_ENABLED=true`; the dashboard runs as before when the flag is off.
- `AI_BACKEND` env var to switch between `ollama`, `lmstudio`, and `none`
  (default). The dashboard no longer assumes a single AI engine.
- Security headers (`helmet`) with a strict CSP that bans inline scripts
  and `unsafe-inline`. Inline JS in `index.html` has been moved to
  `public/ui.js`.
- Rate limits on `/api/ai/chat` (10/min) and `/api/youtube/search`
  (30/min) via `express-rate-limit`.
- CSRF `state` parameter on the Google OAuth flow.
- Input validation on `/api/geocode` (lat ∈ [-90, 90], lon ∈ [-180, 180]).
- Test suite: 37 tests using Node's built-in `node:test` runner.
  `npm test`, `npm run lint`, `npm run format:check` and `npm run format`.

### Changed

- `server.js` now exports `createApp()` for testability. `app.listen` only
  runs when the module is the entrypoint.
- `DATA_DIR` env var overrides the location of `tokens.json` and
  `todos.json` (defaults to the project root).
- `package.json` adds scripts: `test`, `lint`, `lint:fix`, `format`,
  `format:check`.

### Security

- `escHtml` in `public/modules/todo.js` and `public/modules/calendar.js`
  now escapes single quotes, preventing attribute-context XSS.
- Calendar event titles and locations are HTML-escaped before being
  injected into the DOM.
- OAuth `tokens.json` is no longer silently re-persisted without
  `expiry_date`; a warning is logged.

## [1.0.0] — Initial commit

- Single Node/Express process serving `public/` and a small JSON API.
- Panels: weather, Google Calendar, news (RTVE / El País RSS), todos,
  media iframe + YouTube search, and an AI assistant.
- Optional integrations: Google OAuth, YouTube Data API, Ollama.
