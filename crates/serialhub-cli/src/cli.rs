use crate::monitor::{self, MonitorArgs};
use serialhub_core::SerialPortInfo;
use std::ffi::OsString;
use std::io::{self, Write};

const HELP: &str = "SerialHub — portas e monitor Serial

Uso:
  serialhub --help
  serialhub --version
  serialhub ports
  serialhub ports --json
  serialhub serial monitor --port PORTA --baud BAUD [--duration SEGUNDOS]
  serialhub serial monitor --help

Opções:
  -h, --help       Exibe esta ajuda
  -V, --version    Exibe a versão da CLI
  --json           Retorna um array JSON (somente com ports)

A listagem apenas enumera dispositivos; não abre portas nem transmite dados.
";

const MONITOR_HELP: &str = "Monitor Serial (somente recepção)

Uso:
  serialhub serial monitor --port PORTA --baud BAUD [--duration SEGUNDOS]

Parâmetros:
  --port PORTA          Obrigatório (ex.: COM3 ou /dev/ttyUSB0)
  --baud BAUD           Obrigatório; inteiro positivo (ex.: 115200)
  --duration SEGUNDOS   Duração positiva, inclusive decimal (ex.: 2.5)
  -h, --help            Exibe esta ajuda

Exemplos (escolha uma porta autorizada):
  serialhub serial monitor --port COM3 --baud 115200
  serialhub serial monitor --port COM3 --baud 115200 --duration 10

Configuração: 8N1, fluxo desabilitado, timeout de leitura de 50 ms.
DTR/RTS não são alterados explicitamente; o estado inicial depende do driver.
stdout contém somente bytes recebidos. Estado/erros ficam em stderr.
Ctrl+C libera a conexão (código 130); duração libera a conexão (código 0).
Para bytes binários, use stdout conectado a um pipe/arquivo que preserve bytes.
O monitor não transmite comandos, não grava arquivos e não oferece MQTT.
";

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Help,
    Version,
    Ports { json: bool },
    MonitorHelp,
    Monitor(MonitorArgs),
}

fn parse(args: &[OsString]) -> Result<Command, String> {
    let args: Vec<_> = args
        .iter()
        .map(|arg| arg.to_str().ok_or("Argumento inválido: texto não Unicode."))
        .collect::<Result<_, _>>()?;
    match args.as_slice() {
        ["--help" | "-h"] => Ok(Command::Help),
        ["--version" | "-V"] => Ok(Command::Version),
        ["ports"] => Ok(Command::Ports { json: false }),
        ["ports", "--json"] => Ok(Command::Ports { json: true }),
        ["serial", "monitor", "--help" | "-h"] => Ok(Command::MonitorHelp),
        ["serial", "monitor", options @ ..] => parse_monitor(options).map(Command::Monitor),
        [] => Err("Nenhum comando informado. Use serialhub --help.".into()),
        _ => Err(format!(
            "Argumentos inválidos: {:?}. Use serialhub --help.",
            args
        )),
    }
}

fn parse_monitor(options: &[&str]) -> Result<MonitorArgs, String> {
    let mut port = None;
    let mut baud = None;
    let mut duration = None;
    for pair in options.chunks(2) {
        let [flag, value] = pair else {
            return Err("Opção sem valor. Use serialhub serial monitor --help.".into());
        };
        match *flag {
            "--port" if port.is_none() && !value.trim().is_empty() && !value.starts_with("--") => {
                port = Some((*value).to_string())
            }
            "--baud" if baud.is_none() => {
                baud = Some(
                    value
                        .parse::<u32>()
                        .ok()
                        .filter(|v| *v > 0)
                        .ok_or("--baud deve ser um inteiro positivo.")?,
                );
            }
            "--duration" if duration.is_none() => {
                let seconds = value
                    .parse::<f64>()
                    .map_err(|_| "--duration deve ser positiva e finita.")?;
                let parsed = std::time::Duration::try_from_secs_f64(seconds)
                    .map_err(|_| "--duration deve ser positiva, finita e representável.")?;
                if parsed.is_zero() {
                    return Err("--duration deve ser maior que zero.".into());
                }
                duration = Some(parsed);
            }
            _ => {
                return Err(format!(
                    "Opção inválida ou duplicada: {flag}. Use serialhub serial monitor --help."
                ))
            }
        }
    }
    Ok(MonitorArgs {
        port: port.ok_or("Informe --port. Use serialhub serial monitor --help.")?,
        baud: baud.ok_or("Informe --baud. Use serialhub serial monitor --help.")?,
        duration,
    })
}

