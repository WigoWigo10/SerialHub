import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { SpySidebar } from "./components/layout/SpySidebar";
import { BluetoothSidebar } from "./components/layout/BluetoothSidebar";
import { TerminalArea } from "./components/layout/TerminalArea";
import { CommandBar } from "./components/layout/CommandBar";
import { ActivityBar } from "./components/layout/ActivityBar";
import { StatusBar } from "./components/layout/StatusBar";
import { SettingsPage } from "./components/pages/SettingsPage";
import { DashboardPage } from "./components/pages/DashboardPage";
import { useSettingsStore } from "./stores/settingsStore";
import { useLanguage } from "./hooks/useLanguage";
import { Toaster } from "react-hot-toast";
import { Bluetooth, Bug, ChevronRight } from "lucide-react";
import { useDataMonitor } from "./hooks/useDataMonitor";
import { MqttPage } from "./components/pages/MqttPage";

const EmptyWorkspace = ({
  icon: Icon,
  title,
  desc,
}: {
  icon: any;
  title: string;
  desc: string;
}) => (
  <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-700 p-10 animate-in fade-in zoom-in-95 duration-300">
    <div className="bg-slate-100 dark:bg-slate-800 p-6 rounded-full mb-4 shadow-sm">
      <Icon size={64} strokeWidth={1} />
    </div>
    <h1 className="text-2xl font-bold text-slate-400 dark:text-slate-600 mb-2">
      {title}
    </h1>
    <p className="text-sm font-mono max-w-md text-center opacity-75">{desc}</p>
  </div>
);

function App() {
  const { theme, activityMode, isSidebarOpen, setSidebarOpen } = useSettingsStore();
  const { t } = useLanguage();
  useDataMonitor();

  const [mqttInitialized, setMqttInitialized] = useState(false);

  useEffect(() => {
    if (activityMode === "MQTT" && !mqttInitialized) {
      setMqttInitialized(true);
    }
  }, [activityMode, mqttInitialized]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  const isSerialMode = activityMode === "SERIAL" || activityMode === "monitor";
  const isSettingsMode = activityMode === "SETTINGS";

  const showSidebar =
    isSidebarOpen &&
    activityMode !== "SETTINGS" &&
    activityMode !== "DASHBOARD" &&
    activityMode !== "MQTT";

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-blue-500/30 transition-colors duration-300">
      
      <div className="flex flex-1 overflow-hidden relative">
        {/* ActivityBar Sempre Visível e Fixa à Esquerda */}
        <div className="z-30 h-full shrink-0">
            <ActivityBar />
        </div>

        {/* === ÁREA DE SETTINGS === */}
        {isSettingsMode && (
           <div className="flex-1 flex overflow-hidden bg-slate-50 dark:bg-slate-950 animate-in fade-in duration-200">
              <SettingsPage />
           </div>
        )}

        {/* === WORKSPACE PRINCIPAL (TERMINAL / MQTT / DASHBOARD) === */}
        <div className={`flex-1 flex overflow-hidden relative ${isSettingsMode ? 'hidden' : 'flex'}`}>
            
            {/* Wrapper da Sidebar (Animação de Largura) */}
            <div
              className={`
                transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)] 
                overflow-hidden flex-shrink-0 
                bg-white dark:bg-slate-900 
                ${showSidebar 
                  ? "w-64 opacity-100 border-r border-slate-200 dark:border-slate-800" 
                  : "w-0 opacity-0 border-none"
                }
              `}
            >
              {/* Conteúdo da Sidebar com largura fixa para não esmagar */}
              <div className="w-64 h-full flex flex-col">
                {isSerialMode && <Sidebar />}
                {activityMode === "SPY" && <SpySidebar />}
                {activityMode === "BLUETOOTH" && <BluetoothSidebar />}
              </div>
            </div>

            {/* Área de Conteúdo (Direita) */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0 bg-slate-50 dark:bg-slate-950">
              <div
                className={`flex-col h-full w-full overflow-hidden ${isSerialMode ? "flex" : "hidden"}`}
                style={{ minWidth: "300px" }}
              >
                <TerminalArea />
                <CommandBar />
              </div>

              {activityMode === "DASHBOARD" && <DashboardPage />}
              
              {mqttInitialized && (
                <div className={`flex-1 flex-col h-full overflow-hidden ${activityMode === "MQTT" ? "flex" : "hidden"}`}>
                   <MqttPage />
                </div>
              )}

              {activityMode === "BLUETOOTH" && (
                <EmptyWorkspace
                  icon={Bluetooth}
                  title={t("ws_bluetooth_title")}
                  desc={t("feature_locked_desc_ble")}
                />
              )}

              {activityMode === "SPY" && (
                <EmptyWorkspace
                  icon={Bug}
                  title={t("ws_spy_title")}
                  desc={t("feature_locked_desc_spy")}
                />
              )}
            </div>
        </div>
      </div>

      <StatusBar />

      {/* Botão de Expandir Sidebar ("Gutter Handle") */}
      {!isSidebarOpen && !isSettingsMode && activityMode !== "DASHBOARD" && activityMode !== "MQTT" && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-12 top-1/2 -translate-y-1/2 z-20 
                      flex items-center justify-center
                      w-4 h-12 rounded-r-xl
                      bg-white dark:bg-slate-900 
                      border-y border-r border-slate-200 dark:border-slate-800
                      text-slate-400 hover:text-blue-500 hover:w-6 hover:pl-1
                      shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)]
                      transition-all duration-300 ease-out cursor-pointer group"
          title={t('expand_menu')}
        >
          <ChevronRight 
            size={16} 
            className="group-hover:scale-110 transition-transform duration-200 opacity-70 group-hover:opacity-100" 
          />
        </button>
      )}

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#fff",
            border: "1px solid #334155",
          },
          success: { iconTheme: { primary: "#10b981", secondary: "#fff" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
        }}
      />
    </div>
  );
}

export default App;