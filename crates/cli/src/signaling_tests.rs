use std::time::Duration;

use drop_core::signaling::{ClientMessage, PeerInfo, ServerMessage};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use super::*;

const HOST_CODE: &str = "0042";

enum Reply {
    Send(ServerMessage),
    Close,
    Nothing,
}

/// One-connection mock server. Returns its URL and every text frame it receives;
/// the frame channel ends when the connection ends.
async fn mock(handler: fn(ClientMessage) -> Reply) -> (String, mpsc::UnboundedReceiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
        while let Some(Ok(Message::Text(frame))) = ws.next().await {
            let _ = tx.send(frame.to_string());
            let reply = match serde_json::from_str(&frame) {
                Ok(msg) => handler(msg),
                Err(_) => Reply::Nothing,
            };
            match reply {
                Reply::Send(msg) => ws
                    .send(Message::text(serde_json::to_string(&msg).unwrap()))
                    .await
                    .unwrap(),
                Reply::Close => return ws.close(None).await.unwrap(),
                Reply::Nothing => {}
            }
        }
    });
    (url, rx)
}

/// Mirrors the hub: host announce gets a code, join-code is accepted for that code, signals echo back.
fn hub(msg: ClientMessage) -> Reply {
    match msg {
        ClientMessage::Announce { host: true, .. } => Reply::Send(ServerMessage::CodeAssigned {
            code: HOST_CODE.into(),
        }),
        ClientMessage::JoinCode { code, .. } if code == HOST_CODE => {
            Reply::Send(ServerMessage::JoinAccepted {
                host: PeerInfo {
                    peer_id: "host-node".into(),
                    display_name: "Host Peer".into(),
                },
                lan: true,
            })
        }
        ClientMessage::JoinCode { .. } => Reply::Send(ServerMessage::JoinRejected),
        ClientMessage::Signal { payload, .. } => Reply::Send(ServerMessage::Signal {
            from_peer_id: "remote-peer".into(),
            payload,
        }),
        ClientMessage::Ping => Reply::Send(ServerMessage::Pong),
        _ => Reply::Nothing,
    }
}

async fn next<T>(rx: &mut mpsc::UnboundedReceiver<T>) -> Option<T> {
    time::timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("timed out")
}

fn announce(host: bool) -> ClientMessage {
    ClientMessage::Announce {
        peer_id: "peer-1".into(),
        host,
        display_name: "Test".into(),
        code: String::new(),
        public_ipv4: String::new(),
    }
}

#[test]
fn normalizes_urls() {
    let cases = [
        ("https://drop.lzart.com.br/ws", "wss://drop.lzart.com.br/ws"),
        ("http://localhost:5173/ws", "ws://localhost:5173/ws"),
        ("wss://custom.domain/ws", "wss://custom.domain/ws"),
        ("ws://127.0.0.1:8080/ws", "ws://127.0.0.1:8080/ws"),
        ("drop.lzart.com.br/ws", "wss://drop.lzart.com.br/ws"),
        ("  http://[::1]:8080/ws ", "ws://[::1]:8080/ws"),
        ("", DEFAULT_URL),
        ("   ", DEFAULT_URL),
    ];
    for (input, want) in cases {
        assert_eq!(normalize_url(input), want, "input {input:?}");
    }
}

#[test]
fn rustls_has_a_default_provider() {
    // tokio-tungstenite builds its client config through the process-default provider.
    let _ = rustls::ClientConfig::builder();
}

#[tokio::test]
async fn host_announce_gets_code() {
    let (url, mut frames) = mock(hub).await;
    let mut conn = connect(&url).await.unwrap();
    conn.sender.send(announce(true)).unwrap();

    assert_eq!(
        next(&mut conn.inbound).await,
        Some(ServerMessage::CodeAssigned {
            code: HOST_CODE.into()
        })
    );
    let sent: serde_json::Value = serde_json::from_str(&next(&mut frames).await.unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({"type": "announce", "peerId": "peer-1", "host": true, "displayName": "Test"})
    );
}

