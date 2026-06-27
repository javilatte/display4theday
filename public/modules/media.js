import { escHtml } from './util.js';

function toEmbedUrl(url) {
  if (!url) return '';
  const m1 = url.match(/youtube\.com\/watch\?(?:.*&)?v=([^&]+)(?:.*&list=([^&]+))?/);
  if (m1) {
    const [, id, list] = m1;
    const p = new URLSearchParams({ autoplay: 1, mute: 1, loop: 1, playlist: list || id });
    if (list) p.set('list', list);
    return `https://www.youtube.com/embed/${id}?${p}`;
  }
  const m2 = url.match(/youtu\.be\/([^?]+)/);
  if (m2)
    return `https://www.youtube.com/embed/${m2[1]}?autoplay=1&mute=1&loop=1&playlist=${m2[1]}`;
  const ms = url.match(/open\.spotify\.com\/(track|album|playlist|show)\/([^?]+)/);
  if (ms) return `https://open.spotify.com/embed/${ms[1]}/${ms[2]}?autoplay=1`;
  return url;
}

// ── Build panel DOM ────────────────────────────────────────────────────────
function buildPanel(hasYouTubeKey, defaultUrl) {
  const panel = document.getElementById('panel-media');
  panel.innerHTML = `
    ${
      hasYouTubeKey
        ? `
    <div class="media-search-bar">
      <input type="search" id="media-q" class="media-q"
             placeholder="Buscar en YouTube…"
             aria-label="Buscar en YouTube"
             autocomplete="off" spellcheck="false" />
      <button class="media-search-btn" id="media-search-btn" aria-label="Buscar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </button>
    </div>`
        : ''
    }
    <div class="media-main" id="media-main">
      <iframe id="media-frame" class="media-frame" style="display:none"
        allow="autoplay; fullscreen; encrypted-media"
        allowfullscreen title="Reproductor multimedia"></iframe>
      <div id="media-results" class="media-results" style="display:none"
           role="list" aria-label="Resultados de búsqueda"></div>
      <div id="media-placeholder" class="media-placeholder">
        ${
          hasYouTubeKey
            ? `<svg class="yt-logo" viewBox="0 0 159 110" xmlns="http://www.w3.org/2000/svg" aria-label="YouTube">
               <path fill="#FF0000" d="M154 17.5a19.8 19.8 0 0 0-13.9-14C127.6 0 80 0 80 0S32.4 0 19.9 3.5A19.8 19.8 0 0 0 6 17.5C2.5 30 2.5 55 2.5 55s0 25 3.5 37.5A19.8 19.8 0 0 0 19.9 106.5C32.4 110 80 110 80 110s47.6 0 60.1-3.5A19.8 19.8 0 0 0 154 92.5C157.5 80 157.5 55 157.5 55s0-25-3.5-37.5Z"/>
               <path fill="#FFF" d="M64 78.4 105 55 64 31.6v46.8Z"/>
             </svg>`
            : '<p class="media-ph-icon">📺</p><p class="media-ph-text">Configura <code>MEDIA_IFRAME_URL</code> o <code>YOUTUBE_API_KEY</code> en <code>.env</code></p>'
        }
      </div>
    </div>
  `;

  // Load default embed
  if (defaultUrl) loadEmbed(toEmbedUrl(defaultUrl));

  // Search events
  if (hasYouTubeKey) {
    const input = document.getElementById('media-q');
    const btn = document.getElementById('media-search-btn');
    btn.addEventListener('click', () => doSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch(input.value);
    });
  }
}

// ── Load embed ─────────────────────────────────────────────────────────────
function loadEmbed(url) {
  const frame = document.getElementById('media-frame');
  const placeholder = document.getElementById('media-placeholder');
  const results = document.getElementById('media-results');

  frame.src = url;
  frame.style.display = 'block';
  results.style.display = 'none';
  placeholder.style.display = 'none';
}

// ── Search ─────────────────────────────────────────────────────────────────
async function doSearch(query) {
  const q = query?.trim();
  if (!q) return;

  const results = document.getElementById('media-results');
  const placeholder = document.getElementById('media-placeholder');
  const frame = document.getElementById('media-frame');

  // Show loading state
  frame.style.display = 'none';
  placeholder.style.display = 'none';
  results.style.display = 'grid';
  results.innerHTML = '<p class="media-searching" role="status" aria-live="polite">Buscando…</p>';

  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
    const items = await res.json();

    if (!res.ok || !items.length) {
      results.innerHTML = '<p class="media-searching">Sin resultados</p>';
      return;
    }

    results.innerHTML = '';

    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'media-result';
      btn.setAttribute('role', 'listitem');
      btn.setAttribute('aria-label', escHtml(item.title));
      btn.innerHTML = `
        <img class="media-result-thumb" src="${escHtml(item.thumb)}" alt="" loading="lazy" />
        <span class="media-result-title">${escHtml(item.title)}</span>
        <span class="media-result-channel">${escHtml(item.channel)}</span>
      `;
      btn.addEventListener('click', () => {
        loadEmbed(`https://www.youtube.com/embed/${item.id}?autoplay=1`);
      });
      results.appendChild(btn);

      gsap.fromTo(
        btn,
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.3, delay: i * 0.04, ease: 'power2.out' }
      );
    });
  } catch (err) {
    results.innerHTML = '<p class="media-searching">Error al buscar</p>';
    console.error('YouTube search:', err);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
export async function initMedia() {
  try {
    const res = await fetch('/api/media-url');
    const { url, youtubeKey } = await res.json();
    buildPanel(youtubeKey, youtubeKey ? null : url);
  } catch (err) {
    console.error('Media init:', err);
  }
}
