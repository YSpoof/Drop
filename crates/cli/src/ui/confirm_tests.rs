use crossterm::event::KeyCode;

use super::*;
use crate::ui::testing::{ctrl_c, key, render_text};

#[test]
fn first_ctrl_c_shows_overlay_without_result() {
    let mut confirm = Confirm::default();
    assert_eq!(confirm.handle_key(ctrl_c()), None);
    assert!(confirm.visible());
}

#[test]
fn second_ctrl_c_confirms_exit() {
    let mut confirm = Confirm::shown();
    assert_eq!(confirm.handle_key(ctrl_c()), Some(ConfirmResult::Exit));
    assert!(!confirm.visible());
}

#[test]
fn esc_dismisses_and_rearms() {
    let mut confirm = Confirm::shown();
    assert_eq!(
        confirm.handle_key(key(KeyCode::Esc)),
        Some(ConfirmResult::Dismiss)
    );
    assert!(!confirm.visible());
    assert_eq!(confirm.handle_key(ctrl_c()), None);
    assert!(confirm.visible());
}

#[test]
fn esc_while_hidden_does_nothing() {
    let mut confirm = Confirm::default();
    assert_eq!(confirm.handle_key(key(KeyCode::Esc)), None);
    assert!(!confirm.visible());
}

#[test]
fn other_keys_are_swallowed_while_visible() {
    let mut confirm = Confirm::shown();
    for code in [KeyCode::Char('q'), KeyCode::Enter, KeyCode::Char('c')] {
        assert_eq!(confirm.handle_key(key(code)), None);
        assert!(confirm.visible());
    }
}

#[test]
fn view_contains_pt_br_copy() {
    let confirm = Confirm::shown();
    let view = render_text(80, 24, |frame| confirm.render(frame, frame.area()));
    for want in [
        text::CONFIRM_EXIT_TITLE,
        text::CONFIRM_EXIT_HINT,
        text::CONFIRM_CONTINUE_HINT,
    ] {
        assert!(view.contains(want), "missing {want:?} in:\n{view}");
    }
}

#[test]
fn hidden_overlay_draws_nothing() {
    let view = render_text(40, 6, |frame| {
        Confirm::default().render(frame, frame.area())
    });
    assert!(view.trim().is_empty());
}
