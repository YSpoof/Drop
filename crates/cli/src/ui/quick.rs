//! Quick mode: one session with auto-download and line output.
//!
//! When stdin is a TTY, raw mode (no alternate screen) reads `c` / `C` (host only) and Ctrl+C,
//! which shows the confirm overlay briefly; lines then end in `\r\n`. Off a TTY there is no
//! raw mode and SIGINT ends the run at once (a second SIGINT stops waiting for the cleanup).

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{self, IsTerminal, Write};
use std::sync::{Arc, Mutex};

use crossterm::event::KeyEvent;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::format::format_bytes;
use super::inbox::copy_request;
use super::{Clipboard, CopyKind, CopyRequest, Feedback, RawKeys, is_interrupt, typed_char};
use crate::app::Error;
use crate::args::Role;
use crate::config::Store;
use crate::session::{self, Options, Outcome};
use crate::state::{Command, Direction, SessionState, Shared, TransferStatus};
use crate::text;

/// Writes operator lines; under raw mode every line feed becomes `\r\n`.
pub struct LineWriter<W> {
    out: W,
    raw: bool,
}

impl<W: Write> LineWriter<W> {
    pub fn new(out: W, raw: bool) -> Self {
        Self { out, raw }
    }

    /// Best effort: a closed stdout must not stop the transfer.
    pub fn line(&mut self, line: &str) {
        let (line, eol) = match self.raw {
            true => (to_crlf(line), "\r\n"),
            false => (Cow::Borrowed(line), "\n"),
        };
        let _ = write!(self.out, "{line}{eol}").and_then(|()| self.out.flush());
    }
}

/// Turns bare `\n` into `\r\n`, leaving existing `\r\n` alone.
pub fn to_crlf(s: &str) -> Cow<'_, str> {
    if !s.contains('\n') {
        return Cow::Borrowed(s);
    }
    let mut out = String::with_capacity(s.len() + 8);
    let mut prev = None;
    for c in s.chars() {
        if c == '\n' && prev != Some('\r') {
            out.push('\r');
        }
        out.push(c);
        prev = Some(c);
    }
    Cow::Owned(out)
}

/// Turns session state changes into operator lines.
#[derive(Debug, Default)]
pub struct Printer {
    status: String,
    /// Print the copy-key hint once the host PIN is known.
    copy_hint: bool,
    hinted: bool,
    transfers: HashMap<String, TransferStatus>,
}

impl Printer {
    pub fn new(copy_hint: bool) -> Self {
        Self {
            copy_hint,
            ..Self::default()
        }
    }

    /// Lines for what changed since the last call: the status line, the copy hint, and
    /// transfer starts (sends), completions and failures.
    pub fn lines(&mut self, s: &SessionState) -> Vec<String> {
        let mut lines = Vec::new();
        if s.status != self.status {
            self.status.clone_from(&s.status);
            if !s.status.is_empty() {
                lines.push(s.status.clone());
            }
        }
        if self.copy_hint && !self.hinted && s.host && s.pin.is_some() {
            self.hinted = true;
            lines.push(text::PRESS_COPY_HINT.into());
        }
        for t in &s.transfers {
            if self.transfers.insert(t.id.clone(), t.status) == Some(t.status) {
                continue;
            }
            let line = match (t.direction, t.status) {
                (Direction::Upload, TransferStatus::Active) => text::transferring_file(&t.name),
                (Direction::Upload, TransferStatus::Completed) => text::transfer_complete(&t.name),
                (Direction::Download, TransferStatus::Completed) => {
                    let name = t.saved_as.as_deref().unwrap_or(&t.name);
                    text::received_file(name, format_bytes(t.size))
                }
                (_, TransferStatus::Failed | TransferStatus::Cancelled) => {
                    text::transfer_failed(&t.name, t.reason.as_deref())
                }
                _ => continue,
            };
            lines.push(line);
        }
        lines
    }
}

