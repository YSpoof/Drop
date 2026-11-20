use super::*;
use serde_json::{Value, json};

fn id() -> String {
    "f-123".into()
}

/// Encodes `msg`, checks the exact JSON object, and checks it decodes back.
fn assert_wire(msg: Ctrl, expected: Value) {
    let text = msg.encode();
    let actual: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(actual, expected, "wire shape of {msg:?}");
    assert_eq!(Ctrl::decode(&text).unwrap(), msg);
}

#[test]
fn file_identity_matches_go_and_browser() {
    assert_eq!(
        file_identity("document.pdf", 1_048_576, 1_700_000_000_000),
        "document.pdf|1048576|1700000000000"
    );
}

#[test]
fn every_control_message_has_the_exact_wire_shape() {
    let hash = file_identity("document.pdf", 1_048_576, 1_700_000_000_000);
    let cases = [
        (
            Ctrl::Meta {
                file_id: id(),
                name: "document.pdf".into(),
                size: 1_048_576,
                mime: "application/pdf".into(),
                hash: Some(hash.clone()),
            },
            json!({"type": "meta", "fileId": "f-123", "name": "document.pdf", "size": 1048576,
                   "mime": "application/pdf", "hash": "document.pdf|1048576|1700000000000"}),
        ),
        (
            Ctrl::Start {
                file_id: id(),
                chunk_size: 65_536,
                offset: None,
            },
            json!({"type": "start", "fileId": "f-123", "chunkSize": 65536}),
        ),
        (
            Ctrl::Resume {
                file_id: id(),
                hash: hash.clone(),
                bytes_offset: 262_144,
            },
            json!({"type": "resume", "fileId": "f-123", "hash": hash, "bytesOffset": 262144}),
        ),
        (
            Ctrl::Credit {
                file_id: id(),
                bytes_written: 1_048_576,
            },
            json!({"type": "credit", "fileId": "f-123", "bytesWritten": 1048576}),
        ),
        (
            Ctrl::Done { file_id: id() },
            json!({"type": "done", "fileId": "f-123"}),
        ),
        (
            Ctrl::Ack { file_id: id() },
            json!({"type": "ack", "fileId": "f-123"}),
        ),
        (Ctrl::BatchDone, json!({"type": "batch-done"})),
        (Ctrl::Bye, json!({"type": "bye"})),
        (
            Ctrl::Cancel {
                file_id: id(),
                reason: Some("User cancelled".into()),
            },
            json!({"type": "cancel", "fileId": "f-123", "reason": "User cancelled"}),
        ),
        (
            Ctrl::DownloadMode { manual: true },
            json!({"type": "download-mode", "manual": true}),
        ),
        (
            Ctrl::Pull { file_id: id() },
            json!({"type": "pull", "fileId": "f-123"}),
        ),
        (
            Ctrl::PullBatch {
                file_ids: vec!["f-1".into(), "f-2".into()],
            },
            json!({"type": "pull-batch", "fileIds": ["f-1", "f-2"]}),
        ),
        (
            Ctrl::DownloadAborted { file_id: id() },
            json!({"type": "download-aborted", "fileId": "f-123"}),
        ),
    ];
    assert_eq!(cases.len(), 13);
    for (msg, expected) in cases {
        assert_wire(msg, expected);
    }
}

#[test]
fn optional_fields_are_written_only_when_set() {
    assert_wire(
        Ctrl::Start {
            file_id: id(),
            chunk_size: 65_536,
            offset: Some(4096),
        },
        json!({"type": "start", "fileId": "f-123", "chunkSize": 65536, "offset": 4096}),
    );
    assert_wire(
        Ctrl::Cancel {
            file_id: id(),
            reason: None,
        },
        json!({"type": "cancel", "fileId": "f-123"}),
    );
}

#[test]
fn decodes_browser_messages() {
    let meta = Ctrl::decode(
        r#"{"type":"meta","fileId":"a","name":"x/y.txt","size":3,"mime":"text/plain"}"#,
    );
    assert_eq!(
        meta.unwrap(),
        Ctrl::Meta {
            file_id: "a".into(),
            name: "x/y.txt".into(),
            size: 3,
            mime: "text/plain".into(),
            hash: None,
        }
    );
    let start = Ctrl::decode(r#"{"type":"start","fileId":"a","chunkSize":262144,"extra":1}"#);
    assert_eq!(
        start.unwrap(),
        Ctrl::Start {
            file_id: "a".into(),
            chunk_size: 262_144,
            offset: None
        }
    );
}

#[test]
fn rejects_unknown_type_and_bad_json() {
    assert!(Ctrl::decode(r#"{"type":"auto"}"#).is_err());
    assert!(Ctrl::decode("not json").is_err());
    assert!(Ctrl::decode(r#"{"type":"pull"}"#).is_err());
}
