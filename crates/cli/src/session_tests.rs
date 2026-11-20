use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;

use super::*;
use crate::state::SessionState;
use crate::transfer::partial;

const WAIT: Duration = Duration::from_secs(10);

/// A one-client signaling server: `code-assigned` for a host `announce`, `join-rejected`
/// for `join-code`. With `hang_up`, it closes the socket after the first frame instead.
async fn server(hang_up: bool) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        while let Some(Ok(Message::Text(frame))) = ws.next().await {
            if hang_up {
                return;
            }
            let reply = match serde_json::from_str(&frame) {
                Ok(ClientMessage::Announce { host: true, .. }) => ServerMessage::CodeAssigned {
                    code: "0042".into(),
                },
                Ok(ClientMessage::JoinCode { .. }) => ServerMessage::JoinRejected,
                _ => continue,
            };
            let frame = serde_json::to_string(&reply).unwrap();
            ws.send(Message::text(frame)).await.unwrap();
        }
    });
    url
}

struct Fixture {
    dir: tempfile::TempDir,
    state: Shared,
    store: Arc<Mutex<Store>>,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::load(dir.path().join(".dropConfig"));
    Fixture {
        dir,
        state: Shared::new(SessionState::default()),
        store: Arc::new(Mutex::new(store)),
    }
}

impl Fixture {
    fn options(&self, url: &str, role: Role) -> Options {
        Options {
            role,
            signaling_url: url.into(),
            device: Device {
                peer_id: "me".into(),
                display_name: "Me".into(),
            },
            download_dir: self.dir.path().join("downloads"),
            manual: true,
            files: Vec::new(),
            dirs: Vec::new(),
            rtc: RtcConfig::default(),
        }
    }

    async fn run(
        &self,
        url: &str,
        role: Role,
        commands: mpsc::Receiver<Command>,
    ) -> Result<Outcome, Error> {
        let opts = self.options(url, role);
        let session = run(opts, self.state.clone(), self.store.clone(), commands);
        timeout(WAIT, session).await.expect("session ends in time")
    }
}

#[tokio::test]
async fn join_rejected_before_ready_is_an_error() {
    let f = fixture();
    let url = server(false).await;
    let (_tx, rx) = mpsc::channel(1);
    let err = f
        .run(&url, Role::Join("1234".into()), rx)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::JoinRejected(ref pin) if pin == "1234"));
    assert_eq!(err.to_string(), "entrada rejeitada: 1234");
    assert_eq!(f.state.borrow().phase, Phase::Ended);
}

#[tokio::test]
async fn signaling_lost_before_pairing_is_an_error() {
    let f = fixture();
    let url = server(true).await;
    let (_tx, rx) = mpsc::channel(1);
    let err = f.run(&url, Role::Host, rx).await.unwrap_err();
    assert!(matches!(err, Error::SignalingClosed));
}

#[tokio::test]
async fn unreachable_signaling_is_an_error() {
    let f = fixture();
    let (_tx, rx) = mpsc::channel(1);
    let err = f
        .run("ws://127.0.0.1:1/ws", Role::Host, rx)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Signaling(_)));
}

#[tokio::test]
async fn host_shows_pin_then_quit_discards_partials() {
    let f = fixture();
    let url = server(false).await;
    let downloads = f.dir.path().join("downloads");
    std::fs::create_dir_all(&downloads).unwrap();
    let leftover = downloads.join(partial::drop_name("old|1|2"));
    std::fs::write(&leftover, b"partial").unwrap();

    let (tx, rx) = mpsc::channel(1);
    let mut watch = f.state.subscribe();
    let quit = async {
        let state = watch.wait_for(|s| s.pin.is_some()).await.unwrap().clone();
        assert!(state.host);
        assert_eq!(state.pin.as_deref(), Some("0042"));
        assert_eq!(state.peer_id, "me");
        assert_eq!(state.phase, Phase::WaitingForPeer);
        assert_eq!(state.status, text::assigned_pin("0042"));
        tx.send(Command::Quit).await.unwrap();
    };
    let (outcome, ()) = tokio::join!(f.run(&url, Role::Host, rx), quit);

    assert_eq!(outcome.unwrap(), Outcome::Quit);
    assert!(!leftover.exists(), "user cancel discards partials");
}

#[test]
fn errors_are_pt_br() {
    assert_eq!(Error::ReadyTimeout.to_string(), text::ERR_WEBRTC_TIMEOUT);
    assert_eq!(Error::PeerFailed.to_string(), text::ERR_WEBRTC_PEER_FAILED);
    assert_eq!(
        Error::SignalingClosed.to_string(),
        text::ERR_SIGNALING_CLOSED
    );
}
