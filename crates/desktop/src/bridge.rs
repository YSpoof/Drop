//! WebSocket JSON-RPC: `{id, method, params}` → `{id, result}` | `{id, error}`; pushes `{event, data}`.

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use drop_core::watch::{WatchEvent, Watcher};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::sync::{broadcast, mpsc};

use crate::{dialog, fs};

pub struct Bridge {
    pushes: broadcast::Sender<String>,
    watchers: Mutex<HashMap<String, Watcher>>,
}

#[derive(Deserialize)]
struct Request {
    #[serde(default)]
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Deserialize)]
struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
struct MoveArgs {
    from: String,
    to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchArgs {
    #[serde(default)]
    watcher_id: String,
    #[serde(default)]
    folder_path: String,
}

pub async fn upgrade(State(bridge): State<Arc<Bridge>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| bridge.session(socket))
}

impl Bridge {
    pub fn new() -> Self {
        Self {
            pushes: broadcast::channel(256).0,
            watchers: Mutex::default(),
        }
    }

    /// One task per request, so a slow call (an open dialog) never blocks the others.
    async fn session(self: Arc<Self>, socket: WebSocket) {
        let (mut sink, mut stream) = socket.split();
        let (replies, mut outgoing) = mpsc::unbounded_channel::<String>();
        let mut pushes = self.pushes.subscribe();
        let writer = tokio::spawn(async move {
            loop {
                let text = tokio::select! {
                    Some(text) = outgoing.recv() => text,
                    push = pushes.recv() => match push {
                        Ok(text) => text,
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => break,
                    },
                };
                if sink.send(Message::Text(text.into())).await.is_err() {
                    break;
                }
            }
        });

        while let Some(Ok(message)) = stream.next().await {
            let frame = match message {
                Message::Text(text) => text.into(),
                Message::Binary(bytes) => bytes,
                Message::Close(_) => break,
                _ => continue,
            };
            let (bridge, replies) = (self.clone(), replies.clone());
            tokio::spawn(async move {
                let _ = replies.send(bridge.handle(&frame).await);
            });
        }
        writer.abort();
    }

    async fn handle(&self, frame: &[u8]) -> String {
        let reply = match serde_json::from_slice::<Request>(frame) {
            Ok(req) => (req.id, self.call(&req.method, req.params).await),
            Err(err) => (String::new(), Err(format!("invalid request: {err}"))),
        };
        match reply {
            (id, Ok(result)) => json!({ "id": id, "result": result }),
            (id, Err(error)) => json!({ "id": id, "error": error }),
        }
        .to_string()
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "fs.getDownloadsPath" => to_value(fs::downloads_dir().await),
            "fs.stat" => to_value(fs::stat(&args::<PathArgs>(params)?.path).await),
            "fs.readDir" => to_value(fs::read_dir(&args::<PathArgs>(params)?.path).await),
            "fs.mkdir" => to_value(fs::mkdir(&args::<PathArgs>(params)?.path).await),
            "fs.remove" => to_value(fs::remove(&args::<PathArgs>(params)?.path).await),
            "fs.move" => {
                let MoveArgs { from, to } = args(params)?;
                to_value(fs::rename(&from, &to).await)
            }
            "dialog.pickFiles" => Ok(json!(
                dialog::pick_files(dialog::Options::from_params(params)).await
            )),
            "dialog.pickFolder" => Ok(json!(
                dialog::pick_folder(dialog::Options::from_params(params)).await
            )),
            "watch.start" => to_value(self.watch(args(params)?)),
            "watch.stop" => {
                let WatchArgs { watcher_id, .. } = args(params)?;
                self.watchers.lock().unwrap().remove(&watcher_id);
                Ok(Value::Null)
            }
            _ => Err(format!("method not found: {method}")),
        }
    }

    /// Starting an id that is already watched is a no-op.
    fn watch(
        &self,
        WatchArgs {
            watcher_id,
            folder_path,
        }: WatchArgs,
    ) -> io::Result<()> {
        if watcher_id.is_empty() || folder_path.is_empty() {
            return Err(io::Error::other("missing watcherId or folderPath"));
        }
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.contains_key(&watcher_id) {
            return Ok(());
        }
        let (watcher, mut events) = Watcher::start(Path::new(&folder_path))?;
        let pushes = self.pushes.clone();
        let id = watcher_id.clone();
        tokio::spawn(async move {
            while let Some(event) = events.recv().await {
                let push = json!({ "event": "watch.event", "data": watch_event(&id, event) });
                let _ = pushes.send(push.to_string());
            }
        });
        watchers.insert(watcher_id, watcher);
        Ok(())
    }
}

/// `size` is always present on `add`, even for empty files.
fn watch_event(watcher_id: &str, event: WatchEvent) -> Value {
    match event {
        WatchEvent::Add { path, size } => json!({
            "type": "add", "watcherId": watcher_id, "filePath": fs::lossy(&path), "size": size,
        }),
        WatchEvent::Unlink { path } => json!({
            "type": "unlink", "watcherId": watcher_id, "filePath": fs::lossy(&path),
        }),
    }
}

fn args<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|err| format!("invalid params: {err}"))
}

fn to_value<T: serde::Serialize>(result: io::Result<T>) -> Result<Value, String> {
    result
        .map_err(|err| err.to_string())
        .and_then(|value| serde_json::to_value(value).map_err(|err| err.to_string()))
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
