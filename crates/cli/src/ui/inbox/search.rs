//! Incoming-file search (`f`): every printable key edits the query, arrows move through the
//! hits, Enter focuses the hit in the tree, Esc cancels.

use crossterm::event::{KeyCode, KeyEvent};

use super::Inbox;
use super::tree::{self, Row, normalize, segments, under};
use crate::state::Offer;

/// Case-insensitive hits for `query` under `cwd`: the matching rows of this level, else the
/// deeper files whose name or path matches, sorted by path and carrying it as a hint.
pub fn hits(offers: &[Offer], cwd: &[String], query: &str) -> Vec<Row> {
    let query = query.to_lowercase();
    let matches = |s: &str| s.to_lowercase().contains(&query);
    let local: Vec<Row> = tree::rows(offers, cwd)
        .into_iter()
        .filter(|row| *row != Row::Up && matches(tree::name(row)))
        .collect();
    if !local.is_empty() {
        return local;
    }
    let prefix = cwd.join("/");
    let mut deep: Vec<Row> = offers
        .iter()
        .filter_map(|offer| {
            let path = normalize(&offer.name);
            let parts = segments(&path);
            let name = parts.last()?.to_string();
            let deep = parts.len() > cwd.len() + 1 && (prefix.is_empty() || under(&path, &prefix));
            (deep && (matches(&name) || matches(&path))).then(|| Row::File {
                name,
                id: offer.file_id.clone(),
                size: offer.size,
                path: Some(path.clone()),
            })
        })
        .collect();
    deep.sort_by(|a, b| hint(a).cmp(hint(b)));
    deep
}

fn hint(row: &Row) -> &str {
    match row {
        Row::File {
            path: Some(path), ..
        } => path,
        _ => "",
    }
}

impl Inbox {
    pub(super) fn start_search(&mut self) {
        self.search = Some(Default::default());
        self.cursor = 0;
    }

    pub(super) fn search_key(&mut self, key: KeyEvent) {
        let Some(query) = &mut self.search else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.end_search(false),
            KeyCode::Enter => self.end_search(true),
            KeyCode::Up => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Down => self.cursor_down(),
            _ => {
                if query.handle_key(&key) {
                    self.cursor = 0;
                }
            }
        }
    }

    /// Leaves search; with `focus`, the highlighted hit becomes the cursor row of the tree.
    fn end_search(&mut self, focus: bool) {
        let target = self.current().filter(|_| focus);
        self.search = None;
        if let Some(row) = target {
            self.focus(&row);
        }
        self.clamp_cursor();
    }

    fn focus(&mut self, target: &Row) {
        if let Row::File {
            path: Some(path), ..
        } = target
        {
            let parts = segments(path);
            self.cwd = parts[..parts.len().saturating_sub(1)]
                .iter()
                .map(|s| s.to_string())
                .collect();
        }
        let same = |row: &Row| match (row, target) {
            (Row::Folder { name: a, .. }, Row::Folder { name: b, .. }) => a == b,
            (Row::File { id: a, .. }, Row::File { id: b, .. }) => a == b,
            _ => false,
        };
        if let Some(at) = self.rows().iter().position(same) {
            self.cursor = at;
        }
    }
}

#[cfg(test)]
#[path = "search_tests.rs"]
mod tests;
