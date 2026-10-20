use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::mpsc;

enum Input {
    Event(Result<Incoming, String>),
    Panic,
}
struct FakeEvents {
    input: mpsc::UnboundedReceiver<Input>,
    _requests: EventLoop,
    polled: Option<oneshot::Sender<()>>,
    drops: Arc<AtomicUsize>,
}
impl Drop for FakeEvents {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl Events for FakeEvents {
    fn poll(&mut self) -> Pin<Box<dyn Future<Output = Result<Incoming, String>> + Send + '_>> {
        Box::pin(async move {
            if let Some(polled) = self.polled.take() {
                let _ = polled.send(());
            }
            match self.input.recv().await {
                Some(Input::Event(event)) => event,
                Some(Input::Panic) => panic!("simulated event loop panic"),
                None => Err("simulated event channel closed".into()),
            }
        })
    }
}
type Fake = (
    Prepare,
    mpsc::UnboundedSender<Input>,
    oneshot::Receiver<()>,
    Arc<AtomicUsize>,
);
fn fake() -> Fake {
    let (client, requests) =
        AsyncClient::new(rumqttc::MqttOptions::new("test", "localhost", 1883), 8);
    let (send, input) = mpsc::unbounded_channel();
    let (notify, polled) = oneshot::channel();
    let drops = Arc::new(AtomicUsize::new(0));
    let events = FakeEvents {
        input,
        _requests: requests,
        polled: Some(notify),
        drops: drops.clone(),
    };
    (
        Box::new(move || {
            Ok(SessionIo {
                client,
                events: Box::new(events),
            })
        }),
        send,
        polled,
        drops,
    )
}
fn service() -> (MqttService, mpsc::UnboundedReceiver<Notice>) {
    let service = MqttService::new(Duration::from_secs(10));
    let (send, receive) = mpsc::unbounded_channel();
    service.set_notifier(move |notice| {
        let _ = send.send(notice);
    });
    (service, receive)
}
async fn state(notices: &mut mpsc::UnboundedReceiver<Notice>, status: Status) -> Snapshot {
    loop {
        if let Some(Notice::State(snapshot)) = notices.recv().await {
            if snapshot.status == status {
                return snapshot;
            }
        }
    }
}
async fn connected(
    service: &MqttService,
    notices: &mut mpsc::UnboundedReceiver<Notice>,
) -> (u64, mpsc::UnboundedSender<Input>, Arc<AtomicUsize>) {
    let id = service.begin().await.unwrap().session_id;
    let (prepare, send, _polled, drops) = fake();
    send.send(Input::Event(Ok(Incoming::ConnAck(true))))
        .unwrap();
    service.configure(id, prepare).unwrap();
    state(notices, Status::Connected).await;
    (id, send, drops)
}
fn released(service: &MqttService) {
    let inner = service.0.inner.lock().unwrap();
    assert!(inner.client.is_none());
    assert!(inner.prepare.is_none());
    assert!(inner
        .task
        .as_ref()
        .is_none_or(|task| task.join.is_finished()));
}

