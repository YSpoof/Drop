//! `~/.dropConfig`: settings, transfer totals and donation reminder counters.

use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Keep in sync with `DONATION_REMINDER_INTERVAL` in the frontend `consts.ts`.
pub const DONATION_REMINDER_INTERVAL: u64 = 25;
/// Keep in sync with `siteData.donationPixKey` in the frontend.
pub const DONATION_PIX_KEY: &str = "cee3846a-a1ab-4e81-83ac-c5edb016fd71";

const FILE_NAME: &str = ".dropConfig";

/// On-disk JSON shape, unchanged from earlier CLI versions. Unknown fields (legacy `autoDownload`) are ignored.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub device_name: String,
    pub download_dir: String,
    pub transfer_stats: TransferStats,
    pub visit_count: u64,
    pub donation_reminder_anchor: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TransferStats {
    pub upload_bytes: u64,
    pub download_bytes: u64,
    pub upload_files: u64,
    pub download_files: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Upload,
    Download,
}

/// The loaded config plus its path. Every mutation is saved at once.
#[derive(Debug)]
pub struct Store {
    path: PathBuf,
    config: Config,
    /// The file existed but could not be read or parsed; back it up before overwriting.
    backup_pending: bool,
}

/// `~/.dropConfig`.
pub fn default_path() -> io::Result<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join(FILE_NAME))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "home directory not found"))
}

impl Store {
    /// Loads `path`. A missing file yields defaults; an unreadable one yields defaults
    /// and is copied to `<path>.bak` before the first save.
    pub fn load(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let (config, backup_pending) = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(config) => (config, false),
                Err(_) => (Config::default(), true),
            },
            Err(err) if err.kind() == io::ErrorKind::NotFound => (Config::default(), false),
            Err(_) => (Config::default(), true),
        };
        Self {
            path,
            config,
            backup_pending,
        }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Download directory for this run: `--out`, else the persisted one, else the current directory.
    pub fn download_dir(&self, out: Option<&Path>) -> PathBuf {
        let persisted =
            Some(Path::new(&self.config.download_dir)).filter(|dir| !dir.as_os_str().is_empty());
        match out.or(persisted) {
            Some(dir) => std::path::absolute(dir).unwrap_or_else(|_| dir.to_path_buf()),
            None => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }

    /// Persists the display name; an empty name clears it.
    pub fn set_device_name(&mut self, name: &str) -> io::Result<()> {
        self.update(|config| config.device_name = name.to_string())
    }

    /// Persists the download directory as an absolute path; `None` or empty clears it.
    pub fn set_download_dir(&mut self, dir: Option<&Path>) -> io::Result<()> {
        let dir = match dir.filter(|dir| !dir.as_os_str().is_empty()) {
            Some(dir) => std::path::absolute(dir)?.to_string_lossy().into_owned(),
            None => String::new(),
        };
        self.update(|config| config.download_dir = dir)
    }

    /// Adds one completed transfer of `bytes` to the totals.
    pub fn add_transfer(&mut self, direction: Direction, bytes: u64) -> io::Result<()> {
        self.update(|config| {
            let stats = &mut config.transfer_stats;
            let (total, files) = match direction {
                Direction::Upload => (&mut stats.upload_bytes, &mut stats.upload_files),
                Direction::Download => (&mut stats.download_bytes, &mut stats.download_files),
            };
            *total = total.saturating_add(bytes);
            *files = files.saturating_add(1);
        })
    }

    pub fn reset_stats(&mut self) -> io::Result<()> {
        self.update(|config| config.transfer_stats = TransferStats::default())
    }

    /// Counts one process start.
    pub fn record_visit(&mut self) -> io::Result<()> {
        self.update(|config| config.visit_count = config.visit_count.saturating_add(1))
    }

    /// Due every `DONATION_REMINDER_INTERVAL` visits after the last dismissal; stays due until dismissed.
    pub fn donation_due(&self) -> bool {
        let due_at = self
            .config
            .donation_reminder_anchor
            .saturating_add(DONATION_REMINDER_INTERVAL);
        self.config.visit_count >= due_at
    }

    /// Starts the next reminder interval from the current visit.
    pub fn dismiss_donation(&mut self) -> io::Result<()> {
        self.update(|config| config.donation_reminder_anchor = config.visit_count)
    }

    /// Re-reads the file so changes saved by another process (e.g. a second CLI) are kept,
    /// applies `change`, and saves.
    fn update(&mut self, change: impl FnOnce(&mut Config)) -> io::Result<()> {
        if !self.backup_pending
            && let Ok(bytes) = std::fs::read(&self.path)
            && let Ok(config) = serde_json::from_slice(&bytes)
        {
            self.config = config;
        }
        change(&mut self.config);
        self.save()
    }

    /// Writes atomically through a per-process temp file and a rename.
    fn save(&mut self) -> io::Result<()> {
        if self.backup_pending {
            std::fs::copy(&self.path, sibling(&self.path, ".bak"))?;
            self.backup_pending = false;
        }
        let tmp = sibling(&self.path, &format!(".{}.tmp", std::process::id()));
        std::fs::write(&tmp, serde_json::to_vec(&self.config)?)?;
        std::fs::rename(&tmp, &self.path).inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })
    }
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    name.into()
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
