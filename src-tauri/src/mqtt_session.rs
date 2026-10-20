//! MQTT session ownership, deadlines and cancellation, independent of Tauri.
use rumqttc::{AsyncClient, Event, EventLoop, Packet, QoS};
use serde::Serialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    sync::{oneshot, watch, Mutex as AsyncMutex},
    task::JoinHandle,
    time::Instant,
};

pub const CONNECTION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Idle,
    Connecting,
    Connected,
    Stopping,
    Cancelled,
    Disconnected,
    TimedOut,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    pub revision: u64,
    pub session_id: u64,
    pub status: Status,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Message {
    pub session_id: u64,
    pub sequence: u64,
    pub state_revision: u64,
    pub topic: String,
    pub payload_bytes: Vec<u8>,
    pub qos: u8,
}

pub enum Notice {
    State(Snapshot),
    Message(Message),
}
pub enum Incoming {
    ConnAck(bool),
    Message(String, Vec<u8>, u8),
    Closed,
    Other,
}
pub trait Events: Send {
    fn poll(&mut self) -> Pin<Box<dyn Future<Output = Result<Incoming, String>> + Send + '_>>;
}
impl Events for EventLoop {
    fn poll(&mut self) -> Pin<Box<dyn Future<Output = Result<Incoming, String>> + Send + '_>> {
        Box::pin(async move {
            match EventLoop::poll(self).await.map_err(|e| e.to_string())? {
                Event::Incoming(Packet::ConnAck(ack)) => Ok(Incoming::ConnAck(
                    ack.code == rumqttc::ConnectReturnCode::Success,
                )),
                Event::Incoming(Packet::Publish(p)) => {
                    Ok(Incoming::Message(p.topic, p.payload.to_vec(), p.qos as u8))
                }
                Event::Outgoing(rumqttc::Outgoing::Disconnect) => Ok(Incoming::Closed),
                _ => Ok(Incoming::Other),
            }
        })
    }
}

pub struct SessionIo {
    pub client: AsyncClient,
    pub events: Box<dyn Events>,
}
pub type Prepare = Box<dyn FnOnce() -> Result<SessionIo, String> + Send>;

#[derive(Clone)]
struct End {
    status: Status,
    error: Option<String>,
}
impl End {
    fn new(status: Status) -> Self {
        Self {
            status,
            error: None,
        }
    }
    fn failed(error: impl Into<String>) -> Self {
        Self {
            status: Status::Failed,
            error: Some(error.into()),
        }
    }
    fn timeout() -> Self {
        Self {
            status: Status::TimedOut,
            error: Some("Tempo limite de conexão MQTT (10 s): tentativa encerrada".into()),
        }
    }
}

struct Task {
    cancel: watch::Sender<Option<End>>,
    join: JoinHandle<()>,
}
struct Inner {
    snapshot: Snapshot,
    sequence: u64,
    client: Option<AsyncClient>,
    prepare: Option<oneshot::Sender<Prepare>>,
    task: Option<Task>,
    stop_reason: Option<End>,
    shutting_down: bool,
    notify: Arc<dyn Fn(Notice) + Send + Sync>,
}
struct Shared {
    inner: Mutex<Inner>,
    transitions: AsyncMutex<()>,
    timeout: Duration,
}
#[derive(Clone)]
pub struct MqttService(Arc<Shared>);
impl Default for MqttService {
    fn default() -> Self {
        Self::new(CONNECTION_TIMEOUT)
    }
}

