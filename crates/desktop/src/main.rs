#![cfg_attr(windows, windows_subsystem = "windows")]

mod bridge;
mod browser;
mod dialog;
mod fs;
mod server;
mod streamer;

use std::process::{ExitCode, ExitStatus};

use url::Url;

const DEFAULT_URL: &str = "https://drop.lzart.com.br";

fn main() -> ExitCode {
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(err) => return fatal(&format!("start runtime: {err}")),
    };
    let result = runtime.block_on(run());
    runtime.shutdown_background();
    match result {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(status) => {
            eprintln!("drop-desktop: browser exited with {status}");
            ExitCode::FAILURE
        }
        Err(err) => fatal(&err),
    }
}

async fn run() -> Result<ExitStatus, String> {
    let base = std::env::var("DROP_URL")
        .ok()
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_URL.into());
    let browser = browser::find(&browser::candidates())?;
    let config = dirs::config_dir().ok_or("user config directory not found")?;
    let profile = browser::profile_dir(&config)
        .map_err(|err| format!("create browser profile directory: {err}"))?;
    let token = server::new_token()?;
    let server = server::start(token.clone())
        .await
        .map_err(|err| format!("bind loopback listener: {err}"))?;
    let url = launch_url(&base, server.port, &token)?;

    eprintln!("drop-desktop: listening on 127.0.0.1:{}", server.port);
    let status = browser::run(&browser, &url, &profile).await;
    server.stop().await;
    status.map_err(|err| format!("start {}: {err}", browser.display()))
}

/// Appends `dropPort` and `dropToken`, replacing earlier values and keeping other parameters.
fn launch_url(base: &str, port: u16, token: &str) -> Result<String, String> {
    let mut url = Url::parse(base).map_err(|err| format!("invalid DROP_URL {base:?}: {err}"))?;
    let kept: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "dropPort" && key != "dropToken")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.query_pairs_mut()
        .clear()
        .extend_pairs(kept)
        .append_pair("dropPort", &port.to_string())
        .append_pair("dropToken", token);
    Ok(url.into())
}

/// Reports a fatal error: a message dialog on Windows (no console there), stderr elsewhere.
fn fatal(message: &str) -> ExitCode {
    eprintln!("drop-desktop: {message}");
    if cfg!(windows) {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Drop")
            .set_description(message)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
    ExitCode::FAILURE
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
