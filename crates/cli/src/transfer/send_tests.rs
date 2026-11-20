use std::sync::{Arc, Mutex};
use std::time::Duration;

use tempfile::TempDir;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::time::timeout;

use super::*;
use crate::config::Store;
use crate::protocol::split_frame;
use crate::rtc::Inbound;
use crate::state::{Command, SessionState, Shared};
use crate::transfer::{self, Inbox, Outbound};

/// Longer than every engine timeout, so paused-clock tests reach them first.
const WAIT: Duration = Duration::from_secs(60);
/// How long the outbox may keep running after the driver is done.
const SETTLE: Duration = Duration::from_millis(300);

struct Harness {
    dir: TempDir,
    cx: Cx,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::load(dir.path().join("config.json"));
    let cx = Cx {
        state: Shared::new(SessionState::default()),
        store: Arc::new(Mutex::new(store)),
    };
    Harness { dir, cx }
}

impl Harness {
    fn file(&self, name: &str, data: &[u8]) -> PathBuf {
        let path = self.dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, data).unwrap();
        path
    }

    fn row(&self, id: &str) -> Transfer {
        let state = self.cx.state.borrow();
        state
            .transfers
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .unwrap()
    }
}

/// One connection's channels as seen by the remote end.
struct Remote {
    out: Outbound,
    events: UnboundedSender<Ctrl>,
    /// File bytes per frame announced by the link.
    chunk: usize,
    /// Stream ID of the last `start`.
    stream: u32,
}

impl Remote {
    async fn ctrl(&mut self) -> Ctrl {
        timeout(WAIT, self.out.ctrl.recv())
            .await
            .expect("control message in time")
            .expect("link open")
    }

    /// Reads control messages until one matches.
    async fn until(&mut self, pred: impl Fn(&Ctrl) -> bool) -> Ctrl {
        loop {
            let msg = self.ctrl().await;
            if pred(&msg) {
                return msg;
            }
        }
    }

    async fn meta(&mut self) -> (String, String, String) {
        match self.until(|m| matches!(m, Ctrl::Meta { .. })).await {
            Ctrl::Meta {
                file_id,
                name,
                hash,
                ..
            } => (file_id, name, hash.unwrap()),
            _ => unreachable!(),
        }
    }

    async fn start(&mut self) -> String {
        match self.until(|m| matches!(m, Ctrl::Start { .. })).await {
            Ctrl::Start {
                file_id,
                chunk_size,
                stream_id,
                ..
            } => {
                assert_eq!(
                    chunk_size as usize, self.chunk,
                    "chunk size counts file bytes"
                );
                self.stream = stream_id;
                file_id
            }
            _ => unreachable!(),
        }
    }

    fn send(&self, msg: Ctrl) {
        self.events.send(msg).unwrap();
    }

    fn resume(&self, id: &str, hash: &str, offset: u64) {
        self.send(Ctrl::Resume {
            file_id: id.into(),
            hash: hash.into(),
            bytes_offset: offset,
        });
    }

    /// Reads `len` file bytes from frames of the last started stream.
    async fn bytes(&mut self, len: usize) -> Vec<u8> {
        let mut data = Vec::new();
        while data.len() < len {
            let frame = timeout(WAIT, self.out.files.recv()).await.unwrap().unwrap();
            let (stream, chunk) = split_frame(&frame).expect("frame header");
            assert_eq!(stream, self.stream, "frame of the current stream");
            assert!(chunk.len() <= self.chunk, "at most one chunk per frame");
            data.extend_from_slice(&chunk);
        }
        data
    }
}

/// Runs `outbox` on a fresh link with `drive` as the remote, which first announces `mode`
/// with `download-mode` (`None`: the driver does it). Returns how the outbox ended, `None`
/// when it is still running [`SETTLE`] after the driver finished.
async fn session<F: Future<Output = ()>>(
    outbox: &mut Outbox,
    cx: &Cx,
    chunk: usize,
    mode: Option<bool>,
    drive: impl FnOnce(Remote) -> F,
) -> Option<End> {
    let (link, out) = Link::new(chunk);
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let (_queue_tx, mut queue) = mpsc::unbounded_channel();
    if let Some(manual) = mode {
        events_tx.send(Ctrl::DownloadMode { manual }).unwrap();
    }
    let remote = Remote {
        out,
        events: events_tx,
        chunk,
        stream: 0,
    };
    let run = outbox.run(&link, &mut events, &mut queue, cx);
    let drive = drive(remote);
    tokio::pin!(run, drive);
    tokio::select! {
        end = &mut run => {
            // Let the driver read what is left (it may assert on it).
            timeout(WAIT, drive).await.expect("driver finishes");
            Some(end)
        }
        () = &mut drive => timeout(SETTLE, run).await.ok(),
    }
}

