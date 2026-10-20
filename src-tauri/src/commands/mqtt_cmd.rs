use super::mqtt_transport::{self, MqttTransport};
use crate::mqtt_session::{self, MqttService, SessionIo, Snapshot};
use rumqttc::{AsyncClient, LastWill};
use std::time::Duration;
use tauri::State;

#[derive(Default)]
pub struct MqttState {
    pub service: MqttService,
}

#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    if path.is_empty() {
        return true;
    }
    std::path::Path::new(&path).is_file()
}

#[tauri::command]
pub async fn mqtt_begin_attempt(state: State<'_, MqttState>) -> Result<Snapshot, String> {
    state.service.begin().await
}

#[tauri::command]
pub fn mqtt_connection_state(state: State<'_, MqttState>) -> Snapshot {
    state.service.snapshot()
}

#[tauri::command]
pub fn connect_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
    broker: String,
    port: u16,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    ca_path: Option<String>,
    cert_path: Option<String>,
    key_path: Option<String>,
    lwt_topic: Option<String>,
    lwt_payload: Option<String>,
    lwt_qos: Option<u8>,
    lwt_retain: Option<bool>,
    transport: MqttTransport,
    websocket_path: Option<String>,
) -> Result<(), String> {
    // Validation is a tracked blocking job within the reserved attempt's deadline.
    state.service.configure(
        expected_session_id,
        Box::new(move || {
            let mut mqttoptions = mqtt_transport::options(
                &client_id,
                &broker,
                port,
                transport,
                ca_path.as_deref(),
                cert_path.as_deref(),
                key_path.as_deref(),
                websocket_path.as_deref(),
            )?;
            mqttoptions.set_keep_alive(Duration::from_secs(5));
            mqttoptions.set_max_packet_size(1024 * 1024, 1024 * 1024);
            if let (Some(topic), Some(payload), Some(qos)) = (lwt_topic, lwt_payload, lwt_qos) {
                if !topic.is_empty() {
                    mqttoptions.set_last_will(LastWill::new(
                        topic,
                        payload.into_bytes(),
                        mqtt_session::qos(qos),
                        lwt_retain.unwrap_or(false),
                    ));
                }
            }
            if let (Some(username), Some(password)) = (username, password) {
                mqttoptions.set_credentials(username, password);
            }
            let (client, events) = AsyncClient::new(mqttoptions, 100);
            Ok(SessionIo {
                client,
                events: Box::new(events),
            })
        }),
    )
}

#[tauri::command]
pub async fn cancel_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
) -> Result<Snapshot, String> {
    state.service.cancel(expected_session_id).await
}

#[tauri::command]
pub async fn disconnect_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
) -> Result<Snapshot, String> {
    state.service.disconnect(expected_session_id).await
}

#[tauri::command]
pub fn publish_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
    topic: String,
    payload: String,
    qos: u8,
    retain: bool,
) -> Result<(), String> {
    state.service.operation(expected_session_id, |client| {
        client.try_publish(topic, mqtt_session::qos(qos), retain, payload.into_bytes())
    })
}

#[tauri::command]
pub fn subscribe_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
    topic: String,
) -> Result<(), String> {
    state.service.operation(expected_session_id, |client| {
        client.try_subscribe(topic, rumqttc::QoS::AtMostOnce)
    })
}

#[tauri::command]
pub fn unsubscribe_mqtt(
    state: State<'_, MqttState>,
    expected_session_id: u64,
    topic: String,
) -> Result<(), String> {
    state
        .service
        .operation(expected_session_id, |client| client.try_unsubscribe(topic))
}
