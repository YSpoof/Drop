//! Signaling wire types shared by the backend hub and the CLI client.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Number of digits in a share PIN.
pub const SHARE_CODE_DIGITS: usize = 4;
/// PINs are drawn from `0..SHARE_CODE_RANGE` (5^4), zero-padded.
pub const SHARE_CODE_RANGE: u32 = 625;

/// A peer as shown to the other side of a pairing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub peer_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub display_name: String,
}

/// Frames sent by a client to the signaling server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientMessage {
    #[serde(rename_all = "camelCase")]
    Announce {
        peer_id: String,
        #[serde(default, skip_serializing_if = "is_false")]
        host: bool,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        display_name: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        code: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        public_ipv4: String,
    },
    #[serde(rename_all = "camelCase")]
    JoinCode {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        peer_id: String,
        #[serde(default)]
        code: String,
    },
    #[serde(rename_all = "camelCase")]
    Signal {
        #[serde(default)]
        target_peer_id: String,
        #[serde(default)]
        payload: Value,
    },
    Ping,
    Pong,
}

/// Frames sent by the signaling server to a client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerMessage {
    CodeAssigned {
        code: String,
    },
    PeerJoining {
        requester: PeerInfo,
        #[serde(default, skip_serializing_if = "is_false")]
        lan: bool,
    },
    JoinAccepted {
        host: PeerInfo,
        #[serde(default, skip_serializing_if = "is_false")]
        lan: bool,
    },
    JoinRejected,
    #[serde(rename_all = "camelCase")]
    Signal {
        from_peer_id: String,
        #[serde(default)]
        payload: Value,
    },
    Ping,
    Pong,
}

fn is_false(value: &bool) -> bool {
    !value
}

/// Returns the code when it is exactly four ASCII digits.
pub fn normalize_code(code: &str) -> Option<&str> {
    let valid = code.len() == SHARE_CODE_DIGITS && code.bytes().all(|b| b.is_ascii_digit());
    valid.then_some(code)
}

/// Formats a PIN index as a zero-padded four-digit code.
pub fn format_code(index: u32) -> String {
    format!("{:0width$}", index % SHARE_CODE_RANGE, width = SHARE_CODE_DIGITS)
}

/// True for a dotted IPv4 address that is not private, loopback, link-local,
/// multicast, reserved, or `0.x.x.x`.
pub fn is_public_ipv4(ip: &str) -> bool {
    let Some([a, b]) = leading_octets(ip) else {
        return false;
    };
    let reserved = a == 0 || a == 127 || a >= 224 || (a == 169 && b == 254);
    let private = a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168);
    !reserved && !private
}

/// Parses `a.b.c.d` (each part 1+ digits, value 0..=255) and returns `[a, b]`.
fn leading_octets(ip: &str) -> Option<[u8; 2]> {
    let parts: Vec<u8> = ip
        .split('.')
        .map(|part| {
            let digits = !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit());
            digits.then(|| part.parse::<u8>().ok()).flatten()
        })
        .collect::<Option<_>>()?;
    match parts.as_slice() {
        [a, b, _, _] => Some([*a, *b]),
        _ => None,
    }
}

#[cfg(test)]
#[path = "signaling_tests.rs"]
mod tests;
