use crossterm::event::KeyCode;

use super::super::tests::{Fixture, nested, offer};
use super::*;
use crate::state::{Phase, SessionState};
use crate::text;
use crate::ui::Outcome;
use crate::ui::Screen;
use crate::ui::testing::shift;

fn mixed() -> SessionState {
    SessionState {
        phase: Phase::Connected,
        offers: vec![
            offer("1", "Ubuntu-24.04.iso", 100),
            offer("2", "notes.txt", 10),
            offer("3", "photos/nested/b.jpg", 20),
        ],
        ..SessionState::default()
    }
}

fn names(rows: &[Row]) -> Vec<&str> {
    rows.iter().map(tree::name).collect()
}

#[test]
fn f_opens_search_with_its_footer() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    assert!(f.inbox.search.is_some());
    let view = f.render(100, 30);
    assert!(view.contains(&text::search_prompt("")), "{view}");
    assert!(view.contains("enter confirmar"), "{view}");
    assert!(!view.contains("f buscar"), "{view}");
}

#[test]
fn query_matches_case_insensitively() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    f.typed("ubuntu");
    assert_eq!(names(&f.inbox.rows()), ["Ubuntu-24.04.iso"]);
}

#[test]
fn enter_focuses_the_hit_without_downloading() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    f.typed("notes");
    f.press(KeyCode::Enter);
    assert!(f.inbox.search.is_none());
    assert_eq!(
        f.inbox.current().as_ref().map(tree::name),
        Some("notes.txt")
    );
    assert!(f.sent().is_empty());
}

#[test]
fn esc_leaves_search_without_quitting() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    f.typed("z");
    assert_eq!(f.press(KeyCode::Esc), Outcome::Continue);
    assert!(f.inbox.search.is_none());
    assert_eq!(f.inbox.rows().len(), 3);
}

#[test]
fn action_letters_go_into_the_query() {
    let mut f = Fixture::new(SessionState {
        host: true,
        pin: Some("1234".into()),
        peer_id: "peer".into(),
        ..nested()
    });
    f.press(KeyCode::Char('f'));
    f.typed("readme x");
    for c in ['a', 'c', 'd', 'q', 'r', ' '] {
        assert_eq!(f.press(KeyCode::Char(c)), Outcome::Continue);
    }
    assert_eq!(f.inbox.handle_key(shift('C')), Outcome::Continue);
    let query = f.inbox.search.as_ref().unwrap().value().to_string();
    assert_eq!(query, "readme xacdqr C");
    assert!(f.sent().is_empty());
    assert!(f.inbox.selected.is_empty());
    assert!(f.inbox.status.is_empty());
}

#[test]
fn typing_readme_x_triggers_nothing() {
    let mut f = Fixture::new(nested());
    f.press(KeyCode::Char('f'));
    f.typed("readme x");
    assert_eq!(f.inbox.search.as_ref().unwrap().value(), "readme x");
    assert!(f.sent().is_empty());
    f.press(KeyCode::Backspace);
    f.press(KeyCode::Backspace);
    assert_eq!(names(&f.inbox.rows()), ["readme.txt"]);
    // Out of search the same key acts again.
    f.press(KeyCode::Enter);
    f.press(KeyCode::Char('x'));
    assert_eq!(f.sent().len(), 1);
}

#[test]
fn arrows_move_through_hits() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    f.typed("ot");
    assert_eq!(names(&f.inbox.rows()), ["photos", "notes.txt"]);
    f.press(KeyCode::Down);
    assert_eq!(f.inbox.cursor, 1);
    f.press(KeyCode::Down);
    assert_eq!(f.inbox.cursor, 1);
    f.press(KeyCode::Up);
    assert_eq!(f.inbox.cursor, 0);
}

#[test]
fn deep_hits_carry_a_path_hint_and_enter_opens_their_folder() {
    let mut f = Fixture::new(mixed());
    f.press(KeyCode::Char('f'));
    f.typed("b.jpg");
    let rows = f.inbox.rows();
    assert_eq!(
        rows,
        [Row::File {
            name: "b.jpg".into(),
            id: "3".into(),
            size: 20,
            path: Some("photos/nested/b.jpg".into()),
        }]
    );
    assert!(f.render(100, 30).contains("(photos/nested/b.jpg)"));
    f.press(KeyCode::Enter);
    assert_eq!(f.inbox.cwd, ["photos", "nested"]);
    assert_eq!(f.inbox.current().as_ref().map(tree::name), Some("b.jpg"));
}

#[test]
fn local_hits_win_over_deep_ones() {
    let offers = [offer("1", "b/x.txt", 1), offer("2", "a/b/y.txt", 1)];
    assert_eq!(names(&hits(&offers, &[], "b")), ["b"]);
    assert_eq!(names(&hits(&offers, &[], "y.t")), ["y.txt"]);
}
