import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../stores/settingsStore";

export function useDataMonitor() {
  const { addRxBytes, addTxBytes } = useSettingsStore();

  useEffect(() => {
    const unlistenRx = listen<string>("serial-data", (event) => {
      addRxBytes(event.payload.length);
    });

    const unlistenTx = listen<number>("serial-tx", (event) => {
      addTxBytes(event.payload);
    });

    return () => {
      unlistenRx.then((f) => f());
      unlistenTx.then((f) => f());
    };
  }, []);
}