/// Runs a quick session until it ends; a confirmed cancel is a clean exit.
pub async fn run(
    opts: Options,
    store: Arc<Mutex<Store>>,
    clipboard: Clipboard,
) -> Result<(), Error> {
    let keys = match io::stdin().is_terminal() {
        true => Some(RawKeys::start().map_err(Error::Terminal)?),
        false => None,
    };
    let raw = keys.is_some();
    let host = opts.role == Role::Host;
    let mut out = LineWriter::new(io::stdout(), raw);
    for dir in &opts.dirs {
        out.line(&text::watching_dir(dir.display()));
    }
    let state = Shared::new(SessionState::default());
    let (commands, rx) = mpsc::channel(8);
    let session = tokio::spawn(session::run(opts, state.clone(), store, rx));
    let mut quick = Quick {
        state,
        commands,
        keys,
        host,
        clipboard,
        printer: Printer::new(host && raw),
        out,
        err: LineWriter::new(io::stderr(), raw),
        quitting: false,
        failure: None,
    };
    let outcome = quick.drive(session).await;
    quick.print();
    drop(quick.keys.take());
    match (quick.failure, outcome) {
        (Some(err), _) => Err(Error::Terminal(err)),
        (None, outcome) => outcome.map(drop).map_err(Error::Session),
    }
}

struct Quick {
    state: Shared,
    commands: mpsc::Sender<Command>,
    keys: Option<RawKeys>,
    host: bool,
    clipboard: Clipboard,
    printer: Printer,
    out: LineWriter<io::Stdout>,
    err: LineWriter<io::Stderr>,
    quitting: bool,
    /// A terminal error; the session is quit and the error reported once it ends.
    failure: Option<io::Error>,
}

impl Quick {
    async fn drive(
        &mut self,
        mut session: tokio::task::JoinHandle<Result<Outcome, session::Error>>,
    ) -> Result<Outcome, session::Error> {
        let mut changes = self.state.subscribe();
        let mut copies = JoinSet::new();
        loop {
            tokio::select! {
                joined = &mut session => return match joined {
                    Ok(outcome) => outcome,
                    Err(err) if err.is_panic() => std::panic::resume_unwind(err.into_panic()),
                    Err(_) => Ok(Outcome::Quit),
                },
                Ok(()) = changes.changed() => self.print(),
                key = next_key(&mut self.keys) => match key {
                    Ok(key) => {
                        if let Some(CopyRequest { kind, content }) = self.on_key(key).await {
                            let copy = (self.clipboard)(content);
                            copies.spawn(async move { (kind, copy.await) });
                        }
                    }
                    Err(err) => self.fail(err),
                },
                _ = tokio::signal::ctrl_c() => match self.quitting {
                    true => session.abort(),
                    false => self.quit(),
                },
                Some(Ok((kind, result))) = copies.join_next() => {
                    self.err.line(&Feedback::copied(kind, &result).text);
                }
            }
        }
    }

    fn print(&mut self) {
        for line in self.printer.lines(&self.state.borrow()) {
            self.out.line(&line);
        }
    }

    /// Ctrl+C asks for confirmation; `c` / `C` return what to copy (host only).
    async fn on_key(&mut self, key: KeyEvent) -> Option<CopyRequest> {
        if is_interrupt(&key) {
            let confirmed = self.keys.as_mut()?.confirm_exit().await;
            match confirmed {
                Ok(true) => self.quit(),
                Ok(false) => {}
                Err(err) => self.fail(err),
            }
            return None;
        }
        let kind = match (self.host, typed_char(&key)) {
            (true, Some('c')) => CopyKind::Pin,
            (true, Some('C')) => CopyKind::Link,
            _ => return None,
        };
        copy_request(&self.state.borrow(), kind)
    }

    fn quit(&mut self) {
        self.quitting = true;
        let _ = self.commands.try_send(Command::Quit);
    }

    fn fail(&mut self, err: io::Error) {
        self.keys = None;
        self.failure = Some(err);
        self.quit();
    }
}

async fn next_key(keys: &mut Option<RawKeys>) -> io::Result<KeyEvent> {
    match keys {
        Some(keys) => keys.next_key().await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
#[path = "quick_tests.rs"]
mod tests;
