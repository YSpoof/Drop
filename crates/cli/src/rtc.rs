//! WebRTC peer: one connection carrying `ctrl` (JSON text) and `files` (raw bytes).
//!
//! Signaling is decoupled: outbound payloads go to an `mpsc` sender, inbound payloads are
//! fed through [`Peer::handle_signal`]. Payloads use the FastRTC envelope the browser speaks:
//! `{type:"description",description:{type,sdp}}` and `{type:"candidate",candidate:{…}}`.

use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock, Weak};

use ::rtc::peer_connection::configuration::setting_engine::SctpMaxMessageSize;
use bytes::{Bytes, BytesMut};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc, watch};
use webrtc::data_channel::{DataChannel, DataChannelEvent, RTCDataChannelInit};
use webrtc::error::{Error, Result};
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder,
    RTCIceCandidateInit, RTCIceServer, RTCPeerConnectionIceEvent, RTCPeerConnectionState,
    RTCSdpType, RTCSessionDescription, SettingEngineBuilder,
};

pub const STUN_SERVER: &str = "stun:stun.l.google.com:19302";
pub const CTRL: &str = "ctrl";
pub const FILES: &str = "files";
/// Chunk size when the negotiated SCTP max message size is unknown.
pub const FALLBACK_CHUNK: usize = 64 * 1024;
/// Upper bound for the chunk size, also advertised as our SDP `max-message-size`.
pub const MAX_CHUNK: usize = 256 * 1024;
/// Per-channel unacknowledged bytes before `send_file_chunk` waits.
const SEND_BUFFER_LIMIT: usize = 4 * 1024 * 1024;
const INBOUND_CAPACITY: usize = 64;

/// Chunk size for a negotiated SCTP max message size (`None` before negotiation).
pub fn chunk_size_for(negotiated: Option<u32>) -> usize {
    match negotiated {
        None | Some(0) | Some(u32::MAX) => FALLBACK_CHUNK,
        Some(size) => (size as usize).min(MAX_CHUNK),
    }
}

#[derive(Debug, Clone)]
pub struct RtcConfig {
    /// ICE server URLs; empty for host candidates only.
    pub ice_servers: Vec<String>,
    /// Local UDP sockets; a wildcard binds every non-loopback interface.
    pub udp_addrs: Vec<String>,
}

