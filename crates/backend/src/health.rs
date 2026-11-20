//! `/health`: reports that the process serves requests and which commit it was built from.

use axum::http::{Method, header};
use axum::response::{IntoResponse, Response};

/// Commit the binary was built from; the Docker build sets `BUILD_SHA`.
pub const SHA: &str = match option_env!("BUILD_SHA") {
    Some(sha) => sha,
    None => "dev",
};

pub async fn handler(method: Method) -> Response {
    response(&method, SHA)
}

/// Never cached: a stale "ok" is worse than no answer.
pub fn response(method: &Method, sha: &str) -> Response {
    let body = serde_json::json!({ "ok": true, "sha": sha }).to_string();
    let headers = [
        (
            header::CONTENT_TYPE,
            "application/json; charset=utf-8".to_owned(),
        ),
        (header::CACHE_CONTROL, "no-store".to_owned()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
        (header::CONTENT_LENGTH, body.len().to_string()),
    ];
    match *method {
        Method::HEAD => headers.into_response(),
        _ => (headers, body).into_response(),
    }
}

#[cfg(test)]
#[path = "health_tests.rs"]
mod tests;
