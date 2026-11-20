//! Partial downloads: `<hash>.drop` files, resume offsets, and collision-safe finalize.

use std::io::{self, SeekFrom};
use std::path::{Component, Path, PathBuf};

use tokio::fs::{self, File, OpenOptions};
use tokio::io::AsyncSeekExt;

pub const DROP_SUFFIX: &str = ".drop";

/// On-disk name of the partial for `hash`, with Windows-invalid characters replaced by `_`.
pub fn drop_name(hash: &str) -> String {
    let safe: String = hash
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c => c,
        })
        .collect();
    safe + DROP_SUFFIX
}

/// Bytes already in the partial when `0 < len < size`; otherwise 0.
pub async fn resume_offset(dir: &Path, hash: &str, size: u64) -> io::Result<u64> {
    if hash.is_empty() {
        return Ok(0);
    }
    match fs::metadata(dir.join(drop_name(hash))).await {
        Ok(meta) if meta.len() > 0 && meta.len() < size => Ok(meta.len()),
        Ok(_) => Ok(0),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(err) => Err(err),
    }
}

/// Opens the partial for writing at `offset`, truncating anything past it.
pub async fn open(dir: &Path, hash: &str, offset: u64) -> io::Result<File> {
    if hash.is_empty() {
        return Err(invalid("empty drop hash"));
    }
    fs::create_dir_all(dir).await?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(dir.join(drop_name(hash)))
        .await?;
    file.set_len(offset).await?;
    file.seek(SeekFrom::Start(offset)).await?;
    Ok(file)
}

/// Moves the partial to a free name derived from `name` under `dir` and returns that
/// relative name (`/`-separated). `name (1).ext`, `name (2).ext`, … are tried on collision.
pub async fn finalize(dir: &Path, hash: &str, name: &str) -> io::Result<String> {
    if hash.is_empty() {
        return Err(invalid("empty drop hash"));
    }
    let relative = sanitize_relative_path(name)?;
    let partial = dir.join(drop_name(hash));
    fs::metadata(&partial).await?;
    let chosen = unique_available_name(dir, &relative).await?;
    let target = join_relative(dir, &chosen);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::rename(&partial, &target).await?;
    Ok(chosen)
}

/// Removes the partial for `hash`, ignoring a missing file.
pub async fn discard(dir: &Path, hash: &str) {
    let _ = fs::remove_file(dir.join(drop_name(hash))).await;
}

/// Removes every `*.drop` file directly under `dir`.
pub async fn discard_all(dir: &Path) -> io::Result<()> {
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    while let Some(entry) = entries.next_entry().await? {
        let is_file = entry.file_type().await.is_ok_and(|t| !t.is_dir());
        if is_file && entry.file_name().to_string_lossy().ends_with(DROP_SUFFIX) {
            let _ = fs::remove_file(entry.path()).await;
        }
    }
    Ok(())
}

/// Normalizes a peer-supplied name to a relative `/`-separated path: `\` becomes `/`,
/// leading `/` and empty or `.` segments are dropped, `..` or a drive prefix is rejected,
/// and an empty result becomes `download`.
pub fn sanitize_relative_path(name: &str) -> io::Result<String> {
    let normalized = name.replace('\\', "/");
    let mut clean = Vec::new();
    for part in normalized.split('/').filter(|p| !p.is_empty() && *p != ".") {
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => clean.push(part),
            _ => return Err(invalid("invalid download path")),
        }
    }
    if clean.is_empty() {
        return Ok("download".into());
    }
    Ok(clean.join("/"))
}

fn unique_name_at(name: &str, index: usize) -> String {
    if index == 0 {
        return name.to_string();
    }
    let (dir, leaf) = match name.rfind(['/', '\\']) {
        Some(i) => name.split_at(i + 1),
        None => ("", name),
    };
    let (base, ext) = match leaf.rfind('.') {
        Some(dot) if dot > 0 => leaf.split_at(dot),
        _ => (leaf, ""),
    };
    format!("{dir}{base} ({index}){ext}")
}

async fn unique_available_name(dir: &Path, name: &str) -> io::Result<String> {
    let mut index = 0;
    loop {
        let candidate = unique_name_at(name, index);
        if !fs::try_exists(join_relative(dir, &candidate)).await? {
            return Ok(candidate);
        }
        index += 1;
    }
}

fn join_relative(dir: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(dir.to_path_buf(), |path, part| path.join(part))
}

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg)
}

#[cfg(test)]
#[path = "partial_tests.rs"]
mod tests;
