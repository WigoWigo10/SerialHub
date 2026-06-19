use tauri::{AppHandle, Emitter, State};
use rumqttc::{MqttOptions, AsyncClient, QoS, Event, Packet, Transport, TlsConfiguration, LastWill}; 
use std::time::Duration;
use tokio::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::fs; 
use std::net::ToSocketAddrs;

#[derive(Clone, serde::Serialize)]
pub struct MqttMessage {
    pub topic: String,
    pub payload: String,
    pub qos: u8,
}

pub struct MqttConnection {
    pub client: Option<AsyncClient>,
    pub intentional_disconnect: Arc<AtomicBool>, 
}

pub struct MqttState {
    pub connection: Arc<Mutex<MqttConnection>>,
}

impl Default for MqttState {
    fn default() -> Self {
        Self {
            connection: Arc::new(Mutex::new(MqttConnection { 
                client: None,
                intentional_disconnect: Arc::new(AtomicBool::new(false)) 
            })),
        }
    }
}

// IMPORTANTE: Adicione esta função para a validação de arquivos no Frontend funcionar
#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    if path.is_empty() {
        return true; 
    }
    let p = std::path::Path::new(&path);
    p.exists() && p.is_file() 
}

// Função para forçar a resolução de DNS para IPv4
fn resolve_dns_to_ipv4(host: &str) -> String {
    // Adiciona uma porta fictícia só para o parser de endereços funcionar
    let host_port = format!("{}:1883", host);
    
    // Tenta resolver o DNS
    if let Ok(addrs) = host_port.to_socket_addrs() {
        for addr in addrs {
            // Se encontrar um endereço IPv4, retorna apenas o IP
            if addr.is_ipv4() {
                println!("[DNS] Host '{}' resolvido para IPv4: {}", host, addr.ip());
                return addr.ip().to_string();
            }
        }
    }
    
    // Se falhar ou só tiver IPv6, retorna o host original e deixa o SO decidir
    println!("[DNS] Não foi possível forçar IPv4 para '{}'. Usando original.", host);
    host.to_string()
}

