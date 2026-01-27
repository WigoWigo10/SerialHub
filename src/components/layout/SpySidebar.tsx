import { Bug, ArrowRightLeft, Lock } from "lucide-react";
import { useLanguage } from "../../hooks/useLanguage";

export function SpySidebar() {
  const { t } = useLanguage();

  return (
    <div className="w-64 h-full bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col relative select-none transition-colors duration-300">
      <div className="h-full flex flex-col opacity-30 dark:opacity-20 pointer-events-none filter blur-[1px]">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
            <Bug size={18} />
            <h2 className="text-sm font-bold tracking-wide">SPY / BRIDGE</h2>
          </div>
          <p className="text-[10px] text-slate-500">{t("spy_desc_short")}</p>
        </div>

        <div className="flex-1 p-3 flex flex-col gap-4">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">
              {t("port_master")}
            </label>
            <div className="w-full h-8 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"></div>
          </div>

          <div className="flex justify-center text-slate-300 dark:text-slate-700">
            <ArrowRightLeft size={16} />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">
              {t("port_slave")}
            </label>
            <div className="w-full h-8 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md"></div>
          </div>

          <div className="mt-2 w-full h-9 bg-purple-500 dark:bg-purple-600 rounded-md opacity-50"></div>
        </div>
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
        <div
          className="
                bg-white/80 dark:bg-slate-950/80 backdrop-blur-md 
                p-6 rounded-2xl border border-slate-200 dark:border-slate-800 
                flex flex-col items-center text-center shadow-2xl max-w-[200px]
                transition-colors duration-300
            "
        >
          <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-full mb-3 border border-slate-200 dark:border-slate-800">
            <Lock size={24} className="text-purple-500 dark:text-purple-400" />
          </div>

          <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 mb-1">
            {t("feature_locked")}
          </span>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            {t("feature_locked_desc_spy")}
          </p>
        </div>
      </div>
    </div>
  );
}
