//! Backend-only ownership and cancellation of serial reader threads.
use serialhub_core::SerialConnection;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

#[derive(Default)]
pub struct SerialSession {
    pub connection: Option<SerialConnection>,
    pub running: Arc<AtomicBool>,
    pub workers: Vec<JoinHandle<()>>,
}

impl SerialSession {
    pub fn start(&mut self, connection: SerialConnection) -> Result<Arc<AtomicBool>, String> {
        self.stop()?;
        self.running = Arc::new(AtomicBool::new(true));
        self.connection = Some(connection);
        Ok(self.running.clone())
    }

    /// Call while holding the session mutex. Workers must not lock that mutex.
    /// Cancellation is checked after reads too, preventing late GUI events.
    pub fn stop(&mut self) -> Result<(), String> {
        self.running.store(false, Ordering::Release);
        let mut panicked = false;
        for worker in self.workers.drain(..) {
            if worker.join().is_err() {
                panicked = true;
            }
        }
        self.connection.take();
        if panicked {
            Err("Thread Serial encerrada com falha".into())
        } else {
            Ok(())
        }
    }
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
