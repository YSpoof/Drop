//! Signaling hub: PIN registry and message relay between WebSocket peers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::ws::{Message, WebSocket};
use drop_core::signaling::{
    ClientMessage, PeerInfo, SHARE_CODE_RANGE, ServerMessage, format_code, is_public_ipv4,
    normalize_code,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

/// Attempts to find a free PIN before giving up.
const CODE_TRIES: usize = 50;

/// Frames queued for one socket; a single writer task drains it.
pub type Outbox = UnboundedSender<ServerMessage>;

#[derive(Default)]
pub struct Hub {
    state: Mutex<State>,
    next_conn: AtomicU64,
}

#[derive(Default)]
struct State {
    peers: HashMap<String, Peer>,
    /// PIN → peer ID.
    codes: HashMap<String, String>,
}

struct Peer {
    conn_id: u64,
    outbox: Outbox,
    display_name: String,
    code: Option<String>,
    public_ipv4: String,
}

/// One WebSocket connection and the peer ID it announced last.
pub struct Conn {
    id: u64,
    outbox: Outbox,
    peer_id: Option<String>,
}

/// Runs one socket: a writer task drains the outbox, this task reads frames.
pub async fn run(hub: Arc<Hub>, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (outbox, mut queue) = unbounded_channel::<ServerMessage>();
    let writer = tokio::spawn(async move {
        while let Some(message) = queue.recv().await {
            let Ok(text) = serde_json::to_string(&message) else {
                continue;
            };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });
    let mut conn = hub.connect(outbox);
    // A received close frame is answered by the next read, which then ends the stream.
    while let Some(Ok(frame)) = stream.next().await {
        match frame {
            Message::Text(text) => hub.handle(&mut conn, text.as_bytes()),
            Message::Binary(data) => hub.handle(&mut conn, &data),
            _ => {}
        }
    }
    hub.disconnect(conn);
    writer.abort();
}

impl Hub {
    pub fn connect(&self, outbox: Outbox) -> Conn {
        let id = self.next_conn.fetch_add(1, Ordering::Relaxed);
        Conn {
            id,
            outbox,
            peer_id: None,
        }
    }

    /// Handles one client frame; unparsable frames are ignored.
    pub fn handle(&self, conn: &mut Conn, frame: &[u8]) {
        let Ok(message) = serde_json::from_slice::<ClientMessage>(frame) else {
            return;
        };
        match message {
            ClientMessage::Announce {
                peer_id,
                host,
                display_name,
                code,
                public_ipv4,
            } => {
                let peer = Peer {
                    conn_id: conn.id,
                    outbox: conn.outbox.clone(),
                    display_name,
                    code: None,
                    public_ipv4: Some(public_ipv4)
                        .filter(|ip| is_public_ipv4(ip))
                        .unwrap_or_default(),
                };
                self.announce(conn, peer_id, host, &code, peer);
            }
            ClientMessage::JoinCode { code, .. } => self.join(conn, &code),
            ClientMessage::Signal {
                target_peer_id,
                payload,
            } => self.signal(conn, &target_peer_id, payload),
            ClientMessage::Ping => send(&conn.outbox, ServerMessage::Pong),
            ClientMessage::Pong => {}
        }
    }

    /// Removes the peer this connection registered, unless a newer connection took it over.
    pub fn disconnect(&self, conn: Conn) {
        if let Some(peer_id) = conn.peer_id {
            self.lock().remove(&peer_id, conn.id);
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// PIN choice for hosts: requested, else the one this peer still owns, else a new one.
    /// Only a generated PIN is reported back with `code-assigned`.
    fn announce(
        &self,
        conn: &mut Conn,
        peer_id: String,
        host: bool,
        requested: &str,
        mut peer: Peer,
    ) {
        if peer_id.is_empty() {
            return;
        }
        let mut state = self.lock();
        if let Some(old) = conn.peer_id.replace(peer_id.clone())
            && old != peer_id
        {
            state.remove(&old, conn.id);
        }
        let previous = state
            .peers
            .get(&peer_id)
            .and_then(|existing| existing.code.clone());
        let reusable = previous.clone().filter(|code| state.owns(code, &peer_id));
        let requested = normalize_code(requested).map(str::to_owned);
        let (code, assigned) = match (host, requested, reusable) {
            (false, ..) => (None, false),
            (true, Some(code), _) | (true, None, Some(code)) => (Some(code), false),
            (true, None, None) => match generate_code(&state.codes) {
                Some(code) => (Some(code), true),
                None => return,
            },
        };
        if let Some(previous) = previous
            && code.as_ref() != Some(&previous)
            && state.owns(&previous, &peer_id)
        {
            state.codes.remove(&previous);
        }
        if let Some(code) = &code {
            state
                .codes
                .entry(code.clone())
                .or_insert_with(|| peer_id.clone());
        }
        peer.code = code.clone();
        state.peers.insert(peer_id, peer);
        if let (true, Some(code)) = (assigned, code) {
            send(&conn.outbox, ServerMessage::CodeAssigned { code });
        }
    }

    fn join(&self, conn: &Conn, code: &str) {
        let state = self.lock();
        let sender = conn
            .peer_id
            .as_ref()
            .and_then(|id| state.peers.get_key_value(id));
        let owner = normalize_code(code)
            .and_then(|code| state.codes.get(code))
            .and_then(|id| state.peers.get_key_value(id));
        match (sender, owner) {
            (Some((sender_id, sender)), Some((owner_id, owner))) if sender_id != owner_id => {
                let lan = !sender.public_ipv4.is_empty() && sender.public_ipv4 == owner.public_ipv4;
                let requester = info(sender_id, sender);
                send(&owner.outbox, ServerMessage::PeerJoining { requester, lan });
                send(
                    &conn.outbox,
                    ServerMessage::JoinAccepted {
                        host: info(owner_id, owner),
                        lan,
                    },
                );
            }
            _ => send(&conn.outbox, ServerMessage::JoinRejected),
        }
    }

    fn signal(&self, conn: &Conn, target: &str, payload: Value) {
        let state = self.lock();
        let sender = conn
            .peer_id
            .as_ref()
            .filter(|id| state.peers.contains_key(*id));
        if let (Some(from_peer_id), Some(target)) = (sender, state.peers.get(target)) {
            let from_peer_id = from_peer_id.clone();
            send(
                &target.outbox,
                ServerMessage::Signal {
                    from_peer_id,
                    payload,
                },
            );
        }
    }
}

impl State {
    fn owns(&self, code: &str, peer_id: &str) -> bool {
        self.codes.get(code).is_some_and(|owner| owner == peer_id)
    }

    /// Drops `peer_id` and its PIN when the entry still belongs to `conn_id`.
    fn remove(&mut self, peer_id: &str, conn_id: u64) {
        if self
            .peers
            .get(peer_id)
            .is_none_or(|peer| peer.conn_id != conn_id)
        {
            return;
        }
        if let Some(code) = self.peers.remove(peer_id).and_then(|peer| peer.code)
            && self.owns(&code, peer_id)
        {
            self.codes.remove(&code);
        }
    }
}

fn info(peer_id: &str, peer: &Peer) -> PeerInfo {
    PeerInfo {
        peer_id: peer_id.to_owned(),
        display_name: peer.display_name.clone(),
    }
}

/// A closed socket just loses the frame.
fn send(outbox: &Outbox, message: ServerMessage) {
    let _ = outbox.send(message);
}

/// A free PIN from cryptographic randomness, or `None` after `CODE_TRIES` collisions.
fn generate_code(codes: &HashMap<String, String>) -> Option<String> {
    (0..CODE_TRIES)
        .filter_map(|_| getrandom::u32().ok())
        .map(|n| format_code(n % SHARE_CODE_RANGE))
        .find(|code| !codes.contains_key(code))
}

#[cfg(test)]
#[path = "hub_tests.rs"]
mod tests;
