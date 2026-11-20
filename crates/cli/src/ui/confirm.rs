//! Full-viewport Ctrl+C confirm-to-exit overlay.
//!
//! Hidden: Ctrl+C shows it. Visible: Ctrl+C confirms exit, Esc dismisses; other keys are
//! swallowed. Either result hides it again, so it re-arms for the next Ctrl+C.

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::text::Line;
use ratatui::widgets::{Clear, Paragraph};

use super::{format, is_interrupt, theme};
use crate::text;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmResult {
    /// Esc: keep going.
    Dismiss,
    /// Second Ctrl+C: leave.
    Exit,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Confirm {
    visible: bool,
}

impl Confirm {
    /// Already showing (the first Ctrl+C was consumed elsewhere).
    pub fn shown() -> Self {
        Self { visible: true }
    }

    pub fn visible(&self) -> bool {
        self.visible
    }

    pub fn hide(&mut self) {
        self.visible = false;
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> Option<ConfirmResult> {
        let result = match (self.visible, is_interrupt(&key), key.code) {
            (false, true, _) => {
                self.visible = true;
                return None;
            }
            (true, true, _) => ConfirmResult::Exit,
            (true, false, KeyCode::Esc) => ConfirmResult::Dismiss,
            _ => return None,
        };
        self.visible = false;
        Some(result)
    }

    /// Clears the whole viewport and centers the pt-BR copy. Draws nothing while hidden.
    pub fn render(&self, frame: &mut Frame, area: Rect) {
        if !self.visible {
            return;
        }
        let width = usize::from(area.width);
        let lines = vec![
            Line::styled(
                format::truncate(text::CONFIRM_EXIT_TITLE, width),
                theme::CONFIRM_TITLE,
            ),
            Line::default(),
            Line::styled(
                format::truncate(text::CONFIRM_EXIT_HINT, width),
                theme::CONFIRM_HINT,
            ),
            Line::styled(
                format::truncate(text::CONFIRM_CONTINUE_HINT, width),
                theme::CONFIRM_HINT,
            ),
        ];
        let body = area.centered_vertically(Constraint::Length(lines.len() as u16));
        frame.render_widget(Clear, area);
        frame.render_widget(Paragraph::new(lines).centered(), body);
    }
}

#[cfg(test)]
#[path = "confirm_tests.rs"]
mod tests;
