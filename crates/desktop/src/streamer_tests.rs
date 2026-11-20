use axum::Router;
use axum::http::{Method, Request};
use tower::ServiceExt;

use super::*;
use crate::server::{TOKEN_HEADER, new_token, router};

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

struct Fixture {
    app: Router,
    token: String,
    dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let token = new_token().unwrap();
        Self {
            app: router(token.clone()),
            token,
            dir: tempfile::tempdir().unwrap(),
        }
    }

    fn path(&self, name: &str) -> String {
        self.dir.path().join(name).to_string_lossy().into_owned()
    }

    async fn send(
        &self,
        method: Method,
        uri: String,
        headers: &[(&str, &str)],
        body: &'static [u8],
    ) -> (StatusCode, HeaderMap, Vec<u8>) {
        let mut req = Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            req = req.header(*name, *value);
        }
        let res = self
            .app
            .clone()
            .oneshot(req.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let (parts, body) = res.into_parts();
        let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        (parts.status, parts.headers, bytes.to_vec())
    }

    async fn write(&self, path: &str, append: bool, body: &'static [u8]) -> StatusCode {
        let suffix = if append { "&append=1" } else { "" };
        let uri = format!("/write?path={}{suffix}", encode(path));
        self.send(Method::POST, uri, &[(TOKEN_HEADER, &self.token)], body)
            .await
            .0
    }

    async fn read(&self, path: &str, range: Option<&str>) -> (StatusCode, HeaderMap, Vec<u8>) {
        let mut headers = vec![(TOKEN_HEADER, self.token.as_str())];
        headers.extend(range.map(|r| ("range", r)));
        self.send(
            Method::GET,
            format!("/read?path={}", encode(path)),
            &headers,
            b"",
        )
        .await
    }
}

#[test]
fn tokens_are_64_hex_and_unique() {
    let (a, b) = (new_token().unwrap(), new_token().unwrap());
    assert_eq!(a.len(), 64);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_ne!(a, b);
}

#[tokio::test]
async fn streamer_rejects_missing_or_wrong_token() {
    let fx = Fixture::new();
    let target = fx.path("test.bin");
    let uri = format!("/write?path={}", encode(&target));

    let (status, ..) = fx.send(Method::POST, uri.clone(), &[], b"x").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, ..) = fx
        .send(Method::POST, uri, &[(TOKEN_HEADER, "wrong")], b"x")
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!std::path::Path::new(&target).exists());

    std::fs::write(&target, b"secret").unwrap();
    let (status, _, body) = fx
        .send(
            Method::GET,
            format!("/read?path={}", encode(&target)),
            &[],
            b"",
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, b"unauthorized");
}

#[tokio::test]
async fn streamer_writes_appends_and_reads() {
    let fx = Fixture::new();
    let target = fx.path("test.bin");

    assert_eq!(fx.write(&target, false, b"Hello, ").await, StatusCode::OK);
    assert_eq!(fx.write(&target, true, b"World!").await, StatusCode::OK);
    assert_eq!(std::fs::read(&target).unwrap(), b"Hello, World!");

    let (status, headers, body) = fx.read(&target, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["accept-ranges"], "bytes");
    assert_eq!(body, b"Hello, World!");

    let (status, headers, body) = fx.read(&target, Some("bytes=7-11")).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(headers["content-range"], "bytes 7-11/13");
    assert_eq!(body, b"World");

    let (status, _, body) = fx.read(&target, Some("bytes=7-")).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, b"World!");

    let (status, headers, _) = fx.read(&target, Some("bytes=13-")).await;
    assert_eq!(status, StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(headers["content-range"], "bytes */13");
}

#[tokio::test]
async fn streamer_truncates_without_append() {
    let fx = Fixture::new();
    let target = fx.path("test.bin");
    std::fs::write(&target, b"old content").unwrap();

    assert_eq!(fx.write(&target, false, b"new").await, StatusCode::OK);
    assert_eq!(std::fs::read(&target).unwrap(), b"new");

    assert_eq!(fx.write(&target, false, b"").await, StatusCode::OK);
    assert_eq!(std::fs::read(&target).unwrap(), b"");
}

#[tokio::test]
async fn streamer_reads_zero_length_file_with_open_range() {
    let fx = Fixture::new();
    let target = fx.path("empty.bin");
    std::fs::write(&target, b"").unwrap();

    let (status, headers, body) = fx.read(&target, Some("bytes=0-")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-length"], "0");
    assert!(body.is_empty());
}

#[tokio::test]
async fn streamer_reports_missing_path_and_file() {
    let fx = Fixture::new();
    let (status, ..) = fx
        .send(
            Method::GET,
            "/read".into(),
            &[(TOKEN_HEADER, &fx.token)],
            b"",
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, ..) = fx.read(&fx.path("absent.bin"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn streamer_accepts_token_in_query() {
    let fx = Fixture::new();
    let target = fx.path("q.bin");
    std::fs::write(&target, b"q").unwrap();
    let uri = format!("/read?path={}&token={}", encode(&target), fx.token);
    let (status, _, body) = fx.send(Method::GET, uri, &[], b"").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"q");
}

#[tokio::test]
async fn preflight_answers_204_with_private_network_header() {
    let fx = Fixture::new();
    let (status, headers, _) = fx
        .send(Method::OPTIONS, "/read?path=x".into(), &[], b"")
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(headers["access-control-allow-private-network"], "true");
    assert_eq!(headers["access-control-allow-origin"], "*");
    assert_eq!(
        headers["access-control-allow-headers"],
        "X-Drop-Token, Range, Content-Type"
    );
}

#[test]
fn range_parsing() {
    assert_eq!(parse_range("bytes=0-", 10), Some((0, 9)));
    assert_eq!(parse_range("bytes=2-4", 10), Some((2, 4)));
    assert_eq!(parse_range("bytes=2-100", 10), Some((2, 9)));
    assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
    assert_eq!(parse_range("bytes=-30", 10), Some((0, 9)));
    assert_eq!(parse_range("bytes=10-", 10), None);
    assert_eq!(parse_range("bytes=5-2", 10), None);
    assert_eq!(parse_range("bytes=0-", 0), None);
    assert_eq!(parse_range("items=0-1", 10), None);
    assert_eq!(parse_range("bytes=0-1,3-4", 10), None);
}
