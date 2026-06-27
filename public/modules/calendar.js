// Calendar panel: embeds Google Calendar's public iframe directly. No
// OAuth, no API tokens, no server-side data — just the operator's
// configured GOOGLE_CALENDAR_EMBED_URL.

const PLACEHOLDER_HTML = `
  <div class="cal-empty">
    <p>Añade <code>GOOGLE_CALENDAR_EMBED_URL</code> a tu <code>.env</code> para mostrar el calendario aquí.</p>
    <p class="cal-hint">En Google Calendar: Configuración → tu calendario → <em>Integrar calendario</em> → copia la <em>URL pública</em>.</p>
  </div>
`;

export async function initCalendar() {
  const panel = document.getElementById('cal-loading');
  if (!panel) return;

  let embedUrl = '';
  try {
    const res = await fetch('/api/calendar-embed-url');
    if (res.ok) {
      const { url } = await res.json();
      embedUrl = url;
    }
  } catch {
    // network error: leave empty
  }

  if (!embedUrl) {
    panel.innerHTML = PLACEHOLDER_HTML;
    return;
  }

  // Clear loading and inject the iframe. Google Calendar's embed page
  // sets its own cookies and reads its own settings; we just frame it.
  const wrap = document.getElementById('cal-body') || panel.parentElement;
  if (wrap) wrap.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.className = 'cal-iframe';
  iframe.src = embedUrl;
  iframe.title = 'Calendario';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('scrolling', 'no');
  iframe.loading = 'lazy';
  iframe.style.cssText = 'border:0;width:100%;height:100%;background:transparent;';
  iframe.setAttribute('allowtransparency', 'true');
  (wrap || panel).appendChild(iframe);
}
