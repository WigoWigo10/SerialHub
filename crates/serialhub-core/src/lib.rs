//! Shared SerialHub enumeration and synchronous serial I/O.
//! Threads, hotplug monitoring, GUI events, logging and MQTT belong to callers.

mod connection;
pub use connection::{DataBits, FlowControl, Parity, SerialConfig, SerialConnection, StopBits};

use serialport::SerialPortType;

/// Port metadata using the existing SerialHub GUI's serialized field names.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
    pub vid: String,
    pub pid: String,
    pub manufacturer: String,
    pub product: String,
}

impl From<serialport::SerialPortInfo> for SerialPortInfo {
    fn from(port: serialport::SerialPortInfo) -> Self {
        let mut result = Self {
            port_name: port.port_name,
            port_type: String::new(),
            vid: String::new(),
            pid: String::new(),
            manufacturer: String::new(),
            product: String::new(),
        };
        result.port_type = match port.port_type {
            SerialPortType::UsbPort(info) => {
                result.vid = format!("{:04x}", info.vid);
                result.pid = format!("{:04x}", info.pid);
                result.manufacturer = info.manufacturer.unwrap_or_default();
                result.product = info.product.unwrap_or_default();
                "USB"
            }
            SerialPortType::BluetoothPort => "Bluetooth",
            SerialPortType::PciPort => "Native",
            SerialPortType::Unknown => "Virtual",
        }
        .to_string();
        result
    }
}

/// Enumerate without opening ports, preserving the OS/library ordering.
/// Errors retain their serialport type; presentation belongs to the caller.
pub fn list_ports() -> serialport::Result<Vec<SerialPortInfo>> {
    list_ports_with(serialport::available_ports)
}

fn list_ports_with(
    enumerate: impl FnOnce() -> serialport::Result<Vec<serialport::SerialPortInfo>>,
) -> serialport::Result<Vec<SerialPortInfo>> {
    enumerate().map(|ports| ports.into_iter().map(SerialPortInfo::from).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serialport::{Error, ErrorKind, UsbPortInfo};

    fn port(name: &str, port_type: SerialPortType) -> serialport::SerialPortInfo {
        serialport::SerialPortInfo {
            port_name: name.to_string(),
            port_type,
        }
    }

    #[test]
    fn usb_json_preserves_gui_contract() {
        let info = SerialPortInfo::from(port(
            "COM7",
            SerialPortType::UsbPort(UsbPortInfo {
                vid: 0x00ab,
                pid: 0xcdef,
                serial_number: Some("not-part-of-the-gui-contract".into()),
                manufacturer: Some("Fabricante".into()),
                product: Some("Sensor".into()),
            }),
        ));
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "port_name": "COM7", "port_type": "USB", "vid": "00ab",
                "pid": "cdef", "manufacturer": "Fabricante", "product": "Sensor"
            })
        );
    }

    #[test]
    fn missing_usb_metadata_serializes_as_empty_strings() {
        let info = SerialPortInfo::from(port(
            "COM8",
            SerialPortType::UsbPort(UsbPortInfo {
                vid: 0,
                pid: 1,
                serial_number: None,
                manufacturer: None,
                product: None,
            }),
        ));
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({
                "port_name": "COM8", "port_type": "USB", "vid": "0000",
                "pid": "0001", "manufacturer": "", "product": ""
            })
        );
    }

    #[test]
    fn other_port_types_preserve_labels_and_empty_metadata() {
        for (kind, label) in [
            (SerialPortType::BluetoothPort, "Bluetooth"),
            (SerialPortType::PciPort, "Native"),
            (SerialPortType::Unknown, "Virtual"),
        ] {
            assert_eq!(
                serde_json::to_value(SerialPortInfo::from(port("COM1", kind))).unwrap(),
                json!({
                    "port_name": "COM1", "port_type": label, "vid": "",
                    "pid": "", "manufacturer": "", "product": ""
                })
            );
        }
    }

    #[test]
    fn enumeration_preserves_order_and_accepts_empty_results() {
        let ports = list_ports_with(|| {
            Ok(vec![
                port("COM10", SerialPortType::Unknown),
                port("COM2", SerialPortType::PciPort),
            ])
        })
        .unwrap();
        assert_eq!(
            ports
                .iter()
                .map(|p| p.port_name.as_str())
                .collect::<Vec<_>>(),
            vec!["COM10", "COM2"]
        );
        assert!(list_ports_with(|| Ok(vec![])).unwrap().is_empty());
    }

    #[test]
    fn enumeration_propagates_error_kind_and_description() {
        let error = list_ports_with(|| Err(Error::new(ErrorKind::Unknown, "enumeration failed")))
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Unknown);
        assert_eq!(error.to_string(), "enumeration failed");
    }
}
