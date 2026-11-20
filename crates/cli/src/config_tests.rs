use std::path::{Path, PathBuf};

use serde_json::Value;

use super::*;

/// A temp dir with the config path inside it (the file is not created).
fn temp_store() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join(".dropConfig");
    (tmp, path)
}

fn seed(path: &Path, config: &Config) {
    std::fs::write(path, serde_json::to_vec(config).unwrap()).unwrap();
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn donation_constants() {
    assert_eq!(DONATION_REMINDER_INTERVAL, 25);
    assert_eq!(DONATION_PIX_KEY, "cee3846a-a1ab-4e81-83ac-c5edb016fd71");
}

#[test]
fn missing_file_yields_defaults_and_no_backup() {
    let (_tmp, path) = temp_store();
    let mut store = Store::load(&path);
    assert_eq!(store.config(), &Config::default());
    assert!(!path.exists());

    store.record_visit().unwrap();
    assert!(path.exists());
    assert!(!sibling(&path, ".bak").exists());
    assert_eq!(std::fs::read_dir(_tmp.path()).unwrap().count(), 1, "no temp file left");
}

#[test]
fn concurrent_stores_keep_each_others_changes() {
    let (_tmp, path) = temp_store();
    let mut host = Store::load(&path);
    let mut joiner = Store::load(&path);

    joiner.add_transfer(Direction::Download, 10).unwrap();
    host.add_transfer(Direction::Upload, 7).unwrap();

    let stats = Store::load(&path).config().transfer_stats;
    assert_eq!((stats.download_bytes, stats.download_files), (10, 1));
    assert_eq!((stats.upload_bytes, stats.upload_files), (7, 1));
}

#[test]
fn round_trip_keeps_json_shape() {
    let (tmp, path) = temp_store();
    let dir = tmp.path().join("test");
    let mut store = Store::load(&path);
    store.set_device_name("test-device").unwrap();
    store.set_download_dir(Some(&dir)).unwrap();
    store.add_transfer(Direction::Upload, 1000).unwrap();
    store.add_transfer(Direction::Download, 2000).unwrap();
    store.record_visit().unwrap();

    let json = read_json(&path);
    let expected = serde_json::json!({
        "deviceName": "test-device",
        "downloadDir": dir.to_string_lossy(),
        "transferStats": {"uploadBytes": 1000, "downloadBytes": 2000, "uploadFiles": 1, "downloadFiles": 1},
        "visitCount": 1,
        "donationReminderAnchor": 0,
    });
    assert_eq!(json, expected);

    assert_eq!(Store::load(&path).config(), store.config());
}

#[test]
fn legacy_auto_download_is_ignored_and_dropped() {
    let (_tmp, path) = temp_store();
    std::fs::write(
        &path,
        r#"{"deviceName":"old","autoDownload":true,"visitCount":3}"#,
    )
    .unwrap();

    let mut store = Store::load(&path);
    assert_eq!(store.config().device_name, "old");
    assert_eq!(store.config().visit_count, 3);

    store.record_visit().unwrap();
    let json = read_json(&path);
    assert!(json.get("autoDownload").is_none());
    assert_eq!(json["visitCount"], 4);
    assert!(!sibling(&path, ".bak").exists());
}

#[test]
fn corrupt_file_is_backed_up_before_first_write() {
    let (_tmp, path) = temp_store();
    std::fs::write(&path, "{ invalid json").unwrap();

    let mut store = Store::load(&path);
    assert_eq!(store.config(), &Config::default());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ invalid json");
    assert!(!sibling(&path, ".bak").exists());

    store.record_visit().unwrap();
    assert_eq!(
        std::fs::read_to_string(sibling(&path, ".bak")).unwrap(),
        "{ invalid json"
    );
    assert_eq!(Store::load(&path).config().visit_count, 1);

    // The backup is taken once; later writes leave it alone.
    store.record_visit().unwrap();
    assert_eq!(
        std::fs::read_to_string(sibling(&path, ".bak")).unwrap(),
        "{ invalid json"
    );
}

#[test]
fn settings_save_preserves_visits_and_stats() {
    let (_tmp, path) = temp_store();
    let mut seeded = Config {
        device_name: "dev".into(),
        visit_count: 10,
        donation_reminder_anchor: 5,
        ..Config::default()
    };
    seeded.transfer_stats.upload_bytes = 7;
    seed(&path, &seeded);

    let mut store = Store::load(&path);
    store.set_device_name("renamed").unwrap();

    let loaded = Store::load(&path);
    assert_eq!(
        loaded.config(),
        &Config {
            device_name: "renamed".into(),
            ..seeded
        }
    );
}

#[test]
fn stats_add_persist_and_reset() {
    let (_tmp, path) = temp_store();
    seed(
        &path,
        &Config {
            visit_count: 12,
            ..Config::default()
        },
    );

    let mut store = Store::load(&path);
    store.add_transfer(Direction::Download, 300).unwrap();
    store.add_transfer(Direction::Download, 200).unwrap();
    store.add_transfer(Direction::Upload, 42).unwrap();

    let loaded = Store::load(&path);
    let expected = TransferStats {
        upload_bytes: 42,
        download_bytes: 500,
        upload_files: 1,
        download_files: 2,
    };
    assert_eq!(loaded.config().transfer_stats, expected);
    assert_eq!(loaded.config().visit_count, 12);

    store.reset_stats().unwrap();
    assert_eq!(
        Store::load(&path).config().transfer_stats,
        TransferStats::default()
    );
    assert_eq!(Store::load(&path).config().visit_count, 12);
}

#[test]
fn reminder_first_due_at_25() {
    let (_tmp, path) = temp_store();
    let mut store = Store::load(&path);
    for visit in 1..=24 {
        store.record_visit().unwrap();
        assert!(!store.donation_due(), "due at visit {visit}");
    }
    store.record_visit().unwrap();
    assert!(store.donation_due());
    assert_eq!(Store::load(&path).config().visit_count, 25);
}

#[test]
fn reminder_stays_due_without_moving_anchor() {
    let (_tmp, path) = temp_store();
    seed(
        &path,
        &Config {
            visit_count: 24,
            ..Config::default()
        },
    );
    let mut store = Store::load(&path);

    store.record_visit().unwrap();
    assert!(store.donation_due());
    store.record_visit().unwrap();
    assert!(store.donation_due());

    let loaded = Store::load(&path);
    assert_eq!(loaded.config().visit_count, 26);
    assert_eq!(loaded.config().donation_reminder_anchor, 0);
}

#[test]
fn dismiss_starts_next_interval() {
    let (_tmp, path) = temp_store();
    seed(
        &path,
        &Config {
            visit_count: 25,
            ..Config::default()
        },
    );
    let mut store = Store::load(&path);

    store.dismiss_donation().unwrap();
    assert!(!store.donation_due());
    assert_eq!(Store::load(&path).config().donation_reminder_anchor, 25);

    for visit in 26..=49 {
        store.record_visit().unwrap();
        assert!(!store.donation_due(), "due at visit {visit}");
    }
    store.record_visit().unwrap();
    assert!(store.donation_due());
}

#[test]
fn visits_survive_reload() {
    let (_tmp, path) = temp_store();
    let mut store = Store::load(&path);
    store.record_visit().unwrap();
    store.record_visit().unwrap();
    assert_eq!(Store::load(&path).config().visit_count, 2);
}

#[test]
fn out_is_run_scoped() {
    let (tmp, path) = temp_store();
    let out = tmp.path().join("a");
    let mut store = Store::load(&path);
    store.record_visit().unwrap();

    assert_eq!(store.download_dir(Some(&out)), out);
    assert_eq!(Store::load(&path).config().download_dir, "");
    assert_eq!(
        Store::load(&path).download_dir(None),
        std::env::current_dir().unwrap()
    );
}

#[test]
fn out_is_made_absolute() {
    let (_tmp, path) = temp_store();
    let store = Store::load(&path);
    let expected = std::env::current_dir().unwrap().join("rel");
    assert_eq!(store.download_dir(Some(Path::new("rel"))), expected);
}

#[test]
fn default_is_current_dir_and_not_pinned() {
    let (_tmp, path) = temp_store();
    let mut store = Store::load(&path);
    assert_eq!(store.download_dir(None), std::env::current_dir().unwrap());

    store.record_visit().unwrap();
    store.add_transfer(Direction::Download, 1).unwrap();
    assert_eq!(read_json(&path)["downloadDir"], "");
}

#[test]
fn persisted_dir_used_until_cleared() {
    let (tmp, path) = temp_store();
    let chosen = tmp.path().join("chosen");
    let mut store = Store::load(&path);
    store.set_download_dir(Some(&chosen)).unwrap();

    let reloaded = Store::load(&path);
    assert_eq!(reloaded.download_dir(None), chosen);
    let out = tmp.path().join("out");
    assert_eq!(reloaded.download_dir(Some(&out)), out);

    store.set_download_dir(None).unwrap();
    assert_eq!(
        Store::load(&path).download_dir(None),
        std::env::current_dir().unwrap()
    );
}
