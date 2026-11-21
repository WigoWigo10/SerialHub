use super::*;
use serde_json::Value;
use std::sync::Barrier;

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("serialhub-capture-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn message(sequence: u64, bytes: impl Into<Vec<u8>>) -> Message {
    Message {
        session_id: 2,
        sequence,
        state_revision: 1,
        topic: "serialhub/bench/events".into(),
        payload_bytes: bytes.into(),
        qos: 1,
    }
}

fn json_rows(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn hybrid_records_preserve_bytes_and_correlate_fragmented_lines() {
    let destination = Scratch::new();
    let capture = Capture::default();
    let info = capture.start(&destination.0, Mode::Hybrid).unwrap();
    assert!(capture.start(&destination.0, Mode::Mqtt).is_err());
    assert!(capture.stop(Some("old capture")).is_err());

    capture.serial(1, false, br#"{"run":"sample","#);
    capture.serial(1, false, b"\"seq\":1}\r\n{\"run\":\"sample\",\"seq\":3}\n");
    capture.serial(1, true, b"START\r\n");
    capture.mqtt(&message(1, br#"{"run":"sample","seq":1}"#));
    capture.mqtt(&message(2, br#"{"run":"sample","seq":1}"#));
    capture.mqtt(&message(3, br#"{"run":"sample","seq":4}"#));
    capture.mqtt(&message(4, [0, 255, 195]));
    let summary = capture.stop(Some(&info.id)).unwrap().unwrap();
    assert_eq!(summary.mqtt_records, 4);
    assert_eq!(summary.serial_records, 3);
    let data = summary.correlation.unwrap();
    assert_eq!((data.paired, data.serial_only, data.mqtt_only), (1, 1, 1));
    assert_eq!(data.missing_in_both_inside_observed_ranges, 1);
    assert_eq!(data.mqtt_duplicates, 1);
    assert!(data.p95_mqtt_minus_serial_us.unwrap() >= 0);
    let rows = json_rows(&info.path.join("mqtt.jsonl"));
    assert_eq!(rows[3]["payload_bytes"], serde_json::json!([0, 255, 195]));
    assert_eq!(rows[3]["qos"], 1);
    assert!(rows[3]["received_at"].as_str().unwrap().ends_with('Z'));
    let serial = json_rows(&info.path.join("serial.jsonl"));
    assert_eq!(serial[2]["direction"], "tx");
    assert_eq!(serial[2]["bytes"], serde_json::json!(b"START\r\n"));
    assert_eq!(json_rows(&info.path.join("correlation.jsonl")).len(), 3);
    assert_eq!(capture.status().last.unwrap().info.id, info.id);
    assert!(info.path.join("metrics.csv").exists());
    assert!(info.path.join("summary.json").exists());
}

#[test]
fn metrics_capture_samples_process_and_counts_without_writing_payloads() {
    let destination = Scratch::new();
    let capture = Capture::default();
    let info = capture.start(&destination.0, Mode::Metrics).unwrap();
    capture.serial(1, false, b"1234");
    capture.mqtt(&message(1, [0, 255]));
    thread::sleep(Duration::from_millis(1150));
    let summary = capture.shutdown().unwrap().unwrap();
    assert_eq!(summary.counts.serial_rx_bytes, 4);
    assert_eq!(summary.counts.mqtt_messages, 1);
    assert_eq!(summary.counts.mqtt_bytes, 2);
    let csv = fs::read_to_string(info.path.join("metrics.csv")).unwrap();
    let rows: Vec<_> = csv
        .lines()
        .map(|line| line.split(',').collect::<Vec<_>>())
        .collect();
    assert!(rows.len() >= 2);
    assert_eq!(rows[0].len(), rows[1].len());
    assert!(rows.last().unwrap()[5].parse::<u64>().unwrap() > 0);
    assert_eq!(rows.last().unwrap()[11], "1");
    assert!(!info.path.join("mqtt.jsonl").exists());
    assert!(!info.path.join("serial.jsonl").exists());
    assert!(capture.start(&destination.0, Mode::Metrics).is_err());
}

#[test]
fn correlation_cannot_join_bytes_across_a_dropped_capture_chunk() {
    let mut tracker = Correlation::default();
    for (sequence, data) in [
        (1, br#"{"run":"damaged","#.as_slice()),
        (3, b"\"seq\":5}\n{\"run\":\"whole\",\"seq\":8}\n".as_slice()),
    ] {
        tracker.serial(&SerialRecord {
            stamp: Stamp::now(Instant::now()),
            session_id: 1,
            rx_sequence: Some(sequence),
            direction: "rx",
            bytes: data.to_vec(),
        });
    }
    assert_eq!(tracker.summary.serial_capture_gaps, 1);
    assert_eq!(
        tracker.pairs.keys().cloned().collect::<Vec<_>>(),
        vec![("whole".into(), 8)]
    );
}

#[test]
fn burst_counts_queue_discards_without_blocking_the_producer() {
    let capture = Capture::default();
    let destination = Scratch::new();
    let (sender, receiver) = mpsc::sync_channel(1);
    let permit = Arc::new(Barrier::new(2));
    let writer_permit = permit.clone();
    let writer = thread::spawn(move || {
        writer_permit.wait();
        assert!(matches!(receiver.recv().unwrap(), Record::Mqtt(_)));
        Err(io::Error::other("fixture ended"))
    });
    let counts = Arc::new(Mutex::new(Counts::default()));
    capture.0.state.lock().running = Some(Running {
        info: Info {
            id: "queue-fixture".into(),
            path: destination.0.clone(),
            mode: Mode::Mqtt,
        },
        start: Instant::now(),
        sender,
        counts: counts.clone(),
        writer,
    });
    for seq in 1..=3 {
        capture.mqtt(&message(seq, [0, 255]));
    }
    permit.wait();
    assert_eq!(counts.lock().mqtt_messages, 3);
    assert_eq!(counts.lock().mqtt_queue_drops, 2);
    assert!(capture.stop(Some("queue-fixture")).is_err());
    assert!(capture.status().active.is_none());
}

#[tokio::test]
#[ignore = "requires the isolated Mosquitto started by scripts/mqtt_loopback.py"]
async fn mosquitto_transport_bench_capture() {
    use rumqttc::{AsyncClient, Broker, Event, MqttOptions, Packet, PublishOptions, QoS};
    let scratch = Scratch::new();
    let capture = Capture::default();
    let info = capture.start(&scratch.0, Mode::Mqtt).unwrap();
    let port = std::env::var("SERIALHUB_TEST_TCP_PORT")
        .unwrap()
        .parse()
        .unwrap();
    let broker = Broker::tcp("127.0.0.1", port);
    let (subscriber, mut incoming) =
        AsyncClient::builder(MqttOptions::new("capture-verifier", broker.clone()))
            .capacity(16)
            .build();
    let (publisher, mut outgoing) =
        AsyncClient::builder(MqttOptions::new("capture-publisher", broker))
            .capacity(16)
            .build();
    let topic = "serialhub/local-test/capture";
    let total = 620;
    tokio::time::timeout(Duration::from_secs(30), async {
        subscriber.subscribe(topic, QoS::AtLeastOnce).await.unwrap();
        loop {
            if matches!(
                incoming.poll().await.unwrap(),
                Event::Incoming(Packet::SubAck(_))
            ) {
                break;
            }
        }
        tokio::join!(
            async {
                for sequence in 0..total {
                    let mut payload = vec![0, 255];
                    payload.extend_from_slice(&(sequence as u32).to_be_bytes());
                    publisher
                        .publish(topic, payload, PublishOptions::at_least_once())
                        .await
                        .unwrap();
                    loop {
                        if matches!(
                            outgoing.poll().await.unwrap(),
                            Event::Incoming(Packet::PubAck(_))
                        ) {
                            break;
                        }
                    }
                }
            },
            async {
                for sequence in 0..total {
                    loop {
                        if let Event::Incoming(Packet::Publish(record)) =
                            incoming.poll().await.unwrap()
                        {
                            assert_eq!(record.topic.as_ref(), topic.as_bytes());
                            capture.mqtt(&Message {
                                topic: topic.to_owned(),
                                qos: record.qos as u8,
                                ..message(sequence + 1, record.payload.to_vec())
                            });
                            break;
                        }
                    }
                }
            }
        );
    })
    .await
    .unwrap();
    let summary = capture.stop(Some(&info.id)).unwrap().unwrap();
    assert_eq!(summary.mqtt_records, total);
    assert_eq!(summary.counts.mqtt_queue_drops, 0);
    let rows = json_rows(&info.path.join("mqtt.jsonl"));
    for (i, record) in rows.iter().enumerate() {
        let mut expected = vec![0, 255];
        expected.extend_from_slice(&(i as u32).to_be_bytes());
        assert_eq!(record["payload_bytes"], serde_json::json!(expected));
        assert_eq!(record["topic"], topic);
        assert_eq!(record["qos"], 1);
    }
}
