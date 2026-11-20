//! Locates Chrome, Chromium or Edge and runs it in app mode.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;

use tokio::process::Command;

pub const WIDTH: u32 = 1024;
pub const HEIGHT: u32 = 768;

const LINUX: [&str; 7] = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/local/bin/google-chrome",
    "/usr/local/bin/chromium",
    "/snap/bin/chromium",
];

const WINDOWS: [(&str, &str); 8] = [
    ("ProgramFiles", r"Google\Chrome\Application\chrome.exe"),
    ("ProgramFiles(x86)", r"Google\Chrome\Application\chrome.exe"),
    ("LocalAppData", r"Google\Chrome\Application\chrome.exe"),
    ("ProgramFiles", r"Chromium\Application\chrome.exe"),
    ("ProgramFiles(x86)", r"Chromium\Application\chrome.exe"),
    ("LocalAppData", r"Chromium\Application\chrome.exe"),
    (
        "ProgramFiles(x86)",
        r"Microsoft\Edge\Application\msedge.exe",
    ),
    ("ProgramFiles", r"Microsoft\Edge\Application\msedge.exe"),
];

const FLAGS: [&str; 18] = [
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-infobars",
    "--disable-extensions",
    "--disable-features=LocalNetworkAccessChecks",
    "--disable-hang-monitor",
    "--disable-popup-blocking",
    "--disable-prompt-on-repost",
    "--disable-renderer-backgrounding",
    "--disable-sync",
    "--disable-translate",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
];

/// Browser paths for the current OS, in lookup order.
pub fn candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        windows_candidates(|key| std::env::var_os(key))
    } else {
        linux_candidates(Path::new("/"))
    }
}

pub fn linux_candidates(root: &Path) -> Vec<PathBuf> {
    LINUX
        .iter()
        .map(|path| root.join(path.trim_start_matches('/')))
        .collect()
}

/// Roots whose variable is unset are skipped.
pub fn windows_candidates(var: impl Fn(&str) -> Option<OsString>) -> Vec<PathBuf> {
    WINDOWS
        .iter()
        .filter_map(|(key, tail)| {
            let root = PathBuf::from(var(key)?);
            Some(tail.split('\\').fold(root, |path, part| path.join(part)))
        })
        .collect()
}

/// First existing file wins.
pub fn find(candidates: &[PathBuf]) -> Result<PathBuf, String> {
    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            let searched: Vec<String> =
                candidates.iter().map(|p| p.display().to_string()).collect();
            format!(
                "Chrome, Chromium or Edge is required but was not found; searched: {}",
                searched.join(", ")
            )
        })
}

pub fn arguments(url: &str, profile: &Path) -> Vec<String> {
    let platform = if cfg!(windows) {
        "--disable-windows10-custom-titlebar"
    } else {
        "--password-store=basic"
    };
    let mut args = vec![
        format!("--app={url}"),
        format!("--user-data-dir={}", profile.display()),
    ];
    args.extend(FLAGS.iter().map(|flag| flag.to_string()));
    args.push(format!("--window-size={WIDTH},{HEIGHT}"));
    args.push(platform.into());
    args
}

/// Creates `<config>/Drop/Chrome` (mode 0700 on Unix) and returns it.
pub fn profile_dir(config: &Path) -> io::Result<PathBuf> {
    let dir = config.join("Drop").join("Chrome");
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(&dir)?;
    Ok(dir)
}

/// Runs the browser and waits for it to exit.
pub async fn run(browser: &Path, url: &str, profile: &Path) -> io::Result<ExitStatus> {
    Command::new(browser)
        .args(arguments(url, profile))
        .status()
        .await
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod tests;
