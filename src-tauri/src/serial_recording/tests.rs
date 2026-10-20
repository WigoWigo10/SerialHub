use super::*;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct Shared {
    bytes: Vec<u8>,
    drops: usize,
    flush_error: bool,
}
struct Writer {
    shared: Arc<Mutex<Shared>>,
    limit: usize,
    fail_after: usize,
}
impl Write for Writer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let mut shared = self.shared.lock().unwrap();
        if shared.bytes.len() >= self.fail_after {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let size = bytes
            .len()
            .min(self.limit)
            .min(self.fail_after - shared.bytes.len());
        shared.bytes.extend_from_slice(&bytes[..size]);
        Ok(size)
    }
    fn flush(&mut self) -> io::Result<()> {
        if self.shared.lock().unwrap().flush_error {
            Err(io::ErrorKind::PermissionDenied.into())
        } else {
            Ok(())
        }
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        self.shared.lock().unwrap().drops += 1;
    }
}
fn mock_writer(limit: usize, fail_after: usize) -> (Writer, Arc<Mutex<Shared>>) {
    let shared = Arc::new(Mutex::new(Shared::default()));
    (
        Writer {
            shared: shared.clone(),
            limit,
            fail_after,
        },
        shared,
    )
}
struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "serialhub-audit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn append_preserves_existing_bytes_accented_path_and_raw_rx_tx_contract() {
    let temp = Temp::new();
    let path = temp.0.join("captura com espaço-é.log");
    std::fs::write(&path, [0x00, 0xff]).unwrap();
    let mut recording = SerialRecording::default();
    recording.start_file(&path).unwrap();
    recording.rx(&[0xc3, 0xa9, 0, 0xff, 13, 10]).unwrap();
    recording.tx(b"AB").unwrap();
    recording.finish().unwrap();
    assert_eq!(
        std::fs::read(&path).unwrap(),
        [
            vec![0, 255, 195, 169, 0, 255, 13, 10],
            b"\n>>> [TX] AB\n".to_vec()
        ]
        .concat()
    );
    assert!(!recording.snapshot().recording);
}

#[test]
fn empty_file_is_valid_and_active_recording_cannot_be_replaced() {
    let temp = Temp::new();
    let first = temp.0.join("first.log");
    let next = temp.0.join("next.log");
    let mut recording = SerialRecording::default();
    recording.start_file(&first).unwrap();
    assert!(recording.start_file(&next).is_err());
    assert!(!next.exists());
    recording.finish().unwrap();
    recording.finish().unwrap();
    assert_eq!(std::fs::metadata(first).unwrap().len(), 0);
    assert!(recording.start_file(&temp.0).is_err());
    assert!(!recording.snapshot().recording);
}

#[test]
fn failed_write_releases_writer_reports_partial_file_and_never_retries_packet() {
    let (writer, shared) = mock_writer(2, 3);
    let mut recording = SerialRecording::default();
    recording
        .start_writer("test".into(), Box::new(writer))
        .unwrap();
    assert!(recording.rx(b"ABCDE").is_err());
    let snapshot = recording.snapshot();
    assert!(!snapshot.recording);
    assert_eq!(snapshot.revision, 2);
    assert!(snapshot.error.unwrap().contains("parcial"));
    assert_eq!(shared.lock().unwrap().bytes, b"ABC");
    assert_eq!(shared.lock().unwrap().drops, 1);
    recording.rx(b"ABCDE").unwrap();
    recording.finish().unwrap();
    assert_eq!(shared.lock().unwrap().bytes, b"ABC");
    let (next, _) = mock_writer(usize::MAX, usize::MAX);
    recording
        .start_writer("next".into(), Box::new(next))
        .unwrap();
    assert!(recording.snapshot().recording);
    assert_eq!(recording.snapshot().error, None);
}

