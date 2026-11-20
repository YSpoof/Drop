//! One host or join session: signaling, pairing, first ready, transfers, and the
//! wait-to-reconnect loop after peer loss.

use std::fmt;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use drop_core::signaling::{ClientMessage, PeerInfo, ServerMessage};
use drop_core::watch::{WatchEvent, Watcher};
use serde_json::Value;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::time::{Instant, sleep, sleep_until, timeout};

use crate::args::Role;
use crate::config::Store;
use crate::device::Device;
use crate::protocol::Ctrl;
use crate::rtc::{Inbound, Peer, RtcConfig};
use crate::signaling::{self, Connection};
use crate::state::{Command, Phase, RemotePeer, Shared, set_status};
use crate::text;
use crate::transfer::{self, Cx, End, Inbox, Link, Outbox, Outgoing};

/// Limit for a pairing to reach ready.
pub const READY_TIMEOUT: Duration = Duration::from_secs(15);
/// Delay before a joiner re-joins, or signaling is redialed, after a loss.
pub const RETRY_DELAY: Duration = Duration::from_secs(2);
/// Time for queued control messages (`bye`) to leave before the peer is closed.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);
const CLOSE_GRACE: Duration = Duration::from_millis(250);

pub struct Options {
    pub role: Role,
    pub signaling_url: String,
    pub device: Device,
    /// Absolute download folder for this run.
    pub download_dir: PathBuf,
    /// Interactive inbox: announce manual download mode and wait for local pulls.
    pub manual: bool,
    /// Files sent once.
    pub files: Vec<PathBuf>,
    /// Directories watched for new files.
    pub dirs: Vec<PathBuf>,
    pub rtc: RtcConfig,
}

/// How a session ended without error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The peer sent `bye`.
    Bye,
    /// The user quit; partials were discarded.
    Quit,
    /// Quick mode sent every positional file.
    Sent,
}

#[derive(Debug)]
pub enum Error {
    DownloadDir(io::Error),
    Watch(PathBuf, io::Error),
    Signaling(signaling::ConnectError),
    SignalingClosed,
    JoinRejected(String),
    ReadyTimeout,
    PeerFailed,
    WebRtc(webrtc::error::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Self::DownloadDir(err) => f.write_str(&text::err_ensure_download_dir(err)),
            Self::Watch(dir, err) => f.write_str(&text::err_watch_dir(dir.display(), err)),
            Self::Signaling(err) => f.write_str(&text::err_connect_signaling(err)),
            Self::SignalingClosed => f.write_str(text::ERR_SIGNALING_CLOSED),
            Self::JoinRejected(pin) => f.write_str(&text::err_join_rejected(pin)),
            Self::ReadyTimeout => f.write_str(text::ERR_WEBRTC_TIMEOUT),
            Self::PeerFailed => f.write_str(text::ERR_WEBRTC_PEER_FAILED),
            Self::WebRtc(err) => f.write_str(&text::err_webrtc_start(err)),
        }
    }
}

impl std::error::Error for Error {}

/// Runs a session until `bye`, quit, send-once completion, or an error before the first ready.
pub async fn run(
    opts: Options,
    state: Shared,
    store: Arc<Mutex<Store>>,
    commands: mpsc::Receiver<Command>,
) -> Result<Outcome, Error> {
    tokio::fs::create_dir_all(&opts.download_dir)
        .await
        .map_err(Error::DownloadDir)?;
    let (queue_tx, queue) = mpsc::unbounded_channel();
    let watchers = opts
        .dirs
        .iter()
        .map(|dir| watch(dir, queue_tx.clone()))
        .collect::<Result<Vec<_>, _>>()?;
    let joining = match &opts.role {
        Role::Host => None,
        Role::Join(pin) => Some(pin.clone()),
    };
    state.send_modify(|s| {
        s.peer_id = opts.device.peer_id.clone();
        s.signaling_url = opts.signaling_url.clone();
        s.host = joining.is_none();
        s.pin = joining.clone();
        s.phase = Phase::Signaling;
    });
    let sig = signaling::connect(&opts.signaling_url)
        .await
        .map_err(Error::Signaling)?;
    let exit_when_sent = !opts.manual && !opts.files.is_empty() && opts.dirs.is_empty();
    let files = opts.files.iter().cloned().map(Outgoing::file).collect();
    let mut session = Session {
        inbox: Inbox::new(opts.download_dir.clone(), opts.manual),
        outbox: Outbox::new(files, exit_when_sent),
        cx: Cx { state, store },
        opts,
        sig: Some(sig),
        pin: joining,
        commands,
        queue,
        _watchers: watchers,
        last_peer: None,
        ever_ready: false,
        rejoin_at: None,
    };
    session.announce();
    session
        .cx
        .state
        .send_modify(|s| s.phase = Phase::WaitingForPeer);
    let outcome = session.run().await;
    if let Some(sig) = &session.sig {
        sig.sender.close();
    }
    session.cx.state.send_modify(|s| s.phase = Phase::Ended);
    outcome
}

