import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../stores/settingsStore";
import { listenSafely } from "../lib/serialPresentation";

export function useDataMonitor() {
  const addRxBytes = useSettingsStore((state) => state.addRxBytes);
  const addTxBytes = useSettingsStore((state) => state.addTxBytes);

  useEffect(() => {
    const unlistenRx = listenSafely<{ payload: number[] }>(receive => listen<number[]>("serial-data", receive), (event) => {
      addRxBytes(event.payload.length);
    });

    const unlistenTx = listenSafely<{ payload: number }>(receive => listen<number>("serial-tx", receive), (event) => {
      addTxBytes(event.payload);
    });

    return () => {
      unlistenRx(); unlistenTx();
    };
  }, [addRxBytes, addTxBytes]);
}
