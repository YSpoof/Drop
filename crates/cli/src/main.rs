#[cfg(not(any(target_os = "linux", target_os = "windows")))]
compile_error!("dropcli supports only Linux and Windows");

use std::process::ExitCode;

fn main() -> ExitCode {
    drop_cli::app::main(std::env::args_os())
}
