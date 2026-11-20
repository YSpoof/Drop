//! Clipboard writes through the platform's clipboard program.
//! A clipboard crate would lose the X11 selection when the process exits.

use std::io::{self, ErrorKind};
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::text;

type Tool = (&'static str, &'static [&'static str]);

#[cfg(target_os = "linux")]
const TOOLS: &[Tool] = &[
    ("wl-copy", &[]),
    ("xclip", &["-selection", "clipboard"]),
    ("xsel", &["--clipboard", "--input"]),
];

#[cfg(windows)]
const TOOLS: &[Tool] = &[("clip.exe", &[])];

/// Puts `content` on the system clipboard, trying each tool in order.
pub async fn copy(content: &str) -> io::Result<()> {
    copy_with(TOOLS, content).await
}

async fn copy_with(tools: &[(&str, &[&str])], content: &str) -> io::Result<()> {
    let mut failures = Vec::new();
    for (program, args) in tools {
        match pipe(program, args, content).await {
            Ok(()) => return Ok(()),
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => failures.push(format!("{program}: {err}")),
        }
    }
    if failures.is_empty() {
        return Err(io::Error::new(
            ErrorKind::NotFound,
            text::ERR_CLIPBOARD_UNAVAILABLE,
        ));
    }
    Err(io::Error::other(failures.join("; ")))
}

/// Runs `program args`, writes `content` to its stdin and waits for a zero exit.
async fn pipe(program: &str, args: &[&str], content: &str) -> io::Result<()> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let mut stdin = child.stdin.take().expect("stdin is piped");
    stdin.write_all(content.as_bytes()).await?;
    drop(stdin);
    let status = child.wait().await?;
    if !status.success() {
        return Err(io::Error::other(status.to_string()));
    }
    Ok(())
}

#[cfg(test)]
#[path = "clipboard_tests.rs"]
mod tests;
