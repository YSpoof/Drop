//! Donation reminder shown before the mode menu when due.
//! `Copiar chave PIX` keeps it open and the reminder due; `Fechar` dismisses it.

use std::io;

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};

use super::format::truncate;
use super::{CopyKind, CopyRequest, Feedback, Outcome, Screen, help_line, render_form, theme};
use crate::config::{DONATION_PIX_KEY, Store};
use crate::text;

const BUTTONS: [&str; 2] = [text::DONATION_COPY_PIX, text::DONATION_CLOSE];
const COPY: usize = 0;
const CLOSE: usize = 1;

pub struct Donation<'a> {
    store: &'a mut Store,
    focus: usize,
    feedback: Option<Feedback>,
}

impl<'a> Donation<'a> {
    /// The reminder, only when it is due.
    pub fn when_due(store: &'a mut Store) -> Option<Self> {
        let due = store.donation_due();
        due.then_some(Self {
            store,
            focus: COPY,
            feedback: None,
        })
    }
}

impl Screen for Donation<'_> {
    /// `Fechar` was chosen; `Err` when saving the dismissal failed.
    type Output = io::Result<()>;

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<Self::Output> {
        match (key.code, self.focus) {
            (KeyCode::Left | KeyCode::Up | KeyCode::BackTab, _) => self.focus = COPY,
            (KeyCode::Right | KeyCode::Down | KeyCode::Tab, _) => self.focus = CLOSE,
            (KeyCode::Enter, COPY) => {
                return Outcome::Copy(CopyRequest {
                    kind: CopyKind::Pix,
                    content: DONATION_PIX_KEY.into(),
                });
            }
            (KeyCode::Enter, _) => return Outcome::Done(self.store.dismiss_donation()),
            _ => {}
        }
        Outcome::Continue
    }

    fn on_copied(&mut self, kind: CopyKind, result: io::Result<()>) {
        self.feedback = Some(Feedback::copied(kind, &result));
    }

    fn render(&self, frame: &mut Frame, area: Rect) {
        render_form(frame, area, text::DONATION_TITLE, |width| {
            let buttons: Vec<Span> = BUTTONS
                .iter()
                .enumerate()
                .flat_map(|(i, label)| {
                    let style = if i == self.focus {
                        theme::SELECTED.reversed()
                    } else {
                        theme::DIM
                    };
                    [Span::styled(format!(" {label} "), style), Span::raw("  ")]
                })
                .collect();
            let mut lines = vec![
                Line::raw(truncate(text::DONATION_BODY, width)),
                Line::default(),
                Line::styled(truncate(text::DONATION_PIX_HINT, width), theme::DIM),
                Line::styled(DONATION_PIX_KEY, theme::ACCENT),
                Line::default(),
                Line::from(buttons),
            ];
            if let Some(feedback) = &self.feedback {
                lines.push(feedback.line(width));
            }
            lines.extend([Line::default(), help_line(text::DONATION_HELP, width)]);
            lines
        });
    }
}

#[cfg(test)]
#[path = "donation_tests.rs"]
mod tests;