#[test]
fn announce_name_is_relative_to_watch_root_parent() {
    let root = Path::new("/data/photos");
    let name = announce_name(&root.join("nested").join("a.jpg"), Some(root));
    assert_eq!(name, "photos/nested/a.jpg");
    let root = Path::new("/data/project");
    let name = announce_name(&root.join("src").join("main.go"), Some(root));
    assert_eq!(name, "project/src/main.go");
}

#[test]
fn announce_name_single_file_keeps_basename() {
    assert_eq!(
        announce_name(Path::new("/tmp/report.pdf"), None),
        "report.pdf"
    );
    let outside = announce_name(Path::new("/other/x.txt"), Some(Path::new("/data/photos")));
    assert_eq!(outside, "x.txt");
}

#[tokio::test]
async fn watched_file_announces_relative_name_and_hash() {
    let h = harness();
    let path = h.file("root/nested/a.txt", b"hi");
    let entry = Outgoing::watched(path, &h.dir.path().join("root"));
    let mut outbox = Outbox::new(vec![entry], true);
    let end = session(&mut outbox, &h.cx, 1024, Some(false), |mut remote| async move {
        let (id, name, hash) = remote.meta().await;
        assert_eq!(name, "root/nested/a.txt");
        assert!(hash.starts_with("root/nested/a.txt|2|"), "{hash}");
        assert_eq!(remote.start().await, id, "auto peer starts without pull");
        remote.resume(&id, &hash, 0);
        assert_eq!(remote.bytes(2).await, b"hi");
        remote
            .until(|m| {
                *m == Ctrl::Done {
                    file_id: id.clone(),
                }
            })
            .await;
        remote.send(Ctrl::Ack {
            file_id: id.clone(),
        });
        assert_eq!(remote.ctrl().await, Ctrl::BatchDone);
    })
    .await;
    assert_eq!(end, Some(End::Sent));
    assert!(outbox.is_empty());
    let row = h.cx.state.borrow().transfers[0].clone();
    assert_eq!(row.status, TransferStatus::Completed);
    let stats = h.cx.store.lock().unwrap().config().transfer_stats;
    assert_eq!((stats.upload_files, stats.upload_bytes), (1, 2));
}

