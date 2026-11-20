use crossterm::event::KeyCode;
use tempfile::TempDir;

use super::*;
use crate::config::{DONATION_REMINDER_INTERVAL, Direction};
use crate::ui::testing::{key, render_text};

const NAME: usize = 0;
const DIR: usize = 1;
const COPY_PIX: usize = 2;
const RESET: usize = 3;
const SAVE: usize = 4;

fn store(tmp: &TempDir) -> Store {
    Store::load(tmp.path().join(".dropConfig"))
}

fn press(settings: &mut Settings, code: KeyCode) -> Outcome<()> {
    settings.handle_key(key(code))
}

fn focus(settings: &mut Settings, index: usize) {
    for _ in 0..FIELDS.len() {
        press(settings, KeyCode::Up);
    }
    for _ in 0..index {
        press(settings, KeyCode::Down);
    }
}

fn type_text(settings: &mut Settings, value: &str) {
    for c in value.chars() {
        press(settings, KeyCode::Char(c));
    }
}

fn clear(settings: &mut Settings) {
    for _ in 0..512 {
        press(settings, KeyCode::Backspace);
    }
}

fn view(settings: &Settings) -> String {
    render_text(80, 30, |frame| settings.render(frame, frame.area()))
}

fn with_stats(tmp: &TempDir) -> Store {
    let mut store = store(tmp);
    store.add_transfer(Direction::Upload, 100).unwrap();
    store.add_transfer(Direction::Download, 200).unwrap();
    store
}

#[test]
fn shows_current_values_stats_and_pix_without_auto_download() {
    let tmp = TempDir::new().unwrap();
    let mut store = with_stats(&tmp);
    store.set_device_name("laptop").unwrap();
    let settings = Settings::new(&mut store);
    let view = view(&settings);
    let (sent, received) = (
        text::stats_sent(1, "100 B"),
        text::stats_received(1, "200 B"),
    );
    let wants: [&str; 10] = [
        text::DISPLAY_NAME,
        "laptop",
        text::DOWNLOAD_DIR,
        text::DOWNLOAD_DIR_EMPTY,
        DONATION_PIX_KEY,
        text::DONATION_COPY_PIX,
        &sent,
        &received,
        text::RESET_TRANSFER_STATS,
        text::SAVE,
    ];
    for want in wants {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
    assert!(!view.to_lowercase().contains("auto"));
}

#[test]
fn save_writes_name_and_directory_then_returns() {
    let tmp = TempDir::new().unwrap();
    let downloads = tmp.path().join("downloads");
    std::fs::create_dir(&downloads).unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    type_text(&mut settings, "desk");
    focus(&mut settings, DIR);
    type_text(&mut settings, downloads.to_str().unwrap());
    focus(&mut settings, SAVE);
    assert_eq!(press(&mut settings, KeyCode::Enter), Outcome::Done(()));

    let reloaded = Store::load(tmp.path().join(".dropConfig"));
    assert_eq!(reloaded.config().device_name, "desk");
    assert_eq!(reloaded.config().download_dir, downloads.to_str().unwrap());
}

#[test]
fn empty_directory_clears_the_persisted_one() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    store.set_download_dir(Some(tmp.path())).unwrap();
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, DIR);
    clear(&mut settings);
    focus(&mut settings, SAVE);
    assert_eq!(press(&mut settings, KeyCode::Enter), Outcome::Done(()));
    assert_eq!(store.config().download_dir, "");
}

#[test]
fn missing_directory_is_rejected_and_not_saved() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, DIR);
    type_text(&mut settings, tmp.path().join("nope").to_str().unwrap());
    focus(&mut settings, SAVE);
    assert_eq!(press(&mut settings, KeyCode::Enter), Outcome::Continue);
    assert!(view(&settings).contains(text::ERR_DIR_MISSING));
    // Focus moved back to the folder: typing clears the error.
    press(&mut settings, KeyCode::Backspace);
    assert!(!view(&settings).contains(text::ERR_DIR_MISSING));
    drop(settings);
    assert_eq!(store.config().download_dir, "");
}

