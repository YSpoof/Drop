//! Receive side: offers, pull rules, aligned resume, credits, verification and finalize.

use std::path::{Path, PathBuf};
use std::time::Duration;

use bytes::Bytes;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::time::Instant;

use super::{Cx, Link, partial};
use crate::config::Direction;
use crate::device::random_hex;
use crate::protocol::{CREDIT_BATCH, Ctrl, SEND_WINDOW};
use crate::state::{Offer, Transfer, TransferStatus, update_transfer};
use crate::text;

/// How long chunks may still arrive after `done` before the size is checked.
pub const DONE_GRACE: Duration = Duration::from_secs(5);
/// Failure reason when the written length differs from `meta.size`.
use crate::text::SIZE_MISMATCH;

#[derive(Debug, Clone)]
struct Meta {
    id: String,
    name: String,
    size: u64,
    hash: String,
}

struct Active {
    meta: Meta,
    file: File,
    received: u64,
    credited: u64,
    /// Set by `done` while bytes are still missing.
    done_by: Option<Instant>,
}

/// Receive state for a session. Offers and the active file belong to one connection and are
/// dropped by [`Inbox::abort`]; partials on disk outlive it.
pub struct Inbox {
    dir: PathBuf,
    /// Interactive inbox: offers wait for a local pull.
    manual: bool,
    pending: Vec<Meta>,
    /// Pulled, waiting for `start`.
    awaiting: Vec<Meta>,
    active: Option<Active>,
    /// Chunks that arrived before `start` was handled.
    early: Vec<Bytes>,
    /// A receive was just stopped: chunks still in flight for it are dropped, not buffered.
    stale: bool,
    completed_in_batch: usize,
}

