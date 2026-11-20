//! Session state shared with the UI, and the commands the UI sends back.
//!
//! Session tasks write through [`Shared::send_modify`], which also wakes UI tasks waiting on
//! `subscribe().changed()`; the UI may instead read `borrow()` on its 200 ms tick.

use tokio::sync::watch;

pub use crate::config::Direction;
use crate::text;

/// The one shared state handle; clone it freely.
pub type Shared = watch::Sender<SessionState>;

/// UI → session requests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Download these pending offers.
    Pull(Vec<String>),
    /// Remove these offers (pending or downloading) without keeping anything.
    Dismiss(Vec<String>),
    /// End the session (confirmed cancel): `bye`, partials discarded.
    Quit,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionState {
    /// Own peer ID (share link `hostid`).
    pub peer_id: String,
    /// Signaling URL (share link origin).
    pub signaling_url: String,
    pub host: bool,
    /// Host: the assigned PIN once known. Joiner: the PIN being joined.
    pub pin: Option<String>,
    pub phase: Phase,
    pub peer: Option<RemotePeer>,
    /// Files announced by the peer that wait for `Baixar` or `Remover`.
    pub offers: Vec<Offer>,
    /// Transfers in both directions, oldest first.
    pub transfers: Vec<Transfer>,
    /// Latest operator line (pt-BR).
    pub status: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Phase {
    #[default]
    Signaling,
    WaitingForPeer,
    Connecting,
    Connected,
    Reconnecting,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemotePeer {
    pub id: String,
    pub name: String,
    pub lan: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub file_id: String,
    /// Relative `/`-separated path from `meta.name`.
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transfer {
    /// `fileId` of the current announcement.
    pub id: String,
    pub name: String,
    pub size: u64,
    /// Drop identity `name|size|mtimeMs`.
    pub hash: String,
    pub direction: Direction,
    pub status: TransferStatus,
    /// Bytes written (receive) or confirmed by the receiver (send).
    pub bytes: u64,
    /// Why the transfer is failed, cancelled, or back to pending (pt-BR).
    pub reason: Option<String>,
    /// Final path relative to the download folder, once received.
    pub saved_as: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferStatus {
    Pending,
    Active,
    Completed,
    Cancelled,
    Failed,
}

impl Transfer {
    pub fn new(id: &str, name: &str, size: u64, hash: &str, direction: Direction) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            size,
            hash: hash.into(),
            direction,
            status: TransferStatus::Pending,
            bytes: 0,
            reason: None,
            saved_as: None,
        }
    }

    pub fn finished(&self) -> bool {
        !matches!(
            self.status,
            TransferStatus::Pending | TransferStatus::Active
        )
    }

    pub fn set(&mut self, status: TransferStatus, reason: Option<&str>) {
        self.status = status;
        self.reason = reason.map(str::to_string);
    }
}

impl SessionState {
    pub fn transfer_mut(&mut self, id: &str) -> Option<&mut Transfer> {
        self.transfers.iter_mut().find(|t| t.id == id)
    }

    /// Adds a transfer. A receive replaces unfinished receive rows of the same identity, in
    /// place of the first one, so a resumed file keeps a single row.
    pub fn add_transfer(&mut self, row: Transfer) {
        let replaces = |t: &Transfer| {
            row.direction == Direction::Download
                && t.direction == Direction::Download
                && !row.hash.is_empty()
                && t.hash == row.hash
                && t.status != TransferStatus::Completed
        };
        let at = self
            .transfers
            .iter()
            .position(|t| replaces(t) || t.id == row.id);
        self.transfers.retain(|t| !replaces(t) && t.id != row.id);
        let at = at.unwrap_or(self.transfers.len()).min(self.transfers.len());
        self.transfers.insert(at, row);
    }

    pub fn remove_transfer(&mut self, id: &str) {
        self.transfers.retain(|t| t.id != id);
    }

    pub fn remove_offers(&mut self, ids: &[String]) {
        self.offers.retain(|o| !ids.contains(&o.file_id));
    }

    /// Peer loss: unfinished receives fail with `conexão perdida`, unfinished sends go back to
    /// pending, and offers of the dead connection disappear.
    pub fn interrupt(&mut self) {
        self.offers.clear();
        for t in self.transfers.iter_mut().filter(|t| !t.finished()) {
            let status = match t.direction {
                Direction::Download => TransferStatus::Failed,
                Direction::Upload => TransferStatus::Pending,
            };
            t.set(status, Some(text::PEER_LOST));
        }
    }
}

/// Applies `f` to the transfer `id`, if listed.
pub fn update_transfer(state: &Shared, id: &str, f: impl FnOnce(&mut Transfer)) {
    state.send_modify(|s| {
        if let Some(t) = s.transfer_mut(id) {
            f(t);
        }
    });
}

/// Replaces the status line.
pub fn set_status(state: &Shared, line: impl Into<String>) {
    let line = line.into();
    state.send_modify(|s| s.status = line);
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
