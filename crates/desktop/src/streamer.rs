//! Raw file bytes: `GET /read` with Range, `POST /write` truncating or appending.

use std::io::{self, SeekFrom};

use axum::body::Body;
use axum::extract::Query;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
pub struct Params {
    #[serde(default)]
    path: String,
    #[serde(default)]
    append: String,
}

pub async fn read(Query(params): Query<Params>, headers: HeaderMap) -> Response {
    if params.path.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing path").into_response();
    }
    let range = headers
        .get(header::RANGE)
        .map(|v| v.to_str().unwrap_or_default());
    match serve(&params.path, range).await {
        Ok(res) => res,
        Err(err) => error(err),
    }
}

async fn serve(path: &str, range: Option<&str>) -> io::Result<Response> {
    let mut file = File::open(path).await?;
    let meta = file.metadata().await?;
    if meta.is_dir() {
        return Ok((StatusCode::BAD_REQUEST, "path is a directory").into_response());
    }
    let size = meta.len();
    // An empty file ignores Range and answers 200.
    let (status, start, end) = match range.filter(|_| size > 0) {
        None => (StatusCode::OK, 0, size),
        Some(spec) => match parse_range(spec, size) {
            Some((start, last)) => (StatusCode::PARTIAL_CONTENT, start, last + 1),
            None => return Ok(unsatisfiable(size)),
        },
    };
    file.seek(SeekFrom::Start(start)).await?;

    let mut res = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, end - start);
    if status == StatusCode::PARTIAL_CONTENT {
        res = res.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{size}", end - 1),
        );
    }
    let body = Body::from_stream(ReaderStream::new(file.take(end - start)));
    res.body(body).map_err(io::Error::other)
}

/// Parses one `bytes=` range into an inclusive `(first, last)`; `None` when invalid or unsatisfiable.
pub fn parse_range(spec: &str, size: u64) -> Option<(u64, u64)> {
    let (first, last) = spec.trim().strip_prefix("bytes=")?.split_once('-')?;
    let max = size.checked_sub(1)?;
    let (first, last) = match (first.trim(), last.trim()) {
        ("", suffix) => (size - suffix.parse::<u64>().ok()?.min(size), max),
        (first, "") => (first.parse().ok()?, max),
        (first, last) => (first.parse().ok()?, last.parse::<u64>().ok()?.min(max)),
    };
    (first <= last).then_some((first, last))
}

fn unsatisfiable(size: u64) -> Response {
    let range = format!("bytes */{size}");
    (
        StatusCode::RANGE_NOT_SATISFIABLE,
        [(header::CONTENT_RANGE, range)],
    )
        .into_response()
}

pub async fn write(Query(params): Query<Params>, body: Body) -> Response {
    if params.path.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing path").into_response();
    }
    match store(&params.path, params.append == "1", body).await {
        Ok(()) => StatusCode::OK.into_response(),
        Err(err) => error(err),
    }
}

async fn store(path: &str, append: bool, body: Body) -> io::Result<()> {
    let mut options = OpenOptions::new();
    if append {
        options.append(true);
    } else {
        options.write(true).truncate(true);
    }
    let mut file = options.create(true).open(path).await?;
    let mut chunks = body.into_data_stream();
    while let Some(chunk) = chunks.next().await {
        file.write_all(&chunk.map_err(io::Error::other)?).await?;
    }
    file.flush().await
}

fn error(err: io::Error) -> Response {
    let status = match err.kind() {
        io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        io::ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, err.to_string()).into_response()
}

#[cfg(test)]
#[path = "streamer_tests.rs"]
mod tests;
