use super::*;
use serialhub_core::{DataBits, FlowControl, Parity, StopBits};
use std::cell::Cell;
use std::collections::VecDeque;
use std::rc::Rc;

struct FakeClock {
    time: Rc<Cell<Duration>>,
    sleeps: Vec<Duration>,
    cancel_on_sleep: Option<Arc<AtomicBool>>,
}

impl FakeClock {
    fn new() -> Self {
        Self {
            time: Rc::new(Cell::new(Duration::ZERO)),
            sleeps: vec![],
            cancel_on_sleep: None,
        }
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Duration {
        self.time.get()
    }
    fn sleep(&mut self, duration: Duration) {
        self.sleeps.push(duration);
        self.time.set(self.time.get() + duration);
        if let Some(flag) = &self.cancel_on_sleep {
            flag.store(true, Ordering::Release);
        }
    }
}

enum Action {
    Bytes(Vec<u8>),
    BytesAfter(Vec<u8>, Duration),
    Timeout(Duration),
    Zero,
    Fail(io::ErrorKind),
    Cancel(Arc<AtomicBool>),
}

// Read-only on purpose: a regression adding serial transmission cannot compile
// against this source. Dropping it represents release of the owned connection.
struct Source {
    actions: VecDeque<Action>,
    time: Rc<Cell<Duration>>,
    released: Arc<AtomicBool>,
}

fn source(clock: &FakeClock, actions: Vec<Action>) -> (Source, Arc<AtomicBool>) {
    let released = Arc::new(AtomicBool::new(false));
    (
        Source {
            actions: actions.into(),
            time: clock.time.clone(),
            released: released.clone(),
        },
        released,
    )
}

impl Drop for Source {
    fn drop(&mut self) {
        self.released.store(true, Ordering::Release);
    }
}

impl Read for Source {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self
            .actions
            .pop_front()
            .unwrap_or(Action::Timeout(Duration::ZERO))
        {
            Action::Bytes(bytes) => {
                assert!(bytes.len() <= buf.len());
                buf[..bytes.len()].copy_from_slice(&bytes);
                Ok(bytes.len())
            }
            Action::BytesAfter(bytes, elapsed) => {
                self.time.set(self.time.get() + elapsed);
                assert!(bytes.len() <= buf.len());
                buf[..bytes.len()].copy_from_slice(&bytes);
                Ok(bytes.len())
            }
            Action::Timeout(elapsed) => {
                self.time.set(self.time.get() + elapsed);
                Err(io::Error::new(io::ErrorKind::TimedOut, "idle"))
            }
            Action::Zero => Ok(0),
            Action::Fail(kind) => Err(io::Error::new(kind, "simulated read failure")),
            Action::Cancel(flag) => {
                flag.store(true, Ordering::Release);
                Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "Ctrl+C simulated",
                ))
            }
        }
    }
}

fn args(duration: Option<Duration>) -> MonitorArgs {
    MonitorArgs {
        port: "simulated".into(),
        baud: 115200,
        duration,
    }
}

#[test]
fn raw_binary_and_newlines_reach_stdout_without_status_text() {
    let mut clock = FakeClock::new();
    let (input, released) = source(
        &clock,
        vec![
            Action::Bytes(vec![0, 0xff, 0x80, 13]),
            Action::Bytes(vec![10, 0x1b, b'A']),
        ],
    );
    let mut out = Vec::new();
    let mut err = Vec::new();
    let code = run_with_connection(
        &args(Some(READ_TIMEOUT)),
        &AtomicBool::new(false),
        &mut out,
        &mut err,
        &mut clock,
        |config| {
            assert_eq!(config.port_name, "simulated");
            assert_eq!(config.baud_rate, 115200);
            assert_eq!(config.data_bits, DataBits::Eight);
            assert_eq!(config.stop_bits, StopBits::One);
            assert_eq!(config.parity, Parity::None);
            assert_eq!(config.flow_control, FlowControl::None);
            assert_eq!(config.timeout, READ_TIMEOUT);
            Ok(input)
        },
    );
    assert_eq!(code, 0);
    assert_eq!(out, [0, 0xff, 0x80, 13, 10, 0x1b, b'A']);
    assert!(!err.is_empty());
    assert!(released.load(Ordering::Acquire));
}

#[test]
fn immediate_timeouts_sleep_and_stop_at_monotonic_duration() {
    let mut clock = FakeClock::new();
    let (input, released) = source(&clock, vec![]);
    let mut out = Vec::new();
    assert_eq!(
        receive(
            input,
            &mut out,
            &AtomicBool::new(false),
            Some(Duration::from_millis(120)),
            &mut clock
        )
        .unwrap(),
        End::Duration
    );
    assert_eq!(
        clock.sleeps,
        [READ_TIMEOUT, READ_TIMEOUT, Duration::from_millis(20)]
    );
    assert_eq!(clock.now(), Duration::from_millis(120));
    assert!(out.is_empty());
    assert!(released.load(Ordering::Acquire));
}