impl Inbox {
    pub fn new(dir: PathBuf, manual: bool) -> Self {
        Self {
            dir,
            manual,
            pending: Vec::new(),
            awaiting: Vec::new(),
            active: None,
            early: Vec::new(),
            stale: false,
            completed_in_batch: 0,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Peer loss: closes the active file and forgets this connection's offers. Partials stay.
    pub async fn abort(&mut self) {
        if let Some(mut active) = self.active.take() {
            let _ = active.file.flush().await;
        }
        self.pending.clear();
        self.awaiting.clear();
        self.early.clear();
        self.stale = false;
    }

    /// User cancel or a different peer: removes every partial in the download folder.
    pub async fn discard_all(&mut self) {
        self.abort().await;
        let _ = partial::discard_all(&self.dir).await;
    }

    /// When the size check for a file whose `done` came early is due.
    pub fn deadline(&self) -> Option<Instant> {
        self.active.as_ref().and_then(|a| a.done_by)
    }

    /// Auto mode pulls every offer; manual mode pulls only offers with a retained partial.
    pub(super) async fn on_meta(
        &mut self,
        link: &Link,
        cx: &Cx,
        id: String,
        name: String,
        size: u64,
        hash: Option<String>,
    ) {
        let hash = hash
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| format!("ephemeral|{}", random_hex(16).unwrap_or_default()));
        let offset = partial::resume_offset(&self.dir, &hash, size)
            .await
            .unwrap_or(0);
        let meta = Meta {
            id,
            name,
            size,
            hash,
        };
        if self.manual && offset == 0 {
            cx.state.send_modify(|s| s.offers.push(offer(&meta)));
            self.pending.push(meta);
            return;
        }
        add_row(cx, &meta, offset);
        link.send(Ctrl::Pull {
            file_id: meta.id.clone(),
        });
        self.awaiting.push(meta);
    }

    /// Pulls pending offers: one `pull`, or `pull-batch` for several.
    pub(super) async fn pull(&mut self, link: &Link, cx: &Cx, ids: &[String]) {
        let mut pulled = Vec::new();
        for id in ids {
            if let Some(meta) = take(&mut self.pending, id) {
                let offset = partial::resume_offset(&self.dir, &meta.hash, meta.size)
                    .await
                    .unwrap_or(0);
                add_row(cx, &meta, offset);
                pulled.push(meta.id.clone());
                self.awaiting.push(meta);
            }
        }
        cx.state.send_modify(|s| s.remove_offers(&pulled));
        match pulled.len() {
            0 => {}
            1 => link.send(Ctrl::Pull {
                file_id: pulled.remove(0),
            }),
            _ => link.send(Ctrl::PullBatch { file_ids: pulled }),
        }
    }

    /// Removes offers or downloads without keeping anything and tells the peer.
    pub(super) async fn dismiss(&mut self, link: &Link, cx: &Cx, ids: &[String]) {
        for id in ids {
            let Some(hash) = self.forget(id) else {
                continue;
            };
            partial::discard(&self.dir, &hash).await;
            link.send(Ctrl::DownloadAborted {
                file_id: id.clone(),
            });
        }
        cx.state.send_modify(|s| {
            s.remove_offers(ids);
            s.transfers.retain(|t| !ids.contains(&t.id));
        });
    }

    /// The peer cancelled a file: drop it and its partial.
    pub(super) async fn on_cancel(&mut self, cx: &Cx, id: &str, reason: Option<&str>) {
        let Some(hash) = self.forget(id) else {
            return;
        };
        partial::discard(&self.dir, &hash).await;
        cx.state.send_modify(|s| {
            s.remove_offers(&[id.to_string()]);
            if let Some(t) = s.transfer_mut(id) {
                t.set(TransferStatus::Cancelled, reason);
            }
        });
    }

    /// Opens the partial at the chunk-aligned resume offset and always answers `resume`.
    /// A `start` for an unpulled offer is refused with `download-aborted`, an unknown one
    /// with `cancel`.
    pub(super) async fn on_start(&mut self, link: &Link, cx: &Cx, id: &str, chunk_size: u32) {
        let Some(meta) = take(&mut self.awaiting, id) else {
            let file_id = id.to_string();
            link.send(match self.pending.iter().any(|m| m.id == id) {
                true => Ctrl::DownloadAborted { file_id },
                false => Ctrl::Cancel {
                    file_id,
                    reason: None,
                },
            });
            return;
        };
        if let Some(mut previous) = self.active.take() {
            let _ = previous.file.flush().await;
            update_transfer(&cx.state, &previous.meta.id, |t| {
                t.set(TransferStatus::Failed, None)
            });
        }
        let raw = partial::resume_offset(&self.dir, &meta.hash, meta.size)
            .await
            .unwrap_or(0);
        let offset = align_down(raw, chunk_size);
        let file = match partial::open(&self.dir, &meta.hash, offset).await {
            Ok(file) => file,
            Err(err) => return fail(link, cx, &meta, err.to_string()),
        };
        update_transfer(&cx.state, id, |t| {
            t.set(TransferStatus::Active, None);
            t.bytes = offset;
        });
        link.send(Ctrl::Resume {
            file_id: meta.id.clone(),
            hash: meta.hash.clone(),
            bytes_offset: offset,
        });
        self.stale = false;
        self.active = Some(Active {
            meta,
            file,
            received: offset,
            credited: offset,
            done_by: None,
        });
        for chunk in std::mem::take(&mut self.early) {
            self.write(link, cx, chunk).await;
        }
    }

    pub(super) async fn on_chunk(&mut self, link: &Link, cx: &Cx, chunk: Bytes) {
        if self.active.is_some() {
            return self.write(link, cx, chunk).await;
        }
        let buffered: usize = self.early.iter().map(Bytes::len).sum();
        if !self.stale && (buffered + chunk.len()) as u64 <= SEND_WINDOW {
            self.early.push(chunk);
        }
    }

    /// Finishes now when every byte is in, otherwise gives in-flight chunks [`DONE_GRACE`].
    pub(super) async fn on_done(&mut self, link: &Link, cx: &Cx, id: &str) {
        let Some(active) = self.active.as_mut().filter(|a| a.meta.id == id) else {
            return;
        };
        match active.received >= active.meta.size {
            true => self.finish(link, cx).await,
            false => active.done_by = Some(Instant::now() + DONE_GRACE),
        }
    }

    pub(super) fn on_batch_done(&mut self, cx: &Cx) {
        let count = std::mem::take(&mut self.completed_in_batch);
        if count > 0 {
            cx.state
                .send_modify(|s| s.status = text::batch_complete(count));
        }
    }

    /// Verifies the length, then finalizes and sends `ack`, or discards and sends `cancel`.
    pub(super) async fn finish(&mut self, link: &Link, cx: &Cx) {
        let Some(mut active) = self.active.take() else {
            return;
        };
        self.stale = true;
        let flushed = active.file.flush().await;
        drop(active.file);
        let meta = active.meta;
        let result = match (flushed, active.received == meta.size) {
            (Err(err), _) => Err(err.to_string()),
            (Ok(()), false) => Err(SIZE_MISMATCH.to_string()),
            (Ok(()), true) => partial::finalize(&self.dir, &meta.hash, &meta.name)
                .await
                .map_err(|err| err.to_string()),
        };
        let saved = match result {
            Ok(saved) => saved,
            Err(reason) => {
                partial::discard(&self.dir, &meta.hash).await;
                return fail(link, cx, &meta, reason);
            }
        };
        update_transfer(&cx.state, &meta.id, |t| {
            t.set(TransferStatus::Completed, None);
            t.bytes = meta.size;
            t.saved_as = Some(saved);
        });
        cx.record(Direction::Download, meta.size);
        self.completed_in_batch += 1;
        link.send(Ctrl::Ack { file_id: meta.id });
    }

    /// Writes one chunk and credits the absolute accepted offset every 1 MiB and at the end.
    async fn write(&mut self, link: &Link, cx: &Cx, chunk: Bytes) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        if let Err(err) = active.file.write_all(&chunk).await {
            let meta = self.active.take().map(|a| a.meta).expect("active receive");
            self.stale = true;
            partial::discard(&self.dir, &meta.hash).await;
            return fail(link, cx, &meta, err.to_string());
        }
        active.received += chunk.len() as u64;
        let received = active.received;
        if received - active.credited >= CREDIT_BATCH || received >= active.meta.size {
            active.credited = received;
            link.send(Ctrl::Credit {
                file_id: active.meta.id.clone(),
                bytes_written: received,
            });
        }
        update_transfer(&cx.state, &active.meta.id, |t| t.bytes = received);
        if active.done_by.is_some() && received >= active.meta.size {
            self.finish(link, cx).await;
        }
    }

