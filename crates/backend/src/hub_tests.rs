use std::collections::HashMap;

use drop_core::signaling::{PeerInfo, SHARE_CODE_RANGE, ServerMessage, format_code};
use serde_json::json;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use super::{Conn, Hub, generate_code};

struct Client {
    conn: Conn,
    inbox: UnboundedReceiver<ServerMessage>,
}

fn client(hub: &Hub) -> Client {
    let (outbox, inbox) = unbounded_channel();
    Client {
        conn: hub.connect(outbox),
        inbox,
    }
}

impl Client {
    fn send(&mut self, hub: &Hub, frame: serde_json::Value) {
        hub.handle(&mut self.conn, frame.to_string().as_bytes());
    }

    fn next(&mut self) -> Option<ServerMessage> {
        self.inbox.try_recv().ok()
    }
}

fn host(hub: &Hub, peer_id: &str, code: &str) -> Client {
    let mut host = client(hub);
    host.send(
        hub,
        json!({ "type": "announce", "peerId": peer_id, "host": true, "code": code }),
    );
    host
}

fn joiner(hub: &Hub, peer_id: &str) -> Client {
    let mut joiner = client(hub);
    joiner.send(
        hub,
        json!({ "type": "announce", "peerId": peer_id, "displayName": "Bob" }),
    );
    joiner
}

fn rejected(client: &mut Client, hub: &Hub, code: &str) -> bool {
    client.send(hub, json!({ "type": "join-code", "code": code }));
    client.next() == Some(ServerMessage::JoinRejected)
}

#[test]
fn generated_codes_are_four_digits_in_range() {
    for _ in 0..100 {
        let code = generate_code(&HashMap::new()).unwrap();
        assert_eq!(code.len(), 4);
        assert!(code.parse::<u32>().unwrap() < SHARE_CODE_RANGE);
    }
}

#[test]
fn generation_gives_up_when_every_code_is_taken() {
    let codes = (0..SHARE_CODE_RANGE)
        .map(|n| (format_code(n), "x".to_owned()))
        .collect();
    assert_eq!(generate_code(&codes), None);
}

#[test]
fn host_without_code_gets_one_assigned() {
    let hub = Hub::default();
    let mut host = client(&hub);
    host.send(
        &hub,
        json!({ "type": "announce", "peerId": "a", "host": true }),
    );

    let Some(ServerMessage::CodeAssigned { code }) = host.next() else {
        panic!("expected code-assigned");
    };
    assert_eq!(hub.lock().codes.get(&code).map(String::as_str), Some("a"));
}

#[test]
fn requested_or_reused_code_is_not_reported() {
    let hub = Hub::default();
    let mut host = host(&hub, "a", "0042");
    assert_eq!(host.next(), None);
    assert_eq!(hub.lock().codes.get("0042").map(String::as_str), Some("a"));

    // Re-announcing without a code keeps the PIN it still owns.
    host.send(
        &hub,
        json!({ "type": "announce", "peerId": "a", "host": true }),
    );
    assert_eq!(host.next(), None);
    assert_eq!(hub.lock().codes.get("0042").map(String::as_str), Some("a"));
}

#[test]
fn requested_code_owned_by_another_peer_is_not_taken() {
    let hub = Hub::default();
    let _first = host(&hub, "a", "0042");
    let _second = host(&hub, "b", "0042");
    assert_eq!(hub.lock().codes.get("0042").map(String::as_str), Some("a"));
}

#[test]
fn non_host_gets_no_code() {
    let hub = Hub::default();
    let mut joiner = joiner(&hub, "b");
    assert_eq!(joiner.next(), None);
    assert!(hub.lock().codes.is_empty());
}

#[test]
fn join_pairs_host_and_joiner() {
    let hub = Hub::default();
    let mut host = host(&hub, "a", "0042");
    let mut joiner = joiner(&hub, "b");
    joiner.send(&hub, json!({ "type": "join-code", "code": "0042" }));

    let requester = PeerInfo {
        peer_id: "b".into(),
        display_name: "Bob".into(),
    };
    assert_eq!(
        host.next(),
        Some(ServerMessage::PeerJoining {
            requester,
            lan: false
        })
    );
    let host_info = PeerInfo {
        peer_id: "a".into(),
        display_name: String::new(),
    };
    assert_eq!(
        joiner.next(),
        Some(ServerMessage::JoinAccepted {
            host: host_info,
            lan: false
        })
    );
}

