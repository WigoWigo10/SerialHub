use crate::serial_session::{spawn_reader, transient_error, ConnectionSnapshot, SessionFailure};
use crate::SerialState;
use serialhub_core::{
    DataBits, FlowControl, Parity, SerialConfig, SerialConnection, SerialPortInfo, StopBits,
};
use std::fs::OpenOptions;
use std::io::Read;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};

#[command]
pub fn list_ports() -> Result<Vec<SerialPortInfo>, String> {
    serialhub_core::list_ports().map_err(|e| format!("Erro: {}", e))
}

#[command]
pub fn open_port(
    app: AppHandle,
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    flow_control: String,
    parity: String,
    stop_bits: u8,
    state: State<'_, SerialState>,
) -> Result<String, String> {
    let mut session = state.session.lock().map_err(|_| "Lock fail")?;
    let stopped = session.stop();
    let _ = app.emit("serial-connection-state", session.snapshot());
    stopped?;

    println!("Conectando a {}...", port_name);
    let config = gui_config(
        port_name.clone(),
        baud_rate,
        data_bits,
        &flow_control,
        &parity,
        stop_bits,
    );
    let mut port = SerialConnection::open(&config).map_err(|e| format!("Falha ao abrir: {}", e))?;
    let _ = port.clear_input();
    let port_clone = port.try_clone().map_err(|e| e.to_string())?;
    // Preserve the existing best-effort suppression of DTR/RTS on connect.
    let _ = port.set_dtr(false);
    let _ = port.set_rts(false);
    let keep_running = session.start(port, port_name.clone())?;
    let log_file_arc = state.log_file.clone();
    let reader_app = app.clone();
    let worker = spawn_reader(
        port_clone,
        keep_running,
        state.failures.clone(),
        move |data| {
            if let Ok(mut lock) = log_file_arc.lock() {
                if let Some(file) = lock.as_mut() {
                    let _ = file.write_all(data);
                    let _ = file.flush();
                }
            }
            reader_app
                .emit("serial-data", data)
                .map_err(|error| error.to_string())
        },
    );
    match worker {
        Ok(worker) => session.workers.push(worker),
        Err(error) => {
            let stopped = session.stop();
            let _ = app.emit("serial-connection-state", session.snapshot());
            stopped?;
            return Err(format!("Falha ao iniciar leitura: {}", error));
        }
    }
    let _ = app.emit("serial-connection-state", session.snapshot());
    Ok(format!("Conectado a {}", port_name))
}

// Keep the GUI's previous fallback rules at the presentation boundary.
fn gui_config(
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    flow_control: &str,
    parity: &str,
    stop_bits: u8,
) -> SerialConfig {
    let mut config = SerialConfig::new(port_name, baud_rate);
    config.data_bits = match data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    config.parity = match parity {
        "Odd" => Parity::Odd,
        "Even" => Parity::Even,
        _ => Parity::None,
    };
    config.stop_bits = if stop_bits == 2 {
        StopBits::Two
    } else {
        StopBits::One
    };
    config.flow_control = if flow_control == "Hardware" {
        FlowControl::Hardware
    } else {
        FlowControl::None
    };
    config
}

#[command]
pub fn close_port(app: AppHandle, state: State<'_, SerialState>) -> Result<String, String> {
    let mut session = state.session.lock().map_err(|_| "Lock fail")?;
    let stopped = session.stop();
    let _ = app.emit("serial-connection-state", session.snapshot());
    stopped?;

    println!("Desconectado.");
    Ok("Desconectado.".to_string())
}

#[command]
pub fn serial_connection_state(
    state: State<'_, SerialState>,
) -> Result<ConnectionSnapshot, String> {
    Ok(state.session.lock().map_err(|_| "Lock fail")?.snapshot())
}

#[command]
pub fn write_serial(
    app: AppHandle,
    content: String,
    state: State<'_, SerialState>,
) -> Result<usize, String> {
    let mut port_guard = state.session.lock().map_err(|e| e.to_string())?;

    if let Some(port) = port_guard.connection.as_mut() {
        let bytes = content.as_bytes();
        match port.write(bytes) {
            Ok(size) => {
                if let Ok(mut lock) = state.log_file.lock() {
                    if let Some(file) = lock.as_mut() {
                        let _ = file.write_all(b"\n>>> [TX] ");

                        let _ = file.write_all(bytes);

                        if !bytes.ends_with(b"\n") {
                            let _ = file.write_all(b"\n");
                        }

                        let _ = file.flush();
                    }
                }

                let _ = app.emit("serial-tx", size);

                let _ = app.emit("serial-sent", bytes.to_vec());

                Ok(size)
            }
            Err(e) => {
                if !transient_error(&e) {
                    let _ = state.failures.send(SessionFailure::Fatal {
                        running: port_guard.running.clone(),
                        error: e.to_string(),
                    });
                }
                Err(format!("Erro escrita: {}", e))
            }
        }
    } else {
        Err("Porta fechada".to_string())
    }
}

