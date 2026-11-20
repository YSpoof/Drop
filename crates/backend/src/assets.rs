//! Embedded frontend build and client downloads, and the rules that serve them.
//!
//! Real files are served with their cache header, client-side routes get the
//! SPA shell, and paths that look like a missing file get a 404: answering a
//! missing module with the shell makes browsers fail with a misleading
//! "MIME type text/html" error.

use std::borrow::Cow;

use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderName, Method, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use mime_guess::mime;
use percent_encoding::percent_decode_str;
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../frontend/build"]
pub struct Frontend;

#[derive(Embed)]
#[folder = "../../downloads"]
pub struct Downloads;

/// Read access to a set of files addressed by slash-separated relative path.
pub trait Assets {
    fn file(&self, path: &str) -> Option<Cow<'static, [u8]>>;
}

impl Assets for Frontend {
    fn file(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        Self::get(path).map(|file| file.data)
    }
}

impl Assets for Downloads {
    fn file(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        Self::get(path).map(|file| file.data)
    }
}

/// Router fallback: everything that is not `/health` or `/ws`.
pub async fn handler(method: Method, uri: Uri, headers: HeaderMap) -> Response {
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    serve(&Frontend, &Downloads, &method, uri.path(), range)
}

/// Router fallback for known paths hit with another method.
pub async fn method_not_allowed() -> Response {
    not_allowed()
}

fn not_allowed() -> Response {
    reply(
        StatusCode::METHOD_NOT_ALLOWED,
        &[
            (header::ALLOW, "GET, HEAD"),
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
        ],
        Bytes::from_static(b"Method Not Allowed\n"),
    )
}

/// Applies the serving rules to one request. HEAD gets the GET headers without a body.
pub fn serve(
    frontend: &impl Assets,
    downloads: &impl Assets,
    method: &Method,
    path: &str,
    range: Option<&str>,
) -> Response {
    let head = match *method {
        Method::GET => false,
        Method::HEAD => true,
        _ => return not_allowed(),
    };
    let path = percent_decode_str(path).decode_utf8_lossy();
    let name = clean(&path);
    let response = match name.strip_prefix("downloads/") {
        Some(file) => download(downloads, file, range),
        None if name == "downloads" => not_found(),
        None => serve_frontend(frontend, &name, path.ends_with('/'), range),
    };
    match head {
        true => response.map(|_| Body::empty()),
        false => response,
    }
}

fn serve_frontend(assets: &impl Assets, name: &str, dir: bool, range: Option<&str>) -> Response {
    if name.is_empty() {
        return shell(assets);
    }
    if let Some(data) = assets.file(name) {
        return file(name, data, cache_control(name), range);
    }
    let index = format!("{name}/index.html");
    match (dir, assets.file(&index)) {
        (true, Some(data)) => file(&index, data, cache_control(&index), range),
        _ if is_asset_path(name) => not_found(),
        _ => shell(assets),
    }
}

fn download(assets: &impl Assets, name: &str, range: Option<&str>) -> Response {
    match assets.file(name) {
        Some(data) => file(name, data, None, range),
        None => not_found(),
    }
}

