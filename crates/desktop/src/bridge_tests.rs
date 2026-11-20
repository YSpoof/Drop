use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

use crate::server::{self, Server};

const TOKEN: &str = "test-secret-token";

struct Client {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    _server: Server,
}

impl Client {
    async fn connect() -> Self {
        let server = server::start(TOKEN.into()).await.unwrap();
        let url = format!("ws://127.0.0.1:{}/bridge?token={TOKEN}", server.port);
        let (ws, _) = connect_async(url).await.unwrap();
        Self {
            ws,
            _server: server,
        }
    }

    async fn send(&mut self, frame: String) {
        self.ws.send(WsMessage::text(frame)).await.unwrap();
    }

    async fn next(&mut self) -> Value {
        let message = tokio::time::timeout(Duration::from_secs(5), self.ws.next())
            .await
            .expect("bridge frame within 5 s")
            .unwrap()
            .unwrap();
        serde_json::from_str(message.to_text().unwrap()).unwrap()
    }

    /// Returns the response with this id, skipping pushes.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = format!("{method}-{params}");
        self.send(json!({ "id": id, "method": method, "params": params }).to_string())
            .await;
        loop {
            let frame = self.next().await;
            if frame["id"] == id {
                return frame;
            }
        }
    }

    async fn ok(&mut self, method: &str, params: Value) -> Value {
        let response = self.call(method, params).await;
        assert!(response.get("error").is_none(), "{method}: {response}");
        response["result"].clone()
    }

    async fn push(&mut self) -> Value {
        loop {
            let frame = self.next().await;
            if frame["event"] == "watch.event" {
                return frame["data"].clone();
            }
        }
    }
}

fn lossy(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn bridge_requires_token() {
    let server = server::start(TOKEN.into()).await.unwrap();
    let base = format!("ws://127.0.0.1:{}/bridge", server.port);
    assert!(connect_async(base.clone()).await.is_err());
    assert!(connect_async(format!("{base}?token=wrong")).await.is_err());
}

#[tokio::test]
async fn bridge_fs_operations() {
    let mut client = Client::connect().await;
    let tmp = tempfile::tempdir().unwrap();

    let downloads = client.ok("fs.getDownloadsPath", Value::Null).await;
    assert!(!downloads.as_str().unwrap().is_empty());

    let sub = tmp.path().join("nested").join("subfolder");
    client.ok("fs.mkdir", json!({ "path": lossy(&sub) })).await;
    assert!(sub.is_dir());

    let file = sub.join("hello.txt");
    std::fs::write(&file, "Hello Drop!").unwrap();

    let stat = client.ok("fs.stat", json!({ "path": lossy(&file) })).await;
    assert_eq!(stat["exists"], true);
    assert_eq!(stat["size"], 11);
    assert_eq!(stat["isDirectory"], false);
    assert!(stat["modifiedAt"].as_i64().unwrap() > 0);

    let missing = client
        .ok("fs.stat", json!({ "path": lossy(&sub.join("nope")) }))
        .await;
    assert_eq!(missing["exists"], false);

    let entries = client
        .ok("fs.readDir", json!({ "path": lossy(&sub) }))
        .await;
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["entry"], "hello.txt");
    assert_eq!(entries[0]["type"], "FILE");
    assert_eq!(entries[0]["path"], lossy(&file));
    assert_eq!(entries[0]["size"], 11);

    let moved = tmp.path().join("moved.txt");
    client
        .ok(
            "fs.move",
            json!({ "from": lossy(&file), "to": lossy(&moved) }),
        )
        .await;
    assert!(!file.exists());
    assert!(moved.exists());

    client
        .ok("fs.remove", json!({ "path": lossy(&moved) }))
        .await;
    assert!(!moved.exists());

    client
        .ok(
            "fs.remove",
            json!({ "path": lossy(&tmp.path().join("nested")) }),
        )
        .await;
    assert!(!sub.exists());
    client
        .ok(
            "fs.remove",
            json!({ "path": lossy(&tmp.path().join("nested")) }),
        )
        .await;
}

#[tokio::test]
async fn bridge_read_dir_of_empty_directory_is_empty_list() {
    let mut client = Client::connect().await;
    let tmp = tempfile::tempdir().unwrap();
    let entries = client
        .ok("fs.readDir", json!({ "path": lossy(tmp.path()) }))
        .await;
    assert_eq!(entries, json!([]));
}

#[tokio::test]
async fn bridge_reports_errors() {
    let mut client = Client::connect().await;

    let unknown = client.call("fs.nope", Value::Null).await;
    assert_eq!(unknown["error"], "method not found: fs.nope");

    let invalid = client.call("fs.stat", Value::Null).await;
    assert!(
        invalid["error"]
            .as_str()
            .unwrap()
            .starts_with("invalid params:")
    );

    let missing = client
        .call("watch.start", json!({ "watcherId": "w" }))
        .await;
    assert_eq!(missing["error"], "missing watcherId or folderPath");

    let absent = client
        .call(
            "watch.start",
            json!({ "watcherId": "w", "folderPath": "/no/such/dir" }),
        )
        .await;
    assert!(absent["error"].is_string());

    client.send("not json".into()).await;
    let garbage = client.next().await;
    assert_eq!(garbage["id"], "");
    assert!(
        garbage["error"]
            .as_str()
            .unwrap()
            .starts_with("invalid request:")
    );
}

#[tokio::test]
async fn bridge_answers_concurrent_requests() {
    let mut client = Client::connect().await;
    let tmp = tempfile::tempdir().unwrap();
    for n in 0..8 {
        let frame = json!({ "id": n.to_string(), "method": "fs.stat", "params": { "path": lossy(tmp.path()) } });
        client.send(frame.to_string()).await;
    }
    let mut ids: Vec<String> = Vec::new();
    for _ in 0..8 {
        let frame = client.next().await;
        assert_eq!(frame["result"]["isDirectory"], true);
        ids.push(frame["id"].as_str().unwrap().into());
    }
    ids.sort();
    assert_eq!(ids, (0..8).map(|n| n.to_string()).collect::<Vec<_>>());
}

#[tokio::test]
async fn bridge_watch_pushes_add_with_size_and_unlink() {
    let mut client = Client::connect().await;
    let tmp = tempfile::tempdir().unwrap();
    let folder = lossy(tmp.path());

    client
        .ok(
            "watch.start",
            json!({ "watcherId": "w1", "folderPath": folder }),
        )
        .await;
    client
        .ok(
            "watch.start",
            json!({ "watcherId": "w1", "folderPath": folder }),
        )
        .await;

    let empty = tmp.path().join("empty.bin");
    std::fs::write(&empty, b"").unwrap();
    let event = client.push().await;
    assert_eq!(
        event,
        json!({ "type": "add", "watcherId": "w1", "filePath": lossy(&empty), "size": 0 })
    );

    let full = tmp.path().join("full.bin");
    std::fs::write(&full, b"12345").unwrap();
    let event = client.push().await;
    assert_eq!(event["type"], "add");
    assert_eq!(event["size"], 5);

    std::fs::remove_file(&full).unwrap();
    let event = client.push().await;
    assert_eq!(
        event,
        json!({ "type": "unlink", "watcherId": "w1", "filePath": lossy(&full) })
    );

    client.ok("watch.stop", json!({ "watcherId": "w1" })).await;
    client.ok("watch.stop", json!({ "watcherId": "w1" })).await;
}