impl MqttService {
    pub fn new(timeout: Duration) -> Self {
        Self(Arc::new(Shared {
            timeout,
            transitions: AsyncMutex::new(()),
            inner: Mutex::new(Inner {
                snapshot: Snapshot {
                    revision: 0,
                    session_id: 0,
                    status: Status::Idle,
                    error: None,
                },
                sequence: 0,
                client: None,
                prepare: None,
                task: None,
                stop_reason: None,
                shutting_down: false,
                notify: Arc::new(|_| {}),
            }),
        }))
    }
    pub fn set_notifier(&self, notify: impl Fn(Notice) + Send + Sync + 'static) {
        self.0.inner.lock().unwrap().notify = Arc::new(notify);
    }
    pub fn snapshot(&self) -> Snapshot {
        self.0.inner.lock().unwrap().snapshot.clone()
    }
    fn emit_state(inner: &mut Inner) {
        inner.snapshot.revision += 1;
        (inner.notify)(Notice::State(inner.snapshot.clone()));
    }
    pub async fn begin(&self) -> Result<Snapshot, String> {
        let _transition = self.0.transitions.lock().await;
        self.stop_locked(None, End::new(Status::Disconnected))
            .await
            .ok();
        let (send, receive) = oneshot::channel();
        let (cancel, cancelled) = watch::channel(None);
        let deadline = Instant::now() + self.0.timeout;
        let mut inner = self.0.inner.lock().unwrap();
        if inner.shutting_down {
            return Err("Aplicação MQTT está encerrando".into());
        }
        inner.snapshot.session_id += 1;
        inner.snapshot.status = Status::Connecting;
        inner.snapshot.error = None;
        inner.sequence = 0;
        inner.stop_reason = None;
        inner.prepare = Some(send);
        let id = inner.snapshot.session_id;
        let service = self.clone();
        let join = tokio::spawn(async move {
            // The tracked supervisor joins its worker and converts panic to a
            // terminal failure. No task ever waits on its own JoinHandle.
            let worker_service = service.clone();
            let worker = tokio::spawn(async move {
                worker_service
                    .execute(id, receive, cancelled, deadline)
                    .await
            });
            let end = worker
                .await
                .unwrap_or_else(|e| End::failed(format!("Task MQTT encerrada com falha: {e}")));
            service.finish(id, end);
        });
        inner.task = Some(Task { cancel, join });
        Self::emit_state(&mut inner);
        Ok(inner.snapshot.clone())
    }
    pub fn configure(&self, id: u64, prepare: Prepare) -> Result<(), String> {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.shutting_down
            || inner.snapshot.session_id != id
            || inner.snapshot.status != Status::Connecting
            || inner.stop_reason.is_some()
        {
            return Err("Tentativa MQTT encerrada ou substituída".into());
        }
        inner
            .prepare
            .take()
            .ok_or("Configuração já enviada para esta tentativa")?
            .send(prepare)
            .map_err(|_| "Task de conexão MQTT já encerrada".into())
    }
    pub async fn cancel(&self, id: u64) -> Result<Snapshot, String> {
        let _transition = self.0.transitions.lock().await;
        self.stop_locked(Some(id), End::new(Status::Cancelled))
            .await
    }
    pub async fn disconnect(&self, id: u64) -> Result<Snapshot, String> {
        let _transition = self.0.transitions.lock().await;
        self.stop_locked(Some(id), End::new(Status::Disconnected))
            .await
    }
    pub async fn shutdown(&self) {
        self.0.inner.lock().unwrap().shutting_down = true;
        let _transition = self.0.transitions.lock().await;
        self.stop_locked(None, End::new(Status::Disconnected))
            .await
            .ok();
    }
    async fn stop_locked(&self, expected: Option<u64>, end: End) -> Result<Snapshot, String> {
        let task = {
            let mut inner = self.0.inner.lock().unwrap();
            if expected.is_some_and(|id| id != inner.snapshot.session_id) {
                return Err("Sessão MQTT alterada; operação não aplicada".into());
            }
            if matches!(
                inner.snapshot.status,
                Status::Connecting | Status::Connected | Status::Stopping
            ) {
                inner.stop_reason.get_or_insert_with(|| end.clone());
                if end.status == Status::Disconnected && inner.snapshot.status == Status::Connected
                {
                    if let Some(client) = &inner.client {
                        let _ = client.try_disconnect();
                    }
                }
                inner.client.take();
                if inner.snapshot.status != Status::Stopping {
                    inner.snapshot.status = Status::Stopping;
                    Self::emit_state(&mut inner);
                }
                if let Some(task) = &inner.task {
                    let _ = task.cancel.send(Some(end));
                }
                inner.prepare.take();
            }
            inner.task.take()
        };
        // The worker uses only inner, never transitions. Both joins happen
        // outside inner; a cancelled validation job is joined too.
        if let Some(task) = task {
            if let Err(error) = task.join.await {
                self.finish(
                    self.snapshot().session_id,
                    End::failed(format!("Supervisor MQTT: {error}")),
                );
            }
        }
        Ok(self.snapshot())
    }
    fn stopping(&self, id: u64, end: End) {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.snapshot.session_id != id {
            return;
        }
        inner.stop_reason.get_or_insert(end);
        inner.client.take();
        if inner.snapshot.status != Status::Stopping {
            inner.snapshot.status = Status::Stopping;
            Self::emit_state(&mut inner);
        }
    }
    fn finish(&self, id: u64, end: End) {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.snapshot.session_id != id {
            return;
        }
        let end = inner.stop_reason.take().unwrap_or(end);
        inner.client.take();
        inner.prepare.take();
        inner.snapshot.status = end.status;
        inner.snapshot.error = end.error;
        Self::emit_state(&mut inner);
    }
    fn install(&self, id: u64, client: AsyncClient) -> bool {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.shutting_down
            || inner.snapshot.session_id != id
            || inner.snapshot.status != Status::Connecting
            || inner.stop_reason.is_some()
        {
            return false;
        }
        inner.client = Some(client);
        true
    }
    fn connected(&self, id: u64, deadline: Instant) -> bool {
        let mut inner = self.0.inner.lock().unwrap();
        if Instant::now() >= deadline
            || inner.shutting_down
            || inner.snapshot.session_id != id
            || inner.snapshot.status != Status::Connecting
            || inner.stop_reason.is_some()
        {
            return false;
        }
        inner.snapshot.status = Status::Connected;
        Self::emit_state(&mut inner);
        true
    }
    fn message(&self, id: u64, topic: String, payload_bytes: Vec<u8>, qos: u8) {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.shutting_down
            || inner.snapshot.session_id != id
            || inner.snapshot.status != Status::Connected
        {
            return;
        }
        inner.sequence += 1;
        (inner.notify)(Notice::Message(Message {
            session_id: id,
            sequence: inner.sequence,
            state_revision: inner.snapshot.revision,
            topic,
            payload_bytes,
            qos,
        }));
    }
    pub fn operation(
        &self,
        id: u64,
        operation: impl FnOnce(&AsyncClient) -> Result<(), rumqttc::ClientError>,
    ) -> Result<(), String> {
        let inner = self.0.inner.lock().unwrap();
        if inner.shutting_down
            || inner.snapshot.session_id != id
            || inner.snapshot.status != Status::Connected
        {
            return Err("Sessão MQTT não conectada ou substituída".into());
        }
        operation(inner.client.as_ref().ok_or("Cliente MQTT indisponível")?)
            .map_err(|e| e.to_string())
    }
    async fn execute(
        &self,
        id: u64,
        receive: oneshot::Receiver<Prepare>,
        mut cancel: watch::Receiver<Option<End>>,
        deadline: Instant,
    ) -> End {
        let prepare = tokio::select! {
            biased;
            end = cancelled(&mut cancel) => return end,
            _ = tokio::time::sleep_until(deadline) => return End::timeout(),
            prepare = receive => match prepare { Ok(prepare) => prepare, Err(_) => return End::failed("Configuração MQTT não recebida") },
        };
        let mut validation = tokio::task::spawn_blocking(prepare);
        let prepared = tokio::select! {
            biased;
            end = cancelled(&mut cancel) => {
                self.stopping(id, end.clone());
                validation.abort(); let _ = validation.await;
                return end;
            },
            _ = tokio::time::sleep_until(deadline) => {
                self.stopping(id, End::timeout());
                validation.abort(); let _ = validation.await;
                return End::timeout();
            },
            prepared = &mut validation => match prepared {
                Ok(Ok(io)) => io,
                Ok(Err(error)) => return End::failed(error),
                Err(error) => return End::failed(format!("Validação MQTT: {error}")),
            },
        };
        let SessionIo { client, mut events } = prepared;
        if Instant::now() >= deadline {
            return End::timeout();
        }
        if !self.install(id, client) {
            return End::new(Status::Cancelled);
        }
        let mut connected = false;
        let end = loop {
            let incoming = tokio::select! {
                biased;
                end = cancelled(&mut cancel) => break end,
                _ = tokio::time::sleep_until(deadline), if !connected => break End::timeout(),
                event = events.poll() => event,
            };
            match incoming {
                Ok(Incoming::ConnAck(true)) if !connected => {
                    if Instant::now() >= deadline {
                        break End::timeout();
                    }
                    if !self.connected(id, deadline) {
                        break if Instant::now() >= deadline {
                            End::timeout()
                        } else {
                            End::new(Status::Cancelled)
                        };
                    }
                    connected = true;
                }
                Ok(Incoming::ConnAck(false)) => break End::failed("Broker recusou MQTT CONNACK"),
                Ok(Incoming::Message(topic, payload, qos)) if connected => {
                    self.message(id, topic, payload, qos)
                }
                Ok(_) => {}
                Err(error) => break End::failed(error),
            }
        };
        if connected && end.status == Status::Disconnected {
            // Best-effort MQTT DISCONNECT, bounded even for an unresponsive peer.
            // Cancellation/timeout never wait for a protocol acknowledgement.
            let _ = tokio::time::timeout(Duration::from_millis(200), async {
                loop {
                    match events.poll().await {
                        Ok(Incoming::Closed) | Err(_) => break,
                        _ => {}
                    }
                }
            })
            .await;
        }
        drop(events); // close network and queued requests before terminal state
        end
    }
}

async fn cancelled(receiver: &mut watch::Receiver<Option<End>>) -> End {
    loop {
        if let Some(end) = receiver.borrow().clone() {
            return end;
        }
        if receiver.changed().await.is_err() {
            return End::new(Status::Disconnected);
        }
    }
}

pub fn qos(value: u8) -> QoS {
    match value {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

#[cfg(test)]
mod tests;
