//! The receive inbox: pending offers as a folder tree with selection, `Baixar` / `Remover`,
//! search, transfer rows, and the session status line. Done once the session ends or on `q`.

pub mod search;
pub mod tree;
pub mod view;

use std::cell::Cell;
use std::collections::HashSet;
use std::io;
use std::time::Instant;

use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;
use tokio::sync::{mpsc, watch};

use super::{CopyKind, CopyRequest, Feedback, LineInput, Outcome, Screen, typed_char};
use crate::share::share_url;
use crate::state::{Command, Phase, SessionState};
use crate::text;
use tree::{Row, descendants};
use view::Rates;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Pull,
    Dismiss,
}

/// The PIN once known; the share link only for the host with a known peer ID.
pub fn copy_request(s: &SessionState, kind: CopyKind) -> Option<CopyRequest> {
    let pin = s.pin.as_ref()?;
    let content = match kind {
        CopyKind::Pin => pin.clone(),
        CopyKind::Link if s.host && !s.peer_id.is_empty() => {
            share_url(&s.signaling_url, &s.peer_id, pin)
        }
        CopyKind::Link | CopyKind::Pix => return None,
    };
    Some(CopyRequest { kind, content })
}

pub struct Inbox {
    state: watch::Receiver<SessionState>,
    /// Snapshot taken on every tick; keys and rendering read only this.
    view: SessionState,
    commands: mpsc::Sender<Command>,
    cwd: Vec<String>,
    cursor: usize,
    /// First visible pending row; render moves it to keep the cursor visible.
    scroll: Cell<usize>,
    /// Selected offer IDs.
    selected: HashSet<String>,
    /// The query while searching.
    search: Option<LineInput>,
    status: String,
    rates: Rates,
}

impl Inbox {
    pub fn new(mut state: watch::Receiver<SessionState>, commands: mpsc::Sender<Command>) -> Self {
        let view = state.borrow_and_update().clone();
        Self {
            status: view.status.clone(),
            view,
            state,
            commands,
            cwd: Vec::new(),
            cursor: 0,
            scroll: Cell::new(0),
            selected: HashSet::new(),
            search: None,
            rates: Rates::default(),
        }
    }

    /// Rows under the cursor's list: search hits while a query is typed, else the tree level.
    fn rows(&self) -> Vec<Row> {
        match &self.search {
            Some(query) if !query.value().is_empty() => {
                search::hits(&self.view.offers, &self.cwd, query.value())
            }
            _ => tree::rows(&self.view.offers, &self.cwd),
        }
    }

    fn current(&self) -> Option<Row> {
        self.rows().into_iter().nth(self.cursor)
    }

    fn row_ids(&self, row: &Row) -> Vec<String> {
        match row {
            Row::Up => Vec::new(),
            Row::Folder { path, .. } => descendants(&self.view.offers, path),
            Row::File { id, .. } => vec![id.clone()],
        }
    }

    fn cursor_down(&mut self) {
        if self.cursor + 1 < self.rows().len() {
            self.cursor += 1;
        }
    }

    fn clamp_cursor(&mut self) {
        self.cursor = self.cursor.min(self.rows().len().saturating_sub(1));
    }

    fn enter(&mut self) {
        match self.current() {
            Some(Row::Up) => self.go_up(),
            Some(Row::Folder { name, .. }) => {
                self.cwd.push(name);
                self.cursor = 0;
                self.scroll.set(0);
            }
            Some(Row::File { .. }) | None => {}
        }
    }

    fn go_up(&mut self) {
        if self.cwd.pop().is_some() {
            self.cursor = 0;
            self.scroll.set(0);
        }
    }

    fn all_selected(&self, ids: &[String]) -> bool {
        !ids.is_empty() && ids.iter().all(|id| self.selected.contains(id))
    }

    /// Space: selects the cursor row (a folder means all its pending files) or clears it.
    fn toggle(&mut self) {
        let ids = self
            .current()
            .map(|row| self.row_ids(&row))
            .unwrap_or_default();
        self.toggle_ids(ids, false);
    }

    /// `a`: selects every row of the current list, or clears the whole selection.
    fn toggle_all(&mut self) {
        let ids = self
            .rows()
            .iter()
            .flat_map(|row| self.row_ids(row))
            .collect();
        self.toggle_ids(ids, true);
    }

    fn toggle_ids(&mut self, ids: Vec<String>, clear_all: bool) {
        match (self.all_selected(&ids), clear_all) {
            (true, true) => self.selected.clear(),
            (true, false) => self.selected.retain(|id| !ids.contains(id)),
            (false, _) => self.selected.extend(ids),
        }
    }

