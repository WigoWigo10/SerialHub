use super::*;
use serialport::{ClearBuffer, Error, ErrorKind, Result, SerialPort};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Shared {
    input: VecDeque<u8>,
    output: Vec<u8>,
    read_error: Option<io::ErrorKind>,
    write_error: Option<io::ErrorKind>,
    control_error: bool,
    clone_error: bool,
    write_limit: Option<usize>,
    dtr: bool,
    rts: bool,
    cleared: bool,
    drops: usize,
}

struct MockPort {
    config: SerialConfig,
    shared: Arc<Mutex<Shared>>,
}

fn mock(config: SerialConfig) -> (MockPort, Arc<Mutex<Shared>>) {
    let shared = Arc::new(Mutex::new(Shared::default()));
    (
        MockPort {
            config,
            shared: shared.clone(),
        },
        shared,
    )
}

impl Drop for MockPort {
    fn drop(&mut self) {
        self.shared.lock().unwrap().drops += 1;
    }
}

impl Read for MockPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut state = self.shared.lock().unwrap();
        if let Some(kind) = state.read_error {
            return Err(io::Error::new(kind, "simulated read"));
        }
        if state.input.is_empty() {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "idle"));
        }
        let len = buf.len().min(state.input.len());
        for byte in &mut buf[..len] {
            *byte = state.input.pop_front().unwrap();
        }
        Ok(len)
    }
}

