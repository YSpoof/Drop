use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::{SHA, response};

fn header(response: &Response, name: header::HeaderName) -> &str {
    response
        .headers()
        .get(name)
        .map_or("", |value| value.to_str().unwrap())
}

async fn json_body(response: Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn reports_build_sha() {
    let response = response(&Method::GET, "abc1234");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header(&response, header::CONTENT_TYPE),
        "application/json; charset=utf-8"
    );
    assert_eq!(header(&response, header::CACHE_CONTROL), "no-store");
    assert_eq!(header(&response, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(
        json_body(response).await,
        json!({ "ok": true, "sha": "abc1234" })
    );
}

/// The real router must not hand `/health` to the SPA fallback.
#[tokio::test]
async fn router_serves_health() {
    let request = Request::get("/health").body(Body::empty()).unwrap();
    let response = crate::router().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert!(header(&response, header::CONTENT_TYPE).starts_with("application/json"));
    assert_eq!(json_body(response).await, json!({ "ok": true, "sha": SHA }));
}

#[tokio::test]
async fn router_rejects_post_with_allow() {
    for path in ["/health", "/ws", "/"] {
        let request = Request::post(path).body(Body::empty()).unwrap();
        let response = crate::router().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED, "{path}");
        assert_eq!(header(&response, header::ALLOW), "GET, HEAD", "{path}");
    }
}

#[tokio::test]
async fn supports_head() {
    let response = response(&Method::HEAD, "abc1234");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(header(&response, header::CONTENT_LENGTH), "27");
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.is_empty());
}
