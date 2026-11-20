use std::sync::{Arc, Mutex};

use tempfile::TempDir;

use super::*;
use crate::config::Store;
use crate::protocol::file_identity;
use crate::state::{SessionState, Shared};
use crate::transfer::Outbound;

struct Harness {
    inbox: Inbox,
    link: Link,
    out: Outbound,
    cx: Cx,
    dir: TempDir,
}

fn harness(manual: bool) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let (link, out) = Link::new(64 * 1024);
    let store = Store::load(dir.path().join("config.json"));
    let cx = Cx {
        state: Shared::new(SessionState::default()),
        store: Arc::new(Mutex::new(store)),
    };
    let inbox = Inbox::new(dir.path().join("downloads"), manual);
    Harness {
        inbox,
        link,
        out,
        cx,
        dir,
    }
}

impl Harness {
    fn downloads(&self) -> PathBuf {
        self.dir.path().join("downloads")
    }

    fn sent(&mut self) -> Vec<Ctrl> {
        std::iter::from_fn(|| self.out.ctrl.try_recv().ok()).collect()
    }

    async fn meta(&mut self, id: &str, name: &str, size: u64, hash: &str) {
        let (link, cx) = (&self.link, &self.cx);
        let hash = Some(hash.to_string());
        self.inbox
            .on_meta(link, cx, id.into(), name.into(), size, hash)
            .await;
    }

    async fn start(&mut self, id: &str, chunk: u32) {
        self.inbox.on_start(&self.link, &self.cx, id, chunk).await;
    }

    async fn chunk(&mut self, data: &[u8]) {
        let chunk = Bytes::copy_from_slice(data);
        self.inbox.on_chunk(&self.link, &self.cx, chunk).await;
    }

    async fn done(&mut self, id: &str) {
        self.inbox.on_done(&self.link, &self.cx, id).await;
    }

    async fn partial(&self, hash: &str, data: &[u8]) {
        tokio::fs::create_dir_all(self.downloads()).await.unwrap();
        let path = self.downloads().join(partial::drop_name(hash));
        tokio::fs::write(path, data).await.unwrap();
    }

    fn drop_exists(&self, hash: &str) -> bool {
        self.downloads().join(partial::drop_name(hash)).exists()
    }

    fn row(&self, id: &str) -> Option<Transfer> {
        let state = self.cx.state.borrow();
        state.transfers.iter().find(|t| t.id == id).cloned()
    }

    fn offer_ids(&self) -> Vec<String> {
        let state = self.cx.state.borrow();
        state.offers.iter().map(|o| o.file_id.clone()).collect()
    }
}

fn pull(id: &str) -> Ctrl {
    Ctrl::Pull { file_id: id.into() }
}

#[test]
fn align_down_rounds_to_chunk_multiples() {
    assert_eq!(align_down(700, 500), 500);
    assert_eq!(align_down(1000, 500), 1000);
    assert_eq!(align_down(499, 500), 0);
    assert_eq!(align_down(123, 0), 0);
}

#[tokio::test]
async fn auto_receive_streams_credits_and_finalizes() {
    let mut h = harness(false);
    let total = 2_621_440u64; // 2.5 MiB
    let hash = file_identity("testfile.bin", total, 1_700_000_000_000);
    h.meta("file-1", "testfile.bin", total, &hash).await;
    assert_eq!(h.sent(), [pull("file-1")]);

    h.start("file-1", 65_536).await;
    let resume = Ctrl::Resume {
        file_id: "file-1".into(),
        hash: hash.clone(),
        bytes_offset: 0,
    };
    assert_eq!(h.sent(), [resume]);
    assert!(h.drop_exists(&hash), "bytes go to the .drop partial");
    assert!(!h.downloads().join("testfile.bin").exists());

    let data: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
    for chunk in data.chunks(65_536) {
        h.chunk(chunk).await;
    }
    h.done("file-1").await;

    let sent = h.sent();
    let credits: Vec<u64> = sent
        .iter()
        .filter_map(|m| match m {
            Ctrl::Credit {
                file_id,
                bytes_written,
            } if file_id == "file-1" => Some(*bytes_written),
            _ => None,
        })
        .collect();
    assert_eq!(credits, [1 << 20, 2 << 20, total]);
    assert_eq!(
        sent.last(),
        Some(&Ctrl::Ack {
            file_id: "file-1".into()
        })
    );

    let saved = tokio::fs::read(h.downloads().join("testfile.bin")).await;
    assert_eq!(saved.unwrap(), data);
    assert!(!h.drop_exists(&hash));
    let row = h.row("file-1").unwrap();
    assert_eq!(row.status, TransferStatus::Completed);
    assert_eq!(row.saved_as.as_deref(), Some("testfile.bin"));
    let stats = h.cx.store.lock().unwrap().config().transfer_stats;
    assert_eq!((stats.download_files, stats.download_bytes), (1, total));
}

