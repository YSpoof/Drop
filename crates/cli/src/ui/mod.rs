//! The interactive terminal UI: the single owner of raw mode, the alternate screen and input.
//!
//! One [`Ui`] exists per process. It runs one [`Screen`] at a time with [`Ui::run`], which
//! returns when the screen is done or the user cancels. The flow (donation → menu → PIN →
//! host wait → inbox) is a sequence of `run` calls; the Ctrl+C confirm overlay lives in the
//! `Ui` and is drawn on top of any screen whose [`Screen::confirms_exit`] is true.
//!
//! Quick mode prints lines instead; on a TTY it reads keys through [`RawKeys`].

pub mod confirm;
pub mod donation;
pub mod format;
pub mod host_wait;
pub mod inbox;
pub mod menu;
pub mod quick;
pub mod settings;
pub mod theme;

use std::io;
use std::sync::Arc;
use std::time::Duration;

use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use futures_util::StreamExt;
use futures_util::future::BoxFuture;
use ratatui::layout::{Constraint, Rect};
use ratatui::prelude::CrosstermBackend;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::{DefaultTerminal, Frame, Terminal};
use tokio::sync::Notify;
use tokio::task::JoinSet;
use tokio::time::{self, MissedTickBehavior};
use unicode_width::UnicodeWidthChar;

use crate::text;
use confirm::{Confirm, ConfirmResult};

/// Screens are re-read (`Screen::tick`) and redrawn at least this often.
pub const TICK: Duration = Duration::from_millis(200);
const FORM_WIDTH: u16 = 76;

/// Puts text on the clipboard. Injected so tests never touch the real clipboard.
pub type Clipboard = Arc<dyn Fn(String) -> BoxFuture<'static, io::Result<()>> + Send + Sync>;

/// The system clipboard through [`crate::clipboard::copy`].
pub fn system_clipboard() -> Clipboard {
    Arc::new(|content| Box::pin(async move { crate::clipboard::copy(&content).await }))
}

/// What a screen wants after a key or a tick.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome<T> {
    Continue,
    /// Copy to the clipboard; the result comes back through [`Screen::on_copied`].
    Copy(CopyRequest),
    /// The screen is finished; [`Ui::run`] returns this value.
    Done(T),
}

/// How [`Ui::run`] ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Exit<T> {
    Done(T),
    /// Ctrl+C on a form, or a confirmed Ctrl+C on the overlay. A clean exit, not an error.
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CopyKind {
    Pin,
    Link,
    Pix,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyRequest {
    pub kind: CopyKind,
    pub content: String,
}

/// One full-screen surface. Implementations are plain state machines: no terminal, no clipboard.
pub trait Screen {
    type Output;

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<Self::Output>;
    fn render(&self, frame: &mut Frame, area: Rect);

    /// Called every [`TICK`] and on each redraw notification, before drawing.
    fn tick(&mut self) -> Outcome<Self::Output> {
        Outcome::Continue
    }
    fn on_copied(&mut self, _kind: CopyKind, _result: io::Result<()>) {}
    /// Ctrl+C opens the confirm overlay instead of cancelling at once (session wait surfaces).
    fn confirms_exit(&self) -> bool {
        false
    }
}

/// Wakes the UI to re-read state and redraw before the next tick.
pub type Redraw = Arc<Notify>;

/// The terminal owner. Raw mode and the alternate screen are restored on drop and on panic.
pub struct Ui {
    terminal: DefaultTerminal,
    events: EventStream,
    clipboard: Clipboard,
    redraw: Redraw,
    confirm: Confirm,
}

impl Ui {
    /// Enters raw mode and the alternate screen. Call only when stdin and stdout are a TTY.
    pub fn start(clipboard: Clipboard) -> io::Result<Self> {
        let terminal = ratatui::try_init().inspect_err(|_| {
            let _ = ratatui::try_restore();
        })?;
        Ok(Self {
            terminal,
            events: EventStream::new(),
            clipboard,
            redraw: Redraw::default(),
            confirm: Confirm::default(),
        })
    }

    pub fn redraw_handle(&self) -> Redraw {
        self.redraw.clone()
    }

    /// Drives `screen` until it is done or the user cancels.
    /// An open confirm overlay carries over to the next screen that confirms exit.
    pub async fn run<S: Screen>(&mut self, screen: &mut S) -> io::Result<Exit<S::Output>> {
        if !screen.confirms_exit() {
            self.confirm.hide();
        }
        let mut copies = JoinSet::new();
        let mut tick = time::interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            let confirm = &self.confirm;
            self.terminal.draw(|frame| {
                screen.render(frame, frame.area());
                confirm.render(frame, frame.area());
            })?;
            let step = tokio::select! {
                event = self.events.next() => match event {
                    Some(Ok(Event::Key(key))) if key.kind != KeyEventKind::Release => {
                        dispatch(screen, &mut self.confirm, key)
                    }
                    Some(Ok(_)) => Step::Continue,
                    Some(Err(err)) => return Err(err),
                    None => return Err(io::ErrorKind::UnexpectedEof.into()),
                },
                _ = tick.tick() => screen.tick().into(),
                _ = self.redraw.notified() => screen.tick().into(),
                Some(Ok((kind, result))) = copies.join_next() => {
                    screen.on_copied(kind, result);
                    Step::Continue
                }
            };
            match step {
                Step::Continue => {}
                Step::Copy(CopyRequest { kind, content }) => {
                    let copy = (self.clipboard)(content);
                    copies.spawn(async move { (kind, copy.await) });
                }
                Step::Exit(exit) => return Ok(exit),
            }
        }
    }
}