fn write_ports(ports: &[SerialPortInfo], json: bool, out: &mut impl Write) -> io::Result<()> {
    if json {
        // Serialize the core model directly, keeping the GUI's exact schema.
        let value = serde_json::to_string(ports).map_err(io::Error::other)?;
        return writeln!(out, "{value}");
    }
    if ports.is_empty() {
        return writeln!(out, "Nenhuma porta serial encontrada.");
    }
    for port in ports {
        let label = match port.port_type.as_str() {
            "Unknown" => "Desconhecida",
            kind => kind,
        };
        writeln!(out, "{} ({})", port.port_name, label)?;
        for (label, value) in [
            ("VID", &port.vid),
            ("PID", &port.pid),
            ("Fabricante", &port.manufacturer),
            ("Produto", &port.product),
        ] {
            if !value.is_empty() {
                writeln!(out, "  {label}: {value}")?;
            }
        }
    }
    Ok(())
}

// The callback is a private test seam. Production always calls the core's
// list_ports; tests supply deterministic metadata or enumeration failures.
pub(crate) fn run(
    args: &[OsString],
    enumerate: impl FnOnce() -> Result<Vec<SerialPortInfo>, String>,
    out: &mut impl Write,
    err: &mut impl Write,
) -> u8 {
    run_with_monitor(
        args,
        enumerate,
        |args, out, err| monitor::run(&args, out, err),
        out,
        err,
    )
}