/// Starts watching `dir`; settled new files are queued with names under the dir's basename.
fn watch(dir: &PathBuf, queue: UnboundedSender<Outgoing>) -> Result<Watcher, Error> {
    let (watcher, mut events) =
        Watcher::start(dir).map_err(|err| Error::Watch(dir.clone(), err))?;
    let root = std::path::absolute(dir).unwrap_or_else(|_| dir.clone());
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if let WatchEvent::Add { path, .. } = event
                && queue.send(Outgoing::watched(path, &root)).is_err()
            {
                break;
            }
        }
    });
    Ok(watcher)
}

/// A pairing announced by signaling.
struct Pairing {
    peer: PeerInfo,
    lan: bool,
    /// Host side (`peer-joining`) rather than joiner side (`join-accepted`).
    joined: bool,
}

/// What ended a wait or a connection.
enum Step {
    Pair(Pairing),
    Lost,
    Bye,
    Quit,
    Sent,
}

struct Session {
    opts: Options,
    cx: Cx,
    sig: Option<Connection>,
    /// Host: PIN to keep across signaling reconnects. Joiner: PIN joined.
    pin: Option<String>,
    commands: mpsc::Receiver<Command>,
    inbox: Inbox,
    outbox: Outbox,
    queue: UnboundedReceiver<Outgoing>,
    _watchers: Vec<Watcher>,
    /// Remote of the last ready connection.
    last_peer: Option<String>,
    ever_ready: bool,
    /// Joiner: when to send `join-code` again.
    rejoin_at: Option<Instant>,
}

impl Session {
    async fn run(&mut self) -> Result<Outcome, Error> {
        let mut pairing = None;
        loop {
            let step = match pairing.take() {
                Some(next) => self.attempt(next).await?,
                None => self.wait_pairing().await?,
            };
            match step {
                Step::Pair(next) => pairing = Some(next),
                Step::Lost => self.lost().await,
                Step::Bye => {
                    set_status(&self.cx.state, text::PEER_CLOSED_SESSION);
                    return Ok(Outcome::Bye);
                }
                Step::Quit => {
                    self.inbox.discard_all().await;
                    return Ok(Outcome::Quit);
                }
                Step::Sent => return Ok(Outcome::Sent),
            }
        }
    }

    /// Host: `announce` (keeping a known PIN). Joiner: `announce` then `join-code`.
    fn announce(&self) {
        let Some(sig) = &self.sig else { return };
        let device = &self.opts.device;
        let host = self.opts.role == Role::Host;
        let _ = sig.sender.send(ClientMessage::Announce {
            peer_id: device.peer_id.clone(),
            host,
            display_name: device.display_name.clone(),
            code: self.pin.clone().filter(|_| host).unwrap_or_default(),
            public_ipv4: String::new(),
        });
        if let (false, Some(pin)) = (host, &self.pin) {
            let _ = sig.sender.send(ClientMessage::JoinCode {
                peer_id: device.peer_id.clone(),
                code: pin.clone(),
            });
        }
    }

    /// Waits for the next pairing with no time limit.
    async fn wait_pairing(&mut self) -> Result<Step, Error> {
        loop {
            if self.sig.is_none() {
                if !self.ever_ready {
                    return Err(Error::SignalingClosed);
                }
                if let Some(step) = self.redial().await {
                    return Ok(step);
                }
            }
            tokio::select! {
                msg = recv(&mut self.sig) => match msg {
                    Some(msg) => {
                        if let Some(step) = self.on_server(msg)? {
                            return Ok(step);
                        }
                    }
                    None => self.sig = None,
                },
                cmd = self.commands.recv() => {
                    if matches!(cmd, Some(Command::Quit) | None) {
                        return Ok(Step::Quit);
                    }
                }
                () = sleep_until(self.rejoin_at.unwrap_or_else(Instant::now)), if self.rejoin_at.is_some() => {
                    self.rejoin_at = None;
                    self.announce();
                }
            }
        }
    }

