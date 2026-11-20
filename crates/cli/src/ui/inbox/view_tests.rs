use std::time::Duration;

use crossterm::event::KeyCode;

use super::super::tests::{Fixture, nested, offer};
use super::*;
use crate::state::{SessionState, Transfer};
use crate::ui::Screen;

fn many(n: usize) -> SessionState {
    SessionState {
        host: true,
        pin: Some("4242".into()),
        phase: Phase::Connected,
        offers: (0..n)
            .map(|i| offer(&format!("id-{i}"), &format!("file-{i:02}.bin"), 100))
            .collect(),
        ..SessionState::default()
    }
}

fn transfer(status: TransferStatus, bytes: u64, size: u64) -> Transfer {
    let mut t = Transfer::new("t1", "big.iso", size, "h", Direction::Download);
    t.status = status;
    t.bytes = bytes;
    t
}

fn plain(lines: &[Line]) -> String {
    lines
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn a_folder_shows_dotdot_folders_with_slash_and_files() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Enter);
    let view = f.render(80, 24);
    for want in ["..", "nested/", "a.jpg"] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
}

#[test]
fn folder_marks_follow_descendant_selection() {
    let mut f = Fixture::new(nested());
    f.inbox.selected.insert("b".into());
    let view = f.render(80, 24);
    assert!(view.contains("[-] photos/"), "{view}");
    f.inbox.selected.insert("a".into());
    assert!(f.render(80, 24).contains("[x] photos/"));

    f.inbox.selected = ["b".to_string()].into();
    f.press(KeyCode::Enter);
    let view = f.render(80, 24);
    assert!(view.contains("[x] nested/"), "{view}");
    assert!(view.contains("[ ] a.jpg"), "{view}");

    f.state
        .send_modify(|s| s.offers.push(offer("d", "photos/nested/c.jpg", 3)));
    f.inbox.tick();
    assert!(f.render(80, 24).contains("[-] nested/"));
}

#[test]
fn many_offers_fit_the_height_with_header_and_footer() {
    let f = Fixture::new(many(40));
    let view = f.render(60, 20);
    assert_eq!(view.lines().count(), 20);
    for want in [
        text::INBOX_TITLE,
        "4242",
        "f buscar",
        &text::scroll_hint(1, 6, 40),
    ] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
}

#[test]
fn scrolling_keeps_the_cursor_visible() {
    let mut f = Fixture::new(many(30));
    for _ in 0..20 {
        f.press(KeyCode::Down);
        f.render(80, 16);
    }
    let view = f.render(80, 16);
    assert!(view.contains("> [ ] file-20.bin"), "{view}");
    assert!(!view.contains("file-00.bin"), "{view}");
    assert!(view.contains(" / 30"), "{view}");
    for _ in 0..20 {
        f.press(KeyCode::Up);
    }
    assert!(f.render(80, 16).contains("> [ ] file-00.bin"));
}

#[test]
fn tiny_terminals_keep_the_footer() {
    let f = Fixture::new(many(40));
    let view = f.render(40, 8);
    assert!(view.contains("↑/↓"), "{view}");
}

#[test]
fn long_names_are_cut_with_an_ellipsis() {
    let f = Fixture::new(SessionState {
        offers: vec![offer("1", &"x".repeat(200), 1)],
        ..SessionState::default()
    });
    let view = f.render(50, 20);
    assert!(view.contains('…'), "{view}");
}

#[test]
fn empty_states() {
    let f = Fixture::new(SessionState::default());
    let view = f.render(80, 24);
    assert!(view.contains(text::PENDING_NONE), "{view}");
    assert!(view.contains(text::TRANSFERS_NONE), "{view}");
    assert!(!view.contains("(nenhuma"));
}

#[test]
fn transfers_show_in_the_panel() {
    let f = Fixture::new(SessionState {
        transfers: vec![transfer(TransferStatus::Active, 500, 1000)],
        ..SessionState::default()
    });
    let view = f.render(80, 24);
    assert!(view.contains("↓ big.iso"), "{view}");
    assert!(view.contains("50%"), "{view}");
    assert!(!view.contains(text::TRANSFERS_NONE));
}

#[test]
fn pending_transfers_are_not_listed() {
    let f = Fixture::new(SessionState {
        transfers: vec![transfer(TransferStatus::Pending, 0, 10)],
        ..SessionState::default()
    });
    assert!(f.render(80, 24).contains(text::TRANSFERS_NONE));
}

#[test]
fn active_row_has_progress_speed_and_eta() {
    let lines = transfer_lines(&transfer(TransferStatus::Active, 250, 1000), 100.0, 60);
    let text = plain(&lines);
    assert_eq!(lines.len(), 2);
    for want in ["● ↓ big.iso", "25%", "250 B/1000 B", "100 B/s", "ETA 7s"] {
        assert!(text.contains(want), "missing {want:?} in {text}");
    }
}

#[test]
fn failed_row_is_distinct_and_shows_the_reason() {
    let mut t = transfer(TransferStatus::Failed, 0, 10);
    t.direction = Direction::Upload;
    t.reason = Some(text::PEER_LOST.into());
    let lines = transfer_lines(&t, 0.0, 60);
    assert_eq!(plain(&lines), format!("✗ ↑ big.iso\n{}", text::PEER_LOST));
    assert_eq!(lines[0].style, theme::ERR);
}

#[test]
fn completed_row_is_full() {
    let lines = transfer_lines(&transfer(TransferStatus::Completed, 10, 10), 0.0, 60);
    assert!(plain(&lines).contains("✓ ↓ big.iso"));
    assert!(plain(&lines).contains("100%"));
}

#[test]
fn eta_formats() {
    assert_eq!(eta(0, 10.0), None);
    assert_eq!(eta(10, 0.0), None);
    assert_eq!(eta(1, 10.0).as_deref(), Some("<1s"));
    assert_eq!(eta(45, 1.0).as_deref(), Some("45s"));
    assert_eq!(eta(125, 1.0).as_deref(), Some("2m05s"));
    assert_eq!(eta(3 * 3600 + 7 * 60, 1.0).as_deref(), Some("3h07m"));
}

#[test]
fn rates_sample_once_a_second() {
    let start = Instant::now();
    let mut t = transfer(TransferStatus::Active, 0, 10_000);
    let mut rates = Rates::default();
    rates.sample(std::slice::from_ref(&t), start);
    t.bytes = 1000;
    rates.sample(std::slice::from_ref(&t), start + Duration::from_millis(500));
    assert_eq!(rates.speed("t1"), 0.0);
    rates.sample(std::slice::from_ref(&t), start + Duration::from_secs(1));
    assert_eq!(rates.speed("t1"), 1000.0);
    t.status = TransferStatus::Completed;
    rates.sample(&[t], start + Duration::from_secs(2));
    assert_eq!(rates.speed("t1"), 0.0);
}

#[test]
fn window_keeps_the_cursor_inside() {
    assert_eq!(window(0, 0, 5, 30), 0);
    assert_eq!(window(7, 0, 5, 30), 3);
    assert_eq!(window(4, 3, 5, 30), 3);
    assert_eq!(window(2, 3, 5, 30), 2);
    assert_eq!(window(29, 0, 5, 30), 25);
    assert_eq!(window(0, 9, 5, 3), 0);
}

#[test]
fn help_wraps_by_hint_group() {
    let lines = wrap("a one  b two  c three", 14);
    assert_eq!(lines, ["a one  b two", "c three"]);
    assert_eq!(wrap("toolong", 4), ["too…"]);
}