#[tokio::test]
async fn cancel_before_configuration_rejects_late_start_and_joins_tasks() {
    let (service, _) = service();
    let id = service.begin().await.unwrap().session_id;
    assert_eq!(service.cancel(id).await.unwrap().status, Status::Cancelled);
    let (prepare, _, _, drops) = fake();
    assert!(service.configure(id, prepare).is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
    assert_eq!(service.cancel(id).await.unwrap().status, Status::Cancelled);
}

#[tokio::test]
async fn expired_deadline_cannot_publish_connected_even_before_timer_is_polled() {
    let (service, _) = service();
    let id = service.begin().await.unwrap().session_id;
    assert!(!service.connected(id, Instant::now()));
    assert_eq!(service.snapshot().status, Status::Connecting);
    service.cancel(id).await.unwrap();
    released(&service);
}

#[tokio::test]
async fn cancellation_waits_for_blocking_validation_and_drops_its_late_result() {
    let (service, mut notices) = service();
    let id = service.begin().await.unwrap().session_id;
    let (prepare, _send, _polled, drops) = fake();
    let (started, begin) = oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    service
        .configure(
            id,
            Box::new(move || {
                let _ = started.send(());
                wait.recv_timeout(Duration::from_secs(3)).unwrap();
                prepare()
            }),
        )
        .unwrap();
    begin.await.unwrap();
    let stop_service = service.clone();
    let stop = tokio::spawn(async move { stop_service.cancel(id).await });
    state(&mut notices, Status::Stopping).await;
    assert!(!stop.is_finished());
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    release.send(()).unwrap();
    assert_eq!(stop.await.unwrap().unwrap().status, Status::Cancelled);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
}

#[tokio::test]
async fn timeout_invalidates_validation_then_waits_for_its_release() {
    let (service, mut notices) = service();
    let id = service.begin().await.unwrap().session_id;
    let (prepare, _send, _polled, drops) = fake();
    let (started, begin) = oneshot::channel();
    let (release, wait) = std::sync::mpsc::channel();
    service
        .configure(
            id,
            Box::new(move || {
                let _ = started.send(());
                wait.recv_timeout(Duration::from_secs(3)).unwrap();
                prepare()
            }),
        )
        .unwrap();
    begin.await.unwrap();
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(11)).await;
    state(&mut notices, Status::Stopping).await;
    assert!(!service.connected(id, Instant::now() + Duration::from_secs(10)));
    assert!(service.operation(id, |_| Ok(())).is_err());
    release.send(()).unwrap();
    state(&mut notices, Status::TimedOut).await;
    service.disconnect(id).await.unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
}

#[tokio::test]
async fn timeout_closes_event_loop_and_late_connack_cannot_connect() {
    let (service, mut notices) = service();
    let id = service.begin().await.unwrap().session_id;
    let (prepare, send, polled, drops) = fake();
    service.configure(id, prepare).unwrap();
    polled.await.unwrap();
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(11)).await;
    state(&mut notices, Status::TimedOut).await;
    service.disconnect(id).await.unwrap();
    assert!(send
        .send(Input::Event(Ok(Incoming::ConnAck(true))))
        .is_err());
    assert!(!service.connected(id, Instant::now() + Duration::from_secs(10)));
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
}

#[tokio::test(start_paused = true)]
async fn timeout_also_covers_reservation_without_configuration() {
    let (service, mut notices) = service();
    let id = service.begin().await.unwrap().session_id;
    tokio::time::advance(Duration::from_secs(11)).await;
    state(&mut notices, Status::TimedOut).await;
    service.disconnect(id).await.unwrap();
    released(&service);
}

#[tokio::test]
async fn new_session_after_cancel_rejects_old_errors_messages_and_operations() {
    let (service, mut notices) = service();
    let old = service.begin().await.unwrap().session_id;
    service.cancel(old).await.unwrap();
    let (new, send, drops) = connected(&service, &mut notices).await;
    let before = service.snapshot();
    service.finish(old, End::failed("late error"));
    service.message(old, "old".into(), "old".into(), 0);
    assert!(!service.connected(old, Instant::now() + Duration::from_secs(10)));
    assert!(service.cancel(old).await.is_err());
    assert!(service.disconnect(old).await.is_err());
    assert!(service
        .operation(old, |_| panic!("old operation applied"))
        .is_err());
    assert_eq!(service.snapshot().revision, before.revision);
    assert_eq!(service.snapshot().session_id, new);
    service.message(new, "new".into(), "value".into(), 0);
    match notices.recv().await.unwrap() {
        Notice::Message(message) => {
            assert_eq!(message.session_id, new);
            assert_eq!(message.sequence, 1);
        }
        _ => panic!("unexpected stale event"),
    }
    send.send(Input::Event(Ok(Incoming::Closed))).unwrap();
    service.disconnect(new).await.unwrap();
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
}

