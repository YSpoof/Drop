use super::*;
use serde_json::json;

fn round_trip_client(msg: &ClientMessage) -> ClientMessage {
    serde_json::from_str(&serde_json::to_string(msg).unwrap()).unwrap()
}

fn round_trip_server(msg: &ServerMessage) -> ServerMessage {
    serde_json::from_str(&serde_json::to_string(msg).unwrap()).unwrap()
}

#[test]
fn announce_uses_wire_field_names() {
    let msg = ClientMessage::Announce {
        peer_id: "peer-123".into(),
        host: true,
        display_name: "MyDevice".into(),
        code: String::new(),
        public_ipv4: "8.8.8.8".into(),
    };
    let value = serde_json::to_value(&msg).unwrap();
    assert_eq!(
        value,
        json!({"type":"announce","peerId":"peer-123","host":true,"displayName":"MyDevice","publicIpv4":"8.8.8.8"})
    );
    assert_eq!(round_trip_client(&msg), msg);
}

#[test]
fn announce_defaults_optional_fields() {
    let msg: ClientMessage = serde_json::from_str(r#"{"type":"announce","peerId":"p"}"#).unwrap();
    assert_eq!(
        msg,
        ClientMessage::Announce {
            peer_id: "p".into(),
            host: false,
            display_name: String::new(),
            code: String::new(),
            public_ipv4: String::new(),
        }
    );
}

#[test]
fn join_code_round_trips() {
    let msg = ClientMessage::JoinCode { peer_id: "peer-456".into(), code: "0624".into() };
    assert_eq!(
        serde_json::to_value(&msg).unwrap(),
        json!({"type":"join-code","peerId":"peer-456","code":"0624"})
    );
    assert_eq!(round_trip_client(&msg), msg);
}

#[test]
fn code_assigned_round_trips() {
    let msg = ServerMessage::CodeAssigned { code: "0123".into() };
    assert_eq!(serde_json::to_value(&msg).unwrap(), json!({"type":"code-assigned","code":"0123"}));
    assert_eq!(round_trip_server(&msg), msg);
}

#[test]
fn peer_joining_carries_requester_and_lan() {
    let msg = ServerMessage::PeerJoining {
        requester: PeerInfo { peer_id: "peer-789".into(), display_name: "JoinerNode".into() },
        lan: true,
    };
    assert_eq!(
        serde_json::to_value(&msg).unwrap(),
        json!({"type":"peer-joining","requester":{"peerId":"peer-789","displayName":"JoinerNode"},"lan":true})
    );
    assert_eq!(round_trip_server(&msg), msg);
}

#[test]
fn missing_lan_decodes_as_false() {
    let joining: ServerMessage =
        serde_json::from_str(r#"{"type":"peer-joining","requester":{"peerId":"p1"}}"#).unwrap();
    assert!(matches!(joining, ServerMessage::PeerJoining { lan: false, .. }));

    let accepted: ServerMessage =
        serde_json::from_str(r#"{"type":"join-accepted","host":{"peerId":"h1"}}"#).unwrap();
    assert!(matches!(accepted, ServerMessage::JoinAccepted { lan: false, .. }));
}

#[test]
fn lan_false_is_omitted() {
    let msg = ServerMessage::JoinAccepted { host: PeerInfo { peer_id: "h".into(), display_name: String::new() }, lan: false };
    assert_eq!(serde_json::to_value(&msg).unwrap(), json!({"type":"join-accepted","host":{"peerId":"h"}}));
}

#[test]
fn join_rejected_ping_pong_are_bare() {
    assert_eq!(serde_json::to_string(&ServerMessage::JoinRejected).unwrap(), r#"{"type":"join-rejected"}"#);
    assert_eq!(serde_json::to_string(&ServerMessage::Pong).unwrap(), r#"{"type":"pong"}"#);
    assert_eq!(serde_json::to_string(&ClientMessage::Ping).unwrap(), r#"{"type":"ping"}"#);
    let ping: ServerMessage = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
    assert_eq!(ping, ServerMessage::Ping);
}

#[test]
fn signal_keeps_payload_verbatim() {
    let payload = json!({"candidate":"candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host"});
    let outgoing = ClientMessage::Signal { target_peer_id: "peer-2".into(), payload: payload.clone() };
    assert_eq!(
        serde_json::to_value(&outgoing).unwrap(),
        json!({"type":"signal","targetPeerId":"peer-2","payload":payload})
    );
    let incoming = ServerMessage::Signal { from_peer_id: "peer-1".into(), payload: payload.clone() };
    assert_eq!(
        serde_json::to_value(&incoming).unwrap(),
        json!({"type":"signal","fromPeerId":"peer-1","payload":payload})
    );
    assert_eq!(round_trip_server(&incoming), incoming);
}

#[test]
fn unknown_type_fails_to_decode() {
    assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"nope"}"#).is_err());
}

#[test]
fn normalize_code_accepts_only_four_digits() {
    assert_eq!(normalize_code("1234"), Some("1234"));
    assert_eq!(normalize_code("12"), None);
    assert_eq!(normalize_code("abcd"), None);
    assert_eq!(normalize_code("12345"), None);
    assert_eq!(normalize_code("١٢٣٤"), None);
}

#[test]
fn format_code_pads_to_four_digits() {
    assert_eq!(SHARE_CODE_RANGE, 625);
    assert_eq!(format_code(0), "0000");
    assert_eq!(format_code(7), "0007");
    assert_eq!(format_code(624), "0624");
    assert_eq!(format_code(0).len(), SHARE_CODE_DIGITS);
}

#[test]
fn public_ipv4_check() {
    for ip in ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "169.1.0.1"] {
        assert!(is_public_ipv4(ip), "{ip} should be public");
    }
    for ip in [
        "", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "0.1.2.3",
        "169.254.1.1", "224.0.0.1", "255.255.255.255", "1.2.3", "1.2.3.4.5", "1.2.3.256", "a.b.c.d", "1..2.3",
        "::1",
    ] {
        assert!(!is_public_ipv4(ip), "{ip} should not be public");
    }
}
