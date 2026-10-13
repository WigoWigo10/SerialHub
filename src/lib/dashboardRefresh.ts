export type DashboardRefreshRate = 'auto' | 15 | 30 | 60 | 120;
export const DASHBOARD_REFRESH_RATES: DashboardRefreshRate[] = ['auto', 15, 30, 60, 120];
export const HARDWARE_SAMPLE_MS = 500;

export function normalizeRefreshRate(value: unknown): DashboardRefreshRate {
  return DASHBOARD_REFRESH_RATES.includes(value as DashboardRefreshRate)
    ? value as DashboardRefreshRate : 'auto';
}

export function isRefreshRateAvailable(rate: DashboardRefreshRate, displayHz: number | null): boolean {
  // Integer Windows modes may report 59 Hz for a nominal 60 Hz display.
  return rate === 'auto' || (displayHz !== null && Number.isFinite(displayHz)
    && displayHz > 1 && rate <= displayHz + 1);
}

export function effectiveRefreshRate(value: unknown, displayHz: number | null): DashboardRefreshRate {
  const rate = normalizeRefreshRate(value);
  return isRefreshRateAvailable(rate, displayHz) ? rate : 'auto';
}

interface FrameClock {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
}

// FPS controls presentation only. Values between native samples are interpolated.
export function animateValue(
  from: number, to: number, rate: DashboardRefreshRate,
  publish: (value: number) => void, clock: FrameClock,
): () => void {
  const started = clock.now();
  const interval = 1000 / (rate === 'auto' ? 120 : rate);
  let lastSlot = 0;
  let frame = 0;
  let stopped = false;
  const tick = (time: number) => {
    if (stopped) return;
    const progress = Math.min(1, Math.max(0, (time - started) / HARDWARE_SAMPLE_MS));
    const slot = interval === 0 ? lastSlot + 1 : Math.floor((time - started + 0.01) / interval);
    if (progress === 1 || slot > lastSlot) {
      publish(from + (to - from) * progress);
      // Keep the requested cadence without accumulating rounding drift.
      lastSlot = slot;
    }
    if (progress < 1) frame = clock.request(tick);
  };
  if (from === to) return () => {};
  frame = clock.request(tick);
  return () => { stopped = true; clock.cancel(frame); };
}
