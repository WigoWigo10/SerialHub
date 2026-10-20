//! Append-only diagnostic log: raw RX, accepted TX with the legacy TX marker.
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::Path;

#[derive(Clone, Debug, Serialize)]
pub struct RecordingSnapshot {
    pub revision: u64,
    pub recording: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct SerialRecording {
    writer: Option<Box<dyn Write + Send>>,
    revision: u64,
    path: Option<String>,
    error: Option<String>,
}

impl SerialRecording {
    pub fn snapshot(&self) -> RecordingSnapshot {
        RecordingSnapshot {
            revision: self.revision,
            recording: self.writer.is_some(),
            path: self.path.clone(),
            error: self.error.clone(),
        }
    }

    pub fn start_file(&mut self, path: &Path) -> Result<(), String> {
        if self.writer.is_some() {
            return Err("Gravação já iniciada; encerre antes de escolher outro arquivo".into());
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| format!("Falha ao abrir gravação: {error}"))?;
        self.start_writer(path.to_string_lossy().into_owned(), Box::new(file))
    }

    fn start_writer(&mut self, path: String, writer: Box<dyn Write + Send>) -> Result<(), String> {
        if self.writer.is_some() {
            return Err("Gravação já iniciada".into());
        }
        self.writer = Some(writer);
        self.path = Some(path);
        self.error = None;
        self.revision += 1;
        Ok(())
    }

    fn append(
        &mut self,
        write: impl FnOnce(&mut dyn Write) -> io::Result<()>,
    ) -> Result<(), String> {
        let Some(writer) = self.writer.as_mut() else {
            return Ok(());
        };
        if let Err(error) = write(writer.as_mut()).and_then(|()| writer.flush()) {
            // Do not keep claiming recording after a failure, and never retry a
            // packet whose prefix may already be in the append-only file.
            self.writer.take();
            self.revision += 1;
            let message =
                format!("Gravação interrompida: {error}. O arquivo pode conter um trecho parcial.");
            self.error = Some(message.clone());
            return Err(message);
        }
        Ok(())
    }

    pub fn rx(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.append(|writer| writer.write_all(bytes))
    }

    pub fn tx(&mut self, accepted: &[u8]) -> Result<(), String> {
        if accepted.is_empty() {
            return Ok(());
        }
        self.append(|writer| {
            writer.write_all(b"\n>>> [TX] ")?;
            writer.write_all(accepted)?;
            if !accepted.ends_with(b"\n") {
                writer.write_all(b"\n")?;
            }
            Ok(())
        })
    }

    pub fn finish(&mut self) -> Result<(), String> {
        let Some(mut writer) = self.writer.take() else {
            return Ok(());
        };
        self.revision += 1;
        let result = writer.flush();
        drop(writer); // closed before the command confirms completion
        self.error = result
            .err()
            .map(|error| format!("Falha ao finalizar gravação: {error}"));
        match &self.error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

impl Drop for SerialRecording {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

pub struct Transfer {
    pub accepted: usize,
    pub error: Option<io::Error>,
}

/// Track the exact accepted prefix even when an error follows a partial write.
pub fn transmit(writer: &mut impl Write, bytes: &[u8]) -> Transfer {
    let mut accepted = 0;
    while accepted < bytes.len() {
        match writer.write(&bytes[accepted..]) {
            Ok(0) => {
                return Transfer {
                    accepted,
                    error: Some(io::ErrorKind::WriteZero.into()),
                }
            }
            Ok(count) if count <= bytes.len() - accepted => accepted += count,
            Ok(_) => {
                return Transfer {
                    accepted,
                    error: Some(io::ErrorKind::InvalidData.into()),
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                return Transfer {
                    accepted,
                    error: Some(error),
                }
            }
        }
    }
    Transfer {
        accepted,
        error: None,
    }
}

pub fn transmit_reported(
    writer: &mut impl Write,
    bytes: &[u8],
    accepted: impl FnOnce(&[u8]),
) -> Transfer {
    let transfer = transmit(writer, bytes);
    if transfer.accepted > 0 {
        accepted(&bytes[..transfer.accepted]);
    }
    transfer
}

#[cfg(test)]
mod tests;
