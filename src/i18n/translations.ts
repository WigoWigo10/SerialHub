export const translations = {
  'pt-BR': {
    // --- SIDEBAR ---
    serial: 'SERIAL',
    refresh_list: 'Atualizar Lista',
    hide_advanced: 'Ocultar Avançado',
    show_advanced: 'Mostrar Configurações Avançadas',
    baud_rate: 'BAUD RATE',
    bits_per_sec: 'bits/s',
    visualization: 'VISUALIZAÇÃO',
    show_time: 'MOSTRAR TEMPO',
    time_on: 'TEMPO LIGADO',
    record_log: 'GRAVAR LOG (REC)',
    recording: 'GRAVANDO...',
    data_bits: 'DATA BITS',
    stop_bits: 'STOP BITS',
    parity: 'PARIDADE',
    flow: 'FLUXO',
    devices: 'DISPOSITIVOS',
    no_ports: 'Nenhuma porta encontrada.',
    disconnect: 'Desconectar',
    product: 'Produto',
    manufacturer: 'Fabricante',
    serial_device: 'Dispositivo Serial',
    serial_native: 'Porta Serial Nativa/Virtual',

    // --- TERMINAL AREA (Corrigido) ---
    terminal_header: 'TERMINAL',
    copied: 'COPIADO',
    disconnected: 'Desconectado',
    receiving: 'Recebendo Dados...',
    connected_status: 'CONECTADO', // Usado na Sidebar e no Terminal
    clean_terminal: 'Terminal Limpo',

    // --- COMMAND BAR (Corrigido) ---
    clean_tooltip: 'Limpar Terminal',
    echo_tooltip_on: 'Eco Local: LIGADO (Você vê o que digita)',
    echo_tooltip_off: 'Eco Local: DESLIGADO',
    input_placeholder_ascii: 'Enviar comando...',
    input_placeholder_hex: 'HEX ex: 0A FF',
    send_tooltip: 'Enviar Comando (Enter)',
    line_ending_tooltip: 'Caractere de Fim de Linha (End of Line)',

    // --- SETTINGS PAGE ---
    settings_title: 'Configurações',
    settings_subtitle: 'Personalize a interface e o comportamento do sistema.',
    appearance: 'Tema e Aparência',
    dark_mode: 'Modo Escuro',
    light_mode: 'Modo Claro',
    region_language: 'Região e Idioma',
    about: 'Sobre',
    about_subtitle: 'Ferramenta profissional para engenharia de sistemas embarcados.',
    about_description: 'Nascido da experiência com ferramentas funcionais, porém antigas e travadas. Desenvolvido por iniciativa própria como uma alternativa Open Source fluida, moderna e interessante para desenvolvedores.',
    visit_repo: 'Repositório Oficial',

    // --- ACTIVITY BAR ---
    activity_monitor: 'Monitor Serial',
    activity_bluetooth: 'Bluetooth LE',
    activity_spy: 'Spy / Bridge',
    activity_dashboard: 'Dashboard',
    activity_settings: 'Configurações',

    // --- STATUS BAR ---
    status_ready: 'Pronto',
    status_error: 'Erro',
    status_connecting: 'Conectando...',
    status_connected: 'Conectado a',

    // --- WORKSPACES & LOCK SCREENS ---
    ws_bluetooth_title: 'Workspace Bluetooth',
    ws_spy_title: 'Spy Bridge',
    ws_dashboard_title: 'Dashboard',
    ws_construction_desc: 'Esta funcionalidade estará disponível em breve.',
    
    // Textos específicos das Sidebars Bloqueadas
    ble_manager: 'Gerenciador de Conexões BLE.',
    spy_desc_short: 'Interceptação Serial Bidirecional.',
    port_master: 'Porta A (Master)',
    port_slave: 'Porta B (Slave)',
    feature_locked: 'Recurso Bloqueado',
    feature_locked_desc_ble: 'O módulo Bluetooth LE estará disponível na versão Beta v1.2',
    feature_locked_desc_spy: 'O modo Spy / Bridge estará disponível na versão Beta v1.2',

    // ALERTAS & OPÇÕES
    alert_pin_error: 'Falha ao definir pino (Porta fechada?)',
    alert_error_prefix: 'Erro: ',
    
    // Opções de Select (Rótulos)
    opt_none: 'Nenhum',
    opt_even: 'Par (Even)',
    opt_odd: 'Ímpar (Odd)',
    opt_hardware: 'Hardware (RTS/CTS)',

    // --- DASHBOARD ---
    dash_system: 'Sistema Host',
    dash_cpu: 'Uso de CPU',
    dash_memory: 'Memória RAM',
    dash_connection: 'Sessão Serial',
    dash_port: 'Porta Ativa',
    dash_baud: 'Velocidade',
    dash_duration: 'Tempo de Conexão',
    dash_status_ok: 'Operacional',
    dash_status_warn: 'Alta Carga',
    dash_no_connection: 'Sem conexão ativa',
    dash_connect_hint: 'Conecte-se a uma porta para ver a telemetria.',

    // --- DASHBOARD HARDWARE ---
    dash_cpu_info: 'Central Processing Unit',
    dash_hardware_specs: 'Especificações de Hardware',
    dash_cores_phys: 'Cores Físicos',
    dash_threads: 'Threads (Lógicos)',
    dash_realtime_load: 'Carga em Tempo Real',
    dash_graphics_ai: 'Graphics & AI',
    dash_gpu: 'GPU (Gráficos)',
    dash_npu: 'NPU (Processador Neural)',
    dash_npu_not_found: 'Não detectado / Sem Driver',
    dash_ram_title: 'Memória RAM',
    dash_ram_used: 'Usado',
    dash_ram_total: 'Total',
    dash_ram_in_use: 'Em Uso',
    
    // --- DASHBOARD POWER & NET ---
    dash_power_title: 'Energia & Conectividade',
    dash_battery: 'Bateria',
    dash_ac_power: 'Alimentação AC',
    dash_charging: 'Carregando',
    dash_discharging: 'Descarregando',
    dash_desktop_ac: 'Desktop / AC',
    dash_network: 'Rede',
    dash_bluetooth: 'Bluetooth',
    dash_detected: 'Detectado',
    dash_not_detected: 'Não Detectado',

    // --- DASHBOARD SERIAL ---
    dash_serial_telemetry: 'Telemetria da Porta Serial',
    dash_online: 'Online',
    dash_session_duration: 'Duração da Sessão',
    dash_tx_data: 'Dados Enviados (TX)',
    dash_rx_data: 'Dados Recebidos (RX)',
    dash_subtitle: 'Telemetria avançada de sistema e conexão.',
  },

  'en-US': {
    // --- SIDEBAR ---
    serial: 'SERIAL',
    refresh_list: 'Refresh List',
    hide_advanced: 'Hide Advanced',
    show_advanced: 'Show Advanced Settings',
    baud_rate: 'BAUD RATE',
    bits_per_sec: 'bits/s',
    visualization: 'VIEW MODE',
    show_time: 'SHOW TIME',
    time_on: 'TIME ON',
    record_log: 'RECORD LOG (REC)',
    recording: 'RECORDING...',
    data_bits: 'DATA BITS',
    stop_bits: 'STOP BITS',
    parity: 'PARITY',
    flow: 'FLOW CTRL',
    devices: 'DEVICES',
    no_ports: 'No ports found.',
    disconnect: 'Disconnect',
    product: 'Product',
    manufacturer: 'Manufacturer',
    serial_device: 'Serial Device',
    serial_native: 'Native/Virtual Serial Port',

    // --- TERMINAL AREA ---
    terminal_header: 'TERMINAL',
    copied: 'COPIED',
    disconnected: 'Disconnected',
    receiving: 'Receiving Data...',
    connected_status: 'CONNECTED',
    clean_terminal: 'Terminal Cleared',

    // --- COMMAND BAR ---
    clean_tooltip: 'Clear Terminal',
    echo_tooltip_on: 'Local Echo: ON (You see what you type)',
    echo_tooltip_off: 'Local Echo: OFF',
    input_placeholder_ascii: 'Send command...',
    input_placeholder_hex: 'HEX ex: 0A FF',
    send_tooltip: 'Send Command (Enter)',
    line_ending_tooltip: 'End of Line Character',

    // --- SETTINGS PAGE ---
    settings_title: 'Settings',
    settings_subtitle: 'Customize the interface and system behavior.',
    appearance: 'Theme & Appearance',
    dark_mode: 'Dark Mode',
    light_mode: 'Light Mode',
    region_language: 'Region & Language',
    about: 'About',
    about_subtitle: 'Professional tool for embedded systems engineering.',
    about_description: 'Born from experience with functional but old and laggy tools. Developed on personal initiative as a smooth, modern, Open Source alternative for developers.',
    visit_repo: 'Official Repository',

    // --- ACTIVITY BAR ---
    activity_monitor: 'Serial Monitor',
    activity_bluetooth: 'Bluetooth LE',
    activity_spy: 'Spy / Bridge',
    activity_dashboard: 'Dashboard',
    activity_settings: 'Settings',

    // --- STATUS BAR ---
    status_ready: 'Ready',
    status_error: 'Error',
    status_connecting: 'Connecting...',
    status_connected: 'Connected to',

    // --- WORKSPACES & LOCK SCREENS ---
    ws_bluetooth_title: 'Bluetooth Workspace',
    ws_spy_title: 'Spy Bridge',
    ws_dashboard_title: 'Dashboard',
    ws_construction_desc: 'This feature will be available soon.',

    // Locked Sidebars
    ble_manager: 'BLE Connection Manager.',
    spy_desc_short: 'Bidirectional Serial Interception.',
    port_master: 'Port A (Master)',
    port_slave: 'Port B (Slave)',
    feature_locked: 'Feature Locked',
    feature_locked_desc_ble: 'Bluetooth LE module will be available in Beta v1.2',
    feature_locked_desc_spy: 'Spy / Bridge mode will be available in Beta v1.2',

    // ALERTS & OPTIONS
    alert_pin_error: 'Failed to set pin (Port closed?)',
    alert_error_prefix: 'Error: ',
    
    // Select Options
    opt_none: 'None',
    opt_even: 'Even',
    opt_odd: 'Odd',
    opt_hardware: 'Hardware (RTS/CTS)',

    // --- DASHBOARD ---
    dash_system: 'Host System',
    dash_cpu: 'CPU Usage',
    dash_memory: 'RAM Memory',
    dash_connection: 'Serial Session',
    dash_port: 'Active Port',
    dash_baud: 'Baud Rate',
    dash_duration: 'Connection Time',
    dash_status_ok: 'Operational',
    dash_status_warn: 'High Load',
    dash_no_connection: 'No active connection',
    dash_connect_hint: 'Connect to a port to view telemetry.',

    // --- DASHBOARD HARDWARE ---
    dash_cpu_info: 'Central Processing Unit',
    dash_hardware_specs: 'Hardware Specifications',
    dash_cores_phys: 'Physical Cores',
    dash_threads: 'Threads (Logical)',
    dash_realtime_load: 'Real-time Load',
    dash_graphics_ai: 'Graphics & AI',
    dash_gpu: 'GPU (Graphics)',
    dash_npu: 'NPU (Neural Processor)',
    dash_npu_not_found: 'Not detected / No Driver',
    dash_ram_title: 'RAM Memory',
    dash_ram_used: 'Used',
    dash_ram_total: 'Total',
    dash_ram_in_use: 'In Use',

    // --- DASHBOARD POWER & NET ---
    dash_power_title: 'Power & Connectivity',
    dash_battery: 'Battery',
    dash_ac_power: 'AC Power',
    dash_charging: 'Charging',
    dash_discharging: 'Discharging',
    dash_desktop_ac: 'Desktop / AC',
    dash_network: 'Network',
    dash_bluetooth: 'Bluetooth',
    dash_detected: 'Detected',
    dash_not_detected: 'Not Detected',

    // --- DASHBOARD SERIAL ---
    dash_serial_telemetry: 'Serial Port Telemetry',
    dash_online: 'Online',
    dash_session_duration: 'Session Duration',
    dash_tx_data: 'Sent Data (TX)',
    dash_rx_data: 'Received Data (RX)',
    dash_subtitle: 'Advanced system and connection telemetry.',
  },

  'es': {
    // --- SIDEBAR ---
    serial: 'SERIE',
    refresh_list: 'Actualizar Lista',
    hide_advanced: 'Ocultar Avanzado',
    show_advanced: 'Mostrar Configuración Avanzada',
    baud_rate: 'VELOCIDAD',
    bits_per_sec: 'bits/s',
    visualization: 'VISUALIZACIÓN',
    show_time: 'MOSTRAR HORA',
    time_on: 'HORA ACTIVA',
    record_log: 'GRABAR LOG (REC)',
    recording: 'GRABANDO...',
    data_bits: 'BITS DE DATOS',
    stop_bits: 'BITS DE PARADA',
    parity: 'PARIDAD',
    flow: 'FLUJO',
    devices: 'DISPOSITIVOS',
    no_ports: 'No se encontraron puertos.',
    disconnect: 'Desconectar',
    product: 'Producto',
    manufacturer: 'Fabricante',
    serial_device: 'Dispositivo Serie',
    serial_native: 'Puerto Serie Nativo/Virtual',

    // --- TERMINAL AREA ---
    terminal_header: 'TERMINAL',
    copied: 'COPIADO',
    disconnected: 'Desconectado',
    receiving: 'Recibiendo Datos...',
    connected_status: 'CONECTADO',
    clean_terminal: 'Terminal Limpio',

    // --- COMMAND BAR ---
    clean_tooltip: 'Limpiar Terminal',
    echo_tooltip_on: 'Eco Local: ENCENDIDO',
    echo_tooltip_off: 'Eco Local: APAGADO',
    input_placeholder_ascii: 'Enviar comando...',
    input_placeholder_hex: 'HEX ej: 0A FF',
    send_tooltip: 'Enviar Comando (Enter)',
    line_ending_tooltip: 'Carácter de Fin de Línea',

    // --- SETTINGS PAGE ---
    settings_title: 'Configuración',
    settings_subtitle: 'Personaliza la interfaz y el comportamiento del sistema.',
    appearance: 'Tema y Apariencia',
    dark_mode: 'Modo Oscuro',
    light_mode: 'Modo Claro',
    region_language: 'Región e Idioma',
    about: 'Acerca de',
    about_subtitle: 'Herramienta profesional para ingeniería de sistemas embebidos.',
    about_description: 'Nacido de la experiencia con herramientas funcionales pero antiguas y lentas. Desarrollado por iniciativa propia como una alternativa Open Source fluida y moderna para desarrolladores.',
    visit_repo: 'Repositorio Oficial',

    // --- ACTIVITY BAR ---
    activity_monitor: 'Monitor Serie',
    activity_bluetooth: 'Bluetooth LE',
    activity_spy: 'Spy / Bridge',
    activity_dashboard: 'Panel de Control',
    activity_settings: 'Configuración',

    // --- STATUS BAR ---
    status_ready: 'Listo',
    status_error: 'Error',
    status_connecting: 'Conectando...',
    status_connected: 'Conectado a',

    // --- WORKSPACES & LOCK SCREENS ---
    ws_bluetooth_title: 'Espacio Bluetooth',
    ws_spy_title: 'Spy Bridge',
    ws_dashboard_title: 'Panel de Control',
    ws_construction_desc: 'Esta función estará disponible pronto.',

    // Locked Sidebars
    ble_manager: 'Gestor de Conexiones BLE.',
    spy_desc_short: 'Interceptación Serie Bidireccional.',
    port_master: 'Puerto A (Maestro)',
    port_slave: 'Puerto B (Esclavo)',
    feature_locked: 'Función Bloqueada',
    feature_locked_desc_ble: 'El módulo Bluetooth LE estará disponible en Beta v1.2',
    feature_locked_desc_spy: 'El modo Spy / Bridge estará disponible en Beta v1.2',

    // ALERTS & OPTIONS
    alert_pin_error: 'Fallo al definir pin (¿Puerto cerrado?)',
    alert_error_prefix: 'Error: ',

    // Select Options
    opt_none: 'Ninguno',
    opt_even: 'Par (Even)',
    opt_odd: 'Impar (Odd)',
    opt_hardware: 'Hardware (RTS/CTS)',

    // --- DASHBOARD ---
    dash_system: 'Sistema Host',
    dash_cpu: 'Uso de CPU',
    dash_memory: 'Memoria RAM',
    dash_connection: 'Sesión Serie',
    dash_port: 'Puerto Activo',
    dash_baud: 'Velocidad',
    dash_duration: 'Tiempo de Conexión',
    dash_status_ok: 'Operacional',
    dash_status_warn: 'Carga Alta',
    dash_no_connection: 'Sin conexión activa',
    dash_connect_hint: 'Conéctese a un puerto para ver la telemetría.',
    dash_cpu_info: 'Unidad Central de Procesamiento',
    dash_hardware_specs: 'Especificaciones de Hardware',
    dash_cores_phys: 'Núcleos Físicos',
    dash_threads: 'Hilos (Lógicos)',
    dash_realtime_load: 'Carga en Tiempo Real',
    dash_graphics_ai: 'Gráficos e IA',
    dash_gpu: 'GPU (Gráficos)',
    dash_npu: 'NPU (Procesador Neuronal)',
    dash_npu_not_found: 'No detectado / Sin Driver',
    dash_ram_title: 'Memoria RAM',
    dash_ram_used: 'Usado',
    dash_ram_total: 'Total',
    dash_ram_in_use: 'En Uso',
    dash_power_title: 'Energía y Conectividad',
    dash_battery: 'Batería',
    dash_ac_power: 'Alimentación CA',
    dash_charging: 'Cargando',
    dash_discharging: 'Descargando',
    dash_desktop_ac: 'Sobremesa / CA',
    dash_network: 'Red',
    dash_bluetooth: 'Bluetooth',
    dash_detected: 'Detectado',
    dash_not_detected: 'No Detectado',
    dash_serial_telemetry: 'Telemetría del Puerto Serie',
    dash_online: 'En línea',
    dash_session_duration: 'Duración de la Sesión',
    dash_tx_data: 'Datos Enviados (TX)',
    dash_rx_data: 'Datos Recibidos (RX)',
    dash_subtitle: 'Telemetría avanzada de sistema y conexión.',
  }
};


export type LanguageKey = keyof typeof translations['en-US'];