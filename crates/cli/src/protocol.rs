//! Control messages exchanged on the `ctrl` data channel (JSON text frames).

use bytes::Bytes;
use serde::{Deserialize, Serialize};

/// Sender-side flow-control window per file.
pub const SEND_WINDOW: u64 = 8 * 1024 * 1024;
/// Receiver grants credit every this many bytes.
pub const CREDIT_BATCH: u64 = 1024 * 1024;
/// Bytes of the big-endian stream ID that starts every `files` frame.
pub const FRAME_HEADER: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Ctrl {
    Meta {
        file_id: String,
        name: String,
        size: u64,
        #[serde(default)]
        mime: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hash: Option<String>,
    },
    Start {
        file_id: String,
        chunk_size: u32,
        stream_id: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offset: Option<u64>,
    },
    Resume {
        file_id: String,
        hash: String,
        bytes_offset: u64,
    },
    Credit {
        file_id: String,
        bytes_written: u64,
    },
    Done {
        file_id: String,
    },
    Ack {
        file_id: String,
    },
    BatchDone,
    Bye,
    Cancel {
        file_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    DownloadMode {
        manual: bool,
    },
    Pull {
        file_id: String,
    },
    PullBatch {
        file_ids: Vec<String>,
    },
    DownloadAborted {
        file_id: String,
    },
}

impl Ctrl {
    pub fn encode(&self) -> String {
        serde_json::to_string(self).expect("control messages always serialize")
    }

    pub fn decode(text: &str) -> serde_json::Result<Self> {
        serde_json::from_str(text)
    }
}

/// Splits a `files` frame into its stream ID and file bytes; `None` when it is too short.
pub fn split_frame(frame: &Bytes) -> Option<(u32, Bytes)> {
    let header = frame.get(..FRAME_HEADER)?.try_into().ok()?;
    Some((u32::from_be_bytes(header), frame.slice(FRAME_HEADER..)))
}

/// Identity shared with the browser (`meta.hash`, `resume.hash`): `name|size|mtimeMs`.
pub fn file_identity(name: &str, size: u64, mtime_ms: i64) -> String {
    format!("{name}|{size}|{mtime_ms}")
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
