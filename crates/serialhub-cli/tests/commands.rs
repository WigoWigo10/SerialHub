use std::process::Command;

#[test]
fn help_and_version_work_without_enumeration() {
    for argument in ["--help", "--version"] {
        let output = Command::new(env!("CARGO_BIN_EXE_serialhub"))
            .arg(argument)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(0));
        assert!(output.stderr.is_empty());
        let stdout = String::from_utf8(output.stdout).unwrap();
        if argument == "--help" {
            assert!(stdout.contains("serialhub ports --json"));
        } else {
            assert_eq!(stdout, format!("serialhub {}\n", env!("CARGO_PKG_VERSION")));
        }
    }
}

#[test]
fn invalid_command_returns_argument_error_exit_code_and_only_stderr() {
    let output = Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["ports", "--invalid"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("serialhub --help"));
}

#[test]
fn monitor_help_is_available_without_opening_a_port() {
    let output = Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["serial", "monitor", "--help"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));
    assert!(output.stderr.is_empty());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("--port"));
    assert!(text.contains("--baud"));
    assert!(text.contains("--duration"));
    assert!(text.contains("DTR/RTS"));
}

#[test]
fn invalid_monitor_arguments_return_two_without_stdout() {
    let output = Command::new(env!("CARGO_BIN_EXE_serialhub"))
        .args(["serial", "monitor", "--port", "simulated", "--baud", "0"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(!output.stderr.is_empty());
}
