use std::io::{self, Read, Write};
use std::time::Duration;

pub use serialport::{DataBits, FlowControl, Parity, StopBits};

/// Typed communication settings. The caller chooses timeout/cancellation policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: DataBits,
    pub flow_control: FlowControl,
    pub parity: Parity,
    pub stop_bits: StopBits,
    pub timeout: Duration,
}

impl SerialConfig {
    /// 8N1, no flow control, 50 ms timeout (the GUI's existing defaults).
    pub fn new(port_name: impl Into<String>, baud_rate: u32) -> Self {
        Self {
            port_name: port_name.into(),
            baud_rate,
            data_bits: DataBits::Eight,
            flow_control: FlowControl::None,
            parity: Parity::None,
            stop_bits: StopBits::One,
            timeout: Duration::from_millis(50),
        }
    }
}

/// Owns one transport handle. Clones are independently owned handles to the
/// same device: all must be dropped/closed before the device is released.
/// This type does not spawn threads, emit events, encode text or record logs.
pub struct SerialConnection {
    transport: Box<dyn serialport::SerialPort>,
}

impl SerialConnection {
    pub fn open(config: &SerialConfig) -> serialport::Result<Self> {
        Self::open_with(config, |config| {
            serialport::new(&config.port_name, config.baud_rate)
                .data_bits(config.data_bits)
                .flow_control(config.flow_control)
                .parity(config.parity)
                .stop_bits(config.stop_bits)
                .timeout(config.timeout)
                .open()
        })
    }

    fn open_with(
        config: &SerialConfig,
        open: impl FnOnce(&SerialConfig) -> serialport::Result<Box<dyn serialport::SerialPort>>,
    ) -> serialport::Result<Self> {
        open(config).map(Self::from_transport)
    }

    /// Adopt an already configured transport, including a simulated transport.
    /// Configuration and control lines are not silently changed on adoption.
    pub fn from_transport(transport: Box<dyn serialport::SerialPort>) -> Self {
        Self { transport }
    }

    pub fn try_clone(&self) -> serialport::Result<Self> {
        self.transport.try_clone().map(Self::from_transport)
    }

    pub fn clear_input(&self) -> serialport::Result<()> {
        self.transport.clear(serialport::ClearBuffer::Input)
    }

    pub fn set_dtr(&mut self, active: bool) -> serialport::Result<()> {
        self.transport.write_data_terminal_ready(active)
    }

    pub fn set_rts(&mut self, active: bool) -> serialport::Result<()> {
        self.transport.write_request_to_send(active)
    }

    /// Release this handle; any clones remain owned by their callers.
    pub fn close(self) {}
}

impl Read for SerialConnection {
    /// Read raw bytes. In particular, TimedOut remains an io::ErrorKind.
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.transport.read(buf)
    }
}

impl Write for SerialConnection {
    /// Preserve normal Write semantics, including partial writes.
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.transport.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.transport.flush()
    }
}

#[cfg(test)]
mod tests;