#[tokio::test]
async fn resume_appends_to_retained_partial() {
    let mut h = harness(false);
    let hash = file_identity("partial.bin", 1000, 1_700_000_000_000);
    h.partial(&hash, &[1; 500]).await;
    h.meta("file-resume", "partial.bin", 1000, &hash).await;
    assert_eq!(h.row("file-resume").unwrap().bytes, 500);

    h.start("file-resume", 500).await;
    h.sent();
    h.chunk(&[2; 500]).await;
    h.done("file-resume").await;

    let saved = tokio::fs::read(h.downloads().join("partial.bin"))
        .await
        .unwrap();
    assert_eq!(saved[..500], [1; 500]);
    assert_eq!(saved[500..], [2; 500]);
    assert!(!h.drop_exists(&hash));
}

#[tokio::test]
async fn resume_offset_is_aligned_down_to_chunk_size() {
    let mut h = harness(false);
    h.partial("h", &[7; 700]).await;
    h.meta("f", "a.bin", 1000, "h").await;
    h.sent();
    h.start("f", 500).await;
    let resume = Ctrl::Resume {
        file_id: "f".into(),
        hash: "h".into(),
        bytes_offset: 500,
    };
    assert_eq!(h.sent(), [resume]);
    let partial = h.downloads().join(partial::drop_name("h"));
    assert_eq!(tokio::fs::metadata(partial).await.unwrap().len(), 500);
}

#[tokio::test]
async fn manual_mode_auto_pulls_only_retained_partials() {
    let mut h = harness(true);
    h.partial("autoresumehash", &[1; 500]).await;
    h.meta("f1", "a.bin", 1000, "autoresumehash").await;
    assert_eq!(h.sent(), [pull("f1")]);
    assert_eq!(h.row("f1").unwrap().hash, "autoresumehash");

    h.meta("f2", "b.bin", 1000, "freshhash").await;
    assert!(h.sent().is_empty(), "fresh announce waits for Baixar");
    assert_eq!(h.offer_ids(), ["f2"]);
    assert!(h.row("f2").is_none());
}

#[tokio::test]
async fn dismissed_identity_is_not_auto_pulled_again() {
    let mut h = harness(true);
    h.partial("dismisshash", &[1; 400]).await;
    h.meta("old-id", "x.bin", 1000, "dismisshash").await;
    h.sent();

    let (link, cx) = (&h.link, &h.cx);
    h.inbox.dismiss(link, cx, &["old-id".into()]).await;
    let aborted = Ctrl::DownloadAborted {
        file_id: "old-id".into(),
    };
    assert_eq!(h.sent(), [aborted]);
    assert!(!h.drop_exists("dismisshash"));
    assert!(h.row("old-id").is_none());

    h.meta("new-id", "x.bin", 1000, "dismisshash").await;
    assert!(h.sent().is_empty());
    assert_eq!(h.offer_ids(), ["new-id"]);
}

#[tokio::test]
async fn pull_sends_pull_or_pull_batch_and_moves_offers() {
    let mut h = harness(true);
    for id in ["a", "b", "c"] {
        h.meta(id, id, 10, id).await;
    }
    let (link, cx) = (&h.link, &h.cx);
    h.inbox.pull(link, cx, &["a".into()]).await;
    h.inbox
        .pull(link, cx, &["b".into(), "c".into(), "zzz".into()])
        .await;
    let batch = Ctrl::PullBatch {
        file_ids: vec!["b".into(), "c".into()],
    };
    assert_eq!(h.sent(), [pull("a"), batch]);
    assert!(h.offer_ids().is_empty());
    assert_eq!(h.row("b").unwrap().status, TransferStatus::Pending);
}

#[tokio::test]
async fn start_without_pull_is_refused() {
    let mut h = harness(true);
    h.meta("pending", "a.bin", 10, "h").await;
    h.start("pending", 4).await;
    h.start("unknown", 4).await;
    let refused = [
        Ctrl::DownloadAborted {
            file_id: "pending".into(),
        },
        Ctrl::Cancel {
            file_id: "unknown".into(),
            reason: None,
        },
    ];
    assert_eq!(h.sent(), refused);
    assert_eq!(h.offer_ids(), ["pending"]);
}

#[tokio::test]
async fn chunks_before_start_are_buffered() {
    let mut h = harness(false);
    h.meta("f", "early.bin", 6, "h").await;
    h.chunk(b"abc").await;
    h.start("f", 3).await;
    h.chunk(b"def").await;
    h.done("f").await;
    assert_eq!(
        h.sent().last(),
        Some(&Ctrl::Ack {
            file_id: "f".into()
        })
    );
    let saved = tokio::fs::read(h.downloads().join("early.bin")).await;
    assert_eq!(saved.unwrap(), b"abcdef");
}

