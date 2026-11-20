//! Session wait before the first ready: the PIN, `c` / `C` copy hints and feedback, and the
//! connection status. Reads a plain [`HostWait`] view from a feed on every tick; done once the
//! peer is ready or the session ended. The joiner sees it titled `Possuo um código`.

use std::io;

use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::{Line, Span};

use super::format::{self, truncate};
use super::{CopyKind, CopyRequest, Feedback, Outcome, Screen, render_form, theme, typed_char};
use crate::share::share_url;
use crate::state::{Phase, SessionState};
use crate::text;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum WaitStatus {
    #[default]
    Connecting,
    /// PIN assigned, no peer yet.
    WaitingPeer,
    /// The peer left after a ready session; an optional detail (last error).
    Reconnecting(Option<String>),
    /// A peer is ready: the screen finishes.
    Ready,
    /// The session is over: the screen finishes.
    Ended,
}

/// What the host wait screen shows. Fed by the session.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostWait {
    pub pin: Option<String>,
    /// Needs both the PIN and the local peer ID.
    pub share_url: Option<String>,
    pub status: WaitStatus,
}

impl From<&SessionState> for HostWait {
    fn from(s: &SessionState) -> Self {
        let status = match s.phase {
            Phase::WaitingForPeer if s.host => WaitStatus::WaitingPeer,
            Phase::Signaling | Phase::WaitingForPeer | Phase::Connecting => WaitStatus::Connecting,
            Phase::Reconnecting => WaitStatus::Reconnecting(None),
            Phase::Connected => WaitStatus::Ready,
            Phase::Ended => WaitStatus::Ended,
        };
        let share_url = match (&s.pin, s.host && !s.peer_id.is_empty()) {
            (Some(pin), true) => Some(share_url(&s.signaling_url, &s.peer_id, pin)),
            _ => None,
        };
        Self {
            pin: s.pin.clone(),
            share_url,
            status,
        }
    }
}

pub struct HostWaitScreen<F> {
    feed: F,
    title: &'static str,
    view: HostWait,
    feedback: Option<Feedback>,
}

impl<F: FnMut() -> HostWait> HostWaitScreen<F> {
    pub fn new(mut feed: F) -> Self {
        Self {
            view: feed(),
            feed,
            title: text::HOST_SESSION,
            feedback: None,
        }
    }

    pub fn titled(self, title: &'static str) -> Self {
        Self { title, ..self }
    }

    fn status_line(&self, width: usize) -> Line<'_> {
        let (glyph, label, detail) = match &self.view.status {
            WaitStatus::Connecting => (theme::WARN, text::STATUS_CONNECTING, None),
            WaitStatus::WaitingPeer => (theme::WARN, text::WAITING_PEER, None),
            WaitStatus::Reconnecting(detail) => (
                theme::WARN,
                text::STATUS_WAITING_RECONNECT,
                detail.as_deref(),
            ),
            WaitStatus::Ready => (theme::OK, text::STATUS_CONNECTED, None),
            WaitStatus::Ended => (theme::ERR, text::STATUS_DISCONNECTED, None),
        };
        let mut spans = vec![
            Span::styled("● ", glyph),
            Span::styled(label, theme::STATUS),
        ];
        if let Some(detail) = detail {
            let room = width.saturating_sub(format::width(label) + 4);
            spans.push(Span::styled(
                format!(": {}", truncate(detail, room)),
                theme::DIM,
            ));
        }
        Line::from(spans)
    }
}

impl<F: FnMut() -> HostWait> Screen for HostWaitScreen<F> {
    /// The peer is ready or the session ended.
    type Output = ();

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<()> {
        let (kind, content) = match (typed_char(&key), &self.view.pin, &self.view.share_url) {
            (Some('c'), Some(pin), _) => (CopyKind::Pin, pin.clone()),
            (Some('C'), Some(_), Some(url)) => (CopyKind::Link, url.clone()),
            _ => return Outcome::Continue,
        };
        Outcome::Copy(CopyRequest { kind, content })
    }

    fn tick(&mut self) -> Outcome<()> {
        self.view = (self.feed)();
        match self.view.status {
            WaitStatus::Ready | WaitStatus::Ended => Outcome::Done(()),
            _ => Outcome::Continue,
        }
    }

    fn on_copied(&mut self, kind: CopyKind, result: io::Result<()>) {
        self.feedback = Some(Feedback::copied(kind, &result));
    }

    fn confirms_exit(&self) -> bool {
        true
    }

    fn render(&self, frame: &mut Frame, area: Rect) {
        render_form(frame, area, self.title, |width| {
            let mut lines = vec![self.status_line(width)];
            if let Some(pin) = &self.view.pin {
                let hint = match self.view.share_url {
                    Some(_) => text::PRESS_COPY_HINT,
                    None => text::PRESS_COPY_PIN_HINT,
                };
                lines.extend([
                    Line::default(),
                    // `pin_label("")` is the catalog's label prefix; the PIN gets its own style.
                    Line::from(vec![Span::raw(text::pin_label("")), theme::pin(pin)]),
                    Line::default(),
                    Line::styled(truncate(hint, width), theme::DIM),
                ]);
            }
            if let Some(feedback) = &self.feedback {
                lines.push(feedback.line(width));
            }
            lines
        });
    }
}

#[cfg(test)]
#[path = "host_wait_tests.rs"]
mod tests;
