import { save } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  RefreshCw,
  Usb,
  Monitor,
  Unplug,
  SlidersHorizontal,
  Circle,
  Clock,
  Gauge,
  ChevronDown,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";

interface SerialPort {
  port_name: string;
  port_type: string;
  vid: string;
  pid: string;
  manufacturer: string;
  product: string;
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export function Sidebar() {
  const { t } = useLanguage();

  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedBaud, setSelectedBaud] = useState(115200);

  const [advancedMode, setAdvancedMode] = useState(false);
  const [dataBits, setDataBits] = useState(8);
  const [stopBits, setStopBits] = useState(1);
  const [parity, setParity] = useState("None");
  const [flowControl, setFlowControl] = useState("None");

  const {
    viewMode,
    setViewMode,
    showTimestamp,
    toggleTimestamp,
    isRecording,
    setRecording,
    setConnected,
    setActivePort,
    activePort,
  } = useSettingsStore();

  const handleToggleRecord = async () => {
    if (isRecording) {
      try {
        await invoke("stop_recording");
        setRecording(false);
      } catch (error) {
        console.error("Erro ao parar:", error);
      }
    } else {
      try {
        const path = await save({
          filters: [{ name: "Log File", extensions: ["txt", "log"] }],
          defaultPath: "serial_log.txt",
        });
        if (path) {
          await invoke("start_recording", { filePath: path });
          setRecording(true);
        }
      } catch (error) {
        console.error("Erro ao salvar:", error);
      }
    }
  };

