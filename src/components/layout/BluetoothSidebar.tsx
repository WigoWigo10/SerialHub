import { Bluetooth, Lock, Radio } from "lucide-react";
import { useLanguage } from "../../hooks/useLanguage";

export function BluetoothSidebar() {
  const { t } = useLanguage();

  return (
    <div className="
      w-64 h-full 
      bg-white 
      dark:bg-slate-950 border-r 
      border-slate-200 
      dark:border-slate-800 
      flex 
      flex-col 
      relative 
      select-none 
      transition-colors 
      duration-300"
    >
      
      <div className="
        h-full
        flex
        flex-col
        opacity-30
        dark:opacity-20
        pointer-events-none
        filter
        blur-[1px]"
      >
        
        <div className="
          p-3 border-b 
          border-slate-200 
          dark:border-slate-800 
          bg-slate-50/50 
          dark:bg-slate-900/50"
        >
          <div className="
            flex
            items-center
            gap-2 
            text-blue-600 
            dark:text-blue-400 
            mb-1"
          >
            <Bluetooth size={18} />
            <h2 className="
              text-sm 
              font-bold 
              tracking-wide"
              >BLUETOOTH LE
            </h2>
          </div>
          <p className="
          text-[10px] 
          text-slate-500"
          >{t('ble_manager')}</p>
        </div>

        <div className="
          flex-1
          p-3
          space-y-3"
        >
            <div className="
              h-12 border 
              border-slate-200 
              dark:border-slate-800 
              bg-slate-50 
              dark:bg-slate-900 
              rounded-md 
              flex 
              items-center 
              px-3 
              gap-3"
            >
                <Radio size={16} className="
                  text-slate-400 
                  dark:text-slate-600"
                />
                <div className="h-2
                  w-20 
                  bg-slate-200 
                  dark:bg-slate-800 
                  rounded"
                ></div>
            </div>
            <div className="
                  h-12 
                  border 
                  border-slate-200 
                  dark:border-slate-800 
                  bg-slate-50 
                  dark:bg-slate-900 
                  rounded-md 
                  flex 
                  items-center 
                  px-3 
                  gap-3"
            >
              <Radio size={16} className="
                text-slate-400 
                dark:text-slate-600"
              />
              <div className="
                h-2 
                w-16 
                bg-slate-200 
                dark:bg-slate-800
                rounded"
              ></div>
            </div>
            <div className="
              h-12 
              border 
              border-slate-200 
              dark:border-slate-800 
              bg-slate-50 
              dark:bg-slate-900 
              rounded-md 
              flex 
              items-center 
              px-3 
              gap-3"
            >
              <Radio size={16} className="
                text-slate-400 
                dark:text-slate-600"
              />
              <div className="
                h-2 
                w-24 
                bg-slate-200 
                dark:bg-slate-800 
                rounded"
              ></div>
            </div>
          </div>
          
          {/* Botão Fantasma */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <div className="
              h-9 
              bg-blue-500 
              dark:bg-blue-600 
              rounded 
              opacity-30"
            ></div>
          </div>
        </div>
        
        {/* --- OVERLAY DE BLOQUEIO (CADEADO) --- */}
        
        <div className="
          absolute 
          inset-0 
          flex 
          flex-col 
          items-center 
          justify-center 
          z-10"
        >
          <div className="
            bg-white/80 
            dark:bg-slate-950/80 
            backdrop-blur-md 
            p-6 
            rounded-2xl 
            border 
            border-slate-200 
            dark:border-slate-800 
            flex flex-col 
            items-center 
            text-center 
            shadow-2xl 
            max-w-[200px]
            transition-colors 
            duration-300
          ">
            <div className="
              bg-slate-50 
              dark:bg-slate-900 
              p-3 
              rounded-full 
              mb-3 
              border 
              border-slate-200 
              dark:border-slate-800"
            >
              <Lock size={24} className="
                text-blue-500 
                dark:text-blue-400" 
              />
              </div>
              
              <span className="
                text-xs 
                font-bold 
                uppercase 
                tracking-wider 
                text-slate-800 
                dark:text-slate-200 
                mb-1"
              >
                {t('feature_locked')}
              </span>
              
              <p className="
                text-[10px] 
                text-slate-500
                leading-relaxed">
                  {t('feature_locked_desc_ble')}
              </p>
          </div>
      </div>
    </div>
  );
}