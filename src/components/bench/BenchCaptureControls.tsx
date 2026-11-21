import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../hooks/useLanguage";

type CaptureMode = "metrics" | "mqtt" | "hybrid";
interface CaptureInfo { id: string; path: string; mode: CaptureMode }
interface Summary {
  info: CaptureInfo;
  duration_ms: number;
  counts: { mqtt_messages: number; serial_queue_drops: number; mqtt_queue_drops: number };
  correlation: { paired: number; serial_only: number; mqtt_only: number } | null;
}
interface CaptureStatus {
  active: CaptureInfo | null;
  busy: boolean;
  failed: boolean;
  last: Summary | null;
}

const button = "rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50";

export function BenchCaptureControls({ mqttOnly = false }: { mqttOnly?: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await invoke<CaptureStatus>("bench_capture_status");
        if (!disposed) setStatus(next);
      } catch (cause) {
        if (!disposed) setError(String(cause));
      }
      if (!disposed) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  async function run(mode?: CaptureMode) {
    setPending(true);
    setError("");
    try {
      if (mode) {
        const parent = await open({ directory: true, multiple: false });
        if (!parent || Array.isArray(parent)) return;
        await invoke("start_bench_capture", { parent, mode });
      } else if (status?.active) {
        await invoke("stop_bench_capture", { id: status.active.id });
      }
      setStatus(await invoke<CaptureStatus>("bench_capture_status"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  }

  const disabled = !status || pending || status.busy;
  const latest = status?.last;
  return (
    <div className="min-w-0 space-y-1.5 text-slate-700 dark:text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        {status?.active ? (
          <button type="button" className={button} disabled={disabled} onClick={() => void run()}>{t("capture_stop")}</button>
        ) : mqttOnly ? (
          <button type="button" className={button} disabled={disabled} onClick={() => void run("mqtt")}>{t("capture_mqtt")}</button>
        ) : (
          <>
            <button type="button" className={button} disabled={disabled} onClick={() => void run("metrics")}>{t("capture_metrics")}</button>
            <button type="button" className={button} disabled={disabled} onClick={() => void run("hybrid")}>{t("capture_hybrid")}</button>
          </>
        )}
        {status?.active && <span className="text-xs font-medium">{status.failed ? t("capture_failed") : t("capture_active")}</span>}
      </div>
      {status?.active && <p className="break-all text-xs text-slate-600 dark:text-slate-400">{status.active.path}</p>}
      {!status?.active && latest && (
        <div className="text-xs text-slate-600 dark:text-slate-400" aria-live="polite">
          <p className="break-all">{latest.info.path}</p>
          <p>{(latest.duration_ms / 1000).toFixed(1)} s · MQTT {latest.counts.mqtt_messages} · {t("capture_drops")} {latest.counts.serial_queue_drops + latest.counts.mqtt_queue_drops}
            {latest.correlation && ` · ${t("capture_paired")} ${latest.correlation.paired}`}
          </p>
        </div>
      )}
      {error && <p role="alert" className="break-words text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
