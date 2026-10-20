import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useMqttSessionStore } from "../../stores/mqttSessionStore";
import { mqttCommands } from "../../lib/mqttCommands";
import { mqttOperation } from "../../lib/mqttSession";
import { MQTT_LIMITS, mqttTopicFits } from "../../lib/mqttLimits";
import { MqttTransport, mqttTransports, isSecureTransport, mqttConfigurationError } from "../../lib/mqttTransport";

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
  const theme = useSettingsStore((state) => state.theme);
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
  const [transport, setTransport] = useState<MqttTransport>('tcp');
  const [websocketPath, setWebsocketPath] = useState('/mqtt');
  const [transportNeedsReview, setTransportNeedsReview] = useState(false);
  const [reviewProfileId, setReviewProfileId] = useState<string | null>(null);

  const securityBackupRef = useRef({ ca: "", cert: "", key: "", profileName: null as string | null });

  // Estados de Validação (null = neutro, true = válido, false = inválido)
  const [caValid, setCaValid] = useState<boolean | null>(null);
  const [certValid, setCertValid] = useState<boolean | null>(null);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);

  // Estado Conexão
  const mqttSnapshot = useMqttSessionStore(state => state.snapshot);
  const reserving = useMqttSessionStore(state => state.reserving);
  const isConnected = mqttSnapshot.status === 'connected';
  const isConnecting = reserving || mqttSnapshot.status === 'connecting' || mqttSnapshot.status === 'stopping';
  const tree = useMqttSessionStore(state => state.tree);
  const monitor = useMqttSessionStore(state => state.monitor);
  const charts = useMqttSessionStore(state => state.charts);
  const discards = useMqttSessionStore(state => state.discards);
  const historyCount = useMqttSessionStore(state => state.messages.length);
  const historyBytes = useMqttSessionStore(state => state.historyBytes);
  const latestCount = useMqttSessionStore(state => state.latest.size);
  const latestBytes = useMqttSessionStore(state => state.latestBytes);
  const chartTopics = [...charts.keys()];

  // Subscrições e Publish
  const [subTopic, setSubTopic] = useState("serialhub/#");
  const activeSubs = useMqttSessionStore(state => state.subscriptions);
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
  const lwtBackupRef = useRef({ topic: "", payload: "", qos: 0, retain: false, profileName: null as string | null });

  // Estado para WebSockets
  const useWebsockets = transport === 'ws' || transport === 'wss';

  const openLwtModal = () => {
    lwtBackupRef.current = { topic: lwtTopic, payload: lwtPayload, qos: lwtQos, retain: lwtRetain, profileName: activeProfileName };
    setIsLwtModalOpen(true);
  };

  const cancelLwtModal = () => {
    setLwtTopic(lwtBackupRef.current.topic);
    setLwtPayload(lwtBackupRef.current.payload);
    setLwtQos(lwtBackupRef.current.qos);
    setLwtRetain(lwtBackupRef.current.retain);
    setActiveProfileName(lwtBackupRef.current.profileName);
    setIsLwtModalOpen(false);
  };

  const confirmLwtModal = () => {
    if (lwtTopic && !lwtTopic.includes("/")) {
      toast(t('mqtt_toast_lwt_hint'), { icon: '💡' });
    }
    const changed = lwtTopic !== lwtBackupRef.current.topic ||
      lwtPayload !== lwtBackupRef.current.payload ||
      lwtQos !== lwtBackupRef.current.qos ||
      lwtRetain !== lwtBackupRef.current.retain;
    if (changed) setActiveProfileName(null);
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
    const error = configurationError();
    if (error) return toast.error(t(error));
    
    if (caValid === false || certValid === false || keyValid === false) {
      return toast.error(t('mqtt_toast_fix_errors'), { icon: '🚫' });
    }

    console.log("[SEC-DEBUG] Salvando perfil com configurações TLS:", { ca: caPath, cert: certPath, key: keyPath });
    
    addProfile({ 
      name: tempProfileName, broker, port, clientId, username,
      savedTopics: activeSubs,
      caFilePath: caPath, certFilePath: certPath, keyFilePath: keyPath,
      lwtTopic, lwtPayload, lwtQos, lwtRetain,
      transport, transportNeedsReview: false, websocketPath,
    });
    
    setActiveProfileName(tempProfileName);
    setIsSaveModalOpen(false);
    toast.success(t('mqtt_toast_saved'), { icon: '💾' });
  };

  const openSecurityModal = () => {
    securityBackupRef.current = { ca: caPath, cert: certPath, key: keyPath, profileName: activeProfileName };
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
    setActiveProfileName(securityBackupRef.current.profileName);
    setIsSecurityModalOpen(false);
  };

  const confirmSecurityModal = () => {
    const error = configurationError(false);
    if (error) { toast.error(t(error)); return; }
    if ((certPath && !keyPath) || (!certPath && keyPath)) {
      toast.error(t('mqtt_toast_cert_mismatch'), { icon: "⚠️" });
      return;
    }

    if (caValid === false || certValid === false || keyValid === false) {
      toast.error(t('mqtt_toast_fix_errors'));
      return;
    }

    const changed = caPath !== securityBackupRef.current.ca ||
      certPath !== securityBackupRef.current.cert ||
      keyPath !== securityBackupRef.current.key;
    if (changed) { setActiveProfileName(null); setReviewProfileId(null); }
    setIsSecurityModalOpen(false);
  };

  const handleLoadProfile = async (p: MqttProfile) => {
    setBroker(p.broker); setPort(p.port); setClientId(p.clientId);
    setUsername(p.username || ""); setPassword("");
    setShowPassword(false);
    
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
    setTransport(p.transport);
    setTransportNeedsReview(p.transportNeedsReview);
    setReviewProfileId(p.id);
    setWebsocketPath(p.websocketPath || '/mqtt');

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
    setReviewProfileId(null);
    if (activeProfileName) setActiveProfileName(null);
  };

  const handleConnectToggle = async () => {
    const state = useMqttSessionStore.getState();
    if (state.reserving || state.snapshot.status === 'connecting' || state.snapshot.status === 'stopping') return;
    try {
      if (state.snapshot.status === 'connected') await mqttCommands.disconnect();
      else {
        const error = configurationError();
        if (error) { toast.error(t(error)); return; }
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
          transport,
          websocketPath: useWebsockets ? websocketPath : null,
        };
        await mqttCommands.connect(connectionParams);
      }
    } catch (error) { toast.error(String(error)); }
  };
  const handleCancelConnection = async () => {
    try { await mqttCommands.cancel(); } catch (error) { toast.error(String(error)); }
  };

  const handleSubscribe = async () => {
    if (!isConnected || monitor.phase !== 'live') return;
    if (!mqttTopicFits(subTopic) || activeSubs.length >= MQTT_LIMITS.subscriptions) return toast.error(t('mqtt_subscription_limit'));
    if (activeSubs.includes(subTopic))
      return toast(t('mqtt_warn_already_sub'), { icon: "ℹ️" });
      
    try {
      const id = useMqttSessionStore.getState().snapshot.session_id;
      await mqttOperation(id, () => useMqttSessionStore.getState().snapshot,
        () => invoke("subscribe_mqtt", { topic: subTopic, expectedSessionId: id }), () => {
          useMqttSessionStore.getState().subscription(id, subTopic, true);
          toast.success(`${t('mqtt_msg_subscribed')}${subTopic}`);
        });
    } catch (e) {
      toast.error(t('mqtt_err_sub'));
    }
  };

  const handleUnsubscribe = async (topicToRemove: string) => {
    try {
      const id = useMqttSessionStore.getState().snapshot.session_id;
      await mqttOperation(id, () => useMqttSessionStore.getState().snapshot,
        () => invoke("unsubscribe_mqtt", { topic: topicToRemove, expectedSessionId: id }), () => {
          useMqttSessionStore.getState().subscription(id, topicToRemove, false);
          toast.success(`${t('mqtt_msg_unsubscribed')}${topicToRemove}`, { icon: "🗑️" });
        });
    } catch (e) {
      toast.error(t('mqtt_err_unsub'));
    }
  };

  const handlePublish = async () => {
    if (!isConnected || monitor.phase !== 'live') return;
    try {
      const id = useMqttSessionStore.getState().snapshot.session_id;
      await mqttOperation(id, () => useMqttSessionStore.getState().snapshot, () => invoke("publish_mqtt", {
        expectedSessionId: id,
        topic: pubTopic,
        payload: pubMessage,
        qos: 0,
        retain,
      }), () => { toast.success(t('mqtt_msg_published'), {
        duration: 1000,
        icon: "📤",
        position: "bottom-right",
      }); });
    } catch (e) {
      toast.error(t('mqtt_err_pub'));
    }
  };

  const handleStopChart = (topic: string) => {
    useMqttSessionStore.getState().removeChart(topic);
    toast.success(`${t('mqtt_msg_chart_stopped')}${topic}`);
  };
  const handleHideChart = (topic: string) => useMqttSessionStore.getState().removeChart(topic);
  const handleToggleChart = (topic: string) => {
    const state = useMqttSessionStore.getState();
    if (state.charts.has(topic)) { state.removeChart(topic); return; }
    if (!state.addChart(topic)) {
      toast.error(t(state.charts.size >= MQTT_LIMITS.charts ? 'mqtt_warn_max_charts' : 'mqtt_chart_unavailable'));
    }
  };

  const isAlreadySubscribed = activeSubs.includes(subTopic);
  const hasSecurityConfig = isSecureTransport(transport);
  function configurationError(requireReview = true) {
    return mqttConfigurationError({ transport, transportNeedsReview: requireReview && transportNeedsReview,
      broker, caPath, certPath, keyPath, websocketPath });
  }
  const confirmTransport = () => {
    const error = configurationError(false);
    if (error) { toast.error(t(error)); return; }
    setTransportNeedsReview(false);
    if (reviewProfileId) useMqttStore.getState().updateProfile(reviewProfileId, {
      transport, transportNeedsReview: false, websocketPath,
    });
  };

  const connectionInputClass = "h-[34px] w-full min-w-0 rounded border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors shadow-sm disabled:opacity-60";

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

        {/* Endpoint labels remain aligned independently of transport notices. */}
        <div className="flex flex-col gap-3 p-4">
          <div className={`grid grid-cols-2 items-end gap-3 sm:grid-cols-[4rem_7rem_minmax(0,1fr)_6rem] ${useWebsockets ? "lg:grid-cols-[4rem_7rem_minmax(0,1fr)_6rem_minmax(12rem,0.65fr)]" : ""}`}>
            {/* 1. SELETOR DE PERFIL */}
            <div className="flex flex-col gap-1">
              <label htmlFor="mqtt-profile" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_profile')}</label>
              <div className="relative z-50">
                <button id="mqtt-profile" aria-label={t('mqtt_profile')} aria-expanded={showProfiles} onClick={() => setShowProfiles(!showProfiles)} disabled={isConnected || isConnecting} className={`h-[34px] w-full flex items-center justify-center rounded border transition-colors ${activeProfileName ? "border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/10" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"}`}><BookMarked size={18} /></button>
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
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="mqtt-transport" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_transport_caption')}</label>
              <div className="relative">
                <Globe size={14} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <select id="mqtt-transport" aria-label={t('mqtt_transport_label')} value={transport} disabled={isConnected || isConnecting}
                  onChange={e => handleInputChange(setTransport, e.target.value as MqttTransport)}
                  className={`${connectionInputClass} pl-8 pr-2`}>
                  {mqttTransports.map(mode => <option key={mode} value={mode} className="bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200">{mode.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
              <label htmlFor="mqtt-broker" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_broker_label')}</label>
              <input id="mqtt-broker" value={broker} title={broker}
                onChange={e => handleInputChange(setBroker, e.target.value)} disabled={isConnected || isConnecting}
                className={`${connectionInputClass} font-mono`} placeholder="broker.hivemq.com" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="mqtt-port" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_port_label')}</label>
              <input id="mqtt-port" aria-label={t('mqtt_port_label')} type="number" value={port}
                onChange={e => handleInputChange(setPort, Number(e.target.value))} disabled={isConnected || isConnecting}
                className={`${connectionInputClass} font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} />
            </div>
            {useWebsockets && <div className="flex min-w-0 flex-col gap-1 sm:col-span-4 lg:col-span-1">
              <label htmlFor="mqtt-ws-path" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_transport_path_label')}</label>
              <input id="mqtt-ws-path" aria-label={t('mqtt_transport_path_label')} value={websocketPath}
                onChange={e => handleInputChange(setWebsocketPath, e.target.value)} disabled={isConnected || isConnecting}
                className={`${connectionInputClass} font-mono`} placeholder="/mqtt" />
            </div>}
          </div>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(hasSecurityConfig ? 'mqtt_transport_secure' : 'mqtt_transport_plain')}</p>
          {transportNeedsReview && <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/10 dark:text-amber-300">
            <p>{t('mqtt_transport_review')}</p>
            <button type="button" onClick={confirmTransport} className="underline font-bold">{t('mqtt_transport_confirm')}</button>
          </div>}
          {/* Credentials and actions stay aligned across TCP, TLS, WS and WSS. */}
          <div className="grid grid-cols-1 items-end gap-3 border-t border-slate-200 pt-3 dark:border-slate-800 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="mqtt-client-id" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_client_id')}</label>
              <input id="mqtt-client-id" value={clientId} onChange={e => handleInputChange(setClientId, e.target.value)}
                disabled={isConnected || isConnecting} className={`${connectionInputClass} font-mono`} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="mqtt-username" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_user')}</label>
              <input id="mqtt-username" value={username} onChange={e => handleInputChange(setUsername, e.target.value)}
                disabled={isConnected || isConnecting} className={connectionInputClass} placeholder={t('mqtt_user_placeholder')} />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="mqtt-password" className="text-xs font-bold uppercase text-slate-400">{t('mqtt_pass')}</label>
              <div className="relative min-w-0">
                <input id="mqtt-password" type={showPassword ? "text" : "password"} value={password}
                  onChange={e => handleInputChange(setPassword, e.target.value)} disabled={isConnected || isConnecting}
                  className={`${connectionInputClass} pr-9 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`} placeholder={t('mqtt_pass_placeholder')} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} disabled={isConnected || isConnecting || !password}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-30" tabIndex={-1}>
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openSecurityModal} disabled={isConnected || isConnecting} className={`h-[34px] w-[34px] shrink-0 flex items-center justify-center rounded border transition-colors ${hasSecurityConfig ? "bg-amber-50 border-amber-300 text-amber-600 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"}`} title={hasSecurityConfig ? t('mqtt_tls_configured') : t('mqtt_tls_configure')}><Lock size={16} strokeWidth={hasSecurityConfig ? 2.5 : 2} /></button>
              {/* Botão Caveira (LWT) */}
              <button onClick={openLwtModal} disabled={isConnected || isConnecting} className={`h-[34px] w-[34px] shrink-0 flex items-center justify-center rounded border transition-colors ${hasLwtConfig ? "bg-purple-50 border-purple-300 text-purple-600 dark:bg-purple-900/20 dark:border-purple-700 dark:text-purple-400" : "border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"}`} title={hasLwtConfig ? `${t('mqtt_lwt_active')} ${lwtTopic}` : t('mqtt_lwt_configure')}><Skull size={16} strokeWidth={hasLwtConfig ? 2.5 : 2} /></button>
              <button onClick={handleConnectToggle} disabled={isConnecting} className={`justify-center flex-1 sm:flex-none px-6 py-1.5 h-[34px] rounded-lg font-bold text-sm flex items-center gap-2 whitespace-nowrap transition-all shadow-sm active:scale-95 ${isConnected ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50" : "bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-500/25"}`}>{isConnected ? <WifiOff size={16} /> : <Wifi size={16} />}{isConnected ? t('mqtt_disconnect') : (isConnecting ? t('mqtt_connecting') : t('mqtt_connect'))}</button>
            </div>
          </div>
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
                disabled={!isConnected || monitor.phase !== 'live' || isAlreadySubscribed}
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
              disabled={!isConnected || monitor.phase !== 'live'}
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
                  onClick={() => useMqttSessionStore.getState().clearMessages()}
                  className="p-1.5 hover:bg-red-100 text-slate-400 hover:text-red-500 rounded transition-colors"
                  title={t('mqtt_tooltip_clear_history')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" aria-label={t('mqtt_retention')}>
              <span>{t('mqtt_history')}: {historyCount}/{MQTT_LIMITS.historyMessages} | {historyBytes}/{MQTT_LIMITS.historyBytes} B</span>
              <span>{t('mqtt_latest')}: {latestCount}/{MQTT_LIMITS.latestTopics} | {latestBytes}/{MQTT_LIMITS.latestBytes} B</span>
              <span title={t('mqtt_discards_help')}>{t('mqtt_discards')}: {t('mqtt_history')} {discards.history} | {t('mqtt_latest')} {discards.topics} | {t('mqtt_payload_rejected')} {discards.payloads} | {t('mqtt_topic_rejected')} {discards.topicShape}</span>
              <button type="button" onClick={() => useMqttSessionStore.getState().clearLatest()} className="ml-auto underline hover:text-red-500">{t('mqtt_clear_latest')}</button>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400" aria-label={t('mqtt_sync_label')}>
              <span title={monitor.error ?? undefined}>{t('mqtt_sync_label')}: {t(`mqtt_sync_${monitor.phase}`)}</span>
              <span>{t('mqtt_sync_queue')}: {monitor.queuedMessages}/{MQTT_LIMITS.syncMessages} | {monitor.queuedBytes}/{MQTT_LIMITS.syncBytes} B</span>
              <details>
                <summary className="cursor-pointer">{t('mqtt_sync_drops')}: {Object.values(monitor.drops).reduce((sum, count) => Math.min(Number.MAX_SAFE_INTEGER, sum + count), 0)}</summary>
                <p>{t('mqtt_sync_capacity')} {monitor.drops.capacity} | {t('mqtt_payload_rejected')} {monitor.drops.oversize} | {t('mqtt_sync_obsolete')} {monitor.drops.obsolete} | {t('mqtt_sync_duplicate')} {monitor.drops.duplicate} | {t('mqtt_sync_invalid')} {monitor.drops.invalid} | {t('mqtt_sync_closed')} {monitor.drops.closed}</p>
              </details>
              {monitor.phase === 'failed' && <>
                <span role="alert" className="text-red-600 dark:text-red-400">{t('mqtt_sync_failed_help')}</span>
                <button type="button" onClick={() => useMqttSessionStore.getState().restartMonitor()} className="underline font-bold">{t('mqtt_sync_retry')}</button>
                {isConnecting && <button type="button" onClick={handleCancelConnection} className="underline">{t('mqtt_cancel_connection')}</button>}
              </>}
            </div>

            <div className="flex-1 p-2 overflow-hidden relative">
              {/* ÁRVORE DE TÓPICOS */}
              <TopicTree
                tree={tree}
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
                  data={charts.get(topic)?.samples ?? []}
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
      {isConnecting && monitor.phase !== 'failed' && (
        <div className="absolute inset-0 z-50 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300 cursor-wait">
          
          {/* Card Central do Loading */}
          <div className="flex flex-col items-center gap-4 p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 transform scale-110">
            
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 rounded-full animate-pulse"></div>
              <Loader2 size={48} className="text-blue-600 dark:text-blue-400 animate-spin relative z-10" />
            </div>
            
            <div className="flex flex-col items-center gap-1">
              <span className="font-bold text-lg text-slate-700 dark:text-slate-200 animate-pulse">
                {t(mqttSnapshot.status === 'stopping' ? 'mqtt_stopping_connection' : reserving && mqttSnapshot.status !== 'connecting' ? 'mqtt_reserving_connection' : 'mqtt_msg_connecting')}...
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded">
                {broker}:{port}
              </span>
            </div>

            {/* Botão de Emergência (Opcional, caso trave muito tempo) */}
            <button 
              onClick={handleCancelConnection}
              disabled={mqttSnapshot.status === 'stopping'}
              className="mt-2 text-[10px] text-red-400 hover:text-red-500 uppercase font-bold tracking-widest hover:underline"
            >
              {t('mqtt_cancel_connection')}
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
                    toast.success(t('mqtt_sec_clean_toast'));
                  }}
                  className="text-xs text-red-500 hover:text-red-700 underline font-bold"
                >
                  {t('mqtt_sec_clean')}
                </button>
              )}
            </div>
            
            <p className="text-xs text-slate-500 mb-4 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-100 dark:border-slate-800">
                {t('mqtt_transport_trust')}
            </p>

            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800/50 mb-4">
              <p className="text-xs text-amber-800 dark:text-amber-200 font-medium flex items-start gap-2">
                <Activity size={14} className="mt-0.5 shrink-0"/>
                {t('mqtt_transport_client_optional')}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <SecurityInput 
                label={t('mqtt_sec_lbl_ca')} // "CA Certificate (.crt)"
                value={caPath} isValid={caValid} placeholder="C:\certs\ca.crt" 
                onChange={(e: any) => setCaPath(e.target.value)}
                onBrowse={() => handleFileSelect(setCaPath, 'CA Cert', ['crt', 'pem', 'ca'])}
              />
                
                <div className="p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/20 flex flex-col gap-3">
                  <SecurityInput 
                    label={t('mqtt_sec_lbl_cert')} // "Client Certificate (.crt)"
                    value={certPath} isValid={certValid} placeholder="C:\certs\client.crt"
                    onChange={(e: any) => setCertPath(e.target.value)}
                    onBrowse={() => handleFileSelect(setCertPath, 'Client Cert', ['crt', 'pem'])}
                  />
                  <SecurityInput 
                    label={t('mqtt_sec_lbl_key')} // "Client Private Key (.key)"
                    value={keyPath} isValid={keyValid} placeholder="C:\certs\client.key"
                    onChange={(e: any) => setKeyPath(e.target.value)}
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
                  onChange={e => setLwtTopic(e.target.value)} 
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none focus:border-purple-500" 
                  placeholder={t('mqtt_ph_lwt_topic')} 
                />
              </div>
              
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase text-slate-500">{t('mqtt_lwt_payload')}</label>
                <input 
                  value={lwtPayload} 
                  onChange={e => setLwtPayload(e.target.value)} 
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono outline-none focus:border-purple-500" 
                  placeholder={t('mqtt_ph_lwt_payload')} 
                />
              </div>

              <div className="flex gap-4 mt-1">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-xs font-bold uppercase text-slate-500">{t('mqtt_qos_label')}</label>
                  <select value={lwtQos} onChange={e => setLwtQos(Number(e.target.value))} className="w-full px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm outline-none">
                    <option value={0}>0 - At Most Once</option>
                    <option value={1}>1 - At Least Once</option>
                    <option value={2}>2 - Exactly Once</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 justify-end pb-2">
                  <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLwtRetain(!lwtRetain)}>
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
