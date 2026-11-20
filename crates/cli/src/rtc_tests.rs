use super::*;
use std::time::Duration;
use tokio::time::timeout;

const WAIT: Duration = Duration::from_secs(10);

fn loopback() -> RtcConfig {
    RtcConfig {
        ice_servers: Vec::new(),
        udp_addrs: vec!["127.0.0.1:0".into()],
    }
}

/// Forwards signals to `to`. With `candidates_first`, holds everything until the description
/// and one candidate arrived, then delivers candidates before the description.
async fn relay(mut rx: mpsc::UnboundedReceiver<Value>, to: Arc<Peer>, candidates_first: bool) {
    let mut held: Vec<Value> = Vec::new();
    let mut holding = candidates_first;
    while let Some(payload) = rx.recv().await {
        if !holding {
            let _ = to.handle_signal(payload).await;
            continue;
        }
        held.push(payload);
        let is_description = |p: &Value| p["type"] == "description";
        if held.iter().any(is_description) && held.iter().any(|p| !is_description(p)) {
            held.sort_by_key(is_description);
            for payload in held.drain(..) {
                to.handle_signal(payload)
                    .await
                    .expect("held signal applies");
            }
            holding = false;
        }
    }
}

async fn pair(candidates_first: bool) -> ((Arc<Peer>, Inbound), (Arc<Peer>, Inbound)) {
    let (a_tx, a_rx) = mpsc::unbounded_channel();
    let (b_tx, b_rx) = mpsc::unbounded_channel();
    let (a, a_in) = Peer::connect("001", "002", &loopback(), a_tx)
        .await
        .unwrap();
    let (b, b_in) = Peer::connect("002", "001", &loopback(), b_tx)
        .await
        .unwrap();
    let (a, b) = (Arc::new(a), Arc::new(b));
    tokio::spawn(relay(a_rx, b.clone(), candidates_first));
    tokio::spawn(relay(b_rx, a.clone(), false));
    assert!(
        timeout(WAIT, a.ready()).await.expect("A ready in time"),
        "A closed before ready"
    );
    assert!(
        timeout(WAIT, b.ready()).await.expect("B ready in time"),
        "B closed before ready"
    );
    ((a, a_in), (b, b_in))
}

