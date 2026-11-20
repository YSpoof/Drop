//! Signaling WebSocket client: one task owns the socket, sends heartbeats and answers pings.

use std::fmt;
use std::time::Duration;

use drop_core::signaling::{ClientMessage, ServerMessage};
use futures_util::{Sink, SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio::time::{self, Instant, MissedTickBehavior};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::{self, Message};

use crate::text;

pub const DEFAULT_URL: &str = "wss://drop.lzart.com.br/ws";
pub const URL_ENV: &str = "DROP_WS_URL";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const PING_INTERVAL: Duration = Duration::from_secs(15);

/// Maps `http(s)` to `ws(s)`, adds `wss://` when the scheme is missing; empty means the default.
pub fn normalize_url(raw: &str) -> String {
    const SCHEMES: [(&str, &str); 4] = [
        ("https://", "wss://"),
        ("http://", "ws://"),
        ("wss://", "wss://"),
        ("ws://", "ws://"),
    ];
    let raw = match raw.trim() {
        "" => DEFAULT_URL,
        raw => raw,
    };
    SCHEMES
        .iter()
        .find_map(|(from, to)| raw.strip_prefix(from).map(|rest| format!("{to}{rest}")))
        .unwrap_or_else(|| format!("wss://{raw}"))
}

/// `DROP_WS_URL` or the default, normalized.
pub fn url_from_env() -> String {
    normalize_url(&std::env::var(URL_ENV).unwrap_or_default())
}

/// An open signaling connection.
pub struct Connection {
    pub sender: Sender,
    /// Server frames other than `ping`/`pong`; yields `None` once the socket is gone.
    pub inbound: mpsc::UnboundedReceiver<ServerMessage>,
}

/// Outbound handle; cheap to clone.
#[derive(Clone)]
pub struct Sender(mpsc::UnboundedSender<Outbound>);

enum Outbound {
    Frame(ClientMessage),
    Close,
}

impl Sender {
    /// Queues a frame for the socket task.
    pub fn send(&self, msg: ClientMessage) -> Result<(), Closed> {
        self.0.send(Outbound::Frame(msg)).map_err(|_| Closed)
    }

    /// Closes the socket; pending frames queued before this call are still written.
    pub fn close(&self) {
        let _ = self.0.send(Outbound::Close);
    }

    /// Resolves once the socket task has ended.
    pub async fn closed(&self) {
        self.0.closed().await
    }
}

/// The signaling socket is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Closed;

impl fmt::Display for Closed {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(text::ERR_SIGNALING_CLOSED)
    }
}

impl std::error::Error for Closed {}

#[derive(Debug)]
pub enum ConnectError {
    Timeout,
    Ws(Box<tungstenite::Error>),
}

impl fmt::Display for ConnectError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::Timeout => f.write_str(text::ERR_SIGNALING_TIMEOUT),
            Self::Ws(err) => err.fmt(f),
        }
    }
}

impl std::error::Error for ConnectError {}

/// Dials `url` (10 s limit) and starts the socket task with a 15 s heartbeat.
pub async fn connect(url: &str) -> Result<Connection, ConnectError> {
    connect_with(url, PING_INTERVAL).await
}

async fn connect_with(url: &str, ping_every: Duration) -> Result<Connection, ConnectError> {
    let (ws, _) = time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| ConnectError::Timeout)?
        .map_err(|err| ConnectError::Ws(Box::new(err)))?;
    let (out_tx, out_rx) = mpsc::unbounded_channel();
    let (in_tx, in_rx) = mpsc::unbounded_channel();
    tokio::spawn(run(ws, out_rx, in_tx, ping_every));
    Ok(Connection {
        sender: Sender(out_tx),
        inbound: in_rx,
    })
}

async fn run<S>(
    ws: WebSocketStream<S>,
    mut outbound: mpsc::UnboundedReceiver<Outbound>,
    inbound: mpsc::UnboundedSender<ServerMessage>,
    ping_every: Duration,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut sink, mut stream) = ws.split();
    let mut ping = time::interval_at(Instant::now() + ping_every, ping_every);
    ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        let reply = tokio::select! {
            frame = stream.next() => match frame {
                Some(Ok(Message::Text(frame))) => match serde_json::from_str(&frame) {
                    Ok(ServerMessage::Ping) => Some(ClientMessage::Pong),
                    Ok(ServerMessage::Pong) | Err(_) => None,
                    Ok(msg) => {
                        let _ = inbound.send(msg);
                        None
                    }
                },
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => None,
            },
            cmd = outbound.recv() => match cmd {
                Some(Outbound::Frame(msg)) => Some(msg),
                Some(Outbound::Close) | None => break,
            },
            _ = ping.tick() => Some(ClientMessage::Ping),
        };
        if let Some(msg) = reply
            && !write(&mut sink, &msg).await
        {
            break;
        }
    }
    let _ = time::timeout(WRITE_TIMEOUT, sink.close()).await;
}

async fn write(sink: &mut (impl Sink<Message> + Unpin), msg: &ClientMessage) -> bool {
    let Ok(frame) = serde_json::to_string(msg) else {
        return true;
    };
    matches!(
        time::timeout(WRITE_TIMEOUT, sink.send(Message::text(frame))).await,
        Ok(Ok(()))
    )
}

#[cfg(test)]
#[path = "signaling_tests.rs"]
mod tests;