#[command]
pub fn set_control_pin(
    pin: String,
    active: bool,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    let mut state_port = state.session.lock().map_err(|_| "Falha no Lock")?;

    if let Some(port) = state_port.connection.as_mut() {
        let result = match pin.as_str() {
            "DTR" => port.set_dtr(active),
            "RTS" => port.set_rts(active),
            _ => Err(serialport::Error::new(
                serialport::ErrorKind::InvalidInput,
                "Pino inválido",
            )),
        };
        match result {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Erro pino: {}", e)),
        }
    } else {
        Err("Porta fechada".to_string())
    }
}

#[command]
pub fn start_recording(file_path: String, state: State<'_, SerialState>) -> Result<(), String> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|e| e.to_string())?;

    let mut log_lock = state.log_file.lock().map_err(|_| "Lock fail")?;
    *log_lock = Some(file);

    println!("Gravando em: {}", file_path);
    Ok(())
}

#[command]
pub fn stop_recording(state: State<'_, SerialState>) -> Result<(), String> {
    let mut log_lock = state.log_file.lock().map_err(|_| "Lock fail")?;
    *log_lock = None;
    println!("Gravação parada.");
    Ok(())
}

#[allow(dead_code)]
#[command]
pub fn start_spy_bridge(
    app: AppHandle,
    port_a_name: String,
    port_b_name: String,
    baud_rate: u32,
    state: State<'_, SerialState>,
) -> Result<String, String> {
    let mut session = state.session.lock().map_err(|_| "Lock fail")?;
    session.stop()?;
    let mut config_a = SerialConfig::new(port_a_name, baud_rate);
    config_a.timeout = Duration::from_millis(10);
    let mut config_b = SerialConfig::new(port_b_name, baud_rate);
    config_b.timeout = Duration::from_millis(10);
    let port_a = SerialConnection::open(&config_a).map_err(|e| format!("Falha porta A: {}", e))?;
    let port_b = SerialConnection::open(&config_b).map_err(|e| format!("Falha porta B: {}", e))?;
    let mut port_a_read = port_a.try_clone().map_err(|e| e.to_string())?;
    let mut port_b_write = port_b.try_clone().map_err(|e| e.to_string())?;
    let mut port_b_read = port_b.try_clone().map_err(|e| e.to_string())?;
    let mut port_a_write = port_a.try_clone().map_err(|e| e.to_string())?;
    let keep_running = session.start(port_a, config_a.port_name.clone())?;

    let app_handle1 = app.clone();
    let keep_running1 = keep_running.clone();

    session.workers.push(thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            if !keep_running1.load(Ordering::Acquire) {
                break;
            }

            if let Ok(n) = port_a_read.read(&mut buf) {
                if !keep_running1.load(Ordering::Acquire) {
                    break;
                }
                if n > 0 {
                    let data = &buf[..n];
                    let _ = app_handle1.emit("spy-data-a", data);
                    let _ = port_b_write.write_all(data);
                }
            }
        }
    }));

    let app_handle2 = app.clone();
    let keep_running2 = keep_running.clone();

    session.workers.push(thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            if !keep_running2.load(Ordering::Acquire) {
                break;
            }

            if let Ok(n) = port_b_read.read(&mut buf) {
                if !keep_running2.load(Ordering::Acquire) {
                    break;
                }
                if n > 0 {
                    let data = &buf[..n];
                    let _ = app_handle2.emit("spy-data-b", data);
                    let _ = port_a_write.write_all(data);
                }
            }
        }
    }));

    Ok("Spy Mode Iniciado".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_config_preserves_supported_settings() {
        let config = gui_config("fake".into(), 57600, 7, "Hardware", "Even", 2);
        assert_eq!(config.port_name, "fake");
        assert_eq!(config.baud_rate, 57600);
        assert_eq!(config.data_bits, DataBits::Seven);
        assert_eq!(config.flow_control, FlowControl::Hardware);
        assert_eq!(config.parity, Parity::Even);
        assert_eq!(config.stop_bits, StopBits::Two);
        assert_eq!(config.timeout, Duration::from_millis(50));
        assert_eq!(
            gui_config("fake".into(), 9600, 5, "None", "Odd", 1).data_bits,
            DataBits::Five
        );
        assert_eq!(
            gui_config("fake".into(), 9600, 6, "None", "Odd", 1).data_bits,
            DataBits::Six
        );
        assert_eq!(
            gui_config("fake".into(), 9600, 8, "None", "Odd", 1).parity,
            Parity::Odd
        );
    }

    #[test]
    fn gui_config_keeps_existing_fallbacks_for_unrecognized_inputs() {
        let config = gui_config("fake".into(), 115200, 0, "Software", "unknown", 0);
        assert_eq!(config.data_bits, DataBits::Eight);
        assert_eq!(config.flow_control, FlowControl::None);
        assert_eq!(config.parity, Parity::None);
        assert_eq!(config.stop_bits, StopBits::One);
    }
}
