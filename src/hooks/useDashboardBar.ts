import { useLayoutEffect, useRef } from 'react';
import { animateValue, type DashboardRefreshRate } from '../lib/dashboardRefresh';

export function useDashboardBar(target: number, rate: DashboardRefreshRate) {
  const bar = useRef<HTMLDivElement>(null);
  const current = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    let cancel = () => {};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const publish = (next: number) => {
      current.current = next;
      element.style.transform = `scaleX(${next / 100})`;
    };
    const restart = () => {
      cancel();
      if (current.current === null || document.hidden || reduced.matches) {
        publish(target);
      } else {
        cancel = animateValue(current.current, target, rate, publish, {
          now: () => performance.now(),
          request: (callback) => requestAnimationFrame(callback),
          cancel: (id) => cancelAnimationFrame(id),
        });
      }
    };
    restart();
    document.addEventListener('visibilitychange', restart);
    reduced.addEventListener('change', restart);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', restart);
      reduced.removeEventListener('change', restart);
    };
  }, [target, rate]);
  return bar;
}