#[tokio::test]
async fn manual_peer_gets_no_start_before_pull() {
    let h = harness();
    let path = h.file("file.bin", &[1; 4096]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let end = session(&mut outbox, &h.cx, 1024, Some(true), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        let early = timeout(Duration::from_millis(150), remote.out.ctrl.recv()).await;
        assert!(early.is_err(), "nothing before pull: {early:?}");

        remote.send(Ctrl::Pull {
            file_id: id.clone(),
        });
        assert_eq!(remote.start().await, id);
        remote.resume(&id, &hash, 0);
        remote.bytes(4096).await;
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn sender_waits_for_download_mode_before_the_first_start() {
    let h = harness();
    let path = h.file("mode.bin", b"mode");
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let end = session(&mut outbox, &h.cx, 1024, None, |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        let early = timeout(Duration::from_millis(150), remote.out.ctrl.recv()).await;
        assert!(early.is_err(), "nothing before download-mode: {early:?}");

        remote.send(Ctrl::DownloadMode { manual: false });
        assert_eq!(remote.start().await, id, "an auto peer starts once it said so");
        remote.resume(&id, &hash, 0);
        assert_eq!(remote.bytes(4).await, b"mode");
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn manual_remote_after_reconnect_is_not_sent_an_unpulled_file() {
    let h = harness();
    let path = h.file("again.bin", &[7; 64 * 1024]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let first = session(&mut outbox, &h.cx, 4096, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        remote.bytes(4096).await;
    })
    .await;
    assert_eq!(first, Some(End::Lost));
    outbox.abort();

    // The new peer is manual; its `download-mode` comes after the announcement.
    let end = session(&mut outbox, &h.cx, 4096, None, |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.send(Ctrl::DownloadMode { manual: true });
        let early = timeout(Duration::from_millis(150), remote.out.ctrl.recv()).await;
        assert!(early.is_err(), "no start for an unpulled file: {early:?}");

        remote.send(Ctrl::Pull {
            file_id: id.clone(),
        });
        assert_eq!(remote.start().await, id);
        remote.resume(&id, &hash, 0);
        remote.bytes(64 * 1024).await;
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn download_aborted_before_pull_keeps_offer_pending() {
    let h = harness();
    let path = h.file("x.bin", b"data");
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let state = h.cx.state.clone();
    let end = session(&mut outbox, &h.cx, 1024, Some(true), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.send(Ctrl::DownloadAborted {
            file_id: id.clone(),
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(state.borrow().transfers[0].status, TransferStatus::Pending);

        remote.send(Ctrl::Pull {
            file_id: id.clone(),
        });
        assert_eq!(remote.start().await, id);
        remote.resume(&id, &hash, 0);
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn download_aborted_mid_send_resets_to_pending() {
    let h = harness();
    let path = h.file("big.bin", &[2; 256 * 1024]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let state = h.cx.state.clone();
    let end = session(&mut outbox, &h.cx, 4096, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        remote.bytes(8192).await;
        remote.send(Ctrl::DownloadAborted {
            file_id: id.clone(),
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        let row = state.borrow().transfers[0].clone();
        assert_eq!((row.status, row.bytes), (TransferStatus::Pending, 0));
        while let Ok(msg) = remote.out.ctrl.try_recv() {
            assert_ne!(
                msg,
                Ctrl::Done {
                    file_id: id.clone()
                }
            );
        }
    })
    .await;
    // Still waiting for a new pull when the remote went away.
    assert_eq!(end, Some(End::Lost));
    assert!(!outbox.is_empty());
}

#[tokio::test]
async fn inbound_cancel_stops_the_send_and_moves_on() {
    let h = harness();
    let total = 256 * 1024;
    let big = h.file("big.bin", &[3; 256 * 1024]);
    let small = h.file("small.bin", b"next");
    let files = vec![Outgoing::file(big), Outgoing::file(small)];
    let mut outbox = Outbox::new(files, true);
    let state = h.cx.state.clone();
    let end = session(&mut outbox, &h.cx, 4096, Some(false), |mut remote| async move {
        let (big_id, _, big_hash) = remote.meta().await;
        let (small_id, _, small_hash) = remote.meta().await;
        assert_eq!(remote.start().await, big_id);
        remote.resume(&big_id, &big_hash, 0);
        remote.bytes(4096).await;
        remote.send(Ctrl::Cancel {
            file_id: big_id.clone(),
            reason: None,
        });

        assert_eq!(
            remote.start().await,
            small_id,
            "next file follows the cancel"
        );
        let mut big_bytes = 4096;
        while let Ok(frame) = remote.out.files.try_recv() {
            big_bytes += frame.len() - FRAME_HEADER;
        }
        assert!(big_bytes < total, "the cancelled file was not sent in full");
        let row = state.borrow().transfers[0].clone();
        assert_eq!(row.status, TransferStatus::Cancelled);

        remote.resume(&small_id, &small_hash, 0);
        assert_eq!(remote.bytes(4).await, b"next");
        let done = remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        assert_eq!(
            done,
            Ctrl::Done {
                file_id: small_id.clone()
            }
        );
        remote.send(Ctrl::Ack { file_id: small_id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn resume_offset_is_honored_only_for_matching_hash() {
    let h = harness();
    let data: Vec<u8> = (0..4000u32).map(|i| i as u8).collect();
    let path = h.file("r.bin", &data);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], false);
    let tail = data[2000..].to_vec();
    session(&mut outbox, &h.cx, 1000, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        let first = remote.stream;
        remote.resume(&id, "other|1|2", 2000);
        assert_eq!(
            remote.bytes(4000).await.len(),
            4000,
            "mismatch restarts at 0"
        );
        remote.send(Ctrl::DownloadAborted {
            file_id: id.clone(),
        });
        remote.send(Ctrl::Pull {
            file_id: id.clone(),
        });
        remote.start().await;
        assert_ne!(
            remote.stream, first,
            "a new start of the same file gets a new stream"
        );
        remote.resume(&id, &hash, 2000);
        assert_eq!(
            remote.bytes(2000).await,
            tail,
            "match continues at the offset"
        );
    })
    .await;
}

#[tokio::test]
async fn window_holds_at_8_mib_until_credit_for_that_file() {
    let h = harness();
    let chunk = 64 * 1024;
    let path = h.file("w.bin", &vec![9; 9 << 20]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let end = session(&mut outbox, &h.cx, chunk, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        remote.bytes(8 << 20).await;
        let more = timeout(Duration::from_millis(200), remote.out.files.recv()).await;
        assert!(more.is_err(), "window full");

        remote.send(Ctrl::Credit {
            file_id: "someone-else".into(),
            bytes_written: 9 << 20,
        });
        let more = timeout(Duration::from_millis(200), remote.out.files.recv()).await;
        assert!(more.is_err(), "foreign credit is ignored");

        remote.send(Ctrl::Credit {
            file_id: id.clone(),
            bytes_written: 1 << 20,
        });
        remote.bytes(1 << 20).await;
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
}

#[tokio::test]
async fn progress_follows_credits_and_stays_below_size_until_ack() {
    let h = harness();
    let path = h.file("p.bin", &[1; 3000]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let state = h.cx.state.clone();
    session(&mut outbox, &h.cx, 1000, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        assert_eq!(
            state.borrow().transfers[0].bytes,
            0,
            "sent is not confirmed"
        );
        for written in [1000, 3000] {
            remote.send(Ctrl::Credit {
                file_id: id.clone(),
                bytes_written: written,
            });
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(state.borrow().transfers[0].bytes, 1000);
        remote.send(Ctrl::Ack { file_id: id });
        tokio::time::sleep(Duration::from_millis(50)).await;
        let row = state.borrow().transfers[0].clone();
        assert_eq!((row.status, row.bytes), (TransferStatus::Completed, 3000));
    })
    .await;
}

#[tokio::test(start_paused = true)]
async fn missing_resume_fails_the_file_and_sends_cancel() {
    let h = harness();
    let path = h.file("t.bin", b"abc");
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let end = session(&mut outbox, &h.cx, 1024, Some(false), |mut remote| async move {
        let (id, _, _) = remote.meta().await;
        remote.start().await;
        let cancel = remote.until(|m| matches!(m, Ctrl::Cancel { .. })).await;
        assert_eq!(
            cancel,
            Ctrl::Cancel { file_id: id, reason: Some(RESUME_TIMED_OUT.into()) }
        );
        assert_eq!(remote.ctrl().await, Ctrl::BatchDone);
    })
    .await;
    assert_eq!(end, Some(End::Sent));
    let row = h.cx.state.borrow().transfers[0].clone();
    assert_eq!(row.status, TransferStatus::Failed);
    assert_eq!(row.reason.as_deref(), Some(RESUME_TIMED_OUT));
}

#[tokio::test(start_paused = true)]
async fn missing_ack_fails_the_file_and_sends_cancel() {
    let h = harness();
    let path = h.file("t.bin", b"abc");
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let end = session(&mut outbox, &h.cx, 1024, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        assert_eq!(remote.bytes(3).await, b"abc");
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        let cancel = remote.until(|m| matches!(m, Ctrl::Cancel { .. })).await;
        assert_eq!(cancel, Ctrl::Cancel { file_id: id, reason: Some(ACK_TIMED_OUT.into()) });
        assert_eq!(remote.ctrl().await, Ctrl::BatchDone);
    })
    .await;
    assert_eq!(end, Some(End::Sent));
    let row = h.cx.state.borrow().transfers[0].clone();
    assert_eq!(row.status, TransferStatus::Failed);
    assert_eq!(row.reason.as_deref(), Some(ACK_TIMED_OUT));
}

#[tokio::test]
async fn peer_loss_requeues_and_reannounces_with_one_row() {
    let h = harness();
    let path = h.file("again.bin", &[5; 64 * 1024]);
    let mut outbox = Outbox::new(vec![Outgoing::file(path)], true);
    let first = session(&mut outbox, &h.cx, 4096, Some(false), |mut remote| async move {
        let (id, _, hash) = remote.meta().await;
        remote.start().await;
        remote.resume(&id, &hash, 0);
        remote.bytes(4096).await;
    })
    .await;
    assert_eq!(first, Some(End::Lost), "the remote vanished mid-file");
    outbox.abort();
    h.cx.state.send_modify(SessionState::interrupt);
    assert!(!outbox.is_empty(), "the interrupted file stays queued");
    let old_id = h.cx.state.borrow().transfers[0].id.clone();
    assert_eq!(h.row(&old_id).reason.as_deref(), Some("conexão perdida"));

    let end = session(&mut outbox, &h.cx, 4096, Some(false), |mut remote| async move {
        let (id, name, hash) = remote.meta().await;
        assert_ne!(id, old_id);
        assert_eq!(name, "again.bin");
        remote.start().await;
        remote.resume(&id, &hash, 32 * 1024);
        remote.bytes(32 * 1024).await;
        remote.until(|m| matches!(m, Ctrl::Done { .. })).await;
        remote.send(Ctrl::Ack { file_id: id });
    })
    .await;
    assert_eq!(end, Some(End::Sent));
    let transfers = h.cx.state.borrow().transfers.clone();
    assert_eq!(transfers.len(), 1);
    assert_eq!(transfers[0].status, TransferStatus::Completed);
}

#[tokio::test]
async fn files_queued_while_connected_are_announced_and_sent() {
    let h = harness();
    let path = h.file("late.bin", b"late");
    let mut outbox = Outbox::new(Vec::new(), false);
    let (link, mut out) = Link::new(1024);
    let (events_tx, mut events) = mpsc::unbounded_channel();
    let (queue_tx, mut queue) = mpsc::unbounded_channel();
    let run = outbox.run(&link, &mut events, &mut queue, &h.cx);
    events_tx.send(Ctrl::DownloadMode { manual: false }).unwrap();
    let drive = async {
        queue_tx.send(Outgoing::file(path)).unwrap();
        let Some(Ctrl::Meta { file_id, hash, .. }) = out.ctrl.recv().await else {
            panic!("meta first");
        };
        let Some(Ctrl::Start { stream_id, .. }) = out.ctrl.recv().await else {
            panic!("start after meta");
        };
        events_tx
            .send(Ctrl::Resume {
                file_id: file_id.clone(),
                hash: hash.unwrap(),
                bytes_offset: 0,
            })
            .unwrap();
        let frame = out.files.recv().await.unwrap();
        assert_eq!(frame[..FRAME_HEADER], stream_id.to_be_bytes());
        assert_eq!(&frame[FRAME_HEADER..], b"late");
    };
    tokio::select! {
        end = run => panic!("outbox ended: {end:?}"),
        () = drive => {}
    }
}

/// Feeds what one engine queued into the other engine's inbound channels.
fn bridge(out: Outbound) -> Inbound {
    let (ctrl_tx, ctrl) = mpsc::channel(64);
    let (files_tx, files) = mpsc::channel(64);
    let Outbound {
        ctrl: mut out_ctrl,
        files: mut out_files,
    } = out;
    tokio::spawn(async move {
        while let Some(msg) = out_ctrl.recv().await {
            if ctrl_tx.send(msg.encode()).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(chunk) = out_files.recv().await {
            if files_tx.send(chunk).await.is_err() {
                break;
            }
        }
    });
    Inbound { ctrl, files }
}

#[tokio::test]
async fn simulated_transfer_through_two_engines_is_byte_exact() {
    let send_side = harness();
    let recv_side = harness();
    let data: Vec<u8> = (0..(9u32 << 20)).map(|i| (i * 31 % 253) as u8).collect();
    let path = send_side.file("large_sample.dat", &data);

    let (send_link, send_out) = Link::new(64 * 1024);
    let (recv_link, recv_out) = Link::new(64 * 1024);
    let recv_in = bridge(send_out);
    let send_in = bridge(recv_out);
    let downloads = recv_side.dir.path().join("downloads");

    let mut sender = (
        Inbox::new(send_side.dir.path().join("unused"), false),
        Outbox::new(vec![Outgoing::file(path)], true),
    );
    let mut receiver = (
        Inbox::new(downloads.clone(), false),
        Outbox::new(Vec::new(), false),
    );
    let (_cmd_a, mut cmds_a) = mpsc::channel::<Command>(1);
    let (_cmd_b, mut cmds_b) = mpsc::channel::<Command>(1);
    let (_q_a, mut queue_a) = mpsc::unbounded_channel();
    let (_q_b, mut queue_b) = mpsc::unbounded_channel();

    let send_run = transfer::run(
        &send_link,
        send_in,
        &mut sender.0,
        &mut sender.1,
        &mut cmds_a,
        &mut queue_a,
        &send_side.cx,
    );
    let recv_run = transfer::run(
        &recv_link,
        recv_in,
        &mut receiver.0,
        &mut receiver.1,
        &mut cmds_b,
        &mut queue_b,
        &recv_side.cx,
    );
    let (send_end, recv_end) = timeout(Duration::from_secs(30), async {
        tokio::join!(send_run, recv_run)
    })
    .await
    .expect("transfer in time");

    assert_eq!((send_end, recv_end), (End::Sent, End::Bye));
    let received = std::fs::read(downloads.join("large_sample.dat")).unwrap();
    assert!(received == data, "content differs");
    for side in [&send_side, &recv_side] {
        let state = side.cx.state.borrow();
        assert_eq!(state.transfers.len(), 1);
        assert_eq!(state.transfers[0].status, TransferStatus::Completed);
    }
}
