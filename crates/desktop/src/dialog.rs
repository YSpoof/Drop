//! Native file and folder pickers (`rfd`).

use std::path::PathBuf;

use rfd::{AsyncFileDialog, FileHandle};
use serde::Deserialize;
use serde_json::Value;

pub const FILES_TITLE: &str = "Select Files";
pub const FOLDER_TITLE: &str = "Select Folder";

/// Bridge params; malformed params fall back to defaults.
#[derive(Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    title: Option<String>,
    default_path: Option<String>,
}

impl Options {
    pub fn from_params(params: Value) -> Self {
        serde_json::from_value(params).unwrap_or_default()
    }

    fn title<'a>(&'a self, fallback: &'a str) -> &'a str {
        self.title
            .as_deref()
            .filter(|t| !t.is_empty())
            .unwrap_or(fallback)
    }

    fn dialog(&self, fallback: &str) -> AsyncFileDialog {
        let dialog = AsyncFileDialog::new().set_title(self.title(fallback));
        match self.default_path.as_deref().filter(|p| !p.is_empty()) {
            Some(path) => dialog.set_directory(path),
            None => dialog,
        }
    }
}

/// Cancel returns `[]`.
pub async fn pick_files(options: Options) -> Vec<String> {
    let picked = options.dialog(FILES_TITLE).pick_files().await;
    file_paths(picked.map(|files| files.iter().map(path_of).collect()))
}

/// Cancel returns `""`.
pub async fn pick_folder(options: Options) -> String {
    let picked = options.dialog(FOLDER_TITLE).pick_folder().await;
    folder_path(picked.as_ref().map(path_of))
}

fn path_of(handle: &FileHandle) -> PathBuf {
    handle.path().to_path_buf()
}

fn file_paths(picked: Option<Vec<PathBuf>>) -> Vec<String> {
    picked
        .unwrap_or_default()
        .iter()
        .map(|p| crate::fs::lossy(p))
        .collect()
}

fn folder_path(picked: Option<PathBuf>) -> String {
    picked.map(|p| crate::fs::lossy(&p)).unwrap_or_default()
}

#[cfg(test)]
#[path = "dialog_tests.rs"]
mod tests;
