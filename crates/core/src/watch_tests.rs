use std::cell::Cell;
use std::fs;
use std::io::Write;

use tokio::time::{sleep, timeout};

use super::*;

const TIMEOUT: Duration = Duration::from_secs(5);
const FAST: Settle = Settle {
    interval: Duration::from_millis(20),
    max_polls: 40,
};

fn start(dir: &Path) -> (Watcher, UnboundedReceiver<WatchEvent>) {
    Watcher::start_with(dir, FAST).expect("start watcher")
}

async fn next(rx: &mut UnboundedReceiver<WatchEvent>) -> WatchEvent {
    timeout(TIMEOUT, rx.recv())
        .await
        .expect("timed out waiting for event")
        .expect("receiver closed")
}

async fn assert_quiet(rx: &mut UnboundedReceiver<WatchEvent>, wait: Duration) {
    sleep(wait).await;
    assert_eq!(rx.try_recv().ok(), None);
}

fn add(path: PathBuf, size: u64) -> WatchEvent {
    WatchEvent::Add { path, size }
}

#[tokio::test]
async fn reports_add_then_unlink() {
    let dir = tempfile::tempdir().unwrap();
    let (_watcher, mut rx) = start(dir.path());
    let path = dir.path().join("sample.txt");

    fs::write(&path, b"Testing watcher event").unwrap();
    assert_eq!(next(&mut rx).await, add(path.clone(), 21));

    fs::remove_file(&path).unwrap();
    assert_eq!(next(&mut rx).await, WatchEvent::Unlink { path });
}

#[tokio::test]
async fn start_fails_for_missing_root() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Watcher::start(&dir.path().join("missing")).is_err());
}

#[tokio::test]
async fn start_fails_for_file_root() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("file.txt");
    fs::write(&file, b"x").unwrap();
    assert!(Watcher::start(&file).is_err());
}

#[test]
fn start_fails_outside_runtime() {
    let dir = tempfile::tempdir().unwrap();
    assert!(Watcher::start(dir.path()).is_err());
}

#[tokio::test]
async fn new_file_is_reported_once() {
    let dir = tempfile::tempdir().unwrap();
    let (_watcher, mut rx) = start(dir.path());
    let path = dir.path().join("hello.txt");

    fs::write(&path, b"hello world").unwrap();
    assert_eq!(next(&mut rx).await, add(path, 11));
    assert_quiet(&mut rx, Duration::from_millis(300)).await;
}

#[tokio::test]
async fn existing_file_is_reported_only_when_modified() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.txt");
    fs::write(&path, b"initial").unwrap();
    let (_watcher, mut rx) = start(dir.path());

    assert_quiet(&mut rx, Duration::from_millis(300)).await;
    fs::write(&path, b"modified content").unwrap();
    assert_eq!(next(&mut rx).await, add(path, 16));
}

#[tokio::test]
async fn reports_files_in_new_nested_directories() {
    let dir = tempfile::tempdir().unwrap();
    let (_watcher, mut rx) = start(dir.path());
    let nested = dir.path().join("nested").join("deep");
    fs::create_dir_all(&nested).unwrap();

    let path = nested.join("file.bin");
    fs::write(&path, b"nested").unwrap();
    assert_eq!(next(&mut rx).await, add(path, 6));
}

#[tokio::test]
async fn reports_files_already_inside_moved_in_directory() {
    let dir = tempfile::tempdir().unwrap();
    let staging = dir.path().join(".staging");
    fs::create_dir_all(staging.join("inner")).unwrap();
    fs::write(staging.join("a.txt"), b"aa").unwrap();
    fs::write(staging.join("inner").join("b.txt"), b"bbb").unwrap();
    fs::write(staging.join(".skip"), b"hidden").unwrap();
    let (_watcher, mut rx) = start(dir.path());

    let moved = dir.path().join("moved");
    fs::rename(&staging, &moved).unwrap();

    let mut events = vec![next(&mut rx).await, next(&mut rx).await];
    events.sort_by_key(|e| format!("{e:?}"));
    assert_eq!(
        events,
        [
            add(moved.join("a.txt"), 2),
            add(moved.join("inner").join("b.txt"), 3)
        ]
    );
    assert_quiet(&mut rx, Duration::from_millis(300)).await;
}