#[tauri::command]
pub async fn connect_mqtt(
    app: AppHandle,
    state: State<'_, MqttState>,
    broker: String,
    port: u16,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    // TLS
    ca_path: Option<String>,
    cert_path: Option<String>,
    key_path: Option<String>,
    // LWT
    lwt_topic: Option<String>,
    lwt_payload: Option<String>,
    lwt_qos: Option<u8>,
    lwt_retain: Option<bool>,
    use_websockets: bool,
) -> Result<String, String> {

    let final_broker_host = resolve_dns_to_ipv4(&broker);

    println!("[MQTT] Iniciando conexão v3.1.1: {}:{}", final_broker_host, port);

    println!("\n==================================================");
    println!("[MQTT-DEBUG] Solicitação de Conexão Recebida");
    println!("[MQTT-DEBUG] Broker: '{}' | Porta: {}", final_broker_host, port);
    println!("[MQTT-DEBUG] Use WebSockets: {}", use_websockets);
    println!("[MQTT-DEBUG] Client ID: '{}'", client_id);
    println!("==================================================\n");

    let intentional_disconnect = Arc::new(AtomicBool::new(false));
    
    // Configuração básica
    let mut mqttoptions = MqttOptions::new(client_id.clone(), final_broker_host, port);
    mqttoptions.set_keep_alive(Duration::from_secs(5));
    // Aumentar tamanho do pacote para debug se necessário
    mqttoptions.set_max_packet_size(1024 * 1024, 1024 * 1024); 

    // --- CONFIGURAÇÃO LWT ---
    if let (Some(topic), Some(payload), Some(qos_val)) = (&lwt_topic, &lwt_payload, lwt_qos) {
        if !topic.is_empty() {
            println!("[MQTT-DEBUG] Configurando LWT no tópico: {}", topic);
            let qos = match qos_val {
                1 => QoS::AtLeastOnce,
                2 => QoS::ExactlyOnce,
                _ => QoS::AtMostOnce,
            };
            let retain = lwt_retain.unwrap_or(false);
            
            let will = LastWill::new(
                topic.clone(),
                payload.clone().into_bytes(),
                qos, 
                retain
            );
            mqttoptions.set_last_will(will);
        }
    }

    // --- LÓGICA DE TRANSPORTE E TLS ---
    
    // 1. Tentar carregar arquivos TLS se fornecidos
    let tls_config = if let (Some(ca), Some(cert), Some(key)) = (&ca_path, &cert_path, &key_path) {
        if !ca.is_empty() && !cert.is_empty() && !key.is_empty() {
            println!("[MQTT-DEBUG] Caminhos TLS detectados. Tentando ler arquivos...");
            
            let ca_bytes = match fs::read(ca) {
                Ok(b) => b,
                Err(e) => {
                    let err = format!("ERRO FATAL TLS: Não foi possível ler CA em '{}': {}", ca, e);
                    println!("[MQTT-DEBUG] {}", err);
                    return Err(err);
                }
            };
            
            let cert_bytes = match fs::read(cert) {
                Ok(b) => b,
                Err(e) => {
                    let err = format!("ERRO FATAL TLS: Não foi possível ler CERT em '{}': {}", cert, e);
                    println!("[MQTT-DEBUG] {}", err);
                    return Err(err);
                }
            };

            let key_bytes = match fs::read(key) {
                Ok(b) => b,
                Err(e) => {
                    let err = format!("ERRO FATAL TLS: Não foi possível ler KEY em '{}': {}", key, e);
                    println!("[MQTT-DEBUG] {}", err);
                    return Err(err);
                }
            };
            
            println!("[MQTT-DEBUG] Arquivos TLS lidos com sucesso. Criando config TlsConfiguration::Simple.");
            Some(TlsConfiguration::Simple {
                ca: ca_bytes,
                alpn: None,
                client_auth: Some((cert_bytes, key_bytes)), 
            })
        } else {
            println!("[MQTT-DEBUG] Campos TLS presentes mas strings vazias. Ignorando TLS.");
            None 
        }
    } else { 
        println!("[MQTT-DEBUG] Nenhum caminho TLS fornecido.");
        None 
    };

    // 2. Aplicar o Transporte
    if use_websockets {
        // --- MODO WEBSOCKETS ---
        if let Some(tls) = tls_config {
            println!("[MQTT-DEBUG] ATIVANDO MODO: WSS (Secure WebSocket)");
            mqttoptions.set_transport(Transport::Wss(tls));
        } else {
            println!("[MQTT-DEBUG] ATIVANDO MODO: WS (Plain WebSocket)");
            mqttoptions.set_transport(Transport::Ws);
        }
    } else {
        // --- MODO TCP/TLS Padrão ---
        if let Some(tls) = tls_config {
            println!("[MQTT-DEBUG] ATIVANDO MODO: MQTTS (Secure TCP)");
            mqttoptions.set_transport(Transport::Tls(tls));
        } else if port == 8883 {
            println!("[MQTT-DEBUG] Porta 8883 detectada sem certificados. Tentando TLS implícito (Inseguro/Simple)...");
            // Fallback para 8883 (Geralmente requer TLS)
            mqttoptions.set_transport(Transport::Tls(TlsConfiguration::Simple {
                ca: vec![], alpn: None, client_auth: None,
            }));
        } else {
            println!("[MQTT-DEBUG] ATIVANDO MODO: MQTT TCP (Plain Text)");
            // O padrão do MqttOptions já é TCP puro.
            mqttoptions.set_transport(Transport::Tcp); 
        }
    }

    if let (Some(u), Some(p)) = (username, password) {
        println!("[MQTT-DEBUG] Usando Credenciais: User='{}', Pass='***'", u);
        mqttoptions.set_credentials(u, p);
    } else {
        println!("[MQTT-DEBUG] Conexão Anônima (Sem usuário/senha).");
    }

    println!("[MQTT-DEBUG] Criando AsyncClient e EventLoop...");
    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 100);

    {
        let mut conn = state.connection.lock().await;
        conn.client = Some(client);
        conn.intentional_disconnect = intentional_disconnect.clone();
    }

    let intended_disconnect_checker = intentional_disconnect.clone();

    tauri::async_runtime::spawn(async move {
        println!("[MQTT-DEBUG] Thread do EventLoop iniciada. Aguardando pacotes...");
        loop {
            if intended_disconnect_checker.load(Ordering::Relaxed) {
                println!("[MQTT-DEBUG] Desconexão intencional solicitada. Saindo do loop.");
                let _ = app.emit("mqtt-status", "disconnected");
                break;
            }

            match eventloop.poll().await {
                Ok(notification) => {
                    match notification {
                        Event::Incoming(Packet::Publish(p)) => {
                            println!("[MQTT-DEBUG] MSG Recebida: {:?}", p.topic);
                            let payload_str = String::from_utf8_lossy(&p.payload).to_string();
                            let msg = MqttMessage {
                                topic: p.topic,
                                payload: payload_str,
                                qos: p.qos as u8
                            };
                            let _ = app.emit("mqtt-message", msg);
                        }
                        Event::Incoming(Packet::ConnAck(_)) => {
                            println!("[MQTT-DEBUG] CONEXÃO ESTABELECIDA COM SUCESSO (ConnAck)!");
                            let _ = app.emit("mqtt-status", "connected");
                        }
                        Event::Outgoing(p) => {
                            println!("[MQTT-DEBUG] Enviando pacote: {:?}", p);
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    if intended_disconnect_checker.load(Ordering::Relaxed) {
                        let _ = app.emit("mqtt-status", "disconnected");
                        break;
                    }
                    eprintln!("\n[MQTT-DEBUG] ERRO CRÍTICO NO EVENTLOOP: {:?}", e);
                    eprintln!("[MQTT-DEBUG] Detalhes do erro: {}\n", e);
                    let _ = app.emit("mqtt-error", e.to_string());
                    let _ = app.emit("mqtt-status", "disconnected");
                    break;
                }
            }
        }
        println!("[MQTT-DEBUG] Loop encerrado.");
    });

    Ok(format!("Iniciando conexão..."))
}

#[tauri::command]
pub async fn disconnect_mqtt(state: State<'_, MqttState>) -> Result<(), String> {
    let mut conn = state.connection.lock().await;
    conn.intentional_disconnect.store(true, Ordering::Relaxed);
    if let Some(client) = &conn.client { let _ = client.disconnect().await; }
    conn.client = None;
    Ok(())
}

#[tauri::command]
pub async fn publish_mqtt(
    state: State<'_, MqttState>,
    topic: String,
    payload: String,
    qos: u8,
    retain: bool
) -> Result<(), String> {
    let conn = state.connection.lock().await;
    if let Some(client) = &conn.client {
        let qos_enum = match qos {
            1 => QoS::AtLeastOnce,
            2 => QoS::ExactlyOnce,
            _ => QoS::AtMostOnce,
        };
        client.publish(topic, qos_enum, retain, payload.as_bytes()).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("MQTT não conectado".to_string())
    }
}

#[tauri::command]
pub async fn subscribe_mqtt(state: State<'_, MqttState>, topic: String) -> Result<(), String> {
    let conn = state.connection.lock().await;
    if let Some(client) = &conn.client {
        client.subscribe(topic, QoS::AtMostOnce).await.map_err(|e| e.to_string())?;
        Ok(())
    } else { Err("MQTT não conectado".to_string()) }
}

#[tauri::command]
pub async fn unsubscribe_mqtt(state: State<'_, MqttState>, topic: String) -> Result<(), String> {
    let conn = state.connection.lock().await;
    if let Some(client) = &conn.client {
        client.unsubscribe(topic).await.map_err(|e| e.to_string())?;
        Ok(())
    } else { Err("MQTT não conectado".to_string()) }
}