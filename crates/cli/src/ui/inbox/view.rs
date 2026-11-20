//! Inbox rendering: header with LAN badge, pending tree window, transfer rows, footer.
//! Panel heights follow the terminal height; the footer always stays on screen.

use std::collections::HashMap;
use std::time::Instant;

use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use super::Inbox;
use super::tree::{Row, descendants};
use crate::state::{Direction, Phase, Transfer, TransferStatus};
use crate::text;
use crate::ui::format::{format_bytes, truncate, width as text_width};
use crate::ui::theme;

const DIVIDER_WIDTH: usize = 40;
const BAR_WIDTH: usize = 20;
/// Hint groups in the help strings are separated by two spaces.
const HINT_GAP: &str = "  ";

impl Inbox {
    pub(super) fn draw(&self, frame: &mut Frame, area: Rect) {
        let block = theme::panel(text::INBOX_TITLE);
        let inner = block.inner(area);
        frame.render_widget(block, area);
        let lines = self.lines(usize::from(inner.width), usize::from(inner.height));
        frame.render_widget(Paragraph::new(lines), inner);
    }

    /// Header, pending, transfers and footer fitted to `height`; the body is cut, not the footer.
    fn lines(&self, width: usize, height: usize) -> Vec<Line<'_>> {
        let footer = self.footer(width);
        let mut body = self.header(width);
        // Two dividers and two section labels.
        let room = height.saturating_sub(body.len() + 4 + footer.len());
        let pending = (room * 2 / 3).max(1);
        let transfers = room.saturating_sub(pending).max(1);
        body.push(divider(width));
        body.extend(self.pending(width, pending));
        body.push(divider(width));
        body.push(Line::styled(text::TRANSFERS, theme::STATUS));
        body.extend(self.transfers(width, transfers));
        body.truncate(height.saturating_sub(footer.len()).max(1));
        body.extend(footer);
        body
    }

    fn header(&self, width: usize) -> Vec<Line<'_>> {
        let s = &self.view;
        let (glyph, label) = match s.phase {
            Phase::Connected => (theme::OK, text::STATUS_CONNECTED),
            Phase::Reconnecting => (theme::WARN, text::STATUS_WAITING_RECONNECT),
            Phase::Ended => (theme::ERR, text::STATUS_DISCONNECTED),
            Phase::Signaling | Phase::WaitingForPeer | Phase::Connecting => {
                (theme::WARN, text::STATUS_CONNECTING)
            }
        };
        let role = match s.host {
            true => text::ROLE_HOST,
            false => text::ROLE_JOIN,
        };
        let mut status = vec![
            Span::styled("● ", glyph),
            Span::styled(label, theme::STATUS),
            Span::raw(format!(" [{role}]")),
        ];
        if s.peer.as_ref().is_some_and(|peer| peer.lan) {
            status.extend([Span::raw(" "), Span::styled(text::LABEL_LAN, theme::OK)]);
        }
        let mut meta = Vec::new();
        if let Some(peer) = &s.peer {
            let name = truncate(&peer.name, (width / 3).max(8));
            meta.push(Span::styled(text::connected_to(name), theme::STATUS));
        }
        if let Some(pin) = &s.pin {
            if !meta.is_empty() {
                meta.push(Span::raw(HINT_GAP));
            }
            meta.extend([Span::raw(text::pin_label("")), theme::pin(pin)]);
        }
        let mut lines = vec![Line::from(status)];
        if !meta.is_empty() {
            lines.push(Line::from(meta));
        }
        lines
    }

    /// The section label (with the scroll position when rows overflow) and a window of
    /// `page` rows that contains the cursor.
    fn pending(&self, width: usize, page: usize) -> Vec<Line<'_>> {
        let rows = self.rows();
        let scroll = window(self.cursor, self.scroll.get(), page, rows.len());
        self.scroll.set(scroll);
        let mut label = vec![Span::styled(text::PENDING_OFFERS, theme::STATUS)];
        if rows.len() > page {
            let last = (scroll + page).min(rows.len());
            let hint = text::scroll_hint(scroll + 1, last, rows.len());
            label.push(Span::styled(format!("{HINT_GAP}{hint}"), theme::DIM));
        }
        let mut lines = vec![Line::from(label)];
        if rows.is_empty() {
            lines.push(dim(text::PENDING_NONE, width));
        }
        lines.extend(
            rows.iter()
                .enumerate()
                .skip(scroll)
                .take(page)
                .map(|(i, row)| self.row_line(row, i == self.cursor, width)),
        );
        lines
    }

    fn row_line(&self, row: &Row, focused: bool, width: usize) -> Line<'static> {
        let body = match row {
            Row::Up => "..".to_string(),
            Row::Folder { name, path } => {
                let mark = self.mark(&descendants(&self.view.offers, path));
                format!("{mark} {name}/")
            }
            Row::File {
                name,
                id,
                size,
                path,
            } => {
                let mark = match self.selected.contains(id) {
                    true => "[x]",
                    false => "[ ]",
                };
                let size = format_bytes(*size);
                match path {
                    Some(path) => format!("{mark} {name}  {size}  ({path})"),
                    None => format!("{mark} {name}  {size}"),
                }
            }
        };
        let (cursor, style) = match focused {
            true => (theme::CURSOR, theme::SELECTED),
            false => (theme::NO_CURSOR, Style::new()),
        };
        styled(&format!("{cursor}{body}"), width, style)
    }

    /// `[x]` when every file is selected, `[-]` when some are, `[ ]` otherwise.
    fn mark(&self, ids: &[String]) -> &'static str {
        let picked = ids.iter().filter(|id| self.selected.contains(*id)).count();
        match picked {
            0 => "[ ]",
            n if n == ids.len() => "[x]",
            _ => "[-]",
        }
    }

    /// Started transfers, active first, then the newest finished ones, within `budget` lines.
    fn transfers(&self, width: usize, budget: usize) -> Vec<Line<'_>> {
        let all = &self.view.transfers;
        let active = all.iter().filter(|t| t.status == TransferStatus::Active);
        let done = all.iter().rev().filter(|t| t.finished());
        let mut lines = Vec::new();
        for t in active.chain(done) {
            let block = transfer_lines(t, self.rates.speed(&t.id), width);
            if !lines.is_empty() && lines.len() + block.len() > budget {
                break;
            }
            lines.extend(block);
            if lines.len() >= budget {
                break;
            }
        }
        if lines.is_empty() {
            lines.push(dim(text::TRANSFERS_NONE, width));
        }
        lines
    }

    fn footer(&self, width: usize) -> Vec<Line<'_>> {
        let mut lines = Vec::new();
        let help = match &self.search {
            Some(query) => {
                let prompt = text::search_prompt("");
                let mut line = query.line(true, width.saturating_sub(text_width(&prompt)));
                line.spans.insert(0, Span::raw(prompt));
                lines.push(line.style(theme::ACCENT));
                text::INBOX_SEARCH_HELP
            }
            None => text::INBOX_HELP,
        };
        lines.extend(
            wrap(help, width)
                .into_iter()
                .map(|l| Line::styled(l, theme::DIM)),
        );
        if !self.status.is_empty() {
            lines.push(styled(&self.status, width, theme::STATUS));
        }
        lines
    }
}

