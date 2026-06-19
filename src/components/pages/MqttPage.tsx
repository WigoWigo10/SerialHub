import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Cloud,
  Wifi,
  WifiOff,
  Play,
  Trash2,
  Check,
  X,
  Tag,
  Activity,
  BookMarked,
  Save,
  Plus,
  Binary,
  FileText,
  Lock,
  FolderOpen,
  AlertCircle,
  CheckCircle2, 
  Eye,
  EyeOff,
  Skull,
  Loader2,
  Globe
} from "lucide-react";
import toast from "react-hot-toast";
import { TopicTree } from "../mqtt/TopicTree";
import { MqttChart } from "../mqtt/MqttChart";
import { useMqttStore, MqttProfile } from "../../stores/mqttStore";
import { useLanguage } from "../../hooks/useLanguage";
import { useSettingsStore } from "../../stores/settingsStore";

interface MqttMessage {
  topic: string;
  payload: string;
  qos: number;
  timestamp: string;
}

interface ChartDataPoint {
  time: string;
  value: number;
  originalTime: number;
}

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];

const SecurityInput = ({ 
  label, 
  value, 
  isValid, 
  placeholder, 
  onChange,
  onBrowse
}: { 
  label: string, 
  value: string, 
  isValid: boolean | null, 
  placeholder: string, 
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  onBrowse: () => void 
}) => (
  <div className="flex flex-col gap-1">
    <div className="flex justify-between">
      <label className="text-xs font-bold uppercase text-slate-500">{label}</label>
      {value && isValid === false && (
        <span className="text-[10px] text-red-500 font-bold flex items-center gap-1 animate-pulse">
          <AlertCircle size={10} /> Arquivo não encontrado
        </span>
      )}
      {value && isValid === true && (
        <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
          <CheckCircle2 size={10} /> Válido
        </span>
      )}
    </div>
    <div className="flex gap-2 relative">
        <input 
            value={value} 
            onChange={onChange} 
            className={`
                flex-1 px-3 py-2 rounded-lg border bg-white dark:bg-slate-950 text-xs font-mono truncate transition-colors outline-none
                ${isValid === false 
                    ? "border-red-400 focus:border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10" 
                    : isValid === true 
                        ? "border-emerald-400 focus:border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/10"
                        : "border-slate-300 dark:border-slate-700 focus:border-blue-500"
                }
            `}
            placeholder={placeholder} 
        />
        <button onClick={onBrowse} className="px-3 bg-slate-200 dark:bg-slate-800 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors border border-slate-300 dark:border-slate-700">
            <FolderOpen size={16} className="text-slate-600 dark:text-slate-400"/>
        </button>
    </div>
  </div>
);

