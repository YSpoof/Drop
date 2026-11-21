//! Filesystem calls behind the `fs.*` bridge methods.

use std::fs::Metadata;
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tokio::fs;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    exists: bool,
    path: String,
    size: u64,
    is_directory: bool,
    modified_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    entry: String,
    path: String,
    #[serde(rename = "type")]
    kind: &'static str,
    size: u64,
    modified_at: i64,
}

/// `<home>/Downloads`, created when missing; the home directory if that fails.
pub async fn downloads_dir() -> io::Result<String> {
    let home = dirs::home_dir().ok_or_else(|| io::Error::other("user home directory not found"))?;
    let dir = home.join("Downloads");
    let chosen = match fs::create_dir_all(&dir).await {
        Ok(()) => dir,
        Err(_) => home,
    };
    Ok(lossy(&chosen))
}

/// A missing path is `exists: false`, not an error.
pub async fn stat(path: &str) -> io::Result<Stat> {
    match fs::metadata(path).await {
        Ok(meta) => Ok(Stat {
            exists: true,
            path: path.into(),
            size: meta.len(),
            is_directory: meta.is_dir(),
            modified_at: modified_ms(&meta),
        }),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Stat {
            path: path.into(),
            ..Stat::default()
        }),
        Err(err) => Err(err),
    }
}

/// Entries sorted by name; symlinks are not followed. Empty directory → empty list.
pub async fn read_dir(dir: &str) -> io::Result<Vec<Entry>> {
    let mut reader = fs::read_dir(dir).await?;
    let mut entries = Vec::new();
    while let Some(item) = reader.next_entry().await? {
        let Ok(meta) = item.metadata().await else {
            continue;
        };
        entries.push(Entry {
            entry: item.file_name().to_string_lossy().into_owned(),
            path: lossy(&item.path()),
            kind: if meta.is_dir() { "DIRECTORY" } else { "FILE" },
            size: meta.len(),
            modified_at: modified_ms(&meta),
        });
    }
    entries.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(entries)
}

pub async fn mkdir(path: &str) -> io::Result<()> {
    fs::create_dir_all(path).await
}

/// `rm -rf`: files and directories; a missing path is fine.
pub async fn remove(path: &str) -> io::Result<()> {
    let result = match fs::symlink_metadata(path).await {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path).await,
        Ok(_) => fs::remove_file(path).await,
        Err(err) => Err(err),
    };
    match result {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Error text the frontend matches to pick the next free name.
pub const TARGET_EXISTS: &str = "target exists";

/// Moves a file without ever replacing `to`: a hard link plus unlink (atomic on one
/// filesystem), else an exclusive-create copy and delete (across devices, or where links
/// are unsupported). An existing target fails with [`TARGET_EXISTS`].
pub async fn rename(from: &str, to: &str) -> io::Result<()> {
    if let Some(parent) = Path::new(to).parent() {
        fs::create_dir_all(parent).await?;
    }
    let result = match fs::hard_link(from, to).await {
        Err(err) if err.kind() != io::ErrorKind::AlreadyExists => copy_new(from, to).await,
        linked => linked,
    };
    match result {
        Ok(()) => remove(from).await,
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            Err(io::Error::new(io::ErrorKind::AlreadyExists, TARGET_EXISTS))
        }
        Err(err) => Err(err),
    }
}

async fn copy_new(from: &str, to: &str) -> io::Result<()> {
    let mut source = fs::File::open(from).await?;
    let mut target = fs::OpenOptions::new().write(true).create_new(true).open(to).await?;
    tokio::io::copy(&mut source, &mut target).await.map(|_| ())
}

fn modified_ms(meta: &Metadata) -> i64 {
    let since = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok());
    since.map_or(0, |d| d.as_millis() as i64)
}

pub fn lossy(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
#[path = "fs_tests.rs"]
mod tests;
