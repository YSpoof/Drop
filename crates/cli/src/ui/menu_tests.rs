use crossterm::event::KeyCode;

use super::*;
use crate::ui::confirm::Confirm;
use crate::ui::testing::{ctrl_c, key, render_text};
use crate::ui::{Exit, Step, dispatch};

fn press(menu: &mut Menu, code: KeyCode) -> Outcome<MenuChoice> {
    menu.handle_key(key(code))
}

fn type_text(menu: &mut Menu, value: &str) {
    for c in value.chars() {
        assert_eq!(press(menu, KeyCode::Char(c)), Outcome::Continue);
    }
}

fn pin_menu() -> Menu {
    let mut menu = Menu::new();
    press(&mut menu, KeyCode::Down);
    assert_eq!(press(&mut menu, KeyCode::Enter), Outcome::Continue);
    menu
}

fn view(menu: &Menu) -> String {
    render_text(80, 12, |frame| menu.render(frame, frame.area()))
}

#[test]
fn options_are_listed_in_order() {
    let view = view(&Menu::new());
    let positions: Vec<usize> = [text::HOST_SESSION, text::JOIN_SESSION, text::SETTINGS]
        .iter()
        .map(|label| view.find(label).expect(label))
        .collect();
    assert!(positions.is_sorted(), "{view}");
    assert!(view.contains(text::MODE_PROMPT));
}

#[test]
fn enter_on_first_option_hosts() {
    assert_eq!(
        press(&mut Menu::new(), KeyCode::Enter),
        Outcome::Done(MenuChoice::Host)
    );
}

#[test]
fn enter_on_third_option_opens_settings() {
    let mut menu = Menu::new();
    for _ in 0..5 {
        press(&mut menu, KeyCode::Down);
    }
    assert_eq!(
        press(&mut menu, KeyCode::Enter),
        Outcome::Done(MenuChoice::Settings)
    );
}

#[test]
fn up_stops_at_the_first_option() {
    let mut menu = Menu::new();
    press(&mut menu, KeyCode::Up);
    assert_eq!(
        press(&mut menu, KeyCode::Enter),
        Outcome::Done(MenuChoice::Host)
    );
}

#[test]
fn join_asks_for_pin() {
    let menu = pin_menu();
    assert!(view(&menu).contains(text::ENTER_PIN));
}

#[test]
fn valid_pins_are_accepted() {
    for pin in ["0000", "1234", "9999", "0123"] {
        let mut menu = pin_menu();
        type_text(&mut menu, pin);
        assert_eq!(
            press(&mut menu, KeyCode::Enter),
            Outcome::Done(MenuChoice::Join(pin.into()))
        );
    }
}

#[test]
fn invalid_pins_show_error_and_stay() {
    for pin in ["", "123", "12345", "abcd", "12 34", "12-34", "123a"] {
        let mut menu = pin_menu();
        type_text(&mut menu, pin);
        assert_eq!(
            press(&mut menu, KeyCode::Enter),
            Outcome::Continue,
            "{pin:?}"
        );
        assert!(view(&menu).contains(text::ERR_PIN_DIGITS), "{pin:?}");
    }
}

#[test]
fn editing_clears_error_and_backspace_fixes_input() {
    let mut menu = pin_menu();
    type_text(&mut menu, "12345");
    press(&mut menu, KeyCode::Enter);
    press(&mut menu, KeyCode::Backspace);
    assert!(!view(&menu).contains(text::ERR_PIN_DIGITS));
    assert_eq!(
        press(&mut menu, KeyCode::Enter),
        Outcome::Done(MenuChoice::Join("1234".into()))
    );
}

#[test]
fn esc_returns_to_options_and_discards_pin() {
    let mut menu = pin_menu();
    type_text(&mut menu, "12");
    press(&mut menu, KeyCode::Esc);
    assert!(view(&menu).contains(text::MODE_PROMPT));
    // The cursor stays on `Possuo um código`; the PIN input reopens empty.
    assert_eq!(press(&mut menu, KeyCode::Enter), Outcome::Continue);
    type_text(&mut menu, "5678");
    assert_eq!(
        press(&mut menu, KeyCode::Enter),
        Outcome::Done(MenuChoice::Join("5678".into()))
    );
}

#[test]
fn ctrl_c_cancels_at_once() {
    let mut menu = pin_menu();
    let mut confirm = Confirm::default();
    assert_eq!(
        dispatch(&mut menu, &mut confirm, ctrl_c()),
        Step::Exit(Exit::Cancelled)
    );
    assert!(!confirm.visible());
}
