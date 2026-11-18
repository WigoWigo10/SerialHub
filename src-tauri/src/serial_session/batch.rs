use super::read_loop;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

const QUEUED_READS: usize = 32;
const MAX_BATCH_BYTES: usize = 4096;
const MAX_BATCH_AGE: Duration = Duration::from_millis(16);

pub(super) fn run(
    reader: impl Read,
    running: &AtomicBool,
    mut record: impl FnMut(&[u8]),
    emit: impl FnMut(&[u8]) -> Result<(), String> + Send,
) -> Result<(), String> {
    thread::scope(|scope| {
        let (sender, receiver) = mpsc::sync_channel(QUEUED_READS);
        let emitter = thread::Builder::new()
            .name("serial-rx-events".into())
            .spawn_scoped(scope, move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    emit_batches(receiver, MAX_BATCH_BYTES, MAX_BATCH_AGE, emit)
                }))
                .unwrap_or_else(|_| Err("Thread Serial de eventos encerrada com falha".into()));
                if result.is_err() {
                    running.store(false, Ordering::Release);
                }
                result
            })
            .map_err(|error| format!("Falha ao iniciar eventos Serial: {error}"))?;

        let read_result = read_loop(reader, running, |bytes| {
            record(bytes);
            // Backpressure on the reader rather than silently dropping reads.
            sender
                .send(bytes.to_vec())
                .map_err(|_| "Canal de eventos Serial encerrado".into())
        });
        // The receiver drains accepted reads and flushes the tail before stop joins us.
        drop(sender);
        let emit_result = emitter
            .join()
            .unwrap_or_else(|_| Err("Thread Serial de eventos encerrada com falha".into()));
        emit_result.and(read_result)
    })
}

fn emit_batches(
    receiver: Receiver<Vec<u8>>,
    max_bytes: usize,
    max_age: Duration,
    mut emit: impl FnMut(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut batch = Vec::with_capacity(max_bytes);
    while let Ok(mut bytes) = receiver.recv() {
        let mut deadline = Instant::now() + max_age;
        loop {
            let mut remaining = bytes.as_slice();
            while !remaining.is_empty() {
                let take = remaining.len().min(max_bytes - batch.len());
                let (head, tail) = remaining.split_at(take);
                batch.extend_from_slice(head);
                remaining = tail;
                if batch.len() == max_bytes {
                    emit(&batch)?;
                    batch.clear();
                    deadline = Instant::now() + max_age;
                }
            }

            if batch.is_empty() {
                break;
            }
            let wait = deadline.saturating_duration_since(Instant::now());
            if !wait.is_zero() {
                if let Ok(next) = receiver.recv_timeout(wait) {
                    bytes = next;
                    continue;
                }
            }
            // Timeout and disconnection both flush the nonempty tail.
            emit(&batch)?;
            batch.clear();
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_reads_without_gaps_and_flushes_tail_on_close() {
        let (tx, rx) = mpsc::channel();
        tx.send(vec![0, 255]).unwrap();
        tx.send(vec![128, 10, 13, 1]).unwrap();
        tx.send(vec![2]).unwrap();
        drop(tx);
        let mut emitted = Vec::new();
        emit_batches(rx, 3, Duration::from_secs(60), |bytes| {
            emitted.push(bytes.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(emitted, [vec![0, 255, 128], vec![10, 13, 1], vec![2]]);
    }

    #[test]
    fn sparse_data_is_emitted_without_waiting_for_another_read() {
        let (tx, rx) = mpsc::channel();
        let (events, captured) = mpsc::channel();
        let worker = thread::spawn(move || {
            emit_batches(rx, 4096, Duration::from_millis(16), |bytes| {
                events.send(bytes.to_vec()).unwrap();
                Ok(())
            })
            .unwrap();
        });
        tx.send(vec![0, 255]).unwrap();
        assert_eq!(
            captured.recv_timeout(Duration::from_secs(1)).unwrap(),
            [0, 255]
        );
        drop(tx);
        worker.join().unwrap();
        assert!(captured.try_recv().is_err());
    }

    #[test]
    fn fatal_read_still_delivers_bytes_already_recorded() {
        struct FailingReader(Option<[u8; 4]>);
        impl Read for FailingReader {
            fn read(&mut self, target: &mut [u8]) -> std::io::Result<usize> {
                let bytes = self.0.take().ok_or(std::io::ErrorKind::BrokenPipe)?;
                target[..bytes.len()].copy_from_slice(&bytes);
                Ok(bytes.len())
            }
        }

        let bytes = [0, 255, 128, 10];
        let mut recorded = Vec::new();
        let mut emitted = Vec::new();
        let error = run(
            FailingReader(Some(bytes)),
            &AtomicBool::new(true),
            |read| recorded.extend_from_slice(read),
            |batch| {
                emitted.extend_from_slice(batch);
                Ok(())
            },
        )
        .unwrap_err();
        assert_eq!(
            error,
            std::io::Error::from(std::io::ErrorKind::BrokenPipe).to_string()
        );
        assert_eq!(recorded, bytes);
        assert_eq!(emitted, bytes);
    }
}
