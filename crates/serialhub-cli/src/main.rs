mod cli;
mod monitor;

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let stdout = io::stdout();
    let stderr = io::stderr();
    ExitCode::from(cli::run(
        &args,
        || serialhub_core::list_ports().map_err(|error| error.to_string()),
        &mut stdout.lock(),
        &mut stderr.lock(),
    ))
}