#[test]
fn blocking_timeout_does_not_add_another_idle_wait() {
    let mut clock = FakeClock::new();
    let (input, _) = source(
        &clock,
        vec![Action::Timeout(READ_TIMEOUT), Action::Timeout(READ_TIMEOUT)],
    );
    assert_eq!(
        receive(
            input,
            &mut Vec::new(),
            &AtomicBool::new(false),
            Some(READ_TIMEOUT * 2),
            &mut clock
        )
        .unwrap(),
        End::Duration
    );
    assert!(clock.sleeps.is_empty());
}

#[test]
fn zero_reads_also_wait_instead_of_spinning() {
    let mut clock = FakeClock::new();
    let (input, _) = source(&clock, vec![Action::Zero]);
    assert_eq!(
        receive(
            input,
            &mut Vec::new(),
            &AtomicBool::new(false),
            Some(READ_TIMEOUT),
            &mut clock
        )
        .unwrap(),
        End::Duration
    );
    assert_eq!(clock.sleeps, [READ_TIMEOUT]);
}

#[test]
fn duration_preserves_the_last_completed_read_before_releasing_connection() {
    let mut clock = FakeClock::new();
    let (input, released) = source(
        &clock,
        vec![
            Action::BytesAfter(vec![0xff, 0, 10], READ_TIMEOUT),
            Action::Bytes(vec![b'X']),
        ],
    );
    let mut out = Vec::new();
    assert_eq!(
        receive(
            input,
            &mut out,
            &AtomicBool::new(false),
            Some(READ_TIMEOUT),
            &mut clock
        )
        .unwrap(),
        End::Duration
    );
    assert_eq!(out, [0xff, 0, 10]);
    assert!(released.load(Ordering::Acquire));
}

#[test]
fn cancellation_during_read_returns_130_and_releases_connection() {
    let mut clock = FakeClock::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    let (input, released) = source(&clock, vec![Action::Cancel(cancelled.clone())]);
    let mut out = Vec::new();
    let mut err = Vec::new();
    assert_eq!(
        run_with_connection(
            &args(None),
            &cancelled,
            &mut out,
            &mut err,
            &mut clock,
            |_| Ok(input)
        ),
        130
    );
    assert!(out.is_empty());
    assert!(released.load(Ordering::Acquire));
    assert!(String::from_utf8(err).unwrap().contains("Ctrl+C"));
}

#[test]
fn cancellation_during_idle_wait_stops_before_next_read() {
    let mut clock = FakeClock::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    clock.cancel_on_sleep = Some(cancelled.clone());
    let (input, released) = source(&clock, vec![Action::Zero, Action::Bytes(vec![b'X'])]);
    let mut out = Vec::new();
    assert_eq!(
        receive(input, &mut out, &cancelled, None, &mut clock).unwrap(),
        End::Interrupted
    );
    assert!(out.is_empty());
    assert!(released.load(Ordering::Acquire));
}

#[test]
fn open_and_read_failures_are_stderr_only_with_code_one() {
    let mut clock = FakeClock::new();
    let mut out = Vec::new();
    let mut err = Vec::new();
    let flag = AtomicBool::new(false);
    assert_eq!(
        run_with_connection::<Source, _>(
            &args(None),
            &flag,
            &mut out,
            &mut err,
            &mut clock,
            |_| Err("no device".into())
        ),
        1
    );
    assert!(out.is_empty());
    assert!(String::from_utf8_lossy(&err).contains("no device"));
    let (input, released) = source(&clock, vec![Action::Fail(io::ErrorKind::PermissionDenied)]);
    err.clear();
    assert_eq!(
        run_with_connection(&args(None), &flag, &mut out, &mut err, &mut clock, |_| Ok(
            input
        )),
        1
    );
    assert!(out.is_empty());
    assert!(String::from_utf8_lossy(&err).contains("simulated read failure"));
    assert!(released.load(Ordering::Acquire));
}

#[test]
fn output_failures_release_connection_and_return_one() {
    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed stdout"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut clock = FakeClock::new();
    let (input, released) = source(&clock, vec![Action::Bytes(vec![0xff])]);
    let mut err = Vec::new();
    assert_eq!(
        run_with_connection(
            &args(None),
            &AtomicBool::new(false),
            &mut Broken,
            &mut err,
            &mut clock,
            |_| Ok(input)
        ),
        1
    );
    assert!(released.load(Ordering::Acquire));
    assert!(String::from_utf8_lossy(&err).contains("closed stdout"));
}

#[test]
fn already_cancelled_monitor_does_not_open_a_port() {
    assert_eq!(
        run_with_connection::<Source, _>(
            &args(None),
            &AtomicBool::new(true),
            &mut Vec::new(),
            &mut Vec::new(),
            &mut FakeClock::new(),
            |_| panic!("must not open")
        ),
        130
    );
}