#[test]
fn join_flags_lan_for_equal_public_ipv4() {
    let hub = Hub::default();
    let announce = |client: &mut Client, peer_id: &str, ip: &str, host: bool| {
        let frame = json!({ "type": "announce", "peerId": peer_id, "host": host, "code": "0042", "publicIpv4": ip });
        client.send(&hub, frame);
    };
    let (mut host, mut joiner) = (client(&hub), client(&hub));
    announce(&mut host, "a", "8.8.8.8", true);
    announce(&mut joiner, "b", "8.8.8.8", false);
    joiner.send(&hub, json!({ "type": "join-code", "code": "0042" }));
    assert!(matches!(
        host.next(),
        Some(ServerMessage::PeerJoining { lan: true, .. })
    ));
    assert!(matches!(
        joiner.next(),
        Some(ServerMessage::JoinAccepted { lan: true, .. })
    ));

    // Private addresses are dropped, so they never count as the same network.
    announce(&mut host, "a", "192.168.0.2", true);
    announce(&mut joiner, "b", "192.168.0.2", false);
    joiner.send(&hub, json!({ "type": "join-code", "code": "0042" }));
    assert!(matches!(
        host.next(),
        Some(ServerMessage::PeerJoining { lan: false, .. })
    ));
    assert!(matches!(
        joiner.next(),
        Some(ServerMessage::JoinAccepted { lan: false, .. })
    ));
}

#[test]
fn join_rejections() {
    let hub = Hub::default();
    let mut host = host(&hub, "a", "0042");
    let mut stranger = client(&hub);
    let mut joiner = joiner(&hub, "b");

    assert!(
        rejected(&mut stranger, &hub, "0042"),
        "join before announce"
    );
    assert!(rejected(&mut joiner, &hub, "0043"), "unknown code");
    assert!(rejected(&mut joiner, &hub, "42"), "invalid code");
    assert!(rejected(&mut host, &hub, "0042"), "own code");
    assert_eq!(host.next(), None);
}

#[test]
fn signal_is_relayed_with_sender_id() {
    let hub = Hub::default();
    let mut a = joiner(&hub, "a");
    let mut b = joiner(&hub, "b");
    let payload = json!({ "type": "description", "description": { "sdp": "x" } });
    a.send(
        &hub,
        json!({ "type": "signal", "targetPeerId": "b", "payload": payload }),
    );
    assert_eq!(
        b.next(),
        Some(ServerMessage::Signal {
            from_peer_id: "a".into(),
            payload
        })
    );

    // Unknown target and unannounced sender are dropped silently.
    a.send(
        &hub,
        json!({ "type": "signal", "targetPeerId": "zz", "payload": {} }),
    );
    let mut stranger = client(&hub);
    stranger.send(
        &hub,
        json!({ "type": "signal", "targetPeerId": "b", "payload": {} }),
    );
    assert_eq!((a.next(), b.next(), stranger.next()), (None, None, None));
}

#[test]
fn ping_gets_pong_and_garbage_is_ignored() {
    let hub = Hub::default();
    let mut c = client(&hub);
    hub.handle(&mut c.conn, b"not json");
    c.send(&hub, json!({ "type": "unknown" }));
    c.send(&hub, json!({ "type": "announce", "peerId": "" }));
    assert_eq!(c.next(), None);
    assert!(hub.lock().peers.is_empty());

    c.send(&hub, json!({ "type": "ping" }));
    assert_eq!(c.next(), Some(ServerMessage::Pong));
}

#[test]
fn disconnect_frees_peer_and_code() {
    let hub = Hub::default();
    let host = host(&hub, "a", "0042");
    hub.disconnect(host.conn);

    let state = hub.lock();
    assert!(state.peers.is_empty());
    assert!(state.codes.is_empty());
}

#[test]
fn stale_close_keeps_newer_registration() {
    let hub = Hub::default();
    let old = host(&hub, "a", "0042");
    let mut new = host(&hub, "a", "0042");
    hub.disconnect(old.conn);

    assert_eq!(hub.lock().codes.get("0042").map(String::as_str), Some("a"));
    let mut joiner = joiner(&hub, "b");
    joiner.send(&hub, json!({ "type": "join-code", "code": "0042" }));
    assert!(matches!(
        new.next(),
        Some(ServerMessage::PeerJoining { .. })
    ));
}

#[test]
fn second_announce_drops_first_entry_and_code() {
    let hub = Hub::default();
    let mut c = host(&hub, "a", "0042");
    c.send(
        &hub,
        json!({ "type": "announce", "peerId": "b", "host": true, "code": "0043" }),
    );

    {
        let state = hub.lock();
        assert!(!state.peers.contains_key("a"));
        assert!(!state.codes.contains_key("0042"));
        assert_eq!(state.codes.get("0043").map(String::as_str), Some("b"));
    }
    hub.disconnect(c.conn);
    let state = hub.lock();
    assert!(state.peers.is_empty());
    assert!(state.codes.is_empty());
}
