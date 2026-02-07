import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Send,
  CornerDownLeft,
  ChevronDown,
  Eraser,
  Repeat2,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { LedIndicator } from "../ui/LedIndicator";
import { useLanguage } from "../../hooks/useLanguage";
import toast from "react-hot-toast";

export function CommandBar() {
  const [text, setText] = useState("");
  const [mode] = useState<"ASCII" | "HEX">("ASCII");
  const [lineEnding, setLineEnding] = useState<"NONE" | "LF" | "CRLF">("CRLF");

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState("");

  const { localEcho, toggleLocalEcho } = useSettingsStore();
  const { t } = useLanguage();

  const [rxActive, setRxActive] = useState(false);
  const [txActive, setTxActive] = useState(false);
  const [dtrState, setDtrState] = useState(false);
  const [rtsState, setRtsState] = useState(false);

  const rxTimeout = useRef<number>();
  const txTimeout = useRef<number>();

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedData = e.clipboardData.getData("text");
    const trimmed = pastedData.trim();

    // Verificação rápida: Só tenta parsear se parecer um objeto ou array JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        // Tenta converter para Objeto e depois volta para String (isso remove indentação)
        const jsonObject = JSON.parse(trimmed);
        const minified = JSON.stringify(jsonObject);

        // Se o minificado for diferente do original (ou seja, o original tinha quebras/espaços)
        if (minified !== trimmed) {
          e.preventDefault(); // Cancela a colagem padrão (que viria com quebras de linha)

          // Lógica para inserir o texto minificado na posição do cursor
          const input = e.currentTarget;
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          const currentVal = text; // Usando o estado 'text'

          const newVal = currentVal.substring(0, start) + minified + currentVal.substring(end);
          
          setText(newVal);
          
          // Feedback visual para o usuário entender o que aconteceu
          toast.success(t('json_minified'));

          setTimeout(() => {
            if(inputRef.current) {
               inputRef.current.selectionStart = inputRef.current.selectionEnd = start + minified.length;
            }
          }, 0);
        }
      } catch (err) {
        // Se der erro no JSON.parse, não faz nada e deixa colar o texto original
        console.log("Não é um JSON válido ou incompleto");
      }
    }
  };

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleFocusRequest = () => {
      inputRef.current?.focus();
    };

    window.addEventListener('terminal:focus-input', handleFocusRequest);
    return () => window.removeEventListener('terminal:focus-input', handleFocusRequest);
  }, []);

  useEffect(() => {
    const unlistenRx = listen("serial-data", () => {
      setRxActive(true);
      clearTimeout(rxTimeout.current);
      // @ts-ignore
      rxTimeout.current = setTimeout(() => setRxActive(false), 50);
    });

    const unlistenTx = listen("serial-sent", () => {
      setTxActive(true);
      clearTimeout(txTimeout.current);
      // @ts-ignore
      txTimeout.current = setTimeout(() => setTxActive(false), 50);
    });

    return () => {
      unlistenRx.then((f) => f());
      unlistenTx.then((f) => f());
    };
  }, []);

  const togglePin = async (
    pin: "DTR" | "RTS",
    currentState: boolean,
    setter: (v: boolean) => void,
  ) => {
    const newState = !currentState;
    try {
      await invoke("set_control_pin", { pin, active: newState });
      setter(newState);
    } catch (error) {
      console.error(error);
      alert(t("alert_pin_error"));
    }
  };

  const handleSend = async () => {
    if (!text) return;

    setHistory((prev) => {
      const historyWithoutDuplicate = prev.filter((item) => item !== text);
      return [...historyWithoutDuplicate.slice(-49), text];
    });
    setHistoryIndex(-1);
    setDraft("");

    let payload = text;
    if (mode === "ASCII") {
      if (lineEnding === "LF") payload += "\n";
      if (lineEnding === "CRLF") payload += "\r\n";
    }
    
    try {
      await invoke("write_serial", { content: payload });
      setText("");
    } catch (error) {
      console.error(error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;

      if (historyIndex === -1) {
        setDraft(text);
        const newIndex = history.length - 1;
        setHistoryIndex(newIndex);
        setText(history[newIndex]);
      } else {
        const newIndex = Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setText(history[newIndex]);
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setText(draft);
      } else {
        setHistoryIndex(newIndex);
        setText(history[newIndex]);
      }
    }
  };

  const handleClear = () => {
    window.dispatchEvent(new Event("terminal:clear"));
  };

  return (
    <div className="h-14 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center px-4 gap-3 shrink-0 transition-colors duration-300">
      <button
        onClick={handleClear}
        className="
              p-2 rounded-md transition-all duration-200
              text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400
              hover:bg-red-500/10 hover:shadow-[0_0_15px_rgba(248,113,113,0.15)]
              active:scale-95
          "
        title={t("clean_tooltip")}
      >
        <Eraser size={18} />
      </button>

      <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 mx-1" />

      <button
        onClick={toggleLocalEcho}
        className={`
              relative flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all duration-200 group
              ${
                localEcho
                  ? "bg-blue-500/10 border-blue-500/50 text-blue-600 dark:text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                  : "bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-600 hover:text-slate-700 dark:hover:text-slate-400"
              }
          `}
        title={localEcho ? t("echo_tooltip_on") : t("echo_tooltip_off")}
      >
        <Repeat2
          size={14}
          className={`transition-transform duration-300 ${localEcho ? "rotate-180" : "rotate-0"}`}
        />

        <span className="text-xs font-bold font-mono tracking-wide">ECHO</span>

        <div
          className={`
              absolute -top-1 -right-1 w-2 h-2 rounded-full border border-slate-200 dark:border-slate-900 transition-all duration-300
              ${localEcho ? "bg-blue-500 scale-100" : "bg-slate-400 dark:bg-slate-700 scale-0 opacity-0"}
          `}
        />
      </button>

      <div className="flex-1 relative flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              mode === "ASCII"
                ? t("input_placeholder_ascii")
                : t("input_placeholder_hex")
            }
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-sm rounded-md pl-3 pr-8 py-2 focus:outline-none focus:border-blue-500 font-mono transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600">
            <CornerDownLeft size={14} />
          </div>
        </div>
      </div>

      <div className="relative group">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 group-hover:text-blue-500 transition-colors pointer-events-none">
          <CornerDownLeft size={14} />
        </div>

        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value as any)}
          className="appearance-none bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-mono font-bold rounded-md 
                        pl-9 pr-8 py-1.5 
                        outline-none 
                        focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 
                        transition-all cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 min-w-[110px]"
          title={t("line_ending_tooltip")}
        >
          <option value="NONE">NONE</option>
          <option value="LF">LF (\n)</option>
          <option value="CRLF">CRLF (\r\n)</option>
        </select>

        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600 pointer-events-none group-focus-within:text-blue-500">
          <ChevronDown size={12} strokeWidth={2.5} />
        </div>
      </div>

      <button
        onClick={handleSend}
        className="
              group relative flex items-center justify-center p-2 rounded-md
              bg-gradient-to-b from-blue-500 to-blue-600
              hover:from-blue-400 hover:to-blue-500
              border-b-2 border-blue-800 hover:border-blue-700
              active:border-b-0 active:translate-y-0.5
              shadow-lg shadow-blue-900/40
              transition-all duration-100 ease-out
          "
        title={t("send_tooltip")}
      >
        <Send
          size={18}
          className="text-white drop-shadow-sm group-active:translate-x-0.5 group-active:-translate-y-0.5 transition-transform"
        />
      </button>

      <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 mx-2" />

      <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 p-2 rounded-md border border-slate-300 dark:border-slate-800">
        <LedIndicator
          active={dtrState}
          color="yellow"
          label="DTR"
          interactive
          onClick={() => togglePin("DTR", dtrState, setDtrState)}
        />
        <LedIndicator
          active={rtsState}
          color="yellow"
          label="RTS"
          interactive
          onClick={() => togglePin("RTS", rtsState, setRtsState)}
        />

        <div className="w-px h-6 bg-slate-300 dark:bg-slate-800 mx-1"></div>

        <LedIndicator active={txActive} color="purple" label="TX" />
        <LedIndicator active={rxActive} color="green" label="RX" />
      </div>
    </div>
  );
}
