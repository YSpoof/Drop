//! Share links derived from the signaling URL.

use url::{Url, form_urlencoded};

use crate::signaling::normalize_url;

const DEFAULT_ORIGIN: &str = "https://drop.lzart.com.br";

/// The web origin for a signaling URL: `http` for loopback hosts, `https` otherwise.
/// A port is kept unless it is the default of the chosen scheme.
pub fn share_origin(ws_url: &str) -> String {
    let Ok(url) = Url::parse(&normalize_url(ws_url)) else {
        return DEFAULT_ORIGIN.into();
    };
    let Some(host) = url.host_str() else {
        return DEFAULT_ORIGIN.into();
    };
    let (scheme, default_port) = match host {
        "localhost" | "127.0.0.1" | "[::1]" => ("http", 80),
        _ => ("https", 443),
    };
    match url.port() {
        Some(port) if port != default_port => format!("{scheme}://{host}:{port}"),
        _ => format!("{scheme}://{host}"),
    }
}

/// `{origin}/share/?hostid=<peer>&code=<pin>`, the link the web app opens.
pub fn share_url(ws_url: &str, peer_id: &str, pin: &str) -> String {
    let query: String = form_urlencoded::Serializer::new(String::new())
        .append_pair("hostid", peer_id)
        .append_pair("code", pin)
        .finish();
    format!("{}/share/?{query}", share_origin(ws_url))
}

#[cfg(test)]
#[path = "share_tests.rs"]
mod tests;
