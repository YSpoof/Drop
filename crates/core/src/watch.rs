//! Settling filesystem watcher shared by the desktop host and the CLI.
//!
//! Watches a directory tree recursively, skips dot-prefixed entries, reports
//! removals immediately and additions once their size stops changing.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::task::{JoinHandle, JoinSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    Add { path: PathBuf, size: u64 },
    Unlink { path: PathBuf },
}

/// Stops watching and closes the event receiver when dropped.
pub struct Watcher {
    _notify: RecommendedWatcher,
    task: JoinHandle<()>,
}

impl Watcher {
    /// Starts watching `root`. Must be called within a tokio runtime.
    pub fn start(root: &Path) -> io::Result<(Watcher, UnboundedReceiver<WatchEvent>)> {
        Self::start_with(root, Settle::DEFAULT)
    }

    fn start_with(
        root: &Path,
        settle: Settle,
    ) -> io::Result<(Watcher, UnboundedReceiver<WatchEvent>)> {
        let runtime = tokio::runtime::Handle::try_current().map_err(io::Error::other)?;
        let root = std::path::absolute(root)?;
        if !std::fs::metadata(&root)?.is_dir() {
            return Err(io::ErrorKind::NotADirectory.into());
        }

        let (raw_tx, raw_rx) = mpsc::unbounded_channel();
        let mut notify = notify::recommended_watcher(move |res| {
            let _ = raw_tx.send(res);
        })
        .map_err(io::Error::other)?;
        notify
            .watch(&root, RecursiveMode::Recursive)
            .map_err(io::Error::other)?;

        let (tx, rx) = mpsc::unbounded_channel();
        let state = Loop {
            root,
            settle,
            tx,
            settling: HashSet::new(),
            tasks: JoinSet::new(),
        };
        let task = runtime.spawn(state.run(raw_rx));
        Ok((
            Watcher {
                _notify: notify,
                task,
            },
            rx,
        ))
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Debug, Clone, Copy)]
struct Settle {
    interval: Duration,
    max_polls: u32,
}

impl Settle {
    const DEFAULT: Settle = Settle {
        interval: Duration::from_millis(50),
        max_polls: 40,
    };

    /// Polls `read` until two consecutive readings match. After `max_polls`
    /// readings without stability, the last reading wins. `None` aborts.
    async fn run(self, mut read: impl FnMut() -> Option<u64>) -> Option<u64> {
        let mut previous = None;
        for _ in 0..self.max_polls {
            tokio::time::sleep(self.interval).await;
            let current = read()?;
            if previous == Some(current) {
                return previous;
            }
            previous = Some(current);
        }
        previous
    }
}

struct Loop {
    root: PathBuf,
    settle: Settle,
    tx: UnboundedSender<WatchEvent>,
    settling: HashSet<PathBuf>,
    tasks: JoinSet<(PathBuf, Option<u64>)>,
}

impl Loop {
    async fn run(mut self, mut raw: UnboundedReceiver<notify::Result<notify::Event>>) {
        loop {
            tokio::select! {
                Some(Ok((path, size))) = self.tasks.join_next(), if !self.tasks.is_empty() => {
                    self.settling.remove(&path);
                    if let Some(size) = size {
                        let _ = self.tx.send(WatchEvent::Add { path, size });
                    }
                }
                event = raw.recv() => match event {
                    Some(Ok(event)) => self.handle(event),
                    Some(Err(_)) => {}
                    None => return,
                },
                _ = self.tx.closed() => return,
            }
        }
    }

    fn handle(&mut self, event: notify::Event) {
        let mut paths = event.paths;
        paths.retain(|p| !is_hidden(&self.root, p));
        let paths = paths.into_iter();
        match event.kind {
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                paths.for_each(|p| self.added(p, true));
            }
            EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Any) => {
                paths.for_each(|p| self.added(p, false));
            }
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                paths.for_each(|p| self.unlink(p));
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => {
                paths.for_each(|p| match p.exists() {
                    true => self.added(p, true),
                    false => self.unlink(p),
                })
            }
            _ => {}
        }
    }

    /// Settles a file; a created directory has its existing files settled.
    fn added(&mut self, path: PathBuf, created: bool) {
        match std::fs::metadata(&path) {
            Ok(meta) if meta.is_dir() && created => {
                let mut files = Vec::new();
                collect_files(&path, &mut files);
                files.into_iter().for_each(|f| self.settle(f));
            }
            Ok(meta) if !meta.is_dir() => self.settle(path),
            _ => {}
        }
    }

    fn settle(&mut self, path: PathBuf) {
        if !self.settling.insert(path.clone()) {
            return;
        }
        let settle = self.settle;
        self.tasks.spawn(async move {
            let size = settle.run(|| file_size(&path)).await;
            (path, size)
        });
    }

    fn unlink(&self, path: PathBuf) {
        let _ = self.tx.send(WatchEvent::Unlink { path });
    }
}

fn file_size(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .filter(|m| !m.is_dir())
        .map(|m| m.len())
}

/// True when any component of `path` below `root` starts with a dot.
fn is_hidden(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .any(|c| c.as_os_str().as_encoded_bytes().starts_with(b"."))
}

/// Collects non-hidden regular files under `dir` without following symlinks.
fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().as_encoded_bytes().starts_with(b".") {
            continue;
        }
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect_files(&entry.path(), out),
            Ok(t) if t.is_file() => out.push(entry.path()),
            _ => {}
        }
    }
}

#[cfg(test)]
#[path = "watch_tests.rs"]
mod tests;
