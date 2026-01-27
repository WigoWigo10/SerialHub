import { useEffect, useRef, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { 
  ArrowDown, 
  Terminal as TerminalIcon, 
  Check, 
  Eraser, 
  Activity, 
  ZoomIn, 
  Wifi, 
  Unplug 
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useSettingsStore } from "../../stores/settingsStore";
import { useLanguage } from "../../hooks/useLanguage";
import { toHex } from "../../lib/formatters";

interface ZoomFeedback {
  visible: boolean;
  size: number;
}

export function TerminalArea() {
  const { t } = useLanguage();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [zoomFeedback, setZoomFeedback] = useState<ZoomFeedback>({ visible: false, size: 14 });
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { 
    localEcho, viewMode, showTimestamp, activePort, connected, theme 
  } = useSettingsStore();

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      console.log(t('clean_terminal')); 
    }
  };

  const showTimestampRef = useRef(showTimestamp);
  const viewModeRef = useRef(viewMode);
  const localEchoRef = useRef(localEcho);
  const isNewLineRef = useRef(true); 
  const isUserAtBottomRef = useRef(true);
  
  const [isReceiving, setIsReceiving] = useState(false);
  const [tempMessage, setTempMessage] = useState<string | null>(null);
  //const tempTimeoutRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!xtermRef.current) return;
    const isDark = theme === 'dark';
    
    xtermRef.current.options.theme = {
        background: isDark ? '#020617' : '#ffffff',
        foreground: isDark ? '#f8fafc' : '#0f172a',
        cursor: isDark ? '#ffffff' : '#000000',
        selectionBackground: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(59, 130, 246, 0.25)',
    };
    xtermRef.current.refresh(0, xtermRef.current.rows - 1);
  }, [theme]);

  const currentStatus = useMemo(() => {
    if (tempMessage) return { text: tempMessage, color: "text-slate-400 dark:text-slate-500", icon: Eraser, animate: false };
    
    if (!connected) return { text: t('disconnected'), color: "text-red-500", icon: Unplug, animate: false };
    
    if (isReceiving) return { text: t('receiving'), color: "text-emerald-500", icon: Activity, animate: true };
    
    const portText = activePort ? `${t('connected_status')}: ${activePort}` : t('connected_status');
    return { text: portText, color: "text-blue-500", icon: Wifi, animate: false };

  }, [connected, activePort, isReceiving, tempMessage, t]);

  useEffect(() => {
    let unlisten: () => void;
    const setupListener = async () => {
      unlisten = await listen('serial-data', () => {
        setIsReceiving(true);
        setTempMessage(null);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        // @ts-ignore
        timeoutRef.current = setTimeout(() => setIsReceiving(false), 150);
      });
    };
    if (connected) setupListener();
    return () => {
      if (unlisten) unlisten();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [connected]);

  //const triggerTempStatus = (msg: string, duration = 2000) => {
    //setTempMessage(msg);
    //if (tempTimeoutRef.current) clearTimeout(tempTimeoutRef.current);
    // @ts-ignore
    //tempTimeoutRef.current = setTimeout(() => setTempMessage(null), duration);
  //};

  useEffect(() => { showTimestampRef.current = showTimestamp; }, [showTimestamp]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { localEchoRef.current = localEcho; }, [localEcho]);

  const getTimeBadge = () => {
    const now = new Date();
    return `\x1b[2m[${now.toLocaleTimeString()}]\x1b[0m `;
  };
  
  const checkPosition = (term: Terminal) => { 
      const isAtBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      isUserAtBottomRef.current = isAtBottom;
      setShowScrollBtn(!isAtBottom);
  };

  const scrollToBottomSmooth = () => { 
      if (!xtermRef.current) return;
      xtermRef.current.scrollToBottom();
      setShowScrollBtn(false);
      isUserAtBottomRef.current = true;
  }; 

  const copySelection = async (term: Terminal) => { 
      const selection = term.getSelection();
      if (selection) {
          await navigator.clipboard.writeText(selection);
          setCopyFeedback(true);
          setTimeout(() => setCopyFeedback(false), 2000);
          term.clearSelection();
      }
  };

  const handleWheel = (e: WheelEvent) => { 
      const term = xtermRef.current;
      if (!term) return;

      if (e.ctrlKey) {
          e.preventDefault();
          let newSize = term.options.fontSize || 14;
          if (e.deltaY < 0) newSize += 1;
          else newSize -= 1;
          if (newSize < 8) newSize = 8;
          if (newSize > 32) newSize = 32;

          term.options.fontSize = newSize;
          fitAddonRef.current?.fit();

          setZoomFeedback({ visible: true, size: newSize });
          if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
          zoomTimeoutRef.current = setTimeout(() => setZoomFeedback(prev => ({ ...prev, visible: false })), 1500);
      } else {
          requestAnimationFrame(() => checkPosition(term));
      }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (xtermRef.current && xtermRef.current.getSelection().length > 0) {
        e.preventDefault();
        copySelection(xtermRef.current);
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;
    const isDark = useSettingsStore.getState().theme === 'dark';

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: { 
          background: isDark ? '#020617' : '#ffffff', 
          foreground: isDark ? '#f8fafc' : '#0f172a',
          selectionBackground: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(59, 130, 246, 0.25)', 
      },
      convertEol: true, 
      scrollback: 10000,
      disableStdin: false, 
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    
    setTimeout(() => {
      fitAddon.fit();
    }, 100);
    
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (e) { /* ignore */ }
      }
    });
  resizeObserver.observe(terminalRef.current);

  xtermRef.current = term;
  fitAddonRef.current = fitAddon;

    const termElement = terminalRef.current;
    termElement.addEventListener('wheel', handleWheel, { passive: false });
    term.onScroll(() => checkPosition(term));
    
    term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;
        if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
            const hasSelection = term.getSelection().length > 0;
            if (event.shiftKey || hasSelection) {
                copySelection(term);
                return false;
            }
        }
        return true;
    });

    const unlistenRx = listen<number[]>("serial-data", (event) => {
      const data = new Uint8Array(event.payload);
      if (viewModeRef.current === 'HEX') {
        const hexString = toHex(data);
        term.write(`\x1b[38;5;46m${hexString} \x1b[0m`);
      } else if (showTimestampRef.current) {
        const text = new TextDecoder().decode(data);
        if (isNewLineRef.current) {
            term.write(getTimeBadge());
            isNewLineRef.current = false;
        }
        const parts = text.split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].length > 0) term.write(parts[i]);
            if (i < parts.length - 1) {
                term.write('\r\n');
                term.write(getTimeBadge());
                isNewLineRef.current = false; 
            }
        }
      } else {
        term.write(data);
      }
      if (isUserAtBottomRef.current) term.scrollToBottom();
    });

    const unlistenTx = listen<number[]>("serial-sent", (event) => {
      if (!localEchoRef.current) return;
      const data = new Uint8Array(event.payload);
      term.scrollToBottom();
      term.write('\r\n');
      term.write('\x1b[1;37;45m TX \x1b[0m \x1b[1;35m '); 
      if (viewModeRef.current === 'HEX') {
           term.write(toHex(data));
      } else {
           const text = new TextDecoder().decode(data);
           term.write(text.replace(/(\r\n|\n|\r)/gm, "")); 
      }
      term.write('\x1b[0m\r\n'); 
      isNewLineRef.current = true;
    });
    
    window.addEventListener("terminal:clear", handleClear);
    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      termElement.removeEventListener('wheel', handleWheel);
      window.removeEventListener("terminal:clear", handleClear);
      window.removeEventListener("resize", handleResize);
      term.dispose();
      unlistenRx.then(f => f());
      unlistenTx.then(f => f());
    };
  }, []);

  return (
    <div 
        className="flex-1 bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 overflow-hidden relative flex flex-col group transition-colors duration-300"
        onContextMenu={handleContextMenu}
    >
      
      <div className="h-8 min-h-[32px] bg-slate-50/90 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 select-none backdrop-blur-sm z-10 transition-colors">
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <TerminalIcon size={14} />
            <span className="text-xs font-bold tracking-wide">{t('terminal_header')}</span>
        </div>

        <div className="flex items-center gap-3">
             <div className={`flex items-center gap-1 text-xs font-bold transition-all duration-300 ${copyFeedback ? 'opacity-100 translate-y-0 text-emerald-500' : 'opacity-0 translate-y-2'}`}>
                <Check size={12} />
                <span>{t('copied')}</span>
             </div>

             <div className={`flex items-center gap-2 px-2 py-0.5 rounded-full border border-transparent transition-all duration-300 ${currentStatus.animate ? "bg-emerald-500/10 border-emerald-500/20" : ""}`}>
                <span className={`text-[10px] font-bold tracking-wide uppercase transition-colors duration-300 ${currentStatus.color}`}>
                    {currentStatus.text}
                </span>
                <div className={`${currentStatus.color}`}>
                    <currentStatus.icon size={14} className={currentStatus.animate ? "animate-pulse" : ""} />
                </div>
            </div>
        </div>
      </div>

      <div className="flex-1 relative p-1 pl-3 cursor-text" onClick={() => xtermRef.current?.focus()}>
         <div ref={terminalRef} className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] z-0" />
         
         <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/90 dark:bg-slate-800/90 text-slate-800 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xl backdrop-blur flex items-center gap-2 pointer-events-none transition-all duration-300 z-50 ${zoomFeedback.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
            <ZoomIn size={18} className="text-blue-500" />
            <span className="text-sm font-bold font-mono">{zoomFeedback.size}px</span>
         </div>
      </div>
      
      <div className={`absolute bottom-6 right-8 transition-all duration-300 transform z-50 ${showScrollBtn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button 
            onClick={scrollToBottomSmooth} 
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 p-3 rounded-full shadow-lg shadow-black/20 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer pointer-events-auto"
        >
            <ArrowDown size={20} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}