//! End-to-end transfers between two in-process sessions over loopback WebRTC, paired by a
//! minimal in-process signaling hub.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use drop_cli::args::Role;
use drop_cli::config::Store;
use drop_cli::device::Device;
use drop_cli::rtc::{MAX_CHUNK, Peer, RtcConfig};
use drop_cli::session::{self, Options, Outcome};
use drop_cli::state::{Command, SessionState, Shared, TransferStatus};
use drop_core::signaling::{ClientMessage, PeerInfo, ServerMessage};
use futures_util::{SinkExt, StreamExt};
use tempfile::TempDir;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

const WAIT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Hub {
    peers: HashMap<String, (String, mpsc::UnboundedSender<ServerMessage>)>,
    /// PIN → host peer ID.
    codes: HashMap<String, String>,
}

/// Serves the signaling messages the CLI uses and returns the `ws://` URL.
async fn hub() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    let hub = Arc::new(Mutex::new(Hub::default()));
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(client(stream, hub.clone()));
        }
    });
    url
}

async fn client(stream: TcpStream, hub: Arc<Mutex<Hub>>) {
    let Ok(ws) = tokio_tungstenite::accept_async(stream).await else {
        return;
    };
    let (mut sink, mut frames) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let frame = serde_json::to_string(&msg).unwrap();
            if sink.send(Message::text(frame)).await.is_err() {
                break;
            }
        }
    });
    let mut me = String::new();
    while let Some(Ok(Message::Text(frame))) = frames.next().await {
        let Ok(msg) = serde_json::from_str::<ClientMessage>(&frame) else {
            continue;
        };
        let mut hub = hub.lock().unwrap();
        match msg {
            ClientMessage::Announce {
                peer_id,
                host,
                display_name,
                code,
                ..
            } => {
                me = peer_id.clone();
                hub.peers
                    .insert(peer_id.clone(), (display_name, tx.clone()));
                if host {
                    let code = match code.as_str() {
                        "" => format!("{:04}", hub.codes.len() + 1),
                        code => code.to_string(),
                    };
                    hub.codes.insert(code.clone(), peer_id);
                    let _ = tx.send(ServerMessage::CodeAssigned { code });
                }
            }
            ClientMessage::JoinCode { code, .. } => {
                let host = hub.codes.get(&code).cloned();
                let Some((host_name, host_tx)) = host.and_then(|id| hub.peers.get(&id)).cloned()
                else {
                    let _ = tx.send(ServerMessage::JoinRejected);
                    continue;
                };
                let host_id = hub.codes[&code].clone();
                let my_name = hub.peers[&me].0.clone();
                let info = |peer_id: &str, name: &str| PeerInfo {
                    peer_id: peer_id.into(),
                    display_name: name.into(),
                };
                let _ = host_tx.send(ServerMessage::PeerJoining {
                    requester: info(&me, &my_name),
                    lan: false,
                });
                let _ = tx.send(ServerMessage::JoinAccepted {
                    host: info(&host_id, &host_name),
                    lan: false,
                });
            }
            ClientMessage::Signal {
                target_peer_id,
                payload,
            } => {
                if let Some((_, target)) = hub.peers.get(&target_peer_id) {
                    let _ = target.send(ServerMessage::Signal {
                        from_peer_id: me.clone(),
                        payload,
                    });
                }
            }
            ClientMessage::Ping => {
                let _ = tx.send(ServerMessage::Pong);
            }
            ClientMessage::Pong => {}
        }
    }
}

fn loopback() -> RtcConfig {
    RtcConfig {
        ice_servers: Vec::new(),
        udp_addrs: vec!["127.0.0.1:0".into()],
    }
}

struct Running {
    task: JoinHandle<Result<Outcome, session::Error>>,
    state: Shared,
    store: Arc<Mutex<Store>>,
    _commands: mpsc::Sender<Command>,
    _config: TempDir,
}

/// Starts a quick-mode session (automatic downloads, send-once exit).
fn start(url: &str, role: Role, id: &str, download_dir: &Path, files: Vec<PathBuf>) -> Running {
    let config = tempfile::tempdir().unwrap();
    let store = Arc::new(Mutex::new(Store::load(config.path().join(".dropConfig"))));
    let state = Shared::new(SessionState::default());
    let (commands_tx, commands) = mpsc::channel(8);
    let opts = Options {
        role,
        signaling_url: url.into(),
        device: Device {
            peer_id: id.into(),
            display_name: id.into(),
        },
        download_dir: download_dir.into(),
        manual: false,
        files,
        dirs: Vec::new(),
        rtc: loopback(),
    };
    let task = tokio::spawn(session::run(opts, state.clone(), store.clone(), commands));
    Running {
        task,
        state,
        store,
        _commands: commands_tx,
        _config: config,
    }
}

async fn host_pin(state: &Shared) -> String {
    let mut rx = state.subscribe();
    let ready = rx.wait_for(|s| s.pin.is_some());
    let state = timeout(WAIT, ready).await.unwrap().unwrap();
    state.pin.clone().unwrap()
}