    /// Drops `id` from every stage and returns its identity hash.
    fn forget(&mut self, id: &str) -> Option<String> {
        if self.active.as_ref().is_some_and(|a| a.meta.id == id) {
            self.stale = true;
            return self.active.take().map(|a| a.meta.hash);
        }
        take(&mut self.pending, id)
            .or_else(|| take(&mut self.awaiting, id))
            .map(|m| m.hash)
    }
}

fn take(list: &mut Vec<Meta>, id: &str) -> Option<Meta> {
    let at = list.iter().position(|m| m.id == id)?;
    Some(list.remove(at))
}

fn offer(meta: &Meta) -> Offer {
    Offer {
        file_id: meta.id.clone(),
        name: meta.name.clone(),
        size: meta.size,
    }
}

fn add_row(cx: &Cx, meta: &Meta, offset: u64) {
    let mut row = Transfer::new(
        &meta.id,
        &meta.name,
        meta.size,
        &meta.hash,
        Direction::Download,
    );
    row.bytes = offset;
    cx.state.send_modify(|s| s.add_transfer(row));
}

fn fail(link: &Link, cx: &Cx, meta: &Meta, reason: String) {
    update_transfer(&cx.state, &meta.id, |t| {
        t.set(TransferStatus::Failed, Some(&reason))
    });
    link.send(Ctrl::Cancel {
        file_id: meta.id.clone(),
        reason: Some(reason),
    });
}

/// `offset` rounded down to a multiple of `chunk` (0 for a zero chunk size).
pub fn align_down(offset: u64, chunk: u32) -> u64 {
    match chunk {
        0 => 0,
        chunk => offset - offset % u64::from(chunk),
    }
}

#[cfg(test)]
#[path = "receive_tests.rs"]
mod tests;