#[tokio::test]
async fn directory_creation_alone_emits_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (_watcher, mut rx) = start(dir.path());

    fs::create_dir(dir.path().join("subdir")).unwrap();
    assert_quiet(&mut rx, Duration::from_millis(300)).await;
}

#[tokio::test]
async fn hidden_files_and_directories_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join(".cache")).unwrap();
    let (_watcher, mut rx) = start(dir.path());

    fs::write(dir.path().join(".hidden"), b"secret").unwrap();
    fs::remove_file(dir.path().join(".hidden")).unwrap();
    fs::write(dir.path().join(".cache").join("entry"), b"cached").unwrap();
    fs::create_dir_all(dir.path().join(".git").join("refs")).unwrap();
    fs::write(dir.path().join(".git").join("refs").join("main"), b"ref").unwrap();
    let visible = dir.path().join("visible.txt");
    fs::write(&visible, b"shown").unwrap();

    assert_eq!(next(&mut rx).await, add(visible, 5));
    assert_quiet(&mut rx, Duration::from_millis(300)).await;
}

#[tokio::test]
async fn growing_file_is_reported_once_with_final_size() {
    let dir = tempfile::tempdir().unwrap();
    let settle = Settle {
        interval: Duration::from_millis(200),
        max_polls: 40,
    };
    let (_watcher, mut rx) = Watcher::start_with(dir.path(), settle).unwrap();
    let path = dir.path().join("growing.bin");

    let mut file = fs::File::create(&path).unwrap();
    for _ in 0..5 {
        file.write_all(&[7; 1024]).unwrap();
        sleep(Duration::from_millis(20)).await;
    }
    drop(file);

    assert_eq!(next(&mut rx).await, add(path, 5 * 1024));
    assert_quiet(&mut rx, Duration::from_millis(600)).await;
}

#[tokio::test]
async fn dropping_watcher_closes_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let (watcher, mut rx) = start(dir.path());
    fs::write(dir.path().join("pending.txt"), b"x").unwrap();

    drop(watcher);
    let closed = timeout(TIMEOUT, async { while rx.recv().await.is_some() {} }).await;
    assert!(closed.is_ok(), "receiver stayed open after drop");
}

const TICK: Settle = Settle {
    interval: Duration::from_millis(1),
    max_polls: 40,
};

#[tokio::test]
async fn settle_waits_for_two_equal_readings() {
    let mut readings = [1, 2, 3, 3, 9].into_iter();
    assert_eq!(TICK.run(|| readings.next()).await, Some(3));
    assert_eq!(readings.next(), Some(9));
}

#[tokio::test]
async fn settle_returns_last_reading_after_max_polls() {
    let polls = Cell::new(0);
    let size = TICK
        .run(|| {
            polls.set(polls.get() + 1);
            Some(polls.get())
        })
        .await;
    assert_eq!((size, polls.get()), (Some(40), 40));
}

#[tokio::test]
async fn settle_aborts_when_file_vanishes() {
    let mut readings = [Some(1), None, Some(1)].into_iter();
    assert_eq!(TICK.run(|| readings.next().flatten()).await, None);
}

#[tokio::test]
async fn settling_file_is_tracked_once() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let mut state = Loop {
        root: PathBuf::from("/root"),
        settle: FAST,
        tx,
        settling: HashSet::new(),
        tasks: JoinSet::new(),
    };

    state.settle(PathBuf::from("/root/a"));
    state.settle(PathBuf::from("/root/a"));
    state.settle(PathBuf::from("/root/b"));
    assert_eq!(state.tasks.len(), 2);
}

#[test]
fn hidden_detection_covers_every_component_below_root() {
    let root = Path::new("/home/user/.drop");
    assert!(!is_hidden(root, &root.join("file.txt")));
    assert!(!is_hidden(root, &root.join("dir").join("file.txt")));
    assert!(is_hidden(root, &root.join(".file")));
    assert!(is_hidden(root, &root.join(".git").join("config")));
    assert!(is_hidden(root, &root.join("dir").join(".cache").join("x")));
}
