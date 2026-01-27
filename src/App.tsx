import { useEffect } from "react";
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
import { Bluetooth, Bug } from "lucide-react";

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
    <div className="p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-4 shadow-sm">
      <Icon size={64} strokeWidth={1} />
    </div>
    <h1 className="text-2xl font-bold text-slate-400 dark:text-slate-600 mb-2">
      {title}
    </h1>
    <p className="text-sm font-mono max-w-md text-center opacity-75">{desc}</p>
  </div>
);

function App() {
  const { activityMode, isSidebarOpen, theme } = useSettingsStore();
  const { t } = useLanguage();

  const showSidebar =
    isSidebarOpen &&
    (activityMode === "SERIAL" ||
      activityMode === "monitor" ||
      activityMode === "BLUETOOTH" ||
      activityMode === "SPY");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  }, [theme]);

  const isSettingsMode = activityMode === "SETTINGS";
  const isSerialMode = activityMode === "SERIAL" || activityMode === "monitor";

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white overflow-hidden select-none font-sans selection:bg-blue-500/30 transition-colors duration-300">
      <div className="flex-1 flex overflow-hidden relative">
        <ActivityBar />

        {isSettingsMode ? (
          <SettingsPage />
        ) : (
          <>
            <div
              className={`
                      transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 
                      bg-white dark:bg-slate-900 
                      ${showSidebar ? "w-64 opacity-100 border-r border-slate-200 dark:border-slate-800" : "w-0 opacity-0 border-none"}
                  `}
            >
              <div className="w-64 h-full flex flex-col">
                {(activityMode === "SERIAL" || activityMode === "monitor") && (
                  <Sidebar />
                )}
                {activityMode === "SPY" && <SpySidebar />}
                {activityMode === "BLUETOOTH" && <BluetoothSidebar />}
              </div>
            </div>

            <div className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
              <div
                className={`flex-col h-full w-full overflow-hidden ${isSerialMode ? "flex" : "hidden"}`}
                style={{ minWidth: "300px" }}
              >
                <TerminalArea />
                <CommandBar />
              </div>

              {activityMode === "DASHBOARD" && <DashboardPage />}

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
          </>
        )}
      </div>

      <StatusBar />

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
