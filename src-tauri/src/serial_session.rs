//! Backend-only ownership and cancellation of serial reader threads.
use serde::Serialize;
use serialhub_core::SerialConnection;
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{mpsc, Mutex};
use std::thread::JoinHandle;

#[derive(Default)]
pub struct SerialSession {
    pub connection: Option<SerialConnection>,
    pub running: Arc<AtomicBool>,
    pub workers: Vec<JoinHandle<()>>,
    revision: u64,
    session_id: u64,
    port_name: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ConnectionSnapshot {
    pub revision: u64,
    pub session_id: u64,
    pub connected: bool,
    pub port_name: Option<String>,
    pub error: Option<String>,
}

pub enum SessionFailure {
    Fatal {
        running: Arc<AtomicBool>,
        error: String,
    },
    Shutdown,
    #[cfg(test)]
    Barrier(mpsc::Sender<()>),
}

impl SerialSession {
    pub fn start(
        &mut self,
        connection: SerialConnection,
        port_name: String,
    ) -> Result<Arc<AtomicBool>, String> {
        self.stop()?;
        self.running = Arc::new(AtomicBool::new(true));
        self.connection = Some(connection);
        self.port_name = Some(port_name);
        self.error = None;
        self.revision += 1;
        self.session_id += 1;
        Ok(self.running.clone())
    }

    pub fn snapshot(&self) -> ConnectionSnapshot {
        ConnectionSnapshot {
            revision: self.revision,
            session_id: self.session_id,
            connected: self.connection.is_some(),
            port_name: self.port_name.clone(),
            error: self.error.clone(),
        }
    }

    pub fn fail_if_current(
        &mut self,
        running: &Arc<AtomicBool>,
        error: String,
    ) -> Option<ConnectionSnapshot> {
        if !Arc::ptr_eq(&self.running, running) || self.connection.is_none() {
            return None;
        }
        let stopped = self.stop();
        self.error = Some(match stopped {
            Ok(()) => error,
            Err(join_error) => format!("{error}; {join_error}"),
        });
        Some(self.snapshot())
    }

    /// Call while holding the session mutex. Workers must not lock that mutex.
    /// Cancellation is checked after reads too, preventing late GUI events.
    pub fn stop(&mut self) -> Result<(), String> {
        let changed =
            self.connection.is_some() || !self.workers.is_empty() || self.port_name.is_some();
        self.running.store(false, Ordering::Release);
        let mut panicked = false;
        for worker in self.workers.drain(..) {
            if worker.join().is_err() {
                panicked = true;
            }
        }
        self.connection.take();
        self.port_name = None;
        if changed {
            self.revision += 1;
            self.error = None;
        }
        if panicked {
            Err("Thread Serial encerrada com falha".into())
        } else {
            Ok(())
        }
    }
}

/// A supervisor, never a session worker: safe to join the failed reader here.
/// Notifications are emitted while the session lock still orders transitions.
pub fn spawn_failure_supervisor(
    session: Arc<Mutex<SerialSession>>,
    failures: mpsc::Receiver<SessionFailure>,
    mut notify: impl FnMut(ConnectionSnapshot) + Send + 'static,
) -> io::Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("serial-cleanup".into())
        .spawn(move || {
            while let Ok(message) = failures.recv() {
                match message {
                    SessionFailure::Shutdown => break,
                    #[cfg(test)]
                    SessionFailure::Barrier(done) => {
                        let _ = done.send(());
                    }
                    SessionFailure::Fatal { running, error } => {
                        let mut session = session
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        if let Some(snapshot) = session.fail_if_current(&running, error) {
                            notify(snapshot);
                        }
                    }
                }
            }
        })
}

pub fn transient_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
    )
}

/// The caller owns/drops the clone; only fatal failures reach the supervisor.
pub fn read_loop(
    mut reader: impl Read,
    running: &AtomicBool,
    mut receive: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut buffer = [0u8; 1024];
    while running.load(Ordering::Acquire) {
        let result = reader.read(&mut buffer);
        if !running.load(Ordering::Acquire) {
            break;
        }
        match result {
            Ok(count) if count > 0 => receive(&buffer[..count])?,
            Ok(_) => {}
            Err(error) if transient_error(&error) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub fn spawn_reader(
    reader: SerialConnection,
    running: Arc<AtomicBool>,
    failures: mpsc::Sender<SessionFailure>,
    mut receive: impl FnMut(&[u8]) -> Result<(), String> + Send + 'static,
) -> io::Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("serial-reader".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                read_loop(reader, &running, &mut receive)
            }));
            let error = match result {
                Ok(result) => result.err(),
                Err(_) => Some("Thread Serial encerrada com falha".into()),
            };
            if let Some(error) = error {
                let _ = failures.send(SessionFailure::Fatal {
                    running: running.clone(),
                    error,
                });
            }
            running.store(false, Ordering::Release);
        })
}

impl Drop for SerialSession {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn stop_waits_for_reader_exit_and_is_idempotent() {
        let mut session = SerialSession::default();
        session.running = Arc::new(AtomicBool::new(true));
        let running = session.running.clone();
        let (entered, ready) = mpsc::channel();
        let (exited, done) = mpsc::channel();
        struct ReaderHandle(mpsc::Sender<()>);
        impl Drop for ReaderHandle {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }
        session.workers.push(thread::spawn(move || {
            let _handle = ReaderHandle(exited);
            entered.send(()).unwrap();
            while running.load(Ordering::Acquire) {
                thread::park_timeout(Duration::from_millis(1));
            }
        }));
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        session.stop().unwrap();
        done.try_recv().unwrap();
        assert!(session.workers.is_empty());
        assert!(!session.running.load(Ordering::Acquire));
        session.stop().unwrap();
    }

    #[test]
    fn stop_joins_remaining_workers_even_after_one_panics() {
        let mut session = SerialSession::default();
        let (exited, done) = mpsc::channel();
        session
            .workers
            .push(thread::spawn(|| panic!("simulated reader failure")));
        session
            .workers
            .push(thread::spawn(move || exited.send(()).unwrap()));
        assert!(session.stop().is_err());
        done.try_recv().unwrap();
        assert!(session.workers.is_empty());
        assert!(session.connection.is_none());
    }
}

#[cfg(test)]
mod failure_tests;