/// The first visible row so that `cursor` is inside a window of `page` rows.
pub fn window(cursor: usize, scroll: usize, page: usize, len: usize) -> usize {
    let scroll = scroll.min(cursor).max((cursor + 1).saturating_sub(page));
    scroll.min(len.saturating_sub(page))
}

/// Name line, then progress for active and completed transfers, then the failure reason.
pub fn transfer_lines(t: &Transfer, speed: f64, width: usize) -> Vec<Line<'static>> {
    let (icon, style) = match t.status {
        TransferStatus::Pending => ("○", theme::STATUS),
        TransferStatus::Active => ("●", theme::SELECTED),
        TransferStatus::Completed => ("✓", theme::OK),
        TransferStatus::Cancelled | TransferStatus::Failed => ("✗", theme::ERR),
    };
    let arrow = match t.direction {
        Direction::Upload => "↑",
        Direction::Download => "↓",
    };
    let mut lines = vec![styled(&format!("{icon} {arrow} {}", t.name), width, style)];
    match (t.status, &t.reason) {
        (TransferStatus::Active | TransferStatus::Completed, _) => {
            lines.push(styled(&progress(t, speed, width), width, theme::STATUS));
        }
        (TransferStatus::Failed | TransferStatus::Cancelled, Some(reason)) => {
            lines.push(styled(reason, width, theme::ERR));
        }
        _ => {}
    }
    lines
}

