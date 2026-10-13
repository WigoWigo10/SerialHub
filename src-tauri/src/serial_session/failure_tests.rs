use super::*;
use serialhub_core::{DataBits, FlowControl, Parity, SerialConfig, StopBits};
use serialport::{ClearBuffer, Error, ErrorKind, Result, SerialPort};
use std::collections::VecDeque;
use std::io::Write;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Default)]
struct Shared {
    input: VecDeque<u8>,
    output: Vec<u8>,
    read_error: Option<io::ErrorKind>,
    write_error: Option<io::ErrorKind>,
    control_error: bool,
    clone_error: bool,
    write_limit: Option<usize>,
    dtr: bool,
    rts: bool,
    cleared: bool,
    drops: usize,
    read_calls: usize,
}

struct MockPort {
    config: SerialConfig,
    shared: Arc<Mutex<Shared>>,
}

fn mock(config: SerialConfig) -> (MockPort, Arc<Mutex<Shared>>) {
    let shared = Arc::new(Mutex::new(Shared::default()));
    (
        MockPort {
            config,
            shared: shared.clone(),
        },
        shared,
    )
}

impl Drop for MockPort {
    fn drop(&mut self) {
        self.shared.lock().unwrap().drops += 1;
    }
}

impl Read for MockPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        thread::sleep(Duration::from_millis(1));
        let mut state = self.shared.lock().unwrap();
        state.read_calls += 1;
        if let Some(kind) = state.read_error {
            return Err(io::Error::new(kind, "simulated read"));
        }
        if state.input.is_empty() {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "idle"));
        }
        let len = buf.len().min(state.input.len());
        for byte in &mut buf[..len] {
            *byte = state.input.pop_front().unwrap();
        }
        Ok(len)
    }
}