fn run_with_monitor<O: Write, E: Write>(
    args: &[OsString],
    enumerate: impl FnOnce() -> Result<Vec<SerialPortInfo>, String>,
    monitor: impl FnOnce(MonitorArgs, &mut O, &mut E) -> u8,
    out: &mut O,
    err: &mut E,
) -> u8 {
    let command = match parse(args) {
        Ok(command) => command,
        Err(message) => {
            let _ = writeln!(err, "serialhub: {message}");
            return 2;
        }
    };
    let result = match command {
        Command::Help => write!(out, "{HELP}"),
        Command::Version => writeln!(out, "serialhub {}", env!("CARGO_PKG_VERSION")),
        Command::MonitorHelp => write!(out, "{MONITOR_HELP}"),
        Command::Monitor(args) => return monitor(args, out, err),
        Command::Ports { json } => {
            let ports = match enumerate() {
                Ok(ports) => ports,
                Err(message) => {
                    let _ = writeln!(
                        err,
                        "serialhub: Falha ao enumerar portas seriais: {message}"
                    );
                    return 1;
                }
            };
            write_ports(&ports, json, out)
        }
    };
    match result {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(err, "serialhub: Falha ao escrever saída: {error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn monitor_accepts_reordered_options_and_decimal_duration() {
        let expected = MonitorArgs {
            port: "COM3".into(),
            baud: 115200,
            duration: Some(std::time::Duration::from_millis(2500)),
        };
        assert_eq!(
            parse(&args(&[
                "serial",
                "monitor",
                "--duration",
                "2.5",
                "--baud",
                "115200",
                "--port",
                "COM3"
            ]))
            .unwrap(),
            Command::Monitor(expected)
        );
        assert!(matches!(
            parse(&args(&[
                "serial", "monitor", "--port", "COM3", "--baud", "9600"
            ]))
            .unwrap(),
            Command::Monitor(MonitorArgs { duration: None, .. })
        ));
    }

    #[test]
    fn invalid_monitor_arguments_never_open_or_enumerate() {
        for options in [
            vec![],
            vec!["--port", "COM3"],
            vec!["--baud", "115200"],
            vec!["--port", "", "--baud", "115200"],
            vec!["--port", "COM3", "--baud", "0"],
            vec!["--port", "COM3", "--baud", "abc"],
            vec!["--port", "COM3", "--baud", "4294967296"],
            vec!["--port", "COM3", "--baud", "115200", "--duration", "-1"],
            vec!["--port", "COM3", "--baud", "115200", "--duration", "0"],
            vec!["--port", "COM3", "--baud", "115200", "--duration", "NaN"],
            vec!["--port", "COM3", "--baud", "115200", "--duration", "inf"],
            vec!["--port", "COM3", "--baud", "115200", "--duration", "1e300"],
            vec!["--port", "COM3", "--baud", "115200", "--duration"],
            vec!["--port", "COM3", "--port", "COM4", "--baud", "115200"],
            vec!["--port", "COM3", "--baud", "115200", "--json"],
        ] {
            let mut input = vec!["serial", "monitor"];
            input.extend(options);
            let mut out = Vec::new();
            let mut err = Vec::new();
            assert_eq!(
                run_with_monitor(
                    &args(&input),
                    || panic!("must not enumerate"),
                    |_, _, _| panic!("must not monitor"),
                    &mut out,
                    &mut err
                ),
                2
            );
            assert!(out.is_empty());
            assert!(!err.is_empty());
        }
    }

    #[test]
    fn monitor_help_and_routing_preserve_exit_codes() {
        let mut out = Vec::new();
        let mut err = Vec::new();
        assert_eq!(
            run_with_monitor(
                &args(&["serial", "monitor", "--help"]),
                || panic!("must not enumerate"),
                |_, _, _| panic!("must not monitor"),
                &mut out,
                &mut err
            ),
            0
        );
        assert!(String::from_utf8_lossy(&out).contains("--duration"));
        assert!(err.is_empty());
        for code in [0, 130, 1] {
            out.clear();
            assert_eq!(
                run_with_monitor(
                    &args(&[
                        "serial",
                        "monitor",
                        "--port",
                        "simulated",
                        "--baud",
                        "115200"
                    ]),
                    || panic!("must not enumerate"),
                    |config, _, _| {
                        assert_eq!(config.port, "simulated");
                        code
                    },
                    &mut out,
                    &mut err
                ),
                code
            );
        }
    }

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn sample() -> SerialPortInfo {
        SerialPortInfo {
            port_name: "COM7".into(),
            port_type: "USB".into(),
            vid: "00ab".into(),
            pid: "1234".into(),
            manufacturer: "Fabricante \"Teste\"".into(),
            product: "Sensor\nΩ".into(),
        }
    }

    #[test]
    fn accepts_supported_arguments() {
        for (input, expected) in [
            (vec!["--help"], Command::Help),
            (vec!["-h"], Command::Help),
            (vec!["--version"], Command::Version),
            (vec!["-V"], Command::Version),
            (vec!["ports"], Command::Ports { json: false }),
            (vec!["ports", "--json"], Command::Ports { json: true }),
        ] {
            assert_eq!(parse(&args(&input)).unwrap(), expected);
        }
    }

    #[test]
    fn invalid_arguments_fail_on_stderr_without_enumerating() {
        for input in [
            vec![],
            vec!["unknown"],
            vec!["--json"],
            vec!["ports", "--bad"],
            vec!["ports", "--json", "--json"],
            vec!["--help", "extra"],
            vec!["--version", "ports"],
            vec!["--json", "ports"],
        ] {
            let mut out = Vec::new();
            let mut err = Vec::new();
            assert_eq!(
                run(
                    &args(&input),
                    || panic!("must not enumerate"),
                    &mut out,
                    &mut err
                ),
                2
            );
            assert!(out.is_empty());
            assert!(String::from_utf8(err).unwrap().contains("serialhub --help"));
        }
    }

    #[test]
    fn help_and_version_do_not_enumerate() {
        for input in ["--help", "--version"] {
            let mut out = Vec::new();
            let mut err = Vec::new();
            assert_eq!(
                run(
                    &args(&[input]),
                    || panic!("must not enumerate"),
                    &mut out,
                    &mut err
                ),
                0
            );
            assert!(err.is_empty());
            let text = String::from_utf8(out).unwrap();
            if input == "--help" {
                assert!(text.contains("serialhub ports --json"));
            } else {
                assert_eq!(text, format!("serialhub {}\n", env!("CARGO_PKG_VERSION")));
            }
        }
    }

    #[test]
    fn json_is_exclusively_a_gui_schema_array_with_escaped_metadata() {
        let mut out = Vec::new();
        let mut err = Vec::new();
        assert_eq!(
            run(
                &args(&["ports", "--json"]),
                || Ok(vec![sample()]),
                &mut out,
                &mut err
            ),
            0
        );
        assert!(err.is_empty());
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            parsed,
            json!([{
                "port_name": "COM7", "port_type": "USB", "vid": "00ab", "pid": "1234",
                "manufacturer": "Fabricante \"Teste\"", "product": "Sensor\nΩ"
            }])
        );
    }

    #[test]
    fn empty_list_succeeds_in_both_output_modes() {
        for (input, expected) in [
            (vec!["ports"], "Nenhuma porta serial encontrada.\n"),
            (vec!["ports", "--json"], "[]\n"),
        ] {
            let mut out = Vec::new();
            let mut err = Vec::new();
            assert_eq!(run(&args(&input), || Ok(vec![]), &mut out, &mut err), 0);
            assert_eq!(String::from_utf8(out).unwrap(), expected);
            assert!(err.is_empty());
        }
    }

    #[test]
    fn enumeration_errors_fail_without_stdout_in_both_modes() {
        for input in [vec!["ports"], vec!["ports", "--json"]] {
            let mut out = Vec::new();
            let mut err = Vec::new();
            assert_eq!(
                run(
                    &args(&input),
                    || Err("driver indisponível".into()),
                    &mut out,
                    &mut err
                ),
                1
            );
            assert!(out.is_empty());
            assert!(String::from_utf8(err)
                .unwrap()
                .contains("driver indisponível"));
        }
    }

    #[test]
    fn text_lists_name_type_and_only_available_metadata_in_order() {
        let mut first = sample();
        first.product = "Sensor".into();
        let second = SerialPortInfo {
            port_name: "COM2".into(),
            port_type: "Unknown".into(),
            vid: String::new(),
            pid: String::new(),
            manufacturer: String::new(),
            product: String::new(),
        };
        let mut out = Vec::new();
        let mut err = Vec::new();
        assert_eq!(
            run(
                &args(&["ports"]),
                || Ok(vec![first, second]),
                &mut out,
                &mut err
            ),
            0
        );
        assert!(err.is_empty());
        assert_eq!(String::from_utf8(out).unwrap(),
            "COM7 (USB)\n  VID: 00ab\n  PID: 1234\n  Fabricante: Fabricante \"Teste\"\n  Produto: Sensor\nCOM2 (Desconhecida)\n");
    }

    #[test]
    fn shared_core_classification_reaches_cli_text_and_json_without_inference() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/serial-ports.json"))
                .unwrap();
        let ports: Vec<_> = fixture
            .as_array()
            .unwrap()
            .iter()
            .map(|port| SerialPortInfo {
                port_name: port["port_name"].as_str().unwrap().into(),
                port_type: port["port_type"].as_str().unwrap().into(),
                vid: port["vid"].as_str().unwrap().into(),
                pid: port["pid"].as_str().unwrap().into(),
                manufacturer: port["manufacturer"].as_str().unwrap().into(),
                product: port["product"].as_str().unwrap().into(),
            })
            .collect();
        let (mut json, mut text) = (Vec::new(), Vec::new());
        write_ports(&ports, true, &mut json).unwrap();
        write_ports(&ports, false, &mut text).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&json).unwrap(),
            fixture
        );
        let text = String::from_utf8(text).unwrap();
        for label in [
            "COM3 (Desconhecida)",
            "COM7 (USB)",
            "COM16 (Bluetooth)",
            "COM2 (Native)",
        ] {
            assert!(text.contains(label), "{text}");
        }
        assert!(!text.contains("Virtual"));
    }

    #[test]
    fn available_description_does_not_override_unknown_classification() {
        for description in [
            "Intel(R) Active Management Technology - SOL",
            "Virtual Serial Port",
            "Standard serial link over Bluetooth",
        ] {
            let mut port = sample();
            port.port_type = "Unknown".into();
            port.product = description.into();
            let mut out = Vec::new();
            write_ports(&[port], false, &mut out).unwrap();
            let text = String::from_utf8(out).unwrap();
            assert!(text.starts_with("COM7 (Desconhecida)\n"));
            assert!(text.contains(description));
        }
    }

    #[test]
    fn output_write_failure_returns_error_code_and_diagnostic() {
        struct BrokenOutput;
        impl Write for BrokenOutput {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed pipe"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut err = Vec::new();
        assert_eq!(
            run(
                &args(&["ports", "--json"]),
                || Ok(vec![]),
                &mut BrokenOutput,
                &mut err
            ),
            1
        );
        assert!(String::from_utf8(err).unwrap().contains("closed pipe"));
    }
}
