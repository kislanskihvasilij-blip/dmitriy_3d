/* BREEZE 3D — шестерни на главном экране: HUD в такт SVG-анимации (SMIL), пауза вне экрана, наклон за курсором.
   Сама анимация живёт в SVG и работает даже без этого скрипта. */
(() => {
  'use strict';

  const svg = document.querySelector('[data-gears]');
  if (!svg || typeof svg.getCurrentTime !== 'function') return;

  const viewport = svg.closest('.viewport');
  const CYCLE_SECONDS = Number(svg.dataset.cycle) || 12.8;
  const SCAN_SECONDS = 4.2;        // совпадает с keyTimes в SVG
  const HOLD_SECONDS = 2.2;
  const HUD_INTERVAL_MS = 80;
  const MAX_TILT_DEG = 9;
  const STAGES = Object.freeze([
    { until: 0.02, label: 'Облако точек' },
    { until: 0.98, label: 'Построение модели' },
    { until: Infinity, label: 'CAD-модель готова' },
  ]);

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
  const stageEl = document.querySelector('[data-scan-stage]');
  const valueEl = document.querySelector('[data-scan-value]');
  const barEl = document.querySelector('[data-scan-bar]');

  // keySplines ".65 0 .35 1" в SVG ≈ кубическое ease-in-out
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function progressAt(seconds) {
    const local = seconds % CYCLE_SECONDS;
    if (local < SCAN_SECONDS) return easeInOut(local / SCAN_SECONDS);
    if (local < SCAN_SECONDS + HOLD_SECONDS) return 1;
    const back = local - SCAN_SECONDS - HOLD_SECONDS;
    if (back < SCAN_SECONDS) return 1 - easeInOut(back / SCAN_SECONDS);
    return 0;
  }

  let lastPercent = -1;
  function renderHud() {
    const progress = progressAt(svg.getCurrentTime());
    const percent = Math.round(progress * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    if (valueEl) valueEl.textContent = `${percent}%`;
    if (barEl) barEl.style.setProperty('--p', progress.toFixed(3));
    if (stageEl) stageEl.textContent = STAGES.find((stage) => progress < stage.until).label;
  }

  viewport?.classList.add('is-live');

  if (prefersReducedMotion) {
    svg.setCurrentTime(SCAN_SECONDS + HOLD_SECONDS / 2); // статичный кадр: готовая модель
    svg.pauseAnimations();
    renderHud();
    return;
  }

  // Вне экрана останавливаем и SMIL, и обновление HUD
  let hudTimer = 0;
  new IntersectionObserver(([entry]) => {
    clearInterval(hudTimer);
    if (entry.isIntersecting) {
      svg.unpauseAnimations();
      renderHud();
      hudTimer = setInterval(renderHud, HUD_INTERVAL_MS);
    } else {
      svg.pauseAnimations();
    }
  }).observe(svg);

  if (!hasFinePointer || !viewport) return;
  viewport.addEventListener('pointermove', (event) => {
    const rect = viewport.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    svg.style.setProperty('--ry', `${(x * MAX_TILT_DEG * 2).toFixed(2)}deg`);
    svg.style.setProperty('--rx', `${(-y * MAX_TILT_DEG * 2).toFixed(2)}deg`);
  });
  viewport.addEventListener('pointerleave', () => {
    svg.style.setProperty('--rx', '0deg');
    svg.style.setProperty('--ry', '0deg');
  });
})();