#[test]
fn flush_errors_are_not_silent_and_finish_closes_before_returning_error() {
    for during_append in [true, false] {
        let (writer, shared) = mock_writer(usize::MAX, usize::MAX);
        let mut recording = SerialRecording::default();
        recording
            .start_writer("test".into(), Box::new(writer))
            .unwrap();
        shared.lock().unwrap().flush_error = true;
        if during_append {
            assert!(recording.tx(b"A").is_err());
        } else {
            assert!(recording.finish().is_err());
        }
        assert!(!recording.snapshot().recording);
        assert!(recording.snapshot().error.is_some());
        assert_eq!(shared.lock().unwrap().drops, 1);
        recording.finish().unwrap();
    }
}

#[test]
fn transmit_completes_partial_writes_and_preserves_binary_bytes() {
    let (mut writer, shared) = mock_writer(2, usize::MAX);
    let bytes = [65, 0, 255, 128, 195, 169, 13, 10];
    let result = transmit(&mut writer, &bytes);
    assert_eq!(result.accepted, bytes.len());
    assert!(result.error.is_none());
    assert_eq!(shared.lock().unwrap().bytes, bytes);
}

#[test]
fn partial_failure_reports_and_logs_only_accepted_prefix() {
    let (mut serial, _) = mock_writer(2, 2);
    let (file, shared) = mock_writer(usize::MAX, usize::MAX);
    let mut recording = SerialRecording::default();
    recording
        .start_writer("file".into(), Box::new(file))
        .unwrap();
    let mut counted = 0;
    let mut echoed = Vec::new();
    let result = transmit_reported(&mut serial, b"ABCDE", |accepted| {
        recording.tx(accepted).unwrap();
        counted += accepted.len();
        echoed.extend_from_slice(accepted);
    });
    assert_eq!(result.accepted, 2);
    assert_eq!(result.error.unwrap().kind(), io::ErrorKind::BrokenPipe);
    assert_eq!(counted, 2);
    assert_eq!(echoed, b"AB");
    recording.finish().unwrap();
    assert_eq!(shared.lock().unwrap().bytes, b"\n>>> [TX] AB\n");
}

#[test]
fn zero_progress_fails_and_interrupted_write_is_retried() {
    let (mut zero, _) = mock_writer(0, usize::MAX);
    let result = transmit(&mut zero, b"A");
    assert_eq!(result.accepted, 0);
    assert_eq!(result.error.unwrap().kind(), io::ErrorKind::WriteZero);
    struct Interrupted(bool);
    impl Write for Interrupted {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if !self.0 {
                self.0 = true;
                Err(io::ErrorKind::Interrupted.into())
            } else {
                Ok(bytes.len())
            }
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    assert!(transmit(&mut Interrupted(false), b"AB").error.is_none());
}

#[test]
fn finishing_waits_for_inflight_rx_and_ignores_packets_after_stop() {
    let (entered, wait_entered) = mpsc::channel();
    let (release, wait_release) = mpsc::channel();
    let (base, shared) = mock_writer(usize::MAX, usize::MAX);
    struct Blocking {
        base: Writer,
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl Write for Blocking {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.entered.send(()).unwrap();
            self.release.recv_timeout(Duration::from_secs(2)).unwrap();
            self.base.write(bytes)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.base.flush()
        }
    }
    let mut recording = SerialRecording::default();
    recording
        .start_writer(
            "test".into(),
            Box::new(Blocking {
                base,
                entered,
                release: wait_release,
            }),
        )
        .unwrap();
    let state = Arc::new(Mutex::new(recording));
    let rx_state = state.clone();
    let rx = std::thread::spawn(move || rx_state.lock().unwrap().rx(b"RX").unwrap());
    wait_entered.recv_timeout(Duration::from_secs(2)).unwrap();
    let stop_state = state.clone();
    let (attempt, attempted) = mpsc::channel();
    let (done, finished) = mpsc::channel();
    let stop = std::thread::spawn(move || {
        attempt.send(()).unwrap();
        stop_state.lock().unwrap().finish().unwrap();
        done.send(()).unwrap();
    });
    attempted.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(finished.try_recv().is_err());
    release.send(()).unwrap();
    rx.join().unwrap();
    stop.join().unwrap();
    state.lock().unwrap().rx(b"late").unwrap();
    assert_eq!(shared.lock().unwrap().bytes, b"RX");
    assert_eq!(shared.lock().unwrap().drops, 1);
}
