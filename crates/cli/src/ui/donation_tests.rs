use crossterm::event::KeyCode;
use tempfile::TempDir;

use super::*;
use crate::config::DONATION_REMINDER_INTERVAL;
use crate::ui::testing::{key, render_text};

fn due_store(tmp: &TempDir) -> Store {
    let mut store = Store::load(tmp.path().join(".dropConfig"));
    for _ in 0..DONATION_REMINDER_INTERVAL {
        store.record_visit().unwrap();
    }
    assert!(store.donation_due());
    store
}

fn view(donation: &Donation) -> String {
    render_text(80, 16, |frame| donation.render(frame, frame.area()))
}

#[test]
fn not_shown_when_not_due() {
    let tmp = TempDir::new().unwrap();
    let mut store = Store::load(tmp.path().join(".dropConfig"));
    assert!(Donation::when_due(&mut store).is_none());
}

#[test]
fn shows_title_body_key_and_actions() {
    let tmp = TempDir::new().unwrap();
    let mut store = due_store(&tmp);
    let donation = Donation::when_due(&mut store).unwrap();
    let view = view(&donation);
    for want in [
        text::DONATION_TITLE,
        text::DONATION_BODY,
        DONATION_PIX_KEY,
        text::DONATION_COPY_PIX,
        text::DONATION_CLOSE,
    ] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
}

#[test]
fn copy_keeps_the_prompt_open_and_the_reminder_due() {
    let tmp = TempDir::new().unwrap();
    let mut store = due_store(&tmp);
    let mut donation = Donation::when_due(&mut store).unwrap();
    let request = CopyRequest {
        kind: CopyKind::Pix,
        content: DONATION_PIX_KEY.into(),
    };
    assert!(matches!(donation.handle_key(key(KeyCode::Enter)), Outcome::Copy(r) if r == request));
    donation.on_copied(CopyKind::Pix, Ok(()));
    assert!(view(&donation).contains(text::PIX_COPIED));
    drop(donation);
    assert!(store.donation_due());
    assert!(Store::load(tmp.path().join(".dropConfig")).donation_due());
}

#[test]
fn failed_copy_stays_open_without_success() {
    let tmp = TempDir::new().unwrap();
    let mut store = due_store(&tmp);
    let mut donation = Donation::when_due(&mut store).unwrap();
    donation.handle_key(key(KeyCode::Enter));
    donation.on_copied(CopyKind::Pix, Err(io::Error::other("sem área")));
    let view = view(&donation);
    assert!(view.contains(&text::copy_pix_failed("sem área")));
    assert!(!view.contains(text::PIX_COPIED));
    drop(donation);
    assert!(store.donation_due());
}

#[test]
fn close_dismisses_the_reminder() {
    let tmp = TempDir::new().unwrap();
    let mut store = due_store(&tmp);
    let mut donation = Donation::when_due(&mut store).unwrap();
    assert!(matches!(
        donation.handle_key(key(KeyCode::Right)),
        Outcome::Continue
    ));
    let Outcome::Done(result) = donation.handle_key(key(KeyCode::Enter)) else {
        panic!("Fechar must finish the prompt");
    };
    result.unwrap();
    assert!(!store.donation_due());
    assert!(!Store::load(tmp.path().join(".dropConfig")).donation_due());
}

#[test]
fn other_keys_do_not_dismiss() {
    let tmp = TempDir::new().unwrap();
    let mut store = due_store(&tmp);
    let mut donation = Donation::when_due(&mut store).unwrap();
    for code in [KeyCode::Esc, KeyCode::Char('q'), KeyCode::Char(' ')] {
        assert!(matches!(donation.handle_key(key(code)), Outcome::Continue));
    }
    drop(donation);
    assert!(store.donation_due());
}