    /// The selected offers, else the cursor row's; with a label for the status line.
    fn targets(&self) -> Option<(Vec<String>, String)> {
        let offers = &self.view.offers;
        let picked: Vec<_> = offers
            .iter()
            .filter(|o| self.selected.contains(&o.file_id))
            .collect();
        match picked.as_slice() {
            [] => {}
            [one] => return Some((vec![one.file_id.clone()], one.name.clone())),
            many => {
                let ids = many.iter().map(|o| o.file_id.clone()).collect();
                return Some((ids, text::n_files(many.len())));
            }
        }
        let row = self.current()?;
        let ids = self.row_ids(&row);
        let label = match (row, ids.as_slice()) {
            (_, []) => return None,
            (
                Row::File {
                    path: Some(path), ..
                },
                _,
            ) => path,
            (Row::Folder { .. }, [id]) => offers.iter().find(|o| &o.file_id == id)?.name.clone(),
            (Row::Folder { name, .. }, _) => format!("{name}/"),
            (Row::File { name, .. }, _) => name,
            (Row::Up, _) => return None,
        };
        Some((ids, label))
    }

    /// `d` / `r`: sends the command for the targets; they leave the list right away.
    fn act(&mut self, action: Action) {
        let Some((ids, label)) = self.targets() else {
            self.status = text::NOTHING_SELECTED.into();
            return;
        };
        let command = match action {
            Action::Pull => Command::Pull(ids.clone()),
            Action::Dismiss => Command::Dismiss(ids.clone()),
        };
        if let Err(err) = self.commands.try_send(command) {
            self.status = match action {
                Action::Pull => text::download_failed(err),
                Action::Dismiss => text::remove_failed(err),
            };
            return;
        }
        self.status = match action {
            Action::Pull => text::downloading_named(&label),
            Action::Dismiss => text::removed_named(&label),
        };
        self.selected.retain(|id| !ids.contains(id));
        self.view.remove_offers(&ids);
        self.clamp_cursor();
    }

    fn copy(&self, kind: CopyKind) -> Outcome<()> {
        copy_request(&self.view, kind).map_or(Outcome::Continue, Outcome::Copy)
    }

    /// Reads the session state: a new session status replaces the status line, selection and
    /// directory follow offers that left.
    fn refresh(&mut self, now: Instant) {
        let view = self.state.borrow_and_update().clone();
        if view.status != self.view.status && !view.status.is_empty() {
            self.status = view.status.clone();
        }
        self.view = view;
        let offers = &self.view.offers;
        self.selected
            .retain(|id| offers.iter().any(|o| &o.file_id == id));
        while !self.cwd.is_empty() && descendants(offers, &self.cwd.join("/")).is_empty() {
            self.cwd.pop();
            self.cursor = 0;
        }
        self.rates.sample(&self.view.transfers, now);
        self.clamp_cursor();
    }
}

impl Screen for Inbox {
    /// The session ended, or the user pressed `q`.
    type Output = ();

    fn handle_key(&mut self, key: KeyEvent) -> Outcome<()> {
        if self.search.is_some() {
            self.search_key(key);
            return Outcome::Continue;
        }
        match (key.code, typed_char(&key)) {
            (KeyCode::Up, _) => self.cursor = self.cursor.saturating_sub(1),
            (KeyCode::Down, _) => self.cursor_down(),
            (KeyCode::Enter, _) => self.enter(),
            (KeyCode::Esc, _) => self.go_up(),
            (_, Some('q')) => return Outcome::Done(()),
            (_, Some('f')) => self.start_search(),
            (_, Some(' ')) => self.toggle(),
            (_, Some('a')) => self.toggle_all(),
            (_, Some('d')) => self.act(Action::Pull),
            (_, Some('r' | 'x')) => self.act(Action::Dismiss),
            (_, Some('c')) => return self.copy(CopyKind::Pin),
            (_, Some('C')) => return self.copy(CopyKind::Link),
            _ => {}
        }
        Outcome::Continue
    }

    fn tick(&mut self) -> Outcome<()> {
        self.refresh(Instant::now());
        match self.view.phase {
            Phase::Ended => Outcome::Done(()),
            _ => Outcome::Continue,
        }
    }

    fn on_copied(&mut self, kind: CopyKind, result: io::Result<()>) {
        self.status = Feedback::copied(kind, &result).text;
    }

    fn confirms_exit(&self) -> bool {
        true
    }

    fn render(&self, frame: &mut Frame, area: Rect) {
        self.draw(frame, area);
    }
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