fn progress(t: &Transfer, speed: f64, width: usize) -> String {
    let pct = match (t.size, t.status) {
        (0, TransferStatus::Completed) => 100.0,
        (0, _) => 0.0,
        (size, _) => (t.bytes as f64 / size as f64 * 100.0).clamp(0.0, 100.0),
    };
    let bar = match width {
        0..40 => (width / 3).max(6),
        _ => BAR_WIDTH,
    };
    let filled = ((pct / 100.0 * bar as f64) as usize).min(bar);
    let mut line = format!(
        "{}{} {pct:3.0}%",
        "█".repeat(filled),
        "░".repeat(bar - filled)
    );
    match t.size {
        0 => {}
        size => line += &format!(" {}/{}", format_bytes(t.bytes), format_bytes(size)),
    }
    if t.status == TransferStatus::Active && speed > 0.0 {
        line += &format!("{HINT_GAP}{}/s", format_bytes(speed as u64));
        if let Some(eta) = eta(t.size.saturating_sub(t.bytes), speed) {
            line += &format!("{HINT_GAP}ETA {eta}");
        }
    }
    line
}

/// Time left for `remaining` bytes at `speed` bytes per second.
pub fn eta(remaining: u64, speed: f64) -> Option<String> {
    if remaining == 0 || speed <= 0.0 {
        return None;
    }
    let secs = (remaining as f64 / speed) as u64;
    Some(match secs {
        0 => "<1s".into(),
        1..60 => format!("{secs}s"),
        60..3600 => format!("{}m{:02}s", secs / 60, secs % 60),
        _ => format!("{}h{:02}m", secs / 3600, secs / 60 % 60),
    })
}

/// Speeds of active transfers, sampled at most once a second and smoothed.
#[derive(Debug, Default)]
pub struct Rates(HashMap<String, Rate>);

#[derive(Debug)]
struct Rate {
    at: Instant,
    bytes: u64,
    speed: f64,
}

impl Rates {
    pub fn sample(&mut self, transfers: &[Transfer], now: Instant) {
        let active: Vec<_> = transfers
            .iter()
            .filter(|t| t.status == TransferStatus::Active)
            .collect();
        self.0.retain(|id, _| active.iter().any(|t| &t.id == id));
        for t in active {
            let rate = self.0.entry(t.id.clone()).or_insert(Rate {
                at: now,
                bytes: t.bytes,
                speed: 0.0,
            });
            let elapsed = now.duration_since(rate.at).as_secs_f64();
            if elapsed < 1.0 {
                continue;
            }
            let current = t.bytes.saturating_sub(rate.bytes) as f64 / elapsed;
            rate.speed = match rate.speed > 0.0 {
                true => (rate.speed + current) / 2.0,
                false => current,
            };
            rate.at = now;
            rate.bytes = t.bytes;
        }
    }

    pub fn speed(&self, id: &str) -> f64 {
        self.0.get(id).map_or(0.0, |rate| rate.speed)
    }
}

/// Greedy wrap of a help string by its hint groups; a group wider than `width` is cut.
pub fn wrap(help: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for group in help.split(HINT_GAP).filter(|g| !g.is_empty()) {
        match lines.last_mut() {
            Some(line) if text_width(line) + HINT_GAP.len() + text_width(group) <= width => {
                line.push_str(HINT_GAP);
                line.push_str(group);
            }
            _ => lines.push(truncate(group, width).into_owned()),
        }
    }
    lines
}

fn styled(s: &str, width: usize, style: Style) -> Line<'static> {
    Line::styled(truncate(s, width).into_owned(), style)
}

fn dim(s: &str, width: usize) -> Line<'static> {
    styled(s, width, theme::DIM)
}

fn divider(width: usize) -> Line<'static> {
    Line::styled("─".repeat(width.min(DIVIDER_WIDTH)), theme::BORDER)
}

#[cfg(test)]
#[path = "view_tests.rs"]
mod tests;