impl Drop for Ui {
    fn drop(&mut self) {
        let _ = ratatui::try_restore();
    }
}

/// Quick mode on a TTY: raw mode without the alternate screen, so single keys arrive and
/// printed lines need `\r\n`. Raw mode is left on drop.
pub struct RawKeys {
    events: EventStream,
}

impl RawKeys {
    pub fn start() -> io::Result<Self> {
        terminal::enable_raw_mode()?;
        Ok(Self {
            events: EventStream::new(),
        })
    }

    pub async fn next_key(&mut self) -> io::Result<KeyEvent> {
        loop {
            if let Event::Key(key) = self.next_event().await? {
                return Ok(key);
            }
        }
    }

    /// The next event other than a key release.
    async fn next_event(&mut self) -> io::Result<Event> {
        loop {
            match self.events.next().await {
                Some(Ok(Event::Key(key))) if key.kind == KeyEventKind::Release => {}
                Some(event) => return event,
                None => return Err(io::ErrorKind::UnexpectedEof.into()),
            }
        }
    }

    /// Shows the confirm overlay in the alternate screen, then returns to line mode.
    /// True when the exit was confirmed.
    pub async fn confirm_exit(&mut self) -> io::Result<bool> {
        execute!(io::stdout(), EnterAlternateScreen)?;
        let confirmed = self.confirm_loop().await;
        execute!(io::stdout(), LeaveAlternateScreen)?;
        confirmed
    }

    async fn confirm_loop(&mut self) -> io::Result<bool> {
        let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
        let mut confirm = Confirm::shown();
        loop {
            terminal.draw(|frame| confirm.render(frame, frame.area()))?;
            let Event::Key(key) = self.next_event().await? else {
                continue;
            };
            match confirm.handle_key(key) {
                Some(ConfirmResult::Exit) => return Ok(true),
                Some(ConfirmResult::Dismiss) => return Ok(false),
                None => {}
            }
        }
    }
}

impl Drop for RawKeys {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
    }
}

/// What the event loop does after one input.
#[derive(Debug, PartialEq, Eq)]
pub enum Step<T> {
    Continue,
    Copy(CopyRequest),
    Exit(Exit<T>),
}

impl<T> From<Outcome<T>> for Step<T> {
    fn from(outcome: Outcome<T>) -> Self {
        match outcome {
            Outcome::Continue => Step::Continue,
            Outcome::Copy(request) => Step::Copy(request),
            Outcome::Done(value) => Step::Exit(Exit::Done(value)),
        }
    }
}

/// Routes one key: the visible overlay takes every key; Ctrl+C opens it on screens that
/// confirm exit and cancels at once elsewhere; any other key goes to the screen.
pub fn dispatch<S: Screen>(
    screen: &mut S,
    confirm: &mut Confirm,
    key: KeyEvent,
) -> Step<S::Output> {
    let interrupt = is_interrupt(&key);
    match (confirm.visible(), interrupt, screen.confirms_exit()) {
        (true, _, _) | (false, true, true) => match confirm.handle_key(key) {
            Some(ConfirmResult::Exit) => Step::Exit(Exit::Cancelled),
            Some(ConfirmResult::Dismiss) | None => Step::Continue,
        },
        (false, true, false) => Step::Exit(Exit::Cancelled),
        (false, false, _) => screen.handle_key(key).into(),
    }
}

pub fn is_interrupt(key: &KeyEvent) -> bool {
    key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL)
}