impl Write for MockPort {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let mut state = self.shared.lock().unwrap();
        if let Some(kind) = state.write_error {
            return Err(io::Error::new(kind, "simulated write"));
        }
        let len = state.write_limit.unwrap_or(bytes.len()).min(bytes.len());
        state.output.extend_from_slice(&bytes[..len]);
        Ok(len)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

macro_rules! setting {
    ($getter:ident, $setter:ident, $field:ident, $ty:ty) => {
        fn $getter(&self) -> Result<$ty> {
            Ok(self.config.$field)
        }
        fn $setter(&mut self, value: $ty) -> Result<()> {
            self.config.$field = value;
            Ok(())
        }
    };
}

impl SerialPort for MockPort {
    fn name(&self) -> Option<String> {
        Some(self.config.port_name.clone())
    }
    setting!(baud_rate, set_baud_rate, baud_rate, u32);
    setting!(data_bits, set_data_bits, data_bits, DataBits);
    setting!(flow_control, set_flow_control, flow_control, FlowControl);
    setting!(parity, set_parity, parity, Parity);
    setting!(stop_bits, set_stop_bits, stop_bits, StopBits);
    fn timeout(&self) -> Duration {
        self.config.timeout
    }
    fn set_timeout(&mut self, value: Duration) -> Result<()> {
        self.config.timeout = value;
        Ok(())
    }
    fn write_request_to_send(&mut self, active: bool) -> Result<()> {
        let mut state = self.shared.lock().unwrap();
        if state.control_error {
            return Err(Error::new(ErrorKind::NoDevice, "control disconnected"));
        }
        state.rts = active;
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, active: bool) -> Result<()> {
        let mut state = self.shared.lock().unwrap();
        if state.control_error {
            return Err(Error::new(ErrorKind::NoDevice, "control disconnected"));
        }
        state.dtr = active;
        Ok(())
    }
    fn read_clear_to_send(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_data_set_ready(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_ring_indicator(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn read_carrier_detect(&mut self) -> Result<bool> {
        Ok(false)
    }
    fn bytes_to_read(&self) -> Result<u32> {
        Ok(self.shared.lock().unwrap().input.len() as u32)
    }
    fn bytes_to_write(&self) -> Result<u32> {
        Ok(0)
    }
    fn clear(&self, buffer: ClearBuffer) -> Result<()> {
        assert_eq!(buffer, ClearBuffer::Input);
        let mut state = self.shared.lock().unwrap();
        state.cleared = true;
        state.input.clear();
        Ok(())
    }
    fn try_clone(&self) -> Result<Box<dyn SerialPort>> {
        if self.shared.lock().unwrap().clone_error {
            return Err(Error::new(ErrorKind::NoDevice, "clone disconnected"));
        }
        Ok(Box::new(Self {
            config: self.config.clone(),
            shared: self.shared.clone(),
        }))
    }
    fn set_break(&self) -> Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> Result<()> {
        Ok(())
    }
}

#[test]
fn defaults_match_gui_8n1_and_50ms_timeout() {
    let config = SerialConfig::new("test-port", 115200);
    assert_eq!(config.port_name, "test-port");
    assert_eq!(config.baud_rate, 115200);
    assert_eq!(config.data_bits, DataBits::Eight);
    assert_eq!(config.parity, Parity::None);
    assert_eq!(config.stop_bits, StopBits::One);
    assert_eq!(config.flow_control, FlowControl::None);
    assert_eq!(config.timeout, Duration::from_millis(50));
}

#[test]
fn custom_typed_configuration_reaches_transport_factory_unchanged() {
    let config = SerialConfig {
        port_name: "simulated".into(),
        baud_rate: 57600,
        data_bits: DataBits::Seven,
        flow_control: FlowControl::Hardware,
        parity: Parity::Even,
        stop_bits: StopBits::Two,
        timeout: Duration::from_millis(10),
    };
    let connection = SerialConnection::open_with(&config, |received| {
        assert_eq!(received, &config);
        Ok(Box::new(mock(received.clone()).0))
    })
    .unwrap();
    assert_eq!(connection.transport.timeout(), config.timeout);
    assert_eq!(connection.transport.data_bits().unwrap(), DataBits::Seven);
    assert_eq!(
        connection.transport.flow_control().unwrap(),
        FlowControl::Hardware
    );
    assert_eq!(connection.transport.parity().unwrap(), Parity::Even);
    assert_eq!(connection.transport.stop_bits().unwrap(), StopBits::Two);
    assert_eq!(connection.transport.baud_rate().unwrap(), 57600);
}

#[test]
fn open_errors_keep_native_kind_and_message() {
    let result = SerialConnection::open_with(&SerialConfig::new("missing", 9600), |_| {
        Err(Error::new(ErrorKind::NoDevice, "missing simulated device"))
    });
    let error = result.err().unwrap();
    assert_eq!(error.kind(), ErrorKind::NoDevice);
    assert_eq!(error.to_string(), "missing simulated device");
}

#[test]
fn reads_and_writes_preserve_non_utf8_and_control_bytes() {
    let (port, shared) = mock(SerialConfig::new("fake", 9600));
    let bytes = [0, 0xff, 0x80, 13, 10, 0x1b];
    shared.lock().unwrap().input.extend(bytes);
    let mut connection = SerialConnection::from_transport(Box::new(port));
    let mut buf = [0; 3];
    assert_eq!(connection.read(&mut buf).unwrap(), 3);
    assert_eq!(buf, bytes[..3]);
    assert_eq!(connection.read(&mut buf).unwrap(), 3);
    assert_eq!(buf, bytes[3..]);
    connection.write_all(&bytes).unwrap();
    assert_eq!(shared.lock().unwrap().output, bytes);
}

#[test]
fn partial_write_reports_only_bytes_accepted_by_transport() {
    let (port, shared) = mock(SerialConfig::new("fake", 9600));
    shared.lock().unwrap().write_limit = Some(2);
    let mut connection = SerialConnection::from_transport(Box::new(port));
    assert_eq!(connection.write(&[0xff, 0, 1, 2]).unwrap(), 2);
    assert_eq!(shared.lock().unwrap().output, [0xff, 0]);
}

#[test]
fn timeout_and_io_errors_are_not_replaced_by_gui_messages() {
    let (port, shared) = mock(SerialConfig::new("fake", 9600));
    let mut connection = SerialConnection::from_transport(Box::new(port));
    assert_eq!(
        connection.read(&mut [0; 8]).unwrap_err().kind(),
        io::ErrorKind::TimedOut
    );
    shared.lock().unwrap().read_error = Some(io::ErrorKind::PermissionDenied);
    let error = connection.read(&mut [0; 8]).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    assert_eq!(error.to_string(), "simulated read");
    shared.lock().unwrap().write_error = Some(io::ErrorKind::BrokenPipe);
    assert_eq!(
        connection.write(&[1]).unwrap_err().kind(),
        io::ErrorKind::BrokenPipe
    );
}

#[test]
fn control_lines_input_clear_and_clone_errors_preserve_transport_contract() {
    let (port, shared) = mock(SerialConfig::new("fake", 9600));
    shared.lock().unwrap().input.extend([1, 2]);
    let mut connection = SerialConnection::from_transport(Box::new(port));
    connection.set_dtr(true).unwrap();
    connection.set_rts(true).unwrap();
    connection.clear_input().unwrap();
    let state = shared.lock().unwrap();
    assert!(state.dtr && state.rts && state.cleared && state.input.is_empty());
    drop(state);
    shared.lock().unwrap().control_error = true;
    assert_eq!(
        connection.set_dtr(false).unwrap_err().kind(),
        ErrorKind::NoDevice
    );
    assert_eq!(
        connection.set_rts(false).unwrap_err().kind(),
        ErrorKind::NoDevice
    );
    shared.lock().unwrap().clone_error = true;
    assert_eq!(
        connection.try_clone().err().unwrap().kind(),
        ErrorKind::NoDevice
    );
}

#[test]
fn close_releases_each_owned_handle_and_clone_still_operates() {
    let (port, shared) = mock(SerialConfig::new("fake", 9600));
    let connection = SerialConnection::from_transport(Box::new(port));
    let mut reader = connection.try_clone().unwrap();
    connection.close();
    assert_eq!(shared.lock().unwrap().drops, 1);
    shared.lock().unwrap().input.push_back(0xff);
    let mut byte = [0];
    assert_eq!(reader.read(&mut byte).unwrap(), 1);
    assert_eq!(byte, [0xff]);
    reader.close();
    assert_eq!(shared.lock().unwrap().drops, 2);
}