#[tokio::test]
async fn done_waits_for_late_chunks() {
    let mut h = harness(false);
    h.meta("f", "late.bin", 4, "h").await;
    h.start("f", 2).await;
    h.chunk(b"ab").await;
    h.done("f").await;
    assert!(h.inbox.deadline().is_some());
    h.chunk(b"cd").await;
    assert_eq!(
        h.sent().last(),
        Some(&Ctrl::Ack {
            file_id: "f".into()
        })
    );
    assert!(h.inbox.deadline().is_none());
}

#[tokio::test]
async fn short_file_after_done_grace_is_cancelled() {
    let mut h = harness(false);
    h.meta("f", "short.bin", 10, "h").await;
    h.start("f", 5).await;
    h.chunk(&[0; 5]).await;
    h.done("f").await;
    h.inbox.finish(&h.link, &h.cx).await; // the grace deadline fired

    let cancel = Ctrl::Cancel {
        file_id: "f".into(),
        reason: Some(SIZE_MISMATCH.into()),
    };
    assert_eq!(h.sent().last(), Some(&cancel));
    assert!(!h.drop_exists("h"));
    assert!(!h.downloads().join("short.bin").exists());
    assert_eq!(h.row("f").unwrap().status, TransferStatus::Failed);
}

#[tokio::test]
async fn oversized_file_is_cancelled() {
    let mut h = harness(false);
    h.meta("f", "big.bin", 4, "h").await;
    h.start("f", 8).await;
    h.chunk(&[0; 6]).await;
    h.done("f").await;
    let sent = h.sent();
    assert!(matches!(sent.last(), Some(Ctrl::Cancel { file_id, .. }) if file_id == "f"));
    assert!(!sent.contains(&Ctrl::Ack {
        file_id: "f".into()
    }));
}

#[tokio::test]
async fn remote_cancel_discards_partial() {
    let mut h = harness(false);
    h.meta("f", "a.bin", 100, "h").await;
    h.start("f", 10).await;
    h.chunk(&[1; 10]).await;
    h.inbox.on_cancel(&h.cx, "f", None).await;
    assert!(!h.drop_exists("h"));
    assert_eq!(h.row("f").unwrap().status, TransferStatus::Cancelled);
    h.chunk(&[1; 10]).await; // still in flight for the cancelled file
    assert!(h.inbox.early.is_empty());
}

#[tokio::test]
async fn dismiss_mid_download_notifies_and_discards() {
    let mut h = harness(true);
    h.meta("f", "a.bin", 100, "h").await;
    let (link, cx) = (&h.link, &h.cx);
    h.inbox.pull(link, cx, &["f".into()]).await;
    h.start("f", 10).await;
    h.chunk(&[1; 10]).await;
    h.sent();

    let (link, cx) = (&h.link, &h.cx);
    h.inbox.dismiss(link, cx, &["f".into()]).await;
    let aborted = Ctrl::DownloadAborted {
        file_id: "f".into(),
    };
    assert_eq!(h.sent(), [aborted]);
    assert!(!h.drop_exists("h"));
    assert!(h.row("f").is_none());
}

#[tokio::test]
async fn peer_loss_keeps_partials_and_fails_receives_in_pt_br() {
    let mut h = harness(false);
    h.meta("recv-1", "p.bin", 100, "h1").await;
    h.start("recv-1", 10).await;
    h.chunk(&[1; 30]).await;

    h.inbox.abort().await;
    h.cx.state.send_modify(SessionState::interrupt);

    let partial = h.downloads().join(partial::drop_name("h1"));
    assert_eq!(tokio::fs::metadata(partial).await.unwrap().len(), 30);
    let row = h.row("recv-1").unwrap();
    assert_eq!(row.status, TransferStatus::Failed);
    assert_eq!(row.reason.as_deref(), Some("conexão perdida"));
}

#[tokio::test]
async fn batch_done_reports_files_received_since_last_batch() {
    let mut h = harness(false);
    h.meta("f", "a.bin", 1, "h").await;
    h.start("f", 1).await;
    h.chunk(b"x").await;
    h.done("f").await;
    h.inbox.on_batch_done(&h.cx);
    assert_eq!(h.cx.state.borrow().status, text::batch_complete(1));
    h.cx.state.send_modify(|s| s.status.clear());
    h.inbox.on_batch_done(&h.cx);
    assert!(
        h.cx.state.borrow().status.is_empty(),
        "idle batch-done is silent"
    );
}
