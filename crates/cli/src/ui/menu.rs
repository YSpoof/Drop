//! Mode menu (`Gerar um código`, `Possuo um código`, `Configurações`) and PIN input.

use crossterm::event::{KeyCode, KeyEvent};
use drop_core::signaling::normalize_code;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};

use super::{LineInput, Outcome, Screen, help_line, option_line, render_form, theme};
use crate::text;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuChoice {
    Host,
    /// A validated four-digit PIN.
    Join(String),
    Settings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Item {
    Host,
    Join,
    Settings,
}

const ITEMS: [(Item, &str); 3] = [
    (Item::Host, text::HOST_SESSION),
    (Item::Join, text::JOIN_SESSION),
    (Item::Settings, text::SETTINGS),
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum Stage {
    Choose,
    Pin {
        input: LineInput,
        error: Option<&'static str>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Menu {
    cursor: usize,
    stage: Stage,
}

impl Default for Menu {
    fn default() -> Self {
        Self::new()
    }
}

impl Menu {
    pub fn new() -> Self {
        Self {
            cursor: 0,
            stage: Stage::Choose,
        }
    }

    fn choose(&mut self, key: KeyEvent) -> Outcome<MenuChoice> {
        match key.code {
            KeyCode::Up => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Down => self.cursor = (self.cursor + 1).min(ITEMS.len() - 1),
            KeyCode::Enter => match ITEMS[self.cursor].0 {
                Item::Host => return Outcome::Done(MenuChoice::Host),
                Item::Settings => return Outcome::Done(MenuChoice::Settings),
                Item::Join => {
                    self.stage = Stage::Pin {
                        input: LineInput::default(),
                        error: None,
                    }
                }
            },
            _ => {}
        }
        Outcome::Continue
    }
}

impl Screen for Menu {
    type Output = MenuChoice;

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<MenuChoice> {
        let Stage::Pin { input, error } = &mut self.stage else {
            return self.choose(key);
        };
        match key.code {
            KeyCode::Enter => match normalize_code(input.value()) {
                Some(pin) => return Outcome::Done(MenuChoice::Join(pin.to_string())),
                None => *error = Some(text::ERR_PIN_DIGITS),
            },
            KeyCode::Esc => self.stage = Stage::Choose,
            _ if input.handle_key(&key) => *error = None,
            _ => {}
        }
        Outcome::Continue
    }

    fn render(&self, frame: &mut Frame, area: Rect) {
        match &self.stage {
            Stage::Choose => render_form(frame, area, text::MODE_PROMPT, |width| {
                let mut lines: Vec<Line> = ITEMS
                    .iter()
                    .enumerate()
                    .map(|(i, (_, label))| option_line(label, i == self.cursor))
                    .collect();
                lines.extend([Line::default(), help_line(text::MENU_HELP, width)]);
                lines
            }),
            Stage::Pin { input, error } => render_form(frame, area, text::ENTER_PIN, |width| {
                let mut field = input.line(true, width.saturating_sub(2));
                field
                    .spans
                    .insert(0, Span::styled(theme::CURSOR, theme::ACCENT));
                vec![
                    field,
                    Line::styled(error.unwrap_or_default(), theme::ERR),
                    help_line(text::PIN_HELP, width),
                ]
            }),
        }
    }
}

#[cfg(test)]
#[path = "menu_tests.rs"]
mod tests;