#[tokio::test]
async fn repeated_disconnect_and_shutdown_release_handles_and_prevent_restart() {
    let (service, mut notices) = service();
    let (id, send, drops) = connected(&service, &mut notices).await;
    send.send(Input::Event(Ok(Incoming::Closed))).unwrap();
    let first = service.disconnect(id).await.unwrap();
    assert_eq!(first.status, Status::Disconnected);
    assert_eq!(
        service.disconnect(id).await.unwrap().revision,
        first.revision
    );
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
    service.shutdown().await;
    service.shutdown().await;
    assert!(service.begin().await.is_err());
}

#[tokio::test]
async fn fatal_poll_error_and_panic_reap_task_and_clear_client() {
    for panic in [false, true] {
        let (service, mut notices) = service();
        let (id, send, drops) = connected(&service, &mut notices).await;
        send.send(if panic {
            Input::Panic
        } else {
            Input::Event(Err("fatal I/O".into()))
        })
        .unwrap();
        assert!(state(&mut notices, Status::Failed).await.error.is_some());
        service.disconnect(id).await.unwrap();
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        released(&service);
    }
}

#[tokio::test]
async fn refused_connack_and_invalid_configuration_never_publish_connected() {
    for refused in [false, true] {
        let (service, mut notices) = service();
        let id = service.begin().await.unwrap().session_id;
        if refused {
            let (prepare, send, _, _) = fake();
            send.send(Input::Event(Ok(Incoming::ConnAck(false))))
                .unwrap();
            service.configure(id, prepare).unwrap();
        } else {
            service
                .configure(id, Box::new(|| Err("invalid TLS configuration".into())))
                .unwrap();
        }
        state(&mut notices, Status::Failed).await;
        service.disconnect(id).await.unwrap();
        released(&service);
        while let Ok(notice) = notices.try_recv() {
            if let Notice::State(snapshot) = notice {
                assert_ne!(snapshot.status, Status::Connected);
            }
        }
    }
}