    /// Redials signaling every [`RETRY_DELAY`] until it answers or the user quits.
    async fn redial(&mut self) -> Option<Step> {
        loop {
            tokio::select! {
                () = sleep(RETRY_DELAY) => {}
                cmd = self.commands.recv() => {
                    if matches!(cmd, Some(Command::Quit) | None) {
                        return Some(Step::Quit);
                    }
                    continue;
                }
            }
            if let Ok(sig) = signaling::connect(&self.opts.signaling_url).await {
                self.sig = Some(sig);
                self.announce();
                return None;
            }
        }
    }

    /// Applies a signaling frame received outside a connection attempt.
    fn on_server(&mut self, msg: ServerMessage) -> Result<Option<Step>, Error> {
        match msg {
            ServerMessage::CodeAssigned { code } => {
                self.pin = Some(code.clone());
                self.cx.state.send_modify(|s| {
                    s.status = text::assigned_pin(&code);
                    s.pin = Some(code);
                });
            }
            ServerMessage::PeerJoining { requester, lan } => {
                return Ok(Some(Step::Pair(Pairing {
                    peer: requester,
                    lan,
                    joined: true,
                })));
            }
            ServerMessage::JoinAccepted { host, lan } => {
                return Ok(Some(Step::Pair(Pairing {
                    peer: host,
                    lan,
                    joined: false,
                })));
            }
            ServerMessage::JoinRejected if !self.ever_ready => {
                return Err(Error::JoinRejected(self.pin.clone().unwrap_or_default()));
            }
            ServerMessage::JoinRejected => self.rejoin_at = Some(Instant::now() + RETRY_DELAY),
            ServerMessage::Signal { .. } | ServerMessage::Ping | ServerMessage::Pong => {}
        }
        Ok(None)
    }

    /// Connects to a paired peer, waits for ready, then runs the transfer engine.
    async fn attempt(&mut self, pairing: Pairing) -> Result<Step, Error> {
        self.rejoin_at = None;
        let remote = pairing.peer.clone();
        let name = match remote.display_name.as_str() {
            "" => remote.peer_id.clone(),
            name => name.to_string(),
        };
        self.cx.state.send_modify(|s| {
            s.phase = Phase::Connecting;
            s.peer = Some(RemotePeer {
                id: remote.peer_id.clone(),
                name: name.clone(),
                lan: pairing.lan,
            });
            s.status = match pairing.joined {
                true => text::peer_joined(&name),
                false => text::join_accepted(&name),
            };
        });
        let (signal_tx, signal_rx) = mpsc::unbounded_channel();
        let connected = Peer::connect(
            &self.opts.device.peer_id,
            &remote.peer_id,
            &self.opts.rtc,
            signal_tx,
        )
        .await;
        let (peer, inbound) = match connected {
            Ok((peer, inbound)) => (Arc::new(peer), inbound),
            Err(err) => return self.failed(Error::WebRtc(err)),
        };
        if let Some(sig) = &self.sig {
            forward_signals(signal_rx, sig.sender.clone(), remote.peer_id.clone());
        }
        let step = match self.wait_ready(&peer, &remote.peer_id).await {
            Ok(None) => self.connected(&peer, inbound, &remote.peer_id).await,
            Ok(Some(step)) => step,
            Err(err) => {
                peer.close().await;
                return self.failed(err);
            }
        };
        peer.close().await;
        Ok(step)
    }

    /// Before the first ready a failed attempt ends the session; afterwards it waits again.
    fn failed(&mut self, err: Error) -> Result<Step, Error> {
        if !self.ever_ready {
            return Err(err);
        }
        set_status(&self.cx.state, text::reconnect_ready_failed(&err));
        Ok(Step::Lost)
    }