#[test]
fn file_path_is_rejected_as_not_a_directory() {
    let tmp = TempDir::new().unwrap();
    let file = tmp.path().join("file.txt");
    std::fs::write(&file, "x").unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, DIR);
    type_text(&mut settings, file.to_str().unwrap());
    focus(&mut settings, SAVE);
    assert_eq!(press(&mut settings, KeyCode::Enter), Outcome::Continue);
    assert!(view(&settings).contains(text::ERR_PATH_NOT_DIR));
}

#[test]
fn esc_returns_without_saving() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    type_text(&mut settings, "changed");
    assert_eq!(press(&mut settings, KeyCode::Esc), Outcome::Done(()));
    assert_eq!(store.config().device_name, "");
}

#[test]
fn reset_needs_confirmation() {
    let tmp = TempDir::new().unwrap();
    let mut store = with_stats(&tmp);
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, RESET);
    press(&mut settings, KeyCode::Enter);
    assert!(view(&settings).contains(text::RESET_STATS_CONFIRM));
    assert_eq!(settings.store.config().transfer_stats.upload_files, 1);

    press(&mut settings, KeyCode::Enter);
    assert!(view(&settings).contains(text::STATS_RESET_DONE));
    drop(settings);
    let reloaded = Store::load(tmp.path().join(".dropConfig"));
    assert_eq!(reloaded.config().transfer_stats, Default::default());
}

#[test]
fn esc_or_moving_away_cancels_a_pending_reset() {
    let tmp = TempDir::new().unwrap();
    let mut store = with_stats(&tmp);
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, RESET);
    press(&mut settings, KeyCode::Enter);
    assert_eq!(press(&mut settings, KeyCode::Esc), Outcome::Continue);
    assert!(!view(&settings).contains(text::RESET_STATS_CONFIRM));

    press(&mut settings, KeyCode::Enter);
    press(&mut settings, KeyCode::Down);
    press(&mut settings, KeyCode::Up);
    press(&mut settings, KeyCode::Enter);
    assert_eq!(settings.store.config().transfer_stats.upload_files, 1);
}

#[test]
fn pix_copy_requests_the_key_and_shows_feedback() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, COPY_PIX);
    let request = CopyRequest {
        kind: CopyKind::Pix,
        content: DONATION_PIX_KEY.into(),
    };
    assert_eq!(press(&mut settings, KeyCode::Enter), Outcome::Copy(request));

    settings.on_copied(CopyKind::Pix, Err(io::Error::other("boom")));
    let failed = view(&settings);
    assert!(failed.contains(&text::copy_pix_failed("boom")));
    assert!(!failed.contains(text::PIX_COPIED));

    settings.on_copied(CopyKind::Pix, Ok(()));
    assert!(view(&settings).contains(text::PIX_COPIED));
}

#[test]
fn pix_copy_does_not_dismiss_a_due_reminder() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    for _ in 0..DONATION_REMINDER_INTERVAL {
        store.record_visit().unwrap();
    }
    assert!(store.donation_due());
    let mut settings = Settings::new(&mut store);
    focus(&mut settings, COPY_PIX);
    press(&mut settings, KeyCode::Enter);
    settings.on_copied(CopyKind::Pix, Ok(()));
    drop(settings);
    assert!(store.donation_due());
}

#[test]
fn enter_on_text_fields_moves_to_the_next_field() {
    let tmp = TempDir::new().unwrap();
    let mut store = store(&tmp);
    let mut settings = Settings::new(&mut store);
    assert_eq!(settings.focus, NAME);
    press(&mut settings, KeyCode::Enter);
    press(&mut settings, KeyCode::Enter);
    assert_eq!(settings.focus, COPY_PIX);
}