#[tokio::test]
async fn operations_require_connected_identity_and_queue_backpressure_never_blocks_close() {
    let (service, mut notices) = service();
    let pending = service.begin().await.unwrap().session_id;
    assert!(service
        .operation(pending, |_| panic!("operation during connect"))
        .is_err());
    service.cancel(pending).await.unwrap();
    let (id, _send, drops) = connected(&service, &mut notices).await;
    for _ in 0..8 {
        service
            .operation(id, |client| {
                client.try_publish("topic", QoS::AtMostOnce, false, b"data".to_vec())
            })
            .unwrap();
    }
    assert!(service
        .operation(id, |client| client.try_publish(
            "topic",
            QoS::AtMostOnce,
            false,
            b"data".to_vec()
        ))
        .is_err());
    service.cancel(id).await.unwrap();
    assert!(service
        .operation(id, |_| panic!("operation after close"))
        .is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    released(&service);
}

#[tokio::test]
async fn replacing_connected_session_joins_old_before_reserving_new() {
    let (service, mut notices) = service();
    let (old, send, drops) = connected(&service, &mut notices).await;
    send.send(Input::Event(Ok(Incoming::Closed))).unwrap();
    let new = service.begin().await.unwrap();
    assert!(new.session_id > old);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert_eq!(new.status, Status::Connecting);
    service.cancel(new.session_id).await.unwrap();
    released(&service);
}

async fn mqtt_frame(socket: &mut tokio::net::TcpStream) -> u8 {
    use tokio::io::AsyncReadExt;
    let header = socket.read_u8().await.unwrap();
    let (mut length, mut factor) = (0usize, 1usize);
    loop {
        let byte = socket.read_u8().await.unwrap();
        length += (byte as usize & 127) * factor;
        if byte < 128 {
            break;
        }
        factor *= 128;
        assert!(factor <= 2097152);
    }
    assert!(length < 1024 * 1024);
    socket.read_exact(&mut vec![0; length]).await.unwrap();
    header >> 4
}

#[tokio::test]
async fn loopback_real_mqtt_connect_cancel_and_reconnect() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (received, wait_received) = oneshot::channel();
    let payloads = vec![
        b"42".to_vec(),
        (0u8..=255).collect(),
        vec![],
        vec![0xc3],
        vec![0xa9],
        "é😀\r\n".as_bytes().to_vec(),
    ];
    let expected_payloads = payloads.clone();
    let broker = tokio::spawn(async move {
        // First attempt: deliberately withhold CONNACK, then observe socket close.
        let (mut first, _) = listener.accept().await.unwrap();
        assert_eq!(mqtt_frame(&mut first).await, 1);
        received.send(()).unwrap();
        assert_eq!(first.read(&mut [0]).await.unwrap(), 0);
        // Second attempt: accept CONNECT and verify graceful MQTT DISCONNECT.
        let (mut second, _) = listener.accept().await.unwrap();
        assert_eq!(mqtt_frame(&mut second).await, 1);
        second.write_all(&[0x20, 2, 0, 0]).await.unwrap();
        for payload in payloads {
            let mut packet = vec![0x30];
            let mut length = 7 + payload.len();
            loop {
                let mut byte = (length % 128) as u8;
                length /= 128;
                if length > 0 {
                    byte |= 128;
                }
                packet.push(byte);
                if length == 0 {
                    break;
                }
            }
            packet.extend_from_slice(&[0, 5, b't', b'o', b'p', b'i', b'c']);
            packet.extend_from_slice(&payload);
            second.write_all(&packet).await.unwrap();
        }
        assert_eq!(mqtt_frame(&mut second).await, 14);
    });
    let prepare = move || -> Prepare {
        Box::new(move || {
            let options = crate::commands::mqtt_transport::options(
                "a03-loopback",
                "localhost",
                port,
                crate::commands::mqtt_transport::MqttTransport::Tcp,
                None,
                None,
                None,
                None,
            )?;
            let (client, events) = AsyncClient::new(options, 8);
            Ok(SessionIo {
                client,
                events: Box::new(events),
            })
        })
    };
    let (service, mut notices) = service();
    let first = service.begin().await.unwrap().session_id;
    service.configure(first, prepare()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), wait_received)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        service.cancel(first).await.unwrap().status,
        Status::Cancelled
    );
    released(&service);
    let second = service.begin().await.unwrap().session_id;
    service.configure(second, prepare()).unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        state(&mut notices, Status::Connected),
    )
    .await
    .unwrap();
    for (index, expected) in expected_payloads.iter().enumerate() {
        let message = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(Notice::Message(message)) = notices.recv().await {
                    break message;
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(message.session_id, second);
        assert_eq!(message.state_revision, service.snapshot().revision);
        assert_eq!(message.sequence, index as u64 + 1);
        assert_eq!(&message.payload_bytes, expected);
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["payload_bytes"], serde_json::json!(expected));
        assert!(json.get("payload").is_none());
    }
    assert_eq!(
        service.disconnect(second).await.unwrap().status,
        Status::Disconnected
    );
    released(&service);
    tokio::time::timeout(Duration::from_secs(3), broker)
        .await
        .unwrap()
        .unwrap();
}

#[test]
fn payload_serialization_preserves_every_byte_and_session_metadata() {
    for bytes in [vec![], (0u8..=255).collect(), "é😀\r\n".as_bytes().to_vec()] {
        let message = Message {
            session_id: 7,
            sequence: 3,
            state_revision: 42,
            topic: "__proto__/data".into(),
            payload_bytes: bytes.clone(),
            qos: 2,
        };
        let json = serde_json::to_value(&message).unwrap();
        assert_eq!(json["payload_bytes"], serde_json::json!(bytes));
        assert_eq!(json["session_id"], 7);
        assert_eq!(json["sequence"], 3);
        assert_eq!(json["state_revision"], 42);
        assert_eq!(json["topic"], "__proto__/data");
        assert_eq!(json["qos"], 2);
        assert!(json.get("payload").is_none());
    }
}