#[tokio::test]
async fn join_code_accepted_and_rejected() {
    let (url, _frames) = mock(hub).await;
    let mut conn = connect(&url).await.unwrap();

    conn.sender
        .send(ClientMessage::JoinCode {
            peer_id: "joiner".into(),
            code: HOST_CODE.into(),
        })
        .unwrap();
    let Some(ServerMessage::JoinAccepted { host, lan }) = next(&mut conn.inbound).await else {
        panic!("expected join-accepted");
    };
    assert_eq!(host.peer_id, "host-node");
    assert_eq!(host.display_name, "Host Peer");
    assert!(lan);

    conn.sender
        .send(ClientMessage::JoinCode {
            peer_id: "joiner".into(),
            code: "0001".into(),
        })
        .unwrap();
    assert_eq!(
        next(&mut conn.inbound).await,
        Some(ServerMessage::JoinRejected)
    );
}

#[tokio::test]
async fn signal_round_trip_keeps_payload() {
    let (url, mut frames) = mock(hub).await;
    let mut conn = connect(&url).await.unwrap();
    let payload = json!({"type": "description", "description": {"type": "offer", "sdp": "v=0..."}});
    conn.sender
        .send(ClientMessage::Signal {
            target_peer_id: "joiner-peer".into(),
            payload: payload.clone(),
        })
        .unwrap();

    let want = ServerMessage::Signal {
        from_peer_id: "remote-peer".into(),
        payload: payload.clone(),
    };
    assert_eq!(next(&mut conn.inbound).await, Some(want));
    let sent: serde_json::Value = serde_json::from_str(&next(&mut frames).await.unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({"type": "signal", "targetPeerId": "joiner-peer", "payload": payload})
    );
}

#[tokio::test]
async fn heartbeat_sends_ping_and_hides_pong() {
    let (url, mut frames) = mock(hub).await;
    let mut conn = connect_with(&url, Duration::from_millis(50)).await.unwrap();

    assert_eq!(next(&mut frames).await.unwrap(), r#"{"type":"ping"}"#);
    // The server's pong is consumed by the socket task, not forwarded.
    conn.sender.send(announce(true)).unwrap();
    assert_eq!(
        next(&mut conn.inbound).await,
        Some(ServerMessage::CodeAssigned {
            code: HOST_CODE.into()
        })
    );
}

#[tokio::test]
async fn answers_server_ping_with_pong() {
    let (url, mut frames) = mock(|msg| match msg {
        ClientMessage::Announce { .. } => Reply::Send(ServerMessage::Ping),
        _ => Reply::Nothing,
    })
    .await;
    let mut conn = connect(&url).await.unwrap();
    conn.sender.send(announce(false)).unwrap();

    assert!(next(&mut frames).await.unwrap().contains("announce"));
    assert_eq!(next(&mut frames).await.unwrap(), r#"{"type":"pong"}"#);
    conn.sender.close();
    assert_eq!(next(&mut conn.inbound).await, None);
}

#[tokio::test]
async fn close_ends_the_connection() {
    let (url, mut frames) = mock(hub).await;
    let mut conn = connect(&url).await.unwrap();
    conn.sender.close();

    time::timeout(Duration::from_secs(2), conn.sender.closed())
        .await
        .unwrap();
    assert_eq!(next(&mut frames).await, None);
    assert_eq!(next(&mut conn.inbound).await, None);
    assert_eq!(conn.sender.send(ClientMessage::Ping), Err(Closed));
}

#[tokio::test]
async fn server_close_is_reported() {
    let (url, _frames) = mock(|_| Reply::Close).await;
    let mut conn = connect(&url).await.unwrap();
    conn.sender.send(announce(true)).unwrap();

    assert_eq!(next(&mut conn.inbound).await, None);
    time::timeout(Duration::from_secs(2), conn.sender.closed())
        .await
        .unwrap();
    assert!(conn.sender.send(ClientMessage::Ping).is_err());
}

#[tokio::test]
async fn connect_failure_is_an_error() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    drop(listener);
    assert!(matches!(connect(&url).await, Err(ConnectError::Ws(_))));
}
