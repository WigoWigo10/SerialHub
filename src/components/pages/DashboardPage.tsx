import { useEffect, useState, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { 
  Cpu, MemoryStick, AlertTriangle, CheckCircle2, LayoutDashboard,
  Layers, Zap, MonitorPlay, BrainCircuit, Battery, BatteryCharging, Plug, Bluetooth, Globe,
  ArrowUpCircle, ArrowDownCircle, Activity, History
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";

interface SystemStats {
  cpu_load: number;
  mem_used: number;
  mem_total: number;
  cpu_brand: string;
  cpu_vendor: string;
  cpu_freq: number;
  cores_phys: number;
  cores_log: number;
  gpu_name: string;
  ram_details: string;
  ram_speed: number;
  npu_name: string;
  has_battery: boolean;
  bat_percent: number;
  is_charging: boolean;
  net_name: string;
  bt_detected: boolean;
}

export function DashboardPage() {
  const { t } = useLanguage();
  
  const { 
    connected, 
    activePort, 
    connectionStartTime,
    txBytes,
    rxBytes,
    addRxBytes,
    addTxBytes
  } = useSettingsStore();
  
  const [stats, setStats] = useState<SystemStats>({ 
    cpu_load: 0, mem_used: 0, mem_total: 0, cpu_freq: 0,
    cpu_brand: "Carregando...", cpu_vendor: "", cores_phys: 0, cores_log: 0,
    gpu_name: "-", ram_details: "-", ram_speed: 0, npu_name: "None",
    has_battery: false, bat_percent: 0, is_charging: false, 
    net_name: "Buscando...", bt_detected: false
  });

  const [cpuHistory, setCpuHistory] = useState<number[]>(new Array(30).fill(0));
  const [durationStr, setDurationStr] = useState("00:00:00");

  useEffect(() => {
    const unlisten = listen<SystemStats>("system-stats", (event) => {
      const newStats = event.payload;
      setStats(newStats);
      setCpuHistory(prev => {
        const newHistory = [...prev, newStats.cpu_load];
        if (newHistory.length > 30) newHistory.shift();
        return newHistory;
      });
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    const updateTimer = () => {
      if (connected && connectionStartTime) {
        const diff = Math.floor((Date.now() - connectionStartTime) / 1000);
        const hh = Math.floor(diff / 3600).toString().padStart(2, '0');
        const mm = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const ss = (diff % 60).toString().padStart(2, '0');
        setDurationStr(`${hh}:${mm}:${ss}`);
      } else {
        setDurationStr("00:00:00");
      }
    };

    if (connected) {
      updateTimer();
      interval = setInterval(updateTimer, 1000);
    }
    return () => clearInterval(interval);
  }, [connected, connectionStartTime]);

  useEffect(() => {
    const unlistenTx = listen<any>("serial-sent", (event) => {
      const len = event.payload.length || 0;
      addTxBytes(len);
    });

    return () => { 
      unlistenTx.then(f => f()); 
    };
  }, [addRxBytes, addTxBytes]);

  const formatDataSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  };

  const graphPath = useMemo(() => {
    const max = 100;
    const width = 100; 
    const height = 40; 
    const step = width / (cpuHistory.length - 1);
    const points = cpuHistory.map((val, i) => `${i * step},${height - (val / max) * height}`).join(" ");
    return {
        line: `M ${points}`,
        fill: `M ${points} L 100,40 L 0,40 Z` 
    };
  }, [cpuHistory]);

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  //const getLoadColor = (value: number) => {
    //if (value > 80) return "text-red-500";
    //if (value > 50) return "text-yellow-500";
    //return "text-emerald-500";
  //};

  const getBatteryColor = (percent: number) => {
      if (percent < 20) return "text-red-500 bg-red-100 dark:bg-red-900/20";
      if (percent < 50) return "text-yellow-500 bg-yellow-100 dark:bg-yellow-900/20";
      return "text-emerald-500 bg-emerald-100 dark:bg-emerald-900/20";
  };

  const memPercent = stats.mem_total > 0 ? (stats.mem_used / stats.mem_total) * 100 : 0;

  return (
    <div className="flex-1 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 h-full overflow-y-auto animate-in fade-in zoom-in-95 duration-200 transition-colors duration-300">
      
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        
        <div className="flex items-center justify-between pb-6 border-b border-slate-200 dark:border-slate-800">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <LayoutDashboard className="text-blue-500" size={32} />
                    {t('ws_dashboard_title')}
                </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                        {t('dash_subtitle')}
                    </p>
            </div>
            <div className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500">
                v1.2.0
            </div>
        </div>

        <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                <Cpu size={16} /> {t('dash_cpu_info')}
            </div>

            <div className="bg-slate-50/50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
                <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 bg-blue-100 dark:bg-blue-500/10 rounded-lg text-blue-600 dark:text-blue-400">
                        <Cpu size={32} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{stats.cpu_brand}</h2>
                        <div className="flex gap-3 mt-1 text-xs font-mono text-slate-500">
                            <span>{stats.cpu_vendor}</span>
                            <span>•</span>
                            <span className={stats.cpu_freq > 3000 ? "text-emerald-500 font-bold" : ""}>{stats.cpu_freq} MHz</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                     <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">{t('dash_cores_phys')}</div>
                        <div className="flex items-center gap-2 font-mono font-bold text-lg"><Cpu size={16} className="text-purple-500" /> {stats.cores_phys}
                        </div>
                     </div>
                     <div className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                        <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">{t('dash_threads')}</div>
                        <div className="flex items-center gap-2 font-mono font-bold text-lg">
                            <Layers size={16} className="text-blue-500" /> {stats.cores_log}
                        </div>
                     </div>
                     <div className="bg-white dark:bg-slate-900 p-0 rounded-lg border border-slate-200 dark:border-slate-800 col-span-2 overflow-hidden relative flex flex-col justify-between">
                        <div className="absolute top-3 left-3 z-10">
                            <span className="text-[10px] text-slate-400 uppercase font-bold">{t('dash_realtime_load')}</span>
                        </div>
                        <div className="absolute top-2 right-3 z-10">
                            <span className={`text-xl font-mono font-bold ${stats.cpu_load > 80 ? 'text-red-500' : 'text-emerald-500'}`}>
                                {stats.cpu_load.toFixed(1)}%
                            </span>
                        </div>
                        <div className="w-full h-16 mt-auto">
                            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-full">
                                <defs>
                                    <linearGradient id="cpuGradient" x1="0" x2="0" y1="0" y2="1">
                                        <stop offset="0%" stopColor="rgb(16, 185, 129)" stopOpacity="0.4" />
                                        <stop offset="100%" stopColor="rgb(16, 185, 129)" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <path d={graphPath.fill} fill="url(#cpuGradient)" />
                                <path d={graphPath.line} fill="none" stroke="rgb(16, 185, 129)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                            </svg>
                        </div>
                     </div>
                </div>
            </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
                 <div className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    <MonitorPlay size={16} /> {t('dash_graphics_ai')}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 h-[160px] flex flex-col justify-center">
                    <div className="flex items-center gap-4">
                        <div className="p-2.5 bg-orange-100 dark:bg-orange-500/10 rounded-lg text-orange-600 dark:text-orange-400">
                            <MonitorPlay size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-slate-400 uppercase font-bold">{t('dash_gpu')} ({t('dash_graphics_ai')})</div>
                            <div className="font-bold truncate text-sm" title={stats.gpu_name}>{stats.gpu_name}</div>
                        </div>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-slate-800" />
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-lg ${stats.npu_name !== "None" ? "bg-pink-100 dark:bg-pink-500/10 text-pink-600 dark:text-pink-400" : "bg-slate-100 dark:bg-slate-800 text-slate-400"}`}>
                            <BrainCircuit size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs text-slate-400 uppercase font-bold">{t('dash_npu')} (Neural Processor)</div>
                            <div className="font-bold truncate text-sm">{stats.npu_name !== "None" ? stats.npu_name : t('dash_npu_not_found')}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                    <MemoryStick size={16} /> {t('dash_memory')}
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 h-[160px] flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-yellow-100 dark:bg-yellow-500/10 rounded-lg text-yellow-600 dark:text-yellow-500">
                                <Zap size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm">{stats.ram_details}</h3>
                                <p className="text-xs text-slate-500 font-mono">{stats.ram_speed} MT/s</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xl font-mono font-bold">{memPercent.toFixed(0)}%</div>
                            <div className="text-[10px] text-slate-400 uppercase">{t('dash_ram_in_use')}</div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div 
                                className={`h-full transition-all duration-500 ease-out ${
                                    memPercent > 85 ? 'bg-red-500' : 
                                    memPercent > 60 ? 'bg-orange-500' : 'bg-yellow-500'
                                }`} 
                                style={{ width: `${memPercent}%` }}
                                />
                            </div>
                        <div className="flex justify-between text-xs font-mono text-slate-500">
                            <span>{t('dash_ram_used')}: {formatBytes(stats.mem_used)}</span>
                            <span>{t('dash_ram_total')}: {formatBytes(stats.mem_total)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                <Zap size={16} /> {t('dash_power_title')}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* POWER CARD */}
                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-full ${stats.has_battery ? getBatteryColor(stats.bat_percent) : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
                            {stats.has_battery ? (stats.is_charging ? <BatteryCharging size={24} /> : <Battery size={24} />) : <Plug size={24} />}
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200">
                                {stats.has_battery ? t('dash_battery') : t('dash_ac_power')}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {stats.has_battery 
                                    ? (stats.is_charging ? t('dash_charging') : t('dash_discharging')) 
                                    : "Desktop / AC"
                                }
                            </p>
                        </div>
                    </div>
                    {stats.has_battery && (
                        <div className="text-right">
                            <span className="text-2xl font-bold font-mono">{stats.bat_percent}%</span>
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-center space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Globe size={18} className="text-blue-500" />
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('dash_network')}</span>
                        </div>
                        <span className="text-xs font-mono text-slate-500 truncate max-w-[150px]">{stats.net_name}</span>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-slate-800" />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Bluetooth size={18} className={stats.bt_detected ? "text-blue-500" : "text-slate-400"} />
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('dash_bluetooth')}</span>
                        </div>
                        <span className={`text-xs font-bold ${stats.bt_detected ? "text-emerald-500" : "text-slate-400"}`}>
                            {stats.bt_detected ? t('dash_detected') : t('dash_not_detected')}
                        </span>
                    </div>
                </div>
            </div>
        </section>

        <section className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800/50">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-500 uppercase tracking-widest">
                <Activity size={16} /> {t('dash_serial_telemetry')}
            </div>
            
            {connected ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-6 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                        <div className="flex items-center gap-3 mb-4">
                            <CheckCircle2 className="text-emerald-500" size={24} />
                            <div>
                                <h3 className="font-bold">{activePort}</h3>
                                <p className="text-[10px] uppercase font-bold text-emerald-600">Online</p>
                            </div>
                        </div>
                        <div className="text-2xl font-mono font-bold flex items-center gap-2">
                            <History size={20} className="text-blue-500" />
                            {durationStr}
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                            <span>{t('dash_tx_data')}</span>
                            <ArrowUpCircle size={16} className="text-blue-500" />
                        </div>
                        <div className="text-2xl font-mono font-bold mt-2">{formatDataSize(txBytes)}</div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                        <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-400">
                            <span>{t('dash_rx_data')}</span>
                            <ArrowDownCircle size={16} className="text-emerald-500" />
                        </div>
                        <div className="text-2xl font-mono font-bold mt-2">{formatDataSize(rxBytes)}</div>
                    </div>
                </div>
            ) : (
                <div className="bg-slate-50 dark:bg-slate-900/20 p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-center opacity-50">
                    <AlertTriangle size={24} className="mb-2" />
                    <h3 className="font-bold text-sm">{t('dash_no_connection')}</h3>
                </div>
            )}
        </section>
      </div>
    </div>
  );
}