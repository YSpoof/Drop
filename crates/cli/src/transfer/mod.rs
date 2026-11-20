//! Transfer engine for one peer connection: control dispatch, receive and send.
//!
//! The engine never touches the WebRTC peer directly: it writes to a [`Link`] whose
//! [`Outbound`] half is pumped into the peer by the session (or read by tests), and reads an
//! [`Inbound`]. Receive state ([`Inbox`]) and the send queue ([`Outbox`]) outlive a connection.

pub mod partial;
pub mod receive;
pub mod send;

use std::sync::{Arc, Mutex};

use bytes::Bytes;
use tokio::sync::mpsc;
use tokio::time::{Instant, sleep_until};

pub use receive::Inbox;
pub use send::{Outbox, Outgoing};

use crate::config::{Direction, Store};
use crate::protocol::Ctrl;
use crate::rtc::{Inbound, Peer};
use crate::state::{Command, Shared};

/// `files` frames the link holds before `chunk` waits for the pump.
const LINK_CHUNKS: usize = 16;

/// Outbound half of a connection.
#[derive(Clone)]
pub struct Link {
    /// File bytes per `files` frame (without the stream header), announced in `start`.
    pub chunk_size: usize,
    ctrl: mpsc::UnboundedSender<Ctrl>,
    files: mpsc::Sender<Bytes>,
}

/// What the engine queued for the peer, in order per channel.
pub struct Outbound {
    pub ctrl: mpsc::UnboundedReceiver<Ctrl>,
    pub files: mpsc::Receiver<Bytes>,
}

impl Link {
    pub fn new(chunk_size: usize) -> (Self, Outbound) {
        let (ctrl_tx, ctrl) = mpsc::unbounded_channel();
        let (files_tx, files) = mpsc::channel(LINK_CHUNKS);
        let link = Self {
            chunk_size,
            ctrl: ctrl_tx,
            files: files_tx,
        };
        (link, Outbound { ctrl, files })
    }

    /// Queues a control message; a dead link is noticed through the peer.
    pub fn send(&self, msg: Ctrl) {
        let _ = self.ctrl.send(msg);
    }

    /// Queues a `files` frame; `false` once the link is gone.
    pub async fn chunk(&self, data: Bytes) -> bool {
        self.files.send(data).await.is_ok()
    }
}

impl Outbound {
    /// Writes queued traffic to `peer` until every [`Link`] is dropped or a send fails.
    pub async fn pump(self, peer: Arc<Peer>) {
        let Self {
            mut ctrl,
            mut files,
        } = self;
        let ctrl = async {
            while let Some(msg) = ctrl.recv().await {
                if peer.send_ctrl(&msg.encode()).await.is_err() {
                    break;
                }
            }
        };
        let files = async {
            while let Some(chunk) = files.recv().await {
                if peer.send_file_chunk(&chunk).await.is_err() {
                    break;
                }
            }
        };
        tokio::join!(ctrl, files);
    }
}

/// Session-wide context for the engine.
#[derive(Clone)]
pub struct Cx {
    pub state: Shared,
    pub store: Arc<Mutex<Store>>,
}

impl Cx {
    /// Adds one completed file to the persisted totals; a failed save is not fatal.
    pub fn record(&self, direction: Direction, bytes: u64) {
        if let Ok(mut store) = self.store.lock() {
            let _ = store.add_transfer(direction, bytes);
        }
    }
}

/// Why a connection's engine stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    /// The peer sent `bye`.
    Bye,
    /// The user quit; `bye` was queued.
    Quit,
    /// Send-once work is done; `bye` was queued.
    Sent,
    /// The connection's channels are gone.
    Lost,
}

/// Runs the engine on one ready connection until it ends.
pub async fn run(
    link: &Link,
    inbound: Inbound,
    inbox: &mut Inbox,
    outbox: &mut Outbox,
    commands: &mut mpsc::Receiver<Command>,
    queue: &mut mpsc::UnboundedReceiver<Outgoing>,
    cx: &Cx,
) -> End {
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let end = tokio::select! {
        end = dispatch(link, inbound, inbox, commands, &events_tx, cx) => end,
        end = outbox.run(link, &mut events, queue, cx) => end,
    };
    if matches!(end, End::Quit | End::Sent) {
        link.send(Ctrl::Bye);
    }
    end
}

/// Routes `ctrl` messages: receive-side ones to the inbox, send-side ones to the outbox
/// (`cancel` to both), and applies UI commands.
async fn dispatch(
    link: &Link,
    mut inbound: Inbound,
    inbox: &mut Inbox,
    commands: &mut mpsc::Receiver<Command>,
    events: &mpsc::UnboundedSender<Ctrl>,
    cx: &Cx,
) -> End {
    loop {
        let deadline = inbox.deadline();
        tokio::select! {
            text = inbound.ctrl.recv() => {
                let Some(text) = text else { return End::Lost };
                let Ok(msg) = Ctrl::decode(&text) else { continue };
                match msg {
                    Ctrl::Meta { file_id, name, size, hash, .. } => {
                        inbox.on_meta(link, cx, file_id, name, size, hash).await;
                    }
                    Ctrl::Start { file_id, chunk_size, stream_id, .. } => {
                        inbox.on_start(link, cx, &file_id, chunk_size, stream_id).await;
                    }
                    Ctrl::Done { file_id } => inbox.on_done(link, cx, &file_id).await,
                    Ctrl::BatchDone => inbox.on_batch_done(cx),
                    Ctrl::Bye => return End::Bye,
                    Ctrl::Cancel { ref file_id, ref reason } => {
                        inbox.on_cancel(cx, file_id, reason.as_deref()).await;
                        let _ = events.send(msg);
                    }
                    other => {
                        let _ = events.send(other);
                    }
                }
            }
            frame = inbound.files.recv() => match frame {
                Some(frame) => inbox.on_frame(link, cx, frame).await,
                None => return End::Lost,
            },
            cmd = commands.recv() => match cmd {
                Some(Command::Pull(ids)) => inbox.pull(link, cx, &ids).await,
                Some(Command::Dismiss(ids)) => inbox.dismiss(link, cx, &ids).await,
                Some(Command::Quit) | None => return End::Quit,
            },
            () = sleep_until(deadline.unwrap_or_else(Instant::now)), if deadline.is_some() => {
                inbox.finish(link, cx).await;
            }
        }
    }
}
