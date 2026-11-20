//! Local identity: random peer ID and the display name announced to peers.

/// Display name when the hostname cannot be read.
pub const DEFAULT_NAME: &str = "dropcli-node";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    pub peer_id: String,
    pub display_name: String,
}

impl Device {
    /// A fresh peer ID and `name`, or the hostname when `name` is empty.
    pub fn new(name: &str) -> Self {
        Self {
            peer_id: peer_id(),
            display_name: display_name(name, hostname()),
        }
    }
}

/// 16 random bytes as lowercase hex (32 characters); `dropcli-<hex $USER>` without randomness.
pub fn peer_id() -> String {
    random_hex(16).unwrap_or_else(|| {
        let user = std::env::var("USER").unwrap_or_default();
        format!("dropcli-{}", hex(user.as_bytes()))
    })
}

/// `len` random bytes as lowercase hex.
pub fn random_hex(len: usize) -> Option<String> {
    let mut bytes = vec![0; len];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn display_name(name: &str, hostname: Option<String>) -> String {
    match name.trim() {
        "" => hostname.unwrap_or_else(|| DEFAULT_NAME.into()),
        name => name.into(),
    }
}

/// The machine name: `/proc/sys/kernel/hostname` on Linux, `COMPUTERNAME` on Windows.
pub fn hostname() -> Option<String> {
    #[cfg(target_os = "windows")]
    let raw = std::env::var("COMPUTERNAME").ok();
    #[cfg(not(target_os = "windows"))]
    let raw = std::fs::read_to_string("/proc/sys/kernel/hostname").ok();
    raw.map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

#[cfg(test)]
#[path = "device_tests.rs"]
mod tests;
