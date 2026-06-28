import { initWeather } from './modules/weather.js';
import { initCalendar } from './modules/calendar.js';
import { initTodo } from './modules/todo.js';
import { initMedia } from './modules/media.js';
import { initNews } from './modules/news.js';
import { initAI } from './modules/ai.js';

gsap.registerPlugin(TextPlugin);

// ── Time periods ───────────────────────────────────────────────────────────
const PERIODS = [
  { id: 'night', h: [0, 5], greeting: 'Buenas noches' },
  { id: 'dawn', h: [6, 8], greeting: 'Buenos días' },
  { id: 'morning', h: [9, 11], greeting: 'Buenos días' },
  { id: 'afternoon', h: [12, 17], greeting: 'Buenas tardes' },
  { id: 'sunset', h: [18, 20], greeting: 'Buenas tardes' },
  { id: 'evening', h: [21, 23], greeting: 'Buenas noches' },
];

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

// ── State ──────────────────────────────────────────────────────────────────
let currentPeriodId = null;

function getPeriod(hour) {
  return PERIODS.find((p) => hour >= p.h[0] && hour <= p.h[1]) ?? PERIODS[0];
}

// ── Background gradient transition ─────────────────────────────────────────
function transitionBackground(periodId) {
  const all = PERIODS.map((p) => `#bg-${p.id}`);
  const target = `#bg-${periodId}`;

  // Fade out all, fade in target
  gsap.to(
    all.filter((s) => s !== target),
    { opacity: 0, duration: 2.5, ease: 'power2.inOut' }
  );
  gsap.to(target, { opacity: 1, duration: 2.5, ease: 'power2.inOut' });
}

// ── Clock & greeting ───────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  // Clock
  document.getElementById('clock').textContent =
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  // Date line
  document.getElementById('date-line').textContent =
    `${DAYS_ES[now.getDay()][0].toUpperCase() + DAYS_ES[now.getDay()].slice(1)}, ${now.getDate()} de ${MONTHS_ES[now.getMonth()]} de ${now.getFullYear()}`;

  // Period change check
  const period = getPeriod(h);
  if (period.id !== currentPeriodId) {
    currentPeriodId = period.id;
    transitionBackground(period.id);

    const greetingEl = document.getElementById('greeting');
    gsap.to(greetingEl, {
      opacity: 0,
      y: -10,
      duration: 0.4,
      onComplete: () => {
        greetingEl.textContent = period.greeting;
        gsap.to(greetingEl, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' });
      },
    });
  }
}

// ── Initial entrance animations ────────────────────────────────────────────
function playEntrance() {
  const now = new Date();
  const period = getPeriod(now.getHours());
  currentPeriodId = period.id;

  // Set initial greeting & date
  document.getElementById('greeting').textContent = period.greeting;
  updateClock();

  // Background
  gsap.set(`#bg-${period.id}`, { opacity: 0 });
  gsap.to(`#bg-${period.id}`, { opacity: 1, duration: 3, ease: 'power2.inOut' });

  // Header elements
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.from('.greeting', { opacity: 0, y: 40, duration: 1 })
    .from('.date-line', { opacity: 0, y: 20, duration: 0.6 }, '-=0.5')
    .from('.clock', { opacity: 0, x: 30, duration: 0.8 }, '-=0.7');

  // Panel entrance — staggered slide up
  gsap.to('.panel', {
    opacity: 1,
    y: 0,
    duration: 0.7,
    stagger: 0.12,
    ease: 'power3.out',
    delay: 0.5,
  });
}

// ── Clock second-tick GSAP ────────────────────────────────────────────────
function startClockLoop() {
  // Align to next second boundary
  const delay = 1000 - (Date.now() % 1000);
  setTimeout(() => {
    updateClock();
    setInterval(updateClock, 60000); // update every minute (clock shows HH:MM)
  }, delay);
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  playEntrance();
  startClockLoop();

  // Initialise all panels in parallel
  await Promise.allSettled([
    initWeather(),
    initCalendar(),
    initTodo(),
    initMedia(),
    initNews(),
    initAI(),
  ]);
});