/// The typed character, unless Ctrl or Alt is held.
pub fn typed_char(key: &KeyEvent) -> Option<char> {
    match key.code {
        KeyCode::Char(c)
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
        {
            Some(c)
        }
        _ => None,
    }
}

/// A status message after an action (copy, save, reset).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Feedback {
    pub ok: bool,
    pub text: String,
}

impl Feedback {
    pub fn ok(text: impl Into<String>) -> Self {
        Self {
            ok: true,
            text: text.into(),
        }
    }

    pub fn err(text: impl Into<String>) -> Self {
        Self {
            ok: false,
            text: text.into(),
        }
    }

    pub fn copied(kind: CopyKind, result: &io::Result<()>) -> Self {
        match (kind, result) {
            (CopyKind::Pin, Ok(())) => Self::ok(text::PIN_COPIED),
            (CopyKind::Link, Ok(())) => Self::ok(text::SHARE_LINK_COPIED),
            (CopyKind::Pix, Ok(())) => Self::ok(text::PIX_COPIED),
            (CopyKind::Pin, Err(err)) => Self::err(text::copy_pin_failed(err)),
            (CopyKind::Link, Err(err)) => Self::err(text::copy_link_failed(err)),
            (CopyKind::Pix, Err(err)) => Self::err(text::copy_pix_failed(err)),
        }
    }

    pub fn line(&self, width: usize) -> Line<'_> {
        let style = if self.ok { theme::OK } else { theme::ERR };
        Line::styled(format::truncate(&self.text, width), style)
    }
}

/// A single-line text field (append and backspace only).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LineInput {
    value: String,
}

impl LineInput {
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn clear(&mut self) {
        self.value.clear();
    }

    /// Applies an editing key; returns whether the key was consumed.
    pub fn handle_key(&mut self, key: &KeyEvent) -> bool {
        match (key.code, typed_char(key)) {
            (_, Some(c)) => self.value.push(c),
            (KeyCode::Backspace, _) => {
                self.value.pop();
            }
            _ => return false,
        }
        true
    }

    /// The field fitted to `width` cells, keeping the end of a long value visible.
    pub fn line(&self, focused: bool, width: usize) -> Line<'_> {
        let room = width.saturating_sub(usize::from(focused));
        let mut start = self.value.len();
        let mut used = 0;
        for (i, c) in self.value.char_indices().rev() {
            used += c.width().unwrap_or(0);
            if used > room {
                break;
            }
            start = i;
        }
        let mut spans = vec![Span::raw(&self.value[start..])];
        if focused {
            spans.push(Span::styled(" ", theme::SELECTED.reversed()));
        }
        Line::from(spans)
    }
}

/// Draws a titled form panel centered in `area`. `lines` gets the usable text width.
pub fn render_form<'a>(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: impl FnOnce(usize) -> Vec<Line<'a>>,
) {
    // Two border cells plus one padding cell on each side.
    let width = area.width.min(FORM_WIDTH).saturating_sub(4);
    let lines = lines(usize::from(width));
    let height = u16::try_from(lines.len())
        .unwrap_or(u16::MAX)
        .saturating_add(2);
    let rect = area.centered(Constraint::Max(FORM_WIDTH), Constraint::Length(height));
    frame.render_widget(Paragraph::new(lines).block(theme::panel(title)), rect);
}

/// Dim help footer fitted to `width`.
pub fn help_line(help: &str, width: usize) -> Line<'_> {
    Line::styled(format::truncate(help, width), theme::DIM)
}

/// A list row with the focus marker.
pub fn option_line(label: &str, focused: bool) -> Line<'_> {
    if focused {
        Line::from(vec![
            Span::styled(theme::CURSOR, theme::ACCENT),
            Span::styled(label, theme::SELECTED),
        ])
    } else {
        Line::from(vec![Span::raw(theme::NO_CURSOR), Span::raw(label)])
    }
}

/// Key events and a text dump of a rendered frame, for the screen tests.
#[cfg(test)]
pub mod testing {
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::{Frame, Terminal};

    pub fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::from(code)
    }

    pub fn ctrl_c() -> KeyEvent {
        KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)
    }

    pub fn shift(c: char) -> KeyEvent {
        KeyEvent::new(KeyCode::Char(c), KeyModifiers::SHIFT)
    }

    /// Renders `draw` into a `width`x`height` buffer and returns its rows joined by newlines.
    pub fn render_text(width: u16, height: u16, draw: impl FnOnce(&mut Frame)) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(draw).unwrap();
        let buffer = terminal.backend().buffer();
        (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}
