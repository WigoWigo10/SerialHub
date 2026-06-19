import { 
  Laptop, Moon, Sun, Globe, SlidersHorizontal, 
  Terminal, Info, CheckCircle2, Github, ExternalLink 
} from "lucide-react";
import { open } from '@tauri-apps/plugin-shell';
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";

export function SettingsPage() {
  const { 
    theme, setTheme, 
    language, setLanguage 
  } = useSettingsStore();

  const { t } = useLanguage();

  return (
    <div className="flex-1 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 h-full overflow-y-auto animate-in fade-in zoom-in-95 duration-200 transition-colors duration-300">
      
      <div className="max-w-5xl mx-auto p-8 space-y-12">

        <div className="flex items-center justify-between pb-6 border-b border-slate-200 dark:border-slate-800">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-3">
                    <SlidersHorizontal className="text-blue-500" size={32} />
                    {t('settings_title')}
                </h1>
                <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                    {t('settings_subtitle')}
                </p>
            </div>
            <div className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500">
                v1.2.0
            </div>
        </div>

        <section className="space-y-6">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-500 uppercase tracking-widest">
                <Laptop size={16} /> {t('appearance')}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <button 
                    onClick={() => setTheme('dark')}
                    className={`group relative flex flex-col p-4 rounded-xl border-2 transition-all duration-300
                    ${theme === 'dark' 
                        ? 'bg-slate-100 dark:bg-slate-900/50 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.15)] scale-[1.02]' 
                        : 'bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                >
                    <div className="w-full h-24 rounded-lg bg-slate-950 border border-slate-800 mb-4 overflow-hidden flex relative shadow-inner">
                        <div className="w-1/4 h-full bg-slate-900 border-r border-slate-800 flex flex-col gap-2 p-2">
                            <div className="w-full h-2 bg-slate-700 rounded-full opacity-50"></div>
                            <div className="w-2/3 h-2 bg-slate-800 rounded-full opacity-50"></div>
                        </div>
                        <div className="flex-1 p-3 flex flex-col gap-2">
                            <div className="w-1/3 h-2 bg-blue-500/40 rounded-full"></div>
                        </div>
                        <div className="absolute bottom-2 right-2 p-2 rounded-full bg-slate-800 text-slate-400 shadow-lg">
                            <Moon size={16} />
                        </div>
                    </div>
                    <div className="flex items-center justify-between w-full">
                        <h3 className={`font-bold text-lg ${theme === 'dark' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}`}>
                            {t('dark_mode')}
                        </h3>
                        {theme === 'dark' && <CheckCircle2 className="text-blue-500 animate-in zoom-in" size={24} />}
                    </div>
                </button>

                <button 
                    onClick={() => setTheme('light')}
                    className={`group relative flex flex-col p-4 rounded-xl border-2 transition-all duration-300
                    ${theme === 'light' 
                        ? 'bg-blue-50 dark:bg-slate-100 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)] scale-[1.02]' 
                        : 'bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                >
                    <div className="w-full h-24 rounded-lg bg-white border border-slate-200 mb-4 overflow-hidden flex relative shadow-inner">
                        <div className="w-1/4 h-full bg-slate-50 border-r border-slate-200 flex flex-col gap-2 p-2">
                            <div className="w-full h-2 bg-slate-300 rounded-full"></div>
                            <div className="w-2/3 h-2 bg-slate-200 rounded-full"></div>
                        </div>
                        <div className="flex-1 p-3 flex flex-col gap-2">
                            <div className="w-1/3 h-2 bg-blue-500 rounded-full"></div>
                        </div>
                        <div className="absolute bottom-2 right-2 p-2 rounded-full bg-white text-orange-500 shadow-lg border border-slate-100">
                            <Sun size={16} />
                        </div>
                    </div>
                    <div className="flex items-center justify-between w-full">
                        <h3 className={`font-bold text-lg ${theme === 'light' ? 'text-blue-600 dark:text-slate-900' : 'text-slate-700 dark:text-slate-300'}`}>
                            {t('light_mode')}
                        </h3>
                        {theme === 'light' && <CheckCircle2 className="text-blue-600 animate-in zoom-in" size={24} />}
                    </div>
                </button>

            </div>
        </section>

        <section className="space-y-6 pt-6 border-t border-slate-200 dark:border-slate-800/50">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-500 uppercase tracking-widest">
                <Globe size={16} /> {t('region_language')}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <button 
                    onClick={() => setLanguage('en-US')}
                    className={`relative flex items-center p-3 rounded-xl border-2 transition-all duration-300 group
                    ${language === 'en-US' 
                        ? 'bg-emerald-50 dark:bg-slate-900/50 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.15)]' 
                        : 'bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                >
                    <img 
                        src="https://hatscripts.github.io/circle-flags/flags/us.svg" 
                        alt="USA Flag"
                        className="h-10 w-10 mr-4 shadow-md rounded-full group-hover:scale-110 transition-transform"
                    />
                    <div className="text-left flex-1 min-w-0">
                        <h3 className={`font-bold text-sm ${language === 'en-US' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>English (US)</h3>
                        <p className="text-[10px] text-slate-500">United States</p>
                    </div>
                    {language === 'en-US' && <div className="text-emerald-500 animate-in zoom-in"><CheckCircle2 size={18} /></div>}
                </button>

                <button 
                    onClick={() => setLanguage('pt-BR')}
                    className={`relative flex items-center p-3 rounded-xl border-2 transition-all duration-300 group
                    ${language === 'pt-BR' 
                        ? 'bg-emerald-50 dark:bg-slate-900/50 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.15)]' 
                        : 'bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                >
                    <img 
                        src="https://hatscripts.github.io/circle-flags/flags/br.svg" 
                        alt="Brazil Flag"
                        className="h-10 w-10 mr-4 shadow-md rounded-full group-hover:scale-110 transition-transform"
                    />
                    <div className="text-left flex-1 min-w-0">
                        <h3 className={`font-bold text-sm ${language === 'pt-BR' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>Português</h3>
                        <p className="text-[10px] text-slate-500">Brasil</p>
                    </div>
                    {language === 'pt-BR' && <div className="text-emerald-500 animate-in zoom-in"><CheckCircle2 size={18} /></div>}
                </button>

                <button 
                    onClick={() => setLanguage('es')}
                    className={`relative flex items-center p-3 rounded-xl border-2 transition-all duration-300 group
                    ${language === 'es' 
                        ? 'bg-emerald-50 dark:bg-slate-900/50 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.15)]' 
                        : 'bg-white dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                >
                    <img 
                        src="https://hatscripts.github.io/circle-flags/flags/es.svg" 
                        alt="Spain Flag"
                        className="h-10 w-10 mr-4 shadow-md rounded-full group-hover:scale-110 transition-transform"
                    />
                    <div className="text-left flex-1 min-w-0">
                        <h3 className={`font-bold text-sm ${language === 'es' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>Español</h3>
                        <p className="text-[10px] text-slate-500">España</p>
                    </div>
                    {language === 'es' && <div className="text-emerald-500 animate-in zoom-in"><CheckCircle2 size={18} /></div>}
                </button>

            </div>
        </section>

        <section className="space-y-6 pt-6 border-t border-slate-200 dark:border-slate-800/50">
            <div className="flex items-center gap-2 text-sm font-bold text-violet-500 uppercase tracking-widest">
                <Info size={16} /> {t('about')}
            </div>
            
            <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-800 flex gap-6 items-start">
                
                <div className="p-3 bg-violet-100 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-lg h-fit shrink-0">
                    <Terminal size={32} />
                </div>
                
                <div className="flex-1">
                    <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xl">SerialHub Desktop</h4>
                    
                    <p className="text-slate-600 dark:text-slate-400 text-sm mt-3 leading-relaxed max-w-2xl">
                        {t('about_description')}
                    </p>

                    <div className="mt-4">
                        <button 
                            onClick={() => open("https://github.com/WigoWigo10/SerialHub")}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        >
                            <Github size={16} />
                            {t('visit_repo')}
                            <ExternalLink size={12} className="opacity-50" />
                        </button>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-100/50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 text-xs font-bold text-orange-700 dark:text-orange-400">
                            <img src="https://cdn.simpleicons.org/rust/ea580c" alt="Rust" className="w-4 h-4" />
                            <span>Rust (Core)</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-100/50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800/50 text-xs font-bold text-teal-700 dark:text-teal-400">
                            <img src="https://cdn.simpleicons.org/tauri/24c8db" alt="Tauri" className="w-4 h-4" />
                            <span>Tauri v2</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100/50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-xs font-bold text-blue-700 dark:text-blue-400">
                            <img src="https://cdn.simpleicons.org/react/61dafb" alt="React" className="w-4 h-4" />
                            <span>React 18</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100/50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-xs font-bold text-blue-800 dark:text-blue-300">
                            <img src="https://cdn.simpleicons.org/typescript/3178c6" alt="TypeScript" className="w-4 h-4" />
                            <span>TypeScript</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

      </div>
    </div>
  );
}