//! Pending offers as a folder tree built from their relative `meta.name` paths.

use std::collections::BTreeSet;

use crate::state::Offer;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Row {
    /// `..`: back to the parent level.
    Up,
    /// `path` is the folder's full path from the root.
    Folder { name: String, path: String },
    /// `path` is set on deep search hits and shown as a hint.
    File {
        name: String,
        id: String,
        size: u64,
        path: Option<String>,
    },
}

/// `/`-separated path without leading or trailing slashes (`\` counts as `/`).
pub fn normalize(name: &str) -> String {
    name.replace('\\', "/").trim_matches('/').to_string()
}

/// Path segments, skipping empty and `.` ones.
pub fn segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect()
}

/// Whether `path` is `prefix` or lies below it; every path lies below the root (`""`).
pub fn under(path: &str, prefix: &str) -> bool {
    match prefix {
        "" => !path.is_empty(),
        _ => path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/')),
    }
}

/// IDs of the offers at or below `prefix`, in offer order.
pub fn descendants(offers: &[Offer], prefix: &str) -> Vec<String> {
    offers
        .iter()
        .filter(|o| under(&normalize(&o.name), prefix))
        .map(|o| o.file_id.clone())
        .collect()
}

/// The rows of directory `cwd`: `..` below the root, then folders and files, each by name.
/// A file named like a folder of the same level is hidden behind the folder.
pub fn rows(offers: &[Offer], cwd: &[String]) -> Vec<Row> {
    let mut folders = BTreeSet::new();
    let mut files = Vec::new();
    for offer in offers {
        let path = normalize(&offer.name);
        let parts = segments(&path);
        let inside =
            parts.len() > cwd.len() && parts.iter().zip(cwd).all(|(a, b)| *a == b.as_str());
        if !inside {
            continue;
        }
        match &parts[cwd.len()..] {
            [name] => files.push(Row::File {
                name: name.to_string(),
                id: offer.file_id.clone(),
                size: offer.size,
                path: None,
            }),
            [folder, ..] => {
                folders.insert(folder.to_string());
            }
            [] => {}
        }
    }
    files.retain(|row| !matches!(row, Row::File { name, .. } if folders.contains(name)));
    files.sort_by(|a, b| name(a).cmp(name(b)));

    let up = (!cwd.is_empty()).then_some(Row::Up);
    let folders = folders.into_iter().map(|name| Row::Folder {
        path: join(cwd, &name),
        name,
    });
    up.into_iter().chain(folders).chain(files).collect()
}

/// The row's display name (`..` for [`Row::Up`]).
pub fn name(row: &Row) -> &str {
    match row {
        Row::Up => "..",
        Row::Folder { name, .. } | Row::File { name, .. } => name,
    }
}

fn join(cwd: &[String], name: &str) -> String {
    match cwd {
        [] => name.to_string(),
        _ => format!("{}/{name}", cwd.join("/")),
    }
}

#[cfg(test)]
#[path = "tree_tests.rs"]
mod tests;