/// The SPA shell, looked up per request so a missing build still serves `/ws`.
fn shell(assets: &impl Assets) -> Response {
    let Some(index) = assets.file("index.html") else {
        return not_found();
    };
    reply(
        StatusCode::OK,
        &[
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes(index),
    )
}

fn file(
    name: &str,
    data: Cow<'static, [u8]>,
    cache: Option<&str>,
    range: Option<&str>,
) -> Response {
    let len = data.len() as u64;
    let span = range.map_or(Span::Full, |value| parse_range(value, len));
    let (start, end) = match span {
        Span::Full => (0, len),
        Span::Part(start, end) => (start, end),
        Span::Unsatisfiable => {
            return reply(
                StatusCode::RANGE_NOT_SATISFIABLE,
                &[
                    (header::CONTENT_RANGE, &format!("bytes */{len}")),
                    (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                ],
                Bytes::from_static(b"invalid range: failed to overlap\n"),
            );
        }
    };
    let content_type = content_type(name);
    let content_range = format!("bytes {start}-{}/{len}", end.saturating_sub(1));
    let mut headers = vec![
        (header::CONTENT_TYPE, content_type.as_str()),
        (header::ACCEPT_RANGES, "bytes"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    ];
    headers.extend(cache.map(|value| (header::CACHE_CONTROL, value)));
    let status = match span {
        Span::Part(..) => {
            headers.push((header::CONTENT_RANGE, &content_range));
            StatusCode::PARTIAL_CONTENT
        }
        _ => StatusCode::OK,
    };
    reply(
        status,
        &headers,
        bytes(data).slice(start as usize..end as usize),
    )
}

fn not_found() -> Response {
    reply(
        StatusCode::NOT_FOUND,
        &[
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Bytes::from_static(b"404 page not found\n"),
    )
}

fn reply(status: StatusCode, headers: &[(HeaderName, &str)], body: Bytes) -> Response {
    let builder = Response::builder()
        .status(status)
        .header(header::CONTENT_LENGTH, body.len());
    headers
        .iter()
        .fold(builder, |builder, (name, value)| {
            builder.header(name, *value)
        })
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn bytes(data: Cow<'static, [u8]>) -> Bytes {
    match data {
        Cow::Borrowed(data) => Bytes::from_static(data),
        Cow::Owned(data) => Bytes::from(data),
    }
}

/// Resolves `.` and `..` without leaving the root; returns a path with no leading
/// or trailing slash (`""` for the root).
fn clean(path: &str) -> String {
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/")
}

/// A path whose last segment has a `.` addresses a file, never a SPA route.
fn is_asset_path(name: &str) -> bool {
    name.rsplit('/')
        .next()
        .is_some_and(|last| last.contains('.'))
}

/// Mirrors SvelteKit's adapter-node headers. Hashed chunks are cached forever so
/// a browser on an older build never re-fetches chunks a deploy removed.
fn cache_control(name: &str) -> Option<&'static str> {
    match name {
        _ if name.starts_with("_app/immutable/") => Some("public, max-age=31536000, immutable"),
        "index.html" | "service-worker.js" => Some("no-cache"),
        _ if name.ends_with("/index.html") => Some("no-cache"),
        _ => None,
    }
}

fn content_type(name: &str) -> String {
    let mime = mime_guess::from_path(name).first_or_octet_stream();
    match mime.type_() {
        mime::TEXT => format!("{mime}; charset=utf-8"),
        _ => mime.to_string(),
    }
}

#[derive(Debug, PartialEq)]
enum Span {
    Full,
    /// Byte range `start..end` (end exclusive).
    Part(u64, u64),
    Unsatisfiable,
}

/// Parses a single `bytes=` range. Multiple ranges are ignored (full body), as
/// RFC 9110 allows; anything malformed or outside the file is unsatisfiable.
fn parse_range(value: &str, len: u64) -> Span {
    let Some(spec) = value.trim().strip_prefix("bytes=") else {
        return Span::Unsatisfiable;
    };
    if spec.contains(',') {
        return Span::Full;
    }
    let Some((first, last)) = spec.split_once('-') else {
        return Span::Unsatisfiable;
    };
    let (first, last) = (first.trim(), last.trim());
    let bounds = match (first.is_empty(), last.is_empty()) {
        (true, false) => last
            .parse::<u64>()
            .ok()
            .map(|n| (len.saturating_sub(n), len)),
        (false, true) => first.parse().ok().map(|start| (start, len)),
        (false, false) => match (first.parse::<u64>(), last.parse::<u64>()) {
            (Ok(start), Ok(last)) if start <= last => {
                Some((start, last.saturating_add(1).min(len)))
            }
            _ => None,
        },
        (true, true) => None,
    };
    match bounds {
        Some((start, end)) if start < end => Span::Part(start, end),
        _ => Span::Unsatisfiable,
    }
}

#[cfg(test)]
#[path = "assets_tests.rs"]
mod tests;
