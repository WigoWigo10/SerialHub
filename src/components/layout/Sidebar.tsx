import { useShallow } from "zustand/react/shallow";
import { save } from "@tauri-apps/plugin-dialog";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  RefreshCw,
  Usb,
  HelpCircle,
  Unplug,
  SlidersHorizontal,
  Circle,
  Clock,
  Gauge,
  ChevronDown,
  Bluetooth,
  Cpu,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";
import { connectionAction, recordingAction, toggleRecording } from "../../lib/serialActions";
import { listenSafely } from "../../lib/serialPresentation";
import toast from "react-hot-toast";
import { SerialPortInfo as SerialPort, serialPortPresentation } from "../../lib/serialPorts";

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

function portIcon(type: string) {
  if (type === "USB")       return <Usb size={18} />;
  if (type === "Bluetooth") return <Bluetooth size={18} />;
  if (type === "Native")    return <Cpu size={18} />;
  return <HelpCircle size={18} />;
}

function PortButton({ port, activePort, onConnect, t, disabled }: {
  disabled?: boolean;
  port: SerialPort;
  activePort: string | null;
  onConnect: (name: string) => void;
  t: (key: any) => string;
}) {
  const isActive = activePort === port.port_name;
  const presentation = serialPortPresentation(port, t);

  return (
    <button
      onClick={() => onConnect(port.port_name)}
      disabled={isActive || disabled}
      title={presentation.tooltip}
      className={`w-full text-left p-2 rounded-md group transition-all flex items-center gap-3 border mb-1
        ${isActive
          ? "bg-emerald-50 border-emerald-200 dark:bg-green-500/10 dark:border-green-500/50"
          : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
    >
      <div className={`p-2 rounded shrink-0 transition-colors
        ${isActive
          ? "text-emerald-600 dark:text-green-400"
          : "bg-slate-100 dark:bg-slate-800 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300"
        }`}
      >
        {portIcon(port.port_type)}
      </div>

      <div className="overflow-hidden flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className={`font-mono text-sm font-bold truncate ${isActive ? "text-emerald-700 dark:text-green-400" : "text-slate-700 dark:text-slate-200"}`}>
            {port.port_name}
          </span>
          {port.port_type === "USB" && (
            <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono ml-1 hidden group-hover:inline-block">
              {port.vid}:{port.pid}
            </span>
          )}
        </div>

        <div className="text-[10px] text-slate-500 truncate" title={presentation.description}>
          {isActive ? (
            <span className="text-emerald-600 dark:text-green-500 font-medium animate-pulse">
              ● {t("connected_status")}
            </span>
          ) : (
            presentation.description
          )}
        </div>
      </div>
    </button>
  );
}

export function Sidebar() {
  const { t } = useLanguage();

  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [scanning, setScanning] = useState(false);
  const parameters = useSettingsStore(state => state.serialParameters);
  const serialOperationPending = useSettingsStore(state => state.serialOperationPending);
  const recordingOperationPending = useSettingsStore(state => state.recordingOperationPending);
  const { baud: selectedBaud, data: dataBits, stop: stopBits, parity, flow: flowControl } = parameters;
  const mounted = useRef(true);
  const scanVersion = useRef(0);

  const [advancedMode, setAdvancedMode] = useState(false);
  const [showOtherPorts, setShowOtherPorts] = useState(false);

  const {
    viewMode,
    setViewMode,
    showTimestamp,
    toggleTimestamp,
    isRecording,
    activePort,
  } = useSettingsStore(
    useShallow((state) => ({
      viewMode: state.viewMode,
      setViewMode: state.setViewMode,
      showTimestamp: state.showTimestamp,
      toggleTimestamp: state.toggleTimestamp,
      isRecording: state.isRecording,
      activePort: state.activePort,
    })),
  );

  const handleToggleRecord = async () => {
    try {
      await recordingAction(async () => {
        const result = await toggleRecording({
          active: () => useSettingsStore.getState().isRecording,
          choose: () => save({ filters: [{ name: "Serial diagnostic log", extensions: ["log"] }], defaultPath: "serial_log.log" }),
          start: filePath => invoke("start_recording", { filePath }),
          stop: () => invoke("stop_recording"),
        });
        if (result !== 'cancelled') toast.success(t(result === 'started' ? 'serial_record_started' : 'serial_record_stopped'));
      }, value => useSettingsStore.setState({ recordingOperationPending: value }));
    } catch (error) { toast.error(String(error), { id: 'serial-recording-error' }); }
  };

  const scanPorts = async () => {
    const version = ++scanVersion.current;
    setScanning(true);
    try {
      const result = await invoke<SerialPort[]>("list_ports");
      if (mounted.current && version === scanVersion.current) setPorts(result);
    } catch (error) {
      if (mounted.current && version === scanVersion.current) toast.error(String(error));
    } finally {
      if (mounted.current && version === scanVersion.current) setScanning(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void scanPorts();
    const stop = listenSafely(receive => listen("ports-changed", receive), () => { void scanPorts(); });
    return () => { mounted.current = false; scanVersion.current++; stop(); };
  }, []);

  const open = (portName: string, config: typeof parameters) => invoke("open_port", {
    portName, baudRate: config.baud, dataBits: config.data, stopBits: config.stop,
    parity: config.parity, flowControl: config.flow,
  });
  const handleConnect = async (portName: string) => {
    try {
      await connectionAction(() => open(portName, useSettingsStore.getState().serialParameters),
        value => useSettingsStore.setState({ serialOperationPending: value }));
    } catch (error) { toast.error(`${t('alert_error_prefix')} ${error}`); }
  };
  const handleDisconnect = async () => {
    try {
      await connectionAction(() => invoke("close_port"), value => useSettingsStore.setState({ serialOperationPending: value }));
    } catch (error) { toast.error(String(error)); }
  };
  const updateConnection = async (overrides: Partial<typeof parameters>) => {
    try {
      await connectionAction(async () => {
        const state = useSettingsStore.getState();
        const next = { ...state.serialParameters, ...overrides };
        if (state.activePort) await open(state.activePort, next);
        useSettingsStore.setState({ serialParameters: next });
      }, value => useSettingsStore.setState({ serialOperationPending: value }));
    } catch (error) { toast.error(`${t('alert_error_prefix')} ${error}`); }
  };
  const handleBaudChange = (event: React.ChangeEvent<HTMLSelectElement>) => { void updateConnection({ baud: Number(event.target.value) }); };

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
            <select disabled={serialOperationPending}
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
                  disabled={recordingOperationPending}
                  title={t("serial_record_help")}
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
                <p className="text-[10px] leading-relaxed text-slate-500 mt-2">{t("serial_record_help")}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className={labelClass}>{t("data_bits")}</label>
                  <select disabled={serialOperationPending}
                    value={dataBits}
                    onChange={(e) => {
                      const val = Number(e.target.value);
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
                  <select disabled={serialOperationPending}
                    value={stopBits}
                    onChange={(e) => {
                      const val = Number(e.target.value);
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
                  <select disabled={serialOperationPending}
                    value={parity}
                    onChange={(e) => {
                      const val = e.target.value;
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
                  <select disabled={serialOperationPending}
                    value={flowControl}
                    onChange={(e) => {
                      const val = e.target.value;
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
        {ports.length === 0 && (
          <div className="text-center mt-10 text-slate-400 text-xs">
            {t("no_ports")}
          </div>
        )}

        {/* USB Ports */}
        {ports.filter(p => p.port_type === "USB").length > 0 && (
          <div className="px-2 py-1 mb-2 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800/50">
            {t("devices")}
          </div>
        )}

        {ports.filter(p => p.port_type === "USB").map((port) => (
          <PortButton
            key={port.port_name}
            port={port}
            activePort={activePort} disabled={serialOperationPending}
            onConnect={handleConnect}
            t={t}
          />
        ))}

        {/* Other Ports (Native / Unknown / Bluetooth; legacy labels preserved) */}
        {ports.filter(p => p.port_type !== "USB").length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowOtherPorts(v => !v)}
              className="w-full flex items-center justify-between px-2 py-1 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800/50 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <span>{t("other_devices")}</span>
              <div className="flex items-center gap-1">
                <span className="bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-1.5 py-0.5 text-[9px] font-bold">
                  {ports.filter(p => p.port_type !== "USB").length}
                </span>
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${showOtherPorts ? "rotate-180" : ""}`}
                />
              </div>
            </button>

            <div className={`grid transition-all duration-300 ease-in-out ${showOtherPorts ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="overflow-hidden">
                <div className="pt-1 space-y-1">
                  {ports.filter(p => p.port_type !== "USB").map((port) => (
                    <PortButton
                      key={port.port_name}
                      port={port}
                      activePort={activePort} disabled={serialOperationPending}
                      onConnect={handleConnect}
                      t={t}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {activePort && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-red-50 dark:bg-red-500/5 shrink-0">
          <button
            onClick={handleDisconnect}
                  disabled={serialOperationPending}
            className="w-full py-2 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors shadow-sm"
          >
            <Unplug size={16} /> {t("disconnect")}
          </button>
        </div>
      )}
    </aside>
  );
}
