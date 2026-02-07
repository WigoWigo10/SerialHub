use crate::SerialState;
use serialport::{available_ports, DataBits, FlowControl, Parity, SerialPortType, StopBits};
use std::fs::OpenOptions;
use std::io::Read;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};

#[derive(serde::Serialize)]
pub struct SerialPortInfo {
    port_name: String,
    port_type: String,
    vid: String,
    pid: String,
    manufacturer: String,
    product: String,
}

#[command]
pub fn list_ports() -> Result<Vec<SerialPortInfo>, String> {
    match available_ports() {
        Ok(ports) => {
            let mut formatted_ports = Vec::new();
            for p in ports {
                let mut p_type = "Native".to_string();
                let mut vid = "".to_string();
                let mut pid = "".to_string();
                let mut manuf = "".to_string();
                let mut prod = "".to_string();

                if let SerialPortType::UsbPort(info) = p.port_type {
                    p_type = "USB".to_string();
                    vid = format!("{:04x}", info.vid);
                    pid = format!("{:04x}", info.pid);
                    manuf = info.manufacturer.unwrap_or_default();
                    prod = info.product.unwrap_or_default();
                }

                formatted_ports.push(SerialPortInfo {
                    port_name: p.port_name,
                    port_type: p_type,
                    vid,
                    pid,
                    manufacturer: manuf,
                    product: prod,
                });
            }
            Ok(formatted_ports)
        }
        Err(e) => Err(format!("Erro: {}", e)),
    }
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
    state.running.store(false, Ordering::Relaxed);
    
    {
        if let Ok(mut lock) = state.port.lock() {
            *lock = None;
        }
    }

    thread::sleep(Duration::from_millis(200)); 

    println!("Conectando a {}...", port_name);

    let d_bits = match data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let p_mode = match parity.as_str() {
        "Odd" => Parity::Odd,
        "Even" => Parity::Even,
        _ => Parity::None,
    };
    let s_bits = match stop_bits {
        2 => StopBits::Two,
        _ => StopBits::One,
    };
    let f_control = match flow_control.as_str() {
        "Hardware" => FlowControl::Hardware,
        _ => FlowControl::None,
    };

    let port_builder = serialport::new(&port_name, baud_rate)
        .data_bits(d_bits)
        .flow_control(f_control)
        .parity(p_mode)
        .stop_bits(s_bits)
        .timeout(Duration::from_millis(50));

    match port_builder.open() {
        Ok(mut port) => {
            let _ = port.clear(serialport::ClearBuffer::Input);

            let mut port_clone = port.try_clone().map_err(|e| e.to_string())?;

            // Fix de Ruído
            let _ = port.write_data_terminal_ready(false);
            let _ = port.write_request_to_send(false);

            // Liga o interruptor
            state.running.store(true, Ordering::Relaxed);

            // Salva o port principal
            let mut state_port = state.port.lock().map_err(|_| "Lock fail")?;
            *state_port = Some(port);

            // PREPARAÇÃO PARA A THREAD
            let keep_running = state.running.clone();
            let log_file_arc = state.log_file.clone();
            let port_name_clone = port_name.clone();

            thread::spawn(move || {
                let mut serial_buf: Vec<u8> = vec![0; 1024];
                println!("Thread de leitura iniciada: {}", port_name_clone);

                loop {
                    if !keep_running.load(Ordering::Relaxed) {
                        break;
                    }

                    match port_clone.read(serial_buf.as_mut_slice()) {
                        Ok(t) => {
                            if t > 0 {
                                let data = &serial_buf[..t];

                                // --- GRAVAÇÃO NO ARQUIVO ---
                                // Usamos o ARC clonado aqui dentro
                                if let Ok(mut lock) = log_file_arc.lock() {
                                    if let Some(file) = lock.as_mut() {
                                        let _ = file.write_all(data);
                                        let _ = file.flush();
                                    }
                                }

                                if let Err(_) = app.emit("serial-data", data) {
                                    break;
                                }
                            }
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                        Err(e) => {
                            eprintln!("Erro fatal ({}): {:?}", port_name_clone, e);
                            let _ = app.emit("connection-lost", e.to_string());
                            break;
                        }
                    }
                }
            });

            Ok(format!("Conectado a {}", port_name))
        }
        Err(e) => Err(format!("Falha ao abrir: {}", e)),
    }
}

#[command]
pub fn close_port(state: State<'_, SerialState>) -> Result<String, String> {
    state.running.store(false, Ordering::Relaxed);

    let mut state_port = state.port.lock().map_err(|_| "Lock fail")?;
    *state_port = None;

    println!("Desconectado.");
    Ok("Desconectado.".to_string())
}

#[command]
pub fn write_serial(
    app: AppHandle,
    content: String,
    state: State<'_, SerialState>,
) -> Result<usize, String> {
    let mut port_guard = state.port.lock().map_err(|e| e.to_string())?;

    if let Some(port) = port_guard.as_mut() {
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
            Err(e) => Err(format!("Erro escrita: {}", e)),
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
    let mut state_port = state.port.lock().map_err(|_| "Falha no Lock")?;

    if let Some(port) = state_port.as_mut() {
        let result = match pin.as_str() {
            "DTR" => port.write_data_terminal_ready(active),
            "RTS" => port.write_request_to_send(active),
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

#[command]
pub fn start_spy_bridge(
    app: AppHandle,
    port_a_name: String,
    port_b_name: String,
    baud_rate: u32,
    state: State<'_, SerialState>,
) -> Result<String, String> {
    state.running.store(false, Ordering::Relaxed);
    thread::sleep(Duration::from_millis(100));

    let builder_a = serialport::new(&port_a_name, baud_rate).timeout(Duration::from_millis(10));
    let builder_b = serialport::new(&port_b_name, baud_rate).timeout(Duration::from_millis(10));

    let port_a = builder_a
        .open()
        .map_err(|e| format!("Falha porta A: {}", e))?;
    let port_b = builder_b
        .open()
        .map_err(|e| format!("Falha porta B: {}", e))?;

    let mut port_a_read = port_a.try_clone().map_err(|e| e.to_string())?;
    let mut port_b_write = port_b.try_clone().map_err(|e| e.to_string())?;

    let mut port_b_read = port_b.try_clone().map_err(|e| e.to_string())?;
    let mut port_a_write = port_a.try_clone().map_err(|e| e.to_string())?;

    state.running.store(true, Ordering::Relaxed);
    let keep_running = state.running.clone();

    {
        let mut state_port = state.port.lock().map_err(|_| "Lock fail")?;
        *state_port = Some(port_a);
    }

    let app_handle1 = app.clone();
    let keep_running1 = keep_running.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            if !keep_running1.load(Ordering::Relaxed) {
                break;
            }

            if let Ok(n) = port_a_read.read(&mut buf) {
                if n > 0 {
                    let data = &buf[..n];
                    let _ = app_handle1.emit("spy-data-a", data);
                    let _ = port_b_write.write_all(data);
                }
            }
        }
    });

    let app_handle2 = app.clone();
    let keep_running2 = keep_running.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            if !keep_running2.load(Ordering::Relaxed) {
                break;
            }

            if let Ok(n) = port_b_read.read(&mut buf) {
                if n > 0 {
                    let data = &buf[..n];
                    let _ = app_handle2.emit("spy-data-b", data);
                    let _ = port_a_write.write_all(data);
                }
            }
        }
    });

    Ok("Spy Mode Iniciado".to_string())
}