    /// `Ok(None)` once ready; `Ok(Some(step))` when the user quits or another pairing wins.
    async fn wait_ready(&mut self, peer: &Peer, remote: &str) -> Result<Option<Step>, Error> {
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            tokio::select! {
                ready = peer.ready() => return if ready { Ok(None) } else { Err(Error::PeerFailed) },
                msg = recv(&mut self.sig) => {
                    if let Some(step) = self.on_server_connected(peer, remote, msg).await? {
                        return Ok(Some(step));
                    }
                }
                cmd = self.commands.recv() => {
                    if matches!(cmd, Some(Command::Quit) | None) {
                        return Ok(Some(Step::Quit));
                    }
                }
                () = sleep_until(deadline) => return Err(Error::ReadyTimeout),
            }
        }
    }

    /// Signals for `remote` go to the peer; other server messages are handled as usual.
    async fn on_server_connected(
        &mut self,
        peer: &Peer,
        remote: &str,
        msg: Option<ServerMessage>,
    ) -> Result<Option<Step>, Error> {
        match msg {
            None => self.sig = None,
            Some(ServerMessage::Signal {
                from_peer_id,
                payload,
            }) if from_peer_id == remote => {
                let _ = peer.handle_signal(payload).await;
            }
            Some(msg) => return self.on_server(msg),
        }
        Ok(None)
    }

    /// Runs the transfer engine on a ready connection.
    async fn connected(&mut self, peer: &Arc<Peer>, inbound: Inbound, remote: &str) -> Step {
        if self.last_peer.as_deref().is_some_and(|last| last != remote) {
            self.inbox.discard_all().await;
        }
        self.last_peer = Some(remote.to_string());
        let status = match self.ever_ready {
            true => text::RECONNECTED_WAITING_FILES,
            false => text::CONNECTED_WAITING_FILES,
        };
        self.ever_ready = true;
        self.cx.state.send_modify(|s| {
            s.phase = Phase::Connected;
            s.status = status.into();
        });

        let (link, outbound) = Link::new(peer.chunk_size());
        link.send(Ctrl::DownloadMode {
            manual: self.opts.manual,
        });
        let pump = tokio::spawn(outbound.pump(peer.clone()));
        let step = {
            let engine = transfer::run(
                &link,
                inbound,
                &mut self.inbox,
                &mut self.outbox,
                &mut self.commands,
                &mut self.queue,
                &self.cx,
            );
            tokio::pin!(engine);
            loop {
                tokio::select! {
                    end = &mut engine => break match end {
                        End::Bye => Step::Bye,
                        End::Quit => Step::Quit,
                        End::Sent => Step::Sent,
                        End::Lost => Step::Lost,
                    },
                    () = peer.closed() => break Step::Lost,
                    msg = recv(&mut self.sig) => match msg {
                        None => self.sig = None,
                        Some(ServerMessage::Signal { from_peer_id, payload }) if from_peer_id == remote => {
                            let _ = peer.handle_signal(payload).await;
                        }
                        // Only the current peer may re-pair (e.g. after a reload); anyone else
                        // holding the PIN must not take over an active connection.
                        Some(ServerMessage::PeerJoining { requester, lan }) if requester.peer_id == remote => {
                            break Step::Pair(Pairing { peer: requester, lan, joined: true });
                        }
                        Some(ServerMessage::JoinAccepted { host, lan }) if host.peer_id == remote => {
                            break Step::Pair(Pairing { peer: host, lan, joined: false });
                        }
                        Some(ServerMessage::CodeAssigned { code }) => {
                            self.pin = Some(code.clone());
                            self.cx.state.send_modify(|s| s.pin = Some(code));
                        }
                        Some(_) => {}
                    },
                }
            }
        };
        drop(link);
        match step {
            Step::Bye | Step::Quit | Step::Sent => {
                let _ = timeout(FLUSH_TIMEOUT, pump).await;
                sleep(CLOSE_GRACE).await;
            }
            Step::Pair(_) => {
                pump.abort();
                self.lost().await;
            }
            Step::Lost => pump.abort(),
        }
        step
    }

    /// Peer loss: in-flight work stops, partials stay, unsent files stay queued.
    async fn lost(&mut self) {
        self.inbox.abort().await;
        self.outbox.abort();
        self.cx.state.send_modify(|s| {
            s.interrupt();
            s.phase = Phase::Reconnecting;
            s.peer = None;
            s.status = text::WAITING_RECONNECT.into();
        });
        if self.opts.role != Role::Host {
            self.rejoin_at = Some(Instant::now() + RETRY_DELAY);
        }
    }
}

/// Next server frame; `None` once the socket is gone, pending forever without a socket.
async fn recv(sig: &mut Option<Connection>) -> Option<ServerMessage> {
    match sig {
        Some(sig) => sig.inbound.recv().await,
        None => std::future::pending().await,
    }
}

/// Relays the peer's outbound signals to `target` until the peer is dropped.
fn forward_signals(
    mut signals: UnboundedReceiver<Value>,
    sender: signaling::Sender,
    target: String,
) {
    tokio::spawn(async move {
        while let Some(payload) = signals.recv().await {
            let msg = ClientMessage::Signal {
                target_peer_id: target.clone(),
                payload,
            };
            if sender.send(msg).is_err() {
                break;
            }
        }
    });
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
