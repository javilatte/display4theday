const SPEED = 60; // px/s

let anim = null;

import { escHtml, safeHref } from './util.js';

function fmtTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function buildItem(item, hidden) {
  const el = document.createElement('span');
  el.className = 'news-item';
  if (hidden) {
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('tabindex', '-1');
  }
  const time = fmtTime(item.pubDate);
  const link = safeHref(item.link);
  el.innerHTML = `
    ${time ? `<span class="news-time-label" aria-hidden="true">${time}</span>` : ''}
    <span class="news-bullet" aria-hidden="true">●</span>
    <a class="news-headline"
       ${link ? `href="${escHtml(link)}"` : ''}
       target="_blank" rel="noopener noreferrer"
       tabindex="${hidden ? '-1' : '0'}">${escHtml(item.title)}</a>`;
  return el;
}

function startScroll(ticker) {
  if (anim) anim.kill();
  gsap.set(ticker, { x: 0 });

  const halfW = ticker.scrollWidth / 2;
  if (halfW < 10) return;

  anim = gsap.to(ticker, {
    x: -halfW,
    duration: halfW / SPEED,
    ease: 'none',
    repeat: -1,
    onRepeat: () => gsap.set(ticker, { x: 0 }),
  });
}

function render(items) {
  const ticker = document.getElementById('news-ticker');
  const wrap = document.getElementById('news-ticker-wrap');

  const sorted = [...items].sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta; // más recientes primero
  });

  ticker.innerHTML = '';

  sorted.forEach((item) => ticker.appendChild(buildItem(item, false)));
  sorted.forEach((item) => ticker.appendChild(buildItem(item, true)));

  requestAnimationFrame(() => startScroll(ticker));

  if (wrap) {
    wrap.addEventListener('mouseenter', () => anim?.pause(), { passive: true });
    wrap.addEventListener('mouseleave', () => anim?.resume(), { passive: true });
    wrap.addEventListener('focusin', () => anim?.pause(), { passive: true });
    wrap.addEventListener('focusout', () => anim?.resume(), { passive: true });
  }
}

export async function initNews() {
  async function load() {
    try {
      const res = await fetch('/api/news');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();
      if (items?.length) render(items);
    } catch (err) {
      console.error('News:', err);
      document.getElementById('news-ticker').innerHTML =
        '<span class="news-loading">No se pudieron cargar las noticias</span>';
    }
  }

  await load();
  setInterval(load, 10 * 60_000);
}
