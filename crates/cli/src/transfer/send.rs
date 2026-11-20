//! Send side: queue, announcements, pull gating, resume handshake and windowed streaming.
//!
//! Every queued file is announced with `meta` as soon as a connection is ready. Files are
//! then streamed one at a time: in the order announced for an automatic peer, in pull order
//! for a manual one.

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use bytes::Bytes;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::{Instant, sleep_until};

use super::{Cx, End, Link};
use crate::config::Direction;
use crate::device::random_hex;
use crate::protocol::{Ctrl, SEND_WINDOW, file_identity};
use crate::state::{Transfer, TransferStatus, update_transfer};
use crate::text;

pub const RESUME_TIMEOUT: Duration = Duration::from_secs(30);
pub const ACK_TIMEOUT: Duration = Duration::from_secs(15);
/// Failure reason when the receiver never acknowledges a file.
use crate::text::ACK_TIMED_OUT;
const MIME: &str = "application/octet-stream";

/// A file to send and the name announced for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub path: PathBuf,
    pub name: String,
}

impl Outgoing {
    /// A positional file, announced by its basename.
    pub fn file(path: PathBuf) -> Self {
        let name = announce_name(&path, None);
        Self { path, name }
    }

    /// A file under the watched `root`, announced as `<root name>/<relative path>`.
    pub fn watched(path: PathBuf, root: &Path) -> Self {
        let name = announce_name(&path, Some(root));
        Self { path, name }
    }
}

/// `meta.name` for `path`: relative to the parent of `root` with `/` separators, or the
/// basename without a root or when `path` is outside it.
pub fn announce_name(path: &Path, root: Option<&Path>) -> String {
    let base = || {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let relative = root.and_then(|root| {
        let root = std::path::absolute(root).ok()?;
        let path = std::path::absolute(path).ok()?;
        let parts: Vec<_> = path
            .strip_prefix(root.parent()?)
            .ok()?
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        (parts.len() > 1).then(|| parts.join("/"))
    });
    relative.unwrap_or_else(base)
}

struct Queued {
    entry: Outgoing,
    /// Announcement on the current connection.
    offer: Option<Offer>,
    /// `fileId` of this file's transfer row.
    row: Option<String>,
}

#[derive(Debug, Clone)]
struct Offer {
    id: String,
    size: u64,
    hash: String,
    /// The peer stopped this download (`download-aborted`); it waits for a new pull.
    aborted: bool,
}

/// Why streaming a file stopped early.
enum Stop {
    Aborted,
    Cancelled,
    Failed(String),
    Lost,
}

/// Per-connection inputs of the send loop.
pub(super) struct Io<'a> {
    pub link: &'a Link,
    pub events: &'a mut UnboundedReceiver<Ctrl>,
    pub queue: &'a mut UnboundedReceiver<Outgoing>,
    pub cx: &'a Cx,
}

/// The session's send queue. Unsent files stay queued across connections.
pub struct Outbox {
    queue: Vec<Queued>,
    pulls: Vec<String>,
    remote_manual: bool,
    /// Return [`End::Sent`] once the queue is empty.
    exit_when_sent: bool,
    sent_since_batch: bool,
    queue_open: bool,
}