  const scanPorts = async () => {
    setScanning(true);
    try {
      const result = await invoke<SerialPort[]>("list_ports");
      setPorts(result);
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setScanning(false), 500);
    }
  };

  useEffect(() => {
    scanPorts();
  }, []);

  useEffect(() => {
    const unlistenPorts = listen("ports-changed", () =>
      setTimeout(() => scanPorts(), 500),
    );
    const unlistenError = listen("connection-lost", async () => {
      try {
        await invoke("close_port");
      } catch (e) {}
      setActivePort(null);
      setConnected(false);
      setTimeout(() => scanPorts(), 1000);
    });
    return () => {
      unlistenPorts.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  const handleConnect = async (portName: string) => {
    try {
      window.dispatchEvent(new Event("terminal:clear"));
      await invoke("open_port", {
        portName,
        baudRate: Number(selectedBaud),
        dataBits: Number(dataBits),
        stopBits: Number(stopBits),
        parity,
        flowControl,
      });
      setActivePort(portName);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setActivePort(null);
      alert(`${t("alert_error_prefix")} ${error}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("close_port");
    } catch (e) {
      console.error(e);
    } finally {
      setConnected(false);
      setActivePort(null);
    }
  };

  const handleBaudChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRate = Number(e.target.value);
    setSelectedBaud(newRate);
    updateConnection({ baud: newRate });
  };

  const updateConnection = async (overrides: {
    baud?: number;
    data?: number;
    stop?: number;
    parity?: string;
    flow?: string;
  }) => {
    // Se não tiver porta ativa, não faz nada de rede, só atualiza estado visual (feito fora daqui)
    if (!activePort) return;

    console.log("Atualizando configurações da porta...");

    try {
      await invoke("open_port", {
        portName: activePort,
        // Usa o valor do override SE existir, senão usa o do estado atual
        baudRate: overrides.baud ?? selectedBaud,
        dataBits: overrides.data ?? dataBits,
        stopBits: overrides.stop ?? stopBits,
        parity: overrides.parity ?? parity,
        flowControl: overrides.flow ?? flowControl,
      });
      setConnected(true);
    } catch (error) {
      console.error("Erro ao atualizar config:", error);
      setConnected(false);
      setActivePort(null);
      alert(`${t("alert_error_prefix")} ${error}`);
    }
  };

  const inputClass =
    "w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs rounded-md pl-2 pr-2 py-1 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors";
  const labelClass =
    "text-[9px] text-slate-500 dark:text-slate-400 font-bold tracking-wider";

  return (
    <aside className="w-full h-full bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
        <div className="flex justify-between items-center mb-3">
          <span className="font-bold text-slate-700 dark:text-slate-200 tracking-wide text-sm">
            {t("serial")}
          </span>

          <div className="flex gap-1">
            <button
              onClick={() => setAdvancedMode(!advancedMode)}
              title={advancedMode ? t("hide_advanced") : t("show_advanced")}
              className={`p-1.5 rounded transition-colors ${advancedMode ? "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"}`}
            >
              <SlidersHorizontal size={16} />
            </button>

            <button
              onClick={scanPorts}
              disabled={scanning}
              title={t("refresh_list")}
              className={`p-1.5 rounded transition-all flex items-center justify-center ${scanning ? "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10" : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"}`}
            >
              <RefreshCw
                size={16}
                className={scanning ? "animate-spin-smooth" : ""}
              />
            </button>
          </div>
        </div>

        <div className="space-y-1 mb-2 group">
          <div className="flex justify-between items-center">
            <label className={labelClass}>{t("baud_rate")}</label>
            <span className="text-[9px] text-slate-400 font-mono">
              {t("bits_per_sec")}
            </span>
          </div>

          <div className="relative">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-blue-500 transition-colors pointer-events-none">
              <Gauge size={14} />
            </div>
            <select
              value={selectedBaud}
              onChange={handleBaudChange}
              className={`${inputClass} pl-9 pr-8 py-2 font-mono cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 appearance-none`}
            >
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none group-focus-within:text-blue-500">
              <ChevronDown size={14} strokeWidth={2.5} />
            </div>
          </div>
        </div>

        <div
          className={`grid transition-all duration-300 ease-in-out ${advancedMode ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <div className="overflow-hidden">
            <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-800/50 space-y-3">
              <div className="space-y-1">
                <label className={labelClass}>{t("visualization")}</label>
                <div className="flex flex-col gap-2">
                  <div className="flex bg-slate-100 dark:bg-slate-950 rounded p-0.5 border border-slate-300 dark:border-slate-700">
                    <button
                      onClick={() => setViewMode("ASCII")}
                      className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${viewMode === "ASCII" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                    >
                      ASCII
                    </button>
                    <button
                      onClick={() => setViewMode("HEX")}
                      className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${viewMode === "HEX" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"}`}
                    >
                      HEX
                    </button>
                  </div>
                  <button
                    onClick={toggleTimestamp}
                    className={`flex items-center justify-center gap-2 py-1.5 rounded border transition-all text-xs font-bold 
                                ${
                                  showTimestamp
                                    ? "bg-yellow-50 border-yellow-200 text-yellow-600 dark:bg-yellow-500/10 dark:border-yellow-500/50 dark:text-yellow-500"
                                    : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                                }`}
                  >
                    <Clock size={14} />{" "}
                    {showTimestamp ? t("time_on") : t("show_time")}
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/50">
                <button
                  onClick={handleToggleRecord}
                  className={`w-full py-2 rounded-md flex items-center justify-center gap-2 text-xs font-bold transition-all border
                            ${
                              isRecording
                                ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-500/20 dark:border-red-500 dark:text-red-500 animate-pulse shadow-sm"
                                : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
                            }`}
                >
                  <Circle
                    size={12}
                    fill={isRecording ? "currentColor" : "none"}
                  />
                  {isRecording ? t("recording") : t("record_log")}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className={labelClass}>{t("data_bits")}</label>
                  <select
                    value={dataBits}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setDataBits(val);
                      updateConnection({ data: val });
                    }}
                    className={inputClass}
                  >
                    <option value="8">8</option>
                    <option value="7">7</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>{t("stop_bits")}</label>
                  <select
                    value={stopBits}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setStopBits(val);
                      updateConnection({ stop: val });
                    }}
                    className={inputClass}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>{t("parity")}</label>
                  <select
                    value={parity}
                    onChange={(e) => {
                      const val = e.target.value;
                      setParity(val);
                      updateConnection({ parity: val });
                    }}
                    className={inputClass}
                  >
                    <option value="None">{t("opt_none")}</option>
                    <option value="Even">{t("opt_even")}</option>
                    <option value="Odd">{t("opt_odd")}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>{t("flow")}</label>
                  <select
                    value={flowControl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFlowControl(val);
                      updateConnection({ flow: val });
                    }}
                    className={inputClass}
                  >
                    <option value="None">{t("opt_none")}</option>
                    <option value="Hardware">{t("opt_hardware")}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-800">
        {ports.length > 0 && (
          <div className="px-2 py-1 mb-2 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800/50">
            {t("devices")}
          </div>
        )}

        {ports.length === 0 && (
          <div className="text-center mt-10 text-slate-400 text-xs">
            {t("no_ports")}
          </div>
        )}

        {ports.map((port) => (
          <button
            key={port.port_name}
            onClick={() => handleConnect(port.port_name)}
            disabled={activePort === port.port_name}
            title={
              port.port_type === "USB"
                ? `${t("product")}: ${port.product}\n${t("manufacturer")}: ${port.manufacturer}\nVID: ${port.vid} | PID: ${port.pid}`
                : t("serial_native")
            }
            className={`w-full text-left p-2 rounded-md group transition-all flex items-center gap-3 border mb-1 
            ${
              activePort === port.port_name
                ? "bg-emerald-50 border-emerald-200 dark:bg-green-500/10 dark:border-green-500/50"
                : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <div
              className={`p-2 rounded shrink-0 transition-colors 
                ${
                  activePort === port.port_name
                    ? "text-emerald-600 dark:text-green-400"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300"
                }`}
            >
              {port.port_type === "USB" ? (
                <Usb size={18} />
              ) : (
                <Monitor size={18} />
              )}
            </div>

            <div className="overflow-hidden flex-1 min-w-0">
              <div className="flex justify-between items-baseline">
                <span
                  className={`font-mono text-sm font-bold truncate ${activePort === port.port_name ? "text-emerald-700 dark:text-green-400" : "text-slate-700 dark:text-slate-200"}`}
                >
                  {port.port_name}
                </span>

                {port.port_type === "USB" && (
                  <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono ml-1 hidden group-hover:inline-block">
                    {port.vid}:{port.pid}
                  </span>
                )}
              </div>

              <div
                className="text-[10px] text-slate-500 truncate"
                title={port.product || port.port_type}
              >
                {activePort === port.port_name ? (
                  <span className="text-emerald-600 dark:text-green-500 font-medium animate-pulse">
                    ● {t("connected_status")}
                  </span>
                ) : (
                  port.product || t("serial_device")
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {activePort && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-red-50 dark:bg-red-500/5 shrink-0">
          <button
            onClick={handleDisconnect}
            className="w-full py-2 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
          >
            <Unplug size={16} /> {t("disconnect")}
          </button>
        </div>
      )}
    </aside>
  );
}