fn random_file(dir: &Path, name: &str, size: usize) -> (PathBuf, Vec<u8>) {
    let mut data = vec![0; size];
    getrandom::fill(&mut data).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, &data).unwrap();
    (path, data)
}

/// Host sends `files`, joiner receives into `recv_dir`; both sessions must end cleanly.
async fn transfer(files: Vec<PathBuf>, recv_dir: &Path) {
    let url = hub().await;
    let count = files.len() as u64;
    let mut host = start(&url, Role::Host, "host-peer", recv_dir, files);
    let pin = host_pin(&host.state).await;
    let mut joiner = start(&url, Role::Join(pin), "joiner-peer", recv_dir, Vec::new());

    let sent = timeout(WAIT, &mut host.task).await.expect("host in time");
    assert_eq!(sent.unwrap().unwrap(), Outcome::Sent);
    let received = timeout(WAIT, &mut joiner.task)
        .await
        .expect("joiner in time");
    assert_eq!(received.unwrap().unwrap(), Outcome::Bye);

    for (running, upload) in [(&host, true), (&joiner, false)] {
        let state = running.state.borrow();
        assert_eq!(state.transfers.len() as u64, count);
        assert!(
            state
                .transfers
                .iter()
                .all(|t| t.status == TransferStatus::Completed),
            "{:?}",
            state.transfers
        );
        let stats = running.store.lock().unwrap().config().transfer_stats;
        let files = match upload {
            true => stats.upload_files,
            false => stats.download_files,
        };
        assert_eq!(files, count);
    }
}

#[tokio::test]
async fn single_file() {
    let send = tempfile::tempdir().unwrap();
    let recv = tempfile::tempdir().unwrap();
    let (path, data) = random_file(send.path(), "testfile.bin", 256 * 1024);
    transfer(vec![path], recv.path()).await;
    assert!(std::fs::read(recv.path().join("testfile.bin")).unwrap() == data);
}

#[tokio::test]
async fn batch() {
    let send = tempfile::tempdir().unwrap();
    let recv = tempfile::tempdir().unwrap();
    let files: Vec<_> = [64 * 1024, 128 * 1024, 512 * 1024]
        .into_iter()
        .enumerate()
        .map(|(i, size)| random_file(send.path(), &format!("batch_file{i}.bin"), size))
        .collect();
    transfer(files.iter().map(|(p, _)| p.clone()).collect(), recv.path()).await;
    for (path, data) in files {
        let name = path.file_name().unwrap();
        assert!(std::fs::read(recv.path().join(name)).unwrap() == data);
    }
}

#[tokio::test]
async fn output_directory() {
    let send = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let out = base.path().join("custom").join("out");
    let (path, data) = random_file(send.path(), "sync_test.bin", 96 * 1024);
    transfer(vec![path], &out).await;
    assert!(std::fs::read(out.join("sync_test.bin")).unwrap() == data);
    let cwd = std::env::current_dir().unwrap();
    assert!(!cwd.join("sync_test.bin").exists());
    let leftovers: Vec<_> = std::fs::read_dir(&out).unwrap().flatten().collect();
    assert_eq!(leftovers.len(), 1, "no partials left behind");
}

#[tokio::test]
async fn chunk_sizing() {
    let (a_tx, mut a_rx) = mpsc::unbounded_channel();
    let (b_tx, mut b_rx) = mpsc::unbounded_channel();
    let (a, _a_in) = Peer::connect("host-peer", "joiner-peer", &loopback(), a_tx)
        .await
        .unwrap();
    let (b, _b_in) = Peer::connect("joiner-peer", "host-peer", &loopback(), b_tx)
        .await
        .unwrap();
    let (a, b) = (Arc::new(a), Arc::new(b));
    let (to_b, to_a) = (b.clone(), a.clone());
    tokio::spawn(async move {
        while let Some(signal) = a_rx.recv().await {
            let _ = to_b.handle_signal(signal).await;
        }
    });
    tokio::spawn(async move {
        while let Some(signal) = b_rx.recv().await {
            let _ = to_a.handle_signal(signal).await;
        }
    });
    assert!(timeout(WAIT, a.ready()).await.unwrap());
    assert!(timeout(WAIT, b.ready()).await.unwrap());
    assert_eq!(a.chunk_size(), MAX_CHUNK, "negotiated size is capped");
    assert_eq!(b.chunk_size(), a.chunk_size());

    // A file that is not a multiple of the chunk size crosses intact, and full frames
    // (stream header + chunk) fit the negotiated max message size.
    let send = tempfile::tempdir().unwrap();
    let recv = tempfile::tempdir().unwrap();
    let (path, data) = random_file(send.path(), "odd.bin", 3 * MAX_CHUNK + 7);
    transfer(vec![path], recv.path()).await;
    assert!(std::fs::read(recv.path().join("odd.bin")).unwrap() == data);
}
