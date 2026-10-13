use serialhub_core::{SerialConfig, SerialConnection};
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub(crate) const READ_TIMEOUT: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MonitorArgs {
    pub port: String,
    pub baud: u32,
    pub duration: Option<Duration>,
}

#[derive(Debug, PartialEq, Eq)]
enum End {
    Duration,
    Interrupted,
}

trait Clock {
    fn now(&self) -> Duration;
    fn sleep(&mut self, duration: Duration);
}

struct MonotonicClock(Instant);
impl Clock for MonotonicClock {
    fn now(&self) -> Duration {
        self.0.elapsed()
    }
    fn sleep(&mut self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

pub(crate) fn run(args: &MonitorArgs, out: &mut impl Write, err: &mut impl Write) -> u8 {
    let cancelled = Arc::new(AtomicBool::new(false));
    let signal_flag = cancelled.clone();
    if let Err(error) = ctrlc::set_handler(move || signal_flag.store(true, Ordering::Release)) {
        let _ = writeln!(err, "serialhub: Falha ao instalar Ctrl+C: {error}");
        return 1;
    }
    run_with_connection(
        args,
        &cancelled,
        out,
        err,
        &mut MonotonicClock(Instant::now()),
        |config| SerialConnection::open(config).map_err(|error| error.to_string()),
    )
}

// Only the core opens/configures the real port. The factory and clock provide
// deterministic test seams; production does not clone or write to the port.
fn run_with_connection<R: Read, C: Clock>(
    args: &MonitorArgs,
    cancelled: &AtomicBool,
    out: &mut impl Write,
    err: &mut impl Write,
    clock: &mut C,
    open: impl FnOnce(&SerialConfig) -> Result<R, String>,
) -> u8 {
    if cancelled.load(Ordering::Acquire) {
        return 130;
    }
    let mut config = SerialConfig::new(&args.port, args.baud);
    config.timeout = READ_TIMEOUT;
    if writeln!(
        err,
        "serialhub: Abrindo {} a {} baud, 8N1, sem controle de fluxo.",
        args.port, args.baud
    )
    .is_err()
    {
        return 1;
    }
    let connection = match open(&config) {
        Ok(connection) => connection,
        Err(error) => {
            if cancelled.load(Ordering::Acquire) {
                return 130;
            }
            let _ = writeln!(err, "serialhub: Falha ao abrir porta: {error}");
            return 1;
        }
    };
    if writeln!(
        err,
        "serialhub: Recebendo bytes; Ctrl+C encerra. DTR/RTS seguem o driver."
    )
    .is_err()
    {
        return 1; // owned connection is dropped on every return path
    }
    // Duration begins after a successful open, not during driver initialization.
    let result = receive(connection, out, cancelled, args.duration, clock);
    match result {
        Ok(End::Duration) => {
            let _ = writeln!(err, "serialhub: Duração encerrada; conexão liberada.");
            0
        }
        Ok(End::Interrupted) => {
            let _ = writeln!(err, "serialhub: Ctrl+C; conexão liberada.");
            130
        }
        Err(error) => {
            let _ = writeln!(err, "serialhub: Falha no monitor: {error}");
            1
        }
    }
}

fn receive<R: Read, C: Clock>(
    mut connection: R,
    out: &mut impl Write,
    cancelled: &AtomicBool,
    duration: Option<Duration>,
    clock: &mut C,
) -> io::Result<End> {
    let start = clock.now();
    let mut buffer = [0; 1024];
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Ok(End::Interrupted);
        }
        if duration.is_some_and(|limit| clock.now().saturating_sub(start) >= limit) {
            return Ok(End::Duration);
        }
        let read_start = clock.now();
        let result = connection.read(&mut buffer);
        if cancelled.load(Ordering::Acquire) {
            return Ok(End::Interrupted);
        }
        // A real transport failure remains operational failure even if the
        // deadline elapsed during that read. Ctrl+C takes precedence above.
        let result = match result {
            Err(error) if !is_transient(&error) => return Err(error),
            other => other,
        };
        let received = match result {
            Ok(count) if count > 0 => {
                out.write_all(&buffer[..count])?;
                out.flush()?;
                true
            }
            Ok(_) => false,  // a driver returning zero must not cause a busy loop
            Err(_) => false, // transient errors were classified above
        };
        // Preserve a completed read even when the deadline elapsed during it.
        // Then stop before another read; cancellation intentionally does not drain.
        if duration.is_some_and(|limit| clock.now().saturating_sub(start) >= limit) {
            return Ok(End::Duration);
        }
        if received {
            continue;
        }
        // Native reads normally wait for the core's 50 ms timeout. If a driver
        // returns early, wait out the remaining idle interval (capped by duration).
        let mut idle = READ_TIMEOUT.saturating_sub(clock.now().saturating_sub(read_start));
        if let Some(limit) = duration {
            idle = idle.min(limit.saturating_sub(clock.now().saturating_sub(start)));
        }
        if !idle.is_zero() {
            clock.sleep(idle);
        }
    }
}

fn is_transient(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

#[cfg(test)]
mod tests;
