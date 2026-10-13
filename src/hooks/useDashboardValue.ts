import { useEffect, useRef, useState } from 'react';
import { animateValue, DashboardRefreshRate, normalizeRefreshRate } from '../lib/dashboardRefresh';

export function useDashboardValue(target: number, rate: DashboardRefreshRate) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    let cancel = () => {};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const publish = (next: number) => { current.current = next; setValue(next); };
    const restart = () => {
      cancel();
      if (document.hidden || reduced.matches) {
        publish(target);
      } else {
        cancel = animateValue(current.current, target, normalizeRefreshRate(rate), publish, {
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
  return value;
}