#[tokio::test]
async fn smaller_id_offers_and_both_channels_carry_frames() {
    let ((a, mut a_in), (b, mut b_in)) = pair(false).await;

    a.send_ctrl("hello-drop").await.unwrap();
    assert_eq!(
        timeout(WAIT, b_in.ctrl.recv()).await.unwrap().unwrap(),
        "hello-drop"
    );
    b.send_ctrl("hello-back").await.unwrap();
    assert_eq!(
        timeout(WAIT, a_in.ctrl.recv()).await.unwrap().unwrap(),
        "hello-back"
    );

    assert_eq!(a.chunk_size(), MAX_CHUNK);
    assert_eq!(b.chunk_size(), MAX_CHUNK);
    let chunk: Vec<u8> = (0..MAX_CHUNK).map(|i| i as u8).collect();
    a.send_file_chunk(&chunk).await.unwrap();
    assert_eq!(
        timeout(WAIT, b_in.files.recv()).await.unwrap().unwrap(),
        chunk
    );
    b.send_file_chunk(&chunk[..1000]).await.unwrap();
    assert_eq!(
        timeout(WAIT, a_in.files.recv()).await.unwrap().unwrap(),
        &chunk[..1000]
    );

    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn candidates_before_the_remote_description_are_queued() {
    let ((a, _a_in), (b, mut b_in)) = pair(true).await;
    a.send_ctrl("queued-ok").await.unwrap();
    assert_eq!(
        timeout(WAIT, b_in.ctrl.recv()).await.unwrap().unwrap(),
        "queued-ok"
    );
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn back_pressure_stalls_the_sender_until_the_receiver_reads() {
    let ((a, _a_in), (b, mut b_in)) = pair(false).await;
    // 40 MiB: more than the inbound queue, SCTP window, and send-buffer limit together.
    let count = 160;
    let sender = tokio::spawn({
        let a = a.clone();
        async move {
            for i in 0..count {
                a.send_file_chunk(&vec![i as u8; MAX_CHUNK]).await.unwrap();
            }
        }
    });
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(!sender.is_finished(), "send must wait while nobody reads");
    for i in 0..count {
        let frame = timeout(WAIT, b_in.files.recv()).await.unwrap().unwrap();
        assert_eq!((frame.len(), frame[0]), (MAX_CHUNK, i as u8));
    }
    sender.await.unwrap();
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn remote_close_is_reported_as_peer_lost() {
    let ((a, _a_in), (b, _b_in)) = pair(false).await;
    a.close().await;
    assert_eq!(a.status(), Status::Closed);
    timeout(WAIT, b.closed())
        .await
        .expect("B notices the peer left");
    assert!(!b.ready().await);
    assert!(b.send_ctrl("late").await.is_err());
}

#[tokio::test]
async fn answerer_without_offer_stays_connecting() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (peer, _inbound) = Peer::connect("b", "a", &loopback(), tx).await.unwrap();
    assert!(rx.try_recv().is_err(), "the larger ID must not offer");
    assert_eq!(peer.status(), Status::Connecting);
    assert_eq!(peer.chunk_size(), FALLBACK_CHUNK);
    assert!(peer.send_ctrl("x").await.is_err());
    let early = json!({"type": "candidate", "candidate": {
        "candidate": "candidate:1 1 udp 2130706431 127.0.0.1 9 typ host",
        "sdpMid": "0", "sdpMLineIndex": 0, "usernameFragment": "abcd"}});
    peer.handle_signal(early)
        .await
        .expect("queued, not rejected");
    assert!(peer.handle_signal(json!({"type": "other"})).await.is_err());
    peer.close().await;
}

#[tokio::test]
async fn signal_envelopes_match_the_browser_shape() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let (peer, _inbound) = Peer::connect("a", "b", &loopback(), tx).await.unwrap();
    let offer = timeout(WAIT, rx.recv()).await.unwrap().unwrap();
    assert_eq!(offer["type"], "description");
    assert_eq!(offer["description"]["type"], "offer");
    let sdp = offer["description"]["sdp"].as_str().unwrap();
    assert!(sdp.contains("a=max-message-size:262144"), "{sdp}");
    assert_eq!(offer["description"].as_object().unwrap().len(), 2);

    let candidate = loop {
        let payload = timeout(WAIT, rx.recv()).await.unwrap().unwrap();
        if payload["type"] == "candidate" {
            break payload["candidate"].clone();
        }
    };
    assert!(
        candidate["candidate"]
            .as_str()
            .unwrap()
            .starts_with("candidate:")
    );
    assert_eq!(candidate["sdpMLineIndex"], 0);
    assert!(candidate["sdpMid"].is_null());
    assert!(candidate.get("usernameFragment").is_some());
    peer.close().await;
}

#[test]
fn chunk_size_is_capped_at_256_kib() {
    assert_eq!(chunk_size_for(Some(1_073_741_823)), MAX_CHUNK);
    assert_eq!(chunk_size_for(Some(262_145)), MAX_CHUNK);
}

#[test]
fn chunk_size_uses_negotiated_value_up_to_the_cap() {
    assert_eq!(chunk_size_for(Some(131_072)), 131_072);
    assert_eq!(chunk_size_for(Some(262_144)), 262_144);
}

#[test]
fn chunk_size_falls_back_to_64_kib() {
    assert_eq!(chunk_size_for(None), FALLBACK_CHUNK);
    assert_eq!(chunk_size_for(Some(0)), FALLBACK_CHUNK);
    assert_eq!(chunk_size_for(Some(u32::MAX)), FALLBACK_CHUNK);
}
