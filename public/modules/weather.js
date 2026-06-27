const WMO = {
  0: { day: '☀️', night: '🌙', desc: 'Despejado' },
  1: { day: '🌤️', night: '🌙', desc: 'Principalmente despejado' },
  2: { day: '⛅', night: '☁️', desc: 'Parcialmente nublado' },
  3: { day: '☁️', night: '☁️', desc: 'Nublado' },
  45: { day: '🌫️', night: '🌫️', desc: 'Niebla' },
  48: { day: '🌫️', night: '🌫️', desc: 'Niebla con escarcha' },
  51: { day: '🌦️', night: '🌦️', desc: 'Llovizna ligera' },
  53: { day: '🌦️', night: '🌦️', desc: 'Llovizna moderada' },
  55: { day: '🌧️', night: '🌧️', desc: 'Llovizna intensa' },
  61: { day: '🌧️', night: '🌧️', desc: 'Lluvia ligera' },
  63: { day: '🌧️', night: '🌧️', desc: 'Lluvia moderada' },
  65: { day: '🌧️', night: '🌧️', desc: 'Lluvia intensa' },
  71: { day: '🌨️', night: '🌨️', desc: 'Nieve ligera' },
  73: { day: '🌨️', night: '🌨️', desc: 'Nieve moderada' },
  75: { day: '❄️', night: '❄️', desc: 'Nieve intensa' },
  80: { day: '🌦️', night: '🌦️', desc: 'Chubascos' },
  81: { day: '🌧️', night: '🌧️', desc: 'Chubascos moderados' },
  82: { day: '⛈️', night: '⛈️', desc: 'Chubascos intensos' },
  95: { day: '⛈️', night: '⛈️', desc: 'Tormenta' },
  96: { day: '⛈️', night: '⛈️', desc: 'Tormenta con granizo' },
  99: { day: '⛈️', night: '⛈️', desc: 'Tormenta intensa' },
};

function wmoInfo(code, isNight) {
  const exact = WMO[code];
  if (exact) return { emoji: isNight ? exact.night : exact.day, desc: exact.desc };
  const keys = Object.keys(WMO)
    .map(Number)
    .sort((a, b) => b - a);
  for (const k of keys) {
    if (code >= k) {
      const w = WMO[k];
      return { emoji: isNight ? w.night : w.day, desc: w.desc };
    }
  }
  return { emoji: '🌡️', desc: 'Desconocido' };
}

function hourEmoji(code, h) {
  const night = h < 6 || h >= 21;
  const info = wmoInfo(code, night);
  return info.emoji;
}

function setIcon(emoji) {
  const wrap = document.getElementById('w-icon-wrap');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  gsap.killTweensOf(wrap);
  wrap.innerHTML = `<span class="w-emoji" aria-hidden="true">${emoji}</span>`;

  if (!reduced) {
    gsap.fromTo(
      wrap,
      { scale: 0.5, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
    );
    gsap.to(wrap, { y: -5, duration: 2.5, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 0.5 });
  }
}

function renderHourly(hourly) {
  const container = document.getElementById('w-hourly');
  if (!container || !hourly) return;

  const now = new Date();
  const startIdx = hourly.time.findIndex((t) => new Date(t) >= now);
  if (startIdx === -1) return;

  container.innerHTML = '';
  hourly.time.slice(startIdx, startIdx + 7).forEach((timeStr, i) => {
    const idx = startIdx + i;
    const h = new Date(timeStr).getHours();
    const temp = Math.round(hourly.temperature_2m[idx]);
    const emoji = hourEmoji(hourly.weather_code[idx], h);

    const cell = document.createElement('div');
    cell.className = 'w-hour-cell';
    cell.setAttribute('aria-label', `${h}:00 — ${temp}°`);
    cell.innerHTML = `
      <span class="w-hour-time">${String(h).padStart(2, '0')}h</span>
      <span class="w-hour-icon" aria-hidden="true">${emoji}</span>
      <span class="w-hour-temp">${temp}°</span>
    `;
    container.appendChild(cell);

    gsap.fromTo(
      cell,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.3, delay: i * 0.05, ease: 'power2.out' }
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`/api/geocode?lat=${lat}&lon=${lon}`);
    const d = await r.json();
    return d.name || '';
  } catch {
    return '';
  }
}

export async function initWeather() {
  const tempEl = document.getElementById('w-temp');
  const descEl = document.getElementById('w-desc');
  const humEl = document.getElementById('w-humidity');
  const windEl = document.getElementById('w-wind');
  const highEl = document.getElementById('w-high');
  const lowEl = document.getElementById('w-low');
  const locEl = document.getElementById('w-location');

  setIcon('⏳');

  async function fetchWeather(lat, lon) {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&hourly=temperature_2m,weather_code` +
      `&wind_speed_unit=kmh&timezone=auto&forecast_days=2`;

    const r = await fetch(url);
    const d = await r.json();
    const c = d.current;

    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 21;
    const { emoji, desc } = wmoInfo(c.weather_code, isNight);

    setIcon(emoji);
    tempEl.textContent = `${Math.round(c.temperature_2m)}°`;
    descEl.textContent = desc;
    humEl.textContent = `💧 ${c.relative_humidity_2m}%`;
    windEl.textContent = `💨 ${Math.round(c.wind_speed_10m)} km/h`;

    if (d.daily) {
      highEl.textContent = `↑ ${Math.round(d.daily.temperature_2m_max[0])}°`;
      lowEl.textContent = `↓ ${Math.round(d.daily.temperature_2m_min[0])}°`;
    }

    renderHourly(d.hourly);

    if (!locEl.textContent) {
      const city = await reverseGeocode(lat, lon);
      if (city) locEl.textContent = `📍 ${city}`;
    }
  }

  const DEFAULT_LAT = Number(window.__D4TD_CONFIG__?.weatherDefaultLat) || 0;
  const DEFAULT_LON = Number(window.__D4TD_CONFIG__?.weatherDefaultLon) || 0;
  const DEFAULT_CITY = window.__D4TD_CONFIG__?.weatherDefaultCity || 'Sin ubicación';

  function useDefault() {
    locEl.textContent = `📍 ${DEFAULT_CITY}`;
    fetchWeather(DEFAULT_LAT, DEFAULT_LON).catch(console.error);
  }

  if (!navigator.geolocation) {
    useDefault();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => fetchWeather(coords.latitude, coords.longitude).catch(console.error),
    useDefault,
    { timeout: 10000 }
  );

  setInterval(
    () => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => fetchWeather(coords.latitude, coords.longitude).catch(console.error),
        () => fetchWeather(DEFAULT_LAT, DEFAULT_LON).catch(console.error)
      );
    },
    20 * 60 * 1000
  );
}