impl Write for MockPort {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let mut state = self.shared.lock().unwrap();
        if let Some(kind) = state.write_error {
            return Err(io::Error::new(kind, "simulated write"));
        }
        let len = state.write_limit.unwrap_or(bytes.len()).min(bytes.len());
        state.output.extend_from_slice(&bytes[..len]);
        Ok(len)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

macro_rules! setting {
    ($getter:ident, $setter:ident, $field:ident, $ty:ty) => {
        fn $getter(&self) -> Result<$ty> {
            Ok(self.config.$field)
        }
        fn $setter(&mut self, value: $ty) -> Result<()> {
            self.config.$field = value;
            Ok(())
        }
    };
}

impl SerialPort for MockPort {
    fn name(&self) -> Option<String> {
        Some(self.config.port_name.clone())
    }
    setting!(baud_rate, set_baud_rate, baud_rate, u32);
    setting!(data_bits, set_data_bits, data_bits, DataBits);
    setting!(flow_control, set_flow_control, flow_control, FlowControl);
    setting!(parity, set_parity, parity, Parity);
    setting!(stop_bits, set_stop_bits, stop_bits, StopBits);
    fn timeout(&self) -> Duration {
        self.config.timeout
    }
    fn set_timeout(&mut self, value: Duration) -> Result<()> {
        self.config.timeout = value;
        Ok(())
    }
    fn write_request_to_send(&mut self, active: bool) -> Result<()> {
        let mut state = self.shared.lock().unwrap();
        if state.control_error {
            return Err(Error::new(ErrorKind::NoDevice, "control disconnected"));
        }
        state.rts = active;
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, active: bool) -> Result<()> {
        let mut state = self.shared.lock().unwrap();
        if state.control_error {
            return Err(Error::new(ErrorKind::NoDevice, "control disconnected"));
        }
        state.dtr = active;
        Ok(())
    }
    fn read_clear_to_send(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_data_set_ready(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_ring_indicator(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_carrier_detect(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn bytes_to_read(&self) -> Result<u32> {
        Ok(self.shared.lock().unwrap().input.len() as u32)
    }
    fn bytes_to_write(&self) -> Result<u32> {
        Ok(0)
    }
    fn clear(&self, buffer: ClearBuffer) -> Result<()> {
        assert_eq!(buffer, ClearBuffer::Input);
        let mut state = self.shared.lock().unwrap();
        state.cleared = true;
        state.input.clear();
        Ok(())
    }
    fn try_clone(&self) -> Result<Box<dyn SerialPort>> {
        if self.shared.lock().unwrap().clone_error {
            return Err(Error::new(ErrorKind::NoDevice, "clone disconnected"));
        }
        Ok(Box::new(Self {
            config: self.config.clone(),
            shared: self.shared.clone(),
        }))
    }
    fn set_break(&self) -> Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> Result<()> {
        Ok(())
    }
}

fn fake_connection(name: &str) -> (SerialConnection, Arc<Mutex<Shared>>) {
    let (port, shared) = mock(SerialConfig::new(name, 115200));
    (SerialConnection::from_transport(Box::new(port)), shared)
}

fn attach(
    session: &Arc<Mutex<SerialSession>>,
    connection: SerialConnection,
    failures: mpsc::Sender<SessionFailure>,
    receive: impl FnMut(&[u8]) -> std::result::Result<(), String> + Send + 'static,
) -> Arc<AtomicBool> {
    let reader = connection.try_clone().unwrap();
    let mut session = session.lock().unwrap();
    let running = session.start(connection, "test-virtual".into()).unwrap();
    let worker = spawn_reader(reader, running.clone(), failures, receive).unwrap();
    session.workers.push(worker);
    running
}

fn wait_for_reads(shared: &Arc<Mutex<Shared>>, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while shared.lock().unwrap().read_calls < count {
        assert!(Instant::now() < deadline, "reader did not progress");
        thread::sleep(Duration::from_millis(1));
    }
}

fn barrier(failures: &mpsc::Sender<SessionFailure>) {
    let (done, wait) = mpsc::channel();
    failures.send(SessionFailure::Barrier(done)).unwrap();
    wait.recv_timeout(Duration::from_secs(2)).unwrap();
}

#[test]
fn fatal_read_releases_both_handles_before_notification_and_allows_reconnect() {
    let session = Arc::new(Mutex::new(SerialSession::default()));
    let (failures, receiver) = mpsc::channel();
    let (events, notifications) = mpsc::channel();
    let supervisor = spawn_failure_supervisor(session.clone(), receiver, move |snapshot| {
        events.send((snapshot, thread::current().id())).unwrap();
    })
    .unwrap();
    let (connection, shared) = fake_connection("first");
    let (readers, reader_ids) = mpsc::channel();
    shared.lock().unwrap().input.extend([0, 255, 128, 13, 10]);
    attach(&session, connection, failures.clone(), move |bytes| {
        assert_eq!(bytes, &[0, 255, 128, 13, 10]);
        readers.send(thread::current().id()).unwrap();
        Ok(())
    });
    let reader_id = reader_ids.recv_timeout(Duration::from_secs(2)).unwrap();
    wait_for_reads(&shared, 3); // empty reads are timeouts, not a disconnect
    assert!(session.lock().unwrap().snapshot().connected);
    assert_eq!(shared.lock().unwrap().drops, 0);
    shared.lock().unwrap().read_error = Some(io::ErrorKind::BrokenPipe);
    let (lost, supervisor_id) = notifications.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_ne!(reader_id, supervisor_id); // the joining supervisor is not the reader
    assert!(!lost.connected);
    assert_eq!(lost.port_name, None);
    assert!(lost.error.unwrap().contains("simulated read"));
    assert_eq!(shared.lock().unwrap().drops, 2);
    assert!(session.lock().unwrap().workers.is_empty());
    session.lock().unwrap().stop().unwrap();
    session.lock().unwrap().stop().unwrap();
    let (next, next_shared) = fake_connection("second");
    attach(&session, next, failures.clone(), |_| Ok(()));
    let current = session.lock().unwrap().snapshot();
    assert!(current.connected);
    assert!(current.session_id > lost.session_id);
    assert!(current.revision > lost.revision);
    assert_eq!(current.error, None);
    session.lock().unwrap().stop().unwrap();
    assert_eq!(next_shared.lock().unwrap().drops, 2);
    failures.send(SessionFailure::Shutdown).unwrap();
    supervisor.join().unwrap();
}

#[test]
fn queued_failure_after_explicit_close_cannot_clean_a_new_session() {
    let session = Arc::new(Mutex::new(SerialSession::default()));
    let (failures, receiver) = mpsc::channel();
    let (first, old_shared) = fake_connection("old");
    old_shared.lock().unwrap().read_error = Some(io::ErrorKind::BrokenPipe);
    let old_token = attach(&session, first, failures.clone(), |_| Ok(()));
    let queued = receiver.recv_timeout(Duration::from_secs(2)).unwrap();
    session.lock().unwrap().stop().unwrap();
    session.lock().unwrap().stop().unwrap();
    assert_eq!(old_shared.lock().unwrap().drops, 2);
    let (next, new_shared) = fake_connection("new");
    let new_token = attach(&session, next, failures.clone(), |_| Ok(()));
    let before = session.lock().unwrap().snapshot();
    assert!(!Arc::ptr_eq(&old_token, &new_token));
    let (events, notifications) = mpsc::channel();
    let supervisor = spawn_failure_supervisor(session.clone(), receiver, move |snapshot| {
        events.send(snapshot).unwrap();
    })
    .unwrap();
    failures.send(queued).unwrap();
    failures
        .send(SessionFailure::Fatal {
            running: old_token,
            error: "late old error".into(),
        })
        .unwrap();
    barrier(&failures);
    assert!(notifications.try_recv().is_err());
    let after = session.lock().unwrap().snapshot();
    assert!(after.connected);
    assert_eq!(before.session_id, after.session_id);
    assert_eq!(before.revision, after.revision);
    assert!(new_token.load(Ordering::Acquire));
    assert_eq!(new_shared.lock().unwrap().drops, 0);
    session.lock().unwrap().stop().unwrap();
    failures.send(SessionFailure::Shutdown).unwrap();
    supervisor.join().unwrap();
}

#[test]
fn receiver_panic_is_reported_and_reaped_without_holding_the_session_lock() {
    let session = Arc::new(Mutex::new(SerialSession::default()));
    let (failures, receiver) = mpsc::channel();
    let (events, notifications) = mpsc::channel();
    let supervisor = spawn_failure_supervisor(session.clone(), receiver, move |snapshot| {
        events.send(snapshot).unwrap();
    })
    .unwrap();
    let (connection, shared) = fake_connection("panic");
    shared.lock().unwrap().input.push_back(42);
    attach(&session, connection, failures.clone(), |_| {
        panic!("simulated receiver panic")
    });
    let lost = notifications.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(!lost.connected);
    assert!(lost.error.unwrap().contains("Thread Serial"));
    assert_eq!(shared.lock().unwrap().drops, 2);
    session.lock().unwrap().stop().unwrap();
    failures.send(SessionFailure::Shutdown).unwrap();
    supervisor.join().unwrap();
}

#[test]
fn transient_native_errors_do_not_end_a_session() {
    for kind in [
        io::ErrorKind::TimedOut,
        io::ErrorKind::WouldBlock,
        io::ErrorKind::Interrupted,
    ] {
        assert!(transient_error(&io::Error::from(kind)));
    }
    assert!(!transient_error(&io::Error::from(
        io::ErrorKind::BrokenPipe
    )));
}