impl Default for RtcConfig {
    fn default() -> Self {
        Self {
            ice_servers: vec![STUN_SERVER.into()],
            udp_addrs: vec!["0.0.0.0:0".into()],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Connecting,
    Ready,
    Closed,
}

/// Inbound traffic: `ctrl` text frames and `files` binary frames, in arrival order.
pub struct Inbound {
    pub ctrl: mpsc::Receiver<String>,
    pub files: mpsc::Receiver<Bytes>,
}

pub struct Peer {
    pc: Arc<dyn PeerConnection>,
    shared: Arc<Shared>,
    /// Remote candidates held until the remote description is set; `None` afterwards.
    pending: Mutex<Option<Vec<RTCIceCandidateInit>>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Signal {
    Description {
        description: Box<RTCSessionDescription>,
    },
    Candidate {
        candidate: RTCIceCandidateInit,
    },
}

impl Peer {
    /// Creates the connection. The peer whose ID is the smaller string creates `ctrl` then
    /// `files` and sends the offer; the other one answers.
    pub async fn connect(
        local_id: &str,
        remote_id: &str,
        config: &RtcConfig,
        signal_tx: mpsc::UnboundedSender<Value>,
    ) -> Result<(Self, Inbound)> {
        let (ctrl_tx, ctrl) = mpsc::channel(INBOUND_CAPACITY);
        let (files_tx, files) = mpsc::channel(INBOUND_CAPACITY);
        let shared = Arc::new(Shared {
            pc: OnceLock::new(),
            ctrl: OnceLock::new(),
            files: OnceLock::new(),
            opened: AtomicU8::new(0),
            chunk_size: AtomicUsize::new(FALLBACK_CHUNK),
            status: watch::Sender::new(Status::Connecting),
            ctrl_tx,
            files_tx,
            signal_tx,
        });
        let pc: Arc<dyn PeerConnection> = Arc::new(build(config, shared.clone()).await?);
        let _ = shared.pc.set(Arc::downgrade(&pc));
        let peer = Self {
            pc,
            shared,
            pending: Mutex::new(Some(Vec::new())),
        };
        if local_id < remote_id {
            peer.offer().await?;
        }
        Ok((peer, Inbound { ctrl, files }))
    }

    async fn offer(&self) -> Result<()> {
        for label in [CTRL, FILES] {
            let init = RTCDataChannelInit::default(); // ordered and reliable
            let channel = self.pc.create_data_channel(label, Some(init)).await?;
            attach(&self.shared, channel, label);
        }
        let offer = self.pc.create_offer(None).await?;
        self.pc.set_local_description(offer.clone()).await?;
        self.shared.signal(description_payload(&offer));
        Ok(())
    }

    /// Applies a signal payload from the remote peer.
    pub async fn handle_signal(&self, payload: Value) -> Result<()> {
        let signal = serde_json::from_value(payload).map_err(|e| Error::Other(e.to_string()))?;
        let mut pending = self.pending.lock().await;
        match (signal, pending.as_mut()) {
            (Signal::Candidate { candidate }, Some(queue)) => {
                queue.push(candidate);
                Ok(())
            }
            (Signal::Candidate { candidate }, None) => self.pc.add_ice_candidate(candidate).await,
            (Signal::Description { description }, _) => {
                let is_offer = description.sdp_type == RTCSdpType::Offer;
                self.pc.set_remote_description(*description).await?;
                for candidate in pending.take().unwrap_or_default() {
                    let _ = self.pc.add_ice_candidate(candidate).await;
                }
                if is_offer {
                    let answer = self.pc.create_answer(None).await?;
                    self.pc.set_local_description(answer.clone()).await?;
                    self.shared.signal(description_payload(&answer));
                }
                Ok(())
            }
        }
    }

    pub fn status(&self) -> Status {
        *self.shared.status.borrow()
    }

    /// Resolves `true` once both channels are open, `false` if the peer closed first.
    pub async fn ready(&self) -> bool {
        let mut rx = self.shared.status.subscribe();
        let status = rx.wait_for(|s| *s != Status::Connecting).await;
        status.is_ok_and(|s| *s == Status::Ready)
    }

    /// Resolves when the connection is closed locally or lost.
    pub async fn closed(&self) {
        let mut rx = self.shared.status.subscribe();
        let _ = rx.wait_for(|s| *s == Status::Closed).await;
    }

    /// `min(negotiated SCTP max message size, 256 KiB)`, 64 KiB when unknown. Final once ready.
    pub fn chunk_size(&self) -> usize {
        self.shared.chunk_size.load(Ordering::Acquire)
    }

    pub async fn send_ctrl(&self, text: &str) -> Result<()> {
        channel(&self.shared.ctrl)?.send_text(text).await
    }

    /// Sends one binary frame on `files`, waiting while the channel's unacknowledged
    /// bytes are above the send-buffer limit.
    pub async fn send_file_chunk(&self, chunk: &[u8]) -> Result<()> {
        channel(&self.shared.files)?
            .send(BytesMut::from(chunk))
            .await
    }

    pub async fn close(&self) {
        self.shared.set_status(Status::Closed);
        let _ = self.pc.close().await;
    }
}

fn channel(slot: &OnceLock<Arc<dyn DataChannel>>) -> Result<&Arc<dyn DataChannel>> {
    slot.get().ok_or(Error::ErrDataChannelNotOpen)
}

async fn build(config: &RtcConfig, shared: Arc<Shared>) -> Result<impl PeerConnection> {
    let mut ice_servers = Vec::new();
    if !config.ice_servers.is_empty() {
        ice_servers.push(RTCIceServer {
            urls: config.ice_servers.clone(),
            ..Default::default()
        });
    }
    let settings = SettingEngineBuilder::new()
        .with_sctp_max_message_size(SctpMaxMessageSize::Bounded(MAX_CHUNK as u32))
        .build();
    PeerConnectionBuilder::new()
        .with_configuration(
            RTCConfigurationBuilder::new()
                .with_ice_servers(ice_servers)
                .build(),
        )
        .with_setting_engine(settings)
        .with_handler(Arc::new(Handler(shared)))
        .with_udp_addrs(config.udp_addrs.clone())
        .with_data_channel_send_buffer_limit(SEND_BUFFER_LIMIT)
        .build()
        .await
}

fn description_payload(desc: &RTCSessionDescription) -> Value {
    json!({ "type": "description", "description": { "type": desc.sdp_type.to_string(), "sdp": desc.sdp } })
}

fn candidate_payload(mut init: RTCIceCandidateInit) -> Value {
    // webrtc-rs reports `sdpMid: ""`; browsers resolve by `sdpMLineIndex` when the mid is null.
    init.sdp_mid = init.sdp_mid.filter(|mid| !mid.is_empty());
    json!({ "type": "candidate", "candidate": init })
}

#[derive(Clone, Copy)]
enum Kind {
    Ctrl = 1,
    Files = 2,
}

struct Shared {
    pc: OnceLock<Weak<dyn PeerConnection>>,
    ctrl: OnceLock<Arc<dyn DataChannel>>,
    files: OnceLock<Arc<dyn DataChannel>>,
    /// Bit set of opened channels (`Kind` values).
    opened: AtomicU8,
    chunk_size: AtomicUsize,
    status: watch::Sender<Status>,
    ctrl_tx: mpsc::Sender<String>,
    files_tx: mpsc::Sender<Bytes>,
    signal_tx: mpsc::UnboundedSender<Value>,
}

impl Shared {
    fn signal(&self, payload: Value) {
        let _ = self.signal_tx.send(payload);
    }

    /// Moves `Connecting → Ready` or `* → Closed`; `Closed` is final.
    fn set_status(&self, next: Status) {
        self.status.send_if_modified(|current| {
            let allowed = matches!(
                (*current, next),
                (Status::Connecting, Status::Ready)
                    | (Status::Connecting | Status::Ready, Status::Closed)
            );
            if allowed {
                *current = next;
            }
            allowed
        });
    }

    async fn opened(&self, kind: Kind) {
        let bit = kind as u8;
        let all = Kind::Ctrl as u8 | Kind::Files as u8;
        if self.opened.fetch_or(bit, Ordering::AcqRel) | bit != all {
            return;
        }
        let negotiated = self.negotiated_max_message_size().await;
        self.chunk_size
            .store(chunk_size_for(negotiated), Ordering::Release);
        self.set_status(Status::Ready);
    }

    /// W3C `RTCSctpTransport.maxMessageSize`: our configured 256 KiB reconciled with the
    /// remote SDP `max-message-size` (64 KiB when the remote omits it).
    async fn negotiated_max_message_size(&self) -> Option<u32> {
        let pc = self.pc.get()?.upgrade()?;
        pc.sctp().await?.max_message_size().await.ok()
    }
}

/// Registers a `ctrl` or `files` channel and pumps its events; other labels are ignored.
fn attach(shared: &Arc<Shared>, channel: Arc<dyn DataChannel>, label: &str) {
    let (kind, slot) = match label {
        CTRL => (Kind::Ctrl, &shared.ctrl),
        FILES => (Kind::Files, &shared.files),
        _ => return,
    };
    if slot.set(channel.clone()).is_err() {
        return;
    }
    tokio::spawn(pump(shared.clone(), channel, kind));
}

async fn pump(shared: Arc<Shared>, channel: Arc<dyn DataChannel>, kind: Kind) {
    while let Some(event) = channel.poll().await {
        match (event, kind) {
            (DataChannelEvent::OnOpen, _) => shared.opened(kind).await,
            (DataChannelEvent::OnMessage(msg), Kind::Ctrl) => {
                let text = String::from_utf8_lossy(&msg.data).into_owned();
                let _ = shared.ctrl_tx.send(text).await;
            }
            (DataChannelEvent::OnMessage(msg), Kind::Files) => {
                let _ = shared.files_tx.send(msg.data.freeze()).await;
            }
            (DataChannelEvent::OnClose, _) => break,
            _ => {}
        }
    }
    shared.set_status(Status::Closed);
}

struct Handler(Arc<Shared>);

#[async_trait::async_trait]
impl PeerConnectionEventHandler for Handler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Ok(init) = event.candidate.to_json() {
            self.0.signal(candidate_payload(init));
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        if matches!(
            state,
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
        ) {
            self.0.set_status(Status::Closed);
        }
    }

    async fn on_data_channel(&self, channel: Arc<dyn DataChannel>) {
        if let Ok(label) = channel.label().await {
            attach(&self.0, channel, &label);
        }
    }
}

#[cfg(test)]
#[path = "rtc_tests.rs"]
mod tests;
