use serde::Deserialize;
use serialport::SerialPort;
use std::collections::HashMap;
use std::fs::File;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
use tauri::{Emitter, Manager};

#[allow(non_camel_case_types)]
#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct Win32_VideoController {
    name: String,
}

#[allow(non_camel_case_types)]
#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct Win32_PhysicalMemory {
    speed: u32,
    smbios_memory_type: u32,
}

#[allow(non_camel_case_types)]
#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct Win32_Battery {
    estimated_charge_remaining: u16,
    battery_status: u16,
}

#[allow(non_camel_case_types)]
#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct Win32_NetworkAdapter {
    name: String,
    net_connection_status: Option<u16>,
}

pub struct SerialState {
    pub port: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    pub running: Arc<AtomicBool>,
    pub log_file: Arc<Mutex<Option<File>>>,
    pub tx_count: Arc<std::sync::atomic::AtomicU64>,
    pub rx_count: Arc<std::sync::atomic::AtomicU64>,
}

mod commands {
    pub mod serial_cmd;
    pub mod mqtt_cmd;
}
use commands::mqtt_cmd;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_bluetooth::init()) // Desativado temporariamente
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SerialState {
            port: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            log_file: Arc::new(Mutex::new(None)),
            tx_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            rx_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        })
        .manage(mqtt_cmd::MqttState::default()) // <--- INICIALIZA O ESTADO MQTT

        .setup(|app| {
            #[cfg(debug_assertions)]
            { if let Some(w) = app.get_webview_window("main") { w.open_devtools(); } }

            let handle_sys = app.handle().clone();
            thread::spawn(move || {
                let mut gpu_name = "Integrated Graphics".to_string();
                let mut ram_details = "Unknown".to_string();
                let mut ram_speed = 0;
                let mut npu_name = "None".to_string();
                let mut net_adapter_name = "Ethernet/WiFi".to_string();
                let mut bt_detected = false;

                #[cfg(target_os = "windows")]
                {
                    use wmi::{COMLibrary, WMIConnection, Variant};
                    if let Ok(com) = COMLibrary::new() {
                        if let Ok(wmi) = WMIConnection::new(com) {
                            // GPU
                            if let Ok(res) = wmi.query::<Win32_VideoController>() {
                                if let Some(gpu) = res.first() { gpu_name = gpu.name.clone(); }
                            }
                            // RAM
                            if let Ok(res) = wmi.query::<Win32_PhysicalMemory>() {
                                if let Some(ram) = res.first() {
                                    ram_speed = ram.speed;
                                    let t = match ram.smbios_memory_type {
                                        20..=25 => "DDR3", 26 => "DDR4", 30 => "DDR5", 34 => "LPDDR5", _ => "DDR"
                                    };
                                    ram_details = format!("{} ({} Slots)", t, res.len());
                                }
                            }
                            // NPU
                            let q_npu = "SELECT Name FROM Win32_PnPEntity WHERE Name LIKE '%AI Boost%' OR Name LIKE '%NPU%'";
                            if let Ok(res) = wmi.raw_query::<HashMap<String, Variant>>(q_npu) {
                                if let Some(item) = res.first() {
                                    if let Some(Variant::String(s)) = item.get("Name") { npu_name = s.clone(); }
                                }
                            }
                            // NETWORK ADAPTER
                            if let Ok(res) = wmi.query::<Win32_NetworkAdapter>() {
                                for adapter in res {
                                    if let Some(status) = adapter.net_connection_status {
                                        if status == 2 { // 2 = Connected
                                            net_adapter_name = adapter.name.clone();
                                            break;
                                        }
                                    }
                                }
                            }
                            // BLUETOOTH
                            let q_bt = "SELECT Name FROM Win32_PnPEntity WHERE Name LIKE '%Bluetooth%'";
                            if let Ok(res) = wmi.raw_query::<HashMap<String, Variant>>(q_bt) {
                                if !res.is_empty() { bt_detected = true; }
                            }
                        }
                    }
                }

                let mut sys = System::new_with_specifics(
                    RefreshKind::new()
                        .with_cpu(CpuRefreshKind::everything())
                        .with_memory(MemoryRefreshKind::everything())
                );

                loop {
                    sys.refresh_cpu_all();
                    sys.refresh_memory();

                    // CPU Stats
                    let cpus = sys.cpus();
                    let mut avg_freq = 0;
                    if !cpus.is_empty() {
                        let sum: u64 = cpus.iter().map(|c| c.frequency()).sum();
                        avg_freq = sum / cpus.len() as u64;
                    }
                    let cpu_brand = if !cpus.is_empty() { cpus[0].brand().to_string() } else { "".to_string() };
                    let cpu_vendor = if !cpus.is_empty() { cpus[0].vendor_id().to_string() } else { "".to_string() };

                    // BATERIA (Windows Only)
                    let mut bat_percent = 0;
                    let mut is_charging = false;
                    let mut has_battery = false;

                    #[cfg(target_os = "windows")]
                    {
                        use wmi::{COMLibrary, WMIConnection};
                        if let Ok(com) = COMLibrary::new() {
                            if let Ok(wmi) = WMIConnection::new(com) {
                                if let Ok(res) = wmi.query::<Win32_Battery>() {
                                    if let Some(bat) = res.first() {
                                        has_battery = true;
                                        bat_percent = bat.estimated_charge_remaining;
                                        // Status 2 = AC, 6,7,8,9 = Charging
                                        is_charging = bat.battery_status == 2 || bat.battery_status >= 6;
                                    }
                                }
                            }
                        }
                    }

                    let payload = serde_json::json!({
                        "cpu_load": sys.global_cpu_usage(),
                        "mem_used": sys.used_memory(),
                        "mem_total": sys.total_memory(),
                        "cpu_freq": avg_freq,
                        "cpu_brand": cpu_brand,
                        "cpu_vendor": cpu_vendor,
                        "cores_phys": sys.physical_core_count().unwrap_or(0),
                        "cores_log": cpus.len(),
                        "gpu_name": gpu_name,
                        "ram_details": ram_details,
                        "ram_speed": ram_speed,
                        "npu_name": npu_name,
                        "has_battery": has_battery,
                        "bat_percent": bat_percent,
                        "is_charging": is_charging,
                        "net_name": net_adapter_name,
                        "bt_detected": bt_detected
                    });

                    let _ = handle_sys.emit("system-stats", payload);
                    thread::sleep(Duration::from_secs(2));
                }
            });

            let handle_ports = app.handle().clone();
            thread::spawn(move || {
                let mut last_count = 0;
                let mut last_names: Vec<String> = Vec::new();
                loop {
                    if let Ok(ports) = serialport::available_ports() {
                        let names: Vec<String> = ports.iter().map(|p| p.port_name.clone()).collect();
                        if ports.len() != last_count || names != last_names {
                            let _ = handle_ports.emit("ports-changed", ());
                            last_count = ports.len();
                            last_names = names;
                        }
                    }
                    thread::sleep(Duration::from_secs(3));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Serial Port Commands
            commands::serial_cmd::list_ports,
            commands::serial_cmd::open_port,
            commands::serial_cmd::close_port,
            commands::serial_cmd::write_serial,
            commands::serial_cmd::set_control_pin,
            commands::serial_cmd::start_recording,
            commands::serial_cmd::stop_recording,

            // MQTT Commands
            mqtt_cmd::connect_mqtt,
            mqtt_cmd::disconnect_mqtt,
            mqtt_cmd::publish_mqtt,
            mqtt_cmd::subscribe_mqtt,
            mqtt_cmd::unsubscribe_mqtt,
            mqtt_cmd::check_file_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
