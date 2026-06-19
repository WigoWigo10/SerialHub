import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Wifi, WifiOff, Circle } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";

export function StatusBar() {
  const [version, setVersion] = useState("1.2.1");
  const [osName, setOsName] = useState("Unknown");
  
  const { isRecording, connected, activePort } = useSettingsStore();
  const { t } = useLanguage();

  useEffect(() => {
    getVersion().then(v => setVersion(v)).catch(() => setVersion("Dev"));

    const userAgent = navigator.userAgent;
    if (userAgent.indexOf("Win") !== -1) setOsName("Windows");
    else if (userAgent.indexOf("Linux") !== -1) setOsName("Linux");
    else if (userAgent.indexOf("Mac") !== -1) setOsName("macOS");
  }, []);

  return (
    <div className="h-6 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center px-3 text-[10px] text-slate-500 dark:text-slate-500 select-none justify-between transition-colors duration-300 font-mono">
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 hover:text-slate-800 dark:hover:text-slate-300 transition-colors cursor-default">
            <span>SerialHub</span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1 rounded">v{version}</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-600">
            <span>{osName}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        
        {isRecording && (
            <div className="flex items-center gap-1 text-red-500 animate-pulse font-bold">
                <Circle size={8} fill="currentColor" />
                <span>REC</span>
            </div>
        )}

        <div className="flex items-center gap-1">
            {connected ? (
                <>
                    <Wifi size={12} className="text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-500 font-medium">
                        {t('status_connected')} ({activePort})
                    </span>
                </>
            ) : (
                <>
                    <WifiOff size={12} className="text-slate-400" />
                    <span className="text-slate-400">
                        {t('status_ready')}
                    </span>
                </>
            )}
        </div>
      </div>
    </div>
  );
}
