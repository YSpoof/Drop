//! Shared palette and styles (ANSI 16-color indexes).

use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, BorderType, Padding};

pub const TITLE_COLOR: Color = Color::LightBlue; // ANSI 12
pub const ACCENT_COLOR: Color = Color::LightCyan; // ANSI 14
pub const DIM_COLOR: Color = Color::DarkGray; // ANSI 8
pub const OK_COLOR: Color = Color::Green; // ANSI 2
pub const WARN_COLOR: Color = Color::LightYellow; // ANSI 11
pub const ERR_COLOR: Color = Color::Red; // ANSI 1
pub const PIN_FG: Color = Color::LightGreen; // ANSI 10
pub const PIN_BG: Color = Color::Black; // ANSI 0
pub const BORDER_COLOR: Color = DIM_COLOR;

pub const TITLE: Style = Style::new().fg(TITLE_COLOR).add_modifier(Modifier::BOLD);
pub const ACCENT: Style = Style::new().fg(ACCENT_COLOR);
pub const DIM: Style = Style::new().fg(DIM_COLOR);
pub const OK: Style = Style::new().fg(OK_COLOR);
pub const WARN: Style = Style::new().fg(WARN_COLOR).add_modifier(Modifier::BOLD);
pub const ERR: Style = Style::new().fg(ERR_COLOR);
pub const BORDER: Style = Style::new().fg(BORDER_COLOR);
pub const PIN: Style = Style::new()
    .fg(PIN_FG)
    .bg(PIN_BG)
    .add_modifier(Modifier::BOLD);
pub const STATUS: Style = ACCENT;
pub const CONFIRM_TITLE: Style = Style::new().fg(Color::White).add_modifier(Modifier::BOLD);
pub const CONFIRM_HINT: Style = DIM;
/// Focused option in a list or button row.
pub const SELECTED: Style = Style::new().fg(OK_COLOR).add_modifier(Modifier::BOLD);
/// Cursor marker in front of the focused row.
pub const CURSOR: &str = "> ";
pub const NO_CURSOR: &str = "  ";

/// The PIN with one cell of horizontal padding.
pub fn pin(pin: &str) -> Span<'static> {
    Span::styled(format!(" {pin} "), PIN)
}

/// Rounded bordered panel with a bold title, shared by every full-screen surface.
pub fn panel(title: &str) -> Block<'_> {
    Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(BORDER)
        .title(Span::styled(format!(" {title} "), TITLE))
        .padding(Padding::horizontal(1))
}