export function MqttPage() {
  const { t } = useLanguage();
  const { theme } = useSettingsStore();
  // Store de Perfis
  const { profiles, addProfile, removeProfile } = useMqttStore();
  const [showProfiles, setShowProfiles] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Estados do Modal
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [tempProfileName, setTempProfileName] = useState("");

  // Rastreia qual perfil está em uso
  const [activeProfileName, setActiveProfileName] = useState<string | null>(
    null
  );

  // Modo de Visualização (Texto ou Hexadecimal)
  const [viewMode, setViewMode] = useState<"ASCII" | "HEX">("ASCII");

  // Configurações (Inputs)
  const [broker, setBroker] = useState("broker.hivemq.com");
  const [port, setPort] = useState(1883);
  const [clientId, setClientId] = useState(
    `SerialHub-${Math.floor(Math.random() * 1000)}`
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [caPath, setCaPath] = useState("");
  const [certPath, setCertPath] = useState("");
  const [keyPath, setKeyPath] = useState("");

  const securityBackupRef = useRef({ ca: "", cert: "", key: "" });

  // Estados de Validação (null = neutro, true = válido, false = inválido)
  const [caValid, setCaValid] = useState<boolean | null>(null);
  const [certValid, setCertValid] = useState<boolean | null>(null);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);

  // Estado Conexão
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<MqttMessage[]>([]);
  const isConnectingRef = useRef(false);

  // Subscrições e Publish
  const [subTopic, setSubTopic] = useState("serialhub/#");
  const [activeSubs, setActiveSubs] = useState<string[]>([]);
  const [pubTopic, setPubTopic] = useState("serialhub/teste");
  const [pubMessage, setPubMessage] = useState("Olá MQTT!");
  const [retain, setRetain] = useState(false);

  // Estados para LWT
  const [lwtTopic, setLwtTopic] = useState("");
  const [lwtPayload, setLwtPayload] = useState("");
  const [lwtQos, setLwtQos] = useState(0);
  const [lwtRetain, setLwtRetain] = useState(false);
  
  // Modal e Backup LWT
  const [isLwtModalOpen, setIsLwtModalOpen] = useState(false);
  const lwtBackupRef = useRef({ topic: "", payload: "", qos: 0, retain: false });

  // Estado para WebSockets
  const [useWebsockets, setUseWebsockets] = useState(false);

  // Gráficos
  const [chartTopics, setChartTopics] = useState<string[]>([]);
  const [chartHistory, setChartHistory] = useState<
    Record<string, ChartDataPoint[]>
  >({});

  const toastIdRef = useRef<string | undefined>(undefined);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });

  useEffect(() => {
    if (useWebsockets) {
      // Se estava na porta TCP padrão (1883), muda para WS padrão (8000)
      if (port === 1883) setPort(8000);
    } else {
      // Se estava na porta WS padrão (8000), muda para TCP padrão (1883)
      if (port === 8000) setPort(1883);
    }
  }, [useWebsockets]);

  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  // --- LÓGICA DO MODAL LWT (SNAPSHOT/ROLLBACK) ---
  const openLwtModal = () => {
    lwtBackupRef.current = { topic: lwtTopic, payload: lwtPayload, qos: lwtQos, retain: lwtRetain };
    setIsLwtModalOpen(true);
  };

  const cancelLwtModal = () => {
    setLwtTopic(lwtBackupRef.current.topic);
    setLwtPayload(lwtBackupRef.current.payload);
    setLwtQos(lwtBackupRef.current.qos);
    setLwtRetain(lwtBackupRef.current.retain);
    handleInputChange(() => {}, null);
    setIsLwtModalOpen(false);
  };

  const confirmLwtModal = () => {
    // Validação: Sugestão de boas práticas
    if (lwtTopic && !lwtTopic.includes("/")) {
      toast(t('mqtt_toast_lwt_hint'), { icon: '💡' });
    }
    setIsLwtModalOpen(false);
  };  

  // --- LÓGICA DE ARQUIVOS ---
  const handleFileSelect = async (setter: (path: string) => void, label: string, extensions: string[]) => {
    // Logs de debug mantidos em inglês/técnico para o desenvolvedor
    console.log(`[SEC-DEBUG] File dialog for: ${label}`);
    
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: label,
          extensions: extensions
        }]
      });
        
      if (selected && typeof selected === 'string') {
        setter(selected);
        handleInputChange(() => {}, null); // Força atualização do estado 'sujo' se necessário
        
        toast.success(`${label} ${t('mqtt_toast_file_ok')}`, { icon: '📂' });
      }
    } catch (err) {
      console.error("[SEC-DEBUG] Error opening dialog:", err);
      toast.error(t('mqtt_toast_file_err'));
    }
  };

  // --- VALIDAÇÃO EM TEMPO REAL ---
  useEffect(() => {
    const validate = async (path: string, setter: (v: boolean | null) => void) => {
      if (!path) { 
        setter(null); 
        return; 
      }
      try {
        const exists = await invoke<boolean>("check_file_exists", { path });
        setter(exists);
      } catch (e) { 
        setter(false); 
      }
    };

    // Debounce para evitar chamadas excessivas ao Rust
    const timer = setTimeout(() => {
      validate(caPath, setCaValid);
      validate(certPath, setCertValid);
      validate(keyPath, setKeyValid);
    }, 300);

    return () => clearTimeout(timer);
  }, [caPath, certPath, keyPath]);

  // --- LÓGICA DE PERFIS ---
  const handleOpenSaveModal = () => {
    if (!broker) return toast.error(t('mqtt_toast_broker_empty'));
    
    setTempProfileName(t('mqtt_def_profile_name'));
    
    setShowProfiles(false);
    setIsSaveModalOpen(true);
  };

  const handleConfirmSave = () => {
    if (!tempProfileName.trim()) return toast.error(t('mqtt_toast_invalid_name'));
    
    if (caValid === false || certValid === false || keyValid === false) {
      return toast.error(t('mqtt_toast_fix_errors'), { icon: '🚫' });
    }

    console.log("[SEC-DEBUG] Salvando perfil com configurações TLS:", { ca: caPath, cert: certPath, key: keyPath });
    
    addProfile({ 
      name: tempProfileName, broker, port, clientId, username, password, 
      savedTopics: activeSubs,
      caFilePath: caPath, certFilePath: certPath, keyFilePath: keyPath,
      lwtTopic, lwtPayload, lwtQos, lwtRetain,
      useWebsockets: useWebsockets
    });
    
    setActiveProfileName(tempProfileName);
    setIsSaveModalOpen(false);
    toast.success(t('mqtt_toast_saved'), { icon: '💾' });
  };

  const openSecurityModal = () => {
    securityBackupRef.current = { ca: caPath, cert: certPath, key: keyPath };
    console.log(
      "[SEC-DEBUG] Backup de segurança criado:",
      securityBackupRef.current
    );
    setIsSecurityModalOpen(true);
  };

  const cancelSecurityModal = () => {
    console.log(
      "[SEC-DEBUG] Cancelando... Restaurando backup:",
      securityBackupRef.current
    );
    setCaPath(securityBackupRef.current.ca);
    setCertPath(securityBackupRef.current.cert);
    setKeyPath(securityBackupRef.current.key);

    handleInputChange(() => {}, null);

    setIsSecurityModalOpen(false);
  };

  const confirmSecurityModal = () => {
    if ((certPath && !keyPath) || (!certPath && keyPath)) {
      toast.error(t('mqtt_toast_cert_mismatch'), { icon: "⚠️" });
      return;
    }

    if (caValid === false || certValid === false || keyValid === false) {
      toast.error(t('mqtt_toast_fix_errors'));
      return;
    }

    console.log("[SEC-DEBUG] Alterações confirmadas. Mantendo novos valores.");
    setIsSecurityModalOpen(false);
  };

  const handleLoadProfile = async (p: MqttProfile) => {
    setBroker(p.broker); setPort(p.port); setClientId(p.clientId);
    setUsername(p.username || ""); setPassword(p.password || "");
    
    setCaPath(p.caFilePath || ""); 
    setCertPath(p.certFilePath || ""); 
    setKeyPath(p.keyFilePath || "");
    
    console.log(`[SEC-DEBUG] Perfil carregado '${p.name}'. TLS Status:`, { hasCA: !!p.caFilePath, hasCert: !!p.certFilePath, hasKey: !!p.keyFilePath });
    
    setActiveProfileName(p.name);
    setShowProfiles(false);
    toast.success(`${t('mqtt_toast_loaded')}: ${p.name}`);

    setLwtTopic(p.lwtTopic || "");
    setLwtPayload(p.lwtPayload || "");
    setLwtQos(p.lwtQos || 0);
    setLwtRetain(p.lwtRetain || false);
    setUseWebsockets(p.useWebsockets || false);

    const pathsToCheck = [
      { name: 'CA', path: p.caFilePath },
      { name: 'Cert', path: p.certFilePath },
      { name: 'Key', path: p.keyFilePath }
    ];

    for (const file of pathsToCheck) {
      if (file.path) {
        try {
          const exists = await invoke<boolean>("check_file_exists", { path: file.path });
          if (!exists) {
            toast((_t) => (
              <div className="flex items-start gap-2">
                <AlertCircle className="text-amber-500 mt-1" size={18} />
                <div className="flex flex-col">
                  <span className="font-bold text-slate-700 dark:text-slate-200">{t('mqtt_toast_file_missing')}</span>
                  <span className="text-xs text-slate-500">{t('mqtt_toast_file_missing_desc')} ({file.name})</span>
                </div>
              </div>
            ), { duration: 6000, position: "bottom-right" });
          }
        } catch (e) {
            console.error("Erro ao verificar arquivo no load:", e);
        }
      }
    }
  };

  const hasLwtConfig = !!lwtTopic;

  const handleInputChange = (setter: (val: any) => void, value: any) => {
    setter(value);
    if (activeProfileName) setActiveProfileName(null);
  };

  // --- LISTENERS DE EVENTOS (MENSAGENS E STATUS) ---
  useEffect(() => {
    // Array para guardar as Promessas de cancelamento
    const unlistenPromises: Promise<() => void>[] = [];

    console.log("[LISTENER-DEBUG] Iniciando configuração dos ouvintes MQTT...");

    // 1. Listener de Mensagens
    const pMsg = listen<MqttMessage>("mqtt-message", (event) => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString();
      const newMsg = { ...event.payload, timestamp: timeStr };
      const topic = event.payload.topic;

      setMessages((prev) => [...prev, newMsg]);

      setChartHistory((prevHistory) => {
        const newHistory = { ...prevHistory };
        let changed = false;

        // Tópico MQTT direto
        if (prevHistory[topic] !== undefined) {
          const val = parseFloat(event.payload.payload);
          if (!isNaN(val)) {
            newHistory[topic] = [...(prevHistory[topic] || []), {
              time: timeStr, value: val, originalTime: now.getTime(),
            }].slice(-100);
            changed = true;
          }
        }

        // Campos JSON: chaves no formato "topico/mqtt.campo.aninhado"
        const jsonPrefix = `${topic}.`;
        Object.keys(prevHistory).forEach(key => {
          if (!key.startsWith(jsonPrefix)) return;
          const fieldPath = key.slice(jsonPrefix.length);
          try {
            const json = JSON.parse(event.payload.payload);
            const parts = fieldPath.split('.');
            let fieldVal: any = json;
            for (const part of parts) {
              if (fieldVal == null || typeof fieldVal !== 'object') { fieldVal = undefined; break; }
              fieldVal = fieldVal[part];
            }
            const numVal = parseFloat(String(fieldVal));
            if (fieldVal !== undefined && !isNaN(numVal)) {
              newHistory[key] = [...(prevHistory[key] || []), {
                time: timeStr, value: numVal, originalTime: now.getTime(),
              }].slice(-100);
              changed = true;
            }
          } catch { /* payload não é JSON válido */ }
        });

        return changed ? newHistory : prevHistory;
      });
    });
    unlistenPromises.push(pMsg);

    // 2. Listener de Status
    const pStatus = listen<string>("mqtt-status", (event) => {
      console.log("[LISTENER-DEBUG] Evento de STATUS recebido:", event.payload);
      const status = event.payload;

      if (status === "connected") {
        if (safetyTimeoutRef.current !== null) {
          clearTimeout(safetyTimeoutRef.current);
          safetyTimeoutRef.current = null;
        }
        isConnectingRef.current = false;
        setIsConnected(true);
        setIsConnecting(false);

        if (toastIdRef.current) {
          toast.success(tRef.current('mqtt_toast_connected'), { id: toastIdRef.current });
          toastIdRef.current = undefined;
        } else {
          toast.success(tRef.current('mqtt_toast_connected'));
        }
      } else if (status === "disconnected") {
        setIsConnected(false);
        setIsConnecting(false);
        setActiveSubs([]);

        if (toastIdRef.current) {
          toast.success(tRef.current('mqtt_toast_disconnected'), { id: toastIdRef.current, icon: "🔌" });
          toastIdRef.current = undefined;
        }
      }
    });
    unlistenPromises.push(pStatus);

    // 3. Listener de Erros
    const pError = listen<string>("mqtt-error", (event) => {
      console.error("[LISTENER-DEBUG] Evento de ERRO recebido:", event.payload);

      // Cancela o timer de segurança se ainda estiver pendente
      if (safetyTimeoutRef.current !== null) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      // Se o timer de segurança já disparou e tratou o erro, apenas limpa o estado
      if (!isConnectingRef.current) {
        setIsConnected(false);
        return;
      }

      isConnectingRef.current = false;
      setIsConnecting(false);
      setIsConnected(false);

      let errorMsg = event.payload;
      if (errorMsg.includes("Network timeout") || errorMsg.includes("NetworkTimeout")) {
        errorMsg = tRef.current('mqtt_err_timeout');
      }
      if (errorMsg.includes("refused")) errorMsg = tRef.current('mqtt_err_refused');

      if (toastIdRef.current) {
        toast.error(errorMsg, { id: toastIdRef.current, duration: 5000 });
        toastIdRef.current = undefined;
      } else {
        toast.error(errorMsg);
      }
    });
    unlistenPromises.push(pError);

    // FUNÇÃO DE LIMPEZA (CLEANUP)
    return () => {
      console.log("[LISTENER-DEBUG] Limpando listeners...");
      unlistenPromises.forEach(p => {
        p.then(unlisten => unlisten());
      });
    };
  }, []);

  const handleConnectToggle = async () => {
    if (isConnectingRef.current) return;

    if (isConnected) {
      // --- LÓGICA DE DESCONEXÃO ---
      toastIdRef.current = toast.loading(t('mqtt_msg_disconnecting'));
      try {
        await invoke("disconnect_mqtt");
      } catch (error) {
        toast.error(`${t('mqtt_err_generic')}${error}`, { id: toastIdRef.current });
      }
    } else {
      // --- LÓGICA DE CONEXÃO ---
      isConnectingRef.current = true;
      setIsConnecting(true);
      toastIdRef.current = toast.loading(`${t('mqtt_msg_connecting')} ${broker}:${port}...`);
      
      const connectionParams = {
        broker,
        port: Number(port),
        clientId,
        username: username || null,
        password: password || null,
        caPath: caPath || null,
        certPath: certPath || null,
        keyPath: keyPath || null,
        lwtTopic: lwtTopic || null,
        lwtPayload: lwtPayload || null,
        lwtQos: lwtQos,
        lwtRetain: lwtRetain,
        useWebsockets: useWebsockets
      };

      console.log("[FRONT-DEBUG] Tentando conectar > Params:", connectionParams);
      
      // --- TIMER DE SEGURANÇA ---
      safetyTimeoutRef.current = setTimeout(() => {
        safetyTimeoutRef.current = null;
        if (!isConnectingRef.current) return;
        isConnectingRef.current = false;
        toast.error(tRef.current('mqtt_err_timeout'), { id: toastIdRef.current });
        toastIdRef.current = undefined;
        setIsConnecting(false);
      }, 5000);

      try {
        await invoke("connect_mqtt", connectionParams);
      } catch (error) {
        setIsConnecting(false);
        toast.error(`${t('mqtt_err_failed')}${error}`, { id: toastIdRef.current });
      }
    }
  };

  const handleSubscribe = async () => {
    if (!isConnected) return;
    if (activeSubs.includes(subTopic))
      return toast(t('mqtt_warn_already_sub'), { icon: "ℹ️" });
      
    try {
      await invoke("subscribe_mqtt", { topic: subTopic });
      setActiveSubs((prev) => [...prev, subTopic]);
      toast.success(`${t('mqtt_msg_subscribed')}${subTopic}`);
    } catch (e) {
      toast.error(t('mqtt_err_sub'));
    }
  };

  const handleUnsubscribe = async (topicToRemove: string) => {
    try {
      await invoke("unsubscribe_mqtt", { topic: topicToRemove });
      setActiveSubs((prev) => prev.filter((t) => t !== topicToRemove));
      toast.success(`${t('mqtt_msg_unsubscribed')}${topicToRemove}`, { icon: "🗑️" });
    } catch (e) {
      toast.error(t('mqtt_err_unsub'));
    }
  };

  const handlePublish = async () => {
    if (!isConnected) return;
    try {
      await invoke("publish_mqtt", {
        topic: pubTopic,
        payload: pubMessage,
        qos: 0,
        retain,
      });
      toast.success(t('mqtt_msg_published'), {
        duration: 1000,
        icon: "📤",
        position: "bottom-right",
      });
    } catch (e) {
      toast.error(t('mqtt_err_pub'));
    }
  };

  const handleAddToChart = (topic: string) => {
    if (chartTopics.includes(topic))
      return toast(t('mqtt_warn_already_chart'), { icon: "📊" });

    if (chartTopics.length >= 3) return toast.error(t('mqtt_warn_max_charts'));

    setChartTopics((prev) => [...prev, topic]);
    setChartHistory((prev) => {
      if (prev[topic] && prev[topic].length > 0) return prev;

      let initialData: ChartDataPoint[] = [];

      // Tópico MQTT direto
      const lastDirectMsg = [...messages].reverse().find((m) => m.topic === topic);
      if (lastDirectMsg) {
        const val = parseFloat(lastDirectMsg.payload);
        if (!isNaN(val))
          initialData = [{ time: lastDirectMsg.timestamp, value: val, originalTime: Date.now() }];
      } else {
        // Campo JSON: busca a mensagem pai cujo tópico é prefixo de "topic."
        const parentMsg = [...messages].reverse().find((m) => topic.startsWith(`${m.topic}.`));
        if (parentMsg) {
          const fieldPath = topic.slice(parentMsg.topic.length + 1);
          try {
            const json = JSON.parse(parentMsg.payload);
            const parts = fieldPath.split('.');
            let fieldVal: any = json;
            for (const part of parts) {
              if (fieldVal == null || typeof fieldVal !== 'object') { fieldVal = undefined; break; }
              fieldVal = fieldVal[part];
            }
            const numVal = parseFloat(String(fieldVal));
            if (fieldVal !== undefined && !isNaN(numVal))
              initialData = [{ time: parentMsg.timestamp, value: numVal, originalTime: Date.now() }];
          } catch { /* payload inválido */ }
        }
      }

      return { ...prev, [topic]: initialData };
    });
    toast.success(`${t('mqtt_msg_chart_added')}${topic}`, { icon: "📈" });
  };

  const handleStopChart = (topic: string) => {
    setChartTopics((prev) => prev.filter((t) => t !== topic));
    setChartHistory((prev) => {
      const newHist = { ...prev };
      delete newHist[topic];
      return newHist;
    });
    toast.success(`${t('mqtt_msg_chart_stopped')}${topic}`);
  };
  
  const handleHideChart = (topic: string) => {
    setChartTopics((prev) => prev.filter((t) => t !== topic));
  };
  
  const handleToggleChart = (topic: string) => {
    if (chartTopics.includes(topic)) {
      handleHideChart(topic);
      return;
    }
    handleAddToChart(topic);
  };

  const isAlreadySubscribed = activeSubs.includes(subTopic);
  const hasSecurityConfig = caPath || certPath || keyPath;

  return (
    <div
      className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 gap-4 overflow-hidden relative"
      onClick={() => setShowProfiles(false)}
    >
      {/* HEADER (Conexão e Perfis) */}
      <div
        className={`flex flex-col bg-white dark:bg-slate-900 rounded-lg shadow-sm border transition-colors duration-300 relative z-20 ${
          activeProfileName
            ? "border-emerald-500/30 dark:border-emerald-800/50"
            : "border-slate-200 dark:border-slate-800"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* --- BARRA DE STATUS SUPERIOR --- */}
        {activeProfileName && (
          <div className="w-full bg-emerald-100/80 dark:bg-emerald-900/40 border-b border-emerald-200 dark:border-emerald-800/50 px-4 py-1 flex items-center justify-between animate-in slide-in-from-top-2 duration-200 rounded-t-lg">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 tracking-wider">
                {t('mqtt_profile_active')}
              </span>
              <span className="text-xs font-mono font-bold text-emerald-800 dark:text-emerald-200">
                {activeProfileName}
              </span>
            </div>

            <button
              onClick={() => setActiveProfileName(null)}
              className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 hover:text-red-600 dark:hover:text-red-400 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/40 px-2 py-0.5 rounded transition-all"
              title={t('mqtt_tooltip_exit_profile')}
            >
              <X size={10} strokeWidth={3} />
              <span>{t('mqtt_btn_exit_profile')}</span>
            </button>
          </div>
        )}

        {/* CONTROLES */}
        <div className="flex flex-wrap items-end gap-3 p-4">
            
          {/* 1. SELETOR DE PERFIL */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase text-slate-400">{t('mqtt_profile')}</label>
            <div className="relative z-50">
              <button onClick={() => setShowProfiles(!showProfiles)} disabled={isConnected || isConnecting} className={`h-[34px] w-[34px] flex items-center justify-center rounded border transition-colors ${activeProfileName ? "border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/10" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"}`}><BookMarked size={18} /></button>
              {showProfiles && (
                <div className="absolute top-10 left-0 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100 z-[60]">
                  <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex justify-between items-center rounded-t-lg">
                    <span className="text-xs font-bold uppercase text-slate-500">{t('mqtt_saved_profiles')}</span>
                    <button onClick={handleOpenSaveModal} className="text-emerald-600 hover:text-emerald-500 text-xs flex items-center gap-1 font-bold"><Plus size={12}/> {t('mqtt_new_profile')}</button>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {profiles.map(p => (
                      <div key={p.id} className="flex items-center justify-between p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded group cursor-pointer" onClick={() => handleLoadProfile(p)}>
                        <div className="flex flex-col"><span className="text-sm font-medium">{p.name}</span><span className="text-[10px] text-slate-400 font-mono">{p.broker}:{p.port}</span></div>
                        <button onClick={(e) => { e.stopPropagation(); removeProfile(p.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 2. BROKER & PORTA */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase text-slate-400">{t('mqtt_broker_port')}</label>
              
              {/* TOGGLE WS */}
              <div 
                className={`flex items-center gap-1 cursor-pointer transition-colors ${useWebsockets ? "text-blue-500" : "text-slate-400 hover:text-slate-500"}`}
                onClick={() => !isConnected && !isConnecting && setUseWebsockets(!useWebsockets)}
                title={useWebsockets ? t('mqtt_ws_active') : t('mqtt_tcp_active')}
              >
                <span className="text-[9px] font-bold">{useWebsockets ? "WS/WSS" : "TCP"}</span>
                <Globe size={10} />
              </div>
            </div>

            <div className="flex shadow-sm relative">
              <input 
                value={broker} onChange={e => handleInputChange(setBroker, e.target.value)} disabled={isConnected || isConnecting} 
                className={`px-3 py-1.5 h-[34px] rounded-l border border-r-0 border-slate-300 dark:border-slate-700 bg-transparent text-sm w-36 font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all z-10 placeholder:text-slate-300 truncate ${useWebsockets ? "text-blue-600 dark:text-blue-400 font-bold" : ""}`}
                placeholder="broker.hivemq.com" 
              />
              <div className="border-t border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 flex items-center text-slate-400 text-xs font-mono">:</div>
              <input 
                type="number" value={port} onChange={e => handleInputChange(setPort, Number(e.target.value))} disabled={isConnected || isConnecting} 
                className="px-2 py-1.5 h-[34px] rounded-r border border-l-0 border-slate-300 dark:border-slate-700 bg-transparent text-sm w-16 font-mono outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-center text-slate-600 dark:text-slate-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
              />
              
              {useWebsockets && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse pointer-events-none" />
              )}
            </div>
          </div>

          {/* 3. CLIENT ID */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase text-slate-400">{t('mqtt_client_id')}</label>
            <input value={clientId} onChange={e => handleInputChange(setClientId, e.target.value)} disabled={isConnected || isConnecting} className="px-3 py-1.5 h-[34px] rounded border border-slate-300 dark:border-slate-700 bg-transparent text-sm w-32 font-mono text-slate-500 outline-none focus:border-blue-500 transition-colors shadow-sm" />
          </div>
          
          {/* 4. CREDENCIAIS + BOTÕES DE SEGURANÇA */}
          <div className="flex gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase text-slate-400">{t('mqtt_user')}</label>
              <input value={username} onChange={e => handleInputChange(setUsername, e.target.value)} disabled={isConnected || isConnecting} className="px-3 py-1.5 h-[34px] rounded border border-slate-300 dark:border-slate-700 bg-transparent text-sm w-28 outline-none focus:border-blue-500 transition-colors shadow-sm" placeholder={t('mqtt_user_placeholder')} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase text-slate-400">{t('mqtt_pass')}</label>
              <div className="flex gap-1"> 
                  
                {/* Wrapper Senha */}
                <div className="relative w-28">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={e => handleInputChange(setPassword, e.target.value)} disabled={isConnected || isConnecting} className="w-full px-3 py-1.5 h-[34px] rounded border border-slate-300 dark:border-slate-700 bg-transparent text-sm outline-none focus:border-blue-500 transition-colors shadow-sm pr-8 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden" placeholder={t('mqtt_pass_placeholder')} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={isConnected || isConnecting || !password} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-30" tabIndex={-1}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>

                {/* Botão Cadeado */}
                <button onClick={openSecurityModal} disabled={isConnected || isConnecting} className={`h-[34px] w-[34px] flex items-center justify-center rounded border transition-colors ${hasSecurityConfig ? "bg-amber-50 border-amber-300 text-amber-600 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"}`} title={hasSecurityConfig ? t('mqtt_tls_configured') : t('mqtt_tls_configure')}><Lock size={16} strokeWidth={hasSecurityConfig ? 2.5 : 2} /></button>
                
                {/* Botão Caveira (LWT) */}
                <button onClick={openLwtModal} disabled={isConnected || isConnecting} className={`h-[34px] w-[34px] flex items-center justify-center rounded border transition-colors ${hasLwtConfig ? "bg-purple-50 border-purple-300 text-purple-600 dark:bg-purple-900/20 dark:border-purple-700 dark:text-purple-400" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"}`} title={hasLwtConfig ? `${t('mqtt_lwt_active')} ${lwtTopic}` : t('mqtt_lwt_configure')}><Skull size={16} strokeWidth={hasLwtConfig ? 2.5 : 2} /></button>
              </div>
            </div>
          </div>

          {/* 5. BOTÃO CONECTAR */}
          <button onClick={handleConnectToggle} disabled={isConnecting} className={`ml-auto px-6 py-1.5 h-[34px] rounded-lg font-bold text-sm flex items-center gap-2 transition-all shadow-sm active:scale-95 ${isConnected ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50" : "bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-500/25"}`}>{isConnected ? <WifiOff size={16} /> : <Wifi size={16} />}{isConnected ? t('mqtt_disconnect') : (isConnecting ? t('mqtt_connecting') : t('mqtt_connect'))}</button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        
        {/* COLUNA ESQUERDA: SUBSCRIÇÕES E PUBLICAÇÃO */}
        <div className="w-80 flex flex-col gap-4">
          
          {/* 1. SUBSCRIPTIONS PANEL */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col gap-3 shadow-sm">
            <h3 className="font-bold text-xs uppercase text-slate-400 flex items-center gap-2">
              <Tag size={14} className="text-blue-500" /> {t('mqtt_sub_header')}
            </h3>
            <div className="flex gap-2">
              <input
                value={subTopic}
                onChange={(e) => setSubTopic(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none"
                placeholder={t('mqtt_ph_topic_hash')}
              />
              <button
                onClick={handleSubscribe}
                disabled={!isConnected || isAlreadySubscribed}
                title={isAlreadySubscribed ? t('mqtt_warn_already_sub') : t('mqtt_tooltip_sub')}
                className={`p-2 rounded border transition-all ${
                  isAlreadySubscribed
                    ? "bg-green-100 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50 cursor-default"
                    : "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/40"
                } disabled:opacity-50`}
              >
                {isAlreadySubscribed ? <Check size={16} /> : <Play size={16} />}
              </button>
            </div>
            
            {/* Lista de Tags Ativas */}
            <div className="flex flex-wrap gap-2 mt-1">
              {activeSubs.map((topic) => (
                <div
                  key={topic}
                  onClick={() => setSubTopic(topic)}
                  className="group flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded text-xs font-mono border border-blue-200 cursor-pointer select-none hover:bg-blue-200"
                >
                  <span className="font-bold">{topic}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnsubscribe(topic);
                    }}
                    className="ml-1 hover:text-red-500 opacity-60 group-hover:opacity-100"
                    title={t('mqtt_msg_unsubscribed')}
                  >
                    <X size={12} strokeWidth={3} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 2. PUBLISH PANEL */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex flex-col gap-3 flex-1 shadow-sm">
            <h3 className="font-bold text-xs uppercase text-slate-400 flex items-center gap-2">
              <Cloud size={14} className="text-emerald-500" /> {t('mqtt_publish_title')}
            </h3>
            <input
              value={pubTopic}
              onChange={(e) => setPubTopic(e.target.value)}
              className="w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none"
              placeholder={t('mqtt_ph_topic')}
            />
            <textarea
              value={pubMessage}
              onChange={(e) => setPubMessage(e.target.value)}
              className="flex-1 w-full px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono resize-none outline-none"
              placeholder={t('mqtt_ph_payload')}
            />
            
            {/* CHECKBOX RETAIN (Customizado) */}
            <div 
              className="flex items-center gap-2 px-1 cursor-pointer group" 
              onClick={() => setRetain(!retain)}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm ${retain ? "bg-emerald-500 border-emerald-500" : "bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 group-hover:border-emerald-400"}`}>
                {retain && <Check size={12} className="text-white" strokeWidth={4} />}
              </div>
              <span className={`text-xs font-bold uppercase select-none transition-colors ${retain ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 group-hover:text-emerald-500"}`}>
                {t('mqtt_retain_label')}
              </span>
            </div>
            
            <button
              onClick={handlePublish}
              disabled={!isConnected}
              className="w-full py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm font-bold shadow-sm"
            >
              {t('mqtt_send_btn')}
            </button>
          </div>
        </div>

        {/* COLUNA DIREITA: EXPLORER E GRÁFICOS */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div
            className={`flex flex-col bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm ${
              chartTopics.length > 0 ? "h-1/2" : "flex-1"
            }`}
          >
            {/* CABEÇALHO DO EXPLORER */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-2 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
              <span className="font-bold text-xs uppercase text-slate-500 px-2 flex items-center gap-2">
                <Cloud size={14} /> {t('mqtt_explorer_title')}
              </span>

              <div className="flex items-center gap-2">
                {/* Toggle HEX / TXT */}
                <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-300 dark:border-slate-700">
                  <button
                    onClick={() => setViewMode("ASCII")}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                      viewMode === "ASCII"
                        ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                    title={t('mqtt_tooltip_view_txt')}
                  >
                    <FileText size={10} /> TXT
                  </button>
                  <button
                    onClick={() => setViewMode("HEX")}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 transition-all ${
                      viewMode === "HEX"
                        ? "bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm"
                        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                    title={t('mqtt_tooltip_view_hex')}
                  >
                    <Binary size={10} /> HEX
                  </button>
                </div>

                <button
                  onClick={() => {
                    setMessages([]);
                    setChartHistory({});
                  }}
                  className="p-1.5 hover:bg-red-100 text-slate-400 hover:text-red-500 rounded transition-colors"
                  title={t('mqtt_tooltip_clear_history')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="flex-1 p-2 overflow-hidden relative">
              {/* ÁRVORE DE TÓPICOS */}
              <TopicTree
                messages={messages}
                onToggleChart={handleToggleChart}
                recordedTopics={chartTopics}
                viewMode={viewMode}
              />
            </div>
          </div>

          {/* GRÁFICOS */}
          {chartTopics.length > 0 && (
            <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-y-auto pr-1">
              {chartTopics.map((topic, index) => (
                <MqttChart
                  key={`${topic}-${theme}`} 
                  topic={topic}
                  data={chartHistory[topic] || []}
                  color={CHART_COLORS[index % CHART_COLORS.length]}
                  onClose={() => handleHideChart(topic)}
                  onStop={() => handleStopChart(topic)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --- OVERLAY DE BLOQUEIO (LOADING) --- */}
      {isConnecting && (
        <div className="absolute inset-0 z-50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300 cursor-wait">
          
          {/* Card Central do Loading */}
          <div className="flex flex-col items-center gap-4 p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 transform scale-110">
            
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
              <Loader2 size={48} className="text-blue-600 dark:text-blue-400 animate-spin relative z-10" />
            </div>
            
            <div className="flex flex-col items-center gap-1">
              <span className="font-bold text-lg text-slate-700 dark:text-slate-200 animate-pulse">
                {t('mqtt_msg_connecting')}...
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">
                {broker}:{port}
              </span>
            </div>

            {/* Botão de Emergência (Opcional, caso trave muito tempo) */}
            <button 
              onClick={() => setIsConnecting(false)}
              className="mt-2 text-[10px] text-red-400 hover:text-red-500 uppercase font-bold tracking-widest hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* --- MODAL DE SEGURANÇA --- */}
      {isSecurityModalOpen && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={cancelSecurityModal}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-amber-600 dark:text-amber-500">
                <Lock size={24} />
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">{t('mqtt_modal_tls_title')}</h3>
              </div>
              {(caPath || certPath || keyPath) && (
                <button 
                  onClick={() => { 
                    console.log("[SEC-DEBUG] Ação: Limpar Tudo acionada.");
                    setCaPath(""); setCertPath(""); setKeyPath(""); 
                    handleInputChange(() => {}, null); 
                    toast.success(t('mqtt_sec_clean_toast')); // "Configuração TLS limpa"
                  }}
                  className="text-xs text-red-500 hover:text-red-700 underline font-bold"
                >
                  {t('mqtt_sec_clean')}
                </button>
              )}
            </div>
            
            <p className="text-xs text-slate-500 mb-4 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800">
                {t('mqtt_modal_tls_desc')}
            </p>

            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800/50 mb-4">
              <p className="text-xs text-amber-800 dark:text-amber-200 font-medium flex items-start gap-2">
                <Activity size={14} className="mt-0.5 shrink-0"/>
                {t('mqtt_sec_auto_check')}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <SecurityInput 
                label={t('mqtt_sec_lbl_ca')} // "CA Certificate (.crt)"
                value={caPath} isValid={caValid} placeholder="C:\certs\ca.crt" 
                onChange={(e: any) => { setCaPath(e.target.value); handleInputChange(() => {}, null); }}
                onBrowse={() => handleFileSelect(setCaPath, 'CA Cert', ['crt', 'pem', 'ca'])}
              />
                
                <div className="p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/20 flex flex-col gap-3">
                  <SecurityInput 
                    label={t('mqtt_sec_lbl_cert')} // "Client Certificate (.crt)"
                    value={certPath} isValid={certValid} placeholder="C:\certs\client.crt"
                    onChange={(e: any) => { setCertPath(e.target.value); handleInputChange(() => {}, null); }}
                    onBrowse={() => handleFileSelect(setCertPath, 'Client Cert', ['crt', 'pem'])}
                  />
                  <SecurityInput 
                    label={t('mqtt_sec_lbl_key')} // "Client Private Key (.key)"
                    value={keyPath} isValid={keyValid} placeholder="C:\certs\client.key"
                    onChange={(e: any) => { setKeyPath(e.target.value); handleInputChange(() => {}, null); }}
                    onBrowse={() => handleFileSelect(setKeyPath, 'Private Key', ['key', 'pem'])}
                  />
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={cancelSecurityModal} className="px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-sm font-bold transition-colors">
                {t('mqtt_btn_cancel')}
              </button>
              <button 
                onClick={confirmSecurityModal} 
                disabled={caValid === false || certValid === false || keyValid === false}
                className={`px-4 py-2 rounded-lg text-white font-bold text-sm shadow-md transition-all ${(caValid === false || certValid === false || keyValid === false) ? "bg-slate-400 cursor-not-allowed opacity-50" : "bg-emerald-600 hover:bg-emerald-700 active:scale-95"}`}
              >
                {t('mqtt_sec_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SALVAR PERFIL */}
      {isSaveModalOpen && (
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsSaveModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4 text-emerald-600 dark:text-emerald-500">
              <Save size={24} />
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">
                {t('mqtt_modal_save_title')}
              </h3>
            </div>

            <div className="flex flex-col gap-2 mb-6">
              <label className="text-xs font-bold uppercase text-slate-500">
                {t('mqtt_modal_save_name')}
              </label>
              <input
                autoFocus
                value={tempProfileName}
                onChange={(e) => setTempProfileName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConfirmSave()}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-medium text-slate-700 dark:text-slate-200"
                placeholder={t('mqtt_save_ph')}
              />
              <p className="text-[10px] text-slate-400">
                {t('mqtt_save_will_save')} {broker}:{port} {t('mqtt_save_creds')}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-sm font-bold transition-colors"
              >
                {t('mqtt_btn_cancel')}
              </button>
              <button
                onClick={handleConfirmSave}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
              >
                {t('mqtt_btn_save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL LWT --- */}
      {isLwtModalOpen && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={cancelLwtModal}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-purple-600 dark:text-purple-500">
                <Skull size={24} />
                <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100">{t('mqtt_modal_lwt_title')}</h3>
              </div>
              {(lwtTopic || lwtPayload || lwtQos !== 0 || lwtRetain) && (
                <button 
                  onClick={() => { 
                    setLwtTopic(""); 
                    setLwtPayload(""); 
                    setLwtQos(0); 
                    setLwtRetain(false); 
                    handleInputChange(() => {}, null); 
                  }} 
                  className="text-xs text-red-500 hover:text-red-700 underline font-bold"
                >
                  {t('mqtt_btn_clean')}
                </button>
              )}
            </div>
            
            <p className="text-xs text-slate-500 mb-4 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800">
              {t('mqtt_modal_lwt_desc')}
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase text-slate-500">{t('mqtt_lwt_topic')}</label>
                <input 
                  value={lwtTopic} 
                  onChange={e => {setLwtTopic(e.target.value); handleInputChange(() => {}, null);}} 
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none focus:border-purple-500" 
                  placeholder={t('mqtt_ph_lwt_topic')} 
                />
              </div>
              
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase text-slate-500">{t('mqtt_lwt_payload')}</label>
                <input 
                  value={lwtPayload} 
                  onChange={e => {setLwtPayload(e.target.value); handleInputChange(() => {}, null);}} 
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none focus:border-purple-500" 
                  placeholder={t('mqtt_ph_lwt_payload')} 
                />
              </div>

              <div className="flex gap-4 mt-1">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-bold uppercase text-slate-500">{t('mqtt_qos_label')}</label>
                  <select value={lwtQos} onChange={e => {setLwtQos(Number(e.target.value)); handleInputChange(() => {}, null);}} className="w-full px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm outline-none">
                    <option value={0}>0 - At Most Once</option>
                    <option value={1}>1 - At Least Once</option>
                    <option value={2}>2 - Exactly Once</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 justify-end pb-2">
                  <div className="flex items-center gap-2 cursor-pointer" onClick={() => {setLwtRetain(!lwtRetain); handleInputChange(() => {}, null);}}>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${lwtRetain ? "bg-purple-600 border-purple-600" : "border-slate-400"}`}>
                      {lwtRetain && <Check size={12} className="text-white" strokeWidth={3}/>}
                    </div>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400 select-none">{t('mqtt_lbl_retain_caps')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={cancelLwtModal} className="px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-sm font-bold transition-colors">
                {t('mqtt_btn_cancel')}
              </button>
              <button onClick={confirmLwtModal} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-sm shadow-md active:scale-95 transition-all">
                {t('mqtt_btn_save_lwt')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}