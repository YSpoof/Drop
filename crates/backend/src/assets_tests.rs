use std::borrow::Cow;
use std::collections::HashMap;

use axum::body::to_bytes;
use axum::http::{Method, StatusCode, header};
use axum::response::Response;

use super::{Assets, Span, parse_range, serve};

struct MemoryAssets(HashMap<&'static str, &'static [u8]>);

impl Assets for MemoryAssets {
    fn file(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        self.0.get(path).map(|data| Cow::Borrowed(*data))
    }
}

fn frontend() -> MemoryAssets {
    MemoryAssets(HashMap::from([
        (
            "index.html",
            b"<!doctype html><title>drop</title>".as_slice(),
        ),
        (
            "_app/immutable/nodes/1.abc123.js",
            b"export const component = () => {};",
        ),
        ("_app/immutable/assets/app.css", b"body{}"),
        ("share/index.html", b"<!doctype html><title>share</title>"),
    ]))
}

fn downloads() -> MemoryAssets {
    MemoryAssets(HashMap::from([(
        "Drop-cli-linux_x64",
        b"0123456789".as_slice(),
    )]))
}

fn request(method: Method, path: &str, range: Option<&str>) -> Response {
    serve(&frontend(), &downloads(), &method, path, range)
}

fn get(path: &str) -> Response {
    request(Method::GET, path, None)
}

fn header(response: &Response, name: header::HeaderName) -> &str {
    response
        .headers()
        .get(name)
        .map_or("", |value| value.to_str().unwrap())
}

async fn body(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn serves_assets_with_immutable_caching() {
    let response = get("/_app/immutable/nodes/1.abc123.js");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(header(&response, header::CONTENT_TYPE).contains("javascript"));
    assert_eq!(
        header(&response, header::CACHE_CONTROL),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(header(&response, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(body(response).await, "export const component = () => {};");
}

#[tokio::test]
async fn missing_asset_returns_404() {
    let response = get("/_app/immutable/nodes/9.stale.js");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(header(&response, header::CONTENT_TYPE).starts_with("text/plain"));
    assert_eq!(header(&response, header::CACHE_CONTROL), "no-store");
    assert!(!body(response).await.contains("<!doctype html>"));
}

#[test]
fn missing_static_file_returns_404() {
    for path in [
        "/service-worker.js",
        "/manifest.json",
        "/favicon.svg",
        "/robots.txt",
    ] {
        assert_eq!(get(path).status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn spa_fallback() {
    for path in ["/", "/join/", "/web-share-catcher/", "/share"] {
        let response = get(path);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert!(
            header(&response, header::CONTENT_TYPE).contains("text/html"),
            "{path}"
        );
        assert_eq!(
            header(&response, header::CACHE_CONTROL),
            "no-cache",
            "{path}"
        );
        assert_eq!(
            header(&response, header::X_CONTENT_TYPE_OPTIONS),
            "nosniff",
            "{path}"
        );
        assert!(
            body(response).await.contains("<title>drop</title>"),
            "{path}"
        );
    }
}

#[tokio::test]
async fn serves_prerendered_route_directory() {
    let response = get("/share/");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(&response, header::CACHE_CONTROL), "no-cache");
    assert!(body(response).await.contains("<title>share</title>"));
}

#[test]
fn cache_table() {
    assert_eq!(
        header(&get("/index.html"), header::CACHE_CONTROL),
        "no-cache"
    );
    assert_eq!(
        header(&get("/share/index.html"), header::CACHE_CONTROL),
        "no-cache"
    );
    assert_eq!(
        header(
            &get("/_app/immutable/assets/app.css"),
            header::CACHE_CONTROL
        ),
        "public, max-age=31536000, immutable"
    );
    assert!(
        header(&get("/_app/immutable/assets/app.css"), header::CONTENT_TYPE)
            .starts_with("text/css")
    );
}

#[tokio::test]
async fn supports_head() {
    for path in [
        "/",
        "/_app/immutable/nodes/1.abc123.js",
        "/downloads/Drop-cli-linux_x64",
    ] {
        let response = request(Method::HEAD, path, None);
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_ne!(header(&response, header::CONTENT_LENGTH), "0", "{path}");
        assert_eq!(body(response).await, "", "{path}");
    }
}

#[test]
fn rejects_non_get() {
    for method in [Method::POST, Method::PUT, Method::DELETE] {
        let response = request(method, "/", None);
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(header(&response, header::ALLOW), "GET, HEAD");
    }
}

#[tokio::test]
async fn does_not_escape_root() {
    let response = get("/../../etc/passwd");

    assert!(!body(response).await.contains("root:"));
    assert_eq!(
        get("/%2e%2e/%2e%2e/etc/passwd.txt").status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn bare_downloads_returns_404() {
    for path in [
        "/downloads/",
        "/downloads",
        "/downloads/missing.exe",
        "/downloads/missing",
    ] {
        assert_eq!(get(path).status(), StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn serves_download_with_ranges() {
    let full = get("/downloads/Drop-cli-linux_x64");
    assert_eq!(full.status(), StatusCode::OK);
    assert_eq!(header(&full, header::ACCEPT_RANGES), "bytes");
    assert_eq!(
        header(&full, header::CONTENT_TYPE),
        "application/octet-stream"
    );
    assert_eq!(body(full).await, "0123456789");

    let part = request(
        Method::GET,
        "/downloads/Drop-cli-linux_x64",
        Some("bytes=2-4"),
    );
    assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(header(&part, header::CONTENT_RANGE), "bytes 2-4/10");
    assert_eq!(header(&part, header::CONTENT_LENGTH), "3");
    assert_eq!(body(part).await, "234");

    let bad = request(
        Method::GET,
        "/downloads/Drop-cli-linux_x64",
        Some("bytes=10-"),
    );
    assert_eq!(bad.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(header(&bad, header::CONTENT_RANGE), "bytes */10");
}

#[test]
fn range_parsing() {
    assert_eq!(parse_range("bytes=0-0", 10), Span::Part(0, 1));
    assert_eq!(parse_range("bytes=5-", 10), Span::Part(5, 10));
    assert_eq!(parse_range("bytes=-3", 10), Span::Part(7, 10));
    assert_eq!(parse_range("bytes=-30", 10), Span::Part(0, 10));
    assert_eq!(parse_range("bytes=8-100", 10), Span::Part(8, 10));
    assert_eq!(parse_range("bytes=0-1,4-5", 10), Span::Full);
    assert_eq!(parse_range("bytes=5-2", 10), Span::Unsatisfiable);
    assert_eq!(parse_range("bytes=-0", 10), Span::Unsatisfiable);
    assert_eq!(parse_range("bytes=0-", 0), Span::Unsatisfiable);
    assert_eq!(parse_range("items=0-1", 10), Span::Unsatisfiable);
    assert_eq!(parse_range("bytes=a-b", 10), Span::Unsatisfiable);
}

#[test]
fn missing_shell_answers_404() {
    let empty = MemoryAssets(HashMap::new());
    let response = serve(&empty, &empty, &Method::GET, "/", None);
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