impl Outbox {
    pub fn new(files: Vec<Outgoing>, exit_when_sent: bool) -> Self {
        let mut outbox = Self {
            queue: Vec::new(),
            pulls: Vec::new(),
            remote_manual: false,
            exit_when_sent,
            sent_since_batch: false,
            queue_open: true,
        };
        files.into_iter().for_each(|f| outbox.push(f));
        outbox
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Peer loss: announcements and pulls die with the connection; files stay queued.
    pub fn abort(&mut self) {
        self.queue.iter_mut().for_each(|q| q.offer = None);
        self.pulls.clear();
        self.remote_manual = false;
        self.sent_since_batch = false;
    }

    /// Queues `entry` unless the same path is already waiting.
    pub fn push(&mut self, entry: Outgoing) {
        if !self.queue.iter().any(|q| q.entry.path == entry.path) {
            self.queue.push(Queued {
                entry,
                offer: None,
                row: None,
            });
        }
    }

    pub(super) async fn run(
        &mut self,
        link: &Link,
        events: &mut UnboundedReceiver<Ctrl>,
        queue: &mut UnboundedReceiver<Outgoing>,
        cx: &Cx,
    ) -> End {
        let mut io = Io {
            link,
            events,
            queue,
            cx,
        };
        loop {
            while let Ok(event) = io.events.try_recv() {
                let _ = self.route(cx, "", event);
            }
            self.announce(&io).await;
            if let Some((entry, offer)) = self.next() {
                if let Err(Stop::Lost) = self.send(&mut io, &entry, &offer).await {
                    return End::Lost;
                }
                continue;
            }
            if std::mem::take(&mut self.sent_since_batch) {
                link.send(Ctrl::BatchDone);
            }
            if self.exit_when_sent && self.queue.is_empty() {
                return End::Sent;
            }
            if self.idle(&mut io).await.is_err() {
                return End::Lost;
            }
        }
    }

    /// Sends `meta` for queued files not announced on this connection yet.
    async fn announce(&mut self, io: &Io<'_>) {
        let mut at = 0;
        while at < self.queue.len() {
            if self.queue[at].offer.is_some() {
                at += 1;
                continue;
            }
            let (size, mtime_ms) = match stat(&self.queue[at].entry.path).await {
                Ok(stat) => stat,
                Err(err) => {
                    let gone = self.queue.remove(at);
                    let line = text::err_send_file(gone.entry.path.display(), err);
                    io.cx.state.send_modify(|s| s.status = line);
                    continue;
                }
            };
            let queued = &mut self.queue[at];
            let name = queued.entry.name.clone();
            let offer = Offer {
                id: random_hex(8).unwrap_or_default(),
                size,
                hash: file_identity(&name, size, mtime_ms),
                aborted: false,
            };
            io.link.send(Ctrl::Meta {
                file_id: offer.id.clone(),
                name: name.clone(),
                size,
                mime: MIME.into(),
                hash: Some(offer.hash.clone()),
            });
            let row = Transfer::new(&offer.id, &name, size, &offer.hash, Direction::Upload);
            let previous = queued.row.replace(offer.id.clone());
            io.cx
                .state
                .send_modify(|s| match previous.and_then(|old| s.transfer_mut(&old)) {
                    Some(old) => *old = row,
                    None => s.add_transfer(row),
                });
            queued.offer = Some(offer);
            at += 1;
        }
    }

    /// The next file to stream: first pulled one for a manual peer, else first announced.
    fn next(&mut self) -> Option<(Outgoing, Offer)> {
        let ready = |q: &Queued, id: Option<&str>| {
            q.offer
                .as_ref()
                .filter(|o| !o.aborted && id.is_none_or(|id| o.id == id))
                .map(|o| (q.entry.clone(), o.clone()))
        };
        if !self.remote_manual {
            return self.queue.iter().find_map(|q| ready(q, None));
        }
        while let Some(id) = self.pulls.first() {
            if let Some(found) = self.queue.iter().find_map(|q| ready(q, Some(id))) {
                return Some(found);
            }
            self.pulls.remove(0);
        }
        None
    }

    /// Streams one file and applies the outcome to the queue and its row.
    async fn send(&mut self, io: &mut Io<'_>, entry: &Outgoing, offer: &Offer) -> Result<(), Stop> {
        let id = offer.id.as_str();
        let result = self.stream(io, entry, offer).await;
        match result {
            Ok(()) => {
                self.remove(id);
                update_transfer(&io.cx.state, id, |t| {
                    t.set(TransferStatus::Completed, None);
                    t.bytes = offer.size;
                });
                io.cx.record(Direction::Upload, offer.size);
                self.sent_since_batch = true;
            }
            Err(Stop::Aborted) => self.aborted(io.cx, id),
            Err(Stop::Cancelled) => self.cancelled(io.cx, id),
            Err(Stop::Failed(reason)) => {
                self.remove(id);
                update_transfer(&io.cx.state, id, |t| {
                    t.set(TransferStatus::Failed, Some(&reason))
                });
                self.sent_since_batch = true;
            }
            Err(Stop::Lost) => return Err(Stop::Lost),
        }
        Ok(())
    }

    /// `start`, up to 30 s for `resume`, chunks within the window, `done`, up to 15 s for `ack`.
    async fn stream(
        &mut self,
        io: &mut Io<'_>,
        entry: &Outgoing,
        offer: &Offer,
    ) -> Result<(), Stop> {
        let (id, size) = (offer.id.as_str(), offer.size);
        let chunk = io.link.chunk_size.max(1);
        io.link.send(Ctrl::Start {
            file_id: id.into(),
            chunk_size: chunk as u32,
            offset: None,
        });
        let deadline = Instant::now() + RESUME_TIMEOUT;
        let offset = loop {
            match self.next_event(io, id, Some(deadline)).await? {
                None => break 0,
                Some(Ctrl::Resume {
                    hash, bytes_offset, ..
                }) if hash == offer.hash && bytes_offset < size => break bytes_offset,
                Some(Ctrl::Resume { .. }) => break 0,
                Some(_) => {}
            }
        };
        update_transfer(&io.cx.state, id, |t| {
            t.set(TransferStatus::Active, None);
            t.bytes = offset;
        });
        let mut file = open_at(&entry.path, offset).await.map_err(failed)?;
        let (mut sent, mut confirmed) = (offset, offset);
        while sent < size {
            let len = (chunk as u64).min(size - sent);
            while sent - confirmed + len > SEND_WINDOW {
                let event = self.next_event(io, id, None).await?;
                credit(io.cx, id, size, &mut confirmed, event);
            }
            let mut buf = vec![0; len as usize];
            file.read_exact(&mut buf).await.map_err(failed)?;
            self.send_chunk(io, id, size, &mut confirmed, Bytes::from(buf))
                .await?;
            sent += len;
        }
        io.link.send(Ctrl::Done { file_id: id.into() });
        let deadline = Instant::now() + ACK_TIMEOUT;
        loop {
            match self.next_event(io, id, Some(deadline)).await? {
                None => return Err(Stop::Failed(ACK_TIMED_OUT.into())),
                Some(Ctrl::Ack { .. }) => return Ok(()),
                event => credit(io.cx, id, size, &mut confirmed, event),
            }
        }
    }

    /// Queues one chunk while still reacting to control events.
    async fn send_chunk(
        &mut self,
        io: &mut Io<'_>,
        id: &str,
        size: u64,
        confirmed: &mut u64,
        chunk: Bytes,
    ) -> Result<(), Stop> {
        let link = io.link.clone();
        let send = link.chunk(chunk);
        tokio::pin!(send);
        loop {
            tokio::select! {
                sent = &mut send => return if sent { Ok(()) } else { Err(Stop::Lost) },
                event = self.next_event(io, id, None) => credit(io.cx, id, size, confirmed, event?),
            }
        }
    }

    /// Waits for one control event or queued file while nothing can be sent.
    async fn idle(&mut self, io: &mut Io<'_>) -> Result<(), Stop> {
        tokio::select! {
            event = io.events.recv() => {
                let _ = self.route(io.cx, "", event.ok_or(Stop::Lost)?);
            }
            entry = io.queue.recv(), if self.queue_open => match entry {
                Some(entry) => self.push(entry),
                None => self.queue_open = false,
            },
        }
        Ok(())
    }

    /// Waits for a `resume`, `credit` or `ack` of file `id` (`None` at `deadline`). Other
    /// events are applied on the way; an abort or cancel of `id` stops the file.
    async fn next_event(
        &mut self,
        io: &mut Io<'_>,
        id: &str,
        deadline: Option<Instant>,
    ) -> Result<Option<Ctrl>, Stop> {
        loop {
            tokio::select! {
                event = io.events.recv() => {
                    let event = event.ok_or(Stop::Lost)?;
                    if let Some(event) = self.route(io.cx, id, event)? {
                        return Ok(Some(event));
                    }
                }
                entry = io.queue.recv(), if self.queue_open => match entry {
                    Some(entry) => {
                        self.push(entry);
                        self.announce(io).await;
                    }
                    None => self.queue_open = false,
                },
                () = sleep_until(deadline.unwrap_or_else(Instant::now)), if deadline.is_some() => {
                    return Ok(None);
                }
            }
        }
    }

    fn route(&mut self, cx: &Cx, id: &str, event: Ctrl) -> Result<Option<Ctrl>, Stop> {
        match event {
            Ctrl::Resume { ref file_id, .. }
            | Ctrl::Credit { ref file_id, .. }
            | Ctrl::Ack { ref file_id }
                if file_id == id =>
            {
                return Ok(Some(event));
            }
            Ctrl::DownloadAborted { file_id } if file_id == id => return Err(Stop::Aborted),
            Ctrl::Cancel { file_id, .. } if file_id == id => return Err(Stop::Cancelled),
            Ctrl::DownloadMode { manual } => self.remote_manual = manual,
            Ctrl::Pull { file_id } => self.pull(&[file_id]),
            Ctrl::PullBatch { file_ids } => self.pull(&file_ids),
            Ctrl::DownloadAborted { file_id } => self.aborted(cx, &file_id),
            Ctrl::Cancel { file_id, .. } => self.cancelled(cx, &file_id),
            _ => {}
        }
        Ok(None)
    }

    fn pull(&mut self, ids: &[String]) {
        for id in ids {
            if let Some(offer) = self.offer_mut(id) {
                offer.aborted = false;
                self.pulls.push(id.clone());
            }
        }
    }

    /// `download-aborted`: the file goes back to pending until pulled again.
    fn aborted(&mut self, cx: &Cx, id: &str) {
        let Some(offer) = self.offer_mut(id) else {
            return;
        };
        offer.aborted = true;
        self.pulls.retain(|p| p != id);
        update_transfer(&cx.state, id, |t| {
            t.set(TransferStatus::Pending, None);
            t.bytes = 0;
        });
    }

    /// `cancel`: the peer does not want the file; it leaves the queue.
    fn cancelled(&mut self, cx: &Cx, id: &str) {
        if self.remove(id) {
            update_transfer(&cx.state, id, |t| t.set(TransferStatus::Cancelled, None));
        }
    }

    fn remove(&mut self, id: &str) -> bool {
        self.pulls.retain(|p| p != id);
        let before = self.queue.len();
        self.queue
            .retain(|q| q.offer.as_ref().is_none_or(|o| o.id != id));
        self.queue.len() != before
    }

    fn offer_mut(&mut self, id: &str) -> Option<&mut Offer> {
        self.queue
            .iter_mut()
            .filter_map(|q| q.offer.as_mut())
            .find(|o| o.id == id)
    }
}

/// Applies a `credit` of file `id`; progress stays below `size` until the `ack`.
fn credit(cx: &Cx, id: &str, size: u64, confirmed: &mut u64, event: Option<Ctrl>) {
    let Some(Ctrl::Credit { bytes_written, .. }) = event else {
        return;
    };
    if bytes_written <= *confirmed {
        return;
    }
    *confirmed = bytes_written;
    if bytes_written < size {
        update_transfer(&cx.state, id, |t| t.bytes = bytes_written);
    }
}

fn failed(err: std::io::Error) -> Stop {
    Stop::Failed(err.to_string())
}

async fn stat(path: &Path) -> std::io::Result<(u64, i64)> {
    let meta = tokio::fs::metadata(path).await?;
    if !meta.is_file() {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    let mtime_ms = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    Ok((meta.len(), mtime_ms))
}

async fn open_at(path: &Path, offset: u64) -> std::io::Result<File> {
    let mut file = File::open(path).await?;
    file.seek(SeekFrom::Start(offset)).await?;
    Ok(file)
}

#[cfg(test)]
#[path = "send_tests.rs"]
mod tests;
