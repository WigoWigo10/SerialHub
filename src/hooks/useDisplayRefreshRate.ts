import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useDisplayRefreshRate() {
  const [hz, setHz] = useState<number | null>(null);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const value = await invoke<number | null>('display_refresh_rate');
        if (!disposed) setHz(value !== null && Number.isFinite(value) && value > 1 ? value : null);
      } catch {
        if (!disposed) setHz(null);
      } finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return hz;
}
