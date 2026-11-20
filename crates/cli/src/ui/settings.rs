//! `Configurações`: display name, download folder, PIX copy, transfer stats with a confirmed
//! reset. `Salvar` validates and writes through [`Store`]; Esc returns without saving.

use std::io;
use std::path::Path;

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};

use super::format::{format_bytes, truncate};
use super::{
    CopyKind, CopyRequest, Feedback, LineInput, Outcome, Screen, help_line, option_line,
    render_form, theme,
};
use crate::config::{DONATION_PIX_KEY, Store};
use crate::text;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Name,
    Dir,
    CopyPix,
    ResetStats,
    Save,
}

const FIELDS: [Field; 5] = [
    Field::Name,
    Field::Dir,
    Field::CopyPix,
    Field::ResetStats,
    Field::Save,
];
const INDENT: &str = "    ";

pub struct Settings<'a> {
    store: &'a mut Store,
    focus: usize,
    name: LineInput,
    dir: LineInput,
    dir_error: Option<&'static str>,
    confirm_reset: bool,
    feedback: Option<Feedback>,
}

impl<'a> Settings<'a> {
    pub fn new(store: &'a mut Store) -> Self {
        let config = store.config();
        Self {
            name: LineInput::new(config.device_name.clone()),
            dir: LineInput::new(config.download_dir.clone()),
            store,
            focus: 0,
            dir_error: None,
            confirm_reset: false,
            feedback: None,
        }
    }

    fn field(&self) -> Field {
        FIELDS[self.focus]
    }

    fn move_focus(&mut self, forward: bool) {
        self.focus = if forward {
            (self.focus + 1).min(FIELDS.len() - 1)
        } else {
            self.focus.saturating_sub(1)
        };
        self.confirm_reset = false;
    }

    /// First Enter arms the reset, the second one clears the totals.
    fn reset_stats(&mut self) {
        self.confirm_reset = !self.confirm_reset;
        if self.confirm_reset {
            return;
        }
        self.feedback = Some(match self.store.reset_stats() {
            Ok(()) => Feedback::ok(text::STATS_RESET_DONE),
            Err(err) => Feedback::err(text::err_reset_stats(err)),
        });
    }

    fn save(&mut self) -> Outcome<()> {
        let dir = match validate_dir(self.dir.value()) {
            Ok(dir) => dir,
            Err(error) => {
                self.dir_error = Some(error);
                self.focus = 1;
                return Outcome::Continue;
            }
        };
        let saved = self
            .store
            .set_device_name(self.name.value())
            .and_then(|()| self.store.set_download_dir(dir));
        match saved {
            Ok(()) => Outcome::Done(()),
            Err(err) => {
                self.feedback = Some(Feedback::err(text::err_save_settings(err)));
                Outcome::Continue
            }
        }
    }
}

/// An indented field value, or the dim empty-value hint when unfocused and empty.
fn value_line<'s>(input: &'s LineInput, focused: bool, empty: &'s str, width: usize) -> Line<'s> {
    let mut line = match (input.value().is_empty(), focused) {
        (true, false) => Line::styled(truncate(empty, width), theme::DIM),
        _ => input.line(focused, width),
    };
    line.spans.insert(0, Span::raw(INDENT));
    line
}

/// Empty clears the folder; anything else must be an existing directory.
fn validate_dir(value: &str) -> Result<Option<&Path>, &'static str> {
    if value.is_empty() {
        return Ok(None);
    }
    match std::fs::metadata(value) {
        Ok(meta) if meta.is_dir() => Ok(Some(Path::new(value))),
        Ok(_) => Err(text::ERR_PATH_NOT_DIR),
        Err(_) => Err(text::ERR_DIR_MISSING),
    }
}

impl Screen for Settings<'_> {
    type Output = ();

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<()> {
        match (key.code, self.field()) {
            (KeyCode::Esc, _) if self.confirm_reset => self.confirm_reset = false,
            (KeyCode::Esc, _) => return Outcome::Done(()),
            (KeyCode::Up | KeyCode::BackTab, _) => self.move_focus(false),
            (KeyCode::Down | KeyCode::Tab, _) | (KeyCode::Enter, Field::Name | Field::Dir) => {
                self.move_focus(true)
            }
            (KeyCode::Enter, Field::CopyPix) => {
                return Outcome::Copy(CopyRequest {
                    kind: CopyKind::Pix,
                    content: DONATION_PIX_KEY.into(),
                });
            }
            (KeyCode::Enter, Field::ResetStats) => self.reset_stats(),
            (KeyCode::Enter, Field::Save) => return self.save(),
            (_, Field::Name) => {
                self.name.handle_key(&key);
            }
            (_, Field::Dir) if self.dir.handle_key(&key) => self.dir_error = None,
            _ => {}
        }
        Outcome::Continue
    }

    fn on_copied(&mut self, kind: CopyKind, result: io::Result<()>) {
        self.feedback = Some(Feedback::copied(kind, &result));
    }

    fn render(&self, frame: &mut Frame, area: Rect) {
        render_form(frame, area, text::SETTINGS, |width| {
            let field = self.field();
            let value_width = width.saturating_sub(INDENT.len());
            let stats = self.store.config().transfer_stats;
            let mut lines = vec![
                option_line(text::DISPLAY_NAME, field == Field::Name),
                value_line(
                    &self.name,
                    field == Field::Name,
                    text::DISPLAY_NAME_EMPTY,
                    value_width,
                ),
                option_line(text::DOWNLOAD_DIR, field == Field::Dir),
                value_line(
                    &self.dir,
                    field == Field::Dir,
                    text::DOWNLOAD_DIR_EMPTY,
                    value_width,
                ),
            ];
            if let Some(error) = self.dir_error {
                lines.push(Line::styled(format!("{INDENT}{error}"), theme::ERR));
            }
            lines.extend([
                Line::default(),
                Line::styled(truncate(text::DONATION_PIX_HINT, width), theme::DIM),
                Line::from(vec![
                    Span::styled(format!("{}: ", text::DONATION_PIX_LABEL), theme::ACCENT),
                    Span::raw(DONATION_PIX_KEY),
                ]),
                option_line(text::DONATION_COPY_PIX, field == Field::CopyPix),
                Line::default(),
                Line::styled(text::TRANSFER_STATS, theme::ACCENT),
                Line::raw(text::stats_sent(
                    stats.upload_files,
                    format_bytes(stats.upload_bytes),
                )),
                Line::raw(text::stats_received(
                    stats.download_files,
                    format_bytes(stats.download_bytes),
                )),
                option_line(text::RESET_TRANSFER_STATS, field == Field::ResetStats),
            ]);
            if self.confirm_reset {
                let hint = truncate(text::RESET_STATS_CONFIRM, width);
                lines.push(Line::styled(hint, theme::WARN));
            }
            lines.extend([
                Line::default(),
                option_line(text::SAVE, field == Field::Save),
            ]);
            if let Some(feedback) = &self.feedback {
                lines.push(feedback.line(width));
            }
            lines.extend([Line::default(), help_line(text::SETTINGS_HELP, width)]);
            lines
        });
    }
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
