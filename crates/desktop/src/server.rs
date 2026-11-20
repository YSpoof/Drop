//! Loopback HTTP server: router, token auth, CORS.

use std::io;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::extract::{Query, Request, State};
use axum::http::{HeaderName, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::{bridge, streamer};

pub const TOKEN_HEADER: &str = "x-drop-token";

const CORS: [(&str, &str); 5] = [
    ("access-control-allow-origin", "*"),
    ("access-control-allow-methods", "GET, POST, OPTIONS"),
    (
        "access-control-allow-headers",
        "X-Drop-Token, Range, Content-Type",
    ),
    ("access-control-allow-private-network", "true"),
    (
        "access-control-expose-headers",
        "Accept-Ranges, Content-Range, Content-Length",
    ),
];

/// 32 random bytes as 64 hex characters.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| format!("generate token: {err}"))?;
    Ok(hex::encode(bytes))
}

pub fn router(token: String) -> Router {
    Router::new()
        .route("/bridge", get(bridge::upgrade))
        .route("/read", get(streamer::read))
        .route("/write", post(streamer::write))
        .route_layer(middleware::from_fn_with_state(
            Arc::<str>::from(token),
            auth,
        ))
        .with_state(Arc::new(bridge::Bridge::new()))
        .layer(middleware::from_fn(cors))
}

pub struct Server {
    pub port: u16,
    shutdown: oneshot::Sender<()>,
    task: JoinHandle<io::Result<()>>,
}

/// Binds `127.0.0.1:0` and serves the router in the background.
pub async fn start(token: String) -> io::Result<Server> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let (shutdown, signal) = oneshot::channel();
    let serve = axum::serve(listener, router(token)).with_graceful_shutdown(async {
        let _ = signal.await;
    });
    let task = tokio::spawn(serve.into_future());
    Ok(Server {
        port,
        shutdown,
        task,
    })
}

impl Server {
    /// Graceful shutdown, abandoned after 3 s.
    pub async fn stop(self) {
        let _ = self.shutdown.send(());
        match tokio::time::timeout(Duration::from_secs(3), self.task).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(err))) => eprintln!("drop-desktop: server error: {err}"),
            Ok(Err(err)) => eprintln!("drop-desktop: server task failed: {err}"),
            Err(_) => eprintln!("drop-desktop: server shutdown timed out"),
        }
    }
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// Accepts the token from the `X-Drop-Token` header, else the `token` query parameter.
async fn auth(State(token): State<Arc<str>>, req: Request, next: Next) -> Response {
    let header = req
        .headers()
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok());
    let got = match header.filter(|v| !v.is_empty()) {
        Some(value) => value.to_owned(),
        None => Query::<TokenQuery>::try_from_uri(req.uri())
            .ok()
            .and_then(|query| query.0.token)
            .unwrap_or_default(),
    };
    if bool::from(got.as_bytes().ct_eq(token.as_bytes())) {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
    }
}

/// Adds CORS headers to every response; preflight answers 204 before auth.
async fn cors(req: Request, next: Next) -> Response {
    let mut res = match *req.method() {
        Method::OPTIONS => StatusCode::NO_CONTENT.into_response(),
        _ => next.run(req).await,
    };
    for (name, value) in CORS {
        res.headers_mut().insert(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }
    res
}
