import { 
  Cable,
  Bluetooth, 
  Bug, 
  LayoutDashboard, 
  Settings 
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";

export function ActivityBar() {
  const { activityMode, setActivityMode, toggleSidebar } = useSettingsStore();
  const { t } = useLanguage();

  const handleModeClick = (mode: string) => {
    if (activityMode === mode && mode !== 'SETTINGS') {
      toggleSidebar();
    } else {
      setActivityMode(mode);
    }
  };

  const buttons = [
    { id: 'SERIAL', icon: Cable, title: t('activity_monitor') },
    { id: 'BLUETOOTH', icon: Bluetooth, title: t('activity_bluetooth') },
    { id: 'SPY', icon: Bug, title: t('activity_spy') },
    { id: 'DASHBOARD', icon: LayoutDashboard, title: t('activity_dashboard') },
  ];

  return (
    <div className="w-12 h-full 
    bg-slate-50 
    dark:bg-slate-950 border-r 
    border-slate-200 
    dark:border-slate-800 
    flex flex-col 
    items-center 
    py-4 
    gap-4 
    z-20 
    relative 
    transition-colors 
    duration-300">
      
      {buttons.map((btn) => (
        <button
          key={btn.id}
          onClick={() => handleModeClick(btn.id)}
          title={btn.title}
          className={`
            p-2 
            rounded-lg 
            transition-all 
            relative 
            group

            ${activityMode === btn.id 
              ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10 shadow-sm' 
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-900'
            }
          `}
        >
          
          <btn.icon strokeWidth={1.5} size={24} />

          {activityMode === btn.id && (
            <div className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-r-full" />
          )}
        </button>
      ))}

      <div className="flex-1" />

      <button
        onClick={() => handleModeClick('SETTINGS')}
        title={t('activity_settings')}
        className={`
          p-2 rounded-lg transition-all
          ${activityMode === 'SETTINGS'
            ? 'text-slate-800 dark:text-slate-200 bg-slate-200 dark:bg-slate-800'
            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'}
        `}
      >
        <Settings 
        size={24} 
        className=
        {activityMode === 'SETTINGS' ? "animate-spin-slow" : ""} />
      </button>
    </div>
  );
}